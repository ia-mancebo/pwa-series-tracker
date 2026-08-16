const ENDPOINT = 'https://graphql.anilist.co';
const TIMEOUT_MS = 15000;
const HEALTH_TIMEOUT_MS = 5000;
const MIN_INTERVAL_MS = 2100;
const MAX_CONCURRENT = 2;
const BATCH_SIZE = 50;
const MAX_RETRIES = 3;
const MAX_RETRY_WAIT_MS = 60000;
const RATE_LIMIT_WINDOW_MS = 60000;

const MEDIA_FIELDS = `
  id
  title { romaji english native }
  synonyms
  description
  coverImage { extraLarge large medium }
  bannerImage
  startDate { year month day }
  seasonYear
  genres
  averageScore
  status
  episodes
  format
  nextAiringEpisode { episode airingAt }
`;

const SEARCH_QUERY = `query ($search: String, $page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    media(search: $search, type: ANIME, isAdult: false) { ${MEDIA_FIELDS} }
  }
}`;

const BY_ID_QUERY = `query ($id: Int) {
  Page(page: 1, perPage: 1) {
    media(id: $id, type: ANIME) { ${MEDIA_FIELDS} }
  }
}`;

const BATCH_QUERY = `query ($ids: [Int]) {
  Page(page: 1, perPage: ${BATCH_SIZE}) {
    media(id_in: $ids, type: ANIME) { ${MEDIA_FIELDS} }
  }
}`;

let intervalMs = MIN_INTERVAL_MS;
let rateLimitWindowMs = RATE_LIMIT_WINDOW_MS;
let lastRequestAt = 0;
let cooldownUntil = 0;
let inFlight = 0;
const waiting = [];

export function _setTimers({ intervalMs: interval, rateLimitWindowMs: window } = {}) {
  intervalMs = Number.isFinite(interval) && interval >= 0 ? interval : MIN_INTERVAL_MS;
  rateLimitWindowMs = Number.isFinite(window) && window >= 0 ? window : RATE_LIMIT_WINDOW_MS;
}

export function _resetThrottle() {
  lastRequestAt = 0;
  cooldownUntil = 0;
}

async function withThrottle(fn) {
  if (inFlight >= MAX_CONCURRENT) {
    await new Promise((resolve) => waiting.push(resolve));
  }
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

async function waitSlot() {
  for (;;) {
    const wait = Math.max(intervalMs - (Date.now() - lastRequestAt), cooldownUntil - Date.now(), 0);
    if (wait <= 0) break;
    await sleep(wait);
  }
  lastRequestAt = Date.now();
}

function errorWithCode(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout(fn, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return Promise.resolve(fn(controller.signal)).finally(() => clearTimeout(timer));
}

async function post(query, variables) {
  return withTimeout(
    (signal) =>
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal,
      }),
    TIMEOUT_MS
  );
}

async function readPayload(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function retryAfterMs(res) {
  const retryAfter = Number(res.headers.get('Retry-After'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_WAIT_MS);
  }
  return rateLimitWindowMs;
}

async function healthCheck() {
  try {
    const res = await withTimeout((signal) => fetch(ENDPOINT, { method: 'OPTIONS', signal }), HEALTH_TIMEOUT_MS);
    return res.headers.get('Access-Control-Allow-Origin') != null;
  } catch {
    return false;
  }
}

async function gql(query, variables) {
  return withThrottle(async () => {
    let attempt = 0;
    for (;;) {
      await waitSlot();
      let res;
      try {
        res = await post(query, variables);
      } catch (cause) {
        if (cause && cause.name === 'AbortError') {
          throw errorWithCode('NETWORK', 'AniList: error de red o tiempo de espera agotado', cause);
        }
        const reachable = await healthCheck();
        throw errorWithCode(
          reachable ? 'UNAVAILABLE' : 'NETWORK',
          reachable
            ? 'AniList está temporalmente no disponible (mantenimiento).'
            : 'AniList: error de red o tiempo de espera agotado',
          cause
        );
      }
      const payload = await readPayload(res);
      if (res.status === 429) {
        cooldownUntil = Math.max(cooldownUntil, Date.now() + retryAfterMs(res));
        if (attempt < MAX_RETRIES) {
          attempt += 1;
          continue;
        }
        const message = (payload?.errors ?? []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
        throw errorWithCode('RATE_LIMIT', `AniList: ${message}`);
      }
      if (payload?.errors?.length) {
        const message = payload.errors.map((e) => e.message).join('; ');
        throw errorWithCode('API', `AniList: ${message}`);
      }
      if (!res.ok) {
        if (res.status >= 500) {
          throw errorWithCode('UNAVAILABLE', 'AniList está temporalmente no disponible (mantenimiento).');
        }
        throw errorWithCode('NETWORK', `AniList: HTTP ${res.status}`);
      }
      return payload;
    }
  });
}

function stripHtml(html) {
  if (!html) return null;
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?»)\]])/g, '$1')
    .trim();
  return text || null;
}

function releaseDate(startDate) {
  if (!startDate?.year) return null;
  const pad = (value) => String(value ?? 1).padStart(2, '0');
  return `${startDate.year}-${pad(startDate.month)}-${pad(startDate.day)}`;
}

function buildSeasons(media, type) {
  if (type !== 'series' || media.episodes == null) return [];
  const next = media.nextAiringEpisode;
  const episodes = [];
  for (let n = 1; n <= media.episodes; n++) {
    episodes.push({
      n,
      name: null,
      airDate:
        next && next.episode === n
          ? new Date(next.airingAt * 1000).toISOString().slice(0, 10)
          : null,
      runtime: null,
    });
  }
  return [{ n: 1, episodes }];
}

export function mapMedia(media) {
  const type = media.format === 'MOVIE' ? 'movie' : 'series';
  return {
    anilistId: media.id,
    type,
    isAnime: true,
    names: {
      es: null,
      en: media.title?.english ?? null,
      romaji: media.title?.romaji ?? null,
      native: media.title?.native ?? null,
    },
    synopsis: stripHtml(media.description),
    poster:
      media.coverImage?.medium || media.coverImage?.large || media.coverImage?.extraLarge || null,
    backdrop: media.bannerImage ?? null,
    releaseDate: releaseDate(media.startDate),
    status: media.status === 'FINISHED' || media.status === 'CANCELLED' ? 'ended' : 'returning',
    genres: media.genres ?? [],
    voteAverage: typeof media.averageScore === 'number' ? media.averageScore / 10 : null,
    seasons: buildSeasons(media, type),
    fetchedAt: new Date().toISOString(),
  };
}

export async function search(query, { page = 1, perPage = 10 } = {}) {
  const payload = await gql(SEARCH_QUERY, { search: query, page, perPage });
  return (payload?.data?.Page?.media ?? []).map(mapMedia);
}

export async function getById(id) {
  const payload = await gql(BY_ID_QUERY, { id });
  const media = payload?.data?.Page?.media?.[0];
  if (!media) {
    throw errorWithCode('API', `AniList: no existe el título ${id}`);
  }
  return mapMedia(media);
}

export async function batchGetByIds(ids) {
  const uniqueIds = [...new Set(ids)].filter((id) => Number.isInteger(id));
  if (!uniqueIds.length) return [];
  const results = [];
  for (let i = 0; i < uniqueIds.length; i += BATCH_SIZE) {
    const chunk = uniqueIds.slice(i, i + BATCH_SIZE);
    const payload = await gql(BATCH_QUERY, { ids: chunk });
    results.push(...(payload?.data?.Page?.media ?? []).map(mapMedia));
  }
  return results;
}
