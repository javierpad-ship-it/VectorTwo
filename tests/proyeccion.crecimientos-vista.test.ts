import { describe, expect, it } from "vitest";
import { calcularPromedio as calcularPromedioLib } from "@/lib/proyeccion/crecimientos";
import {
  ayudaCrecimientoFila,
  borradorDesde,
  promedioParaPantalla,
  cuerpoGuardar,
  diagnostico,
  entradasPromedio,
  esExtremo,
  firmaBorrador,
  hayCambios,
  insigniasDeConjunto,
  leerConflicto,
  leerPctMatriz,
  listaEnPalabras,
  marcadorCrecimiento,
  motivoIncompleta,
  motivoSinBase,
  nombreFilaChoque,
  textoBaseCelda,
  textoCabeceraCrecimientos,
  textoCambioDecidido,
  textoCambioPct,
  textoCasillaPisarDecididas,
  textoCierresPuente,
  textoCrecimientosSinAplicar,
  textoDesgloseResto,
  textoDesvioPorFijadas,
  textoFaltan,
  textoListaRecortada,
  textoObjetivo,
  textoOrigenCrecimiento,
  textoPieCrecimientoLinea,
  textoPisada,
  textoRebote,
  textoRevertidas,
  textoSigueResto,
  textosDetalleBruto,
  tiendasMismasSiguiente,
  tituloSeccionDecididas,
  tituloSeccionPctPropio,
  claveCelda,
  resumenChoquePrevisto,
  textoChoquePrevisto,
  textoCeldasIncompletas,
  textoDescartadas,
} from "../src/app/(app)/planificacion/proyeccion/crecimientos-vista";
import {
  accionParaCodigo,
  cierreExigeRecalcular,
  textoAperturaTardia,
  textoColumnasVariacion,
  textoMotivoDesactualizada,
  textoVentaEsperadaTienda,
} from "../src/app/(app)/planificacion/proyeccion/vista";
import { bloques, tiendaProyeccion } from "./proyeccion.pantalla.fixture";
import { agregado, agregadoHombreFormal, conflicto, G_H, G_M, M_C, M_F, M_U, respuestaCrecimientos, respuestaCrecimientosVacia } from "./proyeccion.crecimientos-pantalla.fixture";

/** Pruebas puras de la pestaña Crecimientos (07c, 0.10.8) y de la venta esperada de la tienda nueva (07d): datos sintéticos de las fichas. */

describe("lectura del % de una celda", () => {
  it("vacío es «falta»; un número en rango es válido; coma o punto; fuera de rango o texto, inválido", () => {
    expect(leerPctMatriz("")).toEqual({ estado: "vacio" });
    expect(leerPctMatriz("   ")).toEqual({ estado: "vacio" });
    expect(leerPctMatriz("20")).toEqual({ estado: "ok", valor: 20 });
    expect(leerPctMatriz("7,5")).toEqual({ estado: "ok", valor: 7.5 });
    expect(leerPctMatriz("-95")).toEqual({ estado: "ok", valor: -95 });
    expect(leerPctMatriz("500")).toEqual({ estado: "ok", valor: 500 });
    expect(leerPctMatriz("-96").estado).toBe("invalido");
    expect(leerPctMatriz("501").estado).toBe("invalido");
    expect(leerPctMatriz("abc").estado).toBe("invalido");
  });

  it("un % es extremo solo si pasa de ±50: el aviso no bloquea", () => {
    expect(esExtremo(50)).toBe(false);
    expect(esExtremo(-50)).toBe(false);
    expect(esExtremo(50.1)).toBe(true);
    expect(esExtremo(-60)).toBe(true);
    expect(esExtremo(null)).toBe(false);
  });
});

describe("borrador, faltantes y cuerpo del PUT", () => {
  it("el borrador parte de lo guardado: una celda sin definir queda vacía", () => {
    const b = borradorDesde(respuestaCrecimientosVacia());
    expect(b.resto.pct).toBe("5");
    expect(b.objetivo).toBe("");
    expect(b.celdas[claveCelda(G_H, M_F)].pct).toBe("");
    const lleno = borradorDesde(respuestaCrecimientos());
    expect(lleno.celdas[claveCelda(G_H, M_F)].pct).toBe("20");
    expect(lleno.celdas[claveCelda(G_M, M_F)].pct).toBe("0");
    expect(lleno.objetivo).toBe("12");
  });

  it("la matriz completa no tiene faltantes: una celda sin filas no es obligatoria", () => {
    const r = respuestaCrecimientos();
    const d = diagnostico(r, borradorDesde(r));
    expect(d.faltan).toEqual([]);
    expect(motivoIncompleta(d)).toBeNull();
  });

  it("enumera las celdas que faltan con el mensaje de la ficha", () => {
    const r = respuestaCrecimientos();
    const b = borradorDesde(r);
    for (const [g, m] of [[G_H, M_F], [G_M, M_F], [G_M, M_C]]) b.celdas[claveCelda(g, m)].pct = "";
    const d = diagnostico(r, b);
    expect(d.faltan).toEqual(["HOMBRE · FORMAL", "MUJER · FORMAL", "MUJER · CASUAL"]);
    expect(textoFaltan(d.faltan)).toBe("Faltan 3 celdas: HOMBRE · FORMAL, MUJER · FORMAL y MUJER · CASUAL. Escribe un % en cada una (puede ser el mismo del Resto).");
    expect(textoFaltan(["MUJER · CASUAL"])).toBe("Falta 1 celda: MUJER · CASUAL. Escribe un % en cada una (puede ser el mismo del Resto).");
    expect(textoFaltan([])).toBeNull();
  });

  it("el Resto vacío también falta; un % inválido y un objetivo inválido impiden guardar con su motivo", () => {
    const r = respuestaCrecimientos();
    const b = borradorDesde(r);
    b.resto.pct = "";
    expect(diagnostico(r, b).faltan).toEqual(["Resto"]);
    b.resto.pct = "5";
    b.celdas[claveCelda(G_H, M_U)].pct = "600";
    expect(motivoIncompleta(diagnostico(r, b))).toContain("HOMBRE · URBANO");
    b.celdas[claveCelda(G_H, M_U)].pct = "10";
    b.objetivo = "xx";
    expect(motivoIncompleta(diagnostico(r, b))).toContain("Objetivo global");
  });

  it("listaEnPalabras", () => {
    expect(listaEnPalabras(["A"])).toBe("A");
    expect(listaEnPalabras(["A", "B"])).toBe("A y B");
    expect(listaEnPalabras(["A", "B", "C"])).toBe("A, B y C");
  });

  it("el cuerpo del PUT lleva la huella, el Resto, el objetivo y todas las celdas escritas; conserva una «sin filas» guardada", () => {
    const r = respuestaCrecimientos({ celdas: respuestaCrecimientos().celdas.map((c) => (c.genero_id === G_H && c.mundo_id === M_C ? { ...c, pct: 7 } : c)) });
    const b = borradorDesde(r);
    b.celdas[claveCelda(G_H, M_U)].nota = "  nota nueva  ";
    const c = cuerpoGuardar(r, b);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.cuerpo.huella).toBe("huella-1");
    expect(c.cuerpo.resto).toEqual({ pct: 5, nota: null });
    expect(c.cuerpo.objetivo_pct).toBe(12);
    // 6 celdas: 4 con filas escritas + HOMBRE·CASUAL («sin filas» con 7 % guardado, se conserva); MUJER·URBANO sin filas y sin % no viaja.
    expect(c.cuerpo.celdas).toHaveLength(5);
    expect(c.cuerpo.celdas.find((x) => x.genero_id === G_H && x.mundo_id === M_C)).toMatchObject({ pct: 7 });
    expect(c.cuerpo.celdas.find((x) => x.genero_id === G_M && x.mundo_id === M_U)).toBeUndefined();
    expect(c.cuerpo.celdas.find((x) => x.genero_id === G_H && x.mundo_id === M_U)).toMatchObject({ pct: 10, nota: "nota nueva" });
    expect(c.cuerpo.resolucion).toBeUndefined();
  });

  it("sin objetivo viaja null; con celdas incompletas no hay cuerpo", () => {
    const r = respuestaCrecimientos({ objetivo_pct: null });
    const b = borradorDesde(r);
    const c = cuerpoGuardar(r, b);
    expect(c.ok && c.cuerpo.objetivo_pct).toBeNull();
    b.celdas[claveCelda(G_H, M_F)].pct = "";
    const malo = cuerpoGuardar(r, b);
    expect(malo.ok).toBe(false);
  });

  it("la resolución solo sale cuando se pasa: Pisar con la casilla, Pisar sin ella y Conservar", () => {
    const r = respuestaCrecimientos();
    const b = borradorDesde(r);
    const pisarTodo = cuerpoGuardar(r, b, { resolucion: "pisar", incluir_decididas: true, huella_choque: "choque-1" });
    expect(pisarTodo.ok && pisarTodo.cuerpo).toMatchObject({ resolucion: "pisar", incluir_decididas: true, huella_choque: "choque-1" });
    const pisar = cuerpoGuardar(r, b, { resolucion: "pisar", incluir_decididas: false, huella_choque: "choque-1" });
    expect(pisar.ok && "incluir_decididas" in pisar.cuerpo).toBe(false);
    const conservar = cuerpoGuardar(r, b, { resolucion: "conservar", incluir_decididas: true, huella_choque: "choque-1" });
    expect(conservar.ok && conservar.cuerpo.resolucion).toBe("conservar");
    // `incluir_decididas` solo con «pisar»: con «conservar» no viaja.
    expect(conservar.ok && "incluir_decididas" in conservar.cuerpo).toBe(false);
  });

  it("hay cambios solo cuando algo difiere de lo guardado (texto o nota)", () => {
    const r = respuestaCrecimientos();
    const b = borradorDesde(r);
    expect(hayCambios(r, b)).toBe(false);
    b.celdas[claveCelda(G_H, M_F)].pct = "21";
    expect(hayCambios(r, b)).toBe(true);
    b.celdas[claveCelda(G_H, M_F)].pct = "20.0";
    expect(hayCambios(r, b)).toBe(false);
    b.resto.nota = "x";
    expect(hayCambios(r, b)).toBe(true);
    const vacia = respuestaCrecimientosVacia();
    expect(hayCambios(vacia, borradorDesde(vacia))).toBe(false);
  });

  it("la firma cambia con cualquier % o con el objetivo, no con la nota", () => {
    const r = respuestaCrecimientos();
    const b = borradorDesde(r);
    const f0 = firmaBorrador(b);
    expect(firmaBorrador(borradorDesde(r))).toBe(f0);
    b.celdas[claveCelda(G_H, M_U)].nota = "otra";
    expect(firmaBorrador(b)).toBe(f0);
    b.celdas[claveCelda(G_H, M_U)].pct = "11";
    expect(firmaBorrador(b)).not.toBe(f0);
    const b2 = borradorDesde(r);
    b2.objetivo = "13";
    expect(firmaBorrador(b2)).not.toBe(f0);
  });
});

describe("Calcular promedio (§5.2)", () => {
  const r = respuestaCrecimientos();
  const entradas = () => {
    const e = entradasPromedio(r, borradorDesde(r));
    if (!e.ok) throw new Error("debería estar completa");
    return e;
  };

  it("el ejemplo de la ficha: 11.7 % ponderado escrito, 10.2 % resultante, 132 185 u, faltan 2 215 u frente al 12 %, Total 133 099", () => {
    const e = entradas();
    const res = promedioParaPantalla(e.entradas, e.resto, 12, r.puente);
    expect(res.base).toBe(120000);
    expect(res.ponderado_escrito).toBeCloseTo(11.7167, 3);
    expect(Math.round((res.ponderado_escrito ?? 0) * 10) / 10).toBe(11.7);
    expect(res.siguiente).toBeCloseTo(132185, 6);
    expect(Math.round((res.resultante ?? 0) * 10) / 10).toBe(10.2);
    expect(res.objetivo?.faltan_unidades).toBeCloseTo(2215, 6);
    expect(res.objetivo?.faltan_pp_escrito).toBeCloseTo(0.2833, 3);
    expect(res.objetivo?.faltan_pp_resultado).toBeCloseTo(1.846, 2);
    expect(res.puente.total).toBeCloseTo(133099, 6);
    expect(res.filas_con_pct_propio).toBe(1);
    expect(res.filas_decididas).toBe(1);
  });

  it("la celda HOMBRE · FORMAL resulta en 19 485 u (+9.5 %) y el total tiene su propia fila", () => {
    const e = entradas();
    const res = promedioParaPantalla(e.entradas, e.resto, null, r.puente);
    const hf = res.filas.find((f) => f.nombre === "HOMBRE · FORMAL");
    expect(hf?.siguiente).toBe(19485);
    expect(hf?.resultante).toBeCloseTo(9.466, 2);
    expect(res.filas.map((f) => f.tipo)).toEqual(["celda", "celda", "celda", "celda", "resto", "total"]);
    expect(res.filas[res.filas.length - 1].nombre).toBe("Total (mismas tiendas)");
    expect(res.objetivo).toBeNull();
  });

  it("los cierres de Y+1 SUMAN al Total 2027; sin decidir se avisa", () => {
    const e = entradas();
    const res = promedioParaPantalla(e.entradas, e.resto, null, { ...r.puente, cierres: 300, cierres_sin_decidir: 1 });
    expect(res.puente.total).toBeCloseTo(133399, 6);
    expect(textoCierresPuente({ cierres: 0, cierres_sin_decidir: 1 })).toBe("0 u (1 tienda sin decidir)");
    expect(textoCierresPuente({ cierres: 300, cierres_sin_decidir: 0 })).toBe("300 u");
    expect(textoCierresPuente({ cierres: 0, cierres_sin_decidir: 2 })).toBe("0 u (2 tiendas sin decidir)");
  });

  it("la variación del puente se compara con el Total de Y de la Matriz", () => {
    const e = entradas();
    const res = promedioParaPantalla(e.entradas, e.resto, null, { ...r.puente, total_en_curso: 100000 });
    expect(res.puente.variacion_pct).toBeCloseTo(33.099, 3);
    expect(promedioParaPantalla(e.entradas, e.resto, null, { ...r.puente, total_en_curso: 0 }).puente.variacion_pct).toBeNull();
  });

  it("con una celda vacía no calcula y lista las que faltan; con «vacías como Resto» (solo lectura) siguen al Resto", () => {
    const b = borradorDesde(r);
    b.celdas[claveCelda(G_M, M_C)].pct = "";
    const e = entradasPromedio(r, b);
    expect(e).toEqual({ ok: false, faltan: ["MUJER · CASUAL"] });
    const lectura = entradasPromedio(r, b, { vaciasComoResto: true });
    expect(lectura.ok).toBe(true);
    if (!lectura.ok) return;
    expect(lectura.entradas.find((x) => x.nombre === "MUJER · CASUAL")?.pct).toBe(5);
    // Un % inválido nunca se toma por Resto.
    b.celdas[claveCelda(G_M, M_C)].pct = "abc";
    expect(entradasPromedio(r, b, { vaciasComoResto: true }).ok).toBe(false);
  });

  it("una celda «sin filas» no entra en el promedio", () => {
    const e = entradas();
    expect(e.entradas).toHaveLength(4);
    expect(e.entradas.map((x) => x.nombre)).not.toContain("HOMBRE · CASUAL");
    expect(e.entradas.map((x) => x.nombre)).not.toContain("MUJER · URBANO");
  });

  it("Σ B = 0: sin ponderado ni comparación posible; el motivo dice que se recalcule", () => {
    const sinBase = respuestaCrecimientos({
      celdas: respuestaCrecimientos().celdas.map((c) => ({ ...c, agregado: agregado(0, { filas: c.agregado.filas }) })),
      resto: { ...respuestaCrecimientos().resto, agregado: agregado(0, { filas: 0 }) },
    });
    const e = entradasPromedio(sinBase, borradorDesde(sinBase));
    if (!e.ok) throw new Error("completa");
    const res = promedioParaPantalla(e.entradas, e.resto, 12, sinBase.puente);
    expect(res.ponderado_escrito).toBeNull();
    expect(res.resultante).toBeNull();
    // Sin base no hay unidades que faltar: el texto del objetivo no inventa «≈ 0 u».
    expect(res.objetivo?.faltan_unidades).toBeNull();
    expect(textoObjetivo(res.objetivo!)).not.toContain("≈");
    expect(motivoSinBase(sinBase)).toBe("Sin base: recalcula la proyección.");
    expect(motivoSinBase(respuestaCrecimientos())).toBeNull();
  });

  it("proyección de antes de 0.10.8: el motivo es «recalcula: método nuevo»", () => {
    const vieja = respuestaCrecimientos({ metodo_viejo: true, al_dia: false });
    expect(motivoSinBase(vieja)).toMatch(/Recalcula: método nuevo/);
    expect(textoCrecimientosSinAplicar(vieja)).toBe("Calculada con el método anterior: recalcula.");
  });

  it("proyección cerrada o archivada anterior a 0.10.8: no manda a recalcular, manda a crear una nueva", () => {
    const vieja = respuestaCrecimientos({ metodo_viejo: true, al_dia: true, editable: false });
    const motivo = motivoSinBase(vieja, false);
    expect(motivo).toBe("Proyección cerrada con el método anterior: solo lectura; crea una nueva.");
    expect(motivo).not.toMatch(/[Rr]ecalcula/);
    // Cerrada sin base por otra razón: tampoco ofrece recalcular.
    const sinBase = respuestaCrecimientos({
      editable: false,
      celdas: respuestaCrecimientos().celdas.map((c) => ({ ...c, agregado: agregado(0, { filas: c.agregado.filas }) })),
      resto: { ...respuestaCrecimientos().resto, agregado: agregado(0, { filas: 0 }) },
    });
    expect(motivoSinBase(sinBase, false)).not.toMatch(/recalcula/);
    expect(motivoSinBase(sinBase, true)).toBe("Sin base: recalcula la proyección.");
    // Una proyección en trabajo conserva el motivo de siempre.
    expect(motivoSinBase(vieja, true)).toMatch(/Recalcula: método nuevo/);
    expect(motivoSinBase(respuestaCrecimientos(), false)).toBeNull();
  });

  it("la pantalla no tiene su propia cuenta: el resultado sale de calcularPromedio de la librería", () => {
    const e = entradas();
    const pantalla = promedioParaPantalla(e.entradas, e.resto, 12, r.puente);
    const { resultado: lib } = calcularPromedioLib(
      e.entradas.map((x) => ({ genero: x.nombre, mundo: "", pct: x.pct, sin_filas: false, agregado: x.agregado })),
      { pct: e.resto.pct, agregado: e.resto.agregado },
      12,
      r.puente
    );
    expect(lib).not.toBeNull();
    expect(pantalla.base).toBe(lib!.base_total);
    expect(pantalla.siguiente).toBe(lib!.siguiente_total);
    expect(pantalla.ponderado_escrito).toBe(lib!.ponderado_escrito_pct);
    expect(pantalla.resultante).toBe(lib!.resultante_pct);
    expect(pantalla.objetivo).toEqual(lib!.objetivo);
    expect(pantalla.puente.total).toBe(lib!.puente.total_siguiente);
    expect(pantalla.puente.variacion_pct).toBe(lib!.puente.var_pct);
    // Una fila por celda con filas + el Resto + el Total, en ese orden.
    expect(pantalla.filas.map((f) => f.siguiente)).toEqual([...lib!.filas.map((f) => f.siguiente), lib!.siguiente_total]);
  });

  it("textos del objetivo y del desvío por filas fijadas", () => {
    const e = entradas();
    const res = promedioParaPantalla(e.entradas, e.resto, 12, r.puente);
    expect(textoObjetivo(res.objetivo!)).toBe("Objetivo +12.0 % → con lo escrito te faltan 0.3 pp; con el resultado, te faltan 1.8 pp ≈ 2,215 u.");
    expect(textoDesvioPorFijadas(res)).toBe("1 fila con % propio y 1 decidida llevan el total de +11.7 % a +10.2 %.");
    const pasado = promedioParaPantalla(e.entradas, e.resto, 5, r.puente);
    expect(textoObjetivo(pasado.objetivo!)).toContain("te pasas por");
    expect(textoObjetivo(pasado.objetivo!)).toContain("de más");
    expect(textoDesvioPorFijadas({ filas_con_pct_propio: 0, filas_decididas: 0, ponderado_escrito: 3, resultante: 3 })).toBe("No hay filas fijadas a mano: el resultado coincide con lo escrito.");
  });
});

describe("aviso de celdas descartadas", () => {
  it("lista cada celda quitada con su %; sin ninguna no hay aviso", () => {
    expect(textoDescartadas([])).toBeNull();
    expect(textoDescartadas([{ genero: "HOMBRE", mundo: "CASUAL", pct: 12 }])).toBe("1 celda guardada se quitó porque su mundo está desactivado: HOMBRE · CASUAL (12 %).");
    expect(textoDescartadas([{ genero: "HOMBRE", mundo: "CASUAL", pct: 12.5 }, { genero: "MUJER", mundo: "CASUAL", pct: 3 }])).toBe(
      "2 celdas guardadas se quitaron porque su mundo está desactivado: HOMBRE · CASUAL (12.5 %) y MUJER · CASUAL (3 %)."
    );
  });
});

describe("insignias y textos de cada celda", () => {
  it("«N con % propio», «N decididas», «extremo» y «sin base»", () => {
    const i = insigniasDeConjunto(agregadoHombreFormal, 20);
    expect(i.map((x) => x.texto)).toEqual(["1 con % propio", "1 decidida"]);
    expect(insigniasDeConjunto({ ...agregadoHombreFormal, pct_propio: { filas: 2, base: 1, siguiente: 1 }, decididas: { filas: 3, base: 1, siguiente: 1 } }, 20).map((x) => x.texto)).toEqual(["2 con % propio", "3 decididas"]);
    expect(insigniasDeConjunto(agregado(1000), 60).map((x) => x.texto)).toEqual(["extremo"]);
    expect(insigniasDeConjunto(agregado(1000), -51).map((x) => x.texto)).toEqual(["extremo"]);
    expect(insigniasDeConjunto(agregado(1000), 50)).toEqual([]);
    expect(insigniasDeConjunto(agregado(0, { filas: 2 }), 10).map((x) => x.texto)).toEqual(["sin base"]);
    expect(insigniasDeConjunto(agregado(0, { filas: 0 }), 10)).toEqual([]);
  });

  it("base, rebote del Niño, sigue al Resto y desglose del Resto", () => {
    expect(textoBaseCelda(agregadoHombreFormal, 2027)).toBe("base 17,800 u · hoy 2027: 19,485 u");
    expect(textoRebote(agregadoHombreFormal)?.texto).toBe("rebote del Niño +9.6 %");
    expect(textoRebote(agregadoHombreFormal)?.titulo).toContain("Es referencia: no se aplica");
    expect(textoRebote(agregado(100))).toBeNull();
    expect(textoSigueResto(5)).toBe("sigue al Resto (5 %)");
    expect(textoSigueResto(2.5)).toBe("sigue al Resto (2.5 %)");
    expect(textoSigueResto(null)).toBe("sigue al Resto");
    expect(textoDesgloseResto([{ genero: "JOVENCITOS", base: 8200 }, { genero: "NIÑOS", base: 6100 }, { genero: "SIN", base: 0 }])).toBe("JOVENCITOS 8,200 · NIÑOS 6,100");
    expect(textoDesgloseResto([])).toBeNull();
  });

  it("cabecera y alertas", () => {
    expect(textoCabeceraCrecimientos(2026, 2027, 10)).toBe(
      "Crecimiento bruto 2027 frente a 2026 de las mismas tiendas de 2027 (10 tiendas). No se corrige por el Niño: si 2026 fue Niño en un mundo, inclúyelo en tu %."
    );
    expect(tiendasMismasSiguiente(bloques(), 2027)).toBe(10);
    expect(textoCrecimientosSinAplicar(respuestaCrecimientos())).toBeNull();
    expect(textoCrecimientosSinAplicar(respuestaCrecimientos({ al_dia: false }))).toContain("falló el recálculo o un nodo cambió de mundo");
  });
});

describe("Modal del choque y resultado del guardado", () => {
  it("lee el 409 filas_manuales solo si trae la forma esperada", () => {
    const c = conflicto();
    expect(leerConflicto(c as unknown as Record<string, unknown>)?.huella_choque).toBe("choque-1");
    expect(leerConflicto(null)).toBeNull();
    expect(leerConflicto({ codigo: "conflicto" })).toBeNull();
    expect(leerConflicto({ codigo: "filas_manuales", huella_choque: "x" })).toBeNull();
    expect(leerConflicto({ ...c, huella_choque: 3 } as unknown as Record<string, unknown>)).toBeNull();
  });

  it("textos de las dos secciones y de la casilla (desmarcada por defecto en el componente)", () => {
    expect(tituloSeccionPctPropio(12)).toBe("12 filas tienen un % propio");
    expect(tituloSeccionPctPropio(1)).toBe("1 fila tiene un % propio");
    expect(tituloSeccionDecididas(5, 2027)).toBe("5 filas tienen el total de 2027 decidido: conservan su cifra y mostrarán «propuesta cambió»");
    expect(textoCasillaPisarDecididas(5)).toBe("Pisar también estas 5 decisiones (vuelven a la propuesta nueva)");
    expect(textoCasillaPisarDecididas(1)).toBe("Pisar también esta decisión (vuelve a la propuesta nueva)");
    expect(textoListaRecortada(350, 200)).toBe("Se muestran 200 de 350.");
    expect(textoListaRecortada(5, 5)).toBeNull();
    expect(textoCambioPct(5, 12)).toBe("5 % → 12 %");
    expect(textoCambioPct(5, 12.5)).toBe("5 % → 12.5 %");
    expect(textoCambioDecidido(10800, 11500)).toBe("10,800 → 11,500");
    expect(textoCambioDecidido(10800, null)).toBe("10,800 → —");
    expect(nombreFilaChoque({ linea: "CAMISA", equivalencia: "CLASICA", agrupacion_marca: "RECONOCIDO" })).toBe("CAMISA · CLASICA · RECONOCIDO");
    expect(nombreFilaChoque({ linea: "TERNO", equivalencia: null, agrupacion_marca: "PREMIUM" })).toBe("TERNO · PREMIUM");
  });

  it("pisadas con lo que tenían y aviso de filas editadas mientras se guardaba", () => {
    expect(textoPisada({ fila_id: "f1", pct_anterior: 5, decidido_anterior: null }, "HOMBRE · FORMAL · PANTALON")).toBe("HOMBRE · FORMAL · PANTALON: tenía +5.0 % propio");
    expect(textoPisada({ fila_id: "f1", pct_anterior: null, decidido_anterior: 10800 }, "X")).toBe("X: tenía decidido 10,800");
    expect(textoPisada({ fila_id: "f1", pct_anterior: 5, decidido_anterior: 10800 }, "X")).toBe("X: tenía +5.0 % propio y tenía decidido 10,800");
    expect(textoRevertidas(0)).toBeNull();
    expect(textoRevertidas(3)).toBe("3 filas se editaron mientras guardabas: conservan su % o su total; revísalas y recalcula.");
    expect(textoRevertidas(1)).toBe("1 fila se editó mientras guardabas: conserva su % o su total; revísala y recalcula.");
  });
});

describe("aviso previo de filas fijadas a mano y errores del servidor", () => {
  it("avisa solo si cambiaste una celda (o el Resto) que tiene filas con % propio o decididas", () => {
    const r = respuestaCrecimientos();
    const b = borradorDesde(r);
    expect(textoChoquePrevisto(resumenChoquePrevisto(r, b))).toBeNull();
    b.celdas[claveCelda(G_H, M_U)].pct = "11"; // URBANO no tiene filas fijadas
    expect(textoChoquePrevisto(resumenChoquePrevisto(r, b))).toBeNull();
    b.celdas[claveCelda(G_H, M_F)].pct = "25"; // FORMAL tiene 1 con % propio y 1 decidida
    const c = resumenChoquePrevisto(r, b);
    expect(c).toEqual({ conjuntos: 1, con_pct_propio: 1, decididas: 1 });
    expect(textoChoquePrevisto(c)).toBe(
      "Cambiaste 1 celda con filas fijadas a mano (1 con % propio y 1 decidida): al guardar se te preguntará qué hacer con ellas (pisar, conservar o cancelar). Nada se pisa sin tu respuesta."
    );
  });

  it("el Resto también cuenta cuando tiene filas fijadas", () => {
    const base = respuestaCrecimientos();
    const r = { ...base, resto: { ...base.resto, agregado: agregado(20000, { pct_propio: { filas: 2, base: 100, siguiente: 105 } }) } };
    const b = borradorDesde(r);
    b.resto.pct = "6";
    expect(resumenChoquePrevisto(r, b)).toEqual({ conjuntos: 1, con_pct_propio: 2, decididas: 0 });
  });

  it("celdas_incompletas del servidor se dice con la lista", () => {
    expect(textoCeldasIncompletas({ codigo: "celdas_incompletas", faltan: [{ genero: "MUJER", mundo: "URBANO" }, { genero: "HOMBRE", mundo: "CASUAL" }] })).toBe(
      "Faltan celdas por llenar: MUJER · URBANO y HOMBRE · CASUAL. Actualiza la pantalla para verlas y escribe un % en cada una."
    );
    expect(textoCeldasIncompletas({ codigo: "otro" })).toBeNull();
    expect(textoCeldasIncompletas(null)).toBeNull();
  });
});

describe("Por línea: % bruto efectivo y su origen", () => {
  it("marcador, ayuda y origen de una fila", () => {
    const celda = { pct: 20, origen: "celda" as const, celda: "HOMBRE · URBANO" };
    expect(textoOrigenCrecimiento(celda)).toBe("20 % · HOMBRE · URBANO");
    expect(textoOrigenCrecimiento({ pct: 5, origen: "resto", celda: null })).toBe("5 % · Resto");
    expect(textoOrigenCrecimiento({ pct: 8.5, origen: "fila", celda: null })).toBe("8.5 % · esta fila");
    expect(textoOrigenCrecimiento(null)).toBeNull();
    expect(marcadorCrecimiento({ crecimiento_efectivo: celda })).toBe("20 % · HOMBRE · URBANO");
    expect(marcadorCrecimiento(undefined)).toBeNull();
    expect(ayudaCrecimientoFila(celda, 2027, 2026)).toBe("% bruto 2027 ÷ 2026 de esta fila, sin corregir por el Niño. Vacío = el de la combinación (20 %).");
    expect(ayudaCrecimientoFila({ pct: 5, origen: "resto", celda: null }, 2027, 2026)).toContain("Vacío = el del Resto (5 %).");
    expect(ayudaCrecimientoFila(null, 2027, 2026)).toContain("Vacío = el de la combinación");
    // Nunca habla de «la proyección» como origen del %.
    expect(ayudaCrecimientoFila(celda, 2027, 2026)).not.toContain("el de la proyección");
  });

  it("detalle: bruto efectivo, base, equivalencia sobre la normalizada por el Niño y decisión", () => {
    const t = textosDetalleBruto(
      { crecimiento_efectivo: { pct: 20, origen: "celda", celda: "HOMBRE · URBANO" }, base_siguiente: 19424, base_normalizada: 19424, pct_bruto: 20, pct_sobre_normalizada: 20, decidido: null },
      2027,
      2026
    );
    expect(t).toEqual(["Crecimiento bruto efectivo +20.0 % (HOMBRE · URBANO) · base 2026 de las mismas tiendas de 2027: 19,424 u"]);
    const nino = textosDetalleBruto(
      { crecimiento_efectivo: { pct: 20, origen: "celda", celda: "HOMBRE · FORMAL" }, base_siguiente: 3300, base_normalizada: 5000, pct_bruto: 20, pct_sobre_normalizada: -20.8, decidido: 3700 },
      2027,
      2026
    );
    expect(nino).toContain("Sobre la base normalizada por el Niño equivale a -20.8 %.");
    expect(nino).toContain("Tu decisión: +20.0 % bruto.");
    expect(textosDetalleBruto({ crecimiento_efectivo: null, base_siguiente: null, base_normalizada: null, pct_bruto: null, pct_sobre_normalizada: null, decidido: null }, 2027, 2026)).toEqual([]);
  });

  it("pie de «Línea (mismas)»: % bruto sobre la base con las dos cifras", () => {
    expect(textoPieCrecimientoLinea(60002, 50001, 2027, 2026)).toBe("+20.0 % bruto sobre la base 2026 de las mismas tiendas de 2027 (60,002 ÷ 50,001)");
    expect(textoPieCrecimientoLinea(60002, 0, 2027, 2026)).toBeNull();
    expect(textoPieCrecimientoLinea(60002, undefined, 2027, 2026)).toBeNull();
  });

  it("la Matriz explica la diferencia entre «Var.» y «Crec. mismas tiendas»", () => {
    const t = textoColumnasVariacion(2026);
    expect(t.var).toBe("Var. = Total 2027 ÷ Total 2026 (incluye tiendas nuevas, aperturas y cierres).");
    expect(t.crec).toBe("Crec. mismas tiendas = 2027 de las mismas tiendas ÷ su 2026: es lo que escribes en Crecimientos.");
  });
});

describe("desactualización y cierre (07c)", () => {
  it("crecimientos_cambiados y version_metodo no se pueden forzar al cerrar", () => {
    expect(cierreExigeRecalcular({ desactualizada: [{ codigo: "crecimientos_cambiados", mensaje: "x" }] })).toBe(true);
    expect(cierreExigeRecalcular({ desactualizada: [{ codigo: "version_metodo", mensaje: "x" }] })).toBe(true);
    expect(cierreExigeRecalcular({ desactualizada: [{ codigo: "cargas_nuevas", mensaje: "x" }] })).toBe(false);
    expect(cierreExigeRecalcular({ desactualizada: [] })).toBe(false);
    expect(textoMotivoDesactualizada({ codigo: "crecimientos_cambiados", mensaje: "x" })).toContain("Los crecimientos guardados no están aplicados");
  });

  it("los errores de crecimientos ofrecen la acción que corresponde", () => {
    expect(accionParaCodigo("conflicto")).toBe("recargar");
    expect(accionParaCodigo("estado_cambiado")).toBe("recargar");
    expect(accionParaCodigo("calculo_en_curso")).toBe("recargar");
    expect(accionParaCodigo("crecimientos_cambiados")).toBe("recalcular");
    expect(accionParaCodigo("filas_manuales")).toBeNull();
    expect(accionParaCodigo("celdas_incompletas")).toBe("recargar");
  });
});

describe("venta esperada de la tienda nueva (07d)", () => {
  it("sin meses reales: venta mensual, año maduro y lo que vende en su año de apertura", () => {
    const t = textoVentaEsperadaTienda(tiendaProyeccion());
    expect(t?.principal).toBe("S/ 85,000 al mes (sin IGV, en régimen) · año maduro S/ 1,020,000");
    expect(t?.escala).toBe("en 2027 abre el 15-mar y vende el 83.7 % del año → S/ 853,597");
  });

  it("con meses reales es solo una referencia: la propuesta sale de lo vendido", () => {
    const base = tiendaProyeccion();
    const t = textoVentaEsperadaTienda({ ...base, escala: { ...base.escala!, con_meses_reales: true } });
    expect(t?.escala).toBe("referencia: con la venta esperada vendería el 83.7 % del año → S/ 853,597; la propuesta sale de lo vendido");
  });

  it("sin escala (cierre o proyección anterior) solo dice la venta mensual; sin venta, nada", () => {
    expect(textoVentaEsperadaTienda(tiendaProyeccion({ escala: null }))).toEqual({ principal: "S/ 85,000 al mes (sin IGV, en régimen)", escala: null });
    expect(textoVentaEsperadaTienda(tiendaProyeccion({ venta_esperada: null, escala: null }))).toBeNull();
  });

  it("apertura tardía con las cifras de la tienda", () => {
    const base = tiendaProyeccion();
    const t = textoAperturaTardia({ ...base, escala: { venta_mensual: 85000, anio_maduro: 1020000, fraccion: 0.1287, venta_anio_apertura: 131240, con_meses_reales: false } });
    expect(t).toBe("Abre tarde: en 2027 vende el 12.9 % de un año maduro (S/ 131,240 de S/ 1,020,000). En 2028 pasará a nueva del año anterior.");
    expect(textoAperturaTardia({ ...base, escala: null })).toBeNull();
  });
});
