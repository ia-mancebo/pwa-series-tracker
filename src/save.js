import { getState, setState } from './store.js';
import * as fs from './fs.js';
import { serialize, DATA_FILE_NAME } from './model.js';
import { timeLabel } from './time.js';

export function createSaveFlow(options = {}) {
  const fsApi = options.fsApi || fs;
  const store = options.store || { getState, setState };
  const status = options.status || (() => {});

  function markSaved(text) {
    store.setState({ saveStatus: { ...(store.getState().saveStatus || {}), dirty: false } });
    status(text, 'sync');
  }

  async function saveManual() {
    const state = store.getState();
    if (!state.data) {
      status('No hay datos que guardar', 'offline');
      return;
    }
    try {
      const res = await fsApi.shareFile(serialize(state.data), DATA_FILE_NAME);
      void fsApi.saveToOpfs(state.data);
      const label = res.method === 'download' ? ' (descargado)' : '';
      markSaved(`Guardado ✓ ${timeLabel(state.data.meta.updatedAt)}${label}`);
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      console.error('No se pudo compartir el fichero', err);
      status(err && err.message ? err.message : 'No se pudo guardar el fichero', 'offline');
    }
  }

  return { saveManual };
}