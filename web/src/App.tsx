import { createContext, useContext, useEffect, useRef, useState, lazy, Suspense, type FormEvent } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, useApi } from "./lib/api.ts";
import { I } from "./components/icons.tsx";
import { Loading, Notice } from "./components/ui.tsx";
import { BROWSER_BACKEND, backendState, onBackendEvent } from "./lib/backend.ts";
import { VERSION, CODE, NOTES } from "./version.ts";
import { check as checkUpdate, update as applyUpdate, justUpdated, type Release } from "./lib/update.ts";
import { DEFAULT_PREFS, applyPrefs, cachePrefs, cachedPrefs, onSystemThemeChange, resolveTheme, type Prefs } from "./lib/prefs.ts";

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
const PrefsCtx = createContext<{ prefs: Prefs; save: (p: Prefs) => void }>({ prefs: DEFAULT_PREFS, save: () => {} });
export const usePrefs = () => useContext(PrefsCtx);
export { NAV };

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

function BootScreen({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState(backendState);
  useEffect(() => onBackendEvent(() => setSt({ ...backendState })), []);
  if (!BROWSER_BACKEND || st.status === "ready") return <>{children}</>;
  return (
    <div className="auth-wrap">
      <div className="card" style={{ width: "min(420px, 100%)", padding: 28, textAlign: "center" }}>
        <div className="brand" style={{ padding: 0, justifyContent: "center", marginBottom: 16 }}><div className="brand-mark">SS</div><div style={{ textAlign: "left" }}>Saphal Stocks<small>NEPSE intelligence & wealth planning</small></div></div>
        {st.status === "error" ? (
          <><Notice tone="warn">{st.message}</Notice><button className="btn primary" style={{ marginTop: 12 }} onClick={() => location.reload()}>Try again</button></>
        ) : (
          <><div className="row" style={{ justifyContent: "center" }}><span className="spinner" /> <span className="muted">{st.message}</span></div>
            <p className="tiny faint" style={{ marginTop: 12 }}>The first start downloads about 13 MB of market data. After that the app opens instantly and works offline; new data downloads in the background.</p></>
        )}
      </div>
    </div>
  );
}

export function App() {
  return <BootScreen><AppInner /></BootScreen>;
}

function AppInner() {
  const [status, setStatus] = useState<{ setupRequired: boolean; user: User | null } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(cachedPrefs);
  const [theme, setTheme] = useState(resolveTheme(prefs.theme));
  const [down, setDown] = useState(false);
  const refresh = () => api<{ setupRequired: boolean; user: User | null }>("/auth/status").then((s) => { setDown(false); setStatus(s); }).catch(() => { setDown(true); setTimeout(() => void refresh(), 2500); });
  useEffect(() => { void refresh(); const h = () => setStatus((s) => (s ? { ...s, user: null } : s)); window.addEventListener("ss:unauthorized", h); return () => window.removeEventListener("ss:unauthorized", h); }, []);
  const save = (p: Prefs) => { setPrefs(p); setTheme(applyPrefs(p)); cachePrefs(p); void api("/settings/appearance", { method: "PUT", body: p }).catch(() => {}); };
  useEffect(() => { api<Partial<Prefs>>("/settings/appearance").then((r) => { if (r && Object.keys(r).length) { const p = { ...DEFAULT_PREFS, ...r }; setPrefs(p); setTheme(applyPrefs(p)); cachePrefs(p); } }).catch(() => {}); }, []);
  useEffect(() => onSystemThemeChange(() => { if (prefs.theme === "auto") setTheme(applyPrefs(prefs)); }), [prefs]);
  const toggle = () => save({ ...prefs, theme: theme === "dark" ? "light" : "dark" });
  if (!status) return down ? <div className="auth-wrap"><Notice tone="warn">Cannot reach the Saphal Stocks server. Make sure it is running (<code>npm run dev</code>); retrying automatically…</Notice></div> : <Loading label="Starting Saphal Stocks" />;
  return (
    <PrefsCtx.Provider value={{ prefs, save }}>
      <ThemeCtx.Provider value={{ theme, toggle }}>
        {!status.user ? <Auth setup={status.setupRequired} onDone={refresh} /> : <Shell user={status.user} onLogout={refresh} />}
      </ThemeCtx.Provider>
    </PrefsCtx.Provider>
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
  const { prefs } = usePrefs();
  const navigate = useNavigate();
  const notes = useApi<{ read: number }[]>("/notifications", [loc.pathname]);
  const unread = notes.data?.filter((n) => !n.read).length ?? 0;
  useEffect(() => setOpen(false), [loc.pathname]);
  // Open on the chosen start page once per launch.
  useEffect(() => {
    if (prefs.landing && prefs.landing !== "/" && loc.pathname === "/" && !sessionStorage.getItem("ss-landed")) navigate(prefs.landing, { replace: true });
    try { sessionStorage.setItem("ss-landed", "1"); } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Encrypted sync: catch up when the app opens or comes back to the foreground.
  useEffect(() => {
    if (!BROWSER_BACKEND) return;
    let off = () => {};
    import("./lib/sync.ts").then((m) => {
      m.onSyncPulled(() => location.reload());
      m.scheduleAutoSync(1500);
      const vis = () => { if (document.visibilityState === "visible") m.scheduleAutoSync(1000); };
      document.addEventListener("visibilitychange", vis);
      off = () => document.removeEventListener("visibilitychange", vis);
    });
    return () => off();
  }, []);
  const nav = NAV.filter((n) => n.to === "/" || n.to === "/settings" || !prefs.hiddenNav.includes(n.to));
  return (
    <div className="app">
      <aside className={`sidebar ${open ? "open" : ""}`}>
        <div className="brand"><div className="brand-mark">SS</div><div className="nav-label">Saphal Stocks<small>Financial command center</small></div></div>
        <nav className="nav">
          {nav.map((n) => {
            const Icon = I[n.icon];
            return (
              <div key={n.to} style={{ display: "contents" }}>
                {n.section && <div className="nav-section">{n.section}</div>}
                <NavLink to={n.to} end={n.to === "/"} title={n.label}><Icon /><span className="nav-label">{n.label}</span>{n.to === "/alerts" && unread > 0 && <span className="badge down">{unread}</span>}</NavLink>
              </div>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", padding: 14, borderTop: "1px solid var(--border)" }} className="row between">
          <span className="small muted nav-label" title="App version and build code">{BROWSER_BACKEND ? "On this device" : user.username}<br /><span className="faint">v{VERSION} · {CODE}</span></span>
          {!BROWSER_BACKEND && <button className="btn ghost sm" onClick={async () => { await api("/auth/logout", { body: {} }); onLogout(); }} title="Sign out"><I.logout /></button>}
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="btn ghost menu-btn" onClick={() => setOpen(!open)} aria-label="Menu"><I.menu /></button>
          <GlobalSearch />
          <div style={{ marginLeft: "auto" }} className="row">
            <MarketBadge />
            <span className="small faint clock" title="Asia/Kathmandu">{new Date().toLocaleString("en-GB", { timeZone: "Asia/Kathmandu", weekday: "short", hour: "2-digit", minute: "2-digit" })} NPT</span>
            <button className="btn ghost" onClick={toggle} aria-label="Toggle theme">{theme === "dark" ? <I.sun /> : <I.moon />}</button>
          </div>
        </header>
        {open && <div className="scrim" onClick={() => setOpen(false)} />}
        <AppUpdateBanner />
        <DataUpdateBanner />
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
      <nav className="bottombar" aria-label="Main">
        {prefs.bottomBar.slice(0, 4).map((to) => NAV.find((n) => n.to === to)).filter(Boolean).map((n) => {
          const Icon = I[n!.icon];
          return <NavLink key={n!.to} to={n!.to} end={n!.to === "/"}><Icon /><span>{n!.label.replace(" Analysis", "").replace("AI Stock Analyst", "AI Analyst").replace("NEPSE Market", "Market").replace("Investment Opportunities", "Invest")}</span></NavLink>;
        })}
        <button onClick={() => setOpen(!open)} className={open ? "active" : ""}><I.menu /><span>More{unread > 0 ? ` (${unread})` : ""}</span></button>
      </nav>
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
      <input className="input" placeholder={typeof window !== "undefined" && window.innerWidth < 600 ? "Search stocks or pages" : "Search stocks, pages or actions (⌘ K)"} value={q} onChange={(e) => setQ(e.target.value)}
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

function AppUpdateBanner() {
  const [behind, setBehind] = useState<Release | null>(null);
  const [updated, setUpdated] = useState(() => justUpdated());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const run = async () => { const c = await checkUpdate(); setBehind(c.state === "behind" ? c.release : null); };
    void run();
    const id = setInterval(run, 30 * 60_000);
    const vis = () => { if (document.visibilityState === "visible") void run(); };
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", vis); };
  }, []);
  const bar = { position: "sticky" as const, top: 0, zIndex: 41, padding: "8px 16px", background: "var(--accent-soft)", borderBottom: "1px solid var(--border)" };
  if (behind) return (
    <div style={bar} className="row between small">
      <span>Version {behind.version} (code {behind.code}) is available. You have {VERSION} ({CODE}).</span>
      <span className="row"><button className="btn sm primary" disabled={busy} onClick={() => { setBusy(true); void applyUpdate(); }}>{busy ? <span className="spinner" /> : "Update now"}</button><button className="btn sm ghost" onClick={() => setBehind(null)}>Later</button></span>
    </div>
  );
  if (updated) return (
    <div style={bar} className="row between small">
      <span>Updated to version {VERSION} ({CODE}). {NOTES[0]}</span>
      <button className="btn sm ghost" onClick={() => setUpdated(false)}>OK</button>
    </div>
  );
  return null;
}

function DataUpdateBanner() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => onBackendEvent((e) => { if (e.type === "data-updated") setMsg(e.message ?? "New market data loaded."); }), []);
  if (!msg) return null;
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 40, padding: "8px 16px", background: "var(--accent-soft)", borderBottom: "1px solid var(--border)" }} className="row between small">
      <span>{msg}</span>
      <span className="row"><button className="btn sm primary" onClick={() => location.reload()}>Show latest</button><button className="btn sm ghost" onClick={() => setMsg(null)}>Later</button></span>
    </div>
  );
}
