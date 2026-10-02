// Quick Log: the "+" menu and the Mow / Fertilize / Spot spray / Pulled weeds / Watering / Other sheets
// (also used to edit). Saving needs a 1-second press-and-hold; Undo stays available for 5 seconds.

import { S, saveLog, deleteLog, restoreLog, savePhoto, deletePhoto, getPhoto } from './store.js';
import { openSheet, bindHold, holdButtonHtml, toast, confirmDialog, segmented } from './ui.js';
import { icon, TYPE_ICON, patternIcon } from './icons.js';
import * as E from './engine.js';
import * as Season from './season.js';
import { OTHER_KINDS, PRODUCT_TYPES, SPREADER_TYPES, MOW_PATTERNS } from './defaults.js';
import { rachioState } from './views/rachio.js';
import { esc, uid, clone, round, num, addDays, relDay, fmtDay, fmtNum, fmtMoney, noonOf, nobreak } from './util.js';

export const TYPES = {
  mow: { title: 'Mow', sub: 'Height, time, stripe direction', verb: 'Mow logged' },
  fert: { title: 'Fertilize', sub: 'Spreader products', verb: 'Feeding logged' },
  weed: { title: 'Spot spray', sub: 'Hand pump sprayer', verb: 'Spot spray logged' },
  pull: { title: 'Pulled weeds', sub: 'By hand', verb: 'Weeding logged' },
  water: { title: 'Watering', sub: 'Sprinkler runs and hand watering', verb: 'Watering logged' },
  other: { title: 'Other', sub: 'Blowout, battery, aeration…', verb: 'Activity logged' },
};
const PULL_AMOUNTS = [['few', 'A few'], ['some', 'A bunch'], ['lots', 'Lots']];

let hooks = { ctx: () => ({}), openProduct: () => {} };
export function setLogHooks(h) { hooks = { ...hooks, ...h }; }

export function openLogMenu() {
  const sheet = openSheet({
    title: 'Log activity',
    className: 'sheet-menu',
    content: `<div class="log-menu">${Object.entries(TYPES).map(([k, t]) => `
      <button type="button" class="log-choice" data-act="choose" data-type="${k}">
        <span class="log-choice-ic t-${k}">${icon(TYPE_ICON[k])}</span>
        <span class="log-choice-text"><span class="log-choice-label">${t.title}</span><span class="log-choice-sub">${t.sub}</span></span>
        ${icon('chev', 'chev')}
      </button>`).join('')}</div>`,
  });
  sheet.body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act="choose"]');
    if (!b) return;
    sheet.close();
    openLogSheet(b.dataset.type);
  });
}

function productsFor(type) {
  if (type === 'fert') return S.products.filter((p) => SPREADER_TYPES.includes(p.type));
  if (type === 'weed') return S.products.filter((p) => p.type === 'weed');
  return [];
}

/**
 * Open a log sheet. `existing` edits a saved log; `preset` pre-fills a new one
 * (productId, kind, final).
 */
export function openLogSheet(type, { existing = null, preset = {} } = {}) {
  if (!TYPES[type]) type = 'other';
  const c = hooks.ctx();
  const { today } = c;
  const heights = S.settings.mower.heights.map(Number);
  const rec = type === 'mow' ? E.mowRecommendation(c) : null;
  const zoneList = type === 'mow' || type === 'fert' ? E.lawnZones(S.zones) : S.zones;
  const lawnIds = E.lawnZones(S.zones).map((z) => z.id);
  const prev = existing ? clone(existing) : null;
  const defaultZones = ['mow', 'fert', 'water'].includes(type) ? [...lawnIds] : [];

  const d = existing ? clone(existing) : { id: uid('l'), type, date: today, zones: defaultZones, notes: '', photoId: null };
  if (!existing) {
    if (type === 'mow') {
      d.position = rec && rec.status !== 'off' && rec.position ? rec.position : E.nearestPosition(heights, 3);
      d.clippings = S.settings.clippings;
      d.final = !!(preset.final || rec?.final);
      d.pattern = E.nextPattern(S.logs, today);
    } else if (type === 'fert') {
      const next = Season.nextFeeding(c.feedings || Season.feedingSchedule(c));
      const p = S.products.find((x) => x.id === preset.productId) || next?.product || productsFor('fert')[0];
      d.productId = p?.id || null;
    } else if (type === 'weed') {
      const list = productsFor('weed');
      const p = list.find((x) => x.id === preset.productId) || list[0];
      d.productId = p?.id || null;
      d.gallons = 1;
    } else if (type === 'water') {
      d.minutes = 20;
    } else if (type === 'pull') {
      d.howMuch = '';
    } else {
      d.kind = preset.kind || 'other';
      d.title = '';
    }
  }

  const st = {
    amountManual: false,
    hoursManual: false,
    details: !!(existing?.notes || existing?.photoId),
    photo: undefined, // undefined = unchanged, null = removed, string = new data URL
    existingPhoto: null,
    saving: false,
  };

  const product = () => S.products.find((p) => p.id === d.productId) || null;
  const area = () => (type === 'fert' ? E.lawnArea(S.zones, d.zones) : E.zoneArea(S.zones, d.zones));
  const totalLawn = E.lawnArea(S.zones) || 1;
  const calcHours = () => round((S.settings.mower.mowHours || 1) * (E.lawnArea(S.zones, d.zones) / totalLawn), 2);
  const calcAmount = () => {
    const p = product();
    if (!p) return 0;
    if (type === 'weed') return round(num(d.gallons) * (p.mixRate || 0), 2);
    return round(E.amountFor(p, area()), 2);
  };
  // When editing, keep a typed-in amount/time fixed; otherwise it follows the selected zones.
  if (existing) {
    st.amountManual = type === 'fert' && Math.abs(num(existing.amount) - calcAmount()) > 0.01;
    st.hoursManual = type === 'mow' && Math.abs(num(existing.hours) - calcHours()) > 0.01;
  }

  function recompute() {
    if (type === 'mow' && !st.hoursManual) d.hours = calcHours();
    if (type === 'weed' || (type === 'fert' && !st.amountManual)) d.amount = calcAmount();
  }
  recompute();

  const duplicate = () => S.logs.find((l) => l.id !== d.id && l.type === type && l.date === d.date && (type !== 'other' || l.kind === d.kind));

  function validate() {
    if (!d.date || d.date > today) return 'Pick a date that isn’t in the future.';
    if ((type === 'mow' || type === 'fert' || type === 'water') && !d.zones.length) return 'Select at least one zone.';
    if (type === 'fert' && !product()) return 'Choose a product.';
    if (type === 'fert' && !(num(d.amount) > 0)) return 'Enter the amount used.';
    if (type === 'mow' && !(d.position >= 1)) return 'Choose a mower position.';
    if (type === 'water' && !(num(d.minutes) > 0)) return 'Enter how long each zone ran.';
    if (type === 'weed' && d.productId && !(num(d.gallons) > 0)) return 'Enter how much mix you sprayed.';
    return null;
  }

  /* ---------- markup ---------- */

  const dateHtml = () => {
    const y = addDays(today, -1);
    const other = d.date !== today && d.date !== y;
    return `
      <div class="field">
        <div class="field-label">Date</div>
        <div class="chips">
          <button type="button" class="chip ${d.date === today ? 'on' : ''}" data-act="date" data-date="${today}">Today</button>
          <button type="button" class="chip ${d.date === y ? 'on' : ''}" data-act="date" data-date="${y}">Yesterday</button>
          <label class="chip chip-date ${other ? 'on' : ''}">${other ? esc(fmtDay(d.date, { year: d.date.slice(0, 4) !== today.slice(0, 4) })) : 'Earlier date…'}
            <input type="date" data-field="date" max="${today}" value="${d.date}" aria-label="Pick any past date">
          </label>
        </div>
      </div>`;
  };

  const dupHtml = () => {
    const dup = duplicate();
    if (!dup) return '';
    const what = type === 'other' ? E.otherLabel(d.kind).toLowerCase() : TYPES[type].title.toLowerCase();
    return `<div class="banner banner-warn" role="alert">${icon('alert')}<div><strong>Already logged ${d.date === today ? 'today' : `on ${esc(fmtDay(d.date))}`}.</strong> You have a ${esc(what)} entry for this date. Saving adds a second one.</div></div>`;
  };

  const zonesHtml = (optional = false, label = 'Zones') => {
    const all = zoneList.length && zoneList.every((z) => d.zones.includes(z.id));
    const sel = zoneList.filter((z) => d.zones.includes(z.id));
    const sqft = E.zoneArea(sel);
    return `
      <div class="field">
        <div class="field-head"><span class="field-label">${label}${optional ? ' <span class="muted">(optional)</span>' : ''}</span>
          <button type="button" class="link-btn" data-act="all-zones">${all ? 'Clear' : 'Select all'}</button></div>
        <div class="chips">${zoneList.map((z) => `
          <button type="button" class="chip ${d.zones.includes(z.id) ? 'on' : ''}" data-act="zone" data-id="${z.id}" aria-pressed="${d.zones.includes(z.id)}">
            ${esc(z.name)}${E.isSloped(z) ? icon('slope', 'chip-ic') : ''}</button>`).join('')}</div>
        <div class="hint">${sel.length ? `${sel.length} ${sel.length === 1 ? 'zone' : 'zones'} · ${fmtNum(sqft, 0)} sq ft` : optional ? 'None selected' : 'No zones selected'}</div>
      </div>`;
  };

  const stepper = (field, value, unit, step, label) => `
    <div class="stepper">
      <button type="button" class="step" data-act="step" data-field="${field}" data-step="${-step}" aria-label="Less">−</button>
      <input class="step-input" data-field="${field}" type="text" inputmode="decimal" value="${fmtNum(value, 2)}" aria-label="${esc(label)}"><span class="unit">${unit}</span>
      <button type="button" class="step" data-act="step" data-field="${field}" data-step="${step}" aria-label="More">+</button>
    </div>`;

  const mowHtml = () => {
    const showFinal = Number(today.slice(5, 7)) >= 10 || d.final;
    return `
      <div class="field">
        <div class="field-label">Mower position${rec && rec.status !== 'off' ? ` <span class="muted">· recommended ${rec.position} (${rec.height}″)</span>` : ''}</div>
        <div class="pos-grid" role="radiogroup" aria-label="Mower position">${heights.map((h, i) => `
          <button type="button" role="radio" aria-checked="${d.position === i + 1}" class="pos ${d.position === i + 1 ? 'on' : ''}" data-act="pos" data-pos="${i + 1}">
            <span class="pos-n">${i + 1}</span><span class="pos-h">${h}″</span>${rec && rec.status !== 'off' && rec.position === i + 1 ? '<span class="pos-rec">Rec</span>' : ''}
          </button>`).join('')}</div>
      </div>
      <div class="field">
        <div class="field-label">Front-yard stripes <span class="muted">· ${esc(MOW_PATTERNS[d.pattern ?? 0]?.label || '')}</span></div>
        <div class="pattern-pick" role="radiogroup" aria-label="Stripe direction">${MOW_PATTERNS.map((p) => `
          <button type="button" role="radio" aria-checked="${d.pattern === p.id}" class="pattern-opt ${d.pattern === p.id ? 'on' : ''}" data-act="pattern" data-pattern="${p.id}" aria-label="${esc(p.label)}">${patternIcon(p.angle, 40)}</button>`).join('')}</div>
        <div class="hint">Side Left and Side Right: always mow across the slope.</div>
      </div>
      <div class="field field-row">
        <span class="field-label">Time</span>
        ${stepper('hours', d.hours, 'h', 0.25, 'Hours')}
      </div>
      <div class="field field-row">
        <span class="field-label">Clippings</span>
        ${segmented('clippings', [['mulch', 'Mulch'], ['bag', 'Bag']], d.clippings)}
      </div>
      ${showFinal ? `<div class="field field-row"><span class="field-label">Final mow of the season</span>
        <label class="switch"><input type="checkbox" data-field="final" ${d.final ? 'checked' : ''} aria-label="Final mow of the season"><span class="switch-track"><span class="switch-thumb"></span></span></label></div>` : ''}`;
  };

  const productListHtml = (allowNone) => {
    const list = productsFor(type);
    if (!list.length && !allowNone) {
      return `<div class="banner banner-info">${icon('box')}<div>No spreader products yet. <button type="button" class="link-btn" data-act="add-product">Add one in Yard</button></div></div>`;
    }
    return `
      <div class="field">
        <div class="field-label">Product</div>
        <div class="choice-list">
          ${list.map((p) => `
            <button type="button" class="choice ${d.productId === p.id ? 'on' : ''}" data-act="product" data-id="${p.id}" aria-pressed="${d.productId === p.id}">
              <span class="choice-main">
                <span class="choice-title">${esc(nobreak(p.name))}</span>
                <span class="choice-sub">${type === 'weed' ? `${fmtNum(p.mixRate || 0, 2)} fl oz per gallon` : `${p.n}-${p.p}-${p.k} · ${PRODUCT_TYPES[p.type]} · Elite ${esc(p.elite || '–')}`} · ${fmtNum(p.onHand || 0, 1)} ${esc(p.unit)} on hand</span>
              </span>
              <span class="choice-check">${icon('check')}</span>
            </button>`).join('')}
          ${allowNone ? `<button type="button" class="choice ${!d.productId ? 'on' : ''}" data-act="product" data-id="">
              <span class="choice-main"><span class="choice-title">No product</span><span class="choice-sub">Something not in your library</span></span>
              <span class="choice-check">${icon('check')}</span></button>` : ''}
        </div>
        ${allowNone && !list.length ? '<div class="hint">Add Weed B Gon (or your spray) in Yard → Products to track the mix and inventory.</div>' : ''}
      </div>`;
  };

  const rainCheckHtml = (p) => {
    if (d.date !== today) return '';
    const w = E.applicationWindow({ weather: S.weather, product: p, zoneIds: d.zones.length ? d.zones : lawnIds, zones: S.zones, today, now: Date.now(), kind: type === 'weed' ? 'weed' : p.type });
    const t0 = w.days.find((x) => x.date === today);
    const label = type === 'weed' ? 'Spray check' : 'Rain check';
    if (t0) return `<div class="banner banner-${t0.rating === 'avoid' ? 'warn' : t0.rating === 'ok' ? 'info' : 'ok'}">${icon(type === 'weed' ? 'wind' : 'drop')}<div><strong>${label}:</strong> ${esc(t0.note)}.${t0.rating !== 'good' && w.best && w.best.date !== today ? ` Better: ${esc(relDay(w.best.date, today))}.` : ''}</div></div>`;
    if (!w.available) return `<div class="banner banner-info">${icon('drop')}<div>${esc(w.summary)}</div></div>`;
    return '';
  };

  const timersHint = (p) => {
    const timers = E.computeTimers({ ...d, at: Date.now() }, p, S.zones);
    const parts = timers.map((t) => {
      const h = Math.round((t.until - Date.now()) / 3600e3);
      if (t.kind === 'keepOff') return `keep off ${h} h`;
      if (t.kind === 'noRain') return `no heavy rain/watering ${h} h${t.sloped ? ' (sloped)' : ''}`;
      return `no mowing ${Math.round(h / 24)} ${Math.round(h / 24) === 1 ? 'day' : 'days'}`;
    });
    return parts.length ? `<p class="hint">${icon('clock', 'hint-ic')} Starts timers: ${esc(parts.join(' · '))}.</p>` : '';
  };

  const invLine = (p, amt) => {
    const onHand = p.onHand || 0;
    const back = prev && prev.productId === p.id ? prev.effects?.deducted || 0 : 0;
    const avail = onHand + back;
    return `${fmtNum(avail, 1)} → ${fmtNum(Math.max(0, avail - amt), 1)} ${esc(p.unit)}${avail < amt - 0.01 ? ' <em class="warn-text">(more than on hand)</em>' : ''}`;
  };

  const fertCalcHtml = () => {
    const p = product();
    if (!p) return '';
    const sqft = area();
    const amt = num(d.amount);
    const nPer = p.unit === 'lb' && sqft > 0 ? ((amt * (p.n || 0)) / 100 / sqft) * 1000 : 0;
    return `
      <div class="calc">
        <div class="calc-row"><span>${esc(S.settings.spreader.model || 'Spreader')} setting</span><strong class="calc-big">${esc(p.elite || '–')}</strong></div>
        <div class="calc-row"><span>Amount for ${fmtNum(sqft, 0)} sq ft</span>
          <span class="calc-input"><input data-field="amount" type="text" inputmode="decimal" value="${fmtNum(amt, 2)}" aria-label="Amount used"> ${esc(p.unit)}</span></div>
        ${p.unit === 'lb' && p.n ? `<div class="calc-row"><span>Nitrogen</span><strong data-out="nper">${fmtNum(nPer, 2)} lb N / 1,000 sq ft</strong></div>` : ''}
        <div class="calc-row"><span>Inventory</span><span data-out="inv">${invLine(p, amt)}</span></div>
      </div>
      ${rainCheckHtml(p)}
      ${timersHint(p)}`;
  };

  const sprayHtml = () => {
    const p = product();
    return `
      ${productListHtml(true)}
      <div class="field field-row">
        <span class="field-label">Mix sprayed</span>
        ${stepper('gallons', d.gallons ?? 1, 'gal', 0.25, 'Gallons sprayed')}
      </div>
      ${p ? `<div class="calc">
        <div class="calc-row"><span>Label mix rate</span><strong>${fmtNum(p.mixRate || 0, 2)} fl oz / gal</strong></div>
        <div class="calc-row"><span>Concentrate used</span><strong data-out="amt">${fmtNum(num(d.amount), 2)} ${esc(p.unit)}</strong></div>
        <div class="calc-row"><span>Inventory</span><span data-out="inv">${invLine(p, num(d.amount))}</span></div>
      </div>
      ${rainCheckHtml(p)}
      ${timersHint(p)}` : ''}
      ${zonesHtml(true, 'Where')}
      <p class="hint">Spot spray only: highs 50–85°F, wind under 10 mph, no rain for 24 hours.</p>`;
  };

  const waterHtml = () => {
    const calc = E.wateringCalc(S.zones, d.zones, num(d.minutes), S.settings);
    const sloped = S.zones.filter((z) => d.zones.includes(z.id) && E.isSloped(z));
    return `
      ${zonesHtml(false)}
      <div class="field field-row">
        <span class="field-label">Run time per zone</span>
        ${stepper('minutes', d.minutes ?? 20, 'min', 5, 'Minutes per zone')}
      </div>
      <div class="calc" data-out="water">
        <div class="calc-row"><span>Water on the lawn</span><strong>${fmtNum(calc.inches, 2)}″</strong></div>
        <div class="calc-row"><span>Gallons</span><strong>${fmtNum(calc.gallons, 0)} gal</strong></div>
        <div class="calc-row"><span>Cost at ${fmtMoney(calc.rate.per1000)}/1,000</span><strong>${fmtMoney(calc.cost)}</strong></div>
      </div>
      ${sloped.length ? `<p class="hint">${icon('slope', 'hint-ic')} Sloped ${esc(sloped.map((z) => z.name).join(' & '))}: run in short cycles with a soak between.</p>` : ''}
      <p class="hint">${rachioState() === 'off'
        ? 'Rachio isn’t connected on this device, so log runs here.'
        : 'Rachio runs show in Yard → My Zones but aren’t added to these totals, so log runs here to count them.'} Gallons use each zone’s flow rate.</p>`;
  };

  const pullHtml = () => `
    <div class="field">
      <div class="field-label">How many? <span class="muted">(optional)</span></div>
      ${segmented('howMuch', PULL_AMOUNTS, d.howMuch || '')}
    </div>
    ${zonesHtml(true, 'Where')}`;

  const otherHtml = () => `
    <div class="field">
      <div class="field-label">What did you do?</div>
      <div class="chips">${OTHER_KINDS.map((k) => `<button type="button" class="chip ${d.kind === k.id ? 'on' : ''}" data-act="kind" data-kind="${k.id}">${esc(k.label)}</button>`).join('')}</div>
    </div>
    <div class="field">
      <label class="field-label" for="other-title">Title</label>
      <input id="other-title" class="text-input" type="text" data-field="title" value="${esc(d.title || '')}" placeholder="${esc(E.otherLabel(d.kind))}" autocomplete="off">
    </div>`;

  const detailsHtml = () => {
    const photoSrc = st.photo !== undefined ? st.photo : st.existingPhoto;
    return `
      <button type="button" class="disclosure" data-act="details" aria-expanded="${st.details}">
        ${icon('chevDown', 'disc-ic')}<span>${st.details ? 'Details' : 'Add details'}</span><span class="muted">Notes, photo</span>
      </button>
      <div class="details" ${st.details ? '' : 'hidden'}>
        <label class="field-label" for="log-notes">Notes</label>
        <textarea id="log-notes" class="text-input" data-field="notes" rows="3" placeholder="${type === 'mow' ? 'e.g., grass was long, barely grew, clumping…' : 'Anything worth remembering'}">${esc(d.notes || '')}</textarea>
        ${type === 'mow' ? '<p class="hint">Notes like “grass was long” or “barely grew” tune future mowing recommendations.</p>' : ''}
        <div class="photo-row">
          ${photoSrc ? `<img class="photo-thumb" src="${photoSrc}" alt="Attached photo"><button type="button" class="btn btn-plain btn-danger-text" data-act="photo-remove">${icon('trash')} Remove photo</button>`
    : `<label class="btn btn-plain photo-pick">${icon('camera')} Add photo<input type="file" accept="image/*" data-field="photo" hidden></label>`}
        </div>
      </div>`;
  };

  const bodyHtml = () => `
    ${dateHtml()}
    ${dupHtml()}
    ${type === 'mow' ? zonesHtml() + mowHtml() : ''}
    ${type === 'fert' ? zonesHtml() + productListHtml(false) + fertCalcHtml() : ''}
    ${type === 'weed' ? sprayHtml() : ''}
    ${type === 'pull' ? pullHtml() : ''}
    ${type === 'water' ? waterHtml() : ''}
    ${type === 'other' ? otherHtml() + zonesHtml(true) : ''}
    ${detailsHtml()}
    ${existing ? `<button type="button" class="btn btn-delete" data-act="delete">${icon('trash')} Delete entry</button>` : ''}`;

  const sheet = openSheet({
    title: existing ? `Edit ${TYPES[type].title.toLowerCase()}` : TYPES[type].title,
    className: `log-sheet log-${type}`,
    content: bodyHtml(),
    footer: holdButtonHtml(existing ? 'Hold to save changes' : 'Hold to save'),
  });
  sheet.sheet.dataset.logType = type;
  const holdBtn = sheet.foot.querySelector('[data-hold]');
  const hint = sheet.foot.querySelector('.hold-hint');

  function render() {
    const top = sheet.body.scrollTop;
    sheet.body.innerHTML = bodyHtml();
    sheet.body.scrollTop = top;
    refreshHold();
  }
  function refreshHold() {
    const msg = validate();
    holdBtn.disabled = !!msg;
    if (!holdBtn.classList.contains('done')) {
      hint.textContent = msg || (duplicate() ? 'Press and hold for 1 second to save anyway' : 'Press and hold for 1 second');
      hint.classList.toggle('warn', !!msg);
    }
  }
  function refreshCalc() {
    const p = product();
    const box = sheet.body.querySelector('.calc');
    if (!box) return;
    const amt = num(d.amount);
    if (type === 'fert' && p) {
      const sqft = area();
      const nEl = box.querySelector('[data-out="nper"]');
      if (nEl) nEl.textContent = `${fmtNum(sqft > 0 ? ((amt * (p.n || 0)) / 100 / sqft) * 1000 : 0, 2)} lb N / 1,000 sq ft`;
    }
    if (type === 'weed' && p) {
      const a = box.querySelector('[data-out="amt"]');
      if (a) a.textContent = `${fmtNum(amt, 2)} ${p.unit}`;
    }
    const inv = box.querySelector('[data-out="inv"]');
    if (inv && p) inv.innerHTML = invLine(p, amt);
    if (type === 'water') {
      const calc = E.wateringCalc(S.zones, d.zones, num(d.minutes), S.settings);
      const vals = box.querySelectorAll('strong');
      if (vals.length === 3) {
        vals[0].textContent = `${fmtNum(calc.inches, 2)}″`;
        vals[1].textContent = `${fmtNum(calc.gallons, 0)} gal`;
        vals[2].textContent = fmtMoney(calc.cost);
      }
    }
  }

  if (existing?.photoId) {
    getPhoto(existing.photoId).then((ph) => {
      if (ph) { st.existingPhoto = ph.dataUrl; if (st.photo === undefined) render(); }
    });
  }

  sheet.body.addEventListener('click', async (e) => {
    const seg = e.target.closest('[data-seg] .seg-opt');
    if (seg) {
      const name = seg.closest('[data-seg]').dataset.seg;
      d[name] = name === 'howMuch' && d[name] === seg.dataset.value ? '' : seg.dataset.value;
      render();
      return;
    }
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'date') d.date = a.dataset.date;
    else if (act === 'zone') {
      const id = a.dataset.id;
      d.zones = d.zones.includes(id) ? d.zones.filter((x) => x !== id) : [...d.zones, id];
      recompute();
    } else if (act === 'all-zones') {
      const all = zoneList.every((z) => d.zones.includes(z.id));
      d.zones = all ? [] : zoneList.map((z) => z.id);
      recompute();
    } else if (act === 'pos') d.position = Number(a.dataset.pos);
    else if (act === 'pattern') d.pattern = Number(a.dataset.pattern);
    else if (act === 'step') {
      const f = a.dataset.field;
      d[f] = Math.max(0, round(num(d[f]) + Number(a.dataset.step), 2));
      if (f === 'hours') st.hoursManual = true;
      recompute();
    } else if (act === 'product') {
      d.productId = a.dataset.id || null;
      st.amountManual = false;
      recompute();
    } else if (act === 'kind') d.kind = a.dataset.kind;
    else if (act === 'details') st.details = !st.details;
    else if (act === 'photo-remove') st.photo = null;
    else if (act === 'add-product') {
      sheet.close();
      hooks.openProduct(null, type === 'fert' ? 'fertilizer' : 'weed');
      return;
    } else if (act === 'delete') {
      const ok = await confirmDialog({ title: 'Delete this entry?', message: 'Any product it used goes back into inventory.', confirmText: 'Delete', destructive: true });
      if (!ok) return;
      const removed = await deleteLog(existing.id);
      sheet.close('deleted');
      toast('Entry deleted', { undo: async () => { await restoreLog(removed); } });
      return;
    } else return;
    render();
  });

  sheet.body.addEventListener('input', (e) => {
    const f = e.target.dataset.field;
    if (f === 'notes') d.notes = e.target.value;
    else if (f === 'title') d.title = e.target.value;
    else if (f === 'amount') { d.amount = e.target.value; st.amountManual = true; refreshCalc(); refreshHold(); } else if (f === 'hours') { d.hours = e.target.value; st.hoursManual = true; refreshHold(); } else if (f === 'gallons' || f === 'minutes') { d[f] = e.target.value; recompute(); refreshCalc(); refreshHold(); }
  });

  sheet.body.addEventListener('change', async (e) => {
    const f = e.target.dataset.field;
    if (f === 'date' && e.target.value) {
      d.date = e.target.value > today ? today : e.target.value;
      render();
    } else if (f === 'final') {
      d.final = e.target.checked;
    } else if (f === 'photo' && e.target.files?.[0]) {
      try {
        st.photo = await readPhoto(e.target.files[0]);
        render();
      } catch (err) {
        toast(err.message || 'Couldn’t read that photo', { kind: 'error', duration: 3000 });
      }
    }
  });

  refreshHold();
  bindHold(holdBtn, commit, { isGuarded: sheet.guarded, hintEl: hint });

  function build() {
    const log = clone(d);
    log.at = existing && existing.date === d.date ? existing.at : d.date === today ? Date.now() : noonOf(d.date);
    log.notes = (d.notes || '').trim();
    if (type === 'mow') {
      log.position = Number(d.position);
      // Keep the recorded height when editing an old mow unless its position changed.
      log.height = existing && existing.position === log.position && existing.height != null ? existing.height : heights[log.position - 1];
      log.hours = round(Math.max(0, num(d.hours)), 2);
      log.final = !!d.final;
      log.pattern = Number.isInteger(d.pattern) ? d.pattern : 0;
    }
    if (type === 'fert' || type === 'weed') {
      const p = product();
      if (p) {
        Object.assign(log, { productId: p.id, productName: p.name, productType: p.type, unit: p.unit, n: p.n, elite: p.elite, amount: round(Math.max(0, num(d.amount)), 2) });
        if (type === 'weed') Object.assign(log, { gallons: round(Math.max(0, num(d.gallons)), 2), mixRate: p.mixRate || 0, method: 'spot' });
      } else {
        Object.assign(log, { productId: null, productName: '', productType: null, amount: 0 });
        if (type === 'weed') Object.assign(log, { gallons: round(Math.max(0, num(d.gallons)), 2), method: 'spot' });
      }
    }
    if (type === 'water') {
      const calc = E.wateringCalc(S.zones, d.zones, num(d.minutes));
      Object.assign(log, { minutes: round(Math.max(0, num(d.minutes)), 1), inches: round(calc.inches, 3), gallons: round(calc.gallons, 1), source: 'manual' });
    }
    if (type === 'other') log.title = (d.title || '').trim() || E.otherLabel(d.kind);
    return log;
  }

  async function commit() {
    if (st.saving) return;
    st.saving = true;
    try {
      const log = build();
      let newPhotoId = null;
      if (typeof st.photo === 'string') {
        newPhotoId = await savePhoto(st.photo);
        log.photoId = newPhotoId;
      } else if (st.photo === null) log.photoId = null;
      const saved = await saveLog(log, prev);
      const oldPhoto = prev?.photoId && prev.photoId !== saved.photoId ? prev.photoId : null;
      // Let the checkmark show, then close and offer Undo for 5 seconds.
      setTimeout(() => {
        sheet.close('saved');
        toast(existing ? 'Changes saved' : TYPES[type].verb, {
          undo: async () => {
            if (prev) await saveLog(prev, saved);
            else await deleteLog(saved.id);
            if (newPhotoId && prev) await deletePhoto(newPhotoId);
          },
          onExpire: () => { if (oldPhoto) deletePhoto(oldPhoto); },
        });
      }, 450);
    } catch (err) {
      st.saving = false;
      toast(`Couldn’t save: ${err.message || err}`, { kind: 'error', duration: 4000 });
    }
  }

  return sheet;
}

/** Downscale a picked photo to a JPEG data URL so the database stays small. */
export function readPhoto(file, max = 1280, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch (err) {
        reject(err);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Couldn’t read that photo')); };
    img.src = url;
  });
}

