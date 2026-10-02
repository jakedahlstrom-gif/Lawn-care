// My Zones: Rachio zones matched to your lawn zones, each run's water and cost, and weekly and season totals.
// Runs are fetched through the Lawn Care Worker and saved on this device as they arrive, so totals keep building
// after a run drops out of Rachio's 7-day event history. The Worker address and password stay in this browser's
// localStorage, so they never go into backups.

import { S, saveRachio, saveSettings, subscribe } from '../store.js';
import * as E from '../engine.js';
import { rachioZones, parseRuns, rachioReport } from '../irrigation.js';
import { openSheet, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc, dateStr, fmtNum, fmtMoney, num } from '../util.js';

const KEY = 'lawn-care-rachio';
const DAY = 86400000;
const SYNC_EVERY = 15 * 60 * 1000;

function loadConn() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function saveConn(conn) {
  try { if (conn) localStorage.setItem(KEY, JSON.stringify(conn)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

// Connection status for the Today tab, kept current by each sync.
const STATUS_TEXT = {
  off: 'Rachio not connected yet',
  checking: 'Checking Rachio…',
  ok: 'Rachio connected',
  error: 'Rachio Worker not responding',
};
let status = null; // { key, state } for the saved connection

const connKey = (conn) => `${conn.url}\n${conn.password}`;

function setStatus(conn, state) {
  status = conn ? { key: connKey(conn), state } : null;
  const text = STATUS_TEXT[conn ? state : 'off'];
  document.querySelectorAll('[data-rachio-status]').forEach((el) => { el.textContent = text; });
}

/** State of the saved Worker connection: off, checking, ok or error. The first look at a connection starts a sync. */
export function rachioState() {
  const conn = loadConn();
  if (!conn) return 'off';
  if (status?.key !== connKey(conn)) syncRachio().catch(() => {});
  return status?.state || 'checking';
}

export const rachioStatusText = () => STATUS_TEXT[rachioState()];

async function call(conn, path) {
  const res = await fetch(conn.url.replace(/\/+$/, '') + path, { headers: { 'X-App-Password': conn.password } });
  if (res.status === 401) throw new Error('Wrong password');
  if (!res.ok) throw new Error(`Rachio request failed (${res.status})`);
  return res.json();
}

/** Person, devices with zones, and a week of events per device. */
export async function fetchRachio(conn, now = Date.now()) {
  const { id } = await call(conn, '/person/info');
  const person = await call(conn, `/person/${encodeURIComponent(id)}`);
  const devices = await Promise.all((person.devices || []).map(async (d) => {
    let events = [];
    try {
      events = await call(conn, `/device/${encodeURIComponent(d.id)}/event?startTime=${now - 7 * DAY}&endTime=${now}`);
    } catch { /* show zones even if events fail */ }
    return { ...d, events: Array.isArray(events) ? events : [] };
  }));
  return { person, devices };
}

let lastSync = 0;
let syncing = null;

/**
 * Fetch Rachio's zones and last 7 days of events and save any runs not saved yet. Runs at most every 15 minutes
 * unless forced (opening My Zones, Refresh, Connect). Resolves to the fetched data, or null when skipped.
 */
export function syncRachio({ force = false } = {}) {
  const conn = loadConn();
  if (!conn) { status = null; return Promise.resolve(null); }
  if (syncing) return syncing;
  const known = status?.key === connKey(conn);
  if (!force && known && Date.now() - lastSync < SYNC_EVERY) return Promise.resolve(null);
  if (!known) status = { key: connKey(conn), state: 'checking' };
  syncing = (async () => {
    try {
      const data = await fetchRachio(conn);
      lastSync = Date.now();
      setStatus(conn, 'ok');
      const zones = rachioZones(data.devices);
      const runs = data.devices.flatMap((d) => parseRuns(d.events, d, zones.filter((z) => z.deviceId === d.id)));
      await saveRachio({ fetchedAt: lastSync, zones }, runs);
      return data;
    } catch (err) {
      lastSync = Date.now(); // try again on the next interval, or right away when forced
      setStatus(conn, 'error');
      throw err;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

/* ---------- My Zones ---------- */

const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never');
const fmtMin = (s) => (s >= 60 ? `${fmtNum(s / 60, s < 600 ? 1 : 0)} min` : `${Math.round(s)} sec`);
const gal = (n) => (n == null ? '–' : `${fmtNum(n, 0)} gal`);
const HOW = { name: 'Matched by name', number: 'Matched by zone number', manual: 'You picked this', none: 'Not matched — pick a zone to count it' };
const MAX_RUNS = 25;

function connectHtml(conn, error = '') {
  return `
    <p class="footer-note">Connect to your Lawn Care Worker to count your Rachio runs. Enter the Worker address and the password you set as <b>APP_PASSWORD</b>.</p>
    <div class="list-card">
      <div class="row field-row-y is-text"><label class="row-title" for="rachio-url">Worker address</label>
        <div class="input-wrap"><input id="rachio-url" class="row-input" type="url" autocomplete="off" autocapitalize="off" placeholder="https://lawn-care-rachio.you.workers.dev" value="${esc(conn?.url || '')}"></div></div>
      <div class="row field-row-y is-text"><label class="row-title" for="rachio-pw">Password</label>
        <div class="input-wrap"><input id="rachio-pw" class="row-input" type="password" autocomplete="current-password" value="${esc(conn?.password || '')}"></div></div>
      <button type="button" class="row row-btn row-add" data-act="connect">${icon('check')}<span>Connect</span></button>
    </div>
    ${error ? `<p class="footer-note" role="alert">${icon('alert')} ${esc(error)}</p>` : ''}`;
}

function nozzleHtml(z) {
  const r = z.rate;
  if (r.source === 'rachio') return `<span class="row-sub">Nozzle ${fmtNum(r.value, 2)} in/hr from Rachio${z.rz.nozzle ? ` · ${esc(z.rz.nozzle)}` : ''}</span>`;
  const note = r.source === 'manual' ? 'You entered this rate.'
    : r.source === 'estimate' ? `Rachio doesn’t list a nozzle rate for this zone. Using ${fmtNum(r.value, 2)} in/hr from ${esc(z.appZone.name)} until you enter one.`
      : 'Rachio doesn’t list a nozzle rate for this zone. Enter one to count its water.';
  return `<div class="rz-line"><label class="rz-label" for="nz-${esc(z.rz.id)}">Nozzle rate</label>
      <div class="input-wrap"><input id="nz-${esc(z.rz.id)}" class="row-input" type="text" inputmode="decimal" data-nozzle="${esc(z.rz.id)}" value="${r.source === 'manual' ? r.value : ''}" placeholder="${r.value ? fmtNum(r.value, 2) : 'in/hr'}"><span class="unit">in/hr</span></div></div>
    <span class="row-sub ${r.source === 'manual' ? '' : 'warn-text'}">${note}</span>`;
}

function zoneHtml(z, appZones, zoneMap) {
  const id = z.rz.id;
  const picked = zoneMap[id] || '';
  const auto = !picked && z.appZone ? `Auto: ${z.appZone.name}` : 'Auto';
  const t = (x) => (x.runs && x.uncounted === x.runs ? `${x.runs} ${x.runs === 1 ? 'run' : 'runs'} not counted` : `${gal(x.gallons)} · ${fmtMoney(x.cost)}`);
  return `<div class="rz-zone" data-rz="${esc(id)}">
    <div class="rz-head"><span class="row-title">${z.rz.number ? `${z.rz.number}. ` : ''}${esc(z.rz.name)}</span>
      ${z.rate.source === 'estimate' || z.rate.source === 'missing' ? '<span class="tag tag-warn">Needs nozzle rate</span>' : ''}${z.rz.gone ? '<span class="tag">removed in Rachio</span>' : ''}</div>
    <div class="rz-line"><label class="rz-label" for="mz-${esc(id)}">Counts as</label>
      <select id="mz-${esc(id)}" class="rz-select" data-match="${esc(id)}">
        <option value=""${picked ? '' : ' selected'}>${esc(auto)}</option>
        ${appZones.map((a) => `<option value="${esc(a.id)}"${picked === a.id ? ' selected' : ''}>${esc(a.name)}${a.lawn === false ? ' (non-lawn)' : ''}</option>`).join('')}
        <option value="none"${picked === 'none' ? ' selected' : ''}>Don’t count</option>
      </select></div>
    <span class="row-sub ${z.match.how === 'none' ? 'warn-text' : ''}" data-testid="match-how">${HOW[z.match.how]}</span>
    ${nozzleHtml(z)}
    <div class="rz-stats"><span>7 days <b data-testid="zone-week">${t(z.week)}</b></span><span>Season <b data-testid="zone-season">${t(z.season)}</b></span></div>
    ${z.rz.lastWatered ? `<span class="row-sub">Last watered ${esc(fmtWhen(z.rz.lastWatered))}${z.rz.lastSeconds ? ` · ${fmtMin(z.rz.lastSeconds)}` : ''}</span>` : ''}
  </div>`;
}

function runHtml(r) {
  const run = r.run;
  return `<div class="row rz-run">
    <span class="row-main"><span class="row-title">${esc(run.zoneName)}${run.stoppedEarly ? ' <span class="tag tag-warn">stopped early</span>' : ''}</span>
      <span class="row-sub">${esc(fmtWhen(run.start))} · ${fmtMin(run.seconds)}${run.stoppedEarly && run.planned ? ` of ${fmtMin(run.planned)}` : ''}${r.inches != null ? ` · ${fmtNum(r.inches, 2)}″` : ''}</span></span>
    <span class="row-value"><strong>${gal(r.gallons)}</strong><br>${r.cost != null ? fmtMoney(r.cost) : ''}</span>
  </div>`;
}

function hubHtml(c) {
  const rate = E.waterRateInfo(c.settings, c.zones);
  const rep = rachioReport(c, rate.per1000);
  const year = c.today.slice(0, 4);
  const zones = rep.zones.filter((z) => z.rz.enabled || z.season.runs || z.week.runs);
  const tot = (label, x, id) => `<div class="rz-tot"><span class="wk-l">${label}</span><span class="wk-v" data-testid="${id}">${gal(x.gallons)}</span><span class="wk-s">${fmtMoney(x.cost)} · ${x.runs} ${x.runs === 1 ? 'run' : 'runs'}</span></div>`;
  return `
    <div class="card rz-card" data-testid="rachio-totals">
      <div class="mini-kicker">${icon('water')}<span>Rachio watering</span></div>
      <div class="wk-grid">${tot('Last 7 days', rep.week, 'rachio-week')}${tot(`${year} season`, rep.season, 'rachio-season')}</div>
    </div>
    <div class="list-card">
      <div class="row field-row-y"><div class="row-main"><label class="row-title" for="rz-rate">Water rate</label>
        <span class="row-sub">${rate.custom ? 'Your rate' : `Tier ${rate.idx + 1} from Yard → Water Rates`} · per 1,000 gal</span></div>
        <div class="input-wrap"><span class="unit">$</span><input id="rz-rate" class="row-input" type="text" inputmode="decimal" data-water-rate value="${rate.per1000}"><span class="unit">/1k</span></div></div>
    </div>
    <h3 class="section-h">Zones</h3>
    <div class="list-card" data-testid="rachio-zones">${zones.map((z) => zoneHtml(z, c.zones, c.settings.rachio?.zoneMap || {})).join('') || '<div class="row"><span class="row-sub">No zones yet</span></div>'}</div>
    <h3 class="section-h">Runs</h3>
    <div class="list-card" data-testid="rachio-runs">${rep.runs.slice(0, MAX_RUNS).map(runHtml).join('') || '<div class="row"><span class="row-sub">No runs saved yet</span></div>'}</div>
    <p class="footer-note">${rep.runs.length > MAX_RUNS ? `Showing the latest ${MAX_RUNS} of ${rep.runs.length} saved runs. ` : ''}Runs are saved on this phone as they come in, so season totals keep building past Rachio’s 7-day history. A stopped run counts only the minutes it ran. Read-only: change schedules in the Rachio app.</p>`;
}

const snapshot = () => ({ today: dateStr(), settings: S.settings, zones: S.zones, runs: S.runs, rachio: S.rachio, logs: S.logs });

const editingIn = (root) => {
  const a = document.activeElement;
  return !!a && root.contains(a) && a.matches('input, select, textarea');
};

export function openMyZones() {
  const sheet = openSheet({
    title: 'My Zones', className: 'detail-sheet', cancelText: 'Done',
    right: `<button type="button" class="icon-btn" data-act="refresh" aria-label="Refresh">${icon('refresh')}</button>`,
  });
  const ui = { loading: false, error: '' };
  let pending = false;

  function render() {
    if (editingIn(sheet.body)) { pending = true; return; }
    pending = false;
    const conn = loadConn();
    const top = sheet.body.scrollTop;
    if (!conn) sheet.body.innerHTML = connectHtml(null);
    else if (ui.error) {
      sheet.body.innerHTML = `${connectHtml(conn, ui.error)}${S.rachio ? `<h3 class="section-h">Saved on this phone</h3>${hubHtml(snapshot())}` : ''}`;
    } else if (!S.rachio) sheet.body.innerHTML = `<p class="footer-note center">${ui.loading ? 'Loading from Rachio…' : 'No Rachio data yet.'}</p>`;
    else {
      sheet.body.innerHTML = `${hubHtml(snapshot())}
        <div class="list-card"><button type="button" class="row row-btn row-add" data-act="disconnect">${icon('close')}<span>Disconnect</span></button></div>`;
    }
    sheet.body.scrollTop = top;
  }

  async function load() {
    if (!loadConn()) { render(); return; }
    ui.loading = true;
    render();
    try {
      await syncRachio({ force: true });
      ui.error = '';
    } catch (err) {
      ui.error = err.message === 'Failed to fetch' ? 'Couldn’t reach the Worker. Check the address and your connection.' : err.message;
    }
    ui.loading = false;
    render();
  }

  const unsub = subscribe(() => render());
  const close = sheet.close;
  sheet.close = (r) => { unsub(); close(r); };
  sheet.body.addEventListener('focusout', () => setTimeout(() => { if (pending && !editingIn(sheet.body)) render(); }, 0));
  sheet.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.row-input')) e.target.blur(); });

  sheet.sheet.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'refresh') load();
    else if (a.dataset.act === 'disconnect') { saveConn(null); setStatus(null); ui.error = ''; render(); toast('Disconnected', { duration: 2000 }); }
    else if (a.dataset.act === 'connect') {
      const url = sheet.body.querySelector('#rachio-url').value.trim();
      const password = sheet.body.querySelector('#rachio-pw').value;
      if (!/^https:\/\//.test(url) || !password) { toast('Enter an https:// address and the password', { kind: 'error', duration: 2500 }); return; }
      saveConn({ url, password });
      load();
    }
  });

  sheet.body.addEventListener('change', async (e) => {
    const t = e.target;
    const rachio = (S.settings.rachio ||= { zoneMap: {}, rates: {} });
    if (t.dataset.match != null) {
      rachio.zoneMap = { ...(rachio.zoneMap || {}) };
      if (t.value) rachio.zoneMap[t.dataset.match] = t.value;
      else delete rachio.zoneMap[t.dataset.match];
      await saveSettings();
    } else if (t.dataset.nozzle != null) {
      const n = num(t.value, NaN);
      rachio.rates = { ...(rachio.rates || {}) };
      if (t.value.trim() === '') delete rachio.rates[t.dataset.nozzle];
      else if (!(n > 0 && n < 10)) { toast('Enter the nozzle rate in inches per hour, like 1.5', { kind: 'error', duration: 2500 }); render(); return; } else rachio.rates[t.dataset.nozzle] = n;
      await saveSettings();
    } else if (t.dataset.waterRate != null) {
      const n = num(t.value, NaN);
      if (!(n > 0)) { toast('Enter your cost per 1,000 gallons', { kind: 'error', duration: 2500 }); render(); return; }
      S.settings.water.rateMode = 'custom';
      S.settings.water.customRate = n;
      await saveSettings();
      toast('Water rate saved', { duration: 1800 });
    }
  });

  load();
  return sheet;
}
