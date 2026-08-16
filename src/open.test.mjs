import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenFlow } from '../src/open.js';
import { resolveMode } from '../src/mode.js';
import { validate } from '../src/model.js';

function permissionError(name = 'NotAllowedError') {
  const err = new Error(name);
  err.name = name;
  return err;
}

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
    hasFsAccessSupport: () => (opts.supported !== false),
    async loadStoredHandle() {
      calls.push('loadStoredHandle');
      return { ok: true, handle: opts.storedHandle || null };
    },
    async clearStoredHandle() {
      calls.push('clearStoredHandle');
      return { ok: true };
    },
    async storeHandle(handle) {
      calls.push('storeHandle');
      return { ok: true };
    },
    async hasPermission() {
      calls.push('hasPermission');
      return opts.permission ?? 'granted';
    },
    async requestPermission() {
      calls.push('requestPermission');
      if (opts.requestThrows) throw opts.requestThrows;
      return opts.requestResult ?? 'granted';
    },
    async readFile() {
      calls.push('readFile');
      if (opts.readThrows) {
        if (opts.readThrowsOnce) {
          const err = opts.readThrows;
          opts.readThrows = null;
          throw err;
        }
        throw opts.readThrows;
      }
      return JSON.parse(JSON.stringify(
        opts.readResult ?? { ok: true, data: baseData(), text: '', error: null }
      ));
    },
    readText(text) {
      return opts.readText ? opts.readText(text) : { ok: true, data: baseData(), text, error: null };
    },
    async storeManualMeta(meta) {
      calls.push('storeManualMeta');
      return { ok: true };
    },
    async saveToOpfs() {
      calls.push('saveToOpfs');
      return { ok: true };
    },
    async saveRawBackup(text) {
      calls.push('saveRawBackup');
      opts.lastRawBackup = text;
      return { ok: true };
    },
    async writeFile(handle, data) {
      calls.push('writeFile');
      opts.lastWritten = data;
      if (opts.writeFails) throw new Error('escritura fallida');
      return { ok: true };
    },
    async downloadFile(text, fileName) {
      calls.push('downloadFile');
      opts.lastDownload = { text, fileName };
      return { ok: true };
    },
    async loadModePreference() {
      calls.push('loadModePreference');
      return { ok: true, preference: opts.modePreference || 'auto' };
    },
  };
  fs.opts = opts;
  return fs;
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
  };
}

function makePickers(opts = {}) {
  const calls = [];
  return {
    calls,
    async pickFsAccess() {
      calls.push('pickFsAccess');
      if (opts.pickFsAccessError) throw opts.pickFsAccessError;
      return opts.pickedHandle ?? {};
    },
    async pickManual() {
      calls.push('pickManual');
      if (opts.pickManualError) throw opts.pickManualError;
      return opts.pickedManual ?? { name: 'tvtime-data.json', text: '{}' };
    },
  };
}

function makeStatus() {
  const statuses = [];
  return { statuses, status: (text, kind) => statuses.push({ text, kind }) };
}

test('handle guardado con permiso caducado: se pide permiso con el gesto y se lee sin error', async () => {
  const fsApi = makeFs({ storedHandle: {}, permission: 'prompt', requestResult: 'granted' });
  const store = makeStore();
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status, resolveMode });
  await flow.openFile();
  assert.deepEqual([...fsApi.calls], ['loadModePreference', 'loadStoredHandle', 'hasPermission', 'requestPermission', 'readFile', 'storeHandle']);
  assert.equal(store.state.screen, 'biblioteca');
  assert.ok(store.state.data);
  assert.equal(store.state.data.meta.version, 1);
  assert.equal(store.state.saveStatus.dirty, false);
  assert.equal(statuses.at(-1).kind, 'sync');
});

test('handle guardado con permiso denegado: se borra el handle y se abre el selector', async () => {
  const fsApi = makeFs({ storedHandle: {}, permission: 'prompt', requestResult: 'denied' });
  const store = makeStore();
  const pickers = makePickers();
  const flow = createOpenFlow({ fsApi, store, pickers, status: () => {}, resolveMode });
  await flow.openFile();
  assert.deepEqual([...fsApi.calls].slice(0, 5), ['loadModePreference', 'loadStoredHandle', 'hasPermission', 'requestPermission', 'clearStoredHandle']);
  assert.deepEqual([...pickers.calls], ['pickFsAccess']);
  assert.ok(store.state.data);
});

test('requestPermission que lanza (p. ej. AbortError): se trata como denegado y se reabre el selector', async () => {
  const fsApi = makeFs({ storedHandle: {}, permission: 'prompt', requestThrows: permissionError('AbortError') });
  const store = makeStore();
  const pickers = makePickers();
  const flow = createOpenFlow({ fsApi, store, pickers, status: () => {}, resolveMode });
  await flow.openFile();
  assert.deepEqual([...fsApi.calls].slice(0, 5), ['loadModePreference', 'loadStoredHandle', 'hasPermission', 'requestPermission', 'clearStoredHandle']);
  assert.deepEqual([...pickers.calls], ['pickFsAccess']);
  assert.ok(store.state.data);
});

test('sin handle guardado: se abre el selector directamente sin tocar permisos', async () => {
  const fsApi = makeFs({ storedHandle: null });
  const store = makeStore();
  const pickers = makePickers();
  const flow = createOpenFlow({ fsApi, store, pickers, status: () => {}, resolveMode });
  await flow.openFile();
  assert.deepEqual([...fsApi.calls], ['loadModePreference', 'loadStoredHandle', 'readFile', 'storeHandle']);
  assert.deepEqual([...pickers.calls], ['pickFsAccess']);
  assert.ok(store.state.data);
});

test('cancelar el selector no muestra ningún error', async () => {
  const fsApi = makeFs({ storedHandle: null });
  const store = makeStore();
  const pickers = makePickers({ pickFsAccessError: permissionError('AbortError') });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers, status, resolveMode });
  await flow.openFile();
  assert.equal(statuses.length, 0);
  assert.equal(store.state.data, undefined);
  assert.equal(store.state.screen, 'biblioteca');
});

test('fichero ilegible: pantalla de Recuperación con el handle conservado en el estado', async () => {
  const pickedHandle = { id: 'picked' };
  const fsApi = makeFs({ storedHandle: null, readResult: { ok: false, data: null, text: '', error: 'CORRUPT' } });
  const store = makeStore();
  const pickers = makePickers({ pickedHandle });
  const flow = createOpenFlow({ fsApi, store, pickers, status: () => {}, resolveMode });
  await flow.openFile();
  assert.equal(store.state.screen, 'recuperacion');
  assert.equal(store.state.recoveryError, 'CORRUPT');
  assert.equal(store.state.recoveryHandle, pickedHandle);
  assert.ok(fsApi.calls.includes('storeHandle'));
});

test('SCHEMA y VERSION también llevan a Recuperación conservando el handle', async () => {
  for (const error of ['SCHEMA', 'VERSION']) {
    const fsApi = makeFs({ storedHandle: {}, readResult: { ok: false, data: null, text: '', error } });
    const store = makeStore();
    const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status: () => {}, resolveMode });
    await flow.openFile();
    assert.equal(store.state.screen, 'recuperacion', error);
    assert.equal(store.state.recoveryError, error);
    assert.ok(store.state.recoveryHandle);
  }
});

test('NotAllowedError al leer: se vuelve a pedir permiso, se reintenta y nunca se confunde con corrupción', async () => {
  const fsApi = makeFs({ storedHandle: {}, permission: 'granted', readThrows: permissionError(), readThrowsOnce: true });
  const store = makeStore();
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status, resolveMode });
  await flow.openFile();
  assert.deepEqual([...fsApi.calls], ['loadModePreference', 'loadStoredHandle', 'hasPermission', 'readFile', 'requestPermission', 'readFile', 'storeHandle']);
  assert.equal(store.state.screen, 'biblioteca');
  assert.ok(store.state.data);
  assert.equal(statuses.some((s) => s.kind === 'offline' || /JSON|válido/i.test(s.text)), false);
});

test('NotAllowedError al leer sin que se conceda el permiso: se borra el handle y se reabre el selector', async () => {
  const fsApi = makeFs({ storedHandle: {}, permission: 'granted', readThrows: permissionError(), readThrowsOnce: true, requestResult: 'denied' });
  const store = makeStore();
  const pickers = makePickers();
  const flow = createOpenFlow({ fsApi, store, pickers, status: () => {}, resolveMode });
  await flow.openFile();
  assert.deepEqual([...fsApi.calls], ['loadModePreference', 'loadStoredHandle', 'hasPermission', 'readFile', 'requestPermission', 'clearStoredHandle', 'readFile', 'storeHandle']);
  assert.deepEqual([...pickers.calls], ['pickFsAccess']);
  assert.ok(store.state.data);
});

test('handle guardado roto (NotFoundError): se borra y se reabre el selector', async () => {
  const fsApi = makeFs({ storedHandle: {}, permission: 'granted', readThrows: permissionError('NotFoundError'), readThrowsOnce: true });
  const store = makeStore();
  const pickers = makePickers();
  const flow = createOpenFlow({ fsApi, store, pickers, status: () => {}, resolveMode });
  await flow.openFile();
  assert.deepEqual([...fsApi.calls], ['loadModePreference', 'loadStoredHandle', 'hasPermission', 'readFile', 'clearStoredHandle', 'readFile', 'storeHandle']);
  assert.deepEqual([...pickers.calls], ['pickFsAccess']);
  assert.ok(store.state.data);
});

test('selector que falla (no cancelación): muestra error y no cambia el estado', async () => {
  const fsApi = makeFs({ storedHandle: null });
  const store = makeStore();
  const pickers = makePickers({ pickFsAccessError: new Error('picker roto') });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers, status, resolveMode });
  await flow.openFile();
  assert.equal(statuses.at(-1).text, 'No se pudo abrir el selector de ficheros');
  assert.equal(statuses.at(-1).kind, 'offline');
  assert.equal(store.state.data, undefined);
});

test('modo manual: usa el picker manual, guarda la meta y no toca el handle', async () => {
  const fsApi = makeFs({ supported: false });
  const store = makeStore();
  const pickers = makePickers();
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers, status, resolveMode });
  await flow.openFile();
  assert.deepEqual([...fsApi.calls], ['loadModePreference', 'storeManualMeta', 'saveToOpfs']);
  assert.deepEqual([...pickers.calls], ['pickManual']);
  assert.ok(store.state.data);
  assert.equal(store.state.handle, undefined);
  assert.equal(statuses.at(-1).kind, 'sync');
});

test('modo manual: cancelar el selector no muestra ningún error', async () => {
  const fsApi = makeFs({ supported: false });
  const store = makeStore();
  const pickers = makePickers({ pickManualError: permissionError('AbortError') });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers, status, resolveMode });
  await flow.openFile();
  assert.equal(statuses.length, 0);
  assert.equal(store.state.data, undefined);
});

test('modo manual: fichero ilegible lleva a Recuperación sin handle', async () => {
  const fsApi = makeFs({ supported: false, readText: () => ({ ok: false, data: null, text: '', error: 'SCHEMA' }) });
  const store = makeStore();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status: () => {}, resolveMode });
  await flow.openFile();
  assert.equal(store.state.screen, 'recuperacion');
  assert.equal(store.state.recoveryError, 'SCHEMA');
  assert.equal(store.state.recoveryHandle, undefined);
});

test('openFileManual se puede llamar directamente en modo manual', async () => {
  const fsApi = makeFs({ supported: false });
  const store = makeStore();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status: () => {}, resolveMode });
  await flow.openFileManual();
  assert.ok(store.state.data);
});

test('initialize: copia cruda de seguridad (ya leída al abrir) antes de escribir emptyData y deja la app usable', async () => {
  const handle = { id: 'picked' };
  const fsApi = makeFs({ storedHandle: null });
  const store = makeStore({ screen: 'recuperacion', recoveryHandle: handle, recoveryError: 'CORRUPT', recoveryRaw: '{\n  "roto"' });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status, resolveMode });
  await flow.initialize(handle);
  assert.deepEqual([...fsApi.calls], ['saveRawBackup', 'writeFile', 'storeHandle', 'saveToOpfs']);
  assert.equal(fsApi.calls.indexOf('saveRawBackup') < fsApi.calls.indexOf('writeFile'), true);
  assert.equal(fsApi.opts.lastRawBackup, '{\n  "roto"');
  assert.equal(fsApi.opts.lastWritten.meta.version, 1);
  assert.deepEqual(fsApi.opts.lastWritten.catalog, {});
  assert.deepEqual(fsApi.opts.lastWritten.library, {});
  assert.deepEqual(fsApi.opts.lastWritten.review, []);
  assert.equal(validate(fsApi.opts.lastWritten).ok, true);
  assert.equal(store.state.screen, 'biblioteca');
  assert.equal(store.state.handle, handle);
  assert.equal(store.state.recoveryError, undefined);
  assert.equal(store.state.saveStatus.dirty, false);
  assert.equal(statuses.at(-1).kind, 'sync');
});

test('initialize: fichero de 0 bytes (recoveryRaw vacío) produce un fichero válido y backup del contenido vacío', async () => {
  const handle = { id: 'picked' };
  const fsApi = makeFs({ storedHandle: null });
  const store = makeStore({ screen: 'recuperacion', recoveryHandle: handle, recoveryError: 'CORRUPT', recoveryRaw: '' });
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status: () => {}, resolveMode });
  await flow.initialize(handle);
  assert.equal(fsApi.opts.lastRawBackup, '');
  assert.equal(validate(fsApi.opts.lastWritten).ok, true);
  assert.equal(store.state.screen, 'biblioteca');
  assert.equal(store.state.handle, handle);
});

test('initialize: sin contenido ya leído para el backup, continúa con aviso', async () => {
  const handle = { id: 'picked' };
  const fsApi = makeFs({ storedHandle: null });
  const store = makeStore({ screen: 'recuperacion', recoveryHandle: handle, recoveryError: 'CORRUPT' });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status, resolveMode });
  await flow.initialize(handle);
  assert.equal(fsApi.calls.includes('saveRawBackup'), false);
  assert.equal(fsApi.calls.includes('writeFile'), true);
  assert.ok(statuses.some((s) => s.kind === 'offline' && /copia de seguridad/.test(s.text)));
  assert.equal(store.state.screen, 'biblioteca');
  assert.equal(store.state.handle, handle);
  assert.ok(store.state.data);
});

test('initialize: backup que no puede guardarse (skipped) muestra aviso y sigue adelante', async () => {
  const handle = { id: 'picked' };
  const fsApi = makeFs({ storedHandle: null });
  fsApi.saveRawBackup = async () => {
    fsApi.calls.push('saveRawBackup');
    return { ok: false, skipped: true };
  };
  const store = makeStore({ screen: 'recuperacion', recoveryHandle: handle, recoveryError: 'CORRUPT', recoveryRaw: '{"roto"' });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status, resolveMode });
  await flow.initialize(handle);
  assert.equal(fsApi.calls.includes('saveRawBackup'), true);
  assert.equal(fsApi.calls.includes('writeFile'), true);
  assert.ok(statuses.some((s) => s.kind === 'offline' && /copia de seguridad/.test(s.text)));
  assert.equal(store.state.screen, 'biblioteca');
  assert.equal(store.state.handle, handle);
});

test('initialize: backup sin soporte (unsupported) también muestra aviso y sigue adelante', async () => {
  const handle = { id: 'picked' };
  const fsApi = makeFs({ storedHandle: null });
  fsApi.saveRawBackup = async () => {
    fsApi.calls.push('saveRawBackup');
    return { unsupported: true };
  };
  const store = makeStore({ screen: 'recuperacion', recoveryHandle: handle, recoveryError: 'CORRUPT', recoveryRaw: '{"roto"' });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status, resolveMode });
  await flow.initialize(handle);
  assert.equal(fsApi.calls.includes('saveRawBackup'), true);
  assert.equal(fsApi.calls.includes('writeFile'), true);
  assert.ok(statuses.some((s) => s.kind === 'offline' && /copia de seguridad/.test(s.text)));
  assert.equal(store.state.screen, 'biblioteca');
});

test('initialize: si la escritura falla, descarga, borra el handle residual y deja el estado limpio', async () => {
  const handle = { id: 'picked' };
  const fsApi = makeFs({ storedHandle: null, writeFails: true });
  const store = makeStore({ screen: 'recuperacion', recoveryHandle: handle, recoveryError: 'CORRUPT', recoveryRaw: '{"roto"' });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status, resolveMode });
  await flow.initialize(handle);
  assert.equal(fsApi.calls.includes('downloadFile'), true);
  assert.equal(fsApi.calls.includes('clearStoredHandle'), true);
  assert.equal(fsApi.calls.includes('saveToOpfs'), true);
  const downloaded = JSON.parse(fsApi.opts.lastDownload.text);
  assert.equal(validate(downloaded).ok, true);
  assert.equal(fsApi.opts.lastDownload.fileName, 'tvtime-data.json');
  assert.ok(statuses.some((s) => s.kind === 'offline' && /Dropbox/.test(s.text)));
  assert.equal(store.state.screen, 'biblioteca');
  assert.equal(store.state.handle, undefined);
  assert.equal(store.state.recoveryHandle, undefined);
  assert.ok(store.state.data);
});

test('initialize sin handle (modo manual): descarga el fichero nuevo, lo deja en OPFS y sin tocar lectura ni escritura', async () => {
  const fsApi = makeFs({ supported: false });
  const store = makeStore({ screen: 'recuperacion', recoveryError: 'CORRUPT' });
  const { statuses, status } = makeStatus();
  const flow = createOpenFlow({ fsApi, store, pickers: makePickers(), status, resolveMode });
  await flow.initialize(null);
  assert.equal(fsApi.calls.includes('readFile'), false);
  assert.equal(fsApi.calls.includes('saveRawBackup'), false);
  assert.equal(fsApi.calls.includes('writeFile'), false);
  assert.equal(fsApi.calls.includes('downloadFile'), true);
  assert.equal(fsApi.calls.includes('saveToOpfs'), true);
  assert.equal(validate(JSON.parse(fsApi.opts.lastDownload.text)).ok, true);
  assert.ok(statuses.some((s) => s.kind === 'offline' && /Dropbox/.test(s.text)));
  assert.equal(store.state.screen, 'biblioteca');
  assert.ok(store.state.data);
  assert.equal(store.state.saveStatus.dirty, true);
});

test('openFile: la preferencia de modo persistida llega a resolveMode junto al soporte', async () => {
  const fsApi = makeFs({ storedHandle: null, modePreference: 'manual' });
  const store = makeStore();
  const pickers = makePickers();
  const modeArgs = [];
  const flow = createOpenFlow({
    fsApi,
    store,
    pickers,
    status: () => {},
    resolveMode: (supported, preference) => {
      modeArgs.push([supported, preference]);
      return resolveMode(supported, preference);
    },
  });
  await flow.openFile();
  assert.deepEqual(modeArgs, [[true, 'manual']]);
  assert.deepEqual([...pickers.calls], ['pickManual']);
  assert.ok(store.state.data);
});