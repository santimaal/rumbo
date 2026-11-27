import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readdir, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';

const hoy = new Date().toLocaleDateString('sv');
const lugar = (id, nombre, lat, lon, dia, extra = {}) => ({ id, nombre, lat, lon, dia, foto: '', autoria: '', ...extra });
const ROMA = { lat: 41.89, lon: 12.49, radio: 15, pais: '' };
const viaje = (extra) => ({ id: 'roma', nombre: 'Roma', destino: 'Roma, Italia', pais: 'IT', zona: ROMA, dias: 2, lugares: [], hoteles: [], ...extra });

// Los servicios de fuera responden con datos fijos para que las pruebas no dependan de la red.
async function sinRed(page, { horarios = [] } = {}) {
  await page.route(/^https?:\/\/(?!localhost)/, (route) => {
    const url = new URL(route.request().url());
    const json = (cuerpo) => route.fulfill({ json: cuerpo });
    if (url.host === 'api.open-meteo.com') {
      const desde = new Date(`${url.searchParams.get('start_date')}T12:00:00Z`);
      const hasta = new Date(`${url.searchParams.get('end_date')}T12:00:00Z`);
      const time = [];
      for (let d = desde; d <= hasta; d = new Date(d.getTime() + 864e5)) time.push(d.toISOString().slice(0, 10));
      return json({ daily: { time, weather_code: time.map(() => 61), temperature_2m_max: time.map(() => 24.4), temperature_2m_min: time.map(() => 15), precipitation_probability_max: time.map(() => 70) } });
    }
    if (url.host === 'geocoding-api.open-meteo.com') {
      return json({ results: [{ name: 'Roma', country: 'Italia', country_code: 'IT', feature_code: 'PPLC', latitude: 41.89, longitude: 12.49, population: 2e6 }] });
    }
    if (url.host === 'routing.openstreetmap.de') {
      // En coche cada tramo son 8 km y 15 min; andando, 600 m y 8 min.
      const coche = url.pathname.includes('routed-car');
      const piernas = url.pathname.split('/').at(-1).split(';').length - 1;
      const pierna = coche ? { distance: 8000, duration: 900 } : { distance: 600, duration: 480 };
      const legs = Array.from({ length: piernas }, () => pierna);
      return json({ routes: [{ distance: pierna.distance * piernas, duration: pierna.duration * piernas, geometry: '_p~iF~ps|U_ulLnnqC', legs }] });
    }
    if (url.host === 'overpass-api.de') return json({ elements: horarios });
    if (url.host === 'www.wikidata.org') return json({ query: { pages: [] }, entities: {} });
    if (url.host === 'photon.komoot.io') return json({ features: [] });
    return route.abort();
  });
}

async function sembrar(page, viajes) {
  await page.addInitScript((datos) => {
    if (sessionStorage.getItem('sembrado')) return;
    localStorage.setItem('rumbo', JSON.stringify({ viajes: datos }));
    sessionStorage.setItem('sembrado', '1');
  }, viajes);
}

const guardados = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('rumbo')).viajes);

test('la portada muestra la bandera y los ajustes cambian el tema', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje(), viaje({ id: 'viejo', nombre: 'Lisboa', destino: 'Roma, Italia', pais: '' })]);
  await page.goto('/');
  await expect(page.locator('.viaje').first().locator('.bandera')).toHaveText('🇮🇹');
  // El viaje sin país lo busca por su destino.
  await expect(page.locator('.viaje').nth(1).locator('.bandera')).toHaveText('🇮🇹');

  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByRole('button', { name: 'Exportar copia' })).toBeVisible();
  await page.getByLabel('Apariencia').selectOption('oscuro');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(14, 24, 29)');
  await page.getByLabel('Apariencia').selectOption('claro');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.getByLabel('Abrir lugares y rutas en').selectOption('waze');
  expect(await page.evaluate(() => localStorage.getItem('rumbo-mapas'))).toBe('waze');
});

test('al abrir ajustes no se despliega ningún selector', async ({ page }) => {
  await sinRed(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByRole('heading', { name: 'Ajustes' })).toBeFocused();
  await expect(page.getByLabel('Apariencia')).not.toBeFocused();
});

test('con Waze, los lugares y los tramos en coche se abren en Waze', async ({ page }) => {
  await sinRed(page);
  await page.addInitScript(() => localStorage.setItem('rumbo-mapas', 'waze'));
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Ostia Antica', 41.7558, 12.2916, 1)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Coliseo' })).toHaveAttribute('href', /^https:\/\/waze\.com\/ul\?/);
  await expect(page.locator('.dia').first().locator('a.ruta')).toHaveAttribute('href', /^https:\/\/waze\.com\/ul\?ll=41\.7558,12\.2916&navigate=yes/);
});

test('consejos por categoría con buscador que tolera erratas', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ consejos: [
    { tipo: 'comida', texto: 'Cacio e pepe en Trastevere' },
    { tipo: 'evitar', texto: 'No compres agua junto al Coliseo' },
    { tipo: 'transporte', texto: 'Billete de metro antes de subir' },
  ] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  // Los consejos tienen su propia pantalla; la del viaje queda para el mapa y las rutas.
  await expect(page.getByText('Cacio e pepe en Trastevere')).toHaveCount(0);
  await page.getByRole('button', { name: /Notas y consejos/ }).click();
  await expect(page.getByRole('heading', { name: 'Notas y consejos' })).toBeVisible();
  await page.getByRole('button', { name: '+ Consejo' }).click();
  await page.getByLabel('Tipo').selectOption('dinero');
  await page.getByLabel('Consejo', { exact: true }).fill('La propina no es obligatoria en los restaurantes');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: '💶 Dinero y propinas' })).toBeVisible();

  await page.getByLabel('Buscar en los consejos').fill('restaurnte');
  await expect(page.locator('.consejos .nota:visible')).toHaveText(['La propina no es obligatoria en los restaurantes']);
  await page.getByLabel('Buscar en los consejos').fill('taxi');
  await expect(page.getByText('Ningún consejo se parece a eso.')).toBeVisible();
  await page.getByRole('button', { name: '‹ Roma' }).click();
  await expect(page.getByRole('button', { name: /Notas y consejos.*4 consejos/ })).toBeVisible();
});

test('cada día muestra ruta real, tiempo y horarios', async ({ page }) => {
  await sinRed(page, { horarios: [
    { type: 'node', lat: 41.8902, lon: 12.4922, tags: { name: 'Colosseo', 'name:es': 'Coliseo', opening_hours: '09:00-19:00' } },
    { type: 'way', center: { lat: 41.8986, lon: 12.4769 }, tags: { name: 'Pantheon', 'name:es': 'Panteón', opening_hours: 'Mo-Su off' } },
  ] });
  // Hotel lejos del centro: se va en coche al Coliseo y de ahí andando al Panteón.
  await sembrar(page, [viaje({ fecha: hoy, hoteles: [{ nombre: 'Hotel Ostia', lat: 41.7558, lon: 12.2916, desde: 1 }],
    lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Panteón', 41.8986, 12.4769, 1)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  const dia1 = page.locator('.dia').first();
  await expect(dia1).toContainText('🚗 16 km (30 min) + 🚶 600 m (8 min)');
  await expect(dia1.locator('.parada', { hasText: 'Coliseo' }).locator('.tramo')).toHaveText('🚗 15 min · 8 km');
  await expect(dia1.locator('.parada', { hasText: 'Panteón' }).locator('.tramo')).toHaveText('🚶 8 min · 600 m');
  // La línea del tramo no puede tapar el nombre de la parada.
  const panteon = dia1.locator('.parada', { hasText: 'Panteón' });
  const tramo = await panteon.locator('.tramo').boundingBox();
  const nombre = await panteon.locator('.titulo').boundingBox();
  expect(tramo.y + tramo.height).toBeLessThanOrEqual(nombre.y);
  await expect(dia1.locator('a.ruta')).toHaveText(['🚗 Ruta 1', '🚶 Ruta 2', '🚗 Ruta 3']);
  await expect(dia1).toContainText('🌧️ 24°/15° lluvia, 70% lluvia');
  await expect(dia1).toContainText('Ese día abre 09:00–19:00');
  await expect(dia1).toContainText('⚠ Cerrado ese día');
});

test('arrastrar una parada la mueve a otro día', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Panteón', 41.8986, 12.4769, 2)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  const asa = page.getByRole('button', { name: 'Arrastrar Coliseo' });
  const destino = page.locator('.parada', { hasText: 'Panteón' });
  // Centrada para que no quede debajo de la barra fija de abajo.
  await asa.evaluate((e) => e.scrollIntoView({ block: 'center' }));
  const a = await asa.boundingBox();
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  // Cerca del borde inferior la página baja sola hasta el día 2.
  await page.mouse.move(a.x + 100, page.viewportSize().height - 20, { steps: 5 });
  await expect.poll(() => destino.boundingBox().then((c) => c.y + c.height <= page.viewportSize().height)).toBe(true);
  const b = await destino.boundingBox();
  await page.mouse.move(b.x + 100, b.y + b.height - 5, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await guardados(page))[0].lugares.map((l) => `${l.nombre}:${l.dia}`)).toEqual(['Panteón:2', 'Coliseo:2']);
  await expect(page.locator('.dia').nth(1)).toContainText('Coliseo');
});

test('un viaje compartido por enlace se puede añadir en otro móvil', async ({ page, browser }) => {
  await sinRed(page);
  await page.addInitScript(() => { navigator.share = async ({ url }) => { window.compartido = url; }; });
  await sembrar(page, [viaje({ consejos: [{ tipo: 'comida', texto: 'Supplì en Trastevere' }], lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await page.getByRole('button', { name: 'Compartir viaje' }).click();
  const url = await page.waitForFunction(() => window.compartido).then((h) => h.jsonValue());
  expect(url).toMatch(/#viaje=[\w-]+$/);

  const otro = await browser.newPage();
  await sinRed(otro);
  otro.on('dialog', (d) => d.accept());
  await otro.goto(url);
  await expect(otro.getByRole('heading', { name: 'Roma' })).toBeVisible();
  await expect(otro.getByRole('button', { name: /Notas y consejos.*1 consejo/ })).toBeVisible();
  await expect(otro.getByRole('link', { name: 'Coliseo' })).toBeVisible();
  expect(new URL(otro.url()).hash).toBe('');
});

test('lo compartido desde otra app abre el formulario de lugares', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje(), viaje({ id: 'lis', nombre: 'Lisboa', destino: 'Lisboa, Portugal', pais: 'PT' })]);
  const texto = 'Lo mejor de Lisboa\n📍 Miradouro da Graça\n📍 Time Out Market https://www.instagram.com/reel/abc';
  await page.goto(`/?compartir&${new URLSearchParams({ texto })}`);
  await page.getByRole('dialog').getByRole('button', { name: /Lisboa/ }).click();
  await page.getByRole('button', { name: /Buscar lugares/ }).click();
  await expect(page.getByRole('heading', { name: 'Añadir lugares' })).toBeVisible();
  await expect(page.getByLabel('Enlace del reel o TikTok (opcional)')).toHaveValue('https://www.instagram.com/reel/abc');
  await expect(page.getByLabel('Texto de la publicación')).toHaveValue(/📍 Miradouro da Graça/);
  await expect(page.locator('h1')).toHaveText('Lisboa');
});

// Playwright no intercepta las peticiones del propio service worker: se sirve una copia cuyo sw.js se puede cambiar.
async function copiaServida() {
  const dir = await mkdtemp(join(tmpdir(), 'rumbo-'));
  for (const f of await readdir('.')) if (/\.(html|js|css|webmanifest|png)$/.test(f)) await cp(f, join(dir, f));
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  const servidor = createServer(async (req, res) => {
    const ruta = new URL(req.url, 'http://x').pathname.slice(1) || 'index.html';
    try {
      const cuerpo = await readFile(join(dir, ruta));
      res.writeHead(200, { 'content-type': tipos[extname(ruta)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(cuerpo);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((r) => { servidor.listen(0, r); });
  const original = await readFile('sw.js', 'utf8');
  return {
    url: `http://localhost:${servidor.address().port}/`,
    // Sin maplibre en la lista: la prueba no debe depender de unpkg.
    version: (n) => writeFile(join(dir, 'sw.js'), original.replace(/rumbo-\d+/, `rumbo-${n}`).replace(/, `\$\{MAPLIBRE\}[^`]+`/g, '')),
    cerrar: () => new Promise((r) => { servidor.close(r); }),
  };
}

test('avisa de una versión nueva y la aplica sin reinstalar', async ({ browser }) => {
  const copia = await copiaServida();
  const contexto = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await contexto.newPage();
  await sinRed(page);
  try {
    await copia.version(6);
    await page.goto(copia.url);
    await page.waitForFunction(() => navigator.serviceWorker.controller);
    await expect(page.locator('#actualizacion')).toBeHidden();

    await copia.version(7);
    await page.getByRole('button', { name: 'Ajustes' }).click();
    await page.getByRole('button', { name: 'Buscar actualizaciones' }).click();
    await expect(page.getByText('Hay una versión nueva de Rumbo.')).toBeVisible();
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Actualizar' }).click()]);
    await expect.poll(() => page.evaluate(() => caches.keys())).toEqual(['rumbo-7']);
    await expect(page.locator('#actualizacion')).toBeHidden();

    await page.getByRole('button', { name: 'Ajustes' }).click();
    await expect(page.getByText('Versión 7')).toBeVisible();
  } finally {
    await contexto.close();
    await copia.cerrar();
  }
});

test('un día se puede ocultar y volver a mostrar', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Panteón', 41.8986, 12.4769, 2)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  const dia1 = page.locator('.dia').first();
  await expect(dia1).toContainText('Coliseo');
  await page.getByRole('button', { name: 'Ocultar el día 1' }).click();
  await expect(dia1).toContainText('Oculto · 1 lugar');
  await expect(dia1).not.toContainText('Coliseo');
  await expect(page.locator('.dia').nth(1)).toContainText('Panteón');
  expect((await guardados(page))[0].ocultos).toEqual([1]);

  await page.reload();
  await page.getByText('Roma', { exact: true }).click();
  await expect(page.locator('.dia').first()).toContainText('Oculto');
  await page.getByRole('button', { name: 'Mostrar el día 1' }).click();
  await expect(page.locator('.dia').first()).toContainText('Coliseo');
  expect((await guardados(page))[0].ocultos).toEqual([]);
});

test('el botón Ir y el selector de día miden lo mismo', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  const fila = page.locator('.parada', { hasText: 'Coliseo' }).locator('.fila');
  const ir = await fila.getByRole('link', { name: 'Ir' }).boundingBox();
  const selector = await fila.locator('select').boundingBox();
  expect(selector.height).toBe(ir.height);
  expect(await fila.locator('select').evaluate((e) => getComputedStyle(e).appearance)).toBe('none');
});

test('el botón de atrás del navegador vuelve a la pantalla anterior', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ consejos: [{ tipo: 'comida', texto: 'Supplì' }] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await page.getByRole('button', { name: /Notas y consejos/ }).click();
  await expect(page.getByRole('heading', { name: 'Notas y consejos' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Roma' })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Rumbo' })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Roma' })).toBeVisible();
  // El botón ‹ de la app hace lo mismo y no apila pantallas.
  await page.getByRole('button', { name: '‹ Viajes' }).click();
  await expect(page.getByRole('heading', { name: 'Rumbo' })).toBeVisible();
});

// Toques reales por CDP: Playwright no tiene un gesto de deslizar.
async function deslizar(page, desde, hasta, pasos = 8) {
  const cdp = await page.context().newCDPSession(page);
  const tocar = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y: 400 }] });
  await tocar('touchStart', desde);
  for (let i = 1; i <= pasos; i++) await tocar('touchMove', desde + ((hasta - desde) * i) / pasos);
  await tocar('touchEnd', hasta);
}

test.describe('instalada en el móvil', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('deslizar desde el borde izquierdo va atrás', async ({ page }) => {
    await sinRed(page);
    await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
    await sembrar(page, [viaje()]);
    await page.goto('/');
    await page.getByText('Roma', { exact: true }).click();
    await page.getByRole('button', { name: /Notas y consejos/ }).click();

    // Un deslizamiento corto no cuenta, aunque sea rápido.
    await deslizar(page, 5, 35);
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Notas y consejos' })).toBeVisible();
    // Empezar lejos del borde tampoco.
    await deslizar(page, 150, 380);
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Notas y consejos' })).toBeVisible();

    await deslizar(page, 5, 300);
    await expect(page.getByRole('heading', { name: 'Roma' })).toBeVisible();
    await deslizar(page, 5, 300);
    await expect(page.getByRole('heading', { name: 'Rumbo' })).toBeVisible();
    await expect(page.locator('#vista')).toHaveAttribute('style', /transform: none|^$|transform: ;/);
  });
});

test('volver a compartir un viaje actualiza la copia de la otra persona', async ({ page, browser }) => {
  await sinRed(page);
  await page.addInitScript(() => { navigator.share = async ({ url }) => { window.compartido = url; }; });
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1)] })]);
  const compartir = async () => {
    await page.evaluate(() => { window.compartido = null; });
    await page.getByRole('button', { name: 'Compartir viaje' }).click();
    return page.waitForFunction(() => window.compartido).then((h) => h.jsonValue());
  };
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  const primero = await compartir();

  const otro = await browser.newPage();
  await sinRed(otro);
  const preguntas = [];
  otro.on('dialog', (d) => { preguntas.push(d.message()); d.accept(); });
  await otro.goto(primero);
  await expect(otro.getByRole('heading', { name: 'Roma' })).toBeVisible();

  // Quien lo compartió añade un consejo y vuelve a mandar el enlace.
  await page.getByRole('button', { name: /Notas y consejos/ }).click();
  await page.getByRole('button', { name: '+ Consejo' }).click();
  await page.getByLabel('Consejo', { exact: true }).fill('Reservar el Coliseo con antelación');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.getByRole('button', { name: '‹ Roma' }).click();
  const segundo = await compartir();

  await otro.goto(segundo);
  await expect(otro.getByRole('button', { name: /Notas y consejos.*1 consejo/ })).toBeVisible();
  expect(preguntas.at(-1)).toContain('Ya tienes «Roma»');
  expect((await guardados(otro)).length).toBe(1);
});

test('por defecto los lugares y las rutas se abren en Google Maps', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Panteón', 41.8986, 12.4769, 1)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Coliseo' })).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\//);
  await expect(page.locator('a.ruta').first()).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/dir\//);
  await page.getByRole('button', { name: '‹ Viajes' }).click();
  await page.getByRole('button', { name: 'Ajustes' }).click();
  await expect(page.getByLabel('Abrir lugares y rutas en')).toHaveValue('google');
});

test('un reel se puede guardar como consejo con su enlace', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje()]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await page.getByRole('button', { name: 'Añadir', exact: true }).click();
  await page.getByLabel('Enlace del reel o TikTok (opcional)').fill('https://www.tiktok.com/@roma/video/123');
  await page.getByLabel('Texto de la publicación').fill('Dónde comer barato en Roma: supplì en Trastevere');
  await page.getByRole('button', { name: 'Guardar como consejo' }).click();

  await expect(page.getByRole('heading', { name: 'Nuevo consejo' })).toBeVisible();
  await expect(page.getByLabel('Consejo', { exact: true })).toHaveValue('Dónde comer barato en Roma: supplì en Trastevere');
  await expect(page.getByLabel('Enlace del vídeo (opcional)')).toHaveValue('https://www.tiktok.com/@roma/video/123');
  await page.getByLabel('Tipo').selectOption('comida');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await page.getByRole('button', { name: /Notas y consejos/ }).click();
  await expect(page.getByRole('link', { name: '▶ Ver vídeo' })).toHaveAttribute('href', 'https://www.tiktok.com/@roma/video/123');
  expect((await guardados(page))[0].consejos[0]).toMatchObject({ tipo: 'comida', enlace: 'https://www.tiktok.com/@roma/video/123' });
});

test('lo compartido se puede guardar como nota de un sitio del viaje', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Panteón', 41.8986, 12.4769, 1)] })]);
  await page.goto(`/?compartir&${new URLSearchParams({ texto: 'Entrad por la puerta de Via Sacra, hay menos cola https://www.tiktok.com/@roma/video/9' })}`);
  await page.getByRole('button', { name: /Nota de un sitio/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Coliseo/ }).click();
  await expect(page.getByRole('heading', { name: 'Nota de Coliseo' })).toBeVisible();
  await expect(page.locator('#form-nota textarea')).toHaveValue(/Via Sacra[\s\S]*tiktok\.com/);
  await page.locator('#form-nota').getByRole('button', { name: 'Guardar' }).click();
  const coliseo = (await guardados(page))[0].lugares.find((l) => l.id === 'a');
  expect(coliseo.nota).toContain('Via Sacra');
  expect(coliseo.enlace).toBe('https://www.tiktok.com/@roma/video/9');
  await expect(page.locator('.parada', { hasText: 'Coliseo' }).getByRole('link', { name: 'Vídeo' })).toBeVisible();
});

test('los lugares tienen categoría y se puede filtrar por ella', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Trattoria Da Enzo', 41.8886, 12.4772, 1), lugar('c', 'Museos Vaticanos', 41.9065, 12.4536, 2)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Categoría de Trattoria Da Enzo: Comer' })).toBeVisible();

  await page.getByRole('button', { name: '🍽️ Comer', exact: true }).click();
  await expect(page.locator('.parada', { hasText: 'Trattoria' })).toBeVisible();
  await expect(page.locator('.parada', { hasText: 'Coliseo' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Todos' }).click();
  await expect(page.locator('.parada', { hasText: 'Coliseo' })).toBeVisible();

  await page.getByRole('button', { name: 'Categoría de Coliseo: Monumentos' }).click();
  await page.getByRole('button', { name: '🌄 Miradores' }).click();
  await expect(page.getByRole('button', { name: 'Categoría de Coliseo: Miradores' })).toBeVisible();
  expect((await guardados(page))[0].lugares.find((l) => l.id === 'a').tipo).toBe('mirador');
});

test('busca dónde comer cerca de la ruta y lo mete entre las paradas', async ({ page }) => {
  await sinRed(page, { horarios: [
    { type: 'node', id: 1, lat: 41.8912, lon: 12.4890, tags: { amenity: 'restaurant', name: 'Osteria del Foro', cuisine: 'italian;pizza', opening_hours: '12:00-23:00' } },
    { type: 'node', id: 2, lat: 41.8990, lon: 12.4780, tags: { amenity: 'cafe', name: 'Tazza Doro', opening_hours: '07:00-20:00' } },
    { type: 'node', id: 3, lat: 41.9500, lon: 12.6000, tags: { amenity: 'bar', name: 'Bar Lontano' } },
  ] });
  await sembrar(page, [viaje({ fecha: hoy, lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Panteón', 41.8986, 12.4769, 1)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await page.locator('.dia').first().getByRole('button', { name: '🍽️ Comer cerca' }).click();
  const dialogo = page.getByRole('dialog', { name: /Comer cerca/ });
  await expect(dialogo.getByText('Osteria del Foro')).toBeVisible();
  await expect(dialogo.getByText(/italiana, pizza · a .* de Coliseo · abre 12:00–23:00/)).toBeVisible();
  await expect(dialogo.getByRole('link', { name: /Opiniones y fotos/ }).first()).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\/search\/.*Osteria/);
  // El buscador tolera erratas y busca también por tipo de cocina.
  await dialogo.getByLabel('Buscar entre los sitios').fill('piza');
  await expect(dialogo.getByText('Osteria del Foro')).toBeVisible();
  await dialogo.getByLabel('Buscar entre los sitios').fill('sushi');
  await expect(dialogo.getByText('Ningún sitio se parece a eso.')).toBeVisible();
  await dialogo.getByLabel('Buscar entre los sitios').fill('');
  await dialogo.getByText('Osteria del Foro').click();
  await dialogo.getByRole('button', { name: 'Añadir a la ruta' }).click();
  // Queda entre el Coliseo y el Panteón, que es donde menos se desvía.
  await expect.poll(async () => (await guardados(page))[0].lugares.map((l) => l.nombre)).toEqual(['Coliseo', 'Osteria del Foro', 'Panteón']);
  const osteria = (await guardados(page))[0].lugares[1];
  expect(osteria).toMatchObject({ dia: 1, tipo: 'comida', horario: '12:00-23:00' });
});

test('organizar pregunta si todo el viaje o solo el orden de cada día', async ({ page }) => {
  await sinRed(page);
  // El día 1 está desordenado y el Vaticano, lejos, está en el día 1 aunque encajaría mejor en otro.
  await sembrar(page, [viaje({ lugares: [
    lugar('c', 'Panteón', 41.8986, 12.4769, 1), lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Foro Romano', 41.8925, 12.4853, 1),
    lugar('v', 'Museos Vaticanos', 41.9065, 12.4536, 2)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await page.getByRole('button', { name: 'Organizar' }).click();
  await expect(page.getByRole('button', { name: /Todo el viaje/ })).toBeVisible();
  await page.getByRole('button', { name: /Cada día por separado/ }).click();
  await expect.poll(async () => (await guardados(page))[0].lugares.map((l) => `${l.id}${l.dia}`).filter((x) => x.endsWith('1')).join())
    .toMatch(/^(a1,b1,c1|c1,b1,a1)$/);
  const tras = (await guardados(page))[0].lugares;
  expect(tras.find((l) => l.id === 'v').dia).toBe(2);
});

test('cada parada muestra su hora y avisa de cuándo toca comer', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ dias: 1, lugares: [
    lugar('a', 'Museos Vaticanos', 41.9065, 12.4536, 1), lugar('b', 'Castel Sant Angelo', 41.9031, 12.4663, 1, { tipo: 'monumento' })] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  const vaticano = page.locator('.parada', { hasText: 'Museos Vaticanos' });
  await expect(vaticano.locator('.horas span')).toHaveText('🕐 09:00–11:00 · 2 h 00');
  // Es un selector nativo: en el móvil abre la rueda.
  await vaticano.getByLabel('Tiempo en Museos Vaticanos').selectOption('180');
  await expect(vaticano.locator('.horas span')).toHaveText('🕐 09:00–12:00 · 3 h 00');
  await expect(page.locator('.aviso-comida').first()).toContainText('hora de comer cerca de Castel Sant Angelo');
  expect((await guardados(page))[0].lugares[0].estancia).toBe(180);
});

test('las hojas de opciones se cierran tocando fuera', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje({ lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  await page.getByRole('button', { name: /Categoría de Coliseo/ }).click();
  await expect(page.locator('#dlg-elegir')).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.locator('#dlg-elegir')).toBeHidden();
  expect((await guardados(page))[0].lugares[0].tipo).toBe('monumento');
});
