// Browser replacement for server/lib/desktop.ts: ask the page to show a system notification.
import { getSetting } from "./b-db.ts";
export function desktopSupported() { return true; }
export function desktopEnabled() { return getSetting<boolean>("desktopNotifications", true); }
export async function desktopNotify(title: string, body: string, force = false) {
  if (!force && !desktopEnabled()) return false;
  (self as unknown as { postMessage: (m: unknown) => void }).postMessage({ type: "notify", title, body });
  return true;
}
