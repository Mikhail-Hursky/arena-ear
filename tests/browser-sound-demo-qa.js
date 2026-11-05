async (page) => {
  // Run in a test browser while Vite serves localhost:5173. Playback is real;
  // instrumentation records calls/events without replacing the browser player.
  await page.addInitScript(() => {
    window.__soundDemoQA = [];
    const original = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      window.__soundDemoQA.push({ type: 'call', src: this.src, muted: this.muted });
      this.addEventListener('playing', () => window.__soundDemoQA.push({ type: 'playing', src: this.src }), { once: true });
      return original.call(this);
    };
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto('http://127.0.0.1:5173/#/demo');
  await page.reload();
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const source = page.locator('.sound-demo-board .sound-demo-grab').first();
  await source.waitFor();
  assert(await page.evaluate(() => window.__soundDemoQA.length === 0), 'Audio must not autoplay');
  const sourceName = await source.getAttribute('aria-label');
  const destination = page.locator('[data-demo-place="bag"][data-demo-slot="0"]');
  await destination.scrollIntoViewIfNeeded();
  const a = await source.boundingBox(), b = await destination.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(250);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(350);
  assert(await destination.locator('.sound-demo-grab').getAttribute('aria-label') === sourceName, 'Pointer drop must move the item');
  const played = await page.evaluate(() => window.__soundDemoQA);
  const calls = played.filter(event => event.type === 'call');
  assert(calls.length === 2 && calls[0].src !== calls[1].src, 'Drag must play different pickup and drop files exactly once');
  assert(played.filter(event => event.type === 'playing').length === 2, 'Both files must enter native playback');
  await destination.locator('.sound-demo-grab').focus();
  await page.keyboard.press('Space');
  const empty = page.locator('[data-demo-place="merchant"][data-demo-slot="12"] .sound-demo-empty');
  await empty.focus(); await page.keyboard.press('Enter');
  const moved = page.locator('[data-demo-place="merchant"][data-demo-slot="12"] .sound-demo-grab');
  assert(await moved.count() === 1, 'Keyboard drop must move the item');
  await moved.focus(); await page.keyboard.press('Space'); await page.keyboard.press('Escape');
  assert(await moved.getAttribute('aria-pressed') === 'false', 'Escape must cancel drag');
  await page.getByRole('textbox', { name: 'Поиск предмета' }).fill('not-an-item');
  assert(await page.locator('.sound-demo-no-results').count() === 1, 'Search empty state missing');
  await page.getByRole('textbox', { name: 'Поиск предмета' }).fill('');
  await page.getByRole('combobox', { name: 'Звуковая группа', exact: true }).selectOption('38');
  assert(await page.locator('.sound-demo-catalog-item').count() === 2, 'Group 38 must show both radio candidates');
  await page.getByRole('button', { name: 'Выключить звук', exact: true }).click();
  await page.getByRole('button', { name: 'Положить', exact: true }).click();
  assert(await page.evaluate(() => window.__soundDemoQA.filter(event => event.type === 'call').at(-1).muted), 'Mute must affect actual audio element');
  await page.getByRole('button', { name: 'Остановить воспроизведение', exact: true }).click();
  assert(await page.locator('.sound-demo-error').count() === 0, 'Playback failed');
  return { pointerDrag: true, actualPickupAndDrop: true, keyboardDrag: true, cancel: true, catalogSearch: true, groupFilter: true, muted: true };
}
