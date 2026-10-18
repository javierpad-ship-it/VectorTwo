import type { Tables } from "@/lib/supabase/database.types";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { MUESTRA_MAX, buscarEnCatalogo, codigoUnico, resolverCatalogo } from "@/lib/arbol/importar";
import {
  planificarConjuntos,
  type AsignacionConjunto,
  type CabezaNueva,
} from "./conjuntos/importar";
import type {
  ConjuntoOmitidoMarca,
  ConteosCrearMarcas,
  ConteosExistentesMarcas,
  DiferenciaImportacionMarca,
  FilaImportacionMarca,
  FilaOmitidaMarca,
  ReporteImportacionMarcasBase,
} from "./tipos";

/**
 * Importador de marcas (docs/modulos/02-marcas.md, "Importador de marcas" y
 * reglas 7–15). Dos funciones puras:
 *
 *   planificarImportacionMarcas(filas, estado) → plan + reporte, sin tocar nada.
 *   aplicarPlanMarcas(estado, plan)            → nuevo estado en memoria, para
 *                                                 probar idempotencia sin base.
 *
 * Nunca crea agrupaciones (son raíz y de admin) ni modifica, reactiva o
 * desactiva marcas existentes: solo las reporta en `diferencias`.
 *
 * Columna opcional `CONJUNTO` (02b, pregunta 20): las marcas NUEVAS entran con
 * su conjunto (la cabeza se crea con la agrupación de la fila si no existe) y las
 * existentes con otro conjunto van a `diferencias` (campo `conjunto`). Usa el
 * mismo núcleo que el importador de conjuntos (`planificarConjuntos`); un
 * conjunto que no se puede aplicar no omite la fila: la marca se crea sin
 * conjunto y el motivo se lista en `conjuntos.omitidos`. El handler
 * ejecuta el plan con `upsert … onConflict: "nombre", ignoreDuplicates` en
 * tandas de 500 (`enTandas` de M1); si falla a mitad, reimportar completa el
 * resto sin duplicar.
 */

export { enTandas, TANDA } from "@/lib/arbol/importar";

export type AgrupacionMarcaEstado = Pick<Tables<"agrupaciones_marca">, "id" | "codigo" | "nombre" | "activo">;
export type MarcaEstado = Pick<
  Tables<"marcas">,
  "id" | "codigo" | "nombre" | "agrupacion_marca_id" | "tratamiento_especial" | "activo"
> &
  Partial<Pick<Tables<"marcas">, "conjunto_marca_id" | "modalidad_tratamiento" | "resto_al_barrer">>;

/** Ambas tablas completas (activas e inactivas), leídas planas de la base o fabricadas en los tests. */
export type EstadoImportacionMarcas = {
  agrupaciones: AgrupacionMarcaEstado[];
  marcas: MarcaEstado[];
};

export type MarcaNueva = {
  nombre: string;
  codigo: string;
  agrupacion_marca_id: string;
  tratamiento_especial: boolean;
  /** Regla 2 de 02b: con casilla se escribe `barrido` (como `POST /api/marcas`); sin casilla, `null`. M12: `MIXTA` escribe `por_gml` + `resto_al_barrer`. */
  modalidad_tratamiento?: "barrido" | "por_gml" | null;
  /** M12: solo presente (y `true`) en una marca nueva `MIXTA`. */
  resto_al_barrer?: boolean;
};

export type PlanImportacionMarcas = {
  reporte: ReporteImportacionMarcasBase;
  marcas: MarcaNueva[];
  /** 02b: cabezas que se crearán y marcas nuevas que entran a un conjunto (se resuelven por nombre al escribir). */
  conjuntos: { cabezas_nuevas: CabezaNueva[]; asignaciones: AsignacionConjunto[] };
};

const SI = new Set(["SI", "S", "X", "1", "TRUE", "VERDADERO", "YES", "Y"]);
const NO = new Set(["", "NO", "N", "0", "FALSE", "FALSO"]);

/**
 * Regla 7. `""`, `NO`, `N`, `0`, `FALSE`, `FALSO` → `false`; `SI`, `SÍ`, `S`,
 * `X`, `1`, `TRUE`, `VERDADERO`, `YES`, `Y` → `true` (sin distinguir caja ni
 * acentos); cualquier otra cosa → `null` (valor no reconocido).
 */
export function leerSiNo(valor: unknown): boolean | null {
  // Sin `aCodigo` a propósito: reduciría "-" o "?" a "" y pasarían por "no".
  const v = normalizarNombre(valor)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (SI.has(v)) return true;
  if (NO.has(v)) return false;
  return null;
}

/**
 * Regla 8. Quita el número con que Javier prefija las agrupaciones
 * (`1 ULTRA LOW`, `3 - VALOR`, `5.PREMIUM` → nombre). Un número solo no es un
 * nombre (`"1"` → `""`), y un nombre que empieza por dígitos pegados a letras
 * (`7UP`) no se toca.
 */
export function sinPrefijoNumerico(valor: string): string {
  const texto = normalizarNombre(valor);
  const m = /^\d+(?:\s*[-.:)·_]+\s*|\s+|$)/.exec(texto);
  if (!m) return texto;
  return normalizarNombre(texto.slice(m[0].length));
}

const siNo = (v: boolean) => (v ? "SI" : "NO");

/**
 * M12: la columna `TRATAMIENTO_ESPECIAL` admite además `MIXTA` (marca con tratamiento especial que será `mixta`: `por_gml` +
 * `resto_al_barrer`; hasta que se le asignen GML queda pendiente `mixta_sin_gml`). Lo demás es `leerSiNo`.
 */
export function leerTratamientoMarca(valor: unknown): { marcada: boolean; mixta: boolean } | null {
  if (normalizarNombre(valor) === "MIXTA") return { marcada: true, mixta: true };
  const siNoLeido = leerSiNo(valor);
  return siNoLeido === null ? null : { marcada: siNoLeido, mixta: false };
}

export function planificarImportacionMarcas(
  filas: FilaImportacionMarca[],
  estado: EstadoImportacionMarcas
): PlanImportacionMarcas {
  const crear: ConteosCrearMarcas = { marcas: 0, con_tratamiento_especial: 0, con_conjunto: 0 };
  const existentes: ConteosExistentesMarcas = { marcas: 0 };
  const existentesInactivos: ConteosExistentesMarcas = { marcas: 0 };
  const diferencias: DiferenciaImportacionMarca[] = [];
  const omitidas: FilaOmitidaMarca[] = [];
  const muestra = { marcas: [] as string[] };
  const nuevas: MarcaNueva[] = [];
  /** Filas aceptadas con `CONJUNTO` de una marca nueva, a evaluar cuando ya se conocen todas las marcas nuevas del archivo. */
  const conjuntosPendientes: { fila: number; marca: string; conjunto: string; agrupacion: { id: string; nombre: string } }[] = [];

  // Índices del estado actual.
  const marcasPorNombre = new Map(estado.marcas.map((m) => [normalizarNombre(m.nombre), m]));
  const agrupacionPorId = new Map(estado.agrupaciones.map((a) => [a.id, a]));
  const codigosUsados = new Set(estado.marcas.map((m) => m.codigo.toUpperCase()));
  const marcaPorId = new Map(estado.marcas.map((m) => [m.id, m]));
  const marcaPorCodigo = new Map(estado.marcas.map((m) => [m.codigo.toUpperCase(), m]));

  // Lo visto dentro del archivo: nombre de marca → fila de su primera aparición y agrupación.
  const vistas = new Map<string, { fila: number; agrupacion: string }>();

  let procesadas = 0;

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const marcaTxt = normalizarNombre(cruda.marca);
    const agrupacionTxt = normalizarNombre(cruda.agrupacion);
    const tratamientoTxt = typeof cruda.tratamiento_especial === "string" ? cruda.tratamiento_especial : "";
    const conjuntoTxt = normalizarNombre(cruda.conjunto);

    /** Anota la omisión con la fila completa, para que se pueda corregir el archivo. */
    const omitir = (
      motivo: FilaOmitidaMarca["motivo"],
      extra: Pick<FilaOmitidaMarca, "detalle" | "fila_original"> = {}
    ) => {
      omitidas.push({
        fila,
        motivo,
        ...extra,
        marca: marcaTxt,
        agrupacion: agrupacionTxt,
        tratamiento_especial: tratamientoTxt,
        ...(conjuntoTxt ? { conjunto: conjuntoTxt } : {}),
      });
    };

    if (!marcaTxt) return omitir("marca_vacia");
    if (marcaTxt === "TOTAL") return omitir("fila_total");

    // Agrupación: solo entre las activas, por código o por nombre; si no
    // resuelve, se reintenta sin el prefijo numérico ("1 ULTRA LOW").
    if (!agrupacionTxt) return omitir("agrupacion_vacia");
    const sinPrefijo = sinPrefijoNumerico(agrupacionTxt);
    const agrupacion =
      resolverCatalogo(estado.agrupaciones, agrupacionTxt) ??
      (sinPrefijo ? resolverCatalogo(estado.agrupaciones, sinPrefijo) : undefined);
    if (!agrupacion) {
      const inactiva =
        buscarEnCatalogo(estado.agrupaciones, agrupacionTxt) ??
        (sinPrefijo ? buscarEnCatalogo(estado.agrupaciones, sinPrefijo) : undefined);
      return omitir(inactiva ? "agrupacion_inactiva" : "agrupacion_desconocida", { detalle: agrupacionTxt });
    }

    // Tratamiento especial: columna sin mapear ("") → false.
    const leido = leerTratamientoMarca(tratamientoTxt);
    if (leido === null) return omitir("tratamiento_invalido", { detalle: tratamientoTxt.trim() });
    const tratamiento = leido.marcada;

    // Duplicados por nombre de marca normalizado: manda la primera aparición.
    const vista = vistas.get(marcaTxt);
    if (vista) {
      const detalle = vista.agrupacion !== agrupacion.nombre ? `agrupación distinta: ${agrupacion.nombre}` : undefined;
      return omitir("duplicada_en_archivo", { fila_original: vista.fila, detalle });
    }
    vistas.set(marcaTxt, { fila, agrupacion: agrupacion.nombre });
    procesadas += 1;

    // Marca existente: se cuenta y, si difiere, se informa; nunca se modifica.
    const existente = marcasPorNombre.get(marcaTxt);
    if (existente) {
      if (existente.activo) existentes.marcas += 1;
      else existentesInactivos.marcas += 1;

      if (existente.agrupacion_marca_id !== agrupacion.id) {
        const enBase = agrupacionPorId.get(existente.agrupacion_marca_id);
        diferencias.push({
          fila,
          marca: marcaTxt,
          campo: "agrupacion",
          en_base: enBase?.nombre ?? existente.agrupacion_marca_id,
          en_archivo: agrupacion.nombre,
        });
      }
      if (existente.tratamiento_especial !== tratamiento) {
        diferencias.push({
          fila,
          marca: marcaTxt,
          campo: "tratamiento_especial",
          en_base: siNo(existente.tratamiento_especial),
          en_archivo: siNo(tratamiento),
        });
      }
      if (conjuntoTxt) {
        const nombreEnArchivo = conjuntoTxt;
        const enArchivo = marcasPorNombre.get(nombreEnArchivo) ?? marcaPorCodigo.get(aCodigo(conjuntoTxt));
        const mismo = enArchivo !== undefined && enArchivo.id === existente.conjunto_marca_id;
        if (!mismo) {
          const actual = existente.conjunto_marca_id ? marcaPorId.get(existente.conjunto_marca_id) : undefined;
          diferencias.push({
            fila,
            marca: marcaTxt,
            campo: "conjunto",
            en_base: actual?.nombre ?? "(ninguno)",
            en_archivo: nombreEnArchivo,
          });
        }
      }
      return;
    }

    // Marca nueva: código único sobre los de la base más los del archivo.
    const codigo = codigoUnico(aCodigo(marcaTxt), codigosUsados, "MARCA");
    codigosUsados.add(codigo);
    nuevas.push({
      nombre: marcaTxt,
      codigo,
      agrupacion_marca_id: agrupacion.id,
      tratamiento_especial: tratamiento,
      modalidad_tratamiento: tratamiento ? (leido.mixta ? "por_gml" : "barrido") : null,
      ...(leido.mixta ? { resto_al_barrer: true } : {}),
    });
    crear.marcas += 1;
    if (tratamiento) crear.con_tratamiento_especial += 1;
    if (muestra.marcas.length < MUESTRA_MAX) muestra.marcas.push(`${marcaTxt} → ${agrupacion.nombre}`);
    if (conjuntoTxt) {
      conjuntosPendientes.push({
        fila,
        marca: marcaTxt,
        conjunto: conjuntoTxt,
        agrupacion: { id: agrupacion.id, nombre: agrupacion.nombre },
      });
    }
  });

  // Columna CONJUNTO de las marcas nuevas (02b): se evalúa con todas las marcas nuevas del archivo ya conocidas.
  const conjuntosOmitidos: ConjuntoOmitidoMarca[] = [];
  const planificador = planificarConjuntos({
    agrupaciones: estado.agrupaciones,
    marcas: estado.marcas.map((m) => ({
      id: m.id,
      nombre: m.nombre,
      codigo: m.codigo,
      activo: m.activo,
      agrupacion_marca_id: m.agrupacion_marca_id,
      conjunto_marca_id: m.conjunto_marca_id ?? null,
    })),
  });
  for (const n of nuevas) {
    planificador.registrarMarcaNueva({
      id: null,
      nombre: n.nombre,
      agrupacion_marca_id: n.agrupacion_marca_id,
      activo: true,
      conjunto_marca_id: null,
    });
  }
  const asignacionesConjunto: AsignacionConjunto[] = [];
  for (const p of conjuntosPendientes) {
    const nueva = nuevas.find((n) => n.nombre === p.marca);
    if (!nueva) continue;
    const resultado = planificador.evaluar({
      marca: { id: null, nombre: p.marca, agrupacion_marca_id: nueva.agrupacion_marca_id, activo: true, conjunto_marca_id: null },
      conjunto: p.conjunto,
      agrupacion_cabeza: p.agrupacion,
    });
    if (resultado.tipo === "omitida") {
      conjuntosOmitidos.push({
        fila: p.fila,
        marca: p.marca,
        conjunto: p.conjunto,
        motivo: resultado.motivo,
        ...(resultado.detalle === undefined ? {} : { detalle: resultado.detalle }),
      });
    } else if (resultado.tipo === "asignar" || resultado.tipo === "cambio") {
      asignacionesConjunto.push(resultado.asignacion);
      crear.con_conjunto += 1;
    }
  }

  const reporte: ReporteImportacionMarcasBase = {
    totales: { recibidas: filas.length, procesadas, omitidas: omitidas.length },
    crear,
    existentes,
    existentes_inactivos: existentesInactivos,
    diferencias,
    omitidas,
    muestra,
    conjuntos: { a_crear: planificador.conjuntosACrear(), omitidos: conjuntosOmitidos },
  };
  return {
    reporte,
    marcas: nuevas,
    conjuntos: { cabezas_nuevas: planificador.cabezasNuevas(), asignaciones: asignacionesConjunto },
  };
}

/**
 * Aplica el plan en memoria con la misma semántica que `on conflict (nombre)
 * do nothing`: lo que ya exista no se vuelve a crear ni se modifica. Devuelve
 * un estado nuevo; no muta el recibido. Los ids generados son deterministas.
 */
export function aplicarPlanMarcas(estado: EstadoImportacionMarcas, plan: PlanImportacionMarcas): EstadoImportacionMarcas {
  const marcas: MarcaEstado[] = [...estado.marcas];
  const nombres = new Set(marcas.map((m) => normalizarNombre(m.nombre)));
  plan.marcas.forEach((m, i) => {
    if (nombres.has(m.nombre)) return;
    marcas.push({
      id: `plan-marca-${i + 1}`,
      nombre: m.nombre,
      codigo: m.codigo,
      agrupacion_marca_id: m.agrupacion_marca_id,
      tratamiento_especial: m.tratamiento_especial,
      modalidad_tratamiento: m.modalidad_tratamiento ?? null,
      ...(m.resto_al_barrer ? { resto_al_barrer: true } : {}),
      activo: true,
      conjunto_marca_id: null,
    });
    nombres.add(m.nombre);
  });
  // 02b: cabezas nuevas y marcas que entran a un conjunto (se resuelven por nombre, como al escribir).
  plan.conjuntos.cabezas_nuevas.forEach((c, i) => {
    if (nombres.has(c.nombre)) return;
    marcas.push({
      id: `plan-cabeza-${i + 1}`,
      nombre: c.nombre,
      codigo: c.codigo,
      agrupacion_marca_id: c.agrupacion_marca_id,
      tratamiento_especial: false,
      activo: true,
      conjunto_marca_id: null,
    });
    nombres.add(c.nombre);
  });
  const idPorNombre = new Map(marcas.map((m) => [normalizarNombre(m.nombre), m.id]));
  const conjuntoDe = new Map<string, string>();
  for (const a of plan.conjuntos.asignaciones) {
    const marcaId = a.marca_id ?? idPorNombre.get(normalizarNombre(a.marca_nombre));
    const cabezaId = a.cabeza_id ?? idPorNombre.get(normalizarNombre(a.cabeza_nombre));
    if (marcaId && cabezaId) conjuntoDe.set(marcaId, cabezaId);
  }
  return {
    agrupaciones: estado.agrupaciones,
    marcas: marcas.map((m) => (conjuntoDe.has(m.id) ? { ...m, conjunto_marca_id: conjuntoDe.get(m.id) ?? null } : m)),
  };
}
