// RutaLibre — planificador de la fase 2.
// Usa el motor de rutas (Valhalla) para que los puntos caigan en carreteras reales,
// medir los km de verdad y comprobar que la ruta sigue a tu track.
import * as G from './geo.js';

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
 * Ruta desde un track (GPX). Empieza con pocos puntos y va añadiendo uno donde la ruta
 * calculada se separa más del track, hasta que coincide o se acaba el presupuesto de puntos.
 *   maxLinks: enlaces de Google Maps que aceptas (cada uno: `per` paradas + destino).
 */
export async function planTrack(track, { maxLinks = 1, per = 9, target = 0.97, ...opts }, router, progress = () => {}) {
  const cum = G.cumulative(track), totalKm = cum[cum.length - 1] / 1000;
  const end = track.length - 1;
  const budget = maxLinks * (per + 1) - 1;            // puntos intermedios posibles (sin contar el destino final)
  const n0 = Math.max(2, Math.min(budget, Math.floor((per + 1) / 2) * maxLinks, Math.round(totalKm / 20)));
  let idx = initialMidpoints(track, cum, n0);
  // Cada punto se ajusta a la carretera dentro de la propia petición de ruta
  // (nada de caminos de servicio ni parkings: clase "residential" o superior).
  const route = () => router.route([track[0], ...idx.map(i => track[i]), track[end]], opts, { minClass: 'residential', radius: 60 });

  let best = null;
  const tried = new Map();                                // km de hueco → veces probado
  let swaps = 0;
  const maxIt = budget - idx.length + 8;
  for (let it = 0; it < maxIt; it++) {
    progress(`Comprobando la ruta… (${idx.length} puntos)`);
    const r = await route();
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
    if (!best || cmp.pct > best.cmp.pct) best = { idx: idx.slice(), r, cmp };
    if (cmp.pct >= target || !cmp.gaps.length) break;
    const gap = cmp.gaps.find(g => (tried.get(Math.round(g.fromKm)) || 0) < 2 && !idx.some(i => Math.abs(cum[i] - cum[g.mid]) < 300));
    if (!gap) break;
    tried.set(Math.round(gap.fromKm), (tried.get(Math.round(gap.fromKm)) || 0) + 1);
    if (idx.length >= budget) {
      // sin puntos libres: cambiar el punto más "prescindible" (el que menos se aparta de la línea
      // entre sus vecinos) por uno en el hueco más grande. Si empeora, se queda el mejor resultado.
      if (++swaps > 3) break;
      const base = best.idx; let worst = -1, wv = Infinity;
      for (let k = 0; k < base.length; k++) {
        const a = k ? track[base[k - 1]] : track[0], b = k < base.length - 1 ? track[base[k + 1]] : track[end];
        const v = G.haversine(a, track[base[k]]) + G.haversine(track[base[k]], b) - G.haversine(a, b);
        if (v < wv) { wv = v; worst = k; }
      }
      idx = uniqueSorted([...base.filter((_, k) => k !== worst), gap.mid]);
    } else idx = uniqueSorted([...idx, gap.mid]);
  }
  if (!best) throw new Error('No he podido ajustar la ruta a carreteras. Prueba de nuevo.');
  ({ idx } = best); const { r, cmp } = best;
  const stops = [...r.stops, track[end]];
  const stopKm = [...idx.map(i => cum[i] / 1000), totalKm];
  return { total: totalKm, start: track[0].slice(), legs: splitLegs(stops, stopKm, per), route: r, pct: cmp.pct, gaps: cmp.gaps, km: r.km };
}

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
