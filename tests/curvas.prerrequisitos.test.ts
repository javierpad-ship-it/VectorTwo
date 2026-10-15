import { describe, expect, it } from "vitest";
import { armarPrerrequisitosGlobales, bloqueadaPor, prerrequisitosAgrupacion, tiendasSinApertura, type EntradaPrerrequisitos } from "@/lib/curvas/prerrequisitos";
import { ventaPorTienda } from "@/lib/curvas/entrada";
import { prepararTrabajo } from "@/lib/curvas/trabajo";
import { ABRIGO_ID, CONSTANTE_ID, PEQUENA_ID, PERIODOS_NINO, PUBLICADOS, T4, T1, VERANO_ID, filasFixture, insumosFixture, parametros, tiendasFixture } from "./curvas.fixture";

const venta = ventaPorTienda(filasFixture("base"));
const entrada = (extra: Partial<EntradaPrerrequisitos> = {}): EntradaPrerrequisitos => ({
  agrupacion: { id: ABRIGO_ID, nombre: "ABRIGO", activo: true, temporada: "invierno", equivalencias_activas: 10 },
  versiones: 0,
  parametros: parametros(),
  meses_publicados: PUBLICADOS,
  hasta_periodo: "2026-09",
  periodos: PERIODOS_NINO,
  tiendas: tiendasFixture(),
  venta_tienda: venta,
  entrada: null,
  ...extra,
});
const codigos = (r: { bloquea: { codigo: string }[]; avisa: { codigo: string }[] }) => ({ bloquea: r.bloquea.map((p) => p.codigo), avisa: r.avisa.map((p) => p.codigo) });

describe("regla 32 · prerrequisitosAgrupacion", () => {
  it("con todo en orden: nada bloquea (y el periodo que llega hasta 2026-12 avisa que es futuro)", () => {
    const r = codigos(prerrequisitosAgrupacion(entrada()));
    expect(r.bloquea).toEqual([]);
    expect(r.avisa).toEqual(["periodo_fuera_de_datos"]);
  });
  it("sin periodos: ABRIGO (invierno) bloquea; con sin_periodos_confirmado pasa a avisa; PEQUEÑA (toda temporada) no bloquea", () => {
    expect(codigos(prerrequisitosAgrupacion(entrada({ periodos: [] }))).bloquea).toEqual(["periodos_temporada_faltantes"]);
    const conf = codigos(prerrequisitosAgrupacion(entrada({ periodos: [], parametros: parametros({ sin_periodos_confirmado: true }) })));
    expect(conf.bloquea).toEqual([]);
    expect(conf.avisa).toContain("periodos_temporada_faltantes");
    const todo = prerrequisitosAgrupacion(entrada({ periodos: [], agrupacion: { id: PEQUENA_ID, nombre: "P", activo: true, temporada: "todo_el_ano", equivalencias_activas: 3 } }));
    expect(todo.bloquea).toEqual([]);
  });
  it("una tienda con venta y sin apertura bloquea con enlace a la fila; sin venta o sin tipo Tienda, no", () => {
    const sinFecha = tiendasFixture().map((t) => (t.id === T4 ? { ...t, fecha_apertura: null } : t));
    const r = prerrequisitosAgrupacion(entrada({ tiendas: sinFecha }));
    expect(r.bloquea).toHaveLength(1);
    expect(r.bloquea[0]).toMatchObject({ codigo: "tienda_sin_apertura", enlace: { pantalla: "tiendas", id: T4 } });
    expect(r.bloquea[0].detalle).toContain("T4");
    // sin venta: no bloquea
    expect(tiendasSinApertura(sinFecha, venta.filter((v) => v.tienda_id !== T4), "2026-09", { solo_tiendas_completas: true })).toEqual([]);
    // el centro de distribución sin fecha no cuenta
    const cd = tiendasFixture().map((t) => (t.id === "cd" ? { ...t, fecha_apertura: null } : t));
    expect(tiendasSinApertura(cd, [...venta, { tienda_id: "cd", periodo: "2024-01", unidades: 5 }], "2026-09", { solo_tiendas_completas: true })).toEqual([]);
    // con solo_tiendas_completas apagado las fechas no se miran, y una tienda excluida a mano no cuenta
    expect(tiendasSinApertura(sinFecha, venta, "2026-09", { solo_tiendas_completas: false })).toEqual([]);
    expect(tiendasSinApertura(sinFecha, venta, "2026-09", { solo_tiendas_completas: true, excluidas: [T4] })).toEqual([]);
  });
  it("sin ningún año con 12 meses publicados → sin_anio_completo con los meses que faltan", () => {
    const publicados = PUBLICADOS.filter((m) => m >= "2025-01" && m !== "2025-05");
    const r = prerrequisitosAgrupacion(entrada({ meses_publicados: publicados }));
    expect(codigos(r).bloquea).toEqual(["sin_anio_completo"]);
    expect(r.bloquea[0].detalle).toContain("2025-05");
  });
  it("0 equivalencias → composicion_vacia; sin meses publicados → sin_meses_publicados", () => {
    expect(codigos(prerrequisitosAgrupacion(entrada({ agrupacion: { id: "x", nombre: "X", activo: true, temporada: "todo_el_ano", equivalencias_activas: 0 } }))).bloquea).toEqual(["composicion_vacia"]);
    expect(codigos(prerrequisitosAgrupacion(entrada({ meses_publicados: [], hasta_periodo: null }))).bloquea).toEqual(["sin_meses_publicados"]);
    expect(codigos(prerrequisitosAgrupacion(entrada({ hasta_periodo: null }))).bloquea).toEqual(["sin_meses_publicados"]);
  });
  it("temporada_sin_confirmar avisa solo en toda temporada sin versiones", () => {
    const todo = { id: CONSTANTE_ID, nombre: "C", activo: true, temporada: "todo_el_ano" as const, equivalencias_activas: 3 };
    expect(codigos(prerrequisitosAgrupacion(entrada({ agrupacion: todo }))).avisa).toContain("temporada_sin_confirmar");
    expect(codigos(prerrequisitosAgrupacion(entrada({ agrupacion: todo, versiones: 1 }))).avisa).not.toContain("temporada_sin_confirmar");
    expect(codigos(prerrequisitosAgrupacion(entrada())).avisa).not.toContain("temporada_sin_confirmar");
  });
  it("huecos en la serie → meses_sin_cargar con la lista", () => {
    const r = prerrequisitosAgrupacion(entrada({ meses_publicados: PUBLICADOS.filter((m) => m !== "2024-05") }));
    const p = r.avisa.find((x) => x.codigo === "meses_sin_cargar")!;
    expect(p.detalle).toContain("2024-05");
    expect(p.enlace).toEqual({ pantalla: "venta_stock" });
  });
  it("con la entrada armada: sin_venta bloquea; apertura_dudosa avisa", () => {
    const t = prepararTrabajo(insumosFixture(ABRIGO_ID), parametros(), undefined).trabajo!;
    expect(codigos(prerrequisitosAgrupacion(entrada({ entrada: t.entrada }))).bloquea).toEqual([]);
    const sin = { ...t.entrada!, agrupaciones: t.entrada!.agrupaciones.map((a) => ({ ...a, sin_venta: true })) };
    expect(codigos(prerrequisitosAgrupacion(entrada({ entrada: sin }))).bloquea).toEqual(["sin_venta"]);
    const dudosa = {
      ...t.entrada!,
      redes: t.entrada!.redes.map((r) => ({ ...r, tiendas: r.tiendas.map((x) => (x.tienda_id === T1 ? { ...x, motivos: [...x.motivos, "apertura_dudosa" as const] } : x)) })),
    };
    const a = prerrequisitosAgrupacion(entrada({ entrada: dudosa })).avisa.find((x) => x.codigo === "apertura_dudosa")!;
    expect(a.detalle).toContain("T1");
    expect(a.enlace).toEqual({ pantalla: "tiendas", id: T1 });
  });
  it("el orden de bloquea es estable: meses, año completo, periodos, tiendas, composición, venta", () => {
    const sinFecha = tiendasFixture().map((t) => (t.id === T4 || t.id === T1 ? { ...t, fecha_apertura: null } : t));
    const r = prerrequisitosAgrupacion(entrada({ periodos: [], tiendas: sinFecha, agrupacion: { id: ABRIGO_ID, nombre: "A", activo: true, temporada: "invierno", equivalencias_activas: 0 } }));
    expect(codigos(r).bloquea).toEqual(["periodos_temporada_faltantes", "tienda_sin_apertura", "tienda_sin_apertura", "composicion_vacia"]);
    expect(r.bloquea.filter((p) => p.codigo === "tienda_sin_apertura").map((p) => p.enlace?.id)).toEqual([T1, T4]);
  });
});

describe("regla 33 · globales y bloqueada_por", () => {
  it("bloqueada_por solo contiene lo evaluable sin calcular", () => {
    const sinFecha = tiendasFixture().map((t) => (t.id === T4 ? { ...t, fecha_apertura: null } : t));
    const { entrada: _e, ...e } = entrada({ periodos: [], tiendas: sinFecha, meses_publicados: PUBLICADOS.filter((m) => m >= "2025-01" && m !== "2025-05") });
    void _e;
    // sin_anio_completo se sabe, pero la lista no lo pone por fila.
    expect(bloqueadaPor(e)).toEqual(["periodos_temporada_faltantes", "tienda_sin_apertura"]);
  });
  it("los globales son la unión de los que no dependen de la agrupación", () => {
    const sinFecha = tiendasFixture().map((t) => (t.id === T4 ? { ...t, fecha_apertura: null } : t));
    const g = armarPrerrequisitosGlobales({
      meses_publicados: PUBLICADOS.filter((m) => m !== "2025-11"),
      hasta_periodo: "2026-09",
      periodos: [],
      agrupaciones: [{ id: "a", temporada: "invierno" }, { id: "b", temporada: "invierno" }, { id: "c", temporada: "verano" }, { id: "d", temporada: "todo_el_ano" }],
      tiendas: sinFecha,
      venta_tienda: venta,
    });
    expect(g.map((p) => p.codigo)).toEqual(["periodos_temporada_faltantes", "tienda_sin_apertura", "meses_sin_cargar"]);
    expect(g[0].detalle).toContain("invierno (2 agrupaciones) ni verano (1 agrupación)");
    expect(g[2].detalle).toBe("Falta cargar 2025-11.");
    expect(VERANO_ID).toBeTruthy();
  });
});
