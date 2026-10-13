import type { Acumulador } from "@/lib/ventas/acumulador";
import { valorGrupoCombinacion } from "@/lib/ventas/informe";
import type { EnviadaGmlInforme, Exclusion, InformeCarga, InformeMes } from "@/lib/ventas/tipos";
import type { MedidasCarga, PrevisualizarRespuesta } from "@/lib/ventas/tipos-api";
import type { MotivoMapeable, OrigenMapeo } from "@/lib/ventas/tipos-mapeo";

/**
 * Orígenes asignables por mapeo (ficha M5b). Un grupo de error del informe se
 * agrupa por `valor` (por ejemplo "HOMBRES" cuando el género no existe), pero un
 * mapeo tiene por origen una combinación EXACTA género / mundo / línea /
 * equivalencia. Aquí se reconstruye, por mes y grupo, qué combinaciones exactas
 * lo forman y cuánto pesa cada una, recorriendo el acumulador (que vive en
 * memoria mientras la previsualización está vigente) con la misma precedencia
 * que `construirInforme`: una fila con tienda no válida ya salió antes de
 * llegar a la combinación. Si el informe trajera `origenes` en la exclusión
 * (el backend no lo exige), se usaría en su lugar.
 *
 * 0.8.3. Las combinaciones que el resolutor envió a la GML sin equivalencia
 * (`a_gml`) también son orígenes asignables: se indexan bajo el motivo ficticio
 * `enviadas_a_gml` (así no se mezclan con los grupos de error) y con el mismo
 * `valor` que usa el informe (`valorGrupoCombinacion`); su `motivo` (el del
 * mapeo que se cree) es el original. Un mapeo explícito gana al envío.
 *
 * Funciones puras, sin React ni servidor.
 */

export const MOTIVOS_MAPEABLES: readonly MotivoMapeable[] = [
  "genero_desconocido",
  "mundo_desconocido",
  "linea_desconocida",
  "nodo_inexistente",
  "equivalencia_inexistente",
  "genero_inactivo",
  "mundo_inactivo",
  "linea_inactiva",
  "nodo_inactivo",
  "equivalencia_inactiva",
  "clasificacion_incompleta",
];

/** Motivo con que se indexan los orígenes de lo enviado a la GML (no es un motivo de exclusión). */
export const GRUPO_ENVIADAS_GML = "enviadas_a_gml";

export function esMotivoMapeable(motivo: string): motivo is MotivoMapeable {
  return (MOTIVOS_MAPEABLES as readonly string[]).includes(motivo);
}

/** Una combinación de origen con lo que pesa (en el mes de su grupo), en soles y filas. */
export type OrigenAsignable = {
  /** Clave estable de la combinación (`g\u0001m\u0001l\u0001e`). */
  clave: string;
  origen: OrigenMapeo;
  motivo: MotivoMapeable;
  filas: number;
  venta_soles: number;
  costo_vendido: number;
  stock_valorizado: number;
};

export const claveOrigen = (o: OrigenMapeo): string => `${o.genero}\u0001${o.mundo}\u0001${o.linea}\u0001${o.equivalencia}`;

/** `periodo \0 motivo \0 valor` del grupo → combinaciones que lo forman. */
export type IndiceOrigenes = Map<string, OrigenAsignable[]>;

export const claveGrupo = (periodo: string, motivo: string, valor: string): string => `${periodo}\u0000${motivo}\u0000${valor}`;

const aSoles = (centimos: number): number => Math.round(centimos) / 100;

/**
 * Recorre el acumulador una vez y arma, por grupo de exclusión mapeable (mes,
 * motivo y `valor` tal como los agrupa el informe), las combinaciones exactas
 * que lo forman con sus filas y medidas.
 */
export function construirIndiceOrigenes(
  acum: Acumulador,
  res: Pick<PrevisualizarRespuesta, "tiendas" | "combinaciones"> & Partial<Pick<PrevisualizarRespuesta, "marcas">>
): IndiceOrigenes {
  const dic = acum.diccionarios;
  const E = acum.entradas;

  const tiendaOk = dic.tiendas.map((_, t) => res.tiendas[t]?.resultado === "ok");
  /** Una marca desactivada excluye la fila DESPUÉS de la combinación: solo importa para lo enviado a la GML (que sí llega a cargable). */
  const marcaInactiva = dic.marcas.map((_, m) => res.marcas?.[m]?.resultado === "inactiva");
  /** Motivo de la combinación y el `valor` con que el informe agrupa su exclusión (`detalle` del resolutor). */
  const motivo: (MotivoMapeable | null)[] = [];
  const valor: string[] = [];
  /** Motivo con que se indexa el grupo: el del error o `enviadas_a_gml`. */
  const grupo: string[] = [];
  dic.combinaciones.forEach((k, c) => {
    const r = res.combinaciones[c];
    const m: string | null = r ? (r.resultado === "ok" ? (r.a_gml?.motivo_original ?? null) : r.resultado) : "nodo_inexistente";
    motivo[c] = m !== null && esMotivoMapeable(m) ? m : null;
    valor[c] = valorGrupoCombinacion(k, r);
    grupo[c] = r && r.resultado === "ok" && r.a_gml ? GRUPO_ENVIADAS_GML : (motivo[c] ?? "");
  });

  const indice: IndiceOrigenes = new Map();
  const porOrigen = new Map<string, OrigenAsignable>();
  for (let i = 0; i < E.n; i++) {
    if (!tiendaOk[E.tienda[i]]) continue;
    const c = E.combo[i];
    const m = motivo[c];
    if (m === null || m === undefined) continue;
    if (grupo[c] === GRUPO_ENVIADAS_GML && marcaInactiva[E.marca[i]]) continue;
    const k = dic.combinaciones[c];
    // Un origen sin equivalencia (línea vacía con `-`) no se puede guardar: la API exige una equivalencia.
    if (k.equivalencia === "") continue;
    const periodo = dic.periodos[E.periodo[i]];
    const clave = `${periodo}\u0000${c}`;
    let o = porOrigen.get(clave);
    if (!o) {
      o = {
        clave: claveOrigen(k),
        origen: { genero: k.genero, mundo: k.mundo, linea: k.linea, equivalencia: k.equivalencia },
        motivo: m,
        filas: 0,
        venta_soles: 0,
        costo_vendido: 0,
        stock_valorizado: 0,
      };
      porOrigen.set(clave, o);
      const claveGr = claveGrupo(periodo, grupo[c], valor[c]);
      const lista = indice.get(claveGr);
      if (lista) lista.push(o);
      else indice.set(claveGr, [o]);
    }
    o.filas += E.filas[i];
    o.venta_soles += E.venta[i];
    o.costo_vendido += E.costo[i];
    o.stock_valorizado += E.stockValorizado[i];
  }
  // Las medidas se acumularon en céntimos: se pasan a soles una sola vez.
  for (const o of porOrigen.values()) {
    o.venta_soles = aSoles(o.venta_soles);
    o.costo_vendido = aSoles(o.costo_vendido);
    o.stock_valorizado = aSoles(o.stock_valorizado);
  }
  return indice;
}

/** Combinaciones de origen de un grupo de error de un mes (vacío si no hay o no es mapeable). */
export function origenesDeGrupo(indice: IndiceOrigenes, periodo: string, e: Exclusion): OrigenAsignable[] {
  return esMotivoMapeable(e.motivo) ? (indice.get(claveGrupo(periodo, e.motivo, e.valor)) ?? []) : [];
}

/** Combinaciones de origen de un valor enviado a la GML en un mes (vacío si no hay). */
export function origenesDeEnviada(indice: IndiceOrigenes, periodo: string, e: Pick<EnviadaGmlInforme, "valor">): OrigenAsignable[] {
  return indice.get(claveGrupo(periodo, GRUPO_ENVIADAS_GML, e.valor)) ?? [];
}

/** Une orígenes de varios grupos sin repetir la misma combinación (suma sus pesos) y los ordena por peso. */
export function unirOrigenes(listas: OrigenAsignable[][]): OrigenAsignable[] {
  const porClave = new Map<string, OrigenAsignable>();
  for (const lista of listas) {
    for (const o of lista) {
      const previo = porClave.get(o.clave);
      if (!previo) porClave.set(o.clave, { ...o });
      else {
        previo.filas += o.filas;
        previo.venta_soles += o.venta_soles;
        previo.costo_vendido += o.costo_vendido;
        previo.stock_valorizado += o.stock_valorizado;
      }
    }
  }
  // Mayor peso primero (venta más stock, en valor absoluto), como el informe; desempate estable por nombre.
  return [...porClave.values()].sort(
    (a, b) =>
      Math.abs(b.venta_soles) + Math.abs(b.stock_valorizado) - (Math.abs(a.venta_soles) + Math.abs(a.stock_valorizado)) ||
      textoOrigen(a.origen).localeCompare(textoOrigen(b.origen), "es")
  );
}

/** `GÉNERO / MUNDO / LÍNEA / EQUIVALENCIA`; lo vacío se ve como `(vacío)` y el comodín como "cualquier equivalencia". */
export function textoOrigen(o: OrigenMapeo): string {
  const v = (s: string) => (s === "" ? "(vacío)" : s);
  return [v(o.genero), v(o.mundo), v(o.linea), o.equivalencia === "*" ? "cualquier equivalencia" : v(o.equivalencia)].join(" / ");
}

export function textoTerna(o: { genero: string; mundo: string; linea: string }): string {
  const v = (s: string) => (s === "" ? "(vacío)" : s);
  return `${v(o.genero)} / ${v(o.mundo)} / ${v(o.linea)}`;
}

/** `reasignadas` de un mes: filas y medidas que pasaron de error a cargable por mapeo (0 si el informe no lo trae). */
export function reasignadasDe(mes: InformeMes): MedidasCarga {
  return mes.reasignadas ?? { filas: 0, unidades: 0, venta_soles: 0, costo_vendido: 0, stock_unidades: 0, stock_valorizado: 0 };
}

/** `enviadas_a_gml` de un mes: filas y medidas enviadas a la GML sin equivalencia (0 en informes y reportes anteriores a 0.8.3). */
export function enviadasGmlDe(mes: Pick<InformeMes, "enviadas_a_gml"> | { enviadas_a_gml?: undefined }): MedidasCarga {
  return mes.enviadas_a_gml ?? { filas: 0, unidades: 0, venta_soles: 0, costo_vendido: 0, stock_unidades: 0, stock_valorizado: 0 };
}

/** Filas del informe que pasaron de error a cargables por un mapeo (suma de `reasignadas` de todos los meses). */
export function filasReasignadas(informe: InformeCarga): number {
  return informe.meses.reduce((s, m) => s + reasignadasDe(m).filas, 0);
}
