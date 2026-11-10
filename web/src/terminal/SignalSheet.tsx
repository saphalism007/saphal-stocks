// The Buy/Sell Signal sheet: one place with the verdict, exact prices (buy, stop-loss, targets),
// support and resistance, technical readings, fundamentals, the reasons, the risks and how past
// signals on this stock worked out. Everything comes from the same analysis as the AI panel.
import { useEffect } from "react";
import { useApi } from "../lib/api.ts";
import type { ChartAnalysis } from "../../../shared/analyst.ts";
import { num, nptDate } from "../lib/format.ts";
import { Orders } from "./AiPanel.tsx";

const pct = (v: number | null | undefined, d = 1) => (v == null ? "-" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const rs = (v: number | null | undefined) => (v == null ? "-" : `Rs. ${num(v)}`);
const VC: Record<string, string> = { "STRONG BUY": "sg-sbuy", BUY: "sg-buy", WAIT: "sg-wait", HOLD: "sg-hold", SELL: "sg-sell", "STRONG SELL": "sg-ssell", "NO SIGNAL": "sg-none" };
const TD: Record<string, string> = { bull: "up", bear: "down", neutral: "warn" };

function Radar({ axes }: { axes: { label: string; score: number | null }[] }) {
  const S = 150, c = S / 2, R = S * 0.38, n = axes.length;
  const pt = (i: number, v: number) => { const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [c + R * (v / 100) * Math.cos(ang), c + R * (v / 100) * Math.sin(ang)]; };
  const poly = axes.map((x, i) => pt(i, x.score ?? 0).join(",")).join(" ");
  const avg = axes.filter((x) => x.score != null).reduce((s, x, _, arr) => s + (x.score as number) / arr.length, 0);
  const col = avg >= 60 ? "#16a34a" : avg >= 40 ? "#d97706" : "#dc2626";
  return (
    <svg viewBox={`0 0 ${S} ${S}`} width={S} height={S} role="img" aria-label="Stock scorecard">
      {[25, 50, 75, 100].map((g) => <polygon key={g} points={axes.map((_, i) => pt(i, g).join(",")).join(" ")} fill="none" stroke="var(--border)" />)}
      {axes.map((x, i) => { const [x2, y2] = pt(i, 100); return <line key={i} x1={c} y1={c} x2={x2} y2={y2} stroke="var(--border)" />; })}
      <polygon points={poly} fill={col} fillOpacity={0.3} stroke={col} strokeWidth={2} />
      {axes.map((x, i) => { const [lx, ly] = pt(i, 122); return <text key={i} x={lx} y={ly} fontSize={8.5} textAnchor="middle" dominantBaseline="middle" fill="var(--text-2)">{x.label.split(" ")[0]}</text>; })}
    </svg>
  );
}

function Row({ k, v, note, tone }: { k: string; v: React.ReactNode; note?: React.ReactNode; tone?: string }) {
  return <div className="sg-row"><span className="sg-k">{k}</span><span className={`sg-v ${tone ?? ""}`}>{v}</span>{note != null && <span className="sg-n">{note}</span>}</div>;
}

export default function SignalSheet({ a, onClose, onRemove }: { a: ChartAnalysis; onClose: () => void; onRemove: () => void }) {
  useEffect(() => { const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [onClose]);
  const card = useApi<any>(`/stocks/${a.symbol}/card`, [a.symbol]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const p = a.plan, c = a.price ?? 0, ind = a.indicators, f = a.fund;
  const d = (x: number | null | undefined) => (x == null || !c ? null : ((x - c) / c) * 100);
  const sup = a.levels.filter((l) => l.side === "support" && l.price < c).slice(0, 3);
  const res = a.levels.filter((l) => l.side === "resistance" && l.price > c).slice(0, 3);
  const rsi = ind.rsi, rsiRead = rsi == null ? "" : rsi >= 70 ? "overbought" : rsi <= 30 ? "oversold" : rsi >= 55 ? "bullish" : rsi <= 45 ? "bearish" : "neutral";
  const ma = (v: number | null | undefined) => (v == null ? "-" : `${rs(v)} (${c >= v ? "price above" : "price below"})`);
  // Risk:reward for the buy-zone plan when there's no active setup yet: (first target − zone top) ÷ (zone top − stop).
  const zTop = p.entryHigh ?? p.bestZone?.high ?? null, t1 = p.targets.find((t) => zTop != null && t.price > zTop);
  const planRR = p.riskReward ?? (zTop != null && p.stop != null && t1 && zTop > p.stop ? Math.round(((t1.price - zTop) / (zTop - p.stop)) * 100) / 100 : null);
  const zone = p.entryLow != null && p.entryHigh != null ? `${rs(p.entryLow)} - ${num(p.entryHigh)}` : p.bestZone ? `${rs(p.bestZone.low)} - ${num(p.bestZone.high)}` : "-";
  return (
    <div className="sg-bg" onClick={onClose}>
      <div className="sg" role="dialog" aria-label={`${a.symbol} buy/sell signal`} onClick={(e) => e.stopPropagation()}>
        <div className="sg-top">
          <div><strong>{a.symbol}</strong> <span className="faint small">{a.name}</span><div className="tiny faint">Close {rs(a.price)} {pct(a.changePct, 2)}, {a.asOf ? nptDate(a.asOf) : ""}</div></div>
          <button className="btn sm ghost" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="sg-body">
          <div className={`sg-verdict ${VC[a.verdict] ?? ""}`}>
            <div className="row between"><span className="sg-vlabel">{a.verdict}</span><span className="small">Confidence <b>{a.confidence}</b>/100</span></div>
            <div className="conf"><i style={{ width: `${a.confidence}%` }} /></div>
            <p className="small" style={{ margin: "6px 0 0" }}>{a.orders?.summary ?? a.headline}</p>
          </div>

          <div className="sg-grid">
            <div className="sg-cell buy"><span>Buy zone</span><b>{zone}</b><em>{p.buyNow === "now" ? "price is in range" : p.waitFor ? "wait for it" : ""}</em></div>
            <div className="sg-cell"><span>Breakout buy</span><b>{p.breakout ? `> ${num(p.breakout.price)}` : "-"}</b><em>{p.breakout ? `${pct(d(p.breakout.price))}, close on volume` : ""}</em></div>
            <div className="sg-cell stop"><span>Stop-loss</span><b>{p.stop != null ? num(p.stop) : "-"}</b><em>{pct(d(p.stop))}</em></div>
            {[0, 1, 2].map((i) => <div key={i} className="sg-cell tgt"><span>Target {i + 1}</span><b>{p.targets[i] ? num(p.targets[i].price) : "-"}</b><em>{p.targets[i] ? pct(p.targets[i].pct) : ""}</em></div>)}
            <div className="sg-cell"><span>Risk : reward</span><b className={planRR != null ? (planRR >= 2 ? "up" : planRR < 1 ? "down" : "") : ""}>{planRR != null ? `1 : ${planRR}` : "-"}</b><em>{p.netRiskReward != null ? `${p.netRiskReward} after fees` : p.riskReward == null && planRR != null ? "if bought in the zone" : ""}</em></div>
            <div className="sg-cell"><span>Hold for</span><b>{p.holding ?? (p.targets.length ? "until T1 / stop" : "-")}</b><em>{p.reviewBy ? `review ${nptDate(p.reviewBy)}` : ""}</em></div>
          </div>

          {card.data?.scorecard && <div className="sg-card"><Radar axes={card.data.scorecard} /><div className="sg-axes">{card.data.scorecard.map((x: { key: string; label: string; score: number | null }) => <div key={x.key}><span>{x.label}</span><b className={x.score == null ? "" : x.score >= 60 ? "up" : x.score < 40 ? "down" : "warn"}>{x.score ?? "-"}</b></div>)}</div></div>}
          {card.data?.range && <div className="sg-range"><b>Likely price range</b><span>Next week: <b>{num(card.data.range.week.likely.low)} - {num(card.data.range.week.likely.high)}</b> (about 2 in 3 chance), wider {num(card.data.range.week.wide.low)}-{num(card.data.range.week.wide.high)}</span><span>Next month: <b>{num(card.data.range.month.likely.low)} - {num(card.data.range.month.likely.high)}</b>, wider {num(card.data.range.month.wide.low)}-{num(card.data.range.month.wide.high)}</span><em className="tiny faint">From the last 60 days' price swings ({card.data.range.dailyVolPct}% a day). Statistics, not a forecast.</em></div>}

          {a.orders && <Orders o={a.orders} />}

          <h4 className="sg-h">Support & resistance</h4>
          <div className="sg-sr">
            <div>{res.length ? [...res].reverse().map((l, i) => <Row key={i} k={`R${res.length - i} ${l.kind.replace(/ ?level/i, "")}`} v={num(l.price)} note={pct(d(l.price))} tone="down" />) : <span className="tiny faint">No resistance above in the data</span>}</div>
            <div className="sg-now">Now {num(c)}</div>
            <div>{sup.length ? sup.map((l, i) => <Row key={i} k={`S${i + 1} ${l.kind.replace(/ ?level/i, "")}`} v={num(l.price)} note={pct(d(l.price))} tone="up" />) : <span className="tiny faint">No support below in the data</span>}</div>
          </div>

          <h4 className="sg-h">Technical {a.scores.technical != null && <span className="faint small">score {a.scores.technical}/100</span>}</h4>
          <Row k="Trend" v={a.reasons.find((r) => r.topic === "Trend")?.text.split(".")[0] ?? "-"} tone={TD[a.reasons.find((r) => r.topic === "Trend")?.tone ?? "neutral"]} />
          <Row k="RSI (14)" v={rsi != null ? num(rsi, 1) : "-"} note={rsiRead} tone={rsiRead === "overbought" || rsiRead === "bearish" ? "down" : rsiRead === "oversold" || rsiRead === "bullish" ? "up" : ""} />
          <Row k="MACD histogram" v={ind.macdHist != null ? num(ind.macdHist, 2) : "-"} note={ind.macdHist == null ? "" : ind.macdHist >= 0 ? "momentum up" : "momentum down"} tone={ind.macdHist == null ? "" : ind.macdHist >= 0 ? "up" : "down"} />
          <Row k="ADX" v={ind.adx != null ? num(ind.adx, 1) : "-"} note={ind.adx == null ? "" : ind.adx >= 25 ? "strong trend" : ind.adx >= 20 ? "trend forming" : "no clear trend"} />
          <Row k="20-day avg" v={ma(ind.sma20)} tone={ind.sma20 != null ? (c >= ind.sma20 ? "up" : "down") : ""} />
          <Row k="50-day avg" v={ma(ind.sma50)} tone={ind.sma50 != null ? (c >= ind.sma50 ? "up" : "down") : ""} />
          <Row k="200-day avg" v={ma(ind.sma200)} tone={ind.sma200 != null ? (c >= ind.sma200 ? "up" : "down") : ""} />
          <Row k="Volume vs 20-day" v={ind.volumeRatio != null ? `${num(ind.volumeRatio, 2)}x` : "-"} note={ind.volumeRatio == null ? "" : ind.volumeRatio >= 1.5 ? "heavy" : ind.volumeRatio < 0.7 ? "light" : "normal"} />
          <Row k="Stochastic %K" v={ind.stochK != null ? num(ind.stochK, 1) : "-"} />
          <Row k="Bollinger %B" v={ind.percentB != null ? num(ind.percentB, 2) : "-"} />
          <Row k="52-week range" v={`${num(ind.low52 ?? 0)} - ${num(ind.high52 ?? 0)}`} note={ind.high52 ? `${pct(d(ind.high52))} to high` : ""} />
          <Row k="Returns 1M / 3M / 1Y" v={`${pct(ind.return1m)} / ${pct(ind.return3m)} / ${pct(ind.return1y)}`} />
          {a.patterns[0] && <Row k="Chart pattern" v={a.patterns[0].name} tone={a.patterns[0].direction === "bullish" ? "up" : a.patterns[0].direction === "bearish" ? "down" : ""} />}
          {a.divergences[0] && <Row k="Divergence" v={a.divergences[0].text} tone={a.divergences[0].dir === "bullish" ? "up" : "down"} />}

          <h4 className="sg-h">Fundamental {f?.score != null && <span className="faint small">score {f.score}/100{f.period ? `, ${f.period}` : ""}</span>}</h4>
          {!f ? <p className="tiny faint">No financial statements stored for this company.</p> : (
            <>
              <Row k="EPS (annualised)" v={f.eps != null ? rs(f.eps) : "-"} tone={f.eps != null ? (f.eps > 0 ? "up" : "down") : ""} />
              <Row k="P/E" v={f.pe != null ? `${num(f.pe, 1)}x` : "-"} note={f.sectorPe != null ? `sector ${num(f.sectorPe, 1)}x` : ""} tone={f.pe != null && f.sectorPe != null ? (f.pe <= f.sectorPe ? "up" : "down") : ""} />
              <Row k="P/B" v={f.pb != null ? `${num(f.pb, 2)}x` : "-"} note={f.bvps != null ? `book ${rs(f.bvps)}/share` : ""} />
              <Row k="ROE" v={f.roe != null ? `${num(f.roe, 1)}%` : "-"} tone={f.roe != null ? (f.roe >= 12 ? "up" : f.roe < 6 ? "down" : "") : ""} />
              <Row k="Debt / equity" v={f.de != null ? num(f.de, 2) : "-"} />
              <Row k="Graham value" v={f.graham != null ? rs(f.graham) : "-"} note={f.graham != null && c ? (c <= f.graham ? "price below it" : `price ${pct(((c - f.graham) / f.graham) * 100, 0)} above`) : ""} tone={f.graham != null ? (c <= f.graham ? "up" : "down") : ""} />
              <Row k="Profit growth" v={pct(f.profitGrowth)} tone={f.profitGrowth != null ? (f.profitGrowth >= 0 ? "up" : "down") : ""} />
              <Row k="Revenue growth" v={pct(f.revenueGrowth)} tone={f.revenueGrowth != null ? (f.revenueGrowth >= 0 ? "up" : "down") : ""} />
              <Row k="Cash dividend yield" v={f.cashYield != null ? `${num(f.cashYield, 2)}%` : "-"} note={f.dividendYears5 != null ? `paid ${f.dividendYears5} of last 5 yrs` : ""} />
              {f.strengths.length > 0 && <ul className="sg-list up">{f.strengths.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {f.redFlags.length > 0 && <ul className="sg-list down">{f.redFlags.slice(0, 4).map((x, i) => <li key={i}>{x}</li>)}</ul>}
            </>
          )}

          <h4 className="sg-h">Why, the reasons</h4>
          <ul className="sg-reasons">{a.reasons.map((r, i) => <li key={i} className={TD[r.tone]}><b>{r.topic}:</b> {r.text}</li>)}</ul>

          {(a.risks.length > 0 || a.invalidation.length > 0) && <>
            <h4 className="sg-h">Risks & when the signal is wrong</h4>
            <ul className="sg-list down">{[...a.risks, ...a.invalidation].slice(0, 8).map((x, i) => <li key={i}>{x}</li>)}</ul>
          </>}

          <h4 className="sg-h">How this signal did before</h4>
          {a.history && a.history.trades > 0 ? (
            <p className="small" style={{ margin: 0 }}>{a.history.trades} past signals on {a.symbol}: {a.history.winRatePct ?? "-"}% won, average {pct(a.history.avgNetPct)} after fees{a.history.stopHitPct != null ? `, ${a.history.stopHitPct}% hit the stop` : ""}.</p>
          ) : <p className="small muted" style={{ margin: 0 }}>No past signals on this stock with these rules{a.setupHistory?.trades ? `; across all stocks this setup won ${a.setupHistory.winRatePct ?? "-"}% of ${a.setupHistory.trades} times` : ""}.</p>}
          {(a.signals ?? []).length > 0 && <div className="table-scroll" style={{ marginTop: 6 }}><table className="t small"><thead><tr><th>Bought</th><th className="num">At</th><th>Sold</th><th className="num">At</th><th className="num">Result</th></tr></thead>
            <tbody>{[...(a.signals ?? [])].reverse().slice(0, 8).map((g) => <tr key={g.date}><td>{nptDate(g.entryDate)}</td><td className="num">{num(g.entry)}</td><td>{nptDate(g.exitDate)}</td><td className="num">{num(g.exit)}</td><td className={`num ${g.netPct >= 0 ? "up" : "down"}`}>{pct(g.netPct)}</td></tr>)}</tbody></table></div>}

          <p className="tiny faint" style={{ marginTop: 12 }}>Built from NEPSE prices and stored financial statements as of {a.asOf ? nptDate(a.asOf) : "-"}. Signals follow fixed rules and can be wrong; never risk money you can't afford to lose. {a.dataNotes.join(" ")}</p>
        </div>
        <div className="sg-foot">
          <button className="btn" onClick={onRemove}>Remove from chart</button>
          <button className="btn primary" onClick={onClose}>Show on chart</button>
        </div>
      </div>
    </div>
  );
}
