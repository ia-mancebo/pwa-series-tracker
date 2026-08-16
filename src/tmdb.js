const API_BASE = 'https://api.themoviedb.org/3';
const ES = 'es';
const EN = 'en';
const DEFAULT_TIMEOUT_MS = 10000;

const GENRE_NAMES = {
  28: 'Acción',
  12: 'Aventura',
  16: 'Animación',
  35: 'Comedia',
  80: 'Crimen',
  99: 'Documental',
  18: 'Drama',
  10751: 'Familia',
  14: 'Fantasía',
  36: 'Historia',
  27: 'Terror',
  10402: 'Música',
  9648: 'Misterio',
  10749: 'Romance',
  878: 'Ciencia ficción',
  10770: 'Película de TV',
  53: 'Suspense',
  10752: 'Bélica',
  37: 'Western',
  10759: 'Acción y aventura',
  10762: 'Kids',
  10763: 'Noticias',
  10764: 'Reality',
  10765: 'Ciencia ficción y fantasía',
  10766: 'Soap',
  10767: 'Charlas',
  10768: 'Guerra y política',
};

let transport = browserJsonp;
const inFlight = new Map();
let callbackSeq = 0;

export function _setTransport(fn) {
  transport = fn;
}

export function _getTransport() {
  return transport;
}

export function buildUrl(path, params = {}) {
  const url = new URL(path, `${API_BASE}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function appendCallback(url, callbackName) {
  const parsed = new URL(url);
  parsed.searchParams.set('callback', callbackName);
  return parsed.toString();
}

export function _fetchJsonp(path, params, apiKey, timeoutMs = DEFAULT_TIMEOUT_MS) {
  if (!apiKey) return Promise.reject(noKeyError());
  const url = buildUrl(path, { ...params, api_key: apiKey });
  const pending = inFlight.get(url);
  if (pending) return pending;
  const promise = Promise.resolve(transport(url, timeoutMs));
  inFlight.set(url, promise);
  promise.then(
    () => inFlight.delete(url),
    () => inFlight.delete(url)
  );
  return promise;
}

export function browserJsonp(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const win = globalThis.window;
    const doc = globalThis.document;
    if (!win || !doc || typeof doc.createElement !== 'function') {
      reject(apiError('LOAD_ERROR', 'JSONP solo está disponible en el navegador.'));
      return;
    }
    const callbackName = `__tmdb_cb_${++callbackSeq}`;
    const script = doc.createElement('script');
    let settled = false;
    let timer;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete win[callbackName];
      } catch {
        // ignore
      }
      fn(value);
    };
    win[callbackName] = (data) => settle(resolve, data);
    script.async = true;
    script.onerror = () => settle(reject, apiError('LOAD_ERROR', 'No se pudo cargar la respuesta de TMDB.'));
    script.src = appendCallback(url, callbackName);
    (doc.head || doc.documentElement).appendChild(script);
    timer = setTimeout(() => settle(reject, apiError('TIMEOUT', 'Tiempo de espera agotado al contactar con TMDB.')), timeoutMs);
  });
}

export async function search(query, apiKey) {
  const [tvEs, tvEn, movieEs, movieEn] = await Promise.all([
    _fetchJsonp('/3/search/tv', { query, language: ES }, apiKey),
    _fetchJsonp('/3/search/tv', { query, language: EN }, apiKey),
    _fetchJsonp('/3/search/movie', { query, language: ES }, apiKey),
    _fetchJsonp('/3/search/movie', { query, language: EN }, apiKey),
  ]);
  return [
    ...mergeLocalized(tvEs.results || [], tvEn.results || []).map((slot) => mapSearchResult(slot, 'series')),
    ...mergeLocalized(movieEs.results || [], movieEn.results || []).map((slot) => mapSearchResult(slot, 'movie')),
  ];
}

export async function getSeries(id, apiKey) {
  const [es, en] = await Promise.all([
    _fetchJsonp(`/3/tv/${id}`, { language: ES }, apiKey),
    _fetchJsonp(`/3/tv/${id}`, { language: EN }, apiKey),
  ]);
  assertNoError(es, en);
  const seasonNumbers = (es.seasons || [])
    .map((s) => s.season_number)
    .filter((n) => n !== undefined && n !== null);
  const seasonPayloads = await Promise.all(
    seasonNumbers.map((n) => _fetchJsonp(`/3/tv/${id}/season/${n}`, { language: ES }, apiKey))
  );
  return mapSeriesDetail(es, en, seasonPayloads);
}

export async function getMovie(id, apiKey) {
  const [es, en] = await Promise.all([
    _fetchJsonp(`/3/movie/${id}`, { language: ES }, apiKey),
    _fetchJsonp(`/3/movie/${id}`, { language: EN }, apiKey),
  ]);
  assertNoError(es, en);
  return mapMovieDetail(es, en);
}

export async function discover({ type = 'series', anime = false, apiKey } = {}) {
  const isMovie = type === 'movie';
  const params = {
    language: ES,
    sort_by: isMovie ? 'primary_release_date.desc' : 'first_air_date.desc',
  };
  if (anime) {
    params.with_genres = 16;
    params.with_original_language = 'ja';
  }
  const data = await _fetchJsonp(isMovie ? '/3/discover/movie' : '/3/discover/tv', params, apiKey);
  return (data.results || []).map((raw) => mapSearchResult({ es: raw, en: null }, type));
}

export function mapSearchResult(slot, type) {
  const raw = slot.es || slot.en;
  const title = (r) => (r ? (type === 'movie' ? r.title : r.name) : null);
  return {
    id: canonicalId(raw.id, type),
    type,
    isAnime: isAnime(raw),
    names: {
      es: title(slot.es) ?? title(slot.en),
      en: title(slot.en) ?? title(slot.es),
      romaji: null,
      native: null,
    },
    synopsis: (slot.es?.overview ?? slot.en?.overview) || '',
    poster: raw.poster_path ?? null,
    backdrop: raw.backdrop_path ?? null,
    releaseDate: type === 'series' ? (raw.first_air_date ?? null) : (raw.release_date ?? null),
    status: raw.status ? mapStatus(raw.status, type) : 'returning',
    genres: genreNames(raw.genre_ids),
    voteAverage: (slot.es?.vote_average ?? slot.en?.vote_average) ?? null,
    seasons: type === 'series' ? [] : undefined,
    fetchedAt: new Date().toISOString(),
  };
}

export function mapSeriesDetail(es, en, seasonPayloads) {
  const episodesBySeason = new Map();
  for (const payload of seasonPayloads) {
    episodesBySeason.set(payload.season_number, (payload.episodes || []).map(mapEpisode));
  }
  return {
    id: canonicalId(es.id, 'series'),
    type: 'series',
    isAnime: isAnime(es),
    names: {
      es: es.name ?? null,
      en: en?.name ?? null,
      romaji: null,
      native: null,
    },
    synopsis: es.overview || '',
    poster: es.poster_path ?? null,
    backdrop: es.backdrop_path ?? null,
    releaseDate: es.first_air_date ?? null,
    status: mapStatus(es.status, 'series'),
    genres: (es.genres || []).map((g) => g.name),
    voteAverage: es.vote_average ?? null,
    seasons: (es.seasons || [])
      .map((s) => ({ n: s.season_number, episodes: episodesBySeason.get(s.season_number) || [] }))
      .filter((s) => s.n !== undefined && s.n !== null),
    fetchedAt: new Date().toISOString(),
  };
}

export function mapMovieDetail(es, en) {
  return {
    id: canonicalId(es.id, 'movie'),
    type: 'movie',
    isAnime: isAnime(es),
    names: {
      es: es.title ?? null,
      en: en?.title ?? null,
      romaji: null,
      native: null,
    },
    synopsis: es.overview || '',
    poster: es.poster_path ?? null,
    backdrop: es.backdrop_path ?? null,
    releaseDate: es.release_date ?? null,
    status: mapStatus(es.status, 'movie'),
    genres: (es.genres || []).map((g) => g.name),
    voteAverage: es.vote_average ?? null,
    fetchedAt: new Date().toISOString(),
  };
}

function mergeLocalized(esResults, enResults) {
  const byId = new Map();
  for (const raw of esResults) byId.set(raw.id, { es: raw, en: null });
  for (const raw of enResults) {
    const slot = byId.get(raw.id);
    if (slot) slot.en = raw;
    else byId.set(raw.id, { es: null, en: raw });
  }
  return [...byId.values()];
}

function mapEpisode(e) {
  return {
    n: e.episode_number ?? null,
    name: e.name ?? null,
    airDate: e.air_date ?? null,
    runtime: e.runtime ?? null,
  };
}

function canonicalId(id, type) {
  return `${type === 'movie' ? 'tmdb:movie' : 'tmdb:tv'}:${id}`;
}

function isAnime(raw) {
  if (raw.original_language === 'ja') return true;
  if (raw.genres && raw.genres.some((g) => g.id === 16)) return true;
  if (raw.genre_ids && raw.genre_ids.includes(16)) return true;
  return false;
}

function mapStatus(status, type) {
  if (type === 'movie') return status === 'Released' || status === 'Canceled' ? 'ended' : 'returning';
  return status === 'Ended' || status === 'Canceled' ? 'ended' : 'returning';
}

function genreNames(ids) {
  return (ids || []).map((id) => GENRE_NAMES[id]).filter(Boolean);
}

function assertNoError(...payloads) {
  for (const payload of payloads) {
    if (payload && payload.status_code) {
      throw apiError('NOT_FOUND', 'Título no encontrado en TMDB.');
    }
  }
}

function apiError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function noKeyError() {
  return apiError('NO_KEY', 'Sin clave de TMDB: añádela en Ajustes.');
}
