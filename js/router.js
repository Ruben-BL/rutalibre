// RutaLibre — cliente del motor de rutas Valhalla.
// Por defecto usa el servidor público de FOSSGIS (máx. 1 petición por segundo según sus
// condiciones de uso). Se puede apuntar a otro servidor, p. ej. uno propio en casa:
//   ?router=https://mi-servidor:8002   (se recuerda en este dispositivo)

export const DEFAULT_ROUTER = 'https://valhalla1.openstreetmap.de';

/** Decodifica una polilínea de Valhalla (precisión 6) → [[lat,lon], ...]. */
export function decodePolyline6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = (result & 1) ? ~(result >> 1) : (result >> 1);
      if (k === 0) lat += d; else lon += d;
    }
    out.push([lat / 1e6, lon / 1e6]);
  }
  return out;
}

export class Router {
  constructor(base = DEFAULT_ROUTER, { minInterval = 1100, fetchImpl = globalThis.fetch.bind(globalThis) } = {}) {
    this.base = base.replace(/\/+$/, '');
    this.minInterval = minInterval;
    this.fetch = fetchImpl;
    this.last = 0;
    this.chain = Promise.resolve();
  }

  /** Todas las peticiones pasan por esta cola: una cada `minInterval` ms. */
  _post(action, body) {
    const run = async () => {
      const wait = this.last + this.minInterval - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this.last = Date.now();
      // GET con ?json=… (como hace openstreetmap.org): es una petición "simple" para el navegador,
      // sin consulta previa CORS, y funciona con cualquier servidor Valhalla.
      const res = await this.fetch(`${this.base}/${action}?json=${encodeURIComponent(JSON.stringify(body))}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(j.error || `Error ${res.status} del motor de rutas`); e.code = j.error_code; throw e; }
      return j;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  static costing({ avoidHighways = false, avoidTolls = false } = {}) {
    return {
      costing: 'motorcycle',
      costing_options: { motorcycle: { use_highways: avoidHighways ? 0 : 0.5, use_tolls: avoidTolls ? 0 : 0.5, use_trails: 0 } },
    };
  }

  /**
   * Ruta por una lista de puntos. Cada punto es una parada ('break'), igual que en Google Maps,
   * así se ven los "pinchos" de ida y vuelta.
   * Devuelve { km, legs: [{ km, shape:[[lat,lon]...] }], shape }.
   */
  async route(points, opts = {}, { minClass = null, radius = 0 } = {}) {
    const filter = minClass ? { min_road_class: minClass, exclude_ramp: true } : undefined;
    const j = await this._post('route', {
      locations: points.map((p, i) => ({
        lat: p[0], lon: p[1], type: 'break',
        ...(i > 0 && i < points.length - 1 && filter && { search_filter: filter }),
        ...(i > 0 && i < points.length - 1 && radius && { radius }),
      })),
      ...Router.costing(opts), directions_type: 'none', shape_format: 'polyline6', units: 'kilometers',
    });
    const legs = j.trip.legs.map(l => ({ km: l.summary.length, shape: decodePolyline6(l.shape) }));
    return {
      km: j.trip.summary.length, legs,
      shape: legs.flatMap((l, i) => i ? l.shape.slice(1) : l.shape),
      // dónde ha caído cada parada intermedia sobre la carretera
      stops: legs.slice(0, -1).map(l => l.shape[l.shape.length - 1]),
    };
  }

  /**
   * Ajusta puntos a la carretera más cercana.
   * minClass: clase de vía mínima aceptada ('tertiary' = nada de caminos, pistas ni calles).
   * Devuelve, para cada punto, [lat,lon] sobre la carretera o null si no hay ninguna cerca.
   */
  async snap(points, { minClass = null, radius = 0 } = {}, opts = {}) {
    const filter = minClass ? { min_road_class: minClass, exclude_ramp: true, exclude_closures: true } : undefined;
    const j = await this._post('locate', {
      locations: points.map(p => ({ lat: p[0], lon: p[1], ...(filter && { search_filter: filter }), ...(radius && { radius }) })),
      ...Router.costing(opts), verbose: false,
    });
    return j.map(loc => {
      const e = loc && loc.edges && loc.edges[0];
      return e ? [e.correlated_lat, e.correlated_lon] : null;
    });
  }
}
