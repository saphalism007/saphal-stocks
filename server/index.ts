import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import { config, ROOT } from "./config.ts";
import "./db.ts";
import { seedReference } from "./seed.ts";
import { authRouter, authMiddleware, requireAuth, sameOrigin } from "./routes/auth.ts";
import { marketRouter } from "./routes/market.ts";
import { portfolioRouter } from "./routes/portfolio.ts";
import { aiRouter } from "./routes/ai.ts";
import { wealthRouter } from "./routes/wealth.ts";
import { systemRouter } from "./routes/system.ts";
import { startScheduler, onJobDone } from "./ingest/jobs.ts";
import { evaluateAlerts } from "./lib/alerts.ts";

seedReference();

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", "loopback");
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (config.isProd) res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());
app.use(authMiddleware);
app.use("/api", sameOrigin);

app.get("/api/health", (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use("/api/auth", authRouter);
app.use("/api", requireAuth, marketRouter, portfolioRouter, aiRouter, wealthRouter, systemRouter);
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

const dist = join(ROOT, "dist");
if (existsSync(dist)) {
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(join(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") });
  const status = (err as { status?: number }).status ?? 500;
  const message = err instanceof Error ? err.message : String(err);
  if (status >= 500) console.error("[api]", message);
  res.status(status).json({ error: status >= 500 ? `Server error: ${message}` : message });
});

// Re-evaluate alerts whenever fresh market data lands.
onJobDone((job) => { if (["listing", "details", "news"].includes(job)) { try { const n = evaluateAlerts(); if (n) console.log(`[alerts] ${n} fired`); } catch (e) { console.error(e); } } });

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Saphal Stocks API on http://127.0.0.1:${config.port}  (AI: ${config.ai.provider}${config.ai.hasKey ? "" : ", no key"})`);
  if (process.env.NO_SCHEDULER !== "1") startScheduler();
});
