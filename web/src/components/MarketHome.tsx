// Market overview: turnover vs the previous session, market leaders, dividend/bonus and AGM
// disclosures, a sector heatmap with 1D/1W/1M/1Y, and movers tabs.
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Seg, Loading, Empty } from "./ui.tsx";
import { compact, num, pct, tone, nptDate, int } from "../lib/format.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const heatColor = (c: number) => {
  const a = Math.min(1, Math.abs(c) / 4);
  return c >= 0 ? `color-mix(in srgb, var(--up) ${Math.round(18 + a * 62)}%, var(--panel))` : `color-mix(in srgb, var(--down) ${Math.round(18 + a * 62)}%, var(--panel))`;
};

export function MarketHome() {
  const [period, setPeriod] = useState<"1D" | "1W" | "1M" | "1Y">("1D");
  const h = useApi<Any>("/market/home");
  const heat = useApi<Any[]>(`/market/heatmap?period=${period}`, [period]);
  const [mv, setMv] = useState<"gainers" | "losers" | "volume" | "turnover" | "results">("gainers");
  const results = useApi<Any>("/market/results");
  const nav = useNavigate();
  if (!h.data) return <Loading />;
  const d = h.data, L = d.leaders, t = d.turnover;
  const Leader = ({ label, x, extra }: { label: string; x: Any; extra?: string }) => x ? (
    <Link to={`/stocks/${x.symbol}`} className="leader"><span className="tiny faint">{label}</span><strong className="sym">{x.symbol}</strong><span className="tiny">{extra}</span></Link>
  ) : null;
  return (
    <div className="col">
      <div className="grid g3">
        <Card title="Turnover" sub={d.date ? nptDate(d.date) : undefined}>
          <div className="mono" style={{ fontSize: 24, fontWeight: 600 }}>{compact(t.today)}</div>
          <div className="small muted">{int(t.shares)} shares, {t.traded} stocks traded</div>
          {t.changePct != null && <div className={`small ${tone(t.changePct)}`} style={{ marginTop: 6 }}>{t.changePct >= 0 ? "Up" : "Down"} {num(Math.abs(t.changePct), 1)}% on the previous session ({compact(t.previous)})</div>}
          <div className="row small" style={{ marginTop: 6, gap: 12 }}><span className="up">▲ {d.breadth.advancers}</span><span className="down">▼ {d.breadth.decliners}</span><span className="faint">, {d.breadth.unchanged}</span></div>
        </Card>
        <Card title="Market leaders">
          <div className="leaders">
            <Leader label="Top turnover" x={L.turnover} extra={compact(L.turnover?.turnover)} />
            <Leader label="Top volume" x={L.volume} extra={`${int(L.volume?.volume)} shares`} />
            <Leader label="Most volatile" x={L.volatile} extra={`${num(L.volatile?.rangePct, 1)}% range`} />
            <Leader label="Near 52-week high" x={L.near52High} extra={pct(L.near52High?.changePct)} />
            <Leader label="Near 52-week low" x={L.near52Low} extra={pct(L.near52Low?.changePct)} />
          </div>
        </Card>
        <Card title="Corporate disclosures" sub="Dividends & bonus, upcoming AGMs" actions={<Link className="small" to="/monitor">All</Link>}>
          <div className="disc">
            {d.disclosures.agms.slice(0, 4).map((a: Any) => <a key={a.url} href={a.url} target="_blank" rel="noopener noreferrer" className="row between small"><span><span className="sym">{a.symbol}</span> AGM</span><span className="faint">{nptDate(a.date)}</span></a>)}
            {d.disclosures.dividends.slice(0, 8).map((x: Any) => <Link key={x.symbol + x.fiscal_year} to={`/stocks/${x.symbol}`} className="row between small"><span><span className="sym">{x.symbol}</span> {[x.bonus_pct ? `${num(x.bonus_pct, 2)}% bonus` : null, x.cash_pct ? `${num(x.cash_pct, 2)}% cash` : null].filter(Boolean).join(", ")}</span><span className="faint">{nptDate(x.announcement_date)}</span></Link>)}
            {!d.disclosures.dividends.length && !d.disclosures.agms.length && <Empty title="No recent disclosures" />}
          </div>
        </Card>
      </div>
      <Card title="Sector heatmap" sub="Average move of each sector's stocks, tap a sector" actions={<Seg value={period} onChange={setPeriod} options={[{ key: "1D", label: "1D" }, { key: "1W", label: "1W" }, { key: "1M", label: "1M" }, { key: "1Y", label: "1Y" }]} />}>
        {!heat.data ? <Loading /> : (
          <div className="heatmap">
            {heat.data.map((s: Any) => (
              <button key={s.sector} className="heat-tile" style={{ background: heatColor(s.changePct), gridColumn: `span ${s.stocks >= 60 ? 3 : s.stocks >= 15 ? 2 : 1}`, gridRow: `span ${s.stocks >= 60 ? 2 : 1}` }} onClick={() => nav(`/stocks?sector=${encodeURIComponent(s.sector)}`)}>
                <span className="small" style={{ fontWeight: 600 }}>{s.sector}</span>
                <span className="tiny">{s.stocks} stocks</span>
                <strong className="mono">{pct(s.changePct)}</strong>
                <span className="tiny">▲ {s.up} ▼ {s.down}{s.best ? `, ${s.best.symbol} ${pct(s.best.ret, 1)}` : ""}</span>
              </button>
            ))}
          </div>
        )}
      </Card>
      <Card title="Movers" actions={<Seg value={mv} onChange={setMv} options={[{ key: "gainers", label: "Gainers" }, { key: "losers", label: "Losers" }, { key: "volume", label: "Volume" }, { key: "turnover", label: "Turnover" }, { key: "results", label: "Results" }]} />}>
        {mv === "results" ? (!results.data ? <Loading /> : (
          <div className="mover-grid">{results.data.rows.slice(0, 24).map((r: Any) => (
            <Link key={r.symbol} to={`/stocks/${r.symbol}`} className="mover"><span className="sym">{r.symbol}</span><span className="small mono">{compact(r.profit * 1000)}</span><span className={`small ${tone(r.yoyPct)}`}>{r.yoyPct != null ? pct(r.yoyPct, 1) : "new"}</span></Link>
          ))}<Link to="/results" className="small" style={{ alignSelf: "center" }}>All results</Link></div>
        )) : (
          <div className="mover-grid">{d.movers[mv].slice(0, 24).map((x: Any) => (
            <Link key={x.symbol} to={`/stocks/${x.symbol}`} className="mover"><span className="sym">{x.symbol}</span><span className="small mono">Rs. {num(x.close)}</span><span className={`small ${tone(x.changePct)}`}>{mv === "volume" ? `${int(x.volume)}` : mv === "turnover" ? compact(x.turnover) : pct(x.changePct)}</span></Link>
          ))}</div>
        )}
      </Card>
    </div>
  );
}
