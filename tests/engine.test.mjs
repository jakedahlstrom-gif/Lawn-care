// Unit tests for the engine and season planner. Run: TZ=America/Chicago node --test tests/engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import * as Season from '../js/season.js';
import { normalize } from '../js/weather.js';
import { migrateSettings, migrateProducts } from '../js/store.js';
import { defaultSettings, defaultZones, defaultProducts } from '../js/defaults.js';
import { mockForecast, toMetric, addDays } from './mock-weather.mjs';

const TODAY = '2026-10-02'; // Friday
const at = (date, hour = 9) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00-05:00`).getTime();
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function ctx({ today = TODAY, hour = 9, logs = [], day, settings, zones, products, noWeather = false } = {}) {
  const raw = mockForecast({ today, day, nowHour: hour });
  const c = {
    today,
    now: at(today, hour),
    settings: settings || defaultSettings(),
    zones: zones || defaultZones(),
    products: products || defaultProducts(),
    logs,
    weather: noWeather ? null : normalize(raw, at(today, hour)),
  };
  c.cond = E.conditions(c);
  c.feedings = Season.feedingSchedule(c);
  c.seasonTasks = Season.seasonTasks(c);
  return c;
}
const mow = (date, position = 5, extra = {}) => ({ id: `m-${date}`, type: 'mow', date, at: at(date, 10), position, height: defaultSettings().mower.heights[position - 1], hours: 1, zones: ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'], notes: '', ...extra });
const feed = (date, productId = 'p-scotts-winterguard', amount = 18.75) => ({ id: `f-${date}`, type: 'fert', date, at: at(date), productId, productType: 'fertilizer', n: 32, unit: 'lb', amount, zones: ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'], effects: { nLbs: amount * 0.32, timers: [] } });
const other = (date, kind) => ({ id: `o-${kind}-${date}`, type: 'other', kind, date, at: at(date), zones: [] });
const byId = (list, id) => list.find((x) => x.id === id);

/* ---------- water, products, mower ---------- */

test('tiered water cost and irrigation rate', () => {
  const tiers = defaultSettings().water.tiers;
  near(E.tierCost(25000, tiers), 115.0);
  assert.equal(E.tierIndex(25000, tiers), 2);
  const info = E.waterRateInfo(defaultSettings(), defaultZones());
  assert.equal(info.idx, 2);
  assert.equal(info.per1000, 6.02);
  const s = defaultSettings();
  s.water.sewerWinter = false;
  assert.equal(E.waterRateInfo(s, defaultZones()).per1000, 12.02);
});

test('Scotts lineup math: pounds, N per 1,000', () => {
  const p = Object.fromEntries(defaultProducts().map((x) => [x.id, x]));
  assert.equal(E.amountFor(p['p-scotts-winterguard'], 7500), 18.75);
  near(E.nPer1000(p['p-scotts-winterguard']), 0.8);
  near(E.amountFor(p['p-scotts-halts'], 7500), 20.025);
  near(E.nPer1000(p['p-scotts-halts']), 0.801, 0.01);
  assert.equal(E.nPer1000(p['p-scotts-grubex']), 0);
  assert.equal(p['p-ortho-wbg'].mixRate, 2);
});

test('mower positions and stripe rotation', () => {
  const h = defaultSettings().mower.heights;
  assert.equal(E.nearestPosition(h, 3.0), 5);
  assert.equal(E.nearestPosition(h, 2.5), 3);
  assert.equal(E.nextPattern([]), 0);
  assert.equal(E.nextPattern([mow('2026-09-27', 5, { pattern: 0 })]), 1);
  assert.equal(E.nextPattern([mow('2026-09-20', 5, { pattern: 1 }), mow('2026-09-27', 5, { pattern: 3 })]), 0);
  assert.equal(E.nextPattern([mow('2026-09-20'), mow('2026-09-27')]), 2); // older logs without a pattern: count mod 4
  assert.match(E.patternText(2), /diagonal, rising to the right.*across the slope/);
});

test('note learning tunes growth', () => {
  assert.equal(E.noteSentiment('Grass was long'), 1);
  assert.equal(E.noteSentiment('barely grew'), -1);
  assert.ok(E.growthCalibration([mow('2026-09-27', 5, { notes: 'really long, clumps' })], TODAY).factor > 1);
});

/* ---------- mowing ---------- */

test('mowing: weekly cadence, wet weekends, slow growth, final step-down', () => {
  const r = E.mowRecommendation(ctx({ logs: [mow('2026-09-27', 5, { pattern: 0 })] }));
  assert.equal(r.date, '2026-10-04');
  assert.equal(r.position, 5);
  assert.equal(r.pattern, 1);
  assert.match(r.reason, /growth since the Sep 27 mow/);
  const wet = E.mowRecommendation(ctx({ logs: [mow('2026-09-27')], day: (d) => (d === '2026-10-03' || d === '2026-10-04' ? { rain: 0.8, prob: 90 } : {}) }));
  assert.ok(!['2026-10-03', '2026-10-04', '2026-10-05'].includes(wet.date));
  assert.equal(E.mowRecommendation(ctx({ logs: [mow('2026-09-27')], day: () => ({ tMax: 50, tMin: 33 }) })).status, 'skip');
  const fin = E.mowRecommendation(ctx({ today: '2026-10-28', logs: [mow('2026-10-21', 6)], day: () => ({ tMax: 46, tMin: 30 }) }));
  assert.equal(fin.final, true);
  assert.ok(fin.height < 3.6 && fin.height >= ((3.6 + fin.growth) * 2) / 3 - 0.01);
});

test('mowing: summer heat raises the height; sloped zones note', () => {
  const r = E.mowRecommendation(ctx({ today: '2026-07-15', logs: [mow('2026-07-11', 6)], day: () => ({ tMax: 91, tMin: 70 }) }));
  assert.equal(r.target, 4.0);
  assert.ok(r.notes.some((n) => /Side Left & Side Right/.test(n)));
});

test('mowing: logged watering counts as moisture for growth', () => {
  const dry = E.mowRecommendation(ctx({ logs: [mow('2026-09-27')] })).growth;
  const water = { id: 'w', type: 'water', date: '2026-09-30', at: at('2026-09-30'), zones: ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'], minutes: 60 };
  const wet = E.mowRecommendation(ctx({ logs: [mow('2026-09-27'), water] })).growth;
  assert.ok(wet > dry, `${wet} > ${dry}`);
});

/* ---------- feeding windows ---------- */

test('feeding: missed early-fall window folds into one fall feeding now', () => {
  const c = ctx();
  const early = byId(c.feedings, 'feed-early-fall');
  const late = byId(c.feedings, 'feed-late-fall');
  assert.equal(early.status, 'missed');
  assert.equal(late.status, 'open');
  assert.equal(late.title, 'Fall feeding');
  assert.equal(late.product.id, 'p-scotts-winterguard');
  assert.equal(late.lbs, 18.75);
  assert.equal(late.combinedWith.id, 'feed-early-fall');
  assert.match(late.reason, /early fall window was missed/);
  assert.equal(c.feedings.filter((f) => f.status === 'open').length, 1);
  const head = Season.feedingHeadline(c, c.feedings);
  assert.equal(head.open, true);
  assert.equal(head.text, 'Feeding window open now · WinterGuard');
});

test('feeding: on-time early fall leaves late fall upcoming Oct 10–25', () => {
  const c = ctx({ logs: [feed('2026-09-05')] });
  assert.equal(byId(c.feedings, 'feed-early-fall').status, 'done');
  const late = byId(c.feedings, 'feed-late-fall');
  assert.equal(late.status, 'upcoming');
  assert.equal(late.start, '2026-10-10');
  assert.equal(Season.feedingHeadline(c, c.feedings).text, 'Next feeding: WinterGuard, Oct 10–25');
});

test('feeding: applications stay at least 4 weeks apart', () => {
  const c = ctx({ today: '2026-10-12', logs: [feed('2026-09-20')] });
  const late = byId(c.feedings, 'feed-late-fall');
  assert.equal(late.status, 'upcoming');
  assert.equal(late.start, '2026-10-18');
  // Fed late in the early-fall window, but still counted there: the next one waits 4 weeks.
  const lateEarly = ctx({ today: '2026-10-12', logs: [feed('2026-09-22')] });
  assert.equal(byId(lateEarly.feedings, 'feed-early-fall').status, 'done');
  assert.equal(byId(lateEarly.feedings, 'feed-late-fall').start, '2026-10-20');
  // A feeding after the early-fall window closed IS the combined fall feeding.
  const combined = ctx({ today: '2026-10-12', logs: [feed('2026-09-30')] });
  assert.equal(byId(combined.feedings, 'feed-late-fall').status, 'done');
  assert.equal(byId(combined.feedings, 'feed-late-fall').title, 'Fall feeding');
  // Halts on May 19 leaves no room for a late-spring feeding 4 weeks later.
  const tooSoon = ctx({ today: '2026-06-01', logs: [feed('2026-05-19', 'p-scotts-halts', 20)] });
  assert.equal(byId(tooSoon.feedings, 'feed-spring').status, 'done');
  assert.equal(byId(tooSoon.feedings, 'feed-late-spring').status, 'skipped');
  assert.match(byId(tooSoon.feedings, 'feed-late-spring').reason, /4 weeks/);
});

test('feeding: crabgrass preventer opens on soil temperature; optional summer skip does not carry', () => {
  const cold = ctx({ today: '2027-04-20', day: () => ({ tMax: 55, tMin: 35, soil: 45 }) });
  assert.equal(byId(cold.feedings, 'feed-spring').status, 'waiting');
  const warm = ctx({ today: '2027-04-20', day: () => ({ tMax: 66, tMin: 44, soil: 52 }) });
  const spring = byId(warm.feedings, 'feed-spring');
  assert.equal(spring.status, 'open');
  assert.equal(spring.product.id, 'p-scotts-halts');
  assert.equal(Season.feedingHeadline(warm, warm.feedings).text, 'Feeding window open now · Halts');
  const aug = ctx({ today: '2026-08-28', logs: [feed('2026-04-25', 'p-scotts-halts', 20), feed('2026-05-28', 'p-scotts-32-0-4')] });
  assert.equal(byId(aug.feedings, 'feed-summer').status, 'skipped');
  assert.equal(byId(aug.feedings, 'feed-early-fall').combinedWith, null);
  assert.equal(byId(aug.feedings, 'feed-early-fall').status, 'open');
});

test('feeding: GrubEx is not counted as a feeding', () => {
  const grub = { ...feed('2026-09-10', 'p-scotts-grubex', 21.5), productType: 'grub', n: 0, effects: { nLbs: 0 } };
  const c = ctx({ logs: [grub] });
  assert.equal(byId(c.feedings, 'feed-early-fall').status, 'missed');
});

/* ---------- shopping ---------- */

test('shopping: bags to buy with leftover, using inventory', () => {
  const [wg] = defaultProducts();
  const a = Season.bagPlan(wg, 18.75);
  assert.equal(a.enough, false);
  assert.deepEqual(a.items.map((x) => [x.size, x.count]), [[12.5, 2]]);
  assert.equal(a.text, 'Buy 2 × 12.5 lb bags of WinterGuard — about 6 lb left over');
  const b = Season.bagPlan({ ...wg, onHand: 10 }, 18.75);
  assert.equal(b.text, 'Buy 1 bag of WinterGuard (12.5 lb) — about 4 lb left over');
  const big = Season.bagPlan(wg, 33);
  assert.deepEqual(big.items.map((x) => [x.size, x.count]), [[37.5, 1]]);
  assert.equal(Season.bagPlan({ ...wg, onHand: 25 }, 18.75).enough, true);
  const spring = Season.springShopping(ctx());
  assert.deepEqual(spring.map((x) => x.product.short), ['Halts', 'Lawn Food']);
});

/* ---------- weeds ---------- */

test('spot spray conditions: 50–85°F, wind under 10 mph, 24 dry hours', () => {
  const wbg = defaultProducts().find((p) => p.id === 'p-ortho-wbg');
  const rate = (day) => {
    const c = ctx({ hour: 7, day: (d) => (d === TODAY ? day : {}) });
    return E.applicationWindow({ ...c, product: wbg, zoneIds: [], zones: c.zones, kind: 'weed' }).days[0];
  };
  assert.equal(rate({ tMax: 68 }).rating, 'good');
  assert.equal(rate({ tMax: 68, wind: 12 }).rating, 'avoid');
  assert.equal(rate({ tMax: 47 }).rating, 'avoid');
  assert.equal(rate({ tMax: 88 }).rating, 'avoid');
  assert.match(rate({ tMax: 68, rain: 0.1, rainHours: [20] }).note, /Rain within 24 h/);
});

test('pulling days: soft soil after rain', () => {
  const c = ctx({ day: (d, i) => (i === -1 ? { rain: 0.4 } : {}) });
  assert.equal(E.pullDay(c.weather, TODAY).good, true);
  assert.equal(E.pullDay(ctx().weather, TODAY).good, false);
  const v = E.dayVerdicts(c, TODAY);
  assert.equal(v.pull.ok, true);
  assert.equal(v.frost.level, 'none');
});

/* ---------- agenda ---------- */

test('agenda: feeding, aeration is optional (never Do today), pulling after rain', () => {
  const c = ctx({ day: (d, i) => (i === -1 ? { rain: 0.4 } : {}) });
  const a = Season.agenda(c);
  const ids = a.today.map((x) => x.id);
  assert.ok(ids.includes('feed-late-fall'), ids.join());
  assert.ok(ids.includes('pull-weeds'));
  const aer = a.today.find((x) => x.id === 'aerate');
  assert.equal(aer.badge, 'optional');
  assert.match(aer.reason, /good week to aerate.*fertilizer reach the roots/);
  for (const x of [...a.today, ...a.tomorrow, ...a.next]) assert.notEqual(x.id, 'mow');
  const freeze = Season.agenda(ctx({ day: (d) => (d === addDays(TODAY, 1) ? { tMin: 26 } : {}) }));
  assert.equal(freeze.today.find((x) => x.id === 'blowout')?.badge, 'today');
});

/* ---------- watering ---------- */

test('watering: weekly total = rain + logged runs; gallons from zone flow', () => {
  const calc = E.wateringCalc(defaultZones(), ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'], 20, defaultSettings());
  near(calc.inches, 0.2378, 0.001);
  near(calc.gallons, 20 * (6.5 + 6.5 + 12.5 + 12.5 + 8.8 + 8.8), 0.01);
  near(calc.cost, (calc.gallons / 1000) * 6.02, 0.001);
  const none = E.waterWeek(ctx({ noWeather: true }));
  assert.equal(none.total, 0);
  assert.equal(none.rachio, false);
  const run = { id: 'w', type: 'water', date: TODAY, at: at(TODAY), zones: ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'], minutes: 20 };
  const w = E.waterWeek(ctx({ logs: [run], day: (d, i) => (i === -2 ? { rain: 0.3 } : {}) }));
  near(w.rain, 0.3);
  near(w.watered, 0.2378, 0.001);
  near(w.total, 0.5378, 0.001);
  near(w.gallons, calc.gallons, 0.01);
});

/* ---------- checklists and winter ---------- */

test('fall checklist completes from logs; winter prompt after wrap-up', () => {
  const logs = [feed('2026-10-03'), mow('2026-10-30', 3, { final: true }), other('2026-11-01', 'blowout')];
  const c = ctx({ today: '2026-11-03', logs });
  const fall = Season.fallChecklist(c);
  assert.ok(byId(fall, 'fall-fert').done && byId(fall, 'final-mow').done && byId(fall, 'blowout').done);
  assert.equal(byId(fall, 'battery').done, false);
  const p = Season.winterPrompt(c);
  assert.equal(p.action, 'on');
  const s = defaultSettings();
  s.winter.dismissed = { [p.key]: true };
  assert.equal(Season.winterPrompt(ctx({ today: '2026-11-03', logs, settings: s })), null);
  const freeze = Season.winterPrompt(ctx({ today: '2026-10-20', day: (d, i) => (i === -2 ? { tMin: 24 } : {}) }));
  assert.equal(freeze?.action, 'on');
  const w = Season.winterChecklist(c);
  assert.deepEqual(w.map((i) => i.id), ['battery', 'spreader', 'bags']);
});

test('winter screen: snow, soil trend, spring countdown, recap; spring suggests turning it off', () => {
  const s = defaultSettings();
  s.winter.on = true;
  const c = ctx({ today: '2027-01-15', settings: s, logs: [mow('2026-09-27'), feed('2026-10-03')], day: (d, i) => ({ tMax: 24, tMin: 8, soil: 30 + i * 0.3, snow: i === 0 ? 1.2 : 0, depthFt: 0.5 }) });
  const w = Season.winterInfo(c);
  near(w.depth, 6, 0.01);
  near(w.snowToday, 1.2);
  assert.ok(w.trend.perWeek > 1);
  assert.equal(w.countdown.source, 'typical');
  assert.equal(w.countdown.opensOn, '2027-04-24');
  assert.equal(w.recap.year, 2026);
  assert.equal(w.recap.mows, 1);
  const soon = Season.winterInfo(ctx({ today: '2027-04-12', settings: s, day: (d, i) => ({ tMax: 60, tMin: 38, soil: 44 + i * 0.6 }) }));
  assert.equal(soon.countdown.source, 'forecast');
  assert.equal(soon.countdown.alert, true);
  assert.match(soon.countdown.alertText, /time to buy Halts/);
  const off = Season.winterPrompt(ctx({ today: '2027-04-05', settings: s, day: (d, i) => ({ tMax: 58, tMin: 36, soil: 42 + i * 0.4 }) }));
  assert.equal(off?.action, 'off');
});

/* ---------- migration ---------- */

test('migration from v1 keeps data, resets heights to Estimated, moves the plan to Scotts', () => {
  const v1 = {
    location: { name: 'Prior Lake, MN', lat: 44.71, lon: -93.42, grass: 'Kentucky bluegrass', surveyArea: 8685 },
    mower: { model: 'EGO', heights: [1.5, 1.9, 2.3, 2.75, 3.25, 3.6, 4.0], mowHours: 1.2, sharpenEvery: 25, sinceSharpenAtStart: 3, hoursBefore: 10 },
    water: { ...defaultSettings().water, baseUsage: 6100 },
    planProducts: { 'fert-early-fall': 'p-lesco-24-0-11' },
    planChecks: { 2026: { 'fert-early-fall': true, battery: true, 'sharpen-spring': true } },
    src: { 'mower.heights.4': 'meas', 'location.grass': 'meas', 'mower.model': 'meas', 'location.lat': 'meas', 'water.baseUsage': 'meas' },
  };
  const s = migrateSettings(v1);
  assert.equal(s.schema, 2);
  assert.equal(s.mower.heights[4], 3.25);
  assert.equal(s.mower.mowHours, 1.2);
  assert.equal(s.mower.sharpenEvery, undefined);
  assert.equal(s.mower.hoursBefore, undefined);
  assert.equal(s.src['mower.heights.4'], 'est');
  assert.equal(s.src['location.grass'], undefined);
  assert.equal(s.src['location.lat'], 'meas');
  assert.equal(s.src['water.baseUsage'], 'meas');
  assert.equal(s.water.baseUsage, 6100);
  assert.equal(s.planProducts['feed-late-fall'], 'p-scotts-winterguard');
  assert.deepEqual(s.planChecks[2026], { 'feed-early-fall': true, battery: true });
  assert.equal(s.profile.name, 'Jake');
  const oldProducts = [
    { id: 'p-lesco-24-0-11', order: 1, name: 'Lesco 24-0-11', type: 'fertilizer', n: 24, p: 0, k: 11, unit: 'lb', size: 50, coverage: 12000, price: 52, onHand: 40 },
    { id: 'p-scotts-32-0-4', order: 2, name: 'Scotts Turf Builder Lawn Food 32-0-4', type: 'fertilizer', n: 32, p: 0, k: 4, unit: 'lb', size: 12.5, coverage: 5000, price: 28, onHand: 5 },
  ];
  const changed = migrateProducts(oldProducts, 1);
  const ids = changed.map((p) => p.id);
  for (const id of ['p-scotts-winterguard', 'p-scotts-halts', 'p-scotts-grubex', 'p-ortho-wbg']) assert.ok(ids.includes(id), id);
  const lesco = byId(changed, 'p-lesco-24-0-11');
  assert.equal(lesco.onHand, 40);
  assert.equal(lesco.order, 6);
  assert.deepEqual(lesco.bagOptions, [{ size: 50, price: 52 }]);
  const lf = byId(changed, 'p-scotts-32-0-4');
  assert.equal(lf.onHand, 5);
  assert.deepEqual(lf.bagOptions, [{ size: 12.5, price: 28 }, { size: 37.5, price: 60 }]);
  assert.equal(lf.short, 'Lawn Food');
  assert.equal(migrateProducts([...oldProducts.map((p) => ({ ...p, bagOptions: [{ size: 1, price: 1 }], short: '', mixRate: 0 }))], 2).length, 0);
});

test('weather normalize handles metric units and snow depth', () => {
  const raw = mockForecast({ today: TODAY, day: (d) => (d === TODAY ? { rain: 0.5, et0: 0.2, tMax: 70, depthFt: 0.25 } : {}) });
  const us = normalize(raw, 0);
  const metric = normalize(toMetric(raw), 0);
  near(us.dayMap[TODAY].rain, metric.dayMap[TODAY].rain);
  near(us.dayMap[TODAY].et0, metric.dayMap[TODAY].et0);
  near(us.dayMap[TODAY].tMax, metric.dayMap[TODAY].tMax, 0.05);
  near(us.hours[us.hourIndex[`${TODAY}T09`]].snowDepth, 3);
});
