// My Zones: live Rachio controllers, zones and recent events, read through the Lawn Care Worker.
// The Worker address and password stay in this browser's localStorage, so they never go into backups.

import { openSheet, toast } from '../ui.js';
import { icon } from '../icons.js';
import { esc } from '../util.js';

const KEY = 'lawn-care-rachio';
const DAY = 86400000;

function loadConn() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function saveConn(conn) {
  try { if (conn) localStorage.setItem(KEY, JSON.stringify(conn)); else localStorage.removeItem(KEY); } catch { /* private mode */ }
}

// Connection status for the Today tab: checked once per saved connection, then kept current by My Zones.
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

/** Status line for the saved Worker connection. Starts a check the first time a connection is seen. */
export function rachioStatusText() {
  const conn = loadConn();
  if (!conn) return STATUS_TEXT.off;
  if (status?.key !== connKey(conn)) {
    status = { key: connKey(conn), state: 'checking' };
    call(conn, '/person/info').then(() => 'ok', () => 'error').then((state) => {
      if (status?.key === connKey(conn)) setStatus(conn, state);
    });
  }
  return STATUS_TEXT[status.state];
}

async function call(conn, path) {
  const res = await fetch(conn.url.replace(/\/+$/, '') + path, { headers: { 'X-App-Password': conn.password } });
  if (res.status === 401) throw new Error('Wrong password');
  if (!res.ok) throw new Error(`Rachio request failed (${res.status})`);
  return res.json();
}

/** Everything the screen shows: person, devices with zones, and a week of events per device. */
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

const fmtWhen = (ms) => (ms ? new Date(ms).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Never');
const fmtMin = (s) => (s ? `${Math.round(s / 60)} min` : '');

function connectHtml(conn, error = '') {
  return `
    <p class="footer-note">Connect to your Lawn Care Worker to see your Rachio zones. Enter the Worker address and the password you set as <b>APP_PASSWORD</b>.</p>
    <div class="list-card">
      <div class="row field-row-y is-text"><label class="row-title" for="rachio-url">Worker address</label>
        <div class="input-wrap"><input id="rachio-url" class="row-input" type="url" autocomplete="off" autocapitalize="off" placeholder="https://lawn-care-rachio.you.workers.dev" value="${esc(conn?.url || '')}"></div></div>
      <div class="row field-row-y is-text"><label class="row-title" for="rachio-pw">Password</label>
        <div class="input-wrap"><input id="rachio-pw" class="row-input" type="password" autocomplete="current-password" value="${esc(conn?.password || '')}"></div></div>
      <button type="button" class="row row-btn row-add" data-act="connect">${icon('check')}<span>Connect</span></button>
    </div>
    ${error ? `<p class="footer-note" role="alert">${icon('alert')} ${esc(error)}</p>` : ''}`;
}

function deviceHtml(d) {
  const zones = (d.zones || []).filter((z) => z.enabled).sort((a, b) => a.zoneNumber - b.zoneNumber);
  const events = d.events.slice().sort((a, b) => b.eventDate - a.eventDate).slice(0, 15);
  return `
    <h3 class="section-h">${esc(d.name || 'Controller')}${d.status && d.status !== 'ONLINE' ? ` <span class="tag">${esc(d.status.toLowerCase())}</span>` : ''}</h3>
    <div class="list-card" data-testid="rachio-zones">${zones.map((z) => `
      <div class="row"><span class="row-main"><span class="row-title">${z.zoneNumber}. ${esc(z.name)}</span>
        <span class="row-sub">Last watered ${esc(fmtWhen(z.lastWateredDate))}${z.lastWateredDuration ? ` · ${fmtMin(z.lastWateredDuration)}` : ''}</span></span></div>`).join('') || '<div class="row"><span class="row-sub">No enabled zones</span></div>'}
    </div>
    <h3 class="section-h">Last 7 days</h3>
    <div class="list-card">${events.map((e) => `
      <div class="row"><span class="row-main"><span class="row-title">${esc(e.summary || e.type || 'Event')}</span>
        <span class="row-sub">${esc(fmtWhen(e.eventDate))}</span></span></div>`).join('') || '<div class="row"><span class="row-sub">No events this week</span></div>'}
    </div>`;
}

export function openMyZones() {
  const sheet = openSheet({
    title: 'My Zones', className: 'detail-sheet', cancelText: 'Done',
    right: `<button type="button" class="icon-btn" data-act="refresh" aria-label="Refresh">${icon('refresh')}</button>`,
  });

  async function load() {
    const conn = loadConn();
    if (!conn) { setStatus(null); sheet.body.innerHTML = connectHtml(null); return; }
    sheet.body.innerHTML = '<p class="footer-note center">Loading from Rachio…</p>';
    try {
      const { devices } = await fetchRachio(conn);
      setStatus(conn, 'ok');
      sheet.body.innerHTML = `${devices.map(deviceHtml).join('') || '<p class="footer-note">No Rachio controllers on this account.</p>'}
        <div class="list-card"><button type="button" class="row row-btn row-add" data-act="disconnect">${icon('close')}<span>Disconnect</span></button></div>
        <p class="footer-note">Read-only. Change schedules in the Rachio app.</p>`;
    } catch (err) {
      setStatus(conn, 'error');
      sheet.body.innerHTML = connectHtml(conn, err.message === 'Failed to fetch' ? 'Couldn’t reach the Worker. Check the address and your connection.' : err.message);
    }
  }

  sheet.sheet.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'refresh') load();
    else if (a.dataset.act === 'disconnect') { saveConn(null); load(); toast('Disconnected', { duration: 2000 }); }
    else if (a.dataset.act === 'connect') {
      const url = sheet.body.querySelector('#rachio-url').value.trim();
      const password = sheet.body.querySelector('#rachio-pw').value;
      if (!/^https:\/\//.test(url) || !password) { toast('Enter an https:// address and the password', { kind: 'error', duration: 2500 }); return; }
      saveConn({ url, password });
      load();
    }
  });
  load();
  return sheet;
}
