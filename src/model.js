export const DATA_FILE_NAME = 'tvtime-data.json';
export const CURRENT_VERSION = 1;

const CANONICAL_KEY = /^(tmdb:tv:\d+|tmdb:movie:\d+|anilist:\d+)$/;
const SXE_KEY = /^\d+x\d+$/;
const LIBRARY_FIELDS = new Set(['watched', 'episodes', 'note', 'followed', 'origin']);
const EPISODE_FIELDS = new Set(['watched', 'note']);

export function emptyData() {
  return {
    meta: { version: CURRENT_VERSION, updatedAt: new Date().toISOString() },
    catalog: {},
    library: {},
    review: [],
    settings: {},
  };
}

export function episodeKey(seasonN, episodeN) {
  return `${String(seasonN).toLowerCase()}x${String(episodeN).toLowerCase()}`;
}

function today(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function isAired(episode, now) {
  if (!episode || typeof episode.airDate !== 'string' || episode.airDate === '') return false;
  return !Number.isNaN(Date.parse(episode.airDate)) && episode.airDate <= today(now);
}

export function seriesState(libraryEntry, catalogEntry, now = new Date()) {
  if (!catalogEntry || catalogEntry.type !== 'series') return 'paraver';
  const episodes = libraryEntry && libraryEntry.episodes ? libraryEntry.episodes : {};
  let aired = 0;
  let watched = 0;
  for (const season of catalogEntry.seasons || []) {
    if (Number(season.n) === 0) continue;
    for (const ep of season.episodes || []) {
      if (!isAired(ep, now)) continue;
      aired += 1;
      const marks = episodes[episodeKey(season.n, ep.n)];
      if (marks && Array.isArray(marks.watched) && marks.watched.length > 0) watched += 1;
    }
  }
  if (aired === 0) return 'paraver';
  if (watched === aired) return 'visto';
  if (watched > 0) return 'viendo';
  return 'paraver';
}

export function seasonState(libraryEntry, season, now = new Date()) {
  const aired = (season && season.episodes ? season.episodes : []).filter((ep) => isAired(ep, now));
  if (aired.length === 0) return 'paraver';
  const episodes = libraryEntry && libraryEntry.episodes ? libraryEntry.episodes : {};
  let watched = 0;
  for (const ep of aired) {
    const marks = episodes[episodeKey(season.n, ep.n)];
    if (marks && Array.isArray(marks.watched) && marks.watched.length > 0) watched += 1;
  }
  if (watched === aired.length) return 'visto';
  if (watched > 0) return 'viendo';
  return 'paraver';
}

export function movieState(libraryEntry) {
  if (libraryEntry && Array.isArray(libraryEntry.watched) && libraryEntry.watched.length > 0) return 'visto';
  return 'paraver';
}

export function rewatchCount(entry) {
  const watched = entry && Array.isArray(entry.watched) ? entry.watched : [];
  return Math.max(0, watched.length - 1);
}

function checkNote(note) {
  if (note !== null && (!Number.isInteger(note) || note < 1 || note > 5)) {
    throw new RangeError(`nota fuera de rango 1-5: ${note}`);
  }
}

function ensureSeriesEntry(raw) {
  if (raw && raw.episodes && typeof raw.episodes === 'object' && !Array.isArray(raw.episodes)) return raw;
  return { episodes: {} };
}

function withLibraryEntry(data, key, updater, now) {
  const library = { ...data.library };
  const next = updater(library[key]);
  if (next !== undefined) library[key] = next;
  return { ...data, meta: { ...data.meta, updatedAt: now.toISOString() }, library };
}

export function toggleEpisodeWatched(data, key, sxE, timestampIso, watchedFlag) {
  const now = new Date();
  const ts = timestampIso || now.toISOString();
  return withLibraryEntry(
    data,
    key,
    (raw) => {
      const entry = ensureSeriesEntry(raw);
      const episodes = { ...entry.episodes };
      const current = episodes[sxE] || { watched: [] };
      const watched = Array.isArray(current.watched) ? current.watched : [];
      let next;
      if (watchedFlag === undefined) next = watched.length === 0 ? [ts] : [];
      else if (watchedFlag) next = watched.length === 0 ? [ts] : watched;
      else next = [];
      const base = { ...current, watched: next };
      if (next.length === 0) delete base.watched;
      if (Object.keys(base).length === 0) delete episodes[sxE];
      else episodes[sxE] = base;
      return { ...entry, episodes };
    },
    now
  );
}

export function markSeasonWatched(data, key, seasonN, timestampIso) {
  const catalogEntry = data.catalog[key];
  const season = (catalogEntry && catalogEntry.seasons || []).find((s) => Number(s.n) === seasonN);
  if (!season) return data;
  const now = new Date();
  const ts = timestampIso || now.toISOString();
  return withLibraryEntry(
    data,
    key,
    (raw) => {
      const entry = ensureSeriesEntry(raw);
      const episodes = { ...entry.episodes };
      for (const ep of season.episodes || []) {
        const sxe = episodeKey(seasonN, ep.n);
        const current = episodes[sxe];
        if (current && Array.isArray(current.watched) && current.watched.length > 0) continue;
        episodes[sxe] = { ...(current || {}), watched: [ts] };
      }
      return { ...entry, episodes };
    },
    now
  );
}

export function setEpisodeNote(data, key, sxE, note) {
  checkNote(note);
  const now = new Date();
  return withLibraryEntry(
    data,
    key,
    (raw) => {
      const entry = ensureSeriesEntry(raw);
      const episodes = { ...entry.episodes };
      if (note === null) {
        const current = episodes[sxE];
        if (!current) return entry;
        const base = { ...current };
        delete base.note;
        if (Object.keys(base).length === 0) delete episodes[sxE];
        else episodes[sxE] = base;
      } else {
        episodes[sxE] = { ...(episodes[sxE] || {}), note };
      }
      return { ...entry, episodes };
    },
    now
  );
}

export function setTitleNote(data, key, note) {
  checkNote(note);
  const now = new Date();
  return withLibraryEntry(data, key, (raw) => {
    if (!raw) return note === null ? undefined : { note };
    const base = { ...raw };
    if (note === null) delete base.note;
    else base.note = note;
    return base;
  }, now);
}

export function toggleMovieWatched(data, key, timestampIso, watchedFlag) {
  const now = new Date();
  const ts = timestampIso || now.toISOString();
  return withLibraryEntry(data, key, (raw) => {
    const watched = raw && Array.isArray(raw.watched) ? raw.watched : [];
    if (watchedFlag === false || (watchedFlag === undefined && watched.length > 0)) {
      if (!raw) return undefined;
      const base = { ...raw };
      delete base.watched;
      return base;
    }
    if (watched.length > 0) return raw || { watched: [ts] };
    return { ...(raw || {}), watched: [ts] };
  }, now);
}

export function isFollowed(libraryEntry) {
  return !!libraryEntry && libraryEntry.followed !== false;
}

export function resolveFollowAction(data, key) {
  const entry = data && data.library ? data.library[key] : undefined;
  if (!entry) return 'add';
  return isFollowed(entry) ? 'navigate' : 'refollow';
}

export function setFollowed(data, key, followed) {
  const now = new Date();
  return withLibraryEntry(data, key, (raw) => {
    const base = { ...(raw || {}) };
    if (followed) delete base.followed;
    else base.followed = false;
    return base;
  }, now);
}

export function addToLibrary(data, catalogEntry, opts = {}) {
  if (!catalogEntry || typeof catalogEntry.id !== 'string') {
    throw new TypeError('addToLibrary requiere catalogEntry.id');
  }
  checkNote(opts.note === undefined ? null : opts.note);
  const now = new Date();
  const catalog = { ...data.catalog };
  if (!catalog[catalogEntry.id]) catalog[catalogEntry.id] = catalogEntry;
  const library = { ...data.library };
  const existing = library[catalogEntry.id];
  if (existing) {
    let next = existing;
    if (opts.note !== undefined) next = { ...next, note: opts.note };
    if (opts.followed === false) next = { ...next, followed: false };
    if (opts.followed === true) {
      next = { ...next };
      delete next.followed;
    }
    if (Array.isArray(opts.watched) && opts.watched.length > 0) next = { ...next, watched: opts.watched };
    library[catalogEntry.id] = next;
  } else {
    const entry = {};
    if (opts.note !== undefined) entry.note = opts.note;
    if (opts.followed === false) entry.followed = false;
    if (catalogEntry.type === 'movie' && Array.isArray(opts.watched) && opts.watched.length > 0) {
      entry.watched = opts.watched;
    }
    library[catalogEntry.id] = entry;
  }
  return { ...data, meta: { ...data.meta, updatedAt: now.toISOString() }, catalog, library };
}

export function follow(data, catalogEntry) {
  if (!catalogEntry || typeof catalogEntry.id !== 'string' || catalogEntry.id === '') {
    throw new TypeError('follow requiere catalogEntry.id');
  }
  return addToLibrary(data, catalogEntry, { followed: true });
}

export function unfollow(data, key) {
  if (!data.library[key]) return data;
  const now = new Date();
  return withLibraryEntry(data, key, (raw) => ({ ...raw, followed: false }), now);
}

export function normalize(data) {
  const catalog = {};
  for (const [key, raw] of Object.entries(data.catalog || {})) {
    catalog[key] = normalizeCatalogEntry(raw);
  }
  const library = {};
  for (const [key, raw] of Object.entries(data.library || {})) {
    library[key] = normalizeLibraryEntry(raw);
  }
  return {
    meta: { ...data.meta },
    catalog,
    library,
    review: Array.isArray(data.review) ? data.review : [],
    settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
  };
}

function normalizeCatalogEntry(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const names = raw.names && typeof raw.names === 'object' ? raw.names : {};
  const entry = {
    ...raw,
    anilistId: raw.anilistId != null ? raw.anilistId : null,
    isAnime: raw.isAnime === true,
    names: {
      es: typeof names.es === 'string' ? names.es : null,
      en: typeof names.en === 'string' ? names.en : null,
      romaji: typeof names.romaji === 'string' ? names.romaji : null,
      native: typeof names.native === 'string' ? names.native : null,
    },
    synopsis: typeof raw.synopsis === 'string' ? raw.synopsis : null,
    poster: typeof raw.poster === 'string' ? raw.poster : null,
    backdrop: typeof raw.backdrop === 'string' ? raw.backdrop : null,
    releaseDate: typeof raw.releaseDate === 'string' ? raw.releaseDate : null,
    status: typeof raw.status === 'string' ? raw.status : null,
    genres: Array.isArray(raw.genres) ? raw.genres : [],
    voteAverage: typeof raw.voteAverage === 'number' ? raw.voteAverage : null,
    fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : null,
  };
  if (entry.type === 'series') {
    entry.seasons = Array.isArray(raw.seasons)
      ? raw.seasons.map((season) => ({
          ...season,
          episodes: Array.isArray(season.episodes)
            ? season.episodes.map((ep) => ({
                n: ep.n,
                name: typeof ep.name === 'string' ? ep.name : null,
                airDate: typeof ep.airDate === 'string' ? ep.airDate : null,
                runtime: typeof ep.runtime === 'number' ? ep.runtime : null,
              }))
            : [],
        }))
      : [];
  }
  return entry;
}

function normalizeLibraryEntry(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const entry = { ...raw };
  if (entry.episodes && typeof entry.episodes === 'object' && !Array.isArray(entry.episodes)) {
    const episodes = {};
    for (const [sxe, ep] of Object.entries(entry.episodes)) {
      const base = { ...(ep || {}) };
      if (base.watched === undefined) base.watched = [];
      episodes[sxe] = base;
    }
    entry.episodes = episodes;
  }
  return entry;
}

export function migrate(data) {
  switch (data.meta.version) {
    case 1:
      return data;
    default:
      return data;
  }
}

export function serialize(data) {
  return JSON.stringify(data, null, 2);
}

export function parseDataText(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, data: null, text, error: 'CORRUPT' };
  }
  const result = validate(parsed);
  if (!result.ok) {
    const meta = parsed && parsed.meta;
    if (meta && typeof meta.version === 'number' && meta.version !== CURRENT_VERSION) {
      return { ok: false, data: null, text, error: 'VERSION' };
    }
    return { ok: false, data: null, text, error: 'SCHEMA' };
  }
  return { ok: true, data: parsed, text, error: null };
}

export function validate(data) {
  const errors = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['El fichero no es un objeto JSON'] };
  }
  const meta = data.meta;
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    errors.push('meta ausente o no es objeto');
  } else {
    if (meta.version !== CURRENT_VERSION) {
      errors.push(`meta.version no soportado: ${meta.version}`);
    }
    if (typeof meta.updatedAt !== 'string' || Number.isNaN(Date.parse(meta.updatedAt))) {
      errors.push('meta.updatedAt no es una fecha ISO válida');
    }
  }
  if (!data.catalog || typeof data.catalog !== 'object' || Array.isArray(data.catalog)) {
    errors.push('catalog ausente o no es objeto');
  } else {
    for (const [key, entry] of Object.entries(data.catalog)) {
      if (!CANONICAL_KEY.test(key)) errors.push(`catalog: clave no canónica: ${key}`);
      validateCatalogEntry(key, entry, errors);
    }
  }
  if (!data.library || typeof data.library !== 'object' || Array.isArray(data.library)) {
    errors.push('library ausente o no es objeto');
  } else {
    for (const [key, entry] of Object.entries(data.library)) {
      if (!CANONICAL_KEY.test(key)) errors.push(`library: clave no canónica: ${key}`);
      validateLibraryEntry(key, entry, data.catalog, errors);
    }
  }
  if (data.review !== undefined && !Array.isArray(data.review)) {
    errors.push('review no es un array');
  }
  if (data.settings !== undefined && (!data.settings || typeof data.settings !== 'object' || Array.isArray(data.settings))) {
    errors.push('settings no es un objeto');
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

function validateCatalogEntry(key, entry, errors) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`catalog.${key}: entrada no es objeto`);
    return;
  }
  if (entry.type !== 'series' && entry.type !== 'movie') {
    errors.push(`catalog.${key}: type inválido: ${entry.type}`);
  }
  if (typeof entry.isAnime !== 'boolean') errors.push(`catalog.${key}: isAnime no es booleano`);
  if (!entry.names || typeof entry.names !== 'object' || Array.isArray(entry.names)) {
    errors.push(`catalog.${key}: names ausente`);
  } else if (typeof entry.names.es !== 'string' && typeof entry.names.en !== 'string') {
    errors.push(`catalog.${key}: names.es/en ausentes`);
  }
  if (entry.type === 'series') {
    if (!Array.isArray(entry.seasons)) {
      errors.push(`catalog.${key}: seasons no es array`);
    } else {
      for (const season of entry.seasons) {
        if (!season || typeof season !== 'object' || Array.isArray(season)) {
          errors.push(`catalog.${key}: temporada no es objeto`);
          continue;
        }
        if (!Number.isInteger(season.n) || season.n < 0) {
          errors.push(`catalog.${key}: season.n inválido: ${season.n}`);
        }
        if (!Array.isArray(season.episodes)) {
          errors.push(`catalog.${key}: temporada ${season.n} sin episodes`);
        } else {
          for (const ep of season.episodes) {
            if (!ep || typeof ep !== 'object' || Array.isArray(ep)) {
              errors.push(`catalog.${key}: episodio no es objeto`);
              continue;
            }
            if (!Number.isInteger(ep.n) || ep.n < 0) {
              errors.push(`catalog.${key}: episodio sin n válido`);
            }
            if (ep.airDate !== null && ep.airDate !== '' && typeof ep.airDate !== 'string') {
              errors.push(`catalog.${key}: airDate inválido: ${ep.airDate}`);
            } else if (typeof ep.airDate === 'string' && ep.airDate !== '' && Number.isNaN(Date.parse(ep.airDate))) {
              errors.push(`catalog.${key}: airDate inválido: ${ep.airDate}`);
            }
          }
        }
      }
    }
  }
}

function validateLibraryEntry(key, entry, catalog, errors) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    errors.push(`library.${key}: entrada no es objeto`);
    return;
  }
  for (const field of Object.keys(entry)) {
    if (!LIBRARY_FIELDS.has(field)) errors.push(`library.${key}: campo desconocido: ${field}`);
  }
  if (entry.note !== undefined && (!Number.isInteger(entry.note) || entry.note < 1 || entry.note > 5)) {
    errors.push(`library.${key}: nota inválida: ${entry.note}`);
  }
  if (entry.followed !== undefined && typeof entry.followed !== 'boolean') {
    errors.push(`library.${key}: followed no es booleano`);
  }
  const type = catalog && catalog[key] ? catalog[key].type : undefined;
  if (type === 'movie') {
    if (entry.episodes !== undefined) errors.push(`library.${key}: película no debe tener episodes`);
    validateWatched(key, entry.watched, errors);
  } else if (type === 'series') {
    if (entry.watched !== undefined) errors.push(`library.${key}: serie no debe tener watched`);
    validateEpisodes(key, entry.episodes, errors);
  } else {
    if (entry.watched !== undefined && entry.episodes !== undefined) {
      errors.push(`library.${key}: watched y episodes a la vez`);
    }
    validateWatched(key, entry.watched, errors);
    validateEpisodes(key, entry.episodes, errors);
  }
  if (entry.origin !== undefined) {
    if (!entry.origin || typeof entry.origin !== 'object' || Array.isArray(entry.origin)) {
      errors.push(`library.${key}: origin no es objeto`);
    } else if (typeof entry.origin.source !== 'string') {
      errors.push(`library.${key}: origin.source ausente`);
    }
  }
}

function validateWatched(key, watched, errors) {
  if (watched === undefined) return;
  if (!Array.isArray(watched)) {
    errors.push(`library.${key}: watched no es array`);
    return;
  }
  for (const ts of watched) {
    if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) {
      errors.push(`library.${key}: timestamp inválido: ${ts}`);
    }
  }
}

function validateEpisodes(key, episodes, errors) {
  if (episodes === undefined) return;
  if (!episodes || typeof episodes !== 'object' || Array.isArray(episodes)) {
    errors.push(`library.${key}: episodes no es objeto`);
    return;
  }
  for (const [sxe, ep] of Object.entries(episodes)) {
    if (!SXE_KEY.test(sxe)) errors.push(`library.${key}: clave de episodio inválida: ${sxe}`);
    if (!ep || typeof ep !== 'object' || Array.isArray(ep)) {
      errors.push(`library.${key}.${sxe}: entrada no es objeto`);
      continue;
    }
    for (const field of Object.keys(ep)) {
      if (!EPISODE_FIELDS.has(field)) errors.push(`library.${key}.${sxe}: campo desconocido: ${field}`);
    }
    if (ep.note !== undefined && (!Number.isInteger(ep.note) || ep.note < 1 || ep.note > 5)) {
      errors.push(`library.${key}.${sxe}: nota inválida: ${ep.note}`);
    }
    validateWatched(`${key}.${sxe}`, ep.watched, errors);
  }
}
