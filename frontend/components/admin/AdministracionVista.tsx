"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Topbar from "@/components/layout/Topbar";
import { supabase } from "@/lib/supabase";
import { obtenerPerfilEnBackend } from "@/lib/api";
import { consultarPanelAdmin, consultarEventosAdmin, revocarEnlaceAdmin, ErrorAdmin, type ArchivoAdmin, type PanelAdmin, type EstadoAdmin, type EventoAdmin } from "@/lib/admin";
import styles from "@/app/administracion/administracion.module.css";

const filtros: { estado: EstadoAdmin; texto: string }[] = [
  { estado: "Todos", texto: "Todos" }, { estado: "Activo", texto: "Activos" },
  { estado: "Revocado", texto: "Revocados" }, { estado: "Agotado", texto: "Agotados" },
  { estado: "Vencido", texto: "Vencidos" }, { estado: "Sin enlace", texto: "Sin enlace" },
];
const formato = new Intl.NumberFormat("es-MX");
const fecha = (valor: string) => new Date(valor).toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });

function Icono({ tipo }: { tipo: "archivos" | "descargas" | "escudo" | "actualizar" | "revocar" }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tipo === "archivos" && <><path d="M3 7h7l2-3h9v16H3ZM7 11h10M7 15h6" /></>}
    {tipo === "descargas" && <><path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" /></>}
    {tipo === "escudo" && <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" /><path d="M12 8v5m0 3h.01" /></>}
    {tipo === "actualizar" && <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1" /></>}
    {tipo === "revocar" && <><path d="m3 3 18 18M10 7l3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3" /></>}
  </svg>;
}

async function tokenActual() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new ErrorAdmin("Tu sesión expiró. Vuelve a iniciar sesión.", 401);
  return data.session.access_token;
}

export default function AdministracionVista() {
  const router = useRouter();
  const [acceso, setAcceso] = useState<"verificando" | "permitido" | "denegado" | "error">("verificando");
  const [email, setEmail] = useState("");
  const [panel, setPanel] = useState<PanelAdmin | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [consulta, setConsulta] = useState("");
  const [estado, setEstado] = useState<EstadoAdmin>("Todos");
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [revision, setRevision] = useState(0);
  const [confirmacion, setConfirmacion] = useState<ArchivoAdmin | null>(null);
  const [revocando, setRevocando] = useState(false);
  const [verActividad, setVerActividad] = useState(false);
  const [eventos, setEventos] = useState<EventoAdmin[]>([]);
  const [totalEventos, setTotalEventos] = useState(0);
  const [paginaEventos, setPaginaEventos] = useState(1);
  const [cargandoEventos, setCargandoEventos] = useState(false);
  const [errorEventos, setErrorEventos] = useState("");

  useEffect(() => {
    let activo = true;
    async function comprobar() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { router.replace("/iniciar-sesion"); return; }
        const perfil = await obtenerPerfilEnBackend(data.session.access_token);
        if (!activo) return;
        if (!perfil) throw new Error("No se pudo comprobar tu perfil. Inténtalo de nuevo.");
        setEmail(data.session.user.email ?? "");
        setAcceso(perfil.rol === "administrador" ? "permitido" : "denegado");
      } catch (fallo) {
        if (activo) { setError(fallo instanceof Error ? fallo.message : "No se pudo comprobar el acceso."); setAcceso("error"); }
      }
    }
    void comprobar();
    return () => { activo = false; };
  }, [router]);

  useEffect(() => {
    if (acceso !== "permitido") return;
    const control = new AbortController();
    async function cargar() {
      setCargando(true); setError("");
      try {
        const datos = await consultarPanelAdmin(await tokenActual(), consulta, estado, pagina, control.signal);
        if (!control.signal.aborted) setPanel(datos);
      } catch (fallo) {
        if (!control.signal.aborted) {
          if (fallo instanceof ErrorAdmin && fallo.estado === 401) router.replace("/iniciar-sesion");
          if (fallo instanceof ErrorAdmin && fallo.estado === 403) { setAcceso("denegado"); setPanel(null); }
          setError(fallo instanceof Error ? fallo.message : "No se pudo cargar el panel.");
        }
      } finally { if (!control.signal.aborted) setCargando(false); }
    }
    void cargar();
    return () => control.abort();
  }, [acceso, consulta, estado, pagina, revision, router]);

  useEffect(() => {
    if (!verActividad || acceso !== "permitido") return;
    const control = new AbortController();
    async function cargar() {
      setCargandoEventos(true); setErrorEventos("");
      try {
        const datos = await consultarEventosAdmin(await tokenActual(), paginaEventos, control.signal);
        if (!control.signal.aborted) { setEventos(datos.eventos); setTotalEventos(datos.total); }
      } catch (fallo) {
        if (!control.signal.aborted) {
          if (fallo instanceof ErrorAdmin && fallo.estado === 401) router.replace("/iniciar-sesion");
          if (fallo instanceof ErrorAdmin && fallo.estado === 403) { setAcceso("denegado"); setPanel(null); }
          setErrorEventos(fallo instanceof Error ? fallo.message : "No se pudieron cargar los eventos.");
        }
      } finally { if (!control.signal.aborted) setCargandoEventos(false); }
    }
    void cargar();
    return () => control.abort();
  }, [acceso, verActividad, paginaEventos, revision, router]);

  function buscar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPagina(1); setConsulta(busqueda.trim()); setConfirmacion(null);
  }

  async function revocar() {
    if (!confirmacion?.enlaceId || revocando) return;
    setRevocando(true); setError(""); setMensaje("");
    try {
      await revocarEnlaceAdmin(await tokenActual(), confirmacion.enlaceId);
      setMensaje(`Se revocó el enlace de «${confirmacion.nombre}».`);
      setConfirmacion(null); setPagina(1); setRevision((valor) => valor + 1);
    } catch (fallo) {
      if (fallo instanceof ErrorAdmin && fallo.estado === 401) router.replace("/iniciar-sesion");
      if (fallo instanceof ErrorAdmin && fallo.estado === 403) { setAcceso("denegado"); setPanel(null); }
      setError(fallo instanceof Error ? fallo.message : "No se pudo revocar.");
    } finally { setRevocando(false); }
  }

  if (acceso === "verificando") return <main className={styles.loading}><p role="status">Comprobando acceso administrativo…</p></main>;
  if (acceso !== "permitido") return <main className={styles.denied}>
    <Icono tipo="escudo" /><h1>{acceso === "denegado" ? "Acceso restringido" : "No se pudo comprobar el acceso"}</h1>
    <p role="alert">{acceso === "denegado" ? "Este panel está disponible únicamente para administradores." : error}</p>
    <Link href="/mis-archivos">Volver a Mis archivos</Link>
  </main>;

  return <main className={styles.page}>
    <Topbar email={email} rol="administrador" />
    <section className={styles.content}>
      <header className={styles.heading}>
        <div><h1>Panel de Administración</h1><p>Monitoreo general de recursos compartidos y políticas de acceso.</p></div>
        <div className={styles.toolbar}><button type="button" aria-expanded={verActividad} aria-controls="actividad-reciente" onClick={() => setVerActividad(!verActividad)}>{verActividad ? "Ocultar actividad" : "Actividad reciente"}</button><button type="button" disabled={cargando || revocando} onClick={() => setRevision((valor) => valor + 1)}><Icono tipo="actualizar" /> Actualizar</button></div>
      </header>
      {verActividad && <section id="actividad-reciente" className={styles.tablePanel} aria-labelledby="actividad-admin">
        <div className={styles.tableHeading}><h2 id="actividad-admin">Actividad reciente</h2><p>Eventos registrados en los últimos 60 días.</p></div>
        {errorEventos && <p className={styles.error} role="alert">{errorEventos}</p>}
        <div className={styles.tableScroll}><table className={styles.table} aria-busy={cargandoEventos}><thead><tr><th scope="col">Fecha</th><th scope="col">Evento</th><th scope="col">Resultado</th><th scope="col">Detalle</th></tr></thead><tbody>
          {cargandoEventos ? <tr><td colSpan={4} className={styles.empty}>Cargando eventos…</td></tr> : errorEventos ? <tr><td colSpan={4} className={styles.empty}>No se pudo actualizar la actividad.</td></tr> : eventos.length ? eventos.map((evento) => <tr key={evento.id}><td>{fecha(evento.creado_en)}</td><td>{evento.tipo_evento.replaceAll("_", " ")}</td><td><span className={`${styles.badge} ${evento.resultado === "exitoso" ? styles.active : styles.revoked}`}>{evento.resultado}</span></td><td>{evento.motivo ?? "—"}</td></tr>) : <tr><td colSpan={4} className={styles.empty}>Aún no hay eventos registrados.</td></tr>}
        </tbody></table></div>
        <footer className={styles.pagination}><span>{formato.format(totalEventos)} eventos</span><div><button type="button" disabled={paginaEventos <= 1 || cargandoEventos} onClick={() => setPaginaEventos(paginaEventos - 1)}>Anterior</button><span>Página {paginaEventos} de {Math.max(1, Math.ceil(totalEventos / 10))}</span><button type="button" disabled={paginaEventos * 10 >= totalEventos || cargandoEventos} onClick={() => setPaginaEventos(paginaEventos + 1)}>Siguiente</button></div></footer>
      </section>}
      <div className={styles.metrics} aria-label="Métricas globales">
        <article className={styles.metric}><div className={styles.metricLabel}><h2>Total de archivos</h2><span><Icono tipo="archivos" /></span></div><strong>{panel ? formato.format(panel.metricas.archivos) : "—"}</strong><p>{panel ? `${formato.format(panel.metricas.usuarios)} usuarios registrados` : "Cargando datos…"}</p></article>
        <article className={styles.metric}><div className={styles.metricLabel}><h2>Descargas exitosas</h2><span className={styles.greenIcon}><Icono tipo="descargas" /></span></div><strong>{panel ? formato.format(panel.metricas.descargas) : "—"}</strong><p>Eventos registrados en los últimos 60 días</p></article>
        <article className={`${styles.metric} ${styles.rejections}`}><div className={styles.metricLabel}><h2>Accesos rechazados</h2><span><Icono tipo="escudo" /></span></div><strong>{panel ? formato.format(panel.metricas.rechazos) : "—"}</strong><p>Rechazos registrados en los últimos 60 días</p></article>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {mensaje && <p className={styles.success} role="status">{mensaje}</p>}
      {confirmacion && <section className={styles.confirm} aria-labelledby="titulo-revocar">
        <h2 id="titulo-revocar">Revocar enlace de «{confirmacion.nombre}»</h2><p>El enlace mostrado dejará de permitir descargas. Esta acción no puede deshacerse y no elimina el archivo.</p>
        <button type="button" disabled={revocando} onClick={revocar}>{revocando ? "Revocando…" : "Confirmar revocación"}</button><button type="button" disabled={revocando} onClick={() => setConfirmacion(null)}>Cancelar</button>
      </section>}
      <section className={styles.tablePanel} aria-labelledby="gestion-archivos">
        <div className={styles.tableHeading}>
          <h2 id="gestion-archivos"><Icono tipo="archivos" /> Gestión Global de Archivos</h2>
          <form className={styles.search} onSubmit={buscar}><input aria-label="Buscar por título o identificador del propietario" placeholder="Buscar por título o ID de usuario…" value={busqueda} maxLength={150} onChange={(event) => setBusqueda(event.target.value)} /><button type="submit" disabled={revocando}>Buscar</button></form>
          <div className={styles.filters} aria-label="Filtrar archivos por estado">{filtros.map((filtro) => <button type="button" key={filtro.estado} aria-pressed={estado === filtro.estado} disabled={revocando} onClick={() => { setEstado(filtro.estado); setPagina(1); setConfirmacion(null); }}>{filtro.texto} {panel && `(${panel.conteos[filtro.estado]})`}</button>)}</div>
        </div>
        <div className={styles.tableScroll}>
          <table className={styles.table} aria-busy={cargando}>
            <thead><tr><th scope="col">Archivo</th><th scope="col">Propietario (ID)</th><th scope="col">Tamaño</th><th scope="col">Estado enlace</th><th scope="col">Fecha creación</th><th scope="col">Acciones</th></tr></thead>
            <tbody>{cargando ? <tr><td colSpan={6} className={styles.empty}>Cargando archivos…</td></tr> : error ? <tr><td colSpan={6} className={styles.empty}>No se pudo actualizar la lista. Vuelve a intentarlo.</td></tr> : panel?.archivos.length ? panel.archivos.map((archivo) => <tr key={archivo.id}>
              <td><div className={styles.fileName}><span className={archivo.tipoMime === "application/pdf" ? styles.pdf : styles.fileIcon} aria-hidden="true">▤</span><strong>{archivo.nombre}</strong></div>{archivo.estadoLimpieza === "pendiente_limpieza" && <small>Pendiente de limpieza</small>}</td>
              <td><span className={styles.owner}>{archivo.propietario}</span></td>
              <td>{formato.format(Number((archivo.tamanoBytes / 1_000_000).toFixed(2)))} MB</td>
              <td><span className={`${styles.badge} ${archivo.estado === "Activo" ? styles.active : archivo.estado === "Revocado" ? styles.revoked : styles.neutral}`}>{archivo.estado}{archivo.enlaceId && ` (${archivo.descargasRealizadas}/${archivo.maximoDescargas})`}</span></td>
              <td>{fecha(archivo.creadoEn)}</td>
              <td><button className={styles.revoke} type="button" disabled={!archivo.enlaceId || archivo.estado === "Revocado" || revocando} onClick={() => { setConfirmacion(archivo); setError(""); setMensaje(""); }} aria-label={`Revocar enlace de ${archivo.nombre}`}><Icono tipo="revocar" /> {archivo.estado === "Revocado" ? "Desactivado" : "Revocar enlace"}</button></td>
            </tr>) : <tr><td colSpan={6} className={styles.empty}>No hay archivos que coincidan con esta búsqueda.</td></tr>}</tbody>
          </table>
        </div>
        <footer className={styles.pagination}><span>{panel ? `${formato.format(panel.total)} archivos encontrados` : "Sin datos"}</span><div><button type="button" disabled={pagina <= 1 || cargando || revocando} onClick={() => { setPagina(pagina - 1); setConfirmacion(null); }}>Anterior</button><span>Página {pagina} de {Math.max(1, Math.ceil((panel?.total ?? 0) / 10))}</span><button type="button" disabled={!panel || pagina * 10 >= panel.total || cargando || revocando} onClick={() => { setPagina(pagina + 1); setConfirmacion(null); }}>Siguiente</button></div></footer>
      </section>

    </section>
  </main>;
}
