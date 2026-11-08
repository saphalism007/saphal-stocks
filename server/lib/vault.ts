// Encrypted per-user records (financial profile, goals, net worth snapshots, journal, theses).
import { all, get, run, nowIso } from "../db.ts";
import { encrypt, decrypt } from "./security.ts";

export type VaultKind = "profile" | "goal" | "networth" | "journal" | "thesis";

export function readVault<T = Record<string, unknown>>(userId: number, kind: VaultKind) {
  return all<{ id: number; data_enc: string; created_at: string; updated_at: string }>("SELECT * FROM vault WHERE user_id = ? AND kind = ? ORDER BY id", userId, kind).map((r) => ({
    id: r.id, createdAt: r.created_at, updatedAt: r.updated_at, data: decrypt<T>(r.data_enc),
  }));
}

export function writeVault(userId: number, kind: VaultKind, data: unknown, id?: number) {
  const now = nowIso();
  if (id) {
    const row = get("SELECT id FROM vault WHERE id = ? AND user_id = ? AND kind = ?", id, userId, kind);
    if (!row) throw Object.assign(new Error("Not found"), { status: 404 });
    run("UPDATE vault SET data_enc = ?, updated_at = ? WHERE id = ?", encrypt(data), now, id);
    return id;
  }
  if (kind === "profile") {
    const existing = get<{ id: number }>("SELECT id FROM vault WHERE user_id = ? AND kind = 'profile'", userId);
    if (existing) { run("UPDATE vault SET data_enc = ?, updated_at = ? WHERE id = ?", encrypt(data), now, existing.id); return existing.id; }
  }
  return Number(run("INSERT INTO vault (user_id, kind, data_enc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", userId, kind, encrypt(data), now, now).lastInsertRowid);
}

export function deleteVault(userId: number, kind: VaultKind, id: number) {
  run("DELETE FROM vault WHERE id = ? AND user_id = ? AND kind = ?", id, userId, kind);
}
