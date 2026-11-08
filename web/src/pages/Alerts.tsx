import { useState } from "react";
import { Link } from "react-router-dom";
import { api, useApi } from "../lib/api.ts";
import { Card, Loading, Badge, Empty, DataTable } from "../components/ui.tsx";
import { nptDate } from "../lib/format.ts";
import { I } from "../components/icons.tsx";
import { AlertModal } from "./StockDetail.tsx";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Alerts() {
  const alerts = useApi<any[]>("/alerts");
  const notes = useApi<any[]>("/notifications");
  const types = useApi<any[]>("/alerts/types");
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const label = (t: string) => types.data?.find((x) => x.type === t)?.label ?? t;
  const check = async () => { setChecking(true); try { await api("/alerts/evaluate", { body: {} }); notes.reload(); alerts.reload(); } finally { setChecking(false); } };
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Alerts</h1><p>Price, technical, fundamental, announcement and portfolio alerts, checked automatically after each data refresh (end-of-day).</p></div>
        <div className="row"><button className="btn" onClick={check} disabled={checking}>{checking ? <span className="spinner" /> : <I.refresh />} Check now</button><button className="btn primary" onClick={() => setCreating(true)}><I.plus /> New alert</button></div>
      </div>
      <div className="grid g2">
        <Card title="Notifications" flush actions={<button className="btn sm" onClick={async () => { await api("/notifications/read", { body: {} }); notes.reload(); }}>Mark all read</button>}>
          {notes.loading && !notes.data ? <Loading /> : !notes.data?.length ? <Empty title="No notifications yet">Alerts you create will notify here when their condition is met in the data.</Empty> : (
            <div className="list" style={{ maxHeight: 640, overflowY: "auto" }}>{notes.data.map((n) => (
              <div key={n.id} className="list-item" style={{ opacity: n.read ? 0.65 : 1 }}>
                <span className="dot" style={{ background: n.read ? "var(--border-2)" : "var(--accent)", marginTop: 6 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 500 }}>{n.symbol ? <Link to={`/stocks/${n.symbol}`}>{n.title}</Link> : n.title}</div>
                  <div className="small muted" style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                  <div className="tiny faint">Based on data from {n.data_date ?? "—"} · created {nptDate(n.created_at, true)}</div>
                </div>
              </div>
            ))}</div>
          )}
        </Card>
        <Card title={`Your alerts (${alerts.data?.length ?? 0})`} flush>
          <DataTable rows={alerts.data ?? []} empty="No alerts yet" cols={[
            { key: "type", label: "Alert", render: (a: any) => <>{label(a.type)}<div className="tiny faint">{Object.entries(a.params || {}).map(([k, v]) => `${k}: ${v}`).join(", ")} {a.note ? `· ${a.note}` : ""}</div></> },
            { key: "symbol", label: "Stock", render: (a: any) => a.symbol ? <Link to={`/stocks/${a.symbol}`} className="sym">{a.symbol}</Link> : <span className="faint">Market</span> },
            { key: "active", label: "Status", render: (a: any) => <Badge tone={a.active ? "accent" : ""}>{a.active ? (a.repeat ? "Active · repeat" : "Active") : "Fired / paused"}</Badge> },
            { key: "last_triggered_at", label: "Last fired", render: (a: any) => <span className="tiny">{a.last_triggered_at ? nptDate(a.last_triggered_at, true) : "—"}</span> },
            { key: "x", label: "", render: (a: any) => <span className="row" style={{ flexWrap: "nowrap" }}><button className="btn ghost sm" onClick={async () => { await api(`/alerts/${a.id}`, { method: "PATCH", body: { active: !a.active } }); alerts.reload(); }}>{a.active ? "Pause" : "Resume"}</button><button className="btn ghost sm danger" onClick={async () => { await api(`/alerts/${a.id}`, { method: "DELETE" }); alerts.reload(); }}><I.trash /></button></span> },
          ]} />
        </Card>
      </div>
      <Card title="Daily market briefing">
        <p className="small muted">Your briefing is on the <Link to="/">Overview</Link> page: what happened in NEPSE, stocks that deserve attention, developing setups, new reports, portfolio changes and new opportunities. It refreshes after the daily data update ({"15:45"} NPT by default, configurable in .env).</p>
      </Card>
      {creating && <AlertModal onClose={() => { setCreating(false); alerts.reload(); }} />}
    </div>
  );
}
