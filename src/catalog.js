import * as tmdb from './tmdb.js';
import * as anilist from './anilist.js';

const NON_NETWORK_CODES = new Set(['NOT_FOUND', 'NO_KEY', 'API']);

export async function fetchByKey(key, deps = {}) {
  const entry = await callAdapter(key, deps);
  if (!entry) return null;
  if (typeof entry.id === 'string' && entry.id) return entry;
  if (entry.anilistId != null) return { ...entry, id: `anilist:${entry.anilistId}` };
  return entry;
}

async function callAdapter(key, deps) {
  try {
    if (!key) return null;
    if (key.startsWith('tmdb:tv:')) {
      const id = key.split(':').pop();
      return await (deps.tmdb || tmdb).getSeries(id, deps.tmdbApiKey);
    }
    if (key.startsWith('tmdb:movie:')) {
      const id = key.split(':').pop();
      return await (deps.tmdb || tmdb).getMovie(id, deps.tmdbApiKey);
    }
    if (key.startsWith('anilist:')) {
      const id = key.split(':').pop();
      return await (deps.anilist || anilist).getById(Number(id));
    }
    return null;
  } catch (error) {
    if (typeof deps.ctx === 'object' && deps.ctx && error && !NON_NETWORK_CODES.has(error.code)) {
      deps.ctx.down = true;
    }
    return null;
  }
}