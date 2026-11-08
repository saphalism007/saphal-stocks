import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, useApi, streamPost } from "../lib/api.ts";
import { Card, Markdown, Notice, Badge } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";
import { nptDate } from "../lib/format.ts";

interface Msg { role: "user" | "assistant"; text: string; tools?: string[] }
const SUGGESTIONS = [
  "Which five NEPSE stocks look most attractive right now for long-term investing?",
  "Which companies are fundamentally undervalued?",
  "Which hydropower companies have the strongest financial position?",
  "Find stocks approaching major support levels.",
  "Which stocks are showing bullish momentum?",
  "Compare NABIL, EBL and SCB.",
  "Find companies with consistent dividend histories.",
  "Which stocks have deteriorating financial health?",
  "Analyze my entire portfolio. Am I overexposed to any sector?",
  "Find stocks with a potential breakout in the coming sessions.",
  "I have NPR 10 lakh. How should I think about allocating it?",
  "Backtest a 20-day breakout strategy on NABIL over 5 years.",
  "Which IPOs and right shares are open or coming up?",
  "Which listed mutual funds trade at the biggest discount to NAV?",
];
const TOOL_LABELS: Record<string, string> = {
  search_stocks: "Searching companies", get_market_overview: "Reading the market summary", get_stock_analysis: "Analysing a stock", get_financial_statements: "Reading financial statements",
  compare_stocks: "Comparing stocks", rank_stocks: "Ranking stocks", screen_stocks: "Screening stocks", get_trade_setups: "Scanning trade setups", run_backtest: "Running a backtest",
  get_portfolio: "Reading your portfolio", get_announcements: "Reading announcements", search_documents: "Searching your documents", get_sector_stats: "Computing sector medians",
  get_wealth_profile: "Reading your financial profile", get_public_issues: "Checking IPO/FPO/right issues", get_mutual_funds: "Reading mutual fund NAVs", calculate: "Calculating",
};

export default function Analyst() {
  const [params, setParams] = useSearchParams();
  const status = useApi<{ available: boolean; model: string; provider: string; hasKey: boolean }>("/ai/status");
  const convs = useApi<{ id: number; title: string; updated_at: string }[]>("/ai/conversations");
  const [convId, setConvId] = useState<number | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" }); }, [msgs, activity]);
  useEffect(() => {
    const q = params.get("q");
    if (q && !started.current) { started.current = true; setParams({}, { replace: true }); void send(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const open = async (id: number) => {
    const c = await api<{ messages: { role: "user" | "assistant"; display: string; tools: string[] }[] }>(`/ai/conversations/${id}`);
    setConvId(id); setMsgs(c.messages.map((m) => ({ role: m.role, text: m.display, tools: m.tools }))); setErr(null);
  };
  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setInput(""); setErr(null); setBusy(true); setActivity([]);
    setMsgs((m) => [...m, { role: "user", text }]);
    let cid = convId;
    try {
      await streamPost("/ai/chat", { message: text, conversationId: cid ?? undefined }, (ev, data) => {
        if (ev === "conversation") { cid = (data as { id: number }).id; setConvId(cid); }
        if (ev === "status") setActivity((a) => [...a, String(data)]);
        if (ev === "tool") setActivity((a) => [...a, TOOL_LABELS[(data as { name: string }).name] ?? (data as { name: string }).name]);
        if (ev === "text") setMsgs((m) => [...m, { role: "assistant", text: String(data) }]);
        if (ev === "tools") setMsgs((m) => { const c = [...m]; const l = c[c.length - 1]; if (l?.role === "assistant") l.tools = data as string[]; return c; });
        if (ev === "error") setErr(String(data));
      });
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false); setActivity([]); convs.reload();
  };
  const remove = async (id: number) => { await api(`/ai/conversations/${id}`, { method: "DELETE" }); if (id === convId) { setConvId(null); setMsgs([]); } convs.reload(); };

  return (
    <div className="page" style={{ maxWidth: 1440 }}>
      <div className="page-head">
        <div><h1>AI Stock Analyst</h1><p>Answers are built from the platform's own data: prices, computed indicators and levels, statements, rankings, your portfolio and uploaded documents.</p></div>
        <div className="row">
          {status.data && (status.data.available ? <Badge tone="accent">{status.data.model}</Badge> : <Badge tone="warn">AI narrative off · data reports only</Badge>)}
          <button className="btn" onClick={() => { setConvId(null); setMsgs([]); setErr(null); }}><I.plus /> New chat</button>
        </div>
      </div>
      {status.data && !status.data.available && <Notice>No AI API key is configured, so the analyst answers with rule-based data reports (stock reports, comparisons, rankings, support and breakout scans, portfolio review). Add an Anthropic API key in <Link to="/settings">Settings → AI</Link> for full conversational analysis.</Notice>}
      <div className="chat">
        <Card title="Conversations" flush>
          <div className="list" style={{ maxHeight: "calc(100vh - 260px)", overflowY: "auto" }}>
            {convs.data?.length ? convs.data.map((c) => (
              <div key={c.id} className="list-item" style={{ padding: "8px 12px", cursor: "pointer", background: c.id === convId ? "var(--panel-3)" : undefined }} onClick={() => open(c.id)}>
                <div style={{ flex: 1, minWidth: 0 }}><div className="small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</div><div className="tiny faint">{nptDate(c.updated_at, true)}</div></div>
                <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); void remove(c.id); }} aria-label="Delete"><I.trash /></button>
              </div>
            )) : <div className="empty small">No conversations yet</div>}
          </div>
        </Card>
        <section className="card" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div className="chat-log" ref={logRef}>
            {msgs.length === 0 && (
              <div className="col" style={{ margin: "auto", maxWidth: 760, textAlign: "center", gap: 14 }}>
                <div style={{ fontSize: 34 }}>✦</div>
                <h2>What would you like to analyse?</h2>
                <div className="row" style={{ justifyContent: "center" }}>{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role === "user" ? "user" : "ai"}`}>
                {m.role === "user" ? m.text : <><Markdown text={m.text} />{m.tools && m.tools.length > 0 && <div className="tiny faint" style={{ marginTop: 8 }}>Data used: {m.tools.map((t) => TOOL_LABELS[t] ?? t).join(" · ")}</div>}</>}
              </div>
            ))}
            {busy && <div className="msg ai"><div className="row small muted"><span className="spinner" /> {activity[activity.length - 1] ?? "Working"}…</div>{activity.length > 1 && <div className="tiny faint" style={{ marginTop: 6 }}>{activity.slice(0, -1).join(" → ")}</div>}</div>}
            {err && <Notice tone="warn">{err}</Notice>}
          </div>
          <form className="row" style={{ padding: 12, borderTop: "1px solid var(--border)", flexWrap: "nowrap" }} onSubmit={(e) => { e.preventDefault(); void send(input); }}>
            <textarea className="input" style={{ flex: 1, minHeight: 44, maxHeight: 160 }} rows={1} value={input} placeholder="Ask about a stock, a sector, your portfolio, or your financial plan…" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
            <button className="btn primary" disabled={busy || !input.trim()} aria-label="Send"><I.send /></button>
          </form>
          <div className="tiny faint" style={{ padding: "0 14px 10px" }}>Decision support, not licensed financial advice. The analyst separates facts, calculations, assumptions and predictions, and cites data dates.</div>
        </section>
      </div>
    </div>
  );
}
