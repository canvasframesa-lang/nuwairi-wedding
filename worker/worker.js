/**
 * Nuwairi Wedding API
 *   POST /api/rsvp            — guest submits their RSVP
 *   GET  /api/admin/rsvps     — Basic-auth, returns all RSVPs as JSON
 */

const ALLOWED_ORIGINS = [
  'https://canvasframesa-lang.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.find(o => origin && origin.startsWith(o)) || ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...(extra || {}),
    },
  });
}

function clean(s, max) {
  return String(s == null ? '' : s).trim().slice(0, max);
}

async function handleRSVP(req, env) {
  let body;
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }

  const name   = clean(body.name, 80);
  const attend = body.attend === 'yes' ? 'yes' : (body.attend === 'no' ? 'no' : null);
  const msg    = clean(body.msg, 500);

  if (!name)                          return json({ error: 'name_required' }, 400);
  if (!attend)                        return json({ error: 'attend_required' }, 400);
  if (attend === 'no' && !msg)        return json({ error: 'message_required_for_no' }, 400);

  const ts = Date.now();
  const id = `${ts}-${Math.random().toString(36).slice(2, 8)}`;
  const record = {
    id, name, attend, msg, ts,
    ip: req.headers.get('CF-Connecting-IP') || '',
    ua: clean(req.headers.get('User-Agent') || '', 200),
    country: (req.cf && req.cf.country) || '',
  };

  await env.RSVPS.put(`rsvp:${id}`, JSON.stringify(record));
  return json({ ok: true, id });
}

async function handleAdminList(req, env) {
  const auth = req.headers.get('Authorization') || '';
  const challenge = {
    'WWW-Authenticate': 'Basic realm="Nuwairi Wedding Admin"',
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (!auth.startsWith('Basic ')) {
    return new Response('Authentication required', { status: 401, headers: challenge });
  }

  let decoded;
  try { decoded = atob(auth.slice(6)); } catch { return new Response('Bad auth', { status: 401, headers: challenge }); }
  const idx = decoded.indexOf(':');
  const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
  if (!env.ADMIN_PASS || pass !== env.ADMIN_PASS) {
    return new Response('Wrong password', { status: 401, headers: challenge });
  }

  const out = [];
  let cursor;
  do {
    const page = await env.RSVPS.list({ prefix: 'rsvp:', cursor });
    for (const k of page.keys) {
      const v = await env.RSVPS.get(k.name);
      if (v) {
        try { out.push(JSON.parse(v)); } catch {}
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  out.sort((a, b) => b.ts - a.ts);

  return json({
    count: out.length,
    yes: out.filter(r => r.attend === 'yes').length,
    no:  out.filter(r => r.attend === 'no').length,
    items: out,
  });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const cors = corsHeaders(origin);

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    let resp;
    if (url.pathname === '/api/rsvp' && req.method === 'POST') {
      resp = await handleRSVP(req, env);
    } else if (url.pathname === '/api/admin/rsvps' && req.method === 'GET') {
      resp = await handleAdminList(req, env);
    } else if (url.pathname === '/' || url.pathname === '/api') {
      resp = json({ name: 'nuwairi-wedding-api', endpoints: ['/api/rsvp', '/api/admin/rsvps'] });
    } else {
      resp = new Response('Not found', { status: 404 });
    }

    for (const [k, v] of Object.entries(cors)) resp.headers.set(k, v);
    return resp;
  },
};
