import { describe, expect, it } from "vitest";
import { aprobarCrecimientoSchema } from "../src/lib/crecimientos/esquemas";
import {
  NINGUNA,
  anioAplicacionDe,
  anioEnCursoDe,
  bandasDelNino,
  baseInicial,
  consultaApiGM,
  contarEstadosGM,
  cuerpoAprobar,
  dividirRealProyectado,
  equivalenteNormalizado,
  errorDeAprobarGM,
  errorPct,
  estadoEfectivoGM,
  filasCsvLista,
  filasCsvSeries,
  filasDeLista,
  filasTablaAnioMes,
  filtrarFilasGM,
  formatearDifPp,
  formatearPctPlano,
  formatearPctSigno,
  hayReferenciaValida,
  leerPct,
  leerUrlGM,
  lineasDeFoto,
  mesesRealesDelAnioEnCurso,
  motivoNotaObligatoria,
  opcionesDeBase,
  precargaDeBase,
  proximaVersion,
  rangoDeMeses,
  referenciasElegibles,
  seriesDelGrafico,
  temporadasNino,
  textoAprobadoOk,
  textoAvisoNino,
  textoCobertura,
  textoConfirmarGM,
  textoEstadoGM,
  textoFijoLista,
  textoLeyendaTiendas,
  textoSinReferencia,
  textoTiendaMayor,
  textoTotalSinAprobar,
  textoUltimoMes,
  tituloGM,
  urlGM,
  variacionPct,
} from "../src/app/(app)/planificacion/curvas-estacionalidad/genero-mundo/vista";
import {
  CLAVE_HOMBRE_DEPORTIVO,
  CLAVE_HOMBRE_URBANO,
  CLAVE_MUJER_RI,
  PROYECCION_ID,
  detalle,
  detalleSinAprobar,
  fila,
  filaResto,
  lista,
  referencia,
  referenciaMetodoAnterior,
  referenciasEjemplo,
  version,
} from "./crecimientos.pantalla.fixture";

const params = (q: string) => new URLSearchParams(q);

describe("URL de la pestaña (M10)", () => {
  it("?pestana=genero-mundo abre la lista y ?gm abre el detalle (implica la pestaña)", () => {
    expect(leerUrlGM(params(`pestana=genero-mundo&anio=2027&proyeccion=${PROYECCION_ID}`))).toEqual({ gm: null, pestanaGM: true, anio: 2027, proyeccion: PROYECCION_ID });
    expect(leerUrlGM(params(`gm=${CLAVE_HOMBRE_URBANO}&anio=2027`))).toEqual({ gm: CLAVE_HOMBRE_URBANO, pestanaGM: true, anio: 2027, proyeccion: null });
    expect(leerUrlGM(params("gm=resto")).gm).toBe("resto");
    expect(leerUrlGM(params("")).pestanaGM).toBe(false);
  });

  it("ignora valores inválidos en vez de romper", () => {
    const u = leerUrlGM(params("gm=basura&anio=27&proyeccion=nada&pestana=otra"));
    expect(u).toEqual({ gm: null, pestanaGM: false, anio: null, proyeccion: null });
    expect(leerUrlGM(params("anio=1999")).anio).toBeNull();
    expect(leerUrlGM(params("anio=2027abc")).anio).toBeNull();
  });

  it("urlGM y leerUrlGM son inversas, y la lista lleva ?pestana", () => {
    const lista = urlGM("/planificacion/curvas-estacionalidad", { gm: null, anio: 2027, proyeccion: PROYECCION_ID });
    expect(lista).toBe(`/planificacion/curvas-estacionalidad?pestana=genero-mundo&anio=2027&proyeccion=${PROYECCION_ID}`);
    expect(leerUrlGM(params(lista.split("?")[1]))).toMatchObject({ gm: null, pestanaGM: true, anio: 2027, proyeccion: PROYECCION_ID });
    const detalleUrl = urlGM("/x", { gm: CLAVE_MUJER_RI, anio: 2027, proyeccion: null });
    expect(detalleUrl).toBe(`/x?gm=${CLAVE_MUJER_RI}&anio=2027`);
    expect(urlGM("/x", { gm: null, anio: null, proyeccion: null })).toBe("/x?pestana=genero-mundo");
  });

  it("consultaApiGM arma el query de la API o nada", () => {
    expect(consultaApiGM({ anio: null, proyeccion: null })).toBe("");
    expect(consultaApiGM({ anio: 2027, proyeccion: PROYECCION_ID })).toBe(`?anio=2027&proyeccion=${PROYECCION_ID}`);
  });
});

describe("formatos y textos fijos", () => {
  it("formatea porcentajes con signo y puntos", () => {
    expect(formatearPctPlano(15)).toBe("15.0 %");
    expect(formatearPctPlano(null)).toBe("—");
    expect(formatearPctSigno(3)).toBe("+3.0 %");
    expect(formatearPctSigno(-2)).toBe("-2.0 %");
    expect(formatearDifPp(-3.4)).toBe("-3.4 pp");
    expect(formatearDifPp(0.04)).toBe("0.0 pp");
  });

  it("el texto fijo de la lista y el de la proyección sin referencia son los de la ficha", () => {
    expect(textoFijoLista(2027)).toBe("% bruto 2027 frente a 2026 de las mismas tiendas de 2027, sin corregir por el Niño; todas las filas del GM crecen igual.");
    expect(textoSinReferencia(2027)).toBe("No hay proyección de 2026 calculada con el método actual: recalcula la proyección para ver «Cierre proyectado», «Aplicado hoy» y la base 2027.");
    expect(textoUltimoMes("2026-09")).toBe("setiembre 2026");
  });

  it("tituloGM y estados", () => {
    expect(tituloGM(fila())).toBe("HOMBRE · URBANO");
    expect(tituloGM(filaResto())).toBe("Resto");
    expect(textoEstadoGM(fila())).toBe("Aprobado v2");
    expect(textoEstadoGM(fila({ vigente: null, estado: "sin_aprobar" }))).toBe("Sin aprobar");
    expect(textoEstadoGM(fila({ estado: "obsoleto", motivo_obsoleto: "composicion" }))).toContain("Obsoleto: ");
    expect(textoEstadoGM(fila({ detallable: false }))).toBe("Sigue al Resto");
    expect(textoTotalSinAprobar(3)).toBe("3 GM sin aprobar siguen al Resto");
    expect(textoTotalSinAprobar(1)).toBe("1 GM sin aprobar sigue al Resto");
  });
});

describe("lista: filtros, orden, Resto y Total", () => {
  const l = lista();

  it("los géneros que siguen al Resto van al final y se cuentan aparte", () => {
    const orden = filtrarFilasGM(l.filas, { estado: "todos", genero: "" }).map((f) => f.clave);
    expect(orden[orden.length - 1]).toContain("3333");
    expect(estadoEfectivoGM(l.filas[3])).toBe("sigue_resto");
    expect(contarEstadosGM(l.filas)).toEqual({ todos: 4, sin_aprobar: 1, aprobado: 1, obsoleto: 1, sigue_resto: 1 });
  });

  it("filtra por estado y por género; el Resto y el Total siempre van", () => {
    const soloObsoletos = filasDeLista(l, { estado: "obsoleto", genero: "" });
    expect(soloObsoletos.map((x) => x.tipo)).toEqual(["gm", "resto", "total"]);
    expect(soloObsoletos[0].tipo === "gm" && soloObsoletos[0].fila.clave).toBe(CLAVE_HOMBRE_DEPORTIVO);
    const mujer = filasDeLista(l, { estado: "todos", genero: "MUJER" });
    expect(mujer.filter((x) => x.tipo === "gm")).toHaveLength(1);
    expect(filasDeLista(l, { estado: "todos", genero: "" }).map((x) => x.tipo)).toEqual(["gm", "gm", "gm", "gm", "resto", "total"]);
  });

  it("referencia válida: solo método 4 o posterior", () => {
    expect(hayReferenciaValida(l)).toBe(true);
    expect(referenciasElegibles(l).map((p) => p.nombre)).toEqual(["Proyección 2026"]);
    const sin = lista({ proyeccion_referencia: null, proyecciones_disponibles: [] });
    expect(hayReferenciaValida(sin)).toBe(false);
    const vieja = lista({ proyeccion_referencia: { id: PROYECCION_ID, nombre: "P", calculado_at: null, version_metodo: 3 } });
    expect(hayReferenciaValida(vieja)).toBe(false);
  });

  it("el CSV trae una fila por GM visible y el Resto, con la misma cantidad de columnas", () => {
    const { campos, datos } = filasCsvLista(l, l.filas);
    expect(datos).toHaveLength(l.filas.length + 1);
    for (const d of datos) expect(d).toHaveLength(campos.length);
    expect(campos).toContain("Unidades 2025");
    expect(datos.at(-1)?.[0]).toBe("RESTO");
  });
});

describe("curva de venta", () => {
  const d = detalle();

  it("2026 se parte en real continuo y proyectado discontinuo, unidos en el último mes real", () => {
    const series = seriesDelGrafico(d, "unidades");
    const claves = series.map((s) => s.clave);
    expect(claves).toEqual(["anio-2023", "anio-2024", "anio-2025", "anio-2026-real", "anio-2026-proy"]);
    const real = series.find((s) => s.clave === "anio-2026-real")!;
    const proy = series.find((s) => s.clave === "anio-2026-proy")!;
    expect(real.trazo).toBe("continuo");
    expect(proy.trazo).toBe("discontinuo");
    expect(real.valores.filter((v) => v !== null)).toHaveLength(9);
    expect(proy.valores[8]).toBe(real.valores[8]);
    expect(proy.valores[7]).toBeNull();
    expect(proy.valores.filter((v) => v !== null)).toHaveLength(4);
    expect(real.etiqueta).toBe("2026 real (ene–set)");
    expect(series.find((s) => s.clave === "anio-2026-real")!.grupo).toBe(series.find((s) => s.clave === "anio-2026-proy")!.grupo);
  });

  it("Sin Niño usa los meses sin Niño y Forma usa fracciones más la forma típica", () => {
    const sin = seriesDelGrafico(d, "sin_nino").find((s) => s.clave === "anio-2026-real")!;
    expect(sin.valores[5]).toBe(d.series[3].meses_sin_nino[5]);
    const forma = seriesDelGrafico(d, "forma");
    const f2025 = forma.find((s) => s.clave === "anio-2025")!;
    expect(f2025.valores[6]).toBeCloseTo((d.series[2].forma[6] as number) / 100, 6);
    expect(forma.at(-1)?.clave).toBe("forma-tipica");
    expect(seriesDelGrafico(d, "unidades").some((s) => s.clave === "forma-tipica")).toBe(false);
  });

  it("dividirRealProyectado sin meses proyectados deja todo real", () => {
    const r = dividirRealProyectado([1, 2, 3], ["real", "real", "real"]);
    expect(r.proyectado).toBeNull();
    expect(r.real).toEqual([1, 2, 3]);
    const p = dividirRealProyectado([1, 2, null, 4], ["real", "real", null, "proyectado"]);
    expect(p.real).toEqual([1, 2, null, null]);
    expect(p.proyectado).toEqual([null, 2, null, 4]);
  });

  it("año en curso y meses reales salen de los meses proyectados", () => {
    expect(anioEnCursoDe(d.series)).toBe(2026);
    expect(mesesRealesDelAnioEnCurso(d.series)).toBe(9);
    expect(anioAplicacionDe(d)).toBe(2027);
  });

  it("las bandas del Niño dicen «factor parcial (ene–set)» cuando el factor es parcial (I7)", () => {
    const b = bandasDelNino(d);
    expect(b[0].texto).toBe("Niño 2026 · invierno (may–set): factor 0.80 · factor parcial (ene–set)");
    expect(b[1].texto).toBe("Niño 2023 · verano (ene–mar, dic): factor 1.31");
    expect(rangoDeMeses([6, 7, 8, 9])).toBe("jun–set");
    expect(rangoDeMeses([12, 1, 2, 3])).toBe("ene–mar, dic");
    expect(bandasDelNino({ ...d, bandas_nino: [{ ...d.bandas_nino[0], factor: null }] })[0].texto).toContain("sin factor");
  });

  it("la tabla año × mes trae total y variación frente al año anterior; en Forma no hay total ni variación", () => {
    const filas = filasTablaAnioMes(d, "unidades");
    expect(filas.map((f) => f.anio)).toEqual([2023, 2024, 2025, 2026]);
    expect(filas[0].variacion).toBeNull();
    expect(filas[1].variacion).toBeCloseTo((filas[1].total! / filas[0].total! - 1) * 100, 6);
    expect(filas[3].incompleto).toBe(true);
    const forma = filasTablaAnioMes(d, "forma");
    expect(forma.every((f) => f.total === null && f.variacion === null)).toBe(true);
    const sin = filasTablaAnioMes(d, "sin_nino");
    expect(sin[3].total).toBe(d.series[3].total_sin_nino);
    expect(variacionPct(10, 0)).toBeNull();
    expect(variacionPct(11, 10)).toBeCloseTo(10, 6);
  });

  it("el CSV trae tres filas por año con los doce meses", () => {
    const { campos, datos } = filasCsvSeries(d);
    expect(datos).toHaveLength(12);
    for (const fila of datos) expect(fila).toHaveLength(campos.length);
    expect(datos.filter((f) => f[1] === "Unidades")).toHaveLength(4);
    expect(datos.find((f) => f[0] === 2026 && f[1] === "Unidades")?.at(-1)).toBe(3);
  });

  it("la leyenda de tiendas dice cuántas y desde cuándo", () => {
    expect(textoLeyendaTiendas(d, 2026)).toBe("Mismas tiendas de 2026: 9 tiendas (abiertas todo 2025 y ene–set 2026).");
  });
});

describe("cómo crece: marcas y textos", () => {
  it("tienda mayor, cobertura y aviso del Niño", () => {
    const r = referencia();
    expect(textoTiendaMayor(r)).toBe("T07 aporta el 38.5 % de 2025; sin ella, +1.2 %");
    expect(textoCobertura(r, 9)).toBe("ene–set es el 74 % del año 2025");
    expect(textoCobertura(referencia({ tipo: "anio_completo" }), 9)).toBeNull();
    expect(textoTiendaMayor(referencia({ tienda_mayor: null }))).toBeNull();
    expect(textoTiendaMayor(referencia({ tienda_mayor: { codigo: "T01", aporte_pct: 100, pct_sin_ella: null } }))).toContain("sin ella no quedan tiendas");
    expect(temporadasNino(detalle().bandas_nino, 2026)).toEqual(["invierno"]);
    expect(textoAvisoNino(2026, ["invierno"], 7.1)).toBe("2026 fue Niño en invierno: compara con las cifras sin Niño + rebote (rebote del Niño: +7.1 %).");
  });
});

describe("aprobar: base, precarga y nota (R-N)", () => {
  const refs = referenciasEjemplo();

  it("cada referencia se ofrece en sus dos variantes; sin rebote la variante sin Niño sale deshabilitada con su motivo", () => {
    const o = opcionesDeBase(refs);
    expect(o).toHaveLength(8);
    expect(o.find((x) => x.id === "acumulado||sin_nino_mas_rebote")?.valor).toBe(18.4);
    expect(o.find((x) => x.id === "anio_completo|2025|bruto")?.valor).toBe(5);
    const sinRebote = opcionesDeBase([referencia({ equivalente: { bruto: 3, sin_nino_mas_rebote: null } })]);
    expect(sinRebote[1].valor).toBeNull();
    expect(sinRebote[1].motivo).toContain("rebote");
    const metodo3 = opcionesDeBase([referenciaMetodoAnterior("cierre_proyectado")]);
    expect(metodo3.every((x) => x.valor === null)).toBe(true);
    expect(metodo3[0].motivo).toContain("método anterior");
  });

  it("la base inicial es Acumulado en su variante por defecto; si no se puede calcular, la primera disponible", () => {
    expect(baseInicial(refs)).toBe("acumulado||sin_nino_mas_rebote");
    const sinAcum = [referencia({ equivalente: { bruto: null, sin_nino_mas_rebote: null }, motivo_nulo: "sin_venta" }), referencia({ tipo: "anio_completo", anio: 2025, variante_defecto: "bruto" })];
    expect(baseInicial(sinAcum)).toBe("anio_completo|2025|bruto");
    expect(baseInicial([referenciaMetodoAnterior("aplicado_hoy")])).toBe(NINGUNA);
  });

  it("precarga a un decimal y lee coma o punto", () => {
    expect(precargaDeBase(18.43)).toBe(18.4);
    expect(precargaDeBase(18.45)).toBe(18.5);
    expect(precargaDeBase(null)).toBeNull();
    expect(leerPct("15,5")).toBe(15.5);
    expect(leerPct(" 15.5 ")).toBe(15.5);
    expect(leerPct("quince")).toBeNull();
    expect(leerPct("")).toBeNull();
    expect(errorPct("")).toContain("Escribe");
    expect(errorPct("abc")).toContain("número");
    expect(errorPct("-96")).toContain("−95");
    expect(errorPct("501")).toContain("500");
    expect(errorPct("-95")).toBeNull();
    expect(errorPct("500")).toBeNull();
  });

  it("la nota es obligatoria sin base, sin valor de base o con más de 0,5 puntos de diferencia; con la base precargada no", () => {
    expect(motivoNotaObligatoria({ pct: 15, tipoBase: "acumulado", valorBase: 18.4 })).toContain("3.4 puntos");
    expect(motivoNotaObligatoria({ pct: 18.4, tipoBase: "acumulado", valorBase: 18.4 })).toBeNull();
    expect(motivoNotaObligatoria({ pct: 17.9, tipoBase: "acumulado", valorBase: 18.4 })).toBeNull();
    expect(motivoNotaObligatoria({ pct: 17.8, tipoBase: "acumulado", valorBase: 18.4 })).not.toBeNull();
    expect(motivoNotaObligatoria({ pct: 18.9, tipoBase: "acumulado", valorBase: 18.4 })).toBeNull();
    expect(motivoNotaObligatoria({ pct: 10, tipoBase: NINGUNA, valorBase: null })).toContain("base");
    expect(motivoNotaObligatoria({ pct: 10, tipoBase: "aplicado_hoy", valorBase: null })).toContain("no se pudo calcular");
  });

  it("equivale sobre la base normalizada por el Niño; sin rebote no hay equivalente", () => {
    expect(equivalenteNormalizado(15, 7.1)).toBeCloseTo(7.4, 1);
    expect(equivalenteNormalizado(15, null)).toBeNull();
    expect(equivalenteNormalizado(null, 7.1)).toBeNull();
  });

  it("la próxima versión es la mayor + 1", () => {
    expect(proximaVersion([])).toBe(1);
    expect(proximaVersion([{ version: 1 }, { version: 3 }, { version: 2 }])).toBe(4);
  });

  it("el cuerpo del POST pasa el esquema del servidor", () => {
    const o = opcionesDeBase(refs);
    const base = o.find((x) => x.id === "anio_completo|2025|bruto")!;
    const cuerpo = cuerpoAprobar({ anio: 2027, pct: 15, nota: "  prudente  ", base, proyeccionId: PROYECCION_ID, huella: "h", versionVigente: 2 });
    expect(cuerpo.nota).toBe("prudente");
    expect(cuerpo.base).toEqual({ tipo: "anio_completo", anio: 2025, variante: "bruto" });
    expect(aprobarCrecimientoSchema.safeParse(cuerpo).success).toBe(true);
    const sinBase = cuerpoAprobar({ anio: 2027, pct: 15, nota: "  ", base: null, proyeccionId: null, huella: "h", versionVigente: null });
    expect(sinBase.nota).toBeNull();
    expect(sinBase.base).toEqual({ tipo: "ninguna", anio: null, variante: "bruto" });
    expect(aprobarCrecimientoSchema.safeParse(sinBase).success).toBe(true);
    const acumulado = cuerpoAprobar({ anio: 2027, pct: 18.4, nota: "", base: o.find((x) => x.id === "acumulado||sin_nino_mas_rebote")!, proyeccionId: null, huella: "h", versionVigente: null });
    expect(acumulado.base).toEqual({ tipo: "acumulado", anio: null, variante: "sin_nino_mas_rebote" });
    expect(aprobarCrecimientoSchema.safeParse(acumulado).success).toBe(true);
  });

  it("el confirm repite el %, la base, la diferencia y las proyecciones que quedan desactualizadas", () => {
    const base = opcionesDeBase(refs).find((x) => x.id === "acumulado||sin_nino_mas_rebote")!;
    const texto = textoConfirmarGM({ titulo: "HOMBRE · URBANO", anio: 2027, version: 3, pct: 15, base, vigente: { version: 2, pct: 12 }, desactualizadas: [{ id: "p1", nombre: "Proyección 2026" }] });
    expect(texto).toContain("v3 de HOMBRE · URBANO para 2027");
    expect(texto).toContain("15.0 %");
    expect(texto).toContain("Acumulado ene–set 2026 · sin Niño + rebote");
    expect(texto).toContain("-3.4 pp");
    expect(texto).toContain("Reemplaza a la v2 (12.0 %)");
    expect(texto).toContain("1 proyección en trabajo quedará desactualizada");
    const sin = textoConfirmarGM({ titulo: "Resto", anio: 2027, version: 1, pct: 5, base: null, vigente: null, desactualizadas: null });
    expect(sin).toContain("Base: ninguna");
    expect(sin).toContain("quedarán desactualizadas hasta que las recalcules");
    expect(textoConfirmarGM({ titulo: "Resto", anio: 2027, version: 1, pct: 5, base: null, vigente: null, desactualizadas: [] })).toContain("No hay proyecciones en trabajo");
    expect(textoConfirmarGM({ titulo: "Resto", anio: 2027, version: 1, pct: 5, base: null, vigente: null, desactualizadas: [{ id: "a", nombre: "A" }, { id: "b", nombre: "B" }] })).toContain("2 proyecciones en trabajo quedarán desactualizadas");
  });

  it("los 409 recargan (datos y vigente) o explican contra qué versión coinciden (sin_cambio)", () => {
    const v = { version: 2 };
    expect(errorDeAprobarGM("datos_cambiados", "Los datos cambiaron.", v)).toMatchObject({ recargar: true });
    expect(errorDeAprobarGM("vigente_cambiada", "Otra persona aprobó.", v)).toMatchObject({ recargar: true });
    expect(errorDeAprobarGM("sin_cambio", "x", v)).toEqual({ mensaje: "Es igual a la v2: no se crea otra versión.", recargar: false });
    expect(errorDeAprobarGM("nota_requerida", "Falta la nota.", v)).toEqual({ mensaje: "Falta la nota.", recargar: false });
    expect(errorDeAprobarGM(null, "Error 500", null)).toEqual({ mensaje: "Error 500", recargar: false });
  });

  it("el aviso de éxito nombra las proyecciones desactualizadas", () => {
    expect(textoAprobadoOk("HOMBRE · URBANO", { version: 3, pct: 15 }, 2027, [{ nombre: "Proyección 2026" }])).toContain("Quedaron desactualizadas la proyección Proyección 2026");
    expect(textoAprobadoOk("Resto", { version: 1, pct: 5 }, 2027, [])).toBe("Resto: aprobada la v1 (5.0 %) para 2027.");
  });
});

describe("versiones y foto", () => {
  it("aplana la referencia en pares legibles", () => {
    const l = lineasDeFoto({ bruto: 3, extremo: false, tienda_mayor: { codigo: "T07", aporte_pct: 38.5 }, gml_ids: ["a", "b"], nada: null });
    expect(l).toContainEqual({ clave: "bruto", valor: "3" });
    expect(l).toContainEqual({ clave: "extremo", valor: "no" });
    expect(l).toContainEqual({ clave: "tienda_mayor · codigo", valor: "T07" });
    expect(l).toContainEqual({ clave: "gml_ids", valor: "a, b" });
    expect(l).toContainEqual({ clave: "nada", valor: "—" });
    expect(lineasDeFoto(undefined)).toEqual([]);
  });

  it("detalle sin aprobar no tiene vigente y la próxima versión es la 1", () => {
    const d = detalleSinAprobar();
    expect(d.vigente).toBeNull();
    expect(proximaVersion(d.versiones)).toBe(1);
    expect(version().estado).toBe("vigente");
    expect(CLAVE_MUJER_RI).toContain(".");
  });
});
