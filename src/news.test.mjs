import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from './model.js';
import {
  computeNewEpisodes,
  computePremieres,
  groupByAnime,
  readNewsWindowDays,
  NEWS_LIMIT,
  NEWS_WINDOW_DEFAULT,
  NEWS_WINDOW_MIN,
  NEWS_WINDOW_MAX,
  PREMIERE_LIMIT,
} from './news.js';

const NOW = new Date('2026-08-15T12:00:00Z');

function seriesEntry(key, seasons) {
  return {
    id: key,
    type: 'series',
    isAnime: false,
    names: { es: 'Serie', en: null, romaji: null, native: null },
    synopsis: '',
    poster: null,
    backdrop: null,
    releaseDate: '2020-01-01',
    status: 'returning',
    genres: [],
    voteAverage: null,
    seasons,
    fetchedAt: '2026-08-14T00:00:00Z',
  };
}

function ep(n, airDate, name = null) {
  return { n, name, airDate, runtime: null };
}

function season(n, episodes) {
  return { n, episodes };
}

function makeData({ catalog = {}, library = {}, watermark = null } = {}) {
  const data = emptyData();
  for (const [key, entry] of Object.entries(catalog)) data.catalog[key] = entry;
  for (const [key, entry] of Object.entries(library)) data.library[key] = entry;
  if (watermark) data.meta.watermark = watermark;
  return data;
}

function premiereEntry(key, releaseDate, overrides = {}) {
  return {
    key,
    id: key,
    type: key.startsWith('tmdb:movie:') ? 'movie' : 'series',
    isAnime: false,
    names: { es: `Estreno ${key}`, en: null, romaji: null, native: null },
    synopsis: '',
    poster: '/p.jpg',
    backdrop: null,
    releaseDate,
    status: 'returning',
    genres: [],
    voteAverage: null,
    fetchedAt: '2026-08-14T00:00:00Z',
    ...overrides,
  };
}

test('capítulos nuevos: emitido tras la marca de agua → listado; antes → no', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: { [key]: seriesEntry(key, [season(1, [ep(1, '2026-08-01'), ep(2, '2026-08-10'), ep(3, '2026-08-12')])]) },
    library: { [key]: {} },
    watermark: { [key]: '2026-08-10T12:00:00Z' },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'episode', key, seasonN: 1, episodeN: 3, airDate: '2026-08-12', name: null },
  ]);
});

test('capítulos nuevos: sin marca de agua → todos los emitidos dentro de la ventana, orden desc', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: { [key]: seriesEntry(key, [season(1, [ep(1, '2026-08-05', 'Piloto'), ep(2, '2026-08-01')])]) },
    library: { [key]: {} },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'episode', key, seasonN: 1, episodeN: 1, airDate: '2026-08-05', name: 'Piloto' },
    { kind: 'episode', key, seasonN: 1, episodeN: 2, airDate: '2026-08-01', name: null },
  ]);
});

test('especiales (temporada 0) no entran en novedades aunque estén fuera de la marca', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(0, [ep(1, '2026-08-14')]),
        season(1, [ep(1, '2026-08-01')]),
      ]),
    },
    library: { [key]: {} },
  });
  const result = computeNewEpisodes(data, NOW);
  assert.equal(result.length, 1);
  assert.equal(result[0].seasonN, 1);
});

test('ventana por defecto (90 días): sin marca, un capítulo más viejo que la ventana no entra', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(1, [ep(1, '2026-05-10'), ep(2, '2026-08-10')]),
      ]),
    },
    library: { [key]: {} },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'episode', key, seasonN: 1, episodeN: 2, airDate: '2026-08-10', name: null },
  ]);
});

test('ventana configurable: data.settings.newsWindowDays acota el feed', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(1, [ep(1, '2026-08-01'), ep(2, '2026-08-10')]),
      ]),
    },
    library: { [key]: {} },
  });
  data.settings.newsWindowDays = 10;
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'episode', key, seasonN: 1, episodeN: 2, airDate: '2026-08-10', name: null },
  ]);
});

test('marca de agua presente manda sobre la ventana (la marca puede ser más vieja que la ventana)', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [season(1, [ep(1, '2026-03-01'), ep(2, '2026-08-10')])]),
    },
    library: { [key]: {} },
    watermark: { [key]: '2026-04-01T12:00:00Z' },
  });
  data.settings.newsWindowDays = 10;
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'episode', key, seasonN: 1, episodeN: 2, airDate: '2026-08-10', name: null },
  ]);
});

test('agrupado: capítulos del mismo título y día y temporada se agrupan desde 2 con rango, contador y completo', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(1, [ep(1, '2026-08-14'), ep(2, '2026-08-14'), ep(3, '2026-08-14')]),
      ]),
    },
    library: { [key]: {} },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'group', key, seasonN: 1, airDate: '2026-08-14', startN: 1, endN: 3, count: 3, complete: true },
  ]);
});

test('agrupado: un grupo parcial (no toda la temporada) no marca «completa»', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(1, [ep(1, '2026-08-14'), ep(2, '2026-08-14'), ep(3, '2026-07-01'), ep(4, '2026-09-01')]),
      ]),
    },
    library: { [key]: {} },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'group', key, seasonN: 1, airDate: '2026-08-14', startN: 1, endN: 2, count: 2, complete: false },
    { kind: 'episode', key, seasonN: 1, episodeN: 3, airDate: '2026-07-01', name: null },
  ]);
});

test('agrupado: un grupo que cubre todos los capítulos emitidos (con episodios futuros) marca «completa»', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(1, [ep(1, '2026-08-14'), ep(2, '2026-08-14'), ep(3, '2026-09-01')]),
      ]),
    },
    library: { [key]: {} },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'group', key, seasonN: 1, airDate: '2026-08-14', startN: 1, endN: 2, count: 2, complete: true },
  ]);
});

test('agrupado: temporadas distintas del mismo título y día no se mezclan', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(1, [ep(1, '2026-08-14'), ep(2, '2026-08-14')]),
        season(2, [ep(1, '2026-08-14'), ep(2, '2026-08-14')]),
      ]),
    },
    library: { [key]: {} },
  });
  const result = computeNewEpisodes(data, NOW);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.seasonN).sort(), [1, 2]);
});

test('agrupado: títulos distintos del mismo día no se agrupan', () => {
  const k1 = 'tmdb:tv:1';
  const k2 = 'tmdb:tv:2';
  const data = makeData({
    catalog: {
      [k1]: seriesEntry(k1, [season(1, [ep(1, '2026-08-14'), ep(2, '2026-08-14')])]),
      [k2]: seriesEntry(k2, [season(1, [ep(1, '2026-08-14'), ep(2, '2026-08-14')])]),
    },
    library: { [k1]: {}, [k2]: {} },
  });
  const result = computeNewEpisodes(data, NOW);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map((r) => r.kind), ['group', 'group']);
  assert.notEqual(result[0].key, result[1].key);
});

test('agrupado: los días distintos del mismo título no se agrupan y mantienen orden desc', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(1, [ep(1, '2026-08-14'), ep(2, '2026-08-14'), ep(3, '2026-08-10')]),
      ]),
    },
    library: { [key]: {} },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'group', key, seasonN: 1, airDate: '2026-08-14', startN: 1, endN: 2, count: 2, complete: false },
    { kind: 'episode', key, seasonN: 1, episodeN: 3, airDate: '2026-08-10', name: null },
  ]);
});

test('tope de 50 filas en el feed (grupos cuentan como una)', () => {
  const data = makeData({});
  for (let s = 1; s <= 55; s += 1) {
    const key = `tmdb:tv:${s}`;
    data.catalog[key] = seriesEntry(key, [
      season(1, [ep(1, '2026-08-14'), ep(2, '2026-08-14')]),
    ]);
    data.library[key] = {};
  }
  const result = computeNewEpisodes(data, NOW);
  assert.equal(result.length, NEWS_LIMIT);
});

test('readNewsWindowDays: default 90, clampa 7–365 y redondea enteros', () => {
  assert.equal(readNewsWindowDays(makeData({})), NEWS_WINDOW_DEFAULT);
  assert.equal(readNewsWindowDays({ settings: { newsWindowDays: 30 } }), 30);
  assert.equal(readNewsWindowDays({ settings: { newsWindowDays: 1 } }), NEWS_WINDOW_MIN);
  assert.equal(readNewsWindowDays({ settings: { newsWindowDays: 999 } }), NEWS_WINDOW_MAX);
  assert.equal(readNewsWindowDays({ settings: { newsWindowDays: 45.6 } }), 46);
  assert.equal(readNewsWindowDays({ settings: {} }), NEWS_WINDOW_DEFAULT);
  assert.equal(readNewsWindowDays({ settings: { newsWindowDays: '90' } }), NEWS_WINDOW_DEFAULT);
  assert.equal(readNewsWindowDays(null), NEWS_WINDOW_DEFAULT);
});

test('episodios sin airDate o con fecha futura no cuentan', () => {
  const key = 'tmdb:tv:1';
  const data = makeData({
    catalog: {
      [key]: seriesEntry(key, [
        season(1, [ep(1, null), ep(2, ''), ep(3, '2026-09-01'), ep(4, '2026-08-10')]),
      ]),
    },
    library: { [key]: {} },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW), [
    { kind: 'episode', key, seasonN: 1, episodeN: 4, airDate: '2026-08-10', name: null },
  ]);
});

test('Para ver (entrada vacía) y entradas con visionados se incluyen; followed:false no', () => {
  const k1 = 'tmdb:tv:1';
  const k2 = 'tmdb:tv:2';
  const k3 = 'tmdb:tv:3';
  const data = makeData({
    catalog: {
      [k1]: seriesEntry(k1, [season(1, [ep(1, '2026-08-14')])]),
      [k2]: seriesEntry(k2, [season(1, [ep(1, '2026-08-14')])]),
      [k3]: seriesEntry(k3, [season(1, [ep(1, '2026-08-14')])]),
    },
    library: {
      [k1]: {},
      [k2]: { episodes: { '1x1': { watched: ['2026-08-14T00:00:00Z'] } } },
      [k3]: { followed: false, episodes: { '1x1': { watched: ['2026-08-14T00:00:00Z'] } } },
    },
  });
  const result = computeNewEpisodes(data, NOW);
  assert.deepEqual(result.map((r) => r.key).sort(), [k1, k2]);
});

test('las películas de la biblioteca no generan capítulos nuevos', () => {
  const data = makeData({
    catalog: {
      'tmdb:tv:1': seriesEntry('tmdb:tv:1', [season(1, [ep(1, '2026-08-14')])]),
      'tmdb:movie:9': { id: 'tmdb:movie:9', type: 'movie', isAnime: false, names: { es: 'Peli', en: null, romaji: null, native: null }, seasons: undefined },
    },
    library: { 'tmdb:tv:1': {}, 'tmdb:movie:9': {} },
  });
  assert.deepEqual(computeNewEpisodes(data, NOW).map((r) => r.key), ['tmdb:tv:1']);
});

test('estrenos: dedupe contra catálogo y biblioteca', () => {
  const inCatalog = 'tmdb:tv:100';
  const inLibrary = 'tmdb:tv:101';
  const free = 'tmdb:tv:102';
  const data = makeData({
    catalog: { [inCatalog]: seriesEntry(inCatalog, [season(1, [ep(1, '2026-08-01')])]) },
    library: { [inLibrary]: {} },
  });
  const results = [inCatalog, inLibrary, free].map((key) =>
    premiereEntry(key, '2026-08-10')
  );
  const premieres = computePremieres(data, results, NOW);
  assert.deepEqual(premieres.map((p) => p.key), [free]);
});

test('estrenos: ventana de 30 días y futuros excluidos', () => {
  const data = makeData({});
  const results = [
    premiereEntry('tmdb:tv:1', '2026-07-16'),
    premiereEntry('tmdb:tv:2', '2026-07-15'),
    premiereEntry('tmdb:tv:3', '2026-08-15'),
    premiereEntry('tmdb:tv:4', '2026-08-16'),
    premiereEntry('tmdb:tv:5', null),
    premiereEntry('tmdb:tv:6', ''),
  ];
  const premieres = computePremieres(data, results, NOW);
  assert.deepEqual(premieres.map((p) => p.key), ['tmdb:tv:3', 'tmdb:tv:1']);
});

test('estrenos: tope de 50', () => {
  const data = makeData({});
  const results = Array.from({ length: 60 }, (_, i) =>
    premiereEntry(`tmdb:tv:${1000 + i}`, `2026-08-${String(15 - (i % 15)).padStart(2, '0')}`)
  );
  const premieres = computePremieres(data, results, NOW);
  assert.equal(premieres.length, PREMIERE_LIMIT);
});

test('estrenos: orden desc por fecha; duplicados entre listas → una sola vez', () => {
  const data = makeData({});
  const shared = premiereEntry('tmdb:tv:1', '2026-08-14', { isAnime: true });
  const results = [
    premiereEntry('tmdb:tv:2', '2026-08-01'),
    shared,
    premiereEntry('tmdb:movie:3', '2026-08-10'),
    { ...shared },
  ];
  const premieres = computePremieres(data, results, NOW);
  assert.deepEqual(
    premieres.map((p) => p.key),
    ['tmdb:tv:1', 'tmdb:movie:3', 'tmdb:tv:2']
  );
});

test('estrenos sin releaseDate o sin clave no entran', () => {
  const data = makeData({});
  const results = [premiereEntry('tmdb:tv:1', '2026-08-10'), { ...premiereEntry('tmdb:tv:2', null), id: null }];
  const premieres = computePremieres(data, results, NOW);
  assert.deepEqual(premieres.map((p) => p.key), ['tmdb:tv:1']);
});

test('groupByAnime: partición exacta, película anime va a anime', () => {
  const animeSeries = premiereEntry('tmdb:tv:1', '2026-08-10', { isAnime: true });
  const animeMovie = premiereEntry('tmdb:movie:2', '2026-08-10', { type: 'movie', isAnime: true });
  const liveSeries = premiereEntry('tmdb:tv:3', '2026-08-10');
  const liveMovie = premiereEntry('tmdb:movie:4', '2026-08-10', { type: 'movie' });
  const groups = groupByAnime([liveMovie, animeSeries, liveSeries, animeMovie]);
  assert.deepEqual(groups.series.map((p) => p.key), ['tmdb:tv:3']);
  assert.deepEqual(groups.movies.map((p) => p.key), ['tmdb:movie:4']);
  assert.deepEqual(groups.anime.map((p) => p.key).sort(), ['tmdb:movie:2', 'tmdb:tv:1']);
  const total = groups.series.length + groups.movies.length + groups.anime.length;
  assert.equal(total, 4);
});

test('groupByAnime: con lista vacía devuelve partición vacía', () => {
  const groups = groupByAnime([]);
  assert.deepEqual(groups, { series: [], movies: [], anime: [] });
});
