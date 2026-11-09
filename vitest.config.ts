import { defineConfig } from "vitest/config";
import { browserBackend } from "./vite.config.ts";

// Tests of the shared engines are pure. tests/browser-backend.test.ts runs the server route code
// through the same module swaps the browser build uses (sql.js instead of node:sqlite).
export default defineConfig({ plugins: [browserBackend()], test: { include: ["tests/**/*.test.ts"], environment: "node", testTimeout: 60000 } });
