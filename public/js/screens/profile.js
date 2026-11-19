/* Profile (Figma 15) and its pages: Personal (37), Security & Privacy (38), Notifications (39 + inbox),
   Help & Support (40), Widget Settings (16), trusted devices (passkeys), PIN change. */
import { S, render, go, openSheet, closeSheet, refresh, busy } from '../store.js';
import { post, patch, del } from '../api.js';
import * as WA from '../webauthn.js';
import { esc, icon, hdr, infoCard, money, toast, relTime, askConfirm, sheetHead, daysBetween, dayMonth, dateOfMs, bio } from '../ui.js';
import { widgetScript } from '../widget-script.js';
import { errText } from './common.js';

const back = (to = 'profile', label = 'العودة إلى حسابي', cls = 'btn-primary') => `<div class="bottom"><button class="btn ${cls}" data-nav="${to}">${label}</button></div>`;

function profile() {
  const me = S.data.me;
  return `<main class="screen">${hdr('حسابي', { back: 'home' })}
    <div class="profile-head"><div class="avatar" aria-hidden="true">${esc(me.fullName.charAt(0))}</div><div><b>${esc(me.fullName)}</b><span>${esc(me.phone)}</span></div></div>
    <div class="stack">
      <button class="item" data-nav="personal"><span class="t">البيانات الشخصية</span><span class="m">تعديل البيانات الأساسية</span></button>
      <button class="item" data-nav="security"><span class="t">الأمان والخصوصية</span><span class="m">رمز المرور والأجهزة</span></button>
      <button class="item" data-nav="notifications"><span class="t">الإشعارات</span><span class="m">تفضيلات التنبيهات</span></button>
      <button class="item" data-nav="help"><span class="t">المساعدة والدعم</span><span class="m">الأسئلة الشائعة والتواصل</span></button>
    </div>
    <div class="stack" style="margin-top:22px">
      <button class="btn btn-secondary" data-nav="widget">ويدجت الرصيد على الآيفون</button>
      <button class="btn btn-secondary" data-action="logout">تسجيل الخروج</button>
    </div>
  </main>`;
}

const personal = () => { const me = S.data.me; return `<main class="screen">${hdr('البيانات الشخصية', { back: 'profile', sub: 'البيانات المسجلة في حسابك' })}<div class="gap" style="height:30px"></div>
  <div class="stack">${infoCard('الاسم', esc(me.fullName))}${infoCard('رقم الجوال', `<span class="num">${esc(me.phone)}</span>`)}${infoCard('رقم الهوية', '<span class="num">••••••••••</span>')}</div>${back()}</main>`; };

function security() {
  const pk = S.data.passkeys.length;
  return `<main class="screen">${hdr('الأمان والخصوصية', { back: 'profile', sub: 'إعدادات التحكم في الوصول والبيانات' })}<div class="gap" style="height:30px"></div>
    <div class="stack">
      <button class="item" data-action="open-devices"><span class="t">الأجهزة الموثوقة</span><span class="m">${pk ? `${pk} جهاز مسجّل لـ ${bio.name}` : 'إدارة اعتماد الجهاز للتحويل'}</span></button>
      <button class="item" data-nav="widget"><span class="t">ويدجت الرصيد</span><span class="m">الأحجام وإضافته للشاشة الرئيسية</span></button>
      <button class="item" data-action="open-password"><span class="t">التحقق من العمليات</span><span class="m">طرق الاعتماد المتاحة لحسابك</span></button>
    </div>${back('profile', 'العودة إلى حسابي', 'btn-secondary')}</main>`;
}

function notifications() {
  const p = S.data.me.prefs; const f = S.data.calendarFeed; const list = S.data.notifications; const unread = list.filter((n) => !n.read_at).length;
  const remTxt = { 0: 'يوم الموعد', 1: 'قبل الموعد بيوم', 3: 'قبل الموعد بـ 3 أيام', 7: 'قبل الموعد بأسبوع' };
  return `<main class="screen">${hdr('الإشعارات', { back: 'profile', sub: 'اختاري التذكيرات المناسبة لك' })}<div class="gap" style="height:30px"></div>
    <div class="stack">
      <button class="item" data-action="pref-toggle" data-k="transfers"><span class="t">تنبيهات التحويلات</span><span class="m">${p.notify.transfers ? 'مفعّلة' : 'متوقفة'}</span></button>
      <button class="item" data-action="pref-toggle" data-k="commitments"><span class="t">الالتزامات الشهرية</span><span class="m">${p.notify.commitments ? `مفعّلة • ${remTxt[1]}` : 'متوقفة'}</span></button>
      <button class="item" data-nav="calendar-sync"><span class="t">مزامنة التقويم</span><span class="m">${!f.active ? 'إدارة الصلاحية والمواعيد' : f.lastFetchedAt ? `متصل • آخر مزامنة ${relTime(f.lastFetchedAt)}` : 'بانتظار الاشتراك'}</span></button>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin:30px 0 12px"><h2 class="section-t" style="margin:0">آخر الإشعارات</h2>${unread ? '<button class="link small" data-action="notif-all">تحديد الكل كمقروء</button>' : ''}</div>
    <div class="stack">${list.slice(0, 20).map((n) => `<button class="item ${n.read_at ? '' : 'unread'}" data-action="notif-open" data-id="${n.id}"><span class="t" style="font-size:15px">${esc(n.title)}</span><span class="m">${esc(n.body)} • ${relTime(n.created_at)}</span></button>`).join('') || '<p class="empty">لا توجد إشعارات.</p>'}</div>
    ${back()}</main>`;
}

const help = () => `<main class="screen">${hdr('المساعدة والدعم', { back: 'profile', sub: 'الإجابات والإرشادات عند الحاجة' })}<div class="gap" style="height:30px"></div>
  <div class="stack"><button class="item" data-action="help-otp"><span class="t">رمز التحقق لا يصل</span><span class="m">خيارات الاسترداد والتحقق</span></button>
  <button class="item" data-action="help-contact"><span class="t">التواصل مع الدعم</span><span class="m">مساعدة عامة للحساب</span></button></div>
  <p class="note-line" style="margin-top:56px">هذا نموذج تجربة؛ لا توجد قناة دعم بنكية حقيقية.</p>${back()}</main>`;

const whenTxt = (iso, today) => { const d = daysBetween(today, iso); return d === 0 ? 'اليوم' : d === 1 ? 'غدًا' : d > 1 && d < 7 ? `بعد ${d} أيام` : dayMonth(iso); };
function widgetPreview(size, hide) {
  const me = S.data.me; const today = S.data.today || dateOfMs(Date.now());
  const ups = S.data.commitments.filter((c) => c.status === 'active').sort((a, b) => a.due_date.localeCompare(b.due_date));
  const bal = `<div class="wg-bal"><span class="l">الرصيد المتاح</span><span class="v"><b class="num">${hide ? '••••••' : money(me.balance)}</b> ر.س</span></div>`;
  const row = (t, v, cls = 'g') => `<div class="wg-row"><span class="t">${esc(t)}</span><span class="${cls}">${v}</span></div>`;
  const head = `<div class="wg-head"><span>واضح</span><span class="num">•• ${esc(me.accountNumber.slice(-4))}</span></div>`;
  const foot = `<div class="wg-foot">${hide ? 'الرصيد مخفي' : 'محدّث الآن'}</div>`;
  if (size === 'small') return `<div class="wg wg-s">${head}${bal}${ups[0] ? `<div class="wg-next">${esc(ups[0].title)} • ${whenTxt(ups[0].due_date, today)}</div>` : ''}</div>`;
  if (size === 'medium') return `<div class="wg wg-m">${head}<div class="wg-cols">${bal}<div class="wg-list">${ups.slice(0, 3).map((c) => row(c.title, whenTxt(c.due_date, today))).join('')}</div></div></div>`;
  const tx = S.data.transactions.slice(0, 3);
  return `<div class="wg wg-l">${head}${bal}<div class="wg-sec">الالتزامات القادمة</div>${ups.slice(0, 3).map((c) => row(c.title, whenTxt(c.due_date, today))).join('')}
    <div class="wg-sec">آخر العمليات</div>${tx.map((t) => row(t.title, `<span class="num">${hide ? '••••' : (t.direction === 'out' ? '−' : '+') + money(t.amount)}</span>`, 'm')).join('')}${foot}</div>`;
}

function widget() {
  const hide = !!S.data.me.prefs.hideBalance; const size = S.ui.wgSize || 'medium'; const w = S.data.widget || { active: false }; const url = S.ui.widgetUrl;
  const sizes = [['small', 'صغير'], ['medium', 'متوسط'], ['large', 'كبير']];
  return `<main class="screen">${hdr('ويدجت الرصيد', { back: 'profile', sub: 'رصيدك على الشاشة الرئيسية للآيفون' })}<div class="gap" style="height:18px"></div>
    <div class="card-switch" role="group" aria-label="حجم الويدجت">${sizes.map(([k, l]) => `<button data-action="wg-size" data-size="${k}" aria-pressed="${size === k}">${l}</button>`).join('')}</div>
    <div class="wg-stage">${widgetPreview(size, hide)}</div>
    <div class="card-switch" role="group" aria-label="عرض الرصيد" style="margin-top:18px">
      <button data-action="widget-mode" data-hide="0" aria-pressed="${!hide}">إظهار الرصيد</button>
      <button data-action="widget-mode" data-hide="1" aria-pressed="${hide}">إخفاء الرصيد</button></div>
    <h2 class="section-t" style="margin-top:26px">إضافته للآيفون</h2>
    ${!w.active || !url ? `<p class="note-line" style="margin-bottom:14px">${w.active ? 'الويدجت مربوط. لنسخ الكود مرة ثانية أنشئي رابطًا جديدًا.' : 'يعمل عبر تطبيق Scriptable المجاني، ويتحدث تلقائيًا من خادم واضح.'}</p>
      <button class="btn btn-primary" data-action="wg-link">${w.active ? 'رابط جديد' : 'ربط الويدجت'}</button>`
    : `<ol class="wg-steps">
        <li>ثبّتي تطبيق <b>Scriptable</b> المجاني من App Store.</li>
        <li>اضغطي «نسخ كود الويدجت» تحت.</li>
        <li>في Scriptable: زر <b>+</b> ← الصقي الكود ← سمّيه «واضح».</li>
        <li>اضغطي مطولًا على الشاشة الرئيسية ← تعديل ← إضافة أداة ← <b>Scriptable</b> ← اختاري الحجم.</li>
        <li>اضغطي على الأداة ← Script ← <b>واضح</b>.</li></ol>
      <button class="btn btn-primary" data-action="wg-copy">نسخ كود الويدجت</button>`}
    ${w.active ? `<p class="note-line" style="margin-top:14px">${w.lastFetchedAt ? `متصل • آخر تحديث ${relTime(w.lastFetchedAt)}` : 'بانتظار أول تحديث من الآيفون'}</p>
      <button class="btn btn-text" data-action="wg-unlink" style="color:var(--red)">إلغاء الربط</button>` : ''}
    <p class="note-line" style="margin-top:14px">رابط قراءة فقط خاص بك، ما ينفّذ أي عملية. «إخفاء الرصيد» يخفي المبالغ من الويدجت أيضًا.</p>
  </main>`;
}

const accountSheet = () => { const me = S.data.me; return `${sheetHead('اختاري الحساب')}
  <div class="item" aria-pressed="true" style="margin-bottom:28px"><span class="t">الحساب الجاري <span class="num">•••• ${esc(me.accountNumber.slice(-4))}</span></span><span class="m">الرصيد المتاح: <span class="num">${money(me.balance)}</span> ر.س</span></div>
  <button class="btn btn-primary" data-close>تأكيد الاختيار</button>`; };

function devicesSheet() {
  const keys = S.data.passkeys; const here = WA.deviceCredentialId(); const sup = S.passkey;
  return `${sheetHead('الأجهزة الموثوقة')}
    <div class="stack">${keys.map((k) => `<div class="item row"><span class="grow"><span class="t">${esc(k.label)}${k.id === here ? ' • هذا الجهاز' : ''}</span><span class="m">${k.last_used ? `آخر استخدام ${relTime(k.last_used)}` : 'لم يُستخدم بعد'}</span></span><button class="x" style="width:40px;height:40px;border-radius:12px;border:0;background:var(--red-soft);color:var(--red);display:grid;place-items:center" data-action="passkey-del" data-id="${esc(k.id)}" aria-label="حذف ${esc(k.label)}">${icon.trash}</button></div>`).join('') || '<p class="note-line">لا توجد أجهزة مسجّلة.</p>'}</div>
    <div style="height:18px"></div>
    ${sup === 'platform' ? (keys.some((k) => k.id === here) ? '' : `<button class="btn btn-primary" data-action="passkey-add">تفعيل ${bio.name} على هذا الجهاز</button>`)
      : `<p class="warn">${sup === 'insecure' ? `${bio.name} يتطلب اتصالًا آمنًا (HTTPS).` : 'هذا الجهاز لا يدعم مفاتيح المرور — يُستخدم التحقق التجريبي بدلًا منها.'}</p>`}`;
}

const passwordSheet = () => `${sheetHead('التحقق من العمليات')}
  <p class="note-line" style="margin-bottom:18px">تُعتمد التحويلات والمدفوعات ${bio.with}، أو برمز المرور عند تعذّره.</p>
  <form data-form="pw-change" novalidate>
    <div class="field"><label for="pw-cur">رمز المرور الحالي</label><input id="pw-cur" name="cur" class="input ltr-input" type="password" inputmode="numeric" maxlength="6" autocomplete="off"></div>
    <div class="field"><label for="pw-new">رمز المرور الجديد</label><input id="pw-new" name="next" class="input ltr-input" type="password" inputmode="numeric" maxlength="6" autocomplete="off"><span class="hint">6 أرقام، وتجنّبي الأرقام المتكررة أو المتسلسلة.</span></div>
    <p class="err" id="pw-err" role="alert" style="color:#C0413F;font-size:13px;margin:-10px 0 14px"></p>
    <button class="btn btn-primary" type="submit">تغيير رمز المرور</button>
  </form>`;

async function savePrefs(body, msg = 'تم حفظ التفضيلات') {
  try { const r = await patch('/api/prefs', body); S.data.me.prefs = r.prefs; render(); toast(msg); } catch (e) { toast(e.message, { error: true }); }
}

export const screens = {
  profile: { render: profile, title: 'حسابي', tab: 'profile' },
  personal: { render: personal, title: 'البيانات الشخصية' },
  security: { render: security, title: 'الأمان والخصوصية' },
  notifications: { render: notifications, title: 'الإشعارات' },
  help: { render: help, title: 'المساعدة والدعم' },
  widget: { render: widget, title: 'ويدجت الرصيد' },
};
export const sheets = { 'choose-account': accountSheet, devices: devicesSheet, password: passwordSheet };
export const actions = {
  'open-devices': () => openSheet('devices'),
  'open-password': () => openSheet('password'),
  'choose-account': () => openSheet('choose-account'),
  'wg-size': (el) => { S.ui.wgSize = el.dataset.size; render(); },
  'wg-link': async (el) => { await busy(el, async () => { try { S.ui.widgetUrl = await post('/api/widget/token'); await refresh(); toast('تم إنشاء رابط الويدجت'); } catch (e) { toast(errText(e), { error: true }); } }); },
  'wg-copy': async () => { const u = S.ui.widgetUrl; try { await navigator.clipboard.writeText(widgetScript(u.url, u.appUrl)); toast('تم نسخ الكود — الصقيه في Scriptable'); } catch { toast('تعذّر النسخ تلقائيًا', { error: true }); } },
  'wg-unlink': async (el) => { if (!(await askConfirm('إلغاء ربط الويدجت؟', { text: 'راح يتوقف الويدجت عن التحديث.', ok: 'إلغاء الربط', danger: true }))) return; await del('/api/widget/token'); S.ui.widgetUrl = null; await refresh(); toast('تم إلغاء الربط'); },
  'widget-mode': (el) => savePrefs({ hideBalance: el.dataset.hide === '1' }, el.dataset.hide === '1' ? 'الرصيد مخفي في الويدجت' : 'الرصيد ظاهر في الويدجت'),
  'pref-toggle': (el) => savePrefs({ notify: { [el.dataset.k]: !S.data.me.prefs.notify[el.dataset.k] } }),
  'notif-open': (el) => { const n = S.data.notifications.find((x) => x.id === Number(el.dataset.id)); if (n && !n.read_at) { n.read_at = Date.now(); post(`/api/notifications/${n.id}/read`).catch(() => {}); render(); } },
  'notif-all': async (el) => { await busy(el, async () => { await post('/api/notifications/read-all'); await refresh(); toast('تم تحديد الكل كمقروء'); }); },
  'help-otp': () => toast(`لا تُرسل رموز تحقق في النموذج التجريبي — الدخول برمز المرور أو ${bio.name}.`),
  'help-contact': () => toast('نموذج تجريبي: لا توجد قناة دعم بنكية حقيقية.'),
  'passkey-add': async (el) => {
    await busy(el, async () => {
      try { const label = /iPhone/.test(navigator.userAgent) ? 'iPhone' : /iPad/.test(navigator.userAgent) ? 'iPad' : /Mac/.test(navigator.userAgent) ? 'Mac' : /Windows/.test(navigator.userAgent) ? 'Windows Hello' : 'هذا الجهاز';
        await WA.register(label); await refresh(); S.session.hasPasskeys = true; toast(`تم تفعيل ${bio.name} على هذا الجهاز`); }
      catch (e) { toast(WA.friendlyError(e), { error: true }); }
    });
  },
  'passkey-del': async (el) => {
    if (!(await askConfirm('حذف هذا الجهاز؟', { ok: 'حذف', danger: true }))) return;
    await del(`/api/passkeys/${encodeURIComponent(el.dataset.id)}`); WA.forgetCredential(el.dataset.id); await refresh(); toast('تم حذف الجهاز');
  },
  logout: async (el) => {
    await busy(el, async () => { try { await post('/api/auth/logout'); } catch { /* ignore */ } S.data = null; S.sheet = null; S.ui = {}; S.session = { ...S.session, authenticated: false }; go('welcome'); toast('تم تسجيل الخروج'); });
  },
};
export const forms = {
  'pw-change': async (f, btn) => {
    const err = f.querySelector('#pw-err'); err.textContent = '';
    if (!/^\d{6}$/.test(f.next.value)) { err.textContent = 'رمز المرور الجديد 6 أرقام.'; return; }
    await busy(btn, async () => {
      try { await post('/api/auth/password/change', { currentPassword: f.cur.value, newPassword: f.next.value }); closeSheet(); await refresh(); toast('تم تغيير رمز المرور'); }
      catch (e) { err.textContent = errText(e); }
    });
  },
};
