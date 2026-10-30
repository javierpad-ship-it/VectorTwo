import type { Celda, Hoja } from "@/lib/proyeccion/excel";
import type { GMIaDetalleApi, GMIaResumenApi } from "./tipos-api";

/**
 * Hojas de la exportación a Excel de la pestaña «Propuesta IA» (ficha 07e, §4.1). Puro: solo arma filas y cabeceras; SheetJS se carga
 * bajo demanda en el navegador. Parte de los datos ya cargados por las rutas `requirePlanner`; los textos son los nombres reales.
 */

const redondear1 = (x: number | null | undefined): number | null => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
const lista = (xs: readonly string[]): string | null => (xs.length === 0 ? null : xs.join(", "));
const fecha = (iso: string): string => iso.slice(0, 10);

/** Hoja `GM`: una fila por género × mundo con su meta, esfuerzo, absorción y estado. */
export function hojaGMPropuestaIa(gms: readonly GMIaResumenApi[]): Hoja {
  const filas: Hoja = [
    [
      "GM",
      "GÉNERO",
      "MUNDO",
      "RESTO",
      "META %",
      "SOBRE BASE",
      "META GM",
      "FIJAS",
      "FILAS FIJAS",
      "META LIBRE",
      "FILAS LIBRES",
      "NATURAL IA",
      "ESFUERZO %",
      "FILAS FORZADAS",
      "FILAS QUE CEDEN",
      "ABSORBIDO U",
      "ABSORBIDO %",
      "SIN DECIDIR (Y)",
      "ESTADO",
      "MOTIVOS",
      "GENERADA",
      "QUIÉN",
      "MODELO",
      "PROMPT",
      "COSTO USD",
    ],
  ];
  for (const g of gms) {
    filas.push([
      `${g.genero} · ${g.mundo}`,
      g.genero,
      g.mundo,
      g.es_resto ? "sí" : null,
      g.meta?.pct ?? null,
      g.meta?.sobre_base ?? null,
      g.meta?.meta_gm ?? null,
      g.meta?.fijas ?? null,
      g.meta?.filas_fijas ?? null,
      g.meta_libre,
      g.meta?.filas_libres ?? null,
      g.natural_libres,
      redondear1(g.esfuerzo_pct),
      g.filas_forzadas,
      g.filas_que_ceden,
      g.absorcion?.absorbido_u ?? null,
      redondear1(g.absorcion?.absorbido_pct),
      g.filas_y_sin_decidir,
      g.estado,
      lista(g.motivos),
      g.propuesta ? fecha(g.propuesta.created_at) : null,
      g.propuesta?.usuario_nombre ?? null,
      g.propuesta?.modelo ?? null,
      g.propuesta?.version_prompt ?? null,
      g.propuesta?.costo_usd ?? null,
    ]);
  }
  return filas;
}

/** Hoja `FILAS`: las filas de cada GM, ordenadas por `|IA con meta − método|` descendente (donde la IA más se aparta del método, primero). */
export function hojaFilasPropuestaIa(detalles: readonly GMIaDetalleApi[], anioEnCurso: number): Hoja {
  const y = anioEnCurso;
  const filas: Hoja = [
    [
      "GM",
      "LÍNEA",
      "EQUIVALENCIA",
      "AGRUPACIÓN DE MARCA",
      "ESTADO EN LA META",
      `BASE ${y + 1}`,
      `BASE CORREGIDA ${y + 1}`,
      `${y} VIGENTE`,
      `${y} DECIDIDA`,
      `MÉTODO ${y + 1}`,
      "NATURAL IA",
      "IA CON META",
      "ABSORBIDO U",
      "ABSORBIDO %",
      "BRECHA U",
      "BRECHA %",
      "VS MÉTODO U",
      `% SOBRE ${y} CORREGIDO`,
      `% SOBRE ${y} REAL`,
      "CONFIANZA",
      "SEÑALES",
      "LECTURA DE LA IA",
      "AVISOS",
      "RAZÓN NATURAL",
      "RAZÓN",
      `VIGENTE ${y + 1}`,
      `DECIDIDA ${y + 1}`,
    ],
  ];
  for (const d of detalles) {
    const ordenadas = [...d.filas].sort((a, b) => Math.abs(b.contra_metodo_u ?? 0) - Math.abs(a.contra_metodo_u ?? 0) || (a.fila_id < b.fila_id ? -1 : a.fila_id > b.fila_id ? 1 : 0));
    for (const f of ordenadas) {
      const fila: Celda[] = [
        `${d.genero} · ${d.mundo}`,
        f.linea,
        f.equivalencia,
        f.agrupacion_marca,
        f.estado_meta,
        f.base,
        f.base_corregida,
        f.vigente_y,
        f.decidida_y ? "sí" : "no",
        f.metodo_y1,
        f.natural_y1,
        f.meta_y1,
        f.absorbido_u,
        redondear1(f.absorbido_pct),
        f.brecha_u,
        redondear1(f.brecha_pct),
        f.contra_metodo_u,
        redondear1(f.pct_sobre_corregida),
        redondear1(f.pct_sobre_real),
        f.confianza,
        lista(f.senales),
        lista(f.banderas),
        lista(f.avisos),
        f.razon_natural,
        f.razon,
        f.vigente_y1,
        f.decidida_y1 ? "sí" : "no",
      ];
      filas.push(fila);
    }
  }
  return filas;
}

/** Hojas `GM` y `FILAS` de la exportación de la pestaña «Propuesta IA». */
export function hojasPropuestaIa(args: { gms: readonly GMIaResumenApi[]; detalles: readonly GMIaDetalleApi[]; anioEnCurso: number }): { GM: Hoja; FILAS: Hoja } {
  return { GM: hojaGMPropuestaIa(args.gms), FILAS: hojaFilasPropuestaIa(args.detalles, args.anioEnCurso) };
}
