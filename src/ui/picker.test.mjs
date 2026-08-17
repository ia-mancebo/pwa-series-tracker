import { test } from 'node:test';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.listeners = {};
    this.dataset = {};
    this.isConnected = true;
    this._html = '';
    this._text = '';
    this.value = '';
    this.className = '';
    this.children = [];
    this.parentNode = null;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, event) {
    for (const fn of [...(this.listeners[type] || [])]) fn(event);
  }
  set innerHTML(v) {
    this._html = String(v);
    this._text = '';
  }
  get innerHTML() {
    return this._html;
  }
  set textContent(v) {
    this._text = String(v);
    this._html = escapeHtml(v);
  }
  get textContent() {
    return this._text;
  }
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
  }
  remove() {
    if (this.parentNode) {
      const index = this.parentNode.children.indexOf(this);
      if (index >= 0) this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
    this.isConnected = false;
  }
  focus() {
    this.isFocused = true;
  }
  querySelector(sel) {
    return (globalThis.__elements || {})[sel] || null;
  }
  querySelectorAll() {
    return globalThis.__rows || [];
  }
}

function rowElement(key) {
  const row = new FakeElement('li');
  row.dataset.key = key;
  return row;
}

Object.defineProperty(globalThis, 'document', {
  value: { createElement: () => new FakeElement() },
  configurable: true,
});

async function setup() {
  const { setState } = await import('../store.js');
  setState({ data: { settings: { tmdbApiKey: 'test-key' } } });
  globalThis.__searchCalls = [];
  globalThis.__originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { Page: { media: [] } } }),
  });
  const anilist = await import('../anilist.js');
  anilist._setTimers({ intervalMs: 0 });
  anilist._resetThrottle();
  const transport = async (url) => {
    globalThis.__searchCalls.push(url);
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/search/movie')) {
      return {
        results: [
          {
            id: 1,
            title: 'Película A',
            release_date: '2020-01-01',
            original_language: 'es',
            genre_ids: [],
            poster_path: '/movie1.jpg',
          },
        ],
      };
    }
    if (parsed.pathname.endsWith('/search/tv')) {
      return {
        results: [
          {
            id: 2,
            name: 'Serie B',
            first_air_date: '2019-05-05',
            original_language: 'en',
            genre_ids: [],
            poster_path: '/serie2.jpg',
          },
        ],
      };
    }
    return { results: [] };
  };
  const tmdb = await import('../tmdb.js');
  tmdb._setTransport(transport);
}

test.afterEach(() => {
  globalThis.fetch = globalThis.__originalFetch;
});

function buildPicker(type, query) {
  const root = new FakeElement('div');
  const input = new FakeElement('input');
  const go = new FakeElement('button');
  const cancel = new FakeElement('button');
  const body = new FakeElement('div');
  globalThis.__elements = {
    '.sr-input': input,
    '.sr-go': go,
    '.picker-cancel': cancel,
    '[data-role="body"]': body,
  };
  globalThis.__rows = [];
  const picks = [];
  const { mountPicker } = pickerModule;
  const api = mountPicker(root, { onPick: (result) => picks.push(result), type });
  const overlay = root.children[0];
  input.value = query;
  input.dispatch('input', {});
  return { root, overlay, input, go, cancel, body, picks, api };
}

let pickerModule = null;

test.before(async () => {
  pickerModule = await import('./picker.js');
});

test('mountPicker renderiza campo, botón y cancelar', async () => {
  await setup();
  const root = new FakeElement('div');
  const input = new FakeElement('input');
  const go = new FakeElement('button');
  const cancel = new FakeElement('button');
  const body = new FakeElement('div');
  globalThis.__elements = {
    '.sr-input': input,
    '.sr-go': go,
    '.picker-cancel': cancel,
    '[data-role="body"]': body,
  };
  globalThis.__rows = [];
  pickerModule.mountPicker(root, { onPick: () => {}, type: 'serie' });

  const overlay = root.children[0];
  assert.ok(overlay, 'el overlay debe montarse en root');
  assert.equal(overlay.className, 'picker');
  assert.ok(overlay.innerHTML.includes('Buscar por título'), 'debe renderizar el placeholder');
  assert.equal(overlay.querySelector('.sr-input'), input);
  assert.equal(overlay.querySelector('.sr-go'), go);
  assert.equal(overlay.querySelector('.picker-cancel'), cancel);
  assert.ok(input.isFocused, 'el foco debe ir al campo de búsqueda');
});

test('escribir y debounce muestra resultados filtrados por tipo', async () => {
  await setup();
  const scenarios = [
    ['pelicula', 'tmdb:movie:1', 'tmdb:tv:2'],
    ['serie', 'tmdb:tv:2', 'tmdb:movie:1'],
    ['temporada', 'tmdb:tv:2', 'tmdb:movie:1'],
  ];
  for (const [type, expected, unexpected] of scenarios) {
    const { body } = buildPicker(type, 'a');
    await sleep(1200);
    assert.ok(
      body.innerHTML.includes(`data-key="${expected}"`),
      `${type} debe mostrar ${expected}`
    );
    assert.ok(
      !body.innerHTML.includes(`data-key="${unexpected}"`),
      `${type} no debe mostrar ${unexpected}`
    );
  }
});

test('elegir un resultado dispara onPick y cierra el widget', async () => {
  await setup();
  const { root, body, picks } = buildPicker('pelicula', 'a');
  globalThis.__rows = [rowElement('tmdb:movie:1')];
  await sleep(1200);

  assert.ok(body.innerHTML.includes('sr-row'), 'los resultados deben renderizarse');
  globalThis.__rows[0].dispatch('click', {});

  assert.equal(picks.length, 1, 'onPick debe llamarse una vez');
  assert.equal(picks[0].key, 'tmdb:movie:1', 'onPick recibe el resultado elegido');
  assert.equal(root.children.length, 0, 'el overlay debe quitarse');
});

test('cancelar no dispara onPick y cierra', async () => {
  await setup();
  const { root, cancel, picks } = buildPicker('pelicula', '');
  cancel.dispatch('click', {});

  assert.equal(picks.length, 0, 'onPick no debe llamarse');
  assert.equal(root.children.length, 0, 'el overlay debe quitarse');
});

test('Escape cierra sin onPick', async () => {
  await setup();
  const { root, overlay, picks } = buildPicker('pelicula', '');
  overlay.dispatch('keydown', { key: 'Escape' });

  assert.equal(picks.length, 0, 'onPick no debe llamarse');
  assert.equal(root.children.length, 0, 'el overlay debe quitarse');
});

test('close() devuelto por mountPicker cierra el widget', async () => {
  await setup();
  const { root, api } = buildPicker('pelicula', '');
  api.close();

  assert.equal(root.children.length, 0, 'el overlay debe quitarse');
});

test('aviso de degradación sin clave TMDB se muestra', async () => {
  await setup();
  const { setState } = await import('../store.js');
  setState({ data: { settings: {} } });
  const { body } = buildPicker('pelicula', 'a');
  await sleep(1200);

  assert.ok(body.innerHTML.includes('sr-notice warn'), 'debe renderizarse el aviso warn');
  assert.ok(body.innerHTML.includes('sin clave TMDB'), 'debe avisarse de la falta de clave TMDB');
});

test('resultado con póster, nombre, año y tipo se renderiza', async () => {
  await setup();
  const { body } = buildPicker('pelicula', 'a');
  await sleep(1200);

  assert.ok(body.innerHTML.includes('sr-poster'), 'debe renderizar el póster');
  assert.ok(body.innerHTML.includes('sr-name'), 'debe renderizar el nombre');
  assert.ok(body.innerHTML.includes('sr-meta'), 'debe renderizar los metadatos');
  assert.ok(body.innerHTML.includes('2020'), 'debe mostrar el año');
  assert.ok(body.innerHTML.includes('película'), 'debe mostrar el tipo');
});