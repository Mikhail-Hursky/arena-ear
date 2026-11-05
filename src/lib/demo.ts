import type { AudioMatch, GridCell, GridDetection, Rarity } from '../types';

export const MAPS = [
  { id: 'tv-red', name: 'Телецентр', subtitle: 'Красная карта' },
  { id: 'tv-yellow', name: 'Телецентр', subtitle: 'Жёлтая карта' },
  { id: 'armory', name: 'Арсенал', subtitle: 'Бункер' },
  { id: 'farm', name: 'Ферма', subtitle: 'Открытая местность' },
  { id: 'valley', name: 'Долина', subtitle: 'Побережье' },
];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: 'Обычный', rare: 'Редкий', epic: 'Эпический', legendary: 'Легендарный', red: 'Красный',
};

const layout: [number, number, number, number, string][] = [
  [0,0,1,2,'Груз'], [0,1,2,1,'Коллекция'], [0,3,1,2,'Медицина'], [0,4,2,2,'Груз'], [0,6,2,1,'Военное'],
  [1,1,2,1,'Груз'], [1,6,2,2,'Груз'],
  [2,0,2,2,'Груз'], [2,2,2,1,'Военное'], [2,4,2,1,'Коллекция'],
  [3,2,1,2,'Груз'], [3,3,3,2,'Груз'], [3,6,2,1,'Медицина'],
  [4,0,2,1,'Коллекция'], [4,6,1,2,'Груз'], [4,7,1,2,'Груз'],
  [5,0,2,3,'Груз'], [5,2,2,2,'Груз'], [5,4,2,2,'Военное'],
  [6,6,2,2,'Груз'], [7,2,2,1,'Коллекция'], [7,4,2,2,'Груз'],
  [8,0,2,2,'Груз'], [8,2,2,2,'Груз'], [8,6,2,2,'Груз'], [9,4,2,1,'Медицина'],
];

export const DEMO_GRID: GridDetection = {
  cells: layout.map(([row,col,width,height,label],i): GridCell => ({id:`demo-${i+1}`,row,col,width,height,label})),
  columns: 8, rows: 10, confidence: 1,
  region: {x:0.65,y:0.15,width:0.31,height:0.72}, source:'demo',
};

const examples: {name:string;rarity:Rarity;similarity:number}[] = [
  {name:'Золотой лев',rarity:'red',similarity:0.96},
  {name:'Военный радиоприёмник',rarity:'rare',similarity:0.91},
  {name:'Хирургический набор',rarity:'epic',similarity:0.93},
  {name:'Антикварная ваза',rarity:'legendary',similarity:0.94},
  {name:'Коллекционная монета',rarity:'common',similarity:0.89},
  {name:'Старинная лютня',rarity:'red',similarity:0.98},
];

// Deliberately deterministic demonstration only. Never used by the live audio engine.
export function createDemoResult(cellId: string): AudioMatch {
  const index = Number(cellId.split('-').pop()) || 1;
  if (index % 7 === 0) return {status:'unknown',name:'Нет подходящего образца',similarity:0.42,timestamp:Date.now(),reason:'Учебный пример: звук не совпал с библиотекой.'};
  const item = examples[(index - 1) % examples.length];
  return {status:'match',...item,referenceId:`demo-ref-${index}`,timestamp:Date.now(),reason:'Смоделированный результат. Не является анализом игрового звука.'};
}
