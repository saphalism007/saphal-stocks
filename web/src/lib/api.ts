import { useCallback, useEffect, useRef, useState } from "react";
import { BROWSER_BACKEND, backendFetch } from "./backend.ts";

const doFetch = (url: string, init: RequestInit) => (BROWSER_BACKEND ? backendFetch(url, init) : fetch(url, init));

export class ApiError extends Error { status: number; constructor(msg: string, status: number) { super(msg); this.status = status; } }

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await doFetch(`/api${path}`, {
    method: opts.method || (opts.body || opts.form ? "POST" : "GET"),
    headers: opts.form ? undefined : opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: "same-origin",
  });
  const ct = res.headers.get("content-type") || "";
  const data = ct.includes("json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth")) window.dispatchEvent(new Event("ss:unauthorized"));
    throw new ApiError((data as { error?: string })?.error || `Request failed (${res.status})`, res.status);
  }
  return data as T;
}

/** Fetch-on-mount hook with reload. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const seq = useRef(0);
  const load = useCallback(async () => {
    if (!path) return;
    const id = ++seq.current;
    setLoading(true);
    try {
      const d = await api<T>(path);
      if (id === seq.current) { setData(d); setError(null); }
    } catch (e) {
      if (id === seq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** POST that streams server-sent events (used by the AI analyst). */
export async function streamPost(path: string, body: unknown, onEvent: (event: string, data: unknown) => void) {
  const res = await doFetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
    throw new ApiError(msg, res.status);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const ev = chunk.match(/^event: (.*)$/m)?.[1] || "message";
      const dl = chunk.match(/^data: (.*)$/m)?.[1];
      if (dl) onEvent(ev, JSON.parse(dl));
    }
  }
}
