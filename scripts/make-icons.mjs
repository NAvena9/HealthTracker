// One-off generator for the PWA icons. Built-ins only (node:zlib, node:fs).
// Usage: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Brand gradient (matches the header logo): orange -> red -> indigo, 135deg.
const STOPS = [
  [0, [255, 149, 0]],
  [0.6, [255, 59, 48]],
  [1, [94, 92, 230]],
];
function gradient(t) {
  for (let i = 1; i < STOPS.length; i++) {
    if (t <= STOPS[i][0]) {
      const [t0, c0] = STOPS[i - 1];
      const [t1, c1] = STOPS[i];
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, k) => v + (c1[k] - v) * f);
    }
  }
  return STOPS[STOPS.length - 1][1];
}

// Pulse mark in a 24x24 box: M3 12h4l2.5-6 4 12 2.5-6H21
const MARK = [[3, 12], [7, 12], [9.5, 6], [13.5, 18], [16, 12], [21, 12]];
function distSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

function render(size, markScale) {
  const rgb = Buffer.alloc(size * size * 3);
  const SS = 3; // supersampling per axis
  const stroke = 2.6; // in 24-unit box
  const scale = (size * markScale) / 24;
  const off = (size - 24 * scale) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bg = gradient((x + y) / (2 * size));
      let cov = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (x + (sx + 0.5) / SS - off) / scale;
          const uy = (y + (sy + 0.5) / SS - off) / scale;
          let d = Infinity;
          for (let i = 0; i < MARK.length - 1; i++) d = Math.min(d, distSeg(ux, uy, MARK[i], MARK[i + 1]));
          if (d <= stroke / 2) cov++;
        }
      }
      const a = cov / (SS * SS);
      const o = (y * size + x) * 3;
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.round(bg[k] * (1 - a) + 255 * a);
    }
  }
  return png(size, rgb);
}

const files = [
  ['icon-192.png', 192, 0.62],
  ['icon-512.png', 512, 0.62],
  ['icon-maskable-512.png', 512, 0.5], // mark stays inside the 80% safe zone
  ['apple-touch-icon.png', 180, 0.62],
];
for (const [name, size, scale] of files) {
  writeFileSync(join(out, name), render(size, scale));
  console.log('wrote', name);
}
