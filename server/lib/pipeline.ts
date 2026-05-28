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

    // ─── Stage 0: Clear stale discovery cache ───────────────────────────────
    // On re-analysis, purge old discovered documents so irrelevant cached docs
    // from previous runs don't pollute the document list.
    await storage.clearDiscoveredDocuments(companyId, frameworkId);

    // ─── Stage 1: Discovery ──────────────────────────────────────────────────

    const trustedSources = await storage.getTrustedSources();
    const pinnedUrls = company.pinnedDocuments || [];

    const discoveryResult: DiscoveryResult = await searchCompanyDocuments({
      companyName,
      companyId,
      companyDomain: company.domain,
      isin: company.isin,
      sector: company.sector,
      country: company.country,
      pinnedUrls,
      framework,
      trustedSources,
    });

    // Persist fresh discovery results to documents table
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

    // Build the document list from fresh discovery only (no stale cache)
    // Sort by discovery priority (lower = better); pinned docs have priority -100
    const sortedDocs = [...discoveryResult.documents].sort((a, b) => a.priority - b.priority);

    // Process ALL discovered documents (up to a generous cap of 40)
    // More documents = better chance of finding evidence for each measure
    const DOC_CAP = 40;
    const docsToProcess = sortedDocs.slice(0, DOC_CAP).map(doc => ({
      url: doc.url,
      title: doc.title,
      type: inferDocumentType(doc.url),
      priority: doc.priority,
    }));

    console.log(`[${companyName}] Processing ${docsToProcess.length} docs from ${discoveryResult.documents.length} discovered`);

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

    // Process documents sequentially to manage memory
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

    console.log(`[${companyName}] Successfully processed ${documentTexts.length}/${docsToProcess.length} documents`);

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
        documentsCached: 0,
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
      documentsCached: 0,
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
