// Plan tab: Minnesota bluegrass season calendar driven by soil temperature and weather, plus the fall checklist.

import { S, saveSettings } from '../store.js';
import * as E from '../engine.js';
import { icon } from '../icons.js';
import { openSheet } from '../ui.js';
import { esc, fmtNum, fmtMonthDay, relDay, yearOf, fmtMoney, nobreak } from '../util.js';

const f0 = (n) => fmtNum(n, 0);
const STATUS = {
  now: 'Now', late: 'Late', waiting: 'Waiting', soon: 'Soon', later: 'Later', done: 'Done', past: 'Passed',
};
const SEASONS = [['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Fall']];

function productLine(t) {
  if (!t.productType) return '';
  if (!t.product) {
    return `<div class="task-prod missing">${icon('box')} No ${t.productType === 'preemergent' ? 'pre-emergent' : 'weed control'} product yet — add one in Yard</div>`;
  }
  const p = t.product;
  return `<div class="task-prod">${icon('bag')}<span><strong>${esc(nobreak(p.name))}</strong> · Elite <strong>${esc(p.elite || '–')}</strong> · <strong>${fmtNum(t.lbs, 1)} ${esc(p.unit)}</strong> for ${f0(t.area)} sq ft</span></div>`;
}

function taskCard(t) {
  const badge = t.status === 'done' && t.doneLog ? `Done ${fmtMonthDay(t.doneLog.date)}` : STATUS[t.status];
  return `<article class="task card status-${t.status}">
    <button type="button" class="task-btn" data-action="task" data-id="${t.id}" aria-label="${esc(t.title)}: ${esc(badge)}">
      <div class="task-top">
        <span class="task-title">${esc(t.title)}${t.optional ? ' <span class="tag">optional</span>' : ''}</span>
        <span class="badge badge-${t.status}">${esc(badge)}</span>
      </div>
      ${productLine(t)}
      <p class="task-why">${esc(t.why)}</p>
      <div class="task-trigger">${icon(t.kind === 'fert' || t.kind === 'weed' ? 'thermo' : 'clock')}<span>${t.status === 'past' || t.status === 'done' ? `Usually ${esc(t.windowText)}` : `${esc(t.trigger.text)} · usually ${esc(t.windowText)}`}</span></div>
    </button>
  </article>`;
}

function checklistHtml(c) {
  const items = E.fallChecklist(c);
  const done = items.filter((i) => i.done).length;
  return `<h2 class="section-h">Fall checklist <span class="section-count">${done}/${items.length}</span></h2>
    <div class="group checklist" data-testid="fall-checklist">${items.map((i) => `
      <div class="row check-row ${i.done ? 'is-done' : ''}">
        <button type="button" class="check-box" role="checkbox" aria-checked="${i.done}" data-action="check" data-id="${i.id}" ${i.log ? 'disabled' : ''} aria-label="${esc(i.title)}">${icon('check')}</button>
        <button type="button" class="row-main check-main" data-action="check-log" data-id="${i.id}">
          <span class="row-title">${esc(i.title)}</span>
          <span class="row-sub">${i.log ? `Logged ${esc(fmtMonthDay(i.log.date))}` : i.urgent ? `<span class="warn-text">${esc(i.urgent)}</span>` : esc(i.detail)}</span>
        </button>
      </div>`).join('')}</div>`;
}

export function renderPlan(el, c) {
  const cond = c.cond;
  const y = yearOf(c.today);
  const active = c.tasks.filter((t) => ['now', 'late', 'waiting', 'soon'].includes(t.status));
  const fallFirst = Number(c.today.slice(5, 7)) >= 8;
  const freeze = cond.hardFreeze ? `${fmtMonthDay(cond.hardFreeze.date)} (${f0(cond.hardFreeze.tMin)}°F)` : cond.hasWeather ? 'none in 10 days' : '–';
  el.innerHTML = `
    <header class="page-head">
      <h1 class="large-title">Plan</h1>
      <p class="subtitle">Kentucky bluegrass · Minnesota · ${y}</p>
    </header>
    <div class="cond-strip" aria-label="Current conditions">
      <div class="cond"><span class="cond-l">Soil 24-h</span><span class="cond-v">${cond.soil24 != null ? `${f0(cond.soil24)}°F` : '–'}</span></div>
      <div class="cond"><span class="cond-l">Highs, 5 days</span><span class="cond-v">${cond.hasWeather ? `${f0(cond.highs5)}°F` : '–'}</span></div>
      <div class="cond"><span class="cond-l">Hard freeze</span><span class="cond-v">${esc(freeze)}</span></div>
    </div>
    <p class="hint plan-hint">Tasks trigger from soil temperature and the forecast, not fixed dates. Pounds are for all lawn zones (${f0(E.lawnArea(S.zones))} sq ft).</p>
    ${active.length ? `<h2 class="section-h">Now &amp; next</h2>${active.map(taskCard).join('')}` : ''}
    ${fallFirst ? checklistHtml(c) : ''}
    ${SEASONS.map(([k, label]) => {
      const list = c.tasks.filter((t) => t.season === k && !active.includes(t));
      return list.length ? `<h2 class="section-h">${label}</h2>${list.map(taskCard).join('')}` : '';
    }).join('')}
    ${fallFirst ? '' : checklistHtml(c)}`;
}

/** Task detail: why, trigger, product choice with Elite setting and pounds, and the 7-day application window. */
export function openTaskSheet(id, { ctx, onLog }) {
  const c = ctx();
  let t = c.tasks.find((x) => x.id === id);
  if (!t) return;
  const sheet = openSheet({ title: t.title, className: 'task-sheet', cancelText: 'Done' });

  const render = () => {
    const cc = ctx();
    t = cc.tasks.find((x) => x.id === id);
    const products = t.productType ? S.products.filter((p) => p.type === t.productType) : [];
    const p = t.product;
    const win = p && (t.kind === 'fert' || t.kind === 'weed')
      ? E.applicationWindow({ weather: S.weather, product: p, zoneIds: E.lawnZones(S.zones).map((z) => z.id), zones: S.zones, today: cc.today, now: cc.now })
      : null;
    const done = t.status === 'done';
    sheet.body.innerHTML = `
      <div class="task-detail">
        <span class="badge badge-${t.status}">${STATUS[t.status]}${t.doneLog ? ` ${fmtMonthDay(t.doneLog.date)}` : ''}</span>
        <p class="lead">${esc(t.why)}</p>
        <div class="group">
          <div class="row"><span class="row-main"><span class="row-sub">Trigger</span><span class="row-title">${esc(t.trigger.text)}</span></span></div>
          <div class="row"><span class="row-main"><span class="row-sub">Usual window</span><span class="row-title">${esc(t.windowText)}</span></span></div>
        </div>
        ${t.productType ? `
          <h3 class="section-h">Product</h3>
          ${products.length ? `<div class="choice-list">${products.map((x) => `
            <button type="button" class="choice ${p && p.id === x.id ? 'on' : ''}" data-act="assign" data-id="${x.id}">
              <span class="choice-main"><span class="choice-title">${esc(nobreak(x.name))}</span>
              <span class="choice-sub">${x.n}-${x.p}-${x.k} · ${fmtNum(E.nPer1000(x), 2)} lb N/1,000 · ${E.costPerLbN(x) ? `${fmtMoney(E.costPerLbN(x))}/lb N` : '—'}</span></span>
              <span class="choice-check">${icon('check')}</span>
            </button>`).join('')}</div>` : `<div class="banner banner-info">${icon('box')}<div>No ${t.productType === 'preemergent' ? 'pre-emergent' : 'weed control'} products yet. <button type="button" class="link-btn" data-act="add-product">Add one</button></div></div>`}
          ${p ? `<div class="calc">
            <div class="calc-row"><span>${esc(S.settings.spreader.model)} setting</span><strong class="calc-big">${esc(p.elite || '–')}</strong></div>
            <div class="calc-row"><span>Needed for ${f0(t.area)} sq ft</span><strong>${fmtNum(t.lbs, 1)} ${esc(p.unit)}</strong></div>
            <div class="calc-row"><span>On hand</span><strong class="${(p.onHand || 0) < t.lbs ? 'warn-text' : ''}">${fmtNum(p.onHand || 0, 1)} ${esc(p.unit)}</strong></div>
            ${p.size > 0 ? `<div class="calc-row"><span>Cost for this application</span><strong>${fmtMoney((t.lbs / p.size) * (p.price || 0))}</strong></div>` : ''}
          </div>` : ''}` : ''}
        ${win ? `
          <h3 class="section-h">Application window</h3>
          <p class="hint">${esc(win.summary)}${win.sloped ? ` Sloped zones: ${win.hours}-hour no-rain window, heavy rain ≥ ${win.heavy}″.` : ''}</p>
          ${win.days.length ? `<div class="group">${win.days.map((d) => `
            <div class="row"><span class="dot dot-${d.rating}" aria-hidden="true"></span>
            <span class="row-main"><span class="row-title">${esc(relDay(d.date, cc.today))}</span><span class="row-sub">${esc(d.note)}</span></span>
            <span class="rating rating-${d.rating}">${d.rating === 'good' ? 'Good' : d.rating === 'ok' ? 'OK' : 'Avoid'}</span></div>`).join('')}</div>` : ''}` : ''}
        <div class="btn-stack">
          ${t.kind !== 'info' ? `<button type="button" class="btn btn-filled" data-act="log">${icon('plus')} Log it</button>` : ''}
          ${t.kind !== 'info' && !t.doneLog ? `<button type="button" class="btn btn-plain" data-act="toggle">${done ? 'Mark as not done' : 'Mark done without logging'}</button>` : ''}
        </div>
      </div>`;
  };
  render();

  sheet.body.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    const act = a.dataset.act;
    if (act === 'assign') {
      S.settings.planProducts[id] = a.dataset.id;
      await saveSettings();
      render();
    } else if (act === 'toggle') {
      const y = yearOf(ctx().today);
      const checks = (S.settings.planChecks[y] ||= {});
      if (checks[id]) delete checks[id];
      else checks[id] = true;
      await saveSettings();
      render();
    } else if (act === 'log') {
      sheet.close();
      onLog(t);
    } else if (act === 'add-product') {
      sheet.close();
      onLog({ addProduct: t.productType });
    }
  });
}
