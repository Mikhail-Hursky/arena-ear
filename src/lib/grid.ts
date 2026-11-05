import type { GridCell, GridDetection, GridRegion } from '../types';
const FULL: GridRegion = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function createManualGrid(columns: number, rows: number): GridDetection {
  columns = clamp(Math.round(Number.isFinite(columns) ? columns : 8), 1, 30);
  rows = clamp(Math.round(Number.isFinite(rows) ? rows : 10), 1, 30);
  return { columns, rows, confidence: 1, region: { ...FULL }, source: 'manual',
    cells: Array.from({ length: columns * rows }, (_, i) => ({ id: `cell-${Math.floor(i / columns)}-${i % columns}`, row: Math.floor(i / columns), col: i % columns, width: 1, height: 1 })) };
}

/** Finds repeated, axis-aligned borders in actual captured pixels. Returns no guess on blank frames. */
export function detectGrid(image: ImageData, region: GridRegion = FULL): GridDetection | null {
  const primary = detectGridPass(image, region, false);
  if (primary === false) return null; // A clear nonrectangular merge is contradictory evidence.
  return primary ?? (detectGridPass(image, region, true) || null);
}
function detectGridPass(image: ImageData, region: GridRegion, faint: boolean): GridDetection | null | false {
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) return null;
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width <= 0 || image.height <= 0 || image.data.length < image.width * image.height * 4) return null;
  if (region.x < 0 || region.y < 0 || region.x >= 1 || region.y >= 1 || region.width <= 0 || region.height <= 0) return null;
  const x0 = clamp(Math.floor(region.x * image.width), 0, image.width - 1);
  const y0 = clamp(Math.floor(region.y * image.height), 0, image.height - 1);
  const w = Math.min(image.width - x0, Math.floor(clamp(region.width, 0, 1) * image.width));
  const h = Math.min(image.height - y0, Math.floor(clamp(region.height, 0, 1) * image.height));
  if (w < 24 || h < 24) return null;
  const lum = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = ((y + y0) * image.width + x + x0) * 4;
    lum[y * w + x] = image.data[p] * .2126 + image.data[p + 1] * .7152 + image.data[p + 2] * .0722;
  }
  const contrast = (x: number, y: number, vertical: boolean): boolean => {
    const c = lum[y * w + x];
    const a = vertical ? lum[y * w + Math.max(0, x - 3)] : lum[Math.max(0, y - 3) * w + x];
    const b = vertical ? lum[y * w + Math.min(w - 1, x + 3)] : lum[Math.min(h - 1, y + 3) * w + x];
    if (!faint) return Math.max(Math.abs(c - a), Math.abs(c - b)) > 24;
    // Thin light/dark ridges, with low variation along the line, distinguish
    // subdued inventory borders from bright text strokes and item textures.
    const before = vertical ? lum[Math.max(0, y - 2) * w + x] : lum[y * w + Math.max(0, x - 2)];
    const after = vertical ? lum[Math.min(h - 1, y + 2) * w + x] : lum[y * w + Math.min(w - 1, x + 2)];
    return (c - Math.max(a, b) > 5 || Math.min(a, b) - c > 5) && Math.abs(c - before) < 4 && Math.abs(c - after) < 4;
  };
  const findLines = (vertical: boolean): number[] => {
    const length = vertical ? w : h, cross = vertical ? h : w;
    const groups: { sum: number; count: number; last: number; peak: number; strength: number }[] = [];
    for (let i = 0; i < length; i++) {
      let hits = 0;
      for (let j = 0; j < cross; j++) if (contrast(vertical ? i : j, vertical ? j : i, vertical)) hits++;
      if (hits / cross < (faint ? .16 : .36)) continue;
      const last = groups.at(-1);
      if (last && i - last.last <= (faint ? 1 : 3)) { last.sum += i; last.count++; last.last = i; if(hits > last.strength) { last.strength = hits; last.peak = i; } }
      else groups.push({ sum: i, count: 1, last: i, peak: i, strength: hits });
    }
    return groups.map(g => faint ? g.peak : Math.round(g.sum / g.count));
  };
  const xs = findLines(true), ys = findLines(false);
  if (xs.length < 3 || ys.length < 3 || xs.length > 31 || ys.length > 31) return null;
  const lattice = (lines: number[]): number[] | null => {
    if (faint) {
      // Fit repeated spacing while rejecting isolated text/decoration peaks.
      // At least five observed borders must corroborate a shared lattice.
      let best: { lines: number[]; score: number } | null = null;
      for (let a = 0; a < lines.length; a++) for (let b = a + 1; b < lines.length; b++) {
        const step = lines[b] - lines[a];
        if (step < 12 || step > 100) continue;
        const fitted = lines.filter(n => Math.abs((n - lines[a]) / step - Math.round((n - lines[a]) / step)) * step <= 2.5);
        if (fitted.length < 5) continue;
        const count = Math.round((fitted.at(-1)! - fitted[0]) / step);
        if (count > 30 || fitted.length / (count + 1) < .6) continue;
        const score = fitted.length - (count + 1 - fitted.length) * .4;
        if (!best || score > best.score) best = { lines: fitted, score };
      }
      if (!best) return null;
      lines = best.lines;
    }
    const gaps = lines.slice(1).map((n, i) => n - lines[i]);
    const sorted = [...gaps].sort((a, b) => a - b);
    const step = sorted[Math.floor((sorted.length - 1) / 2)];
    if (step < 8) return null;
    if (gaps.some(g => Math.abs(g / step - Math.round(g / step)) > .13 || g / step > 5)) return null;
    const count = Math.round((lines.at(-1)! - lines[0]) / step);
    if (count < 2 || count > 30) return null;
    if (faint) {
      const offsets = lines.map(n => n - Math.round((n - lines[0]) / step) * step).sort((a,b)=>a-b);
      const start = offsets[Math.floor(offsets.length / 2)];
      return Array.from({ length: count + 1 }, (_, i) => start + i * step);
    }
    return Array.from({ length: count + 1 }, (_, i) => lines[0] + (lines.at(-1)! - lines[0]) * i / count);
  };
  const xx = lattice(xs), yy = lattice(ys);
  if (!xx || !yy) return null;
  if (faint) {
    // A thick outer border can disappear from the thin-ridge projections. Add
    // at most one adjacent unit only if a long, actual edge corroborates it.
    const extend = (axis: number[], vertical: boolean) => {
      const step = axis[1] - axis[0], length = vertical ? w : h, cross = vertical ? h : w;
      for (const side of [-1, 1]) {
        const n = side < 0 ? axis[0] - step : axis.at(-1)! + step;
        if (n < 3 || n >= length - 3) continue;
        let hits = 0;
        for (let j = 3; j < cross - 3; j++) {
          let found = false;
          for (let offset = -2; offset <= 2; offset++) {
            const x = Math.round(vertical ? n + offset : j), y = Math.round(vertical ? j : n + offset);
            const c = lum[y*w+x];
            const a = vertical ? lum[y*w+x-3] : lum[(y-3)*w+x];
            const b = vertical ? lum[y*w+x+3] : lum[(y+3)*w+x];
            found ||= Math.max(Math.abs(c-a),Math.abs(c-b)) > 12;
          }
          hits += Number(found);
        }
        if (hits / cross > .7) { if (side < 0) axis.unshift(n); else axis.push(n); }
      }
    };
    extend(xx, true); extend(yy, false);
  }
  const columns = xx.length - 1, rows = yy.length - 1;
  const border = (vertical: boolean, fixed: number, start: number, end: number): number => {
    let hits = 0, total = 0;
    for (let i = Math.ceil(start + 3); i < end - 3; i++) {
      let hit = false;
      for (let offset = -2; offset <= 2; offset++) {
        const x = clamp(Math.round(vertical ? fixed + offset : i), 0, w - 1);
        const y = clamp(Math.round(vertical ? i : fixed + offset), 0, h - 1);
        hit ||= contrast(x, y, vertical);
      }
      hits += Number(hit); total++;
    }
    return total ? hits / total : 0;
  };
  // Require a genuine closed outer frame as protection against text/scene edge detections.
  const outer = [border(true, xx[0], yy[0], yy.at(-1)!), border(true, xx.at(-1)!, yy[0], yy.at(-1)!), border(false, yy[0], xx[0], xx.at(-1)!), border(false, yy.at(-1)!, xx[0], xx.at(-1)!)];
  if (outer.some(n => n < (faint ? .12 : .7))) return null;
  const parent = Array.from({ length: rows * columns }, (_, i) => i);
  const root = (i: number): number => { while (parent[i] !== i) i = parent[i]; return i; };
  const join = (a: number, b: number) => { parent[root(a)] = root(b); };
  for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
    const i = row * columns + col;
    if (col < columns - 1 && border(true, xx[col + 1], yy[row], yy[row + 1]) < (faint ? .12 : .3)) join(i, i + 1);
    if (row < rows - 1 && border(false, yy[row + 1], xx[col], xx[col + 1]) < (faint ? .12 : .3)) join(i, i + columns);
  }
  const groups = new Map<number, number[]>();
  parent.forEach((_, i) => { const r = root(i); groups.set(r, [...(groups.get(r) ?? []), i]); });
  const cells: GridCell[] = [];
  for (const members of groups.values()) {
    const r = members.map(i => Math.floor(i / columns)), c = members.map(i => i % columns);
    const row = Math.min(...r), col = Math.min(...c), width = Math.max(...c) - col + 1, height = Math.max(...r) - row + 1;
    if (width * height !== members.length) {
      if (!faint) return false;
      // Occluded/ambiguous components are omitted, never filled with invented slots.
      continue;
    }
    cells.push({ id: `cell-${row}-${col}`, row, col, width, height });
  }
  if (cells.length < 4 || (faint && cells.reduce((sum,cell)=>sum+cell.width*cell.height,0) < columns*rows*.6)) return null;
  return { cells: cells.sort((a, b) => a.row - b.row || a.col - b.col), columns, rows,
    confidence: faint ? .68 : Math.min(.92, .65 + outer.reduce((a, b) => a + b, 0) / 4 * .25), source: 'detected',
    region: { x: (x0 + xx[0]) / image.width, y: (y0 + yy[0]) / image.height, width: (xx.at(-1)! - xx[0]) / image.width, height: (yy.at(-1)! - yy[0]) / image.height } };
}
