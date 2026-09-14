/**
 * Generate standalone valid PNG icons for PWA
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function createSolidPng(width, height, r, g, b) {
  // Simple uncompressed or deflate PNG generator
  const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type truecolor (RGB)
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk('IHDR', ihdrData);

  // Scanlines with Plum / Warm Pink gradient and emblem
  const scanlines = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;

  const cx = width / 2;
  const cy = height / 2;
  const radius = width * 0.42;

  for (let y = 0; y < height; y++) {
    scanlines[offset++] = 0; // Filter type 0 (None)
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist < radius) {
        // Warm Plum & Pink emblem gradient
        const t = (x + y) / (width + height);
        const pr = Math.round(74 * (1 - t) + 217 * t);
        const pg = Math.round(29 * (1 - t) + 93 * t);
        const pb = Math.round(54 * (1 - t) + 125 * t);
        scanlines[offset++] = pr;
        scanlines[offset++] = pg;
        scanlines[offset++] = pb;
      } else {
        // Soft cream background #FAF7F5
        scanlines[offset++] = 250;
        scanlines[offset++] = 247;
        scanlines[offset++] = 245;
      }
    }
  }

  const idatCompressed = zlib.deflateSync(scanlines);
  const idat = makeChunk('IDAT', idatCompressed);
  const iend = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function crc32(buf) {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const table = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  table[i] = c;
}

const iconsDir = path.join(__dirname, '..', 'public', 'assets', 'icons');
fs.mkdirSync(iconsDir, { recursive: true });

fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), createSolidPng(192, 192, 74, 29, 54));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), createSolidPng(512, 512, 74, 29, 54));
console.log('PNG icons created successfully in:', iconsDir);
