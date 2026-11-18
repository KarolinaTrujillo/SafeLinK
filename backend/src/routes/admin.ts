import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAdmin } from "../middleware/admin.js";
import { supabaseAdmin } from "../config/supabase.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);
adminRouter.use((_request, response, next) => { response.setHeader("Cache-Control", "no-store"); next(); });

adminRouter.get("/panel", async (request, response) => {
  const busqueda = request.query.busqueda ?? "";
  const estado = request.query.estado ?? "Todos";
  const pagina = Number(request.query.pagina ?? 1);
  if (typeof busqueda !== "string" || busqueda.length > 150 || typeof estado !== "string" ||
    !["Todos", "Activo", "Revocado", "Vencido", "Agotado", "Sin enlace"].includes(estado) || !Number.isInteger(pagina) || pagina < 1 || pagina > 100000) {
    return response.status(400).json({ error: "Los filtros o la página no son válidos." });
  }
  const { data, error } = await supabaseAdmin.rpc("consultar_panel_admin", { p_busqueda: busqueda.trim(), p_estado: estado, p_pagina: pagina });
  if (error || !data) return response.status(503).json({ error: "No se pudo cargar el panel administrativo. Comprueba que la migración del panel esté aplicada." });
  return response.json(data);
});

adminRouter.get("/eventos", async (request, response) => {
  const pagina = Number(request.query.pagina ?? 1);
  if (!Number.isInteger(pagina) || pagina < 1 || pagina > 100000) return response.status(400).json({ error: "Página inválida." });
  const { data, count, error } = await supabaseAdmin.from("eventos_acceso")
    .select("id, tipo_evento, resultado, motivo, creado_en", { count: "exact" })
    .gte("creado_en", new Date(Date.now() - 60 * 86400000).toISOString())
    .order("creado_en", { ascending: false }).order("id").range((pagina - 1) * 10, pagina * 10 - 1);
  if (error) return response.status(503).json({ error: "No se pudieron cargar los eventos." });
  return response.json({ eventos: data ?? [], total: count ?? 0 });
});

adminRouter.post("/enlaces/:id/revocar", async (request, response) => {
  const id = String(request.params.id);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return response.status(400).json({ error: "Enlace inválido." });
  const { data, error } = await supabaseAdmin.rpc("revocar_enlace_admin", { p_enlace_id: id });
  if (error) return response.status(503).json({ error: "No se pudo revocar el enlace." });
  if (!data) return response.status(404).json({ error: "Enlace no disponible." });
  return response.json({ revocado: true });
});

adminRouter.use(((error, _request, response, _next) => {
  void error;
  response.status(503).json({ error: "No se pudo completar la operación administrativa." });
}) as import("express").ErrorRequestHandler);
