import { getState, setState, subscribe } from '../store.js';
import { seriesState, movieState, episodeKey, isFollowed } from '../model.js';
import { posterUrl, normalizeName } from '../search.js';
import { openDetail } from '../nav.js';

const STATE_LABEL = { paraver: 'Para ver', viendo: 'Viendo', visto: 'Visto' };
const STATE_ORDER = { viendo: 0, paraver: 1, visto: 2 };
const TYPE_CHIPS = [
  ['serie', 'Serie'],
  ['pelicula', 'Película'],
  ['anime', 'Anime'],
];
const STATE_CHIPS = [
  ['todo', 'Todo'],
  ['paraver', 'Para ver'],
  ['viendo', 'Viendo'],
  ['visto', 'Visto'],
];

let active = null;
let filterEstado = 'todo';
let filterTipos = new Set();
let filterTexto = '';

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function isAired(episode, now) {
  if (!episode || typeof episode.airDate !== 'string' || episode.airDate === '') return false;
  return !Number.isNaN(Date.parse(episode.airDate)) && episode.airDate <= new Date(now).toISOString().slice(0, 10);
}

function displayName(catalogEntry) {
  const names = (catalogEntry && catalogEntry.names) || {};
  return names.es || names.en || names.romaji || names.native || '';
}

function altNames(catalogEntry) {
  const names = (catalogEntry && catalogEntry.names) || {};
  const main = displayName(catalogEntry);
  return [...new Set([names.en, names.romaji, names.native].filter((n) => n && n !== main))].join(' · ');
}

function typeLabel(catalogEntry) {
  if (!catalogEntry) return '—';
  const base = catalogEntry.type === 'movie' ? 'Película' : 'Serie';
  return catalogEntry.isAnime ? `${base} · anime` : base;
}

function yearOf(catalogEntry) {
  return catalogEntry && catalogEntry.releaseDate ? String(catalogEntry.releaseDate).slice(0, 4) : null;
}

function seriesProgress(libraryEntry, catalogEntry, now) {
  const episodes = (libraryEntry && libraryEntry.episodes) || {};
  let aired = 0;
  let watched = 0;
  for (const season of (catalogEntry && catalogEntry.seasons) || []) {
    if (Number(season.n) === 0) continue;
    for (const ep of season.episodes || []) {
      if (!isAired(ep, now)) continue;
      aired += 1;
      const marks = episodes[episodeKey(season.n, ep.n)];
      if (marks && Array.isArray(marks.watched) && marks.watched.length > 0) watched += 1;
    }
  }
  return { aired, watched };
}

function buildRows() {
  const data = getState().data;
  const now = new Date();
  const rows = [];
  for (const [key, libraryEntry] of Object.entries((data && data.library) || {})) {
    if (!isFollowed(libraryEntry)) continue;
    const catalogEntry = (data.catalog || {})[key];
    const state =
      catalogEntry && catalogEntry.type === 'movie'
        ? movieState(libraryEntry)
        : seriesState(libraryEntry, catalogEntry, now);
    rows.push({ key, libraryEntry, catalogEntry, state });
  }
  return rows;
}

export function matchesText(row, query) {
  const q = normalizeName(query);
  if (!q) return true;
  const entry = row.catalogEntry;
  const hay = normalizeName(
    [displayName(entry), altNames(entry), entry && entry.names ? entry.names.es : null, row.key].join(' ')
  );
  if (hay.includes(q)) return true;
  return q.split(' ').every((token) => hay.includes(token));
}

function filterRows(rows) {
  return rows.filter((row) => {
    if (filterEstado !== 'todo' && row.state !== filterEstado) return false;
    if (!matchesText(row, filterTexto)) return false;
    if (filterTipos.size === 0) return true;
    const entry = row.catalogEntry;
    const isSerie = !!entry && entry.type === 'series';
    const isPelicula = !!entry && entry.type === 'movie';
    const isAnime = !!entry && entry.isAnime;
    return (
      (filterTipos.has('serie') && isSerie) ||
      (filterTipos.has('pelicula') && isPelicula) ||
      (filterTipos.has('anime') && isAnime)
    );
  });
}

function sortRows(rows) {
  return [...rows].sort((a, b) => {
    const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
    if (byState !== 0) return byState;
    return displayName(a.catalogEntry).localeCompare(displayName(b.catalogEntry), 'es', { sensitivity: 'base' });
  });
}

function progressText(row, now) {
  const catalogEntry = row.catalogEntry;
  if (!catalogEntry) return '—';
  if (catalogEntry.type === 'movie') return row.state === 'visto' ? 'Vista' : '—';
  const { aired, watched } = seriesProgress(row.libraryEntry, catalogEntry, now);
  return aired === 0 ? '—' : `${watched}/${aired}`;
}

function stateChipHtml(state) {
  return `<span class="lib-chip lib-chip--${state}">${STATE_LABEL[state]}</span>`;
}

function thumbHtml(catalogEntry) {
  const url = posterUrl(catalogEntry && catalogEntry.poster, 'w92');
  if (url) return `<img class="lib-thumb-img" src="${esc(url)}" alt="" loading="lazy">`;
  const initial = (displayName(catalogEntry) || '?').charAt(0).toUpperCase();
  const anime = catalogEntry && catalogEntry.isAnime;
  return `<span class="lib-thumb-fallback ${anime ? 'lib-thumb-fallback--anime' : ''}">${esc(initial)}</span>`;
}

function rowHtml(row, now) {
  const name = displayName(row.catalogEntry) || row.key;
  const alt = altNames(row.catalogEntry);
  return `
    <li class="lib-row" data-key="${esc(row.key)}" tabindex="0" role="button">
      <span class="lib-thumb">${thumbHtml(row.catalogEntry)}</span>
      <span class="lib-info">
        <span class="lib-name">${esc(name)}</span>
        ${alt ? `<span class="lib-alt">${esc(alt)}</span>` : ''}
        <span class="lib-progress">${esc(progressText(row, now))}</span>
      </span>
      ${stateChipHtml(row.state)}
    </li>`;
}

function tableRowHtml(row, now) {
  const name = displayName(row.catalogEntry) || row.key;
  const alt = altNames(row.catalogEntry);
  const year = yearOf(row.catalogEntry);
  const sub = [alt, year].filter(Boolean).join(' · ');
  const note = row.libraryEntry && row.libraryEntry.note;
  return `
    <tr class="lib-tr" data-key="${esc(row.key)}" tabindex="0" role="button">
      <td class="lib-td-thumb"><span class="lib-thumb lib-thumb--small">${thumbHtml(row.catalogEntry)}</span></td>
      <td class="lib-col-title">
        <span class="lib-title-main">${esc(name)}</span>
        ${sub ? `<span class="lib-title-sub">${esc(sub)}</span>` : ''}
      </td>
      <td class="lib-td lib-col-type">${esc(typeLabel(row.catalogEntry))}</td>
      <td class="lib-td lib-col-state">${stateChipHtml(row.state)}</td>
      <td class="lib-td lib-col-progress">${esc(progressText(row, now))}</td>
      <td class="lib-td lib-col-note">${note ? `<span class="lib-stars">${'★'.repeat(note)}${'☆'.repeat(5 - note)}</span>` : '—'}</td>
    </tr>`;
}

function emptyStateHtml() {
  return `
    <section class="placeholder">
      <h3 class="placeholder-title">Vincula tu fichero primero</h3>
      <p class="placeholder-text">Tu biblioteca vive en tu fichero único. Ábrelo para ver tus títulos por estado, con filtros de serie, película y anime.</p>
      <button type="button" class="file-btn" data-role="open-file">Abrir fichero</button>
    </section>`;
}

function emptyResultHtml() {
  const emptyLibrary = Object.keys((getState().data && getState().data.library) || {}).length === 0;
  return `
    <div class="lib-empty">
      Nada por aquí.
      ${emptyLibrary ? '<span class="lib-empty-hint">Tu biblioteca está vacía: busca títulos en la pestaña Buscar y pulsa Seguir.</span>' : ''}
    </div>`;
}

function renderBody() {
  const body = active.body;
  const now = new Date();
  const rows = sortRows(filterRows(buildRows()));
  if (rows.length === 0) {
    body.innerHTML = emptyResultHtml();
  } else {
    body.innerHTML = `
      <ul class="lib-list">${rows.map((row) => rowHtml(row, now)).join('')}</ul>
      <div class="lib-table-wrap">
        <table class="lib-table">
          <thead>
            <tr>
              <th class="lib-col-thumb" aria-hidden="true"></th>
              <th>Título</th>
              <th class="lib-col-type">Tipo</th>
              <th class="lib-col-state">Estado</th>
              <th class="lib-col-progress">Progreso</th>
              <th class="lib-col-note">Nota</th>
            </tr>
          </thead>
          <tbody>${rows.map((row) => tableRowHtml(row, now)).join('')}</tbody>
        </table>
      </div>`;
  }
  body.querySelectorAll('.lib-row, .lib-tr').forEach((element) => {
    element.addEventListener('click', () => openTitle(element.dataset.key));
    element.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openTitle(element.dataset.key);
      }
    });
  });
}

function openTitle(key) {
  openDetail({ key, back: 'biblioteca' });
}

function shellHtml() {
  return `
    <div class="lib">
      <div class="lib-search">
        <input class="lib-search-input" type="search" placeholder="Buscar en tu biblioteca…" autocomplete="off" value="${esc(filterTexto)}" data-role="search">
      </div>
      <div class="lib-seg" data-role="seg">
        ${STATE_CHIPS.map(
          ([value, label]) =>
            `<button type="button" class="${filterEstado === value ? 'act' : ''}" data-estado="${value}">${label}</button>`
        ).join('')}
      </div>
      <div class="lib-chips" data-role="chips">
        ${TYPE_CHIPS.map(
          ([value, label]) =>
            `<button type="button" class="lib-chip ${filterTipos.has(value) ? 'activo' : ''}" data-tipo="${value}">${label}</button>`
        ).join('')}
      </div>
      <div class="lib-body" data-role="body"></div>
    </div>`;
}

function updateFilterButtons(root) {
  root.querySelectorAll('[data-role="seg"] button').forEach((button) => {
    button.classList.toggle('act', button.dataset.estado === filterEstado);
  });
  root.querySelectorAll('[data-role="chips"] button').forEach((button) => {
    button.classList.toggle('activo', filterTipos.has(button.dataset.tipo));
  });
}

function wireShell(root) {
  const searchInput = root.querySelector('[data-role="search"]');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      filterTexto = searchInput.value;
      renderBody();
    });
  }
  root.querySelector('[data-role="seg"]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-estado]');
    if (!button) return;
    filterEstado = button.dataset.estado;
    updateFilterButtons(root);
    renderBody();
  });
  root.querySelector('[data-role="chips"]').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tipo]');
    if (!button) return;
    const tipo = button.dataset.tipo;
    if (filterTipos.has(tipo)) filterTipos.delete(tipo);
    else filterTipos.add(tipo);
    updateFilterButtons(root);
    renderBody();
  });
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
  root.innerHTML = shellHtml();
  active.body = root.querySelector('[data-role="body"]');
  wireShell(root);
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
