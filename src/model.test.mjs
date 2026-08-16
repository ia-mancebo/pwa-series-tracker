import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DATA_FILE_NAME,
  CURRENT_VERSION,
  emptyData,
  episodeKey,
  seriesState,
  seasonState,
  movieState,
  rewatchCount,
  toggleEpisodeWatched,
  markSeasonWatched,
  setEpisodeNote,
  setTitleNote,
  toggleMovieWatched,
  setFollowed,
  addToLibrary,
  normalize,
  migrate,
  serialize,
  validate,
} from './model.js';

const NOW = '2026-08-10T18:30:00Z';
const KEY = 'tmdb:tv:1';

const SKELETON = {
  meta: { version: 1, updatedAt: '2026-08-10T18:30:00Z' },
  catalog: {
    'tmdb:tv:60625': {
      anilistId: 20954,
      type: 'series',
      isAnime: false,
      names: { es: 'Rick y Morty', en: 'Rick and Morty', romaji: null, native: null },
      synopsis: '…',
      poster: '/w9kR8qbmQ01HwnvK4alvnQ2ca0L.jpg',
      backdrop: '/….jpg',
      releaseDate: '2013-12-02',
      status: 'returning',
      genres: ['Animación', 'Sci-Fi & Fantasy'],
      voteAverage: 8.7,
      seasons: [
        { n: 1, episodes: [{ n: 1, name: 'Pilot', airDate: '2013-12-02', runtime: 22 }] },
      ],
      fetchedAt: '2026-08-09T10:00:00Z',
    },
  },
  library: {
    'tmdb:tv:60625': {
      note: 5,
      episodes: {
        '2x5': { watched: ['2025-01-02T21:15:00Z', '2025-01-03T18:40:00Z'], note: 4 },
      },
      origin: {
        source: 'tvtime',
        matchedName: 'Rick and Morty',
        importedAt: '2026-08-15T12:00:00Z',
        rawVotes: { '2x5': 29 },
      },
    },
    'tmdb:movie:27205': {
      watched: ['2025-03-14T22:00:00Z'],
      note: 5,
      origin: { source: 'tvtime', matchedName: 'Inception', importedAt: '2026-08-15T12:00:00Z', rawVote: 29 },
    },
    'tmdb:movie:693134': {},
  },
};

function baseSeries() {
  const data = emptyData();
  data.catalog[KEY] = {
    type: 'series',
    isAnime: false,
    names: { es: 'Serie de prueba', en: 'Test Series', romaji: null, native: null },
    seasons: [
      { n: 0, episodes: [
        { n: 1, name: 'Especial 1', airDate: '2020-01-01' },
        { n: 2, name: 'Especial 2', airDate: '2020-02-01' },
      ] },
      { n: 1, episodes: [
        { n: 1, name: 'Cap 1', airDate: '2020-03-01' },
        { n: 2, name: 'Cap 2', airDate: '2020-04-01' },
        { n: 3, name: 'Cap 3', airDate: null },
      ] },
      { n: 2, episodes: [
        { n: 1, name: 'Futuro', airDate: '2026-12-31' },
      ] },
    ],
  };
  data.library[KEY] = { episodes: {} };
  return data;
}

function watchedSeries() {
  let data = baseSeries();
  data = toggleEpisodeWatched(data, KEY, '1x1', '2025-01-01T10:00:00Z');
  data = toggleEpisodeWatched(data, KEY, '1x2', '2025-01-02T10:00:00Z');
  return data;
}

test('emptyData crea el esqueleto con versión 1 y updatedAt ISO', () => {
  const data = emptyData();
  assert.equal(data.meta.version, 1);
  assert.ok(!Number.isNaN(Date.parse(data.meta.updatedAt)));
  assert.deepEqual(data.catalog, {});
  assert.deepEqual(data.library, {});
  assert.deepEqual(data.review, []);
  assert.deepEqual(data.settings, {});
  assert.equal(CURRENT_VERSION, 1);
  assert.equal(DATA_FILE_NAME, 'tvtime-data.json');
});

test('episodeKey genera claves SxE en minúsculas', () => {
  assert.equal(episodeKey(2, 5), '2x5');
  assert.equal(episodeKey(0, 1), '0x1');
  assert.equal(episodeKey('Season', 1), 'seasonx1');
});

test('migrate devuelve los datos tal cual para la versión 1', () => {
  const data = emptyData();
  assert.equal(migrate(data), data);
  assert.equal(migrate(SKELETON), SKELETON);
});

test('serie sin visionados es paraver', () => {
  const data = baseSeries();
  assert.equal(seriesState(data.library[KEY], data.catalog[KEY], NOW), 'paraver');
});

test('especiales (temporada 0) no cuentan para el estado de la serie', () => {
  let data = baseSeries();
  data = toggleEpisodeWatched(data, KEY, '0x1', '2025-01-01T10:00:00Z');
  data = toggleEpisodeWatched(data, KEY, '0x2', '2025-01-02T10:00:00Z');
  assert.equal(seriesState(data.library[KEY], data.catalog[KEY], NOW), 'paraver');
});

test('temporada completa de regulares vista -> visto', () => {
  const data = watchedSeries();
  assert.equal(seriesState(data.library[KEY], data.catalog[KEY], NOW), 'visto');
});

test('capítulo nuevo emitido devuelve la serie vista a viendo', () => {
  const data = watchedSeries();
  assert.equal(seriesState(data.library[KEY], data.catalog[KEY], NOW), 'visto');
  data.catalog[KEY].seasons[2].episodes.push({ n: 2, name: 'Cap nuevo', airDate: '2026-09-01' });
  assert.equal(seriesState(data.library[KEY], data.catalog[KEY], '2026-09-02T12:00:00Z'), 'viendo');
});

test('episodios futuros y sin airDate no cuentan como emitidos', () => {
  const data = watchedSeries();
  assert.equal(seriesState(data.library[KEY], data.catalog[KEY], NOW), 'visto');
  const onlyFuture = baseSeries();
  onlyFuture.catalog[KEY].seasons = [{ n: 1, episodes: [{ n: 1, airDate: '2027-01-01' }] }];
  assert.equal(seriesState(onlyFuture.library[KEY], onlyFuture.catalog[KEY], NOW), 'paraver');
  const onlyUndated = baseSeries();
  onlyUndated.catalog[KEY].seasons = [{ n: 1, episodes: [{ n: 1, airDate: null }] }];
  assert.equal(seriesState(onlyUndated.library[KEY], onlyUndated.catalog[KEY], NOW), 'paraver');
});

test('visionados de episodios ajenos al catálogo no cuentan', () => {
  let data = baseSeries();
  data = toggleEpisodeWatched(data, KEY, '9x9', '2025-01-01T10:00:00Z');
  assert.equal(seriesState(data.library[KEY], data.catalog[KEY], NOW), 'paraver');
});

test('sin catálogo la serie se trata como paraver', () => {
  const data = baseSeries();
  assert.equal(seriesState(data.library[KEY], undefined, NOW), 'paraver');
  assert.equal(seriesState(data.library[KEY], { type: 'movie' }, NOW), 'paraver');
});

test('seasonState deriva por temporada, incluida la 0', () => {
  const data = baseSeries();
  assert.equal(seasonState(data.library[KEY], data.catalog[KEY].seasons[0], NOW), 'paraver');
  assert.equal(seasonState(data.library[KEY], data.catalog[KEY].seasons[1], NOW), 'paraver');
  assert.equal(seasonState(data.library[KEY], data.catalog[KEY].seasons[2], NOW), 'paraver');
  let partial = toggleEpisodeWatched(data, KEY, '1x1', '2025-01-01T10:00:00Z');
  assert.equal(seasonState(partial.library[KEY], partial.catalog[KEY].seasons[1], NOW), 'viendo');
  partial = toggleEpisodeWatched(partial, KEY, '1x2', '2025-01-02T10:00:00Z');
  assert.equal(seasonState(partial.library[KEY], partial.catalog[KEY].seasons[1], NOW), 'visto');
  let specials = toggleEpisodeWatched(data, KEY, '0x1', '2025-01-01T10:00:00Z');
  specials = toggleEpisodeWatched(specials, KEY, '0x2', '2025-01-02T10:00:00Z');
  assert.equal(seasonState(specials.library[KEY], specials.catalog[KEY].seasons[0], NOW), 'visto');
});

test('película nunca viendo', () => {
  assert.equal(movieState({}), 'paraver');
  assert.equal(movieState({ watched: [] }), 'paraver');
  assert.equal(movieState({ watched: ['2025-01-01T00:00:00Z'] }), 'visto');
  assert.equal(movieState({ watched: ['2025-01-01T00:00:00Z', '2025-02-01T00:00:00Z'] }), 'visto');
  assert.equal(movieState(undefined), 'paraver');
});

test('rewatchCount deriva del número de visionados, mínimo 0', () => {
  assert.equal(rewatchCount({ watched: [] }), 0);
  assert.equal(rewatchCount({ watched: ['t'] }), 0);
  assert.equal(rewatchCount({ watched: ['t', 'u'] }), 1);
  assert.equal(rewatchCount({ watched: ['t', 'u', 'v'] }), 2);
  assert.equal(rewatchCount({}), 0);
  assert.equal(rewatchCount(undefined), 0);
  const skeletonEpisode = SKELETON.library['tmdb:tv:60625'].episodes['2x5'];
  assert.equal(rewatchCount(skeletonEpisode), 1);
  assert.equal(rewatchCount(SKELETON.library['tmdb:movie:27205']), 0);
});

test('toggleEpisodeWatched marca y desmarca, sin mutar la entrada', () => {
  const data = baseSeries();
  const before = structuredClone(data);
  const ts = '2025-06-01T09:00:00Z';
  const added = toggleEpisodeWatched(data, KEY, '1x1', ts);
  assert.notEqual(added, data);
  assert.deepEqual(added.library[KEY].episodes['1x1'].watched, [ts]);
  assert.equal(seriesState(added.library[KEY], added.catalog[KEY], NOW), 'viendo');
  const removed = toggleEpisodeWatched(added, KEY, '1x1');
  assert.ok(!('1x1' in removed.library[KEY].episodes));
  assert.equal(seriesState(removed.library[KEY], removed.catalog[KEY], NOW), 'paraver');
  assert.deepEqual(data, before);
});

test('toggleEpisodeWatched con watchedFlag fija o limpia sin alternar', () => {
  const data = baseSeries();
  const ts = '2025-06-01T09:00:00Z';
  const flagged = toggleEpisodeWatched(data, KEY, '1x1', ts, true);
  assert.deepEqual(flagged.library[KEY].episodes['1x1'].watched, [ts]);
  const again = toggleEpisodeWatched(flagged, KEY, '1x1', '2026-01-01T00:00:00Z', true);
  assert.deepEqual(again.library[KEY].episodes['1x1'].watched, [ts]);
  const cleared = toggleEpisodeWatched(again, KEY, '1x1', undefined, false);
  assert.ok(!('1x1' in cleared.library[KEY].episodes));
});

test('toggleEpisodeWatched crea la entrada de biblioteca si falta', () => {
  const data = emptyData();
  const next = toggleEpisodeWatched(data, KEY, '1x1', '2025-01-01T00:00:00Z');
  assert.deepEqual(next.library[KEY].episodes['1x1'].watched, ['2025-01-01T00:00:00Z']);
});

test('markSeasonWatched marca toda la temporada del catálogo', () => {
  const data = baseSeries();
  const ts = '2025-05-05T12:00:00Z';
  const next = markSeasonWatched(data, KEY, 1, ts);
  assert.deepEqual(next.library[KEY].episodes['1x1'].watched, [ts]);
  assert.deepEqual(next.library[KEY].episodes['1x2'].watched, [ts]);
  assert.deepEqual(next.library[KEY].episodes['1x3'].watched, [ts]);
  assert.equal(seriesState(next.library[KEY], next.catalog[KEY], NOW), 'visto');
  assert.ok(!('2x1' in next.library[KEY].episodes));
});

test('markSeasonWatched no duplica visionados ya marcados', () => {
  let data = toggleEpisodeWatched(baseSeries(), KEY, '1x1', '2025-01-01T00:00:00Z');
  data = markSeasonWatched(data, KEY, 1, '2025-05-05T12:00:00Z');
  assert.equal(data.library[KEY].episodes['1x1'].watched.length, 1);
  assert.deepEqual(data.library[KEY].episodes['1x2'].watched, ['2025-05-05T12:00:00Z']);
});

test('markSeasonWatched sin temporada en el catálogo no cambia nada', () => {
  const data = baseSeries();
  const before = structuredClone(data);
  assert.equal(markSeasonWatched(data, KEY, 99, '2025-01-01T00:00:00Z'), data);
  assert.deepEqual(data, before);
});

test('fecha retroactiva se guarda tal cual y cuenta para el estado', () => {
  let data = baseSeries();
  data = toggleEpisodeWatched(data, KEY, '1x1', '2015-06-01T09:00:00Z');
  data = toggleEpisodeWatched(data, KEY, '1x2', '2015-06-02T09:00:00Z');
  assert.deepEqual(data.library[KEY].episodes['1x1'].watched, ['2015-06-01T09:00:00Z']);
  assert.equal(seriesState(data.library[KEY], data.catalog[KEY], NOW), 'visto');
});

test('setEpisodeNote guarda, actualiza y limpia la nota del capítulo', () => {
  const data = baseSeries();
  const noted = setEpisodeNote(data, KEY, '1x1', 4);
  assert.equal(noted.library[KEY].episodes['1x1'].note, 4);
  const updated = setEpisodeNote(noted, KEY, '1x1', 2);
  assert.equal(updated.library[KEY].episodes['1x1'].note, 2);
  const cleared = setEpisodeNote(updated, KEY, '1x1', null);
  assert.ok(!('1x1' in cleared.library[KEY].episodes));
  const kept = setEpisodeNote(toggleEpisodeWatched(data, KEY, '1x1', '2025-01-01T00:00:00Z'), KEY, '1x1', 3);
  const withNote = setEpisodeNote(kept, KEY, '1x1', null);
  assert.deepEqual(withNote.library[KEY].episodes['1x1'], { watched: ['2025-01-01T00:00:00Z'] });
  assert.throws(() => setEpisodeNote(data, KEY, '1x1', 0), RangeError);
  assert.throws(() => setEpisodeNote(data, KEY, '1x1', 6), RangeError);
  assert.throws(() => setEpisodeNote(data, KEY, '1x1', 4.5), RangeError);
});

test('setTitleNote guarda y limpia la nota del título', () => {
  const data = baseSeries();
  const noted = setTitleNote(data, KEY, 5);
  assert.equal(noted.library[KEY].note, 5);
  const cleared = setTitleNote(noted, KEY, null);
  assert.ok(!('note' in cleared.library[KEY]));
  const movie = setTitleNote(emptyData(), 'tmdb:movie:1', 3);
  assert.deepEqual(movie.library['tmdb:movie:1'], { note: 3 });
  assert.throws(() => setTitleNote(data, KEY, 7), RangeError);
});

test('toggleMovieWatched marca, desmarca y respeta watchedFlag', () => {
  const data = emptyData();
  const ts = '2025-03-14T22:00:00Z';
  const added = toggleMovieWatched(data, 'tmdb:movie:27205', ts);
  assert.deepEqual(added.library['tmdb:movie:27205'].watched, [ts]);
  assert.equal(movieState(added.library['tmdb:movie:27205']), 'visto');
  const removed = toggleMovieWatched(added, 'tmdb:movie:27205');
  assert.deepEqual(removed.library['tmdb:movie:27205'], {});
  assert.equal(movieState(removed.library['tmdb:movie:27205']), 'paraver');
  const forced = toggleMovieWatched(removed, 'tmdb:movie:27205', ts, true);
  assert.deepEqual(forced.library['tmdb:movie:27205'].watched, [ts]);
  const noDup = toggleMovieWatched(forced, 'tmdb:movie:27205', '2026-01-01T00:00:00Z', true);
  assert.deepEqual(noDup.library['tmdb:movie:27205'].watched, [ts]);
  const off = toggleMovieWatched(noDup, 'tmdb:movie:27205', undefined, false);
  assert.deepEqual(off.library['tmdb:movie:27205'], {});
});

test('setFollowed conserva el historial al dejar de seguir', () => {
  const data = emptyData();
  let next = toggleMovieWatched(data, 'tmdb:movie:27205', '2025-03-14T22:00:00Z');
  next = setFollowed(next, 'tmdb:movie:27205', false);
  assert.equal(next.library['tmdb:movie:27205'].followed, false);
  assert.deepEqual(next.library['tmdb:movie:27205'].watched, ['2025-03-14T22:00:00Z']);
  next = setFollowed(next, 'tmdb:movie:27205', true);
  assert.ok(!('followed' in next.library['tmdb:movie:27205']));
  assert.deepEqual(next.library['tmdb:movie:27205'].watched, ['2025-03-14T22:00:00Z']);
});

test('addToLibrary añade catálogo y entrada vacía (para ver)', () => {
  const data = emptyData();
  const entry = { id: KEY, type: 'series', isAnime: false, names: { es: 'Serie', en: 'Series' } };
  const next = addToLibrary(data, entry);
  assert.equal(next.catalog[KEY], entry);
  assert.deepEqual(next.library[KEY], {});
  assert.equal(seriesState(next.library[KEY], next.catalog[KEY], NOW), 'paraver');
});

test('addToLibrary con película y opts.watched', () => {
  const data = emptyData();
  const movie = { id: 'tmdb:movie:1', type: 'movie', isAnime: false, names: { es: 'Película', en: 'Movie' } };
  const next = addToLibrary(data, movie, { watched: ['2025-03-14T22:00:00Z'], note: 5, followed: false });
  assert.deepEqual(next.library['tmdb:movie:1'], { watched: ['2025-03-14T22:00:00Z'], note: 5, followed: false });
  assert.equal(movieState(next.library['tmdb:movie:1']), 'visto');
});

test('addToLibrary no sobrescribe metadatos existentes y aplica opts sobre la entrada', () => {
  const data = emptyData();
  const fresh = { id: KEY, type: 'series', isAnime: false, names: { es: 'Nuevo', en: 'New' } };
  const first = addToLibrary(data, fresh);
  const second = addToLibrary(first, fresh, { note: 4 });
  assert.equal(second.catalog[KEY], fresh);
  assert.equal(second.library[KEY].note, 4);
});

test('addToLibrary sin id lanza TypeError', () => {
  assert.throws(() => addToLibrary(emptyData(), { type: 'series' }), TypeError);
  assert.throws(() => addToLibrary(emptyData(), null), TypeError);
});

test('toda mutación actualiza meta.updatedAt', () => {
  const data = baseSeries();
  const before = data.meta.updatedAt;
  const next = toggleEpisodeWatched(data, KEY, '1x1', '2025-01-01T00:00:00Z');
  assert.ok(next.meta.updatedAt >= before);
  assert.ok(!Number.isNaN(Date.parse(next.meta.updatedAt)));
});

test('el esqueleto del ticket 06 valida y deriva estados correctos', () => {
  assert.deepEqual(validate(SKELETON), { ok: true });
  const lib = SKELETON.library;
  const cat = SKELETON.catalog;
  assert.equal(seriesState(lib['tmdb:tv:60625'], cat['tmdb:tv:60625'], NOW), 'paraver');
  assert.equal(movieState(lib['tmdb:movie:27205']), 'visto');
  assert.equal(movieState(lib['tmdb:movie:693134']), 'paraver');
  assert.equal(seasonState(lib['tmdb:tv:60625'], cat['tmdb:tv:60625'].seasons[0], NOW), 'paraver');
  const marked = toggleEpisodeWatched(SKELETON, 'tmdb:tv:60625', '1x1', '2026-08-01T12:00:00Z');
  assert.equal(seriesState(marked.library['tmdb:tv:60625'], cat['tmdb:tv:60625'], NOW), 'visto');
});

test('validate acepta ficheros sin review ni settings', () => {
  const data = structuredClone(SKELETON);
  delete data.review;
  delete data.settings;
  assert.deepEqual(validate(data), { ok: true });
  assert.deepEqual(validate(emptyData()), { ok: true });
});

test('validate rechaza versión futura', () => {
  const data = structuredClone(SKELETON);
  data.meta.version = 2;
  const result = validate(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('no soportado')));
});

test('validate rechaza formas corruptas', () => {
  const cases = [
    { input: null, match: 'objeto JSON' },
    { input: [], match: 'objeto JSON' },
    { input: 'texto', match: 'objeto JSON' },
    { input: {}, match: 'meta' },
    { input: { meta: { version: 1 }, catalog: { foo: SKELETON.catalog['tmdb:tv:60625'] }, library: {} }, match: 'clave no canónica' },
    { input: { meta: { version: 1 }, catalog: { 'tmdb:tv:1': { type: 'film', isAnime: false, names: { es: 'x' } } }, library: {} }, match: 'type inválido' },
    { input: { meta: { version: 1 }, catalog: { 'tmdb:tv:1': { type: 'series', isAnime: false } }, library: {} }, match: 'names' },
    { input: { meta: { version: 1 }, catalog: { 'tmdb:tv:1': { type: 'series', isAnime: false, names: { es: 'x' } } }, library: {} }, match: 'seasons' },
    { input: { meta: { version: 1 }, catalog: {}, library: { foo: {} } }, match: 'clave no canónica' },
    { input: { meta: { version: 1 }, catalog: {}, library: { 'tmdb:tv:1': { watched: ['ayer'] } } }, match: 'timestamp inválido' },
    { input: { meta: { version: 1 }, catalog: {}, library: { 'tmdb:tv:1': { note: 9 } } }, match: 'nota inválida' },
    { input: { meta: { version: 1 }, catalog: {}, library: { 'tmdb:tv:1': { watched: ['2025-01-01T00:00:00Z'], episodes: {} } } }, match: 'watched y episodes' },
    { input: { meta: { version: 1 }, catalog: {}, library: { 'tmdb:tv:1': { raro: 1 } } }, match: 'campo desconocido' },
    { input: { meta: { version: 1 }, catalog: {}, library: { 'tmdb:tv:1': { episodes: { x5: { watched: [] } } } } }, match: 'clave de episodio inválida' },
    { input: { meta: { version: 1 }, catalog: {}, library: { 'tmdb:tv:1': { episodes: { '1x1': { nota: 3 } } } } }, match: 'campo desconocido' },
    { input: { meta: { version: 1 }, catalog: {}, library: { 'tmdb:tv:1': { episodes: { '1x1': { note: 4.5 } } } } }, match: 'nota inválida' },
    { input: { meta: { version: 1 }, catalog: {}, library: { 'tmdb:tv:1': { origin: { matchedName: 'x' } } } }, match: 'origin.source' },
    { input: { meta: { version: 1, updatedAt: '2026-01-01T00:00:00Z' }, catalog: { 'tmdb:movie:1': { type: 'movie', isAnime: false, names: { es: 'x' } } }, library: { 'tmdb:movie:1': { episodes: { '1x1': { watched: [] } } } } }, match: 'no debe tener episodes' },
    { input: { meta: { version: 1 }, catalog: { 'tmdb:tv:1': { type: 'series', isAnime: false, names: { es: 'x' }, seasons: [{ n: 1, episodes: [{ n: 1, airDate: 'no-una-fecha' }] }] } }, library: {} }, match: 'airDate inválido' },
    { input: { meta: { version: 1 }, catalog: {}, library: {}, review: {} }, match: 'review' },
    { input: { meta: { version: 1 }, catalog: {}, library: {}, settings: [] }, match: 'settings' },
  ];
  for (const { input, match } of cases) {
    const result = validate(input);
    assert.equal(result.ok, false, `debería fallar: ${match}`);
    assert.ok(result.errors.some((e) => e.includes(match)), `error esperado que contenga "${match}", hay: ${JSON.stringify(result.errors)}`);
  }
});

test('normalize rellena los campos opcionales sin mutar la entrada', () => {
  const raw = {
    meta: { version: 1, updatedAt: '2026-01-01T00:00:00Z' },
    catalog: {
      'tmdb:tv:1': {
        type: 'series',
        names: { es: 'Solo es' },
        seasons: [{ n: 1, episodes: [{ n: 1 }] }],
      },
    },
    library: {
      'tmdb:tv:1': { episodes: { '1x1': {} } },
      'tmdb:movie:1': { note: 4 },
    },
  };
  const before = structuredClone(raw);
  const normalized = normalize(raw);
  assert.deepEqual(raw, before);
  const entry = normalized.catalog['tmdb:tv:1'];
  assert.equal(entry.isAnime, false);
  assert.equal(entry.anilistId, null);
  assert.equal(entry.names.en, null);
  assert.equal(entry.names.romaji, null);
  assert.equal(entry.names.native, null);
  assert.equal(entry.synopsis, null);
  assert.equal(entry.poster, null);
  assert.equal(entry.backdrop, null);
  assert.equal(entry.releaseDate, null);
  assert.equal(entry.status, null);
  assert.deepEqual(entry.genres, []);
  assert.equal(entry.voteAverage, null);
  assert.equal(entry.fetchedAt, null);
  assert.deepEqual(entry.seasons[0].episodes[0], { n: 1, name: null, airDate: null, runtime: null });
  assert.deepEqual(normalized.library['tmdb:tv:1'].episodes['1x1'], { watched: [] });
  assert.deepEqual(normalized.library['tmdb:movie:1'], { note: 4 });
  assert.deepEqual(normalized.review, []);
  assert.deepEqual(normalized.settings, {});
});

test('normalize conserva los valores presentes', () => {
  const normalized = normalize(SKELETON);
  assert.equal(normalized.catalog['tmdb:tv:60625'].anilistId, 20954);
  assert.equal(normalized.catalog['tmdb:tv:60625'].voteAverage, 8.7);
  assert.equal(normalized.library['tmdb:tv:60625'].episodes['2x5'].watched.length, 2);
});

test('serialize exporta pretty-printed y hace round-trip UTF-8', () => {
  const text = serialize(SKELETON);
  assert.ok(text.startsWith('{\n  "meta"'));
  assert.ok(text.includes('\n  "catalog"'));
  assert.deepEqual(JSON.parse(text), SKELETON);
  const dir = mkdtempSync(path.join(tmpdir(), 'model-'));
  try {
    const file = path.join(dir, 'tvtime-data.json');
    writeFileSync(file, text, 'utf8');
    const readBack = readFileSync(file, 'utf8');
    assert.ok(!readBack.startsWith('\uFEFF'));
    assert.ok(readBack.includes('…'));
    assert.deepEqual(JSON.parse(readBack), SKELETON);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('smoke: el esqueleto del ticket 06 (desde el md) valida y deriva estados', () => {
  const issuePath = fileURLToPath(new URL('../.scratch/tvtime-substitute/issues/06-grilling-data-model.md', import.meta.url));
  const text = readFileSync(issuePath, 'utf8');
  const match = text.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(match, 'bloque json del esqueleto no encontrado en el md');
  const skeleton = JSON.parse(match[1]);
  assert.deepEqual(validate(skeleton), { ok: true });
  const lib = skeleton.library;
  const cat = skeleton.catalog;
  assert.equal(seriesState(lib['tmdb:tv:60625'], cat['tmdb:tv:60625'], NOW), 'paraver');
  assert.equal(movieState(lib['tmdb:movie:27205']), 'visto');
  assert.equal(movieState(lib['tmdb:movie:693134']), 'paraver');
  assert.equal(rewatchCount(lib['tmdb:tv:60625'].episodes['2x5']), 1);
  const marked = toggleEpisodeWatched(skeleton, 'tmdb:tv:60625', '1x1', '2026-08-01T12:00:00Z');
  assert.equal(seriesState(marked.library['tmdb:tv:60625'], cat['tmdb:tv:60625'], NOW), 'visto');
});
