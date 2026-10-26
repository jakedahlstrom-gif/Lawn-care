// Season recap: full-screen story slides with the season's numbers. Tap the right side (or wait) for the
// next slide, the left side to go back, press and hold to pause, Escape or × to close.

import { icon, patternIcon } from '../icons.js';
import { seasonStats, trophies } from '../fun.js';
import { esc, fmtNum, fmtMoney, monthName } from '../util.js';

const SLIDE_MS = 6500;
const BATHTUB_GAL = 42;

const num = (v, d = 0) => `<b data-count="${v}" data-dec="${d}">${fmtNum(v, d)}</b>`;

function ringSvg(pct, mulchPct) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const arc = (p) => `${((p / 100) * C).toFixed(2)} ${C.toFixed(2)}`;
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    <circle cx="60" cy="60" r="${R}" class="ring-track" stroke-width="9"/>
    ${mulchPct > pct ? `<circle cx="60" cy="60" r="${R}" class="ring-mulch" stroke-width="9" stroke-dasharray="${arc(mulchPct)}"/>` : ''}
    ${pct > 0 ? `<circle cx="60" cy="60" r="${R}" class="ring-arc" stroke-width="9" stroke-dasharray="${arc(pct)}"/>` : ''}
  </svg>`;
}

function slides(s, list, today) {
  const out = [];
  const earned = list.filter((t) => t.earned);
  out.push(['cover', `
    <div class="st-k">${icon('sparkle')} Lawn IQ · Season recap</div>
    <div class="st-year">${s.year}</div>
    <div class="st-h">Your season on the lawn</div>
    <div class="st-foot">Tap to continue · hold to pause</div>`]);
  if (s.mows) {
    out.push(['mow', `
      <div class="st-k">${icon('mow')} Mowing</div>
      <div class="st-h">You mowed</div>
      <div class="st-big">${num(s.mows)}<small>${s.mows === 1 ? 'time' : 'times'}</small></div>
      <div class="st-grid">
        <div>${num(s.hours, 1)}<span>hours behind the mower</span></div>
        <div>${num(s.miles, 1)}<span>miles walked</span></div>
      </div>
      <div class="st-foot">About ${fmtNum(s.laps, 0)} laps of a running track${s.streak > 1 ? ` · longest streak ${s.streak} weeks in a row` : ''}.</div>`]);
  }
  if (s.favPattern) {
    out.push(['stripes', `
      <div class="st-k">${icon('zones')} Stripes</div>
      <div class="st-h">Your go-to stripes</div>
      <div class="st-pattern">${patternIcon(s.favPattern.angle, 150)}</div>
      <div class="st-m">${esc(s.favPattern.label)}</div>
      <div class="st-foot">${s.favCount} of ${s.mows} mows · ${s.patternsUsed} of 4 directions · switched ${s.switches} ${s.switches === 1 ? 'time' : 'times'}</div>`]);
  }
  if (s.feeds || s.nPer1000 > 0) {
    const pct = Math.min(100, (s.nPer1000 / (s.nTarget || 1)) * 100);
    const withMulch = Math.min(100, ((s.nPer1000 + s.mulchCredit) / (s.nTarget || 1)) * 100);
    out.push(['feed', `
      <div class="st-k">${icon('bag')} Feeding</div>
      <div class="st-h">You fed the lawn ${s.feeds} ${s.feeds === 1 ? 'time' : 'times'}</div>
      <div class="st-ring ring">${ringSvg(pct, withMulch)}<div class="ring-center">${num(s.nPer1000, 2)}<span class="ring-l">of ${fmtNum(s.nTarget, 1)} lb N<br>per 1k sq ft</span></div></div>
      <div class="st-foot">${s.products.length ? esc(s.products.map((p) => p.name).join(' · ')) : ''}${s.mulchCredit > 0 ? `${s.products.length ? '<br>' : ''}+ ~${fmtNum(s.mulchCredit, 2)} lb returned by mulched clippings` : ''}</div>`]);
  }
  if (s.gallons > 0) {
    out.push(['water', `
      <div class="st-k">${icon('water')} Watering</div>
      <div class="st-h">You watered</div>
      <div class="st-big">${num(Math.round(s.gallons))}<small>gallons</small></div>
      <div class="st-grid">
        <div>${num(Math.round(s.gallons / BATHTUB_GAL))}<span>bathtubs full</span></div>
        <div><b>${fmtMoney(s.waterCost)}</b><span>on the water bill</span></div>
      </div>
      <div class="st-foot">${s.rachioRuns ? `${s.rachioRuns} Rachio ${s.rachioRuns === 1 ? 'run' : 'runs'} counted automatically.` : 'Logged by hand.'}</div>`]);
  }
  if (s.busiestMonth != null) {
    const max = Math.max(...s.months, 1);
    const from = Math.min(3, s.months.findIndex((n) => n > 0));
    const to = Math.max(9, 11 - [...s.months].reverse().findIndex((n) => n > 0));
    const bars = [];
    for (let m = from; m <= to; m++) bars.push(`<span class="st-mo${m === s.busiestMonth ? ' on' : ''}"><i style="height:${((s.months[m] / max) * 100).toFixed(0)}%"></i><em>${monthName(m).slice(0, 1)}</em></span>`);
    out.push(['month', `
      <div class="st-k">${icon('plan')} Busiest month</div>
      <div class="st-m st-month">${monthName(s.busiestMonth)}</div>
      <div class="st-h">${s.busiestCount} ${s.busiestCount === 1 ? 'thing' : 'things'} logged</div>
      <div class="st-months">${bars.join('')}</div>
      <div class="st-foot">${s.logs} entries all season.</div>`]);
  }
  out.push(['trophies', `
    <div class="st-k">${icon('trophy')} Trophies</div>
    <div class="st-big">${num(earned.length)}<small>of ${list.length}</small></div>
    <div class="st-trophies">${list.map((t) => `<span class="${t.earned ? 'on' : ''}" title="${esc(t.title)}">${icon(t.icon)}</span>`).join('')}</div>
    <div class="st-foot">${earned.length ? esc(earned.slice(0, 4).map((t) => t.title).join(' · ')) : 'Plenty left to win.'}</div>`]);
  const over = Number(today.slice(5, 7)) >= 11 || Number(today.slice(0, 4)) > s.year;
  out.push(['outro', `
    <div class="st-k">${icon('leaf')} ${s.year}</div>
    <div class="st-h st-outro">${over ? 'Rest up. See you next spring.' : 'Keep it green — the season’s still going.'}</div>
    <button type="button" class="st-done" data-st="close">Done</button>`]);
  return out;
}

function countUp(slide) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  slide.querySelectorAll('[data-count]').forEach((el) => {
    const end = Number(el.dataset.count);
    const dec = Number(el.dataset.dec || 0);
    if (!Number.isFinite(end)) return;
    const t0 = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - t0) / 1100);
      el.textContent = fmtNum(end * (1 - (1 - k) ** 3), dec);
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

export function openWrapped(ctx, year) {
  const s = seasonStats(ctx, year);
  const list = trophies(s);
  const sl = slides(s, list, ctx.today);
  const back = document.activeElement;
  const wrap = document.createElement('div');
  wrap.className = 'story';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', `${year} season recap`);
  wrap.innerHTML = `
    <div class="st-bars" aria-hidden="true">${sl.map(() => '<span><i></i></span>').join('')}</div>
    <button type="button" class="st-close" data-st="close" aria-label="Close recap">${icon('close')}</button>
    ${sl.map(([cls, html], i) => `<section class="st-slide sl-${cls}" data-i="${i}" aria-hidden="true">${html}</section>`).join('')}
    <button type="button" class="st-tap st-prev" data-st="prev" aria-label="Previous"></button>
    <button type="button" class="st-tap st-next" data-st="next" aria-label="Next"></button>`;
  document.body.appendChild(wrap);
  document.documentElement.classList.add('sheet-open');
  const slidesEl = [...wrap.querySelectorAll('.st-slide')];
  const bars = [...wrap.querySelectorAll('.st-bars i')];
  let i = -1;
  let start = 0;
  let pausedAt = 0;
  let held = false;
  let raf = 0;
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    wrap.classList.remove('open');
    setTimeout(() => {
      wrap.remove();
      if (!document.querySelector('.sheet-wrap')) document.documentElement.classList.remove('sheet-open');
    }, 300);
    back?.focus?.({ preventScroll: true });
  };
  const go = (n) => {
    if (n >= sl.length) { close(); return; }
    i = Math.max(0, n);
    slidesEl.forEach((el, k) => { el.classList.toggle('on', k === i); el.setAttribute('aria-hidden', String(k !== i)); });
    bars.forEach((b, k) => { b.style.transform = `scaleX(${k < i ? 1 : 0})`; });
    wrap.dataset.slide = sl[i][0];
    countUp(slidesEl[i]);
    start = performance.now();
    pausedAt = 0;
  };
  const tick = (t) => {
    if (closed) return;
    if (!pausedAt) {
      const p = (t - start) / SLIDE_MS;
      if (bars[i]) bars[i].style.transform = `scaleX(${Math.min(1, p)})`;
      if (p >= 1 && i < sl.length - 1) go(i + 1);
    }
    raf = requestAnimationFrame(tick);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'ArrowRight') go(i + 1);
    if (e.key === 'ArrowLeft') go(i - 1);
  };
  document.addEventListener('keydown', onKey, true);
  // Press and hold anywhere pauses; a short tap on either side navigates.
  wrap.addEventListener('pointerdown', () => { pausedAt = performance.now(); held = false; setTimeout(() => { if (pausedAt) held = true; }, 260); });
  const resume = () => { if (pausedAt) { start += performance.now() - pausedAt; pausedAt = 0; } };
  wrap.addEventListener('pointerup', resume);
  wrap.addEventListener('pointercancel', resume);
  wrap.addEventListener('click', (e) => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    if (b.dataset.st === 'close') { close(); return; }
    if (held) { held = false; return; }
    go(i + (b.dataset.st === 'next' ? 1 : -1));
  });
  void wrap.offsetHeight;
  wrap.classList.add('open');
  go(0);
  raf = requestAnimationFrame(tick);
  wrap.querySelector('.st-close').focus({ preventScroll: true });
  return { close, el: wrap };
}
