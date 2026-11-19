/* App state + module registry. Screens register render functions and action handlers; app.js wires events. */
import { get } from './api.js';

export const S = {
  session: null,          // { authenticated, greetingName, demoBiometric, hasPasskeys }
  data: null,             // /api/bootstrap payload
  route: { name: 'welcome', params: {} },
  sheet: null,            // { name, props, fresh, opener }
  passkey: 'none',        // 'platform' | 'none' | 'insecure'
  ui: {},                 // per-screen transient UI state
};

export const registry = { screens: {}, sheets: {}, actions: {}, forms: {}, inputs: {} };
export function register(mod) {
  for (const k of Object.keys(registry)) Object.assign(registry[k], mod[k] || {});
}

let renderImpl = () => {};
export const setRender = (fn) => { renderImpl = fn; };
export const render = () => renderImpl();

export function go(path) {
  const target = path.startsWith('#') ? path : '#/' + path.replace(/^\//, '');
  if (location.hash === target) render(); else location.hash = target;
}

export function openSheet(name, props = {}) {
  S.sheet = { name, props, fresh: true, opener: document.activeElement };
  render();
}
export function closeSheet() {
  const opener = S.sheet?.opener;
  S.sheet = null;
  render();
  if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
}

export async function refresh() {
  S.data = await get('/api/bootstrap');
  render();
  return S.data;
}

/* Convenience selectors */
export const unreadCount = () => (S.data?.notifications || []).filter((n) => !n.read_at).length;
export const beneficiary = (id) => S.data?.beneficiaries.find((b) => b.id === Number(id));
export const commitment = (id) => S.data?.commitments.find((c) => c.id === Number(id));

/* Run an async action with a busy button (prevents double submission). */
export async function busy(btn, fn) {
  if (btn?.dataset.busy === '1') return;
  let html;
  if (btn) { btn.dataset.busy = '1'; btn.disabled = true; html = btn.innerHTML; btn.innerHTML = '<span class="spinner" aria-hidden="true"></span><span>جارٍ التنفيذ…</span>'; btn.setAttribute('aria-busy', 'true'); }
  try { return await fn(); }
  finally { if (btn && document.contains(btn)) { btn.dataset.busy = '0'; btn.disabled = false; btn.innerHTML = html; btn.removeAttribute('aria-busy'); } }
}
