/* Transfers (Figma 06–12, 14 Insufficient Balance, 15 Empty Beneficiaries, 18 Choose-account style sheet).
   Beneficiaries → Transfer (step 1) → Review (step 2) → Face ID approval (step 3) → Processing → Success. */
import { S, render, go, openSheet, closeSheet, refresh, busy, beneficiary } from '../store.js';
import { post, ApiError } from '../api.js';
import { esc, icon, hdr, money, sar, toHalalas, digits, toast, uid, sheetHead } from '../ui.js';
import { requireApproval } from './common.js';

const T = () => S.ui.tr || reset();
function reset(p = {}) {
  S.ui.tr = { benId: p.ben ? Number(p.ben) : S.data?.beneficiaries[0]?.id || null, amount: p.amount || '', note: p.note || '', commitmentId: p.commitment ? Number(p.commitment) : null, idem: null, result: null };
  return S.ui.tr;
}

function beneficiaries() {
  const list = S.data.beneficiaries; const sel = S.ui.benSel ?? T().benId; const chosen = beneficiary(sel);
  if (!list.length) {
    return `<main class="screen">${hdr('المستفيدون', { back: 'transfer' })}
      <div class="status"><div class="badge icon">${icon.person}</div><h2>ما عندك مستفيدين محفوظين</h2><p>أضف مستفيدًا عشان تبدأ أول تحويل.</p></div>
      <div class="bottom"><button class="btn btn-primary" data-action="add-beneficiary">إضافة مستفيد</button></div></main>`;
  }
  return `<main class="screen">${hdr('المستفيدون المحفوظون', { back: 'transfer' })}<div class="gap" style="height:22px"></div>
    <div class="field" style="margin-bottom:28px"><label for="ben-q">البحث</label><input id="ben-q" class="input" type="search" placeholder="ابحث عن مستفيد" data-input="ben-q" autocomplete="off"></div>
    <div class="stack" id="ben-list">${list.map((b) => `<button class="item" data-action="ben-pick" data-id="${b.id}" data-name="${esc(b.name)}" aria-pressed="${b.id === sel}"><span class="t">${esc(b.name)}</span><span class="m">الحساب المنتهي بـ <span class="num">${esc(b.iban_last4)}</span></span></button>`).join('')}
      <p class="empty" id="ben-none" hidden>لا يوجد مستفيد بهذا الاسم.</p></div>
    <button class="link small" style="margin-top:18px;align-self:flex-start" data-action="add-beneficiary">+ إضافة مستفيد</button>
    <div class="bottom"><button class="btn btn-primary" data-action="ben-choose" ${chosen ? '' : 'disabled'}>${chosen ? `اختيار ${esc(chosen.name)}` : 'اختيار مستفيد'}</button></div></main>`;
}

function transfer() {
  const t = T(); const b = beneficiary(t.benId);
  return `<main class="screen">${hdr('تحويل الأموال', { back: 'home', step: 'الخطوة 1 من 3' })}<div class="gap" style="height:22px"></div>
    <form data-form="transfer" id="tr-form" novalidate>
      <div class="field"><span class="label" id="to-l">التحويل إلى</span>
        <button type="button" class="input pick" data-nav="beneficiaries" aria-labelledby="to-l">${b ? `<span>${esc(b.name)}  <span class="num">•••• ${esc(b.iban_last4)}</span></span>` : '<span style="color:var(--muted)">اختاري مستفيدًا</span>'}</button></div>
      <div class="field" style="margin-bottom:12px"><label for="tr-amount">المبلغ</label>
        <div class="input-wrap"><input id="tr-amount" name="amount" class="input ltr-input" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(t.amount)}" data-input="tr-amount"><span class="suffix">ر.س</span></div></div>
      <p class="note-line" style="font-size:12.5px;margin-bottom:28px">الرصيد المتاح: ${sar(S.data.me.balance)}</p>
      <div class="field"><label for="tr-note">ملاحظة (اختياري)</label><input id="tr-note" name="note" class="input" maxlength="80" placeholder="مثال: مصاريف مشتركة" value="${esc(t.note)}" data-input="tr-note"></div>
      <p class="err" id="tr-err" role="alert" style="color:#C0413F;font-size:13px;margin:0"></p>
    </form>
    <div class="bottom"><button class="btn btn-primary" type="submit" form="tr-form">مراجعة التحويل</button></div></main>`;
}

function review() {
  const t = T(); const b = beneficiary(t.benId); if (!b || !t.amount) { setTimeout(() => go('transfer')); return '<main class="screen"></main>'; }
  const h = toHalalas(t.amount);
  return `<main class="screen">${hdr('مراجعة التحويل', { back: 'transfer', step: 'الخطوة 2 من 3' })}<div class="gap"></div>
    <div class="total-big"><span>إجمالي التحويل</span><strong><span class="num">${money(h)}</span><span class="cur">ر.س</span></strong></div>
    <div class="rows">
      <div class="r"><span>المستفيدة</span><strong>${esc(b.name)}</strong></div>
      <div class="r"><span>الحساب</span><strong class="num">•••• ${esc(b.iban_last4)}</strong></div>
      <div class="r"><span>المبلغ</span><strong>${sar(h)}</strong></div>
      <div class="r"><span>الرسوم</span><strong>${sar(0)}</strong></div>
    </div>
    <div class="bottom"><button class="btn btn-primary" data-action="tr-confirm">تأكيد التحويل</button><button class="btn btn-text" data-nav="transfer">تعديل البيانات</button></div></main>`;
}

function processing() {
  const t = T(); const b = beneficiary(t.benId);
  return `<main class="screen">${hdr('تنفيذ التحويل', { back: 'review' })}
    <div class="status"><div class="badge wait" style="margin-top:80px"><span class="dots-spin" aria-hidden="true">${Array.from({ length: 8 }, (_, i) => `<i style="transform:rotate(${i * 45}deg) translateY(-15px)"></i>`).join('')}</span></div>
      <h2>جاري تنفيذ التحويل...</h2><p>نتحقق من حالة العملية. لا تغلق التطبيق الآن.</p>
      <div class="card" style="align-self:stretch;margin-top:44px"><div class="big-amt" style="margin:4px 0 6px"><span class="num">${money(toHalalas(t.amount || 0))}</span><span class="cur">ر.س</span></div><p style="font-size:13px">إلى ${esc(b?.name || '')}</p></div>
    </div></main>`;
}

function success() {
  const r = T().result; if (!r) { setTimeout(() => go('home')); return '<main class="screen"></main>'; }
  const tx = r.transaction; const b = beneficiary(tx.beneficiary_id);
  return `<main class="screen"><div class="status" role="status"><div class="badge ok" style="margin-top:70px">${icon.checkBold}</div>
      <h2>تم التحويل بنجاح!</h2><p>تم إرسال المبلغ إلى ${esc(b?.name || '')}</p>
      <div class="big-amt"><span class="num">${money(tx.amount)}</span><span class="cur">ر.س</span></div>
      <div class="rows" style="align-self:stretch;text-align:right"><div class="r"><span>الرقم المرجعي</span><strong class="num">${esc(tx.reference)}</strong></div><div class="r"><span>الحالة</span><strong style="color:var(--green)">مكتمل</strong></div></div>
    </div>
    <div class="bottom"><button class="btn btn-primary" data-action="tr-done">العودة للرئيسية</button></div></main>`;
}

function insufficient() {
  const t = T();
  return `<main class="screen">${hdr('التحويل', { back: 'transfer' })}
    <div class="status"><div class="badge bad">!</div><h2>الرصيد غير كافٍ</h2><p>المبلغ أكبر من رصيدك المتاح.<br>أدخل مبلغًا أقل وحاول مرة ثانية.</p>
      <div class="rows" style="align-self:stretch;margin-top:44px"><div class="r"><span style="color:var(--ink);font-weight:700">المبلغ المدخل</span><strong>${sar(toHalalas(t.amount || 0))}</strong></div><div class="r"><span>الرصيد المتاح</span><span class="muted">${sar(S.data.me.balance)}</span></div></div></div>
    <div class="bottom"><button class="btn btn-primary" data-nav="transfer">تعديل المبلغ</button></div></main>`;
}

function benSheet() {
  return `${sheetHead('إضافة مستفيد')}
  <form data-form="add-ben" novalidate>
    <div class="field"><label for="ben-name">اسم المستفيد</label><input id="ben-name" name="name" class="input" required minlength="2" maxlength="50" autocomplete="off" placeholder="مثال: أحمد محمد"></div>
    <div class="field"><label for="ben-iban">رقم الآيبان (تجريبي)</label><input id="ben-iban" name="iban" class="input ltr-input" required autocomplete="off" placeholder="SA00 0000 0000 0000 0000 0000" maxlength="34" data-input="iban-format"></div>
    <p class="err" id="ben-err" role="alert" style="color:#C0413F;font-size:13px;margin:-10px 0 14px"></p>
    <button class="btn btn-primary" type="submit">حفظ المستفيد</button>
  </form>`;
}

function filterBens(q) {
  const s = q.trim(); let shown = 0;
  document.querySelectorAll('#ben-list [data-name]').forEach((el) => { const m = !s || el.dataset.name.includes(s); el.hidden = !m; if (m) shown++; });
  const e = document.getElementById('ben-none'); if (e) e.hidden = shown > 0;
}

export const screens = {
  beneficiaries: { render: beneficiaries, title: 'المستفيدون', enter: () => { S.ui.benSel = T().benId; } },
  transfer: { render: transfer, title: 'التحويل', enter: (p) => { if (p.ben || p.amount || p.commitment || !S.ui.tr || S.ui.tr.result) reset(p); } },
  review: { render: review, title: 'مراجعة التحويل' },
  processing: { render: processing, title: 'تنفيذ التحويل' },
  success: { render: success, title: 'تم التحويل' },
  insufficient: { render: insufficient, title: 'الرصيد غير كافٍ' },
};
export const sheets = { 'add-ben': benSheet };
export const inputs = {
  'ben-q': (el) => filterBens(el.value),
  'tr-note': (el) => { T().note = el.value; },
  'tr-amount': (el) => { const v = digits(el.value).replace(/[^\d.]/g, ''); if (v !== el.value) el.value = v; T().amount = v; },
  'iban-format': (el) => { el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})/g, '$1 ').trim(); },
};
export const actions = {
  'ben-pick': (el) => { S.ui.benSel = Number(el.dataset.id); render(); },
  'ben-choose': () => { T().benId = S.ui.benSel; go('transfer'); },
  'add-beneficiary': () => openSheet('add-ben'),
  'tr-confirm': () => {
    const t = T(); t.idem = t.idem || uid();
    requireApproval({ step: 'الخطوة 3 من 3', back: 'review', run: async (stepUpToken) => {
      go('processing');
      const started = Date.now();
      try {
        const r = await post('/api/transfers', { beneficiaryId: t.benId, amount: t.amount, note: t.note, idempotencyKey: t.idem, stepUpToken, commitmentId: t.commitmentId });
        await new Promise((res) => setTimeout(res, Math.max(0, 900 - (Date.now() - started))));
        t.result = r; t.idem = null; await refresh(); go('success');
      } catch (e) {
        if (e instanceof ApiError && e.code === 'insufficient_balance') { go('insufficient'); return; }
        go('review'); toast(e.message, { error: true });
      }
    } });
  },
  'tr-done': () => { reset(); go('home'); },
};
export const forms = {
  transfer: (f) => {
    const t = T(); const err = f.querySelector('#tr-err'); err.textContent = '';
    t.amount = digits(f.amount.value).trim(); t.note = f.note.value.trim();
    if (!beneficiary(t.benId)) { err.textContent = 'اختاري مستفيدًا.'; return; }
    if (!/^\d+(\.\d{1,2})?$/.test(t.amount) || toHalalas(t.amount) <= 0) { err.textContent = 'أدخلي مبلغًا صحيحًا.'; f.amount.focus(); return; }
    if (toHalalas(t.amount) > S.data.me.balance) { go('insufficient'); return; }
    if (toHalalas(t.amount) > 5000000) { err.textContent = 'الحد الأقصى للتحويل 50,000.00 ر.س.'; return; }
    t.idem = null; go('review');
  },
  'add-ben': async (f, btn) => {
    const err = f.querySelector('#ben-err'); err.textContent = '';
    const name = f.name.value.trim(); const iban = f.iban.value.replace(/\s/g, '');
    if (name.length < 2) { err.textContent = 'أدخلي اسم المستفيد.'; return; }
    if (!/^SA\d{22}$/.test(iban)) { err.textContent = 'الآيبان يبدأ بـ SA ويتبعه 22 رقمًا.'; return; }
    await busy(btn, async () => {
      try { const r = await post('/api/beneficiaries', { name, bank: 'بنك تجريبي', iban }); await refresh(); S.ui.benSel = r.id; closeSheet(); toast('تمت إضافة المستفيد'); }
      catch (e) { err.textContent = e.message; }
    });
  },
};
