import { curvaCambio, detalleCambioCurva } from "./curva-fila";
import { explicar, textoCurva } from "./explicar";
import { UNOS } from "./nino";
import { repartirEntero, repartirResto, soloReales, type ResultadoReparto } from "./reparto";
import { aporteSaliente, proponerSiguiente, type AporteBase } from "./siguiente";
import { fraccionAbierta } from "./cierres-tienda";
import {
  escalarTienda,
  maduroDeVigente,
  mesesCompletos,
  proponerFilaTienda,
  rampaMensual,
  sumaCurva,
  type FilaEscalable,
} from "./tiendas-nuevas";
import {
  claveBaseDe,
  type AvisoFila,
  type CurvaOrigen,
  type DecisionPrevia,
  type FilaModelo,
  type OrigenDecision,
  type RegistroModelo,
  type TiendaModelo,
} from "./tipos";

/**
 * Registros por año, reparto mensual y decisiones (ficha 07, pasos 2, 4 y 6; reglas 36, 40 a 42). Puro: nada de esto
 * relee la venta; trabaja sobre lo guardado (`FilaModelo`) y por eso corre en milisegundos.
 */

/** Datos de una tienda que el método necesita para explicar y recalcular sin releer M4. */
export type InfoTienda = {
  codigo: string;
  nombre: string;
  fecha_apertura: string | null;
  fecha_cierre: string | null;
  venta_esperada: number | null;
  referente_codigo: string | null;
  /** Rampa propia de la tienda (de `proyeccion_tiendas`); `null` = la de la proyección. */
  rampa?: number[] | null;
};

export type ContextoModelo = {
  /** `Y`. */
  anio: number;
  /** Último mes cerrado, 1 a 12. */
  k: number;
  crecimiento_pct_defecto: number;
  umbral_cola_larga: number;
  rampa_maduracion: readonly number[];
  /** `agrupacion_estacionalidad_id → nombre`, para los textos de curva. */
  nombresCurva: ReadonlyMap<string, string>;
  /** Tiendas en `M(Y+1)` (las nuevas de `Y` entre ellas pasan a la base del año siguiente). */
  mismasSiguiente: ReadonlySet<string>;
  tiendas: ReadonlyMap<string, InfoTienda>;
  /** `g` efectivo de la fila base del año siguiente (por `claveBase`); sin esto, el de la proyección. */
  crecimientoDe?: (claveBase: string) => number;
  /** Nombre de la proyección cerrada usada como plan anterior (para la explicación). */
  planAnteriorNombre?: string | null;
};

// ─── Reparto de un registro ───

export type ContextoReparto = {
  /** Año del registro. */
  anio: number;
  anioEnCurso: number;
  k: number;
  curva: readonly number[] | null;
  curva_origen: CurvaOrigen[];
  phi: readonly number[];
  /** Pesos adicionales por mes (`r_m` de una tienda nueva o `q_m` de un cierre). */
  pesosExtra?: readonly number[];
  /** Real de los primeros `k` meses (año en curso). */
  real: readonly number[] | null;
};

/** Reparte el total vigente en meses: real hasta `k` y resto con `curva × φ × pesosExtra` (año en curso), todo proyectado (siguiente). */
export function repartirVigente(vigente: number | null, ctx: ContextoReparto): ResultadoReparto {
  if (vigente === null || ctx.curva === null) return { meses: null, origen_meses: null };
  if (ctx.anio === ctx.anioEnCurso && ctx.k > 0) {
    return repartirResto(vigente, ctx.real ?? [], ctx.k, ctx.curva, ctx.phi, ctx.pesosExtra);
  }
  const pesos = ctx.curva.map((c, i) => c * (ctx.phi[i] ?? 1) * (ctx.pesosExtra?.[i] ?? 1));
  const meses = repartirEntero(vigente, pesos);
  return { meses, origen_meses: meses === null ? null : meses.map(() => "proyectado" as const) };
}

/** Lo que sale del método para un registro, antes de aplicar la decisión previa. */
export type BaseRegistro = Pick<
  RegistroModelo,
  | "anio"
  | "bloque"
  | "subbloque"
  | "vendido"
  | "propuesto"
  | "metodo"
  | "referencia_alternativa"
  | "referencia_tres_meses"
  | "explicacion"
  | "avance"
  | "avisos"
> & { crecimiento_pct?: number | null };

const iguales = (a: readonly number[] | null, b: readonly number[] | null): boolean =>
  a !== null && b !== null && a.length === b.length && a.every((v, i) => v === b[i]);

/** ¿El reparto guardado de una cifra decidida sigue siendo válido (misma suma y, en el año en curso, el mismo real)? */
function mesesGuardadosValidos(guardados: readonly number[] | null, vigente: number | null, ctx: ContextoReparto): guardados is number[] {
  if (guardados === null || guardados.length !== 12 || vigente === null) return false;
  if (guardados.reduce((a, b) => a + b, 0) !== Math.round(vigente)) return false;
  if (ctx.anio === ctx.anioEnCurso && ctx.k > 0) {
    const real = ctx.real ?? [];
    for (let i = 0; i < ctx.k; i++) if (guardados[i] !== Math.round(real[i] ?? 0)) return false;
  }
  return true;
}

/**
 * Arma el registro de un año: aplica la decisión previa (si la hay) y reparte el total vigente. Reglas 41 y I8:
 *   - el total decidido y sus datos sobreviven siempre;
 *   - si el registro decidido usó otra versión de curva, conserva `meses` y `curva_origen_usada` y guarda el reparto
 *     con la curva vigente en `meses_propuestos` hasta que el planner lo aplique;
 *   - `propuesta_cambio` si la propuesta de hoy difiere de la que vio al decidir.
 */
export function armarRegistro(base: BaseRegistro, previa: DecisionPrevia | null | undefined, ctx: ContextoReparto): RegistroModelo {
  const decidido = previa?.decidido ?? null;
  const vigente = decidido ?? base.propuesto;
  const nuevo = repartirVigente(vigente, ctx);

  let meses = nuevo.meses;
  let curvaUsada = ctx.curva_origen;
  let mesesPropuestos: number[] | null = null;
  let curvaPropuesta: CurvaOrigen[] | null = null;
  const avisos: AvisoFila[] = [...base.avisos];

  if (previa && decidido !== null) {
    if (curvaCambio(previa.curva_origen_usada, ctx.curva_origen) && mesesGuardadosValidos(previa.meses, vigente, ctx)) {
      if (!iguales(previa.meses, nuevo.meses)) {
        meses = previa.meses;
        curvaUsada = previa.curva_origen_usada;
        mesesPropuestos = nuevo.meses;
        curvaPropuesta = ctx.curva_origen;
        if (!avisos.includes("curva_cambio")) avisos.push("curva_cambio");
      }
    }
    if (previa.propuesta_al_decidir !== base.propuesto && !avisos.includes("propuesta_cambio")) avisos.push("propuesta_cambio");
  }

  return {
    anio: base.anio,
    bloque: base.bloque,
    subbloque: base.subbloque,
    vendido: base.vendido,
    propuesto: base.propuesto,
    metodo: base.metodo,
    referencia_alternativa: base.referencia_alternativa,
    referencia_tres_meses: base.referencia_tres_meses,
    explicacion: base.explicacion,
    crecimiento_pct: previa?.crecimiento_pct ?? base.crecimiento_pct ?? null,
    decidido,
    origen: decidido === null ? null : (previa?.origen ?? "manual"),
    propuesta_al_decidir: decidido === null ? null : (previa?.propuesta_al_decidir ?? base.propuesto),
    vigente,
    nota: previa?.nota ?? null,
    decidido_por_nombre: previa?.decidido_por_nombre ?? null,
    decidido_at: previa?.decidido_at ?? null,
    meses,
    meses_propuestos: mesesPropuestos,
    origen_meses: nuevo.origen_meses,
    avance: base.avance,
    avisos,
    curva_origen_usada: curvaUsada,
    curva_origen_propuesta: curvaPropuesta,
  };
}

export const registroDe = (fila: FilaModelo, anio: number): RegistroModelo | undefined => fila.registros.find((r) => r.anio === anio);

function sustituirRegistro(fila: FilaModelo, registro: RegistroModelo): FilaModelo {
  const otros = fila.registros.filter((r) => r.anio !== registro.anio);
  return { ...fila, registros: [...otros, registro].sort((a, b) => a.anio - b.anio) };
}

/** `ContextoReparto` de un registro de una fila ya guardada. */
export function contextoDeReparto(fila: FilaModelo, anio: number, ctx: ContextoModelo, pesosExtra?: readonly number[]): ContextoReparto {
  const registro = registroDe(fila, anio);
  return {
    anio,
    anioEnCurso: ctx.anio,
    k: anio === ctx.anio ? ctx.k : 0,
    curva: fila.curva,
    curva_origen: fila.curva_origen,
    phi: fila.factores_mes?.[anio] ?? UNOS,
    pesosExtra,
    // El real del año en curso es la parte `≤ k` del reparto guardado.
    real: registro?.meses ? soloReales(registro.meses, ctx.k) : null,
  };
}

// ─── Año siguiente de una fila base (B2) ───

const textoCurvaFila = (fila: FilaModelo, nombres: ReadonlyMap<string, string>): string | null =>
  textoCurva(fila.curva_origen.map((o) => ({ nombre: nombres.get(o.agrupacion_id) ?? "curva", version: o.version, peso: o.peso })));

/**
 * Regla 12 a 14 (B2). Recalcula la propuesta del año siguiente de una fila base sobre lo guardado: la base es lo
 * vigente de `Y` de la fila más lo vigente de `Y` de las tiendas nuevas de `Y` que pasan a `M(Y+1)` menos el aporte de
 * las tiendas de `M(Y)` que salen de `M(Y+1)`. Conserva la decisión de `Y+1` (queda con `propuesta_cambio` si la
 * propuesta se movió). `previa` por defecto es lo guardado en el registro de `Y+1`.
 */
export function recalcularBaseSiguiente(
  base: FilaModelo,
  tiendasDeLaFila: readonly FilaModelo[],
  ctx: ContextoModelo,
  previa?: DecisionPrevia | null
): FilaModelo {
  const regY = registroDe(base, ctx.anio);
  if (!regY || base.tienda_id !== null) return base;
  const anioSig = ctx.anio + 1;
  const existente = registroDe(base, anioSig);
  const anterior: DecisionPrevia | null =
    previa !== undefined
      ? previa
      : existente
        ? {
            decidido: existente.decidido,
            origen: existente.origen,
            nota: existente.nota,
            propuesta_al_decidir: existente.propuesta_al_decidir,
            crecimiento_pct: existente.crecimiento_pct,
            decidido_por_nombre: existente.decidido_por_nombre,
            decidido_at: existente.decidido_at,
            meses: existente.meses,
            curva_origen_usada: existente.curva_origen_usada,
          }
        : null;

  const phiY = base.factores_mes?.[ctx.anio] ?? UNOS;
  const phiSig = base.factores_mes?.[anioSig] ?? UNOS;
  const aportes: AporteBase[] = [];
  const detalleAportes: { tienda: string; total: number; signo: 1 | -1 }[] = [];

  for (const f of tiendasDeLaFila) {
    if (f.tienda_id === null || !ctx.mismasSiguiente.has(f.tienda_id)) continue;
    const r = registroDe(f, ctx.anio);
    if (!r || r.bloque !== "nuevas") continue;
    aportes.push({ signo: 1, total: r.vigente, meses: r.meses });
    if (r.vigente !== null) detalleAportes.push({ tienda: ctx.tiendas.get(f.tienda_id)?.codigo ?? f.tienda_id, total: r.vigente, signo: 1 });
  }
  const cierreBase = regY.propuesto ?? regY.decidido;
  for (const s of base.historico?.salientes ?? []) {
    const total = aporteSaliente({ cierreBase, vendidoBase: regY.vendido, vendidoTienda: s.vendido });
    const meses = base.curva ? (repartirResto(total, s.meses, ctx.k, base.curva, phiY).meses ?? null) : null;
    aportes.push({ signo: -1, total, meses });
    if (total > 0) detalleAportes.push({ tienda: ctx.tiendas.get(s.tienda_id)?.codigo ?? s.tienda_id, total, signo: -1 });
  }

  const g = anterior?.crecimiento_pct ?? ctx.crecimientoDe?.(claveBaseDe(base.clave)) ?? ctx.crecimiento_pct_defecto;
  const resultado = proponerSiguiente({
    baseVigente: regY.vigente,
    mesesBase: regY.meses,
    aportesTiendas: aportes,
    factoresMesEnCurso: phiY,
    crecimiento: g,
    curva: base.curva,
    factoresMesObjetivo: phiSig,
  });

  const avisos: AvisoFila[] = [...resultado.avisos];
  for (const a of base.avisos) if (a === "objetivo_atipico" || a === "sin_factor") if (!avisos.includes(a)) avisos.push(a);
  if (resultado.propuesto !== null && resultado.propuesto < ctx.umbral_cola_larga) avisos.push("cola_larga");

  const explicacion = explicar({
    metodo: resultado.metodo,
    anio: anioSig,
    anioEnCurso: ctx.anio,
    k: 0,
    vendido: 0,
    propuesto: resultado.propuesto,
    curvaTexto: textoCurvaFila(base, ctx.nombresCurva),
    phi: phiY,
    phiObjetivo: phiSig,
    baseVigente: regY.vigente,
    baseTotal: resultado.base,
    baseNormalizada: resultado.base_normalizada,
    crecimiento: g,
    aportes: detalleAportes,
  });

  const registro = armarRegistro(
    {
      anio: anioSig,
      bloque: "mismas",
      subbloque: null,
      vendido: 0,
      propuesto: resultado.propuesto,
      metodo: resultado.metodo,
      referencia_alternativa: null,
      referencia_tres_meses: null,
      explicacion,
      avance: null,
      avisos,
      crecimiento_pct: null,
    },
    anterior,
    {
      anio: anioSig,
      anioEnCurso: ctx.anio,
      k: 0,
      curva: base.curva,
      curva_origen: base.curva_origen,
      phi: phiSig,
      real: null,
    }
  );
  return sustituirRegistro(base, registro);
}

// ─── Decisión sobre una fila base ───

export type DecisionEntrada = {
  /** `null` = volver a la propuesta. */
  decidido: number | null;
  origen: "propuesta" | "manual";
  nota?: string | null;
  /** Solo año siguiente, fila base: sustituye al crecimiento de la proyección en la propuesta. */
  crecimiento_pct?: number | null;
  decidido_por_nombre?: string | null;
  decidido_at?: string | null;
};

/**
 * Regla 41. Aplica una decisión sobre una fila base y un año sin releer venta: no cambia `propuesto`, `historico` ni
 * `curva`; recalcula `meses` y, si es `Y` y bloque `mismas`, la propuesta de `Y+1` de la misma fila (B2). Con
 * `origen = propuesta` copia `propuesto` e ignora `decidido`. Si no hay propuesta, `origen = propuesta` no tiene
 * sentido (lo rechaza `motivoRechazoDecision`).
 */
export function aplicarDecision(
  fila: FilaModelo,
  tiendasDeLaFila: readonly FilaModelo[],
  anio: number,
  decision: DecisionEntrada,
  ctx: ContextoModelo
): FilaModelo {
  const registro = registroDe(fila, anio);
  if (!registro) return fila;
  const decidido =
    decision.decidido === null ? null : decision.origen === "propuesta" ? registro.propuesto : Math.max(0, Math.round(decision.decidido));
  const previa: DecisionPrevia = {
    decidido,
    origen: decidido === null ? null : decision.origen,
    nota: decidido === null ? null : (decision.nota ?? null),
    propuesta_al_decidir: decidido === null ? null : registro.propuesto,
    crecimiento_pct: decision.crecimiento_pct === undefined ? registro.crecimiento_pct : decision.crecimiento_pct,
    decidido_por_nombre: decidido === null ? null : (decision.decidido_por_nombre ?? null),
    decidido_at: decidido === null ? null : (decision.decidido_at ?? null),
    // Al decidir de nuevo el reparto sale con la curva vigente: la decisión es explícita sobre esta curva.
    meses: null,
    curva_origen_usada: fila.curva_origen,
  };
  const sinAvisosDeDecision = registro.avisos.filter((a) => a !== "curva_cambio" && a !== "propuesta_cambio");
  const nuevo = armarRegistro(
    { ...registro, avisos: sinAvisosDeDecision },
    previa,
    contextoDeReparto(fila, anio, ctx)
  );
  let resultado = sustituirRegistro(fila, nuevo);
  if (anio === ctx.anio && fila.tienda_id === null) {
    resultado = recalcularBaseSiguiente(resultado, tiendasDeLaFila, ctx);
  } else if (anio === ctx.anio + 1 && fila.tienda_id === null && decision.crecimiento_pct !== undefined) {
    // Cambió el crecimiento de la fila: la propuesta de Y+1 se rehace con él (la decisión, si hay, se conserva).
    resultado = recalcularBaseSiguiente(resultado, tiendasDeLaFila, ctx);
  }
  return resultado;
}

/**
 * Regla 42. Copia `meses_propuestos` → `meses` y `curva_origen_propuesta` → `curva_origen_usada`, y deja
 * `meses_propuestos = null`. Un registro sin `meses_propuestos` queda igual. (Sobre una cerrada es `409`: eso lo
 * decide el handler con `motivoRechazoDecision`.)
 */
export function aplicarCurvaNueva(registro: RegistroModelo): RegistroModelo {
  if (registro.meses_propuestos === null) return registro;
  return {
    ...registro,
    meses: registro.meses_propuestos,
    meses_propuestos: null,
    curva_origen_usada: registro.curva_origen_propuesta ?? registro.curva_origen_usada,
    curva_origen_propuesta: null,
    avisos: registro.avisos.filter((a) => a !== "curva_cambio"),
  };
}

/** Texto "HO INVIERNO v2 → v3" del cambio de curva de un registro. */
export function textoCambioCurva(registro: RegistroModelo, nombres: ReadonlyMap<string, string>): string | null {
  if (!registro.curva_origen_propuesta) return null;
  const partes = detalleCambioCurva(registro.curva_origen_usada, registro.curva_origen_propuesta, nombres);
  return partes.length > 0 ? partes.join(", ") : null;
}

// ─── Tiendas nuevas y cierres: recalcular y decidir ───

function rampaDeTienda(info: InfoTienda | undefined, rampa: readonly number[] | null, ctx: ContextoModelo): number[] {
  return [...(rampa ?? info?.rampa ?? ctx.rampa_maduracion)].map(Number);
}

/** `r_m` (nueva) o `q_m` (cierre) de una tienda en un año. */
export function pesosDeTienda(info: InfoTienda | undefined, bloque: "nuevas" | "cierres", rampa: readonly number[], anio: number): number[] {
  if (!info) return Array.from({ length: 12 }, () => 1);
  if (bloque === "cierres") return info.fecha_cierre ? fraccionAbierta(info.fecha_cierre, anio) : Array.from({ length: 12 }, () => 1);
  return info.fecha_apertura ? rampaMensual(info.fecha_apertura, rampa, anio) : Array.from({ length: 12 }, () => 1);
}

/**
 * Rehace las propuestas de los registros de UNA tienda y un año sobre lo guardado (sin releer venta), con la rampa
 * indicada: lo usa "cambiar la rampa de la tienda". Conserva las decisiones por fila (cifras fijadas) y el total de la
 * tienda se vuelve a escalar en `aplicarDecisionTienda`.
 */
export function recalcularFilasTienda(
  filas: readonly FilaModelo[],
  anio: number,
  rampa: readonly number[] | null,
  ctx: ContextoModelo
): FilaModelo[] {
  return filas.map((fila) => {
    const registro = registroDe(fila, anio);
    if (!registro || fila.tienda_id === null || registro.bloque === "cierres") return fila;
    const info = ctx.tiendas.get(fila.tienda_id);
    const rampaUsada = rampaDeTienda(info, rampa, ctx);
    const r = pesosDeTienda(info, "nuevas", rampaUsada, anio);
    const phi = fila.factores_mes?.[anio] ?? UNOS;
    const esY = anio === ctx.anio;
    const real = registro.meses ? soloReales(registro.meses, ctx.k) : Array.from({ length: 12 }, () => 0);

    const regY = registroDe(fila, ctx.anio);
    let maduroPrevio: number | null = null;
    if (!esY && registro.subbloque === "nuevas_anterior" && regY && info) {
      const rY = pesosDeTienda(info, "nuevas", rampaUsada, ctx.anio);
      maduroPrevio = maduroDeVigente({ vigente: regY.vigente, curva: fila.curva, rampa: rY, phi: fila.factores_mes?.[ctx.anio] ?? UNOS });
    }
    const g = ctx.crecimientoDe?.(claveBaseDe(fila.clave)) ?? ctx.crecimiento_pct_defecto;
    const resultado = proponerFilaTienda({
      esAnioEnCurso: esY,
      k: esY ? ctx.k : 0,
      subbloque: registro.subbloque ?? "aperturas",
      nCompletos: info?.fecha_apertura ? mesesCompletos(info.fecha_apertura, ctx.anio, ctx.k) : 0,
      real,
      curva: fila.curva,
      rampa: r,
      phi,
      maduras: fila.composicion?.unidades_maduras ?? (info?.venta_esperada == null ? null : 0),
      maduroPrevio,
      crecimiento: g,
    });
    const nuevoRegistro = armarRegistro(
      {
        ...registro,
        vendido: resultado.vendido,
        propuesto: resultado.propuesto,
        metodo: resultado.metodo,
        referencia_alternativa: resultado.referencia_alternativa,
        referencia_tres_meses: resultado.referencia_tres_meses,
        avisos: resultado.avisos,
      },
      // La cifra fijada a mano de la fila sobrevive; la escalada se rehace con el total de la tienda.
      registro.origen === "manual" && registro.decidido !== null
        ? {
            decidido: registro.decidido,
            origen: "manual",
            nota: registro.nota,
            propuesta_al_decidir: registro.propuesta_al_decidir,
            crecimiento_pct: null,
            decidido_por_nombre: registro.decidido_por_nombre,
            decidido_at: registro.decidido_at,
            meses: null,
            curva_origen_usada: fila.curva_origen,
          }
        : null,
      contextoDeReparto(fila, anio, ctx, r)
    );
    return sustituirRegistro(fila, nuevoRegistro);
  });
}

export type ResultadoDecisionTienda = {
  filas: FilaModelo[];
  tienda: Pick<TiendaModelo, "vendido" | "propuesto" | "decidido" | "origen" | "propuesta_al_decidir" | "nota" | "avisos" | "rampa">;
  /** Claves base (GML-AM) cuya propuesta de `Y+1` hay que rehacer (B2): la tienda de `Y` pasa a `M(Y+1)`. */
  clavesBaseAfectadas: string[];
  /** Cuántas filas base cambiarán (lo que informa la respuesta). */
  filas_base_recalculadas: number;
};

/**
 * Regla 23 y B2. Decisión de la tienda `t` en un año: `decidido = null` vuelve a la propuesta. Reescala sus filas no
 * fijadas (`origen = escalada`); si es el año en curso rehace el año siguiente de sus filas (`maduro_propio`) y devuelve
 * las claves de las filas base cuya propuesta de `Y+1` debe recalcularse (`recalcularBaseSiguiente`).
 */
export function aplicarDecisionTienda(args: {
  filas: readonly FilaModelo[];
  tiendaId: string;
  anio: number;
  decision: {
    decidido: number | null;
    origen: "propuesta" | "manual";
    nota?: string | null;
    rampa?: readonly number[] | null;
    decidido_por_nombre?: string | null;
    decidido_at?: string | null;
  };
  ctx: ContextoModelo;
}): ResultadoDecisionTienda {
  const { tiendaId, anio, decision, ctx } = args;
  let filas = args.filas.filter((f) => f.tienda_id === tiendaId);

  // 1. Rampa nueva: se rehacen las propuestas de ese año (y del siguiente, que depende de lo vigente de `Y`).
  if (decision.rampa) {
    filas = recalcularFilasTienda(filas, ctx.anio, decision.rampa, ctx);
    filas = recalcularFilasTienda(filas, ctx.anio + 1, decision.rampa, ctx);
  }

  // 2. Total de la tienda: escalar las filas no fijadas.
  const conRegistro = filas.filter((f) => registroDe(f, anio));
  const propuestoTotal = conRegistro.reduce((s, f) => s + (registroDe(f, anio)?.propuesto ?? 0), 0);
  const hayPropuesta = conRegistro.some((f) => registroDe(f, anio)?.propuesto !== null);
  const total = hayPropuesta ? propuestoTotal : null;
  const decidido = decision.decidido === null ? null : decision.origen === "propuesta" ? total : Math.max(0, Math.round(decision.decidido));
  const avisosTienda: AvisoFila[] = [];

  let nuevas = filas;
  if (decidido === null) {
    nuevas = filas.map((fila) => {
      const r = registroDe(fila, anio);
      if (!r) return fila;
      if (r.origen === "escalada") {
        const limpio = armarRegistro({ ...r, avisos: r.avisos.filter((a) => a !== "propuesta_cambio") }, null, contextoDeReparto(fila, anio, ctx, pesosDeFila(fila, anio, ctx)));
        return sustituirRegistro(fila, limpio);
      }
      return fila;
    });
  } else {
    const escalables: FilaEscalable[] = conRegistro.map((f) => {
      const r = registroDe(f, anio) as RegistroModelo;
      return {
        id: f.clave,
        propuesto: r.propuesto,
        fijada: r.origen === "manual" && r.decidido !== null ? r.decidido : null,
        peso: f.composicion?.s ?? 0,
      };
    });
    const { asignado, escaladas, avisos } = escalarTienda(escalables, decidido);
    avisosTienda.push(...avisos);
    nuevas = filas.map((fila) => {
      const r = registroDe(fila, anio);
      if (!r || !asignado.has(fila.clave)) return fila;
      const valor = asignado.get(fila.clave) as number;
      const esEscalada = escaladas.has(fila.clave);
      const previa: DecisionPrevia = {
        decidido: valor,
        origen: esEscalada ? "escalada" : "manual",
        nota: r.nota,
        propuesta_al_decidir: esEscalada ? r.propuesto : r.propuesta_al_decidir,
        crecimiento_pct: null,
        decidido_por_nombre: decision.decidido_por_nombre ?? r.decidido_por_nombre,
        decidido_at: decision.decidido_at ?? r.decidido_at,
        meses: null,
        curva_origen_usada: fila.curva_origen,
      };
      const nuevo = armarRegistro({ ...r, avisos: r.avisos.filter((a) => a !== "curva_cambio" && a !== "propuesta_cambio") }, previa, contextoDeReparto(fila, anio, ctx, pesosDeFila(fila, anio, ctx)));
      return sustituirRegistro(fila, nuevo);
    });
  }

  // 3. La decisión de `Y` de una tienda nueva que pasa a `M(Y+1)` alimenta la base del año siguiente (B2).
  const clavesBaseAfectadas: string[] = [];
  if (anio === ctx.anio) {
    // El año siguiente de la propia tienda (maduro_propio) depende de lo vigente de `Y`.
    nuevas = recalcularFilasTienda(nuevas, ctx.anio + 1, decision.rampa ?? null, ctx);
    if (ctx.mismasSiguiente.has(tiendaId)) {
      for (const fila of nuevas) if (registroDe(fila, ctx.anio)?.bloque === "nuevas") clavesBaseAfectadas.push(claveBaseDe(fila.clave));
    }
  }

  const registros = nuevas.map((f) => registroDe(f, anio)).filter((r): r is RegistroModelo => r !== undefined);
  const vendido = registros.reduce((s, r) => s + r.vendido, 0);
  const propuesto = registros.some((r) => r.propuesto !== null) ? registros.reduce((s, r) => s + (r.propuesto ?? 0), 0) : null;
  return {
    filas: nuevas,
    tienda: {
      vendido,
      propuesto,
      decidido,
      origen: decidido === null ? null : decision.origen,
      propuesta_al_decidir: decidido === null ? null : propuesto,
      nota: decidido === null ? null : (decision.nota ?? null),
      avisos: avisosTienda,
      rampa: rampaDeTienda(ctx.tiendas.get(tiendaId), decision.rampa ?? null, ctx),
    },
    clavesBaseAfectadas: [...new Set(clavesBaseAfectadas)],
    filas_base_recalculadas: new Set(clavesBaseAfectadas).size,
  };
}

function pesosDeFila(fila: FilaModelo, anio: number, ctx: ContextoModelo): number[] | undefined {
  if (fila.tienda_id === null) return undefined;
  const r = registroDe(fila, anio);
  if (!r || (r.bloque !== "nuevas" && r.bloque !== "cierres")) return undefined;
  return pesosDeTienda(ctx.tiendas.get(fila.tienda_id), r.bloque, rampaDeTienda(ctx.tiendas.get(fila.tienda_id), null, ctx), anio);
}

export { sumaCurva };
export type { OrigenDecision };
