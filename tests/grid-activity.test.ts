import { describe, expect, it } from 'vitest';
import { GridActivityTracker, cellAtPoint, gridSignature } from '../src/lib/grid-activity';
import { createManualGrid } from '../src/lib/grid';
import type { GridDetection } from '../src/types';

const grid: GridDetection = { ...createManualGrid(4, 4), source: 'detected', confidence: .9 };
function frame(changed: number[] = [], shift = 0): ImageData {
  const width = 160, height = 160, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = Math.floor(y / 40) * 4 + Math.floor(x / 40);
    const p = (y * width + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = 25 + shift + (changed.includes(cell) ? 45 : 0);
    data[p + 3] = 255;
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}
function ready() {
  const tracker = new GridActivityTracker();
  tracker.update(frame(), grid, 0);
  tracker.update(frame(), grid, 120);
  return tracker;
}
describe('visual sound-to-cell association', () => {
  it('associates one localized change only after a stable baseline', () => {
    const tracker = ready();
    expect(tracker.update(frame([5]), grid, 240)).toEqual({ changedView: false, cellId: 'cell-1-1', changedCells:['cell-1-1'] });
    expect(tracker.target(250)).toBe('cell-1-1');
  });
  it('does not assign two changed cells or a sound without visual activity', () => {
    const tracker = ready();
    expect(tracker.target(130)).toBeUndefined();
    expect(tracker.update(frame([5, 6]), grid, 240).cellId).toBeUndefined();
    expect(tracker.target(250)).toBeUndefined();
  });
  it('invalidates a scrolled or globally changed view even with identical geometry', () => {
    const tracker = ready();
    tracker.update(frame([5]), grid, 240);
    expect(tracker.update(frame([], 40), grid, 360).changedView).toBe(true);
    expect(tracker.target(370)).toBeUndefined();
  });
  it('rejects stale frames, stale changes, manual grids and uncertain geometry', () => {
    const tracker = ready(); tracker.update(frame([5]), grid, 240);
    expect(tracker.target(550)).toBeUndefined();
    tracker.update(frame([5]), grid, 560);
    expect(tracker.target(610)).toBeUndefined();
    for (const uncertain of [{ ...grid, source: 'manual' as const }, { ...grid, confidence: .68 }]) {
      const other = new GridActivityTracker();
      other.update(frame(), uncertain, 0); other.update(frame(), uncertain, 120);
      expect(other.update(frame([5]), uncertain, 240).cellId).toBeUndefined();
    }
  });
  it('resets candidates when crop moves and includes crop in geometry identity', () => {
    const tracker = ready(); tracker.update(frame([5]), grid, 240);
    const moved = { ...grid, region: { x: .1, y: 0, width: .9, height: 1 } };
    expect(gridSignature(grid)).not.toBe(gridSignature(moved));
    tracker.update(frame([5]), moved, 250);
    expect(tracker.target(260)).toBeUndefined();
  });
  it('maps preview clicks to merged rectangles, rejecting outside and invalid points', () => {
    const merged = { ...grid, cells: [{ id:'merged', row:1, col:1, width:2, height:2 }] };
    expect(cellAtPoint(merged, { x:.6, y:.6 })?.id).toBe('merged');
    expect(cellAtPoint(merged, { x:.1, y:.1 })).toBeUndefined();
    expect(cellAtPoint(merged, { x:NaN, y:.5 })).toBeUndefined();
  });
});
