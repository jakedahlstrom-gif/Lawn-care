// Builds an Open-Meteo-shaped forecast response for tests (US units, America/Chicago).
// `day(date, offset)` returns overrides for a day: { tMax, tMin, rain, prob, et0, code, soil, wind, rainHours }.
// `hourlyEt: false` leaves hourly ET0 out, like a response cached by an older version of the app.

const pad = (n) => String(n).padStart(2, '0');
const addDays = (s, n) => {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
};

export function mockForecast({ today, past = 21, future = 16, day = () => ({}), utcOffset = -18000, nowHour = 9, hourlyEt = true } = {}) {
  const daily = {
    time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [],
    precipitation_probability_max: [], et0_fao_evapotranspiration: [], wind_speed_10m_max: [], snowfall_sum: [],
  };
  const hourly = {
    time: [], temperature_2m: [], precipitation: [], precipitation_probability: [], soil_temperature_6cm: [],
    et0_fao_evapotranspiration: [], wind_speed_10m: [], relative_humidity_2m: [], snow_depth: [],
  };
  // Daily ET0 spread over daylight hours (6 AM–7 PM), weighted toward midday.
  const etShape = Array.from({ length: 24 }, (_, h) => (h >= 6 && h < 20 ? Math.sin(((h - 5.5) / 14) * Math.PI) : 0));
  const etTotal = etShape.reduce((a, b) => a + b, 0);
  for (let i = -past; i < future; i++) {
    const date = addDays(today, i);
    const o = { tMax: 66, tMin: 46, rain: 0, prob: 5, et0: 0.12, code: 1, wind: 7, ...day(date, i) };
    const soil = o.soil ?? (o.tMax + o.tMin) / 2;
    const rainHours = o.rainHours || [14, 15, 16, 17];
    daily.time.push(date);
    daily.weather_code.push(o.rain >= 0.1 ? 63 : o.code);
    daily.temperature_2m_max.push(o.tMax);
    daily.temperature_2m_min.push(o.tMin);
    daily.precipitation_sum.push(o.rain);
    daily.precipitation_probability_max.push(i < 0 ? null : (o.rain >= 0.1 ? Math.max(o.prob, 80) : o.prob));
    daily.et0_fao_evapotranspiration.push(o.et0);
    daily.wind_speed_10m_max.push(o.wind);
    daily.snowfall_sum.push(o.snow || 0);
    for (let h = 0; h < 24; h++) {
      hourly.time.push(`${date}T${pad(h)}:00`);
      const k = (1 - Math.cos(((h - 5) / 24) * 2 * Math.PI)) / 2;
      hourly.temperature_2m.push(Math.round((o.tMin + (o.tMax - o.tMin) * k) * 10) / 10);
      hourly.precipitation.push(rainHours.includes(h) ? Math.round((o.rain / rainHours.length) * 1000) / 1000 : 0);
      hourly.soil_temperature_6cm.push(Math.round((soil + Math.sin(((h - 9) / 24) * 2 * Math.PI) * 2) * 10) / 10);
      hourly.et0_fao_evapotranspiration.push(Math.round(((o.et0 * etShape[h]) / etTotal) * 10000) / 10000);
      hourly.precipitation_probability.push(rainHours.includes(h) && o.rain > 0 ? Math.max(o.prob, 70) : Math.min(o.prob, 20));
      hourly.wind_speed_10m.push(Math.round(o.wind * (0.6 + 0.4 * k) * 10) / 10);
      hourly.relative_humidity_2m.push(Math.round(85 - 35 * k));
      hourly.snow_depth.push(o.depthFt ?? 0);
    }
  }
  if (!hourlyEt) delete hourly.et0_fao_evapotranspiration;
  return {
    latitude: 44.71,
    longitude: -93.42,
    utc_offset_seconds: utcOffset,
    timezone: 'America/Chicago',
    timezone_abbreviation: 'CDT',
    current_units: { time: 'iso8601', interval: 'seconds', temperature_2m: '°F', weather_code: 'wmo code', wind_speed_10m: 'mp/h' },
    current: { time: `${today}T${pad(nowHour)}:00`, interval: 900, temperature_2m: 58, weather_code: 2, wind_speed_10m: 6 },
    hourly_units: {
      time: 'iso8601', temperature_2m: '°F', precipitation: 'inch', precipitation_probability: '%', soil_temperature_6cm: '°F',
      et0_fao_evapotranspiration: 'inch', wind_speed_10m: 'mp/h', relative_humidity_2m: '%', snow_depth: 'ft',
    },
    hourly,
    daily_units: {
      time: 'iso8601', weather_code: 'wmo code', temperature_2m_max: '°F', temperature_2m_min: '°F', precipitation_sum: 'inch',
      precipitation_probability_max: '%', et0_fao_evapotranspiration: 'inch', wind_speed_10m_max: 'mp/h', snowfall_sum: 'inch',
    },
    daily,
  };
}

/** Same response in metric units, to check unit conversion. */
export function toMetric(raw) {
  const r = JSON.parse(JSON.stringify(raw));
  const c = (v) => (v == null ? v : Math.round(((v - 32) / 1.8) * 100) / 100);
  const mm = (v) => (v == null ? v : Math.round(v * 25.4 * 100) / 100);
  r.daily.temperature_2m_max = r.daily.temperature_2m_max.map(c);
  r.daily.temperature_2m_min = r.daily.temperature_2m_min.map(c);
  r.daily.precipitation_sum = r.daily.precipitation_sum.map(mm);
  r.daily.et0_fao_evapotranspiration = r.daily.et0_fao_evapotranspiration.map(mm);
  r.hourly.soil_temperature_6cm = r.hourly.soil_temperature_6cm.map(c);
  r.hourly.temperature_2m = r.hourly.temperature_2m.map(c);
  r.hourly.precipitation = r.hourly.precipitation.map(mm);
  r.hourly.et0_fao_evapotranspiration = r.hourly.et0_fao_evapotranspiration.map(mm);
  Object.assign(r.daily_units, { temperature_2m_max: '°C', temperature_2m_min: '°C', precipitation_sum: 'mm', et0_fao_evapotranspiration: 'mm' });
  Object.assign(r.hourly_units, { soil_temperature_6cm: '°C', temperature_2m: '°C', precipitation: 'mm', et0_fao_evapotranspiration: 'mm' });
  return r;
}

export { addDays };
