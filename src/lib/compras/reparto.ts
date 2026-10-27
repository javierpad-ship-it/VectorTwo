import { repartirEntero } from "@/lib/proyeccion/reparto";
import { temporadaDe } from "@/lib/marcas-barrer/temporadas";
import type { RepartoVigenteApi, Temporada } from "@/lib/marcas-barrer/tipos-api";
import { mesDe } from "./reglas";
import type { Mes } from "./tipos";

/**
 * Reparto de un lote de una marca al barrer (ficha 08, §5.7, reglas 11 y 11b y §0.2 #8). Puro.
 *
 * El lote no lleva GML: se reparte con el reparto VIGENTE de M12, entrega a entrega, porque la temporada de cada entrega decide el
 * vector. La temporada se obtiene con `temporadaDe(mes de la entrega, reparto.temporadas_usadas)`: las fechas con que se calculó ESE
 * vector, no las de Parámetros (cambiar las fechas no mueve ningún lote hasta que se apruebe y aplique una versión nueva). Con
 * `modo = "anual"` hay un solo vector para todas las entregas. El alcance de la línea (géneros, mundos, líneas) filtra los GML y
 * renormaliza lo que queda; si no queda ninguno, `alcance_vacio`. El entero sale de `repartirEntero` de M7 (mayor resto): la suma de
 * cada entrega es exactamente sus unidades.
 */

/** Lo que `repartirLinea` necesita de un reparto vigente (`RepartoVigenteApi` de M12 lo cumple). */
export type RepartoParaLinea = Pick<RepartoVigenteApi, "reparto_id" | "version" | "modo" | "error_reparto_pp" | "temporadas_usadas" | "filas">;

/** Género, mundo y línea de un nodo: sirve para aplicar el alcance (`gml_id` → nodo). */
export type NodoAlcance = { genero_id: string; mundo_id: string; linea_id: string };

/** Alcance de la línea: ids de género, mundo y línea; una lista vacía o ausente significa «todo». */
export type AlcanceLinea = { generos?: readonly string[]; mundos?: readonly string[]; lineas?: readonly string[] } | null | undefined;

/** Fila de `compra_linea_repartos` (por entrega) con el mes de la entrega para enlazarla (`importar_compra` la lee por `entrega_periodo`). */
export type FilaRepartoGuardar = {
  entrega_periodo: Mes;
  marca_id: string;
  genero_mundo_linea_id: string;
  equivalencia_id: string | null;
  unidades: number;
  reparto_id: string | null;
  reparto_version: number | null;
  temporada: Temporada | null;
  error_reparto_pp: number | null;
};

export type RepartoDeEntrega = { periodo: Mes; unidades: number; temporada: Temporada | null; filas: FilaRepartoGuardar[] };

export type FilaRepartoSuma = { marca_id: string; genero_mundo_linea_id: string; equivalencia_id: string | null; unidades: number };

export type ResultadoRepartoLinea =
  | {
      ok: true;
      reparto_id: string;
      version: number;
      modo: RepartoVigenteApi["modo"];
      error_reparto_pp: number | null;
      por_entrega: RepartoDeEntrega[];
      /** La suma de las entregas por `(marca, GML, equivalencia)`. */
      filas: FilaRepartoSuma[];
    }
  | { ok: false; motivo: "sin_reparto" | "alcance_vacio"; detalle?: string };

const lista = (v: readonly string[] | undefined): Set<string> | null => (v && v.length > 0 ? new Set(v) : null);

/** `true` si el GML cae dentro del alcance (todas las listas no vacías deben contenerlo). */
export function dentroDelAlcance(gmlId: string, alcance: AlcanceLinea, nodos: ReadonlyMap<string, NodoAlcance>): boolean {
  const generos = lista(alcance?.generos);
  const mundos = lista(alcance?.mundos);
  const lineas = lista(alcance?.lineas);
  if (!generos && !mundos && !lineas) return true;
  const n = nodos.get(gmlId);
  if (!n) return false;
  return (!generos || generos.has(n.genero_id)) && (!mundos || mundos.has(n.mundo_id)) && (!lineas || lineas.has(n.linea_id));
}

/** Temporada del vector de una entrega: `null` en un reparto anual; si no, la del mes según las fechas con que se calculó el reparto. */
export function temporadaDeEntrega(periodo: Mes, reparto: Pick<RepartoParaLinea, "modo" | "temporadas_usadas">): Temporada | null {
  if (reparto.modo === "anual") return null;
  return temporadaDe(Number(mesDe(periodo).slice(5, 7)), reparto.temporadas_usadas);
}

/**
 * `repartirLinea(linea, entregas, repartoVigente, nodos)`. `entregas` son las del cronograma de la línea (en `0.13.0`, las del
 * archivo); `reparto = null` (la marca no tiene reparto vigente) → `sin_reparto`. Una entrega con 0 unidades no lleva filas; las
 * filas con 0 unidades tras el redondeo se descartan (la suma no cambia).
 */
export function repartirLinea(
  linea: { marca_id: string; alcance?: AlcanceLinea },
  entregas: readonly { periodo: Mes; unidades: number }[],
  reparto: RepartoParaLinea | null,
  nodos: ReadonlyMap<string, NodoAlcance>,
): ResultadoRepartoLinea {
  if (reparto === null) return { ok: false, motivo: "sin_reparto", detalle: "La marca no tiene un reparto vigente: apruébalo en el análisis de marcas al barrer." };

  const filasDelAlcance = reparto.filas.filter((f) => dentroDelAlcance(f.gml_id, linea.alcance, nodos));
  if (filasDelAlcance.length === 0) {
    return { ok: false, motivo: "alcance_vacio", detalle: "El alcance elegido deja sin ningún GML al reparto de la marca." };
  }

  const ordenadas = [...entregas].sort((a, b) => (mesDe(a.periodo) < mesDe(b.periodo) ? -1 : mesDe(a.periodo) > mesDe(b.periodo) ? 1 : 0));
  const por_entrega: RepartoDeEntrega[] = [];
  for (const e of ordenadas) {
    const periodo = mesDe(e.periodo);
    const temporada = temporadaDeEntrega(periodo, reparto);
    const vector = filasDelAlcance.filter((f) => f.temporada === temporada);
    if (vector.length === 0) {
      return {
        ok: false,
        motivo: temporada === null ? "sin_reparto" : "alcance_vacio",
        detalle:
          temporada === null
            ? "El reparto vigente no trae un vector anual."
            : `El reparto v${reparto.version} no trae vector de ${temporada} para ese alcance (entrega de ${periodo}).`,
      };
    }
    const pesos = vector.map((f) => f.participacion);
    const unidades = repartirEntero(e.unidades, pesos) ?? vector.map(() => 0);
    const filas: FilaRepartoGuardar[] = [];
    vector.forEach((f, i) => {
      if (unidades[i] <= 0) return;
      filas.push({
        entrega_periodo: periodo,
        marca_id: linea.marca_id,
        genero_mundo_linea_id: f.gml_id,
        equivalencia_id: f.equivalencia_id,
        unidades: unidades[i],
        reparto_id: reparto.reparto_id,
        reparto_version: reparto.version,
        temporada,
        error_reparto_pp: reparto.error_reparto_pp,
      });
    });
    por_entrega.push({ periodo, unidades: e.unidades, temporada, filas });
  }

  return {
    ok: true,
    reparto_id: reparto.reparto_id,
    version: reparto.version,
    modo: reparto.modo,
    error_reparto_pp: reparto.error_reparto_pp,
    por_entrega,
    filas: sumarRepartos(por_entrega.flatMap((p) => p.filas)),
  };
}

/** Suma las filas de todas las entregas por `(marca, GML, equivalencia)`, en el orden de primera aparición. */
export function sumarRepartos(filas: readonly Pick<FilaRepartoGuardar, "marca_id" | "genero_mundo_linea_id" | "equivalencia_id" | "unidades">[]): FilaRepartoSuma[] {
  const por = new Map<string, FilaRepartoSuma>();
  for (const f of filas) {
    const k = `${f.marca_id}|${f.genero_mundo_linea_id}|${f.equivalencia_id ?? ""}`;
    const previa = por.get(k);
    if (previa) previa.unidades += f.unidades;
    else por.set(k, { marca_id: f.marca_id, genero_mundo_linea_id: f.genero_mundo_linea_id, equivalencia_id: f.equivalencia_id, unidades: f.unidades });
  }
  return [...por.values()];
}

/**
 * `reparto_cambio`: algún reparto guardado de la línea es de una versión distinta de la vigente de su marca (M12 aprobó otra
 * versión después). `vigenteId = null` (la marca ya no tiene reparto vigente) también cuenta como cambio si la línea guardó uno.
 * Los guardados sin `reparto_id` (lote de varias marcas) nunca activan el aviso.
 */
export function hayRepartoCambio(guardados: readonly { reparto_id: string | null }[], vigenteId: string | null): boolean {
  return guardados.some((g) => g.reparto_id !== null && g.reparto_id !== vigenteId);
}
