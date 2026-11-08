import { Fragment } from "react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Stat, Loading, ErrorBox, Notice, Badge, Empty, Fresh, Score, ScoreBar, Tabs, DataTable, Disclaimer, Modal } from "../components/ui.tsx";
import { PriceChart, LineChart, type Overlay, type Lower, type ChartLevel } from "../components/PriceChart.tsx";
import { num, pct, tone, compact, int, nptDate, isNum } from "../lib/format.ts";
import { I } from "../components/icons.tsx";
import { useTheme } from "../App.tsx";
import { grahamNumber, dividendDiscount } from "../../../shared/fundamentals.ts";
import type { Bar } from "../../../shared/types.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
type TabKey = "summary" | "chart" | "levels" | "fundamentals" | "financials" | "dividends" | "news" | "backtest";

export default function StockDetail() {
  const { symbol = "" } = useParams();
  const sym = symbol.toUpperCase();
  const a = useApi<Any>(`/stocks/${sym}`, [sym]);
  const rep = useApi<Any>(`/stocks/${sym}/report`, [sym]);
  const barsQ = useApi<{ bars: Bar[]; adjustments: Any[]; skipped: Any[] }>(`/stocks/${sym}/bars`, [sym]);
  const [tab, setTab] = useState<TabKey>("summary");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [showWatch, setShowWatch] = useState(false);
  const [showAlert, setShowAlert] = useState(false);
  const nav = useNavigate();
  if (a.loading && !a.data) return <Loading label={`Analysing ${sym}`} />;
  if (a.error) return <ErrorBox error={a.error} onRetry={a.reload} />;
  const d = a.data;
  if (!d) return null;
  const c = d.company;
  const q = d.quote;
  const t = d.technical;
  const fa = d.fundamentals;
  const refresh = async () => {
    setBusy(true); setMsg(null);
    try { const r = await api<Any>(`/stocks/${sym}/refresh`, { body: {} }); setMsg(`Updated: ${r.dividends} dividend records, ${r.announcements} announcements, report ${r.report ?? "not available"}.`); a.reload(); rep.reload(); barsQ.reload(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const lastClose = d.lastBar?.close;
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="row"><h1 className="mono">{sym}</h1><Badge>{c.sector ?? "Sector unknown"}</Badge>{t && <Badge tone={t.trend === "uptrend" ? "up" : t.trend === "downtrend" ? "down" : "warn"}>{t.trend}</Badge>}</div>
          <p>{c.name} · <Fresh date={d.dataFreshness.lastPriceDate} fetched={q?.fetched_at} /></p>
        </div>
        <div className="row">
          <div style={{ textAlign: "right", marginRight: 8 }}>
            <div className="mono" style={{ fontSize: 26, fontWeight: 600 }}>{num(lastClose)}</div>
            <div className={`mono small ${tone(q?.change_pct)}`}>{num(q?.change)} ({pct(q?.change_pct)})</div>
          </div>
          <button className="btn" onClick={() => setShowWatch(true)}><I.star /> Watch</button>
          <button className="btn" onClick={() => setShowAlert(true)}><I.alerts /> Alert</button>
          <button className="btn" onClick={() => nav(`/compare?s=${sym}`)}>Compare</button>
          <button className="btn" onClick={() => nav(`/analyst?q=${encodeURIComponent(`Analyse ${sym}: is it a good investment at the current price, and is there a good trade setup?`)}`)}><I.ai /> Ask AI</button>
          <button className="btn" onClick={refresh} disabled={busy} title="Fetch latest profile, dividends, announcements and quarterly report">{busy ? <span className="spinner" /> : <I.refresh />} Update</button>
        </div>
      </div>
      {msg && <Notice>{msg}</Notice>}
      {d.dataFreshness?.provisional && <Notice tone="warn">Today's price bar is provisional: the market is open or the official close hasn't been loaded yet, so today's indicators, levels and setups can still change.</Notice>}
      {!fa?.latestPeriod && <Notice tone="warn">No quarterly statements stored for {sym} yet, so fundamental scores are unavailable. Click <strong>Update</strong> to fetch the latest report.</Notice>}

      <div className="grid g6">
        <Stat label="52W range" value={<span style={{ fontSize: 15 }}>{num(t?.low52)} – {num(t?.high52)}</span>} sub={t && lastClose ? `${pct(((lastClose - t.high52) / t.high52) * 100, 1)} from high` : ""} />
        <Stat label="Market cap" value={<span style={{ fontSize: 17 }}>{compact(fa?.byKey?.marketCap != null ? fa.byKey.marketCap * 1000 : (lastClose && c.listed_shares ? lastClose * c.listed_shares : null))}</span>} sub={fa?.byKey?.marketCap != null ? "Price × shares at last balance sheet" : `${int(c.listed_shares)} listed shares`} />
        <Stat label="P/E · P/B" value={<span style={{ fontSize: 17 }}>{num(fa?.byKey?.pe, 1)} · {num(fa?.byKey?.pb, 2)}</span>} sub={fa?.latestPeriod ?? "No statements"} />
        <Stat label="EPS · BVPS" value={<span style={{ fontSize: 17 }}>{num(fa?.byKey?.eps)} · {num(fa?.byKey?.bvps)}</span>} sub="Computed from statements" />
        <Stat label="ROE" value={<span style={{ fontSize: 17 }}>{isNum(fa?.byKey?.roe) ? `${num(fa.byKey.roe, 1)}%` : "—"}</span>} sub={fa?.dividend?.cashYieldPct != null ? `Cash yield ${num(fa.dividend.cashYieldPct, 2)}%` : "—"} />
        <Stat label="Turnover" value={<span style={{ fontSize: 17 }}>{compact(q?.turnover)}</span>} sub={`Vol ${int(q?.volume)} · ${int(q?.trades)} trades`} />
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: "summary", label: "Summary" }, { key: "chart", label: "Chart & technicals" }, { key: "levels", label: "Support & resistance" },
        { key: "fundamentals", label: "Fundamentals" }, { key: "financials", label: "Financial statements" }, { key: "dividends", label: "Dividends" },
        { key: "news", label: "Announcements" }, { key: "backtest", label: "Backtest" },
      ]} />

      {tab === "summary" && <Summary d={d} rep={rep.data} bars={barsQ.data?.bars ?? []} onTab={setTab} />}
      {tab === "chart" && <ChartTab d={d} bars={barsQ.data} />}
      {tab === "levels" && <LevelsTab d={d} bars={barsQ.data?.bars ?? []} />}
      {tab === "fundamentals" && <FundamentalsTab d={d} />}
      {tab === "financials" && <FinancialsTab sym={sym} />}
      {tab === "dividends" && <DividendsTab d={d} />}
      {tab === "news" && <NewsTab sym={sym} />}
      {tab === "backtest" && <BacktestTab sym={sym} />}
      {showWatch && <WatchModal sym={sym} price={lastClose} onClose={() => setShowWatch(false)} />}
      {showAlert && <AlertModal sym={sym} onClose={() => setShowAlert(false)} />}
    </div>
  );
}

function Summary({ d, rep, bars, onTab }: { d: Any; rep: Any; bars: Bar[]; onTab: (t: TabKey) => void }) {
  const { theme } = useTheme();
  const best = d.setups?.find((s: Any) => s.side === "buy");
  const levels: ChartLevel[] = [
    ...(d.levels?.supports ?? []).slice(0, 2).map((l: Any) => ({ price: l.price, kind: "support", label: `S ${l.strength}`, strong: l.strength === "major" })),
    ...(d.levels?.resistances ?? []).slice(0, 2).map((l: Any) => ({ price: l.price, kind: "resistance", label: `R ${l.strength}`, strong: l.strength === "major" })),
  ];
  return (
    <div className="grid g3">
      <div className="col span2">
        <Card title="Verdict (rule-based)" sub={rep?.verdict?.method}>
          {!rep ? <Loading /> : (
            <div className="col">
              <div className="grid g2">
                <div><div className="tiny faint">LONG-TERM INVESTING</div><div style={{ fontWeight: 500 }}>{rep.verdict.longTerm}</div></div>
                <div><div className="tiny faint">SHORT-TERM TRADING</div><div style={{ fontWeight: 500 }}>{rep.verdict.shortTerm}</div></div>
              </div>
              <div className="grid g4" style={{ gap: 12 }}>
                <ScoreBar label="Fundamental" value={rep.scores.fundamental} /><ScoreBar label="Technical" value={rep.scores.technical} />
                <ScoreBar label="Valuation" value={rep.scores.valuation} /><ScoreBar label="Financial health" value={rep.scores.financialHealth} />
              </div>
              <ScoreBar label="Risk (higher = lower volatility)" value={rep.scores.risk} />
              <p className="small muted">{rep.marketContext}</p>
              <div className="grid g2">
                <div><div className="small up" style={{ fontWeight: 600, marginBottom: 4 }}>Bullish arguments</div><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{rep.bullish.length ? rep.bullish.map((b: string) => <li key={b}>{b}</li>) : <li className="faint">None from the data</li>}</ul></div>
                <div><div className="small down" style={{ fontWeight: 600, marginBottom: 4 }}>Bearish arguments</div><ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{rep.bearish.length ? rep.bearish.map((b: string) => <li key={b}>{b}</li>) : <li className="faint">None from the data</li>}</ul></div>
              </div>
              <p className="tiny faint">{rep.facts}</p>
            </div>
          )}
        </Card>
        <Card title="Price, last 12 months" actions={<button className="btn sm" onClick={() => onTab("chart")}>Full chart</button>}>
          <PriceChart bars={bars.slice(-260)} overlays={["sma50", "sma200"]} levels={levels} height={320} theme={theme} />
        </Card>
      </div>
      <div className="col">
        <Card title="Best active setup">
          {best ? <SetupCard s={best} /> : <Empty title="No active buy setup">No rule (breakout, pullback, momentum, oversold bounce, trend continuation) is currently triggered.</Empty>}
          {d.setups?.filter((s: Any) => s.side === "sell").map((s: Any) => <Notice key={s.type} tone="warn"><strong>{s.type}</strong>: {s.reasoning[0]}</Notice>)}
        </Card>
        <Card title="Key levels" actions={<button className="btn sm" onClick={() => onTab("levels")}>Details</button>}>
          <table className="t"><tbody>
            {(d.levels?.resistances ?? []).slice(0, 3).reverse().map((l: Any) => <tr key={"r" + l.price}><td><Badge tone="down">R</Badge> {l.strength}</td><td className="num">{num(l.price)}</td><td className="num small faint">{pct(l.distancePct, 1)}</td></tr>)}
            <tr><td><strong>Last close</strong></td><td className="num"><strong>{num(d.lastBar?.close)}</strong></td><td /></tr>
            {(d.levels?.supports ?? []).slice(0, 3).map((l: Any) => <tr key={"s" + l.price}><td><Badge tone="up">S</Badge> {l.strength}</td><td className="num">{num(l.price)}</td><td className="num small faint">{pct(l.distancePct, 1)}</td></tr>)}
          </tbody></table>
        </Card>
        <Card title="Patterns detected">
          {d.patterns?.length ? d.patterns.map((p: Any) => (
            <div key={p.name} style={{ marginBottom: 8 }}>
              <div className="row"><Badge tone={p.direction === "bullish" ? "up" : p.direction === "bearish" ? "down" : ""}>{p.name}</Badge><span className="tiny faint">{p.status}</span></div>
              <div className="small muted">{p.description}</div>
            </div>
          )) : <Empty title="No patterns detected" />}
        </Card>
        {(d.adjustments?.length > 0 || d.rightAdjustments?.length > 0) && <Notice>Prices are adjusted for corporate actions found in the data: {[...(d.adjustments ?? []).map((x: Any) => `${x.bonusPct}% bonus on ${nptDate(x.exDate)}`), ...(d.rightAdjustments ?? []).map((x: Any) => `${x.ratio} rights at Rs. ${x.issuePrice} on ${nptDate(x.exDate)}`)].join(", ")}.</Notice>}
        <Disclaimer />
      </div>
    </div>
  );
}

export function SetupCard({ s }: { s: Any }) {
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row between"><Badge tone="up">{s.type}</Badge><span className="small">Quality <Score value={s.quality} /></span></div>
      <dl className="kv">
        <dt>Entry zone</dt><dd>{num(s.entryLow)} – {num(s.entryHigh)}</dd>
        <dt>Stop-loss</dt><dd className="down">{num(s.stopLoss)} ({num(s.riskPct, 1)}%)</dd>
        {s.targets.map((tg: number, i: number) => <Fragment key={"l" + i}><dt>Target {i + 1}</dt><dd className="up">{num(tg)}</dd></Fragment>)}
        <dt>Risk / reward</dt><dd>{num(s.riskReward)}</dd>
        <dt>Horizon</dt><dd style={{ fontFamily: "var(--font)" }}>{s.horizon}</dd>
        {s.netOfCosts && <><dt>Net return at T1</dt><dd>{pct(s.netOfCosts.netReturnAtT1Pct)} <span className="faint">(after fees & CGT)</span></dd></>}
      </dl>
      <div className="small"><strong>Why:</strong><ul style={{ margin: "4px 0", paddingLeft: 18 }}>{s.reasoning.map((r: string) => <li key={r}>{r}</li>)}</ul></div>
      <div className="small muted">{s.volume.note}</div>
      {s.fundamentalContext && <div className="small muted">{s.fundamentalContext}</div>}
      <div className="small"><strong>Invalidated if:</strong> {s.invalidation.join(" ")}</div>
      <details className="small"><summary className="faint">Quality factors</summary>{s.qualityFactors.map((f: Any) => <div key={f.factor} className="row between"><span>{f.factor}</span><span className="mono">{f.points > 0 ? "+" : ""}{f.points}</span></div>)}</details>
    </div>
  );
}

const OVERLAYS: { key: Overlay; label: string }[] = [
  { key: "sma20", label: "SMA 20" }, { key: "sma50", label: "SMA 50" }, { key: "sma200", label: "SMA 200" }, { key: "ema9", label: "EMA 9" }, { key: "ema20", label: "EMA 20" }, { key: "ema50", label: "EMA 50" },
  { key: "bb", label: "Bollinger" }, { key: "vwap", label: "VWAP 20" }, { key: "supertrend", label: "Supertrend" }, { key: "psar", label: "Parabolic SAR" }, { key: "ichimoku", label: "Ichimoku" }, { key: "fib", label: "Fibonacci" },
];

function ChartTab({ d, bars }: { d: Any; bars: { bars: Bar[]; adjustments: Any[]; skipped: Any[] } | null }) {
  const { theme } = useTheme();
  const [ov, setOv] = useState<Overlay[]>(["sma50", "sma200"]);
  const [lower, setLower] = useState<Lower>("rsi");
  const [showLevels, setShowLevels] = useState(true);
  const [showSetup, setShowSetup] = useState(true);
  const [kind, setKind] = useState<"candles" | "line">("candles");
  const t = d.technical;
  const hist = useApi<Any>(`/stocks/${d.symbol}/pattern-history`, [d.symbol]);
  const best = d.setups?.find((s: Any) => s.side === "buy");
  const levels: ChartLevel[] = [];
  if (showLevels) {
    for (const l of d.levels?.supports ?? []) levels.push({ price: l.price, kind: "support", label: `S${l.strength === "major" ? " major" : ""}`, strong: l.strength === "major" });
    for (const l of d.levels?.resistances ?? []) levels.push({ price: l.price, kind: "resistance", label: `R${l.strength === "major" ? " major" : ""}`, strong: l.strength === "major" });
  }
  if (showSetup && best) { levels.push({ price: best.entryHigh, kind: "entry", label: "Entry" }, { price: best.stopLoss, kind: "stop", label: "Stop" }); best.targets.forEach((x: number, i: number) => levels.push({ price: x, kind: "target", label: `T${i + 1}` })); }
  const markers = (d.patterns ?? []).flatMap((p: Any) => p.points.slice(-1).map((pt: Any) => ({ date: pt.date, position: p.direction === "bearish" ? "above" : "below", text: p.name, shape: "circle" as const, color: p.direction === "bearish" ? "#f43f5e" : "#22c55e" })));
  if (!bars) return <Loading />;
  const rows: [string, string][] = t ? [
    ["RSI (14)", num(t.rsi, 1)], ["MACD / signal", `${num(t.macd.macd)} / ${num(t.macd.signal)}`], ["MACD cross (5 sessions)", t.macd.cross ?? "none"], ["ADX (14)", num(t.adx, 1)],
    ["ATR (14)", `${num(t.atr)} (${num(t.atrPct, 1)}%)`], ["Stochastic %K / %D", `${num(t.stochastic.k, 1)} / ${num(t.stochastic.d, 1)}`], ["Bollinger %B", num(t.bollinger.percentB, 2)],
    ["SMA 20 / 50", `${num(t.sma[20])} / ${num(t.sma[50])}`], ["SMA 100 / 200", `${num(t.sma[100])} / ${num(t.sma[200])}`], ["EMA 9 / 20", `${num(t.ema[9])} / ${num(t.ema[20])}`], ["EMA 50 / 200", `${num(t.ema[50])} / ${num(t.ema[200])}`],
    ["VWAP (20 sessions)", num(t.vwap20)], ["Supertrend", `${num(t.supertrend.value)} (${t.supertrend.direction === 1 ? "bullish" : t.supertrend.direction === -1 ? "bearish" : "—"})`], ["Parabolic SAR", num(t.psar)],
    ["Ichimoku", `${t.ichimoku.position ?? "—"} cloud (${num(t.ichimoku.cloudBottom)}–${num(t.ichimoku.cloudTop)})`], ["OBV trend (20)", t.obvTrend ?? "—"], ["Volume vs 20-day avg", `${num(t.volumeRatio)}x`],
    ["Return 1M / 3M", `${pct(t.return1m, 1)} / ${pct(t.return3m, 1)}`], ["Return 6M / 1Y", `${pct(t.return6m, 1)} / ${pct(t.return1y, 1)}`],
  ] : [];
  const pv = d.lastBar ? pivot(d.lastBar) : null;
  return (
    <div className="col">
      <Card title="Chart" actions={<>
        <select className="input" value={lower} onChange={(e) => setLower(e.target.value as Lower)}>{(["volume", "rsi", "macd", "stoch", "adx", "obv", "atr"] as Lower[]).map((x) => <option key={x} value={x}>{x === "volume" ? "Volume only" : x.toUpperCase()}</option>)}</select>
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value as "candles")}><option value="candles">Candles</option><option value="line">Line</option></select>
      </>}>
        <div className="row" style={{ marginBottom: 10 }}>
          {OVERLAYS.map((o) => <label key={o.key} className="chk"><input type="checkbox" checked={ov.includes(o.key)} onChange={(e) => setOv(e.target.checked ? [...ov, o.key] : ov.filter((x) => x !== o.key))} />{o.label}</label>)}
          <label className="chk"><input type="checkbox" checked={showLevels} onChange={(e) => setShowLevels(e.target.checked)} />S/R levels</label>
          <label className="chk"><input type="checkbox" checked={showSetup} onChange={(e) => setShowSetup(e.target.checked)} />Setup lines</label>
        </div>
        <PriceChart bars={bars.bars} overlays={ov} lower={lower} levels={levels} markers={markers} height={560} kind={kind} theme={theme} />
        <p className="tiny faint" style={{ marginTop: 6 }}>{bars.adjustments.length ? `Adjusted for ${bars.adjustments.length} bonus issue(s). ` : ""}{(bars as Any).rightAdjustments?.length ? `Adjusted for ${(bars as Any).rightAdjustments.length} right issue(s). ` : ""}{bars.skipped.length ? `${bars.skipped.length} bonus record(s) not applied (no matching price gap). ` : ""}Daily data. Scroll to zoom, drag to pan.</p>
      </Card>
      <div className="grid g3">
        <Card title="Indicators" sub={`Technical score ${t?.technicalScore ?? "—"}/100`}>
          <dl className="kv">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
        </Card>
        <Card title="Score breakdown">
          {t?.scoreFactors.map((f: Any) => <div key={f.factor} className="row between small" style={{ padding: "3px 0" }}><span>{f.factor}</span><span className={`mono ${f.points > 0 ? "up" : "down"}`}>{f.points > 0 ? "+" : ""}{f.points}</span></div>)}
          <div className="sep" />
          <div className="tiny faint">Base 35 + factor points, capped 0–100. {t?.trendNotes.join(" ")}</div>
          {pv && <><div className="sep" /><div className="small" style={{ fontWeight: 600 }}>Classic pivots (from last session)</div><dl className="kv small">{Object.entries(pv).map(([k, v]) => <Fragment key={k}><dt>{k.toUpperCase()}</dt><dd>{num(v)}</dd></Fragment>)}</dl></>}
        </Card>
        <Card title="Patterns: track record on this stock" sub="Same rules replayed over its history">
          {hist.loading ? <Loading /> : hist.data?.records?.length ? (
            <table className="t"><thead><tr><th>Pattern</th><th className="num">Seen</th><th className="num">Hit target</th><th className="num">60d avg</th></tr></thead>
              <tbody>{hist.data.records.map((r: Any) => <tr key={r.name}><td>{r.name}</td><td className="num">{r.occurrences}</td><td className="num">{r.hitRate != null ? `${r.hitRate}%` : "—"}</td><td className={`num ${tone(r.avgForwardReturn60)}`}>{pct(r.avgForwardReturn60, 1)}</td></tr>)}</tbody></table>
          ) : <Empty title="No confirmed patterns in history" />}
          <p className="tiny faint" style={{ marginTop: 6 }}>Hit target = reached the measured-move target before the invalidation level within 60 sessions. Small samples are unreliable.</p>
        </Card>
      </div>
    </div>
  );
}

function pivot(b: { high: number; low: number; close: number }) {
  const pp = (b.high + b.low + b.close) / 3;
  return { r3: b.high + 2 * (pp - b.low), r2: pp + (b.high - b.low), r1: 2 * pp - b.low, pp, s1: 2 * pp - b.high, s2: pp - (b.high - b.low), s3: b.low - 2 * (b.high - pp) };
}

function LevelsTab({ d, bars }: { d: Any; bars: Bar[] }) {
  const { theme } = useTheme();
  const lv = d.levels;
  if (!lv) return <Empty title="Not enough price history for levels" />;
  const levels: ChartLevel[] = [...lv.supports.map((l: Any) => ({ price: l.price, kind: "support", label: `S ${num(l.price)}`, strong: l.strength === "major" })), ...lv.resistances.map((l: Any) => ({ price: l.price, kind: "resistance", label: `R ${num(l.price)}`, strong: l.strength === "major" }))];
  const LevelTable = ({ list, kind }: { list: Any[]; kind: string }) => (
    <div className="col">
      {list.length === 0 && <Empty title={`No ${kind} levels found`} />}
      {list.map((l) => (
        <div key={l.price} className="card" style={{ padding: 12 }}>
          <div className="row between">
            <div className="row"><span className="mono" style={{ fontSize: 17, fontWeight: 600 }}>Rs. {num(l.price)}</span><Badge tone={l.strength === "major" ? (kind === "support" ? "up" : "down") : ""}>{l.strength}</Badge>{l.volumeConfirmed && <Badge tone="blue">volume-confirmed</Badge>}{l.roleReversal && <Badge tone="accent">role reversal</Badge>}</div>
            <div className="row small"><span className="faint">Zone {num(l.low)}–{num(l.high)}</span><span className="faint">· {pct(l.distancePct, 1)} away</span><Score value={l.score} title="Level strength score" /></div>
          </div>
          <p className="small" style={{ margin: "6px 0 4px" }}>{l.why}</p>
          <p className="small muted" style={{ margin: 0 }}><strong>Invalidation:</strong> {l.invalidation}</p>
        </div>
      ))}
    </div>
  );
  return (
    <div className="col">
      <Card title="Levels on chart"><PriceChart bars={bars} levels={levels} overlays={["sma50", "sma200"]} height={420} theme={theme} /></Card>
      <div className="grid g2">
        <Card title="Resistance (above price)"><LevelTable list={lv.resistances} kind="resistance" /></Card>
        <Card title="Support (below price)"><LevelTable list={lv.supports} kind="support" /></Card>
      </div>
      <div className="grid g2">
        <Card title="Dynamic support / resistance">
          <table className="t"><tbody>{lv.dynamic.map((x: Any) => <tr key={x.name}><td>{x.name}</td><td className="num">{num(x.price)}</td><td><Badge tone={x.type === "support" ? "up" : "down"}>{x.type}</Badge></td><td className="small muted">{x.note}</td></tr>)}</tbody></table>
          <div className="sep" />
          <dl className="kv small"><dt>Breakout level</dt><dd>{num(lv.breakoutLevel)}</dd><dt>Breakdown level</dt><dd>{num(lv.breakdownLevel)}</dd><dt>ATR (14)</dt><dd>{num(lv.atr)}</dd><dt>Clustering tolerance</dt><dd>{num(lv.tolerance)}</dd></dl>
        </Card>
        <Card title="Demand & supply zones">
          {lv.zones.length === 0 ? <Empty title="No unbroken zones found" /> : lv.zones.map((z: Any) => (
            <div key={z.date + z.kind} style={{ marginBottom: 8 }}>
              <div className="row"><Badge tone={z.kind === "demand" ? "up" : "down"}>{z.kind}</Badge><span className="mono">{num(z.low)} – {num(z.high)}</span>{z.fresh && <Badge tone="accent">fresh</Badge>}</div>
              <div className="small muted">{z.why}</div>
            </div>
          ))}
        </Card>
      </div>
      <p className="tiny faint">Method: {lv.method}</p>
    </div>
  );
}

function FundamentalsTab({ d }: { d: Any }) {
  const fa = d.fundamentals;
  const sectors = useApi<Any[]>("/sectors");
  const [ddm, setDdm] = useState({ growth: 5, required: 12 });
  if (!fa) return <Empty title="No fundamental data" />;
  const sec = sectors.data?.find((s: Any) => s.sector === d.company.sector);
  const price = d.lastBar?.close;
  const lastCashPerShare = fa.dividend.cashPct != null ? (fa.dividend.cashPct / 100) * (d.company.paid_up_value ?? 100) : null;
  const ddmValue = lastCashPerShare != null ? dividendDiscount(lastCashPerShare, ddm.growth / 100, ddm.required / 100) : null;
  const gn = isNum(fa.byKey.eps) && isNum(fa.byKey.bvps) ? grahamNumber(fa.byKey.eps, fa.byKey.bvps) : null;
  return (
    <div className="col">
      {fa.dataNotes.map((n: string) => <Notice key={n}>{n}</Notice>)}
      <div className="grid g3">
        <Card title={`Fundamental score: ${fa.score.overall ?? "—"}`} sub={fa.score.model}>
          <div className="col">{fa.score.components.map((c: Any) => (
            <div key={c.name}><ScoreBar label={`${c.name} (weight ${Math.round(c.weight * 100)}%)`} value={c.score} /><div className="tiny faint">{c.drivers.join(" · ") || "No data"}</div></div>
          ))}</div>
        </Card>
        <Card title="Strengths & red flags">
          {fa.strengths.map((s: string) => <div key={s} className="small up">✓ {s}</div>)}
          {fa.redFlags.map((s: string) => <div key={s} className="small down">⚠ {s}</div>)}
          {!fa.strengths.length && !fa.redFlags.length && <Empty title="Nothing notable" />}
          <div className="sep" />
          <div className="small" style={{ fontWeight: 600 }}>Growth</div>
          {fa.growth.length ? fa.growth.map((g: Any) => <div key={g.label} className="row between small"><span className="muted">{g.label}</span><span className={`mono ${tone(g.value)}`}>{g.basis === "%" || g.label.includes("YoY") ? pct(g.value, 1) : int(g.value)}</span></div>) : <div className="small faint">Needs more than one stored quarter.</div>}
        </Card>
        <Card title="Valuation">
          <dl className="kv">
            <dt>Price</dt><dd>{num(price)}</dd>
            <dt>Graham number</dt><dd>{num(gn)} {gn && price ? <span className={price < gn ? "up" : "down"}>({pct(((gn - price) / price) * 100, 0)})</span> : null}</dd>
            <dt>Sector median P/E</dt><dd>{num(sec?.medianPe, 1)} <span className="faint">vs {num(fa.byKey.pe, 1)}</span></dd>
            <dt>Sector median P/B</dt><dd>{num(sec?.medianPb, 2)} <span className="faint">vs {num(fa.byKey.pb, 2)}</span></dd>
            <dt>Sector median ROE</dt><dd>{num(sec?.medianRoe, 1)}% <span className="faint">vs {num(fa.byKey.roe, 1)}%</span></dd>
          </dl>
          <div className="sep" />
          <div className="small" style={{ fontWeight: 600 }}>Dividend discount model</div>
          <div className="row small"><label className="field" style={{ flex: 1 }}>Growth %<input className="input" type="number" value={ddm.growth} onChange={(e) => setDdm({ ...ddm, growth: +e.target.value })} /></label><label className="field" style={{ flex: 1 }}>Required return %<input className="input" type="number" value={ddm.required} onChange={(e) => setDdm({ ...ddm, required: +e.target.value })} /></label></div>
          <div className="small" style={{ marginTop: 6 }}>Last cash dividend Rs. {num(lastCashPerShare)} / share → value <strong className="mono">{num(ddmValue)}</strong></div>
          <p className="tiny faint">Models are only as good as their assumptions. More in Wealth Planner → Calculators.</p>
        </Card>
      </div>
      <Card title={`Ratios (${fa.latestPeriod ?? "no period"})`} flush sub="Computed = calculated by Saphal Stocks from the statement line items; Reported = the company's own figure">
        <DataTable rows={fa.metrics} cols={[
          { key: "label", label: "Metric" },
          { key: "value", label: "Value", num: true, render: (m: Any) => fmtMetric(m.value, m.unit) },
          { key: "reported", label: "Reported", num: true, render: (m: Any) => m.reported != null ? fmtMetric(m.reported, m.unit) : "—" },
          { key: "basis", label: "Basis", render: (m: Any) => <Badge tone={m.basis === "computed" ? "accent" : m.basis === "market" ? "blue" : ""}>{m.basis}</Badge> },
          { key: "formula", label: "Formula / note", render: (m: Any) => <span className="small muted">{m.formula ?? m.note ?? ""}</span> },
        ]} />
      </Card>
      <Peers sym={d.symbol} />
    </div>
  );
}

function Peers({ sym }: { sym: string }) {
  const p = useApi<Any>(`/stocks/${sym}/peers`, [sym]);
  const nav = useNavigate();
  if (!p.data?.sector) return null;
  const r = p.data.ranks;
  const chip = (label: string, x: Any) => x ? <Badge key={label} tone={x.rank <= Math.ceil(x.of / 3) ? "up" : x.rank > (2 * x.of) / 3 ? "down" : ""}>{label}: #{x.rank} of {x.of}</Badge> : null;
  return (
    <Card title={`Sector peers · ${p.data.sector}`} flush sub="Where this company ranks among peers (cheapest P/E and P/B rank first)"
      actions={<button className="btn sm" onClick={() => nav(`/compare?s=${[sym, ...p.data.peers.filter((x: Any) => x.symbol !== sym).sort((a: Any, b: Any) => (b.avgTurnover20 ?? 0) - (a.avgTurnover20 ?? 0)).slice(0, 3).map((x: Any) => x.symbol)].join(",")}`)}>Compare with top peers</button>}>
      <div className="row" style={{ padding: "10px 16px" }}>{[chip("Fundamental", r.fundamental), chip("Technical", r.technical), chip("P/E", r.pe), chip("P/B", r.pb), chip("ROE", r.roe), chip("Yield", r.cashYield), chip("1Y return", r.return1y)]}</div>
      <DataTable rows={p.data.peers} onRow={(x: Any) => nav(`/stocks/${x.symbol}`)} maxHeight={420} initialSort={{ key: "fundamentalScore", dir: -1 }} rowKey={(x: Any) => x.symbol} cols={[
        { key: "symbol", label: "Stock", render: (x: Any) => <span className="sym" style={x.symbol === sym ? { color: "var(--accent)" } : undefined}>{x.symbol}{x.symbol === sym ? " ◀" : ""}</span> },
        { key: "price", label: "Price", num: true, render: (x: Any) => num(x.price) },
        { key: "pe", label: "P/E", num: true, render: (x: Any) => num(x.pe, 1) }, { key: "pb", label: "P/B", num: true, render: (x: Any) => num(x.pb, 2) },
        { key: "roe", label: "ROE %", num: true, render: (x: Any) => num(x.roe, 1) }, { key: "cashYield", label: "Yield %", num: true, render: (x: Any) => num(x.cashYield, 2) },
        { key: "return1y", label: "1Y", num: true, render: (x: Any) => <span className={tone(x.return1y)}>{pct(x.return1y, 1)}</span> },
        { key: "fundamentalScore", label: "Fund.", num: true, render: (x: Any) => <Score value={x.fundamentalScore} /> },
        { key: "technicalScore", label: "Tech.", num: true, render: (x: Any) => <Score value={x.technicalScore} /> },
      ]} />
    </Card>
  );
}

function fmtMetric(v: number | null, unit: string) {
  if (!isNum(v)) return "—";
  if (unit === "%") return `${num(v, 2)}%`;
  if (unit === "x") return `${num(v, 2)}x`;
  if (unit === "Rs. '000") return compact(v * 1000);
  return num(v);
}

function FinancialsTab({ sym }: { sym: string }) {
  const s = useApi<Any[]>(`/stocks/${sym}/statements`, [sym]);
  const [which, setWhich] = useState<"balance_sheet" | "income" | "metrics">("income");
  if (s.loading) return <Loading />;
  if (!s.data?.length) return <Empty title="No financial statements stored">Use Update on this page to fetch the latest published quarterly report. History builds up each quarter.</Empty>;
  const periods = s.data;
  const labels: string[] = [];
  for (const p of periods) for (const it of p.items) if (it.statement === which && !labels.includes(it.label)) labels.push(it.label);
  return (
    <Card title="Quarterly statements" sub={`Rs. in '000 unless a ratio. Source: ${periods[0].source}; fetched ${nptDate(periods[0].fetchedAt, true)}`} actions={<div className="seg">{(["income", "balance_sheet", "metrics"] as const).map((k) => <button key={k} className={which === k ? "on" : ""} onClick={() => setWhich(k)}>{k === "income" ? "Profit & loss" : k === "balance_sheet" ? "Balance sheet" : "Key metrics"}</button>)}</div>} flush>
      <div className="table-wrap" style={{ maxHeight: 640, overflowY: "auto" }}>
        <table className="t"><thead><tr><th>Particulars</th>{periods.map((p: Any) => <th key={p.period} className="num">{p.period}</th>)}</tr></thead>
          <tbody>{labels.map((l) => <tr key={l}><td>{l}</td>{periods.map((p: Any) => { const v = p.items.find((i: Any) => i.statement === which && i.label === l)?.value; return <td key={p.period} className="num">{v == null ? "—" : Math.abs(v) >= 1000 ? int(v) : num(v)}</td>; })}</tr>)}</tbody></table>
      </div>
    </Card>
  );
}

function DividendsTab({ d }: { d: Any }) {
  const { theme } = useTheme();
  const h = d.fundamentals?.dividend?.history ?? [];
  if (!h.length) return <Empty title="No dividend history stored">Click Update to fetch it.</Empty>;
  return (
    <div className="grid g3">
      <Card title="Dividend history" flush className="span2">
        <DataTable rows={h} cols={[
          { key: "fiscalYear", label: "Fiscal year" },
          { key: "cashPct", label: "Cash %", num: true, render: (r: Any) => num(r.cashPct) },
          { key: "bonusPct", label: "Bonus %", num: true, render: (r: Any) => num(r.bonusPct) },
          { key: "total", label: "Total %", num: true, sort: (r: Any) => (r.cashPct ?? 0) + (r.bonusPct ?? 0), render: (r: Any) => num((r.cashPct ?? 0) + (r.bonusPct ?? 0)) },
          { key: "bookCloseDate", label: "Book close", render: (r: Any) => nptDate(r.bookCloseDate) },
          { key: "announcementDate", label: "Announced", render: (r: Any) => nptDate(r.announcementDate) },
        ]} />
      </Card>
      <div className="col">
        <Card title="Summary">
          <dl className="kv">
            <dt>Latest year</dt><dd>{d.fundamentals.dividend.latestYear}</dd>
            <dt>Cash / bonus</dt><dd>{num(d.fundamentals.dividend.cashPct)}% / {num(d.fundamentals.dividend.bonusPct)}%</dd>
            <dt>Cash yield at current price</dt><dd>{num(d.fundamentals.dividend.cashYieldPct)}%</dd>
            <dt>Years paid (last 5)</dt><dd>{d.fundamentals.dividend.yearsPaidLast5}</dd>
          </dl>
          <p className="tiny faint">Percentages are of face value (Rs. {d.company.paid_up_value ?? 100}). Cash dividends and bonus shares are taxed at 5%.</p>
        </Card>
        <Card title="Total dividend % by year"><LineChart data={[...h].reverse().map((r: Any) => ({ date: `${r.fiscalYear.slice(0, 4)}-07-16`, value: (r.cashPct ?? 0) + (r.bonusPct ?? 0) }))} height={180} theme={theme} /></Card>
      </div>
    </div>
  );
}

function NewsTab({ sym }: { sym: string }) {
  const n = useApi<Any[]>(`/stocks/${sym}/announcements`, [sym]);
  const nav = useNavigate();
  if (n.loading) return <Loading />;
  return (
    <Card title="Announcements & disclosures" flush sub="Headlines from public sources; open the link for the full notice">
      {!n.data?.length ? <Empty title="No announcements stored">Click Update to fetch them.</Empty> : (
        <div className="list">{n.data.map((a: Any) => (
          <div key={a.id} className="list-item">
            <div style={{ flex: 1 }}>
              <a href={a.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text)" }}>{a.title}</a>
              <div className="tiny faint">{nptDate(a.published_date)} · <Badge>{a.category}</Badge> · {a.source}</div>
            </div>
            <button className="btn sm" onClick={() => nav(`/analyst?q=${encodeURIComponent(`Explain this ${sym} announcement and its likely impact: "${a.title}" (${a.published_date}). What happened, why it matters, short vs long-term impact, and what should I monitor?`)}`)}>Explain</button>
          </div>
        ))}</div>
      )}
    </Card>
  );
}

function BacktestTab({ sym }: { sym: string }) {
  const strategies = useApi<Any[]>("/backtest/strategies");
  const { theme } = useTheme();
  const [form, setForm] = useState({ strategy: "sma_cross", years: 5, capital: 100000, stopLossPct: "", takeProfitPct: "", slippagePct: 0.2 });
  const [params, setParams] = useState<Record<string, number>>({});
  const [res, setRes] = useState<Any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const def = strategies.data?.find((s: Any) => s.id === form.strategy);
  const run = async () => {
    setBusy(true); setErr(null);
    try {
      const from = new Date(Date.now() - form.years * 365.25 * 86_400_000).toISOString().slice(0, 10);
      setRes(await api("/backtest", { body: { symbol: sym, strategy: form.strategy, params: { ...def?.defaults, ...params }, from, capital: form.capital, stopLossPct: form.stopLossPct ? +form.stopLossPct : null, takeProfitPct: form.takeProfitPct ? +form.takeProfitPct : null, slippagePct: form.slippagePct } }));
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const s = res?.stats;
  const markers = useMemo(() => (res?.trades ?? []).flatMap((t: Any) => [{ date: t.entryDate, position: "below", text: "B", color: "#22c55e" }, { date: t.exitDate, position: "above", text: t.netPnl >= 0 ? "S+" : "S−", color: t.netPnl >= 0 ? "#60a5fa" : "#f43f5e" }]), [res]);
  return (
    <div className="col">
      <Card title="Backtest a strategy on this stock" sub="Long-only. Signals at close, fills at next open. Nepal commission, SEBON fee, DP charge and CGT applied.">
        <div className="form-grid">
          <label className="field">Strategy<select className="input" value={form.strategy} onChange={(e) => { setForm({ ...form, strategy: e.target.value }); setParams({}); }}>{strategies.data?.map((x: Any) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          {def && Object.entries(def.defaults).map(([k, v]) => <label key={k} className="field">{k}<input className="input" type="number" value={params[k] ?? (v as number)} onChange={(e) => setParams({ ...params, [k]: +e.target.value })} /></label>)}
          <label className="field">Years<input className="input" type="number" value={form.years} onChange={(e) => setForm({ ...form, years: +e.target.value })} /></label>
          <label className="field">Capital (Rs.)<input className="input" type="number" value={form.capital} onChange={(e) => setForm({ ...form, capital: +e.target.value })} /></label>
          <label className="field">Stop-loss %<input className="input" type="number" value={form.stopLossPct} placeholder="none" onChange={(e) => setForm({ ...form, stopLossPct: e.target.value })} /></label>
          <label className="field">Take-profit %<input className="input" type="number" value={form.takeProfitPct} placeholder="none" onChange={(e) => setForm({ ...form, takeProfitPct: e.target.value })} /></label>
          <label className="field">Slippage %<input className="input" type="number" step="0.1" value={form.slippagePct} onChange={(e) => setForm({ ...form, slippagePct: +e.target.value })} /></label>
        </div>
        {def && <p className="small muted" style={{ marginTop: 8 }}>{def.description}</p>}
        <button className="btn primary" onClick={run} disabled={busy} style={{ marginTop: 8 }}>{busy ? <span className="spinner" /> : "Run backtest"}</button>
        {err && <div style={{ marginTop: 8 }}><Notice tone="warn">{err}</Notice></div>}
      </Card>
      {res && (
        <>
          <div className="grid g6">
            <Stat label="Strategy return" value={pct(s.totalReturnPct, 1)} tone={tone(s.totalReturnPct)} sub={`CAGR ${pct(s.cagrPct, 1)}`} />
            <Stat label="Buy & hold" value={pct(s.buyHoldReturnPct, 1)} tone={tone(s.buyHoldReturnPct)} sub="Same period, before costs" />
            <Stat label="Win rate" value={s.winRatePct != null ? `${num(s.winRatePct, 0)}%` : "—"} sub={`${s.trades} trades`} />
            <Stat label="Max drawdown" value={`-${num(s.maxDrawdownPct, 1)}%`} tone="down" />
            <Stat label="Profit factor" value={num(s.profitFactor)} sub={`Avg trade ${pct(s.avgTradePct, 1)}`} />
            <Stat label="Costs & tax" value={compact(s.totalCosts + s.totalTax)} sub={`Exposure ${num(s.exposurePct, 0)}%`} />
          </div>
          <Card title="Equity curve" sub={`Starting capital Rs. ${int(s.startCapital)} (dashed line)`}><LineChart data={res.equity.map((e: Any) => ({ date: e.date, value: e.value }))} height={260} baseline={s.startCapital} theme={theme} /></Card>
          <Card title={`Trades (${res.trades.length})`} flush>
            <DataTable rows={res.trades} cols={[
              { key: "entryDate", label: "Entry", render: (t: Any) => nptDate(t.entryDate) }, { key: "entryPrice", label: "Buy", num: true, render: (t: Any) => num(t.entryPrice) },
              { key: "exitDate", label: "Exit", render: (t: Any) => nptDate(t.exitDate) }, { key: "exitPrice", label: "Sell", num: true, render: (t: Any) => num(t.exitPrice) },
              { key: "qty", label: "Qty", num: true, render: (t: Any) => int(t.qty) }, { key: "holdingDays", label: "Days", num: true },
              { key: "costs", label: "Costs", num: true, render: (t: Any) => num(t.costs, 0) }, { key: "tax", label: "CGT", num: true, render: (t: Any) => num(t.tax, 0) },
              { key: "netPnl", label: "Net P&L", num: true, render: (t: Any) => <span className={tone(t.netPnl)}>{num(t.netPnl, 0)}</span> },
              { key: "returnPct", label: "Return", num: true, render: (t: Any) => <span className={tone(t.returnPct)}>{pct(t.returnPct, 1)}</span> },
              { key: "reason", label: "Exit reason", render: (t: Any) => <span className="small muted">{t.reason}</span> },
            ]} />
          </Card>
          <Notice tone="warn">{res.caveats.join(" ")}</Notice>
          <BacktestChart sym={sym} markers={markers} />
        </>
      )}
    </div>
  );
}

function BacktestChart({ sym, markers }: { sym: string; markers: Any[] }) {
  const b = useApi<{ bars: Bar[] }>(`/stocks/${sym}/bars`, [sym]);
  const { theme } = useTheme();
  if (!b.data) return null;
  return <Card title="Entries (B) and exits (S) on the price chart"><PriceChart bars={b.data.bars} markers={markers} height={420} lower="volume" theme={theme} /></Card>;
}

function WatchModal({ sym, price, onClose }: { sym: string; price?: number; onClose: () => void }) {
  const lists = useApi<Any[]>("/watchlists");
  const [listId, setListId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState("");
  const [stop, setStop] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const id = listId ?? lists.data?.[0]?.id;
  const save = async () => {
    try { await api(`/watchlists/${id}/items`, { body: { symbol: sym, note: note || null, targetPrice: target ? +target : null, stopPrice: stop ? +stop : null } }); onClose(); } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Modal title={`Add ${sym} to watchlist`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save} disabled={!id}>Save</button></>}>
      <div className="col">
        <label className="field">Watchlist<select className="input" value={id ?? ""} onChange={(e) => setListId(+e.target.value)}>{lists.data?.map((l: Any) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <div className="grid g2"><label className="field">Target price<input className="input" type="number" value={target} placeholder={price ? String(price) : ""} onChange={(e) => setTarget(e.target.value)} /></label><label className="field">Stop / review price<input className="input" type="number" value={stop} onChange={(e) => setStop(e.target.value)} /></label></div>
        <label className="field">Note / thesis<textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></label>
        {msg && <Notice tone="warn">{msg}</Notice>}
      </div>
    </Modal>
  );
}

export function AlertModal({ sym, onClose }: { sym?: string; onClose: () => void }) {
  const types = useApi<Any[]>("/alerts/types");
  const [type, setType] = useState(sym ? "near_support" : "ipo");
  const [symbol, setSymbol] = useState(sym ?? "");
  const [params, setParams] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [repeat, setRepeat] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const def = types.data?.find((t: Any) => t.type === type);
  const save = async () => {
    try {
      await api("/alerts", { body: { type, symbol: def?.needsSymbol ? symbol.toUpperCase() : null, params: Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "").map(([k, v]) => [k, +v])), note: note || null, repeat } });
      onClose();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
  };
  const placeholders: Record<string, string> = { price: "Rs.", withinPct: "2", level: type === "rsi_oversold" ? "30" : "70", multiple: "2.5", score: "40", portfolioId: "Portfolio ID" };
  return (
    <Modal title="Create alert" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Create</button></>}>
      <div className="col">
        <label className="field">Alert type<select className="input" value={type} onChange={(e) => { setType(e.target.value); setParams({}); }}>{types.data?.map((t: Any) => <option key={t.type} value={t.type}>{t.label}</option>)}</select></label>
        {def?.needsSymbol && <label className="field">Symbol<input className="input" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></label>}
        <div className="grid g2">{def?.params.map((p: string) => <label key={p} className="field">{p}<input className="input" type="number" placeholder={placeholders[p]} value={params[p] ?? ""} onChange={(e) => setParams({ ...params, [p]: e.target.value })} /></label>)}</div>
        <label className="field">Note<input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why you set this alert" /></label>
        <label className="chk"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /> Keep active after it fires (repeat)</label>
        <p className="tiny faint">Alerts are checked against end-of-day data after each refresh. They fire only when the condition is met in the stored data, and show the data date.</p>
        {msg && <Notice tone="warn">{msg}</Notice>}
        <Link to="/alerts" className="small" onClick={onClose}>Manage all alerts</Link>
      </div>
    </Modal>
  );
}
