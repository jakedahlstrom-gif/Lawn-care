// Starting values for a fresh install. Everything here is editable in the Yard tab.
// `src` maps each field to 'est' (Estimated) or 'meas' (Measured).

export const SCHEMA = 1;
export const HEAD_PRECIP = { spray: 1.5, rotor: 0.5, rotary: 0.4 };
export const HEAD_LABELS = { spray: 'Spray', rotor: 'Rotor', rotary: 'Rotary nozzle', drip: 'Drip' };
export const SLOPE_LABELS = { flat: 'Flat', moderate: 'Moderate', steep: 'Steep' };
export const SUN_LABELS = { full: 'Full sun', partial: 'Partial', shade: 'Shade' };
export const PRODUCT_TYPES = {
  fertilizer: 'Fertilizer',
  preemergent: 'Pre-emergent',
  weed: 'Weed control',
  other: 'Other',
};
export const OTHER_KINDS = [
  { id: 'sharpen', label: 'Blade sharpened' },
  { id: 'blowout', label: 'Sprinkler blowout' },
  { id: 'battery', label: 'Battery stored' },
  { id: 'spreader', label: 'Spreader cleaned' },
  { id: 'startup', label: 'Sprinkler start-up' },
  { id: 'cleanup', label: 'Spring cleanup' },
  { id: 'aerate', label: 'Core aerated' },
  { id: 'seed', label: 'Overseeded' },
  { id: 'other', label: 'Other' },
];

/** Gallons per minute that a zone of this size needs to hit a precip rate (head-to-head coverage). */
export const gpmFor = (precip, sqft) => Math.round((precip * sqft / 96.25) * 10) / 10;

export function defaultSettings() {
  return {
    schema: SCHEMA,
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
      sharpenEvery: 25,
      hoursBefore: 0,
      sinceSharpenAtStart: 0,
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
      rateMode: 'auto',
    },
    mowing: { cadenceDays: 7, preferredDays: [6, 0] },
    nitrogen: { seasonTarget: 3.0 },
    appearance: { theme: 'system' },
    planProducts: {
      'fert-late-spring': 'p-lesco-24-0-11',
      'fert-summer': 'p-scotts-32-0-4',
      'fert-early-fall': 'p-lesco-24-0-11',
      'fert-late-fall': 'p-lesco-24-0-11',
    },
    planChecks: {},
    src: {
      'location.lat': 'meas',
      'location.lon': 'meas',
      'location.grass': 'meas',
      'location.lot': 'meas',
      'location.surveyArea': 'meas',
      'mower.model': 'meas',
      'mower.heights.0': 'meas',
      'mower.heights.1': 'meas',
      'mower.heights.2': 'meas',
      'mower.heights.3': 'meas',
      'mower.heights.4': 'meas',
      'mower.heights.5': 'meas',
      'mower.heights.6': 'meas',
      'mower.mowHours': 'est',
      'mower.sharpenEvery': 'est',
      'mower.hoursBefore': 'est',
      'mower.sinceSharpenAtStart': 'est',
      'spreader.model': 'meas',
      'water.tiers.0': 'meas',
      'water.tiers.1': 'meas',
      'water.tiers.2': 'meas',
      'water.tiers.3': 'meas',
      'water.sewerWinter': 'meas',
      'water.sewerRate': 'est',
      'water.billing': 'est',
      'water.baseUsage': 'est',
      'water.summerInches': 'est',
      'nitrogen.seasonTarget': 'est',
    },
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
    src: { sqft: 'est', slope: 'est', sun: 'est', head: 'est', gpm: 'est', precip: 'est', weeklyMinutes: 'est' },
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

export function newZone(order) {
  return {
    ...zone('', order, '', 500, 'flat', 'spray'),
    id: '',
  };
}

const PRODUCT_SRC = {
  n: 'meas', p: 'meas', k: 'meas', size: 'meas', coverage: 'meas',
  price: 'est', elite: 'est', keepOffHours: 'est', noRainHours: 'est', noMowDays: 'est', onHand: 'est',
};

export function defaultProducts() {
  return [
    {
      id: 'p-lesco-24-0-11',
      order: 1,
      name: 'Lesco 24-0-11',
      type: 'fertilizer',
      n: 24, p: 0, k: 11,
      unit: 'lb',
      size: 50,
      coverage: 12000,
      price: 50,
      elite: '5.5',
      keepOffHours: 4,
      noRainHours: 24,
      noMowDays: 1,
      onHand: 0,
      src: { ...PRODUCT_SRC },
    },
    {
      id: 'p-scotts-32-0-4',
      order: 2,
      name: 'Scotts Turf Builder Lawn Food 32-0-4',
      type: 'fertilizer',
      n: 32, p: 0, k: 4,
      unit: 'lb',
      size: 12.5,
      coverage: 5000,
      price: 30,
      elite: '3.5',
      keepOffHours: 4,
      noRainHours: 24,
      noMowDays: 1,
      onHand: 0,
      src: { ...PRODUCT_SRC },
    },
  ];
}

export function newProduct(order) {
  return {
    id: '',
    order,
    name: '',
    type: 'fertilizer',
    n: 0, p: 0, k: 0,
    unit: 'lb',
    size: 0,
    coverage: 0,
    price: 0,
    elite: '',
    keepOffHours: 0,
    noRainHours: 24,
    noMowDays: 0,
    onHand: 0,
    src: { ...PRODUCT_SRC, n: 'est', p: 'est', k: 'est', size: 'est', coverage: 'est' },
  };
}
