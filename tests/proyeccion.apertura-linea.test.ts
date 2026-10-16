import { describe, expect, it } from "vitest";
import {
  MAX_NOTA_AJUSTE,
  claveTiendaAnio,
  filasTiendaDeLinea,
  marcasDeFila,
  marcasDeFilaApi,
  marcasQueNecesitanNombre,
  notaMoverTotal,
  repartoPorMarca,
  resumenFilasDeTienda,
  totalLinea,
  totalTiendaTrasMover,
} from "@/lib/proyeccion/apertura-linea";
import { aplicarDecision, moverTotalTienda, registroDe, type ContextoModelo } from "@/lib/proyeccion/decision";
import { leerParticipaciones } from "@/lib/proyeccion/participaciones";
import { MAX_NOTA_DECISION } from "@/lib/proyeccion/esquemas";
import { aPrevias, type FilaConAnios, type TiendaPyDb } from "@/lib/proyeccion/persistencia";
import { motivoRechazoTotalTienda } from "@/lib/proyeccion/reglas";
import type { AnioFilaApi, FilaApi, FilaModelo, Participaciones, RegistroModelo } from "@/lib/proyeccion/tipos";

/** Reglas puras de 07b (`0.10.7`): marcas de más peso, reparto, filas de tienda de la línea, totales y el total de la tienda al mover una fila. */

const part = (por_marca: { marca_id: string; participacion: number }[] | null): Participaciones => ({
  periodo_referencia: { desde: "2025-10", hasta: "2026-09", meses: 12, tiendas: "mismas", anio: 2026, normalizado_nino: false },
  por_clave_flujo: [],
  por_marca,
  por_talla: [],
});
const NOMBRES = new Map([
  ["a", "ALFA"],
  ["b", "BETA"],
  ["c", "CHARLIE"],
  ["d", "DELTA"],
  ["e", "ECO"],
]);
const suma = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe("regla 1: marcasDeFila (top 3 + otras)", () => {
  it("top 3 de mayor a menor, `otras` es el resto y Σ top + otras = 1", () => {
    const p = part([
      { marca_id: "d", participacion: 0.1 },
      { marca_id: "a", participacion: 0.4 },
      { marca_id: "b", participacion: 0.25 },
      { marca_id: "e", participacion: 0.05 },
      { marca_id: "c", participacion: 0.2 },
    ]);
    const m = marcasDeFila(p, NOMBRES);
    expect(m?.top.map((x) => x.marca)).toEqual(["ALFA", "BETA", "CHARLIE"]);
    expect(m?.otras).toMatchObject({ marcas: 2 });
    expect(m?.otras?.participacion).toBeCloseTo(0.15, 12);
    expect(suma((m?.top ?? []).map((x) => x.participacion)) + (m?.otras?.participacion ?? 0)).toBeCloseTo(1, 12);
  });

  it("el empate se resuelve por nombre, también en el corte del tercer lugar", () => {
    const p = part([
      { marca_id: "a", participacion: 0.4 },
      { marca_id: "e", participacion: 0.2 },
      { marca_id: "d", participacion: 0.2 },
      { marca_id: "c", participacion: 0.2 },
    ]);
    // ids de la base: el nombre decide quién queda en el top (CHARLIE y DELTA) y quién en «otras» (ECO), sin importar el orden de entrada.
    expect(marcasQueNecesitanNombre(p).sort()).toEqual(["a", "c", "d", "e"]);
    const m = marcasDeFila(p, NOMBRES);
    expect(m?.top.map((x) => x.marca)).toEqual(["ALFA", "CHARLIE", "DELTA"]);
    expect(m?.otras).toMatchObject({ marcas: 1 });
  });

  it("menos de 3 marcas: las que hay y `otras = null`; sin `por_marca` (o vacío): null", () => {
    const dos = marcasDeFila(part([{ marca_id: "b", participacion: 0.7 }, { marca_id: "a", participacion: 0.3 }]), NOMBRES);
    expect(dos?.top).toHaveLength(2);
    expect(dos?.otras).toBeNull();
    expect(marcasDeFila(part(null), NOMBRES)).toBeNull();
    expect(marcasDeFila(part([]), NOMBRES)).toBeNull();
    expect(marcasDeFila(null, NOMBRES)).toBeNull();
    expect(marcasQueNecesitanNombre(null)).toEqual([]);
  });

  it("una marca sin nombre en la base se rotula, no rompe", () => {
    const m = marcasDeFila(part([{ marca_id: "zz", participacion: 1 }]), NOMBRES);
    expect(m?.top[0]).toMatchObject({ marca_id: "zz", marca: "Marca sin nombre" });
  });

  it("marcasDeFilaApi trae el periodo con la cantidad de tiendas; sin composición, top vacío", () => {
    const fila = { id: "f1", equivalencia_id: null, agrupacion_marca_id: "am1" };
    const con = marcasDeFilaApi(fila, part([{ marca_id: "a", participacion: 1 }]), NOMBRES, 9);
    expect(con).toMatchObject({ fila_id: "f1", agrupacion_marca_id: "am1", periodo: { desde: "2025-10", hasta: "2026-09", tiendas: 9 }, otras: null });
    const sin = marcasDeFilaApi(fila, part(null), NOMBRES, 9);
    expect(sin.top).toEqual([]);
    expect(sin.otras).toBeNull();
    expect(marcasDeFilaApi(fila, null, NOMBRES, 9).periodo).toBeNull();
  });
});

describe("regla 2: repartoPorMarca", () => {
  const comp = marcasDeFila(
    part([
      { marca_id: "a", participacion: 0.41 },
      { marca_id: "b", participacion: 0.19 },
      { marca_id: "c", participacion: 0.14 },
      { marca_id: "d", participacion: 0.14 },
      { marca_id: "e", participacion: 0.12 },
    ]),
    NOMBRES
  );
  it("enteros que suman exactamente la cifra de la fila (top en orden y `otras` al final)", () => {
    for (const v of [1, 7, 210, 1481, 99_999]) {
      const r = repartoPorMarca(v, comp);
      expect(r?.top).toHaveLength(3);
      expect([...(r?.top ?? []), r?.otras ?? 0].every(Number.isInteger)).toBe(true);
      expect(suma(r?.top ?? []) + (r?.otras ?? 0)).toBe(v);
    }
    const r = repartoPorMarca(210, comp);
    expect(r?.top[0]).toBeGreaterThan(r?.top[1] ?? 0);
  });
  it("con vigente = 0 todo es 0; sin composición, null", () => {
    expect(repartoPorMarca(0, comp)).toEqual({ top: [0, 0, 0], otras: 0 });
    expect(repartoPorMarca(100, null)).toBeNull();
    expect(repartoPorMarca(100, { top: [], otras: null })).toBeNull();
  });
  it("sin `otras` (3 marcas o menos) reparte solo entre las del top", () => {
    const tres = marcasDeFila(part([{ marca_id: "a", participacion: 0.5 }, { marca_id: "b", participacion: 0.3 }, { marca_id: "c", participacion: 0.2 }]), NOMBRES);
    const r = repartoPorMarca(10, tres);
    expect(r).toEqual({ top: [5, 3, 2], otras: 0 });
  });
});

// ─── Filas de tienda de la línea y totales ───

const anio = (n: number, bloque: AnioFilaApi["bloque"], vigente: number | null, subbloque: AnioFilaApi["subbloque"] = null): AnioFilaApi =>
  ({ anio: n, bloque, subbloque, vendido: 0, propuesto: vigente, metodo: "apertura", decidido: null, origen: null, vigente, avisos: [] }) as unknown as AnioFilaApi;
const fila = (id: string, tienda: string | null, am: string, anios: AnioFilaApi[], extra: Partial<FilaApi> = {}): FilaApi =>
  ({ id, tienda_id: tienda, gml_id: "g1", equivalencia_id: null, agrupacion_marca_id: am, anios, activo: true, ...extra }) as unknown as FilaApi;

const opciones = {
  codigoDe: (id: string) => id.toUpperCase(),
  composicionSDe: (id: string) => (id === "x" ? null : 0.5),
  ordenMarca: (am: string) => ({ premium: 0, rec: 1, valor: 2 })[am as "premium"] ?? 99,
};

describe("regla 3: filasTiendaDeLinea", () => {
  const filas = [
    fila("b1", null, "rec", [anio(2026, "mismas", 1000), anio(2027, "mismas", 1100)]),
    fila("t12-rec", "t12", "rec", [anio(2027, "nuevas", 500, "aperturas")]),
    fila("t12-pre", "t12", "premium", [anio(2027, "nuevas", 90, "aperturas")]),
    fila("t3-rec", "t3", "rec", [anio(2026, "nuevas", 240, "aperturas"), anio(2027, "nuevas", 504, "nuevas_anterior")]),
    fila("t2-rec", "t2", "rec", [anio(2026, "nuevas", 300, "nuevas_anterior"), anio(2027, "mismas", 330)]),
    fila("t7-cierre", "t7", "rec", [anio(2026, "cierres", 60)]),
    fila("t5-inactiva", "t5", "rec", [anio(2027, "nuevas", 10, "aperturas")], { activo: false }),
    fila("t9-solo-mismas", "t9", "rec", [anio(2027, "mismas", 10)]),
  ];
  const r = filasTiendaDeLinea(filas, opciones);

  it("solo tiendas, bloque `nuevas` y filas activas; `anios` trae solo los años en que es nueva", () => {
    expect(r.map((f) => f.id).sort()).toEqual(["t12-pre", "t12-rec", "t2-rec", "t3-rec"]);
    expect(r.find((f) => f.id === "t2-rec")?.anios.map((a) => a.anio)).toEqual([2026]);
    expect(r.find((f) => f.id === "t3-rec")?.anios.map((a) => a.anio)).toEqual([2026, 2027]);
    expect(r.every((f) => f.tienda_id !== null)).toBe(true);
  });
  it("orden: año de apertura, código de tienda y orden de la agrupación de marca (PREMIUM antes)", () => {
    expect(r.map((f) => f.id)).toEqual(["t2-rec", "t3-rec", "t12-pre", "t12-rec"]);
  });
  it("el código de tienda y la composición `s` salen de las funciones dadas", () => {
    expect(r[0]).toMatchObject({ tienda_codigo: "T2", composicion_s: 0.5 });
    expect(filasTiendaDeLinea([fila("x", "t1", "rec", [anio(2027, "nuevas", 1, "aperturas")])], opciones)[0].composicion_s).toBeNull();
  });
  it("el orden por lugar del GML y equivalencia separa los nodos de una misma tienda", () => {
    const dos = [
      fila("g2", "t1", "rec", [anio(2027, "nuevas", 1, "aperturas")], { gml_id: "g2" }),
      fila("g1e2", "t1", "rec", [anio(2027, "nuevas", 1, "aperturas")], { gml_id: "g1", equivalencia_id: "e2" }),
      fila("g1e1", "t1", "rec", [anio(2027, "nuevas", 1, "aperturas")], { gml_id: "g1", equivalencia_id: "e1" }),
    ];
    const out = filasTiendaDeLinea(dos, { ...opciones, lugarGml: new Map([["g1", 0], ["g2", 1]]) });
    expect(out.map((f) => f.id)).toEqual(["g1e1", "g1e2", "g2"]);
  });
  it("las filas de tienda nunca entran en el total de las filas base", () => {
    expect(totalLinea(2027, filas, [])).toBe(1100);
  });
});

describe("regla 4: totalLinea", () => {
  it("Σ vigente de las filas base + Σ vigente de las filas de tienda del año (la cifra de la barra y de la Matriz)", () => {
    const base = [
      fila("b1", null, "rec", [anio(2026, "mismas", 1000), anio(2027, "mismas", 1100)]),
      fila("b2", null, "premium", [anio(2026, "mismas", 50), anio(2027, "mismas", null)]),
      fila("b3", null, "valor", [anio(2026, "mismas", 7)], { activo: false }),
    ];
    const tienda = filasTiendaDeLinea(
      [fila("t3", "t3", "rec", [anio(2026, "nuevas", 240, "aperturas"), anio(2027, "nuevas", 504, "nuevas_anterior")]), fila("t4", "t4", "rec", [anio(2027, "nuevas", 1481, "aperturas")])],
      opciones
    );
    expect(totalLinea(2026, base, tienda)).toBe(1000 + 50 + 240);
    expect(totalLinea(2027, base, tienda)).toBe(1100 + 504 + 1481);
  });
});

describe("resumenFilasDeTienda (GET /tiendas)", () => {
  it("suma el vigente de las filas de cada tienda y año y cuenta las fijadas a mano", () => {
    const reg = (a: number, bloque: string, propuesto: number | null, decidido: number | null, origen: string | null, activo = true) => ({ anio: a, bloque, propuesto, decidido, origen, activo });
    const r = resumenFilasDeTienda([
      { tienda_id: "t3", proyeccion_fila_anios: [reg(2026, "nuevas", 100, null, null), reg(2027, "nuevas", 80, null, null)] },
      { tienda_id: "t3", proyeccion_fila_anios: [reg(2026, "nuevas", 100, 150, "manual"), reg(2027, "nuevas", null, null, null)] },
      { tienda_id: "t3", proyeccion_fila_anios: [reg(2026, "nuevas", 100, 120, "escalada"), reg(2026, "nuevas", 5, null, null, false)] },
      { tienda_id: "t7", proyeccion_fila_anios: [reg(2026, "cierres", 60, null, null)] },
      { tienda_id: null, proyeccion_fila_anios: [reg(2026, "mismas", 9999, null, null)] },
    ]);
    expect(r.get(claveTiendaAnio("t3", 2026))).toEqual({ suma_filas: 100 + 150 + 120, filas_fijadas: 1 });
    expect(r.get(claveTiendaAnio("t3", 2027))).toEqual({ suma_filas: 80, filas_fijadas: 0 });
    expect(r.get(claveTiendaAnio("t7", 2026))).toEqual({ suma_filas: 60, filas_fijadas: 0 });
    expect(r.has(claveTiendaAnio("t9", 2026))).toBe(false);
  });
});

// ─── Regla 5: aceptar en una fila de tienda la fija ───

const registro = (extra: Partial<RegistroModelo> = {}): RegistroModelo => ({
  anio: 2027,
  bloque: "nuevas",
  subbloque: "aperturas",
  vendido: 0,
  propuesto: 800,
  metodo: "apertura",
  referencia_alternativa: null,
  referencia_tres_meses: null,
  explicacion: "",
  crecimiento_pct: null,
  decidido: null,
  origen: null,
  propuesta_al_decidir: null,
  vigente: 800,
  nota: null,
  decidido_por_nombre: null,
  decidido_at: null,
  meses: null,
  meses_propuestos: null,
  origen_meses: null,
  avance: null,
  avisos: [],
  curva_origen_usada: [],
  curva_origen_propuesta: null,
  ...extra,
});
const modelo = (tienda: string | null, registros: RegistroModelo[]): FilaModelo => ({
  clave: `${tienda ?? ""}|g1||am1`,
  tienda_id: tienda,
  gml_id: "g1",
  equivalencia_id: null,
  agrupacion_marca_id: "am1",
  nivel: "GML",
  agrupacion_estacionalidad_id: null,
  temporada: null,
  curva: Array.from({ length: 12 }, () => 1 / 12),
  curva_origen: [],
  factores_mes: null,
  historico: null,
  participaciones: null,
  composicion: { origen: "referente", s: 1, p: 1, unidades_maduras: 1000 },
  avisos: [],
  activo: true,
  registros,
});
const ctx = (): ContextoModelo => ({
  anio: 2026,
  k: 9,
  crecimiento_pct_defecto: 5,
  umbral_cola_larga: 100,
  rampa_maduracion: [1, 1, 1],
  nombresCurva: new Map(),
  mismasSiguiente: new Set(),
  tiendas: new Map(),
});

describe("regla 5: aceptar la propuesta en una fila de tienda la fija (D1)", () => {
  it("origen `propuesta` en una fila de tienda queda `manual` con decidido = propuesto", () => {
    const f = modelo("t4", [registro()]);
    const a = aplicarDecision(f, [], 2027, { decidido: 800, origen: "propuesta", decidido_por_nombre: "Javier", decidido_at: "2026-10-16T10:00:00.000Z" }, ctx());
    expect(registroDe(a, 2027)).toMatchObject({ decidido: 800, origen: "manual", vigente: 800, propuesta_al_decidir: 800, decidido_por_nombre: "Javier" });
  });
  it("en una fila base `propuesta` sigue siendo `propuesta`", () => {
    const f = modelo(null, [registro({ bloque: "mismas", subbloque: null })]);
    const a = aplicarDecision(f, [], 2027, { decidido: 800, origen: "propuesta" }, ctx());
    expect(registroDe(a, 2027)).toMatchObject({ decidido: 800, origen: "propuesta" });
  });
  it("sobrevive a `aPrevias` (lo que usa `calcularProyeccion` para conservar las cifras fijadas)", () => {
    const anioDb = (origen: string) => ({ anio: 2027, decidido: 800, origen, nota: null, propuesta_al_decidir: 800, crecimiento_pct: null, decidido_por_nombre: "Javier", decidido_at: null, meses: null, curva_origen_usada: [], activo: true });
    const filaDb = (origen: string) => ({ clave: "t4|g1||am1", tienda_id: "t4", proyeccion_fila_anios: [anioDb(origen)] }) as unknown as FilaConAnios;
    expect(aPrevias([filaDb("manual")], [] as TiendaPyDb[]).filas.get("t4|g1||am1#2027")?.decidido).toBe(800);
    // El defecto que se corrige: una `propuesta` guardada en una fila de tienda se perdía. Ya no se guarda así (se fija como `manual`).
    expect(aPrevias([filaDb("propuesta")], [] as TiendaPyDb[]).filas.has("t4|g1||am1#2027")).toBe(false);
  });
});

// ─── Reglas 6 y 7: el total de la tienda al mover una fila ───

describe("totalTiendaTrasMover y notaMoverTotal", () => {
  it("D' = D + Δ con Δ = vigente nuevo − vigente anterior", () => {
    expect(totalTiendaTrasMover({ decidido: 7840, vigenteAnterior: 210, vigenteNuevo: 310, sumaFijadas: 310 })).toBe(7940);
    expect(totalTiendaTrasMover({ decidido: 7840, vigenteAnterior: 210, vigenteNuevo: 150, sumaFijadas: 150 })).toBe(7780);
    expect(totalTiendaTrasMover({ decidido: 100, vigenteAnterior: null, vigenteNuevo: 40, sumaFijadas: 40 })).toBe(140);
  });
  it("nunca queda por debajo de lo fijado a mano (D3) ni negativo", () => {
    expect(totalTiendaTrasMover({ decidido: 100, vigenteAnterior: 0, vigenteNuevo: 30, sumaFijadas: 400 })).toBe(400);
    expect(totalTiendaTrasMover({ decidido: 10, vigenteAnterior: 100, vigenteNuevo: 0, sumaFijadas: 0 })).toBe(0);
  });
  it("la nota conserva la que había, añade la línea una sola vez y respeta el tope", () => {
    expect(MAX_NOTA_AJUSTE).toBe(MAX_NOTA_DECISION);
    expect(notaMoverTotal(null, "HOMBRE · URBANO · DENIM")).toBe("ajustado desde la línea HOMBRE · URBANO · DENIM");
    expect(notaMoverTotal("Tomo la del comité", "A · B · C")).toBe("Tomo la del comité · ajustado desde la línea A · B · C");
    expect(notaMoverTotal(notaMoverTotal("Tomo la del comité", "A · B · C"), "X · Y · Z")).toBe("Tomo la del comité · ajustado desde la línea X · Y · Z");
    expect(notaMoverTotal("n".repeat(500), "A · B · C").length).toBeLessThanOrEqual(MAX_NOTA_DECISION);
  });
});

describe("motivoRechazoTotalTienda", () => {
  it("en el año en curso el total movido no baja de lo vendido; ningún total pasa de MAX_TOTAL", () => {
    expect(motivoRechazoTotalTienda({ anio: 2026, anioEnCurso: 2026, nuevoTotal: 90, vendidoTienda: 100 })).toMatchObject({ status: 409, codigo: "menor_que_vendido" });
    expect(motivoRechazoTotalTienda({ anio: 2026, anioEnCurso: 2026, nuevoTotal: 100, vendidoTienda: 100 })).toBeNull();
    expect(motivoRechazoTotalTienda({ anio: 2027, anioEnCurso: 2026, nuevoTotal: 0, vendidoTienda: 100 })).toBeNull();
    expect(motivoRechazoTotalTienda({ anio: 2027, anioEnCurso: 2026, nuevoTotal: 100_000_001, vendidoTienda: 0 })).toMatchObject({ codigo: "total_excesivo" });
  });
});

describe("moverTotalTienda (puro): las demás filas no se mueven", () => {
  it("el total de la tienda es el movido, con origen manual, y las filas quedan tal cual", () => {
    const a = modelo("t4", [registro({ decidido: 300, origen: "escalada", vigente: 300, propuesta_al_decidir: 250 })]);
    const b = { ...modelo("t4", [registro({ decidido: 500, origen: "manual", vigente: 500, propuesta_al_decidir: 500 })]), clave: "t4|g1||am2", agrupacion_marca_id: "am2" };
    const r = moverTotalTienda({ filas: [a, b], tiendaId: "t4", anio: 2027, decision: { decidido: 900, nota: "n" }, ctx: ctx() });
    expect(r.filas.map((f) => registroDe(f, 2027)?.vigente)).toEqual([300, 500]);
    expect(r.tienda).toMatchObject({ decidido: 900, origen: "manual", nota: "n", propuesto: 1600, propuesta_al_decidir: 1600 });
    expect(r.clavesBaseAfectadas).toEqual([]);
  });
});

describe("por_marca con elementos sin marca_id (dato dañado): se descartan, no lanzan", () => {
  const sucio = [
    { marca_id: "a", participacion: 0.6 },
    { participacion: 0.3 },
    null,
    { marca_id: "b", participacion: 0.4 },
    { marca_id: "c" },
  ] as unknown as { marca_id: string; participacion: number }[];

  it("leerParticipaciones conserva solo los elementos válidos", () => {
    const leida = leerParticipaciones({ ...part(null), por_marca: sucio });
    expect(leida?.por_marca).toEqual([
      { marca_id: "a", participacion: 0.6 },
      { marca_id: "b", participacion: 0.4 },
    ]);
  });

  it("marcasDeFila y marcasQueNecesitanNombre toleran la lista sin validar", () => {
    const p = part(sucio);
    expect(() => marcasDeFila(p, NOMBRES)).not.toThrow();
    expect(marcasDeFila(p, NOMBRES)?.top.map((m) => m.marca_id)).toEqual(["a", "b"]);
    expect(marcasQueNecesitanNombre(p)).toEqual(["a", "b"]);
    expect(marcasDeFilaApi({ id: "f", equivalencia_id: null, agrupacion_marca_id: "am" }, p, NOMBRES, 3).top).toHaveLength(2);
  });

  it("si no queda ningún elemento válido es como no tener por_marca", () => {
    const p = part([{ participacion: 1 }] as unknown as { marca_id: string; participacion: number }[]);
    expect(marcasDeFila(p, NOMBRES)).toBeNull();
    expect(marcasQueNecesitanNombre(p)).toEqual([]);
  });
});
