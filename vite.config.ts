import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "web",
  plugins: [react()],
  server: {
    port: 5180,
    proxy: { "/api": { target: "http://127.0.0.1:5181", xfwd: true } },
  },
  build: { outDir: "../dist", emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
