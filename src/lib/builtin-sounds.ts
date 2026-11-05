import catalog from '../data/merchant-groups.json';
import manifest from '../data/merchant-features.json';
import type { Rarity, SoundAction, SoundCandidate, SoundReference } from '../types';
import { FEATURE_LENGTH, FEATURE_VERSION } from './audio';

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

type EncodedReference = { duration: number; sampleRate: number; features: number[] };
const descriptors: Record<string, EncodedReference> = manifest.samples;
if (manifest.featureVersion !== FEATURE_VERSION || manifest.featureLength !== FEATURE_LENGTH) {
  throw new Error('Версия встроенных аудиопризнаков устарела. Пересоздайте merchant-features.json.');
}

/** Ready synchronously with the application bundle; no startup fetch or decoding. */
export const BUILTIN_REFERENCES: SoundReference[] = BUILTIN_GROUPS.flatMap((group, index) =>
  (['pickup', 'drop'] as SoundAction[]).map(action => {
    const filename = catalog.groups[index][action].files[0].split('/').at(-1)!;
    const descriptor = descriptors[filename];
    if (!descriptor || descriptor.features.length !== FEATURE_LENGTH
      || !descriptor.features.every(value => Number.isFinite(value) && value >= 0 && value <= 1)
      || !descriptor.features.slice(0, 40).some(value => value > 0) || !descriptor.features.slice(40).some(value => value > 0)
      || !(descriptor.duration > 0 && descriptor.duration <= 15) || !(descriptor.sampleRate > 0)) {
      throw new Error(`Некорректный встроенный аудиоэталон: ${filename}`);
    }
    return {
      id: `builtin-${group.id}-${action}`, name: group.name, groupId: group.id, action,
      candidates: group.candidates, source: 'builtin' as const, features: descriptor.features,
      duration: descriptor.duration, sampleRate: descriptor.sampleRate, createdAt: 0,
    };
  }),
);
const readyReferences = Promise.resolve(BUILTIN_REFERENCES);

export function getBuiltinLoadState(): { loaded: number; total: number; status: 'idle' | 'loading' | 'ready' | 'error' } {
  return { loaded: BUILTIN_REFERENCE_COUNT, total: BUILTIN_REFERENCE_COUNT, status: 'ready' };
}

/** Promise-compatible API retained for existing consumers; data is already ready. */
export function loadBuiltinReferences(onProgress?: (loaded: number, total: number) => void): Promise<SoundReference[]> {
  try { onProgress?.(BUILTIN_REFERENCE_COUNT, BUILTIN_REFERENCE_COUNT); } catch { /* subscriber owns UI errors */ }
  return readyReferences;
}
