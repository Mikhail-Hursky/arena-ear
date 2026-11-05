// Rebuild after changing merchant OGG files or extractFeatures(). Requires local
// Chrome and Playwright; no audio data is downloaded from external services.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node scripts/generate-builtin-features.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const catalog = JSON.parse(await readFile(new URL('../src/data/merchant-groups.json', import.meta.url), 'utf8'));
const filenames = [...new Set(catalog.groups.flatMap(group => [group.pickup.files[0], group.drop.files[0]]).map(path => path.split('/').at(-1)))].sort();
if (filenames.some(filename => !/^[A-Za-z0-9_-]+\.ogg$/.test(filename))) throw new Error('Invalid catalog audio filename');
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0, strictPort: false } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('No local Vite server address');
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  // An isolated same-origin document imports only the real audio descriptor code.
  await page.route(`${origin}/__builtin_features__`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Built-in sound descriptors</title>' }));
  await page.goto(`${origin}/__builtin_features__`);
  const manifest = await page.evaluate(async filenames => {
    const { extractFeatures, FEATURE_VERSION, FEATURE_LENGTH } = await import('/src/lib/audio.ts');
    const context = new AudioContext({ sampleRate: 48000 });
    const samples = {};
    try {
      for (const filename of filenames) {
        const response = await fetch(`/sounds/merchant/${filename}`);
        if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
        const buffer = await context.decodeAudioData(await response.arrayBuffer());
        if (!(buffer.duration > 0 && buffer.duration <= 15)) throw new Error(`${filename}: invalid duration`);
        const mono = new Float32Array(buffer.length);
        for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
          const data = buffer.getChannelData(channel);
          for (let i = 0; i < mono.length; i++) mono[i] += data[i] / buffer.numberOfChannels;
        }
        const features = extractFeatures(mono, buffer.sampleRate);
        if (features.length !== FEATURE_LENGTH || !features.every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new Error(`${filename}: invalid descriptor`);
        samples[filename] = { duration: buffer.duration, sampleRate: buffer.sampleRate, features: features.map(value => Number(value.toFixed(10))) };
      }
      return { featureVersion: FEATURE_VERSION, featureLength: FEATURE_LENGTH, decoder: 'Chrome Web Audio / 48000 Hz', samples };
    } finally { await context.close(); }
  }, filenames);
  for (const filename of filenames) {
    const bytes = await readFile(new URL(`../public/sounds/merchant/${filename}`, import.meta.url));
    manifest.samples[filename].sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  await writeFile(new URL('../src/data/merchant-features.json', import.meta.url), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Generated ${filenames.length} embedded descriptors (${manifest.featureLength} features, version ${manifest.featureVersion}).`);
} finally {
  await browser?.close();
  await server.close();
}
