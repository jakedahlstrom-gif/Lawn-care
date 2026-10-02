// History tab: season totals and the activity log (newest first) with edit and delete.

import { S } from '../store.js';
import * as E from '../engine.js';
import { icon, TYPE_ICON } from '../icons.js';
import { segmented } from '../ui.js';
import { esc, fmtNum, fmtMoney, fmtDay, yearOf, monthName, clamp, nobreak } from '../util.js';

export const historyState = { filter: 'all', year: null };

function title(l) {
  if (l.type === 'mow') return `Mowed · position ${l.position} (${l.height}″)${l.final ? ' · final' : ''}`;
  if (l.type === 'fert') return `Fertilized · ${l.productName || 'product'}`;
  if (l.type === 'weed') return `Weed control${l.productName ? ` · ${l.productName}` : ''}`;
  return l.title || E.otherLabel(l.kind);
}

function subtitle(l) {
  const zones = S.zones.filter((z) => (l.zones || []).includes(z.id));
  const lawn = E.lawnZones(S.zones);
  const zoneText = !zones.length ? '' : (lawn.length && lawn.every((z) => l.zones.includes(z.id)) && zones.length === lawn.length)
    ? 'All lawn zones' : zones.map((z) => z.name).join(', ');
  const bits = [];
  if (zoneText) bits.push(zoneText);
  if (l.type === 'mow') {
    bits.push(`${fmtNum(l.hours, 2)} h`);
    bits.push(l.clippings === 'bag' ? 'bagged' : 'mulched');
  }
  if ((l.type === 'fert' || l.type === 'weed') && l.amount > 0) {
    bits.push(`${fmtNum(l.amount, 1)} ${l.unit || 'lb'}`);
    if (l.effects?.nLbs > 0) {
      const area = l.type === 'fert' ? E.lawnArea(S.zones, l.zones) : E.zoneArea(S.zones, l.zones);
      if (area > 0) bits.push(`${fmtNum((l.effects.nLbs / area) * 1000, 2)} lb N/1k`);
    }
  }
  if (l.type === 'weed' && l.method) bits.push(l.method === 'spot' ? 'spot spray' : 'broadcast');
  return bits.join(' · ');
}

function totalsHtml(c, year) {
  const t = E.seasonTotals(c, year);
  const pct = clamp(((t.nPer1000 + t.mulchCredit) / (t.target || 1)) * 100, 0, 100);
  const appliedPct = clamp((t.nPer1000 / (t.target || 1)) * 100, 0, 100);
  return `<section class="card totals" data-testid="totals">
    <div class="kicker">${icon('leaf')} ${year} season</div>
    <div class="stats">
      <div class="stat"><div class="stat-v" data-testid="total-mows">${t.mows}</div><div class="stat-l">Mows</div></div>
      <div class="stat"><div class="stat-v" data-testid="total-n">${fmtNum(t.nPer1000, 2)}</div><div class="stat-l">lb N per 1k sq ft</div></div>
      <div class="stat"><div class="stat-v">${fmtNum(t.hours, 1)}</div><div class="stat-l">Mowing hours</div></div>
    </div>
    <div class="nbar" role="img" aria-label="Nitrogen ${fmtNum(t.nPer1000, 2)} of ${fmtNum(t.target, 1)} pounds per 1,000 square feet target">
      <span class="nbar-applied" style="width:${appliedPct}%"></span><span class="nbar-mulch" style="width:${Math.max(0, pct - appliedPct)}%"></span>
    </div>
    <p class="hint">${fmtNum(t.nPer1000, 2)} lb N per 1,000 sq ft applied${t.mulchCredit > 0 ? `, plus ~${fmtNum(t.mulchCredit, 2)} returned by mulched clippings` : ''}, toward a ${fmtNum(t.target, 1)} lb season target.</p>
    ${t.products.length ? `<div class="used">
      <div class="used-h">Products used</div>
      ${t.products.map((p) => `<div class="used-row"><span>${esc(p.name)}</span><span>${fmtNum(p.amount, 1)} ${esc(p.unit)} · ${p.apps}×${p.cost > 0 ? ` · ${fmtMoney(p.cost)}` : ''}</span></div>`).join('')}
    </div>` : '<p class="hint">No products used yet this season.</p>'}
  </section>`;
}

export function renderHistory(el, c) {
  const years = [...new Set([...S.logs.map((l) => yearOf(l.date)), yearOf(c.today)])].sort((a, b) => b - a);
  if (!historyState.year || !years.includes(historyState.year)) historyState.year = yearOf(c.today);
  const year = historyState.year;
  const f = historyState.filter;
  const logs = E.sortLogs(S.logs.filter((l) => yearOf(l.date) === year && (f === 'all' || l.type === f)));
  const groups = [];
  for (const l of logs) {
    const key = l.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
    g.items.push(l);
  }
  el.innerHTML = `
    <header class="page-head">
      <h1 class="large-title">History</h1>
      ${years.length > 1 ? `<div class="year-pick">${segmented('year', years.map((y) => [y, String(y)]), year)}</div>` : `<p class="subtitle">${year} season</p>`}
    </header>
    ${totalsHtml(c, year)}
    <div class="filter-bar">${segmented('filter', [['all', 'All'], ['mow', 'Mow'], ['fert', 'Feed'], ['weed', 'Weed'], ['other', 'Other']], f)}</div>
    ${groups.length ? groups.map((g) => `
      <h2 class="section-h">${monthName(Number(g.key.slice(5)) - 1)}</h2>
      <div class="group">${g.items.map((l) => `
        <button type="button" class="row row-btn log-row" data-action="edit-log" data-id="${l.id}">
          <span class="log-ic t-${l.type}">${icon(TYPE_ICON[l.type])}</span>
          <span class="row-main"><span class="row-title">${esc(nobreak(title(l)))}</span><span class="row-sub">${esc(subtitle(l))}${l.notes ? ` · “${esc(l.notes.length > 48 ? `${l.notes.slice(0, 48)}…` : l.notes)}”` : ''}${l.photoId ? ` · ${icon('camera', 'inline-ic')}` : ''}</span></span>
          <span class="row-date">${esc(fmtDay(l.date).replace(/^\w+, /, ''))}</span>${icon('chev', 'chev')}
        </button>`).join('')}</div>`).join('') : `
      <div class="empty">
        ${icon('history', 'empty-ic')}
        <p>${f === 'all' ? 'Nothing logged yet this season.' : 'Nothing of this type logged this season.'}</p>
        <p class="muted">Tap <strong>+ Log</strong> to record a mow, feeding, weed control, or anything else.</p>
      </div>`}`;
}
