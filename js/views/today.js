// Today tab: photo header, next mow, this week (water + soil timing), today/tomorrow/up-next tasks, watering +
// conditions, forecast, shopping.
// In Winter Mode the winter screen replaces it.

import { S } from '../store.js';
import * as E from '../engine.js';
import * as Season from '../season.js';
import { icon, patternIcon } from '../icons.js';
import { describeCode } from '../weather.js';
import { MOW_PATTERNS } from '../defaults.js';
import { onLongPress, popover } from '../ui.js';
import { renderWinter } from './winter.js';
import { rachioStatusText, rachioState } from './rachio.js';
import { esc, fmtDay, fmtNum, fmtMoney, fmtTime, fmtMonthDay, daysBetween, WEEKDAYS, nobreak } from '../util.js';

const f0 = (n) => fmtNum(n, 0);
export const BADGES = { today: 'Do today', week: 'This week', optional: 'Optional', scheduled: 'Scheduled' };

function greeting(now) {
  const h = new Date(now).getHours();
  const part = h < 5 ? 'Good evening' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const name = (S.settings.profile?.name || '').trim();
  return name ? `${part}, ${name}` : part;
}

/** Photo header shared by Today and the winter screen. */
export function heroHtml(c, { summary, feedLine, feedOpen = false, winter = false }) {
  const photo = S.headerPhoto?.dataUrl || 'img/header.jpg';
  const tone = S.headerPhoto?.tone || 'light';
  return `<header class="hero tone-${tone}${winter ? ' is-winter' : ''}">
    <div class="hero-img" style="background-image:url('${photo.replace(/'/g, '%27')}')" role="img" aria-label="Header photo"></div>
    <div class="hero-scrim"></div>
    <div class="hero-content">
      <div class="hero-top">
        <button type="button" class="hero-loc" data-action="yard-section" data-id="location">${icon('pin')}<span>${esc(S.settings.location.name)}</span>${icon('chev', 'chev')}</button>
        <div class="hero-actions">
          <button type="button" class="hero-pill ${winter ? 'on' : ''}" data-action="toggle-winter" aria-pressed="${winter}" data-testid="winter-toggle">${icon('snow')}<span>Winter</span></button>
          <button type="button" class="hero-round" data-action="settings" aria-label="Settings">${icon('gear')}</button>
        </div>
      </div>
      <h1 class="hero-title" data-testid="greeting">${esc(greeting(c.now))}</h1>
      <p class="hero-sum" data-testid="summary">${esc(summary)}</p>
      ${feedLine ? `<div class="hero-feed ${feedOpen ? 'open' : ''}" data-testid="feed-line">${icon(winter ? 'thermo' : 'bag')}<span>${esc(nobreak(feedLine))}</span></div>` : ''}
    </div>
  </header>`;
}

function timersHtml(c) {
  const list = E.activeTimers(S.logs, c.now);
  if (!list.length) return '';
  const ic = { keepOff: 'shield', noMow: 'mow', noRain: 'drop' };
  return `<section class="timers" aria-label="Safety timers">${list.map((t) => `
    <div class="timer timer-${t.kind}">${icon(ic[t.kind])}<div><div class="timer-text">${esc(t.text)}</div>${t.product ? `<div class="timer-sub">${esc(nobreak(t.product))}</div>` : ''}</div></div>`).join('')}</section>`;
}

export function promptHtml(c) {
  const p = Season.winterPrompt(c);
  if (!p) return '';
  return `<section class="card prompt-card" data-testid="winter-prompt">
    <div class="prompt-main">${icon(p.action === 'on' ? 'snow' : 'leaf')}<div><strong>${esc(p.title)}</strong><p>${esc(p.text)}</p></div></div>
    <div class="prompt-actions">
      <button type="button" class="btn btn-small btn-plain" data-action="dismiss-prompt" data-key="${esc(p.key)}">Not now</button>
      <button type="button" class="btn btn-small btn-filled" data-action="${p.action === 'on' ? 'winter-on' : 'winter-off'}">${p.action === 'on' ? 'Turn on' : 'Turn off'}</button>
    </div>
  </section>`;
}

function mowHtml(c, r) {
  if (r.status === 'off') {
    return `<section class="card mow-hero" data-testid="mow-card">
      <div class="kicker">${icon('mow')} Mowing</div>
      <div class="mow-day">${esc(r.title)}</div>
      <p class="reason">${esc(r.reason)}</p>
    </section>`;
  }
  const heights = S.settings.mower.heights;
  const skip = r.status === 'skip';
  const n = daysBetween(c.today, r.date);
  const pat = MOW_PATTERNS[r.pattern] || MOW_PATTERNS[0];
  return `<section class="card mow-hero" data-testid="mow-card">
    <div class="mow-top">
      <div class="mow-when">
        <div class="kicker">${icon('mow')} ${skip ? 'Mowing' : 'Next mow'} · ${esc(r.season.label)}</div>
        <div class="mow-day">${skip ? 'Skip this week' : esc(r.dayLabel)}</div>
        <div class="mow-date">${skip ? `Next check ${esc(fmtDay(r.date))}` : `${fmtMonthDay(r.date)}${n >= 2 ? ` · in ${n} days` : ''}`}</div>
      </div>
      <button type="button" class="pattern-btn" data-testid="pattern" data-pattern="${pat.id}" aria-label="Mowing pattern: ${esc(pat.label)}. Press and hold for details.">${patternIcon(pat.angle, 48)}</button>
    </div>
    <div class="mow-stats">
      <span class="mstat"><span class="mstat-v" data-testid="mow-pos">${r.position}</span><span class="mstat-l">Position</span></span>
      <span class="mstat"><span class="mstat-v" data-testid="mow-height">${heights[r.position - 1]}″</span><span class="mstat-l">Height</span></span>
      <span class="mstat"><span class="mstat-v">${r.lastDate ? `${fmtNum(r.growth, 1)}″` : '—'}</span><span class="mstat-l">Growth</span></span>
    </div>
    <p class="reason" data-testid="mow-reason">${esc(r.reason)}</p>
    ${r.extra ? `<div class="banner banner-info">${icon('leaf')}<div><strong>Optional extra mow:</strong> ${esc(r.extra.reason)} Position ${r.extra.pos} (${r.extra.h}″).</div></div>` : ''}
    ${r.notes.map((t) => `<p class="note">${icon('info', 'note-ic')}${esc(t)}</p>`).join('')}
    <button type="button" class="btn btn-primary" data-action="log" data-type="mow">${icon('plus')} Log mow</button>
  </section>`;
}

export function taskRow(item) {
  return `<button type="button" class="task-row" data-action="agenda" data-item='${esc(JSON.stringify(item.action || {}))}' data-id="${esc(item.id)}">
    <span class="task-ic">${icon(item.icon || 'leaf')}</span>
    <span class="task-main"><span class="task-title">${esc(item.title)}</span><span class="task-reason">${esc(nobreak(item.reason))}</span></span>
    <span class="badge badge-${item.badge}">${BADGES[item.badge]}</span>
    ${icon('chev', 'chev')}
  </button>`;
}

function sectionsHtml(a) {
  const n = a.today.length;
  return `
    <section class="agenda" data-testid="today-section">
      <div class="sec-row"><h2 class="sec-title">Today</h2><span class="sec-aside">${n ? `${n} ${n === 1 ? 'thing' : 'things'} worth doing` : 'Nothing pressing'}</span></div>
      <div class="list-card">${n ? a.today.map(taskRow).join('') : `<div class="task-empty">${icon('check')}<span>Nothing needs doing today beyond the mow plan.</span></div>`}</div>
    </section>
    ${a.tomorrow.length ? `<section class="agenda" data-testid="tomorrow-section">
      <div class="sec-row"><h2 class="sec-title">Tomorrow</h2></div>
      <div class="list-card">${a.tomorrow.map(taskRow).join('')}</div>
    </section>` : ''}`;
}

const ADVICE_ICON = { water: 'water', skip: 'check', hold: 'rain' };
const ALERT_BADGE = { now: 'now', soon: 'soon', later: 'later', late: 'missed' };

/** This Week: rain behind and ahead, water lost to evapotranspiration, soil now, the watering call and soil timing. */
function weekHtml(wk, alerts) {
  if (!wk.available) {
    return `<button type="button" class="card week-card week-empty" data-action="refresh-weather" data-testid="this-week">
      <span class="kicker">${icon('drop')} This week</span>
      <span class="reason">${S.weatherState === 'loading' ? 'Loading weather…' : 'Weather unavailable — tap to retry'}</span>
    </button>`;
  }
  const a = wk.advice;
  const inches = (n) => `${fmtNum(n, 2)}″`;
  const stat = (id, label, value, sub) => `<div class="wk-stat"><span class="wk-l">${label}</span><span class="wk-v" data-testid="week-${id}">${value}</span><span class="wk-s">${sub}</span></div>`;
  const chance = wk.ahead.total >= 0.01 && wk.ahead.chance != null ? ` · ${f0(wk.ahead.chance)}%` : '';
  return `<section class="card week-card" data-testid="this-week">
    <div class="kicker">${icon('drop')} This week</div>
    <div class="week-call call-${a.status}" data-testid="water-advice" data-status="${a.status}"><span class="call-ic">${icon(ADVICE_ICON[a.status])}</span><span>${esc(a.title)}</span></div>
    <div class="wk-grid">
      ${stat('rain', 'Rain', inches(wk.rain), wk.watered > 0 ? `last 7 days · +${inches(wk.watered)} watered` : 'last 7 days')}
      ${stat('ahead', 'Rain forecast', inches(wk.ahead.total), `next 3 days${chance}`)}
      ${stat('et', 'Evapotranspiration', inches(wk.et), 'water lost, 7 days')}
      ${stat('soil', 'Soil temperature', wk.soilNow != null ? `${f0(wk.soilNow)}°F` : '–', `now${wk.soil24 != null ? ` · 24-h avg ${f0(wk.soil24)}°` : ''}`)}
    </div>
    <p class="reason" data-testid="water-reason">${esc(a.reason)}</p>
    ${alerts.length ? `<div class="soil-alerts" data-testid="soil-alerts">
      <div class="sa-head">${icon('thermo')}<span>Soil timing · bluegrass</span></div>
      ${alerts.map((x) => `<button type="button" class="sa-row" data-action="feeding" data-id="${esc(x.feedingId)}" data-alert="${x.id}">
        <span class="sa-main"><span class="sa-title">${esc(x.title)}</span><span class="sa-text">${esc(nobreak(x.text))}</span></span>
        <span class="badge badge-${ALERT_BADGE[x.level]}">${esc(x.badge)}</span>
      </button>`).join('')}
    </div>` : ''}
  </section>`;
}

function waterCardHtml(c) {
  const w = E.waterWeek(c);
  const status = rachioStatusText();
  const rachioOn = w.rachio || rachioState() !== 'off';
  const parts = [`Rain ${fmtNum(w.rain, 2)}″`];
  if (rachioOn) parts.push(`Rachio ${fmtNum(w.sprinklers, 2)}″`);
  if (!rachioOn || w.logged > 0) parts.push(`${rachioOn ? 'Hand' : 'Logged'} ${fmtNum(w.logged, 2)}″`);
  return `<button type="button" class="card mini water-card" data-action="my-zones" data-testid="water">
    <span class="mini-kicker">${icon('drop')}<span>Watering</span></span>
    <span class="mini-big"><span data-testid="water-total">${fmtNum(w.total, 2)}″</span></span>
    <span class="mini-sub">past 7 days</span>
    <span class="mini-lines" data-testid="water-split">${parts.join(' · ')}</span>
    <span class="mini-lines">${f0(w.gallons)} gal · ${fmtMoney(w.cost)}</span>
    <span class="mini-note" data-rachio-status data-testid="rachio-status">${esc(status)}</span>
  </button>`;
}

function condCardHtml(c, rain7) {
  const w = S.weather;
  const today = w?.dayMap?.[c.today];
  const cur = w?.current;
  const desc = describeCode(cur?.code ?? today?.code);
  if (!w) {
    return `<button type="button" class="card mini cond-card" data-action="refresh-weather">
      <div class="mini-kicker">${icon('sun')}<span>Conditions</span></div>
      <div class="mini-big">–</div>
      <div class="mini-lines">${S.weatherState === 'loading' ? 'Loading weather…' : 'Weather unavailable — tap to retry'}</div>
    </button>`;
  }
  return `<button type="button" class="card mini cond-card" data-action="day" data-date="${c.today}" data-testid="conditions">
    <div class="mini-kicker">${icon(desc.icon)}<span>Conditions</span></div>
    <div class="mini-big">${cur?.temp != null ? `${f0(cur.temp)}°` : today ? `${f0(today.tMax)}°` : '–'}<span class="mini-desc">${esc(desc.label)}</span></div>
    <div class="mini-lines">${today ? `H ${f0(today.tMax)}° · L ${f0(today.tMin)}°` : ''}</div>
    <div class="mini-split"><span>Soil <b data-testid="soil24">${c.cond.soil24 != null ? `${f0(c.cond.soil24)}°` : '–'}</b></span><span>Rain 7d <b>${fmtNum(rain7, 2)}″</b></span></div>
  </button>`;
}

export function forecastHtml(c) {
  const w = S.weather;
  if (!w) return '';
  const days = c.cond.next.slice(0, 7);
  const ageMin = Math.round((Date.now() - w.fetchedAt) / 60000);
  const stale = ageMin > 90;
  return `<section class="card forecast-card" data-testid="weather">
    <div class="sec-row inner"><span class="mini-kicker">${icon('plan')}<span>7-day forecast</span></span>
      <button type="button" class="icon-btn small" data-action="refresh-weather" aria-label="Refresh weather">${icon('refresh')}</button></div>
    <div class="forecast" role="list">${days.map((d) => {
      const dd = describeCode(d.code);
      return `<button type="button" class="fc-day ${d.date === c.today ? 'is-today' : ''}" role="listitem" data-action="day" data-date="${d.date}" aria-label="${esc(fmtDay(d.date))}: high ${f0(d.tMax)}, low ${f0(d.tMin)}, rain ${fmtNum(d.rain, 2)} inches. Tap for details.">
        <span class="fc-name">${d.date === c.today ? 'Today' : WEEKDAYS[new Date(`${d.date}T12:00`).getDay()]}</span>
        <span class="fc-ic">${icon(d.est ? 'cloud' : (d.snow > 0.1 ? 'snowcloud' : dd.icon))}</span>
        <span class="fc-hi">${f0(d.tMax)}°</span>
        <span class="fc-lo">${f0(d.tMin)}°</span>
        <span class="fc-rain ${d.rain >= 0.1 ? 'wet' : ''}">${d.rain >= 0.01 ? `${fmtNum(d.rain, 2)}″` : '—'}</span>
      </button>`;
    }).join('')}</div>
    <div class="wx-foot"><span class="${stale ? 'warn-text' : 'muted'}">${S.weatherState === 'loading' ? 'Updating…' : `${stale ? 'Offline · ' : ''}Updated ${ageMin < 1 ? 'just now' : fmtTime(w.fetchedAt)}`} · Open-Meteo · tap a day for details</span></div>
  </section>`;
}

export function shoppingHtml(title, plans, testid = 'shopping') {
  if (!plans || !plans.length) return '';
  return `<section class="card shop-card" data-testid="${testid}">
    <div class="mini-kicker">${icon('cart')}<span>${esc(title)}</span></div>
    <ul class="shop-list">${plans.map((p) => `<li class="${p.enough ? 'ok' : ''}">${icon(p.enough ? 'check' : 'cart')}<span>${esc(nobreak(p.text))}${p.uses ? ` <span class="muted">(${esc(p.uses.join(' + '))})</span>` : ''}</span></li>`).join('')}</ul>
  </section>`;
}

function upNextHtml(a) {
  if (!a.next.length) return '';
  return `<section class="agenda" data-testid="upnext-section">
    <div class="sec-row"><h2 class="sec-title">Up next</h2><button type="button" class="sec-aside link" data-action="nav" data-tab="calendar">Calendar ${icon('chev', 'chev')}</button></div>
    <div class="list-card">${a.next.slice(0, 6).map(taskRow).join('')}</div>
  </section>`;
}

export function renderToday(el, c) {
  if (S.settings.winter?.on) { renderWinter(el, c); return; }
  const rec = E.mowRecommendation(c);
  const head = Season.feedingHeadline(c, c.feedings);
  const a = Season.agenda(c);
  const shop = Season.feedingShopping(c, c.feedings);
  const week = E.thisWeek(c);
  const rain7 = week.available ? week.rain : c.cond.rainPast7;
  const bits = [];
  if (rec.status !== 'off') bits.push(`${S.settings.mower.heights[rec.position - 1]}″ target height`);
  if (c.cond.soil24 != null) bits.push(`${f0(c.cond.soil24)}°F soil`);
  bits.push(`${fmtNum(rain7, 2)}″ rain (7d)`);
  el.innerHTML = `
    ${heroHtml(c, { summary: bits.join(' · '), feedLine: head.text, feedOpen: head.open })}
    <div class="page-body">
      ${promptHtml(c)}
      ${timersHtml(c)}
      ${mowHtml(c, rec)}
      ${weekHtml(week, Season.soilAlerts(c))}
      ${sectionsHtml(a)}
      <div class="pair">${waterCardHtml(c)}${condCardHtml(c, rain7)}</div>
      ${forecastHtml(c)}
      ${shop ? shoppingHtml(`Shopping list · ${shop.feeding.title}`, shop.items) : ''}
      ${upNextHtml(a)}
    </div>`;
  const pb = el.querySelector('.pattern-btn');
  if (pb) onLongPress(pb, () => popover(pb, E.patternText(Number(pb.dataset.pattern))));
}
