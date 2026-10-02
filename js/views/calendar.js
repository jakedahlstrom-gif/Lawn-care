// Calendar tab: feeding windows (4-week spacing, missed windows folded into the next), season tasks triggered
// by soil temperature and weather, and the fall checklist. Past items hide unless "Show past" is on.

import { S, saveSettings } from '../store.js';
import * as E from '../engine.js';
import * as Season from '../season.js';
import { icon } from '../icons.js';
import { openSheet, switchHtml } from '../ui.js';
import { shortName } from '../defaults.js';
import { esc, fmtNum, fmtMonthDay, relDay, yearOf, fmtMoney, nobreak } from '../util.js';

const f0 = (n) => fmtNum(n, 0);
const FEED_STATUS = { done: 'Done', open: 'Open now', waiting: 'Waiting', upcoming: 'Upcoming', missed: 'Missed', skipped: 'Skipped' };
const TASK_STATUS = { now: 'Now', waiting: 'Waiting', soon: 'Soon', later: 'Later', done: 'Done', past: 'Passed' };
const SEASONS = [['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Fall'], ['all', 'All season']];

const isPastFeeding = (f, today) => ['missed', 'skipped'].includes(f.status) || (f.status === 'done' && today > f.end);
const isPastTask = (t, today) => t.status === 'past' || (t.status === 'done' && today > t.we);

function productLine(p, lbs, area) {
  if (!p) return '';
  const amount = p.type === 'weed' ? `${fmtNum(p.mixRate || 0, 2)} fl oz per gallon` : `<strong>${fmtNum(lbs, 1)} ${esc(p.unit)}</strong> for ${f0(area)} sq ft`;
  return `<div class="task-prod">${icon(p.type === 'weed' ? 'spray' : 'bag')}<span><strong>${esc(nobreak(shortName(p)))}</strong>${p.elite ? ` · Elite <strong>${esc(p.elite)}</strong>` : ''} · ${amount}</span></div>`;
}

function feedingCard(f, c) {
  const badge = f.status === 'done' && f.log ? `Done ${fmtMonthDay(f.log.date)}` : FEED_STATUS[f.status];
  const area = E.lawnArea(S.zones);
  const shop = ['open', 'waiting', 'upcoming'].includes(f.status) && f.product ? Season.bagPlan(f.product, f.lbs) : null;
  return `<article class="task card status-${f.status}" data-testid="feed-${f.id}">
    <button type="button" class="task-btn" data-action="feeding" data-id="${f.id}">
      <div class="task-top">
        <span class="task-title">${esc(f.title)}${f.optional ? ' <span class="tag">optional</span>' : ''}</span>
        <span class="badge badge-${f.status}">${esc(badge)}</span>
      </div>
      ${productLine(f.product, f.lbs, area)}
      <div class="task-trigger">${icon('plan')}<span>${esc(Season.rangeText(f.start <= f.end ? f.start : f.ws, f.end))}${f.reason ? ` · ${esc(f.reason)}` : ''}</span></div>
      ${f.status === 'done' || isPastFeeding(f, c.today) ? '' : `<p class="task-why">${esc(f.why)}</p>`}
      ${shop ? `<div class="task-shop ${shop.enough ? 'ok' : ''}">${icon(shop.enough ? 'check' : 'cart')}<span>${esc(nobreak(shop.text))}</span></div>` : ''}
    </button>
  </article>`;
}

function taskCard(t) {
  const badge = t.status === 'done' && t.doneLog ? `Done ${fmtMonthDay(t.doneLog.date)}` : TASK_STATUS[t.status];
  return `<article class="task card status-${t.status}">
    <button type="button" class="task-btn" data-action="task" data-id="${t.id}">
      <div class="task-top">
        <span class="task-title">${esc(t.title)}${t.optional ? ' <span class="tag">optional</span>' : ''}</span>
        <span class="badge badge-${t.status}">${esc(badge)}</span>
      </div>
      ${t.product ? productLine(t.product, t.lbs, E.lawnArea(S.zones)) : t.productType ? `<div class="task-prod missing">${icon('box')} No product yet — add one in Yard</div>` : ''}
      ${t.status === 'past' || t.status === 'done' ? '' : `<p class="task-why">${esc(t.why)}</p>`}
      <div class="task-trigger">${icon('clock')}<span>${t.status === 'past' || t.status === 'done' ? `Usually ${esc(t.windowText)}` : `${esc(t.trigger.text)} · usually ${esc(t.windowText)}`}</span></div>
    </button>
  </article>`;
}

function checklistHtml(c) {
  const items = Season.fallChecklist(c);
  const done = items.filter((i) => i.done).length;
  return `<h2 class="section-h">Fall checklist <span class="section-count">${done}/${items.length}</span></h2>
    <div class="list-card checklist" data-testid="fall-checklist">${items.map((i) => `
      <div class="check-row ${i.done ? 'is-done' : ''}">
        <button type="button" class="check-box" role="checkbox" aria-checked="${i.done}" data-action="check" data-id="${i.id}" data-year="${i.year}" ${i.log ? 'disabled' : ''} aria-label="${esc(i.title)}">${icon('check')}</button>
        <button type="button" class="check-main" data-action="check-log" data-id="${i.id}" data-list="fall">
          <span class="row-title">${esc(i.title)}</span>
          <span class="row-sub">${i.log ? `Logged ${esc(fmtMonthDay(i.log.date))}` : i.urgent ? `<span class="warn-text">${esc(i.urgent)}</span>` : esc(i.detail)}</span>
        </button>
      </div>`).join('')}</div>
    <p class="footer-note">Items check themselves off when you log the matching activity.</p>`;
}

export function renderCalendar(el, c) {
  const cond = c.cond;
  const y = yearOf(c.today);
  const showPast = !!S.settings.calendar?.showPast;
  const feedings = c.feedings.filter((f) => showPast || !isPastFeeding(f, c.today));
  const tasks = c.seasonTasks.filter((t) => showPast || !isPastTask(t, c.today));
  const hiddenCount = (c.feedings.length - feedings.length) + (c.seasonTasks.length - tasks.length);
  const fallFirst = Number(c.today.slice(5, 7)) >= 8;
  const freeze = cond.hardFreeze ? `${fmtMonthDay(cond.hardFreeze.date)} (${f0(cond.hardFreeze.tMin)}°F)` : cond.hasWeather ? 'none in 10 days' : '–';
  el.innerHTML = `
    <header class="page-head">
      <h1 class="large-title">Calendar</h1>
      <p class="subtitle">Kentucky bluegrass · Minnesota · ${y}</p>
    </header>
    <div class="cond-strip" aria-label="Current conditions">
      <div class="cond"><span class="cond-l">Soil 24-h</span><span class="cond-v">${cond.soil24 != null ? `${f0(cond.soil24)}°F` : '–'}</span></div>
      <div class="cond"><span class="cond-l">Highs, 5 days</span><span class="cond-v">${cond.hasWeather ? `${f0(cond.highs5)}°F` : '–'}</span></div>
      <div class="cond"><span class="cond-l">Hard freeze</span><span class="cond-v">${esc(freeze)}</span></div>
    </div>
    <div class="list-card toggle-card">
      <div class="row"><span class="row-main"><span class="row-title">Show past</span><span class="row-sub">${showPast ? 'Showing everything this year' : `${hiddenCount} past ${hiddenCount === 1 ? 'item' : 'items'} hidden`}</span></span>${switchHtml('calendar.showPast', showPast, 'Show past tasks')}</div>
    </div>
    ${fallFirst ? checklistHtml(c) : ''}
    <h2 class="section-h">Feedings <span class="section-count">Scotts lineup · 4+ weeks apart</span></h2>
    ${feedings.length ? feedings.map((f) => feedingCard(f, c)).join('') : '<p class="footer-note">No more feedings this year. Next up: the crabgrass preventer in spring.</p>'}
    ${SEASONS.map(([k, label]) => {
      const list = tasks.filter((t) => t.season === k);
      return list.length ? `<h2 class="section-h">${label}</h2>${list.map(taskCard).join('')}` : '';
    }).join('')}
    ${fallFirst ? '' : checklistHtml(c)}`;
}

/* ---------- detail sheets ---------- */

function windowRows(win, today) {
  if (!win || !win.days.length) return '';
  return `<div class="list-card">${win.days.map((d) => `
    <div class="row"><span class="dot dot-${d.rating}" aria-hidden="true"></span>
    <span class="row-main"><span class="row-title">${esc(relDay(d.date, today))}</span><span class="row-sub">${esc(d.note)}</span></span>
    <span class="rating rating-${d.rating}">${d.rating === 'good' ? 'Good' : d.rating === 'ok' ? 'OK' : 'Avoid'}</span></div>`).join('')}</div>`;
}

function productChooser(current, type, actName) {
  const list = S.products.filter((p) => (type === 'fertilizer' ? ['fertilizer', 'preemergent'].includes(p.type) : p.type === type));
  if (!list.length) return `<div class="banner banner-info">${icon('box')}<div>No matching products yet. <button type="button" class="link-btn" data-act="add-product">Add one</button></div></div>`;
  return `<div class="choice-list">${list.map((x) => `
    <button type="button" class="choice ${current && current.id === x.id ? 'on' : ''}" data-act="${actName}" data-id="${x.id}">
      <span class="choice-main"><span class="choice-title">${esc(nobreak(x.name))}</span>
      <span class="choice-sub">${x.type === 'weed' ? `${fmtNum(x.mixRate || 0, 2)} fl oz per gallon` : `${x.n}-${x.p}-${x.k} · ${fmtNum(E.nPer1000(x), 2)} lb N/1,000 · ${E.costPerLbN(x) ? `${fmtMoney(E.costPerLbN(x))}/lb N` : '—'}`}</span></span>
      <span class="choice-check">${icon('check')}</span>
    </button>`).join('')}</div>`;
}

export function openFeedingSheet(id, { ctx, onLog }) {
  const first = ctx().feedings.find((x) => x.id === id);
  if (!first) return;
  const sheet = openSheet({ title: first.title, className: 'task-sheet', cancelText: 'Done' });
  const render = () => {
    const c = ctx();
    const f = c.feedings.find((x) => x.id === id);
    const p = f.product;
    const area = E.lawnArea(S.zones);
    const days = Math.max(1, Math.min(7, (new Date(`${f.end}T12:00`) - new Date(`${c.today}T12:00`)) / 864e5 + 1));
    const win = p && ['open', 'waiting', 'upcoming'].includes(f.status) && f.start <= c.today
      ? E.applicationWindow({ weather: S.weather, product: p, zoneIds: E.lawnZones(S.zones).map((z) => z.id), zones: S.zones, today: c.today, now: c.now, days })
      : null;
    const shop = p && f.status !== 'done' ? Season.bagPlan(p, f.lbs) : null;
    sheet.body.innerHTML = `
      <div class="task-detail">
        <span class="badge badge-${f.status}">${FEED_STATUS[f.status]}${f.log ? ` ${fmtMonthDay(f.log.date)}` : ''}</span>
        <p class="lead">${esc(f.why)}</p>
        <div class="list-card">
          <div class="row"><span class="row-main"><span class="row-sub">Window</span><span class="row-title">${esc(Season.rangeText(f.start <= f.end ? f.start : f.ws, f.end))}</span></span></div>
          ${f.reason ? `<div class="row"><span class="row-main"><span class="row-sub">Status</span><span class="row-title">${esc(f.reason)}</span></span></div>` : ''}
          <div class="row"><span class="row-main"><span class="row-sub">Spacing</span><span class="row-title">At least 4 weeks after the previous feeding</span></span></div>
        </div>
        <h3 class="section-h">Product</h3>
        ${productChooser(p, f.productType === 'preemergent' ? 'preemergent' : 'fertilizer', 'assign')}
        ${p ? `<div class="calc">
          <div class="calc-row"><span>${esc(S.settings.spreader.model)} setting</span><strong class="calc-big">${esc(p.elite || '–')}</strong></div>
          <div class="calc-row"><span>Needed for ${f0(area)} sq ft</span><strong>${fmtNum(f.lbs, 1)} ${esc(p.unit)}</strong></div>
          <div class="calc-row"><span>Nitrogen</span><strong>${fmtNum(E.nPer1000(p), 2)} lb N / 1,000 sq ft</strong></div>
          <div class="calc-row"><span>On hand</span><strong class="${(p.onHand || 0) < f.lbs ? 'warn-text' : ''}">${fmtNum(p.onHand || 0, 1)} ${esc(p.unit)}</strong></div>
        </div>` : ''}
        ${shop ? `<div class="task-shop ${shop.enough ? 'ok' : ''}">${icon(shop.enough ? 'check' : 'cart')}<span>${esc(nobreak(shop.text))}</span></div>` : ''}
        ${win ? `<h3 class="section-h">Application window</h3><p class="hint">${esc(win.summary)}${win.sloped ? ` Sloped zones: ${win.hours}-hour no-rain window, heavy rain ≥ ${win.heavy}″.` : ''}</p>${windowRows(win, c.today)}` : ''}
        <div class="btn-stack">
          <button type="button" class="btn btn-filled" data-act="log">${icon('plus')} Log feeding</button>
        </div>
      </div>`;
  };
  render();
  sheet.body.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (!a) return;
    if (a.dataset.act === 'assign') {
      S.settings.planProducts[id] = a.dataset.id;
      await saveSettings();
      render();
    } else if (a.dataset.act === 'log') {
      const f = ctx().feedings.find((x) => x.id === id);
      sheet.close();
      onLog({ kind: 'fert', product: f.product });
    } else if (a.dataset.act === 'add-product') {
      sheet.close();
      onLog({ addProduct: 'fertilizer' });
    }
  });
}

export function openTaskSheet(id, { ctx, onLog }) {
  if (!ctx().seasonTasks.find((x) => x.id === id)) return;
  const sheet = openSheet({ title: ctx().seasonTasks.find((x) => x.id === id).title, className: 'task-sheet', cancelText: 'Done' });
  const render = () => {
    const c = ctx();
    const t = c.seasonTasks.find((x) => x.id === id);
    const p = t.product;
    const win = p && t.kind === 'weed' ? E.applicationWindow({ weather: S.weather, product: p, zoneIds: E.lawnZones(S.zones).map((z) => z.id), zones: S.zones, today: c.today, now: c.now, kind: 'weed' }) : null;
    sheet.body.innerHTML = `
      <div class="task-detail">
        <span class="badge badge-${t.status}">${TASK_STATUS[t.status]}${t.doneLog ? ` ${fmtMonthDay(t.doneLog.date)}` : ''}</span>
        <p class="lead">${esc(t.why)}</p>
        <div class="list-card">
          <div class="row"><span class="row-main"><span class="row-sub">Trigger</span><span class="row-title">${esc(t.trigger.text)}</span></span></div>
          <div class="row"><span class="row-main"><span class="row-sub">Usual window</span><span class="row-title">${esc(t.windowText)}</span></span></div>
        </div>
        ${t.productType ? `<h3 class="section-h">Product</h3>${productChooser(p, t.productType, 'assign')}` : ''}
        ${p && p.type !== 'weed' && t.lbs ? `<div class="calc"><div class="calc-row"><span>${esc(S.settings.spreader.model)} setting</span><strong class="calc-big">${esc(p.elite || '–')}</strong></div><div class="calc-row"><span>Needed for ${f0(E.lawnArea(S.zones))} sq ft</span><strong>${fmtNum(t.lbs, 1)} ${esc(p.unit)}</strong></div></div>` : ''}
        ${win ? `<h3 class="section-h">Spray days</h3><p class="hint">${esc(win.summary)}</p>${windowRows(win, c.today)}` : ''}
        <div class="btn-stack">
          ${t.kind !== 'info' ? `<button type="button" class="btn btn-filled" data-act="log">${icon('plus')} Log it</button>` : ''}
          ${t.kind !== 'info' && !t.doneLog && !t.ongoing ? `<button type="button" class="btn btn-plain" data-act="toggle">${t.status === 'done' ? 'Mark as not done' : 'Mark done without logging'}</button>` : ''}
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
      const t = ctx().seasonTasks.find((x) => x.id === id);
      sheet.close();
      onLog(t);
    } else if (act === 'add-product') {
      sheet.close();
      onLog({ addProduct: ctx().seasonTasks.find((x) => x.id === id).productType });
    }
  });
}
