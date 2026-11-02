import type { Metadata } from "next";
import SubirArchivoVista from "@/components/archivos/SubirArchivoVista";

export const metadata: Metadata = {
  title: "Subir archivo | SafeLinK",
  description: "Carga privada de archivos en SafeLinK.",
};

export default function SubirArchivoPage() {
  return <SubirArchivoVista />;
}
