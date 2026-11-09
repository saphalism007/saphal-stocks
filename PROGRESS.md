# Progress

Status as of 8 November 2026 (version 0.5.0). ✅ working · 🟡 partial · ⬜ not started.

## Data infrastructure
- ✅ Company database, daily OHLCV history (nepse-data), latest prices, 18 indices, dividends, announcements, quarterly statements, NRB forex
- ✅ Scheduled daily refresh (15:45 NPT) + refresh on start-up when data is stale; manual refresh per dataset
- ✅ Validation, idempotent upserts, retries with backoff, run log, per-dataset freshness and error tracking
- ✅ Bonus-share and right-share price adjustment (evidence-based: applied only when the expected ex-date gap is found)
- ✅ Data quality monitor: impossible OHLC, stale/suspended stocks, unexplained moves beyond the daily band, unbalanced balance sheets, outdated or missing statements, price/index date mismatch
- 🟡 Statement history accumulates from now on (source offers only the latest quarter)
- ✅ Live (delayed) price refresh every 5 minutes during market hours on trading days, with holiday detection; market status badge; provisional-bar warning on stock pages
- ⬜ Tick-by-tick intraday data (no permitted source)

- ✅ Public issues (IPO/FPO/rights/quotas) and listed mutual fund NAVs, refreshed daily
- ✅ Daily scheduler remembers its last run across restarts

## Market & stocks
- ✅ Economy: one year of official NRB exchange rates, USD/NPR chart, 1M/1Y changes for major and remittance currencies
- ✅ Total market capitalisation; sector rotation table (1W–1Y returns, relative to NEPSE, distance from 52-week high)
- ✅ Sector peers on every stock page with rank among peers
- ✅ Stock comparison page (up to 6 stocks): rebased price chart, valuation, profitability, health, dividends, performance, best-in-row highlighting, cross-sector warning
- ✅ Market dashboard: indices, breadth, turnover, gainers/losers, turnover/volume leaders, 52-week highs/lows, sector performance and sub-index heat map, NEPSE trend, breadth history
- ✅ Stocks list and screener (valuation, ROE, yield, trend, liquidity, scores) with built-in presets and saved screens
- ✅ Command palette (Ctrl/⌘ K): stocks, pages and actions
- ✅ Company research page: summary verdict, chart, technicals, support/resistance, fundamentals, statements, dividends, announcements, backtest; watch and alert shortcuts
- 🟡 Company profile has no management/board/major shareholder data (not available from the current source)

## Technical analysis
- ✅ All requested indicators, chart overlays and indicator panes
- ✅ Support/resistance engine with reasons, reaction counts, volume confirmation, invalidation; demand/supply zones; dynamic levels; pivots; Fibonacci
- ✅ Algorithmic pattern detection with per-stock historical track record
- ✅ Rule-based setups (breakout, pullback, momentum, oversold bounce, trend continuation, breakdown, overbought at resistance) with all required fields, net-of-cost returns
- ✅ Backtester with Nepal costs and CGT, 7 strategies, equity curve, trades on chart
- ✅ Strategy Lab, shared-capital mode: one account, max simultaneous positions, equal slices of equity, signal ranking by liquidity or momentum, equity vs NEPSE
- ✅ Strategy Lab: one strategy across many stocks (liquid, sector, all, or a list), median return vs buy & hold, % of stocks beaten, pooled win rate, profit factor, drawdown, trade-return histogram

## Fundamental analysis
- ✅ Ratios computed from statement line items (EPS, BVPS, ROE, ROA, P/E, P/B, Graham number, margins, D/E, interest cover, NIM, cost-to-income, ...) next to the company's reported figures
- ✅ Sector-specific scoring models (banks/finance, microfinance, insurance, hydropower, general)
- ✅ Strategy rankings with editable weights: quality, value, dividend, growth, momentum, swing, long-term, risk-adjusted, avoid, deteriorating
- ✅ Valuation: Graham, DDM, DCF, relative to sector medians
- ✅ Dividend sustainability: cash and total payout ratios, unsustainable-payout red flag, bonus-dilution note
- 🟡 Cash-flow statements are not provided by the source; earnings-quality and fraud red-flag checks are basic

## AI
- ✅ Tool-using analyst (15 tools over the database and engines), conversation history, configurable provider/model/effort, refusal fallback
- ✅ Works without an API key in rule-based data-report mode
- ✅ PDF document upload, page-level indexing and search; AI cites document and page
- ✅ "Explain" for any announcement/news headline
- 🟡 Not tested against the live API in this session (no API key configured); code follows the official SDK documentation
- ⬜ OCR for scanned PDFs

## Portfolio
- ✅ Multiple portfolios, all transaction types (buy, sell, IPO, right, bonus, cash dividend, merger), auto Nepal charges or manual override, CGT on sells
- ✅ WACC, realised/unrealised P&L, dividends, net-if-sold-today, allocation, sector exposure, health score
- ✅ Paper trading with simulated cash; CSV import
- ✅ Performance over time: daily value, time-weighted return vs NEPSE index, max drawdown
- ✅ Rebalancing planner: target weights (equal-weight and 20% cap shortcuts), new cash, minimum trade size, whole-share trades with Nepal charges and estimated CGT
- ✅ Tax report by Nepali fiscal year (realised gains/losses, CGT actual or estimated, dividends and dividend tax) and CSV exports (holdings, transactions, tax)
- ✅ Trading journal (plan vs outcome, emotions, plan followed, results by setup, average R, net of fees and CGT) and investment thesis tracker (thesis, catalysts, metrics, invalidation, review dates, price since thesis, AI review)
- 🟡 No automatic import from Mero Share (no public API)

## Wealth
- ✅ Encrypted financial profile; goals with inflation, costs, tax, three scenarios, Monte Carlo probability; car purchase planner; lump-sum allocation; net worth tracker
- ✅ 13 calculators (EMI, SIP, FD, inflation, emergency fund, FI, trade cost/CGT, position size, risk/reward, DCF, DDM, Graham)
- ✅ IPO/FPO/right issue tracker with open/upcoming status and historical IPO listing statistics; close-ended mutual fund comparison (NAV, premium/discount, maturity)
- ✅ Investment products directory (18 product types) and official resources directory with link checker; record verified rates
- 🟡 Product rates are not fetched automatically (by design; see DATA_SOURCES.md)

## Alerts, news, education
- ✅ 18 alert types, evaluated after every data refresh, de-duplicated per data date
- ✅ Automatic reminders (no setup): thesis reviews due, and monthly goal on-track / behind-plan checks
- ✅ Daily briefing on the Overview page (all six questions), customizable (show/hide, reorder sections)
- ✅ News and announcements feed with categories and AI explanation
- ✅ Learning center: 16 Nepal-focused lessons
- ✅ macOS desktop notifications for alerts and reminders (toggle + test on the Alerts page)
- ⬜ Email/phone push notifications

## Web app for iPhone, iPad and Mac (v0.6)
- ✅ Installable web app (PWA): home-screen/Dock icon, full-screen, works offline (service worker precaches every file; data in IndexedDB)
- ✅ In-browser backend: the same server routes and engines run in a Web Worker on sql.js, so numbers match the local server exactly
- ✅ Market snapshot (prices from 2008, statements, dividends, issues, funds, news) downloaded once and refreshed when a newer one is published; near-live quotes overlay during market hours
- ✅ Encrypted sync between devices through a secret GitHub Gist (AES-256-GCM, passphrase never leaves the device), with conflict choice
- ✅ Device backup download/restore (AI key excluded)
- ✅ Appearance settings per device: theme, accent, text size, density, number style, start page, menu items, phone tab bar, sidebar rail, chart defaults
- ✅ Layouts checked at iPhone Pro Max (440×956), iPad Pro 13" (1032×1376) and MacBook Air 13" sizes: phone tab bar and bottom-sheet dialogs, tablet rail, safe areas, 16 px inputs (no iOS zoom), larger touch targets
- ✅ GitHub Actions pipeline: daily full refresh, 15-minute price refresh in market hours, tests, build, deploy to GitHub Pages
- ⬜ Background alerts on iOS (web apps cannot run in the background; alerts are checked when the app opens)

## Running it
- ✅ Double-click launcher (`Start Saphal Stocks.command`) that installs, builds when needed and opens the browser; `Start on Wi-Fi.command` for phone access on a home network
- ✅ Production mode serves the web app and API from one port with CSP and security headers

## Security
- ✅ Automatic daily database backups (7 kept, `BACKUP_KEEP_DAYS`)
- ✅ Local-only server, scrypt passwords, secure cookies, rate-limited login, origin checks, input validation, AES-256-GCM for personal data, export, backup, deletion

## Roadmap (next)
1. Run with an API key and tune the analyst prompt on real questions.
2. Cash-flow and multi-year annual statements from uploaded annual reports (AI extraction into structured tables).
3. Historical valuation bands (P/E and P/B over time) as quarterly history accumulates.
4. Open-ended mutual fund NAVs (needs a source; managers publish on their own sites).
5. Interest rates and other NRB macro indicators (needs a verified source).
6. Create the GitHub repository, turn on Pages (source: GitHub Actions) and install on all three devices.
7. Precompute setups and data-quality results in the snapshot so those pages open instantly on the phone.
