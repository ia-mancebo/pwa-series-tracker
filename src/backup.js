import { parseDataText } from './model.js';

const BACKUP_PATTERN = /^tvtime-data\.(\d{8}-\d{6})(_(\d+))?\.bak$/;
const MAX_BACKUPS = 5;

function defaultStamp(now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

async function collectBackupNames(dir) {
  const backups = [];
  for await (const [name] of dir.entries()) {
    if (BACKUP_PATTERN.test(name)) backups.push(name);
  }
  backups.sort().reverse();
  return backups;
}

async function nextBackupName(dir, stampName) {
  let max = -1;
  for await (const [name] of dir.entries()) {
    const match = BACKUP_PATTERN.exec(name);
    if (!match || match[1] !== stampName) continue;
    const n = match[3] ? parseInt(match[3], 10) : 0;
    if (n > max) max = n;
  }
  return max < 0 ? `tvtime-data.${stampName}.bak` : `tvtime-data.${stampName}_${max + 1}.bak`;
}

export function createBackupStore(getDir, options = {}) {
  const stamp = options.stamp || defaultStamp;

  async function rotate(dir) {
    const backups = await collectBackupNames(dir);
    for (const stale of backups.slice(MAX_BACKUPS)) {
      await dir.removeEntry(stale).catch(() => {});
    }
  }

  async function save(text) {
    try {
      const dir = await getDir(true);
      if (!dir) return { ok: false, skipped: true };
      const stampName = stamp();
      const name = await nextBackupName(dir, stampName);
      const fileHandle = await dir.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();
      await rotate(dir);
      return { ok: true, name };
    } catch (err) {
      console.error('No se pudo guardar la copia de seguridad', err);
      return { ok: false };
    }
  }

  async function list() {
    try {
      const dir = await getDir(false);
      if (!dir) return { ok: false, backups: [] };
      const backups = await collectBackupNames(dir);
      return { ok: true, backups };
    } catch (err) {
      console.error('listar copias de seguridad falló', err);
      return { ok: false, backups: [] };
    }
  }

  async function read(name) {
    try {
      const dir = await getDir(false);
      if (!dir) return { ok: false, data: null, text: null, error: null };
      const fileHandle = await dir.getFileHandle(name);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return parseDataText(text);
    } catch (err) {
      if (err && (err.name === 'NotFoundError' || err.message === 'NotFoundError')) {
        return { ok: false, data: null, text: null, error: 'MISSING' };
      }
      console.error('No se pudo leer el backup', err);
      return { ok: false, data: null, text: null, error: 'CORRUPT' };
    }
  }

  return { save, list, read };
}
