import type { Tables } from "@/lib/supabase/database.types";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { MUESTRA_MAX, buscarEnCatalogo, codigoUnico, resolverCatalogo } from "@/lib/arbol/importar";
import type {
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
 * desactiva marcas existentes: solo las reporta en `diferencias`. El handler
 * ejecuta el plan con `upsert … onConflict: "nombre", ignoreDuplicates` en
 * tandas de 500 (`enTandas` de M1); si falla a mitad, reimportar completa el
 * resto sin duplicar.
 */

export { enTandas, TANDA } from "@/lib/arbol/importar";

export type AgrupacionMarcaEstado = Pick<Tables<"agrupaciones_marca">, "id" | "codigo" | "nombre" | "activo">;
export type MarcaEstado = Pick<
  Tables<"marcas">,
  "id" | "codigo" | "nombre" | "agrupacion_marca_id" | "tratamiento_especial" | "activo"
>;

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
};

export type PlanImportacionMarcas = {
  reporte: ReporteImportacionMarcasBase;
  marcas: MarcaNueva[];
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

export function planificarImportacionMarcas(
  filas: FilaImportacionMarca[],
  estado: EstadoImportacionMarcas
): PlanImportacionMarcas {
  const crear: ConteosCrearMarcas = { marcas: 0, con_tratamiento_especial: 0 };
  const existentes: ConteosExistentesMarcas = { marcas: 0 };
  const existentesInactivos: ConteosExistentesMarcas = { marcas: 0 };
  const diferencias: DiferenciaImportacionMarca[] = [];
  const omitidas: FilaOmitidaMarca[] = [];
  const muestra = { marcas: [] as string[] };
  const nuevas: MarcaNueva[] = [];

  // Índices del estado actual.
  const marcasPorNombre = new Map(estado.marcas.map((m) => [normalizarNombre(m.nombre), m]));
  const agrupacionPorId = new Map(estado.agrupaciones.map((a) => [a.id, a]));
  const codigosUsados = new Set(estado.marcas.map((m) => m.codigo.toUpperCase()));

  // Lo visto dentro del archivo: nombre de marca → fila de su primera aparición y agrupación.
  const vistas = new Map<string, { fila: number; agrupacion: string }>();

  let procesadas = 0;

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const marcaTxt = normalizarNombre(cruda.marca);
    const agrupacionTxt = normalizarNombre(cruda.agrupacion);
    const tratamientoTxt = typeof cruda.tratamiento_especial === "string" ? cruda.tratamiento_especial : "";

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
    const tratamiento = leerSiNo(tratamientoTxt);
    if (tratamiento === null) return omitir("tratamiento_invalido", { detalle: tratamientoTxt.trim() });

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
      return;
    }

    // Marca nueva: código único sobre los de la base más los del archivo.
    const codigo = codigoUnico(aCodigo(marcaTxt), codigosUsados, "MARCA");
    codigosUsados.add(codigo);
    nuevas.push({ nombre: marcaTxt, codigo, agrupacion_marca_id: agrupacion.id, tratamiento_especial: tratamiento });
    crear.marcas += 1;
    if (tratamiento) crear.con_tratamiento_especial += 1;
    if (muestra.marcas.length < MUESTRA_MAX) muestra.marcas.push(`${marcaTxt} → ${agrupacion.nombre}`);
  });

  const reporte: ReporteImportacionMarcasBase = {
    totales: { recibidas: filas.length, procesadas, omitidas: omitidas.length },
    crear,
    existentes,
    existentes_inactivos: existentesInactivos,
    diferencias,
    omitidas,
    muestra,
  };
  return { reporte, marcas: nuevas };
}

/**
 * Aplica el plan en memoria con la misma semántica que `on conflict (nombre)
 * do nothing`: lo que ya exista no se vuelve a crear ni se modifica. Devuelve
 * un estado nuevo; no muta el recibido. Los ids generados son deterministas.
 */
export function aplicarPlanMarcas(estado: EstadoImportacionMarcas, plan: PlanImportacionMarcas): EstadoImportacionMarcas {
  const marcas = [...estado.marcas];
  const nombres = new Set(marcas.map((m) => normalizarNombre(m.nombre)));
  plan.marcas.forEach((m, i) => {
    if (nombres.has(m.nombre)) return;
    marcas.push({
      id: `plan-marca-${i + 1}`,
      nombre: m.nombre,
      codigo: m.codigo,
      agrupacion_marca_id: m.agrupacion_marca_id,
      tratamiento_especial: m.tratamiento_especial,
      activo: true,
    });
    nombres.add(m.nombre);
  });
  return { agrupaciones: estado.agrupaciones, marcas };
}
