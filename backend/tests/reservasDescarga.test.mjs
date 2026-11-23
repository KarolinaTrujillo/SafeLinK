import test from 'node:test';
import assert from 'node:assert/strict';
import { crearControlReserva } from '../src/reservasDescarga.ts';

function entorno(rpc) {
  const pendientes = new Set();
  let detenciones = 0;
  const programar = (ms, fn, repetido = false) => {
    const item = { ms, fn, repetido }; pendientes.add(item);
    return () => pendientes.delete(item);
  };
  const reloj = {
    despues: (ms, fn) => programar(ms, fn),
    cada: (ms, fn) => programar(ms, fn, true),
    pausa: async () => {},
  };
  const control = crearControlReserva({ reservaId: 'reserva', rpc, detener: () => { detenciones++; }, reloj });
  return {
    control, pendientes, get detenciones() { return detenciones; },
    async disparar(ms) {
      for (const item of [...pendientes].filter(item => item.ms === ms)) {
        if (!item.repetido) pendientes.delete(item);
        item.fn();
      }
      await new Promise(resolve => setImmediate(resolve));
    },
  };
}

test('Renueva mientras está activa; al cerrar cancela todos los temporizadores', async () => {
  const llamadas = [];
  const e = entorno(async (nombre, args) => { llamadas.push([nombre, args]); return { data: true }; });
  assert.equal(await e.control.iniciar(), true);
  await e.disparar(20_000);
  assert.equal(llamadas.filter(([nombre]) => nombre === 'renovar_reserva_descarga').length, 2);
  await e.control.cerrar('exitoso');
  await e.disparar(20_000);
  assert.equal(e.pendientes.size, 0);
  assert.equal(e.control.vigente(), false);
  assert.equal(e.detenciones, 0);
});

test('Una reserva que no se puede renovar detiene el envío y no vuelve a activarse', async () => {
  let renovaciones = 0;
  const e = entorno(async () => ({ data: ++renovaciones === 1 }));
  assert.equal(await e.control.iniciar(), true);
  await e.disparar(20_000);
  assert.equal(e.detenciones, 1);
  assert.equal(e.control.vigente(), false);
  assert.equal(await e.control.renovar(), false);
  assert.equal(e.pendientes.size, 0);
});

test('El límite de 9 minutos detiene la transferencia aunque continúen las renovaciones', async () => {
  const e = entorno(async () => ({ data: true }));
  await e.control.iniciar();
  await e.disparar(9 * 60_000);
  assert.equal(e.detenciones, 1);
  assert.equal(e.control.vigente(), false);
  assert.equal(e.pendientes.size, 0);
});

test('Una RPC colgada se aborta; nunca se interpreta como renovación exitosa', async () => {
  let signal;
  const e = entorno((_nombre, _args, recibido) => { signal = recibido; return new Promise(() => {}); });
  const inicio = e.control.iniciar();
  await Promise.resolve();
  await e.disparar(10_000);
  assert.equal(await inicio, false);
  assert.equal(signal.aborted, true);
  assert.equal(e.control.vigente(), false);
});

test('Reintenta el mismo resultado tras errores y los eventos repetidos comparten un cierre', async () => {
  const cierres = [];
  const e = entorno(async (nombre, args) => {
    if (nombre === 'renovar_reserva_descarga') return { data: true };
    cierres.push(args);
    return cierres.length < 3 ? { error: { code: 'simulado' } } : { data: true };
  });
  await e.control.iniciar();
  const primero = e.control.cerrar('no_confirmado');
  assert.equal(primero, e.control.cerrar('fallido'));
  await primero;
  assert.equal(cierres.length, 3);
  assert.ok(cierres.every(args => args.p_resultado === 'no_confirmado'));
  assert.equal(e.pendientes.size, 0);
});

test('Si todos los cierres fallan deja la recuperación a Cron, sin liberar como fallido', async t => {
  const mensajes = [];
  t.mock.method(console, 'error', mensaje => mensajes.push(mensaje));
  let cierres = 0;
  const e = entorno(async (nombre, args) => {
    if (nombre === 'renovar_reserva_descarga') return { data: true };
    cierres++; assert.equal(args.p_resultado, 'exitoso');
    throw new Error('Desconexión');
  });
  await e.control.iniciar(); await e.control.cerrar('exitoso');
  assert.equal(cierres, 3);
  assert.equal(mensajes.length, 1);
  assert.ok(!mensajes[0].includes('reservaId'));
});

test('Una renovación tardía no reactiva una reserva que ya se cerró', async () => {
  let resolver;
  let renovaciones = 0;
  const e = entorno(async nombre => {
    if (nombre !== 'renovar_reserva_descarga' || ++renovaciones === 1) return { data: true };
    return new Promise(resolve => { resolver = resolve; });
  });
  await e.control.iniciar();
  const renovacion = e.control.renovar();
  await Promise.resolve();
  await e.control.cerrar('fallido');
  resolver({ data: true });
  assert.equal(await renovacion, false);
  assert.equal(e.control.vigente(), false);
  assert.equal(e.pendientes.size, 0);
});
