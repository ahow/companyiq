import { db } from "./db.js";
import { eq, and, sql, desc, asc, inArray, ne } from "drizzle-orm";
import {
  companies,
  frameworks,
  frameworkMeasures,
  documents,
  measureScores,
  analysisJobs,
  batchRuns,
  appSettings,
  processingErrors,
  companyTerminology,
  summaryCache,
  snapshots,
  trustedSources,
  companyLists,
  analysisResults,
  type Company,
  type InsertCompany,
  type Framework,
  type InsertFramework,
  type FrameworkMeasure,
  type InsertFrameworkMeasure,
  type Document,
  type InsertDocument,
  type MeasureScore,
  type InsertMeasureScore,
  type AnalysisJob,
  type BatchRun,
  type AppSetting,
  type CompanyTerminology,
  type SummaryCache,
  type Snapshot,
  type CompanyList,
  type InsertCompanyList,
  type TrustedSource,
  type AnalysisResult,
  type InsertAnalysisResult,
} from "../shared/schema.js";

export class Storage {
  // ─── Companies ───────────────────────────────────────────────────────────────

  async getCompanies(): Promise<Company[]> {
    return db.select().from(companies).orderBy(asc(companies.name));
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async createCompany(data: InsertCompany): Promise<Company> {
    const [company] = await db.insert(companies).values(data).returning();
    return company;
  }

  async updateCompany(id: number, data: Partial<InsertCompany>): Promise<Company | undefined> {
    const [company] = await db
      .update(companies)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning();
    return company;
  }

  async deleteCompany(id: number): Promise<void> {
    await db.delete(companies).where(eq(companies.id, id));
  }

  async getCompaniesByIds(ids: number[]): Promise<Company[]> {
    if (ids.length === 0) return [];
    return db.select().from(companies).where(inArray(companies.id, ids));
  }

  async getCompanyByName(name: string): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.name, name));
    return company;
  }

  // ─── Frameworks ────────────────────────────────────────────────────────────────

  async getFrameworks(): Promise<Framework[]> {
    return db.select().from(frameworks).orderBy(desc(frameworks.isActive), asc(frameworks.name));
  }

  async getFramework(id: number): Promise<Framework | undefined> {
    const [framework] = await db.select().from(frameworks).where(eq(frameworks.id, id));
    return framework;
  }

  async getActiveFramework(): Promise<Framework | undefined> {
    const [framework] = await db
      .select()
      .from(frameworks)
      .where(eq(frameworks.isActive, true));
    return framework;
  }

  async createFramework(data: InsertFramework): Promise<Framework> {
    const [framework] = await db.insert(frameworks).values(data).returning();
    return framework;
  }

  async updateFramework(id: number, data: Partial<InsertFramework>): Promise<Framework | undefined> {
    const [framework] = await db
      .update(frameworks)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(frameworks.id, id))
      .returning();
    return framework;
  }

  async activateFramework(id: number): Promise<void> {
    await db.update(frameworks).set({ isActive: false }).where(ne(frameworks.id, id));
    await db.update(frameworks).set({ isActive: true }).where(eq(frameworks.id, id));
  }

  async deleteFramework(id: number): Promise<void> {
    await db.delete(frameworks).where(eq(frameworks.id, id));
  }

  // ─── Framework Measures ────────────────────────────────────────────────────────

  async getMeasuresForFramework(frameworkId: number): Promise<FrameworkMeasure[]> {
    return db
      .select()
      .from(frameworkMeasures)
      .where(eq(frameworkMeasures.frameworkId, frameworkId))
      .orderBy(asc(frameworkMeasures.categoryNumber), asc(frameworkMeasures.displayOrder));
  }

  async createMeasure(data: InsertFrameworkMeasure): Promise<FrameworkMeasure> {
    const [measure] = await db.insert(frameworkMeasures).values(data).returning();
    return measure;
  }

  async updateMeasure(
    frameworkId: number,
    measureId: string,
    data: Partial<InsertFrameworkMeasure>
  ): Promise<FrameworkMeasure | undefined> {
    const [measure] = await db
      .update(frameworkMeasures)
      .set(data)
      .where(
        and(
          eq(frameworkMeasures.frameworkId, frameworkId),
          eq(frameworkMeasures.measureId, measureId)
        )
      )
      .returning();
    return measure;
  }

  async deleteMeasure(frameworkId: number, measureId: string): Promise<void> {
    await db
      .delete(frameworkMeasures)
      .where(
        and(
          eq(frameworkMeasures.frameworkId, frameworkId),
          eq(frameworkMeasures.measureId, measureId)
        )
      );
  }

  async bulkCreateMeasures(measures: InsertFrameworkMeasure[]): Promise<FrameworkMeasure[]> {
    if (measures.length === 0) return [];
    return db.insert(frameworkMeasures).values(measures).returning();
  }

  // ─── Documents (Company-Level) ────────────────────────────────────────────────
  // Documents are now stored at the COMPANY level (unique on company_id + url).
  // Once fetched, the same document content is reused across any framework evaluation.

  async upsertDiscoveredDocument(data: {
    companyId: number;
    url: string;
    title?: string;
    type: string;
    gateVerdict?: string;
    gateReason?: string;
    frameworkId?: number; // optional, for backward compat only
  }): Promise<Document> {
    const [doc] = await db
      .insert(documents)
      .values({
        companyId: data.companyId,
        frameworkId: data.frameworkId,
        url: data.url,
        title: data.title,
        type: data.type,
        gateVerdict: data.gateVerdict,
        gateReason: data.gateReason,
        gateVerdictAt: data.gateVerdict ? new Date() : undefined,
      })
      .onConflictDoUpdate({
        target: [documents.companyId, documents.url],
        set: {
          lastSeenAt: new Date(),
          title: data.title || sql`${documents.title}`,
          gateVerdict: data.gateVerdict || sql`${documents.gateVerdict}`,
          gateReason: data.gateReason || sql`${documents.gateReason}`,
        },
      })
      .returning();
    return doc;
  }

  async getAcceptedDocuments(companyId: number): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.gateVerdict, "accept"),
          ne(documents.fetchStatus, "dead")
        )
      )
      .orderBy(asc(documents.firstSeenAt), asc(documents.url));
  }

  async getFetchedDocuments(companyId: number): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.gateVerdict, "accept"),
          eq(documents.fetchStatus, "ok")
        )
      )
      .orderBy(asc(documents.firstSeenAt));
  }

  async getPendingDocuments(companyId: number): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.gateVerdict, "accept"),
          eq(documents.fetchStatus, "pending")
        )
      )
      .orderBy(asc(documents.firstSeenAt));
  }

  async clearDiscoveredDocuments(companyId: number): Promise<void> {
    // Delete all non-user-uploaded documents for this company
    await db
      .delete(documents)
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.userUploaded, false)
        )
      );
  }

  async recordFetchSuccess(companyId: number, url: string, content: string): Promise<void> {
    await db
      .update(documents)
      .set({
        fetchStatus: "ok",
        lastFetchedAt: new Date(),
        fetchFailureCount: 0,
        content,
        downloadedAt: new Date(),
      })
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.url, url)
        )
      );
  }

  async recordFetchFailure(companyId: number, url: string): Promise<void> {
    await db
      .update(documents)
      .set({
        fetchFailureCount: sql`${documents.fetchFailureCount} + 1`,
        fetchStatus: sql`CASE WHEN ${documents.fetchFailureCount} + 1 >= 3 THEN 'dead' ELSE 'pending' END`,
      })
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.url, url)
        )
      );
  }

  async recordGateVerdict(
    companyId: number,
    url: string,
    verdict: string,
    reason: string
  ): Promise<void> {
    await db
      .update(documents)
      .set({
        gateVerdict: verdict,
        gateReason: reason.slice(0, 200),
        gateVerdictAt: new Date(),
      })
      .where(
        and(
          eq(documents.companyId, companyId),
          eq(documents.url, url)
        )
      );
  }

  async getDocumentsForCompany(companyId: number): Promise<Document[]> {
    return db
      .select()
      .from(documents)
      .where(eq(documents.companyId, companyId))
      .orderBy(desc(documents.lastSeenAt));
  }

  // ─── Measure Scores ────────────────────────────────────────────────────────────

  async getMeasureScores(companyId: number): Promise<MeasureScore[]> {
    return db
      .select()
      .from(measureScores)
      .where(eq(measureScores.companyId, companyId))
      .orderBy(asc(measureScores.categoryNumber), asc(measureScores.displayOrder));
  }

  async clearMeasureScores(companyId: number): Promise<void> {
    await db.delete(measureScores).where(eq(measureScores.companyId, companyId));
  }

  async createMeasureScores(scores: InsertMeasureScore[]): Promise<void> {
    if (scores.length === 0) return;
    await db.insert(measureScores).values(scores);
  }

  // ─── Analysis Jobs ─────────────────────────────────────────────────────────────

  async createAnalysisJob(data: {
    companyId: number;
    companyName: string;
    batchId: number;
    frameworkId: number;
    priority?: number;
  }): Promise<AnalysisJob> {
    const [job] = await db
      .insert(analysisJobs)
      .values({
        companyId: data.companyId,
        companyName: data.companyName,
        batchId: data.batchId,
        frameworkId: data.frameworkId,
        priority: data.priority ?? 0,
      })
      .returning();
    return job;
  }

  async claimJob(workerId: string): Promise<AnalysisJob | undefined> {
    // First, try to recover stale claimed jobs (claimed > 25 minutes ago, allowing 20-min job timeout + buffer)
    const staleResult = await db.execute(sql`
      WITH stale AS (
        SELECT id FROM analysis_jobs
        WHERE status = 'claimed'
          AND claimed_at < NOW() - INTERVAL '25 minutes'
          AND attempts < 6
        ORDER BY claimed_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE analysis_jobs 
      SET status = 'claimed', 
          worker_id = ${workerId}, 
          claimed_at = NOW(), 
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id IN (SELECT id FROM stale)
      RETURNING *
    `);
    if (staleResult.rows[0]) {
      const row = staleResult.rows[0];
      console.log(`[Storage] Recovered stale job ${row.id} (${row.company_name}) from worker ${row.worker_id}`);
      return {
        id: row.id,
        companyId: row.company_id,
        companyName: row.company_name,
        batchId: row.batch_id,
        frameworkId: row.framework_id,
        status: row.status,
        workerId: row.worker_id,
        claimedAt: row.claimed_at,
        completedAt: row.completed_at,
        attempts: row.attempts,
        lastError: row.last_error,
        priority: row.priority,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      } as AnalysisJob;
    }

    // Then try to claim a pending job
    const result = await db.execute(sql`
      WITH claimed AS (
        SELECT id FROM analysis_jobs
        WHERE status = 'pending'
        ORDER BY priority DESC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      UPDATE analysis_jobs 
      SET status = 'claimed', 
          worker_id = ${workerId}, 
          claimed_at = NOW(), 
          attempts = attempts + 1,
          updated_at = NOW()
      WHERE id IN (SELECT id FROM claimed)
      RETURNING *
    `);
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      companyId: row.company_id,
      companyName: row.company_name,
      batchId: row.batch_id,
      frameworkId: row.framework_id,
      status: row.status,
      workerId: row.worker_id,
      claimedAt: row.claimed_at,
      completedAt: row.completed_at,
      attempts: row.attempts,
      lastError: row.last_error,
      priority: row.priority,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } as AnalysisJob;
  }

  async completeJob(jobId: number): Promise<void> {
    await db
      .update(analysisJobs)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(analysisJobs.id, jobId));
  }

  async failJob(jobId: number, error: string, maxAttempts: number = 3): Promise<void> {
    const [job] = await db
      .select()
      .from(analysisJobs)
      .where(eq(analysisJobs.id, jobId));

    if (job && job.attempts < maxAttempts) {
      await db
        .update(analysisJobs)
        .set({ status: "pending", lastError: error, updatedAt: new Date() })
        .where(eq(analysisJobs.id, jobId));
    } else {
      await db
        .update(analysisJobs)
        .set({ status: "failed", lastError: error, updatedAt: new Date() })
        .where(eq(analysisJobs.id, jobId));
    }
  }

  // ─── Batch Runs ────────────────────────────────────────────────────────────────

  async createBatchRun(data: { totalJobs: number; frameworkId: number; triggeredBy?: string }): Promise<BatchRun> {
    const [batch] = await db
      .insert(batchRuns)
      .values({
        totalJobs: data.totalJobs,
        frameworkId: data.frameworkId,
        triggeredBy: data.triggeredBy,
      })
      .returning();
    return batch;
  }

  async incrementBatchCompleted(batchId: number): Promise<BatchRun> {
    const [batch] = await db
      .update(batchRuns)
      .set({ completedJobs: sql`${batchRuns.completedJobs} + 1` })
      .where(eq(batchRuns.id, batchId))
      .returning();
    return batch;
  }

  async incrementBatchFailed(batchId: number): Promise<BatchRun> {
    const [batch] = await db
      .update(batchRuns)
      .set({ failedJobs: sql`${batchRuns.failedJobs} + 1` })
      .where(eq(batchRuns.id, batchId))
      .returning();
    return batch;
  }

  async completeBatchRun(batchId: number): Promise<void> {
    await db
      .update(batchRuns)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(batchRuns.id, batchId));
  }

  async cancelBatchRun(batchId: number): Promise<void> {
    await db
      .update(batchRuns)
      .set({ status: "cancelled", completedAt: new Date() })
      .where(eq(batchRuns.id, batchId));
    await db
      .update(analysisJobs)
      .set({ status: "failed", lastError: "Batch cancelled" })
      .where(and(eq(analysisJobs.batchId, batchId), eq(analysisJobs.status, "pending")));
  }

  async getActiveBatchRun(): Promise<BatchRun | undefined> {
    const [batch] = await db
      .select()
      .from(batchRuns)
      .where(eq(batchRuns.status, "running"))
      .orderBy(desc(batchRuns.startedAt))
      .limit(1);
    return batch;
  }

  async getRecentBatchRuns(limit: number = 10): Promise<BatchRun[]> {
    return db
      .select()
      .from(batchRuns)
      .orderBy(desc(batchRuns.startedAt))
      .limit(limit);
  }

  // ─── App Settings ──────────────────────────────────────────────────────────────

  async getSettings(): Promise<Record<string, string>> {
    const rows = await db.select().from(appSettings);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async getSetting(key: string): Promise<string | undefined> {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row?.value;
  }

  async upsertSettings(settings: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(settings)) {
      await db
        .insert(appSettings)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: appSettings.key,
          set: { value, updatedAt: new Date() },
        });
    }
  }

  // ─── Processing Errors ─────────────────────────────────────────────────────────

  async logProcessingError(data: {
    companyId?: number;
    companyName?: string;
    stage: string;
    error: string;
    details?: string;
  }): Promise<void> {
    await db.insert(processingErrors).values(data);
    await db.execute(sql`
      DELETE FROM processing_errors 
      WHERE id NOT IN (
        SELECT id FROM processing_errors ORDER BY created_at DESC LIMIT 500
      )
    `);
  }

  async getRecentErrors(limit: number = 50): Promise<typeof processingErrors.$inferSelect[]> {
    return db
      .select()
      .from(processingErrors)
      .orderBy(desc(processingErrors.createdAt))
      .limit(limit);
  }

  // ─── Company Terminology ───────────────────────────────────────────────────────

  async getCompanyTerminology(
    companyId: number,
    frameworkId: number
  ): Promise<CompanyTerminology | undefined> {
    const [row] = await db
      .select()
      .from(companyTerminology)
      .where(
        and(
          eq(companyTerminology.companyId, companyId),
          eq(companyTerminology.frameworkId, frameworkId)
        )
      );
    return row;
  }

  async upsertCompanyTerminology(data: {
    companyId: number;
    frameworkId: number;
    terms: {
      committees: string[];
      roles: string[];
      programmes: string[];
      productsAndPolicies: string[];
      otherTerms: string[];
    };
    sourceDocCount?: number;
    modelUsed?: string;
  }): Promise<void> {
    await db
      .insert(companyTerminology)
      .values({
        companyId: data.companyId,
        frameworkId: data.frameworkId,
        terms: data.terms,
        sourceDocCount: data.sourceDocCount,
        modelUsed: data.modelUsed,
      })
      .onConflictDoUpdate({
        target: [companyTerminology.companyId, companyTerminology.frameworkId],
        set: {
          terms: data.terms,
          sourceDocCount: data.sourceDocCount,
          modelUsed: data.modelUsed,
          createdAt: new Date(),
        },
      });
  }

  // ─── Summary Cache ─────────────────────────────────────────────────────────────

  async getCachedSummary(companyId: number, documentHash: string): Promise<string | undefined> {
    const [row] = await db
      .select()
      .from(summaryCache)
      .where(
        and(eq(summaryCache.companyId, companyId), eq(summaryCache.documentHash, documentHash))
      );
    return row?.summary;
  }

  async cacheSummary(data: {
    companyId: number;
    documentHash: string;
    summary: string;
    summarizerModel?: string;
  }): Promise<void> {
    await db
      .insert(summaryCache)
      .values(data)
      .onConflictDoUpdate({
        target: [summaryCache.companyId, summaryCache.documentHash],
        set: { summary: data.summary, summarizerModel: data.summarizerModel },
      });
  }

  // ─── Snapshots ─────────────────────────────────────────────────────────────────

  async createSnapshot(data: {
    companyId: number;
    frameworkId?: number;
    frameworkName?: string;
    totalScore?: number;
    summary?: string;
    measureScoresData?: any;
    documentCount?: number;
    label?: string;
  }): Promise<Snapshot> {
    const [snapshot] = await db.insert(snapshots).values(data).returning();
    return snapshot;
  }

  async getSnapshots(companyId?: number): Promise<Snapshot[]> {
    if (companyId) {
      return db
        .select()
        .from(snapshots)
        .where(eq(snapshots.companyId, companyId))
        .orderBy(desc(snapshots.createdAt));
    }
    return db.select().from(snapshots).orderBy(desc(snapshots.createdAt));
  }

  async getSnapshot(id: number): Promise<Snapshot | undefined> {
    const [snapshot] = await db.select().from(snapshots).where(eq(snapshots.id, id));
    return snapshot;
  }

  async deleteSnapshot(id: number): Promise<void> {
    await db.delete(snapshots).where(eq(snapshots.id, id));
  }

  // ─── Trusted Sources ───────────────────────────────────────────────────────────

  async getTrustedSources(): Promise<TrustedSource[]> {
    return db.select().from(trustedSources).orderBy(asc(trustedSources.domain));
  }

  async createTrustedSource(data: { domain: string; description?: string }): Promise<TrustedSource> {
    const [source] = await db.insert(trustedSources).values(data).returning();
    return source;
  }

  async updateTrustedSource(id: number, data: Partial<{ domain: string; description: string; isActive: boolean }>): Promise<TrustedSource | undefined> {
    const [source] = await db.update(trustedSources).set(data).where(eq(trustedSources.id, id)).returning();
    return source;
  }

  async deleteTrustedSource(id: number): Promise<void> {
    await db.delete(trustedSources).where(eq(trustedSources.id, id));
  }

  // ─── Company Lists ─────────────────────────────────────────────────────────────

  async getCompanyLists(): Promise<CompanyList[]> {
    return db.select().from(companyLists).orderBy(desc(companyLists.createdAt));
  }

  async createCompanyList(data: { name: string; description?: string; companyIds: number[]; sourceFilename?: string }): Promise<CompanyList> {
    const [list] = await db.insert(companyLists).values(data).returning();
    return list;
  }

  async deleteCompanyList(id: number): Promise<void> {
    await db.delete(companyLists).where(eq(companyLists.id, id));
  }

  // ─── Reset / Clear Results ──────────────────────────────────────────────────

  async resetCompany(companyId: number): Promise<void> {
    // Clear scores, summary, and reset status
    await db.delete(measureScores).where(eq(measureScores.companyId, companyId));
    await db
      .update(companies)
      .set({
        totalScore: null,
        summary: null,
        analysisStatus: "idle",
        updatedAt: new Date(),
      })
      .where(eq(companies.id, companyId));
  }

  async resetCompanies(companyIds: number[]): Promise<number> {
    if (companyIds.length === 0) return 0;
    await db.delete(measureScores).where(inArray(measureScores.companyId, companyIds));
    await db
      .update(companies)
      .set({
        totalScore: null,
        summary: null,
        analysisStatus: "idle",
        updatedAt: new Date(),
      })
      .where(inArray(companies.id, companyIds));
    return companyIds.length;
  }

  // ─── Analysis Results (Saved Completed Analyses) ──────────────────────────────

  async getAnalysisResults(): Promise<AnalysisResult[]> {
    return db
      .select()
      .from(analysisResults)
      .orderBy(desc(analysisResults.completedAt));
  }

  async getAnalysisResult(id: number): Promise<AnalysisResult | undefined> {
    const [result] = await db
      .select()
      .from(analysisResults)
      .where(eq(analysisResults.id, id));
    return result;
  }

  async getAnalysisResultByShareToken(token: string): Promise<AnalysisResult | undefined> {
    const [result] = await db
      .select()
      .from(analysisResults)
      .where(eq(analysisResults.shareToken, token));
    return result;
  }

  async createAnalysisResult(data: {
    frameworkId: number;
    frameworkName: string;
    listId?: number;
    listName?: string;
    batchId?: number;
    companyCount: number;
    averageScore?: number;
    resultsData: any;
    shareToken: string;
  }): Promise<AnalysisResult> {
    const [result] = await db
      .insert(analysisResults)
      .values(data)
      .returning();
    return result;
  }

  async deleteAnalysisResult(id: number): Promise<void> {
    await db.delete(analysisResults).where(eq(analysisResults.id, id));
  }
}

export const storage = new Storage();
