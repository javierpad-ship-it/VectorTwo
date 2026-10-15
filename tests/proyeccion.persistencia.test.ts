import { describe, expect, it } from "vitest";
import { calcularProyeccion } from "@/lib/proyeccion/modelo";
import {
  aFilaApi,
  aFilaModelo,
  aFilaPlana,
  aPrevias,
  aRegistro,
  aTiendaModelo,
  payloadAnioCalculo,
  payloadAnioDecision,
  payloadFila,
  payloadTiendaCalculo,
  payloadTiendaDecision,
  type AnioDb,
  type FilaConAnios,
  type TiendaPyDb,
} from "@/lib/proyeccion/persistencia";
import { filtrarUniverso, inicioDelUniverso } from "@/lib/proyeccion/universo";
import { AG, AM, N, Y, clave, entrada, hechosBase, serie, construirVenta, tiendas } from "./proyeccion.fixture";
import { catalogoFalso } from "./proyeccion.contexto-falso";

const salida = calcularProyeccion(entrada());
const PID = "00000000-0000-4000-8000-0000000000aa";
const fila = (c: string) => salida.filas.find((f) => f.clave === c)!;

/** Una fila del modelo como la devolvería la base (con ids y las columnas de decisión en `null`/su valor). */
function comoBase(c: string, extra: Partial<AnioDb> = {}): FilaConAnios {
  const f = fila(c);
  const anios: AnioDb[] = f.registros.map((r, i) => ({
    ...(payloadAnioDecision(`fila-${c}`, r, null) as unknown as AnioDb),
    id: `anio-${i}`,
    fila_id: `fila-${c}`,
    created_at: "",
    updated_at: "",
    ...extra,
  }));
  return { ...(payloadFila(PID, f) as unknown as FilaConAnios), id: `fila-${c}`, created_at: "", updated_at: "", proyeccion_fila_anios: anios };
}

describe("del modelo a la base y de vuelta", () => {
  it("la fila y sus años sobreviven el viaje: curva, factores, histórico, participaciones, meses y avisos", () => {
    const c = clave("denim", AM.rec);
    const guardada = comoBase(c);
    const vuelta = aFilaModelo(guardada, 9, Y);
    const original = fila(c);
    expect(vuelta.clave).toBe(original.clave);
    expect(vuelta.curva).toEqual(original.curva);
    expect(vuelta.curva_origen).toEqual(original.curva_origen);
    expect(vuelta.historico).toEqual(JSON.parse(JSON.stringify(original.historico)));
    expect(vuelta.participaciones).toEqual(original.participaciones);
    expect(vuelta.registros.map((r) => [r.anio, r.propuesto, r.vigente, r.meses])).toEqual(original.registros.map((r) => [r.anio, r.propuesto, r.vigente, r.meses]));
    expect(vuelta.registros[0].avance).toBeCloseTo(0.75, 10);
    expect(vuelta.registros[1].avance).toBeNull();
    expect(vuelta.registros[0].curva_origen_usada).toEqual(original.registros[0].curva_origen_usada);
  });

  it("payloadAnioCalculo NUNCA lleva las columnas de decisión (el upsert del cálculo no puede pisarlas)", () => {
    const r = fila(clave("denim", AM.rec)).registros[0];
    const p = payloadAnioCalculo("f", { ...r, decidido: 1900, origen: "manual", nota: "x", propuesta_al_decidir: 1800, decidido_at: "ahora", decidido_por_nombre: "Javier", crecimiento_pct: 7 });
    for (const prohibida of ["decidido", "origen", "nota", "propuesta_al_decidir", "decidido_at", "decidido_por_id", "decidido_por_nombre", "crecimiento_pct"]) {
      expect(Object.keys(p), prohibida).not.toContain(prohibida);
    }
    expect(Object.keys(p)).toEqual(expect.arrayContaining(["meses", "meses_propuestos", "curva_origen_usada", "curva_origen_propuesta", "propuesto", "metodo"]));
    // Los enteros que pide la base salen enteros.
    for (const v of [p.vendido, p.propuesto, ...(p.meses ?? [])]) expect(Number.isInteger(v)).toBe(true);
  });

  it("payloadAnioDecision lleva la decisión; decidido_por_id solo cuando se indica (undefined lo deja como está)", () => {
    const r = { ...fila(clave("denim", AM.rec)).registros[0], decidido: 1900, origen: "manual" as const };
    expect(payloadAnioDecision("f", r, "perfil-1")).toMatchObject({ decidido: 1900, origen: "manual", decidido_por_id: "perfil-1" });
    expect(Object.keys(payloadAnioDecision("f", r, undefined))).not.toContain("decidido_por_id");
    expect(payloadAnioDecision("f", { ...r, decidido: null, origen: null }, "perfil-1")).toMatchObject({ decidido: null, origen: null, decidido_por_id: null });
  });

  it("payloadTiendaCalculo no lleva decisión; con la rampa solo en una tienda nueva; payloadTiendaDecision sí", () => {
    const t = salida.tiendas.find((x) => x.tienda_id === "T4")!;
    const calculo = payloadTiendaCalculo(PID, t, false);
    expect(Object.keys(calculo)).toContain("rampa");
    expect(Object.keys(payloadTiendaCalculo(PID, t, true))).not.toContain("rampa");
    for (const c of ["decidido", "origen", "nota", "propuesta_al_decidir", "decidido_at"]) expect(Object.keys(calculo)).not.toContain(c);
    expect(payloadTiendaDecision(PID, { ...t, decidido: 6000, origen: "manual", propuesta_al_decidir: 7108 })).toMatchObject({ decidido: 6000, origen: "manual", rampa: [1, 1, 1] });
    expect(Number.isInteger(calculo.unidades_maduras as number)).toBe(true);
  });

  it("aPrevias: de las filas base, cualquier registro decidido o con crecimiento; de las filas de tienda, solo lo fijado a mano; de las tiendas, total y rampa", () => {
    const base = comoBase(clave("denim", AM.rec), {});
    base.proyeccion_fila_anios[0] = { ...base.proyeccion_fila_anios[0], decidido: 1900, origen: "manual", nota: "n", propuesta_al_decidir: 1800 };
    base.proyeccion_fila_anios[1] = { ...base.proyeccion_fila_anios[1], crecimiento_pct: 7 };
    const t3 = comoBase(`T3|${N.denim}||${AM.rec}`);
    t3.proyeccion_fila_anios[0] = { ...t3.proyeccion_fila_anios[0], decidido: 300, origen: "escalada" };
    t3.proyeccion_fila_anios[1] = { ...t3.proyeccion_fila_anios[1], decidido: 700, origen: "manual" };
    const tienda = { ...(payloadTiendaDecision(PID, salida.tiendas[0]) as unknown as TiendaPyDb), id: "x", created_at: "", updated_at: "", decidido: 400, origen: "manual", rampa: [2, 1] } as TiendaPyDb;
    const p = aPrevias([base, t3], [tienda]);
    expect(p.filas.get(`${base.clave}#2026`)).toMatchObject({ decidido: 1900, origen: "manual", nota: "n", propuesta_al_decidir: 1800 });
    expect(p.filas.get(`${base.clave}#2027`)).toMatchObject({ decidido: null, crecimiento_pct: 7 });
    expect(p.filas.has(`${t3.clave}#2026`)).toBe(false); // escalada: se rehace
    expect(p.filas.get(`${t3.clave}#2027`)).toMatchObject({ decidido: 700, origen: "manual" });
    expect(p.tiendas.get(`${tienda.tienda_id}#${tienda.anio}`)).toMatchObject({ decidido: 400, origen: "manual", rampa: [2, 1] });
  });

  it("aTiendaModelo recupera la tienda guardada", () => {
    const t = salida.tiendas.find((x) => x.tienda_id === "T3" && x.anio === 2026)!;
    const guardada = { ...(payloadTiendaDecision(PID, t) as unknown as TiendaPyDb), id: "x", created_at: "", updated_at: "" } as TiendaPyDb;
    expect(aTiendaModelo(guardada)).toMatchObject({ tienda_id: "T3", anio: 2026, bloque: "nuevas", subbloque: "aperturas", metodo: "avance_propio", propuesto: 240, vendido: 120 });
  });

  it("aFilaApi y aFilaPlana ponen los nombres y el histórico anual con la red de cada año; sin historico, la fila plana no lo necesita", () => {
    const g = comoBase(clave("denim", AM.rec));
    const api = aFilaApi(g, catalogoFalso(), 9, Y)!;
    expect(api).toMatchObject({ genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", agrupacion_marca: "RECONOCIDO", equivalencia: null, nivel: "GML" });
    expect(api.historico_anual.map((h) => [h.anio, h.tiendas, h.completo])).toEqual([[2023, 4, true], [2024, 4, true], [2025, 4, true], [2026, 3, false]]);
    expect(api.agrupacion_estacionalidad).toMatchObject({ id: AG.denim, nombre: "DENIM HO", temporada: "todo_el_ano" });
    const sinHistorico = { ...g, historico: undefined as never };
    const plana = aFilaPlana(sinHistorico, catalogoFalso(), 9, Y)!;
    expect(plana.anios.map((a) => [a.anio, a.vigente])).toEqual([[2026, 1800], [2027, 1953]]);
    const abrigo = aFilaApi(comoBase(`|${N.abrigo}|e-parka|${AM.rec}`.replace("e-parka", "e-parka")), catalogoFalso(), 9, Y);
    expect(abrigo?.equivalencia).toBe("PARKA");
    expect(aFilaApi({ ...g, gml_id: "no-existe" }, catalogoFalso(), 9, Y)).toBeNull();
  });

  it("aRegistro: un registro decidido calcula su vigente y trata un origen de mes raro como proyectado", () => {
    const g = comoBase(clave("denim", AM.rec));
    const a = { ...g.proyeccion_fila_anios[0], decidido: 1900, origen: "manual", origen_meses: ["real", "x", ...Array(10).fill("real")] } as AnioDb;
    const r = aRegistro(a, null, 9, Y);
    expect(r.vigente).toBe(1900);
    expect(r.origen_meses?.[1]).toBe("proyectado");
  });
});

describe("universo de filas (ficha, sección 3)", () => {
  it("el primer mes del universo es k − 23 meses", () => {
    expect(inicioDelUniverso(2026, 9)).toBe("2024-10");
    expect(inicioDelUniverso(2026, 1)).toBe("2024-02");
  });

  it("solo las filas con venta positiva en los últimos 24 meses; lo anterior y los meses posteriores a k no cuentan", () => {
    const viejo = serie({ tienda: "T1", nodo: "sandalia", eq: "e-sandalia", agm: AM.pre, marca: "m-alfa" }, "2023-01", "2024-03", () => 10);
    const futuro = serie({ tienda: "T1", nodo: "sandalia", eq: "e-sandalia", agm: AM.rec, marca: "m-alfa" }, "2026-10", "2026-12", () => 10);
    const hechos = [...hechosBase(), ...viejo, ...futuro];
    const venta = construirVenta(hechos, tiendas(), { detalle: ["T1"] });
    const llenos = new Set(filtrarUniverso(venta, 2026, 9).filas.map((f) => `${f.gml_id}|${f.agrupacion_marca_id}`));
    expect(llenos.has(`${N.denim}|${AM.rec}`)).toBe(true);
    expect(llenos.has(`${N.sandalia}|${AM.pre}`)).toBe(false); // vendió hasta 2024-03: fuera de la ventana
    expect(llenos.has(`${N.sandalia}|${AM.rec}`)).toBe(false); // solo vendió después de k
    // Sin recortar, estarían.
    expect(venta.filas.some((f) => f.gml_id === N.sandalia && f.agrupacion_marca_id === AM.pre)).toBe(true);
    // Lo recortado también sale de `detalle_w12` y de `por_tienda`.
    const recortada = filtrarUniverso(venta, 2026, 9);
    expect(recortada.detalle_w12.every((d) => llenos.has(`${d.gml_id}|${d.agrupacion_marca_id}`))).toBe(true);
    expect(recortada.por_tienda.every((d) => llenos.has(`${d.gml_id}|${d.agrupacion_marca_id}`))).toBe(true);
  });

  it("la unidad neta negativa no mete una fila al universo", () => {
    const neg = serie({ tienda: "T1", nodo: "sandalia", eq: "e-sandalia", agm: AM.pre, marca: "m-alfa" }, "2026-01", "2026-03", () => -5);
    const venta = construirVenta([...hechosBase(), ...neg], tiendas(), { detalle: [] });
    expect(filtrarUniverso(venta, 2026, 9).filas.some((f) => f.agrupacion_marca_id === AM.pre && f.gml_id === N.sandalia)).toBe(false);
  });
});
