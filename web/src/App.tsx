import { createContext, useContext, useEffect, useRef, useState, lazy, Suspense, type FormEvent } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, useApi } from "./lib/api.ts";
import { I } from "./components/icons.tsx";
import { Loading, Notice } from "./components/ui.tsx";

const Overview = lazy(() => import("./pages/Overview.tsx"));
const Market = lazy(() => import("./pages/Market.tsx"));
const Stocks = lazy(() => import("./pages/Stocks.tsx"));
const StockDetail = lazy(() => import("./pages/StockDetail.tsx"));
const Compare = lazy(() => import("./pages/Compare.tsx"));
const StrategyLab = lazy(() => import("./pages/StrategyLab.tsx"));
const Journal = lazy(() => import("./pages/Journal.tsx"));
const Fundamental = lazy(() => import("./pages/Fundamental.tsx"));
const Technical = lazy(() => import("./pages/Technical.tsx"));
const Analyst = lazy(() => import("./pages/Analyst.tsx"));
const Portfolio = lazy(() => import("./pages/Portfolio.tsx"));
const Watchlist = lazy(() => import("./pages/Watchlist.tsx"));
const Opportunities = lazy(() => import("./pages/Opportunities.tsx"));
const Planner = lazy(() => import("./pages/Planner.tsx"));
const News = lazy(() => import("./pages/News.tsx"));
const Alerts = lazy(() => import("./pages/Alerts.tsx"));
const Learn = lazy(() => import("./pages/Learn.tsx"));
const Reports = lazy(() => import("./pages/Reports.tsx"));
const Settings = lazy(() => import("./pages/Settings.tsx"));

interface User { id: number; username: string }
const ThemeCtx = createContext<{ theme: string; toggle: () => void }>({ theme: "dark", toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);

const NAV: { section?: string; to: string; label: string; icon: keyof typeof I }[] = [
  { to: "/", label: "Overview", icon: "overview" },
  { section: "Markets", to: "/market", label: "NEPSE Market", icon: "market" },
  { to: "/stocks", label: "Stocks", icon: "stocks" },
  { to: "/compare", label: "Compare", icon: "fundamental" },
  { to: "/fundamental", label: "Fundamental Analysis", icon: "fundamental" },
  { to: "/technical", label: "Technical Analysis", icon: "technical" },
  { to: "/strategy-lab", label: "Strategy Lab", icon: "refresh" },
  { to: "/analyst", label: "AI Stock Analyst", icon: "ai" },
  { section: "My money", to: "/portfolio", label: "Portfolio", icon: "portfolio" },
  { to: "/watchlist", label: "Watchlist", icon: "watch" },
  { to: "/journal", label: "Journal & Theses", icon: "reports" },
  { to: "/opportunities", label: "Investment Opportunities", icon: "opportunities" },
  { to: "/planner", label: "Wealth Planner", icon: "planner" },
  { section: "Stay informed", to: "/news", label: "Financial News", icon: "news" },
  { to: "/alerts", label: "Alerts", icon: "alerts" },
  { to: "/learn", label: "Learning Center", icon: "learn" },
  { to: "/reports", label: "Reports", icon: "reports" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

export function App() {
  const [status, setStatus] = useState<{ setupRequired: boolean; user: User | null } | null>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || "dark");
  const [down, setDown] = useState(false);
  const refresh = () => api<{ setupRequired: boolean; user: User | null }>("/auth/status").then((s) => { setDown(false); setStatus(s); }).catch(() => { setDown(true); setTimeout(() => void refresh(), 2500); });
  useEffect(() => { void refresh(); const h = () => setStatus((s) => (s ? { ...s, user: null } : s)); window.addEventListener("ss:unauthorized", h); return () => window.removeEventListener("ss:unauthorized", h); }, []);
  const toggle = () => {
    const t = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem("ss-theme", t); } catch { /* ignore */ }
    setTheme(t);
  };
  if (!status) return down ? <div className="auth-wrap"><Notice tone="warn">Cannot reach the Saphal Stocks server. Make sure it is running (<code>npm run dev</code>); retrying automatically…</Notice></div> : <Loading label="Starting Saphal Stocks" />;
  return (
    <ThemeCtx.Provider value={{ theme, toggle }}>
      {!status.user ? <Auth setup={status.setupRequired} onDone={refresh} /> : <Shell user={status.user} onLogout={refresh} />}
    </ThemeCtx.Provider>
  );
}

function Auth({ setup, onDone }: { setup: boolean; onDone: () => void }) {
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const [confirm, setC] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (setup && password !== confirm) return setErr("Passwords do not match.");
    setBusy(true); setErr(null);
    try { await api(setup ? "/auth/setup" : "/auth/login", { body: { username, password } }); onDone(); } catch (e2) { setErr(e2 instanceof Error ? e2.message : String(e2)); } finally { setBusy(false); }
  };
  return (
    <div className="auth-wrap">
      <form className="card" style={{ width: "min(420px, 100%)", padding: 28 }} onSubmit={submit}>
        <div className="brand" style={{ padding: 0, marginBottom: 18 }}><div className="brand-mark">SS</div><div>Saphal Stocks<small>NEPSE intelligence & wealth planning</small></div></div>
        <h2 style={{ marginBottom: 6 }}>{setup ? "Create your private account" : "Sign in"}</h2>
        <p className="muted small" style={{ marginBottom: 16 }}>{setup ? "This account protects your portfolio and financial profile on this computer. Choose a strong password (10+ characters)." : "Your data stays on this computer."}</p>
        <div className="col">
          <label className="field">Username<input className="input" value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus required /></label>
          <label className="field">Password<input className="input" type="password" value={password} onChange={(e) => setP(e.target.value)} autoComplete={setup ? "new-password" : "current-password"} required /></label>
          {setup && <label className="field">Confirm password<input className="input" type="password" value={confirm} onChange={(e) => setC(e.target.value)} autoComplete="new-password" required /></label>}
          {err && <Notice tone="warn">{err}</Notice>}
          <button className="btn primary" disabled={busy} style={{ justifyContent: "center", padding: 10 }}>{busy ? <span className="spinner" /> : setup ? "Create account" : "Sign in"}</button>
        </div>
      </form>
    </div>
  );
}

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const { theme, toggle } = useTheme();
  const notes = useApi<{ read: number }[]>("/notifications", [loc.pathname]);
  const unread = notes.data?.filter((n) => !n.read).length ?? 0;
  useEffect(() => setOpen(false), [loc.pathname]);
  return (
    <div className="app">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark">SS</div><div>Saphal Stocks<small>Financial command center</small></div></div>
        <nav className="nav">
          {NAV.map((n) => {
            const Icon = I[n.icon];
            return (
              <div key={n.to} style={{ display: "contents" }}>
                {n.section && <div className="nav-section">{n.section}</div>}
                <NavLink to={n.to} end={n.to === "/"}><Icon />{n.label}{n.to === "/alerts" && unread > 0 && <span className="badge down">{unread}</span>}</NavLink>
              </div>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", padding: 14, borderTop: "1px solid var(--border)" }} className="row between">
          <span className="small muted">{user.username}</span>
          <button className="btn ghost sm" onClick={async () => { await api("/auth/logout", { body: {} }); onLogout(); }} title="Sign out"><I.logout /></button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost menu-btn" onClick={() => setOpen(!open)} aria-label="Menu"><I.menu /></button>
          <GlobalSearch />
          <div style={{ marginLeft: "auto" }} className="row">
            <MarketBadge />
            <span className="small faint" title="Asia/Kathmandu">{new Date().toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", weekday: "short", hour: "2-digit", minute: "2-digit" })} NPT</span>
            <button className="btn ghost" onClick={toggle} aria-label="Toggle theme">{theme === "dark" ? <I.sun /> : <I.moon />}</button>
          </div>
        </header>
        <main className="content">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/market" element={<Market />} />
              <Route path="/stocks" element={<Stocks />} />
              <Route path="/stocks/:symbol" element={<StockDetail />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/strategy-lab" element={<StrategyLab />} />
              <Route path="/journal" element={<Journal />} />
              <Route path="/fundamental" element={<Fundamental />} />
              <Route path="/technical" element={<Technical />} />
              <Route path="/analyst" element={<Analyst />} />
              <Route path="/portfolio" element={<Portfolio />} />
              <Route path="/portfolio/:id" element={<Portfolio />} />
              <Route path="/watchlist" element={<Watchlist />} />
              <Route path="/opportunities" element={<Opportunities />} />
              <Route path="/planner" element={<Planner />} />
              <Route path="/news" element={<News />} />
              <Route path="/alerts" element={<Alerts />} />
              <Route path="/learn" element={<Learn />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Notice>Page not found.</Notice>} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}

const ACTIONS: { label: string; hint: string; run: (nav: (p: string) => void, toggle: () => void) => void }[] = [
  { label: "Refresh all market data", hint: "action", run: async () => { await api("/data/refresh", { body: { job: "all" } }); alert("Refresh queued. Progress is on Settings → Data."); } },
  { label: "Toggle dark / light theme", hint: "action", run: (_n, t) => t() },
  { label: "New AI conversation", hint: "action", run: (n) => n("/analyst") },
  { label: "Log a trade in the journal", hint: "action", run: (n) => n("/journal") },
  { label: "Add a portfolio transaction", hint: "action", run: (n) => n("/portfolio") },
  { label: "Check data quality", hint: "action", run: (n) => n("/settings") },
  { label: "Open IPO / right share tracker", hint: "action", run: (n) => n("/opportunities") },
];

function GlobalSearch() {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ symbol: string; name: string; sector: string }[]>([]);
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const { toggle } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q.trim()) { setRes([]); return; }
    const id = setTimeout(() => api<typeof res>(`/search?q=${encodeURIComponent(q.replace(/^>/, ""))}`).then((r) => { setRes(r.slice(0, 8)); setSel(0); }).catch(() => {}), 120);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); box.current?.querySelector("input")?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  const term = q.trim().replace(/^>/, "").toLowerCase();
  const pages = term ? NAV.filter((n) => n.label.toLowerCase().includes(term)).slice(0, 5) : [];
  const actions = term ? ACTIONS.filter((a) => a.label.toLowerCase().includes(term)).slice(0, 4) : [];
  type Item = { key: string; label: string; sub: string; tag: string; go: () => void };
  const items: Item[] = [
    ...res.map((r) => ({ key: "s" + r.symbol, label: r.symbol, sub: r.name, tag: r.sector, go: () => nav(`/stocks/${r.symbol}`) })),
    ...pages.map((p) => ({ key: "p" + p.to, label: p.label, sub: "Go to page", tag: "page", go: () => nav(p.to) })),
    ...actions.map((a) => ({ key: "a" + a.label, label: a.label, sub: "", tag: "action", go: () => a.run(nav, toggle) })),
  ];
  const go = (it: Item) => { setQ(""); setRes([]); it.go(); (document.activeElement as HTMLElement | null)?.blur(); };
  return (
    <div className="search" ref={box}>
      <I.search />
      <input className="input" placeholder="Search stocks, pages or actions (Ctrl/⌘ K)" value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); } if (e.key === "Enter" && items[sel]) go(items[sel]); if (e.key === "Escape") setQ(""); }} />
      {items.length > 0 && (
        <div className="search-results">
          {items.map((it, i) => (
            <button key={it.key} className={i === sel ? "on" : ""} onMouseDown={() => go(it)}>
              <span className={it.tag === "page" || it.tag === "action" ? "" : "mono"} style={{ fontWeight: 600, minWidth: 64 }}>{it.label}</span>
              <span className="muted" style={{ flex: 1 }}>{it.sub}</span>
              <span className="tiny faint">{it.tag}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MarketBadge() {
  const m = useApi<{ session: string; live: boolean; lastUpdate: string | null; dataDate: string | null; holiday: boolean; note: string; hours: string }>("/market/status");
  useEffect(() => { const id = setInterval(() => m.reload(), 60_000); return () => clearInterval(id); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!m.data) return null;
  const d = m.data;
  const label = d.session === "open" ? (d.live ? "Market open · live" : "Market open") : d.session === "pre-open" ? "Opens 11:00" : d.holiday ? "No trading today" : "Market closed";
  const mins = d.lastUpdate ? Math.round((Date.now() - Date.parse(d.lastUpdate)) / 60000) : null;
  return (
    <span className="badge" title={`${d.note} Hours ${d.hours}. Data date ${d.dataDate ?? "—"}.`} style={{ gap: 6 }}>
      <span className="dot" style={{ background: d.session === "open" ? "var(--up)" : d.session === "pre-open" ? "var(--warn)" : "var(--text-3)" }} />
      {label}{d.session === "open" && mins != null ? ` · ${mins} min ago` : ""}
    </span>
  );
}
