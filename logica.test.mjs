import assert from 'node:assert/strict';
import { extraerLugares, parecido, organizar, ordenarRuta, largo, extremosDelDia, minutosUtiles, estimarLlegada, enlacesRuta, validarViajes, distanciaKm, diasValidos, coincide, tramosRuta, fotoDe, enlaceLugar, horarioDelDia, decodificarPolilinea, claveRuta, duracion, tiempoDe, bandera, empaquetar, desempaquetar, mismoViaje, actualizarViaje, adivinarCategoria, mejorHueco, ordenarDias, agenda, hora, minutosTramo, datosNube, fusionar, resumenCambios, atardecer, salidaAeropuerto, monedaDe, avisoHorario, teselasDe } from './logica.js';

assert.deepEqual(
  extraerLugares('Lo mejor de Roma 😍\n📍 Trattoria Da Enzo - la mejor pasta\n📍Panteón 📍 Coliseo (reserva!)\n#roma #viajes'),
  ['Trattoria Da Enzo', 'Panteón', 'Coliseo']);
assert.deepEqual(extraerLugares('Guarda esto\n1. Café Central: brunch\n2️⃣ Museo del Prado 🖼️\n3) café central'), ['Café Central', 'Museo del Prado']);
assert.deepEqual(extraerLugares('Alhambra\nMirador de San Nicolás'), ['Alhambra', 'Mirador de San Nicolás']);
assert.deepEqual(extraerLugares('📍 @bar_pepe'), ['bar_pepe']);
assert.deepEqual(extraerLugares('  \n#solo #hashtags\nhttps://tiktok.com/x'), []);

const p = (id, lat, lon) => ({ id, lat, lon });
const viaje = (lugares, dias, extra = {}) => ({ lugares, dias, hoteles: [], ...extra });
const r = organizar(viaje([p('a', 0, 0), p('z', 0, 10), p('b', 0, 0.1), p('y', 0, 10.1)], 2));
const dia = Object.fromEntries(r.map((l) => [l.id, l.dia]));
assert.equal(dia.a, dia.b);
assert.equal(dia.z, dia.y);
assert.notEqual(dia.a, dia.z);
const desorden = [5, 2, 8, 1, 7, 3, 6, 4].map((n) => p(n, 0, n / 100));
const ordenados = organizar(viaje(desorden, 1)).map((l) => l.id);
assert.ok([ordenados, [...ordenados].reverse()].some((o) => o.join() === '1,2,3,4,5,6,7,8'));
const nube = Array.from({ length: 40 }, (_, i) => p(i, Math.sin(i * 7.3), Math.cos(i * 3.1)));
assert.equal(new Set(organizar(viaje(nube, 4)).map((l) => l.id)).size, 40);
assert.deepEqual(organizar(viaje([], 3)), []);
assert.ok(organizar(viaje([p('a', 1, 1), p('b', 2, 2)], 5)).every((l) => l.dia >= 1 && l.dia <= 5));

// Ruta circular: un rectángulo con el hotel en una esquina se recorre sin cruzarse.
const hotel = p('h', 0, 0);
const circular = ordenarRuta([p('c', 0.01, 0.01), p('a', 0, 0.01), p('b', 0.01, 0)], hotel, hotel);
assert.ok(Math.abs(largo([hotel, ...circular, hotel]) - 4 * distanciaKm(hotel, p('', 0, 0.01))) < 0.01);

// Cambio de hotel: ese día se sale del viejo y se duerme en el nuevo.
const dos = { dias: 4, ida: { hasta: p('aer', 5, 5) }, vuelta: { desde: p('aer2', 6, 6) }, hoteles: [{ id: 2, desde: 3, lat: 0, lon: 9 }, { id: 1, desde: 1, lat: 0, lon: 0 }] };
const ext = (d, v = dos) => { const e = extremosDelDia(v, d); return [e.inicio?.id, e.fin?.id]; };
assert.deepEqual([1, 2, 3, 4].map((d) => ext(d)), [[1, 1], [1, 1], [1, 2], [2, 2]]);
assert.deepEqual(ext(1, { ...dos, hoteles: [] }), ['aer', undefined]);
assert.deepEqual(ext(4, { ...dos, hoteles: [] }), [undefined, 'aer2']);
const ciudades = Object.fromEntries(organizar(viaje([p('x', 0, 9.1), p('y', 0, 0.1)], 4, dos)).map((l) => [l.id, l.dia]));
assert.ok(ciudades.y <= 2 && ciudades.x >= 3);

// Llegar tarde o salir pronto deja esos días con menos sitios, o ninguno.
assert.deepEqual(minutosUtiles({ dias: 3, ida: { llegada: '18:00' }, vuelta: { salida: '10:00' } }), [30, 660, 0]);
assert.deepEqual(minutosUtiles({ dias: 1 }), [660]);
const porDia = organizar(viaje(nube, 3, { ida: { llegada: '22:00' }, vuelta: { salida: '08:00' } }));
assert.ok(porDia.every((l) => l.dia === 2));
assert.equal(organizar(viaje(nube, 1, { ida: { llegada: '22:00' } })).length, 40);

assert.deepEqual(estimarLlegada('10:00', 1770, 60, 60), { hora: '12:45', masDias: 0 });
assert.deepEqual(estimarLlegada('23:30', 1350, 0, 0), { hora: '01:45', masDias: 1 });
assert.equal(estimarLlegada('', 100, 0, 0), null);

const puntos = Array.from({ length: 13 }, (_, i) => p(i, 0, i / 100));
assert.equal(enlacesRuta('google', puntos).length, 2);
assert.equal(new URL(enlacesRuta('google', puntos)[0].href).searchParams.get('waypoints').split('|').length, 9);
assert.equal(new URL(enlacesRuta('google', puntos)[1].href).searchParams.get('origin'), '0,0.1');
assert.equal(new URL(enlacesRuta('apple', puntos)[0].href).searchParams.getAll('waypoint').length, 9);
assert.equal(enlacesRuta('apple', puntos.slice(0, 11)).length, 1);
assert.equal(new URL(enlacesRuta('apple', [p('', 0, 0), p('', 0, 1)])[0].href).searchParams.get('mode'), 'driving');
assert.deepEqual(enlacesRuta('apple', [puntos[0]]), []);

assert.ok(Math.abs(distanciaKm(p('', 40.4168, -3.7038), p('', 41.3874, 2.1686)) - 505) < 5);
assert.deepEqual([diasValidos('0'), diasValidos('x'), diasValidos('99'), diasValidos('4')], [1, 1, 30, 4]);

assert.equal(parecido('Coliseo', 'Coliseo'), 1);
assert.ok(parecido('Panteón', 'Panteon de Agripa') >= 0.5);
assert.ok(parecido('Coliseo', 'Juegos inaugurales del Coliseo') < 0.5);
assert.equal(parecido('', ''), 0);
assert.throws(() => validarViajes({}));
assert.throws(() => validarViajes({ viajes: [{ lugares: [{ lat: 'x', lon: 1 }] }] }));
const [v] = validarViajes({ viajes: [{ nombre: 'N', dias: 2, lugares: [{ nombre: 'L', lat: 1, lon: 1, dia: 9, enlace: 'javascript:alert(1)' }] }] });
assert.equal(v.lugares[0].dia, 0);
assert.equal(v.lugares[0].enlace, '');
const conFoto = (foto) => validarViajes({ viajes: [{ dias: 1, zona: { lat: 1, lon: 'x', radio: 5 }, lugares: [{ lat: 1, lon: 1, foto }] }] })[0];
assert.equal(conFoto('https://malo.example/x.png').lugares[0].foto, '');
assert.equal(conFoto('https://thumb.wikimedia.org/x.png').lugares[0].foto, 'https://thumb.wikimedia.org/x.png');
assert.equal(conFoto(undefined).lugares[0].foto, undefined);
assert.equal(conFoto('').zona, null);
const [antiguo] = validarViajes({ viajes: [{ dias: 2, lugares: [], ida: { salida: '25', desde: { lat: 'x' } }, hoteles: [{ lat: 1, lon: 1, desde: 9 }, {}], notasDia: { 1: 'hola', x: 'no' }, fecha: 'ayer' }] });
assert.deepEqual([antiguo.ida.salida, antiguo.ida.desde, antiguo.hoteles.length, antiguo.hoteles[0].desde, antiguo.notasDia, antiguo.fecha], ['', null, 1, 2, { 1: 'hola' }, '']);
assert.deepEqual(validarViajes({ viajes: [{ dias: 1, lugares: [] }] })[0].hoteles, []);
console.log('todo correcto');

// Buscador de consejos: tolera acentos, erratas y palabras a medias.
assert.ok(coincide('restaurnte', 'El mejor restaurante del barrio'));
assert.ok(coincide('cafe', 'Café con churros'));
assert.ok(coincide('mercad', 'No compres en el mercado central'));
assert.ok(coincide('', 'cualquier cosa'));
assert.ok(!coincide('taxi', 'Pide el menú del día'));
assert.ok(!coincide('bar', 'Ve en tren'));
assert.equal(validarViajes({ viajes: [{ lugares: [], consejos: [{ tipo: 'raro', texto: 'x' }, { texto: ' ' }] }] })[0].consejos[0].tipo, 'otro');

// Horarios de OpenStreetMap: 0 es domingo.
assert.deepEqual(horarioDelDia('Mo-Fr 09:00-18:00; Sa 10:00-14:00', 1), ['09:00-18:00']);
assert.deepEqual(horarioDelDia('Mo-Fr 09:00-18:00; Sa 10:00-14:00', 6), ['10:00-14:00']);
assert.deepEqual(horarioDelDia('Mo-Fr 09:00-18:00; Sa 10:00-14:00', 0), []);
assert.deepEqual(horarioDelDia('Tu-Su 09:00-13:00,16:00-20:00; Mo off', 1), []);
assert.deepEqual(horarioDelDia('Tu-Su 09:00-13:00,16:00-20:00; PH off', 3), ['09:00-13:00', '16:00-20:00']);
assert.deepEqual(horarioDelDia('Fr-Mo 20:00-02:00', 0), ['20:00-02:00']);
assert.deepEqual(horarioDelDia('09:00-21:00; Su off', 2), ['09:00-21:00']);
assert.deepEqual(horarioDelDia('24/7', 4), ['00:00-24:00']);
assert.equal(horarioDelDia('Apr-Oct Mo-Su 09:00-19:00', 2), null);
assert.equal(horarioDelDia('sunrise-sunset', 2), null);

// Polilínea de ejemplo de la documentación de Google.
assert.deepEqual(decodificarPolilinea('_p~iF~ps|U_ulLnnqC_mqNvxq`@'), [[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]]);
assert.equal(claveRuta([{ lat: 41.123456, lon: 2.1 }, { lat: 0, lon: -3 }]), '41.1235,2.1000;0.0000,-3.0000');
assert.equal(duracion(42), '42 min');
assert.equal(duracion(125), '2 h 05');
assert.equal(tiempoDe(61).nombre, 'lluvia');
assert.equal(tiempoDe(1234).icono, '🌡️');

assert.equal(bandera('ES'), '🇪🇸');
assert.equal(bandera(''), '');

// Un viaje compartido por enlace vuelve igual, sin fotos y con otro identificador.
const original = validarViajes({ viajes: [{ id: 'x', nombre: 'Roma', destino: 'Roma, Italia', pais: 'IT', dias: 2, consejos: [{ tipo: 'comida', texto: 'Cacio e pepe' }],
  lugares: [{ nombre: 'Coliseo', lat: 41.89, lon: 12.49, dia: 1, foto: 'https://upload.wikimedia.org/a.jpg', horario: 'Mo-Su 09:00-19:00' }] }] })[0];
const enlace = await empaquetar(original);
assert.match(enlace, /^[\w-]+$/);
const recibido = await desempaquetar(enlace);
assert.notEqual(recibido.id, 'x');
assert.equal(recibido.lugares[0].foto, undefined);
const sinIds = (cs) => cs.map(({ id, ...c }) => c);
assert.deepEqual({ ...recibido, id: 'x', lugares: [], consejos: sinIds(recibido.consejos) }, { ...original, origen: 'x', lugares: [], consejos: sinIds(original.consejos) });
// El horario no viaja en el enlace: se vuelve a buscar.
assert.equal(recibido.lugares[0].horario, undefined);
assert.equal(recibido.lugares[0].tipo, 'monumento');
await assert.rejects(desempaquetar('basura'));

// Rutas mixtas: en coche hasta la zona y andando entre lo que está cerca.
const mixta = tramosRuta([p('h', 0, 0), p('a', 0, 0.5), p('b', 0, 0.51), p('c', 0, 0.52), p('d', 0, 1)]);
assert.deepEqual(mixta.map((t) => `${t.modo}:${t.puntos.map((x) => x.id).join('')}`), ['coche:ha', 'pie:abc', 'coche:cd']);
const enlacesMixta = enlacesRuta('google', [p('h', 0, 0), p('a', 0, 0.5), p('b', 0, 0.51)]);
assert.deepEqual(enlacesMixta.map((e) => [e.modo, new URL(e.href).searchParams.get('travelmode')]), [['coche', 'driving'], ['pie', 'walking']]);
const enlacesWaze = enlacesRuta('waze', [p('h', 0, 0), p('a', 0, 0.5), p('b', 0, 0.51), p('c', 0, 1)]);
assert.deepEqual(enlacesWaze.map((e) => new URL(e.href).host), ['waze.com', 'www.google.com', 'waze.com']);
assert.match(enlaceLugar('waze', p('', 41.9, 12.5), 'Roma'), /^https:\/\/waze\.com\/ul\?ll=41\.9%2C12\.5/);

assert.equal(fotoDe('https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo.jpg/500px-Colosseo.jpg', 250),
  'https://upload.wikimedia.org/wikipedia/commons/thumb/d/de/Colosseo.jpg/250px-Colosseo.jpg');
assert.equal(fotoDe('https://upload.wikimedia.org/wikipedia/commons/d/de/Colosseo.jpg', 250), 'https://upload.wikimedia.org/wikipedia/commons/d/de/Colosseo.jpg');

// Volver a compartir el mismo viaje actualiza la copia en vez de duplicarla, en los dos sentidos.
const copia = await desempaquetar(await empaquetar(original));
assert.equal(copia.origen, 'x');
assert.equal(mismoViaje([original], copia), original);
const deVuelta = await desempaquetar(await empaquetar(copia));
assert.equal(deVuelta.origen, 'x');
assert.equal(mismoViaje([copia], deVuelta), copia);
assert.equal(mismoViaje([validarViajes({ viajes: [{ id: 'otro', lugares: [] }] })[0]], copia), undefined);

const mia = validarViajes({ viajes: [{ id: 'mia', origen: 'x', nombre: 'Roma', dias: 3, ocultos: [1, 3],
  lugares: [{ id: 'col', nombre: 'Coliseo', lat: 41.89, lon: 12.49, dia: 1, foto: 'https://upload.wikimedia.org/c.jpg', autoria: 'https://commons.wikimedia.org/wiki/File:c.jpg' }] }] })[0];
const cambios = validarViajes({ viajes: [{ origen: 'x', nombre: 'Roma y Ostia', dias: 2, consejos: [{ tipo: 'comida', texto: 'Supplì' }],
  lugares: [{ id: 'col', nombre: 'Coliseo', lat: 41.89, lon: 12.49, dia: 2 }, { id: 'ost', nombre: 'Ostia', lat: 41.75, lon: 12.29, dia: 1 }] }] })[0];
actualizarViaje(mia, cambios);
assert.equal(mia.id, 'mia');
assert.equal(mia.nombre, 'Roma y Ostia');
assert.deepEqual(mia.ocultos, [1]);
assert.equal(mia.lugares.length, 2);
assert.equal(mia.lugares[0].foto, 'https://upload.wikimedia.org/c.jpg');
assert.equal(mia.lugares[0].dia, 2);
assert.equal(mia.lugares[1].foto, undefined);
assert.equal(mia.consejos[0].texto, 'Supplì');

// Categorías por el nombre, también sin acentos y en otros idiomas.
assert.equal(adivinarCategoria('Museo del Prado'), 'museo');
assert.equal(adivinarCategoria('Trattoria Da Enzo al 29'), 'comida');
assert.equal(adivinarCategoria('Café de Flore'), 'cafe');
assert.equal(adivinarCategoria('Gelateria del Teatro'), 'helado');
assert.equal(adivinarCategoria('Miradouro da Graça'), 'mirador');
assert.equal(adivinarCategoria('Panteón'), 'monumento');
assert.equal(adivinarCategoria('Castel Sant Angelo'), 'monumento');
assert.equal(adivinarCategoria('Jardins do Palácio de Cristal'), 'naturaleza');
assert.equal(adivinarCategoria('Livraria Lello'), 'compras');
assert.equal(adivinarCategoria('Barcelona'), 'otro');
assert.equal(validarViajes({ viajes: [{ lugares: [{ nombre: 'Basílica de San Pedro', lat: 41.9, lon: 12.45 }] }] })[0].lugares[0].tipo, 'monumento');

// Un sitio nuevo va donde menos se desvía la ruta.
const linea = [p('a', 0, 0), p('b', 0, 0.01), p('c', 0, 0.02)];
assert.equal(mejorHueco(linea, p('x', 0, 0.015)), 2);
assert.equal(mejorHueco(linea, p('x', 0, 0.03)), 3);
assert.equal(mejorHueco([p('a', 0, 0)], p('x', 0, 1)), 1);

// Ordenar por días no cambia a nadie de día.
const desordenado = viaje([p('a', 0, 0.02), p('b', 0, 0), p('c', 0, 0.01), p('z', 1, 1)].map((l, i) => ({ ...l, dia: i < 3 ? 1 : 0 })), 2);
const porDias = ordenarDias(desordenado);
assert.deepEqual(porDias.map((l) => `${l.id}${l.dia}`).slice(-1), ['z0']);
assert.ok(['b1,c1,a1', 'a1,c1,b1'].includes(porDias.slice(0, 3).map((l) => `${l.id}${l.dia}`).join()));

// Horario del día: desde las 9, con estancias y trayectos; propone comer y cenar si no hay dónde.
const paradasDia = [{ tipo: 'museo' }, { tipo: 'monumento' }, { tipo: 'mirador', estancia: 30 }];
const plan = agenda({ dias: 1 }, 1, paradasDia, [0, 30, 15]);
assert.deepEqual(plan.horas.map((h) => `${hora(h.llega)}-${hora(h.sale)}`), ['09:00-11:00', '11:30-12:30', '12:45-13:15']);
assert.deepEqual(plan.comidas.map((c) => `${c.tipo}@${hora(c.hora)}#${c.despues}`), ['comida@13:30#2', 'cena@20:30#2']);
const conRestaurante = agenda({ dias: 1 }, 1, [{ tipo: 'museo', estancia: 240 }, { tipo: 'comida' }], [0, 10]);
assert.deepEqual(conRestaurante.comidas.map((c) => c.tipo), ['cena']);
// Al aterrizar a las 11:00 el día empieza a las 12:30, y la comida retrasa lo que viene detrás.
const llegada = agenda({ dias: 2, ida: { llegada: '11:00' } }, 1, [{ tipo: 'monumento' }, { tipo: 'monumento' }], [0, 0]);
assert.deepEqual(llegada.horas.map((h) => hora(h.llega)), ['12:30', '14:30']);
assert.ok(minutosTramo(p('', 0, 0), p('', 0, 0.01)) > 15 && minutosTramo(p('', 0, 0), p('', 0, 0.01)) < 25);

// El enlace de un viaje real de 8 lugares queda bastante más corto que antes (1087 caracteres).
const praga = validarViajes({ viajes: [{ id: 'cd801960-d101-4313-8b6c-e6dfbc286cd3', nombre: 'Marta', destino: 'Praga, Chequia', pais: 'CZ', dias: 5,
  zona: { lat: 50.08804, lon: 14.42076, radio: 15 }, consejos: [{ tipo: 'comida', texto: 'holaa' }], lugares: [
    ['Museo Nacional de Praga', 50.0798433, 14.4304172, 1, ''], ['Galería Nacional de Praga', 50.101111, 14.4325, 1, ''],
    ['Plaza de Wenceslao', 50.082308, 14.426141, 2, ''], ['Iglesia de Nuestra Señora en frente del Týn', 50.08771, 14.4227, 2, 'Iglesia en la ciudad vieja de Praga'],
    ['Plaza de la Ciudad Vieja', 50.0875, 14.42138889, 3, 'Plaza histórica situada en la ciudad vieja de Praga'], ['Puente Carlos', 50.08638889, 14.41194444, 4, 'Puente en Praga, República Checa'],
    ['Castillo de Praga', 50.09, 14.4, 4, ''], ['Catedral de San Vito', 50.09083333, 14.40055556, 5, 'Templo de Praga'],
  ].map(([nombre, lat, lon, dia, direccion]) => ({ nombre, lat, lon, dia, direccion, horario: 'Mo-Su 09:00-17:00', foto: 'https://upload.wikimedia.org/x.jpg' })) }] })[0];
const corto = await empaquetar(praga);
assert.ok(corto.length < 750, `enlace de ${corto.length} caracteres`);
const pragaRecibida = await desempaquetar(corto);
assert.deepEqual(pragaRecibida.lugares.map((l) => [l.nombre, l.dia, l.tipo]), praga.lugares.map((l) => [l.nombre, l.dia, l.tipo]));
assert.equal(pragaRecibida.consejos[0].texto, 'holaa');
assert.equal(pragaRecibida.zona.lat, 50.08804);

// Viajes compartidos: lo que es de cada móvil no se sube, y el código de la nube se valida.
const compartido = validarViajes({ viajes: [{ id: 'local', nombre: 'Roma', dias: 2, ocultos: [1], nube: { id: '4f773d3134004bd3', version: 3 }, lugares: [] }] })[0];
assert.deepEqual(compartido.nube, { id: '4f773d3134004bd3', version: 3, pendiente: false, base: null });
assert.deepEqual(Object.keys(datosNube(compartido)).filter((k) => ['id', 'nube', 'ocultos'].includes(k)), []);
assert.equal(validarViajes({ viajes: [{ lugares: [], nube: { id: '../otra', version: 1 } }] })[0].nube, null);

{
// Juntar cambios hechos a la vez en dos móviles.
const L = (id, extra = {}) => ({ id, nombre: id, dia: 1, ...extra });
const comun = { nombre: 'Roma', dias: 3, notasDia: {}, lugares: [L('a'), L('b'), L('c')], consejos: [{ id: 'k1', texto: 'uno' }] };
// Yo muevo «b» al día 2 y añado «d»; la otra persona añade un consejo, quita «c» y cambia el nombre.
const miaV = { ...comun, lugares: [L('a'), L('b', { dia: 2 }), L('c'), L('d')] };
const suyaV = { ...comun, nombre: 'Roma en mayo', lugares: [L('a'), L('b')], consejos: [...comun.consejos, { id: 'k2', texto: 'dos' }] };
const junto = fusionar(comun, miaV, suyaV);
assert.equal(junto.nombre, 'Roma en mayo');
assert.deepEqual(junto.lugares.map((l) => `${l.id}${l.dia}`), ['a1', 'b2', 'd1']);
assert.deepEqual(junto.consejos.map((c) => c.id), ['k1', 'k2']);
// Los dos tocan la misma parada en campos distintos: se quedan los dos cambios.
const dosCampos = fusionar(comun, { ...comun, lugares: [L('a', { nota: 'mía' }), L('b'), L('c')] }, { ...comun, lugares: [L('a', { estancia: 90 }), L('b'), L('c')] });
assert.deepEqual(dosCampos.lugares[0], L('a', { nota: 'mía', estancia: 90 }));
// El orden lo pone quien reordena, y lo nuevo del otro va detrás de su vecino.
const orden = fusionar(comun, { ...comun, lugares: [L('c'), L('b'), L('a')] }, { ...comun, lugares: [L('a'), L('x'), L('b'), L('c')] });
assert.deepEqual(orden.lugares.map((l) => l.id), ['c', 'b', 'a', 'x']);
assert.equal(fusionar(null, miaV, suyaV), miaV);
assert.equal(resumenCambios(comun, suyaV), 'ha quitado 1 lugar y ha añadido 1 consejo');
assert.equal(resumenCambios(comun, { ...comun, nombre: 'Otro' }), 'ha cambiado el viaje');
}

// La versión de la caché y la de las novedades van juntas: si no, no sale el aviso de actualización o sale mal.
{
  const { readFileSync } = await import('node:fs');
  const { NOVEDADES } = await import('./novedades.js');
  assert.match(readFileSync(new URL('./sw.js', import.meta.url), 'utf8'), new RegExp(`const CACHE = 'rumbo-${NOVEDADES[0].version}';`));
  assert.ok(NOVEDADES.every((n, i) => !i || n.version < NOVEDADES[i - 1].version));
}

// Un viaje grande del asistente no pierde lugares por situar (antes se cortaba en 40).
assert.equal(validarViajes({ viajes: [{ lugares: [], porSituar: Array.from({ length: 41 }, (_, i) => ({ nombre: `Sitio ${i}` })) }] })[0].porSituar.length, 41);

// Atardecer: en Praga el 10 de diciembre el sol se pone hacia las 15:58 (14:58 UTC); en Madrid el 21 de junio, hacia las 21:48 (19:48 UTC).
const enMinutosUTC = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();
assert.ok(Math.abs(enMinutosUTC(atardecer('2026-12-10', 50.0875, 14.4213)) - (14 * 60 + 58)) <= 4);
assert.ok(Math.abs(enMinutosUTC(atardecer('2026-06-21', 40.4168, -3.7038)) - (19 * 60 + 48)) <= 4);
assert.equal(atardecer('2026-12-21', 78.2, 15.6), null);

// Salida al aeropuerto: vuelo a las 6:40, hotel a unos 12 km → hacia las 4:00, de madrugada.
const conVuelo = {
  dias: 5, hoteles: [{ lat: 50.0905, lon: 14.4290, desde: 1 }],
  vuelta: { salida: '06:40', desde: { iata: 'PRG', lat: 50.1008, lon: 14.26 } },
};
const salida = salidaAeropuerto(conVuelo);
assert.ok(salida.sale >= 3 * 60 + 50 && salida.sale <= 4 * 60 + 10, `sale ${salida.sale}`);
assert.equal(salida.madrugada, true);
assert.equal(salida.desdeHotel, true);
assert.equal(salidaAeropuerto({ dias: 2, hoteles: [], vuelta: { salida: '01:00' } }).anterior, true);
assert.equal(salidaAeropuerto({ dias: 2, hoteles: [], vuelta: null }), null);

assert.equal(monedaDe('CZ'), 'CZK');
assert.equal(monedaDe('ES'), 'EUR');
assert.equal(monedaDe('XX'), '');

// Pendientes, platos y datos del hotel se guardan y se juntan como el resto.
const conListas = validarViajes({ viajes: [{ dias: 2, lugares: [], tareas: [{ texto: 'Reservar barco' }, { texto: ' ' }], probar: [{ nombre: 'Svíčková', probado: true }],
  hoteles: [{ nombre: 'Bílá Labuť', lat: 50.09, lon: 14.43, checkin: '14:00', checkout: '12:00', notas: 'Consigna' }] }] })[0];
assert.deepEqual(conListas.tareas.map((t) => [t.texto, t.hecha]), [['Reservar barco', false]]);
assert.equal(conListas.probar[0].probado, true);
assert.deepEqual([conListas.hoteles[0].checkin, conListas.hoteles[0].checkout, conListas.hoteles[0].notas], ['14:00', '12:00', 'Consigna']);
{
  const t1 = { id: 't1', texto: 'Reservar barco', hecha: false };
  const juntas = fusionar({ tareas: [t1], probar: [] }, { tareas: [{ ...t1, hecha: true }], probar: [] }, { tareas: [t1, { id: 't2', texto: 'Taxi', hecha: false }], probar: [] });
  assert.deepEqual(juntas.tareas.map((t) => `${t.texto}:${t.hecha}`), ['Reservar barco:true', 'Taxi:false']);
}

// Dormir la última noche en un hotel del aeropuerto: trayecto corto y sin prisas de taxi.
{
  const ramada = salidaAeropuerto({ dias: 5, hoteles: [{ nombre: 'Bílá Labuť', lat: 50.09, lon: 14.43, desde: 1 }, { nombre: 'Ramada Airport Hotel Praha', lat: 50.0998, lon: 14.2867, desde: 4 }], vuelta: { salida: '06:50' } });
  assert.deepEqual([ramada.trayecto, ramada.sale, ramada.cerca], [15, 4 * 60 + 25, true]);
  // Aunque el aeropuerto esté a menos de 2 km, el traslado se cuenta en coche.
  const cerca = salidaAeropuerto({ dias: 1, hoteles: [{ nombre: 'Hotel', lat: 50.0998, lon: 14.2867, desde: 1 }], vuelta: { salida: '10:00', desde: { iata: 'PRG', lat: 50.1008, lon: 14.26 } } });
  assert.ok(cerca.trayecto <= 12 && cerca.cerca);
}

// Horas sin «:60» y una cena temprana cuenta como cena.
assert.equal(hora(16 * 60 + 59.7), '17:00');
assert.equal(hora(24 * 60 + 5), '00:05');
{
  const conCena = agenda({ dias: 1 }, 1, [{ tipo: 'monumento', estancia: 540 }, { tipo: 'comida' }], [0, 0]);
  assert.equal(conCena.horas[1].llega, 19 * 60);
  assert.deepEqual(conCena.comidas.map((c) => c.tipo), ['comida']);
}

// Organizar por horas: una visita de 4 horas se queda sola en su día y las cortas van juntas en el otro.
{
  const larga = { id: 'M', lat: 0, lon: 0, tipo: 'museo', estancia: 240 };
  const cortas = Array.from({ length: 6 }, (_, i) => ({ id: `s${i}`, lat: 0, lon: 0.002 * (i + 1), tipo: 'otro', estancia: 20 }));
  const r = organizar({ dias: 2, hoteles: [], lugares: [larga, ...cortas] });
  const diaDe = Object.fromEntries(r.map((l) => [l.id, l.dia]));
  assert.ok(cortas.every((c) => diaDe[c.id] !== diaDe.M), JSON.stringify(diaDe));
}
// Un sitio que cierra los jueves no cae en jueves (el viaje empieza un jueves).
{
  const lugares = [
    { id: 'x', lat: 0, lon: 0, tipo: 'museo', horario: 'Mo-We,Fr-Su 10:00-18:00' },
    { id: 'a', lat: 0, lon: 0.001, tipo: 'otro' }, { id: 'b', lat: 0, lon: 0.002, tipo: 'otro' },
    { id: 'c', lat: 0, lon: 0.003, tipo: 'otro' }, { id: 'd', lat: 0, lon: 0.004, tipo: 'otro' },
  ];
  const r = organizar({ dias: 2, fecha: '2026-12-10', hoteles: [], lugares });
  assert.equal(r.find((l) => l.id === 'x').dia, 2);
}
// Las comidas a su hora: café al empezar, comida a mediodía entre visitas, cena al final y copas lo último.
{
  const hotel = { lat: 0, lon: 0 };
  const lugares = [
    { id: 'B', lat: 0, lon: 0.004, tipo: 'copas' }, { id: 'L1', lat: 0, lon: 0.005, tipo: 'comida' }, { id: 'L2', lat: 0, lon: 0.001, tipo: 'comida' },
    { id: 'V1', lat: 0, lon: 0.002, tipo: 'monumento', estancia: 90 }, { id: 'V2', lat: 0, lon: 0.003, tipo: 'monumento', estancia: 90 },
    { id: 'V3', lat: 0, lon: 0.006, tipo: 'monumento', estancia: 90 }, { id: 'V4', lat: 0, lon: 0.007, tipo: 'monumento', estancia: 90 },
    { id: 'C', lat: 0, lon: 0.008, tipo: 'cafe' }, { id: 'M', lat: 0, lon: 0.0035, tipo: 'mirador' },
  ];
  const orden = organizar({ dias: 1, hoteles: [{ ...hotel, desde: 1 }], lugares }).map((l) => l.id);
  assert.equal(orden[0], 'C');
  assert.equal(orden.at(-1), 'B');
  const comer = orden.findIndex((id) => id.startsWith('L'));
  assert.ok(comer > 1 && comer < orden.length - 3, orden.join());
  assert.ok(orden.at(-2).startsWith('L') && orden.at(-3) === 'M', orden.join());
  // Ordenar cada día aplica lo mismo sin cambiar a nadie de día.
  assert.deepEqual(ordenarDias({ dias: 1, hoteles: [{ ...hotel, desde: 1 }], lugares: lugares.map((l) => ({ ...l, dia: 1 })) }).map((l) => l.id), orden);
}
// Los restaurantes se reparten: no se juntan cuatro en el mismo día habiendo otro.
{
  const lugares = [
    ...['V1', 'V2', 'V3', 'V4'].map((id, i) => ({ id, lat: 0, lon: i * 0.02, tipo: 'monumento' })),
    ...['R1', 'R2', 'R3', 'R4'].map((id) => ({ id, lat: 0, lon: 0.001, tipo: 'comida' })),
  ];
  const r = organizar({ dias: 2, hoteles: [], lugares });
  const porDia = [1, 2].map((d) => r.filter((l) => l.dia === d && l.tipo === 'comida').length);
  assert.deepEqual(porDia, [2, 2]);
}
// Los que no caben en ningún día se quedan sin día, como alternativas.
{
  const lugares = [
    { id: 'V', lat: 0, lon: 0, tipo: 'monumento' },
    ...['R1', 'R2', 'R3', 'R4'].map((id) => ({ id, lat: 0, lon: 0.001, tipo: 'comida' })),
  ];
  const r = organizar({ dias: 1, hoteles: [], lugares });
  assert.equal(r.length, 5);
  assert.equal(r.filter((l) => l.tipo === 'comida' && l.dia === 1).length, 2);
  assert.equal(r.filter((l) => !l.dia).length, 2);
}
// Con la hora de la puesta, el mirador no se deja para el final si así se vería de noche.
{
  const lugares = ['V1', 'V2', 'V3', 'V4'].map((id, i) => ({ id, lat: 0, lon: i * 0.002, tipo: 'monumento', estancia: 120 }));
  lugares.push({ id: 'M', lat: 0, lon: 0.003, tipo: 'mirador' });
  const v = { dias: 1, hoteles: [], lugares };
  assert.equal(organizar(v).at(-1).id, 'M');
  const orden = organizar(v, { puesta: () => 16 * 60 }).map((l) => l.id);
  assert.ok(orden.indexOf('M') < orden.length - 1, orden.join());
}
// Transporte público: los trayectos largos van en él, con su espera, y los mapas reciben un enlace por trayecto.
{
  const [a, b, c] = [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.1 }, { lat: 0, lon: 0.2 }];
  assert.ok(minutosTramo(a, b, 'publico') > minutosTramo(a, b));
  assert.equal(minutosTramo(a, { lat: 0, lon: 0.001 }, 'publico'), minutosTramo(a, { lat: 0, lon: 0.001 }));
  assert.deepEqual(tramosRuta([a, b, c], 'publico').map((t) => t.modo), ['publico']);
  const enlaces = enlacesRuta('google', [a, b, c], 'publico');
  assert.equal(enlaces.length, 2);
  assert.ok(enlaces.every((e) => e.href.includes('travelmode=transit') && !e.href.includes('waypoints')));
  assert.equal(validarViajes({ viajes: [{ lugares: [], movilidad: 'publico' }] })[0].movilidad, 'publico');
  assert.equal('movilidad' in validarViajes({ viajes: [{ lugares: [] }] })[0], false);
}
// Avisos de horario al llegar: cerrado, aún sin abrir o a punto de cerrar.
{
  assert.equal(avisoHorario(['10:00-18:00'], 12 * 60), null);
  assert.deepEqual(avisoHorario(['10:00-18:00'], 17 * 60 + 20), { tipo: 'justo', cierra: 18 * 60 });
  assert.deepEqual(avisoHorario(['10:00-18:00'], 9 * 60 + 15), { tipo: 'antes', abre: 10 * 60 });
  assert.deepEqual(avisoHorario(['10:00-18:00'], 19 * 60), { tipo: 'cerrado', cierra: 18 * 60 });
  assert.deepEqual(avisoHorario(['11:00-15:00', '18:00-23:00'], 16 * 60), { tipo: 'antes', abre: 18 * 60 });
  assert.equal(avisoHorario(['18:00-02:00'], 22 * 60), null);
  assert.equal(avisoHorario([], 12 * 60), null);
}
// Teselas para usar el mapa sin conexión: el recuadro con poco zoom y el entorno de cada punto con mucho.
{
  const t = teselasDe([{ lat: 50.087, lon: 14.421 }, { lat: 50.09, lon: 14.4 }]);
  const de = (z) => t.filter(([zz]) => zz === z);
  assert.ok(de(10).length >= 1 && de(16).length > de(14).length);
  assert.ok(t.some(([z, x, y]) => z === 16 && x === 35393 && y === 22201), 'la tesela del centro de Praga');
  assert.equal(new Set(t.map((x) => x.join('/'))).size, t.length);
  assert.ok(t.length < 1500, String(t.length));
  assert.deepEqual(teselasDe([]), []);
}
