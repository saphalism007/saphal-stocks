import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "./styles.css";
import { App } from "./App.tsx";
import { startBackend, BROWSER_BACKEND } from "./lib/backend.ts";
import { applyPrefs, cachedPrefs } from "./lib/prefs.ts";
import { api } from "./lib/api.ts";

startBackend();
if ("serviceWorker" in navigator && import.meta.env.PROD && BROWSER_BACKEND) {
  window.addEventListener("load", () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {}); });
} else if ("serviceWorker" in navigator) {
  // The Mac server version always loads fresh from this computer: remove any offline copy left behind.
  void navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => void r.unregister())).catch(() => {});
  if ("caches" in window) void caches.keys().then((ks) => ks.forEach((k) => void caches.delete(k))).catch(() => {});
}
if (import.meta.env.DEV) (window as unknown as { saphalApi: typeof api }).saphalApi = api;

applyPrefs(cachedPrefs());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "") || undefined}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
