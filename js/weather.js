// Open-Meteo forecast (no API key). Raw responses are cached on the device for offline use.

import * as db from './db.js';

const STALE_MS = 30 * 60 * 1000;

export function forecastUrl(lat, lon) {
  const p = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: 'temperature_2m,weather_code,wind_speed_10m,relative_humidity_2m',
    hourly: 'temperature_2m,precipitation,precipitation_probability,soil_temperature_6cm,et0_fao_evapotranspiration,wind_speed_10m,relative_humidity_2m,snow_depth',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,et0_fao_evapotranspiration,wind_speed_10m_max,snowfall_sum',
    past_days: '21',
    forecast_days: '16',
    timezone: 'auto',
    temperature_unit: 'fahrenheit',
    precipitation_unit: 'inch',
    wind_speed_unit: 'mph',
  });
  return `https://api.open-meteo.com/v1/forecast?${p}`;
}

const toIn = (v, unit) => (v == null ? null : /mm/i.test(unit || '') ? v / 25.4 : v);
const toF = (v, unit) => (v == null ? null : /C/.test(unit || '') ? v * 1.8 + 32 : v);
const toMph = (v, unit) => (v == null ? null : /km/i.test(unit || '') ? v / 1.609 : /m\/s/i.test(unit || '') ? v * 2.237 : v);
/** Snow depth arrives in meters by default, or feet with US units. */
const depthIn = (v, unit) => {
  if (v == null) return null;
  const u = unit || 'm';
  if (/^ft/i.test(u)) return v * 12;
  if (/^cm/i.test(u)) return v / 2.54;
  if (/inch|^in/i.test(u)) return v;
  if (/^mm/i.test(u)) return v / 25.4;
  return v * 39.37;
};
/** Snowfall arrives in cm by default, or inches with US units. */
const snowIn = (v, unit) => (v == null ? null : /inch|^in/i.test(unit || '') ? v : /mm/i.test(unit || '') ? v / 25.4 : v / 2.54);

/** Turn an Open-Meteo response into the shape the engine uses. Handles metric or US units. */
export function normalize(raw, fetchedAt) {
  const du = raw.daily_units || {};
  const hu = raw.hourly_units || {};
  const h = raw.hourly || {};
  const hours = (h.time || []).map((t, i) => ({
    t: t.slice(0, 13),
    temp: toF(h.temperature_2m?.[i], hu.temperature_2m),
    rain: toIn(h.precipitation?.[i], hu.precipitation) || 0,
    pop: h.precipitation_probability?.[i] ?? null,
    soil: toF(h.soil_temperature_6cm?.[i], hu.soil_temperature_6cm),
    et0: toIn(h.et0_fao_evapotranspiration?.[i], hu.et0_fao_evapotranspiration),
    wind: toMph(h.wind_speed_10m?.[i], hu.wind_speed_10m),
    rh: h.relative_humidity_2m?.[i] ?? null,
    snowDepth: depthIn(h.snow_depth?.[i], hu.snow_depth),
  }));
  const soilByDay = {};
  for (const x of hours) {
    if (x.soil == null) continue;
    const k = x.t.slice(0, 10);
    (soilByDay[k] ||= []).push(x.soil);
  }
  const d = raw.daily || {};
  const days = (d.time || []).map((date, i) => {
    const s = soilByDay[date];
    return {
      date,
      code: d.weather_code?.[i] ?? null,
      tMax: toF(d.temperature_2m_max?.[i], du.temperature_2m_max),
      tMin: toF(d.temperature_2m_min?.[i], du.temperature_2m_min),
      rain: toIn(d.precipitation_sum?.[i], du.precipitation_sum),
      rainProb: d.precipitation_probability_max?.[i] ?? null,
      et0: toIn(d.et0_fao_evapotranspiration?.[i], du.et0_fao_evapotranspiration),
      wind: toMph(d.wind_speed_10m_max?.[i], du.wind_speed_10m_max),
      snow: snowIn(d.snowfall_sum?.[i], du.snowfall_sum),
      soil: s && s.length >= 12 ? s.reduce((a, b) => a + b, 0) / s.length : null,
    };
  });
  const cu = raw.current_units || {};
  const current = raw.current ? {
    time: raw.current.time,
    temp: toF(raw.current.temperature_2m, cu.temperature_2m),
    code: raw.current.weather_code ?? null,
    wind: toMph(raw.current.wind_speed_10m, cu.wind_speed_10m),
    rh: raw.current.relative_humidity_2m ?? null,
  } : null;
  return {
    fetchedAt,
    utcOffset: raw.utc_offset_seconds ?? 0,
    timezone: raw.timezone || '',
    current,
    days,
    dayMap: Object.fromEntries(days.map((x) => [x.date, x])),
    hours,
    hourIndex: Object.fromEntries(hours.map((x, i) => [x.t, i])),
  };
}

export async function loadCached(lat, lon) {
  const c = await db.get('kv', 'weather');
  if (!c || !c.raw) return null;
  if (Math.abs(c.lat - lat) > 0.05 || Math.abs(c.lon - lon) > 0.05) return null;
  try {
    return normalize(c.raw, c.fetchedAt);
  } catch {
    return null;
  }
}

export const isStale = (w) => !w || Date.now() - w.fetchedAt > STALE_MS;

export async function fetchWeather(lat, lon) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(forecastUrl(lat, lon), { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`Weather service returned ${res.status}`);
    const raw = await res.json();
    if (!raw.daily || !raw.hourly) throw new Error('Unexpected weather response');
    const fetchedAt = Date.now();
    await db.put('kv', { raw, fetchedAt, lat, lon }, 'weather');
    return normalize(raw, fetchedAt);
  } finally {
    clearTimeout(timer);
  }
}

const CODES = [
  [[0], 'Clear', 'sun'],
  [[1], 'Mostly clear', 'sun'],
  [[2], 'Partly cloudy', 'partly'],
  [[3], 'Cloudy', 'cloud'],
  [[45, 48], 'Fog', 'cloud'],
  [[51, 53, 55, 56, 57], 'Drizzle', 'rain'],
  [[61, 63, 65, 66, 67, 80, 81, 82], 'Rain', 'rain'],
  [[71, 73, 75, 77, 85, 86], 'Snow', 'snow'],
  [[95, 96, 99], 'Thunderstorms', 'storm'],
];

export function describeCode(code) {
  const hit = CODES.find(([list]) => list.includes(code));
  return hit ? { label: hit[1], icon: hit[2] } : { label: '—', icon: 'cloud' };
}
