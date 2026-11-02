import type { NextFunction, Request, Response } from "express";
import { supabaseAdmin } from "../config/supabase.js";

export async function requireAuth(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const authorization = request.header("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return response.status(401).json({ error: "No autenticado" });
  }

  const accessToken = authorization.slice("Bearer ".length).trim();

  if (!accessToken) {
    return response.status(401).json({ error: "No autenticado" });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(accessToken);

    if (error || !data.user) {
      return response.status(401).json({ error: "Token inválido o expirado" });
    }

    response.locals.userId = data.user.id;
    return next();
  } catch {
    return response
      .status(503)
      .json({ error: "No fue posible validar la autenticación" });
  }
}
