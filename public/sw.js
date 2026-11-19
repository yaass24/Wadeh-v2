/* WADEH service worker — caches the app shell only. API responses, calendar feeds and .ics files are never cached
   (financial data must always come fresh from the server). */
const VERSION = 'wadeh-v3.4.0';
const SHELL = [
  '/', '/index.html', '/styles.css', '/manifest.webmanifest',
  '/js/app.js', '/js/api.js', '/js/store.js', '/js/ui.js', '/js/webauthn.js', '/js/widget-script.js',
  '/js/screens/common.js', '/js/screens/auth.js', '/js/screens/home.js', '/js/screens/transfer.js', '/js/screens/cards.js',
  '/js/screens/commitments.js', '/js/screens/bills.js', '/js/screens/services.js', '/js/screens/profile.js', '/js/screens/carplay.js',
  '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/icons/wadeh-symbol.png', '/icons/wadeh-wordmark-t.png', '/icons/wadeh-wordmark-white.png',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/') || url.pathname.startsWith('/ics/')) return; // network only
  // Network-first for the shell so updates arrive immediately; fall back to cache offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((m) => m || (e.request.mode === 'navigate' ? caches.match('/index.html') : Response.error()))));
});
