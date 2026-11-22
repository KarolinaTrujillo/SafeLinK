import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crear cuenta | SafeLinK",
  description: "Crea una cuenta para compartir documentos con control de acceso.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="es"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
