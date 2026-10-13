import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { MUESTRA_MAX } from "@/lib/arbol/importar";
import { resolverGml, type EstadoResolverGml } from "@/lib/arbol/nivel/resolver";
import { MAX_NOTA } from "../esquemas";
import { marcasPorId, unidadDeMarca } from "../conjuntos/reglas";
import { cambioMarca, type AsignacionGmlEntrada, type MarcaGml } from "./reglas";
import type {
  CambioMarcaBloque,
  DiferenciaImportacionGml,
  FilaImportacionGml,
  FilaOmitidaGml,
  MotivoOmisionGml,
  ReporteGmlBase,
} from "../tipos-api";

/**
 * Importador de marcas relevantes por GML, la hoja `MARCA, GENERO, MUNDO,
 * LINEA, NOTA` (02b, reglas 14 a 16). Dos funciones puras:
 *
 *   planificarImportacionGml(filas, estado) → plan + reporte, sin tocar nada.
 *   aplicarPlanGml(estado, plan)            → nuevo estado en memoria, para
 *                                              probar idempotencia sin base.
 *
 * NUNCA crea árbol ni marcas. Es una carga, no una sincronización: no quita
 * asignaciones que el archivo no traiga y un par existente con otra nota no se
 * modifica (va a `diferencias`). Una marca sin casilla, al barrer o sin
 * modalidad NO se omite: se marcará `por_gml` y se lista en `cambios_marca`
 * antes de aplicar. La resolución de género, mundo, línea y nodo es
 * `resolverGml`, la misma del importador de niveles.
 */

export { MUESTRA_MAX };

export type EstadoImportacionGml = EstadoResolverGml & {
  marcas: readonly MarcaGml[];
  asignaciones: readonly Pick<AsignacionGmlEntrada, "id" | "marca_id" | "genero_mundo_linea_id" | "nota" | "activo">[];
};

export type AsignacionNueva = { marca_id: string; genero_mundo_linea_id: string; nota: string | null };

export type PlanImportacionGml = {
  reporte: ReporteGmlBase;
  asignaciones: AsignacionNueva[];
  /** Marcas que pasan a marcadas `por_gml` (las de `cambios_marca`). */
  marcar_ids: string[];
};

const clave = (marcaId: string, nodoId: string) => `${marcaId}|${nodoId}`;

export function planificarImportacionGml(filas: FilaImportacionGml[], estado: EstadoImportacionGml): PlanImportacionGml {
  const omitidas: FilaOmitidaGml[] = [];
  const diferencias: DiferenciaImportacionGml[] = [];
  const nuevas: AsignacionNueva[] = [];
  const muestra: string[] = [];
  const porMarca = new Map<string, { marca_id: string; marca: string; asignaciones: number }>();
  const marcasNuevas = new Map<string, MarcaGml>();
  let existentes = 0;
  let procesadas = 0;

  const marcaPorNombre = new Map(estado.marcas.map((m) => [normalizarNombre(m.nombre), m]));
  const marcaPorCodigo = new Map(estado.marcas.filter((m) => m.codigo).map((m) => [(m.codigo as string).toUpperCase(), m]));
  const porId = marcasPorId(estado.marcas);
  const baseAsignaciones = new Map<string, { nota: string | null }>();
  for (const a of estado.asignaciones) {
    if (a.activo) baseAsignaciones.set(clave(a.marca_id, a.genero_mundo_linea_id), { nota: a.nota });
  }
  const vistos = new Map<string, { fila: number; nota: string }>();

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const marcaTxt = normalizarNombre(cruda.marca);
    const notaTxt = typeof cruda.nota === "string" ? cruda.nota.trim() : "";
    const omitir = (
      motivo: MotivoOmisionGml,
      textos: { generoTxt: string; mundoTxt: string; lineaTxt: string },
      extra: Pick<FilaOmitidaGml, "detalle" | "fila_original"> = {}
    ) => {
      omitidas.push({
        fila,
        motivo,
        ...extra,
        marca: marcaTxt,
        genero: textos.generoTxt,
        mundo: textos.mundoTxt,
        linea: textos.lineaTxt,
        nota: notaTxt,
      });
    };
    const textosSolos = {
      generoTxt: normalizarNombre(cruda.genero),
      mundoTxt: normalizarNombre(cruda.mundo),
      lineaTxt: normalizarNombre(cruda.linea),
    };

    // (1) Marca vacía y fila de totales.
    if (!marcaTxt) return omitir("marca_vacia", textosSolos);
    if (marcaTxt === "TOTAL") return omitir("fila_total", textosSolos);

    // (2) La marca: por nombre normalizado o por código. Sin casilla NO se omite: se marcará.
    const codigo = aCodigo(cruda.marca);
    const marca = marcaPorNombre.get(marcaTxt) ?? (codigo ? marcaPorCodigo.get(codigo) : undefined);
    if (!marca) return omitir("marca_desconocida", textosSolos, { detalle: marcaTxt });
    if (!marca.activo) return omitir("marca_inactiva", textosSolos, { detalle: marca.nombre });
    const unidad = unidadDeMarca(marca, estado.marcas);
    if (unidad.en_conjunto) {
      const cabeza = porId.get(unidad.unidad_marca_id);
      return omitir("marca_en_conjunto", textosSolos, { detalle: `${marca.nombre} cuenta como ${cabeza?.nombre ?? "su cabeza"}` });
    }

    // (3) El nodo, con la misma función que el importador de niveles. Nunca crea árbol.
    const resuelto = resolverGml(cruda, estado);
    if (!resuelto.ok) {
      return omitir(resuelto.motivo, resuelto, resuelto.detalle === undefined ? {} : { detalle: resuelto.detalle });
    }

    // (4) Nota.
    if (notaTxt.length > MAX_NOTA) return omitir("nota_larga", resuelto, { detalle: `${notaTxt.length} caracteres` });

    // (5) Duplicados por par marca × nodo: manda la primera aparición.
    const k = clave(marca.id, resuelto.nodo.id);
    const previo = vistos.get(k);
    if (previo) {
      return omitir("duplicada_en_archivo", resuelto, {
        fila_original: previo.fila,
        ...(previo.nota !== notaTxt && notaTxt ? { detalle: `nota distinta: ${notaTxt}` } : {}),
      });
    }
    vistos.set(k, { fila, nota: notaTxt });
    procesadas += 1;

    const ruta = `${resuelto.genero.nombre} · ${resuelto.mundo.nombre} · ${resuelto.linea.nombre}`;

    // (6) Par existente: se cuenta y, si la nota difiere, se informa; nunca se modifica.
    const base = baseAsignaciones.get(k);
    if (base) {
      existentes += 1;
      if (notaTxt && notaTxt !== (base.nota ?? "")) {
        diferencias.push({ fila, marca: marca.nombre, ruta, campo: "nota", en_base: base.nota, en_archivo: notaTxt });
      }
      return;
    }

    nuevas.push({ marca_id: marca.id, genero_mundo_linea_id: resuelto.nodo.id, nota: notaTxt || null });
    const acumulado = porMarca.get(marca.id) ?? { marca_id: marca.id, marca: marca.nombre, asignaciones: 0 };
    acumulado.asignaciones += 1;
    porMarca.set(marca.id, acumulado);
    marcasNuevas.set(marca.id, marca);
    if (muestra.length < MUESTRA_MAX) muestra.push(`${marca.nombre} → ${ruta}`);
  });

  const cambios_marca: CambioMarcaBloque[] = [];
  for (const marca of marcasNuevas.values()) {
    const cambio = cambioMarca(marca);
    if (cambio) cambios_marca.push({ marca_id: marca.id, marca: marca.nombre, de: cambio.de, a: cambio.a });
  }

  return {
    reporte: {
      totales: { recibidas: filas.length, procesadas, omitidas: omitidas.length },
      crear: { asignaciones: nuevas.length, por_marca: [...porMarca.values()] },
      existentes: { asignaciones: existentes },
      cambios_marca,
      diferencias,
      omitidas,
      muestra: { asignaciones: muestra },
    },
    asignaciones: nuevas,
    marcar_ids: cambios_marca.map((c) => c.marca_id),
  };
}

/** Aplica el plan en memoria con la semántica de `on conflict do nothing`. No muta el estado recibido. */
export function aplicarPlanGml(estado: EstadoImportacionGml, plan: PlanImportacionGml): EstadoImportacionGml {
  const existentes = new Set(estado.asignaciones.filter((a) => a.activo).map((a) => clave(a.marca_id, a.genero_mundo_linea_id)));
  const asignaciones = [...estado.asignaciones];
  for (const a of plan.asignaciones) {
    const k = clave(a.marca_id, a.genero_mundo_linea_id);
    if (existentes.has(k)) continue;
    existentes.add(k);
    asignaciones.push({
      id: `plan-gml-${asignaciones.length + 1}`,
      marca_id: a.marca_id,
      genero_mundo_linea_id: a.genero_mundo_linea_id,
      nota: a.nota,
      activo: true,
    });
  }
  const marcar = new Set(plan.marcar_ids);
  const marcas = estado.marcas.map((m) =>
    marcar.has(m.id) ? { ...m, tratamiento_especial: true, modalidad_tratamiento: "por_gml" } : m
  );
  return { ...estado, marcas, asignaciones };
}
