/* Cards (Figma 13), Confirm Freeze Modal (17), Card Frozen (19), Limits (35), Details (36). */
import { S, go, render, openSheet, closeSheet, refresh, busy } from '../store.js';
import { post, patch } from '../api.js';
import { esc, icon, hdr, infoCard, sarShort, money, digits, toast, askConfirm, sheetHead } from '../ui.js';
import { requireApproval } from './common.js';

const card = () => S.data.cards.find((c) => c.id === S.ui.cardId) || S.data.cards[0];
const netName = (c) => (c.network === 'mada' ? 'مدى' : 'فيزا');
export const cardVisual = (c, { small = false } = {}) => `<div class="bank-card ${c.network === 'visa' ? 'visa' : ''}" role="img" aria-label="بطاقة ${netName(c)} تنتهي بـ ${esc(c.last4)}${c.frozen ? '، مجمّدة' : ''}"${small ? ' style="max-width:280px;margin:4px auto 22px"' : ''}>
  <img class="sym" src="/icons/wadeh-symbol.png" alt="">
  <div class="top"><div class="bname">واضح<small>WADEH</small></div><span class="kind">${netName(c)}</span></div>
  <div class="chip-ic" aria-hidden="true"></div>
  <div class="pan">••••&nbsp;••••&nbsp;••••&nbsp;${esc(c.last4)}</div>
  <div class="bottom-row"><span>${esc(S.data.me.fullName)}<br><span class="num">${esc(c.expiry)}</span></span><span class="net ${c.network === 'visa' ? 'visa' : ''}">${c.network === 'mada' ? 'mada' : 'VISA'}</span></div>
  ${c.frozen ? `<div class="frozen">${icon.snow}<span>البطاقة مجمّدة</span></div>` : ''}
</div>`;

function cards() {
  const c = card();
  const all = S.data.cards;
  return `<main class="screen">${hdr('بطاقاتي', { back: 'home' })}<div class="gap" style="height:24px"></div>
    ${all.length > 1 ? `<div class="card-switch" role="group" aria-label="اختيار البطاقة">${all.map((x) => `<button data-action="card-pick" data-id="${x.id}" aria-pressed="${x.id === c.id}">${netName(x)} •••• ${esc(x.last4)}</button>`).join('')}</div>` : ''}
    ${cardVisual(c)}
    <h2 class="section-t" style="margin-top:40px">إعدادات البطاقة</h2>
    <div class="stack">
      <button class="item" data-action="card-freeze"><span class="t">${c.frozen ? 'إلغاء تجميد البطاقة' : 'تجميد البطاقة'}</span><span class="m">التحكم المؤقت باستخدام البطاقة</span></button>
      <button class="item" data-nav="card-limits"><span class="t">حدود الإنفاق</span><span class="m">عرض وتعديل الحدود</span></button>
      <button class="item" data-nav="card-details"><span class="t">تفاصيل البطاقة</span><span class="m">عرض معلومات البطاقة بشكل آمن</span></button>
      <button class="item" data-action="card-wallet"><span class="t">Apple Pay</span><span class="m">عرض توضيحي للإضافة إلى المحفظة</span></button>
    </div>
  </main>`;
}

function frozen() {
  return `<main class="screen">${hdr('بطاقاتي', { back: 'cards' })}
    <div class="status"><div class="badge ok" style="margin-top:90px">${icon.checkBold}</div><h2>تم تجميد البطاقة</h2><p>يمكنك إلغاء التجميد من إعدادات البطاقة.</p></div>
    <div class="bottom"><button class="btn btn-primary" data-nav="cards">العودة لبطاقاتي</button></div></main>`;
}

function limits() {
  const c = card();
  return `<main class="screen">${hdr('حدود الإنفاق', { back: 'cards', sub: 'تحكمي في حدود استخدام بطاقتك' })}<div class="gap" style="height:30px"></div>
    <div class="stack">
      <button class="info" data-action="limit-edit" aria-label="تعديل الحد اليومي"><span class="l">الحد اليومي</span><span class="v">${sarShort(c.limitDaily)}</span></button>
      ${infoCard('المتبقي اليوم', sarShort(Math.max(0, c.limitDaily - c.spentToday)))}
    </div>
    <p class="note-line" style="margin-top:44px">إدارة الحدود تتطلب التأكيد الأمني عند التغيير.</p>
    <div class="bottom"><button class="btn btn-primary" data-nav="cards">العودة لبطاقاتي</button></div></main>`;
}

function details() {
  const c = card(); const s = S.ui.cardSecret;
  return `<main class="screen">${hdr('تفاصيل البطاقة', { back: 'cards', sub: 'لخصوصيتك تظهر معلومات البطاقة بشكل مخفي' })}<div class="gap" style="height:30px"></div>
    <div class="stack">
      ${infoCard('رقم البطاقة', s ? `<span class="secret">${esc(s.number)}</span>` : `<span class="num">•••• •••• •••• ${esc(c.last4)}</span>`)}
      ${infoCard('اسم حامل البطاقة', 'SARA AHMED')}
      ${infoCard('تاريخ الانتهاء', s ? `<span class="secret">${esc(s.expiry)}</span>${s ? `&nbsp;&nbsp;<span style="font-size:13px;color:var(--muted)">CVV</span> <span class="secret">${esc(s.cvv)}</span>` : ''}` : '<span class="num">•• / ••</span>')}
    </div>
    ${s ? '<p class="note-line" style="margin-top:18px">تُخفى البيانات تلقائيًا بعد 30 ثانية.</p>' : ''}
    <div class="bottom">${s ? '' : '<button class="btn btn-secondary" data-action="card-reveal">إظهار البيانات</button>'}<button class="btn btn-primary" data-nav="cards">العودة لبطاقاتي</button></div></main>`;
}

function limitSheet() {
  const c = card();
  return `${sheetHead('تعديل الحد اليومي')}
  <form data-form="limit" novalidate>
    <div class="field"><label for="lim-v">الحد اليومي (ر.س)</label><input id="lim-v" name="v" class="input ltr-input" inputmode="numeric" value="${money(c.limitDaily).replace(/,|\.00/g, '')}" autofocus></div>
    <p class="err" id="lim-err" role="alert" style="color:#C0413F;font-size:13px;margin:-10px 0 14px"></p>
    <button class="btn btn-primary" type="submit">متابعة</button>
  </form>`;
}

const walletSheet = () => `${sheetHead('Apple Pay')}
  ${cardVisual(card(), { small: true })}
  <p class="warn">عرض توضيحي — الإضافة الفعلية إلى المحفظة تتطلب جهة مُصدِرة معتمدة من Apple وتطبيق iOS أصلي.</p>
  <div style="height:16px"></div><button class="btn btn-secondary" data-close>حسنًا</button>`;

let secretTimer;
export const screens = {
  cards: { render: cards, title: 'البطاقات', tab: 'cards' },
  'card-frozen': { render: frozen, title: 'تم تجميد البطاقة' },
  'card-limits': { render: limits, title: 'حدود الإنفاق' },
  'card-details': { render: details, title: 'تفاصيل البطاقة', enter: () => { if (!S.ui.cardSecretKeep) S.ui.cardSecret = null; S.ui.cardSecretKeep = false; } },
};
export const sheets = { 'card-limit': limitSheet, 'card-wallet': walletSheet };
export const actions = {
  'card-freeze': async (el) => {
    const c = card();
    if (!c.frozen) {
      if (!(await askConfirm('تجميد البطاقة؟', { text: 'راح تتوقف عمليات الدفع مؤقتًا حتى تلغين التجميد.', ok: 'تأكيد التجميد', cancel: 'إلغاء' }))) return;
      await busy(el, async () => { try { await post(`/api/cards/${c.id}/freeze`, { frozen: true }); await refresh(); go('card-frozen'); } catch (e) { toast(e.message, { error: true }); } });
    } else {
      await busy(el, async () => { try { await post(`/api/cards/${c.id}/freeze`, { frozen: false }); await refresh(); toast('تم إلغاء تجميد البطاقة'); } catch (e) { toast(e.message, { error: true }); } });
    }
  },
  'card-reveal': () => {
    const c = card();
    requireApproval({ back: 'card-details', run: async (stepUpToken) => {
      S.ui.cardSecret = await post(`/api/cards/${c.id}/reveal`, { stepUpToken }); S.ui.cardSecretKeep = true; go('card-details');
      clearTimeout(secretTimer); secretTimer = setTimeout(() => { S.ui.cardSecret = null; if (S.route.name === 'card-details') { S.ui.cardSecretKeep = false; refresh(); } }, 30000);
    } });
  },
  'card-pick': (el) => { S.ui.cardId = Number(el.dataset.id); render(); },
  'limit-edit': () => openSheet('card-limit'),
  'card-wallet': () => openSheet('card-wallet'),
};
export const forms = {
  limit: (f) => {
    const v = digits(f.v.value).replace(/,/g, '').trim(); const err = f.querySelector('#lim-err');
    if (!/^\d+$/.test(v) || Number(v) < 100 || Number(v) > 20000) { err.textContent = 'أدخلي حدًا بين 100 و 20,000 ر.س.'; return; }
    const c = card(); closeSheet();
    requireApproval({ back: 'card-limits', run: async () => {
      await patch(`/api/cards/${c.id}/limits`, { limitDaily: Number(v), limitOnline: Math.min(Number(v), c.limitOnline / 100) });
      await refresh(); go('card-limits'); toast('تم تحديث الحد اليومي');
    } });
  },
};
