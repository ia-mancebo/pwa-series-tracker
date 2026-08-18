import { test } from 'node:test';
import assert from 'node:assert/strict';

function makeHistory(firePopstate) {
  const entries = [{}];
  let index = 0;
  const history = {
    pushState(state, _title, url) {
      entries.splice(index + 1);
      entries.push({ state, url });
      index = entries.length - 1;
    },
    replaceState(state, _title, url) {
      if (index >= 0) entries[index] = { state, url };
      else {
        entries.push({ state, url });
        index = entries.length - 1;
      }
    },
    back() {
      if (index > 0) {
        index -= 1;
        firePopstate();
      }
    },
    get length() {
      return entries.length;
    },
    get index() {
      return index;
    },
  };
  return history;
}

function makeWindow() {
  const listeners = {};
  const win = {
    history: null,
    addEventListener(type, fn) {
      (listeners[type] ||= []).push(fn);
    },
    removeEventListener(type, fn) {
      if (!listeners[type]) return;
      listeners[type] = listeners[type].filter((f) => f !== fn);
    },
    dispatch(type, event) {
      for (const fn of [...(listeners[type] || [])]) fn(event);
    },
  };
  win.history = makeHistory(() => win.dispatch('popstate', {}));
  return win;
}

let win;
let moduleSeq = 0;

function setWindow(value) {
  win = value;
  Object.defineProperty(globalThis, 'window', { value, configurable: true });
}

async function setup({ install = true } = {}) {
  const nav = await import(`./nav.js?test=${++moduleSeq}`);
  const store = await import('./store.js');
  store.setState({ screen: 'biblioteca', data: null, detail: null });
  setWindow(makeWindow());
  if (install) nav.installBackNavigation();
  return { nav, store };
}

test('popstate estando en Detalle vuelve a la pantalla anterior', async () => {
  const { nav, store } = await setup();
  nav.openDetail({ key: 'tmdb:tv:1', back: 'biblioteca' });
  assert.equal(store.getState().screen, 'detalle');

  win.dispatch('popstate', {});

  assert.equal(store.getState().screen, 'biblioteca');
});

test('goBack consume la entrada de historial y vuelve desde Detalle', async () => {
  const { nav, store } = await setup();
  const before = win.history.index;
  nav.openDetail({ key: 'tmdb:tv:1', back: 'biblioteca' });
  assert.equal(win.history.index, before + 1, 'abrir Detalle empuja una entrada');

  nav.goBack();

  assert.equal(store.getState().screen, 'biblioteca');
  assert.equal(win.history.index, before, 'goBack consume la entrada empujada');
});

test('el back de un detalle embebido ejecuta y consume su propia acción', async () => {
  const { nav, store } = await setup();
  store.setState({ screen: 'buscar' });
  let closed = 0;
  nav.pushHistory();
  nav.setInlineBack(() => {
    closed += 1;
  });

  win.dispatch('popstate', {});

  assert.equal(closed, 1, 'el back ejecuta el resolver del detalle embebido');

  win.dispatch('popstate', {});
  assert.equal(closed, 1, 'sin entradas propias el back no vuelve a actuar');
});

test('abrir Detalle desde un detalle embebido reemplaza la entrada, no apila', async () => {
  const { nav, store } = await setup();
  store.setState({ screen: 'buscar' });
  nav.pushHistory();
  nav.setInlineBack(() => {});
  const before = win.history.index;

  nav.openDetail({ key: 'tmdb:movie:1', back: 'buscar' });

  assert.equal(win.history.index, before, 'el Detalle reemplaza la entrada embebida');
  assert.equal(store.getState().screen, 'detalle');
  assert.deepEqual(store.getState().detail, { key: 'tmdb:movie:1', back: 'buscar' });

  win.dispatch('popstate', {});
  assert.equal(store.getState().screen, 'buscar');

  win.dispatch('popstate', {});
  assert.equal(store.getState().screen, 'buscar', 'no queda ninguna entrada propia pendiente');
});

test('el back en una pantalla raíz sin detalles no cambia el estado', async () => {
  const { store } = await setup();
  store.setState({ screen: 'biblioteca' });

  win.dispatch('popstate', {});

  assert.equal(store.getState().screen, 'biblioteca');
});

test('handleBack sin nada abierto devuelve false y no cambia nada', async () => {
  const { nav, store } = await setup();
  store.setState({ screen: 'buscar' });
  assert.equal(nav.handleBack(), false);
  assert.equal(store.getState().screen, 'buscar');
});

test('cambiar a una pantalla raíz desde Detalle consume la entrada pendiente', async () => {
  const { nav, store } = await setup();
  const before = win.history.index;
  nav.openDetail({ key: 'tmdb:tv:1', back: 'biblioteca' });
  assert.equal(win.history.index, before + 1);

  store.setState({ screen: 'novedades' });
  nav.onScreenChange('novedades');

  assert.equal(win.history.index, before, 'la entrada pendiente se consume al cambiar de pantalla');
  win.dispatch('popstate', {});
  assert.equal(store.getState().screen, 'novedades', 'un atrás posterior no toca el estado en pantalla raíz');
});

test('cambiar a Detalle no consume la entrada pendiente', async () => {
  const { nav, store } = await setup();
  nav.openDetail({ key: 'tmdb:tv:1', back: 'biblioteca' });
  const indexAfterOpen = win.history.index;

  nav.onScreenChange('detalle');

  assert.equal(win.history.index, indexAfterOpen, 'entrar en Detalle no consume la entrada');
  assert.equal(store.getState().screen, 'detalle');
});

test('cambiar de pantalla desde un detalle embebido limpia el resolver y consume la entrada', async () => {
  const { nav, store } = await setup();
  store.setState({ screen: 'buscar' });
  const rootIndex = win.history.index;
  let closed = 0;
  nav.pushHistory();
  nav.setInlineBack(() => {
    closed += 1;
  });

  store.setState({ screen: 'novedades' });
  nav.onScreenChange('novedades');

  win.dispatch('popstate', {});
  assert.equal(closed, 0, 'el resolver stale no se ejecuta tras cambiar de pantalla');
  assert.equal(store.getState().screen, 'novedades');
  assert.equal(win.history.index, rootIndex, 'la entrada del detalle embebido se consume');
});

test('goBack sin History API cae al back directo del estado', async () => {
  const nav = await import(`./nav.js?test=${++moduleSeq}`);
  const store = await import('./store.js');
  store.setState({ screen: 'detalle', detail: { key: 'k', back: 'novedades' }, data: null });
  setWindow({ addEventListener: () => {} });

  nav.goBack();

  assert.equal(store.getState().screen, 'novedades');
});
