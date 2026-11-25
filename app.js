import {
  extraerLugares, parecido, organizar, distanciaKm, largo, extremosDelDia, minutosUtiles, enlaceLugar, enlacesRuta,
  enlaceSeguro, diasValidos, validarViajes,
} from './logica.js';
import { IDIOMA, buscarCiudades, buscarLugar, buscarFoto, buscarIdeas, buscarVuelo, calcularLlegada, recomendar, estiloMapa } from './fuentes.js';

const CLAVE = 'rumbo';
// Tonos oscuros para que el número blanco se lea encima.
const COLORES = ['#c2362b', '#1f6fb2', '#2f7d3b', '#8a3fa8', '#a85a00', '#00757a', '#b02a6b'];
const color = (dia) => (dia ? COLORES[(dia - 1) % COLORES.length] : '#5d7079');
const $ = (id) => document.getElementById(id);
const CLAVE_MAPAS = 'rumbo-mapas';
const appMapas = () => (localStorage.getItem(CLAVE_MAPAS) === 'google' ? 'google' : 'apple');

let temporizador;
let viajes = cargar();
let abierto = null;
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

function guardar() {
  try {
    localStorage.setItem(CLAVE, JSON.stringify({ viajes }));
  } catch {
    avisar('No se pudo guardar: no queda espacio. Exporta una copia ahora.');
  }
  pintar();
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
const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

function pintar() {
  mapa?.remove();
  mapa = null;
  const viaje = viajes.find((v) => v.id === abierto);
  if (viaje) pintarViaje(viaje);
  else pintarInicio();
}

function ir(id) {
  abierto = id;
  pintar();
  scrollTo(0, 0);
}

function pintarInicio() {
  $('vista').replaceChildren(
    el('h1', { textContent: 'Rumbo' }),
    el('p', { className: 'tenue', textContent: 'Tus viajes, parada a parada.' }),
    viajes.length
      ? el('ul', { className: 'lista' }, ...viajes.map((v) => el('li', {}, el('button', { type: 'button', className: 'viaje', onclick: () => ir(v.id) },
        el('span', {}, el('strong', { textContent: v.nombre }),
          el('small', { textContent: `${v.destino} · ${plural(v.dias, 'día', 'días')} · ${plural(v.lugares.length, 'lugar', 'lugares')}` })),
        el('span', { className: 'puntos', ariaHidden: 'true' }, ...Array.from({ length: Math.min(v.dias, 5) }, (_, i) => el('i', { color: color(i + 1) })))))))
      : el('p', { textContent: 'Crea tu primer viaje: elige ciudad y te propongo qué ver.' }),
    el('div', { className: 'fila' },
      boton('Exportar copia', exportar, 'texto'),
      boton('Importar copia', () => $('archivo').click(), 'texto')),
    el('label', { className: 'ajuste' }, 'Abrir lugares y rutas en ',
      el('select', { onchange: (e) => localStorage.setItem(CLAVE_MAPAS, e.target.value) },
        el('option', { value: 'apple', textContent: 'Mapas de Apple', selected: appMapas() === 'apple' }),
        el('option', { value: 'google', textContent: 'Google Maps', selected: appMapas() === 'google' }))),
    el('div', { className: 'barra' }, el('div', { className: 'fila' }, boton('Nuevo viaje', () => editarViaje(), 'fuerte'))),
  );
}

function pintarViaje(v) {
  const dias = Array.from({ length: v.dias }, (_, i) => i + 1);
  const deDia = (d) => v.lugares.filter((l) => l.dia === d);
  const sueltos = deDia(0);
  const divMapa = v.lugares.length ? el('div', { id: 'mapa' }) : null;

  $('vista').replaceChildren(...[
    boton('‹ Viajes', () => ir(null), 'texto'),
    el('h1', { textContent: v.nombre }),
    el('p', { className: 'tenue', textContent: `${v.destino} · ${plural(v.dias, 'día', 'días')}` }),
    el('div', { className: 'fila' },
      boton('Editar', () => editarViaje(v), 'texto'),
      boton('Vuelos y hotel', () => abrirLogistica(v), 'texto'),
      v.nota ? null : boton('Nota', () => editarNota('Nota del viaje', v.nota, (t) => { v.nota = t; }), 'texto'),
      boton('Borrar viaje', () => borrarViaje(v), 'texto peligro')),
    nota(v.nota, 'Nota del viaje', (t) => { v.nota = t; }),
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

function seccionDia(v, dia, lugares) {
  const ends = dia ? extremosDelDia(v, dia) : {};
  const puntos = dia ? puntosDelDia(v, dia, lugares) : [];
  const km = lugares.length ? largo(puntos) : 0;
  const rutas = lugares.length ? enlacesRuta(appMapas(), puntos) : [];
  const ponerNota = (t) => { v.notasDia = { ...v.notasDia, [dia]: t }; };
  const resumen = [
    dia && fechaDelDia(v, dia),
    km ? `${km.toLocaleString('es', { maximumFractionDigits: 1 })} km en línea recta` : plural(lugares.length, 'lugar', 'lugares'),
    dia && !minutosUtiles(v)[dia - 1] ? 'sin tiempo libre por el vuelo' : '',
  ].filter(Boolean).join(' · ');
  return el('section', { className: 'dia', color: color(dia) },
    el('div', { className: 'cabecera' },
      el('h2', { textContent: dia ? `Día ${dia}` : 'Sin día' }),
      ...rutas.map((href, i) => enlace(rutas.length > 1 ? `Ruta ${i + 1}` : 'Ruta', href, 'boton ruta')),
      dia && !v.notasDia[dia] ? boton('Nota', () => editarNota(`Nota del día ${dia}`, '', ponerNota), 'texto') : null),
    el('small', { textContent: resumen }),
    ...lineaVuelo(v, dia),
    dia ? nota(v.notasDia[dia], `Nota del día ${dia}`, ponerNota) : null,
    el('ol', { className: 'paradas' },
      ends.inicio && lugares.length ? extremo(v, ends.inicio) : null,
      ...lugares.map((l, i) => parada(v, l, i, lugares)),
      ends.fin && lugares.length ? extremo(v, ends.fin) : null));
}

const comoIr = (p) => (appMapas() === 'google'
  ? `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`
  : `https://maps.apple.com/?daddr=${p.lat},${p.lon}`);

function extremo(v, p) {
  return el('li', { className: 'parada extremo' },
    el('b', { textContent: p.iata ? '\u2708\uFE0E' : 'H' }),
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

function parada(v, l, i, hermanos) {
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
  const quitar = boton('Quitar', () => {
    if (!confirm(`¿Quitar «${l.nombre}»?`)) return;
    v.lugares = v.lugares.filter((x) => x !== l);
    guardar();
  }, 'texto peligro');
  const ponerNota = (t) => { l.nota = t; };
  return el('li', { className: 'parada' },
    el('b', { textContent: i + 1 }),
    el('div', { className: 'ficha' },
      el('div', {}, enlace(l.nombre, enlaceLugar(appMapas(), l, v.destino), 'titulo'), el('small', { textContent: l.direccion })),
      l.foto ? miniatura(l, v.destino) : null),
    nota(l.nota, `Nota de ${l.nombre}`, ponerNota),
    el('div', { className: 'fila' },
      enlace('Ir', comoIr(l)),
      l.enlace ? enlace('Vídeo', l.enlace) : null,
      mover, i ? subir : null,
      l.nota ? null : boton('Nota', () => editarNota(`Nota de ${l.nombre}`, '', ponerNota), 'texto'),
      quitar));
}

async function pintarMapa(div, v) {
  try {
    const estilo = await estiloMapa();
    if (!div.isConnected) return;
    const puntos = [...v.lugares, ...v.hoteles].map((l) => [l.lon, l.lat]);
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
  const porDia = Array.from({ length: v.dias + 1 }, (_, dia) => v.lugares.filter((l) => l.dia === dia));
  porDia.forEach((lugares, dia) => lugares.forEach((l, i) => {
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
    este.addSource(`dia-${dia}`, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: puntos.map((l) => [l.lon, l.lat]) } } });
    este.addLayer({ id: `dia-${dia}`, type: 'line', source: `dia-${dia}`, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color(dia), 'line-width': 5 } });
  }));
}

function organizarViaje(v) {
  if (v.lugares.some((l) => l.dia) && !confirm('Se reordenarán todos los lugares y días. ¿Seguir?')) return;
  v.lugares = organizar(v);
  guardar();
}

// Mientras no haya días asignados, la ruta se calcula sola; después se respeta lo que haya.
function anadir(v, nuevos) {
  const sinOrganizar = v.lugares.every((l) => !l.dia);
  v.lugares.push(...nuevos.map((l) => ({ enlace: '', nota: '', ...l, id: crypto.randomUUID(), dia: 0 })));
  if (sinOrganizar) v.lugares = organizar(v);
  guardar();
}

function miniatura(l, destino) {
  const img = el('img', { src: l.foto, alt: `Ver ${l.nombre} en el mapa`, loading: 'lazy', width: 88, height: 88 });
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
  abierto = null;
  guardar();
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
      ...(ciudad && { destino: ciudad.destino, zona: ciudad.zona }),
    };
    if (v) {
      Object.assign(v, datos);
      v.lugares.forEach((l) => { if (l.dia > v.dias) l.dia = 0; });
      v.hoteles.forEach((h) => { h.desde = Math.min(h.desde, v.dias); });
      guardar();
      return;
    }
    const [nuevo] = validarViajes({ viajes: [{ ...datos, lugares: [] }] });
    viajes.unshift(nuevo);
    abierto = nuevo.id;
    guardar();
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
        idea.foto ? el('img', { src: idea.foto, alt: '', loading: 'lazy' }) : el('span', { className: 'sinfoto', textContent: idea.nombre.charAt(0) }),
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
  $('resultados').append(el('div', { className: 'hallazgo' }, marca,
    el('div', {}, el('strong', { textContent: nombre }), fallo || !seguro ? el('p', { className: 'tenue', textContent: fallo || 'Dudoso: elige la opción correcta y márcala.' }) : null, fallo ? null : elegir)));
  if (opciones.length) hallazgos.push({ nombre, marca, elegido: () => opciones[elegir.value] });
  actualizarAnadir();
}

$('buscar').onclick = buscar;
$('form-lugares').elements.texto.oninput = () => vaciarResultados();
$('dlg-lugares').onclose = () => vaciarResultados();
$('form-lugares').onsubmit = (e) => {
  const v = viajes.find((x) => x.id === abierto);
  const elegidos = hallazgos.filter((h) => h.marca.checked);
  if (!elegidos.length) { e.preventDefault(); return; }
  const enlace = enlaceSeguro($('form-lugares').elements.enlace.value.trim());
  anadir(v, elegidos.map((h) => ({ ...h.elegido(), nombre: h.nombre, enlace })));
};
document.querySelectorAll('[data-cerrar]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });

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

pintar();
navigator.storage?.persist?.();
navigator.serviceWorker?.register('sw.js');
