import { getState, setState } from './store.js';

let inlineBack = null;
let pushedCount = 0;

function hasHistory() {
  return (
    typeof window !== 'undefined' &&
    typeof window.history !== 'undefined' &&
    typeof window.history.pushState === 'function'
  );
}

export function pushHistory() {
  if (!hasHistory()) return;
  pushedCount += 1;
  try {
    window.history.pushState(null, '');
  } catch {
    pushedCount -= 1;
  }
}

function replaceHistory() {
  if (!hasHistory()) return;
  try {
    window.history.replaceState(null, '');
  } catch {
    // sin history: nada que reemplazar
  }
}

export function setInlineBack(handler) {
  inlineBack = handler;
}

export function clearInlineBack() {
  inlineBack = null;
}

export function openDetail({ key, back }) {
  const replacingInline = inlineBack !== null;
  clearInlineBack();
  if (replacingInline) replaceHistory();
  else pushHistory();
  setState({ screen: 'detalle', detail: { key, back: back || 'biblioteca' } });
}

export function handleBack() {
  const state = getState();
  if (state.screen === 'detalle' && state.detail && state.detail.back) {
    clearInlineBack();
    setState({ screen: state.detail.back || 'biblioteca' });
    return true;
  }
  if (inlineBack) {
    const handler = inlineBack;
    inlineBack = null;
    handler();
    return true;
  }
  return false;
}

export function goBack() {
  if (pushedCount > 0 && hasHistory()) {
    try {
      window.history.back();
      return;
    } catch {
      // si falla, seguimos con el back directo
    }
  }
  handleBack();
}

export function installBackNavigation() {
  if (!hasHistory()) return;
  window.addEventListener('popstate', () => {
    if (pushedCount > 0) {
      pushedCount -= 1;
      handleBack();
    }
  });
}

export function onScreenChange(screen) {
  inlineBack = null;
  if (screen === 'detalle') return;
  const hadPending = pushedCount > 0;
  pushedCount = 0;
  if (hadPending && hasHistory()) {
    try {
      window.history.back();
    } catch {
      // sin history: no hay entrada propia que consumir
    }
  }
}
