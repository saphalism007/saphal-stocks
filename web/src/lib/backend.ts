// Talks to the in-browser backend (Web Worker) with a fetch-compatible interface,
// so the rest of the app is the same whether it runs on the desktop server or in the browser.
export const BROWSER_BACKEND = import.meta.env.VITE_BACKEND !== "server";

type Listener = (e: { type: string; message?: string; market?: unknown; title?: string; body?: string }) => void;
const listeners = new Set<Listener>();
export const onBackendEvent = (fn: Listener) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export let backendState: { status: "starting" | "ready" | "error"; message: string; market?: Record<string, unknown> } = { status: "starting", message: "Starting…" };

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { start: (status: number, headers: Record<string, string>) => void; chunk: (s: string) => void; end: (body: string | null) => void }>();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("../backend/worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.id != null) {
      const p = pending.get(m.id);
      if (!p) return;
      if (m.type === "start") p.start(m.status, m.headers);
      else if (m.type === "chunk") p.chunk(m.data);
      else if (m.type === "end") { p.end(m.body); pending.delete(m.id); }
      return;
    }
    if (m.type === "ready") backendState = { status: "ready", message: "Ready", market: m.market };
    if (m.type === "fatal") backendState = { status: "error", message: m.message };
    if (m.type === "progress" && backendState.status === "starting") backendState = { ...backendState, message: m.message };
    if (m.type === "notify") showNotification(m.title, m.body);
    for (const l of listeners) l(m);
  };
  return worker;
}

async function showNotification(title: string, body: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    // iPhone/iPad only show notifications from a Home Screen app via its service worker.
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) reg.active?.postMessage({ type: "notify", title, body });
    else new Notification(title, { body, icon: `${import.meta.env.BASE_URL}icons/icon-192.png` });
  } catch { /* not supported */ }
}

export async function enableNotifications(): Promise<string> {
  if (!("Notification" in window)) return "This browser does not support notifications. On iPhone/iPad, add Saphal Stocks to your Home Screen first, then open it from there.";
  const p = await Notification.requestPermission();
  return p === "granted" ? "Notifications are on for this device." : "Notifications are blocked. Allow them in your browser or device settings.";
}

export function startBackend() { if (BROWSER_BACKEND) getWorker(); }
export function flushBackend() { worker?.postMessage({ type: "flush" }); }

export async function backendFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const w = getWorker();
  const id = ++seq;
  const path = input.replace(/^.*?\/api\//, "/api/");
  let body: unknown;
  let files: { fieldname: string; filename: string; type: string; buffer: ArrayBuffer }[] | undefined;
  if (init.body instanceof FormData) {
    body = {}; files = [];
    for (const [k, v] of init.body.entries()) {
      if (v instanceof File) files.push({ fieldname: k, filename: v.name, type: v.type, buffer: await v.arrayBuffer() });
      else (body as Record<string, string>)[k] = v;
    }
  } else if (typeof init.body === "string") body = JSON.parse(init.body);
  return new Promise((resolve) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(c) { controller = c; } });
    pending.set(id, {
      start: (status, headers) => resolve(new Response(stream, { status, headers })),
      chunk: (s) => controller.enqueue(enc.encode(s)),
      end: (b) => { if (b) controller.enqueue(enc.encode(b)); controller.close(); },
    });
    w.postMessage({ id, method: init.method || "GET", path, headers: init.headers as Record<string, string>, body, files }, files ? files.map((f) => f.buffer) : []);
  });
}

/** Downloads a file produced by an /api/... endpoint (CSV exports, JSON export). */
export async function downloadFromApi(href: string) {
  const res = BROWSER_BACKEND ? await backendFetch(href) : await fetch(href, { credentials: "same-origin" });
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") || "";
  const name = cd.match(/filename="([^"]+)"/)?.[1] || href.split("/").pop() || "download";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
