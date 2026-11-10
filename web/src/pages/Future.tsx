// Invest for the Future: what small monthly amounts can grow to under clearly stated assumptions,
// every legitimate option in Nepal with how to start, risk, liquidity, tax and a checked official
// link, provider websites (banks, finance companies, fund managers) and long-term stock ideas.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, ErrorBox, Badge, Seg, NumInput, DataTable } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { compact, num, nptDate, rs } from "../lib/format.ts";
import { futureMonthly } from "../../../shared/money.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const AMOUNTS = [500, 1000, 2000, 5000];
const YEARS = [1, 3, 5, 10, 20];

export default function Future() {
  const f = useApi<Any>("/future");
  const [scen, setScen] = useState<"fd" | "balanced" | "equity">("balanced");
  const [custom, setCustom] = useState(10000);
  const [cat, setCat] = useState("all");
  const assumptions = useMemo(() => {
    const r = f.data?.rates;
    if (!r) return null;
    const fdNet = r.fdPct != null ? r.fdPct * (1 - r.interestTaxPct / 100) : null;
    const eq = r.equityLongRunPct;
    return {
      fd: { rate: fdNet, label: "Recurring / fixed deposit", text: fdNet != null ? `${num(fdNet, 2)}% a year after 6% tax (${r.sources.fd}). Contractual while you hold the deposit; rates change for new deposits.` : "Unavailable" },
      balanced: { rate: fdNet != null && eq != null ? (fdNet + eq) / 2 : null, label: "Balanced (half deposits, half funds/shares)", text: fdNet != null && eq != null ? `${num((fdNet + eq) / 2, 2)}% a year: average of the deposit rate and NEPSE's 10-year return. Not guaranteed.` : "Unavailable" },
      equity: { rate: eq, label: "Equity (NEPSE / equity mutual funds)", text: eq != null ? `${num(eq, 2)}% a year: NEPSE's last-10-year growth plus dividends (${r.sources.equity}). Not guaranteed; can be negative for years.` : "Unavailable" },
    };
  }, [f.data]);
  if (f.error) return <ErrorBox error={f.error} onRetry={f.reload} />;
  if (!f.data || !assumptions) return <div className="page"><Loading /></div>;
  const a = assumptions[scen];
  const cats = ["all", ...new Set(f.data.products.map((p: Any) => p.category))] as string[];
  const products = f.data.products.filter((p: Any) => cat === "all" || p.category === cat);
  const Check = ({ c }: { c: Any }) => c ? (c.ok ? <span className="tiny up" title={`HTTP ${c.status}`}><I.check /> link checked {nptDate(c.checked_at)}</span> : <span className="tiny warn" title="Some Nepal sites block requests from outside Nepal">couldn't reach {nptDate(c.checked_at)}</span>) : <span className="tiny faint">not checked yet</span>;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Invest for the Future</h1><p className="small muted">Start small, invest every month, and choose options that match how long you can leave the money. Projections use stated assumptions and are never guaranteed.</p></div></div>
      <Card title="What a monthly amount can grow to" sub={a.text} actions={<Seg value={scen} onChange={setScen} options={[{ key: "fd", label: "Deposit" }, { key: "balanced", label: "Balanced" }, { key: "equity", label: "Equity" }]} />}>
        {a.rate == null ? <p className="small">Rates unavailable; update market data.</p> : (
          <div className="table-scroll">
            <table className="t small">
              <thead><tr><th>Monthly</th>{YEARS.map((y) => <th key={y} className="num">{y} yr</th>)}</tr></thead>
              <tbody>
                {[...AMOUNTS, custom].map((m, i) => <tr key={i}><td>{i === AMOUNTS.length ? <NumInput className="input" style={{ width: 110 }} value={custom} min={0} onChange={(e) => setCustom(Number(e.target.value) || 0)} /> : <strong>{rs(m, 0)}</strong>}</td>{YEARS.map((y) => <td key={y} className="num">{compact(futureMonthly(m, a.rate!, y * 12))}<span className="tiny faint" style={{ display: "block" }}>paid {compact(m * 12 * y)}</span></td>)}</tr>)}
              </tbody>
            </table>
          </div>
        )}
        <p className="tiny faint">{a.label}. Monthly compounding; ignores fees beyond tax on deposit interest and assumes the same return every year, which real markets never deliver. Inflation ({num(f.data.rates.inflationPct, 2)}% now) reduces what the future amount buys.</p>
      </Card>
      <Card title="Ways to invest in Nepal" sub="Minimum, how to start, return, risk, liquidity, tax and the official link" actions={<select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>{cats.map((c) => <option key={c} value={c}>{c === "all" ? "All types" : c}</option>)}</select>}>
        <div className="opt-grid">
          {products.map((p: Any) => (
            <div key={p.id} className="opt">
              <div className="row between" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><strong style={{ minWidth: 0 }}>{p.name}</strong><Badge tone={/low/i.test(p.risk ?? "") ? "up" : /high/i.test(p.risk ?? "") ? "down" : "warn"}>{(p.risk ?? "—").replace(/\s*\(.*$/, "")} risk</Badge></div>
              <div className="tiny faint">{p.category}{p.provider ? ` · ${p.provider}` : ""}</div>
              {p.risk && /\(/.test(p.risk) && <div className="tiny muted">Risk: {p.risk}</div>}
              <dl className="kv text small">
                <dt>Return</dt><dd>{p.return_text ?? "—"} {p.return_type === "contractual" ? <Badge tone="up">contractual</Badge> : p.return_type ? <Badge>{p.return_type}</Badge> : null}</dd>
                <dt>Minimum</dt><dd>{p.min_investment ?? "—"}</dd>
                <dt>Period</dt><dd>{[p.duration, p.lock_in && p.lock_in !== "None" ? `lock-in: ${p.lock_in}` : null].filter(Boolean).join(" · ") || "—"}</dd>
                <dt>Liquidity</dt><dd>{p.liquidity ?? "—"}</dd>
                <dt>Tax & fees</dt><dd>{p.tax ?? "—"}</dd>
                <dt>How to start</dt><dd>{p.how_to_apply ?? "—"}</dd>
                {p.suitableFor && <><dt>Suits</dt><dd>{p.suitableFor}</dd></>}
              </dl>
              <div className="row" style={{ marginTop: 6 }}>
                {p.official_url && <a className="btn sm primary" href={p.official_url} target="_blank" rel="noopener noreferrer"><I.external /> Visit provider</a>}
                {p.info_url && <a className="btn sm" href={p.info_url} target="_blank" rel="noopener noreferrer">Learn more</a>}
                {/^mf-/.test(p.seed_key ?? "") && <Link className="btn sm" to="/directory">Every fund + apply links</Link>}
              </div>
              <div className="row" style={{ gap: 8 }}><Check c={p.officialCheck} />{p.verified_on && <span className="tiny faint">details verified {p.verified_on}</span>}</div>
            </div>
          ))}
        </div>
        <p className="tiny faint" style={{ marginTop: 8 }}>{f.data.linkNote} Nothing here means a product is currently open for applications; check the provider. Current rates: <Link to="/invest?tab=deposits">deposit comparison</Link>, <Link to="/invest?tab=rates">NRB rates</Link>.</p>
      </Card>
      <div className="grid g2">
        <Card title="Banks, finance companies and fund managers" sub="Official websites (from their NEPSE listings), latest rate notice">
          {f.data.providers.length === 0 ? <p className="small muted">Provider websites are collected on the daily data refresh.</p> : (
            <DataTable rows={f.data.providers} rowKey={(p: Any) => p.symbol} maxHeight={420} cols={[
              { key: "name", label: "Provider", render: (p: Any) => <span><span className="sym">{p.symbol}</span> <span className="small">{p.name}</span><span className="tiny faint" style={{ display: "block" }}>{p.sector}</span></span> },
              { key: "website", label: "", render: (p: Any) => <span className="col" style={{ gap: 2 }}><a className="btn sm" href={p.website} target="_blank" rel="noopener noreferrer"><I.external /> Visit</a><Check c={p.check} /></span> },
              { key: "notice", label: "Rates", render: (p: Any) => p.rateNotice ? <a className="small" href={p.rateNotice.image_url ?? p.rateNotice.url} target="_blank" rel="noopener noreferrer">Notice {nptDate(p.rateNotice.published)}</a> : <span className="tiny faint">—</span> },
            ]} />
          )}
        </Card>
        <Card title="Long-term stock ideas" sub="Strong fundamentals, no red flags, reasonable valuation" actions={<Link className="btn sm" to="/trading?tab=longterm">All</Link>}>
          {f.data.longTerm.length === 0 ? <p className="small muted">None meet every condition today.</p> : <div className="list">{f.data.longTerm.map((x: Any) => (
            <Link key={x.symbol} to={`/stocks/${x.symbol}`} className="list-row" style={{ color: "inherit", textDecoration: "none" }}>
              <span style={{ flex: 1 }}><span className="sym">{x.symbol}</span> <span className="small">{x.name}</span><span className="tiny faint" style={{ display: "block" }}>Score {x.fundamentalScore} · P/E {num(x.pe, 1)} · ROE {num(x.roe, 1)}%{x.cashYield != null ? ` · cash yield ${num(x.cashYield, 1)}%` : ""}</span></span>
              <span className="mono small">{num(x.price)}</span>
            </Link>
          ))}</div>}
          <p className="tiny faint">For small monthly amounts, a diversified mutual fund (SIP) is usually simpler than picking single stocks.</p>
        </Card>
      </div>
    </div>
  );
}
