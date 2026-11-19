/* WADEH | واضح — app bootstrap, hash router, rendering and event delegation (no framework, no build step). */
import { S, registry, register, setRender, render, go, closeSheet, refresh } from './store.js';
import { get, setUnauthenticatedHandler } from './api.js';
import * as WA from './webauthn.js';
import { icon, toast } from './ui.js';
import * as common from './screens/common.js';
import * as auth from './screens/auth.js';
import * as home from './screens/home.js';
import * as services from './screens/services.js';
import * as transfer from './screens/transfer.js';
import * as cards from './screens/cards.js';
import * as commitments from './screens/commitments.js';
import * as bills from './screens/bills.js';
import * as profile from './screens/profile.js';
import * as carplay from './screens/carplay.js';

[common, auth, home, services, transfer, cards, commitments, bills, profile, carplay].forEach(register);
register({ actions: { reload: () => location.reload() } });

const PUBLIC_ROUTES = new Set(['splash', 'welcome', 'login']);
const TABS = [['home', 'الرئيسية', icon.home], ['services', 'الخدمات', icon.grid], ['cards', 'البطاقات', icon.card], ['profile', 'حسابي', icon.user]];

const appEl = document.getElementById('app');
let lastRouteKey = '';

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, qs] = h.split('?');
  return { name: name || '', params: Object.fromEntries(new URLSearchParams(qs || '')) };
}
// On laptops the same nav becomes a sidebar with a few extra shortcuts (.side-only).
const SIDE = [['commitments', 'التزاماتي', icon.calendar], ['bills', 'الفواتير', icon.bill], ['notifications', 'الإشعارات', icon.bell], ['widget', 'ويدجت الرصيد', icon.grid]];
const tabbar = (active, mobileHidden) => {
  const cur = S.route.name;
  return `<nav class="tabbar${mobileHidden ? ' no-mob' : ''}" aria-label="التنقل الرئيسي"><img class="side-brand side-only" src="/icons/wadeh-wordmark-t.png" alt="واضح WADEH" width="120" height="38">${TABS.map(([r, label, ic]) =>
    `<a href="#/${r}" ${r === active ? 'aria-current="page"' : ''}>${ic}<span>${label}</span></a>`).join('')}
    <span class="side-sep side-only" aria-hidden="true"></span>${SIDE.map(([r, label, ic]) => `<a class="side-only" href="#/${r}" ${r === cur ? 'aria-current="page"' : ''}>${ic}<span>${label}</span></a>`).join('')}</nav>`;
};

function doRender() {
  const { name } = S.route;
  const screen = registry.screens[name] || registry.screens.home;
  const routeKey = location.hash;
  const fresh = routeKey !== lastRouteKey;
  const scrollY = window.scrollY;
  const out = screen.render(S.route.params);
  const tab = typeof screen.tab === 'function' ? screen.tab() : screen.tab;
  const showTabs = !!tab && !!S.data;
  const sideNav = !!S.data && !PUBLIC_ROUTES.has(name) && !screen.wide; // laptop sidebar on every signed-in screen
  const sheetFn = S.sheet && registry.sheets[S.sheet.name];
  appEl.innerHTML = `<div class="shell${screen.wide ? ' wide' : ''}${sideNav ? ' nav' : ''}${PUBLIC_ROUTES.has(name) ? ' auth' : ''}">${out.replace('class="screen', `class="screen${fresh ? '' : ' no-anim'}${showTabs ? '' : ' no-tabbar'}`).replace('<main', '<main id="main" tabindex="-1"')}${sideNav ? tabbar(tab, !showTabs) : ''}
    ${sheetFn ? `<div class="sheet-wrap${S.sheet.fresh ? '' : ' no-anim'}" data-backdrop><div class="sheet${S.sheet.fresh ? '' : ' no-anim'}" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="grab" aria-hidden="true"></div>${sheetFn(S.sheet.props || {})}</div></div>` : ''}</div>`;
  document.body.style.overflow = sheetFn ? 'hidden' : '';
  document.title = `واضح | ${screen.title || 'WADEH'}`;
  if (fresh) { lastRouteKey = routeKey; window.scrollTo(0, 0); if (!sheetFn) document.getElementById('main')?.focus({ preventScroll: true }); }
  else window.scrollTo(0, scrollY);
  if (sheetFn && S.sheet.fresh) {
    S.sheet.fresh = false;
    const target = appEl.querySelector('.sheet [autofocus]') || appEl.querySelector('.sheet input, .sheet select, .sheet button:not([data-close])') || appEl.querySelector('.sheet [data-close]');
    target?.focus({ preventScroll: true });
  }
  screen.after?.(S.route.params);
}
setRender(doRender);

async function route() {
  const r = parseHash();
  if (!r.name) return go(S.data ? 'home' : 'splash');
  if (!PUBLIC_ROUTES.has(r.name) && !S.data) { S.ui.afterLogin = location.hash; return go('login'); }
  if (PUBLIC_ROUTES.has(r.name) && S.data) return go('home');
  if (!registry.screens[r.name]) return go(S.data ? 'home' : 'welcome');
  if (S.sheet && S.route.name !== r.name) S.sheet = null;
  S.route = r;
  registry.screens[r.name].enter?.(r.params);
  render();
}

/* ---------- global events ---------- */
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action],[data-nav],[data-close],[data-backdrop]');
  if (!el) return;
  if (el.hasAttribute('data-backdrop')) { if (e.target === el) closeSheet(); return; }
  if (el.hasAttribute('data-close')) { e.preventDefault(); closeSheet(); return; }
  if (el.dataset.nav) { e.preventDefault(); if (S.sheet) S.sheet = null; go(el.dataset.nav); return; }
  const fn = registry.actions[el.dataset.action];
  if (fn) { if (el.tagName === 'A' && !el.getAttribute('href')?.startsWith('webcal:')) e.preventDefault(); fn(el, e); }
  else console.warn('[wadeh] no action handler for', el.dataset.action);
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  registry.forms[f.dataset.form]?.(f, e.submitter);
});
document.addEventListener('input', (e) => { const el = e.target.closest('[data-input]'); if (el) registry.inputs[el.dataset.input]?.(el, e); });
document.addEventListener('change', (e) => { const el = e.target.closest('[data-change]'); if (el) registry.actions[el.dataset.change]?.(el, e); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && S.sheet) { closeSheet(); return; }
  if (S.route.name !== 'login' || e.ctrlKey || e.metaKey || e.altKey) return; // physical keyboard on the PIN pad
  if (/^[0-9]$/.test(e.key)) { e.preventDefault(); registry.actions['pin-key']({ dataset: { key: e.key } }); }
  else if (e.key === 'Backspace') { e.preventDefault(); registry.actions['pin-key']({ dataset: { key: 'del' } }); }
});
window.addEventListener('hashchange', route);
window.addEventListener('resize', () => registry.screens[S.route.name]?.after?.(S.route.params));

setUnauthenticatedHandler(() => {
  if (!S.data) return;
  S.data = null; S.sheet = null;
  toast('انتهت الجلسة لحمايتك. سجّلي الدخول مرة أخرى.', { error: true });
  go('login');
});

/* Refresh data when the app returns to the foreground (e.g. after subscribing to the calendar). */
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.data) refresh().catch(() => {}); });

async function boot() {
  S.passkey = await WA.support();
  try {
    S.session = await get('/api/session');
    if (S.session.authenticated) await refresh().catch(() => { S.data = null; });
  } catch (e) {
    appEl.innerHTML = `<div class="shell"><main class="screen no-tabbar"><div class="status"><div class="badge bad">!</div><h2>تعذّر الاتصال بخادم واضح</h2><p>${e.message}</p></div><div class="bottom"><button class="btn btn-primary" data-action="reload">إعادة المحاولة</button></div></main></div>`;
    return;
  }
  route();
}
boot();

if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
