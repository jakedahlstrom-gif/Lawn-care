// Yard tab: each section is a row that opens a detail screen. Only numeric values carry an "Estimated"
// badge; unmarked values are trusted. Settings (name, header photo, appearance, Winter Mode, backup, reset)
// live behind the gear.

import {
  S, setSetting, setProvenance, saveSettings, saveZone, deleteZone, saveProduct, deleteProduct,
  exportData, importData, validateBackup, resetAll, subscribe, setHeaderPhoto,
} from '../store.js';
import * as E from '../engine.js';
import { icon } from '../icons.js';
import {
  openSheet, confirmDialog, toast, segmented, provPill, switchHtml, holdButtonHtml, bindHold,
} from '../ui.js';
import {
  HEAD_PRECIP, HEAD_LABELS, SLOPE_LABELS, SUN_LABELS, PRODUCT_TYPES, newZone, newProduct, gpmFor,
} from '../defaults.js';
import { readPhoto } from '../logsheet.js';
import {
  esc, fmtNum, fmtMoney, num, clone, round, getPath, dateStr, WEEKDAYS, nobreak, yearOf,
} from '../util.js';

export const APP_VERSION = '2.1.0';
const f0 = (n) => fmtNum(n, 0);
const ui = { includePhotos: true };
let hooks = { ctx: () => ({}), applyTheme: () => {}, onLocationChange: () => {}, setWinter: async () => {} };
export function setYardHooks(h) { hooks = { ...hooks, ...h }; }

/* ---------- field helpers ---------- */

const pill = (path) => provPill(`settings:${path}`, S.settings.src[path] || 'est');

function inputRow(label, path, { unit = '', kind = 'number', sub = '', placeholder = '' } = {}) {
  const v = getPath(S.settings, path);
  const id = `f-${path.replace(/\./g, '-')}`;
  const numeric = kind !== 'text' && kind !== 'pref';
  const attrs = kind === 'signed'
    ? 'type="number" step="any" inputmode="decimal"'
    : kind === 'text' ? 'type="text" autocomplete="off"' : 'type="text" inputmode="decimal"';
  return `<div class="row field-row-y${kind === 'text' ? ' is-text' : ''}">
    <div class="row-main"><label class="row-title" for="${id}" ${numeric ? `data-prov-key="settings:${path}"` : ''}>${label}</label>${numeric ? pill(path) : ''}${sub ? `<span class="row-sub">${sub}</span>` : ''}</div>
    <div class="input-wrap"><input id="${id}" class="row-input" ${attrs} data-setting="${path}" data-kind="${kind === 'pref' ? 'number' : kind}" value="${esc(v ?? '')}" placeholder="${esc(placeholder)}">${unit ? `<span class="unit">${unit}</span>` : ''}</div>
  </div>`;
}

const infoRow = (label, value, sub = '') => `<div class="row"><span class="row-main"><span class="row-title">${label}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span><span class="row-value">${value}</span></div>`;
const provNote = '<p class="footer-note">Tap <span class="prov est inline">Estimated</span> once you’ve checked a value. Press and hold a value’s name to mark it estimated again.</p>';

/* ---------- sections ---------- */

const SECTIONS = {
  location: {
    title: 'Lawn & Location', icon: 'pin',
    summary: () => `${S.settings.location.name} · ${f0(E.lawnArea(S.zones))} sq ft lawn`,
    render: () => {
      const lawn = E.lawnArea(S.zones);
      const survey = S.settings.location.surveyArea || 0;
      return `<div class="list-card">
        ${inputRow('Location', 'location.name', { kind: 'text' })}
        ${inputRow('Latitude', 'location.lat', { kind: 'signed' })}
        ${inputRow('Longitude', 'location.lon', { kind: 'signed' })}
        ${inputRow('Grass', 'location.grass', { kind: 'text' })}
        ${inputRow('Lot', 'location.lot', { kind: 'text' })}
      </div>
      <div class="list-card">
        ${inputRow('Non-paved area (survey)', 'location.surveyArea', { unit: 'sq ft' })}
        ${infoRow('Mowed lawn (zones)', `<span data-testid="lawn-area">${f0(lawn)} sq ft</span>`)}
        ${infoRow('Beds, easement &amp; other', `${f0(Math.max(0, survey - lawn))} sq ft`, 'Survey area minus lawn zones')}
        ${inputRow('Notes', 'location.notes', { kind: 'text' })}
      </div>${provNote}`;
    },
  },
  zones: {
    title: 'Zones', icon: 'zones',
    summary: () => `${S.zones.length} zones · ${S.zones.filter(E.isSloped).length} sloped · ${f0(E.lawnArea(S.zones))} sq ft lawn`,
    render: () => `<div class="list-card" data-testid="zones">${S.zones.map((z) => `
      <button type="button" class="row row-btn" data-action="zone" data-id="${z.id}">
        <span class="row-main"><span class="row-title">${esc(z.name)}${z.lawn === false ? ' <span class="tag">non-lawn</span>' : ''}</span>
        <span class="row-sub">${f0(z.sqft)} sq ft · ${HEAD_LABELS[z.head] || z.head} · ${SLOPE_LABELS[z.slope] || z.slope}${z.lawn === false ? '' : ` · ${SUN_LABELS[z.sun] || z.sun}`}</span></span>
        ${icon('chev', 'chev')}
      </button>`).join('')}
      <button type="button" class="row row-btn row-add" data-action="add-zone">${icon('plus')}<span>Add zone</span></button>
    </div>
    <p class="footer-note">Matches your Rachio zones. Mark a zone non-lawn (like drip for beds) to count its water cost but leave it out of lawn math. Side Left and Side Right are mowed across the slope.</p>`,
  },
  mower: {
    title: 'Mower', icon: 'mow',
    summary: () => `${S.settings.mower.model} · ${S.settings.mower.heights.length} heights`,
    render: (c) => {
      const cal = E.growthCalibration(S.logs, c.today);
      return `<div class="list-card">${inputRow('Model', 'mower.model', { kind: 'text' })}</div>
      <h3 class="section-h">Cutting heights</h3>
      <div class="list-card">${S.settings.mower.heights.map((h, i) => inputRow(`Position ${i + 1}`, `mower.heights.${i}`, { unit: 'in' })).join('')}</div>
      <div class="list-card">
        ${inputRow('Typical full mow', 'mower.mowHours', { unit: 'h', sub: 'Pre-fills the time on each mow log' })}
        ${infoRow('Mowing hours logged', `<span data-testid="hours-total">${fmtNum(E.mowingHours(S.logs), 2)} h</span>`)}
      </div>
      <p class="footer-note">${cal.count ? `Growth model tuned by ${cal.count} mow ${cal.count === 1 ? 'note' : 'notes'}: ${cal.factor >= 1 ? '+' : ''}${f0((cal.factor - 1) * 100)}%.` : 'Mow notes like “grass was long” or “barely grew” tune the growth model.'}</p>${provNote}`;
    },
  },
  spreader: {
    title: 'Spreader & Clippings', icon: 'spreader',
    summary: () => `${S.settings.spreader.model} · ${S.settings.clippings === 'mulch' ? 'Mulching' : 'Bagging'}`,
    render: () => `<div class="list-card">
      ${inputRow('Spreader', 'spreader.model', { kind: 'text' })}
      <div class="row field-row-y col"><span class="row-main"><span class="row-title">Clippings</span><span class="row-sub">${S.settings.clippings === 'mulch' ? 'Mulching returns some nitrogen (~0.04 lb N/1,000 per mow).' : 'Bagging removes clippings and their nitrogen.'}</span></span>
        ${segmented('clippings', [['mulch', 'Mulch'], ['bag', 'Bag']], S.settings.clippings)}</div>
    </div>
    <p class="footer-note">Recommendations use the Elite setting printed on each Scotts bag. Edit it per product.</p>`,
  },
  products: {
    title: 'Products', icon: 'bag',
    summary: () => `${S.products.length} products · ${S.products.filter((p) => (p.onHand || 0) > 0).length} in stock`,
    render: () => `<div class="list-card" data-testid="products">${S.products.map((p) => {
      const cpn = E.costPerLbN(p);
      return `<button type="button" class="row row-btn" data-action="product" data-id="${p.id}">
        <span class="row-main"><span class="row-title">${esc(nobreak(p.name))}</span>
        <span class="row-sub">${nobreak(`${p.n}-${p.p}-${p.k}`)} · ${PRODUCT_TYPES[p.type] || p.type}${p.elite ? ` · Elite ${esc(p.elite)}` : ''}${cpn ? ` · <strong>${fmtMoney(cpn)}/lb N</strong>` : ''} · ${fmtNum(p.onHand || 0, 1)} ${esc(p.unit)} on hand</span></span>
        ${icon('chev', 'chev')}
      </button>`;
    }).join('')}
      <button type="button" class="row row-btn row-add" data-action="add-product">${icon('plus')}<span>Add product</span></button>
    </div>
    <p class="footer-note">The plan recommends Scotts products. Minnesota restricts phosphorus on lawns unless a soil test shows a need or you’re establishing new turf, so new products default to 0% P.</p>`,
  },
  water: {
    title: 'Water Rates', icon: 'dollar',
    summary: () => { const r = E.waterRateInfo(S.settings, S.zones); return `Tier ${r.idx + 1} · ${fmtMoney(r.per1000)}/1,000 gal`; },
    render: () => {
      const w = S.settings.water;
      const info = E.waterRateInfo(S.settings, S.zones);
      const tiers = E.sortedTiers(w.tiers);
      const inch1 = E.weeklyIrrigationGallons(E.lawnZones(S.zones), 1);
      return `<div class="list-card" data-testid="tiers">
        ${tiers.map((t, i) => {
          const prevCap = i ? tiers[i - 1].upTo : 0;
          const last = t.upTo == null;
          return `<div class="row tier-row">
            <div class="row-main"><span class="row-title" data-prov-key="settings:water.tiers.${i}">Tier ${i + 1}${i === info.topIdx ? ' <span class="tag tag-accent">top tier</span>' : ''}</span>
              <span class="tier-range">${last ? `Over ${f0(prevCap)} gal` : `Up to <input class="mini-input" type="text" inputmode="numeric" data-tier="${i}" data-field="upTo" value="${t.upTo}" aria-label="Tier ${i + 1} upper limit"> gal`}</span>
              ${pill(`water.tiers.${i}`)}</div>
            <div class="input-wrap"><span class="unit">$</span><input class="row-input" type="text" inputmode="decimal" data-tier="${i}" data-field="rate" value="${t.rate}" aria-label="Tier ${i + 1} rate per 1,000 gallons"><span class="unit">/1k</span></div>
            ${tiers.length > 1 ? `<button type="button" class="icon-btn danger" data-action="remove-tier" data-i="${i}" aria-label="Remove tier ${i + 1}">${icon('close')}</button>` : ''}
          </div>`;
        }).join('')}
        <button type="button" class="row row-btn row-add" data-action="add-tier">${icon('plus')}<span>Add tier</span></button>
      </div>
      <div class="list-card">
        <div class="row"><span class="row-main"><span class="row-title">Sewer based on winter usage</span><span class="row-sub">${w.sewerWinter ? 'Irrigation pays water rates only.' : 'Irrigation also pays sewer.'}</span></span>
          ${switchHtml('water.sewerWinter', w.sewerWinter, 'Sewer based on winter usage')}</div>
        ${w.sewerWinter ? '' : inputRow('Sewer rate', 'water.sewerRate', { unit: '$/1k' })}
        <div class="row field-row-y col"><div class="row-main"><span class="row-title">Billing period</span></div>
          ${segmented('water.billing', [['monthly', 'Monthly'], ['bimonthly', 'Bimonthly'], ['quarterly', 'Quarterly']], w.billing)}</div>
        ${inputRow('Non-irrigation use per bill', 'water.baseUsage', { unit: 'gal' })}
        ${inputRow('Typical summer watering', 'water.summerInches', { unit: 'in/wk' })}
        <div class="row field-row-y col"><div class="row-main"><span class="row-title">Charge irrigation at</span><span class="row-sub">Auto uses the top tier your summer bill reaches.</span></div>
          ${segmented('water.rateMode', [['auto', 'Auto'], ...tiers.map((_, i) => [String(i), `Tier ${i + 1}`])], w.rateMode ?? 'auto')}</div>
      </div>
      <div class="card inset-card" data-testid="water-summary">
        <p><strong>Summer bill ≈ ${f0(info.base)} + ${f0(info.periodIrr)} gal irrigation = ${f0(info.total)} gal</strong>, which reaches Tier ${info.topIdx + 1}.</p>
        <p>Irrigation is charged at <strong data-testid="irrigation-rate">${fmtMoney(info.per1000)}/1,000 gal</strong>${info.auto ? ' (your top tier)' : ` (Tier ${info.idx + 1}, set manually)`}${info.sewer ? ', including sewer' : ''}. One inch on the lawn ≈ ${f0(inch1)} gal ≈ <strong>${fmtMoney((inch1 / 1000) * info.per1000)}</strong>.</p>
      </div>${provNote}`;
    },
  },
  schedule: {
    title: 'Mowing Schedule', icon: 'plan',
    summary: () => `About every ${S.settings.mowing.cadenceDays} days · ${S.settings.mowing.preferredDays.map((d) => WEEKDAYS[d]).join(', ') || 'any day'}`,
    render: () => {
      const m = S.settings.mowing;
      return `<div class="list-card">
        ${inputRow('Mow about every', 'mowing.cadenceDays', { unit: 'days', kind: 'pref' })}
        <div class="row field-row-y col"><span class="row-title">Preferred days</span>
          <div class="day-chips">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="chip day ${m.preferredDays.includes(d) ? 'on' : ''}" data-action="toggle-day" data-day="${d}" aria-pressed="${m.preferredDays.includes(d)}">${WEEKDAYS[d]}</button>`).join('')}</div>
        </div>
      </div>
      <p class="footer-note">The next mow lands on the best-weather preferred day near this cadence. Stripes rotate through four directions after each logged mow.</p>`;
    },
  },
  nitrogen: {
    title: 'Nitrogen', icon: 'nitrogen',
    summary: (c) => { const t = E.seasonTotals(c, yearOf(c.today)); return `Target ${fmtNum(t.target, 1)} lb · ${fmtNum(t.nPer1000, 2)} applied this year`; },
    render: (c) => {
      const t = E.seasonTotals(c, yearOf(c.today));
      return `<div class="list-card">
        ${inputRow('Season target', 'nitrogen.seasonTarget', { unit: 'lb N/1k' })}
        ${infoRow('Applied this year', `${fmtNum(t.nPer1000, 2)} lb N/1k`)}
        ${infoRow('From mulched clippings', `~${fmtNum(t.mulchCredit, 2)} lb N/1k`)}
      </div>
      <p class="footer-note">Irrigated Kentucky bluegrass in Minnesota typically gets 2–4 lb N per 1,000 sq ft a year; mulching lets you stay toward the low end. Each Scotts feeding is about 0.8 lb.</p>${provNote}`;
    },
  },
};
const SECTION_ORDER = ['location', 'zones', 'mower', 'spreader', 'products', 'water', 'schedule', 'nitrogen'];

export function renderYard(el, c) {
  el.innerHTML = `
    <header class="page-head with-action">
      <div><h1 class="large-title">Yard</h1><p class="subtitle">${esc(S.settings.location.name)} · ${f0(E.lawnArea(S.zones))} sq ft of lawn</p></div>
      <button type="button" class="icon-btn head-btn" data-action="settings" aria-label="Settings">${icon('gear')}</button>
    </header>
    <div class="list-card section-list" data-testid="yard-sections">${SECTION_ORDER.map((id) => `
      <button type="button" class="row row-btn sec-link" data-action="yard-section" data-id="${id}">
        <span class="sec-ic">${icon(SECTIONS[id].icon)}</span>
        <span class="row-main"><span class="row-title">${SECTIONS[id].title}</span><span class="row-sub">${esc(nobreak(SECTIONS[id].summary(c)))}</span></span>
        ${icon('chev', 'chev')}
      </button>`).join('')}</div>
    <div class="list-card">
      <button type="button" class="row row-btn sec-rachio" data-action="my-zones">
        <span class="sec-ic">${icon('water')}</span>
        <span class="row-main"><span class="row-title">My Zones</span><span class="row-sub">Live from Rachio</span></span>
        ${icon('chev', 'chev')}
      </button>
    </div>
    <p class="footer-note">Values marked <span class="prov est inline">Estimated</span> are guesses until you check them. Everything else is treated as trusted.</p>`;
}

/* ---------- detail screens ---------- */

const NONNEG = /^(mower|water|nitrogen|location\.surveyArea|mowing)/;

async function applySetting(input) {
  const path = input.dataset.setting;
  const kind = input.dataset.kind;
  let v = input.value;
  if (kind === 'text') v = v.trim();
  else {
    const n = num(v, NaN);
    if (!Number.isFinite(n) || (NONNEG.test(path) && n < 0)) {
      toast('Enter a valid number', { kind: 'error', duration: 2500 });
      return false;
    }
    v = n;
    if (path === 'mowing.cadenceDays') v = Math.min(21, Math.max(3, Math.round(n)));
    if (path === 'location.lat' && Math.abs(n) > 90) { toast('Latitude must be between −90 and 90', { kind: 'error', duration: 2500 }); return false; }
    if (path === 'location.lon' && Math.abs(n) > 180) { toast('Longitude must be between −180 and 180', { kind: 'error', duration: 2500 }); return false; }
  }
  await setSetting(path, v);
  if (path === 'location.lat' || path === 'location.lon') hooks.onLocationChange();
  return true;
}

async function applyTier(input) {
  const i = Number(input.dataset.tier);
  const field = input.dataset.field;
  const n = num(input.value, NaN);
  if (!Number.isFinite(n) || n < 0) { toast('Enter a valid number', { kind: 'error', duration: 2500 }); return; }
  const tiers = E.sortedTiers(S.settings.water.tiers).map((t) => ({ ...t }));
  tiers[i][field] = field === 'upTo' ? Math.round(n) : n;
  S.settings.water.tiers = E.sortedTiers(tiers);
  await saveSettings();
}

async function addTier() {
  const tiers = E.sortedTiers(S.settings.water.tiers).map((t) => ({ ...t }));
  const bounded = tiers.filter((t) => t.upTo != null);
  const lastCap = bounded.length ? bounded[bounded.length - 1].upTo : 0;
  const lastRate = tiers.length ? tiers[tiers.length - 1].rate : 5;
  tiers.splice(bounded.length, 0, { upTo: lastCap + 10000, rate: lastRate });
  if (!tiers.some((t) => t.upTo == null)) tiers.push({ upTo: null, rate: lastRate });
  S.settings.water.tiers = tiers;
  await saveSettings();
}

async function removeTier(i) {
  const tiers = E.sortedTiers(S.settings.water.tiers).map((t) => ({ ...t }));
  if (tiers.length <= 1) return;
  tiers.splice(i, 1);
  if (!tiers.some((t) => t.upTo == null)) tiers[tiers.length - 1].upTo = null;
  S.settings.water.tiers = tiers;
  if (S.settings.water.rateMode !== 'auto' && Number(S.settings.water.rateMode) >= tiers.length) S.settings.water.rateMode = 'auto';
  await saveSettings();
}

const editingIn = (root) => {
  const a = document.activeElement;
  return !!a && root.contains(a) && a.matches('textarea, select, input:not([type="checkbox"]):not([type="radio"]):not([type="file"])');
};

/** Press-and-hold on a value's name marks it Estimated again. */
function bindProvLongPress(root, onToggle) {
  let timer = 0;
  root.addEventListener('pointerdown', (e) => {
    const k = e.target.closest('[data-prov-key]');
    if (!k) return;
    clearTimeout(timer);
    timer = setTimeout(() => { timer = 0; onToggle(k.dataset.provKey); }, 550);
  });
  ['pointerup', 'pointercancel', 'pointermove'].forEach((t) => root.addEventListener(t, (e) => { if (t !== 'pointermove' || Math.abs(e.movementX) + Math.abs(e.movementY) > 6) clearTimeout(timer); }));
}

/** A full-height detail screen for one Yard section; edits save as you go. */
export function openYardSection(id) {
  const sec = SECTIONS[id];
  if (!sec) return null;
  const sheet = openSheet({ title: sec.title, className: 'detail-sheet', cancelText: 'Done' });
  sheet.sheet.dataset.section = id;
  let pending = false;
  const render = () => {
    if (editingIn(sheet.body)) { pending = true; return; }
    pending = false;
    const top = sheet.body.scrollTop;
    sheet.body.innerHTML = sec.render(hooks.ctx());
    sheet.body.scrollTop = top;
  };
  render();
  const unsub = subscribe(() => render());
  const close = sheet.close;
  sheet.close = (r) => { unsub(); close(r); };
  sheet.body.addEventListener('focusout', () => setTimeout(() => { if (pending && !editingIn(sheet.body)) render(); }, 0));
  sheet.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.row-input, .mini-input')) e.target.blur(); });
  bindProvLongPress(sheet.body, async (key) => {
    const path = key.slice(key.indexOf(':') + 1);
    if ((S.settings.src[path] || 'est') === 'est') return;
    await setProvenance(path, 'est');
    toast('Marked Estimated', { duration: 1800 });
  });

  sheet.body.addEventListener('click', async (e) => {
    const prov = e.target.closest('[data-prov]');
    if (prov) {
      const path = prov.dataset.prov.slice(prov.dataset.prov.indexOf(':') + 1);
      await setProvenance(path, 'meas');
      return;
    }
    const seg = e.target.closest('[data-seg] .seg-opt');
    if (seg) {
      const name = seg.closest('[data-seg]').dataset.seg;
      await setSetting(name, seg.dataset.value);
      return;
    }
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'zone') openZoneSheet(a.dataset.id);
    else if (act === 'add-zone') openZoneSheet(null);
    else if (act === 'product') openProductSheet(a.dataset.id);
    else if (act === 'add-product') openProductSheet(null);
    else if (act === 'add-tier') await addTier();
    else if (act === 'remove-tier') await removeTier(Number(a.dataset.i));
    else if (act === 'toggle-day') {
      const d = Number(a.dataset.day);
      const days = S.settings.mowing.preferredDays;
      S.settings.mowing.preferredDays = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
      await saveSettings();
    }
  });
  sheet.body.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.setting) { if (!(await applySetting(t))) render(); } else if (t.dataset.tier != null) await applyTier(t);
    else if (t.dataset.switch) await setSetting(t.dataset.switch, t.checked);
  });
  return sheet;
}

/* ---------- settings (gear) ---------- */

export async function doExport() {
  const data = await exportData({ includePhotos: ui.includePhotos });
  const name = `lawn-care-backup-${dateStr()}.json`;
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
  const file = typeof File === 'function' ? new File([blob], name, { type: 'application/json' }) : null;
  if (file && navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
    try {
      await navigator.share({ files: [file], title: 'Lawn Care backup' });
      toast('Backup exported', { duration: 2500 });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 20000);
  toast('Backup downloaded', { duration: 2500 });
}

export async function doImport(file) {
  let obj;
  try {
    obj = JSON.parse(await file.text());
    validateBackup(obj);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file isn’t valid JSON.' : err.message, { kind: 'error', duration: 3500 });
    return false;
  }
  const when = obj.exportedAt ? new Date(obj.exportedAt).toLocaleDateString() : 'unknown date';
  const ok = await confirmDialog({
    title: 'Replace all data on this device?',
    message: `Backup from ${when}: ${obj.logs.length} log entries, ${obj.zones.length} zones, ${obj.products.length} products. Your current data will be overwritten.`,
    confirmText: 'Replace',
    destructive: true,
  });
  if (!ok) return false;
  await importData(obj);
  toast('Backup restored', { duration: 2500 });
  return true;
}

/** Average brightness of the top part of an image (where the header text sits): light or dark. */
function photoTone(dataUrl) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const cv = document.createElement('canvas');
        cv.width = 40;
        cv.height = 40;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight * 0.5, 0, 0, 40, 40);
        const px = g.getImageData(0, 0, 40, 40).data;
        let t = 0;
        for (let i = 0; i < px.length; i += 4) t += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
        resolve(t / (px.length / 4) > 150 ? 'light' : 'dark');
      } catch { resolve('dark'); }
    };
    img.onerror = () => resolve('dark');
    img.src = dataUrl;
  });
}

export function openSettingsSheet() {
  const sheet = openSheet({ title: 'Settings', className: 'settings-sheet', cancelText: 'Done' });
  let pending = false;
  const render = () => {
    if (editingIn(sheet.body)) { pending = true; return; }
    pending = false;
    const photo = S.headerPhoto?.dataUrl;
    sheet.body.innerHTML = `
      <div class="list-card">
        <div class="row field-row-y is-text"><label class="row-title" for="set-name">Your name</label>
          <div class="input-wrap"><input id="set-name" class="row-input" type="text" data-setting="profile.name" data-kind="text" value="${esc(S.settings.profile?.name || '')}" placeholder="For the greeting" autocomplete="given-name"></div></div>
      </div>
      <h3 class="section-h">Header photo</h3>
      <div class="list-card">
        <div class="row photo-pref"><img class="photo-preview" src="${photo || 'img/header.jpg'}" alt="Current header photo">
          <span class="row-main"><span class="row-title">${photo ? 'Your photo' : 'Default photo'}</span><span class="row-sub">Pick one from your camera roll.</span></span></div>
        <label class="row row-btn row-add">${icon('photo')}<span>Choose photo…</span><input type="file" accept="image/*" data-header-photo hidden></label>
        ${photo ? `<button type="button" class="row row-btn row-add" data-act="photo-reset">${icon('refresh')}<span>Use the default photo</span></button>` : ''}
      </div>
      <h3 class="section-h">Appearance</h3>
      <div class="list-card">
        <div class="row field-row-y col"><span class="row-title">Theme</span>
          ${segmented('appearance.theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], S.settings.appearance.theme)}</div>
        <div class="row"><span class="row-main"><span class="row-title">Winter Mode</span><span class="row-sub">Replaces Today with the winter screen. Turn on or off anytime.</span></span>
          ${switchHtml('winter.on', !!S.settings.winter?.on, 'Winter Mode')}</div>
      </div>
      <h3 class="section-h">Backup</h3>
      <div class="list-card">
        <div class="row"><span class="row-main"><span class="row-title">Include photos in export</span></span>${switchHtml('ui.includePhotos', ui.includePhotos, 'Include photos in export')}</div>
        <button type="button" class="row row-btn row-add" data-act="export">${icon('upload')}<span>Export JSON backup</span></button>
        <label class="row row-btn row-add">${icon('download')}<span>Import JSON backup</span><input type="file" accept="application/json,.json" data-import hidden></label>
      </div>
      <p class="footer-note">All data lives only on this iPhone. Export a backup now and then (it can go to Files or iCloud Drive).</p>
      <h3 class="section-h">Reset</h3>
      <div class="reset-box">${holdButtonHtml('Hold to reset all data', { danger: true, hint: 'Deletes every log, product, zone and setting. Press and hold for 1 second.' })}</div>
      <p class="footer-note center">Lawn Care ${APP_VERSION} · Weather by Open-Meteo</p>`;
    const holdBtn = sheet.body.querySelector('[data-hold]');
    bindHold(holdBtn, async () => {
      await resetAll();
      hooks.applyTheme();
      hooks.onLocationChange();
      setTimeout(() => sheet.close(), 400);
      toast('All data reset', { duration: 2500 });
    }, { isGuarded: sheet.guarded, hintEl: sheet.body.querySelector('.hold-hint') });
  };
  render();
  const unsub = subscribe(() => render());
  const close = sheet.close;
  sheet.close = (r) => { unsub(); close(r); };
  sheet.body.addEventListener('focusout', () => setTimeout(() => { if (pending && !editingIn(sheet.body)) render(); }, 0));
  sheet.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('.row-input')) e.target.blur(); });
  sheet.body.addEventListener('click', async (e) => {
    const seg = e.target.closest('[data-seg] .seg-opt');
    if (seg) {
      await setSetting(seg.closest('[data-seg]').dataset.seg, seg.dataset.value);
      hooks.applyTheme();
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'export') doExport().catch((err) => toast(`Export failed: ${err.message}`, { kind: 'error' }));
    if (a.dataset.act === 'photo-reset') { await setHeaderPhoto(null); toast('Default photo restored', { duration: 2000 }); }
  });
  sheet.body.addEventListener('change', async (e) => {
    const t = e.target;
    if (t.dataset.setting) { if (!(await applySetting(t))) render(); } else if (t.dataset.switch === 'ui.includePhotos') ui.includePhotos = t.checked;
    else if (t.dataset.switch === 'winter.on') { await hooks.setWinter(t.checked); } else if (t.dataset.import != null && t.files?.[0]) {
      const ok = await doImport(t.files[0]);
      t.value = '';
      if (ok) { hooks.applyTheme(); hooks.onLocationChange(); }
    } else if (t.dataset.headerPhoto != null && t.files?.[0]) {
      try {
        const dataUrl = await readPhoto(t.files[0], 1600, 0.82);
        await setHeaderPhoto({ dataUrl, tone: await photoTone(dataUrl) });
        toast('Header photo updated', { duration: 2000 });
      } catch (err) {
        toast(err.message || 'Couldn’t read that photo', { kind: 'error', duration: 3000 });
      }
      t.value = '';
    }
  });
  return sheet;
}

/* ---------- zone editor ---------- */

const zPill = (draft, field) => provPill(`zone:${field}`, draft.src?.[field] || 'est');

function zoneField(draft, label, field, unit, sub = '') {
  return `<div class="row field-row-y">
    <div class="row-main"><label class="row-title" for="zf-${field}" data-prov-key="zone:${field}">${label}</label>${zPill(draft, field)}${sub ? `<span class="row-sub">${sub}</span>` : ''}</div>
    <div class="input-wrap"><input id="zf-${field}" class="row-input" type="text" inputmode="decimal" data-zfield="${field}" value="${esc(draft[field] ?? '')}"><span class="unit">${unit}</span></div>
  </div>`;
}

function zoneCalc(draft) {
  const rate = E.waterRateInfo(S.settings, S.zones);
  const z = { ...draft, sqft: num(draft.sqft), gpm: num(draft.gpm), precip: num(draft.precip), weeklyMinutes: num(draft.weeklyMinutes) };
  if (z.lawn === false) {
    const gal = z.weeklyMinutes * z.gpm;
    return `Weekly: ${f0(z.weeklyMinutes)} min · ${f0(gal)} gal · ${fmtMoney((gal / 1000) * rate.per1000)} at ${fmtMoney(rate.per1000)}/1k.`;
  }
  const min = E.runtimeFor(z, 1);
  const gal = E.gallonsFor(z, 1);
  let s = `1″ of water: ${f0(min)} min · ${f0(gal)} gal · ${fmtMoney((gal / 1000) * rate.per1000)}.`;
  const implied = z.sqft > 0 ? (96.25 * z.gpm) / z.sqft : 0;
  if (implied > 0 && z.precip > 0 && Math.abs(implied - z.precip) / z.precip > 0.3) s += ` (Flow and area imply ${fmtNum(implied, 2)} in/hr.)`;
  const cs = E.cycleSoak(z, min);
  if (cs) s += ` Sloped: cycle and soak — no more than ~${f0(cs.maxMin)} min per cycle, 30–60 min soak between. Mow across the slope.`;
  return s;
}

export function openZoneSheet(id, onDone) {
  const existing = S.zones.find((z) => z.id === id);
  const draft = existing ? clone(existing) : newZone();
  draft.src = draft.src || {};
  const sheet = openSheet({
    title: existing ? 'Edit zone' : 'New zone',
    className: 'zone-sheet',
    right: '<button type="button" class="link-btn strong" data-act="save">Save</button>',
  });
  const render = () => {
    const nonLawn = draft.lawn === false;
    const heads = nonLawn ? [['drip', 'Drip'], ['spray', 'Spray'], ['rotor', 'Rotor'], ['rotary', 'Rotary']] : [['spray', 'Spray'], ['rotor', 'Rotor'], ['rotary', 'Rotary']];
    sheet.body.innerHTML = `
      <div class="list-card">
        <div class="row field-row-y is-text"><label class="row-title" for="zf-name">Name</label>
          <div class="input-wrap"><input id="zf-name" class="row-input" type="text" data-zfield="name" value="${esc(draft.name)}" placeholder="e.g., Front Beds" autocomplete="off"></div></div>
        <div class="row"><span class="row-main"><span class="row-title">Counts as lawn</span><span class="row-sub">${nonLawn ? 'Non-lawn: water cost only (beds, drip).' : 'Used for mowing, fertilizer and nitrogen math.'}</span></span>
          ${switchHtml('lawn', !nonLawn, 'Counts as lawn')}</div>
        ${zoneField(draft, 'Area', 'sqft', 'sq ft')}
      </div>
      <div class="list-card">
        <div class="row field-row-y col"><span class="row-title">Slope</span>${segmented('slope', Object.entries(SLOPE_LABELS), draft.slope)}</div>
        ${nonLawn ? '' : `<div class="row field-row-y col"><span class="row-title">Sun</span>${segmented('sun', Object.entries(SUN_LABELS), draft.sun)}</div>`}
        <div class="row field-row-y col"><div class="row-main"><span class="row-title">Head type</span><span class="row-sub">Picking a head fills its typical precipitation rate.</span></div>${segmented('head', heads, draft.head)}</div>
        ${zoneField(draft, 'Flow rate', 'gpm', 'GPM')}
        ${draft.head === 'drip' ? '' : zoneField(draft, 'Precipitation rate', 'precip', 'in/hr')}
        ${nonLawn ? zoneField(draft, 'Weekly runtime', 'weeklyMinutes', 'min') : ''}
      </div>
      <p class="footer-note" data-out="zone-calc">${esc(zoneCalc(draft))}</p>
      ${existing ? `<button type="button" class="btn btn-delete" data-act="delete">${icon('trash')} Delete zone</button>` : ''}`;
  };
  render();

  // An estimated flow rate follows area and head type; a trusted one is left alone.
  function syncGpm() {
    if (draft.src.gpm === 'meas' || draft.head === 'drip' || !(num(draft.precip) > 0)) return false;
    draft.gpm = gpmFor(num(draft.precip), num(draft.sqft));
    return true;
  }

  const save = async () => {
    const name = String(draft.name || '').trim();
    if (!name) { toast('Give the zone a name', { kind: 'error', duration: 2500 }); return; }
    const z = {
      ...draft,
      name,
      sqft: Math.max(0, num(draft.sqft)),
      gpm: Math.max(0, num(draft.gpm)),
      precip: Math.max(0, num(draft.precip)),
      weeklyMinutes: Math.max(0, num(draft.weeklyMinutes)),
    };
    await saveZone(z);
    sheet.close();
    onDone?.();
    toast(existing ? 'Zone saved' : 'Zone added', { duration: 2000 });
  };

  bindProvLongPress(sheet.body, (key) => {
    const field = key.split(':')[1];
    if (draft.src[field] === 'meas') { draft.src[field] = 'est'; render(); }
  });
  sheet.el.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-prov]');
    if (p) {
      draft.src[p.dataset.prov.split(':')[1]] = 'meas';
      render();
      return;
    }
    const seg = e.target.closest('[data-seg] .seg-opt');
    if (seg) {
      const name = seg.closest('[data-seg]').dataset.seg;
      draft[name] = seg.dataset.value;
      if (name === 'head') {
        draft.precip = HEAD_PRECIP[draft.head] ?? 0;
        draft.src.precip = 'est';
        syncGpm();
      }
      render();
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'save') await save();
    if (a.dataset.act === 'delete') {
      const ok = await confirmDialog({ title: `Delete ${existing.name}?`, message: 'Past log entries keep their dates and amounts.', confirmText: 'Delete', destructive: true });
      if (!ok) return;
      await deleteZone(existing.id);
      sheet.close();
      onDone?.();
      toast('Zone deleted', { undo: async () => { await saveZone(existing); onDone?.(); } });
    }
  });
  sheet.body.addEventListener('input', (e) => {
    const f = e.target.dataset.zfield;
    if (!f) return;
    draft[f] = e.target.value;
    if ((f === 'sqft' || f === 'precip') && syncGpm()) {
      const g = sheet.body.querySelector('[data-zfield="gpm"]');
      if (g) g.value = draft.gpm;
    }
    const out = sheet.body.querySelector('[data-out="zone-calc"]');
    if (out) out.textContent = zoneCalc(draft);
  });
  sheet.body.addEventListener('change', (e) => {
    if (e.target.dataset.switch === 'lawn') {
      draft.lawn = e.target.checked;
      if (!draft.lawn && draft.head !== 'drip' && !existing) draft.head = 'drip';
      if (draft.lawn && draft.head === 'drip') { draft.head = 'spray'; draft.precip = HEAD_PRECIP.spray; }
      render();
    }
  });
}

/* ---------- product editor ---------- */

const pPill = (draft, field) => provPill(`product:${field}`, draft.src?.[field] || 'est');

function productField(draft, label, field, unit, { text = false, sub = '', prov = true } = {}) {
  return `<div class="row field-row-y${text && !prov ? ' is-text' : ''}">
    <div class="row-main"><label class="row-title" for="pf-${field}" ${prov ? `data-prov-key="product:${field}"` : ''}>${label}</label>${prov ? pPill(draft, field) : ''}${sub ? `<span class="row-sub">${sub}</span>` : ''}</div>
    <div class="input-wrap"><input id="pf-${field}" class="row-input" type="text" ${text ? 'autocomplete="off"' : 'inputmode="decimal"'} data-pfield="${field}" value="${esc(draft[field] ?? '')}">${unit ? `<span class="unit">${unit}</span>` : ''}</div>
  </div>`;
}

function productCalc(draft) {
  const p = { ...draft };
  ['n', 'p', 'k', 'size', 'coverage', 'price', 'onHand', 'mixRate'].forEach((k) => { p[k] = num(draft[k]); });
  const area = E.lawnArea(S.zones);
  const lines = [];
  if (p.type === 'weed') {
    if (p.mixRate > 0) lines.push(`Mix ${fmtNum(p.mixRate, 2)} ${p.unit} per gallon; a ${fmtNum(p.size, 1)} ${p.unit} container makes about ${fmtNum(p.size / p.mixRate, 1)} gallons of spray.`);
    return lines.join(' ');
  }
  const rate = E.ratePer1000(p);
  if (rate > 0) lines.push(`Rate: ${fmtNum(rate, 2)} ${p.unit}/1,000 sq ft${p.unit === 'lb' && p.n ? ` → ${fmtNum(E.nPer1000(p), 2)} lb N/1,000` : ''}.`);
  const cpn = E.costPerLbN(p);
  if (cpn) lines.push(`Cost per pound of nitrogen: ${fmtMoney(cpn)}.`);
  if (rate > 0) lines.push(`All lawn zones (${f0(area)} sq ft): ${fmtNum(E.amountFor(p, area), 1)} ${p.unit}.`);
  return lines.join(' ');
}

export function openProductSheet(id, { type, onDone } = {}) {
  const existing = S.products.find((p) => p.id === id);
  const draft = existing ? clone(existing) : newProduct();
  if (!existing && type) draft.type = type;
  if (!existing && type === 'weed') Object.assign(draft, { unit: 'fl oz', mixRate: 2, noMowDays: 2, keepOffHours: 2 });
  draft.bagOptions = (draft.bagOptions || []).map((o) => ({ ...o }));
  draft.src = draft.src || {};
  const sheet = openSheet({
    title: existing ? 'Edit product' : 'New product',
    className: 'product-sheet',
    right: '<button type="button" class="link-btn strong" data-act="save">Save</button>',
  });
  const render = () => {
    const pWarn = num(draft.p) > 0;
    const spray = draft.type === 'weed';
    sheet.body.innerHTML = `
      <div class="list-card">
        <div class="row field-row-y is-text"><label class="row-title" for="pf-name">Name</label>
          <div class="input-wrap"><input id="pf-name" class="row-input" type="text" data-pfield="name" value="${esc(draft.name)}" placeholder="e.g., Scotts Turf Builder Lawn Food" autocomplete="off"></div></div>
        <div class="row field-row-y is-text"><label class="row-title" for="pf-short">Short name</label>
          <div class="input-wrap"><input id="pf-short" class="row-input" type="text" data-pfield="short" value="${esc(draft.short || '')}" placeholder="e.g., Lawn Food" autocomplete="off"></div></div>
        <div class="row field-row-y col"><span class="row-title">Type</span>${segmented('type', Object.entries(PRODUCT_TYPES).map(([k, v]) => [k, v.replace('Crabgrass preventer', 'Preventer').replace('Grub control', 'Grubs')]), draft.type)}</div>
      </div>
      ${spray ? '' : `<h3 class="section-h">Analysis (N-P-K %)</h3>
      <div class="list-card">
        ${productField(draft, 'Nitrogen (N)', 'n', '%')}
        ${productField(draft, 'Phosphorus (P)', 'p', '%')}
        ${productField(draft, 'Potassium (K)', 'k', '%')}
      </div>
      ${pWarn ? `<div class="banner banner-warn">${icon('alert')}<div>Minnesota law limits phosphorus on established lawns unless a soil test shows a need or you’re establishing new turf.</div></div>` : ''}`}
      <h3 class="section-h">${spray ? 'Container &amp; mix' : 'Bag &amp; spreader'}</h3>
      <div class="list-card">
        <div class="row field-row-y col"><span class="row-title">Unit</span>${segmented('unit', [['lb', 'lb'], ['fl oz', 'fl oz'], ['oz', 'oz'], ['gal', 'gal']], draft.unit)}</div>
        ${productField(draft, spray ? 'Container size' : 'Bag size', 'size', draft.unit)}
        ${spray ? productField(draft, 'Label mix rate', 'mixRate', `${draft.unit}/gal`, { sub: 'From the label, per gallon of water.' }) : productField(draft, 'Coverage per bag', 'coverage', 'sq ft')}
        ${productField(draft, spray ? 'Price' : 'Price per bag', 'price', '$')}
        ${spray ? '' : productField(draft, `${esc(S.settings.spreader.model)} setting`, 'elite', '', { text: true, sub: 'As printed on the bag.' })}
      </div>
      ${spray ? '' : `<h3 class="section-h">Bag sizes you can buy</h3>
      <div class="list-card" data-testid="bag-options">
        ${draft.bagOptions.map((o, i) => `<div class="row tier-row">
          <div class="row-main"><span class="row-title">Size ${i + 1}</span></div>
          <div class="input-wrap"><input class="row-input" type="text" inputmode="decimal" data-bag="${i}" data-field="size" value="${o.size ?? ''}" aria-label="Bag ${i + 1} size"><span class="unit">${esc(draft.unit)}</span>
          <span class="unit">$</span><input class="row-input" type="text" inputmode="decimal" data-bag="${i}" data-field="price" value="${o.price ?? ''}" aria-label="Bag ${i + 1} price"></div>
          <button type="button" class="icon-btn danger" data-act="bag-remove" data-i="${i}" aria-label="Remove bag size ${i + 1}">${icon('close')}</button>
        </div>`).join('')}
        <button type="button" class="row row-btn row-add" data-act="bag-add">${icon('plus')}<span>Add bag size</span></button>
      </div>
      <p class="footer-note">The shopping list picks the mix of bag sizes that leaves the least left over.</p>`}
      <h3 class="section-h">Safety intervals</h3>
      <div class="list-card">
        ${productField(draft, 'Keep kids &amp; pets off', 'keepOffHours', 'hours')}
        ${productField(draft, 'No rain after', 'noRainHours', 'hours', { sub: spray ? 'Spot spray needs 24 dry hours.' : 'Sloped zones double this for granular products (min 48 h).' })}
        ${productField(draft, 'No mowing after', 'noMowDays', 'days')}
      </div>
      <h3 class="section-h">Inventory</h3>
      <div class="list-card">
        ${productField(draft, 'On hand', 'onHand', draft.unit)}
        <div class="row bag-steps">
          <button type="button" class="btn btn-plain" data-act="bag" data-n="-1">− 1 ${spray ? 'container' : 'bag'}</button>
          <button type="button" class="btn btn-plain" data-act="bag" data-n="1">+ 1 ${spray ? 'container' : 'bag'}</button>
        </div>
      </div>
      <p class="footer-note" data-out="product-calc">${esc(productCalc(draft))}</p>
      ${existing ? `<button type="button" class="btn btn-delete" data-act="delete">${icon('trash')} Delete product</button>` : ''}`;
  };
  render();

  const save = async () => {
    const name = String(draft.name || '').trim();
    if (!name) { toast('Give the product a name', { kind: 'error', duration: 2500 }); return; }
    const p = { ...draft, name, short: String(draft.short || '').trim(), elite: String(draft.elite ?? '').trim() };
    ['n', 'p', 'k', 'size', 'coverage', 'price', 'keepOffHours', 'noRainHours', 'noMowDays', 'onHand', 'mixRate'].forEach((k) => { p[k] = Math.max(0, num(draft[k])); });
    if (p.type === 'weed' && !(p.coverage > 0)) p.coverage = p.mixRate > 0 ? (p.size / p.mixRate) * 500 : 0;
    p.bagOptions = draft.bagOptions.map((o) => ({ size: Math.max(0, num(o.size)), price: Math.max(0, num(o.price)) })).filter((o) => o.size > 0);
    if (!p.bagOptions.length && p.size > 0) p.bagOptions = [{ size: p.size, price: p.price }];
    p.onHand = round(p.onHand, 3);
    await saveProduct(p);
    sheet.close();
    onDone?.();
    toast(existing ? 'Product saved' : 'Product added', { duration: 2000 });
  };

  bindProvLongPress(sheet.body, (key) => {
    const field = key.split(':')[1];
    if (draft.src[field] === 'meas') { draft.src[field] = 'est'; render(); }
  });
  sheet.el.addEventListener('click', async (e) => {
    const pv = e.target.closest('[data-prov]');
    if (pv) {
      draft.src[pv.dataset.prov.split(':')[1]] = 'meas';
      render();
      return;
    }
    const seg = e.target.closest('[data-seg] .seg-opt');
    if (seg) {
      draft[seg.closest('[data-seg]').dataset.seg] = seg.dataset.value;
      render();
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'save') await save();
    else if (a.dataset.act === 'bag') {
      draft.onHand = round(Math.max(0, num(draft.onHand) + Number(a.dataset.n) * num(draft.size)), 3);
      render();
    } else if (a.dataset.act === 'bag-add') {
      draft.bagOptions.push({ size: '', price: '' });
      render();
    } else if (a.dataset.act === 'bag-remove') {
      draft.bagOptions.splice(Number(a.dataset.i), 1);
      render();
    } else if (a.dataset.act === 'delete') {
      const ok = await confirmDialog({ title: `Delete ${existing.name}?`, message: 'Past log entries keep the product name and amounts.', confirmText: 'Delete', destructive: true });
      if (!ok) return;
      await deleteProduct(existing.id);
      sheet.close();
      onDone?.();
      toast('Product deleted', { undo: async () => { await saveProduct(existing); onDone?.(); } });
    }
  });
  sheet.body.addEventListener('input', (e) => {
    const f = e.target.dataset.pfield;
    if (f) draft[f] = e.target.value;
    else if (e.target.dataset.bag != null) draft.bagOptions[Number(e.target.dataset.bag)][e.target.dataset.field] = e.target.value;
    else return;
    const out = sheet.body.querySelector('[data-out="product-calc"]');
    if (out) out.textContent = productCalc(draft);
  });
  sheet.body.addEventListener('change', (e) => {
    if (e.target.dataset.pfield === 'p') render();
  });
}

