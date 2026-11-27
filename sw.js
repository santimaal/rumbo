const CACHE = 'rumbo-9';
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.1/dist/';
const ARCHIVOS = ['./', 'estilo.css', 'app.js', 'logica.js', 'fuentes.js', 'manifest.webmanifest', 'icono-180.png', `${MAPLIBRE}maplibre-gl.js`, `${MAPLIBRE}maplibre-gl.css`];

// cache: 'reload' salta la caché HTTP para no guardar los archivos de la versión anterior.
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((a) => new Request(a, { cache: 'reload' }))))));

self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((claves) => Promise.all(
  claves.filter((c) => c.startsWith('rumbo-') && c !== CACHE).map((c) => caches.delete(c)),
)).then(() => self.clients.claim())));

// La versión nueva espera hasta que la app pide actualizar, para no cambiarla a mitad de uso.
self.addEventListener('message', (e) => {
  if (e.data === 'actualizar') self.skipWaiting();
});

// Red primero para recibir cambios; la copia local solo se usa sin conexión.
self.addEventListener('fetch', (e) => {
  const { url, method } = e.request;
  if (method !== 'GET' || !(url.startsWith(self.registration.scope) || url.startsWith(MAPLIBRE))) return;
  e.respondWith(fetch(e.request).then(async (r) => {
    if (r.ok) await caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
    return r;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) ?? Response.error()));
});
