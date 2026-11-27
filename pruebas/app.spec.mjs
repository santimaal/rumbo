import { test, expect } from '@playwright/test';

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
    if (url.host === 'routing.openstreetmap.de') return json({ routes: [{ distance: 2500, duration: 1800, geometry: '_p~iF~ps|U_ulLnnqC' }] });
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
  await page.getByLabel('Abrir lugares y rutas en').selectOption('google');
  expect(await page.evaluate(() => localStorage.getItem('rumbo-mapas'))).toBe('google');
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
  await page.getByRole('button', { name: '+ Consejo' }).click();
  await page.getByLabel('Tipo').selectOption('dinero');
  await page.getByLabel('Consejo', { exact: true }).fill('La propina no es obligatoria en los restaurantes');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('heading', { name: '💶 Dinero y propinas' })).toBeVisible();

  await page.getByLabel('Buscar en los consejos').fill('restaurnte');
  await expect(page.locator('.consejos .nota:visible')).toHaveText(['La propina no es obligatoria en los restaurantes']);
  await page.getByLabel('Buscar en los consejos').fill('taxi');
  await expect(page.getByText('Ningún consejo se parece a eso.')).toBeVisible();
});

test('cada día muestra ruta real, tiempo y horarios', async ({ page }) => {
  await sinRed(page, { horarios: [
    { type: 'node', lat: 41.8902, lon: 12.4922, tags: { name: 'Colosseo', 'name:es': 'Coliseo', opening_hours: '09:00-19:00' } },
    { type: 'way', center: { lat: 41.8986, lon: 12.4769 }, tags: { name: 'Pantheon', 'name:es': 'Panteón', opening_hours: 'Mo-Su off' } },
  ] });
  await sembrar(page, [viaje({ fecha: hoy, lugares: [lugar('a', 'Coliseo', 41.8902, 12.4922, 1), lugar('b', 'Panteón', 41.8986, 12.4769, 1)] })]);
  await page.goto('/');
  await page.getByText('Roma', { exact: true }).click();
  const dia1 = page.locator('.dia').first();
  await expect(dia1).toContainText('2,5 km · 30 min a pie');
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
  await asa.scrollIntoViewIfNeeded();
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
  await expect(otro.getByText('Supplì en Trastevere')).toBeVisible();
  await expect(otro.getByText('Coliseo')).toBeVisible();
  expect(new URL(otro.url()).hash).toBe('');
});

test('lo compartido desde otra app abre el formulario de lugares', async ({ page }) => {
  await sinRed(page);
  await sembrar(page, [viaje(), viaje({ id: 'lis', nombre: 'Lisboa', destino: 'Lisboa, Portugal', pais: 'PT' })]);
  const texto = 'Lo mejor de Lisboa\n📍 Miradouro da Graça\n📍 Time Out Market https://www.instagram.com/reel/abc';
  await page.goto(`/?compartir&${new URLSearchParams({ texto })}`);
  await page.getByRole('dialog').getByRole('button', { name: /Lisboa/ }).click();
  await expect(page.getByRole('heading', { name: 'Añadir lugares' })).toBeVisible();
  await expect(page.getByLabel('Enlace del reel o TikTok (opcional)')).toHaveValue('https://www.instagram.com/reel/abc');
  await expect(page.getByLabel('Texto de la publicación')).toHaveValue(/📍 Miradouro da Graça/);
  await expect(page.locator('h1')).toHaveText('Lisboa');
});
