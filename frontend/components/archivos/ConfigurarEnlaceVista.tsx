"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import Topbar from "@/components/layout/Topbar";
import { supabase } from "@/lib/supabase";
import { consultarEnlaces, generarClaveEnlace, guardarEnlace, obtenerArchivos, obtenerPerfilEnBackend, revocarEnlace, type ArchivoUsuario, type EnlaceCompartido, type RolUsuario } from "@/lib/api";
import styles from "@/app/compartir-enlace/compartirEnlace.module.css";

const plazos = [{ valor: "1", texto: "1 hora" }, { valor: "12", texto: "12 horas" }, { valor: "24", texto: "1 día" }, { valor: "48", texto: "2 días" }, ...[5, 6, 7, 8, 9, 10].map((dias) => ({ valor: String(dias * 24), texto: `${dias} días` })), { valor: "personalizado", texto: "Personalizada" }];

function fechaLocal(fecha: string) {
  const valor = new Date(fecha);
  return new Date(valor.getTime() - valor.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

async function tokenActual() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("La sesión expiró. Vuelve a iniciar sesión.");
  return data.session.access_token;
}

export default function ConfigurarEnlaceVista() {
  const router = useRouter();
  const params = useSearchParams();
  const archivoSolicitado = params.get("archivo") ?? "";
  const [email, setEmail] = useState("");
  const [rol, setRol] = useState<RolUsuario>("usuario");
  const [archivos, setArchivos] = useState<ArchivoUsuario[]>([]);
  const [archivoId, setArchivoId] = useState("");
  const [enlaces, setEnlaces] = useState<EnlaceCompartido[]>([]);
  const [enlaceId, setEnlaceId] = useState("");
  const [plazo, setPlazo] = useState("48");
  const [fecha, setFecha] = useState("");
  const [limite, setLimite] = useState("5");
  const [limitePersonalizado, setLimitePersonalizado] = useState("5");
  const [protegido, setProtegido] = useState(true);
  const [borradorClave, setBorradorClave] = useState("");
  const [credenciales, setCredenciales] = useState({ url: "", contrasena: "" });
  const [mostrarClave, setMostrarClave] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [cargandoEnlaces, setCargandoEnlaces] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarRevocacion, setConfirmarRevocacion] = useState(false);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const archivo = archivos.find((item) => item.id === archivoId);
  const enlace = enlaces.find((item) => item.id === enlaceId);
  const revocado = Boolean(enlace?.revocado_en);
  const maximo = Number(limite === "personalizado" ? limitePersonalizado : limite);
  const usadas = enlace?.descargas_realizadas ?? 0;
  const bloqueado = ocupado || cargandoEnlaces || !archivo || revocado;

  useEffect(() => {
    let activo = true;
    async function cargar() {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { router.replace("/iniciar-sesion"); return; }
        const perfil = await obtenerPerfilEnBackend(data.session.access_token);
        const lista = await obtenerArchivos(data.session.access_token);
        if (!activo) return;
        setEmail(data.session.user.email ?? "");
        if (perfil) setRol(perfil.rol);
        setArchivos(lista);
        setEnlaceId(""); setEnlaces([]);
        setCredenciales({ url: "", contrasena: "" });
        setBorradorClave(""); setMostrarClave(false);
        setConfirmarRevocacion(false); setMensaje(""); setError("");
        setPlazo("48"); setFecha(""); setLimite("5");
        setLimitePersonalizado("5"); setProtegido(true);
        if (archivoSolicitado && !lista.some((item) => item.id === archivoSolicitado)) {
          setArchivoId("");
          setError("El archivo solicitado no está disponible en tu cuenta.");
        } else {
          setArchivoId(archivoSolicitado || lista[0]?.id || "");
        }
      } catch {
        if (activo) setError("No se pudieron cargar tus archivos. Recarga la página.");
      } finally { if (activo) setCargando(false); }
    }
    void cargar();
    return () => { activo = false; };
  }, [router, archivoSolicitado]);

  useEffect(() => {
    if (!archivoId) return;
    let activo = true;
    async function cargar() {
      setCargandoEnlaces(true);
      try {
        const respuesta = await consultarEnlaces(await tokenActual(), archivoId);
        if (activo) setEnlaces(respuesta.enlaces);
      } catch {
        if (activo) setError("No se pudieron consultar los enlaces. Recarga la página.");
      } finally { if (activo) setCargandoEnlaces(false); }
    }
    void cargar();
    return () => { activo = false; };
  }, [archivoId]);

  function elegirEnlace(id: string) {
    const existente = enlaces.find((item) => item.id === id);
    setEnlaceId(id);
    setCredenciales({ url: "", contrasena: "" });
    setBorradorClave(""); setMostrarClave(false);
    setConfirmarRevocacion(false); setError(""); setMensaje("");
    setProtegido(existente?.protegido ?? true);
    setPlazo(existente ? "personalizado" : "48");
    setFecha(existente ? fechaLocal(existente.vence_en) : "");
    const cantidad = existente?.maximo_descargas ?? 5;
    setLimite([1, 3, 5, 10].includes(cantidad) ? String(cantidad) : "personalizado");
    setLimitePersonalizado(String(cantidad));
  }

  function elegirArchivo(id: string) {
    elegirEnlace(""); setEnlaces([]); setArchivoId(id);
  }

  async function generarClave() {
    setOcupado(true); setError(""); setMensaje("");
    try {
      const data = await generarClaveEnlace(await tokenActual());
      setBorradorClave(data.contrasena);
      setMensaje("Contraseña generada. Guarda la configuración para aplicarla.");
    } catch (fallo) { setError(fallo instanceof Error ? fallo.message : "No se pudo generar la contraseña."); }
    finally { setOcupado(false); }
  }

  async function guardar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bloqueado) return;
    setError(""); setMensaje("");
    const vence = plazo === "personalizado" ? new Date(fecha).getTime() : Date.now() + Number(plazo) * 3600000;
    const maxFecha = (enlace ? Date.parse(enlace.creado_en) : Date.now()) + 15 * 86400000;
    if (!Number.isFinite(vence) || vence <= Date.now() || vence > maxFecha) { setError("Elige una fecha futura, hasta 15 días desde la creación del enlace."); return; }
    if (!Number.isInteger(maximo) || maximo < 1 || maximo > 20 || maximo < usadas) { setError("El límite debe ser de 1 a 20 y no menor que las descargas realizadas."); return; }
    setOcupado(true);
    try {
      const data = await guardarEnlace(await tokenActual(), { archivoId, venceEn: new Date(vence).toISOString(), maximoDescargas: maximo, protegido, ...(protegido && borradorClave ? { contrasena: borradorClave } : {}), ...(enlace ? { actualizadoEn: enlace.actualizado_en } : {}) }, enlace?.id);
      setEnlaces((actuales) => [data.enlace, ...actuales.filter((item) => item.id !== data.enlace.id)]);
      setEnlaceId(data.enlace.id);
      setCredenciales((actuales) => ({ url: data.url ?? actuales.url, contrasena: protegido ? data.contrasena ?? actuales.contrasena : "" }));
      setBorradorClave("");
      setPlazo("personalizado"); setFecha(fechaLocal(data.enlace.vence_en));
      setMensaje("Configuración guardada. Copia las credenciales disponibles antes de salir de esta página.");
    } catch (fallo) { setError(fallo instanceof Error ? fallo.message : "No se pudo guardar."); }
    finally { setOcupado(false); }
  }

  async function revocar() {
    if (!enlace || ocupado) return;
    setOcupado(true); setError(""); setMensaje("");
    try {
      const data = await revocarEnlace(await tokenActual(), enlace.id);
      setEnlaces((actuales) => actuales.map((item) => item.id === data.enlace.id ? data.enlace : item));
      setCredenciales({ url: "", contrasena: "" }); setBorradorClave("");
      setConfirmarRevocacion(false); setMensaje("Enlace revocado.");
    } catch (fallo) { setError(fallo instanceof Error ? fallo.message : "No se pudo revocar."); }
    finally { setOcupado(false); }
  }

  async function copiar(texto: string) {
    try { await navigator.clipboard.writeText(texto); setMensaje("Copiado al portapapeles."); }
    catch { setError("No fue posible copiar. Selecciona el texto y cópialo manualmente."); }
  }

  if (cargando) return <main className={styles.loading}>Cargando archivos…</main>;

  return <main className={styles.page}>
    <Topbar email={email} rol={rol} />
    <section className={styles.content}>
      <Link className={styles.back} href="/mis-archivos">← Volver a Mis archivos</Link>
      <h1>Configurar y compartir enlace</h1>
      <div className={styles.fileCard}>
        <span className={styles.fileIcon} aria-hidden="true">▤</span>
        <div className={styles.fileDetails}>
          <label htmlFor="archivo-compartir">Archivo que deseas compartir</label>
          <select id="archivo-compartir" value={archivoId} onChange={(event) => elegirArchivo(event.target.value)} disabled={ocupado || cargandoEnlaces}>
            <option value="" disabled>Selecciona un archivo</option>
            {archivos.map((item) => <option key={item.id} value={item.id}>{item.nombre}</option>)}
          </select>
          {archivo && <small>{(archivo.tamanoBytes / 1_000_000).toFixed(2)} MB · Subido el {new Date(archivo.creadoEn).toLocaleDateString("es-MX")} · {email}</small>}
          {!archivos.length && <p>Aún no tienes archivos. <Link href="/subir-archivo">Sube uno para compartirlo.</Link></p>}
        </div>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {mensaje && <p className={styles.message} role="status">{mensaje}</p>}
      <div className={styles.columns}>
        <form className={styles.panel} onSubmit={guardar}>
          <header className={styles.panelHeading}><span aria-hidden="true">☷</span><div><h2>Políticas de acceso temporal</h2><p>Ajusta la vigencia y restricciones de descarga</p></div></header>
          {enlaces.length > 0 && <div className={styles.field}><label htmlFor="enlace-existente">Enlace a configurar</label><select id="enlace-existente" value={enlaceId} disabled={ocupado || cargandoEnlaces} onChange={(event) => elegirEnlace(event.target.value)}><option value="">Crear un nuevo enlace</option>{enlaces.map((item, index) => <option key={item.id} value={item.id}>Enlace {enlaces.length - index} · {new Date(item.creado_en).toLocaleString("es-MX")} {item.revocado_en ? "· Revocado" : ""}</option>)}</select></div>}
          <fieldset disabled={bloqueado} className={styles.policies}>
            <legend className={styles.srOnly}>Configuración del enlace</legend>
            <div className={styles.field}>
              <div className={styles.fieldHeading}><label htmlFor="plazo">Vencimiento del enlace</label><small>Hasta 15 días desde su creación</small></div>
              <select id="plazo" value={plazo} onChange={(event) => setPlazo(event.target.value)}>{plazos.map((item) => <option key={item.valor} value={item.valor}>{item.texto}</option>)}</select>
              {plazo === "personalizado" && <input aria-label="Fecha y hora de vencimiento" type="datetime-local" required value={fecha} onChange={(event) => setFecha(event.target.value)} />}
            </div>
            <fieldset className={styles.downloads}>
              <legend>Límite de descargas permitidas</legend>
              <div className={styles.options}>{["1", "3", "5", "10", "personalizado"].map((valor) => <button type="button" key={valor} aria-pressed={limite === valor} className={limite === valor ? styles.selected : ""} onClick={() => setLimite(valor)}>{valor === "personalizado" ? "Personalizado" : `${valor} ${valor === "1" ? "descarga" : "descargas"}`}</button>)}</div>
              {limite === "personalizado" && <input type="number" aria-label="Máximo de descargas" min={Math.max(1, usadas)} max={20} required value={limitePersonalizado} onChange={(event) => setLimitePersonalizado(event.target.value)} />}
            </fieldset>
            <div className={styles.protection}>
              <label className={styles.toggle}><span><strong>Protección con contraseña</strong><small>Requiere una clave adicional para acceder al archivo.</small></span><input type="checkbox" role="switch" checked={protegido} onChange={(event) => { setProtegido(event.target.checked); setBorradorClave(""); }} /></label>
              {protegido && <div className={styles.generate}><small>Clave aleatoria de 12 caracteres con letras, números y símbolos.</small><button type="button" onClick={generarClave}>Generar contraseña aleatoria segura</button></div>}
            </div>
          </fieldset>
          {revocado && <p className={styles.error}>Este enlace está revocado. Puedes crear uno nuevo.</p>}
          <div className={styles.actions}><button type="button" className={styles.revoke} disabled={!enlace || revocado || ocupado} onClick={() => setConfirmarRevocacion(true)}>Revocar enlace ahora</button><button className={styles.save} type="submit" disabled={bloqueado}>{ocupado ? "Procesando…" : "Guardar configuración"}</button></div>
          {confirmarRevocacion && <div className={styles.confirm}><p>¿Revocar este enlace? No podrá reactivarse.</p><button type="button" disabled={ocupado} onClick={revocar}>Confirmar revocación</button><button type="button" disabled={ocupado} onClick={() => setConfirmarRevocacion(false)}>Cancelar</button></div>}
        </form>
        <aside className={styles.panel}>
          <header className={styles.panelHeading}><span aria-hidden="true">↗</span><div><h2>Credenciales de acceso</h2><p>{enlace ? revocado ? "Enlace revocado" : "Configuración guardada" : "Guarda para generar las credenciales"}</p></div></header>
          <div className={styles.credential}><label htmlFor="url-enlace">Bloque 1: enlace secreto único</label><div className={styles.secretRow}><input id="url-enlace" readOnly value={credenciales.url} placeholder={enlace ? "El enlace completo solo se muestra al crearlo" : "Se generará al guardar"} /><button type="button" disabled={!credenciales.url || revocado} aria-label="Copiar enlace" onClick={() => copiar(credenciales.url)}>⧉</button></div><button className={styles.copy} type="button" disabled={!credenciales.url || revocado} onClick={() => copiar(credenciales.url)}>Copiar enlace</button></div>
          <div className={styles.credential}><label htmlFor="clave-enlace">Bloque 2: contraseña de acceso</label><div className={styles.secretRow}><input id="clave-enlace" readOnly type={mostrarClave ? "text" : "password"} value={protegido ? borradorClave || credenciales.contrasena : ""} placeholder={protegido ? "Se genera al guardar o con el botón" : "Sin contraseña"} /><button type="button" aria-label={mostrarClave ? "Ocultar contraseña" : "Mostrar contraseña"} onClick={() => setMostrarClave(!mostrarClave)}>{mostrarClave ? "Ocultar" : "Ver"}</button><button type="button" aria-label="Copiar contraseña guardada" disabled={!credenciales.contrasena || Boolean(borradorClave) || !protegido || revocado} onClick={() => copiar(credenciales.contrasena)}>⧉</button></div><p className={styles.hint}>{borradorClave ? "Contraseña nueva pendiente de guardar." : enlace?.protegido && !credenciales.contrasena ? "La contraseña guardada no se puede recuperar. Genera otra si necesitas reemplazarla." : "Comparte la contraseña por un canal distinto al enlace."}</p></div>
          <div className={styles.usage}><div><strong>Estado de descargas</strong><p>{usadas} de {enlace?.maximo_descargas ?? maximo} descargas utilizadas</p></div><span>{enlace ? Math.round(usadas / enlace.maximo_descargas * 100) : 0}%</span></div>
          <p className={styles.hint}>La descarga pública está pendiente de implementación. Por ahora puedes guardar y administrar la configuración del enlace.</p>
        </aside>
      </div>
    </section>
  </main>;
}
