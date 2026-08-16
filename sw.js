const CACHE_PREFIX = 'tvtime-shell';
const CACHE_VERSION = 'v2';
const CACHE_NAME = `${CACHE_PREFIX}-${CACHE_VERSION}`;

const IMAGE_CACHE_PREFIX = 'tvtime-images';
const IMAGE_CACHE_VERSION = 'v1';
const IMAGE_CACHE_NAME = `${IMAGE_CACHE_PREFIX}-${IMAGE_CACHE_VERSION}`;
const IMAGE_HOSTS = ['image.tmdb.org', 's4.anilist.co'];

function isImageUrl(url) {
  return IMAGE_HOSTS.includes(url.hostname);
}

const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './src/styles.css',
  './src/main.js',
  './src/store.js',
  './src/fs.js',
  './src/model.js',
  './src/sync.js',
  './src/search.js',
  './src/cache.js',
  './src/tmdb.js',
  './src/anilist.js',
  './src/import.js',
  './src/news.js',
  './src/precache.js',
  './src/refresh.js',
  './src/ui/biblioteca.js',
  './src/ui/detalle.js',
  './src/ui/novedades.js',
  './src/ui/buscar.js',
  './src/ui/cola.js',
  './src/ui/ajustes.js',
  './src/ui/importar.js',
  './src/ui/recuperacion.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(
            (key) =>
              (key.startsWith(CACHE_PREFIX) || key.startsWith(IMAGE_CACHE_PREFIX)) &&
              key !== CACHE_NAME &&
              key !== IMAGE_CACHE_NAME
          )
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (isImageUrl(url)) {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) =>
        cache.match(request).then((cached) => {
          const network = fetch(request)
            .then((response) => {
              if (response) {
                const clone = response.clone();
                cache.put(request, clone);
              }
              return response;
            })
            .catch(() => null);
          return cached || network.then((response) => response || Response.error());
        })
      )
    );
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match('./index.html').then((res) => res || caches.match('./'))
      )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
    )
  );
});
