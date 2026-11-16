// RutaLibre — «Mis rutas»: rutas ya preparadas, guardadas en el navegador de este dispositivo
// (localStorage). No salen del móvil ni se suben a ningún sitio. Si se borran los datos del
// navegador, se pierden.

const KEY = 'rl.rutas';

const round = p => [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5];
/** Reduce una polilínea a como mucho `max` puntos (para que quepan muchas rutas). */
export function thin(pts, max = 1500) {
  if (!pts) return pts;
  const step = Math.max(1, Math.ceil(pts.length / max));
  return pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map(round);
}

export function list() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); return true; }
  catch (e) { return false; }   // sin espacio o sin almacenamiento disponible
}

/** Guarda una ruta. Devuelve la entrada guardada o null si no hay espacio. */
export function save(entry) {
  const all = list();
  const e = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), created: new Date().toISOString(), ...entry };
  all.unshift(e);
  return write(all) ? e : null;
}
export function rename(id, name) {
  const all = list(), e = all.find(x => x.id === id);
  if (!e) return false;
  e.name = name; return write(all);
}
export function remove(id) { return write(list().filter(x => x.id !== id)); }
export function get(id) { return list().find(x => x.id === id) || null; }

/** Espacio aproximado ocupado (KB). */
export function usedKB() {
  try { return Math.round((localStorage.getItem(KEY) || '').length / 1024); } catch { return 0; }
}
