import {
  extraerLugares, parecido, organizar, distanciaKm, largo, extremosDelDia, minutosUtiles, enlaceLugar, enlacesRuta,
  enlaceSeguro, fotoDe, diasValidos, validarViajes, TIPOS_CONSEJO, coincide, tramosRuta, claveRuta, duracion, horarioDelDia, tiempoDe, bandera,
  empaquetar, desempaquetar, mismoViaje, actualizarViaje, CATEGORIAS, adivinarCategoria, mejorHueco,
  ordenarDias, estanciaDe, minutosTramo, hora, agenda, datosNube, fusionar, resumenCambios,
  atardecer, salidaAeropuerto, monedaDe, avisoHorario, teselasDe,
} from './logica.js';
import {
  IDIOMA, buscarCiudades, buscarLugar, buscarFoto, buscarIdeas, buscarVuelo, calcularLlegada, recomendar, estiloMapa, rutaReal, rutaPublica, guardarSinConexion, CACHE_MAPAS, buscarHorarios, prevision, buscarComida, nube, escucharViaje, avisarCambio, estarEn, husoDe, cambiosDelEuro,
} from './fuentes.js';
import { NOVEDADES } from './novedades.js';

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

const igual = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const tieneCambios = (v) => v.nube && !igual(datosNube(v), v.nube.base);
// La base se guarda aparte: si compartiera listas con el viaje, cambiaría con él y no se notaría nada.
const copiaNube = (v) => structuredClone(datosNube(v));

function guardar() {
  for (const v of viajes) if (tieneCambios(v)) programarSubida(v);
  persistir();
  pintar();
}

// ===== Viajes compartidos
const CLAVE_NOMBRE = 'rumbo-nombre';
const miNombre = () => localStorage.getItem(CLAVE_NOMBRE) ?? '';
const subidas = new Map();
const subiendo = new Set();
const estados = new Map();
const TEXTO_ESTADO = {
  'al-dia': 'al día', guardando: 'guardando…', pendiente: 'cambios sin subir', 'sin-conexion': 'sin conexión, se subirá al volver',
};

/** Muestra cómo va la sincronización sin repintar la pantalla (repintar mueve el mapa). */
function ponerEstado(v, estado) {
  estados.set(v.id, estado);
  if (abierto === v.id && $('estado-nube')) $('estado-nube').textContent = TEXTO_ESTADO[estado];
}

function programarSubida(v) {
  v.nube.pendiente = true;
  ponerEstado(v, 'pendiente');
  clearTimeout(subidas.get(v.id));
  subidas.set(v.id, setTimeout(() => subir(v.id), 1500));
}

/**
 * Pone en el viaje la versión de la nube. Si aquí había cambios sin subir, junta los de los dos
 * a partir de la última versión común; si no, se queda la de la nube tal cual.
 */
function aplicarRemoto(v, actual) {
  const codigo = v.nube.id;
  const baseAntes = v.nube.base;
  const mia = datosNube(v);
  const suya = datosNube(validarViajes({ viajes: [{ lugares: [], ...actual.datos, id: v.id }] })[0]);
  const propios = !igual(mia, baseAntes);
  const [final] = validarViajes({ viajes: [{ ...(propios ? fusionar(baseAntes, mia, suya) : suya), id: v.id }] });
  actualizarViaje(v, final);
  v.nube = { id: codigo, version: actual.version, pendiente: propios, base: structuredClone(suya) };
  return { suya, baseAntes };
}

function avisarDeOtro(v, { suya, baseAntes }) {
  if (suya.editadoPor !== miNombre() || !miNombre()) avisar(`${suya.editadoPor || 'Alguien'} ${resumenCambios(baseAntes, suya)} en «${v.nombre}».`);
}

async function subir(id) {
  subidas.delete(id);
  const v = viajes.find((x) => x.id === id);
  if (!v?.nube || subiendo.has(id)) return;
  subiendo.add(id);
  ponerEstado(v, 'guardando');
  try {
    v.editadoPor = miNombre();
    let version = await nube.guardar(v.nube.id, datosNube(v), v.nube.version);
    // El otro móvil guardó antes: se juntan los cambios de los dos y se vuelve a guardar.
    if (version === null) {
      const actual = await nube.leer(v.nube.id);
      if (!actual) return;
      avisarDeOtro(v, aplicarRemoto(v, actual));
      version = await nube.guardar(v.nube.id, datosNube(v), actual.version);
      pintar();
    }
    if (version === null) {
      programarSubida(v);
      return;
    }
    v.nube = { ...v.nube, version, pendiente: false, base: copiaNube(v) };
    persistir();
    ponerEstado(v, 'al-dia');
    avisarCambio(v.nube.id);
  } catch {
    ponerEstado(v, 'sin-conexion');
  } finally {
    subiendo.delete(id);
  }
}

/** Trae la versión de la nube si es más nueva, junta lo que haya aquí sin subir y avisa de quién cambió qué. */
async function bajar(id) {
  const v = viajes.find((x) => x.id === id);
  if (!v?.nube || subidas.has(id) || subiendo.has(id)) return;
  const actual = await nube.leer(v.nube.id).catch(() => null);
  if (!actual || actual.version <= v.nube.version || subiendo.has(id)) return;
  avisarDeOtro(v, aplicarRemoto(v, actual));
  guardar();
  if (!v.nube.pendiente) ponerEstado(v, 'al-dia');
}

const presentes = new Map();
const textoPresentes = (nombres) => {
  if (!nombres?.length) return '';
  const quien = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`;
  return ` · 👀 ${quien} ${nombres.length === 1 ? 'también está aquí' : 'también están aquí'}`;
};

function escuchar(v) {
  escucharViaje(v.nube.id, () => bajar(v.id), (nombres) => {
    presentes.set(v.id, nombres);
    if (abierto === v.id && $('presentes')) $('presentes').textContent = textoPresentes(nombres);
  });
}

/** Cuenta a los demás qué viaje compartido está abierto aquí, solo mientras la app está a la vista. */
function anunciarPresencia() {
  const v = viajes.find((x) => x.id === abierto);
  estarEn(v?.nube && document.visibilityState === 'visible' ? v.nube.id : null, miNombre());
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
    // Los compartidos antes de guardar la base parten de lo que hay ahora.
    if (!v.nube.base && !v.nube.pendiente) v.nube.base = copiaNube(v);
    ponerEstado(v, v.nube.pendiente ? 'pendiente' : 'al-dia');
    escuchar(v);
  }
  ponerAlDia();
  addEventListener('online', ponerAlDia);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') ponerAlDia();
    anunciarPresencia();
  });
}

function avisar(mensaje, accion = null) {
  $('aviso').replaceChildren(mensaje, ...(accion ? [' ', el('button', { type: 'button', className: 'texto accion-aviso', textContent: accion.texto, onclick: () => {
    $('aviso').textContent = '';
    accion.hacer();
  } })] : []));
  clearTimeout(temporizador);
  temporizador = setTimeout(() => { $('aviso').textContent = ''; }, accion ? 10000 : 5000);
}

/** Reorganiza los lugares del viaje dejando unos segundos para deshacerlo. */
function reorganizar(v, lugares, mensaje) {
  const antes = v.lugares;
  v.lugares = lugares;
  guardar();
  avisar(mensaje, { texto: 'Deshacer', hacer: () => {
    v.lugares = antes;
    guardar();
    avisar('Orden recuperado.');
  } });
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
  solo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8" fill="currentColor"/>',
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
  anunciarPresencia();
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
      ? el('ul', { className: 'lista' }, ...viajes.map(filaViaje))
      : el('p', { textContent: 'Crea tu primer viaje: elige ciudad y te propongo qué ver.' }),
    boton('📥 Abrir enlace compartido', () => abrirEnlaceCompartido(), 'texto'),
    el('div', { className: 'barra' }, el('div', { className: 'fila' }, boton('Nuevo viaje', () => editarViaje(), 'fuerte'))),
  );
  completarPaises();
}

/** Viaje de la portada. Deslizándolo a la izquierda aparece la papelera para borrarlo. */
function filaViaje(v) {
  const papelera = botonIcono('borrar', `Borrar «${v.nombre}»`, () => borrarViaje(v), 'borrar-viaje');
  papelera.tabIndex = -1;
  const delante = el('button', { type: 'button', className: 'viaje' },
    v.pais ? el('span', { className: 'bandera', ariaHidden: 'true', textContent: bandera(v.pais) }) : null,
    el('span', { className: 'nombre' }, el('strong', { textContent: v.nombre }),
      el('small', { textContent: `${v.destino} · ${plural(v.dias, 'día', 'días')} · ${plural(v.lugares.length, 'lugar', 'lugares')}` })),
    el('span', { className: 'puntos', ariaHidden: 'true' }, ...Array.from({ length: Math.min(v.dias, 5) }, (_, i) => el('i', { color: color(i + 1) }))));
  const fila = el('li', { className: 'fila-viaje' }, papelera, delante);
  const ANCHO = 84;
  let inicio = null;
  let dx = 0;
  let horizontal = null;
  let movido = false;
  const abrir = (si) => {
    fila.classList.toggle('deslizada', si);
    delante.style.transform = si ? `translateX(-${ANCHO}px)` : '';
    papelera.tabIndex = si ? 0 : -1;
  };
  delante.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    inicio = { x: e.clientX, y: e.clientY, abierta: fila.classList.contains('deslizada') };
    horizontal = null;
    movido = false;
  });
  delante.addEventListener('pointermove', (e) => {
    if (!inicio) return;
    const mx = e.clientX - inicio.x;
    const my = e.clientY - inicio.y;
    if (horizontal === null && Math.hypot(mx, my) > 8) {
      horizontal = Math.abs(mx) > Math.abs(my);
      if (horizontal) {
        delante.setPointerCapture(e.pointerId);
        fila.classList.add('moviendose');
      }
    }
    if (!horizontal) return;
    movido = true;
    dx = Math.max(-(ANCHO + 40), Math.min(0, (inicio.abierta ? -ANCHO : 0) + mx));
    delante.style.transform = `translateX(${dx}px)`;
  });
  const soltar = () => {
    if (!inicio) return;
    inicio = null;
    fila.classList.remove('moviendose');
    if (horizontal) abrir(dx < -ANCHO / 2);
  };
  delante.addEventListener('pointerup', soltar);
  delante.addEventListener('pointercancel', soltar);
  delante.onclick = () => {
    // Tras deslizar no se abre el viaje; si estaba abierta la papelera, el toque la cierra.
    if (movido) return;
    if (fila.classList.contains('deslizada')) abrir(false);
    else ir(v.id);
  };
  return fila;
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
    el('p', { className: 'tenue' }, `${v.destino} · ${plural(v.dias, 'día', 'días')}`,
      ...(v.nube ? [' · ☁️ compartido · ', el('span', { id: 'estado-nube', textContent: TEXTO_ESTADO[estados.get(v.id) ?? 'al-dia'] }),
        el('span', { id: 'presentes', textContent: textoPresentes(presentes.get(v.id)) })] : [])),
    el('button', { type: 'button', className: 'abrir-consejos', onclick: () => ir(v.id, 'consejos') },
      el('span', { textContent: '📝 Notas y consejos' }),
      el('small', { textContent: [
        v.tareas.some((t) => !t.hecha) ? plural(v.tareas.filter((t) => !t.hecha).length, 'pendiente', 'pendientes') : '',
        v.consejos.length ? plural(v.consejos.length, 'consejo', 'consejos') : '', v.nota ? 'nota' : '',
      ].filter(Boolean).join(' · ') || 'vacío' }),
      el('span', { ariaHidden: 'true', textContent: '›' })),
    tarjetaHoy(v),
    botonCambio(v),
    botonSinConexion(v),
    avisoSolo(v),
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
  situarPendientes(v);
  completarHorarios(v);
  completarRutas(v);
  completarTiempo(v);
  completarHuso(v);
  completarCambio(v);
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

const husos = new Map();
const claveZona = (z) => `${z.lat.toFixed(2)},${z.lon.toFixed(2)}`;

/** Hora local de la puesta de sol del día, en la zona horaria del destino. */
function textoAtardecer(v, dia) {
  const huso = v.zona && husos.get(claveZona(v.zona));
  if (!v.fecha || !huso) return '';
  const puesta = atardecer(fechaISO(v, dia), v.zona.lat, v.zona.lon);
  return puesta ? `🌅 ${puesta.toLocaleTimeString('es', { timeZone: huso, hour: '2-digit', minute: '2-digit' })}` : '';
}

/** Para organizar: la hora local de la puesta de cada día en minutos, si se sabe la fecha y la zona horaria. */
function conPuesta(v) {
  const huso = v.zona && husos.get(claveZona(v.zona));
  return {
    puesta: (dia) => {
      const puesta = v.fecha && huso && atardecer(fechaISO(v, dia), v.zona.lat, v.zona.lon);
      if (!puesta) return null;
      const [h, m] = puesta.toLocaleTimeString('en-GB', { timeZone: huso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).split(':').map(Number);
      return h * 60 + m;
    },
  };
}

async function completarHuso(v) {
  if (!v.fecha || !v.zona || husos.has(claveZona(v.zona))) return;
  husos.set(claveZona(v.zona), null);
  try {
    husos.set(claveZona(v.zona), await husoDe(v.zona));
    if (abierto === v.id) pintar();
  } catch {
    husos.delete(claveZona(v.zona));
  }
}

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
// Con transporte público la misma ruta da otros tiempos: se guarda aparte.
const claveDe = (v, puntos) => `${v.movilidad === 'publico' ? 'publico:' : ''}${claveRuta(puntos)}`;
const rutaDe = (v, puntos) => rutas[claveDe(v, puntos)];

/** Hora para consultar el transporte público: el mismo día de la semana que ese día del viaje, en los próximos 7 días. */
function cuandoPublico(v, dia) {
  const hoy = new Date();
  const objetivo = diaSemana(v, dia) ?? (hoy.getDay() + 1) % 7;
  const f = new Date(Date.UTC(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + (((objetivo - hoy.getDay() + 7) % 7) || 7), 9));
  return f.toISOString();
}

// shortcut: el orden sigue saliendo de la línea recta; la ruta real solo da tiempos y el dibujo.
let calculandoRutas = false;
async function completarRutas(v, { todos = false } = {}) {
  if (calculandoRutas) return;
  const pendientes = Array.from({ length: v.dias }, (_, i) => {
    const lugares = v.ocultos.includes(i + 1) && !todos ? [] : v.lugares.filter((l) => l.dia === i + 1);
    return { dia: i + 1, puntos: lugares.length ? puntosDelDia(v, i + 1, lugares) : [] };
  }).filter(({ puntos: p }) => p.length > 1 && p.length <= 50 && !rutaDe(v, p) && !rutasFallidas.has(claveDe(v, p)));
  if (!pendientes.length) return;
  calculandoRutas = true;
  for (const { dia, puntos } of pendientes) {
    const clave = claveDe(v, puntos);
    try {
      const tramos = [];
      for (const t of tramosRuta(puntos, v.movilidad)) {
        tramos.push(await (t.modo === 'publico' ? rutaPublica(t.puntos, cuandoPublico(v, dia)) : rutaReal(t.puntos, t.modo === 'pie')));
      }
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
const MODOS = { coche: '🚗', pie: '🚶', publico: '🚇' };

/** Totales del día en coche o transporte público y a pie. */
function textoRuta(real) {
  return ['coche', 'publico', 'pie'].map((modo) => {
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
  const como = llegada.lineas ? llegada.lineas : kmTexto(llegada.km);
  return el('small', { className: `tramo tramo-${llegada.modo}`, textContent: `${MODOS[llegada.modo]} ${duracion(llegada.min)} · ${como}` });
}

function lineaHorario(v, l, plan = null) {
  if (!l.horario) return null;
  const semana = l.dia ? diaSemana(v, l.dia) : null;
  const horas = semana === null ? null : horarioDelDia(l.horario, semana);
  if (horas?.length === 0) return el('small', { className: 'horario cerrado', textContent: '⚠ Cerrado ese día' });
  // Con la hora prevista de llegada, avisa si aún no ha abierto, ya ha cerrado o cierra enseguida.
  const aviso = plan ? avisoHorario(horas, plan.llega) : null;
  if (aviso) {
    const texto = {
      justo: `⚠ Cierra a las ${hora(aviso.cierra)}: llegas a las ${hora(plan.llega)} y solo tendrías ${duracion(aviso.cierra - plan.llega)}`,
      antes: `⚠ Llegas a las ${hora(plan.llega)} y no abre hasta las ${hora(aviso.abre)}`,
      cerrado: `⚠ Llegas a las ${hora(plan.llega)} y cierra a las ${hora(aviso.cierra)}`,
    }[aviso.tipo];
    return el('small', { className: 'horario cerrado', textContent: texto });
  }
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
  return [
    ...lineasHotel(v, dia),
    ...lineas.map((l) => el('p', { className: 'vuelo', textContent: `\u2708\uFE0E ${l.filter(Boolean).join(' · ')}` })),
    ...lineasSalida(v, dia),
  ];
}

/** Cuándo salir hacia el aeropuerto el último día, y el aviso de la víspera si es de madrugada. */
function lineasSalida(v, dia) {
  const s = salidaAeropuerto(v);
  if (!s) return [];
  const cuando = `${s.desdeHotel ? 'Sal del hotel' : 'Sal hacia el aeropuerto'} sobre las ${hora(s.sale)}`;
  const detalle = `para llegar 2 h antes del vuelo (trayecto de unos ${s.trayecto} min)`;
  const lineas = [];
  if (dia === v.dias && !s.anterior) lineas.push(`🚕 ${cuando}, ${detalle}.${s.madrugada && !s.cerca ? ' A esa hora hay poco transporte: mejor taxi reservado.' : ''}`);
  if (dia === v.dias - 1 && s.anterior) lineas.push(`🚕 Esta noche: ${cuando.toLowerCase()}, ${detalle}.`);
  if (dia === v.dias - 1 && s.madrugada && !s.anterior) lineas.push(`🌙 Mañana sales sobre las ${hora(s.sale)}: deja la maleta lista${s.cerca ? '' : ' y el taxi reservado'}.`);
  return lineas.map((t) => el('p', { className: 'vuelo aviso-salida', textContent: t }));
}

/** Check-in el primer día en cada alojamiento y check-out el día que se deja. */
function lineasHotel(v, dia) {
  const hoteles = [...v.hoteles].sort((a, b) => a.desde - b.desde);
  return hoteles.flatMap((h, i) => {
    const deja = hoteles[i + 1]?.desde ?? v.dias;
    return [
      h.desde === dia && (h.checkin || h.notas) ? `🏨 ${h.nombre}${h.checkin ? `: check-in desde las ${h.checkin}` : ''}${h.notas ? ` · ${h.notas}` : ''}` : '',
      deja === dia && h.checkout && (deja !== h.desde || v.dias === 1) ? `🏨 Check-out de ${h.nombre} hasta las ${h.checkout}` : '',
    ].filter(Boolean).map((t) => el('p', { className: 'vuelo', textContent: t }));
  });
}

let tasas = null;
const nombreMoneda = (m) => {
  try {
    return new Intl.DisplayNames(['es'], { type: 'currency' }).of(m);
  } catch {
    return m;
  }
};
const numero = (n, decimales = 2) => n.toLocaleString('es', { maximumFractionDigits: decimales });

async function completarCambio(v) {
  const moneda = monedaDe(v.pais);
  if (!moneda || moneda === 'EUR' || tasas) return;
  try {
    tasas = await cambiosDelEuro();
    if (abierto === v.id && tasas[moneda]) pintar();
  } catch { /* sin conexión: el conversor lo explica al abrirlo */ }
}

/** Botón del conversor para los destinos que no usan euros, con el cambio del día a la vista. */
// Viajes descargados para usar sin conexión: cuándo y con qué lugares, para saber si hay que volver a bajarlos.
const CLAVE_SIN_CONEXION = 'rumbo-sin-conexion';
const descargas = () => {
  try {
    return JSON.parse(localStorage.getItem(CLAVE_SIN_CONEXION)) ?? {};
  } catch {
    return {};
  }
};
const puntosSinConexion = (v) => [...v.lugares, ...v.hoteles, v.ida?.hasta, v.vuelta?.desde].filter(Boolean);
const firmaSinConexion = (v) => claveRuta(puntosSinConexion(v));
let descargando = null;

/** Botón para bajar el mapa, las rutas y las fotos del viaje antes de salir, por si allí no hay datos. */
function botonSinConexion(v) {
  if (!v.lugares.length || !('caches' in window)) return null;
  const hecha = descargas()[v.id];
  const detalle = descargando?.id === v.id ? descargando.texto
    : !hecha ? 'Descarga el mapa, las rutas y las fotos'
      : hecha.firma === firmaSinConexion(v) ? `✅ Listo · descargado el ${new Date(hecha.fecha).toLocaleDateString(IDIOMA, { day: 'numeric', month: 'short' })}`
        : 'Hay cambios: vuelve a descargarlo';
  return el('button', { type: 'button', className: 'abrir-consejos', onclick: () => descargarViaje(v), disabled: Boolean(descargando) },
    el('span', { textContent: '📶 Sin conexión' }),
    el('small', { id: 'estado-sin-conexion', textContent: detalle }),
    el('span', { ariaHidden: 'true', textContent: '›' }));
}

async function descargarViaje(v) {
  if (descargando) return;
  const contar = (texto) => {
    descargando.texto = texto;
    if ($('estado-sin-conexion')) $('estado-sin-conexion').textContent = texto;
  };
  descargando = { id: v.id, texto: 'Calculando las rutas…' };
  pintar();
  try {
    while (calculandoRutas) await new Promise((r) => { setTimeout(r, 300); });
    await completarRutas(v, { todos: true });
    const fotos = v.lugares.filter((l) => l.foto).map((l) => fotoDe(l.foto, 250));
    const fallos = await guardarSinConexion(teselasDe(puntosSinConexion(v)), fotos, (hechas, total) => contar(`Descargando… ${Math.round(hechas / total * 100)} %`));
    localStorage.setItem(CLAVE_SIN_CONEXION, JSON.stringify({ ...descargas(), [v.id]: { fecha: Date.now(), firma: firmaSinConexion(v) } }));
    avisar(fallos ? `Descargado, salvo ${plural(fallos, 'archivo', 'archivos')} que no se pudieron bajar. Puedes reintentarlo.` : 'Listo: el viaje funciona sin conexión.');
  } catch {
    avisar('No se pudo descargar: hace falta conexión. Inténtalo con wifi.');
  }
  descargando = null;
  if (abierto === v.id) pintar();
}

async function borrarDescargas() {
  if (!confirm('¿Borrar los mapas y fotos descargados? Los viajes no se tocan.')) return;
  await caches.delete(CACHE_MAPAS);
  localStorage.removeItem(CLAVE_SIN_CONEXION);
  avisar('Descargas borradas.');
  pintar();
}

function botonCambio(v) {
  const moneda = monedaDe(v.pais);
  if (!moneda || moneda === 'EUR') return null;
  const tasa = tasas?.[moneda];
  return el('button', { type: 'button', className: 'abrir-consejos', onclick: () => abrirCambio(moneda) },
    el('span', { textContent: '💱 Conversor' }),
    el('small', { textContent: tasa ? `1 € = ${numero(tasa)} ${moneda}` : nombreMoneda(moneda) }),
    el('span', { ariaHidden: 'true', textContent: '›' }));
}

function abrirCambio(moneda) {
  const tasa = tasas?.[moneda];
  const f = $('form-cambio');
  f.reset();
  $('cambio-moneda').textContent = `${nombreMoneda(moneda)} (${moneda})`;
  $('cambio-tasa').textContent = tasa ? `1 € = ${numero(tasa, 4)} ${moneda} · 100 ${moneda} = ${numero(100 / tasa)} €` : 'El conversor necesita conexión la primera vez para saber el cambio del día.';
  f.elements.euros.disabled = !tasa;
  f.elements.local.disabled = !tasa;
  f.elements.euros.oninput = () => { f.elements.local.value = f.elements.euros.value ? Math.round(f.elements.euros.value * tasa * 100) / 100 : ''; };
  f.elements.local.oninput = () => { f.elements.euros.value = f.elements.local.value ? Math.round((f.elements.local.value / tasa) * 100) / 100 : ''; };
  $('dlg-cambio').showModal();
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

/** Deja a la vista un solo día (y en el mapa solo su ruta); los demás quedan ocultos. */
function soloDia(v, dia) {
  v.ocultos = Array.from({ length: v.dias + 1 }, (_, d) => d).filter((d) => d !== dia);
  guardar();
  scrollTo(0, 0);
}

/** Si solo se ve un día, cuál; null si se ven varios o ninguno. */
function diaSolo(v) {
  const visibles = Array.from({ length: v.dias + 1 }, (_, d) => d).filter((d) => !v.ocultos.includes(d) && (d || v.lugares.some((l) => !l.dia)));
  return v.dias > 1 && visibles.length === 1 ? visibles[0] : null;
}

function avisoSolo(v) {
  const dia = diaSolo(v);
  if (dia === null) return null;
  return el('div', { className: 'aviso-solo' },
    el('span', { textContent: `👁 Viendo solo ${dia ? `el día ${dia}` : 'los lugares sin día'}` }),
    boton('Ver todos', () => { v.ocultos = []; guardar(); }, 'texto'));
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

/** Ruta, trayectos y horas previstas de un día. */
function calculoDia(v, dia, lugares) {
  const ends = dia ? extremosDelDia(v, dia) : {};
  const puntos = dia ? puntosDelDia(v, dia, lugares) : [];
  const real = lugares.length && puntos.length > 1 ? rutaDe(v, puntos) : null;
  const llega = real ? llegadas(real) : [];
  const desplazar = ends.inicio && lugares.length ? 1 : 0;
  const trayectos = lugares.map((l, i) => llega[i + desplazar]?.min
    ?? (i ? minutosTramo(lugares[i - 1], l, v.movilidad) : ends.inicio ? minutosTramo(ends.inicio, l, v.movilidad) : 0));
  const plan = dia && lugares.length ? agenda(v, dia, lugares, trayectos) : null;
  // El último día, lo que cae después de salir hacia el aeropuerto ya no se puede hacer.
  const salida = dia === v.dias ? salidaAeropuerto(v) : null;
  if (plan && salida && !salida.anterior) {
    plan.comidas = plan.comidas.filter((c) => c.hora < salida.sale);
    plan.horas.forEach((h) => { h.tarde = h.sale > salida.sale; });
  }
  return { ends, puntos, real, llega, desplazar, trayectos, plan };
}

/** Fecha y hora de ahora en el destino (o en el móvil si aún no se sabe su zona horaria). */
function ahoraEn(v) {
  const huso = v.zona && husos.get(claveZona(v.zona));
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: huso || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date());
  const de = (t) => partes.find((p) => p.type === t).value;
  return { fecha: `${de('year')}-${de('month')}-${de('day')}`, min: Number(de('hour')) * 60 + Number(de('minute')) };
}

/** Qué día del viaje es hoy, o null si hoy no se está de viaje. */
function diaDeHoy(v) {
  if (!v.fecha) return null;
  const dia = Math.round((Date.parse(`${ahoraEn(v).fecha}T12:00:00Z`) - Date.parse(`${v.fecha}T12:00:00Z`)) / 864e5) + 1;
  return dia >= 1 && dia <= v.dias ? dia : null;
}

function verDia(dia) {
  document.querySelector(`.dia[data-dia="${dia}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Durante el viaje: dónde toca estar ahora y cuál es la siguiente parada según el plan del día. */
function tarjetaHoy(v) {
  const dia = diaDeHoy(v);
  if (!dia) return null;
  const lugares = v.lugares.filter((l) => l.dia === dia);
  const { plan, trayectos } = calculoDia(v, dia, lugares);
  const ahora = ahoraEn(v).min;
  const i = plan ? plan.horas.findIndex((h) => h.sale > ahora) : -1;
  const actual = i >= 0 && plan.horas[i].llega <= ahora ? i : -1;
  const siguiente = actual >= 0 ? (actual + 1 < lugares.length ? actual + 1 : -1) : i;
  const linea = (texto) => el('p', { textContent: texto });
  const contenido = !lugares.length ? [linea('Hoy no tienes paradas.')]
    : i === -1 ? [linea('Por hoy ya está todo lo del plan. ¡A descansar!')]
      : [
        actual >= 0 ? linea(`Ahora: ${lugares[actual].nombre}, hasta las ${hora(plan.horas[actual].sale)}.`) : null,
        siguiente >= 0 ? el('div', { className: 'fila' },
          el('p', {},
            el('strong', { textContent: `Siguiente: ${lugares[siguiente].nombre}` }), el('br'),
            el('small', { textContent: [
              `en el plan, a las ${hora(plan.horas[siguiente].llega)}`,
              trayectos[siguiente] ? `${duracion(trayectos[siguiente])} de camino: sal a las ${hora(plan.horas[siguiente].llega - trayectos[siguiente])}` : '',
            ].filter(Boolean).join(' · ') })),
          enlace('Ir', comoIr(lugares[siguiente]))) : linea('Es la última parada del día.'),
      ];
  return el('section', { className: 'hoy', ariaLabel: 'Hoy' },
    el('div', { className: 'fila' },
      el('h2', { textContent: `📍 Hoy · Día ${dia}` }),
      boton('Ver el día', () => verDia(dia), 'texto')),
    ...contenido.filter(Boolean));
}

function seccionDia(v, dia, lugares) {
  if (v.ocultos.includes(dia)) return diaOculto(v, dia, lugares);
  const { ends, puntos, real, llega, desplazar, plan } = calculoDia(v, dia, lugares);
  const km = lugares.length ? largo(puntos) : 0;
  const rutas = lugares.length ? enlacesRuta(appMapas(), puntos, v.movilidad) : [];
  const ponerNota = (t) => { v.notasDia = { ...v.notasDia, [dia]: t }; };
  const resumen = [
    dia && fechaDelDia(v, dia),
    real ? textoRuta(real)
      : km ? `${km.toLocaleString('es', { maximumFractionDigits: 1 })} km en línea recta` : plural(lugares.length, 'lugar', 'lugares'),
    dia && textoTiempo(v, dia),
    dia && textoAtardecer(v, dia),
    dia && !minutosUtiles(v)[dia - 1] ? 'sin tiempo libre por el vuelo' : '',
    plan ? `acabas sobre las ${hora(plan.horas.at(-1).sale)}` : '',
  ].filter(Boolean).join(' · ');
  const seccion = el('section', { className: 'dia', color: color(dia) },
    el('div', { className: 'cabecera' },
      el('h2', { textContent: dia ? `Día ${dia}` : 'Sin día' }),
      dia && !v.notasDia[dia] ? boton('Nota', () => editarNota(`Nota del día ${dia}`, '', ponerNota), 'texto') : null,
      dia && lugares.length ? boton('🍽️ Comer cerca', () => abrirComer(v, dia), 'texto') : null,
      el('span', { className: 'iconos-dia' },
        diaSolo(v) === null ? botonIcono('solo', `Ver solo ${dia ? `el día ${dia}` : 'los lugares sin día'}`, () => soloDia(v, dia)) : null,
        botonIcono('ojo', `Ocultar ${dia ? `el día ${dia}` : 'los lugares sin día'}`, () => alternarDia(v, dia)))),
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
    el('h2', { className: 'apartado', textContent: '✅ Pendientes' }),
    seccionTareas(v),
    el('h2', { className: 'apartado', textContent: '😋 Para probar' }),
    seccionProbar(v),
    el('h2', { className: 'apartado', textContent: 'Consejos' }),
    seccionConsejos(v) ?? el('p', { className: 'tenue', textContent: 'Apunta dónde comer, dónde no comprar, cómo moverte… Se ordenan solos por tipo.' }),
    el('div', { className: 'barra' }, el('div', { className: 'fila' }, boton('+ Consejo', () => editarConsejo(v), 'fuerte'))),
  ].filter(Boolean));
}

/** Campo para añadir a una lista; tras añadir, el foco vuelve al campo para seguir escribiendo. */
function campoNuevo(id, etiqueta, ejemplo, alAnadir) {
  const campo = el('input', { id, type: 'text', placeholder: ejemplo, ariaLabel: etiqueta, maxLength: 300, enterKeyHint: 'done', autocomplete: 'off' });
  const anadir = () => {
    const texto = campo.value.trim();
    if (!texto) return;
    alAnadir(texto);
    guardar();
    $(id)?.focus();
  };
  campo.onkeydown = (e) => { if (e.key === 'Enter') anadir(); };
  return el('div', { className: 'fila nueva' }, campo, boton('Añadir', anadir));
}

function seccionTareas(v) {
  const lista = [...v.tareas].sort((a, b) => a.hecha - b.hecha);
  return el('div', { className: 'tareas' },
    ...lista.map((t) => el('div', { className: `tarea${t.hecha ? ' hecha' : ''}` },
      el('label', {},
        el('input', { type: 'checkbox', checked: t.hecha, onchange: (e) => { t.hecha = e.target.checked; guardar(); } }),
        el('span', { textContent: t.texto })),
      botonIcono('borrar', `Quitar «${t.texto}»`, () => { v.tareas = v.tareas.filter((x) => x !== t); guardar(); }, 'peligro'))),
    campoNuevo('nuevo-pendiente', 'Nuevo pendiente', 'Reservar el barco, el taxi…', (texto) => v.tareas.push({ id: crypto.randomUUID(), texto, hecha: false })));
}

function seccionProbar(v) {
  return el('div', { className: 'probar' },
    el('div', { className: 'filtros' }, ...v.probar.map((p) => el('span', { className: 'plato' },
      el('button', {
        type: 'button', className: 'chip', ariaPressed: String(p.probado), textContent: `${p.probado ? '✓ ' : ''}${p.nombre}`,
        title: p.probado ? 'Marcar como no probado' : 'Marcar como probado', onclick: () => { p.probado = !p.probado; guardar(); },
      }),
      el('button', { type: 'button', className: 'quitar-plato', textContent: '×', ariaLabel: `Quitar ${p.nombre}`, onclick: () => { v.probar = v.probar.filter((x) => x !== p); guardar(); } })))),
    campoNuevo('nuevo-plato', 'Nuevo plato para probar', 'Svíčková, trdelník…', (nombre) => v.probar.push({ id: crypto.randomUUID(), nombre, probado: false })));
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
  return el('label', { className: `horas${horas.tarde ? ' tarde' : ''}`, title: horas.tarde ? 'Acaba después de salir hacia el aeropuerto' : 'Cambiar el tiempo que estarás aquí' },
    el('span', { textContent: `${horas.tarde ? '⚠ Después de salir al aeropuerto · ' : '🕐 '}${hora(horas.llega)}–${hora(horas.sale)} · ${duracion(actual)}` }),
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
        el('small', { textContent: l.direccion }), lineaHorario(v, l, horas), horas ? botonHoras(l, horas) : null),
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
  // Arriba, un botón por día para soltarla en cualquiera aunque no se vea (oculto, o viendo solo un día).
  const destinos = el('div', { className: 'destinos', ariaHidden: 'true' },
    ...Array.from({ length: v.dias + 1 }, (_, d) => {
      const chip = el('span', { textContent: d ? `Día ${d}` : 'Sin día' });
      chip.style.setProperty('--c', color(d));
      chip.dataset.dia = d;
      return chip;
    }));
  document.body.append(fantasma, destinos);
  let y = e.clientY;
  let encima = null;
  // Cerca de los bordes la página se desplaza sola para llegar a otros días.
  let marco = requestAnimationFrame(function desplazar() {
    const borde = 80;
    if (encima) { /* sobre un día de arriba: quieto */ } else if (y < borde + destinos.offsetHeight) scrollBy(0, -12);
    else if (y > innerHeight - borde) scrollBy(0, 12);
    marco = requestAnimationFrame(desplazar);
  });
  const mover = (ev) => {
    y = ev.clientY;
    fantasma.style.top = `${y - dy}px`;
    encima = [...destinos.children].find((c) => {
      const r = c.getBoundingClientRect();
      return ev.clientX >= r.left && ev.clientX <= r.right && y >= r.top && y <= r.bottom;
    }) ?? null;
    [...destinos.children].forEach((c) => c.classList.toggle('encima', c === encima));
    if (encima) return;
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
    destinos.remove();
    document.body.classList.remove('moviendo');
    if (encima) {
      hueco.remove();
      li.classList.remove('arrastrando');
      const dia = Number(encima.dataset.dia);
      if (dia === l.dia) return;
      l.dia = dia;
      v.lugares = [...v.lugares.filter((x) => x !== l), l];
      guardar();
      avisar(`${l.nombre}: ${dia ? `al día ${dia}` : 'sin día'}.`);
      return;
    }
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
  let limites;
  try {
    const estilo = await estiloMapa(oscuro());
    if (!div.isConnected) return;
    const visibles = v.lugares.filter((l) => !v.ocultos.includes(l.dia));
    const puntos = [...(visibles.length ? visibles : v.lugares), ...v.hoteles].map((l) => [l.lon, l.lat]);
    limites = puntos.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(puntos[0], puntos[0]));
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
  // Tras moverse por el mapa, vuelve a encuadrar todas las rutas que se ven.
  const centrar = el('button', {
    type: 'button', className: 'centrar-mapa', ariaLabel: 'Centrar en las rutas', title: 'Centrar en las rutas',
    innerHTML: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
    onclick: () => este.fitBounds(limites, { padding: 40, maxZoom: 15 }),
  });
  este.addControl({ onAdd: () => el('div', { className: 'maplibregl-ctrl maplibregl-ctrl-group' }, centrar), onRemove: () => {} }, 'top-left');
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
    // En coche, línea continua; andando, a trazos cortos; en transporte público, a trazos largos.
    const tramos = rutaDe(v, puntos)?.tramos ?? tramosRuta(puntos, v.movilidad).map((t) => ({ ...t, linea: t.puntos.map((l) => [l.lon, l.lat]) }));
    tramos.forEach((t, i) => {
      const id = `dia-${dia}-${i}`;
      este.addSource(id, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: t.linea } } });
      este.addLayer({
        id, type: 'line', source: id, layout: { 'line-cap': t.modo === 'pie' ? 'butt' : 'round', 'line-join': 'round' },
        paint: {
          'line-color': color(dia), 'line-width': 5,
          ...(t.modo === 'pie' && { 'line-dasharray': [1.2, 1] }), ...(t.modo === 'publico' && { 'line-dasharray': [3, 1.2] }),
        },
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
  let cuantos = 40;
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
        textContent: `${categoria(t).icono} ${categoria(t).nombre} (${n})`, onclick: () => { tipo = t; cuantos = 40; pintarLista(); },
      });
    }));
    // Primero lo que abre ese día y está más cerca; lo que cierra, al final.
    const busca = $('buscar-comer').value.trim();
    const todos = sitios.filter((s) => s.tipo === tipo && coincide(busca, `${s.nombre} ${s.cocinaTexto}`))
      .sort((a, b) => (horas(a)?.length === 0) - (horas(b)?.length === 0) || a.km - b.km);
    const visibles = todos.slice(0, cuantos);
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
    }), todos.length > cuantos ? boton(`Ver más (quedan ${todos.length - cuantos})`, () => { cuantos += 40; pintarLista(); }) : '');
  };
  $('buscar-comer').value = '';
  $('buscar-comer').oninput = () => { cuantos = 40; pintarLista(); };

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
        // La distancia, a la parada más cercana o al hotel si está más a mano.
        const cerca = puntosDelDia(v, dia, paradas).reduce((a, b) => (distanciaKm(b, s) < distanciaKm(a, s) ? b : a));
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
  reorganizar(v, como === 'todo' ? organizar(v, conPuesta(v)) : ordenarDias(v, conPuesta(v)), como === 'todo' ? 'Viaje reorganizado.' : 'Paradas ordenadas en cada día.');
}

// Mientras no haya días asignados, la ruta se calcula sola; después se respeta lo que haya.
function anadir(v, nuevos) {
  const sinOrganizar = v.lugares.every((l) => !l.dia);
  v.lugares.push(...nuevos.map((l) => ({
    enlace: '', nota: '', ...l, tipo: l.tipo || adivinarCategoria(`${l.nombre} ${l.direccion ?? ''}`), id: crypto.randomUUID(), dia: 0,
  })));
  if (sinOrganizar) v.lugares = organizar(v, conPuesta(v));
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

// Los lugares que el asistente de IA no pudo situar se buscan aquí, con el mismo buscador que al añadirlos a mano.
let situando = false;
async function situarPendientes(v) {
  if (situando || !v.porSituar.length) return;
  situando = true;
  try {
    const zona = await zonaDe(v);
    if (!zona) return;
    const sinDias = v.lugares.every((l) => !l.dia);
    const situados = [];
    const perdidos = [];
    for (const p of v.porSituar) {
      const { opciones } = await buscarLugar(p.nombre, v.destino, zona).catch(() => ({ opciones: [] }));
      if (!opciones.length) {
        perdidos.push(p.nombre);
        continue;
      }
      const [sitio] = opciones;
      situados.push({
        id: crypto.randomUUID(), enlace: '', nombre: p.nombre, direccion: sitio.direccion, lat: sitio.lat, lon: sitio.lon,
        dia: p.dia, nota: p.nota, estancia: p.estancia, tipo: p.tipo || adivinarCategoria(`${p.nombre} ${sitio.direccion}`),
      });
    }
    const vigente = viajes.find((x) => x.id === v.id);
    if (!vigente) return;
    vigente.lugares.push(...situados);
    vigente.porSituar = [];
    // Si no traían días, se reparten como al pulsar Organizar.
    if (sinDias && vigente.lugares.length && vigente.lugares.every((l) => !l.dia)) vigente.lugares = organizar(vigente, conPuesta(vigente));
    avisar([
      situados.length ? `Situados en el mapa ${plural(situados.length, 'lugar nuevo', 'lugares nuevos')}.` : '',
      perdidos.length ? `No encontré: ${perdidos.join(', ')}.` : '',
    ].filter(Boolean).join(' '));
    guardar();
  } finally {
    situando = false;
  }
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
  f.elements.movilidad.value = v?.movilidad ?? 'coche';
  f.onsubmit = () => {
    const datos = {
      nombre: f.elements.nombre.value.trim() || ciudad?.nombre || v?.nombre || 'Viaje',
      dias: diasValidos(f.elements.dias.value),
      ...(ciudad && { destino: ciudad.destino, zona: ciudad.zona, pais: ciudad.pais }),
      // Solo se guarda si se cambia, para no tocar los viajes de quien no lo usa.
      ...((v?.movilidad || f.elements.movilidad.value === 'publico') && { movilidad: f.elements.movilidad.value }),
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
    const horaHotel = (campo, texto) => el('label', {}, texto,
      el('input', { type: 'time', value: h[campo] ?? '', onchange: (e) => { h[campo] = e.target.value; } }));
    return el('div', { className: 'hotel-fila' }, el('strong', { textContent: h.nombre }), el('small', { textContent: h.direccion }),
      el('div', { className: 'dos' }, horaHotel('checkin', `Check-in en ${h.nombre} desde`), horaHotel('checkout', 'Check-out hasta')),
      el('label', {}, 'Notas del alojamiento',
        el('input', { value: h.notas ?? '', maxLength: 500, placeholder: 'Recepción 24 h, consigna de equipaje…', onchange: (e) => { h.notas = e.target.value.trim(); } })),
      el('div', { className: 'fila' }, desde, quitar));
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
  f.onsubmit = async () => {
    const antes = JSON.stringify([v.ida, v.vuelta, v.hoteles]);
    const lleno = (x) => (x.numero || x.salida || x.llegada ? x : null);
    Object.assign(v, { fecha: f.elements.fecha.value, ida: lleno(borrador.ida), vuelta: lleno(borrador.vuelta), hoteles: borrador.hoteles });
    const cambia = antes !== JSON.stringify([v.ida, v.vuelta, v.hoteles]);
    guardar();
    if (!cambia || !v.lugares.some((l) => l.dia)) return;
    // Lo normal es conservar el itinerario: la primera opción no toca nada.
    const como = await preguntar('Vuelos y hotel guardados. ¿Toco el itinerario?', [
      { texto: '✋ Dejarlo como está', detalle: 'Las horas de cada día ya tienen en cuenta los vuelos y hoteles', valor: 'nada' },
      { texto: '📅 Ordenar cada día', detalle: 'Reordena las paradas de cada día desde el hotel; ninguna cambia de día', valor: 'dias' },
      { texto: '🗺️ Reorganizar todo el viaje', detalle: 'Reparte de nuevo todos los lugares entre los días', valor: 'todo' },
    ]);
    if (como === 'dias') reorganizar(v, ordenarDias(v, conPuesta(v)), 'Paradas ordenadas en cada día.');
    if (como === 'todo') reorganizar(v, organizar(v, conPuesta(v)), 'Viaje reorganizado.');
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
for (const id of ['dlg-elegir', 'dlg-ajustes', 'dlg-comer', 'dlg-compartir', 'dlg-novedades', 'dlg-cambio', 'dlg-enlace']) {
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
  f.elements.nombre.value = miNombre();
  f.elements.nombre.onchange = (e) => localStorage.setItem(CLAVE_NOMBRE, e.target.value.trim().slice(0, 40));
  f.elements.tema.value = document.documentElement.dataset.tema ?? '';
  f.elements.mapas.onchange = (e) => localStorage.setItem(CLAVE_MAPAS, e.target.value);
  f.elements.tema.onchange = (e) => ponerTema(e.target.value);
  $('exportar').onclick = exportar;
  $('borrar-descargas').onclick = () => { $('dlg-ajustes').close(); borrarDescargas(); };
  $('espacio-descargas').textContent = '';
  navigator.storage?.estimate?.().then(({ usage }) => {
    if (usage) $('espacio-descargas').textContent = `Rumbo ocupa ${(usage / 1e6).toLocaleString(IDIOMA, { maximumFractionDigits: 0 })} MB en este dispositivo.`;
  });
  $('importar').onclick = () => { $('dlg-ajustes').close(); $('archivo').click(); };
  $('buscar-version').onclick = () => { $('dlg-ajustes').close(); buscarVersion(); };
  $('ver-novedades').onclick = () => { $('dlg-ajustes').close(); abrirNovedades(NOVEDADES.slice(0, 3)); };
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

const CLAVE_NOVEDADES = 'rumbo-novedades';

function abrirNovedades(versiones) {
  $('lista-novedades').replaceChildren(...versiones.flatMap(({ version, cosas }) => [
    versiones.length > 1 ? el('h3', { textContent: `Versión ${version}` }) : null,
    el('ul', {}, ...cosas.map((c) => el('li', { textContent: c }))),
  ].filter(Boolean)));
  $('dlg-novedades').showModal();
}

/** Tras una actualización, enseña una vez lo nuevo. A quien estrena la app no se le enseña nada. */
function enseñarNovedades() {
  const actual = NOVEDADES[0].version;
  let vista = Number(localStorage.getItem(CLAVE_NOVEDADES));
  // Quien ya tenía viajes antes de que existiera esta ventana viene de la versión anterior.
  if (!vista && viajes.length) vista = actual - 1;
  localStorage.setItem(CLAVE_NOVEDADES, actual);
  const nuevas = vista ? NOVEDADES.filter((n) => n.version > vista) : [];
  if (nuevas.length) abrirNovedades(nuevas);
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
    if (!miNombre()) {
      const nombre = prompt('¿Cómo te llamas? Lo verá la persona con la que compartes el viaje cuando cambies algo.')?.trim();
      if (nombre) localStorage.setItem(CLAVE_NOMBRE, nombre.slice(0, 40));
    }
    v.editadoPor = miNombre();
    const datos = copiaNube(v);
    v.nube = { id: await nube.crear(datos), version: 1, pendiente: false, base: datos };
    ponerEstado(v, 'al-dia');
    persistir();
    escuchar(v);
    pintar();
  }
  return `${location.origin}${location.pathname}#v=${v.nube.id}`;
}

const QR = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';
let qrListo = null;
// La librería del QR solo se descarga la primera vez que se pide, con su huella fijada.
const cargarQr = () => (qrListo ??= new Promise((resolver, fallar) => {
  const script = Object.assign(document.createElement('script'), {
    src: QR, integrity: 'sha384-8FWZA6BGMXhsfO+BLtrJK0We6gg5o1JyO8xQm6peWDEUs17ACA5ziE/NIAkl9z2k', crossOrigin: 'anonymous',
  });
  script.onload = () => resolver(window.qrcode);
  script.onerror = () => {
    qrListo = null;
    script.remove();
    fallar(new Error('Sin QR'));
  };
  document.head.append(script);
}));

async function enviarEnlace(titulo, texto, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title: titulo, text: texto, url });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
    }
  }
  copiarEnlace(url);
}

async function copiarEnlace(url) {
  try {
    await navigator.clipboard.writeText(url);
    avisar('Enlace copiado.');
  } catch {
    avisar('No se pudo copiar el enlace.');
  }
}

/** Hoja de compartir: el QR para enseñarlo en persona y el enlace para enviarlo. */
async function compartirViaje(v) {
  let url;
  let texto = `Mi viaje a ${v.destino} en Rumbo. Lo que cambiemos se verá en los dos móviles.`;
  let explicacion = 'Quien lo abra podrá verlo y editarlo contigo. Que lo escanee con la cámara o envíale el enlace.';
  try {
    url = await enlaceCompartido(v);
  } catch {
    // Sin conexión: el enlace largo lleva el viaje dentro, pero es una copia que no se sincroniza.
    url = `${location.origin}${location.pathname}#viaje=${await empaquetar(v)}`;
    texto = `Mi viaje a ${v.destino} en Rumbo`;
    explicacion = 'Sin conexión: este enlace lleva una copia del viaje que no se actualizará sola.';
  }
  $('compartir-titulo').textContent = `Compartir «${v.nombre}»`;
  $('compartir-texto').textContent = explicacion;
  $('compartir-enlace').textContent = url;
  $('enviar-enlace').onclick = () => enviarEnlace(v.nombre, texto, url);
  $('copiar-enlace').onclick = () => copiarEnlace(url);
  const caja = $('qr');
  caja.replaceChildren(el('p', { className: 'tenue', textContent: 'Preparando el código QR…' }));
  $('dlg-compartir').showModal();
  try {
    const qrcode = await cargarQr();
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    caja.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  } catch {
    caja.replaceChildren(el('p', { className: 'tenue', textContent: 'El código QR necesita conexión la primera vez.' }));
  }
}

// El viaje va tras # para que nunca llegue al servidor.
const instalada = () => navigator.standalone || matchMedia('(display-mode: standalone)').matches;
const esMovil = () => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

/**
 * En el móvil los enlaces se abren en el navegador, que guarda sus viajes aparte de la app instalada
 * (en iPhone no hay forma de que un enlace abra la app). Se pregunta dónde se quiere el viaje.
 */
async function aquiOEnLaApp(hash) {
  if (instalada() || !esMovil()) return true;
  history.replaceState(null, '', location.pathname);
  const donde = await preguntar('¿Dónde quieres este viaje?', [
    { texto: '📲 En la app Rumbo instalada', detalle: 'Copio el enlace y lo pegas en la app con «Abrir enlace compartido»', valor: 'app' },
    { texto: '🌐 Aquí, en el navegador', detalle: 'Si no tienes la app instalada', valor: 'aqui' },
  ]);
  if (donde !== 'app') return donde === 'aqui';
  const url = `${location.origin}${location.pathname}${hash}`;
  try {
    await navigator.clipboard.writeText(url);
    avisar('Enlace copiado. Abre Rumbo desde tu pantalla de inicio y pulsa «📥 Abrir enlace compartido».');
  } catch {
    abrirEnlaceCompartido(url);
  }
  return false;
}

async function recibirViaje(hash = location.hash) {
  if (!/^#(v|viaje)=/.test(hash) || !(await aquiOEnLaApp(hash))) return;
  const [, codigo] = /^#v=([a-z0-9]{8,40})$/.exec(hash) ?? [];
  if (codigo) {
    recibirCompartido(codigo);
    return;
  }
  const [, paquete] = /^#viaje=([\w-]+)$/.exec(hash) ?? [];
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
/** Hoja para pegar un enlace de viaje en la app instalada (o para copiarlo si el navegador no deja). */
function abrirEnlaceCompartido(sugerido = '') {
  const f = $('form-enlace');
  f.reset();
  f.elements.enlace.value = sugerido;
  $('pegar-enlace').hidden = !navigator.clipboard?.readText || Boolean(sugerido);
  $('pegar-enlace').onclick = async () => {
    try {
      f.elements.enlace.value = (await navigator.clipboard.readText()).trim();
    } catch {
      avisar('No se pudo leer lo copiado. Mantén pulsado el campo y elige Pegar.');
    }
  };
  f.onsubmit = () => {
    const texto = f.elements.enlace.value.trim();
    const hash = /#(v|viaje)=[\w-]+/.exec(texto)?.[0] ?? (/^[a-z0-9]{16}$/.test(texto) ? `#v=${texto}` : '');
    if (hash) recibirViaje(hash);
    else avisar('Eso no parece un enlace de viaje de Rumbo.');
  };
  $('dlg-enlace').showModal();
}

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
  v.nube.base = copiaNube(v);
  viajes.unshift(v);
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

// La página no se amplía con dos dedos (Safari no siempre hace caso a la etiqueta viewport); el mapa sí.
const fueraDelMapa = (e) => !e.target.closest?.('.maplibregl-map');
for (const gesto of ['gesturestart', 'gesturechange']) {
  document.addEventListener(gesto, (e) => { if (fueraDelMapa(e)) e.preventDefault(); }, { passive: false });
}
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1 && fueraDelMapa(e)) e.preventDefault(); }, { passive: false });

// En el móvil el teclado tapa la parte de abajo sin encoger la página: las hojas suben por encima de él.
function ajustarAlTeclado() {
  const vista = window.visualViewport;
  if (!vista) return;
  const tapa = Math.max(0, Math.round(innerHeight - vista.height - vista.offsetTop));
  const raiz = document.documentElement;
  raiz.style.setProperty('--teclado', `${tapa}px`);
  raiz.style.setProperty('--visible', `${Math.round(vista.height)}px`);
  raiz.classList.toggle('con-teclado', tapa > 80);
}
window.visualViewport?.addEventListener('resize', ajustarAlTeclado);
window.visualViewport?.addEventListener('scroll', ajustarAlTeclado);
// El campo en el que se escribe queda a la vista dentro de la hoja cuando sale el teclado.
addEventListener('focusin', (e) => {
  if (e.target.matches('dialog input, dialog textarea')) setTimeout(() => e.target.scrollIntoView({ block: 'nearest' }), 350);
});

ponerTema(document.documentElement.dataset.tema);
gestoAtras();
// Si se está de viaje, la app se abre directamente en el día de hoy.
const deViaje = location.hash ? null : viajes.find((v) => diaDeHoy(v));
if (deViaje) {
  ir(deViaje.id);
  requestAnimationFrame(() => verDia(diaDeHoy(deViaje)));
}
recibirViaje();
// Si Rumbo ya estaba abierto, un enlace nuevo solo cambia lo que va tras # y no recarga la página.
addEventListener('hashchange', () => recibirViaje());
recibirPublicacion();
navigator.storage?.persist?.();
vigilarVersiones();
iniciarNube();
enseñarNovedades();
