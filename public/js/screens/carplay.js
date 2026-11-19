/* CarPlay CONCEPT (Figma "Apple CarPlay — تقويم الالتزامات" board, styled after a real CarPlay dashboard).
   The real path is Apple's Calendar app on CarPlay showing events from the WADEH calendar; nothing here is a CarPlay app. */
import { S, render, commitment } from '../store.js';
import { esc, icon, hdr } from '../ui.js';

const AR_DIGITS = (s) => String(s).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[d]);
function upcoming() {
  return S.data.commitments.filter((c) => c.status === 'active').sort((a, b) => a.due_date.localeCompare(b.due_date));
}
function mapSvg() {
  // Stylised street map (original drawing): light base, block grid, a main avenue and a few POIs.
  const v = []; for (let x = -200; x < 1100; x += 58) v.push(`<path d="M${x} 0 L${x + 260} 560" />`);
  const h = []; for (let y = 30; y < 560; y += 46) h.push(`<path d="M0 ${y} L700 ${y - 40}" />`);
  return `<svg class="map" viewBox="0 0 640 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="640" height="560" fill="#F3F2EE"/>
    <path d="M0 120 C160 60 320 70 640 20 L640 0 L0 0Z" fill="#ECE6D8"/>
    <g stroke="#C9CFD9" stroke-width="5" fill="none" opacity=".9">${v.join('')}</g>
    <g stroke="#C9CFD9" stroke-width="5" fill="none" opacity=".9">${h.join('')}</g>
    <path d="M0 176 L640 170" stroke="#AEB6C3" stroke-width="11"/>
    <path d="M300 560 L345 176 L380 0" stroke="#B9C0CB" stroke-width="22" fill="none"/>
    <path d="M300 560 L345 176" stroke="#D5DAE2" stroke-width="10" fill="none"/>
    <g font-family="system-ui" font-size="12" fill="#6B7A8C"><text x="372" y="300">محطة الدريس</text><text x="250" y="395">محطة أورنج</text><text x="420" y="452">ابن المقرب</text><text x="140" y="520">شارع 35</text></g>
    <g fill="#5B7BD8"><circle cx="360" cy="292" r="9"/><circle cx="330" cy="388" r="9"/><circle cx="280" cy="440" r="9"/></g>
    <circle cx="300" cy="500" r="22" fill="#2E6FD0" opacity=".18"/><path d="M300 482 L312 512 L300 505 L288 512Z" fill="#2E6FD0" stroke="#fff" stroke-width="2"/>
  </svg>`;
}

function carplay(p) {
  const list = upcoming(); const i = Math.min(S.ui.cpIndex || 0, Math.max(0, list.length - 1)); const c = list[i];
  const now = new Date(); const time = AR_DIGITS(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Riyadh' }).format(now).replace(/\s?(am|pm)/i, ''));
  const rt = S.data.me.prefs.reminderTime || '09:00'; const [hh, mm] = rt.split(':').map(Number);
  const end = new Date(Date.UTC(2000, 0, 1, hh, mm + 30)); const fmt = (h, m) => AR_DIGITS(`${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`);
  const slot = `${fmt(hh, mm)}–${fmt(end.getUTCHours(), end.getUTCMinutes())} ${hh < 12 ? 'ص' : 'م'}`;
  const dayName = c ? new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'UTC' }).format(new Date(c.due_date + 'T00:00:00Z')) : '';
  const todayName = new Intl.DateTimeFormat('ar', { weekday: 'long', timeZone: 'Asia/Riyadh' }).format(now);
  return `<main class="screen white cp-page">${hdr('معاينة CarPlay', { back: p.id ? `calendar-preview?id=${p.id}` : 'commitments' })}
    <h2 class="board-t">تذكير الالتزامات في Apple CarPlay</h2>
    <div class="cp-fit" id="cp-fit"><div class="cp-car" id="cp-car" role="img" aria-label="محاكاة شاشة CarPlay${c ? `: ${esc(c.title)}` : ''}">
      <div class="cp-right">
        <div class="cp-panel cp-short"><div><i style="background:#1F2B45">${icon.briefcase}</i>العمل</div><div><i style="background:#11A3A0">${icon.homeFill}</i>المنزل</div></div>
        <div class="cp-panel cp-media"><div style="display:flex;align-items:center;gap:12px;justify-content:flex-end;text-align:right"><div><b>سورة المؤمنون</b><small>القرآن الكريم</small></div><span class="play">${icon.play}</span></div>
          <div style="height:5px;border-radius:5px;background:#3A3F4B;margin:14px 0 4px"><div style="width:55%;height:100%;border-radius:5px;background:#E6E8EE"></div></div>
          <div class="ctl">${icon.prev}<span style="display:inline-flex;gap:5px"><i style="width:6px;height:22px;background:currentColor;border-radius:2px;display:block"></i><i style="width:6px;height:22px;background:currentColor;border-radius:2px;display:block"></i></span>${icon.next}</div></div>
        <button class="cp-panel cp-reminder" data-action="cp-next" aria-label="الالتزام التالي">${c ? `<div class="top"><div style="flex:1;text-align:right"><h4>${esc(c.title)}</h4><p class="slot">${slot}</p></div><div class="date"><small>${esc(dayName)}</small><b>${AR_DIGITS(Number(c.due_date.slice(8)))}</b></div></div>` : '<p>لا توجد التزامات قادمة</p>'}</button>
      </div>
      <div class="cp-map">${mapSvg()}<div class="speed">--<small>km/h</small></div></div>
      <div class="cp-side"><div class="clk">${time}<small>5G</small></div><div class="bat"></div>
        <span class="app" style="background:#fff;color:#2E6FD0">${icon.pin}</span><span class="app" style="background:#fff;color:#F0263A">${icon.play}</span><span class="app" style="background:#34C759;color:#fff">${icon.phone}</span>
        <span class="app cal"><small>${esc(todayName)}</small><b>${AR_DIGITS(Number(S.data.today.slice(8)))}</b></span><span style="margin-top:auto;color:#fff">${icon.grid}</span></div>
    </div></div>
    <div class="cp-cards">
      <div class="card"><h4>العرض الآمن أثناء القيادة</h4><p>يعرض CarPlay تذكير التقويم باختصار؛ من دون مبالغ أو إجراءات تحويل.</p></div>
      <div class="card"><h4>المزامنة مع التقويم</h4><p>بعد السماح بالمزامنة، يظهر موعد الالتزام كتذكير في تقويم الآيفون.</p></div>
      <div class="card"><h4>إنشاء موعد شهري</h4><p>تحددين اسم الالتزام ويوم الاستحقاق وتكراره من داخل واضح.</p></div>
    </div>
    <p class="cp-foot">معاينة تصميمية: التقويم هو مصدر التذكير في CarPlay، وليس خدمة بنكية تعمل أثناء القيادة.</p>
  </main>`;
}
function fit() {
  const box = document.getElementById('cp-fit'); const car = document.getElementById('cp-car'); if (!box || !car) return;
  const s = Math.min(1, box.clientWidth / 1000); car.style.transform = `scale(${s})`; box.style.height = `${560 * s}px`;
}

export const screens = { carplay: { render: carplay, title: 'معاينة CarPlay', wide: true, after: fit, enter: (p) => { const l = upcoming(); const idx = p.id ? l.findIndex((x) => x.id === Number(p.id)) : 0; S.ui.cpIndex = idx < 0 ? 0 : idx; } } };
export const actions = { 'cp-next': () => { const n = upcoming().length; S.ui.cpIndex = ((S.ui.cpIndex || 0) + 1) % Math.max(n, 1); render(); } };
export { commitment };
