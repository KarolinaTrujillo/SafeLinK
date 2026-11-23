export type ResultadoDescarga = 'exitoso' | 'fallido' | 'no_confirmado';
type Rpc = (nombre: string, args: Record<string, unknown>, signal: AbortSignal) => PromiseLike<{ data?: unknown; error?: unknown }>;
type Reloj = {
  despues(ms: number, fn: () => void): () => void;
  cada(ms: number, fn: () => void): () => void;
  pausa(ms: number): Promise<void>;
};
const relojReal: Reloj = {
  despues(ms, fn) { const timer = setTimeout(fn, ms); timer.unref(); return () => clearTimeout(timer); },
  cada(ms, fn) { const timer = setInterval(fn, ms); timer.unref(); return () => clearInterval(timer); },
  pausa: ms => new Promise(resolve => setTimeout(resolve, ms)),
};

// No conoce respuestas HTTP ni credenciales. El reloj se inyecta en las pruebas.
export function crearControlReserva({ reservaId, rpc, detener, reloj = relojReal }: {
  reservaId: string; rpc: Rpc; detener: () => void; reloj?: Reloj;
}) {
  let activa = false;
  let cerrando: Promise<void> | undefined;
  let renovando: Promise<boolean> | undefined;
  let cancelarRenovacion = () => {};
  let cancelarLimite = () => {};
  function parar() { activa = false; cancelarRenovacion(); cancelarLimite(); }
  async function llamar(nombre: string, args: Record<string, unknown>) {
    const abort = new AbortController();
    let cancelar = () => {};
    try {
      return await Promise.race([
        Promise.resolve().then(() => rpc(nombre, args, abort.signal)),
        new Promise<never>((_resolve, reject) => {
          cancelar = reloj.despues(10_000, () => { abort.abort(); reject(new Error('Tiempo de RPC agotado')); });
        }),
      ]);
    } finally { cancelar(); }
  }
  async function renovar() {
    if (!activa || cerrando) return false;
    if (renovando) return renovando;
    renovando = (async () => {
      try {
        const resultado = await llamar('renovar_reserva_descarga', { p_reserva_id: reservaId });
        if (resultado.error || resultado.data !== true) throw new Error('Reserva no vigente');
        return activa && !cerrando;
      } catch {
        if (activa && !cerrando) { parar(); detener(); }
        return false;
      } finally { renovando = undefined; }
    })();
    return renovando;
  }
  async function iniciar() {
    // La primera comprobación también impide enviar con una migración faltante.
    if (cerrando) return false;
    try {
      const resultado = await llamar('renovar_reserva_descarga', { p_reserva_id: reservaId });
      if (cerrando || resultado.error || resultado.data !== true) return false;
      activa = true;
      cancelarRenovacion = reloj.cada(20_000, () => { void renovar(); });
      // Menor que el límite absoluto de BD (10 minutos), con margen para cerrar.
      cancelarLimite = reloj.despues(9 * 60_000, () => { if (activa) { parar(); detener(); } });
      return true;
    } catch { return false; }
  }
  function cerrar(resultado: ResultadoDescarga): Promise<void> {
    if (cerrando) return cerrando;
    parar();
    cerrando = (async () => {
      for (let intento = 0; intento < 3; intento++) {
        try {
          const respuesta = await llamar('cerrar_reserva_descarga', { p_reserva_id: reservaId, p_resultado: resultado });
          if (!respuesta.error && typeof respuesta.data === 'boolean') return; // false: cierre ya realizado.
        } catch { /* El resultado original se conserva en cada reintento. */ }
        if (intento < 2) await reloj.pausa((intento + 1) * 250);
      }
      // Cron recuperará la reserva; nunca liberar cupo por un fallo de comunicación.
      console.error('No se pudo confirmar el cierre de descarga; recuperación automática pendiente.');
    })();
    return cerrando;
  }
  return { iniciar, renovar, cerrar, vigente: () => activa && !cerrando };
}
