import { getState, setState, subscribe } from '../store.js';
import {
  toggleEpisodeWatched,
  markSeasonWatched,
  setEpisodeNote,
  setTitleNote as writeTitleNote,
  toggleMovieWatched,
  seasonState,
  seriesState,
  movieState,
  rewatchCount,
  episodeKey,
  isFollowed,
  follow,
  unfollow,
} from '../model.js';
import { posterUrl } from '../search.js';
import { goBack } from '../nav.js';

const STATE_LABEL = { paraver: 'Para ver', viendo: 'Viendo', visto: 'Visto' };

let active = null;
let toastTimer = null;

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
  const base = catalogEntry.type === 'movie' ? 'Película' : 'Serie';
  return catalogEntry.isAnime ? `${base} · anime` : base;
}

function yearOf(catalogEntry) {
  return catalogEntry && catalogEntry.releaseDate ? String(catalogEntry.releaseDate).slice(0, 4) : null;
}

function formatDate(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('es');
}

function stateChipHtml(state) {
  return `<span class="lib-chip lib-chip--${state}">${STATE_LABEL[state]}</span>`;
}

function starsHtml(value) {
  return `<span class="det-stars">${[1, 2, 3, 4, 5]
    .map(
      (i) =>
        `<button type="button" class="det-star ${value >= i ? 'on' : ''}" data-v="${i}" aria-label="${i} de 5">★</button>`
    )
    .join('')}</span>`;
}

function posterHtml(catalogEntry) {
  const url = posterUrl(catalogEntry && catalogEntry.poster, 'w500');
  if (url) return `<img class="det-poster" src="${esc(url)}" alt="">`;
  const initial = (displayName(catalogEntry) || '?').charAt(0).toUpperCase();
  const anime = catalogEntry && catalogEntry.isAnime;
  return `<span class="det-poster det-poster--fallback ${anime ? 'det-poster--anime' : ''}">${esc(initial)}</span>`;
}

function movieHtml(libraryEntry, note) {
  const watched = libraryEntry && Array.isArray(libraryEntry.watched) ? libraryEntry.watched : [];
  const history = watched
    .map((ts, i) => {
      const date = formatDate(ts);
      return date ? `<div class="det-history-item">${i === 0 ? 'Visto' : `Rewatch ${i}`} · ${date}</div>` : null;
    })
    .filter(Boolean);
  const rew = rewatchCount(libraryEntry);
  return `
    <div class="det-movie-card">
      <div class="det-note-row"><span class="det-note-label">Mi nota</span>${starsHtml(note)}</div>
      <button type="button" class="det-btn det-btn--primary" data-action="toggle-movie">${
        watched.length ? 'Marcar como no vista' : 'Marcar como vista'
      }</button>
      ${history.length ? `<div class="det-history">${history.join('')}</div>` : ''}
      ${rew > 0 ? `<div class="det-mini">${rew} rewatch${rew === 1 ? '' : 's'}</div>` : ''}
      <div class="det-mini">estado derivado: ${esc(STATE_LABEL[movieState(libraryEntry)])} — no se guarda</div>
    </div>`;
}

function seasonProgressText(libraryEntry, season, now) {
  const episodes = (libraryEntry && libraryEntry.episodes) || {};
  const aired = (season.episodes || []).filter((ep) => isAired(ep, now));
  let watched = 0;
  for (const ep of aired) {
    const marks = episodes[episodeKey(season.n, ep.n)];
    if (marks && Array.isArray(marks.watched) && marks.watched.length > 0) watched += 1;
  }
  return aired.length === 0 ? '—' : `${watched}/${aired.length} visto`;
}

function episodeHtml(libraryEntry, season, ep, now) {
  const sxe = episodeKey(season.n, ep.n);
  const marks = ((libraryEntry && libraryEntry.episodes) || {})[sxe];
  const watched = marks && Array.isArray(marks.watched) && marks.watched.length > 0;
  const note = marks && marks.note;
  const firstTs = watched ? String(marks.watched[0]) : '';
  const dateStr = !Number.isNaN(Date.parse(firstTs)) ? firstTs.slice(0, 10) : '';
  const name = ep.name ? `${ep.n} · ${esc(ep.name)}` : `Capítulo ${ep.n}`;
  const meta = [ep.airDate ? formatDate(ep.airDate) : null, ep.runtime ? `${ep.runtime} min` : null]
    .filter(Boolean)
    .join(' · ');
  return `
    <div class="det-ep" data-sxe="${esc(sxe)}">
      <button type="button" class="det-ep-check" data-action="toggle-ep" aria-pressed="${watched ? 'true' : 'false'}" aria-label="${
        watched ? 'Desmarcar capítulo' : 'Marcar capítulo como visto'
      }">${watched ? '✓' : ''}</button>
      <button type="button" class="det-ep-body" data-action="toggle-ep">
        <span class="det-ep-name">${name}</span>
        ${meta ? `<span class="det-ep-meta">${esc(meta)}</span>` : ''}
      </button>
      <div class="det-ep-side">
        ${starsHtml(note)}
        ${watched ? `<input class="det-date" type="date" value="${esc(dateStr)}" data-sxe="${esc(sxe)}" aria-label="Fecha de visionado">` : ''}
      </div>
    </div>`;
}

function seasonBlockHtml(libraryEntry, season, now, isSpecial) {
  const state = seasonState(libraryEntry, season, now);
  const complete = state === 'visto';
  return `
    <section class="det-season">
      <div class="det-season-head">
        <div class="det-season-title">
          <span class="det-season-name">${isSpecial ? 'Especiales' : `Temporada ${season.n}`}</span>
          ${stateChipHtml(state)}
        </div>
        <span class="det-season-prog">${esc(seasonProgressText(libraryEntry, season, now))}</span>
        <button type="button" class="det-season-check" data-action="mark-season" data-n="${season.n}" aria-pressed="${complete ? 'true' : 'false'}" aria-label="${complete ? 'Temporada completa marcada' : 'Marcar temporada completa'}">${complete ? '✓' : ''}</button>
      </div>
      ${isSpecial ? '<div class="det-mini det-special-note">No cuentan para el estado de la serie.</div>' : ''}
      ${(season.episodes || []).map((ep) => episodeHtml(libraryEntry, season, ep, now)).join('')}
    </section>`;
}

function seriesHtml(key, libraryEntry, catalogEntry, now) {
  const regular = (catalogEntry.seasons || [])
    .filter((s) => Number(s.n) !== 0)
    .sort((a, b) => a.n - b.n);
  const specialSeasons = (catalogEntry.seasons || []).filter((s) => Number(s.n) === 0);
  const specials =
    specialSeasons.length > 0
      ? [{ n: 0, episodes: specialSeasons.flatMap((s) => s.episodes || []) }]
      : [];
  return `
    <div class="det-seasons">
      ${regular.map((s) => seasonBlockHtml(libraryEntry, s, now, false)).join('')}
      ${specials.map((s) => seasonBlockHtml(libraryEntry, s, now, true)).join('')}
    </div>`;
}

function notFoundHtml() {
  return `
    <section class="placeholder">
      <h3 class="placeholder-title">Título no encontrado</h3>
      <p class="placeholder-text">Este título no está en tu biblioteca.</p>
      <button type="button" class="file-btn" data-action="back">← Biblioteca</button>
    </section>`;
}

function renderAll() {
  const root = active.root;
  const state = getState();
  const data = state.data;
  const key = state.detail && state.detail.key;
  const catalogEntry = data && data.catalog && key ? data.catalog[key] : null;
  active.data = data;
  active.key = key;

  if (!data || !catalogEntry) {
    root.innerHTML = notFoundHtml();
    return;
  }

  const libraryEntry = (data.library && data.library[key]) || {};
  const inLibrary = !!(data.library && data.library[key]);
  const now = new Date();
  const isMovie = catalogEntry.type === 'movie';
  const derived = isMovie ? movieState(libraryEntry) : seriesState(libraryEntry, catalogEntry, now);
  const note = libraryEntry.note;
  const meta = [
    yearOf(catalogEntry),
    catalogEntry.genres && catalogEntry.genres.length ? catalogEntry.genres.join(', ') : null,
    catalogEntry.voteAverage != null ? `★ ${catalogEntry.voteAverage.toFixed(1)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const alt = altNames(catalogEntry);
  const synopsis = catalogEntry.synopsis;

  root.innerHTML = `
    <section class="det">
      <div class="det-top">
        <button type="button" class="det-back" data-action="back">← Volver</button>
        <button type="button" class="det-btn det-btn--ghost" data-action="refresh">Actualizar metadatos</button>
        ${inLibrary ? `<button type="button" class="det-btn det-btn--primary" data-action="toggle-follow">${isFollowed(libraryEntry) ? 'Dejar de seguir' : 'Seguir'}</button>` : ''}
      </div>
      <div class="det-grid">
        <div class="det-left">
          ${posterHtml(catalogEntry)}
          <h3 class="det-title">${esc(displayName(catalogEntry) || key)}</h3>
          ${alt ? `<div class="det-alt">${esc(alt)}</div>` : ''}
          <div class="det-chips">
            <span class="lib-chip">${esc(typeLabel(catalogEntry))}</span>
            ${stateChipHtml(derived)}
          </div>
          ${meta ? `<div class="det-meta">${esc(meta)}</div>` : ''}
          ${synopsis ? `<p class="det-synopsis">${esc(synopsis)}</p>` : ''}
          ${isMovie ? '' : `<div class="det-note-row"><span class="det-note-label">Mi nota</span>${starsHtml(note)}</div>`}
          <div class="det-mini">estado derivado: ${esc(STATE_LABEL[derived])} — no se guarda</div>
          <div class="det-mini">id: ${esc(key)}</div>
        </div>
        <div class="det-right">
          ${isMovie ? movieHtml(libraryEntry, note) : seriesHtml(key, libraryEntry, catalogEntry, now)}
        </div>
      </div>
    </section>`;
}

function tsFromDate(dateStr) {
  const parts = dateStr.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null;
  const now = new Date();
  const dt = new Date(parts[0], parts[1] - 1, parts[2], now.getHours(), now.getMinutes(), now.getSeconds());
  return dt.toISOString();
}

function mutate(fn) {
  const data = getState().data;
  if (!data) return;
  setState({ data: fn(data) });
}

function handleStar(star) {
  const value = Number(star.dataset.v);
  const ep = star.closest('.det-ep');
  if (ep) {
    const sxe = ep.dataset.sxe;
    mutate((data) => {
      const entry = (data.library && data.library[active.key]) || {};
      const marks = (entry.episodes && entry.episodes[sxe]) || null;
      const current = marks ? marks.note : null;
      return setEpisodeNote(data, active.key, sxe, current === value ? null : value);
    });
  } else {
    mutate((data) => {
      const entry = data.library && data.library[active.key];
      const current = entry ? entry.note : null;
      return writeTitleNote(data, active.key, current === value ? null : value);
    });
  }
}

function toast(text) {
  const root = active.root;
  const old = root.querySelector('.det-toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'det-toast';
  el.textContent = text;
  root.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 2400);
}

function wire(root) {
  root.addEventListener('click', (event) => {
    const star = event.target.closest('.det-star');
    if (star) {
      handleStar(star);
      return;
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'back') {
      goBack();
    } else if (action === 'refresh') {
      const key = active.key;
      toast('Actualizando metadatos…');
      Promise.resolve(window.tvtimeRefreshOne(key))
        .then((result) => {
          if (result && result.errors && result.errors.length) toast('No se pudieron actualizar los metadatos');
          else toast('Metadatos actualizados ✓');
        })
        .catch(() => toast('No se pudieron actualizar los metadatos'));
    } else if (action === 'toggle-ep') {
      const wrapper = button.closest('.det-ep');
      const sxe = wrapper && wrapper.dataset.sxe;
      if (sxe) mutate((data) => toggleEpisodeWatched(data, active.key, sxe));
    } else if (action === 'mark-season') {
      const n = Number(button.dataset.n);
      if (Number.isInteger(n)) mutate((data) => markSeasonWatched(data, active.key, n));
    } else if (action === 'toggle-movie') {
      mutate((data) => toggleMovieWatched(data, active.key));
    } else if (action === 'toggle-follow') {
      mutate((data) => {
        const key = active.key;
        const inLibrary = !!(data.library && data.library[key]);
        const entry = data.library && data.library[key];
        return inLibrary ? (isFollowed(entry) ? unfollow(data, key) : follow(data, data.catalog[key])) : data;
      });
    }
  });

  root.addEventListener('change', (event) => {
    const input = event.target.closest('.det-date');
    if (!input) return;
    const sxe = input.dataset.sxe;
    const ts = tsFromDate(input.value);
    if (!sxe || !ts) return;
    mutate((data) => {
      let next = toggleEpisodeWatched(data, active.key, sxe, null, false);
      return toggleEpisodeWatched(next, active.key, sxe, ts);
    });
  });
}

export function mount(root) {
  active = { root };
  wire(root);
  renderAll();
  return root;
}

subscribe(() => {
  if (!active || !active.root || !active.root.isConnected) return;
  const detailKey = getState().detail && getState().detail.key;
  if (active.key !== detailKey || active.data !== getState().data) renderAll();
});
