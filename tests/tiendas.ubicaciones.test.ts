import { describe, expect, it } from "vitest";
import {
  aUbicacionIgnoradaApi,
  indiceUbicacionesIgnoradas,
  rechazoCrearUbicacion,
  sinEfecto,
  tiendaConNombre,
} from "@/lib/tiendas/ubicaciones";
import { resolverTienda } from "@/lib/ventas/resolver";
import { TIENDAS } from "./ventas.fixture";

/** Datos SINTÉTICOS: ninguna ubicación ni tienda real de Lukers. */
const FILAS = [
  { id: "u-1", nombre: "CENTRAL EJEMPLO", nota: "Oficina administrativa, solo stock de muestras", activo: true },
  { id: "u-2", nombre: "ALMACEN EJEMPLO", nota: null, activo: true },
  { id: "u-3", nombre: "BAJA EJEMPLO", nota: null, activo: false },
];

describe("M5c regla 1 · orden de resolución de tienda", () => {
  const ignoradas = indiceUbicacionesIgnoradas(FILAS);

  it("sin tienda con ese nombre: la ubicación ignorada resuelve con id y nota", () => {
    expect(resolverTienda("central ejemplo", TIENDAS, ignoradas)).toEqual({
      valor: "CENTRAL EJEMPLO",
      resultado: "ignorada",
      id: "u-1",
      nota: "Oficina administrativa, solo stock de muestras",
    });
    expect(resolverTienda("ALMACEN EJEMPLO", TIENDAS, ignoradas)).toMatchObject({ resultado: "ignorada", nota: null });
  });

  it("la tienda manda: activa → ok, desactivada → inactiva, por nombre y por código", () => {
    const activa = [...TIENDAS, { ...TIENDAS[0], id: "t-c", codigo: "R777", nombre: "CENTRAL EJEMPLO", activo: true }];
    expect(resolverTienda("central ejemplo", activa, ignoradas)).toMatchObject({ resultado: "ok", id: "t-c" });
    const inactiva = [...TIENDAS, { ...TIENDAS[0], id: "t-c", codigo: "R777", nombre: "CENTRAL EJEMPLO", activo: false }];
    expect(resolverTienda("central ejemplo", inactiva, ignoradas)).toEqual({ valor: "CENTRAL EJEMPLO", resultado: "inactiva" });
    // por código: una tienda R777 gana a una ubicación ignorada llamada "R777"
    const porCodigo = indiceUbicacionesIgnoradas([{ id: "u-9", nombre: "R777", nota: null, activo: true }]);
    expect(resolverTienda("R777", activa, porCodigo)).toMatchObject({ resultado: "ok", id: "t-c" });
  });

  it("sin tienda ni ubicación: desconocida; una fila con activo = false se lee como si no existiera", () => {
    expect(resolverTienda("OTRA UBICACION", TIENDAS, ignoradas)).toEqual({ valor: "OTRA UBICACION", resultado: "desconocida" });
    expect(resolverTienda("BAJA EJEMPLO", TIENDAS, ignoradas)).toEqual({ valor: "BAJA EJEMPLO", resultado: "desconocida" });
  });
});

describe("M5c regla 2 · normalización", () => {
  it("espacios y mayúsculas distintos resuelven a la misma ubicación", () => {
    const ignoradas = indiceUbicacionesIgnoradas(FILAS);
    const a = resolverTienda(" central  ejemplo ", TIENDAS, ignoradas);
    const b = resolverTienda("Central Ejemplo", TIENDAS, ignoradas);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ resultado: "ignorada", id: "u-1" });
  });

  it("el índice normaliza los nombres de filas escritas a mano", () => {
    const indice = indiceUbicacionesIgnoradas([{ id: "u-5", nombre: "  oficina   norte ", nota: null, activo: true }]);
    expect([...indice.keys()]).toEqual(["OFICINA NORTE"]);
  });
});

describe("M5c regla 3 · sin efecto y rechazo al crear", () => {
  const filas = [{ ...TIENDAS[0], id: "t-x", codigo: "R101", nombre: "CENTRAL EJEMPLO" }, TIENDAS[3]];
  const u = (nombre: string) => ({ nombre });

  it("sinEfecto devuelve la tienda (activa o no) con el mismo nombre normalizado o null", () => {
    expect(sinEfecto(u("CENTRAL EJEMPLO"), filas)).toEqual({ tienda_id: "t-x", codigo: "R101", activo: true });
    expect(sinEfecto(u("oficina  central"), filas)).toEqual({ tienda_id: "t-ofi", codigo: "R999", activo: false });
    expect(sinEfecto(u("ALMACEN EJEMPLO"), filas)).toBeNull();
    expect(sinEfecto(u("   "), filas)).toBeNull();
  });

  it("rechazoCrearUbicacion solo si hay tienda con ese nombre, nunca por código", () => {
    expect(rechazoCrearUbicacion("central ejemplo", filas)).toBe(
      "Ya existe la tienda R101 con ese nombre. Si no debe cargarse, desactívala en Tiendas."
    );
    expect(rechazoCrearUbicacion("OFICINA CENTRAL", filas)).toContain("R999");
    expect(rechazoCrearUbicacion("ALMACEN EJEMPLO", filas)).toBeNull();
    // "R101" es un código de tienda, no un nombre: no se rechaza
    expect(rechazoCrearUbicacion("R101", filas)).toBeNull();
    expect(tiendaConNombre("R101", filas)).toBeNull();
  });

  it("aUbicacionIgnoradaApi calcula sin_efecto contra las tiendas; sin tiendas, null", () => {
    const fila = { ...FILAS[0], created_at: "2026-10-12T00:00:00Z", updated_at: "2026-10-12T00:00:00Z" };
    expect(aUbicacionIgnoradaApi(fila).sin_efecto).toBeNull();
    expect(aUbicacionIgnoradaApi(fila, filas)).toMatchObject({ id: "u-1", nombre: "CENTRAL EJEMPLO", sin_efecto: { codigo: "R101" } });
    expect(aUbicacionIgnoradaApi(fila)).not.toHaveProperty("activo");
  });
});
