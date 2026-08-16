import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { precacheLibraryPosters, IMAGE_CACHE_NAME } from './precache.js';

const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;

function makeCatalog(entries) {
  const catalog = {};
  let i = 0;
  for (const poster of entries) {
    const key = poster ? `key-${i}` : `sin-poster-${i}`;
    catalog[key] = poster ? { poster } : {};
    i += 1;
  }
  return catalog;
}

function installGlobals({ failOpen = false, rejectUrls = [] } = {}) {
  const fetchCalls = [];
  const putCalls = [];
  const cache = {
    async put(url, response) {
      putCalls.push({ url, response });
    },
  };
  globalThis.fetch = async (url, init) => {
    fetchCalls.push({ url, init });
    if (rejectUrls.includes(url)) throw new TypeError('Sin conexión');
    return new Response(null, { status: 200 });
  };
  globalThis.caches = {
    async open(name) {
      if (failOpen) throw new TypeError('No se pudo abrir la caché');
      assert.equal(name, IMAGE_CACHE_NAME);
      return cache;
    },
  };
  return { fetchCalls, putCalls, cache };
}

afterEach(() => {
  if (originalFetch === undefined) delete globalThis.fetch;
  else globalThis.fetch = originalFetch;
  if (originalCaches === undefined) delete globalThis.caches;
  else globalThis.caches = originalCaches;
});

test('solo las entradas con póster se piden, w342 y w500 para rutas TMDB, URL AniList una vez', async () => {
  const { fetchCalls, putCalls } = installGlobals();
  const data = {
    catalog: makeCatalog([
      '/p1.jpg',
      '/p2.jpg',
      null,
      '',
      'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1.png',
    ]),
  };
  await precacheLibraryPosters(data);
  const urls = fetchCalls.map((c) => c.url).sort();
  assert.deepEqual(urls, [
    'https://image.tmdb.org/t/p/w342/p1.jpg',
    'https://image.tmdb.org/t/p/w342/p2.jpg',
    'https://image.tmdb.org/t/p/w500/p1.jpg',
    'https://image.tmdb.org/t/p/w500/p2.jpg',
    'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1.png',
  ]);
  assert.equal(putCalls.length, 5);
  assert.ok(fetchCalls.every((c) => c.init && c.init.mode === 'no-cors'));
});

test('pósters repetidos se descargan una sola vez', async () => {
  const { fetchCalls } = installGlobals();
  const data = { catalog: makeCatalog(['/p1.jpg', '/p1.jpg', '/p1.jpg']) };
  await precacheLibraryPosters(data);
  assert.equal(fetchCalls.length, 2);
});

test('sizes personalizados se respetan', async () => {
  const { fetchCalls } = installGlobals();
  const data = { catalog: makeCatalog(['/p1.jpg']) };
  await precacheLibraryPosters(data, { sizes: ['w500'] });
  assert.deepEqual(fetchCalls.map((c) => c.url), ['https://image.tmdb.org/t/p/w500/p1.jpg']);
});

test('sin API Cache: se salta sin lanzar y sin pedir nada', async () => {
  delete globalThis.caches;
  const calls = [];
  globalThis.fetch = async () => {
    calls.push(1);
    return new Response(null, { status: 200 });
  };
  const data = { catalog: makeCatalog(['/p1.jpg']) };
  await precacheLibraryPosters(data);
  assert.equal(calls.length, 0);
});

test('sin fetch (offline): se salta sin lanzar', async () => {
  installGlobals();
  delete globalThis.fetch;
  const data = { catalog: makeCatalog(['/p1.jpg']) };
  await precacheLibraryPosters(data);
});

test('fetch falla para algunas URLs: se salta solo esas, el resto se guarda', async () => {
  const { fetchCalls, putCalls } = installGlobals({
    rejectUrls: ['https://image.tmdb.org/t/p/w342/p1.jpg'],
  });
  const data = { catalog: makeCatalog(['/p1.jpg', '/p2.jpg']) };
  await precacheLibraryPosters(data);
  assert.equal(fetchCalls.length, 4);
  assert.equal(putCalls.length, 3);
  assert.ok(!putCalls.some((c) => c.url === 'https://image.tmdb.org/t/p/w342/p1.jpg'));
});

test('caches.open falla: se salta sin lanzar', async () => {
  const { fetchCalls } = installGlobals({ failOpen: true });
  const data = { catalog: makeCatalog(['/p1.jpg']) };
  await precacheLibraryPosters(data);
  assert.equal(fetchCalls.length, 0);
});

test('sin datos o sin catálogo: no hace nada', async () => {
  const { fetchCalls } = installGlobals();
  await precacheLibraryPosters(null);
  await precacheLibraryPosters({});
  await precacheLibraryPosters({ catalog: {} });
  assert.equal(fetchCalls.length, 0);
});
