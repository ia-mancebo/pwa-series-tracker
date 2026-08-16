export function resolveMode(supported, preference = 'auto') {
  if (preference === 'manual') return 'manual';
  return supported ? 'fsaccess' : 'manual';
}

export function readModePreference(loaded) {
  return loaded && loaded.preference === 'manual' ? 'manual' : 'auto';
}

export function shouldResetDirtyAtBoot(mode) {
  return mode !== 'manual';
}
