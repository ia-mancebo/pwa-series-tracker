import { searchAll, posterUrl } from '../search.js';
import { createCache } from '../cache.js';
import { getState } from '../store.js';
import { isFollowed } from '../model.js';
import { followThenOpenDetail, followLabel } from './follow.js';
import { fetchByKey } from '../catalog.js';

export const SEARCH_DEBOUNCE_MS = 1000;

const cache = createCache();
const searchCache = createCache({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxEntries: 300 });

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function apiKey() {
  const data = getState().data;
  return data && data.settings && data.settings.tmdbApiKey ? data.settings.tmdbApiKey : null;
}

function rowHtml(result) {
  const poster = posterUrl(result.poster);
  const meta = [
    result.year,
    result.type === 'movie' ? 'película' : 'serie',
    result.isAnime ? 'anime' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <li class="sr-row" data-key="${esc(result.key)}">
      <img class="sr-poster" src="${poster ? esc(poster) : ''}" alt="" loading="lazy">
      <div class="sr-info">
        <div class="sr-name">${esc(result.name)}</div>
        ${result.altNames.length ? `<div class="sr-alt">${esc(result.altNames.join(' · '))}</div>` : ''}
        <div class="sr-meta">${esc(meta)}</div>
      </div>
    </li>`;
}

function detailHtml(result, followed) {
  const entry = result.entry;
  const poster = posterUrl(entry.poster, 'w500');
  const names = entry.names || {};
  const synopsis = entry.synopsis || '';
  const meta = [
    entry.releaseDate,
    entry.genres && entry.genres.length ? entry.genres.join(', ') : null,
    entry.voteAverage != null ? `★ ${entry.voteAverage.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <section class="sr-detail">
      <button class="sr-back" type="button">← Volver</button>
      <div class="sr-detail-body">
        ${poster ? `<img class="sr-detail-poster" src="${esc(poster)}" alt="">` : ''}
        <div class="sr-detail-info">
          <h4 class="sr-detail-title">${esc(result.name)}</h4>
          ${result.altNames.length ? `<div class="sr-alt">${esc(result.altNames.join(' · '))}</div>` : ''}
          <div class="sr-meta">${esc(meta)}</div>
          ${synopsis ? `<p class="sr-synopsis">${esc(synopsis)}</p>` : ''}
          <button class="sr-follow" type="button" data-key="${esc(result.key)}">${followLabel(followed)}</button>
        </div>
      </div>
    </section>`;
}

function noticeHtml(text, kind = '') {
  return `<div class="sr-notice ${kind}">${esc(text)}</div>`;
}

async function fetchDetail(result) {
  const fromCache = await cache.get(result.key);
  if (fromCache) return fromCache;
  const detail = await fetchByKey(result.key, { tmdbApiKey: apiKey() });
  if (!detail) return null;
  await cache.set(result.key, detail);
  return detail;
}

export function mount(root, { debounceMs = SEARCH_DEBOUNCE_MS } = {}) {
  root.innerHTML = `
    <div class="sr">
      <div class="sr-bar">
        <input class="sr-input" type="search" placeholder="Buscar por título (ES / EN / romaji)…" autocomplete="off">
        <button class="sr-go" type="button">Buscar</button>
      </div>
      <div class="sr-body" data-role="body"></div>
    </div>`;

  const input = root.querySelector('.sr-input');
  const body = root.querySelector('[data-role="body"]');
  let lastQuery = '';
  let timer = null;
  let searchSeq = 0;

  function cancelPendingSearch() {
    clearTimeout(timer);
    timer = null;
    searchSeq += 1;
  }

  function showDetail(result) {
    cancelPendingSearch();
    const stateData = getState().data;
    const library = stateData && stateData.library ? stateData.library : {};
    body.innerHTML = detailHtml(result, isFollowed(library[result.key]));
    body
      .querySelector('.sr-back')
      .addEventListener('click', () => runSearch(lastQuery));
    body
      .querySelector('.sr-follow')
      .addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          await followThenOpenDetail({
            key: button.dataset.key,
            back: 'buscar',
            fetchDetail: () => fetchDetail({ key: button.dataset.key, entry: result.entry }),
          });
        } catch {
          button.textContent = 'Vincula tu fichero primero (Ajustes / primera apertura)';
          button.disabled = false;
        }
      });
  }

  async function runSearch(query) {
    const trimmed = query.trim();
    const seq = ++searchSeq;
    if (!trimmed) {
      body.innerHTML = '';
      return;
    }
    lastQuery = trimmed;
    body.innerHTML = noticeHtml('Buscando…');
    let outcome;
    try {
      outcome = await searchAll(trimmed, { tmdbApiKey: apiKey(), searchCache });
    } catch (error) {
      if (seq !== searchSeq) return;
      const message =
        error && error.message
          ? `Error: ${error.message}`
          : 'Error inesperado.';
      body.innerHTML = noticeHtml(message, 'err');
      return;
    }
    if (seq !== searchSeq) return;
    const { results, warnings = [], fromCache } = outcome;
    const notices = [...warnings];
    if (fromCache) notices.push('mostrando resultados del caché');
    if (!navigator.onLine && !fromCache) notices.push('sin conexión — resultados del caché');
    const html = [];
    if (notices.length) html.push(noticeHtml(notices.join(' · '), 'warn'));
    if (!results.length) {
      html.push(noticeHtml('Sin resultados.'));
    } else {
      html.push('<ul class="sr-list">');
      for (const result of results) html.push(rowHtml(result));
      html.push('</ul>');
    }
    body.innerHTML = html.join('');
    body.querySelectorAll('.sr-row').forEach((row) => {
      row.addEventListener('click', () => {
        const result = results.find((r) => r.key === row.dataset.key);
        if (result) {
          cancelPendingSearch();
          body.innerHTML = noticeHtml('Cargando detalle…');
          fetchDetail(result)
            .then(() => showDetail(result))
            .catch(() => {
              body.innerHTML = noticeHtml('No se pudo cargar el detalle (sin conexión o sin clave TMDB).');
            });
        }
      });
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), debounceMs);
  });
  root.querySelector('.sr-go').addEventListener('click', () => {
    clearTimeout(timer);
    runSearch(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      clearTimeout(timer);
      runSearch(input.value);
    }
  });

  return root;
}
