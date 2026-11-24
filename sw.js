/* FabianApp service worker: app disponible sin señal + caché de teselas del mapa */
const APP = 'fabianapp-app-v1';
const TILES = 'fabianapp-tiles';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'vendor/proj4.js',
  'vendor/leaflet/images/layers.png', 'vendor/leaflet/images/layers-2x.png', 'vendor/leaflet/images/marker-icon.png', 'vendor/leaflet/images/marker-icon-2x.png', 'vendor/leaflet/images/marker-shadow.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon.png', 'icons/apple-touch-icon.png'];
const TILE_HOSTS = ['tile.opentopomap.org', 'server.arcgisonline.com', 'tile.openstreetmap.org'];
const MAX_TILES = 20000;

self.addEventListener('install', e => { e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

let puts = 0;
async function trim() {
  const c = await caches.open(TILES), keys = await c.keys();
  if (keys.length > MAX_TILES) for (const k of keys.slice(0, keys.length - MAX_TILES)) await c.delete(k);
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith((async () => {
      const c = await caches.open(TILES), hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') { c.put(req.url, res.clone()); if (++puts % 200 === 0) trim(); }
        return res;
      } catch (err) { return new Response('', { status: 504 }); }
    })());
    return;
  }
  if (url.origin === location.origin) {
    // Caché primero (abre rápido aunque no haya señal) y se actualiza en segundo plano
    e.respondWith(caches.open(APP).then(async c => {
      const hit = await c.match(req, { ignoreSearch: true });
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || (await c.match('index.html')) || new Response('Sin conexión', { status: 503 });
    }));
  }
});
