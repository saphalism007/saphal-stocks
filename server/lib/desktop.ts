// Native desktop notifications (macOS Notification Center via osascript). No-op elsewhere or when disabled.
import { execFile } from "node:child_process";
import { getSetting } from "../db.ts";

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/[\r\n]+/g, " ").slice(0, 240);

export function desktopSupported() { return process.platform === "darwin"; }
export function desktopEnabled() { return desktopSupported() && getSetting<boolean>("desktopNotifications", true); }

export function desktopNotify(title: string, body: string, force = false): Promise<boolean> {
  if (!desktopSupported() || (!force && !desktopEnabled())) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile("osascript", ["-e", `display notification "${esc(body)}" with title "Saphal Stocks" subtitle "${esc(title)}"`], { timeout: 5000 }, (err) => resolve(!err));
  });
}
