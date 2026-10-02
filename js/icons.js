// Inline SVG icons (24×24, stroke = currentColor).

const P = {
  today: '<path d="M3.8 10.6 12 3.8l8.2 6.8"/><path d="M5.8 9v10.2a1.3 1.3 0 0 0 1.3 1.3h3.4v-5.6h3v5.6h3.4a1.3 1.3 0 0 0 1.3-1.3V9"/>',
  plan: '<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 9.8h17M8 3v4M16 3v4M8 13.5h2.5M13.5 13.5H16M8 17h2.5"/>',
  history: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  yard: '<path d="M4 20.5c.8-4.8.6-9-1-12.8 3.1 2.6 4.7 6.6 4.8 12.8"/><path d="M9.6 20.5c-.4-6.2.4-11.3 2.6-16 1.3 4.9 1.4 10.2.4 16"/><path d="M15 20.5c.3-4.3 1.8-8 4.9-11-1.1 3.8-1.6 7.4-1.6 11"/><path d="M2.8 20.5h18.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  mow: '<path d="M3 16.2h12.6a3 3 0 0 0 3-3V12H6.4z"/><circle cx="7" cy="18.4" r="1.9"/><circle cx="15.6" cy="18.4" r="1.9"/><path d="M15 12 19.5 4.2M18 4h3"/>',
  bag: '<path d="M7.5 3.8h9l-1.3 3.4 2.3 3.1v8.6a1.8 1.8 0 0 1-1.8 1.8H8.3a1.8 1.8 0 0 1-1.8-1.8v-8.6l2.3-3.1z"/><path d="M8.8 7.2h6.4M10 13.5h4M10 16.5h4"/>',
  spray: '<path d="M8.5 9.5h6v10.2a1.3 1.3 0 0 1-1.3 1.3H9.8a1.3 1.3 0 0 1-1.3-1.3z"/><path d="M9.8 9.5V6h3.4l3.3 1.6h-3.3"/><path d="M19 4.8l1.4-.9M19.3 7.6h1.7M19 10.3l1.4.9"/>',
  hand: '<path d="M8 13V6.2a1.4 1.4 0 0 1 2.8 0V11"/><path d="M10.8 10.5V4.8a1.4 1.4 0 0 1 2.8 0v5.7"/><path d="M13.6 10.6V6.3a1.4 1.4 0 0 1 2.8 0v6"/><path d="M16.4 10.9a1.4 1.4 0 0 1 2.8 0v2.6c0 4-2.6 7-6.6 7h-.6c-2.4 0-3.8-1-5.1-2.8L4.6 14.5a1.4 1.4 0 0 1 2.2-1.7L8 14.2"/>',
  water: '<path d="M12 3.2s6.3 6.8 6.3 11.3a6.3 6.3 0 0 1-12.6 0C5.7 10 12 3.2 12 3.2z"/><path d="M9.2 14.6a2.9 2.9 0 0 0 2.6 2.7"/>',
  dots: '<circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>',
  drop: '<path d="M12 3.2s6.3 6.8 6.3 11.3a6.3 6.3 0 0 1-12.6 0C5.7 10 12 3.2 12 3.2z"/>',
  thermo: '<path d="M14.2 14.6V5.4a2.2 2.2 0 0 0-4.4 0v9.2a4.2 4.2 0 1 0 4.4 0z"/><path d="M12 9v7.5"/>',
  alert: '<path d="M10.3 4.2 2.9 17.6A2 2 0 0 0 4.6 20.6h14.8a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z"/><path d="M12 9.5v4.2M12 16.8v.2"/>',
  check: '<path d="M5 12.6l4.5 4.4L19.2 7.4"/>',
  chev: '<path d="M9.5 6l6 6-6 6"/>',
  chevDown: '<path d="M6 9.5l6 6 6-6"/>',
  back: '<path d="M14.5 6l-6 6 6 6"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  trash: '<path d="M4.5 6.8h15M9.5 6.8V4.6h5v2.2M6.5 6.8l.9 12.4a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.4M10.2 10.5v6.5M13.8 10.5v6.5"/>',
  camera: '<path d="M4 8.2h3.2L8.8 6h6.4l1.6 2.2H20a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.2a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.3" r="3.4"/>',
  photo: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l4.8-4.4 3.4 3 2.6-2.3L20 17.6"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.8 4.5v4.2h-4.2"/>',
  box: '<path d="M3.8 7.6 12 3.6l8.2 4v8.8L12 20.4l-8.2-4z"/><path d="M3.8 7.6 12 11.6l8.2-4M12 11.6v8.8"/>',
  cart: '<path d="M3.5 4.5h2.2l2.1 10.2a1.5 1.5 0 0 0 1.5 1.2h7.8a1.5 1.5 0 0 0 1.5-1.1L20.3 8H6.6"/><circle cx="10" cy="19.4" r="1.3"/><circle cx="17" cy="19.4" r="1.3"/>',
  snow: '<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="M9.6 4.6 12 6.4l2.4-1.8M9.6 19.4 12 17.6l2.4 1.8"/>',
  battery: '<rect x="3" y="7.5" width="15.5" height="9" rx="2"/><path d="M21 10.5v3"/><path d="M6.2 10.5v3M9.2 10.5v3"/>',
  aerate: '<path d="M3 13.5h18"/><path d="M6 13.5c-.2-3 .3-5.6 1.6-7.8M10.5 13.5c-.1-3.4.6-6.4 2.2-8.8M15.5 13.5c.2-2.9 1.1-5.2 2.8-7"/><path d="M6.5 17v2.5M11 17v3M15.5 17v2.5"/>',
  leaf: '<path d="M5 19c0-8 5.5-13.5 14.5-14-.3 9-6 14.5-14.5 14z"/><path d="M5 19c3-4 6-6.5 9.5-8.5"/>',
  shield: '<path d="M12 3.2 5 5.8v5.6c0 4.4 3 7.8 7 9.4 4-1.6 7-5 7-9.4V5.8z"/><path d="M9 12l2.2 2.2L15.2 10"/>',
  clock: '<circle cx="12" cy="12" r="8.6"/><path d="M12 7.2V12l3.2 2"/>',
  gear: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/><circle cx="12" cy="12" r="6.6"/>',
  sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
  partly: '<path d="M9 4.2v1.4M4.5 6.2l1 1M3 10.4h1.4M13.4 7.2l1-1"/><path d="M6.4 11.6a3.4 3.4 0 0 1 6.1-2.3"/><path d="M8.5 19.5h8.8a3.3 3.3 0 0 0 .3-6.6 4.6 4.6 0 0 0-8.9.9 2.9 2.9 0 0 0-.2 5.7z"/>',
  cloud: '<path d="M7.5 18.5h10a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.1 3.3 3.3 0 0 0-.2 6.5z"/>',
  rain: '<path d="M7.5 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.1 3.3 3.3 0 0 0-.2 6.5z"/><path d="M9 17.2l-.9 2.3M13 17.2l-.9 2.3M17 17.2l-.9 2.3"/>',
  snowcloud: '<path d="M7.5 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.1 3.3 3.3 0 0 0-.2 6.5z"/><path d="M9 18.2h.01M12.5 19.6h.01M16 18.2h.01" stroke-width="2.6"/>',
  storm: '<path d="M7.5 14.5h10a3.8 3.8 0 0 0 .4-7.6 5.3 5.3 0 0 0-10.2 1.1 3.3 3.3 0 0 0-.2 6.5z"/><path d="M12.6 14.6l-2 3.4h3l-2 3.4"/>',
  wind: '<path d="M3.5 9h11a2.6 2.6 0 1 0-2.6-2.6"/><path d="M3.5 13.5h15a2.6 2.6 0 1 1-2.6 2.6"/><path d="M3.5 17.5h6"/>',
  upload: '<path d="M12 15.5V4M7.5 8.5 12 4l4.5 4.5M5 14.5v4a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-4"/>',
  download: '<path d="M12 4v11.5M7.5 11 12 15.5l4.5-4.5M5 14.5v4a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-4"/>',
  info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.2M12 7.8v.2"/>',
  slope: '<path d="M3 19.5h18L3 8.5z"/>',
  pin: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
  zones: '<rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.6"/><rect x="13" y="3.5" width="7.5" height="7.5" rx="1.6"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.6"/><rect x="13" y="13" width="7.5" height="7.5" rx="1.6"/>',
  dollar: '<circle cx="12" cy="12" r="8.6"/><path d="M14.6 9.2c-.4-1-1.4-1.6-2.6-1.6-1.6 0-2.6.8-2.6 2s1 1.7 2.6 2.1 2.8 1 2.8 2.3-1.2 2.1-2.8 2.1c-1.3 0-2.4-.6-2.8-1.7M12 6.2v1.4M12 16.1v1.6"/>',
  nitrogen: '<path d="M9 4.5v5.2L4.6 17.6A2 2 0 0 0 6.4 20.5h11.2a2 2 0 0 0 1.8-2.9L15 9.7V4.5"/><path d="M8 4.5h8M7.2 14.5h9.6"/>',
  spreader: '<path d="M6 5.5h12l-2 6.5H8z"/><path d="M12 12v4.5"/><circle cx="12" cy="18.3" r="2"/><path d="M4.5 19h2M17.5 19h2"/>',
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || P.dots}</svg>`;
}

export const TYPE_ICON = { mow: 'mow', fert: 'bag', weed: 'spray', pull: 'hand', water: 'water', other: 'dots' };

/** Square stripe icon for a mowing direction; the gray line along the bottom is the street. */
export function patternIcon(angle, size = 44) {
  const id = `pc${angle}`;
  const lines = [];
  for (let i = -40; i <= 40; i += 5.5) lines.push(`<line x1="${i}" y1="-40" x2="${i}" y2="40"/>`);
  // Angle is measured from the street (0° = stripes parallel to it, i.e. horizontal).
  const rot = 90 - angle;
  return `<svg class="pattern-ic" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true" focusable="false">
    <defs><clipPath id="${id}"><rect x="4" y="3" width="32" height="30" rx="5"/></clipPath></defs>
    <rect x="4" y="3" width="32" height="30" rx="5" class="pattern-bg"/>
    <g clip-path="url(#${id})"><g transform="translate(20 18) rotate(${rot})" class="pattern-stripes" stroke-width="2.8">${lines.join('')}</g></g>
    <rect x="4" y="3" width="32" height="30" rx="5" class="pattern-edge" fill="none"/>
    <line x1="3" y1="37" x2="37" y2="37" class="pattern-street" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}
