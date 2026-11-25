import assert from 'node:assert/strict';
import { extraerLugares, parecido, organizar, ordenarRuta, largo, extremosDelDia, minutosUtiles, estimarLlegada, enlacesRuta, validarViajes, distanciaKm, diasValidos } from './logica.js';

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
assert.equal(new URL(enlacesRuta('google', puntos)[0]).searchParams.get('waypoints').split('|').length, 9);
assert.equal(new URL(enlacesRuta('google', puntos)[1]).searchParams.get('origin'), '0,0.1');
assert.equal(new URL(enlacesRuta('apple', puntos)[0]).searchParams.getAll('waypoint').length, 9);
assert.equal(enlacesRuta('apple', puntos.slice(0, 11)).length, 1);
assert.equal(new URL(enlacesRuta('apple', [p('', 0, 0), p('', 0, 1)])[0]).searchParams.get('mode'), 'driving');
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
