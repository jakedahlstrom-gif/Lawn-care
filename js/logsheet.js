// Quick Log: the "+ Log" menu and the Mow / Fertilize / Weed control / Other sheets (also used to edit).

import { S, saveLog, deleteLog, restoreLog, savePhoto, deletePhoto, getPhoto } from './store.js';
import { openSheet, bindHold, holdButtonHtml, toast, confirmDialog, segmented } from './ui.js';
import { icon, TYPE_ICON } from './icons.js';
import * as E from './engine.js';
import { OTHER_KINDS, PRODUCT_TYPES } from './defaults.js';
import { esc, uid, clone, round, num, addDays, relDay, fmtDay, fmtNum, noonOf, nobreak } from './util.js';

export const TYPES = {
  mow: { title: 'Mow', verb: 'Mow logged' },
  fert: { title: 'Fertilize', verb: 'Fertilizer logged' },
  weed: { title: 'Weed control', verb: 'Weed control logged' },
  other: { title: 'Other', verb: 'Activity logged' },
};

let hooks = { ctx: () => ({}), navigate: () => {}, openProduct: () => {} };
export function setLogHooks(h) { hooks = { ...hooks, ...h }; }

export function openLogMenu() {
  const sheet = openSheet({
    title: 'Log activity',
    className: 'sheet-menu',
    content: `<div class="log-menu">${Object.entries(TYPES).map(([k, t]) => `
      <button type="button" class="log-choice" data-act="choose" data-type="${k}">
        <span class="log-choice-ic t-${k}">${icon(TYPE_ICON[k])}</span>
        <span class="log-choice-label">${t.title}</span>
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
  if (type === 'fert') return S.products.filter((p) => p.type === 'fertilizer');
  if (type === 'weed') return S.products.filter((p) => p.type === 'weed' || p.type === 'preemergent');
  return [];
}

/**
 * Open a log sheet. `existing` edits a saved log; `preset` pre-fills a new one
 * (productId, productType, kind, final).
 */
export function openLogSheet(type, { existing = null, preset = {} } = {}) {
  const c = hooks.ctx();
  const { today } = c;
  const heights = S.settings.mower.heights.map(Number);
  const rec = type === 'mow' ? E.mowRecommendation(c) : null;
  const zoneList = type === 'mow' || type === 'fert' ? E.lawnZones(S.zones) : S.zones;
  const lawnIds = E.lawnZones(S.zones).map((z) => z.id);
  const prev = existing ? clone(existing) : null;

  const d = existing ? clone(existing) : { id: uid('l'), type, date: today, zones: type === 'other' ? [] : [...lawnIds], notes: '', photoId: null };
  if (!existing) {
    if (type === 'mow') {
      d.position = rec && rec.status !== 'off' && rec.position ? rec.position : E.nearestPosition(heights, 3);
      d.clippings = S.settings.clippings;
      d.final = !!(preset.final || rec?.final);
    } else if (type === 'fert') {
      const p = S.products.find((x) => x.id === preset.productId) || E.nextFertProduct(c, c.tasks);
      d.productId = p?.id || null;
    } else if (type === 'weed') {
      const list = productsFor('weed');
      const p = list.find((x) => x.id === preset.productId) || list.find((x) => x.type === preset.productType) || list[0];
      d.productId = p?.id || null;
      d.method = p?.type === 'weed' ? 'spot' : 'broadcast';
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
  const calcAmount = () => { const p = product(); return p ? round(E.amountFor(p, area()), 2) : 0; };
  // When editing, keep a typed-in amount/time fixed; otherwise it follows the selected zones.
  if (existing) {
    st.amountManual = (type === 'fert' || type === 'weed') && Math.abs(num(existing.amount) - calcAmount()) > 0.01;
    st.hoursManual = type === 'mow' && Math.abs(num(existing.hours) - calcHours()) > 0.01;
  }

  function recompute() {
    if (type === 'mow' && !st.hoursManual) d.hours = calcHours();
    if ((type === 'fert' || type === 'weed') && !st.amountManual) d.amount = calcAmount();
  }
  recompute();

  const duplicate = () => S.logs.find((l) => l.id !== d.id && l.type === type && l.date === d.date && (type !== 'other' || l.kind === d.kind));

  function validate() {
    if (!d.date || d.date > today) return 'Pick a date that isn’t in the future.';
    if ((type === 'mow' || type === 'fert') && !d.zones.length) return 'Select at least one zone.';
    if (type === 'fert' && !product()) return 'Choose a product.';
    if (type === 'fert' && !(num(d.amount) > 0)) return 'Enter the amount used.';
    if (type === 'mow' && !(d.position >= 1)) return 'Choose a mower position.';
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
          <label class="chip chip-date ${other ? 'on' : ''}">${other ? esc(fmtDay(d.date)) : 'Other date'}
            <input type="date" data-field="date" max="${today}" value="${d.date}" aria-label="Pick a date">
          </label>
        </div>
      </div>`;
  };

  const dupHtml = () => {
    const dup = duplicate();
    if (!dup) return '';
    const what = type === 'other' ? E.otherLabel(d.kind).toLowerCase() : TYPES[type].title.toLowerCase();
    return `<div class="banner banner-warn" role="alert">${icon('alert')}<div><strong>Already logged ${relDay(d.date, today).toLowerCase() === 'today' ? 'today' : `on ${esc(fmtDay(d.date))}`}.</strong> You have a ${esc(what)} entry for this date. Saving adds a second one.</div></div>`;
  };

  const zonesHtml = (optional = false) => {
    const all = zoneList.length && zoneList.every((z) => d.zones.includes(z.id));
    const sel = zoneList.filter((z) => d.zones.includes(z.id));
    const sqft = E.zoneArea(sel);
    return `
      <div class="field">
        <div class="field-head"><span class="field-label">Zones${optional ? ' <span class="muted">(optional)</span>' : ''}</span>
          <button type="button" class="link-btn" data-act="all-zones">${all ? 'Clear' : 'Select all'}</button></div>
        <div class="chips">${zoneList.map((z) => `
          <button type="button" class="chip ${d.zones.includes(z.id) ? 'on' : ''}" data-act="zone" data-id="${z.id}" aria-pressed="${d.zones.includes(z.id)}">
            ${esc(z.name)}${E.isSloped(z) ? icon('slope', 'chip-ic') : ''}</button>`).join('')}</div>
        <div class="hint">${sel.length ? `${sel.length} ${sel.length === 1 ? 'zone' : 'zones'} · ${fmtNum(sqft, 0)} sq ft` : 'No zones selected'}</div>
      </div>`;
  };

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
      <div class="field field-row">
        <span class="field-label">Time</span>
        <div class="stepper">
          <button type="button" class="step" data-act="hours" data-step="-0.25" aria-label="Less time">−</button>
          <input class="step-input" data-field="hours" type="text" inputmode="decimal" value="${fmtNum(d.hours, 2)}" aria-label="Hours"><span class="unit">h</span>
          <button type="button" class="step" data-act="hours" data-step="0.25" aria-label="More time">+</button>
        </div>
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
      return `<div class="banner banner-info">${icon('box')}<div>No ${type === 'fert' ? 'fertilizer' : 'weed control'} products yet. <button type="button" class="link-btn" data-act="add-product">Add one in Yard</button></div></div>`;
    }
    return `
      <div class="field">
        <div class="field-label">Product</div>
        <div class="choice-list">
          ${list.map((p) => `
            <button type="button" class="choice ${d.productId === p.id ? 'on' : ''}" data-act="product" data-id="${p.id}" aria-pressed="${d.productId === p.id}">
              <span class="choice-main">
                <span class="choice-title">${esc(nobreak(p.name))}</span>
                <span class="choice-sub">${p.n}-${p.p}-${p.k} · ${PRODUCT_TYPES[p.type]} · Elite ${esc(p.elite || '–')} · ${fmtNum(p.onHand || 0, 1)} ${esc(p.unit)} on hand</span>
              </span>
              <span class="choice-check">${icon('check')}</span>
            </button>`).join('')}
          ${allowNone ? `<button type="button" class="choice ${!d.productId ? 'on' : ''}" data-act="product" data-id="">
              <span class="choice-main"><span class="choice-title">No product</span><span class="choice-sub">Hand-pulled, or a product not in your library</span></span>
              <span class="choice-check">${icon('check')}</span></button>` : ''}
        </div>
        ${!list.length ? `<div class="hint">No weed control products yet. <button type="button" class="link-btn" data-act="add-product">Add one in Yard</button></div>` : ''}
      </div>`;
  };

  const calcHtml = () => {
    const p = product();
    if (!p) return '';
    const sqft = area();
    const amt = num(d.amount);
    const onHand = p.onHand || 0;
    const prevBack = prev && prev.productId === p.id ? prev.effects?.deducted || 0 : 0;
    const avail = onHand + prevBack;
    const after = Math.max(0, avail - amt);
    const nPer = p.unit === 'lb' && sqft > 0 ? ((amt * (p.n || 0)) / 100 / sqft) * 1000 : 0;
    const timers = E.computeTimers({ ...d, at: Date.now() }, p, S.zones);
    const sloped = S.zones.filter((z) => d.zones.includes(z.id)).some(E.isSloped);
    const tText = timers.map((t) => {
      const h = Math.round((t.until - Date.now()) / 3600e3);
      if (t.kind === 'keepOff') return `keep off ${h} h`;
      if (t.kind === 'noRain') return `no heavy rain/watering ${h} h${t.sloped ? ' (sloped)' : ''}`;
      return `no mowing ${Math.round(h / 24)} ${Math.round(h / 24) === 1 ? 'day' : 'days'}`;
    });
    let rain = '';
    if (d.date === today && (type === 'fert' || p.type !== 'other')) {
      const w = E.applicationWindow({ weather: S.weather, product: p, zoneIds: d.zones, zones: S.zones, today, now: Date.now(), kind: type === 'fert' ? 'fertilizer' : p.type });
      const t0 = w.days.find((x) => x.date === today);
      if (t0) rain = `<div class="banner banner-${t0.rating === 'avoid' ? 'warn' : t0.rating === 'ok' ? 'info' : 'ok'}">${icon('drop')}<div><strong>Rain check:</strong> ${esc(t0.note)}.${t0.rating !== 'good' && w.best && w.best.date !== today ? ` Better: ${esc(relDay(w.best.date, today))}.` : ''}</div></div>`;
      else if (!w.available) rain = `<div class="banner banner-info">${icon('drop')}<div>${esc(w.summary)}</div></div>`;
    }
    return `
      <div class="calc">
        <div class="calc-row"><span>${esc(S.settings.spreader.model || 'Spreader')} setting</span><strong class="calc-big">${esc(p.elite || '–')}</strong></div>
        <div class="calc-row"><span>Amount for ${fmtNum(sqft, 0)} sq ft</span>
          <span class="calc-input"><input data-field="amount" type="text" inputmode="decimal" value="${fmtNum(amt, 2)}" aria-label="Amount used"> ${esc(p.unit)}</span></div>
        ${p.unit === 'lb' && p.n ? `<div class="calc-row"><span>Nitrogen</span><strong data-out="nper">${fmtNum(nPer, 2)} lb N / 1,000 sq ft</strong></div>` : ''}
        <div class="calc-row"><span>Inventory</span><span data-out="inv">${fmtNum(avail, 1)} → ${fmtNum(after, 1)} ${esc(p.unit)}${avail < amt - 0.01 ? ' <em class="warn-text">(more than on hand)</em>' : ''}</span></div>
      </div>
      ${rain}
      ${tText.length ? `<p class="hint">${icon('clock', 'hint-ic')} Starts timers: ${esc(tText.join(' · '))}.${sloped && type === 'fert' ? ' Sloped zones get a stricter no-rain window.' : ''}</p>` : ''}`;
  };

  const weedHtml = () => `
    ${productListHtml(true)}
    <div class="field field-row"><span class="field-label">Method</span>
      ${segmented('method', [['spot', 'Spot spray'], ['broadcast', 'Broadcast']], d.method || 'spot')}</div>
    ${calcHtml()}`;

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
    ${type === 'fert' ? zonesHtml() + productListHtml(false) + calcHtml() : ''}
    ${type === 'weed' ? zonesHtml() + weedHtml() : ''}
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
    const box = sheet.body.querySelector('.calc');
    if (!box) return;
    const p = product();
    const amt = num(d.amount);
    const sqft = area();
    const nEl = box.querySelector('[data-out="nper"]');
    if (nEl && p) nEl.textContent = `${fmtNum(sqft > 0 ? ((amt * (p.n || 0)) / 100 / sqft) * 1000 : 0, 2)} lb N / 1,000 sq ft`;
    const invEl = box.querySelector('[data-out="inv"]');
    if (invEl && p) {
      const avail = (p.onHand || 0) + (prev && prev.productId === p.id ? prev.effects?.deducted || 0 : 0);
      invEl.innerHTML = `${fmtNum(avail, 1)} → ${fmtNum(Math.max(0, avail - amt), 1)} ${esc(p.unit)}${avail < amt - 0.01 ? ' <em class="warn-text">(more than on hand)</em>' : ''}`;
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
      d[name] = seg.dataset.value;
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
    else if (act === 'hours') {
      d.hours = Math.max(0, round(num(d.hours) + Number(a.dataset.step), 2));
      st.hoursManual = true;
    } else if (act === 'product') {
      d.productId = a.dataset.id || null;
      st.amountManual = false;
      const p = product();
      if (type === 'weed' && p) d.method = p.type === 'weed' ? 'spot' : 'broadcast';
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
    else if (f === 'amount') { d.amount = e.target.value; st.amountManual = true; refreshCalc(); refreshHold(); } else if (f === 'hours') { d.hours = e.target.value; st.hoursManual = true; refreshHold(); }
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
    }
    if (type === 'fert' || type === 'weed') {
      const p = product();
      if (p) {
        Object.assign(log, { productId: p.id, productName: p.name, productType: p.type, unit: p.unit, n: p.n, elite: p.elite, amount: round(Math.max(0, num(d.amount)), 2) });
      } else {
        Object.assign(log, { productId: null, productName: '', productType: null, amount: 0 });
      }
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

/** Downscale a picked photo to a JPEG data URL (max 1280 px) so the database stays small. */
function readPhoto(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
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
