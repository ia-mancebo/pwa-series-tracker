import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesText, rowHtml, tableRowHtml } from './biblioteca.js';

class FakeElement {
  constructor() {
    this._html = '';
    this._text = '';
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

const NOW = '2026-08-10T18:30:00Z';

function row(entry, key) {
  return { key, catalogEntry: entry };
}

function serie(names) {
  return { id: 'tmdb:tv:1', type: 'series', isAnime: false, names };
}

function serieConEpisodios() {
  return {
    id: 'tmdb:tv:1',
    type: 'series',
    isAnime: false,
    names: { es: 'Serie de prueba' },
    seasons: [
      { n: 1, episodes: [
        { n: 1, name: 'Cap 1', airDate: '2020-03-01' },
        { n: 2, name: 'Cap 2', airDate: '2020-04-01' },
      ] },
    ],
  };
}

function serieAlDia() {
  return {
    key: 'tmdb:tv:1',
    libraryEntry: {
      episodes: {
        '1x1': { watched: ['2025-01-01T00:00:00Z'] },
        '1x2': { watched: ['2025-01-02T00:00:00Z'] },
      },
    },
    catalogEntry: serieConEpisodios(),
    state: 'visto',
  };
}

test('coincide con el nombre principal, sin distinguir mayúsculas ni tildes', () => {
  const r = row(serie({ es: 'El Juego del Calamar', en: 'Squid Game' }), 'tmdb:tv:1');
  assert.equal(matchesText(r, 'calamar'), true);
  assert.equal(matchesText(r, 'EL JUEGO'), true);
  assert.equal(matchesText(r, 'juego calamar'), true);
  assert.equal(matchesText(r, 'piratas'), false);
});

test('coincide con los nombres alternativos y con la clave canónica', () => {
  const r = row(serie({ es: 'Sakamoto Days', en: null, romaji: 'Sakamoto Deizu', native: 'サカモト' }), 'tmdb:tv:77');
  assert.equal(matchesText(r, 'deizu'), true);
  assert.equal(matchesText(r, 'tmdb:tv:77'), true);
});

test('la consulta vacía deja pasar todo', () => {
  const r = row(serie({ es: 'Coco' }), 'tmdb:movie:1');
  assert.equal(matchesText(r, ''), true);
  assert.equal(matchesText(r, '   '), true);
});

test('sin entrada de catálogo cae al nombre vacío y a la clave', () => {
  assert.equal(matchesText({ key: 'tmdb:movie:9', catalogEntry: null }, 'tmdb:movie:9'), true);
  assert.equal(matchesText({ key: 'tmdb:movie:9', catalogEntry: null }, 'nada'), false);
});

test('rowHtml muestra el siguiente capítulo pendiente de la serie', () => {
  const html = rowHtml({ key: 'tmdb:tv:1', libraryEntry: { episodes: {} }, catalogEntry: serieConEpisodios(), state: 'paraver' }, NOW);
  assert.ok(html.includes('Siguiente: 1x1 · Cap 1'));
  assert.ok(html.includes('lib-next'));
});

test('rowHtml con capítulo sin nombre muestra solo el SxE', () => {
  const entry = serieConEpisodios();
  entry.seasons[0].episodes[0].name = null;
  const html = rowHtml({ key: 'tmdb:tv:1', libraryEntry: { episodes: {} }, catalogEntry: entry, state: 'paraver' }, NOW);
  assert.ok(html.includes('Siguiente: 1x1'));
  assert.ok(!html.includes('Siguiente: 1x1 ·'));
});

test('rowHtml de serie al día no muestra la línea', () => {
  const html = rowHtml(serieAlDia(), NOW);
  assert.ok(!html.includes('Siguiente:'));
});

test('rowHtml de película no muestra la línea', () => {
  const movie = { id: 'tmdb:movie:1', type: 'movie', isAnime: false, names: { es: 'Coco' } };
  const html = rowHtml({ key: 'tmdb:movie:1', libraryEntry: {}, catalogEntry: movie, state: 'paraver' }, NOW);
  assert.ok(!html.includes('Siguiente:'));
});

test('tableRowHtml muestra el siguiente capítulo pendiente de la serie', () => {
  const html = tableRowHtml({ key: 'tmdb:tv:1', libraryEntry: { episodes: {} }, catalogEntry: serieConEpisodios(), state: 'paraver' }, NOW);
  assert.ok(html.includes('Siguiente: 1x1 · Cap 1'));
  assert.ok(html.includes('lib-title-next'));
});

test('tableRowHtml de serie al día no muestra la línea', () => {
  const html = tableRowHtml(serieAlDia(), NOW);
  assert.ok(!html.includes('Siguiente:'));
});

test('tableRowHtml de película no muestra la línea', () => {
  const movie = { id: 'tmdb:movie:1', type: 'movie', isAnime: false, names: { es: 'Coco' } };
  const html = tableRowHtml({ key: 'tmdb:movie:1', libraryEntry: {}, catalogEntry: movie, state: 'paraver' }, NOW);
  assert.ok(!html.includes('Siguiente:'));
});
