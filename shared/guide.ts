// Start Investing guide: step-by-step paths by amount, each step with its official link.
// Links are checked daily by the link checker (server/ingest/jobs.ts). No step implies a product
// is open for applications today; providers set their own terms and fees.

export interface GuideLink { label: string; url: string; who: string }
export interface GuideStep { title: string; detail: string; links: GuideLink[]; inApp?: { label: string; to: string } }
export interface GuidePath { key: string; title: string; amount: string; summary: string; risk: "Very low" | "Low" | "Medium" | "High"; steps: GuideStep[] }

export const ACCOUNTS: GuideStep[] = [
  { title: "1. A bank account (you probably have one)", detail: "Every investment in Nepal pays in and out through a bank account in your name. Mobile banking makes deposits, FDs, recurring deposits and C-ASBA (for IPOs) possible from your phone.", links: [], inApp: { label: "Compare banks' deposit rates", to: "/invest?tab=deposits" } },
  { title: "2. A Demat account (for shares, IPOs, mutual funds, debentures)", detail: "Opened with a Depository Participant (DP): most banks' capital-market companies and many brokers are DPs. Take your citizenship certificate and bank details; many DPs offer online opening.", links: [{ label: "List of Depository Participants (CDSC)", url: "https://cdsc.com.np/listofdp", who: "CDS and Clearing Ltd." }, { label: "What a DP does (CDSC)", url: "https://cdsc.com.np/dpintroduction", who: "CDS and Clearing Ltd." }] },
  { title: "3. Mero Share login (apply for IPOs, see your holdings)", detail: "Your DP gives you a Mero Share login when you open the Demat account (or on request). It is where you apply for IPOs/FPOs and right shares and see everything you hold.", links: [{ label: "Mero Share", url: "https://meroshare.cdsc.com.np", who: "CDS and Clearing Ltd." }] },
  { title: "4. C-ASBA registration (to block money for IPO applications)", detail: "Register your bank account for C-ASBA once (through your bank's branch or app), so Mero Share can block the application amount until allotment.", links: [{ label: "Mero Share (link your bank / CRN)", url: "https://meroshare.cdsc.com.np", who: "CDS and Clearing Ltd." }] },
  { title: "5. A broker TMS account (to buy and sell listed shares)", detail: "Pick a licensed broker from NEPSE's member list; they open a TMS (online trading) login linked to your Demat and bank. Compare their service and online platform.", links: [{ label: "NEPSE licensed brokers", url: "https://www.nepalstock.com/members", who: "Nepal Stock Exchange" }] },
];

export const PATHS: GuidePath[] = [
  {
    key: "tiny", title: "Start with Rs. 500-2,000 a month", amount: "Rs. 500+ / month", risk: "Low",
    summary: "Build the habit with something automatic and simple.",
    steps: [
      { title: "Recurring deposit at your bank", detail: "A fixed amount moves from your account every month at a contractual rate. Open it in your bank's app or branch. Safe; interest is taxed at source.", links: [], inApp: { label: "See banks' latest rate notices", to: "/invest?tab=deposits" } },
      { title: "Open-ended mutual fund (monthly SIP)", detail: "Small monthly investments into a diversified fund. Example: NIBL Sahabhagita Fund, which can be bought online through its fund manager's portal. Returns are market-linked and can be negative.", links: [{ label: "NIBL Sahabhagita Fund: buy online", url: "https://mutualfund.nimbacecapital.com", who: "NIMB Ace Capital" }, { label: "NIMB Ace Capital (fund manager)", url: "https://www.nimbacecapital.com", who: "NIMB Ace Capital" }], inApp: { label: "Compare listed funds", to: "/invest?tab=funds" } },
      { title: "Social Security Fund (if your employer contributes, or self-registration)", detail: "Retirement and benefit scheme under the Social Security Act. Check eligibility and contribution rules on the official site.", links: [{ label: "Social Security Fund", url: "https://ssf.gov.np", who: "Social Security Fund, Government of Nepal" }] },
    ],
  },
  {
    key: "ipo", title: "Apply for IPOs (Rs. 1,000 at a time)", amount: "Usually Rs. 1,000 per application", risk: "Medium",
    summary: "IPOs are usually 10 units at Rs. 100. Allotment is a lottery when oversubscribed; only the allotted amount is debited.",
    steps: [
      { title: "Have Demat, Mero Share and C-ASBA ready", detail: "See the account steps above. One application per Demat account per issue.", links: [{ label: "Mero Share", url: "https://meroshare.cdsc.com.np", who: "CDS and Clearing Ltd." }] },
      { title: "Read the prospectus before applying", detail: "Check what the company does, how it will use the money, its risks and rating.", links: [{ label: "Prospectuses (SEBON)", url: "https://www.sebon.gov.np/prospectus", who: "Securities Board of Nepal" }], inApp: { label: "Open and upcoming issues", to: "/ipo" } },
      { title: "Check allotment", detail: "Results are published by CDSC after the issue closes. Save your family's BOIDs in the app to copy them quickly.", links: [{ label: "IPO allotment results", url: "https://iporesult.cdsc.com.np", who: "CDS and Clearing Ltd." }], inApp: { label: "My BOIDs", to: "/ipo" } },
    ],
  },
  {
    key: "shares", title: "Buy shares and listed funds (Rs. 10,000+)", amount: "Rs. 10,000+", risk: "High",
    summary: "Buy diversified: several strong companies across sectors, or closed-end funds trading below NAV. Keep money you need within 3 years out of shares.",
    steps: [
      { title: "Open a broker TMS account", detail: "Choose a licensed broker; you'll place orders in their TMS. Broker commission, SEBON fee and DP charge apply on each trade (the app's trade planner shows them).", links: [{ label: "NEPSE licensed brokers", url: "https://www.nepalstock.com/members", who: "Nepal Stock Exchange" }], inApp: { label: "Trade planner & costs", to: "/trading" } },
      { title: "Pick what to buy with a plan", detail: "Long-term: strong fundamentals and fair valuation. Short-term: only with a stop-loss and position size you can afford to lose.", links: [], inApp: { label: "Long-term ideas", to: "/trading?tab=longterm" } },
      { title: "Closed-end mutual funds and debentures", detail: "Bought in TMS like shares. Funds give diversification (check discount to NAV); debentures pay fixed coupons (check yield to maturity).", links: [], inApp: { label: "Funds and debentures", to: "/invest?tab=funds" } },
    ],
  },
  {
    key: "safe", title: "Park larger sums safely (Rs. 1 lakh+)", amount: "Rs. 1,00,000+", risk: "Very low",
    summary: "For money you need in 1-3 years, or the safe part of a long-term plan.",
    steps: [
      { title: "Fixed deposit at the best verified rate", detail: "Compare institutions' latest official rate notices, then open the FD in the bank's app or branch. Deposit insurance covers deposits up to a limit per depositor per bank.", links: [], inApp: { label: "Best deposit rates", to: "/invest?tab=deposits" } },
      { title: "Government savings / development bonds when issued", detail: "Fixed coupons backed by the government, sold through banks when NRB announces an issue. Treasury bills are mainly for institutions.", links: [{ label: "Nepal Rastra Bank", url: "https://www.nrb.org.np", who: "Nepal Rastra Bank" }], inApp: { label: "T-bill yields", to: "/invest?tab=funds" } },
      { title: "Get a split for your amount", detail: "The Investment Planner considers your emergency fund, loans and goals and compares conservative, balanced and growth mixes.", links: [], inApp: { label: "Investment Planner", to: "/invest" } },
    ],
  },
  {
    key: "retire", title: "Retirement and tax-advantaged saving", amount: "Any amount, long term", risk: "Low",
    summary: "Long lock-ins in exchange for safety and tax benefits within limits.",
    steps: [
      { title: "Citizen Investment Trust (CIT) schemes", detail: "Government trust with retirement and savings schemes; check current schemes and how to join on the official site.", links: [{ label: "Citizen Investment Trust", url: "https://www.citnepal.gov.np", who: "Citizen Investment Trust" }] },
      { title: "Employees Provident Fund (EPF)", detail: "For employees whose employer is registered; contributions are deducted from salary.", links: [{ label: "Employees Provident Fund", url: "https://www.epfnepal.com.np", who: "Employees Provident Fund" }] },
      { title: "Social Security Fund (SSF)", detail: "Contribution-based social security scheme for eligible workers.", links: [{ label: "Social Security Fund", url: "https://ssf.gov.np", who: "Social Security Fund" }] },
    ],
  },
];

export const GUIDE_URLS = [...new Set([...ACCOUNTS, ...PATHS.flatMap((p) => p.steps)].flatMap((s) => s.links.map((l) => l.url)).concat(["https://iporesult.cdsc.com.np", "https://www.sebon.gov.np/prospectus"]))];
