import { describe, expect, it } from "vitest";
import {
  agruparPorClave,
  ambitoSugerido,
  aplicarGenero,
  aplicarMundos,
  avisoMarcaSinClave,
  claveDeRegla,
  consultaVista,
  cuerpoCrear,
  cuerpoEditar,
  esMes,
  estadoAplicable,
  filtrarReglas,
  filtrosEfectivos,
  formatearImi,
  hayCambios,
  hayFiltrosActivos,
  indiceNodos,
  leerDecimal,
  leerParametros,
  mesDe,
  MESES_ADELANTE,
  MESES_ATRAS,
  mesPropuesto,
  nodosDelArbol,
  nodosParaSelector,
  opcionesMarca,
  opcionesMes,
  ordenarReglas,
  PARAMETROS_VACIOS,
  parametrosTrasGuardar,
  pctCd,
  periodoCorto,
  reglaAnterior,
  resumenReglas,
  rigeEn,
  sumarMeses,
  textoConfirmarEliminar,
  textoErrorAccion,
  textoObservado,
  textoResumen,
  textoTablaVacia,
  urlAplicabilidad,
  urlReglas,
  validarRegla,
  VALORES_VACIOS,
  valoresDeRegla,
  valoresNuevaVigencia,
  type ParametrosVista,
} from "../src/app/(app)/maestros/intercompany/vista";
import { arbolEjemplo, IDS, regla, reglasEjemplo } from "./intercompany.pantalla.fixture";

/** Presentación pura de /maestros/intercompany (M13): URL, filtros del ámbito sugerido, formulario, validaciones y textos. */

const nodos = nodosDelArbol(arbolEjemplo());
const indice = indiceNodos(nodos);
const sinParametros = (): ParametrosVista => ({ ...PARAMETROS_VACIOS });

describe("meses", () => {
  it("suma y resta meses cruzando el año y da el nombre corto", () => {
    expect(sumarMeses("2026-11", 3)).toBe("2027-02");
    expect(sumarMeses("2026-01", -1)).toBe("2025-12");
    expect(sumarMeses("2026-10", 0)).toBe("2026-10");
    expect(periodoCorto("2026-09")).toBe("set-2026");
    expect(periodoCorto("2026-09-01")).toBe("set-2026");
  });
  it("el mes en curso se lee en la zona de Lima (UTC−5), no en la hora del navegador ni en UTC", () => {
    expect(mesDe(new Date("2026-10-18T15:00:00Z"))).toBe("2026-10");
    // 31 oct 22:00 en Lima ya es 1 nov en UTC: sigue siendo octubre.
    expect(mesDe(new Date("2026-11-01T03:00:00Z"))).toBe("2026-10");
    // 1 oct 00:00 en Lima (05:00 UTC) es octubre; un segundo antes, septiembre.
    expect(mesDe(new Date("2026-10-01T05:00:00Z"))).toBe("2026-10");
    expect(mesDe(new Date("2026-10-01T04:59:59Z"))).toBe("2026-09");
    expect(mesDe(new Date("2027-01-01T04:00:00Z"))).toBe("2026-12");
  });
  it("los selectores de mes llegan al menos 36 meses atrás y 24 adelante", () => {
    expect(MESES_ATRAS).toBeGreaterThanOrEqual(36);
    expect(MESES_ADELANTE).toBeGreaterThanOrEqual(24);
    const o = opcionesMes("2026-10", MESES_ATRAS, MESES_ADELANTE);
    expect(o[0].id).toBe("2023-10");
    expect(o[o.length - 1].id).toBe("2028-10");
  });
  it("el mes propuesto es el siguiente a hoy o, con reglas de la clave por delante, el siguiente a la última", () => {
    const base = regla({ id: "a", vigente_desde: "2026-01" });
    const clave = claveDeRegla(base);
    expect(mesPropuesto("2026-10", [], null)).toBe("2026-11");
    expect(mesPropuesto("2026-10", [base], clave)).toBe("2026-11");
    // Ya hay una regla en el mes siguiente a hoy: propone el siguiente a esa.
    const futura = regla({ id: "b", vigente_desde: "2026-11-01" });
    expect(mesPropuesto("2026-10", [base, futura], clave)).toBe("2026-12");
    // La última puede estar varios meses adelante y no ser la primera de la lista.
    const lejana = regla({ id: "c", vigente_desde: "2027-03" });
    expect(mesPropuesto("2026-10", [lejana, futura, base], clave)).toBe("2027-04");
    // Las reglas de otra clave no cuentan.
    const otra = regla({ id: "d", marca_id: "otra", vigente_desde: "2027-03" });
    expect(mesPropuesto("2026-10", [base, otra], clave)).toBe("2026-11");
  });
  it("tras guardar la pantalla pasa al mes de la regla y queda en la URL; el mes en curso no se escribe", () => {
    const p: ParametrosVista = { ...PARAMETROS_VACIOS, marca: IDS.jh };
    const siguiente = parametrosTrasGuardar(p, "2026-11-01", "2026-10");
    expect(siguiente.mes).toBe("2026-11");
    expect(siguiente.marca).toBe(IDS.jh);
    expect(consultaVista(siguiente)).toContain("mes=2026-11");
    expect(leerParametros((k) => new URLSearchParams(consultaVista(siguiente)).get(k)).mes).toBe("2026-11");
    expect(parametrosTrasGuardar({ ...p, mes: "2027-02" }, "2026-10", "2026-10").mes).toBeNull();
    expect(parametrosTrasGuardar(p, "2026-10-01", "2026-10").mes).toBeNull();
    expect(parametrosTrasGuardar(p, "2025-03", "2026-10").mes).toBe("2025-03");
  });
  it("la tabla vacía distingue un mes sin reglas, el ámbito que oculta y los filtros elegidos", () => {
    const sin = textoTablaVacia({ mes: "2026-10", filtrosActivos: false, vigentesEnMes: 0 });
    expect(sin).toContain("empiezan en un mes posterior");
    const oculta = textoTablaVacia({ mes: "2026-10", filtrosActivos: false, vigentesEnMes: 2 });
    expect(oculta).toContain("2 reglas vigentes");
    expect(oculta).toContain("ámbito sugerido");
    expect(oculta).not.toContain("mes posterior");
    expect(textoTablaVacia({ mes: "2026-10", filtrosActivos: false, vigentesEnMes: 1 })).toContain("queda oculta");
    const filtros = textoTablaVacia({ mes: "2026-10", filtrosActivos: true, vigentesEnMes: 3 });
    expect(filtros).toContain("con estos filtros");
    expect(filtros).not.toContain("mes posterior");
  });
  it("valida aaaa-mm", () => {
    expect(esMes("2026-10")).toBe(true);
    expect(esMes("2026-13")).toBe(false);
    expect(esMes("2026-10-01")).toBe(false);
    expect(esMes(null)).toBe(false);
  });
  it("las opciones de mes van ordenadas, sin repetir, e incluyen los meses extra fuera de rango", () => {
    const o = opcionesMes("2026-10", 1, 1, ["2025-03", "2026-10", "no-es-mes"]);
    expect(o.map((x) => x.id)).toEqual(["2025-03", "2026-09", "2026-10", "2026-11"]);
    expect(o[0].nombre).toBe("mar-2025");
  });
});

describe("números", () => {
  it("lee decimales con coma o punto y rechaza lo que no es número", () => {
    expect(leerDecimal("4")).toBe(4);
    expect(leerDecimal(" 4,5 ")).toBe(4.5);
    expect(leerDecimal("4.5")).toBe(4.5);
    expect(leerDecimal("")).toBeNull();
    expect(leerDecimal("abc")).toBeNull();
    expect(leerDecimal("4,5,6")).toBeNull();
  });
  it("el % del CD es 100 menos el directo y el IMI lleva un decimal", () => {
    expect(pctCd(80)).toBe(20);
    expect(pctCd(33.33)).toBe(66.67);
    expect(formatearImi(4)).toBe("4,0");
    expect(formatearImi(7.5)).toBe("7,5");
  });
});

describe("estado en la URL", () => {
  it("sin parámetros rige el ámbito sugerido y la pestaña Reglas", () => {
    expect(leerParametros(() => null)).toEqual(PARAMETROS_VACIOS);
    expect(consultaVista(PARAMETROS_VACIOS)).toBe("");
  });
  it("lee y escribe pestaña, marca, género, mundos, línea, mes y solo; ida y vuelta", () => {
    const p: ParametrosVista = {
      pestana: "historial",
      marca: IDS.jh,
      genero: { tipo: "uno", id: IDS.mujer },
      mundo: { tipo: "varios", ids: [IDS.casual, IDS.ri] },
      linea: IDS.lineaPolo,
      mes: "2026-07",
      solo: ["no_aplicables", "fuera_de_ambito"],
    };
    const q = new URLSearchParams(consultaVista(p));
    expect(leerParametros((k) => q.get(k))).toEqual(p);
  });
  it("`todos` quita el ámbito sugerido y se conserva en la URL", () => {
    const p: ParametrosVista = { ...PARAMETROS_VACIOS, genero: { tipo: "todos" }, mundo: { tipo: "todos" } };
    const q = new URLSearchParams(consultaVista(p));
    expect(q.get("genero")).toBe("todos");
    expect(q.get("mundo")).toBe("todos");
    expect(leerParametros((k) => q.get(k))).toEqual(p);
  });
  it("un valor inválido cae al defecto y nunca rompe", () => {
    const valores: Record<string, string> = { pestana: "otra", marca: "no-uuid", genero: "x", mundo: "a,b", linea: "1", mes: "2026-99", solo: "inventado" };
    expect(leerParametros((k) => valores[k] ?? null)).toEqual(PARAMETROS_VACIOS);
  });
  it("las URLs de la API llevan el mes y, con historial, la bandera", () => {
    expect(urlReglas("2026-10", false)).toBe("/api/intercompany/reglas?mes=2026-10");
    expect(urlReglas("2026-10", true)).toBe("/api/intercompany/reglas?mes=2026-10&incluir_historial=1");
    expect(urlAplicabilidad("", IDS.nodoCamisa)).toBeNull();
    expect(urlAplicabilidad(IDS.jh, IDS.nodoCamisa)).toBe(`/api/intercompany/aplicabilidad?marca_id=${IDS.jh}&genero_mundo_linea_id=${IDS.nodoCamisa}`);
  });
});

describe("ámbito sugerido y filtros", () => {
  it("el ámbito sugerido es HOMBRE con FORMAL, CASUAL y RI (no URBANO)", () => {
    const a = ambitoSugerido(nodos);
    expect(a.generoId).toBe(IDS.hombre);
    expect([...a.mundoIds].sort()).toEqual([IDS.formal, IDS.casual, IDS.ri].sort());
    expect(a.mundoIds).not.toContain(IDS.urbano);
  });
  it("por defecto filtra a hombre formal, casual y RI; las reglas fuera quedan ocultas", () => {
    const f = filtrosEfectivos(sinParametros(), nodos);
    const ids = filtrarReglas(reglasEjemplo(), f, indice).map((r) => r.id);
    expect(ids).toEqual(["r1", "r1b", "r2", "r3", "r4", "r5"]);
  });
  it("con género y mundo en `todos` se ven todas, también la de MUJER", () => {
    const f = filtrosEfectivos({ ...sinParametros(), genero: { tipo: "todos" }, mundo: { tipo: "todos" } }, nodos);
    expect(filtrarReglas(reglasEjemplo(), f, indice)).toHaveLength(7);
  });
  it("`solo fuera de ámbito` suspende el ámbito sugerido: si no, nunca mostraría nada", () => {
    const f = filtrosEfectivos({ ...sinParametros(), solo: ["fuera_de_ambito"] }, nodos);
    expect(filtrarReglas(reglasEjemplo(), f, indice).map((r) => r.id)).toEqual(["r6"]);
  });
  it("`solo no aplicables` solo muestra las que dicen aplicable = false (las no evaluadas no cuentan)", () => {
    const f = filtrosEfectivos({ ...sinParametros(), solo: ["no_aplicables"] }, nodos);
    expect(filtrarReglas(reglasEjemplo(), f, indice).map((r) => r.id)).toEqual(["r4"]);
  });
  it("marca, línea y mundo se combinan con Y", () => {
    const base = sinParametros();
    expect(filtrarReglas(reglasEjemplo(), filtrosEfectivos({ ...base, marca: IDS.vanHeusen }, nodos), indice).map((r) => r.id)).toEqual(["r4", "r5"]);
    expect(filtrarReglas(reglasEjemplo(), filtrosEfectivos({ ...base, linea: IDS.lineaTerno }, nodos), indice).map((r) => r.id)).toEqual(["r3"]);
    expect(filtrarReglas(reglasEjemplo(), filtrosEfectivos({ ...base, mundo: { tipo: "varios", ids: [IDS.ri] } }, nodos), indice).map((r) => r.id)).toEqual(["r5"]);
  });
  it("sin árbol (todavía cargando) no se filtra por ámbito y nada se rompe", () => {
    const f = filtrosEfectivos(sinParametros(), []);
    expect(f.generoId).toBeNull();
    expect(f.mundoIds).toBeNull();
    expect(filtrarReglas(reglasEjemplo(), f, new Map())).toHaveLength(7);
  });
  it("elegir en los selectores el valor sugerido equivale a no tocarlo", () => {
    expect(aplicarGenero(IDS.hombre, nodos)).toEqual({ tipo: "defecto" });
    expect(aplicarGenero(IDS.mujer, nodos)).toEqual({ tipo: "uno", id: IDS.mujer });
    expect(aplicarGenero("todos", nodos)).toEqual({ tipo: "todos" });
    expect(aplicarMundos([IDS.ri, IDS.formal, IDS.casual], nodos)).toEqual({ tipo: "defecto" });
    expect(aplicarMundos([IDS.ri], nodos)).toEqual({ tipo: "varios", ids: [IDS.ri] });
    expect(aplicarMundos([], nodos)).toEqual({ tipo: "todos" });
  });
  it("hayFiltrosActivos distingue el defecto de un filtro elegido", () => {
    expect(hayFiltrosActivos(PARAMETROS_VACIOS)).toBe(false);
    expect(hayFiltrosActivos({ ...PARAMETROS_VACIOS, marca: IDS.jh })).toBe(true);
    expect(hayFiltrosActivos({ ...PARAMETROS_VACIOS, genero: { tipo: "todos" } })).toBe(true);
  });
  it("el selector de GML del formulario muestra por defecto solo el ámbito y siempre el nodo ya elegido", () => {
    const ambito = nodosParaSelector(nodos, true).map((n) => n.linea);
    // Ordenados por la ruta completa (género · mundo · línea): CASUAL, FORMAL y RI.
    expect(ambito).toEqual(["POLO", "CAMISA", "TERNO", "CASACA"]);
    expect(nodosParaSelector(nodos, false)).toHaveLength(6);
    expect(nodosParaSelector(nodos, true, IDS.nodoDenim).map((n) => n.linea)).toContain("DENIM");
  });
});

describe("orden, claves y secuencias", () => {
  it("ordena por marca, ruta y la vigencia más reciente primero, sin mutar la entrada", () => {
    const entrada = reglasEjemplo();
    const copia = entrada.map((r) => r.id);
    const o = ordenarReglas(entrada).map((r) => r.id);
    expect(entrada.map((r) => r.id)).toEqual(copia);
    expect(o.slice(0, 3)).toEqual(["r3", "r1b", "r1"]);
  });
  it("la clave distingue la equivalencia del GML entero", () => {
    const r = reglasEjemplo();
    expect(claveDeRegla(r[0])).not.toBe(claveDeRegla(r[2]));
    expect(claveDeRegla(r[0])).toBe(claveDeRegla(r[1]));
  });
  it("agrupa por clave con la secuencia de la más antigua a la más reciente; la regla de equivalencia no se mezcla con la del GML", () => {
    const g = agruparPorClave([...reglasEjemplo()].reverse());
    const camisa = g.find((x) => x.ruta === "HOMBRE · FORMAL · CAMISA");
    expect(camisa?.reglas.map((r) => r.id)).toEqual(["r1", "r1b"]);
    expect(g.find((x) => x.ruta.endsWith("MANGA CORTA"))?.reglas).toHaveLength(1);
    expect(g).toHaveLength(6);
  });
  it("la regla anterior es la de la misma clave exacta justo antes; sin ella, null", () => {
    const r = reglasEjemplo();
    expect(reglaAnterior(r[1], r)?.id).toBe("r1");
    expect(reglaAnterior(r[0], r)).toBeNull();
    expect(reglaAnterior(r[2], r)).toBeNull();
  });
  it("rige en el mes: desde inclusive hasta el derivado inclusive; sin hasta, abierta", () => {
    const r = reglasEjemplo();
    expect(rigeEn(r[0], "2025-12")).toBe(false);
    expect(rigeEn(r[0], "2026-01")).toBe(true);
    expect(rigeEn(r[0], "2026-05")).toBe(true);
    expect(rigeEn(r[0], "2026-06")).toBe(false);
    expect(rigeEn(r[1], "2030-01")).toBe(true);
  });
});

describe("resumen y estados", () => {
  it("cuenta no aplicables, fuera de ámbito y rangos editados", () => {
    const s = resumenReglas(reglasEjemplo());
    expect(s).toEqual({ reglas: 7, noAplicables: 1, fueraDeAmbito: 1, rangoEditado: 3 });
    expect(textoResumen(s)).toBe("7 reglas vigentes · 1 no aplicable · 1 fuera de ámbito · rango por defecto 4–8 (editado en 3 reglas)");
    expect(textoResumen(resumenReglas([regla({ id: "x" })]))).toBe("1 regla vigente · 0 no aplicables · 0 fuera de ámbito · rango por defecto 4–8");
  });
  it("aplicable: sí, no con atajo y se sabrá al cerrar", () => {
    expect(estadoAplicable({ aplicable: true, motivo_no_aplicable: null })).toMatchObject({ texto: "Sí", tono: "exito", atajo: false });
    expect(estadoAplicable({ aplicable: false, motivo_no_aplicable: "marca_sin_clave" })).toMatchObject({ texto: "No: sin clave", tono: "alerta", atajo: true });
    expect(estadoAplicable({ aplicable: null, motivo_no_aplicable: "sin_cerrada" })).toMatchObject({ tono: "neutro", atajo: false });
  });
  it("el % observado de M8 va vacío hasta que exista y luego con su periodo", () => {
    expect(textoObservado(null)).toBe("—");
    expect(textoObservado({ periodo: "2026-09", valor: 80 })).toBe("80 % (set-2026)");
  });
});

describe("formulario de regla", () => {
  const ok = { ...VALORES_VACIOS("2026-11"), marcaId: IDS.jh, nodoId: IDS.nodoCamisa, pct: "80" };
  const existentes = reglasEjemplo();

  it("una regla nueva arranca con el rango por defecto 4–8 y se valida", () => {
    expect(VALORES_VACIOS("2026-11")).toMatchObject({ imiMin: "4", imiMax: "8", pct: "" });
    expect(validarRegla(ok, { existentes }).valida).toBe(true);
  });
  it("pide marca, GML, mes y porcentaje", () => {
    const { errores, valida } = validarRegla({ ...VALORES_VACIOS("2026-11") }, { existentes });
    expect(valida).toBe(false);
    expect(Object.keys(errores).sort()).toEqual(["marcaId", "nodoId", "pct"]);
    expect(validarRegla({ ...ok, mes: "" }, { existentes }).errores.mes).toBeTruthy();
  });
  it("el tope no puede ser menor que el mínimo y el rango va de 0,5 a 24 con un decimal", () => {
    expect(validarRegla({ ...ok, imiMin: "4", imiMax: "3" }, { existentes }).errores.imiMax).toBe("El máximo no puede ser menor que el mínimo.");
    expect(validarRegla({ ...ok, imiMin: "0,4" }, { existentes }).errores.imiMin).toBeTruthy();
    expect(validarRegla({ ...ok, imiMax: "25" }, { existentes }).errores.imiMax).toBeTruthy();
    expect(validarRegla({ ...ok, imiMin: "4,25" }, { existentes }).errores.imiMin).toBeTruthy();
    expect(validarRegla({ ...ok, imiMin: "", imiMax: "x" }, { existentes }).valida).toBe(false);
    expect(validarRegla({ ...ok, imiMin: "4", imiMax: "4" }, { existentes }).valida).toBe(true);
  });
  it("el porcentaje va de 0 a 100 con hasta dos decimales", () => {
    expect(validarRegla({ ...ok, pct: "100,5" }, { existentes }).errores.pct).toBeTruthy();
    expect(validarRegla({ ...ok, pct: "-1" }, { existentes }).errores.pct).toBeTruthy();
    expect(validarRegla({ ...ok, pct: "33,333" }, { existentes }).errores.pct).toBeTruthy();
    expect(validarRegla({ ...ok, pct: "0" }, { existentes }).valida).toBe(true);
    expect(validarRegla({ ...ok, pct: "100" }, { existentes }).valida).toBe(true);
  });
  it("la nota admite 200 caracteres", () => {
    expect(validarRegla({ ...ok, nota: "a".repeat(200) }, { existentes }).valida).toBe(true);
    expect(validarRegla({ ...ok, nota: "a".repeat(201) }, { existentes }).errores.nota).toBeTruthy();
  });
  it("avisa clave + mes repetidos antes de enviar; otra equivalencia u otro mes no cuentan; editar ignora la propia regla", () => {
    const repetida = { ...ok, mes: "2026-01" };
    expect(validarRegla(repetida, { existentes }).errores.mes).toBe("Ya hay una regla de esa clave desde ese mes: edítala.");
    expect(validarRegla({ ...repetida, equivalenciaId: IDS.mangaLarga }, { existentes }).valida).toBe(true);
    expect(validarRegla({ ...repetida, mes: "2026-02" }, { existentes }).valida).toBe(true);
    expect(validarRegla(repetida, { existentes, editandoId: "r1" }).valida).toBe(true);
  });
  it("al editar solo se validan rango, porcentaje y nota", () => {
    const r = validarRegla({ ...VALORES_VACIOS(""), pct: "50" }, { existentes, soloRangoYPorcentaje: true });
    expect(r.valida).toBe(true);
  });
  it("nueva vigencia hereda clave, rango, porcentaje y nota de la regla anterior y propone el mes dado", () => {
    const base = existentes[1];
    expect(valoresNuevaVigencia(base, "2026-11")).toEqual({
      marcaId: IDS.jh,
      nodoId: IDS.nodoCamisa,
      equivalenciaId: "",
      mes: "2026-11",
      imiMin: "3",
      imiMax: "6",
      pct: "60",
      nota: "acuerdo nuevo",
    });
    expect(valoresNuevaVigencia(existentes[2], "2026-11").equivalenciaId).toBe(IDS.mangaCorta);
    expect(valoresDeRegla(base).mes).toBe("2026-06");
  });
  it("el cuerpo de crear manda el rango tal como se ve, la equivalencia nula y la nota vacía como null", () => {
    expect(cuerpoCrear({ ...ok, nota: "  " })).toEqual({
      marca_id: IDS.jh,
      genero_mundo_linea_id: IDS.nodoCamisa,
      equivalencia_id: null,
      vigente_desde: "2026-11",
      imi_min: 4,
      imi_max: 8,
      pct_directo: 80,
      nota: null,
    });
    expect(cuerpoCrear({ ...ok, equivalenciaId: IDS.mangaCorta, imiMin: "3,5", pct: "12,5", nota: " verano " })).toMatchObject({ equivalencia_id: IDS.mangaCorta, imi_min: 3.5, pct_directo: 12.5, nota: "verano" });
  });
  it("el cuerpo de editar solo lleva lo que cambió", () => {
    const original = existentes[1];
    const v = valoresDeRegla(original);
    expect(cuerpoEditar(v, original)).toEqual({});
    expect(hayCambios(cuerpoEditar(v, original))).toBe(false);
    expect(cuerpoEditar({ ...v, imiMin: "4", imiMax: "8" }, original)).toEqual({ imi_min: 4, imi_max: 8 });
    expect(cuerpoEditar({ ...v, pct: "85" }, original)).toEqual({ pct_directo: 85 });
    expect(cuerpoEditar({ ...v, nota: "" }, original)).toEqual({ nota: null });
  });
});

describe("marcas del formulario y avisos", () => {
  it("ofrece solo unidades vigentes y no genéricas: un miembro de conjunto se ofrece como su cabeza", () => {
    const marcas = [
      { id: "a", nombre: "JOHN HOLDEN", unidad_marca_id: "a", vigente: true, miembros: 1 },
      { id: "b", nombre: "JOHN", unidad_marca_id: "a", vigente: true, miembros: 0 },
      { id: "c", nombre: "DONATELLI", unidad_marca_id: "c", vigente: true, miembros: 0 },
      { id: "d", nombre: "VARIOS", unidad_marca_id: "d", vigente: true, miembros: 0 },
      { id: "e", nombre: "VIEJA", unidad_marca_id: "e", vigente: false, miembros: 0 },
    ];
    const o = opcionesMarca(marcas, (n) => n === "VARIOS");
    expect(o.map((x) => x.id)).toEqual(["c", "a"]);
    expect(o.find((x) => x.id === "a")?.nombre).toBe("JOHN HOLDEN (con su conjunto)");
  });
  it("el aviso previo solo salta con marca_sin_clave", () => {
    expect(avisoMarcaSinClave({ aplicable: false, motivo_no_aplicable: "marca_sin_clave" })).toBe(true);
    expect(avisoMarcaSinClave({ aplicable: null, motivo_no_aplicable: "sin_cerrada" })).toBe(false);
    expect(avisoMarcaSinClave({ aplicable: true, motivo_no_aplicable: null })).toBe(false);
    expect(avisoMarcaSinClave(null)).toBe(false);
  });
  it("el confirm de eliminar dice qué regla vuelve a regir, o que la clave queda sin reglas", () => {
    const r = reglasEjemplo();
    expect(textoConfirmarEliminar(r[1], r[0])).toContain("Volverá a regir la anterior (desde ene-2026");
    expect(textoConfirmarEliminar(r[0], null)).toContain("quedará sin reglas");
    expect(textoConfirmarEliminar(r[0], null)).toContain("no se puede deshacer");
  });
  it("el error de la API se muestra tal cual; sin texto, el del código de negocio", () => {
    expect(textoErrorAccion({ mensaje: "Ya hay una regla.", codigo: "clave_mes_repetido" })).toBe("Ya hay una regla.");
    expect(textoErrorAccion({ mensaje: "", codigo: "marca_en_conjunto" })).toContain("conjunto");
    expect(textoErrorAccion({ mensaje: "", codigo: null })).toBeTruthy();
  });
});
