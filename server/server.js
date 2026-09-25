const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const PORT = Number(process.env.PORT || 8080);
const ADMIN_ID = process.env.ADMIN_ID || 'AdminGod';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '445566';
const TOKEN_SECRET = process.env.TOKEN_SECRET || '';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'members.sqlite');

if (!TOKEN_SECRET || TOKEN_SECRET.length < 32) {
  console.error('ตั้ง TOKEN_SECRET ให้ยาวอย่างน้อย 32 ตัวอักษรใน environment ก่อนเริ่ม');
  process.exit(1);
}

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','member')),
    created_at TEXT NOT NULL,
    expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    password_version INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  CREATE INDEX IF NOT EXISTS idx_users_active ON users(active);
`);

const b64 = x => Buffer.from(x).toString('base64url');
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, saved) {
  try {
    const got = crypto.scryptSync(password, saved.password_salt, 64);
    const want = Buffer.from(saved.password_hash, 'hex');
    return got.length === want.length && crypto.timingSafeEqual(got, want);
  } catch (_) { return false; }
}
function nowIso() { return new Date().toISOString(); }
function validExpiry(value) {
  if (value === null || value === undefined || value === '') return null;
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) throw new Error('วันหมดอายุไม่ถูกต้อง');
  return d.toISOString();
}
function isExpired(user) { return !!user.expires_at && new Date(user.expires_at).getTime() <= Date.now(); }
function publicUser(u) {
  return { id: u.id, role: u.role, active: !!u.active, createdAt: u.created_at, expiresAt: u.expires_at || null };
}

let admin = db.prepare('SELECT * FROM users WHERE id = ?').get(ADMIN_ID);
if (!admin) {
  const p = hashPassword(ADMIN_PASSWORD);
  db.prepare(`INSERT INTO users (id,password_hash,password_salt,role,created_at,expires_at,active,password_version)
              VALUES (?,?,?,?,?,?,?,?)`).run(ADMIN_ID, p.hash, p.salt, 'admin', nowIso(), null, 1, 1);
  admin = db.prepare('SELECT * FROM users WHERE id = ?').get(ADMIN_ID);
}

function tokenFor(user) {
  const payload = b64(JSON.stringify({
    sub: user.id,
    role: user.role,
    pv: user.password_version,
    exp: Date.now() + 12 * 60 * 60 * 1000
  }));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
function auth(req) {
  const raw = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(payload).digest();
  let actual;
  try { actual = Buffer.from(sig, 'base64url'); } catch (_) { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!p.exp || p.exp < Date.now()) return null;
    const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.sub);
    if (!u || !u.active || isExpired(u) || u.password_version !== p.pv) return null;
    return { id: u.id, role: u.role };
  } catch (_) { return null; }
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
    'Vary': 'Origin'
  });
  res.end(body);
}
function body(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => {
      s += c;
      if (s.length > 100000) reject(new Error('BODY_TOO_LARGE'));
    });
    req.on('end', () => {
      try { resolve(JSON.parse(s || '{}')); } catch (_) { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

const loginAttempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const row = loginAttempts.get(ip);
  if (!row || now - row.started > 15 * 60 * 1000) {
    loginAttempts.set(ip, { started: now, count: 0 });
    return true;
  }
  return row.count < 10;
}
function recordLoginFailure(ip) {
  const row = loginAttempts.get(ip) || { started: Date.now(), count: 0 };
  row.count += 1;
  loginAttempts.set(ip, row);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': CORS_ORIGIN,
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, PATCH, OPTIONS',
      'Vary': 'Origin'
    });
    return res.end();
  }

  const url = new URL(req.url, 'http://localhost');
  url.pathname = url.pathname.replace(/^\/api(?=\/)/, '');

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, service: 'Kheitai Membership API', time: nowIso() });
    }

    if (req.method === 'POST' && url.pathname === '/login') {
      const ip = req.socket.remoteAddress || 'unknown';
      if (!loginAllowed(ip)) return send(res, 429, { error: 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที' });
      const b = await body(req);
      const id = String(b.id || '').trim();
      const password = String(b.password || '');
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!u || !u.active || isExpired(u) || !verifyPassword(password, u)) {
        recordLoginFailure(ip);
        return send(res, 401, { error: 'ไอดีหรือรหัสผ่านไม่ถูกต้อง หรือสมาชิกหมดอายุ/ถูกปิดใช้งาน' });
      }
      loginAttempts.delete(ip);
      return send(res, 200, { token: tokenFor(u), user: publicUser(u) });
    }

    const user = auth(req);
    if (!user) return send(res, 401, { error: 'เซสชันหมดอายุหรือสมาชิกถูกปิดใช้งาน กรุณาเข้าสู่ระบบใหม่' });
    if (req.method === 'GET' && url.pathname === '/me') {
      const u = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
      return send(res, 200, { user: publicUser(u) });
    }
    if (user.role !== 'admin') return send(res, 403, { error: 'เฉพาะ AdminGod เท่านั้นที่จัดการสมาชิกได้' });

    if (req.method === 'GET' && url.pathname === '/admin/members') {
      const members = db.prepare(`SELECT id, role, created_at, expires_at, active FROM users WHERE role != 'admin' ORDER BY created_at DESC`).all();
      return send(res, 200, { members: members.map(publicUser) });
    }

    if (req.method === 'POST' && url.pathname === '/admin/members') {
      const b = await body(req);
      const id = String(b.id || '').trim();
      const password = String(b.password || '');
      if (!/^[A-Za-z0-9_.-]{3,40}$/.test(id)) return send(res, 400, { error: 'ไอดีต้องยาว 3–40 ตัว และใช้ a-z, A-Z, 0-9, _ . -' });
      if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
      let expiresAt;
      try { expiresAt = validExpiry(b.expiresAt); } catch (e) { return send(res, 400, { error: e.message }); }
      if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) return send(res, 400, { error: 'วันหมดอายุต้องเป็นอนาคต' });
      if (db.prepare('SELECT 1 FROM users WHERE lower(id) = lower(?)').get(id)) return send(res, 409, { error: 'ไอดีนี้มีอยู่แล้ว' });
      const p = hashPassword(password);
      db.prepare(`INSERT INTO users (id,password_hash,password_salt,role,created_at,expires_at,active,password_version)
                  VALUES (?,?,?,?,?,?,?,?)`).run(id, p.hash, p.salt, 'member', nowIso(), expiresAt, 1, 1);
      return send(res, 201, { ok: true });
    }

    const match = url.pathname.match(/^\/admin\/members\/([^/]+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      if (id === ADMIN_ID) return send(res, 400, { error: 'ไม่อนุญาตให้ลบบัญชีผู้ดูแล' });
      const target = db.prepare('SELECT * FROM users WHERE id = ? AND role != \'admin\'').get(id);
      if (!target) return send(res, 404, { error: 'ไม่พบบัญชีนี้' });

      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM users WHERE id = ?').run(id);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'PATCH') {
        const b = await body(req);
        const updates = [];
        const values = [];
        if (b.password !== undefined) {
          const password = String(b.password);
          if (password.length < 8 || password.length > 200) return send(res, 400, { error: 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร' });
          const p = hashPassword(password);
          updates.push('password_hash = ?', 'password_salt = ?', 'password_version = password_version + 1');
          values.push(p.hash, p.salt);
        }
        if (b.active !== undefined) {
          updates.push('active = ?');
          values.push(b.active ? 1 : 0);
        }
        if (b.expiresAt !== undefined) {
          let expiresAt;
          try { expiresAt = validExpiry(b.expiresAt); } catch (e) { return send(res, 400, { error: e.message }); }
          updates.push('expires_at = ?');
          values.push(expiresAt);
        }
        if (!updates.length) return send(res, 400, { error: 'ไม่มีข้อมูลสำหรับแก้ไข' });
        values.push(id);
        db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...values);
        return send(res, 200, { ok: true });
      }
    }

    return send(res, 404, { error: 'ไม่พบ endpoint' });
  } catch (e) {
    console.error(e);
    return send(res, 400, { error: e.message || 'คำขอไม่ถูกต้อง' });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`Kheitai Membership API listening on ${PORT}`));
