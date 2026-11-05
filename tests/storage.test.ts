import { describe, expect, it } from 'vitest';
import { isSoundReference, parseReferenceLibrary, sanitizeSettings } from '../src/lib/storage';
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
