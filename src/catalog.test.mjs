import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchByKey } from './catalog.js';

const NOW = '2026-08-15T12:00:00Z';

function tmdbMovie(id, { name, year = 2021, poster = null } = {}) {
  return {
    id: `tmdb:movie:${id}`,
    type: 'movie',
    isAnime: false,
    names: { es: name ?? null, en: name ?? null, romaji: null, native: null },
    synopsis: 'sinopsis',
    poster,
    backdrop: null,
    releaseDate: `${year}-01-01`,
    status: 'ended',
    genres: [],
    voteAverage: null,
    fetchedAt: NOW,
  };
}

function tmdbSeries(id, { name, year = 2012, seasons = [] } = {}) {
  return {
    id: `tmdb:tv:${id}`,
    type: 'series',
    isAnime: false,
    names: { es: name ?? null, en: name ?? null, romaji: null, native: null },
    synopsis: 'sinopsis',
    poster: null,
    backdrop: null,
    releaseDate: `${year}-01-01`,
    status: 'ended',
    genres: [],
    voteAverage: null,
    seasons,
    fetchedAt: NOW,
  };
}

function anilistEntry(id, { name }) {
  return {
    anilistId: id,
    type: 'series',
    isAnime: true,
    names: { es: null, en: name ?? null, romaji: name ?? null, native: null },
    synopsis: 'sinopsis',
    poster: null,
    backdrop: null,
    releaseDate: '2021-01-01',
    status: 'ended',
    genres: [],
    voteAverage: null,
    seasons: [],
    fetchedAt: NOW,
  };
}

function makeFetchers({ details = [] } = {}) {
  const byKey = new Map(details.map((entry) => [entry.id || `anilist:${entry.anilistId}`, entry]));
  const codes = new Map();
  const calls = [];
  return {
    calls,
    failOn(key, code = 'NOT_FOUND') {
      codes.set(key, code);
    },
    tmdb: {
      async getSeries(id) {
        calls.push(`getSeries:${id}`);
        const key = `tmdb:tv:${id}`;
        if (codes.has(key)) throw Object.assign(new Error(`no series ${id}`), { code: codes.get(key) });
        const entry = byKey.get(key);
        if (!entry) throw Object.assign(new Error(`no series ${id}`), { code: 'NOT_FOUND' });
        return entry;
      },
      async getMovie(id) {
        calls.push(`getMovie:${id}`);
        const key = `tmdb:movie:${id}`;
        if (codes.has(key)) throw Object.assign(new Error(`no movie ${id}`), { code: codes.get(key) });
        const entry = byKey.get(key);
        if (!entry) throw Object.assign(new Error(`no movie ${id}`), { code: 'NOT_FOUND' });
        return entry;
      },
    },
    anilist: {
      async getById(id) {
        calls.push(`getById:${id}`);
        const key = `anilist:${id}`;
        if (codes.has(key)) throw Object.assign(new Error(`no anilist ${id}`), { code: codes.get(key) });
        const entry = byKey.get(key);
        if (!entry) throw Object.assign(new Error(`no anilist ${id}`), { code: 'API' });
        return entry;
      },
    },
  };
}

test('despacha tmdb:tv: → getSeries y devuelve la entrada completa', async () => {
  const fetchers = makeFetchers({ details: [tmdbSeries(30, { name: 'Half Show' })] });
  const entry = await fetchByKey('tmdb:tv:30', { tmdb: fetchers.tmdb, anilist: fetchers.anilist });
  assert.deepEqual(entry, tmdbSeries(30, { name: 'Half Show' }));
  assert.deepEqual(fetchers.calls, ['getSeries:30']);
});

test('despacha tmdb:movie: → getMovie y devuelve la entrada completa', async () => {
  const fetchers = makeFetchers({ details: [tmdbMovie(3, { name: 'Encanto', year: 2021, poster: '/x.jpg' })] });
  const entry = await fetchByKey('tmdb:movie:3', { tmdb: fetchers.tmdb, anilist: fetchers.anilist });
  assert.deepEqual(entry, tmdbMovie(3, { name: 'Encanto', year: 2021, poster: '/x.jpg' }));
  assert.deepEqual(fetchers.calls, ['getMovie:3']);
});

test('despacha anilist: → getById y devuelve la entrada completa', async () => {
  const fetchers = makeFetchers({ details: [anilistEntry(19986, { name: 'Sen' })] });
  const entry = await fetchByKey('anilist:19986', { tmdb: fetchers.tmdb, anilist: fetchers.anilist });
  assert.deepEqual(entry, { ...anilistEntry(19986, { name: 'Sen' }), id: 'anilist:19986' });
  assert.deepEqual(fetchers.calls, ['getById:19986']);
});

test('clave desconocida o ausente → null', async () => {
  const fetchers = makeFetchers({ details: [] });
  const deps = { tmdb: fetchers.tmdb, anilist: fetchers.anilist };
  assert.equal(await fetchByKey('raro:1', deps), null);
  assert.equal(await fetchByKey(null, deps), null);
  assert.equal(await fetchByKey('', deps), null);
  assert.deepEqual(fetchers.calls, []);
});

test('error de dominio (NOT_FOUND/API) → null sin marcar ctx.down', async () => {
  const fetchers = makeFetchers({ details: [] });
  const ctx = { down: false };
  const deps = { tmdb: fetchers.tmdb, anilist: fetchers.anilist, ctx };
  assert.equal(await fetchByKey('tmdb:movie:3', deps), null);
  assert.equal(await fetchByKey('anilist:5', deps), null);
  assert.equal(ctx.down, false);
});

test('error de red (TIMEOUT/NETWORK) → null y marca ctx.down; sin ctx no lanza', async () => {
  const fetchers = makeFetchers({ details: [] });
  const ctx = { down: false };
  const deps = { tmdb: fetchers.tmdb, anilist: fetchers.anilist, ctx };
  fetchers.failOn('tmdb:tv:9', 'TIMEOUT');
  assert.equal(await fetchByKey('tmdb:tv:9', deps), null);
  assert.equal(ctx.down, true);
  const ctx2 = { down: false };
  fetchers.failOn('anilist:5', 'NETWORK');
  assert.equal(await fetchByKey('anilist:5', { ...deps, ctx: ctx2 }), null);
  assert.equal(ctx2.down, true);
  fetchers.failOn('tmdb:movie:4', 'NETWORK');
  assert.equal(await fetchByKey('tmdb:movie:4', { tmdb: fetchers.tmdb, anilist: fetchers.anilist }), null);
});

test('entrada solo-AniList recibe id canónico y las ya canónicas se respetan', async () => {
  const fetchers = makeFetchers({
    details: [anilistEntry(19986, { name: 'Sen' }), tmdbSeries(30, { name: 'Half Show' })],
  });
  const anime = await fetchByKey('anilist:19986', { tmdb: fetchers.tmdb, anilist: fetchers.anilist });
  assert.equal(anime.id, 'anilist:19986');
  assert.equal(anime.anilistId, 19986);
  const series = await fetchByKey('tmdb:tv:30', { tmdb: fetchers.tmdb, anilist: fetchers.anilist });
  assert.equal(series.id, 'tmdb:tv:30');
  assert.equal(series.anilistId, undefined);
});

test('sin deps.tmdb/anilist usa los módulos reales y traga el NO_KEY sin lanzar', async () => {
  assert.equal(await fetchByKey('tmdb:movie:999', { tmdbApiKey: undefined }), null);
});