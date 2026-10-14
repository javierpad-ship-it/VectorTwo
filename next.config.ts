import type { NextConfig } from "next";

/**
 * Cabeceras de seguridad para todas las rutas.
 *
 * El `Content-Security-Policy` lleva solo `frame-ancestors 'none'` (anti
 * clickjacking, equivale a `X-Frame-Options: DENY` en navegadores modernos).
 * Una CSP completa con `script-src` exige nonces para los scripts en línea de
 * Next.js, lo que obliga a renderizado dinámico en cada página; se deja para
 * una fase posterior (ver node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 */
const cabecerasDeSeguridad = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), interest-cohort=()",
  },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: cabecerasDeSeguridad }];
  },
};

export default nextConfig;
