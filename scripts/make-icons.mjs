// Draws the app icon (a stack of task cards, the top one checked off and swiped away) once, then writes it as an SVG and
// renders it to PNGs without any image dependencies.
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

// The artwork, on a 64×64 tile. Shapes in the SWIPED frame are drawn relative to the front card's centre, tilted with it.
const GRADIENT = ['#ef6a4c', '#d63f4f'];
const TILE_RADIUS = 14;
const SWIPED = { x: 34.5, y: 40, deg: 10 };
const SHAPES = [
  // The rest of the queue, peeking out behind.
  { rect: [19.5, 11, 25, 20], radius: 4, fill: '#ec918a' },
  { rect: [15.5, 15.5, 33, 24], radius: 5, fill: '#f6c4be' },
  // The card being swiped right: shadow, card, check.
  { frame: SWIPED, rect: [-18.6, -11.9, 38, 27], radius: 5.5, fill: '#7a1f1f', opacity: 0.3, blur: 1.5 },
  { frame: SWIPED, rect: [-19, -13.5, 38, 27], radius: 5.5, fill: '#ffffff' },
  { frame: SWIPED, path: [[-8, 0.5], [-2.5, 6], [9, -5.5]], width: 4.6, stroke: '#dc4c3e' },
];

function svg() {
  const defs = [
    `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${GRADIENT[0]}"/><stop offset="1" stop-color="${GRADIENT[1]}"/></linearGradient>`,
  ];
  const body = [`<rect width="64" height="64" rx="${TILE_RADIUS}" fill="url(#g)"/>`];
  SHAPES.forEach((s, i) => {
    let el = s.rect
      ? `<rect x="${s.rect[0]}" y="${s.rect[1]}" width="${s.rect[2]}" height="${s.rect[3]}" rx="${s.radius}" fill="${s.fill}"`
      : `<path d="M${s.path.join(' ')}" fill="none" stroke="${s.stroke}" stroke-width="${s.width}" stroke-linecap="round" stroke-linejoin="round"`;
    if (s.opacity) el += ` opacity="${s.opacity}"`;
    if (s.blur) {
      defs.push(`<filter id="b${i}" x="-25%" y="-25%" width="150%" height="150%"><feGaussianBlur stdDeviation="${s.blur}"/></filter>`);
      el += ` filter="url(#b${i})"`;
    }
    if (s.frame) el += ` transform="translate(${s.frame.x} ${s.frame.y}) rotate(${s.frame.deg})"`;
    body.push(`${el}/>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <defs>\n    ${defs.join('\n    ')}\n  </defs>\n  ${body.join('\n  ')}\n</svg>\n`;
}

const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function roundedRectDist(px, py, [x, y, w, h], r) {
  const qx = Math.abs(px - x - w / 2) - w / 2 + r;
  const qy = Math.abs(py - y - h / 2) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Signed distance from a point on the tile to the edge of a shape: negative inside. */
function distance(s, x, y) {
  if (s.frame) {
    const a = (-s.frame.deg * Math.PI) / 180;
    const dx = x - s.frame.x;
    const dy = y - s.frame.y;
    x = dx * Math.cos(a) - dy * Math.sin(a);
    y = dx * Math.sin(a) + dy * Math.cos(a);
  }
  if (s.rect) return roundedRectDist(x, y, s.rect, s.radius);
  let d = Infinity;
  for (let i = 1; i < s.path.length; i++) d = Math.min(d, distToSegment(x, y, ...s.path[i - 1], ...s.path[i]));
  return d - s.width / 2;
}

// `scale` shrinks the artwork (not the tile) around the centre, to keep it inside a maskable icon's safe zone.
function render(size, { rounded, scale = 1 }) {
  const out = Buffer.alloc(size * size * 4);
  const unit = size / 64;
  const [A, B] = GRADIENT.map(hex);
  const layers = SHAPES.map((s) => ({ ...s, rgb: hex(s.fill ?? s.stroke) }));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / unit;
      const v = (y + 0.5) / unit;
      const t = (u + v) / 128;
      let rgb = A.map((a, c) => a + (B[c] - a) * t);
      const su = 32 + (u - 32) / scale;
      const sv = 32 + (v - 32) / scale;
      for (const s of layers) {
        const d = distance(s, su, sv);
        // A Gaussian blur's edge is close to a smoothstep over ±2σ; sharp edges are antialiased over one pixel.
        const k = s.blur ? 1 - smoothstep(-2 * s.blur, 2 * s.blur, d) : clamp01(0.5 - d * unit * scale);
        rgb = rgb.map((c, i) => c + (s.rgb[i] - c) * k * (s.opacity ?? 1));
      }
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) out[i + c] = Math.round(rgb[c]);
      out[i + 3] = rounded ? Math.round(clamp01(0.5 - roundedRectDist(u, v, [0, 0, 64, 64], TILE_RADIUS) * unit) * 255) : 255;
    }
  }
  return png(size, out);
}

writeFileSync('public/icon.svg', svg());
// iOS applies its own corner mask, so the touch icon is a full square.
writeFileSync('public/apple-touch-icon.png', render(180, { rounded: false }));
writeFileSync('public/icon-192.png', render(192, { rounded: true }));
writeFileSync('public/icon-300.png', render(300, { rounded: true }));
writeFileSync('public/icon-512.png', render(512, { rounded: true }));
writeFileSync('public/icon-maskable-512.png', render(512, { rounded: false, scale: 0.85 }));
console.log('icons written');
