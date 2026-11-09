// After `vite build`: writes the list of all app files into dist/sw.js so the service worker
// caches everything at install (the app then opens fully offline), and versions the cache.
import { readdirSync, statSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";
import { execSync } from "node:child_process";

const dist = join(process.cwd(), "dist");
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) { if (f !== "data") walk(p); } else files.push(relative(dist, p).split("\\").join("/")); } };
walk(dist);
const list = files.filter((f) => !/^(404\.html|sw\.js|version\.json)$/.test(f) && !f.endsWith(".map"));
const hash = createHash("sha256").update(list.map((f) => f + statSync(join(dist, f)).size).join("|")).digest("hex").slice(0, 10);
let sw = readFileSync(join(dist, "sw.js"), "utf8");
sw = sw.replace('const CACHE = "saphal-stocks-v1";', `const CACHE = "saphal-stocks-${hash}";\nconst PRECACHE = ${JSON.stringify(list)};`);
sw = sw.replace('c.addAll([SCOPE, SCOPE + "manifest.webmanifest", SCOPE + "icons/icon-192.png", SCOPE + "icons/apple-touch-icon.png"])', "c.addAll([SCOPE, ...PRECACHE.filter((f) => f !== \"index.html\").map((f) => SCOPE + f)])");
writeFileSync(join(dist, "sw.js"), sw);
// Version note: what the app compares itself with, and what the deploy script waits for.
const vsrc = readFileSync(join(process.cwd(), "web/src/version.ts"), "utf8");
const build = process.env.GITHUB_SHA || (() => { try { return execSync("git rev-parse HEAD").toString().trim(); } catch { return "dev"; } })();
const notes = [...(vsrc.match(/NOTES = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse(`"${m[1]}"`));
const note = { version: vsrc.match(/VERSION = "([^"]+)"/)[1], released: vsrc.match(/RELEASED = "([^"]+)"/)[1], build, code: build.slice(0, 6).toUpperCase(), notes };
writeFileSync(join(dist, "version.json"), JSON.stringify(note, null, 2));
const html = readFileSync(join(dist, "index.html"), "utf8").replace("<head>", `<head>\n    <meta name="build" content="${build}" />`);
writeFileSync(join(dist, "index.html"), html);
copyFileSync(join(dist, "index.html"), join(dist, "404.html"));
console.log(`service worker precaches ${list.length} files (cache ${hash}); version ${note.version} code ${note.code}`);
