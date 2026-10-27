import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { cuerpoDeFuncion, limpiar, primeraSentencia, rutasDeApi } from "./api.guards.analizador";

/**
 * Rutas de escritura contra los guards REALES (no se mockea `@/lib/auth/guard`):
 * solo se simula quién llama (`supabaseServer`) y su perfil (`supabaseAdmin`,
 * tabla `perfiles`). Para cada POST / PUT / PATCH / DELETE de la API:
 *   - sin sesión  -> 401;
 *   - rol comprador (solo lectura) -> 403;
 * y en ambos casos el handler no llega a tocar ninguna tabla de datos.
 *
 * Fuera de alcance: `tiendas` (tiene sus propios tests). `proyeccion` entra con sus guards reales (todas sus rutas son `requirePlanner`).
 * M8 (`/api/flujo` y `/api/compras`): toda escritura exige rol (en `0.13.0` el comprador solo lee; `requireUser` en escrituras llega con M9a).
 */

const estado = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
  rol: "comprador",
  tablasTocadas: [] as string[],
}));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: estado.user } }) } }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      if (tabla !== "perfiles") {
        estado.tablasTocadas.push(tabla);
        throw new Error(`El handler tocó la tabla ${tabla} antes de pasar el guard`);
      }
      const perfil = { id: "u1", email: "c@ejemplo.pe", nombre: "C", rol: estado.rol, activo: true };
      const cadena = { select: () => cadena, eq: () => cadena, maybeSingle: async () => ({ data: perfil, error: null }) };
      return cadena;
    },
    auth: {
      admin: {
        listUsers: async () => {
          estado.tablasTocadas.push("auth.admin");
          throw new Error("El handler llamó a Auth Admin antes de pasar el guard");
        },
      },
    },
  }),
}));

const RAIZ = path.resolve(__dirname, "..");
const API = path.join(RAIZ, "src", "app", "api");
const ESCRITURA = ["POST", "PUT", "PATCH", "DELETE"] as const;
const EXCLUIDAS = /^tiendas\//;
const UUID = "00000000-0000-4000-8000-000000000001";

type Caso = { ruta: string; metodo: (typeof ESCRITURA)[number]; exigeRol: boolean };

/** Todas las escrituras de la API y si su guard exige rol de escritura (no basta con sesión). */
function casos(): Caso[] {
  const salida: Caso[] = [];
  for (const archivo of rutasDeApi(API)) {
    const ruta = path.relative(API, archivo).split(path.sep).join("/");
    if (EXCLUIDAS.test(ruta)) continue;
    const limpio = limpiar(readFileSync(archivo, "utf8"));
    for (const metodo of ESCRITURA) {
      const cuerpo = cuerpoDeFuncion(limpio, metodo);
      if (cuerpo === null) continue;
      const primera = primeraSentencia(cuerpo);
      // `requireUser` solo pide sesión (p. ej. previsualizar): no hay 403 para el comprador. Los delegados de catálogo escriben con guardEscritura.
      const exigeRol = primera.tipo === "delegado" || (primera.tipo === "guard" && primera.guard !== "requireUser");
      salida.push({ ruta, metodo, exigeRol });
    }
  }
  return salida;
}

const CASOS = casos();

async function llamar({ ruta, metodo }: Caso) {
  const modulo = (await import(/* @vite-ignore */ path.join(API, ruta))) as Record<string, (r: NextRequest, c: unknown) => Promise<Response>>;
  const handler = modulo[metodo];
  expect(handler, `${ruta} no exporta ${metodo}`).toBeTypeOf("function");
  const url = `http://localhost/api/${ruta.replace(/\/route\.ts$/, "").replace(/\[\w+\]/g, UUID)}`;
  const peticion = new NextRequest(url, {
    method: metodo,
    ...(metodo === "DELETE" ? {} : { body: "{}", headers: { "content-type": "application/json" } }),
  });
  const ctx = { params: Promise.resolve({ id: UUID, agrupacionId: UUID, recepcionId: UUID }) };
  return handler(peticion, ctx);
}

beforeEach(() => {
  estado.user = null;
  estado.rol = "comprador";
  estado.tablasTocadas = [];
});

describe("rutas de escritura: sesión y rol (guards reales)", () => {
  it("el recorrido encuentra las escrituras de los maestros (y deja fuera tiendas y proyección)", () => {
    expect(CASOS.length).toBeGreaterThan(40);
    expect(CASOS.some((c) => EXCLUIDAS.test(c.ruta))).toBe(false);
    expect(CASOS.some((c) => c.exigeRol)).toBe(true);
  });

  for (const caso of CASOS) {
    const nombre = `${caso.metodo} ${caso.ruta.replace(/\/route\.ts$/, "")}`;

    it(`${nombre}: sin sesión responde 401`, async () => {
      estado.user = null;
      const respuesta = await llamar(caso);
      expect(respuesta.status).toBe(401);
      expect(estado.tablasTocadas).toEqual([]);
    });

    if (caso.exigeRol) {
      it(`${nombre}: el comprador recibe 403`, async () => {
        estado.user = { id: "u1", email: "c@ejemplo.pe" };
        estado.rol = "comprador";
        const respuesta = await llamar(caso);
        expect(respuesta.status).toBe(403);
        expect(estado.tablasTocadas).toEqual([]);
      });
    }
  }
});

describe("M8: las escrituras de /api/flujo y /api/compras exigen rol de escritura (el comprador recibe 403)", () => {
  const m8 = CASOS.filter((c) => /^(flujo|compras)\//.test(c.ruta));

  it("están las seis escrituras de 0.13.0 y ninguna se conforma con tener sesión", () => {
    const nombre = (c: Caso) => `${c.metodo} ${c.ruta.replace(/\/route\.ts$/, "")}`;
    expect(m8.map(nombre).sort()).toEqual(
      [
        "DELETE compras/[id]/recepciones/[recepcionId]",
        "POST compras/[id]/cancelar",
        "POST compras/[id]/recibir",
        "POST compras/importar",
        "POST flujo/conciliacion/aceptar",
        "PUT flujo/parametros",
      ].sort()
    );
    expect(m8.every((c) => c.exigeRol)).toBe(true);
  });
});
