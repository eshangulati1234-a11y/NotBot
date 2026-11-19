export interface HelperMark {
  cells: boolean[];
  tone: 1 | 2 | 3 | 4 | 5 | 6;
}

const GRID = 5;
const HALF = 3;

/** FNV-1a, 32 bit. */
function fnv(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 5x5 grid (row-major, 25 cells) mirrored left-right from 3 generated columns. */
export function helperMark(name: string): HelperMark {
  const key = name.trim().toLowerCase();
  const h = fnv(key);
  const h2 = fnv(`${key}#2`);
  const bits = Array.from({ length: GRID * HALF }, (_, i) =>
    i < 16 ? ((h >>> i) & 1) === 1 : ((h2 >>> (i - 16)) & 1) === 1,
  );
  const cells: boolean[] = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      const source = col < HALF ? col : GRID - 1 - col;
      cells.push(bits[row * HALF + source]);
    }
  }
  if (!cells.some(Boolean)) cells[12] = true;
  return { cells, tone: ((h2 >>> 20) % 6 + 1) as HelperMark['tone'] };
}
