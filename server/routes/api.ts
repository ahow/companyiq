import { Router, Request, Response } from "express";
import multer from "multer";
import { storage } from "../storage.js";
import { getProviderStatus } from "../lib/ai-providers.js";
import { runAnalysisPipeline } from "../lib/pipeline.js";
import { processDocument } from "../lib/processor.js";
import type { Framework, FrameworkMeasure } from "../../shared/schema.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── Batch State ─────────────────────────────────────────────────────────────

interface BatchState {
  cancelRequested: boolean;
  currentEpoch: number;
  currentCompany?: string;
  running: boolean;
}

const batchState: BatchState = {
  cancelRequested: false,
  currentEpoch: 0,
  currentCompany: undefined,
  running: false,
};

// ─── Health & Version ────────────────────────────────────────────────────────

router.get("/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), process: "web" });
});

router.get("/version", (req: Request, res: Response) => {
  res.json({ version: "2.0.0", buildDate: new Date().toISOString() });
});

// Force-reset stuck claimed jobs back to pending
router.post("/debug/reset-stuck", async (req: Request, res: Response) => {
  try {
    const { db } = await import("../db.js");
    const { sql } = await import("drizzle-orm");
    const result = await db.execute(sql`
      UPDATE analysis_jobs 
      SET status = 'pending', worker_id = NULL, claimed_at = NULL, attempts = 1
      WHERE status = 'claimed' AND claimed_at < NOW() - INTERVAL '10 minutes'
      RETURNING id, company_name
    `);
    res.json({ reset: result.rows.length, jobs: result.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Debug endpoint to check job queue status
router.get("/debug/jobs", async (req: Request, res: Response) => {
  try {
    const { db } = await import("../db.js");
    const { sql } = await import("drizzle-orm");
    const counts = await db.execute(sql`
      SELECT status, COUNT(*) as count FROM analysis_jobs GROUP BY status
    `);
    const total = await db.execute(sql`SELECT COUNT(*) as count FROM analysis_jobs`);
    const sample = await db.execute(sql`SELECT * FROM analysis_jobs LIMIT 3`);
    const schema = await db.execute(sql`
      SELECT column_name, data_type FROM information_schema.columns 
      WHERE table_name = 'analysis_jobs' ORDER BY ordinal_position
    `);
    const batch5Jobs = await db.execute(sql`SELECT id, company_id, company_name, status, last_error, worker_id, claimed_at, completed_at FROM analysis_jobs WHERE batch_id = 6 ORDER BY status, id LIMIT 10`);
    const claimedJobs = await db.execute(sql`SELECT id, company_id, company_name, status, last_error, worker_id, claimed_at FROM analysis_jobs WHERE status = 'claimed' ORDER BY claimed_at`);
    const recentErrors = await db.execute(sql`SELECT * FROM processing_errors ORDER BY created_at DESC LIMIT 5`);
    const companyStatuses = await db.execute(sql`SELECT analysis_status, COUNT(*) as count FROM companies GROUP BY analysis_status`);
    res.json({ statusCounts: counts.rows, totalJobs: total.rows[0], batch5Jobs: batch5Jobs.rows, claimedJobs: claimedJobs.rows, recentErrors: recentErrors.rows, companyStatuses: companyStatuses.rows });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Companies CRUD ──────────────────────────────────────────────────────────

router.get("/companies", async (req: Request, res: Response) => {
  try {
    const listId = req.query.listId ? parseInt(req.query.listId as string) : null;
    let companyList: any[] = [];

    if (listId) {
      // Get companies filtered by list
      const lists = await storage.getCompanyLists();
      const list = lists.find(l => l.id === listId);
      if (list && list.companyIds && list.companyIds.length > 0) {
        companyList = await storage.getCompaniesByIds(list.companyIds as number[]);
      }
    } else {
      companyList = await storage.getCompanies();
    }

    const completed = companyList.filter((c) => c.analysisStatus === "completed").length;
    const avgScore = completed > 0
      ? Math.round(companyList.filter(c => c.totalScore !== null).reduce((sum, c) => sum + (c.totalScore || 0), 0) / completed)
      : 0;
    res.json({ companies: companyList, stats: { total: companyList.length, completed, avgScore } });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/companies/:id", async (req: Request, res: Response) => {
  try {
    const company = await storage.getCompany(parseInt(req.params.id));
    if (!company) return res.status(404).json({ error: "Company not found" });

    const scores = await storage.getMeasureScores(company.id);
    const documents = await storage.getDocumentsForCompany(company.id);
    res.json({ company, scores, documents });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/companies", async (req: Request, res: Response) => {
  try {
    const { name, isin, sector, country, domain } = req.body;
    if (!name) return res.status(400).json({ error: "Name is required" });

    const company = await storage.createCompany({ name, isin, sector, country, domain });
    res.status(201).json(company);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/companies/:id", async (req: Request, res: Response) => {
  try {
    const company = await storage.updateCompany(parseInt(req.params.id), req.body);
    if (!company) return res.status(404).json({ error: "Company not found" });
    res.json(company);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/companies/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteCompany(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Company Import (Excel/CSV) ──────────────────────────────────────────────

router.post("/companies/import", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const listName = req.body.listName || req.file.originalname || "Imported list";

    const XLSX = await import("xlsx");
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet);

    // Helper to find a value from multiple possible column names
    function findCol(row: any, ...keys: string[]): string | null {
      for (const key of keys) {
        if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
          return String(row[key]).trim();
        }
      }
      // Also try case-insensitive partial match
      const rowKeys = Object.keys(row);
      for (const candidate of keys) {
        const found = rowKeys.find(k => k.toLowerCase().includes(candidate.toLowerCase()));
        if (found && row[found] !== undefined && row[found] !== null && String(row[found]).trim() !== "") {
          return String(row[found]).trim();
        }
      }
      return null;
    }

    const created: any[] = [];
    const skipped: string[] = [];
    for (const row of rows) {
      // Flexible name detection
      const name = findCol(row, "NAME", "name", "Name", "company", "Company", "COMPANY", "Company Name", "company_name");
      if (!name) continue;

      const existing = await storage.getCompanyByName(name);
      if (existing) {
        skipped.push(name);
        // Still include existing companies in the list
        created.push(existing);
        continue;
      }

      // Flexible ISIN detection (often labeled "Type" in MSCI files)
      const isin = findCol(row, "ISIN", "isin", "Type", "type", "Identifier", "ID");

      // Flexible sector detection
      const sector = findCol(row, "LEVEL2 SECTOR NAME", "LEVEL3 SECTOR NAME", "sector", "Sector", "SECTOR", "Industry", "industry");

      // Flexible country detection
      const country = findCol(row, "GEOGRAPHIC DESCR.", "GEOGRAPHIC DESCR", "country", "Country", "COUNTRY", "Geography", "Region");

      // Domain detection
      const domain = findCol(row, "domain", "Domain", "DOMAIN", "website", "Website");

      const company = await storage.createCompany({
        name,
        isin: isin || null,
        sector: sector || null,
        country: country || null,
        domain: domain || null,
      });
      created.push(company);
    }

    // Create a company list record
    if (created.length > 0) {
      await storage.createCompanyList({
        name: listName,
        companyIds: created.map((c) => c.id),
        sourceFilename: req.file.originalname,
      });
    }

    res.json({
      imported: created.length - skipped.length,
      existing: skipped.length,
      total: rows.length,
      listName,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Document Upload ─────────────────────────────────────────────────────────

router.post("/companies/:id/documents", upload.single("file"), async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.params.id);
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Extract content from uploaded PDF
    const pdfParse = (await import("pdf-parse")).default;
    const data = await pdfParse(req.file.buffer);
    const content = data.text || "";

    const url = `upload://${req.file.originalname}`;
    await storage.upsertDiscoveredDocument({
      companyId,
      url,
      title: req.file.originalname,
      type: "pdf",
      gateVerdict: "accept",
      gateReason: "user-uploaded",
    });

    // Record content (company-level, reusable across frameworks)
    await storage.recordFetchSuccess(companyId, url, content);

    res.json({ success: true, filename: req.file.originalname, contentLength: content.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Reset / Clear Results ──────────────────────────────────────────────────

// Reset a single company (clear scores, summary, status)
router.post("/companies/:id/reset", async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.params.id);
    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    await storage.resetCompany(companyId);
    res.json({ success: true, companyId, companyName: company.name });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reset all companies in a list
router.post("/company-lists/:id/reset", async (req: Request, res: Response) => {
  try {
    const listId = parseInt(req.params.id);
    const lists = await storage.getCompanyLists();
    const list = lists.find(l => l.id === listId);
    if (!list) return res.status(404).json({ error: "List not found" });

    const companyIds = (list.companyIds || []) as number[];
    const resetCount = await storage.resetCompanies(companyIds);
    res.json({ success: true, listId, listName: list.name, resetCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reset ALL companies
router.post("/companies/reset-all", async (req: Request, res: Response) => {
  try {
    const companies = await storage.getCompanies();
    const allIds = companies.map(c => c.id);
    const resetCount = await storage.resetCompanies(allIds);
    res.json({ success: true, resetCount });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Analyze ─────────────────────────────────────────────────────────────────

// Path A: Single company full analysis (fetch + analyze)
router.post("/companies/:id/analyze", async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.params.id);
    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    // Pin framework at run start
    const framework = await storage.getActiveFramework();
    if (!framework) return res.status(400).json({ error: "No active framework" });

    const measures = await storage.getMeasuresForFramework(framework.id);
    if (measures.length === 0) return res.status(400).json({ error: "Framework has no measures" });

    // Check if skipFetch was requested (reuse existing documents)
    const skipFetch = req.body.skipFetch === true;

    // Return immediately, run in background
    res.json({ status: "started", companyId, companyName: company.name, skipFetch });

    // Run pipeline in background
    runAnalysisPipeline({ company, framework, measures, skipFetch }).catch((err) => {
      console.error(`[${company.name}] Background analysis failed:`, err);
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Path A2: Re-analyze with different framework (skip fetch, reuse cached docs)
router.post("/companies/:id/re-analyze", async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.params.id);
    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    const framework = await storage.getActiveFramework();
    if (!framework) return res.status(400).json({ error: "No active framework" });

    const measures = await storage.getMeasuresForFramework(framework.id);
    if (measures.length === 0) return res.status(400).json({ error: "Framework has no measures" });

    // Check if company has fetched documents
    const fetchedDocs = await storage.getFetchedDocuments(companyId);
    if (fetchedDocs.length === 0) {
      return res.status(400).json({ 
        error: "No fetched documents available. Run a full analysis first to fetch documents.",
        fetchedCount: 0,
      });
    }

    // Return immediately, run analysis only (skip fetch)
    res.json({ 
      status: "started", 
      companyId, 
      companyName: company.name, 
      skipFetch: true,
      documentsAvailable: fetchedDocs.length,
    });

    // Run pipeline with skipFetch=true
    runAnalysisPipeline({ company, framework, measures, skipFetch: true }).catch((err) => {
      console.error(`[${company.name}] Re-analysis failed:`, err);
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Path B: Batch analyze — now accepts optional listId and frameworkId
router.post("/companies/analyze-all", async (req: Request, res: Response) => {
  try {
    if (batchState.running) {
      return res.status(409).json({ error: "A batch is already running" });
    }

    // Accept optional frameworkId — if not provided, use active framework
    let framework: Framework | undefined;
    if (req.body.frameworkId) {
      framework = await storage.getFramework(parseInt(req.body.frameworkId));
      if (!framework) return res.status(400).json({ error: "Framework not found" });
    } else {
      framework = await storage.getActiveFramework();
      if (!framework) return res.status(400).json({ error: "No active framework" });
    }

    const measures = await storage.getMeasuresForFramework(framework.id);
    if (measures.length === 0) return res.status(400).json({ error: "Framework has no measures" });

    // Accept optional listId — if provided, only analyze companies in that list
    let companiesToAnalyze: any[];
    let listName: string | undefined;
    if (req.body.listId) {
      const lists = await storage.getCompanyLists();
      const list = lists.find(l => l.id === parseInt(req.body.listId));
      if (!list) return res.status(400).json({ error: "Company list not found" });
      listName = list.name;
      const companyIds = (list.companyIds || []) as number[];
      companiesToAnalyze = await storage.getCompaniesByIds(companyIds);
    } else {
      companiesToAnalyze = await storage.getCompanies();
    }

    if (companiesToAnalyze.length === 0) return res.status(400).json({ error: "No companies to analyze" });

    // Create batch run
    const batch = await storage.createBatchRun({
      totalJobs: companiesToAnalyze.length,
      frameworkId: framework.id,
      triggeredBy: "web",
    });

    // Enqueue jobs
    for (const company of companiesToAnalyze) {
      await storage.createAnalysisJob({
        companyId: company.id,
        companyName: company.name,
        batchId: batch.id,
        frameworkId: framework.id,
      });
    }

    batchState.running = true;
    batchState.cancelRequested = false;
    batchState.currentEpoch++;

    res.json({
      batchId: batch.id,
      totalJobs: companiesToAnalyze.length,
      frameworkId: framework.id,
      frameworkName: framework.name,
      listId: req.body.listId || null,
      listName: listName || "All companies",
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Batch status
router.get("/batch/status", async (req: Request, res: Response) => {
  try {
    const batch = await storage.getActiveBatchRun();
    if (!batch) {
      return res.json({ running: false, completed: 0, total: 0, failed: 0 });
    }
    res.json({
      running: batch.status === "running",
      batchId: batch.id,
      completed: batch.completedJobs,
      failed: batch.failedJobs,
      total: batch.totalJobs,
      currentCompany: batchState.currentCompany,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Cancel batch
router.post("/batch/cancel", async (req: Request, res: Response) => {
  try {
    batchState.cancelRequested = true;
    batchState.currentEpoch++;
    batchState.running = false;

    const batch = await storage.getActiveBatchRun();
    if (batch) {
      await storage.cancelBatchRun(batch.id);
    }

    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Recent batch runs
router.get("/batch/runs", async (req: Request, res: Response) => {
  try {
    const runs = await storage.getRecentBatchRuns();
    res.json(runs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Frameworks ──────────────────────────────────────────────────────────────

router.get("/frameworks", async (req: Request, res: Response) => {
  try {
    const frameworks = await storage.getFrameworks();
    res.json(frameworks);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/frameworks/:id", async (req: Request, res: Response) => {
  try {
    const framework = await storage.getFramework(parseInt(req.params.id));
    if (!framework) return res.status(404).json({ error: "Framework not found" });

    const measures = await storage.getMeasuresForFramework(framework.id);
    res.json({ ...framework, measures });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/frameworks", async (req: Request, res: Response) => {
  try {
    const framework = await storage.createFramework(req.body);
    res.status(201).json(framework);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/frameworks/:id", async (req: Request, res: Response) => {
  try {
    const framework = await storage.updateFramework(parseInt(req.params.id), req.body);
    if (!framework) return res.status(404).json({ error: "Framework not found" });
    res.json(framework);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/frameworks/:id/activate", async (req: Request, res: Response) => {
  try {
    await storage.activateFramework(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/frameworks/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteFramework(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Framework Measures ──────────────────────────────────────────────────────

router.post("/frameworks/:id/measures", async (req: Request, res: Response) => {
  try {
    const frameworkId = parseInt(req.params.id);
    const measure = await storage.createMeasure({ ...req.body, frameworkId });
    res.status(201).json(measure);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/frameworks/:id/measures/:measureId", async (req: Request, res: Response) => {
  try {
    const frameworkId = parseInt(req.params.id);
    const measure = await storage.updateMeasure(frameworkId, req.params.measureId, req.body);
    if (!measure) return res.status(404).json({ error: "Measure not found" });
    res.json(measure);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/frameworks/:id/measures/:measureId", async (req: Request, res: Response) => {
  try {
    await storage.deleteMeasure(parseInt(req.params.id), req.params.measureId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/frameworks/:id/measures/bulk", async (req: Request, res: Response) => {
  try {
    const frameworkId = parseInt(req.params.id);
    const measures = req.body.measures.map((m: any) => ({ ...m, frameworkId }));
    const created = await storage.bulkCreateMeasures(measures);
    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
// ─── Framework Builder (moved to /routes/framework-builder.ts) ──────────────

// ─── Settings ────────────────────────────────────────────────────────────────

router.get("/settings", async (req: Request, res: Response) => {
  try {
    const settings = await storage.getSettings();
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/settings", async (req: Request, res: Response) => {
  try {
    await storage.upsertSettings(req.body);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Providers ───────────────────────────────────────────────────────────────

router.get("/providers/status", (req: Request, res: Response) => {
  res.json(getProviderStatus());
});

// ─── Diagnostics ─────────────────────────────────────────────────────────────

router.get("/diagnostics/recent-errors", async (req: Request, res: Response) => {
  try {
    const errors = await storage.getRecentErrors();
    res.json(errors);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/diagnostics/companies/:id/discovery", async (req: Request, res: Response) => {
  try {
    const company = await storage.getCompany(parseInt(req.params.id));
    if (!company) return res.status(404).json({ error: "Company not found" });
    res.json(company.discoveryDiagnostics || {});
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Snapshots ───────────────────────────────────────────────────────────────

router.post("/companies/:id/snapshot", async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.params.id);
    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    const scores = await storage.getMeasureScores(companyId);
    const framework = await storage.getActiveFramework();

    const snapshot = await storage.createSnapshot({
      companyId,
      frameworkId: framework?.id,
      frameworkName: framework?.name,
      totalScore: company.totalScore ?? undefined,
      summary: company.summary ?? undefined,
      measureScoresData: scores,
      documentCount: (await storage.getDocumentsForCompany(companyId)).length,
      label: req.body.label,
    });

    res.status(201).json(snapshot);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/snapshots", async (req: Request, res: Response) => {
  try {
    const companyId = req.query.companyId ? parseInt(req.query.companyId as string) : undefined;
    const snapshots = await storage.getSnapshots(companyId);
    res.json(snapshots);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/snapshots/:id", async (req: Request, res: Response) => {
  try {
    const snapshot = await storage.getSnapshot(parseInt(req.params.id));
    if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });
    res.json(snapshot);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/snapshots/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteSnapshot(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Trusted Sources ─────────────────────────────────────────────────────────

router.get("/trusted-sources", async (req: Request, res: Response) => {
  try {
    const sources = await storage.getTrustedSources();
    res.json(sources);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/trusted-sources", async (req: Request, res: Response) => {
  try {
    const source = await storage.createTrustedSource(req.body);
    res.status(201).json(source);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch("/trusted-sources/:id", async (req: Request, res: Response) => {
  try {
    const source = await storage.updateTrustedSource(parseInt(req.params.id), req.body);
    res.json(source);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/trusted-sources/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteTrustedSource(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Company Lists ───────────────────────────────────────────────────────────

router.get("/company-lists", async (req: Request, res: Response) => {
  try {
    const lists = await storage.getCompanyLists();
    res.json(lists);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete("/company-lists/:id", async (req: Request, res: Response) => {
  try {
    const listId = parseInt(req.params.id);
    const deleteCompanies = req.query.deleteCompanies === "true";

    if (deleteCompanies) {
      // Get the list first to find company IDs
      const lists = await storage.getCompanyLists();
      const list = lists.find(l => l.id === listId);
      if (list && list.companyIds) {
        for (const companyId of list.companyIds as number[]) {
          try {
            await storage.deleteCompany(companyId);
          } catch (e) {
            // Company may already be deleted or referenced elsewhere
          }
        }
      }
    }

    await storage.deleteCompanyList(listId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Export ──────────────────────────────────────────────────────────────────

router.get("/export/companies.csv", async (req: Request, res: Response) => {
  try {
    const companies = await storage.getCompanies();
    let csv = "id,name,isin,sector,country,totalScore,analysisStatus\n";
    for (const c of companies) {
      csv += `${c.id},"${c.name}","${c.isin || ""}","${c.sector || ""}","${c.country || ""}",${c.totalScore || 0},${c.analysisStatus}\n`;
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=companies.csv");
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get("/export/measure-scores.csv", async (req: Request, res: Response) => {
  try {
    const companies = await storage.getCompanies();
    let csv = "companyId,companyName,measureId,category,title,score,verdict,confidence,evidenceSummary\n";
    for (const company of companies) {
      const scores = await storage.getMeasureScores(company.id);
      for (const s of scores) {
        csv += `${company.id},"${company.name}","${s.measureId}","${s.category || ""}","${s.title || ""}",${s.score},"${s.verdict || ""}","${s.confidence || ""}","${(s.evidenceSummary || "").replace(/"/g, '""').slice(0, 200)}"\n`;
      }
    }
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=measure-scores.csv");
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Company Terminology ─────────────────────────────────────────────────────

router.get("/companies/:id/terminology", async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.params.id);
    const framework = await storage.getActiveFramework();
    if (!framework) return res.json(null);

    const terminology = await storage.getCompanyTerminology(companyId, framework.id);
    res.json(terminology);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/companies/:id/refresh-terminology", async (req: Request, res: Response) => {
  try {
    const companyId = parseInt(req.params.id);
    const company = await storage.getCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    // Delete existing terminology to force re-discovery
    const framework = await storage.getActiveFramework();
    if (!framework) return res.status(400).json({ error: "No active framework" });

    // The next analysis run will re-discover terminology
    res.json({ success: true, message: "Terminology will be refreshed on next analysis" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ─── Analysis Results (Saved Completed Analyses) ──────────────────────────────────

// List all saved analysis results
router.get("/analysis-results", async (req: Request, res: Response) => {
  try {
    const results = await storage.getAnalysisResults();
    // Return without the full resultsData to keep response small
    const summary = results.map(r => ({
      id: r.id,
      frameworkId: r.frameworkId,
      frameworkName: r.frameworkName,
      listId: r.listId,
      listName: r.listName,
      batchId: r.batchId,
      companyCount: r.companyCount,
      averageScore: r.averageScore,
      shareToken: r.shareToken,
      completedAt: r.completedAt,
      createdAt: r.createdAt,
    }));
    res.json(summary);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get a single analysis result (full data)
router.get("/analysis-results/:id", async (req: Request, res: Response) => {
  try {
    const result = await storage.getAnalysisResult(parseInt(req.params.id));
    if (!result) return res.status(404).json({ error: "Analysis result not found" });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete an analysis result
router.delete("/analysis-results/:id", async (req: Request, res: Response) => {
  try {
    await storage.deleteAnalysisResult(parseInt(req.params.id));
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Download analysis result as CSV spreadsheet
router.get("/analysis-results/:id/download", async (req: Request, res: Response) => {
  try {
    const result = await storage.getAnalysisResult(parseInt(req.params.id));
    if (!result) return res.status(404).json({ error: "Analysis result not found" });

    const data = result.resultsData as any[];
    if (!data || data.length === 0) {
      return res.status(400).json({ error: "No results data" });
    }

    // Get all unique measure IDs from the first company
    const measureIds = data[0]?.measureScores?.map((m: any) => m.measureId) || [];
    const measureTitles = data[0]?.measureScores?.map((m: any) => m.title) || [];

    // Build CSV header
    let csv = `"Company","ISIN","Sector","Country","Total Score (%)","Summary"`;
    for (const title of measureTitles) {
      csv += `,"${title} (Score)","${title} (Verdict)","${title} (Evidence)"`;
    }
    csv += "\n";

    // Build CSV rows
    for (const company of data) {
      csv += `"${company.companyName}","${company.isin || ""}","${company.sector || ""}","${company.country || ""}",${company.totalScore},"${(company.summary || "").replace(/"/g, '""').slice(0, 500)}"`;
      for (const measureId of measureIds) {
        const score = company.measureScores?.find((m: any) => m.measureId === measureId);
        if (score) {
          csv += `,${score.score},"${score.verdict || ""}","${(score.evidenceSummary || "").replace(/"/g, '""').slice(0, 300)}"`;
        } else {
          csv += `,0,"",""`;
        }
      }
      csv += "\n";
    }

    const filename = `${result.frameworkName.replace(/[^a-zA-Z0-9]/g, "_")}_${result.listName || "All"}_${new Date(result.completedAt).toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Public share endpoint (no auth required) - returns JSON
router.get("/share/:token", async (req: Request, res: Response) => {
  try {
    const result = await storage.getAnalysisResultByShareToken(req.params.token);
    if (!result) return res.status(404).json({ error: "Shared result not found" });
    res.json({
      frameworkName: result.frameworkName,
      listName: result.listName,
      companyCount: result.companyCount,
      averageScore: result.averageScore,
      completedAt: result.completedAt,
      results: result.resultsData,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
