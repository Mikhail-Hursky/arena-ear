import { describe, expect, it } from 'vitest';
import type { AudioMatch, Rarity, SoundCandidate } from '../src/types';
import { presentResult } from '../src/lib/result-presentation';

const item = (id:number, rarity:Rarity): SoundCandidate => ({id, rarity, name:`Item ${id}`, size:[2,3]});
const result = (candidates:SoundCandidate[] = []): AudioMatch => ({status:'match', name:'Group', similarity:.963, timestamp:1, candidates});

describe('result card rarity composition', () => {
  it('splits equal epic/red candidates into two crisp halves', () => {
    const shown = presentResult(result([item(1,'epic'),item(2,'red')]));
    expect(shown.shares.map(s => [s.rarity,s.percent])).toEqual([['epic',50],['red',50]]);
    expect(shown.background).toContain('50%');
    expect(shown.similarity).toBe('96.3%');
    expect(shown.compactSimilarity).toBe('96%'); expect(shown.compactRarities).toBe('50/50');
    expect(shown.description).toContain('50% кандидатов');
  });
  it('uses proportions of distinct remaining candidates rather than an invented rarity probability', () => {
    const shown = presentResult(result([item(1,'epic'),item(2,'red'),item(3,'red'),item(3,'red')]));
    expect(shown.shares.map(s => s.percent)).toEqual([33.3,66.7]);
    expect(shown.candidateCount).toBe(3);
    expect(shown.compactRarities).toBe('33/67');
    expect(shown.description).toContain('Доли по числу кандидатов');
  });
  it('uses only filtered candidates, even if discarded alternatives have other rarities', () => {
    const raw = {...result([item(1,'red')]), alternatives:[{referenceId:'other',name:'Other',groupId:1,similarity:.95,candidates:[item(2,'rare')]}]};
    expect(presentResult(raw).shares.map(s=>[s.rarity,s.percent])).toEqual([['red',100]]);
  });
  it('rounds multiple color shares to exactly 100 percent', () => {
    const shown = presentResult(result([item(1,'common'),item(2,'rare'),item(3,'legendary')]));
    expect(shown.shares.map(s => s.percent)).toEqual([33.4,33.3,33.3]);
    expect(Math.round(shown.shares.reduce((n,s)=>n+s.percent,0)*10)).toBe(1000);
    expect(shown.background).toContain('100%');
  });
  it('preserves the label color for personal matches without catalog candidates', () => {
    const shown = presentResult({...result(),rarity:'legendary'});
    expect(shown.shares.map(s=>[s.rarity,s.percent])).toEqual([['legendary',100]]);
    expect(shown.candidateCount).toBe(0);
  });
  it('leaves missing, rejected and conflicting results without misleading rarity colors', () => {
    expect(presentResult().shares).toEqual([]);
    expect(presentResult({...result(),status:'unknown',rarity:'red'}).shares).toEqual([]);
    const conflict = {...result([item(1,'red')]),recognition:{status:'conflict' as const,candidatesBefore:1,candidatesAfter:0,observations:1,reason:'conflict'}};
    expect(presentResult(conflict).shares).toEqual([]);
  });
  it('still shows compatible candidate colors when several sound groups remain ambiguous', () => {
    expect(presentResult({...result([item(1,'epic'),item(2,'red')]),status:'unknown'}).shares).toHaveLength(2);
  });
  it('bounds invalid similarity values instead of rendering NaN or out-of-range percentages', () => {
    expect(presentResult({...result(),similarity:Infinity}).similarity).toBe('0.0%');
    expect(presentResult({...result(),similarity:1.2}).similarity).toBe('100.0%');
    expect(presentResult({...result(),similarity:-1}).similarity).toBe('0.0%');
  });
});
