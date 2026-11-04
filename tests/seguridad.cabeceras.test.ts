import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import nextConfig from "../next.config";
import { PERMISSIONS_POLICY, cabecerasDeSeguridad, construirCsp, origenDeSupabase } from "@/lib/seguridad/cabeceras";

const SUPABASE = "https://tzjsxzmsvvhxyiooihyq.supabase.co";
const prod = { isDev: false, supabaseUrl: SUPABASE };
const dev = { isDev: true, supabaseUrl: SUPABASE };

const directivas = (csp: string) => new Map(csp.split("; ").map((d) => [d.split(" ")[0], d.split(" ").slice(1)] as const));
const cabecera = (lista: { key: string; value: string }[], nombre: string) => lista.find((c) => c.key === nombre)?.value;

describe("construirCsp (etapa 1: sin nonce, Report-Only)", () => {
  it("producción: directivas esperadas y sin unsafe-eval", () => {
    const d = directivas(construirCsp(prod));
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get("img-src")).toEqual(["'self'", "data:", "blob:"]);
    expect(d.get("font-src")).toEqual(["'self'"]);
    expect(d.get("connect-src")).toEqual(["'self'", SUPABASE]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("base-uri")).toEqual(["'self'"]);
    expect(d.get("form-action")).toEqual(["'self'"]);
    expect(d.get("frame-ancestors")).toEqual(["'none'"]);
    expect(d.get("frame-src")).toEqual(["'none'"]);
    expect(d.get("manifest-src")).toEqual(["'self'"]);
    expect(d.get("worker-src")).toEqual(["'self'"]);
    expect(construirCsp(prod)).not.toContain("unsafe-eval");
    expect(construirCsp(prod)).not.toContain("ws:");
  });

  it("desarrollo: unsafe-eval y websocket local para HMR; el resto igual", () => {
    const d = directivas(construirCsp(dev));
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
    expect(d.get("connect-src")).toEqual(["'self'", SUPABASE, "ws://localhost:*", "ws://127.0.0.1:*"]);
  });

  it("no usa upgrade-insecure-requests ni report-uri/report-to (nada sale a terceros)", () => {
    for (const o of [prod, dev]) {
      const csp = construirCsp(o);
      expect(csp).not.toContain("upgrade-insecure-requests");
      expect(csp).not.toMatch(/report-(?:uri|to)/);
    }
  });

  it("connect-src toma solo el ORIGEN de NEXT_PUBLIC_SUPABASE_URL (ruta y barra final fuera)", () => {
    expect(directivas(construirCsp({ isDev: false, supabaseUrl: `${SUPABASE}/rest/v1/` })).get("connect-src")).toEqual(["'self'", SUPABASE]);
  });

  it("la URL ficticia de la CI es válida; una ausente o inválida deja connect-src en 'self' sin romper", () => {
    expect(directivas(construirCsp({ isDev: false, supabaseUrl: "https://ci-ficticio.supabase.invalid" })).get("connect-src")).toEqual([
      "'self'",
      "https://ci-ficticio.supabase.invalid",
    ]);
    for (const malo of [undefined, "", "no es una url", "javascript:alert(1)", "ftp://x.test"]) {
      expect(directivas(construirCsp({ isDev: false, supabaseUrl: malo })).get("connect-src"), String(malo)).toEqual(["'self'"]);
    }
  });

  it("origenDeSupabase", () => {
    expect(origenDeSupabase(SUPABASE)).toBe(SUPABASE);
    expect(origenDeSupabase("http://localhost:54321")).toBe("http://localhost:54321");
    expect(origenDeSupabase("x")).toBeNull();
  });

  it("es una sola línea sin saltos ni espacios dobles (cabecera HTTP válida)", () => {
    expect(construirCsp(dev)).not.toMatch(/[\n\r]|\s{2,}/);
  });
});

describe("cabecerasDeSeguridad", () => {
  const lista = cabecerasDeSeguridad(prod);

  it("conserva las cuatro de siempre y HSTS sin preload", () => {
    expect(cabecera(lista, "X-Frame-Options")).toBe("DENY");
    expect(cabecera(lista, "X-Content-Type-Options")).toBe("nosniff");
    expect(cabecera(lista, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(cabecera(lista, "Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains");
    expect(cabecera(lista, "Strict-Transport-Security")).not.toContain("preload");
  });

  it("añade COOP, CORP y X-Permitted-Cross-Domain-Policies; no añade COEP", () => {
    expect(cabecera(lista, "Cross-Origin-Opener-Policy")).toBe("same-origin");
    expect(cabecera(lista, "Cross-Origin-Resource-Policy")).toBe("same-origin");
    expect(cabecera(lista, "X-Permitted-Cross-Domain-Policies")).toBe("none");
    expect(cabecera(lista, "Cross-Origin-Embedder-Policy")).toBeUndefined();
  });

  it("Permissions-Policy: sin interest-cohort y con las funciones nuevas cerradas", () => {
    const pp = cabecera(lista, "Permissions-Policy");
    expect(pp).toBe(PERMISSIONS_POLICY);
    expect(pp).not.toContain("interest-cohort");
    for (const f of ["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()", "bluetooth=()", "serial=()", "accelerometer=()", "gyroscope=()", "magnetometer=()", "midi=()", "display-capture=()", "fullscreen=(self)"]) {
      expect(pp, f).toContain(f);
    }
  });

  it("la CSP aplicada sigue siendo solo frame-ancestors; la completa va en Report-Only y es la de construirCsp", () => {
    expect(cabecera(lista, "Content-Security-Policy")).toBe("frame-ancestors 'none'");
    expect(cabecera(lista, "Content-Security-Policy-Report-Only")).toBe(construirCsp(prod));
  });

  it("ninguna clave se repite (Next se queda con la última y se perdería una en silencio)", () => {
    const claves = lista.map((c) => c.key.toLowerCase());
    expect(new Set(claves).size).toBe(claves.length);
  });
});

describe("next.config.ts", () => {
  it("aplica las cabeceras a /:path*, apaga x-powered-by y las toma de cabecerasDeSeguridad", async () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    const reglas = await nextConfig.headers!();
    expect(reglas).toHaveLength(1);
    expect(reglas[0].source).toBe("/:path*");
    const claves = reglas[0].headers.map((h) => h.key);
    expect(claves).toEqual(expect.arrayContaining(["Content-Security-Policy-Report-Only", "Cross-Origin-Opener-Policy", "Permissions-Policy"]));
  });

  it("la CSP completa no se aplica en modo enforced (eso es la etapa 2, con nonce)", () => {
    const fuente = readFileSync(path.resolve(__dirname, "..", "src", "lib", "seguridad", "cabeceras.ts"), "utf8");
    expect(fuente).not.toMatch(/key:\s*"Content-Security-Policy",\s*value:\s*construirCsp/);
  });
});
