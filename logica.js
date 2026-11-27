const MARCA_LISTA = /^(?:\d{1,2}️?⃣|\d{1,2}[.)]|[-•*–▪])\s*/u;
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}️‍⃣]/gu;

function limpiar(trozo) {
  return trozo
    .replace(MARCA_LISTA, '')
    .replace(/^\s*@/, '')
    .replace(EMOJI, '')
    .split(/\s[-–—|]\s|[:(#@]/)[0]
    .replace(/\s+/g, ' ')
    .replace(/^[\s.,;]+|[\s.,;]+$/g, '');
}

/** Saca nombres de lugares del texto de una publicación. */
export function extraerLugares(texto) {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let trozos = lineas.flatMap((l) => {
    if (l.includes('📍')) return l.split('📍').slice(1);
    return MARCA_LISTA.test(l) ? [l] : [];
  });
  if (!trozos.length) trozos = lineas;
  const vistos = new Set();
  return trozos.map(limpiar).filter((n) => {
    const clave = n.toLowerCase();
    if (n.length < 3 || n.length > 70 || /^https?$/.test(clave) || vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  });
}

export function distanciaKm(a, b) {
  const r = Math.PI / 180;
  const h = Math.sin((b.lat - a.lat) * r / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export const enZona = (punto, zona, km) => distanciaKm(punto, zona) < km;

const palabras = (t) => new Set(t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').match(/[\p{L}\p{N}]{3,}/gu) ?? []);

/** Parecido entre dos nombres, de 0 a 1: palabras comunes entre palabras totales. */
export function parecido(a, b) {
  const x = palabras(a);
  const y = palabras(b);
  const comunes = [...x].filter((p) => y.has(p)).length;
  return comunes ? comunes / (x.size + y.size - comunes) : 0;
}

const tramo = (a, b) => (a && b ? distanciaKm(a, b) : 0);
export const largo = (puntos) => puntos.slice(1).reduce((s, p, i) => s + tramo(puntos[i], p), 0);

/** Orden corto para visitar los lugares, saliendo de `inicio` y acabando en `fin` si los hay. */
// shortcut: distancias en línea recta, cambiar si hacen falta horarios o rutas reales
export function ordenarRuta(lugares, inicio = null, fin = null) {
  if (!lugares.length) return [];
  const quedan = [...lugares];
  let actual = inicio;
  if (!actual) {
    const centro = {
      lat: lugares.reduce((s, l) => s + l.lat, 0) / lugares.length,
      lon: lugares.reduce((s, l) => s + l.lon, 0) / lugares.length,
    };
    actual = quedan.reduce((a, b) => (distanciaKm(b, centro) > distanciaKm(a, centro) ? b : a));
  }
  const ruta = [];
  while (quedan.length) {
    const cerca = quedan.reduce((a, b) => (distanciaKm(b, actual) < distanciaKm(a, actual) ? b : a));
    quedan.splice(quedan.indexOf(cerca), 1);
    ruta.push(cerca);
    actual = cerca;
  }
  // 2-opt: invierte tramos mientras la ruta se acorte, para quitar cruces.
  for (let mejora = true; mejora;) {
    mejora = false;
    for (let i = 0; i < ruta.length - 1; i++) {
      for (let j = i + 1; j < ruta.length; j++) {
        const antes = ruta[i - 1] ?? inicio;
        const despues = ruta[j + 1] ?? fin;
        const ahorro = tramo(antes, ruta[i]) + tramo(ruta[j], despues) - tramo(antes, ruta[j]) - tramo(ruta[i], despues);
        if (ahorro > 1e-9) {
          ruta.splice(i, j - i + 1, ...ruta.slice(i, j + 1).reverse());
          mejora = true;
        }
      }
    }
  }
  return ruta;
}

const minutos = (hora) => {
  const m = /^(\d{2}):(\d{2})$/.exec(hora ?? '');
  return m ? m[1] * 60 + Number(m[2]) : null;
};

/** Dónde empieza y acaba el día: el hotel (aunque cambie ese día) o, sin hotel, el aeropuerto. */
export function extremosDelDia(v, dia) {
  const hotel = (d) => v.hoteles.filter((h) => h.desde <= d).reduce((a, b) => (a && a.desde > b.desde ? a : b), null);
  const fin = hotel(dia);
  return {
    inicio: hotel(dia - 1) ?? fin ?? (dia === 1 ? v.ida?.hasta ?? null : null),
    fin: fin ?? (dia === v.dias ? v.vuelta?.desde ?? null : null),
  };
}

const DE = 9 * 60;
const A = 20 * 60;
/** Minutos útiles de cada día: de 9 a 20, desde 1 h 30 tras aterrizar y hasta 3 h antes de volver. */
export function minutosUtiles(v) {
  return Array.from({ length: v.dias }, (_, i) => {
    const llega = i === 0 ? minutos(v.ida?.llegada) : null;
    const sale = i === v.dias - 1 ? minutos(v.vuelta?.salida) : null;
    const desde = llega === null ? DE : Math.max(DE, llega + 90);
    const hasta = sale === null ? A : Math.min(A, sale - 180);
    return Math.max(0, hasta - desde);
  });
}

function repartir(lugares, dias, pesos) {
  const total = dias.reduce((s, d) => s + pesos[d - 1], 0);
  const peso = (d) => (total ? pesos[d - 1] / total : 1 / dias.length);
  return ordenarRuta(lugares).map((l, i, todos) => {
    let acumulado = 0;
    const dia = dias.find((d) => (acumulado += peso(d)) > i / todos.length + 1e-9) ?? dias.at(-1);
    return { ...l, dia };
  });
}

/** Ordena las paradas dentro de cada día sin cambiar ninguna de día; las que no tienen día quedan igual. */
export function ordenarDias(v) {
  const dias = Array.from({ length: v.dias }, (_, i) => i + 1).flatMap((d) => {
    const { inicio, fin } = extremosDelDia(v, d);
    return ordenarRuta(v.lugares.filter((l) => l.dia === d), inicio, fin);
  });
  return [...dias, ...v.lugares.filter((l) => !l.dia)];
}

/** Asigna día y orden a los lugares según cercanía, tiempo útil de cada día y hoteles. */
export function organizar(v) {
  const dias = Array.from({ length: v.dias }, (_, i) => i + 1);
  const pesos = minutosUtiles(v);
  // Con hoteles en ciudades distintas, cada lugar va a los días del hotel más cercano.
  const bases = [];
  for (const d of dias) {
    const { fin } = extremosDelDia({ ...v, vuelta: null }, d);
    const ultima = bases.at(-1);
    if (ultima && (!fin || !ultima.hotel || distanciaKm(fin, ultima.hotel) < 30)) {
      ultima.dias.push(d);
      ultima.hotel ??= fin;
    } else bases.push({ hotel: fin, dias: [d] });
  }
  const masCerca = (l) => bases.reduce((a, b) => (tramo(l, b.hotel) < tramo(l, a.hotel) ? b : a));
  const asignados = bases.flatMap((base) => repartir(v.lugares.filter((l) => masCerca(l) === base), base.dias, pesos));
  return dias.flatMap((d) => {
    const { inicio, fin } = extremosDelDia(v, d);
    return ordenarRuta(asignados.filter((l) => l.dia === d), inicio, fin);
  });
}

const dosCifras = (n) => String(n).padStart(2, '0');
/** Hora local de llegada aproximada: vuelo a 810 km/h más 35 minutos, y el cambio de huso. */
export function estimarLlegada(salida, km, desfaseOrigen, desfaseDestino) {
  const m = minutos(salida);
  if (m === null) return null;
  const total = Math.round((m + km / 13.5 + 35 + desfaseDestino - desfaseOrigen) / 5) * 5;
  const dia = ((total % 1440) + 1440) % 1440;
  return { hora: `${dosCifras(Math.floor(dia / 60))}:${dosCifras(dia % 60)}`, masDias: Math.floor(total / 1440) };
}

const A_PIE_KM = 2;
/** Parte la ruta en tramos seguidos en coche o andando: se anda cuando el salto en línea recta es corto. */
// shortcut: no cuenta con volver a por el coche después de andar; cada tramo en coche sale de donde se está
export function tramosRuta(puntos) {
  const tramos = [];
  for (let i = 1; i < puntos.length; i++) {
    const modo = distanciaKm(puntos[i - 1], puntos[i]) < A_PIE_KM ? 'pie' : 'coche';
    const ultimo = tramos.at(-1);
    if (ultimo?.modo === modo) ultimo.puntos.push(puntos[i]);
    else tramos.push({ modo, puntos: [puntos[i - 1], puntos[i]] });
  }
  return tramos;
}

/** Identifica una ruta por sus puntos, redondeados a unos 10 m. */
export const claveRuta = (puntos) => puntos.map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';');

/** Línea de OSRM (polilínea de Google con 5 decimales) como [lon, lat]. */
export function decodificarPolilinea(texto) {
  const puntos = [];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i < texto.length;) {
    for (const eje of [0, 1]) {
      let valor = 0;
      let desplazar = 0;
      let byte;
      do {
        byte = texto.charCodeAt(i++) - 63;
        valor |= (byte & 0x1f) << desplazar;
        desplazar += 5;
      } while (byte >= 0x20);
      const delta = valor & 1 ? ~(valor >> 1) : valor >> 1;
      if (eje) lon += delta; else lat += delta;
    }
    puntos.push([lon / 1e5, lat / 1e5]);
  }
  return puntos;
}

export const duracion = (min) => (min < 60 ? `${Math.max(1, Math.round(min))} min` : `${Math.floor(min / 60)} h ${dosCifras(Math.round(min % 60))}`);

const DIAS_OSM = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const SELECTOR = /^((?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?(?:,(?:Mo|Tu|We|Th|Fr|Sa|Su)(?:-(?:Mo|Tu|We|Th|Fr|Sa|Su))?)*)(?:\s+|$)/;

function incluyeDia(selector, dia) {
  return selector.split(',').some((trozo) => {
    const [a, b = a] = trozo.split('-').map((d) => DIAS_OSM.indexOf(d));
    return a <= b ? dia >= a && dia <= b : dia >= a || dia <= b;
  });
}

/**
 * Horas de apertura de un día de la semana (0 = domingo) según la etiqueta opening_hours de OpenStreetMap.
 * Devuelve [] si cierra y null si el formato es de los que no se entienden (meses, festivos, amanecer…).
 */
export function horarioDelDia(etiqueta, dia) {
  const limpia = etiqueta.trim();
  if (limpia === '24/7') return ['00:00-24:00'];
  let resultado = null;
  let entendidas = 0;
  for (const regla of limpia.split(';').map((r) => r.trim()).filter(Boolean)) {
    if (/^PH\b/.test(regla)) continue;
    const selector = SELECTOR.exec(regla);
    const horas = selector ? regla.slice(selector[0].length).trim() : regla;
    const cierra = /^(off|closed)$/i.test(horas);
    const tramos = horas.split(',').map((h) => h.trim());
    if (!cierra && !tramos.every((h) => /^\d{2}:\d{2}-\d{2}:\d{2}\+?$/.test(h))) return null;
    entendidas++;
    if (selector && !incluyeDia(selector[1], dia)) continue;
    resultado = cierra ? [] : tramos.map((h) => h.replace('+', ''));
  }
  return entendidas ? resultado ?? [] : null;
}

const TIEMPOS = [
  [[0], '☀️', 'despejado'], [[1, 2], '🌤️', 'algo nuboso'], [[3], '☁️', 'nublado'], [[45, 48], '🌫️', 'niebla'],
  [[51, 53, 55, 56, 57], '🌦️', 'llovizna'], [[61, 63, 65, 66, 67], '🌧️', 'lluvia'], [[71, 73, 75, 77], '❄️', 'nieve'],
  [[80, 81, 82], '🌦️', 'chubascos'], [[85, 86], '🌨️', 'chubascos de nieve'], [[95, 96, 99], '⛈️', 'tormenta'],
];
/** Icono y palabra para un código del tiempo de la OMM. */
export function tiempoDe(codigo) {
  const [, icono, nombre] = TIEMPOS.find(([codigos]) => codigos.includes(codigo)) ?? [[], '🌡️', ''];
  return { icono, nombre };
}

/** Bandera emoji de un código de país ISO de dos letras. */
export const bandera = (pais) => (/^[A-Z]{2}$/.test(pais ?? '') ? String.fromCodePoint(...[...pais].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');

const base64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const desdeBase64url = (t) => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pasar = async (bytes, flujo) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(flujo)).arrayBuffer());

const vacio = (x) => x === '' || x === null || x === undefined || x === 0 || x === false
  || (Array.isArray(x) && !x.length) || (typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length);
/** Quita lo vacío o por defecto (al validar vuelve) y deja las coordenadas en 5 decimales, más de un metro de precisión. */
const compactar = (x) => {
  if (Array.isArray(x)) return x.map(compactar);
  if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, compactar(v)]).filter(([, v]) => !vacio(v)));
  return typeof x === 'number' ? Math.round(x * 1e5) / 1e5 : x;
};

/**
 * Viaje comprimido para ir en un enlace. Se queda fuera lo que se puede volver a calcular o buscar: fotos,
 * horarios, identificadores internos y la categoría cuando coincide con la que sale del nombre.
 * `origen` es el viaje del que salió la primera copia, para reconocerlo si se vuelve a compartir.
 */
export async function empaquetar(viaje) {
  const { id, ...resto } = viaje;
  const ligero = compactar({
    ...resto,
    origen: viaje.origen || id,
    lugares: viaje.lugares.map(({ id: _, foto, autoria, horario, tipo, ...l }) => ({
      ...l, tipo: tipo === adivinarCategoria(`${l.nombre} ${l.direccion ?? ''}`) ? '' : tipo,
    })),
    consejos: viaje.consejos?.map(({ id: _, ...c }) => c),
  });
  return base64url(await pasar(new TextEncoder().encode(JSON.stringify(ligero)), new CompressionStream('deflate-raw')));
}

/** El viaje de un enlace, ya validado y con identificador nuevo; lanza un error si el enlace está roto. */
export async function desempaquetar(texto) {
  let datos;
  try {
    datos = JSON.parse(new TextDecoder().decode(await pasar(desdeBase64url(texto), new DecompressionStream('deflate-raw'))));
  } catch {
    throw new Error('El enlace del viaje está incompleto o roto.');
  }
  return validarViajes({ viajes: [datos] })[0];
}

const par = (p) => `${p.lat},${p.lon}`;
export function enlaceLugar(app, l, destino) {
  if (app === 'google') return `https://www.google.com/maps/search/?${new URLSearchParams({ api: 1, query: `${l.nombre}, ${destino}` })}`;
  if (app === 'waze') return `https://waze.com/ul?${new URLSearchParams({ ll: par(l), q: l.nombre })}`;
  return `https://maps.apple.com/?${new URLSearchParams({ q: `${l.nombre}, ${destino.split(',')[0]}`, sll: par(l) })}`;
}

/** Enlaces con la ruta: uno por tramo en coche o a pie, y más si pasa de las 9 paradas intermedias que admite Google. */
export function enlacesRuta(app, puntos) {
  return tramosRuta(puntos).flatMap((t) => enlacesTramo(app, t.puntos, t.modo === 'pie' ? 'walking' : 'driving')
    .map((href) => ({ href, modo: t.modo })));
}

function enlacesTramo(app, puntos, modo) {
  // Waze solo guía en coche y hacia un destino: un enlace por parada, y los tramos a pie van a Google Maps.
  if (app === 'waze' && modo === 'driving') return puntos.slice(1).map((p) => `https://waze.com/ul?ll=${par(p)}&navigate=yes`);
  if (app === 'waze') return enlacesTramo('google', puntos, modo);
  const enlaces = [];
  for (let i = 0; i < puntos.length - 1; i += 10) {
    const trozo = puntos.slice(i, i + 11);
    const paradas = trozo.slice(1, -1).map(par);
    if (app === 'google') {
      const q = new URLSearchParams({ api: 1, origin: par(trozo[0]), destination: par(trozo.at(-1)), travelmode: modo });
      if (paradas.length) q.set('waypoints', paradas.join('|'));
      enlaces.push(`https://www.google.com/maps/dir/?${q}`);
    } else {
      const q = new URLSearchParams({ source: par(trozo[0]), destination: par(trozo.at(-1)), mode: modo });
      paradas.forEach((p) => q.append('waypoint', p));
      enlaces.push(`https://maps.apple.com/directions?${q}`);
    }
  }
  return enlaces;
}

/** Miniatura de Wikimedia del ancho pedido (de los tamaños que ya tiene hechos: 120, 250, 330, 500…). */
export const fotoDe = (url, ancho) => url.replace(/\/(\d+)px-([^/]+)$/, `/${ancho}px-$2`);

export const enlaceSeguro = (url) => (/^https?:\/\/\S+$/i.test(url ?? '') ? url : '');

const texto = (v, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const urlDe = (url, hosts) => (hosts.some((h) => url.startsWith(`https://${h}/`)) ? url : '');
export const diasValidos = (v) => Math.min(30, Math.max(1, Math.trunc(Number(v)) || 1));

function zonaValida(z) {
  const bien = Number.isFinite(z?.lat) && Number.isFinite(z?.lon) && z.radio > 0 && z.radio <= 1500;
  return bien ? { lat: z.lat, lon: z.lon, radio: z.radio, pais: /^[A-Z]{2}$/.test(z.pais) ? z.pais : '' } : null;
}

const coordenadas = (p) => Number.isFinite(p?.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p?.lon) && Math.abs(p.lon) <= 180;
const horaValida = (h) => (minutos(h) === null ? '' : h);
const NOTA = 5000;

function aeropuertoValido(a) {
  return coordenadas(a) ? { iata: texto(a.iata, 4), nombre: texto(a.nombre), ciudad: texto(a.ciudad), lat: a.lat, lon: a.lon } : null;
}
function vueloValido(v) {
  if (!v || typeof v !== 'object') return null;
  return {
    numero: texto(v.numero, 10), aerolinea: texto(v.aerolinea), salida: horaValida(v.salida), llegada: horaValida(v.llegada),
    estimada: v.estimada === true, desde: aeropuertoValido(v.desde), hasta: aeropuertoValido(v.hasta),
  };
}
function notasValidas(notas) {
  return Object.fromEntries(Object.entries(notas && typeof notas === 'object' ? notas : {})
    .filter(([d, n]) => /^\d{1,2}$/.test(d) && typeof n === 'string' && n).map(([d, n]) => [d, n.slice(0, NOTA)]));
}

const sinAcentos = (t) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Pasos para convertir una palabra en otra, cortando en cuanto pasa de `tope`. */
function distancia(a, b, tope) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const nueva = [i];
    for (let j = 1; j <= b.length; j++) nueva[j] = Math.min(fila[j] + 1, nueva[j - 1] + 1, fila[j - 1] + (a[i - 1] !== b[j - 1]));
    if (Math.min(...nueva) > tope) return tope + 1;
    fila = nueva;
  }
  return fila[b.length];
}

/** Si el texto encaja con la búsqueda aunque falten acentos, haya erratas o palabras a medias. */
export function coincide(busqueda, texto) {
  const buscadas = sinAcentos(busqueda).match(/[\p{L}\p{N}]+/gu) ?? [];
  const palabrasTexto = sinAcentos(texto).match(/[\p{L}\p{N}]+/gu) ?? [];
  return buscadas.every((b) => {
    const tope = b.length >= 8 ? 2 : b.length >= 4 ? 1 : 0;
    return palabrasTexto.some((p) => p.startsWith(b) || (tope && distancia(b, p.slice(0, b.length + tope), tope) <= tope));
  });
}

export const CATEGORIAS = [
  { id: 'monumento', nombre: 'Monumentos', icono: '🏛️' },
  { id: 'museo', nombre: 'Museos', icono: '🖼️' },
  { id: 'comida', nombre: 'Comer', icono: '🍽️' },
  { id: 'cafe', nombre: 'Café y dulces', icono: '☕' },
  { id: 'copas', nombre: 'Copas', icono: '🍸' },
  { id: 'helado', nombre: 'Helados', icono: '🍦' },
  { id: 'mirador', nombre: 'Miradores', icono: '🌄' },
  { id: 'naturaleza', nombre: 'Parques y playas', icono: '🌳' },
  { id: 'compras', nombre: 'Compras', icono: '🛍️' },
  { id: 'otro', nombre: 'Otros', icono: '📍' },
];

// Palabras del nombre o la descripción que delatan qué es un sitio, en los idiomas más habituales. El orden importa.
const PISTAS = [
  ['museo', /\b(museo|museu|museum|musee|galeria|gallery|galleria|pinacoteca)/],
  ['mirador', /\b(mirador|miradouro|viewpoint|belvedere|vistas?|panoramic\w*)\b/],
  ['helado', /\b(heladeria|gelat\w*|ice cream|glacier)\b/],
  ['cafe', /\b(cafe|caffe|coffee|cafeteria|pasteleria|pastelaria|bakery|panaderia|brunch|churreria|pasticceria)\b/],
  ['copas', /\b(bar|pub|cocktails?|coctel\w*|rooftop|taberna|vinoteca|wine)\b/],
  ['comida', /\b(restaurante?|ristorante|trattoria|osteria|pizzeria|tasca|marisqueria|asador|sushi|burger|tapas|comida|food|bistro|brasserie|taqueria|mercado|market|mercato)\b/],
  ['naturaleza', /\b(parque|park|parco|jardin|jardines|jardins|garden|gardens|giardino|giardini|jardim|playa|beach|spiaggia|praia|lago|lake|bosque|monte)\b/],
  ['compras', /\b(tienda|shop|store|outlet|boutique|mall|centro comercial|libreria|livraria|bookshop|bookstore)\b/],
  ['monumento', /\b(catedral|cathedral|basilica|iglesia|church|chiesa|igreja|templo|temple|palacio|palace|palazzo|palacio|castillo|castle|castel|castello|castelo|chateau|torre|tower|puente|bridge|ponte|plaza|piazza|praca|square|coliseo|colosseo|fontana|fuente|arco|monumento|monument|ruinas|foro|panteon|pantheon|alhambra|mezquita|mosque|muralla)\b/],
];

/** Categoría probable de un sitio por su nombre y descripción; 'otro' si no hay pistas. */
export const adivinarCategoria = (texto) => PISTAS.find(([, re]) => re.test(sinAcentos(texto)))?.[0] ?? 'otro';

/** Posición de `puntos` delante de la que meter `x` para desviarse lo menos posible (puede ser el final). */
export function mejorHueco(puntos, x) {
  if (puntos.length < 2) return puntos.length;
  let mejor = puntos.length;
  let coste = distanciaKm(puntos.at(-1), x);
  for (let i = 1; i < puntos.length; i++) {
    const c = distanciaKm(puntos[i - 1], x) + distanciaKm(x, puntos[i]) - distanciaKm(puntos[i - 1], puntos[i]);
    if (c < coste) {
      coste = c;
      mejor = i;
    }
  }
  return mejor;
}

// Minutos que se suele pasar en cada tipo de sitio, mientras no se ponga otro.
export const ESTANCIA = { monumento: 60, museo: 120, comida: 75, cafe: 30, copas: 60, helado: 15, mirador: 20, naturaleza: 60, compras: 45, otro: 45 };
export const estanciaDe = (l) => l.estancia || ESTANCIA[l.tipo] || 45;

/** Minutos de un tramo sin ruta real: andando a 4,5 km/h o en coche a 30 km/h, con un 30 % de rodeo. */
export function minutosTramo(a, b) {
  const km = distanciaKm(a, b);
  return km < A_PIE_KM ? (km * 1.3 / 4.5) * 60 : (km * 1.3 / 30) * 60 + 5;
}

export const hora = (m) => `${dosCifras(Math.floor(m / 60) % 24)}:${dosCifras(Math.round(m % 60))}`;

const FRANJAS = [['comida', 13 * 60 + 30, 15 * 60 + 30, 60], ['cena', 20 * 60 + 30, 22 * 60, 75]];

/**
 * Hora aproximada de llegada y salida de cada parada, y dónde encaja comer y cenar si ninguna parada es para eso.
 * `trayectos[i]` son los minutos para llegar a la parada i desde el punto anterior. El día empieza a las 9,
 * o hora y media después de aterrizar, y cada comida sugerida retrasa lo que viene detrás.
 */
export function agenda(v, dia, paradas, trayectos) {
  const aterriza = dia === 1 ? minutos(v.ida?.llegada) : null;
  const calcular = (pausas) => {
    let reloj = aterriza === null ? DE : aterriza + 90;
    return paradas.map((l, i) => {
      const llega = reloj + (trayectos[i] ?? 0);
      reloj = llega + estanciaDe(l) + (pausas.get(i) ?? 0);
      return { llega, sale: llega + estanciaDe(l) };
    });
  };
  let horas = calcular(new Map());
  const comidas = [];
  for (const [tipo, desde, hasta, dura] of FRANJAS) {
    if (!paradas.length) break;
    const yaCome = paradas.some((l, i) => l.tipo === 'comida' && horas[i].sale > desde && horas[i].llega < hasta);
    if (yaCome) continue;
    // Tras la primera parada que acaba ya dentro de la franja; si el día termina antes, al final.
    const primera = horas.findIndex((h) => h.sale >= desde);
    const i = primera === -1 ? paradas.length - 1 : primera;
    comidas.push({ tipo, despues: i, hora: Math.max(desde, horas[i].sale), dura });
    horas = calcular(new Map(comidas.map((c) => [c.despues, c.dura])));
  }
  return { horas, comidas };
}

export const TIPOS_CONSEJO = [
  { id: 'comida', nombre: 'Comida', icono: '🍽️' },
  { id: 'evitar', nombre: 'Dónde no comprar', icono: '⚠️' },
  { id: 'transporte', nombre: 'Transporte', icono: '🚇' },
  { id: 'dinero', nombre: 'Dinero y propinas', icono: '💶' },
  { id: 'seguridad', nombre: 'Seguridad', icono: '🛡️' },
  { id: 'otro', nombre: 'Otros', icono: '📝' },
];

function consejosValidos(consejos) {
  return (Array.isArray(consejos) ? consejos : []).filter((c) => typeof c?.texto === 'string' && c.texto.trim()).map((c) => ({
    id: texto(c.id) || crypto.randomUUID(),
    tipo: TIPOS_CONSEJO.some((t) => t.id === c.tipo) ? c.tipo : 'otro',
    texto: c.texto.slice(0, NOTA),
    enlace: enlaceSeguro(texto(c.enlace, 2000)),
  }));
}

/** Valida datos de una copia o del almacenamiento; lanza un error si no son de Rumbo. */
export function validarViajes(datos) {
  if (!Array.isArray(datos?.viajes)) throw new Error('El archivo no es una copia de Rumbo.');
  return datos.viajes.map((v) => {
    if (!v || typeof v !== 'object' || !Array.isArray(v.lugares)) throw new Error('La copia está dañada.');
    const dias = diasValidos(v.dias);
    return {
      id: texto(v.id) || crypto.randomUUID(),
      origen: texto(v.origen, 100),
      nombre: texto(v.nombre) || 'Viaje',
      destino: texto(v.destino),
      pais: /^[A-Z]{2}$/.test(v.pais) ? v.pais : '',
      dias,
      zona: zonaValida(v.zona),
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(v.fecha) ? v.fecha : '',
      ida: vueloValido(v.ida),
      vuelta: vueloValido(v.vuelta),
      hoteles: (Array.isArray(v.hoteles) ? v.hoteles : []).filter(coordenadas).map((h) => ({
        nombre: texto(h.nombre) || 'Hotel', direccion: texto(h.direccion, 300), lat: h.lat, lon: h.lon,
        desde: Number.isInteger(h.desde) ? Math.min(dias, Math.max(1, h.desde)) : 1,
      })),
      nota: texto(v.nota, NOTA),
      notasDia: notasValidas(v.notasDia),
      // Viaje compartido en la nube: su código y la última versión que se conoce.
      // `base` es lo último que había en la nube y aquí a la vez: con ella se sabe qué ha cambiado cada uno.
      nube: /^[a-z0-9]{8,40}$/.test(v.nube?.id ?? '') && Number.isInteger(v.nube.version)
        ? {
          id: v.nube.id, version: v.nube.version, pendiente: v.nube.pendiente === true,
          base: v.nube.base && typeof v.nube.base === 'object' && !Array.isArray(v.nube.base) ? v.nube.base : null,
        } : null,
      editadoPor: texto(v.editadoPor, 40),
      // Lugares que alguien añadió sin poder situarlos en el mapa (el asistente de IA): los sitúa el móvil al abrir el viaje.
      porSituar: (Array.isArray(v.porSituar) ? v.porSituar : []).filter((l) => texto(l?.nombre).trim()).slice(0, 40).map((l) => ({
        nombre: texto(l.nombre).trim(),
        dia: Number.isInteger(l.dia) && l.dia >= 1 && l.dia <= dias ? l.dia : 0,
        tipo: CATEGORIAS.some((c) => c.id === l.tipo) ? l.tipo : '',
        nota: texto(l.nota, NOTA),
        estancia: Number.isInteger(l.estancia) && l.estancia >= 5 && l.estancia <= 600 ? l.estancia : 0,
      })),
      consejos: consejosValidos(v.consejos),
      // Días que no se muestran; por defecto se ven todos.
      ocultos: [...new Set(Array.isArray(v.ocultos) ? v.ocultos : [])].filter((d) => Number.isInteger(d) && d >= 0 && d <= dias),
      lugares: v.lugares.map((l) => {
        if (!coordenadas(l)) {
          throw new Error('La copia tiene un lugar sin coordenadas válidas.');
        }
        return {
          id: texto(l.id) || crypto.randomUUID(),
          nombre: texto(l.nombre) || 'Lugar',
          direccion: texto(l.direccion, 300),
          lat: l.lat,
          lon: l.lon,
          enlace: enlaceSeguro(texto(l.enlace, 2000)),
          // Sin definir significa que aún no se ha buscado; vacía, que no hay.
          foto: typeof l.foto === 'string' ? urlDe(l.foto, ['upload.wikimedia.org', 'thumb.wikimedia.org']) : undefined,
          autoria: urlDe(texto(l.autoria, 1000), ['commons.wikimedia.org']),
          nota: texto(l.nota, NOTA),
          // Igual que la foto: sin definir es que aún no se ha buscado.
          horario: typeof l.horario === 'string' ? l.horario.slice(0, 300) : undefined,
          // Los guardados antes de haber categorías la reciben por su nombre.
          estancia: Number.isInteger(l.estancia) && l.estancia >= 5 && l.estancia <= 600 ? l.estancia : 0,
          tipo: CATEGORIAS.some((c) => c.id === l.tipo) ? l.tipo : adivinarCategoria(`${texto(l.nombre)} ${texto(l.direccion, 300)}`),
          dia: Number.isInteger(l.dia) && l.dia >= 1 && l.dia <= dias ? l.dia : 0,
        };
      }),
    };
  });
}

/** El viaje guardado que corresponde a uno recibido por enlace: el original o una copia anterior del mismo. */
export const mismoViaje = (viajes, recibido) => viajes.find((v) => v.id === recibido.origen || (v.origen && v.origen === recibido.origen));

/** Pone en `mio` los datos de un viaje recibido, sin perder su identificador, sus fotos ni los días que tenía ocultos. */
export function actualizarViaje(mio, recibido) {
  // Los lugares no viajan con su identificador: se reconocen por nombre y sitio.
  const mismo = (a, b) => a.id === b.id || (a.nombre === b.nombre && distanciaKm(a, b) < 0.05);
  for (const l of recibido.lugares) {
    const previo = mio.lugares.find((x) => mismo(x, l));
    if (previo?.foto !== undefined) Object.assign(l, { foto: previo.foto, autoria: previo.autoria });
  }
  Object.assign(mio, { ...recibido, id: mio.id, origen: mio.origen, ocultos: mio.ocultos.filter((d) => d <= recibido.dias) });
}

/** Lo que se guarda en la nube de un viaje compartido: todo menos lo que es de cada móvil. */
export function datosNube(v) {
  const { id, nube, ocultos, ...resto } = v;
  return resto;
}

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Cada campo se queda con el lado que lo cambió desde `base`; si cambiaron los dos, con el mío. */
function fusionarCampos(base = {}, mia = {}, suya = {}) {
  const r = {};
  for (const k of new Set([...Object.keys(mia), ...Object.keys(suya)])) {
    const valor = igual(mia[k], base[k]) ? suya[k] : mia[k];
    if (valor !== undefined) r[k] = valor;
  }
  return r;
}

/** Une dos listas de piezas con identificador (lugares, consejos) cambiadas a la vez desde `base`. */
function fusionarLista(base = [], mia = [], suya = []) {
  const porId = (l) => new Map(l.map((x) => [x.id, x]));
  const [b, m, s] = [porId(base), porId(mia), porId(suya)];
  const juntas = new Map();
  for (const id of new Set([...m.keys(), ...s.keys()])) {
    const [enBase, enMia, enSuya] = [b.get(id), m.get(id), s.get(id)];
    // Lo que borra cualquiera se borra; lo nuevo de un lado se queda.
    if (enBase && (!enMia || !enSuya)) continue;
    if (!enMia || !enSuya) juntas.set(id, enMia ?? enSuya);
    else juntas.set(id, enBase ? fusionarCampos(enBase, enMia, enSuya) : enMia);
  }
  // El orden lo pone quien haya reordenado; lo nuevo del otro lado va detrás de la pieza que tenía delante.
  const comunes = (l) => l.map((x) => x.id).filter((id) => b.has(id) && juntas.has(id));
  const reordenada = (l) => !igual(comunes(l), comunes(base));
  const [primera, segunda] = reordenada(mia) || !reordenada(suya) ? [mia, suya] : [suya, mia];
  const orden = primera.map((x) => x.id).filter((id) => juntas.has(id));
  segunda.forEach((x, i) => {
    if (!juntas.has(x.id) || orden.includes(x.id)) return;
    const delante = segunda.slice(0, i).reverse().find((y) => orden.includes(y.id));
    orden.splice(delante ? orden.indexOf(delante.id) + 1 : 0, 0, x.id);
  });
  return orden.map((id) => juntas.get(id));
}

/**
 * Junta los cambios de dos móviles hechos a la vez sobre el mismo viaje compartido. `base` es la versión que
 * tenían los dos en común; sin ella no se puede saber quién cambió qué y se queda lo propio.
 */
export function fusionar(base, mia, suya) {
  if (!base) return mia;
  return {
    ...fusionarCampos(base, mia, suya),
    notasDia: fusionarCampos(base.notasDia, mia.notasDia, suya.notasDia),
    lugares: fusionarLista(base.lugares, mia.lugares, suya.lugares),
    consejos: fusionarLista(base.consejos, mia.consejos, suya.consejos),
  };
}

/** Qué ha cambiado otra persona, en pocas palabras: "ha añadido 2 lugares y ha quitado 1 consejo". */
export function resumenCambios(antes, despues) {
  const ids = (l) => new Set((l ?? []).map((x) => x.id));
  const cuenta = (k) => {
    const [a, d] = [ids(antes?.[k]), ids(despues?.[k])];
    return [[...d].filter((x) => !a.has(x)).length, [...a].filter((x) => !d.has(x)).length];
  };
  const n = (num, uno, varios) => `${num} ${num === 1 ? uno : varios}`;
  const [masL, menosL] = cuenta('lugares');
  const [masC, menosC] = cuenta('consejos');
  const partes = [
    masL && `ha añadido ${n(masL, 'lugar', 'lugares')}`, menosL && `ha quitado ${n(menosL, 'lugar', 'lugares')}`,
    masC && `ha añadido ${n(masC, 'consejo', 'consejos')}`, menosC && `ha quitado ${n(menosC, 'consejo', 'consejos')}`,
  ].filter(Boolean);
  if (!partes.length) return 'ha cambiado el viaje';
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;
}
