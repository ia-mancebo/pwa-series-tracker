import { getState, setState, subscribe } from '../store.js';
import { isFollowed } from '../model.js';
import { followThenOpenDetail, followLabel } from './follow.js';
import { posterUrl } from '../search.js';
import { createCache } from '../cache.js';
import * as tmdb from '../tmdb.js';
import { computeNewEpisodes, computePremieres, groupByAnime } from '../news.js';
import { openDetail, pushHistory, setInlineBack, clearInlineBack, goBack } from '../nav.js';

const cache = createCache();
const PREMIERES_CACHE_KEY = 'news-premieres';
const ESTRENO_TABS = [
  ['todo', 'Todo'],
  ['series', 'Series'],
  ['peliculas', 'Películas'],
  ['anime', 'Anime'],
];

let active = null;
let feedTab = 'feed';
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

function seriesName(key) {
  const catalog = (getState().data && getState().data.catalog) || {};
  return displayName(catalog[key]) || key;
}

function episodeRowHtml(item) {
  const label = `S${item.seasonN}E${item.episodeN}${item.name ? ` — ${item.name}` : ''}`;
  return `
    <li class="nov-ep" data-key="${esc(item.key)}" tabindex="0" role="button">
      <span class="nov-ep-main">
        <span class="nov-ep-series">${esc(seriesName(item.key))}</span>
        <span class="nov-ep-label">${esc(label)}</span>
      </span>
      <span class="nov-ep-date">${esc(formatDate(item.airDate) || item.airDate)}</span>
    </li>`;
}

function groupRowHtml(item) {
  const label = item.complete
    ? `Temporada ${item.seasonN} completa`
    : `S${item.seasonN} E${item.startN}–E${item.endN} · ${item.count} capítulos`;
  return `
    <li class="nov-ep nov-ep-group" data-key="${esc(item.key)}" tabindex="0" role="button">
      <span class="nov-ep-main">
        <span class="nov-ep-series">${esc(seriesName(item.key))}</span>
        <span class="nov-ep-label">${esc(label)}</span>
      </span>
      <span class="nov-ep-date">${esc(formatDate(item.airDate) || item.airDate)}</span>
    </li>`;
}

function feedRowHtml(item) {
  return item.kind === 'group' ? groupRowHtml(item) : episodeRowHtml(item);
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

function detailHtml(premiere, detail, followed) {
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
          <button class="nov-follow" type="button" data-key="${esc(premiere.key)}">${followLabel(followed)}</button>
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

function closePremiereDetail() {
  clearInlineBack();
  active.premiereKey = null;
  renderEstrenos();
}

function renderNotices() {
  if (!active || !active.noticesEl) return;
  const notices = [];
  if (!navigator.onLine) notices.push('sin conexión — novedades computadas de los datos locales');
  active.noticesEl.innerHTML = notices.length ? notices.map((n) => noticeHtml(n, 'warn')).join('') : '';
}

function renderFeed() {
  if (!active || !active.feedEl || !active.root.isConnected) return;
  const data = getState().data;
  if (!data) return;
  const episodes = computeNewEpisodes(data, new Date());
  if (episodes.length) {
    active.feedEl.innerHTML = `<ul class="nov-list">${episodes.map(feedRowHtml).join('')}</ul>`;
    active.feedEl.querySelectorAll('.nov-ep').forEach((row) => {
      const open = () => openDetail({ key: row.dataset.key, back: 'novedades' });
      row.addEventListener('click', open);
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });
  } else {
    active.feedEl.innerHTML = '<div class="nov-empty">Sin capítulos nuevos fuera de la marca de agua y de la ventana de Novedades.</div>';
  }
}

function renderEstrenos() {
  if (!active || !active.premieresEl || !active.root.isConnected) return;
  const data = getState().data;
  if (!data) return;
  const now = new Date();
  const premieres = computePremieres(data, discoverResults, now);
  const groups = groupByAnime(premieres);

  const statusNotices = [];
  if (discoverStatus === 'stale') statusNotices.push(noticeHtml('sin conexión — estrenos del caché (pueden no estar al día)', 'warn'));
  if (discoverStatus === 'loading') statusNotices.push(noticeHtml('Cargando estrenos…'));
  if (active.estrenosStatusEl) active.estrenosStatusEl.innerHTML = statusNotices.join('');

  if (discoverStatus === 'no-key') {
    active.premieresEl.innerHTML = noticeHtml('Sin clave de TMDB — solo AniList. Los estrenos solo están disponibles con una clave TMDB (Ajustes).', 'warn');
    return;
  }
  if (discoverStatus === 'error') {
    active.premieresEl.innerHTML = noticeHtml('No se pudieron cargar los estrenos. Revisa tu conexión o la clave TMDB, o pulsa Actualizar estrenos.');
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
        const library = data && data.library ? data.library : {};
        active.premieresEl.innerHTML = detailHtml(premiere, detail, isFollowed(library[premiere.key]));
        active.premieresEl.querySelector('[data-action="detail-back"]').addEventListener('click', goBack);
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
      pushHistory();
      setInlineBack(closePremiereDetail);
      renderEstrenos();
      if (!details.has(active.premiereKey)) {
        fetchDetail(active.premiereKey)
          .then((detail) => {
            if (detail) details.set(active.premiereKey, detail);
            renderEstrenos();
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
      await followThenOpenDetail({
        key,
        back: 'novedades',
        fetchDetail: () => details.get(key) || fetchDetail(key),
      });
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
      <div class="lib-seg nov-tabs" data-role="tabs">
        <button type="button" class="${feedTab === 'feed' ? 'act' : ''}" data-tab="feed">Novedades de lo que sigo</button>
        <button type="button" class="${feedTab === 'estrenos' ? 'act' : ''}" data-tab="estrenos">Estrenos de lo que no sigo</button>
      </div>
      <div class="nov-notices" data-role="notices"></div>
      <div class="nov-pane" data-role="pane-feed">
        <div data-role="feed"></div>
      </div>
      <div class="nov-pane" data-role="pane-estrenos"${feedTab === 'estrenos' ? '' : ' hidden'}>
        <div class="nov-top">
          <button type="button" class="det-btn" data-action="refresh">Actualizar estrenos</button>
        </div>
        <div class="lib-seg" data-role="seg">
          ${ESTRENO_TABS.map(
            ([value, label]) =>
              `<button type="button" class="${estrenoTab === value ? 'act' : ''}" data-tab="${value}">${label}</button>`
          ).join('')}
        </div>
        <div class="nov-notices" data-role="estrenos-status"></div>
        <div data-role="premieres"></div>
      </div>
    </div>`;
}

function applyFeedTab() {
  if (!active || !active.root || !active.root.isConnected) return;
  const feed = active.root.querySelector('[data-role="pane-feed"]');
  const estrenos = active.root.querySelector('[data-role="pane-estrenos"]');
  if (feed) feed.hidden = feedTab !== 'feed';
  if (estrenos) estrenos.hidden = feedTab !== 'estrenos';
  active.root.querySelectorAll('[data-role="tabs"] button').forEach((button) => {
    button.classList.toggle('act', button.dataset.tab === feedTab);
  });
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
    renderEstrenos();
    return;
  }
  if (!navigator.onLine) {
    await loadCachedPremieres();
    renderEstrenos();
    return;
  }
  if (!force && (discoverStatus === 'ok' || discoverStatus === 'stale' || discoverStatus === 'loading')) return;
  discoverStatus = 'loading';
  renderEstrenos();
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
      renderEstrenos();
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
  active.feedEl = root.querySelector('[data-role="feed"]');
  active.estrenosStatusEl = root.querySelector('[data-role="estrenos-status"]');
  active.premieresEl = root.querySelector('[data-role="premieres"]');
  root.querySelector('[data-role="tabs"]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    feedTab = button.dataset.tab;
    applyFeedTab();
  });
  root.querySelector('[data-role="seg"]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tab]');
    if (!button) return;
    estrenoTab = button.dataset.tab;
    updateTabs(root);
    renderEstrenos();
  });
  root.querySelector('[data-action="refresh"]').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Actualizando…';
    await fetchPremieres(true);
    button.disabled = false;
    button.textContent = 'Actualizar estrenos';
  });
  renderNotices();
  renderFeed();
  renderEstrenos();
  applyFeedTab();
  void fetchPremieres();
}

export function mount(root) {
  feedTab = 'feed';
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
  if (!active.feedEl || !active.root.contains(active.feedEl)) return;
  renderNotices();
  renderFeed();
  renderEstrenos();
});

window.addEventListener('online', () => {
  if (active && active.root && active.root.isConnected && active.hasData) void fetchPremieres(true);
});
window.addEventListener('offline', () => {
  if (active && active.root && active.root.isConnected) {
    renderNotices();
    renderFeed();
    renderEstrenos();
  }
});
