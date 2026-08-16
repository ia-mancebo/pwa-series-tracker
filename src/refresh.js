const EPISODES_TTL_MS = 60 * 60 * 1000;
const FULL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const BATCH_LABEL = 'AniList';

function emptyResult(data) {
  return { data, updated: [], skipped: [], errors: [] };
}

function keyParts(key, entry) {
  if (key.startsWith('tmdb:tv:')) {
    return { provider: 'tmdb', type: 'series', id: key.slice('tmdb:tv:'.length) };
  }
  if (key.startsWith('tmdb:movie:')) {
    return { provider: 'tmdb', type: 'movie', id: key.slice('tmdb:movie:'.length) };
  }
  if (key.startsWith('anilist:')) {
    return { provider: 'anilist', type: entry && entry.type, id: Number(key.slice('anilist:'.length)) };
  }
  return null;
}

function ageOf(entry, now) {
  const ts = Date.parse(entry && entry.fetchedAt);
  return Number.isNaN(ts) ? Number.POSITIVE_INFINITY : now.getTime() - ts;
}

function shouldSkip(entry, parts) {
  if (!entry || entry.status !== 'ended') return false;
  if (parts.provider === 'tmdb') return parts.type === 'series';
  return true;
}

function needsRefresh(entry, parts, now, force) {
  if (force) return true;
  const ttl = parts.type === 'movie' ? FULL_TTL_MS : EPISODES_TTL_MS;
  return ageOf(entry, now) > ttl;
}

function buildPlan(data, now, force) {
  const tmdbOps = [];
  const batchItems = [];
  const skipped = [];
  for (const [key, entry] of Object.entries(data.catalog)) {
    const parts = keyParts(key, entry);
    if (!parts) continue;
    if (shouldSkip(entry, parts)) {
      skipped.push(key);
      continue;
    }
    if (!needsRefresh(entry, parts, now, force)) continue;
    if (parts.provider === 'tmdb') tmdbOps.push({ key, parts });
    else batchItems.push({ key, parts });
  }
  const ops = [...tmdbOps];
  if (batchItems.length) ops.push({ kind: 'batch', items: batchItems });
  return { ops, skipped };
}

function mergeDetail(key, oldEntry, fresh, now) {
  const names = { ...(fresh.names || {}) };
  if (oldEntry && oldEntry.anilistId != null && oldEntry.names) {
    names.romaji = names.romaji ?? oldEntry.names.romaji ?? null;
    names.native = names.native ?? oldEntry.names.native ?? null;
  }
  const merged = { ...fresh, id: key, names, fetchedAt: now.toISOString() };
  if (merged.anilistId == null && oldEntry && oldEntry.anilistId != null) {
    merged.anilistId = oldEntry.anilistId;
  }
  return merged;
}

function withWatermark(watermark, key, now) {
  const base = watermark && typeof watermark === 'object' && !Array.isArray(watermark) ? watermark : {};
  return { ...base, [key]: now.toISOString() };
}

function labelOf(entry) {
  const names = entry && entry.names ? entry.names : {};
  return names.es || names.en || names.romaji || names.native || '';
}

async function fetchTmdb(op, deps) {
  return op.parts.type === 'series'
    ? await deps.tmdb.getSeries(op.parts.id, deps.tmdbApiKey)
    : await deps.tmdb.getMovie(op.parts.id, deps.tmdbApiKey);
}

async function refreshBatch(items, catalog, deps, now) {
  const updated = [];
  const errors = [];
  const ids = items.map((item) => item.parts.id);
  let freshList;
  try {
    freshList = await deps.anilist.batchGetByIds(ids);
  } catch (error) {
    for (const item of items) errors.push({ key: item.key, error });
    return { updated, errors };
  }
  const byId = new Map();
  for (const fresh of freshList) {
    if (fresh && fresh.anilistId != null) byId.set(fresh.anilistId, fresh);
  }
  for (const item of items) {
    const fresh = byId.get(item.parts.id);
    if (!fresh) {
      const error = new Error(`AniList: no devolvió el título ${item.parts.id}`);
      error.code = 'NOT_FOUND';
      errors.push({ key: item.key, error });
      continue;
    }
    catalog[item.key] = mergeDetail(item.key, catalog[item.key], fresh, now);
    updated.push(item.key);
  }
  return { updated, errors };
}

export async function refreshLibrary(data, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const force = options.force === true;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  if (!data || !data.catalog || typeof data.catalog !== 'object') return emptyResult(data);
  const { ops, skipped } = buildPlan(data, now, force);
  if (!ops.length) return { ...emptyResult(data), skipped };
  const total = ops.reduce((sum, op) => sum + (op.kind === 'batch' ? op.items.length : 1), 0);
  let done = 0;
  const catalog = { ...data.catalog };
  const updated = [];
  const errors = [];
  onProgress(0, total, '');
  for (const op of ops) {
    if (op.kind === 'batch') {
      const result = await refreshBatch(op.items, catalog, options, now);
      updated.push(...result.updated);
      errors.push(...result.errors);
      done += op.items.length;
      onProgress(done, total, BATCH_LABEL);
      continue;
    }
    const label = labelOf(catalog[op.key]);
    try {
      const fresh = await fetchTmdb(op, options);
      catalog[op.key] = mergeDetail(op.key, catalog[op.key], fresh, now);
      updated.push(op.key);
    } catch (error) {
      errors.push({ key: op.key, error });
    }
    done += 1;
    onProgress(done, total, label);
  }
  if (!updated.length) return { data, updated, skipped, errors };
  const meta = { ...data.meta, updatedAt: now.toISOString(), lastRefresh: now.toISOString() };
  for (const key of updated) {
    if (catalog[key] && catalog[key].type === 'series') {
      meta.watermark = withWatermark(meta.watermark, key, now);
    }
  }
  return { data: { ...data, meta, catalog }, updated, skipped, errors };
}

export async function refreshOne(data, key, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  if (!data || !data.catalog || !data.catalog[key]) {
    return {
      data,
      updated: [],
      skipped: [],
      errors: [{ key, error: new Error('Título no encontrado en la biblioteca.') }],
    };
  }
  const entry = data.catalog[key];
  const parts = keyParts(key, entry);
  if (!parts) {
    return {
      data,
      updated: [],
      skipped: [],
      errors: [{ key, error: new Error(`Clave no canónica: ${key}`) }],
    };
  }
  let fresh;
  try {
    fresh =
      parts.provider === 'anilist'
        ? await options.anilist.getById(parts.id)
        : await fetchTmdb({ parts }, options);
  } catch (error) {
    return { data, updated: [], skipped: [], errors: [{ key, error }] };
  }
  const catalog = { ...data.catalog, [key]: mergeDetail(key, entry, fresh, now) };
  const meta = { ...data.meta, updatedAt: now.toISOString(), lastRefresh: now.toISOString() };
  if (fresh.type === 'series') meta.watermark = withWatermark(meta.watermark, key, now);
  return { data: { ...data, meta, catalog }, updated: [key], skipped: [], errors: [] };
}

export function refreshAll(data, options = {}) {
  return refreshLibrary(data, { ...options, force: true });
}
