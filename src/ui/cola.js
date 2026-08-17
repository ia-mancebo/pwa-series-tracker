import { getState, setState, subscribe } from '../store.js';
import { follow } from '../model.js';
import { posterUrl } from '../search.js';
import { buildSeriesLibraryEntryFrom, voteToNote } from '../import.js';

const TYPE_LABEL = { serie: 'Serie', pelicula: 'Película', temporada: 'Temporada' };
const REASON_LABEL = {
  'sin-red': 'Sin conexión al importar',
  'no-encontrado': 'No se encontró el título',
  'empate': 'Empate entre candidatos',
  'episodios-sin-resolver': 'Episodios sin correspondencia',
  'temporada-sin-resolver': 'Temporada sin correspondencia',
  'error': 'Error al importar',
};

let active = null;
let busy = false;

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function apiKey() {
  const data = getState().data;
  return data && data.settings && data.settings.tmdbApiKey ? data.settings.tmdbApiKey : null;
}

export function buildLibraryEntry(reviewItem, now) {
  const raw = reviewItem.raw || {};
  const origin = { source: 'tvtime', matchedName: reviewItem.tvtimeName, importedAt: now };
  if (raw.vote != null) origin.rawVote = raw.vote;

  const sxeList = Object.keys(raw.episodes || {});
  if (sxeList.length) {
    return buildSeriesLibraryEntryFrom(raw.episodes || {}, raw.votes || {}, sxeList, origin);
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

export function ensureEntryId(entry) {
  if (entry && typeof entry.id === 'string' && entry.id) return entry;
  if (entry && entry.anilistId != null) return { ...entry, id: `anilist:${entry.anilistId}` };
  return entry;
}

export async function fetchCandidateDetail(candidate, opts = {}) {
  const key = candidate && candidate.key;
  if (!key) return null;
  if (key.startsWith('tmdb:tv:')) {
    const id = key.split(':').pop();
    if (opts.fetchers) return opts.fetchers.tmdb.getSeries(id, opts.tmdbApiKey);
    const { getSeries } = await import('../tmdb.js');
    return getSeries(id, opts.tmdbApiKey);
  }
  if (key.startsWith('tmdb:movie:')) {
    const id = key.split(':').pop();
    if (opts.fetchers) return opts.fetchers.tmdb.getMovie(id, opts.tmdbApiKey);
    const { getMovie } = await import('../tmdb.js');
    return getMovie(id, opts.tmdbApiKey);
  }
  if (key.startsWith('anilist:')) {
    const id = key.split(':').pop();
    if (opts.fetchers) return opts.fetchers.anilist.getById(Number(id));
    const { getById } = await import('../anilist.js');
    return getById(Number(id));
  }
  return null;
}

export function resolveIntoData(data, reviewItem, catalogEntry, opts = {}) {
  const now = opts.now || new Date().toISOString();
  const built = buildLibraryEntry(reviewItem, now);
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

export async function resolveCandidate(data, reviewItem, candidate, opts = {}) {
  let detail;
  try {
    detail = await fetchCandidateDetail(candidate, opts);
  } catch {
    detail = null;
  }
  if (!detail) return null;
  return resolveIntoData(data, reviewItem, ensureEntryId(detail), { now: opts.now });
}

export function discardFromReview(data, reviewId, opts = {}) {
  const review = (data.review || []).filter((item) => item.id !== reviewId);
  if (review.length === (data.review || []).length) return data;
  const now = opts.now || new Date().toISOString();
  return { ...data, meta: { ...data.meta, updatedAt: now }, review };
}

function typeMeta(reviewItem) {
  const raw = reviewItem.raw || {};
  const parts = [];
  if (reviewItem.type === 'temporada' && raw.season != null) parts.push(`Temporada ${raw.season}`);
  else if (TYPE_LABEL[reviewItem.type]) parts.push(TYPE_LABEL[reviewItem.type]);
  const episodeCount = Object.keys(raw.episodes || {}).length;
  if (episodeCount > 0) parts.push(`${episodeCount} ${episodeCount === 1 ? 'episodio' : 'episodios'}`);
  parts.push(REASON_LABEL[reviewItem.reason] || reviewItem.reason);
  return parts.join(' · ');
}

function candidateThumbHtml(candidate) {
  const url = posterUrl(candidate.poster, 'w92');
  if (url) return `<img class="lib-thumb-img" src="${esc(url)}" alt="" loading="lazy">`;
  const initial = (candidate.name || '?').charAt(0).toUpperCase();
  return `<span class="lib-thumb-fallback">${esc(initial)}</span>`;
}

function candidateHtml(candidate) {
  const year = candidate.year ? String(candidate.year) : null;
  return `
    <li class="cola-cand" data-key="${esc(candidate.key)}">
      <span class="lib-thumb">${candidateThumbHtml(candidate)}</span>
      <span class="sr-info">
        <span class="sr-name">${esc(candidate.name || candidate.key)}</span>
        ${year ? `<span class="sr-meta">${esc(year)}</span>` : ''}
      </span>
      <button type="button" class="aj-btn cola-choose" data-key="${esc(candidate.key)}">Elegir</button>
    </li>`;
}

function pendingHtml(reviewItem) {
  const candidates = reviewItem.candidates || [];
  const cards = candidates.map(candidateHtml).join('');
  return `
    <li class="cola-pending" data-id="${esc(reviewItem.id)}">
      <div class="cola-head">
        <h4 class="cola-name">${esc(reviewItem.tvtimeName)}</h4>
        <span class="cola-meta">${esc(typeMeta(reviewItem))}</span>
      </div>
      <ul class="cola-cands">${cards || '<li class="cola-nocands">Sin candidatos.</li>'}</ul>
      <div class="cola-actions">
        <button type="button" class="aj-btn ghost cola-discard">Descartar</button>
      </div>
    </li>`;
}

function emptyStateHtml() {
  return `
    <section class="placeholder">
      <h3 class="placeholder-title">Vincula tu fichero primero</h3>
      <p class="placeholder-text">La cola de revisión guarda lo que la importación no pudo emparejar. Ábrelo para resolver tus pendientes.</p>
      <button type="button" class="file-btn" data-role="open-file">Abrir fichero</button>
    </section>`;
}

function renderBody() {
  const body = active.body;
  const review = (getState().data && getState().data.review) || [];
  if (review.length === 0) {
    body.innerHTML = '<div class="cola-empty">No hay pendientes de revisión.</div>';
    return;
  }
  body.innerHTML = `<ul class="cola-list">${review.map(pendingHtml).join('')}</ul>`;
  body.querySelectorAll('.cola-choose').forEach((button) => {
    button.addEventListener('click', () => {
      const pending = button.closest('.cola-pending');
      const reviewItem = review.find((item) => item.id === pending.dataset.id);
      const candidate = (reviewItem && reviewItem.candidates || []).find((c) => c.key === button.dataset.key);
      if (reviewItem && candidate) choose(reviewItem, candidate, button);
    });
  });
  body.querySelectorAll('.cola-discard').forEach((button) => {
    button.addEventListener('click', () => {
      const pending = button.closest('.cola-pending');
      const reviewItem = review.find((item) => item.id === pending.dataset.id);
      if (reviewItem) discard(reviewItem);
    });
  });
}

function setBusy(next) {
  busy = next;
  const root = active && active.root;
  if (!root) return;
  root.querySelectorAll('.cola-choose, .cola-discard').forEach((button) => {
    button.disabled = next;
  });
}

async function choose(reviewItem, candidate, button) {
  const data = getState().data;
  if (!data || busy) return;
  const label = button.textContent;
  setBusy(true);
  button.textContent = 'Cargando…';
  try {
    const next = await resolveCandidate(data, reviewItem, candidate, { tmdbApiKey: apiKey() });
    if (!next) throw new Error('sin detalle');
    setState({ data: next });
  } catch {
    button.textContent = 'No se pudo cargar (sin conexión o sin clave TMDB)';
    setTimeout(() => {
      if (button.isConnected) button.textContent = label;
    }, 3000);
  } finally {
    setBusy(false);
  }
}

function discard(reviewItem) {
  const data = getState().data;
  if (!data || busy) return;
  setState({ data: discardFromReview(data, reviewItem.id) });
}

function renderAll() {
  const root = active.root;
  if (!getState().data) {
    active.hasData = false;
    root.innerHTML = emptyStateHtml();
    const openButton = root.querySelector('[data-role="open-file"]');
    if (openButton) {
      openButton.addEventListener('click', () => {
        if (window.tvtimeOpenFile) window.tvtimeOpenFile();
      });
    }
    return;
  }
  active.hasData = true;
  root.innerHTML = '<div class="cola"><div class="cola-body" data-role="body"></div></div>';
  active.body = root.querySelector('[data-role="body"]');
  renderBody();
}

export function mount(root) {
  active = { root, hasData: Boolean(getState().data) };
  renderAll();
  return root;
}

subscribe(() => {
  if (!active || !active.root || !active.root.isConnected) return;
  if (active.hasData !== Boolean(getState().data)) {
    renderAll();
    return;
  }
  if (!active.body || !active.root.contains(active.body)) return;
  renderBody();
});
