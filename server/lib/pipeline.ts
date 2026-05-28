/**
 * Pipeline Architecture (v3):
 * 
 * The pipeline is split into TWO DISTINCT PHASES:
 * 
 * Phase 1: FETCH (company-level, framework-agnostic for document storage)
 *   - Clear stale discovery cache
 *   - Discover documents via web search
 *   - Run relevance gate
 *   - Fetch ALL accepted documents (download content)
 *   - Store fetched content at the company level
 *   - Status: idle -> fetching -> fetched
 * 
 * Phase 2: ANALYZE (framework-specific)
 *   - Load all fetched documents for the company
 *   - Run LLM scoring against the active framework measures
 *   - Store scores
 *   - Status: fetched -> analyzing -> completed
 * 
 * Key benefit: Once documents are fetched for a company, they can be
 * reused across multiple framework evaluations without re-fetching.
 */

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
  skipFetch?: boolean; // If true, skip fetch phase (reuse existing documents)
}

export interface PipelineResult {
  success: boolean;
  analysis?: AnalysisResult;
  error?: string;
  documentsProcessed: number;
  documentsFresh: number;
  documentsCached: number;
}

// ─── Phase 1: Fetch Documents (Company-Level) ───────────────────────────────

async function runFetchPhase(opts: {
  company: Company;
  framework: Framework;
  cancelCheck?: () => boolean;
}): Promise<{ fetchedCount: number; totalAccepted: number }> {
  const { company, framework, cancelCheck } = opts;
  const companyId = company.id;
  const companyName = company.name;

  console.log(`[${companyName}] === PHASE 1: FETCH ===`);

  // Update status to fetching
  await storage.updateCompany(companyId, { analysisStatus: "fetching" });

  // Step 1: Clear stale discovery cache (non-uploaded docs)
  await storage.clearDiscoveredDocuments(companyId);
  console.log(`[${companyName}] Cleared stale discovery cache`);

  if (cancelCheck?.()) {
    await storage.updateCompany(companyId, { analysisStatus: "idle" });
    return { fetchedCount: 0, totalAccepted: 0 };
  }

  // Step 2: Run discovery (web search + relevance gate)
  const trustedSources = await storage.getTrustedSources();
  const discoveryResult: DiscoveryResult = await searchCompanyDocuments({
    companyName,
    companyId,
    companyDomain: company.domain,
    isin: company.isin,
    sector: company.sector,
    country: company.country,
    pinnedUrls: (company.pinnedDocuments as string[]) || undefined,
    framework,
    trustedSources,
  });

  console.log(`[${companyName}] Discovery found ${discoveryResult.documents.length} accepted documents`);

  // Step 3: Store discovered documents in DB (company-level, no frameworkId in uniqueness)
  for (const doc of discoveryResult.documents) {
    const type = inferDocumentType(doc.url);
    await storage.upsertDiscoveredDocument({
      companyId,
      url: doc.url,
      title: doc.title,
      type,
      gateVerdict: "accept",
      gateReason: `Priority: ${doc.priority}, Lane: ${doc.lane}`,
    });
  }

  // Save discovery diagnostics
  await storage.updateCompany(companyId, {
    discoveryDiagnostics: discoveryResult.diagnostics as any,
  });

  if (cancelCheck?.()) {
    await storage.updateCompany(companyId, { analysisStatus: "idle" });
    return { fetchedCount: 0, totalAccepted: discoveryResult.documents.length };
  }

  // Step 4: Fetch ALL accepted documents
  const acceptedDocs = await storage.getAcceptedDocuments(companyId);
  const pendingDocs = acceptedDocs.filter((d) => d.fetchStatus === "pending");
  const alreadyFetched = acceptedDocs.filter((d) => d.fetchStatus === "ok").length;

  console.log(`[${companyName}] Fetching ${pendingDocs.length} pending documents (${alreadyFetched} already cached)`);

  let newFetchCount = 0;
  const TOTAL_FETCH_BUDGET_MS = 10 * 60 * 1000; // 10 minute total budget
  const fetchStartTime = Date.now();

  for (const doc of pendingDocs) {
    if (cancelCheck?.()) break;

    // Check total time budget
    if (Date.now() - fetchStartTime > TOTAL_FETCH_BUDGET_MS) {
      console.warn(`[${companyName}] Fetch time budget exhausted after ${newFetchCount} docs`);
      break;
    }

    try {
      const type = inferDocumentType(doc.url);
      const content = await processDocument(doc.url, type);

      if (content && content.length > 50) {
        await storage.recordFetchSuccess(companyId, doc.url, content);
        newFetchCount++;
      } else {
        await storage.recordFetchFailure(companyId, doc.url);
      }
    } catch (error: any) {
      console.warn(`[${companyName}] Fetch failed for ${doc.url}: ${error.message}`);
      await storage.recordFetchFailure(companyId, doc.url);
    }
  }

  const totalFetched = alreadyFetched + newFetchCount;
  console.log(`[${companyName}] Fetch phase complete: ${totalFetched} total fetched (${newFetchCount} new, ${alreadyFetched} cached)`);

  // Update status to fetched
  await storage.updateCompany(companyId, { analysisStatus: "fetched" });

  return { fetchedCount: totalFetched, totalAccepted: acceptedDocs.length };
}

// ─── Phase 2: Analyze Documents (Framework-Specific) ────────────────────────

async function runAnalyzePhase(opts: {
  company: Company;
  framework: Framework;
  measures: FrameworkMeasure[];
  cancelCheck?: () => boolean;
}): Promise<AnalysisResult | null> {
  const { company, framework, measures, cancelCheck } = opts;
  const companyId = company.id;
  const companyName = company.name;

  console.log(`[${companyName}] === PHASE 2: ANALYZE ===`);

  // Update status to analyzing
  await storage.updateCompany(companyId, { analysisStatus: "analyzing" });

  // Load all fetched documents for this company (company-level, reusable)
  const fetchedDocs = await storage.getFetchedDocuments(companyId);

  if (fetchedDocs.length === 0) {
    console.warn(`[${companyName}] No fetched documents available for analysis`);
    await storage.updateCompany(companyId, {
      analysisStatus: "completed",
      totalScore: 0,
      summary: "No documents could be fetched for analysis.",
    });
    await storage.clearMeasureScores(companyId);
    return null;
  }

  console.log(`[${companyName}] Analyzing with ${fetchedDocs.length} fetched documents`);

  if (cancelCheck?.()) {
    await storage.updateCompany(companyId, { analysisStatus: "fetched" });
    return null;
  }

  // Build document texts (from stored content)
  const documentTexts: string[] = [];
  const documentUrls: string[] = [];
  for (const doc of fetchedDocs) {
    if (doc.content) {
      documentTexts.push(doc.content);
      documentUrls.push(doc.url);
    }
  }

  // Run the LLM analysis (framework-specific scoring)
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
    console.warn(`[${companyName}] 0%-guard triggered: all measures are Low-confidence zeros`);
    await storage.updateCompany(companyId, { analysisStatus: "failed" });
    await storage.logProcessingError({
      companyId,
      companyName,
      stage: "score",
      error: "Analysis returned 0% with all Low-confidence verdicts — likely a retrieval failure",
    });
    return null;
  }

  // ─── Persist Results ──────────────────────────────────────────────────────

  await storage.clearMeasureScores(companyId);

  const scoreRows = analysis.categories.flatMap((cat) =>
    cat.measures.map((m) => ({
      companyId,
      frameworkId: framework.id,
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

  // Update company with results
  await storage.updateCompany(companyId, {
    totalScore: analysis.scorePercentage,
    summary: analysis.summary,
    analysisStatus: "completed",
  });

  console.log(`[${companyName}] Analysis complete: ${analysis.scorePercentage}% (${analysis.totalScore}/${measures.length} measures met)`);

  return analysis;
}

// ─── Combined Pipeline (both phases in sequence) ────────────────────────────

export async function runAnalysisPipeline(opts: PipelineOptions): Promise<PipelineResult> {
  const { company, framework, measures, cancelCheck, skipFetch } = opts;
  const companyName = company.name;
  const companyId = company.id;

  try {
    // Phase 1: Fetch (unless skipping to reuse cached docs)
    let fetchResult = { fetchedCount: 0, totalAccepted: 0 };
    if (!skipFetch) {
      fetchResult = await runFetchPhase({ company, framework, cancelCheck });
      
      if (cancelCheck?.()) {
        return { success: false, error: "Cancelled", documentsProcessed: 0, documentsFresh: 0, documentsCached: 0 };
      }

      if (fetchResult.fetchedCount === 0) {
        await storage.updateCompany(companyId, {
          analysisStatus: "completed",
          totalScore: 0,
          summary: "No documents could be fetched for analysis.",
        });
        return {
          success: false,
          error: "No documents could be fetched",
          documentsProcessed: 0,
          documentsFresh: fetchResult.totalAccepted,
          documentsCached: 0,
        };
      }
    } else {
      console.log(`[${companyName}] Skipping fetch phase (reusing cached documents)`);
      // Ensure status reflects we're past fetching
      await storage.updateCompany(companyId, { analysisStatus: "fetched" });
    }

    // Phase 2: Analyze
    const analysis = await runAnalyzePhase({ company, framework, measures, cancelCheck });

    if (!analysis) {
      return {
        success: false,
        error: "Analysis produced no results",
        documentsProcessed: fetchResult.fetchedCount,
        documentsFresh: fetchResult.totalAccepted,
        documentsCached: 0,
      };
    }

    return {
      success: true,
      analysis,
      documentsProcessed: fetchResult.fetchedCount,
      documentsFresh: fetchResult.totalAccepted,
      documentsCached: skipFetch ? fetchResult.fetchedCount : 0,
    };
  } catch (error: any) {
    console.error(`[${companyName}] Pipeline error: ${error.message}`);
    await storage.updateCompany(companyId, { analysisStatus: "failed" });
    await storage.logProcessingError({
      companyId,
      companyName,
      stage: "pipeline",
      error: error.message,
      details: error.stack?.slice(0, 500),
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
