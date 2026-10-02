// Unit tests for Rachio runs: parsing, zone matching, nozzle rates, gallons and cost, and how runs count in the
// watering totals. Run: TZ=America/Chicago node --test tests/irrigation.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../js/irrigation.js';
import * as E from '../js/engine.js';
import * as Season from '../js/season.js';
import { normalize } from '../js/weather.js';
import { defaultSettings, defaultZones, defaultProducts } from '../js/defaults.js';
import { mockForecast } from './mock-weather.mjs';

const TODAY = '2026-10-02';
const at = (date, hm = '09:00') => Date.parse(`${date}T${hm}:00-05:00`);
const near = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const DEVICE = { id: 'd1' };

const RZ = I.rachioZones([{
  id: 'd1',
  zones: [
    { id: 'rz1', zoneNumber: 1, name: 'Front Left Lawn', enabled: true, customNozzle: { name: 'Rotor', inchesPerHour: 0.6 }, yardAreaSquareFeet: 1300 },
    { id: 'rz2', zoneNumber: 2, name: 'Front Right', enabled: true, customNozzle: { name: 'Rotor', inchesPerHour: 0.6 } },
    { id: 'rz3', zoneNumber: 3, name: 'Zone 3', enabled: true, customNozzle: { name: 'Fixed Spray Head', inchesPerHour: 0 } },
    { id: 'rz5', zoneNumber: 5, name: 'Back yard', enabled: true },
    { id: 'rz6', zoneNumber: 6, name: 'Back yard 2', enabled: true },
    { id: 'rz7', zoneNumber: 7, name: 'Garden drip', enabled: true, customNozzle: { inchesPerHour: 0.5 } },
  ],
}]);

const ev = (id, subType, zone, time, summary, extra = {}) => ({
  id, type: 'ZONE_STATUS', subType, eventDate: at(time.slice(0, 10), time.slice(11)), summary,
  eventDatas: [{ key: 'zoneNumber', convertedValue: String(zone) }], ...extra,
});
const EVENTS = [
  ev('e1', 'ZONE_STARTED', 1, '2026-10-01T06:00', 'Front Left Lawn began watering at 06:00 AM for 20 minutes.'),
  ev('e2', 'ZONE_COMPLETED', 1, '2026-10-01T06:20', 'Front Left Lawn completed watering at 06:20 AM for 20 minutes.'),
  ev('e3', 'ZONE_STARTED', 2, '2026-10-01T06:21', 'Front Right began watering at 06:21 AM for 20 minutes.'),
  ev('e4', 'ZONE_STOPPED', 2, '2026-10-01T06:28', 'Front Right stopped watering at 06:28 AM for 20 minutes.'),
  ev('e5', 'ZONE_STARTED', 3, '2026-10-01T06:30', 'Zone 3 began watering at 06:30 AM for 10 minutes.'),
  ev('e6', 'ZONE_COMPLETED', 3, '2026-10-01T06:40', 'Zone 3 completed watering at 06:40 AM for 10 minutes.'),
  { id: 'e7', type: 'SCHEDULE_STATUS', subType: 'SCHEDULE_COMPLETED', eventDate: at('2026-10-01', '06:41'), summary: 'Morning completed watering for 37 minutes.' },
  { id: 'e8', type: 'RAIN_DELAY', eventDate: at('2026-10-01', '07:00'), summary: 'Rain delay set for 24 hours.' },
];
const RUNS = I.parseRuns(EVENTS, DEVICE, RZ);

function ctx({ runs = RUNS, logs = [], settings = defaultSettings(), day, rachio = { zones: RZ } } = {}) {
  const c = {
    today: TODAY, now: at(TODAY), settings, zones: defaultZones(), products: defaultProducts(), logs, runs, rachio,
    weather: normalize(mockForecast({ today: TODAY, day }), at(TODAY)),
  };
  c.cond = E.conditions(c);
  c.feedings = Season.feedingSchedule(c);
  return c;
}

/* ---------- zones ---------- */

test('Rachio zones: nozzle rate and area when Rachio has them', () => {
  const [front, , zone3, back] = RZ;
  assert.deepEqual([front.id, front.number, front.name, front.rate, front.nozzle, front.sqft], ['rz1', 1, 'Front Left Lawn', 0.6, 'Rotor', 1300]);
  assert.equal(zone3.rate, null); // Rachio lists the nozzle but no rate
  assert.equal(back.rate, null);
});

test('zone matching: by name, then number, one-to-one; your pick wins', () => {
  const zones = defaultZones();
  const m = I.matchZones(RZ, zones);
  assert.deepEqual(m.rz1, { zoneId: 'z1', how: 'name' });
  assert.deepEqual(m.rz2, { zoneId: 'z2', how: 'name' });
  assert.deepEqual(m.rz3, { zoneId: 'z3', how: 'number' }); // "Zone 3" has no name to match; zone 3 is Side Left
  assert.deepEqual(m.rz5, { zoneId: 'z5', how: 'name' }); // "Back yard": Back Left or Back Right, number 5 breaks the tie
  assert.deepEqual(m.rz6, { zoneId: 'z6', how: 'name' });
  assert.deepEqual(m.rz7, { zoneId: null, how: 'none' });
  const fixed = I.matchZones(RZ, zones, { rz3: 'z4', rz7: 'none', rz1: 'gone-zone' });
  assert.deepEqual(fixed.rz3, { zoneId: 'z4', how: 'manual' });
  assert.deepEqual(fixed.rz7, { zoneId: null, how: 'manual' });
  assert.deepEqual(fixed.rz1, { zoneId: 'z1', how: 'name' }); // a pick for a deleted zone falls back to auto
  // A zone you picked isn't handed to another Rachio zone automatically.
  assert.equal(I.matchZones(RZ, zones, { rz7: 'z3' }).rz3.how, 'none');
  assert.ok(I.nameScore('Front Yard - Left', 'Front Left') === 1);
});

test('nozzle rate: Rachio, else yours, else the zone estimate until you enter one', () => {
  const s = defaultSettings();
  const side = defaultZones()[2];
  assert.deepEqual(I.zoneRate(RZ[0], s, side), { value: 0.6, source: 'rachio' });
  assert.deepEqual(I.zoneRate(RZ[2], s, side), { value: 1.5, source: 'estimate' });
  assert.deepEqual(I.zoneRate(RZ[2], s, null), { value: null, source: 'missing' });
  s.rachio.rates.rz3 = 1.2;
  assert.deepEqual(I.zoneRate(RZ[2], s, side), { value: 1.2, source: 'manual' });
  s.rachio.rates.rz1 = 2;
  assert.equal(I.zoneRate(RZ[0], s, side).value, 0.6); // Rachio's rate is the default
});

/* ---------- runs ---------- */

test('runs: actual minutes, stopped early, schedule and rain-delay events ignored', () => {
  assert.deepEqual(RUNS.map((r) => [r.id, r.zoneId, r.seconds / 60, r.stoppedEarly]), [
    ['rachio-e2', 'rz1', 20, false],
    ['rachio-e4', 'rz2', 7, true], // stopped after 7 of 20 scheduled minutes: counts 7
    ['rachio-e6', 'rz3', 10, false],
  ]);
  assert.equal(RUNS[1].planned, 1200);
  assert.equal(RUNS[0].date, '2026-10-01');
  assert.equal(RUNS[0].start, at('2026-10-01', '06:00'));
  // A stop that reports the scheduled time but has no start in the window falls back to what it reports.
  const lone = I.parseRuns([ev('x', 'ZONE_COMPLETED', 1, '2026-10-01T06:20', 'Front Left Lawn completed watering at 06:20 AM for 1 hour 5 minutes.')], DEVICE, RZ);
  assert.equal(lone[0].seconds, 3900);
  // Events without subType or zone data: zone from the summary, kind from the words.
  const plain = I.parseRuns([
    { eventDate: at('2026-10-01', '05:00'), summary: 'Back yard 2 began watering' },
    { eventDate: at('2026-10-01', '05:12'), summary: 'Back yard 2 completed watering' },
  ], DEVICE, RZ);
  assert.deepEqual(plain.map((r) => [r.zoneId, r.seconds]), [['rz6', 720]]);
  // Nothing to count: an end with no start and no duration, or a zone Rachio doesn't list.
  assert.equal(I.parseRuns([{ eventDate: at('2026-10-01'), summary: 'Back yard completed watering' }], DEVICE, RZ).length, 0);
  assert.equal(I.parseRuns([ev('y', 'ZONE_COMPLETED', 9, '2026-10-01T06:20', 'Pool completed watering for 5 minutes.')], DEVICE, RZ).length, 0);
});

test('runs: cycle and soak counts each cycle once, never the soak', () => {
  const runs = I.parseRuns([
    ev('c1', 'ZONE_STARTED', 3, '2026-10-01T06:00', 'Zone 3 began watering'),
    ev('c2', 'ZONE_CYCLING', 3, '2026-10-01T06:05', 'Zone 3 is soaking after 5 minutes'),
    ev('c3', 'ZONE_STARTED', 3, '2026-10-01T06:25', 'Zone 3 began watering'),
    ev('c4', 'ZONE_COMPLETED', 3, '2026-10-01T06:30', 'Zone 3 completed watering for 10 minutes.'),
    ev('c5', 'ZONE_CYCLING_COMPLETED', 3, '2026-10-01T06:30', 'Zone 3 completed all cycles for 10 minutes.'),
  ], DEVICE, RZ);
  assert.deepEqual(runs.map((r) => r.seconds / 60), [5, 5]);
});

test('saving runs: no duplicates by id or by the same zone ending within a minute', () => {
  const later = I.parseRuns([...EVENTS, ev('e9', 'ZONE_STARTED', 1, '2026-10-02T06:00', ''), ev('e10', 'ZONE_COMPLETED', 1, '2026-10-02T06:15', '')], DEVICE, RZ);
  const fresh = I.newRuns(RUNS, later);
  assert.deepEqual(fresh.map((r) => r.id), ['rachio-e10']);
  const sameRunNewId = { ...RUNS[0], id: 'rachio-other', end: RUNS[0].end + 20e3 };
  assert.deepEqual(I.newRuns(RUNS, [sameRunNewId]), []);
  assert.deepEqual(I.newRuns([], [RUNS[0], RUNS[0]]).length, 1);
  const otherZone = { ...RUNS[0], id: 'rachio-z2', zoneId: 'rz2' };
  assert.equal(I.newRuns([RUNS[0]], [otherZone]).length, 1);
});

/* ---------- water and cost ---------- */

test('run water: inches from the nozzle rate, gallons from area (or your measured flow)', () => {
  const info = I.zoneInfo(ctx());
  const front = I.runWater(RUNS[0], info.rz1);
  near(front.inches, 0.2); // 20 min at 0.6 in/hr
  near(front.gallons, 0.2 * 1250 * 0.623); // app zone area wins over Rachio's
  const stopped = I.runWater(RUNS[1], info.rz2);
  near(stopped.inches, 0.07);
  const side = I.runWater(RUNS[2], info.rz3);
  near(side.inches, 0.25); // Side Left's 1.5 in/hr estimate until you enter a rate
  const zones = defaultZones();
  zones[0] = { ...zones[0], gpm: 12, src: { ...zones[0].src, gpm: 'meas' } };
  const measured = I.zoneInfo({ ...ctx(), zones });
  near(I.runWater(RUNS[0], measured.rz1).gallons, 240); // 20 min × 12 gal/min
  assert.equal(I.runWater(RUNS[0], { rz: RZ[6], rate: { value: 0.5 }, appZone: null }).gallons, null);
});

test('water rate: your own rate replaces the tiers', () => {
  const s = defaultSettings();
  assert.equal(E.waterRateInfo(s, defaultZones()).per1000, 6.02);
  s.water.rateMode = 'custom';
  s.water.customRate = 8.5;
  s.water.sewerWinter = false;
  const r = E.waterRateInfo(s, defaultZones());
  assert.equal(r.custom, true);
  assert.equal(r.per1000, 8.5);
  s.water.customRate = 0; // no rate entered yet: tiers as usual
  assert.equal(E.waterRateInfo(s, defaultZones()).custom, false);
});

test('My Zones report: per zone and total gallons and cost, week and season', () => {
  const august = { ...RUNS[0], id: 'rachio-aug', date: '2026-08-10', start: at('2026-08-10', '06:00'), end: at('2026-08-10', '06:20') };
  const rep = I.rachioReport({ ...ctx(), runs: [...RUNS, august] }, 6);
  const front = rep.zones.find((z) => z.rz.id === 'rz1');
  assert.equal(front.week.runs, 1);
  assert.equal(front.season.runs, 2);
  near(front.season.gallons, 2 * 155.75, 0.1);
  near(front.season.cost, (2 * 155.75 * 6) / 1000, 0.001);
  assert.equal(rep.week.runs, 3);
  assert.equal(rep.season.runs, 4);
  near(rep.week.gallons, 155.75 + 54.51 + 124.6, 0.2);
  assert.equal(rep.runs[0].run.id, 'rachio-e6'); // newest first
  assert.equal(rep.runs[1].run.stoppedEarly, true);
  near(rep.runs[1].cost, (54.51 * 6) / 1000, 0.001);
  const drip = rep.zones.find((z) => z.rz.id === 'rz7');
  assert.equal(drip.match.how, 'none');
});

/* ---------- counted in the totals ---------- */

test('Rachio runs count in weekly watering, season totals, and the This Week call', () => {
  const none = E.waterWeek(ctx({ runs: [] }));
  assert.equal(none.rachio, false);
  const w = E.waterWeek(ctx());
  assert.equal(w.rachio, true);
  assert.equal(w.runs, 3);
  near(w.sprinklers, (0.2 * 1250 + 0.07 * 1250 + 0.25 * 800) / 7500, 0.001);
  near(w.logged, 0);
  near(w.gallons, 155.75 + 54.51 + 124.6, 0.2);
  near(w.cost, (w.gallons / 1000) * 6.02, 0.001);
  // Runs older than Rachio's 7-day window still count toward the season.
  const august = { ...RUNS[0], id: 'rachio-aug', date: '2026-08-10', start: at('2026-08-10', '06:00'), end: at('2026-08-10', '06:20') };
  const t = E.seasonTotals(ctx({ runs: [...RUNS, august] }), 2026);
  assert.equal(t.waterings, 4);
  assert.equal(t.rachioRuns, 4);
  near(t.waterGallons, 2 * 155.75 + 54.51 + 124.6, 0.2);
  // A soak on every lawn zone yesterday turns "water" into "skip".
  const soak = defaultZones().map((z, i) => ({
    id: `soak-${i}`, deviceId: 'd1', zoneId: ['rz1', 'rz2', 'rz3', 'rz4', 'rz5', 'rz6'][i], zoneNumber: i + 1, zoneName: z.name,
    start: at('2026-10-01', '06:00'), end: at('2026-10-01', '07:00'), date: '2026-10-01', seconds: 3600, planned: null, stoppedEarly: false,
  }));
  const rz = [...RZ.slice(0, 3), { id: 'rz4', deviceId: 'd1', number: 4, name: 'Side Right', enabled: true, rate: 1.5 }, ...RZ.slice(3)];
  assert.equal(E.thisWeek(ctx({ runs: [] })).advice.status, 'water');
  const wet = E.thisWeek(ctx({ runs: soak, rachio: { zones: rz } }));
  assert.equal(wet.advice.status, 'skip');
  assert.ok(wet.watered > 0.5, String(wet.watered));
});

test('a logged run that repeats a Rachio run counts once; hand watering still counts', () => {
  const zones = ['z1', 'z2'];
  const repeat = { id: 'l1', type: 'water', source: 'manual', date: '2026-10-01', at: at('2026-10-01'), zones, minutes: 20 };
  const all = E.allWatering(ctx({ logs: [repeat] }));
  const kept = all.find((l) => l.id === 'l1');
  assert.deepEqual(kept.zones, ['z2']); // Front Right ran only 7 minutes in Rachio, so that part of the log still counts
  const hand = { id: 'l2', type: 'water', source: 'manual', date: '2026-10-01', at: at('2026-10-01'), zones: ['z1'], minutes: 5 };
  assert.ok(E.allWatering(ctx({ logs: [hand] })).some((l) => l.id === 'l2'));
  const otherDay = { ...repeat, id: 'l3', date: '2026-09-30' };
  assert.deepEqual(E.allWatering(ctx({ logs: [otherDay] })).find((l) => l.id === 'l3').zones, zones);
  assert.deepEqual(I.loggedDuplicates([repeat, hand], I.rachioWaterings(ctx())), { l1: ['z1'] });
});
