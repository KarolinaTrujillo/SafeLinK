import { createClient } from "npm:@supabase/supabase-js@2.79.0";
import { crearHandler, type AlmacenLimpieza, type Plan, type Reserva } from "./limpieza.ts";

function crearAlmacen(): AlmacenLimpieza {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("Configuración incompleta");
  const cliente = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  async function rpc<T>(nombre: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await cliente.rpc(nombre, args);
    if (error) throw new Error("Falló la operación de limpieza");
    return data as T;
  }
  return {
    revisar: () => rpc<Plan>("revisar_limpieza"),
    preparar: () => rpc<void>("preparar_limpieza"),
    reclamar: (id) => rpc<Reserva | null>("reclamar_limpieza", { p_id: id }),
    async borrarObjeto(ruta) {
      const { error } = await cliente.storage.from("safelink-files").remove([ruta]);
      // Storage remove es idempotente: si el objeto ya no existe, se puede cerrar
      // un borrado anterior cuyos metadatos quedaron pendientes por un fallo.
      if (error) throw new Error("No se pudo eliminar el objeto");
    },
    cerrar: (id, token, exito) => rpc<boolean>("cerrar_limpieza", { p_id: id, p_token: token, p_exito: exito }),
    purgarEventos: () => rpc<number>("purgar_eventos_vencidos"),
  };
}

// Cron usa un secreto exclusivo. No acepta sesiones ni claves públicas de usuarios.
Deno.serve(crearHandler(Deno.env.get("LIMPIEZA_SECRET"), crearAlmacen));
