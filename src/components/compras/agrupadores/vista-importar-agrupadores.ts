import type { ClaveColumnaAgrupador, MotivoOmisionAgrupador } from "@/lib/compras/agrupadores/tipos";
import type { AvisoImportacionAgrupador, ReporteImportacionAgrupadoresApi, TipoAgrupador } from "@/lib/compras/agrupadores/tipos-api";
import { plural } from "@/lib/formato";
import { filasMapeadas } from "@/components/importador/mapeo";
import type { ArchivoImportacion, CampoImportador, Mapeo } from "@/components/importador/tipos";

/**
 * Textos y datos del importador de agrupadores (ficha 08b §3.11 y §4.4b): los campos que el archivo aporta (con los nombres de columna que
 * los autodetectan), la plantilla con una fila de ejemplo de cada tipo (todo inventado), las etiquetas de los motivos de omisión y del
 * reporte, y los textos del `confirm`. Puro: sin React ni red.
 */

export type CampoAgrupador = ClaveColumnaAgrupador;

/** Los campos de la hoja única. `TIPO` y `NOMBRE` son obligatorios en todas las filas; el resto depende del tipo (lo valida el servidor). */
export const CAMPOS_AGRUPADORES: CampoImportador<CampoAgrupador>[] = [
  { campo: "tipo", etiqueta: "Tipo", alias: ["TIPO"] },
  { campo: "nombre", etiqueta: "Nombre", alias: ["NOMBRE"] },
  { campo: "codigo", etiqueta: "Código", alias: ["CODIGO", "COD"], opcional: true, hint: "aamm## u otro; vacío = se numera al aplicar." },
  { campo: "viaje", etiqueta: "Viaje", alias: ["VIAJE"], opcional: true, hint: "Solo en embarques: código de un viaje." },
  { campo: "embarque", etiqueta: "Embarque", alias: ["EMBARQUE"], opcional: true, hint: "Solo en paquetes: código de un embarque." },
  { campo: "tipo_embarque", etiqueta: "Tipo de embarque", alias: ["TIPO_EMBARQUE", "TIPO_DE_EMBARQUE"], opcional: true, hint: "IMPORTACION (por defecto) o LOCAL." },
  { campo: "destino", etiqueta: "Destino", alias: ["DESTINO"], opcional: true, hint: "Solo en viajes." },
  { campo: "fecha_inicio", etiqueta: "Fecha de inicio", alias: ["FECHA_INICIO", "INICIO"], opcional: true, hint: "Obligatoria en viajes." },
  { campo: "fecha_fin", etiqueta: "Fecha de fin", alias: ["FECHA_FIN", "FIN"], opcional: true },
  { campo: "fecha_zarpe", etiqueta: "Zarpe", alias: ["FECHA_ZARPE", "ZARPE"], opcional: true },
  { campo: "fecha_arribo", etiqueta: "Arribo (puerto)", alias: ["FECHA_ARRIBO", "ARRIBO"], opcional: true, hint: "No aplica a un embarque local." },
  { campo: "fecha_ingreso_cd", etiqueta: "Ingreso CD", alias: ["FECHA_INGRESO_CD", "INGRESO_CD"], opcional: true, hint: "Obligatoria en embarques (o la columna vieja FECHA_LLEGADA)." },
  { campo: "inicio_operativo", etiqueta: "Inicio operativo", alias: ["INICIO_OPERATIVO"], opcional: true, hint: "Fecha, o fecha y hora (aaaa-mm-dd hh:mm)." },
  { campo: "fecha_ingreso_stock", etiqueta: "Ingreso al stock", alias: ["FECHA_INGRESO_STOCK", "INGRESO_STOCK"], opcional: true, hint: "Vacío = el mismo día del Ingreso CD." },
  { campo: "origen", etiqueta: "Origen", alias: ["ORIGEN"], opcional: true, hint: "Almacén o ciudad de origen (California, Nueva York)." },
  // Nombres viejos: se siguen leyendo como Zarpe e Ingreso CD (archivos y plantillas anteriores a 08b-1b).
  { campo: "fecha_salida", etiqueta: "Fecha de salida (columna vieja)", alias: ["FECHA_SALIDA", "SALIDA"], opcional: true },
  { campo: "fecha_llegada", etiqueta: "Fecha de llegada (columna vieja)", alias: ["FECHA_LLEGADA", "LLEGADA"], opcional: true },
  { campo: "puerto", etiqueta: "Puerto", alias: ["PUERTO", "PUERTO_EMBARQUE"], opcional: true },
  { campo: "referencia_logistica", etiqueta: "Referencia logística", alias: ["REFERENCIA_LOGISTICA", "REFERENCIA", "BL"], opcional: true },
  { campo: "responsable", etiqueta: "Responsable (correo)", alias: ["RESPONSABLE", "CORREO_RESPONSABLE"], opcional: true, hint: "Obligatorio en viajes: correo de un comprador o administrador activo." },
  { campo: "nota", etiqueta: "Nota", alias: ["NOTA", "NOTAS"], opcional: true },
];

/**
 * La plantilla es la de T2 (`src/lib/compras/agrupadores/plantilla.ts`), la misma de la hoja `AGRUPADORES` de la exportación a Excel: el
 * encabezado en el orden del contrato y una fila de ejemplo de cada tipo, todo inventado y con el código escrito.
 */
export { ENCABEZADOS_AGRUPADORES as ENCABEZADOS_PLANTILLA_AGRUPADORES, FILAS_EJEMPLO_AGRUPADORES } from "@/lib/compras/agrupadores/plantilla";

export const NOMBRE_PLANTILLA_AGRUPADORES = "plantilla-agrupadores";

/** Motivos de omisión en castellano llano. El orden de las claves es el orden de los chips de filtro del reporte. */
export const ETIQUETA_MOTIVO_OMISION_AGRUPADOR: Record<MotivoOmisionAgrupador, string> = {
  tipo_invalido: "Tipo inválido (usa VIAJE, EMBARQUE o PAQUETE)",
  nombre_requerido: "Falta el nombre",
  nombre_largo: "Nombre demasiado largo",
  codigo_invalido: "Código inválido",
  codigo_repetido_en_archivo: "Código repetido en el archivo",
  fila_repetida: "Fila repetida en el archivo",
  fecha_requerida: "Falta una fecha obligatoria",
  fecha_invalida: "Fecha inválida",
  fin_antes_de_inicio: "El fin es anterior al inicio",
  salida_despues_de_llegada: "La salida es posterior a la llegada",
  local_con_viaje: "Un embarque local no lleva viaje",
  viaje_desconocido: "Viaje desconocido",
  viaje_cancelado: "El viaje está cancelado",
  embarque_desconocido: "Embarque desconocido",
  embarque_requerido: "El paquete necesita un embarque",
  embarque_no_editable: "El embarque está cancelado o recibido",
  responsable_requerido: "Falta el responsable",
  responsable_desconocido: "Responsable desconocido",
  responsable_no_asignable: "Responsable no asignable (solo compradores y administradores activos)",
  referencia_sin_codigo: "La fila referida del archivo no trae código",
  referencia_omitida: "Apunta a una fila omitida del archivo",
  cambiada_requiere_edicion: "Ya existe con otros datos: corrígelo en pantalla",
  correlativo_agotado: "Se agotaron los 99 códigos del mes: escribe el código",
  campo_largo: "Un campo supera su largo máximo",
  hora_invalida: "Hora inválida (usa hh:mm, de 00:00 a 23:59)",
  fechas_en_conflicto: "Una columna y su nombre viejo traen fechas distintas",
};

export const ETIQUETA_AVISO_IMPORTACION_AGRUPADOR: Record<AvisoImportacionAgrupador, string> = {
  viaje_cerrado: "El viaje está cerrado: igual se registra",
  sin_responsable: "Sin responsable propio ni heredable",
  puerto_distinto_del_habitual: "Puerto distinto del habitual del proveedor",
  arribo_ignorado_en_local: "El arribo se ignoró: un embarque local no pasa por puerto",
};

export const ETIQUETA_TIPO_PLURAL: Record<TipoAgrupador, [string, string]> = { viaje: ["viaje", "viajes"], embarque: ["embarque", "embarques"], paquete: ["paquete", "paquetes"] };

/** «12 viajes, 18 embarques y 30 paquetes» a partir de los conteos de nuevas. */
export function textoCreaciones(r: Pick<ReporteImportacionAgrupadoresApi, "resumen">): string {
  const p = r.resumen.por_tipo;
  const partes = (["viaje", "embarque", "paquete"] as const).filter((t) => p[t].nuevas > 0).map((t) => plural(p[t].nuevas, ETIQUETA_TIPO_PLURAL[t][0], ETIQUETA_TIPO_PLURAL[t][1]));
  if (partes.length === 0) return "nada";
  return partes.length === 1 ? partes[0] : `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/** Texto del `confirm` antes de aplicar. */
export function confirmarAplicarAgrupadores(nombre: string, r: ReporteImportacionAgrupadoresApi): string {
  const partes = [`¿Aplicar ${nombre}? Se crearán ${textoCreaciones(r)}.`, "Se crea todo junto o nada: si algo falla, no queda nada a medias. Nunca se edita ni se mueve lo que ya existe."];
  if (r.resumen.omitidas > 0 || r.resumen.cambiadas > 0) partes.push(`Quedarán fuera ${plural(r.resumen.omitidas + r.resumen.cambiadas, "fila", "filas")} (omitidas o ya existentes con otros datos).`);
  return partes.join("\n");
}

/** La cuenta del archivo: filas que no están vacías (las vacías al final de una hoja no cuentan ni se envían). */
export const filaVacia = (f: Record<string, string>): boolean => Object.values(f).every((v) => v.trim() === "");

/**
 * Las filas que viajan al servidor: cada fila del archivo proyectada a los campos del contrato, con su número de fila en la hoja (la
 * cabecera es la 1, así que los datos empiezan en la 2). Las filas totalmente vacías no se envían y no gastan número de fila.
 */
export function armarFilasImportacion(archivo: ArchivoImportacion | null, mapeo: Mapeo<CampoAgrupador>): Record<string, string | number>[] {
  return filasMapeadas(archivo, mapeo, CAMPOS_AGRUPADORES)
    .map((f, i) => ({ f, fila: i + 2 }))
    .filter((x) => !filaVacia(x.f))
    .map((x) => ({ fila: x.fila, ...x.f }));
}
