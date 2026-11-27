const CACHE = 'rumbo-5';
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.1/dist/';
const ARCHIVOS = ['./', 'estilo.css', 'app.js', 'logica.js', 'fuentes.js', 'manifest.webmanifest', 'icono-180.png', `${MAPLIBRE}maplibre-gl.js`, `${MAPLIBRE}maplibre-gl.css`];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS))));

self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((claves) => Promise.all(
  claves.filter((c) => c.startsWith('rumbo-') && c !== CACHE).map((c) => caches.delete(c)),
))));

// Red primero para recibir cambios; la copia local solo se usa sin conexión.
self.addEventListener('fetch', (e) => {
  const { url, method } = e.request;
  if (method !== 'GET' || !(url.startsWith(self.registration.scope) || url.startsWith(MAPLIBRE))) return;
  e.respondWith(fetch(e.request).then(async (r) => {
    if (r.ok) await caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
    return r;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) ?? Response.error()));
});
