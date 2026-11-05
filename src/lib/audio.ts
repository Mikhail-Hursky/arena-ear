import type { AudioMatch, Rarity, SoundHypothesis, SoundReference } from '../types';

const RATE = 8000;
const FFT = 512;
const BANDS = 40;
const ENVELOPE = 16;
export const FEATURE_LENGTH = BANDS + ENVELOPE;
export const FEATURE_VERSION = 1;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_DURATION_SECONDS = 15;
export function rms(samples: Float32Array): number {
  let power = 0;
  for (const value of samples) power += value * value;
  return Math.sqrt(power / Math.max(1, samples.length));
}

function powerSpectrum(input: Float32Array): Float64Array {
  const re = new Float64Array(FFT), im = new Float64Array(FFT);
  for (let i = 0; i < FFT; i++) re[i] = (input[i] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT - 1)));
  for (let i = 1, j = 0; i < FFT; i++) {
    let bit = FFT >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [re[i], re[j]] = [re[j], re[i]];
  }
  for (let length = 2; length <= FFT; length *= 2) {
    for (let start = 0; start < FFT; start += length) {
      for (let j = 0; j < length / 2; j++) {
        const angle = -2 * Math.PI * j / length, c = Math.cos(angle), s = Math.sin(angle);
        const a = start + j, b = a + length / 2;
        const tr = c * re[b] - s * im[b], ti = s * re[b] + c * im[b];
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
  return re.slice(0, FFT / 2).map((v, i) => v * v + im[i] * im[i]);
}

/** Version 1 descriptor: normalized 40-band spectrum + 16-step energy envelope. */
export function extractFeatures(samples: Float32Array, sampleRate: number): number[] {
  if (!(sampleRate > 0) || !samples.length || rms(samples) < 0.0001) return [];
  const resampled = new Float32Array(Math.floor(samples.length * RATE / sampleRate));
  // Average each source interval to limit high-frequency aliasing when downsampling.
  for (let i = 0; i < resampled.length; i++) {
    const from = Math.floor(i * sampleRate / RATE), to = Math.max(from + 1, Math.floor((i + 1) * sampleRate / RATE));
    let sum = 0;
    for (let j = from; j < to && j < samples.length; j++) sum += samples[j];
    resampled[i] = sum / (to - from);
  }
  let peak = 0;
  for (const v of resampled) peak = Math.max(peak, Math.abs(v));
  if (peak < 0.0001) return [];
  let first = 0, last = resampled.length - 1;
  while (first < last && Math.abs(resampled[first]) < peak * 0.035) first++;
  while (last > first && Math.abs(resampled[last]) < peak * 0.035) last--;
  const active = resampled.slice(first, last + 1);
  if (active.length < RATE * 0.025) return [];
  const bands = new Array<number>(BANDS).fill(0);
  for (let offset = 0; offset < active.length; offset += FFT / 2) {
    const spectrum = powerSpectrum(active.subarray(offset, offset + FFT));
    for (let bin = 2; bin < FFT / 2; bin++) {
      const frequency = bin * RATE / FFT;
      const band = Math.min(BANDS - 1, Math.floor(Math.log(frequency / 30) / Math.log(4000 / 30) * BANDS));
      if (band >= 0) bands[band] += spectrum[bin];
    }
  }
  // Square root compresses very strong harmonics without losing amplitude invariance.
  const compressed = bands.map(Math.sqrt);
  const norm = Math.hypot(...compressed) || 1;
  const envelope = Array.from({ length: ENVELOPE }, (_, i) => rms(active.subarray(Math.floor(i * active.length / ENVELOPE), Math.floor((i + 1) * active.length / ENVELOPE))));
  const envelopeNorm = Math.hypot(...envelope) || 1;
  return [...compressed.map(v => v / norm), ...envelope.map(v => v / envelopeNorm)];
}

export function featureSimilarity(a: number[], b: number[]): number {
  if (a.length !== FEATURE_LENGTH || b.length !== FEATURE_LENGTH || ![...a, ...b].every(v => Number.isFinite(v) && v >= 0 && v <= 1)) return 0;
  const cosine = (start: number, end: number): number => {
    let dot = 0, aa = 0, bb = 0;
    for (let i = start; i < end; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
    return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : 0;
  };
  // Both groups must contain energy; zero groups are invalid imported descriptors.
  if (![a, b].every(v => v.slice(0, BANDS).some(x => x > 0) && v.slice(BANDS).some(x => x > 0))) return 0;
  return Math.max(0, Math.min(1, cosine(0, BANDS) * 0.9 + cosine(BANDS, FEATURE_LENGTH) * 0.1));
}

export function classifyFeatures(features: number[], references: SoundReference[], threshold = 0.88): AudioMatch {
  threshold = Number.isFinite(threshold) ? Math.max(0, Math.min(1, threshold)) : 0.88;
  const unknown = (reason: string, similarity = 0): AudioMatch => ({ status: 'unknown', name: 'Не определено', similarity, timestamp: Date.now(), reason });
  if (!features.length) return unknown('Тишина или слишком короткий звук');
  if (!references.length) return unknown('Добавьте эталонные записи звуков');
  const ranked = references.map(reference => ({ reference, score: featureSimilarity(features, reference.features) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best.score <= 0 || best.score < threshold) return unknown('Нет достаточно похожего эталона', best.score);
  const families = new Map<string, SoundHypothesis>();
  for (const { reference, score } of ranked) {
    if (score < threshold || best.score - score >= 0.025) continue;
    const key = reference.groupId !== undefined ? `group:${reference.groupId}` : JSON.stringify([reference.name, reference.rarity]);
    if (!families.has(key)) families.set(key, {
      referenceId: reference.id, name: reference.name, rarity: reference.groupId === undefined ? reference.rarity : undefined,
      groupId: reference.groupId, action: reference.action, candidates: reference.candidates, similarity: score,
    });
  }
  const alternatives = [...families.values()];
  if (alternatives.length > 1) return { ...unknown('Неоднозначное совпадение эталонов', best.score), alternatives, threshold };
  return { status: 'match', ...alternatives[0], alternatives, threshold, timestamp: Date.now() };
}

function makeContext(): AudioContext {
  if (typeof AudioContext === 'undefined') throw new Error('Браузер не поддерживает Web Audio API');
  return new AudioContext();
}
async function decode(file: Blob): Promise<{ samples: Float32Array; sampleRate: number }> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Размер аудиофайла не должен превышать 20 МБ');
  const context = makeContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    if (!Number.isFinite(buffer.duration) || buffer.duration > MAX_DURATION_SECONDS) throw new Error('Длительность аудиофайла не должна превышать 15 секунд');
    const samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const values = buffer.getChannelData(channel);
      for (let i = 0; i < samples.length; i++) samples[i] += values[i] / buffer.numberOfChannels;
    }
    return { samples, sampleRate: buffer.sampleRate };
  } finally { await context.close(); }
}
export async function createReference(file: Blob, name: string, rarity: Rarity): Promise<SoundReference> {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) throw new Error('Название эталона должно содержать от 1 до 120 символов');
  if (!['common', 'rare', 'epic', 'legendary', 'red'].includes(rarity)) throw new Error('Недопустимая редкость эталона');
  const { samples, sampleRate } = await decode(file);
  const features = extractFeatures(samples, sampleRate);
  if (!features.length) throw new Error('В записи нет достаточно громкого звука длительностью от 25 мс');
  return { id: crypto.randomUUID(), name: name.trim(), rarity, features, duration: samples.length / sampleRate, createdAt: Date.now(), sampleRate };
}
export async function analyzeFile(file: Blob, references: SoundReference[], threshold = 0.88): Promise<AudioMatch> {
  const { samples, sampleRate } = await decode(file);
  return classifyFeatures(extractFeatures(samples, sampleRate), references, threshold);
}
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const data = new ArrayBuffer(44 + samples.length * 2), view = new DataView(data);
  const ascii = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, data.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  samples.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * (v < 0 ? 32768 : 32767), true));
  return new Blob([data], { type: 'audio/wav' });
}
const join = (chunks: Float32Array[]) => { const all = new Float32Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of chunks) { all.set(c, at); at += c.length; } return all; };
type Options = { onEventStart?: () => void; onLevel?: (level: number, spectrum: number[]) => void; onResult?: (result: AudioMatch) => void; onClip?: (clip: Blob) => void };
export class AudioEngine {
  private context?: AudioContext;
  private source?: MediaStreamAudioSourceNode;
  private processor?: AudioWorkletNode;
  private gain?: GainNode;
  private references: SoundReference[] = [];
  private sensitivity = 50;
  private threshold = 0.88;
  private noise = 0.0002;
  private burstSamples = 0;
  private burstQuiet = 0;
  private burstPeak = 0;
  private armed = true;
  private rearmQuiet = 0;
  private cooldown = 0;
  private burst: Float32Array[] | null = null;
  private pre: Float32Array[] = [];
  private captures: { chunks: Float32Array[]; remaining: number; resolve: (blob: Blob) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }[] = [];
  constructor(private options: Options = {}) {}
  setReferences(references: SoundReference[]): void { this.references = references; }
  setSensitivity(value: number): void { this.sensitivity = Math.max(0, Math.min(100, value)); }
  setThreshold(value: number): void { this.threshold = Math.max(0, Math.min(1, value)); }
  async start(stream: MediaStream): Promise<void> {
    this.stop();
    if (!stream.getAudioTracks().some(track => track.readyState === 'live' && track.enabled)) throw new Error('Источник не передаёт звук. Включите передачу аудио при выборе экрана или вкладки.');
    const context = makeContext(); this.context = context;
    const code = `class Capture extends AudioWorkletProcessor { constructor(){ super(); this.chunks=[]; this.size=0; } process(inputs){ const channels=inputs[0]; if(channels?.length){ const mono=new Float32Array(channels[0].length); for(const c of channels) for(let i=0;i<mono.length;i++) mono[i]+=c[i]/channels.length; this.chunks.push(mono); this.size+=mono.length; if(this.size>=2048){ const out=new Float32Array(this.size); let at=0; for(const c of this.chunks){out.set(c,at);at+=c.length;} this.port.postMessage(out,[out.buffer]); this.chunks=[];this.size=0; }} return true; }} registerProcessor('arena-capture',Capture);`;
    const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    try {
      await context.audioWorklet.addModule(url);
      if (this.context !== context) throw new Error('Запуск отменён');
      this.source = context.createMediaStreamSource(stream);
      this.processor = new AudioWorkletNode(context, 'arena-capture');
      this.gain = context.createGain(); this.gain.gain.value = 0;
      this.processor.port.onmessage = event => this.consume(event.data as Float32Array, context.sampleRate);
      this.source.connect(this.processor); this.processor.connect(this.gain); this.gain.connect(context.destination);
      await context.resume();
      if (this.context !== context) throw new Error('Запуск отменён');
    } catch (error) { if (this.context === context) this.stop(); throw error; }
    finally { URL.revokeObjectURL(url); }
  }
  private consume(chunk: Float32Array, rate: number): void {
    const level = rms(chunk);
    const spectrum = Array.from(powerSpectrum(chunk), v => Math.min(1, Math.sqrt(v) / 16)).filter((_, i) => i % 4 === 0);
    this.options.onLevel?.(Math.min(1, level * 8), spectrum);
    for (const capture of [...this.captures]) {
      const part = chunk.slice(0, capture.remaining); capture.chunks.push(part); capture.remaining -= part.length;
      if (capture.remaining <= 0) { clearTimeout(capture.timer); this.captures = this.captures.filter(c => c !== capture); capture.resolve(encodeWav(join(capture.chunks), rate)); }
    }
    const seconds = chunk.length / rate;
    this.cooldown = Math.max(0, this.cooldown - seconds);
    const onsetThreshold = Math.max(0.001 + (100 - this.sensitivity) * 0.00005, this.noise * 2.8);
    if (!this.armed && !this.burst) {
      this.rearmQuiet = level < Math.max(0.0005, this.noise * 1.8, this.burstPeak * 0.025) ? this.rearmQuiet + seconds : 0;
      if (this.rearmQuiet >= 0.18 && this.cooldown === 0) this.armed = true;
    }
    if (!this.burst && this.armed && this.cooldown === 0 && level > onsetThreshold) {
      this.burst = [...this.pre];
      this.burstSamples = this.pre.reduce((n, c) => n + c.length, 0);
      this.burstQuiet = 0; this.burstPeak = level; this.armed = false; this.rearmQuiet = 0;
      this.options.onEventStart?.();
    }
    if (this.burst) {
      this.burst.push(chunk); this.burstSamples += chunk.length;
      this.burstPeak = Math.max(this.burstPeak, level);
      const quietThreshold = Math.max(0.0005, this.noise * 1.8, this.burstPeak * 0.025);
      this.burstQuiet = level < quietThreshold ? this.burstQuiet + seconds : 0;
      if ((this.burstSamples >= rate * 0.15 && this.burstQuiet >= 0.18) || this.burstSamples >= rate * 1.7) {
        const samples = join(this.burst); this.burst = null; this.cooldown = 0.12;
        this.rearmQuiet = this.burstQuiet;
        this.options.onClip?.(encodeWav(samples, rate));
        this.options.onResult?.(classifyFeatures(extractFeatures(samples, rate), this.references, this.threshold));
      }
    } else if (this.armed && level < onsetThreshold) this.noise = this.noise * 0.98 + Math.min(level, 0.03) * 0.02;
    this.pre.push(chunk); while (this.pre.length > Math.ceil(rate * 0.08 / chunk.length)) this.pre.shift();
  }
  captureSample(durationMs = 1000): Promise<Blob> {
    if (!this.context || this.context.state !== 'running') return Promise.reject(new Error('Сначала подключите источник звука'));
    const duration = Math.max(100, Math.min(10000, durationMs));
    return new Promise((resolve, reject) => {
      const capture = { chunks: [] as Float32Array[], remaining: Math.round(this.context!.sampleRate * duration / 1000), resolve, reject, timer: setTimeout(() => { this.captures = this.captures.filter(c => c !== capture); reject(new Error('Источник перестал передавать звук')); }, duration + 3000) };
      this.captures.push(capture);
    });
  }
  stop(): void {
    this.processor?.port.close(); this.processor?.disconnect(); this.source?.disconnect(); this.gain?.disconnect();
    const context = this.context; this.context = undefined;
    if (context && context.state !== 'closed') void context.close();
    this.processor = undefined; this.source = undefined; this.gain = undefined;
    for (const capture of this.captures) { clearTimeout(capture.timer); capture.reject(new Error('Запись остановлена')); }
    this.captures = []; this.burst = null; this.pre = []; this.noise = 0.0002; this.cooldown = 0;
    this.burstSamples = 0; this.burstQuiet = 0; this.burstPeak = 0; this.armed = true; this.rearmQuiet = 0;
  }
}
