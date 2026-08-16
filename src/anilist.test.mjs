import test from 'node:test';
import assert from 'node:assert/strict';
import { search, getById, batchGetByIds, mapMedia, _setTimers, _resetThrottle } from './anilist.js';

const originalFetch = globalThis.fetch;

function media(overrides = {}) {
  return {
    id: 1,
    title: { romaji: 'Jujutsu Kaisen', english: 'Jujutsu Kaisen', native: '呪術廻戦' },
    synonyms: [],
    description: null,
    coverImage: { extraLarge: 'https://x/extra.jpg', large: 'https://x/large.jpg', medium: 'https://x/medium.jpg' },
    bannerImage: null,
    startDate: null,
    seasonYear: 2020,
    genres: [],
    averageScore: null,
    status: 'FINISHED',
    episodes: 24,
    format: 'TV',
    nextAiringEpisode: null,
    ...overrides,
  };
}

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

function mockFetch(handler, t) {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options, at: Date.now() });
    return handler(url, options, calls.length - 1);
  };
  t.after(() => {
    if (globalThis.fetch !== originalFetch) globalThis.fetch = originalFetch;
  });
  return calls;
}

function pagePayload(items) {
  return { data: { Page: { media: items } } };
}

test('mapMedia: type series para formatos no MOVIE', () => {
  for (const format of ['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL', 'MUSIC']) {
    assert.equal(mapMedia(media({ format })).type, 'series', format);
  }
});

test('mapMedia: MOVIE → movie', () => {
  assert.equal(mapMedia(media({ format: 'MOVIE' })).type, 'movie');
});

test('mapMedia: status FINISHED/CANCELLED → ended', () => {
  assert.equal(mapMedia(media({ status: 'FINISHED' })).status, 'ended');
  assert.equal(mapMedia(media({ status: 'CANCELLED' })).status, 'ended');
});

test('mapMedia: resto de status → returning', () => {
  for (const status of ['RELEASING', 'NOT_YET_RELEASED', 'HIATUS', null, undefined]) {
    assert.equal(mapMedia(media({ status })).status, 'returning', String(status));
  }
});

test('mapMedia: names romaji/english/native y es null', () => {
  const mapped = mapMedia(media());
  assert.deepEqual(mapped.names, {
    es: null,
    en: 'Jujutsu Kaisen',
    romaji: 'Jujutsu Kaisen',
    native: '呪術廻戦',
  });
  assert.equal(mapMedia(media({ title: { romaji: 'A', english: null, native: null } })).names.en, null);
});

test('mapMedia: parrilla de episodios con airDate solo del próximo emitido', () => {
  const airingAt = Date.UTC(2020, 9, 3, 12, 0, 0) / 1000;
  const mapped = mapMedia(media({ episodes: 24, nextAiringEpisode: { episode: 13, airingAt } }));
  assert.equal(mapped.seasons.length, 1);
  assert.equal(mapped.seasons[0].n, 1);
  assert.equal(mapped.seasons[0].episodes.length, 24);
  const ep13 = mapped.seasons[0].episodes[12];
  assert.deepEqual(ep13, { n: 13, name: null, airDate: '2020-10-03', runtime: null });
  assert.equal(mapped.seasons[0].episodes[0].airDate, null);
  assert.equal(mapped.seasons[0].episodes[23].airDate, null);
  assert.equal(mapped.seasons[0].episodes[11].name, null);
});

test('mapMedia: episodes null → sin temporadas', () => {
  assert.deepEqual(mapMedia(media({ episodes: null })).seasons, []);
  assert.deepEqual(mapMedia(media({ episodes: undefined })).seasons, []);
});

test('mapMedia: película sin temporadas', () => {
  assert.deepEqual(mapMedia(media({ format: 'MOVIE', episodes: 1 })).seasons, []);
});

test('mapMedia: synopsis sin HTML ni entidades', () => {
  const description =
    '<p>Y\u016bji es un chico <i>fuerte</i>.<br>Segunda l\u00ednea: "A &amp; B &lt; 3".</p>';
  const mapped = mapMedia(media({ description }));
  assert.equal(mapped.synopsis, 'Yūji es un chico fuerte. Segunda línea: "A & B < 3".');
  assert.equal(mapMedia(media({ description: null })).synopsis, null);
});

test('mapMedia: releaseDate yyyy-mm-dd con relleno', () => {
  assert.equal(mapMedia(media({ startDate: { year: 2020, month: 10, day: 3 } })).releaseDate, '2020-10-03');
  assert.equal(mapMedia(media({ startDate: { year: 2020, month: 10, day: null } })).releaseDate, '2020-10-01');
  assert.equal(mapMedia(media({ startDate: { year: 2020, month: null, day: null } })).releaseDate, '2020-01-01');
  assert.equal(mapMedia(media({ startDate: null })).releaseDate, null);
});

test('mapMedia: voteAverage y géneros', () => {
  assert.equal(mapMedia(media({ averageScore: 86, genres: ['Action', 'Comedy'] })).voteAverage, 8.6);
  assert.deepEqual(mapMedia(media({ averageScore: 86, genres: ['Action'] })).genres, ['Action']);
  assert.equal(mapMedia(media({ averageScore: null })).voteAverage, null);
  assert.deepEqual(mapMedia(media({ genres: null })).genres, []);
});

test('mapMedia: póster medium con fallback, backdrop banner', () => {
  const mapped = mapMedia(media({ bannerImage: 'https://x/banner.jpg' }));
  assert.equal(mapped.poster, 'https://x/medium.jpg');
  assert.equal(mapped.backdrop, 'https://x/banner.jpg');
  assert.equal(mapMedia(media({ coverImage: { extraLarge: 'https://x/e.jpg' } })).poster, 'https://x/e.jpg');
  assert.equal(mapMedia(media({ coverImage: null, bannerImage: null })).poster, null);
  assert.equal(mapMedia(media({ coverImage: null })).backdrop, null);
});

test('mapMedia: anilistId, isAnime, fetchedAt', () => {
  const mapped = mapMedia(media());
  assert.equal(mapped.anilistId, 1);
  assert.equal(mapped.isAnime, true);
  assert.ok(!Number.isNaN(Date.parse(mapped.fetchedAt)));
});

test('search: POST a graphql.anilist.co con query y variables, mapeo de lista', async (t) => {
  const calls = mockFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.query.includes('Page'), true);
    assert.equal(body.query.includes('media(search: $search'), true);
    assert.deepEqual(body.variables, { search: 'jujutsu', page: 1, perPage: 10 });
    return jsonResponse(pagePayload([media({ id: 16498 }), media({ id: 21, format: 'MOVIE' })]));
  }, t);
  const results = await search('jujutsu');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://graphql.anilist.co');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(results.length, 2);
  assert.equal(results[0].anilistId, 16498);
  assert.equal(results[1].type, 'movie');
});

test('search: responde vacío sin resultados', async (t) => {
  mockFetch(async () => jsonResponse(pagePayload([])), t);
  assert.deepEqual(await search('xyz-inexistente'), []);
});

test('gql: errores GraphQL → Error code API', async (t) => {
  mockFetch(async () => jsonResponse({ errors: [{ message: 'Something went wrong' }] }, false, 400), t);
  await assert.rejects(() => search('jujutsu'), (error) => {
    assert.equal(error.code, 'API');
    assert.match(error.message, /Something went wrong/);
    return true;
  });
});

test('gql: fallo de red → Error code NETWORK', async (t) => {
  mockFetch(async () => {
    throw new TypeError('fetch failed');
  }, t);
  await assert.rejects(() => search('jujutsu'), (error) => {
    assert.equal(error.code, 'NETWORK');
    return true;
  });
});

test('gql: timeout → Error code NETWORK', async (t) => {
  mockFetch(async (_url, options) => {
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  }, t);
  await assert.rejects(() => search('jujutsu'), (error) => {
    assert.equal(error.code, 'NETWORK');
    return true;
  });
});

function fastTimers(t) {
  _resetThrottle();
  _setTimers({ intervalMs: 10, rateLimitWindowMs: 50 });
  t.after(() => {
    _setTimers({});
    _resetThrottle();
  });
}

test('gql: 429 sin Retry-After útil espera la ventana de 60 s antes de reintentar', async (t) => {
  fastTimers(t);
  const calls = mockFetch(async (_url, options) => {
    if (calls.length === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => null },
        json: async () => ({ errors: [{ message: 'Too Many Requests.', status: 429 }] }),
      };
    }
    return jsonResponse(pagePayload([media({ id: 1 })]));
  }, t);
  const results = await search('jujutsu');
  assert.equal(calls.length, 2);
  assert.equal(results.length, 1);
  const wait = calls[1].at - calls[0].at;
  assert.ok(wait >= 50, `reintento tras la ventana de 60 s: ${wait}ms`);
});

test('gql: 429 con Retry-After positivo espera ese tiempo y reintenta con éxito', async (t) => {
  const calls = mockFetch(async (_url, options) => {
    if (calls.length === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: (name) => (name === 'Retry-After' ? '1' : null) },
        json: async () => ({ errors: [{ message: 'Too Many Requests.', status: 429 }] }),
      };
    }
    return jsonResponse(pagePayload([media({ id: 1 })]));
  }, t);
  const results = await search('jujutsu');
  assert.equal(calls.length, 2);
  assert.equal(results.length, 1);
  const wait = calls[1].at - calls[0].at;
  assert.ok(wait >= 900, `espera por Retry-After de 1s: ${wait}ms`);
  assert.ok(wait < 60000, `espera acotada por MAX_RETRY_WAIT_MS: ${wait}ms`);
});

test('gql: 429 agota reintentos → Error code RATE_LIMIT', async (t) => {
  fastTimers(t);
  const calls = mockFetch(async () => ({
    ok: false,
    status: 429,
    headers: { get: () => null },
    json: async () => ({ errors: [{ message: 'Too Many Requests.', status: 429 }] }),
  }), t);
  await assert.rejects(() => search('jujutsu'), (error) => {
    assert.equal(error.code, 'RATE_LIMIT');
    assert.match(error.message, /Too Many Requests/);
    return true;
  });
  assert.equal(calls.length, 4);
});

test('gql: un 429 enfría la cola — ninguna petición sale durante la ventana', async (t) => {
  fastTimers(t);
  let seq = 0;
  const calls = mockFetch(async (_url, options) => {
    seq += 1;
    if (seq === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => null },
        json: async () => ({ errors: [{ message: 'Too Many Requests.', status: 429 }] }),
      };
    }
    return jsonResponse(pagePayload([media({ id: seq })]));
  }, t);
  const [ra, rb] = await Promise.all([search('a'), search('b')]);
  assert.equal(calls.length, 3);
  assert.equal(ra.length, 1);
  assert.equal(rb.length, 1);
  const first429 = calls[0].at;
  assert.ok(calls[1].at - first429 >= 50, `reintento de a tras la ventana: ${calls[1].at - first429}ms`);
  assert.ok(calls[2].at - first429 >= 50, `b no sale durante la ventana: ${calls[2].at - first429}ms`);
});

test('gql: fallo de red con health check OK → Error code UNAVAILABLE', async (t) => {
  const calls = mockFetch(async (_url, options) => {
    if (options.method === 'POST') throw new TypeError('Failed to fetch');
    return {
      ok: true,
      status: 204,
      headers: { get: (name) => (name === 'Access-Control-Allow-Origin' ? '*' : null) },
      json: async () => null,
    };
  }, t);
  await assert.rejects(() => search('jujutsu'), (error) => {
    assert.equal(error.code, 'UNAVAILABLE');
    return true;
  });
  assert.equal(calls.length, 2);
});

test('gql: HTTP 503 (mantenimiento) → Error code UNAVAILABLE', async (t) => {
  const calls = mockFetch(async () => ({
    ok: false,
    status: 503,
    headers: { get: () => null },
    json: async () => null,
  }), t);
  await assert.rejects(() => search('jujutsu'), (error) => {
    assert.equal(error.code, 'UNAVAILABLE');
    assert.match(error.message, /mantenimiento/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('gql: fallo de red con health check caído → Error code NETWORK', async (t) => {
  const calls = mockFetch(async () => {
    throw new TypeError('Failed to fetch');
  }, t);
  await assert.rejects(() => search('jujutsu'), (error) => {
    assert.equal(error.code, 'NETWORK');
    return true;
  });
  assert.equal(calls.length, 2);
});

test('batchGetByIds: una petición con id_in', async (t) => {
  const calls = mockFetch(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.query.includes('id_in: $ids'), true);
    assert.equal(body.query.includes('perPage: 50'), true);
    return jsonResponse(pagePayload([media({ id: 1 }), media({ id: 2 })]));
  }, t);
  const results = await batchGetByIds([1, 2, 2, 1, 3]);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].options.body).variables, { ids: [1, 2, 3] });
  assert.equal(results.length, 2);
});

test('batchGetByIds: trocea en lotes de 50', async (t) => {
  const calls = mockFetch(async (_url, options) => {
    const { variables } = JSON.parse(options.body);
    return jsonResponse(pagePayload(variables.ids.map((id) => media({ id }))));
  }, t);
  const ids = Array.from({ length: 120 }, (_, i) => i + 1);
  const results = await batchGetByIds(ids);
  assert.equal(calls.length, 3);
  assert.deepEqual(JSON.parse(calls[0].options.body).variables.ids, ids.slice(0, 50));
  assert.deepEqual(JSON.parse(calls[1].options.body).variables.ids, ids.slice(50, 100));
  assert.deepEqual(JSON.parse(calls[2].options.body).variables.ids, ids.slice(100));
  assert.equal(results.length, 120);
});

test('batchGetByIds: vacío no hace peticiones', async (t) => {
  const calls = mockFetch(async () => jsonResponse(pagePayload([])), t);
  assert.deepEqual(await batchGetByIds([]), []);
  assert.equal(calls.length, 0);
});

test('getById: devuelve el título o error API si no existe', async (t) => {
  mockFetch(async (_url, options) => {
    const { variables } = JSON.parse(options.body);
    return jsonResponse(pagePayload(variables.id === 16498 ? [media({ id: 16498 })] : []));
  }, t);
  const result = await getById(16498);
  assert.equal(result.anilistId, 16498);
  await assert.rejects(() => getById(999999), (error) => {
    assert.equal(error.code, 'API');
    return true;
  });
});

test('throttle: min 2100 ms entre inicios y máx 2 concurrentes', async (t) => {
  let inFlight = 0;
  let maxInFlight = 0;
  const starts = [];
  mockFetch(async () => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    starts.push(Date.now());
    await new Promise((resolve) => setTimeout(resolve, 30));
    inFlight--;
    return jsonResponse(pagePayload([]));
  }, t);
  await Promise.all([search('a'), search('b'), search('c'), search('d')]);
  assert.equal(starts.length, 4);
  assert.ok(maxInFlight <= 2, `máx concurrentes: ${maxInFlight}`);
  assert.ok(starts[2] - starts[0] >= 2099, `ola 2 vs 1: ${starts[2] - starts[0]}ms`);
  assert.ok(starts[3] - starts[1] >= 2099, `ola 2 vs 1: ${starts[3] - starts[1]}ms`);
});

test('smoke: API real de AniList (se salta sin red)', async (t) => {
  const probe = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ Page { media(search: "jujutsu", type: ANIME) { id title { romaji } } } }' }),
  }).catch(() => null);
  if (!probe || !probe.ok) {
    t.skip('sin conexión a graphql.anilist.co');
    return;
  }
  const results = await search('jujutsu');
  assert.ok(results.length >= 1);
  assert.equal(results[0].isAnime, true);
  assert.equal(results[0].names.romaji.toLowerCase().includes('jujutsu'), true);
  assert.equal(typeof results[0].anilistId, 'number');
  const detail = await getById(results[0].anilistId);
  assert.equal(detail.anilistId, results[0].anilistId);
  const batch = await batchGetByIds(results.slice(0, 3).map((r) => r.anilistId));
  assert.equal(batch.length, results.slice(0, 3).length);
});
