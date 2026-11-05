import { describe, expect, it } from 'vitest';
import { isSoundReference, parseReferenceLibrary, sanitizeHistoryEntry, sanitizeSettings } from '../src/lib/storage';
import { DEFAULT_SETTINGS } from '../src/types';

const reference = {id:'test',name:'Пример',rarity:'red',features:Array(56).fill(0.1),duration:1,createdAt:1700000000000,sampleRate:48000};
describe('persisted input validation', () => {
  it('recovers default settings from corrupt storage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('broken')).toEqual(DEFAULT_SETTINGS);
  });
  it('clamps invalid grid crop to normalized frame bounds', () => {
    const settings = sanitizeSettings({region:{x:0.9,y:-5,width:10,height:Infinity},gridColumns:-5,sensitivity:999});
    expect(settings.region.x + settings.region.width).toBeLessThanOrEqual(1);
    expect(settings.region.y).toBe(0);
    expect(settings.gridColumns).toBe(2);
    expect(settings.sensitivity).toBe(100);
  });
  it('uses the merchant nine-column thirty-row layout and preserves all thirty rows', () => {
    expect(sanitizeSettings(null)).toMatchObject({gridColumns:9,gridRows:30});
    expect(sanitizeSettings({gridColumns:9,gridRows:30})).toMatchObject({gridColumns:9,gridRows:30});
    expect(sanitizeSettings({gridRows:999}).gridRows).toBe(30);
  });
  it('migrates the former default layout while preserving unrelated preferences and custom layouts', () => {
    expect(sanitizeSettings({gridColumns:8,gridRows:10,sensitivity:77,autoScan:false}))
      .toMatchObject({gridColumns:9,gridRows:30,sensitivity:77,autoScan:false});
    expect(sanitizeSettings({gridColumns:6,gridRows:12})).toMatchObject({gridColumns:6,gridRows:12});
  });
  it('accepts an exported reference collection', () => {
    expect(parseReferenceLibrary(JSON.stringify({references:[reference]}))).toEqual([reference]);
  });
  it('rejects duplicate ids, bad spectra and malformed files', () => {
    expect(() => parseReferenceLibrary(JSON.stringify([reference,reference]))).toThrow('повторяются');
    expect(() => parseReferenceLibrary(JSON.stringify([{...reference,features:['bad']}]))).toThrow('Некорректная');
    expect(() => parseReferenceLibrary('not JSON')).toThrow('JSON');
    expect(isSoundReference({...reference,features:Array(56).fill(NaN)})).toBe(false);
    expect(isSoundReference({...reference,features:Array(56).fill(0)})).toBe(false);
    expect(isSoundReference({...reference,features:Array(56).fill(100)})).toBe(false);
  });
});

describe('persisted item recognition evidence', () => {
  const item = { id:1, name:'Item', rarity:'red', size:[3,2] };
  const entry = { id:'event', cellId:'cell-0-0', map:'farm', demo:false, status:'match', name:'Item', timestamp:123, similarity:.97,
    candidates:[item], recognition:{ status:'identified', item, observedSize:[3,2], sizeSource:'manual', candidatesBefore:2, candidatesAfter:1, observations:1, reason:'Sound and size' } };
  it('round-trips valid identification and discards malformed candidate/alternative objects', () => {
    expect(sanitizeHistoryEntry(entry)?.recognition).toEqual(entry.recognition);
    expect(sanitizeHistoryEntry({ ...entry, referenceId:42 })?.name).toBe('Item');
    const clean = sanitizeHistoryEntry({ ...entry, candidates:[item, { name:'bad', size:'broken' }], alternatives:[{ wrong:true }] });
    expect(clean?.candidates).toEqual([item]); expect(clean?.alternatives).toEqual([]);
    expect(sanitizeHistoryEntry({ ...entry, candidates:{ nope:true }, recognition:{ status:'identified' } })?.candidates).toBeUndefined();
  });
  it('rejects invalid nested size, missing identified item, counts and corrupt top-level values', () => {
    expect(sanitizeHistoryEntry({ ...entry, recognition:{ ...entry.recognition, observedSize:[NaN,2] } })?.recognition).toBeUndefined();
    expect(sanitizeHistoryEntry({ ...entry, recognition:{ ...entry.recognition, candidatesBefore:Infinity } })?.recognition).toBeUndefined();
    expect(sanitizeHistoryEntry({ ...entry, similarity:NaN })).toBeUndefined();
    expect(sanitizeHistoryEntry(null)).toBeUndefined();
  });
});
