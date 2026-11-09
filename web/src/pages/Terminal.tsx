// Chart terminal: a full-height chart with symbol search, ranges, log scale, overlays, your
// watchlist, and drawing tools (trendline, horizontal line, Fibonacci) saved per stock on this device.
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, LineStyle, PriceScaleMode, type IChartApi, type ISeriesApi, type Time } from "lightweight-charts";
import { useApi } from "../lib/api.ts";
import { Seg, Loading } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { num, pct, tone } from "../lib/format.ts";
import { computeAll } from "../../../shared/indicators.ts";
import type { Bar } from "../../../shared/types.ts";

type Tool = "none" | "trend" | "hline" | "fib";
type Drawing = { id: string; kind: "trend" | "hline" | "fib"; a: { time: string; price: number }; b?: { time: string; price: number } };
const RANGES: [string, number][] = [["1M", 22], ["3M", 66], ["6M", 130], ["1Y", 250], ["5Y", 1250], ["All", 100000]];
const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const key = (s: string) => `ss-draw-${s}`;
const loadD = (s: string): Drawing[] => { try { return JSON.parse(localStorage.getItem(key(s)) || "[]"); } catch { return []; } };

export default function Terminal() {
  const { symbol: p } = useParams();
  const nav = useNavigate();
  const sym = (p || localStorage.getItem("ss-terminal-symbol") || "NABIL").toUpperCase();
  const bars = useApi<{ bars: Bar[] }>(`/stocks/${sym}/bars`, [sym]);
  const wl = useApi<Any>("/watchlists");
  const [range, setRange] = useState("1Y");
  const [log, setLog] = useState(false);
  const [ov, setOv] = useState<string[]>(["sma50", "sma200"]);
  const [tool, setTool] = useState<Tool>("none");
  const [draw, setDraw] = useState<Drawing[]>(() => loadD(sym));
  const [pending, setPending] = useState<{ time: string; price: number } | null>(null);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  useEffect(() => { setDraw(loadD(sym)); try { localStorage.setItem("ss-terminal-symbol", sym); } catch { /* ignore */ } }, [sym]);
  useEffect(() => { try { localStorage.setItem(key(sym), JSON.stringify(draw)); } catch { /* ignore */ } }, [draw, sym]);
  const data = useMemo(() => { const b = bars.data?.bars ?? []; const n = RANGES.find((r) => r[0] === range)![1]; return b.slice(-Math.max(n + 200, 0)); }, [bars.data, range]);

  useEffect(() => {
    if (!ref.current || data.length < 2) return;
    const up = css("--up"), down = css("--down"), text = css("--text-2"), grid = css("--border");
    const chart = createChart(ref.current, { autoSize: true, layout: { background: { color: "transparent" }, textColor: text, fontSize: 11 }, grid: { vertLines: { color: grid + "55" }, horzLines: { color: grid + "55" } }, rightPriceScale: { borderColor: grid, mode: log ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal }, timeScale: { borderColor: grid, rightOffset: 8 }, crosshair: { mode: 0 } });
    chartRef.current = chart;
    const t = (d: string) => d as Time;
    const main = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down });
    main.setData(data.map((b) => ({ time: t(b.date), open: b.open, high: b.high, low: b.low, close: b.close })));
    mainRef.current = main;
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    vol.setData(data.map((b) => ({ time: t(b.date), value: b.volume, color: b.close >= b.open ? up + "66" : down + "66" })));
    const ind = computeAll(data);
    const colors: Record<string, string> = { sma20: "#f59e0b", sma50: "#60a5fa", sma200: "#a78bfa", ema20: "#34d399" };
    const series: Record<string, (number | null)[]> = { sma20: ind.sma20, sma50: ind.sma50, sma200: ind.sma200, ema20: ind.ema20 };
    for (const o of ov) {
      const add = (vals: (number | null)[], color: string, style = LineStyle.Solid) => { const s = chart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); s.setData(vals.map((v, i) => (v == null ? null : { time: t(data[i].date), value: v })).filter(Boolean) as { time: Time; value: number }[]); };
      if (series[o]) add(series[o], colors[o]);
      if (o === "bb") { add(ind.bollinger.upper, "#94a3b8", LineStyle.Dotted); add(ind.bollinger.lower, "#94a3b8", LineStyle.Dotted); }
    }
    // Drawings
    for (const d of draw) {
      if (d.kind === "hline") main.createPriceLine({ price: d.a.price, color: css("--accent"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      if (d.kind === "trend" && d.b) { const s = chart.addSeries(LineSeries, { color: css("--accent"), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }); const pts = [d.a, d.b].sort((x, y) => (x.time < y.time ? -1 : 1)); if (pts[0].time !== pts[1].time) s.setData(pts.map((x) => ({ time: t(x.time), value: x.price }))); }
      if (d.kind === "fib" && d.b) { const hi = Math.max(d.a.price, d.b.price), lo = Math.min(d.a.price, d.b.price); for (const r of [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]) main.createPriceLine({ price: hi - (hi - lo) * r, color: "#eab308aa", lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: false, title: `${(r * 100).toFixed(1)}%` }); }
    }
    const n = RANGES.find((r) => r[0] === range)![1];
    if (data.length > n) chart.timeScale().setVisibleLogicalRange({ from: data.length - n, to: data.length + 5 });
    return () => { chart.remove(); chartRef.current = null; mainRef.current = null; };
  }, [data, log, ov, draw, range]);

  // Clicks place drawings.
  useEffect(() => {
    const chart = chartRef.current, main = mainRef.current;
    if (!chart || !main || tool === "none") return;
    const h = (param: { time?: Time; point?: { x: number; y: number } }) => {
      if (!param.time || !param.point) return;
      const price = main.coordinateToPrice(param.point.y);
      if (price == null) return;
      const pt = { time: String(param.time), price: Math.round(price * 100) / 100 };
      if (tool === "hline") { setDraw((x) => [...x, { id: crypto.randomUUID(), kind: "hline", a: pt }]); setTool("none"); return; }
      if (!pending) { setPending(pt); return; }
      setDraw((x) => [...x, { id: crypto.randomUUID(), kind: tool as "trend" | "fib", a: pending, b: pt }]); setPending(null); setTool("none");
    };
    chart.subscribeClick(h);
    return () => { try { chart.unsubscribeClick(h); } catch { /* chart removed */ } };
  }, [tool, pending, data, log, ov, draw, range]);

  const last = data[data.length - 1], prev = data[data.length - 2];
  const chg = last && prev ? ((last.close - prev.close) / prev.close) * 100 : null;
  const watch: string[] = (wl.data ?? []).flatMap((w: Any) => (w.items ?? []).map((i: Any) => i.symbol));
  return (
    <div className="terminal">
      <div className="term-bar">
        <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) { nav(`/terminal/${q.trim().toUpperCase()}`); setQ(""); } }}><input className="input" style={{ width: 110 }} placeholder={sym} value={q} onChange={(e) => setQ(e.target.value)} /></form>
        <strong className="sym">{sym}</strong>{last && <span className="mono small">{num(last.close)} <span className={tone(chg)}>{pct(chg)}</span></span>}
        <Seg value={range} onChange={setRange} options={RANGES.map(([k]) => ({ key: k, label: k }))} />
        <button className={`btn sm ${log ? "primary" : ""}`} onClick={() => setLog(!log)}>Log</button>
        <select className="input" value="" onChange={(e) => { const v = e.target.value; if (v) setOv(ov.includes(v) ? ov.filter((x) => x !== v) : [...ov, v]); }}><option value="">Indicators ({ov.length})</option>{["sma20", "sma50", "sma200", "ema20", "bb"].map((o) => <option key={o} value={o}>{ov.includes(o) ? "✓ " : ""}{o.toUpperCase()}</option>)}</select>
        <span className="term-tools">
          {([["trend", "Trendline"], ["hline", "Horizontal"], ["fib", "Fibonacci"]] as [Tool, string][]).map(([k, l]) => <button key={k} className={`btn sm ${tool === k ? "primary" : ""}`} onClick={() => { setTool(tool === k ? "none" : k); setPending(null); }}>{l}</button>)}
          {draw.length > 0 && <button className="btn sm ghost" onClick={() => setDraw([])} title="Remove all drawings"><I.trash /> {draw.length}</button>}
        </span>
        <Link className="btn sm" to={`/stocks/${sym}`}>Analysis</Link>
      </div>
      <div className="term-body">
        <div className="term-chart">{bars.data ? <div ref={ref} style={{ position: "absolute", inset: 0 }} /> : <Loading />}
          {tool !== "none" && <div className="term-hint small">{tool === "hline" ? "Tap the chart where the line should go." : pending ? "Now tap the second point." : "Tap the first point on the chart."}</div>}
        </div>
        <aside className="term-side">
          <div className="tiny faint" style={{ textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 }}>Watchlist</div>
          {watch.length === 0 ? <p className="tiny faint">Add stocks to your <Link to="/watchlist">watchlist</Link> to switch quickly.</p> : watch.map((s) => <button key={s} className={`sig-item ${s === sym ? "on" : ""}`} onClick={() => nav(`/terminal/${s}`)}><span className="sym">{s}</span></button>)}
        </aside>
      </div>
    </div>
  );
}
type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
