import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { EstadoImportacion } from "@/lib/arbol/importar";
import { construirIndiceOrigenes, enviadasGmlDe, origenesDeEnviada } from "@/app/(app)/planificacion/venta-stock/origenes-mapeo";
import { leerEnviadasGuardadas } from "@/app/(app)/planificacion/venta-stock/enviadas-gml";
import { armarReporteMes, valorGrupoCombinacion } from "@/lib/ventas/informe";
import { crearEvaluadorMapeos, planificarCrearMapeos } from "@/lib/ventas/mapeos";
import { crearResolutorCombinaciones } from "@/lib/ventas/resolver";
import { AVISOS_CODIGOS, NOTAS_CODIGOS, UMBRAL_BLOQUEO_ERRORES, severidadDe, type FilaCruda, type InformeMes } from "@/lib/ventas/tipos";
import type { ResolucionCombinacionApi } from "@/lib/ventas/tipos-api";
import { ARBOL, informe as armar, mapeo, resoluciones } from "./ventas.fixture";

/**
 * 0.8.3 · Decisión de Javier (2026-10-13): si el nodo género-mundo-línea del archivo
 * existe y es vigente pero la equivalencia no existe (o está inactiva), no es un error:
 * la fila se carga en la equivalencia de nivel GML del nodo (genérica SIN EQUIVALENCIA o,
 * si no hay, la que se llama como la línea). Datos sintéticos; árbol de `ventas.fixture.ts`:
 *   n1 HOMBRE/CASUAL/DENIM   genérica e1g + DENIM (e1l) + PANTALON VARIOS (e1s)
 *   n2 MUJER/CASUAL/DENIM    solo la genérica e2g
 *   n3 HOMBRE/URBANO/POLO    genérica e3g + POLO CLASICO inactiva (e3x)
 *   n4 HOMBRE/CASUAL/POLO    nodo inactivo
 */

const con = (estado: EstadoImportacion, opciones = { enviarAGml: true }, mapeos = [] as ReturnType<typeof mapeo>[]) =>
  crearResolutorCombinaciones(estado, mapeos, opciones);

const c = (g: string, m: string, l: string, e: string) => ({ genero: g, mundo: m, linea: l, equivalencia: e });

/** El árbol con el nodo n2 (MUJER/CASUAL/DENIM) sin genérica y con una equivalencia que se llama como la línea (e2l). */
const SIN_GENERICA_CON_LINEA: EstadoImportacion = {
  ...ARBOL,
  equivalencias: [
    ...ARBOL.equivalencias.filter((e) => e.id !== "e2g"),
    { id: "e2l", genero_mundo_linea_id: "n2", nombre: "DENIM", codigo: "DENIM", es_generica: false, activo: true },
    { id: "e2m", genero_mundo_linea_id: "n2", nombre: "MOM", codigo: "MOM", es_generica: false, activo: true },
  ],
};

/** El nodo n2 sin genérica y sin equivalencia igual a la línea: solo MOM. */
const SIN_NINGUNA: EstadoImportacion = {
  ...ARBOL,
  equivalencias: [
    ...ARBOL.equivalencias.filter((e) => e.id !== "e2g"),
    { id: "e2m", genero_mundo_linea_id: "n2", nombre: "MOM", codigo: "MOM", es_generica: false, activo: true },
  ],
};

const mes = (r: ReturnType<typeof armar>, periodo = "2026-09"): InformeMes => {
  const m = r.informe.meses.find((x) => x.periodo === periodo);
  if (!m) throw new Error(`falta el mes ${periodo}`);
  return m;
};
const aviso = (m: InformeMes, codigo: string) => m.avisos.find((a) => a.codigo === codigo);

describe("resolutor: envío a la equivalencia de nivel GML", () => {
  it("fallback a la genérica activa del nodo cuando la equivalencia no existe", () => {
    const res = con(ARBOL)(c("HOMBRE", "CASUAL", "DENIM", "JEAN"));
    expect(res).toEqual({
      resultado: "ok",
      equivalencia_id: "e1g",
      a_gml: {
        motivo_original: "equivalencia_inexistente",
        tipo: "generica",
        valor: "HOMBRE / CASUAL / DENIM / JEAN",
        destino: "HOMBRE / CASUAL / DENIM / SIN EQUIVALENCIA",
      },
    });
  });

  it("sin genérica, va a la equivalencia activa que se llama como la línea (igual a la línea)", () => {
    const res = con(SIN_GENERICA_CON_LINEA)(c("MUJER", "CASUAL", "DENIM", "BOOTCUT"));
    expect(res).toMatchObject({
      resultado: "ok",
      equivalencia_id: "e2l",
      a_gml: { tipo: "igual_a_linea", motivo_original: "equivalencia_inexistente", destino: "MUJER / CASUAL / DENIM / DENIM" },
    });
  });

  it("la genérica inactiva no sirve: pasa a la igual a la línea; y la igual a la línea inactiva tampoco", () => {
    const genericaInactiva: EstadoImportacion = {
      ...ARBOL,
      equivalencias: ARBOL.equivalencias.map((e) => (e.id === "e1g" ? { ...e, activo: false } : e)),
    };
    expect(con(genericaInactiva)(c("HOMBRE", "CASUAL", "DENIM", "JEAN"))).toMatchObject({ equivalencia_id: "e1l", a_gml: { tipo: "igual_a_linea" } });
    const ambasInactivas: EstadoImportacion = {
      ...ARBOL,
      equivalencias: ARBOL.equivalencias.map((e) => (e.id === "e1g" || e.id === "e1l" ? { ...e, activo: false } : e)),
    };
    expect(con(ambasInactivas)(c("HOMBRE", "CASUAL", "DENIM", "JEAN")).resultado).toBe("equivalencia_inexistente");
  });

  it("sin ninguna de las dos queda el error con su motivo original (y sin `a_gml`)", () => {
    const res = con(SIN_NINGUNA)(c("MUJER", "CASUAL", "DENIM", "BOOTCUT"));
    expect(res).toEqual({ resultado: "equivalencia_inexistente", detalle: "MUJER / CASUAL / DENIM / BOOTCUT" });
  });

  it("nodo inexistente, nodo inactivo, línea, género o mundo desconocidos o inactivos y clasificación incompleta: sin fallback", () => {
    const r = con(ARBOL);
    const casos: [string, string, string, string, string][] = [
      ["MUJER", "URBANO", "DENIM", "X", "nodo_inexistente"],
      ["HOMBRE", "CASUAL", "POLO", "X", "nodo_inactivo"],
      ["HOMBRE", "CASUAL", "QQ", "X", "linea_desconocida"],
      ["HOMBRE", "CASUAL", "BERMUDA", "X", "linea_inactiva"],
      ["XX", "CASUAL", "DENIM", "X", "genero_desconocido"],
      ["NIÑOS", "CASUAL", "DENIM", "X", "genero_inactivo"],
      ["HOMBRE", "ZZ", "DENIM", "X", "mundo_desconocido"],
      ["HOMBRE", "RI", "DENIM", "X", "mundo_inactivo"],
      ["HOMBRE", "", "DENIM", "X", "clasificacion_incompleta"],
    ];
    for (const [g, m, l, e, motivo] of casos) {
      const res = r(c(g, m, l, e));
      expect(res.resultado, motivo).toBe(motivo);
      expect(res, motivo).not.toHaveProperty("a_gml");
    }
  });

  it("equivalencia inactiva en un nodo vigente también va a la GML, con su motivo original", () => {
    const res = con(ARBOL)(c("HOMBRE", "URBANO", "POLO", "POLO CLASICO"));
    expect(res).toMatchObject({
      resultado: "ok",
      equivalencia_id: "e3g",
      a_gml: { motivo_original: "equivalencia_inactiva", tipo: "generica", valor: "HOMBRE / URBANO / POLO / POLO CLASICO" },
    });
  });

  it("un nodo vigente cuyo género, mundo o línea no lo es nunca recibe el envío (la cadena se corta antes)", () => {
    const sinLinea: EstadoImportacion = { ...ARBOL, lineas: ARBOL.lineas.map((l) => (l.id === "l-den" ? { ...l, activo: false } : l)) };
    expect(con(sinLinea)(c("HOMBRE", "CASUAL", "DENIM", "JEAN")).resultado).toBe("linea_inactiva");
  });

  it("el árbol manda: una equivalencia que resuelve devuelve ok sin `a_gml`", () => {
    expect(con(ARBOL)(c("HOMBRE", "CASUAL", "DENIM", "PANTALON VARIOS"))).toEqual({ resultado: "ok", equivalencia_id: "e1s" });
    expect(con(ARBOL)(c("HOMBRE", "CASUAL", "DENIM", "-"))).toEqual({ resultado: "ok", equivalencia_id: "e1l" });
  });

  it("`-` y vacío con un nodo sin esa equivalencia también se envían (el valor usa el nombre sustituido)", () => {
    // MUJER/CASUAL/DENIM solo tiene la genérica: `-` busca una equivalencia DENIM que no existe.
    const res = con(ARBOL)(c("MUJER", "CASUAL", "DENIM", "DENIM"));
    expect(res).toMatchObject({ equivalencia_id: "e2g", a_gml: { valor: "MUJER / CASUAL / DENIM / DENIM", tipo: "generica" } });
  });

  it("un mapeo explícito (exacto o comodín) gana al envío a la GML", () => {
    const exacto = mapeo("m-jean", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s");
    const comodin = mapeo("m-cod", ["HOMBRE", "CASUAL", "DENIM", "*"], "e1l");
    const e = con(ARBOL, { enviarAGml: true }, [exacto, comodin])(c("HOMBRE", "CASUAL", "DENIM", "JEAN"));
    expect(e).toMatchObject({ resultado: "ok", equivalencia_id: "e1s", mapeo: { id: "m-jean", motivo_original: "equivalencia_inexistente" } });
    expect(e).not.toHaveProperty("a_gml");
    const cod = con(ARBOL, { enviarAGml: true }, [comodin])(c("HOMBRE", "CASUAL", "DENIM", "OTRA"));
    expect(cod).toMatchObject({ equivalencia_id: "e1l", mapeo: { id: "m-cod" } });
    expect(cod).not.toHaveProperty("a_gml");
  });

  it("un mapeo inactivo se ignora y deja pasar al envío; el de un destino no vigente conserva el error (no se tapa)", () => {
    const inactivo = mapeo("m-i", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s", false);
    expect(con(ARBOL, { enviarAGml: true }, [inactivo])(c("HOMBRE", "CASUAL", "DENIM", "JEAN"))).toMatchObject({ a_gml: { tipo: "generica" } });
    const roto = mapeo("m-roto", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e3x");
    const res = con(ARBOL, { enviarAGml: true }, [roto]);
    expect(res(c("HOMBRE", "CASUAL", "DENIM", "JEAN"))).toMatchObject({ resultado: "equivalencia_inexistente", mapeo_no_aplicable: "m-roto" });
    expect(res.mapeosNoAplicables().map((m) => m.id)).toEqual(["m-roto"]);
    // otra equivalencia de la misma terna, sin mapeo: sí va a la GML
    expect(res(c("HOMBRE", "CASUAL", "DENIM", "OTRA"))).toMatchObject({ a_gml: { tipo: "generica" } });
  });

  it("sin la opción (valor por defecto) el resolutor se comporta como antes: es el que usan estado, alta e importación de mapeos", () => {
    expect(crearResolutorCombinaciones(ARBOL)(c("HOMBRE", "CASUAL", "DENIM", "JEAN")).resultado).toBe("equivalencia_inexistente");
    expect(crearResolutorCombinaciones(ARBOL, [], {})(c("HOMBRE", "CASUAL", "DENIM", "JEAN")).resultado).toBe("equivalencia_inexistente");
    // …y un origen que hoy iría a la GML sigue siendo asignable y vigente (no obsoleto).
    const p = planificarCrearMapeos(
      [{ origen: c("HOMBRE", "CASUAL", "DENIM", "JEAN"), equivalencia_id: "e1s" }],
      ARBOL,
      []
    );
    expect(p.error).toBeNull();
    const ev = crearEvaluadorMapeos(ARBOL);
    expect(ev.estado({ activo: true, origen: c("HOMBRE", "CASUAL", "DENIM", "JEAN"), equivalencia_id: "e1s" })).toBe("vigente");
  });
});

describe("`valorGrupoCombinacion`: una sola fuente del texto del grupo", () => {
  const k = { genero: "HOMBRE", mundo: "CASUAL", linea: "DENIM", equivalencia: "JEAN" };
  it("una combinación enviada a la GML se agrupa con el texto que habría tenido su error", () => {
    const sin = crearResolutorCombinaciones(ARBOL)(c("HOMBRE", "CASUAL", "DENIM", "JEAN"));
    const gml = con(ARBOL)(c("HOMBRE", "CASUAL", "DENIM", "JEAN"));
    expect(valorGrupoCombinacion(k, gml)).toBe(valorGrupoCombinacion(k, sin));
    expect(valorGrupoCombinacion(k, gml)).toBe("HOMBRE / CASUAL / DENIM / JEAN");
  });
  it("los demás casos no cambian", () => {
    const ok: ResolucionCombinacionApi = { resultado: "ok", equivalencia_id: "x" };
    expect(valorGrupoCombinacion(k, ok)).toBe("HOMBRE / CASUAL / DENIM / JEAN");
    expect(valorGrupoCombinacion(k, undefined)).toBe("HOMBRE / CASUAL / DENIM");
  });
});

describe("informe: lo enviado a la GML cuenta como cargado, no como error", () => {
  const filas = (n: number, extra: Partial<FilaCruda>): Partial<FilaCruda>[] => Array.from({ length: n }, () => ({ ...extra }));

  it("no suma al % de errores ni bloquea el mes (sin el envío, 10 de 100 bloquean)", () => {
    const datos = [...filas(90, {}), ...filas(10, { equivalencia: "JEAN" })];
    const sin = mes(armar(datos));
    expect(sin.bloqueado).toBe(true);
    expect(sin.errores.pct_filas).toBeGreaterThanOrEqual(UMBRAL_BLOQUEO_ERRORES * 100);
    const m = mes(armar(datos, { enviarAGml: true }));
    expect(m.errores.maximo).toBe(0);
    expect(m.bloqueado).toBe(false);
    expect(m.excluido.filas).toBe(0);
    expect(m.exclusiones).toEqual([]);
    expect(m.enviadas_a_gml.filas).toBe(10);
    expect(m.identidad_ok).toBe(true);
  });

  it("si el nodo no tiene destino GML, sigue siendo error normal (pesa y bloquea)", () => {
    const datos = [...filas(90, { genero: "MUJER", equivalencia: "MOM" }), ...filas(10, { genero: "MUJER", equivalencia: "BOOTCUT" })];
    const m = mes(armar(datos, { enviarAGml: true, estado: SIN_NINGUNA }));
    expect(m.enviadas_a_gml.filas).toBe(0);
    expect(m.exclusiones[0]).toMatchObject({ motivo: "equivalencia_inexistente", filas: 10 });
    expect(m.bloqueado).toBe(true);
  });

  it("se suma a la clave del destino y se fusiona con la nativa cuando coincide; la identidad cierra", () => {
    // Nativa: equivalencia vacía → SIN EQUIVALENCIA = e1g. La antigua JEAN también va a e1g, misma tienda, marca y talla.
    const m = mes(armar([{ equivalencia: "", venta_soles: "1000" }, { equivalencia: "JEAN", venta_soles: "500" }], { enviarAGml: true }));
    expect(m.archivo.filas).toBe(2);
    expect(m.cargado.filas).toBe(1);
    expect(m.fusionadas).toBe(1);
    expect(m.excluido.filas).toBe(0);
    expect(m.archivo.filas).toBe(m.cargado.filas + m.fusionadas + m.excluido.filas);
    expect(m.cargado.venta_soles).toBe(1500);
    expect(m.enviadas_a_gml).toMatchObject({ filas: 1, venta_soles: 500 });
    expect(m.identidad_ok).toBe(true);
    const rep = aviso(m, "claves_repetidas_se_suman");
    expect(rep?.filas).toBe(1);
    expect(rep?.mensaje).toContain("enviadas a la GML sin equivalencia");
    expect(rep?.mensaje).not.toContain("reasignadas por mapeo");
  });

  it("el mensaje de claves repetidas solo nombra el envío si una fila enviada se fusionó con una clave nativa", () => {
    // Dos enviadas entre sí (misma clave, ninguna nativa): hay fusión, pero no con una nativa.
    const entreEnviadas = mes(armar([{ equivalencia: "JEAN" }, { equivalencia: "JEAN" }], { enviarAGml: true }));
    expect(entreEnviadas.fusionadas).toBe(1);
    expect(aviso(entreEnviadas, "claves_repetidas_se_suman")?.mensaje).not.toContain("enviadas a la GML");
    // Una enviada y una reasignada por mapeo en la misma clave: tampoco hay nativa.
    const conMapeo = mes(
      armar([{ equivalencia: "JEAN" }, { equivalencia: "OTRA" }], { enviarAGml: true, mapeos: [mapeo("m", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1g")] })
    );
    expect(conMapeo.fusionadas).toBe(1);
    expect(aviso(conMapeo, "claves_repetidas_se_suman")?.mensaje).not.toContain("enviadas a la GML");
    // Nativa + enviada: sí. Y si además hay una colisión sin nativa en otra clave, la frase sale solo por la real.
    const real = mes(armar([{ equivalencia: "" }, { equivalencia: "JEAN" }], { enviarAGml: true }));
    expect(aviso(real, "claves_repetidas_se_suman")?.mensaje).toContain("enviadas a la GML");
    // La nativa llega DESPUÉS de las enviadas (otro orden de filas): mismo resultado.
    const otroOrden = mes(armar([{ equivalencia: "JEAN" }, { equivalencia: "JEAN" }, { equivalencia: "" }], { enviarAGml: true }));
    expect(otroOrden.fusionadas).toBe(2);
    expect(aviso(otroOrden, "claves_repetidas_se_suman")?.mensaje).toContain("enviadas a la GML");
    // Una nativa que choca con otra nativa no menciona el envío aunque haya enviadas en otra clave.
    const otraClave = mes(armar([{ equivalencia: "" }, { equivalencia: "" }, { equivalencia: "JEAN", marca: "BETA" }], { enviarAGml: true }));
    expect(otraClave.fusionadas).toBe(1);
    expect(aviso(otraClave, "claves_repetidas_se_suman")?.mensaje).not.toContain("enviadas a la GML");
  });

  it("`enviadas_a_gml` es una nota (informativa) y la lista de avisos de la pantalla no la repite: tiene su propio bloque", () => {
    expect(severidadDe("enviadas_a_gml")).toBe("nota");
    expect((NOTAS_CODIGOS as readonly string[]).includes("enviadas_a_gml")).toBe(true);
    expect((AVISOS_CODIGOS as readonly string[]).includes("enviadas_a_gml")).toBe(false);
    const f = readFileSync(path.resolve(__dirname, "..", "src/app/(app)/planificacion/venta-stock/detalle-mes.tsx"), "utf8");
    expect(f).toMatch(/codigo as string\) !== "enviadas_a_gml"/);
    // el dato sigue en el reporte guardado
    const r = armar([{ equivalencia: "JEAN" }], { enviarAGml: true });
    const reporte = armarReporteMes(r.informe, "2026-09", { archivo_nombre: "x.csv" });
    expect((reporte.avisos as { codigo: string }[]).some((a) => a.codigo === "enviadas_a_gml")).toBe(true);
  });

  it("sin colisión, claves repetidas no menciona el envío; y sin el envío no hay fusión", () => {
    const m = mes(armar([{ equivalencia: "JEAN" }, { equivalencia: "BOOTCUT", marca: "BETA" }], { enviarAGml: true }));
    expect(m.fusionadas).toBe(0);
    expect(aviso(m, "claves_repetidas_se_suman")).toBeUndefined();
  });

  it("detalle por valor de origen con destino, más la nota informativa `enviadas_a_gml`", () => {
    const m = mes(
      armar(
        [
          { equivalencia: "JEAN", venta_soles: "500", unidades: "5" },
          { equivalencia: "JEAN", marca: "BETA", venta_soles: "100", unidades: "1" },
          { genero: "MUJER", equivalencia: "FOO", venta_soles: "200" },
          { genero: "HOMBRE", mundo: "URBANO", linea: "POLO", equivalencia: "POLO CLASICO", venta_soles: "50" },
        ],
        { enviarAGml: true }
      )
    );
    expect(m.enviadas_a_gml).toMatchObject({ filas: 4, venta_soles: 850 });
    expect(m.enviadas_a_gml_detalle.map((d) => d.valor)).toEqual([
      "HOMBRE / CASUAL / DENIM / JEAN",
      "MUJER / CASUAL / DENIM / FOO",
      "HOMBRE / URBANO / POLO / POLO CLASICO",
    ]);
    expect(m.enviadas_a_gml_detalle[0]).toMatchObject({
      motivo: "equivalencia_inexistente",
      destino_tipo: "generica",
      destino: "HOMBRE / CASUAL / DENIM / SIN EQUIVALENCIA",
      filas: 2,
      unidades: 6,
      venta_soles: 600,
      costo_vendido: 800,
      stock_unidades: 40,
      stock_valorizado: 1600,
    });
    expect(m.enviadas_a_gml_detalle[2]).toMatchObject({ motivo: "equivalencia_inactiva" });
    const a = aviso(m, "enviadas_a_gml");
    expect(a).toMatchObject({ severidad: "nota", rojo: false, filas: 4, venta_soles: 850 });
    expect(a?.detalle.map((d) => d.valor)).toContain("HOMBRE / CASUAL / DENIM / JEAN → SIN EQUIVALENCIA");
    expect(a?.detalle).toHaveLength(3);
  });

  it("el destino 'igual a la línea' se rotula así en el aviso", () => {
    const m = mes(armar([{ genero: "MUJER", equivalencia: "BOOTCUT" }], { enviarAGml: true, estado: SIN_GENERICA_CON_LINEA }));
    expect(m.enviadas_a_gml_detalle[0]).toMatchObject({ destino_tipo: "igual_a_linea", destino: "MUJER / CASUAL / DENIM / DENIM" });
    expect(aviso(m, "enviadas_a_gml")?.detalle[0].valor).toBe("MUJER / CASUAL / DENIM / BOOTCUT → igual a la línea");
  });

  it("un mapeo explícito gana al envío en el informe: va como reasignada, no como enviada", () => {
    const m = mes(armar([{ equivalencia: "JEAN" }, { equivalencia: "OTRA" }], { enviarAGml: true, mapeos: [mapeo("m", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s")] }));
    expect(m.reasignadas.filas).toBe(1);
    expect(m.enviadas_a_gml.filas).toBe(1);
    expect(m.enviadas_a_gml_detalle.map((d) => d.valor)).toEqual(["HOMBRE / CASUAL / DENIM / OTRA"]);
  });

  it("sin enviadas no hay aviso ni detalle", () => {
    const m = mes(armar([{}, { equivalencia: "JEAN" }]));
    expect(m.enviadas_a_gml).toMatchObject({ filas: 0, venta_soles: 0 });
    expect(m.enviadas_a_gml_detalle).toEqual([]);
    expect(aviso(m, "enviadas_a_gml")).toBeUndefined();
  });

  it("una fila enviada a la GML con la marca desactivada sigue excluyéndose por la marca (no cuenta como enviada)", () => {
    const m = mes(armar([{ equivalencia: "JEAN", marca: "VIEJA" }, { equivalencia: "JEAN" }], { enviarAGml: true }));
    expect(m.enviadas_a_gml.filas).toBe(1);
    expect(m.identidad_ok).toBe(true);
  });

  it("propiedad (semilla fija): la identidad cierra con envío a la GML, mapeos y colisiones; el detalle suma el total", () => {
    const mapeos = [
      mapeo("m-jean", ["HOMBRE", "CASUAL", "DENIM", "JEAN"], "e1s"),
      mapeo("m-chompa", ["HOMBRE", "CASUAL", "CHOMPA", "*"], "e1g"),
      mapeo("m-roto", ["HOMBRE", "URBANO", "POLO", "POLO CLASICO"], "e3x"), // destino no vigente: no se tapa con el envío
    ];
    for (const semilla of [1, 7, 2026, 90210, 424242]) {
      const rng = aleatorioSemilla(semilla);
      const pick = <T,>(l: T[]) => l[Math.floor(rng() * l.length)];
      const datos: Partial<FilaCruda>[] = Array.from({ length: 2500 }, () => ({
        mes: pick(["Ago", "Set", "Set", "Set", "xx"]),
        tienda: pick(["LUKERS UNO", "LUKERS UNO", "LUKERS DOS", "CD LUKERS", "OFICINA CENTRAL", "LOCAL X", "", "TOTAL"]),
        genero: pick(["HOMBRE", "HOMBRE", "MUJER", "NIÑOS", "OTRO", ""]),
        mundo: pick(["CASUAL", "CASUAL", "URBANO", "RI", "ZZ", ""]),
        linea: pick(["DENIM", "DENIM", "POLO", "BERMUDA", "CHOMPA", ""]),
        equivalencia: pick(["", "-", "PANTALON VARIOS", "PANTALON VARIOS", "JEAN", "DENIM", "POLO CLASICO", "NO EXISTE"]),
        marca: pick(["ALFA", "BETA", "VIEJA", "NUEVA UNO", "-", "VARIOS"]),
        talla: pick(["Central", "Extrema", "Revisar", "-", "", "XL"]),
        unidades: pick(["0", "5", "-2", "7.4", "abc"]),
        venta_soles: pick(["0", "100", "250.55", "-30", "12,5"]),
        costo_vendido: pick(["0", "40", "100.1"]),
        stock_unidades: pick(["0", "9", "-1"]),
        stock_valorizado: pick(["0", "300", "50.25", "-10"]),
      }));
      const r = armar(datos, { mapeos, enviarAGml: true });
      let enviadasTotal = 0;
      for (const m of r.informe.meses) {
        const etiqueta = `semilla ${semilla} mes ${m.periodo}`;
        expect(m.identidad_ok, etiqueta).toBe(true);
        for (const x of m.conciliacion) expect(x.descuadre, `${etiqueta} ${x.medida}`).toBe(0);
        expect(m.archivo.filas, etiqueta).toBe(m.cargado.filas + m.fusionadas + m.excluido.filas);
        // lo enviado está cargado (solo o fusionado) y nunca excluido
        expect(m.enviadas_a_gml.filas, etiqueta).toBeLessThanOrEqual(m.cargado.filas + m.fusionadas);
        expect(m.enviadas_a_gml_detalle.reduce((s, d) => s + d.filas, 0), etiqueta).toBe(m.enviadas_a_gml.filas);
        expect(m.enviadas_a_gml_detalle.reduce((s, d) => s + d.venta_soles, 0), etiqueta).toBeCloseTo(m.enviadas_a_gml.venta_soles, 2);
        expect(aviso(m, "enviadas_a_gml")?.filas ?? 0, etiqueta).toBe(m.enviadas_a_gml.filas);
        expect(m.exclusiones.some((e) => e.motivo === "equivalencia_inexistente" && e.combinacion === undefined), etiqueta).toBe(false);
        enviadasTotal += m.enviadas_a_gml.filas;
      }
      expect(enviadasTotal, `semilla ${semilla}`).toBeGreaterThan(0);
      // El mapeo de destino roto conserva sus filas como error (no pasan al envío).
      const rotas = r.informe.meses.flatMap((m) => m.exclusiones).filter((e) => e.motivo === "equivalencia_inactiva");
      expect(rotas.length, `semilla ${semilla}`).toBeGreaterThan(0);
    }
  });

  it("guarda `enviadas_a_gml` y su detalle (≤ 500 entradas) en el reporte de la carga, y se lee de vuelta", () => {
    const r = armar([{ equivalencia: "JEAN", venta_soles: "500" }, { genero: "MUJER", equivalencia: "FOO", venta_soles: "200" }], { enviarAGml: true });
    const reporte = armarReporteMes(r.informe, "2026-09", { archivo_nombre: "sintetico.csv" });
    expect(reporte.enviadas_a_gml).toMatchObject({ filas: 2 });
    const leido = leerEnviadasGuardadas(JSON.parse(JSON.stringify(reporte)) as Record<string, unknown>);
    expect(leido.resumen?.filas).toBe(2);
    expect(leido.detalle.map((d) => d.valor)).toEqual(["HOMBRE / CASUAL / DENIM / JEAN", "MUJER / CASUAL / DENIM / FOO"]);
    const avisos = reporte.avisos as { codigo: string; detalle: unknown[] }[];
    expect(avisos.find((a) => a.codigo === "enviadas_a_gml")?.detalle).toHaveLength(2);
    expect(JSON.stringify(reporte).length).toBeLessThan(200 * 1024);
  });

  it("el detalle admite hasta 500 entradas en el reporte y se recorta si el reporte crece de más", () => {
    const eq = Array.from({ length: 600 }, (_, i) => ({ equivalencia: `EQ ${i}`, venta_soles: String(10 + i) }));
    const r = armar(eq, { enviarAGml: true });
    const m = mes(r);
    expect(m.enviadas_a_gml_detalle).toHaveLength(600);
    const reporte = armarReporteMes(r.informe, "2026-09", { archivo_nombre: "x.csv" });
    expect(JSON.stringify(reporte).length).toBeLessThanOrEqual(200 * 1024);
    expect((reporte.enviadas_a_gml_detalle as unknown[]).length).toBeLessThanOrEqual(500);
    expect(reporte.enviadas_a_gml).toMatchObject({ filas: 600 });
  });
});

describe("lectura de reportes y meses anteriores a 0.8.3 (campo opcional)", () => {
  it("un reporte guardado sin los campos se lee como cero enviadas", () => {
    expect(leerEnviadasGuardadas({})).toEqual({ resumen: null, detalle: [] });
    expect(leerEnviadasGuardadas({ enviadas_a_gml: "x", enviadas_a_gml_detalle: 3 })).toEqual({ resumen: null, detalle: [] });
    expect(leerEnviadasGuardadas({ reasignadas: { filas: 3 }, avisos: [] }).detalle).toEqual([]);
  });

  it("`enviadasGmlDe` devuelve ceros si el informe no trae el campo", () => {
    expect(enviadasGmlDe({})).toEqual({ filas: 0, unidades: 0, venta_soles: 0, costo_vendido: 0, stock_unidades: 0, stock_valorizado: 0 });
    expect(enviadasGmlDe({ enviadas_a_gml: { filas: 4, unidades: 1, venta_soles: 2, costo_vendido: 3, stock_unidades: 4, stock_valorizado: 5 } }).filas).toBe(4);
  });

  it("una respuesta de `previsualizar` sin `a_gml` (servidor anterior) se informa como siempre: errores y nada enviado", () => {
    const m = mes(armar([{}, { equivalencia: "JEAN" }]));
    expect(m.enviadas_a_gml.filas).toBe(0);
    expect(m.exclusiones[0].motivo).toBe("equivalencia_inexistente");
  });
});

describe("Asignar sobre un grupo enviado a la GML (origen derivado y mapeo que gana)", () => {
  const FILAS: Partial<FilaCruda>[] = [
    { equivalencia: "JEAN", venta_soles: "100" },
    { equivalencia: "JEAN", marca: "BETA", venta_soles: "50" },
    { equivalencia: "JEAN", marca: "VIEJA", venta_soles: "999" }, // marca desactivada: no llega a cargable
    { genero: "MUJER", equivalencia: "FOO", venta_soles: "70" },
    { mes: "Ago", equivalencia: "JEAN", venta_soles: "25" },
    { tienda: "", equivalencia: "JEAN", venta_soles: "7" }, // tienda vacía gana: no es origen
    {},
  ];
  const r = armar(FILAS, { enviarAGml: true });
  const res = resoluciones(r.acumulador, { enviarAGml: true });
  const indice = construirIndiceOrigenes(r.acumulador, res);

  it("cada valor enviado tiene orígenes con exactamente sus filas y medidas, con el motivo original", () => {
    for (const m of r.informe.meses) {
      for (const d of m.enviadas_a_gml_detalle) {
        const origenes = origenesDeEnviada(indice, m.periodo, d);
        const clave = `${m.periodo} ${d.valor}`;
        expect(origenes.length, clave).toBeGreaterThan(0);
        expect(origenes.reduce((s, o) => s + o.filas, 0), clave).toBe(d.filas);
        expect(origenes.reduce((s, o) => s + o.venta_soles, 0), clave).toBeCloseTo(d.venta_soles, 2);
        for (const o of origenes) expect(o.motivo, clave).toBe(d.motivo);
      }
    }
  });

  it("el índice no mezcla los grupos enviados con los de error: sin el envío no hay entradas `enviadas_a_gml`", () => {
    const sin = construirIndiceOrigenes(r.acumulador, resoluciones(r.acumulador));
    expect([...sin.keys()].some((k) => k.includes("enviadas_a_gml"))).toBe(false);
    expect([...indice.keys()].some((k) => k.includes("enviadas_a_gml"))).toBe(true);
  });

  it("ida y vuelta: mapear los orígenes derivados los saca de 'enviadas' y las filas pasan a reasignadas (el mapeo gana)", () => {
    // El mismo origen puede aparecer en dos meses: un mapeo por origen distinto.
    const origenes = [...new Map([...indice.values()].flat().map((o) => [o.clave, o])).values()];
    const mapeos = origenes.map((o, i) => mapeo(`m${i}`, [o.origen.genero, o.origen.mundo, o.origen.linea, o.origen.equivalencia], "e1s"));
    const despues = armar(FILAS, { enviarAGml: true, mapeos });
    for (const m of despues.informe.meses) {
      expect(m.enviadas_a_gml.filas).toBe(0);
      expect(m.enviadas_a_gml_detalle).toEqual([]);
      expect(m.identidad_ok).toBe(true);
    }
    const antes = r.informe.meses.reduce((s, m) => s + m.enviadas_a_gml.filas, 0);
    const reasignadas = despues.informe.meses.reduce((s, m) => s + m.reasignadas.filas, 0);
    expect(reasignadas).toBe(antes);
    // y los mapeos creados con el origen de un grupo enviado son válidos (no es "obsoleto": no resuelve en el árbol)
    const plan = planificarCrearMapeos(
      origenes.map((o) => ({ origen: o.origen, equivalencia_id: "e1s", motivo_origen: o.motivo })),
      ARBOL,
      []
    );
    expect(plan.error).toBeNull();
  });
});

describe("estático: guards y alcance intactos", () => {
  const RAIZ = path.resolve(__dirname, "..");
  const leer = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

  it("previsualizar sigue empezando con requirePlanner y activa el envío a la GML con el resolutor de mapeos", () => {
    const f = leer("src/app/api/ventas/previsualizar/route.ts");
    expect(f).toMatch(/export async function POST\([^)]*\)\s*\{\s*const \{[^}]*\} = await requirePlanner\(\);/);
    expect(f).toMatch(/crearResolutorCombinaciones\(\s*arbol\.estado,[\s\S]*\{ enviarAGml: true \}\s*\)/);
    expect(f).not.toMatch(/requireUser|requireAdmin|supabaseServer/);
  });

  it("solo previsualizar activa el envío: mapeos, sugerencias y el resto del código lo dejan apagado", () => {
    for (const rel of ["src/lib/ventas/mapeos.ts", "src/lib/ventas/sugerir-mapeo.ts", "src/app/api/ventas/mapeos/route.ts", "src/app/api/ventas/mapeos/importar/route.ts"]) {
      expect(leer(rel), rel).not.toContain("enviarAGml");
    }
  });

  it("los tipos del frontend siguen autocontenidos (tipos-api.ts solo importa tipos de tipos-mapeo)", () => {
    const f = leer("src/lib/ventas/tipos-api.ts");
    for (const m of f.matchAll(/^import[^;]*?from\s+["']([^"']+)["']/gm)) {
      expect(m[0]).toMatch(/^import type /);
      expect(m[1]).toMatch(/^\.\/tipos-(api|mapeo)$/);
    }
  });
});

/** Pseudoaleatorio con semilla fija (mulberry32). */
function aleatorioSemilla(semilla: number) {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
