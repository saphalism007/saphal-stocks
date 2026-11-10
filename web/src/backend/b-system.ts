// Browser system routes: desktop-only endpoints are overridden here; the rest reuse the server router.
import { Router } from "./b-express.ts";
import { z } from "zod";
import { systemRouter as serverSystem } from "../../../server/routes/system.ts";
import { hooks } from "./b-hooks.ts";
import { setSetting, getSetting, all } from "./b-db.ts";

export const systemRouter = Router();

systemRouter.post("/data/refresh", async (_req, res) => {
  const r = await hooks.checkForUpdate(true);
  res.json({ ok: true, ...r, jobs: [] });
});
systemRouter.get("/data/snapshot", (_req, res) => res.json(hooks.marketInfo()));

const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

systemRouter.get("/backup/file", (_req, res) => {
  res.json({ filename: `saphal-stocks-personal-${new Date().toISOString().slice(0, 10)}.sqlite`, base64: b64(hooks.exportUserDb()) });
});
systemRouter.post("/backup/restore", async (req, res) => {
  const { base64 } = z.object({ base64: z.string().min(100) }).parse(req.body);
  const bytes = unb64(base64);
  if (new TextDecoder().decode(bytes.subarray(0, 15)) !== "SQLite format 3") return res.status(400).json({ error: "That file is not a Saphal Stocks backup." });
  await hooks.importUserDb(bytes);
  res.json({ ok: true });
});
systemRouter.post("/backup", (_req, res) => res.json({ ok: true, file: "Use 'Download backup file' to save a copy." }));
systemRouter.get("/backups", (_req, res) => res.json({ dir: "this device (browser storage)", files: [], keepDays: 0, browser: true }));

// Cross-origin pages can't be read from the browser, but a completed no-cors request means the site answered.
systemRouter.post("/resources/check-links", async (_req, res) => {
  const urls = new Set<string>();
  for (const r of all<{ url: string; links: string }>("SELECT url, links FROM resources")) { if (r.url) urls.add(r.url); for (const l of JSON.parse(r.links || "[]")) urls.add(l.url); }
  for (const p of all<{ official_url: string | null; info_url: string | null }>("SELECT official_url, info_url FROM products")) { if (p.official_url) urls.add(p.official_url); if (p.info_url) urls.add(p.info_url); }
  const results = await Promise.all([...urls].map(async (url) => {
    try { await fetch(url, { mode: "no-cors", signal: AbortSignal.timeout(15000) }); return { url, status: null, ok: true }; }
    catch (e) { return { url, status: null, ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }));
  setSetting("linkCheck", { at: new Date().toISOString(), results });
  res.json({ at: new Date().toISOString(), results });
});

systemRouter.get("/settings/appearance", (_req, res) => res.json(getSetting("appearance", {})));
systemRouter.put("/settings/appearance", (req, res) => { setSetting("appearance", z.record(z.unknown()).parse(req.body)); res.json({ ok: true }); });

systemRouter.use(serverSystem);
