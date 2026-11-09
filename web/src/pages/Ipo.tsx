// IPO & FPO center: open now, upcoming, recent listings with listing gains, a calendar, and the
// official links to apply (Mero Share), check allotment (CDSC) and read prospectuses (SEBON).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, Badge, Stat, Seg, Empty, Notice } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { num, pct, tone, nptDate, int } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const LINKS = [
  { label: "Apply in Mero Share", url: "https://meroshare.cdsc.com.np", note: "Log in → My ASBA → Apply for Issue" },
  { label: "Check IPO allotment", url: "https://iporesult.cdsc.com.np", note: "Choose the company, enter your BOID" },
  { label: "Read prospectuses (SEBON)", url: "https://www.sebon.gov.np/prospectus", note: "Issue price, use of funds, risks" },
];
const BOIDS = "ss-boids";

export default function Ipo() {
  const iss = useApi<Any[]>("/issues");
  const stats = useApi<Any>("/issues/ipo-stats");
  const [tab, setTab] = useState<"open" | "upcoming" | "listed" | "all">("open");
  const [msg, setMsg] = useState<string | null>(null);
  const [boids, setBoids] = useState<{ name: string; boid: string }[]>(() => { try { return JSON.parse(localStorage.getItem(BOIDS) || "[]"); } catch { return []; } });
  const [nb, setNb] = useState({ name: "", boid: "" });
  const saveB = (x: typeof boids) => { setBoids(x); try { localStorage.setItem(BOIDS, JSON.stringify(x)); } catch { /* ignore */ } };
  const rows = useMemo(() => (iss.data ?? []).filter((r: Any) => /IPO|FPO|Mutual fund|Right/.test(r.issue_type)), [iss.data]);
  const open = rows.filter((r: Any) => r.statusLabel === "Open now");
  const upcoming = rows.filter((r: Any) => r.statusLabel === "Opening soon" || r.statusLabel === "Approved / upcoming");
  const listed = rows.filter((r: Any) => r.statusLabel === "Listed" && r.performance?.firstDayPct != null).slice(0, 30);
  const list = tab === "open" ? open : tab === "upcoming" ? upcoming : tab === "listed" ? listed : rows.slice(0, 80);
  const remind = async () => { try { await api("/alerts", { body: { type: "ipo", params: {}, note: "New IPO/FPO", repeat: true } }); setMsg("You'll get a notification when a new IPO or FPO is announced."); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } };
  return (
    <div className="page">
      <div className="page-head"><div><h1>IPO & FPO</h1><p className="small muted">Public issues in Nepal: what is open, what is coming, and how recent listings did. Apply only through Mero Share (ASBA).</p></div><button className="btn" onClick={remind}><I.alerts /> Remind me of new issues</button></div>
      {msg && <Notice>{msg}</Notice>}
      <div className="grid g4">
        <Stat label="Open now" value={open.length} />
        <Stat label="Upcoming" value={upcoming.length} />
        <Stat label="Median first-day gain" value={stats.data?.medianFirstDayPct != null ? pct(stats.data.medianFirstDayPct, 0) : "—"} sub={stats.data ? `${stats.data.count} listings with history` : ""} />
        <Stat label="Above issue price after 20 sessions" value={stats.data?.pctAboveIssueAfter20 != null ? `${stats.data.pctAboveIssueAfter20}%` : "—"} />
      </div>
      <div className="grid g3">{LINKS.map((l) => <a key={l.url} className="opt" href={l.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none", color: "inherit" }}><strong>{l.label} <I.external /></strong><span className="small muted">{l.note}</span></a>)}</div>
      <Card title="Issues" actions={<Seg value={tab} onChange={setTab} options={[{ key: "open", label: `Open (${open.length})` }, { key: "upcoming", label: `Upcoming (${upcoming.length})` }, { key: "listed", label: "Recent listings" }, { key: "all", label: "All" }]} />}>
        {!iss.data ? <Loading /> : list.length === 0 ? <Empty title={tab === "open" ? "No issue is open right now" : "Nothing here"} /> : (
          <div className="list">{list.map((r: Any, i: number) => (
            <div key={i} className="list-row" style={{ alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div>{r.symbol ? <Link className="sym" to={`/stocks/${r.symbol}`}>{r.symbol}</Link> : null} <strong className="small">{r.company}</strong> <Badge tone={r.statusLabel === "Open now" ? "up" : r.statusLabel === "Listed" ? "" : "blue"}>{r.statusLabel}</Badge></div>
                <div className="tiny faint">{r.issue_type} · {r.sector ?? ""} · {r.units ? `${int(r.units)} units` : ""} {r.price ? `at Rs. ${num(r.price, 0)}` : ""} {r.issue_manager ? `· manager: ${r.issue_manager}` : ""}</div>
                <div className="tiny">{r.opening_date ? `Opens ${nptDate(r.opening_date)}` : "Opening date not announced"}{r.final_date || r.closing_date ? ` · closes ${nptDate(r.final_date || r.closing_date)}` : ""}{r.listing_date ? ` · listed ${nptDate(r.listing_date)}` : ""}</div>
              </div>
              {r.performance?.firstDayPct != null && <div style={{ textAlign: "right" }}><div className={`mono small ${tone(r.performance.sinceIssuePct)}`}>{pct(r.performance.sinceIssuePct, 0)}</div><div className="tiny faint">since issue · day 1 {pct(r.performance.firstDayPct, 0)}</div></div>}
              {r.statusLabel === "Open now" && <a className="btn sm primary" href="https://meroshare.cdsc.com.np" target="_blank" rel="noopener noreferrer">Apply</a>}
            </div>
          ))}</div>
        )}
        <p className="tiny faint" style={{ marginTop: 8 }}>Dates and units from ShareSansar's issue list. Listing gains use stored closes; new listings often rise over several sessions because of circuit limits, and past gains don't predict future ones.</p>
      </Card>
      <Card title="My BOIDs" sub="Saved only on this device, to copy quickly into the CDSC allotment page">
        {boids.map((b, i) => <div key={i} className="row between small" style={{ padding: "4px 0" }}><span>{b.name}</span><span className="row"><span className="mono">{b.boid}</span><button className="btn sm" onClick={() => navigator.clipboard?.writeText(b.boid)}>Copy</button><button className="btn ghost sm" onClick={() => saveB(boids.filter((_, k) => k !== i))}><I.trash /></button></span></div>)}
        <div className="row" style={{ marginTop: 8 }}>
          <input className="input" style={{ width: 140 }} placeholder="Name (e.g. Me, Mum)" value={nb.name} onChange={(e) => setNb({ ...nb, name: e.target.value })} />
          <input className="input" style={{ width: 200 }} inputMode="numeric" placeholder="16-digit BOID" value={nb.boid} onChange={(e) => setNb({ ...nb, boid: e.target.value.replace(/\D/g, "").slice(0, 16) })} />
          <button className="btn sm" disabled={nb.boid.length !== 16} onClick={() => { saveB([...boids, { name: nb.name || "BOID", boid: nb.boid }]); setNb({ name: "", boid: "" }); }}>Save</button>
          <a className="btn sm primary" href="https://iporesult.cdsc.com.np" target="_blank" rel="noopener noreferrer">Check allotment</a>
        </div>
      </Card>
    </div>
  );
}
