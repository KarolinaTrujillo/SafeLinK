import { Router } from "express";
import { createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { supabaseAdmin } from "../config/supabase.js";

export const descargasRouter = Router();
const derivarClave = promisify(scrypt);
let verificacionesEnCurso = 0;
const mensajeNoDisponible = "El enlace no está disponible. Solicita uno nuevo a quien te lo compartió.";

async function claveCorrecta(clave: string, guardada: string | null) {
  if (!guardada) return true;
  const [algoritmo, sal, hash] = guardada.split(":");
  if (algoritmo !== "scrypt" || !sal || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const comprobacion = await derivarClave(clave, sal, 64) as Buffer;
  return timingSafeEqual(Buffer.from(hash, "hex"), comprobacion);
}

// La URL es una credencial: no cachear sus respuestas ni registrar el token.
descargasRouter.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  next();
});

descargasRouter.use("/:token", async (request, response, next) => {
  const token = String(request.params.token);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return response.status(404).json({ error: mensajeNoDisponible });
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: enlace, error } = await supabaseAdmin.from("enlaces_compartidos")
    .select("id, archivo_id, hash_contrasena, vence_en, maximo_descargas, descargas_realizadas, revocado_en, bloqueado_hasta, intentos_fallidos")
    .eq("hash_token", hash).maybeSingle();
  if (error) return response.status(503).json({ error: "No se pudo consultar el enlace. Inténtalo más tarde." });
  if (!enlace || enlace.revocado_en || Date.parse(enlace.vence_en) <= Date.now() || enlace.descargas_realizadas >= enlace.maximo_descargas) {
    return response.status(404).json({ error: mensajeNoDisponible });
  }
  const { data: archivo, error: errorArchivo } = await supabaseAdmin.from("archivos")
    .select("nombre_original, tipo_mime, tamano_bytes, estado_limpieza").eq("id", enlace.archivo_id).maybeSingle();
  if (errorArchivo) return response.status(503).json({ error: "No se pudo consultar el archivo. Inténtalo más tarde." });
  if (!archivo || archivo.estado_limpieza !== "activo") return response.status(404).json({ error: mensajeNoDisponible });
  response.locals.enlace = enlace;
  response.locals.archivo = archivo;
  response.locals.hashToken = hash;
  next();
});

descargasRouter.get("/:token", (_request, response) => {
  const enlace = response.locals.enlace;
  const archivo = response.locals.archivo;
  return response.json({
    nombre: archivo.nombre_original, tipoMime: archivo.tipo_mime, tamanoBytes: Number(archivo.tamano_bytes),
    protegido: Boolean(enlace.hash_contrasena), intentosRestantes: 5 - enlace.intentos_fallidos,
    bloqueadoHasta: enlace.bloqueado_hasta,
  });
});

descargasRouter.post("/:token", async (request, response) => {
  const clave = request.body?.contrasena ?? "";
  if (typeof clave !== "string" || clave.length > 128) return response.status(400).json({ error: "La contraseña no es válida." });
  const enlace = response.locals.enlace;
  if (enlace.bloqueado_hasta && Date.parse(enlace.bloqueado_hasta) > Date.now()) {
    return response.status(429).json({ error: "Acceso bloqueado temporalmente por intentos fallidos.", reintentarEn: enlace.bloqueado_hasta });
  }
  if (verificacionesEnCurso >= 4) return response.status(503).json({ error: "El servicio está ocupado. Inténtalo en unos momentos." });
  let valida: boolean;
  verificacionesEnCurso++;
  try { valida = await claveCorrecta(clave, enlace.hash_contrasena); }
  finally { verificacionesEnCurso--; }
  const { data: permiso, error } = await supabaseAdmin.rpc("reservar_descarga", {
    p_hash_token: response.locals.hashToken, p_hash_contrasena: enlace.hash_contrasena, p_clave_valida: valida,
  });
  if (error || !permiso) {
    if (error?.code === "PGRST202" || error?.code === "42883") {
      console.error("Descargas: falta la función reservar_descarga. Aplicar migración 202611150001_public_downloads.sql.");
    } else {
      console.error("Descargas: falló reservar_descarga.", /^[A-Z0-9]{5,10}$/.test(error?.code ?? "") ? error?.code : "sin código");
    }
    return response.status(503).json({ error: "No se pudo autorizar la descarga. Inténtalo más tarde." });
  }
  if (permiso.estado === "clave_incorrecta") return response.status(401).json({ error: "Contraseña incorrecta. Inténtalo de nuevo.", intentosRestantes: permiso.intentosRestantes });
  if (permiso.estado === "bloqueado") return response.status(429).json({ error: "Acceso bloqueado temporalmente por intentos fallidos.", reintentarEn: permiso.reintentarEn });
  if (permiso.estado === "ocupado") return response.status(409).json({ error: "Hay descargas en curso. Inténtalo de nuevo en unos momentos." });
  if (permiso.estado === "configuracion_cambiada") return response.status(409).json({ error: "La configuración cambió. Recarga la página y vuelve a intentarlo." });
  if (permiso.estado !== "autorizado") return response.status(404).json({ error: mensajeNoDisponible });

  let finalizada = false;
  async function finalizar(exito: boolean) {
    if (finalizada) return;
    finalizada = true;
    const { error: errorFinalizar } = await supabaseAdmin.rpc("finalizar_descarga", { p_reserva_id: permiso.reservaId, p_exito: exito });
    // Sin credenciales ni identificadores privados en los logs.
    if (errorFinalizar) console.error("No se pudo cerrar una reserva de descarga. Requiere revisión.");
  }
  response.once("close", () => { void finalizar(response.writableFinished); });
  response.once("finish", () => { void finalizar(true); });
  try {
    // Los archivos tienen un máximo de 10 MB, por lo que se pueden enviar como un buffer.
    const { data, error: errorStorage } = await supabaseAdmin.storage.from("safelink-files").download(permiso.ruta);
    if (errorStorage || !data) throw new Error("Storage no disponible");
    const contenido = Buffer.from(await data.arrayBuffer());
    if (contenido.length !== Number(permiso.tamanoBytes)) throw new Error("Archivo incompleto");
    if (response.destroyed) { await finalizar(false); return; }
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(permiso.nombre).replace(/['()*]/g, (caracter) => `%${caracter.charCodeAt(0).toString(16)}`)}`);
    response.send(contenido);
  } catch {
    // Cerrar la reserva como fallida antes de enviar el JSON de error.
    await finalizar(false);
    if (!response.destroyed && !response.headersSent) response.status(503).json({ error: "No se pudo descargar el archivo. Vuelve a intentarlo." });
  }
});

descargasRouter.use(((error, _request, response, _next) => {
  void error;
  if (!response.headersSent) response.status(503).json({ error: "No se pudo procesar la descarga. Inténtalo más tarde." });
}) as import("express").ErrorRequestHandler);
