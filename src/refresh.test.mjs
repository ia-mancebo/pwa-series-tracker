import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from './model.js';
import { refreshLibrary, refreshOne, refreshAll } from './refresh.js';

const NOW = new Date('2026-08-15T12:00:00Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const iso = (msAgo) => new Date(NOW.getTime() - msAgo).toISOString();

function series(id, { status = 'returning', fetchedAt, anilistId = null, names = {} } = {}) {
  const key = `tmdb:tv:${id}`;
  const entry = {
    id: key,
    type: 'series',
    isAnime: false,
    names: { es: `Serie ${id}`, en: `Series ${id}`, romaji: null, native: null, ...names },
    synopsis: 'sinopsis antigua',
    poster: '/old.jpg',
    backdrop: null,
    releaseDate: '2020-01-01',
    status,
    genres: ['Drama'],
    voteAverage: 7,
    seasons: [{ n: 1, episodes: [{ n: 1, name: 'Pilot', airDate: '2020-01-01', runtime: 22 }] }],
    fetchedAt: fetchedAt || iso(48 * HOUR),
  };
  if (anilistId != null) entry.anilistId = anilistId;
  return entry;
}

function movie(id, { status = 'returning', fetchedAt } = {}) {
  return {
    id: `tmdb:movie:${id}`,
    type: 'movie',
    isAnime: false,
    names: { es: `Película ${id}`, en: `Movie ${id}`, romaji: null, native: null },
    synopsis: 'sinopsis antigua',
    poster: '/old.jpg',
    backdrop: null,
    releaseDate: '2020-01-01',
    status,
    genres: ['Drama'],
    voteAverage: 7,
    fetchedAt: fetchedAt || iso(48 * HOUR),
  };
}

function anilistEntry(id, { type = 'series', status = 'returning', fetchedAt } = {}) {
  return {
    id: `anilist:${id}`,
    anilistId: id,
    type,
    isAnime: true,
    names: { es: null, en: `Anime ${id}`, romaji: `Romaji ${id}`, native: `原生${id}` },
    synopsis: 'sinopsis antigua',
    poster: null,
    backdrop: null,
    releaseDate: '2020-01-01',
    status,
    genres: ['Drama'],
    voteAverage: 7,
    seasons: type === 'series' ? [{ n: 1, episodes: [{ n: 1, name: null, airDate: '2020-01-01', runtime: null }] }] : [],
    fetchedAt: fetchedAt || iso(48 * HOUR),
  };
}

function makeFakes({ series = {}, movies = {}, anilist = {}, failSeries = [], failMovies = [], failBatch = false } = {}) {
  const tmdb = {
    calls: [],
    async getSeries(id, apiKey) {
      tmdb.calls.push(['getSeries', id, apiKey]);
      if (!apiKey) throw Object.assign(new Error('Sin clave de TMDB: añádela en Ajustes.'), { code: 'NO_KEY' });
      if (failSeries.includes(Number(id))) throw Object.assign(new Error(`Sin conexión (${id})`), { code: 'NETWORK' });
      const entry = series[id];
      if (!entry) throw Object.assign(new Error(`No existe ${id}`), { code: 'NOT_FOUND' });
      return structuredClone(entry);
    },
    async getMovie(id, apiKey) {
      tmdb.calls.push(['getMovie', id, apiKey]);
      if (!apiKey) throw Object.assign(new Error('Sin clave de TMDB: añádela en Ajustes.'), { code: 'NO_KEY' });
      if (failMovies.includes(Number(id))) throw Object.assign(new Error(`Sin conexión (${id})`), { code: 'NETWORK' });
      const entry = movies[id];
      if (!entry) throw Object.assign(new Error(`No existe ${id}`), { code: 'NOT_FOUND' });
      return structuredClone(entry);
    },
  };
  const anilistApi = {
    calls: [],
    async batchGetByIds(ids) {
      anilistApi.calls.push([...ids]);
      if (failBatch) throw Object.assign(new Error('Sin conexión AniList'), { code: 'NETWORK' });
      return ids.map((id) => anilist[id]).filter(Boolean).map((entry) => structuredClone(entry));
    },
    async getById(id) {
      anilistApi.calls.push(['getById', id]);
      const entry = anilist[id];
      if (!entry) throw Object.assign(new Error(`No existe ${id}`), { code: 'API' });
      return structuredClone(entry);
    },
  };
  return { tmdb, anilist: anilistApi };
}

function makeData(entries) {
  const data = emptyData();
  data.meta.updatedAt = iso(2 * DAY);
  for (const [key, entry] of Object.entries(entries)) data.catalog[key] = entry;
  data.library['tmdb:tv:1'] = { episodes: { '1x1': { watched: ['2026-01-01T00:00:00Z'] } } };
  return data;
}

const baseDeps = () => ({ tmdbApiKey: 'k123' });

test('TTL de 1 hora: serie reciente no se re-pide', async () => {
  const entry = series(1, { fetchedAt: iso(30 * 60 * 1000) });
  const data = makeData({ 'tmdb:tv:1': entry });
  const { tmdb, anilist } = makeFakes({ series: { 1: series(1) } });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(result.updated, []);
  assert.equal(tmdb.calls.length, 0);
  assert.equal(anilist.calls.length, 0);
  assert.equal(result.data, data);
});

test('serie terminada se salta (TMDB y AniList), película no', async () => {
  const data = makeData({
    'tmdb:tv:1': series(1, { status: 'ended' }),
    'anilist:5': anilistEntry(5, { status: 'ended' }),
    'tmdb:movie:9': movie(9, { status: 'ended', fetchedAt: iso(31 * DAY) }),
  });
  const { tmdb, anilist } = makeFakes({
    series: { 1: series(1, { status: 'ended' }) },
    movies: { 9: movie(9, { status: 'ended' }) },
    anilist: { 5: anilistEntry(5, { status: 'ended' }) },
  });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(result.skipped, ['tmdb:tv:1', 'anilist:5']);
  assert.deepEqual(result.updated, ['tmdb:movie:9']);
  assert.deepEqual(tmdb.calls, [['getMovie', '9', 'k123']]);
  assert.equal(anilist.calls.length, 0);
});

test('AniList-only: todos los títulos en una sola llamada por lotes', async () => {
  const data = makeData({
    'anilist:5': anilistEntry(5),
    'anilist:6': anilistEntry(6),
  });
  const { tmdb, anilist } = makeFakes({ anilist: { 5: anilistEntry(5), 6: anilistEntry(6) } });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.equal(anilist.calls.length, 1);
  assert.deepEqual(anilist.calls[0], [5, 6]);
  assert.deepEqual(result.updated, ['anilist:5', 'anilist:6']);
  assert.equal(result.data.catalog['anilist:5'].fetchedAt, NOW.toISOString());
  assert.equal(result.data.catalog['anilist:5'].names.en, 'Anime 5');
});

test('ciclo de 30 días: película antigua se refresca, reciente no; AniList movie también', async () => {
  const data = makeData({
    'tmdb:movie:10': movie(10, { fetchedAt: iso(31 * DAY) }),
    'tmdb:movie:11': movie(11, { fetchedAt: iso(5 * DAY) }),
    'anilist:20': anilistEntry(20, { type: 'movie', fetchedAt: iso(31 * DAY) }),
    'anilist:21': anilistEntry(21, { type: 'movie', fetchedAt: iso(5 * DAY) }),
  });
  const { tmdb, anilist } = makeFakes({
    movies: { 10: movie(10), 11: movie(11) },
    anilist: { 20: anilistEntry(20, { type: 'movie' }), 21: anilistEntry(21, { type: 'movie' }) },
  });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(tmdb.calls, [['getMovie', '10', 'k123']]);
  assert.deepEqual(anilist.calls, [[20]]);
  assert.deepEqual(result.updated, ['tmdb:movie:10', 'anilist:20']);
});

test('marca de agua solo para series refrescadas, nunca para películas', async () => {
  const data = makeData({
    'tmdb:tv:1': series(1),
    'tmdb:tv:2': series(2, { fetchedAt: iso(30 * 60 * 1000) }),
    'tmdb:movie:9': movie(9),
    'anilist:5': anilistEntry(5),
  });
  const { tmdb, anilist } = makeFakes({
    series: { 1: series(1), 2: series(2) },
    movies: { 9: movie(9) },
    anilist: { 5: anilistEntry(5) },
  });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(result.data.meta.watermark, {
    'tmdb:tv:1': NOW.toISOString(),
    'anilist:5': NOW.toISOString(),
  });
  assert.ok(!('tmdb:tv:2' in result.data.meta.watermark));
  assert.ok(!('tmdb:movie:9' in result.data.meta.watermark));
});

test('fallo por título: entrada antigua intacta, error recogido, el resto continúa', async () => {
  const old1 = series(1);
  const data = makeData({ 'tmdb:tv:1': old1, 'tmdb:tv:2': series(2) });
  const { tmdb, anilist } = makeFakes({ series: { 1: series(1), 2: series(2) }, failSeries: [1] });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(result.updated, ['tmdb:tv:2']);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].key, 'tmdb:tv:1');
  assert.equal(result.errors[0].error.code, 'NETWORK');
  assert.deepEqual(result.data.catalog['tmdb:tv:1'], old1);
  assert.equal(result.data.catalog['tmdb:tv:2'].synopsis, 'sinopsis antigua');
  assert.equal(result.data.catalog['tmdb:tv:2'].fetchedAt, NOW.toISOString());
});

test('fallo del lote: ninguna entrada AniList cambia', async () => {
  const old5 = anilistEntry(5);
  const old6 = anilistEntry(6);
  const data = makeData({ 'anilist:5': old5, 'anilist:6': old6 });
  const { tmdb, anilist } = makeFakes({ anilist: { 5: old5, 6: old6 }, failBatch: true });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(result.updated, []);
  assert.equal(result.errors.length, 2);
  assert.equal(result.data.catalog['anilist:5'], old5);
  assert.equal(result.data.catalog['anilist:6'], old6);
  assert.ok(!result.data.meta.watermark);
});

test('la biblioteca nunca se toca', async () => {
  const data = makeData({ 'tmdb:tv:1': series(1), 'anilist:5': anilistEntry(5) });
  const libraryBefore = structuredClone(data.library);
  const { tmdb, anilist } = makeFakes({
    series: { 1: series(1) },
    anilist: { 5: anilistEntry(5) },
    failSeries: [1],
  });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.equal(result.data.library, data.library);
  assert.deepEqual(result.data.library, libraryBefore);
});

test('refreshOne fuerza el refresco aunque el TTL no haya vencido', async () => {
  const data = makeData({ 'tmdb:tv:1': series(1, { fetchedAt: iso(5 * 60 * 1000) }) });
  const { tmdb, anilist } = makeFakes({ series: { 1: series(1) } });
  const result = await refreshOne(data, 'tmdb:tv:1', { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(result.updated, ['tmdb:tv:1']);
  assert.deepEqual(tmdb.calls, [['getSeries', '1', 'k123']]);
  assert.equal(result.data.catalog['tmdb:tv:1'].fetchedAt, NOW.toISOString());
  assert.equal(result.data.meta.watermark['tmdb:tv:1'], NOW.toISOString());
});

test('refreshOne de clave AniList usa getById y conserva anilistId', async () => {
  const data = makeData({ 'anilist:5': anilistEntry(5) });
  const { tmdb, anilist } = makeFakes({ anilist: { 5: anilistEntry(5) } });
  const result = await refreshOne(data, 'anilist:5', { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(anilist.calls, [['getById', 5]]);
  assert.deepEqual(result.updated, ['anilist:5']);
  assert.equal(result.data.catalog['anilist:5'].anilistId, 5);
  assert.equal(result.data.catalog['anilist:5'].id, 'anilist:5');
});

test('refreshOne sin clave TMDB: error NO_KEY y datos intactos', async () => {
  const old = series(1);
  const data = makeData({ 'tmdb:tv:1': old });
  const { tmdb, anilist } = makeFakes({ series: { 1: series(1) } });
  const result = await refreshOne(data, 'tmdb:tv:1', { tmdb, anilist, tmdbApiKey: '', now: NOW });
  assert.deepEqual(result.updated, []);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].error.code, 'NO_KEY');
  assert.equal(result.data.catalog['tmdb:tv:1'], old);
});

test('refreshOne de clave inexistente: error sin tocar datos', async () => {
  const data = makeData({ 'tmdb:tv:1': series(1) });
  const { tmdb, anilist } = makeFakes();
  const result = await refreshOne(data, 'tmdb:tv:999', { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(result.updated, []);
  assert.equal(result.errors.length, 1);
  assert.equal(result.data, data);
});

test('refreshAll fuerza toda la biblioteca ignorando TTLs con progreso', async () => {
  const data = makeData({
    'tmdb:tv:1': series(1, { fetchedAt: iso(5 * 60 * 1000) }),
    'tmdb:tv:2': series(2, { status: 'ended' }),
    'tmdb:movie:9': movie(9, { fetchedAt: iso(5 * 60 * 1000) }),
    'anilist:5': anilistEntry(5, { fetchedAt: iso(5 * 60 * 1000) }),
  });
  const { tmdb, anilist } = makeFakes({
    series: { 1: series(1), 2: series(2, { status: 'ended' }) },
    movies: { 9: movie(9) },
    anilist: { 5: anilistEntry(5) },
  });
  const progress = [];
  const result = await refreshAll(data, {
    ...baseDeps(),
    tmdb,
    anilist,
    now: NOW,
    onProgress: (done, total, label) => progress.push({ done, total, label }),
  });
  assert.deepEqual(result.updated.sort(), ['anilist:5', 'tmdb:movie:9', 'tmdb:tv:1']);
  assert.deepEqual(result.skipped, ['tmdb:tv:2']);
  assert.deepEqual(tmdb.calls, [
    ['getSeries', '1', 'k123'],
    ['getMovie', '9', 'k123'],
  ]);
  assert.equal(anilist.calls.length, 1);
  assert.equal(progress[0].done, 0);
  assert.equal(progress[0].total, 3);
  assert.equal(progress[progress.length - 1].done, 3);
  assert.equal(progress[progress.length - 1].total, 3);
  assert.equal(result.data.meta.lastRefresh, NOW.toISOString());
  assert.equal(result.data.meta.updatedAt, NOW.toISOString());
});

test('anilistId y romaji/native se conservan al refrescar un cruce TMDB', async () => {
  const data = makeData({
    'tmdb:tv:1': series(1, { anilistId: 20954, names: { romaji: 'R&M', native: 'リック' } }),
  });
  const freshDetail = series(1);
  delete freshDetail.anilistId;
  const { tmdb, anilist } = makeFakes({ series: { 1: freshDetail } });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  const entry = result.data.catalog['tmdb:tv:1'];
  assert.equal(entry.anilistId, 20954);
  assert.equal(entry.names.romaji, 'R&M');
  assert.equal(entry.names.native, 'リック');
  assert.equal(entry.names.es, 'Serie 1');
});

test('sin datos: resultado vacío sin errores', async () => {
  const { tmdb, anilist } = makeFakes();
  const result = await refreshLibrary(null, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.deepEqual(result, { data: null, updated: [], skipped: [], errors: [] });
});

test('todo actualizado: no se llama a ningún proveedor y el fichero no cambia', async () => {
  const data = makeData({ 'tmdb:tv:1': series(1, { fetchedAt: iso(30 * 60 * 1000) }) });
  const { tmdb, anilist } = makeFakes({ series: { 1: series(1) } });
  const result = await refreshLibrary(data, { ...baseDeps(), tmdb, anilist, now: NOW });
  assert.equal(result.data, data);
  assert.equal(tmdb.calls.length, 0);
  assert.equal(anilist.calls.length, 0);
  assert.ok(!result.data.meta.watermark);
});
