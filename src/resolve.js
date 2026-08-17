import { follow } from './model.js';
import { buildSeriesLibraryEntryFrom, voteToNote } from './import.js';
import { fetchByKey } from './catalog.js';

function remapSxe(sxe, season) {
  return `${season}x${String(sxe).split('x')[1]}`;
}

export function rawSeasonOf(reviewItem) {
  if (reviewItem && reviewItem.type === 'temporada' && reviewItem.raw && reviewItem.raw.season != null) {
    return Number(reviewItem.raw.season);
  }
  return null;
}

export function buildLibraryEntry(reviewItem, now, opts = {}) {
  const raw = reviewItem.raw || {};
  const origin = { source: 'tvtime', matchedName: reviewItem.tvtimeName, importedAt: now };
  if (raw.vote != null) origin.rawVote = raw.vote;

  const season = reviewItem.type === 'temporada' && opts.season != null ? Number(opts.season) : null;
  const remap = season == null ? (sxe) => sxe : (sxe) => remapSxe(sxe, season);
  const episodes = {};
  const votes = {};
  for (const [sxe, value] of Object.entries(raw.episodes || {})) episodes[remap(sxe)] = value;
  for (const [sxe, value] of Object.entries(raw.votes || {})) votes[remap(sxe)] = value;
  const sxeList = Object.keys(episodes);
  if (sxeList.length) {
    return buildSeriesLibraryEntryFrom(episodes, votes, sxeList, origin);
  }
  const entry = { origin };
  const watched = raw.watched || [];
  if (Array.isArray(watched) && watched.length) entry.watched = [...watched];
  if (raw.vote != null) {
    const note = voteToNote(raw.vote);
    if (note != null) entry.note = note;
  }
  return entry;
}

function mergeLibraryEntry(existing, incoming) {
  const base = { ...existing };
  const epA = existing.episodes && typeof existing.episodes === 'object' && !Array.isArray(existing.episodes) ? existing.episodes : {};
  const epB = incoming.episodes || {};
  if (Object.keys(epB).length) {
    const episodes = { ...epA };
    for (const [sxe, ep] of Object.entries(epB)) {
      const current = episodes[sxe] || {};
      const watched = [...(current.watched || []), ...(ep.watched || [])];
      const merged = { ...current, ...ep, watched: [...new Set(watched)] };
      if (current.note !== undefined) merged.note = current.note;
      episodes[sxe] = merged;
    }
    base.episodes = episodes;
  }
  if (incoming.watched && incoming.watched.length) {
    base.watched = [...new Set([...(existing.watched || []), ...incoming.watched])];
  }
  if (base.note === undefined && incoming.note !== undefined) base.note = incoming.note;
  if (!base.origin && incoming.origin) base.origin = incoming.origin;
  return base;
}

export function ensureEntryId(entry) {
  if (entry && typeof entry.id === 'string' && entry.id) return entry;
  if (entry && entry.anilistId != null) return { ...entry, id: `anilist:${entry.anilistId}` };
  return entry;
}

export async function fetchCandidateDetail(candidate, opts = {}) {
  const key = candidate && candidate.key;
  if (!key) return null;
  const fetchers = opts.fetchers || {};
  return fetchByKey(key, {
    tmdb: fetchers.tmdb,
    anilist: fetchers.anilist,
    tmdbApiKey: opts.tmdbApiKey,
  });
}

export function resolveIntoData(data, reviewItem, catalogEntry, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const built = buildLibraryEntry(reviewItem, now, opts);
  let next = follow(data, catalogEntry);
  const key = catalogEntry.id;
  const existing = next.library[key];
  const merged = existing ? mergeLibraryEntry(existing, built) : built;
  next = {
    ...next,
    meta: { ...next.meta, updatedAt: now },
    library: { ...next.library, [key]: merged },
    review: (next.review || []).filter((item) => item.id !== reviewItem.id),
  };
  return next;
}

export function discardFromReview(data, reviewId, opts = {}) {
  const review = (data.review || []).filter((item) => item.id !== reviewId);
  if (review.length === (data.review || []).length) return data;
  const now = opts.now || new Date().toISOString();
  return { ...data, meta: { ...data.meta, updatedAt: now }, review };
}

export async function resolvePick(data, reviewItem, pick, opts = {}) {
  const key = pick && pick.key;
  if (!key) return null;
  const detail = await fetchByKey(key, {
    tmdb: opts.fetchers && opts.fetchers.tmdb,
    anilist: opts.fetchers && opts.fetchers.anilist,
    tmdbApiKey: opts.tmdbApiKey,
  });
  if (!detail) return null;
  const entry = ensureEntryId(detail);
  if (typeof opts.onEntry === 'function') {
    const intercepted = opts.onEntry(entry, pick);
    if (intercepted) return data;
  }
  return resolveIntoData(data, reviewItem, entry, { now: opts.now, season: opts.season });
}