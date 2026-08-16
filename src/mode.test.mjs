import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode, readModePreference, shouldResetDirtyAtBoot } from '../src/mode.js';

test('resolveMode: soporte FSA + auto → fsaccess (comportamiento actual)', () => {
  assert.equal(resolveMode(true), 'fsaccess');
  assert.equal(resolveMode(true, 'auto'), 'fsaccess');
});

test('resolveMode: sin soporte FSA + auto → manual', () => {
  assert.equal(resolveMode(false), 'manual');
  assert.equal(resolveMode(false, 'auto'), 'manual');
});

test('resolveMode: preferencia manual manda sobre el soporte', () => {
  assert.equal(resolveMode(true, 'manual'), 'manual');
  assert.equal(resolveMode(false, 'manual'), 'manual');
});

test('resolveMode: no muta ni depende de estado externo', () => {
  const first = resolveMode(true, 'manual');
  const second = resolveMode(true, 'auto');
  assert.equal(first, 'manual');
  assert.equal(second, 'fsaccess');
});

test('readModePreference: normaliza la preferencia guardada a auto/manual', () => {
  assert.equal(readModePreference(null), 'auto');
  assert.equal(readModePreference(undefined), 'auto');
  assert.equal(readModePreference({ ok: true, preference: 'auto' }), 'auto');
  assert.equal(readModePreference({ ok: true, preference: 'manual' }), 'manual');
  assert.equal(readModePreference({ ok: false, preference: null }), 'auto');
  assert.equal(readModePreference({ preference: 'garbage' }), 'auto');
});

test('shouldResetDirtyAtBoot: solo limpia dirty en modos que no son manual', () => {
  assert.equal(shouldResetDirtyAtBoot('fsaccess'), true);
  assert.equal(shouldResetDirtyAtBoot('manual'), false);
});