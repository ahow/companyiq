import express from "express";
import cors from "cors";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { runStartupMigrations } from "./db.js";
import apiRouter from "./routes/api.js";
import { storage } from "./storage.js";
import { runAnalysisPipeline } from "./lib/pipeline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || "3000");
const PASSWORD = process.env.APP_PASSWORD || "football";

// ─── Middleware ──────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// ─── Simple Password Auth ────────────────────────────────────────────────────

// Session-based auth using a cookie
const COOKIE_NAME = "ciq_auth";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

function isAuthenticated(req: express.Request): boolean {
  // Check cookie
  const cookies = req.headers.cookie?.split(";").reduce((acc, c) => {
    const [key, val] = c.trim().split("=");
    acc[key] = val;
    return acc;
  }, {} as Record<string, string>);

  if (cookies?.[COOKIE_NAME] === "authenticated") return true;

  // Check header (for API clients)
  const authHeader = req.headers["x-auth-password"];
  if (authHeader === PASSWORD) return true;

  return false;
}

// Auth middleware - skip for login endpoint and static assets
app.use((req, res, next) => {
  // Allow login endpoint
  if (req.path === "/api/login") return next();
  if (req.path === "/api/health") return next();

  // Allow static assets
  if (req.path.startsWith("/assets/") || req.path === "/favicon.ico") return next();

  // Check auth for API routes
  if (req.path.startsWith("/api/")) {
    if (!isAuthenticated(req)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
  }

  // For non-API routes (SPA), check auth
  if (!req.path.startsWith("/api/") && !isAuthenticated(req)) {
    // Serve login page for unauthenticated HTML requests
    if (req.accepts("html")) {
      return res.sendFile(path.join(__dirname, "../../client/dist/index.html"));
    }
    return res.status(401).json({ error: "Unauthorized" });
  }

  next();
});

// Login endpoint
app.post("/api/login", (req, res) => {
  const { password } = req.body;
  if (password === PASSWORD) {
    res.setHeader(
      "Set-Cookie",
      `${COOKIE_NAME}=authenticated; Path=/; Max-Age=${COOKIE_MAX_AGE / 1000}; HttpOnly; SameSite=Lax`
    );
    return res.json({ success: true });
  }
  return res.status(401).json({ error: "Invalid password" });
});

// Logout endpoint
app.post("/api/logout", (req, res) => {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  res.json({ success: true });
});

// ─── API Routes ──────────────────────────────────────────────────────────────

app.use("/api", apiRouter);

// ─── Static Files (SPA) ─────────────────────────────────────────────────────

const clientDist = path.join(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res) => {
  res.sendFile(path.join(clientDist, "index.html"));
});

// ─── Start Server ────────────────────────────────────────────────────────────

// ─── Embedded Worker ────────────────────────────────────────────────────────

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;
const POLL_INTERVAL = 5000;
const MAX_CONCURRENT = parseInt(process.env.WORKER_CONCURRENCY || "3");
let workerRunning = true;
let activeJobs = 0;

const JOB_TIMEOUT = 15 * 60 * 1000; // 15 minutes max per job

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout after ${ms/1000}s: ${label}`)), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

async function executeJob(job: any): Promise<void> {
  activeJobs++;
  console.log(`[${WORKER_ID}] Claimed job ${job.id} for ${job.companyName} (attempt ${job.attempts})`);

  try {
    const company = await storage.getCompany(job.companyId);
    if (!company) throw new Error("Company not found");

    const framework = await storage.getFramework(job.frameworkId!);
    if (!framework) throw new Error("Framework not found");

    const measures = await storage.getMeasuresForFramework(framework.id);
    if (measures.length === 0) throw new Error("No measures in framework");

    const result = await withTimeout(
      runAnalysisPipeline({
        company,
        framework,
        measures,
        cancelCheck: () => !workerRunning,
      }),
      JOB_TIMEOUT,
      `Pipeline for ${job.companyName}`
    );

    if (result.success) {
      await storage.completeJob(job.id);
      if (job.batchId) {
        const batch = await storage.incrementBatchCompleted(job.batchId);
        if (batch.completedJobs + batch.failedJobs >= batch.totalJobs) {
          await storage.completeBatchRun(batch.id);
          console.log(`[${WORKER_ID}] Batch ${batch.id} completed`);
        }
      }
      console.log(`[${WORKER_ID}] Job ${job.id} completed (${job.companyName}: ${result.analysis?.scorePercentage}%)`);
    } else {
      throw new Error(result.error || "Pipeline returned failure");
    }
  } catch (error: any) {
    console.error(`[${WORKER_ID}] Job ${job.id} failed: ${error.message}`);
    await storage.failJob(job.id, error.message);
    if (job.batchId) {
      const batch = await storage.incrementBatchFailed(job.batchId);
      if (batch.completedJobs + batch.failedJobs >= batch.totalJobs) {
        await storage.completeBatchRun(batch.id);
      }
    }
  } finally {
    activeJobs--;
  }
}

async function tryClaimAndProcess(): Promise<boolean> {
  if (activeJobs >= MAX_CONCURRENT) return false;

  const job = await storage.claimJob(WORKER_ID);
  if (!job) return false;

  // Fire-and-forget: don't await the job execution
  executeJob(job).catch((err) => {
    console.error(`[${WORKER_ID}] Unhandled job error: ${err.message}`);
  });

  return true;
}

async function workerPollLoop() {
  console.log(`[${WORKER_ID}] Starting embedded worker (concurrency: ${MAX_CONCURRENT})`);
  let pollCount = 0;

  while (workerRunning) {
    try {
      pollCount++;
      if (pollCount % 12 === 1) {
        console.log(`[${WORKER_ID}] Poll #${pollCount}, activeJobs=${activeJobs}/${MAX_CONCURRENT}, workerRunning=${workerRunning}`);
      }

      // Try to claim up to MAX_CONCURRENT jobs
      if (activeJobs < MAX_CONCURRENT) {
        const claimed = await tryClaimAndProcess();
        if (!claimed) {
          // No jobs available, wait before polling again
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        } else {
          // Successfully claimed, try to claim another immediately
          await new Promise((resolve) => setTimeout(resolve, 200));
          continue;
        }
      } else {
        // At capacity, wait before checking again
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error: any) {
      console.error(`[${WORKER_ID}] Poll error: ${error.message}`);
      console.error(`[${WORKER_ID}] Poll error stack: ${error.stack}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL * 2));
    }
  }
}

// ─── Start Server ────────────────────────────────────────────────────────────

async function start() {
  try {
    console.log("[Server] Running startup migrations...");
    await runStartupMigrations();
    console.log("[Server] Migrations complete");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] CompanyIQ v2.0 running on port ${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || "development"}`);
    });

    // Start embedded worker after server is listening
    workerPollLoop();
  } catch (error) {
    console.error("[Server] Failed to start:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => {
  console.log("[Server] SIGTERM received, shutting down worker");
  workerRunning = false;
});

start();
