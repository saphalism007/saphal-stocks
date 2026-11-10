// Brokers & Funds: every mutual fund with its manager, official website and (where the manager's own site
// links one) the online SIP/apply page; every licensed stockbroker (SEBON) and broker activity by number.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Tabs, Badge, Loading, ErrorBox, Notice } from "../components/ui.tsx";
import { compact, num, nptDate, tone } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tab = "funds" | "brokers" | "activity" | "managers";
const host = (u: string) => { try { return new URL(u).host.replace(/^www\./, ""); } catch { return u; } };

export default function Directory() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "funds";
  return (
    <div className="page">
      <div className="page-head"><div><h1>Brokers & Mutual Funds</h1><p className="muted">Every mutual fund with its fund manager's official website and direct apply link where available, every SEBON-licensed stockbroker, and which brokers are buying or selling.</p></div></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ key: "funds", label: "Mutual funds" }, { key: "brokers", label: "Stockbrokers" }, { key: "activity", label: "Broker activity" }, { key: "managers", label: "Fund managers" }]} />
      {tab === "funds" && <Funds />}
      {tab === "brokers" && <Brokers />}
      {tab === "activity" && <Activity />}
      {tab === "managers" && <Managers />}
    </div>
  );
}

function Funds() {
  const d = useApi<Any>("/funds/directory");
  const [type, setType] = useState<"all" | "Open-ended" | "Close-ended">("all");
  const [q, setQ] = useState("");
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const list = d.data.funds.filter((f: Any) => (type === "all" || f.type === type) && (!q || `${f.name} ${f.symbol} ${f.manager ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="col">
      <div className="row" style={{ gap: 8 }}>
        <input className="input" placeholder="Search fund or manager…" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: "1 1 180px", maxWidth: 300 }} />
        <div className="chips">{(["all", "Open-ended", "Close-ended"] as const).map((t) => <button key={t} className={`chip ${type === t ? "on" : ""}`} onClick={() => setType(t)}>{t === "all" ? "All" : t}</button>)}</div>
      </div>
      <Notice id="fund-how">
        <b>Open-ended</b> funds: buy or redeem units directly from the fund manager at the day's NAV — start a SIP (monthly plan) on their website or at their office/partner bank. <b>Close-ended</b> funds: listed on NEPSE, bought and sold through your broker (TMS) like shares; compare price with NAV (a discount means you pay less than the fund is worth).
      </Notice>
      <div className="fd-list">{list.map((f: Any) => (
        <div key={f.symbol} className="fd">
          <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
            <div style={{ minWidth: 0 }}><b>{f.name}</b> <span className="tiny faint mono">{f.symbol}</span><div className="tiny faint">{f.manager ?? "Manager not in SEBON's current fund-manager list"}</div></div>
            <Badge tone={f.type === "Open-ended" ? "up" : "accent"}>{f.type}</Badge>
          </div>
          <div className="fd-kv">
            <span>NAV <b>{f.daily_nav ?? f.weekly_nav ?? "—"}</b><em>{f.daily_date ? nptDate(f.daily_date) : f.weekly_date ? nptDate(f.weekly_date) : ""}</em></span>
            {f.type === "Close-ended" ? <>
              <span>Price <b>{f.ltp ?? "—"}</b></span>
              <span>vs NAV <b className={tone(f.premium_pct != null ? -f.premium_pct : null)}>{f.premium_pct != null ? `${f.premium_pct > 0 ? "+" : ""}${num(f.premium_pct, 1)}%` : "—"}</b><em>{f.premium_pct != null ? (f.premium_pct < 0 ? "discount" : "premium") : ""}</em></span>
              <span>Matures <b>{f.maturity_date ? f.maturity_date.slice(0, 4) : "—"}</b></span>
            </> : <span>Fund size <b>{f.fund_size ? compact(f.fund_size) : "—"}</b></span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {f.type === "Open-ended" && f.applyUrl && <a className="btn sm primary" href={f.applyUrl} target="_blank" rel="noopener noreferrer">Apply / SIP online ↗</a>}
            {f.website && <a className="btn sm" href={f.website} target="_blank" rel="noopener noreferrer">{host(f.website)} ↗</a>}
            {f.type === "Close-ended" && <Link className="btn sm" to={`/stocks/${f.symbol}`}>Buy via broker (TMS)</Link>}
            {!f.website && f.phone && <a className="btn sm ghost" href={`tel:${String(f.phone).split(/[,/]/)[0].replace(/[^0-9+]/g, "")}`}>Call {String(f.phone).split(/[,/]/)[0]}</a>}
          </div>
          {f.type === "Open-ended" && !f.applyUrl && <div className="tiny faint">{f.manager ? <>No online SIP link on the manager's homepage{f.website ? "; use their website's SIP or contact page" : ""}{f.email ? ` or email ${f.email}` : ""}.</> : "Ask the fund's sponsor bank branch to start a SIP; the manager isn't in SEBON's current list."}</div>}
        </div>
      ))}</div>
      <p className="tiny faint">Websites are taken from SEBON's official fund-manager list and kept only when they open on the company's own domain and name the company; apply links are the ones each manager's own homepage links to. Checked every two weeks.</p>
    </div>
  );
}

function Brokers() {
  const d = useApi<Any>("/brokers");
  const [q, setQ] = useState("");
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const list = d.data.sebon.filter((b: Any) => !q || `${b.name} ${b.address ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="col">
      <input className="input" placeholder="Search broker name or place (e.g. Pokhara)…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360 }} />
      <p className="small muted" style={{ margin: 0 }}>{d.data.sebon.length} brokers licensed by SEBON. To open a trading account you need a demat account (MeroShare) and a broker; most brokers offer online KYC through their TMS.</p>
      <div className="fd-list">{list.map((b: Any) => (
        <div key={b.name} className="fd">
          <b>{b.name}</b>
          <div className="tiny muted">{b.address ?? "—"}</div>
          <div className="row" style={{ gap: 6 }}>
            {b.phone && <a className="btn sm" href={`tel:${String(b.phone).split(/[,/]/)[0].replace(/[^0-9+]/g, "")}`}>📞 {String(b.phone).split(/[,/]/)[0]}</a>}
            {b.email && <a className="btn sm ghost" href={`mailto:${b.email}`}>✉ {b.email}</a>}
          </div>
          {b.contact && <div className="tiny faint">Contact: {b.contact}</div>}
        </div>
      ))}</div>
      <p className="tiny faint">Source: Securities Board of Nepal (SEBON) list of stockbrokers. Broker numbers and TMS addresses are on the Broker activity tab.</p>
    </div>
  );
}

function Activity() {
  const d = useApi<Any>("/brokers");
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  const a = d.data;
  if (!a.activity.length) return <Notice>No floorsheet data stored yet.</Notice>;
  return (
    <div className="col">
      <p className="small muted" style={{ margin: 0 }}>Buying and selling by broker number over {a.sessions} session{a.sessions === 1 ? "" : "s"} ({a.from ? nptDate(a.from) : ""}{a.to && a.to !== a.from ? ` – ${nptDate(a.to)}` : ""}), from the floorsheet. Net buying across many sessions can signal accumulation by big players.</p>
      <div className="table-scroll"><table className="t small">
        <thead><tr><th>Broker</th><th className="num">Bought</th><th className="num">Sold</th><th className="num">Net</th><th>Buying most</th><th>Selling most</th><th>TMS</th></tr></thead>
        <tbody>{a.activity.map((x: Any) => (
          <tr key={x.broker}>
            <td><b>#{x.broker}</b></td><td className="num">{compact(x.buy)}</td><td className="num">{compact(x.sell)}</td><td className={`num ${tone(x.net)}`}>{compact(x.net)}</td>
            <td>{x.accumulating.map((s: Any) => <Link key={s.symbol} className="mono" to={`/stocks/${s.symbol}?tab=brokers`} style={{ marginRight: 6 }}>{s.symbol}</Link>)}</td>
            <td>{x.distributing.map((s: Any) => <Link key={s.symbol} className="mono" to={`/stocks/${s.symbol}?tab=brokers`} style={{ marginRight: 6 }}>{s.symbol}</Link>)}</td>
            <td><a href={x.tms} target="_blank" rel="noopener noreferrer" className="tiny">tms{x.broker} ↗</a></td>
          </tr>
        ))}</tbody>
      </table></div>
      <p className="tiny faint">TMS addresses follow NEPSE's tms&lt;broker number&gt;.nepsetms.com.np pattern; they open only from Nepal. Full trade-by-trade data is on the <Link to="/floorsheet">Floorsheet</Link> page.</p>
    </div>
  );
}

function Managers() {
  const d = useApi<Any>("/funds/directory");
  if (d.error) return <ErrorBox error={d.error} onRetry={d.reload} />;
  if (!d.data) return <Loading />;
  return (
    <div className="fd-list">{d.data.managers.map((m: Any) => (
      <div key={m.name} className="fd">
        <b>{m.name}</b>
        <div className="tiny muted">{m.address ?? ""}</div>
        <div className="tiny">{d.data.funds.filter((f: Any) => f.manager === m.name).map((f: Any) => f.symbol).join(", ") || "No funds matched"}</div>
        <div className="row" style={{ gap: 6 }}>
          {m.website ? <a className="btn sm" href={m.website} target="_blank" rel="noopener noreferrer">{host(m.website)} ↗</a> : <span className="tiny faint">Website not confirmed</span>}
          {m.apply_url && <a className="btn sm primary" href={m.apply_url} target="_blank" rel="noopener noreferrer">{m.apply_label ?? "Apply"} ↗</a>}
          {m.phone && <a className="btn sm ghost" href={`tel:${String(m.phone).split(/[,/]/)[0].replace(/[^0-9+]/g, "")}`}>📞 {String(m.phone).split(/[,/]/)[0]}</a>}
        </div>
      </div>
    ))}</div>
  );
}
