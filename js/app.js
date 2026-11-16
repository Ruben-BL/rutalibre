// RutaLibre — interfaz. La lógica de rutas está en geo.js.
import * as G from './geo.js';

const $ = id => document.getElementById(id);
const MAP_STYLE = new URLSearchParams(location.search).get('style') || 'https://tiles.openfreemap.org/styles/liberty';
const LEG_COLORS = ['#ff5a36', '#4a90ff', '#2fbf71', '#f5b83d', '#c77dff', '#00c2c7'];
const DEFAULT_CENTER = [41.56, 2.01]; // Terrassa; solo hasta tener tu ubicación

// ---------------- estado ----------------
const S = {
  tab: 'sorpresa',
  here: null,          // tu ubicación [lat,lon]
  start: null,         // salida elegida tocando el mapa
  loop: null,          // { start, km, brg, points }
  gpx: null,           // { name, pts }
  route: null,         // resultado de G.routeFromTrack
  towns: null,         // { key, names: [{name, province, label}] }
};

// ---------------- utilidades de interfaz ----------------
let toastTimer;
function toast(msg, ms = 2600) {
  const t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
}
function segValue(id) { const b = document.querySelector(`#${id} .on`); return b ? b.dataset.v : null; }
function bindSeg(id, onChange) {
  $(id).addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    onChange && onChange(b.dataset.v);
  });
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('rl.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rl.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
function download(text, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = s => (s || 'ruta').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'ruta';

// ---------------- mapa ----------------
let map = null, mapReady = false, markers = [];
function initMap() {
  if (!window.maplibregl) return mapFail('No se pudo cargar el mapa. El resto de la página funciona igual.');
  try {
    map = new maplibregl.Map({
      container: 'map', style: MAP_STYLE, center: [DEFAULT_CENTER[1], DEFAULT_CENTER[0]], zoom: 9,
      attributionControl: { compact: true },
    });
  } catch (e) {
    return mapFail('Tu navegador no puede mostrar el mapa (WebGL desactivado). El resto funciona igual.');
  }
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.on('error', e => { if (!mapReady) console.warn('Mapa:', e && e.error); });
  map.on('load', () => {
    mapReady = true;
    map.addSource('track', { type: 'geojson', data: emptyFC() });
    map.addSource('loop', { type: 'geojson', data: emptyFC() });
    map.addLayer({ id: 'track', type: 'line', source: 'track', paint: { 'line-color': '#d7263d', 'line-width': 4, 'line-opacity': .85 }, layout: { 'line-join': 'round', 'line-cap': 'round' } });
    map.addLayer({ id: 'loop', type: 'line', source: 'loop', paint: { 'line-color': '#ff5a36', 'line-width': 3, 'line-dasharray': [2, 2] } });
    render();
  });
  map.on('click', e => {
    if (S.tab !== 'sorpresa') return;
    S.start = [e.lngLat.lat, e.lngLat.lng];
    $('startHint').innerHTML = 'Salida: <b>el punto que has tocado</b>. <a href="#" id="useHere">Volver a mi ubicación</a>';
    $('useHere').onclick = ev => { ev.preventDefault(); S.start = null; $('startHint').innerHTML = 'Salida: tu ubicación. También puedes <b>tocar el mapa</b> para elegir otro punto de salida.'; render(); };
    if (S.loop) regenerate(); else render();
    toast('Salida fijada aquí');
  });
}
function mapFail(msg) { const m = $('mapMsg'); m.textContent = msg; m.classList.remove('hidden'); }
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const lineFC = coords => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map(p => [p[1], p[0]]) } }] });

function clearMarkers() { markers.forEach(m => m.remove()); markers = []; }
function addMarker(p, label, cls, color, onDrag) {
  if (!mapReady) return;
  const el = document.createElement('div');
  el.className = 'mk ' + (cls || ''); el.textContent = label;
  if (color) el.style.background = color;
  el.addEventListener('click', e => e.stopPropagation()); // tocar un punto no cambia la salida
  const m = new maplibregl.Marker({ element: el, draggable: !!onDrag }).setLngLat([p[1], p[0]]).addTo(map);
  if (onDrag) m.on('dragend', () => { const ll = m.getLngLat(); onDrag([ll.lat, ll.lng]); });
  markers.push(m);
}
function fit(points) {
  if (!mapReady || !points.length) return;
  const b = new maplibregl.LngLatBounds();
  points.forEach(p => b.extend([p[1], p[0]]));
  map.fitBounds(b, { padding: 50, maxZoom: 13, duration: 600 });
}

// ---------------- ubicación ----------------
function locate(silent) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Sin geolocalización'));
    navigator.geolocation.getCurrentPosition(pos => {
      S.here = [pos.coords.latitude, pos.coords.longitude];
      if (mapReady && !S.loop && !S.gpx) map.flyTo({ center: [S.here[1], S.here[0]], zoom: 11 });
      render(); resolve(S.here);
    }, err => { if (!silent) toast('No puedo leer tu ubicación. Toca el mapa para elegir la salida.', 4000); reject(err); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

// ---------------- ruta sorpresa ----------------
function sOpts() { return { avoidHighways: $('sAvh').checked, avoidTolls: $('sAvt').checked }; }
function kmChosen() { return +$('kmIn').value || +segValue('kmSeg') || 100; }

async function generate() {
  const km = kmChosen();
  if (km < 10 || km > 400) return toast('Elige entre 10 y 400 km');
  let start = S.start || S.here;
  if (!start) {
    $('genBtn').textContent = 'Buscando tu ubicación…';
    try { start = await locate(); } catch { $('genBtn').textContent = 'Generar ruta'; return; }
    $('genBtn').textContent = 'Generar ruta';
  }
  const dir = +segValue('dirSeg');
  const r = G.surpriseLoop(start, km, dir);
  S.loop = { start, km, ...r };
  S.towns = null; $('towns').classList.add('hidden');
  store.set('km', km);
  render(true);
}
function regenerate() { S.loop = null; generate(); }

function loopStops() { return [...S.loop.points, S.loop.start]; }
function loopUrl() {
  const names = useNamesFor('loop');
  return G.mapsUrl(names || loopStops(), sOpts());
}

// ---------------- desde un GPX ----------------
function gOpts() { return { avoidHighways: $('gAvh').checked, avoidTolls: $('gAvt').checked }; }
function buildRoute() {
  if (!S.gpx) return;
  const mode = segValue('modeSeg');
  S.route = G.routeFromTrack(S.gpx.pts, { mode: mode === 'one' ? 'one' : 'legs', kmPer: +mode || 7, per: +segValue('perSeg') });
  S.towns = null; $('towns').classList.add('hidden');
  render(true);
}
function loadFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const g = G.parseGpx(rd.result);
      S.gpx = { name: g.name || file.name.replace(/\.gpx$/i, ''), pts: g.pts };
      $('drop').classList.add('has'); $('fname').textContent = file.name;
      buildRoute();
    } catch (e) { toast(e.message, 4000); }
  };
  rd.readAsText(file);
}
function routeStops() { return S.route.legs.flatMap(l => l.points); }

// ---------------- pueblos (Nominatim) ----------------
// Nominatim pide como máximo 1 petición por segundo: se piden de una en una y se guardan.
const geoCache = new Map();
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function reverse(p) {
  const key = p[0].toFixed(4) + ',' + p[1].toFixed(4);
  if (geoCache.has(key)) return geoCache.get(key);
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&accept-language=es&lat=${p[0]}&lon=${p[1]}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Nominatim ' + res.status);
  const j = await res.json(), a = j.address || {};
  const name = a.village || a.town || a.city || a.municipality || a.hamlet || a.suburb || '';
  const out = { name, province: a.province || a.county || a.state || '' };
  geoCache.set(key, out); await sleep(1100);
  return out;
}
async function showTowns(kind) {
  const pts = kind === 'loop' ? [S.loop.start, ...S.loop.points, S.loop.start] : [S.route.start, ...routeStops()];
  const key = kind + ':' + pts.map(p => p.join()).join('|');
  const box = $('towns'), list = $('townList');
  box.classList.remove('hidden'); box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (S.towns && S.towns.key === key) return;
  list.innerHTML = '';
  const names = [];
  for (let i = 0; i < pts.length; i++) {
    const li = document.createElement('li');
    li.innerHTML = '<small>buscando…</small>'; list.append(li);
    let t = { name: '', province: '' };
    try { t = await reverse(pts[i]); } catch { /* sin conexión o límite: quedan coordenadas */ }
    const coord = `${pts[i][0].toFixed(5)}, ${pts[i][1].toFixed(5)}`;
    const tag = i === 0 ? 'Salida' : i === pts.length - 1 ? 'Destino' : '';
    li.innerHTML = `${t.name ? `<b>${t.name}</b>` : 'Sin pueblo cerca'} ${tag ? `<small>(${tag})</small>` : ''}<br><small>${coord}</small>`;
    names.push({ ...t, coord });
  }
  S.towns = { key, kind, names };
  if ($('useNames').checked) render();
}
/** Si «usar nombres» está marcado, devuelve las paradas como texto (sin la salida). */
function useNamesFor(kind) {
  if (!$('useNames').checked || !S.towns || S.towns.kind !== kind) return null;
  return S.towns.names.slice(1).map(t => t.name ? `${t.name}${t.province ? ', ' + t.province : ''}` : t.coord.replace(' ', ''));
}

// ---------------- dibujar ----------------
function render(fitView) {
  // --- sorpresa ---
  if (S.tab === 'sorpresa') {
    if (mapReady) { map.getSource('track').setData(emptyFC()); clearMarkers(); }
    const start = S.loop ? S.loop.start : (S.start || S.here);
    if (S.loop) {
      const ring = [S.loop.start, ...S.loop.points, S.loop.start];
      if (mapReady) {
        map.getSource('loop').setData(lineFC(ring));
        S.loop.points.forEach((p, i) => addMarker(p, i + 1, '', null, np => { S.loop.points[i] = np; S.towns = null; render(); }));
      }
      $('sOut').classList.remove('hidden');
      $('sStats').innerHTML = `Vuelta de <b>~${S.loop.km} km</b> hacia el ${G.compass(S.loop.brg)} · ${S.loop.points.length} puntos de paso. La distancia exacta te la da Maps.`;
      $('sGo').href = loopUrl();
      if (fitView) fit(ring);
    } else if (mapReady) map.getSource('loop').setData(emptyFC());
    if (start && mapReady) addMarker(start, '●', 'start');
    return;
  }
  // --- gpx ---
  if (mapReady) { map.getSource('loop').setData(emptyFC()); clearMarkers(); }
  if (!S.gpx || !S.route) { if (mapReady) map.getSource('track').setData(emptyFC()); return; }
  if (mapReady) {
    const step = Math.max(1, Math.floor(S.gpx.pts.length / 3000));
    map.getSource('track').setData(lineFC(S.gpx.pts.filter((_, i) => i % step === 0 || i === S.gpx.pts.length - 1)));
    addMarker(S.route.start, '●', 'start');
  }
  let n = 0;
  const legsBox = $('legs'); legsBox.innerHTML = '';
  const names = useNamesFor('gpx'); let ni = 0;
  S.route.legs.forEach((leg, li) => {
    const color = LEG_COLORS[li % LEG_COLORS.length];
    leg.points.forEach((p, pi) => { n++; addMarker(p, n, '', color, np => { leg.points[pi] = np; S.towns = null; render(); }); });
    const stops = names ? names.slice(ni, ni + leg.points.length) : leg.points; ni += leg.points.length;
    const div = document.createElement('div'); div.className = 'leg';
    const many = S.route.legs.length > 1;
    div.innerHTML = `<span class="dot" style="background:${color}"></span><div class="info"><div class="t">${many ? 'Tramo ' + (li + 1) : 'Ruta completa'}</div><div class="d">km ${leg.fromKm.toFixed(0)} → ${leg.toKm.toFixed(0)} · ${leg.points.length} puntos</div></div>`;
    const a = document.createElement('a'); a.href = G.mapsUrl(stops, gOpts()); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Abrir en Maps';
    div.append(a); legsBox.append(div);
  });
  $('gOut').classList.remove('hidden');
  const nl = S.route.legs.length;
  $('gStats').innerHTML = `<b>${S.gpx.name}</b> · ${S.route.total.toFixed(1)} km · ${n} puntos · ${nl === 1 ? '1 enlace' : nl + ' enlaces'}`
    + (nl > 1 ? '<br>Consejo: haz que el cambio de enlace caiga en tu parada para comer.' : '');
  if (fitView) fit(S.gpx.pts);
}

// ---------------- eventos ----------------
function switchTab(t) {
  S.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('tab-sorpresa').classList.toggle('hidden', t !== 'sorpresa');
  $('tab-gpx').classList.toggle('hidden', t !== 'gpx');
  $('towns').classList.add('hidden');
  render(true);
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });

bindSeg('kmSeg', () => { $('kmIn').value = ''; });
$('kmIn').addEventListener('input', () => $('kmSeg').querySelectorAll('button').forEach(b => b.classList.remove('on')));
bindSeg('dirSeg');
bindSeg('modeSeg', buildRoute);
bindSeg('perSeg', buildRoute);
['sAvh', 'sAvt', 'gAvh', 'gAvt'].forEach(id => $(id).addEventListener('change', () => { store.set(id, $(id).checked); render(); }));
$('useNames').addEventListener('change', render);

$('genBtn').onclick = regenerate;
$('againBtn').onclick = regenerate;
$('locateBtn').onclick = () => { S.start = null; locate().catch(() => {}); };
$('sShare').onclick = async () => {
  const url = loopUrl();
  try {
    if (navigator.share) await navigator.share({ title: 'Ruta en moto', text: `Vuelta de ~${S.loop.km} km`, url });
    else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
  } catch { /* cancelado */ }
};
$('sTowns').onclick = () => showTowns('loop');
$('gTowns').onclick = () => showTowns('gpx');
$('sWpt').onclick = () => download(G.gpxWaypoints([S.loop.start, ...S.loop.points, S.loop.start], 'Sorpresa', ['Salida', ...S.loop.points.map(() => ''), 'Destino']), `sorpresa_${S.loop.km}km_puntos.gpx`);
$('gWpt').onclick = () => { const p = [S.route.start, ...routeStops()]; download(G.gpxWaypoints(p, 'Ruta', ['Salida', ...p.slice(2).map(() => ''), 'Destino']), slug(S.gpx.name) + '_puntos.gpx'); };
$('gTrack').onclick = () => download(G.gpxTrack(S.gpx.pts, S.gpx.name), slug(S.gpx.name) + '_track.gpx');
$('copyTowns').onclick = async () => {
  if (!S.towns) return;
  const txt = S.towns.names.map((t, i) => `${i + 1}. ${t.name || '(sin pueblo)'} — ${t.coord}`).join('\n');
  try { await navigator.clipboard.writeText(txt); toast('Lista copiada'); } catch { toast('No se pudo copiar'); }
};

$('file').addEventListener('change', e => loadFile(e.target.files[0]));
const drop = $('drop');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('has'); }));
drop.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

// preferencias guardadas en este dispositivo
['sAvh', 'sAvt', 'gAvh', 'gAvt'].forEach(id => { const v = store.get(id, null); if (v !== null) $(id).checked = v; });
const savedKm = store.get('km', null);
if (savedKm) {
  const b = $('kmSeg').querySelector(`[data-v="${savedKm}"]`);
  $('kmSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  if (!b) $('kmIn').value = savedKm;
}

// arranque
initMap();
locate(true).catch(() => {});
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
