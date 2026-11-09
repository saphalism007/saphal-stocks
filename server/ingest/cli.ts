// Command-line data refresh:  npm run ingest -- [listing|history|indices|details|news|forex|issues|funds|rates|audit|all] [SYMBOL...]
import "../db.ts";
import { seedReference } from "../seed.ts";
import { syncListing, syncHistory, syncIndices, syncAllDetails, syncNews, syncForex, syncCompanyDetail, syncIssues, syncFunds, syncRates, syncAuditDocs, syncLinkChecks, syncFloorsheet } from "./jobs.ts";
import { evaluateAlerts } from "../lib/alerts.ts";
import { syncCompanyDocs } from "./companyDocs.ts";

seedReference();
const [what = "all", ...symbols] = process.argv.slice(2);
const log = (m: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const progress = () => ({ name: "cli", status: "running" as const, progress: 0, total: 0, set message(m: string) { if (/\((\d+)\/(\d+)\)/.test(m) && Number(m.match(/\((\d+)\//)![1]) % 25 === 0) log(m); } , get message() { return ""; } });

async function main() {
  if (what === "detail") { for (const s of symbols) log(JSON.stringify(await syncCompanyDetail(s.toUpperCase()))); return; }
  if (what === "listing" || what === "all") log(`listing: ${await syncListing()} quotes`);
  if (what === "history" || what === "all") log(`history: ${await syncHistory(progress() as never, symbols.length ? { symbols, force: true } : {})} rows`);
  if (what === "indices" || what === "all") log(`indices: ${await syncIndices(progress() as never)} rows`);
  if (what === "news" || what === "all") log(`news: ${await syncNews()} items`);
  if (what === "forex" || what === "all") log(`forex: ${await syncForex()} rows`);
  if (what === "issues" || what === "all") log(`issues: ${await syncIssues()} rows`);
  if (what === "funds" || what === "all") log(`funds: ${await syncFunds()} rows`);
  if (what === "rates" || what === "all") { try { log(`rates: ${await syncRates()} official NRB rates`); } catch (e) { log(`rates failed: ${e instanceof Error ? e.message : e}`); } }
  if (what === "details" || what === "all") log(`details: ${await syncAllDetails(progress() as never, symbols.length ? { symbols } : { maxAgeDays: 7 })} companies`);
  if (what === "audit" || what === "all") { try { log(`audit: ${await syncAuditDocs(progress() as never)} audited statements collected`); } catch (e) { log(`audit failed: ${e instanceof Error ? e.message : e}`); } }
  if (what === "floorsheet" || what === "all") { try { log(`floorsheet: ${await syncFloorsheet(progress() as never)} stocks`); } catch (e) { log(`floorsheet failed: ${e instanceof Error ? e.message : e}`); } }
  if (what === "companydocs" || what === "all") { try { log(`company websites: ${await syncCompanyDocs(symbols.length ? { symbols } : {})} checked`); } catch (e) { log(`company websites failed: ${e instanceof Error ? e.message : e}`); } }
  if (what === "links" || what === "all") { try { log(`links: ${await syncLinkChecks()} checked`); } catch (e) { log(`links failed: ${e instanceof Error ? e.message : e}`); } }
  log(`alerts fired: ${evaluateAlerts()}`);
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
