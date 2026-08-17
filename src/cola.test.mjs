import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, validate } from './model.js';
import { ensureEntryId } from './catalog.js';
import {
  buildLibraryEntry,
  discardFromReview,
  resolvePick,
  resolveIntoData,
} from './resolve.js';

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
  const fail = new Set();
  return {
    failOn(key) {
      fail.add(key);
    },
    tmdb: {
      async getSeries(id) {
        const key = `tmdb:tv:${id}`;
        if (fail.has(key)) throw Object.assign(new Error(`no series ${id}`), { code: 'NOT_FOUND' });
        const entry = byKey.get(key);
        if (!entry) throw Object.assign(new Error(`no series ${id}`), { code: 'NOT_FOUND' });
        return entry;
      },
      async getMovie(id) {
        const key = `tmdb:movie:${id}`;
        if (fail.has(key)) throw Object.assign(new Error(`no movie ${id}`), { code: 'NOT_FOUND' });
        const entry = byKey.get(key);
        if (!entry) throw Object.assign(new Error(`no movie ${id}`), { code: 'NOT_FOUND' });
        return entry;
      },
    },
    anilist: {
      async getById(id) {
        const key = `anilist:${id}`;
        if (fail.has(key)) throw Object.assign(new Error(`no anilist ${id}`), { code: 'API' });
        const entry = byKey.get(key);
        if (!entry) throw Object.assign(new Error(`no anilist ${id}`), { code: 'API' });
        return entry;
      },
    },
  };
}

function movieReview(overrides = {}) {
  return {
    id: 'item-1',
    tvtimeName: 'Encanto',
    type: 'pelicula',
    reason: 'empate',
    candidates: [
      { key: 'tmdb:movie:2', name: 'Encanto', year: 2016, poster: null },
      { key: 'tmdb:movie:3', name: 'Encanto', year: 2021, poster: null },
    ],
    raw: { year: 2021, episodes: {}, votes: {}, watched: ['2024-12-31T17:43:10.000Z'], vote: 27 },
    ...overrides,
  };
}

function seriesReview(overrides = {}) {
  return {
    id: 'item-2',
    tvtimeName: 'Half Show',
    type: 'serie',
    reason: 'no-encontrado',
    candidates: [],
    raw: {
      year: 2020,
      episodes: { '1x5': ['2026-06-27T09:43:50.000Z'], '1x6': ['2026-06-28T23:44:40.000Z'] },
      votes: { '1x5': 29, '1x6': 3 },
      watched: [],
      vote: null,
    },
    ...overrides,
  };
}

function seasonReview(overrides = {}) {
  return {
    id: 'item-3-s7',
    tvtimeName: 'The Amazing World of Gumball',
    type: 'temporada',
    reason: 'temporada-sin-resolver',
    candidates: [{ key: 'tmdb:tv:40', name: 'The Amazing World of Gumball', year: 2025, poster: null }],
    raw: { season: 7, episodes: { '7x1': ['2026-01-09T13:46:47.000Z'] }, votes: { '7x1': 3 } },
    ...overrides,
  };
}

test('elegir candidato de película: catálogo + visionados + nota + origin, pendiente borrado', async () => {
  const fetchers = makeFetchers({ details: [tmdbMovie(3, { name: 'Encanto', year: 2021 })] });
  const data = emptyData();
  data.review = [movieReview()];
  const next = await resolvePick(data, data.review[0], data.review[0].candidates[1], {
    tmdbApiKey: 'fake-key',
    fetchers,
    now: NOW,
  });
  assert.ok(next.catalog['tmdb:movie:3']);
  const entry = next.library['tmdb:movie:3'];
  assert.deepEqual(entry.watched, ['2024-12-31T17:43:10.000Z']);
  assert.equal(entry.note, 2);
  assert.equal(entry.origin.source, 'tvtime');
  assert.equal(entry.origin.matchedName, 'Encanto');
  assert.equal(entry.origin.rawVote, 27);
  assert.equal(entry.origin.importedAt, NOW);
  assert.deepEqual(next.review, []);
});

test('candidato AniList: se fija id canónico anilist:{id}', async () => {
  const fetchers = makeFetchers({ details: [anilistEntry(19986, { name: 'Sen to Chihiro no Kamikakushi' })] });
  const review = movieReview({ id: 'item-9', tvtimeName: '千と千尋の神隠し' });
  review.candidates = [{ key: 'anilist:19986', name: 'Sen to Chihiro no Kamikakushi', year: 2001, poster: null }];
  review.raw = { year: 2001, episodes: {}, votes: {}, watched: [], vote: null };
  const data = emptyData();
  data.review = [review];
  const next = await resolvePick(data, review, review.candidates[0], {
    fetchers,
    now: NOW,
  });
  assert.ok(next.catalog['anilist:19986']);
  assert.deepEqual(Object.keys(next.library), ['anilist:19986']);
  assert.equal(next.library['anilist:19986'].origin.source, 'tvtime');
  assert.deepEqual(next.review, []);
});

test('serie: episodios SxE con visionados, notas según escala TVTime, rawVotes en origin y sin nota de título', async () => {
  const fetchers = makeFetchers({ details: [tmdbSeries(30, { name: 'Half Show' })] });
  const review = seriesReview({ candidates: [{ key: 'tmdb:tv:30', name: 'Half Show', year: 2020, poster: null }] });
  const data = emptyData();
  data.review = [review];
  const next = await resolvePick(data, review, review.candidates[0], { fetchers, now: NOW });
  const entry = next.library['tmdb:tv:30'];
  assert.deepEqual(entry.episodes['1x5'].watched, ['2026-06-27T09:43:50.000Z']);
  assert.equal(entry.episodes['1x5'].note, 4);
  assert.equal(entry.episodes['1x6'].note, 5);
  assert.equal(entry.note, undefined, 'TVTime no vota series → nota de serie sin rellenar');
  assert.deepEqual(entry.origin.rawVotes, { '1x5': 29, '1x6': 3 });
  assert.equal(entry.watched, undefined);
  assert.deepEqual(next.review, []);
});

test('temporada: solo esa temporada entra, fusionando con una entrada previa', async () => {
  const fetchers = makeFetchers({
    details: [tmdbSeries(40, { name: 'Gumball 2025', seasons: [{ n: 7, episodes: [] }] })],
  });
  const review = {
    id: 'item-3-s7',
    tvtimeName: 'The Amazing World of Gumball',
    type: 'temporada',
    reason: 'temporada-sin-resolver',
    candidates: [{ key: 'tmdb:tv:40', name: 'The Amazing World of Gumball', year: 2025, poster: null }],
    raw: { season: 7, episodes: { '7x1': ['2026-01-01T10:00:00.000Z'] }, votes: { '7x1': 29 } },
  };
  const data = emptyData();
  data.review = [review];
  data.catalog['tmdb:tv:40'] = tmdbSeries(40, { name: 'Gumball 2025' });
  data.library['tmdb:tv:40'] = {
    episodes: { '7x2': { watched: ['2026-01-02T10:00:00.000Z'] } },
    note: 4,
    origin: { source: 'tvtime', matchedName: 'The Amazing World of Gumball', importedAt: '2026-08-01T00:00:00Z' },
  };
  const next = await resolvePick(data, review, review.candidates[0], { fetchers, now: NOW });
  const entry = next.library['tmdb:tv:40'];
  assert.deepEqual(Object.keys(entry.episodes).sort(), ['7x1', '7x2']);
  assert.deepEqual(entry.episodes['7x1'].watched, ['2026-01-01T10:00:00.000Z']);
  assert.equal(entry.episodes['7x1'].note, 4, 'la nota de capítulo se mapea desde el voto crudo');
  assert.deepEqual(entry.episodes['7x2'].watched, ['2026-01-02T10:00:00.000Z']);
  assert.equal(entry.note, 4, 'la nota previa se conserva; no se recalcula desde los capítulos fusionados');
  assert.equal(entry.origin.importedAt, '2026-08-01T00:00:00Z', 'el origin previo se conserva');
  assert.deepEqual(next.review, []);
});

test('temporada con remapeo: las claves SxE se re-numeran a la temporada elegida del catálogo', async () => {
  const fetchers = makeFetchers({
    details: [tmdbSeries(40, { name: 'Gumball 2025', seasons: [{ n: 1, episodes: [] }, { n: 2, episodes: [] }] })],
  });
  const review = seasonReview({
    candidates: [{ key: 'tmdb:tv:40', name: 'The Wonderfully Weird World of Gumball', year: 2025, poster: null }],
    raw: {
      season: 7,
      episodes: { '7x1': ['2026-01-09T13:46:47.000Z'], '7x22': ['2026-02-19T13:56:26.000Z'] },
      votes: { '7x22': 29 },
    },
  });
  const data = emptyData();
  data.review = [review];
  const next = await resolvePick(data, review, review.candidates[0], { fetchers, now: NOW, season: 1 });
  const entry = next.library['tmdb:tv:40'];
  assert.deepEqual(Object.keys(entry.episodes).sort(), ['1x1', '1x22']);
  assert.deepEqual(entry.episodes['1x1'].watched, ['2026-01-09T13:46:47.000Z']);
  assert.equal(entry.episodes['1x22'].note, 4, 'la nota de capítulo se remapea con la clave');
  assert.deepEqual(entry.origin.rawVotes, { '1x22': 29 });
  assert.deepEqual(next.review, []);
});

test('US10: al fusionar un remapeo que colisiona, la nota de episodio previa se conserva y los visionados se unen', async () => {
  const fetchers = makeFetchers({
    details: [tmdbSeries(40, { name: 'Gumball 2025', seasons: [{ n: 1, episodes: [] }, { n: 2, episodes: [] }] })],
  });
  const review = {
    id: 'item-3-s7',
    tvtimeName: 'The Amazing World of Gumball',
    type: 'temporada',
    reason: 'temporada-sin-resolver',
    candidates: [{ key: 'tmdb:tv:40', name: 'The Amazing World of Gumball', year: 2025, poster: null }],
    raw: { season: 1, episodes: { '1x1': ['2026-01-09T13:46:47.000Z'] }, votes: { '1x1': 29 } },
  };
  const data = emptyData();
  data.review = [review];
  data.catalog['tmdb:tv:40'] = tmdbSeries(40, { name: 'Gumball 2025' });
  data.library['tmdb:tv:40'] = {
    episodes: { '1x1': { watched: ['2026-01-02T10:00:00.000Z'], note: 3 } },
    origin: { source: 'tvtime', matchedName: 'The Amazing World of Gumball', importedAt: '2026-08-01T00:00:00Z' },
  };
  const next = await resolvePick(data, review, review.candidates[0], { fetchers, now: NOW, season: 1 });
  const entry = next.library['tmdb:tv:40'];
  assert.equal(entry.episodes['1x1'].note, 3, 'la nota previa del episodio se conserva');
  assert.deepEqual(
    entry.episodes['1x1'].watched.slice().sort(),
    ['2026-01-02T10:00:00.000Z', '2026-01-09T13:46:47.000Z'],
    'los visionados se unen y deduplican'
  );
  assert.deepEqual(next.review, []);
});

test('US12: tras resolver una temporada con remapeo, el fichero de datos sigue validando', async () => {
  const fetchers = makeFetchers({
    details: [tmdbSeries(40, { name: 'Gumball 2025', seasons: [{ n: 1, episodes: [] }, { n: 2, episodes: [] }] })],
  });
  const review = seasonReview();
  const data = emptyData();
  data.review = [review];
  const next = await resolvePick(data, review, review.candidates[0], { fetchers, now: NOW, season: 1 });
  assert.equal(validate(next).ok, true);
  assert.deepEqual(Object.keys(next.library['tmdb:tv:40'].episodes), ['1x1']);
  assert.deepEqual(next.review, []);
});

test('buildLibraryEntry: remapeo de temporada re-numera claves y votos', () => {
  const review = seasonReview({ candidates: [] });
  const entry = buildLibraryEntry(review, NOW, { season: 1 });
  assert.deepEqual(Object.keys(entry.episodes), ['1x1']);
  assert.equal(entry.episodes['1x1'].note, 5);
  assert.deepEqual(entry.origin.rawVotes, { '1x1': 3 });
  assert.equal(entry.origin.matchedName, 'The Amazing World of Gumball');
  assert.equal(entry.origin.importedAt, NOW);
});

test('buildLibraryEntry: sin season indicada, las claves SxE de la temporada se guardan tal cual', () => {
  const review = seasonReview({
    candidates: [],
    raw: { season: 7, episodes: { '7x1': ['2026-01-09T13:46:47.000Z'] }, votes: {} },
  });
  const entry = buildLibraryEntry(review, NOW);
  assert.deepEqual(Object.keys(entry.episodes), ['7x1']);
  assert.deepEqual(entry.episodes['7x1'].watched, ['2026-01-09T13:46:47.000Z']);
});

test('entrada de catálogo ya existente no se sobrescribe al resolver', async () => {
  const fetchers = makeFetchers({ details: [tmdbMovie(3, { name: 'Encanto', year: 2021, poster: '/x.jpg' })] });
  const data = emptyData();
  data.review = [movieReview()];
  data.catalog['tmdb:movie:3'] = tmdbMovie(3, { name: 'Encanto', year: 2021 });
  data.catalog['tmdb:movie:3'].synopsis = 'ya presente';
  const next = await resolvePick(data, data.review[0], data.review[0].candidates[1], { fetchers, now: NOW });
  assert.equal(next.catalog['tmdb:movie:3'].synopsis, 'ya presente');
  assert.equal(next.catalog['tmdb:movie:3'].poster, null);
});

test('descartar borra solo el pendiente elegido', () => {
  const data = emptyData();
  const keep = seriesReview({ id: 'item-8' });
  const drop = movieReview({ id: 'item-1' });
  data.review = [keep, drop];
  const next = discardFromReview(data, 'item-1', { now: NOW });
  assert.deepEqual(next.review.map((r) => r.id), ['item-8']);
  assert.equal(next.meta.updatedAt, NOW);
});

test('detalle no disponible → resolvePick devuelve null y no toca los datos', async () => {
  const fetchers = makeFetchers({ details: [] });
  fetchers.failOn('tmdb:movie:3');
  const data = emptyData();
  data.review = [movieReview()];
  const next = await resolvePick(data, data.review[0], data.review[0].candidates[1], { fetchers, now: NOW });
  assert.equal(next, null);
  assert.deepEqual(data.review.length, 1);
});

test('resolvePick: onEntry que devuelve true intercepta y no resuelve', async () => {
  const fetchers = makeFetchers({ details: [tmdbSeries(30, { name: 'Half Show' })] });
  const review = seriesReview({ candidates: [{ key: 'tmdb:tv:30', name: 'Half Show', year: 2020, poster: null }] });
  const data = emptyData();
  data.review = [review];
  const seen = [];
  const next = await resolvePick(data, review, review.candidates[0], {
    fetchers,
    now: NOW,
    onEntry: (entry) => {
      seen.push(entry);
      return true;
    },
  });
  assert.equal(next, data, 'la misma referencia de data, sin resolver');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].id, 'tmdb:tv:30', 'el hook recibe la entrada del catálogo con id canónico');
  assert.deepEqual(data.review.length, 1, 'el pendiente sigue en la cola');
  assert.deepEqual(Object.keys(data.library), [], 'no se crea entrada de biblioteca');
});

test('resolvePick: onEntry que devuelve false deja resolver con normalidad', async () => {
  const fetchers = makeFetchers({ details: [tmdbSeries(30, { name: 'Half Show' })] });
  const review = seriesReview({ candidates: [{ key: 'tmdb:tv:30', name: 'Half Show', year: 2020, poster: null }] });
  const data = emptyData();
  data.review = [review];
  const next = await resolvePick(data, review, review.candidates[0], {
    fetchers,
    now: NOW,
    onEntry: () => false,
  });
  assert.ok(next !== data, 'resuelve igual que sin hook');
  assert.ok(next.library['tmdb:tv:30']);
  assert.deepEqual(next.review, []);
});

test('buildLibraryEntry: película sin visionados queda { origin } y voto no reconocido no fija nota', () => {
  const entry = buildLibraryEntry(movieReview({ raw: { year: 2021, episodes: {}, votes: {}, watched: [], vote: 0 } }), NOW);
  assert.deepEqual(Object.keys(entry).sort(), ['origin']);
  assert.equal(entry.note, undefined);
  assert.equal(entry.watched, undefined);
  assert.equal(entry.origin.rawVote, 0, 'el crudo se conserva aunque no mapee a nota');
});

test('buildLibraryEntry: serie solo-seguida (sin episodios) queda { origin }', () => {
  const review = seriesReview({
    raw: { year: 2020, episodes: {}, votes: {}, watched: [], vote: null },
  });
  const entry = buildLibraryEntry(review, NOW);
  assert.deepEqual(entry, { origin: { source: 'tvtime', matchedName: 'Half Show', importedAt: NOW } });
});

test('buildLibraryEntry: la nota de título de una serie no se deriva de sus notas de capítulo', () => {
  const review = seriesReview({
    raw: {
      year: 2020,
      episodes: { '1x5': ['2026-06-27T09:43:50.000Z'], '1x6': ['2026-06-28T23:44:40.000Z'] },
      votes: { '1x5': 29, '1x6': 3 },
      watched: [],
      vote: null,
    },
  });
  const entry = buildLibraryEntry(review, NOW);
  assert.equal(entry.episodes['1x5'].note, 4);
  assert.equal(entry.episodes['1x6'].note, 5);
  assert.equal(entry.note, undefined, 'TVTime no vota series → nota de serie sin rellenar');
  assert.deepEqual(entry.origin.rawVotes, { '1x5': 29, '1x6': 3 });
});

test('ensureEntryId fija id para entradas solo-AniList y respeta las ya canónicas', () => {
  assert.equal(ensureEntryId({ anilistId: 5 }).id, 'anilist:5');
  assert.equal(ensureEntryId({ id: 'tmdb:tv:1' }).id, 'tmdb:tv:1');
  assert.equal(ensureEntryId({ anilistId: 5, id: 'tmdb:tv:2' }).id, 'tmdb:tv:2');
  assert.deepEqual(ensureEntryId({}), {});
});

test('resolver película no seguida: limpia followed:false y conserva visionado, nota y origin', async () => {
  const fetchers = makeFetchers({ details: [tmdbMovie(3, { name: 'Encanto', year: 2021 })] });
  const review = movieReview({ raw: { year: 2021, episodes: {}, votes: {}, watched: [], vote: 27 } });
  const data = emptyData();
  data.review = [review];
  data.catalog['tmdb:movie:3'] = tmdbMovie(3, { name: 'Encanto', year: 2021 });
  data.library['tmdb:movie:3'] = {
    watched: ['2023-01-01T10:00:00.000Z'],
    note: 5,
    origin: { source: 'tvtime', matchedName: 'Encanto', importedAt: '2026-08-01T00:00:00Z' },
    followed: false,
  };
  const next = await resolvePick(data, review, review.candidates[1], { fetchers, now: NOW });
  const entry = next.library['tmdb:movie:3'];
  assert.equal(entry.followed, undefined, 're-sigue: sin clave followed');
  assert.deepEqual(entry.watched, ['2023-01-01T10:00:00.000Z'], 'el visionado previo se conserva');
  assert.equal(entry.note, 5, 'la nota previa se conserva');
  assert.equal(entry.origin.importedAt, '2026-08-01T00:00:00Z', 'el origin previo se conserva');
  assert.deepEqual(next.review, []);
});

test('resolver serie no seguida: fusiona episodios y limpia followed:false', async () => {
  const fetchers = makeFetchers({ details: [tmdbSeries(30, { name: 'Half Show' })] });
  const review = seriesReview({ candidates: [{ key: 'tmdb:tv:30', name: 'Half Show', year: 2020, poster: null }] });
  const data = emptyData();
  data.review = [review];
  data.catalog['tmdb:tv:30'] = tmdbSeries(30, { name: 'Half Show' });
  data.library['tmdb:tv:30'] = {
    episodes: { '1x2': { watched: ['2026-01-02T10:00:00.000Z'] } },
    note: 4,
    origin: { source: 'tvtime', matchedName: 'Half Show', importedAt: '2026-08-01T00:00:00Z' },
    followed: false,
  };
  const next = await resolvePick(data, review, review.candidates[0], { fetchers, now: NOW });
  const entry = next.library['tmdb:tv:30'];
  assert.equal(entry.followed, undefined, 're-sigue: sin clave followed');
  assert.deepEqual(Object.keys(entry.episodes).sort(), ['1x2', '1x5', '1x6']);
  assert.deepEqual(entry.episodes['1x2'].watched, ['2026-01-02T10:00:00.000Z'], 'el episodio previo se conserva');
  assert.deepEqual(entry.episodes['1x5'].watched, ['2026-06-27T09:43:50.000Z']);
  assert.equal(entry.episodes['1x5'].note, 4);
  assert.equal(entry.note, 4, 'la nota previa se conserva');
  assert.equal(entry.origin.importedAt, '2026-08-01T00:00:00Z', 'el origin previo se conserva');
  assert.deepEqual(next.review, []);
});

test('resolver sobre entrada ya seguida (sin clave followed) no altera el merge', async () => {
  const fetchers = makeFetchers({ details: [tmdbMovie(3, { name: 'Encanto', year: 2021 })] });
  const data = emptyData();
  data.review = [movieReview()];
  data.catalog['tmdb:movie:3'] = tmdbMovie(3, { name: 'Encanto', year: 2021 });
  data.library['tmdb:movie:3'] = {
    watched: ['2023-01-01T10:00:00.000Z'],
    note: 3,
    origin: { source: 'tvtime', matchedName: 'Encanto', importedAt: '2026-08-01T00:00:00Z' },
  };
  const next = await resolvePick(data, data.review[0], data.review[0].candidates[1], { fetchers, now: NOW });
  const entry = next.library['tmdb:movie:3'];
  assert.equal(entry.followed, undefined, 'sigue sin clave followed');
  assert.equal(entry.note, 3);
  assert.deepEqual(next.review, []);
});

test('resolveIntoData marca updatedAt con el now proporcionado', () => {
  const fetchers = makeFetchers({ details: [tmdbMovie(3, { name: 'Encanto' })] });
  const data = emptyData();
  data.review = [movieReview()];
  return resolvePick(data, data.review[0], data.review[0].candidates[1], { fetchers, now: NOW }).then((next) => {
    assert.equal(next.meta.updatedAt, NOW);
    assert.ok(next.meta.version === 1);
  });
});

test('pick de búsqueda manual de película resuelve igual que un candidato', async () => {
  const fetchers = makeFetchers({ details: [tmdbMovie(3, { name: 'Encanto', year: 2021 })] });
  const data = emptyData();
  data.review = [movieReview()];
  const next = await resolvePick(data, data.review[0], { key: 'tmdb:movie:3' }, {
    tmdbApiKey: 'fake-key',
    fetchers,
    now: NOW,
  });
  assert.ok(next.catalog['tmdb:movie:3']);
  const entry = next.library['tmdb:movie:3'];
  assert.deepEqual(entry.watched, ['2024-12-31T17:43:10.000Z']);
  assert.equal(entry.note, 2);
  assert.equal(entry.origin.source, 'tvtime');
  assert.equal(entry.origin.matchedName, 'Encanto');
  assert.equal(entry.origin.rawVote, 27);
  assert.equal(entry.origin.importedAt, NOW);
  assert.deepEqual(next.review, []);
});

test('pendiente sin candidatos resuelto por búsqueda manual', async () => {
  const fetchers = makeFetchers({ details: [tmdbSeries(30, { name: 'Half Show' })] });
  const review = seriesReview();
  const data = emptyData();
  data.review = [review];
  const next = await resolvePick(data, review, { key: 'tmdb:tv:30' }, { fetchers, now: NOW });
  const entry = next.library['tmdb:tv:30'];
  assert.deepEqual(entry.episodes['1x5'].watched, ['2026-06-27T09:43:50.000Z']);
  assert.equal(entry.episodes['1x5'].note, 4);
  assert.equal(entry.episodes['1x6'].note, 5);
  assert.deepEqual(entry.origin.rawVotes, { '1x5': 29, '1x6': 3 });
  assert.deepEqual(next.review, []);
});

test('remapeo de temporada disparado por un pick manual', async () => {
  const fetchers = makeFetchers({
    details: [tmdbSeries(40, { name: 'Gumball 2025', seasons: [{ n: 1, episodes: [] }, { n: 2, episodes: [] }] })],
  });
  const data = emptyData();
  data.review = [seasonReview()];
  const next = await resolvePick(data, data.review[0], { key: 'tmdb:tv:40' }, { fetchers, now: NOW, season: 1 });
  const entry = next.library['tmdb:tv:40'];
  assert.deepEqual(Object.keys(entry.episodes), ['1x1']);
  assert.deepEqual(entry.episodes['1x1'].watched, ['2026-01-09T13:46:47.000Z']);
  assert.equal(entry.episodes['1x1'].note, 5);
  assert.deepEqual(entry.origin.rawVotes, { '1x1': 3 });
  assert.deepEqual(next.review, []);
});

test('fallo de detalle con pick manual → null sin tocar los datos', async () => {
  const fetchers = makeFetchers({ details: [] });
  fetchers.failOn('tmdb:movie:3');
  const data = emptyData();
  data.review = [movieReview()];
  const next = await resolvePick(data, data.review[0], { key: 'tmdb:movie:3' }, { fetchers, now: NOW });
  assert.equal(next, null);
  assert.equal(data.review.length, 1);
});

test('onEntry recibe el pick (candidato o manual)', async () => {
  const fetchers = makeFetchers({ details: [tmdbSeries(30, { name: 'Half Show' })] });
  const review = seriesReview();
  const data = emptyData();
  data.review = [review];
  const pick = { key: 'tmdb:tv:30' };
  const seen = [];
  const next = await resolvePick(data, review, pick, {
    fetchers,
    now: NOW,
    onEntry: (entry, receivedPick) => {
      seen.push(receivedPick);
      return true;
    },
  });
  assert.equal(next, data);
  assert.equal(seen.length, 1);
  assert.equal(seen[0], pick);
});
