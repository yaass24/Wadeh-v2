/* Home (Figma "04 / الرئيسية · Home"). */
import { S, render } from '../store.js';
import { patch } from '../api.js';
import { esc, icon, money, moneyShort, dateLong, dateOfMs, toast } from '../ui.js';

export function txRows(list) {
  return list.map((t) => `<div class="tx"><div><span class="t">${esc(t.title)}</span><span class="m">${dateLong(dateOfMs(t.created_at))}</span></div>
    <span class="a ${t.direction === 'in' ? 'in' : ''}"><span class="num">${t.direction === 'in' ? '+' : '–'}${moneyShort(t.amount)}</span> ر.س</span></div>`).join('');
}

const hello = () => (Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Riyadh' }).format(new Date())) < 12 ? 'صباح الخير' : 'مساء الخير');

function home() {
  const me = S.data.me; const hide = !!me.prefs.hideBalance;
  const recent = S.data.transactions.slice(0, 3);
  const ups = S.data.commitments.filter((c) => c.status === 'active').sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 3);
  const unread = S.data.notifications.filter((n) => !n.read_at).length;
  return `<main class="screen">
    <header class="home-head">
      <div class="brand"><img src="/icons/wadeh-symbol.png" alt="واضح" width="40" height="39"><div><div class="hello">${hello()}</div><h1 class="name">مرحبًا، ${esc(me.name)}</h1></div></div>
      <button class="bell" data-nav="notifications" aria-label="الإشعارات${unread ? `، ${unread} غير مقروءة` : ''}">${icon.bell}${unread ? `<span class="badge-n">${unread > 9 ? '9+' : unread}</span>` : ''}</button>
    </header>
    <div class="home-top">
    <section class="balance" aria-label="الرصيد">
      <div class="lbl"><span>الرصيد المتاح</span><button class="eye" data-action="toggle-balance" aria-pressed="${hide}" aria-label="${hide ? 'إظهار الرصيد' : 'إخفاء الرصيد'}">${hide ? icon.eyeOff : icon.eye}</button></div>
      <div class="amt">${hide ? '<span aria-label="الرصيد مخفي">••••••</span>' : `<span class="num">${money(me.balance)}</span>`}<span class="cur">ر.س</span></div>
      <div class="acct">الحساب الجاري <span class="num">•••• ${esc(me.accountNumber.slice(-4))}</span></div>
    </section>
    <div class="home-quick"><h2 class="section-t">خدمات سريعة</h2>
    <nav class="tiles" aria-label="خدمات سريعة">
      <button class="tile" data-nav="transfer">${icon.transfer}تحويل الأموال</button>
      <button class="tile" data-nav="bills">${icon.bill}سداد الفواتير</button>
      <button class="tile" data-nav="cards">${icon.card}بطاقاتي</button>
      <button class="tile" data-nav="expenses">${icon.bars}المصروفات</button>
    </nav></div></div>
    <div class="home-bottom">
      <div><h2 class="section-t">آخر العمليات</h2>
      <div class="card">${recent.length ? txRows(recent) : '<p class="empty">لا توجد عمليات بعد.</p>'}</div></div>
      <div class="desk-only"><h2 class="section-t">الالتزامات القادمة</h2>
      <div class="card">${ups.map((c) => `<button class="tx tx-btn" data-nav="calendar-preview?id=${c.id}"><div><span class="t">${esc(c.title)}</span><span class="m">${dateLong(c.due_date)}</span></div><span class="a">${hide ? '••••' : `<span class="num">${moneyShort(c.amount)}</span> ر.س`}</span></button>`).join('') || '<p class="empty">لا توجد التزامات.</p>'}</div></div>
    </div>
    <button class="pill-btn mob-only" style="margin-top:16px" data-nav="commitments">التزاماتي <span aria-hidden="true">←</span></button>
  </main>`;
}

export const screens = { home: { render: home, title: 'الرئيسية', tab: 'home' } };
export const actions = {
  'toggle-balance': async () => {
    const v = !S.data.me.prefs.hideBalance; S.data.me.prefs.hideBalance = v; render();
    try { await patch('/api/prefs', { hideBalance: v }); } catch (e) { toast(e.message, { error: true }); }
  },
};
