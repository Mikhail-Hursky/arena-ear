// Offline validation: node scripts/sync-merchant-catalog.mjs --check
// Refresh from the rendered public page: PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/sync-merchant-catalog.mjs --refresh
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = 'https://abi-tracker.azurewebsites.net/GameInfo/Merchant?lang=en';
const AUDIO_BASE = 'https://hexaov91.github.io/abi-assets/data/merchant/';
const CATALOG = 'src/data/merchant-groups.json';
const REFERENCE = 'reference-data/merchant-audio/';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async path => JSON.parse(await readFile(resolve(ROOT, path), 'utf8'));
const saveJson = (path, data) => writeFile(resolve(ROOT, path), `${JSON.stringify(data, null, 2)}\n`);
const assert = (value, message) => { if (!value) throw new Error(message); };
const audioPath = path => typeof path === 'string' && /^audio\/[0-9]+-[a-f0-9]+\.ogg$/.test(path);

export function validateCatalog(catalog, manifest) {
  assert(Array.isArray(catalog.groups) && catalog.groups.length > 0, 'Empty sound catalog');
  assert(Array.isArray(manifest) && manifest.length > 0, 'Empty audio manifest');
  const groupIds = new Set(), itemIds = new Set(), used = new Set();
  const files = new Map(manifest.map(file => [file.path, file]));
  assert(files.size === manifest.length, 'Duplicate audio file paths');
  for (const file of manifest) {
    assert(audioPath(file.path) && /^[a-f0-9]{64}$/.test(file.sha256), 'Invalid audio file manifest entry');
    assert(Number.isSafeInteger(file.bytes) && file.bytes > 4 && file.bytes <= 5 * 1024 * 1024, 'Invalid audio file size');
    const url = new URL(file.sourceUrl);
    assert(url.href === `${AUDIO_BASE}${file.path}`, 'Unexpected audio source URL');
  }
  for (const group of catalog.groups) {
    assert(Number.isSafeInteger(group.id) && group.id > 0 && !groupIds.has(group.id), 'Invalid or duplicate sound group');
    groupIds.add(group.id);
    assert(Array.isArray(group.candidates) && group.candidates.length > 0, `Empty group ${group.id}`);
    for (const action of ['pickup', 'drop']) {
      const paths = group[action]?.files;
      assert(Array.isArray(paths) && paths.length === 1 && audioPath(paths[0]) && files.has(paths[0]), `Missing ${action} audio for group ${group.id}`);
      used.add(paths[0]);
    }
    for (const item of group.candidates) {
      assert(Number.isSafeInteger(item.id) && item.id > 0 && !itemIds.has(item.id), 'Invalid or duplicate item ID');
      itemIds.add(item.id);
      assert(typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 120, 'Invalid item name');
      assert(Number.isInteger(item.rarity) && item.rarity >= 1 && item.rarity <= 6, 'Invalid item rarity');
      assert(Array.isArray(item.size) && item.size.length === 2 && item.size.every(n => Number.isInteger(n) && n > 0 && n <= 20), 'Invalid item dimensions');
    }
  }
  assert(used.size === files.size, 'Unreferenced audio files in manifest');
  return { groups: groupIds.size, items: itemIds.size, files: used.size };
}

async function check() {
  const catalog = await readJson(CATALOG), manifest = await readJson(`${REFERENCE}files.json`);
  const counts = validateCatalog(catalog, manifest);
  for (const file of manifest) {
    for (const path of [`${REFERENCE}${file.path}`, `public/sounds/merchant/${file.path.split('/')[1]}`]) {
      const bytes = await readFile(resolve(ROOT, path));
      assert(bytes.toString('ascii', 0, 4) === 'OggS' && bytes.length === file.bytes && hash(bytes) === file.sha256, `Audio integrity check failed: ${path}`);
    }
  }
  assert(JSON.stringify(catalog) === JSON.stringify(await readJson(`${REFERENCE}groups.json`)), 'Application and reference catalogs differ');
  console.log(JSON.stringify({ ...counts, version: catalog.version, verifiedAt: catalog.verifiedAt ?? catalog.retrievedAt, integrity: 'ok' }));
}

async function refresh() {
  // Uses only the public UI, including its ordinary media playback. No remote
  // application code or encoded data files are copied, evaluated or decoded here.
  const module = process.env.PLAYWRIGHT_MODULE;
  const { chromium } = await import(module ? pathToFileURL(resolve(module)).href : 'playwright');
  const catalog = await readJson(CATALOG), manifest = await readJson(`${REFERENCE}files.json`);
  validateCatalog(catalog, manifest);
  const byHash = new Map(manifest.map(file => [file.sha256, file]));
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.addInitScript(() => {
      window.__catalogPlayed = [];
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        const src = this.src;
        window.__catalogPlayed.push(fetch(src).then(response => response.arrayBuffer()).then(async bytes =>
          [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('')));
        this.muted = true;
        return original.apply(this, args);
      };
    });
    await page.goto(SOURCE);
    await page.locator('#merchantItems .merchant-item').first().waitFor({ timeout: 30000 });
    const config = JSON.parse(await page.locator('#abi-config-merchant').textContent());
    assert(/^\d+(?:\.\d+)+$/.test(config.dataVersion), 'Invalid source data version');
    const ids = await page.locator('#merchantSounds [data-sound-id]').evaluateAll(cards => cards.map(card => Number(card.dataset.soundId)));
    assert(ids.length >= catalog.groups.length, 'Source returned fewer sound groups; inspect manually');
    const groups = [];
    for (const id of ids) {
      assert(Number.isSafeInteger(id) && id > 0, 'Invalid source sound group ID');
      await page.locator(`[data-sound-id="${id}"] input`).check();
      const candidates = await page.locator('#merchantItems .merchant-item').evaluateAll(items => items.map(element => ({
        id: Number(element.dataset.itemId), name: element.querySelector('h3').textContent.trim(),
        rarity: Number(element.querySelector('[data-rarity]').dataset.rarity),
        size: element.querySelector('.merchant-item-size').getAttribute('aria-label').split(/\s*x\s*/).map(Number),
      })));
      const previous = catalog.groups.find(group => group.id === id), group = { id };
      for (const [index, action] of ['pickup', 'drop'].entries()) {
        const count = await page.evaluate(() => window.__catalogPlayed.length);
        await page.locator(`[data-sound-id="${id}"] .merchant-play`).nth(index).click();
        await page.waitForFunction(count => window.__catalogPlayed.length > count, count, { timeout: 10000 });
        const sha256 = await page.evaluate(() => window.__catalogPlayed.at(-1));
        const file = byHash.get(sha256);
        // Unknown recordings require a deliberate provenance/manifest update;
        // never silently attach an old recording to a new group or overwrite it.
        assert(file, `New audio SHA-256 ${sha256} for group ${id}/${action}; add its verified source to the manifest first`);
        group[action] = { event: previous?.[action]?.event ?? `Sound_${id}_${action}`, files: [file.path] };
      }
      groups.push({ ...group, candidates: candidates.sort((a, b) => a.id - b.id) });
    }
    const date = new Date().toISOString().slice(0, 10);
    const updated = { ...catalog, source: SOURCE, sources: ['https://abibuilder.com/merchant', SOURCE], version: config.dataVersion, retrievedAt: date, verifiedAt: date, coverage: 'public-field-merchant-catalog', groups };
    const counts = validateCatalog(updated, manifest);
    const previousCount = catalog.groups.reduce((n, group) => n + group.candidates.length, 0);
    assert(counts.items >= previousCount, 'Source returned fewer items; inspect manually');
    // Confirm the original source audio bytes still match the played recordings.
    for (const file of manifest) {
      const response = await fetch(file.sourceUrl, { signal: AbortSignal.timeout(15000) });
      assert(response.ok, `HTTP ${response.status} fetching ${file.path}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert(bytes.length === file.bytes && hash(bytes) === file.sha256, `Remote recording changed: ${file.path}`);
    }
    await saveJson(CATALOG, updated);
    await saveJson(`${REFERENCE}groups.json`, updated);
    const index = await readJson(`${REFERENCE}audio-index.json`);
    await saveJson(`${REFERENCE}audio-index.json`, { ...index, verifiedAt: date, verifiedDataVersion: config.dataVersion, verifiedGroupPlaybacks: groups.length * 2 });
    console.log(JSON.stringify({ ...counts, version: config.dataVersion, verifiedAt: date, remoteAudioHashes: 'ok' }));
  } finally { await browser.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2] ?? '--check';
  assert(process.argv.length <= 3 && ['--check', '--refresh'].includes(mode), 'Usage: node scripts/sync-merchant-catalog.mjs [--check|--refresh]');
  await (mode === '--refresh' ? refresh() : check());
}
