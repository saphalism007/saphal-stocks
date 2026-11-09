/**
 * Publishes Saphal Stocks to https://saphalism007.github.io/saphal-stocks/ and waits until
 * the live site really serves the new version.
 *
 * Run with:  npm run deploy   (it bumps the version, tests and builds first)
 *
 * Pushing starts the GitHub Actions run, which builds the app with the latest market data
 * and publishes it. Uploading is not the same as being live, so this keeps asking the real
 * address, with caches bypassed, until version.json carries this commit. Then it prints
 * the TALLY line: the same version and code the app shows in its sidebar and Settings → About.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const URL_LIVE = "https://saphalism007.github.io/saphal-stocks/";
const REPO = "saphalism007/saphal-stocks";
const git = (args) => execFileSync("git", args, { encoding: "utf8", stdio: "pipe" }).trim();
const vsrc = readFileSync(join(process.cwd(), "web/src/version.ts"), "utf8");
const version = vsrc.match(/VERSION = "([^"]+)"/)[1];
const released = vsrc.match(/RELEASED = "([^"]+)"/)[1];
const notes = [...(vsrc.match(/NOTES = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => JSON.parse(`"${x[1]}"`));

if (git(["rev-parse", "--abbrev-ref", "HEAD"]) !== "main") { console.error("Deploy from the main branch."); process.exit(1); }

if (git(["status", "--porcelain"])) {
  git(["add", "-A"]);
  const msg = `Saphal Stocks version ${version}, ${released}\n\n${notes.map((n) => `- ${n}`).join("\n")}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  git(["-c", "user.name=Saphal Maharjan", "-c", "user.email=saphalai007@gmail.com", "commit", "-q", "-m", msg]);
}
const sha = git(["rev-parse", "HEAD"]);
const code = sha.slice(0, 6).toUpperCase();

try {
  git(["fetch", "-q", "origin", "main"]);
  if (git(["rev-list", "--count", "origin/main..HEAD"]) !== "0") {
    git(["push", "-q", "origin", "main"]);
    console.log(`Pushed version ${version} (code ${code}). Waiting for GitHub to build and publish it...`);
  } else console.log(`Nothing new to push. Checking that the live site serves code ${code}...`);
} catch (error) {
  const text = String(error.stderr || error.message);
  if (text.includes("workflow")) console.error("GitHub refused the push: it changes .github/workflows and the saved token has no 'workflow' permission. Tick 'workflow' on the token at https://github.com/settings/tokens and run npm run deploy again.");
  else console.error(text.includes("403") ? "GitHub refused the push: the saved login cannot write." : `Push failed:\n${text}`);
  process.exit(1);
}

// The token the Mac already uses for git, to read the Actions run status (fails fast if the build breaks).
let token = "";
try { token = execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" }).match(/^password=(.*)$/m)?.[1] ?? ""; } catch { /* status checks skipped */ }

const started = Date.now();
let lastNote = "";
while (Date.now() - started < 60 * 60 * 1000) {
  try {
    const note = await (await fetch(`${URL_LIVE}version.json?check=${Date.now()}`, { cache: "no-store" })).json();
    if (note.build === sha) {
      const page = await (await fetch(`${URL_LIVE}?check=${Date.now()}`, { cache: "no-store" })).text();
      if (page.includes(`content="${sha}"`)) {
        console.log(`Live. ${URL_LIVE} serves version ${note.version}, code ${note.code}, released ${note.released}.`);
        console.log(`TALLY  Version ${note.version}  Code ${note.code}  Released ${note.released}`);
        process.exit(0);
      }
    }
    if (token) {
      const runs = await (await fetch(`https://api.github.com/repos/${REPO}/actions/runs?head_sha=${sha}&per_page=5`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" } })).json();
      const failed = (runs.workflow_runs ?? []).find((r) => r.status === "completed" && r.conclusion !== "success");
      if (failed && !(runs.workflow_runs ?? []).some((r) => r.status !== "completed" || r.conclusion === "success")) {
        console.error(`The GitHub Actions run failed (${failed.conclusion}): ${failed.html_url}`);
        process.exit(1);
      }
      const run = (runs.workflow_runs ?? [])[0];
      const line = run ? `  Actions run ${run.status}${run.conclusion ? ` (${run.conclusion})` : ""}; live site has code ${note.code}` : `  waiting for the Actions run to start; live site has code ${note.code}`;
      if (line !== lastNote) { console.log(line); lastNote = line; }
    }
  } catch { if (lastNote !== "x") { console.log("  live site not reachable yet, waiting"); lastNote = "x"; } }
  await new Promise((r) => setTimeout(r, 15000));
}
console.error("Pushed, but the live site has not shown the new version after an hour. Check the Actions tab.");
process.exit(1);
