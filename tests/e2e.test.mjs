// End-to-end tests in Chromium at iPhone size (390×844) with mocked Open-Meteo weather.
// Run: node --test tests/   (needs Playwright; uses a global install if it isn't in node_modules)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './server.mjs';
import { mockForecast } from './mock-weather.mjs';

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  ({ chromium } = await import('/opt/node-tools/node_modules/playwright/index.mjs'));
}

const ROOT = fileURLToPath(new URL('..', import.meta.url));
let server;
let base;
let browser;

before(async () => {
  server = await serve(ROOT.replace(/\/$/, ''));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function open({
  time = '2026-10-02T09:00:00-05:00', today = '2026-10-02', day, colorScheme = 'light', sw = 'block', path = '',
} = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    timezoneId: 'America/Chicago', locale: 'en-US', colorScheme, serviceWorkers: sw, acceptDownloads: true,
  });
  await context.clock.install({ time: new Date(time) });
  await context.route('https://api.open-meteo.com/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(mockForecast({ today, day })),
  }));
  const page = await context.newPage();
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(base + path);
  await page.waitForSelector('.view.active .page-head');
  return { context, page, errors };
}

const idb = (page, store) => page.evaluate((s) => new Promise((resolve, reject) => {
  const r = indexedDB.open('lawncare');
  r.onsuccess = () => {
    const q = r.result.transaction(s).objectStore(s).getAll();
    q.onsuccess = () => { resolve(q.result); r.result.close(); };
    q.onerror = () => reject(q.error);
  };
  r.onerror = () => reject(r.error);
}), store);
const product = async (page, id) => (await idb(page, 'products')).find((p) => p.id === id);
const sheet = (page) => page.locator('.sheet-wrap:last-child');
const guard = (page) => page.waitForTimeout(650);
const tab = async (page, name) => { await page.click(`.tab[data-tab="${name}"]`); await page.waitForTimeout(150); };

async function openLog(page, label) {
  await page.click('#fab');
  await page.waitForSelector('.log-menu');
  await guard(page);
  await page.click(`.log-choice:has-text("${label}")`);
  await page.waitForSelector('.log-sheet');
  await guard(page);
}

async function hold(page, ms) {
  const b = sheet(page).locator('.hold-btn');
  const box = await b.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

async function overflow(page, scope) {
  return page.evaluate((sel) => {
    const w = window.innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll(`${sel} *`)) {
      const r = el.getBoundingClientRect();
      if (r.width && r.height && (r.right > w + 0.5 || r.left < -0.5)) bad.push(`${el.tagName}.${el.className}`);
    }
    if (document.documentElement.scrollWidth > w) bad.push(`scrollWidth ${document.documentElement.scrollWidth}`);
    return bad;
  }, scope);
}

test('first run: every tab and sheet fits 390px with no sideways scrolling', async () => {
  const { page, errors, context } = await open();
  await page.waitForSelector('[data-testid="weather"]');
  assert.equal(await page.textContent('[data-testid="mow-pos"]'), '5');
  assert.equal(await page.textContent('[data-testid="mow-height"]'), '3.15″');
  assert.match(await page.textContent('[data-testid="mow-reason"]'), /dry/);
  assert.match(await page.textContent('[data-testid="soil24"]'), /^\d+°F$/);
  for (const t of ['today', 'plan', 'history', 'yard']) {
    await tab(page, t);
    assert.deepEqual(await overflow(page, '.view.active'), [], `overflow on ${t}`);
  }
  for (const label of ['Mow', 'Fertilize', 'Weed control', 'Other']) {
    await openLog(page, label);
    await sheet(page).locator('[data-act="details"]').click();
    assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), [], `overflow in ${label} sheet`);
    await sheet(page).locator('.sheet-cancel').click();
    await page.waitForTimeout(400);
  }
  await tab(page, 'yard');
  await page.click('[data-action="zone"][data-id="z3"]');
  await guard(page);
  assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), [], 'overflow in zone sheet');
  await sheet(page).locator('.sheet-cancel').click();
  await page.waitForTimeout(400);
  await page.click('[data-action="product"][data-id="p-lesco-24-0-11"]');
  await guard(page);
  assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), [], 'overflow in product sheet');
  assert.deepEqual(errors, []);
  await context.close();
});

test('quick log: four choices, tap guard, hold-to-save, duplicate warning, undo', async () => {
  const { page, errors, context } = await open();
  await page.click('#fab');
  await page.waitForSelector('.log-menu');
  assert.deepEqual(await page.locator('.log-choice-label').allTextContents(), ['Mow', 'Fertilize', 'Weed control', 'Other']);
  await guard(page);
  await page.click('.log-choice:has-text("Mow")');
  await page.waitForSelector('.log-sheet');
  // A tap within half a second of opening is ignored.
  await page.evaluate(() => document.querySelector('.sheet-wrap:last-child [data-act="date"]:not(.on)').click());
  await guard(page);
  assert.equal(await sheet(page).locator('[data-act="date"].on').textContent(), 'Today');
  assert.equal(await sheet(page).locator('[data-act="zone"].on').count(), 6);
  assert.equal(await sheet(page).locator('.pos.on .pos-n').textContent(), '5');
  assert.equal(await sheet(page).locator('.pos.on .pos-rec').count(), 1);
  // Yesterday chip works once the guard has passed.
  await sheet(page).locator('[data-act="date"]:has-text("Yesterday")').click();
  assert.equal(await sheet(page).locator('[data-act="date"].on').textContent(), 'Yesterday');
  await sheet(page).locator('[data-act="date"]:has-text("Today")').click();
  // Releasing early cancels.
  await hold(page, 400);
  await page.waitForTimeout(300);
  assert.equal(await sheet(page).locator('.hold-btn.done').count(), 0);
  assert.match(await sheet(page).locator('.hold-hint').textContent(), /Keep holding/);
  assert.equal((await idb(page, 'logs')).length, 0);
  // A full second saves, shows a checkmark and an Undo toast.
  await hold(page, 1150);
  await page.waitForSelector('.hold-btn.done .hold-check');
  await page.waitForSelector('.toast:has-text("Mow logged") .toast-undo');
  await page.waitForSelector('.log-sheet', { state: 'detached' });
  const logs = await idb(page, 'logs');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].position, 5);
  assert.equal(logs[0].height, 3.15);
  assert.equal(logs[0].hours, 1);
  await tab(page, 'yard');
  assert.equal(await page.textContent('[data-testid="hours-total"]'), '1 h');
  // Same day again: warning shows before saving.
  await openLog(page, 'Mow');
  assert.match(await sheet(page).locator('.banner-warn').textContent(), /Already logged today/);
  assert.match(await sheet(page).locator('.hold-hint').textContent(), /save anyway/);
  await sheet(page).locator('.sheet-cancel').click();
  await page.waitForTimeout(400);
  // Undo removes what was just saved.
  await openLog(page, 'Other');
  await sheet(page).locator('[data-act="kind"][data-kind="spreader"]').click();
  await hold(page, 1150);
  await page.waitForSelector('.toast:has-text("Activity logged")');
  assert.equal((await idb(page, 'logs')).length, 2);
  await page.click('.toast-undo');
  await page.waitForTimeout(300);
  assert.equal((await idb(page, 'logs')).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('fertilizer: inventory, timers and nitrogen update; edit and delete reverse them', async () => {
  const { page, errors, context } = await open();
  await tab(page, 'yard');
  await page.click('[data-action="product"][data-id="p-lesco-24-0-11"]');
  await guard(page);
  await sheet(page).locator('[data-act="bag"][data-n="1"]').click();
  assert.equal(await sheet(page).locator('[data-pfield="onHand"]').inputValue(), '50');
  await sheet(page).locator('[data-act="save"]').click();
  await page.waitForTimeout(400);
  assert.equal((await product(page, 'p-lesco-24-0-11')).onHand, 50);
  assert.match(await page.textContent('[data-action="product"][data-id="p-lesco-24-0-11"]'), /\$4\.17\/lb N · 50 lb on hand/);

  await openLog(page, 'Fertilize');
  assert.match(await sheet(page).locator('.choice.on .choice-title').textContent(), /Lesco/);
  assert.equal(await sheet(page).locator('[data-field="amount"]').inputValue(), '31.25');
  assert.equal(await sheet(page).locator('.calc-big').textContent(), '5.5');
  assert.match(await sheet(page).locator('.calc').textContent(), /1 lb N \/ 1,000 sq ft/);
  await hold(page, 1150);
  await page.waitForSelector('.toast:has-text("Fertilizer logged")');
  await page.waitForSelector('.log-sheet', { state: 'detached' });
  assert.equal((await product(page, 'p-lesco-24-0-11')).onHand, 18.75);
  const [log] = await idb(page, 'logs');
  assert.equal(log.effects.nLbs, 7.5);
  assert.deepEqual(log.effects.timers.map((t) => t.kind).sort(), ['keepOff', 'noMow', 'noRain']);
  assert.equal(Math.round((log.effects.timers.find((t) => t.kind === 'noRain').until - log.at) / 3600e3), 48); // sloped zones included

  await tab(page, 'today');
  assert.match(await page.textContent('.timer-keepOff'), /Keep kids and pets off until 1:0\d PM/);
  assert.match(await page.textContent('.timer-noMow'), /No mowing until tomorrow/);
  await tab(page, 'history');
  assert.equal(await page.textContent('[data-testid="total-n"]'), '1');
  assert.match(await page.textContent('[data-testid="totals"]'), /Lesco 24.0.11.*31\.3 lb · 1×/);

  // Edit: fewer zones → amount recalculates, inventory adjusts.
  await page.click('.log-row');
  await page.waitForSelector('.log-sheet');
  await guard(page);
  await sheet(page).locator('[data-act="zone"]:has-text("Back Left")').click();
  await sheet(page).locator('[data-act="zone"]:has-text("Back Right")').click();
  assert.equal(await sheet(page).locator('[data-field="amount"]').inputValue(), '17.08');
  await hold(page, 1150);
  await page.waitForSelector('.toast:has-text("Changes saved")');
  await page.waitForSelector('.log-sheet', { state: 'detached' });
  assert.equal((await product(page, 'p-lesco-24-0-11')).onHand, 32.92);
  assert.equal(await page.textContent('[data-testid="total-n"]'), '0.55');

  // Delete: inventory returns, timers stop, total resets. Undo restores.
  await page.click('.log-row');
  await page.waitForSelector('.log-sheet');
  await guard(page);
  await sheet(page).locator('[data-act="delete"]').click();
  await page.click('.dialog [data-v="1"]');
  await page.waitForSelector('.toast:has-text("Entry deleted")');
  assert.equal((await product(page, 'p-lesco-24-0-11')).onHand, 50);
  assert.equal((await idb(page, 'logs')).length, 0);
  assert.equal(await page.textContent('[data-testid="total-n"]'), '0');
  await tab(page, 'today');
  assert.equal(await page.locator('.timer').count(), 0);
  await page.click('.toast-undo');
  await page.waitForTimeout(300);
  assert.equal((await idb(page, 'logs')).length, 1);
  assert.equal((await product(page, 'p-lesco-24-0-11')).onHand, 32.92);
  assert.equal(await page.locator('.timer-keepOff').count(), 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('yard: zones, head defaults, labels, mower heights, schedule, water rates', async () => {
  const { page, errors, context } = await open({ path: '#yard' });
  assert.equal(await page.textContent('[data-testid="lawn-area"]'), '7,500 sq ft');
  assert.equal(await page.locator('[data-testid="zones"] [data-action="zone"]').count(), 6);
  assert.match(await page.textContent('[data-action="zone"][data-id="z3"]'), /800 sq ft · Spray · Moderate/);

  // Edit a zone's area.
  await page.click('[data-action="zone"][data-id="z1"]');
  await guard(page);
  await sheet(page).locator('[data-zfield="sqft"]').fill('1300');
  await sheet(page).locator('[data-act="save"]').click();
  await page.waitForTimeout(400);
  assert.equal(await page.textContent('[data-testid="lawn-area"]'), '7,550 sq ft');

  // Head type fills its precipitation default; zone labels toggle.
  await page.click('[data-action="zone"][data-id="z1"]');
  await guard(page);
  await sheet(page).locator('[data-seg="head"] [data-value="rotary"]').click();
  assert.equal(await sheet(page).locator('[data-zfield="precip"]').inputValue(), '0.4');
  await sheet(page).locator('[data-seg="head"] [data-value="spray"]').click();
  assert.equal(await sheet(page).locator('[data-zfield="precip"]').inputValue(), '1.5');
  const zp = sheet(page).locator('[data-prov="zone:gpm"]');
  assert.equal(await zp.textContent(), 'Estimated');
  await zp.click();
  assert.equal(await sheet(page).locator('[data-prov="zone:gpm"]').textContent(), 'Measured');
  await sheet(page).locator('[data-act="save"]').click();
  await page.waitForTimeout(400);
  const z1 = (await idb(page, 'zones')).find((z) => z.id === 'z1');
  assert.equal(z1.head, 'spray');
  assert.equal(z1.precip, 1.5);
  assert.equal(z1.gpm, 20.3); // estimated GPM follows 1,300 sq ft at 1.5 in/hr
  assert.equal(z1.src.gpm, 'meas');

  // Settings label toggles and persists.
  const lat = '[data-prov="settings:location.lat"]';
  assert.equal(await page.textContent(lat), 'Measured');
  await page.click(lat);
  await page.waitForTimeout(200);
  assert.equal(await page.textContent(lat), 'Estimated');
  await page.reload();
  await page.waitForSelector(lat);
  assert.equal(await page.textContent(lat), 'Estimated');

  // Add a non-lawn drip zone: counts for water, not lawn area. Then delete it.
  await page.click('[data-action="add-zone"]');
  await guard(page);
  await sheet(page).locator('[data-zfield="name"]').fill('Front Beds');
  await sheet(page).locator('[data-switch="lawn"]').uncheck();
  assert.equal(await sheet(page).locator('[data-seg="head"] .on').textContent(), 'Drip');
  await sheet(page).locator('[data-zfield="gpm"]').fill('2');
  await sheet(page).locator('[data-zfield="weeklyMinutes"]').fill('60');
  await sheet(page).locator('[data-act="save"]').click();
  await page.waitForTimeout(400);
  assert.match(await page.textContent('[data-testid="zones"]'), /Front Beds\s*non-lawn/);
  assert.equal(await page.textContent('[data-testid="lawn-area"]'), '7,550 sq ft');
  const beds = (await idb(page, 'zones')).find((z) => z.name === 'Front Beds');
  await page.click(`[data-action="zone"][data-id="${beds.id}"]`);
  await guard(page);
  await sheet(page).locator('[data-act="delete"]').click();
  await page.click('.dialog [data-v="1"]');
  await page.waitForTimeout(400);
  assert.equal(await page.locator('[data-testid="zones"] [data-action="zone"]').count(), 6);

  // Mower height edit flows into the recommendation.
  await page.fill('[data-setting="mower.heights.4"]', '3.25');
  await page.press('[data-setting="mower.heights.4"]', 'Enter');
  await page.waitForTimeout(300);
  await tab(page, 'today');
  assert.equal(await page.textContent('[data-testid="mow-height"]'), '3.25″');
  await tab(page, 'yard');

  // Preferred days.
  await page.click('[data-action="toggle-day"][data-day="6"]');
  await page.waitForTimeout(200);
  const settings = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('lawncare');
    r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => res(q.result); };
  }));
  assert.deepEqual(settings.mowing.preferredDays, [0]);
  assert.equal(settings.mower.heights[4], 3.25);

  // Water: auto tier, sewer toggle, billing period, tiers add/remove.
  const rate = '[data-testid="irrigation-rate"]';
  assert.equal(await page.textContent(rate), '$6.02/1,000 gal');
  await page.locator('[data-switch="water.sewerWinter"]').uncheck();
  await page.waitForSelector('[data-setting="water.sewerRate"]');
  assert.equal(await page.textContent(rate), '$12.02/1,000 gal');
  await page.click('[data-seg="water.billing"] [data-value="quarterly"]');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent(rate), '$15.05/1,000 gal');
  await page.locator('[data-switch="water.sewerWinter"]').check();
  await page.waitForTimeout(200);
  await page.click('[data-seg="water.rateMode"] [data-value="1"]');
  await page.waitForTimeout(200);
  assert.equal(await page.textContent(rate), '$4.63/1,000 gal');
  await page.click('[data-action="add-tier"]');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.tier-row').count(), 5);
  await page.click('[data-action="remove-tier"][data-i="4"]');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.tier-row').count(), 4);
  await page.fill('[data-tier="0"][data-field="rate"]', '4.00');
  await page.press('[data-tier="0"][data-field="rate"]', 'Enter');
  await page.waitForTimeout(200);
  assert.equal(await page.inputValue('[data-tier="0"][data-field="rate"]'), '4');
  assert.deepEqual(errors, []);
  await context.close();
});

test('mow notes tune growth, photos attach, plan shows products and checklist', async () => {
  const { page, errors, context } = await open();
  await openLog(page, 'Mow');
  await sheet(page).locator('[data-act="details"]').click();
  await sheet(page).locator('[data-field="notes"]').fill('Grass was long');
  await sheet(page).locator('[data-field="photo"]').setInputFiles(join(ROOT, 'icons/icon-192.png'));
  await sheet(page).locator('.photo-thumb').waitFor();
  await hold(page, 1150);
  await page.waitForSelector('.log-sheet', { state: 'detached' });
  assert.equal((await idb(page, 'photos')).length, 1);
  assert.match(await page.textContent('.mow-card'), /Growth model tuned by 1 of your mow notes \(\+10%\)/);
  await tab(page, 'history');
  assert.equal(await page.locator('.log-row .inline-ic').count(), 1);
  await page.click('.log-row');
  await page.waitForSelector('.log-sheet .photo-thumb');
  await guard(page);
  await sheet(page).locator('.sheet-cancel').click();
  await page.waitForTimeout(400);

  await tab(page, 'plan');
  const early = page.locator('.task:has-text("Early-fall feeding")').first();
  const text = await early.textContent();
  assert.match(text, /Lesco 24.0.11/);
  assert.match(text, /Elite 5\.5/);
  assert.match(text, /31\.3 lb/);
  assert.match(text, /Late/);
  assert.match(await page.textContent('.task:has-text("Fall broadleaf weed control")'), /No weed control product yet/);
  assert.equal(await page.locator('[data-testid="fall-checklist"] .check-row').count(), 5);
  await page.click('[data-action="check"][data-id="battery"]');
  await page.waitForTimeout(200);
  assert.equal(await page.getAttribute('[data-action="check"][data-id="battery"]', 'aria-checked'), 'true');
  await page.reload();
  await page.waitForSelector('[data-action="check"][data-id="battery"]');
  assert.equal(await page.getAttribute('[data-action="check"][data-id="battery"]', 'aria-checked'), 'true');

  await early.locator('.task-btn').click();
  await page.waitForSelector('.task-sheet');
  await guard(page);
  assert.ok(await sheet(page).locator('.rating').count() >= 5);
  assert.match(await sheet(page).textContent(), /Needed for 7,500 sq ft\s*31\.3 lb/);
  await sheet(page).locator('[data-act="log"]').click();
  await page.waitForSelector('.log-fert');
  assert.match(await sheet(page).locator('.choice.on').textContent(), /Lesco/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('backup: export JSON, reset, import restores', async () => {
  const { page, errors, context } = await open();
  await openLog(page, 'Mow');
  await hold(page, 1150);
  await page.waitForSelector('.log-sheet', { state: 'detached' });
  await tab(page, 'yard');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="export"]')]);
  assert.match(download.suggestedFilename(), /^lawn-care-backup-2026-10-02\.json$/);
  const dir = await mkdtemp(join(tmpdir(), 'lawn-'));
  const file = join(dir, 'backup.json');
  await download.saveAs(file);
  const data = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(data.app, 'lawn-care-pwa');
  assert.equal(data.logs.length, 1);
  assert.equal(data.zones.length, 6);
  assert.equal(data.products.length, 2);

  await page.click('[data-action="reset"]');
  await page.click('.dialog [data-v="1"]');
  await page.waitForSelector('.toast:has-text("All data reset")');
  assert.equal((await idb(page, 'logs')).length, 0);

  const bad = join(dir, 'bad.json');
  await writeFile(bad, '{"hello": 1}');
  await page.setInputFiles('[data-import]', bad);
  await page.waitForSelector('.toast:has-text("isn’t a Lawn Care backup")');

  await page.setInputFiles('[data-import]', file);
  await page.waitForSelector('.dialog:has-text("Replace all data")');
  await page.click('.dialog [data-v="1"]');
  await page.waitForSelector('.toast:has-text("Backup restored")');
  assert.equal((await idb(page, 'logs')).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('spring: soil temperature alert for crabgrass pre-emergent', async () => {
  const { page, errors, context } = await open({
    time: '2027-04-22T09:00:00-05:00', today: '2027-04-22', day: () => ({ tMax: 64, tMin: 42, soil: 52 }),
  });
  await page.waitForSelector('.alert:has-text("Soil 52°F and rising toward 55°F")');
  await tab(page, 'plan');
  const pre = await page.textContent('.task:has-text("Crabgrass pre-emergent")');
  assert.match(pre, /Now/);
  assert.match(pre, /No pre-emergent product yet/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('dark mode follows the phone and can be overridden', async () => {
  const { page, errors, context } = await open({ colorScheme: 'dark', path: '#yard' });
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await bg(), 'rgb(0, 0, 0)');
  await page.click('[data-seg="appearance.theme"] [data-value="light"]');
  await page.waitForTimeout(200);
  assert.equal(await bg(), 'rgb(242, 242, 247)');
  assert.deepEqual(errors, []);
  await context.close();
});

test('offline: service worker caches the app and it reopens without network', async () => {
  const { page, context } = await open({ sw: 'allow' });
  await page.waitForSelector('[data-testid="weather"]');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await context.unroute('https://api.open-meteo.com/**');
  await context.route('https://api.open-meteo.com/**', (r) => r.abort('internetdisconnected'));
  await page.reload();
  await page.waitForSelector('.mow-card');
  await page.waitForSelector('[data-testid="weather"]');
  assert.match(await page.textContent('[data-testid="soil24"]'), /°F/);
  await tab(page, 'yard');
  await page.waitForSelector('[data-testid="zones"]');
  await openLog(page, 'Mow');
  await hold(page, 1150);
  await page.waitForSelector('.toast:has-text("Mow logged")');
  assert.equal((await idb(page, 'logs')).length, 1);
  await context.close();
});

test('manifest, icons and service worker asset list', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) {
    const png = await readFile(join(ROOT, icon.src));
    const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
    assert.equal(`${w}x${h}`, icon.sizes);
  }
  const touch = await readFile(join(ROOT, 'icons/apple-touch-icon.png'));
  assert.equal(touch.readUInt32BE(16), 180);
  const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|css|png|html|webmanifest))'/g)].map((m) => m[1]));
  const files = [];
  for (const dir of ['js', 'js/views', 'css', 'icons']) {
    for (const f of await readdir(join(ROOT, dir), { withFileTypes: true })) if (f.isFile()) files.push(`${dir}/${f.name}`);
  }
  for (const f of [...files, 'index.html', 'manifest.webmanifest']) assert.ok(listed.has(f), `sw.js is missing ${f}`);
});
