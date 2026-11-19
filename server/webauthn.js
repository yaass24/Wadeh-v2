'use strict';
/* Minimal, dependency-free WebAuthn (passkey) verification.
   - Registration: the browser supplies the credential public key via AuthenticatorAttestationResponse.getPublicKey()
     (SubjectPublicKeyInfo DER). We verify clientDataJSON (type, challenge, origin) and authenticatorData (rpIdHash, UP flag).
     Attestation is "none" — we do not verify device make/model, which is normal for consumer passkeys.
   - Authentication: verifies the assertion signature over authenticatorData || SHA-256(clientDataJSON). */
const crypto = require('node:crypto');

const b64u = {
  enc: (buf) => Buffer.from(buf).toString('base64url'),
  dec: (s) => Buffer.from(String(s || ''), 'base64url'),
};
const sha256 = (b) => crypto.createHash('sha256').update(b).digest();

function parseAuthData(buf) {
  if (buf.length < 37) throw new Error('authenticatorData too short');
  return { rpIdHash: buf.subarray(0, 32), flags: buf[32], signCount: buf.readUInt32BE(33), up: !!(buf[32] & 0x01), uv: !!(buf[32] & 0x04) };
}

function checkClientData(clientDataB64, { type, challenge, origin }) {
  let cd;
  try { cd = JSON.parse(b64u.dec(clientDataB64).toString('utf8')); } catch { throw new Error('clientDataJSON invalid'); }
  if (cd.type !== type) throw new Error('wrong ceremony type');
  if (cd.challenge !== challenge) throw new Error('challenge mismatch');
  if (cd.origin !== origin) throw new Error('origin mismatch: ' + cd.origin);
  return cd;
}

function checkAuthData(authDataB64, rpId) {
  const ad = parseAuthData(b64u.dec(authDataB64));
  if (!ad.rpIdHash.equals(sha256(Buffer.from(rpId)))) throw new Error('rpId mismatch');
  if (!ad.up) throw new Error('user presence flag missing');
  return ad;
}

function verifyRegistration({ clientDataJSON, authenticatorData, publicKey, alg }, expected) {
  checkClientData(clientDataJSON, { ...expected, type: 'webauthn.create' });
  const ad = checkAuthData(authenticatorData, expected.rpId);
  if (![-7, -257].includes(Number(alg))) throw new Error('unsupported algorithm');
  const der = b64u.dec(publicKey);
  crypto.createPublicKey({ key: der, format: 'der', type: 'spki' }); // throws if malformed
  return { publicKey: der, alg: Number(alg), signCount: ad.signCount, uv: ad.uv };
}

function verifyAssertion({ clientDataJSON, authenticatorData, signature }, stored, expected) {
  checkClientData(clientDataJSON, { ...expected, type: 'webauthn.get' });
  const ad = checkAuthData(authenticatorData, expected.rpId);
  const data = Buffer.concat([b64u.dec(authenticatorData), sha256(b64u.dec(clientDataJSON))]);
  const key = crypto.createPublicKey({ key: Buffer.from(stored.public_key), format: 'der', type: 'spki' });
  const ok = crypto.verify('sha256', data, key, b64u.dec(signature));
  if (!ok) throw new Error('bad signature');
  // Signature counter check (many platform passkeys always report 0, which is allowed).
  if (ad.signCount !== 0 && stored.sign_count !== 0 && ad.signCount <= stored.sign_count) throw new Error('sign counter regression');
  return { signCount: ad.signCount, uv: ad.uv };
}

module.exports = { verifyRegistration, verifyAssertion, b64u, sha256 };
