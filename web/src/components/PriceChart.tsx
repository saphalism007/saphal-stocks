// Interactive price chart (TradingView lightweight-charts) with overlays,
// support/resistance lines, an indicator pane, and optional markers.
import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, AreaSeries, LineStyle, createSeriesMarkers, type IChartApi, type Time, type SeriesMarker } from "lightweight-charts";
import type { Bar } from "../../../shared/types.ts";
import { computeAll, fibonacci } from "../../../shared/indicators.ts";

export type Overlay = "sma20" | "sma50" | "sma200" | "ema9" | "ema20" | "ema50" | "bb" | "vwap" | "supertrend" | "psar" | "ichimoku" | "fib";
export type Lower = "volume" | "rsi" | "macd" | "stoch" | "adx" | "obv" | "atr" | "none";

export interface ChartLevel { price: number; kind: "support" | "resistance" | "entry" | "stop" | "target" | "other"; label?: string; strong?: boolean }

const cssVar = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const OV_COLORS: Record<string, string> = { sma20: "#f59e0b", sma50: "#60a5fa", sma200: "#a78bfa", ema9: "#f472b6", ema20: "#34d399", ema50: "#38bdf8", vwap: "#fbbf24" };

export function PriceChart({ bars, overlays = [], lower = "volume", levels = [], markers = [], height = 460, kind = "candles", theme }: { bars: Bar[]; overlays?: Overlay[]; lower?: Lower; levels?: ChartLevel[]; markers?: { date: string; position: "above" | "below"; color?: string; text: string; shape?: "arrowUp" | "arrowDown" | "circle" }[]; height?: number; kind?: "candles" | "line"; theme?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!ref.current || !bars.length) return;
    const text = cssVar("--text-2"), grid = cssVar("--border"), up = cssVar("--up"), down = cssVar("--down");
    const chart = createChart(ref.current, {
      height, autoSize: true,
      layout: { background: { color: "transparent" }, textColor: text, fontFamily: "JetBrains Mono, monospace", fontSize: 11, panes: { separatorColor: grid } },
      grid: { vertLines: { color: grid + "66" }, horzLines: { color: grid + "66" } },
      rightPriceScale: { borderColor: grid }, timeScale: { borderColor: grid, rightOffset: 6 },
      crosshair: { mode: 0 },
      localization: { priceFormatter: (p: number) => p.toLocaleString("en-IN", { maximumFractionDigits: 2 }) },
    });
    chartRef.current = chart;
    const t = (d: string) => d as Time;
    const ind = computeAll(bars);
    const lineData = (s: (number | null)[]) => s.map((v, i) => (v == null ? null : { time: t(bars[i].date), value: v })).filter(Boolean) as { time: Time; value: number }[];

    const main = kind === "candles"
      ? chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down })
      : chart.addSeries(AreaSeries, { lineColor: cssVar("--accent"), topColor: cssVar("--accent-soft"), bottomColor: "transparent", lineWidth: 2 });
    if (kind === "candles") main.setData(bars.map((b) => ({ time: t(b.date), open: b.open, high: b.high, low: b.low, close: b.close })) as never);
    else main.setData(bars.map((b) => ({ time: t(b.date), value: b.close })) as never);

    const addLine = (s: (number | null)[], color: string, width = 1, style = LineStyle.Solid, pane = 0) => {
      const ls = chart.addSeries(LineSeries, { color, lineWidth: width as 1, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false }, pane);
      ls.setData(lineData(s));
      return ls;
    };
    const map: Record<string, (number | null)[]> = { sma20: ind.sma20, sma50: ind.sma50, sma200: ind.sma200, ema9: ind.ema9, ema20: ind.ema20, ema50: ind.ema50, vwap: ind.vwap.rolling };
    for (const o of overlays) {
      if (map[o]) addLine(map[o], OV_COLORS[o], o === "sma200" ? 2 : 1);
      if (o === "bb") { addLine(ind.bollinger.upper, "#94a3b8", 1, LineStyle.Dotted); addLine(ind.bollinger.middle, "#94a3b8", 1, LineStyle.Dashed); addLine(ind.bollinger.lower, "#94a3b8", 1, LineStyle.Dotted); }
      if (o === "supertrend") {
        addLine(ind.supertrend.line.map((v, i) => (ind.supertrend.direction[i] === 1 ? v : null)), up, 2);
        addLine(ind.supertrend.line.map((v, i) => (ind.supertrend.direction[i] === -1 ? v : null)), down, 2);
      }
      if (o === "psar") {
        const ps = chart.addSeries(LineSeries, { color: "#e879f9", lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 1.5, priceLineVisible: false, lastValueVisible: false }, 0);
        ps.setData(lineData(ind.psar));
      }
      if (o === "ichimoku") { addLine(ind.ichimoku.tenkan, "#f472b6"); addLine(ind.ichimoku.kijun, "#38bdf8"); addLine(ind.ichimoku.senkouA, "#22c55e88", 1, LineStyle.Dashed); addLine(ind.ichimoku.senkouB, "#f43f5e88", 1, LineStyle.Dashed); }
      if (o === "fib") {
        const recent = bars.slice(-120);
        let hi = 0, lo = 0;
        recent.forEach((b, i) => { if (b.high > recent[hi].high) hi = i; if (b.low < recent[lo].low) lo = i; });
        const f = fibonacci(recent[lo].low, recent[hi].high, lo < hi ? "up" : "down");
        for (const r of f.retracements) main.createPriceLine({ price: r.price, color: "#eab30888", lineWidth: 1, lineStyle: LineStyle.SparseDotted, axisLabelVisible: false, title: `Fib ${(r.ratio * 100).toFixed(1)}%` });
      }
    }

    for (const l of levels) {
      const color = l.kind === "support" ? up : l.kind === "resistance" ? down : l.kind === "entry" ? cssVar("--blue") : l.kind === "stop" ? "#f97316" : l.kind === "target" ? cssVar("--violet") : text;
      main.createPriceLine({ price: l.price, color: color + (l.strong === false ? "99" : ""), lineWidth: l.strong ? 2 : 1, lineStyle: l.kind === "support" || l.kind === "resistance" ? LineStyle.Dashed : LineStyle.Solid, axisLabelVisible: true, title: l.label ?? "" });
    }

    if (markers.length) {
      const dates = new Set(bars.map((b) => b.date));
      const ms: SeriesMarker<Time>[] = markers.filter((m) => dates.has(m.date)).sort((a, b) => (a.date < b.date ? -1 : 1)).map((m) => ({ time: t(m.date), position: m.position === "above" ? "aboveBar" : "belowBar", color: m.color || (m.position === "below" ? up : down), shape: m.shape || (m.position === "below" ? "arrowUp" : "arrowDown"), text: m.text }));
      createSeriesMarkers(main, ms);
    }

    // Volume overlay on the main pane (bottom 18%).
    if (lower === "volume" || lower !== "none") {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false }, 0);
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      vol.setData(bars.map((b, i) => ({ time: t(b.date), value: b.volume, color: (i > 0 && b.close >= bars[i - 1].close ? up : down) + "55" })));
    }
    if (lower !== "volume" && lower !== "none") {
      if (lower === "rsi") {
        const r = addLine(ind.rsi14, "#a78bfa", 1, LineStyle.Solid, 1);
        r.createPriceLine({ price: 70, color: down + "88", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "70" });
        r.createPriceLine({ price: 30, color: up + "88", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "30" });
      } else if (lower === "macd") {
        const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 1);
        h.setData(ind.macd.histogram.map((v, i) => (v == null ? null : { time: t(bars[i].date), value: v, color: v >= 0 ? up + "aa" : down + "aa" })).filter(Boolean) as never);
        addLine(ind.macd.macd, "#60a5fa", 1, LineStyle.Solid, 1);
        addLine(ind.macd.signal, "#f59e0b", 1, LineStyle.Solid, 1);
      } else if (lower === "stoch") {
        addLine(ind.stochastic.k, "#60a5fa", 1, LineStyle.Solid, 1);
        const d = addLine(ind.stochastic.d, "#f59e0b", 1, LineStyle.Solid, 1);
        d.createPriceLine({ price: 80, color: down + "88", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
        d.createPriceLine({ price: 20, color: up + "88", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      } else if (lower === "adx") {
        addLine(ind.adx.adx, "#e2e8f0", 2, LineStyle.Solid, 1);
        addLine(ind.adx.plusDI, up, 1, LineStyle.Solid, 1);
        addLine(ind.adx.minusDI, down, 1, LineStyle.Solid, 1);
      } else if (lower === "obv") addLine(ind.obv, "#38bdf8", 1, LineStyle.Solid, 1);
      else if (lower === "atr") addLine(ind.atr14, "#f472b6", 1, LineStyle.Solid, 1);
      const panes = chart.panes();
      if (panes[1]) panes[1].setHeight(Math.round(height * 0.26));
    }
    const from = Math.max(0, bars.length - 260);
    chart.timeScale().setVisibleRange({ from: t(bars[from].date), to: t(bars[bars.length - 1].date) });
    return () => { chart.remove(); chartRef.current = null; };
  }, [bars, overlays.join(","), lower, JSON.stringify(levels), JSON.stringify(markers), height, kind, theme]);

  if (!bars.length) return <div className="empty"><strong>No price history</strong>Run a data refresh to load prices.</div>;
  return <div ref={ref} className="chart-box" style={{ height }} />;
}

/** Simple line chart for index history, equity curves, etc. */
export function LineChart({ data, height = 240, color, baseline, theme, area = true }: { data: { date: string; value: number }[]; height?: number; color?: string; baseline?: number; theme?: string; area?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !data.length) return;
    const grid = cssVar("--border");
    const chart = createChart(ref.current, {
      height, autoSize: true,
      layout: { background: { color: "transparent" }, textColor: cssVar("--text-2"), fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: grid + "66" } },
      rightPriceScale: { borderColor: grid }, timeScale: { borderColor: grid },
      localization: { priceFormatter: (p: number) => p.toLocaleString("en-IN", { maximumFractionDigits: 2 }) },
    });
    const c = color || cssVar("--accent");
    const s = area
      ? chart.addSeries(AreaSeries, { lineColor: c, topColor: c + "33", bottomColor: c + "00", lineWidth: 2, priceLineVisible: false })
      : chart.addSeries(LineSeries, { color: c, lineWidth: 2, priceLineVisible: false });
    const seen = new Set<string>();
    s.setData(data.filter((d) => (seen.has(d.date) ? false : (seen.add(d.date), true))).map((d) => ({ time: d.date as Time, value: d.value })));
    if (baseline != null) s.createPriceLine({ price: baseline, color: cssVar("--text-3"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [data, height, color, baseline, theme, area]);
  if (!data.length) return <div className="empty"><strong>No data</strong></div>;
  return <div ref={ref} className="chart-box" style={{ height }} />;
}

const PALETTE = ["#34d399", "#60a5fa", "#f59e0b", "#f472b6", "#a78bfa", "#f87171"];
/** Several series on one chart (e.g. prices rebased to 100). */
export function MultiLineChart({ series, height = 300, baseline, theme }: { series: { name: string; data: { date: string; value: number }[] }[]; height?: number; baseline?: number; theme?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !series.length) return;
    const grid = cssVar("--border");
    const chart = createChart(ref.current, {
      height, autoSize: true,
      layout: { background: { color: "transparent" }, textColor: cssVar("--text-2"), fontFamily: "JetBrains Mono, monospace", fontSize: 11 },
      grid: { vertLines: { visible: false }, horzLines: { color: grid + "66" } }, rightPriceScale: { borderColor: grid }, timeScale: { borderColor: grid },
    });
    series.forEach((s, i) => {
      const ls = chart.addSeries(LineSeries, { color: PALETTE[i % PALETTE.length], lineWidth: 2, priceLineVisible: false, title: s.name });
      ls.setData(s.data.map((d) => ({ time: d.date as Time, value: d.value })));
      if (i === 0 && baseline != null) ls.createPriceLine({ price: baseline, color: cssVar("--text-3"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [JSON.stringify(series.map((s) => [s.name, s.data.length, s.data[s.data.length - 1]?.value])), height, baseline, theme]);
  return <div ref={ref} className="chart-box" style={{ height }} />;
}
export const SERIES_COLORS = PALETTE;
