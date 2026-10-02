// History tab: season totals and the activity log (newest first) with edit and delete.

import { S } from '../store.js';
import * as E from '../engine.js';
import { rachioWaterings, loggedDuplicates } from '../irrigation.js';
import { icon, TYPE_ICON } from '../icons.js';
import { segmented } from '../ui.js';
import { MOW_PATTERNS, shortName } from '../defaults.js';
import { esc, fmtNum, fmtMoney, fmtDay, yearOf, monthName, clamp, nobreak } from '../util.js';

export const historyState = { filter: 'all', year: null };
const FILTERS = [['all', 'All'], ['mow', 'Mow'], ['fert', 'Feed'], ['weeds', 'Weeds'], ['water', 'Water'], ['other', 'Other']];
const PULL = { few: 'a few', some: 'a bunch', lots: 'lots' };

function title(l) {
  const p = S.products.find((x) => x.id === l.productId);
  const name = p ? shortName(p) : l.productName;
  if (l.type === 'mow') return `Mowed · position ${l.position} (${l.height}″)${l.final ? ' · final' : ''}`;
  if (l.type === 'fert') return `${l.productType === 'grub' ? 'Grub control' : 'Fertilized'} · ${name || 'product'}`;
  if (l.type === 'weed') return l.method === 'broadcast' ? `Weed control${name ? ` · ${name}` : ''}` : `Spot sprayed${name ? ` · ${name}` : ''}`;
  if (l.type === 'pull') return 'Pulled weeds';
  if (l.type === 'water') return `Watered · ${fmtNum(l.minutes, 0)} min per zone`;
  return l.title || E.otherLabel(l.kind);
}

function subtitle(l, dupes) {
  const zones = S.zones.filter((z) => (l.zones || []).includes(z.id));
  const lawn = E.lawnZones(S.zones);
  const zoneText = !zones.length ? '' : (lawn.length && lawn.every((z) => l.zones.includes(z.id)) && zones.length === lawn.length)
    ? 'All lawn zones' : zones.map((z) => z.name).join(', ');
  const bits = [];
  if (zoneText) bits.push(zoneText);
  if (l.type === 'mow') {
    bits.push(`${fmtNum(l.hours, 2)} h`);
    bits.push(l.clippings === 'bag' ? 'bagged' : 'mulched');
    if (Number.isInteger(l.pattern)) bits.push(MOW_PATTERNS[l.pattern]?.label.toLowerCase());
  }
  if ((l.type === 'fert' || l.type === 'weed') && l.amount > 0) {
    bits.push(`${fmtNum(l.amount, 1)} ${l.unit || 'lb'}`);
    if (l.effects?.nLbs > 0) {
      const area = E.lawnArea(S.zones, l.zones);
      if (area > 0) bits.push(`${fmtNum((l.effects.nLbs / area) * 1000, 2)} lb N/1k`);
    }
  }
  if (l.type === 'weed' && l.gallons) bits.push(`${fmtNum(l.gallons, 2)} gal mix`);
  if (l.type === 'pull' && l.howMuch) bits.push(PULL[l.howMuch] || l.howMuch);
  if (l.type === 'water') {
    const calc = E.wateringCalc(S.zones, l.zones || [], l.minutes || 0, S.settings);
    bits.push(`${fmtNum(calc.inches, 2)}″`, `${fmtNum(calc.gallons, 0)} gal`, fmtMoney(calc.cost));
    if (dupes?.[l.id]) bits.push('also recorded by Rachio, counted once');
  }
  return bits.filter(Boolean).join(' · ');
}

function totalsHtml(c, year) {
  const t = E.seasonTotals(c, year);
  const pct = clamp(((t.nPer1000 + t.mulchCredit) / (t.target || 1)) * 100, 0, 100);
  const appliedPct = clamp((t.nPer1000 / (t.target || 1)) * 100, 0, 100);
  return `<section class="card totals" data-testid="totals">
    <div class="mini-kicker">${icon('leaf')}<span>${year} season</span></div>
    <div class="stats">
      <div class="stat"><div class="stat-v" data-testid="total-mows">${t.mows}</div><div class="stat-l">Mows</div></div>
      <div class="stat"><div class="stat-v" data-testid="total-n">${fmtNum(t.nPer1000, 2)}</div><div class="stat-l">lb N per 1k sq ft</div></div>
      <div class="stat"><div class="stat-v" data-testid="total-water">${fmtMoney(t.waterCost)}</div><div class="stat-l">Watering</div></div>
    </div>
    <div class="nbar" role="img" aria-label="Nitrogen ${fmtNum(t.nPer1000, 2)} of ${fmtNum(t.target, 1)} pounds per 1,000 square feet target">
      <span class="nbar-applied" style="width:${appliedPct}%"></span><span class="nbar-mulch" style="width:${Math.max(0, pct - appliedPct)}%"></span>
    </div>
    <p class="hint">${fmtNum(t.nPer1000, 2)} lb N per 1,000 sq ft applied${t.mulchCredit > 0 ? `, plus ~${fmtNum(t.mulchCredit, 2)} returned by mulched clippings` : ''}, toward a ${fmtNum(t.target, 1)} lb season target. ${fmtNum(t.hours, 1)} mowing hours · ${t.sprays} spot sprays · ${t.pulls} weeding sessions · ${fmtNum(t.waterGallons, 0)} gal watered${t.rachioRuns ? ` (${t.rachioRuns} Rachio ${t.rachioRuns === 1 ? 'run' : 'runs'})` : ''}.</p>
    ${t.products.length ? `<div class="used">
      <div class="used-h">Products used</div>
      ${t.products.map((p) => `<div class="used-row"><span>${esc(nobreak(p.name))}</span><span>${fmtNum(p.amount, 1)} ${esc(p.unit)} · ${p.apps}×${p.cost > 0 ? ` · ${fmtMoney(p.cost)}` : ''}</span></div>`).join('')}
    </div>` : '<p class="hint">No products used yet this season.</p>'}
  </section>`;
}

const matches = (l, f) => f === 'all' || (f === 'weeds' ? l.type === 'weed' || l.type === 'pull' : l.type === f);

export function renderHistory(el, c) {
  const years = [...new Set([...S.logs.map((l) => yearOf(l.date)), yearOf(c.today)])].sort((a, b) => b - a);
  if (!historyState.year || !years.includes(historyState.year)) historyState.year = yearOf(c.today);
  const year = historyState.year;
  const f = historyState.filter;
  const logs = E.sortLogs(S.logs.filter((l) => yearOf(l.date) === year && matches(l, f)));
  const dupes = c.runs?.length ? loggedDuplicates(logs, rachioWaterings(c)) : {};
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
    <div class="filter-bar">${segmented('filter', FILTERS, f)}</div>
    ${groups.length ? groups.map((g) => `
      <h2 class="section-h">${monthName(Number(g.key.slice(5)) - 1)}</h2>
      <div class="list-card">${g.items.map((l) => `
        <button type="button" class="row row-btn log-row" data-action="edit-log" data-id="${l.id}">
          <span class="log-ic t-${l.type}">${icon(TYPE_ICON[l.type] || 'dots')}</span>
          <span class="row-main"><span class="row-title">${esc(nobreak(title(l)))}</span><span class="row-sub">${esc(subtitle(l, dupes))}${l.notes ? ` · “${esc(l.notes.length > 48 ? `${l.notes.slice(0, 48)}…` : l.notes)}”` : ''}${l.photoId ? ` · ${icon('camera', 'inline-ic')}` : ''}</span></span>
          <span class="row-date">${esc(fmtDay(l.date).replace(/^\w+, /, ''))}</span>${icon('chev', 'chev')}
        </button>`).join('')}</div>`).join('') : `
      <div class="empty">
        ${icon('history', 'empty-ic')}
        <p>${f === 'all' ? 'Nothing logged this season yet.' : 'Nothing of this type logged this season.'}</p>
        <p class="muted">Tap the green <strong>+</strong> to log a mow, feeding, weeding, watering or anything else — including past dates.</p>
      </div>`}`;
}
