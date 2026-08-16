import { getState, setState } from '../store.js';
import { listBackups, readBackup, hasOpfs } from '../fs.js';
import { timeLabel } from '../time.js';

function explain(error) {
  if (error === 'CORRUPT') return 'El fichero no es un JSON válido y no puede leerse.';
  if (error === 'VERSION') return 'El fichero pertenece a una versión más nueva de la app.';
  return 'El fichero no cumple el esquema esperado.';
}

export function mount(root, deps = {}) {
  const { openFlow, setSaveStatus } = deps;
  const { recoveryHandle, recoveryError } = getState();
  const canBackup = hasOpfs();

  root.innerHTML = `
    <section class="placeholder recovery">
      <h3 class="placeholder-title">Recuperación</h3>
      <p class="placeholder-text">${explain(recoveryError)} El fichero queda intacto en disco.</p>
      <div class="recovery-actions">
        <button type="button" class="recovery-btn" id="rec-init">Inicializar fichero</button>
        <button type="button" class="recovery-btn" id="rec-repick">Elegir otro fichero</button>
        <button type="button" class="recovery-btn" id="rec-restore">Restaurar último backup</button>
      </div>
      <span class="mini" id="rec-note">${canBackup ? '' : 'Este navegador no permite copias de seguridad.'}</span>
    </section>`;

  const initBtn = root.querySelector('#rec-init');
  const repickBtn = root.querySelector('#rec-repick');
  const restoreBtn = root.querySelector('#rec-restore');
  const note = root.querySelector('#rec-note');

  if (!canBackup) restoreBtn.disabled = true;

  restoreBtn.addEventListener('click', async () => {
    restoreBtn.disabled = true;
    note.textContent = 'Buscando copias de seguridad…';
    try {
      const listed = await listBackups();
      if (!listed || !listed.ok || listed.backups.length === 0) {
        note.textContent = 'No hay copias de seguridad.';
        restoreBtn.disabled = false;
        return;
      }
      const res = await readBackup(listed.backups[0]);
      if (res.ok) {
        setState({ screen: 'biblioteca', data: res.data });
        setSaveStatus(`Guardado ✓ ${timeLabel(res.data.meta.updatedAt)}`, 'sync');
      } else if (res.error === 'MISSING') {
        note.textContent = 'La copia de seguridad más reciente ya no existe.';
        restoreBtn.disabled = false;
      } else {
        note.textContent = 'El backup más reciente tampoco puede leerse.';
        restoreBtn.disabled = false;
      }
    } catch (err) {
      note.textContent = 'No se pudo restaurar la copia de seguridad.';
      restoreBtn.disabled = false;
    }
  });

  initBtn.addEventListener('click', async () => {
    initBtn.disabled = true;
    note.textContent = 'Inicializando el fichero…';
    try {
      await openFlow.initialize(recoveryHandle);
    } catch (err) {
      note.textContent = err && err.message ? `No se pudo inicializar: ${err.message}` : 'No se pudo inicializar el fichero.';
      initBtn.disabled = false;
    }
  });

  repickBtn.addEventListener('click', async () => {
    try {
      await openFlow.openFile();
    } catch (err) {
      note.textContent = 'No se pudo abrir el selector de ficheros.';
    }
  });

  return root;
}