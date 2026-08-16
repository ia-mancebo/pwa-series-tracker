import { getState, setState, subscribe } from './store.js';
import * as fs from './fs.js';
import { createSync } from './sync.js';
import { createOpenFlow } from './open.js';
import { createSaveFlow } from './save.js';
import { resolveMode, readModePreference, shouldResetDirtyAtBoot } from './mode.js';
import { refreshLibrary, refreshOne } from './refresh.js';
import { precacheLibraryPosters } from './precache.js';
import * as tmdb from './tmdb.js';
import * as anilist from './anilist.js';
import { mount as mountBiblioteca } from './ui/biblioteca.js';
import { mount as mountDetalle } from './ui/detalle.js';
import { mount as mountNovedades } from './ui/novedades.js';
import { mount as mountBuscar } from './ui/buscar.js';
import { mount as mountImportar } from './ui/importar.js';
import { mount as mountCola } from './ui/cola.js';
import { mount as mountAjustes } from './ui/ajustes.js';
import { mount as mountRecuperacion } from './ui/recuperacion.js';

const SCREENS = {
  biblioteca: { title: 'Biblioteca', mount: mountBiblioteca },
  detalle: { title: 'Detalle', mount: mountDetalle },
  novedades: { title: 'Novedades', mount: mountNovedades },
  buscar: { title: 'Buscar', mount: mountBuscar },
  importar: { title: 'Importación', mount: mountImportar },
  revision: { title: 'Revisión', mount: mountCola },
  ajustes: { title: 'Ajustes', mount: (root) => mountAjustes(root, { applyModeUI }) },
  recuperacion: { title: 'Recuperación', mount: (root) => mountRecuperacion(root, { openFlow, setSaveStatus }) },
};

const openFlow = createOpenFlow({
  fsApi: fs,
  store: { getState, setState },
  pickers: {
    pickFsAccess: () => fs.pickFile(),
    pickManual: () => fs.pickFileViaInput(),
  },
  status: (text, kind) => setSaveStatus(text, kind),
  resolveMode,
});

export { openFlow };
window.tvtimeOpenFile = openFlow.openFile;

const saveFlow = createSaveFlow({
  fsApi: fs,
  store: { getState, setState },
  status: (text, kind) => setSaveStatus(text, kind),
});

window.tvtimeSaveFile = saveFlow.saveManual;

function refreshDeps(extra = {}) {
  const data = getState().data;
  const settings = data && data.settings && typeof data.settings === 'object' ? data.settings : {};
  return {
    tmdb,
    anilist,
    tmdbApiKey: typeof settings.tmdbApiKey === 'string' ? settings.tmdbApiKey : '',
    ...extra,
  };
}

async function refreshIfStale() {
  const data = getState().data;
  if (!data || !data.catalog) return;
  const result = await refreshLibrary(data, refreshDeps());
  if (result.updated.length) {
    const current = getState();
    if (current.data) setState({ data: { ...result.data, library: current.data.library } });
  } else if (result.errors.length) {
    setSaveStatus('Sin conexión: metadatos desactualizados', 'offline');
  }
  void precacheLibraryPosters(result.data || data);
}

window.tvtimeRefreshOne = async (key) => {
  const data = getState().data;
  if (!data) {
    return { data: null, updated: [], skipped: [], errors: [{ key, error: new Error('Sin fichero vinculado.') }] };
  }
  const result = await refreshOne(data, key, refreshDeps());
  if (result.updated.length) {
    const current = getState();
    if (current.data) setState({ data: { ...result.data, library: current.data.library } });
  }
  return result;
};

function currentMode() {
  return getState().mode || fs.getMode();
}

async function applyModeUI() {
  const pref = await fs.loadModePreference();
  const mode = resolveMode(fs.hasFsAccessSupport(), readModePreference(pref));
  setState({ mode });
  const manual = mode === 'manual';
  document.querySelectorAll('[data-manual-badge]').forEach((el) => {
    el.hidden = !manual;
  });
  const saveBtn = document.getElementById('save-file-btn');
  if (saveBtn) saveBtn.hidden = !manual;
}

export { applyModeUI };

async function restoreManualSession() {
  if (currentMode() !== 'manual') return;
  const stored = await fs.loadManualMeta();
  if (!stored || !stored.ok || !stored.meta) return;
  const restored = await fs.loadFromOpfs();
  if (!restored || !restored.ok) return;
  setState({ data: restored.data });
  setSaveStatus('Cambios sin guardar');
}

let lastStatusText = 'Sin fichero vinculado';
let lastStatusKind = '';
let offlineOverlay = false;

export function setSaveStatus(text, kind = '', options = {}) {
  if (!options.overlay) {
    lastStatusText = text;
    lastStatusKind = kind;
  }
  document.querySelectorAll('[data-save-status-text]').forEach((el) => {
    el.textContent = text;
  });
  const indicators = document.querySelectorAll('.estado-ind');
  for (const indicator of indicators) {
    indicator.classList.toggle('offline', kind === 'offline');
    indicator.classList.toggle('sync', kind === 'sync');
  }
}

function updateOnlineIndicator() {
  if (navigator.onLine) {
    if (offlineOverlay) {
      offlineOverlay = false;
      setSaveStatus(lastStatusText, lastStatusKind);
    }
    return;
  }
  const status = getState().saveStatus || {};
  if (status.state === 'error' || status.dirty) return;
  if (offlineOverlay) return;
  offlineOverlay = true;
  setSaveStatus('Sin conexión', 'offline', { overlay: true });
}

let mountedScreen = null;

function render() {
  const { screen } = getState();
  const current = SCREENS[screen] || SCREENS.biblioteca;

  document.getElementById('screen-title').textContent = current.title;

  document.querySelectorAll('[data-screen]').forEach((button) => {
    button.classList.toggle('act', button.dataset.screen === screen);
  });

  if (screen === mountedScreen) return;

  mountedScreen = screen;
  const root = document.getElementById('screen-content');
  root.replaceChildren();
  const host = document.createElement('div');
  host.className = 'screen-mount';
  root.appendChild(host);
  current.mount(host);
}

async function setup() {
  document.querySelectorAll('[data-screen]').forEach((button) => {
    button.addEventListener('click', () => {
      setState({ screen: button.dataset.screen });
    });
  });

  const openButton = document.getElementById('open-file-btn');
  if (openButton) openButton.addEventListener('click', openFlow.openFile);

  const saveButton = document.getElementById('save-file-btn');
  if (saveButton) {
    saveButton.addEventListener('click', () => {
      if (currentMode() === 'manual') {
        saveFlow.saveManual();
      } else {
        sync.saveNow(true);
      }
    });
  }

  const retryButton = document.getElementById('save-retry-btn');
  if (retryButton) retryButton.addEventListener('click', () => sync.saveNow(true));

  await applyModeUI();
  setSaveStatus('Sin fichero vinculado');
  window.addEventListener('online', updateOnlineIndicator);
  window.addEventListener('offline', updateOnlineIndicator);
  updateOnlineIndicator();
  subscribe(render);
  subscribe((state) => {
    const retry = document.getElementById('save-retry-btn');
    if (retry) {
      retry.hidden = !(state.saveStatus && state.saveStatus.state === 'error');
    }
  });
  render();
  restoreManualSession();
}

const sync = createSync({
  onStatus: (text, kind) => setSaveStatus(text, kind),
});

let lastData = undefined;
let booted = false;
subscribe((state) => {
  if (state.data === lastData) return;
  lastData = state.data;
  if (!state.data) return;
  if (!booted) {
    booted = true;
    if (shouldResetDirtyAtBoot(currentMode())) sync.resetDirty();
    void refreshIfStale();
    return;
  }
  if (currentMode() === 'manual') {
    if (!state.saveStatus.dirty) {
      setState({ saveStatus: { ...state.saveStatus, dirty: true } });
    }
  } else {
    sync.markDirty();
  }
});

window.addEventListener('beforeunload', (event) => {
  if (currentMode() !== 'manual') return;
  const status = getState().saveStatus;
  if (!status || !status.dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

document.addEventListener('visibilitychange', () => {
  if (currentMode() === 'manual') {
    const state = getState();
    if (document.visibilityState === 'hidden' && state.data && state.saveStatus && state.saveStatus.dirty) {
      fs.saveToOpfs(state.data);
    }
    return;
  }
  if (document.visibilityState === 'hidden') {
    sync.onHidden();
  } else {
    sync.onVisible();
  }
});

window.addEventListener('pagehide', () => {
  if (currentMode() !== 'manual') sync.onHidden();
});

window.tvtimeSync = sync;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch((error) => {
        console.error('No se pudo registrar el service worker', error);
      });
  });
}

setup();
