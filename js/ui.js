// UI building blocks: bottom sheets (with a tap guard), dialogs, undo toasts, and the hold-to-save button.

import { esc } from './util.js';
import { icon } from './icons.js';

export const TAP_GUARD_MS = 500;
const stack = [];

/**
 * Open a bottom sheet. Taps inside the sheet are ignored for half a second after it opens
 * so the tap that opened it can't also hit something inside it.
 */
export function openSheet({ title, content = '', footer = '', cancelText = 'Cancel', right = '', className = '', onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `
    <div class="sheet-backdrop" data-close></div>
    <div class="sheet ${className}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1">
      <div class="sheet-grabber" aria-hidden="true"></div>
      <header class="sheet-head">
        <button type="button" class="link-btn sheet-cancel" data-close>${esc(cancelText)}</button>
        <h2 class="sheet-title">${esc(title)}</h2>
        <span class="sheet-right">${right}</span>
      </header>
      <div class="sheet-body">${content}</div>
      ${footer ? `<footer class="sheet-foot">${footer}</footer>` : ''}
    </div>`;
  document.getElementById('sheet-root').appendChild(wrap);

  const guardUntil = performance.now() + TAP_GUARD_MS;
  const guarded = () => performance.now() < guardUntil;
  const guard = (e) => {
    if (guarded()) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
    }
  };
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown'].forEach((t) => {
    wrap.addEventListener(t, guard, { capture: true, passive: false });
  });

  let closed = false;
  const api = {
    el: wrap,
    sheet: wrap.querySelector('.sheet'),
    body: wrap.querySelector('.sheet-body'),
    foot: wrap.querySelector('.sheet-foot'),
    guarded,
    close(result) {
      if (closed) return;
      closed = true;
      wrap.classList.remove('open');
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      if (!stack.length) document.documentElement.classList.remove('sheet-open');
      setTimeout(() => wrap.remove(), 340);
      onClose?.(result);
    },
  };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) api.close();
  });
  stack.push(api);
  document.documentElement.classList.add('sheet-open');
  void wrap.offsetHeight; // start the slide-in from the off-screen position
  wrap.classList.add('open');
  api.sheet.focus({ preventScroll: true });
  return api;
}

export const topSheet = () => stack[stack.length - 1] || null;

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !document.querySelector('.dialog-wrap')) topSheet()?.close();
});

/** iOS-style alert. Resolves true when confirmed. */
export function confirmDialog({ title, message = '', confirmText = 'OK', cancelText = 'Cancel', destructive = false }) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'dialog-wrap';
    wrap.innerHTML = `
      <div class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
        <div class="dialog-text"><h3 id="dlg-title">${esc(title)}</h3>${message ? `<p>${esc(message)}</p>` : ''}</div>
        <div class="dialog-actions">
          ${cancelText ? `<button type="button" data-v="0">${esc(cancelText)}</button>` : ''}
          <button type="button" data-v="1" class="${destructive ? 'destructive' : 'strong'}">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    void wrap.offsetHeight;
    wrap.classList.add('open');
    const done = (v) => {
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 200);
      document.removeEventListener('keydown', onKey, true);
      resolve(v);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); done(false); }
    };
    document.addEventListener('keydown', onKey, true);
    wrap.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) done(b.dataset.v === '1');
    });
    wrap.querySelector('[data-v="1"]').focus();
  });
}

let currentToast = null;

/** Bottom toast. With `undo`, shows an Undo button and a 5-second countdown bar. */
export function toast(message, { undo, duration = 5000, onExpire, kind = '' } = {}) {
  currentToast?.finish(false);
  const root = document.getElementById('toast-root');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `
    <span class="toast-msg">${icon(kind === 'error' ? 'alert' : 'check', 'toast-ic')}${esc(message)}</span>
    ${undo ? '<button type="button" class="toast-undo">Undo</button>' : ''}
    <span class="toast-bar" style="animation-duration:${duration}ms"></span>`;
  root.appendChild(el);
  let finished = false;
  const t = {
    el,
    finish(undone) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 250);
      if (currentToast === t) currentToast = null;
      if (!undone) onExpire?.();
    },
  };
  const timer = setTimeout(() => t.finish(false), duration);
  el.querySelector('.toast-undo')?.addEventListener('click', async () => {
    t.finish(true);
    await undo();
  });
  currentToast = t;
  return t;
}

export function holdButtonHtml(label = 'Hold to save') {
  return `
    <button type="button" class="hold-btn" data-hold aria-label="${esc(label)} (press and hold for 1 second)">
      <span class="hold-label">${esc(label)}</span>
      <span class="hold-fill" aria-hidden="true"><span class="hold-label">${esc(label)}</span></span>
      <span class="hold-check" aria-hidden="true">${icon('check')}</span>
    </button>
    <p class="hold-hint" aria-live="polite">Press and hold for 1 second</p>`;
}

/**
 * Press-and-hold for `duration` ms to confirm. Releasing early cancels; a checkmark shows on completion.
 */
export function bindHold(btn, onComplete, { duration = 1000, isGuarded = () => false, hintEl } = {}) {
  let start = 0;
  let raf = 0;
  let done = false;
  let progress = 0;
  const hintText = hintEl?.textContent || '';
  const set = (p) => {
    progress = p;
    btn.style.setProperty('--p', p.toFixed(4));
  };
  const tick = () => {
    if (!start) return;
    const p = Math.min(1, (performance.now() - start) / duration);
    set(p);
    if (p >= 1) finish();
    else raf = requestAnimationFrame(tick);
  };
  const begin = (e) => {
    if (done || start || btn.disabled || isGuarded()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.cancelable) e.preventDefault();
    if (e.pointerId != null) {
      try { btn.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    }
    start = performance.now();
    btn.classList.add('holding');
    raf = requestAnimationFrame(tick);
  };
  const cancel = () => {
    if (done || !start) return;
    cancelAnimationFrame(raf);
    start = 0;
    btn.classList.remove('holding');
    const from = progress;
    const t0 = performance.now();
    const back = () => {
      if (start || done) return;
      const k = Math.min(1, (performance.now() - t0) / 220);
      set(from * (1 - k));
      if (k < 1) requestAnimationFrame(back);
    };
    requestAnimationFrame(back);
    if (hintEl) {
      hintEl.textContent = 'Keep holding until the bar fills';
      hintEl.classList.add('warn');
      clearTimeout(btn._hintTimer);
      btn._hintTimer = setTimeout(() => { hintEl.textContent = hintText; hintEl.classList.remove('warn'); }, 1800);
    }
  };
  const finish = () => {
    done = true;
    start = 0;
    set(1);
    btn.classList.remove('holding');
    btn.classList.add('done');
    if (hintEl) hintEl.textContent = 'Saved';
    try { navigator.vibrate?.(15); } catch { /* unsupported */ }
    onComplete();
  };
  btn.addEventListener('pointerdown', begin);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('lostpointercapture', cancel);
  btn.addEventListener('pointermove', (e) => {
    if (!start) return;
    const r = btn.getBoundingClientRect();
    const m = 24;
    if (e.clientX < r.left - m || e.clientX > r.right + m || e.clientY < r.top - m || e.clientY > r.bottom + m) cancel();
  });
  btn.addEventListener('keydown', (e) => {
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); begin(e); }
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === ' ' || e.key === 'Enter') cancel();
  });
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  btn.addEventListener('click', (e) => e.preventDefault());
  return {
    reset() {
      done = false;
      start = 0;
      btn.classList.remove('done', 'holding');
      set(0);
      if (hintEl) hintEl.textContent = hintText;
    },
  };
}

export function segmented(name, options, value, extra = '') {
  return `<div class="seg" role="radiogroup" data-seg="${esc(name)}" ${extra}>${options.map(([v, label]) => {
    const on = String(v) === String(value);
    return `<button type="button" role="radio" aria-checked="${on}" class="seg-opt${on ? ' on' : ''}" data-value="${esc(v)}">${esc(label)}</button>`;
  }).join('')}</div>`;
}

/** Estimated / Measured label that toggles on tap. */
export function provPill(key, value) {
  const m = value === 'meas';
  return `<button type="button" class="prov ${m ? 'meas' : 'est'}" data-prov="${esc(key)}" aria-label="${m ? 'Measured' : 'Estimated'} (tap to change)">${m ? 'Measured' : 'Estimated'}</button>`;
}

export function switchHtml(name, on, label) {
  return `<label class="switch"><input type="checkbox" data-switch="${esc(name)}" ${on ? 'checked' : ''} aria-label="${esc(label)}"><span class="switch-track"><span class="switch-thumb"></span></span></label>`;
}
