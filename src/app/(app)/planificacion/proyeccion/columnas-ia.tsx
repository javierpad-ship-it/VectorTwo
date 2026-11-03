"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatearNumero } from "@/lib/formato";
import {
  UMBRAL_BRECHA_CEDE_PCT,
  UMBRAL_BRECHA_FORZADA_PCT,
  UMBRAL_BRECHA_MUY_FORZADA_PCT,
  type AvisoIa,
  type BanderaIa,
  type EstadoMetaFila,
  type EstadoPropuestaGM,
  type IaFilaApi,
  type MotivoDesactualizadaIa,
  type SenalIa,
} from "@/lib/ia/tipos-api";
import type { DecisionIaApi } from "@/lib/proyeccion/tipos-api";
import { NUM } from "./comunes";
import { formatearPct, unidades } from "./vista";

/**
 * Lo que la IA añade a Por línea y al detalle de la fila (07e §4.2 y §4.3). Nada de esto se pinta sin una propuesta vigente del GM: sin ella, o con
 * la IA apagada, la pantalla queda como antes. Todos los textos que escribe la IA (razones, banderas) se pintan SIEMPRE como texto de React:
 * nunca HTML ni markdown. Los números salen del servidor (`asignarMeta` al leer): aquí solo se muestran.
 */

/** Cuántas columnas añade la IA a la tabla de filas de Por línea (Natural IA, IA con meta, Absorbido, Brecha). */
export const COLUMNAS_IA = 4;

// ─── Formato ───

/** `+661`, `-309`, `0`: entero con signo explícito y miles es-PE. */
export function signado(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${formatearNumero(r)}` : r < 0 ? `-${formatearNumero(-r)}` : "0";
}

/** `+661 u (+6.4 %)`; sin porcentaje, solo las unidades. */
export function textoUPct(u: number | null, pct: number | null): string {
  if (u === null) return "—";
  return pct === null ? `${signado(u)} u` : `${signado(u)} u (${formatearPct(pct)})`;
}

/** `dd/mm/aaaa` de una fecha ISO (sin pasar por zonas horarias: la fecha que escribió el servidor). `—` si no es una fecha. */
export function fechaCorta(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

const PROVEEDORES: Record<string, string> = { openai: "OpenAI", anthropic: "Claude" };
export const nombreProveedor = (id: string): string => PROVEEDORES[id] ?? id;

// ─── Etiquetas ───

export const ETIQUETA_META_FILA: Record<EstadoMetaFila, string | null> = {
  libre: null,
  // 07g: aprobada en bloque con IA: para repartir sigue libre (se muestra la cifra IA de hoy); `aceptable` ya la deshabilita.
  libre_en_bloque: null,
  fija_decidida: "fija: decidida",
  fija_pct: "fija: % propio",
  fija_cola_larga: "fija: cola larga",
  sin_base: "sin base",
};

export const ETIQUETA_ESTADO_GM: Record<EstadoPropuestaGM, string> = {
  sin_propuesta: "sin propuesta",
  sin_filas_libres: "sin filas libres",
  al_dia: "al día",
  meta_movida: "meta movida",
  desactualizada: "desactualizada",
  fallida: "fallida",
  bloqueado_privacidad: "bloqueado por privacidad",
};

export const ETIQUETA_MOTIVO_GM: Record<MotivoDesactualizadaIa, string> = {
  historia_cambiada: "la venta cambió",
  filas_libres_nuevas: "hay filas libres nuevas",
  version_metodo: "cambió la versión del método",
  capacidad_apagada: "la IA está apagada",
};

export const ETIQUETA_BANDERA: Record<BanderaIa, string> = {
  dato_insuficiente: "dato insuficiente",
  linea_nueva: "línea nueva",
  en_salida: "en salida",
  quiebres: "quiebres",
  nino: "Niño",
  volatil: "volátil",
  tiendas_entrantes: "tiendas entrantes",
  meta_exigente: "meta exigente",
  meta_holgada: "meta holgada",
  estacionalidad_atipica: "estacionalidad atípica",
};

export const ETIQUETA_SENAL: Record<SenalIa, string> = {
  dato_insuficiente: "dato insuficiente",
  linea_nueva: "línea nueva",
  quiebres: "quiebres",
  nino: "Niño",
  temporadas_mezcladas: "temporadas mezcladas",
  avance_bajo: "avance bajo",
  plan_anterior: "plan anterior",
  revision_cola_larga: "para revisión (cola larga)",
  tiendas_entrantes: "tiendas entrantes",
  tiendas_salientes: "tiendas salientes",
};

const TEXTO_AVISO_IA: Record<AvisoIa, string> = {
  ia_no_cuadro: "La IA no cuadró la suma: el código repartió la meta con sus cifras como pesos.",
  ia_cifra_excesiva: "La cifra de la IA era excesiva y se descartó: esta fila usa la propuesta del método como peso.",
  brecha_extrema: "La cifra con meta se aparta mucho de la proyección natural.",
  sin_propuesta_ia: "La IA no propuso esta fila: pesa como la propuesta del método.",
  fijadas_exceden_meta: "Las filas fijas ya superan la meta del GM: no hay reparto para las libres.",
  meta_provisional: "La meta del GM es provisional (Resto sin aprobar).",
  base_movida: "La base corregida cambió desde que la IA propuso; regenera el GM si quieres que la tenga en cuenta.",
  meta_movida: "La meta del GM se movió desde que la IA propuso.",
  absorcion_alta: "Esta fila absorbió más del 10 % de su cifra desde que la IA propuso: la cifra ya no es la que la IA razonó.",
  bandera_desconocida: "La IA usó una bandera que no se reconoce.",
  fila_extra: "La IA devolvió una fila que no existe.",
  fila_duplicada: "La IA repitió esta fila.",
  razon_recortada: "La razón de la IA se recortó.",
};
export const textoAvisoIa = (a: AvisoIa): string => TEXTO_AVISO_IA[a] ?? a.replace(/_/g, " ");

/** El aviso que se da (una sola vez) al fijar una fila libre: las demás absorben la diferencia (§4.2). */
export function textoAjusteMeta(gm: string): string {
  return `Las demás filas libres de ${gm} se ajustaron para seguir sumando la meta: mira la columna Absorbido.`;
}

/** El aviso de `409 ia_valor_cambio`: la cifra IA que se vio ya no es la vigente (§4.2). */
export function textoCifraCambio(valorActual: number | null): string {
  const cifra = valorActual === null ? "" : ` a ${formatearNumero(valorActual)}`;
  return `La cifra IA cambió${cifra} porque se fijó otra fila del GM: revisa y acepta de nuevo.`;
}

// ─── Brecha ───

export type TonoBrecha = "muy_forzada" | "forzada" | "cede";

/** «Forzada» desde +10 %, «muy forzada» desde +25 %, «cede» desde −10 % (§4.1); `null` si está en el rango normal o no hay brecha. Pura. */
export function tonoBrecha(pct: number | null): TonoBrecha | null {
  if (pct === null) return null;
  if (pct >= UMBRAL_BRECHA_MUY_FORZADA_PCT) return "muy_forzada";
  if (pct >= UMBRAL_BRECHA_FORZADA_PCT) return "forzada";
  if (pct <= UMBRAL_BRECHA_CEDE_PCT) return "cede";
  return null;
}

/** Solo hay un tono de alerta en el tema: «muy forzada» se distingue por el peso de la letra y por la palabra, «cede» va en el color de marca. */
const CLASE_BRECHA: Record<TonoBrecha, string> = { muy_forzada: "font-bold text-alerta", forzada: "text-alerta", cede: "text-marca-oscura" };
const ETIQUETA_BRECHA: Record<TonoBrecha, string> = { muy_forzada: "muy forzada", forzada: "forzada", cede: "cede" };

// ─── Totales de la línea ───

export type TotalesIa = { filas: number; natural: number; conMeta: number; absorbido: number; brecha_u: number; brecha_pct: number | null };

/** Σ de las filas libres con cifra IA y natural de la línea (las únicas donde la brecha tiene sentido). `null` si no hay ninguna. Pura. */
export function totalesIa(filas: readonly IaFilaApi[]): TotalesIa | null {
  const libres = filas.filter((f) => f.estado_meta === "libre" && f.meta_y1 !== null && f.natural_y1 !== null);
  if (libres.length === 0) return null;
  const natural = libres.reduce((s, f) => s + (f.natural_y1 ?? 0), 0);
  const conMeta = libres.reduce((s, f) => s + (f.meta_y1 ?? 0), 0);
  const absorbido = libres.reduce((s, f) => s + (f.absorbido_u ?? 0), 0);
  return { filas: libres.length, natural, conMeta, absorbido, brecha_u: conMeta - natural, brecha_pct: natural > 0 ? (conMeta / natural - 1) * 100 : null };
}

/** El pie de la línea (§4.2, sin el % de la meta libre del GM: `GET …/ia/filas` no lo trae). */
export function textoPieIa(t: TotalesIa | null): string | null {
  if (!t) return null;
  return `IA en esta línea (${t.filas} ${t.filas === 1 ? "fila libre" : "filas libres"}): con meta ${formatearNumero(t.conMeta)} · natural ${formatearNumero(t.natural)} · brecha ${textoUPct(t.brecha_u, t.brecha_pct)}.`;
}

// ─── Celdas de la tabla ───

const TD = "px-3 py-2";

export function EncabezadosIa({ y }: { y: number }) {
  const TH = "px-3 py-2 font-medium text-right";
  return (
    <>
      <th className={TH} title={`Proyección de ${y + 1} que la IA hizo sin conocer la meta`}>
        Natural IA
      </th>
      <th className={TH} title="Lo que la IA propone para que el género · mundo sume su meta (vigente: las demás filas libres absorben lo que se fije)">
        IA con meta
      </th>
      <th className={TH} title="Cuánto cambió la cifra con meta desde que la IA propuso (las filas libres absorben lo que se fija después)">
        Absorbido
      </th>
      <th className={TH} title="IA con meta menos natural: cuánto fuerza la meta a esta fila. Forzada desde +10 %, muy forzada desde +25 %, cede desde −10 %">
        Brecha
      </th>
    </>
  );
}

/** Las cuatro celdas IA de una fila base. Sin cifras de la IA para la fila (o con la lectura caída): «—». */
export function CeldasIa({ ia }: { ia: IaFilaApi | undefined }) {
  if (!ia) {
    return (
      <>
        {Array.from({ length: COLUMNAS_IA }, (_, i) => (
          <td key={i} className={`${TD} text-center text-tinta-suave`}>
            —
          </td>
        ))}
      </>
    );
  }
  const etiquetaFija = ETIQUETA_META_FILA[ia.estado_meta];
  const libre = etiquetaFija === null;
  const tono = libre ? tonoBrecha(ia.brecha_pct) : null;
  const altaAbsorcion = ia.avisos.includes("absorcion_alta");
  const sinCifra = <span className="text-tinta-suave">—</span>;
  return (
    <>
      <td className={`${TD} ${NUM}`} title={ia.razon_natural ?? undefined}>
        {ia.natural_y1 === null ? sinCifra : unidades(ia.natural_y1)}
      </td>
      <td className={`${TD} ${NUM} font-semibold`} title={ia.razon ?? undefined}>
        {libre ? (
          ia.meta_y1 === null ? (
            <span className="font-normal text-tinta-suave" title="Sin cifra IA para esta fila">
              —
            </span>
          ) : (
            unidades(ia.meta_y1)
          )
        ) : (
          <span className="font-sans text-xs font-normal italic text-tinta-suave">{etiquetaFija}</span>
        )}
      </td>
      <td className={`${TD} ${NUM} ${altaAbsorcion ? "text-alerta" : ""}`} title={altaAbsorcion ? textoAvisoIa("absorcion_alta") : undefined}>
        {libre && ia.absorbido_u !== null ? textoUPct(ia.absorbido_u, ia.absorbido_pct) : sinCifra}
      </td>
      <td className={`${TD} ${NUM} ${tono ? CLASE_BRECHA[tono] : ""}`}>
        {libre && ia.brecha_u !== null ? (
          <>
            <span className="block">{textoUPct(ia.brecha_u, ia.brecha_pct)}</span>
            {tono && <span className="block font-sans text-[11px] font-normal">{ETIQUETA_BRECHA[tono]}</span>}
          </>
        ) : (
          sinCifra
        )}
      </td>
    </>
  );
}

/** Los totales de la línea bajo las cuatro columnas (en el pie de la tabla). */
export function CeldasTotalIa({ totales }: { totales: TotalesIa | null }) {
  const vacia = <td className={TD} />;
  if (!totales) {
    return (
      <>
        {vacia}
        {vacia}
        {vacia}
        {vacia}
      </>
    );
  }
  return (
    <>
      <td className={`${TD} ${NUM}`}>{unidades(totales.natural)}</td>
      <td className={`${TD} ${NUM}`}>{unidades(totales.conMeta)}</td>
      <td className={`${TD} ${NUM}`}>{textoUPct(totales.absorbido, null)}</td>
      <td className={`${TD} ${NUM}`}>{textoUPct(totales.brecha_u, totales.brecha_pct)}</td>
    </>
  );
}

// ─── Chips y «¿por qué?» ───

function Chips({ titulo, items }: { titulo: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-xs text-tinta-suave">{titulo}</span>
      {items.map((t) => (
        <Badge key={t} tono="neutro">
          {t}
        </Badge>
      ))}
    </div>
  );
}

/** ¿Hay algo que explicar de esta fila (razón, razón del natural, banderas, señales o avisos)? Pura. */
export function tieneExplicacionIa(ia: IaFilaApi | undefined): boolean {
  return Boolean(ia && (ia.razon || ia.razon_natural || ia.banderas.length > 0 || ia.senales.length > 0 || ia.avisos.length > 0));
}

/** El «¿por qué?» de una fila: razón de la IA, razón del natural, lectura de la IA (banderas), señales del sistema y avisos. Todo como texto. */
export function PorQueIa({ ia, conConfianza = true }: { ia: IaFilaApi; conConfianza?: boolean }) {
  return (
    <div className="space-y-1.5 text-sm">
      {ia.razon && (
        <p>
          <span className="text-xs font-medium text-tinta-suave">Razón de la cifra con meta: </span>
          {ia.razon}
        </p>
      )}
      {ia.razon_natural && (
        <p>
          <span className="text-xs font-medium text-tinta-suave">Razón del natural: </span>
          {ia.razon_natural}
        </p>
      )}
      <Chips titulo="Lectura de la IA" items={ia.banderas.map((b) => ETIQUETA_BANDERA[b] ?? b)} />
      <Chips titulo="Señales del sistema" items={ia.senales.map((s) => ETIQUETA_SENAL[s] ?? s)} />
      {conConfianza && ia.confianza && <p className="text-xs text-tinta-suave">Confianza de la IA: {ia.confianza}</p>}
      {ia.avisos.length > 0 && (
        <ul className="space-y-0.5 text-xs text-alerta">
          {ia.avisos.map((a) => (
            <li key={a}>{textoAvisoIa(a)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Aceptar IA ───

/** Lo que una celda o un bloque necesita para ofrecer «Aceptar IA»: la cifra que se ve (`valor_esperado`), por qué no se puede y la acción. */
export type AceptarIa = { valor: number | null; motivo: string | null; onAceptar: () => Promise<boolean> };

/** Arma la oferta de «Aceptar IA» de una fila: deshabilitada, con el motivo, si el GM está desactualizado, la capacidad apagada, la fila es fija o no hay cifra. */
export function aceptarIaDe(ia: IaFilaApi, onAceptar: () => Promise<boolean>): AceptarIa {
  const fija = ETIQUETA_META_FILA[ia.estado_meta];
  const motivo = !ia.aceptable.y1
    ? (ia.aceptable.motivo ?? "La IA no se puede aceptar en esta fila")
    : fija !== null
      ? `La fila es ${fija}`
      : ia.meta_y1 === null
        ? "No hay cifra IA para esta fila"
        : null;
  return { valor: ia.meta_y1, motivo, onAceptar };
}

export function BotonAceptarIa({ aceptar, deshabilitada, etiqueta }: { aceptar: AceptarIa; deshabilitada: boolean; etiqueta: string }) {
  const sinMotivo = aceptar.motivo === null && aceptar.valor !== null;
  return (
    <Button
      variante="secundario"
      tamano="sm"
      className="px-2 text-xs"
      disabled={deshabilitada || !sinMotivo}
      title={aceptar.motivo ?? "Aceptar la cifra de la IA con meta (se guarda como tu decisión, con su traza)"}
      aria-label={`Aceptar la cifra de la IA: ${etiqueta}`}
      onClick={() => void aceptar.onAceptar()}
    >
      Aceptar IA{aceptar.valor === null ? "" : ` (${formatearNumero(aceptar.valor)})`}
    </Button>
  );
}

// ─── Decisión que vino de la IA ───

/** El badge «IA» junto a una decisión que salió de «Aceptar IA»: con la fecha y la versión al pasar el cursor. */
export function BadgeDecisionIa({ decision }: { decision: DecisionIaApi }) {
  return (
    <span title={textoDecisionIa(decision)} aria-label="Cifra aceptada de la IA">
      <Badge tono="marca">IA</Badge>
    </span>
  );
}

/** «OpenAI · gpt-… · prompt v1 · propuesta del 30/10/2026». */
export function textoDecisionIa(d: DecisionIaApi): string {
  return `${nombreProveedor(d.proveedor)} · ${d.modelo} · prompt ${d.version_prompt} · propuesta del ${fechaCorta(d.generada_at)}`;
}

// ─── Bloque «Propuesta IA» del detalle de la fila ───

/** §4.3: lo que la IA propuso para la fila: natural, con meta, absorbido, brecha, confianza, señales, lectura y razón. Solo se monta con una fila de la propuesta vigente. */
export function BloquePropuestaIa({ ia, anio }: { ia: IaFilaApi; anio: number }) {
  const etiquetaFija = ETIQUETA_META_FILA[ia.estado_meta];
  const libre = etiquetaFija === null;
  const tono = libre ? tonoBrecha(ia.brecha_pct) : null;
  return (
    <section className="space-y-3 rounded-lg border border-marca/30 bg-marca-suave/40 p-4" aria-label={`Propuesta IA ${anio}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          Propuesta IA {anio} <Badge tono="marca">IA</Badge>
        </h4>
        <span className="text-xs text-tinta-suave">
          GM {ETIQUETA_ESTADO_GM[ia.estado_gm] ?? ia.estado_gm}
          {ia.motivos.length > 0 && ` (${ia.motivos.map((m) => ETIQUETA_MOTIVO_GM[m] ?? m).join(", ")})`}
        </span>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-tinta-suave">Natural (sin meta)</dt>
          <dd className={NUM}>{unidades(ia.natural_y1)}</dd>
        </div>
        <div>
          <dt className="text-xs text-tinta-suave">Con meta</dt>
          <dd className={`${NUM} font-semibold`}>{libre ? unidades(ia.meta_y1) : (etiquetaFija ?? "—")}</dd>
        </div>
        {libre && (
          <>
            <div>
              <dt className="text-xs text-tinta-suave">Absorbido</dt>
              <dd className={`${NUM} ${ia.avisos.includes("absorcion_alta") ? "text-alerta" : ""}`}>{textoUPct(ia.absorbido_u, ia.absorbido_pct)}</dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-suave">Brecha</dt>
              <dd className={`${NUM} ${tono ? CLASE_BRECHA[tono] : ""}`}>
                {textoUPct(ia.brecha_u, ia.brecha_pct)}
                {tono && <span className="ml-1 font-sans text-xs font-normal">{ETIQUETA_BRECHA[tono]}</span>}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-suave">Frente al método</dt>
              <dd className={NUM}>{ia.contra_metodo_u === null ? "—" : `${signado(ia.contra_metodo_u)} u`}</dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-suave">Sobre {anio - 1} corregido</dt>
              <dd className={NUM}>{formatearPct(ia.pct_sobre_corregida)}</dd>
            </div>
            <div>
              <dt className="text-xs text-tinta-suave">Sobre {anio - 1} real</dt>
              <dd className={NUM}>{formatearPct(ia.pct_sobre_real)}</dd>
            </div>
          </>
        )}
        <div>
          <dt className="text-xs text-tinta-suave">Confianza</dt>
          <dd>{ia.confianza ?? "—"}</dd>
        </div>
      </dl>
      <PorQueIa ia={ia} conConfianza={false} />
    </section>
  );
}
