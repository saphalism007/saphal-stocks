import { useNavigate } from "react-router-dom";
import { useApi } from "../lib/api.ts";
import { Card, Loading, DataTable, Score, Notice } from "../components/ui.tsx";
import { RankingPanel } from "../components/RankingPanel.tsx";
import { num, pct, tone, compact } from "../lib/format.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function Fundamental() {
  const sectors = useApi<any[]>("/sectors");
  const status = useApi<any>("/data/status");
  const nav = useNavigate();
  const c = status.data?.counts;
  return (
    <div className="page">
      <div className="page-head"><div><h1>Fundamental Analysis</h1><p>Sector-aware investing models built on ratios computed from company-published quarterly statements.</p></div></div>
      {c && c.companiesWithReports < c.companies * 0.6 && <Notice tone="warn">Statements are stored for {c.companiesWithReports} of {c.companies} companies so far. Rankings only include companies with data; the background job fills the rest (about 5 seconds per company, politely rate-limited).</Notice>}
      <Card title="Investing strategies" sub="Each strategy uses its own model; investing and trading are ranked separately">
        <RankingPanel kinds={["investing", "risk"]} defaultKey="quality" />
      </Card>
      <Card title="Sector analysis" flush sub="Medians across stocks with data. Banks are judged on ROE, NPL, CAR and P/B; insurers on solvency; hydropower on leverage and P/B.">
        {sectors.loading ? <Loading /> : (
          <DataTable rows={sectors.data ?? []} onRow={(s: any) => nav(`/stocks?sector=${encodeURIComponent(s.sector)}`)} cols={[
            { key: "sector", label: "Sector" }, { key: "count", label: "Stocks", num: true },
            { key: "medianPe", label: "Median P/E", num: true, render: (s: any) => num(s.medianPe, 1) },
            { key: "medianPb", label: "Median P/B", num: true, render: (s: any) => num(s.medianPb, 2) },
            { key: "medianRoe", label: "Median ROE %", num: true, render: (s: any) => num(s.medianRoe, 1) },
            { key: "medianYield", label: "Median yield %", num: true, render: (s: any) => num(s.medianYield, 2) },
            { key: "medianReturn1y", label: "Median 1Y", num: true, render: (s: any) => <span className={tone(s.medianReturn1y)}>{pct(s.medianReturn1y, 1)}</span> },
            { key: "uptrend", label: "In uptrend", num: true, render: (s: any) => `${s.uptrend}/${s.count}` },
            { key: "medianFundamental", label: "Fund.", num: true, render: (s: any) => <Score value={s.medianFundamental} /> },
            { key: "turnover20", label: "Avg daily turnover", num: true, render: (s: any) => compact(s.turnover20) },
          ]} />
        )}
      </Card>
    </div>
  );
}
