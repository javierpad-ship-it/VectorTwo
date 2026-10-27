import { pendientesPorEntrega, esEntregaVencida } from "@/lib/compras/pendientes";
import type {
  CompraApi,
  EventoCompraApi,
  LineaCompraApi,
  ProveedorApi,
  RecepcionLineaApi,
  ReporteImportacionComprasApi,
} from "@/lib/compras/tipos-api";
import type { FilaImportacionCompra, FilaMezclaImportacion } from "@/lib/compras/esquemas";
import type {
  CompraRegistro,
  EntregaRegistro,
  LineaRegistro,
  RecepcionRegistro,
  RepartoRegistro,
} from "@/lib/compras/tipos";
import { EQ, GEN, LIN, MARCA, MUN, NODO } from "./intercompany.fixture";

/**
 * Casos sintéticos de las compras de M8 (ficha 08, sección 9; casos 2, 2b, 4, 9, 9b, 11, 13 y 26). Todo inventado: proveedores
 * «Proveedor Norte» y «Feria Sur», tiendas T01…, marcas ALFA, BETA, GAMMA, DELTA y JH, cifras redondas. Reutiliza el árbol y las
 * marcas del fixture de M13. Los ids son UUID válidos (v4) para pasar `z.uuid()`.
 *
 * Dos formas de lo mismo: los REGISTROS planos (`registros*`: lo que lee `consultas.ts` y consumen las funciones puras de T2a y T2b)
 * y los objetos de API (`compraApi*`: lo que muestra la pantalla), armados desde los registros con `pendientesPorEntrega` para que
 * no se contradigan.
 */

const uuid = (grupo: string, n: number) => `${grupo}0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export { EQ, GEN, LIN, MARCA, MUN, NODO };

/** Último mes publicado de los casos (`k'`). */
export const K_PRIMA = "2026-09";

export const MARCA_M8 = { ...MARCA, gamma: uuid("f", 20), delta: uuid("f", 21) };
export const NODO_M8 = { ...NODO, sandalia: uuid("d", 20) };
export const LIN_M8 = { ...LIN, sandalia: uuid("c", 20) };
export const AGR_M8 = { reconocido: uuid("9", 1), premium: uuid("9", 2), valor: uuid("9", 3) };
export const TIENDA = { t01: uuid("7", 1), t02: uuid("7", 2), cd: uuid("7", 3) };
export const PERFIL = { planner: uuid("6", 1), comprador1: uuid("6", 2), comprador2: uuid("6", 3) };

export const NOMBRE_MARCA: Record<string, string> = {
  [MARCA_M8.alfa]: "ALFA",
  [MARCA_M8.beta]: "BETA",
  [MARCA_M8.gamma]: "GAMMA",
  [MARCA_M8.delta]: "DELTA",
  [MARCA_M8.jh]: "JOHN HOLDEN",
};
export const NOMBRE_AGRUPACION: Record<string, string> = {
  [AGR_M8.reconocido]: "RECONOCIDO",
  [AGR_M8.premium]: "PREMIUM",
  [AGR_M8.valor]: "VALOR",
};
export const RUTA = {
  denim: "HOMBRE · URBANO · DENIM",
  polo: "HOMBRE · CASUAL · POLO",
  sandalia: "MUJER · CASUAL · SANDALIA",
  camisaLarga: "HOMBRE · FORMAL · CAMISA › MANGA LARGA",
  camisaCorta: "HOMBRE · FORMAL · CAMISA › MANGA CORTA",
};

export const PROVEEDOR = { norte: uuid("5", 1), feria: uuid("5", 2), cdJh: uuid("5", 3) };
export const COMPRA = { c12: uuid("4", 12), c09: uuid("4", 9), c15: uuid("4", 15), c20: uuid("4", 20), c21: uuid("4", 21) };
export const LINEA = { c12: uuid("3", 12), c09: uuid("3", 9), c15: uuid("3", 15), c20: uuid("3", 20), c21: uuid("3", 21) };
export const REPARTO_BETA_V2 = uuid("2", 2);

const sello = (dia: string, hora = "10:02") => `${dia}T${hora}:00.000Z`;

// ─── Proveedores ───

export const proveedoresEjemplo = (): ProveedorApi[] => [
  { id: PROVEEDOR.norte, codigo: "PN", nombre: "Proveedor Norte", pais: "Perú", ciudad: "Lima", identificacion: null, es_intercompany: false, nota: null, activo: true, compras: 3, contactos: [] },
  { id: PROVEEDOR.feria, codigo: null, nombre: "Feria Sur", pais: null, ciudad: null, identificacion: null, es_intercompany: false, nota: null, activo: true, compras: 2, contactos: [] },
  { id: PROVEEDOR.cdJh, codigo: "CDJH", nombre: "CD Intercompany JH", pais: "Perú", ciudad: "Lima", identificacion: null, es_intercompany: true, nota: "CD de las marcas intercompany", activo: true, compras: 0, contactos: [] },
];

// ─── Registros planos ───

export type RegistrosCompra = {
  compras: CompraRegistro[];
  lineas: LineaRegistro[];
  entregas: EntregaRegistro[];
  repartos: RepartoRegistro[];
  recepciones: RecepcionRegistro[];
};

const lineaBase = (p: Partial<LineaRegistro> & Pick<LineaRegistro, "id" | "compra_id" | "unidades">): LineaRegistro => ({
  tipo: "especifica",
  genero_mundo_linea_id: null,
  equivalencia_id: null,
  marca_id: null,
  agrupacion_marca_id: null,
  tallas: "ambas",
  unidades_recibidas: 0,
  unidades_canceladas: 0,
  costo_unitario: null,
  destino: "cd",
  tienda_id: null,
  alcance: {},
  activo: true,
  ...p,
});

const compraBase = (p: Partial<CompraRegistro> & Pick<CompraRegistro, "id" | "numero">): CompraRegistro => ({
  proveedor_id: PROVEEDOR.norte,
  proveedor_nombre: "Proveedor Norte",
  origen: "comprador",
  estado: "confirmada",
  fecha_compra: "2026-10-14",
  moneda: "PEN",
  cancelada_at: null,
  revision: 3,
  ...p,
});

const entrega = (id: string, linea_id: string, periodo: string, unidades: number): EntregaRegistro => ({ id, linea_id, periodo, unidades, origen: "manual" });
const recepcion = (id: string, linea_id: string, recibida_periodo: string, unidades: number, origen: RecepcionRegistro["origen"] = "manual"): RecepcionRegistro => ({
  id,
  linea_id,
  recibida_periodo,
  unidades,
  fecha_recepcion: `${recibida_periodo}-15`,
  origen,
});

/**
 * C-000012 (casos 2, 2b, 9 y 26): Proveedor Norte, ALFA · DENIM · centrales · 500 · S/ 38,00 al CD, `confirmada`. Por defecto una
 * sola entrega en nov-2026; con `entregas` y `recepciones` se arman las variantes (nov 300 · dic 200; 200 recibidas en oct; …).
 */
export function registrosC12(
  op: { entregas?: [string, number][]; recepciones?: [string, number][]; canceladas?: number; estado?: CompraRegistro["estado"]; cancelada_at?: string | null } = {},
): RegistrosCompra {
  const entregas = (op.entregas ?? [["2026-11", 500]]).map(([p, u], i) => entrega(uuid("e", 1200 + i), LINEA.c12, p, u));
  const recepciones = (op.recepciones ?? []).map(([p, u], i) => recepcion(uuid("a", 1200 + i), LINEA.c12, p, u));
  const recibidas = recepciones.reduce((a, r) => a + r.unidades, 0);
  return {
    compras: [compraBase({ id: COMPRA.c12, numero: "C-000012", estado: op.estado ?? "confirmada", cancelada_at: op.cancelada_at ?? null })],
    lineas: [
      lineaBase({
        id: LINEA.c12,
        compra_id: COMPRA.c12,
        genero_mundo_linea_id: NODO_M8.urbano,
        marca_id: MARCA_M8.alfa,
        tallas: "centrales",
        unidades: 500,
        unidades_recibidas: recibidas,
        unidades_canceladas: op.canceladas ?? 0,
        costo_unitario: 38,
      }),
    ],
    entregas,
    repartos: [],
    recepciones,
  };
}

/** C-000009 (caso 9b): Feria Sur, POLO por agrupación PREMIUM · 500, con la entrega de set-2026 vencida y sin confirmar. */
export function registrosC09(): RegistrosCompra {
  return {
    compras: [compraBase({ id: COMPRA.c09, numero: "C-000009", proveedor_id: PROVEEDOR.feria, proveedor_nombre: "Feria Sur", fecha_compra: "2026-08-20", revision: 1 })],
    lineas: [
      lineaBase({
        id: LINEA.c09,
        compra_id: COMPRA.c09,
        genero_mundo_linea_id: NODO_M8.polo,
        agrupacion_marca_id: AGR_M8.premium,
        unidades: 500,
        costo_unitario: 22.5,
      }),
    ],
    entregas: [entrega(uuid("e", 900), LINEA.c09, "2026-09", 500)],
    repartos: [],
    recepciones: [],
  };
}

/** Reparto v2 de BETA por entrega (verano): DENIM · POLO · SANDALIA (ficha 08, caso 4). */
const REPARTO_BETA: Record<string, [number, number, number]> = { "2026-12": [236, 117, 47], "2027-01": [207, 102, 41], "2027-02": [147, 73, 30] };

/** C-000020 (caso 4): Feria Sur, lote de BETA · 1 000 · entregas dic 400 · ene 350 · feb 250, con su reparto guardado por entrega. */
export function registrosC20Lote(op: { recepciones?: [string, number][]; vigente_v3?: boolean } = {}): RegistrosCompra {
  const periodos = ["2026-12", "2027-01", "2027-02"];
  const unidades = [400, 350, 250];
  const entregas = periodos.map((p, i) => entrega(uuid("e", 2000 + i), LINEA.c20, p, unidades[i]));
  const repartos: RepartoRegistro[] = [];
  periodos.forEach((p, i) => {
    const [d, po, sa] = REPARTO_BETA[p];
    const fila = (gml: string, u: number): RepartoRegistro => ({
      linea_id: LINEA.c20,
      entrega_id: entregas[i].id,
      marca_id: MARCA_M8.beta,
      genero_mundo_linea_id: gml,
      equivalencia_id: null,
      unidades: u,
      reparto_id: REPARTO_BETA_V2,
      reparto_version: 2,
      temporada: "verano",
      error_reparto_pp: 8,
    });
    repartos.push(fila(NODO_M8.urbano, d), fila(NODO_M8.polo, po), fila(NODO_M8.sandalia, sa));
  });
  const recepciones = (op.recepciones ?? []).map(([p, u], i) => recepcion(uuid("a", 2000 + i), LINEA.c20, p, u));
  return {
    compras: [compraBase({ id: COMPRA.c20, numero: "C-000020", proveedor_id: PROVEEDOR.feria, proveedor_nombre: "Feria Sur", fecha_compra: "2026-10-20", revision: 2 })],
    lineas: [
      lineaBase({
        id: LINEA.c20,
        compra_id: COMPRA.c20,
        tipo: "barrer_marca",
        marca_id: MARCA_M8.beta,
        unidades: 1000,
        unidades_recibidas: recepciones.reduce((a, r) => a + r.unidades, 0),
        costo_unitario: 22.5,
        alcance: {},
      }),
    ],
    entregas,
    repartos,
    recepciones,
  };
}

/** C-000015 (carga inicial, caso 11/13): GAMMA · CAMISA › MANGA CORTA · 200 con `LLEGADA = 2026-08` y `RECIBIDAS = 200`: ya está en el stock. */
export function registrosC15CargaInicial(): RegistrosCompra {
  return {
    compras: [compraBase({ id: COMPRA.c15, numero: "C-000015", origen: "carga_inicial", estado: "recibida", fecha_compra: "2026-07-30", revision: 1 })],
    lineas: [
      lineaBase({
        id: LINEA.c15,
        compra_id: COMPRA.c15,
        genero_mundo_linea_id: NODO_M8.camisa,
        equivalencia_id: EQ.corta,
        marca_id: MARCA_M8.gamma,
        unidades: 200,
        unidades_recibidas: 200,
        costo_unitario: 41,
      }),
    ],
    entregas: [{ ...entrega(uuid("e", 1500), LINEA.c15, "2026-08", 200), origen: "importada" }],
    repartos: [],
    recepciones: [recepcion(uuid("a", 1500), LINEA.c15, "2026-08", 200, "importada")],
  };
}

/** Todos los registros de los casos juntos (lo que leería `consultas.ts` de una base con estas compras). */
export function registrosEjemplo(): RegistrosCompra {
  const partes = [registrosC12(), registrosC09(), registrosC20Lote(), registrosC15CargaInicial()];
  return {
    compras: partes.flatMap((p) => p.compras),
    lineas: partes.flatMap((p) => p.lineas),
    entregas: partes.flatMap((p) => p.entregas),
    repartos: partes.flatMap((p) => p.repartos),
    recepciones: partes.flatMap((p) => p.recepciones),
  };
}

// ─── Objetos de API ───

type DatosLinea = {
  registro: LineaRegistro;
  entregas: EntregaRegistro[];
  recepciones: RecepcionRegistro[];
  repartos: RepartoRegistro[];
  ruta: string | null;
  gml_id?: string | null;
  sugerencias?: Record<string, { periodo: string; unidades: number }>;
  avisos?: LineaCompraApi["avisos"];
  usuario_recepcion?: string;
};

const temporadaDeMes = (periodo: string): "verano" | "invierno" => {
  const mes = Number(periodo.slice(5, 7));
  return mes >= 4 && mes <= 9 ? "invierno" : "verano";
};

export function lineaApiDesdeRegistros(d: DatosLinea, kPrima: string = K_PRIMA): LineaCompraApi {
  const r = d.registro;
  const pend = pendientesPorEntrega(r, d.entregas, d.recepciones);
  const entregas = pend.entregas.map((e) => {
    const origen = d.entregas.find((x) => x.id === e.id)?.origen ?? "manual";
    return {
      id: e.id,
      periodo: e.periodo,
      unidades: e.unidades,
      asignadas: e.asignadas,
      canceladas: e.canceladas,
      pendiente: e.pendiente,
      vencida: esEntregaVencida(e, kPrima),
      sugerencia: d.sugerencias?.[e.id] ?? null,
      temporada: temporadaDeMes(e.periodo),
      origen,
    };
  });
  const recepciones: RecepcionLineaApi[] = d.recepciones.map((x) => ({
    id: x.id,
    recibida_periodo: x.recibida_periodo,
    unidades: x.unidades,
    fecha_recepcion: x.fecha_recepcion,
    origen: x.origen,
    usuario_nombre: x.origen === "importada" ? "Planner Uno" : (d.usuario_recepcion ?? "Planner Uno"),
    nota: x.origen === "sugerencia" ? "Aceptada desde la conciliación" : null,
    avisos: x.recibida_periodo <= kPrima ? ["recepcion_en_mes_cerrado"] : [],
  }));

  const nombreDeNodo = (gml: string, eq: string | null) =>
    gml === NODO_M8.urbano ? RUTA.denim : gml === NODO_M8.polo ? RUTA.polo : gml === NODO_M8.sandalia ? RUTA.sandalia : eq === EQ.corta ? RUTA.camisaCorta : RUTA.camisaLarga;
  const fila = (x: RepartoRegistro) => ({
    marca_id: x.marca_id,
    marca: NOMBRE_MARCA[x.marca_id] ?? "—",
    gml_id: x.genero_mundo_linea_id,
    equivalencia_id: x.equivalencia_id,
    ruta: nombreDeNodo(x.genero_mundo_linea_id, x.equivalencia_id),
    unidades: x.unidades,
  });
  const sumar = (filas: ReturnType<typeof fila>[]) => {
    const por = new Map<string, ReturnType<typeof fila>>();
    for (const f of filas) {
      const k = `${f.marca_id}|${f.gml_id}|${f.equivalencia_id}`;
      const previa = por.get(k);
      if (previa) previa.unidades += f.unidades;
      else por.set(k, { ...f });
    }
    return [...por.values()];
  };
  const reparto =
    r.tipo === "barrer_marca" && d.repartos.length > 0
      ? {
          reparto_id: d.repartos[0].reparto_id,
          version: d.repartos[0].reparto_version,
          error_reparto_pp: d.repartos[0].error_reparto_pp,
          vigente: true,
          por_entrega: pend.entregas.map((e) => ({
            entrega_id: e.id,
            temporada: d.repartos.find((x) => x.entrega_id === e.id)?.temporada ?? null,
            filas: d.repartos.filter((x) => x.entrega_id === e.id).map(fila),
          })),
          filas: sumar(d.repartos.map(fila)),
        }
      : null;

  const primera = entregas[0]?.periodo ?? kPrima;
  return {
    id: r.id,
    compra_id: r.compra_id,
    tipo: r.tipo,
    gml_id: r.genero_mundo_linea_id,
    equivalencia_id: r.equivalencia_id,
    ruta: d.ruta,
    marca_id: r.marca_id,
    marca: r.marca_id ? (NOMBRE_MARCA[r.marca_id] ?? null) : null,
    agrupacion_marca_id: r.agrupacion_marca_id,
    agrupacion_marca: r.agrupacion_marca_id ? (NOMBRE_AGRUPACION[r.agrupacion_marca_id] ?? null) : null,
    tallas: r.tallas,
    unidades: r.unidades,
    unidades_recibidas: pend.recibidas,
    unidades_canceladas: r.unidades_canceladas,
    costo_unitario: r.costo_unitario,
    llegada_periodo: primera,
    destino: r.destino,
    tienda: null,
    alcance: r.tipo === "barrer_marca" ? { generos: [], mundos: [], lineas: [] } : null,
    mezcla: null,
    entregas,
    reparto,
    recepciones,
    nota: null,
    avisos: d.avisos ?? (entregas.some((e) => e.vencida) ? ["entrega_vencida"] : []),
  };
}

const persona = (nombre: string | null, at: string) => ({ nombre, at });

export function compraApiDesdeRegistros(
  reg: RegistrosCompra,
  op: {
    ruta: (l: LineaRegistro) => string | null;
    sugerencias?: Record<string, { periodo: string; unidades: number }>;
    historial?: EventoCompraApi[];
    cancelada_por?: CompraApi["cancelada_por"];
    es_intercompany?: boolean;
    kPrima?: string;
  },
): CompraApi {
  const c = reg.compras[0];
  const kPrima = op.kPrima ?? K_PRIMA;
  const lineas = reg.lineas.map((l) =>
    lineaApiDesdeRegistros(
      {
        registro: l,
        entregas: reg.entregas.filter((e) => e.linea_id === l.id),
        recepciones: reg.recepciones.filter((x) => x.linea_id === l.id),
        repartos: reg.repartos.filter((x) => x.linea_id === l.id),
        ruta: op.ruta(l),
        sugerencias: op.sugerencias,
      },
      kPrima,
    ),
  );
  const periodos = lineas.flatMap((l) => l.entregas.map((e) => e.periodo)).sort();
  const costo = lineas.reduce((a, l) => a + (l.costo_unitario === null ? 0 : l.costo_unitario * l.unidades), 0);
  const saldoCerrado = c.estado === "recibida" && c.cancelada_at !== null;
  const avisos = [...new Set(lineas.flatMap((l) => l.avisos))];
  return {
    id: c.id,
    numero: c.numero,
    proveedor: { id: c.proveedor_id, nombre: c.proveedor_nombre, es_intercompany: op.es_intercompany ?? false },
    origen: c.origen,
    estado: c.estado,
    saldo_cerrado: saldoCerrado,
    fecha_compra: c.fecha_compra,
    referencia: c.numero === "C-000012" ? "PO-2211" : null,
    moneda: c.moneda,
    nota: null,
    justificacion_exceso: null,
    excede_tope_al_confirmar: [],
    creada_por: persona("Planner Uno", sello(c.fecha_compra)),
    modificada_por: c.revision > 0 ? persona("Planner Uno", sello(c.fecha_compra, "11:40")) : null,
    confirmada_por: c.estado === "borrador" ? null : persona("Planner Uno", sello(c.fecha_compra, "10:05")),
    cancelada_por: op.cancelada_por ?? null,
    lineas,
    totales: { unidades: lineas.reduce((a, l) => a + l.unidades, 0), costo, recibidas: lineas.reduce((a, l) => a + l.unidades_recibidas, 0) },
    llegadas: periodos.length > 0 ? { desde: periodos[0], hasta: periodos[periodos.length - 1], entregas: periodos.length } : null,
    mia: false,
    revision: c.revision,
    puede: {
      editar: c.estado !== "cancelada",
      confirmar: c.estado === "borrador",
      recibir: c.estado === "confirmada" || saldoCerrado,
      cancelar: c.estado === "borrador" || c.estado === "confirmada",
      aplicar_reparto: c.estado === "confirmada",
    },
    historial: op.historial ?? [],
    avisos,
  };
}

const rutaPorNodo = (l: LineaRegistro) =>
  l.tipo === "barrer_marca"
    ? null
    : l.genero_mundo_linea_id === NODO_M8.urbano
      ? RUTA.denim
      : l.genero_mundo_linea_id === NODO_M8.polo
        ? RUTA.polo
        : l.equivalencia_id === EQ.corta
          ? RUTA.camisaCorta
          : RUTA.camisaLarga;

/** Historial de C-000012 como lo dejarían las funciones de escritura: importar → confirmar ingreso → quitarlo → confirmarlo → cancelar. */
export const historialC12 = (): EventoCompraApi[] => [
  { id: uuid("1", 1201), linea_id: LINEA.c12, accion: "importar", antes: null, despues: { unidades: 500 }, motivo: null, resumen: "Importó la línea 1 (carga inicial)", usuario_nombre: "Planner Uno", created_at: sello("2026-10-14") },
  { id: uuid("1", 1202), linea_id: LINEA.c12, accion: "recibir", antes: { recibidas: 0 }, despues: { recibidas: 200 }, motivo: null, resumen: "200 u ingresadas en oct-2026", usuario_nombre: "Planner Uno", created_at: sello("2026-10-20", "09:15") },
  { id: uuid("1", 1203), linea_id: LINEA.c12, accion: "quitar_recepcion", antes: { recibidas: 200 }, despues: { recibidas: 0 }, motivo: null, resumen: "Quitó el ingreso de 200 u de oct-2026", usuario_nombre: "Planner Uno", created_at: sello("2026-10-20", "09:40") },
  { id: uuid("1", 1204), linea_id: LINEA.c12, accion: "recibir", antes: { recibidas: 0 }, despues: { recibidas: 300 }, motivo: null, resumen: "300 u ingresadas (100 en ago-2026 y 200 en oct-2026)", usuario_nombre: "Planner Uno", created_at: sello("2026-10-21", "08:30") },
  { id: uuid("1", 1205), linea_id: null, accion: "cancelar", antes: { estado: "confirmada" }, despues: { estado: "recibida", unidades_canceladas: 200 }, motivo: "El proveedor no entrega el saldo", resumen: "Cerró el saldo de 200 u", usuario_nombre: "Planner Uno", created_at: sello("2026-10-25", "16:00") },
];

/** C-000012 tal cual el caso 2: una entrega en nov-2026, sin recepciones. */
export const compraApiC12 = (): CompraApi => compraApiDesdeRegistros(registrosC12(), { ruta: rutaPorNodo, historial: historialC12().slice(0, 1) });

/** C-000012 con entregas nov 300 · dic 200 y 100 u ya ingresadas en oct (regla 4: FIFO). */
export const compraApiC12Parcial = (): CompraApi =>
  compraApiDesdeRegistros(registrosC12({ entregas: [["2026-11", 300], ["2026-12", 200]], recepciones: [["2026-10", 100]] }), { ruta: rutaPorNodo, historial: historialC12().slice(0, 2) });

/** Caso 26: 300 de 500 recibidas (100 en ago, 200 en oct), saldo de 200 u cancelado: «Recibida · saldo cancelado». */
export const compraApiC12SaldoCerrado = (): CompraApi =>
  compraApiDesdeRegistros(
    registrosC12({
      entregas: [["2026-10", 300], ["2026-11", 200]],
      recepciones: [["2026-08", 100], ["2026-10", 200]],
      canceladas: 200,
      estado: "recibida",
      cancelada_at: sello("2026-10-25", "16:00"),
    }),
    {
      ruta: rutaPorNodo,
      historial: historialC12(),
      cancelada_por: { nombre: "Planner Uno", at: sello("2026-10-25", "16:00"), motivo: "El proveedor no entrega el saldo" },
    },
  );

/** Caso 9b: la entrega de set de C-000009 está vencida y la conciliación de set propone confirmar sus 500 u en set-2026. */
export const compraApiC09Vencida = (): CompraApi =>
  compraApiDesdeRegistros(registrosC09(), { ruta: rutaPorNodo, sugerencias: { [uuid("e", 900)]: { periodo: "2026-09", unidades: 500 } } });

/** Caso 4: lote de BETA con su reparto v2 por entrega. */
export const compraApiC20Lote = (): CompraApi => compraApiDesdeRegistros(registrosC20Lote(), { ruta: rutaPorNodo });

/** Carga inicial ya recibida: no suma al flujo. */
export const compraApiC15CargaInicial = (): CompraApi => compraApiDesdeRegistros(registrosC15CargaInicial(), { ruta: rutaPorNodo });

/** Una compra cancelada sin recepciones (cancelada → todo deja de contar). */
export function compraApiCancelada(): CompraApi {
  const base = registrosC12();
  base.compras[0] = { ...base.compras[0], id: COMPRA.c21, numero: "C-000021", estado: "cancelada", cancelada_at: sello("2026-10-22", "12:00"), revision: 4 };
  base.lineas[0] = { ...base.lineas[0], id: LINEA.c21, compra_id: COMPRA.c21 };
  base.entregas = base.entregas.map((e, i) => ({ ...e, id: uuid("e", 2100 + i), linea_id: LINEA.c21 }));
  return compraApiDesdeRegistros(base, {
    ruta: rutaPorNodo,
    cancelada_por: { nombre: "Planner Uno", at: sello("2026-10-22", "12:00"), motivo: "Se compró por error" },
  });
}

export const comprasApiEjemplo = (): CompraApi[] => [
  compraApiC12(),
  compraApiC09Vencida(),
  compraApiC20Lote(),
  compraApiC15CargaInicial(),
  compraApiC12SaldoCerrado(),
  compraApiCancelada(),
];

// ─── Importador (caso 13) ───

const filaImp = (p: Partial<FilaImportacionCompra>): FilaImportacionCompra => ({
  proveedor: "Proveedor Norte",
  fecha_compra: "2026-10-14",
  referencia: "PO-2211",
  linea_ordinal: "1",
  tipo: "ESPECIFICA",
  genero: "HOMBRE",
  mundo: "URBANO",
  linea: "DENIM",
  equivalencia: "",
  marca: "ALFA",
  agrupacion_marca: "",
  tallas: "centrales",
  unidades: "500",
  costo_unitario: "38",
  moneda: "PEN",
  llegada: "",
  entregas: "",
  recibidas: "",
  destino: "CD",
  alcance: "",
  nota: "",
  ...p,
});

/** Las seis filas del caso 13 (con `REFERENCIA` y `LINEA` en todas): tres válidas y tres que se omiten en `0.13.0`. */
export const filasImportacionEjemplo = (): FilaImportacionCompra[] => [
  filaImp({ linea_ordinal: "1", entregas: "2026-11:300;2026-12:200" }),
  filaImp({ linea_ordinal: "2", genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA", equivalencia: "MANGA CORTA", marca: "GAMMA", unidades: "200", costo_unitario: "41", llegada: "2026-08", recibidas: "200" }),
  filaImp({ proveedor: "Feria Sur", referencia: "FS-001", linea_ordinal: "1", tipo: "UNA_MARCA", genero: "", mundo: "", linea: "", marca: "BETA", unidades: "1000", costo_unitario: "22.5", alcance: "HOMBRE", entregas: "2026-12:400;2027-01:350;2027-02:250" }),
  filaImp({ linea_ordinal: "3", marca: "ALFA", agrupacion_marca: "RECONOCIDO", llegada: "2026-11" }),
  filaImp({ linea_ordinal: "4", entregas: "2026-11:300;2026-12:300" }),
  filaImp({ proveedor: "Feria Sur", referencia: "FS-001", linea_ordinal: "2", tipo: "VARIAS_MARCAS", genero: "", mundo: "", linea: "", marca: "", unidades: "1000", llegada: "2026-12" }),
];

export const filasMezclaEjemplo = (): FilaMezclaImportacion[] => [
  { referencia: "FS-001", linea_ordinal: "2", marca: "BETA", genero: "HOMBRE", mundo: "URBANO", linea: "DENIM", equivalencia: "", pct: "40" },
  { referencia: "FS-001", linea_ordinal: "2", marca: "BETA", genero: "HOMBRE", mundo: "CASUAL", linea: "POLO", equivalencia: "", pct: "20" },
  { referencia: "FS-001", linea_ordinal: "2", marca: "GAMMA", genero: "HOMBRE", mundo: "FORMAL", linea: "CAMISA", equivalencia: "MANGA LARGA", pct: "25" },
  { referencia: "FS-001", linea_ordinal: "2", marca: "DELTA", genero: "MUJER", mundo: "CASUAL", linea: "SANDALIA", equivalencia: "", pct: "15" },
];

/** Previsualización del caso 13 en `0.13.0`: 3 líneas nuevas en 2 compras, proveedor nuevo «Feria Sur» y 3 omitidas. */
export function reporteImportacionEjemplo(modo: "previsualizar" | "aplicar" = "previsualizar"): ReporteImportacionComprasApi {
  const aplicar = modo === "aplicar";
  return {
    modo,
    carga_inicial: true,
    k_prima: K_PRIMA,
    totales: { recibidas: 6, procesadas: 3, omitidas: 3, nuevas: 3, iguales: 0, cambiadas: 0 },
    compras_a_crear: [
      { clave: "PROVEEDOR NORTE|PO-2211", proveedor: "Proveedor Norte", referencia: "PO-2211", fecha_compra: "2026-10-14", moneda: "PEN", lineas: 2, lineas_nuevas: 2, existente: null },
      { clave: "FERIA SUR|FS-001", proveedor: "Feria Sur", referencia: "FS-001", fecha_compra: "2026-10-14", moneda: "PEN", lineas: 1, lineas_nuevas: 1, existente: null },
    ],
    proveedores_a_crear: ["Feria Sur"],
    lineas: [
      { fila: 1, clave: "PROVEEDOR NORTE|PO-2211|1", compra_clave: "PROVEEDOR NORTE|PO-2211", linea_ordinal: 1, clasificacion: "nueva", tipo: "especifica", ruta: RUTA.denim, marca: "ALFA", agrupacion_marca: "RECONOCIDO", unidades: 500, recibidas: 0, entregas: [{ periodo: "2026-11", unidades: 300 }, { periodo: "2026-12", unidades: 200 }], avisos: [], cambios: [] },
      { fila: 2, clave: "PROVEEDOR NORTE|PO-2211|2", compra_clave: "PROVEEDOR NORTE|PO-2211", linea_ordinal: 2, clasificacion: "nueva", tipo: "especifica", ruta: RUTA.camisaCorta, marca: "GAMMA", agrupacion_marca: "RECONOCIDO", unidades: 200, recibidas: 200, entregas: [{ periodo: "2026-08", unidades: 200 }], avisos: [], cambios: [] },
      { fila: 3, clave: "FERIA SUR|FS-001|1", compra_clave: "FERIA SUR|FS-001", linea_ordinal: 1, clasificacion: "nueva", tipo: "barrer_marca", ruta: null, marca: "BETA", agrupacion_marca: "PREMIUM", unidades: 1000, recibidas: 0, entregas: [{ periodo: "2026-12", unidades: 400 }, { periodo: "2027-01", unidades: 350 }, { periodo: "2027-02", unidades: 250 }], avisos: ["exceso"], cambios: [] },
    ],
    omitidas: [
      { fila: 4, motivo: "marca_y_agrupacion", proveedor: "Proveedor Norte", referencia: "PO-2211", linea_ordinal: "3", detalle: "Elige la marca o la agrupación, no las dos." },
      { fila: 5, motivo: "entregas_invalidas", proveedor: "Proveedor Norte", referencia: "PO-2211", linea_ordinal: "4", detalle: "Las entregas suman 600 y la línea es de 500." },
      { fila: 6, motivo: "tipo_no_disponible", proveedor: "Feria Sur", referencia: "FS-001", linea_ordinal: "2", detalle: "Los lotes de varias marcas se activan con M9a." },
    ],
    avisos: [{ fila: 3, aviso: "exceso", detalle: "nov-2026: IMI 9,1 (exceso 310 u)" }],
    aplicadas: aplicar
      ? [
          { clave: "PROVEEDOR NORTE|PO-2211", compra_id: COMPRA.c12, numero: "C-000012", lineas: 2 },
          { clave: "FERIA SUR|FS-001", compra_id: COMPRA.c20, numero: "C-000020", lineas: 1 },
        ]
      : [],
    no_aplicadas: [],
  };
}
