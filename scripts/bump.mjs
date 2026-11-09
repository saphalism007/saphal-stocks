/**
 * Gives every release its own version number.
 *
 * If the number in web/src/version.ts is the one already live (the site's version.json),
 * it goes up one step (0.6.1 to 0.6.2) and the release date becomes today. If it was
 * already changed by hand, it is left alone. package.json is kept the same.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LIVE = "https://saphalism007.github.io/saphal-stocks/version.json";
const file = join(process.cwd(), "web/src/version.ts");
let src = readFileSync(file, "utf8");
const m = src.match(/VERSION = "(\d+)\.(\d+)\.(\d+)"/);
if (!m) throw new Error("No VERSION in web/src/version.ts");
let version = `${m[1]}.${m[2]}.${m[3]}`;

let live = null;
try { const r = await fetch(`${LIVE}?t=${Date.now()}`, { cache: "no-store" }); if (r.ok) live = (await r.json()).version; } catch { /* offline: keep */ }

if (live === version) {
  version = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
  src = src.replace(/VERSION = "[^"]+"/, `VERSION = "${version}"`);
  console.log(`Version ${live} is already live. This release is version ${version}.`);
} else {
  console.log(`This release is version ${version}${live ? ` (live: ${live})` : ""}.`);
}
const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kathmandu" });
src = src.replace(/RELEASED = "[^"]+"/, `RELEASED = "${today}"`);
writeFileSync(file, src);

const pkgFile = join(process.cwd(), "package.json");
const pkg = readFileSync(pkgFile, "utf8").replace(/"version": "[^"]+"/, `"version": "${version}"`);
writeFileSync(pkgFile, pkg);
