import cors from "cors";
import express from "express";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { supabaseAdmin } from "./config/supabase.js";
import { requireAuth } from "./middleware/auth.js";

export const app = express();

const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:3000";
const limiteArchivo = 10_000_000;
const tiposPermitidos: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

app.use(helmet());
app.use(cors({ origin: frontendUrl }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", async (_request, response) => {
  const { error } = await supabaseAdmin
    .from("perfiles")
    .select("id")
    .limit(1);

  if (error) {
    return response.status(503).json({ status: "error" });
  }

  return response.json({ status: "ok" });
});

app.get("/api/auth/me", requireAuth, async (_request, response) => {
  const userId = response.locals.userId as string;
  const { data, error } = await supabaseAdmin
    .from("perfiles")
    .select("rol")
    .eq("id", userId)
    .single();

  if (error || !data) {
    return response.status(503).json({ error: "No se pudo consultar el perfil" });
  }

  return response.json({ userId, rol: data.rol });
});

app.get("/api/archivos", requireAuth, async (_request, response) => {
  const userId = response.locals.userId as string;
  const { data: archivos, error } = await supabaseAdmin
    .from("archivos")
    .select("id, nombre_original, tipo_mime, tamano_bytes, creado_en")
    .eq("propietario_id", userId)
    .order("creado_en", { ascending: false });

  if (error) {
    return response.status(503).json({ error: "No se pudieron consultar tus archivos" });
  }

  const ids = (archivos ?? []).map((archivo) => archivo.id);
  const { data: enlaces, error: errorEnlaces } = ids.length
    ? await supabaseAdmin
        .from("enlaces_compartidos")
        .select("archivo_id, vence_en, maximo_descargas, descargas_realizadas, revocado_en, creado_en")
        .in("archivo_id", ids)
        .order("creado_en", { ascending: false })
    : { data: [], error: null };

  if (errorEnlaces) {
    return response.status(503).json({ error: "No se pudieron consultar tus archivos" });
  }

  const respuesta = (archivos ?? []).map((archivo) => {
    const enlace = (enlaces ?? []).find((item) => item.archivo_id === archivo.id);
    let estadoEnlace = "Sin enlace";

    if (enlace?.revocado_en) estadoEnlace = "Revocado";
    else if (enlace && new Date(enlace.vence_en).getTime() <= Date.now()) estadoEnlace = "Vencido";
    else if (enlace && enlace.descargas_realizadas >= enlace.maximo_descargas) estadoEnlace = "Límite alcanzado";
    else if (enlace) estadoEnlace = "Activo";

    return {
      id: archivo.id,
      nombre: archivo.nombre_original,
      tipoMime: archivo.tipo_mime,
      tamanoBytes: Number(archivo.tamano_bytes),
      creadoEn: archivo.creado_en,
      estadoEnlace,
    };
  });

  return response.json({ archivos: respuesta });
});

app.post(
  "/api/archivos",
  requireAuth,
  express.raw({ type: "application/octet-stream", limit: limiteArchivo }),
  async (request, response) => {
    const userId = response.locals.userId as string;
    const contenido = request.body;
    const nombreRecibido = request.header("X-File-Name");
    const tipoMime = request.header("X-File-Type");

    if (!Buffer.isBuffer(contenido) || !nombreRecibido || !tipoMime) {
      return response.status(400).json({ error: "Selecciona un archivo válido" });
    }

    let nombreOriginal: string;
    try {
      nombreOriginal = decodeURIComponent(nombreRecibido);
    } catch {
      return response.status(400).json({ error: "El nombre del archivo no es válido" });
    }

    nombreOriginal = path.basename(nombreOriginal.replace(/\\/g, "/"))
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim();
    const extension = path.extname(nombreOriginal).toLowerCase();

    if (!nombreOriginal || nombreOriginal.length > 255 || tiposPermitidos[extension] !== tipoMime) {
      return response.status(415).json({ error: "Solo se permiten archivos PDF, JPG, PNG o DOCX válidos" });
    }

    if (contenido.length === 0 || contenido.length > limiteArchivo) {
      return response.status(413).json({ error: "El archivo debe pesar entre 1 byte y 10 MB" });
    }

    const firmaValida =
      (tipoMime === "application/pdf" && contenido.subarray(0, 5).toString() === "%PDF-") ||
      (tipoMime === "image/png" && contenido.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
      (tipoMime === "image/jpeg" && contenido[0] === 0xff && contenido[1] === 0xd8 && contenido[2] === 0xff) ||
      (tipoMime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" &&
        contenido.subarray(0, 2).toString() === "PK" &&
        contenido.includes(Buffer.from("[Content_Types].xml")) &&
        contenido.includes(Buffer.from("word/document.xml")));

    if (!firmaValida) {
      return response.status(415).json({ error: "El contenido no coincide con el tipo de archivo permitido" });
    }

    const archivoId = randomUUID();
    const ruta = `${userId}/${archivoId}${extension}`;
    const { data: registro, error: errorRegistro } = await supabaseAdmin.rpc("registrar_archivo", {
      p_id: archivoId,
      p_propietario_id: userId,
      p_nombre_original: nombreOriginal,
      p_tipo_mime: tipoMime,
      p_tamano_bytes: contenido.length,
      p_ruta_almacenamiento: ruta,
    });

    if (errorRegistro || !registro) {
      if (errorRegistro?.message.includes("CUPO_ARCHIVOS")) {
        return response.status(409).json({ error: "Ya alcanzaste el límite de 10 archivos" });
      }
      if (errorRegistro?.message.includes("CUPO_ALMACENAMIENTO")) {
        return response.status(409).json({ error: "El archivo supera el almacenamiento disponible de tu cuenta" });
      }
      return response.status(503).json({ error: "No se pudo preparar la carga del archivo" });
    }

    const { error: errorStorage } = await supabaseAdmin.storage
      .from("safelink-files")
      .upload(ruta, contenido, { contentType: tipoMime, upsert: false });

    if (errorStorage) {
      await supabaseAdmin.from("archivos").delete().eq("id", archivoId).eq("propietario_id", userId);
      return response.status(503).json({ error: "No se pudo guardar el archivo; inténtalo de nuevo" });
    }

    return response.status(201).json({ id: archivoId, nombre: nombreOriginal });
  },
);
