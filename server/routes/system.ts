import { Router } from "express";
import { z } from "zod";
import { join } from "node:path";
import { all, get, run, db, getSetting, setSetting } from "../db.ts";
import { jobStates, enqueue, queueDailyRefresh, syncListing, syncHistory, syncIndices, syncNews, syncForex, syncAllDetails, syncIssues, syncFunds } from "../ingest/jobs.ts";
import { evaluateAlerts } from "../lib/alerts.ts";
import { DEFAULT_FEES } from "../../shared/costs.ts";
import { config, setEnvValue, DATA_DIR } from "../config.ts";
import { readVault } from "../lib/vault.ts";
import { politeFetch } from "../lib/fetcher.ts";

export const systemRouter = Router();

systemRouter.get("/data/status", (_req, res) => {
  res.json({
    freshness: all("SELECT * FROM data_freshness ORDER BY dataset"),
    jobs: jobStates(),
    runs: all("SELECT * FROM ingest_runs ORDER BY id DESC LIMIT 40"),
    counts: {
      companies: get<{ n: number }>("SELECT COUNT(*) n FROM companies")!.n,
      withSector: get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE sector IS NOT NULL")!.n,
      priceRows: get<{ n: number }>("SELECT COUNT(*) n FROM prices")!.n,
      symbolsWithHistory: get<{ n: number }>("SELECT COUNT(DISTINCT symbol) n FROM prices")!.n,
      firstPriceDate: get<{ d: string }>("SELECT MIN(date) d FROM prices")?.d ?? null,
      lastPriceDate: get<{ d: string }>("SELECT MAX(date) d FROM prices")?.d ?? null,
      indexRows: get<{ n: number }>("SELECT COUNT(*) n FROM indices")!.n,
      reports: get<{ n: number }>("SELECT COUNT(*) n FROM reports")!.n,
      companiesWithReports: get<{ n: number }>("SELECT COUNT(DISTINCT symbol) n FROM reports")!.n,
      dividends: get<{ n: number }>("SELECT COUNT(*) n FROM dividends")!.n,
      announcements: get<{ n: number }>("SELECT COUNT(*) n FROM announcements")!.n,
      companiesWithDetails: get<{ n: number }>("SELECT COUNT(*) n FROM companies WHERE info_fetched_at IS NOT NULL")!.n,
    },
    missing: {
      noHistory: all<{ symbol: string }>("SELECT c.symbol FROM companies c WHERE c.status = 'active' AND NOT EXISTS (SELECT 1 FROM prices p WHERE p.symbol = c.symbol) LIMIT 50").map((r) => r.symbol),
      noSector: all<{ symbol: string }>("SELECT symbol FROM companies WHERE sector IS NULL AND status = 'active' LIMIT 50").map((r) => r.symbol),
    },
  });
});

systemRouter.post("/data/refresh", (req, res) => {
  const { job } = z.object({ job: z.enum(["all", "listing", "history", "indices", "details", "news", "forex", "alerts", "issues", "funds"]) }).parse(req.body);
  if (job === "all") queueDailyRefresh();
  else if (job === "listing") enqueue("listing", (s) => syncListing(s));
  else if (job === "history") enqueue("history", (s) => syncHistory(s));
  else if (job === "indices") enqueue("indices", (s) => syncIndices(s));
  else if (job === "details") enqueue("details", (s) => syncAllDetails(s, { maxAgeDays: 0 }));
  else if (job === "news") enqueue("news", () => syncNews());
  else if (job === "forex") enqueue("forex", () => syncForex());
  else if (job === "issues") enqueue("issues", () => syncIssues());
  else if (job === "funds") enqueue("funds", () => syncFunds());
  else if (job === "alerts") enqueue("alerts", async () => evaluateAlerts());
  res.json({ ok: true, jobs: jobStates() });
});

systemRouter.get("/settings/fees", (_req, res) => res.json({ defaults: DEFAULT_FEES, current: { ...DEFAULT_FEES, ...getSetting("fees", {}) } }));
systemRouter.put("/settings/fees", (req, res) => {
  const p = z.object({
    commissionSlabs: z.array(z.object({ upTo: z.number().positive().nullable(), rate: z.number().min(0).max(0.05) })).min(1).optional(),
    minCommission: z.number().min(0).optional(), sebonFeeRate: z.number().min(0).max(0.01).optional(), dpChargePerScrip: z.number().min(0).optional(),
    cgtShortTerm: z.number().min(0).max(0.5).optional(), cgtLongTerm: z.number().min(0).max(0.5).optional(), cgtInstitution: z.number().min(0).max(0.5).optional(),
    dividendTax: z.number().min(0).max(0.5).optional(), holdingDaysForLongTerm: z.number().int().min(0).optional(), verifiedOn: z.string().max(60).optional(),
  }).parse(req.body);
  setSetting("fees", { ...getSetting("fees", {}), ...p });
  res.json({ ok: true });
});
systemRouter.post("/settings/fees/reset", (_req, res) => { run("DELETE FROM settings WHERE key = 'fees'"); res.json({ ok: true }); });

systemRouter.get("/settings/ai", (_req, res) => res.json({ provider: config.ai.provider, model: config.ai.model, effort: config.ai.effort, hasKey: config.ai.hasKey }));
systemRouter.put("/settings/ai", (req, res) => {
  const p = z.object({ provider: z.enum(["anthropic", "none"]).optional(), model: z.string().regex(/^[a-z0-9.\-]{3,60}$/).optional(), effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(), apiKey: z.string().max(300).optional() }).parse(req.body);
  if (p.provider) setEnvValue("AI_PROVIDER", p.provider);
  if (p.model) setEnvValue("AI_MODEL", p.model);
  if (p.effort) setEnvValue("AI_EFFORT", p.effort);
  if (p.apiKey !== undefined) setEnvValue("ANTHROPIC_API_KEY", p.apiKey.trim()); // stored in .env (gitignored), never returned
  res.json({ ok: true, hasKey: config.ai.hasKey });
});

systemRouter.post("/resources/check-links", async (_req, res) => {
  const urls = new Set<string>();
  for (const r of all<{ url: string; links: string }>("SELECT url, links FROM resources")) { if (r.url) urls.add(r.url); for (const l of JSON.parse(r.links || "[]")) urls.add(l.url); }
  for (const p of all<{ official_url: string | null; info_url: string | null }>("SELECT official_url, info_url FROM products")) { if (p.official_url) urls.add(p.official_url); if (p.info_url) urls.add(p.info_url); }
  const results: { url: string; status: number | null; ok: boolean; error?: string }[] = [];
  await Promise.all([...urls].map(async (url) => {
    try {
      const r = await politeFetch(url, { retries: 1, timeoutMs: 15_000, browserLike: true });
      results.push({ url, status: r.status, ok: r.status < 400 });
    } catch (e) { results.push({ url, status: null, ok: false, error: e instanceof Error ? e.message : String(e) }); }
  }));
  setSetting("linkCheck", { at: new Date().toISOString(), results });
  res.json({ at: new Date().toISOString(), results: results.sort((a, b) => Number(a.ok) - Number(b.ok)) });
});
systemRouter.get("/resources/link-status", (_req, res) => res.json(getSetting("linkCheck", null)));

systemRouter.get("/account/export", (req, res) => {
  const uid = req.userId!;
  const ports = all<{ id: number }>("SELECT * FROM portfolios WHERE user_id = ?", uid);
  const data = {
    exportedAt: new Date().toISOString(), app: "Saphal Stocks", username: req.username,
    portfolios: ports.map((p) => ({ ...p, transactions: all("SELECT * FROM transactions WHERE portfolio_id = ?", p.id) })),
    watchlists: all<{ id: number }>("SELECT * FROM watchlists WHERE user_id = ?", uid).map((w) => ({ ...w, items: all("SELECT * FROM watchlist_items WHERE watchlist_id = ?", w.id) })),
    alerts: all("SELECT * FROM alerts WHERE user_id = ?", uid),
    vault: Object.fromEntries((["profile", "goal", "networth", "journal", "thesis"] as const).map((k) => [k, readVault(uid, k)])),
    documents: all("SELECT id, symbol, title, kind, period, filename, pages, uploaded_at FROM documents WHERE user_id = ?", uid),
    conversations: all<{ id: number }>("SELECT * FROM ai_conversations WHERE user_id = ?", uid).map((c) => ({ ...c, messages: all("SELECT role, display, created_at FROM ai_messages WHERE conversation_id = ? AND display IS NOT NULL", c.id) })),
  };
  res.setHeader("Content-Disposition", `attachment; filename="saphal-stocks-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(data);
});

systemRouter.post("/account/delete-personal-data", (req, res) => {
  const { confirm } = z.object({ confirm: z.literal("DELETE MY DATA") }).parse(req.body);
  void confirm;
  const uid = req.userId!;
  for (const t of ["portfolios", "watchlists", "alerts", "notifications", "vault", "documents", "ai_conversations"]) run(`DELETE FROM ${t} WHERE user_id = ?`, uid);
  res.json({ ok: true });
});

systemRouter.post("/backup", (_req, res) => {
  const file = join(DATA_DIR, "backups", `saphal-stocks-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  res.json({ ok: true, file });
});
