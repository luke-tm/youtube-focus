// YouTube Focus v3 — Service Worker
// Version change forces cache refresh
const CACHE_NAME = 'yt-focus-v3';
const SHELL = ['./', './index.html', './config.js', './auth.js', './api.js', './app.js', './styles.css', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  // Delete ALL old caches (v1, v2, etc)
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never cache API or auth calls
  if (url.hostname === 'www.googleapis.com' || url.hostname === 'accounts.google.com' || url.hostname === 'oauth2.googleapis.com') return;
  // For app shell files, use network-first strategy to pick up updates
  e.respondWith(
    fetch(e.request).then(resp => {
      if (resp.ok) {
        const clone = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
      }
      return resp;
    }).catch(() => caches.match(e.request))
  );
});
