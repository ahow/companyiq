import { storage } from "../storage.js";
import { searchCompanyDocuments, type DiscoveryResult } from "./discovery.js";
import { processDocument, inferDocumentType } from "./processor.js";
import { analyzeCompanyMeasures, type AnalysisResult } from "./analyzer.js";
import type { Company, Framework, FrameworkMeasure } from "../../shared/schema.js";

export interface PipelineOptions {
  company: Company;
  framework: Framework;
  measures: FrameworkMeasure[];
  cancelCheck?: () => boolean;
}

export interface PipelineResult {
  success: boolean;
  analysis?: AnalysisResult;
  error?: string;
  documentsProcessed: number;
  documentsFresh: number;
  documentsCached: number;
}

/**
 * Full analysis pipeline for a single company.
 * Implements the 0%-guard: never wipes prior scores unless new analysis succeeds.
 */
export async function runAnalysisPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { company, framework, measures, cancelCheck } = opts;
  const companyName = company.name;
  const companyId = company.id;
  const frameworkId = framework.id;

  try {
    // Update status
    await storage.updateCompany(companyId, { analysisStatus: "searching" });

    // Check cancel
    if (cancelCheck?.()) {
      await storage.updateCompany(companyId, { analysisStatus: "idle" });
      return { success: false, error: "Cancelled", documentsProcessed: 0, documentsFresh: 0, documentsCached: 0 };
    }

    // ─── Stage 1: Discovery ──────────────────────────────────────────────────

    const trustedSources = await storage.getTrustedSources();
    const pinnedUrls = company.pinnedDocuments || [];

    const discoveryResult: DiscoveryResult = await searchCompanyDocuments({
      companyName,
      companyId,
      companyDomain: company.domain,
      isin: company.isin,
      pinnedUrls,
      framework,
      trustedSources,
    });

    // Persist discovery results to documents table (monotonic additive cache)
    for (const doc of discoveryResult.documents) {
      await storage.upsertDiscoveredDocument({
        companyId,
        frameworkId,
        url: doc.url,
        title: doc.title,
        type: inferDocumentType(doc.url),
        gateVerdict: "accept",
        gateReason: "fresh-discovery-accepted",
      });
    }

    // Union fresh discovery with cached accepted documents
    const cachedDocs = await storage.getCachedAcceptedDocuments(companyId, frameworkId);
    const allDocUrls = new Set<string>();
    const finalDocs: Array<{ url: string; title: string | null; type: string }> = [];

    for (const doc of cachedDocs) {
      if (!allDocUrls.has(doc.url)) {
        allDocUrls.add(doc.url);
        finalDocs.push({ url: doc.url, title: doc.title, type: doc.type });
      }
    }

    // Also add fresh docs not yet in cache
    for (const doc of discoveryResult.documents) {
      if (!allDocUrls.has(doc.url)) {
        allDocUrls.add(doc.url);
        finalDocs.push({ url: doc.url, title: doc.title, type: inferDocumentType(doc.url) });
      }
    }

    // Cap at 12 documents for processing (ranked by discovery priority)
    const docsToProcess = finalDocs.slice(0, 12);

    console.log(`[${companyName}] Processing ${docsToProcess.length} docs (${discoveryResult.documents.length} fresh + ${cachedDocs.length} from cache)`);

    // Persist diagnostics
    await storage.updateCompany(companyId, {
      discoveryDiagnostics: discoveryResult.diagnostics as any,
      analysisStatus: "analyzing",
    });

    if (cancelCheck?.()) {
      await storage.updateCompany(companyId, { analysisStatus: "idle" });
      return { success: false, error: "Cancelled", documentsProcessed: 0, documentsFresh: 0, documentsCached: 0 };
    }

    // ─── Stage 2: Fetch and Process Documents ────────────────────────────────

    const documentTexts: string[] = [];
    const documentUrls: string[] = [];

    // Process documents SEQUENTIALLY to avoid R14 memory errors
    for (const doc of docsToProcess) {
      if (cancelCheck?.()) break;

      try {
        const content = await processDocument(doc.url, doc.type as "pdf" | "html");
        if (content && content.length > 100) {
          documentTexts.push(content);
          documentUrls.push(doc.url);
          await storage.recordFetchSuccess(companyId, frameworkId, doc.url, content);
        } else {
          await storage.recordFetchFailure(companyId, frameworkId, doc.url);
        }
      } catch (error: any) {
        console.warn(`[${companyName}] Failed to process ${doc.url}: ${error.message}`);
        await storage.recordFetchFailure(companyId, frameworkId, doc.url);
      }
    }

    if (documentTexts.length === 0) {
      throw new Error("No documents could be processed");
    }

    console.log(`[${companyName}] Successfully processed ${documentTexts.length} documents`);

    if (cancelCheck?.()) {
      await storage.updateCompany(companyId, { analysisStatus: "idle" });
      return { success: false, error: "Cancelled", documentsProcessed: documentTexts.length, documentsFresh: 0, documentsCached: 0 };
    }

    // ─── Stage 3: Analysis ───────────────────────────────────────────────────

    const analysis = await analyzeCompanyMeasures({
      companyName,
      companyId,
      documentTexts,
      documentUrls,
      framework,
      measures,
    });

    // ─── 0%-GUARD: Only persist if analysis produced meaningful results ──────

    if (analysis.totalScore === 0 && analysis.categories.every(c => c.measures.every(m => m.confidence === "Low"))) {
      // All measures are Low confidence zeros — likely a retrieval failure, not a real result
      console.warn(`[${companyName}] 0%-guard triggered: all measures are Low-confidence zeros`);
      await storage.updateCompany(companyId, { analysisStatus: "failed" });
      await storage.logProcessingError({
        companyId,
        companyName,
        stage: "score",
        error: "Analysis returned 0% with all Low-confidence verdicts — likely a retrieval failure",
      });
      return {
        success: false,
        error: "Analysis returned no meaningful results (0%-guard)",
        documentsProcessed: documentTexts.length,
        documentsFresh: discoveryResult.documents.length,
        documentsCached: cachedDocs.length,
      };
    }

    // ─── Stage 4: Persist Results ────────────────────────────────────────────

    // Clear and rewrite measure scores (safe because we passed the 0%-guard)
    await storage.clearMeasureScores(companyId);

    const scoreRows = analysis.categories.flatMap((cat) =>
      cat.measures.map((m) => ({
        companyId,
        frameworkId,
        measureId: m.measureId,
        category: m.category,
        categoryNumber: m.categoryNumber,
        title: m.title,
        definition: m.definition,
        score: m.score,
        coverage: m.coverage,
        confidence: m.confidence,
        evidenceSummary: m.evidenceSummary,
        quotes: m.quotes,
        verdict: m.verdict,
        verdictNuance: m.verdictNuance,
        displayOrder: m.displayOrder,
      }))
    );

    await storage.createMeasureScores(scoreRows);

    // Update company
    await storage.updateCompany(companyId, {
      totalScore: analysis.scorePercentage,
      summary: analysis.summary,
      analysisStatus: "completed",
    });

    return {
      success: true,
      analysis,
      documentsProcessed: documentTexts.length,
      documentsFresh: discoveryResult.documents.length,
      documentsCached: cachedDocs.length,
    };
  } catch (error: any) {
    console.error(`[${companyName}] Pipeline error: ${error.message}`);
    await storage.updateCompany(companyId, { analysisStatus: "failed" });
    await storage.logProcessingError({
      companyId,
      companyName,
      stage: "score",
      error: error.message,
      details: error.stack,
    });
    return {
      success: false,
      error: error.message,
      documentsProcessed: 0,
      documentsFresh: 0,
      documentsCached: 0,
    };
  }
}
