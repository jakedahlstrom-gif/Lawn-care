// Rachio sprinkler runs: turn controller events into runs (actual minutes watered), match Rachio zones to the
// app's zones, pick each zone's nozzle rate, and work out inches and gallons. Pure functions only (no DOM or
// storage); fetching and saving live in views/rachio.js and store.js.

import { dateStr, sum } from './util.js';

const GAL_PER_SQFT_INCH = 0.623;
const DAY = 86400e3;

/* ======================= zones ======================= */

/** Rachio zones from /person/:id devices: number, name, nozzle rate (in/hr) and area when Rachio has them. */
export function rachioZones(devices = []) {
  return devices.flatMap((d) => (d.zones || []).map((z) => ({
    id: String(z.id || `${d.id}-${z.zoneNumber}`),
    deviceId: d.id,
    number: Number(z.zoneNumber) || null,
    name: String(z.name || `Zone ${z.zoneNumber}`),
    enabled: z.enabled !== false,
    rate: Number(z.customNozzle?.inchesPerHour) > 0 ? Number(z.customNozzle.inchesPerHour) : null,
    nozzle: z.customNozzle?.name || '',
    sqft: Number(z.yardAreaSquareFeet) > 0 ? Number(z.yardAreaSquareFeet) : null,
    lastWatered: Number(z.lastWateredDate) || null,
    lastSeconds: Number(z.lastWateredDuration) || null,
  })));
}

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const FILLER = new Set(['zone', 'yard', 'lawn', 'grass', 'turf', 'the', 'and']);
const words = (s) => new Set(norm(s).split(' ').filter((w) => w && !FILLER.has(w) && !/^\d+$/.test(w)));

/** How alike two zone names are, 0–1: identical, or the share of meaningful words they have in common. */
export function nameScore(a, b) {
  if (norm(a) && norm(a) === norm(b)) return 1;
  const A = words(a);
  const B = words(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  A.forEach((w) => { if (B.has(w)) shared++; });
  return shared / Math.max(A.size, B.size);
}

/** Zone number written in an app zone's name ("Zone 3", "3. Back"), else its position in the list. */
const appNumber = (z) => Number((/^(\d+)[.)\s]|\bzone\s*(\d+)\b/i.exec(z.name || '') || []).slice(1).find(Boolean)) || z.order || null;

/**
 * Match each Rachio zone to an app zone: your choice first (zoneMap: Rachio zone id → app zone id, or 'none'),
 * then by name, then by zone number. Automatic matches are one-to-one.
 * Returns { [rachioZoneId]: { zoneId, how: 'manual' | 'name' | 'number' | 'none' } }.
 */
export function matchZones(rzones, appZones, zoneMap = {}) {
  const out = {};
  const taken = new Set();
  const auto = [];
  for (const rz of rzones) {
    const pick = zoneMap[rz.id];
    if (pick === 'none') out[rz.id] = { zoneId: null, how: 'manual' };
    else if (pick && appZones.some((z) => z.id === pick)) { out[rz.id] = { zoneId: pick, how: 'manual' }; taken.add(pick); } else auto.push(rz);
  }
  const pairs = [];
  for (const rz of auto) {
    for (const z of appZones) {
      const s = nameScore(rz.name, z.name);
      if (s >= 0.5) pairs.push({ rz, z, score: s + (rz.number && rz.number === appNumber(z) ? 0.25 : 0) });
    }
  }
  pairs.sort((a, b) => b.score - a.score || (a.rz.number || 0) - (b.rz.number || 0));
  for (const p of pairs) {
    if (out[p.rz.id] || taken.has(p.z.id)) continue;
    out[p.rz.id] = { zoneId: p.z.id, how: 'name' };
    taken.add(p.z.id);
  }
  for (const rz of auto) {
    if (out[rz.id]) continue;
    const z = rz.number ? appZones.find((x) => !taken.has(x.id) && appNumber(x) === rz.number) : null;
    if (z) taken.add(z.id);
    out[rz.id] = z ? { zoneId: z.id, how: 'number' } : { zoneId: null, how: 'none' };
  }
  return out;
}

/**
 * Precipitation rate for a Rachio zone: Rachio's nozzle rate, else the one you entered, else the matched app
 * zone's rate as an estimate until you enter one. Source: rachio | manual | estimate | missing.
 */
export function zoneRate(rz, settings, appZone) {
  if (rz?.rate > 0) return { value: rz.rate, source: 'rachio' };
  const mine = Number(settings?.rachio?.rates?.[rz?.id]);
  if (mine > 0) return { value: mine, source: 'manual' };
  if (appZone?.precip > 0) return { value: appZone.precip, source: 'estimate' };
  return { value: null, source: 'missing' };
}

/** Rachio zones from the last sync plus any seen only in saved runs (a zone since removed from Rachio). */
export function knownZones(rachio, runs = []) {
  const list = [...(rachio?.zones || [])];
  const ids = new Set(list.map((z) => z.id));
  for (const r of runs) {
    if (ids.has(r.zoneId)) continue;
    ids.add(r.zoneId);
    list.push({ id: r.zoneId, deviceId: r.deviceId, number: r.zoneNumber, name: r.zoneName, enabled: true, rate: null, nozzle: '', sqft: null, gone: true });
  }
  return list;
}

/** Everything needed to turn a run on each Rachio zone into water: the zone, its match, app zone and rate. */
export function zoneInfo({ rachio, runs, zones, settings }) {
  const rzones = knownZones(rachio, runs);
  const match = matchZones(rzones, zones, settings?.rachio?.zoneMap || {});
  return Object.fromEntries(rzones.map((rz) => {
    const appZone = zones.find((z) => z.id === match[rz.id].zoneId) || null;
    return [rz.id, { rz, match: match[rz.id], appZone, rate: zoneRate(rz, settings, appZone) }];
  }));
}

/* ======================= runs ======================= */

const KIND = {
  ZONE_STARTED: 'start', ZONE_COMPLETED: 'completed', ZONE_STOPPED: 'stopped', ZONE_CYCLING: 'cycle', ZONE_CYCLING_COMPLETED: 'cycle-done',
};

/** A value from the event itself or its eventDatas list. */
function datum(e, key) {
  if (!e) return null;
  if (e[key] != null && e[key] !== '') return e[key];
  const d = (e.eventDatas || []).find((x) => x && x.key === key);
  const v = d ? (d.convertedValue ?? d.value) : null;
  return v == null || v === '' ? null : v;
}

function kindOf(e) {
  if (KIND[e.subType]) return KIND[e.subType];
  if (e.type && e.type !== 'ZONE_STATUS') return null; // schedule, rain delay and device events aren't zone runs
  const s = String(e.summary || '').toLowerCase();
  if (/\b(began|started)\b/.test(s)) return 'start';
  if (/\bstopped\b/.test(s)) return 'stopped';
  if (/\bcompleted\b/.test(s)) return /\bcycl/.test(s) ? 'cycle-done' : 'completed';
  return null;
}

function zoneOf(e, zones) {
  const id = datum(e, 'zoneId');
  const byId = id && zones.find((z) => z.id === String(id));
  if (byId) return byId;
  const n = Number(datum(e, 'zoneNumber'));
  const byNumber = n && zones.find((z) => z.number === n);
  if (byNumber) return byNumber;
  // Summaries start with the zone name: "Back Yard completed watering at 6:20 AM for 20 minutes."
  const s = norm(datum(e, 'zoneName') || e.summary);
  return zones
    .filter((z) => norm(z.name) && (s === norm(z.name) || s.startsWith(`${norm(z.name)} `)))
    .sort((a, b) => norm(b.name).length - norm(a.name).length)[0] || null;
}

/** "for 1 hour 5 minutes" → 3900 seconds. */
function textSeconds(text) {
  const m = /\bfor\s+((?:\d+(?:\.\d+)?\s*(?:hours?|hrs?|minutes?|mins?|seconds?|secs?)[\s,]*(?:and\s+)?)+)/i.exec(text || '');
  if (!m) return null;
  let t = 0;
  for (const [, v, u] of m[1].matchAll(/(\d+(?:\.\d+)?)\s*(h|m|s)/gi)) t += Number(v) * ({ h: 3600, m: 60, s: 1 }[u.toLowerCase()]);
  return t > 0 ? t : null;
}

/** The duration an event reports, in seconds (from its data or its summary). */
function reportedSeconds(e) {
  if (!e) return null;
  const sec = Number(datum(e, 'duration'));
  if (sec > 0) return sec;
  const min = Number(datum(e, 'durationInMinutes'));
  if (min > 0) return min * 60;
  return textSeconds(e.summary);
}

const timeOf = (v) => (v == null ? null : typeof v === 'number' ? v : Date.parse(v) || Number(v) || null);

/**
 * Runs from one device's events. Each start is paired with the next end for the same zone. The run counts the time
 * the zone actually watered: the elapsed time from start to end, or the reported duration if that's shorter
 * (cycle-and-soak). So a run stopped early counts only the minutes it ran, never the scheduled time. An end with no
 * start in the window uses its reported duration, unless it's the tail of a cycle-and-soak run already counted.
 */
export function parseRuns(events, device, zones) {
  const evs = (Array.isArray(events) ? events : [])
    .map((e) => ({ e, kind: kindOf(e), zone: zoneOf(e, zones), at: timeOf(datum(e, 'endTime')) ?? timeOf(e.eventDate) }))
    .filter((x) => x.kind && x.zone && x.at > 0)
    .sort((a, b) => a.at - b.at);
  const open = new Map();
  const lastEnd = new Map();
  const runs = [];
  for (const x of evs) {
    const zid = x.zone.id;
    if (x.kind === 'start') { open.set(zid, x); continue; }
    const st = open.get(zid) || null;
    open.delete(zid);
    if (!st && lastEnd.has(zid) && x.at - lastEnd.get(zid) < 3 * 3600e3) continue;
    const startAt = st ? st.at : timeOf(datum(x.e, 'startTime'));
    const elapsed = startAt && startAt < x.at ? (x.at - startAt) / 1000 : null;
    const reported = reportedSeconds(x.e);
    const seconds = elapsed != null && reported != null ? Math.min(elapsed, reported) : (elapsed ?? reported);
    if (!(seconds >= 1)) continue;
    const planned = st ? reportedSeconds(st.e) : null;
    const begin = startAt || x.at - seconds * 1000;
    lastEnd.set(zid, x.at);
    runs.push({
      id: x.e.id ? `rachio-${x.e.id}` : `rachio-${device.id}-${x.zone.number ?? zid}-${x.at}`,
      deviceId: device.id,
      zoneId: zid,
      zoneNumber: x.zone.number,
      zoneName: x.zone.name,
      start: begin,
      end: x.at,
      date: dateStr(new Date(begin)),
      seconds: Math.round(seconds),
      planned: planned ? Math.round(planned) : null,
      stoppedEarly: x.kind === 'stopped' || (planned != null && seconds < planned - 60),
    });
  }
  return runs;
}

/** Runs not saved yet: a new id, and not the same zone ending within a minute of a saved run. */
export function newRuns(saved, incoming) {
  const seen = new Set(saved.map((r) => r.id));
  const ends = new Map();
  const key = (r) => `${r.deviceId}|${r.zoneId}`;
  for (const r of saved) (ends.get(key(r)) || ends.set(key(r), []).get(key(r))).push(r.end);
  const out = [];
  for (const r of incoming) {
    const list = ends.get(key(r)) || [];
    if (seen.has(r.id) || list.some((t) => Math.abs(t - r.end) < 60e3)) continue;
    seen.add(r.id);
    if (!ends.has(key(r))) ends.set(key(r), list);
    list.push(r.end);
    out.push(r);
  }
  return out;
}

/* ======================= water ======================= */

/**
 * Inches and gallons for one run. Gallons come from your measured flow rate when you've confirmed one, otherwise
 * from inches × area (0.623 gal per sq ft per inch).
 */
export function runWater(run, info) {
  const minutes = run.seconds / 60;
  const rate = info?.rate?.value || null;
  const inches = rate ? (minutes / 60) * rate : null;
  const z = info?.appZone || null;
  const sqft = z?.sqft > 0 ? z.sqft : info?.rz?.sqft || null;
  let gallons = null;
  if (z?.gpm > 0 && z.src?.gpm === 'meas') gallons = minutes * z.gpm;
  else if (inches != null && sqft) gallons = inches * sqft * GAL_PER_SQFT_INCH;
  else if (z?.gpm > 0) gallons = minutes * z.gpm;
  return { minutes, inches, gallons };
}

/**
 * Saved Rachio runs as watering entries the engine counts alongside logged watering: date, app zone, minutes,
 * lawn inches (spread over the whole lawn, like logged runs) and gallons.
 */
export function rachioWaterings(ctx) {
  const runs = ctx.runs || [];
  if (!runs.length) return [];
  const info = zoneInfo(ctx);
  const lawn = sum(ctx.zones.filter((z) => z.lawn !== false), (z) => z.sqft);
  return runs.map((run) => {
    const zi = info[run.zoneId];
    const w = runWater(run, zi);
    const z = zi?.appZone;
    return {
      id: run.id,
      type: 'water',
      source: 'rachio',
      date: run.date,
      at: run.start,
      zones: z ? [z.id] : [],
      minutes: w.minutes,
      inches: w.inches,
      gallons: w.gallons || 0,
      lawnInches: z && z.lawn !== false && w.inches != null && lawn > 0 ? (w.inches * z.sqft) / lawn : 0,
      run,
    };
  });
}

/**
 * Logged watering that repeats a Rachio run: same day, same zone, and about the same minutes (within 3 minutes or
 * 25%). Returns { [logId]: [zone ids already counted from Rachio] }.
 */
export function loggedDuplicates(logs, waterings) {
  const byDayZone = new Map();
  for (const w of waterings) for (const z of w.zones) byDayZone.set(`${w.date}|${z}`, (byDayZone.get(`${w.date}|${z}`) || 0) + w.minutes);
  const out = {};
  for (const l of logs) {
    if (l.type !== 'water' || l.source === 'rachio') continue;
    const m = l.minutes || 0;
    const covered = (l.zones || []).filter((z) => {
      const r = byDayZone.get(`${l.date}|${z}`);
      return r != null && Math.abs(r - m) <= Math.max(3, 0.25 * m);
    });
    if (covered.length) out[l.id] = covered;
  }
  return out;
}

/* ======================= report ======================= */

const blank = () => ({ runs: 0, minutes: 0, inches: 0, gallons: 0, cost: 0, uncounted: 0 });
function add(t, w, per1000) {
  t.runs += 1;
  if (w.gallons == null) t.uncounted += 1;
  t.minutes += w.minutes;
  t.inches += w.inches || 0;
  t.gallons += w.gallons || 0;
  t.cost += ((w.gallons || 0) / 1000) * per1000;
}

/**
 * My Zones numbers: each Rachio zone's match, rate, last 7 days and season-to-date (calendar year) gallons and cost,
 * the same totals across zones, and every saved run newest first with its water and cost.
 */
export function rachioReport({ rachio, runs = [], zones, settings, today }, per1000) {
  const info = zoneInfo({ rachio, runs, zones, settings });
  const weekFrom = dateStr(new Date(new Date(`${today}T12:00`).getTime() - 6 * DAY));
  const year = today.slice(0, 4);
  const byZone = Object.fromEntries(Object.keys(info).map((id) => [id, { ...info[id], week: blank(), season: blank() }]));
  const week = blank();
  const season = blank();
  const rows = [...runs].sort((a, b) => b.end - a.end).map((run) => {
    const z = byZone[run.zoneId];
    const w = runWater(run, z);
    const cost = w.gallons != null ? (w.gallons / 1000) * per1000 : null;
    if (run.date.slice(0, 4) === year && run.date <= today) { add(season, w, per1000); add(z.season, w, per1000); }
    if (run.date >= weekFrom && run.date <= today) { add(week, w, per1000); add(z.week, w, per1000); }
    return { run, zone: z, ...w, cost };
  });
  return { zones: Object.values(byZone), week, season, runs: rows, per1000, weekFrom };
}
