'use strict';
/* WADEH API + static server. Zero external dependencies (Node.js 22.13+).
   Every financial operation is SIMULATED against a local SQLite database. No real banking APIs are called. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const D = require('./db');
const ICS = require('./ics');
const WA = require('./webauthn');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SESSION_TTL = 30 * 60 * 1000;          // 30 min sliding session
const STEPUP_TTL = 2 * 60 * 1000;            // step-up confirmation token, single use
const MAX_PIN_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;
const MAX_TRANSFER = 5000000;                 // 50,000 SAR per simulated transfer
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };

class HttpError extends Error { constructor(status, code, message, extra) { super(message); this.status = status; this.code = code; this.extra = extra; } }
const bad = (code, msg, extra) => new HttpError(400, code, msg, extra);
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const rand = (n = 32) => crypto.randomBytes(n).toString('base64url');
const ref = (p) => p + '-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + crypto.randomInt(1000, 9999);
const sar = (h) => (h / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ر.س';

function toHalalas(v) {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  if (!Number.isFinite(n) || n <= 0) throw bad('invalid_amount', 'أدخل مبلغًا صحيحًا أكبر من صفر.');
  const h = Math.round(n * 100);
  if (Math.abs(n * 100 - h) > 1e-6) throw bad('invalid_amount', 'المبلغ يقبل خانتين عشريتين كحد أقصى.');
  return h;
}
function str(v, { max = 80, min = 1, name = 'الحقل' } = {}) {
  const s = String(v ?? '').trim().replace(/[\u0000-\u001f<>]/g, '');
  if (s.length < min) throw bad('invalid_input', `${name} مطلوب.`);
  if (s.length > max) throw bad('invalid_input', `${name} طويل جدًا.`);
  return s;
}
function isoDate(v, name = 'التاريخ') {
  const s = String(v || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s + 'T00:00:00Z'))) throw bad('invalid_date', `${name} غير صحيح.`);
  return s;
}

/* Simple fixed-window rate limiter (in-memory, per key). */
function limiter(limit, windowMs) {
  const hits = new Map();
  return (key) => {
    const now = Date.now(); const h = hits.get(key);
    if (!h || now - h.start > windowMs) { hits.set(key, { start: now, n: 1 }); return true; }
    h.n++; return h.n <= limit;
  };
}

function createApp({ dbFile = path.join(__dirname, '..', 'data', 'wadeh.db'), demoBiometric = process.env.WADEH_DEMO_BIOMETRIC !== 'off', publicUrl = process.env.PUBLIC_URL || '', trustProxy = process.env.TRUST_PROXY === '1', logger = console, authRateLimit = 20 } = {}) {
  const db = D.open(dbFile);
  D.ensureSeeded(db);
  const authLimit = limiter(authRateLimit, 60 * 1000);
  const apiLimit = limiter(300, 60 * 1000);
  const feedLimit = limiter(60, 60 * 1000);

  const q = {
    user: db.prepare('SELECT * FROM users WHERE id=?'),
    firstUser: db.prepare('SELECT * FROM users ORDER BY id LIMIT 1'),
    session: db.prepare('SELECT * FROM sessions WHERE id_hash=?'),
  };
  const prefsOf = (u) => ({ ...D.DEFAULT_PREFS, ...JSON.parse(u.prefs || '{}'), notify: { ...D.DEFAULT_PREFS.notify, ...(JSON.parse(u.prefs || '{}').notify || {}) } });

  /* ---------- request context ---------- */
  function originOf(req) {
    if (publicUrl) return publicUrl.replace(/\/$/, '');
    const proto = (trustProxy && req.headers['x-forwarded-proto']) || (req.socket.encrypted ? 'https' : 'http');
    return `${proto.split(',')[0]}://${req.headers.host}`;
  }
  const isHttps = (req) => originOf(req).startsWith('https://');
  const ipOf = (req) => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';
  function cookies(req) { const o = {}; for (const p of String(req.headers.cookie || '').split(';')) { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); } return o; }
  function setSessionCookie(req, res, token, maxAgeSec) {
    res.setHeader('Set-Cookie', `wadeh_sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`);
  }
  function startSession(req, res, userId, method) {
    const token = rand(32); const now = Date.now();
    db.prepare('INSERT INTO sessions (id_hash,user_id,method,created_at,expires_at,last_seen) VALUES (?,?,?,?,?,?)').run(sha(token), userId, method, now, now + SESSION_TTL, now);
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    setSessionCookie(req, res, token, SESSION_TTL / 1000);
    return token;
  }
  function currentUser(req, res) {
    const token = cookies(req).wadeh_sid; if (!token) return null;
    const s = q.session.get(sha(token)); const now = Date.now();
    if (!s || s.expires_at < now) return null;
    db.prepare('UPDATE sessions SET expires_at=?, last_seen=? WHERE id_hash=?').run(now + SESSION_TTL, now, s.id_hash);
    setSessionCookie(req, res, token, SESSION_TTL / 1000);
    return { ...q.user.get(s.user_id), session_method: s.method, session_hash: s.id_hash };
  }
  const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'unauthenticated', 'انتهت الجلسة. سجّل الدخول مرة أخرى.'); return ctx.user; };

  function notify(userId, kind, title, body, link, dedupeKey) {
    const u = q.user.get(userId); if (!u) return;
    const p = prefsOf(u);
    const map = { commitment: 'commitments', reminder: 'commitments', transfer: 'transfers', bill: 'transfers', card: 'cards', calendar: 'calendar', security: 'security' };
    if (map[kind] && p.notify[map[kind]] === false && kind !== 'security') return;
    db.prepare('INSERT OR IGNORE INTO notifications (user_id,kind,title,body,link,created_at,dedupe_key) VALUES (?,?,?,?,?,?,?)').run(userId, kind, title, body, link || null, Date.now(), dedupeKey || null);
  }

  /* ---------- Password verification with lockout (hash stored in pin_hash/pin_salt columns) ---------- */
  function checkPin(user, pin) {
    const now = Date.now();
    if (user.locked_until > now) throw new HttpError(423, 'locked', 'تم إيقاف المحاولات مؤقتًا بسبب إدخال خاطئ متكرر.', { retryAfter: Math.ceil((user.locked_until - now) / 1000) });
    const pw = String(pin ?? '');
    if (pw.length < 6 || pw.length > 64) throw new HttpError(401, 'wrong_password', 'رمز المرور غير صحيح.', { remaining: MAX_PIN_ATTEMPTS - user.failed_attempts });
    const ok = crypto.timingSafeEqual(Buffer.from(D.hashPin(pw, user.pin_salt), 'hex'), Buffer.from(user.pin_hash, 'hex'));
    if (!ok) {
      const attempts = user.failed_attempts + 1;
      if (attempts >= MAX_PIN_ATTEMPTS) {
        db.prepare('UPDATE users SET failed_attempts=0, locked_until=? WHERE id=?').run(now + LOCK_MS, user.id);
        notify(user.id, 'security', 'محاولات دخول خاطئة', 'تم إيقاف الدخول برمز المرور لمدة 5 دقائق بعد عدة محاولات خاطئة.', '#/profile');
        throw new HttpError(423, 'locked', 'تم إيقاف المحاولات لمدة 5 دقائق بسبب إدخال خاطئ متكرر.', { retryAfter: LOCK_MS / 1000 });
      }
      db.prepare('UPDATE users SET failed_attempts=? WHERE id=?').run(attempts, user.id);
      throw new HttpError(401, 'wrong_password', 'رمز المرور غير صحيح.', { remaining: MAX_PIN_ATTEMPTS - attempts });
    }
    db.prepare('UPDATE users SET failed_attempts=0, locked_until=0 WHERE id=?').run(user.id);
  }

  /* ---------- WebAuthn helpers ---------- */
  const rpIdOf = (req) => new URL(originOf(req)).hostname;
  function newChallenge(purpose, userId) {
    const id = rand(16); const challenge = rand(32);
    db.prepare('DELETE FROM challenges WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO challenges (id,user_id,purpose,challenge,expires_at) VALUES (?,?,?,?,?)').run(id, userId ?? null, purpose, challenge, Date.now() + 2 * 60 * 1000);
    return { id, challenge };
  }
  function takeChallenge(id, purpose) {
    const c = db.prepare('SELECT * FROM challenges WHERE id=? AND purpose=?').get(String(id || ''), purpose);
    db.prepare('DELETE FROM challenges WHERE id=?').run(String(id || ''));
    if (!c || c.expires_at < Date.now()) throw bad('challenge_expired', 'انتهت صلاحية طلب المصادقة. حاول مرة أخرى.');
    return c;
  }
  function verifyPasskeyAssertion(req, body, purpose, userId) {
    const ch = takeChallenge(body.challengeId, purpose);
    const cred = db.prepare('SELECT * FROM passkeys WHERE id=?').get(String(body.id || ''));
    if (!cred || (userId && cred.user_id !== userId)) throw new HttpError(401, 'unknown_passkey', 'مفتاح المرور غير معروف لهذا الحساب.');
    try {
      const r = WA.verifyAssertion(body, cred, { challenge: ch.challenge, origin: originOf(req), rpId: rpIdOf(req) });
      db.prepare('UPDATE passkeys SET sign_count=?, last_used=? WHERE id=?').run(r.signCount, Date.now(), cred.id);
      return cred;
    } catch (e) { throw new HttpError(401, 'passkey_failed', 'تعذّر التحقق من مفتاح المرور.', { detail: e.message }); }
  }
  function issueStepUp(userId, method) {
    const token = rand(24);
    db.prepare('DELETE FROM stepups WHERE expires_at < ?').run(Date.now());
    db.prepare('INSERT INTO stepups (token_hash,user_id,method,expires_at) VALUES (?,?,?,?)').run(sha(token), userId, method, Date.now() + STEPUP_TTL);
    return token;
  }
  function consumeStepUp(userId, token) {
    const row = db.prepare('SELECT * FROM stepups WHERE token_hash=?').get(sha(token || ''));
    if (row) db.prepare('DELETE FROM stepups WHERE token_hash=?').run(row.token_hash);
    if (!row || row.user_id !== userId || row.expires_at < Date.now()) throw new HttpError(403, 'stepup_required', 'يلزم تأكيد العملية برمز المرور أو Face ID.');
    return row.method;
  }

  /* ---------- read models ---------- */
  function commitmentRows(userId) {
    const rows = db.prepare(`SELECT c.*, b.name AS beneficiary_name,
      (SELECT COUNT(*) FROM commitment_payments p WHERE p.commitment_id=c.id) AS paid_count,
      (SELECT MAX(paid_at) FROM commitment_payments p WHERE p.commitment_id=c.id) AS last_paid_at
      FROM commitments c LEFT JOIN beneficiaries b ON b.id=c.beneficiary_id WHERE c.user_id=? ORDER BY c.status, c.due_date`).all(userId);
    const pays = db.prepare('SELECT period_date, amount, method, paid_at FROM commitment_payments WHERE commitment_id=? ORDER BY period_date');
    return rows.map((c) => ({ ...c, payments: pays.all(c.id) }));
  }
  const publicCard = (c) => ({ spentToday: db.prepare("SELECT COALESCE(SUM(amount),0) s FROM transactions WHERE card_id=? AND direction='out' AND created_at >= ?").get(c.id, Date.parse(D.todayISO() + 'T00:00:00+03:00')).s, id: c.id, name: c.name, kind: c.kind, network: c.network, last4: c.number.slice(-4), expiry: c.expiry, design: c.design, frozen: !!c.frozen, limitDaily: c.limit_daily, limitOnline: c.limit_online, onlineEnabled: !!c.online_enabled, contactlessEnabled: !!c.contactless_enabled });

  /* Create reminder notifications for commitments entering their reminder window (idempotent per due date). */
  function generateReminders(userId) {
    const today = D.todayISO();
    for (const c of db.prepare("SELECT * FROM commitments WHERE user_id=? AND status='active'").all(userId)) {
      const windowStart = D.addDays(c.due_date, -Math.max(c.reminder_days, 0));
      if (today >= windowStart && today <= c.due_date) {
        const days = Math.round((Date.parse(c.due_date) - Date.parse(today)) / 864e5);
        notify(userId, 'reminder', `تذكير: ${c.title}`, `${sar(c.amount)} مستحق ${days === 0 ? 'اليوم' : days === 1 ? 'غدًا' : `بعد ${days} أيام`}.`, `#/commitments?id=${c.id}`, `rem-${c.id}-${c.due_date}`);
      } else if (today > c.due_date) {
        notify(userId, 'reminder', `متأخر: ${c.title}`, `فات موعد ${sar(c.amount)}. يمكنك السداد أو تحديده كمدفوع.`, `#/commitments?id=${c.id}`, `late-${c.id}-${c.due_date}`);
      }
    }
  }

  function bootstrap(user, req) {
    generateReminders(user.id);
    const u = q.user.get(user.id);
    const feed = db.prepare('SELECT created_at,last_fetched_at,last_client,fetch_count FROM calendar_feeds WHERE user_id=?').get(user.id);
    return {
      me: { name: u.name, fullName: u.full_name, phone: u.phone_masked, accountNumber: u.account_number, iban: u.iban, balance: u.balance, prefs: prefsOf(u), sessionMethod: user.session_method },
      today: D.todayISO(),
      passkeys: db.prepare('SELECT id,label,created_at,last_used FROM passkeys WHERE user_id=? ORDER BY created_at').all(user.id),
      beneficiaries: db.prepare('SELECT id,name,bank,iban_last4,last_used FROM beneficiaries WHERE user_id=? ORDER BY COALESCE(last_used,0) DESC, name').all(user.id),
      transactions: db.prepare('SELECT id,direction,title,category,amount,reference,note,created_at,beneficiary_id,card_id,bill_id,commitment_id FROM transactions WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 100').all(user.id),
      cards: db.prepare('SELECT * FROM cards WHERE user_id=? ORDER BY id').all(user.id).map(publicCard),
      bills: db.prepare('SELECT * FROM bills WHERE user_id=? ORDER BY status, due_date').all(user.id),
      commitments: commitmentRows(user.id),
      notifications: db.prepare('SELECT id,kind,title,body,link,created_at,read_at FROM notifications WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 80').all(user.id),
      widget: (() => { const w = db.prepare('SELECT created_at,last_fetched_at FROM widget_tokens WHERE user_id=?').get(user.id); return w ? { active: true, lastFetchedAt: w.last_fetched_at } : { active: false }; })(),
      calendarFeed: feed ? { active: true, createdAt: feed.created_at, lastFetchedAt: feed.last_fetched_at, lastClient: feed.last_client, fetchCount: feed.fetch_count } : { active: false },
      capabilities: { demoBiometric, https: isHttps(req), origin: originOf(req) },
    };
  }

  /* ---------- domain operations ---------- */
  function markCommitmentPaid(userId, id, method) {
    const c = db.prepare('SELECT * FROM commitments WHERE id=? AND user_id=?').get(id, userId);
    if (!c) throw new HttpError(404, 'not_found', 'الالتزام غير موجود.');
    if (c.status === 'completed') throw bad('already_completed', 'هذا الالتزام مكتمل.');
    db.prepare('INSERT OR IGNORE INTO commitment_payments (commitment_id,period_date,amount,method,paid_at) VALUES (?,?,?,?,?)').run(c.id, c.due_date, c.amount, method, Date.now());
    const paid = db.prepare('SELECT COUNT(*) n FROM commitment_payments WHERE commitment_id=?').get(c.id).n;
    const done = c.recurrence === 'none' || (c.total_payments && paid >= c.total_payments);
    if (done) db.prepare("UPDATE commitments SET status='completed', sequence=sequence+1, updated_at=? WHERE id=?").run(Date.now(), c.id);
    else db.prepare('UPDATE commitments SET due_date=?, sequence=sequence+1, updated_at=? WHERE id=?').run(D.addMonths(c.due_date, 1), Date.now(), c.id);
    if (c.bill_id) db.prepare("UPDATE bills SET status='paid', paid_at=? WHERE id=? AND user_id=?").run(Date.now(), c.bill_id, userId);
    return { completed: !!done };
  }

  function debit(user, { amount, title, category, note, idemKey, beneficiaryId = null, billId = null, commitmentId = null }) {
    if (!idemKey || !/^[A-Za-z0-9_-]{8,64}$/.test(idemKey)) throw bad('idempotency_required', 'معرّف العملية مفقود.');
    const existing = db.prepare('SELECT * FROM transactions WHERE user_id=? AND idem_key=?').get(user.id, idemKey);
    if (existing) return { tx: existing, duplicate: true };
    const fresh = q.user.get(user.id);
    if (amount > fresh.balance) throw new HttpError(422, 'insufficient_balance', 'الرصيد غير كافٍ لإتمام العملية.', { balance: fresh.balance });
    db.prepare('UPDATE users SET balance=balance-? WHERE id=?').run(amount, user.id);
    const r = db.prepare(`INSERT INTO transactions (user_id,direction,title,category,amount,reference,note,created_at,beneficiary_id,bill_id,commitment_id,idem_key)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(user.id, 'out', title, category, amount, ref(billId ? 'BIL' : 'TRX'), note || null, Date.now(), beneficiaryId, billId, commitmentId, idemKey);
    return { tx: db.prepare('SELECT * FROM transactions WHERE id=?').get(Number(r.lastInsertRowid)), duplicate: false };
  }

  /* ---------- routes ---------- */
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, opts });

  route('GET', '/api/health', () => ({ ok: true, time: new Date().toISOString() }));

  route('GET', '/api/session', (ctx) => ({ authenticated: !!ctx.user, greetingName: q.firstUser.get().name, demoPhone: D.DEMO_PHONE, demoBiometric, hasPasskeys: !!db.prepare('SELECT 1 FROM passkeys LIMIT 1').get() }));

  route('POST', '/api/auth/login', (ctx) => {
    const phone = String(ctx.body.phone || '').replace(/[\s-]/g, '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    if (!/^05\d{8}$/.test(phone)) throw bad('invalid_mobile', 'أدخل رقم جوال سعودي من 10 أرقام يبدأ بـ 05.');
    const u = db.prepare('SELECT * FROM users WHERE phone=?').get(phone);
    if (!u) throw new HttpError(401, 'wrong_credentials', 'رمز المرور غير صحيح.');
    checkPin(u, ctx.body.password);
    startSession(ctx.req, ctx.res, u.id, 'password');
    return { ok: true };
  }, { auth: true });

  route('POST', '/api/auth/demo-biometric', (ctx) => {
    if (!demoBiometric) throw new HttpError(403, 'disabled', 'محاكاة Face ID معطلة على هذا الخادم.');
    const u = q.firstUser.get();
    startSession(ctx.req, ctx.res, u.id, 'demo-biometric');
    return { ok: true, simulated: true };
  }, { auth: true });

  route('POST', '/api/auth/passkey/options', (ctx) => {
    const purpose = ctx.body.purpose === 'stepup' ? 'stepup' : 'login';
    if (purpose === 'stepup') requireUser(ctx);
    const uid = purpose === 'stepup' ? ctx.user.id : null;
    const creds = uid ? db.prepare('SELECT id FROM passkeys WHERE user_id=?').all(uid) : db.prepare('SELECT id FROM passkeys').all();
    if (!creds.length) throw bad('no_passkeys', 'لا يوجد مفتاح مرور مسجّل. فعّل Face ID من الإعدادات أولًا.');
    const { id, challenge } = newChallenge(purpose, uid);
    return { challengeId: id, challenge, rpId: rpIdOf(ctx.req), allowCredentials: creds.map((c) => c.id), timeout: 60000, userVerification: 'required' };
  }, { auth: true });

  route('POST', '/api/auth/passkey/login', (ctx) => {
    const cred = verifyPasskeyAssertion(ctx.req, ctx.body, 'login');
    startSession(ctx.req, ctx.res, cred.user_id, 'passkey');
    return { ok: true };
  }, { auth: true });

  route('POST', '/api/auth/passkey/register/options', (ctx) => {
    const u = requireUser(ctx);
    const { id, challenge } = newChallenge('register', u.id);
    return { challengeId: id, challenge, rp: { id: rpIdOf(ctx.req), name: 'واضح WADEH' }, user: { id: WA.b64u.enc(Buffer.from('wadeh-user-' + u.id)), name: 'mohammed@wadeh.demo', displayName: u.full_name },
      excludeCredentials: db.prepare('SELECT id FROM passkeys WHERE user_id=?').all(u.id).map((c) => c.id) };
  });

  route('POST', '/api/auth/passkey/register', (ctx) => {
    const u = requireUser(ctx);
    const ch = takeChallenge(ctx.body.challengeId, 'register');
    if (ch.user_id !== u.id) throw new HttpError(403, 'forbidden', 'طلب غير مسموح.');
    let r;
    try { r = WA.verifyRegistration(ctx.body, { challenge: ch.challenge, origin: originOf(ctx.req), rpId: rpIdOf(ctx.req) }); } catch (e) { throw bad('passkey_register_failed', 'تعذّر تسجيل مفتاح المرور.', { detail: e.message }); }
    const credId = String(ctx.body.id || ''); if (!/^[A-Za-z0-9_-]{16,512}$/.test(credId)) throw bad('invalid_credential', 'معرّف المفتاح غير صالح.');
    const label = str(ctx.body.label || 'هذا الجهاز', { max: 40, name: 'اسم الجهاز' });
    db.prepare('INSERT INTO passkeys (id,user_id,public_key,alg,sign_count,label,created_at) VALUES (?,?,?,?,?,?,?)').run(credId, u.id, r.publicKey, r.alg, r.signCount, label, Date.now());
    notify(u.id, 'security', 'تم تفعيل Face ID / مفتاح مرور', `تمت إضافة مفتاح مرور جديد (${label}) إلى حسابك.`, '#/profile');
    return { ok: true };
  });

  route('DELETE', '/api/passkeys/:id', (ctx) => {
    const u = requireUser(ctx);
    db.prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(decodeURIComponent(ctx.params.id), u.id);
    notify(u.id, 'security', 'تم حذف مفتاح مرور', 'تمت إزالة مفتاح مرور من حسابك.', '#/profile');
    return { ok: true };
  });

  /* Step-up: confirm a sensitive action (transfer, bill payment, card details) with PIN, passkey or the labelled demo. */
  route('POST', '/api/auth/stepup', (ctx) => {
    const u = requireUser(ctx);
    const m = ctx.body.method;
    if (m === 'password' || m === 'pin') checkPin(q.user.get(u.id), ctx.body.password ?? ctx.body.pin);
    else if (m === 'passkey') verifyPasskeyAssertion(ctx.req, ctx.body, 'stepup', u.id);
    else if (m === 'demo-biometric') { if (!demoBiometric) throw new HttpError(403, 'disabled', 'محاكاة Face ID معطلة.'); }
    else throw bad('invalid_method', 'طريقة تأكيد غير معروفة.');
    return { stepUpToken: issueStepUp(u.id, m), expiresIn: STEPUP_TTL / 1000 };
  }, { auth: true });

  route('POST', '/api/auth/logout', (ctx) => {
    if (ctx.user) db.prepare('DELETE FROM sessions WHERE id_hash=?').run(ctx.user.session_hash);
    ctx.res.setHeader('Set-Cookie', 'wadeh_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { ok: true };
  });

  route('POST', '/api/auth/password/change', (ctx) => {
    const u = requireUser(ctx);
    checkPin(q.user.get(u.id), ctx.body.currentPassword);
    const np = String(ctx.body.newPassword || '');
    if (!/^\d{6}$/.test(np)) throw bad('weak_password', 'رمز المرور الجديد 6 أرقام.');
    if (/^(\d)\1+$/.test(np) || '0123456789'.includes(np) || '9876543210'.includes(np)) throw bad('weak_password', 'اختر رمزًا أقوى — تجنّب الأرقام المتكررة أو المتسلسلة.');
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('UPDATE users SET pin_hash=?, pin_salt=? WHERE id=?').run(D.hashPin(np, salt), salt, u.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND id_hash<>?').run(u.id, u.session_hash);
    notify(u.id, 'security', 'تم تغيير رمز المرور', 'تم تحديث رمز المرور وإنهاء الجلسات الأخرى.', '#/security');
    return { ok: true };
  });

  route('GET', '/api/bootstrap', (ctx) => bootstrap(requireUser(ctx), ctx.req));

  route('PATCH', '/api/prefs', (ctx) => {
    const u = requireUser(ctx); const p = prefsOf(q.user.get(u.id)); const b = ctx.body;
    if ('hideBalance' in b) p.hideBalance = !!b.hideBalance;
    if ('feedIncludeBills' in b) p.feedIncludeBills = !!b.feedIncludeBills;
    if ('reminderTime' in b) { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(b.reminderTime)) throw bad('invalid_time', 'وقت غير صحيح.'); p.reminderTime = b.reminderTime; }
    if (b.notify && typeof b.notify === 'object') for (const k of Object.keys(D.DEFAULT_PREFS.notify)) if (k in b.notify) p.notify[k] = k === 'security' ? true : !!b.notify[k];
    if ('language' in b) p.language = b.language === 'en' ? 'en' : 'ar';
    if (b.budget && Array.isArray(b.budget.items)) {
      const items = p.budget.items.map((it) => { const n = b.budget.items.find((x) => x.key === it.key); return n ? { ...it, amount: n.amount === 0 || n.amount === '0' ? 0 : toHalalas(n.amount) } : it; });
      const sum = items.reduce((a, x) => a + x.amount, 0);
      if (sum > p.budget.total) throw bad('budget_exceeded', `مجموع الفئات (${sar(sum)}) يتجاوز الميزانية الشهرية ${sar(p.budget.total)}.`);
      p.budget = { ...p.budget, items };
    }
    db.prepare('UPDATE users SET prefs=? WHERE id=?').run(JSON.stringify(p), u.id);
    return { prefs: p };
  });

  route('POST', '/api/beneficiaries', (ctx) => {
    const u = requireUser(ctx);
    const name = str(ctx.body.name, { max: 50, min: 2, name: 'اسم المستفيد' });
    const bank = str(ctx.body.bank || 'بنك تجريبي', { max: 40, name: 'البنك' });
    const iban = String(ctx.body.iban || '').replace(/\s+/g, '').toUpperCase();
    if (!/^SA\d{22}$/.test(iban)) throw bad('invalid_iban', 'رقم الآيبان يجب أن يبدأ بـ SA ويتبعه 22 رقمًا (استخدم رقمًا تجريبيًا).');
    if (db.prepare('SELECT 1 FROM beneficiaries WHERE user_id=? AND name=? AND iban_last4=?').get(u.id, name, iban.slice(-4))) throw bad('duplicate', 'هذا المستفيد محفوظ مسبقًا.');
    // Only the last 4 digits are kept — the demo never stores full account numbers.
    const r = db.prepare('INSERT INTO beneficiaries (user_id,name,bank,iban_last4,created_at) VALUES (?,?,?,?,?)').run(u.id, name, bank, iban.slice(-4), Date.now());
    return { id: Number(r.lastInsertRowid) };
  });

  route('POST', '/api/transfers', (ctx) => {
    const u = requireUser(ctx); const b = ctx.body;
    const amount = toHalalas(b.amount);
    if (amount > MAX_TRANSFER) throw bad('limit_exceeded', 'الحد الأقصى للتحويل التجريبي 50,000.00 ر.س.');
    const ben = db.prepare('SELECT * FROM beneficiaries WHERE id=? AND user_id=?').get(Number(b.beneficiaryId), u.id);
    if (!ben) throw bad('invalid_beneficiary', 'اختر مستفيدًا محفوظًا.');
    const note = b.note ? str(b.note, { max: 80, name: 'الملاحظة' }) : null;
    // Idempotent replay first (so a double-tap after success returns the same receipt and does not need a 2nd step-up).
    const prior = db.prepare('SELECT * FROM transactions WHERE user_id=? AND idem_key=?').get(u.id, String(b.idempotencyKey || ''));
    if (prior) return { transaction: prior, duplicate: true, balance: q.user.get(u.id).balance };
    const method = consumeStepUp(u.id, b.stepUpToken);
    const out = D.tx(db, () => {
      const commitmentId = b.commitmentId ? Number(b.commitmentId) : null;
      const r = debit(u, { amount, title: 'تحويل إلى ' + ben.name, category: commitmentId ? 'التزامات' : 'تحويلات', note, idemKey: String(b.idempotencyKey || ''), beneficiaryId: ben.id, commitmentId });
      db.prepare('UPDATE beneficiaries SET last_used=? WHERE id=?').run(Date.now(), ben.id);
      let commitment = null;
      if (commitmentId && !r.duplicate) commitment = markCommitmentPaid(u.id, commitmentId, 'transfer');
      return { ...r, commitment };
    });
    if (!out.duplicate) notify(u.id, 'transfer', 'تم التحويل بنجاح', `تم تحويل ${sar(amount)} إلى ${ben.name} (عملية محاكاة). المرجع ${out.tx.reference}.`, '#/history');
    return { transaction: out.tx, duplicate: out.duplicate, confirmedWith: method, balance: q.user.get(u.id).balance, commitment: out.commitment };
  });

  /* Simulated top-up (kept from the original prototype). Clearly labelled; no card or Apple Pay is charged. */
  route('POST', '/api/topup', (ctx) => {
    const u = requireUser(ctx); const amount = toHalalas(ctx.body.amount);
    if (amount > 1000000) throw bad('limit_exceeded', 'الحد الأقصى للشحن التجريبي 10,000.00 ر.س.');
    const key = String(ctx.body.idempotencyKey || '');
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) throw bad('idempotency_required', 'معرّف العملية مفقود.');
    const prior = db.prepare('SELECT * FROM transactions WHERE user_id=? AND idem_key=?').get(u.id, key);
    if (prior) return { transaction: prior, duplicate: true, balance: q.user.get(u.id).balance };
    const t = D.tx(db, () => {
      db.prepare('UPDATE users SET balance=balance+? WHERE id=?').run(amount, u.id);
      const r = db.prepare(`INSERT INTO transactions (user_id,direction,title,category,amount,reference,created_at,idem_key) VALUES (?,?,?,?,?,?,?,?)`).run(u.id, 'in', 'شحن رصيد تجريبي', 'شحن', amount, ref('TOP'), Date.now(), key);
      return db.prepare('SELECT * FROM transactions WHERE id=?').get(Number(r.lastInsertRowid));
    });
    notify(u.id, 'transfer', 'تم شحن الرصيد', `أُضيف ${sar(amount)} إلى رصيدك التجريبي.`, '#/history');
    return { transaction: t, duplicate: false, balance: q.user.get(u.id).balance };
  });

  route('POST', '/api/cards/:id/freeze', (ctx) => {
    const u = requireUser(ctx);
    const c = db.prepare('SELECT * FROM cards WHERE id=? AND user_id=?').get(Number(ctx.params.id), u.id);
    if (!c) throw new HttpError(404, 'not_found', 'البطاقة غير موجودة.');
    const frozen = !!ctx.body.frozen;
    db.prepare('UPDATE cards SET frozen=? WHERE id=?').run(frozen ? 1 : 0, c.id);
    notify(u.id, 'card', frozen ? 'تم تجميد البطاقة' : 'تم إلغاء تجميد البطاقة', `${c.name} •••• ${c.number.slice(-4)} ${frozen ? 'مجمّدة الآن ولن تقبل أي عملية.' : 'نشطة ويمكن استخدامها.'}`, '#/cards');
    return { card: publicCard(db.prepare('SELECT * FROM cards WHERE id=?').get(c.id)) };
  });

  route('PATCH', '/api/cards/:id/limits', (ctx) => {
    const u = requireUser(ctx); const b = ctx.body;
    const c = db.prepare('SELECT * FROM cards WHERE id=? AND user_id=?').get(Number(ctx.params.id), u.id);
    if (!c) throw new HttpError(404, 'not_found', 'البطاقة غير موجودة.');
    const daily = 'limitDaily' in b ? toHalalas(b.limitDaily) : c.limit_daily;
    const online = 'limitOnline' in b ? toHalalas(b.limitOnline) : c.limit_online;
    if (daily > 2000000 || online > 2000000) throw bad('limit_exceeded', 'الحد الأعلى المسموح 20,000.00 ر.س.');
    if (online > daily) throw bad('invalid_limits', 'حد الشراء الإلكتروني لا يتجاوز الحد اليومي.');
    db.prepare('UPDATE cards SET limit_daily=?, limit_online=?, online_enabled=?, contactless_enabled=? WHERE id=?').run(daily, online,
      'onlineEnabled' in b ? (b.onlineEnabled ? 1 : 0) : c.online_enabled, 'contactlessEnabled' in b ? (b.contactlessEnabled ? 1 : 0) : c.contactless_enabled, c.id);
    notify(u.id, 'card', 'تم تحديث حدود البطاقة', `${c.name}: الحد اليومي ${sar(daily)}، الشراء الإلكتروني ${sar(online)}.`, '#/cards');
    return { card: publicCard(db.prepare('SELECT * FROM cards WHERE id=?').get(c.id)) };
  });

  route('POST', '/api/cards/:id/reveal', (ctx) => {
    const u = requireUser(ctx);
    const c = db.prepare('SELECT * FROM cards WHERE id=? AND user_id=?').get(Number(ctx.params.id), u.id);
    if (!c) throw new HttpError(404, 'not_found', 'البطاقة غير موجودة.');
    consumeStepUp(u.id, ctx.body.stepUpToken);
    notify(u.id, 'security', 'تم عرض بيانات البطاقة', `تم عرض بيانات ${c.name} بعد التحقق من هويتك.`, '#/cards');
    return { number: c.number, expiry: c.expiry, cvv: c.cvv, holder: u.full_name, visibleFor: 30 };
  });

  function commitmentInput(b, existing) {
    const types = ['installment', 'bill', 'subscription', 'personal', 'savings_group'];
    const type = b.type ?? existing?.type; if (!types.includes(type)) throw bad('invalid_type', 'نوع الالتزام غير صحيح.');
    const out = {
      type, title: str(b.title ?? existing?.title, { max: 60, min: 2, name: 'اسم الالتزام' }),
      amount: 'amount' in b || !existing ? toHalalas(b.amount) : existing.amount,
      due_date: isoDate(b.dueDate ?? existing?.due_date, 'تاريخ الاستحقاق'),
      recurrence: (b.recurrence ?? existing?.recurrence) === 'monthly' ? 'monthly' : 'none',
      reminder_days: Math.min(14, Math.max(0, Number(b.reminderDays ?? existing?.reminder_days ?? 1) | 0)),
      total_payments: null, start_date: null, payout_index: null,
      beneficiary_id: b.beneficiaryId ? Number(b.beneficiaryId) : (b.beneficiaryId === null ? null : existing?.beneficiary_id ?? null),
      notes: b.notes != null && b.notes !== '' ? str(b.notes, { max: 140, name: 'الملاحظات' }) : (b.notes === '' ? null : existing?.notes ?? null),
    };
    const tp = 'totalPayments' in b ? b.totalPayments : existing?.total_payments;
    if (type === 'savings_group') {
      out.recurrence = 'monthly';
      out.total_payments = Number(tp); if (!Number.isInteger(out.total_payments) || out.total_payments < 2 || out.total_payments > 36) throw bad('invalid_members', 'عدد أشهر الجمعية بين 2 و 36.');
      out.start_date = isoDate(b.startDate ?? existing?.start_date ?? out.due_date, 'تاريخ البداية');
      out.payout_index = Number(b.payoutIndex ?? existing?.payout_index); if (!Number.isInteger(out.payout_index) || out.payout_index < 1 || out.payout_index > out.total_payments) throw bad('invalid_payout', 'شهر الاستلام يجب أن يكون ضمن مدة الجمعية.');
      if (!existing || 'startDate' in b) out.due_date = out.due_date < out.start_date ? out.start_date : out.due_date;
    } else if (out.recurrence === 'monthly' && tp) {
      out.total_payments = Number(tp); if (!Number.isInteger(out.total_payments) || out.total_payments < 1 || out.total_payments > 360) throw bad('invalid_count', 'عدد الدفعات غير صحيح.');
    }
    return out;
  }

  route('POST', '/api/commitments', (ctx) => {
    const u = requireUser(ctx); const c = commitmentInput(ctx.body); const now = Date.now();
    if (c.beneficiary_id && !db.prepare('SELECT 1 FROM beneficiaries WHERE id=? AND user_id=?').get(c.beneficiary_id, u.id)) throw bad('invalid_beneficiary', 'المستفيد غير موجود.');
    const r = db.prepare(`INSERT INTO commitments (user_id,type,title,amount,due_date,recurrence,total_payments,start_date,payout_index,reminder_days,beneficiary_id,bill_id,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(u.id, c.type, c.title, c.amount, c.due_date, c.recurrence, c.total_payments, c.start_date, c.payout_index, c.reminder_days, c.beneficiary_id, null, c.notes, now, now);
    return { id: Number(r.lastInsertRowid) };
  });

  route('PATCH', '/api/commitments/:id', (ctx) => {
    const u = requireUser(ctx);
    const ex = db.prepare('SELECT * FROM commitments WHERE id=? AND user_id=?').get(Number(ctx.params.id), u.id);
    if (!ex) throw new HttpError(404, 'not_found', 'الالتزام غير موجود.');
    const c = commitmentInput(ctx.body, ex);
    db.prepare(`UPDATE commitments SET type=?,title=?,amount=?,due_date=?,recurrence=?,total_payments=?,start_date=?,payout_index=?,reminder_days=?,beneficiary_id=?,notes=?,sequence=sequence+1,updated_at=? WHERE id=?`)
      .run(c.type, c.title, c.amount, c.due_date, c.recurrence, c.total_payments, c.start_date, c.payout_index, c.reminder_days, c.beneficiary_id, c.notes, Date.now(), ex.id);
    return { ok: true };
  });

  route('DELETE', '/api/commitments/:id', (ctx) => {
    const u = requireUser(ctx);
    const r = db.prepare('DELETE FROM commitments WHERE id=? AND user_id=?').run(Number(ctx.params.id), u.id);
    if (!r.changes) throw new HttpError(404, 'not_found', 'الالتزام غير موجود.');
    db.prepare('UPDATE bills SET commitment_id=NULL WHERE commitment_id=? AND user_id=?').run(Number(ctx.params.id), u.id);
    return { ok: true };
  });

  route('POST', '/api/commitments/:id/mark-paid', (ctx) => {
    const u = requireUser(ctx);
    return D.tx(db, () => markCommitmentPaid(u.id, Number(ctx.params.id), 'manual'));
  });

  route('POST', '/api/bills', (ctx) => {
    const u = requireUser(ctx); const b = ctx.body;
    const cats = ['electricity', 'water', 'mobile', 'internet', 'other'];
    const r = db.prepare('INSERT INTO bills (user_id,biller,category,account_ref,amount,due_date,status) VALUES (?,?,?,?,?,?,?)').run(u.id,
      str(b.biller, { max: 40, min: 2, name: 'اسم الجهة' }), cats.includes(b.category) ? b.category : 'other', str(b.accountRef, { max: 30, min: 3, name: 'رقم الحساب' }), toHalalas(b.amount), isoDate(b.dueDate, 'تاريخ الاستحقاق'), 'due');
    return { id: Number(r.lastInsertRowid) };
  });

  route('POST', '/api/bills/:id/pay', (ctx) => {
    const u = requireUser(ctx);
    const bill = db.prepare('SELECT * FROM bills WHERE id=? AND user_id=?').get(Number(ctx.params.id), u.id);
    if (!bill) throw new HttpError(404, 'not_found', 'الفاتورة غير موجودة.');
    const prior = db.prepare('SELECT * FROM transactions WHERE user_id=? AND idem_key=?').get(u.id, String(ctx.body.idempotencyKey || ''));
    if (prior) return { transaction: prior, duplicate: true, balance: q.user.get(u.id).balance };
    if (bill.status === 'paid') throw bad('already_paid', 'تم سداد هذه الفاتورة مسبقًا.');
    consumeStepUp(u.id, ctx.body.stepUpToken);
    const out = D.tx(db, () => {
      const r = debit(u, { amount: bill.amount, title: 'سداد فاتورة ' + bill.biller, category: 'فواتير', idemKey: String(ctx.body.idempotencyKey || ''), billId: bill.id });
      db.prepare("UPDATE bills SET status='paid', paid_at=? WHERE id=?").run(Date.now(), bill.id);
      if (bill.commitment_id) { const c = db.prepare("SELECT * FROM commitments WHERE id=? AND status='active'").get(bill.commitment_id); if (c) markCommitmentPaid(u.id, c.id, 'bill'); }
      return r;
    });
    notify(u.id, 'bill', 'تم سداد الفاتورة', `تم سداد فاتورة ${bill.biller} بمبلغ ${sar(bill.amount)} (محاكاة).`, '#/bills');
    return { transaction: out.tx, duplicate: out.duplicate, balance: q.user.get(u.id).balance };
  });

  route('POST', '/api/bills/:id/to-commitment', (ctx) => {
    const u = requireUser(ctx);
    const bill = db.prepare('SELECT * FROM bills WHERE id=? AND user_id=?').get(Number(ctx.params.id), u.id);
    if (!bill) throw new HttpError(404, 'not_found', 'الفاتورة غير موجودة.');
    if (bill.commitment_id && db.prepare('SELECT 1 FROM commitments WHERE id=?').get(bill.commitment_id)) return { id: bill.commitment_id, existing: true };
    const now = Date.now();
    const r = db.prepare(`INSERT INTO commitments (user_id,type,title,amount,due_date,recurrence,reminder_days,bill_id,notes,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(u.id, 'bill', 'فاتورة ' + bill.biller, bill.amount, bill.due_date, 'monthly', 2, bill.id, 'رقم الحساب ' + bill.account_ref, now, now);
    const id = Number(r.lastInsertRowid);
    db.prepare('UPDATE bills SET commitment_id=? WHERE id=?').run(id, bill.id);
    return { id, existing: false };
  });

  route('POST', '/api/notifications/:id/read', (ctx) => {
    const u = requireUser(ctx);
    db.prepare('UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?').run(Date.now(), Number(ctx.params.id), u.id);
    return { ok: true };
  });
  route('POST', '/api/notifications/read-all', (ctx) => {
    const u = requireUser(ctx);
    db.prepare('UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL').run(Date.now(), u.id);
    return { ok: true };
  });

  /* ----- Calendar: Method A (single event .ics) ----- */
  route('GET', '/api/calendar/commitment/:id', (ctx) => {
    const u = requireUser(ctx);
    const c = commitmentRows(u.id).find((x) => x.id === Number(ctx.params.id));
    if (!c) throw new HttpError(404, 'not_found', 'الالتزام غير موجود.');
    const p = prefsOf(q.user.get(u.id));
    const body = ICS.calendar([ICS.commitmentEvent(c, { reminderTime: p.reminderTime })], { name: 'واضح | ' + c.title });
    return { raw: body, type: 'text/calendar; charset=utf-8', headers: { 'Content-Disposition': `inline; filename="wadeh-commitment-${c.id}.ics"`, 'Cache-Control': 'no-store' } };
  });

  /* One-time, short-lived download link for the single event. iOS opens .ics links in a separate Safari view that
     does not share the PWA's cookies, so the link itself carries a random single-use token (5 minutes). */
  const icsLinks = new Map();
  route('POST', '/api/calendar/commitment/:id/link', (ctx) => {
    const u = requireUser(ctx);
    const c = db.prepare('SELECT id FROM commitments WHERE id=? AND user_id=?').get(Number(ctx.params.id), u.id);
    if (!c) throw new HttpError(404, 'not_found', 'الالتزام غير موجود.');
    for (const [k, v] of icsLinks) if (v.exp < Date.now()) icsLinks.delete(k);
    const token = rand(24);
    icsLinks.set(token, { userId: u.id, commitmentId: c.id, exp: Date.now() + 5 * 60 * 1000 });
    return { url: `/ics/${token}/wadeh-${c.id}.ics` };
  });
  function serveOneTimeIcs(req, res, token) {
    const l = icsLinks.get(token); icsLinks.delete(token);
    if (!l || l.exp < Date.now()) return send(res, 410, 'انتهت صلاحية الرابط. ارجع إلى واضح واضغط «إضافة إلى التقويم» مرة أخرى.', 'text/plain; charset=utf-8');
    const c = commitmentRows(l.userId).find((x) => x.id === l.commitmentId);
    if (!c) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const p = prefsOf(q.user.get(l.userId));
    const body = ICS.calendar([ICS.commitmentEvent(c, { reminderTime: p.reminderTime })], { name: 'واضح | ' + c.title });
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `inline; filename="wadeh-${c.id}.ics"`, 'Cache-Control': 'no-store' });
    res.end(body);
  }

  /* ----- Calendar: Method B (secure per-user subscription feed) ----- */
  route('POST', '/api/calendar/feed', (ctx) => {
    const u = requireUser(ctx);
    const token = rand(32); // 256-bit capability token; only its SHA-256 hash is stored
    db.prepare(`INSERT INTO calendar_feeds (user_id,token_hash,created_at) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, created_at=excluded.created_at, last_fetched_at=NULL, last_client=NULL, fetch_count=0`).run(u.id, sha(token), Date.now());
    notify(u.id, 'calendar', 'تم إنشاء رابط تقويم واضح', 'أكمل الاشتراك من تطبيق التقويم. ستظهر الحالة «متصل» بعد أول مزامنة من جهازك.', '#/profile');
    const httpsUrl = `${originOf(ctx.req)}/cal/${token}.ics`;
    return { httpsUrl, webcalUrl: httpsUrl.replace(/^https?:/, 'webcal:'), secureOrigin: isHttps(ctx.req) };
  });
  route('DELETE', '/api/calendar/feed', (ctx) => {
    const u = requireUser(ctx);
    db.prepare('DELETE FROM calendar_feeds WHERE user_id=?').run(u.id);
    notify(u.id, 'calendar', 'تم إلغاء رابط التقويم', 'لن يتلقى التقويم المشترك أي تحديثات جديدة. احذف الاشتراك من تطبيق التقويم أيضًا.', '#/profile');
    return { ok: true };
  });

  /* ----- Home-screen balance widget (Scriptable on iOS) — secret, revocable read-only link ----- */
  route('POST', '/api/widget/token', (ctx) => {
    const u = requireUser(ctx);
    const token = rand(32);
    db.prepare(`INSERT INTO widget_tokens (user_id,token_hash,created_at) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET token_hash=excluded.token_hash, created_at=excluded.created_at, last_fetched_at=NULL, fetch_count=0`).run(u.id, sha(token), Date.now());
    notify(u.id, 'security', 'تم إنشاء رابط الويدجت', 'رابط قراءة فقط لعرض الرصيد على الشاشة الرئيسية. يمكنك إلغاؤه في أي وقت.', '#/widget');
    return { url: `${originOf(ctx.req)}/w/${token}.json`, appUrl: originOf(ctx.req) };
  });
  route('DELETE', '/api/widget/token', (ctx) => {
    const u = requireUser(ctx);
    db.prepare('DELETE FROM widget_tokens WHERE user_id=?').run(u.id);
    return { ok: true };
  });

  function serveWidget(req, res, token) {
    if (!feedLimit(ipOf(req))) return send(res, 429, { error: 'rate_limited' });
    const w = /^[A-Za-z0-9_-]{43}$/.test(token) && db.prepare('SELECT * FROM widget_tokens WHERE token_hash=?').get(sha(token));
    if (!w) return send(res, 404, { error: 'not_found' });
    const u = q.user.get(w.user_id); const p = prefsOf(u); const hidden = !!p.hideBalance;
    const upcoming = commitmentRows(u.id).filter((c) => c.status === 'active').sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 4)
      .map((c) => ({ title: c.title, date: c.due_date, amount: hidden ? null : c.amount }));
    const recent = db.prepare('SELECT title, direction, amount, created_at FROM transactions WHERE user_id=? ORDER BY created_at DESC, id DESC LIMIT 3').all(u.id)
      .map((t) => ({ title: t.title, direction: t.direction, amount: hidden ? null : t.amount, at: t.created_at }));
    db.prepare('UPDATE widget_tokens SET last_fetched_at=?, fetch_count=fetch_count+1 WHERE user_id=?').run(Date.now(), u.id);
    send(res, 200, { name: u.name, account: u.account_number.slice(-4), hidden, balance: hidden ? null : u.balance, upcoming, recent, today: D.todayISO(), updatedAt: Date.now() },
      'application/json; charset=utf-8', { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' });
  }

  route('POST', '/api/demo/reset', (ctx) => {
    requireUser(ctx);
    D.resetUserData(db);
    ctx.res.setHeader('Set-Cookie', 'wadeh_sid=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
    return { ok: true };
  });

  function serveFeed(req, res, token) {
    if (!feedLimit(ipOf(req))) return send(res, 429, { error: 'rate_limited' });
    const feed = /^[A-Za-z0-9_-]{43}$/.test(token) && db.prepare('SELECT * FROM calendar_feeds WHERE token_hash=?').get(sha(token));
    if (!feed) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    const u = q.user.get(feed.user_id); const p = prefsOf(u);
    const events = commitmentRows(u.id).filter((c) => c.status === 'active').map((c) => ICS.commitmentEvent(c, { reminderTime: p.reminderTime }));
    if (p.feedIncludeBills) for (const b of db.prepare("SELECT * FROM bills WHERE user_id=? AND status='due' AND commitment_id IS NULL").all(u.id)) events.push(ICS.billEvent(b, { reminderTime: p.reminderTime }));
    const ua = String(req.headers['user-agent'] || '').slice(0, 120);
    const first = !feed.last_fetched_at;
    db.prepare('UPDATE calendar_feeds SET last_fetched_at=?, last_client=?, fetch_count=fetch_count+1 WHERE user_id=?').run(Date.now(), ua, u.id);
    if (first) notify(u.id, 'calendar', 'تم ربط تقويم واضح', 'قام تطبيق التقويم بجلب التزاماتك لأول مرة. ستصلك التحديثات عند كل تحديث للاشتراك.', '#/profile');
    const body = ICS.calendar(events, { feed: true });
    res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline; filename="wadeh.ics"', 'X-Robots-Tag': 'noindex' });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  /* ---------- HTTP plumbing ---------- */
  const SEC_HEADERS = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; script-src 'self'; connect-src 'self'; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
  function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
    const payload = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': type, ...headers });
    res.end(payload);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 64 * 1024) { reject(new HttpError(413, 'too_large', 'الطلب كبير جدًا.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('invalid_json', 'صيغة الطلب غير صحيحة.')); } });
      req.on('error', reject);
    });
  }
  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden', 'text/plain');
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        if (!path.extname(rel)) return serveStatic(req, res, '/index.html'); // SPA fallback
        return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
      }
      const ext = path.extname(file);
      const cache = ext === '.png' ? 'public, max-age=604800' : 'no-cache'; // SW handles offline; always revalidate code
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, 'Content-Length': st.size, ...(rel === '/sw.js' ? { 'Service-Worker-Allowed': '/' } : {}) });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  async function handle(req, res) {
    for (const [k, v] of Object.entries(SEC_HEADERS)) res.setHeader(k, v);
    if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      const feedMatch = p.match(/^\/cal\/([A-Za-z0-9_-]+)\.ics$/);
      if (feedMatch && (req.method === 'GET' || req.method === 'HEAD')) return serveFeed(req, res, feedMatch[1]);
      const widgetMatch = p.match(/^\/w\/([A-Za-z0-9_-]+)\.json$/);
      if (widgetMatch && req.method === 'GET') return serveWidget(req, res, widgetMatch[1]);
      const icsMatch = p.match(/^\/ics\/([A-Za-z0-9_-]{32})\/wadeh-\d+\.ics$/);
      if (icsMatch && req.method === 'GET') return serveOneTimeIcs(req, res, icsMatch[1]);
      if (!p.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
        return serveStatic(req, res, p);
      }
      res.setHeader('Cache-Control', 'no-store');
      if (!apiLimit(ipOf(req))) throw new HttpError(429, 'rate_limited', 'طلبات كثيرة. انتظر قليلًا ثم حاول مجددًا.');
      const r = routes.find((x) => x.method === req.method && x.re.test(p));
      if (!r) throw new HttpError(404, 'not_found', 'المسار غير موجود.');
      if (req.method !== 'GET') {
        // CSRF defence in depth: SameSite=Strict cookie + required custom header + JSON content type.
        if (req.headers['x-wadeh'] !== '1' || !String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(403, 'csrf', 'طلب غير مسموح.');
        if (r.opts.auth && !authLimit(ipOf(req))) throw new HttpError(429, 'rate_limited', 'محاولات كثيرة. انتظر دقيقة ثم حاول مجددًا.');
      }
      const ctx = { req, res, params: p.match(r.re).groups || {}, query: url.searchParams, body: req.method === 'GET' ? {} : await readBody(req) };
      ctx.user = currentUser(req, res);
      const out = await r.handler(ctx);
      if (out && out.raw) return send(res, 200, out.raw, out.type, out.headers);
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message, ...(e.extra || {}) });
      logger.error('[wadeh] unexpected error', e);
      send(res, 500, { error: 'server_error', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' });
    }
  }

  const server = http.createServer((req, res) => { handle(req, res); });
  return { server, db, close: () => new Promise((r) => server.close(() => { try { db.close(); } catch {} r(); })) };
}

module.exports = { createApp };
