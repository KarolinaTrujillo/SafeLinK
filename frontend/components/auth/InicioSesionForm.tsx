"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { validarSesionEnBackend } from "@/lib/api";
import styles from "@/app/iniciar-sesion/iniciarSesion.module.css";

export default function InicioSesionForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        if (signInError.code === "email_not_confirmed") {
          setError("La cuenta todavía no está confirmada. Confirma el correo antes de iniciar sesión.");
        } else {
          setError("No se pudo iniciar sesión. Revisa el correo y la contraseña e inténtalo de nuevo.");
        }
        return;
      }

      const accessToken = data.session?.access_token;

      if (!accessToken) {
        setError("Supabase no entregó una sesión. Inténtalo de nuevo.");
        return;
      }

      const backendValidatesSession = await validarSesionEnBackend(accessToken);

      if (!backendValidatesSession) {
        setError(
          "Supabase inició sesión, pero no pudimos validar la sesión con la API. Revisa que el backend esté activo.",
        );
        return;
      }

      router.replace("/mis-archivos");
    } catch {
      setError("Ocurrió un problema al iniciar sesión. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="login-title">
        <div className={styles.content}>
          <Link className={styles.brand} href="/" aria-label="SafeLinK, ir al registro">
            <span className={styles.brandIcon} aria-hidden="true">S</span>
            <span>SafeLinK</span>
          </Link>

          <header className={styles.heading}>
            <h1 id="login-title">Bienvenida de nuevo</h1>
            <p>Inicia sesión para administrar tus documentos compartidos.</p>
          </header>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.label} htmlFor="email">Correo electrónico</label>
            <input
              className={styles.input}
              id="email"
              type="email"
              autoComplete="email"
              placeholder="investigador@universidad.edu"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />

            <label className={styles.label} htmlFor="password">Contraseña</label>
            <div className={styles.passwordWrap}>
              <input
                className={styles.passwordInput}
                id="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Ingresa tu contraseña"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                className={styles.showButton}
                type="button"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              >
                {showPassword ? "Ocultar" : "Mostrar"}
              </button>
            </div>

            {error && <p className={styles.error} role="alert">{error}</p>}
            <button className={styles.submit} type="submit" disabled={loading}>
              {loading ? "Iniciando sesión…" : "Iniciar sesión"}
            </button>
          </form>
        </div>

        <footer className={styles.footer}>
          <span>¿Aún no tienes una cuenta?</span>
          <Link href="/">Crear cuenta</Link>
        </footer>
      </section>
    </main>
  );
}
