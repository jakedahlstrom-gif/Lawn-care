// In-memory app state mirrored to IndexedDB, plus every mutation the UI performs.
// Log saves apply side effects (inventory, timers, nitrogen) atomically and reverse them on edit/delete.

import * as db from './db.js';
import { defaultSettings, defaultZones, defaultProducts, defaultPlanProducts, SCHEMA } from './defaults.js';
import { computeTimers } from './engine.js';
import { newRuns } from './irrigation.js';
import { clone, uid, round, setPath } from './util.js';

export const S = {
  settings: null,
  zones: [],
  products: [],
  logs: [],
  headerPhoto: null, // { dataUrl, tone }
  runs: [], // Rachio runs saved as they're fetched
  rachio: null, // { fetchedAt, zones } from the last Rachio sync
  weather: null,
  weatherState: 'idle', // idle | loading | ok | error
  weatherError: null,
};

const listeners = new Set();
export const subscribe = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = (what) => listeners.forEach((fn) => fn(what));
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.name).localeCompare(String(b.name));

/** Fill in any settings added in newer versions without touching saved values. */
function withDefaults(def, val) {
  if (Array.isArray(def)) return Array.isArray(val) ? val : def;
  if (def && typeof def === 'object') {
    const out = { ...def };
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      for (const k of Object.keys(val)) out[k] = k in def ? withDefaults(def[k], val[k]) : val[k];
    }
    return out;
  }
  return val === undefined ? def : val;
}

async function seed() {
  const settings = defaultSettings();
  const zones = defaultZones();
  const products = defaultProducts();
  await db.tx(['kv', 'zones', 'products'], (st) => {
    st('kv').put(settings, 'settings');
    zones.forEach((z) => st('zones').put(z));
    products.forEach((p) => st('products').put(p));
  });
}

/* ---------- migrations ---------- */

const RENAMED_TASKS = {
  'pre-emergent': 'feed-spring',
  'fert-late-spring': 'feed-late-spring',
  'fert-summer': 'feed-summer',
  'fert-early-fall': 'feed-early-fall',
  'fert-late-fall': 'feed-late-fall',
  'weed-spring': 'spray-spring',
  'weed-fall': 'spray-fall',
};

/** Bring stored settings up to the current schema without losing anything the user entered. */
export function migrateSettings(stored) {
  const out = withDefaults(defaultSettings(), stored || {});
  const from = stored?.schema || 1;
  if (from < 2) {
    // Blade-sharpening tracking was removed.
    delete out.mower.sharpenEvery;
    delete out.mower.sinceSharpenAtStart;
    delete out.mower.hoursBefore;
    // Labels now apply to numeric values only, and the mower heights go back to Estimated.
    const numeric = new Set(Object.keys(defaultSettings().src));
    const src = {};
    for (const [k, v] of Object.entries(out.src || {})) if (numeric.has(k) || /^water\.tiers\.\d+$/.test(k)) src[k] = v;
    (out.mower.heights || []).forEach((_, i) => { src[`mower.heights.${i}`] = 'est'; });
    out.src = src;
    // The plan now recommends the Scotts lineup; carry over checks to renamed tasks.
    out.planProducts = defaultPlanProducts();
    for (const checks of Object.values(out.planChecks || {})) {
      for (const [a, b] of Object.entries(RENAMED_TASKS)) if (checks[a]) { checks[b] = true; delete checks[a]; }
      delete checks['sharpen-spring'];
    }
  }
  out.schema = SCHEMA;
  return out;
}

/** Fill in fields newer versions need; on the v1→v2 upgrade also add the Scotts lineup and Weed B Gon. */
export function migrateProducts(products, fromSchema) {
  const defs = defaultProducts();
  const have = new Set(products.map((p) => p.id));
  const changed = [];
  if (fromSchema < 2) for (const d of defs) if (!have.has(d.id)) changed.push(d);
  for (const p of products) {
    const def = defs.find((d) => d.id === p.id);
    const q = { ...p };
    let dirty = false;
    if (!Array.isArray(q.bagOptions) || !q.bagOptions.length) {
      q.bagOptions = def && def.size === p.size
        ? def.bagOptions.map((o) => (o.size === p.size ? { size: o.size, price: p.price } : o))
        : [{ size: p.size, price: p.price }];
      dirty = true;
    }
    if (q.short == null) { q.short = def?.short || ''; dirty = true; }
    if (q.mixRate == null) { q.mixRate = def?.mixRate || 0; dirty = true; }
    if (fromSchema < 2 && p.id === 'p-lesco-24-0-11' && p.order === 1) { q.order = 6; dirty = true; }
    if (dirty) changed.push(q);
  }
  return changed;
}

export async function load() {
  await db.openDB();
  if (!(await db.get('kv', 'settings'))) await seed();
  const stored = await db.get('kv', 'settings');
  const from = stored?.schema || 1;
  S.settings = migrateSettings(stored);
  S.settings.src = S.settings.src || {};
  const products = await db.getAll('products');
  const fixes = migrateProducts(products, from);
  if (from < SCHEMA || fixes.length) {
    await db.tx(['kv', 'products'], (st) => {
      st('kv').put(S.settings, 'settings');
      fixes.forEach((p) => st('products').put(p));
    });
  }
  const fixed = new Map(fixes.map((p) => [p.id, p]));
  S.products = [...products.map((p) => fixed.get(p.id) || p), ...fixes.filter((p) => !products.some((x) => x.id === p.id))].sort(byOrder);
  S.zones = (await db.getAll('zones')).sort(byOrder);
  S.logs = await db.getAll('logs');
  S.runs = await db.getAll('runs');
  S.rachio = (await db.get('kv', 'rachio')) || null;
  S.headerPhoto = (await db.get('kv', 'headerPhoto')) || null;
  emit('load');
}

/* ---------- header photo ---------- */

export async function setHeaderPhoto(photo) {
  if (photo) await db.put('kv', photo, 'headerPhoto');
  else await db.del('kv', 'headerPhoto');
  S.headerPhoto = photo || null;
  emit('settings');
}

/* ---------- settings ---------- */

export async function saveSettings() {
  await db.put('kv', S.settings, 'settings');
  emit('settings');
}

export async function setSetting(path, value) {
  setPath(S.settings, path, value);
  await saveSettings();
}

export async function setProvenance(path, value) {
  S.settings.src[path] = value;
  await saveSettings();
}

/* ---------- zones & products ---------- */

export async function saveZone(z) {
  const zone = clone(z);
  if (!zone.id) zone.id = uid('z');
  if (zone.order == null) zone.order = Math.max(0, ...S.zones.map((x) => x.order || 0)) + 1;
  await db.put('zones', zone);
  S.zones = [...S.zones.filter((x) => x.id !== zone.id), zone].sort(byOrder);
  emit('zones');
  return zone;
}

export async function deleteZone(id) {
  await db.del('zones', id);
  S.zones = S.zones.filter((z) => z.id !== id);
  emit('zones');
}

export async function saveProduct(p) {
  const prod = clone(p);
  if (!prod.id) prod.id = uid('p');
  if (prod.order == null) prod.order = Math.max(0, ...S.products.map((x) => x.order || 0)) + 1;
  await db.put('products', prod);
  S.products = [...S.products.filter((x) => x.id !== prod.id), prod].sort(byOrder);
  emit('products');
  return prod;
}

export async function deleteProduct(id) {
  await db.del('products', id);
  S.products = S.products.filter((p) => p.id !== id);
  emit('products');
}

/* ---------- logs ---------- */

/**
 * Save a new or edited log. When `prev` is given (an edit), its effects are reversed first.
 * Effects: subtract product from inventory (never below zero; the exact amount is recorded so it can be
 * returned), start safety timers from the product's intervals, and record nitrogen applied.
 * Mowing hours and season totals are derived from the logs themselves.
 */
export async function saveLog(input, prev = null) {
  const log = clone(input);
  const touched = new Map();
  const product = (id) => {
    if (!id) return null;
    if (touched.has(id)) return touched.get(id);
    const p = S.products.find((x) => x.id === id);
    if (!p) return null;
    const copy = clone(p);
    touched.set(id, copy);
    return copy;
  };

  if (prev?.effects?.deducted > 0) {
    const p = product(prev.productId);
    if (p) p.onHand = round((p.onHand || 0) + prev.effects.deducted, 3);
  }

  const effects = { deducted: 0, nLbs: 0, timers: [] };
  const p = log.type === 'fert' || log.type === 'weed' ? product(log.productId) : null;
  if (p) {
    const amount = Math.max(0, Number(log.amount) || 0);
    const take = Math.min(Math.max(0, p.onHand || 0), amount);
    p.onHand = round((p.onHand || 0) - take, 3);
    effects.deducted = round(take, 3);
    const n = log.n ?? p.n ?? 0;
    effects.nLbs = (log.unit || p.unit) === 'lb' ? (amount * n) / 100 : 0;
    effects.timers = computeTimers(log, p, S.zones);
  }
  log.effects = effects;
  log.createdAt = log.createdAt || Date.now();
  log.updatedAt = Date.now();

  await db.tx(['logs', 'products'], (st) => {
    st('logs').put(log);
    touched.forEach((x) => st('products').put(x));
  });
  touched.forEach((x) => {
    const i = S.products.findIndex((y) => y.id === x.id);
    if (i >= 0) S.products[i] = x;
  });
  const i = S.logs.findIndex((l) => l.id === log.id);
  if (i >= 0) S.logs[i] = log;
  else S.logs.push(log);
  emit('logs');
  return log;
}

/** Delete a log, returning its product to inventory. Returns what's needed to restore it. */
export async function deleteLog(id) {
  const log = S.logs.find((l) => l.id === id);
  if (!log) return null;
  let p = null;
  if (log.effects?.deducted > 0) {
    const cur = S.products.find((x) => x.id === log.productId);
    if (cur) p = { ...clone(cur), onHand: round((cur.onHand || 0) + log.effects.deducted, 3) };
  }
  const photo = log.photoId ? await db.get('photos', log.photoId) : null;
  await db.tx(['logs', 'products', 'photos'], (st) => {
    st('logs').delete(id);
    if (p) st('products').put(p);
    if (log.photoId) st('photos').delete(log.photoId);
  });
  if (p) S.products = S.products.map((x) => (x.id === p.id ? p : x));
  S.logs = S.logs.filter((l) => l.id !== id);
  emit('logs');
  return { log, photo };
}

export async function restoreLog({ log, photo }) {
  if (photo) await db.put('photos', photo);
  const copy = clone(log);
  delete copy.effects;
  return saveLog(copy);
}

/* ---------- Rachio ---------- */

/**
 * Save the latest Rachio zones and any runs not saved yet. Runs are never overwritten or duplicated, so season
 * totals keep building after a run drops out of Rachio's 7-day event window. Returns the new runs.
 */
export async function saveRachio(snapshot, runs) {
  const fresh = newRuns(S.runs, runs);
  await db.tx(['kv', 'runs'], (st) => {
    if (snapshot) st('kv').put(snapshot, 'rachio');
    fresh.forEach((r) => st('runs').put(r));
  });
  if (snapshot) S.rachio = snapshot;
  if (fresh.length) S.runs = [...S.runs, ...fresh];
  emit('runs');
  return fresh;
}

/* ---------- photos ---------- */

export async function savePhoto(dataUrl) {
  const id = uid('ph');
  await db.put('photos', { id, dataUrl, createdAt: Date.now() });
  return id;
}
export const getPhoto = (id) => db.get('photos', id);
export const deletePhoto = (id) => db.del('photos', id);

/* ---------- backup ---------- */

export async function exportData({ includePhotos = true } = {}) {
  return {
    app: 'lawn-care-pwa',
    schema: SCHEMA,
    exportedAt: new Date().toISOString(),
    settings: S.settings,
    zones: S.zones,
    products: S.products,
    logs: S.logs,
    runs: S.runs,
    rachio: S.rachio,
    photos: includePhotos ? await db.getAll('photos') : [],
    headerPhoto: includePhotos ? S.headerPhoto : null,
  };
}

export function validateBackup(obj) {
  const ok = obj && obj.app === 'lawn-care-pwa' && obj.settings && typeof obj.settings === 'object'
    && Array.isArray(obj.zones) && Array.isArray(obj.products) && Array.isArray(obj.logs);
  if (!ok) throw new Error('That file isn’t a Lawn Care backup.');
  const hasIds = (arr) => arr.every((x) => x && typeof x.id === 'string' && x.id);
  if (!hasIds(obj.zones) || !hasIds(obj.products) || !hasIds(obj.logs)) throw new Error('The backup is missing record IDs.');
  if (obj.schema > SCHEMA) throw new Error('This backup is from a newer version of the app.');
  if (obj.settings.schema > SCHEMA) throw new Error('This backup is from a newer version of the app.');
}

/** Replace everything on the device with the backup's contents. */
export async function importData(obj) {
  validateBackup(obj);
  const photos = Array.isArray(obj.photos) ? obj.photos.filter((p) => p && p.id && p.dataUrl) : [];
  const runs = Array.isArray(obj.runs) ? obj.runs.filter((r) => r && typeof r.id === 'string' && r.zoneId && r.seconds > 0) : [];
  await db.tx(['kv', 'zones', 'products', 'logs', 'photos', 'runs'], (st) => {
    ['zones', 'products', 'logs', 'photos', 'runs'].forEach((n) => st(n).clear());
    st('kv').put(obj.settings, 'settings');
    obj.zones.forEach((z) => st('zones').put(z));
    obj.products.forEach((p) => st('products').put(p));
    obj.logs.forEach((l) => st('logs').put(l));
    photos.forEach((p) => st('photos').put(p));
    runs.forEach((r) => st('runs').put(r));
    if (obj.rachio?.zones) st('kv').put(obj.rachio, 'rachio');
    else st('kv').delete('rachio');
    if (obj.headerPhoto?.dataUrl) st('kv').put(obj.headerPhoto, 'headerPhoto');
    else st('kv').delete('headerPhoto');
  });
  await load();
}

export async function resetAll() {
  await db.clearAll();
  await load();
}
