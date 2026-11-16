// RutaLibre — interfaz.
// geo.js: geometría y enlaces · router.js: motor de rutas Valhalla · planner.js: planificador.
import * as G from './geo.js';
import { Router, DEFAULT_ROUTER } from './router.js';
import * as P from './planner.js';
import { DEFAULT_OVERPASS, curvyShare } from './curves.js';
const curvyShareOf = (shape, lines) => curvyShare(shape, lines.map(pts => ({ pts })));

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const MAP_STYLE = params.get('style') || 'https://tiles.openfreemap.org/styles/liberty';
const LEG_COLORS = ['#ff5a36', '#4a90ff', '#2fbf71', '#f5b83d', '#c77dff', '#00c2c7'];
const DEFAULT_CENTER = [41.56, 2.01]; // solo hasta tener tu ubicación

// ---------------- almacenamiento local (preferencias de este dispositivo) ----------------
const store = {
  get(k, d) { try { const v = localStorage.getItem('rl.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('rl.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
// Motor de rutas: ?router=URL lo cambia y se recuerda; ?router=default vuelve al público.
if (params.get('router')) store.set('router', params.get('router') === 'default' ? null : params.get('router'));
const router = new Router(store.get('router', null) || DEFAULT_ROUTER);
// Servidor de Overpass (carreteras de OpenStreetMap), igual: ?overpass=URL
if (params.get('overpass')) store.set('overpass', params.get('overpass') === 'default' ? null : params.get('overpass'));
const OVERPASS = store.get('overpass', null) || DEFAULT_OVERPASS;

// ---------------- estado ----------------
const S = {
  tab: 'sorpresa',
  here: null,          // tu ubicación [lat,lon]
  start: null,         // salida elegida tocando el mapa
  loop: null,          // plan de ruta sorpresa { start, points, route?, km, brg, target, exact }
  gpx: null,           // { name, pts }
  plan: null,          // plan del GPX { legs, route?, pct?, total, start, exact }
  towns: null,
  busy: 0,             // contador para descartar resultados antiguos
};

// ---------------- utilidades de interfaz ----------------
let toastTimer;
function toast(msg, ms = 2800) {
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
function download(text, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/gpx+xml' }));
  a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = s => (s || 'ruta').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'ruta';
function busy(el, text) { el.textContent = text; el.classList.toggle('hidden', !text); }

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
  map.on('load', () => {
    mapReady = true;
    for (const id of ['curvy', 'track', 'route', 'guide']) map.addSource(id, { type: 'geojson', data: emptyFC() });
    const round = { 'line-join': 'round', 'line-cap': 'round' };
    map.addLayer({ id: 'curvy', type: 'line', source: 'curvy', layout: round, paint: { 'line-color': '#f5b83d', 'line-width': 5, 'line-opacity': .45 } });
    map.addLayer({ id: 'track', type: 'line', source: 'track', layout: round, paint: { 'line-color': '#d7263d', 'line-width': 6, 'line-opacity': .55 } });
    map.addLayer({ id: 'route', type: 'line', source: 'route', layout: round, paint: { 'line-color': '#1e6bff', 'line-width': 3.5, 'line-opacity': .95 } });
    map.addLayer({ id: 'guide', type: 'line', source: 'guide', paint: { 'line-color': '#ff5a36', 'line-width': 3, 'line-dasharray': [2, 2] } });
    render(true);
  });
  map.on('click', e => {
    if (S.tab !== 'sorpresa') return;
    S.start = [e.lngLat.lat, e.lngLat.lng];
    $('startHint').innerHTML = 'Salida: <b>el punto que has tocado</b>. <a href="#" id="useHere">Volver a mi ubicación</a>';
    $('useHere').onclick = ev => { ev.preventDefault(); backToHere(); };
    render();
    toast(S.loop ? 'Nueva salida fijada. Pulsa «Generar ruta» para crear la vuelta desde aquí.' : 'Salida fijada aquí', 3500);
  });
}
/** Olvida la salida elegida en el mapa y vuelve a leer dónde estás de verdad. */
function backToHere() {
  S.start = null; $('startHint').innerHTML = HINT_START; render();
  locate(false, true).catch(() => {});
}
const HINT_START = 'Salida: tu ubicación. También puedes <b>tocar el mapa</b> para elegir otro punto de salida.';
function mapFail(msg) { const m = $('mapMsg'); m.textContent = msg; m.classList.remove('hidden'); }
const emptyFC = () => ({ type: 'FeatureCollection', features: [] });
const lineFC = coords => ({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.map(p => [p[1], p[0]]) } }] });
function setMulti(id, lines) {
  if (!mapReady) return;
  map.getSource(id).setData(lines && lines.length ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: lines.map(l => l.map(p => [p[1], p[0]])) } }] } : emptyFC());
}
function setLine(id, coords) { if (mapReady) map.getSource(id).setData(coords && coords.length > 1 ? lineFC(thin(coords)) : emptyFC()); }
const thin = c => { const step = Math.max(1, Math.floor(c.length / 4000)); return c.filter((_, i) => i % step === 0 || i === c.length - 1); };

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
  if (!mapReady || !points || !points.length) return;
  const b = new maplibregl.LngLatBounds();
  points.forEach(p => b.extend([p[1], p[0]]));
  map.fitBounds(b, { padding: 50, maxZoom: 13, duration: 600 });
}

// ---------------- ubicación ----------------
function locate(silent, fly = false) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Sin geolocalización'));
    navigator.geolocation.getCurrentPosition(pos => {
      S.here = [pos.coords.latitude, pos.coords.longitude];
      if (mapReady && (fly || (!S.loop && !S.gpx))) map.flyTo({ center: [S.here[1], S.here[0]], zoom: 11 });
      render(); resolve(S.here);
    }, err => { if (!silent) toast('No puedo leer tu ubicación. Toca el mapa para elegir la salida.', 4000); reject(err); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: fly ? 0 : 60000 });
  });
}

// ================= RUTA SORPRESA =================
const sOpts = () => ({ avoidHighways: $('sAvh').checked, avoidTolls: $('sAvt').checked });
const kmChosen = () => +$('kmIn').value || +segValue('kmSeg') || 100;

async function generate() {
  const km = kmChosen();
  if (km < 10 || km > 400) return toast('Elige entre 10 y 400 km');
  let start = S.start || S.here;
  if (!start) {
    busy($('sProg'), 'Buscando tu ubicación…');
    try { start = await locate(); } catch { busy($('sProg'), ''); return; }
  }
  const dir = +segValue('dirSeg'), my = ++S.busy;
  $('genBtn').disabled = $('againBtn').disabled = true;
  S.towns = null; $('towns').classList.add('hidden'); store.set('km', km);
  try {
    const prog = m => my === S.busy && busy($('sProg'), m);
    let plan;
    if (segValue('curveSeg') === '1') {
      try { plan = await P.planSurpriseCurvy(start, km, dir, sOpts(), router, { overpass: OVERPASS }, prog); }
      catch (e) { console.warn(e); toast('No he podido descargar las carreteras de la zona: ruta sin buscar curvas.', 4000); }
    }
    if (!plan) plan = await P.planSurprise(start, km, dir, sOpts(), router, prog);
    if (my !== S.busy) return;
    S.loop = { ...plan, exact: true };
  } catch (e) {
    if (my !== S.busy) return;
    console.warn(e);
    const r = G.surpriseLoop(start, km, dir);
    S.loop = { start, points: r.points, brg: r.brg, km, target: km, exact: false };
    toast(`No he podido calcular la ruta por carretera (${e.message}). Te dejo una aproximada.`, 6000);
  } finally {
    if (my === S.busy) { busy($('sProg'), ''); $('genBtn').disabled = $('againBtn').disabled = false; }
  }
  render(true);
}

async function dragLoopPoint(i, p) {
  S.loop.points[i] = p; S.towns = null;
  if (!S.loop.exact) return render();
  const my = ++S.busy; busy($('sProg'), 'Recalculando…');
  try {
    let r = await router.route([S.loop.start, ...S.loop.points, S.loop.start], sOpts(), { minClass: 'tertiary' });
    r = await P.fixSpurs(S.loop.start, r.stops, r, sOpts(), router, () => {});
    if (my !== S.busy) return;
    S.loop = { ...S.loop, points: r.points, route: r, km: r.km };
    if (S.loop.stretches) S.loop.curvy = curvyShareOf(r.shape, S.loop.stretches);
  } catch (e) { toast('No hay carretera ahí. Prueba en otro sitio.'); }
  finally { if (my === S.busy) busy($('sProg'), ''); }
  render();
}
const loopUrl = () => G.mapsUrl(useNamesFor('loop') || [...S.loop.points, S.loop.start], sOpts());

// ================= DESDE UN GPX =================
const gOpts = () => ({ avoidHighways: $('gAvh').checked, avoidTolls: $('gAvt').checked });

async function buildPlan() {
  if (!S.gpx) return;
  const maxLinks = +segValue('linksSeg'), per = +segValue('perSeg'), my = ++S.busy;
  S.towns = null; $('towns').classList.add('hidden');
  try {
    const plan = await P.planTrack(S.gpx.pts, { maxLinks, per, ...gOpts() }, router, m => my === S.busy && busy($('gProg'), m));
    if (my !== S.busy) return;
    S.plan = { ...plan, exact: true };
  } catch (e) {
    if (my !== S.busy) return;
    console.warn(e);
    S.plan = { ...G.routeFromTrack(S.gpx.pts, { mode: maxLinks === 1 ? 'one' : 'legs', kmPer: 7, per }), exact: false };
    toast(`No he podido comprobar la ruta (${e.message}). Te dejo los puntos sin comprobar.`, 6000);
  } finally { if (my === S.busy) busy($('gProg'), ''); }
  render(true);
}

async function dragTrackPoint(li, pi, p) {
  S.plan.legs[li].points[pi] = p; S.towns = null;
  if (!S.plan.exact) return render();
  const my = ++S.busy; busy($('gProg'), 'Recalculando…');
  try {
    const stops = S.plan.legs.flatMap(l => l.points);
    const r = await router.route([S.gpx.pts[0], ...stops], gOpts(), { minClass: 'residential', radius: 60 });
    if (my !== S.busy) return;
    const snapped = [...r.stops, stops[stops.length - 1]]; let k = 0;
    S.plan.legs.forEach(l => { l.points = l.points.map(() => snapped[k++]); });
    const cmp = G.compareRoute(S.gpx.pts, r.shape);
    S.plan = { ...S.plan, route: r, pct: cmp.pct, gaps: cmp.gaps, km: r.km };
  } catch (e) { toast('No hay carretera ahí. Prueba en otro sitio.'); }
  finally { if (my === S.busy) busy($('gProg'), ''); }
  render();
}

function loadText(text, filename, title) {
  try {
    const g = G.parseGpx(text);
    S.gpx = { name: title || g.name || filename.replace(/\.gpx$/i, ''), pts: g.pts };
    S.plan = null;
    $('drop').classList.add('has'); $('fname').textContent = filename;
    render(true);
    buildPlan();
  } catch (e) { toast(e.message, 4000); }
}
function loadFile(file) {
  if (!file) return;
  const rd = new FileReader();
  rd.onload = () => loadText(rd.result, file.name);
  rd.readAsText(file);
}

// ================= COMUNIDAD =================
// Las rutas viven en el propio repositorio: rutas/index.json + un .gpx por ruta.
function repoSlug() {
  const h = location.hostname;
  if (h.endsWith('.github.io')) return `${h.split('.')[0]}/${location.pathname.split('/')[1] || h}`;
  return 'Ruben-BL/rutalibre';
}
let community = null;
async function loadCommunity() {
  if (community) return render(true);
  $('commMsg').textContent = 'Cargando rutas…';
  try {
    const res = await fetch('rutas/index.json', { cache: 'no-cache' });
    community = res.ok ? await res.json() : [];
  } catch { community = []; }
  if (S.tab === 'comunidad') render(true);
}
function communityFiltered() {
  const q = $('commSearch').value.trim().toLowerCase();
  const norm = t => (t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const list = (community || []).filter(r => !q || norm(`${r.nombre} ${r.zona} ${r.autor}`).includes(norm(q)));
  if (S.here) list.forEach(r => { r._dist = r.inicio ? G.haversine(S.here, r.inicio) / 1000 : Infinity; });
  return S.here ? list.sort((a, b) => a._dist - b._dist) : list;
}
function renderCommunity(fitView) {
  setLine('track', null); setLine('route', null); setLine('guide', null); setMulti('curvy', null);
  const list = communityFiltered(), box = $('commList'); box.innerHTML = '';
  $('commMsg').textContent = !community ? '' : !community.length
    ? 'Todavía no hay rutas. ¡Sé el primero en proponer una!'
    : !list.length ? 'Ninguna ruta coincide con la búsqueda.' : `${list.length} ${list.length === 1 ? 'ruta' : 'rutas'}${S.here ? ', las más cercanas primero' : ''}.`;
  list.forEach((r, i) => {
    const div = document.createElement('div'); div.className = 'croute';
    const dist = r._dist != null && isFinite(r._dist) ? ` · a ${Math.round(r._dist)} km de ti` : '';
    div.innerHTML = `<span class="n">${i + 1}</span><div class="info"><div class="t"></div><div class="m"></div><div class="d"></div></div>`;
    div.querySelector('.t').textContent = r.nombre;
    div.querySelector('.m').textContent = `${r.zona} · ${r.km} km${dist}${r.autor ? ' · por ' + r.autor : ''}`;
    div.querySelector('.d').textContent = r.descripcion || '';
    const b = document.createElement('button'); b.textContent = 'Abrir'; b.onclick = () => openCommunity(r);
    div.append(b); box.append(div);
    if (r.inicio) addMarker(r.inicio, i + 1, 'comm');
  });
  if (fitView && list.length) fit(list.filter(r => r.inicio).map(r => r.inicio));
}
async function openCommunity(r) {
  try {
    const res = await fetch(r.archivo);
    if (!res.ok) throw new Error('No encuentro el archivo de la ruta');
    const text = await res.text();
    switchTab('gpx');
    loadText(text, r.archivo.split('/').pop(), r.nombre);
  } catch (e) { toast(e.message, 4000); }
}
const planStops = () => S.plan.legs.flatMap(l => l.points);

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
  const out = { name: a.village || a.town || a.city || a.municipality || a.hamlet || a.suburb || '', province: a.province || a.county || a.state || '' };
  geoCache.set(key, out); await sleep(1100);
  return out;
}
async function showTowns(kind) {
  const pts = kind === 'loop' ? [S.loop.start, ...S.loop.points, S.loop.start] : [S.plan.start, ...planStops()];
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
  clearMarkers();
  if (S.tab === 'sorpresa') return renderLoop(fitView);
  if (S.tab === 'comunidad') return renderCommunity(fitView);
  return renderGpx(fitView);
}

function renderLoop(fitView) {
  setLine('track', null);
  const start = S.start || (S.loop ? S.loop.start : S.here);
  setMulti('curvy', S.loop && S.loop.stretches);
  if (!S.loop) { setLine('route', null); setLine('guide', null); if (start) addMarker(start, '●', 'start'); return; }
  const L = S.loop;
  const moved = G.haversine(start, L.start) > 50;   // salida cambiada después de generar
  if (L.route) { setLine('route', L.route.shape); setLine('guide', null); }
  else { setLine('route', null); setLine('guide', [L.start, ...L.points, L.start]); }
  L.points.forEach((p, i) => addMarker(p, i + 1, '', null, np => dragLoopPoint(i, np)));
  addMarker(start, '●', 'start');
  $('sOut').classList.remove('hidden');
  $('sStats').innerHTML = L.exact
    ? `Vuelta de <b>${Math.round(L.km)} km</b> por carretera, hacia el ${G.compass(L.brg)} · ${L.points.length} puntos de paso.`
      + (L.curvy == null ? '' : L.curvy < 0.03
        ? '<br>🌀 Por esta zona no he encontrado carreteras reviradas.'
        : `<br>🌀 <b>${Math.round(L.curvy * 100)}%</b> en carretera revirada${L.roads && L.roads.length ? ' · pasa por ' + L.roads.slice(0, 4).join(', ') : ''}.`)
    : `Vuelta de <b>~${L.target} km</b> hacia el ${G.compass(L.brg)} (aproximada) · ${L.points.length} puntos de paso.`;
  if (moved) $('sStats').innerHTML += '<br><b>Has cambiado la salida:</b> pulsa «Generar ruta» para crear una vuelta desde allí.';
  $('sGo').href = loopUrl();
  if (fitView) fit(L.route ? L.route.shape : [L.start, ...L.points]);
}

function renderGpx(fitView) {
  setLine('guide', null); setMulti('curvy', null);
  if (!S.gpx) { setLine('track', null); setLine('route', null); return; }
  setLine('track', S.gpx.pts);
  if (!S.plan) { setLine('route', null); if (fitView) fit(S.gpx.pts); return; }
  setLine('route', S.plan.route ? S.plan.route.shape : null);
  addMarker(S.plan.start, '●', 'start');
  const names = useNamesFor('gpx'); let n = 0, ni = 0;
  const legsBox = $('legs'); legsBox.innerHTML = '';
  S.plan.legs.forEach((leg, li) => {
    const color = LEG_COLORS[li % LEG_COLORS.length];
    leg.points.forEach((p, pi) => { n++; addMarker(p, n, '', color, np => dragTrackPoint(li, pi, np)); });
    const stops = names ? names.slice(ni, ni + leg.points.length) : leg.points; ni += leg.points.length;
    const many = S.plan.legs.length > 1;
    const div = document.createElement('div'); div.className = 'leg';
    div.innerHTML = `<span class="dot" style="background:${color}"></span><div class="info"><div class="t">${many ? 'Tramo ' + (li + 1) : 'Ruta completa'}</div><div class="d">km ${leg.fromKm.toFixed(0)} → ${leg.toKm.toFixed(0)} · ${leg.points.length} puntos</div></div>`;
    const a = document.createElement('a'); a.href = G.mapsUrl(stops, gOpts()); a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Abrir en Maps';
    div.append(a); legsBox.append(div);
  });
  $('gOut').classList.remove('hidden');
  const nl = S.plan.legs.length;
  let html = `<b>${S.gpx.name}</b> · ${S.plan.total.toFixed(1)} km · ${n} puntos · ${nl === 1 ? '1 enlace' : nl + ' enlaces'}`;
  if (S.plan.exact) {
    const pct = Math.round(S.plan.pct * 100), cls = pct >= 95 ? 'good' : pct >= 85 ? 'mid' : 'bad';
    html += `<br><span class="pct ${cls}">Coincidencia con tu ruta: ${pct}%</span>`;
    if (pct < 95 && +segValue('linksSeg') < 3) html += '<br>Para más precisión, permite un enlace más (o arrastra el punto más cercano al tramo azul que se separa del rojo).';
  } else html += '<br><span class="pct mid">Sin comprobar contra carreteras</span>';
  if (nl > 1) html += '<br>Consejo: haz que el cambio de enlace caiga en tu parada para comer.';
  $('gStats').innerHTML = html;
  if (fitView) fit(S.gpx.pts);
}

// ---------------- eventos ----------------
function switchTab(t) {
  S.tab = t;
  document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('tab-sorpresa').classList.toggle('hidden', t !== 'sorpresa');
  $('tab-gpx').classList.toggle('hidden', t !== 'gpx');
  $('tab-comunidad').classList.toggle('hidden', t !== 'comunidad');
  $('towns').classList.add('hidden');
  if (t === 'comunidad') loadCommunity();
  render(true);
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });

bindSeg('kmSeg', () => { $('kmIn').value = ''; });
$('kmIn').addEventListener('input', () => $('kmSeg').querySelectorAll('button').forEach(b => b.classList.remove('on')));
bindSeg('dirSeg');
bindSeg('curveSeg', v => store.set('curvy', v));
bindSeg('linksSeg', buildPlan);
bindSeg('perSeg', buildPlan);
['sAvh', 'sAvt'].forEach(id => $(id).addEventListener('change', () => { store.set(id, $(id).checked); if (S.loop) generate(); }));
['gAvh', 'gAvt'].forEach(id => $(id).addEventListener('change', () => { store.set(id, $(id).checked); buildPlan(); }));
$('useNames').addEventListener('change', () => render());

$('genBtn').onclick = generate;
$('againBtn').onclick = generate;
$('locateBtn').onclick = backToHere;
$('sShare').onclick = async () => {
  const url = loopUrl();
  try {
    if (navigator.share) await navigator.share({ title: 'Ruta en moto', text: `Vuelta de ${Math.round(S.loop.km)} km`, url });
    else { await navigator.clipboard.writeText(url); toast('Enlace copiado'); }
  } catch { /* cancelado */ }
};
$('sTowns').onclick = () => showTowns('loop');
$('gTowns').onclick = () => showTowns('gpx');
$('sWpt').onclick = () => download(G.gpxWaypoints([S.loop.start, ...S.loop.points, S.loop.start], 'Sorpresa', ['Salida', ...S.loop.points.map(() => ''), 'Destino']), `sorpresa_${Math.round(S.loop.km)}km_puntos.gpx`);
$('sTrack').onclick = () => S.loop.route ? download(G.gpxTrack(S.loop.route.shape, `Sorpresa ${Math.round(S.loop.km)} km`), `sorpresa_${Math.round(S.loop.km)}km_track.gpx`) : toast('Primero genera una ruta comprobada');
$('gWpt').onclick = () => { const p = [S.plan.start, ...planStops()]; download(G.gpxWaypoints(p, 'Ruta', ['Salida', ...p.slice(2).map(() => ''), 'Destino']), slug(S.gpx.name) + '_puntos.gpx'); };
$('gTrack').onclick = () => download(G.gpxTrack(S.gpx.pts, S.gpx.name), slug(S.gpx.name) + '_track.gpx');
$('copyTowns').onclick = async () => {
  if (!S.towns) return;
  const txt = S.towns.names.map((t, i) => `${i + 1}. ${t.name || '(sin pueblo)'} — ${t.coord}`).join('\n');
  try { await navigator.clipboard.writeText(txt); toast('Lista copiada'); } catch { toast('No se pudo copiar'); }
};

$('file').addEventListener('change', e => loadFile(e.target.files[0]));
$('commSearch').addEventListener('input', () => render());
$('proposeBtn').href = `https://github.com/${repoSlug()}/issues/new?template=nueva-ruta.yml`;
const drop = $('drop');
['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('has'); }));
drop.addEventListener('drop', e => { e.preventDefault(); loadFile(e.dataTransfer.files[0]); });

// preferencias guardadas en este dispositivo
['sAvh', 'sAvt', 'gAvh', 'gAvt'].forEach(id => { const v = store.get(id, null); if (v !== null) $(id).checked = v; });
const savedCurvy = store.get('curvy', null);
if (savedCurvy !== null) $('curveSeg').querySelectorAll('button').forEach(x => x.classList.toggle('on', x.dataset.v === savedCurvy));
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
