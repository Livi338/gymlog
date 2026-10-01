// Service worker：讓 app 沒網路也打得開。
// 自己網站的檔案：每次先向網路確認新版，失敗才用快取（所以你更新程式後，大家下次開啟就會拿到新版）。
// Firebase SDK 與字型：網址含版本號、不會變，直接用快取。
// Firestore 與登入的網路請求不經過這裡，由 Firebase 自己處理離線。
const CACHE = 'gymlog-v2';
const SHELL = [
  './', './index.html', './style.css', './app.js', './firebase-config.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'
];

self.addEventListener('install', ev => {
  ev.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', ev => {
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin){
    ev.respondWith(
      // cache:'no-cache' = 每次都向 GitHub 確認有沒有新版，不用瀏覽器暫存的舊檔
      fetch(req, { cache: 'no-cache' }).then(res => {
        if (res.ok){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }).catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then(hit => hit || (req.mode === 'navigate' ? caches.match('./index.html') : undefined))
          .then(hit => hit || new Response('離線中', { status: 503 }))
      )
    );
    return;
  }

  const cacheFirst =
    (url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/')) ||
    url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (cacheFirst){
    ev.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok || res.type === 'opaque'){ const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
