import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackupStore } from '../src/backup.js';
import * as fs from '../src/fs.js';
import { serialize, emptyData } from '../src/model.js';

function makeFakeDir(name = 'backups') {
  const files = new Map();
  return {
    name,
    _files: files,
    async getFileHandle(fileName, opts = {}) {
      if (!files.has(fileName) && !opts.create) {
        throw new Error('NotFoundError');
      }
      if (!files.has(fileName)) files.set(fileName, '');
      return {
        name: fileName,
        async createWritable() {
          let text = files.get(fileName) || '';
          return {
            async write(chunk) {
              text = String(chunk);
            },
            async close() {
              files.set(fileName, text);
            },
          };
        },
        async getFile() {
          return { name: fileName, text: async () => files.get(fileName) || '' };
        },
      };
    },
    async removeEntry(fileName) {
      files.delete(fileName);
    },
    async *entries() {
      for (const [name] of files) yield [name, undefined];
    },
  };
}

function makeFakeOpfs() {
  const backupsDir = makeFakeDir('backups');
  const root = {
    name: 'root',
    async getDirectoryHandle(name, opts = {}) {
      if (name !== 'backups') throw new Error('TypeMismatchError');
      return backupsDir;
    },
    async getFileHandle() {
      throw new Error('TypeMismatchError');
    },
    async *entries() {},
  };
  return {
    root,
    backupsDir,
    storage: { getDirectory: async () => root },
  };
}

async function withNavigator(storage, fn) {
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    value: { storage },
    configurable: true,
    writable: true,
  });
  try {
    return await fn();
  } finally {
    if (desc) Object.defineProperty(globalThis, 'navigator', desc);
    else delete globalThis.navigator;
  }
}

const DATA = {
  meta: { version: 1, updatedAt: '2026-08-16T10:00:00.000Z' },
  catalog: {},
  library: {},
  review: [],
  settings: {},
};

const STAMP = '20260816-100000';

test('save guarda un .bak con timestamp y list/read lo recuperan parseado', async () => {
  const dir = makeFakeDir('backups');
  const store = createBackupStore(async () => dir, { stamp: () => STAMP });
  const res = await store.save(serialize(DATA));
  assert.equal(res.ok, true);
  assert.equal(res.name, `tvtime-data.${STAMP}.bak`);
  const listed = await store.list();
  assert.deepEqual(listed, { ok: true, backups: [`tvtime-data.${STAMP}.bak`] });
  const read = await store.read(res.name);
  assert.equal(read.ok, true);
  assert.deepEqual(read.data, DATA);
});

test('rota a las últimas 5 copias', async () => {
  const dir = makeFakeDir('backups');
  let i = 0;
  const store = createBackupStore(async () => dir, { stamp: () => `20260816-10000${i++}` });
  for (let k = 0; k < 7; k += 1) await store.save(serialize(DATA));
  const listed = await store.list();
  assert.deepEqual(listed.backups, [
    'tvtime-data.20260816-100006.bak',
    'tvtime-data.20260816-100005.bak',
    'tvtime-data.20260816-100004.bak',
    'tvtime-data.20260816-100003.bak',
    'tvtime-data.20260816-100002.bak',
  ]);
});

test('guardar dos copias en el mismo segundo crea dos ficheros distintos', async () => {
  const dir = makeFakeDir('backups');
  const store = createBackupStore(async () => dir, { stamp: () => STAMP });
  const first = await store.save(serialize(DATA));
  const second = await store.save(serialize(DATA));
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(first.name, `tvtime-data.${STAMP}.bak`);
  assert.equal(second.name, `tvtime-data.${STAMP}_1.bak`);
  assert.notEqual(first.name, second.name);
  const listed = await store.list();
  assert.deepEqual(listed, {
    ok: true,
    backups: [`tvtime-data.${STAMP}_1.bak`, `tvtime-data.${STAMP}.bak`],
  });
});

test('7 guardados en el mismo segundo dejan las 5 copias más recientes', async () => {
  const dir = makeFakeDir('backups');
  const store = createBackupStore(async () => dir, { stamp: () => STAMP });
  for (let k = 0; k < 7; k += 1) await store.save(serialize(DATA));
  const listed = await store.list();
  assert.deepEqual(listed.backups, [
    `tvtime-data.${STAMP}_6.bak`,
    `tvtime-data.${STAMP}_5.bak`,
    `tvtime-data.${STAMP}_4.bak`,
    `tvtime-data.${STAMP}_3.bak`,
    `tvtime-data.${STAMP}_2.bak`,
  ]);
});

test('solo cuenta los .bak, ignora otros ficheros', async () => {
  const dir = makeFakeDir('backups');
  dir._files.set('notas.txt', 'hola');
  const store = createBackupStore(async () => dir, { stamp: () => STAMP });
  await store.save(serialize(DATA));
  const listed = await store.list();
  assert.deepEqual(listed.backups, [`tvtime-data.${STAMP}.bak`]);
});

test('sin almacén de backups: save queda skipped y list vacío', async () => {
  const store = createBackupStore(async () => null);
  assert.deepEqual(await store.save('{}'), { ok: false, skipped: true });
  assert.deepEqual(await store.list(), { ok: false, backups: [] });
});

test('read de una copia inexistente devuelve MISSING, no CORRUPT', async () => {
  const dir = makeFakeDir('backups');
  const store = createBackupStore(async () => dir, { stamp: () => STAMP });
  const res = await store.read('tvtime-data.19990101-000000.bak');
  assert.equal(res.ok, false);
  assert.equal(res.error, 'MISSING');
});

test('read clasifica backup ilegible como CORRUPT y versión futura como VERSION', async () => {
  const dir = makeFakeDir('backups');
  let i = 0;
  const store = createBackupStore(async () => dir, { stamp: () => `20260816-10000${i++}` });
  await store.save('{ no es json');
  await store.save(serialize({ ...DATA, meta: { ...DATA.meta, version: 999 } }));
  const corrupt = await store.read('tvtime-data.20260816-100000.bak');
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.error, 'CORRUPT');
  const version = await store.read('tvtime-data.20260816-100001.bak');
  assert.equal(version.ok, false);
  assert.equal(version.error, 'VERSION');
});

test('fs.saveBackup persiste el backup sin necesitar handle', async () => {
  const fake = makeFakeOpfs();
  await withNavigator(fake.storage, async () => {
    const res = await fs.saveBackup(DATA);
    assert.equal(res.ok, true);
    assert.match(res.name, /^tvtime-data\.\d{8}-\d{6}\.bak$/);
    const listed = await fs.listBackups();
    assert.deepEqual(listed.backups, [res.name]);
    const read = await fs.readBackup(res.name);
    assert.equal(read.ok, true);
    assert.deepEqual(read.data, DATA);
  });
});

test('hasOpfs detecta disponibilidad de OPFS (navigator.storage.getDirectory)', async () => {
  await withNavigator({}, async () => {
    assert.equal(fs.hasOpfs(), false);
  });
  await withNavigator(undefined, async () => {
    assert.equal(fs.hasOpfs(), false);
  });
  await withNavigator({ getDirectory: async () => ({}) }, async () => {
    assert.equal(fs.hasOpfs(), true);
  });
  await withNavigator({}, async () => {
    assert.equal(fs.hasOpfs(), false);
  });
});

test('saveToOpfs/loadFromOpfs devuelven { unsupported: true } sin OPFS', async () => {
  await withNavigator({}, async () => {
    assert.deepEqual(await fs.saveToOpfs(DATA), { unsupported: true });
    assert.deepEqual(await fs.loadFromOpfs(), { unsupported: true });
  });
});

test('fs.saveRawBackup guarda texto crudo y emptyData es restaurable', async () => {
  const fake = makeFakeOpfs();
  await withNavigator(fake.storage, async () => {
    const raw = '{\n  "roto"';
    const res = await fs.saveRawBackup(raw);
    assert.equal(res.ok, true);
    const read = await fs.readBackup(res.name);
    assert.equal(read.ok, false);
    assert.equal(read.error, 'CORRUPT');
    const fresh = emptyData();
    const res2 = await fs.saveBackup(fresh);
    const read2 = await fs.readBackup(res2.name);
    assert.equal(read2.ok, true);
    assert.deepEqual(read2.data, fresh);
  });
});
