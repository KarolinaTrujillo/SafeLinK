"use client";

import { useEffect, useState, type FormEvent } from "react";
import { consultarDescarga, descargarArchivo, ErrorDescarga, type ArchivoDescarga } from "@/lib/api";
import styles from "@/app/descargar/descarga.module.css";

function Icono({ tipo }: { tipo: "archivo" | "candado" | "descargar" | "ojo" | "aviso" }) {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tipo === "archivo" && <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>}
    {tipo === "candado" && <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>}
    {tipo === "descargar" && <><path d="M12 3v12m-4-4 4 4 4-4M5 15v5h14v-5" /></>}
    {tipo === "ojo" && <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
    {tipo === "aviso" && <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="M12 8v5m0 3h.01" /></>}
  </svg>;
}

export default function DescargaVista({ token }: { token: string }) {
  const [archivo, setArchivo] = useState<ArchivoDescarga | null>(null);
  const [cargando, setCargando] = useState(true);
  const [contrasena, setContrasena] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [noDisponible, setNoDisponible] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);

  useEffect(() => {
    const control = new AbortController();
    async function cargar() {
      setCargando(true); setError(""); setMensaje(""); setArchivo(null);
      setContrasena(""); setMostrar(false); setNoDisponible(false); setBloqueado(false);
      try {
        const datos = await consultarDescarga(token, control.signal);
        if (!control.signal.aborted) {
          setArchivo(datos);
          setBloqueado(Boolean(datos.bloqueadoHasta && Date.parse(datos.bloqueadoHasta) > Date.now()));
        }
      } catch (fallo) {
        if (!control.signal.aborted) setError(fallo instanceof Error ? fallo.message : "No se pudo cargar el enlace.");
      } finally { if (!control.signal.aborted) setCargando(false); }
    }
    void cargar();
    return () => control.abort();
  }, [token]);

  async function descargar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!archivo || descargando || bloqueado || noDisponible) return;
    setDescargando(true); setError(""); setMensaje("");
    try {
      const contenido = await descargarArchivo(token, archivo.protegido ? contrasena : "");
      const url = URL.createObjectURL(contenido);
      const enlace = document.createElement("a");
      enlace.href = url; enlace.download = archivo.nombre;
      document.body.appendChild(enlace); enlace.click(); enlace.remove();
      // Dar tiempo al navegador para procesar la descarga antes de liberar el blob.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setContrasena("");
      setMensaje("Archivo recibido. Revisa las descargas de tu navegador.");
      setArchivo((actual) => actual ? { ...actual, intentosRestantes: 5 } : actual);
    } catch (fallo) {
      setError(fallo instanceof Error ? fallo.message : "No se pudo descargar el archivo.");
      if (fallo instanceof ErrorDescarga) {
        if (fallo.estado === 404) setNoDisponible(true);
        if (fallo.estado === 429) {
          setBloqueado(true);
          setArchivo((actual) => actual ? { ...actual, bloqueadoHasta: fallo.reintentarEn ?? null } : actual);
        }
        const restantes = fallo.intentosRestantes;
        if (restantes !== undefined) setArchivo((actual) => actual ? { ...actual, intentosRestantes: restantes } : actual);
      }
    } finally { setDescargando(false); }
  }

  const extension = archivo?.nombre.split(".").pop()?.toUpperCase() ?? "";
  const deshabilitado = descargando || bloqueado || noDisponible;

  return <main className={styles.page}>
    <section className={styles.content} aria-labelledby="titulo-descarga">
      <h1 id="titulo-descarga">Portal Seguro SafeLinK — Descarga protegida<br className={styles.desktopBreak} /> de archivo</h1>
      <div className={styles.card}>
        {cargando ? <p className={styles.status} role="status">Comprobando disponibilidad del archivo…</p> : !archivo ? <div className={styles.unavailable}>
          <span className={styles.fileIcon}><Icono tipo="aviso" /></span>
          <h2>No se pudo abrir el enlace</h2>
          <p role="alert">{error}</p>
          <button className={styles.download} type="button" onClick={() => window.location.reload()}>Volver a intentar</button>
        </div> : <>
          <div className={styles.file}>
            <span className={styles.fileIcon}><Icono tipo="archivo" /></span>
            <div className={styles.fileDetails}>
              <span className={styles.fileType}>DOCUMENTO {extension}</span>
              <h2>{archivo.nombre}</h2>
              <p>Tamaño: {(archivo.tamanoBytes / 1_000_000).toLocaleString("es-MX", { maximumFractionDigits: 2 })} MB</p>
            </div>
          </div>
          <form onSubmit={descargar}>
            <label className={styles.label} htmlFor={archivo.protegido ? "clave-descarga" : undefined}>
              <Icono tipo="candado" /> {archivo.protegido ? "Este enlace requiere contraseña para su descarga" : "Tu archivo está listo para descargar"}
            </label>
            <p className={styles.description}>{archivo.protegido ? "Ingresa la clave proporcionada por el emisor para autorizar la transferencia del archivo." : "Presiona el botón para descargar el archivo compartido de forma segura."}</p>
            <div className={styles.formRow}>
              {archivo.protegido && <div className={styles.password}>
                <span className={styles.keyIcon} aria-hidden="true">⚿</span>
                <input id="clave-descarga" type={mostrar ? "text" : "password"} value={contrasena} onChange={(event) => setContrasena(event.target.value)} required maxLength={128} autoComplete="off" placeholder="Ingresa la clave de acceso…" disabled={deshabilitado} aria-describedby="aviso-intentos" />
                <button type="button" className={styles.eye} aria-label={mostrar ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={mostrar} onClick={() => setMostrar(!mostrar)} disabled={deshabilitado}><Icono tipo="ojo" /></button>
              </div>}
              <button className={styles.download} type="submit" disabled={deshabilitado}><Icono tipo="descargar" /> {descargando ? "Descargando…" : "Descargar archivo"}</button>
            </div>
            {archivo.protegido && <div className={styles.notice} id="aviso-intentos">
              <Icono tipo="aviso" /><p>Múltiples intentos fallidos provocarán un bloqueo temporal por seguridad.</p>
              <span className={styles.attempts}>{bloqueado ? "Bloqueo temporal" : `Intentos restantes: ${archivo.intentosRestantes} de 5`}</span>
            </div>}
            {bloqueado && <p className={styles.error} role="alert">Acceso bloqueado temporalmente.{archivo.bloqueadoHasta && <> Vuelve a intentar después de las {new Date(archivo.bloqueadoHasta).toLocaleTimeString("es-MX")}.</>} <button type="button" className={styles.retry} onClick={() => window.location.reload()}>Comprobar de nuevo</button></p>}
            {error && <p className={styles.error} role="alert">{error}</p>}
            {mensaje && <p className={styles.success} role="status">{mensaje}</p>}
          </form>
        </>}
      </div>
    </section>
  </main>;
}
