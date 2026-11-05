import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import catalog from '../src/data/merchant-groups.json';
import manifest from '../src/data/merchant-features.json';
import { BUILTIN_GROUPS, BUILTIN_ITEMS, BUILTIN_REFERENCES, BUILTIN_REFERENCE_COUNT } from '../src/lib/builtin-sounds';
import { classifyFeatures, FEATURE_LENGTH, FEATURE_VERSION } from '../src/lib/audio';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });

describe('immediate built-in merchant catalog', () => {
  it('maps all actual sound files and all current item metadata', () => {
    expect(BUILTIN_REFERENCE_COUNT).toBe(76); expect(BUILTIN_GROUPS).toHaveLength(38);
    const urls = BUILTIN_GROUPS.flatMap(group => [group.pickupUrl, group.dropUrl]);
    expect(new Set(urls).size).toBe(BUILTIN_REFERENCE_COUNT);
    for (const url of urls) expect(existsSync(`public${url}`), url).toBe(true);
    expect(BUILTIN_ITEMS.length).toBe(catalog.groups.reduce((n, group) => n + group.candidates.length, 0));
    const mapping = { 1: 'common', 2: 'common', 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'red' };
    for (const group of catalog.groups) for (const item of group.candidates) {
      expect(BUILTIN_ITEMS.find(mapped => mapped.id === item.id && mapped.groupId === group.id)).toEqual({ ...item, rarity: mapping[item.rarity as keyof typeof mapping], groupId: group.id });
    }
  });

  it('serves audio previews under the GitHub Pages subdirectory', async () => {
    vi.stubEnv('BASE_URL', '/arena-ear/');
    const { BUILTIN_GROUPS: groups } = await import('../src/lib/builtin-sounds');
    for (const group of groups) for (const url of [group.pickupUrl, group.dropUrl]) {
      expect(url.startsWith('/arena-ear/sounds/merchant/'), url).toBe(true);
      expect(existsSync(`public/${url.slice('/arena-ear/'.length)}`), url).toBe(true);
    }
  });

  it('contains exactly one complete versioned descriptor for every unchanged source recording', () => {
    expect(manifest.featureVersion).toBe(FEATURE_VERSION); expect(manifest.featureLength).toBe(FEATURE_LENGTH);
    const expected = [...new Set(catalog.groups.flatMap(group => [group.pickup.files[0], group.drop.files[0]]).map(path => path.split('/').at(-1)))].sort();
    expect(Object.keys(manifest.samples).sort()).toEqual(expected);
    for (const [filename, entry] of Object.entries(manifest.samples)) {
      expect(entry.features).toHaveLength(FEATURE_LENGTH);
      expect(entry.features.every(value => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      expect(Math.hypot(...entry.features.slice(0, 40))).toBeCloseTo(1, 6);
      expect(Math.hypot(...entry.features.slice(40))).toBeCloseTo(1, 6);
      expect(entry.duration).toBeGreaterThan(0); expect(entry.duration).toBeLessThanOrEqual(15);
      expect(entry.sampleRate).toBe(48000);
      expect(createHash('sha256').update(readFileSync(`public/sounds/merchant/${filename}`)).digest('hex'), filename).toBe(entry.sha256);
    }
  });

  it('is ready at import with no network, Web Audio, uploads or manual loading', async () => {
    const fetchMock = vi.fn(() => { throw new Error('Startup must not fetch audio'); });
    const audioMock = vi.fn(() => { throw new Error('Startup must not decode audio'); });
    vi.stubGlobal('fetch', fetchMock); vi.stubGlobal('AudioContext', audioMock);
    const api = await import('../src/lib/builtin-sounds');
    expect(api.getBuiltinLoadState()).toEqual({ loaded: 76, total: 76, status: 'ready' });
    expect(api.BUILTIN_REFERENCES).toHaveLength(76);
    const firstProgress = vi.fn(), secondProgress = vi.fn();
    const first = api.loadBuiltinReferences(firstProgress);
    expect(firstProgress).toHaveBeenCalledWith(76, 76);
    const [a, b] = await Promise.all([first, api.loadBuiltinReferences(secondProgress)]);
    expect(a).toBe(api.BUILTIN_REFERENCES); expect(b).toBe(a);
    expect(secondProgress).toHaveBeenCalledWith(76, 76);
    expect(fetchMock).not.toHaveBeenCalled(); expect(audioMock).not.toHaveBeenCalled();
  });

  it('keeps progress subscribers from breaking the ready library', async () => {
    const { loadBuiltinReferences } = await import('../src/lib/builtin-sounds');
    await expect(loadBuiltinReferences(() => { throw new Error('UI subscriber failed'); })).resolves.toHaveLength(76);
  });

  it('builds descriptors into the recognizer without assigning a shared group rarity', () => {
    expect(BUILTIN_REFERENCES).toHaveLength(BUILTIN_REFERENCE_COUNT);
    for (const reference of BUILTIN_REFERENCES) {
      expect(reference.id).toBe(`builtin-${reference.groupId}-${reference.action}`);
      expect(reference.source).toBe('builtin'); expect(reference.rarity).toBeUndefined();
      expect(reference.candidates).toEqual(BUILTIN_GROUPS.find(group => group.id === reference.groupId)?.candidates);
      const result = classifyFeatures(reference.features, BUILTIN_REFERENCES);
      expect(result.status === 'unknown' || result.groupId === reference.groupId, reference.id).toBe(true);
    }
  });
});
