import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyData, toggleEpisodeWatched } from '../model.js';

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

async function mountDetail(data) {
  const { setState } = await import('../store.js');
  const { mount } = await import('./detalle.js');
  const root = new FakeElement();
  setState({ data, detailKey: KEY, screen: 'detalle' });
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
