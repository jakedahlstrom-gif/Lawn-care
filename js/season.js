// Season planning: feeding windows, shopping list, season tasks, checklists, the Today agenda and winter mode.
// Pure functions (no DOM). Uses engine.js for weather and lawn math.

import {
  addDays, daysBetween, md, yearOf, sum, fmtMonthDay, relDayLower, fmtNum, WEEKDAYS_LONG, dow, maxDate,
} from './util.js';
import * as E from './engine.js';
import { shortName, defaultPlanProducts } from './defaults.js';

const f0 = (n) => fmtNum(n, 0);
const lower = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const mdToDate = (y, s) => `${y}-${s.slice(0, 2)}-${s.slice(2)}`;
export const SPACING_DAYS = 28;
/** Crabgrass sprouts once soil holds ~55°F; the preventer window opens as soil climbs past 50°F. */
export const PREVENTER = { opens: 50, target: 55, typicalOpen: '0424' };

/** "Oct 10–25" or "Sep 21 – Oct 25". */
export function rangeText(a, b) {
  if (a.slice(0, 7) === b.slice(0, 7)) return `${fmtMonthDay(a)}–${Number(b.slice(8, 10))}`;
  return `${fmtMonthDay(a)} – ${fmtMonthDay(b)}`;
}

/** Season year: fall and winter belong to the year the season started (Aug–Dec → this year, Jan–Jul → last year). */
export const seasonYear = (today) => (Number(today.slice(5, 7)) >= 8 ? yearOf(today) : yearOf(today) - 1);

export function productFor(id, settings, products, productType) {
  const pick = settings.planProducts?.[id] || defaultPlanProducts()[id];
  return products.find((p) => p.id === pick) || (productType ? products.find((p) => p.type === productType) : null) || null;
}

/* ======================= feeding windows ======================= */

export const FEEDINGS = [
  {
    id: 'feed-spring', season: 'spring', title: 'Crabgrass preventer + feeding', short: 'Early spring', combinedTitle: 'Spring feeding',
    productType: 'preemergent', window: ['0410', '0520'], soil: true,
    why: 'Halts stops crabgrass before it sprouts (soil holding about 55°F) and feeds the lawn. Water it in within a few days. Skip any spot you plan to seed.',
  },
  {
    id: 'feed-late-spring', season: 'spring', title: 'Late-spring feeding', short: 'Late spring', combinedTitle: 'Spring feeding',
    productType: 'fertilizer', window: ['0520', '0615'],
    why: 'Around Memorial Day, after the spring flush, a feeding carries bluegrass into summer without forcing soft growth.',
  },
  {
    id: 'feed-summer', season: 'summer', title: 'Light summer feeding', short: 'Summer', combinedTitle: 'Summer feeding', optional: true,
    productType: 'fertilizer', window: ['0701', '0725'], heat: true,
    why: 'Irrigated bluegrass can use a light early-July feeding. Skip it during heat waves or drought.',
  },
  {
    id: 'feed-early-fall', season: 'fall', title: 'Early-fall feeding', short: 'Early fall', combinedTitle: 'Early-fall feeding',
    productType: 'fertilizer', window: ['0825', '0920'],
    why: 'The most important feeding for bluegrass: it rebuilds roots and density after summer.',
  },
  {
    id: 'feed-late-fall', season: 'fall', title: 'Late-fall feeding', short: 'Late fall', combinedTitle: 'Fall feeding',
    productType: 'fertilizer', window: ['1010', '1025'],
    why: 'Top growth has slowed but roots still take up nitrogen, so the lawn greens up early next spring. Never spread on frozen ground — it runs off into the lake.',
  },
];

/**
 * This year's feeding windows with status. Rules: applications are at least 4 weeks apart, and a missed
 * (non-optional) window is folded into the next one instead of recommending both.
 * Status: done | open | waiting | upcoming | missed | skipped.
 */
export function feedingSchedule(ctx) {
  const { today, settings, products, zones, logs } = ctx;
  const cond = ctx.cond || E.conditions(ctx);
  const y = yearOf(today);
  const area = E.lawnArea(zones);
  const feeds = E.sortLogs(logs.filter(E.isFeeding)).reverse();
  const used = new Set();
  const lastFeedBy = (date) => E.sortLogs(feeds.filter((l) => l.date <= date))[0] || null;
  let carry = null;
  const out = [];

  for (const f of FEEDINGS) {
    const ws = mdToDate(y, f.window[0]);
    const we = mdToDate(y, f.window[1]);
    const product = productFor(f.id, settings, products, f.productType);
    const lbs = product ? E.amountFor(product, area) : 0;
    let start = ws;
    let optional = !!f.optional;
    const combinedWith = carry;
    if (carry) {
      optional = false;
      start = maxDate(addDays(carry.end, 1), addDays(ws, -21));
      if (start > ws) start = ws;
    }
    const row = {
      ...f, optional, product, lbs, ws, we, start, end: we, combinedWith,
      title: combinedWith ? f.combinedTitle : f.title, log: null, reason: '',
    };
    const log = feeds.find((l) => !used.has(l.id) && yearOf(l.date) === y && l.date >= addDays(start, -14) && l.date <= addDays(we, 3));
    if (log) {
      used.add(log.id);
      out.push({ ...row, status: 'done', log });
      carry = null;
      continue;
    }
    const lastF = lastFeedBy(today);
    if (lastF && addDays(lastF.date, SPACING_DAYS) > row.start && lastF.date >= addDays(ws, -120)) row.start = addDays(lastF.date, SPACING_DAYS);

    if (today > we) {
      row.status = optional ? 'skipped' : 'missed';
      row.reason = optional ? 'Optional — skipped this year.' : 'Missed — folded into the next feeding.';
      carry = optional ? (combinedWith || null) : { id: f.id, short: f.short, end: we };
      if (optional && combinedWith) carry = combinedWith;
      out.push(row);
      continue;
    }
    if (row.start > we) {
      row.status = 'skipped';
      row.reason = `Too soon after the ${fmtMonthDay(lastF.date)} feeding — feedings stay at least 4 weeks apart.`;
      carry = null;
      out.push(row);
      continue;
    }
    carry = null;
    let met = true;
    if (f.soil && cond.soil24 != null) {
      met = cond.soil24 >= PREVENTER.opens;
      if (met && today < row.start && today >= addDays(ws, -14) && (!lastF || addDays(lastF.date, SPACING_DAYS) <= today)) row.start = today;
      row.reason = met
        ? `Soil ${f0(cond.soil24)}°F (24-h avg)${cond.soil24 >= PREVENTER.target ? ' — crabgrass is starting; apply right away.' : ' and climbing toward 55°F — apply now.'}`
        : `Soil ${f0(cond.soil24)}°F — opens as soil climbs past 50°F toward 55°F.`;
    } else if (f.soil) {
      row.reason = 'When soil nears 55°F, usually mid-to-late April.';
    }
    if (f.heat && cond.hasWeather && cond.highs5 >= 85) {
      met = false;
      row.reason = `Highs near ${f0(cond.highs5)}°F — hold off until the heat breaks.`;
    }
    if (today >= row.start) row.status = met ? 'open' : 'waiting';
    else row.status = 'upcoming';
    if (combinedWith) row.reason = `The ${lower(combinedWith.short)} window was missed, so this one feeding covers both. ${row.reason}`.trim();
    out.push(row);
  }
  return out;
}

export function nextFeeding(schedule) {
  return schedule.find((f) => f.status === 'open' || f.status === 'waiting')
    || schedule.find((f) => f.status === 'upcoming')
    || null;
}

/** Header line: "Feeding window open now · WinterGuard" or "Next feeding: WinterGuard, Oct 10–25". */
export function feedingHeadline(ctx, schedule) {
  const f = nextFeeding(schedule);
  const springProduct = productFor('feed-spring', ctx.settings, ctx.products, 'preemergent');
  if (!f) return { open: false, text: `Next feeding: ${shortName(springProduct) || 'crabgrass preventer'}, next spring (soil ~55°F)` };
  const name = shortName(f.product) || 'fertilizer';
  if (f.status === 'open') return { open: true, text: `Feeding window open now · ${name}`, feeding: f };
  if (f.status === 'waiting' && f.soil) return { open: false, text: `Next feeding: ${name}, when soil nears 55°F`, feeding: f };
  if (f.status === 'waiting') return { open: false, text: `Next feeding: ${name} — holding off in the heat`, feeding: f };
  return { open: false, text: `Next feeding: ${name}, ${rangeText(f.start, f.end)}`, feeding: f };
}

/* ======================= shopping ======================= */

/** Bags to buy so `need` is covered after inventory, choosing the mix with the least left over. */
export function bagPlan(product, need) {
  if (!product || !(need > 0)) return null;
  const name = shortName(product);
  const unit = product.unit || 'lb';
  const onHand = Math.max(0, product.onHand || 0);
  const short = need - onHand;
  if (short <= 0.05) {
    return { enough: true, product, need, onHand, leftover: onHand - need, text: `You have enough ${name}: ${fmtNum(onHand, 1)} ${unit} on hand for ${fmtNum(need, 1)} ${unit}.` };
  }
  const opts = (product.bagOptions?.length ? product.bagOptions : [{ size: product.size, price: product.price }])
    .filter((o) => o.size > 0).sort((a, b) => a.size - b.size).slice(0, 4);
  if (!opts.length) return { enough: false, product, need, onHand, items: [], text: `Buy ${fmtNum(short, 1)} ${unit} of ${name}.` };
  let best = null;
  const counts = new Array(opts.length).fill(0);
  const maxes = opts.map((o) => Math.ceil(short / o.size));
  const visit = (i) => {
    if (i === opts.length) {
      const totalLb = opts.reduce((t, o, j) => t + o.size * counts[j], 0);
      if (totalLb + 1e-9 < short) return;
      const bags = counts.reduce((a, b) => a + b, 0);
      const cost = opts.reduce((t, o, j) => t + (o.price || 0) * counts[j], 0);
      const cand = { counts: [...counts], totalLb, leftover: totalLb - short, bags, cost };
      const key = (c) => [Math.round(c.leftover * 10), c.bags, c.cost];
      if (!best) { best = cand; return; }
      const [a, b] = [key(cand), key(best)];
      if (a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] < b[2])))) best = cand;
      return;
    }
    for (let c = 0; c <= maxes[i]; c++) { counts[i] = c; visit(i + 1); }
    counts[i] = 0;
  };
  visit(0);
  const items = opts.map((o, j) => ({ size: o.size, price: o.price || 0, count: best.counts[j] })).filter((x) => x.count > 0);
  const left = best.leftover;
  const leftText = left < 0.5 ? 'nothing left over' : `about ${fmtNum(left, 0)} ${unit} left over`;
  const what = items.length === 1 && items[0].count === 1
    ? `1 bag of ${name} (${fmtNum(items[0].size, 2)} ${unit})`
    : `${items.map((x) => `${x.count} × ${fmtNum(x.size, 2)} ${unit}`).join(' + ')} ${best.bags === 1 ? 'bag' : 'bags'} of ${name}`;
  return {
    enough: false, product, need, onHand, items, bags: best.bags, leftover: left, cost: best.cost,
    text: `Buy ${what} — ${leftText}`,
  };
}

/** Shopping for the next feeding (Today screen): shown when it's open or opens within 3 weeks. */
export function feedingShopping(ctx, schedule) {
  const f = nextFeeding(schedule);
  if (!f || !f.product) return null;
  if (f.status === 'upcoming' && daysBetween(ctx.today, f.start) > 21) return null;
  const plan = bagPlan(f.product, f.lbs);
  return plan ? { feeding: f, items: [plan] } : null;
}

/** Spring products to have on hand: the preventer and the late-spring feeding. */
export function springShopping(ctx) {
  const area = E.lawnArea(ctx.zones);
  const needs = new Map();
  for (const id of ['feed-spring', 'feed-late-spring']) {
    const f = FEEDINGS.find((x) => x.id === id);
    const p = productFor(id, ctx.settings, ctx.products, f.productType);
    if (!p) continue;
    const row = needs.get(p.id) || { product: p, need: 0, uses: [] };
    row.need += E.amountFor(p, area);
    row.uses.push(f.short.toLowerCase());
    needs.set(p.id, row);
  }
  return [...needs.values()].map((r) => ({ ...bagPlan(r.product, r.need), uses: r.uses })).filter((x) => x && x.product);
}

/* ======================= other season tasks ======================= */

const soilTrigger = (c, target, hint) => {
  if (c.soil24 == null) return { met: null, text: `When soil reaches ${target}°F. ${hint}` };
  return { met: c.soil24 >= target, text: `Soil ${f0(c.soil24)}°F (24-h avg), trigger ${target}°F. ${hint}` };
};

export const TASKS = [
  {
    id: 'spring-cleanup', season: 'spring', title: 'Spring cleanup', kind: 'other', otherKind: 'cleanup', window: ['0320', '0510'],
    why: 'Rake matted patches to prevent snow mold, clear debris, and check for vole trails. Wait until the soil is firm so you don’t compact it.',
    trigger: (c) => (c.soil24 == null ? { met: null, text: 'Once snow is gone and the soil has thawed' } : { met: c.soil24 >= 40, text: `Soil ${f0(c.soil24)}°F (thawed at 40°F+)` }),
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
    id: 'spray-spring', season: 'spring', title: 'Spot-spray weeds', kind: 'weed', productType: 'weed', window: ['0515', '0630'],
    why: 'Spot-treat dandelions and clover with the hand pump sprayer while they’re growing actively; pull what you can by hand. Needs highs 50–85°F, wind under 10 mph and 24 dry hours.',
    trigger: (c) => (c.hasWeather ? { met: c.highs5 >= 50 && c.highs5 <= 85, text: `Highs ~${f0(c.highs5)}°F (spray at 50–85°F, calm, 24 h dry)` } : { met: null, text: 'Highs 50–85°F, calm, 24 h dry' }),
  },
  {
    id: 'grubs', season: 'summer', title: 'Grub control (only if needed)', optional: true, kind: 'fert', productType: 'grub', window: ['0515', '0715'],
    why: 'Only if you’ve had grub damage (brown patches that peel back like carpet) or lots of beetles. GrubEx works on the next generation, so it goes down late spring to early summer and gets watered in.',
    trigger: () => ({ met: true, text: 'Late spring to early summer, only if needed' }),
  },
  {
    id: 'summer-height', season: 'summer', title: 'Raise mowing height for heat', kind: 'info', window: ['0615', '0831'],
    why: 'Taller grass (3.5–4″) shades the soil, keeps roots cooler, and holds moisture through hot spells.',
    trigger: (c) => (c.hasWeather ? { met: c.maxHigh7 >= 85, text: `Highs up to ${f0(c.maxHigh7)}°F this week (trigger 85°F)` } : { met: null, text: 'When highs reach 85°F' }),
  },
  {
    id: 'aerate', season: 'fall', title: 'Core aeration', optional: true, kind: 'other', otherKind: 'aerate', window: ['0825', '1005'], grace: 0,
    why: 'Optional — relieves compaction in clay soil. Aerating right before the fall feeding helps fertilizer reach the roots. Every 1–2 years is plenty.',
    trigger: (c) => (c.soil24 == null ? { met: null, text: 'Soil 50–70°F and moist' } : { met: c.soil24 >= 50 && c.soil24 <= 70, text: `Soil ${f0(c.soil24)}°F (best 50–70°F, moist)` }),
  },
  {
    id: 'spray-fall', season: 'fall', title: 'Spot-spray weeds', kind: 'weed', productType: 'weed', window: ['0910', '1020'], grace: 7,
    why: 'Perennial weeds pull herbicide down to their roots as they store food for winter, so fall gives the best kill. Spot-spray with the hand pump sprayer before a hard freeze.',
    trigger: (c) => {
      if (!c.hasWeather) return { met: null, text: 'Highs 50–85°F, calm, 24 h dry, before a hard freeze' };
      const ok = c.highs5 >= 50 && c.highs5 <= 85 && !c.pastHardFreeze;
      const freeze = c.hardFreeze ? ` Hard freeze forecast ${fmtMonthDay(c.hardFreeze.date)} — spray before then.` : '';
      return { met: ok, text: `Highs ~${f0(c.highs5)}°F (spray at 50–85°F).${freeze}` };
    },
  },
  {
    id: 'pull-weeds', season: 'all', title: 'Pull weeds', kind: 'pull', window: ['0415', '1031'], ongoing: true,
    why: 'Pull by hand when the soil is soft after a rain so the whole root comes out. Spot-spray only what you can’t pull.',
    trigger: () => ({ met: true, text: 'Anytime — easiest the day after a good rain' }),
  },
];

function taskMatchesLog(t, l) {
  if (t.kind === 'weed') return l.type === 'weed';
  if (t.kind === 'pull') return l.type === 'pull';
  if (t.kind === 'mow') return l.type === 'mow';
  if (t.kind === 'other') return l.type === 'other' && l.kind === t.otherKind;
  if (t.kind === 'fert') return l.type === 'fert' && (l.productType === t.productType || (!l.productType && t.productType === 'fertilizer'));
  return false;
}

/** Non-feeding tasks with status: done | now | waiting | soon | later | past. */
export function seasonTasks(ctx) {
  const { today, settings, products, zones, logs } = ctx;
  const cond = ctx.cond || E.conditions(ctx);
  const y = yearOf(today);
  const area = E.lawnArea(zones);
  const checks = settings.planChecks?.[y] || {};
  return TASKS.map((t) => {
    const ws = mdToDate(y, t.window[0]);
    const we = mdToDate(y, t.window[1]);
    const graceEnd = addDays(we, t.grace ?? 10);
    const doneLog = t.kind === 'info' || t.ongoing ? null
      : E.sortLogs(logs.filter((l) => l.date >= addDays(ws, -21) && l.date <= addDays(graceEnd, 20) && l.date <= today && taskMatchesLog(t, l)))[0] || null;
    const trig = t.trigger(cond, today);
    const product = t.productType ? productFor(t.id, settings, products, t.productType) : null;
    let status;
    if (doneLog || checks[t.id]) status = 'done';
    else if (today > graceEnd) status = 'past';
    else if (today >= ws) status = trig.met === false ? 'waiting' : 'now';
    else if (trig.met === true && daysBetween(today, ws) <= 21 && t.kind !== 'info' && !t.ongoing && t.id !== 'grubs') status = 'now';
    else if (daysBetween(today, ws) <= 14) status = 'soon';
    else status = 'later';
    if (t.kind === 'info' && status === 'waiting') status = 'later';
    return {
      ...t, status, trigger: trig, ws, we, graceEnd, windowText: rangeText(ws, we),
      doneLog, manual: !!checks[t.id] && !doneLog, product,
      lbs: product && product.type !== 'weed' ? E.amountFor(product, area) : null,
    };
  });
}

/* ======================= checklists ======================= */

export const FALL_CHECKLIST = [
  {
    id: 'fall-fert', title: 'Fall fertilizer feeding', logAs: { type: 'fert' },
    detail: 'WinterGuard in fall — one feeding if the early-fall window was missed.',
    match: (l) => E.isFeeding(l) && md(l.date) >= 815,
  },
  {
    id: 'final-mow', title: 'Final lower mow (about 2.5″)', logAs: { type: 'mow', final: true },
    detail: 'Late October or November. Step down gradually so you never cut more than a third.',
    match: (l) => l.type === 'mow' && (l.final || (md(l.date) >= 1010 && l.height <= 2.75)),
  },
  {
    id: 'blowout', title: 'Sprinkler blowout before the first hard freeze', logAs: { type: 'other', kind: 'blowout' },
    detail: 'Blow out the Rachio zones before the first night at 28°F or colder.',
    match: (l) => l.type === 'other' && l.kind === 'blowout',
  },
  {
    id: 'battery', title: 'EGO battery stored indoors', logAs: { type: 'other', kind: 'battery' },
    detail: 'Off the mower and charger, indoors above freezing and out of heat, partly charged.',
    match: (l) => l.type === 'other' && l.kind === 'battery',
  },
  {
    id: 'spreader', title: 'Clean the spreader', logAs: { type: 'other', kind: 'spreader' },
    detail: 'Rinse the Elite after the last application, dry it, and lube the wheels and gate pivot.',
    match: (l) => l.type === 'other' && l.kind === 'spreader',
  },
];

export const WINTER_CHECKLIST = [
  { id: 'battery', title: 'EGO battery stored indoors', logAs: { type: 'other', kind: 'battery' }, detail: 'Partly charged, above freezing, off the charger.', match: (l) => l.type === 'other' && l.kind === 'battery' },
  { id: 'spreader', title: 'Spreader cleaned', logAs: { type: 'other', kind: 'spreader' }, detail: 'Rinsed, dried and lubed so the gate doesn’t seize.', match: (l) => l.type === 'other' && l.kind === 'spreader' },
  { id: 'bags', title: 'Fertilizer bags stored dry', logAs: { type: 'other', kind: 'bags' }, detail: 'Seal opened bags and keep them off the garage floor so they don’t cake.', match: (l) => l.type === 'other' && l.kind === 'bags' },
];

function checklistStatus(ctx, list) {
  const { today, settings, logs } = ctx;
  const sy = seasonYear(today);
  const from = `${sy}-08-15`;
  const checks = settings.planChecks?.[sy] || {};
  const cond = ctx.cond || E.conditions(ctx);
  return list.map((item) => {
    const log = E.sortLogs(logs.filter((l) => l.date >= from && l.date <= today && item.match(l)))[0] || null;
    let urgent = null;
    if (!log && !checks[item.id] && item.id === 'blowout' && cond.hardFreeze) {
      urgent = `Hard freeze (${f0(cond.hardFreeze.tMin)}°F) forecast ${relDayLower(cond.hardFreeze.date, today)} — blow out before then.`;
    }
    return { ...item, done: !!log || !!checks[item.id], log, manual: !!checks[item.id] && !log, urgent, year: sy };
  });
}

export const fallChecklist = (ctx) => checklistStatus(ctx, FALL_CHECKLIST);

/** Winter checklist plus any fall tasks still open. */
export function winterChecklist(ctx) {
  const winter = checklistStatus(ctx, WINTER_CHECKLIST);
  const ids = new Set(winter.map((i) => i.id));
  const leftover = fallChecklist(ctx).filter((i) => !i.done && !ids.has(i.id)).map((i) => ({ ...i, fromFall: true }));
  return [...winter, ...leftover];
}

/* ======================= Today agenda ======================= */

/**
 * Items for the Today screen, grouped: today (Do today / Optional), tomorrow (Scheduled) and next (This week /
 * Scheduled). The mow recommendation has its own card and never appears here.
 */
export function agenda(ctx) {
  const { today, now, weather, zones, logs } = ctx;
  const cond = ctx.cond || E.conditions(ctx);
  const tomorrow = addDays(today, 1);
  const schedule = ctx.feedings || feedingSchedule(ctx);
  const tasks = ctx.seasonTasks || seasonTasks({ ...ctx, cond });
  const lawnIds = E.lawnZones(zones).map((z) => z.id);
  const out = { today: [], tomorrow: [], next: [] };
  const place = (date, item, weekBadge = 'week') => {
    if (date === today) out.today.push({ ...item, badge: item.badge || 'today' });
    else if (date === tomorrow) out.tomorrow.push({ ...item, badge: 'scheduled' });
    else out.next.push({ ...item, badge: weekBadge });
  };
  const recent = (type, days, extra = () => true) => logs.some((l) => l.type === type && l.date <= today && daysBetween(l.date, today) < days && extra(l));

  // Feeding.
  const f = nextFeeding(schedule);
  if (f) {
    const p = f.product;
    const name = shortName(p) || 'fertilizer';
    const amount = p ? `${name} ${fmtNum(f.lbs, 1)} ${p.unit}${p.elite ? ` · Elite ${p.elite}` : ''}` : name;
    const base = { id: f.id, icon: 'bag', title: f.title, action: { type: 'feeding', id: f.id } };
    if (f.status === 'open') {
      const days = Math.max(1, Math.min(7, daysBetween(today, f.end) + 1));
      const win = E.applicationWindow({ weather, product: p, zoneIds: lawnIds, zones, today, now, days });
      const best = win.best;
      if (!win.available) place(today, { ...base, reason: `${amount}. Open through ${fmtMonthDay(f.end)}.` });
      else if (best) {
        const when = best.date === today || best.date === tomorrow ? '' : `Best ${WEEKDAYS_LONG[dow(best.date)]} · `;
        place(best.date, { ...base, reason: `${when}${amount}${best.rating === 'ok' ? ' · light rain OK' : ''}` });
      } else out.next.push({ ...base, badge: 'week', reason: `Hold off — rain or cold all week. Open through ${fmtMonthDay(f.end)}.` });
    } else if (f.status === 'waiting') {
      out.next.push({ ...base, badge: 'scheduled', reason: f.soil && cond.soil24 != null ? `Soil ${f0(cond.soil24)}°F — opens near 50–55°F` : 'Holding off in the heat' });
    } else if (f.status === 'upcoming' && daysBetween(today, f.start) <= 45) {
      out.next.push({ ...base, badge: 'scheduled', reason: `Opens ${rangeText(f.start, f.end)} · ${amount}` });
    }
  }

  // Spot spraying (spring / fall windows), unless sprayed in the last two weeks.
  for (const t of tasks.filter((x) => x.kind === 'weed' && x.status === 'now')) {
    if (recent('weed', 14)) break;
    const p = t.product;
    const win = E.applicationWindow({ weather, product: p || { type: 'weed', noRainHours: 24 }, zoneIds: lawnIds, zones, today, now, kind: 'weed' });
    const best = win.days.find((d) => d.rating === 'good');
    if (!best) continue;
    const when = best.date === today || best.date === tomorrow ? '' : `Best ${WEEKDAYS_LONG[dow(best.date)]} · `;
    place(best.date, { id: t.id, icon: 'spray', title: 'Spot spray', reason: `${when}${best.note}`, action: { type: 'log', logType: 'weed' } });
    break;
  }

  // Pulling weeds after rain.
  const pullTask = tasks.find((t) => t.id === 'pull-weeds');
  if (pullTask && pullTask.status === 'now' && !recent('pull', 3)) {
    const p0 = E.pullDay(weather, today, logs, zones);
    const p1 = E.pullDay(weather, tomorrow, logs, zones);
    if (p0.good) out.today.push({ id: 'pull-weeds', icon: 'hand', title: 'Pull weeds', badge: 'today', reason: p0.note, action: { type: 'log', logType: 'pull' } });
    else if (p1.good && weather) out.tomorrow.push({ id: 'pull-weeds', icon: 'hand', title: 'Pull weeds', badge: 'scheduled', reason: p1.note.replace('Soft soil', 'Soft soil tomorrow'), action: { type: 'log', logType: 'pull' } });
  }

  // Core aeration: optional, never "Do today".
  const aer = tasks.find((t) => t.id === 'aerate');
  if (aer && aer.status === 'now') {
    out.today.push({
      id: 'aerate', icon: 'aerate', title: 'Core aeration', badge: 'optional',
      reason: 'Optional — good week to aerate. Right before feeding helps fertilizer reach the roots.',
      action: { type: 'task', id: 'aerate' },
    });
  }

  // Sprinkler blowout before a hard freeze.
  const fall = fallChecklist({ ...ctx, cond });
  const blow = fall.find((i) => i.id === 'blowout');
  const m = md(today);
  if (blow && !blow.done && m >= 901) {
    const action = { type: 'log', logType: 'other', kind: 'blowout' };
    if (cond.hardFreeze) {
      const n = daysBetween(today, cond.hardFreeze.date);
      const item = { id: 'blowout', icon: 'snow', title: 'Blowout', reason: `Hard freeze ${relDayLower(cond.hardFreeze.date, today)} (${f0(cond.hardFreeze.tMin)}°F) — blow out before then`, action };
      if (n <= 1) out.today.push({ ...item, badge: 'today' });
      else out.next.push({ ...item, badge: 'week' });
    } else if (m >= 1015) {
      out.next.push({ id: 'blowout', icon: 'snow', title: 'Blowout', badge: 'scheduled', reason: 'Before the first hard freeze', action });
    }
  }

  // Fall wrap-up once the work it depends on is done.
  if (m >= 901) {
    const finalMow = fall.find((i) => i.id === 'final-mow');
    const battery = fall.find((i) => i.id === 'battery');
    if (finalMow?.done && battery && !battery.done) {
      out.next.push({ id: 'battery', icon: 'battery', title: 'Store battery', badge: 'week', reason: 'EGO battery indoors, partly charged', action: { type: 'log', logType: 'other', kind: 'battery' } });
    }
    const feedingsLeft = schedule.some((x) => x.season === 'fall' && ['open', 'waiting', 'upcoming'].includes(x.status));
    const fedThisFall = schedule.some((x) => x.season === 'fall' && x.status === 'done');
    const spreader = fall.find((i) => i.id === 'spreader');
    if (fedThisFall && !feedingsLeft && spreader && !spreader.done) {
      out.next.push({ id: 'spreader', icon: 'spreader', title: 'Clean spreader', badge: 'week', reason: 'Last feeding is down — rinse, dry, lube', action: { type: 'log', logType: 'other', kind: 'spreader' } });
    }
  }

  // Spring chores.
  for (const id of ['spring-cleanup', 'irrigation-startup']) {
    const t = tasks.find((x) => x.id === id);
    if (t && t.status === 'now') out.next.push({ id, icon: id === 'spring-cleanup' ? 'leaf' : 'drop', title: t.title, badge: 'week', reason: t.trigger.text, action: { type: 'log', logType: 'other', kind: t.otherKind } });
  }
  return out;
}

/* ======================= winter mode ======================= */

function slopePerDay(points) {
  if (points.length < 3) return null;
  const xs = points.map((_, i) => i);
  const mx = sum(xs) / xs.length;
  const my = sum(points, (p) => p.soil) / points.length;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => { num += (i - mx) * (p.soil - my); den += (i - mx) ** 2; });
  return den ? num / den : null;
}

/** Everything the winter screen shows: conditions, soil trend, spring countdown, checklist, recap, shopping. */
export function winterInfo(ctx) {
  const { today, now, weather } = ctx;
  const cond = ctx.cond || E.conditions(ctx);
  const y = yearOf(today);
  const springYear = Number(today.slice(5, 7)) >= 7 ? y + 1 : y;
  const cur = weather?.current || null;
  const td = weather?.dayMap?.[today] || null;
  const idx = E.hourIndexNow(weather, now);
  const depth = idx != null ? weather.hours[idx].snowDepth : null;
  const snowWeek = weather ? sum(E.dayTable(weather, addDays(today, -6), today).filter((d) => !d.est), (d) => d.snow || 0) : null;

  const series = weather ? E.dayTable(weather, addDays(today, -21), addDays(today, 15)).filter((d) => !d.est && d.soil != null).map((d) => ({ date: d.date, soil: d.soil, future: d.date > today })) : [];
  const recentPts = series.filter((p) => p.date <= today).slice(-10);
  const slope = slopePerDay(recentPts);
  const trend = slope == null ? null : { perWeek: slope * 7, text: Math.abs(slope * 7) < 1 ? 'Holding steady' : slope > 0 ? `Rising ~${fmtNum(slope * 7, 0)}°F a week` : `Falling ~${fmtNum(-slope * 7, 0)}°F a week` };

  const reach = series.find((p) => p.date >= today && p.soil >= PREVENTER.opens) || null;
  const typical = mdToDate(springYear, PREVENTER.typicalOpen);
  const opensOn = reach ? reach.date : (today > typical ? today : typical);
  const daysUntil = daysBetween(today, opensOn);
  const product = productFor('feed-spring', ctx.settings, ctx.products, 'preemergent');
  const plan = product ? bagPlan(product, E.amountFor(product, E.lawnArea(ctx.zones))) : null;
  const soonAlert = daysUntil >= 0 && daysUntil <= 14 && Number(today.slice(5, 7)) <= 6;
  const countdown = {
    target: PREVENTER.target,
    opens: PREVENTER.opens,
    soil: cond.soil24,
    opensOn,
    source: reach ? 'forecast' : 'typical',
    daysUntil,
    alert: soonAlert,
    product,
    text: reach
      ? `Forecast reaches ${PREVENTER.opens}°F around ${fmtMonthDay(reach.date)} — the crabgrass preventer window opens then.`
      : `The crabgrass preventer window usually opens in late April, when soil climbs past ${PREVENTER.opens}°F toward ${PREVENTER.target}°F.`,
    alertText: soonAlert ? `Window likely opens in ${daysUntil <= 1 ? 'a day or two' : `about ${daysUntil} days`} — ${plan && !plan.enough ? `time to buy ${shortName(product)}.` : `you have ${shortName(product)} ready.`}` : null,
  };

  const recapYear = Number(today.slice(5, 7)) >= 11 ? y : y - 1;
  const recap = { year: recapYear, ...E.seasonTotals(ctx, recapYear) };
  return {
    temp: cur?.temp ?? null, code: cur?.code ?? td?.code ?? null,
    hi: td?.tMax ?? null, lo: td?.tMin ?? null,
    snowToday: td?.snow ?? null, snowWeek, depth,
    soil: cond.soil24, series, trend, countdown, recap,
    checklist: winterChecklist(ctx), shopping: springShopping(ctx),
  };
}

/** Keys used to remember that this season's on/off suggestion was handled. */
export function winterPromptKeys(today) {
  const springYear = Number(today.slice(5, 7)) >= 7 ? yearOf(today) + 1 : yearOf(today);
  return { on: `on-${seasonYear(today)}`, off: `off-${springYear}` };
}

/** One-tap suggestion to switch Winter Mode on (after wrap-up or a hard freeze) or off (spring soil warming). */
export function winterPrompt(ctx) {
  const { today, settings, logs } = ctx;
  const cond = ctx.cond || E.conditions(ctx);
  const on = !!settings.winter?.on;
  const dismissed = settings.winter?.dismissed || {};
  const m = md(today);
  if (!on) {
    const sy = seasonYear(today);
    const key = `on-${sy}`;
    if (dismissed[key]) return null;
    const fallLogs = logs.filter((l) => l.date >= `${sy}-08-15` && l.date <= today);
    const finalMow = fallLogs.some((l) => l.type === 'mow' && l.final);
    const blowout = fallLogs.some((l) => l.type === 'other' && l.kind === 'blowout');
    const coldSeason = m >= 915 || m < 315;
    const freeze = coldSeason && (cond.pastHardFreeze || (cond.next[0] && !cond.next[0].est && cond.next[0].tMin <= 28 && m >= 1001));
    if (finalMow && blowout) return { action: 'on', key, title: 'Switch to Winter Mode?', text: 'Your final mow and sprinkler blowout are logged.' };
    if (freeze) return { action: 'on', key, title: 'Switch to Winter Mode?', text: 'The first hard freeze is here.' };
    return null;
  }
  const springYear = Number(today.slice(5, 7)) >= 7 ? yearOf(today) + 1 : yearOf(today);
  const key = `off-${springYear}`;
  if (dismissed[key]) return null;
  if (m >= 301 && m < 1001) {
    const pts = (ctx.weather ? E.dayTable(ctx.weather, addDays(today, -10), today).filter((d) => !d.est) : []).map((d) => ({ soil: d.soil }));
    const s = slopePerDay(pts);
    const rising = s != null && s > 0.1;
    if ((cond.soil24 != null && cond.soil24 >= 40 && rising) || m >= 415) {
      return { action: 'off', key, title: 'Spring is coming — turn off Winter Mode?', text: cond.soil24 != null ? `Soil is ${f0(cond.soil24)}°F and rising.` : 'Spring tasks are starting.' };
    }
  }
  return null;
}
