import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const B = (f: string) => join(root, "web/src/backend", f);

// The browser build runs the server's route code in a Web Worker. These server modules
// touch Node APIs (filesystem, native SQLite, child processes), so they are swapped for
// browser versions with the same exports.
const SWAP: Record<string, string> = {
  [join(root, "server/db.ts")]: B("b-db.ts"),
  [join(root, "server/config.ts")]: B("b-config.ts"),
  [join(root, "server/lib/security.ts")]: B("b-security.ts"),
  [join(root, "server/lib/desktop.ts")]: B("b-desktop.ts"),
  [join(root, "server/lib/backup.ts")]: B("b-backup.ts"),
  [join(root, "server/ingest/jobs.ts")]: B("b-jobs.ts"),
  [join(root, "server/routes/auth.ts")]: B("b-auth.ts"),
};
const PKG: Record<string, string> = { express: B("b-express.ts"), multer: B("b-multer.ts"), "node:path": B("b-path.ts") };

export function browserBackend(): Plugin {
  return {
    name: "saphal-browser-backend",
    enforce: "pre",
    async resolveId(source, importer, opts) {
      if (PKG[source]) return PKG[source];
      if (!importer || !source.startsWith(".")) return null;
      const abs = resolve(dirname(importer), source);
      if (SWAP[abs]) return SWAP[abs];
      void opts;
      return null;
    },
  };
}

// The git commit this build comes from: the version code shown in the app and tallied by the deploy script.
const BUILD = process.env.GITHUB_SHA || (() => { try { return execSync("git rev-parse HEAD", { cwd: root }).toString().trim(); } catch { return "dev"; } })();
const DEV = process.argv.some((a) => a === "serve" || a === "dev") || !process.argv.includes("build");

export default defineConfig({
  define: { __BUILD__: JSON.stringify(DEV ? "dev" : BUILD) },
  root: "web",
  base: process.env.BASE_PATH || "/",
  plugins: [browserBackend(), react()],
  worker: { format: "es", plugins: () => [browserBackend()] },
  optimizeDeps: { include: ["sql.js"] },
  server: {
    port: 5180,
    proxy: process.env.VITE_BACKEND === "server" ? { "/api": { target: "http://127.0.0.1:5181", xfwd: true } } : undefined,
  },
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 4000, target: "es2022" },
});
