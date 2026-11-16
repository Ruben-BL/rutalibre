// RutaLibre — service worker mínimo.
// Primero intenta la red (para recibir siempre la última versión) y, si no hay conexión,
// sirve la copia guardada de la propia aplicación. El mapa y Nominatim no se guardan.
const CACHE = 'rutalibre-v4';
const SHELL = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/geo.js', 'js/router.js', 'js/planner.js', 'js/curves.js',
  'vendor/maplibre-gl.js', 'vendor/maplibre-gl.css', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'manifest.webmanifest'];

self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // solo nuestros archivos
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request)));
});
