/* Thin API client. All mutating calls send the X-WADEH header (CSRF defence together with SameSite=Strict cookies). */
export class ApiError extends Error {
  constructor(status, body) { super(body?.message || 'تعذّر الاتصال بالخادم.'); this.status = status; this.code = body?.error || 'network'; this.body = body || {}; }
}
let onUnauthenticated = () => {};
export const setUnauthenticatedHandler = (fn) => { onUnauthenticated = fn; };

export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(url, {
      method, credentials: 'same-origin', cache: 'no-store',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-WADEH': '1' },
      body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, { error: 'offline', message: navigator.onLine === false ? 'أنت غير متصل بالإنترنت. تحقق من الاتصال ثم حاول مجددًا.' : 'تعذّر الوصول إلى خادم واضح. تأكد من تشغيله (node server.js).' });
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new ApiError(res.status, data);
    if (res.status === 401 && err.code === 'unauthenticated') onUnauthenticated();
    throw err;
  }
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b = {}) => api('POST', u, b);
export const patch = (u, b = {}) => api('PATCH', u, b);
export const del = (u) => api('DELETE', u, {});
