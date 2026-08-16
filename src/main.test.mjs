import { test } from 'node:test';
import assert from 'node:assert/strict';

function disconnectTree(el) {
  el.isConnected = false;
  for (const child of el.children) disconnectTree(child);
}

function makeData(key, name) {
  return {
    meta: { version: 1, updatedAt: new Date().toISOString() },
    catalog: {
      [key]: {
        id: key,
        type: 'series',
        status: 'ended',
        names: { es: name },
        seasons: [{ n: 1, episodes: [{ n: 1, name: 'Piloto', airDate: '2020-01-01' }] }],
      },
    },
    library: { [key]: { followed: true, episodes: {} } },
    review: [],
    settings: {},
  };
}

function makeEpisodeButton(sxe) {
  const wrapper = new FakeElement('div');
  wrapper.dataset.sxe = sxe;
  const button = new FakeElement('button');
  button.dataset.action = 'toggle-ep';
  button.closest = (sel) => {
    if (sel === '.det-star') return null;
    if (sel === '.det-ep') return wrapper;
    if (sel === '[data-action]') return button;
    return null;
  };
  return { wrapper, button };
}

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.children = [];
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.isConnected = true;
    this._html = '';
    this._text = '';
    this.hidden = false;
    this.files = null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  removeEventListener(type, fn) {
    if (!this.listeners[type]) return;
    this.listeners[type] = this.listeners[type].filter((f) => f !== fn);
  }
  dispatch(type, event) {
    for (const fn of [...(this.listeners[type] || [])]) fn(event);
  }
  listenerCount(type) {
    return (this.listeners[type] || []).length;
  }
  appendChild(el) {
    el.isConnected = this.isConnected;
    this.children.push(el);
    return el;
  }
  remove() {
    this.isConnected = false;
  }
  replaceChildren() {
    for (const child of this.children) disconnectTree(child);
    this.children.length = 0;
  }
  contains() {
    return true;
  }
  querySelector() {
    return new FakeElement();
  }
  querySelectorAll() {
    return [];
  }
  closest() {
    return null;
  }
  click() {}
  set innerHTML(v) {
    this._html = String(v);
    for (const child of this.children) disconnectTree(child);
    this.children.length = 0;
  }
  get innerHTML() {
    return this._html;
  }
  set textContent(v) {
    this._text = String(v);
  }
  get textContent() {
    return this._text;
  }
}

const root = new FakeElement('div');
const elements = {
  'screen-content': root,
  'screen-title': new FakeElement(),
  'open-file-btn': new FakeElement('button'),
  'save-file-btn': new FakeElement('button'),
  'save-retry-btn': new FakeElement('button'),
};

Object.defineProperty(globalThis, 'document', {
  value: {
    getElementById: (id) => elements[id] || null,
    querySelectorAll: () => [],
    createElement: (tag) => new FakeElement(tag),
    body: new FakeElement(),
    visibilityState: 'visible',
    addEventListener: () => {},
    removeEventListener: () => {},
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'window', {
  value: {
    addEventListener: () => {},
    removeEventListener: () => {},
    showOpenFilePicker: undefined,
  },
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
});
Object.defineProperty(globalThis, 'indexedDB', {
  value: {
    open() {
      const req = {
        result: null,
        error: new Error('sin indexedDB en el harness'),
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
      };
      queueMicrotask(() => req.onerror && req.onerror());
      return req;
    },
  },
  configurable: true,
});

test('render() no re-monta la pantalla con cada setState: los clics no acumulan listeners', async () => {
  const { setState } = await import('./store.js');
  await import('./main.js');
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));

  const key = 'tmdb:tv:1';
  const data = makeData(key, 'Serie de prueba');

  setState({
    screen: 'detalle',
    detailKey: key,
    data,
    saveStatus: { state: 'idle', lastSavedAt: null, dirty: true },
  });
  const host = root.children[0];
  assert.equal(host.listenerCount('click'), 1);
  assert.equal(host.listenerCount('change'), 1);

  const { subscribe } = await import('./store.js');
  let changes = 0;
  const off = subscribe(() => {
    changes += 1;
  });

  const { button } = makeEpisodeButton('1x1');

  for (let i = 0; i < 8; i++) {
    host.dispatch('click', { target: button });
  }

  assert.equal(
    host.listenerCount('click'),
    1,
    `tras 8 clics hay exactamente 1 listener de click (no ${host.listenerCount('click')})`
  );
  assert.equal(host.listenerCount('change'), 1);
  assert.equal(changes, 8);

  off();
});

test('dos visitas a Detalle no acumulan listeners en el contenedor compartido', async () => {
  const { setState } = await import('./store.js');
  await new Promise((r) => setTimeout(r, 0));

  const key = 'tmdb:tv:2';
  const data = makeData(key, 'Serie de prueba 2');
  const saveStatus = { state: 'idle', lastSavedAt: null, dirty: true };

  setState({ screen: 'biblioteca', data, saveStatus });
  setState({ screen: 'detalle', detailKey: key, data, saveStatus });
  setState({ screen: 'biblioteca', data, saveStatus });
  setState({ screen: 'detalle', detailKey: key, data, saveStatus });

  assert.equal(root.listenerCount('click'), 0);
  assert.equal(root.listenerCount('change'), 0);

  const host = root.children[0];
  assert.equal(host.listenerCount('click'), 1);
  assert.equal(host.listenerCount('change'), 1);

  const { subscribe } = await import('./store.js');
  let changes = 0;
  const off = subscribe(() => {
    changes += 1;
  });

  const { button } = makeEpisodeButton('1x1');

  host.dispatch('click', { target: button });

  assert.equal(changes, 1);

  off();
});
