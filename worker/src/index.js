// Lawn IQ Rachio proxy: a Cloudflare Worker that forwards a few read-only Rachio API calls.
// The Rachio key never leaves Cloudflare. It lives in the RACHIO_API_KEY secret.
// Callers must send the shared password (APP_PASSWORD secret) in the X-App-Password header.
//
//   GET /person/info                      -> who owns the key (returns { id })
//   GET /person/:id                       -> person with devices and zones
//   GET /device/:id/event?startTime&endTime -> device events (times in ms since epoch)

const RACHIO = 'https://api.rach.io/1/public';
const ID = '[A-Za-z0-9-]{1,64}';
const ROUTES = [
  new RegExp('^/person/info$'),
  new RegExp(`^/person/${ID}$`),
  new RegExp(`^/device/${ID}/event$`),
];
// Pages allowed to call the Worker from a browser.
const ORIGINS = ['https://jakedahlstrom-gif.github.io', 'http://localhost:8080'];

function cors(req) {
  const origin = req.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (origin && ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'X-App-Password';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

const json = (req, status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) },
});

/** Compare without leaking how many characters matched. */
async function samePassword(given, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
    if (req.method !== 'GET') return json(req, 405, { error: 'Only GET is allowed' });
    if (!env.APP_PASSWORD || !env.RACHIO_API_KEY) return json(req, 500, { error: 'Worker secrets are not set up yet' });
    if (!(await samePassword(req.headers.get('X-App-Password') || '', env.APP_PASSWORD))) {
      return json(req, 401, { error: 'Wrong password' });
    }

    const url = new URL(req.url);
    if (!ROUTES.some((r) => r.test(url.pathname))) return json(req, 404, { error: 'Not found' });

    const target = new URL(RACHIO + url.pathname);
    if (url.pathname.endsWith('/event')) {
      for (const k of ['startTime', 'endTime']) {
        const v = url.searchParams.get(k);
        if (!/^\d{1,15}$/.test(v || '')) return json(req, 400, { error: `${k} must be a time in milliseconds` });
        target.searchParams.set(k, v);
      }
    }

    const res = await fetch(target, { headers: { Authorization: `Bearer ${env.RACHIO_API_KEY}` } });
    return new Response(res.body, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store', ...cors(req) },
    });
  },
};
