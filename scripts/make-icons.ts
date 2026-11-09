// Renders the app icons (PNG) without external tools: a rounded green-to-blue tile with a rising chart line.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../server/config.ts";

const OUT = join(ROOT, "web", "public", "icons");
mkdirSync(OUT, { recursive: true });

function crc32(buf: Buffer) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size: number, px: (x: number, y: number) => [number, number, number, number]) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) { const [r, g, b, a] = px(x, y); const o = y * (size * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a; }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

const segDist = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax, dy = by - ay; const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

function icon(size: number, opts: { rounded: boolean; inset: number }) {
  const S = 4; // supersampling
  const line = [[0.2, 0.68], [0.4, 0.5], [0.55, 0.6], [0.8, 0.32]].map(([x, y]) => [opts.inset + x * (1 - 2 * opts.inset), opts.inset + y * (1 - 2 * opts.inset)]);
  const width = 0.075 * (1 - 2 * opts.inset);
  const radius = opts.rounded ? 0.22 : 0;
  return png(size, (x, y) => {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = (x + (sx + 0.5) / S) / size, v = (y + (sy + 0.5) / S) / size;
      // Rounded-square mask.
      const cx = Math.max(radius - u, 0, u - (1 - radius)), cy = Math.max(radius - v, 0, v - (1 - radius));
      if (radius && Math.hypot(cx, cy) > radius) continue;
      // Diagonal gradient: dark navy -> deep teal.
      const t = (u + v) / 2;
      let cr = 11 + (8 - 11) * t, cg = 18 + (60 - 18) * t, cb = 32 + (70 - 32) * t;
      let d = Infinity;
      for (let i = 0; i < line.length - 1; i++) d = Math.min(d, segDist(u, v, line[i][0], line[i][1], line[i + 1][0], line[i + 1][1]));
      const last = line[line.length - 1];
      const dot = Math.hypot(u - last[0], v - last[1]);
      if (d < width / 2 || dot < width * 0.9) { cr = 52; cg = 211; cb = 153; } // accent green
      r += cr; g += cg; b += cb; a += 255;
    }
    const n = S * S;
    return [Math.round(r / Math.max(1, a / 255)), Math.round(g / Math.max(1, a / 255)), Math.round(b / Math.max(1, a / 255)), Math.round(a / n)];
  });
}

writeFileSync(join(OUT, "apple-touch-icon.png"), icon(180, { rounded: false, inset: 0.06 })); // iOS rounds it
writeFileSync(join(OUT, "icon-192.png"), icon(192, { rounded: true, inset: 0.04 }));
writeFileSync(join(OUT, "icon-512.png"), icon(512, { rounded: true, inset: 0.04 }));
writeFileSync(join(OUT, "icon-maskable-512.png"), icon(512, { rounded: false, inset: 0.16 }));
writeFileSync(join(OUT, "favicon-32.png"), icon(32, { rounded: true, inset: 0.02 }));
console.log("icons written to web/public/icons");
