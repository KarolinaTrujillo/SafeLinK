const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";

export type EstadoAdmin = "Todos" | "Activo" | "Revocado" | "Vencido" | "Agotado" | "Sin enlace";
export type ArchivoAdmin = {
  id: string; nombre: string; tipoMime: string; tamanoBytes: number; creadoEn: string;
  propietario: string; enlaceId: string | null; descargasRealizadas: number | null;
  maximoDescargas: number | null; venceEn: string | null; estado: Exclude<EstadoAdmin, "Todos">;
  estadoLimpieza: "activo" | "pendiente_limpieza";
};
export type PanelAdmin = {
  metricas: { archivos: number; usuarios: number; descargas: number; rechazos: number };
  conteos: Record<EstadoAdmin, number>; total: number; archivos: ArchivoAdmin[];
};
export type EventoAdmin = {
  id: string; tipo_evento: string; resultado: "exitoso" | "rechazado"; motivo: string | null; creado_en: string;
};
export class ErrorAdmin extends Error {
  constructor(message: string, public estado: number) { super(message); }
}
async function peticionAdmin<T>(token: string, ruta: string, method = "GET", signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiUrl}/api/admin${ruta}`, {
    method, headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal,
  });
  if (!response.ok) {
    const datos = await response.json().catch(() => ({}));
    throw new ErrorAdmin(datos.error || "No se pudo consultar la administración.", response.status);
  }
  return response.json();
}
export function consultarPanelAdmin(token: string, busqueda: string, estado: EstadoAdmin, pagina: number, signal?: AbortSignal) {
  const params = new URLSearchParams({ busqueda, estado, pagina: String(pagina) });
  return peticionAdmin<PanelAdmin>(token, `/panel?${params}`, "GET", signal);
}
export function consultarEventosAdmin(token: string, pagina: number, signal?: AbortSignal) {
  return peticionAdmin<{ eventos: EventoAdmin[]; total: number }>(token, `/eventos?pagina=${pagina}`, "GET", signal);
}
export function revocarEnlaceAdmin(token: string, id: string) {
  return peticionAdmin<{ revocado: boolean }>(token, `/enlaces/${encodeURIComponent(id)}/revocar`, "POST");
}
