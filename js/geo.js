// RutaLibre — lógica de rutas (sin dependencias, sin DOM).
// Coordenadas siempre como [lat, lon].

export const R = 6371000; // radio de la Tierra (m)

/** Distancia en metros entre dos puntos [lat, lon]. */
export function haversine(a, b) {
  const r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Distancia acumulada (m) en cada punto del track. */
export function cumulative(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + haversine(pts[i - 1], pts[i]));
  return cum;
}

/** Punto a `dist` metros de `p` con rumbo `brg` (grados). */
export function destPoint(p, brg, dist) {
  const r = Math.PI / 180, la = p[0] * r, lo = p[1] * r, b = brg * r, d = dist / R;
  const la2 = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(b));
  const lo2 = lo + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(la2));
  return [la2 / r, ((lo2 / r + 540) % 360) - 180];
}

/**
 * Lee un GPX (texto). Usa el track (<trkpt>); si no hay, la ruta (<rtept>).
 * `DOMParserImpl` permite pasar el DOMParser del navegador o de jsdom.
 */
export function parseGpx(text, DOMParserImpl = globalThis.DOMParser) {
  const doc = new DOMParserImpl().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un GPX válido.');
  let nodes = [...doc.getElementsByTagName('trkpt')];
  if (nodes.length < 2) nodes = [...doc.getElementsByTagName('rtept')];
  if (nodes.length < 2) throw new Error('No encuentro ningún track ni ruta en el archivo.');
  const pts = nodes
    .map(n => [parseFloat(n.getAttribute('lat')), parseFloat(n.getAttribute('lon'))])
    .filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const pick = sel => { const e = doc.querySelector(sel); return e && e.textContent.trim(); };
  const name = pick('metadata > name') || pick('trk > name') || pick('rte > name') || '';
  return { name, pts };
}

// ---------- simplificación (Douglas-Peucker) ----------
function projector(pts) {
  const lat0 = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const k = Math.cos(lat0 * Math.PI / 180), r = Math.PI / 180 * R;
  return p => [p[1] * r * k, p[0] * r];
}

function douglasPeucker(xy, eps) {
  const keep = new Uint8Array(xy.length);
  keep[0] = keep[xy.length - 1] = 1;
  const stack = [[0, xy.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop();
    const [ax, ay] = xy[s], [bx, by] = xy[e], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    let dmax = 0, idx = -1;
    for (let i = s + 1; i < e; i++) {
      const [px, py] = xy[i];
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > dmax) { dmax = d; idx = i; }
    }
    if (idx >= 0 && dmax > eps) { keep[idx] = 1; stack.push([s, idx], [idx, e]); }
  }
  const out = [];
  keep.forEach((v, i) => v && out.push(i));
  return out;
}

/** Índices de los ~n vértices que mejor describen la forma del track. */
export function simplifyToN(pts, n) {
  const P = projector(pts), xy = pts.map(P);
  let lo = 1, hi = 50000, best = douglasPeucker(xy, hi);
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2, idx = douglasPeucker(xy, mid);
    if (idx.length > n) lo = mid; else { hi = mid; best = idx; }
  }
  return best;
}

const indexAt = (cum, from, target) => { let j = from; while (j < cum.length - 1 && cum[j] < target) j++; return j; };

/**
 * Elige los puntos de paso de un track y los reparte en enlaces (tramos).
 * opts.mode  'one'  → un solo enlace: los puntos van en la MITAD de cada tramo entre giros
 *                     (clavan la carretera y no caen dentro de pueblos).
 *            'legs' → un punto cada `kmPer` km, repartidos en varios enlaces.
 * opts.per   puntos de paso por enlace (Google Maps app: 9 + destino).
 * Devuelve { total, legs: [{ fromKm, toKm, points: [[lat,lon]...] }] }
 * (la salida no se incluye: Maps arranca desde donde estés).
 */
export function routeFromTrack(pts, { mode = 'one', kmPer = 7, per = 9 } = {}) {
  const cum = cumulative(pts), total = cum[cum.length - 1];
  let sel;
  if (mode === 'one') {
    const idx = simplifyToN(pts, per + 1);           // per tramos entre giros → per puntos medios
    sel = [idx[0]];
    for (let k = 1; k < idx.length; k++) sel.push(indexAt(cum, idx[k - 1], (cum[idx[k - 1]] + cum[idx[k]]) / 2));
    sel.push(idx[idx.length - 1]);
  } else {
    const target = Math.max(2, Math.round(total / 1000 / kmPer) + 1);
    const idx = simplifyToN(pts, target);
    const moved = [idx[0]];
    for (const i of idx.slice(1, -1)) moved.push(indexAt(cum, i, cum[i] + 150)); // 150 m tras el giro
    moved.push(idx[idx.length - 1]);
    // rellenar huecos largos para que el navegador no "ataje"
    const gapMax = kmPer * 2000;
    sel = [moved[0]];
    for (let k = 1; k < moved.length; k++) {
      const a = moved[k - 1], b = moved[k], g = cum[b] - cum[a];
      if (g > gapMax) { const q = Math.ceil(g / gapMax); for (let s = 1; s < q; s++) sel.push(indexAt(cum, a, cum[a] + g * s / q)); }
      sel.push(b);
    }
  }
  // quitar duplicados y puntos pegados (< 300 m)
  const clean = [sel[0]];
  for (const j of sel.slice(1)) if (j > clean[clean.length - 1] && cum[j] - cum[clean[clean.length - 1]] >= 300) clean.push(j);
  clean[clean.length - 1] = pts.length - 1;

  const legs = [];
  for (let k = 1; k < clean.length;) {
    const chunk = clean.slice(k, k + per + 1);
    legs.push({ fromKm: cum[clean[k - 1]] / 1000, toKm: cum[chunk[chunk.length - 1]] / 1000, points: chunk.map(i => pts[i].slice()) });
    k += chunk.length;
  }
  return { total: total / 1000, start: pts[0].slice(), legs };
}

/**
 * Ruta sorpresa: parámetros aleatorios de la vuelta (se generan una vez y se reutilizan
 * al reescalar, para que la forma no cambie al ajustar los km).
 */
export function loopParams(dir = -1, { n = 8, rand = Math.random } = {}) {
  const brg = dir < 0 ? rand() * 360 : dir + (rand() * 40 - 20);
  return {
    brg: (brg + 360) % 360, sense: rand() < 0.5 ? 1 : -1,
    jit: Array.from({ length: n }, () => [rand() * 16 - 8, 0.8 + rand() * 0.4]),
  };
}

/**
 * Puntos de una vuelta circular de ~km kilómetros desde `start` (la salida está en el círculo).
 * Las carreteras son ~35% más largas que la línea recta (ROAD); `scale` corrige ese cálculo
 * cuando ya sabemos los km reales.
 */
export function loopPoints(start, km, P, scale = 1) {
  const ROAD = 1.35, n = P.jit.length;
  const rad = km * 1000 / (2 * Math.PI * ROAD) * scale;
  const center = destPoint(start, P.brg, rad);
  const back = (P.brg + 180) % 360;
  return P.jit.map(([da, fr], i) => destPoint(center, back + P.sense * (360 * (i + 1) / (n + 1)) + da, rad * fr));
}

/** Atajo de la fase 1: vuelta geométrica sin ajustar a carreteras. */
export function surpriseLoop(start, km, dir = -1, { n = 8, rand = Math.random } = {}) {
  const P = loopParams(dir, { n, rand });
  return { brg: P.brg, points: loopPoints(start, km, P) };
}

// ---------- comparar una ruta calculada con el track ----------

/** Índice espacial sencillo (rejilla) de los segmentos de una polilínea, en metros. */
function segmentIndex(shape, proj, cell = 400) {
  const xy = shape.map(proj), grid = new Map();
  const key = (i, j) => i + ',' + j;
  for (let k = 1; k < xy.length; k++) {
    const [ax, ay] = xy[k - 1], [bx, by] = xy[k];
    const i0 = Math.floor(Math.min(ax, bx) / cell), i1 = Math.floor(Math.max(ax, bx) / cell);
    const j0 = Math.floor(Math.min(ay, by) / cell), j1 = Math.floor(Math.max(ay, by) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const kk = key(i, j); if (!grid.has(kk)) grid.set(kk, []); grid.get(kk).push(k);
    }
  }
  return { xy, grid, cell, key };
}
function distToIndex(p, ix) {
  const { xy, grid, cell, key } = ix, [px, py] = p;
  const ci = Math.floor(px / cell), cj = Math.floor(py / cell);
  let best = Infinity;
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const segs = grid.get(key(i, j)); if (!segs) continue;
    for (const k of segs) {
      const [ax, ay] = xy[k - 1], [bx, by] = xy[k], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
    }
  }
  return best; // Infinity = a más de ~1 celda de distancia
}

/**
 * Compara el track con la ruta calculada.
 * - pct: % del track que la ruta recorre (a menos de `tol` m).
 * - gaps: tramos del track que la ruta se salta (ordenados de mayor a menor), con su índice central.
 * - extraKm: km de la ruta que van por fuera del track (rodeos, idas y vueltas).
 */
export function compareRoute(track, shape, { tol = 150, step = 150, minGapKm = 0.4 } = {}) {
  const proj = projector(track), cum = cumulative(track), total = cum[cum.length - 1];
  const rIx = segmentIndex(shape, proj), tIx = segmentIndex(track, proj);
  const samples = [];
  let j = 0;
  for (let d = 0; d <= total; d += step) {
    while (j < track.length - 1 && cum[j] < d) j++;
    samples.push({ i: j, km: cum[j] / 1000, off: distToIndex(proj(track[j]), rIx) > tol });
  }
  const on = samples.filter(s => !s.off).length;
  const gaps = [];
  for (let k = 0; k < samples.length;) {
    if (!samples[k].off) { k++; continue; }
    let e = k; while (e + 1 < samples.length && samples[e + 1].off) e++;
    const lenKm = samples[e].km - samples[k].km + step / 1000;
    if (lenKm >= minGapKm) gaps.push({ fromKm: samples[k].km, toKm: samples[e].km, lenKm, mid: samples[Math.floor((k + e) / 2)].i });
    k = e + 1;
  }
  gaps.sort((a, b) => b.lenKm - a.lenKm);
  const rc = cumulative(shape); let extra = 0;
  for (let k = 1; k < shape.length; k++) if (distToIndex(proj(shape[k]), tIx) > tol) extra += rc[k] - rc[k - 1];
  return { pct: samples.length ? on / samples.length : 1, gaps, extraKm: extra / 1000 };
}

/**
 * Detecta "pinchos": paradas a las que la ruta llega y vuelve por el mismo camino.
 * legs: tramos de la ruta (uno por parada). Devuelve, para cada parada intermedia,
 * los km de ida y vuelta repetidos (0 = sin pincho).
 */
export function spurLengths(legs, { tol = 30, step = 50, maxKm = 8 } = {}) {
  const out = [];
  for (let w = 1; w < legs.length; w++) {
    const before = legs[w - 1].shape.slice().reverse(), after = legs[w].shape;
    const cb = cumulative(before), ca = cumulative(after);
    let d = step, last = 0;
    const at = (shape, cum, dist) => { let k = 0; while (k < cum.length - 1 && cum[k] < dist) k++; return shape[k]; };
    while (d <= maxKm * 1000 && d <= cb[cb.length - 1] && d <= ca[ca.length - 1]) {
      if (haversine(at(before, cb, d), at(after, ca, d)) > tol) break;
      last = d; d += step;
    }
    out.push(last / 1000);
  }
  return out;
}

/** Punto situado `km` antes del final de una polilínea (recorriéndola hacia atrás). */
export function pointBackAlong(shape, km) {
  let acc = 0;
  for (let k = shape.length - 1; k > 0; k--) {
    acc += haversine(shape[k], shape[k - 1]);
    if (acc >= km * 1000) return shape[k - 1].slice();
  }
  return shape[0].slice();
}

/** Distancia en línea recta (km) de una lista de puntos, cerrando en el último. */
export function straightKm(list) {
  let d = 0;
  for (let i = 1; i < list.length; i++) d += haversine(list[i - 1], list[i]);
  return d / 1000;
}

export const compass = brg => ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(brg / 45) % 8];

/**
 * Enlace de Google Maps que arranca la navegación desde tu ubicación.
 * stops: lista de [lat,lon] o de textos ("Gelida, Barcelona"); el último es el destino.
 */
export function mapsUrl(stops, { avoidHighways = false, avoidTolls = false } = {}) {
  const fmt = s => typeof s === 'string' ? s : `${s[0].toFixed(5)},${s[1].toFixed(5)}`;
  const dest = stops[stops.length - 1], way = stops.slice(0, -1);
  let u = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate&destination=' + encodeURIComponent(fmt(dest));
  if (way.length) u += '&waypoints=' + encodeURIComponent(way.map(fmt).join('|'));
  const av = [avoidHighways && 'highways', avoidTolls && 'tolls'].filter(Boolean).join(',');
  if (av) u += '&avoid=' + encodeURIComponent(av);
  return u;
}

const esc = t => String(t).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const head = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="RutaLibre" xmlns="http://www.topografix.com/GPX/1/1">\n';

/** GPX con puntos sueltos numerados (para importar como favoritos). */
export function gpxWaypoints(list, prefix = 'Ruta', labels = []) {
  let x = head;
  list.forEach((p, k) => {
    const n = `${prefix} ${String(k).padStart(2, '0')}${labels[k] ? ' ' + labels[k] : ''}`;
    x += `  <wpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"><name>${esc(n)}</name></wpt>\n`;
  });
  return x + '</gpx>\n';
}

/** GPX con un track (para StreetCross u otros navegadores que solo leen tracks). */
export function gpxTrack(pts, name = 'Ruta') {
  let x = head + `  <trk><name>${esc(name)}</name><trkseg>\n`;
  for (const p of pts) x += `    <trkpt lat="${p[0].toFixed(6)}" lon="${p[1].toFixed(6)}"/>\n`;
  return x + '  </trkseg></trk>\n</gpx>\n';
}

/** Lee "41.5631, 2.0089" (o con espacio) → [lat, lon] o null. */
export function parseCoords(t) {
  const m = String(t || '').match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const p = [+m[1], +m[2]];
  return Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180 ? p : null;
}
