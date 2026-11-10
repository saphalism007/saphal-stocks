import { useState } from "react";
import { Card, Notice, Badge } from "../components/ui.tsx";
import { BROWSER_BACKEND } from "../lib/backend.ts";
import { connect, disconnect, setAuto, syncNow, syncStatus, deviceName, type SyncOutcome } from "../lib/sync.ts";
import { nptDate, ago } from "../lib/format.ts";

export function SyncTab() {
  const [st, setSt] = useState(syncStatus());
  const [token, setToken] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; warn?: boolean } | null>(null);
  const [conflict, setConflict] = useState<SyncOutcome | null>(null);
  const refresh = () => setSt(syncStatus());
  const run = async (fn: () => Promise<void>) => { setBusy(true); setMsg(null); try { await fn(); } catch (e) { setMsg({ text: e instanceof Error ? e.message : String(e), warn: true }); } finally { setBusy(false); refresh(); } };

  if (!BROWSER_BACKEND) return <Notice>Sync between devices is available in the web app version (the one installed on your iPhone, iPad and Mac from GitHub Pages).</Notice>;
  return (
    <div className="grid g2">
      <Card title="Sync your data between iPhone, iPad and Mac" sub={`This device: ${deviceName()}`}>
        {st.connected ? (
          <div className="col">
            <div className="row"><Badge tone="up">Connected</Badge><span className="small muted">Last sync {st.lastSyncAt ? `${nptDate(st.lastSyncAt, true)} (${ago(st.lastSyncAt)})` : "never"}</span>{st.localChanged && <Badge tone="warn">Unsynced changes</Badge>}</div>
            {st.lastResult && <p className="small muted">{st.lastResult}</p>}
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={() => run(async () => { const r = await syncNow(); if (r.action === "conflict") setConflict(r); else { setMsg({ text: r.message }); if (r.action === "pulled") setTimeout(() => location.reload(), 900); } })}>{busy ? <span className="spinner" /> : "Sync now"}</button>
              <label className="chk"><input type="checkbox" checked={st.auto} onChange={(e) => { setAuto(e.target.checked); refresh(); }} /> Sync automatically</label>
            </div>
            {conflict && (
              <Notice tone="warn">
                <div>{conflict.message} Which copy do you want to keep?</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <button className="btn sm" onClick={() => run(async () => { const r = await syncNow("keep-local"); setConflict(null); setMsg({ text: r.message }); })}>Keep this device's data</button>
                  <button className="btn sm" onClick={() => run(async () => { const r = await syncNow("use-remote"); setConflict(null); setMsg({ text: r.message }); setTimeout(() => location.reload(), 900); })}>Use {conflict.remote?.deviceName ?? "other device"}'s data</button>
                </div>
              </Notice>
            )}
            <button className="btn ghost danger" onClick={() => { if (confirm("Stop syncing on this device? Your data stays on this device and on GitHub.")) { disconnect(); refresh(); } }}>Disconnect this device</button>
          </div>
        ) : (
          <div className="col">
            <ol className="small" style={{ margin: 0, paddingLeft: 18 }}>
              <li>On GitHub, open <a href="https://github.com/settings/tokens/new?scopes=gist&description=Saphal%20Stocks%20sync" target="_blank" rel="noopener noreferrer">Settings, then Developer settings, then Tokens (classic)</a>, tick only <strong>gist</strong>, set an expiry you like, and create the token.</li>
              <li>Choose a <strong>sync passphrase</strong> (10+ characters). Use the same passphrase and token on your iPhone, iPad and Mac.</li>
              <li>Enter both below. The first device uploads; the others download.</li>
            </ol>
            <label className="field">GitHub token<input className="input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value.trim())} placeholder="ghp_..." /></label>
            <label className="field">Sync passphrase<input className="input" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} /></label>
            <button className="btn primary" disabled={busy || !token || pass.length < 10} onClick={() => run(async () => {
              const r = await connect(token, pass);
              if (r.result === "joined" && r.remote) {
                if (confirm(`Found synced data from your ${r.remote.deviceName} (${new Date(r.remote.updatedAt).toLocaleString()}). Load it on this device? This replaces the data currently on this device.`)) { const o = await syncNow("use-remote"); setMsg({ text: o.message }); setTimeout(() => location.reload(), 900); }
                else { const o = await syncNow("keep-local"); setMsg({ text: o.message }); }
              } else setMsg({ text: "Sync set up. Your data was uploaded (encrypted). Now set up your other devices with the same token and passphrase." });
              setToken(""); setPass("");
            })}>{busy ? <span className="spinner" /> : "Connect"}</button>
          </div>
        )}
        {msg && <div style={{ marginTop: 10 }}><Notice tone={msg.warn ? "warn" : "info"}>{msg.text}</Notice></div>}
      </Card>
      <Card title="How it works">
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Your portfolios, transactions, watchlists, journal, goals, alerts, documents and settings are compressed and <strong>encrypted on this device</strong> (AES-256) with your passphrase, then saved in a <strong>secret Gist</strong> on your GitHub account.</li>
          <li>GitHub only stores scrambled data. Without your passphrase nobody, including GitHub, can read it. If you forget the passphrase, synced data can't be recovered (each device still has its own copy).</li>
          <li>Your AI key, GitHub token and passphrase are never uploaded; they stay on each device.</li>
          <li>Automatic sync runs when the app opens and about 20 seconds after you change something. If two devices changed data since the last sync, you choose which copy to keep.</li>
          <li>Also keep a backup file now and then (Settings, Security & privacy).</li>
        </ul>
      </Card>
    </div>
  );
}
