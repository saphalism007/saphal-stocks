// Chart Terminal: professional charting on real NEPSE daily data — chart types, daily / weekly /
// monthly candles, 60+ indicators in overlays or panels, 30 drawing tools with a left toolbar, 1–4
// chart layouts, saved drawings, indicator templates and layouts, plus the AI Analyst panel
// (verdict, entry/stop/targets with evidence, levels drawn on the chart, chart Q&A, trade planner
// and a pattern scanner). Everything is saved on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { onBackendEvent } from "../lib/backend.ts";
import { num, pct, tone } from "../lib/format.ts";
import ChartPane, { type ChartType, type IndInst, type PaneApi } from "../terminal/ChartPane.tsx";
import AiPanel, { type PanelTab } from "../terminal/AiPanel.tsx";
import IndicatorPicker, { instFrom } from "../terminal/IndicatorPicker.tsx";
import { TOOL_GROUPS, TOOLS, COLORS, migrate, type Drawing, type ToolId } from "../terminal/draw.ts";
import type { ChartAnalysis } from "../../../shared/analyst.ts";
import type { Timeframe } from "../../../shared/timeframe.ts";
import type { Bar } from "../../../shared/types.ts";

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
interface PaneState { symbol: string; tf: Timeframe; type: ChartType; scale: 0 | 1 | 2; indicators: IndInst[] }
interface TermState { layout: "1" | "2h" | "2v" | "4"; panes: PaneState[]; active: number; range: string; from: string | null; to: string | null; panel: boolean; panelTab: PanelTab; ai: boolean; patterns: boolean; volume: boolean; grid: boolean; magnet: boolean; keep: boolean; hide: boolean; clean: boolean; v?: number }
const RANGES: [string, number][] = [["1M", 22], ["3M", 66], ["6M", 130], ["YTD", 0], ["1Y", 250], ["3Y", 750], ["5Y", 1250], ["All", 100000]];
const SKEY = "ss-term-v2";
// A new chart is clean: candles and volume only. Indicators, AI levels and markers appear when you turn them on.
const defPane = (symbol: string): PaneState => ({ symbol, tf: "D", type: "candles", scale: 0, indicators: [] });
const loadState = (sym: string): TermState => {
  const d: TermState = { layout: "1", panes: [defPane(sym)], active: 0, range: "1Y", from: null, to: null, panel: typeof window !== "undefined" && window.innerWidth >= 900, panelTab: "ai", ai: false, patterns: false, volume: true, grid: true, magnet: false, keep: false, hide: false, clean: false, v: 3 };
  try {
    const s = JSON.parse(localStorage.getItem(SKEY) || "null");
    if (s?.panes?.length) {
      // Earlier versions opened with three indicators and the AI levels on; start from a clean chart once.
      if ((s.v ?? 0) < 3) return { ...d, ...s, ai: false, patterns: false, clean: false, v: 3, panes: s.panes.map((x: PaneState) => ({ ...x, indicators: [] })) };
      return { ...d, ...s };
    }
  } catch { /* ignore */ }
  return d;
};

// ---------- bars cache shared by panes and the panel ----------
const barCache = new Map<string, Promise<Bar[]>>();
// New prices (intraday or the next day's data) clear the cache so every open chart redraws in place.
let dataVer = 0;
const verListeners = new Set<(v: number) => void>();
onBackendEvent((e) => { if (e.type === "data-updated") { barCache.clear(); dataVer++; for (const f of verListeners) f(dataVer); } });
function useDataVersion() {
  const [v, setV] = useState(dataVer);
  useEffect(() => { verListeners.add(setV); return () => { verListeners.delete(setV); }; }, []);
  return v;
}
function useBars(symbol: string) {
  const ver = useDataVersion();
  const [state, setState] = useState<{ sym: string; bars: Bar[] | null; error: string | null }>({ sym: symbol, bars: null, error: null });
  useEffect(() => {
    let live = true;
    if (!barCache.has(symbol)) barCache.set(symbol, api<{ bars: Bar[] }>(`/stocks/${symbol}/bars`).then((r) => r.bars).catch((e) => { barCache.delete(symbol); throw e; }));
    setState((s0) => (s0.sym === symbol && s0.bars ? s0 : { sym: symbol, bars: null, error: null })); // keep the old candles on screen while new ones load
    barCache.get(symbol)!.then((b) => live && setState({ sym: symbol, bars: b, error: null })).catch((e) => live && setState({ sym: symbol, bars: [], error: String(e?.message ?? e) }));
    return () => { live = false; };
  }, [symbol, ver]);
  return state.sym === symbol ? state : { sym: symbol, bars: null, error: null };
}

// ---------- drawings per symbol with undo / redo ----------
const dkey = (s: string) => `ss-draw2-${s}`;
const loadDrawings = (s: string): Drawing[] => {
  try { const v = localStorage.getItem(dkey(s)); if (v) return JSON.parse(v); const old = localStorage.getItem(`ss-draw-${s}`); if (old) return migrate(JSON.parse(old)); } catch { /* ignore */ }
  return [];
};
function useDrawingStore() {
  const [map, setMap] = useState<Record<string, Drawing[]>>({});
  const hist = useRef<Record<string, { undo: Drawing[][]; redo: Drawing[][]; base: Drawing[] | null }>>({});
  const get = useCallback((s: string) => map[s] ?? loadDrawings(s), [map]);
  const set = useCallback((s: string, next: Drawing[], commit: boolean) => {
    const h = (hist.current[s] ??= { undo: [], redo: [], base: null });
    setMap((m) => {
      const cur = m[s] ?? loadDrawings(s);
      if (!commit) { if (!h.base) h.base = cur; }
      else { h.undo.push(h.base ?? cur); h.undo = h.undo.slice(-80); h.redo = []; h.base = null; try { localStorage.setItem(dkey(s), JSON.stringify(next)); } catch { /* ignore */ } }
      return { ...m, [s]: next };
    });
  }, []);
  const step = useCallback((s: string, dir: "undo" | "redo") => {
    const h = hist.current[s]; if (!h) return;
    const from = dir === "undo" ? h.undo : h.redo, to = dir === "undo" ? h.redo : h.undo;
    const prev = from.pop(); if (!prev) return;
    setMap((m) => { to.push(m[s] ?? loadDrawings(s)); try { localStorage.setItem(dkey(s), JSON.stringify(prev)); } catch { /* ignore */ } return { ...m, [s]: prev }; });
  }, []);
  return { get, set, step, canUndo: (s: string) => (hist.current[s]?.undo.length ?? 0) > 0, canRedo: (s: string) => (hist.current[s]?.redo.length ?? 0) > 0 };
}

function useThemeKey() {
  const [k, setK] = useState(() => document.documentElement.dataset.theme ?? "");
  useEffect(() => { const o = new MutationObserver(() => setK(document.documentElement.dataset.theme ?? "")); o.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "style", "class"] }); return () => o.disconnect(); }, []);
  return k;
}

export default function Terminal() {
  const { symbol: urlSym } = useParams();
  const nav = useNavigate();
  const [st, setSt] = useState<TermState>(() => loadState((urlSym || localStorage.getItem("ss-terminal-symbol") || "NABIL").toUpperCase()));
  const [tool, setTool] = useState<ToolId>("cursor");
  const [lastInGroup, setLastInGroup] = useState<Record<string, ToolId>>({});
  const [flyout, setFlyout] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ edit: string | null } | null>(null);
  const [full, setFull] = useState(false);
  const [layers, setLayers] = useState(false);
  const [custom, setCustom] = useState(false);
  const apis = useRef<(PaneApi | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  const draw = useDrawingStore();
  const themeKey = useThemeKey();
  const nPanes = st.layout === "1" ? 1 : st.layout === "4" ? 4 : 2;
  const panes = useMemo(() => { const p = [...st.panes]; while (p.length < nPanes) p.push({ ...defPane(p[p.length - 1]?.symbol ?? "NABIL"), indicators: [] }); return p; }, [st.panes, nPanes]);
  const active = Math.min(st.active, nPanes - 1);
  const ap = panes[active];
  const sym = ap.symbol;

  useEffect(() => { try { localStorage.setItem(SKEY, JSON.stringify({ ...st, panes })); localStorage.setItem("ss-terminal-symbol", sym); } catch { /* ignore */ } }, [st, panes, sym]);
  // URL symbol opens in the active pane
  useEffect(() => { if (urlSym && urlSym.toUpperCase() !== sym) setPane(active, { symbol: urlSym.toUpperCase() }); }, [urlSym]); // eslint-disable-line react-hooks/exhaustive-deps
  const setPane = (i: number, patch: Partial<PaneState>) => setSt((s) => { const p = [...panes]; p[i] = { ...p[i], ...patch }; return { ...s, panes: p }; });
  const setSymbol = (s: string) => { setPane(active, { symbol: s.toUpperCase() }); setSelected(null); if (active === 0) nav(`/terminal/${s.toUpperCase()}`, { replace: true }); };

  const dver = useDataVersion();
  const analysis = useApi<ChartAnalysis & { priceInfo: Any }>(`/chart/${sym}/analysis`, [sym, dver]);
  const bars = useBars(sym);
  const wl = useApi<Any[]>("/watchlists");
  const drawings = draw.get(sym);
  const selD = drawings.find((d) => d.id === selected) ?? null;
  const updSel = (patch: Partial<Drawing>) => selD && draw.set(sym, drawings.map((d) => (d.id === selD.id ? { ...d, ...patch } : d)), true);
  const range = RANGES.find((r) => r[0] === st.range) ?? RANGES[4];
  const ytd = useMemo(() => `${new Date().getFullYear()}-01-01`, []);

  // Keyboard shortcuts
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); draw.step(sym, e.shiftKey ? "redo" : "undo"); return; }
      if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); draw.step(sym, "redo"); return; }
      if (e.key === "Escape") { setTool("cursor"); setSelected(null); setFlyout(null); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && selected) { e.preventDefault(); draw.set(sym, drawings.filter((d) => d.id !== selected), true); setSelected(null); return; }
      if (e.altKey && !mod) { const k = e.code.replace("Key", "").toLowerCase(); const tl = [...TOOLS.values()].find((x) => x.key === k); if (tl) { e.preventDefault(); setTool(tl.id); } return; }
      if (!mod && e.key === "i") { e.preventDefault(); setPicker({ edit: null }); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [sym, selected, drawings, draw]);

  // Full screen: the browser's own full screen where it exists (Mac, iPad, Android), otherwise the chart
  // fills the whole window and the app's bars are hidden (iPhone Safari only allows full screen for videos).
  const wasNative = useRef(false);
  useEffect(() => { const h = () => { const on = !!document.fullscreenElement || !!(document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement; if (on) { wasNative.current = true; setFull(true); } else if (wasNative.current) { wasNative.current = false; setFull(false); } }; document.addEventListener("fullscreenchange", h); document.addEventListener("webkitfullscreenchange", h); return () => { document.removeEventListener("fullscreenchange", h); document.removeEventListener("webkitfullscreenchange", h); }; }, []);
  useEffect(() => { document.documentElement.classList.toggle("term-full", full); const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60); return () => { clearTimeout(t); document.documentElement.classList.remove("term-full"); }; }, [full]);
  useEffect(() => { if (!full) return; const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !document.fullscreenElement) setFull(false); }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, [full]);
  const toggleFull = async () => {
    type FsDoc = Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => Promise<void> };
    type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
    const d = document as FsDoc, el = root.current as FsEl | null;
    if (d.fullscreenElement || d.webkitFullscreenElement) { await (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())?.catch?.(() => {}); setFull(false); return; }
    if (full) { setFull(false); return; }
    const req = el?.requestFullscreen?.bind(el) ?? el?.webkitRequestFullscreen?.bind(el);
    setFull(true); // fill the window at once; the browser's own full screen (where allowed) is layered on top
    if (req) { try { await req(); } catch { /* not allowed here: the window fill stays */ } }
  };
  const shot = async () => {
    const cv = await apis.current[active]?.screenshot(); if (!cv) return;
    cv.toBlob(async (b) => {
      if (!b) return;
      const file = new File([b], `${sym}-${new Date().toISOString().slice(0, 10)}.png`, { type: "image/png" });
      const nv = navigator as Navigator & { canShare?: (d: unknown) => boolean };
      if (nv.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: `${sym} chart` }); return; } catch { /* cancelled */ } }
      const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, "image/png");
  };
  const pickTool = (g: string, t: ToolId) => { setTool(t); setLastInGroup((m) => ({ ...m, [g]: t })); setFlyout(null); setSelected(null); };
  const watch: string[] = [...new Set((wl.data ?? []).flatMap((w: Any) => (w.items ?? []).map((i: Any) => i.symbol)))];
  const firstList = (wl.data ?? [])[0];
  const addToWatch = async () => { if (!firstList) return; try { await api(`/watchlists/${firstList.id}/items`, { body: { symbol: sym } }); wl.reload?.(); } catch { /* ignore */ } };
  const a = analysis.data;
  const lastBar = bars.bars?.[bars.bars.length - 1], prevBar = bars.bars?.[bars.bars.length - 2];
  const chg = lastBar && prevBar ? ((lastBar.close - prevBar.close) / prevBar.close) * 100 : null;
  const hint = tool !== "cursor" ? TOOLS.get(tool)?.hint : null;

  return (
    <div ref={root} className={`terminal2 ${full ? "full" : ""} ${st.panel ? "with-panel" : ""}`}>
      {/* top bar */}
      <div className="t-top">
        <SymbolSearch value={sym} onPick={setSymbol} />
        {lastBar && <span className="t-quote"><strong className="mono">{num(lastBar.close)}</strong> <span className={tone(chg)}>{pct(chg)}</span></span>}
        <span className={`t-live ${a?.priceInfo?.kind === "delayed" ? "delayed" : ""}`} title={a?.priceInfo?.note ?? ""}>{a?.priceInfo?.kind === "delayed" ? "Delayed" : "End of day"}{lastBar ? ` · ${lastBar.date}` : ""}</span>
        <div className="t-group">
          {(["1m", "5m", "15m", "30m", "1h"] as const).map((x) => <button key={x} className="t-btn dim" disabled title="NEPSE intraday candles aren't available from free official sources, so these timeframes are not shown rather than invented.">{x}</button>)}
          {(["D", "W", "M"] as Timeframe[]).map((x) => <button key={x} className={`t-btn ${ap.tf === x ? "on" : ""}`} onClick={() => setPane(active, { tf: x })}>{x === "D" ? "1D" : x === "W" ? "1W" : "1M"}</button>)}
        </div>
        <div className="t-group">
          {RANGES.map(([k]) => <button key={k} className={`t-btn ${st.range === k && !st.from && !st.to ? "on" : ""}`} onClick={() => setSt({ ...st, range: k, from: k === "YTD" ? ytd : null, to: null })}>{k}</button>)}
          <button className={`t-btn ${custom || (st.from && st.range !== "YTD") ? "on" : ""}`} onClick={() => setCustom(!custom)} title="Custom date range">📅</button>
        </div>
        {custom && <div className="t-group"><input type="date" className="input sm" value={st.from ?? ""} onChange={(e) => setSt({ ...st, from: e.target.value || null, range: "custom" })} /><span className="tiny">to</span><input type="date" className="input sm" value={st.to ?? ""} onChange={(e) => setSt({ ...st, to: e.target.value || null, range: "custom" })} /></div>}
        <select className="input sm" value={ap.type} onChange={(e) => setPane(active, { type: e.target.value as ChartType })} title="Chart type">
          {([["candles", "Candles"], ["hollow", "Hollow candles"], ["heikin", "Heikin Ashi"], ["bars", "Bars (OHLC)"], ["line", "Line"], ["step", "Step line"], ["area", "Area"], ["baseline", "Baseline"]] as [ChartType, string][]).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="t-btn strong" onClick={() => { setPicker({ edit: null }); if (st.clean) setSt({ ...st, clean: false }); }} title="Indicators (I)">ƒx Indicators{ap.indicators.length ? ` (${ap.indicators.length})` : ""}</button>
        <select className="input sm" value={st.layout} onChange={(e) => setSt({ ...st, layout: e.target.value as TermState["layout"] })} title="Layout">
          <option value="1">1 chart</option><option value="2h">2 side by side</option><option value="2v">2 stacked</option><option value="4">4 charts</option>
        </select>
        <div className="t-group">
          <button className={`t-btn ${st.clean ? "on" : ""}`} onClick={() => setSt({ ...st, clean: !st.clean })} title="Clean chart: hide indicators, AI levels, markers, volume and drawings (nothing is deleted)">✧ Clean</button>
          <button className={`t-btn ${st.ai && !st.clean ? "on" : ""}`} onClick={() => setSt({ ...st, ai: st.clean ? true : !st.ai, clean: false })} title="Draw buy zone, stop, targets, support/resistance and buy/sell arrows">AI levels</button>
          <button className={`t-btn ${st.patterns && !st.clean ? "on" : ""}`} onClick={() => setSt({ ...st, patterns: st.clean ? true : !st.patterns, clean: false })} title="Mark candlestick patterns">Candles</button>
          <button className={`t-btn ${st.volume && !st.clean ? "on" : ""}`} onClick={() => setSt({ ...st, volume: st.clean ? true : !st.volume, clean: false })}>Vol</button>
          <button className={`t-btn ${st.grid ? "on" : ""}`} onClick={() => setSt({ ...st, grid: !st.grid })}>Grid</button>
        </div>
        <div className="t-group">
          <button className="t-btn" onClick={() => draw.step(sym, "undo")} disabled={!draw.canUndo(sym)} title="Undo (Ctrl/⌘ Z)">↶</button>
          <button className="t-btn" onClick={() => draw.step(sym, "redo")} disabled={!draw.canRedo(sym)} title="Redo (Shift ⌘ Z)">↷</button>
          <button className="t-btn" onClick={() => apis.current[active]?.fit()} title="Fit all data">⤢</button>
          <button className="t-btn" onClick={shot} title="Save a picture of the chart">📷</button>
          <button className="t-btn" onClick={toggleFull} title="Full screen">{full ? "⤡" : "⛶"}</button>
        </div>
        <button className={`t-btn strong ai ${st.panel ? "on" : ""}`} onClick={() => setSt({ ...st, panel: !st.panel })}>✦ AI Analyst</button>
      </div>

      {full && <button className="t-exit-full" onClick={toggleFull} aria-label="Exit full screen">✕ Exit full screen</button>}
      <div className="t-main">
        {/* left drawing toolbar */}
        <div className="t-tools">
          <button className={`tb ${tool === "cursor" ? "on" : ""}`} onClick={() => { setTool("cursor"); setFlyout(null); }} title="Cursor (Esc)"><Ico n="cursor" /></button>
          {TOOL_GROUPS.map((g) => { const cur = lastInGroup[g.key] ?? g.tools[0].id; const inG = g.tools.some((x) => x.id === tool); return (
            <div key={g.key} className="tb-wrap">
              <button className={`tb ${inG ? "on" : ""}`} onClick={() => pickTool(g.key, inG ? tool : cur)} title={TOOLS.get(inG ? tool : cur)?.label}><Ico n={inG ? tool : cur} /></button>
              <button className="tb-more" onClick={() => setFlyout(flyout === g.key ? null : g.key)} aria-label={`${g.label} tools`}>›</button>
              {flyout === g.key && <div className="tb-fly"><div className="tiny faint" style={{ padding: "4px 10px", textTransform: "uppercase" }}>{g.label}</div>{g.tools.map((x) => <button key={x.id} className={tool === x.id ? "on" : ""} onClick={() => pickTool(g.key, x.id)}><Ico n={x.id} /> {x.label}{x.key ? <span className="kbd">⌥{x.key.toUpperCase()}</span> : null}</button>)}</div>}
            </div>
          ); })}
          <span className="tb-sep" />
          <button className={`tb ${st.magnet ? "on" : ""}`} onClick={() => setSt({ ...st, magnet: !st.magnet })} title="Magnet: snap points to open/high/low/close"><Ico n="magnet" /></button>
          <button className={`tb ${st.keep ? "on" : ""}`} onClick={() => setSt({ ...st, keep: !st.keep })} title="Stay in drawing mode"><Ico n="pencil" /></button>
          <button className={`tb ${st.hide ? "on" : ""}`} onClick={() => setSt({ ...st, hide: !st.hide })} title="Hide all drawings"><Ico n="eye" /></button>
          <button className={`tb ${layers ? "on" : ""}`} onClick={() => setLayers(!layers)} title="Drawings list"><Ico n="layers" /></button>
          <button className="tb" onClick={() => { if (drawings.length && confirm(`Remove all ${drawings.length} drawings on ${sym}?`)) { draw.set(sym, [], true); setSelected(null); } }} title="Remove all drawings"><Ico n="trash" /></button>
          {layers && <div className="tb-fly layers"><div className="tiny faint" style={{ padding: "4px 10px" }}>DRAWINGS ON {sym} ({drawings.length})</div>{drawings.length === 0 && <p className="tiny faint" style={{ padding: "0 10px" }}>None yet.</p>}{drawings.map((d) => <div key={d.id} className={`row between ${selected === d.id ? "on" : ""}`} style={{ padding: "3px 8px" }}><button onClick={() => setSelected(d.id)} style={{ flex: 1, textAlign: "left" }}><span style={{ color: d.color }}>●</span> {TOOLS.get(d.tool)?.label}{d.text ? `: ${d.text}` : ""}</button><button onClick={() => draw.set(sym, drawings.map((x) => (x.id === d.id ? { ...x, hidden: !x.hidden } : x)), true)}>{d.hidden ? "Show" : "Hide"}</button><button onClick={() => draw.set(sym, drawings.filter((x) => x.id !== d.id), true)}>✕</button></div>)}</div>}
        </div>

        {/* charts */}
        <div className={`t-charts l${st.layout}`}>
          {panes.slice(0, nPanes).map((pn, i) => (
            <PaneHost key={i} i={i} pn={pn} st={st} active={i === active} tool={i === active ? tool : "cursor"} themeKey={themeKey}
              drawings={draw.get(pn.symbol)} onDrawings={(d, c) => draw.set(pn.symbol, d, c)} selected={i === active ? selected : null} onSelect={setSelected}
              analysis={i === active || pn.symbol === sym ? a ?? null : null} onToolDone={() => setTool("cursor")}
              onFocus={() => { if (i !== active) { setSt((s) => ({ ...s, active: i })); setSelected(null); } }}
              setPane={(patch) => setPane(i, patch)} onEdit={(uid) => { setSt((s) => ({ ...s, active: i })); setPicker({ edit: uid }); }}
              register={(x) => { apis.current[i] = x; }} rangeDays={st.range === "YTD" ? 250 : range[1]} full={full} onFull={toggleFull} />
          ))}
          {selD && (
            <div className="sel-bar">
              {COLORS.map((c) => <button key={c} className={`sw ${selD.color === c ? "on" : ""}`} style={{ background: c }} onClick={() => updSel({ color: c })} aria-label={`Colour ${c}`} />)}
              <select className="input sm" value={selD.width} onChange={(e) => updSel({ width: Number(e.target.value) })}>{[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}px</option>)}</select>
              <button className={`t-btn ${selD.dash ? "on" : ""}`} onClick={() => updSel({ dash: !selD.dash })}>- -</button>
              {["text", "callout", "arrowup", "arrowdown"].includes(selD.tool) && <button className="t-btn" onClick={() => { const t = prompt("Text", selD.text ?? ""); if (t != null) updSel({ text: t }); }}>Text</button>}
              <button className={`t-btn ${selD.locked ? "on" : ""}`} onClick={() => updSel({ locked: !selD.locked })}>{selD.locked ? "Locked" : "Lock"}</button>
              <button className="t-btn" onClick={() => { const c = { ...selD, id: Math.random().toString(36).slice(2) }; draw.set(sym, [...drawings, c], true); setSelected(c.id); }}>Clone</button>
              <button className="t-btn" onClick={() => { draw.set(sym, drawings.filter((d) => d.id !== selD.id), true); setSelected(null); }}>Delete</button>
            </div>
          )}
          {hint && <div className="t-hint">{TOOLS.get(tool)?.label}: {hint} <button className="t-btn" onClick={() => setTool("cursor")}>Done</button></div>}
        </div>

        {/* AI panel + watchlist */}
        {st.panel && (
          <div className="t-side">
            <AiPanel symbol={sym} analysis={a ?? null} loading={analysis.loading} error={analysis.error} bars={bars.bars} tab={st.panelTab} setTab={(t) => setSt({ ...st, panelTab: t })} onSymbol={setSymbol} priceInfo={a?.priceInfo} />
            <div className="t-watch">
              <div className="row between"><span className="tiny faint" style={{ textTransform: "uppercase", letterSpacing: ".05em" }}>Watchlist</span>{firstList && !watch.includes(sym) && <button className="t-btn" onClick={addToWatch}>+ Add {sym}</button>}</div>
              {watch.length === 0 ? <p className="tiny faint">Empty. Tap “+ Add” to keep stocks here for one-tap switching.</p> : <div className="w-list">{watch.map((s) => <button key={s} className={s === sym ? "on" : ""} onClick={() => setSymbol(s)}>{s}</button>)}</div>}
              <Link className="tiny" to={`/stocks/${sym}`}>Company page for {sym} →</Link>
            </div>
          </div>
        )}
      </div>
      {picker && <IndicatorPicker list={ap.indicators} onChange={(l) => setPane(active, { indicators: l })} onClose={() => setPicker(null)} editUid={picker.edit} />}
    </div>
  );
}

function PaneHost({ pn, st, active, tool, drawings, onDrawings, selected, onSelect, analysis, onToolDone, onFocus, setPane, onEdit, register, rangeDays, themeKey, full, onFull }: {
  i: number; pn: PaneState; st: TermState; active: boolean; tool: ToolId; drawings: Drawing[]; onDrawings: (d: Drawing[], c: boolean) => void; selected: string | null; onSelect: (id: string | null) => void;
  analysis: ChartAnalysis | null; onToolDone: () => void; onFocus: () => void; setPane: (p: Partial<PaneState>) => void; onEdit: (uid: string) => void; register: (a: PaneApi | null) => void; rangeDays: number; themeKey: string; full: boolean; onFull: () => void;
}) {
  const b = useBars(pn.symbol);
  const reg = useCallback((x: PaneApi | null) => register(x), []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="t-cell">
      {st.layout !== "1" && <PaneSymbol value={pn.symbol} onPick={(s) => setPane({ symbol: s })} active={active} />}
      {b.error && <div className="term-msg">Couldn't load prices: {b.error}</div>}
      <ChartPane bars={b.bars} symbol={pn.symbol} tf={pn.tf} chartType={pn.type} scaleMode={pn.scale} range={rangeDays} from={st.from} to={st.to}
        indicators={st.clean ? [] : pn.indicators} onEditIndicator={onEdit} onRemoveIndicator={(u) => setPane({ indicators: pn.indicators.filter((x) => x.uid !== u) })} onToggleIndicator={(u) => setPane({ indicators: pn.indicators.map((x) => (x.uid === u ? { ...x, hidden: !x.hidden } : x)) })}
        drawings={drawings} onDrawings={onDrawings} selected={selected} onSelect={onSelect} tool={tool} onToolDone={onToolDone} magnet={st.magnet} keepDrawing={st.keep} hideDrawings={st.hide || st.clean}
        analysis={analysis && analysis.symbol === pn.symbol ? analysis : null} showAi={st.ai && !st.clean} showPatterns={st.patterns && !st.clean} showVolume={st.volume && !st.clean} grid={st.grid}
        onScaleMode={(m) => setPane({ scale: m })} active={active} onFocus={onFocus} register={reg} themeKey={themeKey} full={full} onFull={onFull} />
    </div>
  );
}

function SymbolSearch({ value, onPick }: { value: string; onPick: (s: string) => void }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false);
  const r = useApi<{ symbol: string; name: string; sector: string }[]>(q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : null, [q]);
  return (
    <div className="t-search">
      <input className="input sm" placeholder={`🔍 ${value}`} value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => { if (e.key === "Enter" && q.trim()) { onPick((r.data?.[0]?.symbol ?? q).toUpperCase()); setQ(""); setOpen(false); (e.target as HTMLInputElement).blur(); } }} aria-label="Search stocks" />
      {open && q.trim() && (r.data ?? []).length > 0 && <div className="t-sugg">{r.data!.map((x) => <button key={x.symbol} onMouseDown={() => { onPick(x.symbol); setQ(""); setOpen(false); }}><strong>{x.symbol}</strong> <span className="tiny faint">{x.name} · {x.sector}</span></button>)}</div>}
    </div>
  );
}
function PaneSymbol({ value, onPick, active }: { value: string; onPick: (s: string) => void; active: boolean }) {
  return <div className={`pane-sym ${active ? "on" : ""}`}><SymbolSearch value={value} onPick={onPick} /></div>;
}

// Minimal line icons for the toolbar (drawn here; no external assets).
function Ico({ n }: { n: string }) {
  const P: Record<string, string> = {
    cursor: "M5 3l12 7-5 1.5L9.5 17z", trend: "M4 18L18 5M4 18a1.5 1.5 0 100 .1M18 5a1.5 1.5 0 100 .1", ray: "M4 17L20 6", info: "M4 18L16 7M14 15h6", extended: "M2 20L22 3", angle: "M4 18L18 6M4 18h12",
    hline: "M3 12h18", hray: "M8 12h13M8 12a1.5 1.5 0 100 .1", vline: "M12 3v18", crossline: "M3 12h18M12 3v18", channel: "M3 16L17 6M7 20L21 10", regression: "M3 16L21 8M3 12L21 4M3 20L21 12", pitchfork: "M4 12l16-6M4 12l16 0M4 12l16 6",
    fib: "M3 5h18M3 9h18M3 12h18M3 15h18M3 19h18", fibext: "M3 19L10 6l4 6M14 8h7M14 12h7M14 16h7", rect: "M4 6h16v12H4z", ellipse: "M3 12a9 6 0 1018 0 9 6 0 10-18 0", triangle: "M12 4l9 16H3z", arrow: "M4 20L19 5M19 5h-7M19 5v7",
    brush: "M4 18c3 0 3-4 6-4s3 4 6 4 2-6 4-8", highlighter: "M4 18c3-2 6-6 9-6s4 4 7 2", text: "M5 6h14M12 6v13", callout: "M4 5h16v10H10l-4 4v-4H4z", arrowup: "M12 4l7 10h-4v6H9v-6H5z", arrowdown: "M12 20l7-10h-4V4H9v6H5z",
    measure: "M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2", pricerange: "M12 3v18M8 7l4-4 4 4M8 17l4 4 4-4", daterange: "M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4", long: "M4 4h16v8H4zM4 12h16v8H4z", short: "M4 4h16v8H4zM4 12h16v8H4z",
    magnet: "M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z", pencil: "M4 20l4-1 11-11-3-3L5 16zM14 6l3 3", eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 100 6 3 3 0 000-6", layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5", trash: "M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13",
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={P[n] ?? P.trend} />{n === "long" && <path d="M4 4h16v8H4z" fill="#22c55e" opacity=".35" stroke="none" />}{n === "short" && <path d="M4 12h16v8H4z" fill="#ef4444" opacity=".35" stroke="none" />}</svg>;
}
