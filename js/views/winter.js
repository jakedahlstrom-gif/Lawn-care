// Winter Mode screen: replaces Today while it's on. Same photo header and card design.

import * as Season from '../season.js';
import { icon } from '../icons.js';
import { describeCode } from '../weather.js';
import { lineChart, bindCharts } from '../charts.js';
import { heroHtml, promptHtml, forecastHtml, shoppingHtml } from './today.js';
import { esc, fmtNum, fmtMonthDay, fmtMoney, nobreak } from '../util.js';
import { shortName } from '../defaults.js';

const f0 = (n) => fmtNum(n, 0);

export const WINTER_TIPS = [
  'Keep salt and ice melt off the lawn edges along the driveway and sidewalk.',
  'Don’t pile salty snow on the lawn — shovel or blow it onto beds or the easement instead.',
  'Avoid walking on frozen or frosty grass; the crowns break and show up as brown paths in spring.',
  'Mark sprinkler heads near the driveway with stakes before snow blowing so they don’t get clipped.',
];

export function renderWinter(el, c) {
  const w = Season.winterInfo(c);
  const desc = describeCode(w.code);
  const bits = ['Winter Mode'];
  if (w.temp != null) bits.push(`${f0(w.temp)}°F`);
  if (w.depth != null && w.depth >= 0.5) bits.push(`${fmtNum(w.depth, 0)}″ snow on the ground`);
  else if (w.soil != null) bits.push(`${f0(w.soil)}°F soil`);
  const cd = w.countdown;
  const feedLine = cd.daysUntil > 0
    ? `Crabgrass preventer window: ~${fmtMonthDay(cd.opensOn)}${cd.source === 'typical' ? ' (typical)' : ''}`
    : 'Crabgrass preventer window is opening';
  const seriesPts = w.series.map((p) => ({ label: `${fmtMonthDay(p.date)} · ${f0(p.soil)}°F${p.future ? ' (forecast)' : ''}`, tick: fmtMonthDay(p.date).replace(/^(\w+) /, '$1 '), value: p.soil, future: p.future }));
  const r = w.recap;
  const checklist = w.checklist;
  el.innerHTML = `
    ${heroHtml(c, { summary: bits.join(' · '), feedLine, winter: true })}
    <div class="page-body">
      ${promptHtml(c)}
      ${cd.alert ? `<div class="banner banner-warn winter-alert" data-testid="spring-alert">${icon('alert')}<div><strong>Spring is close.</strong> ${esc(cd.alertText)}</div></div>` : ''}

      <section class="card winter-now" data-testid="winter-conditions">
        <div class="mini-kicker">${icon(desc.icon)}<span>Conditions</span></div>
        <div class="wnow">
          <div class="wnow-temp">${w.temp != null ? `${f0(w.temp)}°` : '–'}<span class="mini-desc">${esc(desc.label)}</span></div>
          <div class="wnow-hl">${w.hi != null ? `H ${f0(w.hi)}° · L ${f0(w.lo)}°` : ''}</div>
        </div>
        <div class="wgrid">
          <div class="wstat"><span class="wstat-l">Snowfall today</span><span class="wstat-v">${w.snowToday != null ? `${fmtNum(w.snowToday, 1)}″` : '–'}</span></div>
          <div class="wstat"><span class="wstat-l">Snowfall, 7 days</span><span class="wstat-v">${w.snowWeek != null ? `${fmtNum(w.snowWeek, 1)}″` : '–'}</span></div>
          <div class="wstat"><span class="wstat-l">Snow depth</span><span class="wstat-v" data-testid="snow-depth">${w.depth != null ? `${fmtNum(w.depth, 1)}″` : '–'}</span></div>
        </div>
      </section>

      <section class="card" data-testid="soil-card">
        <div class="sec-row inner"><span class="mini-kicker">${icon('thermo')}<span>Soil temperature</span></span><span class="soil-now">${w.soil != null ? `${f0(w.soil)}°F` : '–'}</span></div>
        <p class="reason">${w.trend ? `${esc(w.trend.text)}.` : 'Trend shows once weather loads.'}${w.series.some((p) => p.future) ? ' The dashed part is the forecast.' : ''}</p>
        ${seriesPts.length > 2 ? `<div class="chart-wrap">${lineChart({ id: 'soil-trend', points: seriesPts, unit: '°', refLine: { value: 55, label: '55°F crabgrass' }, ariaLabel: `Daily soil temperature, now ${f0(w.soil)} degrees` })}</div>` : ''}
      </section>

      <section class="card countdown-card" data-testid="countdown">
        <div class="mini-kicker">${icon('leaf')}<span>Spring countdown</span></div>
        <div class="cd-big">${cd.daysUntil > 0 ? `${cd.daysUntil} <span>days</span>` : 'Now'}</div>
        <p class="reason">${esc(cd.text)}</p>
        <div class="cd-bar" role="img" aria-label="Soil ${cd.soil != null ? f0(cd.soil) : 'unknown'} of 55 degrees"><span style="width:${cd.soil != null ? Math.max(0, Math.min(100, ((cd.soil - 25) / 30) * 100)) : 0}%"></span></div>
        <div class="cd-scale"><span>25°F</span><span>Window opens ~50°F</span><span>55°F</span></div>
        <p class="hint">You’ll get a heads-up 1–2 weeks before the window opens so there’s time to buy ${esc(shortName(cd.product) || 'the preventer')}.</p>
      </section>

      ${shoppingHtml('Spring shopping list', w.shopping, 'spring-shopping')}

      <section class="agenda">
        <div class="sec-row"><h2 class="sec-title">Winter checklist</h2><span class="sec-aside">${checklist.filter((i) => i.done).length}/${checklist.length} done</span></div>
        <div class="list-card checklist" data-testid="winter-checklist">${checklist.map((i) => `
          <div class="check-row ${i.done ? 'is-done' : ''}">
            <button type="button" class="check-box" role="checkbox" aria-checked="${i.done}" data-action="check" data-id="${i.id}" data-year="${i.year}" ${i.log ? 'disabled' : ''} aria-label="${esc(i.title)}">${icon('check')}</button>
            <button type="button" class="check-main" data-action="check-log" data-id="${i.id}" data-list="winter">
              <span class="row-title">${esc(i.title)}${i.fromFall ? ' <span class="tag">from fall</span>' : ''}</span>
              <span class="row-sub">${i.log ? `Logged ${esc(fmtMonthDay(i.log.date))}` : i.urgent ? `<span class="warn-text">${esc(i.urgent)}</span>` : esc(i.detail)}</span>
            </button>
          </div>`).join('')}</div>
      </section>

      <section class="card tips-card">
        <div class="mini-kicker">${icon('snow')}<span>Winter tips</span></div>
        <ul class="tips">${WINTER_TIPS.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
      </section>

      <section class="card recap-card" data-testid="recap">
        <div class="mini-kicker">${icon('history')}<span>${r.year} season recap</span></div>
        <div class="recap-grid">
          <div class="rstat"><span class="rstat-v">${r.mows}</span><span class="rstat-l">Mows</span></div>
          <div class="rstat"><span class="rstat-v">${fmtNum(r.nPer1000, 2)}</span><span class="rstat-l">lb N per 1k sq ft</span></div>
          <div class="rstat"><span class="rstat-v">${fmtMoney(r.waterCost)}</span><span class="rstat-l">Watering cost</span></div>
        </div>
        ${r.products.length ? `<div class="used"><div class="used-h">Products used</div>${r.products.map((p) => `<div class="used-row"><span>${esc(nobreak(p.name))}</span><span>${fmtNum(p.amount, 1)} ${esc(p.unit)} · ${p.apps}×</span></div>`).join('')}</div>` : '<p class="hint">No products logged that season.</p>'}
      </section>

      ${forecastHtml(c)}
    </div>`;
  bindCharts(el);
}
