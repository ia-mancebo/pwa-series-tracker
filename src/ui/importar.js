import { getState, setState, subscribe } from '../store.js';
import { importAll } from '../import.js';

let activeRoot = null;

function esc(text) {
  const div = document.createElement('div');
  div.textContent = text == null ? '' : String(text);
  return div.innerHTML;
}

function apiKey() {
  const data = getState().data;
  return data && data.settings && typeof data.settings.tmdbApiKey === 'string' ? data.settings.tmdbApiKey : null;
}

function renderStatus(root) {
  const status = getState().importStatus;
  const estado = root.querySelector('[data-role="estado"]');
  if (!estado) return;
  estado.textContent = status ? status.text || '' : '';
  const chooseBtn = root.querySelector('[data-role="elegir"]');
  if (chooseBtn) chooseBtn.disabled = Boolean(status && status.running);
  const irRevision = root.querySelector('[data-role="ir-revision"]');
  if (irRevision) irRevision.hidden = !status || status.phase !== 'done';
}

export function mount(root, deps = {}) {
  root.innerHTML = `
    <div class="imp">
      <p class="aj-text">Importación única de los CSVs de TVTime, con emparejamiento contra TMDB y AniList y cola de revisión para los dudosos. Elige los ficheros:
        tracking-prod-records-v2.csv (series), tracking-prod-records.csv (películas),
        ratings-3-prod-episode_votes.csv y ratings-live-votes.csv (votos) y user_tv_show_data.csv (cross-check).</p>
      <div class="aj-keyrow">
        <button type="button" class="aj-btn" data-role="elegir">Elegir CSVs</button>
        <button type="button" class="aj-btn ghost" data-role="ir-revision" hidden>Ir a la cola de revisión</button>
      </div>
      <input type="file" multiple hidden data-role="csv-input">
      <div class="mini" data-role="estado"></div>
    </div>`;

  const chooseBtn = root.querySelector('[data-role="elegir"]');
  const input = root.querySelector('[data-role="csv-input"]');
  const estado = root.querySelector('[data-role="estado"]');
  const irRevision = root.querySelector('[data-role="ir-revision"]');
  activeRoot = root;

  const runImport = deps.runImport || importAll;
  const goToRevision = deps.goToRevision || (() => {});
  const setStatus = (patch) => setState({ importStatus: { ...(getState().importStatus || {}), ...patch } });

  renderStatus(root);

  chooseBtn.addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const files = [...(input.files || [])];
    input.value = '';
    if (!files.length) return;
    const state = getState();
    if (!state.data) {
      estado.textContent = 'Vincula tu fichero primero: la importación escribe en tu fichero único.';
      return;
    }
    if (getState().importStatus && getState().importStatus.running) return;
    chooseBtn.disabled = true;
    irRevision.hidden = true;
    setStatus({ running: true, phase: 'read', text: 'Leyendo CSVs…' });
    try {
      const texts = await Promise.all(
        files.map(async (file) => ({ name: file.name, text: await file.text() }))
      );
      const result = await runImport(state.data, texts, {
        tmdbApiKey: apiKey(),
        onProgress: ({ pct }) => {
          setStatus({ running: true, phase: 'match', text: `Importando… (${Math.round(pct * 100)}%)` });
        },
      });
      setState({ data: result.data });
      setStatus({
        running: false,
        phase: 'done',
        text: `Importación terminada: ${result.summary.matched} emparejados, ${result.summary.queued} en la cola de revisión.`,
      });
    } catch (err) {
      setStatus({
        running: false,
        phase: 'error',
        text: err && err.message ? `Error: ${esc(err.message)}` : 'Error inesperado.',
      });
    } finally {
      chooseBtn.disabled = false;
    }
  });

  irRevision.addEventListener('click', goToRevision);

  return root;
}

subscribe(() => {
  if (!activeRoot || !activeRoot.isConnected) return;
  renderStatus(activeRoot);
});
