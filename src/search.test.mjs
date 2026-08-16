import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, namesMatch, entryKey, toResult, mergeResults, searchAll, searchKey, posterUrl } from '../src/search.js';
import { _setTransport } from '../src/tmdb.js';

function tmdbSearchResult(overrides = {}) {
  return {
    id: 'tmdb:tv:1',
    type: 'series',
    isAnime: false,
    names: { es: 'Una serie', en: 'A Series', romaji: null, native: null },
    synopsis: '',
    poster: '/poster.jpg',
    backdrop: null,
    releaseDate: '2015-01-01',
    status: 'returning',
    genres: [],
    voteAverage: null,
    seasons: [],
    fetchedAt: '2026-08-14T00:00:00Z',
    ...overrides,
  };
}

function anilistSearchResult(overrides = {}) {
  return {
    anilistId: 100,
    type: 'series',
    isAnime: true,
    names: { es: null, en: 'An Anime', romaji: 'An Anime', native: 'アニメ' },
    synopsis: '',
    poster: 'https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b100.jpg',
    backdrop: null,
    releaseDate: '2020-01-01',
    status: 'returning',
    genres: [],
    voteAverage: null,
    seasons: [],
    fetchedAt: '2026-08-14T00:00:00Z',
    ...overrides,
  };
}

test('normalizeName: minúsculas, sin tildes, espacios unificados', () => {
  assert.equal(normalizeName('  Rick y  Morty  '), 'rick y morty');
  assert.equal(normalizeName('GÁMBITO'), 'gambito');
  assert.equal(normalizeName(''), '');
});

test('namesMatch: exacto y contenedor', () => {
  assert.equal(namesMatch('Rick y Morty', 'rick y morty'), true);
  assert.equal(namesMatch('One Piece', 'One Piece: Film Red'), true);
  assert.equal(namesMatch('El Padrino', 'El Señor de los Anillos'), false);
});

test('entryKey: tmdb usa id, anilist usa anilist:', () => {
  assert.equal(entryKey(tmdbSearchResult()), 'tmdb:tv:1');
  assert.equal(entryKey(anilistSearchResult()), 'anilist:100');
});

test('toResult: nombre es || en || romaji, año y póster', () => {
  const result = toResult(anilistSearchResult());
  assert.equal(result.name, 'An Anime');
  assert.equal(result.altNames.includes('アニメ'), true);
  assert.equal(result.year, '2020');
  assert.equal(result.isAnime, true);
  assert.equal(result.key, 'anilist:100');
});

test('posterUrl: path relativo a image.tmdb.org, URL absoluta intacta', () => {
  assert.equal(posterUrl('/abc.jpg'), 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.equal(posterUrl('https://s4.anilist.co/x.jpg'), 'https://s4.anilist.co/x.jpg');
  assert.equal(posterUrl(null), null);
});

test('mergeResults: dedupe por clave canónica', () => {
  const merged = mergeResults(
    [tmdbSearchResult()],
    [anilistSearchResult(), { ...anilistSearchResult(), anilistId: 101 }]
  );
  assert.equal(merged.results.length, 3);
});

test('mergeResults: anime TMDB se cruza con AniList por nombre', () => {
  const tmdbAnime = tmdbSearchResult({
    id: 'tmdb:tv:5',
    isAnime: true,
    names: { es: 'Jujutsu Kaisen', en: 'Jujutsu Kaisen', romaji: null, native: null },
  });
  const anilist = anilistSearchResult({
    anilistId: 113415,
    names: { es: null, en: 'Jujutsu Kaisen', romaji: 'Jujutsu Kaisen', native: '呪術廻戦' },
  });
  const merged = mergeResults([tmdbAnime], [anilist]);
  const [result] = merged.results;
  assert.equal(result.key, 'tmdb:tv:5');
  assert.equal(result.entry.anilistId, 113415);
  assert.equal(result.entry.names.romaji, 'Jujutsu Kaisen');
  assert.equal(result.entry.names.native, '呪術廻戦');
});

test('mergeResults: sin coincidencia de nombre no se cruza', () => {
  const tmdbAnime = tmdbSearchResult({
    id: 'tmdb:tv:7',
    isAnime: true,
    names: { es: 'Algo distinto', en: 'Something Else', romaji: null, native: null },
  });
  const merged = mergeResults([tmdbAnime], [anilistSearchResult()]);
  assert.equal(merged.results[0].entry.anilistId, undefined);
  assert.equal(merged.results.length, 2);
});

test('mergeResults: flag degraded se propaga', () => {
  const merged = mergeResults([], [], { degraded: true });
  assert.equal(merged.degraded, true);
});

test('searchAll: sin clave → degraded, solo AniList', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { Page: { media: [] } } }),
  });
  try {
    const { results, degraded } = await searchAll('naruto');
    assert.equal(degraded, true);
    assert.equal(results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchAll: con clave busca TMDB y AniList', async () => {
  _setTransport(async (url) => {
    if (url.includes('search/tv')) return { results: [{ id: 1, name: 'Naruto', first_air_date: '2002-10-03', original_language: 'ja', genre_ids: [16] }] };
    if (url.includes('search/movie')) return { results: [] };
    throw new Error('no esperado');
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        Page: {
          media: [
            {
              id: 20,
              title: { romaji: 'Naruto', english: 'Naruto', native: 'ナルト' },
              description: '',
              coverImage: { medium: 'https://x/n.jpg' },
              bannerImage: null,
              startDate: { year: 2002, month: 10, day: 3 },
              genres: [],
              averageScore: 50,
              status: 'FINISHED',
              episodes: 220,
              format: 'TV',
            },
          ],
        },
      },
    }),
  });
  try {
    const { results, degraded } = await searchAll('naruto', { tmdbApiKey: 'dev-key' });
    assert.equal(degraded, false);
    const tmdbHits = results.filter((r) => r.key.startsWith('tmdb:'));
    const anilistHits = results.filter((r) => r.key.startsWith('anilist:'));
    assert.equal(tmdbHits.length, 1);
    assert.equal(anilistHits.length, 1);
    const merged = tmdbHits.find((r) => r.entry.anilistId === 20);
    assert.equal(merged?.entry?.names?.romaji, 'Naruto');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchAll: NO_KEY de TMDB no aborta, degrada', async () => {
  _setTransport(async () => {
    const error = new Error('sin clave');
    error.code = 'NO_KEY';
    throw error;
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { Page: { media: [] } } }),
  });
  try {
    const { degraded, results } = await searchAll('x', { tmdbApiKey: 'bad' });
    assert.equal(degraded, true);
    assert.equal(results.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchAll: fallo de AniList degrada y conserva TMDB con aviso', async () => {
  _setTransport(async (url) => {
    if (url.includes('search/tv')) return { results: [{ id: 1, name: 'Naruto', first_air_date: '2002-10-03', original_language: 'ja', genre_ids: [16] }] };
    if (url.includes('search/movie')) return { results: [] };
    throw new Error('no esperado');
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  try {
    const { results, degraded, warnings } = await searchAll('naruto', { tmdbApiKey: 'dev-key' });
    assert.equal(degraded, true);
    assert.equal(results.length, 1);
    assert.ok(results[0].key.startsWith('tmdb:'));
    assert.ok(warnings.some((w) => w.includes('AniList')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchAll: AniList UNAVAILABLE → aviso de mantenimiento y TMDB conservado', async () => {
  _setTransport(async (url) => {
    if (url.includes('search/tv')) return { results: [{ id: 1, name: 'Naruto', first_air_date: '2002-10-03', original_language: 'ja', genre_ids: [16] }] };
    if (url.includes('search/movie')) return { results: [] };
    throw new Error('no esperado');
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (options && options.method === 'OPTIONS') {
      return {
        ok: true,
        status: 204,
        headers: { get: (n) => (n === 'Access-Control-Allow-Origin' ? '*' : null) },
        json: async () => null,
      };
    }
    throw new TypeError('Failed to fetch');
  };
  try {
    const { results, degraded, warnings } = await searchAll('naruto', { tmdbApiKey: 'dev-key' });
    assert.equal(degraded, true);
    assert.ok(results.length >= 1);
    assert.ok(results[0].key.startsWith('tmdb:'));
    assert.ok(warnings.some((w) => /mantenimiento/.test(w)));
    assert.ok(!warnings.some((w) => w === 'AniList no disponible — solo TMDB'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchAll: AniList RATE_LIMIT → aviso de límite de peticiones y TMDB conservado', async () => {
  _setTransport(async (url) => {
    if (url.includes('search/tv')) return { results: [{ id: 1, name: 'Naruto', first_air_date: '2002-10-03', original_language: 'ja', genre_ids: [16] }] };
    if (url.includes('search/movie')) return { results: [] };
    throw new Error('no esperado');
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    headers: { get: (n) => (n === 'Retry-After' ? '1' : null) },
    json: async () => ({ errors: [{ message: 'Too Many Requests.' }] }),
  });
  try {
    const { results, degraded, warnings } = await searchAll('naruto', { tmdbApiKey: 'dev-key' });
    assert.equal(degraded, true);
    assert.ok(results.length >= 1);
    assert.ok(results[0].key.startsWith('tmdb:'));
    assert.ok(warnings.some((w) => /límite de peticiones/.test(w)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchKey: clave normalizada con prefijo search:', () => {
  assert.equal(searchKey('  Naruto  '), 'search:naruto');
});

test('searchAll: AniList caído + TMDB vivo + caché prefilled → mezcla y aviso de caché', async () => {
  _setTransport(async (url) => {
    if (url.includes('search/tv')) return { results: [{ id: 1, name: 'Naruto', first_air_date: '2002-10-03', original_language: 'ja', genre_ids: [16] }] };
    if (url.includes('search/movie')) return { results: [] };
    throw new Error('no esperado');
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const cache = {
    get: async (key) => {
      assert.equal(key, 'search:naruto');
      return { anilistResults: [anilistSearchResult()] };
    },
    set: async () => {},
  };
  try {
    const { results, degraded, warnings } = await searchAll('naruto', {
      tmdbApiKey: 'dev-key',
      searchCache: cache,
    });
    assert.equal(degraded, true);
    assert.equal(results.length, 2);
    assert.ok(results.some((r) => r.key.startsWith('tmdb:')));
    assert.ok(results.some((r) => r.key.startsWith('anilist:')));
    assert.ok(warnings.some((w) => w.includes('caché')));
    assert.ok(!warnings.some((w) => w.includes('solo TMDB')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchAll: avisos obsoletos de una entrada cacheada no se reemiten', async () => {
  _setTransport(async (url) => {
    if (url.includes('search/tv')) return { results: [] };
    if (url.includes('search/movie')) return { results: [] };
    throw new Error('no esperado');
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const cache = {
    get: async () => ({ anilistResults: [anilistSearchResult()], warnings: ['avisos obsoletos'] }),
    set: async () => {},
  };
  try {
    const { results, warnings } = await searchAll('naruto', {
      tmdbApiKey: 'dev-key',
      searchCache: cache,
    });
    assert.equal(results.length, 1);
    assert.ok(!warnings.some((w) => w.includes('avisos obsoletos')));
    assert.ok(warnings.some((w) => w.includes('caché')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchAll: fallo de caché en caída de AniList → degrada con aviso existente', async () => {
  _setTransport(async (url) => {
    if (url.includes('search/tv')) return { results: [{ id: 1, name: 'Naruto', first_air_date: '2002-10-03', original_language: 'ja', genre_ids: [16] }] };
    if (url.includes('search/movie')) return { results: [] };
    throw new Error('no esperado');
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const cache = {
    get: async () => null,
    set: async () => {},
  };
  try {
    const { results, degraded, warnings } = await searchAll('naruto', {
      tmdbApiKey: 'dev-key',
      searchCache: cache,
    });
    assert.equal(degraded, true);
    assert.equal(results.length, 1);
    assert.ok(results[0].key.startsWith('tmdb:'));
    assert.ok(warnings.some((w) => w === 'AniList no disponible — solo TMDB'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('searchAll: éxito persiste solo anilistResults en la caché', async () => {
  _setTransport(async (url) => {
    if (url.includes('search/tv')) return { results: [] };
    if (url.includes('search/movie')) return { results: [] };
    throw new Error('no esperado');
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      data: {
        Page: {
          media: [
            {
              id: 20,
              title: { romaji: 'Naruto', english: 'Naruto', native: 'ナルト' },
              description: '',
              coverImage: { medium: 'https://x/n.jpg' },
              bannerImage: null,
              startDate: { year: 2002, month: 10, day: 3 },
              genres: [],
              averageScore: 50,
              status: 'FINISHED',
              episodes: 220,
              format: 'TV',
            },
          ],
        },
      },
    }),
  });
  const stored = {};
  const cache = {
    get: async () => null,
    set: async (key, value) => {
      stored[key] = value;
    },
  };
  try {
    const { results } = await searchAll('naruto', { tmdbApiKey: 'dev-key', searchCache: cache });
    assert.equal(results.length, 1);
    assert.deepEqual(stored, {
      'search:naruto': { anilistResults: results.map((r) => r.entry) },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
