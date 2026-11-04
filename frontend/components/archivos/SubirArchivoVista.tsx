"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { obtenerArchivos, obtenerPerfilEnBackend, subirArchivo, type RolUsuario } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import Topbar from "@/components/layout/Topbar";
import styles from "@/app/subir-archivo/subirArchivo.module.css";

const limiteArchivo = 10_000_000;
const tiposPermitidos = [".pdf", ".jpg", ".jpeg", ".png", ".docx"];

export default function SubirArchivoVista() {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<RolUsuario>("usuario");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);
  const [arrastrando, setArrastrando] = useState(false);
  const [cuota, setCuota] = useState<{ cantidad: number; bytes: number } | null>(null);
  const [errorCuota, setErrorCuota] = useState("");
  const [resultado, setResultado] = useState<{ texto: string; nombre: string; rechazo: boolean } | null>(null);

  useEffect(() => {
    let activo = true;
    async function cargarCuenta() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { router.replace("/iniciar-sesion"); return; }
        const perfil = await obtenerPerfilEnBackend(data.session.access_token);
        if (activo) {
          setEmail(data.session.user.email ?? "");
          if (perfil) setRol(perfil.rol);
        }
        const archivos = await obtenerArchivos(data.session.access_token);
        if (activo) setCuota({ cantidad: archivos.length, bytes: archivos.reduce((total, item) => total + item.tamanoBytes, 0) });
      } catch {
        if (activo) setErrorCuota("No se pudo consultar la capacidad de tu cuenta. Recarga la página.");
      } finally {
        if (activo) setCargando(false);
      }
    }
    void cargarCuenta();
    return () => { activo = false; };
  }, [router]);

  function seleccionarArchivo(seleccionado: File | null) {
    if (subiendo || !seleccionado) return;
    setError("");
    setArchivo(null);
    const extension = `.${seleccionado.name.split(".").pop()?.toLowerCase()}`;
    let motivo = "";
    if (!tiposPermitidos.includes(extension)) motivo = "Formato no permitido. Elige PDF, JPG, PNG o DOCX.";
    else if (seleccionado.size === 0 || seleccionado.size > limiteArchivo) motivo = "El archivo debe pesar entre 1 byte y 10 MB.";
    else if (cuota && (cuota.cantidad >= 10 || cuota.bytes + seleccionado.size > 100_000_000)) motivo = "No tienes capacidad disponible para este archivo.";
    if (motivo) {
      setError(motivo);
      setResultado({ nombre: seleccionado.name, texto: motivo, rechazo: true });
      return;
    }
    setArchivo(seleccionado);
    setResultado({ nombre: seleccionado.name, texto: "Extensión y tamaño admitidos. El contenido se validará al subirlo.", rechazo: false });
  }

  function removerArchivo() {
    setArchivo(null);
    setError("");
    if (input.current) input.current.value = "";
  }

  async function enviarArchivo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!archivo || subiendo) return;
    setSubiendo(true);
    setError("");
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) { router.replace("/iniciar-sesion"); return; }
      const guardado = await subirArchivo(data.session.access_token, archivo);
      router.push(`/compartir-enlace?archivo=${encodeURIComponent(guardado.id)}`);
    } catch (errorCarga) {
      const texto = errorCarga instanceof Error ? errorCarga.message : "No se pudo subir el archivo.";
      setError(texto);
      setResultado({ nombre: archivo.name, texto, rechazo: true });
      setSubiendo(false);
    }
  }

  if (cargando) return <main className={styles.loading}><p>Comprobando sesión…</p></main>;

  return (
    <main className={styles.page}>
      <Topbar email={email} rol={rol} />
      <section className={styles.content} aria-labelledby="titulo-carga">
        <h1 id="titulo-carga">Subir Documento</h1>
        <div className={styles.layout}>
          <form className={styles.form} onSubmit={enviarArchivo} aria-busy={subiendo}>
            <label className={`${styles.dropZone} ${arrastrando ? styles.dragging : ""}`} htmlFor="archivo"
              onDragOver={(event) => { event.preventDefault(); if (!subiendo) setArrastrando(true); }}
              onDragLeave={() => setArrastrando(false)}
              onDrop={(event) => {
                event.preventDefault(); setArrastrando(false);
                if (subiendo) return;
                if (event.dataTransfer.files.length !== 1) { setError("Selecciona un solo archivo por carga."); return; }
                seleccionarArchivo(event.dataTransfer.files[0]);
              }}>
              <span className={styles.uploadIcon} aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 18H5a4 4 0 0 1-.4-8A7 7 0 0 1 18 8a5 5 0 0 1 1 10h-2M12 20V10m-4 4 4-4 4 4" /></svg>
              </span>
              <strong>Arrastra y suelta tu archivo aquí</strong>
              <span>o <span className={styles.browse}>haz clic para explorar tu equipo</span></span>
              <span className={styles.formats}>{["PDF", "DOCX", "JPG", "PNG"].map((tipo) => <span key={tipo}>{tipo}</span>)}</span>
              <small>Formatos permitidos: PDF, JPG, PNG, DOCX. Tamaño máximo: 10 MB por archivo</small>
              <input ref={input} id="archivo" type="file" accept=".pdf,.jpg,.jpeg,.png,.docx" disabled={subiendo}
                onChange={(event) => { seleccionarArchivo(event.target.files?.[0] ?? null); event.target.value = ""; }} />
            </label>

            <div className={styles.restriction}>
              <span className={styles.shield} aria-hidden="true">♢</span>
              <div><strong>Restricción de seguridad</strong><p>Archivos ejecutables (<code>.exe</code>, <code>.bat</code>), scripts (<code>.js</code>, <code>.sh</code>) y comprimidos (<code>.zip</code>, <code>.rar</code>) no están permitidos.</p></div>
            </div>

            <section className={styles.prepared} aria-label="Archivo preparado para carga">
              <div className={styles.preparedHeading}><strong>Archivo preparado para carga <span className={styles.badge}>{archivo ? "Listo" : "Sin archivo"}</span></strong>
                {archivo && <button type="button" onClick={removerArchivo} disabled={subiendo}>Remover</button>}
              </div>
              {archivo ? <div className={styles.fileRow}>
                <span className={styles.fileIcon} aria-hidden="true">▤</span>
                <div className={styles.fileDetail}><div className={styles.fileInfo}><strong>{archivo.name}</strong><span>{(archivo.size / 1_000_000).toFixed(2)} MB / {archivo.name.split(".").pop()?.toUpperCase()}</span></div>
                  <div className={styles.readyBar} aria-hidden="true" /></div>
              </div> : <p className={styles.empty}>El archivo que selecciones aparecerá aquí.</p>}
            </section>
            {error && <p className={styles.error} role="alert">{error}</p>}
            <div className={styles.actions}>
              <Link href="/mis-archivos">Cancelar y volver a Mis archivos</Link>
              <button type="submit" disabled={!archivo || subiendo}>{subiendo ? "Subiendo…" : "Subir y configurar enlace →"}</button>
            </div>
          </form>

          <aside className={styles.sidebar}>
            <section className={styles.panel} aria-labelledby="capacidad">
              <h2 id="capacidad">Capacidad de la cuenta</h2>
              {cuota ? <>
                <div className={styles.capacity}>
                  <div className={styles.gauge}>
                    <svg width="100" height="100" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="42" fill="none" stroke="#d5e4ff" strokeWidth="8" /><circle cx="50" cy="50" r="42" fill="none" stroke="#0060c9" strokeWidth="8" strokeLinecap="round" pathLength="100" strokeDasharray={`${Math.min(cuota.cantidad * 10, 100)} 100`} transform="rotate(-90 50 50)" /></svg>
                    <span><strong>{cuota.cantidad}/10</strong><small>Ocupados</small></span>
                  </div>
                  <div><strong>{Math.max(10 - cuota.cantidad, 0)} cupos disponibles</strong><p>Límite máximo de 10 archivos por cuenta.</p></div>
                </div>
                <dl className={styles.stats}><div><dt>Archivos almacenados</dt><dd>{cuota.cantidad}</dd></div><div><dt>Espacio consumido</dt><dd>{(cuota.bytes / 1_000_000).toFixed(2)} MB / 100 MB</dd></div></dl>
              </> : <p className={styles.empty} role="status">{errorCuota || "Capacidad no disponible."}</p>}
            </section>
            <section className={styles.panel} aria-labelledby="validacion">
              <h2 id="validacion">Resultado de la validación</h2>
              <div aria-live="polite">
                {resultado ? <div className={resultado.rechazo ? styles.rejected : styles.accepted}><strong>{resultado.rechazo ? "No se pudo preparar o cargar" : "Archivo preparado"}</strong><p className={styles.resultName}>{resultado.nombre}</p><p>{resultado.texto}</p></div>
                  : <p className={styles.empty}>Selecciona un archivo para revisar su formato y tamaño.</p>}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}
