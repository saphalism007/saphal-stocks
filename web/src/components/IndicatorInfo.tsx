// The full guide for one indicator (how to read, buy, sell, best use, trap, tip, settings, origin),
// shared by the chart's indicator list and the Indicator Guide page so both read the same.
import type { IndicatorDef } from "../../../shared/ta.ts";
import { GUIDE } from "../../../shared/indicatorGuide.ts";

export type IndSort = "default" | "az" | "za" | "group";
export const IND_SORTS: { key: IndSort; label: string }[] = [{ key: "default", label: "Recommended order" }, { key: "az", label: "Name A to Z" }, { key: "za", label: "Name Z to A" }, { key: "group", label: "By type" }];
const GROUP_ORDER = ["Moving averages", "Trend", "Momentum", "Volatility", "Volume"];
export function sortIndicators<T extends IndicatorDef>(list: T[], sort: IndSort): T[] {
  if (sort === "default") return list;
  const l = [...list];
  if (sort === "az") l.sort((a, b) => a.name.localeCompare(b.name));
  else if (sort === "za") l.sort((a, b) => b.name.localeCompare(a.name));
  else l.sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group) || a.name.localeCompare(b.name));
  return l;
}
export function loadSort(key: string): IndSort { try { const v = localStorage.getItem(key) as IndSort | null; return v && IND_SORTS.some((s) => s.key === v) ? v : "default"; } catch { return "default"; } }
export function saveSort(key: string, v: IndSort) { try { localStorage.setItem(key, v); } catch { /* ignore */ } }

export function SortSelect({ value, onChange }: { value: IndSort; onChange: (v: IndSort) => void }) {
  return (
    <label className="ind-sort small muted">Sort
      <select className="input" value={value} onChange={(e) => onChange(e.target.value as IndSort)}>{IND_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
    </label>
  );
}

export default function IndicatorInfo({ def }: { def: IndicatorDef }) {
  const g = GUIDE[def.id];
  if (!g) return <p className="small muted">{def.desc}</p>;
  return (
    <dl className="ig-dl">
      <dt>What it shows</dt><dd>{g.what}</dd>
      <dt>How to read</dt><dd>{g.read}</dd>
      <dt className="up">Buy signal</dt><dd>{g.buy}</dd>
      <dt className="down">Sell signal</dt><dd>{g.sell}</dd>
      <dt>Works best for</dt><dd>{g.best}</dd>
      <dt className="warn-t">Common trap</dt><dd>{g.trap}</dd>
      <dt>Tip</dt><dd>{g.tip}</dd>
      {def.params.length > 0 && <><dt>Default settings</dt><dd>{def.params.map((p) => `${p.label} ${p.def}`).join(", ")}</dd></>}
      <dt>Shown</dt><dd>{def.overlay ? "On the price chart" : "In its own panel under the chart"}</dd>
      <dt>Origin</dt><dd>{g.origin}</dd>
    </dl>
  );
}
