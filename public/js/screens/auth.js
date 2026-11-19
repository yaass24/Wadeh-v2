/* Splash · Welcome · PIN Login (Figma "WADEH / PIN Login").
   Login = 6-digit PIN or Face ID (a real passkey on this device, otherwise a labelled simulation). */
import { S, render, go, refresh } from '../store.js';
import { post } from '../api.js';
import * as WA from '../webauthn.js';
import { esc, icon, toast, bio } from '../ui.js';
import { errText } from './common.js';

const LOGO = '/icons/wadeh-wordmark-t.png';

function splash() {
  return `<main class="splash" aria-label="واضح"><img src="/icons/wadeh-wordmark-white.png" alt="واضح WADEH — بنك رقمي" width="236" height="79"><p>كل شيء أوضح!</p></main>`;
}

function welcome() {
  return `<main class="screen no-tabbar">
    <img class="logo-top" src="${LOGO}" alt="واضح WADEH" width="86" height="27">
    <section class="hero"><h2>مرحبًا بك في واضح</h2><div class="mock-card" aria-hidden="true"><i class="l1"></i><i class="chip"></i><i class="dot"></i><i class="l2"></i><i class="l3"></i></div></section>
    <h1 class="welcome-h">بنكيّة أبسط، وقرارات أوضح</h1>
    <p class="welcome-p">تحكّم بأموالك بسهولة ووضوح، من مكان واحد.</p>
    <div class="bottom" style="gap:18px">
      <button class="btn btn-primary" data-nav="login">ابدأ الآن</button>
      <button class="btn-text btn" style="min-height:30px;font-size:14px;font-weight:700" data-nav="login">لديك حساب؟ تسجيل الدخول</button>
    </div>
  </main>`;
}

function pinScreen() {
  const st = S.ui.pin || (S.ui.pin = { pin: '', err: '', busy: false, shake: false });
  const devicePasskey = S.passkey === 'platform' && WA.deviceCredentialId() && S.session?.hasPasskeys;
  const dots = Array.from({ length: 6 }, (_, i) => `<span class="${i < st.pin.length ? 'on' : ''}"></span>`).join('');
  const key = (d) => `<button type="button" class="key" data-action="pin-key" data-key="${d}" aria-label="${d}" ${st.busy ? 'disabled' : ''}>${d}</button>`;
  return `<main class="pin">
    <div class="top"><button class="out" data-nav="welcome">خروج</button><div class="brand">واضح<small>WADEH</small></div></div>
    <div class="face-tile" aria-hidden="true">${bio.icon}</div>
    <h1>يا هلا ${esc(S.session?.greetingName || 'سارة')}</h1>
    <p class="prompt">الرجاء إدخال رمز المرور</p>
    <div class="pin-dots${st.busy ? ' busy' : ''}${st.shake ? ' shake' : ''}" role="img" aria-label="تم إدخال ${st.pin.length} من 6 أرقام">${dots}</div>
    <div class="msg" role="alert">${st.busy ? '<span>جارٍ التحقق…</span>' : st.err ? `<span class="e">${esc(st.err)}</span>` : ''}</div>
    <button class="forgot" data-action="pin-forgot">نسيت رمز المرور؟</button>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(key).join('')}
      <button type="button" class="key plain" data-action="pin-face" aria-label="الدخول ${bio.with}${devicePasskey ? '' : ' (محاكاة)'}" ${st.busy ? 'disabled' : ''}>${bio.icon}</button>${key(0)}
      <button type="button" class="key" data-action="pin-key" data-key="del" aria-label="حذف آخر رقم" ${st.busy ? 'disabled' : ''}>${icon.del}</button></div>
    <p class="foot">واجهة تجريبية • رمز من 6 أرقام (123456)</p>
  </main>`;
}
async function pinAttempt(fn) {
  const st = S.ui.pin; if (st.busy) return;
  st.busy = true; st.err = ''; st.shake = false; render();
  try { await fn(); S.ui.pin = null; await finishLogin(); }
  catch (e) { st.busy = false; st.pin = ''; st.err = errText(e); st.shake = e?.code === 'wrong_password'; render(); }
}

async function finishLogin() {
  const target = S.ui.afterLogin && !/welcome|login|splash/.test(S.ui.afterLogin) ? S.ui.afterLogin : '#/home';
  S.ui.afterLogin = null; S.session = { ...S.session, authenticated: true };
  await refresh(); go(target);
}

export const screens = {
  splash: { render: splash, title: 'واضح', enter: () => { clearTimeout(S.ui.splashT); S.ui.splashT = setTimeout(() => { if (S.route.name === 'splash') go('welcome'); }, 1400); } },
  welcome: { render: welcome, title: 'مرحبًا' },
  login: { render: pinScreen, title: 'تسجيل الدخول', enter: () => { S.ui.pin = null; } },
};
export const actions = {
  'pin-forgot': () => toast('نموذج تجريبي: رمز المرور هو 123456'),
  'pin-key': (el) => {
    const st = S.ui.pin; if (!st || st.busy) return;
    const k = el.dataset.key;
    if (k === 'del') st.pin = st.pin.slice(0, -1); else if (st.pin.length < 6) st.pin += k;
    st.err = ''; st.shake = false; render();
    if (st.pin.length === 6) { const password = st.pin; pinAttempt(() => post('/api/auth/login', { phone: S.session?.demoPhone, password })); }
  },
  'pin-face': () => {
    const real = S.passkey === 'platform' && WA.deviceCredentialId() && S.session?.hasPasskeys;
    pinAttempt(async () => { if (real) await WA.assert('login'); else { await post('/api/auth/demo-biometric'); toast(`تم الدخول بمحاكاة ${bio.name}`); } });
  },
};
