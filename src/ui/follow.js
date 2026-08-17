import { getState, setState } from '../store.js';
import { FOLLOW_ACTION, addToLibrary, follow, resolveFollowAction } from '../model.js';

const FOLLOW_MUTATORS = {
  [FOLLOW_ACTION.ADD]: addToLibrary,
  [FOLLOW_ACTION.REFOLLOW]: follow,
};

export function followLabel(followed) {
  return followed ? 'Ver en Detalle' : 'Seguir';
}

export async function followThenOpenDetail({ key, fetchDetail, back }) {
  const state = getState();
  if (!state.data) throw new Error('no data');
  const action = resolveFollowAction(state.data, key);
  if (action !== FOLLOW_ACTION.NAVIGATE) {
    const detail = await fetchDetail();
    if (!detail) throw new Error('no detail');
    const next = FOLLOW_MUTATORS[action](state.data, { ...detail, id: key });
    setState({ data: next });
  }
  setState({ screen: 'detalle', detail: { key, back } });
}