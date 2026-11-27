import {
  extraerLugares, parecido, organizar, distanciaKm, largo, extremosDelDia, minutosUtiles, enlaceLugar, enlacesRuta,
  enlaceSeguro, fotoDe, diasValidos, validarViajes, TIPOS_CONSEJO, coincide, tramosRuta, claveRuta, duracion, horarioDelDia, tiempoDe, bandera,
  empaquetar, desempaquetar, mismoViaje, actualizarViaje, CATEGORIAS, adivinarCategoria, mejorHueco,
  ordenarDias, estanciaDe, minutosTramo, hora, agenda, datosNube,
} from './logica.js';
import {
  IDIOMA, buscarCiudades, buscarLugar, buscarFoto, buscarIdeas, buscarVuelo, calcularLlegada, recomendar, estiloMapa, rutaReal, buscarHorarios, prevision, buscarComida, nube, escucharViaje, avisarCambio,
} from './fuentes.js';

const CLAVE = 'rumbo';
// Tonos oscuros para que el número blanco se lea encima.
const COLORES = ['#c2362b', '#1f6fb2', '#2f7d3b', '#8a3fa8', '#a85a00', '#00757a', '#b02a6b'];
const color = (dia) => (dia ? COLORES[(dia - 1) % COLORES.length] : '#5d7079');
const $ = (id) => document.getElementById(id);
const CLAVE_MAPAS = 'rumbo-mapas';
// Google Maps por defecto: es el único que abre la ruta con todas las paradas.
const appMapas = () => (['apple', 'waze'].includes(localStorage.getItem(CLAVE_MAPAS)) ? localStorage.getItem(CLAVE_MAPAS) : 'google');

let temporizador;
let viajes = cargar();
let abierto = null;
let pantalla = null;
let filtro = null;
const categoria = (id) => CATEGORIAS.find((c) => c.id === id) ?? CATEGORIAS.at(-1);
let mapa = null;

function cargar() {
  const crudo = localStorage.getItem(CLAVE);
  if (!crudo) return [];
  try {
    return validarViajes(JSON.parse(crudo));
  } catch {
    localStorage.setItem(`${CLAVE}-dañado-${Date.now()}`, crudo);
    avisar('No se pudieron leer los viajes. He guardado aparte los datos originales.');
    return [];
  }
}

function persistir() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ viajes }));
  } catch {
    avisar('No se pudo guardar: no queda espacio. Exporta una copia ahora.');
  }
}

function guardar() {
  for (const v of viajes) if (v.nube && sincronizado.get(v.id) !== JSON.stringify(datosNube(v))) programarSubida(v);
  persistir();
  pintar();
}

// ===== Viajes compartidos
// Lo último enviado o recibido de cada viaje compartido, para subir solo cuando algo cambia de verdad.
const sincronizado = new Map();
const subidas = new Map();

function programarSubida(v) {
  v.nube.pendiente = true;
  clearTimeout(subidas.get(v.id));
  subidas.set(v.id, setTimeout(() => subir(v.id), 1500));
}

async function subir(id) {
  subidas.delete(id);
  const v = viajes.find((x) => x.id === id);
  if (!v?.nube) return;
  const datos = datosNube(v);
  try {
    let version = await nube.guardar(v.nube.id, datos, v.nube.version);
    // Si el otro móvil guardó antes, gana el último cambio: el nuestro.
    if (version === null) {
      const actual = await nube.leer(v.nube.id);
      if (!actual) return;
      version = await nube.guardar(v.nube.id, datos, actual.version);
    }
    if (version === null) {
      programarSubida(v);
      return;
    }
    Object.assign(v.nube, { version, pendiente: false });
    sincronizado.set(v.id, JSON.stringify(datos));
    persistir();
    avisarCambio(v.nube.id);
  } catch { /* sin conexión: queda pendiente y se sube al volver la conexión */ }
}

/** Trae la versión de la nube si es más nueva y no hay cambios propios sin subir. */
async function bajar(id) {
  const v = viajes.find((x) => x.id === id);
  if (!v?.nube || v.nube.pendiente || subidas.has(id)) return;
  const actual = await nube.leer(v.nube.id).catch(() => null);
  if (!actual || actual.version <= v.nube.version || v.nube.pendiente) return;
  const codigo = v.nube.id;
  const [recibido] = validarViajes({ viajes: [{ lugares: [], ...actual.datos, id: v.id }] });
  actualizarViaje(v, recibido);
  v.nube = { id: codigo, version: actual.version, pendiente: false };
  sincronizado.set(v.id, JSON.stringify(datosNube(v)));
  guardar();
}

function escuchar(v) {
  escucharViaje(v.nube.id, () => bajar(v.id));
}

/** Al abrir o volver a la app: sube lo pendiente y trae lo que hayan cambiado los demás. */
function ponerAlDia() {
  for (const v of viajes.filter((x) => x.nube)) {
    if (v.nube.pendiente) subir(v.id);
    else bajar(v.id);
  }
}

function iniciarNube() {
  for (const v of viajes.filter((x) => x.nube)) {
    sincronizado.set(v.id, v.nube.pendiente ? '' : JSON.stringify(datosNube(v)));
    escuchar(v);
  }
  ponerAlDia();
  addEventListener('online', ponerAlDia);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ponerAlDia(); });
}

function avisar(mensaje) {
  $('aviso').textContent = mensaje;
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { $('aviso').textContent = ''; }, 5000);
}

function el(etiqueta, props = {}, ...hijos) {
  const { color: c, ...resto } = props;
  const nodo = Object.assign(document.createElement(etiqueta), resto);
  if (c) nodo.style.setProperty('--c', c);
  nodo.append(...hijos.filter((h) => h !== null));
  return nodo;
}
const boton = (textContent, onclick, className = 'suave') => el('button', { type: 'button', textContent, onclick, className });
const enlace = (texto, href, className = 'boton') => el('a', { className, target: '_blank', rel: 'noopener noreferrer', textContent: texto, href });
// Trazos de 24×24 con el color del texto.
const ICONOS = {
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  compartir: '<path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  borrar: '<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="m6 6 1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14"/><path d="M10 11v6M14 11v6"/>',
  avion: '<path d="M2 16.5 22 9c-.5-1.8-2.3-2.6-4-2L14 8.5 7 4 5 5l4.5 5-4 1.5L3 10l-1.5 1L5 14z"/><path d="M3 21h18"/>',
  ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  ojoTachado: '<path d="M10.7 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/><path d="m2 2 20 20"/>',
  ajustes: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
};
function botonIcono(nombre, etiqueta, onclick, className = '') {
  const b = el('button', { type: 'button', className: `icono ${className}`.trim(), ariaLabel: etiqueta, title: etiqueta, onclick });
  b.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[nombre]}</svg>`;
  return b;
}
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function pintar() {
  mapa?.remove();
  mapa = null;
  const viaje = viajes.find((v) => v.id === abierto);
  if (viaje && pantalla === 'consejos') pintarConsejos(viaje);
  else if (viaje) pintarViaje(viaje);
  else pintarInicio();
}

const nivel = (id, a) => (a ? 2 : id ? 1 : 0);

/** Cambia de pantalla anotándola en el historial, para que el gesto y el botón de atrás vuelvan a la anterior. */
function ir(id, a = null) {
  if (id !== abierto) filtro = null;
  const estado = { abierto: id, pantalla: a, nivel: nivel(id, a) };
  if (estado.nivel > (history.state?.nivel ?? 0)) history.pushState(estado, '');
  else history.replaceState(estado, '');
  abierto = id;
  pantalla = a;
  pintar();
  scrollTo(0, 0);
}

function volver() {
  if (history.state?.nivel) history.back();
  else ir(null);
}

addEventListener('popstate', (e) => {
  abierto = e.state?.abierto ?? null;
  pantalla = e.state?.pantalla ?? null;
  pintar();
  scrollTo(0, 0);
});

// En Safari el borde izquierdo ya va atrás con el historial; instalada en el iPhone no hay gesto, así que se hace aquí.
function gestoAtras() {
  if (!navigator.standalone && !matchMedia('(display-mode: standalone)').matches) return;
  const vista = $('vista');
  let toque = null;
  const soltar = (dx) => {
    const atras = toque?.activo && (dx > innerWidth / 3 || (dx > 40 && dx / (Date.now() - toque.t) > 0.5));
    toque = null;
    vista.style.transition = 'transform .2s ease-out';
    vista.style.transform = atras ? `translateX(${innerWidth}px)` : '';
    setTimeout(() => {
      vista.style.transition = '';
      vista.style.transform = '';
      document.body.classList.remove('deslizando');
      if (atras) volver();
    }, 200);
  };
  addEventListener('touchstart', (e) => {
    const [t] = e.touches;
    if (e.touches.length > 1 || t.clientX > 30 || !abierto || document.querySelector('dialog[open]') || e.target.closest('#mapa')) return;
    toque = { x: t.clientX, y: t.clientY, t: Date.now(), activo: false };
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    if (!toque) return;
    const [t] = e.touches;
    const dx = t.clientX - toque.x;
    const dy = t.clientY - toque.y;
    if (!toque.activo) {
      if (Math.abs(dy) > 10 && Math.abs(dy) > dx) toque = null;
      if (!toque || dx < 10) return;
      toque.activo = true;
      // La barra fija se movería con la pantalla al desplazarla: se esconde mientras dura el gesto.
      document.body.classList.add('deslizando');
    }
    e.preventDefault();
    vista.style.transform = `translateX(${Math.max(0, dx)}px)`;
  }, { passive: false });
  addEventListener('touchend', (e) => { if (toque?.activo) soltar(e.changedTouches[0].clientX - toque.x); else toque = null; });
  addEventListener('touchcancel', () => { if (toque?.activo) soltar(0); else toque = null; });
}

function pintarInicio() {
  $('vista').replaceChildren(
    el('div', { className: 'arriba' }, el('h1', { textContent: 'Rumbo' }), botonIcono('ajustes', 'Ajustes', abrirAjustes)),
    el('p', { className: 'tenue', textContent: 'Tus viajes, parada a parada.' }),
    viajes.length
      ? el('ul', { className: 'lista' }, ...viajes.map((v) => el('li', {}, el('button', { type: 'button', className: 'viaje', onclick: () => ir(v.id) },
        v.pais ? el('span', { className: 'bandera', ariaHidden: 'true', textContent: bandera(v.pais) }) : null,
        el('span', { className: 'nombre' }, el('strong', { textContent: v.nombre }),
          el('small', { textContent: `${v.destino} · ${plural(v.dias, 'día', 'días')} · ${plural(v.lugares.length, 'lugar', 'lugares')}` })),
        el('span', { className: 'puntos', ariaHidden: 'true' }, ...Array.from({ length: Math.min(v.dias, 5) }, (_, i) => el('i', { color: color(i + 1) })))))))
      : el('p', { textContent: 'Crea tu primer viaje: elige ciudad y te propongo qué ver.' }),
    el('div', { className: 'barra' }, el('div', { className: 'fila' }, boton('Nuevo viaje', () => editarViaje(), 'fuerte'))),
  );
  completarPaises();
}

// Los viajes creados antes de guardar el país lo buscan por su destino, una vez por sesión.
let buscandoPaises = false;
async function completarPaises() {
  if (buscandoPaises) return;
  buscandoPaises = true;
  let alguno = false;
  for (const v of viajes.filter((x) => !x.pais && x.destino)) {
    try {
      const [ciudadGuardada, ...pais] = v.destino.split(',');
      const opciones = await buscarCiudades(ciudadGuardada.trim());
      const elegida = opciones.find((o) => pais.length && o.destino.endsWith(pais.at(-1).trim())) ?? opciones[0];
      if (elegida?.pais) {
        v.pais = elegida.pais;
        alguno = true;
      }
    } catch { /* sin conexión: queda sin bandera */ }
  }
  if (alguno) guardar();
}

function pintarViaje(v) {
  const dias = Array.from({ length: v.dias }, (_, i) => i + 1);
  const deDia = (d) => v.lugares.filter((l) => l.dia === d);
  const sueltos = deDia(0);
  const divMapa = v.lugares.length ? el('div', { id: 'mapa' }) : null;

  $('vista').replaceChildren(...[
    el('div', { className: 'arriba' },
      boton('‹ Viajes', volver, 'texto'),
      el('div', { className: 'iconos' },
        botonIcono('editar', 'Editar viaje', () => editarViaje(v)),
        botonIcono('avion', 'Vuelos y hotel', () => abrirLogistica(v)),
        botonIcono('compartir', 'Compartir viaje', () => compartirViaje(v)),
        botonIcono('borrar', 'Borrar viaje', () => borrarViaje(v), 'peligro'))),
    el('h1', { textContent: v.nombre }),
    el('p', { className: 'tenue', textContent: [v.destino, plural(v.dias, 'día', 'días'), v.nube ? '☁️ compartido' : ''].filter(Boolean).join(' · ') }),
    el('button', { type: 'button', className: 'abrir-consejos', onclick: () => ir(v.id, 'consejos') },
      el('span', { textContent: '📝 Notas y consejos' }),
      el('small', { textContent: [v.nota ? 'nota' : '', v.consejos.length ? plural(v.consejos.length, 'consejo', 'consejos') : ''].filter(Boolean).join(' · ') || 'vacío' }),
      el('span', { ariaHidden: 'true', textContent: '›' })),
    filtrosCategoria(v),
    divMapa,
    v.lugares.length ? null : el('p', { textContent: 'Aún no hay lugares. Mira las ideas o pega el texto de una publicación.' }),
    sueltos.length ? seccionDia(v, 0, sueltos) : null,
    ...dias.map((d) => seccionDia(v, d, deDia(d))),
    creditos(v),
    el('div', { className: 'barra' }, el('div', { className: 'fila' },
      v.lugares.length > 1 ? boton('Organizar', () => organizarViaje(v)) : null,
      boton('Ideas', () => abrirIdeas(v), 'fuerte'),
      boton('Añadir', () => abrirLugares(), 'fuerte'))),
  ].filter(Boolean));
  if (divMapa) pintarMapa(divMapa, v);
  completarFotos(v);
  completarHorarios(v);
  completarRutas(v);
  completarTiempo(v);
}

function puntosDelDia(v, dia, lugares) {
  const { inicio, fin } = extremosDelDia(v, dia);
  return [inicio, ...lugares, fin].filter(Boolean);
}

function fechaDelDia(v, dia) {
  if (!v.fecha) return '';
  const f = new Date(`${v.fecha}T12:00:00`);
  f.setDate(f.getDate() + dia - 1);
  return f.toLocaleDateString(IDIOMA, { weekday: 'short', day: 'numeric', month: 'short' });
}

function fechaISO(v, dia) {
  const f = new Date(`${v.fecha}T12:00:00Z`);
  f.setUTCDate(f.getUTCDate() + dia - 1);
  return f.toISOString().slice(0, 10);
}
const diaSemana = (v, dia) => (v.fecha ? new Date(`${fechaISO(v, dia)}T12:00:00Z`).getUTCDay() : null);

const tiempos = new Map();
function textoTiempo(v, dia) {
  const t = v.fecha && tiempos.get(v.id)?.[fechaISO(v, dia)];
  if (!t || t.max === null) return '';
  const { icono, nombre } = tiempoDe(t.codigo);
  return `${icono} ${Math.round(t.max)}°/${Math.round(t.min)}° ${nombre}${t.lluvia >= 20 ? `, ${t.lluvia}% lluvia` : ''}`;
}

/** Previsión de los días del viaje que caen en los próximos 16 días; una petición por viaje y hora. */
async function completarTiempo(v) {
  if (!v.fecha || !v.zona) return;
  const hoy = new Date().toISOString().slice(0, 10);
  const limite = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);
  const desde = [fechaISO(v, 1), hoy].sort()[1];
  const hasta = [fechaISO(v, v.dias), limite].sort()[0];
  const clave = `${v.zona.lat},${v.zona.lon},${desde},${hasta},${Math.floor(Date.now() / 36e5)}`;
  if (desde > hasta || tiempos.get(v.id)?.clave === clave) return;
  tiempos.set(v.id, { clave });
  try {
    tiempos.set(v.id, { clave, ...(await prevision(v.zona, desde, hasta)) });
    if (abierto === v.id) pintar();
  } catch { /* sin previsión: el día se muestra sin el tiempo */ }
}

// La 2 guarda cada tramo en coche o a pie por separado; la anterior se descarta.
const CLAVE_RUTAS = 'rumbo-rutas-2';
try { localStorage.removeItem('rumbo-rutas'); } catch { /* nada que limpiar */ }
const rutas = (() => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_RUTAS)) ?? {};
  } catch {
    return {};
  }
})();
const rutasFallidas = new Set();
const rutaDe = (puntos) => rutas[claveRuta(puntos)];

// shortcut: el orden sigue saliendo de la línea recta; la ruta real solo da tiempos y el dibujo.
let calculandoRutas = false;
async function completarRutas(v) {
  if (calculandoRutas) return;
  const pendientes = Array.from({ length: v.dias }, (_, i) => {
    const lugares = v.ocultos.includes(i + 1) ? [] : v.lugares.filter((l) => l.dia === i + 1);
    return lugares.length ? puntosDelDia(v, i + 1, lugares) : [];
  }).filter((p) => p.length > 1 && p.length <= 50 && !rutaDe(p) && !rutasFallidas.has(claveRuta(p)));
  if (!pendientes.length) return;
  calculandoRutas = true;
  for (const puntos of pendientes) {
    const clave = claveRuta(puntos);
    try {
      const tramos = [];
      for (const t of tramosRuta(puntos)) tramos.push(await rutaReal(t.puntos, t.modo === 'pie'));
      if (tramos.every(Boolean)) rutas[clave] = { tramos };
      else rutasFallidas.add(clave);
    } catch {
      rutasFallidas.add(clave);
    }
  }
  // Solo se guardan las 100 últimas para no llenar el almacenamiento.
  Object.keys(rutas).slice(0, -100).forEach((c) => delete rutas[c]);
  try {
    localStorage.setItem(CLAVE_RUTAS, JSON.stringify(rutas));
  } catch { /* sin espacio: se recalculan la próxima vez */ }
  calculandoRutas = false;
  if (abierto === v.id) pintar();
}

let buscandoHorarios = false;
async function completarHorarios(v) {
  const pendientes = v.lugares.filter((l) => l.horario === undefined);
  if (buscandoHorarios || !pendientes.length) return;
  buscandoHorarios = true;
  try {
    const horarios = await buscarHorarios(pendientes);
    for (const [id, horario] of horarios) {
      const vigente = v.lugares.find((x) => x.id === id);
      if (vigente) vigente.horario = horario;
    }
    buscandoHorarios = false;
    guardar();
  } catch {
    // Sin conexión o servidor ocupado: se reintenta al volver a abrir la app, no en cada repintado.
    pendientes.forEach((l) => { l.horario = null; });
    buscandoHorarios = false;
  }
}

const kmTexto = (km) => (km < 1 ? `${Math.round(km * 100) * 10} m` : `${km.toLocaleString('es', { maximumFractionDigits: 1 })} km`);
const MODOS = { coche: '🚗', pie: '🚶' };

/** Totales en coche y a pie del día. */
function textoRuta(real) {
  return ['coche', 'pie'].map((modo) => {
    const tramos = real.tramos.filter((t) => t.modo === modo);
    if (!tramos.length) return '';
    const km = tramos.reduce((s, t) => s + t.km, 0);
    const min = tramos.reduce((s, t) => s + t.min, 0);
    return `${MODOS[modo]} ${kmTexto(km)} (${duracion(min)})`;
  }).filter(Boolean).join(' + ');
}

/** Cómo se llega a cada punto desde el anterior: en coche o andando, con distancia y tiempo. */
const llegadas = (real) => [null, ...real.tramos.flatMap((t) => t.piernas.map((p) => ({ ...p, modo: t.modo })))];
function lineaTramo(llegada) {
  if (!llegada) return null;
  return el('small', { className: `tramo tramo-${llegada.modo}`, textContent: `${MODOS[llegada.modo]} ${duracion(llegada.min)} · ${kmTexto(llegada.km)}` });
}

function lineaHorario(v, l) {
  if (!l.horario) return null;
  const semana = l.dia ? diaSemana(v, l.dia) : null;
  const horas = semana === null ? null : horarioDelDia(l.horario, semana);
  if (horas?.length === 0) return el('small', { className: 'horario cerrado', textContent: '⚠ Cerrado ese día' });
  const bonito = (h) => h.replace('-', '–');
  return el('small', { className: 'horario', textContent: horas ? `Ese día abre ${horas.map(bonito).join(' y ')}` : `Horario: ${l.horario}` });
}

const lugarAeropuerto = (a) => (a ? `${a.ciudad || a.nombre} (${a.iata})` : '');
function lineaVuelo(v, dia) {
  const lineas = [];
  if (dia === 1 && v.ida) {
    const { llegada, estimada, numero, hasta } = v.ida;
    lineas.push(['Llegada', llegada && `${llegada}${estimada ? ' aprox.' : ''}`, numero, lugarAeropuerto(hasta)]);
  }
  if (dia === v.dias && v.vuelta) lineas.push(['Vuelo de vuelta', v.vuelta.salida, v.vuelta.numero, lugarAeropuerto(v.vuelta.desde)]);
  return lineas.map((l) => el('p', { className: 'vuelo', textContent: `\u2708\uFE0E ${l.filter(Boolean).join(' · ')}` }));
}

/** Botones para ver solo una categoría; aparecen cuando el viaje tiene lugares de más de una. */
function filtrosCategoria(v) {
  const presentes = CATEGORIAS.filter((c) => v.lugares.some((l) => l.tipo === c.id));
  if (presentes.length < 2) return null;
  const chip = (texto, id) => el('button', {
    type: 'button', className: 'chip', textContent: texto, ariaPressed: String(filtro === id),
    onclick: () => { filtro = filtro === id ? null : id; pintar(); },
  });
  return el('div', { className: 'filtros', role: 'group', ariaLabel: 'Ver solo una categoría' },
    chip('Todos', null), ...presentes.map((c) => chip(`${c.icono} ${c.nombre}`, c.id)));
}

function alternarDia(v, dia) {
  v.ocultos = v.ocultos.includes(dia) ? v.ocultos.filter((d) => d !== dia) : [...v.ocultos, dia];
  guardar();
}

/** Un día oculto solo deja su cabecera, y desaparece del mapa, para centrarse en los demás. */
function diaOculto(v, dia, lugares) {
  const seccion = el('section', { className: 'dia oculto', color: color(dia) },
    el('div', { className: 'cabecera' },
      el('h2', { textContent: dia ? `Día ${dia}` : 'Sin día' }),
      el('small', { textContent: `Oculto · ${plural(lugares.length, 'lugar', 'lugares')}` }),
      botonIcono('ojoTachado', `Mostrar ${dia ? `el día ${dia}` : 'los lugares sin día'}`, () => alternarDia(v, dia))));
  seccion.dataset.dia = dia;
  return seccion;
}

function seccionDia(v, dia, lugares) {
  if (v.ocultos.includes(dia)) return diaOculto(v, dia, lugares);
  const ends = dia ? extremosDelDia(v, dia) : {};
  const puntos = dia ? puntosDelDia(v, dia, lugares) : [];
  const real = lugares.length && puntos.length > 1 ? rutaDe(puntos) : null;
  const km = lugares.length ? largo(puntos) : 0;
  const rutas = lugares.length ? enlacesRuta(appMapas(), puntos) : [];
  const llega = real ? llegadas(real) : [];
  const desplazar = ends.inicio && lugares.length ? 1 : 0;
  const ponerNota = (t) => { v.notasDia = { ...v.notasDia, [dia]: t }; };
  const trayectos = lugares.map((l, i) => llega[i + desplazar]?.min
    ?? (i ? minutosTramo(lugares[i - 1], l) : ends.inicio ? minutosTramo(ends.inicio, l) : 0));
  const plan = dia && lugares.length ? agenda(v, dia, lugares, trayectos) : null;
  const resumen = [
    dia && fechaDelDia(v, dia),
    real ? textoRuta(real)
      : km ? `${km.toLocaleString('es', { maximumFractionDigits: 1 })} km en línea recta` : plural(lugares.length, 'lugar', 'lugares'),
    dia && textoTiempo(v, dia),
    dia && !minutosUtiles(v)[dia - 1] ? 'sin tiempo libre por el vuelo' : '',
    plan ? `acabas sobre las ${hora(plan.horas.at(-1).sale)}` : '',
  ].filter(Boolean).join(' · ');
  const seccion = el('section', { className: 'dia', color: color(dia) },
    el('div', { className: 'cabecera' },
      el('h2', { textContent: dia ? `Día ${dia}` : 'Sin día' }),
      dia && !v.notasDia[dia] ? boton('Nota', () => editarNota(`Nota del día ${dia}`, '', ponerNota), 'texto') : null,
      dia && lugares.length ? boton('🍽️ Comer cerca', () => abrirComer(v, dia), 'texto') : null,
      botonIcono('ojo', `Ocultar ${dia ? `el día ${dia}` : 'los lugares sin día'}`, () => alternarDia(v, dia))),
    rutas.length ? el('div', { className: 'fila rutas' },
      ...rutas.map(({ href, modo }, i) => enlace(`${MODOS[modo]} ${rutas.length > 1 ? `Ruta ${i + 1}` : 'Ruta'}`, href, 'boton ruta'))) : null,
    el('small', { textContent: resumen }),
    ...lineaVuelo(v, dia),
    dia ? nota(v.notasDia[dia], `Nota del día ${dia}`, ponerNota) : null,
    el('ol', { className: 'paradas' },
      ends.inicio && lugares.length ? extremo(v, ends.inicio) : null,
      ...lugares.flatMap((l, i) => [
        filtro && l.tipo !== filtro ? null : parada(v, l, i, lugares, llega[i + desplazar], plan?.horas[i]),
        ...(plan?.comidas.filter((c) => c.despues === i).map((c) => avisoComida(v, dia, c, l)) ?? []),
      ]),
      ends.fin && lugares.length ? extremo(v, ends.fin, llega.at(-1)) : null));
  seccion.dataset.dia = dia;
  return seccion;
}

const comoIr = (p) => ({
  google: `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`,
  waze: `https://waze.com/ul?ll=${p.lat},${p.lon}&navigate=yes`,
  apple: `https://maps.apple.com/?daddr=${p.lat},${p.lon}`,
})[appMapas()];

function extremo(v, p, llegada = null) {
  return el('li', { className: 'parada extremo' },
    el('b', { textContent: p.iata ? '\u2708\uFE0E' : 'H' }),
    lineaTramo(llegada),
    el('div', { className: 'fila' }, el('strong', { textContent: p.nombre }), enlace('Ir', comoIr(p))));
}

function nota(texto, titulo, poner) {
  if (!texto) return null;
  return el('button', { type: 'button', className: 'nota', textContent: texto, title: 'Editar nota', onclick: () => editarNota(titulo, texto, poner) });
}

function editarNota(titulo, texto, poner) {
  const f = $('form-nota');
  $('nota-titulo').textContent = titulo;
  f.elements.texto.value = texto ?? '';
  f.onsubmit = () => {
    poner(f.elements.texto.value.trim());
    guardar();
  };
  $('dlg-nota').showModal();
}

function pintarConsejos(v) {
  const ponerNota = (t) => { v.nota = t; };
  $('vista').replaceChildren(...[
    el('div', { className: 'arriba' }, boton(`‹ ${v.nombre}`, volver, 'texto')),
    el('h1', { textContent: 'Notas y consejos' }),
    el('p', { className: 'tenue', textContent: v.destino }),
    el('h2', { className: 'apartado', textContent: 'Nota del viaje' }),
    v.nota ? nota(v.nota, 'Nota del viaje', ponerNota)
      : boton('+ Escribir una nota', () => editarNota('Nota del viaje', '', ponerNota), 'texto'),
    el('h2', { className: 'apartado', textContent: 'Consejos' }),
    seccionConsejos(v) ?? el('p', { className: 'tenue', textContent: 'Apunta dónde comer, dónde no comprar, cómo moverte… Se ordenan solos por tipo.' }),
    el('div', { className: 'barra' }, el('div', { className: 'fila' }, boton('+ Consejo', () => editarConsejo(v), 'fuerte'))),
  ].filter(Boolean));
}

function seccionConsejos(v) {
  if (!v.consejos.length) return null;
  const grupos = TIPOS_CONSEJO.map((t) => [t, v.consejos.filter((c) => c.tipo === t.id)]).filter(([, lista]) => lista.length);
  const secciones = grupos.map(([t, lista]) => {
    const botones = lista.map((c) => Object.assign(
      el('div', { className: 'consejo' },
        el('button', { type: 'button', className: 'nota', textContent: c.texto, title: 'Editar consejo', onclick: () => editarConsejo(v, c) }),
        c.enlace ? enlace('▶ Ver vídeo', c.enlace, 'boton video') : null),
      { buscable: `${t.nombre} ${c.texto}` }));
    return Object.assign(el('section', {}, el('h3', { textContent: `${t.icono} ${t.nombre}` }), ...botones), { botones });
  });
  const vacio = el('p', { className: 'tenue', hidden: true, textContent: 'Ningún consejo se parece a eso.' });
  // Filtra sin repintar para no perder el foco del buscador.
  const filtrar = (e) => {
    let alguno = false;
    for (const s of secciones) {
      for (const b of s.botones) b.hidden = !coincide(e.target.value, b.buscable);
      s.hidden = s.botones.every((b) => b.hidden);
      alguno ||= !s.hidden;
    }
    vacio.hidden = alguno;
  };
  return el('div', { className: 'consejos' },
    v.consejos.length > 3 ? el('input', { type: 'search', placeholder: 'Buscar en los consejos…', ariaLabel: 'Buscar en los consejos', autocomplete: 'off', enterKeyHint: 'search', oninput: filtrar }) : null,
    ...secciones, vacio);
}

/** `inicial` rellena un consejo nuevo, por ejemplo con el texto y el enlace de un reel. */
function editarConsejo(v, c = null, inicial = {}) {
  const f = $('form-consejo');
  $('consejo-titulo').textContent = c ? 'Editar consejo' : 'Nuevo consejo';
  f.elements.tipo.replaceChildren(...TIPOS_CONSEJO.map((t) => el('option', { value: t.id, textContent: `${t.icono} ${t.nombre}` })));
  f.elements.tipo.value = c?.tipo ?? f.dataset.ultimo ?? 'comida';
  f.elements.texto.value = c?.texto ?? inicial.texto ?? '';
  f.elements.enlace.value = c?.enlace ?? inicial.enlace ?? '';
  $('borrar-consejo').hidden = !c;
  $('borrar-consejo').onclick = () => {
    if (!confirm('¿Borrar este consejo?')) return;
    v.consejos = v.consejos.filter((x) => x !== c);
    $('dlg-consejo').close();
    guardar();
  };
  f.onsubmit = () => {
    const texto = f.elements.texto.value.trim();
    const tipo = f.elements.tipo.value;
    const enlaceVideo = enlaceSeguro(f.elements.enlace.value.trim());
    f.dataset.ultimo = tipo;
    if (c && !texto) v.consejos = v.consejos.filter((x) => x !== c);
    else if (c) Object.assign(c, { tipo, texto, enlace: enlaceVideo });
    else if (texto) v.consejos.push({ id: crypto.randomUUID(), tipo, texto, enlace: enlaceVideo });
    guardar();
  };
  $('dlg-consejo').showModal();
}

const opcionesCategoria = () => CATEGORIAS.map((c) => ({ texto: `${c.icono} ${c.nombre}`, valor: c.id }));
function botonCategoria(l) {
  const c = categoria(l.tipo);
  return el('button', {
    type: 'button', className: 'categoria', textContent: c.icono, title: c.nombre, ariaLabel: `Categoría de ${l.nombre}: ${c.nombre}`,
    onclick: async () => {
      const tipo = await preguntar(`¿Qué es ${l.nombre}?`, opcionesCategoria());
      if (tipo) {
        l.tipo = tipo;
        guardar();
      }
    },
  });
}

// De 15 minutos a 6 horas, de cuarto en cuarto.
const ESTANCIAS = Array.from({ length: 24 }, (_, i) => (i + 1) * 15);
/** La hora de la parada; tocarla abre el selector de rueda del móvil para el tiempo que se está allí. */
function botonHoras(l, horas) {
  const actual = estanciaDe(l);
  return el('label', { className: 'horas', title: 'Cambiar el tiempo que estarás aquí' },
    el('span', { textContent: `🕐 ${hora(horas.llega)}–${hora(horas.sale)} · ${duracion(actual)}` }),
    el('select', {
      ariaLabel: `Tiempo en ${l.nombre}`,
      onchange: (e) => {
        l.estancia = Number(e.target.value);
        guardar();
      },
    }, ...[...new Set([...ESTANCIAS, actual])].sort((a, b) => a - b)
      .map((n) => el('option', { value: n, textContent: duracion(n), selected: n === actual }))));
}

function avisoComida(v, dia, comida, l) {
  const texto = comida.tipo === 'comida' ? 'hora de comer' : 'hora de cenar';
  return el('li', { className: 'aviso-comida' },
    el('b', { textContent: '🍽️', ariaHidden: 'true' }),
    el('div', { className: 'fila' },
      el('span', { textContent: `Sobre las ${hora(comida.hora)}, ${texto} cerca de ${l.nombre}` }),
      boton('Buscar sitio', () => abrirComer(v, dia, 'comida'), 'texto')));
}

function parada(v, l, i, hermanos, llegada = null, horas = null) {
  const mover = el('select', {
    ariaLabel: `Día de ${l.nombre}`,
    onchange: (e) => {
      l.dia = Number(e.target.value);
      v.lugares = [...v.lugares.filter((x) => x !== l), l];
      guardar();
    },
  }, ...Array.from({ length: v.dias + 1 }, (_, d) => el('option', { value: d, textContent: d ? `Día ${d}` : 'Sin día', selected: d === l.dia })));
  const subir = boton('↑', () => {
    const a = v.lugares.indexOf(hermanos[i - 1]);
    const b = v.lugares.indexOf(l);
    [v.lugares[a], v.lugares[b]] = [v.lugares[b], v.lugares[a]];
    guardar();
  });
  subir.ariaLabel = `Subir ${l.nombre}`;
  const quitar = botonIcono('borrar', `Quitar ${l.nombre}`, () => {
    if (!confirm(`¿Quitar «${l.nombre}»?`)) return;
    v.lugares = v.lugares.filter((x) => x !== l);
    guardar();
  }, 'peligro');
  const ponerNota = (t) => { l.nota = t; };
  const asa = el('button', { type: 'button', className: 'asa', textContent: '⠿', ariaLabel: `Arrastrar ${l.nombre}`, title: 'Arrastra para mover' });
  const li = el('li', { className: 'parada' },
    el('b', { textContent: i + 1 }),
    asa,
    lineaTramo(llegada),
    el('div', { className: 'ficha' },
      el('div', {},
        el('div', { className: 'nombre-lugar' }, botonCategoria(l), enlace(l.nombre, enlaceLugar(appMapas(), l, v.destino), 'titulo')),
        el('small', { textContent: l.direccion }), lineaHorario(v, l), horas ? botonHoras(l, horas) : null),
      l.foto ? miniatura(l, v.destino) : null),
    nota(l.nota, `Nota de ${l.nombre}`, ponerNota),
    el('div', { className: 'fila' },
      enlace('Ir', comoIr(l)),
      l.enlace ? enlace('Vídeo', l.enlace) : null,
      mover, i ? subir : null,
      l.nota ? null : boton('Nota', () => editarNota(`Nota de ${l.nombre}`, '', ponerNota), 'texto'),
      quitar));
  li.dataset.id = l.id;
  asa.onpointerdown = (e) => arrastrar(e, v, l, li);
  return li;
}

/** Mueve una parada con el dedo o el ratón a otra posición o a otro día. */
function arrastrar(e, v, l, li) {
  if (e.button) return;
  e.preventDefault();
  const hueco = el('li', { className: 'hueco', ariaHidden: 'true' });
  const fantasma = li.cloneNode(true);
  const caja = li.getBoundingClientRect();
  const dy = e.clientY - caja.top;
  Object.assign(fantasma.style, { position: 'fixed', left: `${caja.left}px`, width: `${caja.width}px`, top: `${caja.top}px` });
  fantasma.classList.add('fantasma');
  li.after(hueco);
  li.classList.add('arrastrando');
  // La barra de abajo deja pasar el dedo para poder soltar debajo de ella.
  document.body.classList.add('moviendo');
  document.body.append(fantasma);
  let y = e.clientY;
  // Cerca de los bordes la página se desplaza sola para llegar a otros días.
  let marco = requestAnimationFrame(function desplazar() {
    const borde = 80;
    if (y < borde) scrollBy(0, -12);
    else if (y > innerHeight - borde) scrollBy(0, 12);
    marco = requestAnimationFrame(desplazar);
  });
  const mover = (ev) => {
    y = ev.clientY;
    fantasma.style.top = `${y - dy}px`;
    const debajo = document.elementFromPoint(ev.clientX, y);
    const lista = debajo?.closest('.dia')?.querySelector('.paradas');
    if (!lista) return;
    const otra = debajo.closest('.parada:not(.extremo):not(.arrastrando)');
    if (otra) {
      const { top, height } = otra.getBoundingClientRect();
      otra[y < top + height / 2 ? 'before' : 'after'](hueco);
    } else if (!lista.contains(hueco)) {
      const fin = lista.querySelector('.extremo:last-child:not(:first-child)');
      if (fin) fin.before(hueco);
      else lista.append(hueco);
    }
  };
  const soltar = () => {
    cancelAnimationFrame(marco);
    removeEventListener('pointermove', mover);
    removeEventListener('pointerup', soltar);
    removeEventListener('pointercancel', soltar);
    fantasma.remove();
    document.body.classList.remove('moviendo');
    const dia = Number(hueco.closest('.dia').dataset.dia);
    let siguiente = hueco.nextElementSibling;
    while (siguiente && (!siguiente.dataset.id || siguiente === li)) siguiente = siguiente.nextElementSibling;
    const antes = siguiente && v.lugares.find((x) => x.id === siguiente.dataset.id);
    hueco.remove();
    li.classList.remove('arrastrando');
    const resto = v.lugares.filter((x) => x !== l);
    const sitio = antes ? resto.indexOf(antes) : resto.findLastIndex((x) => x.dia === dia) + 1 || resto.length;
    resto.splice(sitio, 0, l);
    const cambia = l.dia !== dia || resto.some((x, i) => x !== v.lugares[i]);
    l.dia = dia;
    v.lugares = resto;
    if (cambia) guardar();
  };
  addEventListener('pointermove', mover);
  addEventListener('pointerup', soltar);
  addEventListener('pointercancel', soltar);
}

async function pintarMapa(div, v) {
  try {
    const estilo = await estiloMapa(oscuro());
    if (!div.isConnected) return;
    const visibles = v.lugares.filter((l) => !v.ocultos.includes(l.dia));
    const puntos = [...(visibles.length ? visibles : v.lugares), ...v.hoteles].map((l) => [l.lon, l.lat]);
    const limites = puntos.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(puntos[0], puntos[0]));
    mapa = new maplibregl.Map({
      container: div, style: estilo, bounds: limites, fitBoundsOptions: { padding: 40, maxZoom: 15 },
      attributionControl: { compact: true }, dragRotate: false, pitchWithRotate: false,
    });
  } catch {
    div.replaceWith(el('p', { className: 'tenue', textContent: 'No se pudo cargar el mapa. Necesita conexión.' }));
    return;
  }
  const este = mapa;
  este.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
  const porDia = Array.from({ length: v.dias + 1 }, (_, dia) => (v.ocultos.includes(dia) ? [] : v.lugares.filter((l) => l.dia === dia)));
  porDia.forEach((lugares, dia) => lugares.forEach((l, i) => {
    if (filtro && l.tipo !== filtro) return;
    const pin = el('div', { className: 'pin', color: color(dia), textContent: i + 1, title: l.nombre });
    new maplibregl.Marker({ element: pin }).setLngLat([l.lon, l.lat])
      .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setDOMContent(el('strong', { textContent: l.nombre })))
      .addTo(este);
  }));
  for (const h of v.hoteles) {
    new maplibregl.Marker({ element: el('div', { className: 'pin hotel', textContent: 'H', title: h.nombre }) }).setLngLat([h.lon, h.lat])
      .setPopup(new maplibregl.Popup({ offset: 16, closeButton: false }).setDOMContent(el('strong', { textContent: h.nombre }))).addTo(este);
  }
  // En un mapa pequeño la atribución abierta tapa la ruta; queda plegada en su botón.
  const atribucion = div.querySelector('.maplibregl-ctrl-attrib');
  este.once('load', () => {
    atribucion?.classList.remove('maplibregl-compact-show');
    atribucion?.removeAttribute('open');
  });
  este.on('load', () => porDia.forEach((lugares, dia) => {
    const puntos = dia ? puntosDelDia(v, dia, lugares) : [];
    if (!lugares.length || puntos.length < 2) return;
    // En coche, línea continua; andando, a trazos.
    const tramos = rutaDe(puntos)?.tramos ?? tramosRuta(puntos).map((t) => ({ ...t, linea: t.puntos.map((l) => [l.lon, l.lat]) }));
    tramos.forEach((t, i) => {
      const id = `dia-${dia}-${i}`;
      este.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.linea } } });
      este.addLayer({
        id, type: 'line', source: id, layout: { 'line-cap': t.modo === 'pie' ? 'butt' : 'round', 'line-join': 'round' },
        paint: { 'line-color': color(dia), 'line-width': 5, ...(t.modo === 'pie' && { 'line-dasharray': [1.2, 1] }) },
      });
    });
  }));
}

const COCINAS = {
  pizza: 'pizza', italian: 'italiana', spanish: 'española', tapas: 'tapas', burger: 'hamburguesas', sushi: 'sushi', japanese: 'japonesa',
  chinese: 'china', mexican: 'mexicana', indian: 'india', kebab: 'kebab', seafood: 'marisco', vegetarian: 'vegetariana', vegan: 'vegana',
  coffee_shop: 'cafetería', ice_cream: 'helados', regional: 'regional', french: 'francesa', greek: 'griega', thai: 'tailandesa', portuguese: 'portuguesa',
};
const TIPOS_COMER = ['comida', 'cafe', 'copas', 'helado'];
let consultaComer = 0;

/** Mete un sitio en el día, entre las paradas donde menos se desvía la ruta. */
function meterEnDia(v, dia, nuevo) {
  const paradas = v.lugares.filter((l) => l.dia === dia);
  const { inicio } = extremosDelDia(v, dia);
  const k = Math.min(paradas.length, Math.max(0, mejorHueco(puntosDelDia(v, dia, paradas), nuevo) - (inicio ? 1 : 0)));
  const sitio = paradas[k] ? v.lugares.indexOf(paradas[k]) : paradas.length ? v.lugares.indexOf(paradas.at(-1)) + 1 : v.lugares.length;
  v.lugares.splice(sitio, 0, { id: crypto.randomUUID(), enlace: '', nota: '', ...nuevo, dia });
}

/** Restaurantes, cafés, bares y heladerías cerca de las paradas de un día, para añadirlos a su ruta. */
async function abrirComer(v, dia, inicial = null) {
  const esta = ++consultaComer;
  const paradas = v.lugares.filter((l) => l.dia === dia);
  const semana = diaSemana(v, dia);
  const lista = $('comer-lista');
  const estado = $('estado-comer');
  const aceptar = $('anadir-comer');
  let tipo = 'comida';
  let sitios = [];
  const marcados = new Set();
  $('comer-titulo').textContent = `Comer cerca · Día ${dia}`;
  aceptar.disabled = true;
  lista.replaceChildren();
  $('comer-tipos').replaceChildren();
  estado.textContent = 'Buscando sitios cerca de las paradas…';
  if (!$('dlg-comer').open) $('dlg-comer').showModal();

  const horas = (s) => (s.horario && semana !== null ? horarioDelDia(s.horario, semana) : null);
  const pintarLista = () => {
    $('comer-tipos').replaceChildren(...TIPOS_COMER.map((t) => {
      const n = sitios.filter((s) => s.tipo === t).length;
      return el('button', {
        type: 'button', className: 'chip', ariaPressed: String(tipo === t), disabled: !n,
        textContent: `${categoria(t).icono} ${categoria(t).nombre} (${n})`, onclick: () => { tipo = t; pintarLista(); },
      });
    }));
    // Primero lo que abre ese día y está más cerca; lo que cierra, al final.
    const busca = $('buscar-comer').value.trim();
    const visibles = sitios.filter((s) => s.tipo === tipo && coincide(busca, `${s.nombre} ${s.cocinaTexto}`))
      .sort((a, b) => (horas(a)?.length === 0) - (horas(b)?.length === 0) || a.km - b.km).slice(0, 40);
    estado.textContent = visibles.length ? '' : busca ? 'Ningún sitio se parece a eso.' : 'No hay sitios de este tipo cerca.';
    lista.replaceChildren(...visibles.map((s, i) => {
      const h = horas(s);
      const detalle = [
        s.cocinaTexto,
        `a ${kmTexto(s.km)} de ${s.cerca}`,
        h === null ? '' : h.length ? `abre ${h.map((x) => x.replace('-', '–')).join(' y ')}` : 'cerrado ese día',
      ].filter(Boolean).join(' · ');
      const id = `comer-${i}`;
      return el('div', { className: 'hallazgo' },
        el('input', {
          type: 'checkbox', id, checked: marcados.has(s),
          onchange: (e) => { if (e.target.checked) marcados.add(s); else marcados.delete(s); aceptar.disabled = !marcados.size; },
        }),
        el('div', {},
          el('label', { htmlFor: id }, el('strong', { textContent: s.nombre }), el('small', { className: h?.length === 0 ? 'cerrado' : '', textContent: ` ${detalle}` })),
          // OpenStreetMap no tiene valoraciones: Google Maps enseña las estrellas, las fotos y la carta.
          enlace('⭐ Opiniones y fotos ↗', enlaceLugar('google', s, v.destino), 'opiniones')));
    }));
  };
  $('buscar-comer').value = '';
  $('buscar-comer').oninput = pintarLista;

  const lento = setTimeout(() => {
    if (esta === consultaComer && !sitios.length) estado.textContent = 'Los servidores de mapas van lentos. Sigo buscando…';
  }, 10000);
  try {
    const encontrados = await buscarComida(puntosDelDia(v, dia, paradas));
    clearTimeout(lento);
    if (esta !== consultaComer) return;
    sitios = encontrados
      .filter((s) => !v.lugares.some((l) => distanciaKm(l, s) < 0.05 && parecido(l.nombre, s.nombre) >= 0.5))
      .map((s) => {
        const cerca = paradas.reduce((a, b) => (distanciaKm(b, s) < distanciaKm(a, s) ? b : a));
        const cocinaTexto = s.cocina.split(';').map((c) => COCINAS[c.trim()] ?? c.trim().replace(/_/g, ' ')).filter(Boolean).join(', ');
        return { ...s, km: distanciaKm(cerca, s), cerca: cerca.nombre, cocinaTexto };
      });
  } catch {
    clearTimeout(lento);
    if (esta !== consultaComer) return;
    estado.textContent = 'No se pudo buscar: los servidores de mapas van lentos o no hay conexión.';
    lista.replaceChildren(boton('Reintentar', () => abrirComer(v, dia, inicial), 'suave'));
    return;
  }
  tipo = [inicial, ...TIPOS_COMER].find((t) => t && sitios.some((s) => s.tipo === t)) ?? 'comida';
  pintarLista();
  $('form-comer').onsubmit = () => {
    for (const { km, cerca, cocina, cocinaTexto, ...s } of marcados) meterEnDia(v, dia, s);
    guardar();
  };
}

async function organizarViaje(v) {
  const como = await preguntar('¿Cómo lo organizo?', [
    { texto: '🗺️ Todo el viaje', detalle: 'La ruta más corta: reparte los lugares entre los días y puede cambiarlos de día', valor: 'todo' },
    v.lugares.some((l) => l.dia) ? { texto: '📅 Cada día por separado', detalle: 'Solo ordena las paradas de cada día; ninguna cambia de día', valor: 'dias' } : null,
  ]);
  if (!como) return;
  v.lugares = como === 'todo' ? organizar(v) : ordenarDias(v);
  guardar();
}

// Mientras no haya días asignados, la ruta se calcula sola; después se respeta lo que haya.
function anadir(v, nuevos) {
  const sinOrganizar = v.lugares.every((l) => !l.dia);
  v.lugares.push(...nuevos.map((l) => ({
    enlace: '', nota: '', ...l, tipo: l.tipo || adivinarCategoria(`${l.nombre} ${l.direccion ?? ''}`), id: crypto.randomUUID(), dia: 0,
  })));
  if (sinOrganizar) v.lugares = organizar(v);
  guardar();
}

function miniatura(l, destino) {
  const img = el('img', { src: fotoDe(l.foto, 250), alt: `Ver ${l.nombre} en el mapa`, loading: 'lazy', decoding: 'async', width: 88, height: 88 });
  const ver = enlace('', enlaceLugar(appMapas(), l, destino), 'foto');
  ver.append(img);
  img.onerror = () => ver.remove();
  return ver;
}

function creditos(v) {
  const conAutor = v.lugares.filter((l) => l.foto && l.autoria);
  if (!conAutor.length) return null;
  return el('details', { className: 'creditos' }, el('summary', { textContent: 'Autoría de las fotos (Wikimedia Commons)' }),
    ...conAutor.map((l) => enlace(l.nombre, l.autoria, '')));
}

let completando = false;
async function completarFotos(v) {
  if (completando) return;
  completando = true;
  let alguna = false;
  try {
    for (const l of v.lugares.filter((x) => x.foto === undefined)) {
      const hallada = await buscarFoto(l);
      // Organizar sustituye los objetos mientras se busca: se guarda en el vigente.
      const vigente = v.lugares.find((x) => x.id === l.id);
      if (vigente) Object.assign(vigente, hallada);
      alguna = true;
    }
  } catch { /* sin conexión: se reintenta al volver a abrir el viaje */ }
  completando = false;
  if (alguna) guardar();
}

/** Zona del viaje. Los creados antes del buscador de ciudades la resuelven aquí por su nombre. */
async function zonaDe(v) {
  if (v.zona) return v.zona;
  const [ciudadGuardada, ...pais] = v.destino.split(',');
  const opciones = await buscarCiudades(ciudadGuardada.trim());
  const elegida = opciones.find((o) => pais.length && o.destino.endsWith(pais.at(-1).trim())) ?? opciones[0];
  if (!elegida) return null;
  Object.assign(v, { zona: elegida.zona, destino: elegida.destino });
  guardar();
  return v.zona;
}

function borrarViaje(v) {
  if (!confirm(`¿Borrar «${v.nombre}» y sus lugares? No se puede deshacer.`)) return;
  viajes = viajes.filter((x) => x !== v);
  guardar();
  volver();
}

let ciudad = null;
let pulsacion;
let consultaCiudad = 0;

function elegirCiudad(opcion) {
  const campo = $('form-viaje').elements.destino;
  ciudad = opcion;
  consultaCiudad++;
  campo.value = opcion.destino;
  campo.setCustomValidity('');
  $('ciudades').replaceChildren();
}

async function sugerirCiudades() {
  const texto = $('form-viaje').elements.destino.value.trim();
  const esta = ++consultaCiudad;
  if (texto.length < 2) {
    $('ciudades').replaceChildren();
    return;
  }
  let contenido;
  try {
    const opciones = await buscarCiudades(texto);
    contenido = opciones.length
      ? opciones.map((o) => el('button', { type: 'button', className: 'ciudad', onclick: () => elegirCiudad(o) },
        el('span', { textContent: o.destino }), o.region ? el('small', { textContent: o.region }) : null))
      : [el('p', { className: 'tenue', textContent: 'No encuentro esa ciudad.' })];
  } catch {
    contenido = [el('p', { className: 'tenue', textContent: 'No se pudo buscar. Revisa la conexión.' })];
  }
  if (esta === consultaCiudad) $('ciudades').replaceChildren(...contenido);
}

$('form-viaje').elements.destino.oninput = (e) => {
  ciudad = null;
  e.target.setCustomValidity('Elige una ciudad de la lista.');
  clearTimeout(pulsacion);
  pulsacion = setTimeout(sugerirCiudades, 300);
};

function editarViaje(v) {
  const f = $('form-viaje');
  f.reset();
  ciudad = null;
  consultaCiudad++;
  clearTimeout(pulsacion);
  $('ciudades').replaceChildren();
  f.elements.destino.setCustomValidity('');
  $('viaje-titulo').textContent = v ? 'Editar viaje' : 'Nuevo viaje';
  if (v) for (const campo of ['nombre', 'destino', 'dias']) f.elements[campo].value = v[campo];
  f.onsubmit = () => {
    const datos = {
      nombre: f.elements.nombre.value.trim() || ciudad?.nombre || v?.nombre || 'Viaje',
      dias: diasValidos(f.elements.dias.value),
      ...(ciudad && { destino: ciudad.destino, zona: ciudad.zona, pais: ciudad.pais }),
    };
    if (v) {
      Object.assign(v, datos);
      v.lugares.forEach((l) => { if (l.dia > v.dias) l.dia = 0; });
      v.hoteles.forEach((h) => { h.desde = Math.min(h.desde, v.dias); });
      v.ocultos = v.ocultos.filter((d) => d <= v.dias);
      guardar();
      return;
    }
    const [nuevo] = validarViajes({ viajes: [{ ...datos, lugares: [] }] });
    viajes.unshift(nuevo);
    guardar();
    ir(nuevo.id);
    abrirIdeas(nuevo);
  };
  $('dlg-viaje').showModal();
}

const ideasDe = new Map();
let consultaIdeas = 0;
let consultaBusqueda = 0;
let pulsacionIdeas;
const simple = (t) => t.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

async function abrirIdeas(v) {
  const esta = ++consultaIdeas;
  const lista = $('ideas');
  const campo = $('buscar-ideas');
  const estado = $('estado-ideas');
  const aceptar = $('anadir-ideas');
  const elegidas = new Set();
  const tarjetas = new Map();
  const contar = () => {
    aceptar.disabled = !elegidas.size;
    aceptar.textContent = elegidas.size ? `Añadir ${plural(elegidas.size, 'lugar', 'lugares')}` : 'Añadir';
  };
  const repetida = (i, otros) => otros.some((l) => parecido(l.nombre, i.nombre) >= 0.5 && distanciaKm(l, i) < 0.5);

  const tarjeta = (idea) => {
    const marca = el('input', { type: 'checkbox' });
    marca.onchange = () => {
      if (marca.checked) elegidas.add(idea);
      else elegidas.delete(idea);
      contar();
    };
    const ver = enlace('↗', enlaceLugar(appMapas(), idea, v.destino), 'ver');
    ver.ariaLabel = `Ver ${idea.nombre} en el mapa, con valoraciones`;
    return el('div', { className: 'idea' },
      el('label', {}, marca,
        idea.foto ? el('img', { src: fotoDe(idea.foto, 330), alt: '', loading: 'lazy', decoding: 'async' }) : el('span', { className: 'sinfoto', textContent: idea.nombre.charAt(0) }),
        el('span', { textContent: idea.nombre }), el('small', { textContent: idea.direccion })),
      ver);
  };
  const poner = (idea, hallada) => {
    if (repetida(idea, v.lugares) || repetida(idea, [...tarjetas.keys()])) return;
    const nodo = tarjeta(idea);
    tarjetas.set(idea, nodo);
    nodo.hallada = hallada;
    lista.append(nodo);
  };
  // Lo elegido nunca se oculta ni se borra al cambiar la búsqueda.
  const filtrar = (texto) => {
    for (const [idea, nodo] of tarjetas) {
      const encaja = simple(idea.nombre).includes(simple(texto));
      if (nodo.hallada && !elegidas.has(idea)) {
        nodo.remove();
        tarjetas.delete(idea);
      } else nodo.hidden = !encaja && !elegidas.has(idea);
    }
  };
  const buscar = async (texto) => {
    const turno = ++consultaBusqueda;
    estado.textContent = 'Buscando…';
    try {
      const zona = await zonaDe(v);
      const halladas = zona ? await buscarIdeas(texto, zona, v.destino) : [];
      if (turno !== consultaBusqueda || esta !== consultaIdeas) return;
      halladas.forEach((i) => poner(i, true));
      const visibles = [...tarjetas].some(([i, n]) => !n.hidden && !elegidas.has(i));
      estado.textContent = visibles ? '' : 'No encuentro ese sitio, o ya está en tu viaje.';
    } catch {
      if (turno === consultaBusqueda && esta === consultaIdeas) estado.textContent = 'No se pudo buscar. Revisa la conexión.';
    }
  };

  campo.value = '';
  campo.oninput = () => {
    const texto = campo.value.trim();
    consultaBusqueda++;
    clearTimeout(pulsacionIdeas);
    estado.textContent = '';
    filtrar(texto);
    if (texto.length > 2) pulsacionIdeas = setTimeout(() => buscar(texto), 600);
  };
  $('ideas-titulo').textContent = `Qué ver en ${v.destino.split(',')[0]}`;
  $('form-ideas').onsubmit = () => anadir(v, [...elegidas]);
  contar();
  lista.replaceChildren();
  estado.textContent = 'Buscando los lugares más conocidos…';
  if (!$('dlg-ideas').open) $('dlg-ideas').showModal();
  let ideas;
  try {
    const zona = await zonaDe(v);
    const clave = JSON.stringify(zona);
    ideas = zona ? ideasDe.get(clave) ?? await recomendar(zona) : [];
    if (zona) ideasDe.set(clave, ideas);
  } catch {
    if (esta === consultaIdeas) estado.replaceChildren('No se pudieron cargar las ideas. ', boton('Reintentar', () => abrirIdeas(v)));
    return;
  }
  if (esta !== consultaIdeas) return;
  ideas.forEach((i) => poner(i, false));
  filtrar(campo.value.trim());
  if (!campo.value) estado.textContent = tarjetas.size ? '' : 'No tengo más ideas para esta zona. Usa el buscador.';
}

// Intro en el buscador cierra el teclado en vez de enviar el formulario.
$('buscar-ideas').onkeydown = (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.target.blur();
};

$('dlg-ideas').onclose = () => {
  consultaIdeas++;
  clearTimeout(pulsacionIdeas);
  $('ideas').replaceChildren();
};

let borrador = null;
let pendientes = 0;
const campoVuelo = (tipo, campo) => $('form-logistica').elements[`${tipo}-${campo}`];

async function conEspera(tarea) {
  pendientes++;
  $('guardar-logistica').disabled = true;
  try {
    return await tarea();
  } finally {
    pendientes--;
    $('guardar-logistica').disabled = pendientes > 0;
  }
}

function describirVuelo(v, tipo, aviso = '') {
  const vuelo = borrador[tipo];
  const partes = [];
  if (vuelo.desde) partes.push(`${vuelo.aerolinea}: ${lugarAeropuerto(vuelo.desde)} → ${lugarAeropuerto(vuelo.hasta)}.`);
  if (vuelo.estimada && vuelo.llegada) partes.push('Llegada calculada por la distancia: corrígela si sabes la exacta.');
  const aeropuerto = tipo === 'ida' ? vuelo.hasta : vuelo.desde;
  if (aeropuerto && v.zona && distanciaKm(aeropuerto, v.zona) > Math.max(150, v.zona.radio)) {
    partes.push(`Ojo: ese aeropuerto está lejos de ${v.destino.split(',')[0]}. Revisa el número.`);
  }
  partes.push(aviso);
  $(`info-${tipo}`).replaceChildren(partes.filter(Boolean).join(' '),
    ...(vuelo.numero ? [' ', enlace('Ver horario', `https://www.google.com/search?${new URLSearchParams({ q: `vuelo ${vuelo.numero}` })}`, '')] : []));
}

async function calcularVuelo(v, tipo) {
  const mio = borrador;
  const vuelo = mio[tipo];
  if (!vuelo.desde || !vuelo.salida || (vuelo.llegada && !vuelo.estimada)) return;
  let aviso = '';
  try {
    const r = await conEspera(() => calcularLlegada(vuelo, $('form-logistica').elements.fecha.value));
    if (mio !== borrador) return;
    Object.assign(vuelo, { llegada: r.hora, estimada: true });
    campoVuelo(tipo, 'llegada').value = r.hora;
    if (r.masDias) aviso = r.masDias > 0 ? 'Llega al día siguiente de salir.' : 'Llega el día anterior, por el cambio de hora.';
  } catch {
    aviso = 'No pude calcular la llegada.';
  }
  if (mio === borrador) describirVuelo(v, tipo, aviso);
}

async function cambiarNumero(v, tipo) {
  const mio = borrador;
  const numero = campoVuelo(tipo, 'numero').value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  campoVuelo(tipo, 'numero').value = numero;
  const vuelo = Object.assign(mio[tipo], { numero, aerolinea: '', desde: null, hasta: null });
  if (vuelo.estimada) {
    Object.assign(vuelo, { llegada: '', estimada: false });
    campoVuelo(tipo, 'llegada').value = '';
  }
  if (!numero) {
    describirVuelo(v, tipo);
    return;
  }
  if (!/^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(numero)) {
    describirVuelo(v, tipo, 'Escribe el número como IB3150.');
    return;
  }
  $(`info-${tipo}`).textContent = 'Buscando el vuelo…';
  let aviso = 'No conozco ese vuelo. Puedes poner las horas a mano.';
  try {
    const datos = await conEspera(() => buscarVuelo(numero));
    if (mio !== borrador || vuelo.numero !== numero) return;
    if (datos) {
      Object.assign(vuelo, datos);
      aviso = vuelo.salida || vuelo.llegada ? '' : 'Pon la hora de salida y calculo la llegada.';
    }
  } catch {
    aviso = 'No se pudo buscar el vuelo. Puedes poner las horas a mano.';
  }
  if (mio !== borrador) return;
  describirVuelo(v, tipo, aviso);
  await calcularVuelo(v, tipo);
}

function pintarHoteles(v) {
  $('hoteles').replaceChildren(...borrador.hoteles.map((h) => {
    const quitar = boton('Quitar', () => {
      borrador.hoteles = borrador.hoteles.filter((x) => x !== h);
      pintarHoteles(v);
    }, 'texto peligro');
    const desde = el('select', { ariaLabel: `Primer día en ${h.nombre}`, onchange: (e) => { h.desde = Number(e.target.value); } },
      ...Array.from({ length: v.dias }, (_, i) => el('option', { value: i + 1, textContent: `Desde el día ${i + 1}`, selected: h.desde === i + 1 })));
    return el('div', { className: 'hotel-fila' }, el('strong', { textContent: h.nombre }), el('small', { textContent: h.direccion }), el('div', { className: 'fila' }, desde, quitar));
  }));
}

async function buscarHotel(v) {
  const mio = borrador;
  const texto = $('hotel-texto').value.trim();
  const caja = $('hoteles-encontrados');
  if (texto.length < 3) return;
  caja.textContent = 'Buscando…';
  try {
    const zona = await zonaDe(v);
    const { opciones } = zona ? await buscarLugar(texto, v.destino, zona) : { opciones: [] };
    if (mio !== borrador) return;
    caja.replaceChildren(...(opciones.length ? opciones.map((o) => el('button', {
      type: 'button', className: 'ciudad', onclick: () => {
        const ultimo = Math.max(0, ...borrador.hoteles.map((h) => h.desde));
        borrador.hoteles.push({ ...o, desde: Math.min(v.dias, ultimo + 1) });
        $('hotel-texto').value = '';
        caja.replaceChildren();
        pintarHoteles(v);
      },
    }, el('span', { textContent: o.nombre }), el('small', { textContent: o.direccion }))) : ['No lo encuentro. Prueba con la calle y el número.']));
  } catch {
    if (mio === borrador) caja.textContent = 'No se pudo buscar. Revisa la conexión.';
  }
}

function abrirLogistica(v) {
  const f = $('form-logistica');
  f.reset();
  f.elements.fecha.value = v.fecha;
  borrador = structuredClone({ ida: v.ida, vuelta: v.vuelta, hoteles: v.hoteles });
  for (const tipo of ['ida', 'vuelta']) {
    borrador[tipo] ??= { numero: '', aerolinea: '', salida: '', llegada: '', estimada: false, desde: null, hasta: null };
    for (const campo of ['numero', 'salida', 'llegada']) campoVuelo(tipo, campo).value = borrador[tipo][campo];
    campoVuelo(tipo, 'numero').onchange = () => cambiarNumero(v, tipo);
    campoVuelo(tipo, 'salida').onchange = (e) => {
      borrador[tipo].salida = e.target.value;
      calcularVuelo(v, tipo);
    };
    campoVuelo(tipo, 'llegada').onchange = (e) => {
      Object.assign(borrador[tipo], { llegada: e.target.value, estimada: false });
      describirVuelo(v, tipo);
    };
    describirVuelo(v, tipo);
  }
  pintarHoteles(v);
  $('hoteles-encontrados').replaceChildren();
  $('hotel-buscar').onclick = () => buscarHotel(v);
  $('hotel-texto').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    buscarHotel(v);
  };
  f.onsubmit = () => {
    const antes = JSON.stringify([v.ida, v.vuelta, v.hoteles]);
    const lleno = (x) => (x.numero || x.salida || x.llegada ? x : null);
    Object.assign(v, { fecha: f.elements.fecha.value, ida: lleno(borrador.ida), vuelta: lleno(borrador.vuelta), hoteles: borrador.hoteles });
    const cambia = antes !== JSON.stringify([v.ida, v.vuelta, v.hoteles]);
    if (cambia && v.lugares.length && confirm('¿Recalculo los días y las rutas con estos vuelos y hoteles? Cambiará el orden actual.')) v.lugares = organizar(v);
    guardar();
  };
  $('dlg-logistica').showModal();
}
$('dlg-logistica').onclose = () => { borrador = null; };

let busqueda = 0;
let hallazgos = [];

function vaciarResultados(...contenido) {
  busqueda++;
  hallazgos = [];
  $('resultados').replaceChildren(...contenido);
  $('buscar').disabled = false;
  $('anadir').disabled = true;
}

function abrirLugares() {
  $('form-lugares').reset();
  vaciarResultados();
  $('dlg-lugares').showModal();
}

const actualizarAnadir = () => { $('anadir').disabled = !hallazgos.some((h) => h.marca.checked); };

async function buscar() {
  const v = viajes.find((x) => x.id === abierto);
  const nombres = extraerLugares($('form-lugares').elements.texto.value);
  vaciarResultados();
  if (!nombres.length) {
    vaciarResultados(el('p', { textContent: 'No veo ningún lugar en ese texto. Escribe un nombre por línea.' }));
    return;
  }
  const esta = busqueda;
  const estado = el('p', { className: 'tenue' });
  $('resultados').append(estado);
  $('buscar').disabled = true;
  const zona = await zonaDe(v).catch(() => null);
  if (esta !== busqueda) return;
  if (!zona) {
    vaciarResultados(el('p', { textContent: 'No encuentro la ciudad del viaje. Revisa la conexión o edita el viaje y elígela de la lista.' }));
    return;
  }
  for (const [i, nombre] of nombres.entries()) {
    estado.textContent = `Buscando ${i + 1} de ${nombres.length}…`;
    let hallado = { opciones: [], seguro: false };
    let fallo = '';
    try {
      hallado = await buscarLugar(nombre, v.destino, zona);
      if (!hallado.opciones.length) fallo = 'No encontrado';
    } catch {
      fallo = 'No se pudo buscar. Revisa la conexión.';
    }
    if (esta !== busqueda) return;
    mostrarHallazgo(nombre, hallado, fallo);
  }
  estado.textContent = 'Revisa las direcciones antes de añadir.';
  $('buscar').disabled = false;
}

function mostrarHallazgo(nombre, { opciones, seguro }, fallo) {
  const marca = el('input', { type: 'checkbox', checked: seguro, disabled: !opciones.length, onchange: actualizarAnadir, ariaLabel: `Añadir ${nombre}` });
  const elegir = el('select', { ariaLabel: `Dirección de ${nombre}` },
    ...opciones.map((o, i) => el('option', { value: i, textContent: [o.nombre, o.direccion].filter(Boolean).join(' · ') })));
  const propuesta = adivinarCategoria(`${nombre} ${opciones[0]?.direccion ?? ''}`);
  const tipo = el('select', { ariaLabel: `Categoría de ${nombre}` },
    ...CATEGORIAS.map((c) => el('option', { value: c.id, textContent: `${c.icono} ${c.nombre}`, selected: c.id === propuesta })));
  $('resultados').append(el('div', { className: 'hallazgo' }, marca,
    el('div', {}, el('strong', { textContent: nombre }), fallo || !seguro ? el('p', { className: 'tenue', textContent: fallo || 'Dudoso: elige la opción correcta y márcala.' }) : null,
      fallo ? null : elegir, fallo ? null : tipo)));
  if (opciones.length) hallazgos.push({ nombre, marca, elegido: () => opciones[elegir.value], tipo: () => tipo.value });
  actualizarAnadir();
}

$('buscar').onclick = buscar;
// Un reel con recomendaciones (dónde comer, qué evitar…) se guarda entero como consejo, con su enlace.
$('como-consejo').onclick = () => {
  const v = viajes.find((x) => x.id === abierto);
  const f = $('form-lugares');
  const inicial = { texto: f.elements.texto.value.trim(), enlace: enlaceSeguro(f.elements.enlace.value.trim()) };
  $('dlg-lugares').close();
  editarConsejo(v, null, inicial);
};
$('form-lugares').elements.texto.oninput = () => vaciarResultados();
$('dlg-lugares').onclose = () => vaciarResultados();
$('form-lugares').onsubmit = (e) => {
  const v = viajes.find((x) => x.id === abierto);
  const elegidos = hallazgos.filter((h) => h.marca.checked);
  if (!elegidos.length) { e.preventDefault(); return; }
  const enlace = enlaceSeguro($('form-lugares').elements.enlace.value.trim());
  anadir(v, elegidos.map((h) => ({ ...h.elegido(), nombre: h.nombre, enlace, tipo: h.tipo() })));
};
document.querySelectorAll('[data-cerrar]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });
// Las hojas en las que solo se elige algo se cierran tocando fuera, como en el resto de apps.
for (const id of ['dlg-elegir', 'dlg-ajustes', 'dlg-comer']) {
  $(id).addEventListener('click', (e) => {
    if (e.target !== e.currentTarget) return;
    const r = e.currentTarget.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.currentTarget.close();
  });
}

const CLAVE_TEMA = 'rumbo-tema';
const oscuro = () => {
  const tema = document.documentElement.dataset.tema;
  return tema ? tema === 'oscuro' : matchMedia('(prefers-color-scheme: dark)').matches;
};
function ponerTema(tema) {
  if (tema) document.documentElement.dataset.tema = tema;
  else delete document.documentElement.dataset.tema;
  try {
    if (tema) localStorage.setItem(CLAVE_TEMA, tema);
    else localStorage.removeItem(CLAVE_TEMA);
  } catch { /* sin almacenamiento: vale para esta sesión */ }
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => {
    m.media = tema ? 'all' : m.dataset.media;
    if (tema) m.content = oscuro() ? '#0e181d' : '#ffffff';
    else m.content = m.dataset.color;
  });
  pintar();
}

function abrirAjustes() {
  const f = $('form-ajustes');
  f.elements.mapas.value = appMapas();
  f.elements.tema.value = document.documentElement.dataset.tema ?? '';
  f.elements.mapas.onchange = (e) => localStorage.setItem(CLAVE_MAPAS, e.target.value);
  f.elements.tema.onchange = (e) => ponerTema(e.target.value);
  $('exportar').onclick = exportar;
  $('importar').onclick = () => { $('dlg-ajustes').close(); $('archivo').click(); };
  $('buscar-version').onclick = () => { $('dlg-ajustes').close(); buscarVersion(); };
  $('version').textContent = '';
  versionActual().then((n) => { $('version').textContent = n ? `Versión ${n}` : ''; });
  $('dlg-ajustes').showModal();
}
document.querySelectorAll('meta[name=theme-color]').forEach((m) => Object.assign(m.dataset, { media: m.media, color: m.content }));

let registro = null;
let recargando = false;

function ofrecerVersion(nueva) {
  if (!nueva || !navigator.serviceWorker.controller) return;
  $('actualizar').onclick = () => {
    recargando = true;
    $('actualizar').disabled = true;
    nueva.postMessage('actualizar');
  };
  $('actualizacion').hidden = false;
}

/** Avisa cuando hay una versión publicada más nueva y la aplica al pulsar, sin reinstalar la app. */
async function vigilarVersiones() {
  if (!navigator.serviceWorker) return;
  registro = await navigator.serviceWorker.register('sw.js').catch(() => null);
  if (!registro) return;
  ofrecerVersion(registro.waiting);
  registro.onupdatefound = () => {
    const nueva = registro.installing;
    nueva.onstatechange = () => { if (nueva.state === 'installed') ofrecerVersion(nueva); };
  };
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (recargando) location.reload(); });
  // Las apps instaladas pasan días abiertas en segundo plano: se mira al volver a ellas.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') registro.update().catch(() => {});
  });
}

async function buscarVersion() {
  if (!registro) {
    avisar('Las actualizaciones necesitan abrir Rumbo desde su web.');
    return;
  }
  try {
    await registro.update();
  } catch {
    avisar('No se pudo comprobar. Revisa la conexión.');
    return;
  }
  if (!registro.installing && !registro.waiting) avisar('Ya tienes la última versión.');
}

async function versionActual() {
  const claves = (await caches?.keys().catch(() => [])) ?? [];
  return claves.filter((c) => c.startsWith('rumbo-')).map((c) => Number(c.slice(6))).sort((a, b) => b - a)[0];
}

/** Sube el viaje a la nube la primera vez; el enlace corto lleva solo su código. */
async function enlaceCompartido(v) {
  if (!v.nube) {
    const datos = datosNube(v);
    v.nube = { id: await nube.crear(datos), version: 1, pendiente: false };
    sincronizado.set(v.id, JSON.stringify(datos));
    persistir();
    escuchar(v);
    pintar();
  }
  return `${location.origin}${location.pathname}#v=${v.nube.id}`;
}

async function compartirViaje(v) {
  let url;
  let texto = `Mi viaje a ${v.destino} en Rumbo. Lo que cambiemos se verá en los dos móviles.`;
  try {
    url = await enlaceCompartido(v);
  } catch {
    // Sin conexión: el enlace largo lleva el viaje dentro, pero es una copia que no se sincroniza.
    url = `${location.origin}${location.pathname}#viaje=${await empaquetar(v)}`;
    texto = `Mi viaje a ${v.destino} en Rumbo`;
    avisar('Sin conexión: el enlace lleva una copia del viaje que no se actualizará sola.');
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: v.nombre, text: texto, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    avisar('Enlace copiado. Quien lo abra podrá añadir el viaje a su Rumbo.');
  } catch {
    avisar('No se pudo copiar el enlace.');
  }
}

// El viaje va tras # para que nunca llegue al servidor.
async function recibirViaje() {
  const [, codigo] = /^#v=([a-z0-9]{8,40})$/.exec(location.hash) ?? [];
  if (codigo) {
    recibirCompartido(codigo);
    return;
  }
  const [, paquete] = /^#viaje=([\w-]+)$/.exec(location.hash) ?? [];
  if (!paquete) return;
  history.replaceState(null, '', location.pathname);
  try {
    const v = await desempaquetar(paquete);
    // Un enlace del mismo viaje que ya está guardado lo actualiza en vez de añadirlo otra vez.
    const mio = mismoViaje(viajes, v);
    if (mio) {
      if (!confirm(`Ya tienes «${mio.nombre}». ¿Lo actualizo con los cambios de este enlace? Lo que tengas en tu copia se sustituirá.`)) return;
      actualizarViaje(mio, v);
      guardar();
      ir(mio.id);
      avisar('Viaje actualizado.');
      return;
    }
    if (!confirm(`¿Añadir «${v.nombre}» (${v.destino}) a tus viajes?`)) return;
    viajes.unshift(v);
    guardar();
    ir(v.id);
    avisar('Viaje añadido.');
  } catch (error) {
    avisar(error.message);
  }
}

/** Abre un viaje compartido por enlace corto: si ya está guardado lo pone al día, si no lo añade. */
async function recibirCompartido(codigo) {
  history.replaceState(null, '', location.pathname);
  const mio = viajes.find((x) => x.nube?.id === codigo);
  if (mio) {
    ir(mio.id);
    bajar(mio.id);
    return;
  }
  let actual;
  try {
    actual = await nube.leer(codigo);
  } catch {
    avisar('No se pudo abrir el viaje compartido. Revisa la conexión.');
    return;
  }
  if (!actual) {
    avisar('Ese viaje compartido ya no existe.');
    return;
  }
  const [v] = validarViajes({ viajes: [{ lugares: [], ...actual.datos, id: '', nube: { id: codigo, version: actual.version } }] });
  if (!confirm(`¿Añadir «${v.nombre}» (${v.destino})? Es un viaje compartido: lo que cambie cualquiera se verá en los dos móviles.`)) return;
  viajes.unshift(v);
  sincronizado.set(v.id, JSON.stringify(datosNube(v)));
  guardar();
  ir(v.id);
  escuchar(v);
  avisar('Viaje compartido añadido.');
}

/** Lista de opciones en una hoja; devuelve el valor elegido o null si se cancela. */
function preguntar(titulo, opciones) {
  return new Promise((resolver) => {
    const dlg = $('dlg-elegir');
    let valor = null;
    $('elegir-titulo').textContent = titulo;
    $('elegir-opciones').replaceChildren(...opciones.filter(Boolean).map((o) => el('button', {
      type: 'button', className: 'ciudad', onclick: () => { valor = o.valor; dlg.close(); },
    }, el('span', { textContent: o.texto }), o.detalle ? el('small', { textContent: o.detalle }) : null)));
    dlg.onclose = () => resolver(valor);
    dlg.showModal();
  });
}

// Lo que llega desde el botón de compartir de otra app (Instagram, TikTok…), con la app instalada en Android.
async function recibirPublicacion() {
  const q = new URLSearchParams(location.search);
  if (!q.has('compartir')) return;
  history.replaceState(null, '', location.pathname);
  const todo = [q.get('titulo'), q.get('texto'), q.get('enlace')].filter(Boolean).join('\n');
  const enlaceVisto = enlaceSeguro(q.get('enlace') ?? '') || enlaceSeguro(/https?:\/\/\S+/.exec(todo)?.[0] ?? '');
  const texto = todo.replace(/https?:\/\/\S+/g, '').trim();
  if (!viajes.length) {
    avisar('Crea primero un viaje para guardar lo que compartes.');
    return;
  }
  const v = viajes.length === 1 ? viajes[0] : await preguntar('¿A qué viaje lo añado?',
    viajes.map((x) => ({ texto: `${bandera(x.pais)} ${x.nombre}`.trim(), detalle: x.destino, valor: x })));
  if (!v) return;
  ir(v.id);
  const que = await preguntar('¿Qué hago con esto?', [
    { texto: '📍 Buscar lugares', detalle: 'Saca los sitios del texto y los añade al viaje', valor: 'lugares' },
    { texto: '💡 Guardar como consejo', detalle: 'Dónde comer, qué evitar, cómo moverse…', valor: 'consejo' },
    v.lugares.length ? { texto: '📝 Nota de un sitio', detalle: 'Lo guarda en un lugar que ya está en el viaje', valor: 'nota' } : null,
  ]);
  if (que === 'consejo') editarConsejo(v, null, { texto, enlace: enlaceVisto });
  if (que === 'lugares') {
    abrirLugares();
    const f = $('form-lugares');
    f.elements.enlace.value = enlaceVisto;
    f.elements.texto.value = texto;
    if (texto) buscar();
  }
  if (que === 'nota') {
    const l = await preguntar('¿En qué sitio?', v.lugares.map((x) => ({
      texto: `${categoria(x.tipo).icono} ${x.nombre}`, detalle: x.dia ? `Día ${x.dia}` : 'Sin día', valor: x,
    })));
    if (!l) return;
    const nueva = [l.nota, texto, enlaceVisto].filter(Boolean).join('\n\n');
    editarNota(`Nota de ${l.nombre}`, nueva, (t) => {
      l.nota = t;
      if (!l.enlace && enlaceVisto) l.enlace = enlaceVisto;
    });
  }
}

async function exportar() {
  const archivo = new File([JSON.stringify({ viajes }, null, 2)], `rumbo-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  if (navigator.canShare?.({ files: [archivo] })) {
    try {
      await navigator.share({ files: [archivo] });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(archivo);
  el('a', { href: url, download: archivo.name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

$('archivo').onchange = async (e) => {
  const archivo = e.target.files[0];
  if (!archivo) return;
  try {
    const nuevos = validarViajes(JSON.parse(await archivo.text()));
    if (viajes.length && !confirm(`Se sustituirán tus ${plural(viajes.length, 'viaje', 'viajes')} por los ${nuevos.length} de la copia. ¿Seguir?`)) return;
    viajes = nuevos;
    abierto = null;
    guardar();
    avisar('Copia importada.');
  } catch (error) {
    avisar(error instanceof SyntaxError ? 'El archivo no es una copia de Rumbo.' : error.message);
  } finally {
    $('archivo').value = '';
  }
};

ponerTema(document.documentElement.dataset.tema);
gestoAtras();
recibirViaje();
// Si Rumbo ya estaba abierto, un enlace nuevo solo cambia lo que va tras # y no recarga la página.
addEventListener('hashchange', recibirViaje);
recibirPublicacion();
navigator.storage?.persist?.();
vigilarVersiones();
iniciarNube();
