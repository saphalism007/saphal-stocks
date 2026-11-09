// Browser replacement for server/routes/auth.ts: one person per device, no server sign-in.
// An optional app lock (passcode / Face ID via the device) is handled in the UI.
import { Router, type Request, type Response, type NextFunction } from "./b-express.ts";

export function authMiddleware(req: Request, _res: Response, next: NextFunction) { req.userId = 1; req.username = "me"; next(); }
export function requireAuth(req: Request, _res: Response, next: NextFunction) { req.userId = 1; req.username = "me"; next(); }
export function sameOrigin(_req: Request, _res: Response, next: NextFunction) { next(); }
export const authRouter = Router();
authRouter.get("/status", (_req, res) => res.json({ setupRequired: false, user: { id: 1, username: "me" }, mode: "browser" }));
authRouter.post("/logout", (_req, res) => res.json({ ok: true }));
authRouter.get("/sessions", (_req, res) => res.json([]));
