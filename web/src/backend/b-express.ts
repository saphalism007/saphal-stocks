// Minimal Express-compatible router so the server's route files run unchanged in a Web Worker.
// Supports what the routes use: get/post/put/patch/delete/use, :params, async handlers,
// req.params/query/body/file, res.status/json/send/setHeader/write/end.

export interface UploadedFile { fieldname: string; originalname: string; mimetype: string; buffer: Uint8Array; size: number }
export interface Request {
  method: string; path: string; url: string; params: Record<string, string>; query: Record<string, string>; body: unknown;
  headers: Record<string, string>; cookies: Record<string, string>; ip: string; secure: boolean;
  userId?: number; username?: string; file?: UploadedFile; files?: UploadedFile[];
  get(name: string): string | undefined;
}
export interface Response {
  statusCode: number; headers: Record<string, string>; headersSent: boolean;
  status(code: number): Response; json(body: unknown): Response; send(body: unknown): Response;
  setHeader(name: string, value: string): Response; write(chunk: string): boolean; end(chunk?: string): void; flushHeaders(): void;
  cookie(...a: unknown[]): Response; clearCookie(...a: unknown[]): Response;
}
export type NextFunction = (err?: unknown) => void;
type Handler = (req: Request, res: Response, next: NextFunction) => unknown;
interface Layer { method: string | null; path: string; handlers: (Handler | RouterImpl)[] }

function match(pattern: string, path: string, prefix: boolean): Record<string, string> | null {
  const pp = pattern.split("/").filter(Boolean), sp = path.split("/").filter(Boolean);
  if (prefix ? sp.length < pp.length : sp.length !== pp.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pp.length; i++) {
    if (pp[i].startsWith(":")) params[pp[i].slice(1)] = decodeURIComponent(sp[i]);
    else if (pp[i] !== sp[i]) return null;
  }
  return params;
}

export class RouterImpl {
  layers: Layer[] = [];
  private add(method: string | null, path: string | Handler | RouterImpl, handlers: (Handler | RouterImpl)[]) {
    if (typeof path !== "string") { handlers = [path, ...handlers]; path = "/"; }
    this.layers.push({ method, path, handlers });
    return this;
  }
  get(p: string, ...h: Handler[]) { return this.add("GET", p, h); }
  post(p: string, ...h: Handler[]) { return this.add("POST", p, h); }
  put(p: string, ...h: Handler[]) { return this.add("PUT", p, h); }
  patch(p: string, ...h: Handler[]) { return this.add("PATCH", p, h); }
  delete(p: string, ...h: Handler[]) { return this.add("DELETE", p, h); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  use(p: any, ...h: any[]) { return this.add(null, p, h); }

  /** Resolves true when some handler responded. */
  async handle(req: Request, res: Response, path: string): Promise<boolean> {
    for (const layer of this.layers) {
      if (layer.method && layer.method !== req.method) continue;
      const params = match(layer.path, path, layer.method === null);
      if (!params) continue;
      Object.assign(req.params, params);
      const rest = layer.method === null ? "/" + path.split("/").filter(Boolean).slice(layer.path.split("/").filter(Boolean).length).join("/") : path;
      for (const h of layer.handlers) {
        if (h instanceof RouterImpl || typeof (h as { handle?: unknown }).handle === "function") { if (await (h as RouterImpl).handle(req, res, rest)) return true; continue; }
        let proceed = false;
        let error: unknown = null;
        await h(req, res, (err?: unknown) => { if (err) error = err; proceed = true; });
        if (error) throw error;
        if (res.headersSent) return true;
        if (!proceed) return true; // handler responded asynchronously or ended the chain
      }
    }
    return false;
  }
}

export function Router() { return new RouterImpl(); }

export function makeResponse(onChunk: (chunk: string) => void, onEnd: () => void): Response & { body: string | null; done: Promise<void> } {
  let resolve!: () => void;
  const done = new Promise<void>((r) => (resolve = r));
  const res = {
    statusCode: 200, headers: {} as Record<string, string>, headersSent: false, body: null as string | null, done,
    status(code: number) { res.statusCode = code; return res; },
    setHeader(n: string, v: string) { res.headers[n.toLowerCase()] = v; return res; },
    json(b: unknown) { res.headers["content-type"] ??= "application/json"; res.body = JSON.stringify(b); res.headersSent = true; onEnd(); resolve(); return res; },
    send(b: unknown) { res.body = typeof b === "string" ? b : JSON.stringify(b); res.headersSent = true; onEnd(); resolve(); return res; },
    write(chunk: string) { res.headersSent = true; onChunk(chunk); return true; },
    end(chunk?: string) { if (chunk) onChunk(chunk); res.headersSent = true; onEnd(); resolve(); },
    flushHeaders() { res.headersSent = true; },
    cookie() { return res; },
    clearCookie() { return res; },
  };
  return res as Response & { body: string | null; done: Promise<void> };
}

const express = Object.assign(() => { throw new Error("express() is not available in the browser"); }, { Router, json: () => (_q: Request, _s: Response, n: NextFunction) => n(), static: () => (_q: Request, _s: Response, n: NextFunction) => n() });
export default express;
