const CACHE_NAME = 'synapse-note-cache-v1';
const urlsToCache = [
  '/css/style.css',
  '/js/main.js',
  '/favicon.svg',
  '/manifest.json'
  // '/','/dashboard' など動的・認証ページは入れない
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // APIやHTMLページはネットワーク優先にする（またはキャッシュしない）
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request));
    return;
  }
  // 静的ファイルのみキャッシュファースト
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});