// RutaLibre — fase 3a: carreteras reviradas.
// Descarga las carreteras de la zona desde OpenStreetMap (Overpass) y mide lo "revirada"
// que es cada una con el método del proyecto libre "curvature" (Adam Franco):
// cada tramo de curva suma su longitud multiplicada por un peso según lo cerrada que es.
import * as G from './geo.js';

export const DEFAULT_OVERPASS = 'https://overpass-api.de/api/interpreter';

// radio de la curva (m) → peso. Rectas y curvas abiertas (> 175 m de radio) no suman.
const LEVELS = [[30, 2], [60, 1.6], [100, 1.3], [175, 1]];

/** Radio (m) de la circunferencia que pasa por tres puntos (Infinity si están alineados). */
function circumradius(a, b, c) {
  const ab = G.haversine(a, b), bc = G.haversine(b, c), ca = G.haversine(c, a);
  const s = (ab + bc + ca) / 2, area = Math.sqrt(Math.max(0, s * (s - ab) * (s - bc) * (s - ca)));
  return area < 1e-6 ? Infinity : (ab * bc * ca) / (4 * area);
}

/** Curvatura de una polilínea: { km, curv (m ponderados), perKm }. */
export function curvature(pts) {
  let curv = 0, len = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = G.haversine(pts[i - 1], pts[i]); len += d;
    if (i < pts.length - 1) {
      const r = circumradius(pts[i - 1], pts[i], pts[i + 1]);
      const lv = LEVELS.find(([max]) => r < max);
      if (lv) curv += lv[1] * (d + G.haversine(pts[i], pts[i + 1])) / 2;
    }
  }
  return { km: len / 1000, curv, perKm: len ? curv / (len / 1000) : 0 };
}

/**
 * Descarga las carreteras asfaltadas (primarias, secundarias y terciarias) de un recuadro.
 * bbox = [sur, oeste, norte, este]. Devuelve [{ key, name, pts }].
 */
export async function fetchRoads(bbox, endpoint = DEFAULT_OVERPASS, fetchImpl = globalThis.fetch.bind(globalThis)) {
  const q = `[out:json][timeout:40];way["highway"~"^(primary|secondary|tertiary)$"]["surface"!~"unpaved|gravel|dirt|ground|compacted|fine_gravel"]["access"!~"no|private"](${bbox.map(v => v.toFixed(4)).join(',')});out tags geom qt;`;
  const res = await fetchImpl(`${endpoint}?data=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const j = await res.json();
  return (j.elements || []).filter(e => e.type === 'way' && e.geometry && e.geometry.length > 1).map(e => {
    const t = e.tags || {};
    return { key: t.ref || t.name || 'way' + e.id, name: [t.ref, t.name].filter(Boolean).join(' · '), pts: e.geometry.map(g => [g.lat, g.lon]) };
  });
}

/** Une los trozos consecutivos de una misma carretera (misma referencia o nombre). */
export function mergeRoads(ways) {
  const byKey = new Map();
  for (const w of ways) { if (!byKey.has(w.key)) byKey.set(w.key, []); byKey.get(w.key).push(w.pts.slice()); }
  const k = p => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const out = [];
  for (const [key, parts] of byKey) {
    const name = ways.find(w => w.key === key).name;
    const pool = parts.slice();
    while (pool.length) {
      let chain = pool.pop(), grown = true;
      while (grown) {
        grown = false;
        for (let i = 0; i < pool.length; i++) {
          const p = pool[i], cs = k(chain[0]), ce = k(chain[chain.length - 1]), ps = k(p[0]), pe = k(p[p.length - 1]);
          if (ce === ps) chain = chain.concat(p.slice(1));
          else if (ce === pe) chain = chain.concat(p.slice().reverse().slice(1));
          else if (cs === pe) chain = p.concat(chain.slice(1));
          else if (cs === ps) chain = p.slice().reverse().concat(chain.slice(1));
          else continue;
          pool.splice(i, 1); grown = true; break;
        }
      }
      out.push({ key, name, pts: chain, ...curvature(chain) });
    }
  }
  return out;
}

/**
 * Tramos revirados: de cada carretera se busca la ventana de ~`winKm` km más revirada.
 * Devuelve candidatos { name, pts (la ventana), curv, perKm, mid }.
 */
export function curvyStretches(roads, { winKm = 6, minCurv = 350, minPerKm = 60 } = {}) {
  const out = [];
  for (const r of roads) {
    if (r.km < 1.5 || r.curv < minCurv * 0.5) continue;
    const cum = G.cumulative(r.pts), total = cum[cum.length - 1], win = Math.min(winKm * 1000, total);
    let best = null;
    for (let a = 0; a < r.pts.length - 1; a = Math.max(a + 1, nextAt(cum, a, 500))) {
      const b = nextAt(cum, a, win);
      const c = curvature(r.pts.slice(a, b + 1));
      if (!best || c.curv > best.curv) best = { a, b, ...c };
      if (cum[b] >= total) break;
    }
    if (best && best.curv >= minCurv && best.perKm >= minPerKm) {
      const pts = r.pts.slice(best.a, best.b + 1);
      out.push({ name: r.name, pts, curv: best.curv, perKm: best.perKm, km: best.km, mid: pts[Math.floor(pts.length / 2)] });
    }
  }
  return out.sort((x, y) => y.curv - x.curv);
}
function nextAt(cum, i, m) { let j = i; while (j < cum.length - 1 && cum[j] - cum[i] < m) j++; return j; }

/** Punto a una fracción (0–1) del recorrido de una polilínea. */
export function pointAt(pts, frac) {
  const cum = G.cumulative(pts), target = cum[cum.length - 1] * frac;
  let j = 0; while (j < cum.length - 1 && cum[j] < target) j++;
  return pts[j].slice();
}

/** % de una ruta que va por tramos revirados (a menos de 25 m de ellos). */
export function curvyShare(shape, stretches) {
  if (!stretches.length || shape.length < 2) return 0;
  const pad = 0.0005; // ~50 m, para descartar rápido por caja
  const boxes = stretches.map(s => {
    let a = 90, b = 180, c = -90, d = -180;
    for (const [la, lo] of s.pts) { a = Math.min(a, la); b = Math.min(b, lo); c = Math.max(c, la); d = Math.max(d, lo); }
    return [a - pad, b - pad, c + pad, d + pad];
  });
  let near = 0, total = 0;
  for (let i = 1; i < shape.length; i++) {
    const d = G.haversine(shape[i - 1], shape[i]), p = shape[i]; total += d;
    let hit = false;
    for (let k = 0; k < stretches.length && !hit; k++) {
      const bx = boxes[k];
      if (p[0] < bx[0] || p[0] > bx[2] || p[1] < bx[1] || p[1] > bx[3]) continue;
      const l = stretches[k].pts;
      for (let j = 1; j < l.length; j++) if (segDist(p, l[j - 1], l[j]) < 25) { hit = true; break; }
    }
    if (hit) near += d;
  }
  return total ? near / total : 0;
}
function segDist(p, a, b) {
  const k = Math.cos(p[0] * Math.PI / 180) * 111320, m = 110540;
  const px = p[1] * k, py = p[0] * m, ax = a[1] * k, ay = a[0] * m, bx = b[1] * k, by = b[0] * m;
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Recuadro [sur, oeste, norte, este] alrededor de un punto con un radio en metros. */
export function bboxAround(c, radiusM) {
  const n = G.destPoint(c, 0, radiusM), s = G.destPoint(c, 180, radiusM), e = G.destPoint(c, 90, radiusM), w = G.destPoint(c, 270, radiusM);
  return [s[0], w[1], n[0], e[1]];
}
