import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";

// ─── Companies ───────────────────────────────────────────────────────────────

export const companies = pgTable(
  "companies",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    isin: text("isin"),
    domain: text("domain"),
    sector: text("sector"),
    country: text("country"),
    totalScore: integer("total_score"),
    summary: text("summary"),
    analysisStatus: text("analysis_status").notNull().default("idle"),
    logoUrl: text("logo_url"),
    pinnedDocuments: jsonb("pinned_documents").$type<string[]>(),
    discoveryDiagnostics: jsonb("discovery_diagnostics"),
    discoveryHistory: jsonb("discovery_history").$type<Array<{
      at: string;
      totalCandidates: number;
      acceptedByGate: number;
      finalCount: number;
      totalScore: number;
    }>>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    nameIdx: index("companies_name_idx").on(table.name),
    statusIdx: index("companies_status_idx").on(table.analysisStatus),
  })
);

export const insertCompanySchema = createInsertSchema(companies);
export const selectCompanySchema = createSelectSchema(companies);
export type Company = typeof companies.$inferSelect;
export type InsertCompany = typeof companies.$inferInsert;

// ─── Frameworks ──────────────────────────────────────────────────────────────

export const frameworks = pgTable("frameworks", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  version: text("version").default("v1.0"),
  topicDescription: text("topic_description"),
  analystRole: text("analyst_role"),
  scoringMode: text("scoring_mode").notNull().default("binary"),
  negativeKeywords: jsonb("negative_keywords").$type<string[]>(),
  negativeDomains: jsonb("negative_domains").$type<string[]>(),
  knownDisclosureUrls: jsonb("known_disclosure_urls").$type<string[]>(),
  searchTemplates: jsonb("search_templates").$type<string[]>(),
  isActive: boolean("is_active").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertFrameworkSchema = createInsertSchema(frameworks);
export const selectFrameworkSchema = createSelectSchema(frameworks);
export type Framework = typeof frameworks.$inferSelect;
export type InsertFramework = typeof frameworks.$inferInsert;

// ─── Framework Measures ──────────────────────────────────────────────────────

export const frameworkMeasures = pgTable(
  "framework_measures",
  {
    id: serial("id").primaryKey(),
    frameworkId: integer("framework_id")
      .notNull()
      .references(() => frameworks.id, { onDelete: "cascade" }),
    measureId: text("measure_id").notNull(),
    title: text("title").notNull(),
    definition: text("definition"),
    category: text("category").notNull(),
    categoryNumber: integer("category_number").notNull(),
    displayOrder: integer("display_order").notNull(),
    scoringGuidance: jsonb("scoring_guidance").$type<{
      yes?: string;
      no?: string;
      partial?: string;
    }>(),
    evidenceKeywords: jsonb("evidence_keywords").$type<string[]>(),
    referenceUrls: jsonb("reference_urls").$type<string[]>(),
    querySeeds: jsonb("query_seeds").$type<string[]>(),
  },
  (table) => ({
    frameworkMeasureUnique: uniqueIndex("framework_measure_unique").on(
      table.frameworkId,
      table.measureId
    ),
    frameworkIdx: index("measures_framework_idx").on(table.frameworkId),
  })
);

export const insertFrameworkMeasureSchema = createInsertSchema(frameworkMeasures);
export const selectFrameworkMeasureSchema = createSelectSchema(frameworkMeasures);
export type FrameworkMeasure = typeof frameworkMeasures.$inferSelect;
export type InsertFrameworkMeasure = typeof frameworkMeasures.$inferInsert;

// ─── Documents ───────────────────────────────────────────────────────────────

export const documents = pgTable(
  "documents",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    frameworkId: integer("framework_id").references(() => frameworks.id),
    url: text("url").notNull(),
    title: text("title"),
    type: text("type").notNull(), // 'pdf' | 'html'
    publicationYear: integer("publication_year"),
    content: text("content"),
    downloadedAt: timestamp("downloaded_at"),
    userUploaded: boolean("user_uploaded").default(false).notNull(),
    uploadedFilename: text("uploaded_filename"),
    firstSeenAt: timestamp("first_seen_at").defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
    lastFetchedAt: timestamp("last_fetched_at"),
    fetchStatus: text("fetch_status").notNull().default("pending"), // 'pending' | 'ok' | 'dead'
    fetchFailureCount: integer("fetch_failure_count").notNull().default(0),
    gateVerdict: text("gate_verdict"), // 'accept' | 'reject'
    gateReason: text("gate_reason"),
    gateVerdictAt: timestamp("gate_verdict_at"),
  },
  (table) => ({
    companyFrameworkUrlUnique: uniqueIndex("documents_company_framework_url_unique")
      .on(table.companyId, table.frameworkId, table.url),
    companyStatusIdx: index("documents_company_status_idx").on(
      table.companyId,
      table.fetchStatus
    ),
  })
);

export const insertDocumentSchema = createInsertSchema(documents);
export const selectDocumentSchema = createSelectSchema(documents);
export type Document = typeof documents.$inferSelect;
export type InsertDocument = typeof documents.$inferInsert;

// ─── Measure Scores ──────────────────────────────────────────────────────────

export const measureScores = pgTable(
  "measure_scores",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    frameworkId: integer("framework_id").references(() => frameworks.id),
    measureId: text("measure_id").notNull(),
    category: text("category"),
    categoryNumber: integer("category_number"),
    title: text("title"),
    definition: text("definition"),
    score: integer("score").notNull().default(0),
    coverage: text("coverage"),
    confidence: text("confidence"), // 'High' | 'Medium' | 'Low'
    evidenceSummary: text("evidence_summary"),
    quotes: jsonb("quotes").$type<Array<{ text: string; source: string; page?: number }>>(),
    verdict: text("verdict"), // 'Yes' | 'No' | 'Partial'
    verdictNuance: text("verdict_nuance"),
    analyzedAt: timestamp("analyzed_at").defaultNow().notNull(),
    displayOrder: integer("display_order"),
  },
  (table) => ({
    companyMeasureIdx: index("scores_company_measure_idx").on(
      table.companyId,
      table.measureId
    ),
    companyFrameworkIdx: index("scores_company_framework_idx").on(
      table.companyId,
      table.frameworkId
    ),
  })
);

export const insertMeasureScoreSchema = createInsertSchema(measureScores);
export const selectMeasureScoreSchema = createSelectSchema(measureScores);
export type MeasureScore = typeof measureScores.$inferSelect;
export type InsertMeasureScore = typeof measureScores.$inferInsert;

// ─── Analysis Jobs (Queue) ───────────────────────────────────────────────────

export const analysisJobs = pgTable(
  "analysis_jobs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    companyName: text("company_name").notNull(),
    batchId: integer("batch_id").references(() => batchRuns.id),
    frameworkId: integer("framework_id").references(() => frameworks.id),
    status: text("status").notNull().default("pending"), // 'pending' | 'claimed' | 'completed' | 'failed'
    workerId: text("worker_id"),
    claimedAt: timestamp("claimed_at"),
    completedAt: timestamp("completed_at"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    priority: integer("priority").notNull().default(0),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    statusPriorityIdx: index("jobs_status_priority_idx").on(
      table.status,
      table.priority,
      table.createdAt
    ),
  })
);

export type AnalysisJob = typeof analysisJobs.$inferSelect;
export type InsertAnalysisJob = typeof analysisJobs.$inferInsert;

// ─── Batch Runs ──────────────────────────────────────────────────────────────

export const batchRuns = pgTable("batch_runs", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("running"), // 'running' | 'completed' | 'cancelled' | 'failed'
  totalJobs: integer("total_jobs").notNull(),
  completedJobs: integer("completed_jobs").notNull().default(0),
  failedJobs: integer("failed_jobs").notNull().default(0),
  frameworkId: integer("framework_id").references(() => frameworks.id),
  triggeredBy: text("triggered_by"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

export type BatchRun = typeof batchRuns.$inferSelect;
export type InsertBatchRun = typeof batchRuns.$inferInsert;

// ─── App Settings ────────────────────────────────────────────────────────────

export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type AppSetting = typeof appSettings.$inferSelect;

// ─── Processing Errors ───────────────────────────────────────────────────────

export const processingErrors = pgTable(
  "processing_errors",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id"),
    companyName: text("company_name"),
    stage: text("stage").notNull(), // 'search' | 'fetch' | 'summarize' | 'score' | 'save'
    error: text("error").notNull(),
    details: text("details"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    createdAtIdx: index("errors_created_at_idx").on(table.createdAt),
  })
);

export type ProcessingError = typeof processingErrors.$inferSelect;

// ─── Company Terminology ─────────────────────────────────────────────────────

export const companyTerminology = pgTable(
  "company_terminology",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    frameworkId: integer("framework_id")
      .notNull()
      .references(() => frameworks.id, { onDelete: "cascade" }),
    terms: jsonb("terms").$type<{
      committees: string[];
      roles: string[];
      programmes: string[];
      productsAndPolicies: string[];
      otherTerms: string[];
    }>().notNull(),
    sourceDocCount: integer("source_doc_count"),
    modelUsed: text("model_used"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyFrameworkUnique: uniqueIndex("terminology_company_framework_unique").on(
      table.companyId,
      table.frameworkId
    ),
  })
);

export type CompanyTerminology = typeof companyTerminology.$inferSelect;

// ─── Summary Cache ───────────────────────────────────────────────────────────

export const summaryCache = pgTable(
  "summary_cache",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    documentHash: text("document_hash").notNull(),
    summary: text("summary").notNull(),
    summarizerModel: text("summarizer_model"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyHashUnique: uniqueIndex("summary_cache_company_hash_unique").on(
      table.companyId,
      table.documentHash
    ),
  })
);

export type SummaryCache = typeof summaryCache.$inferSelect;

// ─── Snapshots ───────────────────────────────────────────────────────────────

export const snapshots = pgTable(
  "snapshots",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    frameworkId: integer("framework_id").references(() => frameworks.id),
    frameworkName: text("framework_name"),
    totalScore: integer("total_score"),
    summary: text("summary"),
    measureScoresData: jsonb("measure_scores_data"),
    documentCount: integer("document_count"),
    label: text("label"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    companyIdx: index("snapshots_company_idx").on(table.companyId),
  })
);

export type Snapshot = typeof snapshots.$inferSelect;

// ─── Trusted Sources ─────────────────────────────────────────────────────────

export const trustedSources = pgTable("trusted_sources", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull(),
  description: text("description"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TrustedSource = typeof trustedSources.$inferSelect;

// ─── Company Lists ───────────────────────────────────────────────────────────

export const companyLists = pgTable("company_lists", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  companyIds: jsonb("company_ids").$type<number[]>().notNull(),
  isActive: boolean("is_active").default(false).notNull(),
  sourceFilename: text("source_filename"),
  importedAt: timestamp("imported_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CompanyList = typeof companyLists.$inferSelect;
export type InsertCompanyList = typeof companyLists.$inferInsert;
