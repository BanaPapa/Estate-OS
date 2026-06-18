import * as zlib from 'zlib';

function crc32(data: Buffer): number {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBytes = Buffer.alloc(4);
  crcBytes.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([len, typeBytes, data, crcBytes]);
}

function inRoundedRect(x: number, y: number, w: number, h: number, r: number): boolean {
  if (x < r && y < r) return (x - r) ** 2 + (y - r) ** 2 <= r * r;
  if (x >= w - r && y < r) return (x - (w - r - 1)) ** 2 + (y - r) ** 2 <= r * r;
  if (x < r && y >= h - r) return (x - r) ** 2 + (y - (h - r - 1)) ** 2 <= r * r;
  if (x >= w - r && y >= h - r) return (x - (w - r - 1)) ** 2 + (y - (h - r - 1)) ** 2 <= r * r;
  return true;
}

// "E" in a 14×14 box centered at (9, 9) within 32×32
function isEPixel(x: number, y: number): boolean {
  const ox = 9, oy = 9;
  const lx = x - ox, ly = y - oy;
  if (lx < 0 || lx > 13 || ly < 0 || ly > 13) return false;
  if (lx <= 2) return true;          // vertical bar (full height)
  if (ly <= 1) return true;          // top horizontal bar
  if (ly >= 6 && ly <= 7 && lx <= 9) return true;  // middle bar (shorter)
  if (ly >= 12 && ly <= 13) return true;  // bottom horizontal bar
  return false;
}

export function buildEIconPng(): Buffer {
  const W = 32, H = 32;
  const pixelData = Buffer.alloc(W * H * 4, 0); // transparent default

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (!inRoundedRect(x, y, W, H, 5)) continue;

      if (isEPixel(x, y)) {
        // Blue (#4f8dff) → teal (#00d4aa) gradient top-to-bottom within E bounds
        const t = Math.max(0, Math.min(1, (y - 9) / 13));
        pixelData[i]     = Math.round(0x4f * (1 - t));
        pixelData[i + 1] = Math.round(0x8d * (1 - t) + 0xd4 * t);
        pixelData[i + 2] = Math.round(0xff * (1 - t) + 0xaa * t);
        pixelData[i + 3] = 0xff;
      } else {
        // Dark background
        pixelData[i] = 0x0d; pixelData[i + 1] = 0x11;
        pixelData[i + 2] = 0x17; pixelData[i + 3] = 0xff;
      }
    }
  }

  // Filtered rows: one None-filter byte per row
  const rows: Buffer[] = [];
  for (let y = 0; y < H; y++) {
    rows.push(Buffer.from([0]));
    rows.push(pixelData.subarray(y * W * 4, (y + 1) * W * 4));
  }
  const compressed = zlib.deflateSync(Buffer.concat(rows), { level: 6 });

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
