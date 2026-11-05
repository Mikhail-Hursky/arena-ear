// Run against npm run dev. Uses isolated Chrome and real OGG/Web Audio/canvas video.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/browser-recognition.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const catalog = JSON.parse(await readFile(resolve(root, 'src/data/merchant-groups.json'), 'utf8'));
const group = id => catalog.groups.find(group => group.id === id);
const file = id => resolve(root, 'public/sounds/merchant', group(id).pickup.files[0].split('/').at(-1));
const url = id => `/sounds/merchant/${group(id).pickup.files[0].split('/').at(-1)}`;
const origin = process.env.ARENA_QA_URL ?? 'http://127.0.0.1:5173';
const historyKey = 'arena-ear:v1:history';
const result = { scenarios: {}, pageErrors: [], httpErrors: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });

async function newPage(autoScan = true) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(autoScan => {
    localStorage.setItem('arena-ear:v1:settings', JSON.stringify({
      autoScan, region: { x: 0, y: 0, width: 1, height: 1 }, gridColumns: 8, gridRows: 8,
    }));
  }, autoScan);
  const page = await context.newPage();
  const audioRequests = [];
  page.on('request', request => { if (request.url().includes('/sounds/merchant/')) audioRequests.push(request.url()); });
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().startsWith(origin) && response.status() >= 400) result.httpErrors.push({ url: response.url(), status: response.status() });
  });
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Анализ груза', exact: true }).waitFor();
  assert.equal(await page.getByRole('checkbox', { name:'Учитывать поворот предмета', exact:true }).count(), 0);
  await page.getByText(/Ориентация в магазине фиксирована/).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Слушать игру', exact: true }).first().isEnabled(), true);
  const state = await page.evaluate(async () => (await import('/src/lib/builtin-sounds.ts')).getBuiltinLoadState());
  assert.deepEqual(state, { loaded: 76, total: 76, status: 'ready' });
  assert.equal(audioRequests.length, 0, 'Startup must not fetch/decode OGG recordings');
  return { context, page, audioRequests };
}

async function latestHistory(page, count) {
  await page.waitForFunction(({ key, count }) => JSON.parse(localStorage.getItem(key) ?? '[]').length >= count,
    { key: historyKey, count }, { timeout: 15000 });
  return page.evaluate(key => JSON.parse(localStorage.getItem(key))[0], historyKey);
}

async function installCapture(page) {
  return page.evaluate(async soundUrl => {
    const canvas = document.createElement('canvas'); canvas.width = 560; canvas.height = 560;
    const ctx = canvas.getContext('2d');
    const context = new AudioContext({ sampleRate: 48000 }); await context.resume();
    const sound = await context.decodeAudioData(await (await fetch(soundUrl)).arrayBuffer());
    const destination = context.createMediaStreamDestination();
    const q = { canvas, ctx, context, sound, destination, highlight: false, background: 20 };
    q.paint = () => {
      ctx.fillStyle = `rgb(${q.background},${q.background},${q.background})`; ctx.fillRect(0, 0, 560, 560);
      ctx.fillStyle = 'rgb(180,180,180)';
      for (let i = 0; i <= 8; i++) {
        ctx.fillRect(40 + i * 60, 40, 1, 481); ctx.fillRect(40, 40 + i * 60, 481, 1);
      }
      const shade = q.highlight ? 100 : q.background;
      ctx.fillStyle = `rgb(${shade},${shade},${shade})`;
      ctx.fillRect(101, 101, 179, 119); // Preserve frame; erase internal 3×2 unit separators.
    };
    q.paint(); q.timer = setInterval(q.paint, 50);
    q.source = canvas.captureStream(20); q.source.addTrack(destination.stream.getAudioTracks()[0]);
    q.play = async () => {
      q.highlight = !q.highlight; q.paint();
      await new Promise(resolve => setTimeout(resolve, 50));
      const source = context.createBufferSource(); source.buffer = sound; source.connect(destination);
      await new Promise(resolve => { source.onended = resolve; source.start(); });
    };
    window.__recognitionQA = q;
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { configurable: true, value: async () => q.source });
    const detection = (await import('/src/lib/grid.ts')).detectGrid(ctx.getImageData(0, 0, 560, 560));
    return { columns: detection?.columns, rows: detection?.rows, confidence: detection?.confidence,
      merged: detection?.cells.find(cell => cell.id === 'cell-1-1') };
  }, url(28));
}

async function cleanCapture(page) {
  await page.evaluate(async () => {
    const q = window.__recognitionQA;
    if (q) { clearInterval(q.timer); q.source.getTracks().forEach(track => track.stop()); await q.context.close(); }
  });
}

async function automatic() {
  const { context, page, audioRequests } = await newPage();
  try {
    result.scenarios.readyAtStartup = { loaded: 76, audioRequests: audioRequests.length, captureEnabled: true };
    const detected = await installCapture(page);
    assert.equal(detected.columns, 8); assert.equal(detected.rows, 8); assert.ok(detected.confidence >= .75);
    assert.deepEqual(detected.merged, { id: 'cell-1-1', row: 1, col: 1, width: 3, height: 2 });
    await page.getByRole('button', { name: 'Слушать игру', exact: true }).first().click();
    await page.getByRole('button', { name: 'Остановить захват', exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('[aria-label="Выбрать ячейку cell-1-1"]')?.style.gridColumn.includes('span 3'));
    await page.waitForTimeout(650); // Actual scanner needs two stable observations before associating motion.
    assert.equal(await page.locator('.slot.selected').count(), 0);
    await page.evaluate(() => window.__recognitionQA.play());
    const first = await latestHistory(page, 1);
    assert.equal(first.cellId, 'cell-1-1'); assert.equal(first.demo, false);
    assert.equal(first.name, 'Gold Lion Statue'); assert.equal(first.recognition.status, 'identified');
    assert.deepEqual(first.recognition.observedSize, [3, 2]); assert.equal(first.recognition.sizeSource, 'detected');
    assert.equal(first.candidates.length, 1);
    assert.match(await page.locator('.binding-note').innerText(), /Автовыбор по кадру: cell-1-1/);
    assert.match(await page.getByRole('button', { name: 'Выбрать ячейку cell-1-1', exact: true }).innerText(), /Gold Lion Statue/);
    await page.waitForTimeout(650);
    await page.evaluate(() => window.__recognitionQA.play());
    const second = await latestHistory(page, 2);
    assert.equal(second.name, 'Gold Lion Statue');
    assert.equal(second.recognition.observations, 1, 'Position alone must not establish persistent item identity');
    result.scenarios.automatic = { detected, name: first.name, similarity: first.similarity, cellId: first.cellId,
      selectedBeforeSound: false, candidatesBefore: first.recognition.candidatesBefore, candidatesAfter: 1, repeatedEventsRemainIndependent: true };
    await page.getByRole('button', { name: 'Выбрать ячейку cell-1-1', exact: true }).click();
    assert.equal(await page.locator('.slot.selected').count(), 1);
    await page.evaluate(() => { const q = window.__recognitionQA; q.background = 70; q.paint(); });
    await page.waitForFunction(() => !document.querySelector('.slot-result') && !document.querySelector('.slot.selected'), null, { timeout: 5000 });
    assert.match(await page.locator('.binding-note').innerText(), /Кадр торговца изменился/);
    result.scenarios.viewChange = { labelsCleared: true, selectionCleared: true };
    await page.getByRole('button', { name: 'Остановить захват', exact: true }).click();
    await cleanCapture(page);
    await page.reload();
    await page.getByRole('heading', { name: 'Анализ груза', exact: true }).waitFor();
    const persisted = await latestHistory(page, 2);
    assert.equal(persisted.name, 'Gold Lion Statue'); assert.equal(persisted.recognition.observations, 1);
    assert.deepEqual(persisted.recognition.observedSize, [3, 2]);
    result.scenarios.persistence = { name: persisted.name, retainedEvents: 2, observedSize: persisted.recognition.observedSize };
    await page.getByRole('button', { name: 'Демо звуков', exact: true }).click();
    await page.evaluate(() => {
      window.__demoPlayed = [];
      const original = HTMLMediaElement.prototype.play;
      HTMLMediaElement.prototype.play = function (...args) {
        this.addEventListener('playing', () => window.__demoPlayed.push({ url: this.src, duration: this.duration }), { once: true });
        return original.apply(this, args);
      };
    });
    await page.getByRole('button', { name: 'Поднять', exact: true }).click();
    await page.waitForFunction(() => window.__demoPlayed.length > 0, null, { timeout: 10000 });
    const played = await page.evaluate(() => window.__demoPlayed[0]);
    assert.ok(played.duration > 0); assert.ok(played.url.endsWith(group(28).pickup.files[0].split('/').at(-1)));
    result.scenarios.demoPlayback = played;
    await page.getByRole('button', { name: 'Остановить воспроизведение', exact: true }).click();
  } finally { await cleanCapture(page).catch(() => {}); await context.close(); }
}

async function manual() {
  const { context, page } = await newPage(false);
  let count = 0;
  const choose = () => page.getByRole('button', { name: 'Выбрать ячейку cell-0-0', exact: true }).click();
  async function upload(groupId) {
    await page.locator('.analysis-controls input[type=file]').setInputFiles(file(groupId));
    return latestHistory(page, ++count);
  }
  async function confirm(width, height) {
    await choose();
    await page.getByRole('spinbutton', { name: 'Ширина предмета', exact: true }).fill(String(width));
    await page.getByRole('spinbutton', { name: 'Высота предмета', exact: true }).fill(String(height));
    await page.getByRole('button', { name: 'Подтвердить размер', exact: true }).click();
  }
  try {
    await page.getByRole('button', { name: 'Ручная сетка', exact: true }).click();
    await choose();
    const unconfirmed = await upload(28);
    assert.equal(unconfirmed.recognition.status, 'audio-only'); assert.equal(unconfirmed.candidates.length, 2);
    assert.equal(unconfirmed.recognition.observedSize, undefined);
    result.scenarios.manualPlaceholder = { status: 'audio-only', candidates: 2, forcedOneByOneSize: false };
    await confirm(3, 2);
    const lion = await upload(28);
    assert.equal(lion.name, 'Gold Lion Statue'); assert.equal(lion.recognition.status, 'identified');
    await choose();
    const repeated = await upload(28);
    assert.equal(repeated.recognition.observations, 1);
    await confirm(2, 1);
    const cheetah = await upload(28);
    assert.equal(cheetah.name, 'Gold Cheetah Statue'); assert.equal(cheetah.recognition.status, 'identified');
    await confirm(2, 3);
    const sculptures = await upload(36);
    assert.equal(sculptures.recognition.status, 'ambiguous'); assert.equal(sculptures.rarity, undefined);
    assert.deepEqual(sculptures.candidates.map(item => item.name).sort(), ['Majestic Sculpture', 'Plaster Sculpture']);
    await confirm(2, 3);
    const transposed = await upload(28);
    assert.equal(transposed.status, 'unknown'); assert.equal(transposed.recognition.status, 'conflict');
    assert.deepEqual(transposed.candidates, []);
    await confirm(3, 3);
    const conflict = await upload(28);
    assert.equal(conflict.status, 'unknown'); assert.equal(conflict.recognition.status, 'conflict'); assert.equal(conflict.candidates.length, 0);
    await choose();
    await page.getByRole('spinbutton', { name: 'Ширина предмета', exact: true }).fill('0');
    assert.equal(await page.getByRole('button', { name: 'Подтвердить размер', exact: true }).isDisabled(), true);
    result.scenarios.manual = { threeByTwo: lion.name, twoByOne: cheetah.name, repeatObservations: repeated.recognition.observations,
      ambiguous: sculptures.candidates.map(item => item.name), transposedSize: transposed.recognition.status,
      impossibleSize: conflict.recognition.status, zeroSizeRejected: true };
  } finally { await context.close(); }
}

try {
  await automatic(); await manual();
  assert.deepEqual(result.pageErrors, []); assert.deepEqual(result.httpErrors, []);
  console.log(JSON.stringify({ passed: true, ...result }, null, 2));
} finally { await browser.close(); }
