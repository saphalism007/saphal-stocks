// One chart in the terminal: real daily bars (resampled to weekly/monthly when chosen), any chart
// type, indicators overlaid or in their own panes, an SVG layer for drawings, and the AI analyst's
// levels, zones and patterns drawn on the price pane.
import React, { useEffect, useMemo, useRef, useState, useCallback, type PointerEvent as RPE } from "react";
import { createChart, createSeriesMarkers, CandlestickSeries, BarSeries, LineSeries, AreaSeries, BaselineSeries, HistogramSeries, LineStyle, LineType, PriceScaleMode, CrosshairMode, type IChartApi, type ISeriesApi, type SeriesType, type Time, type Logical } from "lightweight-charts";
import { resample, type Timeframe } from "../../../shared/timeframe.ts";
import { INDICATOR_MAP, type IndicatorDef } from "../../../shared/ta.ts";
import { GUIDE, interpret } from "../../../shared/indicatorGuide.ts";
import { Link } from "react-router-dom";
import { allCandles } from "../../../shared/candles.ts";
import type { ChartAnalysis } from "../../../shared/analyst.ts";
import type { Bar } from "../../../shared/types.ts";
import { geometry, TOOLS, type Drawing, type Pt, type ToolId, type Mapper } from "./draw.ts";

const LIVE = "~live"; // marks the point that follows the pointer while drawing
export type ChartType = "candles" | "hollow" | "heikin" | "bars" | "line" | "area" | "baseline" | "step";
export interface IndInst { uid: string; id: string; params: Record<string, number>; colors: Record<string, string>; hidden?: boolean }
export interface PaneApi { screenshot: () => Promise<HTMLCanvasElement | null>; fit: () => void }
export interface PaneProps {
  bars: Bar[] | null; symbol: string; tf: Timeframe; chartType: ChartType; scaleMode: 0 | 1 | 2; range: number; from: string | null; to: string | null;
  indicators: IndInst[]; onEditIndicator: (uid: string) => void; onRemoveIndicator: (uid: string) => void; onToggleIndicator: (uid: string) => void;
  drawings: Drawing[]; onDrawings: (d: Drawing[], commit: boolean) => void; selected: string | null; onSelect: (id: string | null) => void;
  tool: ToolId; onToolDone: () => void; magnet: boolean; keepDrawing: boolean; hideDrawings: boolean;
  analysis: ChartAnalysis | null; showAi: boolean; showPatterns: boolean; showVolume: boolean; grid: boolean;
  onScaleMode: (m: 0 | 1 | 2) => void; active: boolean; onFocus: () => void; register: (api: PaneApi | null) => void; themeKey: string;
  full?: boolean; onFull?: () => void;
}

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const DAY = 86_400_000;
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmtP = (p: number) => (Math.abs(p) >= 1e6 ? `${(p / 1e6).toFixed(2)}M` : Math.abs(p) >= 1e4 ? `${(p / 1e3).toFixed(1)}K` : r2(p).toLocaleString("en-IN"));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));

function heikin(b: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < b.length; i++) {
    const c = (b[i].open + b[i].high + b[i].low + b[i].close) / 4;
    const o = i ? (out[i - 1].open + out[i - 1].close) / 2 : (b[i].open + b[i].close) / 2;
    out.push({ ...b[i], open: o, close: c, high: Math.max(b[i].high, o, c), low: Math.min(b[i].low, o, c) });
  }
  return out;
}

export default function ChartPane(p: PaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const keepRange = useRef<{ key: string; from: number; to: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [panes, setPanes] = useState<{ top: number; h: number }[]>([]);
  const [draft, setDraftS] = useState<Drawing | null>(null);
  const draftRef = useRef<Drawing | null>(null);
  const setDraft = (d: Drawing | null) => { draftRef.current = d; setDraftS(d); };
  const fixed = useRef(0);
  const downAt = useRef<{ x: number; y: number } | null>(null);
  // While a drawing is dragged it lives here (only this chart re-renders); it is saved once, on release.
  const [dragging, setDragging] = useState<Drawing | null>(null);
  const [slide, setSlide] = useState<{ id: string; dx: number; dy: number } | null>(null);
  // One update per screen frame, however fast the pointer events arrive.
  const frame = useRef(0), pending = useRef<(() => void) | null>(null);
  const perFrame = (fn: () => void) => { pending.current = fn; if (!frame.current) frame.current = requestAnimationFrame(() => { frame.current = 0; const f = pending.current; pending.current = null; f?.(); }); };
  const coarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;

  const data = useMemo(() => {
    let b = p.bars ?? [];
    if (p.tf !== "D") b = resample(b, p.tf);
    return b;
  }, [p.bars, p.tf]);
  const shown = useMemo(() => (p.chartType === "heikin" ? heikin(data) : data), [data, p.chartType]);
  const dates = useMemo(() => data.map((b) => b.date), [data]);
  const comp = useMemo(() => {
    const out: { inst: IndInst; def: IndicatorDef; vals: Record<string, (number | null)[]> }[] = [];
    for (const inst of p.indicators) { const def = INDICATOR_MAP.get(inst.id); if (!def || data.length < 2) continue; try { out.push({ inst, def, vals: def.compute(data, { ...Object.fromEntries(def.params.map((x) => [x.key, x.def])), ...inst.params }) }); } catch { /* skip */ } }
    return out;
  }, [p.indicators, data]);

  // date <-> logical index (fractional; extrapolated beyond the data for projections)
  const perBar = useMemo(() => { const n = dates.length; if (n < 2) return 1; const k = Math.min(60, n - 1); return (Date.parse(dates[n - 1]) - Date.parse(dates[n - 1 - k])) / DAY / k || 1; }, [dates]);
  // While drawing or dragging, the moving point is "live": it sits exactly under the pointer (between
  // candles too) so the line glides smoothly; it is pinned to a date only when you let go.
  const live = useRef(0);
  const toL = useCallback((t: string) => {
    if (t === LIVE) return live.current;
    const n = dates.length; if (!n) return 0;
    const ms = Date.parse(t);
    if (t >= dates[n - 1]) return n - 1 + (ms - Date.parse(dates[n - 1])) / DAY / perBar;
    if (t <= dates[0]) return (ms - Date.parse(dates[0])) / DAY / perBar;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (dates[m] <= t) lo = m; else hi = m; }
    const a = Date.parse(dates[lo]), b = Date.parse(dates[hi]);
    return lo + (b > a ? (ms - a) / (b - a) : 0);
  }, [dates, perBar]);
  const fromL = useCallback((l: number) => {
    const n = dates.length, i = Math.round(l);
    if (i >= 0 && i < n) return dates[i];
    const base = i < 0 ? dates[0] : dates[n - 1], k = i < 0 ? i : i - (n - 1);
    return new Date(Date.parse(base) + Math.round(k * perBar) * DAY).toISOString().slice(0, 10);
  }, [dates, perBar]);

  // ---------- build the chart ----------
  useEffect(() => {
    if (!host.current || shown.length < 2) return;
    const up = css("--up") || "#16a34a", down = css("--down") || "#dc2626", text = css("--text-2") || "#888", grid = css("--border") || "#333", accent = css("--accent") || "#10b981";
    const chart = createChart(host.current, {
      autoSize: true, layout: { attributionLogo: false, background: { color: "transparent" }, textColor: text, fontSize: 11, panes: { separatorColor: grid, enableResize: true } },
      grid: { vertLines: { color: p.grid ? grid + "44" : "transparent" }, horzLines: { color: p.grid ? grid + "44" : "transparent" } },
      rightPriceScale: { borderColor: grid, mode: p.scaleMode === 1 ? PriceScaleMode.Logarithmic : p.scaleMode === 2 ? PriceScaleMode.Percentage : PriceScaleMode.Normal },
      timeScale: { borderColor: grid, rightOffset: 4, minBarSpacing: 0.5 }, crosshair: { mode: CrosshairMode.Normal },
      // On touch screens a stray drag on the price axis squashed the candles; keep the price scale automatic there.
      ...(coarse ? { handleScale: { axisPressedMouseMove: { time: true, price: false }, axisDoubleClickReset: { time: true, price: true }, pinch: true, mouseWheel: true } } : {}),
    });
    chartRef.current = chart;
    const T = (d: string) => d as Time;
    const ohlc = shown.map((b) => ({ time: T(b.date), open: b.open, high: b.high, low: b.low, close: b.close }));
    const line = shown.map((b) => ({ time: T(b.date), value: b.close }));
    let main: ISeriesApi<SeriesType>;
    switch (p.chartType) {
      case "bars": main = chart.addSeries(BarSeries, { upColor: up, downColor: down, thinBars: false }); main.setData(ohlc); break;
      case "line": main = chart.addSeries(LineSeries, { color: accent, lineWidth: 2 }); main.setData(line); break;
      case "step": main = chart.addSeries(LineSeries, { color: accent, lineWidth: 2, lineType: LineType.WithSteps }); main.setData(line); break;
      case "area": main = chart.addSeries(AreaSeries, { lineColor: accent, topColor: accent + "55", bottomColor: accent + "05", lineWidth: 2 }); main.setData(line); break;
      case "baseline": { const vis = shown.slice(-Math.min(shown.length, p.range)); main = chart.addSeries(BaselineSeries, { baseValue: { type: "price", price: vis[0].close }, topLineColor: up, bottomLineColor: down, topFillColor1: up + "44", topFillColor2: up + "05", bottomFillColor1: down + "05", bottomFillColor2: down + "44" }); main.setData(line); break; }
      default: { const hollow = p.chartType === "hollow"; main = chart.addSeries(CandlestickSeries, { upColor: hollow ? "transparent" : up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down }); main.setData(ohlc); }
    }
    mainRef.current = main;
    if (p.showVolume) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
      vol.priceScale().applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
      vol.setData(data.map((b) => ({ time: T(b.date), value: b.volume, color: (b.close >= b.open ? up : down) + "55" })));
    }
    // Indicators
    let paneNo = 0;
    for (const { inst, def, vals } of comp) {
      if (inst.hidden) continue;
      const pane = def.overlay ? 0 : ++paneNo;
      let first: ISeriesApi<SeriesType> | null = null;
      for (const o of def.outputs) {
        const color = inst.colors[o.key] || o.color;
        const v = vals[o.key] ?? [];
        const pts = v.map((x, i) => (x == null || !Number.isFinite(x) ? (o.connect ? null : { time: T(data[i].date) }) : { time: T(data[i].date), value: x })).filter(Boolean) as { time: Time; value?: number }[];
        let s: ISeriesApi<SeriesType>;
        if (o.kind === "histogram") {
          s = chart.addSeries(HistogramSeries, { color, priceLineVisible: false, lastValueVisible: false, priceFormat: def.id === "volume" || def.id === "turnover" ? { type: "volume" } : undefined }, pane);
          s.setData(pts.map((q, i) => (q.value == null ? q : { ...q, color: def.id === "volume" ? ((data[i]?.close ?? 0) >= (data[i]?.open ?? 0) ? up : down) + "88" : q.value >= 0 ? (o.key === "bear" ? color : up + "aa") : down + "aa" })) as never);
        } else {
          s = chart.addSeries(LineSeries, { color, lineWidth: (o.width ?? 1) as 1, lineStyle: o.dashed ? LineStyle.Dashed : LineStyle.Solid, lineType: o.kind === "step" ? LineType.WithSteps : LineType.Simple, lineVisible: o.kind !== "dots", pointMarkersVisible: o.kind === "dots", pointMarkersRadius: 1.5, priceLineVisible: false, lastValueVisible: !def.overlay, crosshairMarkerVisible: false, ...(def.overlay ? { autoscaleInfoProvider: () => null } : {}) }, pane);
          s.setData(pts as never);
        }
        first = first ?? s;
      }
      if (first && def.levels) for (const lv of def.levels) first.createPriceLine({ price: lv, color: grid, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
    }
    // AI levels on the price pane: only the levels that matter for a decision, merged when they sit close together.
    const markers: { time: Time; position: "belowBar" | "aboveBar"; color: string; shape: "arrowUp" | "arrowDown" | "circle"; text: string }[] = [];
    if (p.showAi && p.analysis) {
      const a = p.analysis, c = a.price ?? shown[shown.length - 1].close;
      const pl = a.plan;
      type L = { price: number; title: string; color: string; pri: number; width: 1 | 2; style: LineStyle };
      const cand: L[] = [];
      if (pl.stop != null) cand.push({ price: pl.stop, title: "Stop", color: down, pri: 10, width: 2, style: LineStyle.Solid });
      const bz = pl.entryLow != null && pl.entryHigh != null ? { lo: pl.entryLow, hi: pl.entryHigh } : pl.bestZone ? { lo: pl.bestZone.low, hi: pl.bestZone.high } : null;
      if (bz) cand.push({ price: bz.hi, title: /BUY/.test(a.verdict) ? "BUY zone" : "Buy on dip", color: "#16a34a", pri: 9.5, width: 2, style: LineStyle.Solid });
      pl.targets.slice(0, 3).forEach((t, i) => cand.push({ price: t.price, title: `T${i + 1}`, color: "#2962ff", pri: 9 - i, width: 1, style: LineStyle.Solid }));
      if (pl.breakout) cand.push({ price: pl.breakout.price, title: "Breakout", color: "#f59e0b", pri: 8, width: 1, style: LineStyle.Dotted });
      const sup = a.levels.find((l) => l.side === "support" && l.price < c), res = a.levels.find((l) => l.side === "resistance" && l.price > c);
      if (sup) cand.push({ price: sup.price, title: "Support", color: up, pri: 7, width: 1, style: LineStyle.Dashed });
      if (res) cand.push({ price: res.price, title: "Resistance", color: down, pri: 6, width: 1, style: LineStyle.Dashed });
      const kept: L[] = [];
      for (const l of cand.sort((x, y) => y.pri - x.pri)) {
        const twin = kept.find((k) => Math.abs(k.price - l.price) / c < 0.006);
        if (twin) { if (!twin.title.includes(l.title)) twin.title += ` / ${l.title}`; continue; }
        kept.push({ ...l });
      }
      for (const l of kept) main.createPriceLine({ price: l.price, color: l.color, lineWidth: l.width, lineStyle: l.style, axisLabelVisible: true, title: l.title });
      // Today's action on the last bar.
      const lastD = shown[shown.length - 1].date;
      if (/BUY/.test(a.verdict) && bz) markers.push({ time: T(lastD), position: "belowBar", color: up, shape: "arrowUp", text: `${a.verdict} ${bz.lo}-${bz.hi}` });
      else if (/SELL/.test(a.verdict)) markers.push({ time: T(lastD), position: "aboveBar", color: down, shape: "arrowDown", text: a.verdict });
      else markers.push({ time: T(lastD), position: "aboveBar", color: "#f59e0b", shape: "circle", text: a.verdict });
      // Past buy signals from the same rules: B at the entry, S at the exit (snapped to the bar that contains the date).
      const snap = (d: string) => { const b = shown.find((x) => x.date >= d); return b ? b.date : null; };
      for (const g0 of a.signals ?? []) {
        const ed = snap(g0.entryDate), xd = snap(g0.exitDate);
        if (!ed || !xd) continue;
        const g = { ...g0, entryDate: ed, exitDate: xd };
        markers.push({ time: T(g.entryDate), position: "belowBar", color: up, shape: "arrowUp", text: `B ${g.entry}` });
        markers.push({ time: T(g.exitDate), position: "aboveBar", color: g.netPct >= 0 ? "#2962ff" : down, shape: "arrowDown", text: `S ${g.exit} ${g.netPct >= 0 ? "+" : ""}${g.netPct.toFixed(1)}%` });
      }
    }
    if (p.showPatterns) {
      const cs = allCandles(data, Math.max(0, data.length - 300));
      for (const c of cs) markers.push({ time: T(c.date), position: c.dir === "bullish" ? "belowBar" : "aboveBar", color: (c.dir === "bullish" ? up : down) + "99", shape: "circle", text: c.name.replace(/Bullish |Bearish /, "").split(" ").map((w) => w[0]).join("").toUpperCase() });
    }
    if (markers.length) createSeriesMarkers(main, markers.sort((x, y) => String(x.time).localeCompare(String(y.time))) as never);
    // Pane heights
    const H = host.current.clientHeight, sub = paneNo ? Math.max(70, Math.min(130, (H * 0.45) / paneNo)) : 0;
    chart.panes().forEach((pn, i) => { if (i > 0) pn.setHeight(sub); });
    if (paneNo) chart.panes()[0].setHeight(Math.max(140, H - sub * paneNo - 26));
    // Range
    const key = `${p.symbol}|${p.tf}`;
    const n = data.length;
    const kept = keepRange.current?.key === key ? { ...keepRange.current } : null;
    const restore = () => { if (chartRef.current !== chart) return; if (kept) chart.timeScale().setVisibleLogicalRange({ from: kept.from, to: kept.to }); else applyRange(chart); };
    restore(); requestAnimationFrame(restore); setTimeout(restore, 120);
    const onRange = () => { const r = chart.timeScale().getVisibleLogicalRange(); if (r) keepRange.current = { key, from: r.from, to: r.to }; setTick((x) => x + 1); };
    chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    const onMove = (param: { logical?: number }) => setHover(param.logical != null && param.logical >= 0 && param.logical < n ? Math.round(param.logical) : null);
    chart.subscribeCrosshairMove(onMove as never);
    // Repaint the drawing layer whenever the price scale or size changes (no event for those).
    let raf = 0, sig = "";
    const loop = () => {
      const pn = chart.panes();
      const s = `${main.priceToCoordinate(shown[n - 1].close)}|${chart.timeScale().logicalToCoordinate(0 as Logical)}|${chart.timeScale().width()}|${pn.map((x) => x.getHeight()).join(",")}`;
      if (s !== sig) { sig = s; let top = 0; setPanes(pn.map((x) => { const r = { top, h: x.getHeight() }; top += x.getHeight() + 1; return r; })); setTick((x) => x + 1); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); chart.remove(); chartRef.current = null; mainRef.current = null; };
  }, [shown, data, comp, p.chartType, p.scaleMode, p.showVolume, p.showAi, p.analysis, p.showPatterns, p.grid, p.themeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyRange(chart = chartRef.current) {
    if (!chart) return;
    const n = data.length;
    if (p.from || p.to) {
      const a = p.from ? toL(p.from) : 0, b = p.to ? toL(p.to) : n - 1;
      chart.timeScale().setVisibleLogicalRange({ from: a, to: b + 3 });
    } else {
      const per = p.tf === "W" ? 5 : p.tf === "M" ? 21 : 1;
      const k = Math.ceil(p.range / per);
      chart.timeScale().setVisibleLogicalRange({ from: Math.max(-2, n - k), to: n + 3 });
    }
  }
  useEffect(() => { keepRange.current = null; applyRange(); }, [p.range, p.from, p.to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    p.register({
      fit: () => { keepRange.current = null; chartRef.current?.timeScale().fitContent(); chartRef.current?.priceScale("right").applyOptions({ autoScale: true }); },
      screenshot: async () => {
        const chart = chartRef.current; if (!chart) return null;
        const cv = chart.takeScreenshot(true, false);
        const svg = host.current?.parentElement?.querySelector("svg.draw-layer") as SVGSVGElement | null;
        if (svg) {
          const xml = new XMLSerializer().serializeToString(svg);
          const img = new Image();
          await new Promise<void>((res) => { img.onload = () => res(); img.onerror = () => res(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml); });
          const ctx = cv.getContext("2d"); const ratio = cv.width / (host.current?.clientWidth || cv.width);
          try { ctx?.drawImage(img, 0, 0, svg.clientWidth * ratio, svg.clientHeight * ratio); } catch { /* ignore */ }
        }
        return cv;
      },
    });
    return () => p.register(null);
  }, [p.register]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- drawing layer ----------
  const chart = chartRef.current, main = mainRef.current;
  const w = chart ? chart.timeScale().width() : 0, h = panes[0]?.h ?? 0;
  const mapper: Mapper | null = chart && main ? {
    x: (t) => chart.timeScale().logicalToCoordinate(toL(t) as Logical), y: (pr) => main.priceToCoordinate(pr), w, h, idx: toL, fmt: fmtP,
    closesBetween: (a, b) => { const la = toL(a), lb = toL(b), i0 = Math.round(Math.min(la, lb)), i1 = Math.round(Math.max(la, lb)); const out: { i: number; c: number }[] = []; for (let i = Math.max(0, i0); i <= Math.min(data.length - 1, i1); i++) out.push({ i, c: data[i].close }); return out; },
  } : null;
  void tick;

  // Magnet: pulls a point to the nearest open/high/low/close only when the pointer is close to it,
  // so the line does not jump around while you stretch it.
  const snapPrice = (l: number, y: number, pr: number) => {
    const b = data[Math.round(l)]; if (!b || !main) return pr;
    const best = [b.open, b.high, b.low, b.close].reduce((m, v) => (Math.abs(v - pr) < Math.abs(m - pr) ? v : m), b.open);
    const yb = main.priceToCoordinate(best);
    return yb != null && Math.abs(yb - y) < (coarse ? 18 : 10) ? best : pr;
  };
  const toPt = (x: number, y: number, snap = p.magnet): Pt | null => {
    if (!chart || !main) return null;
    const l = chart.timeScale().coordinateToLogical(x); let pr: number | null = main.coordinateToPrice(y);
    if (l == null || pr == null) return null;
    if (snap) pr = snapPrice(l, y, pr);
    return { t: fromL(l), p: r2(pr as number) };
  };
  /** The point under the pointer, unrounded, for smooth previews. */
  const toLive = (x: number, y: number, snap = p.magnet): Pt | null => {
    if (!chart || !main) return null;
    const l = chart.timeScale().coordinateToLogical(x); let pr: number | null = main.coordinateToPrice(y);
    if (l == null || pr == null) return null;
    if (snap) pr = snapPrice(l, y, pr);
    live.current = l;
    return { t: LIVE, p: pr };
  };
  const pin = (d: Drawing): Drawing => ({ ...d, pts: d.pts.map((q) => (q.t === LIVE ? { t: fromL(live.current), p: r2(q.p) } : q)) });
  const rel = (e: { clientX: number; clientY: number }) => { const r = host.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const finish = (d0: Drawing) => {
    const d = pin(d0);
    let fin = { ...d, pts: d.pts.slice(0, Math.max(1, TOOLS.get(d.tool)?.points || d.pts.length)) };
    if (d.tool === "text" || d.tool === "callout") { const t = window.prompt("Text for the note", d.text ?? ""); if (t == null) { setDraft(null); return; } fin = { ...fin, text: t }; }
    p.onDrawings([...p.drawings, fin], true); p.onSelect(fin.id); setDraft(null); fixed.current = 0;
    if (!p.keepDrawing) p.onToolDone();
  };
  const svgDown = (e: RPE<SVGSVGElement>) => {
    if (p.tool === "cursor") return;
    e.preventDefault();
    const { x, y } = rel(e); downAt.current = { x, y };
    const pt = toPt(x, y); if (!pt) return;
    const def = TOOLS.get(p.tool)!;
    if (def.points === 0) { // freehand
      const d: Drawing = { id: uid(), tool: p.tool, pts: [pt], color: p.tool === "highlighter" ? "#facc15" : "#2962ff", width: 2, dash: false };
      setDraft(d);
      const move = (ev: PointerEvent) => { const q = rel(ev); const pp = toPt(q.x, q.y, false); if (pp) { d.pts.push(pp); perFrame(() => setDraft({ ...d })); } };
      const upH = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", upH); if (d.pts.length > 1) finish(d); else setDraft(null); };
      window.addEventListener("pointermove", move); window.addEventListener("pointerup", upH);
      return;
    }
    const cur = draftRef.current;
    if (!cur) {
      const d: Drawing = { id: uid(), tool: p.tool, pts: def.points > 1 ? [pt, pt] : [pt], color: p.tool === "fib" || p.tool === "fibext" ? "#eab308" : "#2962ff", width: 2, dash: false };
      fixed.current = 1;
      if (def.points === 1) { finish(d); return; }
      setDraft(d);
      // Drag-to-draw: releasing away from the first point fixes the second point.
      const upH = (ev: PointerEvent) => {
        window.removeEventListener("pointerup", upH);
        const q = rel(ev), start = downAt.current; downAt.current = null;
        const dr = draftRef.current;
        if (!dr || !start || fixed.current !== 1 || Math.hypot(q.x - start.x, q.y - start.y) <= 6) return;
        const p2 = toPt(q.x, q.y); if (!p2) return;
        fixed.current = 2; const pts = [dr.pts[0], p2];
        if (def.points <= 2) finish({ ...dr, pts }); else setDraft({ ...dr, pts: [...pts, p2] });
      };
      window.addEventListener("pointerup", upH);
    } else {
      fixed.current++;
      const pts = [...pin(cur).pts]; pts[fixed.current - 1] = pt;
      if (fixed.current >= def.points) finish({ ...cur, pts }); else setDraft({ ...cur, pts: [...pts, pt] });
    }
  };
  const svgMove = (e: RPE<SVGSVGElement>) => {
    const cur = draftRef.current; if (!cur || TOOLS.get(cur.tool)?.points === 0) return;
    const { x, y } = rel(e);
    perFrame(() => { const c2 = draftRef.current; if (!c2) return; const pt = toLive(x, y); if (!pt) return; const pts = [...c2.pts]; pts[pts.length - 1] = pt; setDraft({ ...c2, pts }); });
  };
  const svgUp = () => { /* handled by the window listener */ };
  useEffect(() => { if (p.tool === "cursor") { setDraft(null); fixed.current = 0; } }, [p.tool]);

  const startDrag = (e: RPE<SVGElement>, d: Drawing, handle: number | null) => {
    if (p.tool !== "cursor") return;
    e.stopPropagation(); e.preventDefault(); p.onFocus(); p.onSelect(d.id);
    if (d.locked || !chart || !main) return;
    const s = rel(e), l0 = chart.timeScale().coordinateToLogical(s.x), p0 = main.coordinateToPrice(s.y);
    if (l0 == null || p0 == null) return;
    const orig = d; let last = d;
    const move = (ev: PointerEvent) => {
      ev.preventDefault();
      const q = rel(ev); const l = chart.timeScale().coordinateToLogical(q.x), pr = main.coordinateToPrice(q.y);
      if (l == null || pr == null) return;
      let next: Drawing;
      if (handle == null) {
        const dl = l - l0, dp = pr - p0; next = { ...orig, pts: orig.pts.map((pt) => ({ t: fromL(toL(pt.t) + dl), p: r2(pt.p + dp) })), target: orig.target != null ? r2(orig.target + dp) : undefined };
        last = next; const off = { id: d.id, dx: q.x - s.x, dy: q.y - s.y };
        perFrame(() => setSlide(off)); // the shape slides with the pointer; dates are fixed on release
        return;
      }
      else { const pt = toLive(q.x, q.y); if (!pt) return; const pts = [...orig.pts];
        if (handle < pts.length) pts[handle] = pt; else if (handle === 10) { pts[0] = { ...pts[0], t: pt.t }; pts[1] = { ...pts[1], p: pt.p }; } else if (handle === 11) { pts[1] = { ...pts[1], t: pt.t }; pts[0] = { ...pts[0], p: pt.p }; }
        next = { ...orig, pts, target: handle === 20 ? pt.p : orig.target }; }
      last = pin(next);
      perFrame(() => setDragging(next));
    };
    const upH = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", upH); window.removeEventListener("pointercancel", upH);
      if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
      setDragging(null); setSlide(null);
      if (last !== orig) p.onDrawings(p.drawings.map((x) => (x.id === d.id ? last : x)), true);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", upH); window.addEventListener("pointercancel", upH);
  };

  const renderOne = (d: Drawing, isDraft = false) => {
    if (!mapper) return null;
    const g = geometry(d, mapper); if (!g) return null;
    const sel = p.selected === d.id && !isDraft;
    const hitD = g.paths.map((x) => x.d).join(" ") + (g.labels.length && (d.tool === "text" || d.tool === "callout") ? ` M${g.labels[0].x - 4},${g.labels[0].y - 14}h80v20h-80Z` : "");
    return (
      <g key={d.id} opacity={isDraft ? 0.8 : 1}>
        {g.paths.map((x, i) => <path key={i} d={x.d} fill={x.fill ?? "none"} fillOpacity={x.fill ? x.opacity ?? 1 : undefined} stroke={x.stroke === "none" ? "none" : x.stroke ?? d.color} strokeWidth={x.width ?? d.width} strokeOpacity={x.fill ? (x.stroke ? 1 : 0) : x.opacity ?? 1} strokeDasharray={x.dash ? "6 4" : undefined} strokeLinecap="round" strokeLinejoin="round" style={{ pointerEvents: "none" }} />)}
        {g.labels.map((l, i) => (
          <g key={`l${i}`} style={{ pointerEvents: "none" }}>
            {l.bg && <rect x={l.anchor === "middle" ? l.x - (l.text.length * 3.3 + 6) : l.anchor === "end" ? l.x - l.text.length * 6.6 - 8 : l.x - 3} y={l.y - (l.size ?? 11) - 2} width={l.text.length * 6.6 + 10} height={(l.size ?? 11) + 7} rx={4} fill={l.bg === "panel" ? "var(--panel)" : l.bg} opacity={l.bg === "panel" ? 0.9 : 0.9} />}
            <text x={l.x + (l.bg && l.anchor !== "middle" && l.anchor !== "end" ? 2 : 0)} y={l.y} fontSize={l.size ?? 11} textAnchor={l.anchor ?? "start"} fill={l.bg && l.bg !== "panel" ? "#fff" : l.color ?? d.color} fontWeight={l.bg ? 600 : 500} style={{ paintOrder: "stroke", stroke: l.bg ? "none" : "var(--bg)", strokeWidth: 3 }}>{l.text}</text>
          </g>
        ))}
        {!isDraft && <path d={hitD} fill="none" stroke="transparent" strokeWidth={coarse ? 26 : 14} style={{ pointerEvents: p.tool === "cursor" ? "all" : "none", cursor: d.locked ? "pointer" : "move", touchAction: "none" }} onPointerDown={(e) => startDrag(e, d, null)} />}
        {sel && !d.locked && g.handles.map((hd) => <circle key={`h${hd.i}`} cx={hd.x} cy={hd.y} r={coarse ? 10 : 6} fill="var(--panel)" stroke={d.color} strokeWidth={2} style={{ pointerEvents: "all", cursor: "grab", touchAction: "none" }} onPointerDown={(e) => startDrag(e, d, hd.i)} />)}
      </g>
    );
  };

  // AI zones, divergences and chart patterns as evidence on the chart
  const [legOpen, setLegOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const aiLayer = () => {
    if (!p.showAi || !p.analysis || !mapper) return null;
    const a = p.analysis, out: React.ReactElement[] = [], wide = w >= 640;
    a.zones.slice(0, 2).forEach((z, i) => { const y1 = mapper.y(z.high), y2 = mapper.y(z.low); if (y1 == null || y2 == null) return; const c = z.kind === "demand" ? "#22c55e" : "#ef4444"; out.push(<g key={`z${i}`}><rect x={w * 0.6} y={y1} width={w * 0.4} height={Math.max(2, y2 - y1)} fill={c} opacity={0.08} />{wide && <text x={w * 0.6 + 4} y={y2 - 3} fontSize={10} fill={c}>{z.kind === "demand" ? "Demand" : "Supply"} zone</text>}</g>); });
    const z = a.plan.entryLow != null && a.plan.entryHigh != null ? { lo: a.plan.entryLow, hi: a.plan.entryHigh as number } : a.plan.bestZone ? { lo: a.plan.bestZone.low, hi: a.plan.bestZone.high } : null;
    if (z) { const y1 = mapper.y(z.hi), y2 = mapper.y(z.lo); if (y1 != null && y2 != null) out.push(<g key="entry"><rect x={w * 0.6} y={y1} width={w * 0.4} height={Math.max(3, y2 - y1)} fill="#22c55e" opacity={0.18} stroke="#22c55e" strokeOpacity={0.5} strokeDasharray="3 3" /></g>); }
    if (wide) a.divergences.slice(0, 1).forEach((dv, i) => { const x1 = mapper.x(dv.from), x2 = mapper.x(dv.to), y1 = mapper.y(dv.fromPrice), y2 = mapper.y(dv.toPrice); if ([x1, x2, y1, y2].some((v) => v == null)) return; const c = dv.dir === "bullish" ? "#22c55e" : "#ef4444"; out.push(<path key={`d${i}`} d={`M${x1},${y1}L${x2},${y2}`} stroke={c} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.8} />); });
    a.patterns.slice(0, 1).forEach((pt, i) => { const xy = pt.points.map((q) => [mapper.x(q.date), mapper.y(q.price)]); if (xy.length < 2 || xy.some((q) => q[0] == null || q[1] == null)) return; const c = pt.direction === "bullish" ? "#22c55e" : pt.direction === "bearish" ? "#ef4444" : "#a855f7"; const top = Math.min(...xy.map((q) => q[1]!)); const cx = xy.reduce((s, q) => s + q[0]!, 0) / xy.length; out.push(<g key={`p${i}`}><path d={"M" + xy.map((q) => `${q[0]},${q[1]}`).join("L")} fill="none" stroke={c} strokeWidth={1.2} opacity={0.7} />{wide && <text x={cx} y={top - 8} fontSize={10} fill={c} textAnchor="middle" fontWeight={600}>{pt.name}</text>}</g>); });
    return <g style={{ pointerEvents: "none" }}>{out}</g>;
  };

  // ---------- legend ----------
  const hi = hover ?? data.length - 1, bar = data[hi], pb = data[hi - 1];
  const chg = bar && pb ? ((bar.close - pb.close) / pb.close) * 100 : null;
  const val = (vals: (number | null)[]) => { const v = vals[hi]; return v == null ? "-" : fmtP(v); };
  let sub = 0;
  return (
    <div className={`term-pane ${p.active ? "on" : ""}`} onPointerDown={p.onFocus}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {!p.bars && <div className="term-msg">Loading prices...</div>}
      {p.bars && data.length < 2 && <div className="term-msg">No price history stored for {p.symbol}.</div>}
      {mapper && w > 0 && h > 0 && (
        <svg className="draw-layer" width={w} height={h} style={{ position: "absolute", left: 0, top: 0, zIndex: 5, pointerEvents: p.tool === "cursor" ? "none" : "all", touchAction: p.tool === "cursor" ? "auto" : "none", cursor: p.tool === "cursor" ? "default" : "crosshair", overflow: "hidden" }}
          onPointerDown={svgDown} onPointerMove={svgMove} onPointerUp={svgUp} onClick={(e) => { if (p.tool === "cursor" && e.target === e.currentTarget) p.onSelect(null); }}>
          {aiLayer()}
          {!p.hideDrawings && p.drawings.filter((d) => !d.hidden).map((d) => (slide && slide.id === d.id ? <g key={d.id} transform={`translate(${slide.dx},${slide.dy})`}>{renderOne(d)}</g> : renderOne(dragging && dragging.id === d.id ? dragging : d)))}
          {draft && renderOne(draft, true)}
        </svg>
      )}
      {bar && (
        <div className="term-legend">
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <strong>{p.symbol}</strong><span className="faint">{p.tf === "D" ? "1D" : p.tf === "W" ? "1W" : "1M"} | {bar.date}</span>
            <span className={bar.close >= bar.open ? "up" : "down"} style={{ fontVariantNumeric: "tabular-nums" }}>O {fmtP(bar.open)} H {fmtP(bar.high)} L {fmtP(bar.low)} C {fmtP(bar.close)} {chg != null ? `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%` : ""}</span>
            <span className="faint">Vol {fmtP(bar.volume)}</span>
          </div>
          {comp.some((c) => c.def.overlay) && w < 640 && <button className="leg-toggle" onClick={(e) => { e.stopPropagation(); setLegOpen(!legOpen); }}>{comp.filter((c) => c.def.overlay).length} indicator{comp.filter((c) => c.def.overlay).length === 1 ? "" : "s"} {legOpen ? "▴" : "▾"}</button>}
          {(w >= 640 || legOpen) && comp.filter((c) => c.def.overlay).map(({ inst, def, vals }) => (
            <div key={inst.uid} className="leg-row"><span style={{ opacity: inst.hidden ? 0.4 : 1 }}>{def.short}{def.params.length ? ` (${def.params.map((x) => inst.params[x.key] ?? x.def).join(", ")})` : ""}</span>
              {!inst.hidden && def.outputs.map((o) => <span key={o.key} style={{ color: inst.colors[o.key] || o.color }}>{val(vals[o.key] ?? [])}</span>)}
              <LegBtns inst={inst} p={p} onInfo={() => setInfo(info === inst.uid ? null : inst.uid)} /></div>
          ))}
        </div>
      )}
      {comp.filter((c) => !c.def.overlay && !c.inst.hidden).map(({ inst, def, vals }) => { sub++; const pn = panes[sub]; if (!pn) return null; return (
        <div key={inst.uid} className="term-legend sub" style={{ top: pn.top + 2 }}><div className="leg-row"><span>{def.short}{def.params.length ? ` (${def.params.map((x) => inst.params[x.key] ?? x.def).join(", ")})` : ""}</span>{def.outputs.map((o) => <span key={o.key} style={{ color: inst.colors[o.key] || o.color }}>{val(vals[o.key] ?? [])}</span>)}<LegBtns inst={inst} p={p} onInfo={() => setInfo(info === inst.uid ? null : inst.uid)} /></div></div>
      ); })}
      {comp.filter((c) => !c.def.overlay && c.inst.hidden).length > 0 && <div className="term-legend sub" style={{ bottom: 30, top: "auto" }}>{comp.filter((c) => !c.def.overlay && c.inst.hidden).map(({ inst, def }) => <div key={inst.uid} className="leg-row"><span style={{ opacity: 0.5 }}>{def.short} (hidden)</span><LegBtns inst={inst} p={p} onInfo={() => setInfo(info === inst.uid ? null : inst.uid)} /></div>)}</div>}
      {(() => { const c = info ? comp.find((x) => x.inst.uid === info) : null; if (!c) return null; const g = GUIDE[c.def.id]; const r = interpret(c.def, c.vals, data[data.length - 1]?.close ?? null); return (
        <div className={`term-explain ${r.tone === "bull" ? "bull" : r.tone === "bear" ? "bear" : ""}`} onPointerDown={(e) => e.stopPropagation()}>
          <div className="row between" style={{ flexWrap: "nowrap", gap: 8 }}><strong style={{ flex: 1, minWidth: 0 }}>{c.def.name}</strong><button className="btn ghost sm" style={{ flex: "none" }} onClick={() => setInfo(null)} aria-label="Close">✕</button></div>
          <div className="term-explain-now">{r.text}</div>
          {g && <div className="tiny"><span className="up">Buy:</span> {g.buy}<br /><span className="down">Sell:</span> {g.sell}<br /><span className="faint">Trap:</span> {g.trap}</div>}
          <Link className="btn sm" to={`/indicators?id=${c.def.id}`}>Full guide</Link>
        </div>
      ); })()}
      {p.onFull && <button className="term-full-btn" onClick={(e) => { e.stopPropagation(); p.onFull!(); }} title={p.full ? "Exit full screen" : "Full screen"} aria-label={p.full ? "Exit full screen" : "Full screen"}>{p.full ? "✕" : "⛶"}</button>}
      <div className="term-scale">
        <button className={p.scaleMode === 2 ? "on" : ""} onClick={() => p.onScaleMode(p.scaleMode === 2 ? 0 : 2)} title="Percentage scale">%</button>
        <button className={p.scaleMode === 1 ? "on" : ""} onClick={() => p.onScaleMode(p.scaleMode === 1 ? 0 : 1)} title="Logarithmic scale">log</button>
        <button onClick={() => { chartRef.current?.priceScale("right").applyOptions({ autoScale: true }); }} title="Auto-fit the price scale">auto</button>
      </div>
    </div>
  );
}

function LegBtns({ inst, p, onInfo }: { inst: IndInst; p: PaneProps; onInfo: () => void }) {
  return (
    <span className="leg-btns">
      <button title="What does it say now?" onClick={(e) => { e.stopPropagation(); onInfo(); }}>?</button>
      <button title={inst.hidden ? "Show" : "Hide"} onClick={(e) => { e.stopPropagation(); p.onToggleIndicator(inst.uid); }}>{inst.hidden ? "◌" : "◉"}</button>
      <button title="Settings" onClick={(e) => { e.stopPropagation(); p.onEditIndicator(inst.uid); }}>⚙</button>
      <button title="Remove" onClick={(e) => { e.stopPropagation(); p.onRemoveIndicator(inst.uid); }}>✕</button>
    </span>
  );
}
