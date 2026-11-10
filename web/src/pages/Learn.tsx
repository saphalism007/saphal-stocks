import { useState } from "react";
import { Link } from "react-router-dom";
import { Card, Markdown, Badge } from "../components/ui.tsx";
import { I } from "../components/icons.tsx";

interface Lesson { id: string; title: string; level: "Beginner" | "Intermediate" | "Advanced"; body: string; tryIt?: { label: string; to: string } }

const L: Lesson[] = [
  { id: "nepse", title: "How NEPSE works", level: "Beginner", body: `**NEPSE (Nepal Stock Exchange)** is the only stock exchange in Nepal. Companies list their shares there; investors buy and sell through **licensed brokers**.

- **Trading** happens on weekdays during market hours (check NEPSE notices for the current schedule and holidays). Orders go through your broker's **TMS** (Trade Management System).
- **Settlement** is handled by **CDSC** (CDS and Clearing Ltd). Shares move into your **Demat** account; money moves through your linked bank account. Settlement takes a couple of working days (T+2).
- **Price bands** (circuit limits) cap how much a stock can move in one day.
- **Indices**: the **NEPSE Index** covers all listed stocks; the **Sensitive Index** covers large, liquid "class A" companies; the **Float** indices use only freely tradable shares. Each sector has a sub-index.
- **Regulator**: SEBON supervises the market; NRB regulates banks and finance companies (which are a large part of NEPSE).

Practical example: if you buy 100 NABIL shares on TMS, the trade is matched on NEPSE, cleared by CDSC, and after settlement the shares appear in your Mero Share portfolio.`, tryIt: { label: "Open the market dashboard", to: "/market" } },
  { id: "demat", title: "Opening a Demat account and Mero Share", level: "Beginner", body: `1. **Demat account**: open one with any **Depository Participant (DP)**, usually a bank's capital/merchant arm. You need citizenship, a photo, a bank account and your details (KYC). Many DPs allow online applications.
2. **Mero Share**: CDSC's online platform (meroshare.cdsc.com.np). Your DP gives you a login. Use it to apply for IPOs/FPOs/rights (ASBA), view holdings and transaction history, transfer shares (EDIS) and check WACC.
3. **Bank account with ASBA (C-ASBA)**: lets IPO money be *blocked* rather than debited until allotment.
4. **Renewal**: Demat and Mero Share have annual fees; keep them active or IPO applications fail.

Tip: keep your CRN (from the bank), BOID and Mero Share PIN safe. Never share them with "IPO agents" or strangers.`, tryIt: { label: "Official resources", to: "/opportunities" } },
  { id: "tms", title: "Using TMS (broker trading)", level: "Beginner", body: `- Open an account with a **licensed broker**; you get a TMS login at your broker's address (\`tmsNN.nepsetms.com.np\`, NN = broker number).
- **Collateral**: load funds to buy. Your buying limit depends on collateral and broker rules.
- **Order types**: limit orders are standard; set price and quantity. Check the **market depth** before placing large orders in thinly traded stocks.
- **After buying**: shares settle into your Demat. **When selling**, authorise the transfer in Mero Share (**EDIS**), otherwise the sale can be penalised.
- **Costs**: broker commission (slabs), SEBON fee, DP charge on selling, and capital gains tax. See *Taxes and costs* below; Saphal Stocks includes them in every calculation.`, tryIt: { label: "Trade cost calculator", to: "/planner" } },
  { id: "ipo", title: "Applying for IPOs", level: "Beginner", body: `- Watch for issue announcements (company announcements, SEBON approvals).
- Apply in **Mero Share > My ASBA** during the issue window. The usual minimum is **10 units**; check the prospectus for the issue's rules and quotas (general public, locals of project areas, employees, Nepalis working abroad).
- Oversubscribed issues are allotted by **lottery**: most applicants in popular IPOs get 10 units or nothing.
- Check results at **iporesult.cdsc.com.np**.
- **Before applying, read**: business, use of funds, promoters, financials, and whether it's priced at par or book-built. An IPO is still an equity investment: listing-day gains are common but not guaranteed.`, tryIt: { label: "IPO alerts", to: "/alerts" } },
  { id: "statements", title: "Understanding financial statements", level: "Intermediate", body: `Listed companies publish **quarterly unaudited** and **annual audited** statements.

- **Balance sheet**: what the company owns (assets) and owes (liabilities); the difference is **equity / net worth**.
- **Profit & loss**: income, expenses and **net profit** for the period. In Nepal, quarterly figures are **cumulative year-to-date** (Q2 = six months), so Saphal Stocks annualises profit as YTD x 4 ÷ quarter.
- **Key metrics** (published by the company): EPS, net worth per share, and for banks NPL, CAR, CD ratio, cost of funds, spread.
- **Notes and auditor's report**: look for *qualified opinions*, *emphasis of matter*, related-party transactions and contingent liabilities.

Example: a bank with Rs. 2.5 billion Q1 profit has an annualised profit near Rs. 10 billion; divided by its shares, that's annualised EPS. Compare it with the reported EPS, which may use a different share count after bonus issues.`, tryIt: { label: "See a company's statements", to: "/stocks/NABIL" } },
  { id: "analyze", title: "Analysing a company (sector by sector)", level: "Intermediate", body: `One checklist does not fit all sectors:

| Sector | Look at first |
|---|---|
| Commercial / development banks, finance | ROE, NPL, capital adequacy (CAR), cost-to-income, P/B, dividend record |
| Microfinance | NPL (can rise fast), ROE, interest-rate caps, P/B |
| Life / non-life insurance | Solvency ratio, ROE, claims ratio, P/E (often high) |
| Hydropower | Debt/equity, interest cover, plant generation, PPA terms, accumulated losses, P/B |
| Manufacturing, hotels, trading | Revenue growth, margins, debt, cash flow |

Then ask: Is profit growing consistently? Is it paid out as dividends? Is the price reasonable versus earnings, book value and the sector median? What could go wrong (regulation, interest rates, a single big customer)?`, tryIt: { label: "Sector analysis", to: "/fundamental" } },
  { id: "intrinsic", title: "Calculating intrinsic value", level: "Advanced", body: `Intrinsic value is an *estimate* of what a share is worth based on future cash it can produce.

- **Graham number** = √(22.5 x EPS x book value per share). A conservative ceiling for stable companies.
- **Dividend discount model** = next year's dividend ÷ (required return − growth). Useful for steady dividend payers; very sensitive to the growth assumption.
- **DCF**: forecast per-share cash flows, discount them at your required return, add a terminal value. Most of the value often comes from the terminal value, so small changes in assumptions move the answer a lot.
- **Relative valuation**: compare P/E and P/B with the sector median and the company's own history.

Use several methods and a **margin of safety** (buy well below your estimate). Never treat one number as precise.`, tryIt: { label: "Valuation calculators", to: "/planner" } },
  { id: "undervalued", title: "Finding undervalued stocks (and avoiding value traps)", level: "Intermediate", body: `Cheap on P/E or P/B is only a start. A **value trap** looks cheap because the business is deteriorating.

Checklist:
1. Profitable, with stable or rising earnings.
2. Healthy balance sheet for the sector (low NPL and adequate CAR for banks; manageable debt for hydropower).
3. Valuation below sector median and below its own history.
4. A reason the market may be wrong (temporary bad news, sector-wide selling).
5. No accounting or governance red flags.

The **Undervalued** ranking in Saphal Stocks applies exactly these filters and shows each stock's factor contributions.`, tryIt: { label: "Undervalued ranking", to: "/fundamental" } },
  { id: "charts", title: "Reading technical charts", level: "Intermediate", body: `- **Trend**: price above a rising 50- and 200-day average suggests an uptrend.
- **Support/resistance**: price levels where buying or selling repeatedly appeared. More reactions, higher volume and role reversal make a level stronger. Saphal Stocks explains each level and what would break it.
- **Momentum**: RSI above 70 is overbought, below 30 oversold (not automatic signals). MACD crossing its signal line shows momentum shifts. ADX above 25 means a strong trend.
- **Volume** confirms moves: a breakout on 1.5x normal volume is more reliable.
- **Patterns** (double bottom, triangles, flags) are only probabilities. Check how a pattern actually performed on the stock's own history.

NEPSE specifics: thin trading in small stocks makes technicals noisy; bonus-share price adjustments create fake gaps (Saphal Stocks adjusts for them when the gap is visible in the data).`, tryIt: { label: "Technical analysis", to: "/technical" } },
  { id: "risk", title: "Managing risk", level: "Intermediate", body: `- **Position size**: risk a small, fixed share of capital per trade (e.g. 1%). If your stop-loss is 6% below entry and you risk Rs. 5,000, buy about Rs. 83,000 worth.
- **Stop-loss**: decide in advance where your idea is wrong, usually just beyond support.
- **Diversify**: several sectors, no single stock above ~20-25% of the portfolio.
- **Liquidity**: avoid big positions in stocks that trade only a few lakhs a day; you may not be able to sell.
- **Leverage**: margin loans magnify losses; NEPSE has had sharp falls.
- **Keep an emergency fund** so you never have to sell in a crash.`, tryIt: { label: "Position size calculator", to: "/planner" } },
  { id: "portfolio", title: "Building a portfolio", level: "Beginner", body: `1. Set goals and timelines first (Wealth Planner).
2. Decide the split between safe assets (deposits, bonds) and equities based on timeline and risk tolerance.
3. Within equities: a core of strong, dividend-paying companies across sectors, plus a smaller satellite for growth ideas.
4. Track **WACC**, realised and unrealised gains, dividends, and sector exposure.
5. Review quarterly when results come out; rebalance yearly.`, tryIt: { label: "Open portfolio", to: "/portfolio" } },
  { id: "mf", title: "Understanding mutual funds", level: "Beginner", body: `- **Open-ended** funds: buy from and sell back to the fund manager at NAV. Good for monthly SIPs.
- **Close-ended** funds: listed on NEPSE with a fixed term; the market price can be far from NAV (discount or premium).
- Compare **NAV growth over several years**, the manager's track record, and fees. Past performance does not guarantee future returns.
- Mutual funds give instant diversification for small amounts; useful if you lack time to research individual stocks.`, tryIt: { label: "Mutual funds in the directory", to: "/opportunities" } },
  { id: "govsec", title: "Investing in government securities", level: "Beginner", body: `- **Development / savings bonds** are issued by the Government of Nepal through NRB with a **fixed coupon** for each issue. Default risk is minimal; money is locked until maturity (some can be pledged for loans).
- **Treasury bills** are short-term and mainly for institutions.
- Watch NRB and PDMO notices for issue windows; popular issues sell out quickly.
- Good for the safe portion of a portfolio and for goals with a known date.`, tryIt: { label: "Government securities", to: "/opportunities" } },
  { id: "tax", title: "Taxes and costs on investments in Nepal", level: "Beginner", body: `Defaults used by Saphal Stocks (editable in Settings > Fees & taxes; verify current rules with IRD/SEBON):

| Item | Rate |
|---|---|
| Broker commission | Slab rate on the transaction value (0.24%-0.36%), Rs. 10 minimum |
| SEBON fee | 0.015% of value, buy and sell |
| DP charge | Rs. 25 per scrip sold |
| Capital gains tax (individuals, from FY 2083/84) | 10% if held 365 days or less; 7.5% if held longer (was 7.5% / 5% before) |
| Dividend tax | 5% on cash dividends and on bonus shares (face value) |
| Bank deposit interest (individuals) | 6% withheld at source |

**WACC**: brokers calculate CGT on your weighted average cost including buy charges; bonus shares usually enter at Rs. 100. Mero Share shows your WACC.`, tryIt: { label: "Trade cost & CGT calculator", to: "/planner" } },
  { id: "scams", title: "Avoiding investment scams", level: "Beginner", body: `Warning signs:
- **Guaranteed** high returns, or "double your money" schemes.
- Requests for your Mero Share password, PIN, CRN or OTP. **Never share them.**
- "Insider tips" in Telegram/Viber/TikTok groups promoting thinly traded stocks (pump-and-dump).
- Unlicensed "portfolio managers" or cooperatives promising fixed returns.
- Pressure to decide immediately.

Check licences on **SEBON** (brokers, merchant bankers, fund managers) and **NRB** (banks, finance companies). If it sounds too good to be true, it is.`, tryIt: { label: "Official resources directory", to: "/opportunities" } },
  { id: "dividends", title: "Dividends, bonus and right shares", level: "Beginner", body: `- **Cash dividend**: paid as a % of face value (usually Rs. 100). A 10% cash dividend = Rs. 10 per share, before 5% tax.
- **Bonus shares**: new shares instead of cash. A 10% bonus gives 10 shares per 100 held; the price adjusts down on book closure, so your wealth does not jump overnight.
- **Right shares**: the right to buy new shares, usually at Rs. 100, in a fixed ratio. Not subscribing dilutes your stake.
- **Book closure date**: you must hold the shares (settled) before it to be entitled.
- **Dividend yield** = cash dividend per share ÷ price. A high yield is good only if earnings can sustain it.`, tryIt: { label: "Dividend ranking", to: "/fundamental" } },
];

export default function Learn() {
  const [open, setOpen] = useState<string>(L[0].id);
  const [level, setLevel] = useState<string>("");
  const lesson = L.find((x) => x.id === open)!;
  const shown = L.filter((x) => !level || x.level === level);
  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Learning Center</h1><p>Practical lessons for investing in Nepal. Ask the AI analyst to explain any concept in more depth.</p></div>
        <div className="seg">{["", "Beginner", "Intermediate", "Advanced"].map((l) => <button key={l} className={level === l ? "on" : ""} onClick={() => setLevel(l)}>{l || "All"}</button>)}</div>
      </div>
      <div className="grid g3">
        <Card title={`${shown.length} lessons`} flush>
          <div className="list">{shown.map((x) => (
            <button key={x.id} className="list-item" style={{ background: x.id === open ? "var(--panel-3)" : "none", border: 0, textAlign: "left", cursor: "pointer", width: "100%", borderBottom: "1px solid var(--border)", color: "inherit" }} onClick={() => setOpen(x.id)}>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 500 }}>{x.title}</div><Badge tone={x.level === "Beginner" ? "up" : x.level === "Intermediate" ? "blue" : "warn"}>{x.level}</Badge></div>
            </button>
          ))}</div>
        </Card>
        <Card title={lesson.title} className="span2" sub={lesson.level}>
          <Markdown text={lesson.body} />
          <div className="row" style={{ marginTop: 12 }}>
            {lesson.tryIt && <Link className="btn" to={lesson.tryIt.to}>{lesson.tryIt.label}</Link>}
            <Link className="btn" to={`/analyst?q=${encodeURIComponent(`Explain "${lesson.title}" for a Nepali investor with a practical example using real NEPSE data where possible.`)}`}><I.ai /> Explain with AI</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
