/*
 * A QR code, drawn here rather than fetched: the end-of-trial window shows
 * one so the owner's phone opens the payment page by pointing its camera.
 *
 * Byte mode, error correction M, versions 1 to 10: a web address with a
 * serial number fits in version 4 or 5. The algorithm is the standard's
 * (ISO/IEC 18004), in the shape of Project Nayuki's reference implementation
 * (MIT), cut down to what one short address needs.
 *
 * not-a-rule-file: the standard's own tables and constants.
 */

/* Error correction codewords per block, and blocks, for level M, by version (index 0 unused). */
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
const BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
const FORMAT_BITS_M = 0;
const MAX_VERSION = 10;

export type Qr = { size: number; dark: boolean[][] };

export function qrCode(text: string): Qr {
  const bytes = Array.from(new TextEncoder().encode(text));
  let version = 1;
  for (; version <= MAX_VERSION; version++) {
    const countBits = version <= 9 ? 8 : 16;
    if (4 + countBits + bytes.length * 8 <= dataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) throw new Error("too_long");

  /* The data: mode, length, bytes, terminator, then padding to capacity. */
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacity = dataCodewords(version) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(parseInt(bits.slice(i, i + 8).join(""), 2));

  const size = version * 4 + 17;
  const grid = new Grid(size);
  drawFunctionPatterns(grid, version);
  drawCodewords(grid, withErrorCorrection(data, version));

  /* The mask that leaves the fewest confusing patterns. */
  let best = 0;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(grid, mask);
    drawFormatBits(grid, mask);
    const score = penalty(grid);
    if (score < bestPenalty) {
      best = mask;
      bestPenalty = score;
    }
    applyMask(grid, mask);
  }
  applyMask(grid, best);
  drawFormatBits(grid, best);
  return { size, dark: grid.dark };
}

class Grid {
  dark: boolean[][];
  fixed: boolean[][];
  constructor(public size: number) {
    this.dark = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
    this.fixed = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  }
  set(x: number, y: number, dark: boolean) {
    this.dark[y][x] = dark;
    this.fixed[y][x] = true;
  }
}

function rawModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(version: number): number {
  return Math.floor(rawModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];
}

function alignmentPositions(version: number, size: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const result = [6];
  for (let position = size - 7; result.length < count; position -= step) result.splice(1, 0, position);
  return result;
}

function drawFunctionPatterns(grid: Grid, version: number) {
  const size = grid.size;
  for (let i = 0; i < size; i++) {
    grid.set(6, i, i % 2 === 0);
    grid.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) grid.set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = alignmentPositions(version, size);
  const last = positions.length - 1;
  positions.forEach((py, i) =>
    positions.forEach((px, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) grid.set(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    })
  );
  drawFormatBits(grid, 0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i++) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      grid.set(a, b, dark);
      grid.set(b, a, dark);
    }
  }
}

function drawFormatBits(grid: Grid, mask: number) {
  const size = grid.size;
  const data = (FORMAT_BITS_M << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i++) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) grid.set(8, i, bit(i));
  grid.set(8, 7, bit(6));
  grid.set(8, 8, bit(7));
  grid.set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) grid.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) grid.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) grid.set(8, size - 15 + i, bit(i));
  grid.set(8, size - 8, true);
}

function multiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree: number): number[] {
  const result = Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = multiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = multiply(root, 0x02);
  }
  return result;
}

function remainder(data: number[], by: number[]): number[] {
  const result = Array<number>(by.length).fill(0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    by.forEach((coefficient, i) => (result[i] ^= multiply(coefficient, factor)));
  }
  return result;
}

function withErrorCorrection(data: number[], version: number): number[] {
  const blocks = BLOCKS[version];
  const eccLength = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawModules(version) / 8);
  const shortBlocks = blocks - (raw % blocks);
  const shortLength = Math.floor(raw / blocks);
  const by = divisor(eccLength);
  const all: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const part = data.slice(k, k + shortLength - eccLength + (i < shortBlocks ? 0 : 1));
    k += part.length;
    const ecc = remainder(part, by);
    if (i < shortBlocks) part.push(0);
    all.push([...part, ...ecc]);
  }
  const result: number[] = [];
  for (let i = 0; i < all[0].length; i++) {
    all.forEach((block, j) => {
      if (i !== shortLength - eccLength || j >= shortBlocks) result.push(block[i]);
    });
  }
  return result;
}

function drawCodewords(grid: Grid, codewords: number[]) {
  const size = grid.size;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!grid.fixed[y][x] && i < codewords.length * 8) {
          grid.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
          i++;
        }
      }
    }
  }
}

function applyMask(grid: Grid, mask: number) {
  const size = grid.size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (grid.fixed[y][x]) continue;
      const flip = [
        (x + y) % 2 === 0,
        y % 2 === 0,
        x % 3 === 0,
        (x + y) % 3 === 0,
        (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
        ((x * y) % 2) + ((x * y) % 3) === 0,
        (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
        (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
      ][mask];
      if (flip) grid.dark[y][x] = !grid.dark[y][x];
    }
  }
}

/* Long runs, two-by-two blocks and an uneven balance of dark and light: the standard's rules 1, 2 and 4. */
function penalty(grid: Grid): number {
  const size = grid.size;
  const at = (x: number, y: number) => grid.dark[y][x];
  let score = 0;
  for (let a = 0; a < size; a++) {
    for (const along of [(b: number) => at(b, a), (b: number) => at(a, b)]) {
      let run = 1;
      for (let b = 1; b <= size; b++) {
        if (b < size && along(b) === along(b - 1)) run++;
        else {
          if (run >= 5) score += run - 2;
          run = 1;
        }
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(x, y)) dark++;
      if (x < size - 1 && y < size - 1 && at(x, y) === at(x + 1, y) && at(x, y) === at(x, y + 1) && at(x, y) === at(x + 1, y + 1)) score += 3;
    }
  }
  const total = size * size;
  score += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;
  return score;
}

/* The code as one SVG path, with the four-module quiet zone the standard asks for. */
export function qrPath(qr: Qr): { path: string; box: number } {
  const quiet = 4;
  let path = "";
  qr.dark.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    })
  );
  return { path, box: qr.size + quiet * 2 };
}
