const state = {
  screen: 'biblioteca',
  detail: null,
  saveStatus: { state: 'idle', lastSavedAt: null, dirty: false },
  importStatus: null,
};

const listeners = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  for (const listener of listeners) listener(state);
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
