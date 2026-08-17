import * as tmdb from './tmdb.js';
import * as anilist from './anilist.js';

export function normalizeName(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function searchKey(query) {
  return `search:${normalizeName(query)}`;
}

export function namesMatch(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const short = na.length <= nb.length ? na : nb;
  const long = na.length <= nb.length ? nb : na;
  return short.length >= 4 && long.includes(short);
}

export function entryKey(entry) {
  if (entry && typeof entry.id === 'string') return entry.id;
  if (entry && entry.anilistId != null) return `anilist:${entry.anilistId}`;
  return null;
}

export function toResult(entry) {
  const names = (entry && entry.names) || {};
  const name = names.es || names.en || names.romaji || names.native || '';
  const altNames = [names.en, names.romaji, names.native].filter(
    (n) => n && n !== name
  );
  const year = entry && entry.releaseDate ? String(entry.releaseDate).slice(0, 4) : null;
  return {
    key: entryKey(entry),
    entry,
    type: entry ? entry.type : undefined,
    isAnime: entry ? entry.isAnime === true : false,
    name,
    altNames: [...new Set(altNames)],
    year,
    poster: entry && entry.poster ? entry.poster : null,
  };
}

export function posterUrl(poster, size = 'w342') {
  if (!poster) return null;
  return poster.startsWith('/') ? `https://image.tmdb.org/t/p/${size}${poster}` : poster;
}

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

export function resultRowHtml(result) {
  const poster = posterUrl(result.poster);
  const meta = [
    result.year,
    result.type === 'movie' ? 'película' : 'serie',
    result.isAnime ? 'anime' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <li class="sr-row" data-key="${esc(result.key)}">
      <img class="sr-poster" src="${poster ? esc(poster) : ''}" alt="" loading="lazy">
      <div class="sr-info">
        <div class="sr-name">${esc(result.name)}</div>
        ${result.altNames.length ? `<div class="sr-alt">${esc(result.altNames.join(' · '))}</div>` : ''}
        <div class="sr-meta">${esc(meta)}</div>
      </div>
    </li>`;
}

export function mergeResults(tmdbResults, anilistResults, { degraded = false } = {}) {
  const anilistByNorm = new Map();
  for (const entry of anilistResults) {
    const names = (entry && entry.names) || {};
    for (const n of [names.romaji, names.en, names.native]) {
      const norm = normalizeName(n);
      if (norm) anilistByNorm.set(norm, entry);
    }
  }
  const merged = [];
  const seen = new Set();
  const push = (entry) => {
    const key = entryKey(entry);
    if (key) {
      if (seen.has(key)) return;
      seen.add(key);
    }
    merged.push(entry);
  };
  for (const entry of tmdbResults) {
    let base = entry;
    if (entry && (entry.isAnime === true || entry.names?.romaji || entry.names?.native)) {
      const names = entry.names || {};
      const query = normalizeName(names.es) || normalizeName(names.en);
      let anilistEntry = null;
      if (query) {
        anilistEntry = anilistByNorm.get(query) || null;
        if (!anilistEntry) {
          for (const [norm, candidate] of anilistByNorm) {
            if (namesMatch(query, norm)) {
              anilistEntry = candidate;
              break;
            }
          }
        }
      }
      if (anilistEntry) {
        base = {
          ...entry,
          anilistId: anilistEntry.anilistId,
          names: {
            ...entry.names,
            romaji: entry.names.romaji ?? anilistEntry.names?.romaji ?? null,
            native: entry.names.native ?? anilistEntry.names?.native ?? null,
          },
        };
      }
    }
    push(base);
  }
  for (const entry of anilistResults) push(entry);
  return { results: merged.map(toResult), degraded };
}

function anilistWarning(error) {
  if (error && error.code === 'UNAVAILABLE') {
    return error.message || 'AniList está temporalmente no disponible (mantenimiento).';
  }
  if (error && error.code === 'RATE_LIMIT') {
    return 'AniList ha alcanzado su límite de peticiones. Espera un momento y vuelve a intentarlo.';
  }
  return 'AniList no disponible — solo TMDB';
}

export async function searchAll(query, { tmdbApiKey, searchCache } = {}) {
  const cache = searchCache || { get: async () => null, set: async () => {} };
  const warnings = [];
  let degraded = !tmdbApiKey;
  if (degraded) warnings.push('sin clave TMDB — solo AniList');
  let tmdbResults = [];
  if (tmdbApiKey) {
    try {
      tmdbResults = await tmdb.search(query, tmdbApiKey);
    } catch (error) {
      if (error && error.code === 'NO_KEY') {
        degraded = true;
        warnings.push('sin clave TMDB — solo AniList');
      } else {
        throw error;
      }
    }
  }
  let anilistResults = [];
  let anilistOk = false;
  let fromCache = false;
  try {
    anilistResults = await anilist.search(query, { perPage: 10 });
    anilistOk = true;
  } catch (error) {
    degraded = true;
    let cached = null;
    try {
      cached = await cache.get(searchKey(query));
    } catch {
      cached = null;
    }
    const codeSpecific =
      error && (error.code === 'UNAVAILABLE' || error.code === 'RATE_LIMIT');
    if (cached && Array.isArray(cached.anilistResults) && cached.anilistResults.length) {
      anilistResults = cached.anilistResults;
      fromCache = true;
      if (codeSpecific) warnings.push(anilistWarning(error));
      warnings.push('AniList no disponible — mostrando anime de la caché');
    } else {
      warnings.push(anilistWarning(error));
    }
  }
  if (anilistOk) {
    cache.set(searchKey(query), { anilistResults }).catch(() => {});
  }
  return { ...mergeResults(tmdbResults, anilistResults, { degraded }), warnings, fromCache };
}
