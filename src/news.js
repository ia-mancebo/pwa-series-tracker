import { toResult } from './search.js';
import { isFollowed } from './model.js';

export const PREMIERE_WINDOW_DAYS = 30;
export const PREMIERE_LIMIT = 50;
export const NEWS_WINDOW_DEFAULT = 90;
export const NEWS_WINDOW_MIN = 7;
export const NEWS_WINDOW_MAX = 365;
export const NEWS_LIMIT = 50;

function isDateString(value) {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

function isoDate(now) {
  return new Date(now).toISOString().slice(0, 10);
}

function windowStartDate(now, windowDays) {
  return new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function readNewsWindowDays(data) {
  const settings = data && data.settings && typeof data.settings === 'object' ? data.settings : {};
  const value = settings.newsWindowDays;
  if (typeof value !== 'number' || !Number.isFinite(value)) return NEWS_WINDOW_DEFAULT;
  const rounded = Math.round(value);
  if (rounded < NEWS_WINDOW_MIN) return NEWS_WINDOW_MIN;
  if (rounded > NEWS_WINDOW_MAX) return NEWS_WINDOW_MAX;
  return rounded;
}

export function computeNewEpisodes(data, now = new Date()) {
  const today = isoDate(now);
  const windowDays = readNewsWindowDays(data);
  const cutoff = windowStartDate(now, windowDays);
  const watermark = data && data.meta && data.meta.watermark && typeof data.meta.watermark === 'object' && !Array.isArray(data.meta.watermark)
    ? data.meta.watermark
    : {};
  const candidates = [];
  for (const [key, libraryEntry] of Object.entries((data && data.library) || {})) {
    if (!isFollowed(libraryEntry)) continue;
    const catalogEntry = (data.catalog || {})[key];
    if (!catalogEntry || catalogEntry.type !== 'series') continue;
    const mark = typeof watermark[key] === 'string' ? watermark[key] : null;
    for (const season of catalogEntry.seasons || []) {
      if (Number(season.n) === 0) continue;
      const episodes = season.episodes || [];
      const airedCount = episodes.filter((ep) => isDateString(ep.airDate) && ep.airDate <= today).length;
      for (const ep of episodes) {
        if (!isDateString(ep.airDate)) continue;
        if (ep.airDate > today) continue;
        if (mark && ep.airDate <= mark) continue;
        if (!mark && ep.airDate < cutoff) continue;
        candidates.push({ key, seasonN: season.n, episodeN: ep.n, airDate: ep.airDate, name: ep.name || null, airedCount });
      }
    }
  }
  candidates.sort((a, b) => b.airDate.localeCompare(a.airDate) || a.key.localeCompare(b.key) || a.seasonN - b.seasonN || a.episodeN - b.episodeN);

  const feed = [];
  let start = 0;
  while (start < candidates.length) {
    const item = candidates[start];
    let end = start + 1;
    while (end < candidates.length && candidates[end].key === item.key && candidates[end].airDate === item.airDate && candidates[end].seasonN === item.seasonN) end += 1;
    if (end - start === 1) {
      feed.push({ kind: 'episode', key: item.key, seasonN: item.seasonN, episodeN: item.episodeN, airDate: item.airDate, name: item.name });
    } else {
      const eps = candidates.slice(start, end);
      const nums = eps.map((e) => e.episodeN);
      feed.push({
        kind: 'group',
        key: item.key,
        seasonN: item.seasonN,
        airDate: item.airDate,
        startN: Math.min(...nums),
        endN: Math.max(...nums),
        count: eps.length,
        complete: eps.length === item.airedCount,
      });
    }
    start = end;
  }
  return feed.slice(0, NEWS_LIMIT);
}

export function computePremieres(data, discoverResults, now = new Date()) {
  const catalog = (data && data.catalog) || {};
  const library = (data && data.library) || {};
  const today = isoDate(now);
  const windowStart = windowStartDate(now, PREMIERE_WINDOW_DAYS);
  const seen = new Set();
  const premieres = [];
  for (const entry of discoverResults || []) {
    const result = toResult(entry);
    if (!result.key) continue;
    if (catalog[result.key] || library[result.key] || seen.has(result.key)) continue;
    if (!isDateString(entry.releaseDate)) continue;
    if (entry.releaseDate < windowStart || entry.releaseDate > today) continue;
    seen.add(result.key);
    premieres.push({ ...result, releaseDate: entry.releaseDate });
  }
  return premieres
    .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.key.localeCompare(b.key))
    .slice(0, PREMIERE_LIMIT);
}

export function groupByAnime(premieres) {
  const series = [];
  const movies = [];
  const anime = [];
  for (const premiere of premieres || []) {
    if (premiere.isAnime) anime.push(premiere);
    else if (premiere.type === 'movie') movies.push(premiere);
    else series.push(premiere);
  }
  return { series, movies, anime };
}
