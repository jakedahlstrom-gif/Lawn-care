// Unit tests for the fun layer: miles walked, streaks, trophies, dollar spot risk, heatmap, calendar export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  deckInches, mowMiles, longestWeekStreak, seasonStats, trophies, smithKerns, dollarSpot, riskLevel,
  activityByDay, heatmapHtml, buildIcs, heroMood, heroFxHtml,
} from '../js/fun.js';
import { defaultSettings, defaultZones, defaultProducts } from '../js/defaults.js';

const zones = defaultZones();
const all = zones.map((z) => z.id);
const mow = (date, extra = {}) => ({ id: `m${date}`, type: 'mow', date, zones: all, position: 5, height: 3.15, hours: 1, pattern: 0, ...extra });
const ctxWith = (logs, today = '2026-10-02') => ({
  today, now: Date.parse(`${today}T09:00:00-05:00`), logs, runs: [], waterings: [], zones, products: defaultProducts(), settings: defaultSettings(), weather: null,
});

test('deck width comes from the mower model, defaulting to 21″', () => {
  assert.equal(deckInches('EGO 21″ self-propelled'), 21);
  assert.equal(deckInches('Toro 30" TimeMaster'), 30);
  assert.equal(deckInches('Honda 21-inch HRX'), 21);
  assert.equal(deckInches('Ryobi 40V'), 21);
  assert.equal(deckInches(''), 21);
});

test('miles walked: lawn area over an 85% swath', () => {
  // 7,500 sq ft ÷ (21″ × 0.85 ÷ 12 ft) = 5,042 ft ≈ 0.955 mi.
  assert.ok(Math.abs(mowMiles(mow('2026-06-01'), zones, 21) - 0.955) < 0.005);
  // Two zones only.
  assert.ok(Math.abs(mowMiles(mow('2026-06-01', { zones: ['z1', 'z2'] }), zones, 21) - 0.318) < 0.005);
});

test('longest streak counts consecutive Monday-start weeks', () => {
  assert.equal(longestWeekStreak([]), 0);
  assert.equal(longestWeekStreak(['2026-05-03', '2026-05-09', '2026-05-16', '2026-05-30']), 3);
  assert.equal(longestWeekStreak(['2026-05-04', '2026-05-05']), 1);
});

test('season stats and trophies', () => {
  const logs = [];
  for (let i = 0; i < 12; i++) logs.push(mow(`2026-06-${String(1 + i * 2).padStart(2, '0')}`, { pattern: i % 4, height: i < 9 ? 3.15 : 2.75 }));
  logs.push({ id: 'f1', type: 'fert', date: '2026-04-20', zones: all, productId: 'p-scotts-halts', amount: 20, effects: { nLbs: 6 } });
  logs.push({ id: 'b1', type: 'other', kind: 'blowout', date: '2026-10-01', zones: [] });
  const s = seasonStats(ctxWith(logs), 2026);
  assert.equal(s.mows, 12);
  assert.equal(s.patternsUsed, 4);
  assert.equal(s.summerTall, 9);
  assert.equal(s.earlyPreventer, true);
  assert.equal(s.busiestMonth, 5);
  const t = Object.fromEntries(trophies(s).map((x) => [x.id, x]));
  assert.equal(t['first-cut'].earned, true);
  assert.equal(t['double-digits'].earned, true);
  assert.equal(t['quarter-century'].earned, false);
  assert.equal(t['stripe-master'].earned, true);
  assert.equal(t['early-bird'].earned, true);
  assert.equal(t['tall-proud'].earned, true);
  assert.equal(t['tucked-in'].value, 1);
  assert.equal(t['tucked-in'].earned, false);
  assert.ok(t['marathon'].pct > 0 && t['marathon'].pct < 1);
  // Logs from another year don't count.
  assert.equal(seasonStats(ctxWith(logs), 2025).mows, 0);
});

test('Smith–Kerns dollar spot model', () => {
  // 25°C, 85% RH: logit = −11.4041 + 0.1932·25 + 0.0894·85 = 1.0249 → 73.6%.
  assert.ok(Math.abs(smithKerns(77, 85).p - 0.736) < 0.002);
  // Below 10°C (50°F) the model doesn't apply.
  assert.equal(smithKerns(45, 90).p, 0);
  assert.equal(smithKerns(45, 90).active, false);
  assert.equal(riskLevel(0.05), 'low');
  assert.equal(riskLevel(0.15), 'watch');
  assert.equal(riskLevel(0.25), 'high');
  const hours = [];
  for (let d = 15; d <= 30; d++) for (let h = 0; h < 24; h++) hours.push({ t: `2026-07-${d}T${String(h).padStart(2, '0')}`, temp: 77, rh: 85 });
  const r = dollarSpot({ hours }, '2026-07-26');
  assert.equal(r.level, 'high');
  assert.ok(Math.abs(r.now.p - 0.736) < 0.002);
  assert.equal(r.trend.length, 8);
  assert.equal(dollarSpot({ hours: [] }, '2026-07-26'), null);
  // Not enough history: no reading rather than a made-up one.
  assert.equal(dollarSpot({ hours: hours.slice(-48) }, '2026-07-30'), null);
});

test('heatmap marks the strongest activity per day', () => {
  const logs = [mow('2026-06-01'), { id: 'f', type: 'fert', date: '2026-06-01', zones: all }, { id: 'p', type: 'pull', date: '2026-06-03', zones: [] }];
  const c = ctxWith(logs);
  assert.deepEqual(activityByDay(c, 2026), { '2026-06-01': 'fert', '2026-06-03': 'weed' });
  const html = heatmapHtml(c, 2026);
  assert.match(html, /class="hm hm-fert"/);
  assert.match(html, /2 active days/);
  assert.equal(heatmapHtml(ctxWith([]), 2026), '');
});

test('calendar export is valid iCalendar with all-day events', () => {
  const ics = buildIcs([{ uid: 'feed-x', start: '2026-10-10', end: '2026-10-25', title: 'Late-fall feeding, WinterGuard; 18.8 lb', notes: 'Line one\nLine two' }], new Date('2026-10-02T14:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261010\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261026\r\n/); // exclusive end
  assert.ok(ics.includes('SUMMARY:Late-fall feeding\\, WinterGuard\\; 18.8 lb\r\n'));
  assert.match(ics, /DESCRIPTION:Line one\\nLine two/);
  assert.match(ics, /DTSTAMP:20261002T140000Z/);
  assert.ok(ics.split('\r\n').every((l) => l.length <= 75));
});

test('hero ambience follows weather, then season and time of day', () => {
  assert.equal(heroMood({ code: 63, winter: false, today: '2026-07-01', hour: 12 }).fx, 'rain');
  assert.equal(heroMood({ code: 1, winter: true, today: '2026-01-10', hour: 12 }).fx, 'snow');
  assert.equal(heroMood({ code: 1, winter: false, today: '2026-10-02', hour: 12 }).fx, 'leaves');
  assert.equal(heroMood({ code: 1, winter: false, today: '2026-07-01', hour: 21 }).fx, 'fireflies');
  assert.equal(heroMood({ code: 1, winter: false, today: '2026-05-01', hour: 23 }).fx, 'stars');
  assert.equal(heroMood({ code: 1, winter: false, today: '2026-05-01', hour: 12 }).fx, null);
  assert.equal(heroMood({ code: 1, winter: false, today: '2026-05-01', hour: 19 }).tod, 'dusk');
  // Particles keep their place across re-renders: same clock phase → same delays.
  const a = heroFxHtml({ tod: 'day', fx: 'leaves' }, 1_000_000);
  const b = heroFxHtml({ tod: 'day', fx: 'leaves' }, 1_000_000 + 60_000);
  assert.notEqual(a, b);
  assert.equal((a.match(/<i /g) || []).length, 8);
});

test('current streak counts back from this week, or last week if this one has no mow yet', async () => {
  const { currentWeekStreak } = await import('../js/fun.js');
  // Fri Oct 2, 2026: weeks of Sep 28, Sep 21, Sep 14 mowed.
  assert.equal(currentWeekStreak(['2026-09-15', '2026-09-26', '2026-09-29'], '2026-10-02'), 3);
  // Nothing this week yet: still counts last week back.
  assert.equal(currentWeekStreak(['2026-09-15', '2026-09-26'], '2026-10-02'), 2);
  // A gap breaks it.
  assert.equal(currentWeekStreak(['2026-09-08', '2026-09-26'], '2026-10-02'), 1);
  assert.equal(currentWeekStreak([], '2026-10-02'), 0);
});
