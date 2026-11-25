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

const par = (p) => `${p.lat},${p.lon}`;
export function enlaceLugar(app, l, destino) {
  return app === 'google'
    ? `https://www.google.com/maps/search/?${new URLSearchParams({ api: 1, query: `${l.nombre}, ${destino}` })}`
    : `https://maps.apple.com/?${new URLSearchParams({ q: `${l.nombre}, ${destino.split(',')[0]}`, sll: par(l) })}`;
}

/** Enlaces con la ruta entera; más de uno si supera las 9 paradas intermedias que admite Google. */
export function enlacesRuta(app, puntos) {
  const enlaces = [];
  for (let i = 0; i < puntos.length - 1; i += 10) {
    const trozo = puntos.slice(i, i + 11);
    const aPie = trozo.slice(1).every((p, k) => distanciaKm(trozo[k], p) < 3);
    const paradas = trozo.slice(1, -1).map(par);
    const modo = aPie ? 'walking' : 'driving';
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

/** Valida datos de una copia o del almacenamiento; lanza un error si no son de Rumbo. */
export function validarViajes(datos) {
  if (!Array.isArray(datos?.viajes)) throw new Error('El archivo no es una copia de Rumbo.');
  return datos.viajes.map((v) => {
    if (!v || typeof v !== 'object' || !Array.isArray(v.lugares)) throw new Error('La copia está dañada.');
    const dias = diasValidos(v.dias);
    return {
      id: texto(v.id) || crypto.randomUUID(),
      nombre: texto(v.nombre) || 'Viaje',
      destino: texto(v.destino),
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
          dia: Number.isInteger(l.dia) && l.dia >= 1 && l.dia <= dias ? l.dia : 0,
        };
      }),
    };
  });
}
