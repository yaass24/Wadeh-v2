'use strict';
/* API integration tests — run with:  node --test tests/   (no dependencies) */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createApp } = require('../server/app');
const WA = require('../server/webauthn');
const ICS = require('../server/ics');

function client(base) {
  let cookie = '';
  const call = async (method, url, body, extraHeaders = {}) => {
    const headers = { ...(cookie ? { cookie } : {}), ...extraHeaders };
    if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-wadeh'] = '1'; }
    const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  return { call, get: (u) => call('GET', u), post: (u, b) => call('POST', u, b || {}), patch: (u, b) => call('PATCH', u, b), del: (u) => call('DELETE', u, {}) };
}

let app, base, dir;
test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wadeh-'));
  app = createApp({ dbFile: path.join(dir, 't.db'), logger: { error() {} }, authRateLimit: 10000 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = 'http://127.0.0.1:' + app.server.address().port;
});
test.after(async () => { await app.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const idem = () => crypto.randomUUID().replace(/-/g, '');
const CREDS = { phone: '0512345678', password: '123456' };
async function login() { const c = client(base); const r = await c.post('/api/auth/login', CREDS); assert.equal(r.status, 200, JSON.stringify(r.body)); return c; }
async function stepUp(c) { const r = await c.post('/api/auth/stepup', { method: 'password', password: '123456' }); assert.equal(r.status, 200); return r.body.stepUpToken; }

test('static app shell, security headers, SPA fallback', async () => {
  const c = client(base);
  const r = await c.get('/');
  assert.equal(r.status, 200); assert.match(r.body, /واضح/);
  assert.match(r.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal((await c.get('/home')).status, 200);
  assert.equal((await c.get('/../server/app.js')).status, 404);
  assert.equal((await c.get('/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json');
});

test('auth: mobile validation; wrong password counts down then locks; CSRF header enforced', async () => {
  const c = client(base);
  assert.equal((await c.get('/api/bootstrap')).status, 401);
  const noHeader = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(CREDS) });
  assert.equal(noHeader.status, 403);
  const badMobile = await c.post('/api/auth/login', { phone: '0551234', password: '123456' });
  assert.equal(badMobile.status, 400); assert.equal(badMobile.body.error, 'invalid_mobile');
  assert.equal((await c.post('/api/auth/login', { phone: '0599999999', password: '123456' })).status, 401, 'unknown phone');
  const w = await c.post('/api/auth/login', { ...CREDS, password: 'wrongpass' });
  assert.equal(w.status, 401); assert.equal(w.body.remaining, 4);
  for (let i = 0; i < 3; i++) await c.post('/api/auth/login', { ...CREDS, password: 'wrongpass' });
  const locked = await c.post('/api/auth/login', { ...CREDS, password: 'wrongpass' });
  assert.equal(locked.status, 423);
  const stillLocked = await c.post('/api/auth/login', CREDS);
  assert.equal(stillLocked.status, 423, 'correct password rejected during lockout');
  app.db.prepare('UPDATE users SET locked_until=0, failed_attempts=0').run();
  const ok = await c.post('/api/auth/login', CREDS);
  assert.equal(ok.status, 200);
  const b = await c.get('/api/bootstrap');
  assert.equal(b.status, 200); assert.equal(b.body.me.fullName, 'سارة أحمد'); assert.equal(b.body.me.balance, 245000);
  assert.equal(b.body.commitments.length, 3); assert.equal(b.body.bills.length, 2); assert.equal(b.body.cards.length, 2); assert.deepEqual(b.body.cards.map((x) => x.network), ['mada', 'visa']);
  assert.equal(b.body.cards[0].limitDaily - b.body.cards[0].spentToday, 178000, '1,780 left today as in Figma');
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/bootstrap')).status, 401);
});

test('transfer: needs step-up, validates balance, prevents duplicates', async () => {
  const c = await login();
  const before = (await c.get('/api/bootstrap')).body;
  const ben = before.beneficiaries[0].id;
  const noStep = await c.post('/api/transfers', { beneficiaryId: ben, amount: '10', idempotencyKey: idem() });
  assert.equal(noStep.status, 403);
  const tooMuch = await c.post('/api/transfers', { beneficiaryId: ben, amount: String(before.me.balance / 100 + 1), idempotencyKey: idem(), stepUpToken: await stepUp(c) });
  assert.equal(tooMuch.status, 422); assert.equal(tooMuch.body.error, 'insufficient_balance');
  assert.equal((await c.post('/api/transfers', { beneficiaryId: ben, amount: '-5', idempotencyKey: idem(), stepUpToken: await stepUp(c) })).status, 400);
  assert.equal((await c.post('/api/transfers', { beneficiaryId: ben, amount: '1.005', idempotencyKey: idem(), stepUpToken: await stepUp(c) })).status, 400);
  const key = idem(); const tok = await stepUp(c);
  const [a, b2] = await Promise.all([
    c.post('/api/transfers', { beneficiaryId: ben, amount: '125.50', note: 'اختبار', idempotencyKey: key, stepUpToken: tok }),
    c.post('/api/transfers', { beneficiaryId: ben, amount: '125.50', note: 'اختبار', idempotencyKey: key, stepUpToken: tok }),
  ]);
  const statuses = [a.status, b2.status].sort();
  assert.deepEqual(statuses, [200, 200]);
  const after = (await c.get('/api/bootstrap')).body;
  assert.equal(after.me.balance, before.me.balance - 12550, 'debited exactly once');
  assert.equal(after.transactions.filter((t) => t.reference === a.body.transaction.reference).length, 1);
  // replaying a used step-up token for a new transfer fails
  assert.equal((await c.post('/api/transfers', { beneficiaryId: ben, amount: '1', idempotencyKey: idem(), stepUpToken: tok })).status, 403);
});

test('beneficiary validation and creation', async () => {
  const c = await login();
  assert.equal((await c.post('/api/beneficiaries', { name: 'خالد', iban: '1234' })).status, 400);
  const r = await c.post('/api/beneficiaries', { name: 'خالد التجريبي', bank: 'بنك تجريبي', iban: 'SA44 2000 0001 2345 6789 1234' });
  assert.equal(r.status, 200);
  const b = (await c.get('/api/bootstrap')).body;
  const k = b.beneficiaries.find((x) => x.name === 'خالد التجريبي');
  assert.equal(k.iban_last4, '1234');
  assert.equal((await c.post('/api/beneficiaries', { name: 'خالد التجريبي', iban: 'SA4420000001234567891234' })).status, 400, 'duplicate rejected');
});

test('cards: freeze/unfreeze, limits, reveal needs step-up', async () => {
  const c = await login();
  const card = (await c.get('/api/bootstrap')).body.cards[0];
  assert.equal(card.last4, '4521'); assert.equal(card.number, undefined, 'full number never in bootstrap');
  assert.equal((await c.post(`/api/cards/${card.id}/freeze`, { frozen: true })).body.card.frozen, true);
  assert.equal((await c.post(`/api/cards/${card.id}/freeze`, { frozen: false })).body.card.frozen, false);
  assert.equal((await c.patch(`/api/cards/${card.id}/limits`, { limitDaily: 1000, limitOnline: 2000 })).status, 400);
  const l = await c.patch(`/api/cards/${card.id}/limits`, { limitDaily: 3000, limitOnline: 1500, onlineEnabled: false });
  assert.equal(l.body.card.limitDaily, 300000); assert.equal(l.body.card.onlineEnabled, false);
  assert.equal((await c.post(`/api/cards/${card.id}/reveal`, {})).status, 403);
  const rv = await c.post(`/api/cards/${card.id}/reveal`, { stepUpToken: await stepUp(c) });
  assert.equal(rv.status, 200); assert.match(rv.body.number, /4521$/);
});

test('commitments: create savings group, edit, mark paid advances schedule, delete', async () => {
  const c = await login();
  const bad = await c.post('/api/commitments', { type: 'savings_group', title: 'جمعية', amount: 500, dueDate: '2026-12-01', totalPayments: 5, payoutIndex: 9, startDate: '2026-12-01' });
  assert.equal(bad.status, 400);
  const r = await c.post('/api/commitments', { type: 'savings_group', title: 'جمعية الأصدقاء', amount: 500, dueDate: '2026-12-01', startDate: '2026-12-01', totalPayments: 6, payoutIndex: 3, reminderDays: 2 });
  assert.equal(r.status, 200);
  let x = (await c.get('/api/bootstrap')).body.commitments.find((k) => k.id === r.body.id);
  assert.equal(x.recurrence, 'monthly'); assert.equal(x.amount, 50000);
  assert.equal((await c.patch('/api/commitments/' + x.id, { title: 'جمعية الأصدقاء ٢' })).status, 200);
  await c.post(`/api/commitments/${x.id}/mark-paid`);
  x = (await c.get('/api/bootstrap')).body.commitments.find((k) => k.id === r.body.id);
  assert.equal(x.title, 'جمعية الأصدقاء ٢'); assert.equal(x.paid_count, 1); assert.equal(x.due_date, '2027-01-01');
  const once = await c.post('/api/commitments', { type: 'personal', title: 'هدية', amount: 200, dueDate: '2026-12-20', recurrence: 'none' });
  await c.post(`/api/commitments/${once.body.id}/mark-paid`);
  assert.equal((await c.get('/api/bootstrap')).body.commitments.find((k) => k.id === once.body.id).status, 'completed');
  assert.equal((await c.del('/api/commitments/' + once.body.id)).status, 200);
  assert.equal((await c.get('/api/bootstrap')).body.commitments.find((k) => k.id === once.body.id), undefined);
});

test('pay commitment by transfer marks it paid', async () => {
  const c = await login();
  const b0 = (await c.get('/api/bootstrap')).body;
  await c.post('/api/commitments', { type: 'personal', title: 'سداد لنورة', amount: 75, dueDate: '2026-12-10', recurrence: 'monthly', beneficiaryId: b0.beneficiaries[0].id });
  const b = (await c.get('/api/bootstrap')).body;
  const sub = b.commitments.find((k) => k.title === 'سداد لنورة');
  const r = await c.post('/api/transfers', { beneficiaryId: sub.beneficiary_id, amount: sub.amount / 100, idempotencyKey: idem(), stepUpToken: await stepUp(c), commitmentId: sub.id });
  assert.equal(r.status, 200);
  const after = (await c.get('/api/bootstrap')).body.commitments.find((k) => k.id === sub.id);
  assert.equal(after.paid_count, sub.paid_count + 1); assert.notEqual(after.due_date, sub.due_date);
});

test('bills: pay with step-up (once), add to commitments', async () => {
  const c = await login();
  const bill = (await c.get('/api/bootstrap')).body.bills.find((x) => x.status === 'due');
  const link = await c.post(`/api/bills/${bill.id}/to-commitment`);
  assert.equal(link.status, 200);
  assert.equal((await c.post(`/api/bills/${bill.id}/to-commitment`)).body.existing, true);
  const key = idem();
  const p = await c.post(`/api/bills/${bill.id}/pay`, { idempotencyKey: key, stepUpToken: await stepUp(c) });
  assert.equal(p.status, 200);
  const again = await c.post(`/api/bills/${bill.id}/pay`, { idempotencyKey: key });
  assert.equal(again.body.duplicate, true);
  assert.equal((await c.post(`/api/bills/${bill.id}/pay`, { idempotencyKey: idem(), stepUpToken: await stepUp(c) })).status, 400);
  const b = (await c.get('/api/bootstrap')).body;
  assert.equal(b.bills.find((x) => x.id === bill.id).status, 'paid');
  assert.equal(b.commitments.find((x) => x.id === link.body.id).paid_count, 1);
});

test('notifications: list, mark one read, mark all', async () => {
  const c = await login();
  let n = (await c.get('/api/bootstrap')).body.notifications;
  const unread = n.find((x) => !x.read_at);
  assert.ok(unread);
  await c.post(`/api/notifications/${unread.id}/read`);
  n = (await c.get('/api/bootstrap')).body.notifications;
  assert.ok(n.find((x) => x.id === unread.id).read_at);
  await c.post('/api/notifications/read-all');
  assert.equal((await c.get('/api/bootstrap')).body.notifications.filter((x) => !x.read_at).length, 0);
});

test('calendar: single event ICS and subscription feed lifecycle', async () => {
  const c = await login();
  const com = (await c.get('/api/bootstrap')).body.commitments.find((k) => k.title === 'قسط السيارة');
  const ev = await c.get('/api/calendar/commitment/' + com.id);
  assert.equal(ev.status, 200); assert.match(ev.headers.get('content-type'), /text\/calendar/);
  assert.match(ev.body, /BEGIN:VCALENDAR\r\n/); assert.match(ev.body, /RRULE:FREQ=MONTHLY/); assert.match(ev.body, /TZID=Asia\/Riyadh/); assert.match(ev.body, /TRIGGER:-P1D/);
  assert.match(ev.body, /SUMMARY:قسط السيارة\r\n/); assert.doesNotMatch(ev.body, /1,250|ر\.س/, 'amount never appears in the calendar');
  for (const line of ev.body.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, 'line folded: ' + line);
  assert.equal((await client(base).get('/api/calendar/commitment/' + com.id)).status, 401);
  const link = (await c.post(`/api/calendar/commitment/${com.id}/link`)).body.url;
  const anonIcs = await client(base).get(link); // no cookie — works once (iOS Safari view)
  assert.equal(anonIcs.status, 200); assert.match(anonIcs.body, /BEGIN:VEVENT/);
  assert.equal((await client(base).get(link)).status, 410, 'one-time link cannot be reused');

  const f = await c.post('/api/calendar/feed');
  assert.match(f.body.webcalUrl, /^webcal:\/\/127\.0\.0\.1:\d+\/cal\/[A-Za-z0-9_-]{43}\.ics$/);
  const path1 = new URL(f.body.httpsUrl).pathname;
  let st = (await c.get('/api/bootstrap')).body.calendarFeed;
  assert.equal(st.active, true); assert.equal(st.lastFetchedAt, null, 'not "connected" until a calendar actually fetches');
  const feed = await client(base).call('GET', path1, null, { 'user-agent': 'iOS/18.0 dataaccessd/1.0' });
  assert.equal(feed.status, 200); assert.match(feed.body, /REFRESH-INTERVAL;VALUE=DURATION:PT1H/);
  assert.match(feed.body, /UID:wadeh-commitment-\d+@wadeh.app/);
  st = (await c.get('/api/bootstrap')).body.calendarFeed;
  assert.ok(st.lastFetchedAt); assert.match(st.lastClient, /iOS/);
  const f2 = await c.post('/api/calendar/feed'); // regenerate
  assert.equal((await client(base).get(path1)).status, 404, 'old token invalid after regeneration');
  assert.equal((await client(base).get(new URL(f2.body.httpsUrl).pathname)).status, 200);
  await c.del('/api/calendar/feed');
  assert.equal((await client(base).get(new URL(f2.body.httpsUrl).pathname)).status, 404, 'revoked');
  assert.equal((await client(base).get('/cal/' + 'a'.repeat(43) + '.ics')).status, 404);
});

test('ICS folding never splits multi-byte Arabic characters', () => {
  const line = 'SUMMARY:' + 'واضح '.repeat(40);
  const folded = ICS.fold(line);
  for (const l of folded.split('\r\n')) { assert.ok(Buffer.byteLength(l) <= 75); assert.ok(!l.includes('�')); }
  assert.equal(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), line);
});

test('passkey (WebAuthn) registration + login + step-up with a real ES256 key', async () => {
  const c = await login();
  const origin = base; const rpId = '127.0.0.1';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const credId = WA.b64u.enc(crypto.randomBytes(32));
  const authData = (counter, flags = 0x05) => { const b = Buffer.alloc(37); WA.sha256(Buffer.from(rpId)).copy(b, 0); b[32] = flags; b.writeUInt32BE(counter, 33); return b; };
  const cd = (type, challenge, o = origin) => Buffer.from(JSON.stringify({ type, challenge, origin: o }));

  const ro = (await c.post('/api/auth/passkey/register/options')).body;
  const reg = await c.post('/api/auth/passkey/register', { challengeId: ro.challengeId, id: credId, clientDataJSON: WA.b64u.enc(cd('webauthn.create', ro.challenge)), authenticatorData: WA.b64u.enc(authData(0)), publicKey: WA.b64u.enc(spki), alg: -7, label: 'اختبار' });
  assert.equal(reg.status, 200, JSON.stringify(reg.body));

  const anon = client(base);
  const sign = (opts, o) => { const ad = authData(0); const cdj = cd('webauthn.get', opts.challenge, o); const sig = crypto.sign('sha256', Buffer.concat([ad, WA.sha256(cdj)]), privateKey); return { challengeId: opts.challengeId, id: credId, clientDataJSON: WA.b64u.enc(cdj), authenticatorData: WA.b64u.enc(ad), signature: WA.b64u.enc(sig) }; };
  const lo = (await anon.post('/api/auth/passkey/options', { purpose: 'login' })).body;
  assert.ok(lo.allowCredentials.includes(credId));
  // wrong origin is rejected (phishing protection)
  const evil = await anon.post('/api/auth/passkey/login', sign(lo, 'https://evil.example'));
  assert.equal(evil.status, 401);
  const lo2 = (await anon.post('/api/auth/passkey/options', { purpose: 'login' })).body;
  const ok = await anon.post('/api/auth/passkey/login', sign(lo2));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await anon.get('/api/bootstrap')).body.me.sessionMethod, 'passkey');
  // challenge cannot be replayed
  assert.equal((await anon.post('/api/auth/passkey/login', sign(lo2))).status, 400);
  const so = (await anon.post('/api/auth/passkey/options', { purpose: 'stepup' })).body;
  const su = await anon.post('/api/auth/stepup', { method: 'passkey', ...sign(so) });
  assert.equal(su.status, 200); assert.ok(su.body.stepUpToken);
  await c.del('/api/passkeys/' + credId);
});

test('PIN change rejects weak passwords and requires the current one', async () => {
  const c = await login();
  assert.equal((await c.post('/api/auth/password/change', { currentPassword: '123456', newPassword: '111111' })).status, 400);
  assert.equal((await c.post('/api/auth/password/change', { currentPassword: '999999', newPassword: '482915' })).status, 401);
  assert.equal((await c.post('/api/auth/password/change', { currentPassword: '123456', newPassword: '482915' })).status, 200);
  assert.equal((await client(base).post('/api/auth/login', { ...CREDS, password: '482915' })).status, 200);
  const salt = 'testsalt'; app.db.prepare('UPDATE users SET pin_hash=?, pin_salt=?').run(require('../server/db').hashPin('123456', salt), salt); // restore demo PIN
});

test('home-screen widget: secret read-only link, hides amounts when asked, revocable', async () => {
  const c = await login();
  const r = await c.post('/api/widget/token'); assert.equal(r.status, 200);
  const path = new URL(r.body.url).pathname; assert.match(path, /^\/w\/[A-Za-z0-9_-]{43}\.json$/);
  let w = await (await fetch(base + path)).json();
  assert.equal(w.balance, (await c.get('/api/bootstrap')).body.me.balance); assert.ok(w.upcoming.length >= 3); assert.equal(w.recent.length, 3);
  assert.equal((await c.patch('/api/prefs', { hideBalance: true })).status, 200);
  w = await (await fetch(base + path)).json();
  assert.equal(w.hidden, true); assert.equal(w.balance, null); assert.ok(w.upcoming.every((x) => x.amount === null)); assert.ok(w.recent.every((x) => x.amount === null));
  await c.patch('/api/prefs', { hideBalance: false });
  assert.equal((await c.get('/api/bootstrap')).body.widget.lastFetchedAt > 0, true);
  assert.equal((await fetch(base + '/w/' + 'x'.repeat(43) + '.json')).status, 404);
  assert.equal((await c.del('/api/widget/token')).status, 200);
  assert.equal((await fetch(base + path)).status, 404);
});

test('auth endpoints are rate limited per IP', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wadeh-rl-'));
  const a = createApp({ dbFile: path.join(d, 'r.db'), logger: { error() {} }, authRateLimit: 3 });
  await new Promise((r) => a.server.listen(0, '127.0.0.1', r));
  const c = client('http://127.0.0.1:' + a.server.address().port);
  const codes = [];
  for (let i = 0; i < 5; i++) codes.push((await c.post('/api/auth/login', CREDS)).status);
  assert.deepEqual(codes, [200, 200, 200, 429, 429]);
  await a.close(); fs.rmSync(d, { recursive: true, force: true });
});

test('simulated top-up is idempotent and capped', async () => {
  const c = await login();
  const before = (await c.get('/api/bootstrap')).body.me.balance;
  const key = idem();
  const t1 = await c.post('/api/topup', { amount: 200, idempotencyKey: key }); assert.equal(t1.status, 200, JSON.stringify(t1.body));
  assert.equal((await c.post('/api/topup', { amount: 200, idempotencyKey: key })).body.duplicate, true);
  assert.equal((await c.post('/api/topup', { amount: 20000, idempotencyKey: idem() })).status, 400);
  assert.equal((await c.get('/api/bootstrap')).body.me.balance, before + 20000);
});

test('budget allocations: update within the monthly total, reject overflow', async () => {
  const c = await login();
  const p = (await c.get('/api/bootstrap')).body.me.prefs.budget;
  assert.equal(p.total, 200000); assert.deepEqual(p.items.map((x) => x.amount), [60000, 10000, 30000]);
  const ok = await c.patch('/api/prefs', { budget: { items: [{ key: 'food', amount: 700 }] } });
  assert.equal(ok.status, 200); assert.equal(ok.body.prefs.budget.items[0].amount, 70000);
  assert.equal((await c.patch('/api/prefs', { budget: { items: [{ key: 'food', amount: 1900 }] } })).status, 400);
});
