import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildUrl,
  appendCallback,
  browserJsonp,
  _setTransport,
  _fetchJsonp,
  search,
  getSeries,
  getMovie,
  discover,
  mapSearchResult,
} from './tmdb.js';

function installFakeDom({ fire } = {}) {
  const win = {};
  const scripts = [];
  const doc = {
    createElement: () => {
      const script = { src: '', parentNode: null };
      scripts.push(script);
      return script;
    },
    head: {
      appendChild: (script) => {
        script.parentNode = doc.head;
        if (fire) {
          const cb = new URL(script.src).searchParams.get('callback');
          fire(win, cb);
        }
      },
      removeChild: (script) => {
        script.parentNode = null;
      },
    },
  };
  win.document = doc;
  globalThis.window = win;
  globalThis.document = doc;
  return { win, doc, scripts };
}

function restoreDom() {
  delete globalThis.window;
  delete globalThis.document;
}

test('buildUrl incluye api_key y language', () => {
  const url = new URL(buildUrl('/3/search/tv', { query: 'One Piece', language: 'es', api_key: 'k123' }));
  assert.equal(url.origin + url.pathname, 'https://api.themoviedb.org/3/search/tv');
  assert.equal(url.searchParams.get('query'), 'One Piece');
  assert.equal(url.searchParams.get('language'), 'es');
  assert.equal(url.searchParams.get('api_key'), 'k123');
});

test('buildUrl omite valores vacíos', () => {
  const url = buildUrl('/3/discover/tv', { with_genres: undefined, api_key: 'k' });
  assert.ok(!url.includes('with_genres'));
  assert.ok(url.includes('api_key=k'));
});

test('appendCallback añade el callback al URL', () => {
  const url = new URL(appendCallback('https://api.themoviedb.org/3/search/tv?api_key=k', '__tmdb_cb_7'));
  assert.equal(url.searchParams.get('callback'), '__tmdb_cb_7');
});

test('sin clave -> error NO_KEY sin llamar al transporte', async () => {
  let calls = 0;
  _setTransport(() => {
    calls += 1;
    return Promise.resolve({});
  });
  const cases = [
    search('x', ''),
    search('x', undefined),
    search('x', null),
    getSeries(1, ''),
    getMovie(1, undefined),
    discover({ apiKey: '' }),
  ];
  for (const promise of cases) {
    await assert.rejects(promise, (err) => err && err.code === 'NO_KEY');
  }
  assert.equal(calls, 0);
});

test('search busca tv y movie en es y en, dedupe por id y prefiere es', async () => {
  const calls = [];
  _setTransport((url) => {
    calls.push(url);
    const u = new URL(url);
    const lang = u.searchParams.get('language');
    const path = u.pathname;
    if (path === '/3/search/tv') {
      return Promise.resolve({
        results:
          lang === 'es'
            ? [
                {
                  id: 1,
                  name: 'La Casa de Papel',
                  original_language: 'es',
                  overview: 'Sinopsis es',
                  first_air_date: '2017-05-02',
                  poster_path: '/p1.jpg',
                  backdrop_path: '/b1.jpg',
                  genre_ids: [80, 18],
                  vote_average: 8.2,
                },
              ]
            : [
                {
                  id: 1,
                  name: 'Money Heist',
                  original_language: 'es',
                  overview: 'En synopsis',
                  first_air_date: '2017-05-02',
                  poster_path: '/p1.jpg',
                  backdrop_path: '/b1.jpg',
                  genre_ids: [80, 18],
                  vote_average: 8.2,
                },
              ],
      });
    }
    if (path === '/3/search/movie') {
      return Promise.resolve({
        results:
          lang === 'es'
            ? [
                {
                  id: 1,
                  title: 'Película es',
                  original_title: 'The Movie',
                  original_language: 'en',
                  release_date: '2020-01-01',
                  genre_ids: [28],
                  vote_average: 7,
                },
              ]
            : [],
      });
    }
    return Promise.resolve({ results: [] });
  });

  const results = await search('casa', 'k');
  assert.equal(results.length, 2);
  const series = results.find((r) => r.id === 'tmdb:tv:1');
  assert.equal(series.type, 'series');
  assert.equal(series.names.es, 'La Casa de Papel');
  assert.equal(series.names.en, 'Money Heist');
  assert.equal(series.synopsis, 'Sinopsis es');
  assert.equal(series.releaseDate, '2017-05-02');
  assert.equal(series.isAnime, false);
  assert.deepEqual(series.genres, ['Crimen', 'Drama']);
  assert.equal(series.voteAverage, 8.2);
  assert.equal(series.poster, '/p1.jpg');
  assert.equal(series.status, 'returning');
  assert.deepEqual(series.seasons, []);
  const movie = results.find((r) => r.id === 'tmdb:movie:1');
  assert.equal(movie.names.es, 'Película es');
  assert.equal(movie.names.en, 'Película es');
  assert.equal(movie.releaseDate, '2020-01-01');
  assert.equal(calls.length, 4);
  for (const url of calls) {
    const u = new URL(url);
    assert.equal(u.searchParams.get('api_key'), 'k');
    assert.ok(['es', 'en'].includes(u.searchParams.get('language')));
  }
});

test('search marca anime por idioma ja y por género 16', () => {
  const byLang = mapSearchResult(
    { es: { id: 5, name: 'One Piece', original_language: 'ja', genre_ids: [16, 10759] }, en: null },
    'series'
  );
  assert.equal(byLang.isAnime, true);
  assert.equal(byLang.names.romaji, null);
  assert.equal(byLang.names.native, null);
  const byGenre = mapSearchResult(
    { es: { id: 6, name: 'Avatar', original_language: 'en', genre_ids: [28, 16, 12] }, en: null },
    'movie'
  );
  assert.equal(byGenre.isAnime, true);
});

test('resultado solo en inglés rellena names.es con el título EN', () => {
  const entry = mapSearchResult(
    { es: null, en: { id: 7, name: 'Shogun', original_language: 'en', genre_ids: [] } },
    'series'
  );
  assert.equal(entry.names.es, 'Shogun');
  assert.equal(entry.names.en, 'Shogun');
});

test('getSeries mapea detalle, temporadas (incl. especiales) y episodios', async () => {
  _setTransport((url) => {
    const u = new URL(url);
    const match = u.pathname.match(/^\/3\/tv\/(\d+)(?:\/season\/(\d+))?$/);
    if (!match) return Promise.reject(new Error(`ruta inesperada: ${u.pathname}`));
    const season = match[2];
    if (season === undefined) {
      return Promise.resolve(
        u.searchParams.get('language') === 'es'
          ? {
              id: 999,
              name: 'Bola de Dragón',
              original_name: 'ドラゴンボール',
              original_language: 'ja',
              overview: 'Sinf',
              first_air_date: '1986-02-26',
              status: 'Ended',
              genres: [
                { id: 16, name: 'Animación' },
                { id: 10759, name: 'Acción y aventura' },
              ],
              vote_average: 8.5,
              poster_path: '/poster.jpg',
              backdrop_path: '/back.jpg',
              seasons: [
                { season_number: 0, episode_count: 2 },
                { season_number: 1, episode_count: 3 },
              ],
            }
          : { id: 999, name: 'Dragon Ball' }
      );
    }
    const episodes =
      season === '0'
        ? [
            { episode_number: 1, name: 'Especial 1', air_date: '1986-01-01', runtime: 25 },
            { episode_number: 2, name: 'Especial 2', air_date: null, runtime: null },
          ]
        : [1, 2, 3].map((n) => ({ episode_number: n, name: `Ep ${n}`, air_date: `1986-02-${n}`, runtime: 24 }));
    return Promise.resolve({ season_number: Number(season), episodes });
  });

  const entry = await getSeries(999, 'k');
  assert.equal(entry.id, 'tmdb:tv:999');
  assert.equal(entry.type, 'series');
  assert.equal(entry.isAnime, true);
  assert.equal(entry.names.es, 'Bola de Dragón');
  assert.equal(entry.names.en, 'Dragon Ball');
  assert.equal(entry.names.romaji, null);
  assert.equal(entry.names.native, null);
  assert.equal(entry.synopsis, 'Sinf');
  assert.equal(entry.releaseDate, '1986-02-26');
  assert.equal(entry.status, 'ended');
  assert.equal(entry.voteAverage, 8.5);
  assert.deepEqual(entry.genres, ['Animación', 'Acción y aventura']);
  assert.equal(entry.seasons.length, 2);
  assert.deepEqual(entry.seasons[0], {
    n: 0,
    episodes: [
      { n: 1, name: 'Especial 1', airDate: '1986-01-01', runtime: 25 },
      { n: 2, name: 'Especial 2', airDate: null, runtime: null },
    ],
  });
  assert.deepEqual(entry.seasons[1].episodes[0], { n: 1, name: 'Ep 1', airDate: '1986-02-1', runtime: 24 });
  assert.ok(!Number.isNaN(Date.parse(entry.fetchedAt)));
});

test('getMovie mapea detalle sin temporadas', async () => {
  _setTransport((url) => {
    const u = new URL(url);
    const lang = u.searchParams.get('language');
    return Promise.resolve(
      lang === 'es'
        ? {
            id: 42,
            title: 'El Club de la Lucha',
            original_title: 'Fight Club',
            original_language: 'en',
            overview: 'Sinf película',
            release_date: '1999-10-15',
            status: 'Released',
            genres: [{ id: 18, name: 'Drama' }],
            vote_average: 8.4,
            poster_path: '/fc.jpg',
          }
        : { id: 42, title: 'Fight Club' }
    );
  });
  const entry = await getMovie(42, 'k');
  assert.equal(entry.id, 'tmdb:movie:42');
  assert.equal(entry.type, 'movie');
  assert.equal(entry.names.es, 'El Club de la Lucha');
  assert.equal(entry.names.en, 'Fight Club');
  assert.equal(entry.releaseDate, '1999-10-15');
  assert.equal(entry.status, 'ended');
  assert.deepEqual(entry.genres, ['Drama']);
  assert.ok(!('seasons' in entry));
});

test('detalle inexistente -> NOT_FOUND', async () => {
  _setTransport(() => Promise.resolve({ status_code: 34, status_message: 'The resource you requested could not be found.' }));
  await assert.rejects(getSeries(123, 'k'), (err) => err && err.code === 'NOT_FOUND');
  await assert.rejects(getMovie(123, 'k'), (err) => err && err.code === 'NOT_FOUND');
});

test('discover anime añade with_genres 16 y with_original_language ja', async () => {
  const calls = [];
  _setTransport((url) => {
    calls.push(url);
    return Promise.resolve({
      results: [
        {
          id: 5,
          name: 'One Piece',
          original_language: 'ja',
          first_air_date: '1999-10-20',
          genre_ids: [16, 10759],
          overview: 'Sinf OP',
          poster_path: '/op.jpg',
          vote_average: 8.7,
        },
      ],
    });
  });
  const entries = await discover({ type: 'series', anime: true, apiKey: 'k' });
  const u = new URL(calls[0]);
  assert.equal(u.pathname, '/3/discover/tv');
  assert.equal(u.searchParams.get('sort_by'), 'first_air_date.desc');
  assert.equal(u.searchParams.get('with_genres'), '16');
  assert.equal(u.searchParams.get('with_original_language'), 'ja');
  assert.equal(u.searchParams.get('language'), 'es');
  assert.equal(u.searchParams.get('api_key'), 'k');
  assert.equal(entries[0].isAnime, true);
  assert.equal(entries[0].id, 'tmdb:tv:5');
  assert.equal(entries[0].releaseDate, '1999-10-20');
  assert.equal(entries[0].status, 'returning');
});

test('discover sin anime no añade filtros y usa primary_release_date para películas', async () => {
  const calls = [];
  _setTransport((url) => {
    calls.push(url);
    return Promise.resolve({ results: [] });
  });
  await discover({ type: 'movie', anime: false, apiKey: 'k' });
  const u = new URL(calls[0]);
  assert.equal(u.pathname, '/3/discover/movie');
  assert.equal(u.searchParams.get('sort_by'), 'primary_release_date.desc');
  assert.equal(u.searchParams.has('with_genres'), false);
  assert.equal(u.searchParams.has('with_original_language'), false);
});

test('_fetchJsonp deduplica llamadas concurrentes y limpia al terminar', async () => {
  let calls = 0;
  _setTransport(
    () =>
      new Promise((resolve) =>
        setTimeout(() => {
          calls += 1;
          resolve({ ok: 1 });
        }, 10)
      )
  );
  const params = { query: 'x', language: 'es' };
  const [a, b] = await Promise.all([
    _fetchJsonp('/3/search/tv', params, 'k'),
    _fetchJsonp('/3/search/tv', params, 'k'),
  ]);
  assert.deepEqual(a, { ok: 1 });
  assert.deepEqual(b, { ok: 1 });
  assert.equal(calls, 1);
  await _fetchJsonp('/3/search/tv', params, 'k');
  assert.equal(calls, 2);
});

test('browserJsonp resuelve con el payload del callback y limpia', async () => {
  const { win, doc, scripts } = installFakeDom({
    fire: (w, cb) => w[cb]({ results: [1, 2] }),
  });
  try {
    const promise = browserJsonp('https://api.themoviedb.org/3/search/tv?api_key=k', 1000);
    const script = scripts[0];
    const cb = new URL(script.src).searchParams.get('callback');
    assert.ok(cb.startsWith('__tmdb_cb_'));
    assert.deepEqual(await promise, { results: [1, 2] });
    assert.ok(!(cb in win));
    assert.equal(script.parentNode, null);
  } finally {
    restoreDom();
  }
});

test('browserJsonp ignora invocaciones duplicadas del callback', async () => {
  const { win } = installFakeDom({
    fire: (w, cb) => {
      w[cb]({ v: 1 });
      w[cb]({ v: 2 });
    },
  });
  try {
    const promise = browserJsonp('https://api.themoviedb.org/3/x?api_key=k', 1000);
    assert.deepEqual(await promise, { v: 1 });
  } finally {
    restoreDom();
  }
});

test('browserJsonp con timeout -> error TIMEOUT y limpia', async () => {
  const { win, scripts } = installFakeDom();
  try {
    const promise = browserJsonp('https://api.themoviedb.org/3/x?api_key=k', 25);
    await assert.rejects(promise, (err) => err && err.code === 'TIMEOUT');
    const cb = new URL(scripts[0].src).searchParams.get('callback');
    assert.ok(!(cb in win));
    assert.equal(scripts[0].parentNode, null);
  } finally {
    restoreDom();
  }
});

test('browserJsonp fuera del navegador -> LOAD_ERROR', async () => {
  await assert.rejects(browserJsonp('https://api.themoviedb.org/3/x?api_key=k', 50), (err) => err && err.code === 'LOAD_ERROR');
});
