import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, toggleEpisodeWatched, toggleMovieWatched } from '../model.js';

class FakeElement {
  constructor() {
    this.listeners = {};
    this.isConnected = true;
    this._html = '';
    this._text = '';
  }

  addEventListener(type, listener) {
    (this.listeners[type] ||= []).push(listener);
  }

  dispatch(type, event) {
    for (const listener of this.listeners[type] || []) listener(event);
  }

  set innerHTML(value) {
    this._html = String(value);
  }

  get innerHTML() {
    return this._html || this._text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  }

  set textContent(value) {
    this._text = String(value);
  }
}

Object.defineProperty(globalThis, 'document', {
  value: { createElement: () => new FakeElement() },
  configurable: true,
});

const KEY = 'tmdb:tv:1';

function makeData(seasons) {
  const data = emptyData();
  data.catalog[KEY] = {
    id: KEY,
    type: 'series',
    isAnime: false,
    names: { es: 'Serie de prueba', en: null, romaji: null, native: null },
    seasons,
  };
  data.library[KEY] = { episodes: {} };
  return data;
}

function noAirDateSeason() {
  return makeData([{ n: 1, episodes: [{ n: 1, name: null, airDate: null, runtime: null }] }]);
}

function airedSeason() {
  return makeData([
    {
      n: 1,
      episodes: [
        { n: 1, name: null, airDate: '2026-01-01', runtime: null },
        { n: 2, name: null, airDate: '2026-01-01', runtime: null },
      ],
    },
  ]);
}

function seasonButton() {
  return {
    dataset: { action: 'mark-season', n: '1' },
    closest(selector) {
      return selector === '.det-star' ? null : this;
    },
  };
}

function toggleFollowButton() {
  return {
    dataset: { action: 'toggle-follow' },
    closest(selector) {
      return selector === '.det-star' ? null : this;
    },
  };
}

function makeMovieData() {
  const data = emptyData();
  data.catalog[KEY] = {
    id: KEY,
    type: 'movie',
    isAnime: false,
    names: { es: 'Película de prueba', en: null, romaji: null, native: null },
  };
  data.library[KEY] = {};
  return data;
}

async function mountDetail(data, key = KEY) {
  const { setState } = await import('../store.js');
  const { mount } = await import('./detalle.js');
  const root = new FakeElement();
  setState({ data, detail: { key, back: 'biblioteca' }, screen: 'detalle' });
  mount(root);
  return root;
}

function seasonStateFrom(root) {
  const html = root.innerHTML;
  const start = html.indexOf('class="det-season"');
  if (start < 0) return { pressed: null, chip: null };
  const block = html.slice(start, html.indexOf('</section>', start));
  const pressed = (block.match(/class="det-season-check"[^>]*aria-pressed="(true|false)"/) || [])[1] || null;
  const chip = (block.match(/class="lib-chip lib-chip--(paraver|viendo|visto)"/) || [])[1] || null;
  return { pressed, chip };
}

test('sin airDate: marcar temporada completa deja chip y checkbox en Para ver (sin divergir)', async () => {
  const root = await mountDetail(noAirDateSeason());
  assert.deepEqual(seasonStateFrom(root), { pressed: 'false', chip: 'paraver' });

  root.dispatch('click', { target: seasonButton() });

  assert.deepEqual(seasonStateFrom(root), { pressed: 'false', chip: 'paraver' });
});

test('el checkbox no se marca cuando todos los capítulos están vistos pero ninguno tiene airDate', async () => {
  const data = toggleEpisodeWatched(noAirDateSeason(), KEY, '1x1', '2026-08-16T10:00:00Z');
  const root = await mountDetail(data);
  assert.deepEqual(seasonStateFrom(root), { pressed: 'false', chip: 'paraver' });
});

test('el checkbox se marca cuando todos los capítulos emitidos están vistos', async () => {
  const data = toggleEpisodeWatched(airedSeason(), KEY, '1x1', '2026-08-16T10:00:00Z');
  const both = toggleEpisodeWatched(data, KEY, '1x2', '2026-08-16T10:00:00Z');
  const root = await mountDetail(both);
  assert.deepEqual(seasonStateFrom(root), { pressed: 'true', chip: 'visto' });
});

test('el checkbox no se marca cuando solo parte de los emitidos está vista', async () => {
  const data = toggleEpisodeWatched(airedSeason(), KEY, '1x1', '2026-08-16T10:00:00Z');
  const root = await mountDetail(data);
  assert.deepEqual(seasonStateFrom(root), { pressed: 'false', chip: 'viendo' });
});

test('el Detalle de un título seguido muestra «Dejar de seguir» y al pulsarlo deja de seguirse conservando historial y pantalla', async () => {
  const data = toggleEpisodeWatched(airedSeason(), KEY, '1x1', '2026-08-16T10:00:00Z');
  data.library[KEY].note = 4;
  const root = await mountDetail(data);
  assert.ok(root.innerHTML.includes('data-action="toggle-follow"'));
  assert.ok(root.innerHTML.includes('Dejar de seguir'));
  assert.ok(!root.innerHTML.includes('Seguir'));

  root.dispatch('click', { target: toggleFollowButton() });

  const { getState } = await import('../store.js');
  const state = getState();
  assert.equal(state.data.library[KEY].followed, false);
  assert.deepEqual(state.data.library[KEY].episodes['1x1'].watched, ['2026-08-16T10:00:00Z']);
  assert.equal(state.data.library[KEY].note, 4);
  assert.equal(root.isConnected, true);
  assert.equal(state.screen, 'detalle');
  assert.deepEqual(state.detail, { key: KEY, back: 'biblioteca' });
  assert.ok(root.innerHTML.includes('Seguir'));
  assert.ok(!root.innerHTML.includes('Dejar de seguir'));
});

test('el Detalle de un título en biblioteca no seguido muestra «Seguir» y al pulsarlo se re-sigue conservando historial', async () => {
  const data = toggleEpisodeWatched(airedSeason(), KEY, '1x2', '2026-08-16T10:00:00Z');
  data.library[KEY].followed = false;
  data.library[KEY].note = 3;
  const root = await mountDetail(data);
  assert.ok(root.innerHTML.includes('Seguir'));
  assert.ok(!root.innerHTML.includes('Dejar de seguir'));

  root.dispatch('click', { target: toggleFollowButton() });

  const { getState } = await import('../store.js');
  const state = getState();
  assert.ok(!('followed' in state.data.library[KEY]));
  assert.deepEqual(state.data.library[KEY].episodes['1x2'].watched, ['2026-08-16T10:00:00Z']);
  assert.equal(state.data.library[KEY].note, 3);
  assert.equal(root.isConnected, true);
  assert.ok(root.innerHTML.includes('Dejar de seguir'));
});

test('el Detalle de una película seguida conserva historial al dejar de seguir y al re-seguir', async () => {
  const data = toggleMovieWatched(makeMovieData(), KEY, '2026-08-16T10:00:00Z');
  data.library[KEY].note = 5;
  const root = await mountDetail(data);
  assert.ok(root.innerHTML.includes('Dejar de seguir'));

  root.dispatch('click', { target: toggleFollowButton() });
  const { getState } = await import('../store.js');
  let state = getState();
  assert.equal(state.data.library[KEY].followed, false);
  assert.deepEqual(state.data.library[KEY].watched, ['2026-08-16T10:00:00Z']);
  assert.equal(state.data.library[KEY].note, 5);
  assert.ok(root.innerHTML.includes('Seguir'));

  root.dispatch('click', { target: toggleFollowButton() });
  state = getState();
  assert.ok(!('followed' in state.data.library[KEY]));
  assert.deepEqual(state.data.library[KEY].watched, ['2026-08-16T10:00:00Z']);
  assert.equal(state.data.library[KEY].note, 5);
  assert.ok(root.innerHTML.includes('Dejar de seguir'));
});

test('el Detalle de un título fuera de la biblioteca no muestra el control de seguimiento', async () => {
  const data = emptyData();
  data.catalog[KEY] = {
    id: KEY,
    type: 'series',
    isAnime: false,
    names: { es: 'Serie de prueba', en: null, romaji: null, native: null },
    seasons: [],
  };
  const root = await mountDetail(data);
  assert.ok(!root.innerHTML.includes('toggle-follow'));
  assert.ok(!root.innerHTML.includes('Seguir'));
  assert.ok(!root.innerHTML.includes('Dejar de seguir'));
});
