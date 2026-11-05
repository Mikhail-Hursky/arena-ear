import catalog from '../data/merchant-groups.json';
import type { Rarity, SoundAction, SoundCandidate, SoundReference } from '../types';
import { extractFeatures } from './audio';

const rarityMap: Record<number, Rarity> = { 1: 'common', 2: 'common', 3: 'rare', 4: 'epic', 5: 'legendary', 6: 'red' };
const soundUrl = (path: string): string => `${import.meta.env.BASE_URL}sounds/merchant/${path.split('/').at(-1)}`;
export const BUILTIN_GROUPS = catalog.groups.map(group => ({
  id: group.id,
  name: `Звуковая группа ${group.id}`,
  pickupUrl: soundUrl(group.pickup.files[0]),
  dropUrl: soundUrl(group.drop.files[0]),
  candidates: group.candidates.map(item => ({ id: item.id, name: item.name, rarity: rarityMap[item.rarity], size: [item.size[0], item.size[1]] as [number, number] } satisfies SoundCandidate)),
}));
export const BUILTIN_ITEMS = BUILTIN_GROUPS.flatMap(group => group.candidates.map(item => ({ ...item, groupId: group.id })));
export const BUILTIN_REFERENCE_COUNT = BUILTIN_GROUPS.length * 2;
export function getBuiltinLoadState(): { loaded: number; total: number; status: 'idle' | 'loading' | 'ready' | 'error' } {
  return { loaded, total: BUILTIN_REFERENCE_COUNT, status };
}
type Progress = (loaded: number, total: number) => void;
let loaded = 0;
let status: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
let cached: Promise<SoundReference[]> | undefined;
const listeners = new Set<Progress>();
function notify(listener: Progress): void {
  // A UI progress callback must not interrupt decoding or poison the shared cache.
  try { listener(loaded, BUILTIN_REFERENCE_COUNT); } catch { /* subscriber owns UI errors */ }
}

export function loadBuiltinReferences(onProgress?: Progress): Promise<SoundReference[]> {
  if (onProgress) { listeners.add(onProgress); notify(onProgress); }
  if (!cached) {
    loaded = 0; status = 'loading';
    cached = loadAll().then(references => { status = 'ready'; return references; }, error => {
      status = 'error'; loaded = 0; cached = undefined;
      throw error;
    });
  }
  const result = cached;
  return result.finally(() => { if (onProgress) listeners.delete(onProgress); });
}
async function loadAll(): Promise<SoundReference[]> {
  const context = new AudioContext();
  const jobs = BUILTIN_GROUPS.flatMap(group => (['pickup', 'drop'] as SoundAction[]).map(action => ({ group, action, url: action === 'pickup' ? group.pickupUrl : group.dropUrl })));
  const references = new Array<SoundReference>(jobs.length);
  let next = 0;
  let failure: unknown;
  let failed = false;
  try {
    const workers = Array.from({ length: 4 }, async () => {
      while (!failed && next < jobs.length) {
        const index = next++, { group, action, url } = jobs[index];
        try {
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Не удалось загрузить звук ${group.id}/${action}: HTTP ${response.status}`);
          const buffer = await context.decodeAudioData(await response.arrayBuffer());
          if (buffer.duration > 15) throw new Error(`Слишком длинный встроенный звук: ${url}`);
          const mono = new Float32Array(buffer.length);
          for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
            const data = buffer.getChannelData(channel);
            for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
          }
          const features = extractFeatures(mono, buffer.sampleRate);
          if (!features.length) throw new Error(`Встроенный звук пуст или слишком короткий: ${url}`);
          references[index] = { id: `builtin-${group.id}-${action}`, name: group.name, groupId: group.id, action, candidates: group.candidates, source: 'builtin', features, duration: buffer.duration, sampleRate: buffer.sampleRate, createdAt: 0 };
          if (!failed) { loaded++; listeners.forEach(notify); }
        } catch (error) { failed = true; failure ??= error; }
      }
    });
    await Promise.allSettled(workers);
    if (failed) throw failure;
    return references;
  } finally { await context.close(); }
}
