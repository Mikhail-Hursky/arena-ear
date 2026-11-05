import { describe, expect, it } from 'vitest';
import type { AudioMatch, ItemSizeEvidence, SoundCandidate, SoundHypothesis } from '../src/types';
import { resolveItemMatch } from '../src/lib/item-recognition';
import { BUILTIN_GROUPS } from '../src/lib/builtin-sounds';

const lion: SoundCandidate = { id: 1, name: 'Gold Lion', rarity: 'red', size: [3, 2] };
const cheetah: SoundCandidate = { id: 2, name: 'Gold Cheetah', rarity: 'legendary', size: [2, 1] };
const plaster: SoundCandidate = { id: 3, name: 'Plaster Sculpture', rarity: 'epic', size: [2, 3] };
const majestic: SoundCandidate = { id: 4, name: 'Majestic Sculpture', rarity: 'red', size: [2, 3] };
const manual = (width: number, height: number): ItemSizeEvidence => ({ width, height, source: 'manual' });
const hypothesis = (groupId: number, candidates: SoundCandidate[], similarity = 0.99): SoundHypothesis => ({
  referenceId: `builtin-${groupId}-pickup`, name: `Звуковая группа ${groupId}`, groupId, action: 'pickup', candidates, similarity,
});
const match = (candidates = [lion, cheetah], groupId = 28): AudioMatch => ({
  ...hypothesis(groupId, candidates), status: 'match', timestamp: 10,
});
const ambiguous = (alternatives: SoundHypothesis[]): AudioMatch => ({
  status: 'unknown', name: 'Не определено', reason: 'Неоднозначное совпадение эталонов', similarity: alternatives[0].similarity,
  timestamp: 10, threshold: 0.88, alternatives,
});

describe('sound and footprint recognition', () => {
  it('preserves the true candidate and all indistinguishable siblings across the entire built-in catalog', () => {
    for (const group of BUILTIN_GROUPS) for (const candidate of group.candidates) {
      const [width, height] = candidate.size;
      const expected = group.candidates.filter(item => (item.size[0] === width && item.size[1] === height)
        || (item.size[1] === width && item.size[0] === height));
      const result = resolveItemMatch(match(group.candidates, group.id), manual(width, height));
      expect(result.candidates, `${group.id}/${candidate.id}`).toEqual(expected);
      expect(result.recognition?.status).toBe(expected.length === 1 ? 'identified' : 'ambiguous');
      expect(result.recognition?.item?.id).toBe(expected.length === 1 ? candidate.id : undefined);
    }
  });
  it('identifies the one catalog item compatible with sound and confirmed footprint', () => {
    const result = resolveItemMatch(match(), manual(3, 2));
    expect(result.status).toBe('match'); expect(result.name).toBe('Gold Lion'); expect(result.rarity).toBe('red');
    expect(result.candidates).toEqual([lion]);
    expect(result.recognition).toMatchObject({ status: 'identified', item: lion, candidatesBefore: 2, candidatesAfter: 1, observedSize: [3, 2], sizeSource: 'manual', observations: 1 });
  });

  it('accepts rotated footprints by default and can enforce orientation', () => {
    expect(resolveItemMatch(match(), manual(2, 3)).recognition?.item).toEqual(lion);
    expect(resolveItemMatch(match(), { ...manual(2, 3), allowRotation: false }).recognition?.status).toBe('conflict');
  });

  it('does not claim a unique item when sound and dimensions are shared', () => {
    const result = resolveItemMatch(match([plaster, majestic], 36), manual(2, 3));
    expect(result.recognition?.status).toBe('ambiguous'); expect(result.recognition?.item).toBeUndefined();
    expect(result.candidates).toEqual([plaster, majestic]); expect(result.rarity).toBeUndefined();
  });

  it('rejects contradictory dimensions instead of selecting the closest size', () => {
    const result = resolveItemMatch(match(), manual(2, 2));
    expect(result.status).toBe('unknown'); expect(result.candidates).toEqual([]);
    expect(result.recognition).toMatchObject({ status: 'conflict', candidatesBefore: 2, candidatesAfter: 0 });
    expect(result.recognition?.item).toBeUndefined(); expect(result.rarity).toBeUndefined();
  });

  it('uses a reliable detected footprint and ignores weak or absent detection confidence', () => {
    expect(resolveItemMatch(match(), { width: 3, height: 2, source: 'detected', confidence: 0.88 }).recognition?.status).toBe('identified');
    for (const confidence of [0.68, undefined, NaN, Infinity, 1.1, -1]) {
      const result = resolveItemMatch(match(), { width: 3, height: 2, source: 'detected', confidence });
      expect(result.recognition?.status).toBe('audio-only'); expect(result.candidates).toHaveLength(2);
    }
  });

  it('rejects malformed and impossible footprint values', () => {
    for (const [width, height] of [[0, 2], [2, -1], [1.5, 2], [NaN, 2], [Infinity, 2], [21, 2]]) {
      expect(resolveItemMatch(match(), manual(width, height)).recognition?.status).toBe('audio-only');
    }
  });

  it('keeps audio-only evidence separate even for a singleton group', () => {
    expect(resolveItemMatch(match([lion])).recognition).toMatchObject({ status: 'audio-only', candidatesAfter: 1 });
    expect(resolveItemMatch(match([lion])).recognition?.item).toBeUndefined();
  });

  it('resolves near-equal sound families using dimensions before discarding alternatives', () => {
    const raw = ambiguous([hypothesis(28, [lion, cheetah]), hypothesis(32, [{ id: 5, name: 'Teapot', rarity: 'red', size: [2, 2] }], 0.98)]);
    const result = resolveItemMatch(raw, manual(2, 2));
    expect(result.status).toBe('match'); expect(result.groupId).toBe(32); expect(result.name).toBe('Teapot'); expect(result.similarity).toBe(0.98);
    expect(result.recognition).toMatchObject({ status: 'identified', candidatesBefore: 3, candidatesAfter: 1 });
  });

  it('preserves ambiguous families when their items fit the same dimensions', () => {
    const result = resolveItemMatch(ambiguous([hypothesis(28, [lion]), hypothesis(36, [plaster, majestic], 0.98)]), manual(3, 2));
    expect(result.status).toBe('unknown'); expect(result.groupId).toBeUndefined();
    expect(result.recognition?.status).toBe('ambiguous'); expect(result.candidates).toHaveLength(3);
  });

  it('does not turn silence, low audio similarity or below-threshold alternatives into an item', () => {
    for (const raw of [
      { status: 'unknown' as const, name: 'Не определено', similarity: 0, timestamp: 10, reason: 'Тишина' },
      ambiguous([hypothesis(28, [lion], 0.5)]),
      { ...ambiguous([hypothesis(28, [lion], 0.89)]), threshold: 0.95 },
    ]) {
      const result = resolveItemMatch(raw, manual(3, 2));
      expect(result.status).toBe('unknown'); expect(result.recognition?.item).toBeUndefined();
    }
  });

  it('preserves a personal reference label without treating it as verified catalog identity', () => {
    const raw: AudioMatch = { status: 'match', name: 'My sample', rarity: 'red', referenceId: 'personal', similarity: 1, timestamp: 10 };
    const result = resolveItemMatch(raw, manual(3, 2));
    expect(result.name).toBe('My sample'); expect(result.rarity).toBe('red'); expect(result.recognition?.status).toBe('audio-only');
    expect(result.recognition?.item).toBeUndefined();
  });

  it('does not eliminate an ambiguous personal recording with missing size metadata', () => {
    const result = resolveItemMatch(ambiguous([hypothesis(28, [lion]), { referenceId: 'personal', name: 'Personal', rarity: 'red', similarity: 0.98 }]), manual(3, 2));
    expect(result.status).toBe('unknown'); expect(result.recognition?.status).toBe('ambiguous'); expect(result.recognition?.item).toBeUndefined();
  });

  it('intersects repeated compatible observations without increasing sound similarity', () => {
    const prior = resolveItemMatch(match([lion, cheetah]), manual(3, 2));
    const raw = ambiguous([hypothesis(28, [lion]), hypothesis(36, [plaster, majestic], 0.98)]);
    const result = resolveItemMatch(raw, manual(3, 2), prior);
    expect(result.recognition?.status).toBe('identified'); expect(result.recognition?.item).toEqual(lion);
    expect(result.recognition?.observations).toBe(2); expect(result.similarity).toBe(0.99);
  });

  it('reports conflicting repeated observations and does not invent a certainty', () => {
    const prior = resolveItemMatch(match([plaster, majestic], 36), manual(2, 3));
    const result = resolveItemMatch(match([lion]), manual(3, 2), prior);
    expect(result.status).toBe('unknown'); expect(result.recognition?.status).toBe('conflict'); expect(result.recognition?.item).toBeUndefined();
  });

  it('ignores prior results from a differently sized footprint and never mutates input', () => {
    const raw = match(); const original = structuredClone(raw);
    const prior = resolveItemMatch(match([cheetah]), manual(2, 1));
    const result = resolveItemMatch(raw, manual(3, 2), prior);
    expect(result.recognition?.item).toEqual(lion); expect(result.recognition?.observations).toBe(1);
    expect(raw).toEqual(original);
  });
});
