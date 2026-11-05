import { describe, expect, it, vi } from 'vitest';
import { classifyFeatures, encodeWav, extractFeatures, featureSimilarity, AudioEngine, FEATURE_LENGTH, createReference, analyzeFile } from '../src/lib/audio';
import type { SoundReference } from '../src/types';
const tone = (frequency: number, amplitude = 0.5, rate = 16000) => Float32Array.from({ length: rate / 2 }, (_, i) => amplitude * Math.sin(2 * Math.PI * frequency * i / rate));
const reference = (frequency: number, name: string): SoundReference => ({ id: name, name, rarity: 'common', features: extractFeatures(tone(frequency), 16000), duration: 0.5, sampleRate: 16000, createdAt: 0 });
describe('local audio matching', () => {
  it('rejects silence and impulses', () => {
    expect(extractFeatures(new Float32Array(8000), 16000)).toEqual([]);
    const impulse = new Float32Array(8000); impulse[200] = 1;
    expect(extractFeatures(impulse, 16000)).toEqual([]);
  });
  it('matches across gain and sample rates', () => {
    const original = reference(440, 'A');
    const features = extractFeatures(tone(440, 0.025, 48000), 48000);
    expect(featureSimilarity(features, original.features)).toBeGreaterThan(0.98);
    expect(classifyFeatures(features, [original, reference(1200, 'B')]).name).toBe('A');
  });
  it('rejects unrelated tones and requires references', () => {
    const features = extractFeatures(tone(2000), 16000);
    expect(classifyFeatures(features, [reference(440, 'A')]).status).toBe('unknown');
    expect(classifyFeatures(features, []).status).toBe('unknown');
  });
  it('refuses ambiguous item labels', () => {
    expect(classifyFeatures(reference(440, 'A').features, [reference(440, 'A'), reference(440, 'B')]).reason).toContain('Неоднозначное');
  });
  it('encodes actual PCM and rejects capture without a running source', async () => {
    const blob = encodeWav(new Float32Array([0, 1, -1]), 8000);
    const bytes = new DataView(await blob.arrayBuffer());
    expect(blob.type).toBe('audio/wav'); expect(bytes.getUint32(24, true)).toBe(8000);
    expect(bytes.getInt16(46, true)).toBe(32767); expect(bytes.getInt16(48, true)).toBe(-32768);
    await expect(new AudioEngine().captureSample()).rejects.toThrow('подключите');
  });
});

describe('descriptor and input boundaries', () => {
  it('rejects malformed imported descriptors without false perfect matches', () => {
    const good = reference(440, 'A').features;
    for (const bad of [[], new Array(FEATURE_LENGTH).fill(0), new Array(FEATURE_LENGTH).fill(100000), good.map(v => -v), good.map(() => NaN), good.map(() => Infinity)]) {
      expect(featureSimilarity(good, bad)).toBe(0);
      expect(classifyFeatures(good, [{ ...reference(440, 'bad'), features: bad }], 0).status).toBe('unknown');
    }
    expect(featureSimilarity(good, good.map(v => v * 0.2))).toBeCloseTo(1, 10);
  });
  it('retains a match under moderate deterministic background noise', () => {
    const samples = tone(440, 0.08, 44100);
    for (let i = 0; i < samples.length; i++) samples[i] += 0.004 * Math.sin(i * 124.23);
    expect(classifyFeatures(extractFeatures(samples, 44100), [reference(440, 'A'), reference(1200, 'B')]).name).toBe('A');
  });
  it('rejects oversized files and invalid labels before allocating an AudioContext', async () => {
    const large = new Blob([new Uint8Array(20 * 1024 * 1024 + 1)]);
    await expect(analyzeFile(large, [])).rejects.toThrow('20 МБ');
    await expect(createReference(new Blob(), 'x'.repeat(121), 'common')).rejects.toThrow('120');
    await expect(createReference(new Blob(), 'A', 'invalid' as never)).rejects.toThrow('редкость');
  });
});

describe('decode resource lifecycle', () => {
  it('rejects long decoded audio and closes the context', async () => {
    const close = vi.fn(async () => undefined);
    vi.stubGlobal('AudioContext', class {
      decodeAudioData = async () => ({ duration: 15.01 });
      close = close;
    });
    try {
      await expect(analyzeFile(new Blob([new Uint8Array(4)]), [])).rejects.toThrow('15 секунд');
      expect(close).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('onset event lifecycle', () => {
  it('signals the event before the window result and suppresses burst/cooldown starts', () => {
    const order: string[] = [];
    const engine = new AudioEngine({ onEventStart: () => order.push('start'), onClip: () => order.push('clip'), onResult: () => order.push('result') });
    // Inject exact-duration PCM chunks to exercise the real onset/cooldown state machine.
    const feed = engine as unknown as { consume(chunk: Float32Array, rate: number): void };
    const chunk = tone(440, 0.2, 16000).slice(0, 2048);
    feed.consume(chunk, 8000);
    expect(order).toEqual(['start']);
    for (let i = 0; i < 6; i++) feed.consume(chunk, 8000);
    expect(order).toEqual(['start', 'clip', 'result']);
    for (let i = 0; i < 8; i++) feed.consume(chunk, 8000);
    expect(order).toEqual(['start', 'clip', 'result']); // Sustained tail never starts another event.
    feed.consume(new Float32Array(2048), 8000);
    feed.consume(chunk, 8000);
    expect(order).toEqual(['start', 'clip', 'result', 'start']);
    engine.stop();
  });
});

describe('built-in sound groups', () => {
  it('treats same-group actions as equivalent and returns candidates without group rarity', () => {
    const pickup = { ...reference(440, 'Звуковая группа 1'), groupId: 1, action: 'pickup' as const, rarity: undefined, candidates: [{ id: 1, name: 'Mixed red candidate', rarity: 'red' as const, size: [1, 1] as [number, number] }] };
    const drop = { ...pickup, id: 'drop', action: 'drop' as const };
    const result = classifyFeatures(pickup.features, [pickup, drop]);
    expect(result.status).toBe('match'); expect(result.groupId).toBe(1);
    expect(result.candidates).toEqual(pickup.candidates); expect(result.rarity).toBeUndefined();
    expect(classifyFeatures(pickup.features, [pickup, { ...drop, groupId: 2 }]).status).toBe('unknown');
  });
  it('keeps one above-threshold alternative per sound family for size disambiguation', () => {
    const group = (id: number, action: 'pickup' | 'drop' = 'pickup') => ({ ...reference(440, `Group ${id}`), id: `${id}-${action}`, groupId: id, action });
    const result = classifyFeatures(reference(440, 'query').features, [group(1), group(1, 'drop'), group(2)]);
    expect(result.status).toBe('unknown'); expect(result.threshold).toBe(0.88);
    expect(result.alternatives?.map(item => item.groupId)).toEqual([1, 2]);
    expect(result.alternatives?.every(item => item.similarity >= 0.88)).toBe(true);
  });
  it('does not let a below-threshold runner-up veto an accepted sound family', () => {
    const features = new Array(FEATURE_LENGTH).fill(0); features[0] = 1; features[40] = 1;
    const other = [...features]; other[0] = 0.99; other[1] = Math.sqrt(1 - 0.99 ** 2);
    const base = { ...reference(440, 'Group 1'), groupId: 1, features };
    const result = classifyFeatures(features, [base, { ...base, id: 'group-2', groupId: 2, features: other }], 0.999);
    expect(result.status).toBe('match'); expect(result.groupId).toBe(1); expect(result.alternatives).toHaveLength(1);
    const failed = classifyFeatures(features, [{ ...base, features: other }], 0.999);
    expect(failed.status).toBe('unknown'); expect(failed.alternatives).toBeUndefined();
  });
});

describe('adaptive live event segmentation', () => {
  it('keeps a long quiet sound through its full duration and finishes on quiet tail', () => {
    const events: string[] = []; let clip: Blob | undefined;
    const engine = new AudioEngine({ onEventStart: () => events.push('start'), onClip: value => { clip = value; }, onResult: () => events.push('result') });
    const feed = engine as unknown as { consume(chunk: Float32Array, rate: number): void };
    const chunk = Float32Array.from({ length: 400 }, (_, i) => 0.007 * Math.sin(2 * Math.PI * 440 * i / 8000));
    for (let i = 0; i < 28; i++) feed.consume(chunk, 8000);
    expect(events).toEqual(['start']);
    for (let i = 0; i < 4; i++) feed.consume(new Float32Array(400), 8000);
    expect(events).toEqual(['start', 'result']);
    expect(clip?.size).toBe(44 + 32 * 400 * 2);
    engine.stop();
  });
  it('does not trigger on near-silence background', () => {
    const start = vi.fn(); const engine = new AudioEngine({ onEventStart: start });
    const feed = engine as unknown as { consume(chunk: Float32Array, rate: number): void };
    for (let i = 0; i < 100; i++) feed.consume(new Float32Array(400).fill(0.0004), 8000);
    expect(start).not.toHaveBeenCalled(); engine.stop();
  });
});
