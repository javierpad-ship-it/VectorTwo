import { VERSION_METODO } from "@/lib/proyeccion/tipos-api";
import {
  FILAS_MAYORES,
  GM_CLAVE_TOTAL,
  MIN_FILAS_CONCENTRACION,
  UMBRAL_CONCENTRACION_TOP10,
  UMBRAL_DECISION_MASIVA,
  UMBRAL_DESVIO_PP,
  UMBRAL_DIA_PICO,
  UMBRAL_FILA_DOMINANTE,
  UMBRAL_TENDENCIA_PP,
  UMBRAL_TIENDA_NUEVA_RELEVANTE,
  type AlertaApi,
  type CodigoAlerta,
  type CrecimientoGMApi,
  type DecisionesSql,
  type PuenteApi,
  type TableroProyeccionSql,
} from "./tipos-api";
import { ROTULO_MANUAL_EN_FRASE, lineaPuente } from "./puente";
import { conSigno, fechaCorta, lista, mesAnio, miles, parte, pct, pp, rangoMeses } from "./textos";

/**
 * Alertas del tablero de dirección (ficha 14, §4.5). Puras: cada función recibe cifras ya leídas y devuelve cero o más alertas. Las que bloquearían
 * el cierre NO están aquí: salen de las reglas de M7 (`cierre.ts`).
 */

const ENLACE_PROYECCION = "/planificacion/proyeccion";
const ENLACE_CRECIMIENTOS = "/planificacion/curvas-estacionalidad?pestana=genero-mundo";
const ENLACE_TIENDAS = "/maestros/tiendas";
const ENLACE_VENTA = "/planificacion/venta-stock";

/** Orden de la tabla de §4.5 (dentro de cada nivel). */
export const ORDEN_ALERTAS: CodigoAlerta[] = [
  "contra_tendencia",
  "desvio_crecimiento",
  "factor_provisional",
  "tienda_nueva_relevante",
  "apertura_sin_historia",
  "anomalia_crecimiento",
  "origen_decisiones",
  "concentracion",
  "base_corregida_nino",
  "metodo_anterior",
  "sin_curva",
  "propuesta_cambio",
  "curva_cambio",
  "datos_mas_nuevos",
  "meses_faltantes",
  "atribucion_estimada",
  "atribucion_sin_mensual",
  "marca_estimada",
  "comparada_distinta_k",
  "distinta_de_aprobada",
];

/** Importantes primero; dentro de cada nivel, el orden de la tabla; estable para las de un mismo código. */
export function ordenarAlertas(alertas: readonly AlertaApi[]): AlertaApi[] {
  const posicion = new Map(ORDEN_ALERTAS.map((c, i) => [c, i]));
  return alertas
    .map((a, i) => ({ a, i }))
    .sort((x, y) => (x.a.nivel === y.a.nivel ? 0 : x.a.nivel === "importante" ? -1 : 1) || (posicion.get(x.a.codigo) ?? 99) - (posicion.get(y.a.codigo) ?? 99) || x.i - y.i)
    .map((x) => x.a);
}

type Alcance = AlertaApi["alcance"];
const alerta = (codigo: CodigoAlerta, nivel: AlertaApi["nivel"], alcance: Alcance, titulo: string, detalle: string, cifras: AlertaApi["cifras"], enlace: string | null): AlertaApi => ({
  codigo,
  nivel,
  alcance,
  titulo,
  detalle,
  cifras,
  enlace,
});

// ─── Crecimiento: contra la tendencia, desvío, base corregida y anomalías ───

/**
 * `contra_tendencia`: un GM declara `UMBRAL_TENDENCIA_PP` puntos o más por encima de la tendencia de sus mismas tiendas y esa tendencia es negativa.
 * Se mide con la tendencia CORREGIDA del Niño; si solo la bruta es negativa, la alerta baja a informativa («tendencia afectada por el Niño»).
 */
export function alertasContraTendencia(crecimientos: readonly CrecimientoGMApi[], anio: number, kPrima: number): AlertaApi[] {
  const salida: AlertaApi[] = [];
  const meses = rangoMeses(1, kPrima);
  for (const c of crecimientos) {
    if (c.gm_clave === GM_CLAVE_TOTAL || c.declarado_pct === null) continue;
    const bruta = c.tendencia_mismas_pct;
    const corregida = c.tendencia_mismas_corregida_pct;
    if (bruta === null || corregida === null) continue;
    const dosCifras = c.con_nino && Math.abs(bruta - corregida) >= 0.05;
    const cifras = { gm_clave: c.gm_clave, declarado_pct: c.declarado_pct, tendencia_pct: corregida, tendencia_bruta_pct: bruta };
    if (corregida < 0 && c.declarado_pct - corregida >= UMBRAL_TENDENCIA_PP) {
      salida.push(
        alerta(
          "contra_tendencia",
          "importante",
          "proyeccion",
          `${c.nombre}: crece contra la tendencia`,
          `${c.nombre} declara ${pct(c.declarado_pct)} y sus mismas tiendas van ${pct(corregida)} en ${meses} de ${anio}${dosCifras ? `, corregido del Niño (${pct(bruta)} en bruto)` : ""}.`,
          cifras,
          ENLACE_CRECIMIENTOS
        )
      );
    } else if (c.tendencia_afectada_nino && c.declarado_pct - bruta >= UMBRAL_TENDENCIA_PP) {
      salida.push(
        alerta(
          "contra_tendencia",
          "info",
          "proyeccion",
          `${c.nombre}: tendencia afectada por el Niño`,
          `${c.nombre} declara ${pct(c.declarado_pct)} y sus mismas tiendas van ${pct(bruta)} en bruto y ${pct(corregida)} corregido del Niño en ${meses} de ${anio}: tendencia afectada por el Niño.`,
          cifras,
          ENLACE_CRECIMIENTOS
        )
      );
    }
  }
  return salida;
}

/** `desvio_crecimiento`: |implícito − declarado| ≥ `UMBRAL_DESVIO_PP` en la base del declarado. `puentes` da lo fijado y las otras diferencias del GM. */
export function alertasDesvio(crecimientos: readonly CrecimientoGMApi[], puentes: readonly (PuenteApi & { gm_clave: string })[]): AlertaApi[] {
  const salida: AlertaApi[] = [];
  for (const c of crecimientos) {
    if (c.gm_clave === GM_CLAVE_TOTAL || c.declarado_pct === null || c.desvio_pp === null) continue;
    if (Math.abs(c.desvio_pp) < UMBRAL_DESVIO_PP) continue;
    const implicito = c.declarado_pct + c.desvio_pp;
    const p = puentes.find((x) => x.gm_clave === c.gm_clave);
    const manual = p ? lineaPuente(p, "manual") : 0;
    const otras = p ? lineaPuente(p, "otras") : 0;
    const causas: string[] = [];
    if (manual !== 0) causas.push(`${ROTULO_MANUAL_EN_FRASE} ${conSigno(manual)} u`);
    if (otras !== 0) causas.push(`otras diferencias con la propuesta ${conSigno(otras)} u`);
    salida.push(
      alerta(
        "desvio_crecimiento",
        "importante",
        "proyeccion",
        `${c.nombre}: lo proyectado no es lo declarado`,
        `${c.nombre}: declarado ${pct(c.declarado_pct)}, implícito ${pct(implicito)} (${pp(c.desvio_pp)}${causas.length > 0 ? `: ${lista(causas)}` : ""}).`,
        { gm_clave: c.gm_clave, declarado_pct: c.declarado_pct, implicito_pct: implicito, desvio_pp: c.desvio_pp, manual, otras },
        ENLACE_PROYECCION
      )
    );
  }
  return salida;
}

/** `base_corregida_nino` (informativa): GM cuya base del año siguiente se corrigió del Niño de forma material. */
export function alertasBaseCorregida(crecimientos: readonly CrecimientoGMApi[], anio: number): AlertaApi[] {
  return crecimientos
    .filter((c) => c.gm_clave !== GM_CLAVE_TOTAL && c.con_nino && c.base_real !== null && c.base_corregida !== null)
    .map((c) => {
      const real = c.base_real as number;
      const corregida = Math.round(c.base_corregida as number);
      const variacion = ((corregida - real) / real) * 100;
      return alerta(
        "base_corregida_nino",
        "info",
        "proyeccion",
        `${c.nombre}: base corregida del Niño`,
        `${c.nombre}: base ${anio + 1} corregida del Niño ${pct(variacion)} (${miles(real)} → ${miles(corregida)}).`,
        { gm_clave: c.gm_clave, base: real, base_corregida: corregida, pct: variacion },
        ENLACE_CRECIMIENTOS
      );
    });
}

const TEXTO_ANOMALIA: Record<CrecimientoGMApi["anomalias"][number], string> = {
  sin_base: "se aprobó sin base de venta",
  reemplazada_mismo_dia: "reemplazó a otra versión el mismo día",
  sin_nota: "sin nota",
};

/** `anomalia_crecimiento`: importante si la versión no tiene base; si no, informativa. Una alerta por GM con todas sus anomalías. */
export function alertasAnomalias(crecimientos: readonly CrecimientoGMApi[]): AlertaApi[] {
  return crecimientos
    .filter((c) => c.gm_clave !== GM_CLAVE_TOTAL && c.anomalias.length > 0)
    .map((c) => {
      const version = c.version === null ? "" : ` v${c.version}`;
      const cuando = c.aprobada_at ? ` (${fechaCorta(c.aprobada_at, false)}${c.autor ? `, ${c.autor}` : ""})` : "";
      return alerta(
        "anomalia_crecimiento",
        c.anomalias.includes("sin_base") ? "importante" : "info",
        "proyeccion",
        `${c.nombre}: revisa el crecimiento aprobado`,
        `${c.nombre}${version}${cuando}: ${lista(c.anomalias.map((a) => TEXTO_ANOMALIA[a]))}.`,
        { gm_clave: c.gm_clave, anomalias: c.anomalias.join(","), version: c.version ?? "" },
        ENLACE_CRECIMIENTOS
      );
    });
}

// ─── Factores del Niño provisionales ───

export type FactorProvisional = {
  anio: number;
  temporada: string;
  /** `faltante`, `desfasado` o `sin_confirmar` (cualquier estado distinto de `ok`). */
  estado: string;
  efectivo: number | null;
  parcial: boolean;
};

const TEXTO_ESTADO_FACTOR: Record<string, string> = {
  faltante: "sin valor",
  desfasado: "calculado con datos anteriores: hay que sincronizarlo",
  sin_confirmar: "parcial y sin confirmar",
};

/**
 * `factor_provisional`: UNA alerta con todos los factores del Niño del año en curso que no están `ok`, y UNA sola cifra de exposición: la suma de
 * `Y1_con_factor_Y` sobre la UNIÓN de temporadas afectadas (la de cada factor y `todo_el_ano`), cada temporada una vez. Es una cota superior.
 */
export function alertaFactorProvisional(factores: readonly FactorProvisional[], porTemporada: TableroProyeccionSql["por_temporada"], totalSiguiente: number, anio: number): AlertaApi[] {
  if (factores.length === 0) return [];
  const afectadas = new Set<string>(["todo_el_ano", ...factores.map((f) => f.temporada)]);
  const expuesto = porTemporada.filter((t) => t.temporada !== null && afectadas.has(t.temporada)).reduce((a, t) => a + t.Y1_con_factor_Y, 0);
  const nombres = factores.map((f) => {
    const valor = f.efectivo === null ? "" : `, ${f.efectivo.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
    return `${f.temporada} ${f.anio} (${TEXTO_ESTADO_FACTOR[f.estado] ?? f.estado}${valor})`;
  });
  const participacion = totalSiguiente > 0 ? expuesto / totalSiguiente : 0;
  return [
    alerta(
      "factor_provisional",
      "importante",
      "proyeccion",
      factores.length === 1 ? "Un factor del Niño es provisional" : `${factores.length} factores del Niño son provisionales`,
      `${factores.length === 1 ? "Factor provisional" : "Factores provisionales"}: ${lista(nombres)}. ${factores.length === 1 ? "Expone" : "Exponen"} hasta ${miles(expuesto)} u de ${anio + 1} (${parte(participacion)}) en filas de ${lista([...afectadas].filter((t) => t !== "todo_el_ano"))} y de todo el año con factor (es una cota superior).`,
      { expuesto, participacion, factores: factores.map((f) => `${f.temporada} ${f.anio}`).join(", ") },
      ENLACE_PROYECCION
    ),
  ];
}

// ─── Tiendas ───

export type TiendaNombrada = { id: string; codigo: string; fecha_apertura: string | null };

/**
 * `tienda_nueva_relevante`: una tienda que entra a la base pesa `UMBRAL_TIENDA_NUEVA_RELEVANTE` o más de `B`, o una nueva o apertura pesa eso del
 * año siguiente.
 */
export function alertasTiendaNueva(
  doc: Pick<TableroProyeccionSql, "anios">,
  tiendas: ReadonlyMap<string, TiendaNombrada>,
  alcance: Alcance,
  k: number,
  /** Con tiendas elegidas: solo las del conjunto. */
  soloDe: ReadonlySet<string> | null = null
): AlertaApi[] {
  const [enCurso, siguiente] = doc.anios;
  const salida: AlertaApi[] = [];
  const cuenta = (id: string) => soloDe === null || soloDe.has(id);
  const B = siguiente.base.B ?? 0;
  const paraBase = new Map<string, number>();
  for (const t of enCurso.tiendas) if (t.para_base !== null) paraBase.set(t.t, (paraBase.get(t.t) ?? 0) + t.para_base);
  for (const [id, u] of [...paraBase].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    if (!cuenta(id) || !(B > 0) || u / B < UMBRAL_TIENDA_NUEVA_RELEVANTE) continue;
    const t = tiendas.get(id);
    const abrio = t?.fecha_apertura ? `abrió en ${mesAnio(t.fecha_apertura)} y ` : "";
    const comoSeArma = k < 12 ? `su ${enCurso.anio} es real ${rangoMeses(1, k)} más proyectado ${rangoMeses(k + 1, 12)}` : `su ${enCurso.anio} es real`;
    salida.push(
      alerta(
        "tienda_nueva_relevante",
        "importante",
        alcance,
        `${t?.codigo ?? "Una tienda"} entra a la base y pesa`,
        `${t?.codigo ?? id} entra a mismas tiendas en ${siguiente.anio} y es el ${parte(u / B)} de la base: ${abrio}${comoSeArma}.`,
        { tienda_id: id, codigo: t?.codigo ?? "", u, participacion: u / B, tipo: "entra" },
        ENLACE_TIENDAS
      )
    );
  }
  const total = siguiente.base.vigente + siguiente.tiendas.reduce((a, t) => a + t.vigente, 0);
  const nuevas = new Map<string, { u: number; subbloque: string }>();
  for (const t of siguiente.tiendas) {
    if (t.bloque !== "nuevas") continue;
    const x = nuevas.get(t.t) ?? { u: 0, subbloque: t.subbloque ?? "aperturas" };
    x.u += t.vigente;
    nuevas.set(t.t, x);
  }
  for (const [id, x] of [...nuevas].sort((a, b) => b[1].u - a[1].u || a[0].localeCompare(b[0]))) {
    if (!cuenta(id) || !(total > 0) || x.u / total < UMBRAL_TIENDA_NUEVA_RELEVANTE) continue;
    const t = tiendas.get(id);
    const que = x.subbloque === "nuevas_anterior" ? `abrió en ${enCurso.anio} y aún no forma parte de la base` : `abre en ${siguiente.anio}`;
    salida.push(
      alerta(
        "tienda_nueva_relevante",
        "importante",
        alcance,
        `${t?.codigo ?? "Una tienda nueva"} pesa en ${siguiente.anio}`,
        `${t?.codigo ?? id} ${que} y es el ${parte(x.u / total)} de ${siguiente.anio} (${miles(x.u)} u).`,
        { tienda_id: id, codigo: t?.codigo ?? "", u: x.u, participacion: x.u / total, tipo: x.subbloque },
        ENLACE_TIENDAS
      )
    );
  }
  return salida;
}

/** `apertura_sin_historia`: una apertura del año siguiente proyectada por venta esperada (no tiene venta propia). */
export function alertasAperturaSinHistoria(aperturas: readonly { tienda_id: string; fecha: string | null }[], tiendas: ReadonlyMap<string, TiendaNombrada>, alcance: Alcance): AlertaApi[] {
  return aperturas.map((a) => {
    const t = tiendas.get(a.tienda_id);
    const cuando = a.fecha ?? t?.fecha_apertura ?? null;
    return alerta(
      "apertura_sin_historia",
      "importante",
      alcance,
      `${t?.codigo ?? "Una apertura"} se proyecta sin historia`,
      `${t?.codigo ?? a.tienda_id}${cuando ? ` (${mesAnio(cuando)})` : ""} se proyecta por venta esperada y su referente: no tiene venta propia.`,
      { tienda_id: a.tienda_id, codigo: t?.codigo ?? "" },
      ENLACE_TIENDAS
    );
  });
}

// ─── Cómo se decidió ───

const CLASES_SIN_CAMBIAR = ["lote", "ia", "propuesta"] as const;

/**
 * `origen_decisiones`: siempre que haya decisiones en el año siguiente. Importante si lo ACEPTADO SIN CAMBIAR (`lote` + `ia` + `propuesta`; no cuentan
 * `manual`, `escalada` ni `sin_decidir`) es `UMBRAL_DECISION_MASIVA` o más del vigente de TODOS los registros del año siguiente y el día pico concentra
 * `UMBRAL_DIA_PICO` o más de los registros decididos; si no, informativa.
 */
export function alertaOrigenDecisiones(d: DecisionesSql, anioSiguiente: number): AlertaApi[] {
  const clases = ["lote", "ia", "propuesta", "manual", "escalada", "sin_decidir"] as const;
  const total = clases.reduce((a, c) => a + d[c].u, 0);
  const decididos = clases.filter((c) => c !== "sin_decidir").reduce((a, c) => a + d[c].n, 0);
  if (decididos === 0) return [];
  const sinCambiar = CLASES_SIN_CAMBIAR.reduce((a, c) => a + d[c].u, 0);
  const parteSinCambiar = total > 0 ? sinCambiar / total : 0;
  const partePico = d.dia_pico ? d.dia_pico.n / decididos : 0;
  const masiva = parteSinCambiar >= UMBRAL_DECISION_MASIVA && partePico >= UMBRAL_DIA_PICO;
  const de = (u: number) => (total > 0 ? `${Math.round((u / total) * 100)} %` : "0 %");
  const partes = [
    d.lote.u !== 0 ? `${de(d.lote.u)} aceptado en bloque` : null,
    d.ia.u !== 0 ? `${de(d.ia.u)} aceptado de la IA` : null,
    d.propuesta.u !== 0 ? `${de(d.propuesta.u)} tal cual la propuesta` : null,
    d.manual.u !== 0 ? `${de(d.manual.u)} a mano` : null,
    d.escalada.u !== 0 ? `${de(d.escalada.u)} escalado por tienda` : null,
    d.sin_decidir.u !== 0 ? `${de(d.sin_decidir.u)} sin decidir` : null,
  ].filter((x): x is string => x !== null);
  const autor = d.autores[0]?.nombre ? ` por ${d.autores[0].nombre}` : "";
  const pico = d.dia_pico ? `; ${d.dia_pico.n} de los ${decididos} registros de ${anioSiguiente} decididos el ${fechaCorta(d.dia_pico.fecha, false)}${d.autores.length === 1 ? autor : ""}` : "";
  return [
    alerta(
      "origen_decisiones",
      masiva ? "importante" : "info",
      "proyeccion",
      masiva ? `${anioSiguiente}: casi todo se aceptó sin cambiar y en un solo día` : `${anioSiguiente}: cómo se decidió`,
      // Un nombre puede terminar en punto («Planner P.»): no se duplica.
      `${anioSiguiente}: ${partes.join(", ")}${pico}`.replace(/\.?$/, "."),
      { aceptado_sin_cambiar: parteSinCambiar, dia_pico: partePico, decididos, total },
      ENLACE_PROYECCION
    ),
  ];
}

// ─── Del recorte y de los datos ───

/**
 * `concentracion` (recorte): con `MIN_FILAS_CONCENTRACION` filas base o más, las 10 mayores son `UMBRAL_CONCENTRACION_TOP10` o más del año siguiente,
 * o una sola es `UMBRAL_FILA_DOMINANTE` o más. `filasBase` = pares línea × agrupación de marca del recorte con algo proyectado en el año siguiente.
 */
export function alertaConcentracion(mayores: TableroProyeccionSql["mayores"], filasBase: number, totalSiguiente: number, anioSiguiente: number): AlertaApi[] {
  if (filasBase < MIN_FILAS_CONCENTRACION || !(totalSiguiente > 0) || mayores.length === 0) return [];
  const top = mayores.slice(0, FILAS_MAYORES).reduce((a, m) => a + m.Y1, 0) / totalSiguiente;
  const primera = mayores[0].Y1 / totalSiguiente;
  if (top < UMBRAL_CONCENTRACION_TOP10 && primera < UMBRAL_FILA_DOMINANTE) return [];
  return [
    alerta(
      "concentracion",
      "importante",
      "recorte",
      `${anioSiguiente} está concentrado en pocas filas`,
      `Las ${Math.min(FILAS_MAYORES, mayores.length)} filas mayores son el ${Math.round(top * 100)} % de ${anioSiguiente}; una sola, el ${Math.round(primera * 100)} %.`,
      { top10: top, primera, filas: filasBase },
      ENLACE_PROYECCION
    ),
  ];
}

export function alertaMetodoAnterior(versionMetodo: number | null): AlertaApi[] {
  if (versionMetodo !== null && versionMetodo >= VERSION_METODO) return [];
  return [
    alerta(
      "metodo_anterior",
      "importante",
      "proyeccion",
      "Calculada con un método anterior",
      versionMetodo === null ? "Calculada con un método anterior: sin base corregida del Niño. Recalcúlala para verla con el método vigente." : `Calculada con el método ${versionMetodo}: sin base corregida del Niño.`,
      { version_metodo: versionMetodo ?? "", version_vigente: VERSION_METODO },
      ENLACE_PROYECCION
    ),
  ];
}

export function alertaSinCurva(sinMeses: number, anioSiguiente: number): AlertaApi[] {
  if (!(sinMeses > 0)) return [];
  return [alerta("sin_curva", "importante", "recorte", "Hay unidades sin reparto mensual", `${miles(sinMeses)} u de ${anioSiguiente} sin reparto mensual: suman al total, no al gráfico.`, { u: sinMeses }, ENLACE_PROYECCION)];
}

export function alertasCambios(conteos: { propuesta_cambio: number; curva_cambio: number }): AlertaApi[] {
  const salida: AlertaApi[] = [];
  if (conteos.propuesta_cambio > 0) {
    const n = conteos.propuesta_cambio;
    salida.push(alerta("propuesta_cambio", "info", "proyeccion", "La propuesta cambió después de decidir", `${miles(n)} ${n === 1 ? "fila decidida cuya propuesta cambió" : "filas decididas cuya propuesta cambió"} al recalcular.`, { n }, ENLACE_PROYECCION));
  }
  if (conteos.curva_cambio > 0) {
    const n = conteos.curva_cambio;
    salida.push(alerta("curva_cambio", "info", "proyeccion", "Hay curvas nuevas sin aplicar", `${miles(n)} ${n === 1 ? "fila tiene" : "filas tienen"} una curva nueva propuesta que todavía no se aplicó a su reparto mensual.`, { n }, ENLACE_PROYECCION));
  }
  return salida;
}

/** `datos_mas_nuevos`: hay venta publicada posterior al mes con que se calculó la proyección. */
export function alertaDatosMasNuevos(hastaPeriodo: string, ultimoPublicado: string | null): AlertaApi[] {
  if (ultimoPublicado === null || ultimoPublicado <= hastaPeriodo) return [];
  return [
    alerta(
      "datos_mas_nuevos",
      "info",
      "proyeccion",
      "Hay venta más reciente que la proyección",
      `Hay ${mesAnio(ultimoPublicado)} publicado y esta proyección se calculó con datos hasta ${mesAnio(hastaPeriodo)}: el gráfico muestra su real junto al proyectado.`,
      { hasta_periodo: hastaPeriodo, ultimo_publicado: ultimoPublicado },
      ENLACE_VENTA
    ),
  ];
}

export function alertaMesesFaltantes(faltantes: readonly string[]): AlertaApi[] {
  if (faltantes.length === 0) return [];
  const anios = [...new Set(faltantes.map((m) => m.slice(0, 4)))];
  return [
    alerta(
      "meses_faltantes",
      "importante",
      "recorte",
      "Faltan cargas de venta",
      `${faltantes.length === 1 ? "Falta" : "Faltan"} ${lista(faltantes.map(mesAnio))}: ${lista(anios)} ${anios.length === 1 ? "está incompleto" : "están incompletos"}.`,
      { meses: faltantes.join(","), n: faltantes.length },
      ENLACE_VENTA
    ),
  ];
}

export type DatosAtribucion = {
  anio: number;
  k: number;
  /** Tiendas elegidas de la base del año siguiente (código, participación anual en la base y su participación de cada mes del año de referencia). */
  tiendas: readonly { codigo: string; participacion_anual: number; participacion_mes: readonly (number | null)[] }[];
  /** Tiendas elegidas que salen de la base (cierran el año siguiente): su año en curso es su parte de lo que la base resta. */
  salen: readonly { codigo: string; u: number }[];
  sinAtribuir: { en_curso: number; siguiente: number };
  filasSinB: boolean;
  mensual: boolean;
};

/** `atribucion_estimada` (informativa) y `atribucion_sin_mensual` (importante), §3.4 D y E. */
export function alertasAtribucion(d: DatosAtribucion): AlertaApi[] {
  const salida: AlertaApi[] = [];
  const S = d.anio + 1;
  const notas = d.tiendas.slice(0, 5).map((t) => {
    const conDato = t.participacion_mes.map((x, i) => ({ x, i })).filter((p): p is { x: number; i: number } => p.x !== null);
    if (conDato.length === 0) return `${t.codigo}: ${S} estimado con su parte de la base ${d.anio} (${parte(t.participacion_anual)}), la misma en todos los meses (no tiene un año completo de historia)`;
    const menor = conDato.reduce((a, b) => (b.x < a.x ? b : a));
    const mayor = conDato.reduce((a, b) => (b.x > a.x ? b : a));
    return `${t.codigo}: ${S} estimado con su parte de la base ${d.anio} (${parte(t.participacion_anual)}) y, mes a mes, con su participación de cada mes de ${d.anio - 1} (de ${parte(menor.x)} en ${rangoMeses(menor.i + 1, menor.i + 1)} a ${parte(mayor.x)} en ${rangoMeses(mayor.i + 1, mayor.i + 1)})`;
  });
  const notasSalen = d.salen.slice(0, 5).map((t) => `${t.codigo}: su ${d.anio} es estimado (su parte de lo que sale de la base de ${S}: ${miles(t.u)} u); su ${S}, hasta el cierre, es exacto`);
  const todas = [...notas, ...notasSalen];
  const partes = [
    todas.length > 0 ? `${todas.join(". ")}.` : `Las cifras de mismas tiendas por tienda son estimadas: la proyección no se guarda por tienda y se reparte con la venta de ${d.anio} de cada una.`,
    d.filasSinB ? `Hay filas proyectadas por otro método: lo que no forma la base de ${S} queda sin atribuir.` : null,
    d.sinAtribuir.en_curso !== 0 || d.sinAtribuir.siguiente !== 0
      ? `Sin atribuir a ninguna tienda: ${conSigno(d.sinAtribuir.en_curso)} u en ${d.anio} y ${conSigno(d.sinAtribuir.siguiente)} u en ${S}.`
      : null,
  ].filter((x): x is string => x !== null);
  salida.push(alerta("atribucion_estimada", "info", "recorte", "Cifras por tienda estimadas", partes.join(" "), { sin_atribuir_en_curso: d.sinAtribuir.en_curso, sin_atribuir_siguiente: d.sinAtribuir.siguiente }, null));
  if (!d.mensual) {
    salida.push(
      alerta(
        "atribucion_sin_mensual",
        "importante",
        "recorte",
        "Sin reparto mensual por tienda",
        `El real de ${rangoMeses(1, d.k)} cambió desde el cálculo (o la base quedó por debajo de lo vendido): el reparto mensual por tienda de ${rangoMeses(Math.min(12, d.k + 1), 12)} no se puede hacer; el total anual sí.`,
        { k: d.k },
        ENLACE_PROYECCION
      )
    );
  }
  return salida;
}

/** `marca_estimada` (informativa): con filtro o desglose de marca lo proyectado es estimado con `por_marca` de cada fila. */
export function alertaMarcaEstimada(o: { nombre: string | null; sinParticipacion: { Y: number; Y1: number } | null; proyectado: number }): AlertaApi[] {
  const quien = o.nombre ? `Unidad de marca ${o.nombre}` : "Por marca";
  const sin = o.sinParticipacion ? o.sinParticipacion.Y + o.sinParticipacion.Y1 : 0;
  const base =
    o.proyectado === 0 && sin > 0
      ? `${quien}: la proyección no trae participación por marca.`
      : `${quien}: lo proyectado es estimado con su participación de los últimos 12 meses en cada fila. Una marca nueva, en liquidación o al barrer puede estar sobre o subestimada.`;
  return [alerta("marca_estimada", "info", "recorte", "Cifras por marca estimadas", sin > 0 ? `${base} ${miles(sin)} u de filas sin participación por marca quedan fuera.` : base, { sin_participacion: sin }, null)];
}

export function alertaComparadaDistintaK(hastaMostrada: string, hastaComparada: string | null): AlertaApi[] {
  if (hastaComparada === null || hastaComparada === hastaMostrada) return [];
  return [alerta("comparada_distinta_k", "info", "proyeccion", "La comparada usa otros datos", `La comparada se calculó con datos hasta ${mesAnio(hastaComparada)}.`, { hasta_periodo: hastaComparada }, null)];
}

export function alertaDistintaDeAprobada(d: { identica: boolean; fecha: string; proyeccion_nombre: string; siguiente: { u: number; pct: number | null } } | null, anioSiguiente: number): AlertaApi[] {
  if (d === null || d.identica) return [];
  return [
    alerta(
      "distinta_de_aprobada",
      "info",
      "proyeccion",
      "Difiere de lo último aprobado",
      `Frente a lo aprobado el ${fechaCorta(d.fecha, false)} (${d.proyeccion_nombre}): ${anioSiguiente} ${conSigno(d.siguiente.u)} u${d.siguiente.pct === null ? "" : ` (${pct(d.siguiente.pct)})`}.`,
      { u: d.siguiente.u, pct: d.siguiente.pct ?? "" },
      null
    ),
  ];
}
