import type { GridCell, GridDetection } from '../types';

export function gridSignature(grid: GridDetection): string {
  return JSON.stringify([grid.source, grid.columns, grid.rows,
    Object.values(grid.region).map(n => Math.round(n * 1000)),
    grid.cells.map(c => [c.id, c.row, c.col, c.width, c.height])]);
}

export function cellAtPoint(grid: GridDetection, point: { x: number; y: number }): GridCell | undefined {
  if (![point.x, point.y].every(Number.isFinite)) return;
  const col = (point.x - grid.region.x) / grid.region.width * grid.columns;
  const row = (point.y - grid.region.y) / grid.region.height * grid.rows;
  return grid.cells.find(c => col >= c.col && col < c.col + c.width && row >= c.row && row < c.row + c.height);
}

function fingerprint(image: ImageData, grid: GridDetection): number[][] {
  return grid.cells.map(cell => {
    const values: number[] = [];
    for (let sy = 0; sy < 6; sy++) for (let sx = 0; sx < 6; sx++) {
      // Interior patch means suppress isolated cursor pixels and thin borders.
      const x = (grid.region.x + (cell.col + cell.width * (.12 + sx * .152)) / grid.columns * grid.region.width) * image.width;
      const y = (grid.region.y + (cell.row + cell.height * (.12 + sy * .152)) / grid.rows * grid.region.height) * image.height;
      for (let channel = 0; channel < 3; channel++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const px = Math.max(0, Math.min(image.width - 1, Math.round(x) + dx));
          const py = Math.max(0, Math.min(image.height - 1, Math.round(y) + dy));
          sum += image.data[(py * image.width + px) * 4 + channel];
        }
        values.push(sum / 9);
      }
    }
    return values;
  });
}

/** A conservative frame heuristic. No activity or multiple changed cells means no target. */
export class GridActivityTracker {
  private previous?: number[][];
  private signature = '';
  private stableFrames = 0;
  private lastFrame = -Infinity;
  private candidate?: { cellId: string; time: number };

  reset(): void {
    this.previous = undefined; this.signature = ''; this.stableFrames = 0;
    this.lastFrame = -Infinity; this.candidate = undefined;
  }
  target(now: number): string | undefined {
    return this.candidate && now - this.lastFrame <= 250 && now - this.candidate.time <= 350
      ? this.candidate.cellId : undefined;
  }
  update(image: ImageData, grid: GridDetection, now: number): { changedView: boolean; cellId?: string; changedCells?: string[] } {
    if (grid.source !== 'detected' || grid.confidence < .75 || !image.width || !image.height) {
      this.reset(); return { changedView: false };
    }
    const next = fingerprint(image, grid), signature = gridSignature(grid);
    const previous = this.previous;
    this.previous = next; this.lastFrame = now;
    if (!previous || signature !== this.signature) {
      this.signature = signature; this.stableFrames = 1; this.candidate = undefined;
      return { changedView: false };
    }
    const scores = next.map((values, i) => {
      const differences = values.map((v, j) => Math.abs(v - previous[i][j]));
      return { index: i, score: differences.reduce((n, v) => n + v, 0) / differences.length,
        fraction: differences.filter(v => v >= 14).length / differences.length };
    }).sort((a, b) => b.score - a.score);
    const changed = scores.filter(s => s.score >= 12 && s.fraction >= .3);
    if (changed.length >= Math.max(3, Math.ceil(grid.cells.length * .35))) {
      this.stableFrames = 0; this.candidate = undefined;
      return { changedView: true };
    }
    if (changed.length === 1 && this.stableFrames >= 2 && (scores[1]?.score ?? 0) < changed[0].score * .4) {
      this.candidate = { cellId: grid.cells[changed[0].index].id, time: now };
      this.stableFrames = 0;
    } else if (changed.length) {
      this.candidate = undefined; this.stableFrames = 0;
    } else this.stableFrames = Math.min(2, this.stableFrames + 1);
    return { changedView: false, cellId: this.target(now),
      ...(changed.length ? { changedCells:changed.map(s => grid.cells[s.index].id) } : {}) };
  }
}
