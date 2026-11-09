// Browser replacement for server/lib/security.ts. Data on the device is protected by the
// device itself (iOS/macOS encrypt app storage); synced copies are encrypted separately
// with your sync passphrase (see sync.ts). The "p1:" format is plain JSON.
export function encrypt(plain: unknown): string { return "p1:" + JSON.stringify(plain); }
export function decrypt<T = unknown>(blob: string): T {
  if (blob.startsWith("p1:")) return JSON.parse(blob.slice(3)) as T;
  throw new Error("This record was encrypted by the desktop server and cannot be read in the web app. Export it from the server version.");
}
export const hashPassword = (p: string) => p;
export const verifyPassword = () => true;
export const newToken = () => crypto.randomUUID();
export const tokenHash = (t: string) => t;
