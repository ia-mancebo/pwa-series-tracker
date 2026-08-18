import { test } from 'node:test';
import assert from 'node:assert/strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
    this._html = escapeHtml(this._text);
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
  let calls = 0;
  const transport = async (url) => {
    calls += 1;
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
  return { transportCalls: () => calls };
}

function buildRoot() {
  const root = new FakeElement('div');
  const elements = {
    '[data-role="notices"]': new FakeElement('div'),
    '[data-role="feed"]': new FakeElement('div'),
    '[data-role="estrenos-status"]': new FakeElement('div'),
    '[data-role="premieres"]': new FakeElement('div'),
    '[data-role="tabs"]': new FakeElement('div'),
    '[data-role="seg"]': new FakeElement('div'),
    '[data-action="refresh"]': new FakeElement('button'),
    '[data-role="pane-feed"]': new FakeElement('div'),
    '[data-role="pane-estrenos"]': new FakeElement('div'),
  };
  const premieres = elements['[data-role="premieres"]'];
  const row = new FakeElement('li');
  row.dataset.key = PREMIERE_KEY;
  const back = new FakeElement('button');
  const follow = new FakeElement('button');
  root.querySelector = (sel) => elements[sel] || null;
  root.querySelectorAll = () => [];
  premieres.querySelectorAll = () => [row];
  premieres.querySelector = (sel) =>
    ({ '.nov-follow': follow, '[data-action="detail-back"]': back })[sel] || null;
  return { root, elements, premieres, row, follow };
}

function tabClickEvent(tab) {
  const button = { dataset: { tab } };
  button.closest = () => button;
  return { target: button };
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

test('la shell muestra dos pestañas con «Novedades de lo que sigo» activa por defecto y el botón «Actualizar estrenos» en su feed', async () => {
  const { mount } = await import('./novedades.js');
  const { root, elements } = buildRoot();
  await setup();
  mount(root);

  assert.ok(root.innerHTML.includes('Novedades de lo que sigo'), 'la shell renderiza la pestaña de capítulos');
  assert.ok(root.innerHTML.includes('Estrenos de lo que no sigo'), 'la shell renderiza la pestaña de estrenos');
  assert.ok(root.innerHTML.includes('Actualizar estrenos'), 'el botón se llama «Actualizar estrenos»');
  assert.ok(!root.innerHTML.includes('Actualizar novedades'), 'el nombre viejo del botón desaparece');
  assert.ok(root.innerHTML.includes('class="act" data-tab="feed"'), 'la pestaña de capítulos activa por defecto');
  assert.ok(root.innerHTML.includes('data-role="pane-feed"'), 'el feed de capítulos se renderiza');
  assert.ok(root.innerHTML.includes('data-role="pane-estrenos" hidden'), 'el feed de estrenos oculto por defecto');
});

test('cambiar de pestaña alterna los feeds sin re-buscar estrenos ni perder su contenido', async () => {
  const { mount } = await import('./novedades.js');
  const { root, elements, premieres } = buildRoot();
  const { transportCalls } = await setup();
  mount(root);

  const refresh = elements['[data-action="refresh"]'];
  refresh.dispatch('click', { currentTarget: refresh });
  await waitFor(() => premieres.innerHTML.includes('nov-prem'));
  const afterLoad = transportCalls();
  assert.ok(afterLoad > 0, 'la carga inicial de estrenos usa el transport');

  const tabs = elements['[data-role="tabs"]'];
  tabs.dispatch('click', tabClickEvent('estrenos'));
  assert.equal(elements['[data-role="pane-feed"]'].hidden, true);
  assert.equal(elements['[data-role="pane-estrenos"]'].hidden, false);
  assert.ok(premieres.innerHTML.includes('nov-prem'), 'el feed de estrenos conserva su contenido al cambiar de pestaña');
  assert.equal(transportCalls(), afterLoad, 'cambiar de pestaña no vuelve a buscar estrenos');

  tabs.dispatch('click', tabClickEvent('feed'));
  assert.equal(elements['[data-role="pane-feed"]'].hidden, false);
  assert.equal(elements['[data-role="pane-estrenos"]'].hidden, true);
  assert.equal(transportCalls(), afterLoad);
});

test('los avisos globales de conexión se muestran en la shell', async () => {
  const { mount } = await import('./novedades.js');
  const { root, elements } = buildRoot();
  await setup();
  mount(root);
  assert.equal(elements['[data-role="notices"]'].innerHTML, '');

  globalThis.navigator.onLine = false;
  const { setState } = await import('../store.js');
  setState({});
  assert.ok(elements['[data-role="notices"]'].innerHTML.includes('sin conexión'), 'la shell avisa sin conexión');
  globalThis.navigator.onLine = true;
});

test('una fila agrupada del feed de capítulos renderiza y navega a Detalle', async () => {
  const { mount } = await import('./novedades.js');
  const { root, elements } = buildRoot();
  await setup();
  mount(root);

  const key = 'tmdb:tv:9';
  const { setState, getState } = await import('../store.js');
  const data = getState().data;
  const day = recentDate(1);
  data.catalog[key] = {
    id: key,
    type: 'series',
    isAnime: false,
    names: { es: 'Serie agrupada', en: null, romaji: null, native: null },
    synopsis: '',
    poster: null,
    backdrop: null,
    releaseDate: '2020-01-01',
    status: 'returning',
    genres: [],
    voteAverage: null,
    seasons: [
      { n: 1, episodes: [{ n: 1, name: 'A', airDate: day, runtime: 45 }, { n: 2, name: 'B', airDate: day, runtime: 45 }] },
    ],
    fetchedAt: new Date().toISOString(),
  };
  data.library[key] = {};

  const groupRow = new FakeElement('li');
  groupRow.dataset.key = key;
  elements['[data-role="feed"]'].querySelectorAll = () => [groupRow];

  setState({ data: { ...data } });
  assert.ok(elements['[data-role="feed"]'].innerHTML.includes('nov-ep-group'), 'el feed renderiza la fila agrupada');
  assert.ok(elements['[data-role="feed"]'].innerHTML.includes('Temporada 1 completa'), 'el grupo cubre toda la temporada emitida');

  groupRow.dispatch('click', {});
  assert.equal(getState().screen, 'detalle');
  assert.deepEqual(getState().detail, { key, back: 'novedades' });
});

test('«Actualizar estrenos» refresca solo el feed de estrenos y no toca el de capítulos', async () => {
  const { mount } = await import('./novedades.js');
  const { root, elements } = buildRoot();
  await setup();
  mount(root);

  const feed = elements['[data-role="feed"]'];
  const before = feed.innerHTML;
  const refresh = elements['[data-action="refresh"]'];
  refresh.dispatch('click', { currentTarget: refresh });

  assert.ok(elements['[data-role="estrenos-status"]'].innerHTML.includes('Cargando estrenos'), 'el refresco entra en estado de carga de estrenos');
  assert.equal(feed.innerHTML, before, 'refrescar estrenos no re-renderiza el feed de capítulos');
});