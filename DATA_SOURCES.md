# Data sources

Checked on 8 November 2026. Every stored record carries its source, and every dataset's freshness (source, data date, last successful fetch, last error) is tracked in the `data_freshness` table and shown on **Settings → Data**.

## In use

| Data | Source | Access | Notes |
|---|---|---|---|
| Daily OHLCV history (about 330 companies, back to the 1990s for older ones) | [nepse-data](https://github.com/Aabishkar2/nepse-data) on GitHub | Raw CSV per symbol from raw.githubusercontent.com | MIT licence. Updated daily by the maintainer's GitHub Action (scraped from ShareSansar). Columns: date, open, high, low, close, traded quantity, traded amount. |
| Latest prices (OHLC, LTP, VWAP, volume, turnover, transactions, 52-week high/low) | ShareSansar `today-share-price` | HTML page | robots.txt allows crawling (`Disallow:` empty). Also appended to the price history each day. |
| Sectors and company names | ShareSansar `sectorwise-share-price` | HTML page | Lists only companies that traded that day; the company profile job fills the rest. |
| NEPSE, Sensitive, Float, Sensitive Float and 14 sector indices | ShareSansar `index-history-data` | JSON (DataTables endpoint) | Pages of at most 50 rows. NEPSE index loaded from 2012, others from 3 years back, then incremental. |
| Company profile (listed shares, paid-up value, operation date, contacts, registrar) | ShareSansar company page | HTML | |
| Dividend history (cash %, bonus %, book closure, announcement dates) | ShareSansar `company-dividend` | JSON (POST, needs the page's CSRF token and session cookie) | |
| Company announcements | ShareSansar `company-announcements` | JSON (POST, as above) | Headlines and links only; full text stays on the source site. |
| Latest quarterly statements (balance sheet, P&L, key metrics such as EPS, NPL, CAR, solvency) | ShareSansar `company-quarterly-report` | HTML fragment (POST, as above) | Only the latest quarter is offered, so history accumulates as the app keeps fetching each quarter. Values are in Rs. '000 as published by the company. |
| Market-wide announcements and news headlines | ShareSansar `announcement`, `category/latest`, `category/ipo-fpo-news`, `category/dividend-right-bonus` | HTML | Headlines, dates and links only. |
| IPO, FPO, right share, local/foreign-employed quota and mutual fund issues (units, price, dates, issue manager, listing date) | ShareSansar `existing-issues` | JSON (DataTables, `type` 1–8, 50 rows/page) | Listing performance is computed only when stored prices start within 7 days of listing. |
| Listed mutual fund NAVs (weekly/monthly NAV, market price, premium/discount, maturity) | ShareSansar `mutual-fund-navs` | JSON (`type=-1` active, `type=1` matured) | Each weekly NAV seen is kept in `fund_nav_history`, so NAV history builds up over time. |
| Foreign exchange rates | [Nepal Rastra Bank forex API](https://www.nrb.org.np/api/forex/v1/rates) | Official JSON API | |

### Politeness and reliability

- ShareSansar requests are spaced at least 1.2 seconds apart; GitHub raw files 50 ms apart.
- Retries with exponential backoff on network errors, HTTP 429 and 5xx.
- Rows are validated before storage (dates, positive closes, consistent OHLC). Upserts make re-runs idempotent and prevent duplicates.
- Every run is logged in `ingest_runs`; errors are recorded per dataset.

## Checked but not used

| Source | Why not |
|---|---|
| NEPSE official API (`nepalstock.com.np/api/nots/...`) | Returns 401 without a token that is not publicly offered. If NEPSE publishes an API, add an adapter in `server/ingest/providers.ts`. |
| Chukul | Its robots.txt blocks AI crawlers (including ClaudeBot), so it is respected and not used. |
| NepseAlpha | Returns 403 to automated requests. |
| Merolagani | Reachable, but redundant with the sources above. |

## Where the web app gets data

The web app does not contact the sources above from your phone. GitHub Actions (`.github/workflows/data-and-deploy.yml`) runs the same ingestion jobs on a schedule, exports a market snapshot (`data/market.db.bin`, gzip-compressed SQLite) and a small `data/live.json` with the latest quotes, and publishes them with the app on GitHub Pages. The same rate limits apply. The app shows the snapshot's data date and source on Settings → Data.

## Known limitations

- **Near-live, not real-time.** ShareSansar's latest-price page is refreshed about every 15 minutes during market hours (5 minutes on the local server). Signals and setups use daily bars; the current day's bar is marked provisional until the close.
- **Quarterly statement history** starts from what is fetched; older quarters are not offered by the source. Year-over-year growth appears once last year's same quarter has been stored. PDFs of older reports can be uploaded under Reports for AI document analysis.
- **Bonus and right-share adjustments** use dividend and issue records and apply only when the expected ex-date price gap is found in the data. Remaining unexplained gaps are listed on Settings → Data quality.
- **Investment product rates** (FD rates, bond coupons, fund returns) change constantly and are not scraped. The directory links to official sources and lets you record a verified rate and date.
- **Fees and taxes** are editable defaults; re-check SEBON, NEPSE and IRD notices after each budget.

## Adding a provider

Write an adapter in `server/ingest/providers.ts` that returns the same shapes (`OhlcvRow`, `TodayRow`, `IndexRow`, `DividendRow`, ...), then call it from a job in `server/ingest/jobs.ts` and record freshness with `fresh()`. The engines and UI read only from the database, so nothing else needs to change.
