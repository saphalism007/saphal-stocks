// Invest or Trade? The fundamentally strongest stocks (to invest) and the technically strongest (to trade),
// overall, by sector, and the ones strong on both.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Tabs, Badge, Loading, ErrorBox } from "../components/ui.tsx";
import { num, nptDate, pct, tone } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Tab = "invest" | "trade" | "both" | "sector";

function Row({ r, mode }: { r: Any; mode: "invest" | "trade" | "both" }) {
  return (
    <div className="pk-row">
      <span className="pk-rank">{r.rank}</span>
      <div className="pk-main">
        <div className="row between" style={{ flexWrap: "nowrap", gap: 8 }}>
          <span style={{ minWidth: 0 }}><Link className="mono" to={`/stocks/${r.symbol}`} style={{ fontWeight: 700 }}>{r.symbol}</Link> <span className="tiny faint">{r.sector}</span>{!r.liquid && <Badge tone="warn">thin trading</Badge>}</span>
          <span className="pk-score"><span className="pk-bar"><i style={{ width: `${r.score}%` }} className={mode === "trade" ? "t" : "f"} /></span><b>{r.score}</b></span>
        </div>
        <div className="tiny muted pk-name">{r.name}</div>
        <div className="pk-kv">
          {mode !== "trade" ? <>
            <span>P/E <b>{r.pe != null && r.pe > 0 ? num(r.pe, 1) : "-"}</b></span><span>ROE <b>{r.roe != null ? `${num(r.roe, 1)}%` : "-"}</b></span><span>Div. yield <b>{r.cashYield != null ? `${num(r.cashYield, 1)}%` : "-"}</b></span><span>1 year <b className={tone(r.return1y)}>{pct(r.return1y)}</b></span>
          </> : <>
            <span>Trend <b className={r.trend === "uptrend" ? "up" : r.trend === "downtrend" ? "down" : ""}>{r.trend ?? "-"}</b></span><span>RSI <b>{r.rsi != null ? num(r.rsi, 0) : "-"}</b></span><span>Setup <b>{r.setup ?? "-"}</b></span><span>3 months <b className={tone(r.return3m)}>{pct(r.return3m)}</b></span>
          </>}
        </div>
        {r.why?.length > 0 && <div className="tiny faint">Strongest on: {r.why.join(", ")}</div>}
      </div>
      <Link className="btn sm" to={`/terminal/${r.symbol}`} title="Chart and buy/sell signal"></Link>
    </div>
  );
}

export default function Picks() {
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get("tab") as Tab) || "invest";
  const d = useApi<Any>("/picks");
  const [sector, setSector] = useState<string>("");
  if (d.error) return <div className="page"><ErrorBox error={d.error} onRetry={d.reload} /></div>;
  const p = d.data;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Invest or Trade?</h1><p className="muted">Stocks with strong businesses are for <b>investing</b> (hold for years). Stocks with strong price trends are for <b>trading</b> (weeks to months, with a stop-loss). Some are strong on both.</p></div></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t })} tabs={[{ key: "invest", label: "Best to invest" }, { key: "trade", label: "Best to trade" }, { key: "both", label: "Strong on both" }, { key: "sector", label: "By sector" }]} />
      {!p ? <Loading label="Ranking every stock" /> : (
        <>
          <p className="tiny faint" style={{ margin: 0 }}>Scores 0-100 from prices and financial statements as of {p.asOf ? nptDate(p.asOf) : "-"}. {tab === "trade" ? p.tradeHow : tab === "invest" ? p.investHow : ""}</p>
          {tab === "invest" && <div className="pk-list">{p.invest.map((r: Any) => <Row key={r.symbol} r={r} mode="invest" />)}</div>}
          {tab === "trade" && <div className="pk-list">{p.trade.map((r: Any) => <Row key={r.symbol} r={r} mode="trade" />)}</div>}
          {tab === "both" && (p.both.length ? <div className="pk-list">{p.both.map((r: Any, i: number) => <Row key={r.symbol} r={{ ...r, rank: i + 1 }} mode="both" />)}</div> : <p className="small muted">No stock is in the top 30% of both lists today.</p>)}
          {tab === "sector" && (
            <div className="col">
              <div className="chips"><button className={`chip ${!sector ? "on" : ""}`} onClick={() => setSector("")}>All sectors</button>{p.bySector.map((s: Any) => <button key={s.sector} className={`chip ${sector === s.sector ? "on" : ""}`} onClick={() => setSector(s.sector)}>{s.sector}</button>)}</div>
              {p.bySector.filter((s: Any) => !sector || s.sector === sector).map((s: Any) => (
                <div key={s.sector} className="pk-sector">
                  <h3>{s.sector}</h3>
                  <div className="pk-two">
                    <div><div className="sub-h">To invest</div>{s.invest.length ? s.invest.map((r: Any) => <Row key={r.symbol} r={r} mode="invest" />) : <p className="tiny faint">None qualify.</p>}</div>
                    <div><div className="sub-h">To trade</div>{s.trade.length ? s.trade.map((r: Any) => <Row key={r.symbol} r={r} mode="trade" />) : <p className="tiny faint">No active setups.</p>}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="pk-help">
            <div><b>Investing</b><span>Buy strong businesses at fair prices and hold for years. Check P/E against the sector, steady profits and dividends. Add slowly; don't panic in falls.</span></div>
            <div><b>Trading</b><span>Buy a setup (breakout, pullback to support) with a stop-loss and a target, risking 1-2% of capital. Exit at the stop, no exceptions. Use the signal for exact prices.</span></div>
          </div>
        </>
      )}
    </div>
  );
}
