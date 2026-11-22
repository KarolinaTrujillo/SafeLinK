import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

export const archivosRouter = Router();
archivosRouter.use(requireAuth);
archivosRouter.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

archivosRouter.delete("/:id", async (request, response) => {
  const id = String(request.params.id);
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    return response.status(400).json({ error: "Archivo inválido." });
  }
  const { data: reserva, error } = await supabaseAdmin.rpc("solicitar_eliminacion_archivo", {
    p_id: id, p_propietario_id: response.locals.userId,
  });
  if (error || !reserva) return response.status(503).json({ error: "No se pudo preparar la eliminación. Inténtalo de nuevo." });
  if (reserva.estado === "no_disponible") return response.status(404).json({ error: "Archivo no disponible." });
  if (reserva.estado === "ocupado") return response.status(409).json({ error: "Hay descargas en curso. Espera a que terminen antes de eliminar el archivo." });
  if (reserva.estado === "en_proceso") return response.status(409).json({ error: "La eliminación ya está en proceso. Actualiza la lista en unos momentos." });
  if (reserva.estado !== "preparado" || reserva.id !== id || !reserva.ruta || !reserva.token) {
    return response.status(503).json({ error: "No se pudo preparar la eliminación." });
  }
  // El estado pendiente ya impide nuevas descargas. Solo liberar cuota tras borrar Storage.
  const { error: errorStorage } = await supabaseAdmin.storage.from("safelink-files").remove([reserva.ruta]);
  if (errorStorage) {
    await supabaseAdmin.rpc("cerrar_limpieza", { p_id: id, p_token: reserva.token, p_exito: false });
    return response.status(503).json({ error: "No se pudo eliminar el archivo de Storage. Quedó pendiente; puedes reintentarlo o esperar la limpieza automática." });
  }
  const { data: eliminado, error: errorCerrar } = await supabaseAdmin.rpc("cerrar_limpieza", {
    p_id: id, p_token: reserva.token, p_exito: true,
  });
  // Si falló el cierre, conservar la reclamación para que la tarea automática recupere el trabajo.
  if (errorCerrar || eliminado !== true) return response.status(503).json({ error: "El borrado quedó pendiente de confirmación. Actualiza la lista más tarde; el cupo se libera al completarlo." });
  return response.json({ eliminado: true });
});

archivosRouter.use(((error, _request, response, _next) => {
  void error;
  response.status(503).json({ error: "No se pudo completar la eliminación. Actualiza la lista para comprobar su estado." });
}) as import("express").ErrorRequestHandler);
