// History tab: season totals and the activity log (newest first) with edit and delete.

import { S, getPhoto } from '../store.js';
import * as E from '../engine.js';
import { rachioWaterings, loggedDuplicates } from '../irrigation.js';
import { icon, TYPE_ICON } from '../icons.js';
import { segmented } from '../ui.js';
import { MOW_PATTERNS, shortName } from '../defaults.js';
import { esc, fmtNum, fmtMoney, fmtDay, yearOf, monthName, clamp, nobreak } from '../util.js';
import { seasonStats, trophies, heatmapHtml } from '../fun.js';

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
  if (l.type === 'fert' && l.elite) bits.push(`setting ${l.elite}`);
  if (l.type === 'weed' && l.gallons) bits.push(`${fmtNum(l.gallons, 2)} gal mix`);
  if (l.type === 'pull' && l.howMuch) bits.push(PULL[l.howMuch] || l.howMuch);
  if (l.type === 'water') {
    const calc = E.wateringCalc(S.zones, l.zones || [], l.minutes || 0, S.settings);
    bits.push(`${fmtNum(calc.inches, 2)}″`, `${fmtNum(calc.gallons, 0)} gal`, fmtMoney(calc.cost));
    if (dupes?.[l.id]) bits.push('also recorded by Rachio, counted once');
  }
  return bits.filter(Boolean).join(' · ');
}

/** Logged activity per month for the season: mows in the accent, everything else stacked above. */
function monthsHtml(year, today) {
  const logs = S.logs.filter((l) => yearOf(l.date) === year);
  if (!logs.length) return '';
  const monthOf = (l) => Number(l.date.slice(5, 7)) - 1;
  const ms = logs.map(monthOf);
  const rows = [];
  for (let m = Math.min(3, ...ms); m <= Math.max(9, ...ms); m++) {
    const these = logs.filter((l) => monthOf(l) === m);
    const mow = these.filter((l) => l.type === 'mow').length;
    rows.push({ m, mow, other: these.length - mow });
  }
  const max = Math.max(...rows.map((r) => r.mow + r.other), 1);
  const nowM = yearOf(today) === year ? Number(today.slice(5, 7)) - 1 : -1;
  const h = (n) => `${((n / max) * 100).toFixed(1)}%`;
  const label = rows.filter((r) => r.mow + r.other).map((r) => `${monthName(r.m)} ${r.mow + r.other}`).join(', ');
  return `<div class="months-wrap">
    <div class="months-head"><span class="used-h">Activity by month</span><span class="months-key"><span class="k-mow">Mows</span><span class="k-other">Other</span></span></div>
    <div class="months" role="img" aria-label="Logged activity by month: ${esc(label)}">${rows.map((r) => `
      <span class="mo${r.m === nowM ? ' is-now' : ''}"><span class="mo-n">${r.mow + r.other || ''}</span><span class="mo-col">${r.other ? `<span class="mo-other" style="height:${h(r.other)}"></span>` : ''}${r.mow ? `<span class="mo-mow" style="height:${h(r.mow)}"></span>` : ''}</span><span class="mo-base"></span><span class="mo-l">${monthName(r.m).slice(0, 3)}</span></span>`).join('')}</div>
  </div>`;
}

const photoCache = new Map();

/** The season's log photos as a scrolling strip; tap one to open its entry. */
function photosHtml(year) {
  const list = E.sortLogs(S.logs.filter((l) => l.photoId && yearOf(l.date) === year));
  if (!list.length) return '';
  return `<section class="card photo-card" data-testid="photos">
    <div class="sec-row inner"><span class="mini-kicker">${icon('camera')}<span>Lawn photos</span></span><span class="heat-count">${list.length}</span></div>
    <div class="photo-strip">${list.map((l) => `
      <button type="button" class="ph" data-action="edit-log" data-id="${l.id}" aria-label="Photo from ${esc(fmtDay(l.date))}">
        <img data-photo="${esc(l.photoId)}" alt=""${photoCache.has(l.photoId) ? ` src="${photoCache.get(l.photoId)}"` : ''}>
        <span>${esc(fmtDay(l.date).replace(/^\w+, /, ''))}</span>
      </button>`).join('')}</div>
  </section>`;
}

function loadPhotos(el) {
  el.querySelectorAll('img[data-photo]:not([src])').forEach((img) => {
    const id = img.dataset.photo;
    getPhoto(id).then((ph) => {
      if (!ph?.dataUrl) return;
      photoCache.set(id, ph.dataUrl);
      img.src = ph.dataUrl;
    }).catch(() => {});
  });
}

function trophiesHtml(stats) {
  const list = trophies(stats);
  const n = list.filter((t) => t.earned).length;
  const prog = (t) => `${fmtNum(Math.min(t.value, t.goal), 1)} / ${fmtNum(t.goal, 1)}`;
  return `<section class="card trophy-card" data-testid="trophies">
    <div class="sec-row inner"><span class="mini-kicker">${icon('trophy')}<span>Trophies</span></span><span class="heat-count">${n} of ${list.length}</span></div>
    <div class="trophies">${list.map((t) => `
      <button type="button" class="trophy${t.earned ? ' earned' : ''}" data-action="trophy" data-text="${esc(`${t.title}: ${t.text}. ${t.earned ? 'Earned this season.' : `${prog(t)} so far.`}`)}" aria-label="${esc(`${t.title}, ${t.earned ? 'earned' : prog(t)}. ${t.text}`)}">
        <span class="tr-ic">${icon(t.icon)}</span>
        <span class="tr-t">${esc(t.title)}</span>
        ${t.earned ? '<span class="tr-s">Earned</span>' : `<span class="tr-bar"><span style="width:${(t.pct * 100).toFixed(0)}%"></span></span><span class="tr-s">${prog(t)}</span>`}
      </button>`).join('')}</div>
  </section>`;
}

function totalsHtml(c, year, stats) {
  const t = E.seasonTotals(c, year);
  const pct = clamp(((t.nPer1000 + t.mulchCredit) / (t.target || 1)) * 100, 0, 100);
  const appliedPct = clamp((t.nPer1000 / (t.target || 1)) * 100, 0, 100);
  // Nitrogen ring: applied in the accent, mulched-clipping credit as a fainter continuation.
  const R = 52;
  const C = 2 * Math.PI * R;
  const arc = (p) => `${((p / 100) * C).toFixed(2)} ${C.toFixed(2)}`;
  return `<section class="card totals" data-testid="totals">
    <div class="sec-row inner"><span class="mini-kicker">${icon('leaf')}<span>${year} season</span></span>${stats.logs ? `<button type="button" class="wrap-btn" data-action="wrapped" data-year="${year}">${icon('play')}<span>Season recap</span></button>` : ''}</div>
    <div class="tot-top">
      <div class="ring" role="img" aria-label="Nitrogen ${fmtNum(t.nPer1000, 2)} of ${fmtNum(t.target, 1)} pounds per 1,000 square feet target">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="${R}" class="ring-track" stroke-width="10"/>
          ${pct > appliedPct ? `<circle cx="60" cy="60" r="${R}" class="ring-mulch" stroke-width="10" stroke-dasharray="${arc(pct)}"/>` : ''}
          ${appliedPct > 0 ? `<circle cx="60" cy="60" r="${R}" class="ring-arc" stroke-width="10" stroke-dasharray="${arc(appliedPct)}"/>` : ''}
        </svg>
        <div class="ring-center"><span class="ring-v" data-testid="total-n">${fmtNum(t.nPer1000, 2)}</span><span class="ring-l">of ${fmtNum(t.target, 1)} lb N<br>per 1k sq ft</span></div>
      </div>
      <div class="tot-side">
        <div class="stat"><div class="stat-v" data-testid="total-mows">${t.mows}</div><div class="stat-l">Mows</div></div>
        <div class="stat"><div class="stat-v" data-testid="total-water">${fmtMoney(t.waterCost)}</div><div class="stat-l">Watering</div></div>
      </div>
    </div>
    <p class="hint">${fmtNum(t.nPer1000, 2)} lb N per 1,000 sq ft applied${t.mulchCredit > 0 ? `, plus ~${fmtNum(t.mulchCredit, 2)} returned by mulched clippings` : ''}, toward a ${fmtNum(t.target, 1)} lb season target. ${fmtNum(t.hours, 1)} mowing hours${stats.miles > 0 ? ` · ≈${fmtNum(stats.miles, 1)} mi walked` : ''} · ${t.sprays} spot sprays · ${t.pulls} weeding sessions · ${fmtNum(t.waterGallons, 0)} gal watered${t.rachioRuns ? ` (${t.rachioRuns} Rachio ${t.rachioRuns === 1 ? 'run' : 'runs'})` : ''}.</p>
    ${monthsHtml(year, c.today)}
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
  const stats = seasonStats(c, year);
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
    ${totalsHtml(c, year, stats)}
    ${heatmapHtml(c, year)}
    ${trophiesHtml(stats)}
    ${photosHtml(year)}
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
        <p class="muted">Tap <strong>+</strong> to log a mow, feeding, weeding, watering or anything else — including past dates.</p>
      </div>`}`;
  loadPhotos(el);
}
