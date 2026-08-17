import { SEARCH_DEBOUNCE_MS } from './buscar.js';
import { searchAll, resultRowHtml } from '../search.js';
import { createCache } from '../cache.js';
import { getState } from '../store.js';

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

function noticeHtml(text, kind = '') {
  return `<div class="sr-notice ${kind}">${esc(text)}</div>`;
}

function matchesType(result, type) {
  return type === 'pelicula' ? result.type === 'movie' : result.type === 'series';
}

export function mountPicker(root, { onPick, type }) {
  const overlay = document.createElement('div');
  overlay.className = 'picker';
  overlay.innerHTML = `
    <div class="picker-card">
      <div class="sr-bar">
        <input class="sr-input" type="search" placeholder="Buscar por título (ES / EN / romaji)…" autocomplete="off">
        <button class="sr-go" type="button">Buscar</button>
      </div>
      <div class="picker-body" data-role="body"></div>
      <div class="picker-actions">
        <button type="button" class="aj-btn ghost picker-cancel">Cancelar</button>
      </div>
    </div>`;

  const input = overlay.querySelector('.sr-input');
  const go = overlay.querySelector('.sr-go');
  const cancel = overlay.querySelector('.picker-cancel');
  const body = overlay.querySelector('[data-role="body"]');
  let timer = null;
  let searchSeq = 0;

  function cancelPendingSearch() {
    clearTimeout(timer);
    timer = null;
    searchSeq += 1;
  }

  function close() {
    cancelPendingSearch();
    overlay.remove();
  }

  async function runSearch(query) {
    const trimmed = query.trim();
    const seq = ++searchSeq;
    if (!trimmed) {
      body.innerHTML = '';
      return;
    }
    body.innerHTML = noticeHtml('Buscando…');
    let outcome;
    try {
      outcome = await searchAll(trimmed, { tmdbApiKey: apiKey(), searchCache });
    } catch (error) {
      if (seq !== searchSeq) return;
      const message = error && error.message ? `Error: ${error.message}` : 'Error inesperado.';
      body.innerHTML = noticeHtml(message, 'err');
      return;
    }
    if (seq !== searchSeq) return;
    const { results, warnings = [], fromCache } = outcome;
    const filtered = results.filter((result) => matchesType(result, type));
    const notices = [...warnings];
    if (fromCache) notices.push('mostrando resultados del caché');
    if (!navigator.onLine && !fromCache) notices.push('sin conexión — resultados del caché');
    const html = [];
    if (notices.length) html.push(noticeHtml(notices.join(' · '), 'warn'));
    if (!filtered.length) {
      html.push(noticeHtml('Sin resultados.'));
    } else {
      html.push('<ul class="sr-list">');
      for (const result of filtered) html.push(resultRowHtml(result));
      html.push('</ul>');
    }
    body.innerHTML = html.join('');
    body.querySelectorAll('.sr-row').forEach((row) => {
      row.addEventListener('click', () => {
        const result = filtered.find((r) => r.key === row.dataset.key);
        if (result) {
          close();
          onPick(result);
        }
      });
    });
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), SEARCH_DEBOUNCE_MS);
  });
  go.addEventListener('click', () => {
    clearTimeout(timer);
    runSearch(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      clearTimeout(timer);
      runSearch(input.value);
    }
  });
  cancel.addEventListener('click', close);
  overlay.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  root.appendChild(overlay);
  input.focus();

  return { close };
}