# Saphal Stocks

A personal financial intelligence platform for Nepal: NEPSE market data and research, technical and fundamental analysis engines, stock comparison, a multi-stock Strategy Lab, an AI stock analyst that reasons over the platform's own data, portfolio management with Nepal fees and taxes, a trading journal and thesis tracker, an IPO and mutual fund tracker, and a wealth planner.

Everything runs on your own computer. Market data comes from public sources (see [DATA_SOURCES.md](DATA_SOURCES.md)); your portfolio and financial profile stay in a local, encrypted database.

## Run it

Needs Node.js 22.13 or newer (it uses Node's built-in SQLite).

```bash
npm install
npm run dev
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

## Configuration (`.env`)

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
tests/       Vitest suites
```

## Security

- Local only: the server binds to 127.0.0.1.
- Passwords hashed with scrypt; HTTP-only, SameSite=Strict session cookies; login rate limiting; origin checks on state-changing requests.
- Sensitive personal data encrypted with AES-256-GCM.
- Input validation on every endpoint (zod). Security headers set; CSP in production.
- Export (JSON), database backup and "delete my personal data" in Settings → Security.

## Not financial advice

Saphal Stocks is a decision-support tool. Scores, levels, setups and projections are calculations from stored data. They can be wrong, do not predict returns, and are not instructions to trade. Automatic real-money trading is intentionally not implemented.

See [PROGRESS.md](PROGRESS.md) for what is complete, what is partial, and the roadmap.
