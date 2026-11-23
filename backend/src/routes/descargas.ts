import { Router } from "express";
import { createHash, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { supabaseAdmin } from "../config/supabase.js";
import { crearControlReserva } from "../reservasDescarga.js";

export const descargasRouter = Router();
const derivarClave = promisify(scrypt);
let verificacionesEnCurso = 0;
const mensajeNoDisponible = "El enlace no está disponible. Solicita uno nuevo a quien te lo compartió.";

async function registrarRechazo(response: import("express").Response, id: string | null, motivo: string) {
  const { error } = await supabaseAdmin.rpc("registrar_rechazo_descarga", { p_enlace_id: id, p_motivo: motivo });
  if (error) {
    response.status(503).json({ error: "No se pudo procesar el intento de descarga. Inténtalo más tarde." });
    return false;
  }
  return true;
}

async function claveCorrecta(clave: string, guardada: string | null) {
  if (!guardada) return true;
  const [algoritmo, sal, hash] = guardada.split(":");
  if (algoritmo !== "scrypt" || !sal || !hash || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const comprobacion = await derivarClave(clave, sal, 64) as Buffer;
  return timingSafeEqual(Buffer.from(hash, "hex"), comprobacion);
}

descargasRouter.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Referrer-Policy", "no-referrer");
  next();
});

descargasRouter.use("/:token", async (request, response, next) => {
  const token = String(request.params.token);
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    if (request.method === "POST" && !await registrarRechazo(response, null, "Enlace no disponible")) return;
    return response.status(404).json({ error: mensajeNoDisponible });
  }
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: enlace, error } = await supabaseAdmin.from("enlaces_compartidos")
    .select("id, archivo_id, hash_contrasena, vence_en, maximo_descargas, descargas_realizadas, revocado_en, es_actual, bloqueado_hasta, intentos_fallidos")
    .eq("hash_token", hash).maybeSingle();
  if (error) return response.status(503).json({ error: "No se pudo consultar el enlace. Inténtalo más tarde." });
  if (!enlace || !enlace.es_actual || enlace.revocado_en || Date.parse(enlace.vence_en) <= Date.now() || enlace.descargas_realizadas >= enlace.maximo_descargas) {
    const motivo = !enlace || !enlace.es_actual ? "Enlace no disponible" : enlace.revocado_en ? "Enlace revocado" : Date.parse(enlace.vence_en) <= Date.now() ? "Enlace vencido" : "Límite de descargas alcanzado";
    if (request.method === "POST" && !await registrarRechazo(response, enlace?.id ?? null, motivo)) return;
    return response.status(404).json({ error: mensajeNoDisponible });
  }
  const { data: archivo, error: errorArchivo } = await supabaseAdmin.from("archivos")
    .select("nombre_original, tipo_mime, tamano_bytes, estado_limpieza").eq("id", enlace.archivo_id).maybeSingle();
  if (errorArchivo) return response.status(503).json({ error: "No se pudo consultar el archivo. Inténtalo más tarde." });
  if (!archivo || archivo.estado_limpieza !== "activo") {
    if (request.method === "POST" && !await registrarRechazo(response, enlace.id, "Archivo no disponible")) return;
    return response.status(404).json({ error: mensajeNoDisponible });
  }
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
  if (typeof clave !== "string" || clave.length > 128) {
    if (!await registrarRechazo(response, response.locals.enlace.id, "Contraseña inválida")) return;
    return response.status(400).json({ error: "La contraseña no es válida." });
  }
  const enlace = response.locals.enlace;
  if (enlace.bloqueado_hasta && Date.parse(enlace.bloqueado_hasta) > Date.now()) {
    if (!await registrarRechazo(response, enlace.id, "Bloqueo temporal")) return;
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

  let envioIniciado = false;
  const storageAbort = new AbortController();
  const control = crearControlReserva({
    reservaId: permiso.reservaId,
    rpc: (nombre, args, signal) => supabaseAdmin.rpc(nombre, args).abortSignal(signal),
    detener: () => { storageAbort.abort(); if (!response.destroyed) response.destroy(); },
  });
  response.once("close", () => {
    storageAbort.abort();
    void control.cerrar(response.writableFinished ? "exitoso" : envioIniciado ? "no_confirmado" : "fallido");
  });
  response.once("finish", () => { void control.cerrar("exitoso"); });
  if (!await control.iniciar()) {
    await control.cerrar("fallido");
    if (!response.destroyed) response.status(503).json({ error: "No se pudo mantener la reserva de descarga. Inténtalo más tarde." });
    return;
  }
  try {
    const { data, error: errorStorage } = await supabaseAdmin.storage.from("safelink-files").download(permiso.ruta, {}, { signal: storageAbort.signal });
    if (errorStorage || !data) throw new Error("Storage no disponible");
    const contenido = Buffer.from(await data.arrayBuffer());
    if (contenido.length !== Number(permiso.tamanoBytes)) throw new Error("Archivo incompleto");
    if (response.destroyed || !control.vigente()) { await control.cerrar("fallido"); return; }
    // Revalidar después de Storage, antes de entregar un solo byte al navegador.
    if (!await control.renovar() || response.destroyed) { await control.cerrar("fallido"); return; }
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(permiso.nombre).replace(/['()*]/g, (caracter) => `%${caracter.charCodeAt(0).toString(16)}`)}`);
    envioIniciado = true;
    response.send(contenido);
  } catch {
    await control.cerrar(envioIniciado ? "no_confirmado" : "fallido");
    if (!response.destroyed && !response.headersSent) response.status(503).json({ error: "No se pudo descargar el archivo. Vuelve a intentarlo." });
  }
});

descargasRouter.use(((error, _request, response, _next) => {
  void error;
  if (!response.headersSent) response.status(503).json({ error: "No se pudo procesar la descarga. Inténtalo más tarde." });
}) as import("express").ErrorRequestHandler);
