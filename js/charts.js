// Small inline-SVG charts: a single-series line (with optional reference line and forecast segment)
// and a single-series column strip. Each chart carries a crosshair/tap readout; values are also in a table.

import { esc } from './util.js';

const W = 340;

/**
 * Line chart for one series. points: [{ label, value, future? }]. Returns HTML; call bindChart() after insert.
 * refLine: { value, label } draws a thin threshold line.
 */
export function lineChart({ id, points, height = 120, unit = '°', refLine = null, yPad = 4, area = true, ariaLabel }) {
  const vals = points.map((p) => p.value).filter((v) => v != null);
  if (vals.length < 2) return '<p class="hint">Not enough data for a chart yet.</p>';
  let lo = Math.min(...vals, refLine ? refLine.value : Infinity);
  let hi = Math.max(...vals, refLine ? refLine.value : -Infinity);
  lo = Math.floor(lo - yPad);
  hi = Math.ceil(hi + yPad);
  const top = 10;
  const bottom = height - 22;
  const left = 30;
  const right = W - 12;
  const x = (i) => left + ((right - left) * i) / (points.length - 1);
  const y = (v) => bottom - ((v - lo) / (hi - lo || 1)) * (bottom - top);
  const ticks = niceTicks(lo, hi, 4);
  const pathFor = (pts) => pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const indexed = points.map((p, i) => ({ ...p, i })).filter((p) => p.value != null);
  const past = indexed.filter((p) => !p.future);
  const future = indexed.filter((p, k) => p.future || (indexed[k + 1] && indexed[k + 1].future && !p.future));
  const last = past[past.length - 1] || indexed[indexed.length - 1];
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));
  return `<div class="chart" id="${esc(id)}" data-chart='${esc(JSON.stringify({ points: points.map((p) => [p.label, p.value]), unit, left, right, n: points.length }))}' tabindex="0" role="img" aria-label="${esc(ariaLabel || 'Chart')}">
    <svg viewBox="0 0 ${W} ${height}" class="chart-svg" aria-hidden="true">
      ${ticks.map((t) => `<line x1="${left}" x2="${right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" class="grid"/><text x="${left - 6}" y="${(y(t) + 3.5).toFixed(1)}" class="axis" text-anchor="end">${t}${unit}</text>`).join('')}
      ${refLine ? `<line x1="${left}" x2="${right}" y1="${y(refLine.value).toFixed(1)}" y2="${y(refLine.value).toFixed(1)}" class="ref"/><text x="${right}" y="${(y(refLine.value) - 4).toFixed(1)}" class="axis ref-label" text-anchor="end">${esc(refLine.label)}</text>` : ''}
      ${area && past.length > 1 ? `<path d="${pathFor(past)}L${x(past[past.length - 1].i).toFixed(1)},${bottom}L${x(past[0].i).toFixed(1)},${bottom}Z" class="area"/>` : ''}
      ${past.length > 1 ? `<path d="${pathFor(past)}" class="line"/>` : ''}
      ${future.length > 1 ? `<path d="${pathFor(future)}" class="line future"/>` : ''}
      ${points.map((p, i) => (i % labelEvery === 0 ? `<text x="${x(i).toFixed(1)}" y="${height - 6}" class="axis" text-anchor="middle">${esc(p.tick ?? p.label)}</text>` : '')).join('')}
      ${last ? `<circle cx="${x(last.i).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4.5" class="dot"/>` : ''}
      <line class="xhair" x1="0" x2="0" y1="${top}" y2="${bottom}" visibility="hidden"/>
      <circle class="xdot" r="4.5" cx="0" cy="0" visibility="hidden"/>
      <rect class="hit" x="${left - 10}" y="0" width="${right - left + 20}" height="${height}" fill="transparent"/>
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

/** Column strip for one series (e.g., chance of rain by hour), 0..max. */
export function columnChart({ id, points, height = 64, max = 100, unit = '%', ariaLabel }) {
  const top = 6;
  const bottom = height - 18;
  const left = 30;
  const right = W - 12;
  const slot = (right - left) / points.length;
  const bw = Math.min(24, Math.max(2, slot - 2));
  const y = (v) => bottom - (Math.max(0, Math.min(max, v || 0)) / max) * (bottom - top);
  const labelEvery = Math.max(1, Math.ceil(points.length / 5));
  return `<div class="chart" id="${esc(id)}" data-chart='${esc(JSON.stringify({ points: points.map((p) => [p.label, p.value]), unit, left, right, n: points.length, bars: true }))}' tabindex="0" role="img" aria-label="${esc(ariaLabel || 'Chart')}">
    <svg viewBox="0 0 ${W} ${height}" class="chart-svg" aria-hidden="true">
      <line x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}" class="grid"/>
      <text x="${left - 6}" y="${top + 6}" class="axis" text-anchor="end">${max}${unit}</text>
      ${points.map((p, i) => {
        const h = bottom - y(p.value);
        const x0 = left + slot * i + (slot - bw) / 2;
        return h > 0.5 ? `<path d="${barPath(x0, bottom, bw, h)}" class="bar"/>` : '';
      }).join('')}
      ${points.map((p, i) => (i % labelEvery === 0 ? `<text x="${(left + slot * i + slot / 2).toFixed(1)}" y="${height - 4}" class="axis" text-anchor="middle">${esc(p.tick ?? p.label)}</text>` : '')).join('')}
      <line class="xhair" x1="0" x2="0" y1="${top}" y2="${bottom}" visibility="hidden"/>
      <rect class="hit" x="${left}" y="0" width="${right - left}" height="${height}" fill="transparent"/>
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

/** Column with a 4px rounded data end, square at the baseline. */
function barPath(x, base, w, h) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${base}V${base - h + r}Q${x},${base - h} ${x + r},${base - h}H${x + w - r}Q${x + w},${base - h} ${x + w},${base - h + r}V${base}Z`;
}

function niceTicks(lo, hi, count) {
  const span = hi - lo || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi + 1e-9; t += step) out.push(Math.round(t));
  return out;
}

/** Crosshair + readout on pointer move/tap and arrow keys. */
export function bindCharts(root) {
  root.querySelectorAll('.chart[data-chart]').forEach((el) => {
    if (el._bound) return;
    el._bound = true;
    const meta = JSON.parse(el.dataset.chart);
    const svg = el.querySelector('svg');
    const tip = el.querySelector('.chart-tip');
    const xh = el.querySelector('.xhair');
    const xd = el.querySelector('.xdot');
    const line = el.querySelector('.line');
    let idx = -1;
    const show = (i) => {
      idx = Math.max(0, Math.min(meta.n - 1, i));
      const vb = svg.viewBox.baseVal;
      const slot = (meta.right - meta.left) / (meta.bars ? meta.n : Math.max(1, meta.n - 1));
      const xv = meta.bars ? meta.left + slot * idx + slot / 2 : meta.left + slot * idx;
      xh.setAttribute('x1', xv);
      xh.setAttribute('x2', xv);
      xh.setAttribute('visibility', 'visible');
      const [label, value] = meta.points[idx];
      if (xd && line && value != null) {
        const pts = el.querySelectorAll('.line');
        const yv = yOnPaths(pts, xv);
        if (yv != null) { xd.setAttribute('cx', xv); xd.setAttribute('cy', yv); xd.setAttribute('visibility', 'visible'); }
      }
      tip.hidden = false;
      tip.innerHTML = '';
      const v = document.createElement('strong');
      v.textContent = value == null ? '–' : `${Math.round(value)}${meta.unit}`;
      const l = document.createElement('span');
      l.textContent = label;
      tip.append(v, l);
      const px = (xv / vb.width) * el.clientWidth;
      tip.style.left = `${Math.max(0, Math.min(el.clientWidth - tip.offsetWidth, px - tip.offsetWidth / 2))}px`;
    };
    const hide = () => {
      tip.hidden = true;
      xh.setAttribute('visibility', 'hidden');
      xd?.setAttribute('visibility', 'hidden');
    };
    const at = (e) => {
      const r = svg.getBoundingClientRect();
      const xv = ((e.clientX - r.left) / r.width) * svg.viewBox.baseVal.width;
      const slot = (meta.right - meta.left) / (meta.bars ? meta.n : Math.max(1, meta.n - 1));
      return Math.round(meta.bars ? (xv - meta.left - slot / 2) / slot : (xv - meta.left) / slot);
    };
    svg.addEventListener('pointermove', (e) => show(at(e)));
    svg.addEventListener('pointerdown', (e) => show(at(e)));
    svg.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
    el.addEventListener('blur', hide);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); show(idx + 1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(idx < 0 ? meta.n - 1 : idx - 1); }
      if (e.key === 'Escape') hide();
    });
    el.addEventListener('focus', () => { if (idx < 0) show(meta.n - 1); });
  });
}

function yOnPaths(paths, xv) {
  for (const p of paths) {
    const pts = p.getAttribute('d').match(/[ML][\d.]+,[\d.]+/g)?.map((s) => s.slice(1).split(',').map(Number)) || [];
    for (let k = 0; k < pts.length; k++) {
      if (Math.abs(pts[k][0] - xv) < 0.6) return pts[k][1];
      if (k && pts[k - 1][0] < xv && pts[k][0] > xv) {
        const t = (xv - pts[k - 1][0]) / (pts[k][0] - pts[k - 1][0]);
        return pts[k - 1][1] + t * (pts[k][1] - pts[k - 1][1]);
      }
    }
  }
  return null;
}
