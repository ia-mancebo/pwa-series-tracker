import { serialize, DATA_FILE_NAME, parseDataText } from './model.js';
import { createBackupStore } from './backup.js';

const supported = typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
const BACKUP_DIR = 'backups';
const HANDLE_DB = 'tvtime-store';
const HANDLE_STORE = 'handles';
const HANDLE_KEY = 'tvtime-handle';
const MANUAL_KEY = 'tvtime-manual-meta';
const MODE_KEY = 'tvtime-mode-preference';

export function hasFsAccessSupport() {
  return supported;
}

export function getMode() {
  return hasFsAccessSupport() ? 'fsaccess' : 'manual';
}

export function hasOpfs() {
  return typeof navigator !== 'undefined' && !!navigator.storage && typeof navigator.storage.getDirectory === 'function';
}

async function opfsBackupDir(create = false) {
  if (!hasOpfs()) return null;
  const root = await navigator.storage.getDirectory();
  try {
    return await root.getDirectoryHandle(BACKUP_DIR, { create });
  } catch (err) {
    return null;
  }
}

function backupStore() {
  return createBackupStore(opfsBackupDir);
}

export async function pickFile() {
  if (!supported) return { unsupported: true };
  const [handle] = await window.showOpenFilePicker({ multiple: false });
  return handle;
}

export async function readFile(handle) {
  if (!supported) return { unsupported: true };
  try {
    const file = await handle.getFile();
    const text = await file.text();
    return parseDataText(text);
  } catch (err) {
    if (err && (err.name === 'NotAllowedError' || err.name === 'SecurityError' || err.name === 'NotFoundError')) {
      throw err;
    }
    console.error('No se pudo leer el fichero', err);
    return { ok: false, data: null, text: null, error: 'CORRUPT' };
  }
}

export function pickFileViaInput() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    const done = () => input.remove();
    input.addEventListener('change', () => {
      done();
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      file.text().then((text) => resolve({ name: file.name, text }), reject);
    });
    input.addEventListener('cancel', () => {
      done();
      reject(new DOMException('Selección cancelada', 'AbortError'));
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function readText(text) {
  return parseDataText(text);
}

export function canShareFile(text, fileName) {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return true;
  try {
    return navigator.canShare({ files: [new File([text], fileName, { type: 'application/json' })] });
  } catch (err) {
    return false;
  }
}

export function downloadFile(text, fileName) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export async function shareFile(text, fileName) {
  if (canShareFile(text, fileName)) {
    try {
      await navigator.share({
        files: [new File([text], fileName, { type: 'application/json' })],
      });
      return { ok: true, method: 'share' };
    } catch (err) {
      if (err && err.name === 'AbortError') throw err;
    }
  }
  downloadFile(text, fileName);
  return { ok: true, method: 'download' };
}

export async function hasPermission(handle, mode = 'readwrite') {
  if (!supported) return { unsupported: true };
  try {
    if (typeof handle.queryPermission === 'function') return await handle.queryPermission({ mode });
    return 'granted';
  } catch (err) {
    console.error('queryPermission falló', err);
    return 'prompt';
  }
}

export async function requestPermission(handle, mode = 'readwrite') {
  if (!supported) return { unsupported: true };
  try {
    if (typeof handle.requestPermission === 'function') return await handle.requestPermission({ mode });
    return 'granted';
  } catch (err) {
    console.error('requestPermission falló', err);
    return 'denied';
  }
}

export class SaveNeedsGestureError extends Error {
  constructor() {
    super('Se necesita un gesto del usuario para pedir permiso de escritura');
    this.name = 'SaveNeedsGestureError';
  }
}

async function ensureWritePermission(handle) {
  const current = await hasPermission(handle);
  if (current === 'granted') return;
  if (typeof handle.requestPermission !== 'function') {
    throw new Error('Permiso de escritura denegado');
  }
  let granted;
  try {
    granted = await handle.requestPermission({ mode: 'readwrite' });
  } catch (err) {
    console.error('requestPermission falló', err);
    if (err && (err.name === 'SecurityError' || err.name === 'NotAllowedError')) {
      throw new SaveNeedsGestureError();
    }
    throw new Error('Permiso de escritura denegado');
  }
  if (granted !== 'granted') {
    throw new Error('Permiso de escritura denegado');
  }
}

export async function writeFile(handle, data) {
  if (!supported) return { unsupported: true };
  await ensureWritePermission(handle);
  const writable = await handle.createWritable();
  await writable.write(serialize(data));
  await writable.close();
  return { ok: true };
}

export async function saveBackup(data) {
  return backupStore().save(serialize(data));
}

export async function saveRawBackup(text) {
  return backupStore().save(text);
}

export async function listBackups() {
  return backupStore().list();
}

export async function readBackup(name) {
  return backupStore().read(name);
}

export async function saveToOpfs(data) {
  if (!hasOpfs()) {
    return { unsupported: true };
  }
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(DATA_FILE_NAME, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(serialize(data));
    await writable.close();
    return { ok: true };
  } catch (err) {
    console.error('saveToOpfs falló', err);
    return { ok: false };
  }
}

export async function loadFromOpfs() {
  if (!hasOpfs()) {
    return { unsupported: true };
  }
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(DATA_FILE_NAME);
    const file = await fileHandle.getFile();
    const text = await file.text();
    if (!text) return { ok: false, data: null, text: null, error: null };
    return parseDataText(text);
  } catch (err) {
    return { ok: false, data: null, text: null, error: null };
  }
}

function openHandleDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(HANDLE_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(HANDLE_STORE)) {
        request.result.createObjectStore(HANDLE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function storeHandle(handle) {
  if (!supported) return { unsupported: true };
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { ok: true };
  } catch (err) {
    console.error('storeHandle falló', err);
    return { ok: false };
  }
}

export async function clearStoredHandle() {
  if (!supported) return { unsupported: true };
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { ok: true };
  } catch (err) {
    console.error('clearStoredHandle falló', err);
    return { ok: false };
  }
}

export async function loadStoredHandle() {
  if (!supported) return { unsupported: true };
  try {
    const db = await openHandleDb();
    const handle = await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const request = tx.objectStore(HANDLE_STORE).get(HANDLE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { ok: true, handle };
  } catch (err) {
    console.error('loadStoredHandle falló', err);
    return { ok: false, handle: null };
  }
}

export async function storeManualMeta(meta) {
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(meta, MANUAL_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { ok: true };
  } catch (err) {
    console.error('storeManualMeta falló', err);
    return { ok: false };
  }
}

export async function loadManualMeta() {
  try {
    const db = await openHandleDb();
    const meta = await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const request = tx.objectStore(HANDLE_STORE).get(MANUAL_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { ok: true, meta };
  } catch (err) {
    console.error('loadManualMeta falló', err);
    return { ok: false, meta: null };
  }
}

export async function storeModePreference(preference) {
  try {
    const db = await openHandleDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readwrite');
      tx.objectStore(HANDLE_STORE).put(preference, MODE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    return { ok: true };
  } catch (err) {
    console.error('storeModePreference falló', err);
    return { ok: false };
  }
}

export async function loadModePreference() {
  try {
    const db = await openHandleDb();
    const preference = await new Promise((resolve, reject) => {
      const tx = db.transaction(HANDLE_STORE, 'readonly');
      const request = tx.objectStore(HANDLE_STORE).get(MODE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return { ok: true, preference };
  } catch (err) {
    console.error('loadModePreference falló', err);
    return { ok: false, preference: null };
  }
}
