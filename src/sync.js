import { getState, setState } from './store.js';
import * as fs from './fs.js';
import { timeLabel } from './time.js';

const DEFAULT_DEBOUNCE_MS = 1000;

function defaultDialog() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <h3 class="modal-title" id="conflict-title">Conflicto de sincronización</h3>
        <p class="modal-text">El fichero en disco es más nuevo que tus cambios sin guardar. ¿Qué haces?</p>
        <div class="modal-actions">
          <button type="button" class="modal-btn primary" data-choice="mine">Guardar la mía</button>
          <button type="button" class="modal-btn" data-choice="disk">Tomar la de disco</button>
          <button type="button" class="modal-btn" data-choice="cancel">Cancelar</button>
        </div>
      </div>`;
    overlay.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        overlay.remove();
        resolve(btn.dataset.choice);
      });
    });
    document.body.appendChild(overlay);
  });
}

export function createSync(options = {}) {
  const fsApi = options.fsApi || fs;
  const store = options.store || { getState, setState };
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const dialog = options.dialog || defaultDialog;
  const onStatus = options.onStatus || (() => {});

  let timer = null;
  let saving = false;

  function status(next, extra = {}) {
    const current = store.getState().saveStatus || {};
    store.setState({ saveStatus: { ...current, state: next, ...extra } });
  }

  function getHandle() {
    return store.getState().handle || null;
  }

  function markDirty() {
    status('dirty', { dirty: true });
    schedule();
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (store.getState().saveStatus && store.getState().saveStatus.dirty) saveNow();
    }, debounceMs);
  }

  function cancelPending() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function resetDirty() {
    cancelPending();
    const current = store.getState().saveStatus || {};
    store.setState({ saveStatus: { ...current, dirty: false } });
  }

  async function adoptDisk(diskData) {
    store.setState({ data: diskData });
    status('saved', { dirty: false, lastSavedAt: Date.now() });
    onStatus(`Guardado ✓ ${timeLabel(diskData.meta.updatedAt)}`, 'sync');
  }

  async function readDiskForSave(handle) {
    try {
      return await fsApi.readFile(handle);
    } catch (err) {
      if (
        err &&
        (err.name === 'NotAllowedError' || err.name === 'SecurityError') &&
        typeof fsApi.requestPermission === 'function'
      ) {
        const granted = await fsApi.requestPermission(handle);
        if (granted === 'granted') return await fsApi.readFile(handle);
      }
      throw err;
    }
  }

  async function saveNow(force = false) {
    if (saving) return;
    const state = store.getState();
    const data = state.data;
    if (!data) return;
    const handle = getHandle();
    if (!handle) {
      if (force) onStatus('Abre primero un fichero', 'offline');
      return;
    }
    const dirty = state.saveStatus && state.saveStatus.dirty === true;
    if (!force && !dirty) return;
    saving = true;
    cancelPending();
    status('saving', { dirty: true });
    onStatus('Guardando…', 'sync');
    try {
      const disk = await readDiskForSave(handle);
      if (!disk.ok) {
        store.setState({ screen: 'recuperacion', recoveryHandle: handle, recoveryError: disk.error, recoveryRaw: disk.text });
        onStatus('El fichero necesita recuperación', 'offline');
        status('error', { dirty: true });
        return;
      }
      const diskUpdated = disk.data.meta.updatedAt;
      const localUpdated = data.meta.updatedAt;
      if (diskUpdated > localUpdated && dirty) {
        const choice = await dialog({
          diskUpdatedAt: diskUpdated,
          localUpdatedAt: localUpdated,
        });
        if (choice === 'disk') {
          await adoptDisk(disk.data);
          return;
        }
        if (choice === 'cancel') {
          status('dirty', { dirty: true });
          onStatus('Cambios sin guardar', 'offline');
          return;
        }
        await fsApi.saveBackup(disk.data);
      } else if (diskUpdated > localUpdated) {
        await adoptDisk(disk.data);
        return;
      }
      await fsApi.saveBackup(data);
      await fsApi.writeFile(handle, data);
      await fsApi.saveToOpfs(data);
      status('saved', { dirty: false, lastSavedAt: Date.now() });
      onStatus(`Guardado ✓ ${timeLabel(data.meta.updatedAt)}`, 'sync');
    } catch (err) {
      if (err && err.name === 'SaveNeedsGestureError') {
        status('dirty', { dirty: true });
        onStatus('Pulsa Guardar para permitir la escritura', 'offline');
        return;
      }
      if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')) {
        status('error', { dirty: true });
        onStatus('Permiso caducado: pulsa Reintentar', 'offline');
        return;
      }
      const current = store.getState().data;
      try {
        await fsApi.writeFile(handle, current);
        await fsApi.saveToOpfs(current);
        status('saved', { dirty: false, lastSavedAt: Date.now() });
        onStatus(`Guardado ✓ ${timeLabel(current.meta.updatedAt)}`, 'sync');
      } catch {
        status('error', { dirty: true });
        onStatus('Error al guardar', 'offline');
      }
    } finally {
      saving = false;
    }
  }

  async function onHidden() {
    if (fsApi.getMode && fsApi.getMode() === 'manual') return;
    const state = store.getState();
    if (state.data && state.saveStatus && state.saveStatus.dirty) {
      await saveNow(true);
    }
  }

  async function onVisible() {
    if (fsApi.getMode && fsApi.getMode() === 'manual') return;
    const state = store.getState();
    const handle = getHandle();
    if (!state.data || !handle) return;
    let disk;
    try {
      disk = await fsApi.readFile(handle);
    } catch (err) {
      return;
    }
    if (!disk.ok) return;
    if (disk.data.meta.updatedAt > state.data.meta.updatedAt) {
      if (state.saveStatus && state.saveStatus.dirty) {
        const choice = await dialog({
          diskUpdatedAt: disk.data.meta.updatedAt,
          localUpdatedAt: state.data.meta.updatedAt,
        });
        if (choice === 'disk') await adoptDisk(disk.data);
      } else {
        await adoptDisk(disk.data);
      }
    }
  }

  return { markDirty, saveNow, onHidden, onVisible, resetDirty, cancelPending };
}
