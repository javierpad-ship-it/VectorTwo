/**
 * Cabeceras de seguridad de todas las respuestas (`next.config.ts` las aplica a `/:path*`).
 * Funciones puras, sin `server-only` y sin importar nada de la app: las lee
 * `next.config.ts` al arrancar y las prueban los tests.
 *
 * CSP etapa 1 (auditoría de seguridad, S-04): SIN nonce y en modo
 * `Content-Security-Policy-Report-Only`. Limita adónde puede enviar datos una
 * inyección (`connect-src`, `img-src`) y bloquea `object`, `base`, `form-action`
 * e iframes, pero NO frena un script en línea (`'unsafe-inline'`): eso es la
 * etapa 2, con nonce en `src/proxy.ts` y `/login` dinámica. Se mantiene en
 * Report-Only hasta revisar la consola del navegador en el recorrido del hito
 * y entonces se pasa a `Content-Security-Policy`. Sin `report-uri`: no se
 * manda nada a ningún tercero; las violaciones solo se ven en la consola.
 *
 * Guía de Next: node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md
 * («Without Nonces»). No se usa `upgrade-insecure-requests` (rompe subrecursos
 * en `http://localhost`; en producción ya manda HSTS).
 */

export type Cabecera = { key: string; value: string };

export type OpcionesCabeceras = {
  /** `NODE_ENV === "development"`: añade `'unsafe-eval'` (React en desarrollo) y `ws:` (HMR). */
  isDev: boolean;
  /** `NEXT_PUBLIC_SUPABASE_URL`; solo se usa su origen. Si falta o no es una URL, `connect-src` queda en `'self'`. */
  supabaseUrl?: string | undefined;
};

/** Origen (`https://xxx.supabase.co`) de la URL del proyecto, o `null` si no es una URL http(s) válida. */
export function origenDeSupabase(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

/** Valor de la CSP de la etapa 1 (una sola línea, directivas separadas por `; `). */
export function construirCsp({ isDev, supabaseUrl }: OpcionesCabeceras): string {
  const origenSupabase = origenDeSupabase(supabaseUrl);
  const connect = ["'self'", ...(origenSupabase ? [origenSupabase] : []), ...(isDev ? ["ws://localhost:*", "ws://127.0.0.1:*"] : [])];
  const directivas = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connect.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ];
  return directivas.join("; ");
}

/** La app no usa ninguna de estas funciones del navegador; `fullscreen` queda para el propio origen. */
export const PERMISSIONS_POLICY =
  "camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), accelerometer=(), gyroscope=(), magnetometer=(), midi=(), display-capture=(), fullscreen=(self)";

export function cabecerasDeSeguridad(opciones: OpcionesCabeceras): Cabecera[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    // Sin `preload`: es irreversible y no aplica a `*.up.railway.app`; solo con dominio propio ya decidido.
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
    // Esta sí se aplica (anti clickjacking); la completa va aparte, en Report-Only.
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
    { key: "Content-Security-Policy-Report-Only", value: construirCsp(opciones) },
  ];
}
