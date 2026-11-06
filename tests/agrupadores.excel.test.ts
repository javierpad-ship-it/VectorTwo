import { describe, expect, it } from "vitest";
import { COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO, COLUMNAS_FECHA_LINEA_DE_TIEMPO, ENCABEZADOS_LINEA_DE_TIEMPO, hojaAsignaciones, hojaLineaDeTiempo, type CompraParaHojaLineaDeTiempo } from "@/lib/compras/agrupadores/excel";
import { lineaDeTiempo } from "@/lib/compras/agrupadores/hitos";
import { asignacionApiL1Nov, embarqueDetalleApi261101, HOY_F } from "./agrupadores.fixture";
import { ctxF, embarqueDe } from "./agrupadores.fechas.soporte";
import { EMBARQUE_F } from "./agrupadores.fixture";

/** 08b-1b §3.8: la hoja `LINEA_DE_TIEMPO` (F26) y la columna `OC` de `ASIGNACIONES` (F33). Puro. */

const base = ctxF();
const california = { ...embarqueDe(base, EMBARQUE_F.e270401), id: "c0000000-0000-4000-8000-000000000001", codigo: "261201", nombre: "California", origen: "California", fecha_llegada_estimada: "2026-12-15", periodo_llegada: "2026-12", fecha_inicio_operativo_estimada: "2026-12-16", hora_inicio_operativo: "09:22" };
const nuevaYork = { ...embarqueDe(base, EMBARQUE_F.e270601), id: "c0000000-0000-4000-8000-000000000002", codigo: "270101", nombre: "Nueva York", origen: "Nueva York", fecha_llegada_estimada: "2027-01-15", periodo_llegada: "2027-01" };

/** El estado de F15: C-000201 (Proveedor Norte, 500 u) → California; C-000202 (Feria Sur) 250 → California y 250 → Nueva York. */
function comprasF15(): CompraParaHojaLineaDeTiempo[] {
  const t201 = lineaDeTiempo({ fecha_compra: "2026-07-06", entregas: [{ id: "n1", periodo: "2026-12", unidades: 300 }, { id: "n2", periodo: "2026-12", unidades: 200 }] }, [{ entrega_id: "n1", embarque_id: california.id, paquete_id: null, unidades: 300 }, { entrega_id: "n2", embarque_id: california.id, paquete_id: null, unidades: 200 }], [california, nuevaYork], [], HOY_F);
  const t202 = lineaDeTiempo({ fecha_compra: "2026-07-10", entregas: [{ id: "d1", periodo: "2026-12", unidades: 250 }, { id: "d2", periodo: "2027-01", unidades: 250 }] }, [{ entrega_id: "d1", embarque_id: california.id, paquete_id: null, unidades: 250 }, { entrega_id: "d2", embarque_id: nuevaYork.id, paquete_id: null, unidades: 250 }], [california, nuevaYork], [], HOY_F);
  return [
    { numero: "C-000201", numero_oc: "4500012345", proveedor: "Proveedor Norte", viaje_codigo: "261001", linea_de_tiempo: t201 },
    { numero: "C-000202", numero_oc: null, proveedor: "Feria Sur", viaje_codigo: "261001", linea_de_tiempo: t202 },
  ];
}

describe("F26: la hoja LINEA_DE_TIEMPO con el estado de F15", () => {
  const hoja = hojaLineaDeTiempo(comprasF15(), (id) => (id === california.id ? "aduana" : null));
  const col = (n: string) => ENCABEZADOS_LINEA_DE_TIEMPO.indexOf(n as (typeof ENCABEZADOS_LINEA_DE_TIEMPO)[number]);

  it("tiene las 22 columnas de §3.8", () => {
    expect(hoja[0]).toEqual([...ENCABEZADOS_LINEA_DE_TIEMPO]);
    expect(ENCABEZADOS_LINEA_DE_TIEMPO).toHaveLength(22);
    expect(hoja[0].slice(0, 9)).toEqual(["PROVEEDOR", "COMPRA", "OC", "VIAJE", "EMBARQUE", "ORIGEN", "PAQUETE", "UNIDADES", "ORDEN DE COMPRA"]);
  });

  it("una fila por compra y tramo (C-000202 en dos filas), ordenadas por proveedor y compra", () => {
    expect(hoja.slice(1).map((f) => [f[col("PROVEEDOR")], f[col("COMPRA")], f[col("EMBARQUE")], f[col("UNIDADES")]])).toEqual([
      ["Feria Sur", "C-000202", "261201", 250],
      ["Feria Sur", "C-000202", "270101", 250],
      ["Proveedor Norte", "C-000201", "261201", 500],
    ]);
  });

  it("origen, OC, viaje y mes del flujo", () => {
    const [ca, ny, norte] = hoja.slice(1);
    expect(ca[col("ORIGEN")]).toBe("California");
    expect(ny[col("ORIGEN")]).toBe("Nueva York");
    expect(norte[col("OC")]).toBe("4500012345");
    expect(ca[col("OC")]).toBeNull();
    expect(norte[col("VIAJE")]).toBe("261001");
    expect([ca, ny, norte].map((f) => f[col("MES DEL FLUJO")])).toEqual(["2026-12", "2027-01", "2026-12"]);
  });

  it("las fechas van como aaaa-mm-dd (el inicio operativo, con su hora si la tiene) y los estados en texto", () => {
    const [ca, ny] = hoja.slice(1);
    expect(ca[col("ORDEN DE COMPRA")]).toBe("2026-07-10");
    expect(ca[col("INGRESO CD")]).toBe("2026-12-15");
    expect(ca[col("INICIO OPERATIVO")]).toBe("2026-12-16 09:22");
    expect(ny[col("INICIO OPERATIVO")]).toBeNull();
    expect(ca[col("ESTADO ZARPE")]).toBe("Pendiente");
    expect(ca[col("ESTADO INGRESO CD")]).toBe("Previsto");
    expect(ca[col("ESTADO INICIO OPERATIVO")]).toBe("Previsto");
    expect(ca[col("ESTADO INGRESO AL STOCK")]).toBe("Previsto");
    expect(ca[col("INGRESO AL STOCK")]).toBe("2026-12-15");
    expect(ca[col("ÚLTIMA CAUSA")]).toBe("Aduana");
    expect(ny[col("ÚLTIMA CAUSA")]).toBeNull();
    for (const i of COLUMNAS_FECHA_LINEA_DE_TIEMPO) expect(ENCABEZADOS_LINEA_DE_TIEMPO[i]).toMatch(/ORDEN DE COMPRA|^ZARPE$|^ARRIBO$|^INGRESO CD$|INGRESO AL STOCK/);
    expect(ENCABEZADOS_LINEA_DE_TIEMPO[COLUMNA_FECHA_HORA_LINEA_DE_TIEMPO]).toBe("INICIO OPERATIVO");
  });

  it("los tramos «Sin embarque» salen con su orden de compra y todo pendiente", () => {
    const sin = lineaDeTiempo({ fecha_compra: "2026-07-06", entregas: [{ id: "n1", periodo: "2026-12", unidades: 500 }] }, [], [], [], HOY_F);
    const h = hojaLineaDeTiempo([{ numero: "C-000201", numero_oc: null, proveedor: "Proveedor Norte", viaje_codigo: "261001", linea_de_tiempo: sin }]);
    expect(h[1][col("EMBARQUE")]).toBe("Sin embarque");
    expect(h[1][col("ORDEN DE COMPRA")]).toBe("2026-07-06");
    expect(h[1][col("ESTADO ZARPE")]).toBe("Pendiente");
    expect(h[1][col("ESTADO INGRESO AL STOCK")]).toBe("Pendiente");
    expect(h[1][col("INGRESO AL STOCK")]).toBeNull();
    expect(h[1][col("MES DEL FLUJO")]).toBe("2026-12");
  });

  it("los estados de Javier salen en texto de Excel: Ocurrió, Ocurrió sin fecha, Vencido, Por confirmar y No aplica", () => {
    const javier = { ...embarqueDe(base, EMBARQUE_F.eJavier), fecha_inicio_operativo_estimada: "2026-11-05", hora_inicio_operativo: "09:22", hito_confirmado: "inicio_operativo" as const, estado: "en_transito" as const };
    const t = lineaDeTiempo({ fecha_compra: "2026-10-20", entregas: [{ id: "x", periodo: "2026-11", unidades: 10 }] }, [{ entrega_id: "x", embarque_id: javier.id, paquete_id: null, unidades: 10 }], [javier], [], HOY_F);
    const h = hojaLineaDeTiempo([{ numero: "C-000301", numero_oc: null, proveedor: "Taller Lima Centro", viaje_codigo: null, linea_de_tiempo: t }]);
    expect(h[1][col("ESTADO ZARPE")]).toBe("Ocurrió sin fecha");
    expect(h[1][col("ESTADO INGRESO CD")]).toBe("Ocurrió");
    expect(h[1][col("ESTADO INICIO OPERATIVO")]).toBe("Ocurrió");
    expect(h[1][col("ESTADO INGRESO AL STOCK")]).toBe("Por confirmar");
    expect(h[1][col("INICIO OPERATIVO")]).toBe("2026-11-05 09:22");
    const vencido = lineaDeTiempo({ fecha_compra: "2026-10-20", entregas: [{ id: "x", periodo: "2026-11", unidades: 10 }] }, [{ entrega_id: "x", embarque_id: EMBARQUE_F.e261101, paquete_id: null, unidades: 10 }], base.embarques, [], HOY_F);
    expect(hojaLineaDeTiempo([{ numero: "C-1", numero_oc: null, proveedor: "P", viaje_codigo: null, linea_de_tiempo: vencido }])[1][col("ESTADO ARRIBO")]).toBe("Vencido");
    const local = lineaDeTiempo({ fecha_compra: "2026-10-20", entregas: [{ id: "x", periodo: "2026-11", unidades: 10 }] }, [{ entrega_id: "x", embarque_id: EMBARQUE_F.e261101, paquete_id: null, unidades: 10 }], base.embarques.map((e) => (e.id === EMBARQUE_F.e261101 ? { ...e, tipo: "local" as const } : e)), [], HOY_F);
    expect(hojaLineaDeTiempo([{ numero: "C-1", numero_oc: null, proveedor: "P", viaje_codigo: null, linea_de_tiempo: local }])[1][col("ESTADO ARRIBO")]).toBe("No aplica");
  });
});

describe("F33: la hoja ASIGNACIONES lleva la OC junto a la compra", () => {
  it("la columna OC va después de COMPRA y trae el número de OC de la compra (vacío si no tiene)", () => {
    const e = embarqueDetalleApi261101();
    const conOc = { ...e, asignaciones: [{ ...asignacionApiL1Nov(), compra: { ...asignacionApiL1Nov().compra, numero_oc: "4500012345" } }, asignacionApiL1Nov()] };
    const hoja = hojaAsignaciones([conOc]);
    expect(hoja[0].slice(0, 5)).toEqual(["EMBARQUE", "PAQUETE", "COMPRA", "OC", "PROVEEDOR"]);
    expect(hoja[1].slice(2, 5)).toEqual(["C-000101", "4500012345", "Feria Sur"]);
    expect(hoja[2][3]).toBeNull();
    expect(hoja[0]).toHaveLength(hoja[1].length);
  });
});
