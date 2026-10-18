import type { Hoja } from "@/lib/proyeccion/excel";
import { IMI_MAX_DEFECTO, IMI_MIN_DEFECTO, type ReglaIntercompanyApi } from "@/lib/intercompany/tipos-api";
import { ambitoSugerido, esDeEquivalencia, ETIQUETA_SOLO, filtrosEfectivos, periodoCorto, type NodoIntercompany, type ParametrosVista, type SoloReglas } from "./vista";

/**
 * Excel de la lista de reglas (ficha 13, sección 4): las mismas columnas y filas que la tabla con el filtro aplicado (regla 10).
 * Puras: solo arman filas; SheetJS se carga bajo demanda en el navegador (`descargarLibro` de M7) y nunca llama a una ruta nueva.
 * Los porcentajes van en 0–100 y el rango en meses con un decimal.
 */

export const NOMBRE_ARCHIVO_REGLAS = "intercompany-reglas.xlsx";

/** Las columnas de la tabla (sin Acciones), en orden. La tabla y el Excel parten de esta misma lista. */
export const COLUMNAS_REGLAS = [
  { clave: "marca", titulo: "Marca" },
  { clave: "ruta", titulo: "GML / unidad" },
  { clave: "desde", titulo: "Vigente desde" },
  { clave: "min", titulo: "IMI mín" },
  { clave: "max", titulo: "IMI máx" },
  { clave: "directo", titulo: "% directo" },
  { clave: "del_cd", titulo: "% del CD" },
  { clave: "observado", titulo: "% observado (M8)" },
  { clave: "aplicable", titulo: "Aplicable" },
  { clave: "nota", titulo: "Nota" },
] as const;

export type ClaveColumnaRegla = (typeof COLUMNAS_REGLAS)[number]["clave"];

const dec = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

function textoAplicableExcel(r: ReglaIntercompanyApi): string {
  if (r.aplicable === true) return "Sí";
  if (r.aplicable === false) return "No: sin clave";
  return "Sin evaluar";
}

/** El valor de cada celda de una regla; la tabla pinta lo mismo con más formato. */
export function celdasRegla(r: ReglaIntercompanyApi): Record<ClaveColumnaRegla, string | number | null> {
  return {
    marca: r.marca,
    ruta: esDeEquivalencia(r) ? `${r.ruta} (equivalencia: manda sobre el GML)` : r.ruta,
    desde: periodoCorto(r.vigente_desde),
    min: dec(r.imi_min, 1),
    max: dec(r.imi_max, 1),
    directo: dec(r.pct_directo, 2),
    del_cd: dec(r.pct_cd, 2),
    observado: r.pct_directo_observado ? dec(r.pct_directo_observado.valor, 1) : null,
    aplicable: textoAplicableExcel(r),
    nota: r.nota,
  };
}

export type FiltrosTexto = { mes: string; marca: string; genero: string; mundos: string; linea: string; solo: readonly SoloReglas[] };

export function hojasReglas(filas: readonly ReglaIntercompanyApi[], filtros: FiltrosTexto): Record<string, Hoja> {
  const reglas: Hoja = [COLUMNAS_REGLAS.map((c) => c.titulo.toUpperCase())];
  for (const r of filas) {
    const c = celdasRegla(r);
    reglas.push(COLUMNAS_REGLAS.map((col) => c[col.clave]));
  }
  const solo = filtros.solo.map((s) => ETIQUETA_SOLO[s]).join(", ");
  const filtrosHoja: Hoja = [
    ["FILTRO", "VALOR"],
    ["Reglas vigentes en", periodoCorto(filtros.mes)],
    ["Marca", filtros.marca],
    ["Género", filtros.genero],
    ["Mundo", filtros.mundos],
    ["Línea", filtros.linea],
    ["Solo", solo === "" ? "—" : solo],
    ["Rango por defecto (meses)", `${IMI_MIN_DEFECTO}–${IMI_MAX_DEFECTO}`],
    ["Reglas en la hoja", filas.length],
  ];
  return { REGLAS: reglas, FILTROS: filtrosHoja };
}

/** Los filtros vigentes escritos con nombres (hoja FILTROS): lo que el planner ve en la barra, no los ids de la URL. */
export function filtrosTexto(parametros: ParametrosVista, mes: string, nodos: readonly NodoIntercompany[], marcas: readonly { id: string; nombre: string }[]): FiltrosTexto {
  const f = filtrosEfectivos(parametros, nodos);
  const nombresMundo = f.mundoIds ? [...new Set(nodos.filter((n) => f.mundoIds?.includes(n.mundoId)).map((n) => n.mundo))] : [];
  const sugerido = ambitoSugerido(nodos);
  const esAmbito = parametros.genero.tipo === "defecto" && parametros.mundo.tipo === "defecto" && sugerido.generoId !== null;
  return {
    mes,
    marca: parametros.marca ? (marcas.find((m) => m.id === parametros.marca)?.nombre ?? parametros.marca) : "Todas",
    genero: f.generoId ? (nodos.find((n) => n.generoId === f.generoId)?.genero ?? f.generoId) + (esAmbito ? " (ámbito sugerido)" : "") : "Todos",
    mundos: nombresMundo.length > 0 ? nombresMundo.join(", ") + (esAmbito ? " (ámbito sugerido)" : "") : "Todos",
    linea: parametros.linea ? (nodos.find((n) => n.lineaId === parametros.linea)?.linea ?? parametros.linea) : "Todas",
    solo: parametros.solo,
  };
}
