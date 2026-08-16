import test from 'node:test';
import assert from 'node:assert/strict';
import { createSaveFlow } from '../src/save.js';
import { validate, DATA_FILE_NAME } from '../src/model.js';

function baseData() {
  return {
    meta: { version: 1, updatedAt: new Date().toISOString() },
    catalog: {},
    library: {},
    review: [],
    settings: {},
  };
}

function makeFs(opts = {}) {
  const calls = [];
  const fs = {
    calls,
    async shareFile(text, fileName) {
      calls.push('shareFile');
      opts.lastShare = { text, fileName };
      if (opts.shareThrows) throw opts.shareThrows;
      return opts.shareResult ?? { ok: true, method: 'share' };
    },
    async saveToOpfs(data) {
      calls.push('saveToOpfs');
      opts.lastOpfs = data;
      return { ok: true };
    },
  };
  fs.opts = opts;
  return fs;
}

function makeStore(initial = {}) {
  const state = {
    saveStatus: { state: 'idle', lastSavedAt: null, dirty: false },
    ...initial,
  };
  return {
    state,
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
  };
}

function makeStatus() {
  const statuses = [];
  return { statuses, status: (text, kind) => statuses.push({ text, kind }) };
}

test('saveManual: compartir por Web Share marca Guardado ✓ y limpia dirty', async () => {
  const data = baseData();
  const fsApi = makeFs({ shareResult: { ok: true, method: 'share' } });
  const store = makeStore({ data });
  const { statuses, status } = makeStatus();
  const flow = createSaveFlow({ fsApi, store, status });
  await flow.saveManual();
  assert.equal(JSON.parse(fsApi.opts.lastShare.text).meta.version, 1);
  assert.equal(fsApi.opts.lastShare.fileName, DATA_FILE_NAME);
  assert.deepEqual([...fsApi.calls], ['shareFile', 'saveToOpfs']);
  assert.equal(store.state.saveStatus.dirty, false);
  assert.equal(statuses.at(-1).kind, 'sync');
  assert.ok(statuses.at(-1).text.startsWith('Guardado ✓'));
  assert.equal(/descargado/.test(statuses.at(-1).text), false);
});

test('saveManual: si no hay Web Share, cae a descarga y lo indica', async () => {
  const data = baseData();
  const fsApi = makeFs({ shareResult: { ok: true, method: 'download' } });
  const store = makeStore({ data });
  const { statuses, status } = makeStatus();
  const flow = createSaveFlow({ fsApi, store, status });
  await flow.saveManual();
  assert.ok(statuses.at(-1).text.includes('(descargado)'));
  assert.equal(store.state.saveStatus.dirty, false);
});

test('saveManual: cancelación silenciosa (AbortError) no toca el estado', async () => {
  const data = baseData();
  const err = new Error('cancelado');
  err.name = 'AbortError';
  const fsApi = makeFs({ shareThrows: err });
  const store = makeStore({ data });
  const { statuses, status } = makeStatus();
  const flow = createSaveFlow({ fsApi, store, status });
  await flow.saveManual();
  assert.equal(statuses.length, 0);
  assert.equal(store.state.saveStatus.dirty, false);
});

test('saveManual: error de compartir muestra mensaje y queda offline', async () => {
  const data = baseData();
  const fsApi = makeFs({ shareThrows: new Error('share roto') });
  const store = makeStore({ data });
  const { statuses, status } = makeStatus();
  const flow = createSaveFlow({ fsApi, store, status });
  await flow.saveManual();
  assert.equal(statuses.at(-1).kind, 'offline');
  assert.equal(statuses.at(-1).text, 'share roto');
  assert.equal(store.state.saveStatus.dirty, false);
});

test('saveManual: sin datos avisa sin llamar a compartir', async () => {
  const fsApi = makeFs();
  const store = makeStore({});
  const { statuses, status } = makeStatus();
  const flow = createSaveFlow({ fsApi, store, status });
  await flow.saveManual();
  assert.deepEqual([...fsApi.calls], []);
  assert.equal(statuses.at(-1).kind, 'offline');
});

test('saveManual: los datos guardados pasan la validación del esquema', async () => {
  const data = baseData();
  const fsApi = makeFs({ shareResult: { ok: true, method: 'share' } });
  const store = makeStore({ data });
  const flow = createSaveFlow({ fsApi, store, status: () => {} });
  await flow.saveManual();
  assert.equal(validate(JSON.parse(fsApi.opts.lastShare.text)).ok, true);
});