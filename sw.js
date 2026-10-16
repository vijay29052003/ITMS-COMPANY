/* ==========================================================================
   ITMS LED MANAGER - SERVICE WORKER (OFFLINE PWA CACHING)
   ========================================================================== */

const CACHE_NAME = 'itms-led-manager-v17';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './app.webmanifest',
  './ctpl-logo.png',
  './css/styles.css',
  './css/fonts/google-fonts.css',
  './css/fonts/0FlCVOGZlE2Rrtr-HmgkMWJNjJ5_RyT8o8c7fHkeg-esVARN5IjvvA.woff2',
  './css/fonts/0FlCVOGZlE2Rrtr-HmgkMWJNjJ5_RyT8o8c7fHkeg-esVARR5Ig.woff2',
  './css/fonts/0FlCVOGZlE2Rrtr-HmgkMWJNjJ5_RyT8o8c7fHkeg-esVARf5IjvvA.woff2',
  './css/fonts/8vIh7xs32H97qzQKnzfeXycxXZyUmySvZWItmf1fe6TVmgoD-l-Y.woff2',
  './css/fonts/8vIh7xs32H97qzQKnzfeXycxXZyUmySvZWItmf1fe6TVmgoD4F-Yo3w.woff2',
  './css/fonts/8vIh7xs32H97qzQKnzfeXycxXZyUmySvZWItmf1fe6TVmgoD9F-Yo3w.woff2',
  './css/fonts/AYCcpXfzfccDCstK_hrjDyADv5e9748vhj3CJBLHIARtqiu71Owo.woff2',
  './css/fonts/AYCcpXfzfccDCstK_hrjDyADv5e9748vhj3CJBLHIARtqjK71A.woff2',
  './css/fonts/AYCcpXfzfccDCstK_hrjDyADv5e9748vhj3CJBLHIARtqjy71Owo.woff2',
  './css/fonts/Cn-fJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvJx2mc4I3mYvNY.woff2',
  './css/fonts/Cn-fJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvJx2mc4MXmY.woff2',
  './css/fonts/Cn-fJsCGWQxOjaGwMQ6fIiMywrNJIky6nvd8BjzVMvJx2mc4P3mYvNY.woff2',
  './css/fonts/LhW4MUPbN-oZdNFcBy1-DJYsEoTq5pu3QfoMC9Y.woff2',
  './css/fonts/LhW4MUPbN-oZdNFcBy1-DJYsEoTq5pu3SvoMC9Y.woff2',
  './css/fonts/LhW4MUPbN-oZdNFcBy1-DJYsEoTq5pu3T_oM.woff2',
  './css/fonts/TuG7UUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHN5DV_.woff2',
  './css/fonts/TuG7UUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHN5TV_9qo.woff2',
  './css/fonts/TuG7UUFzXI5FBtUq5a8bjKYTZjtRU6Sgv3NaV_SNmI0b8QQCQmHN6jV_9qo.woff2',
  './css/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa0ZL7SUc.woff2',
  './css/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7.woff2',
  './css/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1pL7SUc.woff2',
  './css/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa25L7SUc.woff2',
  './css/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2JL7SUc.woff2',
  './css/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2ZL7SUc.woff2',
  './css/fonts/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa2pL7SUc.woff2',
  './css/fonts/ieVp2YdFI3GCY6SyQy1KfStzYKZgzN1z4LKDbeZce-048cFpwEFI.woff2',
  './css/fonts/ieVp2YdFI3GCY6SyQy1KfStzYKZgzN1z4LKDbeZce-048ddpwA.woff2',
  './css/fonts/ieVp2YdFI3GCY6SyQy1KfStzYKZgzN1z4LKDbeZce-048dlpwEFI.woff2',
  './css/fonts/sJov3K5XjsSdcnzn071rL37lpAOsUThnDZIfPdbeSNzVakglNOWE6zDy5A.woff2',
  './css/fonts/sJov3K5XjsSdcnzn071rL37lpAOsUThnDZIfPdbeSNzVakglNOWS6zDy5A.woff2',
  './css/fonts/sJov3K5XjsSdcnzn071rL37lpAOsUThnDZIfPdbeSNzVakglNOWc6zA.woff2',
  './css/fonts/w8gyH3EvQP81sInb43inmyN9zZ7hb7ATbSWo4q8dJ74a3cVrSlYXn2CP.woff2',
  './css/fonts/w8gyH3EvQP81sInb43inmyN9zZ7hb7ATbSWo4q8dJ74a3cVrSlgXnw.woff2',
  './css/fonts/w8gyH3EvQP81sInb43inmyN9zZ7hb7ATbSWo4q8dJ74a3cVrSnsXn2CP.woff2',
  './css/fonts/wlpZgx_HC1ti5ViekvcxnhMlCVo3f5pv17ivlzsUB14gg1TMbQOYEL-C.woff2',
  './css/fonts/wlpZgx_HC1ti5ViekvcxnhMlCVo3f5pv17ivlzsUB14gg1TMbRGYEL-C.woff2',
  './css/fonts/wlpZgx_HC1ti5ViekvcxnhMlCVo3f5pv17ivlzsUB14gg1TMbW2YEA.woff2',
  './css/fonts/wlpZgx_HC1ti5ViekvcxnhMlCVo3f5pv17ivlzsUB14gg1TMbWOYEL-C.woff2',
  './css/fonts/wlpZgx_HC1ti5ViekvcxnhMlCVo3f5pv17ivlzsUB14gg1TMbXaYEL-C.woff2',
  './js/config.js',
  './js/storage-security.js',
  './js/data/language-presets.js',
  './js/data/translit-dictionary.js',
  './js/binarizer-worker.js',
  './js/vendor/jszip.min.js',
  './css/fonts/bootstrap-icons.css',
  './css/fonts/fonts/bootstrap-icons.woff2',
  './css/fonts/fonts/bootstrap-icons.woff',
  './js/vendor/opentype.min.js',
  './js/font-storage.js',
  './js/translit-engine.js',
  './js/led-rasterizer.js',
  './js/led-engine.js',
  './js/route-manager.js',
  './js/export-package.js',
  './js/glyph-manager.js',
  './js/web-serial-flasher.js',
  './js/app.js'
];

// Install Event: Cache critical application assets
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event: Clean up old cache versions
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Serve cached assets offline first, fallback to network
self.addEventListener('fetch', (e) => {
  // Skip non-GET requests or unsupported schemes
  if (e.request.method !== 'GET' || !e.request.url.startsWith('http')) return;

  e.respondWith(
    caches.match(e.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(e.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(e.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Fallback for HTML navigation requests
        if (e.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
