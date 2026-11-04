"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { RolUsuario } from "@/lib/api";
import styles from "./Topbar.module.css";

type Props = { email: string; rol: RolUsuario };

export default function Topbar({ email, rol }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [cerrando, setCerrando] = useState(false);
  const [error, setError] = useState("");

  async function cerrarSesion() {
    setCerrando(true);
    setError("");
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      router.replace("/iniciar-sesion");
    } catch {
      setError("No se pudo cerrar sesión. Inténtalo de nuevo.");
      setCerrando(false);
    }
  }

  return (
    <header className={styles.topBar}>
      <Link className={styles.brand} href="/mis-archivos" aria-label="SafeLinK, mis archivos">
        <span className={styles.brandIcon} aria-hidden="true">S</span><span>SafeLinK</span>
      </Link>
      <nav className={styles.navigation} aria-label="Navegación principal">
        <Link className={styles.navLink} href="/mis-archivos" aria-current={pathname === "/mis-archivos" ? "page" : undefined}>Mis archivos</Link>
        <Link className={styles.navLink} href="/subir-archivo" aria-current={pathname === "/subir-archivo" ? "page" : undefined}>Subir Archivo</Link>
        <Link className={styles.navLink} href="/compartir-enlace" aria-current={pathname === "/compartir-enlace" ? "page" : undefined}>Compartir Enlace</Link>
        {rol === "administrador" && (
          <span className={styles.disabledNav} aria-disabled="true" title="Vista administrativa pendiente">
            Administración <span className={styles.adminBadge}>ADMIN</span>
          </span>
        )}
      </nav>
      <div className={styles.account}>
        <span className={styles.email} title={email}>{email}</span>
        {error && <span className={styles.logoutError} role="alert">{error}</span>}
        <button className={styles.signOutButton} type="button" onClick={cerrarSesion} disabled={cerrando}>
          {cerrando ? "Saliendo…" : "Cerrar sesión"}
        </button>
      </div>
    </header>
  );
}
