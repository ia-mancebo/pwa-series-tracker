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
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  dispatch(type, event) {
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
  }
  get textContent() {
    return this._text;
  }
}

Object.defineProperty(globalThis, 'document', {
  value: { createElement: () => new FakeElement() },
  configurable: true,
});
Object.defineProperty(globalThis, 'window', {
  value: { addEventListener: () => {}, tvtimeOpenFile: null },
  configurable: true,
});
Object.defineProperty(globalThis, 'navigator', {
  value: { onLine: true },
  configurable: true,
});

const PREMIERE_KEY = 'tmdb:movie:1';

function recentDate(daysAgo = 2) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function setup() {
  const { setState } = await import('../store.js');
  setState({
    data: {
      meta: { version: 1, updatedAt: new Date().toISOString(), watermark: {} },
      catalog: {},
      library: {},
      review: [],
      settings: { tmdbApiKey: 'test-key' },
    },
  });
  const date = recentDate();
  const transport = async (url) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/discover/movie')) {
      return {
        results: [
          {
            id: 1,
            title: 'Estreno A',
            release_date: date,
            overview: '',
            poster_path: null,
            backdrop_path: null,
            status: 'Released',
            genre_ids: [],
            vote_average: 7,
            original_language: 'es',
          },
        ],
      };
    }
    if (parsed.pathname.endsWith('/discover/tv')) return { results: [] };
    if (parsed.pathname.endsWith('/movie/1')) {
      return {
        id: 1,
        title: 'Estreno A',
        release_date: date,
        overview: '',
        poster_path: null,
        backdrop_path: null,
        status: 'Released',
        genres: [],
        vote_average: 7,
      };
    }
    return { results: [] };
  };
  const tmdb = await import('../tmdb.js');
  tmdb._setTransport(transport);
}

function buildRoot() {
  const root = new FakeElement('div');
  const premieres = new FakeElement('div');
  const row = new FakeElement('li');
  row.dataset.key = PREMIERE_KEY;
  const back = new FakeElement('button');
  const follow = new FakeElement('button');
  root.querySelector = (sel) =>
    ({
      '[data-role="notices"]': new FakeElement('div'),
      '[data-role="episodes"]': new FakeElement('div'),
      '[data-role="premieres"]': premieres,
      '[data-role="seg"]': new FakeElement('div'),
      '[data-action="refresh"]': new FakeElement('button'),
    })[sel] || null;
  root.querySelectorAll = () => [];
  premieres.querySelectorAll = () => [row];
  premieres.querySelector = (sel) =>
    ({ '.nov-follow': follow, '[data-action="detail-back"]': back })[sel] || null;
  return { root, premieres, row, follow };
}

async function waitFor(fn, timeoutMs = 1000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await sleep(10);
  }
  assert.fail('condición no alcanzada a tiempo');
}

test('clic en «Seguir» de un estreno fuera de la biblioteca lo añade y navega a Detalle', async () => {
  const { mount } = await import('./novedades.js');
  const { root, premieres, row, follow } = buildRoot();
  await setup();
  mount(root);

  await waitFor(() => premieres.innerHTML.includes('nov-prem'));

  row.dispatch('click', {});
  await waitFor(() => premieres.innerHTML.includes('nov-detail'));
  assert.ok(premieres.innerHTML.includes('Seguir'), 'la etiqueta debe ser «Seguir» sin estado previo');

  follow.dataset.key = PREMIERE_KEY;
  follow.dispatch('click', {});
  await sleep(20);

  const { getState } = await import('../store.js');
  const state = getState();
  assert.equal(state.screen, 'detalle');
  assert.deepEqual(state.detail, { key: PREMIERE_KEY, back: 'novedades' });
  assert.ok(state.data.library[PREMIERE_KEY] !== undefined, 'se crea la entrada de biblioteca');
  assert.ok(state.data.catalog[PREMIERE_KEY] !== undefined, 'se añaden los metadatos de catálogo');
  assert.ok(!('followed' in state.data.library[PREMIERE_KEY]), 'el título queda seguido');
});