// Core lawn logic: zones/products, water math, weather helpers, growth model, mowing, application timing,
// safety timers and totals. Pure functions only (no DOM). Dates are local 'YYYY-MM-DD' strings.
// Season planning (feeding windows, tasks, agenda, winter) lives in season.js.

import {
  addDays, daysBetween, dow, md, yearOf, clamp, round, sum, avg, fmtMonthDay, relDay, relDayLower,
  fmtNum, fmtUntil, WEEKDAYS_LONG, maxDate, dateStr,
} from './util.js';
import { OTHER_KINDS, LEGACY_KIND_LABELS, MOW_PATTERNS, shortName } from './defaults.js';

export const KC = 0.8; // crop coefficient for cool-season turf
export const SUN_FACTOR = { full: 1, partial: 0.85, shade: 0.7 };
const CYCLE_DEPTH = { flat: 0.25, moderate: 0.15, steep: 0.1 }; // inches a cycle can apply before runoff (clay loam)
const MAX_GROWTH = 0.22; // inches/day for irrigated bluegrass at optimum temperature (estimate)
const MULCH_N_PER_MOW = 0.04; // lb N / 1,000 sq ft returned per mulched mow (estimate)
const f0 = (n) => fmtNum(n, 0);

/* ======================= zones & products ======================= */

export const isLawn = (z) => z.lawn !== false;
export const lawnZones = (zones) => zones.filter(isLawn);
export const isSloped = (z) => !!z && !!z.slope && z.slope !== 'flat';
export const zoneArea = (zones, ids) => sum(zones.filter((z) => !ids || ids.includes(z.id)), (z) => z.sqft);
export const lawnArea = (zones, ids) => zoneArea(lawnZones(zones), ids);

export const ratePer1000 = (p) => (p && p.coverage > 0 ? (p.size / p.coverage) * 1000 : 0);
export const amountFor = (p, sqft) => (p && p.coverage > 0 ? (p.size * sqft) / p.coverage : 0);
export const nPer1000 = (p) => (p && p.unit === 'lb' ? (ratePer1000(p) * (p.n || 0)) / 100 : 0);
export function costPerLbN(p) {
  const n = p && p.unit === 'lb' ? (p.size * (p.n || 0)) / 100 : 0;
  return n > 0 && p.price > 0 ? p.price / n : null;
}
/** A spreader log that put nitrogen down counts as a feeding. */
export const isFeeding = (l) => l.type === 'fert' && ((l.effects?.nLbs || 0) > 0 || (l.n || 0) > 0);

/* ======================= water ======================= */

export const WEEKS_PER = { monthly: 4.345, bimonthly: 8.69, quarterly: 13.04 };

export function sortedTiers(tiers) {
  return [...tiers].sort((a, b) => (a.upTo == null ? 1 : b.upTo == null ? -1 : a.upTo - b.upTo));
}

/** Total water charge for `gal` gallons through tiered pricing. */
export function tierCost(gal, tiers) {
  let cost = 0;
  let prev = 0;
  for (const t of sortedTiers(tiers)) {
    const cap = t.upTo == null ? Infinity : t.upTo;
    const amt = Math.max(0, Math.min(gal, cap) - prev);
    cost += (amt / 1000) * t.rate;
    prev = cap;
    if (gal <= cap) break;
  }
  return cost;
}

export function tierIndex(gal, tiers) {
  const s = sortedTiers(tiers);
  for (let i = 0; i < s.length; i++) if (s[i].upTo == null || gal <= s[i].upTo) return i;
  return s.length - 1;
}

/** Gallons to put `inches` on a zone: runtime x flow when known, else area x 0.623. */
export function gallonsFor(z, inches) {
  if (z.precip > 0 && z.gpm > 0) return (inches / z.precip) * 60 * z.gpm;
  return (z.sqft || 0) * inches * 0.623;
}
export const runtimeFor = (z, inches) => (z.precip > 0 ? (inches / z.precip) * 60 : 0);

export function cycleSoak(z, minutes) {
  if (!isSloped(z) || !(z.precip > 0)) return null;
  const maxMin = (CYCLE_DEPTH[z.slope] / z.precip) * 60;
  const cycles = Math.max(minutes > 0 ? Math.ceil(minutes / maxMin - 1e-9) : 2, 2);
  return { maxMin, cycles, each: minutes > 0 ? minutes / cycles : maxMin };
}

export function weeklyIrrigationGallons(zones, inches) {
  return sum(zones, (z) => (isLawn(z)
    ? gallonsFor(z, inches * (SUN_FACTOR[z.sun] ?? 1))
    : (z.weeklyMinutes || 0) * (z.gpm || 0)));
}

/**
 * Which tier summer irrigation lands in, and the per-1,000 gal rate used for irrigation cost.
 * "Top tier reached" = the tier containing base use + a typical summer billing period of irrigation.
 */
export function waterRateInfo(settings, zones) {
  const w = settings.water;
  const tiers = sortedTiers(w.tiers);
  const weekly = weeklyIrrigationGallons(zones, w.summerInches || 0);
  const periodIrr = weekly * (WEEKS_PER[w.billing] || WEEKS_PER.monthly);
  const base = Math.max(0, w.baseUsage || 0);
  const total = base + periodIrr;
  const topIdx = tierIndex(total, tiers);
  const auto = w.rateMode === 'auto' || w.rateMode == null;
  const idx = auto ? topIdx : clamp(Number(w.rateMode) || 0, 0, tiers.length - 1);
  const rate = tiers[idx]?.rate || 0;
  const sewer = w.sewerWinter ? 0 : (w.sewerRate || 0);
  const blended = periodIrr > 0 ? ((tierCost(total, tiers) - tierCost(base, tiers)) / periodIrr) * 1000 : rate;
  return { idx, topIdx, auto, rate, sewer, per1000: round(rate + sewer, 4), weekly, periodIrr, base, total, blended, tiers };
}

/**
 * A manual watering run: inches and gallons from the zones' precipitation and flow rates.
 * Lawn inches are area-weighted across the lawn zones that ran.
 */
export function wateringCalc(zones, zoneIds, minutes, settings) {
  const sel = zones.filter((z) => zoneIds.includes(z.id));
  const rows = sel.map((z) => ({
    zone: z,
    inches: isLawn(z) && z.precip > 0 ? (minutes * z.precip) / 60 : null,
    gallons: minutes * (z.gpm || 0),
  }));
  const lawnRows = rows.filter((r) => r.inches != null);
  const area = sum(lawnRows, (r) => r.zone.sqft);
  const inches = area > 0 ? sum(lawnRows, (r) => r.inches * r.zone.sqft) / area : 0;
  const gallons = sum(rows, (r) => r.gallons);
  const rate = settings ? waterRateInfo(settings, zones) : null;
  return { rows, inches, gallons, cost: rate ? (gallons / 1000) * rate.per1000 : 0, rate };
}

/** Inches of watering spread over the whole lawn (a run on part of the lawn counts proportionally). */
export function lawnInchesFromLog(l, zones) {
  const total = lawnArea(zones);
  if (!(total > 0)) return 0;
  const sel = lawnZones(zones).filter((z) => (l.zones || []).includes(z.id) && z.precip > 0);
  return sum(sel, (z) => ((l.minutes || 0) * z.precip / 60) * z.sqft) / total;
}

/* ======================= weather helpers ======================= */

// Minneapolis–St. Paul normals by month: [high °F, low °F, rain in/day, ET0 in/day]
const CLIMO = {
  1: [23, 7, 0.03, 0.02], 2: [28, 12, 0.03, 0.03], 3: [41, 24, 0.06, 0.05], 4: [57, 36, 0.09, 0.11],
  5: [69, 48, 0.13, 0.16], 6: [79, 58, 0.15, 0.2], 7: [83, 63, 0.13, 0.21], 8: [80, 61, 0.14, 0.17],
  9: [72, 52, 0.11, 0.12], 10: [58, 39, 0.09, 0.07], 11: [42, 26, 0.05, 0.03], 12: [27, 12, 0.04, 0.02],
};

export function climo(date) {
  const m = Number(date.slice(5, 7));
  const d = Number(date.slice(8, 10));
  const other = d >= 15 ? (m % 12) + 1 : ((m + 10) % 12) + 1;
  const t = d >= 15 ? (d - 15) / 30 : (15 - d) / 30;
  const a = CLIMO[m];
  const b = CLIMO[other];
  const mix = (i) => a[i] + (b[i] - a[i]) * t;
  const hi = mix(0);
  const lo = mix(1);
  return { date, tMax: hi, tMin: lo, rain: mix(2), rainProb: 30, et0: mix(3), wind: 8, code: null, snow: 0, soil: (hi + lo) / 2, est: true };
}

/** Day rows from..to (inclusive), from the forecast when present, else climate normals. */
export function dayTable(weather, from, to) {
  const out = [];
  const map = weather?.dayMap || {};
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const w = map[d];
    if (w && w.tMax != null && w.tMin != null) {
      const c = climo(d);
      out.push({
        ...w,
        rain: w.rain ?? 0,
        rainProb: w.rainProb ?? (w.rain > 0.1 ? 60 : 10),
        et0: w.et0 ?? c.et0,
        soil: w.soil ?? (w.tMax + w.tMin) / 2,
        est: false,
      });
    } else out.push(climo(d));
  }
  return out;
}

export const hourKey = (ms, utcOffset) => new Date(ms + utcOffset * 1000).toISOString().slice(0, 13);

/** Index of the current hour in the hourly series (or the last hour if cached data ends within a day). */
export function hourIndexNow(weather, now) {
  if (!weather?.hours?.length) return null;
  const key = hourKey(now, weather.utcOffset || 0);
  const idx = weather.hourIndex?.[key];
  if (idx != null) return idx;
  const last = weather.hours.length - 1;
  if (key > weather.hours[last].t && daysBetween(weather.hours[last].t.slice(0, 10), key.slice(0, 10)) <= 1) return last;
  return null;
}

/** Average soil temperature (2.4″ depth) over the last 24 hours, °F. */
export function soilAvg24(weather, now) {
  const idx = hourIndexNow(weather, now);
  if (idx == null) return null;
  const vals = weather.hours.slice(Math.max(0, idx - 23), idx + 1).map((h) => h.soil).filter((v) => v != null);
  return vals.length >= 6 ? avg(vals) : null;
}

/** Local hour (0–23) at the lawn's location. */
export const localHour = (weather, now) => (weather?.utcOffset != null
  ? Number(hourKey(now, weather.utcOffset).slice(11, 13))
  : new Date(now).getHours());

/** Rain that has fallen from `from` (00:00) through the current hour. */
export function rainSoFar(weather, from, today, now) {
  if (!weather) return 0;
  const idx = hourIndexNow(weather, now);
  if (idx != null) {
    return sum(weather.hours.slice(0, idx + 1).filter((h) => h.t.slice(0, 10) >= from), (h) => h.rain);
  }
  return sum(dayTable(weather, from, addDays(today, -1)).filter((d) => !d.est), (d) => d.rain);
}

export function conditions({ weather, today, now }) {
  const next = dayTable(weather, today, addDays(today, 15));
  const past = dayTable(weather, addDays(today, -7), addDays(today, -1));
  const live = next.filter((d) => !d.est);
  const soil24 = soilAvg24(weather, now);
  const highs5 = avg(next.slice(0, 5).map((d) => d.tMax));
  return {
    hasWeather: live.length > 0,
    soil24,
    next,
    past,
    highs5,
    maxHigh7: Math.max(...next.slice(0, 7).map((d) => d.tMax)),
    hardFreeze: live.slice(0, 10).find((d) => d.tMin <= 28) || null,
    frost: live.slice(0, 10).find((d) => d.tMin <= 32) || null,
    pastHardFreeze: past.find((d) => !d.est && d.tMin <= 28) || null,
    frozen: soil24 != null && soil24 <= 32,
    rainPast7: sum(past, (d) => d.rain),
    etPast7: sum(past, (d) => d.et0) * KC,
    rainNext7: sum(next.slice(0, 7), (d) => d.rain),
    etNext7: sum(next.slice(0, 7), (d) => d.et0) * KC,
    soilReach: (target) => next.slice(1).find((d) => !d.est && d.soil != null && d.soil >= target) || null,
  };
}

/* ======================= logs ======================= */

const byDateDesc = (a, b) => (a.date === b.date ? (b.at || 0) - (a.at || 0) : a.date < b.date ? 1 : -1);
export const sortLogs = (logs) => [...logs].sort(byDateDesc);

export function lastMow(logs, today) {
  return sortLogs(logs.filter((l) => l.type === 'mow' && l.date <= today))[0] || null;
}

export const mowingHours = (logs) => sum(logs.filter((l) => l.type === 'mow'), (l) => l.hours);

/** +1 when a note says the grass was long/fast, -1 when it barely grew, 0 otherwise. */
export function noteSentiment(text) {
  const t = ` ${String(text || '').toLowerCase().replace(/[’']/g, '')} `;
  if (!t.trim()) return 0;
  if (/\b(not|wasnt|isnt|never|wasn t)\s+(very |too |that |really |so )?(long|tall|overgrown|bad|much)\b/.test(t)) return -1;
  const slow = /\b(barely|hardly|slow|slowly|short|didnt grow|did not grow|no growth|not much|little growth|few clippings|light clippings|minimal|could have skipped|didnt need|did not need|not needed|dormant|sparse)\b/;
  const fast = /\b(long|tall|overgrown|shaggy|thick|clumps?|clumping|clumped|grew a lot|grew fast|fast growth|lots of clippings|lot of clippings|heavy clippings|jungle|bag(ged)? full|needed it)\b/;
  const s = slow.test(t);
  const fs = fast.test(t);
  if (s && !fs) return -1;
  if (fs && !s) return 1;
  return 0;
}

/** Growth multiplier learned from mow notes, recent notes weighted most. */
export function growthCalibration(logs, today) {
  let total = 0;
  let count = 0;
  for (const l of logs) {
    if (l.type !== 'mow' || !l.notes) continue;
    const age = daysBetween(l.date, today);
    if (age < 0 || age > 400) continue;
    const s = noteSentiment(l.notes);
    if (!s) continue;
    count++;
    total += s * Math.exp(-age / 120);
  }
  return { factor: clamp(1 + 0.1 * total, 0.6, 1.6), count };
}

export function growthPotential(tMeanF) {
  const c = ((tMeanF - 32) * 5) / 9;
  return Math.exp(-0.5 * ((c - 20) / 5.5) ** 2);
}

function growthModel(table, logs, zones, calib) {
  const index = {};
  table.forEach((d, i) => { index[d.date] = i; });
  const feedDates = logs.filter((l) => (l.effects?.nLbs || 0) > 0).map((l) => l.date);
  const watered = {};
  for (const l of logs) if (l.type === 'water') watered[l.date] = (watered[l.date] || 0) + lawnInchesFromLog(l, zones);
  const daily = (date) => {
    const i = index[date];
    if (i == null) return 0;
    const d = table[i];
    let g = MAX_GROWTH * growthPotential((d.tMax + d.tMin) / 2);
    if (d.tMax >= 90) g *= 0.6;
    else if (d.tMax >= 85) g *= 0.8;
    const w = table.slice(Math.max(0, i - 6), i + 1);
    const water = sum(w, (x) => x.rain + (watered[x.date] || 0));
    const et = sum(w, (x) => x.et0) * KC;
    g *= clamp(0.85 + 0.3 * (water / Math.max(et, 0.2)), 0.85, 1.15);
    if (feedDates.some((fd) => { const n = daysBetween(fd, date); return n >= 3 && n <= 28; })) g *= 1.2;
    const m = md(date);
    if (m >= 420 && m <= 610) g *= 1.15; // spring flush
    return g * calib;
  };
  return {
    daily,
    between: (a, b) => { let t = 0; for (let d = addDays(a, 1); d <= b; d = addDays(d, 1)) t += daily(d); return t; },
  };
}

/* ======================= mowing ======================= */

export function positionsByHeight(heights) {
  return heights.map((h, i) => ({ pos: i + 1, h: Number(h) })).sort((a, b) => a.h - b.h);
}
export function nearestPosition(heights, target) {
  let best = null;
  for (const p of positionsByHeight(heights)) {
    const d = Math.abs(p.h - target);
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) < 1e-9 && p.h > best.h)) best = { ...p, d };
  }
  return best.pos;
}
export function positionAtLeast(heights, min) {
  const s = positionsByHeight(heights);
  return (s.find((p) => p.h >= min - 0.01) || s[s.length - 1]).pos;
}

/** Stripe direction for the next mow: one step past the last logged mow's direction. */
export function nextPattern(logs, today) {
  const mows = sortLogs(logs.filter((l) => l.type === 'mow' && (!today || l.date <= today)));
  if (!mows.length) return 0;
  const last = mows[0];
  if (Number.isInteger(last.pattern)) return (last.pattern + 1) % MOW_PATTERNS.length;
  return mows.length % MOW_PATTERNS.length;
}

export function patternText(id) {
  const p = MOW_PATTERNS[id] || MOW_PATTERNS[0];
  return `Front yard: stripes ${p.label.toLowerCase()}. Side Left and Side Right: always mow across the slope.`;
}

export function seasonInfo(date, cond, logs) {
  const m = md(date);
  const y = yearOf(date);
  const mows = logs.filter((l) => l.type === 'mow' && yearOf(l.date) === y && l.date <= date);
  const finalMow = mows.find((l) => l.final);
  if (m < 315 || m >= 1201) {
    return { key: 'winter', off: true, label: 'Off season', reason: 'Mowing starts again when the grass greens up in spring.' };
  }
  if (finalMow && date > finalMow.date) {
    return { key: 'done', off: true, label: 'Season wrapped', reason: `Final mow logged ${fmtMonthDay(finalMow.date)}. Next mow comes at spring green-up.` };
  }
  if (m < 501 && !mows.length && (cond.soil24 == null ? m < 415 : cond.soil24 < 45)) {
    return {
      key: 'greenup', off: true, label: 'Waiting for green-up',
      reason: cond.soil24 == null
        ? 'First mow usually comes in late April, once grass reaches about 4″.'
        : `Soil is ${f0(cond.soil24)}°F. The first mow usually comes once soil holds ~50°F and grass reaches about 4″.`,
    };
  }
  let key = m < 601 ? 'spring' : m < 901 ? 'summer' : 'fall';
  let target = 3.0;
  let heat = false;
  let final = false;
  if (cond.highs5 >= 88) { target = 4.0; heat = true; } else if (cond.highs5 >= 82) { target = 3.5; heat = true; }
  if (m >= 1010) {
    const mean7 = avg(cond.next.slice(0, 7).map((d) => (d.tMax + d.tMin) / 2));
    if (m >= 1101 || mean7 < 45 || (cond.soil24 != null && cond.soil24 < 45)) {
      key = 'final'; target = 2.5; heat = false; final = true;
    }
  }
  const labels = { spring: 'Spring', summer: heat ? 'Summer heat' : 'Summer', fall: 'Fall', final: 'Final mow' };
  return { key, off: false, target, heat, final, label: heat && key !== 'summer' ? `${labels[key]} · heat` : labels[key] };
}

export function weatherScore(day, prev) {
  let s = 0;
  const flags = [];
  if (day.rain >= 0.15 || day.rainProb >= 60) { s -= 4; flags.push('wet'); } else if (day.rain >= 0.04 || day.rainProb >= 40) { s -= 1.5; flags.push('showers'); }
  if (prev && prev.rain >= 0.5) { s -= 3; flags.push('soggy'); } else if (prev && prev.rain >= 0.2) { s -= 1.5; flags.push('damp'); }
  if (day.tMax >= 90) { s -= 3; flags.push('hot'); } else if (day.tMax >= 85) { s -= 1.5; flags.push('warm'); }
  if (day.tMax < 45) s -= 1;
  if (day.est) s -= 0.3;
  return { score: s, flags };
}

function weatherPhrase(day, prev) {
  if (day.est) return 'your usual mow day (no forecast yet)';
  const hi = `${f0(day.tMax)}°`;
  if (day.rain >= 0.15 || day.rainProb >= 60) return `the driest option (${fmtNum(day.rain, 2)}″ rain, ${hi})`;
  if (day.tMax >= 85) return `dry but hot (${hi}) — mow in the evening`;
  if (prev && prev.rain >= 0.2) return `dry after ${fmtNum(prev.rain, 2)}″ rain the day before (${hi})`;
  if (day.rainProb >= 40) return `mostly dry (${f0(day.rainProb)}% showers, ${hi})`;
  return `dry, ${hi}`;
}

function activeTimer(logs, now, kind) {
  let best = null;
  for (const l of logs) for (const t of l.effects?.timers || []) {
    if (t.kind === kind && t.until > now && (!best || t.until > best.until)) best = { ...t, log: l };
  }
  return best;
}

/**
 * Next mow: day, mower position, height, stripe direction and a one-line reason.
 * Picks the best-weather day near the weekly cadence, favoring preferred days, and keeps each cut within the one-third rule.
 */
export function mowRecommendation(ctx) {
  const { today, now, logs, settings, weather, zones } = ctx;
  const cond = ctx.cond || conditions(ctx);
  const heights = settings.mower.heights.map(Number);
  const maxH = Math.max(...heights);
  const cadence = clamp(Math.round(settings.mowing.cadenceDays || 7), 3, 21);
  const pref = settings.mowing.preferredDays || [];
  const season = seasonInfo(today, cond, logs);
  const slopedZones = lawnZones(zones).filter(isSloped);
  const shadeZones = lawnZones(zones).filter((z) => z.sun === 'shade');
  const pattern = nextPattern(logs, today);
  if (season.off) return { status: 'off', season, title: season.label, reason: season.reason, pattern };

  const last = lastMow(logs, today);
  const calib = growthCalibration(logs, today);
  const tableStart = addDays(last ? (last.date < addDays(today, -30) ? addDays(today, -30) : last.date) : today, -8);
  const table = dayTable(weather, tableStart, addDays(today, 18));
  const byDate = Object.fromEntries(table.map((d) => [d.date, d]));
  const growth = growthModel(table, logs, zones, calib.factor);
  const lastH = last ? (last.height ?? heights[(last.position || 5) - 1]) : season.target;
  const growthTo = (d) => (last ? growth.between(maxDate(last.date, addDays(today, -30)), d) : 0);

  const noMow = activeTimer(logs, now, 'noMow');
  const blockedThrough = noMow ? dateStr(new Date(noMow.until - 1)) : null;
  const hour = localHour(weather, now);
  const ideal = last ? maxDate(addDays(last.date, cadence), today) : today;
  let from = today;
  if (last && daysBetween(last.date, today) < 3) from = addDays(last.date, 3);
  if (blockedThrough && from <= blockedThrough) from = addDays(blockedThrough, 1);
  const end = [addDays(ideal, 3), addDays(from, 6)].sort()[1];
  const limit = addDays(today, 9);

  const score = (d, target = ideal) => {
    const day = byDate[d];
    const prev = byDate[addDays(d, -1)];
    const w = weatherScore(day, prev);
    let s = w.score;
    if (pref.length && pref.includes(dow(d))) s += 2.5;
    s -= 0.5 * Math.abs(daysBetween(target, d));
    if (d === today && hour >= 19) s -= 3;
    return { date: d, day, prev, s, flags: w.flags, preferred: pref.includes(dow(d)) };
  };
  const pick = (a, b, target = ideal) => {
    const c = [];
    for (let d = a; d <= b && d <= limit; d = addDays(d, 1)) c.push(score(d, target));
    return c.sort((x, y) => y.s - x.s || (x.date < y.date ? -1 : 1))[0] || null;
  };

  let best = pick(from, end);
  if (!best) best = score(from);

  const heightFor = (date) => {
    const G = last ? growthTo(date) : 0;
    const pre = lastH + G;
    const required = last ? (pre * 2) / 3 : 0;
    let pos = nearestPosition(heights, season.target);
    let note = null;
    if (heights[pos - 1] < required - 0.01) {
      pos = positionAtLeast(heights, required);
      note = lastH > season.target + 0.01 && heights[pos - 1] < lastH ? 'stepdown' : 'raised';
    }
    return { G, pre, required, pos, h: heights[pos - 1], note, overMax: required > maxH + 0.01 };
  };

  let status = 'mow';
  let plan = heightFor(best.date);
  let skip = null;

  // Slow growth: skip this week and look again a cadence later. Judge growth at the later of the
  // cadence date and the chosen day, so an early pick forced by rain isn't mistaken for slow growth.
  const skipGrowth = last ? growthTo(maxDate(ideal, best.date)) : 0;
  if (last && !season.final && skipGrowth < 0.5 && lastH + skipGrowth <= season.target + 0.6) {
    status = 'skip';
    const nextIdeal = addDays(ideal, cadence);
    const nextDate = pref.length ? nearestPreferred(nextIdeal, pref) : nextIdeal;
    skip = { growth: skipGrowth, nextDate };
    plan = heightFor(nextDate);
  }

  // Unusually fast growth: offer an optional extra mid-week mow.
  let extra = null;
  if (last && status === 'mow') {
    const weekGrowth = growthTo(addDays(last.date, cadence));
    if ((weekGrowth > 2.0 || ((lastH + weekGrowth) * 2) / 3 > maxH + 0.01) && daysBetween(last.date, best.date) >= 5) {
      const e = pick(maxDate(today, addDays(last.date, 3)), addDays(best.date, -2));
      if (e && e.date < best.date) {
        const eh = heightFor(e.date);
        extra = {
          date: e.date, pos: eh.pos, h: eh.h, growth: weekGrowth,
          reason: `Fast growth (~${fmtNum(weekGrowth, 1)}″/week). An optional extra mow ${relDayLower(e.date, today)} keeps each cut under ⅓.`,
        };
      }
    }
  }

  // One-line reason.
  const dayName = daysBetween(today, best.date) >= 7 ? WEEKDAYS_LONG[dow(best.date)] : relDay(best.date, today);
  let reason;
  if (status === 'skip') {
    const meanT = avg(table.filter((x) => x.date > last.date && x.date <= ideal).map((x) => (x.tMax + x.tMin) / 2)) ?? 60;
    const why = season.heat ? 'Heat has slowed growth' : meanT < 52 ? 'Cool weather has slowed growth' : 'Slow growth';
    reason = `${why}: only ~${growthText(skip.growth)} since the ${fmtMonthDay(last.date)} mow. Skip this week; check again ${relDayLower(skip.nextDate, today)}.`;
  } else {
    const prefWet = pref.length && !best.preferred && best.flags.length === 0 && !best.day.est;
    const prefix = prefWet
      ? `Your usual days look wet; ${dayName.toLowerCase()} is ${weatherPhrase(best.day, best.prev)}.`
      : `${dayName} is ${weatherPhrase(best.day, best.prev)}.`;
    if (!last) reason = `${prefix} No mows logged yet — log this one to start growth tracking.`;
    else {
      let tail = ` ~${growthText(plan.G)} of growth since the ${fmtMonthDay(last.date)} mow.`;
      if (plan.note === 'raised') tail += ` Raised to ${plan.h}″ to stay within ⅓.`;
      if (plan.note === 'stepdown') tail += ` Stepping down toward ${season.target}″ without cutting more than ⅓.`;
      if (plan.overMax) tail += ' Even the top setting can’t keep this cut under ⅓.';
      reason = prefix + tail;
    }
  }

  const notes = [];
  if (season.heat && slopedZones.length) {
    const sp = positionAtLeast(heights, Math.min(plan.h + 0.4, maxH));
    if (heights[sp - 1] > plan.h + 0.01) notes.push(`Sloped ${slopedZones.map((z) => z.name).join(' & ')}: raise to position ${sp} (${heights[sp - 1]}″) in this heat — slopes dry out first.`);
    else notes.push(`Sloped ${slopedZones.map((z) => z.name).join(' & ')}: keep at the top setting in this heat — slopes dry out first.`);
  } else if (slopedZones.length && best.flags.some((x) => x === 'damp' || x === 'soggy' || x === 'wet')) {
    notes.push(`Mow ${slopedZones.map((z) => z.name).join(' & ')} last, across the slope, once they dry.`);
  }
  if (shadeZones.length) {
    const sp = positionAtLeast(heights, Math.min(plan.h + 0.4, maxH));
    notes.push(`Shady ${shadeZones.map((z) => z.name).join(' & ')}: position ${sp} (${heights[sp - 1]}″).`);
  }
  if (season.final && status === 'mow') notes.push('Final mow of the year: lower gradually to ~2.5″ to discourage snow mold and voles.');

  const shownDate = skip ? skip.nextDate : best.date;
  return {
    status,
    season,
    date: shownDate,
    dayLabel: daysBetween(today, shownDate) >= 7 ? WEEKDAYS_LONG[dow(shownDate)] : relDay(shownDate, today),
    position: plan.pos,
    height: plan.h,
    target: season.target,
    growth: plan.G,
    lastDate: last?.date || null,
    lastHeight: last ? lastH : null,
    reason,
    extra,
    notes,
    calibration: calib,
    final: season.final,
    pattern,
  };
}

/** Preferred weekday closest to `date` (earlier wins a tie). */
function nearestPreferred(date, pref) {
  for (let i = 0; i < 4; i++) {
    for (const d of [addDays(date, -i), addDays(date, i)]) if (pref.includes(dow(d))) return d;
  }
  return date;
}

const growthText = (g) => (g < 0.1 ? '0.1″' : `${fmtNum(g, 1)}″`);

/* ======================= application timing ======================= */

export const SPRAY_RULES = { minHigh: 50, maxHigh: 85, maxWind: 10, dryHours: 24 };

/**
 * Rate the next days for spreading or spot spraying a product, using hourly rain.
 * Granular: avoid heavy rain during the no-rain window (stricter on slopes); light rain after is good.
 * Spot spray: highs 50–85°F, wind under 10 mph, no rain for 24 hours.
 */
export function applicationWindow({ weather, product, zoneIds = [], zones, today, now, kind, days = 7 }) {
  const selected = zones.filter((z) => zoneIds.includes(z.id));
  const sloped = selected.some(isSloped);
  const type = kind || product?.type || 'fertilizer';
  const spray = type === 'weed';
  let hours = product?.noRainHours > 0 ? product.noRainHours : 24;
  if (spray) hours = Math.max(SPRAY_RULES.dryHours, hours);
  else if (sloped) hours = Math.max(48, hours * 2);
  const heavy = sloped ? 0.3 : 0.5;
  const base = { sloped: !spray && sloped, hours, heavy, type, days: [], best: null };
  if (!weather?.hours?.length) return { ...base, available: false, summary: 'No forecast available — check the rain forecast before applying.' };

  const hourNow = localHour(weather, now);
  const rainFrom = (startIdx, n) => {
    const slice = weather.hours.slice(startIdx, startIdx + n);
    return { total: sum(slice, (h) => h.rain), hours: slice.length };
  };
  const max24 = (startIdx, n) => {
    let m = 0;
    for (let i = startIdx; i < startIdx + n && i < weather.hours.length; i++) m = Math.max(m, rainFrom(i, Math.min(24, startIdx + n - i)).total);
    return m;
  };

  for (let i = 0; i < days; i++) {
    const date = addDays(today, i);
    const day = weather.dayMap?.[date];
    if (!day) continue;
    let startHour = 10;
    if (i === 0) {
      if (hourNow >= 18) { base.days.push({ date, rating: 'avoid', note: 'Too late today' }); continue; }
      startHour = Math.max(10, hourNow + 1);
    }
    const idx = weather.hourIndex?.[`${date}T${String(startHour).padStart(2, '0')}`];
    if (idx == null) continue;
    const win = rainFrom(idx, hours);
    const peak = max24(idx, hours);
    const after3 = rainFrom(idx, 72).total;
    const coverageShort = win.hours < hours;
    let rating = 'good';
    let note;
    if (spray) {
      const wind = day.wind ?? 0;
      if (win.total >= 0.02) { rating = 'avoid'; note = `Rain within ${hours} h would wash it off`; } else if (wind >= SPRAY_RULES.maxWind) { rating = 'avoid'; note = `Windy (${f0(wind)} mph) — spray drifts`; } else if (day.tMax > SPRAY_RULES.maxHigh) { rating = 'avoid'; note = `Too hot (${f0(day.tMax)}°F) — can injure the grass`; } else if (day.tMax < SPRAY_RULES.minHigh) { rating = 'avoid'; note = `Too cool (${f0(day.tMax)}°F) — weeds won't take it up`; } else { note = `${f0(day.tMax)}°, ${f0(wind)} mph wind, dry ${hours} h`; }
    } else if (peak >= heavy) { rating = 'avoid'; note = `${fmtNum(peak, 2)}″ heavy rain within ${hours} h${sloped ? ' (sloped zones)' : ''}`; } else if (day.tMax >= 88) { rating = 'avoid'; note = `Too hot (${f0(day.tMax)}°F)`; } else if (day.tMin <= 28 && md(date) >= 1001) { rating = 'avoid'; note = 'Hard freeze — never spread on frozen ground'; } else if (win.total >= 0.1) { rating = 'ok'; note = `${fmtNum(win.total, 2)}″ light rain within ${hours} h — fine if it stays light`; } else if (after3 >= 0.1 && after3 < heavy) { note = `Dry, then ${fmtNum(after3, 2)}″ light rain to water it in`; } else { note = 'Dry — water in with about ¼″ afterward'; }
    if (coverageShort && rating === 'good') note += ' (forecast ends before the window does)';
    base.days.push({ date, rating, note });
  }

  const best = base.days.find((d) => d.rating === 'good') || base.days.find((d) => d.rating === 'ok') || null;
  base.best = best;
  const avoid = base.days.filter((d) => d.rating === 'avoid' && d.note !== 'Too late today');
  let summary;
  if (!best) summary = 'No good day in the next week — hold off.';
  else {
    summary = `Best day: ${relDay(best.date, today)}. ${best.note}.`;
    const bad = avoid.find((d) => d.date > best.date) || avoid[0];
    if (bad) summary += ` Avoid ${relDayLower(bad.date, today)}: ${bad.note.charAt(0).toLowerCase()}${bad.note.slice(1)}.`;
  }
  return { ...base, available: true, summary };
}

/**
 * Good day to pull weeds: soil softened by rain (or watering) in the last two days, and not pouring today.
 */
export function pullDay(weather, date, logs = [], zones = []) {
  const t = dayTable(weather, addDays(date, -2), date);
  const [d2, d1, d0] = t;
  const watered = (d) => sum(logs.filter((l) => l.type === 'water' && l.date === d), (l) => lawnInchesFromLog(l, zones));
  const recent = (d1.est ? 0 : d1.rain) + watered(d1.date) + 0.5 * ((d2.est ? 0 : d2.rain) + watered(d2.date));
  const sameDay = d0.est ? 0 : d0.rain;
  if (d0.tMax < 40) return { good: false, soft: false, note: 'Ground is cold or frozen' };
  if (sameDay >= 0.3) return { good: false, soft: true, note: 'Raining — wait until it lets up' };
  if (recent >= 0.25) return { good: true, soft: true, note: `Soft soil after ${fmtNum(recent, 2)}″ of rain — roots come out whole` };
  return { good: false, soft: false, note: 'Soil is firm — easier after a rain' };
}

/** Lawn verdicts for a forecast day: mowing, spot spraying, pulling weeds, feeding, plus frost risk. */
export function dayVerdicts(ctx, date) {
  const { weather, zones, logs, products, today, now } = ctx;
  const t = dayTable(weather, addDays(date, -1), date);
  const [prev, day] = t;
  const w = weatherScore(day, prev);
  const mowOk = w.score > -1.6 && day.tMax >= 45 && !w.flags.includes('wet') && !w.flags.includes('soggy');
  let mow;
  if (day.tMax < 45) mow = { ok: false, text: 'Too cold — grass isn’t growing' };
  else if (w.flags.includes('wet')) mow = { ok: false, text: 'Wet — skip mowing' };
  else if (w.flags.includes('soggy')) mow = { ok: false, text: 'Soggy after heavy rain' };
  else if (w.flags.includes('hot')) mow = { ok: false, text: 'Very hot — mow in the evening if you must' };
  else mow = { ok: mowOk, text: mowOk ? 'Good mow day' : 'Fair — damp or showery' };

  const sprayP = products.find((p) => p.type === 'weed') || { noRainHours: 24, type: 'weed' };
  const allIds = lawnZones(zones).map((z) => z.id);
  const n = daysBetween(today, date);
  let spray = { ok: false, text: 'No forecast for spraying' };
  let feed = { ok: false, text: 'No forecast' };
  if (n >= 0 && n < 14) {
    const sw = applicationWindow({ weather, product: sprayP, zoneIds: allIds, zones, today, now, kind: 'weed', days: n + 1 });
    const sd = sw.days.find((d) => d.date === date);
    if (sd) spray = sd.rating === 'good' ? { ok: true, text: 'Good for spot spraying' } : { ok: false, text: sd.note };
    const fw = applicationWindow({ weather, product: { noRainHours: 24, type: 'fertilizer' }, zoneIds: allIds, zones, today, now, kind: 'fertilizer', days: n + 1 });
    const fd = fw.days.find((d) => d.date === date);
    if (fd) feed = fd.rating === 'avoid' ? { ok: false, text: `Hold off on feeding: ${fd.note.charAt(0).toLowerCase()}${fd.note.slice(1)}` } : { ok: true, text: 'Fine for feeding' };
  }
  const p = pullDay(weather, date, logs, zones);
  const pull = { ok: p.good, text: p.good ? 'Good for pulling weeds' : p.note };
  let frost;
  if (day.tMin <= 28) frost = { level: 'hard', text: `Hard freeze (${f0(day.tMin)}°F)` };
  else if (day.tMin <= 32) frost = { level: 'frost', text: `Frost likely (${f0(day.tMin)}°F)` };
  else if (day.tMin <= 36) frost = { level: 'possible', text: `Patchy frost possible (${f0(day.tMin)}°F)` };
  else frost = { level: 'none', text: 'No frost risk' };
  return { mow, spray, pull, feed, frost };
}

/* ======================= timers ======================= */

export function computeTimers(log, product, zones) {
  const at = log.at || Date.now();
  const timers = [];
  if (!product) return timers;
  const sloped = zones.filter((z) => (log.zones || []).includes(z.id)).some(isSloped);
  const granular = product.type !== 'weed';
  if (product.keepOffHours > 0) timers.push({ kind: 'keepOff', until: at + product.keepOffHours * 3600e3 });
  let nr = product.noRainHours || 0;
  if (nr > 0 && granular && sloped) nr = Math.max(48, nr * 2);
  if (nr > 0) timers.push({ kind: 'noRain', until: at + nr * 3600e3, granular, sloped: granular && sloped });
  if (product.noMowDays > 0) timers.push({ kind: 'noMow', until: at + product.noMowDays * 86400e3 });
  return timers;
}

export function activeTimers(logs, now) {
  const out = [];
  for (const kind of ['keepOff', 'noMow', 'noRain']) {
    const t = activeTimer(logs, now, kind);
    if (!t) continue;
    const when = fmtUntil(t.until, now);
    let text;
    if (kind === 'keepOff') text = `Keep kids and pets off until ${when}`;
    else if (kind === 'noMow') text = `No mowing until ${when}`;
    else if (t.granular) text = `Water in lightly (about ¼″), then no heavy watering until ${when}${t.sloped ? ' — sloped zones' : ''}`;
    else text = `Keep sprinklers off until ${when} so the spray can dry`;
    out.push({ kind, until: t.until, text, product: t.log.productName });
  }
  return out;
}

/* ======================= watering ======================= */

/**
 * Water the lawn received over the past 7 days: rainfall from the weather data plus manually logged
 * watering. Gallons and cost come from the zones' flow rates and the water rate tiers.
 */
export function waterWeek(ctx) {
  const { today, now, settings, zones, logs, weather } = ctx;
  const from = addDays(today, -6);
  const rain = rainSoFar(weather, from, today, now);
  const runs = logs.filter((l) => l.type === 'water' && l.date >= from && l.date <= today);
  const watered = sum(runs, (l) => lawnInchesFromLog(l, zones));
  const gallons = sum(runs, (l) => wateringCalc(zones, l.zones || [], l.minutes || 0).gallons);
  const rate = waterRateInfo(settings, zones);
  const cond = ctx.cond || conditions(ctx);
  return {
    total: rain + watered,
    rain,
    watered,
    runs: runs.length,
    gallons,
    cost: (gallons / 1000) * rate.per1000,
    rate,
    used: cond.etPast7,
    hasWeather: !!weather,
    rachio: false,
  };
}

/* ======================= this week ======================= */

// Water once the lawn is short by half of what it used this week (at least 0.3″), and never more than 1″ at a time:
// bluegrass roots in clay loam hold about 1″ the grass can use, so more just drains past them or runs off.
const WATER_TRIGGER = { share: 0.5, min: 0.3 };
const MAX_SOAK = 1.0;
const quarterInch = (n) => clamp(Math.round(n * 4) / 4, 0.25, MAX_SOAK);

/** Reference evapotranspiration (ET0) from `from` (00:00) through the current hour: hourly when available, else daily. */
export function et0SoFar(weather, from, today, now) {
  if (!weather) return 0;
  const idx = hourIndexNow(weather, now);
  if (idx != null) {
    const hrs = weather.hours.slice(0, idx + 1).filter((h) => h.t.slice(0, 10) >= from);
    if (hrs.length && hrs.every((h) => h.et0 != null)) return sum(hrs, (h) => h.et0);
  }
  const share = clamp((localHour(weather, now) - 6) / 14, 0, 1); // most ET happens 6 AM–8 PM
  return sum(dayTable(weather, from, addDays(today, -1)), (d) => d.et0) + dayTable(weather, today, today)[0].et0 * share;
}

/** Forecast rain over the next `hours` hours: total inches, the chance of the rainy hours, and the wettest day. */
export function rainAhead(weather, today, now, hours = 72) {
  const idx = hourIndexNow(weather, now);
  const rows = idx != null
    ? weather.hours.slice(idx + 1, idx + 1 + hours).map((h) => ({ date: h.t.slice(0, 10), rain: h.rain, pop: h.pop }))
    : dayTable(weather, today, addDays(today, Math.ceil(hours / 24) - 1)).filter((d) => !d.est).map((d) => ({ date: d.date, rain: d.rain, pop: d.rainProb }));
  const byDay = {};
  for (const r of rows) byDay[r.date] = (byDay[r.date] || 0) + r.rain;
  const wettest = Object.entries(byDay).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  const pops = rows.filter((r) => r.rain > 0 && r.pop != null).map((r) => r.pop);
  return {
    total: sum(rows, (r) => r.rain),
    chance: pops.length ? Math.max(...pops) : null,
    wettest: wettest && wettest[1] >= 0.01 ? wettest[0] : null,
  };
}

function wateringAdvice(w, ctx, cond) {
  const { today, logs } = ctx;
  const m = md(today);
  const skip = (reason) => ({ status: 'skip', title: 'Skip watering', reason });
  const sprinklers = sortLogs(logs.filter((l) => l.type === 'other' && (l.kind === 'blowout' || l.kind === 'startup') && l.date <= today))[0];
  if (sprinklers?.kind === 'blowout' && daysBetween(sprinklers.date, today) < 200) {
    return skip(`Sprinklers were blown out ${fmtMonthDay(sprinklers.date)}, so no watering until the spring start-up.`);
  }
  if (cond.frozen) return skip('The ground is frozen — no watering.');
  if (m >= 1101 || m < 415) return skip('Off season — bluegrass uses very little water from November to mid-April.');

  const used = `${fmtNum(w.et, 2)}″`;
  const got = `${fmtNum(w.got, 2)}″`;
  const short = `${fmtNum(w.short, 2)}″`;
  if (w.short < Math.max(WATER_TRIGGER.min, w.et * WATER_TRIGGER.share)) {
    return skip(w.short <= 0
      ? `${w.watered > 0 ? 'Rain and watering' : 'Rain'} (${got}) kept up with the ${used} the lawn used this week.`
      : `The lawn used ${used} and got ${got} this week — only ${short} short, and the soil still has moisture.`);
  }
  const a = w.ahead;
  const likely = a.chance == null || a.chance >= 50 ? a.total : 0;
  if (likely >= w.short * 0.6) {
    const when = a.wettest ? `, mostly ${relDayLower(a.wettest, today)}` : '';
    const chance = a.chance != null ? ` (${f0(a.chance)}% chance)` : '';
    return {
      status: 'hold',
      title: 'Hold off for rain',
      reason: `The lawn is ${short} short, but ${fmtNum(a.total, 2)}″ of rain is forecast${when}${chance} — enough to cover ${likely >= w.short ? 'it' : 'most of it'}.`,
    };
  }
  const amount = quarterInch(w.short - likely);
  const rain = likely >= 0.05 ? ` The ${fmtNum(likely, 2)}″ of rain in the forecast won’t cover it.` : ' Little rain is forecast.';
  return {
    status: 'water',
    title: `Water about ${fmtNum(amount, 2)}″`,
    amount,
    reason: `The lawn used ${used} and got ${got} this week — ${short} short.${rain} One deep soak, early in the morning, is best.`,
  };
}

/**
 * The This Week card: rain over the last 7 days (6 days ago through the current hour) and the next 3 days, water lost
 * to evapotranspiration over the same 7 days, soil temperature now, and whether to water, skip, or hold off for rain.
 * Logged watering counts alongside rain, the same way the Watering card counts it.
 */
export function thisWeek(ctx) {
  const { today, now, weather } = ctx;
  if (!weather) return { available: false };
  const cond = ctx.cond || conditions(ctx);
  const ww = waterWeek({ ...ctx, cond });
  const from = addDays(today, -6);
  const et = et0SoFar(weather, from, today, now) * KC;
  const idx = hourIndexNow(weather, now);
  const w = {
    available: true,
    from,
    rain: ww.rain,
    watered: ww.watered,
    got: ww.total,
    et,
    short: et - ww.total,
    ahead: rainAhead(weather, today, now, 72),
    soilNow: (idx != null ? weather.hours[idx].soil : null) ?? cond.soil24,
    soil24: cond.soil24,
  };
  return { ...w, advice: wateringAdvice(w, ctx, cond) };
}

/* ======================= totals ======================= */

export function seasonTotals({ logs, zones, products, settings }, year) {
  const yl = logs.filter((l) => yearOf(l.date) === year);
  const mows = yl.filter((l) => l.type === 'mow');
  const area = lawnArea(zones);
  const nLbs = sum(yl, (l) => l.effects?.nLbs || 0);
  const mulched = mows.filter((l) => (l.clippings || settings.clippings) === 'mulch').length;
  const byProduct = new Map();
  for (const l of yl) {
    if (!l.productId && !l.productName) continue;
    if (!(l.amount > 0)) continue;
    const key = l.productId || l.productName;
    const p = products.find((x) => x.id === l.productId);
    const row = byProduct.get(key) || { name: p ? shortName(p) : (l.productName || 'Product'), unit: l.unit || p?.unit || 'lb', amount: 0, apps: 0, cost: 0 };
    row.amount += l.amount;
    row.apps += 1;
    if (p && p.size > 0) row.cost += (l.amount / p.size) * (p.price || 0);
    byProduct.set(key, row);
  }
  const water = yl.filter((l) => l.type === 'water');
  const gallons = sum(water, (l) => wateringCalc(zones, l.zones || [], l.minutes || 0).gallons);
  const rate = waterRateInfo(settings, zones);
  return {
    mows: mows.length,
    hours: sum(mows, (l) => l.hours),
    nLbs,
    nPer1000: area > 0 ? (nLbs / area) * 1000 : 0,
    mulchCredit: mulched * MULCH_N_PER_MOW,
    target: settings.nitrogen?.seasonTarget || 3,
    products: [...byProduct.values()],
    feeds: yl.filter(isFeeding).length,
    sprays: yl.filter((l) => l.type === 'weed').length,
    pulls: yl.filter((l) => l.type === 'pull').length,
    waterings: water.length,
    waterGallons: gallons,
    waterCost: (gallons / 1000) * rate.per1000,
    others: yl.filter((l) => l.type === 'other').length,
  };
}

export const otherLabel = (kind) => OTHER_KINDS.find((k) => k.id === kind)?.label || LEGACY_KIND_LABELS[kind] || 'Other';
export { round };
