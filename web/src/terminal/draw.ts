// Drawing tools for the chart terminal: tool catalogue, stored shape format and the geometry that
// turns each drawing into SVG paths, labels and edit handles. Points are stored as (date, price)
// so drawings survive changes of timeframe, zoom and chart type; dates beyond the last bar are
// allowed (projections into the future).

export type ToolId =
  | "cursor" | "trend" | "ray" | "info" | "extended" | "angle" | "hline" | "hray" | "vline" | "crossline"
  | "channel" | "regression" | "pitchfork" | "fib" | "fibext" | "rect" | "ellipse" | "triangle" | "arrow"
  | "brush" | "highlighter" | "text" | "callout" | "arrowup" | "arrowdown" | "pricerange" | "daterange" | "measure" | "long" | "short";

export interface Pt { t: string; p: number }
export interface Drawing { id: string; tool: ToolId; pts: Pt[]; color: string; width: number; dash: boolean; text?: string; locked?: boolean; hidden?: boolean; target?: number }

export interface ToolDef { id: ToolId; label: string; points: number; key?: string; hint: string }
export const TOOL_GROUPS: { key: string; label: string; icon: string; tools: ToolDef[] }[] = [
  { key: "lines", label: "Lines", icon: "trend", tools: [
    { id: "trend", label: "Trendline", points: 2, key: "t", hint: "Drag from the first point to the second (or tap twice)." },
    { id: "ray", label: "Ray", points: 2, hint: "Starts at the first point and extends past the second." },
    { id: "info", label: "Info line", points: 2, hint: "Trendline showing price change, % and bars." },
    { id: "extended", label: "Extended line", points: 2, hint: "Extends both ways through two points." },
    { id: "angle", label: "Trend angle", points: 2, hint: "Trendline with its angle on screen." },
    { id: "hline", label: "Horizontal line", points: 1, key: "h", hint: "Tap a price level." },
    { id: "hray", label: "Horizontal ray", points: 1, key: "j", hint: "Level that starts at the tapped date." },
    { id: "vline", label: "Vertical line", points: 1, key: "v", hint: "Tap a date." },
    { id: "crossline", label: "Crossline", points: 1, key: "c", hint: "Horizontal and vertical line through a point." },
  ] },
  { key: "channels", label: "Channels & forks", icon: "channel", tools: [
    { id: "channel", label: "Parallel channel", points: 3, hint: "Draw the first line, then tap to set the channel width." },
    { id: "regression", label: "Regression trend", points: 2, hint: "Least-squares line ±2 standard deviations between two dates." },
    { id: "pitchfork", label: "Pitchfork", points: 3, hint: "Tap the pivot, then the swing high and swing low." },
  ] },
  { key: "fib", label: "Fibonacci", icon: "fib", tools: [
    { id: "fib", label: "Fib retracement", points: 2, key: "f", hint: "Drag from the swing start to the swing end." },
    { id: "fibext", label: "Trend-based fib extension", points: 3, hint: "Tap the move's start, end, then the pullback low/high." },
  ] },
  { key: "shapes", label: "Shapes & brush", icon: "rect", tools: [
    { id: "rect", label: "Rectangle", points: 2, key: "r", hint: "Drag a box (zones, ranges)." },
    { id: "ellipse", label: "Ellipse", points: 2, hint: "Drag to draw." },
    { id: "triangle", label: "Triangle", points: 3, hint: "Tap three corners." },
    { id: "arrow", label: "Arrow", points: 2, hint: "Drag to draw an arrow." },
    { id: "brush", label: "Brush", points: 0, key: "b", hint: "Draw freehand." },
    { id: "highlighter", label: "Highlighter", points: 0, hint: "Wide translucent freehand stroke." },
  ] },
  { key: "text", label: "Text & markers", icon: "text", tools: [
    { id: "text", label: "Text", points: 1, hint: "Tap where the note goes, then type." },
    { id: "callout", label: "Callout", points: 2, hint: "Tap the point, then where the label goes." },
    { id: "arrowup", label: "Arrow up (buy mark)", points: 1, hint: "Mark a buy point." },
    { id: "arrowdown", label: "Arrow down (sell mark)", points: 1, hint: "Mark a sell point." },
  ] },
  { key: "measure", label: "Measure & positions", icon: "ruler", tools: [
    { id: "measure", label: "Date & price range", points: 2, key: "m", hint: "Drag to measure the change, % and sessions." },
    { id: "pricerange", label: "Price range", points: 2, hint: "Drag vertically to measure a price move." },
    { id: "daterange", label: "Date range", points: 2, hint: "Drag horizontally to count sessions." },
    { id: "long", label: "Long position", points: 2, hint: "Tap the entry, then the stop-loss (target starts at 2R; drag to adjust)." },
    { id: "short", label: "Short / exit position", points: 2, hint: "Tap the entry, then the stop above (NEPSE has no short selling: use it to plan exits)." },
  ] },
];
export const TOOLS = new Map(TOOL_GROUPS.flatMap((g) => g.tools).map((t) => [t.id, t]));
export const COLORS = ["#2962ff", "#f59e0b", "#22c55e", "#ef4444", "#a855f7", "#06b6d4", "#ec4899", "#94a3b8", "#ffffff", "#111827"];
export const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
export const FIBEXT = [0, 0.382, 0.618, 1, 1.272, 1.618, 2, 2.618];

export interface Mapper {
  x: (t: string) => number | null; y: (p: number) => number | null; w: number; h: number;
  idx: (t: string) => number; closesBetween: (a: string, b: string) => { i: number; c: number }[]; fmt: (p: number) => string;
}
export interface Geo { paths: { d: string; dash?: boolean; fill?: string; stroke?: string; width?: number; opacity?: number }[]; labels: { x: number; y: number; text: string; anchor?: "start" | "middle" | "end"; color?: string; bg?: string; size?: number }[]; handles: { x: number; y: number; i: number }[] }

const L = (a: [number, number], b: [number, number]) => `M${a[0]},${a[1]}L${b[0]},${b[1]}`;
/** Points where the infinite line through a>b crosses the left/right edges (or top/bottom for verticals). */
function extend(a: [number, number], b: [number, number], w: number, h: number, both: boolean): [number, number][] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (Math.abs(dx) < 1e-6) return [both ? [a[0], 0] : a, [a[0], dy >= 0 ? h : 0]];
  const yAt = (x: number) => a[1] + (dy / dx) * (x - a[0]);
  const end: [number, number] = dx > 0 ? [w, yAt(w)] : [0, yAt(0)];
  const start: [number, number] = both ? (dx > 0 ? [0, yAt(0)] : [w, yAt(w)]) : a;
  return [start, end];
}
const pctTxt = (a: number, b: number) => `${b - a >= 0 ? "+" : ""}${(((b - a) / a) * 100).toFixed(2)}%`;

export function geometry(d: Drawing, m: Mapper): Geo | null {
  const P = d.pts.map((q) => { const x = m.x(q.t), y = m.y(q.p); return x == null || y == null ? null : ([x, y] as [number, number]); });
  if (P.some((q) => q == null)) return null;
  const p = P as [number, number][];
  const g: Geo = { paths: [], labels: [], handles: p.map((q, i) => ({ x: q[0], y: q[1], i })) };
  const line = (a: [number, number], b: [number, number], dash = d.dash) => g.paths.push({ d: L(a, b), dash });
  const [A, B, C] = p;
  switch (d.tool) {
    case "trend": case "info": case "angle": case "arrow":
      if (!B) { g.handles = [{ x: A[0], y: A[1], i: 0 }]; break; }
      line(A, B);
      if (d.tool === "arrow") { const ang = Math.atan2(B[1] - A[1], B[0] - A[0]), s = 10 + d.width * 2; g.paths.push({ d: `M${B[0]},${B[1]}L${B[0] - s * Math.cos(ang - 0.45)},${B[1] - s * Math.sin(ang - 0.45)}L${B[0] - s * Math.cos(ang + 0.45)},${B[1] - s * Math.sin(ang + 0.45)}Z`, fill: d.color }); }
      if (d.tool === "info") { const a = d.pts[0], b = d.pts[1], n = m.idx(b.t) - m.idx(a.t); g.labels.push({ x: B[0] + 6, y: B[1], text: `${m.fmt(b.p - a.p)} (${pctTxt(a.p, b.p)}), ${Math.round(n)} bars`, bg: "panel" }); }
      if (d.tool === "angle") { const deg = (-Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI; g.paths.push({ d: L(A, [A[0] + 40, A[1]]), dash: true, width: 1 }); g.labels.push({ x: A[0] + 44, y: A[1] - 4, text: `${deg.toFixed(1)}°` }); }
      break;
    case "ray": case "extended": if (!B) break; { const [s, e] = extend(A, B, m.w, m.h, d.tool === "extended"); line(s, e); } break;
    case "hline": line([0, A[1]], [m.w, A[1]]); g.labels.push({ x: m.w - 4, y: A[1] - 4, text: m.fmt(d.pts[0].p), anchor: "end" }); g.handles = [{ x: Math.min(m.w - 30, Math.max(30, A[0])), y: A[1], i: 0 }]; break;
    case "hray": line(A, [m.w, A[1]]); g.labels.push({ x: m.w - 4, y: A[1] - 4, text: m.fmt(d.pts[0].p), anchor: "end" }); break;
    case "vline": line([A[0], 0], [A[0], m.h]); g.labels.push({ x: A[0] + 4, y: 14, text: d.pts[0].t }); g.handles = [{ x: A[0], y: Math.max(30, Math.min(m.h - 30, A[1])), i: 0 }]; break;
    case "crossline": line([0, A[1]], [m.w, A[1]]); line([A[0], 0], [A[0], m.h]); break;
    case "channel": {
      if (!B) break;
      line(A, B);
      if (C) {
        const t = (C[0] - A[0]) / ((B[0] - A[0]) || 1), yOnAB = A[1] + t * (B[1] - A[1]), off = C[1] - yOnAB;
        const A2: [number, number] = [A[0], A[1] + off], B2: [number, number] = [B[0], B[1] + off];
        line(A2, B2);
        g.paths.push({ d: `M${A[0]},${A[1] + off / 2}L${B[0]},${B[1] + off / 2}`, dash: true, width: 1 });
        g.paths.push({ d: `M${A[0]},${A[1]}L${B[0]},${B[1]}L${B2[0]},${B2[1]}L${A2[0]},${A2[1]}Z`, fill: d.color, opacity: 0.08 });
      }
      break;
    }
    case "regression": {
      if (!B) break;
      const pts = m.closesBetween(d.pts[0].t, d.pts[1].t);
      if (pts.length < 3) { line(A, B, true); break; }
      const n = pts.length, mx = pts.reduce((s, q) => s + q.i, 0) / n, my = pts.reduce((s, q) => s + q.c, 0) / n;
      let num = 0, den = 0; for (const q of pts) { num += (q.i - mx) * (q.c - my); den += (q.i - mx) ** 2; }
      const slope = den ? num / den : 0, at = (i: number) => my + slope * (i - mx);
      const sd = Math.sqrt(pts.reduce((s, q) => s + (q.c - at(q.i)) ** 2, 0) / n);
      const i0 = pts[0].i, i1 = pts[n - 1].i, x0 = A[0], x1 = B[0];
      for (const k of [0, 2, -2]) { const y0 = m.y(at(i0) + k * sd), y1 = m.y(at(i1) + k * sd); if (y0 != null && y1 != null) g.paths.push({ d: L([x0, y0], [x1, y1]), dash: k !== 0 }); }
      g.labels.push({ x: x1 + 4, y: B[1], text: `slope ${m.fmt(slope)}/bar, σ ${m.fmt(sd)}` });
      break;
    }
    case "pitchfork": {
      if (!C) { if (B) line(A, B, true); break; }
      const M: [number, number] = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2];
      const [, e] = extend(A, M, m.w, m.h, false); line(A, e);
      const dx = e[0] - A[0], dy = e[1] - A[1];
      line(B, [B[0] + dx, B[1] + dy]); line(C, [C[0] + dx, C[1] + dy]); line(B, C, true);
      break;
    }
    case "fib": case "fibext": {
      const levels = d.tool === "fib" ? FIB : FIBEXT;
      if (d.tool === "fib" ? !B : !C) { if (B) line(A, B, true); break; }
      const a = d.pts[0].p, b = d.pts[1].p, base = d.tool === "fib" ? b : d.pts[2].p, span = d.tool === "fib" ? a - b : b - a;
      const x0 = Math.min(A[0], B[0], C?.[0] ?? Infinity);
      line(A, B, true); if (C) line(B, C, true);
      for (const r of levels) {
        const price = base + span * r, y = m.y(price); if (y == null) continue;
        g.paths.push({ d: L([x0, y], [m.w, y]), stroke: r === 0.618 || r === 0.5 ? undefined : undefined, width: r === 0.618 ? d.width + 0.5 : 1 });
        g.labels.push({ x: x0 + 4, y: y - 3, text: `${r} (${m.fmt(price)})` });
      }
      const y0 = m.y(base), y1 = m.y(base + span * 0.618); if (y0 != null && y1 != null) g.paths.push({ d: `M${x0},${y0}L${m.w},${y0}L${m.w},${y1}L${x0},${y1}Z`, fill: d.color, opacity: 0.06 });
      break;
    }
    case "rect": case "pricerange": case "daterange": case "measure": {
      if (!B) break;
      const x = Math.min(A[0], B[0]), y = Math.min(A[1], B[1]), w = Math.abs(B[0] - A[0]), h = Math.abs(B[1] - A[1]);
      const box = `M${x},${y}h${w}v${h}h${-w}Z`;
      if (d.tool === "rect") { g.paths.push({ d: box, fill: d.color, opacity: 0.12 }); g.paths.push({ d: box }); g.handles.push({ x: A[0], y: B[1], i: 10 }, { x: B[0], y: A[1], i: 11 }); break; }
      const a = d.pts[0], b = d.pts[1], up = b.p >= a.p, col = up ? "#22c55e" : "#ef4444";
      const bars = Math.round(m.idx(b.t) - m.idx(a.t)), days = Math.round((Date.parse(b.t) - Date.parse(a.t)) / 86_400_000);
      if (d.tool === "pricerange") { g.paths.push({ d: box, fill: col, opacity: 0.12, stroke: "none" }); g.paths.push({ d: L([(A[0] + B[0]) / 2, A[1]], [(A[0] + B[0]) / 2, B[1]]), stroke: col }); g.labels.push({ x: (A[0] + B[0]) / 2, y: up ? y - 6 : y + h + 14, text: `${m.fmt(b.p - a.p)} (${pctTxt(a.p, b.p)})`, anchor: "middle", bg: col }); }
      else if (d.tool === "daterange") { g.paths.push({ d: box, fill: "#2962ff", opacity: 0.1, stroke: "none" }); g.paths.push({ d: L([A[0], (A[1] + B[1]) / 2], [B[0], (A[1] + B[1]) / 2]), stroke: "#2962ff" }); g.labels.push({ x: (A[0] + B[0]) / 2, y: y + h + 14, text: `${bars} bars, ${days} days`, anchor: "middle", bg: "#2962ff" }); }
      else { g.paths.push({ d: box, fill: col, opacity: 0.12, stroke: "none" }); g.paths.push({ d: L(A, B), stroke: col, dash: true }); g.labels.push({ x: (A[0] + B[0]) / 2, y: up ? y - 6 : y + h + 14, text: `${m.fmt(b.p - a.p)} (${pctTxt(a.p, b.p)}), ${bars} bars, ${days}d`, anchor: "middle", bg: col }); }
      break;
    }
    case "ellipse": if (!B) break; { const cx = (A[0] + B[0]) / 2, cy = (A[1] + B[1]) / 2, rx = Math.abs(B[0] - A[0]) / 2, ry = Math.abs(B[1] - A[1]) / 2; const e = `M${cx - rx},${cy}a${rx},${ry} 0 1,0 ${2 * rx},0a${rx},${ry} 0 1,0 ${-2 * rx},0`; g.paths.push({ d: e, fill: d.color, opacity: 0.1 }); g.paths.push({ d: e }); } break;
    case "triangle": { const pts = p.map((q) => `${q[0]},${q[1]}`).join("L"); g.paths.push({ d: `M${pts}${p.length === 3 ? "Z" : ""}`, fill: p.length === 3 ? d.color : undefined, opacity: 0.1 }); g.paths.push({ d: `M${pts}${p.length === 3 ? "Z" : ""}` }); } break;
    case "brush": case "highlighter": g.paths.push({ d: "M" + p.map((q) => `${q[0]},${q[1]}`).join("L"), width: d.tool === "highlighter" ? Math.max(10, d.width * 6) : d.width, opacity: d.tool === "highlighter" ? 0.35 : 1 }); g.handles = []; break;
    case "text": g.labels.push({ x: A[0], y: A[1], text: d.text || "Text", size: 11 + d.width * 2, color: d.color }); break;
    case "callout": if (!B) break; line(A, B); g.labels.push({ x: B[0], y: B[1], text: d.text || "Note", bg: d.color, anchor: "middle", size: 12 }); break;
    case "arrowup": case "arrowdown": { const up = d.tool === "arrowup", s = 8 + d.width * 2, y = A[1] + (up ? 6 : -6); g.paths.push({ d: up ? `M${A[0]},${y}l${s},${s * 1.6}h${-2 * s}Z` : `M${A[0]},${y}l${s},${-s * 1.6}h${-2 * s}Z`, fill: up ? "#22c55e" : "#ef4444", stroke: "none" }); if (d.text) g.labels.push({ x: A[0], y: up ? y + s * 1.6 + 14 : y - s * 1.6 - 6, text: d.text, anchor: "middle" }); break; }
    case "long": case "short": {
      if (!B) break;
      const entry = d.pts[0].p, stop = d.pts[1].p, risk = Math.abs(entry - stop);
      const target = d.target ?? (d.tool === "long" ? entry + 2 * risk : entry - 2 * risk);
      const yT = m.y(target); if (yT == null) break;
      const x0 = A[0], x1 = Math.max(B[0], A[0] + 30);
      g.paths.push({ d: `M${x0},${A[1]}H${x1}V${yT}H${x0}Z`, fill: "#22c55e", opacity: 0.18, stroke: "none" });
      g.paths.push({ d: `M${x0},${A[1]}H${x1}V${B[1]}H${x0}Z`, fill: "#ef4444", opacity: 0.18, stroke: "none" });
      g.paths.push({ d: `M${x0},${A[1]}H${x1}`, stroke: "#94a3b8" });
      const rr = risk ? Math.abs(target - entry) / risk : 0;
      g.labels.push({ x: x0 + 4, y: yT + (target > entry ? -4 : 12), text: `Target ${m.fmt(target)} (${pctTxt(entry, target)}), R:R ${rr.toFixed(2)}`, bg: "#22c55e" });
      g.labels.push({ x: x0 + 4, y: B[1] + (stop < entry ? 12 : -4), text: `Stop ${m.fmt(stop)} (${pctTxt(entry, stop)})`, bg: "#ef4444" });
      g.labels.push({ x: x0 + 4, y: A[1] - 4, text: `Entry ${m.fmt(entry)}` });
      g.handles = [{ x: x0, y: A[1], i: 0 }, { x: x1, y: B[1], i: 1 }, { x: x0 + (x1 - x0) / 2, y: yT, i: 20 }];
      break;
    }
    default: if (B) line(A, B);
  }
  return g;
}

/** Old terminal format (trend / hline / fib with a, b) > new drawings. */
export function migrate(old: { id: string; kind: string; a: { time: string; price: number }; b?: { time: string; price: number } }[]): Drawing[] {
  return old.map((o) => ({ id: o.id, tool: (o.kind === "trend" ? "trend" : o.kind === "hline" ? "hline" : "fib") as ToolId, pts: [o.a, ...(o.b ? [o.b] : [])].map((x) => ({ t: x.time, p: x.price })), color: o.kind === "fib" ? "#eab308" : "#2962ff", width: 2, dash: false }));
}
