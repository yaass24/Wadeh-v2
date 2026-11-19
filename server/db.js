'use strict';
/* WADEH — SQLite data layer (Node 22.13+ built-in node:sqlite, no external dependencies).
   All money is stored as integer halalas (1 SAR = 100 halalas). All data is fictional. */
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// node:sqlite is still flagged "experimental" in Node 22 and prints a warning; silence only that one.
const origEmit = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  const msg = typeof w === 'string' ? w : w && w.message;
  if (msg && /SQLite/i.test(msg)) return;
  return origEmit.call(process, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

const TZ = 'Asia/Riyadh';
const todayISO = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
function addDays(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function addMonths(iso, n) {
  const [y, m, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, last));
  return target.toISOString().slice(0, 10);
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, full_name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', phone_masked TEXT NOT NULL,
  account_number TEXT NOT NULL, iban TEXT NOT NULL, balance INTEGER NOT NULL,
  pin_hash TEXT NOT NULL, pin_salt TEXT NOT NULL, failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0, prefs TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key BLOB NOT NULL, alg INTEGER NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0,
  label TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER);
CREATE TABLE IF NOT EXISTS challenges (
  id TEXT PRIMARY KEY, user_id INTEGER, purpose TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS stepups (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, method TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS beneficiaries (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, bank TEXT NOT NULL, iban_last4 TEXT NOT NULL, created_at INTEGER NOT NULL, last_used INTEGER);
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL, kind TEXT NOT NULL, network TEXT NOT NULL, number TEXT NOT NULL, expiry TEXT NOT NULL, cvv TEXT NOT NULL,
  design TEXT NOT NULL, frozen INTEGER NOT NULL DEFAULT 0, limit_daily INTEGER NOT NULL, limit_online INTEGER NOT NULL,
  online_enabled INTEGER NOT NULL DEFAULT 1, contactless_enabled INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('in','out')), title TEXT NOT NULL, category TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK (amount > 0), reference TEXT NOT NULL, note TEXT, created_at INTEGER NOT NULL,
  beneficiary_id INTEGER, card_id INTEGER, bill_id INTEGER, commitment_id INTEGER, idem_key TEXT,
  UNIQUE (user_id, idem_key));
CREATE TABLE IF NOT EXISTS bills (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  biller TEXT NOT NULL, category TEXT NOT NULL, account_ref TEXT NOT NULL, amount INTEGER NOT NULL,
  due_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'due', paid_at INTEGER, commitment_id INTEGER);
CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('installment','bill','subscription','personal','savings_group')),
  title TEXT NOT NULL, amount INTEGER NOT NULL CHECK (amount > 0), due_date TEXT NOT NULL,
  recurrence TEXT NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none','monthly')),
  total_payments INTEGER, start_date TEXT, payout_index INTEGER, reminder_days INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  beneficiary_id INTEGER, bill_id INTEGER, notes TEXT, sequence INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS commitment_payments (
  id INTEGER PRIMARY KEY, commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  period_date TEXT NOT NULL, amount INTEGER NOT NULL, method TEXT NOT NULL, paid_at INTEGER NOT NULL,
  UNIQUE (commitment_id, period_date));
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, link TEXT, created_at INTEGER NOT NULL,
  read_at INTEGER, dedupe_key TEXT, UNIQUE (user_id, dedupe_key));
CREATE TABLE IF NOT EXISTS calendar_feeds (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, last_fetched_at INTEGER, last_client TEXT, fetch_count INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS widget_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL, last_fetched_at INTEGER, fetch_count INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at DESC);
`;

const DEFAULT_PREFS = {
  hideBalance: false,
  reminderTime: '09:00',
  notify: { commitments: true, transfers: true, cards: true, calendar: true, security: true },
  feedIncludeBills: true,
  language: 'ar',
  budget: { total: 200000, items: [
    { key: 'food', name: 'الأكل', amount: 60000, cats: ['مطاعم ومقاهي', 'بقالة'] },
    { key: 'charity', name: 'الصدقة', amount: 10000, cats: ['صدقة'] },
    { key: 'transport', name: 'المواصلات', amount: 30000, cats: ['مواصلات'] },
  ] },
};

function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // Demo-data migration: databases from v2.0 (PIN login, no phone column) are rebuilt with the new seed.
  const cols = db.prepare("SELECT name FROM pragma_table_info('users')").all().map((c) => c.name);
  if (cols.length && !cols.includes('phone')) {
    db.exec('PRAGMA foreign_keys = OFF');
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) db.exec(`DROP TABLE IF EXISTS "${name}"`);
  }
  db.exec(SCHEMA);
  return db;
}

function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* Seed one fictional demo customer — values follow the Figma "UI Design" board (سارة أحمد, 2,450.00 SAR …).
   Dates are relative to "today" so the demo always looks current. Demo login: 0512345678 / 123456 */
const DEMO_PHONE = '0512345678';
const DEMO_PASSWORD = '123456';
const nextDom = (t, dom) => { const [y, m, d] = t.split('-').map(Number); const base = d <= dom ? new Date(Date.UTC(y, m - 1, dom)) : new Date(Date.UTC(y, m, dom)); return base.toISOString().slice(0, 10); };

function seed(db, { password = DEMO_PASSWORD } = {}) {
  const now = Date.now();
  const t = todayISO();
  const salt = crypto.randomBytes(16).toString('hex');
  const day = 86400e3;
  return tx(db, () => {
    const u = db.prepare(`INSERT INTO users (name, full_name, phone, phone_masked, account_number, iban, balance, pin_hash, pin_salt, prefs, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run('سارة', 'سارة أحمد', DEMO_PHONE, '+966 5X XXX XXXX', '0108 •••• 4521', 'SA00 0000 0000 0000 0010 4521', 245000, hashPin(password, salt), salt, JSON.stringify(DEFAULT_PREFS), now);
    const uid = Number(u.lastInsertRowid);
    const ben = db.prepare('INSERT INTO beneficiaries (user_id,name,bank,iban_last4,created_at,last_used) VALUES (?,?,?,?,?,?)');
    ben.run(uid, 'نورة أحمد', 'واضح', '4821', now, now - 1 * day);
    const reem = Number(ben.run(uid, 'ريم محمد', 'بنك تجريبي', '8293', now, now - 17 * day).lastInsertRowid);
    ben.run(uid, 'سارة خالد', 'واضح', '1047', now, null);

    const card = db.prepare(`INSERT INTO cards (user_id,name,kind,network,number,expiry,cvv,design,frozen,limit_daily,limit_online,online_enabled,contactless_enabled)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const debit = Number(card.run(uid, 'بطاقة مدى', 'debit', 'mada', '4000 0000 0000 4521', '08/29', '381', 'navy', 0, 200000, 150000, 1, 1).lastInsertRowid);
    addVisa(db, uid);

    const txn = db.prepare(`INSERT INTO transactions (user_id,direction,title,category,amount,reference,note,created_at,beneficiary_id,card_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`);
    txn.run(uid, 'out', 'تحويل إلى ريم', 'تحويلات', 5000, 'TRX-00125', null, now - 17 * day, reem, null);
    txn.run(uid, 'out', 'صيدلية الحي', 'أخرى', 37880, 'POS-26110002', null, now - 12 * day, null, debit);
    txn.run(uid, 'out', 'متجر إلكتروني', 'تسوّق', 37120, 'POS-26110003', null, now - 9 * day, null, debit);
    txn.run(uid, 'out', 'محطة وقود', 'مواصلات', 16000, 'POS-26110004', null, now - 6 * day, null, debit);
    txn.run(uid, 'out', 'مطعم البيت', 'مطاعم ومقاهي', 15000, 'POS-26110005', null, now - 4 * day, null, debit);
    txn.run(uid, 'out', 'مقهى المدينة', 'مطاعم ومقاهي', 22000, 'POS-26110006', null, now - 60 * 1000, null, debit); // today → 1,780 left of the 2,000 daily limit

    const bill = db.prepare('INSERT INTO bills (user_id,biller,category,account_ref,amount,due_date,status) VALUES (?,?,?,?,?,?,?)');
    bill.run(uid, 'الإنترنت', 'internet', '•••• 4521', 23000, nextDom(t, 12), 'due');
    bill.run(uid, 'الكهرباء', 'electricity', '•••• 4521', 17500, nextDom(t, 21), 'due');

    const com = db.prepare(`INSERT INTO commitments (user_id,type,title,amount,due_date,recurrence,total_payments,start_date,payout_index,reminder_days,beneficiary_id,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    com.run(uid, 'installment', 'قسط السيارة', 125000, nextDom(t, 15), 'monthly', null, null, null, 1, null, null, now, now);
    com.run(uid, 'bill', 'فاتورة الإنترنت', 23000, nextDom(t, 15), 'monthly', null, null, null, 1, null, null, now, now);
    com.run(uid, 'personal', 'الصدقة', 10000, nextDom(t, 20), 'monthly', null, null, null, 1, null, null, now, now);

    const n = db.prepare('INSERT INTO notifications (user_id,kind,title,body,link,created_at,read_at,dedupe_key) VALUES (?,?,?,?,?,?,?,?)');
    n.run(uid, 'transfer', 'تم التحويل بنجاح', 'تم تحويل 50.00 ر.س إلى ريم محمد (محاكاة).', '#/home', now - 17 * day, now - 17 * day, null);
    n.run(uid, 'security', 'تسجيل دخول جديد', 'تم تسجيل الدخول إلى حسابك من جهاز جديد.', '#/security', now - 1 * day, null, null);
    return uid;
  });
}

const addVisa = (db, uid) => db.prepare(`INSERT INTO cards (user_id,name,kind,network,number,expiry,cvv,design,frozen,limit_daily,limit_online,online_enabled,contactless_enabled)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(uid, 'بطاقة فيزا', 'debit', 'visa', '4111 0000 0000 7390', '11/30', '642', 'blue', 0, 500000, 300000, 1, 1);

function ensureSeeded(db, opts) {
  const row = db.prepare('SELECT id FROM users LIMIT 1').get();
  if (!row) return seed(db, opts);
  // Older demo databases had only the mada card — add the Visa card once.
  if (!db.prepare("SELECT 1 FROM cards WHERE user_id=? AND network='visa'").get(row.id)) addVisa(db, row.id);
  return row.id;
}

function resetUserData(db, opts) {
  tx(db, () => { db.exec('DELETE FROM users; DELETE FROM challenges; DELETE FROM stepups;'); });
  return seed(db, opts);
}

module.exports = { DEMO_PHONE, DEMO_PASSWORD, nextDom, open, seed, ensureSeeded, resetUserData, tx, hashPin, todayISO, addDays, addMonths, DEFAULT_PREFS, TZ };
