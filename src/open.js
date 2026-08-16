import * as fs from './fs.js';
import { resolveMode, readModePreference } from './mode.js';
import { emptyData, serialize, DATA_FILE_NAME } from './model.js';
import { timeLabel } from './time.js';

const PERMISSION_ERRORS = new Set(['NotAllowedError', 'SecurityError']);

function isPermissionError(err) {
  return Boolean(err && PERMISSION_ERRORS.has(err.name));
}

const defaultPickers = {
  pickFsAccess: () => fs.pickFile(),
  pickManual: () => fs.pickFileViaInput(),
};

export function createOpenFlow(options = {}) {
  const fsApi = options.fsApi || fs;
  const store = options.store || { getState: () => ({}), setState: () => {} };
  const pickers = options.pickers || defaultPickers;
  const status = options.status || (() => {});
  const modeFor = options.resolveMode || resolveMode;

  function saveStatus() {
    return store.getState().saveStatus || {};
  }

  function recoveryPatch() {
    return { recoveryError: undefined, recoveryHandle: undefined, recoveryRaw: undefined };
  }

  function markSaved(text) {
    store.setState({ saveStatus: { ...saveStatus(), dirty: false } });
    status(text, 'sync');
  }

  async function requestPermission(handle) {
    try {
      return await fsApi.requestPermission(handle);
    } catch (err) {
      return 'denied';
    }
  }

  async function readHandle(handle) {
    try {
      return await fsApi.readFile(handle);
    } catch (err) {
      if (!isPermissionError(err)) return null;
    }
    const granted = await requestPermission(handle);
    if (granted !== 'granted') return null;
    try {
      return await fsApi.readFile(handle);
    } catch (err) {
      return null;
    }
  }

  async function pickHandle() {
    try {
      return await pickers.pickFsAccess();
    } catch (err) {
      if (err && err.name === 'AbortError') return null;
      throw err;
    }
  }

  async function pickAndRead() {
    let handle;
    try {
      handle = await pickHandle();
    } catch (err) {
      status('No se pudo abrir el selector de ficheros', 'offline');
      return { aborted: true };
    }
    if (!handle) return { aborted: true };
    if (handle.unsupported) {
      status('Este navegador no soporta abrir ficheros', 'offline');
      return { aborted: true };
    }
    const res = await readHandle(handle);
    if (!res) {
      status('No se pudo abrir el fichero', 'offline');
      return { aborted: true };
    }
    return { handle, res };
  }

  async function adoptResult(handle, res) {
    await fsApi.storeHandle(handle);
    if (res.ok) {
      store.setState({ data: res.data, handle, recoveryRaw: undefined });
      markSaved(`Guardado ✓ ${timeLabel(res.data.meta.updatedAt)}`);
    } else {
      store.setState({ screen: 'recuperacion', recoveryHandle: handle, recoveryError: res.error, recoveryRaw: res.text });
      status('El fichero necesita recuperación', 'offline');
    }
  }

  async function openFile() {
    const pref = await fsApi.loadModePreference();
    if (modeFor(fsApi.hasFsAccessSupport(), readModePreference(pref)) === 'manual') return openFileManual();
    const stored = await fsApi.loadStoredHandle();
    let handle = null;
    if (stored && stored.handle) {
      const permission = await fsApi.hasPermission(stored.handle);
      if (permission === 'granted') {
        handle = stored.handle;
      } else {
        const requested = await requestPermission(stored.handle);
        if (requested === 'granted') {
          handle = stored.handle;
        } else {
          await fsApi.clearStoredHandle();
        }
      }
    }
    if (handle) {
      const res = await readHandle(handle);
      if (res) return adoptResult(handle, res);
      await fsApi.clearStoredHandle();
    }
    const picked = await pickAndRead();
    if (!picked.aborted) return adoptResult(picked.handle, picked.res);
    return undefined;
  }

  async function openFileManual() {
    let picked;
    try {
      picked = await pickers.pickManual();
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      status('No se pudo abrir el fichero', 'offline');
      return;
    }
    if (!picked) {
      status('No se pudo abrir el fichero', 'offline');
      return;
    }
    const res = fsApi.readText(picked.text);
    if (res.ok) {
      await fsApi.storeManualMeta({ name: picked.name });
      store.setState({ data: res.data });
      void fsApi.saveToOpfs(res.data);
      markSaved(`Guardado ✓ ${timeLabel(res.data.meta.updatedAt)}`);
    } else {
      store.setState({ screen: 'recuperacion', recoveryError: res.error });
      status('El fichero necesita recuperación', 'offline');
    }
  }

  async function initialize(handle) {
    const fresh = emptyData();
    if (!handle) {
      await fsApi.downloadFile(serialize(fresh), DATA_FILE_NAME);
      await fsApi.saveToOpfs(fresh);
      store.setState({ data: fresh, screen: 'biblioteca', ...recoveryPatch(), saveStatus: { ...saveStatus(), dirty: true } });
      status('Descargado el fichero nuevo: súbelo a Dropbox para sincronizar', 'offline');
      return { ok: true };
    }
    const rawText = store.getState().recoveryRaw ?? null;
    if (rawText == null) {
      status('No se pudo leer el fichero para la copia de seguridad; se continúa', 'offline');
    } else {
      try {
        const backup = await fsApi.saveRawBackup(rawText);
        if (!backup || backup.ok !== true) {
          status('No se pudo guardar la copia de seguridad; se continúa', 'offline');
        }
      } catch (err) {
        status('No se pudo guardar la copia de seguridad; se continúa', 'offline');
      }
    }
    try {
      await fsApi.writeFile(handle, fresh);
    } catch (err) {
      await fsApi.clearStoredHandle();
      await fsApi.downloadFile(serialize(fresh), DATA_FILE_NAME);
      await fsApi.saveToOpfs(fresh);
      store.setState({ data: fresh, screen: 'biblioteca', ...recoveryPatch(), saveStatus: { ...saveStatus(), dirty: true } });
      status('No se pudo escribir el fichero: descargado. Súbelo a Dropbox para sincronizar', 'offline');
      return { ok: true };
    }
    await fsApi.storeHandle(handle);
    await fsApi.saveToOpfs(fresh);
    store.setState({ data: fresh, handle, screen: 'biblioteca', ...recoveryPatch() });
    markSaved(`Guardado ✓ ${timeLabel(fresh.meta.updatedAt)}`);
    return { ok: true };
  }

  return { openFile, openFileManual, initialize };
}