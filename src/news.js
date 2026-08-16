import { toResult } from './search.js';

export const PREMIERE_WINDOW_DAYS = 30;
export const PREMIERE_LIMIT = 50;

function isDateString(value) {
  return typeof value === 'string' && value !== '' && !Number.isNaN(Date.parse(value));
}

export function isFollowed(libraryEntry) {
  return !!libraryEntry && libraryEntry.followed !== false;
}

export function computeNewEpisodes(data, now = new Date()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const watermark = data && data.meta && data.meta.watermark && typeof data.meta.watermark === 'object' && !Array.isArray(data.meta.watermark)
    ? data.meta.watermark
    : {};
  const episodes = [];
  for (const [key, libraryEntry] of Object.entries((data && data.library) || {})) {
    if (!isFollowed(libraryEntry)) continue;
    const catalogEntry = (data.catalog || {})[key];
    if (!catalogEntry || catalogEntry.type !== 'series') continue;
    const mark = typeof watermark[key] === 'string' ? watermark[key] : null;
    for (const season of catalogEntry.seasons || []) {
      if (Number(season.n) === 0) continue;
      for (const ep of season.episodes || []) {
        if (!isDateString(ep.airDate)) continue;
        if (ep.airDate > today) continue;
        if (mark && ep.airDate <= mark) continue;
        episodes.push({ key, seasonN: season.n, episodeN: ep.n, airDate: ep.airDate, name: ep.name || null });
      }
    }
  }
  return episodes.sort((a, b) => b.airDate.localeCompare(a.airDate) || a.key.localeCompare(b.key));
}

export function computePremieres(data, discoverResults, now = new Date()) {
  const catalog = (data && data.catalog) || {};
  const library = (data && data.library) || {};
  const today = new Date(now).toISOString().slice(0, 10);
  const windowStart = new Date(now.getTime() - PREMIERE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
