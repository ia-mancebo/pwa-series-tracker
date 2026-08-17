import { episodeKey } from './model.js';
import { normalizeName, namesMatch } from './search.js';
import * as tmdb from './tmdb.js';
import * as anilist from './anilist.js';
import { fetchByKey } from './catalog.js';

const SERIES_RECORDS_FILE = 'tracking-prod-records-v2.csv';
const MOVIE_RECORDS_FILE = 'tracking-prod-records.csv';
const EPISODE_VOTES_FILE = 'ratings-3-prod-episode_votes.csv';
const MOVIE_VOTES_FILE = 'ratings-live-votes.csv';
const USER_SHOWS_FILE = 'user_tv_show_data.csv';

const CJK_RE = /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/;
const NON_NETWORK_CODES = new Set(['NOT_FOUND', 'NO_KEY', 'API']);

export function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  const src = String(text).replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
          continue;
        }
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') {
      if (src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
      continue;
    }
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      field = '';
      row = [];
      continue;
    }
    field += c;
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].every((f) => f === '')) rows.pop();
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1).map((fields) => {
    const record = {};
    for (let i = 0; i < headers.length; i++) record[headers[i]] = fields[i] ?? '';
    return record;
  });
}

export async function parseTvtimeFile(pathOrText, fileName) {
  const name = String(fileName || '').split(/[\\/]/).pop();
  const text = await readIfPath(pathOrText);
  const rows = parseCsv(text);
  switch (name) {
    case SERIES_RECORDS_FILE:
      return parseSeriesRecords(rows);
    case MOVIE_RECORDS_FILE:
      return parseMovieRecords(rows);
    case EPISODE_VOTES_FILE:
      return parseEpisodeVotes(rows);
    case MOVIE_VOTES_FILE:
      return parseMovieVotes(rows);
    case USER_SHOWS_FILE:
      return parseUserShows(rows);
    default:
      return { type: 'ignore', fileName: name, records: [] };
  }
}

function parseSeriesRecords(rows) {
  const records = [];
  for (const row of rows) {
    const key = row.key || '';
    const seriesName = row.series_name || '';
    if (key.startsWith('user-series')) {
      records.push({ kind: 'follow', seriesName, sId: row.s_id || null });
    } else if (key.startsWith('watch-episode') || key.startsWith('rewatch-episode')) {
      records.push({
        kind: key.startsWith('rewatch-episode') ? 'rewatch-episode' : 'watch-episode',
        seriesName,
        seasonN: num(row.s_no) ?? num(row.season_number),
        episodeN: num(row.ep_no) ?? num(row.episode_number),
        epId: String(row.ep_id || ''),
        createdAt: parseDate(row.created_at),
      });
    }
  }
  return { type: 'series-records', records };
}

function parseMovieRecords(rows) {
  const records = [];
  for (const row of rows) {
    const type = row.type || '';
    if (type === 'follow' || type === 'watch' || type === 'towatch' || type === 'rewatch_count') {
      records.push({
        kind: type,
        uuid: String(row.uuid || ''),
        movieName: row.movie_name || '',
        releaseDate: row.release_date || null,
        createdAt: parseDate(row.created_at),
      });
    }
  }
  return { type: 'movie-records', records };
}

function parseEpisodeVotes(rows) {
  const votes = [];
  for (const row of rows) {
    const value = voteValue(row.vote_key);
    if (value == null) continue;
    votes.push({
      episodeId: String(row.episode_id || ''),
      value,
      seriesName: row.series_name || '',
      seasonN: num(row.season_number),
      episodeN: num(row.episode_number),
    });
  }
  return { type: 'episode-votes', votes };
}

function parseMovieVotes(rows) {
  const votes = [];
  for (const row of rows) {
    const value = voteValue(row.vote_key);
    if (value == null) continue;
    votes.push({ uuid: String(row.uuid || ''), value, movieName: row.movie_name || '' });
  }
  return { type: 'movie-votes', votes };
}

function parseUserShows(rows) {
  const follows = [];
  for (const row of rows) {
    if (String(row.is_followed) === '1') {
      follows.push({
        tvShowId: String(row.tv_show_id || ''),
        name: row.tv_show_name || '',
        seenCount: num(row.nb_episodes_seen),
      });
    }
  }
  return { type: 'user-shows', follows };
}

export function buildItems(parsed) {
  const series = new Map();
  const movies = new Map();
  let seq = 0;
  const getSeriesItem = (name) => {
    if (!name) return null;
    let item = series.get(name);
    if (!item) {
      item = { id: `item-${++seq}`, type: 'series', name, year: null, episodes: {}, votes: {}, watched: [], vote: null, follow: true };
      series.set(name, item);
    }
    return item;
  };
  const getMovieItem = (uuid, name) => {
    const key = uuid || `uuid:${name}`;
    let item = movies.get(key);
    if (!item) {
      item = { id: `item-${++seq}`, type: 'movie', name: name || '', year: null, episodes: {}, votes: {}, watched: [], vote: null, follow: true };
      movies.set(key, item);
    }
    return item;
  };
  for (const parsedFile of parsed) {
    switch (parsedFile.type) {
      case 'series-records':
        for (const r of parsedFile.records) {
          if (r.kind === 'follow') {
            getSeriesItem(r.seriesName);
          } else if (r.seasonN != null && r.episodeN != null && r.createdAt) {
            const item = getSeriesItem(r.seriesName);
            if (!item) continue;
            const sxe = episodeKey(r.seasonN, r.episodeN);
            const marks = item.episodes[sxe] || (item.episodes[sxe] = []);
            if (!marks.includes(r.createdAt)) {
              marks.push(r.createdAt);
              marks.sort();
            }
          }
        }
        break;
      case 'movie-records':
        for (const r of parsedFile.records) {
          const item = getMovieItem(r.uuid, r.movieName);
          if (!item.name && r.movieName) item.name = r.movieName;
          if (r.releaseDate) {
            const y = yearFromDate(r.releaseDate);
            if (y && !item.year) item.year = y;
          }
          if ((r.kind === 'watch' || r.kind === 'rewatch_count') && r.createdAt) {
            if (!item.watched.includes(r.createdAt)) item.watched.push(r.createdAt);
          }
        }
        break;
      case 'episode-votes':
        for (const v of parsedFile.votes) {
          const item = findSeriesItem(series, v.seriesName);
          if (!item || v.seasonN == null || v.episodeN == null) continue;
          item.votes[episodeKey(v.seasonN, v.episodeN)] = v.value;
        }
        break;
      case 'movie-votes':
        for (const v of parsedFile.votes) {
          const item = movies.get(v.uuid);
          if (item) {
            item.vote = v.value;
          } else if (v.movieName) {
            getMovieItem(v.uuid, v.movieName).vote = v.value;
          }
        }
        break;
      case 'user-shows':
        for (const f of parsedFile.follows) {
          if (f.name && !series.has(f.name)) getSeriesItem(f.name);
        }
        break;
      default:
        break;
    }
  }
  return [...series.values(), ...movies.values()].filter((i) => i.name);
}

function findSeriesItem(series, name) {
  if (!name) return null;
  const exact = series.get(name);
  if (exact) return exact;
  const norm = normalizeName(name);
  for (const item of series.values()) {
    if (normalizeName(item.name) === norm) return item;
  }
  return null;
}

const TVTIME_VOTE_NOTE = { 1: 1, 27: 2, 28: 3, 29: 4, 3: 5 };
const TVTIME_VOTE_NOTE_V2 = { 16: 1, 17: 2, 18: 3, 19: 4, 20: 5 };

export function voteToNote(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  return TVTIME_VOTE_NOTE[value] ?? TVTIME_VOTE_NOTE_V2[value] ?? null;
}

export function buildSeriesLibraryEntryFrom(episodesMap, votesMap, sxeList, origin) {
  const episodes = {};
  const rawVotes = {};
  for (const sxe of sxeList) {
    const base = {};
    const watched = (episodesMap && episodesMap[sxe]) || [];
    if (Array.isArray(watched) && watched.length) base.watched = [...watched];
    const raw = votesMap && votesMap[sxe];
    if (raw != null) {
      const note = voteToNote(raw);
      if (note != null) base.note = note;
      rawVotes[sxe] = raw;
    }
    if (Object.keys(base).length) episodes[sxe] = base;
  }
  const entry = sxeList.length ? { episodes } : {};
  entry.origin = Object.keys(rawVotes).length ? { ...origin, rawVotes } : origin;
  return entry;
}

export async function importAll(data, files, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const tmdbApiKey = typeof opts.tmdbApiKey === 'string' && opts.tmdbApiKey ? opts.tmdbApiKey : null;
  const fetchers = opts.fetchers || { tmdb, anilist };
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
  onProgress({ phase: 'parse', pct: 0.05 });
  const parsed = [];
  for (const file of files || []) {
    const text = file.text != null ? file.text : file.path;
    const result = await parseTvtimeFile(text, file.name);
    if (result.type !== 'ignore') parsed.push(result);
  }
  onProgress({ phase: 'build', pct: 0.15 });
  const items = buildItems(parsed);
  onProgress({ phase: 'match', pct: 0.2 });
  const mopts = { tmdbApiKey, fetchers, now, ctx: { down: false } };
  const total = items.length;
  const result = await matchAll(items, mopts, (done) => {
    onProgress({ phase: 'match', pct: 0.2 + 0.75 * (done / Math.max(1, total)) });
  });
  onProgress({ phase: 'done', pct: 1 });
  return {
    data: mergeData(data, result.entries, result.reviewItems, { now }),
    summary: { matched: result.matched, queued: result.queued },
    reviewItems: result.reviewItems,
  };
}

async function matchAll(items, opts, onItem) {
  const entries = [];
  const reviewItems = [];
  let matched = 0;
  let queued = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    opts.ctx.down = false;
    let result;
    try {
      result = item.type === 'movie' ? await matchMovieItem(item, opts) : await matchSeriesItem(item, opts);
    } catch {
      result = reviewResult('error');
    }
    if (result.status === 'matched') {
      matched += 1;
      entries.push(...result.entries);
      for (const sr of result.seasonReviews || []) {
        queued += 1;
        reviewItems.push(buildSeasonReview(sr));
      }
    } else {
      queued += 1;
      reviewItems.push(buildReview(item, result));
    }
    onItem(i + 1);
  }
  return { entries, reviewItems, matched, queued };
}

async function matchSeriesItem(item, opts) {
  const deduped = await searchCandidates(item, opts);
  if (opts.ctx.down) return reviewResult('sin-red');
  if (!deduped.length) return reviewResult('no-encontrado');
  const top = deduped[0];
  const second = deduped[1];
  const hasEpisodes = Object.keys(item.episodes).length > 0;
  const grids = new Map();
  let chosen = null;
  if (isAutoMatch(top, second, item)) {
    chosen = top;
  } else if (hasEpisodes) {
    const pool = deduped.filter((c) => c.score >= 40).slice(0, 3);
    const resolved = [];
    for (const c of pool) {
      const grid = await safeDetail(c.entry, opts);
      if (opts.ctx.down) return reviewResult('sin-red');
      if (!grid) continue;
      grids.set(c.key, grid);
      const { found, total } = resolutionFor(item, grid);
      resolved.push({ c, ratio: total ? found / total : 0 });
    }
    resolved.sort((a, b) => b.ratio - a.ratio || b.c.score - a.c.score);
    const best = resolved[0];
    if (best && best.ratio >= 0.8) chosen = best.c;
    else return reviewResult(top.score >= 60 ? 'empate' : 'no-encontrado', deduped);
  } else {
    return reviewResult(top.score >= 60 ? 'empate' : 'no-encontrado', deduped);
  }

  let entry = chosen.entry;
  entry = await enrichAnime(entry, item, opts);
  if (opts.ctx.down) return reviewResult('sin-red');
  const extras = { anilistId: entry.anilistId, romaji: entry.names?.romaji, native: entry.names?.native };
  const detail = await safeDetail(entry, opts);
  if (opts.ctx.down) return reviewResult('sin-red');
  if (!detail) return reviewResult('error');
  entry = detail;
  if (extras.anilistId != null) {
    entry = {
      ...entry,
      anilistId: extras.anilistId,
      names: { ...entry.names, romaji: extras.romaji ?? entry.names?.romaji, native: extras.native ?? entry.names?.native },
    };
  }
  if (!grids.has(chosen.key)) grids.set(chosen.key, entry);

  if (!hasEpisodes) {
    return { status: 'matched', entries: [{ catalogEntry: entry, libraryEntry: buildSeriesLibraryEntry(item, [], opts) }] };
  }

  const plan = await planSeasons(item, entry, deduped, grids, opts);
  if (opts.ctx.down) return reviewResult('sin-red');
  const totalEps = Object.keys(item.episodes).length;
  if (totalEps > 0 && plan.unresolvedCount / totalEps > 0.2) {
    return reviewResult('episodios-sin-resolver', deduped);
  }
  const entries = [{ catalogEntry: entry, libraryEntry: buildSeriesLibraryEntry(item, plan.kept, opts) }];
  for (const s of plan.splits) {
    entries.push({ catalogEntry: s.catalogEntry, libraryEntry: buildSeriesLibraryEntry(item, s.sxeList, opts) });
  }
  return {
    status: 'matched',
    entries,
    seasonReviews: plan.seasonQueues.map((q) => ({ item, seasonN: q.seasonN, sxeList: q.sxeList, candidates: deduped })),
  };
}

async function matchMovieItem(item, opts) {
  const deduped = await searchCandidates(item, opts);
  if (opts.ctx.down) return reviewResult('sin-red');
  if (!deduped.length) return reviewResult('no-encontrado');
  const top = deduped[0];
  const second = deduped[1];
  if (!isAutoMatch(top, second, item)) {
    return reviewResult(top.score >= 60 ? 'empate' : 'no-encontrado', deduped);
  }
  let entry = top.entry;
  entry = await enrichAnime(entry, item, opts);
  if (opts.ctx.down) return reviewResult('sin-red');
  const extras = { anilistId: entry.anilistId, romaji: entry.names?.romaji, native: entry.names?.native };
  const detail = await safeDetail(entry, opts);
  if (opts.ctx.down) return reviewResult('sin-red');
  if (!detail) return reviewResult('error');
  entry = detail;
  if (extras.anilistId != null) {
    entry = {
      ...entry,
      anilistId: extras.anilistId,
      names: { ...entry.names, romaji: extras.romaji ?? entry.names?.romaji, native: extras.native ?? entry.names?.native },
    };
  }
  return { status: 'matched', entries: [{ catalogEntry: entry, libraryEntry: buildMovieLibraryEntry(item, opts) }] };
}

async function searchCandidates(item, opts) {
  const name = item.name;
  const cjk = CJK_RE.test(name);
  const scored = [];
  const pushScored = (entry, queryName) => {
    const key = entryKeyOf(entry);
    if (!key) return;
    scored.push({ key, entry, score: scoreCandidate(name, item.year, entry, queryName) });
  };
  if (cjk) {
    const hits = await safeCall(() => opts.fetchers.anilist.search(name), opts);
    if (hits) {
      for (const e of hits.filter((h) => h.type === item.type).slice(0, 5)) pushScored(e, name);
    }
    const anchor = hits ? hits.find((h) => h.type === item.type) : null;
    if (anchor && opts.tmdbApiKey) {
      const query = anchor.names?.romaji || anchor.names?.en || name;
      const tmdbHits = await safeCall(() => opts.fetchers.tmdb.search(query, opts.tmdbApiKey), opts);
      if (tmdbHits) {
        for (const e of tmdbHits.filter((h) => h.type === item.type).slice(0, 8)) pushScored(e, query);
      }
    }
  } else {
    if (opts.tmdbApiKey) {
      const hits = await safeCall(() => opts.fetchers.tmdb.search(name, opts.tmdbApiKey), opts);
      if (hits) {
        for (const e of hits.filter((h) => h.type === item.type).slice(0, 8)) pushScored(e, name);
      }
    }
    const hasGoodTmdb = scored.some((s) => s.score >= 60);
    if (!hasGoodTmdb) {
      const hits = await safeCall(() => opts.fetchers.anilist.search(name), opts);
      if (hits) {
        for (const e of hits.filter((h) => h.type === item.type).slice(0, 5)) pushScored(e, name);
      }
    }
  }
  return dedupeScored(scored);
}

async function enrichAnime(entry, item, opts) {
  if (!entry || entry.isAnime !== true) return entry;
  const key = entryKeyOf(entry);
  if (key && key.startsWith('anilist:')) {
    if (!opts.tmdbApiKey) return entry;
    const queries = [entry.names?.romaji, entry.names?.en, entry.names?.native, item.name].filter(Boolean);
    let best = null;
    for (const query of queries) {
      const hits = await safeCall(() => opts.fetchers.tmdb.search(query, opts.tmdbApiKey), opts);
      if (!hits) continue;
      for (const e of hits.filter((h) => h.type === entry.type)) {
        const score = scoreCandidate(query, null, e);
        if (!best || score > best.score) best = { entry: e, score };
      }
    }
    if (best && best.score >= 60) {
      return {
        ...best.entry,
        anilistId: entry.anilistId,
        names: {
          ...best.entry.names,
          romaji: entry.names?.romaji ?? best.entry.names?.romaji,
          native: entry.names?.native ?? best.entry.names?.native,
        },
      };
    }
    return entry;
  }
  const query = normalizeName(entry.names?.es) || normalizeName(entry.names?.en);
  if (!query) return entry;
  const hits = await safeCall(() => opts.fetchers.anilist.search(query), opts);
  if (!hits) return entry;
  let best = null;
  for (const e of hits) {
    const names = [e.names?.romaji, e.names?.en, e.names?.native].filter(Boolean);
    const exact = names.some((n) => compareNames(query, n) === 'exact');
    const fuzzy = names.some((n) => namesMatch(query, n));
    if (!exact && !fuzzy) continue;
    if (exact || !best) best = { entry: e };
  }
  if (best) {
    return {
      ...entry,
      anilistId: best.entry.anilistId,
      names: {
        ...entry.names,
        romaji: best.entry.names?.romaji ?? entry.names?.romaji,
        native: best.entry.names?.native ?? entry.names?.native,
      },
    };
  }
  return entry;
}

async function planSeasons(item, grid, deduped, grids, opts) {
  const kept = [];
  let unresolvedCount = 0;
  const splits = [];
  const seasonQueues = [];
  for (const [seasonN, sxeList] of groupBySeason(item)) {
    const exist = sxeList.filter((sxe) => episodeExists(grid, seasonN, sxe)).length;
    if (exist / sxeList.length >= 0.8) {
      kept.push(...sxeList);
      unresolvedCount += sxeList.length - exist;
    } else {
      const resolved = await matchSeasonAlone(item, seasonN, sxeList, deduped, grids, opts);
      if (resolved) {
        splits.push({ seasonN, sxeList, catalogEntry: resolved.grid });
      } else {
        seasonQueues.push({ seasonN, sxeList });
        unresolvedCount += sxeList.length;
      }
    }
  }
  return { kept, splits, seasonQueues, unresolvedCount };
}

async function matchSeasonAlone(item, seasonN, sxeList, deduped, grids, opts) {
  const pool = deduped.filter((c) => c.score >= 40).slice(0, 3);
  const results = [];
  for (const c of pool) {
    let grid = grids.get(c.key);
    if (!grid) {
      grid = await safeDetail(c.entry, opts);
      if (!grid) continue;
      grids.set(c.key, grid);
    }
    const exist = sxeList.filter((sxe) => episodeExists(grid, seasonN, sxe)).length;
    results.push({ c, grid, ratio: exist / sxeList.length });
  }
  results.sort((a, b) => b.ratio - a.ratio || b.c.score - a.c.score);
  const best = results[0];
  if (!best || best.ratio < 0.8) return null;
  const second = results[1];
  if (second && best.ratio - second.ratio < 0.2) return null;
  return best;
}

function groupBySeason(item) {
  const groups = new Map();
  for (const sxe of Object.keys(item.episodes)) {
    const seasonN = Number(sxe.split('x')[0]);
    const list = groups.get(seasonN) || [];
    list.push(sxe);
    groups.set(seasonN, list);
  }
  return groups;
}

function episodeExists(grid, seasonN, sxe) {
  const episodeN = Number(sxe.split('x')[1]);
  const season = (grid && grid.seasons || []).find((s) => Number(s.n) === seasonN);
  if (!season) return false;
  return (season.episodes || []).some((e) => Number(e.n) === episodeN);
}

function resolutionFor(item, grid) {
  const keys = Object.keys(item.episodes);
  let found = 0;
  for (const sxe of keys) {
    if (episodeExists(grid, Number(sxe.split('x')[0]), sxe)) found += 1;
  }
  return { found, total: keys.length };
}

function isAutoMatch(top, second, item) {
  if (top.score >= 100 && item.year && yearOf(top.entry) === item.year) return true;
  return top.score >= 60 && top.score - (second ? second.score : 0) >= 20;
}

function scoreCandidate(tvtimeName, tvtimeYear, entry, queryName) {
  const q = queryName || tvtimeName;
  const names = [entry.names?.es, entry.names?.en, entry.names?.romaji, entry.names?.native].filter(Boolean);
  let nameScore = 0;
  let exactViaNative = false;
  for (const n of names) {
    const cmp = compareNames(q, n);
    if (cmp === 'exact') {
      nameScore = 100;
      exactViaNative = n === entry.names?.native;
      break;
    }
    if (cmp === 'fuzzy' && nameScore < 70) nameScore = 70;
  }
  if (nameScore === 0) {
    const tokens = new Set(normalizeName(q).split(' ').filter(Boolean));
    if (tokens.size > 0) {
      let best = 0;
      for (const n of names) {
        const nt = new Set(normalizeName(n).split(' ').filter(Boolean));
        if (nt.size === 0) continue;
        let hit = 0;
        for (const t of tokens) if (nt.has(t)) hit += 1;
        best = Math.max(best, hit / tokens.size);
      }
      nameScore = Math.round(best * 60);
    }
  }
  const entryYear = yearOf(entry);
  let score = nameScore;
  if (tvtimeYear && entryYear) {
    if (tvtimeYear === entryYear) score += 10;
    else if (nameScore === 100 && !exactViaNative) score = 55;
    else if (nameScore !== 100) score -= 40;
  }
  return score;
}

function compareNames(a, b) {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na && nb) {
    if (na === nb) return 'exact';
    if (namesMatch(a, b)) return 'fuzzy';
    return 'none';
  }
  const ca = cleanName(a);
  const cb = cleanName(b);
  if (ca && ca === cb) return 'exact';
  return 'none';
}

function cleanName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[\s·・.。、,，!！?？:：;；'’"“”\-–—()（）[\]【】《》]+/g, '');
}

function dedupeScored(scored) {
  const byKey = new Map();
  for (const s of scored) {
    const existing = byKey.get(s.key);
    if (!existing || s.score > existing.score) byKey.set(s.key, s);
  }
  const deduped = [...byKey.values()];
  deduped.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const at = a.key.startsWith('tmdb:') ? 1 : 0;
    const bt = b.key.startsWith('tmdb:') ? 1 : 0;
    return bt - at;
  });
  return deduped;
}

async function safeDetail(entry, opts) {
  const value = await safeCall(() => fetchDetail(entry, opts), opts);
  if (!value) return null;
  return ensureEntryId(value);
}

async function fetchDetail(entry, opts) {
  const key = entryKeyOf(entry);
  if (!key || !key.startsWith('tmdb:')) return entry;
  return fetchByKey(key, {
    tmdb: opts.fetchers.tmdb,
    anilist: opts.fetchers.anilist,
    tmdbApiKey: opts.tmdbApiKey,
    ctx: opts.ctx,
  });
}

async function safeCall(fn, opts) {
  if (opts.ctx.down) return null;
  try {
    return await fn();
  } catch (error) {
    if (!error || !NON_NETWORK_CODES.has(error.code)) opts.ctx.down = true;
    return null;
  }
}

function entryKeyOf(entry) {
  if (entry && typeof entry.id === 'string' && entry.id) return entry.id;
  if (entry && entry.anilistId != null) return `anilist:${entry.anilistId}`;
  return null;
}

function ensureEntryId(entry) {
  if (entry && typeof entry.id === 'string' && entry.id) return entry;
  if (entry && entry.anilistId != null) return { ...entry, id: `anilist:${entry.anilistId}` };
  return entry;
}

function yearOf(entry) {
  if (!entry || !entry.releaseDate) return null;
  const y = parseInt(String(entry.releaseDate).slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function reviewResult(reason, candidates) {
  return { status: 'review', reason, candidates: (candidates || []).slice(0, 5).map(toCandidate) };
}

function toCandidate(c) {
  const names = (c.entry && c.entry.names) || {};
  return {
    key: c.key,
    name: names.es || names.en || names.romaji || names.native || '',
    year: yearOf(c.entry),
    poster: c.entry && c.entry.poster ? c.entry.poster : null,
  };
}

function buildReview(item, result) {
  return {
    id: item.id,
    tvtimeName: item.name,
    type: item.type === 'movie' ? 'pelicula' : 'serie',
    reason: result.reason,
    candidates: result.candidates,
    raw: { year: item.year, episodes: item.episodes, votes: item.votes, watched: item.watched, vote: item.vote },
  };
}

function buildSeasonReview(sr) {
  const episodes = {};
  const votes = {};
  for (const sxe of sr.sxeList) {
    if (sr.item.episodes[sxe]) episodes[sxe] = sr.item.episodes[sxe];
    if (sr.item.votes[sxe] != null) votes[sxe] = sr.item.votes[sxe];
  }
  return {
    id: `${sr.item.id}-s${sr.seasonN}`,
    tvtimeName: sr.item.name,
    type: 'temporada',
    reason: 'temporada-sin-resolver',
    candidates: sr.candidates.slice(0, 5).map(toCandidate),
    raw: { season: sr.seasonN, episodes, votes },
  };
}

function buildSeriesLibraryEntry(item, sxeList, opts) {
  const origin = { source: 'tvtime', matchedName: item.name, importedAt: opts.now };
  return buildSeriesLibraryEntryFrom(item.episodes || {}, item.votes || {}, sxeList, origin);
}

function buildMovieLibraryEntry(item, opts) {
  const entry = {};
  if (item.watched.length) entry.watched = [...item.watched];
  const origin = { source: 'tvtime', matchedName: item.name, importedAt: opts.now };
  if (item.vote != null) {
    const note = voteToNote(item.vote);
    if (note != null) entry.note = note;
    origin.rawVote = item.vote;
  }
  entry.origin = origin;
  return entry;
}

function mergeData(data, entries, reviewItems, opts) {
  const catalog = { ...(data.catalog || {}) };
  const library = { ...(data.library || {}) };
  for (const { catalogEntry, libraryEntry } of entries) {
    const key = catalogEntry.id;
    if (!catalog[key]) catalog[key] = catalogEntry;
    const existing = library[key];
    library[key] = existing ? mergeLibraryEntry(existing, libraryEntry) : libraryEntry;
  }
  return {
    ...data,
    meta: { ...(data.meta || {}), updatedAt: opts.now },
    catalog,
    library,
    review: [...(data.review || []), ...reviewItems],
  };
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
      episodes[sxe] = { ...current, ...ep, watched: [...new Set(watched)] };
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

async function readIfPath(value) {
  if (typeof value !== 'string' || value.includes('\n')) return value;
  if (!/[\\/]/.test(value) && !value.toLowerCase().endsWith('.csv')) return value;
  try {
    const fs = await import('node:fs');
    return fs.readFileSync(value, 'utf8');
  } catch {
    return value;
  }
}

function voteValue(voteKey) {
  const segment = String(voteKey || '').split('-').pop();
  const value = parseInt(segment, 10);
  return Number.isFinite(value) ? value : null;
}

function parseDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(text);
  if (m) {
    const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
    const date = new Date(y, mo - 1, d, h, mi, s);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function yearFromDate(value) {
  const y = parseInt(String(value).slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function num(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}
