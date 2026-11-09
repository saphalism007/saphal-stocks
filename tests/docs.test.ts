import { describe, expect, it } from "vitest";
import { classifyDoc, fiscalYear, quarterOf, pageKind, extractLinks, baseDomain, isDocUrl, describe as desc } from "../shared/docs.ts";

const L = (url: string, title = "Download", context = "") => ({ url, title, context });

describe("fiscal year and quarter", () => {
  it("reads BS fiscal years in several spellings", () => {
    expect(fiscalYear("Financial Statement Q1 2081-82")).toBe("2081/82");
    expect(fiscalYear("uploads/Financial Highlights/2081 82/Interim Q3.pdf")).toBe("2081/82");
    expect(fiscalYear("Financial Highlights/79-80/First Quarter.pdf")).toBe("2079/80");
    expect(fiscalYear("Annual Report 2080/081")).toBe("2080/81");
    expect(fiscalYear("FY 2024/25 results")).toBe("2024/25");
    expect(fiscalYear("Quarter Report Nov 13")).toBeNull();
  });
  it("reads quarters from words and quarter-end months", () => {
    expect(quarterOf("Second Quarter Financial Report", false)).toBe(2);
    expect(quarterOf("INTERIM FINANCIAL REPORT Q4", false)).toBe(4);
    expect(quarterOf("Financial Report Chaitra 2082", true)).toBe(3);
    expect(quarterOf("Financial Report Chaitra 2082", false)).toBeNull();
  });
});

describe("document classification never mixes report types", () => {
  it("quarterly reports", () => {
    for (const u of ["https://cms.x.com/uploads/2082/Fourth Quarter Financial Report.pdf", "https://cms.x.com/uploads/Financial Highlights/2081 82/INTERIM FINANCIAL REPORT Q4.pdf", "https://cms.x.com/uploads/2082/Quarterly Financial Statement Ashwin 2082.pdf", "https://x.com/Unaudited Financial Results- Quarter 4.pdf"]) {
      const c = classifyDoc(L(u));
      expect(c.type, u).toBe("quarterly");
    }
    expect(classifyDoc(L("https://x.com/a.pdf", "Unaudited financial results of fourth quarter 2081/82")).quarter).toBe(4);
  });
  it("a fourth-quarter unaudited report is not an audited statement", () => { expect(classifyDoc(L("https://x.com/a.pdf", "Fourth quarter (unaudited) financial statements 2081/82")).type).toBe("quarterly"); });
  it("audited statements and annual reports are told apart", () => {
    expect(classifyDoc(L("https://x.com/a.pdf", "Audited Financial Statements FY 2081/82")).type).toBe("audited");
    expect(classifyDoc(L("https://x.com/a.pdf", "Independent Auditor's Report 2080/81")).type).toBe("audited");
    expect(classifyDoc(L("https://x.com/a.pdf", "Annual Report 2080/81")).type).toBe("annual");
    expect(classifyDoc(L("https://x.com/a.pdf", "Annual Report 2080/81")).fiscalYear).toBe("2080/81");
  });
  it("loan / rate files named after months are not quarterly reports", () => {
    expect(classifyDoc(L("https://cms.x.com/uploads/Financial Highlights/Subsidized Loan as on Ashad 2083.pdf")).type).not.toBe("quarterly");
    expect(classifyDoc(L("https://x.com/base-rate.pdf", "Base Rate Chaitra 2082")).type).toBe("disclosure");
  });
  it("financial but unstated type stays unclassified", () => { expect(classifyDoc(L("https://x.com/fs.pdf", "Financial Statement")).type).toBe("unclassified"); });
  it("notices", () => { expect(classifyDoc(L("https://x.com/n.pdf", "Notice regarding 25th AGM")).type).toBe("notice"); });
});

describe("pages and links", () => {
  it("recognises page kinds", () => {
    expect(pageKind("Investor Relations & Disclosures", "/report/investor-relations")).toBe("investor");
    expect(pageKind("Downloads", "/downloads")).toBe("downloads");
    expect(pageKind("Notices", "/notices")).toBe("notices");
    expect(pageKind("Annual Reports", "/annual-report")).toBe("annual");
  });
  it("extracts links with table-row context", () => {
    const html = `<table><tr><td>Second Quarter Report 2081/82</td><td><a href="/files/q2.pdf">Download</a></td></tr></table><a href="https://facebook.com/x">fb</a>`;
    const ls = extractLinks(html, "https://bank.com.np/investor");
    expect(ls).toHaveLength(1);
    expect(ls[0].url).toBe("https://bank.com.np/files/q2.pdf");
    expect(desc(ls[0]).title).toMatch(/Second Quarter Report/);
    expect(classifyDoc(ls[0]).type).toBe("quarterly");
  });
  it("base domains and document URLs", () => {
    expect(baseDomain("cms.nicasiabank.com")).toBe("nicasiabank.com");
    expect(baseDomain("www.nepalsbi.com.np")).toBe("nepalsbi.com.np");
    expect(isDocUrl("https://a.com/x/report.PDF")).toBe(true);
    expect(isDocUrl("https://a.com/about")).toBe(false);
  });
});

describe("fiscal year from Nepali dates", () => {
  it("quarter-end dates map to the right fiscal year", () => {
    expect(fiscalYear("1st Quarter: 2083-06-31")).toBe("2083/84");
    expect(fiscalYear("4th Quarter: 2082-03-32")).toBe("2081/82");
    expect(fiscalYear("uploads/2083/First Quarter Financial Report.pdf")).toBeNull();
  });
});
describe("governance audits are not financial audits", () => {
  it("corporate governance audit report", () => { expect(classifyDoc({ url: "https://x.com/a.pdf", title: "Corporate Governance Audit report 77/78", context: "" }).type).toBe("disclosure"); });
});
