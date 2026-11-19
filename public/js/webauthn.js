/* Passkeys (WebAuthn) — on iPhone this uses Face ID / Touch ID through the platform authenticator.
   A web app cannot call Apple's native Face ID API directly; Safari shows the system passkey sheet instead. */
import { post } from './api.js';

const toBuf = (b64u) => { const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64u.length + 3) % 4)); const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a.buffer; };
const toB64u = (buf) => { const a = new Uint8Array(buf); let s = ''; for (const x of a) s += String.fromCharCode(x); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const LOCAL_KEY = 'wadeh.passkeyId';

export const deviceCredentialId = () => { try { return localStorage.getItem(LOCAL_KEY); } catch { return null; } };
const rememberCredential = (id) => { try { id ? localStorage.setItem(LOCAL_KEY, id) : localStorage.removeItem(LOCAL_KEY); } catch { /* storage unavailable */ } };
export const forgetCredential = (id) => { if (!id || deviceCredentialId() === id) rememberCredential(null); };

let cachedSupport;
/** Returns 'platform' (Face ID / Touch ID / Windows Hello available), 'none' or 'insecure'. */
export async function support() {
  if (cachedSupport) return cachedSupport;
  if (!window.isSecureContext) return (cachedSupport = 'insecure');
  if (!window.PublicKeyCredential || !navigator.credentials) return (cachedSupport = 'none');
  try { cachedSupport = (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()) ? 'platform' : 'none'; } catch { cachedSupport = 'none'; }
  return cachedSupport;
}

export async function register(label) {
  const o = await post('/api/auth/passkey/register/options');
  const cred = await navigator.credentials.create({ publicKey: {
    challenge: toBuf(o.challenge), rp: o.rp, user: { id: toBuf(o.user.id), name: o.user.name, displayName: o.user.displayName },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
    excludeCredentials: o.excludeCredentials.map((id) => ({ type: 'public-key', id: toBuf(id) })), attestation: 'none', timeout: 60000,
  } });
  const r = cred.response;
  if (typeof r.getPublicKey !== 'function' || !r.getPublicKey()) throw new Error('هذا المتصفح لا يدعم استخراج مفتاح المرور. حدّث المتصفح.');
  await post('/api/auth/passkey/register', { challengeId: o.challengeId, id: cred.id, label, clientDataJSON: toB64u(r.clientDataJSON),
    authenticatorData: toB64u(r.getAuthenticatorData()), publicKey: toB64u(r.getPublicKey()), alg: r.getPublicKeyAlgorithm() });
  rememberCredential(cred.id);
  return cred.id;
}

/** purpose: 'login' (creates a session) or 'stepup' (returns a step-up token for a sensitive action). */
export async function assert(purpose) {
  const o = await post('/api/auth/passkey/options', { purpose });
  const preferred = deviceCredentialId();
  const ids = preferred && o.allowCredentials.includes(preferred) ? [preferred] : o.allowCredentials;
  const cred = await navigator.credentials.get({ publicKey: { challenge: toBuf(o.challenge), rpId: o.rpId, timeout: o.timeout, userVerification: 'required', allowCredentials: ids.map((id) => ({ type: 'public-key', id: toBuf(id) })) } });
  const r = cred.response;
  const payload = { challengeId: o.challengeId, id: cred.id, clientDataJSON: toB64u(r.clientDataJSON), authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature) };
  if (purpose === 'login') return post('/api/auth/passkey/login', payload);
  return post('/api/auth/stepup', { method: 'passkey', ...payload });
}

export function friendlyError(e) {
  if (e?.name === 'NotAllowedError') return 'تم إلغاء التحقق أو انتهت مهلته.';
  if (e?.name === 'InvalidStateError') return 'هذا الجهاز مسجّل مسبقًا.';
  if (e?.name === 'SecurityError') return 'التحقق الحيوي يتطلب اتصالًا آمنًا (HTTPS أو localhost).';
  return e?.message || 'تعذّر التحقق.';
}
