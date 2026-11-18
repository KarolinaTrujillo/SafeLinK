import type { RequestHandler } from "express";
import { supabaseAdmin } from "../config/supabase.js";

// Usar después de requireAuth. El rol viene de perfiles, nunca del navegador.
export const requireAdmin: RequestHandler = async (_request, response, next) => {
  const { data, error } = await supabaseAdmin.from("perfiles")
    .select("rol").eq("id", response.locals.userId).maybeSingle();
  if (error) return response.status(503).json({ error: "No se pudo comprobar el permiso administrativo." });
  if (data?.rol !== "administrador") return response.status(403).json({ error: "Solo los administradores pueden acceder a este panel." });
  next();
};
