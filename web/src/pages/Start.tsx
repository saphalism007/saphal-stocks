// Start Investing: open the right accounts once, then pick a path by amount. Every step has its
// official link (checked daily) or a link to the right page in this app.
import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Badge } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { nptDate } from "../lib/format.ts";
import { ACCOUNTS, PATHS, type GuideStep } from "../../../shared/guide.ts";

type Check = { url: string; ok: number; status: number; checked_at: string };

export default function Start() {
  const c = useApi<Check[]>("/guide/links");
  const [path, setPath] = useState(PATHS[0].key);
  const checks = new Map((c.data ?? []).map((x) => [x.url, x]));
  const p = PATHS.find((x) => x.key === path)!;
  const Step = ({ s }: { s: GuideStep }) => (
    <div className="guide-step">
      <strong>{s.title}</strong>
      <p className="small muted" style={{ margin: "4px 0 8px" }}>{s.detail}</p>
      <div className="row wrap" style={{ gap: 8 }}>
        {s.links.map((l) => {
          const k = checks.get(l.url);
          return (
            <span key={l.url} className="col" style={{ gap: 2 }}>
              <a className="btn sm primary" href={l.url} target="_blank" rel="noopener noreferrer"><I.external /> {l.label}</a>
              <span className="tiny faint">{l.who}{k ? (k.ok ? `, link checked ${nptDate(k.checked_at)}` : `, couldn't reach on ${nptDate(k.checked_at)} (may block checks from outside Nepal)`) : ""}</span>
            </span>
          );
        })}
        {s.inApp && <Link className="btn sm" to={s.inApp.to}>{s.inApp.label}</Link>}
      </div>
    </div>
  );
  return (
    <div className="page">
      <div className="page-head"><div><h1>Start Investing</h1><p className="small muted">Open the accounts once, then choose a path for the amount you have. Every step links to the official place to do it.</p></div></div>
      <Card title="Accounts you need (one time)" sub="Takes a few days; many steps can be done online">
        <div className="guide">{ACCOUNTS.map((s) => <Step key={s.title} s={s} />)}</div>
      </Card>
      <div className="path-tabs">
        {PATHS.map((x) => (
          <button key={x.key} className={`path-tab ${x.key === path ? "on" : ""}`} onClick={() => setPath(x.key)}>
            <strong>{x.title}</strong><span className="tiny">{x.amount}</span><Badge tone={x.risk === "High" ? "down" : x.risk === "Medium" ? "warn" : "up"}>{x.risk} risk</Badge>
          </button>
        ))}
      </div>
      <Card title={p.title} sub={p.summary}>
        <div className="guide">{p.steps.map((s) => <Step key={s.title} s={s} />)}</div>
      </Card>
      <Card title="Before you invest">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Keep 3-6 months of expenses in savings first (<Link to="/money">Wealth Management</Link> works it out).</li>
          <li>Pay off expensive loans (credit cards, personal loans) before investing in shares.</li>
          <li>Money needed within 3 years belongs in deposits, not shares.</li>
          <li>Only apply, buy or register through the official sites and licensed institutions linked here. Nobody legitimate asks for your Mero Share password or OTP.</li>
          <li>Projected returns are never guaranteed; deposit rates are contractual only for the term you lock in.</li>
        </ul>
        <div className="row" style={{ marginTop: 10 }}><Link className="btn" to="/future">Monthly investing calculator</Link><Link className="btn" to="/invest">Where should I invest?</Link><Link className="btn" to="/opportunities">Full investment directory</Link></div>
      </Card>
    </div>
  );
}
