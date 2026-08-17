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

function rawSeasonOf(reviewItem) {
  if (reviewItem && reviewItem.type === 'temporada' && reviewItem.raw && reviewItem.raw.season != null) {
    return Number(reviewItem.raw.season);
  }
  return null;
}

function remapSxe(sxe, season) {
  return `${season}x${String(sxe).split('x')[1]}`;
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

export async function resolveCandidate(data, reviewItem, candidate, opts = {}) {
  let detail;
  try {
    detail = await fetchCandidateDetail(candidate, opts);
  } catch {
    detail = null;
  }
  if (!detail) return null;
  const entry = ensureEntryId(detail);
  if (typeof opts.onEntry === 'function') {
    const intercepted = opts.onEntry(entry);
    if (intercepted) return data;
  }
  return resolveIntoData(data, reviewItem, entry, { now: opts.now, season: opts.season });
}

export function discardFromReview(data, reviewId, opts = {}) {
  const review = (data.review || []).filter((item) => item.id !== reviewId);
  if (review.length === (data.review || []).length) return data;
  const now = opts.now || new Date().toISOString();
  return { ...data, meta: { ...data.meta, updatedAt: now }, review };
}

function episodeCountLabel(count) {
  return `${count} ${count === 1 ? 'episodio' : 'episodios'}`;
}

function typeMeta(reviewItem) {
  const raw = reviewItem.raw || {};
  const parts = [];
  if (reviewItem.type === 'temporada' && raw.season != null) parts.push(`Temporada ${raw.season}`);
  else if (TYPE_LABEL[reviewItem.type]) parts.push(TYPE_LABEL[reviewItem.type]);
  const episodeCount = Object.keys(raw.episodes || {}).length;
  if (episodeCount > 0) parts.push(episodeCountLabel(episodeCount));
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
    const next = await resolveCandidate(data, reviewItem, candidate, {
      tmdbApiKey: apiKey(),
      now: new Date().toISOString(),
      onEntry: (entry) => {
        const info = seasonPickerInfo(reviewItem, entry);
        if (!info) return false;
        showSeasonPicker(reviewItem, candidate, entry, info, button);
        return true;
      },
    });
    if (next === null) throw new Error('sin detalle');
    if (next !== data) setState({ data: next });
    button.textContent = label;
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

function regularSeasonNumbers(catalogEntry) {
  if (!catalogEntry || catalogEntry.type !== 'series' || !Array.isArray(catalogEntry.seasons)) return [];
  const nums = catalogEntry.seasons.map((season) => Number(season.n)).filter((n) => Number.isFinite(n) && n > 0);
  return [...new Set(nums)].sort((a, b) => a - b);
}

function seasonPickerInfo(reviewItem, entry) {
  const rawSeason = rawSeasonOf(reviewItem);
  if (rawSeason == null) return null;
  const catalogSeasons = regularSeasonNumbers(entry);
  if (!catalogSeasons.length || catalogSeasons.includes(rawSeason)) return null;
  return { rawSeason, catalogSeasons };
}

function showSeasonPicker(reviewItem, candidate, catalogEntry, info, restoreFocus) {
  const root = active && active.root;
  if (!root) return;
  const previous = root.querySelector('.cola-season-picker');
  if (previous) previous.remove();
  const { rawSeason, catalogSeasons } = info;
  const episodeCount = Object.keys((reviewItem.raw && reviewItem.raw.episodes) || {}).length;
  const previousFocus =
    restoreFocus && typeof restoreFocus.focus === 'function' ? restoreFocus : document.activeElement;
  const picker = document.createElement('div');
  picker.className = 'cola-season-picker';
  picker.innerHTML = `
    <div class="cola-season-card">
      <h4 class="cola-name">${esc(reviewItem.tvtimeName)}</h4>
      <p class="cola-season-text">La temporada ${esc(String(rawSeason))} de TVTime (${episodeCountLabel(episodeCount)}) no existe en «${esc(candidate.name || candidate.key)}». ¿A qué temporada del catálogo corresponde?</p>
      <div class="cola-season-opts">
        ${catalogSeasons.map((n) => `<button type="button" class="aj-btn cola-season-opt" data-season="${n}">Temporada ${n}</button>`).join('')}
      </div>
      <div class="cola-actions">
        <button type="button" class="aj-btn ghost cola-season-cancel">Cancelar</button>
      </div>
    </div>`;
  const close = () => {
    picker.remove();
    if (previousFocus && typeof previousFocus.focus === 'function' && previousFocus.isConnected) {
      previousFocus.focus();
    }
  };
  picker.querySelector('.cola-season-opts').addEventListener('click', (event) => {
    const button = event.target.closest('[data-season]');
    if (!button) return;
    picker.remove();
    const next = resolveIntoData(getState().data, reviewItem, catalogEntry, {
      now: new Date().toISOString(),
      season: Number(button.dataset.season),
    });
    setState({ data: next });
  });
  picker.querySelector('.cola-season-cancel').addEventListener('click', close);
  picker.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });
  root.appendChild(picker);
  const firstOption = picker.querySelector('.cola-season-opt');
  if (firstOption) firstOption.focus();
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
