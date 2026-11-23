/**
 * Operaciones largas de los modales de Proyección (crear, copiar, guardar parámetros, cerrar, archivar). El servidor NO admite cancelarlas:
 * la petición sigue hasta terminar aunque se cierre la ventana. Por eso, mientras corre, el botón del pie deja de ser «Cancelar» (que se veía
 * deshabilitado y parecía un fallo) y pasa a «Cerrar», que solo cierra la ventana; el texto del pie lo dice y cuenta el tiempo transcurrido.
 */
export type OperacionLarga = "crear" | "copiar" | "parametros" | "cerrar" | "archivar";

/** `42` → «0:42»; `75` → «1:15». */
export function formatearDuracion(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const EN_CURSO: Record<OperacionLarga, { haciendo: string; suele: string; sigue: string }> = {
  crear: {
    haciendo: "Calculando la proyección…",
    suele: "Suele tardar más de un minuto.",
    sigue: "Si cierras la ventana, el cálculo sigue en el servidor (no se puede cancelar) y la proyección aparecerá en la lista al terminar.",
  },
  copiar: {
    haciendo: "Copiando las decisiones y calculando la proyección…",
    suele: "Suele tardar más de un minuto.",
    sigue: "Si cierras la ventana, la copia sigue en el servidor (no se puede cancelar) y la proyección aparecerá en la lista al terminar.",
  },
  parametros: {
    haciendo: "Guardando los parámetros…",
    suele: "",
    sigue: "Si cierras la ventana, el cambio se sigue guardando en el servidor (no se puede cancelar).",
  },
  cerrar: {
    haciendo: "Cerrando la proyección…",
    suele: "Puede tardar.",
    sigue: "Si cierras la ventana, el cierre sigue en el servidor (no se puede cancelar); verás el resultado aquí al terminar.",
  },
  archivar: {
    haciendo: "Archivando la proyección…",
    suele: "",
    sigue: "Si cierras la ventana, el archivado sigue en el servidor (no se puede cancelar).",
  },
};

/** El texto del pie mientras la operación corre: qué hace, cuánto lleva y qué pasa si se cierra la ventana. */
export function textoOperacionEnCurso(op: OperacionLarga, segundos: number): string {
  const t = EN_CURSO[op];
  return [t.haciendo, `Lleva ${formatearDuracion(segundos)}.`, t.suele, t.sigue].filter((x) => x !== "").join(" ");
}

/** Etiqueta del botón del pie: «Cancelar» antes de empezar; «Cerrar» mientras corre (solo cierra la ventana). */
export function etiquetaBotonSecundario(enCurso: boolean): string {
  return enCurso ? "Cerrar" : "Cancelar";
}

/** Título / nombre accesible del botón «Cerrar» mientras corre. */
export const AYUDA_CERRAR_EN_CURSO = "Cierra la ventana; la operación sigue en el servidor y no se cancela.";

/** Aviso para el panel si la operación falla DESPUÉS de cerrar la ventana (el error no se traga). */
export function textoFalloTrasCerrar(op: OperacionLarga, mensaje: string): string {
  const que: Record<OperacionLarga, string> = {
    crear: "No se pudo crear la proyección",
    copiar: "No se pudo copiar la proyección",
    parametros: "No se pudieron guardar los parámetros",
    cerrar: "No se pudo cerrar la proyección",
    archivar: "No se pudo archivar la proyección",
  };
  return `${que[op]}: ${mensaje}`;
}
