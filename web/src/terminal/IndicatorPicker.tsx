// Indicator library: search and add any of the indicators, edit an indicator's parameters and
// colours, reorder or remove them, and save / load indicator templates (kept on this device).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Modal, NumInput } from "../components/ui.tsx";
import { INDICATORS, INDICATOR_MAP, type Group } from "../../../shared/ta.ts";
import type { IndInst } from "./ChartPane.tsx";
import IndicatorInfo, { SortSelect, loadSort, saveSort, sortIndicators, type IndSort } from "../components/IndicatorInfo.tsx";

const TKEY = "ss-ind-templates";
export const BUILTIN_TEMPLATES: { name: string; list: { id: string; params?: Record<string, number> }[] }[] = [
  { name: "Trend follower", list: [{ id: "ribbon" }, { id: "supertrend" }, { id: "adx" }] },
  { name: "Swing trader", list: [{ id: "ema", params: { length: 20 } }, { id: "sma", params: { length: 50 } }, { id: "bb" }, { id: "rsi" }, { id: "macd" }] },
  { name: "Momentum", list: [{ id: "ema", params: { length: 9 } }, { id: "ema", params: { length: 21 } }, { id: "stochrsi" }, { id: "macd" }] },
  { name: "Volume & money flow", list: [{ id: "vwap" }, { id: "obv" }, { id: "mfi" }, { id: "cmf" }] },
  { name: "Ichimoku", list: [{ id: "ichimoku" }, { id: "rsi" }] },
  { name: "Volatility squeeze", list: [{ id: "bb" }, { id: "kc" }, { id: "bbw" }, { id: "atr" }] },
];
const newInst = (id: string, params: Record<string, number> = {}): IndInst => ({ uid: Math.random().toString(36).slice(2), id, params, colors: {} });
export const instFrom = newInst;

export default function IndicatorPicker({ list, onChange, onClose, editUid }: { list: IndInst[]; onChange: (l: IndInst[]) => void; onClose: () => void; editUid: string | null }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<Group | "All" | "Added" | "Templates">(editUid ? "Added" : "All");
  const [edit, setEdit] = useState<string | null>(editUid);
  const [tname, setTname] = useState("");
  const [saved, setSaved] = useState<{ name: string; list: IndInst[] }[]>(() => { try { return JSON.parse(localStorage.getItem(TKEY) || "[]"); } catch { return []; } });
  const persist = (x: typeof saved) => { setSaved(x); try { localStorage.setItem(TKEY, JSON.stringify(x)); } catch { /* ignore */ } };
  const [sort, setSortS] = useState<IndSort>(() => loadSort("ss-ind-sort"));
  const setSort = (v: IndSort) => { setSortS(v); saveSort("ss-ind-sort", v); };
  const [info, setInfo] = useState<string | null>(null);
  const found = useMemo(() => { const s = q.trim().toLowerCase(); return sortIndicators(INDICATORS.filter((d) => (group === "All" || d.group === group) && (!s || `${d.name} ${d.short} ${d.desc}`.toLowerCase().includes(s))), sort); }, [q, group, sort]);
  const inst = list.find((x) => x.uid === edit);
  const def = inst ? INDICATOR_MAP.get(inst.id) : null;
  const upd = (u: IndInst) => onChange(list.map((x) => (x.uid === u.uid ? u : x)));
  const move = (i: number, d: number) => { const l = [...list]; const j = i + d; if (j < 0 || j >= l.length) return; [l[i], l[j]] = [l[j], l[i]]; onChange(l); };
  const groups: (Group | "All" | "Added" | "Templates")[] = ["All", "Added", "Moving averages", "Trend", "Momentum", "Volatility", "Volume", "Templates"];
  return (
    <Modal title="Indicators" onClose={onClose}>
      <div className="ind-picker">
        <input className="input" autoFocus placeholder={`Search ${INDICATORS.length} indicators (e.g. RSI, Ichimoku, money flow)`} value={q} onChange={(e) => { setQ(e.target.value); if (group === "Added" || group === "Templates") setGroup("All"); }} />
        {group !== "Added" && group !== "Templates" && <SortSelect value={sort} onChange={setSort} />}
        <div className="chips">{groups.map((g) => <button key={g} className={`chip ${group === g ? "on" : ""}`} onClick={() => setGroup(g)}>{g}{g === "Added" ? ` (${list.length})` : ""}</button>)}</div>
        {group === "Added" ? (
          <div className="ind-list">
            {list.length === 0 && <p className="small muted">No indicators on this chart yet.</p>}
            {list.map((x, i) => { const d = INDICATOR_MAP.get(x.id); if (!d) return null; return (
              <div key={x.uid} className={`ind-item ${edit === x.uid ? "on" : ""}`}>
                <button className="ind-name" onClick={() => setEdit(edit === x.uid ? null : x.uid)}><strong>{d.name}</strong><span className="tiny faint">{d.overlay ? "on price" : "own panel"}{d.params.length ? `, ${d.params.map((p) => x.params[p.key] ?? p.def).join(", ")}` : ""}{x.hidden ? ", hidden" : ""}</span></button>
                <span className="row" style={{ gap: 2 }}><button className="btn ghost sm" onClick={() => move(i, -1)} title="Move up">↑</button><button className="btn ghost sm" onClick={() => move(i, 1)} title="Move down">↓</button><button className="btn ghost sm" onClick={() => upd({ ...x, hidden: !x.hidden })}>{x.hidden ? "Show" : "Hide"}</button><button className="btn ghost sm" onClick={() => onChange(list.filter((y) => y.uid !== x.uid))}>Remove</button></span>
                {edit === x.uid && inst && def && (
                  <div className="ind-edit">
                    <p className="tiny muted" style={{ margin: 0 }}>{def.desc}</p>
                    <div className="form-grid tight">
                      {def.params.map((p) => <label key={p.key} className="field">{p.label}<NumInput value={inst.params[p.key] ?? p.def} min={p.min} max={p.max} step={p.step} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && v > 0) upd({ ...inst, params: { ...inst.params, [p.key]: Math.min(p.max ?? 1e6, v) } }); }} /></label>)}
                      {def.outputs.map((o) => <label key={o.key} className="field">{o.label} colour<input type="color" className="input" value={inst.colors[o.key] || o.color} onChange={(e) => upd({ ...inst, colors: { ...inst.colors, [o.key]: e.target.value } })} /></label>)}
                    </div>
                    <span className="row" style={{ gap: 6 }}><button className="btn sm ghost" onClick={() => upd({ ...inst, params: {}, colors: {} })}>Reset to defaults</button><Link className="btn sm ghost" to={`/indicators?id=${def.id}`}>How to use {def.short}</Link></span>
                  </div>
                )}
              </div>
            ); })}
            {list.length > 0 && <button className="btn sm ghost" onClick={() => onChange([])}>Remove all indicators</button>}
          </div>
        ) : group === "Templates" ? (
          <div className="col" style={{ gap: 8 }}>
            <div className="row"><input className="input" style={{ flex: 1 }} placeholder="Template name" value={tname} onChange={(e) => setTname(e.target.value)} /><button className="btn primary" disabled={!tname.trim() || !list.length} onClick={() => { persist([{ name: tname.trim(), list }, ...saved.filter((s) => s.name !== tname.trim())]); setTname(""); }}>Save current ({list.length})</button></div>
            {saved.map((s) => <div key={s.name} className="row between ind-item"><span><strong>{s.name}</strong> <span className="tiny faint">{s.list.map((x) => INDICATOR_MAP.get(x.id)?.short).join(", ")}</span></span><span className="row"><button className="btn sm" onClick={() => { onChange(s.list.map((x) => ({ ...x, uid: Math.random().toString(36).slice(2) }))); onClose(); }}>Apply</button><button className="btn sm ghost" onClick={() => persist(saved.filter((x) => x.name !== s.name))}>Delete</button></span></div>)}
            <div className="tiny faint" style={{ marginTop: 6 }}>Ready-made</div>
            {BUILTIN_TEMPLATES.map((s) => <div key={s.name} className="row between ind-item"><span><strong>{s.name}</strong> <span className="tiny faint">{s.list.map((x) => INDICATOR_MAP.get(x.id)?.short).join(", ")}</span></span><button className="btn sm" onClick={() => { onChange(s.list.map((x) => newInst(x.id, x.params))); onClose(); }}>Apply</button></div>)}
          </div>
        ) : (
          <div className="ind-list">
            {found.map((d) => { const mine = list.filter((x) => x.id === d.id); const n = mine.length; const open = info === d.id; return (
              <div key={d.id} className={`ind-item lib ${n ? "added" : ""} ${open ? "on" : ""}`}>
                <button className="ind-name" onClick={() => setInfo(open ? null : d.id)} aria-expanded={open} title="Show how to use it">
                  <span><strong>{d.name}</strong> <span className="tiny faint">{d.short}, {d.group}, {d.overlay ? "on price" : "own panel"}</span></span>
                  <span className="tiny muted">{d.desc}</span>
                  <span className="tiny ind-more">{open ? "Hide guide ▴" : "How to use it ▾"}</span>
                </button>
                <span className="ind-acts">
                  {n === 0 ? <button className="btn sm primary" onClick={() => onChange([...list, newInst(d.id)])}>Add</button> : <>
                    <span className="tiny up">On chart{n > 1 ? ` (${n})` : ""} ✓</span>
                    <button className="btn sm" onClick={() => onChange(list.filter((x) => x.id !== d.id))}>Remove</button>
                    <button className="btn sm ghost" title="Add another copy, for example with a different length" onClick={() => onChange([...list, newInst(d.id)])}>+ Another</button>
                  </>}
                </span>
                {open && <div className="ind-guide"><IndicatorInfo def={d} /><Link className="btn sm ghost" to={`/indicators?id=${d.id}`}>Open with live reading</Link></div>}
              </div>
            ); })}
            {found.length === 0 && <p className="small muted">No indicator matches '{q}'.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
