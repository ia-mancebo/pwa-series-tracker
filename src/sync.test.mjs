import test from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../src/sync.js';

function iso(offsetMs) {
  return new Date(Date.now() + (offsetMs || 0)).toISOString();
}

function makeFs({ diskData = null, failWrites = 0 } = {}) {
  let disk = diskData ? JSON.parse(JSON.stringify(diskData)) : null;
  const calls = [];
  return {
    calls,
    getMode: () => 'fsaccess',
    async readFile() {
      calls.push('readFile');
      if (!disk) return { ok: false, data: null, text: null, error: 'CORRUPT' };
      return { ok: true, data: JSON.parse(JSON.stringify(disk)), text: '', error: null };
    },
    async writeFile(handle, data) {
      calls.push('writeFile');
      if (failWrites > 0) {
        failWrites -= 1;
        throw new Error('escritura fallida');
      }
      disk = JSON.parse(JSON.stringify(data));
      return { ok: true };
    },
    async saveBackup() {
      calls.push('saveBackup');
      return { ok: true };
    },
    async saveToOpfs() {
      calls.push('saveToOpfs');
      return { ok: true };
    },
  };
}

function makeStore(initial = {}) {
  const state = {
    screen: 'biblioteca',
    saveStatus: { state: 'idle', lastSavedAt: null, dirty: false },
    ...initial,
  };
  return {
    state,
    getState: () => state,
    setState: (patch) => Object.assign(state, patch),
    subscribe: () => () => {},
  };
}

function baseData(updatedAt) {
  return {
    meta: { version: 1, updatedAt },
    catalog: {},
    library: {},
    review: [],
    settings: {},
  };
}

const tick = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('debounce: mutación dispara guardado automático tras el intervalo', async () => {
  const updatedAt = iso(-60000);
  const fsApi = makeFs({ diskData: baseData(updatedAt) });
  const store = makeStore({ data: baseData(updatedAt), handle: {} });
  const sync = createSync({ fsApi, store, debounceMs: 20 });
  sync.markDirty();
  assert.equal(fsApi.calls.includes('writeFile'), false);
  await tick(60);
  assert.equal(fsApi.calls.includes('writeFile'), true);
  assert.ok(fsApi.calls.indexOf('saveBackup') < fsApi.calls.indexOf('writeFile'));
  assert.equal(store.state.saveStatus.state, 'saved');
});

test('debounce: sin mutación no se guarda', async () => {
  const updatedAt = iso(-60000);
  const fsApi = makeFs({ diskData: baseData(updatedAt) });
  const store = makeStore({ data: baseData(updatedAt), handle: {} });
  createSync({ fsApi, store, debounceMs: 20 });
  await tick(60);
  assert.equal(fsApi.calls.includes('writeFile'), false);
});

test('conflicto: disco más nuevo + cambios → diálogo; mine hace backup del disco y sobrescribe', async () => {
  const diskData = baseData(iso(-1000));
  const localData = baseData(iso(-60000));
  const fsApi = makeFs({ diskData });
  const store = makeStore({ data: localData, handle: {} });
  let choice = 'mine';
  const sync = createSync({
    fsApi,
    store,
    debounceMs: 20,
    dialog: async (info) => {
      assert.ok(info.diskUpdatedAt > info.localUpdatedAt);
      return choice;
    },
  });
  sync.markDirty();
  await tick(60);
  const backups = fsApi.calls.filter((c) => c === 'saveBackup');
  assert.equal(backups.length, 2);
  assert.equal(fsApi.calls.includes('writeFile'), true);
  assert.equal(store.state.saveStatus.state, 'saved');
});

test('conflicto: tomar la de disco adopta la versión de disco sin escribir', async () => {
  const diskData = baseData(iso(-1000));
  const localData = baseData(iso(-60000));
  const fsApi = makeFs({ diskData });
  const store = makeStore({ data: localData, handle: {} });
  const sync = createSync({
    fsApi,
    store,
    debounceMs: 20,
    dialog: async () => 'disk',
  });
  sync.markDirty();
  await tick(60);
  assert.equal(store.state.data.meta.updatedAt, diskData.meta.updatedAt);
  assert.equal(fsApi.calls.includes('writeFile'), false);
  assert.equal(store.state.saveStatus.state, 'saved');
});

test('conflicto: cancelar conserva los cambios sin guardar', async () => {
  const diskData = baseData(iso(-1000));
  const localData = baseData(iso(-60000));
  const fsApi = makeFs({ diskData });
  const store = makeStore({ data: localData, handle: {} });
  const sync = createSync({
    fsApi,
    store,
    debounceMs: 20,
    dialog: async () => 'cancel',
  });
  sync.markDirty();
  await tick(60);
  assert.equal(store.state.data.meta.updatedAt, localData.meta.updatedAt);
  assert.equal(fsApi.calls.includes('writeFile'), false);
  assert.equal(store.state.saveStatus.state, 'dirty');
});

test('disco más nuevo sin cambios locales: adopta en silencio', async () => {
  const diskData = baseData(iso(-1000));
  const localData = baseData(iso(-60000));
  const fsApi = makeFs({ diskData });
  const store = makeStore({ data: localData, handle: {} });
  const sync = createSync({ fsApi, store, debounceMs: 20 });
  sync.saveNow(true);
  await tick(20);
  assert.equal(store.state.data.meta.updatedAt, diskData.meta.updatedAt);
  assert.equal(fsApi.calls.includes('writeFile'), false);
});

test('escritura fallida: reintenta una vez y pasa a error si sigue fallando', async () => {
  const updatedAt = iso(-60000);
  const fsApi = makeFs({ diskData: baseData(updatedAt), failWrites: 2 });
  const store = makeStore({ data: baseData(updatedAt), handle: {} });
  const sync = createSync({ fsApi, store, debounceMs: 20 });
  sync.markDirty();
  await tick(60);
  assert.equal(store.state.saveStatus.state, 'error');
  assert.equal(store.state.saveStatus.dirty, true);
  assert.ok(fsApi.calls.filter((c) => c === 'writeFile').length >= 2);
});

test('escritura fallida una vez: el reintento salva', async () => {
  const updatedAt = iso(-60000);
  const fsApi = makeFs({ diskData: baseData(updatedAt), failWrites: 1 });
  const store = makeStore({ data: baseData(updatedAt), handle: {} });
  const sync = createSync({ fsApi, store, debounceMs: 20 });
  sync.markDirty();
  await tick(60);
  assert.equal(store.state.saveStatus.state, 'saved');
});

test('fichero corrupto en disco: no sobrescribe, lleva a recuperación', async () => {
  const fsApi = makeFs({ diskData: null });
  const store = makeStore({ data: baseData(iso(-60000)), handle: {} });
  const sync = createSync({ fsApi, store, debounceMs: 20 });
  sync.markDirty();
  await tick(60);
  assert.equal(fsApi.calls.includes('writeFile'), false);
  assert.equal(store.state.screen, 'recuperacion');
  assert.equal(store.state.recoveryError, 'CORRUPT');
});

test('saveNow forzado sin cambios previos sí escribe', async () => {
  const updatedAt = iso(-60000);
  const fsApi = makeFs({ diskData: baseData(updatedAt) });
  const store = makeStore({ data: baseData(updatedAt), handle: {} });
  const sync = createSync({ fsApi, store, debounceMs: 20 });
  await sync.saveNow(true);
  assert.equal(fsApi.calls.includes('writeFile'), true);
});

test('sin handle o sin datos: no hace nada', async () => {
  const fsApi = makeFs();
  const store = makeStore({});
  const sync = createSync({ fsApi, store, debounceMs: 20 });
  await sync.saveNow(true);
  assert.equal(fsApi.calls.includes('writeFile'), false);
});

test('permiso sin gesto: queda sucio y pide pulsar Guardar, sin reintento', async () => {
  const updatedAt = iso(-60000);
  const fsApi = makeFs({ diskData: baseData(updatedAt) });
  const gestureError = new Error('sin gesto de usuario');
  gestureError.name = 'SaveNeedsGestureError';
  fsApi.writeFile = async () => {
    fsApi.calls.push('writeFile');
    throw gestureError;
  };
  const store = makeStore({ data: baseData(updatedAt), handle: {} });
  const statuses = [];
  const sync = createSync({ fsApi, store, debounceMs: 20, onStatus: (text) => statuses.push(text) });
  sync.markDirty();
  await tick(60);
  assert.equal(store.state.saveStatus.state, 'dirty');
  assert.equal(store.state.saveStatus.dirty, true);
  assert.equal(fsApi.calls.filter((c) => c === 'writeFile').length, 1);
  assert.ok(statuses.some((s) => s.includes('Guardar')));
});

test('relectura al volver a visible: disco más nuevo sin dirty adopta', async () => {
  const diskData = baseData(iso(-1000));
  const localData = baseData(iso(-60000));
  const fsApi = makeFs({ diskData });
  const store = makeStore({ data: localData, handle: {} });
  const sync = createSync({ fsApi, store });
  await sync.onVisible();
  assert.equal(store.state.data.meta.updatedAt, diskData.meta.updatedAt);
});
