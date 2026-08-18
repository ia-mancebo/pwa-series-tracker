import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData } from './model.js';
import { parseCsv, parseTvtimeFile, buildItems, voteToNote, buildSeriesLibraryEntryFrom, importAll } from './import.js';

const V2_HEADER =
  'ep_id,created_at,gsi,user_id,key,s_id,ep_no,s_no,runtime,ep_watch_count,total_series_runtime,total_movies_runtime,updated_at,series_follow_count,movie_watch_count,followed_at,uuid,is_archived,is_followed,is_for_later,most_recent_ep_watched,is_unitary,bulk_type,rewatch_count,movie_name,series_name,season_number,episode_number\n';

const MOVIES_HEADER =
  'user_id,type-uuid-n,watch_count,watches,rewatch_count,type,created_at,alpha_range_key,entity_type,release_date,uuid,release_date_range_key,updated_at,follow_date_range_key,runtime,total_movies_runtime,watch_date_range_key,country,movie_name,series_name,season_number,episode_number\n';

const EPISODE_VOTES_HEADER = 'user_id,vote_key,episode_id,movie_name,series_name,season_number,episode_number\n';

const MOVIE_VOTES_HEADER = 'uuid,episode_id,vote_key,user_id,movie_name,series_name,season_number,episode_number\n';

const USER_SHOWS_HEADER = 'tv_show_id,is_followed,is_favorited,nb_episodes_seen,tv_show_name,user_id\n';

const REAL_V2_SNIPPET = [
  V2_HEADER.trimEnd(),
  '5292289,2025-01-03 15:06:40,watch-episode-1735916800,88612808,rewatch-episode-c89b7b03-cb1f-4776-b5ea-374263ce2310-d1a1dcac-cb3a-4632-b8c5-e16d84b61d13-1,275274,5,2,1380,,,,,,,,,,,,,,,,,Rick and Morty,2,5',
  ',2024-12-31 17:43:09,,88612808,tracking-stats,,,,,549,741720,0,2026-07-04 12:23:15,42,0,,,,,,,,,,,,,',
  ',2026-01-18 00:41:24,,88612808,user-series-0012fff3-bdd7-4c9e-a30f-44d5db326502,458960,,,,0,,,2026-01-18 00:41:24,,,1768696884411466,0012fff3-bdd7-4c9e-a30f-44d5db326502,false,true,false,,,,,,"With You, Our Love Will Make It Through",,',
  ',2026-06-21 13:38:03,,88612808,user-series-0667aa86-8502-465a-91fb-bad4e27d5e49,259972,,,,40,,,2026-07-04 12:23:15,,,1782049083118110,0667aa86-8502-465a-91fb-bad4e27d5e49,false,true,false,map[ep_id:5.432171e+06 ep_no:20 s_no:2 uuid:5b8e6c51-d345-4774-bb8e-fa392be1c984 watch_date:1.783167795630849e+15],,,,,Gravity Falls,,',
  ',2024-12-31 17:43:09,,88612808,user-series-53b351ca-a2da-4c7e-b581-c7d2bdbaf798,305288,,,,42,,,2026-01-08 14:20:32,,,1735666989960532,53b351ca-a2da-4c7e-b581-c7d2bdbaf798,false,true,false,map[ep_id:1.0788054e+07 ep_no:8 s_no:5 uuid:1d8537af-de3b-4fa2-8a22-8dc496e3082c watch_date:1.767882032151875e+15],,,,,Stranger Things,,',
  ',2025-10-05 08:49:31,,88612808,user-series-ad76771e-2a66-4748-93f6-5853f407b216,357888,,,,0,,,2025-10-05 08:49:31,,,1759654171656525,ad76771e-2a66-4748-93f6-5853f407b216,false,true,false,,,,,,"Love, Death & Robots",,',
  ',2025-11-27 07:06:17,,88612808,user-series-d44777c4-c7d4-4df7-a2ef-e5e78b6d07e4,248482,,,,272,,,2026-03-28 20:25:57,,,1764227177933200,d44777c4-c7d4-4df7-a2ef-e5e78b6d07e4,false,true,false,map[ep_id:1.0661523e+07 ep_no:32 s_no:7 uuid:d104702f-a9ce-4a1f-896f-d29bab6811e2 watch_date:1.774729557481751e+15],,,,,The Amazing World of Gumball,,',
  '5292289,2025-01-03 15:06:13,watch-episode-1735916773,88612808,watch-episode-c89b7b03-cb1f-4776-b5ea-374263ce2310-d1a1dcac-cb3a-4632-b8c5-e16d84b61d13,275274,5,2,1380,,,,2025-01-03 15:06:13,,,,,,,,,true,,1,,Rick and Morty,2,5',
  '5250240,2026-07-03 17:00:41,watch-episode-1783098041,88612808,watch-episode-0667aa86-8502-465a-91fb-bad4e27d5e49-051a5612-491d-4999-b100-001e9ee0c18f,259972,12,2,1500,,,,2026-07-03 17:00:41,,,,,,,,,true,,,,Gravity Falls,2,12',
  '5321494,2025-12-10 14:56:34,,88612808,watch-episode-d44777c4-c7d4-4df7-a2ef-e5e78b6d07e4-00932465-901d-4e40-96a1-8878c69af3c2,248482,9,4,600,,,,2025-12-10 14:56:34,,,,,,,,,false,fill-previous,,,The Amazing World of Gumball,4,9',
  '5621930,2025-01-08 22:02:08,,88612808,watch-episode-53b351ca-a2da-4c7e-b581-c7d2bdbaf798-185f06c3-d655-4c27-8d01-07100354e00b,305288,6,1,3720,,,,2025-01-08 22:02:08,,,,,,,,,false,season,,,Stranger Things,1,6',
  '10617348,2025-08-24 19:58:35,,88612808,watch-episode-a704a3c7-996b-40d8-bdb8-76fc2a34e1fd-00518184-3e71-4416-9cf1-5c943bb373da,383275,1,2,3540,,,,2025-08-24 19:58:35,,,,,,,,,false,season,,,Squid Game,2,1',
  '11354644,2026-06-26 22:07:16,watch-episode-1782511636,88612808,watch-episode-f3f6b4e6-f7f9-478e-965c-97841fe9b64c-0018c692-523d-47cf-9531-ca5192d74634,379403,6,3,660,,,,2026-06-26 22:07:16,,,,,,,,,true,,,,Smiling Friends,3,6',
  '8153160,2025-01-19 00:27:45,watch-episode-1737246465,88612808,watch-episode-3dd380ed-a6a0-47b1-9198-1300e5412dc0-16bd54b7-2c4f-48a4-90f2-6f212f2818e3,368207,4,1,3000,,,,2025-01-19 00:27:45,,,,,,,,,true,,,,INVINCIBLE (2021),1,4',
].join('\n');

function tmdbEntry(id, type, { es, en, year, poster = null, seasons = [], isAnime = false } = {}) {
  return {
    id: `tmdb:${type === 'movie' ? 'movie' : 'tv'}:${id}`,
    type,
    isAnime,
    names: { es: es ?? null, en: en ?? null, romaji: null, native: null },
    synopsis: 'sinopsis',
    poster,
    backdrop: null,
    releaseDate: year ? `${year}-01-01` : null,
    status: 'returning',
    genres: [],
    voteAverage: null,
    seasons,
    fetchedAt: '2026-01-01T00:00:00Z',
  };
}

function anilistEntry(id, { type = 'series', romaji, en, native, year, seasons = [] } = {}) {
  return {
    anilistId: id,
    type,
    isAnime: true,
    names: { es: null, en: en ?? null, romaji: romaji ?? null, native: native ?? null },
    synopsis: 'sinopsis',
    poster: null,
    backdrop: null,
    releaseDate: year ? `${year}-01-01` : null,
    status: 'returning',
    genres: [],
    voteAverage: null,
    seasons,
    fetchedAt: '2026-01-01T00:00:00Z',
  };
}

function seasonGrid(n, episodeCount, startN = 1) {
  const episodes = [];
  for (let i = startN; i < startN + episodeCount; i++) {
    episodes.push({ n: i, name: `Ep ${i}`, airDate: `20${String(10 + n)}-01-01`, runtime: 22 });
  }
  return { n, episodes };
}

function makeFetchers({ search, details, anilistSearch = () => [] }) {
  const detailMap = new Map();
  for (const [key, entry] of Object.entries(details || {})) detailMap.set(key, entry);
  return {
    tmdb: {
      async search(query) {
        return search(query) || [];
      },
      async getSeries(id) {
        const entry = detailMap.get(`tmdb:tv:${id}`);
        if (!entry) throw Object.assign(new Error(`no series ${id}`), { code: 'NOT_FOUND' });
        return entry;
      },
      async getMovie(id) {
        const entry = detailMap.get(`tmdb:movie:${id}`);
        if (!entry) throw Object.assign(new Error(`no movie ${id}`), { code: 'NOT_FOUND' });
        return entry;
      },
    },
    anilist: {
      async search(query) {
        return anilistSearch(query) || [];
      },
    },
  };
}

function localIso(y, mo, d, h, mi, s) {
  return new Date(y, mo - 1, d, h, mi, s).toISOString();
}

test('parseCsv maneja comillas, comas, BOM, CRLF y filas cortas', () => {
  const withQuotes = parseCsv('a,b,c\n1,"x,y",3\n4,"say ""hi""",6\n');
  assert.equal(withQuotes.length, 2);
  assert.equal(withQuotes[0].b, 'x,y');
  assert.equal(withQuotes[1].b, 'say "hi"');

  const bom = parseCsv('\uFEFFa,b\n1,2\n');
  assert.deepEqual(bom, [{ a: '1', b: '2' }]);

  const crlf = parseCsv('a,b\r\n1,2\r\n3,4');
  assert.deepEqual(crlf, [{ a: '1', b: '2' }, { a: '3', b: '4' }]);

  const short = parseCsv('a,b,c\n1,2\n');
  assert.deepEqual(short, [{ a: '1', b: '2', c: '' }]);

  const lfOnly = parseCsv('a,b\n1,2\n');
  assert.deepEqual(lfOnly, [{ a: '1', b: '2' }]);

  const empty = parseCsv('');
  assert.deepEqual(empty, []);
});

test('parseTvtimeFile despacha por nombre y mapea v2 (follow + watch + rewatch)', async () => {
  const v2 = await parseTvtimeFile(
    V2_HEADER +
      ',2026-01-18 00:41:24,,88612808,user-series-abc,458960,,,,0,,,2026-01-18 00:41:24,,,1768696884411466,abc,false,true,false,,,,,,"With You, Our Love Will Make It Through",,\n' +
      '5292289,2025-01-03 15:06:13,watch-episode-1735916773,88612808,watch-episode-xyz,275274,5,2,1380,,,,2025-01-03 15:06:13,,,,,,,,,true,,1,,Rick and Morty,2,5\n' +
      '5292289,2025-01-03 15:06:40,watch-episode-1735916800,88612808,rewatch-episode-xyz,275274,5,2,1380,,,,,,,,,,,,,,,,,Rick and Morty,2,5\n' +
      ',2024-12-31 17:43:09,,88612808,tracking-stats,,,,,549,741720,0,2026-07-04 12:23:15,42,0,,,,,,,,,,,,,\n',
    'tracking-prod-records-v2.csv'
  );
  assert.equal(v2.type, 'series-records');
  assert.equal(v2.records.length, 3);
  const follow = v2.records.find((r) => r.kind === 'follow');
  assert.equal(follow.seriesName, 'With You, Our Love Will Make It Through');
  const watch = v2.records.find((r) => r.kind === 'watch-episode');
  assert.equal(watch.seasonN, 2);
  assert.equal(watch.episodeN, 5);
  assert.equal(watch.epId, '5292289');
  assert.equal(watch.createdAt, localIso(2025, 1, 3, 15, 6, 13));
  assert.equal(v2.records.some((r) => r.kind === 'rewatch-episode'), true);
  assert.equal(v2.records.some((r) => r.kind === 'tracking-stats'), false);
});

test('parseTvtimeFile mapea películas (watch/towatch/follow/rewatch) y descarta totales', async () => {
  const movies = await parseTvtimeFile(
    MOVIES_HEADER +
      '88612808,watch-encanto,,,0,watch,2024-12-31 17:43:10,watch-alpha-encanto,movie,2021-11-26 00:00:00,encanto-uuid,watch-release-date-2021-11-26,2024-12-31 17:43:10,,6180,,watch-date-1735666990,,Encanto,,,\n' +
      '88612808,towatch-barbie,,,,towatch,2025-01-14 08:26:54,towatch-alpha-barbie,movie,2023-07-21 00:00:00,barbie-uuid,towatch-release-date-2023-07-21,2025-01-14 08:26:54,,6840,,,,Barbie,,,\n' +
      '88612808,follow-aladdin,,,0,follow,2024-12-31 17:43:10,follow-alpha-aladdin,movie,2019-05-24 00:00:00,aladdin-uuid,follow-release-date-2019-05-24,2024-12-31 17:43:10,,,,,,Aladdin,,,\n' +
      '88612808,rewatch_count-sirat,,,0,rewatch_count,2026-01-17 12:03:03,rewatch_count-alpha-watch-alpha-sirat,movie,2025-11-14 00:00:00,sirat-uuid,rewatch_count-release-date-2025-11-14,2026-01-17 12:03:03,,6900,,,,Sirat,,,\n' +
      '88612808,time-count,,,,time-count,,,,,,,,,,,509400,,,,,,,\n',
    'tracking-prod-records.csv'
  );
  assert.equal(movies.type, 'movie-records');
  assert.equal(movies.records.length, 4);
  const watch = movies.records.find((r) => r.kind === 'watch');
  assert.equal(watch.uuid, 'encanto-uuid');
  assert.equal(watch.movieName, 'Encanto');
  assert.equal(watch.releaseDate, '2021-11-26 00:00:00');
  assert.equal(watch.createdAt, localIso(2024, 12, 31, 17, 43, 10));
  assert.equal(movies.records.some((r) => r.kind === 'towatch'), true);
  assert.equal(movies.records.some((r) => r.kind === 'follow'), true);
  assert.equal(movies.records.some((r) => r.kind === 'rewatch_count'), true);
});

test('parseTvtimeFile ignora ficheros desconocidos', async () => {
  const noise = await parseTvtimeFile('a,b\n1,2\n', 'auth-prod-login.csv');
  assert.equal(noise.type, 'ignore');
});

test('voteToNote mapea la escala real de TVTime (estrellas 1-5 y reacciones de 3 puntos)', () => {
  assert.equal(voteToNote(1), 1);
  assert.equal(voteToNote(27), 2);
  assert.equal(voteToNote(28), 3);
  assert.equal(voteToNote(29), 4);
  assert.equal(voteToNote(3), 5);
  assert.equal(voteToNote(16), 1);
  assert.equal(voteToNote(17), 2);
  assert.equal(voteToNote(18), 3);
  assert.equal(voteToNote(19), 4);
  assert.equal(voteToNote(20), 5);
  assert.equal(voteToNote(0), null);
  assert.equal(voteToNote(50), null);
  assert.equal(voteToNote(100), null);
  assert.equal(voteToNote('3'), 5);
  assert.equal(voteToNote('x'), null);
});

test('buildSeriesLibraryEntryFrom reparte rawVotes solo a los capítulos de la entrada y no muta el origin', () => {
  const origin = { source: 'tvtime', matchedName: 'X', importedAt: '2026-01-01T00:00:00Z' };
  const entry = buildSeriesLibraryEntryFrom(
    { '1x1': ['2026-01-01T10:00:00.000Z'] },
    { '1x1': 29, '2x1': 3 },
    ['1x1'],
    origin
  );
  assert.equal(entry.episodes['1x1'].note, 4);
  assert.deepEqual(entry.origin.rawVotes, { '1x1': 29 }, 'el voto de 2x1 no pertenece a esta entrada');
  assert.equal(origin.rawVotes, undefined, 'el origin del llamador no se muta');
});

test('snippet real de tracking-prod-records-v2.csv: 14 filas, follows, rewatch y nombres con comas', async () => {
  const parsed = await parseTvtimeFile(REAL_V2_SNIPPET, 'tracking-prod-records-v2.csv');
  assert.equal(parsed.records.length, 13);
  const kinds = parsed.records.map((r) => r.kind);
  assert.equal(kinds.filter((k) => k === 'follow').length, 5);
  assert.equal(kinds.filter((k) => k === 'watch-episode').length, 7);
  assert.equal(kinds.filter((k) => k === 'rewatch-episode').length, 1);
  assert.equal(kinds.filter((k) => k === 'tracking-stats').length, 0);

  const items = buildItems([parsed]);
  assert.equal(items.length, 9);

  const rm = items.find((i) => i.name === 'Rick and Morty');
  assert.equal(rm.episodes['2x5'].length, 2);
  assert.equal(rm.episodes['2x5'][0], localIso(2025, 1, 3, 15, 6, 13));
  assert.equal(rm.episodes['2x5'][1], localIso(2025, 1, 3, 15, 6, 40));

  const gumball = items.find((i) => i.name === 'The Amazing World of Gumball');
  assert.deepEqual(gumball.episodes['4x9'], [localIso(2025, 12, 10, 14, 56, 34)]);

  const withYou = items.find((i) => i.name === 'With You, Our Love Will Make It Through');
  assert.equal(withYou.type, 'series');
  assert.deepEqual(withYou.episodes, {});

  const gf = items.find((i) => i.name === 'Gravity Falls');
  assert.deepEqual(Object.keys(gf.episodes), ['2x12']);
  assert.equal(gf.follow, true);
});

test('buildItems no depende del orden de los ficheros: los votos se adjuntan aunque ratings venga antes que tracking', async () => {
  const votes = await parseTvtimeFile(
    EPISODE_VOTES_HEADER +
      '88612808,4344077-88612808-29,4344077,,Gravity Falls,1,5\n' +
      '88612808,4344078-88612808-3,4344078,,Gravity Falls,1,6\n',
    'ratings-3-prod-episode_votes.csv'
  );
  const tracking = await parseTvtimeFile(
    V2_HEADER +
      '4344077,2026-06-27 09:43:50,watch-episode-1782553430,88612808,watch-episode-gf,259972,5,1,1500,,,,2026-06-27 09:43:50,,,,,,,,,true,,,,Gravity Falls,1,5\n',
    'tracking-prod-records-v2.csv'
  );
  const items = buildItems([votes, tracking]);
  const gf = items.find((i) => i.name === 'Gravity Falls');
  assert.ok(gf, 'el item de la serie existe');
  assert.deepEqual(Object.keys(gf.episodes), ['1x5']);
  assert.deepEqual(gf.votes, { '1x5': 29, '1x6': 3 });
});

function basicFetchers() {
  const gfSearch = tmdbEntry(1, 'series', { es: 'Gravity Falls', en: 'Gravity Falls', year: 2012 });
  const gfDetail = tmdbEntry(1, 'series', { es: 'Gravity Falls', en: 'Gravity Falls', year: 2012, seasons: [seasonGrid(1, 7)] });
  const encanto2016 = tmdbEntry(2, 'movie', { en: 'Encanto', year: 2016 });
  const encanto2021 = tmdbEntry(3, 'movie', { en: 'Encanto', year: 2021 });
  const aladdin1992 = tmdbEntry(4, 'movie', { en: 'Aladdin', year: 1992 });
  const aladdin2019 = tmdbEntry(5, 'movie', { en: 'Aladdin', year: 2019 });
  const office = tmdbEntry(6, 'series', { es: 'The Office (Estados Unidos)', en: 'The Office (US)', year: 2005, seasons: [seasonGrid(1, 6)] });
  const searches = new Map();
  searches.set('Gravity Falls', [gfSearch]);
  searches.set('Encanto', [encanto2016, encanto2021]);
  searches.set('Aladdin', [aladdin1992, aladdin2019]);
  searches.set('The Office (US)', [office]);
  searches.set('The Office', [office]);
  return makeFetchers({
    search: (q) => searches.get(q) || [],
    details: {
      'tmdb:tv:1': gfDetail,
      'tmdb:movie:2': encanto2016,
      'tmdb:movie:3': encanto2021,
      'tmdb:movie:4': aladdin1992,
      'tmdb:movie:5': aladdin2019,
      'tmdb:tv:6': office,
    },
  });
}

const END_TO_END_FILES = [
  {
    name: 'tracking-prod-records-v2.csv',
    text:
      V2_HEADER +
      ',2024-12-31 17:43:09,,88612808,user-series-gf,259972,,,,40,,,2026-07-04 12:23:15,,,1782049083118110,gf,false,true,false,,,,,,Gravity Falls,,\n' +
      '4344077,2026-06-27 09:43:50,watch-episode-1782553430,88612808,watch-episode-gf,259972,5,1,1500,,,,2026-06-27 09:43:50,,,,,,,,,true,,,,Gravity Falls,1,5\n' +
      '4344078,2026-06-28 23:44:40,watch-episode-1782690280,88612808,watch-episode-gf,259972,6,1,1500,,,,2026-06-28 23:44:40,,,,,,,,,true,,,,Gravity Falls,1,6\n',
  },
  {
    name: 'tracking-prod-records.csv',
    text:
      MOVIES_HEADER +
      '88612808,watch-encanto,,,0,watch,2024-12-31 17:43:10,watch-alpha-encanto,movie,2021-11-26 00:00:00,encanto-uuid,watch-release-date-2021-11-26,2024-12-31 17:43:10,,6180,,watch-date-1735666990,,Encanto,,,\n' +
      '88612808,follow-aladdin,,,0,follow,2024-12-31 17:43:10,follow-alpha-aladdin,movie,2019-05-24 00:00:00,aladdin-uuid,follow-release-date-2019-05-24,2024-12-31 17:43:10,,,,,,Aladdin,,,\n',
  },
  {
    name: 'ratings-3-prod-episode_votes.csv',
    text: EPISODE_VOTES_HEADER + '88612808,4344077-88612808-29,4344077,,Gravity Falls,1,5\n88612808,4344078-88612808-3,4344078,,Gravity Falls,1,6\n',
  },
  {
    name: 'ratings-live-votes.csv',
    text: MOVIE_VOTES_HEADER + 'encanto-uuid,0,encanto-uuid-88612808-27,88612808,Encanto,,,\naladdin-uuid,0,aladdin-uuid-88612808-28,88612808,Aladdin,,,\n',
  },
  {
    name: 'user_tv_show_data.csv',
    text: USER_SHOWS_HEADER + '73244,1,0,0,The Office (US),88612808\n',
  },
];

test('importAll empareja todo: exacto+año, desambiguación por año, votos, cross-check', async () => {
  const data = emptyData();
  const result = await importAll(data, END_TO_END_FILES, { tmdbApiKey: 'fake-key', fetchers: basicFetchers(), now: '2026-08-15T10:00:00Z' });

  assert.equal(result.summary.matched, 4);
  assert.equal(result.summary.queued, 0);

  const { catalog, library } = result.data;
  assert.equal(Object.keys(catalog).length, 4);
  assert.equal(Object.keys(library).length, 4);

  assert.ok(catalog['tmdb:tv:1']);
  assert.equal(catalog['tmdb:tv:1'].seasons.length, 1);
  const gfEntry = library['tmdb:tv:1'];
  assert.deepEqual(gfEntry.episodes['1x5'].watched, [localIso(2026, 6, 27, 9, 43, 50)]);
  assert.equal(gfEntry.episodes['1x5'].note, 4);
  assert.equal(gfEntry.episodes['1x6'].note, 5);
  assert.equal(gfEntry.note, undefined, 'TVTime no vota series → nota de serie sin rellenar');
  assert.deepEqual(gfEntry.origin, {
    source: 'tvtime',
    matchedName: 'Gravity Falls',
    importedAt: '2026-08-15T10:00:00Z',
    rawVotes: { '1x5': 29, '1x6': 3 },
  });

  assert.ok(catalog['tmdb:movie:3']);
  const encanto = library['tmdb:movie:3'];
  assert.equal(encanto.watched.length, 1);
  assert.equal(encanto.note, 2);
  assert.equal(encanto.origin.rawVote, 27);

  assert.ok(catalog['tmdb:movie:5'], 'Aladdin debe emparejar la versión de 2019');
  const aladdin = library['tmdb:movie:5'];
  assert.equal(aladdin.watched, undefined);
  assert.equal(aladdin.note, 3);
  assert.equal(aladdin.origin.rawVote, 28);

  assert.ok(catalog['tmdb:tv:6']);
  assert.equal(result.reviewItems.length, 0);
});

test('empate de candidatos → cola de revisión con candidatos', async () => {
  const encantoA = tmdbEntry(2, 'movie', { en: 'Encanto', year: 2016 });
  const encantoB = tmdbEntry(3, 'movie', { en: 'Encanto', year: 2021 });
  const fetchers = makeFetchers({
    search: () => [encantoA, encantoB],
    details: { 'tmdb:movie:2': encantoA, 'tmdb:movie:3': encantoB },
  });
  const files = [
    {
      name: 'tracking-prod-records.csv',
      text: MOVIES_HEADER + '88612808,follow-encanto,,,,follow,2024-12-31 17:43:10,follow-alpha-encanto,movie,,encanto-uuid,follow-release-date,2024-12-31 17:43:10,,,,,,Encanto,,,\n',
    },
  ];
  const result = await importAll(emptyData(), files, { tmdbApiKey: 'fake-key', fetchers, now: '2026-08-15T10:00:00Z' });
  assert.equal(result.summary.matched, 0);
  assert.equal(result.summary.queued, 1);
  const review = result.data.review[0];
  assert.equal(review.type, 'pelicula');
  assert.equal(review.reason, 'empate');
  assert.equal(review.candidates.length, 2);
  assert.deepEqual(review.raw.episodes, {});
  assert.equal(review.tvtimeName, 'Encanto');
});

test('series con ≥80% de episodios en un candidato → match aunque haya empate de nombres', async () => {
  const a = tmdbEntry(10, 'series', { en: 'Mystery Show', year: 2020, seasons: [seasonGrid(1, 10)] });
  const b = tmdbEntry(11, 'series', { en: 'Mystery Show', year: 2021, seasons: [seasonGrid(1, 2)] });
  const fetchers = makeFetchers({
    search: () => [a, b],
    details: { 'tmdb:tv:10': a, 'tmdb:tv:11': b },
  });
  let eps = '';
  for (let e = 1; e <= 10; e++) {
    eps += `100${e},2026-01-01 10:00:0${e % 10},watch-episode-x,88612808,watch-episode-y,999,${e},1,600,,,,2026-01-01 10:00:0${e % 10},,,,,,,,,true,,,,Mystery Show,1,${e}\n`;
  }
  const files = [{ name: 'tracking-prod-records-v2.csv', text: V2_HEADER + eps }];
  const result = await importAll(emptyData(), files, { tmdbApiKey: 'fake-key', fetchers, now: '2026-08-15T10:00:00Z' });
  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.queued, 0);
  assert.ok(result.data.catalog['tmdb:tv:10']);
  assert.equal(Object.keys(result.data.library['tmdb:tv:10'].episodes).length, 10);
});

test('división por temporadas (caso Gumball): S1-6 → 2011, S7 → 2025', async () => {
  const gumball2011 = tmdbEntry(20, 'series', { en: 'The Amazing World of Gumball', year: 2011, seasons: [seasonGrid(1, 2), seasonGrid(2, 2), seasonGrid(3, 2), seasonGrid(4, 2)] });
  const gumball2025 = tmdbEntry(21, 'series', { en: 'The Amazing World of Gumball', year: 2025, seasons: [seasonGrid(7, 2)] });
  const fetchers = makeFetchers({
    search: () => [gumball2011, gumball2025],
    details: { 'tmdb:tv:20': gumball2011, 'tmdb:tv:21': gumball2025 },
  });
  const eps = [
    '1,2025-01-01 10:00:00,,88612808,watch-episode-x,1,1,1,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,1,1',
    '2,2025-01-01 10:00:00,,88612808,watch-episode-x,1,2,1,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,1,2',
    '3,2025-01-01 10:00:00,,88612808,watch-episode-x,1,1,2,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,2,1',
    '4,2025-01-01 10:00:00,,88612808,watch-episode-x,1,2,2,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,2,2',
    '5,2025-01-01 10:00:00,,88612808,watch-episode-x,1,1,3,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,3,1',
    '6,2025-01-01 10:00:00,,88612808,watch-episode-x,1,2,3,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,3,2',
    '7,2025-01-01 10:00:00,,88612808,watch-episode-x,1,1,4,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,4,1',
    '8,2025-01-01 10:00:00,,88612808,watch-episode-x,1,2,4,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,4,2',
    '9,2025-01-01 10:00:00,,88612808,watch-episode-x,1,1,7,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,7,1',
    '10,2025-01-01 10:00:00,,88612808,watch-episode-x,1,2,7,600,,,,2025-01-01 10:00:00,,,,,,,,,true,,,,The Amazing World of Gumball,7,2',
  ].join('\n');
  const files = [{ name: 'tracking-prod-records-v2.csv', text: V2_HEADER + eps }];
  const result = await importAll(emptyData(), files, { tmdbApiKey: 'fake-key', fetchers, now: '2026-08-15T10:00:00Z' });
  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.queued, 0);
  const { catalog, library } = result.data;
  assert.ok(catalog['tmdb:tv:20']);
  assert.ok(catalog['tmdb:tv:21']);
  const main = library['tmdb:tv:20'];
  const split = library['tmdb:tv:21'];
  assert.equal(Object.keys(main.episodes).length, 8);
  assert.deepEqual(Object.keys(split.episodes), ['7x1', '7x2']);
  assert.equal(main.origin.matchedName, 'The Amazing World of Gumball');
  assert.equal(split.origin.matchedName, 'The Amazing World of Gumball');
  assert.equal(main.origin.source, 'tvtime');
  assert.equal(split.origin.source, 'tvtime');
});

test('temporada sin resolver con <20% de episodios → match + temporada a la cola', async () => {
  const show = tmdbEntry(30, 'series', { en: 'Half Show', year: 2020, seasons: [seasonGrid(1, 5)] });
  const fetchers = makeFetchers({ search: () => [show], details: { 'tmdb:tv:30': show } });
  const eps = [
    '1,2026-01-01 10:00:00,,88612808,watch-episode-x,1,1,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,1',
    '2,2026-01-01 10:00:00,,88612808,watch-episode-x,1,2,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,2',
    '3,2026-01-01 10:00:00,,88612808,watch-episode-x,1,3,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,3',
    '4,2026-01-01 10:00:00,,88612808,watch-episode-x,1,4,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,4',
    '5,2026-01-01 10:00:00,,88612808,watch-episode-x,1,5,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,5',
    '6,2026-01-01 10:00:00,,88612808,watch-episode-x,1,1,2,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,2,1',
  ].join('\n');
  const files = [{ name: 'tracking-prod-records-v2.csv', text: V2_HEADER + eps }];
  const result = await importAll(emptyData(), files, { tmdbApiKey: 'fake-key', fetchers, now: '2026-08-15T10:00:00Z' });
  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.queued, 1);
  const main = result.data.library['tmdb:tv:30'];
  assert.equal(Object.keys(main.episodes).length, 5);
  const review = result.data.review[0];
  assert.equal(review.type, 'temporada');
  assert.equal(review.reason, 'temporada-sin-resolver');
  assert.deepEqual(Object.keys(review.raw.episodes), ['2x1']);
});

test('>20% de episodios sin resolver → serie entera a revisión', async () => {
  const show = tmdbEntry(31, 'series', { en: 'Half Show', year: 2020, seasons: [seasonGrid(1, 5)] });
  const fetchers = makeFetchers({ search: () => [show], details: { 'tmdb:tv:31': show } });
  const eps = [
    '1,2026-01-01 10:00:00,,88612808,watch-episode-x,1,1,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,1',
    '2,2026-01-01 10:00:00,,88612808,watch-episode-x,1,2,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,2',
    '3,2026-01-01 10:00:00,,88612808,watch-episode-x,1,3,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,3',
    '4,2026-01-01 10:00:00,,88612808,watch-episode-x,1,4,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,4',
    '5,2026-01-01 10:00:00,,88612808,watch-episode-x,1,5,1,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,1,5',
    '6,2026-01-01 10:00:00,,88612808,watch-episode-x,1,1,2,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,2,1',
    '7,2026-01-01 10:00:00,,88612808,watch-episode-x,1,2,2,600,,,,2026-01-01 10:00:00,,,,,,,,,true,,,,Half Show,2,2',
  ].join('\n');
  const files = [{ name: 'tracking-prod-records-v2.csv', text: V2_HEADER + eps }];
  const result = await importAll(emptyData(), files, { tmdbApiKey: 'fake-key', fetchers, now: '2026-08-15T10:00:00Z' });
  assert.equal(result.summary.matched, 0);
  assert.equal(result.summary.queued, 1);
  const review = result.data.review[0];
  assert.equal(review.type, 'serie');
  assert.equal(review.reason, 'episodios-sin-resolver');
});

test('nombre en kanji → AniList primero, luego TMDB con romaji/english', async () => {
  const spiritedAway = anilistEntry(19986, { type: 'movie', native: '千と千尋の神隠し', romaji: 'Sen to Chihiro no Kamikakushi', en: 'Spirited Away', year: 2001 });
  const tmdbSpirited = tmdbEntry(129, 'movie', { es: 'El viaje de Chihiro', en: 'Spirited Away', year: 2001 });
  const fetchers = makeFetchers({
    search: (q) => {
      if (q === 'Spirited Away' || q === 'Sen to Chihiro no Kamikakushi') return [tmdbSpirited];
      return [];
    },
    anilistSearch: (q) => (q === '千と千尋の神隠し' ? [spiritedAway] : []),
    details: { 'tmdb:movie:129': tmdbSpirited },
  });
  const files = [
    {
      name: 'tracking-prod-records.csv',
      text: MOVIES_HEADER + '88612808,follow-spirited-away,,,0,follow,2025-01-05 17:07:18,follow-alpha-spirited-away,movie,2002-04-02 00:00:00,spirited-uuid,follow-release-date-2002-04-02,2025-01-05 17:07:18,,7500,,,,千と千尋の神隠し,,,\n',
    },
  ];
  const result = await importAll(emptyData(), files, { tmdbApiKey: 'fake-key', fetchers, now: '2026-08-15T10:00:00Z' });
  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.queued, 0);
  const entry = result.data.catalog['tmdb:movie:129'];
  assert.ok(entry);
  assert.equal(entry.anilistId, 19986);
  assert.equal(entry.names.native, '千と千尋の神隠し');
  assert.equal(entry.names.romaji, 'Sen to Chihiro no Kamikakushi');
});

test('sin red → todo a la cola con motivo sin-red', async () => {
  const broken = makeFetchers({
    search: () => {
      throw Object.assign(new Error('red caída'), { code: 'TIMEOUT' });
    },
    details: {},
  });
  const files = [
    {
      name: 'tracking-prod-records-v2.csv',
      text: V2_HEADER + ',2026-01-18 00:41:24,,88612808,user-series-abc,458960,,,,0,,,2026-01-18 00:41:24,,,1768696884411466,abc,false,true,false,,,,,,Gravity Falls,,\n',
    },
    {
      name: 'tracking-prod-records.csv',
      text: MOVIES_HEADER + '88612808,watch-encanto,,,0,watch,2024-12-31 17:43:10,watch-alpha-encanto,movie,2021-11-26 00:00:00,encanto-uuid,watch-release-date-2021-11-26,2024-12-31 17:43:10,,6180,,watch-date-1735666990,,Encanto,,,\n',
    },
  ];
  const result = await importAll(emptyData(), files, { tmdbApiKey: 'fake-key', fetchers: broken, now: '2026-08-15T10:00:00Z' });
  assert.equal(result.summary.matched, 0);
  assert.equal(result.summary.queued, 2);
  assert.equal(result.data.review.length, 2);
  for (const review of result.data.review) {
    assert.equal(review.reason, 'sin-red');
    assert.deepEqual(review.candidates, []);
  }
  assert.deepEqual(Object.keys(result.data.library), []);
});

test('un RATE_LIMIT transitorio no hunde el resto del emparejamiento', async () => {
  let calls = 0;
  const fetchers = makeFetchers({
    search: () => [],
    anilistSearch: () => {
      calls += 1;
      if (calls === 11) throw Object.assign(new Error('AniList: Too Many Requests'), { code: 'RATE_LIMIT' });
      return [];
    },
  });
  const rows = [USER_SHOWS_HEADER.trimEnd(), ...Array.from({ length: 20 }, (_, i) => `t${i},1,0,0,Serie ${i},u`)].join('\n');
  const result = await importAll(emptyData(), [{ name: 'user_tv_show_data.csv', text: rows }], { fetchers });
  assert.equal(result.data.review.filter((r) => r.reason === 'sin-red').length, 1);
  assert.equal(calls, 20, 'cada ítem se intenta aunque el anterior fallara');
});

test('un corte de red no impide intentar los ítems siguientes', async () => {
  let calls = 0;
  const fetchers = makeFetchers({
    search: () => [],
    anilistSearch: () => {
      calls += 1;
      if (calls === 11) throw Object.assign(new Error('AniList: error de red'), { code: 'NETWORK' });
      return [];
    },
  });
  const rows = [USER_SHOWS_HEADER.trimEnd(), ...Array.from({ length: 20 }, (_, i) => `t${i},1,0,0,Serie ${i},u`)].join('\n');
  const result = await importAll(emptyData(), [{ name: 'user_tv_show_data.csv', text: rows }], { fetchers });
  assert.equal(result.data.review.filter((r) => r.reason === 'sin-red').length, 1);
  assert.equal(calls, 20, 'cada ítem se intenta aunque el anterior fallara');
});

test('importAll reporta progreso por fases', async () => {
  const phases = [];
  await importAll(emptyData(), END_TO_END_FILES, {
    tmdbApiKey: 'fake-key',
    fetchers: basicFetchers(),
    now: '2026-08-15T10:00:00Z',
    onProgress: (p) => phases.push(p),
  });
  assert.equal(phases[0].phase, 'parse');
  assert.equal(phases.at(-1).phase, 'done');
  assert.equal(phases.at(-1).pct, 1);
  const matchPhases = phases.filter((p) => p.phase === 'match');
  assert.ok(matchPhases.length >= 4);
});
