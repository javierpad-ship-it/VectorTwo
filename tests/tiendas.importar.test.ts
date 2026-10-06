import { describe, expect, it } from "vitest";
import {
  aplicarPlanTiendas,
  enTandas,
  planificarImportacionTiendas,
  type EstadoImportacionTiendas,
  type TiendaEstado,
} from "@/lib/tiendas/importar";
import type { FilaImportacionTienda, FilaOmitidaTienda, MotivoOmisionTienda } from "@/lib/tiendas/tipos";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";

const HOY = "2026-10-05";

/** Fila del archivo ya mapeada; las columnas sin mapear llegan como "". */
const fila = (
  codigo: string,
  nombre: string,
  resto: Partial<Omit<FilaImportacionTienda, "codigo" | "nombre">> = {}
): FilaImportacionTienda => ({
  codigo,
  nombre,
  tipo: "",
  zona: "",
  razon_social: "",
  fecha_apertura: "",
  fecha_cierre: "",
  venta_esperada: "",
  ...resto,
});

const existente = (codigo: string, nombre: string, extra: Partial<TiendaEstado> = {}): TiendaEstado => ({
  id: `id-${codigo}`,
  codigo,
  nombre,
  tipo: "Tienda",
  zona: null,
  razon_social: null,
  fecha_apertura: null,
  fecha_cierre: null,
  venta_esperada_promedio: null,
  activo: true,
  ...extra,
});

const vacio = (): EstadoImportacionTiendas => ({ tiendas: [] });

/** Entrada esperada en `omitidas`: código y nombre normalizados, el resto tal como vino, más motivo y extras. */
const omitida = (
  f: FilaImportacionTienda,
  numero: number,
  motivo: MotivoOmisionTienda,
  extra: Pick<FilaOmitidaTienda, "detalle" | "fila_original"> = {}
): FilaOmitidaTienda => ({
  fila: numero,
  motivo,
  ...extra,
  ...f,
  codigo: aCodigo(f.codigo),
  nombre: normalizarNombre(f.nombre),
});

// ─── Regla 12 ───

describe("planificarImportacionTiendas · vacíos y totales (regla 12)", () => {
  it("código vacío, nombre vacío y TOTAL se omiten antes que nada y no cuentan como duplicadas", () => {
    const filas = [
      fila("", "LUKERS X"),
      fila("---", "LUKERS Y", { tipo: "deposito" }),
      fila("R401", ""),
      fila("R401", "total"),
      fila("R401", "LUKERS IQUITOS LORES"),
    ];
    const { reporte } = planificarImportacionTiendas(filas, vacio(), HOY);
    expect(reporte.omitidas).toEqual([
      omitida(filas[0], 1, "codigo_vacio"),
      omitida(filas[1], 2, "codigo_vacio", { detalle: "---" }),
      omitida(filas[2], 3, "nombre_vacio"),
      omitida(filas[3], 4, "fila_total"),
    ]);
    expect(reporte.crear).toEqual({ tiendas: 1, centros_distribucion: 0, sin_fecha_apertura: 1 });
    expect(reporte.totales).toEqual({ recibidas: 5, procesadas: 1, omitidas: 4 });
  });
});

// ─── Regla 13 ───

describe("planificarImportacionTiendas · valores inválidos (regla 13)", () => {
  it("tipo, fechas y venta inválidos se omiten con su motivo y el valor original en detalle", () => {
    const filas = [
      fila("R1", "A", { tipo: "deposito" }),
      fila("R2", "B", { fecha_apertura: "31/02/2024" }),
      fila("R3", "C", { fecha_apertura: "01/01/2020", fecha_cierre: "ayer" }),
      fila("R4", "D", { fecha_cierre: "31/12/2026" }),
      fila("R5", "E", { fecha_apertura: "01/06/2026", fecha_cierre: "01/05/2026" }),
      fila("R6", "F", { venta_esperada: "abc" }),
      fila("R7", "G", { venta_esperada: "-5" }),
      fila("RD1", "H", { tipo: "CD", venta_esperada: "1000" }),
    ];
    const { reporte } = planificarImportacionTiendas(filas, vacio(), HOY);
    expect(reporte.omitidas).toEqual([
      omitida(filas[0], 1, "tipo_invalido", { detalle: "deposito" }),
      omitida(filas[1], 2, "fecha_apertura_invalida", { detalle: "31/02/2024" }),
      omitida(filas[2], 3, "fecha_cierre_invalida", { detalle: "ayer" }),
      omitida(filas[3], 4, "cierre_sin_apertura", { detalle: "31/12/2026" }),
      omitida(filas[4], 5, "cierre_antes_de_apertura", { detalle: "apertura 01/06/2026, cierre 01/05/2026" }),
      omitida(filas[5], 6, "venta_invalida", { detalle: "abc" }),
      omitida(filas[6], 7, "venta_invalida", { detalle: "-5" }),
      omitida(filas[7], 8, "venta_en_cd", { detalle: "1000" }),
    ]);
    expect(reporte.crear).toEqual({ tiendas: 0, centros_distribucion: 0, sin_fecha_apertura: 0 });
  });
  it("una fila con todo mal se omite una sola vez, por el primer motivo: tipo → apertura → cierre → coherencia → venta", () => {
    const todoMal = fila("R1", "A", { tipo: "X", fecha_apertura: "99/99/9999", fecha_cierre: "x", venta_esperada: "abc" });
    expect(planificarImportacionTiendas([todoMal], vacio(), HOY).reporte.omitidas.map((o) => o.motivo)).toEqual([
      "tipo_invalido",
    ]);
    const sinTipo = { ...todoMal, tipo: "" };
    expect(planificarImportacionTiendas([sinTipo], vacio(), HOY).reporte.omitidas.map((o) => o.motivo)).toEqual([
      "fecha_apertura_invalida",
    ]);
    const conApertura = { ...sinTipo, fecha_apertura: "01/01/2020" };
    expect(planificarImportacionTiendas([conApertura], vacio(), HOY).reporte.omitidas.map((o) => o.motivo)).toEqual([
      "fecha_cierre_invalida",
    ]);
    const cierreAntes = { ...conApertura, fecha_cierre: "01/01/2019" };
    expect(planificarImportacionTiendas([cierreAntes], vacio(), HOY).reporte.omitidas.map((o) => o.motivo)).toEqual([
      "cierre_antes_de_apertura",
    ]);
    const soloVenta = { ...cierreAntes, fecha_cierre: "" };
    expect(planificarImportacionTiendas([soloVenta], vacio(), HOY).reporte.omitidas.map((o) => o.motivo)).toEqual([
      "venta_invalida",
    ]);
  });
  it("cierre = apertura se acepta; venta se redondea a dos decimales; zona y razón social se normalizan", () => {
    const plan = planificarImportacionTiendas(
      [
        fila("r401", " lukers iquitos ", {
          zona: " lukers  sur oriente ",
          razon_social: "Lukers Oriente SAC",
          fecha_apertura: "15/03/2019",
          fecha_cierre: "15/03/2019",
          venta_esperada: "S/ 12,500.005",
        }),
      ],
      vacio(),
      HOY
    );
    expect(plan.tiendas).toEqual([
      {
        codigo: "R401",
        nombre: "LUKERS IQUITOS",
        tipo: "Tienda",
        zona: "LUKERS SUR ORIENTE",
        razon_social: "LUKERS ORIENTE SAC",
        fecha_apertura: "2019-03-15",
        fecha_cierre: "2019-03-15",
        venta_esperada_promedio: 12500.01,
      },
    ]);
  });
});

// ─── Regla 14 ───

describe("planificarImportacionTiendas · duplicadas y nombres repetidos (regla 14)", () => {
  it("r401 y R401 son la misma; r-401 no; fila_original apunta a la primera y detalle dice en qué difieren", () => {
    const filas = [
      fila("R401", "LUKERS IQUITOS", { zona: "SUR" }),
      fila("r401", "LUKERS IQUITOS", { zona: "SUR" }),
      fila("r-401", "LUKERS IQUITOS 2"),
      fila(" R401 ", "Lukers Iquitos otro", { zona: "NORTE", fecha_apertura: "01/01/2020" }),
    ];
    const { reporte, tiendas } = planificarImportacionTiendas(filas, vacio(), HOY);
    expect(tiendas.map((t) => t.codigo)).toEqual(["R401", "R_401"]);
    expect(reporte.omitidas).toEqual([
      omitida(filas[1], 2, "duplicada_en_archivo", { fila_original: 1 }),
      omitida(filas[3], 4, "duplicada_en_archivo", {
        fila_original: 1,
        detalle: "nombre distinto: LUKERS IQUITOS OTRO; zona distinto: NORTE; apertura distinto: 01/01/2020",
      }),
    ]);
    expect(reporte.totales).toEqual({ recibidas: 4, procesadas: 2, omitidas: 2 });
  });
  it("nombre_repetido: otro código en la base o antes en el archivo ya tiene ese nombre; detalle = ese código", () => {
    const estado: EstadoImportacionTiendas = { tiendas: [existente("R401", "LUKERS IQUITOS LORES")] };
    const filas = [
      fila("R999", "lukers iquitos lores"),
      fila("R500", "LUKERS CENTRAL"),
      fila("R501", "Lukers Central"),
      fila("R401", "LUKERS IQUITOS LORES"),
    ];
    const { reporte, tiendas } = planificarImportacionTiendas(filas, estado, HOY);
    expect(reporte.omitidas).toEqual([
      omitida(filas[0], 1, "nombre_repetido", { detalle: "R401" }),
      omitida(filas[2], 3, "nombre_repetido", { detalle: "R500" }),
    ]);
    expect(tiendas.map((t) => t.codigo)).toEqual(["R500"]);
    expect(reporte.existentes.tiendas).toBe(1);
  });
  it("un código repetido con el mismo nombre es duplicada_en_archivo, no nombre_repetido", () => {
    const { reporte } = planificarImportacionTiendas([fila("R1", "A"), fila("R1", "A")], vacio(), HOY);
    expect(reporte.omitidas.map((o) => o.motivo)).toEqual(["duplicada_en_archivo"]);
  });
});

// ─── Reglas 15 y 16 ───

describe("planificarImportacionTiendas · existentes (regla 15)", () => {
  it("existente activa o inactiva nunca entra en crear; se cuenta y, si difiere, aparece en diferencias legibles (una por campo)", () => {
    const estado: EstadoImportacionTiendas = {
      tiendas: [
        existente("R401", "LUKERS IQUITOS LORES", { zona: "LUKERS SUR ORIENTE", fecha_apertura: "2019-03-15" }),
        existente("R500", "LUKERS CENTRAL", { activo: false, venta_esperada_promedio: 1000 }),
        existente("RD50", "CD LUKERS", { tipo: "Centro de Distribución" }),
      ],
    };
    const filas = [
      fila("r401", "LUKERS IQUITOS", { zona: "LUKERS CENTRO NORTE", fecha_cierre: "31/12/2026", fecha_apertura: "15/03/2019" }),
      fila("R500", "LUKERS CENTRAL", { venta_esperada: "S/ 1,000.00" }),
      fila("RD50", "CD LUKERS", { tipo: "Tienda", razon_social: "Lukers SAC" }),
    ];
    const { reporte, tiendas } = planificarImportacionTiendas(filas, estado, HOY);
    expect(tiendas).toEqual([]);
    expect(reporte.crear).toEqual({ tiendas: 0, centros_distribucion: 0, sin_fecha_apertura: 0 });
    expect(reporte.existentes).toEqual({ tiendas: 2 });
    expect(reporte.existentes_inactivos).toEqual({ tiendas: 1 });
    expect(reporte.diferencias).toEqual([
      { fila: 1, codigo: "R401", campo: "nombre", en_base: "LUKERS IQUITOS LORES", en_archivo: "LUKERS IQUITOS" },
      { fila: 1, codigo: "R401", campo: "zona", en_base: "LUKERS SUR ORIENTE", en_archivo: "LUKERS CENTRO NORTE" },
      { fila: 1, codigo: "R401", campo: "fecha_cierre", en_base: "—", en_archivo: "31/12/2026" },
      { fila: 3, codigo: "RD50", campo: "tipo", en_base: "Centro de Distribución", en_archivo: "Tienda" },
      { fila: 3, codigo: "RD50", campo: "razon_social", en_base: "—", en_archivo: "LUKERS SAC" },
    ]);
    expect(reporte.totales).toEqual({ recibidas: 3, procesadas: 3, omitidas: 0 });
  });
  it("el plan no modifica ni reactiva nada: plan.tiendas nunca contiene activo y aplicar deja las existentes igual", () => {
    const estado: EstadoImportacionTiendas = { tiendas: [existente("R500", "LUKERS CENTRAL", { activo: false, zona: "A" })] };
    const plan = planificarImportacionTiendas([fila("R500", "X", { zona: "B" }), fila("R600", "Y")], estado, HOY);
    for (const t of plan.tiendas) expect("activo" in t).toBe(false);
    const nuevo = aplicarPlanTiendas(estado, plan);
    expect(nuevo.tiendas.find((t) => t.codigo === "R500")).toEqual(estado.tiendas[0]);
    expect(nuevo.tiendas.map((t) => t.codigo)).toEqual(["R500", "R600"]);
    expect(estado.tiendas).toHaveLength(1); // no muta el recibido
  });
});

describe("planificarImportacionTiendas · conteos de crear y muestra (regla 16)", () => {
  it("sin_fecha_apertura solo cuenta tiendas nuevas de tipo Tienda; un CD sin apertura no suma; la muestra lleva el estado a hoy", () => {
    const filas = [
      fila("R401", "LUKERS IQUITOS LORES", { fecha_apertura: "15/03/2019" }),
      fila("R510", "LUKERS CHICLAYO"),
      fila("R512", "LUKERS AREQUIPA", { fecha_apertura: "01/03/2027" }),
      fila("R530", "LUKERS CERRADA", { fecha_apertura: "01/01/2019", fecha_cierre: "01/01/2020" }),
      fila("RD50", "CD LUKERS", { tipo: "CD" }),
    ];
    const { reporte } = planificarImportacionTiendas(filas, vacio(), HOY);
    expect(reporte.crear).toEqual({ tiendas: 4, centros_distribucion: 1, sin_fecha_apertura: 1 });
    expect(reporte.crear.centros_distribucion).toBeLessThanOrEqual(reporte.crear.tiendas + reporte.crear.centros_distribucion);
    expect(reporte.muestra.tiendas).toEqual([
      "R401 · LUKERS IQUITOS LORES · Activa",
      "R510 · LUKERS CHICLAYO · Planificada",
      "R512 · LUKERS AREQUIPA · Planificada",
      "R530 · LUKERS CERRADA · Cerrada",
      "RD50 · CD LUKERS · Planificada",
    ]);
    // Con hoy = 2027-03-01 la de Arequipa ya sale Activa.
    expect(planificarImportacionTiendas(filas, vacio(), "2027-03-01").reporte.muestra.tiendas[2]).toBe(
      "R512 · LUKERS AREQUIPA · Activa"
    );
  });
  it("la muestra se corta en 20", () => {
    const filas = Array.from({ length: 25 }, (_, i) => fila(`R${i}`, `TIENDA ${i}`));
    const { reporte } = planificarImportacionTiendas(filas, vacio(), HOY);
    expect(reporte.crear.tiendas).toBe(25);
    expect(reporte.muestra.tiendas).toHaveLength(20);
  });
});

// ─── Reglas 17 y 18 ───

describe("planificarImportacionTiendas · idempotencia y conteos (reglas 17 y 18)", () => {
  const filas = [
    fila("R401", "LUKERS IQUITOS LORES", { zona: "LUKERS SUR ORIENTE", fecha_apertura: "15/03/2019" }),
    fila("R500", "LUKERS CENTRAL", { tipo: "Tienda", fecha_apertura: "01/06/2010" }),
    fila("R510", "LUKERS CHICLAYO P. RUIZ", { zona: "LUKERS CENTRO NORTE" }),
    fila("R512", "LUKERS AREQUIPA", { fecha_apertura: "01/03/2027", venta_esperada: "S/ 85,000.00" }),
    fila("RD50", "CD LUKERS", { tipo: "CD" }),
    fila("R999", "LUKERS CENTRAL"), // nombre repetido
    fila("r401", "LUKERS IQUITOS LORES", { zona: "LUKERS SUR ORIENTE", fecha_apertura: "15/03/2019" }), // duplicada
    fila("R507", "LUKERS PIURA", { fecha_apertura: "31/02/2024" }), // fecha inválida
    fila("", "SIN CODIGO"),
  ];

  it("reimportar tras aplicar: crear en cero, existentes = lo creado, diferencias vacías, mismas omitidas", () => {
    const estado0: EstadoImportacionTiendas = { tiendas: [existente("R500", "LUKERS CENTRAL", { fecha_apertura: "2010-06-01" })] };
    const plan1 = planificarImportacionTiendas(filas, estado0, HOY);
    expect(plan1.reporte.crear).toEqual({ tiendas: 3, centros_distribucion: 1, sin_fecha_apertura: 1 });
    expect(plan1.reporte.existentes.tiendas).toBe(1);
    expect(plan1.reporte.diferencias).toEqual([]);

    const estado1 = aplicarPlanTiendas(estado0, plan1);
    expect(estado1.tiendas).toHaveLength(5);

    const plan2 = planificarImportacionTiendas(filas, estado1, HOY);
    expect(plan2.reporte.crear).toEqual({ tiendas: 0, centros_distribucion: 0, sin_fecha_apertura: 0 });
    expect(plan2.reporte.existentes.tiendas).toBe(5);
    expect(plan2.reporte.existentes_inactivos.tiendas).toBe(0);
    expect(plan2.reporte.diferencias).toEqual([]);
    expect(plan2.reporte.omitidas).toEqual(plan1.reporte.omitidas);
    expect(plan2.tiendas).toEqual([]);
    expect(plan2.reporte.muestra.tiendas).toEqual([]);

    // Aplicar dos veces el mismo plan produce el mismo estado.
    expect(aplicarPlanTiendas(estado1, plan1)).toEqual(estado1);
    expect(aplicarPlanTiendas(estado1, plan2)).toEqual(estado1);
  });
  it("recibidas = procesadas + omitidas; procesadas = crear + existentes + existentes_inactivos", () => {
    const estado: EstadoImportacionTiendas = {
      tiendas: [existente("R500", "LUKERS CENTRAL", { fecha_apertura: "2010-06-01" }), existente("R510", "VIEJA", { activo: false })],
    };
    const { reporte: r } = planificarImportacionTiendas(filas, estado, HOY);
    expect(r.totales.recibidas).toBe(filas.length);
    expect(r.totales.recibidas).toBe(r.totales.procesadas + r.totales.omitidas);
    expect(r.totales.procesadas).toBe(
      r.crear.tiendas + r.crear.centros_distribucion + r.existentes.tiendas + r.existentes_inactivos.tiendas
    );
    expect(r.existentes_inactivos.tiendas).toBe(1);
    expect(r.diferencias).toEqual([
      { fila: 3, codigo: "R510", campo: "nombre", en_base: "VIEJA", en_archivo: "LUKERS CHICLAYO P. RUIZ" },
      { fila: 3, codigo: "R510", campo: "zona", en_base: "—", en_archivo: "LUKERS CENTRO NORTE" },
    ]);
  });
});

// ─── CSV de ejemplo de la ficha (no son datos reales) ───

describe("CSV de ejemplo de la ficha", () => {
  // Cod.Tda,Tda#,Tienda,Zona,Razon Social,Tipo,Fecha Apertura,Fecha Cierre,Venta Esperada  (Tda# se descarta en el mapeo)
  const csv = [
    fila("R401", "LUKERS IQUITOS LORES", { zona: "LUKERS SUR ORIENTE", razon_social: "LUKERS ORIENTE SAC", fecha_apertura: "15/03/2019" }),
    fila("R500", "LUKERS CENTRAL", { razon_social: "LUKERS SAC", tipo: "Tienda", fecha_apertura: "01/06/2010" }),
    fila("R510", "LUKERS CHICLAYO P. RUIZ", { zona: "LUKERS CENTRO NORTE", razon_social: "LUKERS SAC" }),
    fila("R512", "LUKERS AREQUIPA", { zona: "LUKERS SUR ORIENTE", razon_social: "LUKERS SAC", fecha_apertura: "01/03/2027", venta_esperada: "S/ 85,000.00" }),
    fila("RD50", "CD LUKERS", { razon_social: "LUKERS SAC", tipo: "CD" }),
  ];

  it("entra tal cual: R401 y R500 Activas, R510 sin fecha (Planificada, avisada), R512 Planificada con 85 000, RD50 CD", () => {
    const { reporte, tiendas } = planificarImportacionTiendas(csv, vacio(), HOY);
    expect(reporte.omitidas).toEqual([]);
    expect(reporte.crear).toEqual({ tiendas: 4, centros_distribucion: 1, sin_fecha_apertura: 1 });
    expect(reporte.muestra.tiendas).toEqual([
      "R401 · LUKERS IQUITOS LORES · Activa",
      "R500 · LUKERS CENTRAL · Activa",
      "R510 · LUKERS CHICLAYO P. RUIZ · Planificada",
      "R512 · LUKERS AREQUIPA · Planificada",
      "RD50 · CD LUKERS · Planificada",
    ]);
    expect(tiendas[3]).toEqual({
      codigo: "R512",
      nombre: "LUKERS AREQUIPA",
      tipo: "Tienda",
      zona: "LUKERS SUR ORIENTE",
      razon_social: "LUKERS SAC",
      fecha_apertura: "2027-03-01",
      fecha_cierre: null,
      venta_esperada_promedio: 85000,
    });
    expect(tiendas[4]).toMatchObject({ codigo: "RD50", tipo: "Centro de Distribución", zona: null, venta_esperada_promedio: null });
  });
  it("un archivo con solo CODIGO y NOMBRE: todas entran como Tienda sin fechas y quedan Planificadas", () => {
    const { reporte, tiendas } = planificarImportacionTiendas([fila("R1", "A"), fila("R2", "B")], vacio(), HOY);
    expect(reporte.crear).toEqual({ tiendas: 2, centros_distribucion: 0, sin_fecha_apertura: 2 });
    expect(tiendas.every((t) => t.tipo === "Tienda" && t.fecha_apertura === null)).toBe(true);
  });
});

describe("enTandas", () => {
  it("parte en tandas de 500", () => {
    const tandas = enTandas(Array.from({ length: 1001 }, (_, i) => i));
    expect(tandas.map((t) => t.length)).toEqual([500, 500, 1]);
  });
});
