/* End-to-end browser test of the required flows on the Figma-matched UI (Playwright + Chrome).
   Run:  node tests/e2e.mjs   (needs `npm i -D playwright` and Chrome/Chromium; set CHROME_PATH if needed)
   Starts its own server on a temp database; saves screenshots to tests/output (git-ignored). */
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(process.env.PLAYWRIGHT_PATH || '/opt/npm-tools/node_modules/playwright'); }
const { createApp } = require('../server/app.js');

const ROOT = path.dirname(new URL(import.meta.url).pathname) + '/..';
const SHOTS = path.join(ROOT, 'tests', 'output', 'screenshots'); fs.mkdirSync(SHOTS, { recursive: true });
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wadeh-e2e-'));
const app = createApp({ dbFile: path.join(dir, 'e2e.db'), logger: { error: (...a) => console.error(...a) }, authRateLimit: 1000 });
await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
const BASE = 'http://localhost:' + app.server.address().port;

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || (fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined), args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'ar-SA', timezoneId: 'Asia/Riyadh' });
const page = await ctx.newPage();
page.setDefaultTimeout(8000);
const problems = [];
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));

const results = [];
const shot = async (name, full = false) => {
  await page.waitForTimeout(450);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => t.remove()));
  await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
};
const wait = (ms = 250) => page.waitForTimeout(ms);
const text = (sel) => page.locator(sel).first().innerText();
const api = (url) => page.evaluate(async (u) => (await fetch(u)).json(), url);
async function flow(name, fn) {
  const t = Date.now();
  try { await fn(); results.push({ name, ok: true, ms: Date.now() - t }); console.log('  ✓', name); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log('  ✗', name, '\n   ', e.message.split('\n')[0], (e.stack.match(/e2e.mjs:(\d+)/) || [])[0] || ''); await shot('FAIL-' + name.replace(/\W+/g, '_')); }
}
async function typePin(pin) { for (const d of pin) await page.click(`.key[data-key="${d}"]`); }
async function login() { await page.waitForSelector('.pin .keypad'); await typePin('123456'); await page.waitForSelector('.tabbar'); }
async function ensureLoggedIn() {
  await page.goto(BASE + '/#/home'); await page.waitForSelector('.tabbar, .pin, .hero');
  if (await page.locator('.hero').count()) await page.click('text=ابدأ الآن');
  if (await page.locator('.pin').count()) await login();
}
const balance = async () => (await api('/api/bootstrap')).me.balance;
const approve = async () => { await page.waitForSelector('.secure-card'); await page.click('[data-action=approve-faceid]'); };

console.log('WADEH e2e →', BASE);

await flow('1. Welcome → Login → Home', async () => {
  await page.goto(BASE + '/'); await page.waitForSelector('.splash'); await shot('01-splash');
  await page.waitForSelector('.hero', { timeout: 5000 }); assert.match(await text('main'), /بنكيّة أبسط، وقرارات أوضح/); await shot('02-welcome');
  await page.click('text=ابدأ الآن'); await page.waitForSelector('.pin .keypad'); assert.match(await text('.pin h1'), /يا هلا سارة/); await shot('03-login-pin');
  await typePin('111111'); await page.waitForSelector('text=/المحاولات المتبقية: 4/'); assert.match(await text('.pin .msg'), /رمز المرور غير صحيح/);
  await page.click('text=نسيت رمز المرور؟'); await page.waitForSelector('text=رمز المرور هو 123456');
  await login(); assert.match(await text('.home-head'), /مرحبًا، سارة/);
  assert.match(await text('.balance .amt'), /2,450\.00/); await shot('04-home');
  await page.click('[data-action=toggle-balance]'); await page.waitForSelector('text=••••••'); await page.click('[data-action=toggle-balance]');
});

await flow('2. Home → Transfer → Review → Success (with insufficient-balance state)', async () => {
  await page.click('.tile >> text=تحويل الأموال'); await page.waitForSelector('#tr-amount');
  await page.click('.pick'); await page.waitForSelector('#ben-list'); await shot('06-beneficiaries');
  await page.fill('#ben-q', 'ريم'); await wait(); assert.equal(await page.locator('[data-name="نورة أحمد"]').isHidden(), true);
  await page.click('[data-name="ريم محمد"]'); await page.click('[data-action=ben-choose]'); await page.waitForSelector('text=/ريم محمد/');
  await page.fill('#tr-amount', '9000'); await page.click('button[form=tr-form]'); await page.waitForSelector('text=الرصيد غير كافٍ'); await shot('14-insufficient');
  await page.click('text=تعديل المبلغ'); await page.fill('#tr-amount', '150.25'); await page.fill('#tr-note', 'عشاء'); await shot('07-transfer');
  await page.click('button[form=tr-form]'); await page.waitForSelector('.total-big'); assert.match(await text('.total-big'), /150\.25/); await shot('08-review');
  await page.click('[data-action=tr-confirm]'); await page.waitForSelector('.secure-card'); await shot('09-approve');
  await page.click('[data-action=approve-faceid]'); await page.waitForSelector('text=جاري تنفيذ التحويل...'); await shot('10-processing');
  await page.waitForSelector('text=تم التحويل بنجاح!'); await shot('11-success');
  assert.equal(await balance(), 245000 - 15025);
  assert.equal((await api('/api/bootstrap')).transactions.filter((t) => t.amount === 15025).length, 1, 'debited once');
  await page.click('text=العودة للرئيسية'); await page.waitForSelector('.balance');
});

await flow('2b. Add beneficiary', async () => {
  await page.goto(BASE + '/#/beneficiaries'); await page.click('[data-action=add-beneficiary]'); await page.waitForSelector('#ben-name');
  await page.fill('#ben-name', 'فهد التجريبي'); await page.fill('#ben-iban', 'SA12'); await page.click('.sheet button[type=submit]'); assert.match(await text('#ben-err'), /SA/);
  await page.fill('#ben-iban', 'SA0380000000608010167519'); await page.click('.sheet button[type=submit]');
  await page.waitForSelector('[data-name="فهد التجريبي"][aria-pressed="true"]');
});

await flow('3. Cards → Freeze (modal) → Unfreeze; details & limits need approval', async () => {
  await page.goto(BASE + '/#/cards'); await page.waitForSelector('.bank-card'); await shot('13-cards');
  await page.click('[data-action=card-freeze]'); await page.waitForSelector('.confirm-dialog'); await shot('17-freeze-modal');
  await page.click('.confirm-dialog [data-ok]'); await page.waitForSelector('text=تم تجميد البطاقة'); await shot('19-card-frozen');
  await page.click('text=العودة لبطاقاتي'); await page.waitForSelector('.bank-card .frozen');
  await page.click('[data-action=card-freeze]'); await page.waitForSelector('.bank-card .frozen', { state: 'detached' });
  await page.click('text=تفاصيل البطاقة'); await page.waitForSelector('text=لخصوصيتك'); await shot('36-card-details');
  await page.click('[data-action=card-reveal]'); await approve(); await page.waitForSelector('.secret'); assert.match(await text('main'), /4000 0000 0000 4521/);
  await page.goto(BASE + '/#/card-limits'); await page.waitForSelector('text=المتبقي اليوم'); assert.match(await text('main'), /1,780/); await shot('35-card-limits');
  await page.click('[data-action=limit-edit]'); await page.fill('#lim-v', '3000'); await page.click('.sheet button[type=submit]'); await approve();
  await page.waitForSelector('text=/3,000/');
});

await flow('4. Commitments → Add → Save → Display', async () => {
  await page.goto(BASE + '/#/home'); await page.click('text=التزاماتي'); await page.waitForSelector('text=تابعي مواعيدك'); await shot('17-commitments');
  await page.click('text=إضافة التزام شهري'); await page.waitForSelector('#c-title'); await shot('18-add-commitment');
  await page.fill('#c-title', 'اشتراك البث'); await page.selectOption('#c-type', 'subscription'); await page.fill('#c-amount', '45.99'); await page.selectOption('#c-day', '5');
  await page.click('button[form=c-form]'); await page.waitForSelector('text=تم حفظ الالتزام'); assert.match(await text('main'), /يوم 5 من كل شهر/); await shot('19-saved');
  await page.click('text=لاحقًا'); await page.waitForSelector('text=اشتراك البث');
});

await flow('5. Commitments → Calendar → Add Event', async () => {
  await page.click('text=اشتراك البث'); await page.waitForSelector('.mgrid'); await shot('21-calendar-preview');
  await page.click('[data-action=com-menu]'); await page.waitForSelector('.menu'); await page.click('.sheet [data-close]');
  const id = new URL(page.url()).hash.split('id=')[1];
  await page.goto(BASE + '/#/calendar-permission?id=' + id); await page.waitForSelector('text=لا يظهر المبلغ'); await shot('20-calendar-permission');
  const ics = await page.evaluate(async (cid) => { const { url } = await (await fetch(`/api/calendar/commitment/${cid}/link`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-WADEH': '1' }, body: '{}' })).json(); return (await fetch(url)).text(); }, id);
  assert.match(ics, /SUMMARY:اشتراك البث\r\n/); assert.match(ics, /RRULE:FREQ=MONTHLY/); assert.doesNotMatch(ics, /45\.99/);
  await page.click('[data-action=cal-add]').catch(() => {}); await page.waitForSelector('.mgrid');
});

await flow('6. Settings → Subscribe to WADEH Calendar', async () => {
  await page.goto(BASE + '/#/profile'); await page.waitForSelector('.profile-head'); await shot('15-profile');
  await page.click('text=الإشعارات'); await page.waitForSelector('text=اختاري التذكيرات'); await shot('39-notifications');
  await page.click('text=مزامنة التقويم'); await page.waitForSelector('text=غير مرتبط');
  await page.click('[data-action=cal-subscribe]'); await page.waitForSelector('.copy-row code');
  assert.match(await page.getAttribute('[data-action=cal-open-webcal]', 'href'), /^webcal:\/\/localhost:\d+\/cal\//);
  assert.match(await text('main'), /بانتظار الاشتراك/); await shot('calendar-sync');
  const url = await text('.copy-row code'); await page.evaluate(async (u) => (await fetch(new URL(u).pathname)).text(), url);
  await page.click('[data-action=cal-check]'); await page.waitForSelector('text=متصل');
});

await flow('7. Commitments → CarPlay concept', async () => {
  const id = (await api('/api/bootstrap')).commitments[0].id;
  await page.goto(BASE + '/#/calendar-preview?id=' + id); await page.click('text=معاينة CarPlay'); await page.waitForSelector('.cp-car');
  const first = await text('.cp-reminder h4'); await page.click('[data-action=cp-next]'); assert.notEqual(await text('.cp-reminder h4'), first);
  assert.equal(await page.locator('.cp-car >> text=/تحويل|سداد|ر\\.س/').count(), 0, 'no money or banking actions while driving');
  await shot('carplay', true);
});

await flow('8. Bills → Review → Simulated payment (PIN fallback)', async () => {
  await page.goto(BASE + '/#/services'); await page.click('.tile >> text=الفواتير'); await page.waitForSelector('text=إجمالي المستحق'); assert.match(await text('main'), /405\.00/); await shot('24-bills');
  const before = await balance();
  await page.click('text=فاتورة الإنترنت'); await page.waitForSelector('text=مراجعة الفاتورة'); await shot('31-bill-review');
  await page.click('[data-action=bill-pay]'); await page.waitForSelector('.secure-card');
  await page.click('[data-action=approve-fallback]'); await page.fill('#ap-pass', '123456'); await page.click('.sheet button[type=submit]');
  await page.waitForSelector('text=تم السداد بنجاح'); await shot('32-bill-paid');
  assert.equal(before - await balance(), 23000);
});

await flow('9. Savings group → Create → Schedule', async () => {
  await page.goto(BASE + '/#/services'); await page.click('.tile >> text=الادخار'); await page.waitForSelector('text=تتبّعي جمعياتك');
  await page.click('text=إضافة جمعية'); await page.waitForSelector('#c-total');
  await page.fill('#c-title', 'جمعية الزملاء'); await page.fill('#c-amount', '1000'); await page.fill('#c-total', '6'); await page.locator('#c-total').dispatchEvent('input'); await page.selectOption('#c-payout', '4');
  await page.click('button[form=c-form]'); await page.waitForSelector('text=تم حفظ الالتزام');
  const c = (await api('/api/bootstrap')).commitments.find((x) => x.title === 'جمعية الزملاء');
  assert.equal(c.total_payments, 6); assert.equal(c.payout_index, 4);
  await page.goto(BASE + '/#/calendar-preview?id=' + c.id); await page.waitForSelector('text=/الدفعة 1 من 6/'); await shot('savings-group');
});

await flow('Budget (ميزانيتي) → edit → save', async () => {
  await page.goto(BASE + '/#/expenses'); await page.waitForSelector('text=توزيع المصروفات'); await shot('14-expenses');
  await page.click('text=عرض ميزانيتي'); await page.waitForSelector('text=الميزانية الشهرية'); await shot('33-budget');
  await page.click('text=تعديل توزيع الميزانية'); await page.fill('#bd-food', '700'); await page.click('button[form=budget-form]');
  await page.waitForSelector('text=/الأكل • 700/');
});

await flow('10. Notifications → View → Mark read', async () => {
  await page.goto(BASE + '/#/home'); await page.click('.bell'); await page.waitForSelector('text=آخر الإشعارات');
  assert.ok(await page.locator('.item.unread').count() > 0);
  await page.locator('.item.unread').first().click(); await page.click('[data-action=notif-all]');
  await page.waitForFunction(() => !document.querySelector('.item.unread'));
});

await flow('11. Profile → Settings → Logout', async () => {
  await page.goto(BASE + '/#/widget'); await page.click('[data-hide="1"]'); await page.waitForSelector('[data-hide="1"][aria-pressed="true"]'); await shot('16-widget');
  await page.click('[data-hide="0"]'); await page.goto(BASE + '/#/profile'); await page.click('[data-action=logout]'); await page.waitForSelector('.hero');
  assert.equal(await page.evaluate(async () => (await fetch('/api/bootstrap')).status), 401);
  await page.goto(BASE + '/#/cards'); await page.waitForSelector('.pin');
});

await flow('Passkey (virtual Face ID): register → login → approve transfer', async () => {
  const cdp = await ctx.newCDPSession(page); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(BASE + '/#/login'); await page.reload(); await login();
  await page.goto(BASE + '/#/security'); await page.click('text=الأجهزة الموثوقة'); await page.click('[data-action=passkey-add]'); await page.waitForSelector('.sheet >> text=هذا الجهاز');
  await page.click('.sheet [data-close]'); await page.goto(BASE + '/#/profile'); await page.click('[data-action=logout]'); await page.waitForSelector('.hero');
  await page.click('text=لديك حساب؟ تسجيل الدخول'); await page.click('[data-action=pin-face]'); await page.waitForSelector('.tabbar');
  assert.equal((await api('/api/bootstrap')).me.sessionMethod, 'passkey');
  await page.goto(BASE + '/#/transfer'); await page.fill('#tr-amount', '10'); await page.click('button[form=tr-form]'); await page.click('[data-action=tr-confirm]');
  assert.doesNotMatch(await text('.secure-card'), /محاكاة/); await page.click('[data-action=approve-faceid]'); await page.waitForSelector('text=تم التحويل بنجاح!');
});

await flow('Session expiry → login', async () => {
  await ensureLoggedIn(); app.db.prepare('DELETE FROM sessions').run();
  await page.click('.tabbar >> text=البطاقات'); await page.click('[data-action=card-freeze]'); await page.click('.confirm-dialog [data-ok]'); await page.waitForSelector('.pin');
});

await flow('Responsive: no horizontal overflow at 320 / 390 / tablet / desktop', async () => {
  await ensureLoggedIn();
  for (const [w, h, name] of [[320, 640, 'small'], [820, 1180, 'tablet'], [1280, 860, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h });
    for (const r of ['home', 'services', 'transfer', 'cards', 'bills', 'commitments', 'commitment-add', 'profile', 'notifications', 'expenses', 'carplay']) {
      await page.goto(BASE + '/#/' + r); await wait(200);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, `${name}/${r} overflows by ${over}px`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
});

await browser.close(); await app.close(); fs.rmSync(dir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
const realProblems = problems.filter((p) => !/401|Failed to load resource.*(401|403|410)|webcal|ERR_ABORTED|ERR_TUNNEL|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|fonts\.g/.test(p));
console.log(`\n${results.length - failed.length}/${results.length} flows passed.` + (realProblems.length ? `\nBrowser errors:\n  ${realProblems.join('\n  ')}` : '\nNo unexpected browser console errors.'));
fs.writeFileSync(path.join(ROOT, 'tests', 'output', 'e2e-results.json'), JSON.stringify({ date: new Date().toISOString(), results, browserErrors: realProblems }, null, 2));
process.exit(failed.length || realProblems.length ? 1 : 0);
