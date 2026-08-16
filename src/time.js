export function timeLabel(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
}