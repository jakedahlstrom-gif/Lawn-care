// The fun layer: season stats (miles walked, streaks, favorite stripes), trophies, dollar spot risk
// (Smith–Kerns model), the activity heatmap, calendar export, and the ambient effects (hero weather,
// confetti, the trophy pop). Everything is derived from data the app already keeps; nothing new is stored.

import * as E from './engine.js';
import { MOW_PATTERNS } from './defaults.js';
import { icon } from './icons.js';
import {
  esc, sum, avg, yearOf, addDays, daysBetween, dow, monthName, fmtNum,
} from './util.js';

/* ---------- season stats ---------- */

/** Mower deck width from the model name ("EGO 21″ self-propelled" → 21); 21″ when it can't tell. */
export function deckInches(model) {
  const m = String(model || '').match(/(\d{2}(?:\.\d+)?)\s*(?:″|"|''|-?\s?inch|in\b)/i);
  const n = m ? Number(m[1]) : 21;
  return n >= 14 && n <= 72 ? n : 21;
}

/** Each pass overlaps the last a little, so the mower covers about 85% of its deck width. */
export const SWATH = 0.85;
export const MILES_PER_LAP = 0.25; // one lap of a running track

/** Miles walked for one mow: lawn area of its zones ÷ effective swath width. */
export function mowMiles(log, zones, deck) {
  const area = E.lawnArea(zones, log.zones?.length ? log.zones : undefined);
  const swathFt = (deck * SWATH) / 12;
  return area > 0 ? area / swathFt / 5280 : 0;
}

/** Monday on or before a date, as the key for its week. */
const weekOf = (d) => addDays(d, -((dow(d) + 6) % 7));

/** Longest run of consecutive calendar weeks with at least one date in `dates`. */
export function longestWeekStreak(dates) {
  const weeks = [...new Set(dates.map(weekOf))].sort();
  let best = 0;
  let run = 0;
  weeks.forEach((w, i) => {
    run = i && daysBetween(weeks[i - 1], w) === 7 ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

/** Weeks in a row with a mow, counting back from this week (or last week, if this one hasn't had one yet). */
export function currentWeekStreak(dates, today) {
  const weeks = new Set(dates.filter((d) => d <= today).map(weekOf));
  let w = weekOf(today);
  if (!weeks.has(w)) w = addDays(w, -7);
  let n = 0;
  while (weeks.has(w)) { n += 1; w = addDays(w, -7); }
  return n;
}

export function seasonStats(ctx, year) {
  const yl = ctx.logs.filter((l) => yearOf(l.date) === year);
  const mows = yl.filter((l) => l.type === 'mow').sort((a, b) => (a.date < b.date ? -1 : 1));
  const deck = deckInches(ctx.settings.mower?.model);
  const miles = sum(mows, (l) => mowMiles(l, ctx.zones, deck));
  const patternCounts = [0, 0, 0, 0];
  let switches = 0;
  mows.forEach((l, i) => {
    if (Number.isInteger(l.pattern) && patternCounts[l.pattern] != null) patternCounts[l.pattern] += 1;
    if (i && Number.isInteger(l.pattern) && l.pattern !== mows[i - 1].pattern) switches += 1;
  });
  const favCount = Math.max(...patternCounts);
  const favPattern = favCount > 0 ? MOW_PATTERNS[patternCounts.indexOf(favCount)] : null;
  const months = Array.from({ length: 12 }, () => 0);
  yl.forEach((l) => { months[Number(l.date.slice(5, 7)) - 1] += 1; });
  const busy = Math.max(...months);
  const waterings = (ctx.waterings || E.allWatering(ctx)).filter((l) => yearOf(l.date) === year);
  const blowout = yl.some((l) => l.type === 'other' && l.kind === 'blowout');
  const preventer = yl.find((l) => l.type === 'fert' && ctx.products.find((p) => p.id === l.productId)?.type === 'preemergent');
  const t = E.seasonTotals(ctx, year);
  return {
    year,
    logs: yl.length,
    mows: mows.length,
    hours: sum(mows, (l) => l.hours),
    deck,
    miles,
    laps: miles / MILES_PER_LAP,
    patternsUsed: patternCounts.filter(Boolean).length,
    favPattern,
    favCount,
    switches,
    months,
    busiestMonth: busy > 0 ? months.indexOf(busy) : null,
    busiestCount: busy,
    streak: longestWeekStreak(mows.map((l) => l.date)),
    summerTall: mows.filter((l) => /-0[678]-/.test(l.date) && Number(l.height) >= 3).length,
    feeds: yl.filter(E.isFeeding).length,
    weeds: yl.filter((l) => l.type === 'weed' || l.type === 'pull').length,
    photos: yl.filter((l) => l.photoId).length,
    finalMow: mows.some((l) => l.final),
    blowout,
    earlyPreventer: !!preventer && preventer.date < `${year}-05-01`,
    gallons: sum(waterings, (l) => E.waterGallons(l, ctx.zones)),
    waterCost: t.waterCost,
    rachioRuns: t.rachioRuns,
    nPer1000: t.nPer1000,
    mulchCredit: t.mulchCredit,
    nTarget: t.target,
    products: t.products,
  };
}

/* ---------- trophies ---------- */

export const TROPHIES = [
  { id: 'first-cut', title: 'First Cut', text: 'Log the season’s first mow', icon: 'mow', goal: () => 1, value: (s) => s.mows },
  { id: 'double-digits', title: 'Double Digits', text: '10 mows in a season', icon: 'star', goal: () => 10, value: (s) => s.mows },
  { id: 'quarter-century', title: 'Quarter Century', text: '25 mows in a season', icon: 'trophy', goal: () => 25, value: (s) => s.mows },
  { id: 'stripe-master', title: 'Stripe Master', text: 'Mow all four stripe directions', icon: 'zones', goal: () => 4, value: (s) => s.patternsUsed },
  { id: 'on-a-roll', title: 'On a Roll', text: 'Mow 6 weeks in a row', icon: 'flame', goal: () => 6, value: (s) => s.streak },
  { id: 'early-bird', title: 'Early Bird', text: 'Crabgrass preventer down before May 1', icon: 'shield', goal: () => 1, value: (s) => (s.earlyPreventer ? 1 : 0) },
  { id: 'full-program', title: 'Full Program', text: '4 feedings in a season', icon: 'bag', goal: () => 4, value: (s) => s.feeds },
  { id: 'on-target', title: 'On Target', text: 'Reach your season nitrogen target', icon: 'target', goal: (s) => s.nTarget || 3, value: (s) => Math.round((s.nPer1000 + s.mulchCredit) * 100) / 100 },
  { id: 'tall-proud', title: 'Tall & Proud', text: '8 summer mows at 3″ or higher', icon: 'leaf', goal: () => 8, value: (s) => s.summerTall },
  { id: 'weed-warrior', title: 'Weed Warrior', text: '5 weeding sessions', icon: 'hand', goal: () => 5, value: (s) => s.weeds },
  { id: 'marathon', title: 'Marathon Mower', text: 'Walk 26.2 miles behind the mower', icon: 'route', goal: () => 26.2, value: (s) => Math.round(s.miles * 10) / 10 },
  { id: 'tucked-in', title: 'Tucked In', text: 'Final mow and sprinkler blowout logged', icon: 'snow', goal: () => 2, value: (s) => (s.finalMow ? 1 : 0) + (s.blowout ? 1 : 0) },
];

export function trophies(stats) {
  return TROPHIES.map((t) => {
    const goal = t.goal(stats);
    const value = t.value(stats);
    return { id: t.id, title: t.title, text: t.text, icon: t.icon, goal, value, earned: value >= goal - 1e-9, pct: Math.max(0, Math.min(1, value / (goal || 1))) };
  });
}

export const earnedIds = (stats) => new Set(trophies(stats).filter((t) => t.earned).map((t) => t.id));

/* ---------- dollar spot risk (Smith–Kerns) ---------- */

/**
 * Smith–Kerns dollar spot model (Smith et al., 2018): from the 5-day moving averages of daily mean air
 * temperature (°C) and relative humidity (%), logit = −11.4041 + 0.1932·T + 0.0894·RH. It only applies
 * when that average temperature is 10–35°C (50–95°F); 20% is the usual fungicide threshold.
 */
export const DOLLAR_SPOT_THRESHOLD = 0.2;
export function smithKerns(tF, rh) {
  const tC = ((tF - 32) * 5) / 9;
  const active = tC >= 10 && tC <= 35;
  const logit = -11.4041 + 0.1932 * tC + 0.0894 * rh;
  return { p: active ? 1 / (1 + Math.exp(-logit)) : 0, active, tF, rh };
}

export function dollarSpot(weather, today, { back = 4, ahead = 3 } = {}) {
  if (!weather?.hours?.length) return null;
  const byDay = {};
  for (const h of weather.hours) {
    if (h.temp == null || h.rh == null) continue;
    const k = h.t.slice(0, 10);
    (byDay[k] ||= { t: [], rh: [] }).t.push(h.temp);
    byDay[k].rh.push(h.rh);
  }
  const mean = (d) => (byDay[d] && byDay[d].t.length >= 18 ? { t: avg(byDay[d].t), rh: avg(byDay[d].rh) } : null);
  const riskOn = (end) => {
    const ds = [0, 1, 2, 3, 4].map((i) => mean(addDays(end, -i)));
    if (ds.some((x) => !x)) return null;
    return { date: end, ...smithKerns(avg(ds.map((x) => x.t)), avg(ds.map((x) => x.rh))) };
  };
  const now = riskOn(today);
  if (!now) return null;
  const trend = [];
  for (let i = -back; i <= ahead; i++) {
    const r = riskOn(addDays(today, i));
    if (r) trend.push({ ...r, offset: i });
  }
  return { now, trend, level: riskLevel(now.p) };
}

export const riskLevel = (p) => (p >= DOLLAR_SPOT_THRESHOLD ? 'high' : p >= 0.1 ? 'watch' : 'low');

/* ---------- activity heatmap ---------- */

const PRIORITY = ['fert', 'mow', 'weed', 'water', 'other'];
const kindOf = (l) => (l.type === 'pull' ? 'weed' : l.type === 'fert' || l.type === 'mow' || l.type === 'weed' || l.type === 'water' ? l.type : 'other');

/** Day → strongest activity that day ('fert' > 'mow' > 'weed' > 'water' > 'other'), Rachio runs included. */
export function activityByDay(ctx, year) {
  const map = {};
  const add = (date, k) => {
    if (yearOf(date) !== year) return;
    const cur = map[date];
    if (!cur || PRIORITY.indexOf(k) < PRIORITY.indexOf(cur)) map[date] = k;
  };
  ctx.logs.forEach((l) => add(l.date, kindOf(l)));
  (ctx.waterings || E.allWatering(ctx)).forEach((l) => add(l.date, 'water'));
  return map;
}

export function heatmapHtml(ctx, year) {
  const days = activityByDay(ctx, year);
  const dates = Object.keys(days).sort();
  if (!dates.length) return '';
  const from = weekOf([`${year}-04-01`, dates[0]].sort()[0]);
  const to = [`${year}-10-31`, dates[dates.length - 1]].sort()[1];
  const cols = Math.floor(daysBetween(from, to) / 7) + 1;
  const C = 11;
  const top = 14;
  const cells = [];
  const labels = [];
  for (let c = 0; c < cols; c++) {
    const monday = addDays(from, c * 7);
    for (let r = 0; r < 7; r++) {
      const d = addDays(monday, r);
      if (d > to && d > ctx.today) continue;
      const k = days[d];
      cells.push(`<rect x="${c * C}" y="${top + r * C}" width="${C - 2}" height="${C - 2}" rx="2" class="hm hm-${k || 'none'}${d === ctx.today ? ' hm-today' : ''}${d > ctx.today ? ' hm-future' : ''}"/>`);
      if (Number(d.slice(8, 10)) === 1) labels.push(`<text x="${c * C}" y="9" class="hm-l">${monthName(Number(d.slice(5, 7)) - 1).slice(0, 3)}</text>`);
    }
  }
  const counts = PRIORITY.map((k) => [k, Object.values(days).filter((x) => x === k).length]);
  const NAMES = { fert: 'Feed', mow: 'Mow', weed: 'Weeds', water: 'Water', other: 'Other' };
  const active = Object.keys(days).length;
  return `<section class="card heat-card" data-testid="heatmap">
    <div class="sec-row inner"><span class="mini-kicker">${icon('plan')}<span>Season at a glance</span></span><span class="heat-count">${active} active ${active === 1 ? 'day' : 'days'}</span></div>
    <svg class="heatmap" viewBox="0 0 ${cols * C} ${top + 7 * C}" role="img" aria-label="${esc(`${year} activity: ${counts.filter(([, n]) => n).map(([k, n]) => `${NAMES[k]} ${n} days`).join(', ')}`)}">${labels.join('')}${cells.join('')}</svg>
    <div class="heat-key">${counts.filter(([, n]) => n).map(([k]) => `<span class="hk hk-${k}">${NAMES[k]}</span>`).join('')}</div>
  </section>`;
}

/* ---------- calendar export ---------- */

const icsText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const icsDate = (d) => d.replace(/-/g, '');
/** Fold lines longer than 75 octets, as RFC 5545 asks. */
const fold = (line) => {
  const out = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = ` ${rest.slice(74)}`; }
  out.push(rest);
  return out.join('\r\n');
};

/** All-day events: { uid, start, end (inclusive), title, notes }. */
export function buildIcs(events, stamp = new Date()) {
  const ts = `${stamp.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lawn IQ//Lawn plan//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Lawn IQ'];
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.uid}@lawn-iq`, `DTSTAMP:${ts}`, `DTSTART;VALUE=DATE:${icsDate(e.start)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(e.end || e.start, 1))}`, `SUMMARY:${icsText(e.title)}`, 'TRANSP:TRANSPARENT');
    if (e.notes) lines.push(`DESCRIPTION:${icsText(e.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** Upcoming feedings, season tasks and the next mow as calendar events. */
export function planEvents(c, mow) {
  const ev = [];
  for (const f of c.feedings) {
    if (!['open', 'waiting', 'upcoming'].includes(f.status)) continue;
    const start = f.start <= f.end ? f.start : f.ws;
    ev.push({ uid: `${f.id}-${yearOf(start)}`, start: start < c.today ? c.today : start, end: f.end, title: `🌱 ${f.title}`, notes: [f.product ? `${f.product.name} · ${fmtNum(f.lbs, 1)} ${f.product.unit}${f.product.elite ? ` · spreader ${f.product.elite}` : ''}` : '', f.why].filter(Boolean).join('\n') });
  }
  for (const t of c.seasonTasks) {
    if (!['now', 'waiting', 'soon', 'later'].includes(t.status) || t.ongoing || t.kind === 'info') continue;
    if (t.we < c.today) continue;
    ev.push({ uid: `${t.id}-${yearOf(t.ws)}`, start: t.ws < c.today ? c.today : t.ws, end: t.we, title: `🌿 ${t.title}`, notes: [t.trigger?.text, t.why].filter(Boolean).join('\n') });
  }
  if (mow && mow.status === 'mow' && mow.date) {
    ev.push({ uid: `mow-${mow.date}`, start: mow.date, end: mow.date, title: `✂️ Mow at position ${mow.position} (${mow.height}″)`, notes: mow.reason });
  }
  return ev.sort((a, b) => (a.start < b.start ? -1 : 1));
}

/* ---------- ambient effects ---------- */

const RAIN = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99];
const SNOW = [71, 73, 75, 77, 85, 86];
const rnd = (i, salt) => { const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453; return x - Math.floor(x); };

/** Which ambience the photo header gets: weather first, then the season and time of day. */
export function heroMood({ code, winter, today, hour }) {
  const tod = hour < 6 || hour >= 21 ? 'night' : hour < 8 ? 'dawn' : hour >= 18 ? 'dusk' : 'day';
  let fx = null;
  if (RAIN.includes(code)) fx = 'rain';
  else if (SNOW.includes(code) || winter) fx = 'snow';
  else {
    const md = Number(today.slice(5, 7)) * 100 + Number(today.slice(8, 10));
    if (md >= 915 && md <= 1115) fx = 'leaves';
    else if (md >= 601 && md <= 831 && (tod === 'dusk' || tod === 'night')) fx = 'fireflies';
    else if (tod === 'night') fx = 'stars';
  }
  return { tod, fx };
}

const LEAF = '<svg viewBox="0 0 20 20"><path d="M3 17C3 9 8 3.5 17 3c-.3 9-6 14-14 14z"/><path d="M3 17c3-4 6-6.5 9.5-8.5" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="1"/></svg>';
const FX = {
  rain: { n: 34, dur: [0.7, 1.1] },
  snow: { n: 28, dur: [8, 15] },
  leaves: { n: 8, dur: [11, 18] },
  fireflies: { n: 12, dur: [5, 9] },
  stars: { n: 22, dur: [2.5, 5] },
};

/**
 * Particles carry a negative delay tied to the clock, so a re-render (every minute, or when weather lands)
 * picks each one up where it already was instead of restarting the animation.
 */
export function heroFxHtml({ tod, fx }, now) {
  const tint = `<div class="hero-tint tint-${tod}"></div>`;
  if (!fx) return `<div class="hero-fx" aria-hidden="true">${tint}</div>`;
  const cfg = FX[fx];
  const secs = now / 1000;
  const parts = Array.from({ length: cfg.n }, (_, i) => {
    const dur = cfg.dur[0] + rnd(i, 1) * (cfg.dur[1] - cfg.dur[0]);
    const delay = -((secs + rnd(i, 2) * dur) % dur);
    const x = 5 + rnd(i, 3) * 82;
    const y = fx === 'stars' ? 4 + rnd(i, 4) * 40 : fx === 'fireflies' ? 44 + rnd(i, 4) * 40 : 0;
    const s = 0.6 + rnd(i, 5) * 0.8;
    const hue = ['#e9a23b', '#d8692c', '#c2452b', '#f0c24f'][i % 4];
    return `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--t:${dur.toFixed(2)}s;--d:${delay.toFixed(2)}s;--s:${s.toFixed(2)};--c:${hue}">${fx === 'leaves' ? LEAF : ''}</i>`;
  }).join('');
  return `<div class="hero-fx fx-${fx}" aria-hidden="true">${tint}${parts}</div>`;
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A short burst of confetti in the accent colors. Pure CSS animation (no per-frame JavaScript), so it
 * never competes with a press-and-hold or a scroll for the main thread.
 */
export function confetti({ count = 70, duration = 2000 } = {}) {
  if (reduced() || typeof document === 'undefined') return;
  const box = document.createElement('div');
  box.className = 'confetti';
  box.setAttribute('aria-hidden', 'true');
  const colors = ['#c5f24a', '#e8ff9a', '#5ac8fa', '#ffffff', '#ffc451'];
  const W = window.innerWidth;
  const H = window.innerHeight;
  box.innerHTML = Array.from({ length: count }, (_, i) => {
    const x = (rnd(i, 8) - 0.5) * W * 0.95;
    const up = -(H * 0.12 + rnd(i, 9) * H * 0.18);
    const y = H * 0.45 + rnd(i, 10) * H * 0.35;
    const w = 5 + rnd(i, 12) * 6;
    return `<i style="--x:${x.toFixed(0)}px;--u:${up.toFixed(0)}px;--y:${y.toFixed(0)}px;--r:${(360 + rnd(i, 11) * 720).toFixed(0)}deg;--d:${(rnd(i, 13) * 120).toFixed(0)}ms;--t:${duration}ms;width:${w.toFixed(1)}px;height:${(w * 0.55).toFixed(1)}px;background:${colors[i % colors.length]}"></i>`;
  }).join('');
  document.body.appendChild(box);
  setTimeout(() => box.remove(), duration + 300);
}

/** "Trophy unlocked" card that drops in from the top. Separate from toasts so it never eats an Undo. */
export function trophyPop(list) {
  if (typeof document === 'undefined' || !list.length) return;
  document.querySelectorAll('.trophy-pop').forEach((n) => n.remove());
  const el = document.createElement('div');
  el.className = 'trophy-pop';
  el.setAttribute('role', 'status');
  el.innerHTML = `<span class="tp-ic">${icon(list[0].icon)}</span><span class="tp-main"><span class="tp-k">Trophy unlocked</span><span class="tp-t">${esc(list.map((t) => t.title).join(' · '))}</span></span>`;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, 3800);
  confetti();
}
