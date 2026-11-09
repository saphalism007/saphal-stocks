// After `vite build`: writes the list of all app files into dist/sw.js so the service worker
// caches everything at install (the app then opens fully offline), and versions the cache.
import { readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

const dist = join(process.cwd(), "dist");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "data") walk(p); } else files.push(relative(dist, p).split("\\").join("/")); } };
walk(dist);
const list = files.filter((f) => !/^(404\.html|sw\.js)$/.test(f) && !f.endsWith(".map"));
const hash = createHash("sha256").update(list.map((f) => f + statSync(join(dist, f)).size).join("|")).digest("hex").slice(0, 10);
let sw = readFileSync(join(dist, "sw.js"), "utf8");
sw = sw.replace('const CACHE = "saphal-stocks-v1";', `const CACHE = "saphal-stocks-${hash}";\nconst PRECACHE = ${JSON.stringify(list)};`);
sw = sw.replace('c.addAll([SCOPE, SCOPE + "manifest.webmanifest", SCOPE + "icons/icon-192.png", SCOPE + "icons/apple-touch-icon.png"])', "c.addAll([SCOPE, ...PRECACHE.filter((f) => f !== \"index.html\").map((f) => SCOPE + f)])");
writeFileSync(join(dist, "sw.js"), sw);
copyFileSync(join(dist, "index.html"), join(dist, "404.html"));
console.log(`service worker precaches ${list.length} files (cache ${hash})`);
