import { test } from 'node:test';
import assert from 'node:assert/strict';

function disconnectTree(el) {
  el.isConnected = false;
  for (const child of el.children) disconnectTree(child);
}

class FakeEl {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.isConnected = true;
    this._html = '';
    this._text = '';
    this.hidden = false;
    this.disabled = false;
    this.files = null;
    this._byRole = {};
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, event) {
    for (const fn of [...(this.listeners[type] || [])]) fn(event);
  }
  appendChild(el) {
    el.isConnected = this.isConnected;
    this.children.push(el);
    return el;
  }
  replaceChildren() {
    for (const child of this.children) disconnectTree(child);
    this.children.length = 0;
  }
  querySelector(sel) {
    const match = /data-role="([^"]+)"/.exec(sel);
    const role = match && match[1];
    if (!role) return null;
    let el = this._byRole[role];
    if (!el) {
      el = new FakeEl('div');
      this._byRole[role] = el;
      this.appendChild(el);
    }
    return el;
  }
  querySelectorAll() {
    return [];
  }
  closest() {
    return null;
  }
  click() {}
  set innerHTML(value) {
    this._html = String(value);
    for (const child of this.children) disconnectTree(child);
    this.children.length = 0;
    this._byRole = {};
  }
  get innerHTML() {
    return this._html;
  }
  set textContent(value) {
    this._text = String(value);
  }
  get textContent() {
    return this._text;
  }
}

Object.defineProperty(globalThis, 'document', {
  value: { createElement: (tag) => new FakeEl(tag) },
  configurable: true,
});

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeData() {
  return {
    meta: { version: 1, updatedAt: '2026-08-15T00:00:00Z' },
    catalog: {},
    library: {},
    review: [],
    settings: {},
  };
}

test('importar: el progreso de la importación sobrevive a salir y volver a la pestaña', async () => {
  const { setState } = await import('./store.js');
  const { mount } = await import('./ui/importar.js');

  setState({
    data: makeData(),
    saveStatus: { state: 'idle', lastSavedAt: null, dirty: true },
    importStatus: null,
  });

  let release;
  const started = new Promise((resolve) => {
    release = resolve;
  });
  const runImport = async (data, files, opts) => {
    opts.onProgress({ phase: 'match', pct: 0.2 });
    await started;
    opts.onProgress({ phase: 'match', pct: 1 });
    return { data, summary: { matched: 3, queued: 1 } };
  };

  const container = new FakeEl('div');
  const root = new FakeEl('div');
  container.appendChild(root);
  mount(root, { runImport });

  const csvInput = root.querySelector('[data-role="csv-input"]');
  csvInput.files = [{ name: 'tracking-prod-records-v2.csv', text: async () => 'a,b\n1,2\n' }];
  csvInput.dispatch('change', {});

  assert.match(root.querySelector('[data-role="estado"]').textContent, /Leyendo CSVs/);
  await flush();
  assert.match(root.querySelector('[data-role="estado"]').textContent, /Importando… \(20%\)/);
  assert.equal(root.querySelector('[data-role="elegir"]').disabled, true);

  // Salir de la pestaña: #screen-content retira el host del montaje (ADR-0003); al volver se crea uno nuevo.
  container.replaceChildren();
  assert.equal(root.isConnected, false);

  const root2 = new FakeEl('div');
  container.appendChild(root2);
  mount(root2, { runImport });

  // El montaje nuevo debe retomar el progreso en curso, no arrancar vacío.
  assert.match(root2.querySelector('[data-role="estado"]').textContent, /Importando… \(20%\)/);
  assert.equal(root2.querySelector('[data-role="elegir"]').disabled, true, 'sigue bloqueado mientras la importación corre');

  release();
  await flush();

  assert.match(root2.querySelector('[data-role="estado"]').textContent, /Importación terminada/);
  assert.equal(root2.querySelector('[data-role="ir-revision"]').hidden, false);
});