import { getState, setState, subscribe } from '../store.js';
import { refreshAll } from '../refresh.js';
import * as tmdb from '../tmdb.js';
import * as anilist from '../anilist.js';
import { loadModePreference, storeModePreference, hasFsAccessSupport } from '../fs.js';
import { resolveMode, readModePreference } from '../mode.js';

const APP_VERSION = '0.1.0';
const APP_NAME = 'TVTime — fichero de emisión';
const TMDB_API_URL = 'https://www.themoviedb.org/settings/api';
const TMDB_CREDIT = 'This product uses the TMDB API but is not endorsed or certified by TMDB';

let activeRoot = null;
let rendered = { hasData: false, hasKey: false };

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function keyOf(state) {
  const data = state.data;
  if (!data || !data.settings || typeof data.settings !== 'object') return '';
  const key = data.settings.tmdbApiKey;
  return typeof key === 'string' ? key : '';
}

function maskedSuffix(key) {
  return key.length <= 4 ? `…${key}` : `…${key.slice(-4)}`;
}

function saveKey(value) {
  const state = getState();
  if (!state.data) return;
  const settings = { ...(state.data.settings || {}), tmdbApiKey: value };
  setState({
    data: { ...state.data, settings, meta: { ...state.data.meta, updatedAt: new Date().toISOString() } },
  });
}

function removeKey() {
  const state = getState();
  if (!state.data) return;
  const settings = { ...(state.data.settings || {}) };
  delete settings.tmdbApiKey;
  setState({
    data: { ...state.data, settings, meta: { ...state.data.meta, updatedAt: new Date().toISOString() } },
  });
}

function wireKeyArea(container) {
  const input = container.querySelector('[data-role="key-input"]');
  if (input) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        const trimmed = input.value.trim();
        if (trimmed) saveKey(trimmed);
      }
    });
  }
  const save = container.querySelector('[data-role="key-save"]');
  if (save) {
    save.addEventListener('click', () => {
      const trimmed = input.value.trim();
      if (trimmed) saveKey(trimmed);
    });
  }
  const remove = container.querySelector('[data-role="key-remove"]');
  if (remove) {
    remove.addEventListener('click', removeKey);
  }
}

async function runRefreshAll(container) {
  const state = getState();
  const status = container.querySelector('[data-role="refresh-status"]');
  if (!state.data) {
    status.textContent = 'Vincula tu fichero primero: se guarda en tu fichero único.';
    return;
  }
  const settings = state.data.settings && typeof state.data.settings === 'object' ? state.data.settings : {};
  const apiKey = typeof settings.tmdbApiKey === 'string' ? settings.tmdbApiKey : '';
  const button = container.querySelector('[data-role="refresh-all"]');
  button.disabled = true;
  status.textContent = 'Actualizando…';
  const result = await refreshAll(state.data, {
    tmdb,
    anilist,
    tmdbApiKey: apiKey,
    onProgress: (done, total, label) => {
      const name = label ? ` · ${label}` : '';
      status.textContent = `Actualizando… (${done}/${total})${name}`;
    },
  });
  button.disabled = false;
  const updated = result.updated.length;
  const failed = result.errors.length;
  let text;
  if (failed > 0 && updated > 0) text = `Actualizado ✓ · ${updated} títulos, ${failed} sin conexión`;
  else if (failed > 0) text = `Sin conexión · ${failed} títulos sin actualizar`;
  else if (updated > 0) text = `Actualizado ✓ · ${updated} títulos`;
  else text = 'Todo actualizado ✓';
  status.textContent = text;
  if (updated > 0) {
    const current = getState();
    if (current.data) setState({ data: { ...result.data, library: current.data.library } });
  }
}

function wireRefreshArea(container) {
  const button = container.querySelector('[data-role="refresh-all"]');
  if (button) button.addEventListener('click', () => runRefreshAll(container));
}

function renderKeyArea(container, state) {
  const hasData = Boolean(state.data);
  const key = keyOf(state);
  const hasKey = Boolean(key);
  let html;
  if (!hasData) {
    html = `
      <div class="aj-notice">Vincula tu fichero primero: la clave se guarda en tu fichero único.</div>
      <div class="aj-keyrow">
        <input class="aj-input" type="password" autocomplete="off" placeholder="Clave de API de TMDB" disabled>
        <button class="aj-btn" type="button" disabled>Guardar clave</button>
      </div>`;
  } else if (hasKey) {
    html = `
      <div class="aj-saved">
        <span class="mini">Clave guardada (termina en ${esc(maskedSuffix(key))})</span>
        <button class="aj-btn ghost" type="button" data-role="key-remove">Quitar clave</button>
      </div>`;
  } else {
    html = `
      <div class="aj-notice warn">
        Sin clave de TMDB: búsqueda y metadatos solo de AniList. Añade tu clave para emparejar e importar con TMDB.
        Consíguela en <a href="${TMDB_API_URL}" target="_blank" rel="noopener">themoviedb.org/settings/api</a>.
      </div>
      <div class="aj-keyrow">
        <input class="aj-input" type="password" autocomplete="off" placeholder="Clave de API de TMDB" data-role="key-input">
        <button class="aj-btn" type="button" data-role="key-save">Guardar clave</button>
      </div>`;
  }
  container.innerHTML = html;
  wireKeyArea(container);
}

function aboutHtml(state) {
  const meta = state.data && state.data.meta ? state.data.meta : null;
  const schema = meta ? `Esquema del fichero: v${esc(meta.version)}` : 'Fichero vinculado: ninguno';
  return `
    <p class="aj-text">${esc(APP_NAME)} · versión ${esc(APP_VERSION)}</p>
    <p class="aj-meta">${esc(schema)}</p>`;
}

function creditsHtml() {
  return `
    <span class="tmdb-badge">TMDB</span>
    <p class="aj-credit">${TMDB_CREDIT}.</p>
    <p class="aj-credit-gloss">Este producto usa la API de TMDB pero no está respaldado ni certificado por TMDB.</p>`;
}

function render(root, state, deps = {}) {
  rendered = { hasData: Boolean(state.data), hasKey: Boolean(keyOf(state)) };
  root.innerHTML = `
    <div class="aj">
      <section class="aj-card">
        <h3 class="aj-title">Modo de fichero</h3>
        <p class="aj-text">Automático usa File System Access cuando el navegador lo ofrece (auto-guardado).
        Manual usa el selector del sistema sin filtros y el botón Guardar vía Web Share, como en el prototipo.</p>
        <div class="aj-keyrow">
          <label class="mini"><input type="radio" name="file-mode" value="auto" data-role="mode-auto"> Automático</label>
          <label class="mini"><input type="radio" name="file-mode" value="manual" data-role="mode-manual"> Manual</label>
        </div>
        <div class="mini" data-role="mode-status"></div>
      </section>
      <section class="aj-card">
        <h3 class="aj-title">Clave de TMDB</h3>
        <p class="aj-text">Tu clave de API de TMDB. Se guarda en la sección <code>settings</code> de tu fichero único:
        sincronizada con Dropbox y cubierta por las copias de seguridad. Nunca forma parte del código de la app.</p>
        <div class="aj-key" data-role="key"></div>
      </section>
      <section class="aj-card">
        <h3 class="aj-title">Actualizar metadatos</h3>
        <p class="aj-text">Refresca toda la biblioteca ahora, ignorando los plazos automáticos (1 hora para episodios,
        30 días para el resto). Los visionados y las notas nunca se tocan.</p>
        <div class="aj-keyrow">
          <button class="aj-btn" type="button" data-role="refresh-all">Actualizar todo</button>
        </div>
        <div class="mini" data-role="refresh-status"></div>
      </section>
      <section class="aj-card">
        <h3 class="aj-title">Acerca de</h3>
        ${aboutHtml(state)}
      </section>
      <section class="aj-card">
        <h3 class="aj-title">Créditos</h3>
        ${creditsHtml()}
      </section>
    </div>`;
  renderKeyArea(root.querySelector('[data-role="key"]'), state);
  wireRefreshArea(root);
  wireModeArea(root, deps);
}

function wireModeArea(root, deps = {}) {
  const status = root.querySelector('[data-role="mode-status"]');
  const auto = root.querySelector('[data-role="mode-auto"]');
  const manual = root.querySelector('[data-role="mode-manual"]');
  if (!status || !auto || !manual) return;
  const noFsaNotice = 'Este navegador no ofrece File System Access: el modo Automático usará Manual.';
  loadModePreference()
    .then((pref) => {
      const value = readModePreference(pref);
      auto.checked = value === 'auto';
      manual.checked = value === 'manual';
      if (!hasFsAccessSupport()) status.textContent = noFsaNotice;
    })
    .catch(() => {
      if (!hasFsAccessSupport()) status.textContent = noFsaNotice;
    });
  const apply = async (value) => {
    try {
      await storeModePreference(value);
    } catch (err) {
      const fresh = root.querySelector('[data-role="mode-status"]');
      if (fresh) fresh.textContent = 'No se pudo guardar la preferencia de modo.';
      return;
    }
    if (deps.applyModeUI) {
      try {
        await deps.applyModeUI();
      } catch (err) {
        /* la UI de modo no debe romper la pantalla */
      }
    }
    const fresh = root.querySelector('[data-role="mode-status"]');
    if (!fresh) return;
    const mode = resolveMode(hasFsAccessSupport(), value);
    if (mode === 'manual') {
      fresh.textContent = value === 'auto'
        ? 'Este navegador no ofrece File System Access: se usará el modo Manual.'
        : 'Modo manual activo: usa el botón Guardar para guardar.';
    } else {
      fresh.textContent = 'Modo automático activo: auto-guardado con File System Access.';
    }
  };
  auto.addEventListener('change', () => { if (auto.checked) apply('auto'); });
  manual.addEventListener('change', () => { if (manual.checked) apply('manual'); });
}

export function mount(root, deps = {}) {
  activeRoot = root;
  render(root, getState(), deps);
  return root;
}

subscribe(() => {
  if (!activeRoot || !activeRoot.isConnected) return;
  const state = getState();
  const next = { hasData: Boolean(state.data), hasKey: Boolean(keyOf(state)) };
  if (next.hasData === rendered.hasData && next.hasKey === rendered.hasKey) return;
  rendered = next;
  renderKeyArea(activeRoot.querySelector('[data-role="key"]'), state);
});
