// Small shared helpers: DOM, dates (local 'YYYY-MM-DD' strings), and number formatting.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Keep "24-0-11" style analyses on one line when displayed (non-breaking hyphens). */
export const nobreak = (s) => String(s ?? '').replace(/(\d)-(?=\d)/g, '$1\u2011');

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const pad = (n) => String(n).padStart(2, '0');
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const sum = (arr, f = (x) => x) => arr.reduce((t, x) => t + (Number(f(x)) || 0), 0);
export const avg = (arr) => (arr.length ? sum(arr) / arr.length : null);
export const round = (n, d = 1) => {
  const m = 10 ** d;
  return Math.round((Number(n) + Number.EPSILON) * m) / m;
};
export const num = (v, fallback = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : fallback;
};

/* ---------- dates ---------- */

export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return dateStr(d);
}
/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}
export const dow = (s) => parseDate(s).getDay();
/** Month-day as a sortable number, e.g. Oct 2 -> 1002. */
export const md = (s) => Number(s.slice(5, 7)) * 100 + Number(s.slice(8, 10));
export const yearOf = (s) => Number(s.slice(0, 4));
export const maxDate = (a, b) => (a > b ? a : b);
export const minDate = (a, b) => (a < b ? a : b);
/** Noon local time on a date, as a timestamp. */
export const noonOf = (s) => parseDate(s).getTime() + 12 * 3600e3;

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function fmtDay(s, { long = false, year = false } = {}) {
  const d = parseDate(s);
  const base = long
    ? `${WEEKDAYS_LONG[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`
    : `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return year ? `${base}, ${d.getFullYear()}` : base;
}
export function fmtMonthDay(s) {
  const d = parseDate(s);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
export function monthName(m) { return MONTHS_LONG[m]; }

/** 'Today', 'Tomorrow', 'Yesterday', weekday name within a week, else 'Sat, Oct 4'. */
export function relDay(s, today) {
  const n = daysBetween(today, s);
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WEEKDAYS_LONG[dow(s)];
  if (n < -1 && n > -7) return `last ${WEEKDAYS[dow(s)]}`;
  return fmtDay(s);
}

/** relDay for use mid-sentence: "since today", "avoid tomorrow". */
export const relDayLower = (s, today) => relDay(s, today).replace(/^(Today|Tomorrow|Yesterday)$/, (m) => m.toLowerCase());

export function fmtTime(ts) {
  const d = new Date(ts);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${pad(m)} ${ap}`;
}

/** "4:00 PM", "tomorrow 9:00 AM", or "Sat 9:00 AM". */
export function fmtUntil(ts, now = Date.now()) {
  const day = dateStr(new Date(ts));
  const today = dateStr(new Date(now));
  const n = daysBetween(today, day);
  if (n === 0) return fmtTime(ts);
  if (n === 1) return `tomorrow ${fmtTime(ts)}`;
  if (n < 7) return `${WEEKDAYS[new Date(ts).getDay()]} ${fmtTime(ts)}`;
  return `${fmtMonthDay(day)} ${fmtTime(ts)}`;
}

/* ---------- numbers ---------- */

export function fmtNum(n, d = 1) {
  if (n == null || !Number.isFinite(Number(n))) return '–';
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: 0 });
}
export const fmtIn = (n, d = 2) => `${fmtNum(n, d)}″`;
export const fmtMoney = (n) => (n == null || !Number.isFinite(n) ? '–' : `$${n.toFixed(2)}`);
export const plural = (n, word, pl = `${word}s`) => `${fmtNum(n, 1)} ${Math.abs(n - 1) < 1e-9 ? word : pl}`;

/** Walk a dotted path, e.g. getPath(obj, 'water.tiers.0.rate'). */
export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {};
    o = o[keys[i]];
  }
  o[keys[keys.length - 1]] = value;
}
