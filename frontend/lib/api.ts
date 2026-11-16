const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type ArchivoDescarga = {
  nombre: string;
  tipoMime: string;
  tamanoBytes: number;
  protegido: boolean;
  intentosRestantes: number;
  bloqueadoHasta: string | null;
};

export class ErrorDescarga extends Error {
  constructor(message: string, public estado: number, public intentosRestantes?: number, public reintentarEn?: string) {
    super(message);
  }
}

async function errorDescarga(response: Response) {
  const datos = await response.json().catch(() => ({}));
  return new ErrorDescarga(datos.error || "No se pudo conectar con el servicio de descargas.", response.status, datos.intentosRestantes, datos.reintentarEn);
}

export async function consultarDescarga(token: string, signal?: AbortSignal): Promise<ArchivoDescarga> {
  const response = await fetch(`${apiUrl}/api/descargas/${encodeURIComponent(token)}`, { cache: "no-store", referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw await errorDescarga(response);
  return response.json();
}

export async function descargarArchivo(token: string, contrasena: string): Promise<Blob> {
  const response = await fetch(`${apiUrl}/api/descargas/${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contrasena }),
    cache: "no-store", referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw await errorDescarga(response);
  return response.blob();
}

export type RolUsuario = "usuario" | "administrador";

export type PerfilAutenticado = {
  userId: string;
  rol: RolUsuario;
};

export type ArchivoUsuario = {
  id: string;
  nombre: string;
  tipoMime: string;
  tamanoBytes: number;
  creadoEn: string;
  estadoEnlace: string;
};

async function mensajeError(response: Response, mensajePredeterminado: string) {
  try {
    const resultado = (await response.json()) as { error?: string };
    return resultado.error || mensajePredeterminado;
  } catch {
    return mensajePredeterminado;
  }
}

export async function obtenerPerfilEnBackend(
  accessToken: string,
): Promise<PerfilAutenticado | null> {
  try {
    const response = await fetch(`${apiUrl}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const perfil = (await response.json()) as PerfilAutenticado;

    if (
      typeof perfil.userId !== "string" ||
      (perfil.rol !== "usuario" && perfil.rol !== "administrador")
    ) {
      return null;
    }

    return perfil;
  } catch {
    return null;
  }
}

export async function validarSesionEnBackend(accessToken: string) {
  return (await obtenerPerfilEnBackend(accessToken)) !== null;
}

export async function obtenerArchivos(accessToken: string): Promise<ArchivoUsuario[]> {
  const response = await fetch(`${apiUrl}/api/archivos`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await mensajeError(response, "No se pudieron cargar tus archivos"));
  }

  const resultado = (await response.json()) as { archivos?: ArchivoUsuario[] };
  return resultado.archivos ?? [];
}

export async function subirArchivo(accessToken: string, archivo: File): Promise<{ id: string; nombre: string }> {
  const response = await fetch(`${apiUrl}/api/archivos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(archivo.name),
      "X-File-Type": archivo.type,
    },
    body: archivo,
  });

  if (!response.ok) {
    throw new Error(await mensajeError(response, "No se pudo subir el archivo"));
  }
  return response.json();
}


export type EnlaceCompartido = {
  id: string;
  archivo_id: string;
  vence_en: string;
  maximo_descargas: number;
  descargas_realizadas: number;
  revocado_en: string | null;
  creado_en: string;
  actualizado_en: string;
  protegido: boolean;
};

export type ConfiguracionEnlace = {
  archivoId: string;
  venceEn: string;
  maximoDescargas: number;
  protegido: boolean;
  contrasena?: string;
  actualizadoEn?: string;
};

export type ResultadoEnlace = { enlace: EnlaceCompartido; url?: string; contrasena?: string | null };

async function peticionEnlaces<T>(token: string, ruta: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`${apiUrl}/api/enlaces${ruta}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await mensajeError(response, "No se pudo procesar el enlace."));
  return response.json();
}

export function consultarEnlaces(token: string, archivoId: string) {
  return peticionEnlaces<{ enlaces: EnlaceCompartido[] }>(token, `/archivo/${encodeURIComponent(archivoId)}`);
}
export function generarClaveEnlace(token: string) {
  return peticionEnlaces<{ contrasena: string }>(token, "/contrasena", "POST");
}
export function guardarEnlace(token: string, configuracion: ConfiguracionEnlace, id?: string) {
  return peticionEnlaces<ResultadoEnlace>(token, id ? `/${encodeURIComponent(id)}` : "", id ? "PATCH" : "POST", configuracion);
}
export function revocarEnlace(token: string, id: string) {
  return peticionEnlaces<ResultadoEnlace>(token, `/${encodeURIComponent(id)}/revocar`, "POST");
}
