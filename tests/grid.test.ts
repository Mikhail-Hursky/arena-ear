import { afterEach, describe, expect, it, vi } from 'vitest';
import { GridScanner } from '../src/lib/capture';
import { createManualGrid, detectGrid } from '../src/lib/grid';
function image(merged = false): ImageData {
  const width = 150, height = 150, data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = [15, 45, 75, 105, 135].includes(x) && y >= 15 && y <= 135 && !(merged && x === 45 && y > 15 && y < 45);
    const h = [15, 45, 75, 105, 135].includes(y) && x >= 15 && x <= 135;
    const p = (y * width + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = v || h ? 180 : 20; data[p + 3] = 255;
  }
  return { width, height, data, colorSpace: 'srgb' } as ImageData;
}
describe('pixel grid detection', () => {
  it('rejects a blank image', () => { const blank = image(); blank.data.fill(0); expect(detectGrid(blank)).toBeNull(); });
  it('detects visible grid lines and normalized bounds', () => { const d = detectGrid(image()); expect(d?.columns).toBe(4); expect(d?.rows).toBe(4); expect(d?.cells).toHaveLength(16); expect(d?.region.x).toBeCloseTo(.1, 1); });
  it('detects a rectangular merged cell from an absent local separator', () => { const d = detectGrid(image(true)); expect(d?.cells).toHaveLength(15); expect(d?.cells[0]).toMatchObject({ row: 0, col: 0, width: 2, height: 1 }); });
  it('rejects region outside the image', () => { expect(detectGrid(image(), { x: 1, y: 1, width: 0, height: 0 })).toBeNull(); });
  it('builds a bounded manual grid', () => { expect(createManualGrid(3, 2).cells).toHaveLength(6); });
  it('creates all merchant positions including the final row and column', () => {
    const grid = createManualGrid(9,30);
    expect(grid.cells).toHaveLength(270);
    expect(grid.cells.at(-1)).toMatchObject({id:'cell-29-8',row:29,col:8});
  });
});

function eraseLine(frame: ImageData, vertical: boolean, fixed: number, from: number, to: number) {
  for (let i = from; i <= to; i++) {
    const p = ((vertical ? i : fixed) * frame.width + (vertical ? fixed : i)) * 4;
    frame.data[p] = frame.data[p + 1] = frame.data[p + 2] = 20;
  }
}
describe('conservative grid geometry', () => {
  it('rejects an L-shaped connected merged region', () => {
    const frame = image(true);
    eraseLine(frame, false, 45, 16, 44);
    expect(detectGrid(frame)).toBeNull();
  });
  it('detects a two-by-two rectangle among unit cells', () => {
    const frame = image();
    eraseLine(frame, true, 45, 16, 74);
    eraseLine(frame, false, 45, 16, 74);
    const d = detectGrid(frame);
    expect(d?.cells).toHaveLength(13);
    expect(d?.cells[0]).toMatchObject({ row: 0, col: 0, width: 2, height: 2 });
  });
  it('finds a grid inside a normalized crop', () => {
    const d = detectGrid(image(), { x: .05, y: .05, width: .9, height: .9 });
    expect(d?.columns).toBe(4);
    expect(d?.region.x).toBeCloseTo(.1, 1);
    expect(d?.region.width).toBeCloseTo(.8, 1);
  });
  it('rejects nonfinite and negative regions', () => {
    expect(detectGrid(image(), { x: NaN, y: 0, width: 1, height: 1 })).toBeNull();
    expect(detectGrid(image(), { x: -.2, y: 0, width: .5, height: 1 })).toBeNull();
    expect(detectGrid(image(), { x: 0, y: 0, width: -1, height: 1 })).toBeNull();
  });
  it('rejects deterministic noisy pixels', () => {
    const frame = image();
    let seed = 123456;
    for (let i = 0; i < frame.data.length; i += 4) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      frame.data[i] = frame.data[i + 1] = frame.data[i + 2] = seed % 256;
    }
    expect(detectGrid(frame)).toBeNull();
  });
  it('rejects short textlike strokes without a closed inventory border', () => {
    const frame = image(); frame.data.fill(20);
    for (let y = 15; y < 130; y += 18) for (let x = 10; x < 130; x += 11) {
      for (let dy = 0; dy < 9; dy++) for (let dx = 0; dx < 5; dx++) {
        if (dx !== 0 && dy !== 0 && dy !== 8) continue;
        const p = ((y + dy) * frame.width + x + dx) * 4;
        frame.data[p] = frame.data[p + 1] = frame.data[p + 2] = 200;
      }
    }
    expect(detectGrid(frame)).toBeNull();
  });
});


describe('scanner lifecycle', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function dom(play: () => Promise<void> = () => Promise.resolve(), getFrame = () => image()) {
    const videos: { pause: ReturnType<typeof vi.fn>; srcObject: unknown; play: typeof play; muted: boolean; playsInline: boolean; readyState: number; videoWidth: number; videoHeight: number }[] = [];
    vi.stubGlobal('document', { createElement: (tag: string) => {
      if (tag === 'video') {
        const video = { play, pause: vi.fn(), srcObject: null, muted: false, playsInline: false, readyState: 2, videoWidth: 150, videoHeight: 150 };
        videos.push(video); return video;
      }
      return { width: 0, height: 0, getContext: () => ({ drawImage: vi.fn(), getImageData: getFrame }) };
    } });
    return videos;
  }
  const stream = {} as MediaStream;
  it('cleans up when video playback fails', async () => {
    vi.useFakeTimers(); const error = new Error('Playback failed');
    const videos = dom(() => Promise.reject(error));
    const scanner = new GridScanner({ onDetection: vi.fn() });
    await expect(scanner.start(stream)).rejects.toThrow('Playback failed');
    expect(videos[0].srcObject).toBeNull(); expect(videos[0].pause).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('does not restart after stop while play is pending', async () => {
    vi.useFakeTimers(); let resolve!: () => void;
    const videos = dom(() => new Promise<void>(r => { resolve = r; }));
    const onDetection = vi.fn(); const scanner = new GridScanner({ onDetection });
    const pending = scanner.start(stream); scanner.stop(); resolve(); await pending;
    expect(videos[0].srcObject).toBeNull(); expect(onDetection).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops and reports callback errors without leaving a timer', async () => {
    vi.useFakeTimers(); const videos = dom(); const error = new Error('Consumer failure'); const onError = vi.fn();
    const scanner = new GridScanner({ onDetection: () => { throw error; }, onError });
    await scanner.start(stream);
    expect(onError).toHaveBeenCalledWith(error); expect(videos[0].srcObject).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps a newer start alive when an older play fails', async () => {
    vi.useFakeTimers(); let reject!: (error: Error) => void; let calls = 0;
    const videos = dom(() => ++calls === 1 ? new Promise<void>((_, r) => { reject = r; }) : Promise.resolve());
    const scanner = new GridScanner({ onDetection: vi.fn() });
    const old = scanner.start(stream); await scanner.start(stream);
    reject(new Error('Old aborted play')); await old;
    expect(videos[1].srcObject).toBe(stream); expect(vi.getTimerCount()).toBe(1);
    scanner.stop(); expect(vi.getTimerCount()).toBe(0);
  });
  it('withdraws trusted geometry when the grid disappears or scanning is disabled', async () => {
    vi.useFakeTimers();
    let frame = image(); dom(undefined, () => frame);
    const onViewChange = vi.fn();
    const scanner = new GridScanner({ onDetection:vi.fn(), onViewChange });
    await scanner.start(stream);
    expect(scanner.hasFreshDetection()).toBe(true);
    frame = image(); frame.data.fill(0);
    await vi.advanceTimersByTimeAsync(750);
    expect(onViewChange).toHaveBeenCalledWith('lost');
    expect(scanner.hasFreshDetection()).toBe(false);
    frame = image(); await vi.advanceTimersByTimeAsync(750);
    expect(scanner.hasFreshDetection()).toBe(true);
    scanner.setEnabled(false);
    expect(scanner.hasFreshDetection()).toBe(false);
    scanner.stop(); expect(scanner.eventTarget()).toBeUndefined();
  });
  it('samples fresh localized activity synchronously at audio onset', async () => {
    vi.useFakeTimers(); let frame = image(); dom(undefined, () => frame);
    const scanner = new GridScanner({ onDetection:vi.fn() });
    await scanner.start(stream); await vi.advanceTimersByTimeAsync(250);
    frame = image();
    for (let y = 49; y < 72; y++) for (let x = 49; x < 72; x++) {
      const p = (y * frame.width + x) * 4;
      frame.data[p] = frame.data[p + 1] = frame.data[p + 2] = 100;
    }
    expect(scanner.eventTarget()).toBe('cell-1-1');
    scanner.stop();
  });
});

describe('subdued inventory borders', () => {
  function subdued() {
    const frame = image();
    // Abstract low-contrast borders: dark gray dividers on a near-black panel.
    // These are generated pixels, not copied tutorial image assets.
    for (let p = 0; p < frame.data.length; p += 4) {
      const line = frame.data[p] === 180;
      frame.data[p] = frame.data[p + 1] = frame.data[p + 2] = line ? 35 : 17;
    }
    return frame;
  }
  it('detects repeated faint lines that are below the bright-edge threshold', () => {
    const d = detectGrid(subdued());
    expect(d?.columns).toBe(4); expect(d?.rows).toBe(4);
    expect(d?.cells).toHaveLength(16);
    expect(d?.confidence).toBeLessThan(.75);
  });
  it('recovers faint rectangular merged geometry', () => {
    const frame = subdued();
    for (let y = 16; y <= 74; y++) {
      const p = (y * frame.width + 45) * 4;
      frame.data[p] = frame.data[p+1] = frame.data[p+2] = 17;
    }
    for (let x = 16; x <= 74; x++) {
      const p = (45 * frame.width + x) * 4;
      frame.data[p] = frame.data[p+1] = frame.data[p+2] = 17;
    }
    const d = detectGrid(frame);
    expect(d?.cells[0]).toMatchObject({ row: 0, col: 0, width: 2, height: 2 });
    expect(d?.cells).toHaveLength(13);
  });
});
