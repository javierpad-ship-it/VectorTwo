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

/** Las rutas de los agrupadores de compras (ficha 08b): el comprador las escribe, salvo cerrar, reabrir y cancelar. */
const esDeAgrupadores = (ruta: string) => /^compras\/(viajes|embarques|paquetes|agrupadores|viaje-activo)\//.test(ruta);
const nombreDe = (c: Caso) => `${c.metodo} ${c.ruta.replace(/\/route\.ts$/, "")}`;

describe("M8: las escrituras de /api/flujo y /api/compras exigen rol de escritura (el comprador recibe 403)", () => {
  const m8 = CASOS.filter((c) => /^(flujo|compras)\//.test(c.ruta) && !esDeAgrupadores(c.ruta));

  it("están las seis escrituras de 0.13.0; todas exigen rol salvo importar, que decide el rol dentro (requireUser + puedeImportar)", () => {
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
    expect(m8.filter((c) => !c.exigeRol).map(nombre)).toEqual(["POST compras/importar"]);
  });

  it("POST compras/importar: el comprador pasa el guard (el rol lo decide puedeImportar con el cuerpo), sin sesión 401, y no toca datos antes de leer el cuerpo", async () => {
    const caso = CASOS.find((c) => c.ruta === "compras/importar/route.ts" && c.metodo === "POST");
    expect(caso).toBeDefined();
    if (!caso) return;
    estado.user = { id: "u1", email: "c@ejemplo.pe" };
    for (const rol of ["comprador", "planner", "admin"]) {
      estado.rol = rol;
      // cuerpo vacío: pasa el guard y se frena en la validación del cuerpo (400), nunca en un 403 de rol
      const respuesta = await llamar(caso);
      expect(respuesta.status, rol).toBe(400);
      expect(estado.tablasTocadas).toEqual([]);
    }
  });
});

describe("08b: agrupadores de compras (decisiones 92 y 95): el comprador escribe; solo cerrar, reabrir y cancelar son de admin y planner", () => {
  const agr = CASOS.filter((c) => esDeAgrupadores(c.ruta));

  it("están las dieciocho escrituras de 08b-1", () => {
    expect(agr.map(nombreDe).sort()).toEqual(
      [
        "POST compras/viajes",
        "PATCH compras/viajes/[id]",
        "POST compras/viajes/[id]/estado",
        "POST compras/viajes/[id]/compras",
        "POST compras/embarques",
        "PATCH compras/embarques/[id]",
        "POST compras/embarques/[id]/estado",
        "POST compras/embarques/[id]/paquetes",
        "POST compras/embarques/[id]/asignar",
        "POST compras/embarques/[id]/quitar",
        "POST compras/embarques/[id]/paquete",
        "POST compras/embarques/[id]/fecha",
        "POST compras/embarques/[id]/pasar-pendientes",
        "PATCH compras/paquetes/[id]",
        "POST compras/paquetes/[id]/estado",
        "POST compras/paquetes/[id]/mover",
        "POST compras/agrupadores/importar",
        "PUT compras/viaje-activo",
      ].sort(),
    );
  });

  it("solo exigen rol de planner el estado del viaje y el del paquete (la acción de estado de un embarque se decide con el cuerpo: el comprador recibe 403 al cancelar)", () => {
    expect(agr.filter((c) => c.exigeRol).map(nombreDe).sort()).toEqual(["POST compras/paquetes/[id]/estado", "POST compras/viajes/[id]/estado"].sort());
  });
});

/**
 * 07f: «Ver por tienda» (`GET …/crecimientos/por-tienda`) es una LECTURA con `requireUser`: los tres roles la ven (el comprador ve venta y stock, decisión 99) y sin sesión
 * recibe 401. Aquí van los guards REALES: pasar el guard no toca ninguna tabla de datos; sin `gm` el handler responde 400 antes de leer nada.
 */
describe("07f: GET …/crecimientos/por-tienda (guard requireUser real)", () => {
  const RUTA = "proyeccion/proyecciones/[id]/crecimientos/por-tienda/route.ts";
  const consultar = async (consulta = "") => {
    const modulo = (await import(/* @vite-ignore */ path.join(API, RUTA))) as { GET: (r: NextRequest, c: unknown) => Promise<Response> };
    const url = `http://localhost/api/${RUTA.replace(/\/route\.ts$/, "").replace(/\[\w+\]/g, UUID)}${consulta}`;
    return modulo.GET(new NextRequest(url), { params: Promise.resolve({ id: UUID }) });
  };

  it("abre con requireUser como primera sentencia", () => {
    const cuerpo = cuerpoDeFuncion(limpiar(readFileSync(path.join(API, RUTA), "utf8")), "GET");
    expect(cuerpo).not.toBeNull();
    expect(primeraSentencia(cuerpo ?? "")).toMatchObject({ tipo: "guard", guard: "requireUser" });
  });

  it("sin sesión responde 401 y no toca ninguna tabla de datos", async () => {
    estado.user = null;
    expect((await consultar(`?gm=resto`)).status).toBe(401);
    expect(estado.tablasTocadas).toEqual([]);
  });

  it("admin, planner y comprador pasan el guard (nunca 401 ni 403): sin gm, 400 antes de leer datos", async () => {
    estado.user = { id: "u1", email: "c@ejemplo.pe" };
    for (const rol of ["admin", "planner", "comprador"]) {
      estado.rol = rol;
      const respuesta = await consultar();
      expect(respuesta.status, rol).toBe(400);
      expect(estado.tablasTocadas, rol).toEqual([]);
    }
  });
});
