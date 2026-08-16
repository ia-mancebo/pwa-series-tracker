import test from 'node:test';
import assert from 'node:assert/strict';
import { createCache, createMemoryBackend } from '../src/cache.js';

function makeCache(opts = {}) {
  return createCache({ backend: createMemoryBackend(), ...opts });
}

test('set/get redondo', async () => {
  const cache = makeCache();
  await cache.set('a', { hello: 'mundo' });
  assert.deepEqual(await cache.get('a'), { hello: 'mundo' });
});

test('get de clave ausente devuelve null', async () => {
  const cache = makeCache();
  assert.equal(await cache.get('nope'), null);
});

test('TTL expira la entrada', async () => {
  const cache = makeCache({ ttlMs: 5 });
  await cache.set('a', 1);
  assert.equal(await cache.get('a'), 1);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(await cache.get('a'), null);
});

test('LRU: al superar el máximo se expulsa el menos tocado', async () => {
  const cache = makeCache({ maxEntries: 3 });
  await cache.set('a', 1);
  await cache.set('b', 2);
  await cache.set('c', 3);
  await cache.get('a');
  await cache.set('d', 4);
  assert.equal(await cache.get('a'), 1);
  assert.equal(await cache.get('b'), null);
  assert.equal(await cache.get('c'), 3);
  assert.equal(await cache.get('d'), 4);
});

test('LRU: sobreescribir renueva touchedAt', async () => {
  const cache = makeCache({ maxEntries: 2 });
  await cache.set('a', 1);
  await cache.set('b', 2);
  await cache.set('a', 3);
  await cache.set('c', 4);
  assert.equal(await cache.get('a'), 3);
  assert.equal(await cache.get('b'), null);
  assert.equal(await cache.get('c'), 4);
});

test('del elimina la entrada', async () => {
  const cache = makeCache();
  await cache.set('a', 1);
  await cache.del('a');
  assert.equal(await cache.get('a'), null);
});

test('clear vacía el caché', async () => {
  const cache = makeCache();
  await cache.set('a', 1);
  await cache.set('b', 2);
  await cache.clear();
  assert.equal(await cache.get('a'), null);
  assert.equal(await cache.get('b'), null);
});

test('valores falsey se guardan y devuelven', async () => {
  const cache = makeCache();
  await cache.set('zero', 0);
  await cache.set('empty', '');
  assert.equal(await cache.get('zero'), 0);
  assert.equal(await cache.get('empty'), '');
});

test('get renueva touchedAt (no expira con uso continuo)', async () => {
  const cache = makeCache({ ttlMs: 30 });
  await cache.set('a', 1);
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(await cache.get('a'), 1);
  }
});
