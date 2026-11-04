import { Router } from "express";
import { createHash, randomBytes, randomInt, scrypt } from "node:crypto";
import { promisify } from "node:util";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

export const enlacesRouter = Router();
const derivarClave = promisify(scrypt);
const campos = "id, archivo_id, vence_en, maximo_descargas, descargas_realizadas, revocado_en, creado_en, actualizado_en, hash_contrasena";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const quinceDias = 15 * 24 * 60 * 60 * 1000;

// Solo se devuelve si tiene contraseña, nunca su hash.
function datosPublicos(enlace: Record<string, unknown>) {
  const { hash_contrasena, ...datos } = enlace;
  return { ...datos, protegido: Boolean(hash_contrasena) };
}

function generarContrasena() {
  const grupos = ["ABCDEFGHJKLMNPQRSTUVWXYZ", "abcdefghijkmnopqrstuvwxyz", "23456789", "!@#$%&*?"];
  const caracteres = grupos.join("");
  const clave = grupos.map((grupo) => grupo[randomInt(grupo.length)]);
  while (clave.length < 12) clave.push(caracteres[randomInt(caracteres.length)]);
  for (let i = clave.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [clave[i], clave[j]] = [clave[j], clave[i]];
  }
  return clave.join("");
}

async function hashContrasena(clave: string) {
  const sal = randomBytes(16).toString("hex");
  const hash = await derivarClave(clave, sal, 64) as Buffer;
  return `scrypt:${sal}:${hash.toString("hex")}`;
}

function validarConfiguracion(body: Record<string, unknown>, creado: string, usadas = 0) {
  const vence = typeof body.venceEn === "string" ? Date.parse(body.venceEn) : NaN;
  if (!Number.isFinite(vence) || vence <= Date.now() || vence > Date.parse(creado) + quinceDias) {
    return "El vencimiento debe ser futuro y no superar 15 días desde la creación del enlace.";
  }
  if (typeof body.maximoDescargas !== "number" || !Number.isInteger(body.maximoDescargas) || body.maximoDescargas < 1 || body.maximoDescargas > 20 || body.maximoDescargas < usadas) {
    return "El límite debe ser de 1 a 20 y no puede ser menor que las descargas realizadas.";
  }
  if (typeof body.protegido !== "boolean") return "Indica si el enlace tendrá contraseña.";
  if (body.contrasena !== undefined && (typeof body.contrasena !== "string" || body.contrasena.length < 12 || body.contrasena.length > 128 || !/[A-Z]/.test(body.contrasena) || !/[a-z]/.test(body.contrasena) || !/[0-9]/.test(body.contrasena) || !/[^a-zA-Z0-9]/.test(body.contrasena))) {
    return "Genera una contraseña de al menos 12 caracteres con mayúsculas, minúsculas, números y símbolos.";
  }
  return null;
}

enlacesRouter.use(requireAuth);
enlacesRouter.use((_request, response, next) => {
  response.setHeader("Cache-Control", "no-store");
  next();
});

enlacesRouter.post("/contrasena", (_request, response) => {
  response.json({ contrasena: generarContrasena() });
});

enlacesRouter.get("/archivo/:archivoId", async (request, response) => {
  const id = String(request.params.archivoId);
  if (!uuid.test(id)) return response.status(400).json({ error: "Archivo inválido." });
  const { data: archivo, error } = await supabaseAdmin.from("archivos").select("id").eq("id", id).eq("propietario_id", response.locals.userId).maybeSingle();
  if (error) return response.status(503).json({ error: "No se pudo consultar el archivo." });
  if (!archivo) return response.status(404).json({ error: "Archivo no disponible." });
  const { data, error: errorEnlaces } = await supabaseAdmin.from("enlaces_compartidos").select(campos).eq("archivo_id", id).order("creado_en", { ascending: false });
  if (errorEnlaces) return response.status(503).json({ error: "No se pudieron consultar los enlaces." });
  return response.json({ enlaces: (data ?? []).map(datosPublicos) });
});

enlacesRouter.post("/", async (request, response) => {
  const body = request.body;
  if (!body || typeof body !== "object" || !uuid.test(body.archivoId ?? "")) return response.status(400).json({ error: "Archivo inválido." });
  const creado = new Date().toISOString();
  const problema = validarConfiguracion(body, creado);
  if (problema) return response.status(400).json({ error: problema });
  const { data: archivo, error } = await supabaseAdmin.from("archivos").select("id, estado_limpieza").eq("id", body.archivoId).eq("propietario_id", response.locals.userId).maybeSingle();
  if (error) return response.status(503).json({ error: "No se pudo consultar el archivo." });
  if (!archivo || archivo.estado_limpieza !== "activo") return response.status(404).json({ error: "Archivo no disponible para compartir." });
  const token = randomBytes(32).toString("base64url");
  const contrasena = body.protegido ? (body.contrasena || generarContrasena()) : null;
  const hash = contrasena ? await hashContrasena(contrasena) : null;
  const { data: enlace, error: errorGuardar } = await supabaseAdmin.from("enlaces_compartidos").insert({
    archivo_id: archivo.id, hash_token: createHash("sha256").update(token).digest("hex"),
    vence_en: body.venceEn, maximo_descargas: body.maximoDescargas, hash_contrasena: hash,
    creado_en: creado, actualizado_en: creado,
  }).select(campos).single();
  if (errorGuardar || !enlace) return response.status(503).json({ error: "No se pudo guardar el enlace." });
  const base = process.env.FRONTEND_URL ?? "http://localhost:3000";
  return response.status(201).json({ enlace: datosPublicos(enlace), url: `${base.replace(/\/$/, "")}/descargar/${token}`, contrasena });
});

// Obtener y comprobar el propietario antes de modificar o revocar.
enlacesRouter.use("/:id", async (request, response, next) => {
  const id = String(request.params.id);
  if (!uuid.test(id)) return response.status(400).json({ error: "Enlace inválido." });
  const { data: enlace, error } = await supabaseAdmin.from("enlaces_compartidos").select(campos).eq("id", id).maybeSingle();
  if (error) return response.status(503).json({ error: "No se pudo consultar el enlace." });
  if (!enlace) return response.status(404).json({ error: "Enlace no disponible." });
  const { data: archivo, error: errorArchivo } = await supabaseAdmin.from("archivos").select("id, estado_limpieza").eq("id", enlace.archivo_id).eq("propietario_id", response.locals.userId).maybeSingle();
  if (errorArchivo) return response.status(503).json({ error: "No se pudo consultar el archivo." });
  if (!archivo) return response.status(404).json({ error: "Enlace no disponible." });
  response.locals.enlace = enlace;
  response.locals.archivo = archivo;
  next();
});

enlacesRouter.patch("/:id", async (request, response) => {
  const enlace = response.locals.enlace;
  const body = request.body;
  if (!body || typeof body !== "object") return response.status(400).json({ error: "Configuración inválida." });
  if (enlace.revocado_en || response.locals.archivo.estado_limpieza !== "activo") return response.status(409).json({ error: "El enlace ya no se puede editar." });
  if (body.actualizadoEn !== enlace.actualizado_en) return response.status(409).json({ error: "La configuración cambió. Recarga la página." });
  const problema = validarConfiguracion(body, enlace.creado_en, enlace.descargas_realizadas);
  if (problema) return response.status(400).json({ error: problema });
  let contrasena: string | null = null;
  let hash = body.protegido ? enlace.hash_contrasena : null;
  if (body.protegido && (body.contrasena || !hash)) {
    const clave: string = body.contrasena || generarContrasena();
    contrasena = clave;
    hash = await hashContrasena(clave);
  }
  const { data, error } = await supabaseAdmin.from("enlaces_compartidos").update({
    vence_en: body.venceEn, maximo_descargas: body.maximoDescargas, hash_contrasena: hash,
    actualizado_en: new Date().toISOString(),
  }).eq("id", enlace.id).eq("actualizado_en", enlace.actualizado_en).is("revocado_en", null).select(campos).maybeSingle();
  if (error || !data) return response.status(409).json({ error: "No se pudo actualizar. Recarga la configuración e inténtalo de nuevo." });
  return response.json({ enlace: datosPublicos(data), contrasena });
});

enlacesRouter.post("/:id/revocar", async (_request, response) => {
  const enlace = response.locals.enlace;
  if (enlace.revocado_en) return response.json({ enlace: datosPublicos(enlace) });
  const ahora = new Date().toISOString();
  const { data, error } = await supabaseAdmin.from("enlaces_compartidos").update({ revocado_en: ahora, actualizado_en: ahora }).eq("id", enlace.id).is("revocado_en", null).select(campos).maybeSingle();
  if (error || !data) return response.status(409).json({ error: "No se pudo revocar. Recarga la página." });
  return response.json({ enlace: datosPublicos(data) });
});

// Los errores internos no exponen claves, hashes ni detalles de Supabase.
enlacesRouter.use(((error, _request, response, _next) => {
  void error;
  response.status(503).json({ error: "No fue posible procesar el enlace. Inténtalo de nuevo." });
}) as import("express").ErrorRequestHandler);
