import { describe, expect, it } from "vitest";
import { compraApiC09Vencida, compraApiC12, compraApiC12Parcial, compraApiC12SaldoCerrado, comprasApiEjemplo } from "./compras.fixture";
import { flujoEjemplo, huecosEjemplo } from "./flujo.fixture";
import { fechaHora, fechaLima, imi, mesActualLima, mesCorto, mesesEntre, mesLargo, sumarMes, ultimoDiaDelMes, unidades } from "../src/components/compras/formato";
import {
  alcanceEfectivo,
  consultaHuecos,
  contarPorEstado,
  filtrarTarjetas,
  fraseTarjeta,
  leerParametrosHuecos,
  opcionesHuecos,
  PARAMETROS_HUECOS_VACIOS,
  rotuloSaldo,
} from "../src/components/compras/vista-huecos";
import {
  consultaFlujo,
  diferenciaConciliacion,
  filasDeLista,
  filtrarPorTexto,
  filtrosConciliacion,
  filtrosFlujo,
  leerParametrosFlujo,
  mesesConciliables,
  nodosDeArbol,
  opcionesArbol,
  CODIGOS_QUE_PIDEN_RECARGA,
  filtroExcelFlujo,
  ordenarLista,
  PARAMETROS_FLUJO_VACIOS,
  totalesPorGrupo,
  type FilaDeLista,
} from "../src/components/compras/vista-flujo";
import {
  consultaCompras,
  estadoCompra,
  fechaPorDefectoIngreso,
  filtrarCompras,
  filtrosCompras,
  hayFiltrosCompras,
  leerParametrosCompras,
  mesesParaIngreso,
  mesPorDefectoIngreso,
  PARAMETROS_COMPRAS_VACIOS,
  resumenIngreso,
  textoConfirmarCancelar,
  textoConfirmarQuitar,
  unidadesConfirmables,
  unidadesPorConfirmar,
} from "../src/components/compras/vista-compras";
import { urlCompra, urlCompras } from "../src/lib/compras/use-compras";
import { urlConciliacion, urlFila, urlFlujo, urlHuecos } from "../src/lib/flujo/use-flujo";

const lector = (q: string) => {
  const p = new URLSearchParams(q);
  return (k: string) => p.get(k);
};
const UUID = "d0000000-0000-4000-8000-000000000006";
const UUID2 = "90000000-0000-4000-8000-000000000001";

describe("formato", () => {
  it("meses: corto, largo, suma, rango y último día", () => {
    expect(mesCorto("2026-10")).toBe("oct-26");
    expect(mesLargo("2026-09")).toBe("set-2026");
    expect(sumarMes("2026-11", 3)).toBe("2027-02");
    expect(sumarMes("2026-01", -2)).toBe("2025-11");
    expect(mesesEntre("2026-11", "2027-01")).toEqual(["2026-11", "2026-12", "2027-01"]);
    expect(mesesEntre("2027-01", "2026-01")).toEqual([]);
    expect(ultimoDiaDelMes("2026-02")).toBe("2026-02-28");
    expect(ultimoDiaDelMes("2028-02")).toBe("2028-02-29");
  });

  it("el mes en curso es el de Lima, no el de UTC (la medianoche de Lima son las 05:00 UTC)", () => {
    expect(mesActualLima(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10");
    expect(fechaLima(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10-31");
    expect(mesActualLima(new Date("2026-11-01T06:00:00Z"))).toBe("2026-11");
    expect(fechaHora("2026-10-14T15:02:00.000Z")).toBe("2026-10-14 10:02");
  });

  it("unidades enteras con miles, IMI con un decimal y guion si no hay", () => {
    expect(unidades(1127.4)).toBe("1,127");
    expect(unidades(-0.2)).toBe("0");
    expect(imi(4.44)).toBe("4.4");
    expect(imi(null)).toBe("—");
  });
});

describe("URLs de las lecturas (contratos de T0)", () => {
  it("flujo, huecos, fila, conciliación y compras: solo viajan los filtros con valor", () => {
    expect(urlFlujo({})).toBe("/api/flujo");
    expect(urlFlujo({ genero_id: UUID, solo: "falta", mio: true })).toBe(`/api/flujo?genero_id=${UUID}&solo=falta&mio=1`);
    expect(urlFlujo({ mio: false })).toBe("/api/flujo");
    expect(urlHuecos()).toBe("/api/flujo/huecos");
    expect(urlHuecos(3)).toBe("/api/flujo/huecos?meses=3");
    expect(urlFila({ gml_id: UUID, equivalencia_id: null, agrupacion_marca_id: UUID2 })).toBe(`/api/flujo/fila?gml_id=${UUID}&agrupacion_marca_id=${UUID2}`);
    expect(urlConciliacion({ periodo: "2026-09", solo: "por_confirmar" })).toBe("/api/flujo/conciliacion?periodo=2026-09&solo=por_confirmar");
    expect(urlCompras()).toBe("/api/compras");
    expect(urlCompras({ estado: "confirmada", por_confirmar: true })).toBe("/api/compras?estado=confirmada&por_confirmar=1");
    expect(urlCompra("x")).toBe("/api/compras/x");
  });
});

describe("Huecos: parámetros, filtros y textos", () => {
  const huecos = huecosEjemplo();
  const ts = huecos.tarjetas;

  it("la URL se lee y se escribe sin perder nada; lo desconocido se ignora", () => {
    const p = leerParametrosHuecos(lector("alcance=mias&estado=falta&meses=9&genero=HOMBRE&mundo=URBANO&linea=DENIM&agrupacion=RECONOCIDO"));
    expect(p).toEqual({ alcance: "mias", estado: "falta", meses: 9, genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", agrupacion: "RECONOCIDO" });
    expect(leerParametrosHuecos(lector(consultaHuecos(p)))).toEqual(p);
    expect(consultaHuecos(PARAMETROS_HUECOS_VACIOS)).toBe("");
    expect(leerParametrosHuecos(lector("alcance=otros&estado=x&meses=99&genero="))).toEqual(PARAMETROS_HUECOS_VACIOS);
  });

  it("el comprador con combinaciones abre en «Mis líneas»; el planner y el comprador sin combinaciones, en «Todas»; la URL manda", () => {
    expect(alcanceEfectivo(PARAMETROS_HUECOS_VACIOS, "comprador", 2)).toBe("mias");
    expect(alcanceEfectivo(PARAMETROS_HUECOS_VACIOS, "comprador", 0)).toBe("todas");
    expect(alcanceEfectivo(PARAMETROS_HUECOS_VACIOS, "planner", 2)).toBe("todas");
    expect(alcanceEfectivo(PARAMETROS_HUECOS_VACIOS, "admin", 2)).toBe("todas");
    expect(alcanceEfectivo({ ...PARAMETROS_HUECOS_VACIOS, alcance: "todas" }, "comprador", 2)).toBe("todas");
    expect(alcanceEfectivo({ ...PARAMETROS_HUECOS_VACIOS, alcance: "mias" }, "planner", 0)).toBe("mias");
  });

  it("«Mis líneas» deja las que tienen `mia`; «Falta» incluye el quiebre; «Por confirmar» usa las unidades por confirmar", () => {
    const mias = filtrarTarjetas(ts, PARAMETROS_HUECOS_VACIOS, "mias");
    expect(mias.length).toBeGreaterThan(0);
    expect(mias.every((t) => t.mia)).toBe(true);
    expect(filtrarTarjetas(ts, PARAMETROS_HUECOS_VACIOS, "todas")).toHaveLength(ts.length);
    const falta = filtrarTarjetas(ts, { ...PARAMETROS_HUECOS_VACIOS, estado: "falta" }, "todas");
    expect(falta.every((t) => t.resumen.senal === "falta" || t.resumen.senal === "quiebre")).toBe(true);
    const quiebre = { ...ts[0], resumen: { ...ts[0].resumen, senal: "quiebre" as const } };
    expect(filtrarTarjetas([quiebre], { ...PARAMETROS_HUECOS_VACIOS, estado: "falta" }, "todas")).toHaveLength(1);
    expect(filtrarTarjetas([quiebre], { ...PARAMETROS_HUECOS_VACIOS, estado: "exceso" }, "todas")).toHaveLength(0);
    const por = filtrarTarjetas(ts, { ...PARAMETROS_HUECOS_VACIOS, estado: "por_confirmar" }, "todas");
    expect(por.every((t) => t.resumen.por_confirmar > 0)).toBe(true);
  });

  it("los conteos de los chips respetan el alcance y los selectores, pero no el estado", () => {
    const c = contarPorEstado(ts, { ...PARAMETROS_HUECOS_VACIOS, estado: "falta" }, "todas");
    expect(c.todos).toBe(ts.length);
    expect(c.falta + c.exceso).toBeLessThanOrEqual(c.todos);
    const soloDenim = contarPorEstado(ts, { ...PARAMETROS_HUECOS_VACIOS, linea: "DENIM" }, "todas");
    expect(soloDenim.todos).toBe(ts.filter((t) => t.linea === "DENIM").length);
  });

  it("las opciones se encadenan: los mundos del género elegido y las líneas de ese género y mundo", () => {
    const todos = opcionesHuecos(ts, { genero: null, mundo: null });
    expect(todos.generos.length).toBeGreaterThan(1);
    const hombre = opcionesHuecos(ts, { genero: "HOMBRE", mundo: null });
    expect(hombre.mundos).toEqual([...new Set(ts.filter((t) => t.genero === "HOMBRE").map((t) => t.mundo))].sort((a, b) => a.localeCompare(b, "es")));
    expect(hombre.lineas.length).toBeGreaterThanOrEqual(opcionesHuecos(ts, { genero: "HOMBRE", mundo: "URBANO" }).lineas.length);
  });

  it("el rótulo del saldo cubre del primer mes al N-ésimo y la frase dice lo que falta, lo que sobra o por qué no hay cifras", () => {
    expect(rotuloSaldo(huecos.datos.periodos, 6)).toBe("Saldo oct–mar");
    expect(rotuloSaldo(huecos.datos.periodos, 1)).toBe("Saldo oct");
    expect(rotuloSaldo(huecos.datos.periodos, 99)).toMatch(/^Saldo oct–/);
    expect(rotuloSaldo([], 6)).toBe("Saldo por comprar");
    const denim = ts.find((t) => t.linea === "DENIM")!;
    expect(fraseTarjeta(denim, 6)).toBe("falta en oct (83) y desde feb");
    const exceso = { ...denim, resumen: { ...denim.resumen, senal: "exceso" as const, exceso_desde: "2026-11" }, detalle: { ...denim.detalle, exceso_primer_mes: 1127 } };
    expect(fraseTarjeta(exceso, 6)).toBe("exceso desde nov: 1,127 u");
    expect(fraseTarjeta({ ...denim, resumen: { ...denim.resumen, senal: "al_dia" } }, 6)).toContain("Sin faltas en los próximos 6 meses");
    expect(fraseTarjeta({ ...denim, resumen: { ...denim.resumen, senal: "sin_curva" } }, 6)).toContain("sin repartir por mes");
    expect(fraseTarjeta({ ...denim, resumen: { ...denim.resumen, senal: "quiebre" } }, 6)).toContain("quiebre");
  });
});

describe("Flujo: parámetros, filtros, lista y conciliación", () => {
  it("la URL guarda pestaña, filtros, fila abierta y mes; el «solo» se interpreta según la pestaña; los ids inválidos se ignoran", () => {
    const q = `genero=${UUID}&mundo=${UUID2}&solo=falta&mio=1&gml=${UUID}&agr=${UUID2}&historia=6`;
    const p = leerParametrosFlujo(lector(q));
    expect(p).toMatchObject({ pestana: "flujo", genero: UUID, mundo: UUID2, solo: "falta", soloConciliacion: null, mio: true, historia: 6, fila: { gml_id: UUID, equivalencia_id: null, agrupacion_marca_id: UUID2 } });
    expect(leerParametrosFlujo(lector(consultaFlujo(p)))).toEqual(p);
    const c = leerParametrosFlujo(lector("pestana=conciliacion&solo=por_confirmar&periodo=2026-08"));
    expect(c).toMatchObject({ pestana: "conciliacion", solo: null, soloConciliacion: "por_confirmar", periodo: "2026-08" });
    expect(consultaFlujo(c)).toBe("pestana=conciliacion&solo=por_confirmar&periodo=2026-08");
    expect(leerParametrosFlujo(lector("genero=no-es-uuid&solo=otro&periodo=2026-13&historia=5&gml=x&agr=y"))).toEqual(PARAMETROS_FLUJO_VACIOS);
    expect(consultaFlujo(PARAMETROS_FLUJO_VACIOS)).toBe("");
  });

  it("los filtros que viajan al servidor son los ids y el «solo» de cada pestaña", () => {
    const p = leerParametrosFlujo(lector(`genero=${UUID}&solo=exceso&mio=1&agrupacion=${UUID2}`));
    expect(filtrosFlujo(p)).toEqual({ genero_id: UUID, mundo_id: undefined, linea_id: undefined, agrupacion_marca_id: UUID2, solo: "exceso", mio: true });
    const c = leerParametrosFlujo(lector(`pestana=conciliacion&genero=${UUID}&solo=sin_registrar&periodo=2026-09`));
    expect(filtrosConciliacion(c)).toMatchObject({ periodo: "2026-09", genero_id: UUID, solo: "sin_registrar" });
    expect(filtrosFlujo(PARAMETROS_FLUJO_VACIOS).mio).toBeUndefined();
  });

  it("las opciones del árbol se encadenan por género y mundo, con ids", () => {
    const arbol = {
      resumen: {} as never,
      generos: [
        { id: "g1", codigo: "H", nombre: "HOMBRE", orden: 1, activo: true, mundos: [{ id: "m1", codigo: "U", nombre: "URBANO", orden: 1, activo: true, lineas: [{ nodo_id: "n1", linea_id: "l1", nombre: "DENIM" }, { nodo_id: "n2", linea_id: "l2", nombre: "POLO" }] }, { id: "m2", codigo: "F", nombre: "FORMAL", orden: 2, activo: true, lineas: [{ nodo_id: "n3", linea_id: "l3", nombre: "CAMISA" }] }] },
        { id: "g2", codigo: "M", nombre: "MUJER", orden: 2, activo: true, mundos: [{ id: "m1", codigo: "U", nombre: "URBANO", orden: 1, activo: true, lineas: [{ nodo_id: "n4", linea_id: "l4", nombre: "BLUSA" }] }] },
      ],
    } as unknown as Parameters<typeof nodosDeArbol>[0];
    const nodos = nodosDeArbol(arbol);
    expect(nodos).toHaveLength(4);
    const todo = opcionesArbol(nodos, { genero: null, mundo: null });
    expect(todo.generos.map((g) => g.nombre)).toEqual(["HOMBRE", "MUJER"]);
    expect(todo.mundos.map((m) => m.id)).toEqual(["m2", "m1"]);
    const hombre = opcionesArbol(nodos, { genero: "g1", mundo: null });
    expect(hombre.lineas.map((l) => l.nombre)).toEqual(["CAMISA", "DENIM", "POLO"]);
    expect(opcionesArbol(nodos, { genero: "g1", mundo: "m2" }).lineas.map((l) => l.nombre)).toEqual(["CAMISA"]);
    expect(nodosDeArbol(null)).toEqual([]);
  });

  it("la lista se arma con los nombres del catálogo, se ordena (sin IMI al final) y se filtra por texto", () => {
    const flujo = flujoEjemplo();
    const filas = filasDeLista(flujo.filas, flujo.catalogo);
    expect(filas[0].ruta).toBe("HOMBRE · URBANO · DENIM");
    expect(filas[1].ruta).toBe("HOMBRE · FORMAL · CAMISA › MANGA LARGA");
    const porSaldo = ordenarLista(filas, { clave: "saldo", dir: "desc" });
    expect(porSaldo[0].fila.resumen.saldo_n_meses).toBeGreaterThanOrEqual(porSaldo[1].fila.resumen.saldo_n_meses);
    const porImi = ordenarLista(filas, { clave: "imi", dir: "asc" });
    const conImi = porImi.filter((f) => f.fila.resumen.imi_k !== null);
    expect(porImi.slice(0, conImi.length).every((f) => f.fila.resumen.imi_k !== null)).toBe(true);
    const porImiDesc = ordenarLista(filas, { clave: "imi", dir: "desc" });
    expect(porImiDesc.slice(0, conImi.length).every((f) => f.fila.resumen.imi_k !== null)).toBe(true);
    expect(ordenarLista(filas, { clave: "fila", dir: "asc" })[0].ruta.localeCompare(ordenarLista(filas, { clave: "fila", dir: "asc" })[1].ruta, "es")).toBeLessThanOrEqual(0);
    expect(filtrarPorTexto(filas, "camisa")).toHaveLength(filas.filter((f) => f.ruta.toLowerCase().includes("camisa") || f.agrupacion.toLowerCase().includes("camisa")).length);
    expect(filtrarPorTexto(filas, "  ")).toHaveLength(filas.length);
  });

  it("la conciliación ofrece doce meses de reciente a antiguo y la diferencia se lee en castellano", () => {
    expect(mesesConciliables("2026-09")).toHaveLength(12);
    expect(mesesConciliables("2026-09")[0]).toBe("2026-09");
    expect(mesesConciliables("2026-09")[11]).toBe("2025-10");
    const base = { ingreso_inferido: 120 as number | null, salida_inferida: 0 as number | null, sin_registrar: 0, sin_respaldo: 0, avisos: [] as never[] };
    expect(diferenciaConciliacion({ ...base, sin_registrar: 120, avisos: ["ingreso_sin_registrar"] as never[] })).toEqual({ texto: "+120 sin registrar", tono: "alerta" });
    expect(diferenciaConciliacion({ ...base, sin_registrar: 5 })).toEqual({ texto: "+5 sin registrar", tono: "suave" });
    expect(diferenciaConciliacion({ ...base, sin_respaldo: 100, avisos: ["recepcion_sin_respaldo"] as never[] })).toEqual({ texto: "−100 sin respaldo", tono: "alerta" });
    expect(diferenciaConciliacion({ ...base, ingreso_inferido: 0, salida_inferida: 40 })).toEqual({ texto: "−40 salida neta", tono: "alerta" });
    expect(diferenciaConciliacion(base)).toEqual({ texto: "cuadra", tono: "exito" });
    expect(diferenciaConciliacion({ ...base, ingreso_inferido: null })).toEqual({ texto: "—", tono: "suave" });
  });
});

describe("Flujo: totales por género, mundo y línea y Excel", () => {
  const fila = (genero: string, mundo: string, linea: string, r: Partial<FilaDeLista["fila"]["resumen"]>, stock: number, ids = true): FilaDeLista => {
    const base = flujoEjemplo().filas[0];
    return {
      clave: `${genero}|${mundo}|${linea}|${stock}`,
      fila: { ...base, stock_k: { cd: stock / 2, tiendas: stock / 2, total: stock }, resumen: { ...base.resumen, saldo_n_meses: 0, en_camino: 0, por_confirmar: 0, vpm_k: 100, senal: "al_dia", ...r } },
      genero,
      mundo,
      linea,
      generoId: ids ? `g-${genero}` : null,
      mundoId: ids ? `m-${genero}-${mundo}` : null,
      lineaId: ids ? `l-${genero}-${mundo}-${linea}` : null,
      equivalencia: null,
      agrupacion: "X",
      ruta: `${genero} · ${mundo} · ${linea}`,
    };
  };
  const filas = [
    fila("HOMBRE", "URBANO", "DENIM", { saldo_n_meses: 300, senal: "falta", en_camino: 500, por_confirmar: 200 }, 700),
    fila("HOMBRE", "URBANO", "POLO", { saldo_n_meses: 0, senal: "exceso", vpm_k: 50 }, 900),
    fila("HOMBRE", "FORMAL", "CAMISA", { saldo_n_meses: 80, senal: "quiebre" }, 100),
    fila("MUJER", "URBANO", "BLUSA", { saldo_n_meses: 10, senal: "al_dia", vpm_k: 20 }, 40),
    fila("MUJER", "URBANO", "SIN CURVA", { senal: "sin_curva", vpm_k: null }, 999),
  ];

  it("por género suma stock, saldo, en camino y por confirmar, cuenta filas en falta (con el quiebre) y en exceso, y ordena por saldo", () => {
    const g = totalesPorGrupo(filas, "genero");
    expect(g.map((x) => x.nombre)).toEqual(["HOMBRE", "MUJER"]);
    expect(g[0]).toMatchObject({ filas: 3, stock: 1700, stockCd: 850, saldo: 380, enCamino: 500, porConfirmar: 200, enFalta: 2, enExceso: 1, sinCurva: 0 });
    expect(g[1]).toMatchObject({ filas: 2, stock: 1039, saldo: 10, enFalta: 0, sinCurva: 1 });
  });

  it("el IMI del grupo es stock ÷ suma de las ventas promedio y deja fuera las filas sin curva (como el total general)", () => {
    const [hombre, mujer] = totalesPorGrupo(filas, "genero");
    expect(hombre.imi).toBeCloseTo(1700 / 250, 6);
    expect(mujer.imi).toBeCloseTo(40 / 20, 6);
    expect(totalesPorGrupo([filas[4]], "genero")[0].imi).toBeNull();
  });

  it("por mundo y por línea usan el nombre completo del camino; sin ids en el catálogo agrupan por nombre", () => {
    expect(totalesPorGrupo(filas, "mundo").map((x) => x.nombre)).toEqual(["HOMBRE · URBANO", "HOMBRE · FORMAL", "MUJER · URBANO"]);
    expect(totalesPorGrupo(filas, "linea")).toHaveLength(5);
    const sinIds = filas.map((f) => ({ ...f, generoId: null, mundoId: null, lineaId: null }));
    expect(totalesPorGrupo(sinIds, "mundo").map((x) => x.filas)).toEqual([2, 1, 2]);
    expect(totalesPorGrupo([], "genero")).toEqual([]);
  });

  it("con el flujo de ejemplo, los grupos reparten todas las filas y todo el stock", () => {
    const flujo = flujoEjemplo();
    const lista = filasDeLista(flujo.filas, flujo.catalogo);
    for (const nivel of ["genero", "mundo", "linea"] as const) {
      const g = totalesPorGrupo(lista, nivel);
      expect(g.reduce((a, x) => a + x.filas, 0)).toBe(lista.length);
      expect(g.reduce((a, x) => a + x.stock, 0)).toBe(lista.reduce((a, f) => a + f.fila.stock_k.total, 0));
    }
  });

  it("el filtro de Excel rotula lo que ve la pantalla, pero no manda «Falta» (en el servidor incluye el quiebre y en la hoja no)", () => {
    const p = leerParametrosFlujo(lector(`genero=${UUID}&agrupacion=${UUID2}&solo=exceso&mio=1`));
    expect(filtroExcelFlujo(p)).toEqual({ genero_id: UUID, mundo_id: undefined, agrupacion_marca_id: UUID2, solo: "exceso", mio: true });
    expect(filtroExcelFlujo({ ...p, solo: "falta" }).solo).toBeUndefined();
    expect(filtroExcelFlujo(PARAMETROS_FLUJO_VACIOS)).toEqual({ genero_id: undefined, mundo_id: undefined, agrupacion_marca_id: undefined, solo: undefined, mio: undefined });
  });

  it("«Aceptar sugerencia» relee sola cuando lo que mirabas cambió, pero no ante un error de permisos o de datos", () => {
    for (const c of ["sugerencia_vencida", "compra_cambio", "excede_pendiente", "no_pertenece", "tipo_no_disponible"]) expect(CODIGOS_QUE_PIDEN_RECARGA.has(c), c).toBe(true);
    expect(CODIGOS_QUE_PIDEN_RECARGA.has("carga_inicial_requerida")).toBe(false);
  });

  it("el catálogo con `linea_id` deja los ids de género, mundo y línea en cada fila de la lista", () => {
    const flujo = flujoEjemplo();
    const f = flujo.filas[0];
    const nodo = flujo.catalogo.nodos[f.equivalencia_id ?? f.gml_id] ?? flujo.catalogo.nodos[f.gml_id];
    flujo.catalogo.nodos[f.equivalencia_id ?? f.gml_id] = { ...nodo, linea_id: "linea-1" };
    const lista = filasDeLista(flujo.filas, flujo.catalogo);
    expect(lista[0]).toMatchObject({ generoId: nodo.genero_id, mundoId: nodo.mundo_id, lineaId: "linea-1" });
  });
});

describe("Compras: parámetros, estado y valores por defecto de Confirmar ingreso", () => {
  it("la URL guarda la compra abierta, los filtros y el modo importar; el texto libre no viaja al servidor", () => {
    const q = `compra=${UUID}&estado=confirmada&proveedor=${UUID2}&origen=carga_inicial&por_confirmar=1&q=norte&importar=1`;
    const p = leerParametrosCompras(lector(q));
    expect(p).toEqual({ ...PARAMETROS_COMPRAS_VACIOS, compra: UUID, estado: "confirmada", proveedor: UUID2, origen: "carga_inicial", porConfirmar: true, q: "norte", importar: true });
    expect(leerParametrosCompras(lector(consultaCompras(p)))).toEqual(p);
    expect(filtrosCompras(p)).toEqual({ estado: "confirmada", proveedor_id: UUID2, origen: "carga_inicial", por_confirmar: true });
    expect(leerParametrosCompras(lector("compra=x&estado=otro&origen=z"))).toMatchObject({ compra: null, estado: null, origen: null });
  });

  it("mes de entrega, género, mundo, línea y marca viajan al servidor con los nombres de la API y vuelven de la URL", () => {
    const q = `desde=2026-11&hasta=2027-02&genero=${UUID}&mundo=${UUID2}&linea=${UUID}&marca=${UUID2}`;
    const p = leerParametrosCompras(lector(q));
    expect(p).toMatchObject({ desde: "2026-11", hasta: "2027-02", genero: UUID, mundo: UUID2, linea: UUID, marca: UUID2 });
    expect(filtrosCompras(p)).toEqual({ llegada_desde: "2026-11", llegada_hasta: "2027-02", genero_id: UUID, mundo_id: UUID2, linea_id: UUID, marca_id: UUID2 });
    expect(urlCompras(filtrosCompras(p))).toBe(`/api/compras?llegada_desde=2026-11&llegada_hasta=2027-02&genero_id=${UUID}&mundo_id=${UUID2}&linea_id=${UUID}&marca_id=${UUID2}`);
    expect(leerParametrosCompras(lector(consultaCompras(p)))).toEqual(p);
    expect(hayFiltrosCompras(p)).toBe(true);
    expect(hayFiltrosCompras(PARAMETROS_COMPRAS_VACIOS)).toBe(false);
    expect(hayFiltrosCompras({ ...PARAMETROS_COMPRAS_VACIOS, desde: "2026-11" })).toBe(true);
  });

  it("un mes mal escrito se ignora y un rango al revés se descarta entero (la API lo rechazaría con 400)", () => {
    expect(leerParametrosCompras(lector("desde=2026-13&hasta=oct"))).toMatchObject({ desde: null, hasta: null });
    expect(leerParametrosCompras(lector("desde=2027-03&hasta=2026-11"))).toMatchObject({ desde: null, hasta: null });
    expect(leerParametrosCompras(lector("desde=2026-11&hasta=2026-11"))).toMatchObject({ desde: "2026-11", hasta: "2026-11" });
    expect(leerParametrosCompras(lector("hasta=2026-11"))).toMatchObject({ desde: null, hasta: "2026-11" });
  });

  it("el texto libre busca por número, proveedor y referencia sin distinguir acentos ni mayúsculas", () => {
    const todas = comprasApiEjemplo();
    expect(filtrarCompras(todas, "c-000012").map((c) => c.numero)).toContain("C-000012");
    expect(filtrarCompras(todas, "FERIA").every((c) => c.proveedor.nombre === "Feria Sur")).toBe(true);
    expect(filtrarCompras(todas, "po-2211").length).toBeGreaterThan(0);
    expect(filtrarCompras(todas, "")).toHaveLength(todas.length);
    expect(filtrarCompras(todas, "zzz")).toHaveLength(0);
  });

  it("el estado distingue el saldo cerrado y el total por confirmar cuenta solo compras confirmadas", () => {
    expect(estadoCompra(compraApiC12SaldoCerrado())).toEqual({ texto: "Recibida · saldo cancelado (200 u)", tono: "exito" });
    expect(estadoCompra(compraApiC12())).toEqual({ texto: "Confirmada", tono: "marca" });
    expect(unidadesPorConfirmar(compraApiC09Vencida())).toBe(500);
    expect(unidadesPorConfirmar(compraApiC12())).toBe(0);
    expect(unidadesPorConfirmar({ ...compraApiC09Vencida(), estado: "cancelada" })).toBe(0);
  });

  it("mes por defecto: el sugerido por la conciliación; si no, el de la entrega; si es futura, el mes en curso; nunca antes de la compra", () => {
    const hoyMes = "2026-10";
    expect(mesPorDefectoIngreso({ entrega: { periodo: "2026-09", sugerencia: { periodo: "2026-09", unidades: 500 } }, fechaCompra: "2026-08-20", hoyMes })).toBe("2026-09");
    expect(mesPorDefectoIngreso({ entrega: { periodo: "2026-08", sugerencia: null }, fechaCompra: "2026-08-20", hoyMes })).toBe("2026-08");
    expect(mesPorDefectoIngreso({ entrega: { periodo: "2026-12", sugerencia: null }, fechaCompra: "2026-08-20", hoyMes })).toBe("2026-10");
    expect(mesPorDefectoIngreso({ entrega: null, fechaCompra: "2026-08-20", hoyMes })).toBe("2026-10");
    expect(mesPorDefectoIngreso({ entrega: { periodo: "2026-06", sugerencia: null }, fechaCompra: "2026-08-20", hoyMes })).toBe("2026-08");
  });

  it("fecha por defecto: hoy si es el mes en curso, el último día si ya pasó y el primero si es futuro", () => {
    expect(fechaPorDefectoIngreso("2026-10", "2026-10-27")).toBe("2026-10-27");
    expect(fechaPorDefectoIngreso("2026-09", "2026-10-27")).toBe("2026-09-30");
    expect(fechaPorDefectoIngreso("2026-12", "2026-10-27")).toBe("2026-12-01");
  });

  it("el selector de meses va de la compra a seis meses después de hoy, o más si la entrega es posterior", () => {
    const m = mesesParaIngreso({ fechaCompra: "2026-08-20", hoyMes: "2026-10" });
    expect(m[0]).toBe("2026-08");
    expect(m[m.length - 1]).toBe("2027-04");
    expect(mesesParaIngreso({ fechaCompra: "2026-08-20", hoyMes: "2026-10", hastaMin: "2027-08" }).pop()).toBe("2027-08");
  });

  it("las unidades confirmables son lo que no está recibido (con saldo cerrado, hasta lo cancelado)", () => {
    expect(unidadesConfirmables({ unidades: 500, unidades_recibidas: 300 })).toBe(200);
    expect(unidadesConfirmables({ unidades: 500, unidades_recibidas: 500 })).toBe(0);
    const c = compraApiC12SaldoCerrado();
    expect(unidadesConfirmables(c.lineas[0])).toBe(200);
  });

  it("los `confirm` dicen qué va a pasar", () => {
    expect(resumenIngreso("C-000009", 1, 500, "2026-09")).toBe("500 u de C-000009, línea 1, como ingresadas en set-2026, a tu nombre");
    const parcial = compraApiC12Parcial();
    expect(textoConfirmarCancelar(parcial)).toContain("tiene 100 u confirmadas de 500: se cancela el saldo de 400 u y la compra queda como recibida parcialmente");
    expect(textoConfirmarCancelar(compraApiC12())).toContain("dejará de contar en el flujo");
    expect(textoConfirmarQuitar({ numero: "C-000012" }, 1, { unidades: 200, recibida_periodo: "2026-10" })).toContain("Quitar el ingreso de 200 u de oct-2026 de C-000012, línea 1");
  });
});
