// Polite HTTP client for data providers: per-host rate limit, retries with
// exponential backoff, timeouts, and a cookie jar (some providers need a
// session + CSRF token for their public JSON endpoints).
import { config } from "../config.ts";

const lastHit = new Map<string, number>();
const MIN_GAP_MS: Record<string, number> = { "www.sharesansar.com": 1200, "raw.githubusercontent.com": 50, default: 300 };

async function throttle(host: string) {
  const gap = MIN_GAP_MS[host] ?? MIN_GAP_MS.default;
  // Reserve the next slot synchronously so concurrent callers queue up.
  const prev = lastHit.get(host) ?? 0;
  const slot = Math.max(Date.now(), prev + gap);
  lastHit.set(host, slot);
  const wait = slot - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

export class CookieJar {
  private cookies = new Map<string, string>();
  store(res: Response) {
    const set = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
    for (const c of set) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      if (i > 0) this.cookies.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
}

export interface FetchOpts { method?: string; headers?: Record<string, string>; body?: string; jar?: CookieJar; retries?: number; timeoutMs?: number; browserLike?: boolean }

export async function politeFetch(url: string, opts: FetchOpts = {}): Promise<Response> {
  const host = new URL(url).host;
  const retries = opts.retries ?? 3;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    try {
      const headers: Record<string, string> = {
        "User-Agent": opts.browserLike ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36 SaphalStocks/0.1" : config.userAgent,
        Accept: "*/*",
        ...(opts.headers || {}),
      };
      if (opts.jar) { const c = opts.jar.header(); if (c) headers.Cookie = c; }
      const res = await fetch(url, { method: opts.method || "GET", headers, body: opts.body, signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000), redirect: "follow" });
      opts.jar?.store(res);
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status} from ${host}`);
      return res;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 300));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchText(url: string, opts: FetchOpts = {}) {
  const res = await politeFetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}) {
  const res = await politeFetch(url, { ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

export const decodeHtml = (s: string) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
export const stripTags = (s: string) => decodeHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
export const num = (s: string | number | null | undefined): number | null => {
  if (s == null) return null;
  if (typeof s === "number") return Number.isFinite(s) ? s : null;
  const m = String(s).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const v = Number(m[0]);
  return Number.isFinite(v) ? v : null;
};
