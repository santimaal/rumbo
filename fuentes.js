import { distanciaKm, enZona, estimarLlegada, parecido, decodificarPolilinea } from './logica.js';

export const IDIOMA = (navigator.language || 'es').split('-')[0];

const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });
const turnos = {};

// Son servicios gratuitos que cortan las ráfagas: peticiones espaciadas por servidor y un reintento.
async function pedir(url, params, pausa, reintento = false) {
  const ahora = Date.now();
  const { host } = new URL(url);
  const turno = Math.max(ahora, turnos[host] ?? 0);
  turnos[host] = turno + pausa;
  await espera(turno - ahora);
  try {
    const r = await fetch(`${url}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(12000) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
    return await r.json();
  } catch (error) {
    if (reintento) throw error;
    await espera(5000);
    return pedir(url, params, pausa, true);
  }
}

/** Ciudades, regiones, islas y países que encajan con el texto, en el idioma del dispositivo. */
export async function buscarCiudades(texto) {
  const { results = [] } = await pedir('https://geocoding-api.open-meteo.com/v1/search', { name: texto, language: IDIOMA, count: 10 }, 200);
  const vistas = new Set();
  return results
    .filter((r) => /^(PPL|ADM|ISL|PCL)/.test(r.feature_code))
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    .map((r) => {
      const esPais = r.feature_code.startsWith('PCL');
      return {
        nombre: r.name,
        region: r.admin1 && r.admin1 !== r.name ? r.admin1 : '',
        destino: esPais || !r.country ? r.name : `${r.name}, ${r.country}`,
        pais: r.country_code ?? '',
        zona: {
          lat: r.latitude,
          lon: r.longitude,
          radio: esPais ? 1500 : /^(ADM|ISL)/.test(r.feature_code) ? 80 : 15,
          pais: esPais ? r.country_code : '',
        },
      };
    })
    .filter((c) => {
      const clave = `${c.destino}|${c.region}`;
      return !vistas.has(clave) && vistas.add(clave);
    })
    .slice(0, 6);
}

async function geocodificar(consulta, zona) {
  const params = { limit: 4, q: consulta };
  if (zona?.pais) params.countrycode = zona.pais;
  else if (zona) Object.assign(params, { lat: zona.lat, lon: zona.lon, zoom: 12, location_bias_scale: 0.2 });
  const { features } = (await pedir('https://photon.komoot.io/api/', params, 1100)) ?? { features: [] };
  return features.map(({ properties: p, geometry: g }) => ({
    nombre: p.name || p.street || consulta,
    direccion: [...new Set([[p.street, p.housenumber].filter(Boolean).join(' '), p.city, p.country].filter(Boolean))].join(', '),
    lon: g.coordinates[0],
    lat: g.coordinates[1],
  }));
}

// `seguro` es falso si hubo que mezclar el destino en la consulta: ahí salen parecidos que no son.
export async function buscarLugar(nombre, destino, zona) {
  const dentro = (o) => enZona(o, zona, zona.radio);
  const filtrar = (opciones) => opciones
    .filter((o) => enZona(o, zona, Math.max(100, zona.radio)))
    .sort((a, b) => dentro(b) - dentro(a));
  const opciones = filtrar(await geocodificar(nombre, zona));
  if (opciones.length && dentro(opciones[0])) return { opciones, seguro: true };
  return { opciones: filtrar(await geocodificar(`${nombre}, ${destino}`)), seguro: false };
}

const WIKIDATA = 'https://www.wikidata.org/w/api.php';
const wikidata = (params) => pedir(WIKIDATA, { origin: '*', format: 'json', formatversion: 2, ...params }, 400);

// Atracciones, museos, templos, palacios, plazas, parques, puentes, yacimientos, torres, playas, miradores, barrios…
const TIPOS = 'Q570116 Q33506 Q207694 Q16970 Q1088552 Q2977 Q163687 Q120560 Q16560 Q23413 Q174782 Q22698 Q12280 Q839954 Q12518 Q330284 Q40080 Q483453 Q1107656 Q44539 Q32815 Q34627 Q5393308 Q845945 Q44613 Q11303 Q24354 Q153562 Q6017969 Q57821 Q2319498 Q4989906 Q54831 Q43501 Q2281788 Q2416723 Q143912 Q162875 Q123705 Q79007 Q56242215 Q2031836 Q82117 Q751876 Q1081138 Q1440300 Q17431399 Q179700 Q46169 Q34038 Q35509 Q39614 Q3397526 Q158438 Q12570 Q537127'.split(' ');
// Universidades, pabellones deportivos y estaciones: a veces están marcados también como edificios de interés.
const FUERA = 'Q3918 Q875538 Q189004 Q641226 Q483110 Q55488'.split(' ');
const conTipo = (tipos) => `haswbstatement:${tipos.map((t) => `P31=${t}`).join('|')}`;

function foto(pagina) {
  if (!pagina.thumbnail || !pagina.pageimage) return { foto: '', autoria: '' };
  return {
    foto: pagina.thumbnail.source.split('?')[0],
    autoria: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(pagina.pageimage)}`,
  };
}
const CON_FOTO = { piprop: 'thumbnail|name', pithumbsize: 330, pilimit: 50 };

async function nombresDe(ids) {
  const { entities = {} } = await wikidata({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|descriptions', languages: `${IDIOMA}|en`, languagefallback: 1 });
  return entities;
}
const mayuscula = (t) => t.charAt(0).toUpperCase() + t.slice(1);

async function filtroZona(zona) {
  if (!zona.pais) return `nearcoord:${zona.radio}km,${zona.lat},${zona.lon}`;
  const { query } = await wikidata({ action: 'query', list: 'search', srsearch: `haswbstatement:P297=${zona.pais}`, srlimit: 1 });
  if (!query.search.length) throw new Error('País sin datos');
  return `haswbstatement:P17=${query.search[0].title}`;
}

/** Los lugares más conocidos de la zona (por número de Wikipedias que hablan de ellos), con foto y coordenadas. */
export async function recomendar(zona) {
  const donde = await filtroZona(zona);
  const { query } = await wikidata({
    action: 'query', generator: 'search', gsrnamespace: 0, gsrlimit: 300, gsrsort: 'incoming_links_desc',
    gsrsearch: `${conTipo(TIPOS)} -${conTipo(FUERA)} haswbstatement:P18 ${donde}`,
    prop: 'pageprops', ppprop: 'wb-sitelinks',
  });
  const fama = (p) => Number(p.pageprops?.['wb-sitelinks'] ?? 0);
  return detallar((query?.pages ?? []).sort((a, b) => fama(b) - fama(a)).slice(0, 40));
}

/** Busca por nombre dentro de la zona: primero lo que tiene foto, luego cualquier sitio del mapa. */
export async function buscarIdeas(texto, zona, destino) {
  const limpio = texto.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim();
  const [conFoto, resto] = await Promise.allSettled([
    filtroZona(zona).then((donde) => wikidata({
      action: 'query', generator: 'search', gsrnamespace: 0, gsrlimit: 8, gsrsearch: `${limpio}* haswbstatement:P18 ${donde}`, prop: 'info',
    })).then(({ query }) => detallar((query?.pages ?? []).sort((a, b) => a.index - b.index))),
    buscarLugar(texto, destino, zona).then(({ opciones }) => opciones),
  ]);
  if (conFoto.status === 'rejected' && resto.status === 'rejected') throw resto.reason;
  const lista = conFoto.value ?? [];
  for (const o of resto.value ?? []) {
    if (!lista.some((l) => parecido(l.nombre, o.nombre) >= 0.5 && distanciaKm(l, o) < 0.5)) lista.push(o);
  }
  return lista;
}

async function detallar(mejores) {
  if (!mejores.length) return [];
  const [detalle, nombres] = await Promise.all([
    wikidata({ action: 'query', pageids: mejores.map((p) => p.pageid).join('|'), prop: 'pageimages|coordinates', colimit: 50, ...CON_FOTO }),
    nombresDe(mejores.map((p) => p.title)),
  ]);
  const paginas = new Map(detalle.query.pages.map((p) => [p.pageid, p]));
  return mejores.flatMap(({ pageid, title }) => {
    const p = paginas.get(pageid);
    const n = nombres[title];
    const nombre = n?.labels?.[IDIOMA]?.value;
    const c = p?.coordinates?.[0];
    if (!nombre || !c || !p.thumbnail) return [];
    const d = n.descriptions?.[IDIOMA];
    const direccion = d && (d.language ?? IDIOMA) === IDIOMA ? mayuscula(d.value) : '';
    return [{ nombre: mayuscula(nombre), direccion, lat: c.lat, lon: c.lon, ...foto(p) }];
  });
}

/** Foto de un lugar ya guardado; vacía si no hay ninguna cuyo nombre se parezca de verdad. */
export async function buscarFoto(lugar) {
  const nombre = lugar.nombre.replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const { query } = await wikidata({
    action: 'query', generator: 'search', gsrnamespace: 0, gsrlimit: 4,
    gsrsearch: `${nombre} nearcoord:1km,${lugar.lat},${lugar.lon} haswbstatement:P18`,
    prop: 'pageimages', ...CON_FOTO,
  });
  const paginas = query?.pages ?? [];
  if (!paginas.length) return { foto: '', autoria: '' };
  const nombres = await nombresDe(paginas.map((p) => p.title));
  const [mejor] = paginas
    .map((p) => ({ p, nota: Math.max(0, ...Object.values(nombres[p.title]?.labels ?? {}).map((n) => parecido(lugar.nombre, n.value))) }))
    .sort((a, b) => b.nota - a.nota);
  return mejor.nota >= 0.5 ? foto(mejor.p) : { foto: '', autoria: '' };
}

const aeropuerto = (a) => ({ iata: a.iata_code, nombre: a.name, ciudad: a.municipality, lat: a.latitude, lon: a.longitude });

/** Aerolínea y aeropuertos de un número de vuelo, o null si no se conoce. No incluye horarios. */
export async function buscarVuelo(numero) {
  const datos = await pedir(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(numero)}`, {}, 500);
  const ruta = datos?.response?.flightroute;
  if (!ruta) return null;
  return { aerolinea: ruta.airline?.name ?? '', desde: aeropuerto(ruta.origin), hasta: aeropuerto(ruta.destination) };
}

function desfase(zonaHoraria, fecha) {
  const partes = new Intl.DateTimeFormat('en', { timeZone: zonaHoraria, timeZoneName: 'longOffset' }).formatToParts(fecha);
  const m = /([+-])(\d{2}):(\d{2})/.exec(partes.find((x) => x.type === 'timeZoneName').value);
  return m ? (m[1] === '-' ? -1 : 1) * (m[2] * 60 + Number(m[3])) : 0;
}

/** Llegada aproximada del vuelo en hora local del destino. */
export async function calcularLlegada({ salida, desde, hasta }, fecha) {
  const husos = await pedir('https://api.open-meteo.com/v1/forecast', {
    latitude: `${desde.lat},${hasta.lat}`, longitude: `${desde.lon},${hasta.lon}`, timezone: 'auto,auto', forecast_days: 1,
  }, 200);
  const cuando = fecha ? new Date(`${fecha}T12:00:00Z`) : new Date();
  const [a, b] = husos.map((h) => desfase(h.timezone, cuando));
  return estimarLlegada(salida, distanciaKm(desde, hasta), a, b);
}

const estilos = {};
/** Estilo del mapa con los rótulos en el idioma del dispositivo; si no hay traducción, el nombre local. */
export function estiloMapa(oscuro = false) {
  const nombre = oscuro ? 'dark' : 'bright';
  estilos[nombre] ??= pedir(`https://tiles.openfreemap.org/styles/${nombre}`, {}, 0).then((e) => {
    for (const { layout } of e.layers) {
      if (layout && JSON.stringify(layout['text-field'] ?? '').includes('name')) {
        layout['text-field'] = ['coalesce', ['get', `name:${IDIOMA}`], ['get', 'name:latin'], ['get', 'name']];
      }
    }
    return e;
  }).catch((error) => {
    delete estilos[nombre];
    throw error;
  });
  return estilos[nombre];
}

/** Ruta real a pie o en coche por las calles, con su línea para el mapa. */
export async function rutaReal(puntos, aPie) {
  const perfil = aPie ? 'routed-foot' : 'routed-car';
  const coordenadas = puntos.map((p) => `${p.lon},${p.lat}`).join(';');
  const datos = await pedir(`https://routing.openstreetmap.de/${perfil}/route/v1/driving/${coordenadas}`, { overview: 'simplified', geometries: 'polyline' }, 1100);
  const [ruta] = datos?.routes ?? [];
  if (!ruta) return null;
  return {
    km: ruta.distance / 1000, min: ruta.duration / 60, modo: aPie ? 'pie' : 'coche', linea: decodificarPolilinea(ruta.geometry),
    piernas: ruta.legs.map((l) => ({ km: l.distance / 1000, min: l.duration / 60 })),
  };
}

const nombresOsm = (tags) => Object.entries(tags).filter(([k]) => k === 'name' || k.startsWith('name:')).map(([, v]) => v);

/** Horario de OpenStreetMap de cada lugar: el de algo a menos de 80 m con un nombre parecido, o vacío. */
export async function buscarHorarios(lugares) {
  const horarios = new Map();
  for (let i = 0; i < lugares.length; i += 20) {
    const tanda = lugares.slice(i, i + 20);
    const consulta = `[out:json][timeout:20];(${tanda.map((l) => `nwr(around:80,${l.lat},${l.lon})["opening_hours"];`).join('')});out center;`;
    const { elements = [] } = await pedir('https://overpass-api.de/api/interpreter', { data: consulta }, 1500);
    for (const l of tanda) {
      const [mejor] = elements
        .map((e) => ({ e, nota: Math.max(0, ...nombresOsm(e.tags ?? {}).map((n) => parecido(l.nombre, n))) }))
        .filter(({ e, nota }) => nota >= 0.5 && distanciaKm(l, { lat: e.lat ?? e.center?.lat, lon: e.lon ?? e.center?.lon }) < 0.08)
        .sort((a, b) => b.nota - a.nota);
      horarios.set(l.id, mejor?.e.tags.opening_hours ?? '');
    }
  }
  return horarios;
}

/** Previsión por fecha (AAAA-MM-DD) entre dos días; Open-Meteo solo llega a 16 días vista. */
export async function prevision(zona, desde, hasta) {
  const { daily } = await pedir('https://api.open-meteo.com/v1/forecast', {
    latitude: zona.lat, longitude: zona.lon, timezone: 'auto', start_date: desde, end_date: hasta,
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  }, 200);
  return Object.fromEntries(daily.time.map((fecha, i) => [fecha, {
    codigo: daily.weather_code[i], max: daily.temperature_2m_max[i], min: daily.temperature_2m_min[i], lluvia: daily.precipitation_probability_max[i],
  }]));
}
