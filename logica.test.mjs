import assert from 'node:assert/strict';
import { extraerLugares, parecido, organizar, ordenarRuta, largo, extremosDelDia, minutosUtiles, estimarLlegada, enlacesRuta, validarViajes, distanciaKm, diasValidos, coincide, tramosRuta, fotoDe, enlaceLugar, horarioDelDia, decodificarPolilinea, claveRuta, duracion, tiempoDe, bandera, empaquetar, desempaquetar, mismoViaje, actualizarViaje, adivinarCategoria, mejorHueco, ordenarDias, agenda, hora, minutosTramo } from './logica.js';

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
