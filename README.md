# Saphal Stocks

A personal financial intelligence platform for Nepal: NEPSE market data and research, technical and fundamental analysis engines, stock comparison, a multi-stock Strategy Lab, an AI stock analyst that reasons over the platform's own data, portfolio management with Nepal fees and taxes, a trading journal and thesis tracker, an IPO and mutual fund tracker, and a wealth planner.

It runs in two ways:

- **Web app (main way, v0.6+)**: an installable app on GitHub Pages for iPhone, iPad and Mac. All calculations run on the device; your personal data is stored on the device and can be synced between your devices, encrypted, through your own GitHub account. Market data is refreshed by GitHub Actions and downloaded by the app.
- **Local server**: the original Node.js version on your Mac (below), which fetches data itself.

Market data comes from public sources (see [DATA_SOURCES.md](DATA_SOURCES.md)).

## Use it on iPhone, iPad and Mac

Once the repository is on GitHub with Pages turned on, the app lives at `https://<your-github-name>.github.io/saphal-stocks/`.

| Device | Install |
|---|---|
| iPhone / iPad (Safari) | Open the address → Share button → **Add to Home Screen** → Add. Open it from the home-screen icon. |
| Mac (Safari) | Open the address → File → **Add to Dock**. |
| Mac (Chrome/Edge) | Open the address → install icon in the address bar. |

The first start downloads the market snapshot (about 13 MB), then the app works offline. When a newer snapshot exists, a banner offers to load it (**Settings → Data → Check for new data**).

Tips:

- Use the home-screen/Dock app, not a normal Safari tab. Safari can clear data of websites you have not visited for a while; installed apps keep it.
- **Settings → Appearance** has theme, accent colour, text size, density, number style (lakh/crore or million), start page, which menu items show, the phone tab bar and chart defaults. Each device keeps its own appearance.
- **Settings → Sync & devices** syncs portfolios, transactions, watchlists, journal, goals, alerts and settings between iPhone, iPad and Mac. It needs a GitHub token with only the `gist` permission and a passphrase you choose; data is encrypted on the device (AES-256-GCM, PBKDF2 310,000 rounds) and stored in a secret Gist. Use the same token and passphrase on each device.
- **Settings → Security & privacy → Download backup** saves a file of your personal data; keep one now and then.
- The AI analyst needs your Anthropic API key in **Settings → AI** on each device. The key stays on that device and is never synced or put in backups. Without a key, the analyst works in data-report mode.
- Alerts are checked while the app is open (iOS does not let web apps run in the background).

### How the data gets updated

`.github/workflows/data-and-deploy.yml` runs on GitHub's servers:

| When (Nepal time) | What |
|---|---|
| Trading days (Mon–Fri) about 16:00 | Full refresh (prices, history, indices, company details in rotation, news, issues, funds, forex), tests, build, deploy |
| Every 15 minutes, about 10:45–15:45 on trading days | Latest prices only (`live.json`), so the app shows near-live quotes |
| Push to `main`, or **Actions → Run workflow** | Build and deploy (choose `daily`, `intraday` or `build`) |

The database is kept between runs in the Actions cache. Your personal data never goes to the repository.

### Developer commands for the web app

```bash
npm run dev            # web app with the in-browser backend (needs web/public/data, see below)
npm run export-data    # make web/public/data/market.db.bin + manifest.json from data/saphal.db
npm run build          # production build in dist/ (set BASE_PATH=/saphal-stocks/ for GitHub Pages)
npm run serve:pages    # serve dist/ like GitHub Pages at http://localhost:5186/saphal-stocks/
npm run deploy         # release: bump version, test, build, commit, push, wait until live, print TALLY
```

### Versions and updates

`web/src/version.ts` holds the version, release date and notes. `npm run deploy` raises the version one step unless it was changed by hand, pushes, waits until the live site serves the new commit, and prints a line such as `TALLY  Version 0.6.2  Code 1A2B3C  Released 2026-11-10`. The app shows the same version and code in the sidebar and on **Settings → About & updates**, checks `version.json` when it opens and every 30 minutes, and offers **Update now** when a newer version is live.

The workflow file only calls the project's own scripts (`npm run ingest`, `scripts/export-*.ts`, `npm test`, `npm run build`), so app and data changes never need to touch it.

## Local server (Mac only)

### Easiest way to start

Double-click **Start Saphal Stocks.command** in this folder. The first time it installs and builds (a few minutes), then it opens the app in your browser at http://127.0.0.1:5181. Keep the Terminal window open while you use it; close it to stop.

To use it from your phone on the same home Wi-Fi, double-click **Start on Wi-Fi.command** instead and open the address it prints. Only do this on a trusted network.

### Run it (developer mode)

Needs Node.js 22.13 or newer (it uses Node's built-in SQLite).

```bash
npm install
npm run dev:server
```

Open http://localhost:5180. The first visit asks you to create your private account. The API runs on 127.0.0.1:5181 and the web app on 5180.

On first start the server loads market data in the background (latest prices, about 330 companies' daily history, 18 indices, news, exchange rates, then company profiles, dividends and quarterly statements). Progress shows on **Settings → Data**. Company details take about half an hour because requests are deliberately rate-limited.

Other commands:

| Command | What it does |
|---|---|
| `npm test` | Runs the calculation tests (indicators vs reference values, Nepal fees, WACC, EMI, backtester, levels, patterns, fundamentals, ranking) |
| `npm run typecheck` | TypeScript check |
| `npm run ingest -- all` | Refresh all data from the command line (`listing`, `history`, `indices`, `details`, `news`, `forex`, or `detail NABIL EBL`) |
| `npm run build` then `npm start` | Production build; the API then also serves the web app on 127.0.0.1:5181 |

### Configuration (`.env`, local server only)

Created automatically on first run. Never commit it.

| Key | Meaning |
|---|---|
| `SAPHAL_SECRET_KEY` | 64-hex key that encrypts your financial profile, goals, net worth and journal. Generated on first run. Back it up with your database: without it, encrypted data cannot be read. |
| `API_PORT` | API port (default 5181) |
| `AI_PROVIDER` | `anthropic` or `none` |
| `AI_MODEL` | Default `claude-opus-5-5` |
| `AI_EFFORT` | `low`, `medium` (default), `high`, `xhigh`, `max` |
| `ANTHROPIC_API_KEY` | Your API key (can also be set in Settings → AI) |
| `INGEST_DAILY_AT` | Daily refresh time in Nepal time (default 15:45, after market close) |
| `HOST` | `127.0.0.1` (default, this computer only) or `0.0.0.0` (local network) |
| `INTRADAY_REFRESH_MIN` | Minutes between live price refreshes during market hours, 11:00-15:00 NPT (default 5, 0 = off) |
| `BACKUP_KEEP_DAYS` | Automatic daily backups to keep in `data/backups` (default 7) |

Without an API key the AI Stock Analyst still works in "data report" mode (stock reports, comparisons, rankings, support and breakout scans, portfolio review) and nothing is sent outside your computer.

## What is inside

```
shared/      Pure, tested engines used by both server and web
  indicators.ts   SMA, EMA, RSI, MACD, Bollinger, Stochastic, ATR, ADX, OBV, VWAP, Ichimoku, Supertrend, Parabolic SAR, pivots, Fibonacci
  levels.ts       Support/resistance from clustered swing points; demand/supply zones; explanations and invalidation
  patterns.ts     Double top/bottom, head & shoulders, triangles, wedges, channels, flags, cup & handle, breakouts; historical track record
  signals.ts      Technical snapshot and score; rule-based setups with entry, stop, targets, R:R, quality, invalidation
  fundamentals.ts Ratios computed from statement line items; sector-specific scoring; Graham, DDM, DCF
  ranking.ts      Strategy-specific, configurable ranking models (investing vs trading kept separate)
  backtest.ts     Long-only backtester, next-open fills, Nepal costs and CGT
  costs.ts        Broker commission slabs, SEBON fee, DP charge, CGT, dividend tax (editable in Settings)
  portfolio.ts    WACC accounting, realised/unrealised P&L, health score, position sizing
  planner.ts      Goals with inflation and scenarios + Monte Carlo, EMI, SIP, FD, car planner, emergency fund, FI, lump-sum allocation
  adjust.ts       Bonus-share price adjustment (only where the gap is visible in the data)
server/      Express API, SQLite (node:sqlite), auth, ingestion, alerts, AI agent
web/         React app (Vite), TradingView lightweight-charts
  src/backend/  In-browser backend: the server's routes run in a Web Worker on sql.js (WebAssembly SQLite)
  public/       PWA manifest, service worker, icons
scripts/     Snapshot export, live-price export, icon renderer, service-worker precache, Pages preview server
.github/     Data refresh and GitHub Pages deploy workflow
tests/       Vitest suites
```

## Security

- Web app: personal data stays on the device (IndexedDB); sync data is encrypted before it leaves the device; the API key, GitHub token and sync passphrase are never uploaded.
- Local server: local only by default; the server binds to 127.0.0.1 (set `HOST=0.0.0.0` only on a trusted network).
- Passwords hashed with scrypt; HTTP-only, SameSite=Strict session cookies; login rate limiting; origin checks on state-changing requests.
- Sensitive personal data encrypted with AES-256-GCM.
- Input validation on every endpoint (zod). Security headers set; CSP in production.
- Export (JSON), database backup and "delete my personal data" in Settings → Security.

## Not financial advice

Saphal Stocks is a decision-support tool. Scores, levels, setups and projections are calculations from stored data. They can be wrong, do not predict returns, and are not instructions to trade. Automatic real-money trading is intentionally not implemented.

See [PROGRESS.md](PROGRESS.md) for what is complete, what is partial, and the roadmap.
