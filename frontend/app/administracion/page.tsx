import type { Metadata } from "next";
import AdministracionVista from "@/components/admin/AdministracionVista";

export const metadata: Metadata = { title: "Administración | SafeLinK", robots: { index: false, follow: false } };

export default function AdministracionPage() {
  return <AdministracionVista />;
}
