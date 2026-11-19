/* Commitments (Figma 17 التزاماتي, 18 إضافة التزام, 19 حفظ الالتزام, 20 السماح بالتقويم, 21 معاينة التقويم).
   Types include rotating savings groups (الجمعيات) — tracking only, no money is moved between members. */
import { S, render, go, openSheet, closeSheet, refresh, busy, commitment } from '../store.js';
import { post, patch, del } from '../api.js';
import { esc, icon, hdr, sarShort, moneyShort, toHalalas, digits, toast, askConfirm, sheetHead, dom, nextDom, addMonthsISO, dayMonth, typeLabel } from '../ui.js';
import { addEventToCalendar } from './common.js';

const REM = [[1, 'قبل الموعد بيوم'], [0, 'يوم الموعد'], [3, 'قبل الموعد بـ 3 أيام'], [7, 'قبل الموعد بأسبوع']];
const remText = (d) => (REM.find(([v]) => v === d) || [0, `قبل الموعد بـ ${d} أيام`])[1];

function list(p) {
  const sg = p.type === 'savings_group';
  const items = S.data.commitments.filter((c) => c.status === 'active' && (!sg || c.type === 'savings_group'));
  return `<main class="screen white">${hdr(sg ? 'الجمعيات' : 'التزاماتي', { back: sg ? 'services' : 'home', sub: sg ? 'تتبّعي جمعياتك ومواعيد الاستلام' : 'تابعي مواعيدك المالية في مكان واحد' })}<div class="gap" style="height:34px"></div>
    <div class="stack">${items.length ? items.map((c) => `<button class="item row" style="background:#F4F7FB;box-shadow:none" data-nav="calendar-preview?id=${c.id}">
        <span class="grow"><span class="t">${esc(c.title)}</span><span class="m">${sarShort(c.amount)}${c.type === 'savings_group' && c.total_payments ? ` • الدفعة ${Math.min(c.paid_count + 1, c.total_payments)} من ${c.total_payments}` : ''}</span></span>
        <span class="day-box" style="background:#E3ECF8" aria-label="يوم ${dom(c.due_date)}">${dom(c.due_date)}</span></button>`).join('')
      : `<p class="empty">${sg ? 'لا توجد جمعيات بعد.' : 'لا توجد التزامات بعد.'}</p>`}</div>
    <div class="bottom"><button class="btn btn-primary" data-nav="commitment-add${sg ? '?type=savings_group' : ''}">${sg ? 'إضافة جمعية' : 'إضافة التزام شهري'}</button></div></main>`;
}

function addForm(p) {
  const ex = p.id ? commitment(p.id) : null;
  const f = S.ui.cf || (S.ui.cf = { type: ex?.type || p.type || 'installment', sync: true });
  const sg = f.type === 'savings_group';
  const day = ex ? dom(sg ? ex.start_date : ex.due_date) : 15;
  const total = ex?.total_payments || 10;
  const opt = (v, l, sel) => `<option value="${v}" ${sel ? 'selected' : ''}>${l}</option>`;
  return `<main class="screen white">${hdr(ex ? 'تعديل الالتزام' : 'إضافة التزام', { back: ex ? `calendar-preview?id=${ex.id}` : 'commitments' })}<div class="gap" style="height:18px"></div>
    <form data-form="commitment" id="c-form" data-id="${ex?.id || ''}" novalidate>
      <div class="lfield"><label for="c-title">${sg ? 'اسم الجمعية' : 'اسم الالتزام'}</label><input id="c-title" name="title" class="input" maxlength="60" value="${esc(ex?.title || '')}" placeholder="${sg ? 'جمعية العائلة' : 'قسط السيارة'}"></div>
      <div class="lfield"><label for="c-type">النوع</label><select id="c-type" name="type" class="select" data-change="c-type">${Object.entries(typeLabel).map(([k, l]) => opt(k, l, k === f.type)).join('')}</select></div>
      <div class="lfield"><label for="c-amount">${sg ? 'المساهمة الشهرية' : 'المبلغ الشهري'}</label><div class="input-wrap"><input id="c-amount" name="amount" class="input ltr-input" inputmode="decimal" value="${ex ? moneyShort(ex.amount).replace(/,/g, '') : ''}" placeholder="1,250"><span class="suffix">ر.س</span></div></div>
      <div class="lfield"><label for="c-day">${sg ? 'يوم الدفع' : 'يوم الاستحقاق'}</label><select id="c-day" name="day" class="select">${Array.from({ length: 28 }, (_, i) => opt(i + 1, `${i + 1} من كل شهر`, i + 1 === day)).join('')}</select></div>
      ${sg ? `<div class="lrow"><div class="lfield"><label for="c-total">عدد الأشهر</label><input id="c-total" name="totalPayments" class="input ltr-input" inputmode="numeric" value="${total}" data-input="c-total"></div>
        <div class="lfield"><label for="c-payout">شهر الاستلام</label><select id="c-payout" name="payoutIndex" class="select">${Array.from({ length: total }, (_, i) => opt(i + 1, `الشهر ${i + 1}`, (ex?.payout_index || 1) === i + 1)).join('')}</select></div></div>`
      : `<div class="lfield"><label for="c-rec">التكرار</label><select id="c-rec" name="recurrence" class="select">${opt('monthly', 'شهريًا', !ex || ex.recurrence === 'monthly')}${opt('none', 'مرة واحدة', ex?.recurrence === 'none')}</select></div>`}
      <div class="lfield"><label for="c-rem">موعد التذكير</label><select id="c-rem" name="reminderDays" class="select">${REM.map(([v, l]) => opt(v, l, (ex?.reminder_days ?? 1) === v)).join('')}</select></div>
      ${ex ? '' : `<button type="button" class="sync-toggle" data-action="c-sync" aria-pressed="${f.sync}"><span>مزامنة مع تقويم الآيفون</span>${icon.calendar}</button>`}
      <p class="err" id="c-err" role="alert" style="color:#C0413F;font-size:13px;margin:0 0 8px"></p>
    </form>
    <div class="bottom" style="padding-top:8px"><button class="btn btn-primary" type="submit" form="c-form">${ex ? 'حفظ التعديلات' : 'حفظ الالتزام'}</button></div></main>`;
}

function saved(p) {
  const c = commitment(p.id); if (!c) { setTimeout(() => go('commitments')); return '<main class="screen"></main>'; }
  const sync = S.ui.lastSync !== false;
  const when = c.recurrence === 'monthly' ? `يوم ${dom(c.due_date)} من كل شهر` : `يوم ${dayMonth(c.due_date)}`;
  return `<main class="screen">${hdr('تم حفظ الالتزام', { back: 'commitments' })}
    <div class="status" style="align-items:stretch"><div class="badge ok" style="margin-top:56px">${icon.checkBold}</div>
      <p style="text-align:right;color:var(--text)">سيصلك تذكير ل${esc(c.title)} ${when}.</p>
      ${sync ? '<p style="text-align:right;color:var(--text);margin-top:56px">هل تريدين مزامنة المواعيد مع تقويم الآيفون؟</p>' : ''}</div>
    <div class="bottom">${sync ? `<button class="btn btn-primary" data-nav="calendar-permission?id=${c.id}">مزامنة التقويم</button><button class="btn btn-secondary" data-nav="commitments">لاحقًا</button>` : '<button class="btn btn-primary" data-nav="commitments">العودة لالتزاماتي</button>'}</div></main>`;
}

function permission(p) {
  const c = commitment(p.id); if (!c) { setTimeout(() => go('commitments')); return '<main class="screen"></main>'; }
  const when = c.recurrence === 'monthly' ? `يوم ${dom(c.due_date)} من كل شهر` : `يوم ${dayMonth(c.due_date)}`;
  return `<main class="screen">${hdr('مزامنة التقويم', { back: `calendar-preview?id=${c.id}`, sub: c.recurrence === 'monthly' ? 'تحتاجين السماح للتطبيق بإضافة موعد متكرر' : 'تحتاجين السماح للتطبيق بإضافة موعد' })}
    <div class="day-box" style="width:104px;height:104px;font-size:32px;border-radius:22px;margin:56px auto 30px">${dom(c.due_date)}</div>
    <p style="margin:0;color:var(--text);font-size:15px">سيُضاف ${esc(c.title)} إلى تقويم جهازك ${when}.</p>
    <p class="note-line" style="margin-top:56px">يظهر اسم الالتزام فقط؛ لا يظهر المبلغ في التنبيه.</p>
    <div class="bottom"><button class="btn btn-primary" data-action="cal-add" data-id="${c.id}">متابعة إلى التقويم</button><button class="btn btn-secondary" data-nav="commitments">ليس الآن</button></div></main>`;
}

function preview(p) {
  const c = commitment(p.id); if (!c) { setTimeout(() => go('commitments')); return '<main class="screen"></main>'; }
  const [y, m] = c.due_date.split('-').map(Number); const days = new Date(Date.UTC(y, m, 0)).getUTCDate(); const d = dom(c.due_date);
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1))).toUpperCase();
  const added = S.ui.calendarAdded?.[c.id];
  const sg = c.type === 'savings_group';
  return `<main class="screen white">${hdr('معاينة التقويم', { back: 'commitments', tool: `<button class="tool" data-action="com-menu" data-id="${c.id}" aria-label="خيارات الالتزام">${icon.more}</button>` })}<div class="gap" style="height:24px"></div>
    <p class="month-t">${month}</p>
    <div class="mgrid" role="img" aria-label="${esc(c.title)} يوم ${d}">${Array.from({ length: days }, (_, i) => `<span class="${i + 1 === d ? 'on' : ''}">${String(i + 1).padStart(2, '0')}</span>`).join('')}</div>
    <div class="cal-detail"><h3>${esc(c.title)}</h3><p>${c.recurrence === 'monthly' ? `يوم ${d} من كل شهر` : `يوم ${dayMonth(c.due_date)}`} • ${sarShort(c.amount)}</p>
      <small>${remText(c.reminder_days).replace('قبل الموعد', 'تذكير قبل الموعد').replace(/^يوم الموعد$/, 'تذكير يوم الموعد')}${c.recurrence === 'monthly' ? ' • يتكرر شهريًا' : ''}${sg && c.total_payments ? ` • الدفعة ${Math.min(c.paid_count + 1, c.total_payments)} من ${c.total_payments} • الاستلام في الشهر ${c.payout_index}` : ''}</small></div>
    <button class="ok-strip" data-action="cal-add" data-id="${c.id}">${added ? `${icon.check} أُضيف إلى تقويم الآيفون` : `${icon.check} معاينة تذكير متكرر في التقويم`}</button>
    <div class="bottom" style="padding-top:18px"><button class="btn btn-primary" data-nav="carplay?id=${c.id}">معاينة CarPlay</button></div></main>`;
}

function menuSheet({ id }) {
  const c = commitment(id); if (!c) return '';
  const canPay = c.beneficiary_id || c.bill_id;
  return `${sheetHead(c.title)}<div class="menu">
    <button data-action="cal-add" data-id="${c.id}">${icon.calendar}إضافة إلى تقويم الآيفون</button>
    ${canPay ? `<button data-action="com-pay" data-id="${c.id}">${icon.transfer}سداد الآن</button>` : ''}
    <button data-action="com-mark" data-id="${c.id}">${icon.check}تحديد كمدفوع</button>
    <button data-action="com-edit" data-id="${c.id}">${icon.edit}تعديل</button>
    <button class="danger" data-action="com-delete" data-id="${c.id}">${icon.trash}حذف الالتزام</button></div>`;
}

export const screens = {
  commitments: { render: list, title: 'التزاماتي' },
  'commitment-add': { render: addForm, title: 'إضافة التزام', enter: () => { S.ui.cf = null; } },
  'commitment-saved': { render: saved, title: 'تم حفظ الالتزام' },
  'calendar-permission': { render: permission, title: 'مزامنة التقويم' },
  'calendar-preview': { render: preview, title: 'معاينة التقويم' },
};
export const sheets = { 'com-menu': menuSheet };
export const inputs = {
  'c-total': (el) => { const n = Math.min(36, Math.max(2, Number(digits(el.value)) || 2)); const s = document.getElementById('c-payout'); const cur = Number(s.value) || 1; s.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${cur === i + 1 ? 'selected' : ''}>الشهر ${i + 1}</option>`).join(''); },
};
export const actions = {
  'c-type': (el) => {
    const f = el.closest('form'); const keep = Object.fromEntries(new FormData(f));
    S.ui.cf.type = el.value; render();
    const f2 = document.getElementById('c-form'); for (const k of ['title', 'amount', 'day', 'reminderDays']) if (keep[k] && f2.elements[k]) f2.elements[k].value = keep[k];
  },
  'c-sync': () => { S.ui.cf.sync = !S.ui.cf.sync; const b = document.querySelector('.sync-toggle'); b?.setAttribute('aria-pressed', String(S.ui.cf.sync)); },
  'cal-add': async (el) => { const id = el.dataset.id; if (S.sheet) closeSheet(); await addEventToCalendar(id, el.isConnected ? el : null); if (S.route.name === 'calendar-permission') go(`calendar-preview?id=${id}`); else render(); },
  'com-menu': (el) => openSheet('com-menu', { id: el.dataset.id }),
  'com-edit': (el) => { closeSheet(); go(`commitment-add?id=${el.dataset.id}`); },
  'com-pay': (el) => {
    const c = commitment(el.dataset.id); closeSheet();
    if (c.bill_id) go(`bill-review?id=${c.bill_id}`);
    else go(`transfer?ben=${c.beneficiary_id}&amount=${(c.amount / 100).toFixed(2)}&commitment=${c.id}&note=${encodeURIComponent(c.title)}`);
  },
  'com-mark': async (el) => {
    const c = commitment(el.dataset.id);
    if (!(await askConfirm('تحديد كمدفوع؟', { text: `سيُسجَّل «${c.title}» مدفوعًا لهذه الفترة دون خصم من رصيدك.`, ok: 'تحديد كمدفوع' }))) return;
    try { const r = await post(`/api/commitments/${c.id}/mark-paid`); closeSheet(); await refresh(); toast(r.completed ? 'اكتمل الالتزام' : 'تم تسجيل الدفعة وتحديث الموعد القادم'); if (r.completed) go('commitments'); }
    catch (e) { toast(e.message, { error: true }); }
  },
  'com-delete': async (el) => {
    const c = commitment(el.dataset.id);
    if (!(await askConfirm('حذف الالتزام؟', { text: `سيُحذف «${c.title}» نهائيًا.`, ok: 'حذف', danger: true }))) return;
    try { await del(`/api/commitments/${c.id}`); S.sheet = null; await refresh(); go('commitments'); toast('تم حذف الالتزام'); }
    catch (e) { toast(e.message, { error: true }); }
  },
};
export const forms = {
  commitment: async (f, btn) => {
    const v = Object.fromEntries(new FormData(f)); const err = f.querySelector('#c-err'); err.textContent = '';
    const ex = f.dataset.id ? commitment(f.dataset.id) : null; const type = v.type; const sg = type === 'savings_group';
    const amount = digits(v.amount).replace(/,/g, '').trim();
    if (String(v.title).trim().length < 2) { err.textContent = 'أدخلي اسم الالتزام.'; f.title.focus(); return; }
    if (!/^\d+(\.\d{1,2})?$/.test(amount) || toHalalas(amount) <= 0) { err.textContent = 'أدخلي مبلغًا صحيحًا.'; f.amount.focus(); return; }
    const day = Number(v.day); const today = S.data.today;
    const body = { type, title: v.title.trim(), amount, reminderDays: Number(v.reminderDays) };
    if (sg) {
      const total = Number(digits(v.totalPayments));
      if (!Number.isInteger(total) || total < 2 || total > 36) { err.textContent = 'عدد الأشهر بين 2 و 36.'; return; }
      const start = ex && dom(ex.start_date) === day ? ex.start_date : nextDom(today, day);
      Object.assign(body, { recurrence: 'monthly', startDate: start, totalPayments: total, payoutIndex: Number(v.payoutIndex), dueDate: ex ? addMonthsISO(start, ex.paid_count) : start });
    } else {
      body.recurrence = v.recurrence;
      body.dueDate = ex && dom(ex.due_date) === day ? ex.due_date : nextDom(today, day);
    }
    await busy(btn, async () => {
      try {
        let id = ex?.id;
        if (ex) await patch(`/api/commitments/${ex.id}`, body); else id = (await post('/api/commitments', body)).id;
        S.ui.lastSync = ex ? false : S.ui.cf?.sync !== false; await refresh();
        if (ex) { go(`calendar-preview?id=${id}`); toast('تم حفظ التعديلات'); } else go(`commitment-saved?id=${id}`);
      } catch (e) { err.textContent = e.message; }
    });
  },
};
