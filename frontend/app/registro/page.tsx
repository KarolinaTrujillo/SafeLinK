import type { Metadata } from "next";
import RegistroForm from "@/components/auth/RegistroForm";

export const metadata: Metadata = {
  title: "Crear cuenta | SafeLinK",
  description: "Crea una cuenta para compartir documentos con control de acceso.",
};

export default function RegistroPage() {
  return <RegistroForm />;
}
