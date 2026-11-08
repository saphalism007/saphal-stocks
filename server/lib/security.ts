// Password hashing (scrypt), session tokens, and AES-256-GCM encryption for
// sensitive personal data (financial profile, goals, net worth, journal).
import { scryptSync, randomBytes, timingSafeEqual, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { config } from "../config.ts";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [alg, n, saltHex, hashHex] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: Number(n), r: SCRYPT.r, p: SCRYPT.p });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export const newToken = () => randomBytes(32).toString("base64url");
export const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

export function encrypt(plain: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", config.secretKey, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(plain), "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

export function decrypt<T = unknown>(blob: string): T {
  const [v, ivB, tagB, dataB] = blob.split(":");
  if (v !== "v1") throw new Error("Unknown encryption version");
  const decipher = createDecipheriv("aes-256-gcm", config.secretKey, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(dataB, "base64")), decipher.final()]);
  return JSON.parse(out.toString("utf8")) as T;
}
