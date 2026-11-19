/* Shared UI helpers: escaping, formatting, icons, header, toast, confirm dialog. */

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const attr = esc;

/* ---------- money & dates ---------- */
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
export const money = (h) => nf2.format((Number(h) || 0) / 100);               // 2,450.00
export const moneyShort = (h) => nf0.format((Number(h) || 0) / 100);          // 1,250
export const sar = (h) => `<span class="num">${money(h)}</span> ر.س`;
export const sarShort = (h) => `<span class="num">${moneyShort(h)}</span> ر.س`;
export const sarText = (h) => `${money(h)} ر.س`;
export const toHalalas = (v) => Math.round(Number(String(v).replace(/,/g, '')) * 100);
export const digits = (s) => String(s ?? '').replace(/[٠-٩]/g, (d) => '٠١٢٣٤٥٦٧٨٩'.indexOf(d));

const LOCALE = 'ar-u-ca-gregory-nu-latn';
const dLong = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const dDM = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', timeZone: 'UTC' });
const dtFmt = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Riyadh' });
const parseISO = (iso) => new Date(iso + 'T00:00:00Z');
export const dateLong = (iso) => (iso ? dLong.format(parseISO(iso)) : '—');
export const dayMonth = (iso) => (iso ? dDM.format(parseISO(iso)) : '—');
export const dateOfMs = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date(ms));
export const dateTime = (ms) => (ms ? dtFmt.format(new Date(ms)) : '—');
export const daysBetween = (a, b) => Math.round((parseISO(b) - parseISO(a)) / 864e5);
export const dom = (iso) => Number(String(iso).slice(8, 10));
export function nextDom(today, d) {
  const [y, m, day] = today.split('-').map(Number);
  const last = (yy, mm) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  let t = new Date(Date.UTC(y, m - 1, Math.min(d, last(y, m - 1))));
  if (day > Math.min(d, last(y, m - 1))) t = new Date(Date.UTC(y, m, Math.min(d, last(y, m))));
  return t.toISOString().slice(0, 10);
}
export function addMonthsISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}
export const relTime = (ms) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'الآن';
  if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
  if (s < 86400) return `قبل ${Math.round(s / 3600)} س`;
  if (s < 86400 * 7) return `قبل ${Math.round(s / 86400)} يوم`;
  return dateTime(ms);
};
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);

/* ---------- icons (original line set, 24px grid) ---------- */
const P = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" ${extra}>${d}</svg>`;
export const icon = {
  bell: P('<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>'),
  del: P('<path d="M9 5.5h11v13H9L3.5 12z"/><path d="m12.5 9.5 4 5M16.5 9.5l-4 5"/>'),
  home: P('<path d="M4 10.2 12 4l8 6.2V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z"/>'),
  grid: P('<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>'),
  card: P('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h3"/>'),
  user: P('<circle cx="12" cy="8.5" r="3.8"/><path d="M5 20c1-3.6 3.8-5.2 7-5.2s6 1.6 7 5.2"/>'),
  transfer: P('<path d="M5 8.5h13.5M15.5 5.5l3 3-3 3"/><path d="M19 15.5H5.5M8.5 12.5l-3 3 3 3"/>'),
  bill: P('<path d="M6.5 3.5h11v17l-2-1.3-2 1.3-1.5-1.1-1.5 1.1-2-1.3-2 1.3z"/><path d="M9.5 8.5h5M9.5 12h5"/>'),
  bars: P('<path d="M6 19V11M10 19V6M14 19V9M18 19V13"/>'),
  users: P('<circle cx="9" cy="8.5" r="3.3"/><path d="M3 19c.7-3.2 3.1-4.8 6-4.8s5.3 1.6 6 4.8"/><path d="M15.5 5.6a3.1 3.1 0 0 1 0 5.8M17.5 14.6c1.8.5 3 1.9 3.5 4.4"/>'),
  piggy: P('<path d="M5 11.5a6 5.5 0 0 1 11.3-2.6h1.2l1.6-1.4v3l1.4.8v2.6l-1.6.5a6 5.5 0 0 1-2 2.3V19h-2.4v-1.6H11V19H8.6v-2.1A5.5 5.5 0 0 1 5 11.5Z"/><circle cx="15.2" cy="11" r=".7" fill="currentColor"/>'),
  back: P('<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>', 'stroke-width="2.2"'),
  arrowLeft: P('<path d="M19 12H5M10.5 6.5 5 12l5.5 5.5"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  search: P('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  check: P('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="2.6"'),
  checkBold: P('<path d="M5 12.5 9.8 17 19 6.5"/>', 'stroke-width="3.6"'),
  x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  eye: P('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
  eyeOff: P('<path d="M3 3l18 18"/><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.9 3.7M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.3-1.1"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  more: P('<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>'),
  calendar: P('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h1.5M14.5 14H16M8 17h1.5"/>'),
  snow: P('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/>'),
  lock: P('<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>'),
  finger: P('<path d="M12 11.5v3.2c0 2-.6 3.8-1.6 5.3"/><path d="M8.6 9.9A3.5 3.5 0 0 1 15.5 11v2.5c0 1.8-.3 3.5-.9 5"/><path d="M6.2 16.8c.4-1.2.6-2.4.6-3.7V11a5.2 5.2 0 0 1 9.4-3"/><path d="M18 10.5c.2.6.2 1.2.2 1.8v1.2c0 1.2-.1 2.4-.4 3.5"/><path d="M5 8.2A7.8 7.8 0 0 1 17.6 5"/>'),
  face: P('<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><path d="M9 9.5v1.5M15 9.5v1.5M12 9.5v4h-1M9.2 16a4 4 0 0 0 5.6 0"/>'),
  edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>'),
  trash: P('<path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12.5h9l1-12.5M9.5 7V4.5h5V7"/>'),
  car: P('<path d="M5 16.5V12l1.8-5a2 2 0 0 1 1.9-1.3h6.6a2 2 0 0 1 1.9 1.3L19 12v4.5"/><path d="M3.5 12h17v4.5h-17z"/><circle cx="7.5" cy="16.5" r="1.8"/><circle cx="16.5" cy="16.5" r="1.8"/>'),
  copy: P('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>'),
  refresh: P('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 4.5v4h-4"/>'),
  alert: P('<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.2"/>'),
  info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.8v.2"/>'),
  wallet: P('<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3"/><rect x="4" y="8" width="16.5" height="11.5" rx="2.5"/><path d="M16 13.8h1.5"/>'),
  person: P('<circle cx="12" cy="7" r="2.6"/><path d="M8.5 19.5c0-3 1.2-4.2 3.5-4.2s3.5 1.2 3.5 4.2zM10.3 10.4l-.8 4.9M13.7 10.4l.8 4.9"/>'),
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a6.5 6.5 0 0 0-6.5 6.5c0 4.6 6.5 12.5 6.5 12.5s6.5-7.9 6.5-12.5A6.5 6.5 0 0 0 12 2.5Z" fill="currentColor"/><circle cx="12" cy="9" r="2.4" fill="#fff"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.6 3.5h2.6l1.4 4.1-2 1.4a11 11 0 0 0 6.4 6.4l1.4-2 4.1 1.4v2.6a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2Z" fill="currentColor"/></svg>',
  briefcase: P('<rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M9 7.5V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v1.5M3.5 12.5h17"/>'),
  homeFill: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20h-5v-5H9v5H4z" fill="currentColor"/></svg>',
  prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM19 5v14L9 12z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM5 5v14l10-7z" fill="currentColor"/></svg>',
};

/* ---------- layout helpers ---------- */
/** Figma screen header: back chevron (right side in RTL) + bold title, optional step label / subtitle / tool button. */
export function hdr(title, { back = null, sub = '', step = '', tool = '' } = {}) {
  return `<header class="hdr">${back ? `<button class="back" data-nav="${attr(back)}" aria-label="رجوع">${icon.back}</button>` : ''}<h1>${esc(title)}</h1>${tool}</header>${step ? `<p class="step">${esc(step)}</p>` : ''}${sub ? `<p class="sub">${esc(sub)}</p>` : ''}`;
}
export const infoCard = (label, value, extra = '') => `<div class="info" ${extra}><span class="l">${esc(label)}</span><span class="v">${value}</span></div>`;
export const sheetHead = (title) => `<div class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2><button class="x" data-close aria-label="إغلاق">${icon.x}</button></div>`;

/* ---------- toast ---------- */
export function toast(message, { error = false, ms = 3000 } = {}) {
  const region = document.getElementById('toast-region');
  if (!region) return;
  region.querySelectorAll('.toast').forEach((t) => t.remove());
  const el = document.createElement('div');
  el.className = 'toast' + (error ? ' error' : '');
  el.innerHTML = (error ? icon.alert : icon.check) + `<span>${esc(message)}</span>`;
  region.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, ms);
}

/* ---------- confirm dialog (Figma "Confirm Freeze Modal" style) ---------- */
export function askConfirm(title, { text = '', ok = 'تأكيد', cancel = 'إلغاء', danger = false } = {}) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'confirm-wrap';
    wrap.innerHTML = `<div class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="cd-t"><h3 id="cd-t">${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}<div class="stack"><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-cd="1" data-ok>${esc(ok)}</button><button class="btn btn-outline" data-cd="0">${esc(cancel)}</button></div></div>`;
    const done = (v) => { wrap.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.({ preventScroll: true }); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    wrap.addEventListener('click', (e) => { const b = e.target.closest('[data-cd]'); if (b) { e.stopPropagation(); done(b.dataset.cd === '1'); } else if (e.target === wrap) done(false); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-ok]').focus();
  });
}

export const typeLabel = { installment: 'قسط', bill: 'فاتورة', subscription: 'اشتراك', personal: 'شخصي', savings_group: 'جمعية' };

/* Biometric label: Face ID on iPhone/iPad, fingerprint (Touch ID / Windows Hello / Android) elsewhere. */
const isAppleMobile = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
export const bio = isAppleMobile
  ? { name: 'Face ID', with: 'بـ Face ID', icon: icon.face, kind: 'face' }
  : { name: 'البصمة', with: 'بالبصمة', icon: icon.finger, kind: 'finger' };
