import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesText } from './biblioteca.js';

function row(entry, key) {
  return { key, catalogEntry: entry };
}

function serie(names) {
  return { id: 'tmdb:tv:1', type: 'series', isAnime: false, names };
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
