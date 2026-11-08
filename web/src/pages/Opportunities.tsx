import { Fragment } from "react";
import { useMemo, useState } from "react";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, Badge, Notice, Modal, Tabs, Empty, DataTable, Stat, Seg } from "../components/ui.tsx";
import { Link } from "react-router-dom";
import { num, pct, tone, compact, int } from "../lib/format.ts";
import { I } from "../components/icons.tsx";
import { nptDate } from "../lib/format.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
const RT: Record<string, { label: string; tone: "up" | "blue" | "warn" | "" }> = {
  contractual: { label: "Contractual rate", tone: "up" }, variable: { label: "Variable", tone: "warn" }, historical: { label: "Historical only", tone: "blue" }, projected: { label: "Projected", tone: "warn" }, unknown: { label: "Not an investment return", tone: "" },
};

export default function Opportunities() {
  const products = useApi<any[]>("/products");
  const resources = useApi<any[]>("/resources");
  const links = useApi<any>("/resources/link-status");
  const [tab, setTab] = useState<"products" | "issues" | "funds" | "directory">("products");
  const [cat, setCat] = useState("");
  const [q, setQ] = useState("");
  const [edit, setEdit] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const cats = useMemo(() => [...new Set((products.data ?? []).map((p) => p.category))], [products.data]);
  const status = (url: string) => links.data?.results?.find((r: any) => r.url === url);
  const shown = (products.data ?? []).filter((p) => (!cat || p.category === cat) && (!q || JSON.stringify(p).toLowerCase().includes(q.toLowerCase())));
  const check = async () => { setChecking(true); try { await api("/resources/check-links", { body: {} }); links.reload(); } finally { setChecking(false); } };
  const LinkStatus = ({ url }: { url: string }) => { const s = status(url); return s ? <span title={s.error || `HTTP ${s.status}`} className={`tiny ${s.ok ? "up" : "down"}`}>{s.ok ? "● reachable" : "● check failed"}</span> : null; };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Investment Opportunities in Nepal</h1><p>Shares, IPOs, mutual funds, government bonds, debentures, deposits, retirement schemes and insurance, with links to official sources.</p></div>
        <div className="row"><button className="btn" onClick={check} disabled={checking}>{checking ? <span className="spinner" /> : <I.refresh />} Check all links</button>{links.data && <span className="tiny faint">Last checked {nptDate(links.data.at, true)}</span>}</div>
      </div>
      <Notice tone="warn">Rates change. Contractual rates (FDs, bonds, debentures) are fixed only once you invest; variable and historical returns are not promises. This directory deliberately does not invent current rates: check the official source, then use <strong>Record rate</strong> to save the figure and the date you verified it.</Notice>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: "products", label: `Investment products (${products.data?.length ?? 0})` }, { key: "issues", label: "IPO / FPO / right issues" }, { key: "funds", label: "Mutual funds" }, { key: "directory", label: `Official resources (${resources.data?.length ?? 0})` }]} />
      {tab === "issues" && <Issues />}
      {tab === "funds" && <Funds />}
      {tab === "products" && (
        <>
          <div className="row">
            <input className="input" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
            <div className="pill-tabs"><button className="chip" style={!cat ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setCat("")}>All</button>{cats.map((c) => <button key={c} className="chip" style={cat === c ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined} onClick={() => setCat(c)}>{c}</button>)}</div>
            <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setEdit({ category: "Bank deposits", name: "", return_type: "contractual" })}><I.plus /> Add product</button>
          </div>
          {products.loading ? <Loading /> : (
            <div className="grid g2">
              {shown.map((p) => (
                <Card key={p.id} title={p.name} sub={`${p.category} · ${p.provider ?? ""}`} actions={<Badge tone={p.risk?.toLowerCase().includes("high") ? "down" : p.risk?.toLowerCase().includes("low") ? "up" : "warn"}>Risk: {p.risk}</Badge>}>
                  <p className="small">{p.description}</p>
                  <div className="row" style={{ margin: "6px 0" }}><Badge tone={RT[p.return_type]?.tone}>{RT[p.return_type]?.label ?? "Return"}</Badge><span className="small">{p.return_text}</span></div>
                  {p.verified_on && <div className="small up">Recorded by you: verified {p.verified_on} {p.source && p.source !== "Curated (Saphal Stocks seed); verify on the official site" ? `· ${p.source}` : ""}</div>}
                  <details className="small" style={{ marginTop: 6 }}>
                    <summary className="muted">Eligibility, minimum, lock-in, liquidity, tax, how to apply</summary>
                    <dl className="kv" style={{ marginTop: 8, gridTemplateColumns: "140px 1fr" }}>
                      {[["Eligibility", p.eligibility], ["Minimum", p.min_investment], ["Lock-in", p.lock_in], ["Duration", p.duration], ["Liquidity", p.liquidity], ["Tax", p.tax], ["Conditions", p.conditions], ["How to apply", p.how_to_apply]].map(([k, v]) => v ? <Fragment key={k}><dt>{k}</dt><dd style={{ textAlign: "left", fontFamily: "var(--font)" }}>{v}</dd></Fragment> : null)}
                    </dl>
                  </details>
                  <div className="row" style={{ marginTop: 8 }}>
                    {p.official_url && <a className="btn sm" href={p.official_url} target="_blank" rel="noopener noreferrer"><I.external /> Official site</a>}
                    {p.info_url && <a className="btn sm" href={p.info_url} target="_blank" rel="noopener noreferrer"><I.external /> Apply / info</a>}
                    {p.official_url && <LinkStatus url={p.official_url} />}
                    <button className="btn ghost sm" style={{ marginLeft: "auto" }} onClick={() => setEdit(p)}>Record rate / edit</button>
                  </div>
                </Card>
              ))}
              {!shown.length && <Empty title="No matching products" />}
            </div>
          )}
        </>
      )}
      {tab === "directory" && (
        <div className="grid g2">
          {resources.data?.map((r) => (
            <Card key={r.id} title={r.name} sub={r.category}>
              <p className="small">{r.description}</p>
              <div className="row">
                <a className="btn sm" href={r.url} target="_blank" rel="noopener noreferrer"><I.external /> {new URL(r.url).host}</a><LinkStatus url={r.url} />
                {r.links.map((l: any) => <a key={l.url} className="btn sm" href={l.url} target="_blank" rel="noopener noreferrer"><I.external /> {l.label}</a>)}
              </div>
            </Card>
          ))}
        </div>
      )}
      {edit && <ProductModal p={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); products.reload(); }} />}
    </div>
  );
}

function ProductModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ ...p, verified_on: p.verified_on ?? new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState<string | null>(null);
  const fields: [string, string, boolean?][] = [["name", "Name"], ["category", "Category"], ["provider", "Provider"], ["return_text", "Return / rate (as published)", true], ["min_investment", "Minimum investment"], ["lock_in", "Lock-in"], ["liquidity", "Liquidity"], ["tax", "Tax", true], ["official_url", "Official URL"], ["info_url", "Application / info URL"], ["source", "Where you verified it"], ["description", "Description", true]];
  const save = async () => {
    const body: Record<string, unknown> = {};
    for (const [k] of fields) body[k] = f[k] === "" ? null : f[k];
    body.return_type = f.return_type; body.verified_on = f.verified_on;
    try { if (p.id) await api(`/products/${p.id}`, { method: "PUT", body }); else await api("/products", { body }); onDone(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Modal title={p.id ? `Edit: ${p.name}` : "Add product"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="col">
        <div className="grid g2">
          <label className="field">Return type<select className="input" value={f.return_type ?? "unknown"} onChange={(e) => setF({ ...f, return_type: e.target.value })}>{Object.entries(RT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
          <label className="field">Verified on<input className="input" type="date" value={f.verified_on} onChange={(e) => setF({ ...f, verified_on: e.target.value })} /></label>
        </div>
        {fields.map(([k, label, long]) => <label key={k} className="field">{label}{long ? <textarea className="input" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} style={{ minHeight: 50 }} /> : <input className="input" value={f[k] ?? ""} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</label>)}
        {err && <Notice tone="warn">{err}</Notice>}
      </div>
    </Modal>
  );
}

function Issues() {
  const [type, setType] = useState("IPO");
  const [filter, setFilter] = useState<"active" | "all">("active");
  const rows = useApi<any[]>(`/issues?type=${encodeURIComponent(type)}`, [type]);
  const stats = useApi<any>("/issues/ipo-stats");
  const shown = (rows.data ?? []).filter((r) => filter === "all" || ["Open now", "Opening soon", "Approved / upcoming"].includes(r.statusLabel) || (r.listing_date && Date.parse(r.listing_date) > Date.now() - 120 * 86_400_000));
  const st = stats.data;
  const tones: Record<string, "up" | "blue" | "warn" | ""> = { "Open now": "up", "Opening soon": "blue", "Approved / upcoming": "warn", Listed: "", Closed: "" };
  return (
    <div className="col">
      {type === "IPO" && st && (
        <div className="grid g4">
          <Stat label="IPOs with listing history" value={st.count} sub={`${st.skippedNoListingHistory} recent listings lack early price data`} />
          <Stat label="Median first-session close" value={pct(st.medianFirstDayPct, 0)} sub="vs issue price" />
          <Stat label="Median after 20 sessions" value={pct(st.median20SessionPct, 0)} sub={`${st.pctAboveIssueAfter20}% above issue price`} />
          <Stat label="Median since issue (today)" value={pct(st.medianNowPct, 0)} />
        </div>
      )}
      {type === "IPO" && <Notice>Listing gains have historically been large because most IPOs are priced at Rs. 100 and NEPSE's first-day price band lets new listings rise in steps. This is past data, not a promise: allotment is a lottery, and many IPO stocks later fall from their post-listing peaks. {st?.note}</Notice>}
      <div className="row">
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>{["IPO", "FPO", "Right share", "IPO (local quota)", "IPO (foreign-employed quota)", "IPO (QIIs)", "Mutual fund"].map((t) => <option key={t}>{t}</option>)}</select>
        <Seg value={filter} onChange={setFilter} options={[{ key: "active", label: "Open, upcoming & recent" }, { key: "all", label: "All" }]} />
        <a className="btn sm" href="https://iporesult.cdsc.com.np" target="_blank" rel="noopener noreferrer"><I.external /> Check allotment result</a>
        <a className="btn sm" href="https://meroshare.cdsc.com.np" target="_blank" rel="noopener noreferrer"><I.external /> Apply in Mero Share</a>
      </div>
      <Card flush sub="Source: ShareSansar issue list (refreshed daily)">
        {rows.loading && !rows.data ? <Loading /> : (
          <DataTable rows={shown} empty="Nothing open or upcoming right now" cols={[
            { key: "statusLabel", label: "Status", render: (r: any) => <Badge tone={tones[r.statusLabel]}>{r.statusLabel}</Badge> },
            { key: "symbol", label: "Company", render: (r: any) => <>{r.symbol ? <Link to={`/stocks/${r.symbol}`} className="sym">{r.symbol}</Link> : null}<div className="small">{r.company}</div><div className="tiny faint">{r.sector ?? ""}</div></> },
            { key: "units", label: "Units", num: true, render: (r: any) => int(r.units) },
            { key: "price", label: "Price", num: true, render: (r: any) => r.price_low ? `${num(r.price_low)}–${num(r.price_high)}` : num(r.price) },
            { key: "ratio", label: "Ratio", render: (r: any) => r.ratio ?? "—" },
            { key: "opening_date", label: "Opens", render: (r: any) => r.opening_date ? nptDate(r.opening_date) : "—" },
            { key: "closing_date", label: "Closes", render: (r: any) => r.closing_date ? nptDate(r.final_date || r.closing_date) : "—" },
            { key: "listing_date", label: "Listed", render: (r: any) => r.listing_date ? nptDate(r.listing_date) : "—" },
            { key: "perf", label: "Since issue", num: true, sort: (r: any) => r.performance?.sinceIssuePct, render: (r: any) => r.performance?.sinceIssuePct != null ? <span className={tone(r.performance.sinceIssuePct)}>{pct(r.performance.sinceIssuePct, 0)}</span> : <span className="tiny faint" title={r.performance?.note}>{r.performance?.note ? "no early data" : "—"}</span> },
            { key: "issue_manager", label: "Issue manager", render: (r: any) => <span className="small muted">{r.issue_manager}</span> },
          ]} />
        )}
      </Card>
    </div>
  );
}

function Funds() {
  const f = useApi<any[]>("/funds");
  const [kind, setKind] = useState<"active" | "matured">("active");
  const rows = (f.data ?? []).filter((x) => x.kind === kind);
  return (
    <div className="col">
      <Notice>Close-ended mutual funds trade on NEPSE, often at a <strong>discount</strong> to their net asset value (NAV): you buy Rs. 10 of assets for less. A discount can persist until maturity. NAV history is stored from now on, so NAV growth comparisons improve over time. Open-ended funds (SIPs) are bought from the fund manager; check each manager's site for their NAV.</Notice>
      <Seg value={kind} onChange={setKind} options={[{ key: "active", label: "Listed (active)" }, { key: "matured", label: "Matured / other" }]} />
      <Card flush sub="Source: ShareSansar mutual fund NAV list">
        {f.loading && !f.data ? <Loading /> : (
          <DataTable rows={rows} initialSort={{ key: "premium_pct", dir: 1 }} cols={[
            { key: "symbol", label: "Fund", render: (r: any) => <><Link to={`/stocks/${r.symbol}`} className="sym">{r.symbol}</Link><div className="small">{r.name}</div></> },
            { key: "fund_size", label: "Fund size", num: true, render: (r: any) => compact(r.fund_size) },
            { key: "weekly_nav", label: "Weekly NAV", num: true, render: (r: any) => <>{num(r.weekly_nav)}<div className="tiny faint">{nptDate(r.weekly_date)}</div></> },
            { key: "monthly_nav", label: "Monthly NAV", num: true, render: (r: any) => <>{num(r.monthly_nav)}<div className="tiny faint">{r.monthly_date}</div></> },
            { key: "ltp", label: "Market price", num: true, render: (r: any) => num(r.ltp) },
            { key: "premium_pct", label: "Premium / discount", num: true, render: (r: any) => <span className={r.premium_pct < 0 ? "up" : "down"}>{pct(r.premium_pct, 1)}</span> },
            { key: "priceReturn1y", label: "Price 1Y", num: true, render: (r: any) => <span className={tone(r.priceReturn1y)}>{pct(r.priceReturn1y, 1)}</span> },
            { key: "maturity_date", label: "Matures", render: (r: any) => <>{nptDate(r.maturity_date)}<div className="tiny faint">{r.maturity_period}</div></> },
          ]} />
        )}
      </Card>
      <p className="tiny faint">Green discount = market price below NAV. Fund performance should be judged on NAV growth plus distributions over several years, not on market price alone.</p>
    </div>
  );
}
