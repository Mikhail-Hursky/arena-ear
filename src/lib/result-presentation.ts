import type { AudioMatch, Rarity } from '../types';
import { RARITY_LABELS } from './demo';

const PALETTE: Record<Rarity, { fill:string; accent:string }> = {
  common:{fill:'#343e32',accent:'#a6b49e'},
  rare:{fill:'#263e54',accent:'#79b7eb'},
  epic:{fill:'#483359',accent:'#bd91ed'},
  legendary:{fill:'#514421',accent:'#edc463'},
  red:{fill:'#603335',accent:'#f18b83'},
};
const ORDER: Rarity[] = ['common','rare','epic','legendary','red'];
export interface RarityShare { rarity:Rarity; label:string; count:number; percent:number }

/** Shares describe the remaining candidate list, never loot probabilities. */
export function presentResult(result?: AudioMatch) {
  const counts = new Map<Rarity,number>();
  const candidates = result?.recognition?.status === 'conflict' ? []
    : [...new Map((result?.candidates ?? []).map(c => [c.id,c])).values()];
  for (const candidate of candidates) counts.set(candidate.rarity,(counts.get(candidate.rarity) ?? 0)+1);
  if (!candidates.length && result?.status === 'match' && result.rarity && result.recognition?.status !== 'conflict') counts.set(result.rarity,1);
  const total = [...counts.values()].reduce((n,v)=>n+v,0);
  const portions = ORDER.filter(rarity => counts.has(rarity)).map(rarity => {
    const count = counts.get(rarity)!;
    const exact = count / total * 1000;
    return {rarity, label:RARITY_LABELS[rarity], count, units:Math.floor(exact), remainder:exact-Math.floor(exact)};
  });
  // Largest remainder rounding keeps displayed shares at exactly 100.0%.
  const remaining = 1000 - portions.reduce((n,p)=>n+p.units,0);
  [...portions].sort((a,b)=>b.remainder-a.remainder).slice(0,remaining).forEach(p=>p.units++);
  const shares: RarityShare[] = portions.map(({rarity,label,count,units})=>({rarity,label,count,percent:units/10}));
  const gradient = (key:'fill'|'accent') => {
    if (!shares.length) return undefined;
    if (shares.length === 1) return PALETTE[shares[0].rarity][key];
    let cursor = 0;
    const stops = shares.flatMap(share => {
      const start = cursor; cursor = Math.round((cursor+share.percent)*10)/10;
      const color = PALETTE[share.rarity][key];
      return [`${color} ${start}%`,`${color} ${cursor}%`];
    });
    return `linear-gradient(90deg, ${stops.join(', ')})`;
  };
  const score = (Number.isFinite(result?.similarity) ? Math.max(0,Math.min(1,result!.similarity)) : 0)*100;
  const similarity = `${score.toFixed(1)}%`;
  const colorDescription = candidates.length
    ? shares.map(s=>`${s.label} — ${s.percent}% кандидатов`).join('; ')
    : shares.map(s=>s.label).join('; ');
  const shortLabels: Record<Rarity,string> = {common:'Обыч.',rare:'Синий',epic:'Фиол.',legendary:'Жёлт.',red:'Красн.'};
  const compactRarities = shares.length === 1 ? shortLabels[shares[0].rarity]
    : shares.length === 2 ? shares.map(s=>Math.round(s.percent)).join('/') : `${shares.length} цв.`;
  return {shares,candidateCount:candidates.length,similarity,compactSimilarity:`${Math.round(score)}%`,compactRarities,background:gradient('fill'),stripe:gradient('accent'),
    description:result ? `Сходство звука ${similarity}. ${colorDescription || 'Цвет не определён'}.${candidates.length ? ' Доли по числу кандидатов, не вероятность выпадения.' : ''}` : '',
    labels:shares.map(s=>`${s.label}${shares.length > 1 ? ` ${s.percent}%` : ''}`).join(' · '),
  };
}
