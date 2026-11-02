import type { Metadata } from "next";
import InicioSesionForm from "@/components/auth/InicioSesionForm";

export const metadata: Metadata = {
  title: "Iniciar sesión | SafeLinK",
  description: "Inicia sesión en SafeLinK.",
};

export default function InicioSesionPage() {
  return <InicioSesionForm />;
}
