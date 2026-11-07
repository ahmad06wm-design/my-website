const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');

const MAX_QUESTION = 1000;
const MAX_ANSWER = 2000;
const SESSION_HOURS = 12;

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

let questions = readJson(QUESTIONS_FILE, []);
if (!Array.isArray(questions)) questions = [];

let secret;
try {
  secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();
  if (!secret) throw new Error('empty');
} catch (e) {
  secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret, { mode: 0o600 });
}

function saveQuestions() {
  writeJson(QUESTIONS_FILE, questions);
}

function adminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const file = path.join(DATA_DIR, 'admin.password');
  try {
    const p = fs.readFileSync(file, 'utf8').trim();
    if (p) return p;
  } catch (e) {}
  const generated = crypto.randomBytes(6).toString('base64url');
  fs.writeFileSync(file, generated + '\n', { mode: 0o600 });
  console.log('[corvus] admin password created: ' + generated);
  return generated;
}
const PASSWORD = adminPassword();

/* ---------- token helpers ---------- */

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + mac;
}

function verify(token) {
  if (typeof token !== 'string' || token.indexOf('.') === -1) return false;
  const i = token.lastIndexOf('.');
  const body = token.slice(0, i);
  const mac = token.slice(i + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return typeof payload.exp === 'number' && payload.exp > Date.now();
  } catch (e) {
    return false;
  }
}

function createToken() {
  return sign({ exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
}

function isAuthenticated(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/(?:^|;\s*)unspoken_admin=([^;]+)/);
  return match ? verify(match[1]) : false;
}

/* ---------- sanitising ---------- */

function cleanText(value, max) {
  if (typeof value !== 'string') return null;
  let text = value
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!text) return null;
  if (text.length > max) text = text.slice(0, max);
  return text;
}

function id() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

/* ---------- rate limiting (per ip, in memory) ---------- */

const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_HITS = 5;
const MIN_GAP_MS = 15 * 1000;

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= MAX_HITS) {
    hits.set(ip, list);
    return true;
  }
  if (list.length && now - list[list.length - 1] < MIN_GAP_MS) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  return false;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) {
    const kept = list.filter((t) => now - t < WINDOW_MS);
    if (kept.length) hits.set(ip, kept);
    else hits.delete(ip);
  }
}, 60 * 1000).unref();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* ---------- http helpers ---------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8'
};

function send(res, status, body, headers) {
  const base = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store'
  };
  res.writeHead(status, Object.assign(base, headers || {}));
  res.end(body);
}

function sendJson(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8' });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      parts.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody(req, limit) {
  const raw = await readBody(req, limit || 64 * 1024);
  try {
    return JSON.parse(raw || '{}');
  } catch (e) {
    return null;
  }
}

/* ---------- api ---------- */

function publicQuestion(q) {
  return { id: q.id, question: q.question, answer: q.answer, createdAt: q.createdAt };
}

function adminQuestion(q) {
  return {
    id: q.id,
    question: q.question,
    answer: q.answer,
    createdAt: q.createdAt,
    answeredAt: q.answeredAt || null
  };
}

async function handleApi(req, res, url) {
  if (req.method === 'GET' && url.pathname === '/api/questions') {
    const list = questions
      .filter((q) => q.answer)
      .sort((a, b) => (b.answeredAt || 0) - (a.answeredAt || 0))
      .map(publicQuestion);
    return sendJson(res, 200, { questions: list });
  }

  if (req.method === 'POST' && url.pathname === '/api/questions') {
    const ip = clientIp(req);
    if (rateLimited(ip)) {
      return sendJson(res, 429, { error: 'يرجى الانتظار قليلاً قبل إرسال سؤال آخر.' });
    }
    const body = await readJsonBody(req);
    if (!body) return sendJson(res, 400, { error: 'طلب غير صالح.' });
    if (body.website) return sendJson(res, 200, { ok: true });
    const question = cleanText(body.question, MAX_QUESTION);
    if (!question) return sendJson(res, 400, { error: 'لا يمكن إرسال سؤال فارغ.' });
    if (question.length < 2) return sendJson(res, 400, { error: 'السؤال قصير جداً.' });

    const record = { id: id(), question, answer: null, createdAt: Date.now(), answeredAt: null };
    questions.push(record);
    saveQuestions();
    return sendJson(res, 201, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    const body = await readJsonBody(req);
    if (!body || typeof body.password !== 'string') {
      return sendJson(res, 400, { error: 'كلمة المرور مطلوبة.' });
    }
    const given = Buffer.from(body.password);
    const real = Buffer.from(PASSWORD);
    const ok = given.length === real.length && crypto.timingSafeEqual(given, real);
    if (!ok) return sendJson(res, 401, { error: 'كلمة المرور غير صحيحة.' });
    const token = createToken();
    return send(
      res,
      200,
      JSON.stringify({ ok: true }),
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie':
          'unspoken_admin=' + token +
          '; HttpOnly; SameSite=Strict; Path=/; Max-Age=' + SESSION_HOURS * 3600
      }
    );
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    return send(res, 200, JSON.stringify({ ok: true }), {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': 'unspoken_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
    });
  }

  if (!isAuthenticated(req)) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/questions') {
    const list = questions
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(adminQuestion);
    return sendJson(res, 200, { questions: list });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/questions/answer') {
    const body = await readJsonBody(req);
    if (!body) return sendJson(res, 400, { error: 'طلب غير صالح.' });
    const answer = cleanText(body.answer, MAX_ANSWER);
    if (!answer) return sendJson(res, 400, { error: 'لا يمكن نشر إجابة فارغة.' });
    const target = questions.find((q) => q.id === body.id);
    if (!target) return sendJson(res, 404, { error: 'السؤال غير موجود.' });
    target.answer = answer;
    target.answeredAt = Date.now();
    saveQuestions();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/questions/delete') {
    const body = await readJsonBody(req);
    if (!body || !body.id) return sendJson(res, 400, { error: 'طلب غير صالح.' });
    const before = questions.length;
    questions = questions.filter((q) => q.id !== body.id);
    if (questions.length === before) return sendJson(res, 404, { error: 'السؤال غير موجود.' });
    saveQuestions();
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'not found' });
}

/* ---------- static ---------- */

function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  if (pathname === '/admin/') {
    res.writeHead(301, { Location: '/admin.html' });
    return res.end();
  }
  if (pathname === '/admin') pathname = '/admin.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden');

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      // replaceable avatar: /assets/joe-soul.png falls back to the bundled svg
      if (pathname === '/assets/joe-soul.png') {
        const fallback = path.join(PUBLIC_DIR, 'assets', 'joe-soul.svg');
        return fs.readFile(fallback, (e2, data) => {
          if (e2) return send(res, 404, 'Not found');
          send(res, 200, data, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' });
        });
      }
      return send(res, 404, 'Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (e2, data) => {
      if (e2) return send(res, 500, 'Server error');
      const cache = ext === '.html' ? 'no-store' : 'public, max-age=3600';
      send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    console.error(err);
    return sendJson(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, () => {
  console.log('[corvus] running on http://localhost:' + PORT);
  console.log('[corvus] admin: http://localhost:' + PORT + '/admin');
});
