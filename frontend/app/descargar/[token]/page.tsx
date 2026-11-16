import type { Metadata } from "next";
import { Suspense } from "react";
import DescargaVista from "@/components/archivos/DescargaVista";

export const metadata: Metadata = {
  title: "Descarga protegida | SafeLinK",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

async function ContenidoDescarga({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <DescargaVista token={token} />;
}

export default function DescargarPage({ params }: { params: Promise<{ token: string }> }) {
  return <Suspense fallback={<main><p role="status">Cargando descarga protegida…</p></main>}>
    <ContenidoDescarga params={params} />
  </Suspense>;
}
