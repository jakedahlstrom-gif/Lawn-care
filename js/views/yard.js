// Yard tab: every setting, editable, each labeled Estimated or Measured. Also zone/product editors and backup.

import {
  S, setSetting, setProvenance, saveSettings, saveZone, deleteZone, saveProduct, deleteProduct,
  exportData, importData, validateBackup, resetAll, saveLog, deleteLog,
} from '../store.js';
import * as E from '../engine.js';
import { icon } from '../icons.js';
import { openSheet, confirmDialog, toast, segmented, provPill, switchHtml } from '../ui.js';
import {
  HEAD_PRECIP, HEAD_LABELS, SLOPE_LABELS, SUN_LABELS, PRODUCT_TYPES, newZone, newProduct, gpmFor,
} from '../defaults.js';
import {
  esc, fmtNum, fmtMoney, num, clone, round, uid, getPath, dateStr, WEEKDAYS, nobreak,
} from '../util.js';

export const APP_VERSION = '1.0.0';
const f0 = (n) => fmtNum(n, 0);
const ui = { includePhotos: true };

/* ---------- row helpers ---------- */

const pill = (path) => provPill(`settings:${path}`, S.settings.src[path] || 'est');

function inputRow(label, path, { unit = '', kind = 'number', sub = '', prov = true, placeholder = '' } = {}) {
  const v = getPath(S.settings, path);
  const id = `f-${path.replace(/\./g, '-')}`;
  const attrs = kind === 'signed'
    ? 'type="number" step="any" inputmode="decimal"'
    : kind === 'number' ? 'type="text" inputmode="decimal"' : 'type="text" autocomplete="off"';
  const shown = kind === 'text' ? (v ?? '') : (v == null || v === '' ? '' : String(v));
  return `<div class="row field-row-y${kind === 'text' ? ' is-text' : ''}">
    <div class="row-main"><label class="row-title" for="${id}">${label}</label>${prov ? pill(path) : ''}${sub ? `<span class="row-sub">${sub}</span>` : ''}</div>
    <div class="input-wrap"><input id="${id}" class="row-input" ${attrs} data-setting="${path}" data-kind="${kind}" value="${esc(shown)}" placeholder="${esc(placeholder)}">${unit ? `<span class="unit">${unit}</span>` : ''}</div>
  </div>`;
}

const infoRow = (label, value, sub = '') => `<div class="row"><span class="row-main"><span class="row-title">${label}</span>${sub ? `<span class="row-sub">${sub}</span>` : ''}</span><span class="row-value">${value}</span></div>`;

/* ---------- sections ---------- */

function locationSection() {
  const lawn = E.lawnArea(S.zones);
  const survey = S.settings.location.surveyArea || 0;
  return `<h2 class="section-h">Lawn &amp; location</h2>
    <div class="group">
      ${inputRow('Location', 'location.name', { kind: 'text', prov: false })}
      ${inputRow('Latitude', 'location.lat', { kind: 'signed' })}
      ${inputRow('Longitude', 'location.lon', { kind: 'signed' })}
      ${inputRow('Grass', 'location.grass', { kind: 'text' })}
      ${inputRow('Lot', 'location.lot', { kind: 'text' })}
      ${inputRow('Non-paved area (survey)', 'location.surveyArea', { unit: 'sq ft' })}
      ${infoRow('Mowed lawn (zones)', `<span data-testid="lawn-area">${f0(lawn)} sq ft</span>`)}
      ${infoRow('Beds, easement &amp; other', `${f0(Math.max(0, survey - lawn))} sq ft`, 'Survey area minus lawn zones')}
      ${inputRow('Notes', 'location.notes', { kind: 'text', prov: false })}
    </div>`;
}

function zonesSection() {
  return `<h2 class="section-h">Zones <span class="section-count">${S.zones.length}</span></h2>
    <div class="group" data-testid="zones">${S.zones.map((z) => `
      <button type="button" class="row row-btn" data-action="zone" data-id="${z.id}">
        <span class="row-main"><span class="row-title">${esc(z.name)}${z.lawn === false ? ' <span class="tag">non-lawn</span>' : ''}</span>
        <span class="row-sub">${f0(z.sqft)} sq ft · ${HEAD_LABELS[z.head] || z.head} · ${SLOPE_LABELS[z.slope] || z.slope}${z.lawn === false ? '' : ` · ${SUN_LABELS[z.sun] || z.sun}`}</span></span>
        ${icon('chev', 'chev')}
      </button>`).join('')}
      <button type="button" class="row row-btn row-add" data-action="add-zone">${icon('plus')}<span>Add zone</span></button>
    </div>
    <p class="footer-note">Matches your Rachio zones. Mark a zone non-lawn (like drip for beds) to count its water cost but leave it out of lawn math.</p>`;
}

function mowerSection(c) {
  const m = S.settings.mower;
  const hrs = E.mowerHours(S.settings, S.logs);
  const cal = E.growthCalibration(S.logs, c.today);
  return `<h2 class="section-h">Mower</h2>
    <div class="group">
      ${inputRow('Model', 'mower.model', { kind: 'text' })}
      ${m.heights.map((h, i) => inputRow(`Position ${i + 1}`, `mower.heights.${i}`, { unit: 'in' })).join('')}
    </div>
    <div class="group">
      ${inputRow('Typical full mow', 'mower.mowHours', { unit: 'h', sub: 'Added to hours each mow' })}
      ${inputRow('Sharpen every', 'mower.sharpenEvery', { unit: 'h' })}
      ${infoRow('Since last sharpening', `<strong class="${hrs.due ? 'warn-text' : ''}" data-testid="hours-since">${fmtNum(hrs.since, 2)} h</strong>`, hrs.lastSharpen ? `Sharpened ${esc(hrs.lastSharpen.date)}` : 'Includes hours at setup')}
      ${infoRow('Total mowing hours', `<span data-testid="hours-total">${fmtNum(hrs.total, 2)} h</span>`)}
      ${inputRow('Hours since sharpening at setup', 'mower.sinceSharpenAtStart', { unit: 'h' })}
      ${inputRow('Hours before using this app', 'mower.hoursBefore', { unit: 'h' })}
      <button type="button" class="row row-btn row-add" data-action="mark-sharpened">${icon('blade')}<span>Mark blade sharpened today</span></button>
    </div>
    ${cal.count ? `<p class="footer-note">Growth model tuned by ${cal.count} mow ${cal.count === 1 ? 'note' : 'notes'}: ${cal.factor >= 1 ? '+' : ''}${f0((cal.factor - 1) * 100)}%.</p>` : '<p class="footer-note">Mow notes like “grass was long” or “barely grew” tune the growth model.</p>'}`;
}

function spreaderSection() {
  return `<h2 class="section-h">Spreader &amp; clippings</h2>
    <div class="group">
      ${inputRow('Spreader', 'spreader.model', { kind: 'text' })}
      <div class="row field-row-y col"><span class="row-main"><span class="row-title">Clippings</span><span class="row-sub">${S.settings.clippings === 'mulch' ? 'Mulching returns some nitrogen (~0.04 lb N/1,000 per mow).' : 'Bagging removes clippings and their nitrogen.'}</span></span>
        ${segmented('clippings', [['mulch', 'Mulch'], ['bag', 'Bag']], S.settings.clippings)}</div>
    </div>`;
}

function productsSection() {
  return `<h2 class="section-h">Products <span class="section-count">${S.products.length}</span></h2>
    <div class="group" data-testid="products">${S.products.map((p) => {
      const cpn = E.costPerLbN(p);
      return `<button type="button" class="row row-btn" data-action="product" data-id="${p.id}">
        <span class="row-main"><span class="row-title">${esc(nobreak(p.name))}</span>
        <span class="row-sub">${nobreak(`${p.n}-${p.p}-${p.k}`)} · ${PRODUCT_TYPES[p.type]}${cpn ? ` · <strong>${fmtMoney(cpn)}/lb N</strong>` : ''} · ${fmtNum(p.onHand || 0, 1)} ${esc(p.unit)} on hand</span></span>
        ${icon('chev', 'chev')}
      </button>`;
    }).join('')}
      <button type="button" class="row row-btn row-add" data-action="add-product">${icon('plus')}<span>Add product</span></button>
    </div>
    <p class="footer-note">Minnesota restricts phosphorus on lawns unless a soil test shows a need or you’re establishing new turf, so new products default to 0% P.</p>`;
}

function waterSection() {
  const w = S.settings.water;
  const info = E.waterRateInfo(S.settings, S.zones);
  const tiers = E.sortedTiers(w.tiers);
  const inch1 = E.weeklyIrrigationGallons(E.lawnZones(S.zones), 1);
  return `<h2 class="section-h">Water rates</h2>
    <div class="group" data-testid="tiers">
      ${tiers.map((t, i) => {
        const prevCap = i ? tiers[i - 1].upTo : 0;
        const last = t.upTo == null;
        return `<div class="row tier-row">
          <div class="row-main"><span class="row-title">Tier ${i + 1}${i === info.topIdx ? ' <span class="tag tag-accent">top tier</span>' : ''}</span>
            <span class="tier-range">${last ? `Over ${f0(prevCap)} gal` : `Up to <input class="mini-input" type="text" inputmode="numeric" data-tier="${i}" data-field="upTo" value="${t.upTo}" aria-label="Tier ${i + 1} upper limit"> gal`}</span>
            ${pill(`water.tiers.${i}`)}</div>
          <div class="input-wrap"><span class="unit">$</span><input class="row-input" type="text" inputmode="decimal" data-tier="${i}" data-field="rate" value="${t.rate}" aria-label="Tier ${i + 1} rate per 1,000 gallons"><span class="unit">/1k</span></div>
          ${tiers.length > 1 ? `<button type="button" class="icon-btn danger" data-action="remove-tier" data-i="${i}" aria-label="Remove tier ${i + 1}">${icon('close')}</button>` : ''}
        </div>`;
      }).join('')}
      <button type="button" class="row row-btn row-add" data-action="add-tier">${icon('plus')}<span>Add tier</span></button>
    </div>
    <div class="group">
      <div class="row"><span class="row-main"><span class="row-title">Sewer based on winter usage</span>${pill('water.sewerWinter')}<span class="row-sub">${w.sewerWinter ? 'Irrigation pays water rates only.' : 'Irrigation also pays sewer.'}</span></span>
        ${switchHtml('water.sewerWinter', w.sewerWinter, 'Sewer based on winter usage')}</div>
      ${w.sewerWinter ? '' : inputRow('Sewer rate', 'water.sewerRate', { unit: '$/1k' })}
      <div class="row field-row-y col"><div class="row-main"><span class="row-title">Billing period</span>${pill('water.billing')}</div>
        ${segmented('water.billing', [['monthly', 'Monthly'], ['bimonthly', 'Bimonthly'], ['quarterly', 'Quarterly']], w.billing)}</div>
      ${inputRow('Non-irrigation use per bill', 'water.baseUsage', { unit: 'gal' })}
      ${inputRow('Typical summer watering', 'water.summerInches', { unit: 'in/wk' })}
      <div class="row field-row-y col"><div class="row-main"><span class="row-title">Charge irrigation at</span><span class="row-sub">Auto uses the top tier your summer bill reaches.</span></div>
        ${segmented('water.rateMode', [['auto', 'Auto'], ...tiers.map((_, i) => [String(i), `Tier ${i + 1}`])], w.rateMode ?? 'auto')}</div>
    </div>
    <div class="card inset-card" data-testid="water-summary">
      <p><strong>Summer bill ≈ ${f0(info.base)} + ${f0(info.periodIrr)} gal irrigation = ${f0(info.total)} gal</strong>, which reaches Tier ${info.topIdx + 1}.</p>
      <p>Irrigation is charged at <strong data-testid="irrigation-rate">${fmtMoney(info.per1000)}/1,000 gal</strong>${info.auto ? ' (your top tier)' : ` (Tier ${info.idx + 1}, set manually)`}${info.sewer ? ', including sewer' : ''}. One inch on the lawn ≈ ${f0(inch1)} gal ≈ <strong>${fmtMoney((inch1 / 1000) * info.per1000)}</strong>.</p>
    </div>`;
}

function scheduleSection() {
  const m = S.settings.mowing;
  return `<h2 class="section-h">Mowing schedule</h2>
    <div class="group">
      ${inputRow('Mow about every', 'mowing.cadenceDays', { unit: 'days', prov: false })}
      <div class="row field-row-y col"><span class="row-title">Preferred days</span>
        <div class="day-chips">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<button type="button" class="chip day ${m.preferredDays.includes(d) ? 'on' : ''}" data-action="toggle-day" data-day="${d}" aria-pressed="${m.preferredDays.includes(d)}">${WEEKDAYS[d]}</button>`).join('')}</div>
      </div>
    </div>
    <h2 class="section-h">Nitrogen</h2>
    <div class="group">${inputRow('Season target', 'nitrogen.seasonTarget', { unit: 'lb N/1k' })}</div>
    <p class="footer-note">Irrigated Kentucky bluegrass in Minnesota typically gets 2–4 lb N per 1,000 sq ft a year; mulching lets you stay toward the low end.</p>`;
}

function settingsSection() {
  return `<h2 class="section-h" id="settings">Settings</h2>
    <div class="group">
      <div class="row field-row-y col"><span class="row-title">Appearance</span>
        ${segmented('appearance.theme', [['system', 'Match iPhone'], ['light', 'Light'], ['dark', 'Dark']], S.settings.appearance.theme)}</div>
    </div>
    <h2 class="section-h">Backup</h2>
    <div class="group">
      <div class="row"><span class="row-main"><span class="row-title">Include photos in export</span></span>${switchHtml('ui.includePhotos', ui.includePhotos, 'Include photos in export')}</div>
      <button type="button" class="row row-btn row-add" data-action="export">${icon('upload')}<span>Export JSON backup</span></button>
      <label class="row row-btn row-add">${icon('download')}<span>Import JSON backup</span><input type="file" accept="application/json,.json" data-import hidden></label>
    </div>
    <p class="footer-note">All data lives only on this device. Export a backup now and then (it can go to Files or iCloud Drive).</p>
    <div class="group">
      <button type="button" class="row row-btn row-danger" data-action="reset">${icon('trash')}<span>Reset all data</span></button>
    </div>
    <p class="footer-note center">Lawn Care ${APP_VERSION} · Weather by Open-Meteo</p>`;
}

export function renderYard(el, c) {
  el.innerHTML = `
    <header class="page-head with-action">
      <div><h1 class="large-title">Yard</h1><p class="subtitle">${esc(S.settings.location.name)} · ${f0(E.lawnArea(S.zones))} sq ft of lawn</p></div>
      <button type="button" class="icon-btn head-btn" data-action="goto-settings" aria-label="Settings">${icon('gear')}</button>
    </header>
    <p class="hint legend">${provPill('legend:est', 'est')} ${provPill('legend:meas', 'meas')} Tap a label to switch it.</p>
    ${locationSection()}
    ${zonesSection()}
    ${mowerSection(c)}
    ${spreaderSection()}
    ${productsSection()}
    ${waterSection()}
    ${scheduleSection()}
    ${settingsSection()}`;
}

/* ---------- event handlers (wired by app.js) ---------- */

const NONNEG = /^(mower|water|nitrogen|location\.surveyArea|mowing)/;

export async function onSettingChange(input) {
  const path = input.dataset.setting;
  const kind = input.dataset.kind;
  let v = input.value;
  if (kind === 'text') v = v.trim();
  else {
    const n = num(v, NaN);
    if (!Number.isFinite(n) || (NONNEG.test(path) && n < 0)) {
      toast('Enter a valid number', { kind: 'error', duration: 2500 });
      return true;
    }
    v = n;
    if (path === 'mowing.cadenceDays') v = Math.min(21, Math.max(3, Math.round(n)));
    if (path === 'location.lat' && Math.abs(n) > 90) { toast('Latitude must be between −90 and 90', { kind: 'error', duration: 2500 }); return true; }
    if (path === 'location.lon' && Math.abs(n) > 180) { toast('Longitude must be between −180 and 180', { kind: 'error', duration: 2500 }); return true; }
  }
  await setSetting(path, v);
  return path.startsWith('location.lat') || path.startsWith('location.lon') ? 'location' : true;
}

export async function onTierChange(input) {
  const i = Number(input.dataset.tier);
  const field = input.dataset.field;
  const n = num(input.value, NaN);
  const tiers = E.sortedTiers(S.settings.water.tiers).map((t) => ({ ...t }));
  if (!Number.isFinite(n) || n < 0) {
    toast('Enter a valid number', { kind: 'error', duration: 2500 });
    return;
  }
  tiers[i][field] = field === 'upTo' ? Math.round(n) : n;
  S.settings.water.tiers = E.sortedTiers(tiers);
  await saveSettings();
}

export async function addTier() {
  const tiers = E.sortedTiers(S.settings.water.tiers).map((t) => ({ ...t }));
  const bounded = tiers.filter((t) => t.upTo != null);
  const lastCap = bounded.length ? bounded[bounded.length - 1].upTo : 0;
  const lastRate = tiers.length ? tiers[tiers.length - 1].rate : 5;
  tiers.splice(bounded.length, 0, { upTo: lastCap + 10000, rate: lastRate });
  if (!tiers.some((t) => t.upTo == null)) tiers.push({ upTo: null, rate: lastRate });
  S.settings.water.tiers = tiers;
  await saveSettings();
}

export async function removeTier(i) {
  const tiers = E.sortedTiers(S.settings.water.tiers).map((t) => ({ ...t }));
  if (tiers.length <= 1) return;
  tiers.splice(i, 1);
  if (!tiers.some((t) => t.upTo == null)) tiers[tiers.length - 1].upTo = null;
  S.settings.water.tiers = tiers;
  if (S.settings.water.rateMode !== 'auto' && Number(S.settings.water.rateMode) >= tiers.length) S.settings.water.rateMode = 'auto';
  await saveSettings();
}

export async function onSegment(name, value) {
  if (name === 'appearance.theme' || name === 'clippings' || name === 'water.billing' || name === 'water.rateMode') {
    await setSetting(name, value);
    return true;
  }
  return false;
}

export async function onSwitch(name, checked) {
  if (name === 'ui.includePhotos') { ui.includePhotos = checked; return false; }
  await setSetting(name, checked);
  return true;
}

export async function toggleProv(key) {
  const [scope, path] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
  if (scope !== 'settings') return false;
  await setProvenance(path, (S.settings.src[path] || 'est') === 'est' ? 'meas' : 'est');
  return true;
}

export async function toggleDay(d) {
  const days = S.settings.mowing.preferredDays;
  S.settings.mowing.preferredDays = days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort();
  await saveSettings();
}

export async function markSharpened(today) {
  const ok = await confirmDialog({ title: 'Mark blade sharpened?', message: 'Resets hours since sharpening to zero.', confirmText: 'Mark sharpened' });
  if (!ok) return;
  const log = await saveLog({ id: uid('l'), type: 'other', kind: 'sharpen', title: 'Blade sharpened', date: today, at: Date.now(), zones: [], notes: '' });
  toast('Blade marked sharpened', { undo: async () => { await deleteLog(log.id); } });
}

/* ---------- backup ---------- */

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

export async function doReset() {
  const ok = await confirmDialog({
    title: 'Reset all data?',
    message: 'Deletes every log, product, zone, and setting on this device and restores the starting values. Export a backup first if you might want it back.',
    confirmText: 'Reset',
    destructive: true,
  });
  if (!ok) return false;
  await resetAll();
  toast('All data reset', { duration: 2500 });
  return true;
}

/* ---------- zone editor ---------- */

const zPill = (draft, field) => provPill(`zone:${field}`, draft.src?.[field] || 'est');

function zoneField(draft, label, field, unit, sub = '') {
  return `<div class="row field-row-y">
    <div class="row-main"><label class="row-title" for="zf-${field}">${label}</label>${zPill(draft, field)}${sub ? `<span class="row-sub">${sub}</span>` : ''}</div>
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
  if (cs) s += ` Sloped: cycle and soak — no more than ~${f0(cs.maxMin)} min per cycle, 30–60 min soak between.`;
  return s;
}

export function openZoneSheet(id, onDone) {
  const existing = S.zones.find((z) => z.id === id);
  const draft = existing ? clone(existing) : { ...newZone(), id: '' };
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
      <div class="group">
        <div class="row field-row-y is-text"><label class="row-title" for="zf-name">Name</label>
          <div class="input-wrap"><input id="zf-name" class="row-input" type="text" data-zfield="name" value="${esc(draft.name)}" placeholder="e.g., Front Beds" autocomplete="off"></div></div>
        <div class="row"><span class="row-main"><span class="row-title">Counts as lawn</span><span class="row-sub">${nonLawn ? 'Non-lawn: water cost only (beds, drip).' : 'Used for mowing, fertilizer and nitrogen math.'}</span></span>
          ${switchHtml('lawn', !nonLawn, 'Counts as lawn')}</div>
        ${zoneField(draft, 'Area', 'sqft', 'sq ft')}
      </div>
      <div class="group">
        <div class="row field-row-y col"><div class="row-main"><span class="row-title">Slope</span>${zPill(draft, 'slope')}</div>${segmented('slope', Object.entries(SLOPE_LABELS), draft.slope)}</div>
        ${nonLawn ? '' : `<div class="row field-row-y col"><div class="row-main"><span class="row-title">Sun</span>${zPill(draft, 'sun')}</div>${segmented('sun', Object.entries(SUN_LABELS), draft.sun)}</div>`}
        <div class="row field-row-y col"><div class="row-main"><span class="row-title">Head type</span>${zPill(draft, 'head')}<span class="row-sub">Picking a head fills its typical precipitation rate.</span></div>${segmented('head', heads, draft.head)}</div>
        ${zoneField(draft, 'Flow rate', 'gpm', 'GPM')}
        ${draft.head === 'drip' ? '' : zoneField(draft, 'Precipitation rate', 'precip', 'in/hr')}
        ${nonLawn ? zoneField(draft, 'Weekly runtime', 'weeklyMinutes', 'min') : ''}
      </div>
      <p class="footer-note" data-out="zone-calc">${esc(zoneCalc(draft))}</p>
      ${existing ? `<button type="button" class="btn btn-delete" data-act="delete">${icon('trash')} Delete zone</button>` : ''}`;
  };
  render();

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

  sheet.el.addEventListener('click', async (e) => {
    const p = e.target.closest('[data-prov]');
    if (p) {
      const field = p.dataset.prov.split(':')[1];
      draft.src[field] = (draft.src[field] || 'est') === 'est' ? 'meas' : 'est';
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
  // An estimated flow rate follows area and head type; a measured one is left alone.
  function syncGpm() {
    if (draft.src.gpm === 'meas' || draft.head === 'drip' || !(num(draft.precip) > 0)) return false;
    draft.gpm = gpmFor(num(draft.precip), num(draft.sqft));
    return true;
  }
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

function productField(draft, label, field, unit, { text = false, sub = '' } = {}) {
  return `<div class="row field-row-y">
    <div class="row-main"><label class="row-title" for="pf-${field}">${label}</label>${pPill(draft, field)}${sub ? `<span class="row-sub">${sub}</span>` : ''}</div>
    <div class="input-wrap"><input id="pf-${field}" class="row-input" type="text" ${text ? 'autocomplete="off"' : 'inputmode="decimal"'} data-pfield="${field}" value="${esc(draft[field] ?? '')}">${unit ? `<span class="unit">${unit}</span>` : ''}</div>
  </div>`;
}

function productCalc(draft) {
  const p = { ...draft };
  ['n', 'p', 'k', 'size', 'coverage', 'price', 'onHand'].forEach((k) => { p[k] = num(draft[k]); });
  const area = E.lawnArea(S.zones);
  const rate = E.ratePer1000(p);
  const lines = [];
  if (rate > 0) lines.push(`Rate: ${fmtNum(rate, 2)} ${p.unit}/1,000 sq ft${p.unit === 'lb' && p.n ? ` → ${fmtNum(E.nPer1000(p), 2)} lb N/1,000` : ''}.`);
  const cpn = E.costPerLbN(p);
  if (cpn) lines.push(`Cost per pound of nitrogen: ${fmtMoney(cpn)}.`);
  if (rate > 0) lines.push(`All lawn zones (${f0(area)} sq ft): ${fmtNum(E.amountFor(p, area), 1)} ${p.unit}${p.size > 0 ? ` ≈ ${fmtNum(E.amountFor(p, area) / p.size, 2)} bags` : ''}.`);
  return lines.join(' ');
}

export function openProductSheet(id, { type, onDone } = {}) {
  const existing = S.products.find((p) => p.id === id);
  const draft = existing ? clone(existing) : newProduct();
  if (!existing && type) draft.type = type;
  if (!existing && type && type !== 'fertilizer') draft.noMowDays = 2;
  const sheet = openSheet({
    title: existing ? 'Edit product' : 'New product',
    className: 'product-sheet',
    right: '<button type="button" class="link-btn strong" data-act="save">Save</button>',
  });
  const render = () => {
    const pWarn = num(draft.p) > 0;
    sheet.body.innerHTML = `
      <div class="group">
        <div class="row field-row-y is-text"><label class="row-title" for="pf-name">Name</label>
          <div class="input-wrap"><input id="pf-name" class="row-input" type="text" data-pfield="name" value="${esc(draft.name)}" placeholder="e.g., Lesco 24-0-11" autocomplete="off"></div></div>
        <div class="row field-row-y col"><span class="row-title">Type</span>${segmented('type', Object.entries(PRODUCT_TYPES).map(([k, v]) => [k, v.replace('Weed control', 'Weed')]), draft.type)}</div>
      </div>
      <h3 class="section-h">Analysis (N-P-K %)</h3>
      <div class="group">
        ${productField(draft, 'Nitrogen (N)', 'n', '%')}
        ${productField(draft, 'Phosphorus (P)', 'p', '%')}
        ${productField(draft, 'Potassium (K)', 'k', '%')}
      </div>
      ${pWarn ? `<div class="banner banner-warn">${icon('alert')}<div>Minnesota law limits phosphorus on established lawns unless a soil test shows a need or you’re establishing new turf.</div></div>` : ''}
      <h3 class="section-h">Bag &amp; spreader</h3>
      <div class="group">
        <div class="row field-row-y col"><span class="row-title">Unit</span>${segmented('unit', [['lb', 'lb'], ['oz', 'oz'], ['gal', 'gal']], draft.unit)}</div>
        ${productField(draft, 'Bag size', 'size', draft.unit)}
        ${productField(draft, 'Coverage per bag', 'coverage', 'sq ft')}
        ${productField(draft, 'Price per bag', 'price', '$')}
        ${productField(draft, `${esc(S.settings.spreader.model)} setting`, 'elite', '', { text: true })}
      </div>
      <h3 class="section-h">Safety intervals</h3>
      <div class="group">
        ${productField(draft, 'Keep kids &amp; pets off', 'keepOffHours', 'hours')}
        ${productField(draft, 'No rain after', 'noRainHours', 'hours', { sub: 'Sloped zones double this for granular products (min 48 h).' })}
        ${productField(draft, 'No mowing after', 'noMowDays', 'days')}
      </div>
      <h3 class="section-h">Inventory</h3>
      <div class="group">
        ${productField(draft, 'On hand', 'onHand', draft.unit)}
        <div class="row bag-steps">
          <button type="button" class="btn btn-plain" data-act="bag" data-n="-1">− 1 bag</button>
          <button type="button" class="btn btn-plain" data-act="bag" data-n="1">+ 1 bag</button>
        </div>
      </div>
      <p class="footer-note" data-out="product-calc">${esc(productCalc(draft))}</p>
      ${existing ? `<button type="button" class="btn btn-delete" data-act="delete">${icon('trash')} Delete product</button>` : ''}`;
  };
  render();

  const save = async () => {
    const name = String(draft.name || '').trim();
    if (!name) { toast('Give the product a name', { kind: 'error', duration: 2500 }); return; }
    const p = { ...draft, name, elite: String(draft.elite ?? '').trim() };
    ['n', 'p', 'k', 'size', 'coverage', 'price', 'keepOffHours', 'noRainHours', 'noMowDays', 'onHand'].forEach((k) => { p[k] = Math.max(0, num(draft[k])); });
    p.onHand = round(p.onHand, 3);
    await saveProduct(p);
    sheet.close();
    onDone?.();
    toast(existing ? 'Product saved' : 'Product added', { duration: 2000 });
  };

  sheet.el.addEventListener('click', async (e) => {
    const pv = e.target.closest('[data-prov]');
    if (pv) {
      const field = pv.dataset.prov.split(':')[1];
      draft.src[field] = (draft.src[field] || 'est') === 'est' ? 'meas' : 'est';
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
    if (!f) return;
    draft[f] = e.target.value;
    const out = sheet.body.querySelector('[data-out="product-calc"]');
    if (out) out.textContent = productCalc(draft);
  });
  sheet.body.addEventListener('change', (e) => {
    if (e.target.dataset.pfield === 'p') render();
  });
}

