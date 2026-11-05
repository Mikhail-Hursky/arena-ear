import { afterEach, describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import catalog from '../src/data/merchant-groups.json';
import { BUILTIN_GROUPS, BUILTIN_ITEMS, BUILTIN_REFERENCE_COUNT } from '../src/lib/builtin-sounds';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); });
const samples = Float32Array.from({ length: 4000 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * 440 * i / 8000));
function mockAudio() {
  const close = vi.fn(async () => undefined);
  vi.stubGlobal('AudioContext', class {
    decodeAudioData = async () => ({ duration: 0.5, length: samples.length, sampleRate: 8000, numberOfChannels: 1, getChannelData: () => samples });
    close = close;
  });
  return close;
}
describe('merchant built-in catalog', () => {
  it('maps all 76 actual sound files and all item metadata', () => {
    expect(BUILTIN_REFERENCE_COUNT).toBe(76);
    expect(BUILTIN_GROUPS).toHaveLength(38);
    const urls = BUILTIN_GROUPS.flatMap(group => [group.pickupUrl, group.dropUrl]);
    expect(new Set(urls).size).toBe(76);
    for (const url of urls) expect(existsSync(`public${url}`), url).toBe(true);
    expect(BUILTIN_ITEMS.length).toBe(catalog.groups.reduce((n, group) => n + group.candidates.length, 0));
    const mapping = { 1: 'common', 2: 'common', 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'red' };
    for (const group of catalog.groups) for (const item of group.candidates) {
      expect(BUILTIN_ITEMS.find(mapped => mapped.id === item.id && mapped.groupId === group.id)).toEqual({ ...item, rarity: mapping[item.rarity as keyof typeof mapping], groupId: group.id });
    }
  });
  it('serves every built-in sound from the GitHub Pages subdirectory', async () => {
    vi.stubEnv('BASE_URL', '/arena-ear/');
    const { BUILTIN_GROUPS: groups } = await import('../src/lib/builtin-sounds');
    for (const group of groups) for (const url of [group.pickupUrl, group.dropUrl]) {
      expect(url.startsWith('/arena-ear/sounds/merchant/'), url).toBe(true);
      expect(existsSync(`public/${url.slice('/arena-ear/'.length)}`), url).toBe(true);
    }
  });
  it('shares concurrent loading, bounds requests to four, and closes its context', async () => {
    const close = mockAudio();
    let active = 0, peak = 0;
    const fetchMock = vi.fn(async () => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 1)); active--;
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const api = await import('../src/lib/builtin-sounds');
    const firstProgress = vi.fn(), secondProgress = vi.fn();
    const [a, b] = await Promise.all([api.loadBuiltinReferences(firstProgress), api.loadBuiltinReferences(secondProgress)]);
    expect(a).toBe(b); expect(a).toHaveLength(76); expect(fetchMock).toHaveBeenCalledTimes(76); expect(peak).toBeLessThanOrEqual(4);
    expect(close).toHaveBeenCalledOnce();
    expect(firstProgress).toHaveBeenLastCalledWith(76, 76); expect(secondProgress).toHaveBeenLastCalledWith(76, 76);
    expect(api.getBuiltinLoadState()).toEqual({ loaded: 76, total: 76, status: 'ready' });
    expect(a.every(ref => ref.rarity === undefined && ref.features.length === 56 && ref.id === `builtin-${ref.groupId}-${ref.action}`)).toBe(true);
    expect(await api.loadBuiltinReferences()).toBe(a); expect(fetchMock).toHaveBeenCalledTimes(76);
  });
  it('fails atomically, closes after in-flight jobs, and retries instead of caching failure', async () => {
    const close = mockAudio();
    let fail = true;
    const fetchMock = vi.fn(async () => ({ ok: !fail, status: 404, arrayBuffer: async () => new ArrayBuffer(1) }));
    vi.stubGlobal('fetch', fetchMock);
    const api = await import('../src/lib/builtin-sounds');
    await expect(api.loadBuiltinReferences()).rejects.toThrow('HTTP 404');
    expect(close).toHaveBeenCalledOnce(); expect(api.getBuiltinLoadState().status).toBe('error');
    fail = false;
    expect(await api.loadBuiltinReferences()).toHaveLength(76);
    expect(close).toHaveBeenCalledTimes(2);
  });
  it('rejects corrupt decoded files and never exposes partially loaded references', async () => {
    const close = vi.fn(async () => undefined);
    vi.stubGlobal('AudioContext', class {
      decodeAudioData = async () => { throw new Error('Corrupt OGG'); };
      close = close;
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })));
    const api = await import('../src/lib/builtin-sounds');
    await expect(api.loadBuiltinReferences()).rejects.toThrow('Corrupt OGG');
    expect(close).toHaveBeenCalledOnce(); expect(api.getBuiltinLoadState()).toEqual({ loaded: 0, total: 76, status: 'error' });
  });

});
