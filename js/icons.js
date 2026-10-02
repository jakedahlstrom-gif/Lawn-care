// Inline SVG icons (24×24, stroke = currentColor).

const P = {
  today: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.8h17M8 3v4M16 3v4M8 13.5h2.5M13.5 13.5H16M8 17h2.5"/>',
  history: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  yard: '<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.8 9.6V19a1.5 1.5 0 0 0 1.5 1.5h9.4a1.5 1.5 0 0 0 1.5-1.5V9.6"/><path d="M9.5 20.5v-3.2c0-1.2 1-2.2 2.5-2.2s2.5 1 2.5 2.2v3.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mow: '<path d="M3 16.2h12.6a3 3 0 0 0 3-3V12H6.4z"/><circle cx="7" cy="18.4" r="1.9"/><circle cx="15.6" cy="18.4" r="1.9"/><path d="M15 12 19.5 4.2M18 4h3"/>',
  bag: '<path d="M7.5 3.8h9l-1.3 3.4 2.3 3.1v8.6a1.8 1.8 0 0 1-1.8 1.8H8.3a1.8 1.8 0 0 1-1.8-1.8v-8.6l2.3-3.1z"/><path d="M8.8 7.2h6.4M10 13.5h4M10 16.5h4"/>',
  spray: '<path d="M8.5 9.5h6v10.2a1.3 1.3 0 0 1-1.3 1.3H9.8a1.3 1.3 0 0 1-1.3-1.3z"/><path d="M9.8 9.5V6h3.4l3.3 1.6h-3.3"/><path d="M19 4.8l1.4-.9M19.3 7.6h1.7M19 10.3l1.4.9"/>',
  dots: '<circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>',
  drop: '<path d="M12 3.2s6.3 6.8 6.3 11.3a6.3 6.3 0 0 1-12.6 0C5.7 10 12 3.2 12 3.2z"/>',
  thermo: '<path d="M14.2 14.6V5.4a2.2 2.2 0 0 0-4.4 0v9.2a4.2 4.2 0 1 0 4.4 0z"/><path d="M12 9v7.5"/>',
  alert: '<path d="M10.3 4.2 2.9 17.6A2 2 0 0 0 4.6 20.6h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 16.8v.2"/>',
  check: '<path d="M5 12.6l4.5 4.4L19.2 7.4"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  chevDown: '<path d="M6 9.5l6 6 6-6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  trash: '<path d="M4.5 6.8h15M9.5 6.8V4.6h5v2.2M6.5 6.8l.9 12.4a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.4M10.2 10.5v6.5M13.8 10.5v6.5"/>',
  camera: '<path d="M4 8.2h3.2L8.8 6h6.4l1.6 2.2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.2a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.3" r="3.4"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.5v4.2h-4.2"/>',
  box: '<path d="M3.8 7.6 12 3.6l8.2 4v8.8L12 20.4l-8.2-4z"/><path d="M3.8 7.6 12 11.6l8.2-4M12 11.6v8.8"/>',
  blade: '<path d="M3.5 12h17"/><path d="M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6z"/><path d="M3.5 12c1.5-2 3.3-2.8 5.6-2.8M20.5 12c-1.5 2-3.3 2.8-5.6 2.8"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.6 4.6 12 6.4l2.4-1.8M9.6 19.4 12 17.6l2.4 1.8"/>',
  shield: '<path d="M12 3.2 5 5.8v5.6c0 4.4 3 7.8 7 9.4 4-1.6 7-5 7-9.4V5.8z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  gear: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/>',
  leaf: '<path d="M5 19c0-8 5.5-13.5 14.5-14-.3 9-6 14.5-14.5 14z"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  partly: '<path d="M9 4.2v1.4M4.5 6.2l1 1M3 10.4h1.4M13.4 7.2l1-1"/><path d="M6.4 11.6a3.4 3.4 0 0 1 6.1-2.3"/><path d="M8.5 19.5h8.8a3.3 3.3 0 0 0 .3-6.6 4.6 4.6 0 0 0-8.9.9 2.9 2.9 0 0 0-.2 5.7z"/>',
  cloud: '<path d="M7.5 18.5h10a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.1 3.3 3.3 0 0 0-.2 6.5z"/>',
  rain: '<path d="M7.5 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.1 3.3 3.3 0 0 0-.2 6.5z"/><path d="M9 17.2l-.9 2.3M13 17.2l-.9 2.3M17 17.2l-.9 2.3"/>',
  storm: '<path d="M7.5 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.1 3.3 3.3 0 0 0-.2 6.5z"/><path d="M12.6 14.6l-2 3.4h3l-2 3.4"/>',
  upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M5 14.5v4a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-4"/>',
  download: '<path d="M12 4v11.5M7.5 11 12 15.5l4.5-4.5M5 14.5v4a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-4"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2M12 7.8v.2"/>',
  slope: '<path d="M3 19.5h18L3 8.5z"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.dots}</svg>`;
}

export const TYPE_ICON = { mow: 'mow', fert: 'bag', weed: 'spray', other: 'dots' };
