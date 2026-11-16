// RutaLibre — planificador de la fase 2.
// Usa el motor de rutas (Valhalla) para que los puntos caigan en carreteras reales,
// medir los km de verdad y comprobar que la ruta sigue a tu track.
import * as G from './geo.js';
import * as C from './curves.js';

// Ida y vuelta repetida (km) a partir de la cual una parada se considera "pincho".
const SPUR_KM = 0.1;        // ruta sorpresa
const SPUR_TRACK_KM = 0.3;  // GPX: el track original manda; solo se corrigen los desvíos claros

/**
 * Ruta sorpresa ajustada a carreteras.
 * - Cada punto se lleva a la carretera más cercana de clase "terciaria" o superior
 *   (nada de pistas, caminos ni calles).
 * - Se quitan las paradas que obligan a ir y volver por el mismo sitio.
 * - Se reescala la vuelta hasta que los km reales se acercan a los pedidos.
 */
export async function planSurprise(start, km, dir, opts, router, progress = () => {}) {
  const P = G.loopParams(dir);
  let scale = 1, best = null;
  for (let it = 0; it < 3; it++) {
    progress(it === 0 ? 'Buscando carreteras…' : 'Ajustando los kilómetros…');
    const raw = G.loopPoints(start, km, P, scale);
    let pts = (await router.snap(raw, { minClass: 'tertiary' }, opts)).filter(Boolean);
    pts = dedupe(pts, 1000);
    if (!pts.length) throw new Error('No encuentro carreteras alrededor. Prueba otra salida.');
    let r = await router.route([start, ...pts, start], opts);
    // pinchos: mover la parada al punto de la carretera por la que ya pasa la ruta,
    // justo antes de donde empieza el desvío; si aun así sigue, quitarla.
    r = await fixSpurs(start, pts, r, opts, router, progress);
    pts = r.points;
    const cand = { start, points: pts, route: r, km: r.km, brg: P.brg, target: km };
    if (!best || Math.abs(cand.km - km) < Math.abs(best.km - km)) best = cand;
    if (Math.abs(r.km - km) / km < 0.12) break;
    scale *= Math.max(0.4, Math.min(2.5, km / r.km));
  }
  best.spurs = G.spurLengths(best.route.legs);
  return best;
}

async function fixSpurs(start, pts, r, opts, router, progress) {
  for (let pass = 0; pass < 3; pass++) {
    const spurs = G.spurLengths(r.legs);
    const bad = spurs.map((s, i) => s > SPUR_KM ? i : -1).filter(i => i >= 0);
    if (!bad.length) break;
    progress('Quitando desvíos sin salida…');
    if (pass < 2) bad.forEach(i => { pts[i] = G.pointBackAlong(r.legs[i].shape, spurs[i] + 0.2); });
    else if (pts.length - bad.length >= 3) pts = pts.filter((_, i) => !bad.includes(i));
    else break;
    r = await router.route([start, ...pts, start], opts);
  }
  return { ...r, points: pts };
}
export { fixSpurs };

/** Recalcula la ruta sorpresa tras arrastrar un punto. */
export async function rerouteSurprise(plan, opts, router) {
  const r = await router.route([plan.start, ...plan.points, plan.start], opts);
  return { ...plan, route: r, km: r.km, spurs: G.spurLengths(r.legs) };
}

/**
 * Ruta desde un track (GPX). Empieza con la mitad de los puntos y va añadiendo uno donde la ruta
 * calculada se separa más del track, hasta usar los 10 de Google Maps. Con todos usados, sigue
 * cambiando los puntos que sobran por otros donde hacen falta. Se queda con el mejor resultado.
 *   maxLinks: enlaces de Google Maps que aceptas (cada uno: `per` paradas + destino).
 */
export async function planTrack(track, { maxLinks = 1, per = 9, target = 0.995, ...opts }, router, progress = () => {}) {
  const cum = G.cumulative(track), totalKm = cum[cum.length - 1] / 1000;
  const end = track.length - 1;
  const budget = maxLinks * (per + 1) - 1;            // puntos intermedios posibles (sin contar el destino final)
  const n0 = Math.max(2, Math.min(budget, Math.ceil(budget / 2)));   // se empieza con la mitad de los puntos
  let idx = initialMidpoints(track, cum, n0);
  // Cada punto se ajusta a la carretera dentro de la propia petición de ruta
  // (nada de caminos de servicio ni parkings: clase "residential" o superior).
  const attempt = (ix, strict = true) => router.route([track[0], ...ix.map(i => track[i]), track[end]], opts,
    strict ? { minClass: 'residential', radius: 60 } : {});
  const banned = [];                                      // km de puntos que no llevan a ninguna carretera útil
  // Si algún punto cae donde el motor no encuentra carretera (o queda aislado), se prueba sin
  // la restricción de clase de vía y, si aun así falla, quitando los puntos de uno en uno.
  async function route() {
    try { return await attempt(idx); } catch (e) { if (!retryable(e)) throw e; }
    try { return await attempt(idx, false); } catch (e) { if (!retryable(e)) throw e; }
    for (let k = idx.length - 1; k >= 0; k--) {
      const ix = idx.filter((_, i) => i !== k);
      try { const r = await attempt(ix); banned.push(cum[idx[k]]); idx = ix; return r; } catch (e) { if (!retryable(e)) throw e; }
    }
    throw new Error('El motor de rutas no encuentra carreteras para este track.');
  }

  let best = null;
  const tried = new Map();                                // km de hueco → veces probado
  const keepers = new Set();                              // puntos que ya se vio que no sobran
  let swaps = 0;
  const kmOf = i => cum[i] / 1000;
  // Un punto nuevo va en la mitad del tramo donde la ruta se separa del track: "clava" esa carretera.
  // (Se probó ponerlo justo tras el cruce de separación y daba peores resultados.)
  const fixPoint = g => g.mid;
  const maxIt = budget + 12;
  for (let it = 0; it < maxIt; it++) {
    progress(`Comprobando la ruta… (${idx.length} puntos)`);
    let r;
    try { r = await route(); } catch (e) { if (best) break; throw e; }
    const cmp = G.compareRoute(track, r.shape);
    progress(`Coincidencia ${Math.round(cmp.pct * 100)}% (${idx.length} puntos)`);

    // pinchos: mover esa parada 400 m más adelante por el track (o quitarla si choca con otra)
    const spurs = G.spurLengths(r.legs);
    const bad = spurs.map((s, k) => s > SPUR_TRACK_KM ? k : -1).filter(k => k >= 0 && k < idx.length);
    if (bad.length) {
      bad.forEach(k => { idx[k] = shiftAlong(cum, idx[k], 400); });
      idx = uniqueSorted(idx);
      continue;
    }
    if (!best || cmp.pct > best.cmp.pct + 1e-9) best = { idx: idx.slice(), r, cmp };
    if (best.cmp.pct >= target) break;
    const gaps = best.cmp.gaps, base = best.idx;
    let add = -1;
    for (const g of gaps) {
      const key = Math.round(g.fromKm * 2), n = tried.get(key) || 0;
      if (n >= 2 || banned.some(m => Math.abs(m - cum[g.mid]) < 500)) continue;
      tried.set(key, n + 1);
      const cand = fixPoint(g);
      if (base.some(i => Math.abs(cum[i] - cum[cand]) < 200)) continue;
      add = cand; break;
    }
    if (add < 0) break;

    if (base.length < budget) { idx = uniqueSorted([...base, add]); continue; }

    // Sin puntos libres: buscar un punto que sobre (sus dos tramos coinciden con el track y es el
    // que menos se aparta de la línea recta entre sus vecinos) y cambiarlo por el nuevo.
    // Si el cambio empeora, en la siguiente vuelta se parte otra vez del mejor resultado.
    if (++swaps > 6) break;
    // primero se buscan puntos lejos de cualquier hueco; si no hay, el que menos se aparta
    const pick = avoidGaps => {
      let w = -1, wv = Infinity;
      for (let k = 0; k < base.length; k++) {
        if (keepers.has(base[k])) continue;
        const lo = k ? kmOf(base[k - 1]) : 0, hi = k < base.length - 1 ? kmOf(base[k + 1]) : totalKm;
        if (avoidGaps && gaps.some(g => g.toKm > lo && g.fromKm < hi)) continue;
        const a = k ? track[base[k - 1]] : track[0], b = k < base.length - 1 ? track[base[k + 1]] : track[end];
        const v = G.haversine(a, track[base[k]]) + G.haversine(track[base[k]], b) - G.haversine(a, b);
        if (v < wv) { wv = v; w = k; }
      }
      return w;
    };
    let worst = pick(true); if (worst < 0) worst = pick(false);
    if (worst < 0) break;
    keepers.add(base[worst]);                              // si al quitarlo empeora, ya no se vuelve a probar
    idx = uniqueSorted([...base.filter((_, k) => k !== worst), add]);
  }
  if (!best) throw new Error('No he podido ajustar la ruta a carreteras. Prueba de nuevo.');
  ({ idx } = best); const { r, cmp } = best;
  const stops = [...r.stops, track[end]];
  const stopKm = [...idx.map(i => cum[i] / 1000), totalKm];
  return { total: totalKm, start: track[0].slice(), legs: splitLegs(stops, stopKm, per), route: r, pct: cmp.pct, gaps: cmp.gaps, km: r.km };
}

/** Errores del motor que dependen de dónde caen los puntos (merece la pena reintentar). */
function retryable(e) { return !e.network; }

function splitLegs(stops, stopKm, per) {
  const legs = [];
  for (let k = 0; k < stops.length; k += per + 1) {
    const sl = stops.slice(k, k + per + 1);
    legs.push({ fromKm: k ? stopKm[k - 1] : 0, toKm: stopKm[k + sl.length - 1], points: sl });
  }
  return legs;
}

/** Recalcula la ruta del track tras arrastrar un punto. */
export async function rerouteTrack(track, plan, opts, router) {
  const stops = plan.legs.flatMap(l => l.points);
  const r = await router.route([track[0], ...stops], opts);
  const cmp = G.compareRoute(track, r.shape);
  return { ...plan, route: r, pct: cmp.pct, gaps: cmp.gaps, km: r.km };
}

// ---------- utilidades ----------
function initialMidpoints(track, cum, n) {
  const v = G.simplifyToN(track, n + 1), out = [];
  for (let k = 1; k < v.length; k++) {
    const m = (cum[v[k - 1]] + cum[v[k]]) / 2;
    let j = v[k - 1]; while (j < v[k] && cum[j] < m) j++;
    out.push(j);
  }
  return uniqueSorted(out.filter(i => i > 0 && i < track.length - 1));
}
function shiftAlong(cum, i, m) { let j = i; while (j < cum.length - 2 && cum[j] < cum[i] + m) j++; return j; }
const uniqueSorted = a => [...new Set(a)].sort((x, y) => x - y);
function dedupe(pts, minM) {
  const out = [];
  for (const p of pts) if (!out.length || G.haversine(out[out.length - 1], p) >= minM) out.push(p);
  return out;
}

// ================= FASE 3a: ruta sorpresa con curvas =================

const roadCache = new Map();
/** Carreteras reviradas alrededor de un punto (se guardan para no volver a descargarlas). */
export async function curvyAround(center, radiusM, overpass, progress = () => {}, curvyOpts = {}) {
  const bbox = C.bboxAround(center, radiusM), key = bbox.map(v => v.toFixed(2)).join(',');
  if (!roadCache.has(key)) {
    progress('Buscando carreteras reviradas…');
    const ways = await C.fetchRoads(bbox, overpass);
    roadCache.set(key, C.curvyStretches(C.mergeRoads(ways), curvyOpts));
  }
  return roadCache.get(key);
}

/**
 * Ruta sorpresa que busca curvas: divide la vuelta en sectores y en cada uno elige el tramo
 * más revirado que pille de camino. Cada tramo entra con dos puntos (al 20% y al 80%)
 * para obligar a recorrerlo entero, en el sentido de la vuelta.
 */
export async function planSurpriseCurvy(start, km, dir, opts, router, { overpass, rand = Math.random, curvyOpts } = {}, progress = () => {}) {
  const P = G.loopParams(dir, { rand });
  const n = km < 70 ? 3 : 4;                       // tramos revirados (2 puntos cada uno)
  const ROAD = 1.35;
  let scale = 1, best = null, stretches = null, fetchedFor = null;

  for (let it = 0; it < 3; it++) {
    const R = km * 1000 / (2 * Math.PI * ROAD) * scale;
    const center = G.destPoint(start, P.brg, R);
    if (!stretches || G.haversine(center, fetchedFor.c) > 0.35 * fetchedFor.R) {
      stretches = await curvyAround(center, 1.6 * R, overpass, progress, curvyOpts);
      fetchedFor = { c: center, R };
    }
    progress(it === 0 ? 'Eligiendo los tramos con más curvas…' : 'Ajustando los kilómetros…');
    const back = (P.brg + 180) % 360, used = new Set(), wps = [];
    let prev = start;
    for (let i = 1; i <= n; i++) {
      const target = back + P.sense * 360 * i / (n + 1), half = 180 / (n + 1);
      let pick = null, pickScore = -1;
      for (const [k, s] of stretches.entries()) {
        if (used.has(k)) continue;
        const d = G.haversine(center, s.mid);
        if (d < 0.45 * R || d > 1.6 * R) continue;
        const ang = bearing(center, s.mid), off = Math.abs(((ang - target + 540) % 360) - 180);
        if (off > half) continue;
        const score = s.curv * (0.7 + 0.6 * rand()) * (1 - 0.5 * Math.abs(d - R) / R);
        if (score > pickScore) { pickScore = score; pick = k; }
      }
      if (pick == null) { const g = G.destPoint(center, target, R); wps.push({ geo: g }); prev = g; continue; }
      used.add(pick);
      const s = stretches[pick];
      let a = C.pointAt(s.pts, 0.2), b = C.pointAt(s.pts, 0.8);
      if (G.haversine(prev, a) > G.haversine(prev, b)) [a, b] = [b, a];
      wps.push({ pair: [a, b] }); prev = b;
    }
    // los sectores sin tramo revirado usan un punto normal, ajustado a carretera (o se quitan si cae en el mar)
    const geo = wps.filter(w => w.geo);
    if (geo.length) {
      const sn = await router.snap(geo.map(w => w.geo), { minClass: 'tertiary' }, opts);
      geo.forEach((w, k) => { w.snapped = sn[k]; });
    }
    const groups = wps.map(w => (w.geo ? (w.snapped ? [w.snapped] : null) : w.pair)).filter(Boolean);
    let r = await routeGroups(start, groups, opts, router);
    r = await fixSpurs(start, r.stops, r, opts, router, progress);
    const cand = {
      start, points: r.points, route: r, km: r.km, brg: P.brg, target: km,
      curvy: C.curvyShare(r.shape, stretches), roads: [...new Set([...used].map(k => stretches[k].name).filter(Boolean))],
      stretches: stretches.map(x => x.pts),
    };
    if (!best || Math.abs(cand.km - km) < Math.abs(best.km - km)) best = cand;
    if (Math.abs(r.km - km) / km < 0.15) break;
    scale *= Math.max(0.5, Math.min(1.8, km / r.km));
  }
  return best;
}
/**
 * Ruta por grupos de puntos (un tramo revirado = 2 puntos). Si alguna carretera queda aislada
 * y no hay forma de llegar, se prueba quitando un grupo cada vez.
 */
async function routeGroups(start, groups, opts, router) {
  const go = gs => router.route([start, ...gs.flat(), start], opts, { minClass: 'tertiary' });
  try { return await go(groups); } catch (e) { if (groups.length < 2) throw e; }
  for (let k = groups.length - 1; k >= 0; k--) {
    try { return await go(groups.filter((_, i) => i !== k)); } catch { /* probar el siguiente */ }
  }
  throw new Error('No encuentro una vuelta por carretera desde aquí.');
}
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
