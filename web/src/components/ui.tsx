import { useEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { I } from "./icons.tsx";
import { scoreColor, isNum, nptDate, ago, numberLocale } from "../lib/format.ts";

export function Card({ title, actions, children, flush, className, style, sub }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string; style?: CSSProperties; sub?: ReactNode }) {
  return (
    <section className={`card ${className || ""}`} style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div><h3>{title}</h3>{sub && <div className="tiny faint" style={{ marginTop: 2 }}>{sub}</div>}</div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      <div className={`card-body ${flush ? "flush" : ""}`}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${tone || ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Score({ value, title }: { value: number | null | undefined; title?: string }) {
  return <span className="score" style={scoreColor(value)} title={title}>{isNum(value) ? Math.round(value) : "—"}</span>;
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "up" | "down" | "warn" | "blue" | "accent" | "" }) {
  return <span className={`badge ${tone || ""}`}>{children}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><strong>{title}</strong>{children}</div>;
}

// Info boxes can be minimised to a small "note" pill; the choice is remembered on this device (by the box's text).
const textOf = (n: ReactNode): string => n == null || typeof n === "boolean" ? "" : typeof n === "string" || typeof n === "number" ? String(n) : Array.isArray(n) ? n.map(textOf).join("") : typeof n === "object" && "props" in (n as object) ? textOf((n as { props: { children?: ReactNode } }).props.children) : "";
const noteKey = (t: string) => { let h = 0; for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return `n${h}`; };
const readHidden = (): Record<string, 1> => { try { return JSON.parse(localStorage.getItem("ss-hidden-notes") || "{}"); } catch { return {}; } };
export function Notice({ tone = "info", children, id }: { tone?: "info" | "warn" | ""; children: ReactNode; id?: string }) {
  const key = id ?? noteKey(textOf(children).slice(0, 160));
  const [hidden, setHidden] = useState(() => tone !== "warn" && !!readHidden()[key]);
  const set = (h: boolean) => { setHidden(h); if (tone === "warn") return; try { const m = readHidden(); if (h) m[key] = 1; else delete m[key]; localStorage.setItem("ss-hidden-notes", JSON.stringify(m)); } catch { /* ignore */ } };
  if (hidden) return <button className={`notice-pill ${tone}`} onClick={() => set(false)} title="Show this note">{tone === "warn" ? <I.warn /> : <I.info />} Note</button>;
  return <div className={`notice ${tone}`}>{tone === "warn" ? <I.warn /> : <I.info />}<div style={{ flex: 1, minWidth: 0 }}>{children}</div><button className="notice-x" onClick={() => set(true)} aria-label="Minimise this note" title="Minimise">✕</button></div>;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return <div className="row muted" style={{ padding: 20 }}><span className="spinner" /> {label}…</div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return <Notice tone="warn"><div className="row between" style={{ width: "100%" }}><span>{error}</span>{onRetry && <button className="btn sm" onClick={onRetry}>Retry</button>}</div></Notice>;
}

/** Shows when data was last updated and where it came from. */
export function Fresh({ date, fetched, source }: { date?: string | null; fetched?: string | null; source?: string }) {
  return (
    <span className="fresh" title={fetched ? `Fetched ${nptDate(fetched, true)} NPT` : undefined}>
      <span className="dot" style={{ background: date ? "var(--accent)" : "var(--warn)" }} />
      {date ? `Data as of ${nptDate(date)}` : "Data unavailable"}
      {fetched && ` · fetched ${ago(fetched)}`}
      {source && ` · ${source}`}
    </span>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the selected tab visible when the row scrolls sideways (phones).
  useEffect(() => { const el = ref.current, on = el?.querySelector<HTMLElement>("button.on"); if (el && on && el.scrollWidth > el.clientWidth) el.scrollTo({ left: Math.max(0, on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2), behavior: "smooth" }); }, [value]);
  return <div className="tabs" ref={ref}>{tabs.map((t) => <button key={t.key} className={value === t.key ? "on" : ""} onClick={() => onChange(t.key)}>{t.label}</button>)}</div>;
}

export function Seg<T extends string>({ options, value, onChange }: { options: { key: T; label: ReactNode }[]; value: T; onChange: (k: T) => void }) {
  return <div className="seg">{options.map((o) => <button key={o.key} className={value === o.key ? "on" : ""} onClick={() => onChange(o.key)}>{o.label}</button>)}</div>;
}

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-label={title}>
        <div className="card-head"><h3>{title}</h3><button className="btn ghost sm" onClick={onClose} aria-label="Close"><I.x /></button></div>
        <div className="card-body">{children}</div>
        {footer && <div className="card-head" style={{ borderTop: "1px solid var(--border)", borderBottom: 0, justifyContent: "flex-end" }}>{footer}</div>}
      </div>
    </div>
  );
}

export interface Col<T> { key: string; label: ReactNode; num?: boolean; render?: (r: T) => ReactNode; sort?: (r: T) => number | string | null | undefined; width?: number | string; title?: string }

export function DataTable<T>({ rows, cols, onRow, initialSort, empty = "No data", maxHeight, rowKey }: { rows: T[]; cols: Col<T>[]; onRow?: (r: T) => void; initialSort?: { key: string; dir: 1 | -1 }; empty?: string; maxHeight?: number; rowKey?: (r: T, i: number) => string | number }) {
  const [sort, setSort] = useState(initialSort || null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const c = cols.find((x) => x.key === sort.key);
    if (!c) return rows;
    const get = c.sort || ((r: T) => (r as Record<string, unknown>)[c.key] as number | string | null);
    return [...rows].sort((a, b) => {
      const av = get(a), bv = get(b);
      if (av == null || av === "") return 1;
      if (bv == null || bv === "") return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * sort.dir;
    });
  }, [rows, sort, cols]);
  if (!rows.length) return <Empty title={empty} />;
  return (
    <div className="table-wrap" style={maxHeight ? { maxHeight, overflowY: "auto" } : undefined}>
      <table className="t">
        <thead><tr>{cols.map((c) => (
          <th key={c.key} className={`sortable ${c.num ? "num" : ""}`} style={{ width: c.width }} title={c.title}
            onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: (s.dir * -1) as 1 | -1 } : { key: c.key, dir: c.num ? -1 : 1 }))}>
            {c.label}{sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
          </th>))}</tr></thead>
        <tbody>{sorted.map((r, i) => (
          <tr key={rowKey ? rowKey(r, i) : i} className={onRow ? "click" : ""} onClick={onRow ? () => onRow(r) : undefined}>
            {cols.map((c) => <td key={c.key} className={c.num ? "num" : ""}>{c.render ? c.render(r) : String((r as Record<string, unknown>)[c.key] ?? "—")}</td>)}
          </tr>))}</tbody>
      </table>
    </div>
  );
}

/** Tiny markdown renderer for AI output (headings, bold/italic, lists, tables, links, code, hr). Escapes HTML first. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderMd(text), [text]);
  return <div className="md" dangerouslySetInnerHTML={{ __html: html }} />;
}

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
function inline(s: string) {
  return esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:])/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>')
    .replace(/ {2}$/g, "<br/>");
}
export function renderMd(src: string): string {
  const lines = src.replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const head = cells(l);
      i += 2;
      const body: string[][] = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`);
      continue;
    }
    if (/^#{1,6}\s/.test(l)) { const lvl = Math.min(4, Math.max(3, l.match(/^#+/)![0].length)); out.push(`<h${lvl}>${inline(l.replace(/^#+\s*/, ""))}</h${lvl}>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out.push("<hr/>"); i++; continue; }
    if (/^\s*[-*•]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*•]\s+/, ""));
      out.push(`<ul>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      out.push(`<ol>${items.map((x) => `<li>${inline(x)}</li>`).join("")}</ol>`);
      continue;
    }
    if (!l.trim()) { i++; continue; }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|\s*[-*•]\s+|\s*\d+[.)]\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
    if (!para.length) { para.push(lines[i++]); }
    out.push(`<p>${para.map(inline).join("<br/>")}</p>`);
  }
  return out.join("\n");
}

export function ScoreBar({ value, label }: { value: number | null | undefined; label: string }) {
  const c = scoreColor(value);
  return (
    <div className="col" style={{ gap: 4 }}>
      <div className="row between small"><span className="muted">{label}</span><span className="mono" style={{ color: c.color }}>{isNum(value) ? Math.round(value) : "—"}</span></div>
      <div className="bar"><span style={{ width: `${isNum(value) ? value : 0}%`, background: c.color }} /></div>
    </div>
  );
}

export function Disclaimer() {
  return <p className="tiny faint" style={{ marginTop: 8 }}>Decision-support only, not licensed financial advice. Scores, levels and setups are calculations from stored data; they can be wrong and do not predict returns. Verify before you trade.</p>;
}

/**
 * Number box that behaves well on iPhone: it can be cleared completely, tapping selects the
 * whole value (typing replaces it, no "05699"), the numeric keypad opens, and when you are not
 * editing it shows grouped digits (60,00,000). Drop-in for <input type="number">: onChange gets
 * an event-like object whose target.value is the plain number text ("" when empty).
 */
export function NumInput({ value, onChange, className = "input", min, max, step, placeholder, style, title, disabled, autoFocus, id, name, plain }: {
  value: number | string | null | undefined; onChange?: (e: any) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  className?: string; min?: number | string; max?: number | string; step?: number | string; placeholder?: string; style?: CSSProperties; title?: string; disabled?: boolean; autoFocus?: boolean; id?: string; name?: string;
  plain?: boolean; // no thousands separators (years, days, instalment numbers)
}) {
  const asText = (v: unknown) => (v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v)) ? "" : String(v));
  const [text, setText] = useState(asText(value));
  const [focused, setFocused] = useState(false);
  // Follow outside changes, but keep an empty box empty while the value is 0.
  useEffect(() => {
    const outside = asText(value);
    if (Number(outside || 0) !== Number(text || 0) || (outside === "" && text !== "" && !focused)) setText(outside);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const allowNeg = min === undefined || Number(min) < 0;
  const clean = (raw: string) => {
    let t = raw.replace(/[,\s]/g, "").replace(allowNeg ? /[^\d.-]/g : /[^\d.]/g, "");
    t = t.replace(/(?!^)-/g, "");
    const dot = t.indexOf(".");
    if (dot >= 0) t = t.slice(0, dot + 1) + t.slice(dot + 1).replace(/\./g, "");
    if (/^-?0\d/.test(t)) t = t.replace(/^(-?)0+(?=\d)/, "$1"); // no leading zeros
    return t;
  };
  const emit = (t: string) => onChange?.({ target: { value: t, valueAsNumber: t === "" ? NaN : Number(t) }, currentTarget: { value: t } });
  const n = Number(text);
  const shown = plain || focused || text === "" || text === "-" || !Number.isFinite(n) ? text
    : n.toLocaleString(numberLocale(), { maximumFractionDigits: (text.split(".")[1] ?? "").length });
  return (
    <input
      id={id} name={name} className={className} style={style} title={title} disabled={disabled} autoFocus={autoFocus}
      type="text" inputMode={allowNeg && Number(min ?? -1) < 0 && min !== undefined ? "text" : "decimal"} enterKeyHint="done" autoComplete="off"
      placeholder={placeholder} value={shown} data-step={step} data-max={max}
      onFocus={(e) => { setFocused(true); const el = e.currentTarget; requestAnimationFrame(() => { try { el.select(); } catch { /* ignore */ } }); }}
      onBlur={() => { setFocused(false); if (text === "-" || text === ".") { setText(""); emit(""); } }}
      onChange={(e) => { const t = clean(e.target.value); setText(t); emit(t); }}
    />
  );
}
