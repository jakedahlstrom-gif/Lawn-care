// Starting values for a fresh install, plus the labels the UI uses. Everything is editable in the Yard tab.
// `src` marks numeric fields as 'est' (Estimated) or 'meas' (trusted). Only Estimated ones show a badge.

export const SCHEMA = 2;
export const HEAD_PRECIP = { spray: 1.5, rotor: 0.5, rotary: 0.4 };
export const HEAD_LABELS = { spray: 'Spray', rotor: 'Rotor', rotary: 'Rotary nozzle', drip: 'Drip' };
export const SLOPE_LABELS = { flat: 'Flat', moderate: 'Moderate', steep: 'Steep' };
export const SUN_LABELS = { full: 'Full sun', partial: 'Partial', shade: 'Shade' };
export const PRODUCT_TYPES = {
  fertilizer: 'Fertilizer',
  preemergent: 'Crabgrass preventer',
  grub: 'Grub control',
  weed: 'Spot spray',
  other: 'Other',
};
/** Products that go through the spreader (logged with "Fertilize"). */
export const SPREADER_TYPES = ['fertilizer', 'preemergent', 'grub'];

export const OTHER_KINDS = [
  { id: 'blowout', label: 'Sprinkler blowout' },
  { id: 'battery', label: 'Battery stored' },
  { id: 'spreader', label: 'Spreader cleaned' },
  { id: 'bags', label: 'Fertilizer bags stored' },
  { id: 'startup', label: 'Sprinkler start-up' },
  { id: 'cleanup', label: 'Spring cleanup' },
  { id: 'aerate', label: 'Core aerated' },
  { id: 'seed', label: 'Overseeded' },
  { id: 'other', label: 'Other' },
];
/** Kinds no longer offered but still shown for older entries. */
export const LEGACY_KIND_LABELS = { sharpen: 'Blade sharpened' };

/** Front-yard stripe directions, rotated after each logged mow. Angles are measured from the street. */
export const MOW_PATTERNS = [
  { id: 0, angle: 0, label: 'Parallel to the street' },
  { id: 1, angle: 90, label: 'Perpendicular to the street' },
  { id: 2, angle: 45, label: 'Diagonal, rising to the right' },
  { id: 3, angle: 135, label: 'Diagonal, rising to the left' },
];

/** Gallons per minute that a zone of this size needs to hit a precip rate (head-to-head coverage). */
export const gpmFor = (precip, sqft) => Math.round((precip * sqft / 96.25) * 10) / 10;

const HEIGHT_SRC = Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((i) => [`mower.heights.${i}`, 'est']));

export function defaultSettings() {
  return {
    schema: SCHEMA,
    profile: { name: 'Jake' },
    header: { tone: 'light' },
    location: {
      name: 'Prior Lake, MN',
      lat: 44.71,
      lon: -93.42,
      grass: 'Kentucky bluegrass',
      lot: 'Walkout lot with sloped side yards',
      surveyArea: 8685,
      notes: 'Conservation easement in back is natural, not lawn.',
    },
    mower: {
      model: 'EGO 21″ self-propelled',
      heights: [1.5, 1.9, 2.3, 2.75, 3.15, 3.6, 4.0],
      mowHours: 1.0,
    },
    spreader: { model: 'Scotts Elite' },
    clippings: 'mulch',
    water: {
      tiers: [
        { upTo: 10000, rate: 3.86 },
        { upTo: 20000, rate: 4.63 },
        { upTo: 30000, rate: 6.02 },
        { upTo: null, rate: 9.05 },
      ],
      sewerWinter: true,
      sewerRate: 6.0,
      billing: 'monthly',
      baseUsage: 5000,
      summerInches: 0.75,
      rateMode: 'auto', // 'auto', a tier index, or 'custom' (customRate)
      customRate: 0,
    },
    rachio: { zoneMap: {}, rates: {} }, // Rachio zone id → app zone id ('none' = don't count); nozzle in/hr you entered
    mowing: { cadenceDays: 7, preferredDays: [6, 0] },
    nitrogen: { seasonTarget: 3.0 },
    appearance: { theme: 'system' },
    winter: { on: false, dismissed: {} },
    calendar: { showPast: false },
    planProducts: defaultPlanProducts(),
    planChecks: {},
    src: {
      'location.lat': 'meas',
      'location.lon': 'meas',
      'location.surveyArea': 'meas',
      ...HEIGHT_SRC,
      'mower.mowHours': 'est',
      'water.tiers.0': 'meas',
      'water.tiers.1': 'meas',
      'water.tiers.2': 'meas',
      'water.tiers.3': 'meas',
      'water.sewerRate': 'est',
      'water.baseUsage': 'est',
      'water.summerInches': 'est',
      'water.customRate': 'meas',
      'nitrogen.seasonTarget': 'est',
    },
  };
}

export function defaultPlanProducts() {
  return {
    'feed-spring': 'p-scotts-halts',
    'feed-late-spring': 'p-scotts-32-0-4',
    'feed-summer': 'p-scotts-32-0-4',
    'feed-early-fall': 'p-scotts-winterguard',
    'feed-late-fall': 'p-scotts-winterguard',
    grubs: 'p-scotts-grubex',
    'spray-spring': 'p-ortho-wbg',
    'spray-fall': 'p-ortho-wbg',
  };
}

function zone(id, order, name, sqft, slope, head) {
  const precip = HEAD_PRECIP[head];
  return {
    id,
    order,
    name,
    sqft,
    lawn: true,
    slope,
    sun: 'full',
    head,
    precip,
    gpm: gpmFor(precip, sqft),
    weeklyMinutes: 0,
    src: { sqft: 'est', gpm: 'est', precip: 'est', weeklyMinutes: 'est' },
  };
}

export function defaultZones() {
  return [
    zone('z1', 1, 'Front Left', 1250, 'flat', 'rotor'),
    zone('z2', 2, 'Front Right', 1250, 'flat', 'rotor'),
    zone('z3', 3, 'Side Left', 800, 'moderate', 'spray'),
    zone('z4', 4, 'Side Right', 800, 'moderate', 'spray'),
    zone('z5', 5, 'Back Left', 1700, 'flat', 'rotor'),
    zone('z6', 6, 'Back Right', 1700, 'flat', 'rotor'),
  ];
}

export function newZone() {
  return { ...zone('', undefined, '', 500, 'flat', 'spray'), id: '' };
}

const LABEL_SRC = {
  n: 'meas', p: 'meas', k: 'meas', size: 'meas', coverage: 'meas',
  price: 'est', elite: 'est', keepOffHours: 'est', noRainHours: 'est', noMowDays: 'est', onHand: 'est', mixRate: 'est',
};

const scotts = (id, order, name, short, type, [n, p, k], size, coverage, price, bags, elite, extra = {}) => ({
  id, order, name, short, type, n, p, k,
  unit: 'lb', size, coverage, price,
  bagOptions: bags.map(([s, pr]) => ({ size: s, price: pr })),
  elite, keepOffHours: 4, noRainHours: 24, noMowDays: 1, onHand: 0, mixRate: 0,
  src: { ...LABEL_SRC },
  ...extra,
});

/** Scotts lineup used by the plan, plus Weed B Gon for spot spraying. Elite settings: confirm against each bag. */
export function defaultProducts() {
  return [
    scotts('p-scotts-winterguard', 1, 'Scotts Turf Builder WinterGuard Fall Lawn Food', 'WinterGuard', 'fertilizer', [32, 0, 10],
      12.5, 5000, 30, [[12.5, 30], [37.5, 65]], '2.75'),
    scotts('p-scotts-halts', 2, 'Scotts Turf Builder Halts Crabgrass Preventer with Lawn Food', 'Halts', 'preemergent', [30, 0, 4],
      13.35, 5000, 30, [[13.35, 30], [40.05, 70]], '3'),
    scotts('p-scotts-32-0-4', 3, 'Scotts Turf Builder Lawn Food', 'Lawn Food', 'fertilizer', [32, 0, 4],
      12.5, 5000, 30, [[12.5, 30], [37.5, 60]], '3.5'),
    scotts('p-scotts-grubex', 4, 'Scotts GrubEx Season Long Grub Killer', 'GrubEx', 'grub', [0, 0, 0],
      14.35, 5000, 25, [[14.35, 25], [28.7, 45]], '3.5', { noRainHours: 0, noMowDays: 0 }),
    {
      id: 'p-ortho-wbg',
      order: 5,
      name: 'Ortho Weed B Gon Weed Killer for Lawns Concentrate',
      short: 'Weed B Gon',
      type: 'weed',
      n: 0, p: 0, k: 0,
      unit: 'fl oz',
      size: 32,
      coverage: 8000,
      price: 18,
      bagOptions: [{ size: 32, price: 18 }],
      elite: '',
      mixRate: 2,
      keepOffHours: 2,
      noRainHours: 24,
      noMowDays: 2,
      onHand: 0,
      src: { ...LABEL_SRC, coverage: 'est' },
    },
    {
      id: 'p-lesco-24-0-11',
      order: 6,
      name: 'Lesco 24-0-11',
      short: 'Lesco 24-0-11',
      type: 'fertilizer',
      n: 24, p: 0, k: 11,
      unit: 'lb',
      size: 50,
      coverage: 12000,
      price: 50,
      bagOptions: [{ size: 50, price: 50 }],
      elite: '5.5',
      mixRate: 0,
      keepOffHours: 4,
      noRainHours: 24,
      noMowDays: 1,
      onHand: 0,
      src: { ...LABEL_SRC },
    },
  ];
}

export function newProduct() {
  return {
    id: '',
    name: '',
    short: '',
    type: 'fertilizer',
    n: 0, p: 0, k: 0,
    unit: 'lb',
    size: 0,
    coverage: 0,
    price: 0,
    bagOptions: [],
    elite: '',
    mixRate: 0,
    keepOffHours: 0,
    noRainHours: 24,
    noMowDays: 0,
    onHand: 0,
    src: { ...LABEL_SRC, n: 'est', p: 'est', k: 'est', size: 'est', coverage: 'est' },
  };
}

/** Short display name for a product ("WinterGuard"). */
export const shortName = (p) => (p ? (p.short || p.name || '').trim() || 'Product' : '');
