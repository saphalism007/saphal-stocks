import { createContext, useContext, useEffect, useRef, useState, lazy, Suspense, Fragment, type FormEvent } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { api, useApi } from "./lib/api.ts";
import { nptDate, num } from "./lib/format.ts";
import { searchFeatures } from "../../shared/search.ts";
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
const Growth = lazy(() => import("./pages/Growth.tsx"));
const Calculators = lazy(() => import("./pages/Calculators.tsx"));
const Discover = lazy(() => import("./pages/Discover.tsx"));
const Picks = lazy(() => import("./pages/Picks.tsx"));
const Purchases = lazy(() => import("./pages/Purchases.tsx"));
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
const Money = lazy(() => import("./pages/Money.tsx"));
const Invest = lazy(() => import("./pages/Invest.tsx"));
const Monitor = lazy(() => import("./pages/Monitor.tsx"));
const Trading = lazy(() => import("./pages/Trading.tsx"));
const Future = lazy(() => import("./pages/Future.tsx"));
const Signals = lazy(() => import("./pages/Signals.tsx"));
const Results = lazy(() => import("./pages/Results.tsx"));
const Floorsheet = lazy(() => import("./pages/Floorsheet.tsx"));
const Ipo = lazy(() => import("./pages/Ipo.tsx"));
const Start = lazy(() => import("./pages/Start.tsx"));
const Terminal = lazy(() => import("./pages/Terminal.tsx"));

interface User { id: number; username: string }
const ThemeCtx = createContext<{ theme: string; toggle: () => void }>({ theme: "dark", toggle: () => {} });
export const useTheme = () => useContext(ThemeCtx);
const PrefsCtx = createContext<{ prefs: Prefs; save: (p: Prefs) => void }>({ prefs: DEFAULT_PREFS, save: () => {} });
export const usePrefs = () => useContext(PrefsCtx);
export { NAV };

const NAV: { section?: string; to: string; label: string; icon: keyof typeof I }[] = [
  { to: "/", label: "Dashboard", icon: "overview" },
  { to: "/growth", label: "My Growth", icon: "check" },
  { section: "Trading", to: "/picks", label: "Invest or Trade?", icon: "fundamental" },
  { to: "/trading", label: "Trading Opportunities", icon: "technical" },
  { to: "/stocks", label: "Stock Analysis", icon: "stocks" },
  { to: "/signals", label: "Technical Signals", icon: "market" },
  { to: "/terminal", label: "Chart Terminal", icon: "technical" },
  { to: "/discover", label: "Market Mood & Baskets", icon: "market" },
  { to: "/fundamental", label: "Fundamentals", icon: "fundamental" },
  { to: "/results", label: "Quarterly Results", icon: "reports" },
  { to: "/compare", label: "Compare", icon: "fundamental" },
  { to: "/analyst", label: "AI Analyst", icon: "ai" },
  { to: "/strategy-lab", label: "Strategy Lab", icon: "refresh" },
  { section: "My Portfolio", to: "/portfolio", label: "Portfolio", icon: "portfolio" },
  { to: "/watchlist", label: "Watchlist", icon: "watch" },
  { to: "/journal", label: "Journal & Theses", icon: "reports" },
  { section: "Wealth", to: "/start", label: "Start Investing", icon: "check" },
  { to: "/money", label: "Wealth Management", icon: "money" },
  { to: "/invest", label: "Investment Planner", icon: "invest" },
  { to: "/future", label: "Long-Term Investing", icon: "planner" },
  { to: "/purchases", label: "Purchase Planner", icon: "money" },
  { to: "/calculators", label: "Money Calculators", icon: "planner" },
  { to: "/planner", label: "Goals & Planning", icon: "planner" },
  { to: "/opportunities", label: "Investment Directory", icon: "opportunities" },
  { section: "Market & Updates", to: "/monitor", label: "Market Monitor", icon: "monitor" },
  { to: "/market", label: "NEPSE Market", icon: "market" },
  { to: "/ipo", label: "IPO & FPO", icon: "opportunities" },
  { to: "/floorsheet", label: "Floorsheet", icon: "stocks" },
  { to: "/news", label: "Financial News", icon: "news" },
  { to: "/reports", label: "Audit Reports", icon: "reports" },
  { to: "/alerts", label: "Alerts", icon: "alerts" },
  { to: "/learn", label: "Learning Center", icon: "learn" },
  { to: "/settings", label: "Settings", icon: "settings" },
];

function BootScreen({ children }: { children: React.ReactNode }) {
  const [st, setSt] = useState(backendState);
  useEffect(() => onBackendEvent(() => setSt({ ...backendState })), []);
  // On phones page descriptions show two lines; tap to read the rest.
  useEffect(() => { const h = (e: MouseEvent) => { const p = (e.target as HTMLElement | null)?.closest?.(".page-head p"); if (p && !(e.target as HTMLElement).closest("a,button")) p.classList.toggle("open"); }; document.addEventListener("click", h); return () => document.removeEventListener("click", h); }, []);
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
        <AskAiButton />
        <AppUpdateBanner />
        <DataUpdateBanner />
        <main className="content">
          <Suspense fallback={<Loading />}>
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/market" element={<Market />} />
              <Route path="/money" element={<Money />} />
              <Route path="/invest" element={<Invest />} />
              <Route path="/monitor" element={<Monitor />} />
              <Route path="/trading" element={<Trading />} />
              <Route path="/future" element={<Future />} />
              <Route path="/signals" element={<Signals />} />
              <Route path="/results" element={<Results />} />
              <Route path="/floorsheet" element={<Floorsheet />} />
              <Route path="/ipo" element={<Ipo />} />
              <Route path="/start" element={<Start />} />
              <Route path="/terminal" element={<Terminal />} />
              <Route path="/terminal/:symbol" element={<Terminal />} />
              <Route path="/stocks" element={<Stocks />} />
              <Route path="/stocks/:symbol" element={<StockDetail />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/strategy-lab" element={<StrategyLab />} />
              <Route path="/journal" element={<Journal />} />
              <Route path="/growth" element={<Growth />} />
              <Route path="/calculators" element={<Calculators />} />
              <Route path="/discover" element={<Discover />} />
              <Route path="/picks" element={<Picks />} />
              <Route path="/purchases" element={<Purchases />} />
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
  type Res = { stocks: { symbol: string; name: string; sector: string | null; price: number | null; changePct: number | null; why: string }[]; sectors: { sector: string; n: number }[]; news: { id: number; title: string; url: string; symbol: string | null; published_date: string }[]; intent: { label: string; sample: string } | null };
  const [res, setRes] = useState<Res | null>(null);
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const { toggle } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!q.trim()) { setRes(null); return; }
    const id = setTimeout(() => api<Res>(`/search/all?q=${encodeURIComponent(q.replace(/^>/, ""))}`).then((r) => { setRes(r); setSel(0); }).catch(() => {}), 90);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); box.current?.querySelector("input")?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  useEffect(() => { const h = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", h); return () => document.removeEventListener("pointerdown", h); }, []);
  const term = q.trim().replace(/^>/, "");
  const features = term ? searchFeatures(term, 4) : [];
  const actions = term.length >= 2 ? ACTIONS.filter((a) => a.label.toLowerCase().includes(term.toLowerCase())).slice(0, 3) : [];
  type Item = { key: string; group: string; label: string; sub: string; tag: string; go: () => void; extra?: { label: string; go: () => void }; tone?: number | null };
  const items: Item[] = [];
  if (res) {
    for (const sc of res.sectors) items.push({ key: "c" + sc.sector, group: "Sectors", label: sc.sector, sub: `All ${sc.n} listed companies`, tag: "sector", go: () => nav(`/stocks?sector=${encodeURIComponent(sc.sector)}`) });
    for (const r of res.stocks) {
      const to = res.intent ? res.intent.sample.replace("SYM", r.symbol) : `/stocks/${r.symbol}`;
      items.push({ key: "s" + r.symbol, group: res.intent ? `Stocks · ${res.intent.label}` : "Stocks", label: r.symbol, sub: r.name, tag: r.price != null ? `${num(r.price)}${r.changePct != null ? ` ${r.changePct >= 0 ? "+" : ""}${num(r.changePct)}%` : ""}` : r.sector ?? "", tone: r.changePct, go: () => nav(to), extra: res.intent ? undefined : { label: "Chart", go: () => nav(`/terminal/${r.symbol}`) } });
    }
  }
  for (const f of features) items.push({ key: "f" + f.to, group: "Pages & tools", label: f.label, sub: "", tag: "open", go: () => nav(f.to) });
  for (const a of actions) items.push({ key: "a" + a.label, group: "Pages & tools", label: a.label, sub: "", tag: "action", go: () => a.run(nav, toggle) });
  for (const n of res?.news ?? []) items.push({ key: "n" + n.id, group: "News", label: n.title, sub: `${n.symbol ? n.symbol + " · " : ""}${n.published_date}`, tag: "news", go: () => (n.symbol ? nav(`/stocks/${n.symbol}?tab=notices`) : window.open(n.url, "_blank", "noopener")) });
  if (term.length >= 2) items.push({ key: "ai", group: "Ask", label: `Ask AI: “${term}”`, sub: "Get an answer using the app's data", tag: "AI", go: () => nav(`/analyst?q=${encodeURIComponent(term)}`) });
  const go = (it: Item) => { setQ(""); setRes(null); setOpen(false); it.go(); (document.activeElement as HTMLElement | null)?.blur(); };
  let lastGroup = "";
  return (
    <div className="search" ref={box}>
      <I.search />
      <input className="input" type="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" autoCapitalize="none" spellCheck={false}
        placeholder={typeof window !== "undefined" && window.innerWidth < 600 ? "Search stocks, tools…" : "Search stocks, sectors, tools, news (⌘ K)"} value={q}
        onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)); } if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); } if (e.key === "Enter" && items[sel]) go(items[sel]); if (e.key === "Escape") { setQ(""); setOpen(false); } }} />
      {open && items.length > 0 && (
        <div className="search-results" role="listbox">
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="sr-head" key={`h${it.group}`}>{it.group}</div> : null; lastGroup = it.group;
            return (
              <Fragment key={it.key}>
                {head}
                <div className={`sr-row ${i === sel ? "on" : ""}`}>
                  <button className="sr-main" onPointerDown={(e) => e.preventDefault()} onClick={() => go(it)} onMouseEnter={() => setSel(i)}>
                    <span className={`sr-label ${it.group.startsWith("Stocks") ? "mono" : ""}`}>{it.label}</span>
                    {it.sub && <span className="sr-sub">{it.sub}</span>}
                  </button>
                  <span className={`sr-tag ${it.tone == null ? "" : it.tone >= 0 ? "up" : "down"}`}>{it.tag}</span>
                  {it.extra && <button className="btn sm ghost sr-extra" onPointerDown={(e) => e.preventDefault()} onClick={() => { setQ(""); setRes(null); setOpen(false); it.extra!.go(); }}>{it.extra.label}</button>}
                </div>
              </Fragment>
            );
          })}
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
      <span className="hide-phone">{label}{d.session === "open" && mins != null ? (mins <= 90 ? ` · ${mins} min ago` : d.dataDate ? ` · prices from ${nptDate(d.dataDate)}` : "") : ""}</span><span className="show-phone">{d.session === "open" ? "Open" : d.session === "pre-open" ? "11:00" : "Closed"}</span>
    </span>
  );
}

/** Global assistant: ask from any page; the question carries the page you are on. */
function AskAiButton() {
  const loc = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  if (loc.pathname.startsWith("/analyst")) return null;
  const sym = loc.pathname.match(/^\/stocks\/([A-Z0-9]+)/)?.[1];
  const where = sym ? `${sym}` : NAV.find((n) => n.to !== "/" && loc.pathname.startsWith(n.to))?.label ?? "Overview";
  const ideas = sym ? [`Is ${sym} worth buying now? Entry, stop-loss and targets`, `${sym} fundamentals vs its sector`] : loc.pathname.startsWith("/money") || loc.pathname.startsWith("/invest") || loc.pathname.startsWith("/planner")
    ? ["Where should I put Rs 5 lakh?", "I can save Rs 30,000 a month. How should I invest it?", "Which bank has the best fixed deposit rate?", "Should I pay off my loan or invest?"]
    : ["Which stocks are near support?", "Which stocks have breakout potential?", "Which stocks should I avoid?", "What happened in NEPSE today?"];
  const go = (text: string) => { setOpen(false); setQ(""); navigate(`/analyst?q=${encodeURIComponent(sym && !text.includes(sym) ? `${text} (about ${sym})` : text)}`); };
  return (
    <>
      <button className="ai-fab" onClick={() => setOpen(!open)} aria-label="Ask AI"><I.ai /><span>Ask AI</span></button>
      {open && (
        <div className="ai-pop" role="dialog" aria-label="Ask the AI assistant">
          <div className="small muted" style={{ marginBottom: 6 }}>Ask about NEPSE or your money · on {where}</div>
          <form onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(q.trim()); }} className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input" autoFocus style={{ flex: 1 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a question" />
            <button className="btn primary" disabled={!q.trim()}><I.send /></button>
          </form>
          <div className="col" style={{ gap: 4, marginTop: 8 }}>{ideas.map((x) => <button key={x} className="btn ghost sm" style={{ justifyContent: "flex-start", textAlign: "left" }} onClick={() => go(x)}>{x}</button>)}</div>
        </div>
      )}
    </>
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
  const loc = useLocation();
  useEffect(() => onBackendEvent((e) => { if (e.type === "data-updated") setMsg(e.message ?? "New market data loaded."); }), []);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 20_000); return () => clearTimeout(t); }, [msg]);
  if (!msg || loc.pathname.startsWith("/terminal")) return null; // the chart terminal updates itself
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 40, padding: "8px 16px", background: "var(--accent-soft)", borderBottom: "1px solid var(--border)" }} className="row between small">
      <span>{msg}</span>
      <span className="row"><button className="btn sm primary" onClick={() => location.reload()}>Show latest</button><button className="btn sm ghost" onClick={() => setMsg(null)}>Later</button></span>
    </div>
  );
}
