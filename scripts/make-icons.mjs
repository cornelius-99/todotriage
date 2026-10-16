// Renders the app icon (gradient tile + check mark) to PNGs without any image dependencies.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
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

function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// Coordinates in a 0..1 unit square.
const CHECK = [
  [0.29, 0.52],
  [0.43, 0.66],
  [0.72, 0.36],
];
const STROKE = 0.085;
const A = [0xef, 0x6a, 0x4c];
const B = [0xd6, 0x3f, 0x4f];

function render(size, { rounded }) {
  const out = Buffer.alloc(size * size * 4);
  const SS = 4;
  const r = rounded ? 0.225 : 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let cover = 0;
      let white = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / size;
          const v = (y + (sy + 0.5) / SS) / size;
          const cx = Math.min(Math.max(u, r), 1 - r);
          const cy = Math.min(Math.max(v, r), 1 - r);
          if (r && Math.hypot(u - cx, v - cy) > r) continue;
          cover++;
          const d = Math.min(distToSegment(u, v, ...CHECK[0], ...CHECK[1]), distToSegment(u, v, ...CHECK[1], ...CHECK[2]));
          if (d < STROKE / 2) white++;
        }
      }
      const n = SS * SS;
      const t = (x / size + y / size) / 2;
      const w = cover ? white / cover : 0;
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round((A[c] + (B[c] - A[c]) * t) * (1 - w) + 255 * w);
      out[i + 3] = Math.round((cover / n) * 255);
    }
  }
  return png(size, out);
}

// iOS applies its own corner mask, so the touch icon is a full square.
writeFileSync('public/apple-touch-icon.png', render(180, { rounded: false }));
writeFileSync('public/icon-192.png', render(192, { rounded: true }));
writeFileSync('public/icon-512.png', render(512, { rounded: true }));
writeFileSync('public/icon-maskable-512.png', render(512, { rounded: false }));
console.log('icons written');
