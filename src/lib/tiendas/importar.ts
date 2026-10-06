import type { Tables } from "@/lib/supabase/database.types";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { MUESTRA_MAX } from "@/lib/arbol/importar";
import { estadoTienda } from "./estado";
import { FECHA_INVALIDA, MONTO_INVALIDO, fechaLegible, leerFecha, leerMonto, leerTipo, montoLegible, textoLegible } from "./fechas";
import type {
  CampoDiferenciaTienda,
  ConteosCrearTiendas,
  ConteosExistentesTiendas,
  DiferenciaImportacionTienda,
  FilaImportacionTienda,
  FilaOmitidaTienda,
  ReporteImportacionTiendasBase,
  TipoTienda,
} from "./tipos";

/**
 * Importador de tiendas (docs/modulos/04-tiendas.md, "Importador de tiendas"
 * y reglas 12–18). Dos funciones puras:
 *
 *   planificarImportacionTiendas(filas, estado, hoy) → plan + reporte, sin tocar nada.
 *   aplicarPlanTiendas(estado, plan)                 → nuevo estado en memoria, para
 *                                                      probar idempotencia sin base.
 *
 * Nunca modifica, reactiva ni desactiva tiendas existentes: solo las reporta
 * en `diferencias`. El handler inserta el plan con `insert` plano en tandas
 * de 500 (`enTandas` de M1): el plan ya excluyó los códigos existentes y el
 * único de código es sobre `upper(codigo)`, que PostgREST no admite en
 * `onConflict`.
 */

export { enTandas, TANDA } from "@/lib/arbol/importar";

export type TiendaEstado = Pick<
  Tables<"tiendas">,
  | "id"
  | "codigo"
  | "nombre"
  | "tipo"
  | "zona"
  | "razon_social"
  | "fecha_apertura"
  | "fecha_cierre"
  | "venta_esperada_promedio"
  | "activo"
>;

/** La tabla completa (activas e inactivas), leída plana de la base o fabricada en los tests. */
export type EstadoImportacionTiendas = { tiendas: TiendaEstado[] };

/** Fila nueva lista para `insert`; nunca lleva `activo` (regla 15). */
export type TiendaNueva = {
  codigo: string;
  nombre: string;
  tipo: TipoTienda;
  zona: string | null;
  razon_social: string | null;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  venta_esperada_promedio: number | null;
};

export type PlanImportacionTiendas = {
  reporte: ReporteImportacionTiendasBase;
  tiendas: TiendaNueva[];
};

const texto = (v: unknown) => (typeof v === "string" ? v : "");
const textoONulo = (v: unknown) => {
  const n = normalizarNombre(v);
  return n === "" ? null : n;
};

/** Campos comparables entre una fila interpretada del archivo y una tienda de la base, con su forma legible. */
const CAMPOS: ReadonlyArray<{
  campo: CampoDiferenciaTienda;
  valor: (t: TiendaNueva | TiendaEstado) => string | number | null;
  legible: (v: string | number | null) => string;
}> = [
  { campo: "nombre", valor: (t) => t.nombre, legible: (v) => textoLegible(v as string | null) },
  { campo: "tipo", valor: (t) => t.tipo, legible: (v) => textoLegible(v as string | null) },
  { campo: "zona", valor: (t) => t.zona, legible: (v) => textoLegible(v as string | null) },
  { campo: "razon_social", valor: (t) => t.razon_social, legible: (v) => textoLegible(v as string | null) },
  { campo: "fecha_apertura", valor: (t) => t.fecha_apertura, legible: (v) => fechaLegible(v as string | null) },
  { campo: "fecha_cierre", valor: (t) => t.fecha_cierre, legible: (v) => fechaLegible(v as string | null) },
  {
    campo: "venta_esperada_promedio",
    valor: (t) => (t.venta_esperada_promedio === null ? null : Number(t.venta_esperada_promedio)),
    legible: (v) => montoLegible(v as number | null),
  },
];

/** Etiqueta corta de un campo para el `detalle` de `duplicada_en_archivo`. */
const ETIQUETA_CAMPO: Record<CampoDiferenciaTienda, string> = {
  nombre: "nombre",
  tipo: "tipo",
  zona: "zona",
  razon_social: "razón social",
  fecha_apertura: "apertura",
  fecha_cierre: "cierre",
  venta_esperada_promedio: "venta esperada",
};

export function planificarImportacionTiendas(
  filas: FilaImportacionTienda[],
  estado: EstadoImportacionTiendas,
  hoy: string
): PlanImportacionTiendas {
  const crear: ConteosCrearTiendas = { tiendas: 0, centros_distribucion: 0, sin_fecha_apertura: 0 };
  const existentes: ConteosExistentesTiendas = { tiendas: 0 };
  const existentesInactivos: ConteosExistentesTiendas = { tiendas: 0 };
  const diferencias: DiferenciaImportacionTienda[] = [];
  const omitidas: FilaOmitidaTienda[] = [];
  const muestra = { tiendas: [] as string[] };
  const nuevas: TiendaNueva[] = [];

  // Índices del estado actual.
  const porCodigo = new Map(estado.tiendas.map((t) => [t.codigo.toUpperCase(), t]));
  const codigoPorNombre = new Map(estado.tiendas.map((t) => [normalizarNombre(t.nombre), t.codigo]));

  // Lo visto dentro del archivo: código → fila y valores de su primera aparición.
  const vistas = new Map<string, { fila: number; tienda: TiendaNueva }>();

  let procesadas = 0;

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const codigo = aCodigo(cruda.codigo);
    const nombre = normalizarNombre(cruda.nombre);
    const tipoTxt = texto(cruda.tipo);
    const zonaTxt = texto(cruda.zona);
    const razonTxt = texto(cruda.razon_social);
    const aperturaTxt = texto(cruda.fecha_apertura);
    const cierreTxt = texto(cruda.fecha_cierre);
    const ventaTxt = texto(cruda.venta_esperada);

    /** Anota la omisión con la fila completa: código y nombre normalizados, el resto tal como vino. */
    const omitir = (
      motivo: FilaOmitidaTienda["motivo"],
      extra: Pick<FilaOmitidaTienda, "detalle" | "fila_original"> = {}
    ) => {
      omitidas.push({
        fila,
        motivo,
        ...extra,
        codigo,
        nombre,
        tipo: tipoTxt,
        zona: zonaTxt,
        razon_social: razonTxt,
        fecha_apertura: aperturaTxt,
        fecha_cierre: cierreTxt,
        venta_esperada: ventaTxt,
      });
    };

    // Regla 12: lo vacío y los totales se van antes de cualquier otra comprobación.
    if (!codigo) {
      const original = texto(cruda.codigo).trim();
      return omitir("codigo_vacio", original ? { detalle: original } : {});
    }
    if (!nombre) return omitir("nombre_vacio");
    if (nombre === "TOTAL") return omitir("fila_total");

    // Regla 13: tipo → apertura → cierre → coherencia → venta.
    const tipo = leerTipo(tipoTxt);
    if (tipo === null) return omitir("tipo_invalido", { detalle: tipoTxt.trim() });

    const apertura = leerFecha(aperturaTxt);
    if (apertura === FECHA_INVALIDA) return omitir("fecha_apertura_invalida", { detalle: aperturaTxt.trim() });
    const cierre = leerFecha(cierreTxt);
    if (cierre === FECHA_INVALIDA) return omitir("fecha_cierre_invalida", { detalle: cierreTxt.trim() });
    if (cierre !== null && apertura === null) return omitir("cierre_sin_apertura", { detalle: cierreTxt.trim() });
    if (cierre !== null && apertura !== null && cierre < apertura) {
      return omitir("cierre_antes_de_apertura", {
        detalle: `apertura ${fechaLegible(apertura)}, cierre ${fechaLegible(cierre)}`,
      });
    }

    const venta = leerMonto(ventaTxt);
    if (venta === MONTO_INVALIDO) return omitir("venta_invalida", { detalle: ventaTxt.trim() });
    if (venta !== null && tipo === "Centro de Distribución") return omitir("venta_en_cd", { detalle: ventaTxt.trim() });

    const interpretada: TiendaNueva = {
      codigo,
      nombre,
      tipo,
      zona: textoONulo(zonaTxt),
      razon_social: textoONulo(razonTxt),
      fecha_apertura: apertura,
      fecha_cierre: cierre,
      venta_esperada_promedio: venta,
    };

    // Regla 14: duplicados por código dentro del archivo; manda la primera aparición.
    const vista = vistas.get(codigo);
    if (vista) {
      const distintos = CAMPOS.filter((c) => c.valor(vista.tienda) !== c.valor(interpretada)).map(
        (c) => `${ETIQUETA_CAMPO[c.campo]} distinto: ${c.legible(c.valor(interpretada))}`
      );
      return omitir("duplicada_en_archivo", {
        fila_original: vista.fila,
        ...(distintos.length ? { detalle: distintos.join("; ") } : {}),
      });
    }

    // Regla 15: tienda existente (por código) se cuenta y, si difiere, se informa; nunca se modifica.
    const existente = porCodigo.get(codigo);
    if (existente) {
      vistas.set(codigo, { fila, tienda: interpretada });
      procesadas += 1;
      if (existente.activo) existentes.tiendas += 1;
      else existentesInactivos.tiendas += 1;
      for (const c of CAMPOS) {
        const enBase = c.valor(existente);
        const enArchivo = c.valor(interpretada);
        if (enBase !== enArchivo) {
          diferencias.push({ fila, codigo, campo: c.campo, en_base: c.legible(enBase), en_archivo: c.legible(enArchivo) });
        }
      }
      return;
    }

    // Regla 14: el nombre ya lo usa otro código (en la base o antes en el archivo).
    const duenio = codigoPorNombre.get(nombre);
    if (duenio !== undefined && duenio.toUpperCase() !== codigo) {
      return omitir("nombre_repetido", { detalle: duenio });
    }

    // Tienda nueva.
    vistas.set(codigo, { fila, tienda: interpretada });
    codigoPorNombre.set(nombre, codigo);
    procesadas += 1;
    nuevas.push(interpretada);
    if (tipo === "Centro de Distribución") crear.centros_distribucion += 1;
    else {
      crear.tiendas += 1;
      if (apertura === null) crear.sin_fecha_apertura += 1;
    }
    if (muestra.tiendas.length < MUESTRA_MAX) {
      muestra.tiendas.push(`${codigo} · ${nombre} · ${estadoTienda(interpretada, hoy)}`);
    }
  });

  const reporte: ReporteImportacionTiendasBase = {
    totales: { recibidas: filas.length, procesadas, omitidas: omitidas.length },
    crear,
    existentes,
    existentes_inactivos: existentesInactivos,
    diferencias,
    omitidas,
    muestra,
  };
  return { reporte, tiendas: nuevas };
}

/**
 * Aplica el plan en memoria con la misma semántica que el `insert` del
 * handler sobre un estado donde esos códigos no existen: lo que ya exista
 * (por `upper(codigo)`) no se vuelve a crear ni se modifica. Devuelve un
 * estado nuevo; no muta el recibido. Los ids generados son deterministas.
 */
export function aplicarPlanTiendas(estado: EstadoImportacionTiendas, plan: PlanImportacionTiendas): EstadoImportacionTiendas {
  const tiendas = [...estado.tiendas];
  const codigos = new Set(tiendas.map((t) => t.codigo.toUpperCase()));
  plan.tiendas.forEach((t, i) => {
    if (codigos.has(t.codigo.toUpperCase())) return;
    tiendas.push({ id: `plan-tienda-${i + 1}`, ...t, activo: true });
    codigos.add(t.codigo.toUpperCase());
  });
  return { tiendas };
}
