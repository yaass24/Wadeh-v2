/* Builds the Scriptable (iOS) home-screen widget script for this user's secret, read-only widget link.
   Sizes: small (balance), medium (balance + next commitments), large (+ recent transactions). */
export function widgetScript(dataUrl, appUrl) {
  return `// واضح | WADEH — ويدجت الرصيد (Scriptable)
// رابط قراءة فقط خاص بك. لإلغائه: واضح ← حسابي ← إعدادات الويدجت ← إلغاء الربط.
const DATA_URL = ${JSON.stringify(dataUrl)};
const APP_URL = ${JSON.stringify(appUrl)};

const NAVY = new Color("#173A65"), DEEP = new Color("#0F2F57"), WHITE = Color.white();
const SOFT = new Color("#FFFFFF", 0.72), FAINT = new Color("#FFFFFF", 0.14), GREEN = new Color("#7FE0BF");
const money = (h) => h == null ? "••••••" : (h / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function when(iso, today) {
  const d = Math.round((Date.parse(iso) - Date.parse(today)) / 864e5);
  if (d === 0) return "اليوم"; if (d === 1) return "غدًا"; if (d > 1 && d < 7) return "بعد " + d + " أيام";
  return new Date(iso + "T12:00:00").toLocaleDateString("ar-SA-u-ca-gregory-nu-latn", { day: "numeric", month: "long" });
}
function text(stack, s, size, color = WHITE, bold = false) {
  const t = stack.addText(String(s)); t.font = bold ? Font.boldSystemFont(size) : Font.mediumSystemFont(size);
  t.textColor = color; t.lineLimit = 1; t.minimumScaleFactor = 0.6; return t;
}
function rowRTL(parent, right, left, size = 13, leftColor = SOFT) {
  const r = parent.addStack(); r.layoutHorizontally(); r.centerAlignContent();
  if (left) text(r, left, size - 1, leftColor); r.addSpacer(); text(r, right, size, WHITE, true); return r;
}
function header(w, data) {
  const h = w.addStack(); h.layoutHorizontally(); h.centerAlignContent();
  text(h, "•• " + data.account, 11, SOFT); h.addSpacer(); text(h, "واضح", 15, WHITE, true);
}
function balance(parent, data, big) {
  const l = parent.addStack(); l.layoutHorizontally(); l.addSpacer(); text(l, "الرصيد المتاح", 12, SOFT);
  parent.addSpacer(2);
  const b = parent.addStack(); b.layoutHorizontally(); b.bottomAlignContent(); b.addSpacer();
  text(b, "ر.س ", big ? 14 : 12, SOFT); text(b, money(data.balance), big ? 30 : 24, WHITE, true);
}
function section(parent, title) {
  const s = parent.addStack(); s.layoutHorizontally(); s.addSpacer(); text(s, title, 11, SOFT, true); parent.addSpacer(4);
}

async function build() {
  const w = new ListWidget();
  const g = new LinearGradient(); g.colors = [NAVY, DEEP]; g.locations = [0, 1]; w.backgroundGradient = g;
  w.setPadding(14, 16, 14, 16); w.url = APP_URL;
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  let data;
  try { data = await new Request(DATA_URL).loadJSON(); if (!data || data.error) throw new Error("x"); }
  catch (e) {
    const h = w.addStack(); h.addSpacer(); text(h, "واضح", 15, WHITE, true); w.addSpacer();
    const m = w.addStack(); m.addSpacer(); text(m, "تعذّر التحديث", 14, WHITE, true);
    const n = w.addStack(); n.addSpacer(); text(n, "افتحي واضح وأعيدي ربط الويدجت", 11, SOFT);
    return w;
  }
  const fam = config.widgetFamily || "medium";
  header(w, data); w.addSpacer();
  if (fam === "small") {
    balance(w, data, false);
    w.addSpacer(6);
    const next = data.upcoming[0];
    if (next) { const n = w.addStack(); n.addSpacer(); text(n, next.title + " • " + when(next.date, data.today), 11, GREEN); }
  } else if (fam === "medium") {
    const body = w.addStack(); body.layoutHorizontally();
    const left = body.addStack(); left.layoutVertically();
    data.upcoming.slice(0, 3).forEach((c, i) => { if (i) left.addSpacer(5); rowRTL(left, c.title, when(c.date, data.today), 12, GREEN); });
    body.addSpacer(14);
    const right = body.addStack(); right.layoutVertically(); balance(right, data, false);
  } else {
    balance(w, data, true);
    w.addSpacer(14);
    section(w, "الالتزامات القادمة");
    data.upcoming.slice(0, 3).forEach((c, i) => { if (i) w.addSpacer(6); rowRTL(w, c.title, when(c.date, data.today), 13, GREEN); });
    w.addSpacer(14);
    section(w, "آخر العمليات");
    data.recent.slice(0, 3).forEach((t, i) => { if (i) w.addSpacer(6); rowRTL(w, t.title, (t.direction === "out" ? "−" : "+") + money(t.amount), 13); });
  }
  w.addSpacer();
  const f = w.addStack(); f.layoutHorizontally(); f.addSpacer();
  text(f, data.hidden ? "الرصيد مخفي" : "محدّث " + new Date(data.updatedAt).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "numeric", minute: "2-digit" }), 9, SOFT);
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget); else await widget.presentMedium();
Script.complete();
`;
}
