import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setState, getState } from '../store.js';
import { followThenOpenDetail, followLabel } from './follow.js';

const KEY = 'tmdb:movie:1';
const DETAIL = { id: 1, type: 'movie', isAnime: false, names: { es: 'Película A' } };

function data() {
  return {
    meta: { version: 1, updatedAt: '2026-08-15T12:00:00Z' },
    catalog: {},
    library: {},
    review: [],
    settings: {},
  };
}

test('followThenOpenDetail: fuera de la biblioteca añade, sigue y navega a Detalle', async () => {
  setState({ data: data(), screen: 'buscar' });
  let fetched = 0;
  await followThenOpenDetail({
    key: KEY,
    back: 'buscar',
    fetchDetail: async () => {
      fetched += 1;
      return DETAIL;
    },
  });
  const state = getState();
  assert.equal(fetched, 1, 'debe buscar el detalle del título fuera de la biblioteca');
  assert.equal(state.screen, 'detalle');
  assert.deepEqual(state.detail, { key: KEY, back: 'buscar' });
  assert.ok(state.data.library[KEY] !== undefined, 'se crea la entrada de biblioteca');
  assert.ok(state.data.catalog[KEY] !== undefined, 'se añaden los metadatos de catálogo');
  assert.ok(!('followed' in state.data.library[KEY]), 'el título queda seguido');
});

test('followThenOpenDetail: seguido navega sin re-buscar ni mutar', async () => {
  const d = data();
  d.library[KEY] = { watched: ['2026-01-01T10:00:00Z'] };
  setState({ data: d, screen: 'buscar' });
  let fetched = 0;
  await followThenOpenDetail({
    key: KEY,
    back: 'buscar',
    fetchDetail: async () => {
      fetched += 1;
      return DETAIL;
    },
  });
  const state = getState();
  assert.equal(fetched, 0, 'no debe re-buscar un título ya seguido');
  assert.equal(state.screen, 'detalle');
  assert.deepEqual(state.detail, { key: KEY, back: 'buscar' });
  assert.deepEqual(state.data.library[KEY], { watched: ['2026-01-01T10:00:00Z'] });
});

test('followThenOpenDetail: no seguido re-sigue conservando historial y navega', async () => {
  const d = data();
  d.library[KEY] = { followed: false, watched: ['2026-01-01T10:00:00Z'] };
  setState({ data: d, screen: 'buscar' });
  await followThenOpenDetail({
    key: KEY,
    back: 'buscar',
    fetchDetail: async () => DETAIL,
  });
  const state = getState();
  const entry = state.data.library[KEY];
  assert.ok(entry !== undefined, 'la entrada se conserva');
  assert.ok(!('followed' in entry), 'el flag followed:false se limpia');
  assert.deepEqual(entry.watched, ['2026-01-01T10:00:00Z'], 'el historial se conserva');
  assert.equal(state.screen, 'detalle');
  assert.deepEqual(state.detail, { key: KEY, back: 'buscar' });
});

test('followThenOpenDetail: sin detalle disponible lanza y no muta', async () => {
  setState({ data: data(), screen: 'buscar' });
  await assert.rejects(
    followThenOpenDetail({
      key: KEY,
      back: 'buscar',
      fetchDetail: async () => null,
    }),
    /no detail/
  );
  assert.ok(getState().data.library[KEY] === undefined, 'no se muta la biblioteca');
});

test('followThenOpenDetail: sin fichero vinculado lanza', async () => {
  setState({ data: null });
  await assert.rejects(
    followThenOpenDetail({ key: KEY, back: 'buscar', fetchDetail: async () => DETAIL }),
    /no data/
  );
});

test('followLabel: etiqueta consciente del estado', () => {
  assert.equal(followLabel(true), 'Ver en Detalle');
  assert.equal(followLabel(false), 'Seguir');
});