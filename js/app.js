// App shell: boot, tab navigation, event wiring, weather refresh, service worker.

import { S, load, subscribe, saveSettings } from './store.js';
import * as E from './engine.js';
import { fetchWeather, loadCached, isStale } from './weather.js';
import { openLogMenu, openLogSheet, setLogHooks } from './logsheet.js';
import { toast } from './ui.js';
import { icon } from './icons.js';
import { dateStr } from './util.js';
import { renderToday } from './views/today.js';
import { renderPlan, openTaskSheet } from './views/plan.js';
import { renderHistory, historyState } from './views/history.js';
import * as Yard from './views/yard.js';

const VIEWS = { today: renderToday, plan: renderPlan, history: renderHistory, yard: Yard.renderYard };
const TABS = [['today', 'Today', 'today'], ['plan', 'Plan', 'plan'], ['history', 'History', 'history'], ['yard', 'Yard', 'yard']];
let current = 'today';
const scrollPos = {};
let pendingRender = false;
let renderQueued = false;

/** Snapshot of everything the engine needs for "now". */
export function ctx() {
  const now = Date.now();
  const c = {
    now,
    today: dateStr(new Date(now)),
    settings: S.settings,
    zones: S.zones,
    products: S.products,
    logs: S.logs,
    weather: S.weather,
  };
  c.cond = E.conditions(c);
  c.tasks = E.planTasks(c);
  return c;
}

/* ---------- rendering ---------- */

const viewEl = (name) => document.getElementById(`view-${name}`);
const editing = () => {
  const a = document.activeElement;
  return !!a && !!a.closest?.('#views') && a.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
};

function renderNow() {
  renderQueued = false;
  if (editing()) {
    pendingRender = true;
    return;
  }
  pendingRender = false;
  try {
    VIEWS[current](viewEl(current), ctx());
  } catch (err) {
    console.error(err);
    viewEl(current).innerHTML = `<div class="card error-card"><strong>Something went wrong showing this tab.</strong><p class="muted">${String(err.message || err)}</p></div>`;
  }
}

export function render() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(renderNow);
}

function applyTheme() {
  const t = S.settings?.appearance?.theme || 'system';
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#000000' : '#F2F2F7'));
}

function switchTab(name, { scrollTop = false } = {}) {
  if (!VIEWS[name]) name = 'today';
  scrollPos[current] = window.scrollY;
  current = name;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === name));
  document.querySelectorAll('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.classList.toggle('active', on);
    if (on) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  renderNow();
  window.scrollTo(0, scrollTop ? 0 : scrollPos[name] || 0);
}

/* ---------- weather ---------- */

let weatherBusy = false;
async function refreshWeather({ force = false } = {}) {
  const { lat, lon } = S.settings.location;
  if (!S.weather) {
    try { S.weather = await loadCached(lat, lon); } catch { /* ignore cache errors */ }
    render();
  }
  if (weatherBusy || (!force && !isStale(S.weather))) return;
  weatherBusy = true;
  S.weatherState = 'loading';
  render();
  try {
    S.weather = await fetchWeather(lat, lon);
    S.weatherState = 'ok';
    S.weatherError = null;
  } catch (err) {
    S.weatherState = 'error';
    S.weatherError = navigator.onLine === false ? 'offline' : (err.name === 'AbortError' ? 'timed out' : err.message);
    if (force) toast(`Couldn’t update weather${S.weatherError ? ` (${S.weatherError})` : ''}`, { kind: 'error', duration: 3000 });
  } finally {
    weatherBusy = false;
    render();
  }
}

/* ---------- events ---------- */

function openProduct(id, type) {
  switchTab('yard');
  Yard.openProductSheet(id, { type, onDone: render });
}

function logFromTask(t) {
  if (t.addProduct) { openProduct(null, t.addProduct); return; }
  if (t.kind === 'fert') openLogSheet('fert', { preset: { productId: t.product?.id } });
  else if (t.kind === 'weed') openLogSheet('weed', { preset: { productId: t.product?.id, productType: t.productType } });
  else if (t.kind === 'mow') openLogSheet('mow');
  else if (t.kind === 'other') openLogSheet('other', { preset: { kind: t.otherKind } });
}

const actions = {
  log: (el) => openLogSheet(el.dataset.type),
  'refresh-weather': () => refreshWeather({ force: true }),
  task: (el) => openTaskSheet(el.dataset.id, { ctx, onLog: logFromTask }),
  alert: (el) => {
    const a = JSON.parse(el.dataset.alert);
    if (a.type === 'product') openProduct(a.productId);
    else if (a.type === 'addProduct') openProduct(null, a.productType);
    else if (a.type === 'other') openLogSheet('other', { preset: { kind: a.kind } });
    else if (a.type === 'fert') openLogSheet('fert', { preset: { productId: a.productId } });
    else openLogSheet(a.type);
  },
  check: async (el) => {
    const y = Number(ctx().today.slice(0, 4));
    const checks = (S.settings.planChecks[y] ||= {});
    if (checks[el.dataset.id]) delete checks[el.dataset.id];
    else checks[el.dataset.id] = true;
    await saveSettings();
  },
  'check-log': (el) => {
    const item = E.FALL_CHECKLIST.find((i) => i.id === el.dataset.id);
    if (!item) return;
    const done = E.fallChecklist(ctx()).find((i) => i.id === item.id);
    if (done?.log) { openLogSheet(done.log.type, { existing: done.log }); return; }
    if (item.log.type === 'other') openLogSheet('other', { preset: { kind: item.log.kind } });
    else openLogSheet(item.log.type, { preset: { final: item.log.final } });
  },
  'edit-log': (el) => {
    const log = S.logs.find((l) => l.id === el.dataset.id);
    if (log) openLogSheet(log.type, { existing: log });
  },
  zone: (el) => Yard.openZoneSheet(el.dataset.id, render),
  'add-zone': () => Yard.openZoneSheet(null, render),
  product: (el) => Yard.openProductSheet(el.dataset.id, { onDone: render }),
  'add-product': () => Yard.openProductSheet(null, { onDone: render }),
  'add-tier': () => Yard.addTier(),
  'remove-tier': (el) => Yard.removeTier(Number(el.dataset.i)),
  'toggle-day': (el) => Yard.toggleDay(Number(el.dataset.day)),
  'mark-sharpened': () => Yard.markSharpened(ctx().today),
  'goto-settings': () => document.getElementById('settings')?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  export: () => Yard.doExport().catch((err) => toast(`Export failed: ${err.message}`, { kind: 'error' })),
  reset: async () => { if (await Yard.doReset()) { applyTheme(); refreshWeather({ force: true }); } },
};

function wireEvents() {
  document.querySelector('.tabbar').addEventListener('click', (e) => {
    const t = e.target.closest('.tab');
    if (!t) return;
    const same = t.dataset.tab === current;
    switchTab(t.dataset.tab, { scrollTop: same });
  });
  document.getElementById('fab').addEventListener('click', () => openLogMenu());

  const views = document.getElementById('views');
  views.addEventListener('click', async (e) => {
    const prov = e.target.closest('[data-prov]');
    if (prov) {
      if (await Yard.toggleProv(prov.dataset.prov)) render();
      return;
    }
    const seg = e.target.closest('[data-seg] .seg-opt');
    if (seg) {
      const name = seg.closest('[data-seg]').dataset.seg;
      const value = seg.dataset.value;
      if (name === 'filter') historyState.filter = value;
      else if (name === 'year') historyState.year = Number(value);
      else if (await Yard.onSegment(name, value)) {
        if (name === 'appearance.theme') applyTheme();
      }
      render();
      return;
    }
    const a = e.target.closest('[data-action]');
    if (a && actions[a.dataset.action]) {
      await actions[a.dataset.action](a, e);
      render();
    }
  });

  views.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.setting) {
      const r = await Yard.onSettingChange(t);
      if (r === 'location') { S.weather = null; refreshWeather({ force: true }); }
      render();
    } else if (t.dataset.tier != null) {
      await Yard.onTierChange(t);
      render();
    } else if (t.dataset.switch) {
      if (await Yard.onSwitch(t.dataset.switch, t.checked)) render();
    } else if (t.dataset.import != null && t.files?.[0]) {
      const ok = await Yard.doImport(t.files[0]);
      t.value = '';
      if (ok) { applyTheme(); S.weather = null; refreshWeather({ force: true }); render(); }
    }
  });

  // Re-render once editing finishes (deferred while an input in the page has focus).
  views.addEventListener('focusout', () => {
    setTimeout(() => { if (pendingRender && !editing()) render(); }, 0);
  });
  views.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.row-input, .mini-input')) e.target.blur();
  });

  window.addEventListener('hashchange', () => switchTab(location.hash.slice(1)));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { render(); refreshWeather(); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  window.addEventListener('online', () => refreshWeather({ force: true }));
  // Keep timers and "today" fresh.
  setInterval(() => { if (document.visibilityState === 'visible') render(); }, 60 * 1000);
}

function buildShell() {
  const tab = ([id, label, ic]) => `<button type="button" class="tab" data-tab="${id}">${icon(ic)}<span>${label}</span></button>`;
  document.querySelector('.tabbar').innerHTML = `${TABS.slice(0, 2).map(tab).join('')}
    <div class="tab-log"><button type="button" id="fab" class="log-btn" aria-label="Log an activity">${icon('plus')}<span>Log</span></button></div>
    ${TABS.slice(2).map(tab).join('')}`;
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker registration failed', err));
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || shown) return;
    shown = true;
    toast('App updated — reopen to use the new version', { duration: 6000 });
  });
}

async function boot() {
  buildShell();
  try {
    await load();
  } catch (err) {
    document.getElementById('views').innerHTML = `<div class="view active"><div class="card error-card"><strong>Couldn’t open on-device storage.</strong><p class="muted">${String(err.message || err)}. In Safari, private browsing can block storage.</p></div></div>`;
    return;
  }
  applyTheme();
  setLogHooks({ ctx, openProduct });
  subscribe(() => render());
  wireEvents();
  switchTab(location.hash.slice(1) || 'today');
  document.documentElement.classList.add('ready');
  navigator.storage?.persist?.().catch(() => {});
  registerSW();
  refreshWeather();
}

boot();
