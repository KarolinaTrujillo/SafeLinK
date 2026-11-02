"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { obtenerPerfilEnBackend, subirArchivo, type RolUsuario } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import styles from "@/app/subir-archivo/subirArchivo.module.css";

const limiteArchivo = 10_000_000;
const tiposPermitidos = [".pdf", ".jpg", ".jpeg", ".png", ".docx"];

export default function SubirArchivoVista() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [rol, setRol] = useState<RolUsuario>("usuario");
  const [archivo, setArchivo] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(true);
  const [subiendo, setSubiendo] = useState(false);

  useEffect(() => {
    let activo = true;

    async function revisarSesion() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/iniciar-sesion");
        return;
      }
      if (activo) {
        setToken(data.session.access_token);
        const perfil = await obtenerPerfilEnBackend(data.session.access_token);
        if (activo && perfil) setRol(perfil.rol);
      }
      if (activo) setCargando(false);
    }

    void revisarSesion();
    return () => { activo = false; };
  }, [router]);

  function seleccionarArchivo(seleccionado: File | null) {
    setError("");
    setArchivo(null);
    if (!seleccionado) return;

    const extension = `.${seleccionado.name.split(".").pop()?.toLowerCase()}`;
    if (!tiposPermitidos.includes(extension)) {
      setError("Elige un archivo PDF, JPG, PNG o DOCX.");
      return;
    }
    if (seleccionado.size === 0 || seleccionado.size > limiteArchivo) {
      setError("El archivo debe pesar entre 1 byte y 10 MB.");
      return;
    }
    setArchivo(seleccionado);
  }

  async function enviarArchivo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!archivo || !token) return;

    setSubiendo(true);
    setError("");
    try {
      await subirArchivo(token, archivo);
      router.push("/mis-archivos");
    } catch (errorCarga) {
      setError(errorCarga instanceof Error ? errorCarga.message : "No se pudo subir el archivo.");
      setSubiendo(false);
    }
  }

  if (cargando) {
    return <main className={styles.loading}><p>Comprobando sesión…</p></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.topBar}>
        <Link className={styles.brand} href="/mis-archivos"><span className={styles.brandIcon}>S</span>SafeLinK</Link>
        <nav className={styles.navigation} aria-label="Navegación principal">
          <Link href="/mis-archivos">Mis archivos</Link>
          <span className={styles.activeNav}>Subir Archivo</span>
          <span className={styles.disabledNav}>Compartir Enlace</span>
          {rol === "administrador" && <span className={styles.disabledNav}>Administración <small>ADMIN</small></span>}
        </nav>
      </header>

      <section className={styles.card}>
        <div className={styles.heading}>
          <p className={styles.eyebrow}>ALMACENAMIENTO SEGURO</p>
          <h1>Subir archivo</h1>
          <p>Selecciona un documento para guardarlo de forma privada.</p>
        </div>

        <form onSubmit={enviarArchivo}>
          <label className={styles.dropZone} htmlFor="archivo">
            <span className={styles.uploadIcon} aria-hidden="true">↑</span>
            <strong>{archivo ? archivo.name : "Selecciona un archivo"}</strong>
            <span>{archivo ? `${(archivo.size / 1_000_000).toFixed(2)} MB` : "PDF, JPG, PNG o DOCX · máximo 10 MB"}</span>
            <input
              id="archivo"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.docx"
              onChange={(event) => seleccionarArchivo(event.target.files?.[0] ?? null)}
            />
          </label>

          <p className={styles.privacyNote}>El archivo se guarda en un bucket privado y solo tu cuenta administra sus metadatos.</p>
          {error && <p className={styles.error} role="alert">{error}</p>}

          <div className={styles.actions}>
            <Link href="/mis-archivos">Cancelar</Link>
            <button type="submit" disabled={!archivo || subiendo}>
              {subiendo ? "Subiendo…" : "Subir archivo"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}
