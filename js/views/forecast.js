// Forecast day detail sheet: hourly temperature, rain, wind, humidity, soil temperature, frost risk,
// and a lawn verdict for the day.

import { S } from '../store.js';
import * as E from '../engine.js';
import { icon } from '../icons.js';
import { openSheet } from '../ui.js';
import { lineChart, columnChart, bindCharts } from '../charts.js';
import { describeCode } from '../weather.js';
import { esc, fmtDay, fmtNum, relDay } from '../util.js';

const f0 = (n) => fmtNum(n, 0);
const hourLabel = (h) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`);

export function openDaySheet(date, ctx) {
  const c = ctx();
  const w = S.weather;
  const day = w?.dayMap?.[date];
  const title = relDay(date, c.today) === 'Today' ? `Today, ${fmtDay(date).split(', ')[1]}` : fmtDay(date, { long: true });
  const sheet = openSheet({ title, className: 'day-sheet', cancelText: 'Done' });
  if (!day) {
    sheet.body.innerHTML = `<p class="lead">No forecast for this day yet${w ? '' : ' — weather hasn’t loaded'}.</p>`;
    return sheet;
  }
  const hours = w.hours.filter((h) => h.t.slice(0, 10) === date);
  const desc = describeCode(day.code);
  const v = E.dayVerdicts(c, date);
  const rh = hours.map((h) => h.rh).filter((x) => x != null);
  const winds = hours.map((h) => h.wind).filter((x) => x != null);
  const soil = day.soil;
  const verdict = (ok, label, text, ic) => `
    <div class="verdict ${ok ? 'ok' : 'no'}">
      <span class="verdict-ic">${icon(ic)}</span>
      <span class="verdict-main"><span class="verdict-label">${label}</span><span class="verdict-text">${esc(text)}</span></span>
      <span class="verdict-mark" aria-label="${ok ? 'Good' : 'Not ideal'}">${icon(ok ? 'check' : 'close')}</span>
    </div>`;
  const tempPts = hours.map((h) => ({ label: hourLabel(Number(h.t.slice(11, 13))), tick: hourLabel(Number(h.t.slice(11, 13))), value: h.temp }));
  const popPts = hours.map((h) => ({ label: `${hourLabel(Number(h.t.slice(11, 13)))} · ${h.rain > 0 ? `${fmtNum(h.rain, 2)}″` : 'no rain'}`, tick: hourLabel(Number(h.t.slice(11, 13))), value: h.pop ?? (h.rain > 0 ? 100 : 0) }));
  const every3 = hours.filter((_, i) => i % 3 === 0);
  sheet.body.innerHTML = `
    <div class="day-hero">
      <span class="day-ic">${icon(desc.icon)}</span>
      <div class="day-temps"><span class="day-hi">${f0(day.tMax)}°</span><span class="day-lo">${f0(day.tMin)}°</span></div>
      <div class="day-desc">${esc(desc.label)}</div>
    </div>
    <div class="day-facts">
      <div class="fact"><span class="fact-l">Rain</span><span class="fact-v">${fmtNum(day.rain || 0, 2)}″ · ${day.rainProb != null ? `${f0(day.rainProb)}%` : '–'}</span></div>
      <div class="fact"><span class="fact-l">Wind</span><span class="fact-v">${winds.length ? `up to ${f0(Math.max(...winds))} mph` : day.wind != null ? `${f0(day.wind)} mph` : '–'}</span></div>
      <div class="fact"><span class="fact-l">Humidity</span><span class="fact-v">${rh.length ? `${f0(Math.min(...rh))}–${f0(Math.max(...rh))}%` : '–'}</span></div>
      <div class="fact"><span class="fact-l">Soil temp</span><span class="fact-v">${soil != null ? `${f0(soil)}°F` : '–'}</span></div>
      <div class="fact fact-wide frost-${v.frost.level}"><span class="fact-l">Frost risk</span><span class="fact-v">${esc(v.frost.text)}</span></div>
      ${day.snow > 0 ? `<div class="fact fact-wide"><span class="fact-l">Snowfall</span><span class="fact-v">${fmtNum(day.snow, 1)}″</span></div>` : ''}
    </div>
    <h3 class="section-h">Lawn verdict</h3>
    <div class="verdicts">
      ${verdict(v.mow.ok, 'Mowing', v.mow.text, 'mow')}
      ${verdict(v.spray.ok, 'Spot spraying', v.spray.text, 'spray')}
      ${verdict(v.pull.ok, 'Pulling weeds', v.pull.text, 'hand')}
      ${verdict(v.feed.ok, 'Feeding', v.feed.text, 'bag')}
    </div>
    ${hours.length > 3 ? `
    <h3 class="section-h">Temperature</h3>
    <div class="card chart-card">${lineChart({ id: `t-${date}`, points: tempPts, unit: '°', ariaLabel: `Hourly temperature, ${f0(day.tMin)} to ${f0(day.tMax)} degrees` })}</div>
    <h3 class="section-h">Chance of rain</h3>
    <div class="card chart-card">${columnChart({ id: `p-${date}`, points: popPts, ariaLabel: `Hourly chance of rain, up to ${f0(Math.max(...popPts.map((p) => p.value || 0)))} percent` })}</div>
    <h3 class="section-h">Hour by hour</h3>
    <div class="card hour-table" role="table" aria-label="Hourly forecast">
      <div class="hr-row hr-head" role="row"><span role="columnheader">Time</span><span role="columnheader">Temp</span><span role="columnheader">Rain</span><span role="columnheader">Wind</span><span role="columnheader">Hum.</span><span role="columnheader">Soil</span></div>
      ${every3.map((h) => `<div class="hr-row" role="row">
        <span role="cell">${hourLabel(Number(h.t.slice(11, 13)))}</span>
        <span role="cell">${f0(h.temp)}°</span>
        <span role="cell">${h.pop != null ? `${f0(h.pop)}%` : '–'}${h.rain > 0 ? `<small class="hr-amt">${fmtNum(h.rain, 2)}″</small>` : ''}</span>
        <span role="cell">${h.wind != null ? f0(h.wind) : '–'}</span>
        <span role="cell">${h.rh != null ? `${f0(h.rh)}%` : '–'}</span>
        <span role="cell">${h.soil != null ? `${f0(h.soil)}°` : '–'}</span>
      </div>`).join('')}
    </div>
    <p class="hint">Wind in mph. Soil temperature is about 2½″ deep.</p>` : ''}`;
  bindCharts(sheet.body);
  return sheet;
}
