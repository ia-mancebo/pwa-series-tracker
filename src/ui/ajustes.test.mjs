import { test } from 'node:test';
import assert from 'node:assert/strict';

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.listeners = {};
    this.dataset = {};
    this.isConnected = true;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.value = '';
    this._html = '';
    this._text = '';
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners[type] || [])]) fn(event);
  }
  contains() {
    return true;
  }
  set innerHTML(v) {
    this._html = String(v);
  }
  get innerHTML() {
    return this._html;
  }
  set textContent(v) {
    this._text = String(v);
    this._html = escapeHtml(this._text);
  }
  get textContent() {
    return this._text;
  }
  querySelectorAll() {
    return [];
  }
}

Object.defineProperty(globalThis, 'document', {
  value: { createElement: () => new FakeElement() },
  configurable: true,
});
Object.defineProperty(globalThis, 'window', {
  value: { addEventListener: () => {}, showOpenFilePicker: undefined },
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
});

async function setup(data) {
  const { setState } = await import('../store.js');
  const base = {
    meta: { version: 1, updatedAt: new Date().toISOString() },
    catalog: {},
    library: {},
    review: [],
    settings: { tmdbApiKey: 'test-key' },
  };
  setState({ data: data === null ? null : { ...base, ...data, settings: { ...base.settings, ...(data && data.settings) } } });
}

function buildRoot() {
  const root = new FakeElement('div');
  const key = new FakeElement('div');
  const newsWindow = new FakeElement('div');
  const importHost = new FakeElement('div');
  const revisionHost = new FakeElement('div');
  const refresh = new FakeElement('button');
  const modeStatus = new FakeElement('div');
  const modeAuto = new FakeElement('input');
  const modeManual = new FakeElement('input');

  const windowInput = new FakeElement('input');
  const windowSave = new FakeElement('button');
  const windowStatus = new FakeElement('div');
  newsWindow.querySelector = (sel) =>
    ({
      '[data-role="news-window-input"]': windowInput,
      '[data-role="news-window-save"]': windowSave,
      '[data-role="news-window-status"]': windowStatus,
    })[sel] || null;

  const keyRemove = new FakeElement('button');
  const keyInput = new FakeElement('input');
  const keySave = new FakeElement('button');
  key.querySelector = (sel) =>
    ({
      '[data-role="key-input"]': keyInput,
      '[data-role="key-save"]': keySave,
      '[data-role="key-remove"]': keyRemove,
    })[sel] || null;

  const elegir = new FakeElement('button');
  const csvInput = new FakeElement('input');
  const estado = new FakeElement('div');
  const irRevision = new FakeElement('button');
  importHost.querySelector = (sel) =>
    ({
      '[data-role="elegir"]': elegir,
      '[data-role="csv-input"]': csvInput,
      '[data-role="estado"]': estado,
      '[data-role="ir-revision"]': irRevision,
    })[sel] || null;

  const body = new FakeElement('div');
  const openFile = new FakeElement('button');
  revisionHost.querySelector = (sel) =>
    ({ '[data-role="body"]': body, '[data-role="open-file"]': openFile })[sel] || null;

  root.querySelector = (sel) =>
    ({
      '[data-role="key"]': key,
      '[data-role="news-window"]': newsWindow,
      '[data-role="import"]': importHost,
      '[data-role="revision"]': revisionHost,
      '[data-role="refresh-all"]': refresh,
      '[data-role="mode-status"]': modeStatus,
      '[data-role="mode-auto"]': modeAuto,
      '[data-role="mode-manual"]': modeManual,
    })[sel] || null;

  return { root, newsWindow, windowInput, windowSave, windowStatus };
}

test('la tarjeta «Ventana de Novedades» se muestra tras «Actualizar metadatos» con el default 90 sin ajuste guardado', async () => {
  const { mount } = await import('./ajustes.js');
  const { root, newsWindow } = buildRoot();
  await setup({ settings: {} });
  mount(root);

  const afterRefresh = root.innerHTML.indexOf('Actualizar metadatos');
  const windowCard = root.innerHTML.indexOf('Ventana de Novedades');
  assert.ok(afterRefresh >= 0 && windowCard > afterRefresh, 'la tarjeta va tras «Actualizar metadatos»');
  assert.ok(newsWindow.innerHTML.includes('value="90"'), 'sin ajuste se muestra el default 90');
  assert.ok(newsWindow.innerHTML.includes('Días por defecto: 90.'));
  assert.ok(newsWindow.innerHTML.includes('Guardar ventana'));
});

test('guardar un valor lo persiste en los ajustes del fichero y actualiza la tarjeta', async () => {
  const { mount } = await import('./ajustes.js');
  const { getState } = await import('../store.js');
  const { root, windowInput, windowSave, windowStatus } = buildRoot();
  await setup({ settings: {} });
  mount(root);

  windowInput.value = '30';
  windowSave.dispatch('click');

  assert.equal(getState().data.settings.newsWindowDays, 30);
  assert.equal(windowInput.value, '30');
  assert.equal(windowStatus.textContent, 'Ventana guardada: 30 días.');
});

test('Enter guarda la ventana igual que el botón', async () => {
  const { mount } = await import('./ajustes.js');
  const { getState } = await import('../store.js');
  const { root, windowInput } = buildRoot();
  await setup({ settings: {} });
  mount(root);

  windowInput.value = '45';
  windowInput.dispatch('keydown', { key: 'Enter' });

  assert.equal(getState().data.settings.newsWindowDays, 45);
});

test('el valor guardado se fija al rango 7–365', async () => {
  const { mount } = await import('./ajustes.js');
  const { getState } = await import('../store.js');
  const { root, windowInput, windowSave } = buildRoot();
  await setup({ settings: {} });
  mount(root);

  windowInput.value = '500';
  windowSave.dispatch('click');
  assert.equal(getState().data.settings.newsWindowDays, 365);
  assert.equal(windowInput.value, '365');

  windowInput.value = '1';
  windowSave.dispatch('click');
  assert.equal(getState().data.settings.newsWindowDays, 7);
  assert.equal(windowInput.value, '7');
});

test('un valor no numérico no guarda y restaura el valor actual', async () => {
  const { mount } = await import('./ajustes.js');
  const { getState } = await import('../store.js');
  const { root, windowInput, windowSave, windowStatus } = buildRoot();
  await setup({ settings: {} });
  mount(root);

  windowInput.value = 'abc';
  windowSave.dispatch('click');

  assert.equal(getState().data.settings.newsWindowDays, undefined);
  assert.equal(windowInput.value, '90');
  assert.ok(windowStatus.textContent.includes('Número de días entre 7 y 365'));
});

test('sin fichero vinculado la tarjeta se muestra deshabilitada', async () => {
  const { mount } = await import('./ajustes.js');
  const { root, newsWindow } = buildRoot();
  await setup(null);
  mount(root);

  assert.ok(newsWindow.innerHTML.includes('Vincula tu fichero primero'));
  assert.ok(newsWindow.innerHTML.includes('disabled'));
});

test('un valor guardado se muestra al remontar (sobrevive a un reinicio)', async () => {
  const { mount } = await import('./ajustes.js');
  const { root, newsWindow } = buildRoot();
  await setup({ settings: { newsWindowDays: 30 } });
  mount(root);

  assert.ok(newsWindow.innerHTML.includes('value="30"'), 'la tarjeta lee el ajuste guardado del fichero');
});