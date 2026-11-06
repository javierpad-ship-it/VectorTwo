/**
 * Planilla C2 de la carga de compras desde COTV (docs/modulos/08b-fechas-logisticas.md §2.7, decisión 117; docs/modulos/08c-proveedores-y-fotos-de-
 * compras.md §12.2 b). FUNCIÓN PURA, SIN DATOS: no lee COTV ni la base, no escribe archivos y no trae ningún dato real. La corre `datos` en la
 * sesión de carga con lo que lee de COTV (solo `SELECT`); aquí solo se decide cómo se agrupan los ítems y qué lleva cada columna.
 *
 * En Vector2 una compra es una orden de compra (OC), pero COTV creó una cabecera por ítem. La planilla agrupa los ítems en compras:
 *  - UNA COMPRA POR (proveedor de Vector2, viaje). NO se agrupa por día de registro (Javier). Los ítems de los proveedores que C1 unió van
 *    juntos: el que llama manda a cada ítem con el `supplier_id` del proveedor que QUEDÓ en C1 (el de su `clave_origen`).
 *  - `REFERENCIA = COTV-{codigo_viaje}-{supplier_id}`. La referencia es la clave de agrupación del importador y nunca cambia.
 *  - `LINEA_ORDINAL` = 1, 2, 3… dentro del grupo, por `created_at` y luego `id`.
 *  - `FECHA_COMPRA` = UNA sola por grupo, igual en todas sus filas: el día EN LIMA del ítem más antiguo. No `purchase_date` (que toma el día en
 *    UTC: un registro de las 19:00 a las 23:59 de Lima cae al día siguiente). El importador omite las filas de una compra con otra fecha
 *    (`cabecera_inconsistente`), por eso se uniforma.
 *  - `DIA_REGISTRO` (el día en Lima de cada ítem) e `ITEM_COTV` (el id del ítem) son INFORMATIVAS: el importador las ignora; sirven para
 *    decidir dónde partir un grupo y para enlazar después descripción, modelo y fotos con su línea.
 *  - `LLEGADA = 2026-12` (un MES, como siempre en el importador) y `EMBARQUE`, `PAQUETE` y `OC` vacías: las compras entran en diciembre sin
 *    embarque; Javier las reparte por proveedor con «Asignar» y completa la OC después.
 *  - `NOTA`: una sola por grupo, igual en todas sus filas («Registrada en COTV por …» más las notas distintas de las cabeceras). El importador
 *    guarda la nota en CADA LÍNEA (`compra_lineas.nota`, tope `MAX_NOTA_LINEA` = 200: `importar.ts` la corta con `slice` sin avisar y la nota de la
 *    cabecera de la compra va nula), así que el tope de la planilla es el de la línea, no el de 500 de la cabecera: lo que se corta aquí se avisa.
 *  - Hoja `GRUPOS`: un grupo por fila con su primer y último día de registro y la marca «varios días» (los candidatos a partir). Hoja `LEEME`:
 *    cómo partir un grupo (cambiar la `REFERENCIA` de la segunda OC y poner una sola `FECHA_COMPRA` en cada parte).
 *
 * Se prueba en `tests/cotv.planilla-c2.test.ts` (F42) con datos sintéticos.
 */
import { MAX_NOTA_LINEA } from "../../src/lib/compras/tipos";
import type { Hoja } from "../../src/lib/proyeccion/excel";

/** Un ítem de COTV (`purchase_items` con lo que le corresponde de su cabecera y de su necesidad), ya con el proveedor y el viaje de Vector2. */
export type ItemCotv = {
  /** `purchase_items.id`. */
  item_id: string;
  /** `purchase_items.created_at`, instante ISO (`timestamptz`). */
  created_at: string;
  /** `id` de COTV del proveedor que QUEDÓ en C1 (el de su `clave_origen`; para un proveedor unido, el del proveedor al que se unió). */
  supplier_id: string;
  /** Nombre del proveedor en Vector2. */
  proveedor: string;
  /** Código (6 caracteres) del viaje de COTV en Vector2. */
  codigo_viaje: string;
  /** `profiles.full_name` del comprador de la cabecera; nulo si no se sabe. */
  comprador: string | null;
  /** `purchases.notes` de la cabecera; nulo si no tiene. */
  nota: string | null;
  /** `otb_needs.gender`, código de COTV (`H`, `M`, `JH`, `JM`, `NH`, `NM`, `BB`). */
  genero: string;
  /** `otb_needs.mundo`. */
  mundo: string;
  /** `otb_needs.linea_sap`. */
  linea: string;
  /** `purchase_items.brand`. */
  marca: string;
  /** `purchase_items.units` (puede traer decimales: el importador omite la fila con `unidades_invalida`). */
  unidades: number;
  /** `purchase_items.fob_unit_cost`, en dólares. */
  costo_fob: number;
};

/** Mes de llegada que se pone a todo (Javier: «inicialmente ponle a todo llegada en diciembre»). Es un mes, no un día. */
export const LLEGADA_INICIAL_COTV = "2026-12";
/** Tope de la `NOTA` en el importador: la nota se guarda por línea (`MAX_NOTA_LINEA`) y el importador la corta en silencio; aquí se corta avisando. */
export const MAX_NOTA_PLANILLA = MAX_NOTA_LINEA;
/** Moneda del FOB de COTV (decisión 102). */
export const MONEDA_COTV = "USD";

/** Los códigos de género de COTV y el de Vector2 (08c §12.2 b). Otro código → la fila queda a revisar (`genero_desconocido`). */
export const GENERO_COTV_A_VECTOR2: Readonly<Record<string, string>> = {
  H: "H",
  M: "M",
  JH: "JOVENCITOS",
  JM: "JOVENCITAS",
  NH: "NINOS",
  NM: "NINAS",
  BB: "BEBE",
};

/** Encabezados de la hoja de compras: los del importador (en su orden) y, al final, las dos columnas informativas. */
export const COLUMNAS_PLANILLA_C2 = [
  "PROVEEDOR",
  "FECHA_COMPRA",
  "REFERENCIA",
  "LINEA_ORDINAL",
  "TIPO",
  "GENERO",
  "MUNDO",
  "LINEA",
  "EQUIVALENCIA",
  "MARCA",
  "AGRUPACION_MARCA",
  "TALLAS",
  "UNIDADES",
  "COSTO_UNITARIO",
  "MONEDA",
  "LLEGADA",
  "ENTREGAS",
  "RECIBIDAS",
  "DESTINO",
  "ALCANCE",
  "NOTA",
  "VIAJE",
  "EMBARQUE",
  "PAQUETE",
  "OC",
  "DIA_REGISTRO",
  "ITEM_COTV",
] as const;
export type ColumnaPlanillaC2 = (typeof COLUMNAS_PLANILLA_C2)[number];
export type FilaPlanillaC2 = Record<ColumnaPlanillaC2, string>;

export type GrupoPlanillaC2 = {
  proveedor: string;
  viaje: string;
  referencia: string;
  lineas: number;
  fecha_compra: string;
  primer_dia_registro: string;
  ultimo_dia_registro: string;
  /** Los ítems del grupo se registraron en más de un día: candidato a partir si el proveedor tuvo dos OC. */
  varios_dias: boolean;
};

export type AvisoPlanillaC2 = {
  aviso: "genero_desconocido" | "nota_cortada";
  referencia: string;
  /** Solo en `genero_desconocido`: el `ITEM_COTV` de la fila a revisar. */
  item?: string;
  detalle: string;
};

export type ResultadoPlanillaC2 = {
  filas: FilaPlanillaC2[];
  grupos: GrupoPlanillaC2[];
  avisos: AvisoPlanillaC2[];
  /** Las tres hojas del libro: `COMPRAS` (encabezado del importador más las dos informativas), `GRUPOS` y `LEEME`. */
  hojas: { COMPRAS: Hoja; GRUPOS: Hoja; LEEME: Hoja };
};

// ─── Fechas: el día en Lima ───

const MS_LIMA = 5 * 3_600_000;

/** Día `aaaa-mm-dd` EN LIMA de un instante (Lima es UTC−5 todo el año: no hay horario de verano). */
export function diaEnLima(instanteIso: string): string {
  const ms = Date.parse(instanteIso);
  if (Number.isNaN(ms)) throw new RangeError(`Instante inválido: ${instanteIso}`);
  return new Date(ms - MS_LIMA).toISOString().slice(0, 10);
}

// ─── Agrupar ───

/** Referencia de la compra de un grupo: `COTV-{codigo_viaje}-{supplier_id}`. */
export const referenciaCotv = (codigoViaje: string, supplierId: string): string => `COTV-${codigoViaje}-${supplierId}`;

const comparar = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const porOrdenDeRegistro = (a: ItemCotv, b: ItemCotv) => comparar(a.created_at, b.created_at) || comparar(a.item_id, b.item_id);

/** `NOTA` de un grupo: «Registrada en COTV por {compradores distintos}» y las notas distintas, separadas por « · », cortada al tope de la nota de una línea (200). */
function notaDelGrupo(items: readonly ItemCotv[]): { nota: string; cortada: boolean } {
  const distintos = (valores: (string | null)[]) => {
    const vistos = new Set<string>();
    const salida: string[] = [];
    for (const v of valores) {
      const t = (v ?? "").trim().replace(/\s+/g, " ");
      if (t !== "" && !vistos.has(t)) {
        vistos.add(t);
        salida.push(t);
      }
    }
    return salida;
  };
  const compradores = distintos(items.map((i) => i.comprador));
  const notas = distintos(items.map((i) => i.nota));
  const partes = [compradores.length > 0 ? `Registrada en COTV por ${compradores.join(", ")}` : "Registrada en COTV", ...notas];
  const completa = partes.join(" · ");
  return completa.length <= MAX_NOTA_PLANILLA ? { nota: completa, cortada: false } : { nota: `${completa.slice(0, MAX_NOTA_PLANILLA - 1)}…`, cortada: true };
}

/**
 * Agrupa los ítems de COTV en compras de Vector2 y arma las filas de la planilla C2 (08b-1b §2.7). Una compra por (proveedor, viaje); las
 * filas salen ordenadas por proveedor, viaje y día de registro. No muta `items`. Sin ítems, devuelve las tres hojas solo con su encabezado.
 */
export function agruparItemsCotv(items: readonly ItemCotv[]): ResultadoPlanillaC2 {
  // Grupo = (supplier_id que quedó en C1, viaje). El nombre del proveedor es el del primer ítem del grupo.
  const grupos = new Map<string, ItemCotv[]>();
  for (const it of items) {
    const k = `${it.supplier_id}|${it.codigo_viaje}`;
    const g = grupos.get(k);
    if (g) g.push(it);
    else grupos.set(k, [it]);
  }

  const filas: FilaPlanillaC2[] = [];
  const resumen: GrupoPlanillaC2[] = [];
  const avisos: AvisoPlanillaC2[] = [];

  const ordenados = [...grupos.values()]
    .map((g) => g.slice().sort(porOrdenDeRegistro))
    .sort((a, b) => comparar(a[0].proveedor.toUpperCase(), b[0].proveedor.toUpperCase()) || comparar(a[0].codigo_viaje, b[0].codigo_viaje) || comparar(a[0].supplier_id, b[0].supplier_id));

  for (const g of ordenados) {
    const primero = g[0];
    const referencia = referenciaCotv(primero.codigo_viaje, primero.supplier_id);
    const dias = g.map((i) => diaEnLima(i.created_at));
    const fechaCompra = dias.reduce((m, d) => (d < m ? d : m), dias[0]);
    const { nota, cortada } = notaDelGrupo(g);
    if (cortada) avisos.push({ aviso: "nota_cortada", referencia, detalle: `La nota del grupo supera ${MAX_NOTA_PLANILLA} caracteres (el tope de la nota de una línea) y se cortó.` });
    const ultimoDia = dias.reduce((m, d) => (d > m ? d : m), dias[0]);

    g.forEach((it, i) => {
      const generoVector2 = GENERO_COTV_A_VECTOR2[it.genero.trim().toUpperCase()];
      if (generoVector2 === undefined) avisos.push({ aviso: "genero_desconocido", referencia, item: it.item_id, detalle: `El código de género «${it.genero}» no tiene equivalente en Vector2: revisa la fila.` });
      filas.push({
        PROVEEDOR: it.proveedor,
        FECHA_COMPRA: fechaCompra,
        REFERENCIA: referencia,
        LINEA_ORDINAL: String(i + 1),
        TIPO: "ESPECIFICA",
        GENERO: generoVector2 ?? it.genero,
        MUNDO: it.mundo,
        LINEA: it.linea,
        EQUIVALENCIA: "",
        MARCA: it.marca.trim(),
        AGRUPACION_MARCA: "",
        TALLAS: "",
        UNIDADES: String(it.unidades),
        COSTO_UNITARIO: String(it.costo_fob),
        MONEDA: MONEDA_COTV,
        LLEGADA: LLEGADA_INICIAL_COTV,
        ENTREGAS: "",
        RECIBIDAS: "",
        DESTINO: "",
        ALCANCE: "",
        NOTA: nota,
        VIAJE: it.codigo_viaje,
        EMBARQUE: "",
        PAQUETE: "",
        OC: "",
        DIA_REGISTRO: dias[i],
        ITEM_COTV: it.item_id,
      });
    });

    resumen.push({
      proveedor: primero.proveedor,
      viaje: primero.codigo_viaje,
      referencia,
      lineas: g.length,
      fecha_compra: fechaCompra,
      primer_dia_registro: dias.reduce((m, d) => (d < m ? d : m), dias[0]),
      ultimo_dia_registro: ultimoDia,
      varios_dias: new Set(dias).size > 1,
    });
  }

  return {
    filas,
    grupos: resumen,
    avisos,
    hojas: {
      COMPRAS: [[...COLUMNAS_PLANILLA_C2], ...filas.map((f) => COLUMNAS_PLANILLA_C2.map((c) => f[c]))],
      GRUPOS: hojaGrupos(resumen),
      LEEME: hojaLeeme(),
    },
  };
}

// ─── Hojas GRUPOS y LEEME ───

export const ENCABEZADOS_GRUPOS = ["PROVEEDOR", "VIAJE", "REFERENCIA", "LINEAS", "FECHA_COMPRA", "PRIMER_DIA_REGISTRO", "ULTIMO_DIA_REGISTRO", "VARIOS_DIAS"] as const;
export const MARCA_VARIOS_DIAS = "varios días";

/** Hoja `GRUPOS`: cada grupo con su primer y último día de registro y la marca «varios días» (candidatos a partir). */
export function hojaGrupos(grupos: readonly GrupoPlanillaC2[]): Hoja {
  return [
    [...ENCABEZADOS_GRUPOS],
    ...grupos.map((g) => [g.proveedor, g.viaje, g.referencia, g.lineas, g.fecha_compra, g.primer_dia_registro, g.ultimo_dia_registro, g.varios_dias ? MARCA_VARIOS_DIAS : ""]),
  ];
}

/** Hoja `LEEME`: qué es cada columna informativa y cómo partir un grupo con dos OC. */
export function hojaLeeme(): Hoja {
  return [
    ["QUÉ ES ESTA PLANILLA"],
    ["Cada fila es un ítem registrado en COTV. Cada REFERENCIA distinta será UNA compra (una orden de compra) al importarla: una por proveedor y viaje."],
    ["FECHA_COMPRA es la misma en todas las filas de una compra: el día (en hora de Lima) en que se registró el ítem más antiguo. Es una fecha de registro, no la de la orden real: corrígela si conoces la real."],
    ["DIA_REGISTRO e ITEM_COTV son informativas: el importador las ignora. DIA_REGISTRO sirve para decidir dónde partir un grupo; ITEM_COTV enlaza la descripción, el modelo y las fotos con su línea."],
    ["LLEGADA es 2026-12 en todas las filas (un mes, no un día): las compras entran en diciembre sin embarque; después se reparten entre los embarques reales."],
    ["COMO PARTIR UNA COMPRA"],
    ["Si este proveedor tuvo dos órdenes de compra en el viaje, cambia la REFERENCIA de las filas de la segunda (por ejemplo, agrega -2 al final) y pon en esas filas una sola FECHA_COMPRA (la de su DIA_REGISTRO más antiguo). Cada referencia distinta será una compra."],
    ["No hace falta renumerar LINEA_ORDINAL: es único dentro del grupo y sigue único en cada parte."],
    ["Mira la hoja GRUPOS: los grupos marcados «varios días» son los candidatos a partir."],
    ["Después de importar, corregir una agrupación mal hecha es cancelar la compra y reimportar esas filas con otra REFERENCIA."],
  ];
}
