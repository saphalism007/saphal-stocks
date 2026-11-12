// Chart zoom speed, chosen by the user and kept on this device. Shared by every chart pane.
export type ZoomSpeed = "slow" | "normal" | "fast" | "turbo";
export const ZOOM_SPEEDS: { key: ZoomSpeed; label: string; factor: number }[] = [
  { key: "slow", label: "Slow", factor: 0.5 },
  { key: "normal", label: "Normal", factor: 1 },
  { key: "fast", label: "Fast", factor: 2 },
  { key: "turbo", label: "Very fast", factor: 3.5 },
];
const KEY = "ss-zoom-speed";
let current: ZoomSpeed = (() => { try { const v = localStorage.getItem(KEY) as ZoomSpeed | null; return v && ZOOM_SPEEDS.some((s) => s.key === v) ? v : "normal"; } catch { return "normal"; } })();
const subs = new Set<(s: ZoomSpeed) => void>();
export const zoomSpeed = () => current;
export const zoomFactor = () => ZOOM_SPEEDS.find((s) => s.key === current)?.factor ?? 1;
export function setZoomSpeed(s: ZoomSpeed) { current = s; try { localStorage.setItem(KEY, s); } catch { /* ignore */ } subs.forEach((f) => f(s)); }
export function onZoomSpeed(f: (s: ZoomSpeed) => void) { subs.add(f); return () => { subs.delete(f); }; }

/** Next visible range after zooming by `factor` (<1 = in) around a point at fraction `frac` (0 left, 1 right) of the view. */
export function zoomRange(r: { from: number; to: number }, factor: number, frac: number, bars: number, minBars = 6) {
  const width = r.to - r.from;
  const nW = Math.min(Math.max(width * factor, minBars), Math.max(30, bars * 1.3));
  const anchor = r.from + frac * width;
  return clampRange(anchor - frac * nW, nW, bars);
}

/** Keeps the view sensible while allowing room for the future (projections): the latest candle always stays on
 *  screen, there is no blank space before the first candle, and a view wider than all history shows it all with
 *  the newest candle at the right. */
export function clampRange(from: number, width: number, bars: number, margin = 4) {
  if (bars <= 0) return { from, to: from + width };
  const last = bars - 1;
  if (width >= bars + 2 * margin) { const to = Math.max(last + margin, Math.min(from + width, last + width * 0.5)); return { from: to - width, to }; }
  let f = from;
  if (f > last - 1) f = last - 1;             // keep at least the latest candle in view (future space allowed)
  if (f < -margin) f = -margin;               // no blank space before the first candle
  return { from: f, to: f + width };
}
