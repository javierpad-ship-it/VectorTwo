import type { Acumulador } from "./acumulador";
import { construirInforme, type ResultadoInforme } from "./informe";
import { crearPeticionPrevisualizar } from "./previsualizar";
import type { InformeCarga, TotalesQlik } from "./tipos";
import type { PrevisualizarPeticion, PrevisualizarRespuesta } from "./tipos-api";

/**
 * Recalcular el informe sin releer el archivo (mejora M5b, "Recalcular"). Tras
 * guardar mapeos, el navegador vuelve a llamar a `previsualizar` con la MISMA
 * petición (solo valores distintos, menos de 1 MB) y reconstruye el informe con
 * el acumulador que sigue en memoria: el servidor aplica entonces los mapeos
 * recién guardados y trae el árbol fresco. Función pura salvo por la llamada que
 * recibe como parámetro (en la pantalla, `apiVentas.previsualizar`).
 */

export type RecalculoInforme = {
  /** Lo que devolvió `previsualizar` (resoluciones con los mapeos aplicados). */
  respuesta: PrevisualizarRespuesta;
  /** Informe, consolidado y combinaciones desconocidas recalculados. */
  resultado: ResultadoInforme;
  /** Filas reasignadas por mapeo en todos los meses (para "Reporte recalculado: N filas reasignadas"). */
  reasignadas: number;
};

/** Filas reasignadas por mapeo, sumadas de todos los meses del informe. */
export function totalReasignadas(informe: Pick<InformeCarga, "meses">): number {
  return informe.meses.reduce((suma, m) => suma + m.reasignadas.filas, 0);
}

/**
 * `previsualizar(crearPeticionPrevisualizar(acum))` → `construirInforme`. Los
 * totales de QlikView y el aviso de hoja truncada se pasan en `opciones` para
 * que el informe recalculado los conserve. Si `previsualizar` falla, el error
 * sube tal cual y el informe anterior sigue vigente (esta función no guarda nada).
 */
export async function recalcularInforme(
  acumulador: Acumulador,
  previsualizar: (peticion: PrevisualizarPeticion) => Promise<PrevisualizarRespuesta>,
  opciones: { totalesQlik?: Record<string, TotalesQlik>; posiblementeTruncado?: boolean } = {}
): Promise<RecalculoInforme> {
  const respuesta = await previsualizar(crearPeticionPrevisualizar(acumulador));
  const resultado = construirInforme({
    acumulador,
    resoluciones: respuesta,
    totalesQlik: opciones.totalesQlik,
    posiblementeTruncado: opciones.posiblementeTruncado,
  });
  return { respuesta, resultado, reasignadas: totalReasignadas(resultado.informe) };
}
