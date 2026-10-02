// End-to-end tests in Chromium at iPhone size (390×844) with mocked Open-Meteo weather.
// Run: node --test tests/e2e.test.mjs   (needs Playwright; uses a global install if it isn't in node_modules)
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

// Default scenario: Friday Oct 2, 2026, 9 AM; 0.4″ of rain yesterday; hard freeze in 6 days.
const fallDay = (d, i) => (i === -1 ? { rain: 0.4, prob: 80, tMax: 61, tMin: 40, soil: 57 } : i === 6 ? { tMin: 27, tMax: 44 } : { tMax: 61, tMin: 40, soil: 57 });

async function open({
  time = '2026-10-02T09:00:00-05:00', today = '2026-10-02', day = fallDay, colorScheme = 'light', sw = 'block', path = '', seed = null, setup = null,
} = {}) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
    timezoneId: 'America/Chicago', locale: 'en-US', colorScheme, serviceWorkers: sw, acceptDownloads: true,
  });
  await context.clock.install({ time: new Date(time) });
  await context.route('https://api.open-meteo.com/**', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(mockForecast({ today, day })),
  }));
  if (setup) await setup(context);
  const page = await context.newPage();
  await page.clock.resume();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  if (seed) {
    await page.goto(`${base}tests/blank.html`);
    await page.evaluate(seed);
  }
  await page.goto(base + path);
  await page.waitForSelector('.view.active .page-head, .view.active .hero');
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
const settingsOf = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('lawncare');
  r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').get('settings'); q.onsuccess = () => { res(q.result); r.result.close(); }; };
}));
const product = async (page, id) => (await idb(page, 'products')).find((p) => p.id === id);
const sheet = (page) => page.locator('.sheet-wrap:last-child');
const guard = (page) => page.waitForTimeout(650);
const tab = async (page, name) => { await page.click(`.tab[data-tab="${name}"]`); await page.waitForTimeout(150); };
// Waits out the half-second tap guard first: a sheet ignores taps right after it opens.
const closeSheet = async (page) => { await guard(page); await sheet(page).locator('.sheet-cancel').click(); await page.waitForTimeout(400); };

async function openLog(page, label) {
  await page.click('#fab');
  await page.waitForSelector('.log-menu');
  await guard(page);
  await page.click(`.log-choice:has(.log-choice-label:text-is("${label}"))`);
  await page.waitForSelector('.log-sheet');
  await guard(page);
}

async function hold(page, ms, scope = '.sheet-wrap:last-child .hold-btn') {
  await page.locator(scope).scrollIntoViewIfNeeded();
  const box = await page.locator(scope).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}
async function save(page, toast) {
  await hold(page, 1150);
  await page.waitForSelector(`.toast:has-text("${toast}")`);
  await page.waitForSelector('.log-sheet', { state: 'detached' });
}

async function overflow(page, scope) {
  return page.evaluate((sel) => {
    const w = window.innerWidth;
    const bad = [];
    for (const el of document.querySelectorAll(`${sel} *`)) {
      if (el.closest('.hero-img')) continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height && (r.right > w + 0.5 || r.left < -0.5)) bad.push(`${el.tagName}.${el.className?.baseVal ?? el.className}`);
    }
    if (document.documentElement.scrollWidth > w) bad.push(`scrollWidth ${document.documentElement.scrollWidth}`);
    return bad;
  }, scope);
}

test('Today: header, next mow, sections, watering and conditions, forecast, shopping — fits 390px', async () => {
  const { page, errors, context } = await open();
  await page.waitForSelector('[data-testid="conditions"]');
  assert.equal(await page.textContent('[data-testid="greeting"]'), 'Good morning, Jake');
  assert.match(await page.textContent('[data-testid="summary"]'), /^3\.15″ target height · 57°F soil · 0\.4″ rain \(7d\)$/);
  assert.match(await page.textContent('[data-testid="feed-line"]'), /Feeding window open now · WinterGuard/);
  assert.equal(await page.textContent('[data-testid="mow-pos"]'), '5');
  assert.equal(await page.textContent('[data-testid="mow-height"]'), '3.15″');
  // Stripe icon, no text label; long-press reveals the description.
  assert.equal((await page.textContent('[data-testid="pattern"]')).trim(), '');
  const pb = await page.locator('[data-testid="pattern"]').boundingBox();
  await page.mouse.move(pb.x + 20, pb.y + 20);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.up();
  assert.match(await page.textContent('.popover'), /Front yard: stripes parallel to the street\. Side Left and Side Right: always mow across the slope\./);
  // Today section: feeding, pulling weeds after rain, aeration as Optional (never Do today).
  const todayText = await page.textContent('[data-testid="today-section"]');
  assert.match(todayText, /\d things worth doing/);
  assert.match(todayText, /Fall feeding/);
  assert.match(todayText, /Pull weeds/);
  const aer = page.locator('[data-testid="today-section"] .task-row[data-id="aerate"]');
  assert.equal(await aer.locator('.badge').textContent(), 'Optional');
  assert.match(await aer.textContent(), /good week to aerate.*fertilizer reach the roots/);
  assert.equal(await page.locator('.task-row[data-id="aerate"] .badge-today').count(), 0);
  assert.equal(await page.locator('[data-testid="today-section"] .task-row[data-id="mow"]').count(), 0);
  // No lawn score, no "looking great" text, no separate tomorrow mow card.
  assert.doesNotMatch(await page.textContent('#view-today'), /looking great|\/ ?100|Lawn status/i);
  // This Week: rain behind and ahead, ET, soil now, the watering call, and the soil-timed fall feeding.
  assert.equal(await page.getAttribute('[data-testid="water-advice"]', 'data-status'), 'skip');
  assert.equal(await page.textContent('[data-testid="water-advice"]'), 'Skip watering');
  assert.equal(await page.textContent('[data-testid="week-rain"]'), '0.4″');
  assert.equal(await page.textContent('[data-testid="week-ahead"]'), '0″');
  assert.equal(await page.textContent('[data-testid="week-et"]'), '0.59″');
  assert.equal(await page.textContent('[data-testid="week-soil"]'), '57°F');
  assert.match(await page.textContent('[data-testid="water-reason"]'), /used 0\.59″ and got 0\.4″ this week — only 0\.19″ short/);
  const alert = page.locator('[data-testid="soil-alerts"] .sa-row[data-alert="fall-feed"]');
  assert.match(await alert.textContent(), /Fall feeding.*Soil is 57°F.*forecast around Oct 8.*Feed now/s);
  await alert.click();
  await page.waitForSelector('.task-sheet');
  assert.match(await sheet(page).textContent(), /Fall feeding.*never spread on frozen ground/is);
  await closeSheet(page);
  // Watering: rain from weather + logged watering, Rachio note.
  assert.equal(await page.textContent('[data-testid="water-total"]'), '0.4″');
  assert.match(await page.textContent('[data-testid="water"]'), /Rain 0\.4″ · Logged 0″.*0 gal · \$0\.00.*Rachio not connected yet/s);
  // Shopping list before the open WinterGuard window.
  assert.match(await page.textContent('[data-testid="shopping"]'), /Buy 2 × 12\.5 lb bags of WinterGuard — about 6 lb left over/);
  // Up next: blowout ahead of the hard freeze.
  assert.match(await page.textContent('[data-testid="upnext-section"]'), /Blowout.*Hard freeze/s);
  for (const t of ['today', 'calendar', 'history', 'yard']) {
    await tab(page, t);
    assert.deepEqual(await overflow(page, '.view.active'), [], `overflow on ${t}`);
  }
  assert.deepEqual(errors, []);
  await context.close();
});

test('This Week: hold off for rain in July, and a retry card when the weather service is down', async () => {
  let { page, errors, context } = await open({
    time: '2026-07-15T09:00:00-05:00', today: '2026-07-15', day: (d, i) => (i === 2 ? { rain: 0.9, prob: 85, tMax: 80, tMin: 64, et0: 0.2 } : { tMax: 86, tMin: 66, et0: 0.2 }),
  });
  await page.waitForSelector('[data-testid="water-advice"]');
  assert.equal(await page.getAttribute('[data-testid="water-advice"]', 'data-status'), 'hold');
  assert.equal(await page.textContent('[data-testid="water-advice"]'), 'Hold off for rain');
  assert.equal(await page.textContent('[data-testid="week-ahead"]'), '0.9″');
  assert.match(await page.textContent('[data-testid="this-week"]'), /next 3 days · 85%/);
  assert.match(await page.textContent('[data-testid="water-reason"]'), /0\.99″ short, but 0\.9″ of rain is forecast, mostly Friday \(85% chance\)/);
  assert.equal(await page.locator('[data-testid="soil-alerts"]').count(), 0);
  assert.deepEqual(await overflow(page, '.view.active'), []);
  assert.deepEqual(errors, []);
  await context.close();

  const down = (ctx) => ctx.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 503, body: 'down' }));
  ({ page, errors, context } = await open({ setup: down }));
  await page.locator('[data-testid="this-week"]').getByText('Weather unavailable — tap to retry').waitFor();
  assert.deepEqual(errors.filter((e) => !/503/.test(e)), []);
  await context.close();
});

test('forecast day sheet: hourly details, frost risk, lawn verdicts', async () => {
  const { page, errors, context } = await open();
  await page.waitForSelector('[data-testid="weather"]');
  await page.click('[data-testid="weather"] .fc-day >> nth=6');
  await page.waitForSelector('.day-sheet');
  await guard(page);
  const txt = await sheet(page).textContent();
  assert.match(txt, /Rain/);
  assert.match(txt, /Wind/);
  assert.match(txt, /Humidity/);
  assert.match(txt, /Soil temp/);
  assert.match(txt, /Hard freeze \(27°F\)/);
  assert.equal(await sheet(page).locator('.verdict').count(), 4);
  assert.equal(await sheet(page).locator('.hr-row:not(.hr-head)').count(), 8);
  assert.equal(await sheet(page).locator('.chart').count(), 2);
  await sheet(page).locator('.chart').first().scrollIntoViewIfNeeded();
  const svg = await sheet(page).locator('.chart svg').first().boundingBox();
  await page.mouse.click(svg.x + svg.width * 0.6, svg.y + svg.height / 2);
  assert.match(await sheet(page).locator('.chart-tip').first().textContent(), /°/);
  assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), []);
  await closeSheet(page);
  // Today's conditions card opens today's sheet with a pulling-weeds verdict after yesterday's rain.
  await page.click('[data-testid="conditions"]');
  await page.waitForSelector('.day-sheet');
  assert.match(await sheet(page).locator('.verdict:has-text("Pulling weeds")').textContent(), /Good for pulling weeds/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('quick log: six choices, tap guard, hold-to-save, duplicate warning, undo, stripes rotate', async () => {
  const { page, errors, context } = await open();
  await page.click('#fab');
  await page.waitForSelector('.log-menu');
  assert.deepEqual(await page.locator('.log-choice-label').allTextContents(), ['Mow', 'Fertilize', 'Spot spray', 'Pulled weeds', 'Watering', 'Other']);
  await guard(page);
  await page.click('.log-choice:has(.log-choice-label:text-is("Mow"))');
  await page.waitForSelector('.log-sheet');
  await page.evaluate(() => document.querySelector('.sheet-wrap:last-child [data-act="date"]:not(.on)').click());
  await guard(page);
  assert.equal(await sheet(page).locator('[data-act="date"].on').textContent(), 'Today');
  assert.equal(await sheet(page).locator('[data-act="zone"].on').count(), 6);
  assert.equal(await sheet(page).locator('.pos.on .pos-n').textContent(), '5');
  assert.equal(await sheet(page).locator('.pattern-opt.on').getAttribute('data-pattern'), '0');
  // Any past date can be backfilled.
  await sheet(page).locator('[data-field="date"]').fill('2026-05-03');
  assert.match(await sheet(page).locator('.chip-date.on').textContent(), /Sun, May 3/);
  await sheet(page).locator('[data-act="date"]:has-text("Today")').click();
  await hold(page, 400);
  await page.waitForTimeout(300);
  assert.equal(await sheet(page).locator('.hold-btn.done').count(), 0);
  assert.match(await sheet(page).locator('.hold-hint').textContent(), /Keep holding/);
  assert.equal((await idb(page, 'logs')).length, 0);
  await save(page, 'Mow logged');
  const [m] = await idb(page, 'logs');
  assert.equal(m.pattern, 0);
  assert.equal(m.height, 3.15);
  assert.equal(await page.getAttribute('[data-testid="pattern"]', 'data-pattern'), '1');
  await openLog(page, 'Mow');
  assert.match(await sheet(page).locator('.banner-warn').textContent(), /Already logged today/);
  assert.match(await sheet(page).locator('.hold-hint').textContent(), /save anyway/);
  assert.equal(await sheet(page).locator('.pattern-opt.on').getAttribute('data-pattern'), '1');
  await closeSheet(page);
  await openLog(page, 'Other');
  assert.equal(await sheet(page).locator('[data-kind="sharpen"]').count(), 0);
  await sheet(page).locator('[data-act="kind"][data-kind="spreader"]').click();
  await save(page, 'Activity logged');
  assert.equal((await idb(page, 'logs')).length, 2);
  await page.click('.toast-undo');
  await page.waitForTimeout(300);
  assert.equal((await idb(page, 'logs')).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('feeding: inventory, shopping list, timers, nitrogen and checklist update; edit/delete reverse', async () => {
  const { page, errors, context } = await open();
  await tab(page, 'yard');
  await page.click('.view.active [data-action="yard-section"][data-id="products"]');
  await guard(page);
  await sheet(page).locator('[data-action="product"][data-id="p-scotts-winterguard"]').click();
  await guard(page);
  await sheet(page).locator('[data-act="bag"][data-n="1"]').click();
  await sheet(page).locator('[data-act="save"]').click();
  await page.waitForTimeout(400);
  assert.equal((await product(page, 'p-scotts-winterguard')).onHand, 12.5);
  await closeSheet(page);
  await tab(page, 'today');
  assert.match(await page.textContent('[data-testid="shopping"]'), /Buy 1 bag of WinterGuard \(12\.5 lb\) — about 6 lb left over/);

  await openLog(page, 'Fertilize');
  assert.match(await sheet(page).locator('.choice.on .choice-title').textContent(), /WinterGuard/);
  assert.equal(await sheet(page).locator('[data-field="amount"]').inputValue(), '18.75');
  assert.equal(await sheet(page).locator('.calc-big').textContent(), '2.75');
  await save(page, 'Feeding logged');
  assert.equal((await product(page, 'p-scotts-winterguard')).onHand, 0);
  const [log] = await idb(page, 'logs');
  assert.equal(log.effects.deducted, 12.5);
  assert.equal(log.effects.nLbs, 6);
  assert.match(await page.textContent('.timer-keepOff'), /Keep kids and pets off until 1:0\d PM/);
  assert.match(await page.textContent('[data-testid="feed-line"]'), /Next feeding: Halts, next spring/);
  await tab(page, 'calendar');
  assert.equal(await page.getAttribute('[data-action="check"][data-id="fall-fert"]', 'aria-checked'), 'true');
  await tab(page, 'history');
  assert.equal(await page.textContent('[data-testid="total-n"]'), '0.8');

  await page.click('.log-row');
  await page.waitForSelector('.log-sheet');
  await guard(page);
  await sheet(page).locator('[data-act="zone"]:has-text("Back Left")').click();
  await sheet(page).locator('[data-act="zone"]:has-text("Back Right")').click();
  assert.equal(await sheet(page).locator('[data-field="amount"]').inputValue(), '10.25');
  await save(page, 'Changes saved');
  assert.equal((await product(page, 'p-scotts-winterguard')).onHand, 2.25);
  await page.click('.log-row');
  await page.waitForSelector('.log-sheet');
  await guard(page);
  await sheet(page).locator('[data-act="delete"]').click();
  await page.click('.dialog [data-v="1"]');
  await page.waitForSelector('.toast:has-text("Entry deleted")');
  assert.equal((await product(page, 'p-scotts-winterguard')).onHand, 12.5);
  assert.equal(await page.textContent('[data-testid="total-n"]'), '0');
  await page.click('.toast-undo');
  await page.waitForTimeout(300);
  assert.equal((await idb(page, 'logs')).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('weeds and watering: spot spray with mix rate, pulled weeds, manual watering totals', async () => {
  const { page, errors, context } = await open();
  await openLog(page, 'Spot spray');
  assert.match(await sheet(page).locator('.choice.on .choice-title').textContent(), /Weed B Gon/);
  assert.equal(await sheet(page).locator('[data-seg="method"]').count(), 0);
  assert.match(await sheet(page).locator('.calc').textContent(), /2 fl oz \/ gal.*2 fl oz/s);
  await sheet(page).locator('[data-act="step"][data-field="gallons"][data-step="0.25"]').click();
  assert.match(await sheet(page).locator('[data-out="amt"]').textContent(), /2\.5 fl oz/);
  assert.match(await sheet(page).textContent(), /Spray check/);
  await save(page, 'Spot spray logged');
  const spray = (await idb(page, 'logs'))[0];
  assert.equal(spray.amount, 2.5);
  assert.equal(spray.gallons, 1.25);

  await openLog(page, 'Pulled weeds');
  await sheet(page).locator('[data-seg="howMuch"] [data-value="lots"]').click();
  await save(page, 'Weeding logged');
  assert.equal(await page.locator('[data-testid="today-section"] .task-row[data-id="pull-weeds"]').count(), 0);

  await openLog(page, 'Watering');
  assert.equal(await sheet(page).locator('[data-act="zone"].on').count(), 6);
  assert.match(await sheet(page).locator('.calc').textContent(), /0\.24″.*1,112 gal.*\$6\.69/s);
  await save(page, 'Watering logged');
  assert.equal(await page.textContent('[data-testid="water-total"]'), '0.64″');
  assert.match(await page.textContent('[data-testid="water"]'), /Logged 0\.24″.*1,112 gal · \$6\.69/s);
  await tab(page, 'history');
  await page.click('[data-seg="filter"] [data-value="weeds"]');
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.log-row').count(), 2);
  await page.click('[data-seg="filter"] [data-value="water"]');
  await page.waitForTimeout(200);
  assert.match(await page.textContent('.log-row'), /Watered · 20 min per zone/);
  assert.equal(await page.textContent('[data-testid="total-water"]'), '$6.69');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Yard: collapsed sections, numeric-only Estimated badges, zones, rates; settings behind the gear', async () => {
  const { page, errors, context } = await open({ path: '#yard' });
  assert.equal(await page.locator('[data-testid="yard-sections"] .sec-link').count(), 8);
  // Mower: model (text) has no badge; all 7 heights are Estimated.
  await page.click('.view.active [data-action="yard-section"][data-id="mower"]');
  await guard(page);
  const mower = sheet(page);
  assert.equal(await mower.locator('[data-prov^="settings:mower.heights."]').count(), 7);
  assert.equal(await mower.locator('[data-prov="settings:mower.model"]').count(), 0);
  assert.equal(await mower.locator('[data-testid="hours-total"]').count(), 1);
  assert.doesNotMatch(await mower.textContent(), /sharpen/i);
  // Tap the badge to trust a value; press-and-hold its name to mark it estimated again.
  await mower.locator('[data-prov="settings:mower.heights.4"]').click();
  await page.waitForTimeout(250);
  assert.equal(await mower.locator('[data-prov="settings:mower.heights.4"]').count(), 0);
  assert.equal((await settingsOf(page)).src['mower.heights.4'], 'meas');
  const lab = await mower.locator('[data-prov-key="settings:mower.heights.4"]').boundingBox();
  await page.mouse.move(lab.x + 10, lab.y + 5);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(250);
  assert.equal(await mower.locator('[data-prov="settings:mower.heights.4"]').count(), 1);
  await mower.locator('[data-setting="mower.heights.4"]').fill('3.25');
  await mower.locator('[data-setting="mower.heights.4"]').press('Enter');
  await page.waitForTimeout(250);
  await closeSheet(page);
  // Location: text fields have no badge; lat/lon are trusted (no badge).
  await page.click('.view.active [data-action="yard-section"][data-id="location"]');
  await guard(page);
  assert.equal(await sheet(page).locator('[data-prov]').count(), 0);
  await closeSheet(page);
  // Zones: edit area; head defaults; sloped zones; non-lawn zone.
  await page.click('.view.active [data-action="yard-section"][data-id="zones"]');
  await guard(page);
  await sheet(page).locator('[data-action="zone"][data-id="z1"]').click();
  await guard(page);
  assert.equal(await sheet(page).locator('[data-seg="slope"] ~ .prov, [data-prov="zone:slope"]').count(), 0);
  await sheet(page).locator('[data-zfield="sqft"]').fill('1300');
  await sheet(page).locator('[data-seg="head"] [data-value="rotary"]').click();
  assert.equal(await sheet(page).locator('[data-zfield="precip"]').inputValue(), '0.4');
  await sheet(page).locator('[data-act="save"]').click();
  await page.waitForTimeout(400);
  const z1 = (await idb(page, 'zones')).find((z) => z.id === 'z1');
  assert.equal(z1.sqft, 1300);
  assert.equal(z1.gpm, 5.4);
  assert.match(await sheet(page).textContent(), /Front Left\s*1,300 sq ft · Rotary nozzle/);
  await closeSheet(page);
  // Water rates detail.
  await page.click('.view.active [data-action="yard-section"][data-id="water"]');
  await guard(page);
  await sheet(page).locator('[data-switch="water.sewerWinter"]').uncheck();
  await page.waitForTimeout(250);
  assert.match(await sheet(page).locator('[data-testid="irrigation-rate"]').textContent(), /\$12\.02/);
  await sheet(page).locator('[data-switch="water.sewerWinter"]').check();
  await closeSheet(page);
  // Today reflects the edited height.
  await tab(page, 'today');
  assert.equal(await page.textContent('[data-testid="mow-height"]'), '3.25″');
  // Gear: name, appearance, winter mode, backup, hold-to-reset.
  await page.click('.hero [data-action="settings"]');
  await guard(page);
  const st = sheet(page);
  for (const want of ['Your name', 'Header photo', 'Theme', 'Winter Mode', 'Export JSON backup', 'Import JSON backup', 'Hold to reset all data']) {
    assert.match(await st.textContent(), new RegExp(want));
  }
  await st.locator('[data-setting="profile.name"]').fill('Jacob');
  await st.locator('[data-setting="profile.name"]').press('Enter');
  await page.waitForTimeout(250);
  await st.locator('[data-header-photo]').setInputFiles(join(ROOT, 'icons/app-icon-512.png'));
  await page.waitForSelector('.toast:has-text("Header photo updated")');
  await closeSheet(page);
  assert.equal(await page.textContent('[data-testid="greeting"]'), 'Good morning, Jacob');
  assert.match(await page.getAttribute('.hero-img', 'style'), /data:image\/jpeg/);
  assert.deepEqual(errors, []);
  await context.close();
});

test('reset all data requires press-and-hold', async () => {
  const { page, errors, context } = await open({ path: '#yard' });
  await openLog(page, 'Pulled weeds');
  await save(page, 'Weeding logged');
  await page.click('.view.active [data-action="settings"]');
  await guard(page);
  await hold(page, 400, '.settings-sheet .hold-btn');
  await page.waitForTimeout(300);
  assert.equal((await idb(page, 'logs')).length, 1);
  await hold(page, 1150, '.settings-sheet .hold-btn');
  await page.waitForSelector('.toast:has-text("All data reset")');
  assert.equal((await idb(page, 'logs')).length, 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('Calendar: Scotts feedings with Elite settings, past hidden behind Show past, checklist', async () => {
  const { page, errors, context } = await open({ path: '#calendar' });
  const fall = await page.textContent('[data-testid="feed-feed-late-fall"]');
  assert.match(fall, /Fall feeding/);
  assert.match(fall, /Open now/);
  assert.match(fall, /WinterGuard · Elite 2\.75 · 18\.8 lb for 7,500 sq ft/);
  assert.match(fall, /early fall window was missed/);
  assert.match(fall, /Buy 2 × 12\.5 lb bags of WinterGuard/);
  assert.doesNotMatch(await page.textContent('#view-calendar'), /Lesco/);
  assert.equal(await page.locator('[data-testid="feed-feed-early-fall"]').count(), 0);
  assert.equal(await page.locator('[data-testid="feed-feed-spring"]').count(), 0);
  await page.locator('[data-switch="calendar.showPast"]').check();
  await page.waitForTimeout(300);
  assert.match(await page.textContent('[data-testid="feed-feed-early-fall"]'), /Missed/);
  assert.match(await page.textContent('[data-testid="feed-feed-spring"]'), /Halts/);
  await page.locator('[data-switch="calendar.showPast"]').uncheck();
  await page.waitForTimeout(300);
  await page.click('[data-action="feeding"][data-id="feed-late-fall"]');
  await page.waitForSelector('.task-sheet');
  await guard(page);
  assert.ok(await sheet(page).locator('.rating').count() >= 3);
  await sheet(page).locator('[data-act="log"]').click();
  await page.waitForSelector('.log-fert');
  assert.match(await sheet(page).locator('.choice.on').textContent(), /WinterGuard/);
  await closeSheet(page);
  await page.click('.view.active [data-action="check-log"][data-id="blowout"]');
  await page.waitForSelector('.log-other');
  await guard(page);
  await save(page, 'Activity logged');
  assert.equal(await page.getAttribute('[data-action="check"][data-id="blowout"]', 'aria-checked'), 'true');
  assert.deepEqual(errors, []);
  await context.close();
});

test('Winter Mode: suggested after wrap-up, winter screen, + Log still works, turns off', async () => {
  const { page, errors, context } = await open({ time: '2026-11-03T09:00:00-06:00', today: '2026-11-03', day: (d, i) => ({ tMax: 38, tMin: 30, soil: 36 + i * 0.1, depthFt: 0.25, snow: i === 0 ? 0.6 : 0 }) });
  // Lows stay above 28°F (no hard freeze), so only the wrap-up logs should bring up the suggestion.
  await page.waitForSelector('.view.active [data-testid="weather"]');
  assert.match(await page.textContent('.view.active [data-testid="soil24"]'), /36°/);
  assert.equal(await page.locator('[data-testid="winter-prompt"]').count(), 0);
  await openLog(page, 'Mow');
  await sheet(page).locator('[data-field="final"]').check();
  await save(page, 'Mow logged');
  await openLog(page, 'Other');
  await sheet(page).locator('[data-act="kind"][data-kind="blowout"]').click();
  await save(page, 'Activity logged');
  await page.waitForSelector('[data-testid="winter-prompt"]');
  await page.click('[data-testid="winter-prompt"] [data-action="winter-on"]');
  await page.waitForSelector('[data-testid="winter-conditions"]');
  assert.equal(await page.getAttribute('[data-testid="winter-toggle"]', 'aria-pressed'), 'true');
  assert.equal(await page.textContent('[data-testid="snow-depth"]'), '3″');
  assert.match(await page.textContent('[data-testid="soil-card"]'), /36°F/);
  assert.equal(await page.locator('#soil-trend').count(), 1);
  assert.match(await page.textContent('[data-testid="countdown"]'), /\d+ days/);
  assert.match(await page.textContent('[data-testid="spring-shopping"]'), /Halts.*Lawn Food/s);
  const wl = await page.textContent('[data-testid="winter-checklist"]');
  assert.match(wl, /EGO battery stored indoors.*Spreader cleaned.*Fertilizer bags stored dry.*Fall fertilizer feeding/s);
  assert.match(await page.textContent('.tips-card'), /salt and ice melt.*salty snow.*frozen.*sprinkler heads near the driveway/s);
  assert.match(await page.textContent('[data-testid="recap"]'), /2026 season recap.*1\s*Mows/s);
  assert.deepEqual(await overflow(page, '.view.active'), []);
  await openLog(page, 'Other');
  await sheet(page).locator('[data-act="kind"][data-kind="battery"]').click();
  await save(page, 'Activity logged');
  assert.equal(await page.getAttribute('[data-testid="winter-checklist"] [data-id="battery"].check-box', 'aria-checked'), 'true');
  await page.click('[data-testid="winter-toggle"]');
  await page.waitForSelector('[data-testid="mow-card"]');
  assert.equal(await page.locator('[data-testid="winter-prompt"]').count(), 0); // already accepted once this season
  assert.deepEqual(errors, []);
  await context.close();
});

test('spring: soil-triggered crabgrass preventer, spring alert, and a prompt to leave Winter Mode', async () => {
  const { page, errors, context } = await open({ time: '2027-04-21T09:00:00-05:00', today: '2027-04-21', day: (d, i) => ({ tMax: 64, tMin: 42, soil: 51 + i * 0.3 }) });
  assert.match(await page.textContent('[data-testid="feed-line"]'), /Feeding window open now · Halts/);
  assert.match(await page.textContent('#view-today'), /Crabgrass preventer \+ feeding/);
  assert.match(await page.textContent('[data-testid="soil-alerts"]'), /Crabgrass preventer.*Soil is 51°F and warming toward 55°F.*Apply now/s);
  await page.click('[data-testid="winter-toggle"]');
  await page.waitForSelector('[data-testid="winter-prompt"]');
  assert.match(await page.textContent('[data-testid="winter-prompt"]'), /turn off Winter Mode/);
  assert.match(await page.textContent('[data-testid="countdown"]'), /Now/);
  await page.click('[data-testid="winter-prompt"] [data-action="dismiss-prompt"]');
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-testid="winter-prompt"]').count(), 0);
  assert.deepEqual(errors, []);
  await context.close();
});

test('migration: v1 data survives the upgrade', async () => {
  const seed = () => new Promise((res, rej) => {
    const r = indexedDB.open('lawncare', 1);
    r.onupgradeneeded = () => ['kv', 'zones', 'products', 'logs', 'photos'].forEach((n) => r.result.createObjectStore(n, n === 'kv' ? undefined : { keyPath: 'id' }));
    r.onsuccess = () => {
      const t = r.result.transaction(['kv', 'zones', 'products', 'logs'], 'readwrite');
      t.objectStore('kv').put({
        schema: 1,
        location: { name: 'Prior Lake, MN', lat: 44.71, lon: -93.42, grass: 'Kentucky bluegrass', lot: 'Walkout', surveyArea: 8685, notes: '' },
        mower: { model: 'EGO 21″ self-propelled', heights: [1.5, 1.9, 2.3, 2.75, 3.15, 3.6, 4.0], mowHours: 0.9, sharpenEvery: 25, sinceSharpenAtStart: 4, hoursBefore: 12 },
        spreader: { model: 'Scotts Elite' },
        clippings: 'bag',
        water: { tiers: [{ upTo: 10000, rate: 3.86 }, { upTo: 20000, rate: 4.63 }, { upTo: 30000, rate: 6.02 }, { upTo: null, rate: 9.05 }], sewerWinter: true, sewerRate: 6, billing: 'quarterly', baseUsage: 15000, summerInches: 0.75, rateMode: 'auto' },
        mowing: { cadenceDays: 7, preferredDays: [6, 0] },
        nitrogen: { seasonTarget: 3 },
        appearance: { theme: 'system' },
        planProducts: { 'fert-early-fall': 'p-lesco-24-0-11' },
        planChecks: { 2026: { battery: true } },
        src: { 'mower.heights.0': 'meas', 'mower.heights.4': 'meas', 'mower.model': 'meas', 'location.lat': 'meas', 'location.lon': 'meas', 'location.surveyArea': 'meas' },
      }, 'settings');
      [['z1', 'Front Left', 1250], ['z2', 'Front Right', 1250], ['z3', 'Side Left', 800], ['z4', 'Side Right', 800], ['z5', 'Back Left', 1700], ['z6', 'Back Right', 1700]].forEach(([id, name, sqft], i) => t.objectStore('zones').put({ id, order: i + 1, name, sqft, lawn: true, slope: i === 2 || i === 3 ? 'moderate' : 'flat', sun: 'full', head: 'rotor', precip: 0.5, gpm: 6.5, weeklyMinutes: 0, src: { sqft: 'est', slope: 'est' } }));
      t.objectStore('products').put({ id: 'p-lesco-24-0-11', order: 1, name: 'Lesco 24-0-11', type: 'fertilizer', n: 24, p: 0, k: 11, unit: 'lb', size: 50, coverage: 12000, price: 50, elite: '5.5', keepOffHours: 4, noRainHours: 24, noMowDays: 1, onHand: 18.75, src: {} });
      t.objectStore('products').put({ id: 'p-scotts-32-0-4', order: 2, name: 'Scotts Turf Builder Lawn Food 32-0-4', type: 'fertilizer', n: 32, p: 0, k: 4, unit: 'lb', size: 12.5, coverage: 5000, price: 30, elite: '3.5', keepOffHours: 4, noRainHours: 24, noMowDays: 1, onHand: 0, src: {} });
      t.objectStore('logs').put({ id: 'l1', type: 'mow', date: '2026-09-27', at: Date.parse('2026-09-27T15:00:00Z'), zones: ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'], position: 5, height: 3.15, hours: 1, clippings: 'bag', notes: 'grass was long', effects: { deducted: 0, nLbs: 0, timers: [] } });
      t.objectStore('logs').put({ id: 'l2', type: 'other', kind: 'sharpen', title: 'Blade sharpened', date: '2026-09-20', at: Date.parse('2026-09-20T15:00:00Z'), zones: [], notes: '', effects: { deducted: 0, nLbs: 0, timers: [] } });
      t.oncomplete = () => { r.result.close(); res(); };
      t.onerror = () => rej(t.error);
    };
  });
  const { page, errors, context } = await open({ seed });
  const s = await settingsOf(page);
  assert.equal(s.schema, 2);
  assert.equal(s.clippings, 'bag');
  assert.equal(s.water.billing, 'quarterly');
  assert.equal(s.mower.mowHours, 0.9);
  assert.equal(s.mower.sharpenEvery, undefined);
  assert.equal(s.src['mower.heights.0'], 'est');
  assert.equal(s.src['mower.model'], undefined);
  assert.equal(s.planChecks[2026].battery, true);
  const products = await idb(page, 'products');
  assert.equal(products.find((p) => p.id === 'p-lesco-24-0-11').onHand, 18.75);
  assert.ok(products.find((p) => p.id === 'p-scotts-winterguard'));
  assert.ok(products.find((p) => p.id === 'p-ortho-wbg'));
  assert.equal((await idb(page, 'logs')).length, 2);
  assert.match(await page.textContent('[data-testid="feed-line"]'), /WinterGuard/);
  assert.equal(await page.getAttribute('[data-testid="pattern"]', 'data-pattern'), '1');
  await tab(page, 'history');
  assert.match(await page.textContent('#view-history'), /Blade sharpened/);
  assert.equal(await page.textContent('[data-testid="total-mows"]'), '1');
  assert.deepEqual(errors, []);
  await context.close();
});

test('backup: export JSON, reset, import restores (photos, header and Rachio runs included)', async () => {
  // A Rachio run saved on the phone before the backup.
  const seed = () => new Promise((res, rej) => {
    const r = indexedDB.open('lawncare', 2);
    r.onupgradeneeded = () => ['kv', 'zones', 'products', 'logs', 'photos', 'runs'].forEach((n) => r.result.createObjectStore(n, n === 'kv' ? undefined : { keyPath: 'id' }));
    r.onsuccess = () => {
      const t = r.result.transaction('runs', 'readwrite');
      t.objectStore('runs').put({ id: 'rachio-e2', deviceId: 'd1', zoneId: 'rz1', zoneNumber: 1, zoneName: 'Front Left', start: Date.parse('2026-09-28T06:00:00-05:00'), end: Date.parse('2026-09-28T06:20:00-05:00'), date: '2026-09-28', seconds: 1200, planned: 1200, stoppedEarly: false });
      t.oncomplete = () => { r.result.close(); res(); };
      t.onerror = () => rej(t.error);
    };
  });
  const { page, errors, context } = await open({ path: '#yard', seed });
  await openLog(page, 'Mow');
  await save(page, 'Mow logged');
  await page.click('.view.active [data-action="settings"]');
  await guard(page);
  const [download] = await Promise.all([page.waitForEvent('download'), sheet(page).locator('[data-act="export"]').click()]);
  assert.match(download.suggestedFilename(), /^lawn-care-backup-2026-10-02\.json$/);
  const dir = await mkdtemp(join(tmpdir(), 'lawn-'));
  const file = join(dir, 'backup.json');
  await download.saveAs(file);
  const data = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(data.app, 'lawn-care-pwa');
  assert.equal(data.schema, 2);
  assert.equal(data.logs.length, 1);
  assert.equal(data.products.length, 6);
  assert.deepEqual(data.runs.map((r) => r.id), ['rachio-e2']);
  await hold(page, 1150, '.settings-sheet .hold-btn');
  await page.waitForSelector('.toast:has-text("All data reset")');
  assert.equal((await idb(page, 'logs')).length, 0);
  assert.equal((await idb(page, 'runs')).length, 0);
  await page.click('.view.active [data-action="settings"]');
  await guard(page);
  const bad = join(dir, 'bad.json');
  await writeFile(bad, '{"hello": 1}');
  await sheet(page).locator('[data-import]').setInputFiles(bad);
  await page.waitForSelector('.toast:has-text("isn’t a Lawn Care backup")');
  await sheet(page).locator('[data-import]').setInputFiles(file);
  await page.waitForSelector('.dialog:has-text("Replace all data")');
  await page.click('.dialog [data-v="1"]');
  await page.waitForSelector('.toast:has-text("Backup restored")');
  assert.equal((await idb(page, 'logs')).length, 1);
  assert.equal((await idb(page, 'runs')).length, 1);
  assert.deepEqual(errors, []);
  await context.close();
});

test('dark mode is the default; Auto follows the phone and Light sticks', async () => {
  const { page, errors, context } = await open({ colorScheme: 'light', path: '#yard' });
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const meta = () => page.evaluate(() => [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.content));
  const DARK = 'rgb(11, 15, 12)';
  const LIGHT = 'rgb(244, 245, 241)';
  assert.equal(await bg(), DARK); // dark even on a phone set to light
  assert.deepEqual(await meta(), ['#0b0f0c', '#0b0f0c']);
  await page.click('.view.active [data-action="settings"]');
  await guard(page);
  const pick = async (v) => { await sheet(page).locator(`[data-seg="appearance.theme"] [data-value="${v}"]`).click(); await page.waitForTimeout(200); };
  assert.equal(await sheet(page).locator('[data-seg="appearance.theme"] .seg-opt.on').getAttribute('data-value'), 'dark');
  await pick('system');
  assert.equal(await bg(), LIGHT); // Auto follows the phone
  await pick('light');
  assert.equal(await bg(), LIGHT);
  await closeSheet(page);
  await page.reload();
  await page.waitForSelector('.view.active .page-head');
  assert.equal(await bg(), LIGHT); // your pick survives a reload
  assert.equal((await settingsOf(page)).appearance.theme, 'light');
  assert.deepEqual(errors, []);
  await context.close();
});

test('every sheet fits 390px', async () => {
  const { page, errors, context } = await open();
  for (const label of ['Mow', 'Fertilize', 'Spot spray', 'Pulled weeds', 'Watering', 'Other']) {
    await openLog(page, label);
    await sheet(page).locator('[data-act="details"]').click();
    assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), [], `overflow in ${label}`);
    await closeSheet(page);
  }
  await tab(page, 'yard');
  for (const id of ['location', 'zones', 'mower', 'spreader', 'products', 'water', 'schedule', 'nitrogen']) {
    await page.click(`.view.active [data-action="yard-section"][data-id="${id}"]`);
    await guard(page);
    assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), [], `overflow in ${id}`);
    if (id === 'products') {
      await sheet(page).locator('[data-action="product"][data-id="p-ortho-wbg"]').click();
      await guard(page);
      assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), [], 'overflow in product sheet');
      assert.match(await sheet(page).textContent(), /Label mix rate/);
      await closeSheet(page);
    }
    await closeSheet(page);
  }
  await page.click('.view.active [data-action="settings"]');
  await guard(page);
  assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), [], 'overflow in settings');
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
  await page.waitForSelector('[data-testid="mow-card"]');
  await page.waitForSelector('[data-testid="weather"]');
  assert.match(await page.textContent('[data-testid="soil24"]'), /°/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.hero-img')).backgroundImage.includes('header.jpg')), true);
  await openLog(page, 'Mow');
  await save(page, 'Mow logged');
  assert.equal((await idb(page, 'logs')).length, 1);
  await context.close();
});

test('manifest, icons, link preview and service worker asset list', async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  // Home-screen icon and link preview: files exist at the sizes the page declares.
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  const size = async (f) => { const png = await readFile(join(ROOT, f)); return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`; };
  assert.equal(await size(/rel="apple-touch-icon" sizes="180x180" href="([^"]+)"/.exec(html)[1]), '180x180');
  const og = /property="og:image" content="https:\/\/jakedahlstrom-gif\.github\.io\/Lawn-care\/([^"]+)"/.exec(html)[1];
  assert.equal(await size(og), '1200x630');
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  for (const icon of manifest.icons) {
    const png = await readFile(join(ROOT, icon.src));
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
  const sw = await readFile(join(ROOT, 'sw.js'), 'utf8');
  const listed = new Set([...sw.matchAll(/'([^']+\.(?:js|css|png|jpg|html|webmanifest))'/g)].map((m) => m[1]));
  const files = [];
  for (const dir of ['js', 'js/views', 'css', 'icons', 'img']) {
    for (const f of await readdir(join(ROOT, dir), { withFileTypes: true })) if (f.isFile()) files.push(`${dir}/${f.name}`);
  }
  for (const f of [...files, 'index.html', 'manifest.webmanifest']) assert.ok(listed.has(f), `sw.js is missing ${f}`);
});

// Rachio Worker mock: three lawn zones and a drip zone, and Thursday morning's runs (Front Right stopped early).
const RW = 'https://rachio.example.workers.dev';
const rachioAt = (s) => Date.parse(`${s}:00-05:00`);
const zev = (id, subType, zone, time, summary) => ({ id, type: 'ZONE_STATUS', subType, eventDate: rachioAt(time), summary, eventDatas: [{ key: 'zoneNumber', convertedValue: String(zone) }] });
const RACHIO_ZONES = [
  { id: 'rz1', zoneNumber: 1, name: 'Front Left Lawn', enabled: true, customNozzle: { name: 'Rotor', inchesPerHour: 0.6 }, lastWateredDate: rachioAt('2026-10-01T06:20'), lastWateredDuration: 1200 },
  { id: 'rz2', zoneNumber: 2, name: 'Front Right', enabled: true, customNozzle: { name: 'Rotor', inchesPerHour: 0.6 } },
  { id: 'rz3', zoneNumber: 3, name: 'Zone 3', enabled: true, customNozzle: { name: 'Fixed Spray Head', inchesPerHour: 0 } },
  { id: 'rz7', zoneNumber: 7, name: 'Garden drip', enabled: true, customNozzle: { name: 'Drip', inchesPerHour: 0.5 } },
  { id: 'rz8', zoneNumber: 8, name: 'Unused', enabled: false },
];
const RACHIO_EVENTS = [
  zev('e1', 'ZONE_STARTED', 1, '2026-10-01T06:00', 'Front Left Lawn began watering at 06:00 AM for 20 minutes.'),
  zev('e2', 'ZONE_COMPLETED', 1, '2026-10-01T06:20', 'Front Left Lawn completed watering at 06:20 AM for 20 minutes.'),
  zev('e3', 'ZONE_STARTED', 2, '2026-10-01T06:21', 'Front Right began watering at 06:21 AM for 20 minutes.'),
  zev('e4', 'ZONE_STOPPED', 2, '2026-10-01T06:28', 'Front Right stopped watering at 06:28 AM for 20 minutes.'),
  zev('e5', 'ZONE_STARTED', 3, '2026-10-01T06:30', 'Zone 3 began watering at 06:30 AM for 10 minutes.'),
  zev('e6', 'ZONE_COMPLETED', 3, '2026-10-01T06:40', 'Zone 3 completed watering at 06:40 AM for 10 minutes.'),
  { id: 'e7', type: 'SCHEDULE_STATUS', subType: 'SCHEDULE_COMPLETED', eventDate: rachioAt('2026-10-01T06:41'), summary: 'Morning completed watering for 37 minutes.' },
];
function rachioWorker(context, state = { events: RACHIO_EVENTS }) {
  return context.route(`${RW}/**`, (r) => {
    const req = r.request();
    const u = new URL(req.url());
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-App-Password' };
    if (req.method() === 'OPTIONS') return r.fulfill({ status: 204, headers });
    if (req.headers()['x-app-password'] !== 'pw') return r.fulfill({ status: 401, headers, json: { error: 'Wrong password' } });
    if (u.pathname === '/person/info') return r.fulfill({ headers, json: { id: 'p1' } });
    if (u.pathname === '/person/p1') return r.fulfill({ headers, json: { devices: [{ id: 'd1', name: 'Rachio 3', status: 'ONLINE', zones: RACHIO_ZONES }] } });
    if (u.pathname === '/device/d1/event') return r.fulfill({ headers, json: state.events });
    return r.fulfill({ status: 404, headers, json: {} });
  });
}

test('My Zones: Rachio runs counted automatically, zone matching, nozzle rates, gallons and cost, saved without duplicates', async () => {
  const state = { events: RACHIO_EVENTS };
  const { page, errors, context } = await open({ path: '#yard', setup: (ctx) => rachioWorker(ctx, state) });
  await page.click('.view.active [data-action="my-zones"]');
  await guard(page);
  await sheet(page).locator('#rachio-url').fill(RW);
  await sheet(page).locator('#rachio-pw').fill('bad');
  await sheet(page).locator('[data-act="connect"]').click();
  await sheet(page).getByText('Wrong password').waitFor();
  await sheet(page).locator('#rachio-pw').fill('pw');
  await sheet(page).locator('[data-act="connect"]').click();
  await sheet(page).locator('[data-testid="rachio-totals"]').waitFor();

  // Zones: matched by name or number, Rachio's nozzle rate by default, a prompt where Rachio has none.
  const zone = (id) => sheet(page).locator(`.rz-zone[data-rz="${id}"]`);
  assert.deepEqual(await sheet(page).locator('.rz-head .row-title').allTextContents(), ['1. Front Left Lawn', '2. Front Right', '3. Zone 3', '7. Garden drip']);
  assert.equal(await zone('rz1').locator('[data-testid="match-how"]').textContent(), 'Matched by name');
  assert.equal(await zone('rz1').locator('select').inputValue(), '');
  assert.match(await zone('rz1').locator('select option:checked').textContent(), /Auto: Front Left/);
  assert.match(await zone('rz1').textContent(), /Nozzle 0\.6 in\/hr from Rachio · Rotor/);
  assert.equal(await zone('rz3').locator('[data-testid="match-how"]').textContent(), 'Matched by zone number');
  assert.match(await zone('rz3').textContent(), /Needs nozzle rate.*Using 1\.5 in\/hr from Side Left until you enter one/s);
  assert.equal(await zone('rz1').locator('[data-nozzle]').count(), 0);
  assert.match(await zone('rz7').textContent(), /Not matched — pick a zone to count it/);

  // Runs: actual minutes (the stopped run counts 7 of its 20), with gallons and cost each.
  const runs = sheet(page).locator('[data-testid="rachio-runs"] .rz-run');
  assert.equal(await runs.count(), 3);
  assert.match(await runs.nth(1).textContent(), /Front Right.*stopped early.*7 min of 20 min · 0\.07″.*55 gal.*\$0\.33/s);
  assert.match(await runs.nth(2).textContent(), /Front Left Lawn.*20 min · 0\.2″.*156 gal.*\$0\.94/s);
  assert.equal(await sheet(page).locator('[data-testid="rachio-week"]').textContent(), '335 gal');
  assert.equal(await zone('rz1').locator('[data-testid="zone-season"]').textContent(), '156 gal · $0.94');
  assert.deepEqual(await overflow(page, '.sheet-wrap:last-child .sheet'), []);

  // Enter the missing nozzle rate; fix a mismatch; enter your own water rate.
  await zone('rz3').locator('[data-nozzle]').fill('1.2');
  await zone('rz3').locator('[data-nozzle]').press('Enter');
  await zone('rz3').locator('[data-testid="zone-week"]').getByText('100 gal · $0.60').waitFor();
  assert.doesNotMatch(await zone('rz3').textContent(), /Needs nozzle rate/);
  await zone('rz3').locator('select').selectOption('z4');
  await zone('rz3').locator('[data-testid="match-how"]').getByText('You picked this').waitFor();
  await sheet(page).locator('[data-water-rate]').fill('5');
  await sheet(page).locator('[data-water-rate]').press('Enter');
  await sheet(page).locator('[data-testid="rachio-totals"]').getByText('$1.55 · 3 runs').first().waitFor();
  const s = await settingsOf(page);
  assert.deepEqual(s.rachio, { zoneMap: { rz3: 'z4' }, rates: { rz3: 1.2 } });
  assert.equal(s.water.rateMode, 'custom');
  assert.equal(s.water.customRate, 5);

  // Saved on the phone: refreshing adds no duplicates, and runs stay after they leave Rachio's 7-day history.
  assert.equal((await idb(page, 'runs')).length, 3);
  await sheet(page).locator('[data-act="refresh"]').click();
  await page.waitForTimeout(400);
  assert.equal((await idb(page, 'runs')).length, 3);
  state.events = [];
  await sheet(page).locator('[data-act="refresh"]').click();
  await page.waitForTimeout(400);
  assert.equal((await idb(page, 'runs')).length, 3);
  assert.equal(await sheet(page).locator('[data-testid="rachio-season"]').textContent(), '310 gal');
  await closeSheet(page);

  // Today counts the runs; the Watering log says to log only hand watering; History totals include them.
  await tab(page, 'today');
  assert.match(await page.textContent('[data-testid="water-split"]'), /^Rain 0\.4″ · Rachio 0\.07″$/);
  assert.match(await page.textContent('[data-testid="water"]'), /310 gal · \$1\.55.*Rachio connected/s);
  await openLog(page, 'Watering');
  assert.equal(await sheet(page).locator('[data-testid="water-log-note"]').textContent(), 'Rachio runs are now counted automatically. Only log hand watering here. Gallons use each zone’s flow rate.');
  await closeSheet(page);
  await tab(page, 'history');
  assert.equal(await page.textContent('[data-testid="total-water"]'), '$1.55');
  assert.match(await page.textContent('[data-testid="totals"]'), /310 gal watered \(3 Rachio runs\)/);
  await tab(page, 'today');
  await page.click('[data-testid="water"]');
  await sheet(page).locator('[data-testid="rachio-totals"]').waitFor();
  assert.deepEqual(errors.filter((e) => !/401/.test(e)), []);
  await context.close();
});

test('Today shows the saved Rachio Worker connection status', async () => {
  const W = 'https://rachio.example.workers.dev';
  const save = (pw) => `localStorage.setItem('lawn-care-rachio', JSON.stringify({ url: '${W}', password: '${pw}' }))`;
  const setup = (context) => context.route(`${W}/**`, (r) => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'X-App-Password' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers });
    if (r.request().headers()['x-app-password'] !== 'pw') return r.fulfill({ status: 401, headers, json: { error: 'Wrong password' } });
    return r.fulfill({ headers, json: { id: 'p1' } });
  });
  const status = (page) => page.locator('[data-testid="rachio-status"]');

  // Saved address and password, and the Worker answers.
  let { page, errors, context } = await open({ setup, seed: save('pw') });
  await status(page).getByText('Rachio connected').waitFor();
  await openLog(page, 'Watering');
  assert.match(await sheet(page).textContent(), /Rachio runs are now counted automatically\. Only log hand watering here\./);
  assert.deepEqual(errors, []);
  await context.close();

  // Saved, but the Worker rejects the password.
  ({ page, context } = await open({ setup, seed: save('bad') }));
  await status(page).getByText('Rachio Worker not responding').waitFor();
  await context.close();

  // Nothing saved on this device.
  ({ page, context } = await open({ setup }));
  assert.equal(await status(page).textContent(), 'Rachio not connected yet');
  await openLog(page, 'Watering');
  assert.match(await sheet(page).textContent(), /Rachio isn’t connected on this device/);
  await context.close();
});
