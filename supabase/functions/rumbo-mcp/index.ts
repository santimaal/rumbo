// Servidor MCP de Rumbo: deja que un asistente de IA cree viajes compartidos y les añada cosas.
// Habla MCP por HTTP (JSON-RPC, sin sesiones) y guarda con las mismas funciones que usa la app,
// así que lo que crea se abre en Rumbo con su enlace y se sincroniza como cualquier viaje compartido.
// Al desplegar se sube junto a una copia de logica.js de la raíz del proyecto.
import { validarViajes, datosNube, organizar, adivinarCategoria, enZona, CATEGORIAS, TIPOS_CONSEJO } from './logica.js';

const SUPABASE = 'https://centngtgakviminnkkva.supabase.co';
const CLAVE = 'sb_publishable_dVqHWB9XsMJZ8AOVrFVGrw_1goCCoFT';
const APP = 'https://santimaal.github.io/rumbo/';
const AUTOR = 'IA';

const espera = (ms) => new Promise((r) => { setTimeout(r, ms); });

async function pedir(url, opciones = {}) {
  const r = await fetch(url, {
    ...opciones,
    headers: { 'User-Agent': `Rumbo/1.0 (+${APP})`, ...opciones.headers },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`${new URL(url).host} respondió ${r.status}`);
  return r.json();
}

const rpc = (funcion, params) => pedir(`${SUPABASE}/rest/v1/rpc/${funcion}`, {
  method: 'POST', headers: { apikey: CLAVE, 'Content-Type': 'application/json' }, body: JSON.stringify(params),
});

// Los móviles con el viaje abierto se ponen al día al recibir este aviso.
const avisarMoviles = (id) => fetch(`${SUPABASE}/realtime/v1/api/broadcast`, {
  method: 'POST',
  headers: { apikey: CLAVE, 'Content-Type': 'application/json' },
  body: JSON.stringify({ messages: [{ topic: `viaje-${id}`, event: 'cambio', payload: {}, private: false }] }),
}).catch(() => {});

/** Ciudad, región o país, como el buscador de la app: el primero del país indicado tras la coma, o el más poblado. */
async function buscarDestino(texto) {
  const [nombre, ...resto] = texto.split(',');
  const pais = resto.join(',').trim().toLowerCase();
  const { results = [] } = await pedir(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({ name: nombre.trim(), language: 'es', count: 10 })}`);
  const candidatos = results.filter((r) => /^(PPL|ADM|ISL|PCL)/.test(r.feature_code)).sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
  const r = candidatos.find((c) => !pais || (c.country ?? '').toLowerCase().includes(pais) || (c.country_code ?? '').toLowerCase() === pais) ?? candidatos[0];
  if (!r) return null;
  const esPais = r.feature_code.startsWith('PCL');
  return {
    destino: esPais || !r.country ? r.name : `${r.name}, ${r.country}`,
    pais: r.country_code ?? '',
    zona: { lat: r.latitude, lon: r.longitude, radio: esPais ? 1500 : /^(ADM|ISL)/.test(r.feature_code) ? 80 : 15, pais: esPais ? r.country_code : '' },
  };
}

async function photon(consulta, zona) {
  const params = { q: consulta, limit: 4 };
  if (zona.pais) params.countrycode = zona.pais;
  else Object.assign(params, { lat: zona.lat, lon: zona.lon, zoom: 12, location_bias_scale: 0.2 });
  const { features = [] } = await pedir(`https://photon.komoot.io/api/?${new URLSearchParams(params)}`);
  return features.map(({ properties: p, geometry: g }) => ({
    direccion: [...new Set([[p.street, p.housenumber].filter(Boolean).join(' '), p.city, p.country].filter(Boolean))].join(', '),
    lon: g.coordinates[0],
    lat: g.coordinates[1],
  }));
}

// Nominatim pide identificarse y no más de una búsqueda por segundo.
async function nominatim(consulta, zona) {
  const params = { q: consulta, format: 'jsonv2', limit: 4, 'accept-language': 'es' };
  if (zona.pais) params.countrycodes = zona.pais.toLowerCase();
  else {
    const g = Math.max(0.3, zona.radio / 80);
    params.viewbox = [zona.lon - g, zona.lat + g, zona.lon + g, zona.lat - g].join(',');
  }
  const lista = await pedir(`https://nominatim.openstreetmap.org/search?${new URLSearchParams(params)}`, { headers: { Referer: APP } });
  return lista.map((r) => ({ direccion: r.display_name.split(', ').slice(1, 4).join(', '), lat: Number(r.lat), lon: Number(r.lon) }));
}

// Photon es el que usa la app, pero a veces no deja buscar desde servidores: entonces se usa Nominatim.
async function geocodificar(consulta, zona) {
  let opciones;
  try {
    opciones = await photon(consulta, zona);
  } catch {
    opciones = await nominatim(consulta, zona);
  }
  await espera(1100);
  return opciones.filter((o) => enZona(o, zona, Math.max(100, zona.radio)));
}

/** Dónde está un sitio dentro de la zona del viaje; si no sale solo, se prueba con el destino detrás. */
async function buscarSitio(nombre, zona, destino) {
  const [primero] = await geocodificar(nombre, zona);
  if (primero) return primero;
  const [segundo] = await geocodificar(`${nombre}, ${destino}`, zona);
  return segundo ?? null;
}

const cuantos = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const entero = (n, min, max) => (Number.isInteger(n) && n >= min && n <= max ? n : null);

/**
 * Busca cada lugar pedido y lo deja como lo guarda la app; devuelve también los que no aparecen. Los buscadores
 * gratuitos a veces no dejan buscar desde servidores: entonces el lugar queda por situar y lo sitúa el móvil.
 */
async function prepararLugares(pedidos = [], viaje) {
  const lugares = [];
  const perdidos = [];
  const porSituar = [];
  let sinBuscador = false;
  for (const l of pedidos.slice(0, 40)) {
    const nombre = String(l?.nombre ?? '').trim().slice(0, 200);
    if (!nombre) continue;
    let sitio;
    try {
      // Si un buscador ya no ha dejado buscar, los siguientes lugares van directos a por situar.
      if (sinBuscador) throw new Error('Sin buscador');
      sitio = await buscarSitio(nombre, viaje.zona, viaje.destino);
    } catch {
      sinBuscador = true;
      porSituar.push({
        nombre, dia: entero(l.dia, 1, viaje.dias) ?? 0, nota: String(l.nota ?? '').slice(0, 5000),
        tipo: CATEGORIAS.some((c) => c.id === l.categoria) ? l.categoria : '', estancia: entero(l.minutos, 5, 600) ?? 0,
      });
      continue;
    }
    if (!sitio) {
      perdidos.push(nombre);
      continue;
    }
    lugares.push({
      id: crypto.randomUUID(), nombre, ...sitio, enlace: '', nota: String(l.nota ?? '').slice(0, 5000),
      dia: entero(l.dia, 1, viaje.dias) ?? 0,
      tipo: CATEGORIAS.some((c) => c.id === l.categoria) ? l.categoria : adivinarCategoria(`${nombre} ${sitio.direccion}`),
      estancia: entero(l.minutos, 5, 600) ?? 0,
    });
  }
  return { lugares, perdidos, porSituar };
}

const prepararConsejos = (pedidos = []) => pedidos.slice(0, 40).filter((c) => String(c?.texto ?? '').trim()).map((c) => ({
  id: crypto.randomUUID(),
  tipo: TIPOS_CONSEJO.some((t) => t.id === c.tipo) ? c.tipo : 'otro',
  texto: String(c.texto).trim(),
  enlace: /^https?:\/\/\S+$/i.test(c.enlace ?? '') ? c.enlace : '',
}));

// Pendientes y platos para probar: solo texto y su casilla, que se marca luego en la app.
const prepararLista = (pedidos = [], campo, marca) => (Array.isArray(pedidos) ? pedidos : []).slice(0, 60)
  .map((x) => String(typeof x === 'string' ? x : x?.[campo] ?? '').trim()).filter(Boolean)
  .map((t) => ({ id: crypto.randomUUID(), [campo]: t.slice(0, 300), [marca]: false }));

const nombreCategoria = (id) => CATEGORIAS.find((c) => c.id === id)?.nombre ?? 'Otros';

/** El viaje en texto, día a día, para que el asistente pueda contarlo o seguir trabajando con él. */
function describir(v, codigo) {
  const lineas = [`«${v.nombre}» · ${v.destino} · ${v.dias} ${v.dias === 1 ? 'día' : 'días'}${v.fecha ? ` desde ${v.fecha}` : ''}`, `Enlace: ${APP}#v=${codigo}`];
  for (let d = 0; d <= v.dias; d++) {
    const del = v.lugares.filter((l) => l.dia === d);
    if (!del.length) continue;
    lineas.push('', d ? `Día ${d}:` : 'Sin día:');
    for (const l of del) lineas.push(`- ${l.nombre} (${nombreCategoria(l.tipo)})${l.nota ? ` — ${l.nota}` : ''}`);
  }
  if (v.consejos.length) {
    lineas.push('', 'Consejos:');
    for (const c of v.consejos) lineas.push(`- [${TIPOS_CONSEJO.find((t) => t.id === c.tipo)?.nombre ?? 'Otros'}] ${c.texto}`);
  }
  if (v.tareas?.length) lineas.push('', 'Pendientes:', ...v.tareas.map((t) => `- [${t.hecha ? 'x' : ' '}] ${t.texto}`));
  if (v.probar?.length) lineas.push('', `Para probar: ${v.probar.map((p) => `${p.nombre}${p.probado ? ' ✓' : ''}`).join(', ')}`);
  if (v.porSituar?.length) {
    lineas.push('', 'Por situar en el mapa (la app los sitúa al abrir el viaje):');
    for (const l of v.porSituar) lineas.push(`- ${l.nombre}${l.dia ? ` (día ${l.dia})` : ''}`);
  }
  if (v.nota) lineas.push('', `Nota: ${v.nota}`);
  return lineas.join('\n');
}

const codigoDe = (enlace) => {
  const codigo = /(?:#v=)?([a-z0-9]{16})\b/.exec(String(enlace ?? ''))?.[1];
  if (!codigo) throw new Error('Ese enlace no es de un viaje compartido de Rumbo (debe terminar en #v= y un código).');
  return codigo;
};

async function leer(codigo) {
  const [fila] = await rpc('leer_viaje', { p_id: codigo });
  if (!fila) throw new Error('Ese viaje compartido no existe o se borró.');
  return { v: validarViajes({ viajes: [{ lugares: [], ...fila.datos, id: 'mcp' }] })[0], version: fila.version };
}

const ACCIONES = {
  async crear_viaje(a) {
    const sitio = await buscarDestino(String(a.destino ?? ''));
    if (!sitio) throw new Error(`No encuentro el destino «${a.destino}». Prueba con «Ciudad, País».`);
    const dias = entero(a.dias, 1, 30) ?? 3;
    const base = { ...sitio, dias };
    const { lugares, perdidos, porSituar } = await prepararLugares(a.lugares, base);
    const hoteles = [];
    if (a.hotel) {
      const h = await buscarSitio(String(a.hotel), sitio.zona, sitio.destino).catch(() => null);
      if (h) hoteles.push({ nombre: String(a.hotel).slice(0, 200), ...h, desde: 1 });
      else perdidos.push(`${a.hotel} (hotel: añádelo en la app, en Vuelos y hotel)`);
    }
    let [v] = validarViajes({ viajes: [{
      nombre: String(a.nombre ?? '').trim() || sitio.destino.split(',')[0], ...sitio, dias,
      fecha: /^\d{4}-\d{2}-\d{2}$/.test(a.fecha ?? '') ? a.fecha : '',
      lugares, hoteles, porSituar, consejos: prepararConsejos(a.consejos), nota: String(a.nota ?? ''), editadoPor: AUTOR,
      tareas: prepararLista(a.pendientes, 'texto', 'hecha'), probar: prepararLista(a.para_probar, 'nombre', 'probado'),
    }] });
    // Sin días puestos, se reparten como lo hace Organizar en la app: por cercanía y con los hoteles.
    if (v.lugares.length && v.lugares.every((l) => !l.dia)) v = { ...v, lugares: organizar(v) };
    const codigo = await rpc('crear_viaje', { p_datos: datosNube(v) });
    return [
      `Viaje creado. Ábrelo en el móvil con este enlace para añadirlo a Rumbo: ${APP}#v=${codigo}`,
      perdidos.length ? `No encontré en el mapa: ${perdidos.join(', ')}.` : '',
      '', describir(v, codigo),
    ].filter((x, i) => x || i === 2).join('\n');
  },

  async ver_viaje(a) {
    const codigo = codigoDe(a.enlace);
    const { v } = await leer(codigo);
    return describir(v, codigo);
  },

  async anadir_al_viaje(a) {
    const codigo = codigoDe(a.enlace);
    let { v, version } = await leer(codigo);
    if (!v.zona) Object.assign(v, await buscarDestino(v.destino));
    // Se buscan una vez; si alguien guarda a la vez, se vuelven a poner sobre su versión.
    const { lugares, perdidos, porSituar } = await prepararLugares(a.lugares, v);
    const consejos = prepararConsejos(a.consejos);
    const tareas = prepararLista(a.pendientes, 'texto', 'hecha');
    const probar = prepararLista(a.para_probar, 'nombre', 'probado');
    for (let intento = 0; intento < 3; intento++) {
      const nuevo = {
        ...v, lugares: [...v.lugares, ...lugares], porSituar: [...v.porSituar, ...porSituar], consejos: [...v.consejos, ...consejos],
        tareas: [...v.tareas, ...tareas], probar: [...v.probar, ...probar],
        nota: a.nota ? [v.nota, String(a.nota)].filter(Boolean).join('\n\n') : v.nota, editadoPor: AUTOR,
      };
      const guardada = await rpc('guardar_viaje', { p_id: codigo, p_datos: datosNube(nuevo), p_version: version });
      if (guardada !== null) {
        await avisarMoviles(codigo);
        return [
          `Añadido a «${v.nombre}»: ${[cuantos(lugares.length + porSituar.length, 'lugar', 'lugares'), cuantos(consejos.length, 'consejo', 'consejos'),
            tareas.length ? cuantos(tareas.length, 'pendiente', 'pendientes') : '', probar.length ? cuantos(probar.length, 'plato para probar', 'platos para probar') : '',
            a.nota ? 'la nota' : ''].filter(Boolean).join(', ')}.`,
          lugares.some((l) => !l.dia) ? 'Los lugares sin día quedan en «Sin día»: en la app, Organizar los reparte.' : '',
          perdidos.length ? `No encontré en el mapa: ${perdidos.join(', ')}.` : '',
          '', describir(nuevo, codigo),
        ].filter((x, i, todo) => x || i === todo.length - 2).join('\n');
      }
      ({ v, version } = await leer(codigo));
    }
    throw new Error('El viaje se está cambiando ahora mismo en otro móvil. Prueba otra vez en unos segundos.');
  },
};

const lugarEsquema = {
  type: 'object',
  properties: {
    nombre: { type: 'string', description: 'Nombre del sitio, como se buscaría en un mapa: "Museo del Prado", "Mercado de San Miguel".' },
    dia: { type: 'integer', minimum: 1, description: 'Día del viaje (1, 2…). Si no se pone en ninguno, se reparten solos por cercanía.' },
    categoria: { type: 'string', enum: CATEGORIAS.map((c) => c.id), description: 'Si no se pone, se deduce del nombre.' },
    nota: { type: 'string', description: 'Algo útil sobre el sitio: reservar, qué pedir, horarios.' },
    minutos: { type: 'integer', minimum: 5, maximum: 600, description: 'Tiempo que se suele pasar allí.' },
  },
  required: ['nombre'],
};
const consejoEsquema = {
  type: 'object',
  properties: {
    tipo: { type: 'string', enum: TIPOS_CONSEJO.map((t) => t.id) },
    texto: { type: 'string' },
    enlace: { type: 'string', description: 'Opcional: un vídeo o web relacionada.' },
  },
  required: ['texto'],
};
const listaEsquema = (descripcion) => ({ type: 'array', items: { type: 'string' }, maxItems: 60, description: descripcion });
const pendientesEsquema = listaEsquema('Cosas por hacer, que se tachan en la app: "Reservar el barco", "Reservar taxi al aeropuerto".');
const probarEsquema = listaEsquema('Platos o bebidas típicos para probar, que se marcan en la app al probarlos.');
const enlaceEsquema = { type: 'string', description: 'Enlace del viaje compartido (…/rumbo/#v=código) o solo el código.' };

const HERRAMIENTAS = [
  {
    name: 'crear_viaje',
    description: 'Crea un viaje en Rumbo con sus lugares, ya situados en el mapa y repartidos por días, y devuelve el enlace para abrirlo en la app. Usa nombres de sitios reales y concretos.',
    inputSchema: {
      type: 'object',
      properties: {
        nombre: { type: 'string', description: 'Nombre del viaje, por ejemplo "Roma en mayo".' },
        destino: { type: 'string', description: 'Ciudad, región o país, mejor como "Ciudad, País": "Oporto, Portugal".' },
        dias: { type: 'integer', minimum: 1, maximum: 30 },
        fecha: { type: 'string', description: 'Primer día, AAAA-MM-DD. Opcional; con ella la app enseña el tiempo y los horarios de cada día.' },
        hotel: { type: 'string', description: 'Opcional: alojamiento, para empezar y acabar ahí cada día.' },
        lugares: { type: 'array', items: lugarEsquema, maxItems: 40 },
        consejos: { type: 'array', items: consejoEsquema, maxItems: 40 },
        pendientes: pendientesEsquema,
        para_probar: probarEsquema,
        nota: { type: 'string', description: 'Nota general del viaje.' },
      },
      required: ['destino', 'dias'],
    },
  },
  {
    name: 'ver_viaje',
    description: 'Lee un viaje compartido de Rumbo a partir de su enlace: lugares por día, consejos y nota.',
    inputSchema: { type: 'object', properties: { enlace: enlaceEsquema }, required: ['enlace'] },
  },
  {
    name: 'anadir_al_viaje',
    description: 'Añade lugares, consejos, pendientes, platos para probar o una nota a un viaje compartido de Rumbo. Los móviles que lo tengan abierto lo ven al momento.',
    inputSchema: {
      type: 'object',
      properties: {
        enlace: enlaceEsquema,
        lugares: { type: 'array', items: lugarEsquema, maxItems: 40 },
        consejos: { type: 'array', items: consejoEsquema, maxItems: 40 },
        pendientes: pendientesEsquema,
        para_probar: probarEsquema,
        nota: { type: 'string', description: 'Texto que se añade a la nota general del viaje.' },
      },
      required: ['enlace'],
    },
  },
];

const INSTRUCCIONES = 'Rumbo es una app de viajes. Con crear_viaje preparas un viaje completo (lugares por días, consejos de comida, qué evitar…) y das al usuario el enlace para abrirlo en el móvil. Con ver_viaje y anadir_al_viaje trabajas sobre un viaje que ya comparte contigo por enlace.';

const respuesta = (id, result) => ({ jsonrpc: '2.0', id, result });
const fallo = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

async function atender({ id, method, params }) {
  if (id === undefined || id === null) return null;
  if (method === 'initialize') {
    const pedida = params?.protocolVersion;
    return respuesta(id, {
      protocolVersion: ['2025-06-18', '2025-03-26', '2024-11-05'].includes(pedida) ? pedida : '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'rumbo', version: '1.0.0' },
      instructions: INSTRUCCIONES,
    });
  }
  if (method === 'ping') return respuesta(id, {});
  if (method === 'tools/list') return respuesta(id, { tools: HERRAMIENTAS });
  if (method === 'tools/call') {
    const accion = ACCIONES[params?.name];
    if (!accion) return fallo(id, -32602, `No existe la herramienta ${params?.name}`);
    try {
      return respuesta(id, { content: [{ type: 'text', text: await accion(params.arguments ?? {}) }] });
    } catch (e) {
      return respuesta(id, { content: [{ type: 'text', text: `No se pudo: ${e.message}` }], isError: true });
    }
  }
  return fallo(id, -32601, `Método no disponible: ${method}`);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, accept, mcp-protocol-version, mcp-session-id, authorization',
};

export async function manejar(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  // Sin sesiones ni avisos del servidor: solo peticiones POST con su respuesta.
  if (req.method !== 'POST') return new Response('Rumbo MCP: usa POST', { status: 405, headers: { ...CORS, Allow: 'POST, OPTIONS' } });
  let mensaje;
  try {
    mensaje = await req.json();
  } catch {
    return Response.json(fallo(null, -32700, 'JSON no válido'), { status: 400, headers: CORS });
  }
  const respuestas = (await Promise.all([mensaje].flat().map(atender))).filter(Boolean);
  if (!respuestas.length) return new Response(null, { status: 202, headers: CORS });
  return Response.json(Array.isArray(mensaje) ? respuestas : respuestas[0], { headers: CORS });
}

if (typeof Deno !== 'undefined') Deno.serve(manejar);
