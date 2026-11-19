/* Shared flows:
   - Secure approval (Figma "09 / التحقق بـ Face ID"): passkey Face ID where supported, a labelled simulation otherwise,
     and «تعذر التحقق؟» → PIN fallback. Used by transfers, bill payments, card details and card limits.
   - Verification error (Figma "12 / فشل التحقق").
   - Calendar: Method A (one event .ics) and Method B (webcal subscription screen). */
import { S, render, go, openSheet, closeSheet, refresh, busy } from '../store.js';
import { post, del, ApiError } from '../api.js';
import * as WA from '../webauthn.js';
import { esc, icon, hdr, toast, dateTime, askConfirm, sheetHead, bio } from '../ui.js';

export const canUsePasskey = () => S.passkey === 'platform' && !!WA.deviceCredentialId() && (S.data?.passkeys || []).some((p) => p.id === WA.deviceCredentialId());

/** Start a protected action. run(token) performs it and navigates on success. */
export function requireApproval({ run, back = 'home', step = '', title = 'التحقق الآمن' }) {
  S.ui.pending = { run, back, step, title };
  go('approve');
}
export function errText(e) {
  if (e instanceof ApiError) {
    if (e.code === 'wrong_password') return `رمز المرور غير صحيح. المحاولات المتبقية: ${e.body.remaining}`;
    if (e.code === 'locked') return `تم إيقاف المحاولات مؤقتًا. حاولي بعد ${Math.ceil((e.body.retryAfter || 300) / 60)} دقائق.`;
    return e.message;
  }
  return WA.friendlyError(e);
}

function approveScreen() {
  const p = S.ui.pending; if (!p) { setTimeout(() => go('home')); return '<main class="screen"></main>'; }
  const real = canUsePasskey();
  return `<main class="screen">${hdr(p.title, { back: p.back, step: p.step })}<div class="gap" style="height:18px"></div>
    <div class="secure-card"><h3>تأكيد من الجهاز الموثوق</h3><p class="fid" style="text-align:right">${bio.name}</p><p>${real ? 'سيُطلب التحقق من جهازك المسجل' : 'سيُطلب التحقق من جهازك المسجل (محاكاة على هذا الجهاز)'}</p></div>
    <div class="bottom">
      <button class="btn btn-primary" data-action="approve-faceid">تأكيد ${bio.name}</button>
      <button class="btn btn-secondary" data-action="approve-fallback">تعذر التحقق؟</button>
    </div></main>`;
}
async function runWithToken(getToken, btn) {
  const p = S.ui.pending; if (!p) return;
  await busy(btn, async () => {
    let token;
    try { ({ stepUpToken: token } = await getToken()); }
    catch (e) { S.ui.verifyError = errText(e); if (S.sheet) closeSheet(); go('verify-error'); return; }
    try { if (S.sheet) S.sheet = null; await p.run(token); }
    catch (e) { toast(errText(e), { error: true }); }
  });
}

function verifyErrorScreen() {
  const p = S.ui.pending || { back: 'home' };
  return `<main class="screen">${hdr('تعذر التحقق', { back: p.back, sub: 'لم نتمكن من اعتماد الطلب باستخدام الجهاز' })}
    <div class="status"><div class="badge bad">!</div><p style="text-align:right;color:var(--text);align-self:stretch">لم يتم تنفيذ العملية. يمكنك إعادة محاولة التحقق أو العودة للمراجعة.</p></div>
    <div class="bottom"><button class="btn btn-primary" data-nav="approve">إعادة محاولة التحقق</button><button class="btn btn-secondary" data-nav="${esc(p.back)}">العودة للمراجعة</button></div></main>`;
}

function passwordSheet() {
  return `${sheetHead('التحقق برمز المرور')}
  <form data-form="approve-password" novalidate>
    <div class="field"><label for="ap-pass">رمز المرور</label><input id="ap-pass" name="password" class="input ltr-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="off" placeholder="••••••" required autofocus></div>
    <p class="err" id="ap-err" role="alert" style="color:#C0413F;font-size:13px;margin:-12px 0 14px"></p>
    <button class="btn btn-primary" type="submit">تأكيد</button>
  </form>`;
}

/* ---------- Calendar ---------- */
export async function addEventToCalendar(commitmentId, btn) {
  await busy(btn, async () => {
    try {
      const { url } = await post(`/api/calendar/commitment/${commitmentId}/link`);
      const a = document.createElement('a'); a.href = url; a.rel = 'noopener';
      if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) a.target = '_blank';
      document.body.appendChild(a); a.click(); a.remove();
      S.ui.calendarAdded = { ...(S.ui.calendarAdded || {}), [commitmentId]: true };
      toast('اختاري «إضافة» في تطبيق التقويم.');
    } catch (e) { toast(e.message, { error: true }); }
  });
}

function feedStatus() {
  const f = S.data?.calendarFeed || { active: false };
  if (!f.active) return { cls: '', label: 'غير مرتبط', text: 'التزاماتك تظهر تلقائيًا في تقويم الآيفون.' };
  if (!f.lastFetchedAt) return { cls: 'wait', label: 'بانتظار الاشتراك', text: 'أكملي الاشتراك من تطبيق التقويم.' };
  return { cls: 'ok', label: 'متصل', text: `آخر مزامنة: ${dateTime(f.lastFetchedAt)}` };
}
function calendarSyncScreen() {
  const f = S.data.calendarFeed || { active: false }; const st = feedStatus(); const urls = S.ui.feedUrls;
  const local = /\/\/(localhost|127\.0\.0\.1)/.test(S.data.capabilities?.origin || '');
  return `<main class="screen">${hdr('مزامنة التقويم', { back: 'notifications', sub: 'اشتراك تقويم واضح على الآيفون' })}<div class="gap"></div>
    <div class="info"><span class="l">الحالة</span><span class="v"><span class="status-dot ${st.cls}"></span>${st.label}</span><span class="l" style="margin-top:8px">${esc(st.text)}</span></div>
    ${urls ? `<div class="stack" style="margin-top:14px"><div class="copy-row"><code>${esc(urls.httpsUrl)}</code><button class="x" data-action="cal-copy" aria-label="نسخ الرابط">${icon.copy}</button></div><p class="note-line">رابط خاص بك — لا تشاركيه.</p></div>` : ''}
    ${local ? '<p class="warn" style="margin-top:14px">رابط localhost لا يصل إليه الآيفون — استخدمي النسخة المنشورة.</p>' : ''}
    <p class="note-line" style="margin-top:22px">يظهر اسم الالتزام فقط؛ لا يظهر المبلغ. الاشتراك في اتجاه واحد ويتحدّث دوريًا.</p>
    <div class="bottom">
      ${urls ? `<a class="btn btn-primary" href="${esc(urls.webcalUrl)}" data-action="cal-open-webcal">${icon.calendar}<span>فتح في تطبيق التقويم</span></a>`
        : `<button class="btn btn-primary" data-action="cal-subscribe">${f.active ? 'رابط جديد والاشتراك' : 'ربط بالتقويم'}</button>`}
      ${f.active ? `<button class="btn btn-secondary" data-action="cal-check">تحديث الحالة</button><button class="btn btn-text" data-action="cal-revoke">إلغاء الربط</button>` : ''}
    </div></main>`;
}
async function subscribe(btn) {
  await busy(btn, async () => {
    try { S.ui.feedUrls = await post('/api/calendar/feed'); await refresh(); toast('الرابط جاهز — اضغطي «فتح في تطبيق التقويم» ثم «اشتراك».'); }
    catch (e) { toast(e.message, { error: true }); }
  });
}

export const screens = {
  approve: { render: approveScreen, title: 'التحقق الآمن' },
  'verify-error': { render: verifyErrorScreen, title: 'تعذر التحقق' },
  'calendar-sync': { render: calendarSyncScreen, title: 'مزامنة التقويم', enter: () => { S.ui.feedUrls = null; } },
};
export const sheets = { 'approve-password': passwordSheet };
export const actions = {
  'approve-faceid': (el) => runWithToken(() => (canUsePasskey() ? WA.assert('stepup') : post('/api/auth/stepup', { method: 'demo-biometric' })), el),
  'approve-fallback': () => openSheet('approve-password'),
  'cal-subscribe': (el) => subscribe(el),
  'cal-open-webcal': () => {},
  'cal-copy': async () => { try { await navigator.clipboard.writeText(S.ui.feedUrls.httpsUrl); toast('تم نسخ الرابط'); } catch { toast('تعذّر النسخ؛ انسخي الرابط يدويًا.', { error: true }); } },
  'cal-check': async (el) => { await busy(el, refresh); toast(feedStatus().label === 'متصل' ? 'التقويم متصل' : 'لم تصل أي مزامنة بعد'); },
  'cal-revoke': async (el) => {
    if (!(await askConfirm('إلغاء ربط التقويم؟', { text: 'احذفي الاشتراك من تطبيق التقويم أيضًا.', ok: 'إلغاء الربط', danger: true, cancel: 'رجوع' }))) return;
    await busy(el, async () => { await del('/api/calendar/feed'); S.ui.feedUrls = null; await refresh(); toast('تم إلغاء ربط التقويم'); });
  },
};
export const forms = {
  'approve-password': async (f, btn) => {
    const password = f.password.value; const err = f.querySelector('#ap-err'); err.textContent = '';
    if (!/^\d{6}$/.test(password)) { err.textContent = 'أدخلي رمز المرور من 6 أرقام.'; return; }
    const p = S.ui.pending; if (!p) return;
    await busy(btn, async () => {
      let token;
      try { ({ stepUpToken: token } = await post('/api/auth/stepup', { method: 'password', password })); }
      catch (e) { err.textContent = errText(e); return; }
      S.sheet = null;
      try { await p.run(token); } catch (e) { render(); toast(errText(e), { error: true }); }
    });
  },
};
export { render };
