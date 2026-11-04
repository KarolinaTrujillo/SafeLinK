import { Suspense } from "react";
import type { Metadata } from "next";
import ConfigurarEnlaceVista from "@/components/archivos/ConfigurarEnlaceVista";

export const metadata: Metadata = { title: "Compartir enlace | SafeLinK" };

export default function CompartirEnlacePage() {
  return <Suspense fallback={<p>Cargando configuración…</p>}><ConfigurarEnlaceVista /></Suspense>;
}
