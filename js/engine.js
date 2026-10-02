// Lawn logic: growth model, mowing/fertilizer/watering recommendations, plan, alerts, totals.
// Pure functions only (no DOM) so they can be unit-tested. Dates are local 'YYYY-MM-DD' strings.

import {
  addDays, daysBetween, dow, md, yearOf, clamp, round, sum, avg, fmtMonthDay, relDay, relDayLower,
  fmtNum, fmtUntil, WEEKDAYS_LONG, maxDate, dateStr,
} from './util.js';
import { OTHER_KINDS } from './defaults.js';

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
  return { date, tMax: hi, tMin: lo, rain: mix(2), rainProb: 30, et0: mix(3), wind: 8, code: null, soil: (hi + lo) / 2, est: true };
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

const hourKey = (ms, utcOffset) => new Date(ms + utcOffset * 1000).toISOString().slice(0, 13);

/** Average soil temperature (2.4″ depth) over the last 24 hours, °F. */
export function soilAvg24(weather, now) {
  if (!weather?.hours?.length) return null;
  const key = hourKey(now, weather.utcOffset || 0);
  let idx = weather.hourIndex?.[key];
  if (idx == null) {
    // Cached data that no longer covers "now": only trust it within a day.
    const last = weather.hours.length - 1;
    if (key > weather.hours[last].t && daysBetween(weather.hours[last].t.slice(0, 10), key.slice(0, 10)) <= 1) idx = last;
    else return null;
  }
  const vals = weather.hours.slice(Math.max(0, idx - 23), idx + 1).map((h) => h.soil).filter((v) => v != null);
  return vals.length >= 6 ? avg(vals) : null;
}

/** Local hour (0–23) at the lawn's location. */
export const localHour = (weather, now) => (weather?.utcOffset != null
  ? Number(hourKey(now, weather.utcOffset).slice(11, 13))
  : new Date(now).getHours());

export function conditions({ weather, today, now }) {
  const next = dayTable(weather, today, addDays(today, 9));
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
    hardFreeze: live.find((d) => d.tMin <= 28) || null,
    frost: live.find((d) => d.tMin <= 32) || null,
    pastHardFreeze: past.find((d) => !d.est && d.tMin <= 28) || null,
    frozen: soil24 != null && soil24 <= 32,
    rainPast7: sum(past, (d) => d.rain),
    etPast7: sum(past, (d) => d.et0) * KC,
    rainNext7: sum(next.slice(0, 7), (d) => d.rain),
    etNext7: sum(next.slice(0, 7), (d) => d.et0) * KC,
    soilReach: (target) => next.slice(1).find((d) => !d.est && d.soil != null && d.soil >= target) || null,
  };
}

/* ======================= logs & mower ======================= */

const byDateDesc = (a, b) => (a.date === b.date ? (b.at || 0) - (a.at || 0) : a.date < b.date ? 1 : -1);
export const sortLogs = (logs) => [...logs].sort(byDateDesc);

export function lastMow(logs, today) {
  return sortLogs(logs.filter((l) => l.type === 'mow' && l.date <= today))[0] || null;
}

export function mowerHours(settings, logs) {
  const m = settings.mower;
  const mows = logs.filter((l) => l.type === 'mow');
  const total = (m.hoursBefore || 0) + sum(mows, (l) => l.hours);
  const lastSharpen = sortLogs(logs.filter((l) => l.type === 'other' && l.kind === 'sharpen'))[0] || null;
  const since = lastSharpen
    ? sum(mows.filter((l) => l.date > lastSharpen.date || (l.date === lastSharpen.date && (l.at || 0) > (lastSharpen.at || 0))), (l) => l.hours)
    : (m.sinceSharpenAtStart || 0) + sum(mows, (l) => l.hours);
  const every = m.sharpenEvery > 0 ? m.sharpenEvery : 25;
  return { total, since, every, lastSharpen, due: since >= every, soon: since >= every * 0.85 };
}

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

function growthModel(table, logs, calib) {
  const index = {};
  table.forEach((d, i) => { index[d.date] = i; });
  const feedDates = logs.filter((l) => (l.effects?.nLbs || 0) > 0).map((l) => l.date);
  const daily = (date) => {
    const i = index[date];
    if (i == null) return 0;
    const d = table[i];
    let g = MAX_GROWTH * growthPotential((d.tMax + d.tMin) / 2);
    if (d.tMax >= 90) g *= 0.6;
    else if (d.tMax >= 85) g *= 0.8;
    const w = table.slice(Math.max(0, i - 6), i + 1);
    const rain = sum(w, (x) => x.rain);
    const et = sum(w, (x) => x.et0) * KC;
    g *= clamp(0.85 + 0.3 * (rain / Math.max(et, 0.2)), 0.85, 1.15);
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
 * Next mow: day, mower position, height and a one-line reason.
 * Picks the best-weather day near the weekly cadence, favoring preferred days, and keeps each cut within the one-third rule.
 */
export function mowRecommendation(ctx) {
  const { today, now, logs, settings, weather } = ctx;
  const cond = ctx.cond || conditions(ctx);
  const heights = settings.mower.heights.map(Number);
  const maxH = Math.max(...heights);
  const cadence = clamp(Math.round(settings.mowing.cadenceDays || 7), 3, 21);
  const pref = settings.mowing.preferredDays || [];
  const season = seasonInfo(today, cond, logs);
  const slopedZones = lawnZones(ctx.zones).filter(isSloped);
  const shadeZones = lawnZones(ctx.zones).filter((z) => z.sun === 'shade');
  if (season.off) return { status: 'off', season, title: season.label, reason: season.reason };

  const last = lastMow(logs, today);
  const calib = growthCalibration(logs, today);
  const tableStart = addDays(last ? (last.date < addDays(today, -30) ? addDays(today, -30) : last.date) : today, -8);
  const table = dayTable(weather, tableStart, addDays(today, 18));
  const byDate = Object.fromEntries(table.map((d) => [d.date, d]));
  const growth = growthModel(table, logs, calib.factor);
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

/**
 * Rate the next 7 days for spreading/spraying a product, using hourly rain.
 * Fertilizer: avoid heavy rain during the no-rain window (stricter on slopes); light rain after is good.
 */
export function applicationWindow({ weather, product, zoneIds, zones, today, now, kind }) {
  const selected = zones.filter((z) => zoneIds.includes(z.id));
  const sloped = selected.some(isSloped);
  const type = kind || product?.type || 'fertilizer';
  const granular = type === 'fertilizer' || type === 'preemergent';
  let hours = product?.noRainHours > 0 ? product.noRainHours : 24;
  if (granular && sloped) hours = Math.max(48, hours * 2);
  const heavy = sloped ? 0.3 : 0.5;
  const base = { sloped, hours, heavy, type, days: [], best: null };
  if (!weather?.hours?.length) return { ...base, available: false, summary: 'No forecast available — check for heavy rain before applying.' };

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

  for (let i = 0; i < 7; i++) {
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
    if (granular) {
      if (peak >= heavy) { rating = 'avoid'; note = `${fmtNum(peak, 2)}″ heavy rain within ${hours} h${sloped ? ' (sloped zones)' : ''}`; } else if (day.tMax >= 88) { rating = 'avoid'; note = `Too hot (${f0(day.tMax)}°F)`; } else if (day.tMin <= 28 && md(date) >= 1001) { rating = 'avoid'; note = 'Hard freeze — never spread on frozen ground'; } else if (win.total >= 0.1) { rating = 'ok'; note = `${fmtNum(win.total, 2)}″ light rain within ${hours} h — fine if it stays light`; } else if (after3 >= 0.1 && after3 < heavy) { note = `Dry, then ${fmtNum(after3, 2)}″ light rain to water it in`; } else { note = 'Dry — water in with about ¼″ afterward'; }
    } else {
      const wind = day.wind ?? 0;
      if (win.total >= 0.05) { rating = 'avoid'; note = `Rain within ${hours} h would wash it off`; } else if (wind >= 12) { rating = 'avoid'; note = `Windy (${f0(wind)} mph) — spray drift`; } else if (day.tMax > 85) { rating = 'avoid'; note = `Too hot (${f0(day.tMax)}°F) — can injure turf`; } else if (day.tMax < 55) { rating = 'ok'; note = `Cool (${f0(day.tMax)}°F) — slower, still works above 50°F`; } else { note = `Dry for ${hours} h, ${f0(day.tMax)}°F`; }
    }
    if (coverageShort && rating === 'good') note += ' (forecast ends before window does)';
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

/* ======================= timers ======================= */

export function computeTimers(log, product, zones) {
  const at = log.at || Date.now();
  const timers = [];
  if (!product) return timers;
  const sloped = zones.filter((z) => (log.zones || []).includes(z.id)).some(isSloped);
  const granular = product.type === 'fertilizer' || product.type === 'preemergent';
  if (product.keepOffHours > 0) timers.push({ kind: 'keepOff', until: at + product.keepOffHours * 3600e3 });
  let nr = product.noRainHours || 0;
  if (nr > 0 && granular && sloped) nr = Math.max(48, nr * 2);
  if (nr > 0) timers.push({ kind: 'noRain', until: at + nr * 3600e3, granular, sloped });
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

export function wateringPlan(ctx) {
  const { today, settings, zones, logs } = ctx;
  const cond = ctx.cond || conditions(ctx);
  const m = md(today);
  const y = yearOf(today);
  const blowout = sortLogs(logs.filter((l) => l.type === 'other' && l.kind === 'blowout' && yearOf(l.date) === y && md(l.date) >= 801 && l.date <= today))[0];
  const rate = waterRateInfo(settings, zones);
  if (blowout) return { off: true, rate, reason: `Sprinklers blown out ${fmtMonthDay(blowout.date)} — irrigation is off until spring.` };
  if (m < 501 || m >= 1101) return { off: true, rate, reason: 'Irrigation season runs May through October.' };

  const etc = cond.etNext7;
  const rain = cond.rainNext7 * 0.8;
  const past3 = cond.past.slice(-3);
  const carry = clamp(sum(past3, (d) => d.rain) - sum(past3, (d) => d.et0) * KC, 0, 0.5);
  const need = Math.max(0, etc - rain - carry);
  const rows = zones.map((z) => {
    if (!isLawn(z)) {
      const minutes = z.weeklyMinutes || 0;
      return { zone: z, inches: null, minutes, gallons: minutes * (z.gpm || 0), cycles: null };
    }
    const inches = need * (SUN_FACTOR[z.sun] ?? 1);
    const minutes = runtimeFor(z, inches);
    return { zone: z, inches, minutes, gallons: gallonsFor(z, inches), cycles: minutes > 0 ? cycleSoak(z, minutes) : null };
  });
  const gallons = sum(rows, (r) => r.gallons);
  return {
    off: false, need, etc, rain: cond.rainNext7, carry, rows, gallons,
    cost: (gallons / 1000) * rate.per1000, rate, est: !cond.hasWeather,
  };
}

/* ======================= plan ======================= */

const soilTrigger = (c, target, hint) => {
  if (c.soil24 == null) return { met: null, text: `When soil reaches ${target}°F. ${hint}` };
  const reach = c.soilReach(target);
  return {
    met: c.soil24 >= target,
    soon: !!reach,
    text: `Soil ${f0(c.soil24)}°F (24-h avg) → trigger ${target}°F${reach && c.soil24 < target ? `, expected ~${fmtMonthDay(reach.date)}` : ''}. ${hint}`,
  };
};

export const PLAN_TASKS = [
  {
    id: 'spring-cleanup', season: 'spring', title: 'Spring cleanup', kind: 'other', otherKind: 'cleanup', window: ['0320', '0510'],
    why: 'Rake matted patches to prevent snow mold, clear debris, and check for vole trails. Wait until the soil is firm so you don’t compact it.',
    trigger: (c) => (c.soil24 == null ? { met: null, text: 'Once snow is gone and the soil has thawed' } : { met: c.soil24 >= 40, text: `Soil ${f0(c.soil24)}°F (thawed at 40°F+)` }),
  },
  {
    id: 'sharpen-spring', season: 'spring', title: 'Sharpen mower blade', kind: 'other', otherKind: 'sharpen', window: ['0301', '0510'], doneFrom: '0101',
    why: 'A sharp blade cuts cleanly. A dull one shreds tips, which brown and invite disease.',
    trigger: () => ({ met: true, text: 'Before the first mow' }),
  },
  {
    id: 'pre-emergent', season: 'spring', title: 'Crabgrass pre-emergent', kind: 'weed', productType: 'preemergent', window: ['0410', '0525'], grace: 7,
    why: 'Crabgrass sprouts once soil holds about 55°F, so the pre-emergent has to be down and watered in first. Skip it where you plan to seed.',
    trigger: (c) => soilTrigger(c, 50, 'Apply at 50–55°F.'),
  },
  {
    id: 'first-mow', season: 'spring', title: 'First mow at about 3″', kind: 'mow', window: ['0410', '0520'],
    why: 'Start when grass reaches about 4″. Cutting at 3″ keeps bluegrass dense and shades out weed seeds.',
    trigger: (c) => soilTrigger(c, 50, 'Bluegrass grows actively above that.'),
  },
  {
    id: 'irrigation-startup', season: 'spring', title: 'Start up sprinklers', kind: 'other', otherKind: 'startup', window: ['0501', '0601'],
    why: 'Wait until frosts are over, then check every Rachio zone for broken heads, leaks, and coverage before summer.',
    trigger: (c) => (!c.hasWeather ? { met: null, text: 'After the last frost' } : c.frost ? { met: false, text: `Frost (${f0(c.frost.tMin)}°F) forecast ${fmtMonthDay(c.frost.date)}` } : { met: true, text: 'No frost in the 10-day forecast' }),
  },
  {
    id: 'fert-late-spring', season: 'spring', title: 'Late-spring feeding', kind: 'fert', productType: 'fertilizer', window: ['0515', '0610'], grace: 10,
    why: 'Feeding around Memorial Day, after the spring flush, carries bluegrass into summer without forcing soft growth. Early-spring feeding is skipped on purpose.',
    trigger: (c, today) => (c.soil24 == null
      ? { met: md(today) >= 520, text: 'Around Memorial Day, soil about 60°F' }
      : { met: c.soil24 >= 60 || md(today) >= 520, text: `Soil ${f0(c.soil24)}°F (trigger 60°F or May 20)` }),
  },
  {
    id: 'weed-spring', season: 'spring', title: 'Broadleaf weeds (spot treat)', kind: 'weed', productType: 'weed', window: ['0515', '0630'],
    why: 'Spot-treat dandelions and clover while they’re growing actively. Fall is the stronger window for perennial weeds.',
    trigger: (c) => (c.hasWeather ? { met: c.highs5 >= 60 && c.highs5 <= 85, text: `Highs ~${f0(c.highs5)}°F (best 60–85°F, calm, dry)` } : { met: null, text: 'Highs 60–85°F, calm and dry' }),
  },
  {
    id: 'summer-height', season: 'summer', title: 'Raise mowing height for heat', kind: 'info', window: ['0615', '0831'],
    why: 'Taller grass (3.5–4″) shades the soil, keeps roots cooler, and holds moisture through hot spells.',
    trigger: (c) => (c.hasWeather ? { met: c.maxHigh7 >= 85, text: `Highs up to ${f0(c.maxHigh7)}°F this week (trigger 85°F)` } : { met: null, text: 'When highs reach 85°F' }),
  },
  {
    id: 'fert-summer', season: 'summer', title: 'Light summer feeding', optional: true, kind: 'fert', productType: 'fertilizer', window: ['0701', '0720'], grace: 7,
    why: 'Irrigated bluegrass can use a light early-July feeding. Skip it in heat waves or drought.',
    trigger: (c) => (c.hasWeather ? { met: c.highs5 < 85, text: `Highs ~${f0(c.highs5)}°F (need under 85°F)` } : { met: null, text: 'When highs stay under 85°F' }),
  },
  {
    id: 'fert-early-fall', season: 'fall', title: 'Early-fall feeding', kind: 'fert', productType: 'fertilizer', window: ['0825', '0920'], grace: 15,
    why: 'The most important feeding for bluegrass: it rebuilds roots and density after summer. If you feed once a year, make it this one.',
    trigger: (c) => (c.hasWeather ? { met: c.highs5 < 85, text: `Highs ~${f0(c.highs5)}°F (need under 85°F)` } : { met: null, text: 'Once summer heat breaks' }),
  },
  {
    id: 'aerate', season: 'fall', title: 'Core aerate', optional: true, kind: 'other', otherKind: 'aerate', window: ['0825', '1005'], grace: 0,
    why: 'Relieves compaction in clay soil so water and fertilizer reach the roots. Every 1–2 years is plenty.',
    trigger: (c) => (c.soil24 == null ? { met: null, text: 'Soil 50–70°F and moist' } : { met: c.soil24 >= 50 && c.soil24 <= 70, text: `Soil ${f0(c.soil24)}°F (best 50–70°F, moist)` }),
  },
  {
    id: 'weed-fall', season: 'fall', title: 'Fall broadleaf weed control', kind: 'weed', productType: 'weed', window: ['0910', '1020'], grace: 7,
    why: 'Perennial weeds pull herbicide down to their roots as they store food for winter, so fall gives the best kill. Spray before a hard freeze.',
    trigger: (c) => {
      if (!c.hasWeather) return { met: null, text: 'Highs 50–80°F, before a hard freeze' };
      const ok = c.highs5 >= 50 && c.highs5 <= 80 && !c.pastHardFreeze;
      const freeze = c.hardFreeze ? ` Hard freeze forecast ${fmtMonthDay(c.hardFreeze.date)} — spray before then.` : '';
      return { met: ok, text: `Highs ~${f0(c.highs5)}°F (best 50–80°F).${freeze}` };
    },
  },
  {
    id: 'fert-late-fall', season: 'fall', title: 'Late-season feeding', kind: 'fert', productType: 'fertilizer', window: ['1010', '1105'], grace: 7,
    why: 'Top growth has slowed but roots still take up nitrogen, so the lawn greens up early next spring. Never spread on frozen ground; it runs off into the lake.',
    trigger: (c) => (c.soil24 == null
      ? { met: null, text: 'When soil cools to about 50°F and the grass is still green' }
      : { met: c.soil24 <= 50 && !c.frozen, soon: c.soil24 <= 55, text: `Soil ${f0(c.soil24)}°F (trigger 50°F or below, not frozen)` }),
  },
];

export const FALL_CHECKLIST = [
  {
    id: 'fall-fert', title: 'Fall fertilizer feeding', log: { type: 'fert' },
    detail: 'Early fall (Labor Day to late September) plus an optional late-season feeding in October.',
    match: (l) => l.type === 'fert' && md(l.date) >= 815,
  },
  {
    id: 'final-mow', title: 'Final lower mow (about 2.5″)', log: { type: 'mow', final: true },
    detail: 'Late October or November. Step down gradually so you never cut more than a third; short grass resists snow mold and voles.',
    match: (l) => l.type === 'mow' && (l.final || (md(l.date) >= 1010 && l.height <= 2.75)),
  },
  {
    id: 'blowout', title: 'Sprinkler blowout before the first hard freeze', log: { type: 'other', kind: 'blowout' },
    detail: 'Blow out the Rachio zones before the first night at 28°F or colder.',
    match: (l) => l.type === 'other' && l.kind === 'blowout' && md(l.date) >= 815,
  },
  {
    id: 'battery', title: 'EGO battery winter storage', log: { type: 'other', kind: 'battery' },
    detail: 'Take the battery off the mower and charger. Store it indoors, above freezing and out of heat, partly charged (not full or empty). Wipe the deck clean.',
    match: (l) => l.type === 'other' && l.kind === 'battery' && md(l.date) >= 815,
  },
  {
    id: 'spreader', title: 'Clean the spreader', log: { type: 'other', kind: 'spreader' },
    detail: 'Rinse the Elite after the last application, let it dry, and lube the wheels and gate pivot so it doesn’t corrode over winter.',
    match: (l) => l.type === 'other' && l.kind === 'spreader' && md(l.date) >= 815,
  },
];

const mdToDate = (y, s) => `${y}-${s.slice(0, 2)}-${s.slice(2)}`;

export function productFor(task, settings, products) {
  if (!task.productType) return null;
  const assigned = products.find((p) => p.id === settings.planProducts?.[task.id]);
  if (assigned) return assigned;
  return products.find((p) => p.type === task.productType) || null;
}

function taskMatchesLog(task, l) {
  if (task.kind === 'fert') return l.type === 'fert';
  if (task.kind === 'weed') {
    if (l.type !== 'weed') return false;
    const pre = l.productType === 'preemergent' || /pre-?emerg|crabgrass/i.test(`${l.productName || ''} ${l.notes || ''}`);
    return task.productType === 'preemergent' ? pre : !pre;
  }
  if (task.kind === 'mow') return l.type === 'mow';
  if (task.kind === 'other') return l.type === 'other' && l.kind === task.otherKind;
  return false;
}

/** All season tasks with live status for `today`. */
export function planTasks(ctx) {
  const { today, settings, products, zones, logs } = ctx;
  const cond = ctx.cond || conditions(ctx);
  const y = yearOf(today);
  const area = lawnArea(zones);
  const checks = settings.planChecks?.[y] || {};
  const used = new Set();
  const yearLogs = sortLogs(logs.filter((l) => yearOf(l.date) === y)).reverse();

  return PLAN_TASKS.map((t) => {
    const ws = mdToDate(y, t.window[0]);
    const we = mdToDate(y, t.window[1]);
    const graceEnd = addDays(we, t.grace ?? 10);
    const doneFrom = t.doneFrom ? mdToDate(y, t.doneFrom) : addDays(ws, -21);
    const doneLog = t.kind === 'info' ? null : yearLogs.find((l) => !used.has(l.id) && l.date >= doneFrom && l.date <= addDays(graceEnd, 20) && taskMatchesLog(t, l));
    if (doneLog) used.add(doneLog.id);
    const trig = t.trigger(cond, today);
    const product = productFor(t, settings, products);
    const lbs = product ? amountFor(product, area) : null;

    let status;
    if (doneLog || checks[t.id]) status = 'done';
    else if (today > graceEnd) status = 'past';
    else if (today >= ws) status = trig.met === false ? 'waiting' : today > we ? 'late' : 'now';
    else if (trig.met === true && daysBetween(today, ws) <= 21 && t.kind !== 'info' && t.id !== 'sharpen-spring') status = 'now';
    else if (daysBetween(today, ws) <= 14 || trig.soon) status = 'soon';
    else status = 'later';
    if (t.kind === 'info' && status === 'waiting') status = 'later';

    return {
      ...t,
      status,
      trigger: trig,
      windowText: `${fmtMonthDay(ws)} – ${fmtMonthDay(we)}`,
      ws, we, graceEnd,
      doneLog: doneLog || null,
      manual: !!checks[t.id] && !doneLog,
      product,
      lbs,
      area,
    };
  });
}

export function fallChecklist(ctx) {
  const { today, settings, logs } = ctx;
  const cond = ctx.cond || conditions(ctx);
  const y = yearOf(today);
  const checks = settings.planChecks?.[y] || {};
  return FALL_CHECKLIST.map((item) => {
    const log = sortLogs(logs.filter((l) => yearOf(l.date) === y && l.date <= today && item.match(l)))[0] || null;
    let urgent = null;
    if (!log && !checks[item.id] && item.id === 'blowout' && cond.hardFreeze && md(today) >= 815) {
      urgent = `Hard freeze (${f0(cond.hardFreeze.tMin)}°F) forecast ${relDayLower(cond.hardFreeze.date, today)} — blow out before then.`;
    }
    return { ...item, done: !!log || !!checks[item.id], log, manual: !!checks[item.id] && !log, urgent };
  });
}

/* ======================= alerts ======================= */

export function nextFertProduct(ctx, tasks) {
  const list = tasks || planTasks(ctx);
  const order = { now: 0, late: 0, waiting: 1, soon: 2, later: 3 };
  const t = list.filter((x) => x.kind === 'fert' && order[x.status] != null && x.product)
    .sort((a, b) => order[a.status] - order[b.status])[0];
  return t?.product || ctx.products.find((p) => p.type === 'fertilizer') || null;
}

export function alerts(ctx) {
  const { today, now, settings, zones, logs, weather } = ctx;
  const cond = ctx.cond || conditions(ctx);
  const tasks = ctx.tasks || planTasks(ctx);
  const out = [];
  const m = md(today);

  // Crabgrass pre-emergent by soil temperature.
  const pre = tasks.find((t) => t.id === 'pre-emergent');
  if (pre && pre.status !== 'done' && m >= 315 && m <= 615 && cond.soil24 != null) {
    const prod = pre.product ? `${pre.product.name}` : 'a pre-emergent (add one in Yard → Products)';
    const reach50 = cond.soilReach(50);
    if (cond.soil24 >= 55) out.push({ id: 'soil55', level: 'red', icon: 'thermo', title: `Soil is ${f0(cond.soil24)}°F — crabgrass is germinating`, body: `Apply ${prod} right away and water it in.`, action: { type: 'weed' } });
    else if (cond.soil24 >= 50) out.push({ id: 'soil50', level: 'orange', icon: 'thermo', title: `Soil ${f0(cond.soil24)}°F and rising toward 55°F`, body: `Time to apply ${prod}. Crabgrass sprouts once soil holds 55°F.`, action: { type: 'weed' } });
    else if (reach50) out.push({ id: 'soil-soon', level: 'blue', icon: 'thermo', title: `Soil reaches 50°F around ${relDayLower(reach50.date, today)}`, body: `Now ${f0(cond.soil24)}°F (24-h avg). Have ${prod} ready before soil holds 55°F.` });
  }

  // Rain-aware fertilizer timing.
  const fertTask = tasks.find((t) => t.kind === 'fert' && (t.status === 'now' || t.status === 'late'));
  if (fertTask && fertTask.product) {
    const ids = lawnZones(zones).map((z) => z.id);
    const win = applicationWindow({ weather, product: fertTask.product, zoneIds: ids, zones, today, now });
    out.push({
      id: 'fert-window', level: win.best ? 'green' : 'orange', icon: 'bag',
      title: `${fertTask.title}${fertTask.status === 'late' ? ' (late, still OK)' : ''}`,
      body: `${win.summary}${win.sloped ? ` Sloped zones use a ${win.hours}-hour no-rain window.` : ''}`,
      action: { type: 'fert', productId: fertTask.product.id },
    });
  }

  // Low inventory for products the plan needs soon.
  const seen = new Set();
  for (const t of tasks) {
    if (!t.product || seen.has(t.product.id) || !['now', 'late', 'soon', 'waiting'].includes(t.status) || t.optional) continue;
    const need = t.lbs || 0;
    if (need > 0 && (t.product.onHand || 0) < need - 0.01) {
      seen.add(t.product.id);
      const short = need - (t.product.onHand || 0);
      const bags = Math.ceil(short / (t.product.size || 1));
      out.push({
        id: `inv-${t.product.id}`, level: 'orange', icon: 'box',
        title: `Low inventory: ${t.product.name}`,
        body: `${fmtNum(t.product.onHand || 0, 1)} ${t.product.unit} on hand; ${t.title.toLowerCase()} needs ${fmtNum(need, 1)} ${t.product.unit}. Buy ${bags} ${bags === 1 ? 'bag' : 'bags'}.`,
        action: { type: 'product', productId: t.product.id },
      });
    }
  }

  // Blade sharpening.
  const hrs = mowerHours(settings, logs);
  if (hrs.due) out.push({ id: 'sharpen', level: 'orange', icon: 'blade', title: 'Sharpen the mower blade', body: `${fmtNum(hrs.since, 1)} hours since the last sharpening (every ${fmtNum(hrs.every, 0)} h).`, action: { type: 'other', kind: 'sharpen' } });
  else if (hrs.soon) out.push({ id: 'sharpen-soon', level: 'blue', icon: 'blade', title: 'Blade sharpening coming up', body: `${fmtNum(hrs.since, 1)} of ${fmtNum(hrs.every, 0)} hours used.` });

  // Hard freeze → blowout.
  const blow = fallChecklist({ ...ctx, cond }).find((i) => i.id === 'blowout');
  if (blow?.urgent) out.push({ id: 'freeze', level: 'red', icon: 'snow', title: 'Schedule the sprinkler blowout', body: blow.urgent, action: { type: 'other', kind: 'blowout' } });

  return out;
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
    const row = byProduct.get(key) || { name: p?.name || l.productName || 'Product', unit: l.unit || p?.unit || 'lb', amount: 0, apps: 0, cost: 0 };
    row.amount += l.amount;
    row.apps += 1;
    if (p && p.size > 0) row.cost += (l.amount / p.size) * (p.price || 0);
    byProduct.set(key, row);
  }
  return {
    mows: mows.length,
    hours: sum(mows, (l) => l.hours),
    nLbs,
    nPer1000: area > 0 ? (nLbs / area) * 1000 : 0,
    mulchCredit: mulched * MULCH_N_PER_MOW,
    target: settings.nitrogen?.seasonTarget || 3,
    products: [...byProduct.values()],
    feeds: yl.filter((l) => l.type === 'fert').length,
    weeds: yl.filter((l) => l.type === 'weed').length,
    others: yl.filter((l) => l.type === 'other').length,
  };
}

export const otherLabel = (kind) => OTHER_KINDS.find((k) => k.id === kind)?.label || 'Other';
export const weekdayName = (i) => WEEKDAYS_LONG[i];
export { round };
