// Serves dist/ the way GitHub Pages does: under /<repo>/, with 404.html for unknown paths.
//   node scripts/serve-pages.mjs [port] [base]
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { join, extname } from "node:path";

const port = Number(process.argv[2] || 5186);
const base = (process.argv[3] || "/saphal-stocks/").replace(/\/?$/, "/");
const root = join(process.cwd(), "dist");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".wasm": "application/wasm", ".bin": "application/octet-stream", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (!url.pathname.startsWith(base)) { res.writeHead(302, { Location: base }); return res.end(); }
  let p = join(root, decodeURIComponent(url.pathname.slice(base.length)) || "index.html");
  try { if ((await stat(p)).isDirectory()) p = join(p, "index.html"); const body = await readFile(p); res.writeHead(200, { "Content-Type": types[extname(p)] || "application/octet-stream" }); return res.end(body); }
  catch { const body = await readFile(join(root, "404.html")); res.writeHead(404, { "Content-Type": types[".html"] }); return res.end(body); }
}).listen(port, () => console.log(`GitHub Pages preview: http://localhost:${port}${base}`));
