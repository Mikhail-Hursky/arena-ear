import { DEFAULT_SETTINGS } from '../types';
import { FEATURE_LENGTH } from './audio';
import type { HistoryEntry, ItemRecognition, Rarity, Settings, SoundCandidate, SoundHypothesis, SoundReference } from '../types';

const PREFIX = 'arena-ear:v1:';
const rarities: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'red'];
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const bounded = (value: unknown, min: number, max: number, fallback: number) => finite(value) ? Math.max(min, Math.min(max, value)) : fallback;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(PREFIX + key) ?? 'null'); } catch { return null; }
}

function write(key: string, value: unknown): void {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); }
  catch { window.dispatchEvent(new CustomEvent('arena-storage-error', { detail: 'Не удалось сохранить данные в браузере. Экспортируйте библиотеку и историю, чтобы не потерять изменения.' })); }
}

export function sanitizeSettings(raw: unknown): Settings {
  const data = object(raw) ? raw : {};
  const region = object(data.region) ? data.region : {};
  const x = bounded(region.x, 0, 0.95, DEFAULT_SETTINGS.region.x);
  const y = bounded(region.y, 0, 0.95, DEFAULT_SETTINGS.region.y);
  const legacyGrid = data.gridColumns === 8 && data.gridRows === 10;
  return {
    sensitivity: bounded(data.sensitivity, 0, 100, DEFAULT_SETTINGS.sensitivity),
    matchThreshold: bounded(data.matchThreshold, 0.5, 1, DEFAULT_SETTINGS.matchThreshold),
    soundEnabled: typeof data.soundEnabled === 'boolean' ? data.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    autoScan: typeof data.autoScan === 'boolean' ? data.autoScan : DEFAULT_SETTINGS.autoScan,
    region: { x, y, width: bounded(region.width, 0.05, 1 - x, DEFAULT_SETTINGS.region.width > 1 - x ? 1 - x : DEFAULT_SETTINGS.region.width), height: bounded(region.height, 0.05, 1 - y, Math.min(DEFAULT_SETTINGS.region.height, 1 - y)) },
    gridColumns: legacyGrid ? DEFAULT_SETTINGS.gridColumns : Math.round(bounded(data.gridColumns, 2, 16, DEFAULT_SETTINGS.gridColumns)),
    gridRows: legacyGrid ? DEFAULT_SETTINGS.gridRows : Math.round(bounded(data.gridRows, 2, 30, DEFAULT_SETTINGS.gridRows)),
  };
}

export function isSoundReference(value: unknown): value is SoundReference {
  if (!object(value)) return false;
  return typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 150
    && typeof value.name === 'string' && value.name.trim().length > 0 && value.name.length <= 120
    && rarities.includes(value.rarity as Rarity)
    && Array.isArray(value.features) && value.features.length === FEATURE_LENGTH
    && value.features.every(v => finite(v) && v >= 0 && v <= 1)
    && value.features.slice(0, 40).some(v => v > 0) && value.features.slice(40).some(v => v > 0)
    && finite(value.duration) && value.duration > 0 && value.duration <= 15
    && finite(value.createdAt) && value.createdAt > 0
    && finite(value.sampleRate) && value.sampleRate >= 8000 && value.sampleRate <= 384000;
}

export function parseReferenceLibrary(text: string): SoundReference[] {
  if (text.length > 10_000_000) throw new Error('Файл библиотеки слишком большой. Максимум — 10 МБ.');
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('Не удалось прочитать JSON. Выберите экспортированную библиотеку Arena Ear.'); }
  const values = Array.isArray(raw) ? raw : object(raw) ? raw.references : null;
  if (!Array.isArray(values) || values.length > 500 || !values.every(isSoundReference)) {
    throw new Error('Некорректная библиотека: проверьте названия, признаки и метки образцов (не более 500).');
  }
  const ids = new Set<string>();
  return values.map((item) => {
    if (ids.has(item.id)) throw new Error('В библиотеке повторяются идентификаторы образцов.');
    ids.add(item.id);
    return { id: item.id, name: item.name.trim(), rarity: item.rarity, features: [...item.features], duration: item.duration, createdAt: item.createdAt, sampleRate: item.sampleRate };
  });
}

export const loadSettings = (): Settings => sanitizeSettings(read('settings'));
export const saveSettings = (settings: Settings): void => write('settings', sanitizeSettings(settings));
export const loadReferences = (): SoundReference[] => {
  const data = read('references');
  return Array.isArray(data) ? data.filter(isSoundReference).slice(0, 500) : [];
};
export const saveReferences = (references: SoundReference[]): void => write('references', references.filter(isSoundReference).slice(0, 500));

function isHistoryEntry(value: unknown): value is HistoryEntry {
  if (!object(value)) return false;
  return typeof value.id === 'string' && typeof value.cellId === 'string' && typeof value.map === 'string'
    && typeof value.demo === 'boolean' && typeof value.name === 'string' && finite(value.timestamp)
    && finite(value.similarity) && value.similarity >= 0 && value.similarity <= 1
    && (value.status === 'match' || value.status === 'unknown')
    && (value.rarity === undefined || rarities.includes(value.rarity as Rarity));
}
function candidate(raw: unknown): SoundCandidate | undefined {
  if (!object(raw) || !Number.isInteger(raw.id) || typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 200
    || !rarities.includes(raw.rarity as Rarity) || !Array.isArray(raw.size) || raw.size.length !== 2
    || !raw.size.every(n => Number.isInteger(n) && n >= 1 && n <= 20)) return;
  return { id:raw.id as number, name:raw.name, rarity:raw.rarity as Rarity, size:[raw.size[0],raw.size[1]] };
}
const candidates = (raw: unknown): SoundCandidate[] | undefined => Array.isArray(raw)
  ? raw.slice(0,500).map(candidate).filter((c): c is SoundCandidate => !!c) : undefined;
function hypothesis(raw: unknown): SoundHypothesis | undefined {
  if (!object(raw) || typeof raw.referenceId !== 'string' || typeof raw.name !== 'string'
    || !finite(raw.similarity) || raw.similarity < 0 || raw.similarity > 1) return;
  return { referenceId:raw.referenceId.slice(0,150), name:raw.name.slice(0,200), similarity:raw.similarity,
    groupId:Number.isInteger(raw.groupId) && (raw.groupId as number) > 0 ? raw.groupId as number : undefined,
    action:raw.action === 'pickup' || raw.action === 'drop' ? raw.action : undefined,
    rarity:rarities.includes(raw.rarity as Rarity) ? raw.rarity as Rarity : undefined,
    candidates:candidates(raw.candidates) };
}
/** Bound and copy nested persisted evidence before rendering it. Old history stays compatible. */
export function sanitizeHistoryEntry(raw: unknown): HistoryEntry | undefined {
  if (!isHistoryEntry(raw)) return;
  const base = hypothesis({ ...raw, referenceId:typeof raw.referenceId === 'string' ? raw.referenceId : '' });
  if (!base) return;
  const result: HistoryEntry = { ...base, id:raw.id.slice(0,150), cellId:raw.cellId.slice(0,150), map:raw.map.slice(0,150),
    demo:raw.demo, status:raw.status, timestamp:raw.timestamp, reason:typeof raw.reason === 'string' ? raw.reason.slice(0,1000) : undefined,
    threshold:finite(raw.threshold) && raw.threshold >= 0 && raw.threshold <= 1 ? raw.threshold : undefined };
  if (Array.isArray(raw.alternatives)) result.alternatives = raw.alternatives.slice(0,100).map(hypothesis).filter((h): h is SoundHypothesis => !!h);
  const recognition: unknown = raw.recognition;
  if (object(recognition) && ['identified','ambiguous','conflict','audio-only'].includes(recognition.status as string)
    && typeof recognition.reason === 'string'
    && [recognition.candidatesBefore,recognition.candidatesAfter].every(n => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 500)
    && Number.isInteger(recognition.observations) && (recognition.observations as number) >= 1 && (recognition.observations as number) <= 500) {
    const size = recognition.observedSize;
    const observedSize: [number,number] | undefined = Array.isArray(size) && size.length === 2 && size.every(n => Number.isInteger(n) && n >= 1 && n <= 20) ? [size[0],size[1]] : undefined;
    const item = candidate(recognition.item);
    const status = recognition.status as ItemRecognition['status'];
    if (status !== 'identified' || (item && observedSize && result.candidates?.some(c => c.id === item.id))) {
      result.recognition = { status, item, observedSize,
        sizeSource:recognition.sizeSource === 'manual' || recognition.sizeSource === 'detected' ? recognition.sizeSource : undefined,
        candidatesBefore:recognition.candidatesBefore as number, candidatesAfter:recognition.candidatesAfter as number,
        observations:recognition.observations as number, reason:recognition.reason.slice(0,1000) };
    }
  }
  return result;
}
export const loadHistory = (): HistoryEntry[] => {
  const data = read('history');
  return Array.isArray(data) ? data.slice(0,500).map(sanitizeHistoryEntry).filter((h): h is HistoryEntry => !!h) : [];
};
export const saveHistory = (history: HistoryEntry[]): void => write('history', history.slice(0,500).map(sanitizeHistoryEntry).filter(Boolean));

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
