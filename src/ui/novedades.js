import { getState, setState, subscribe } from '../store.js';
import { addToLibrary } from '../model.js';
import { posterUrl } from '../search.js';
import { createCache } from '../cache.js';
import * as tmdb from '../tmdb.js';
import { computeNewEpisodes, computePremieres, groupByAnime } from '../news.js';

const cache = createCache();
const PREMIERES_CACHE_KEY = 'news-premieres';
const ESTRENO_TABS = [
  ['todo', 'Todo'],
  ['series', 'Series'],
  ['peliculas', 'Películas'],
  ['anime', 'Anime'],
];

let active = null;
let estrenoTab = 'todo';
let discoverStatus = 'idle';
let discoverResults = [];
let fetchPromise = null;
const details = new Map();

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function apiKey() {
  const data = getState().data;
  return data && data.settings && typeof data.settings.tmdbApiKey === 'string' ? data.settings.tmdbApiKey : '';
}

function displayName(entry) {
  const names = (entry && entry.names) || {};
  return names.es || names.en || names.romaji || names.native || '';
}

function altNames(entry) {
  const names = (entry && entry.names) || {};
  const main = displayName(entry);
  return [...new Set([names.en, names.romaji, names.native].filter((n) => n && n !== main))].join(' · ');
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('es');
}

function noticeHtml(text, kind = '') {
  return `<div class="nov-notice ${kind}">${esc(text)}</div>`;
}

function emptyStateHtml() {
  return `
    <section class="placeholder">
      <h3 class="placeholder-title">Vincula tu fichero primero</h3>
      <p class="placeholder-text">Tus novedades se computan desde tu fichero único: capítulos nuevos de lo que sigues y estrenos recientes de TMDB.</p>
      <button type="button" class="file-btn" data-role="open-file">Abrir fichero</button>
    </section>`;
}

function episodeRowHtml(item) {
  const label = `S${item.seasonN}E${item.episodeN}${item.name ? ` — ${item.name}` : ''}`;
  return `
    <li class="nov-ep" data-key="${esc(item.key)}" tabindex="0" role="button">
      <span class="nov-ep-main">
        <span class="nov-ep-series">${esc(displayName((getState().data.catalog || {})[item.key]) || item.key)}</span>
        <span class="nov-ep-label">${esc(label)}</span>
      </span>
      <span class="nov-ep-date">${esc(formatDate(item.airDate) || item.airDate)}</span>
    </li>`;
}

function typeLabel(premiere) {
  const base = premiere.type === 'movie' ? 'película' : 'serie';
  return premiere.isAnime ? `${base} · anime` : base;
}

function premiereRowHtml(premiere) {
  const poster = posterUrl(premiere.poster, 'w92');
  const meta = [premiere.year, typeLabel(premiere)].filter(Boolean).join(' · ');
  return `
    <li class="nov-prem" data-key="${esc(premiere.key)}" tabindex="0" role="button">
      ${poster ? `<img class="nov-prem-poster" src="${esc(poster)}" alt="" loading="lazy">` : ''}
      <div class="nov-prem-info">
        <div class="nov-prem-name">${esc(premiere.name)}</div>
        ${premiere.altNames.length ? `<div class="nov-prem-alt">${esc(premiere.altNames.join(' · '))}</div>` : ''}
        <div class="nov-prem-meta">${esc(meta)}</div>
      </div>
    </li>`;
}

function detailHtml(premiere, detail) {
  const poster = posterUrl(detail.poster, 'w500');
  const names = detail.names || {};
  const alt = [...new Set([names.en, names.romaji, names.native].filter((n) => n && n !== displayName(detail)))].join(' · ');
  const meta = [
    detail.releaseDate,
    detail.genres && detail.genres.length ? detail.genres.join(', ') : null,
    detail.voteAverage != null ? `★ ${detail.voteAverage.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <section class="nov-detail">
      <button class="det-back" type="button" data-action="detail-back">← Volver</button>
      <div class="nov-detail-body">
        ${poster ? `<img class="nov-detail-poster" src="${esc(poster)}" alt="">` : ''}
        <div class="nov-detail-info">
          <h4 class="nov-detail-title">${esc(displayName(detail) || premiere.name)}</h4>
          ${alt ? `<div class="nov-prem-alt">${esc(alt)}</div>` : ''}
          <div class="nov-prem-meta">${esc(meta)}</div>
          ${detail.synopsis ? `<p class="nov-synopsis">${esc(detail.synopsis)}</p>` : ''}
          <button class="nov-follow" type="button" data-key="${esc(premiere.key)}">Seguir</button>
        </div>
      </div>
    </section>`;
}

async function fetchDetail(key) {
  const fromCache = await cache.get(key);
  if (fromCache) return fromCache;
  const id = key.split(':').pop();
  let detail;
  if (key.startsWith('tmdb:tv:')) detail = await tmdb.getSeries(id, apiKey());
  else if (key.startsWith('tmdb:movie:')) detail = await tmdb.getMovie(id, apiKey());
  else return null;
  if (!detail) return null;
  await cache.set(key, detail);
  return detail;
}

function visiblePremieres(premieres, groups) {
  if (estrenoTab === 'anime') return groups.anime;
  if (estrenoTab === 'series') return groups.series;
  if (estrenoTab === 'peliculas') return groups.movies;
  return premieres;
}

function renderBody() {
  if (!active || !active.root || !active.root.isConnected) return;
  const data = getState().data;
  if (!data) return;
  const now = new Date();
  const episodes = computeNewEpisodes(data, now);
  const premieres = computePremieres(data, discoverResults, now);
  const groups = groupByAnime(premieres);

  const notices = [];
  if (!navigator.onLine) notices.push('sin conexión — novedades computadas de los datos locales');
  if (discoverStatus === 'stale') notices.push('sin conexión — estrenos del caché (pueden no estar al día)');
  if (discoverStatus === 'loading') notices.push('Cargando estrenos…');
  active.noticesEl.innerHTML = notices.length ? notices.map((n) => noticeHtml(n, 'warn')).join('') : '';

  if (episodes.length) {
    active.episodesEl.innerHTML = `<ul class="nov-list">${episodes.map(episodeRowHtml).join('')}</ul>`;
    active.episodesEl.querySelectorAll('.nov-ep').forEach((row) => {
      const open = () => setState({ screen: 'detalle', detailKey: row.dataset.key, detailBack: 'novedades' });
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });
  } else {
    active.episodesEl.innerHTML = '<div class="nov-empty">Sin capítulos nuevos fuera de la marca de agua.</div>';
  }

  if (discoverStatus === 'no-key') {
    active.premieresEl.innerHTML = noticeHtml('Sin clave de TMDB — solo AniList. Los estrenos solo están disponibles con una clave TMDB (Ajustes).', 'warn');
    return;
  }
  if (discoverStatus === 'error') {
    active.premieresEl.innerHTML = noticeHtml('No se pudieron cargar los estrenos. Revisa tu conexión o la clave TMDB, o pulsa Actualizar novedades.');
    return;
  }
  const visible = visiblePremieres(premieres, groups);
  if (active.premiereKey) {
    if (!visible.some((p) => p.key === active.premiereKey)) active.premiereKey = null;
    else {
      const detail = details.get(active.premiereKey);
      if (!detail) active.premieresEl.innerHTML = noticeHtml('Cargando detalle…');
      else {
        const premiere = premieres.find((p) => p.key === active.premiereKey);
        active.premieresEl.innerHTML = detailHtml(premiere, detail);
        active.premieresEl.querySelector('[data-action="detail-back"]').addEventListener('click', () => {
          active.premiereKey = null;
          renderBody();
        });
        wireFollow();
      }
      return;
    }
  }
  if (!visible.length) {
    active.premieresEl.innerHTML = '<div class="nov-empty">Sin estrenos recientes en los últimos 30 días.</div>';
    return;
  }
  active.premieresEl.innerHTML = `<ul class="nov-list">${visible.map(premiereRowHtml).join('')}</ul>`;
  active.premieresEl.querySelectorAll('.nov-prem').forEach((row) => {
    const open = () => {
      active.premiereKey = row.dataset.key;
      renderBody();
      if (!details.has(active.premiereKey)) {
        fetchDetail(active.premiereKey)
          .then((detail) => {
            if (detail) details.set(active.premiereKey, detail);
            renderBody();
          })
          .catch(() => {
            if (active && active.premieresEl && active.premiereKey) {
              active.premieresEl.innerHTML = noticeHtml('No se pudo cargar el detalle (sin conexión o sin clave TMDB).', 'err');
            }
          });
      }
    };
    row.addEventListener('click', open);
    row.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}

function wireFollow() {
  const button = active.premieresEl.querySelector('.nov-follow');
  if (!button) return;
  button.addEventListener('click', async () => {
    const key = button.dataset.key;
    button.disabled = true;
    try {
      const detail = details.get(key) || (await fetchDetail(key));
      if (!detail) throw new Error('no detail');
      const state = getState();
      if (!state.data) throw new Error('no data');
      const next = addToLibrary(state.data, { ...detail, id: key });
      setState({ data: next });
    } catch {
      button.textContent = 'Vincula tu fichero primero (Ajustes / primera apertura)';
      button.disabled = false;
    }
  });
}

function updateTabs(root) {
  root.querySelectorAll('[data-role="seg"] button').forEach((button) => {
    button.classList.toggle('act', button.dataset.tab === estrenoTab);
  });
}

function shellHtml() {
  return `
    <div class="nov">
      <div class="nov-top">
        <button type="button" class="det-btn" data-action="refresh">Actualizar novedades</button>
      </div>
      <div class="nov-notices" data-role="notices"></div>
      <section class="nov-group">
        <h3 class="nov-title">Capítulos nuevos de lo que sigues</h3>
        <div data-role="episodes"></div>
      </section>
      <section class="nov-group">
        <h3 class="nov-title">Estrenos</h3>
        <div class="lib-seg" data-role="seg">
          ${ESTRENO_TABS.map(
            ([value, label]) =>
              `<button type="button" class="${estrenoTab === value ? 'act' : ''}" data-tab="${value}">${label}</button>`
          ).join('')}
        </div>
        <div data-role="premieres"></div>
      </section>
    </div>`;
}

async function loadCachedPremieres() {
  try {
    const stale = await cache.get(PREMIERES_CACHE_KEY);
    if (stale && Array.isArray(stale.results)) {
      discoverResults = stale.results;
      discoverStatus = 'stale';
      return;
    }
  } catch {
    // ignore
  }
  discoverResults = [];
  discoverStatus = 'error';
}

async function fetchPremieres(force = false) {
  if (fetchPromise) return fetchPromise;
  const data = getState().data;
  if (!data) {
    discoverStatus = 'idle';
    return;
  }
  const key = apiKey();
  if (!key) {
    discoverStatus = 'no-key';
    discoverResults = [];
    renderBody();
    return;
  }
  if (!navigator.onLine) {
    await loadCachedPremieres();
    renderBody();
    return;
  }
  if (!force && (discoverStatus === 'ok' || discoverStatus === 'stale' || discoverStatus === 'loading')) return;
  discoverStatus = 'loading';
  renderBody();
  fetchPromise = (async () => {
    try {
      const [series, seriesAnime, movies, moviesAnime] = await Promise.all([
        tmdb.discover({ type: 'series', anime: false, apiKey: key }),
        tmdb.discover({ type: 'series', anime: true, apiKey: key }),
        tmdb.discover({ type: 'movie', anime: false, apiKey: key }),
        tmdb.discover({ type: 'movie', anime: true, apiKey: key }),
      ]);
      discoverResults = [...series, ...seriesAnime, ...movies, ...moviesAnime];
      discoverStatus = 'ok';
      try {
        await cache.set(PREMIERES_CACHE_KEY, { fetchedAt: new Date().toISOString(), results: discoverResults });
      } catch {
        // offline caché no disponible: seguimos con memoria
      }
    } catch {
      await loadCachedPremieres();
    } finally {
      fetchPromise = null;
      renderBody();
    }
  })();
  return fetchPromise;
}

function renderAll() {
  const root = active.root;
  const data = getState().data;
  active.hasData = Boolean(data);
  if (!data) {
    root.innerHTML = emptyStateHtml();
    const openButton = root.querySelector('[data-role="open-file"]');
    if (openButton) {
      openButton.addEventListener('click', () => {
        if (window.tvtimeOpenFile) window.tvtimeOpenFile();
      });
    }
    return;
  }
  root.innerHTML = shellHtml();
  active.noticesEl = root.querySelector('[data-role="notices"]');
  active.episodesEl = root.querySelector('[data-role="episodes"]');
  active.premieresEl = root.querySelector('[data-role="premieres"]');
  root.querySelector('[data-role="seg"]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    estrenoTab = button.dataset.tab;
    updateTabs(root);
    renderBody();
  });
  root.querySelector('[data-action="refresh"]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Actualizando…';
    await fetchPremieres(true);
    button.disabled = false;
    button.textContent = 'Actualizar novedades';
  });
  renderBody();
  void fetchPremieres();
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
  if (!active.episodesEl || !active.root.contains(active.episodesEl)) return;
  renderBody();
});

window.addEventListener('online', () => {
  if (active && active.root && active.root.isConnected && active.hasData) void fetchPremieres(true);
});
window.addEventListener('offline', () => {
  if (active && active.root && active.root.isConnected) renderBody();
});
