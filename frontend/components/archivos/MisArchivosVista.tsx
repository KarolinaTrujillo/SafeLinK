"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  obtenerArchivos,
  obtenerPerfilEnBackend,
  type ArchivoUsuario,
  type RolUsuario,
} from "@/lib/api";
import styles from "@/app/mis-archivos/misArchivos.module.css";

const limiteAlmacenamiento = 100_000_000;

function formatoTamano(tamanoBytes: number) {
  return `${(tamanoBytes / 1_000_000).toFixed(1)} MB`;
}

function formatoFecha(fecha: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(fecha));
}

function formatoTipo(nombre: string) {
  return nombre.split(".").pop()?.toUpperCase() ?? "ARCHIVO";
}

function claseEstado(estado: string) {
  if (estado === "Activo") return "activo";
  if (estado === "Límite alcanzado") return "agotado";
  if (estado === "Revocado") return "revocado";
  if (estado === "Vencido") return "vence";
  return "sinEnlace";
}

export default function MisArchivosVista() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<RolUsuario>("usuario");
  const [cargando, setCargando] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [cerrandoSesion, setCerrandoSesion] = useState(false);
  const [archivos, setArchivos] = useState<ArchivoUsuario[]>([]);
  const [errorLista, setErrorLista] = useState("");

  useEffect(() => {
    let activo = true;

    async function revisarSesion() {
      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace("/iniciar-sesion");
        return;
      }

      const perfil = await obtenerPerfilEnBackend(data.session.access_token);
      let archivosActuales: ArchivoUsuario[] = [];

      try {
        archivosActuales = await obtenerArchivos(data.session.access_token);
      } catch {
        if (activo) setErrorLista("No se pudo cargar tu lista de archivos. Actualiza la página para intentarlo de nuevo.");
      }

      if (activo) {
        setEmail(data.session.user.email ?? "");
        setArchivos(archivosActuales);
        if (perfil) {
          setRol(perfil.rol);
        }
        setCargando(false);
      }
    }

    void revisarSesion();

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        router.replace("/iniciar-sesion");
      }
    });

    return () => {
      activo = false;
      data.subscription.unsubscribe();
    };
  }, [router]);

  const archivosFiltrados = useMemo(
    () =>
      archivos.filter((archivo) =>
        archivo.nombre.toLowerCase().includes(busqueda.trim().toLowerCase()),
      ),
    [archivos, busqueda],
  );

  const almacenamientoUsado = archivos.reduce((total, archivo) => total + archivo.tamanoBytes, 0);
  const porcentajeArchivos = Math.min((archivos.length / 10) * 100, 100);
  const porcentajeAlmacenamiento = Math.min((almacenamientoUsado / limiteAlmacenamiento) * 100, 100);
  const enlacesActivos = archivos.filter((archivo) => archivo.estadoEnlace === "Activo").length;

  async function cerrarSesion() {
    setCerrandoSesion(true);
    await supabase.auth.signOut();
    router.replace("/iniciar-sesion");
  }

  if (cargando) {
    return (
      <main className={styles.loadingPage}>
        <p>Comprobando sesión…</p>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.topBar}>
        <Link className={styles.brand} href="/mis-archivos" aria-label="SafeLinK, mis archivos">
          <span className={styles.brandIcon} aria-hidden="true">S</span>
          <span>SafeLinK</span>
        </Link>

        <nav className={styles.navigation} aria-label="Navegación principal">
          <span className={styles.activeNav}>Mis archivos</span>
          <Link className={styles.navLink} href="/subir-archivo">
            Subir Archivo
          </Link>
          <span className={styles.disabledNav} aria-disabled="true" title="Disponible próximamente">
            Compartir Enlace
          </span>
          {rol === "administrador" && (
            <span className={styles.disabledNav} aria-disabled="true" title="Vista administrativa pendiente">
              Administración <span className={styles.adminBadge}>ADMIN</span>
            </span>
          )}
        </nav>

        <div className={styles.account}>
          <span className={styles.email} title={email}>{email}</span>
          <button
            className={styles.signOutButton}
            type="button"
            onClick={cerrarSesion}
            disabled={cerrandoSesion}
          >
            {cerrandoSesion ? "Saliendo…" : "Cerrar sesión"}
          </button>
        </div>
      </header>

      <section className={styles.content} aria-labelledby="files-title">
        <div className={styles.heading}>
          <div>
            <h1 id="files-title">Mis Archivos</h1>
            <p className={styles.subtitle}>Archivos compartidos con límites dinámicos de acceso temporal.</p>
          </div>
        </div>

        <section className={styles.metrics} aria-label="Resumen de archivos, almacenamiento y enlaces">
          <article className={styles.metricCard}>
            <div className={styles.metricHeading}>
              <div>
                <p className={styles.cardEyebrow}>CUOTA DE ARCHIVOS</p>
                <h2><strong>{archivos.length}</strong> / 10 archivos</h2>
              </div>
              <span className={styles.metricIcon} aria-hidden="true">▣</span>
            </div>
            <div className={styles.progressTrack} aria-hidden="true">
              <span className={styles.fileProgress} style={{ width: `${porcentajeArchivos}%` }} />
            </div>
            <div className={styles.metricFoot}>
              <span>{porcentajeArchivos.toFixed(0)}% asignado</span>
              <span>{10 - archivos.length} espacios disponibles</span>
            </div>
          </article>

          <article className={styles.metricCard}>
            <div className={styles.metricHeading}>
              <div>
                <p className={styles.cardEyebrow}>ALMACENAMIENTO OCUPADO</p>
                <h2><strong>{(almacenamientoUsado / 1_000_000).toFixed(1)}</strong> MB <span>de 100 MB</span></h2>
              </div>
              <span className={styles.metricIcon} aria-hidden="true">▤</span>
            </div>
            <div className={styles.progressTrack} aria-hidden="true">
              <span className={styles.storageProgress} style={{ width: `${porcentajeAlmacenamiento}%` }} />
            </div>
            <div className={styles.metricFoot}>
              <span>{porcentajeAlmacenamiento.toFixed(1)}% utilizado</span>
              <span>{((limiteAlmacenamiento - almacenamientoUsado) / 1_000_000).toFixed(1)} MB disponibles</span>
            </div>
          </article>

          <article className={`${styles.metricCard} ${styles.linkMetric}`}>
            <div className={styles.metricHeading}>
              <div>
                <p className={styles.cardEyebrow}>ENLACES</p>
                <h2><strong>{enlacesActivos}</strong> activos</h2>
              </div>
              <span className={styles.metricIcon} aria-hidden="true">↗</span>
            </div>
            <p className={styles.metricFootSingle}>Enlaces con acceso temporal habilitado</p>
          </article>
        </section>

        <section className={styles.listSection} aria-label="Lista de archivos">
          <div className={styles.searchRow}>
            <label className={styles.searchBox}>
              <span className={styles.searchIcon} aria-hidden="true">⌕</span>
              <span className={styles.visuallyHidden}>Buscar archivos</span>
              <input
                type="search"
                value={busqueda}
                onChange={(event) => setBusqueda(event.target.value)}
                placeholder="Buscar por nombre de archivo o extensión..."
              />
            </label>
            <span className={styles.filterLabel}>ORDENAR POR <strong>Más recientes</strong></span>
          </div>

          {errorLista && <div className={styles.demoNotice} role="alert">{errorLista}</div>}

          <div className={styles.tableWrap}>
            <table className={styles.fileTable}>
              <thead>
                <tr>
                  <th>ARCHIVO</th>
                  <th>FORMATO</th>
                  <th>FECHA DE SUBIDA</th>
                  <th>ESTADO DEL ENLACE</th>
                </tr>
              </thead>
              <tbody>
                {archivosFiltrados.map((archivo) => (
                  <tr key={archivo.id}>
                    <td>
                      <div className={styles.fileCell}>
                        <span className={styles.fileIcon} aria-hidden="true">▤</span>
                        <span className={styles.fileName}>
                          <strong>{archivo.nombre}</strong>
                          <small>{formatoTamano(archivo.tamanoBytes)}</small>
                        </span>
                      </div>
                    </td>
                    <td><span className={styles.formatBadge}>{formatoTipo(archivo.nombre)}</span></td>
                    <td><span className={styles.dateCell}>{formatoFecha(archivo.creadoEn)}<small>Subido por ti</small></span></td>
                    <td>
                      <span className={`${styles.statusBadge} ${styles[claseEstado(archivo.estadoEnlace)]}`}>
                        {archivo.estadoEnlace}
                      </span>
                    </td>
                  </tr>
                ))}
                {archivosFiltrados.length === 0 && (
                  <tr>
                    <td className={styles.emptySearch} colSpan={4}>No hay archivos con ese nombre.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <footer className={styles.listFooter}>
            Mostrando {archivosFiltrados.length} de {archivos.length} archivos registrados
          </footer>
        </section>
      </section>
    </main>
  );
}
