// Company information centre: official website pages and documents (classified strictly as
// quarterly / annual / audited / unclassified), exchange filings, notices, news, downloads and a
// side-by-side comparison of stored quarterly reports.
import { useMemo, useState } from "react";
import { useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, Badge, Empty, Notice } from "./ui.tsx";
import { I } from "./icons.tsx";
import { nptDate, num, compact } from "../lib/format.ts";
import { changePct } from "../../../shared/reportCompare.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export type CentreTab = "quarterly" | "annual" | "notices" | "news" | "downloads";
const TONE: Record<string, "up" | "blue" | "accent" | "warn" | ""> = { quarterly: "blue", annual: "accent", audited: "up", unclassified: "warn", disclosure: "", notice: "", other: "" };
const PAGE_LABEL: Record<string, string> = { investor: "Investor relations page", quarterly: "Official quarterly reports page", annual: "Official annual reports page", notices: "Official notices page", news: "Official news page", downloads: "Official downloads page" };

export function useCompanyDocs(sym: string) { return useApi<Any>(`/stocks/${sym}/documents`, [sym]); }

function OfficialLinks({ d, kinds }: { d: Any; kinds: string[] }) {
  const pages = kinds.map((k) => d.pages?.[k] ? { k, ...d.pages[k] } : null).filter(Boolean) as Any[];
  const crawl = d.crawl;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        {d.website && <a className="btn primary" href={crawl?.final_url || d.website} target="_blank" rel="noopener noreferrer"><I.external /> Visit official website</a>}
        {pages.map((p) => <a key={p.k} className="btn" href={p.url} target="_blank" rel="noopener noreferrer" title={p.label}><I.external /> {PAGE_LABEL[p.k]}</a>)}
      </div>
      {!d.website ? <Notice tone="warn">No official website is listed for {d.name} in its exchange profile, so the official source can't be verified. Exchange filings below are shown with their source.</Notice>
        : !crawl ? <p className="tiny faint">The official website hasn't been scanned yet; it is checked on the next data update.</p>
        : crawl.status === "unreachable" ? <Notice tone="warn">The official website ({d.website}) couldn't be reached on {nptDate(crawl.crawled_at)}{crawl.note ? ` (${crawl.note})` : ""}. Some Nepali sites block visits from outside Nepal; try the button above.</Notice>
        : crawl.status === "script-only" ? <p className="tiny muted">{crawl.note} Use the official website button; report pages couldn't be identified automatically.</p>
        : !pages.length ? <p className="tiny muted">No matching page was found in the website's menus (checked {nptDate(crawl.crawled_at)}).</p>
        : <p className="tiny faint">Pages found in the official website's menus on {nptDate(crawl.crawled_at)}.</p>}
    </div>
  );
}

function DocList({ rows, empty, showType = true }: { rows: Any[]; empty: string; showType?: boolean }) {
  const years = useMemo(() => [...new Set(rows.map((r) => r.fiscal_year).filter(Boolean))].sort().reverse() as string[], [rows]);
  const types = useMemo(() => [...new Set(rows.map((r) => r.type))] as string[], [rows]);
  const [fy, setFy] = useState("all");
  const [ty, setTy] = useState("all");
  const [n, setN] = useState(25);
  const list = rows.filter((r) => (fy === "all" || r.fiscal_year === fy) && (ty === "all" || r.type === ty));
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <select className="input sm" value={fy} onChange={(e) => setFy(e.target.value)} aria-label="Fiscal year"><option value="all">All fiscal years</option>{years.map((y) => <option key={y} value={y}>FY {y}</option>)}</select>
        {showType && types.length > 1 && <select className="input sm" value={ty} onChange={(e) => setTy(e.target.value)} aria-label="Document type"><option value="all">All types</option>{types.map((t) => <option key={t} value={t}>{rows.find((r) => r.type === t)?.typeLabel ?? t}</option>)}</select>}
        <span className="tiny faint">{list.length} document{list.length === 1 ? "" : "s"}, newest first</span>
      </div>
      <div className="doc-list">
        {list.slice(0, n).map((r) => {
          const isFile = /\.(pdf|docx?|xlsx?)(\?|#|$)/i.test(r.url);
          return (
            <div key={r.url} className="doc-row">
              <div className="doc-main">
                <a href={r.url} target="_blank" rel="noopener noreferrer" className="doc-title">{r.title}</a>
                <div className="row wrap tiny" style={{ gap: 6, marginTop: 3 }}>
                  {showType && <Badge tone={TONE[r.type] ?? ""}>{r.typeLabel}</Badge>}
                  {r.fiscal_year && <span>FY {r.fiscal_year}</span>}
                  {r.quarter && <span>Q{r.quarter}</span>}
                  {(r.published || r.published_date) && <span className="faint">{nptDate(r.published ?? r.published_date)}</span>}
                  <span className="faint">{r.source}</span>
                  {r.verified === 1 && <span className="up">✓ opens ({r.content_type === "application/pdf" ? "PDF" : "file"})</span>}
                  {r.verified === 0 && <span className="down">couldn't open when checked</span>}
                  {r.offsite === 1 && <span className="warn-t">hosted outside the company's domain</span>}
                </div>
                {r.type === "unclassified" && <div className="tiny muted">{r.reason || "Type not stated in the title; open it to confirm before relying on it."}</div>}
              </div>
              <div className="row" style={{ gap: 6 }}>
                <a className="btn sm" href={r.url} target="_blank" rel="noopener noreferrer">{isFile ? "View" : "Open"}</a>
                {isFile && <a className="btn sm primary" href={r.url} download target="_blank" rel="noopener noreferrer">Download{/pdf/i.test(r.url) ? " PDF" : ""}</a>}
              </div>
            </div>
          );
        })}
      </div>
      {list.length > n && <button className="btn sm ghost" onClick={() => setN(n + 50)}>Show more ({list.length - n})</button>}
    </div>
  );
}

export function CompanyCentre({ sym, tab }: { sym: string; tab: CentreTab }) {
  const q = useCompanyDocs(sym);
  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading />;
  const d = q.data;
  const docs = (t: string[]) => d.docs.filter((x: Any) => t.includes(x.type));
  const fil = (t: string[]) => d.filings.filter((x: Any) => t.includes(x.type));
  if (tab === "quarterly") return (
    <div className="col">
      <Card title="Quarterly financial reports" sub="Interim statements for a stated quarter (usually unaudited). Never mixed with audited annual statements.">
        <OfficialLinks d={d} kinds={["quarterly", "investor"]} />
        <h4 className="sub-h">From the official website</h4>
        <DocList rows={docs(["quarterly"])} empty="No quarterly report PDFs listed on the official website" showType={false} />
        <h4 className="sub-h">Exchange filings</h4>
        <DocList rows={fil(["quarterly"])} empty="No quarterly report filings stored" showType={false} />
      </Card>
      <ReportCompare sym={sym} />
    </div>
  );
  if (tab === "annual") return (
    <div className="col">
      <Card title="Annual reports & audited financial statements" sub="Annual reports (yearly review, governance, statements) and audited statements with the independent auditor's report are listed separately.">
        <OfficialLinks d={d} kinds={["annual", "investor"]} />
        <h4 className="sub-h">Audited financial statements / auditor's report</h4>
        <DocList rows={[...docs(["audited"]), ...fil(["audited"])]} empty="No audited statements found on the official website or in filings yet" showType={false} />
        <h4 className="sub-h">Annual reports</h4>
        <DocList rows={[...docs(["annual"]), ...fil(["annual"])]} empty="No annual report found yet" showType={false} />
        {(docs(["unclassified"]).length + fil(["unclassified"]).length) > 0 && <><h4 className="sub-h">Unclassified financial documents</h4><p className="tiny muted" style={{ margin: "0 0 6px" }}>Financial documents whose type isn't stated in their title or file name. Open them to check before relying on them.</p><DocList rows={[...docs(["unclassified"]), ...fil(["unclassified"])]} empty="" showType={false} /></>}
        {(() => { const a = d.events.find((e: Any) => e.kind === "Auditor appointment"); return a ? <p className="small" style={{ marginTop: 10 }}>Latest auditor notice: <a href={a.url} target="_blank" rel="noopener noreferrer">{a.title}</a> ({nptDate(a.published_date)})</p> : null; })()}
        <p className="tiny faint">Audited statements are published before each AGM, usually within six months after the fiscal year ends in mid-July.</p>
      </Card>
    </div>
  );
  if (tab === "notices") return (
    <div className="col">
      <Card title="Notices & announcements" sub="Official notices from the company's website and its exchange filings (AGM, dividends, book closure, rights, auctions)">
        <OfficialLinks d={d} kinds={["notices"]} />
        <h4 className="sub-h">Exchange filings & corporate events</h4>
        <DocList rows={[...fil(["notice"]), ...d.events.map((e: Any) => ({ ...e, type: "notice", typeLabel: e.kind, source: "NEPSE corporate event (via ShareSansar)" }))].sort((a: Any, b: Any) => (b.published_date ?? "").localeCompare(a.published_date ?? "")).filter((x: Any, i: number, arr: Any[]) => arr.findIndex((y) => y.url === x.url) === i)} empty="No announcements stored yet" showType={false} />
        <h4 className="sub-h">Notices on the official website</h4>
        <DocList rows={docs(["notice"])} empty="No notice documents listed on the official website" showType={false} />
      </Card>
    </div>
  );
  if (tab === "news") return (
    <Card title="News" sub="The company's own news page, and headlines that name it">
      <OfficialLinks d={d} kinds={["news"]} />
      <h4 className="sub-h">Headlines mentioning {d.symbol}</h4>
      <DocList rows={d.news.map((n: Any) => ({ ...n, type: "other", typeLabel: "News", source: "ShareSansar news" }))} empty={`No stored headlines mention ${d.symbol}`} showType={false} />
    </Card>
  );
  return (
    <Card title="Downloads" sub="Every document the official website links to, by type">
      <OfficialLinks d={d} kinds={["downloads", "investor"]} />
      <h4 className="sub-h">All official documents</h4>
      <DocList rows={d.docs} empty="No downloadable documents were found on the official website" />
    </Card>
  );
}

export function ReportCompare({ sym }: { sym: string }) {
  const [peers, setPeers] = useState<string[]>([]);
  const [add, setAdd] = useState("");
  const r = useApi<Any>(`/stocks/${sym}/report-compare${peers.length ? `?with=${peers.join(",")}` : ""}`, [sym, peers.join(",")]);
  const [sel, setSel] = useState<string[] | null>(null);
  const reps: Any[] = r.data?.reports ?? [];
  const key = (x: Any) => `${x.symbol}|${x.fiscalYear}|${x.quarter}`;
  const chosen = reps.filter((x) => (sel ?? reps.slice(0, 4).map(key)).includes(key(x)));
  const metrics = (r.data?.metrics ?? []).filter((m: Any) => chosen.some((c) => c.figures[m.key] != null));
  const fmt = (v: number | null, u: string) => v == null ? "—" : u === "Rs. '000" ? compact(v * 1000) : u === "%" ? `${num(v, 2)}%` : num(v, 2);
  return (
    <Card title="Compare financial reports" sub="Pick two or more quarterly reports, of this company or of peers, to compare key figures side by side">
      {!r.data ? <Loading /> : (
        <div className="col" style={{ gap: 10 }}>
          <div className="chips">{reps.map((x) => { const k = key(x), on = (sel ?? reps.slice(0, 4).map(key)).includes(k); return <button key={k} className={`chip ${on ? "on" : ""}`} onClick={() => { const cur = sel ?? reps.slice(0, 4).map(key); setSel(on ? cur.filter((y) => y !== k) : [...cur, k]); }}>{x.symbol} · Q{x.quarter} {x.fiscalYear}</button>; })}</div>
          <form className="row" onSubmit={(e) => { e.preventDefault(); const s = add.trim().toUpperCase(); if (s && !peers.includes(s) && s !== sym) { setPeers([...peers, s].slice(0, 5)); setSel(null); } setAdd(""); }}>
            <input className="input sm" style={{ width: 160 }} placeholder="Add a peer, e.g. NABIL" value={add} onChange={(e) => setAdd(e.target.value)} />
            <button className="btn sm">Add company</button>
            {peers.map((p) => <button key={p} type="button" className="chip" onClick={() => setPeers(peers.filter((x) => x !== p))}>{p} ✕</button>)}
          </form>
          {reps.filter((x) => x.symbol === sym).length < 2 && <Notice>Only {reps.filter((x) => x.symbol === sym).length} quarterly report of {sym} is stored so far. The app saves every new quarter automatically, so quarter-on-quarter comparison grows over time; older quarters are in the official PDFs above. You can already compare with peers' latest reports.</Notice>}
          {chosen.length < 2 ? <p className="small muted">Select at least two reports.</p> : (
            <div className="table-wrap"><table className="t small">
              <thead><tr><th>Figure</th>{chosen.map((c) => <th key={key(c)} className="num">{c.symbol}<br /><span className="tiny faint">Q{c.quarter} {c.fiscalYear}</span></th>)}{chosen.length === 2 && <th className="num">Change</th>}</tr></thead>
              <tbody>{metrics.map((m: Any) => { const a = chosen[0].figures[m.key], b = chosen[1]?.figures[m.key], ch = chosen.length === 2 ? changePct(b, a) : null; return (
                <tr key={m.key}><td>{m.label}</td>{chosen.map((c) => <td key={key(c)} className="num mono">{fmt(c.figures[m.key], m.unit)}</td>)}{chosen.length === 2 && <td className={`num ${ch == null || m.higherIsBetter == null ? "" : (ch > 0) === m.higherIsBetter ? "up" : "down"}`}>{ch == null ? "—" : `${ch > 0 ? "+" : ""}${ch}%`}</td>}</tr>
              ); })}</tbody>
            </table></div>
          )}
          <p className="tiny faint">{r.data.note} Change compares the first column with the second.</p>
        </div>
      )}
    </Card>
  );
}
