export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'red';

export interface SoundCandidate {
  id: number;
  name: string;
  rarity: Rarity;
  size: [number, number];
}
export type SoundAction = 'pickup' | 'drop';

export interface SoundReference {
  id: string;
  name: string;
  rarity?: Rarity;
  groupId?: number;
  action?: SoundAction;
  candidates?: SoundCandidate[];
  source?: 'builtin';
  features: number[];
  duration: number;
  createdAt: number;
  sampleRate: number;
}

/** One plausible sound family; pickup/drop variants of a family are collapsed. */
export interface SoundHypothesis {
  referenceId: string;
  name: string;
  rarity?: Rarity;
  groupId?: number;
  action?: SoundAction;
  candidates?: SoundCandidate[];
  similarity: number;
}

/** Manual means an explicitly confirmed item footprint, not an arbitrary unit cell. */
export interface ItemSizeEvidence {
  width: number;
  height: number;
  source: 'detected' | 'manual';
  confidence?: number;
  allowRotation?: boolean;
}

export interface ItemRecognition {
  status: 'identified' | 'ambiguous' | 'conflict' | 'audio-only';
  item?: SoundCandidate;
  observedSize?: [number, number];
  sizeSource?: 'detected' | 'manual';
  candidatesBefore: number;
  candidatesAfter: number;
  observations: number;
  reason: string;
}

export interface AudioMatch {
  status: 'match' | 'unknown';
  referenceId?: string;
  name: string;
  rarity?: Rarity;
  groupId?: number;
  action?: SoundAction;
  candidates?: SoundCandidate[];
  similarity: number;
  timestamp: number;
  reason?: string;
  /** Retained above-threshold alternatives, including the best hypothesis. */
  alternatives?: SoundHypothesis[];
  threshold?: number;
  recognition?: ItemRecognition;
}

export interface GridCell {
  id: string;
  row: number;
  col: number;
  width: number;
  height: number;
  label?: string;
  rarity?: Rarity;
  result?: AudioMatch;
}

export interface GridRegion { x: number; y: number; width: number; height: number }
export interface GridDetection {
  cells: GridCell[];
  columns: number;
  rows: number;
  confidence: number;
  region: GridRegion;
  source: 'detected' | 'manual' | 'demo';
}

export interface HistoryEntry extends AudioMatch {
  id: string;
  cellId: string;
  map: string;
  demo: boolean;
}

export interface Settings {
  sensitivity: number;
  matchThreshold: number;
  soundEnabled: boolean;
  autoScan: boolean;
  region: GridRegion;
  gridColumns: number;
  gridRows: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 50,
  matchThreshold: 0.88,
  soundEnabled: false,
  autoScan: true,
  region: { x: 0.65, y: 0.15, width: 0.31, height: 0.72 },
  gridColumns: 8,
  gridRows: 10,
};
