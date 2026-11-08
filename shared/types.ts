// Core data shapes shared by the server engines and the web app.

export interface Bar {
  date: string; // YYYY-MM-DD (trading day, Asia/Kathmandu)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number; // shares traded
  amount?: number; // turnover in Rs. (lets us compute the day's true VWAP)
}

export type Series = (number | null)[];

export interface SourceStamp {
  source: string; // human readable provider name
  url?: string;
  fetchedAt: string; // ISO timestamp
  asOf?: string; // trading date the data refers to
}

export const SECTORS = [
  "Commercial Bank",
  "Development Bank",
  "Finance",
  "Microfinance",
  "Hydropower",
  "Life Insurance",
  "Non-Life Insurance",
  "Hotel & Tourism",
  "Manufacturing and Processing",
  "Investment",
  "Trading",
  "Others",
  "Mutual Fund",
  "Corporate Debentures",
  "Promoter Share",
] as const;

export type SectorGroup = "bank" | "microfinance" | "insurance" | "hydro" | "mutualfund" | "debenture" | "general";

export function sectorGroup(sector: string | null | undefined): SectorGroup {
  const s = (sector || "").toLowerCase();
  if (s.includes("commercial bank") || s.includes("development bank") || s === "finance") return "bank";
  if (s.includes("microfinance")) return "microfinance";
  if (s.includes("insurance")) return "insurance";
  if (s.includes("hydro")) return "hydro";
  if (s.includes("mutual fund")) return "mutualfund";
  if (s.includes("debenture")) return "debenture";
  return "general";
}
