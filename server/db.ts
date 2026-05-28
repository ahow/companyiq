import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../shared/schema.js";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

export const db = drizzle(pool, { schema });

export async function runStartupMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Idempotent DDL statements to ensure schema is up-to-date
    // These run at boot of both web and worker processes
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        isin TEXT,
        domain TEXT,
        sector TEXT,
        country TEXT,
        total_score INTEGER,
        summary TEXT,
        analysis_status TEXT NOT NULL DEFAULT 'idle',
        logo_url TEXT,
        pinned_documents JSONB,
        discovery_diagnostics JSONB,
        discovery_history JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS frameworks (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT DEFAULT 'v1.0',
        topic_description TEXT,
        analyst_role TEXT,
        scoring_mode TEXT NOT NULL DEFAULT 'binary',
        negative_keywords JSONB,
        negative_domains JSONB,
        known_disclosure_urls JSONB,
        search_templates JSONB,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS framework_measures (
        id SERIAL PRIMARY KEY,
        framework_id INTEGER NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
        measure_id TEXT NOT NULL,
        title TEXT NOT NULL,
        definition TEXT,
        category TEXT NOT NULL,
        category_number INTEGER NOT NULL,
        display_order INTEGER NOT NULL,
        scoring_guidance JSONB,
        evidence_keywords JSONB,
        reference_urls JSONB,
        query_seeds JSONB,
        UNIQUE(framework_id, measure_id)
      );

      CREATE TABLE IF NOT EXISTS documents (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        framework_id INTEGER REFERENCES frameworks(id),
        url TEXT NOT NULL,
        title TEXT,
        type TEXT NOT NULL,
        publication_year INTEGER,
        content TEXT,
        downloaded_at TIMESTAMPTZ,
        user_uploaded BOOLEAN NOT NULL DEFAULT FALSE,
        uploaded_filename TEXT,
        first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_fetched_at TIMESTAMPTZ,
        fetch_status TEXT NOT NULL DEFAULT 'pending',
        fetch_failure_count INTEGER NOT NULL DEFAULT 0,
        gate_verdict TEXT,
        gate_reason TEXT,
        gate_verdict_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS measure_scores (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        framework_id INTEGER REFERENCES frameworks(id),
        measure_id TEXT NOT NULL,
        category TEXT,
        category_number INTEGER,
        title TEXT,
        definition TEXT,
        score INTEGER NOT NULL DEFAULT 0,
        coverage TEXT,
        confidence TEXT,
        evidence_summary TEXT,
        quotes JSONB,
        verdict TEXT,
        verdict_nuance TEXT,
        analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        display_order INTEGER
      );

      CREATE TABLE IF NOT EXISTS batch_runs (
        id SERIAL PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'running',
        total_jobs INTEGER NOT NULL,
        completed_jobs INTEGER NOT NULL DEFAULT 0,
        failed_jobs INTEGER NOT NULL DEFAULT 0,
        framework_id INTEGER REFERENCES frameworks(id),
        triggered_by TEXT,
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS analysis_jobs (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        company_name TEXT NOT NULL,
        batch_id INTEGER REFERENCES batch_runs(id),
        framework_id INTEGER REFERENCES frameworks(id),
        status TEXT NOT NULL DEFAULT 'pending',
        worker_id TEXT,
        claimed_at TIMESTAMPTZ,
        completed_at TIMESTAMPTZ,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS processing_errors (
        id SERIAL PRIMARY KEY,
        company_id INTEGER,
        company_name TEXT,
        stage TEXT NOT NULL,
        error TEXT NOT NULL,
        details TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS company_terminology (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        framework_id INTEGER NOT NULL REFERENCES frameworks(id) ON DELETE CASCADE,
        terms JSONB NOT NULL DEFAULT '{}',
        source_doc_count INTEGER,
        model_used TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(company_id, framework_id)
      );

      CREATE TABLE IF NOT EXISTS summary_cache (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        document_hash TEXT NOT NULL,
        summary TEXT NOT NULL,
        summarizer_model TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(company_id, document_hash)
      );

      CREATE TABLE IF NOT EXISTS snapshots (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        framework_id INTEGER REFERENCES frameworks(id),
        framework_name TEXT,
        total_score INTEGER,
        summary TEXT,
        measure_scores_data JSONB,
        document_count INTEGER,
        label TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS trusted_sources (
        id SERIAL PRIMARY KEY,
        domain TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS company_lists (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        company_ids JSONB NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT FALSE,
        source_filename TEXT,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS companies_name_idx ON companies(name);
      CREATE INDEX IF NOT EXISTS companies_status_idx ON companies(analysis_status);
      CREATE INDEX IF NOT EXISTS measures_framework_idx ON framework_measures(framework_id);
      CREATE INDEX IF NOT EXISTS documents_company_status_idx ON documents(company_id, fetch_status);
      CREATE INDEX IF NOT EXISTS scores_company_measure_idx ON measure_scores(company_id, measure_id);
      CREATE INDEX IF NOT EXISTS scores_company_framework_idx ON measure_scores(company_id, framework_id);
      CREATE INDEX IF NOT EXISTS jobs_status_priority_idx ON analysis_jobs(status, priority, created_at);
      CREATE INDEX IF NOT EXISTS errors_created_at_idx ON processing_errors(created_at);
      CREATE INDEX IF NOT EXISTS snapshots_company_idx ON snapshots(company_id);

      -- Migration: change documents unique index from (company_id, framework_id, url) to (company_id, url)
      DROP INDEX IF EXISTS documents_company_framework_url_unique;
      -- Create new unique index (idempotent)
      CREATE UNIQUE INDEX IF NOT EXISTS documents_company_url_unique ON documents(company_id, url);

      -- Analysis Results (saved completed analyses)
      CREATE TABLE IF NOT EXISTS analysis_results (
        id SERIAL PRIMARY KEY,
        framework_id INTEGER REFERENCES frameworks(id),
        framework_name TEXT NOT NULL,
        list_id INTEGER,
        list_name TEXT,
        batch_id INTEGER REFERENCES batch_runs(id),
        company_count INTEGER NOT NULL,
        average_score INTEGER,
        results_data JSONB NOT NULL,
        share_token TEXT,
        completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS analysis_results_completed_at_idx ON analysis_results(completed_at);
      CREATE UNIQUE INDEX IF NOT EXISTS analysis_results_share_token_idx ON analysis_results(share_token);
    `);

    console.log("[DB] Startup migrations completed successfully");
  } catch (error) {
    console.error("[DB] Startup migration error:", error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getPool() {
  return pool;
}

export async function closePool() {
  await pool.end();
}
