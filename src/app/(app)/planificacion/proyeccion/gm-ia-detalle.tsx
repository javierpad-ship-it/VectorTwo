"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { GMIaDetalleApi } from "@/lib/ia/tipos-api";
import type { IndiceLineaApi } from "@/lib/proyeccion/tipos-api";
import { hojasPropuestaIa } from "@/lib/ia/excel";
import { AlertaError, Cargando, NUM } from "./comunes";
import { descargarLibro } from "./descarga-libro";
import {
  ESTADO_GM,
  ETIQUETA_ESTADO_META,
  destinoLinea,
  metaProvisional,
  nivelBrecha,
  nombreGm,
  ordenarFilasPorDistanciaAlMetodo,
  signado,
  textoAbsorcionFila,
  textoAbsorcionGm,
  textoAporteEntrantes,
  textoAvisoIa,
  textoBandera,
  textoBrecha,
  textoDecision,
  textoDesgloseAbsorcion,
  textoDosCifrasMeta,
  textoEstadoGm,
  textoFueraDeMeta,
  textoGenerada,
  textoMetaDetalle,
  textoSenal,
  totalesDeFilas,
  totalesPorLinea,
  avisoEsAlerta,
  etiquetaProveedor,
} from "./propuesta-ia-vista";
import { useAccion } from "./use-proyeccion";
import { useDetalleGmIa } from "./use-propuesta-ia";
import { formatearMomento, formatearPct, unidades } from "./vista";

type Fila = GMIaDetalleApi["filas"][number];

export type DestinoLinea = { genero_id: string; mundo_id: string; linea_id: string | null; fila_id: string };

function Chips({ titulo, items }: { titulo: string; items: { clave: string; texto: string; alerta?: boolean }[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-tinta-suave">{titulo}</p>
      <span className="flex flex-wrap gap-1">
        {items.map((i) => (
          <Badge key={i.clave} tono={i.alerta ? "alerta" : "neutro"}>
            {i.texto}
          </Badge>
        ))}
      </span>
    </div>
  );
}

/** Dos líneas en una celda numérica: la cifra y, debajo, el matiz pequeño. */
function Dos({ principal, secundaria, alerta = false }: { principal: string; secundaria?: string | null; alerta?: boolean }) {
  return (
    <span className="block">
      <span className={`${NUM} block ${alerta ? "text-alerta" : ""}`}>{principal}</span>
      {secundaria && <span className={`${NUM} block text-xs text-tinta-suave`}>{secundaria}</span>}
    </span>
  );
}

function columnas(d: GMIaDetalleApi, anioEnCurso: number, indice: readonly IndiceLineaApi[], onIrALinea: (d: DestinoLinea) => void): Columna<Fila>[] {
  const y = anioEnCurso;
  return [
    {
      clave: "fila",
      titulo: "Línea · agrupación",
      render: (f) => (
        <div className="min-w-40">
          <p className="font-medium">{f.linea}</p>
          <p className="text-xs text-tinta-suave">{f.equivalencia ? `${f.equivalencia} · ${f.agrupacion_marca}` : f.agrupacion_marca}</p>
          <Badge tono={f.estado_meta === "libre" ? "marca" : "neutro"}>{ETIQUETA_ESTADO_META[f.estado_meta] ?? f.estado_meta}</Badge>
        </div>
      ),
    },
    { clave: "y", titulo: `${y}`, render: (f) => <Dos principal={unidades(f.vigente_y)} secundaria={f.decidida_y ? "decidida" : null} /> },
    {
      clave: "base",
      titulo: `Base ${y + 1}`,
      render: (f) => <Dos principal={`${unidades(f.base)} real`} secundaria={f.base_corregida !== null && f.base_corregida !== f.base ? `${unidades(f.base_corregida)} corregida` : null} />,
    },
    { clave: "aporte", titulo: "Tiendas que entran", render: (f) => <span className="text-xs text-tinta-suave">{textoAporteEntrantes(f) ?? "—"}</span> },
    { clave: "metodo", titulo: `Método ${y + 1}`, className: NUM, render: (f) => unidades(f.metodo_y1) },
    {
      clave: "natural",
      titulo: "Natural IA",
      className: NUM,
      // La razón es texto de la IA: va en `title` (React lo escapa) y nunca como HTML.
      render: (f) => <span title={f.razon_natural ?? undefined}>{unidades(f.natural_y1)}</span>,
    },
    {
      clave: "meta",
      titulo: "IA con meta",
      className: NUM,
      render: (f) => (f.meta_y1 === null ? <span className="text-xs text-tinta-suave">{f.estado_meta === "libre" ? "sin cifra" : ETIQUETA_ESTADO_META[f.estado_meta]}</span> : <span className="font-semibold">{unidades(f.meta_y1)}</span>),
    },
    {
      clave: "absorbido",
      titulo: "Absorbido",
      render: (f) => {
        const a = textoAbsorcionFila(f);
        return a ? <span className={`${NUM} block ${a.alerta ? "text-alerta" : ""}`} title={a.alerta ? textoAvisoIa("absorcion_alta") : undefined}>{a.texto}</span> : <span className="text-tinta-suave">—</span>;
      },
    },
    {
      clave: "brecha",
      titulo: "Brecha",
      render: (f) => {
        const n = nivelBrecha(f.brecha_pct);
        return (
          <span className="block">
            <span className={`${NUM} block`}>{textoBrecha(f)}</span>
            {n.texto && <Badge tono={n.tono}>{n.texto}</Badge>}
          </span>
        );
      },
    },
    { clave: "vs", titulo: "vs método", className: NUM, render: (f) => (f.contra_metodo_u === null ? "—" : `${signado(f.contra_metodo_u)} u`) },
    {
      clave: "pct",
      titulo: `% sobre ${y}`,
      render: (f) => <Dos principal={`${formatearPct(f.pct_sobre_corregida)} corregido`} secundaria={`${formatearPct(f.pct_sobre_real)} real`} />,
    },
    { clave: "confianza", titulo: "Confianza", render: (f) => f.confianza ?? <span className="text-tinta-suave">—</span> },
    {
      clave: "senales",
      titulo: "Señales del sistema · lectura de la IA",
      render: (f) => (
        <div className="min-w-44 space-y-1">
          <Chips titulo="Sistema" items={f.senales.map((s) => ({ clave: s, texto: textoSenal(s) }))} />
          <Chips titulo="IA" items={f.banderas.map((b) => ({ clave: b, texto: textoBandera(b) }))} />
          <Chips titulo="Avisos" items={f.avisos.map((a) => ({ clave: a, texto: textoAvisoIa(a), alerta: avisoEsAlerta(a) }))} />
        </div>
      ),
    },
    // La razón la escribió el modelo: se pinta como texto (React escapa), con saltos de línea respetados.
    { clave: "razon", titulo: "Razón", render: (f) => <p className="min-w-56 max-w-sm whitespace-pre-line text-xs">{f.razon ?? "—"}</p> },
    { clave: "decision", titulo: `Decisión ${y + 1}`, render: (f) => <span className="text-xs">{textoDecision(f)}</span> },
    {
      clave: "ir",
      titulo: "",
      className: "whitespace-nowrap",
      render: (f) => {
        const destino = destinoLinea(d.gm_clave, f.linea, indice);
        return destino ? (
          <Button variante="fantasma" tamano="sm" aria-label={`Ir a la línea ${f.linea}`} onClick={() => onIrALinea({ ...destino, fila_id: f.fila_id })}>
            Ir a la línea
          </Button>
        ) : null;
      },
    },
  ];
}

/** El detalle ya leído: razón, meta, absorción, tabla de filas, totales y propuestas anteriores. */
export function GmIaDetalleVista({
  detalle: d,
  anioEnCurso,
  indice,
  onVolver,
  onIrALinea,
  onExcel,
  excelOcupado = false,
}: {
  detalle: GMIaDetalleApi;
  anioEnCurso: number;
  indice: readonly IndiceLineaApi[];
  onVolver: () => void;
  onIrALinea: (d: DestinoLinea) => void;
  onExcel?: () => void;
  excelOcupado?: boolean;
}) {
  const y1 = anioEnCurso + 1;
  const filas = ordenarFilasPorDistanciaAlMetodo(d.filas);
  const lineas = totalesPorLinea(d.filas);
  const total = totalesDeFilas(d.filas);
  const abs = textoAbsorcionGm(d.absorcion);
  const estado = ESTADO_GM[d.estado];
  const tarjeta = textoMetaDetalle(d);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button variante="secundario" tamano="sm" onClick={onVolver}>
            ← Todos los GM
          </Button>
          <h2 className="text-lg font-semibold">{nombreGm(d)}</h2>
          {d.es_resto && <Badge tono="neutro">Resto</Badge>}
          <Badge tono={estado.tono}>{textoEstadoGm(d)}</Badge>
          {metaProvisional(d.meta) && <Badge tono="alerta">meta provisional</Badge>}
        </div>
        {onExcel && (
          <Button variante="secundario" tamano="sm" disabled={excelOcupado} onClick={onExcel}>
            {excelOcupado ? "Preparando…" : "Descargar Excel"}
          </Button>
        )}
      </div>

      {d.configuracion_cambiada && <Alert tono="info">La configuración de IA vigente (modelo o prompt) no es la que generó esta propuesta: regenera el GM para que use la actual.</Alert>}

      {d.propuesta ? (
        <Card titulo="Razón del GM" descripcion={`Generada: ${textoGenerada(d.propuesta)}`}>
          <p className="whitespace-pre-line text-sm">{d.propuesta.razon_gm ?? "La IA no dio una razón para este GM."}</p>
        </Card>
      ) : (
        <Alert tono="info">Este GM todavía no tiene propuesta de la IA. Genérala con «Generar propuesta IA».</Alert>
      )}

      <Card titulo={d.meta ? `Meta ${y1}` : `Meta ${y1}: sin meta aprobada`}>
        <div className="space-y-2 text-sm">
          {tarjeta ? <p>{tarjeta}</p> : <p className="text-tinta-suave">Sin meta aprobada para este GM: la IA solo da el natural y las razones.</p>}
          {d.meta && <p className="text-xs text-tinta-suave">{textoDosCifrasMeta(d.meta.meta_gm, d.contexto.vista_previa_curvas)}</p>}
          <p className="text-xs text-tinta-suave">{textoFueraDeMeta(d.contexto, y1)}</p>
          {d.meta && d.meta.fuera_base.filas > 0 && (
            <p className="text-xs text-tinta-suave">
              Sin base en el año en curso, fuera de la meta: {unidades(d.meta.fuera_base.filas)} filas · {unidades(d.meta.fuera_base.unidades)} u.
            </p>
          )}
          {d.absorcion && <p className={abs?.alerta ? "text-alerta" : undefined}>{textoDesgloseAbsorcion(d.absorcion)}</p>}
        </div>
      </Card>

      <section aria-label={`Filas de ${nombreGm(d)}`} className="space-y-2">
        <p className="text-xs text-tinta-suave">Ordenadas por cuánto se aparta la IA con meta del método (primero donde más). El «Aceptar IA» de cada fila vive en Por línea.</p>
        <DataTable columnas={columnas(d, anioEnCurso, indice, onIrALinea)} filas={filas} claveFila={(f) => f.fila_id} vacio="Este GM no tiene filas base." />
      </section>

      <Card titulo="Totales">
        <div className="space-y-3 text-sm">
          <p>
            <span className="font-medium">GM:</span> {anioEnCurso} {unidades(total.vigente_y)} u · método {y1} {unidades(total.metodo_y1)} u · natural IA {unidades(total.natural_y1)} u · IA con meta {unidades(total.meta_y1)} u · vigente {y1}{" "}
            {unidades(total.vigente_y1)} u
          </p>
          {lineas.length > 0 && (
            <ul className="divide-y divide-borde rounded-lg border border-borde">
              {lineas.map((l) => (
                <li key={l.linea} className="flex flex-wrap items-baseline justify-between gap-x-4 px-3 py-1.5">
                  <span className="font-medium">
                    {l.linea} <span className="font-normal text-tinta-suave">· {l.filas} {l.filas === 1 ? "fila" : "filas"}</span>
                  </span>
                  <span className={NUM}>
                    método {unidades(l.metodo_y1)} · natural {unidades(l.natural_y1)} · IA con meta {unidades(l.meta_y1)} · vigente {unidades(l.vigente_y1)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      {d.anteriores.length > 0 && (
        <Card titulo="Propuestas anteriores" descripcion="Solo lectura.">
          <ul className="divide-y divide-borde text-sm">
            {d.anteriores.map((a) => (
              <li key={a.id} className="py-1.5">
                {formatearMomento(a.created_at)} · {etiquetaProveedor(a.proveedor)} {a.modelo} · prompt {a.version_prompt}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Lee `GET …/ia/gm/[clave]` y pinta el detalle. */
export function GmIaDetalle({
  proyeccionId,
  anioEnCurso,
  clave,
  indice,
  onVolver,
  onIrALinea,
}: {
  proyeccionId: string;
  anioEnCurso: number;
  clave: string;
  indice: readonly IndiceLineaApi[];
  onVolver: () => void;
  onIrALinea: (d: DestinoLinea) => void;
}) {
  const lectura = useDetalleGmIa(proyeccionId, clave);
  const excel = useAccion();

  async function descargar() {
    const d = lectura.datos;
    if (!d) return;
    await excel.ejecutar(async () => {
      const hojas = hojasPropuestaIa({ gms: [d], detalles: [d], anioEnCurso });
      await descargarLibro({ GM: hojas.GM, FILAS: hojas.FILAS }, `propuesta-ia-${nombreGm(d).replace(/[^\p{L}\p{N}]+/gu, "-")}.xlsx`);
    });
  }

  return (
    <div className="space-y-3">
      {lectura.error && (
        <AlertaError
          error={lectura.error}
          onCerrar={() => lectura.setError(null)}
          onRecargar={() => void lectura.recargar()}
        />
      )}
      {lectura.error && (
        <Button variante="secundario" tamano="sm" onClick={onVolver}>
          ← Todos los GM
        </Button>
      )}
      {excel.error && <AlertaError error={excel.error} onCerrar={excel.limpiar} />}
      {lectura.cargando && !lectura.datos && <Cargando texto="Leyendo la propuesta del GM…" />}
      {lectura.datos && (
        <GmIaDetalleVista detalle={lectura.datos} anioEnCurso={anioEnCurso} indice={indice} onVolver={onVolver} onIrALinea={onIrALinea} onExcel={() => void descargar()} excelOcupado={excel.ocupado} />
      )}
    </div>
  );
}
