/* Bills (Figma 24), Bill Review (31), Bill Paid (32). Payment requires Face ID approval. */
import { S, go, refresh, busy } from '../store.js';
import { post } from '../api.js';
import { esc, icon, hdr, infoCard, money, sarShort, dayMonth, toast, uid } from '../ui.js';
import { requireApproval } from './common.js';

const bill = (id) => S.data.bills.find((b) => b.id === Number(id));

function bills() {
  const due = S.data.bills.filter((b) => b.status === 'due'); const paid = S.data.bills.filter((b) => b.status === 'paid');
  return `<main class="screen">${hdr('الفواتير', { back: 'services', sub: 'راجعي الفواتير المستحقة قبل السداد' })}<div class="gap" style="height:36px"></div>
    <div class="stack">${due.map((b) => `<button class="item" data-nav="bill-review?id=${b.id}"><span class="t">فاتورة ${esc(b.biller)}</span><span class="m">مستحقة في ${dayMonth(b.due_date)} • ${sarShort(b.amount)}</span></button>`).join('') || '<p class="empty">لا توجد فواتير مستحقة.</p>'}
      ${paid.map((b) => `<div class="item" style="opacity:.75"><span class="t">فاتورة ${esc(b.biller)}</span><span class="m">مدفوعة • ${sarShort(b.amount)}</span></div>`).join('')}</div>
    <div class="info" style="margin-top:44px"><span class="l">إجمالي المستحق</span><span class="v"><span class="num">${money(due.reduce((a, b) => a + b.amount, 0))}</span> ر.س</span></div>
    <div class="bottom"><button class="btn btn-secondary" data-nav="services">العودة للخدمات</button></div></main>`;
}

function review(p) {
  const b = bill(p.id); if (!b) { setTimeout(() => go('bills')); return '<main class="screen"></main>'; }
  const linked = b.commitment_id && S.data.commitments.find((c) => c.id === b.commitment_id);
  return `<main class="screen">${hdr('مراجعة الفاتورة', { back: 'bills', sub: 'راجعي البيانات قبل تأكيد السداد' })}<div class="gap" style="height:36px"></div>
    <div class="stack">${infoCard('نوع الفاتورة', `فاتورة ${esc(b.biller)}`)}${infoCard('رقم الحساب', `<span class="num">${esc(b.account_ref)}</span>`)}${infoCard('مبلغ الفاتورة', `<span class="num">${money(b.amount)}</span> ر.س`)}</div>
    ${b.status === 'due' && !linked ? `<button class="link small" style="margin-top:22px;align-self:flex-start" data-action="bill-link" data-id="${b.id}">+ أضيفي موعدها إلى التزاماتي والتقويم</button>` : ''}
    <div class="bottom">${b.status === 'due' ? `<button class="btn btn-primary" data-action="bill-pay" data-id="${b.id}" ${b.amount > S.data.me.balance ? 'disabled' : ''}>تأكيد سداد الفاتورة</button>${b.amount > S.data.me.balance ? '<p class="note-line" style="text-align:center">الرصيد غير كافٍ.</p>' : ''}` : '<button class="btn btn-secondary" data-nav="bills">مدفوعة — العودة</button>'}</div></main>`;
}

function paid() {
  const r = S.ui.billPaid; if (!r) { setTimeout(() => go('bills')); return '<main class="screen"></main>'; }
  return `<main class="screen">${hdr('تم السداد بنجاح', { back: 'services', sub: 'تم تنفيذ عملية السداد التجريبية' })}
    <div class="badge ok" style="margin:52px auto 44px">${icon.checkBold}</div>
    ${infoCard('المبلغ المسدد', `<span class="num">${money(r.amount)}</span> ر.س`)}
    <div class="bottom"><button class="btn btn-primary" data-nav="services">العودة للخدمات</button></div></main>`;
}

export const screens = {
  bills: { render: bills, title: 'الفواتير' },
  'bill-review': { render: review, title: 'مراجعة الفاتورة' },
  'bill-paid': { render: paid, title: 'تم السداد' },
};
export const actions = {
  'bill-pay': (el) => {
    const b = bill(el.dataset.id); const idem = uid();
    requireApproval({ back: `bill-review?id=${b.id}`, run: async (stepUpToken) => {
      const r = await post(`/api/bills/${b.id}/pay`, { idempotencyKey: idem, stepUpToken });
      S.ui.billPaid = { amount: r.transaction.amount }; await refresh(); go('bill-paid');
    } });
  },
  'bill-link': async (el) => {
    await busy(el, async () => {
      try { const r = await post(`/api/bills/${el.dataset.id}/to-commitment`); await refresh(); S.ui.lastSync = true; go(`calendar-permission?id=${r.id}`); }
      catch (e) { toast(e.message, { error: true }); }
    });
  },
};
