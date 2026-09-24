export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  ADMIN_KEY?: string;
}

// Excludes visually ambiguous characters (0/O, 1/I/L) — this gets typed by
// hand off a landing page, so every character has to be unmistakable.
const SERIAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomSerial(): string {
  const groups: string[] = [];
  for (let g = 0; g < 2; g++) {
    let group = '';
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    for (const b of bytes) group += SERIAL_ALPHABET[b % SERIAL_ALPHABET.length];
    groups.push(group);
  }
  return `SEDE-${groups[0]}-${groups[1]}`;
}

function isValidEmail(email: string): boolean {
  // Deliberately permissive — this only gates "is this worth emailing a
  // serial to," not RFC 5322 correctness.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  const allowOrigin = origin && allowed.includes(origin) ? origin : allowed[0];
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key',
    Vary: 'Origin',
  };
}

function json(data: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

async function handleRegister(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  let body: { email?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, cors);
  }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : null;
  if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400, cors);

  const existing = await env.DB.prepare('SELECT serial, redeemed FROM registrations WHERE email = ?').bind(email).first<{
    serial: string;
    redeemed: number;
  }>();
  if (existing) {
    // Same email asking again gets its own existing serial back rather than
    // a second one — a landing page retry (double-click, page refresh)
    // should never silently mint a duplicate trial for the same person.
    return json({ serial: existing.serial, alreadyRegistered: true, redeemed: existing.redeemed === 1 }, 200, cors);
  }

  const serial = randomSerial();
  await env.DB.prepare('INSERT INTO registrations (email, name, serial) VALUES (?, ?, ?)').bind(email, name, serial).run();
  return json({ serial, alreadyRegistered: false, redeemed: false }, 201, cors);
}

async function handleValidateSerial(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  let body: { serial?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400, cors);
  }
  const serial = typeof body.serial === 'string' ? body.serial.trim().toUpperCase() : '';
  if (!serial) return json({ valid: false, reason: 'missing_serial' }, 400, cors);

  const row = await env.DB.prepare('SELECT redeemed FROM registrations WHERE serial = ?').bind(serial).first<{ redeemed: number }>();
  if (!row) return json({ valid: false, reason: 'not_found' }, 404, cors);
  if (row.redeemed === 1) return json({ valid: false, reason: 'already_redeemed' }, 200, cors);

  await env.DB.prepare("UPDATE registrations SET redeemed = 1, redeemed_at = datetime('now') WHERE serial = ?").bind(serial).run();
  return json({ valid: true }, 200, cors);
}

async function handleAdminList(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  if (!env.ADMIN_KEY || request.headers.get('X-Admin-Key') !== env.ADMIN_KEY) {
    return json({ error: 'unauthorized' }, 401, cors);
  }
  const url = new URL(request.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const { results } = await env.DB.prepare(
    'SELECT email, name, serial, created_at, redeemed_at, redeemed FROM registrations ORDER BY created_at DESC LIMIT ?',
  )
    .bind(limit)
    .all();
  return json({ registrations: results }, 200, cors);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin');
    const cors = corsHeaders(origin, env);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    try {
      if (request.method === 'POST' && url.pathname === '/api/register') return await handleRegister(request, env, cors);
      if (request.method === 'POST' && url.pathname === '/api/validate-serial') return await handleValidateSerial(request, env, cors);
      if (request.method === 'GET' && url.pathname === '/api/admin/registrations') return await handleAdminList(request, env, cors);
      if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true }, 200, cors);
    } catch (err) {
      console.error(err);
      return json({ error: 'internal_error' }, 500, cors);
    }

    return json({ error: 'not_found' }, 404, cors);
  },
};
