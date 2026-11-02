// NESTR server: access-code protected static app + admin API. No dependencies.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'codes.json');
const SESSION_MS = 12 * 3600 * 1000;
const COOKIE = 'nestr_sid';

// ---------- storage (scrypt-hashed codes) ----------
const hash = (code, salt) => crypto.scryptSync(code, salt, 32).toString('hex');
const makeEntry = code => { const salt = crypto.randomBytes(16).toString('hex'); return { salt, hash: hash(code, salt) }; };
const matches = (code, e) => {
  const a = Buffer.from(hash(code, e.salt), 'hex'), b = Buffer.from(e.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

let db;
const REMOTE_URL = process.env.UPSTASH_REDIS_REST_URL;
const REMOTE_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REMOTE_KEY = 'nestr:db';

async function redis(cmd) {
  const r = await fetch(REMOTE_URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + REMOTE_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
  });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error('Database error: ' + (d.error || r.status));
  return d.result;
}

async function load() {
  let raw = null;
  if (REMOTE_URL && REMOTE_TOKEN) raw = await redis(['GET', REMOTE_KEY]);
  else { try { raw = fs.readFileSync(DATA_FILE, 'utf8'); } catch (e) { /* first run */ } }
  if (raw) { db = JSON.parse(raw); return; }
  let admin = process.env.ADMIN_CODE;
  if (!admin) {
    admin = crypto.randomBytes(9).toString('base64url');
    console.log('ADMIN_CODE not set. Temporary admin access code: ' + admin);
  }
  db = { admin: makeEntry(admin), codes: [] };
  await save();
}
async function save() {
  const text = JSON.stringify(db, null, 2);
  if (REMOTE_URL && REMOTE_TOKEN) return void await redis(['SET', REMOTE_KEY, text]);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, DATA_FILE);
}

// ---------- sessions ----------
const sessions = new Map(); // token -> { role, codeId, exp }
function newSession(res, role, codeId, secure) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { role, codeId, exp: Date.now() + SESSION_MS });
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure ? '; Secure' : ''}`);
}
function getSession(req) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|; )' + COOKIE + '=([a-f0-9]+)'));
  if (!m) return null;
  const s = sessions.get(m[1]);
  if (!s) return null;
  if (s.exp < Date.now()) { sessions.delete(m[1]); return null; }
  return { token: m[1], ...s };
}
function dropSessions(pred, except) {
  for (const [t, s] of sessions) if (t !== except && pred(s)) sessions.delete(t);
}

// ---------- brute-force limiter ----------
const fails = new Map(); // ip -> { n, until }
const ip = req => (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
const locked = k => { const f = fails.get(k); return f && f.until > Date.now(); };
function fail(k) {
  const f = fails.get(k) || { n: 0, until: 0 };
  f.n++;
  if (f.n >= 5) { f.until = Date.now() + 60000 * Math.min(f.n - 4, 15); }
  fails.set(k, f);
}

// ---------- helpers ----------
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
    ...headers,
  });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json' });
const redirect = (res, to) => send(res, 302, '', { Location: to });

function serveFile(res, root, rel) {
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return send(res, 403, 'Forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  });
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) return reject(new Error('bad type'));
    let s = '';
    req.on('data', c => { s += c; if (s.length > 10000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(s || '{}')); } catch (e) { reject(e); } });
  });
}

const PUB = path.join(__dirname, 'public');
const APP = path.join(__dirname, 'app');
const ADM = path.join(__dirname, 'admin');
const home = s => (s.role === 'admin' ? '/admin/' : '/app/');

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const secure = req.headers['x-forwarded-proto'] === 'https';
  const sess = getSession(req);

  // public
  if (req.method === 'GET' && (p === '/login' || p === '/login.js' || p === '/style.css')) {
    if (p === '/login' && sess) return redirect(res, home(sess));
    return serveFile(res, PUB, p === '/login' ? 'login.html' : p.slice(1));
  }
  if (p === '/api/login' && req.method === 'POST') {
    const k = ip(req);
    if (locked(k)) return json(res, 429, { error: 'Too many attempts. Try again later.' });
    let body;
    try { body = await readJson(req); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
    const code = typeof body.code === 'string' ? body.code : '';
    if (code && code.length <= 200) {
      if (matches(code, db.admin)) { fails.delete(k); newSession(res, 'admin', null, secure); return json(res, 200, { next: '/admin/' }); }
      const hit = db.codes.find(c => matches(code, c));
      if (hit) { fails.delete(k); newSession(res, 'user', hit.id, secure); return json(res, 200, { next: '/app/' }); }
    }
    fail(k);
    return json(res, 401, { error: 'Invalid access code' });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    if (sess) sessions.delete(sess.token);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
    return json(res, 200, { ok: true });
  }

  // everything below needs a session
  if (!sess) return p.startsWith('/api/') ? json(res, 401, { error: 'Unauthorized' }) : redirect(res, '/login');

  if (p === '/api/me') return json(res, 200, { role: sess.role });

  if (p === '/') return redirect(res, home(sess));
  if (p === '/app') return redirect(res, '/app/');
  if (p.startsWith('/app/')) return serveFile(res, APP, p === '/app/' ? 'index.html' : p.slice(5));

  // admin only
  if (sess.role !== 'admin') return p.startsWith('/api/') ? json(res, 403, { error: 'Forbidden' }) : redirect(res, '/app/');
  if (p === '/admin') return redirect(res, '/admin/');
  if (p.startsWith('/admin/')) return serveFile(res, ADM, p === '/admin/' ? 'admin.html' : p.slice(7));

  if (p === '/api/admin/codes' && req.method === 'GET') {
    return json(res, 200, db.codes.map(c => ({ id: c.id, label: c.label, created: c.created })));
  }
  if (p === '/api/admin/codes' && req.method === 'POST') {
    let b; try { b = await readJson(req); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
    const label = String(b.label || '').trim().slice(0, 60);
    const code = String(b.code || '');
    if (!label) return json(res, 400, { error: 'Enter a name for this code' });
    if (code.length < 6 || code.length > 100) return json(res, 400, { error: 'Code must be 6-100 characters' });
    if (matches(code, db.admin) || db.codes.some(c => matches(code, c))) return json(res, 409, { error: 'That code is already in use' });
    db.codes.push({ id: crypto.randomBytes(6).toString('hex'), label, created: new Date().toISOString(), ...makeEntry(code) });
    await save();
    return json(res, 200, { ok: true });
  }
  const del = p.match(/^\/api\/admin\/codes\/([a-f0-9]+)$/);
  if (del && req.method === 'DELETE') {
    const before = db.codes.length;
    db.codes = db.codes.filter(c => c.id !== del[1]);
    if (db.codes.length === before) return json(res, 404, { error: 'Not found' });
    await save();
    dropSessions(s => s.codeId === del[1]);
    return json(res, 200, { ok: true });
  }
  if (p === '/api/admin/password' && req.method === 'POST') {
    let b; try { b = await readJson(req); } catch (e) { return json(res, 400, { error: 'Bad request' }); }
    const k = 'pw:' + ip(req);
    if (locked(k)) return json(res, 429, { error: 'Too many attempts. Try again later.' });
    if (!matches(String(b.current || ''), db.admin)) { fail(k); return json(res, 401, { error: 'Current admin code is wrong' }); }
    const next = String(b.next || '');
    if (next.length < 8 || next.length > 100) return json(res, 400, { error: 'New admin code must be 8-100 characters' });
    if (db.codes.some(c => matches(next, c))) return json(res, 409, { error: 'That code is already used as a user code' });
    db.admin = makeEntry(next);
    await save();
    dropSessions(s => s.role === 'admin', sess.token);
    return json(res, 200, { ok: true });
  }
  return send(res, 404, 'Not found');
}

load().then(() => {
  http.createServer((req, res) => {
    handle(req, res).catch(e => { console.error(e); if (!res.headersSent) json(res, 500, { error: 'Server error' }); });
  }).listen(PORT, () => console.log('NESTR listening on ' + PORT + (REMOTE_URL ? ' (Redis storage)' : ' (file storage)')));
}).catch(e => { console.error('Startup failed:', e.message); process.exit(1); });
