import { test } from 'node:test';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class FakeElement {
  constructor(tag = 'div') {
    this.tag = tag;
    this.listeners = {};
    this.dataset = {};
    this.isConnected = true;
    this._html = '';
    this._text = '';
    this.value = '';
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, event) {
    for (const fn of [...(this.listeners[type] || [])]) fn(event);
  }
  set innerHTML(v) {
    this._html = String(v);
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

function buildRoot() {
  const input = new FakeElement('input');
  const go = new FakeElement('button');
  const body = new FakeElement('div');
  const root = new FakeElement('div');
  const back = new FakeElement('button');
  const follow = new FakeElement('button');
  root.querySelector = (sel) =>
    ({ '.sr-input': input, '.sr-go': go, '[data-role="body"]': body })[sel] || null;
  body.querySelector = (sel) => ({ '.sr-back': back, '.sr-follow': follow })[sel] || null;
  body.querySelectorAll = () => globalThis.__rows;
  return { root, input, go, body, back, follow };
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

async function setup({ delays = {} } = {}) {
  const { setState } = await import('../store.js');
  setState({ data: { settings: { tmdbApiKey: 'test-key' } } });
  globalThis.__searchCalls = [];
  globalThis.__rows = [];
  const anilist = await import('../anilist.js');
  anilist._setTimers({ intervalMs: 0 });
  anilist._resetThrottle();
  globalThis.__originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ data: { Page: { media: [] } } }),
  });
  const transport = async (url) => {
    globalThis.__searchCalls.push(url);
    const parsed = new URL(url);
    const query = parsed.searchParams.get('query');
    const delay = delays[query] ?? 0;
    if (delay) await sleep(delay);
    if (parsed.pathname.endsWith('/search/movie')) {
      return { results: [{ id: 1, title: 'Película A', first_air_date: null, original_language: 'en', genre_ids: [] }] };
    }
    if (parsed.pathname.endsWith('/search/tv')) return { results: [] };
    if (parsed.pathname.endsWith('/movie/1')) {
      return { id: 1, title: 'Película A', overview: '', status: 'Released', genres: [], vote_average: 7, release_date: '2020-01-01' };
    }
    return { results: [] };
  };
  const tmdb = await import('../tmdb.js');
  tmdb._setTransport(transport);
  return { transport };
}

function searchCount() {
  return globalThis.__searchCalls.filter((u) => u.includes('/search/tv') && u.includes('language=es')).length;
}

test.afterEach(() => {
  globalThis.fetch = globalThis.__originalFetch;
});

async function openSearchDetail(input, row) {
  input.value = 'peli';
  input.dispatch('input', {});
  await sleep(60);
  row.dispatch('click', {});
  await sleep(10);
}

test('clic en «Seguir» de un título fuera de la biblioteca lo añade y navega a Detalle', async () => {
  const { mount } = await import('./buscar.js');
  const { root, input, body, follow } = buildRoot();
  await setup();
  globalThis.__rows = [rowElement('tmdb:movie:1')];
  mount(root, { debounceMs: 30 });
  await openSearchDetail(input, globalThis.__rows[0]);

  assert.ok(body.innerHTML.includes('sr-detail'), 'el detalle debe estar abierto');
  assert.ok(body.innerHTML.includes('Seguir'), 'la etiqueta debe ser «Seguir» sin estado previo');

  follow.dataset.key = 'tmdb:movie:1';
  follow.dispatch('click', { currentTarget: follow });
  await sleep(20);

  const { getState } = await import('../store.js');
  const state = getState();
  assert.equal(state.screen, 'detalle');
  assert.deepEqual(state.detail, { key: 'tmdb:movie:1', back: 'buscar' });
  assert.ok(state.data.library['tmdb:movie:1'] !== undefined, 'se crea la entrada de biblioteca');
  assert.ok(state.data.catalog['tmdb:movie:1'] !== undefined, 'se añaden los metadatos de catálogo');
  assert.ok(!('followed' in state.data.library['tmdb:movie:1']), 'el título queda seguido');
});

test('título en biblioteca y seguido: el botón refleja el estado y navega sin duplicar', async () => {
  const { mount } = await import('./buscar.js');
  const { setState } = await import('../store.js');
  const { root, input, body, follow } = buildRoot();
  await setup();
  setState({
    data: {
      settings: { tmdbApiKey: 'test-key' },
      library: { 'tmdb:movie:1': { watched: ['2026-01-01T10:00:00Z'] } },
    },
  });
  globalThis.__rows = [rowElement('tmdb:movie:1')];
  mount(root, { debounceMs: 30 });
  await openSearchDetail(input, globalThis.__rows[0]);

  assert.ok(body.innerHTML.includes('Ver en Detalle'), 'la etiqueta debe reflejar que está seguido');
  assert.ok(!body.innerHTML.includes('Seguir'), 'no debe ofrecer «Seguir»');

  follow.dataset.key = 'tmdb:movie:1';
  follow.dispatch('click', { currentTarget: follow });
  await sleep(20);

  const { getState } = await import('../store.js');
  const state = getState();
  assert.equal(state.screen, 'detalle');
  assert.deepEqual(state.detail, { key: 'tmdb:movie:1', back: 'buscar' });
  assert.deepEqual(
    state.data.library['tmdb:movie:1'],
    { watched: ['2026-01-01T10:00:00Z'] },
    'no debe mutar ni duplicar la entrada'
  );
});

test('título en biblioteca y no seguido: «Seguir» lo re-sigue conservando historial y navega', async () => {
  const { mount } = await import('./buscar.js');
  const { setState } = await import('../store.js');
  const { root, input, body, follow } = buildRoot();
  await setup();
  setState({
    data: {
      settings: { tmdbApiKey: 'test-key' },
      library: { 'tmdb:movie:1': { followed: false, watched: ['2026-01-01T10:00:00Z'] } },
    },
  });
  globalThis.__rows = [rowElement('tmdb:movie:1')];
  mount(root, { debounceMs: 30 });
  await openSearchDetail(input, globalThis.__rows[0]);

  assert.ok(body.innerHTML.includes('Seguir'), 'no seguido → etiqueta «Seguir»');

  follow.dataset.key = 'tmdb:movie:1';
  follow.dispatch('click', { currentTarget: follow });
  await sleep(20);

  const { getState } = await import('../store.js');
  const state = getState();
  assert.equal(state.screen, 'detalle');
  const entry = state.data.library['tmdb:movie:1'];
  assert.ok(entry !== undefined, 'la entrada se conserva');
  assert.ok(!('followed' in entry), 'el flag followed:false se limpia');
  assert.deepEqual(entry.watched, ['2026-01-01T10:00:00Z'], 'el historial se conserva');
});

test('escribir seguido dispara una única búsqueda tras el debounce', async () => {
  const { mount } = await import('./buscar.js');
  const { root, input, body } = buildRoot();
  await setup();
  mount(root, { debounceMs: 30 });

  for (let i = 0; i < 8; i++) {
    input.value += 'a';
    input.dispatch('input', {});
    await sleep(5);
  }

  await sleep(60);
  assert.ok(body.innerHTML.includes('sr-row'), 'los resultados deben renderizarse');
  assert.equal(searchCount(), 1, `solo una búsqueda tras el debounce (hubo ${searchCount()})`);
});

test('abrir un detalle no lo cierra una búsqueda pendiente del input', async () => {
  const { mount } = await import('./buscar.js');
  const { root, input, body } = buildRoot();
  await setup();
  globalThis.__rows = [rowElement('tmdb:movie:1')];
  mount(root, { debounceMs: 30 });

  input.value = 'peli';
  input.dispatch('input', {});
  await sleep(60);
  assert.ok(body.innerHTML.includes('sr-row'), 'resultados visibles antes de abrir detalle');

  input.value = 'peli x';
  input.dispatch('input', {});

  globalThis.__rows[0].dispatch('click', {});
  await sleep(10);
  assert.ok(body.innerHTML.includes('sr-detail'), 'el detalle debe estar abierto');

  await sleep(60);
  assert.ok(
    body.innerHTML.includes('sr-detail'),
    'la búsqueda pendiente del input no debe cerrar el detalle'
  );
});

test('una búsqueda obsoleta que tarda más no pisa el detalle abierto', async () => {
  const { mount } = await import('./buscar.js');
  const { root, input, body } = buildRoot();
  await setup({ delays: { uno: 80 } });
  globalThis.__rows = [rowElement('tmdb:movie:1')];
  mount(root, { debounceMs: 30 });

  input.value = 'uno';
  input.dispatch('input', {});
  await sleep(45);

  input.value = 'uno dos';
  input.dispatch('input', {});
  await sleep(45);
  assert.ok(body.innerHTML.includes('sr-row'), 'resultados de la búsqueda nueva visibles');

  globalThis.__rows[0].dispatch('click', {});
  await sleep(10);
  assert.ok(body.innerHTML.includes('sr-detail'), 'el detalle debe estar abierto');

  await sleep(60);
  assert.ok(
    body.innerHTML.includes('sr-detail'),
    'una búsqueda obsoleta que completa tarde no debe pisar el detalle'
  );
});