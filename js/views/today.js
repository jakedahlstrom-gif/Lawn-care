// Today tab: safety timers, next mow, alerts, weather, and this week's watering.

import { S } from '../store.js';
import * as E from '../engine.js';
import { icon } from '../icons.js';
import { describeCode } from '../weather.js';
import { esc, fmtDay, fmtNum, fmtMoney, fmtTime, fmtMonthDay, daysBetween, WEEKDAYS, nobreak } from '../util.js';

const f0 = (n) => fmtNum(n, 0);

function timersHtml(c) {
  const list = E.activeTimers(S.logs, c.now);
  if (!list.length) return '';
  const ic = { keepOff: 'shield', noMow: 'mow', noRain: 'drop' };
  return `<section class="timers" aria-label="Safety timers">${list.map((t) => `
    <div class="timer timer-${t.kind}">${icon(ic[t.kind])}<div><div class="timer-text">${esc(t.text)}</div>${t.product ? `<div class="timer-sub">${esc(t.product)}</div>` : ''}</div></div>`).join('')}</section>`;
}

function mowDateLine(date, today) {
  const n = daysBetween(today, date);
  return `${fmtMonthDay(date)}${n >= 2 ? ` · in ${n} days` : ''}`;
}

function mowHtml(c) {
  const r = E.mowRecommendation(c);
  if (r.status === 'off') {
    return `<section class="card mow-card">
      <div class="kicker">${icon('mow')} Mowing</div>
      <div class="mow-day">${esc(r.title)}</div>
      <p class="reason">${esc(r.reason)}</p>
    </section>`;
  }
  const heights = S.settings.mower.heights;
  const skip = r.status === 'skip';
  return `<section class="card mow-card" data-testid="mow-card">
    <div class="kicker">${icon('mow')} ${skip ? 'Mowing' : 'Next mow'} · ${esc(r.season.label)}</div>
    <div class="mow-day">${skip ? 'Skip this week' : esc(r.dayLabel)}</div>
    <div class="mow-date">${skip ? `Next check ${esc(fmtDay(r.date))}` : esc(mowDateLine(r.date, c.today))}</div>
    <div class="stats">
      <div class="stat"><div class="stat-v" data-testid="mow-pos">${r.position}</div><div class="stat-l">Position</div></div>
      <div class="stat"><div class="stat-v" data-testid="mow-height">${heights[r.position - 1]}″</div><div class="stat-l">Height</div></div>
      <div class="stat"><div class="stat-v">${r.lastDate ? `${fmtNum(r.growth, 1)}″` : '—'}</div><div class="stat-l">Growth</div></div>
    </div>
    <p class="reason" data-testid="mow-reason">${esc(r.reason)}</p>
    ${r.extra ? `<div class="banner banner-info">${icon('leaf')}<div><strong>Optional extra mow:</strong> ${esc(r.extra.reason)} Position ${r.extra.pos} (${r.extra.h}″).</div></div>` : ''}
    ${r.notes.map((n) => `<p class="note">${icon('info', 'note-ic')}${esc(n)}</p>`).join('')}
    ${r.calibration.count ? `<p class="hint">Growth model tuned by ${r.calibration.count} of your mow notes (${r.calibration.factor >= 1 ? '+' : ''}${f0((r.calibration.factor - 1) * 100)}%).</p>` : ''}
    <button type="button" class="btn btn-tinted" data-action="log" data-type="mow">${icon('plus')} Log mow</button>
  </section>`;
}

function alertsHtml(c) {
  const list = E.alerts(c);
  if (!list.length) return '';
  return `<section class="alerts" aria-label="Alerts">${list.map((a) => {
    const attrs = a.action ? `data-action="alert" data-alert='${esc(JSON.stringify(a.action))}'` : '';
    const tag = a.action ? 'button type="button"' : 'div';
    return `<${tag} class="alert alert-${a.level}" ${attrs} data-id="${a.id}">
      <span class="alert-ic">${icon(a.icon)}</span>
      <span class="alert-main"><span class="alert-title">${esc(nobreak(a.title))}</span><span class="alert-body">${esc(nobreak(a.body))}</span></span>
      ${a.action ? icon('chev', 'chev') : ''}
    </${a.action ? 'button' : 'div'}>`;
  }).join('')}</section>`;
}

function weatherHtml(c) {
  const w = S.weather;
  const st = S.weatherState;
  if (!w) {
    return `<section class="card weather">
      <div class="kicker">${icon('cloud')} Weather</div>
      <p class="reason">${st === 'loading' ? 'Loading the forecast…' : `Weather unavailable${S.weatherError ? ` (${esc(S.weatherError)})` : ''}. Recommendations use typical Prior Lake weather until it loads.`}</p>
      <button type="button" class="btn btn-plain" data-action="refresh-weather">${icon('refresh')} Try again</button>
    </section>`;
  }
  const cond = c.cond;
  const today = w.dayMap[c.today];
  const cur = w.current;
  const desc = describeCode(cur?.code ?? today?.code);
  const days = cond.next.slice(0, 7);
  const ageMin = Math.round((Date.now() - w.fetchedAt) / 60000);
  const stale = ageMin > 90;
  return `<section class="card weather" data-testid="weather">
    <div class="kicker">${icon('cloud')} Weather · ${esc(S.settings.location.name)}</div>
    <div class="wx-now">
      <span class="wx-ic">${icon(desc.icon)}</span>
      <span class="wx-temp">${cur?.temp != null ? `${f0(cur.temp)}°` : today ? `${f0(today.tMax)}°` : '–'}</span>
      <span class="wx-desc"><span>${esc(desc.label)}</span>${today ? `<span class="muted">H ${f0(today.tMax)}° · L ${f0(today.tMin)}°</span>` : ''}</span>
    </div>
    <div class="metrics">
      <div class="metric"><span class="metric-l">Soil (24-h avg)</span><span class="metric-v" data-testid="soil24">${cond.soil24 != null ? `${f0(cond.soil24)}°F` : '–'}</span></div>
      <div class="metric"><span class="metric-l">Rain, past 7 days</span><span class="metric-v">${fmtNum(cond.rainPast7, 2)}″</span></div>
      <div class="metric"><span class="metric-l">ET, past 7 days</span><span class="metric-v">${fmtNum(cond.past.reduce((t, d) => t + (d.et0 || 0), 0), 2)}″</span></div>
      <div class="metric"><span class="metric-l">Rain, next 7 days</span><span class="metric-v">${fmtNum(cond.rainNext7, 2)}″</span></div>
    </div>
    <div class="forecast" role="list">${days.map((d) => {
      const dd = describeCode(d.code);
      return `<div class="fc-day ${d.date === c.today ? 'is-today' : ''}" role="listitem" aria-label="${esc(fmtDay(d.date))}: high ${f0(d.tMax)}, low ${f0(d.tMin)}, rain ${fmtNum(d.rain, 2)} inches">
        <span class="fc-name">${d.date === c.today ? 'Today' : WEEKDAYS[new Date(`${d.date}T12:00`).getDay()]}</span>
        <span class="fc-ic">${icon(d.est ? 'cloud' : dd.icon)}</span>
        <span class="fc-hi">${f0(d.tMax)}°</span>
        <span class="fc-lo">${f0(d.tMin)}°</span>
        <span class="fc-rain ${d.rain >= 0.1 ? 'wet' : ''}">${d.rain >= 0.01 ? `${fmtNum(d.rain, 2)}″` : '—'}</span>
      </div>`;
    }).join('')}</div>
    <div class="wx-foot">
      <span class="${stale ? 'warn-text' : 'muted'}">${st === 'loading' ? 'Updating…' : `${stale ? 'Offline · ' : ''}Updated ${ageMin < 1 ? 'just now' : fmtTime(w.fetchedAt)}${stale && ageMin > 1440 ? ` (${fmtDay(new Date(w.fetchedAt).toISOString().slice(0, 10))})` : ''}`} · Open-Meteo</span>
      <button type="button" class="icon-btn" data-action="refresh-weather" aria-label="Refresh weather">${icon('refresh')}</button>
    </div>
  </section>`;
}

function waterHtml(c) {
  const p = E.wateringPlan(c);
  const r = p.rate;
  const tierName = `Tier ${r.idx + 1}`;
  if (p.off) {
    return `<section class="card">
      <div class="kicker">${icon('drop')} Watering</div>
      <p class="reason">${esc(p.reason)}</p>
    </section>`;
  }
  const lawnRows = p.rows.filter((x) => x.inches != null);
  const sloped = lawnRows.filter((x) => x.cycles);
  return `<section class="card" data-testid="water">
    <div class="kicker">${icon('drop')} Watering this week</div>
    <div class="big-line"><span class="big-num">${fmtNum(p.need, 2)}″</span><span class="muted">from sprinklers${p.est ? ' (typical weather)' : ''}</span></div>
    <p class="reason">Lawn uses ~${fmtNum(p.etc, 2)}″ over 7 days; ${fmtNum(p.rain, 2)}″ of rain is forecast. About ${f0(p.gallons)} gal ≈ <strong>${fmtMoney(p.cost)}</strong> at ${fmtMoney(r.per1000)}/1,000 (${tierName}${r.sewer ? ' + sewer' : ''}).</p>
    ${sloped.length ? `<p class="note">${icon('slope', 'note-ic')}Cycle and soak on slopes: ${sloped.map((x) => `${esc(x.zone.name)} ${x.cycles.cycles}×${f0(x.cycles.each)} min`).join(', ')}, 30–60 min soak between (Rachio Smart Cycle).</p>` : ''}
    <details class="zone-water">
      <summary>By zone</summary>
      <div class="zw-table">${p.rows.map((x) => `
        <div class="zw-row"><span>${esc(x.zone.name)}${x.zone.lawn === false ? ' <span class="tag">non-lawn</span>' : ''}</span>
        <span>${f0(x.minutes)} min</span><span>${f0(x.gallons)} gal</span></div>`).join('')}</div>
      <p class="hint">Your Rachio adjusts on its own; use this as a cross-check on runtime and cost.</p>
    </details>
  </section>`;
}

function upNextHtml(c) {
  const order = { now: 0, late: 0, waiting: 1, soon: 2 };
  const list = c.tasks.filter((t) => order[t.status] != null).sort((a, b) => order[a.status] - order[b.status]).slice(0, 3);
  if (!list.length) return '';
  const label = { now: 'Now', late: 'Late', waiting: 'Waiting', soon: 'Soon' };
  return `<h2 class="section-h">Up next</h2>
    <div class="group">${list.map((t) => `
      <button type="button" class="row row-btn" data-action="task" data-id="${t.id}">
        <span class="row-main"><span class="row-title">${esc(t.title)}</span><span class="row-sub">${esc(t.product ? `${t.product.name} · Elite ${t.product.elite || '–'} · ${fmtNum(t.lbs, 1)} ${t.product.unit}` : t.trigger.text)}</span></span>
        <span class="badge badge-${t.status}">${label[t.status]}</span>${icon('chev', 'chev')}
      </button>`).join('')}</div>`;
}

export function renderToday(el, c) {
  el.innerHTML = `
    <header class="page-head">
      <h1 class="large-title">Today</h1>
      <p class="subtitle">${esc(fmtDay(c.today, { long: true }))}</p>
    </header>
    ${timersHtml(c)}
    ${mowHtml(c)}
    ${alertsHtml(c)}
    ${weatherHtml(c)}
    ${waterHtml(c)}
    ${upNextHtml(c)}`;
}
