// Type-ahead company picker: every listed NEPSE company, matched as you type the first letters of the symbol
// (or any part of the name), with its sector and latest price. Keyboard (up, down, Enter, Esc) and touch friendly.
import { useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "../lib/api.ts";
import { num, pct } from "../lib/format.ts";

export interface SymbolRow { symbol: string; name: string | null; sector: string | null; ltp: number | null; close: number | null; changePct: number | null; date: string | null }

/** All listed companies (shared by every picker on the page; refreshed with new market data). */
export function useSymbols() {
  const r = useApi<SymbolRow[]>("/symbols");
  return r.data ?? [];
}

export function rankSymbols(all: SymbolRow[], q: string, limit = 500): SymbolRow[] {
  const s = q.trim().toUpperCase();
  if (!s) return all.slice(0, limit);
  const score = (r: SymbolRow) => {
    const sym = r.symbol.toUpperCase(), name = (r.name ?? "").toUpperCase();
    if (sym === s) return 0;
    if (sym.startsWith(s)) return 1;
    if (name.startsWith(s)) return 2;
    if (name.split(/\s+/).some((w) => w.startsWith(s))) return 3;
    if (sym.includes(s) || name.includes(s)) return 4;
    return 9;
  };
  return all.map((r) => [score(r), r] as const).filter(([k]) => k < 9).sort((a, b) => a[0] - b[0] || a[1].symbol.localeCompare(b[1].symbol)).slice(0, limit).map(([, r]) => r);
}

export function SymbolPicker({ value, onChange, onPick, autoFocus, placeholder = "Type a symbol or company name", only, hideName, width }: {
  value: string; onChange: (v: string) => void; onPick?: (r: SymbolRow) => void; autoFocus?: boolean; placeholder?: string;
  /** Limit the list (for example to stocks you hold, when selling). */
  only?: string[];
  /** The form shows the company itself, so skip the name line under the box. */
  hideName?: boolean;
  /** Fixed width when used inline in a row (default: fills its column). */
  width?: number;
}) {
  const all = useSymbols();
  const pool = useMemo(() => (only ? all.filter((r) => only.includes(r.symbol)) : all), [all, only]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const list = useMemo(() => rankSymbols(pool, value), [pool, value]);
  const exact = pool.find((r) => r.symbol === value.trim().toUpperCase());
  useEffect(() => { setHi(0); }, [value]);
  useEffect(() => {
    const h = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", h); return () => document.removeEventListener("pointerdown", h);
  }, []);
  useEffect(() => { box.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" }); }, [hi]);
  const pick = (r: SymbolRow) => { onChange(r.symbol); onPick?.(r); setOpen(false); };
  return (
    <div className="sympick" ref={box} style={width ? { width, flex: "0 1 auto" } : undefined}>
      <input className="input" value={value} autoFocus={autoFocus} placeholder={placeholder} autoComplete="off" autoCapitalize="characters" spellCheck={false}
        role="combobox" aria-expanded={open} aria-autocomplete="list"
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value.toUpperCase()); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((h) => Math.min(h + 1, list.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          else if (e.key === "Enter" && open && list[hi]) { e.preventDefault(); pick(list[hi]); }
          else if (e.key === "Escape") setOpen(false);
        }} />
      {exact && !open && !hideName && <div className="tiny faint sympick-name">{exact.name}{exact.ltp ?? exact.close ? `, Rs. ${num(exact.ltp ?? exact.close)}` : ""}</div>}
      {open && (
        <div className="sympick-list" role="listbox">
          {list.length === 0 ? <div className="sympick-empty small muted">{all.length ? `No listed company matches "${value}"` : "Loading the company list..."}</div> :
            list.map((r, i) => (
              <button type="button" key={r.symbol} data-i={i} role="option" aria-selected={i === hi} className={`sympick-row${i === hi ? " on" : ""}`}
                onPointerEnter={() => setHi(i)} onClick={() => pick(r)}>
                <span className="sym">{r.symbol}</span>
                <span className="sympick-co"><span className="small">{r.name ?? ""}</span><span className="tiny faint">{r.sector ?? ""}</span></span>
                <span className="sympick-px mono small">{r.ltp ?? r.close ? num(r.ltp ?? r.close) : "-"}{r.changePct != null && <span className={`tiny ${r.changePct > 0 ? "up" : r.changePct < 0 ? "down" : "faint"}`}> {pct(r.changePct, 2)}</span>}</span>
              </button>
            ))}
          {list.length > 0 && !value && <div className="sympick-empty tiny faint">{pool.length} listed companies. Type the first letters to narrow.</div>}
        </div>
      )}
    </div>
  );
}
