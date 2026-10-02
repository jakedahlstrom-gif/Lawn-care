// Unit tests for the recommendation engine. Run: TZ=America/Chicago node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { normalize } from '../js/weather.js';
import { defaultSettings, defaultZones, defaultProducts } from '../js/defaults.js';
import { mockForecast, toMetric, addDays } from './mock-weather.mjs';

const TODAY = '2026-10-02'; // Friday
const at = (date, hour = 9) => new Date(`${date}T${String(hour).padStart(2, '0')}:00:00-05:00`).getTime();

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
  c.tasks = E.planTasks(c);
  return c;
}
const mow = (date, position = 5, extra = {}) => ({ id: `m-${date}`, type: 'mow', date, at: at(date, 10), position, height: defaultSettings().mower.heights[position - 1], hours: 1, zones: ['z1', 'z2', 'z3', 'z4', 'z5', 'z6'], notes: '', ...extra });

test('tiered water cost and tier lookup', () => {
  const tiers = defaultSettings().water.tiers;
  assert.equal(Math.round(E.tierCost(25000, tiers) * 100) / 100, 115.0);
  assert.equal(E.tierIndex(10000, tiers), 0);
  assert.equal(E.tierIndex(25000, tiers), 2);
  assert.equal(E.tierIndex(45000, tiers), 3);
});

test('irrigation rate auto-detects the top tier reached', () => {
  const info = E.waterRateInfo(defaultSettings(), defaultZones());
  assert.ok(info.periodIrr > 14000 && info.periodIrr < 17000, `period irrigation ${info.periodIrr}`);
  assert.equal(info.idx, 2);
  assert.equal(info.per1000, 6.02);
  const s = defaultSettings();
  s.water.billing = 'quarterly';
  s.water.baseUsage = 15000;
  assert.equal(E.waterRateInfo(s, defaultZones()).per1000, 9.05);
  s.water.rateMode = '1';
  assert.equal(E.waterRateInfo(s, defaultZones()).per1000, 4.63);
  s.water.sewerWinter = false;
  s.water.sewerRate = 6;
  assert.equal(E.waterRateInfo(s, defaultZones()).per1000, 10.63);
});

test('product math: pounds, N per 1,000, cost per lb N', () => {
  const [lesco, scotts] = defaultProducts();
  assert.equal(E.amountFor(lesco, 7500), 31.25);
  assert.equal(Math.round(E.nPer1000(lesco) * 100) / 100, 1.0);
  assert.equal(Math.round(E.nPer1000(scotts) * 100) / 100, 0.8);
  assert.equal(Math.round(E.costPerLbN(lesco) * 100) / 100, 4.17);
  assert.equal(E.costPerLbN(scotts), 7.5);
  assert.equal(E.lawnArea(defaultZones()), 7500);
});

test('mower positions snap to the nearest height', () => {
  const h = defaultSettings().mower.heights;
  assert.equal(E.nearestPosition(h, 3.0), 5);
  assert.equal(E.nearestPosition(h, 2.5), 3);
  assert.equal(E.nearestPosition(h, 3.5), 6);
  assert.equal(E.nearestPosition(h, 4.0), 7);
  assert.equal(E.positionAtLeast(h, 3.3), 6);
});

test('note learning', () => {
  assert.equal(E.noteSentiment('Grass was long'), 1);
  assert.equal(E.noteSentiment('barely grew this week'), -1);
  assert.equal(E.noteSentiment('not very long'), -1);
  assert.equal(E.noteSentiment('Clumping on the side yards'), 1);
  assert.equal(E.noteSentiment('mowed front first'), 0);
  assert.equal(E.noteSentiment(''), 0);
  const logs = [mow('2026-09-20', 5, { notes: 'grass was long' }), mow('2026-09-27', 5, { notes: 'really long, clumps' })];
  const cal = E.growthCalibration(logs, TODAY);
  assert.equal(cal.count, 2);
  assert.ok(cal.factor > 1.1);
  assert.ok(E.growthCalibration([mow('2026-09-27', 5, { notes: 'barely grew' })], TODAY).factor < 1);
});

test('mowing: picks the preferred day closest to a weekly cadence when dry', () => {
  const c = ctx({ logs: [mow('2026-09-27')] }); // last mow Sunday
  const r = E.mowRecommendation(c);
  assert.equal(r.status, 'mow');
  assert.equal(r.date, '2026-10-04'); // Sunday, exactly a week later
  assert.equal(r.position, 5);
  assert.equal(r.height, 3.15);
  assert.ok(r.growth > 0.5 && r.growth < 1.2, `growth ${r.growth}`);
  assert.match(r.reason, /growth since the Sep 27 mow/);
});

test('mowing: avoids a rainy preferred day and the soggy day after heavy rain', () => {
  const rainySun = ctx({ logs: [mow('2026-09-27')], day: (d) => (d === '2026-10-04' ? { rain: 0.6, prob: 90 } : {}) });
  assert.equal(E.mowRecommendation(rainySun).date, '2026-10-03');
  const wetWeekend = ctx({
    logs: [mow('2026-09-27')],
    day: (d) => (d === '2026-10-03' || d === '2026-10-04' ? { rain: 0.8, prob: 90 } : {}),
  });
  const r = E.mowRecommendation(wetWeekend);
  assert.ok(!['2026-10-03', '2026-10-04', '2026-10-05'].includes(r.date), `picked ${r.date}`);
  assert.match(r.reason, /usual days look wet/);
});

test('mowing: skips when growth is slow', () => {
  const c = ctx({ logs: [mow('2026-09-27')], day: () => ({ tMax: 50, tMin: 33 }) });
  const r = E.mowRecommendation(c);
  assert.equal(r.status, 'skip');
  assert.match(r.reason, /Skip this week/);
});

test('mowing: raises height for fast growth and offers an extra mow', () => {
  const today = '2026-06-10';
  const feed = { id: 'f1', type: 'fert', date: '2026-06-03', at: at('2026-06-03'), zones: [], effects: { nLbs: 7.5 } };
  const c = ctx({
    today,
    logs: [mow('2026-06-07'), feed, mow('2026-05-31', 5, { notes: 'grass was long' })],
    day: () => ({ tMax: 75, tMin: 60, rain: 0.25, prob: 30, rainHours: [3] }),
  });
  const r = E.mowRecommendation(c);
  assert.equal(r.status, 'mow');
  assert.ok(r.height >= 3.6, `height ${r.height}`);
  assert.ok(r.extra, 'expected an optional extra mow');
});

test('mowing: summer heat raises the target and adds a slope note', () => {
  const c = ctx({ today: '2026-07-15', logs: [mow('2026-07-11', 6)], day: () => ({ tMax: 91, tMin: 70 }) });
  const r = E.mowRecommendation(c);
  assert.equal(r.season.heat, true);
  assert.equal(r.target, 4.0);
  assert.ok(r.notes.some((n) => /Sloped Side Left & Side Right/.test(n)));
});

test('mowing: final mow steps down without breaking the one-third rule', () => {
  const c = ctx({ today: '2026-10-28', logs: [mow('2026-10-21', 6)], day: () => ({ tMax: 46, tMin: 30 }) });
  const r = E.mowRecommendation(c);
  assert.equal(r.final, true);
  assert.equal(r.target, 2.5);
  assert.ok(r.height >= ((3.6 + r.growth) * 2) / 3 - 0.01);
  assert.ok(r.height < 3.6);
  const done = ctx({ today: '2026-11-05', logs: [mow('2026-11-01', 3, { final: true })] });
  assert.equal(E.mowRecommendation(done).status, 'off');
});

test('mowing: first-run recommendation without logs or weather', () => {
  const r = E.mowRecommendation(ctx({ noWeather: true }));
  assert.equal(r.status, 'mow');
  assert.match(r.reason, /No mows logged yet/);
  assert.ok([6, 0].includes(new Date(`${r.date}T12:00`).getDay()));
});

test('mowing: respects a no-mow timer', () => {
  const feed = { id: 'f', type: 'fert', date: TODAY, at: at(TODAY), effects: { timers: [{ kind: 'noMow', until: at(TODAY) + 2 * 86400e3 }] } };
  const r = E.mowRecommendation(ctx({ logs: [mow('2026-09-30'), feed] }));
  assert.ok(r.date >= '2026-10-04', r.date);
});

test('fertilizer window is stricter on slopes', () => {
  const c = ctx({ hour: 7, day: (d) => (d === addDays(TODAY, 1) ? { rain: 0.4, prob: 90 } : {}) });
  const lesco = c.products[0];
  const flat = E.applicationWindow({ ...c, product: lesco, zoneIds: ['z1', 'z2'], zones: c.zones });
  const slope = E.applicationWindow({ ...c, product: lesco, zoneIds: ['z3', 'z4'], zones: c.zones });
  assert.equal(flat.hours, 24);
  assert.equal(slope.hours, 48);
  assert.notEqual(flat.days[0].rating, 'avoid');
  assert.equal(slope.days[0].rating, 'avoid');
  assert.match(slope.days[0].note, /heavy rain/);
  assert.equal(flat.days[1].rating, 'ok'); // 0.4" in window on flat ground: light enough
});

test('plan statuses on Oct 2 with no logs', () => {
  const c = ctx();
  const by = Object.fromEntries(c.tasks.map((t) => [t.id, t]));
  assert.equal(by['fert-early-fall'].status, 'late');
  assert.equal(by['fert-late-fall'].status, 'soon');
  assert.equal(by['weed-fall'].status, 'now');
  assert.equal(by['pre-emergent'].status, 'past');
  assert.equal(by['fert-early-fall'].product.name, 'Lesco 24-0-11');
  assert.equal(by['fert-early-fall'].lbs, 31.25);
  const withFeed = ctx({ logs: [{ id: 'f', type: 'fert', date: '2026-09-05', at: at('2026-09-05'), productId: 'p-lesco-24-0-11', amount: 31.25, effects: { nLbs: 7.5 } }] });
  assert.equal(withFeed.tasks.find((t) => t.id === 'fert-early-fall').status, 'done');
});

test('alerts: low inventory, freeze/blowout, spring soil temps', () => {
  const fall = E.alerts(ctx({ day: (d) => (d === addDays(TODAY, 4) ? { tMin: 26 } : {}) }));
  assert.ok(fall.some((a) => a.id === 'inv-p-lesco-24-0-11'));
  assert.ok(fall.some((a) => a.id === 'fert-window'));
  assert.ok(fall.some((a) => a.id === 'freeze'));
  const spring = E.alerts(ctx({ today: '2027-04-22', day: () => ({ tMax: 64, tMin: 42, soil: 52 }) }));
  assert.ok(spring.some((a) => a.id === 'soil50'), JSON.stringify(spring.map((a) => a.id)));
  const hot = E.alerts(ctx({ today: '2027-05-05', day: () => ({ tMax: 75, tMin: 52, soil: 57 }) }));
  assert.ok(hot.some((a) => a.id === 'soil55'));
});

test('timers from product intervals', () => {
  const zones = defaultZones();
  const [lesco] = defaultProducts();
  const t0 = at(TODAY, 12);
  const flat = E.computeTimers({ at: t0, zones: ['z1'] }, lesco, zones);
  const slope = E.computeTimers({ at: t0, zones: ['z3'] }, lesco, zones);
  assert.equal(flat.find((t) => t.kind === 'keepOff').until, t0 + 4 * 3600e3);
  assert.equal(flat.find((t) => t.kind === 'noRain').until, t0 + 24 * 3600e3);
  assert.equal(slope.find((t) => t.kind === 'noRain').until, t0 + 48 * 3600e3);
  const active = E.activeTimers([{ productName: 'Lesco', effects: { timers: flat } }], t0 + 3600e3);
  assert.match(active.find((t) => t.kind === 'keepOff').text, /Keep kids and pets off until 4:00 PM/);
});

test('watering plan: cycle and soak on sloped spray zones', () => {
  const p = E.wateringPlan(ctx({ today: '2026-07-15', day: () => ({ tMax: 86, tMin: 66, et0: 0.22 }) }));
  assert.equal(p.off, false);
  assert.ok(p.need > 0.8);
  const side = p.rows.find((r) => r.zone.id === 'z3');
  assert.equal(Math.round(side.cycles.maxMin), 6);
  assert.ok(side.cycles.cycles >= 2);
  assert.ok(p.cost > 0);
  const after = E.wateringPlan(ctx({ logs: [{ id: 'b', type: 'other', kind: 'blowout', date: '2026-10-01', at: at('2026-10-01') }] }));
  assert.equal(after.off, true);
});

test('season totals', () => {
  const t = E.seasonTotals({
    logs: [mow('2026-09-27'), mow('2026-09-20'), { id: 'f', type: 'fert', date: '2026-09-05', productId: 'p-lesco-24-0-11', productName: 'Lesco 24-0-11', unit: 'lb', amount: 31.25, effects: { nLbs: 7.5 } }],
    zones: defaultZones(),
    products: defaultProducts(),
    settings: defaultSettings(),
  }, 2026);
  assert.equal(t.mows, 2);
  assert.equal(t.nPer1000, 1);
  assert.equal(t.products[0].amount, 31.25);
  assert.equal(Math.round(t.products[0].cost * 100) / 100, 31.25);
  assert.ok(t.mulchCredit > 0);
});

test('mower hours and sharpening', () => {
  const s = defaultSettings();
  s.mower.sinceSharpenAtStart = 20;
  const logs = [mow('2026-09-20'), mow('2026-09-27')];
  assert.equal(E.mowerHours(s, logs).since, 22);
  logs.push({ id: 's', type: 'other', kind: 'sharpen', date: '2026-09-28', at: at('2026-09-28') }, mow('2026-10-01'));
  const h = E.mowerHours(s, logs);
  assert.equal(h.since, 1);
  assert.equal(h.total, 3);
});

test('weather normalize handles metric units', () => {
  const raw = mockForecast({ today: TODAY, day: (d) => (d === TODAY ? { rain: 0.5, et0: 0.2, tMax: 70 } : {}) });
  const us = normalize(raw, 0);
  const metric = normalize(toMetric(raw), 0);
  const a = us.dayMap[TODAY];
  const b = metric.dayMap[TODAY];
  assert.ok(Math.abs(a.rain - b.rain) < 0.01);
  assert.ok(Math.abs(a.et0 - b.et0) < 0.01);
  assert.ok(Math.abs(a.tMax - b.tMax) < 0.05);
  assert.ok(Math.abs(E.soilAvg24(us, at(TODAY, 9)) - E.soilAvg24(metric, at(TODAY, 9))) < 0.05);
});
