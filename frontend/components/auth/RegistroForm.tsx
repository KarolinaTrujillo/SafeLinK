"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import styles from "@/app/registro/registro.module.css";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

function LockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="white" aria-hidden="true">
      <path d="M7 10V7a5 5 0 0 1 9.8-1.4l-2 .7A3 3 0 0 0 9 7v3h9a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h1Zm5 4a1.5 1.5 0 0 0-.8 2.8V18h1.6v-1.2A1.5 1.5 0 0 0 12 14Z" />
    </svg>
  );
}

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.5 12s3.3-6 9.5-6 9.5 6 9.5 6-3.3 6-9.5 6-9.5-6-9.5-6Zm9.5 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m3 2 19 19-1.4 1.4-3.1-3.1A11.6 11.6 0 0 1 12 21C5.8 21 2.5 15 2.5 15a15.7 15.7 0 0 1 4-4.7L1.6 3.4 3 2Zm5 9a4.5 4.5 0 0 0 6.2 6.2L8 11Zm4-5c6.2 0 9.5 6 9.5 6a16.8 16.8 0 0 1-3.2 4l-2-2a4.5 4.5 0 0 0-5.3-5.3l-2-2A11.6 11.6 0 0 1 12 6Z" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9.2 16.2-4-4L3.8 13.6l5.4 5.4L20.5 7.7 19.1 6.3z" />
    </svg>
  );
}

export default function RegistroForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const passwordChecks = {
    length: password.length >= 8,
    alphanumeric: /[A-Za-z]/.test(password) && /\d/.test(password),
    uppercase: /[A-Z]/.test(password),
  };
  const passwordIsValid = Object.values(passwordChecks).every(Boolean);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!passwordIsValid) {
      setError("La contraseña debe cumplir todos los requisitos indicados.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }

    setLoading(true);
    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: window.location.origin,
        },
      });

      if (signUpError) {
        setError("No se pudo crear la cuenta. Revisa el correo e inténtalo de nuevo.");
        return;
      }

      setMessage("Te enviamos un enlace de activación. Revisa tu correo para confirmar la cuenta.");
      setPassword("");
      setConfirmPassword("");
    } catch {
      setError("No se pudo crear la cuenta. Revisa el correo e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.signupLayout}>
      <section className={styles.signupCard} aria-labelledby="signup-title">
        <div className={styles.signupCardContent}>
          <a className={styles.brand} href="/" aria-label="SafeLinK, inicio">
            <span className={styles.brandIcon}><LockIcon /></span>
            <span>SafeLinK</span>
          </a>

          <header className={styles.signupHeading}>
            <h1 id="signup-title">Crear nueva cuenta</h1>
            <p>Administra y comparte documentos bajo control de acceso.</p>
          </header>

          <form className={styles.signupForm} onSubmit={handleSubmit}>
            <label className={styles.fieldLabel} htmlFor="email">Correo electrónico</label>
            <div className={styles.inputWrap}>
              <span className={styles.inputIcon} aria-hidden="true">@</span>
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="investigador@universidad.edu"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <p className={styles.fieldHelp}>Se enviará un enlace de activación único a esta dirección.</p>

            <div className={styles.passwordGrid}>
              <div>
                <label className={styles.fieldLabel} htmlFor="password">Contraseña</label>
                <div className={styles.inputWrap}>
                  <span className={`${styles.inputIcon} ${styles.keyIcon}`} aria-hidden="true">⚿</span>
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                  <button
                    className={styles.visibilityButton}
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    <EyeIcon visible={showPassword} />
                  </button>
                </div>
              </div>

              <div>
                <label className={styles.fieldLabel} htmlFor="confirm-password">Confirmar contraseña</label>
                <div className={styles.inputWrap}>
                  <span className={`${styles.inputIcon} ${styles.keyIcon}`} aria-hidden="true">↻</span>
                  <input
                    id="confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="••••••••••••"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    required
                  />
                  <button
                    className={styles.visibilityButton}
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    aria-label={showConfirmPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    <EyeIcon visible={showConfirmPassword} />
                  </button>
                </div>
              </div>
            </div>

            <div className={styles.passwordStrength} aria-label="Requisitos de contraseña">
              <p className={styles.strengthTitle}>Fortaleza de credenciales</p>
              <div className={styles.strengthBars} aria-hidden="true">
                <span className={passwordChecks.length ? styles.complete : ""} />
                <span className={passwordChecks.alphanumeric ? styles.complete : ""} />
                <span className={passwordChecks.uppercase ? styles.complete : ""} />
              </div>
              <div className={styles.strengthRules}>
                <span className={passwordChecks.length ? styles.ruleComplete : ""}>
                  <i>{passwordChecks.length ? <CheckIcon /> : null}</i>8+ caracteres
                </span>
                <span className={passwordChecks.alphanumeric ? styles.ruleComplete : ""}>
                  <i>{passwordChecks.alphanumeric ? <CheckIcon /> : null}</i>Alfanumérico (a-Z, 0-9)
                </span>
                <span className={passwordChecks.uppercase ? styles.ruleComplete : ""}>
                  <i>{passwordChecks.uppercase ? <CheckIcon /> : null}</i>Mínimo 1 mayúscula
                </span>
              </div>
            </div>

            {error && <p className={`${styles.formMessage} ${styles.formError}`} role="alert">{error}</p>}
            {message && <p className={`${styles.formMessage} ${styles.formSuccess}`} role="status">{message}</p>}

            <button className={styles.submitButton} type="submit" disabled={loading}>
              {loading ? "Creando cuenta…" : "Crear cuenta"}
              {!loading && <span aria-hidden="true">→</span>}
            </button>
          </form>
        </div>

        <footer className={styles.signupFooter}>
          <span>¿Ya tienes una cuenta registrada?</span>
          <Link href="/iniciar-sesion">Iniciar sesión <span aria-hidden="true">↪</span></Link>
        </footer>
      </section>

      <aside className={styles.signupAside} aria-label="Información de SafeLinK">
        <section className={styles.infoCard}>
          <h2><span className={styles.cloudIcon} aria-hidden="true"><CheckIcon /></span>Cuota asignada</h2>
          <div className={styles.quotaDisplay}>
            <div className={styles.quotaRing}><div><strong>100 MB</strong><span>Capacidad</span></div></div>
            <p><span className={styles.quotaDot} />Hasta 10 archivos de máximo 10 MB cada uno</p>
          </div>
        </section>

        <section className={`${styles.infoCard} ${styles.securityCard}`}>
          <h2><span className={styles.shieldIcon} aria-hidden="true">⛨</span>Protección contra descargas no autorizadas</h2>
          <div className={styles.featureRow}>
            <span className={`${styles.featureIcon} ${styles.blueFeature}`} aria-hidden="true">◷</span>
            <div><h3>Enlaces efímeros</h3><p>Define vigencia exacta en horas o limita el número de descargas.</p></div>
          </div>
          <div className={styles.featureRow}>
            <span className={`${styles.featureIcon} ${styles.blueFeature}`} aria-hidden="true">⊘</span>
            <div><h3>Revocación inmediata</h3><p>Corta accesos previamente concedidos con un clic.</p></div>
          </div>
        </section>
      </aside>
    </main>
  );
}


