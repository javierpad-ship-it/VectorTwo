import type { Hoja } from "@/lib/proyeccion/excel";
import type { AnalisisMarcaApi, ListaBarrerApi, MarcaBarrerResumenApi } from "@/lib/marcas-barrer/tipos-api";
import { ETIQUETA_CLAVE_TEMPORADA, claveTemporada } from "./ajuste";
import { ETIQUETA_FUENTE, ETIQUETA_MODALIDAD_BARRER, ETIQUETA_MODO_REPARTO, ETIQUETA_SOLO, periodoCorto, soloFecha, textoAlcance, textoEstadoReparto, type FiltrosLista, type OpcionFiltro } from "./vista";

/**
 * Hojas del Excel de M12 (ficha 12, paso 3): `RESUMEN` y `FILTROS` para la lista (las filas visibles con los filtros),
 * `REPARTO`, `ESTACIONALIDAD` y `FILTROS` para una marca. Puras: solo arman filas; SheetJS se carga bajo demanda en el
 * navegador (`descarga-libro` de M7) y nunca llama a una ruta nueva. Los porcentajes van en 0–100 con dos decimales.
 */

const dec2 = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 10000) / 100);
const pp = (x: number | null | undefined) => (x === null || x === undefined || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const nombreDe = (lista: readonly OpcionFiltro[], id: string) => lista.find((o) => o.id === id)?.nombre ?? id;

export const NOMBRE_ARCHIVO_LISTA = "marcas-al-barrer.xlsx";
export const nombreArchivoMarca = (marca: string) => `marca-barrer-${marca.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "marca"}.xlsx`;

export function hojasLista(
  datos: ListaBarrerApi["datos"],
  marcas: readonly MarcaBarrerResumenApi[],
  filtros: FiltrosLista,
  opciones: { agrupaciones: readonly OpcionFiltro[]; generos: readonly OpcionFiltro[]; mundos: readonly OpcionFiltro[]; lineas: readonly OpcionFiltro[] }
): Record<string, Hoja> {
  const resumen: Hoja = [
    [
      "MARCA",
      "MODALIDAD",
      "AGRUPACIÓN DE MARCA",
      `UNIDADES ${datos.ventana} M`,
      "UNIDADES AL BARRER",
      "UNIDADES ESPECÍFICAS",
      "% AL BARRER",
      "GML CON VENTA",
      "GML PEQUEÑOS",
      "GML ESPECÍFICOS",
      "ERROR DEL REPARTO (PP)",
      "VEREDICTO",
      "REPARTO VIGENTE",
      "APROBADO EL",
      "APROBADO POR",
      "ESTADO",
      "DIFERENCIA CON LO CALCULADO HOY (PP)",
    ],
  ];
  for (const m of marcas) {
    const estado = textoEstadoReparto({ vigente: m.vigente !== null, obsoleto: m.obsoleto, diferenciaPp: m.diferencia_pp });
    resumen.push([
      m.nombre,
      ETIQUETA_MODALIDAD_BARRER[m.modalidad],
      m.agrupacion_marca.nombre,
      m.unidades_ventana,
      m.unidades_barrer,
      m.unidades_especificas,
      dec2(m.share_barrido),
      m.gml_con_venta,
      m.gml_pequenos,
      m.gml_especificos,
      pp(m.error_reparto.pp),
      m.error_reparto.veredicto,
      m.vigente ? `v${m.vigente.version}` : null,
      m.vigente ? soloFecha(m.vigente.aprobada_at) : null,
      m.vigente?.aprobada_por_nombre ?? null,
      estado.texto,
      pp(m.diferencia_pp),
    ]);
  }

  const solo = filtros.solo.map((s) => ETIQUETA_SOLO[s]).join(", ");
  const filtrosHoja: Hoja = [
    ["FILTRO", "VALOR"],
    ["Datos hasta", datos.hasta_periodo ? periodoCorto(datos.hasta_periodo) : "—"],
    ["Ventana (meses)", datos.ventana],
    ["Cargas publicadas", datos.cargas],
    ["Modalidad", filtros.modalidad === "todas" ? "Todas" : ETIQUETA_MODALIDAD_BARRER[filtros.modalidad]],
    ["Agrupación de marca", filtros.agrupacion ? nombreDe(opciones.agrupaciones, filtros.agrupacion) : "Todas"],
    ["Género", filtros.genero ? nombreDe(opciones.generos, filtros.genero) : "Todos"],
    ["Mundo", filtros.mundo ? nombreDe(opciones.mundos, filtros.mundo) : "Todos"],
    ["Línea", filtros.linea ? nombreDe(opciones.lineas, filtros.linea) : "Todas"],
    ["Solo", solo === "" ? "—" : solo],
    ["Marcas en la hoja", marcas.length],
  ];
  return { RESUMEN: resumen, FILTROS: filtrosHoja };
}

export function hojasMarca(analisis: AnalisisMarcaApi): Record<string, Hoja> {
  const v = analisis.vigente;
  const reparto: Hoja = [
    ["MARCA", "TEMPORADA", "GML / UNIDAD", "NIVEL", "UNIDADES VENTANA", "EN EL ALCANCE", "ESPECÍFICO", "P2 HISTÓRICO (%)", "P2 CERRADA (%)", "P2 AJUSTADO VIGENTE (%)", "P2 VIGENTE (%)", "VERSIÓN VIGENTE", "GRUPO RESTO", "P1 VENTANA (%)", "TENDENCIA (%)"],
  ];
  for (const f of analisis.filas) {
    const etiquetaResto = f.grupo_resto ? (analisis.restos.find((r) => r.grupo_resto === f.grupo_resto)?.etiqueta ?? f.grupo_resto) : null;
    // Sin p2 (fuera de alcance o específico) la fila sale una vez, sin temporada, para que se vea que no se reparte.
    const p2s = f.p2.length > 0 ? f.p2 : [null];
    for (const x of p2s) {
      reparto.push([
        analisis.marca.nombre,
        x ? ETIQUETA_CLAVE_TEMPORADA[claveTemporada(x.temporada)] : null,
        f.ruta,
        f.nivel,
        f.unidades_ventana,
        f.en_alcance ? "SÍ" : "NO",
        f.es_especifico ? "SÍ" : "NO",
        x ? dec2(x.historico) : null,
        x ? dec2(x.cerrada) : null,
        x ? dec2(x.ajustado_vigente) : null,
        x ? dec2(x.vigente) : null,
        v ? v.version : null,
        etiquetaResto,
        dec2(f.p1_ventana),
        dec2(f.tendencia),
      ]);
    }
  }

  const e = analisis.estacionalidad;
  const meses = ["ENE", "FEB", "MAR", "ABR", "MAY", "JUN", "JUL", "AGO", "SET", "OCT", "NOV", "DIC"];
  const estacionalidad: Hoja = [["CURVA", ...meses]];
  if (e.propia) estacionalidad.push([`Propia de ${analisis.marca.nombre} (%)`, ...e.propia.map((x) => dec2(x))]);
  if (e.gml) estacionalidad.push(["Del GML para esta marca (%)", ...e.gml.map((x) => dec2(x))]);
  estacionalidad.push([]);
  estacionalidad.push(["EAT (pp)", pp(e.eat_pp)]);
  estacionalidad.push(["Veredicto", e.veredicto]);
  estacionalidad.push(["Años completos", e.anios_completos.join(", ") || "—"]);
  estacionalidad.push(["Tendencia total (%)", dec2(analisis.tendencia_total)]);

  const p = analisis.parametros;
  const filtros: Hoja = [
    ["PARÁMETRO", "VALOR"],
    ["Marca", analisis.marca.nombre],
    ["Modalidad", ETIQUETA_MODALIDAD_BARRER[analisis.marca.modalidad]],
    ["Agrupación de marca", analisis.marca.agrupacion_marca],
    ["Conjunto", analisis.marca.miembros.join(", ") || "—"],
    ["Ventana (meses)", p.ventana_meses],
    ["Desde", periodoCorto(p.desde_periodo)],
    ["Hasta", periodoCorto(p.hasta_periodo)],
    ["Modo pedido", ETIQUETA_MODO_REPARTO[p.modo] ?? p.modo],
    ["Modo aplicado", ETIQUETA_MODO_REPARTO[p.modo_efectivo] ?? p.modo_efectivo],
    ["Normaliza el Niño", p.normaliza_nino ? "SÍ" : "NO"],
    ["Alcance", textoAlcance(p.alcance, analisis.opciones_alcance)],
    ["Unidades al barrer", analisis.unidades_barrer],
    ["Unidades específicas", analisis.unidades_especificas],
    ["% al barrer", dec2(analisis.share_barrido)],
    ["Error del reparto (pp)", pp(analisis.error_reparto.pp)],
    ["Veredicto del error", analisis.error_reparto.veredicto],
    ["Reparto vigente", v ? `v${v.version}` : "—"],
    ["Aprobado el", v ? soloFecha(v.aprobada_at) : "—"],
    ["Aprobado por", v?.aprobada_por_nombre ?? "—"],
    ["Fuente del vigente", v ? (ETIQUETA_FUENTE[v.fuente] ?? v.fuente) : "—"],
    ["Nota del vigente", v?.nota ?? "—"],
    ["Obsoleto", analisis.obsoleto.length > 0 ? analisis.obsoleto.join(", ") : "NO"],
  ];
  return { REPARTO: reparto, ESTACIONALIDAD: estacionalidad, FILTROS: filtros };
}
