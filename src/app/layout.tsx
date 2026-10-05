import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ERP", template: "%s · ERP" },
  description: "Gestión administrativa y financiera",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Todo se renderiza por petición: la CSP usa un nonce nuevo en cada respuesta.
  await connection();
  return (
    <html lang="es-AR" className="h-full">
      <body className="min-h-full font-sans">{children}</body>
    </html>
  );
}
