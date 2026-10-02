// App shell: boot, tab navigation, event wiring, weather refresh, Winter Mode, service worker.

import { S, load, subscribe, saveSettings, setSetting } from './store.js';
import * as E from './engine.js';
import * as Season from './season.js';
import { fetchWeather, loadCached, isStale } from './weather.js';
import { openLogMenu, openLogSheet, setLogHooks } from './logsheet.js';
import { toast } from './ui.js';
import { icon } from './icons.js';
import { dateStr } from './util.js';
import { renderToday } from './views/today.js';
import { renderCalendar, openFeedingSheet, openTaskSheet } from './views/calendar.js';
import { renderHistory, historyState } from './views/history.js';
import { openDaySheet } from './views/forecast.js';
import * as Yard from './views/yard.js';

const VIEWS = { today: renderToday, calendar: renderCalendar, history: renderHistory, yard: Yard.renderYard };
const ALIASES = { plan: 'calendar' };
const TABS = [['today', 'Today', 'today'], ['calendar', 'Calendar', 'plan'], ['history', 'History', 'history'], ['yard', 'Yard', 'yard']];
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
  c.feedings = Season.feedingSchedule(c);
  c.seasonTasks = Season.seasonTasks(c);
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
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#0b0f0c' : '#f4f5f1'));
}

function switchTab(name, { scrollTop = false } = {}) {
  name = ALIASES[name] || name;
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

function onLocationChange() {
  S.weather = null;
  refreshWeather({ force: true });
}

/* ---------- events ---------- */

function openProduct(id, type) {
  Yard.openProductSheet(id, { type, onDone: render });
}

/** Open the right log sheet for a calendar task, feeding, or checklist item. */
function logFor(t) {
  if (t.addProduct) { openProduct(null, t.addProduct === 'preemergent' ? 'preemergent' : t.addProduct); return; }
  if (t.kind === 'fert') openLogSheet('fert', { preset: { productId: t.product?.id } });
  else if (t.kind === 'weed') openLogSheet('weed', { preset: { productId: t.product?.id } });
  else if (t.kind === 'pull') openLogSheet('pull');
  else if (t.kind === 'mow') openLogSheet('mow');
  else if (t.kind === 'other') openLogSheet('other', { preset: { kind: t.otherKind } });
}

async function setWinter(on) {
  // Acting on Winter Mode (by prompt or toggle) answers this season's suggestion.
  const keys = Season.winterPromptKeys(ctx().today);
  S.settings.winter.dismissed = { ...(S.settings.winter.dismissed || {}), [on ? keys.on : keys.off]: true };
  await setSetting('winter.on', on);
  toast(on ? 'Winter Mode on' : 'Winter Mode off', { duration: 2000 });
  window.scrollTo(0, 0);
}

const actions = {
  log: (el) => openLogSheet(el.dataset.type),
  nav: (el) => switchTab(el.dataset.tab, { scrollTop: true }),
  'refresh-weather': () => refreshWeather({ force: true }),
  day: (el) => openDaySheet(el.dataset.date, ctx),
  agenda: (el) => {
    const a = JSON.parse(el.dataset.item || '{}');
    if (a.type === 'feeding') openFeedingSheet(a.id, { ctx, onLog: logFeeding });
    else if (a.type === 'task') openTaskSheet(a.id, { ctx, onLog: logFor });
    else if (a.type === 'log') openLogSheet(a.logType, { preset: { kind: a.kind, productId: a.productId } });
  },
  feeding: (el) => openFeedingSheet(el.dataset.id, { ctx, onLog: logFeeding }),
  task: (el) => openTaskSheet(el.dataset.id, { ctx, onLog: logFor }),
  check: async (el) => {
    const y = Number(el.dataset.year) || Season.seasonYear(ctx().today);
    const checks = (S.settings.planChecks[y] ||= {});
    if (checks[el.dataset.id]) delete checks[el.dataset.id];
    else checks[el.dataset.id] = true;
    await saveSettings();
  },
  'check-log': (el) => {
    const list = el.dataset.list === 'winter' ? Season.winterChecklist(ctx()) : Season.fallChecklist(ctx());
    const item = list.find((i) => i.id === el.dataset.id);
    if (!item) return;
    if (item.log) { openLogSheet(item.log.type, { existing: item.log }); return; }
    const as = item.logAs;
    if (as.type === 'other') openLogSheet('other', { preset: { kind: as.kind } });
    else openLogSheet(as.type, { preset: { final: as.final } });
  },
  'edit-log': (el) => {
    const log = S.logs.find((l) => l.id === el.dataset.id);
    if (log) openLogSheet(log.type, { existing: log });
  },
  'yard-section': (el) => Yard.openYardSection(el.dataset.id),
  settings: () => Yard.openSettingsSheet(),
  'toggle-winter': () => setWinter(!S.settings.winter?.on),
  'winter-on': () => setWinter(true),
  'winter-off': () => setWinter(false),
  'dismiss-prompt': async (el) => {
    S.settings.winter.dismissed = { ...(S.settings.winter.dismissed || {}), [el.dataset.key]: true };
    await saveSettings();
  },
};

function logFeeding({ product, addProduct }) {
  if (addProduct) { openProduct(null, addProduct); return; }
  openLogSheet('fert', { preset: { productId: product?.id } });
}

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
    const seg = e.target.closest('[data-seg] .seg-opt');
    if (seg) {
      const name = seg.closest('[data-seg]').dataset.seg;
      const value = seg.dataset.value;
      if (name === 'filter') historyState.filter = value;
      else if (name === 'year') historyState.year = Number(value);
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
    if (t.dataset.switch === 'calendar.showPast') await setSetting('calendar.showPast', t.checked);
  });
  views.addEventListener('focusout', () => {
    setTimeout(() => { if (pendingRender && !editing()) render(); }, 0);
  });

  window.addEventListener('hashchange', () => switchTab(location.hash.slice(1)));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { render(); refreshWeather(); }
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
  window.addEventListener('online', () => refreshWeather({ force: true }));
  setInterval(() => { if (document.visibilityState === 'visible') render(); }, 60 * 1000);
}

function buildShell() {
  const tab = ([id, label, ic]) => `<button type="button" class="tab" data-tab="${id}">${icon(ic)}<span>${label}</span></button>`;
  document.querySelector('.tabbar').innerHTML = `${TABS.slice(0, 2).map(tab).join('')}
    <div class="tab-log"><button type="button" id="fab" class="log-btn" aria-label="Log an activity">${icon('plus')}</button></div>
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
  Yard.setYardHooks({ ctx, applyTheme, onLocationChange, setWinter });
  subscribe(() => { applyTheme(); render(); });
  wireEvents();
  switchTab(location.hash.slice(1) || 'today');
  document.documentElement.classList.add('ready');
  navigator.storage?.persist?.().catch(() => {});
  registerSW();
  refreshWeather();
}

boot();
