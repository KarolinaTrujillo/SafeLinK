import test from 'node:test';
import assert from 'node:assert/strict';
import { crearHandler } from '../functions/limpiar-archivos/limpieza.ts';

const secreto = 'secreto-de-prueba-local-de-al-menos-32-caracteres';
const plan = { corteEventos: '2026-09-22', eventosVencidos: 3, archivosVencidos: 1, pendientesPorReservas: 0,
  archivos: [{id: 'archivo', nombre: 'prueba.pdf', eliminarEn: '2026-11-20', reservas: 0, estado: 'activo'}] };
function escenario(cambios = {}) {
  const pasos = [];
  const almacen = {
    revisar: async () => { pasos.push('revisar'); return plan; },
    preparar: async () => { pasos.push('preparar'); },
    reclamar: async () => { pasos.push('reclamar'); return {id: 'archivo', ruta: 'ruta-privada', token: 'token-reclamacion'}; },
    borrarObjeto: async () => { pasos.push('storage'); },
    cerrar: async (_id, _token, exito) => { pasos.push(exito ? 'cerrar-exito' : 'cerrar-fallo'); return exito; },
    purgarEventos: async () => { pasos.push('purgar'); return 3; },
    ...cambios,
  };
  return { pasos, almacen, handler: crearHandler(secreto, () => almacen) };
}
function peticion(body = '{}', key = secreto, method = 'POST') {
  return new Request('https://example.test/limpiar-archivos', { method, headers: {'x-limpieza-secret':key}, ...(method === 'POST' ? {body} : {}) });
}

test('Sin secreto configurado falla cerrado, sin consultar datos', async () => {
  const handler = crearHandler(undefined, () => assert.fail('No debe crear el cliente'));
  assert.equal((await handler(peticion())).status, 503);
});
test('Una sesión o clave pública no sustituye el secreto exclusivo', async () => {
  const handler = crearHandler(secreto, () => assert.fail('No debe consultar datos'));
  assert.equal((await handler(peticion('{}','clave-incorrecta'))).status, 401);
});
test('GET no ejecuta tareas de limpieza', async () => {
  const e = escenario();
  assert.equal((await e.handler(peticion(undefined,secreto,'GET'))).status, 405);
  assert.deepEqual(e.pasos, []);
});
test('El modo predeterminado revisa y no escribe ni borra', async () => {
  const e = escenario();
  const res = await e.handler(peticion());
  assert.equal(res.status, 200);
  const datos = await res.json();
  assert.equal(datos.modo, 'revision'); assert.equal(datos.borrados, 0);
  assert.equal(datos.archivos[0].nombre, 'prueba.pdf');
  assert.deepEqual(e.pasos, ['revisar']);
});
test('Un modo mal escrito o cuerpo inválido nunca provoca borrado', async () => {
  const e = escenario();
  for (const body of ['{"modo":true}', '{"modo":"ejecuta"}', 'null','[]','no-json']) {
    assert.equal((await e.handler(peticion(body))).status, 400);
  }
  assert.deepEqual(e.pasos, []);
});
test('Rechaza cuerpos grandes antes de consultar datos', async () => {
  const e = escenario();
  assert.equal((await e.handler(peticion('a'.repeat(1025)))).status, 413);
  assert.deepEqual(e.pasos, []);
});
test('Revalida el archivo y borra Storage antes de eliminar metadatos', async () => {
  const e = escenario();
  const res = await e.handler(peticion('{"modo":"ejecutar"}'));
  assert.equal(res.status, 200); assert.equal((await res.json()).borrados, 1);
  assert.deepEqual(e.pasos, ['preparar','revisar','reclamar','storage','cerrar-exito','purgar']);
});
test('Si el archivo se reactivó o hay otra ejecución, no borra el objeto', async () => {
  const e = escenario({reclamar: async () => null});
  const res = await e.handler(peticion('{"modo":"ejecutar"}'));
  assert.equal((await res.json()).omitidos, 1);
  assert.ok(!e.pasos.includes('storage')); assert.ok(!e.pasos.includes('cerrar-exito'));
});
test('Si falla Storage no elimina metadatos y registra el fallo para reintento', async () => {
  const e = escenario({borrarObjeto: async () => { throw Error('error privado de prueba'); }});
  const res = await e.handler(peticion('{"modo":"ejecutar"}'));
  assert.equal(res.status, 207); assert.equal((await res.json()).errores, 1);
  assert.ok(e.pasos.includes('cerrar-fallo')); assert.ok(!e.pasos.includes('cerrar-exito'));
});
test('Si falla el cierre después de Storage, no reabre el archivo ni libera cupo', async () => {
  const e = escenario({cerrar: async (_id,_token,exito) => { assert.equal(exito,true); throw Error('Error DB'); }});
  const res = await e.handler(peticion('{"modo":"ejecutar"}'));
  assert.equal(res.status, 207); assert.equal((await res.json()).borrados, 0);
  assert.ok(!e.pasos.includes('cerrar-fallo'));
});
test('El lote ejecutado nunca supera los 20 archivos', async () => {
  let reclamaciones = 0;
  const e = escenario({revisar: async () => ({...plan,archivos:Array(40).fill(plan.archivos[0])}), reclamar: async () => {reclamaciones++;return null;}});
  await e.handler(peticion('{"modo":"ejecutar"}'));
  assert.equal(reclamaciones, 20);
});
