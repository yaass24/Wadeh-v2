/* Services (Figma 05), Expenses (14), Smart Pockets / ميزانيتي (33) and Edit Pocket (34). */
import { S, go, refresh, busy } from '../store.js';
import { patch } from '../api.js';
import { esc, icon, hdr, sarShort, moneyShort, money, toHalalas, digits, toast, dateOfMs } from '../ui.js';

const monthKey = () => S.data.today.slice(0, 7);
const thisMonthSpend = () => S.data.transactions.filter((t) => t.direction === 'out' && dateOfMs(t.created_at).slice(0, 7) === monthKey() && !['تحويلات', 'التزامات'].includes(t.category));

function services() {
  const tile = (nav, ic, label) => `<button class="tile" data-nav="${nav}">${ic}${label}</button>`;
  return `<main class="screen">${hdr('الخدمات البنكية', { back: 'home' })}<div class="gap" style="height:36px"></div>
    <nav class="tiles" aria-label="الخدمات">
      ${tile('transfer', icon.transfer, 'التحويلات')}${tile('beneficiaries', icon.users, 'المستفيدون')}
      ${tile('bills', icon.bill, 'الفواتير')}${tile('cards', icon.card, 'البطاقات')}
      ${tile('commitments?type=savings_group', icon.piggy, 'الادخار')}${tile('expenses', icon.bars, 'المصروفات')}
    </nav>
    <div class="stack" style="margin-top:44px">
      <button class="item" data-nav="commitments"><span class="t">التزاماتي الشهرية</span><span class="m">تذكيرات متكررة ومزامنة التقويم</span></button>
      <button class="item" data-nav="budget"><span class="t">ميزانيتي</span><span class="m">توزيع المصروفات حسب فئاتك</span></button>
    </div>
  </main>`;
}

const BUCKETS = [['مطاعم ومقاهي', '#2E5FA8'], ['تسوّق', '#6F95CC'], ['مواصلات', '#18A47B'], ['أخرى', '#A9B8CC']];
function expenses() {
  const list = thisMonthSpend(); const total = list.reduce((a, t) => a + t.amount, 0);
  const sums = Object.fromEntries(BUCKETS.map(([b]) => [b, 0]));
  for (const t of list) { const cat = t.category === 'تسوق' ? 'تسوّق' : t.category; sums[sums[cat] !== undefined ? cat : 'أخرى'] += t.amount; }
  return `<main class="screen">${hdr('المصروفات', { back: 'services' })}<div class="gap" style="height:18px"></div>
    <button class="pill-btn block" data-nav="budget">عرض ميزانيتي <span aria-hidden="true">←</span></button>
    <section class="spend"><span>إجمالي الإنفاق هذا الشهر</span><strong><span class="num">${moneyShort(total)}</span> ر.س</strong></section>
    <h2 class="section-t" style="margin-top:4px">توزيع المصروفات</h2>
    ${BUCKETS.map(([b, color]) => { const pct = total ? Math.round((sums[b] / total) * 100) : 0; return `<div class="bar-row"><div class="h"><b>${b}</b><span class="num">${pct}%</span></div><div class="bar" role="img" aria-label="${b} ${pct}%"><i style="width:${pct}%;background:${color}"></i></div></div>`; }).join('')}
  </main>`;
}

function spentFor(item) { return thisMonthSpend().filter((t) => item.cats.includes(t.category)).reduce((a, t) => a + t.amount, 0); }
function budget() {
  const b = S.data.me.prefs.budget;
  return `<main class="screen">${hdr('ميزانيتي', { back: 'services', sub: 'توزيع شهري يساعدك على متابعة إنفاقك' })}<div class="gap" style="height:20px"></div>
    <div class="info"><span class="l">الميزانية الشهرية</span><span class="v"><span class="num">${money(b.total)}</span> ر.س</span></div>
    <div class="stack" style="margin-top:18px">${b.items.map((it) => { const left = it.amount - spentFor(it); return `<div class="item"><span class="t">${esc(it.name)} • ${sarShort(it.amount)}</span><span class="m">${left >= 0 ? `المتبقي ${sarShort(left)}` : `تجاوزتِ بـ ${sarShort(-left)}`}</span></div>`; }).join('')}</div>
    <div class="bottom"><button class="btn btn-primary" data-nav="budget-edit">تعديل توزيع الميزانية</button></div>
  </main>`;
}

function budgetEdit() {
  const b = S.data.me.prefs.budget;
  return `<main class="screen">${hdr('تعديل الميزانية', { back: 'budget', sub: 'اختاري توزيع المبالغ للأقسام' })}<div class="gap" style="height:20px"></div>
    <form data-form="budget" novalidate id="budget-form">
      <div class="stack">${b.items.map((it) => `<label class="info" for="bd-${it.key}"><span class="l">فئة ${esc(it.name)}</span><span class="v" style="display:flex;align-items:baseline;gap:6px"><input id="bd-${it.key}" name="${it.key}" inputmode="decimal" value="${moneyShort(it.amount).replace(/,/g, '')}" style="border:0;outline:0;background:none;font:inherit;color:inherit;width:6ch;direction:ltr;text-align:right;padding:0" aria-label="مبلغ ${esc(it.name)}"> ر.س</span></label>`).join('')}</div>
      <p class="note-line" style="margin-top:40px">هذه تخصيصات للميزانية وليست أرصدة حسابات منفصلة.</p>
      <p class="err" id="bd-err" role="alert" style="color:#C0413F;font-size:13px"></p>
    </form>
    <div class="bottom"><button class="btn btn-primary" type="submit" form="budget-form">حفظ التوزيع</button></div>
  </main>`;
}

export const screens = {
  services: { render: services, title: 'الخدمات', tab: 'services' },
  expenses: { render: expenses, title: 'المصروفات', tab: 'services' },
  budget: { render: budget, title: 'ميزانيتي', tab: () => null },
  'budget-edit': { render: budgetEdit, title: 'تعديل الميزانية', tab: () => null },
};
export const forms = {
  budget: async (f, btn) => {
    const err = f.querySelector('#bd-err'); err.textContent = '';
    const items = S.data.me.prefs.budget.items.map((it) => ({ key: it.key, amount: digits(f.elements[it.key].value).trim() }));
    if (items.some((x) => !/^\d+(\.\d{1,2})?$/.test(x.amount))) { err.textContent = 'أدخلي مبالغ صحيحة.'; return; }
    await busy(btn, async () => {
      try { await patch('/api/prefs', { budget: { items: items.map((x) => ({ key: x.key, amount: toHalalas(x.amount) ? x.amount : 0 })) } }); await refresh(); go('budget'); toast('تم حفظ التوزيع'); }
      catch (e) { err.textContent = e.message; }
    });
  },
};
