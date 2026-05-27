import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { runStartupMigrations } from "./db.js";
import apiRouter from "./routes/api.js";

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

async function start() {
  try {
    console.log("[Server] Running startup migrations...");
    await runStartupMigrations();
    console.log("[Server] Migrations complete");

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`[Server] CompanyIQ v2.0 running on port ${PORT}`);
      console.log(`[Server] Environment: ${process.env.NODE_ENV || "development"}`);
    });
  } catch (error) {
    console.error("[Server] Failed to start:", error);
    process.exit(1);
  }
}

start();
