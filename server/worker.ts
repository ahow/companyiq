import { runStartupMigrations } from "./db.js";
import { storage } from "./storage.js";
import { runAnalysisPipeline } from "./lib/pipeline.js";
import crypto from "crypto";

const WORKER_ID = `worker-${crypto.randomUUID().slice(0, 8)}`;
const POLL_INTERVAL = 5000; // 5 seconds
const MAX_CONCURRENT = parseInt(process.env.WORKER_CONCURRENCY || "2");

let running = true;
let activeJobs = 0;

async function processNextJob(): Promise<boolean> {
  if (activeJobs >= MAX_CONCURRENT) return false;

  const job = await storage.claimJob(WORKER_ID);
  if (!job) return false;

  activeJobs++;
  console.log(`[${WORKER_ID}] Claimed job ${job.id} for ${job.companyName} (attempt ${job.attempts})`);

  try {
    const company = await storage.getCompany(job.companyId);
    if (!company) throw new Error("Company not found");

    const framework = await storage.getFramework(job.frameworkId!);
    if (!framework) throw new Error("Framework not found");

    const measures = await storage.getMeasuresForFramework(framework.id);
    if (measures.length === 0) throw new Error("No measures in framework");

    const result = await runAnalysisPipeline({
      company,
      framework,
      measures,
      cancelCheck: () => !running,
    });

    if (result.success) {
      await storage.completeJob(job.id);
      if (job.batchId) {
        const batch = await storage.incrementBatchCompleted(job.batchId);
        // Check if batch is complete
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

  return true;
}

async function pollLoop() {
  console.log(`[${WORKER_ID}] Starting poll loop (concurrency: ${MAX_CONCURRENT})`);

  while (running) {
    try {
      const claimed = await processNextJob();
      if (!claimed) {
        // No jobs available, wait before polling again
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      } else {
        // Job claimed, immediately try for another (up to concurrency limit)
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } catch (error: any) {
      console.error(`[${WORKER_ID}] Poll error: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL * 2));
    }
  }

  console.log(`[${WORKER_ID}] Worker shutting down`);
}

async function start() {
  console.log(`[${WORKER_ID}] CompanyIQ Worker starting...`);

  try {
    await runStartupMigrations();
    console.log(`[${WORKER_ID}] Database ready`);
  } catch (error) {
    console.error(`[${WORKER_ID}] Failed to connect to database:`, error);
    process.exit(1);
  }

  // Graceful shutdown
  process.on("SIGTERM", () => {
    console.log(`[${WORKER_ID}] SIGTERM received, shutting down gracefully`);
    running = false;
  });

  process.on("SIGINT", () => {
    console.log(`[${WORKER_ID}] SIGINT received, shutting down gracefully`);
    running = false;
  });

  await pollLoop();
}

start();
