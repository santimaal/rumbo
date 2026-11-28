const CACHE = 'rumbo-21';
const MAPLIBRE = 'https://unpkg.com/maplibre-gl@5.24.1/dist/';
const QR = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
const ARCHIVOS = ['./', 'estilo.css', 'app.js', 'logica.js', 'fuentes.js', 'novedades.js', 'manifest.webmanifest', 'icono-180.png', `${MAPLIBRE}maplibre-gl.js`, `${MAPLIBRE}maplibre-gl.css`];

// cache: 'reload' salta la caché HTTP para no guardar los archivos de la versión anterior.
self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS.map((a) => new Request(a, { cache: 'reload' }))))));

self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((claves) => Promise.all(
  claves.filter((c) => c.startsWith('rumbo-') && c !== CACHE && c !== MAPAS).map((c) => caches.delete(c)),
)).then(() => self.clients.claim())));

// La versión nueva espera hasta que la app pide actualizar, para no cambiarla a mitad de uso.
self.addEventListener('message', (e) => {
  if (e.data === 'actualizar') self.skipWaiting();
});

// El mapa y las fotos que se descargaron para usar sin conexión. Las teselas no cambian nunca (su dirección
// lleva la fecha del mapa): se sirven de lo guardado aunque haya red. Lo demás, de la red y si falla, de lo guardado.
const MAPAS = 'rumbo-mapas';
const GUARDABLES = ['https://tiles.openfreemap.org/', 'https://upload.wikimedia.org/', 'https://thumb.wikimedia.org/'];
async function sinConexion(peticion) {
  const guardada = await caches.match(peticion, { cacheName: MAPAS, ignoreSearch: true });
  if (guardada && /\/\d+\/\d+\/\d+\.pbf$/.test(peticion.url)) return guardada;
  try {
    return await fetch(peticion);
  } catch {
    return guardada ?? Response.error();
  }
}

// Red primero para recibir cambios; la copia local solo se usa sin conexión.
self.addEventListener('fetch', (e) => {
  const { url, method } = e.request;
  if (method === 'GET' && GUARDABLES.some((g) => url.startsWith(g))) {
    e.respondWith(sinConexion(e.request));
    return;
  }
  if (method !== 'GET' || !(url.startsWith(self.registration.scope) || url.startsWith(MAPLIBRE) || url === QR)) return;
  e.respondWith(fetch(e.request).then(async (r) => {
    if (r.ok) await caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
    return r;
  }).catch(async () => (await caches.match(e.request, { ignoreSearch: true })) ?? Response.error()));
});
