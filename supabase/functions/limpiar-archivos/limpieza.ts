// La lógica recibe un adaptador para poder probarla sin borrar datos reales.
export type Plan = {
  corteEventos: string;
  eventosVencidos: number;
  archivosVencidos: number;
  pendientesPorReservas: number;
  archivos: { id: string; nombre: string; eliminarEn: string; reservas: number; estado: string }[];
};
export type Reserva = { id: string; ruta: string; token: string };
export type AlmacenLimpieza = {
  revisar(): Promise<Plan>;
  preparar(): Promise<void>;
  reclamar(id: string): Promise<Reserva | null>;
  borrarObjeto(ruta: string): Promise<void>;
  cerrar(id: string, token: string, exito: boolean): Promise<boolean>;
  purgarEventos(): Promise<number>;
};

function json(datos: unknown, status = 200) {
  return new Response(JSON.stringify(datos), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

async function secretoCorrecto(recibido: string, esperado: string) {
  const codificador = new TextEncoder();
  const [a, b] = await Promise.all([recibido, esperado].map(async (valor) =>
    new Uint8Array(await crypto.subtle.digest("SHA-256", codificador.encode(valor)))));
  let diferencia = 0;
  for (let i = 0; i < a.length; i++) diferencia |= a[i] ^ b[i];
  return diferencia === 0;
}

export function crearHandler(secreto: string | undefined, crearAlmacen: () => AlmacenLimpieza) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return json({ error: "Usa POST." }, 405);
    if (!secreto || secreto.length < 32) return json({ error: "La limpieza no está configurada." }, 503);
    const recibido = request.headers.get("x-limpieza-secret") ?? "";
    if (!recibido || recibido.length > 512 || !await secretoCorrecto(recibido, secreto)) return json({ error: "No autorizado." }, 401);
    // Leer un cuerpo pequeño. Ante un error nunca asumir el modo de borrado.
    let body: unknown;
    try {
      if (Number(request.headers.get("content-length")) > 1024) return json({ error: "Solicitud demasiado grande." }, 413);
      const lector = request.body?.getReader();
      let texto = "";
      if (lector) {
        const decoder = new TextDecoder();
        let bytes = 0;
        while (true) {
          const { done, value } = await lector.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 1024) { await lector.cancel(); return json({ error: "Solicitud demasiado grande." }, 413); }
          texto += decoder.decode(value, { stream: true });
        }
        texto += decoder.decode();
      }
      body = texto ? JSON.parse(texto) : {};
    } catch { return json({ error: "JSON inválido." }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Solicitud inválida." }, 400);
    const modo = (body as { modo?: unknown }).modo ?? "revision";
    if (modo !== "revision" && modo !== "ejecutar") return json({ error: "El modo debe ser revision o ejecutar." }, 400);
    try {
      const almacen = crearAlmacen();
      if (modo === "ejecutar") await almacen.preparar();
      const plan = await almacen.revisar();
      if (modo === "revision") return json({ modo, ...plan, borrados: 0 });
      let borrados = 0;
      let omitidos = 0;
      let errores = 0;
      for (const archivo of plan.archivos.slice(0, 20)) {
        let reserva: Reserva | null = null;
        let objetoBorrado = false;
        try {
          // Revalida bajo bloqueo; el plan por sí solo no autoriza el borrado.
          reserva = await almacen.reclamar(archivo.id);
          if (!reserva) { omitidos++; continue; }
          await almacen.borrarObjeto(reserva.ruta);
          objetoBorrado = true;
          if (await almacen.cerrar(reserva.id, reserva.token, true)) borrados++;
          else errores++;
        } catch {
          errores++;
          // Si Storage ya borró el objeto, conservar la reclamación y reintentar
          // después de 15 minutos. No reabrir el archivo ni liberar su cupo.
          if (reserva && !objetoBorrado) {
            try { await almacen.cerrar(reserva.id, reserva.token, false); } catch { /* Reintento posterior. */ }
          }
        }
      }
      const eventosBorrados = await almacen.purgarEventos();
      return json({ modo, revisados: Math.min(plan.archivos.length, 20), borrados, omitidos, errores, eventosBorrados }, errores ? 207 : 200);
    } catch { return json({ error: "No se pudo completar la limpieza. Revisa la configuración y la migración." }, 503); }
  };
}
