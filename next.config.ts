import type { NextConfig } from "next";
import { cabecerasDeSeguridad } from "./src/lib/seguridad/cabeceras";

/**
 * Cabeceras de seguridad para todas las rutas (`/:path*`, también `/api` y los
 * estáticos). Su definición y el porqué de cada una viven en
 * `src/lib/seguridad/cabeceras.ts`. Hoy: `frame-ancestors 'none'` aplicado y la
 * CSP completa (sin nonce) en `Content-Security-Policy-Report-Only`; la etapa 2
 * (nonce en `src/proxy.ts`, `/login` dinámica) está en `docs/seguridad/`.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: cabecerasDeSeguridad({
          isDev: process.env.NODE_ENV === "development",
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
        }),
      },
    ];
  },
};

export default nextConfig;
