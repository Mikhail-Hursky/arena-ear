// Run: PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-audio.mjs
// Uses an isolated headless Chromium, synthetic audio only, no capture permissions.
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5173');
  const result = await page.evaluate(async () => {
    const { AudioEngine, createReference, analyzeFile, encodeWav } = await import('/src/lib/audio.ts');
    const assert = (condition, message) => { if (!condition) throw new Error(message); };
    const tone = frequency => Float32Array.from({ length: 24000 }, (_, i) => 0.2 * Math.sin(2 * Math.PI * frequency * i / 48000));
    const a = await createReference(encodeWav(tone(440), 48000), '440 Hz', 'rare');
    const b = await createReference(encodeWav(tone(1000), 48000), '1000 Hz', 'red');
    const fileMatch = await analyzeFile(encodeWav(tone(440), 48000), [a, b]);
    const silence = await analyzeFile(encodeWav(new Float32Array(24000), 48000), [a, b]);
    assert(fileMatch.name === '440 Hz' && fileMatch.rarity === 'rare', 'file match failed');
    assert(silence.status === 'unknown', 'silence not rejected');
    const sourceContext = new AudioContext({ sampleRate: 48000 });
    await sourceContext.resume();
    const oscillator = sourceContext.createOscillator(); oscillator.frequency.value = 440;
    const gain = sourceContext.createGain(); gain.gain.value = 0;
    const destination = sourceContext.createMediaStreamDestination();
    oscillator.connect(gain); gain.connect(destination); oscillator.start();
    let levels = 0, peak = 0, results = [], clips = 0, starts = 0;
    const eventOrder = [];
    const engine = new AudioEngine({ onEventStart: () => { starts++; eventOrder.push('start'); }, onLevel: level => { levels++; peak = Math.max(level, peak); }, onResult: value => { results.push(value); eventOrder.push('result'); }, onClip: () => { clips++; eventOrder.push('clip'); } });
    engine.setReferences([a, b]);
    try {
      await engine.start(destination.stream);
      gain.gain.value = 0.2;
      const recorded = await engine.captureSample(500);
      const recordedMatch = await analyzeFile(recorded, [a, b]);
      assert(recorded.type === 'audio/wav' && recorded.size > 40000, 'capture missing PCM');
      assert(recordedMatch.name === '440 Hz', 'recorded file match failed');
      await new Promise(resolve => setTimeout(resolve, 1400));
      assert(levels > 5 && peak > 0.1, 'level callback missing');
      assert(results.some(item => item.name === '440 Hz'), 'onset result absent');
      assert(clips > 0, 'clip callback absent');
      assert(starts === clips && eventOrder[0] === 'start' && eventOrder[1] === 'clip' && eventOrder[2] === 'result', 'onset callback missing, repeated during burst/cooldown, or late');
      const pending = engine.captureSample(1000).then(() => 'resolved', error => error.message);
      engine.stop();
      const stopReason = await pending;
      assert(stopReason === 'Запись остановлена', 'stop did not reject capture');
      const before = levels;
      await new Promise(resolve => setTimeout(resolve, 200));
      assert(levels === before, 'callbacks continue after stop');
      assert(destination.stream.getTracks().every(track => track.readyState === 'live'), 'engine stopped caller tracks');
      let absentAudio = false;
      try { await engine.start(new MediaStream()); } catch { absentAudio = true; }
      assert(absentAudio, 'missing-track guard failed');
      return { fileMatch, silence, recordedMatch, recordedBytes: recorded.size, levels, peak, results, clips, starts, eventOrder, stopReason, noCallbacksAfterStop: levels === before, missingAudioRejected: absentAudio };
    } finally {
      engine.stop(); oscillator.stop(); destination.stream.getTracks().forEach(track => track.stop()); await sourceContext.close();
    }
  });
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
