import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { get, run, nowIso, all } from "../db.ts";
import { hashPassword, verifyPassword, newToken, tokenHash } from "../lib/security.ts";
import { config } from "../config.ts";

declare module "express-serve-static-core" { interface Request { userId?: number; username?: string } }

const COOKIE = "ss_session";
const SESSION_DAYS = 30;

// On this Mac only (server bound to 127.0.0.1 and the request comes from this computer), open the app
// straight away without an account: you are the only person who can reach it. Wi-Fi mode (HOST=0.0.0.0)
// keeps the password. Set REQUIRE_LOGIN=1 to always ask for one.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const localOnly = () => process.env.REQUIRE_LOGIN !== "1" && ["127.0.0.1", "localhost", "::1"].includes(config.host);
function localUser(): { id: number; username: string } {
  const u = get<{ id: number; username: string }>("SELECT id, username FROM users ORDER BY id LIMIT 1");
  if (u) return u;
  const id = createUser("Saphal", newToken()); // random password: never needed on this Mac
  return { id, username: "Saphal" };
}
function createUser(username: string, password: string): number {
  const id = Number(run("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)", username, hashPassword(password), nowIso()).lastInsertRowid);
  // Starter structures so the app is useful immediately.
  run("INSERT INTO watchlists (user_id, name, created_at) VALUES (?, 'My watchlist', ?)", id, nowIso());
  run("INSERT INTO portfolios (user_id, name, kind, strategy, created_at) VALUES (?, 'Long-term investments', 'real', 'Long-term', ?)", id, nowIso());
  run("INSERT INTO portfolios (user_id, name, kind, strategy, paper_cash, created_at) VALUES (?, 'Paper trading', 'paper', 'Swing trading', 1000000, ?)", id, nowIso());
  return id;
}

export function authMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const s = get<{ user_id: number; expires_at: string; username: string }>(
      "SELECT s.user_id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?", tokenHash(token),
    );
    if (s && Date.parse(s.expires_at) > Date.now()) { req.userId = s.user_id; req.username = s.username; }
  }
  if (!req.userId && localOnly() && LOOPBACK.has(req.socket.remoteAddress ?? "") && !req.get("x-forwarded-for")) {
    const u = localUser(); req.userId = u.id; req.username = u.username;
  }
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.userId) return res.status(401).json({ error: "Please sign in." });
  next();
}

/** Blocks cross-site state-changing requests (defence in depth on top of SameSite=Strict cookies). */
export function sameOrigin(req: Request, res: Response, next: NextFunction) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (origin) {
    // Allowed: the host the browser addressed (direct or via the dev proxy) and the dev UI origin.
    const allowed = new Set([req.get("host"), req.get("x-forwarded-host"), ...(process.env.ALLOWED_ORIGIN_HOSTS || "localhost:5180,127.0.0.1:5180").split(",")].filter(Boolean));
    try { if (!allowed.has(new URL(origin).host)) return res.status(403).json({ error: "Cross-origin request blocked." }); } catch { return res.status(403).json({ error: "Bad origin." }); }
  }
  next();
}

function setSession(res: Response, userId: number, ua?: string, secure = false) {
  const token = newToken();
  const exp = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)", tokenHash(token), userId, nowIso(), exp.toISOString(), (ua || "").slice(0, 200));
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure, expires: exp, path: "/" });
}

const creds = z.object({ username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, "Use letters, numbers, dot, dash or underscore"), password: z.string().min(10, "Use at least 10 characters").max(200) });

export const authRouter = Router();

authRouter.get("/status", (req, res) => {
  const users = get<{ n: number }>("SELECT COUNT(*) n FROM users")!.n;
  res.json({ setupRequired: users === 0, user: req.userId ? { id: req.userId, username: req.username } : null });
});

authRouter.post("/setup", (req, res) => {
  if (get<{ n: number }>("SELECT COUNT(*) n FROM users")!.n > 0) return res.status(403).json({ error: "Account already exists." });
  const p = creds.parse(req.body);
  const id = createUser(p.username, p.password);
  setSession(res, id, req.get("user-agent"), req.secure);
  res.json({ ok: true, user: { id, username: p.username } });
});

authRouter.post("/login", (req, res) => {
  const ip = req.ip || "local";
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  const attempts = get<{ n: number }>("SELECT COUNT(*) n FROM login_attempts WHERE ip = ? AND at > ?", ip, since)!.n;
  if (attempts >= 8) return res.status(429).json({ error: "Too many attempts. Try again in 15 minutes." });
  const { username, password } = z.object({ username: z.string().max(40), password: z.string().max(200) }).parse(req.body);
  const u = get<{ id: number; password_hash: string; username: string }>("SELECT * FROM users WHERE username = ?", username.trim());
  if (!u || !verifyPassword(password, u.password_hash)) {
    run("INSERT INTO login_attempts (ip, at) VALUES (?, ?)", ip, nowIso());
    return res.status(401).json({ error: "Incorrect username or password." });
  }
  run("DELETE FROM login_attempts WHERE ip = ?", ip);
  run("DELETE FROM sessions WHERE expires_at < ?", nowIso());
  setSession(res, u.id, req.get("user-agent"), req.secure);
  res.json({ ok: true, user: { id: u.id, username: u.username } });
});

authRouter.post("/logout", (req, res) => {
  const t = req.cookies?.[COOKIE];
  if (t) run("DELETE FROM sessions WHERE token_hash = ?", tokenHash(t));
  res.clearCookie(COOKIE, { path: "/" });
  res.json({ ok: true });
});

authRouter.post("/password", requireAuth, (req, res) => {
  const { current, next } = z.object({ current: z.string(), next: creds.shape.password }).parse(req.body);
  const u = get<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = ?", req.userId)!;
  if (!verifyPassword(current, u.password_hash)) return res.status(401).json({ error: "Current password is incorrect." });
  run("UPDATE users SET password_hash = ? WHERE id = ?", hashPassword(next), req.userId);
  run("DELETE FROM sessions WHERE user_id = ?", req.userId);
  setSession(res, req.userId!, req.get("user-agent"), req.secure);
  res.json({ ok: true });
});

authRouter.get("/sessions", requireAuth, (req, res) => {
  res.json(all("SELECT created_at, expires_at, user_agent FROM sessions WHERE user_id = ? ORDER BY created_at DESC", req.userId));
});
