import { beforeEach, describe, expect, it, vi } from "vitest";
import { estado, reiniciar, type Fila } from "./proyeccion.fake-db";

/**
 * Lectura LIGERA de la cerrada que usa M13 para `aplicable` (`leerParticipacionesDeCerrada`): solo filas base con participaciones,
 * columnas mínimas, de a 1 000, sin filas de tienda. Corre el servicio REAL contra la base falsa de M7; `lecturas` anota cada
 * `select` (tabla y columnas) para probar que no se lee de más.
 */

const lecturas = vi.hoisted(() => [] as { tabla: string; columnas: string }[]);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", async () => {
  const { clienteFalso: c } = await import("./proyeccion.fake-db");
  return {
    supabaseAdmin: () => {
      const cliente = c();
      return {
        ...cliente,
        from: (tabla: string) => {
          const q = cliente.from(tabla);
          const select = q.select.bind(q);
          q.select = (columnas?: string) => {
            lecturas.push({ tabla, columnas: columnas ?? "*" });
            return select(columnas);
          };
          return q;
        },
      };
    },
  };
});

import { leerParticipacionesDeCerrada } from "@/lib/proyeccion/servicio";
import { leerParticipacionesCerrada, nuevaCacheCerrada } from "@/lib/intercompany/servicio";

const P = "00000000-0000-4000-8000-0000000000a1";
const GML_A = "00000000-0000-4000-8000-0000000000b1";
const GML_B = "00000000-0000-4000-8000-0000000000b2";
const TIENDA = "00000000-0000-4000-8000-0000000000c1";
const MARCA_X = "00000000-0000-4000-8000-0000000000d1";

const participaciones = (marca: string) => ({
  periodo_referencia: null,
  por_clave_flujo: [{ clave_flujo: `marca:${marca}`, marca_id: marca, participacion: 1 }],
  por_marca: [{ marca_id: marca, participacion: 1 }],
  por_talla: [],
});

let n = 0;
function fila(extra: Fila): Fila {
  n += 1;
  return { id: `00000000-0000-4000-8000-${String(1000 + n).padStart(12, "0")}`, proyeccion_id: P, clave: `k${String(n).padStart(6, "0")}`, tienda_id: null, gml_id: GML_A, activo: true, participaciones: participaciones(MARCA_X), ...extra };
}
function anio(filaId: string, a: number, activo = true): Fila {
  n += 1;
  return { id: `00000000-0000-4000-8000-${String(900000 + n).padStart(12, "0")}`, fila_id: filaId, anio: a, bloque: "mismas", activo };
}

function sembrar(filas: Fila[], anios: Fila[]) {
  reiniciar();
  n = 0;
  estado.tablas = {
    proyecciones: [{ id: P, anio_en_curso: 2026, nombre: "Cerrada", estado: "cerrada", parametros: {}, activo: true }],
    proyeccion_filas: filas,
    proyeccion_fila_anios: anios,
  };
}

beforeEach(() => {
  lecturas.length = 0;
});

describe("leerParticipacionesDeCerrada", () => {
  it("devuelve solo filas base activas con participaciones y registro activo del año; nunca las de tienda", async () => {
    const base = fila({ gml_id: GML_A });
    const deTienda = fila({ gml_id: GML_A, tienda_id: TIENDA, participaciones: participaciones("00000000-0000-4000-8000-0000000000d9") });
    const inactiva = fila({ gml_id: GML_B, activo: false });
    const sinParticipaciones = fila({ gml_id: GML_B, participaciones: null });
    const sinAnio = fila({ gml_id: GML_B });
    const otroAnio = fila({ gml_id: GML_B });
    sembrar(
      [base, deTienda, inactiva, sinParticipaciones, sinAnio, otroAnio],
      [
        anio(base.id as string, 2026),
        anio(deTienda.id as string, 2026),
        anio(inactiva.id as string, 2026),
        anio(sinParticipaciones.id as string, 2026),
        anio(sinAnio.id as string, 2026, false),
        anio(otroAnio.id as string, 2027),
      ]
    );
    const r = await leerParticipacionesDeCerrada(2026);
    expect(r.respuesta).toBeNull();
    expect(r.data?.cubre).toBe("en_curso");
    expect(r.data?.filas.map((f) => f.gml_id)).toEqual([GML_A]);
    expect(r.data?.filas[0].participaciones.por_marca?.[0].marca_id).toBe(MARCA_X);
  });

  it("lee solo lo necesario: una consulta a las filas con columnas mínimas (sin historico, curva ni años completos) y ninguna a tiendas", async () => {
    const base = fila({});
    sembrar([base], [anio(base.id as string, 2026)]);
    await leerParticipacionesDeCerrada(2026);
    const filas = lecturas.filter((l) => l.tabla === "proyeccion_filas");
    expect(filas).toHaveLength(1);
    expect(filas[0].columnas).toBe("id, gml_id, participaciones, proyeccion_fila_anios(anio, activo)");
    expect(filas[0].columnas).not.toMatch(/historico|curva|composicion|\*/);
    expect(lecturas.map((l) => l.tabla).filter((t) => t !== "proyecciones" && t !== "proyeccion_filas")).toEqual([]);
  });

  it("pagina de a 1 000: 2 350 filas base se leen completas", async () => {
    const filas = Array.from({ length: 2350 }, (_, i) => fila({ gml_id: i % 2 === 0 ? GML_A : GML_B }));
    sembrar(filas, filas.map((f) => anio(f.id as string, 2026)));
    const r = await leerParticipacionesDeCerrada(2026);
    expect(r.data?.filas).toHaveLength(2350);
    expect(lecturas.filter((l) => l.tabla === "proyeccion_filas")).toHaveLength(3);
  });

  it("la cerrada del año anterior cubre el siguiente; sin cerrada, 404 sin_cerrada", async () => {
    const base = fila({});
    sembrar([base], [anio(base.id as string, 2027)]);
    const siguiente = await leerParticipacionesDeCerrada(2027);
    expect(siguiente.data).toMatchObject({ anio_pedido: 2027, cubre: "siguiente" });
    expect(siguiente.data?.filas).toHaveLength(1);
    const sin = await leerParticipacionesDeCerrada(2029);
    expect(sin.respuesta?.status).toBe(404);
  });
});

describe("leerParticipacionesCerrada de M13 (caché por petición)", () => {
  it("con la misma caché lee la cerrada una sola vez; sin cerrada da null; sin caché compartida vuelve a leer", async () => {
    const base = fila({});
    sembrar([base], [anio(base.id as string, 2026)]);
    const cache = nuevaCacheCerrada();
    const a = await leerParticipacionesCerrada(2026, cache);
    const b = await leerParticipacionesCerrada(2026, cache);
    expect(a.data?.filas).toEqual([{ gml_id: GML_A, por_clave_flujo: [{ marca_id: MARCA_X, participacion: 1 }], por_marca: [{ marca_id: MARCA_X, participacion: 1 }] }]);
    expect(b).toBe(a);
    expect(lecturas.filter((l) => l.tabla === "proyeccion_filas")).toHaveLength(1);
    await leerParticipacionesCerrada(2026, nuevaCacheCerrada());
    expect(lecturas.filter((l) => l.tabla === "proyeccion_filas")).toHaveLength(2);
    expect((await leerParticipacionesCerrada(2031, cache)).data).toBeNull();
  });
});

