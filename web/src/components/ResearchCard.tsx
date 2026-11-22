// The full research verdict for one stock: final decision, the six areas studied with their reasons, and the plan.
import { useState } from "react";
import { useApi } from "../lib/api.ts";
import { Badge, Loading, ErrorBox } from "./ui.tsx";
import { nptDate } from "../lib/format.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;
const V_ICON: Record<string, [string, string]> = { positive: ["+", "up"], negative: ["-", "down"], neutral: ["=", "warn"], unknown: ["?", "faint"] };
export const DECISION_TONE: Record<string, "up" | "down" | "warn" | "blue"> = { "STRONG BUY": "up", BUY: "up", ACCUMULATE: "up", WATCH: "warn", HOLD: "blue", REDUCE: "down", SELL: "down", AVOID: "down", "NO CALL": "blue" };

export function ResearchCard({ symbol, compact = false }: { symbol: string; compact?: boolean }) {
  const r = useApi<Any>(`/research/${symbol}`, [symbol]);
  const [open, setOpen] = useState<string | null>(compact ? null : "all");
  if (r.error) return <ErrorBox error={r.error} />;
  if (!r.data) return <Loading label="Studying chart, indicators, statements, reports, news and market" />;
  const d = r.data;
  const show = (k: string) => open === "all" || open === k;
  return (
    <div className={`research t-${d.tone}`}>
      <div className="research-head">
        <div style={{ minWidth: 0 }}>
          <div className="tiny faint">RESEARCH VERDICT{d.asOf ? `, closing prices of ${nptDate(d.asOf)}` : ""}</div>
          <div className="row" style={{ gap: 8, marginTop: 4 }}><Badge tone={DECISION_TONE[d.decision]}>{d.decision}</Badge><span className="small">Conviction <strong>{d.conviction}</strong></span><span className="tiny faint">{d.horizon}</span></div>
        </div>
        <div className="research-agree" title="How many of the areas studied support or oppose">
          <span className="up">{d.agree.positive} for</span><span className="down">{d.agree.negative} against</span><span className="faint">of {d.agree.known} judged</span>
        </div>
      </div>
      <div className="research-headline">{d.headline}</div>
      {d.whyNot.length > 0 && <ul className="research-why small">{d.whyNot.map((x: string) => <li key={x}>{x}</li>)}</ul>}
      {(d.plan.entry || d.plan.stop || d.plan.targets.length > 0) && <div className="research-plan">
        {d.plan.entry && <div><span>When to buy</span><p>{d.plan.entry}</p></div>}
        {d.plan.stop && <div><span>Stop-loss</span><p className="down">{d.plan.stop}</p></div>}
        {d.plan.targets.length > 0 && <div><span>Targets / when to sell</span><p>{d.plan.targets.join(". ")}.</p>{d.plan.exit.length > 0 && <p className="tiny muted">{d.plan.exit.join(" ")}</p>}</div>}
        {!d.plan.targets.length && d.plan.exit.length > 0 && <div><span>When to sell</span><p>{d.plan.exit.join(" ")}</p></div>}
        {d.plan.size && <div><span>Position size</span><p className="tiny">{d.plan.size}</p></div>}
      </div>}
      <div className="research-pillars">
        {d.pillars.map((p: Any) => { const [ic, cls] = V_ICON[p.verdict]; return (
          <div key={p.key} className="research-pillar">
            <button type="button" className="research-pillar-head" onClick={() => setOpen(open === p.key ? (compact ? null : "all") : p.key)}>
              <span className={`research-ic ${cls}`}>{ic}</span><strong className="small">{p.title}</strong>{p.score != null && <span className="tiny faint">{p.score}/100</span>}
              <span className="tiny muted research-sum">{p.summary}</span>
            </button>
            {show(p.key) && p.reasons.length > 0 && <ul className="small research-reasons">{p.reasons.map((x: string, i: number) => <li key={i}>{x}</li>)}
              {(p.links ?? []).map((l: Any) => <li key={l.url}><a href={l.url} target="_blank" rel="noreferrer">{l.label}</a></li>)}</ul>}
          </div>
        ); })}
      </div>
      {d.changeMind.length > 0 && <div className="tiny muted" style={{ marginTop: 8 }}><strong>What would change this:</strong> {d.changeMind.join(" ")}</div>}
      <div className="tiny faint" style={{ marginTop: 6 }}>Rule-based research from stored NEPSE prices, statements, reports and notices. Not a guarantee or licensed advice; always keep the stop.</div>
    </div>
  );
}
