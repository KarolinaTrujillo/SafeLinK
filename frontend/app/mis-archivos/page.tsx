import type { Metadata } from "next";
import MisArchivosVista from "@/components/archivos/MisArchivosVista";

export const metadata: Metadata = {
  title: "Mis archivos | SafeLinK",
  description: "Administra tus archivos compartidos en SafeLinK.",
};

export default function MisArchivosPage() {
  return <MisArchivosVista />;
}
