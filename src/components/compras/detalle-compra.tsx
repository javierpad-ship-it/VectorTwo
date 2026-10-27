import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import {
  ETIQUETA_ACCION_EVENTO,
  ETIQUETA_ORIGEN_COMPRA,
  ETIQUETA_TIPO_LINEA,
  type CompraApi,
  type EntregaLineaApi,
  type EventoCompraApi,
  type LineaCompraApi,
  type OrigenRecepcion,
  type RecepcionLineaApi,
} from "@/lib/compras/tipos-api";
import { dinero, fechaHora, mesCorto, mesLargo, unidades } from "./formato";
import { descripcionLinea, estadoCompra, estadoEntrega, TEXTO_AVISO_LINEA, TEXTO_AVISO_RECEPCION, unidadesConfirmables } from "./vista-compras";

const ETIQUETA_ORIGEN_INGRESO: Record<OrigenRecepcion, string> = { manual: "Manual", sugerencia: "Sugerencia aceptada", importada: "Importada" };

/**
 * Detalle de una compra (ficha 08 §4.4): cabecera, saldo cerrado si lo hay, cada línea con su cronograma de entregas (con el pendiente
 * por entrega y las vencidas por confirmar), sus ingresos confirmados y, en un lote, su reparto guardado; y el historial de cambios con
 * quién, cuándo y qué. Las acciones (Confirmar ingreso, Quitar, Cancelar) solo aparecen si `puedeEscribir` y la compra lo permite; el
 * comprador ve todo sin botones. El diálogo y la llamada a la API son del panel.
 */
export function DetalleCompra({
  compra,
  puedeEscribir,
  ocupado = false,
  onConfirmarIngreso,
  onQuitarIngreso,
  onCancelar,
}: {
  compra: CompraApi;
  puedeEscribir: boolean;
  ocupado?: boolean;
  onConfirmarIngreso: (linea: LineaCompraApi, numeroLinea: number, entrega: EntregaLineaApi | null) => void;
  onQuitarIngreso: (linea: LineaCompraApi, numeroLinea: number, recepcion: RecepcionLineaApi) => void;
  onCancelar: () => void;
}) {
  const estado = estadoCompra(compra);
  const puedeRecibir = puedeEscribir && compra.puede.recibir;
  const puedeQuitar = puedeEscribir && compra.estado !== "cancelada";
  const cancelada = compra.cancelada_por;
  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-borde bg-superficie p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">
              Compra {compra.numero} <span className="text-tinta-suave">·</span> {compra.proveedor.nombre}
              {compra.proveedor.es_intercompany && (
                <span className="ml-2 align-middle">
                  <Badge tono="marca">CD intercompany</Badge>
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-sm text-tinta-suave">
              {compra.fecha_compra}
              {compra.referencia ? ` · ref. ${compra.referencia}` : ""} · {compra.moneda} · {ETIQUETA_ORIGEN_COMPRA[compra.origen]}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tono={estado.tono}>{estado.texto}</Badge>
            {puedeEscribir && compra.puede.cancelar && (
              <Button variante="peligro" tamano="sm" onClick={onCancelar} disabled={ocupado}>
                Cancelar compra
              </Button>
            )}
          </div>
        </div>

        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Dato titulo="Unidades" valor={unidades(compra.totales.unidades)} />
          <Dato titulo="Recibidas" valor={unidades(compra.totales.recibidas)} />
          <Dato titulo="Costo" valor={dinero(compra.moneda, compra.totales.costo)} />
          <Dato titulo="Entregas" valor={compra.llegadas ? `${mesCorto(compra.llegadas.desde)} a ${mesCorto(compra.llegadas.hasta)} (${compra.llegadas.entregas})` : "—"} />
          <Dato titulo="Creada por" valor={`${compra.creada_por.nombre ?? "—"} · ${fechaHora(compra.creada_por.at)}`} />
          {compra.confirmada_por && <Dato titulo="Confirmada por" valor={`${compra.confirmada_por.nombre ?? "—"} · ${fechaHora(compra.confirmada_por.at)}`} />}
          {compra.modificada_por && <Dato titulo="Último cambio" valor={`${compra.modificada_por.nombre ?? "—"} · ${fechaHora(compra.modificada_por.at)}`} />}
          {compra.nota && <Dato titulo="Nota" valor={compra.nota} />}
        </dl>

        {cancelada && (
          <p className="mt-4 rounded-md bg-alerta-suave px-3 py-2 text-sm text-alerta">
            {compra.saldo_cerrado ? "Saldo cancelado" : "Cancelada"} por {cancelada.nombre ?? "—"} el {fechaHora(cancelada.at)}: «{cancelada.motivo}».
            {compra.saldo_cerrado && " Los ingresos confirmados siguen valiendo y el saldo ya no se espera en el flujo."}
          </p>
        )}
        {compra.justificacion_exceso && (
          <p className="mt-3 rounded-md bg-marca-suave px-3 py-2 text-sm text-marca-oscura">Justificación del exceso al confirmar: {compra.justificacion_exceso}</p>
        )}
      </section>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Líneas ({compra.lineas.length})</h3>
        {compra.lineas.map((l, i) => (
          <BloqueLinea key={l.id} linea={l} numero={i + 1} compra={compra} puedeRecibir={puedeRecibir} puedeQuitar={puedeQuitar} ocupado={ocupado} onConfirmarIngreso={onConfirmarIngreso} onQuitarIngreso={onQuitarIngreso} />
        ))}
      </div>

      <Historial eventos={compra.historial} />
    </div>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-tinta-suave">{titulo}</dt>
      <dd className="mt-0.5 break-words text-tinta">{valor}</dd>
    </div>
  );
}

const ETIQUETA_DESTINO = (l: LineaCompraApi) => (l.destino === "cd" ? "CD" : l.destino === "tienda" ? `Tienda ${l.tienda?.codigo ?? ""}`.trim() : "Directo a la marca (intercompany)");

function BloqueLinea({
  linea: l,
  numero,
  compra,
  puedeRecibir,
  puedeQuitar,
  ocupado,
  onConfirmarIngreso,
  onQuitarIngreso,
}: {
  linea: LineaCompraApi;
  numero: number;
  compra: CompraApi;
  puedeRecibir: boolean;
  puedeQuitar: boolean;
  ocupado: boolean;
  onConfirmarIngreso: (linea: LineaCompraApi, numeroLinea: number, entrega: EntregaLineaApi | null) => void;
  onQuitarIngreso: (linea: LineaCompraApi, numeroLinea: number, recepcion: RecepcionLineaApi) => void;
}) {
  const confirmables = unidadesConfirmables(l);
  const columnasEntregas: Columna<EntregaLineaApi>[] = [
    { clave: "mes", titulo: "Llega", render: (e) => <span className="whitespace-nowrap">{mesCorto(e.periodo)}</span> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (e) => <span className="font-mono tabular-nums">{unidades(e.unidades)}</span> },
    { clave: "asignadas", titulo: "Recibidas", className: "text-right", render: (e) => <span className="font-mono tabular-nums">{unidades(e.asignadas)}</span> },
    { clave: "pendiente", titulo: "Pendiente", className: "text-right", render: (e) => <span className="font-mono tabular-nums">{unidades(e.pendiente)}</span> },
    {
      clave: "estado",
      titulo: "Estado",
      render: (e) => {
        const s = estadoEntrega(e);
        return (
          <span className="flex flex-col gap-0.5">
            <span>
              <Badge tono={s.tono}>{s.texto}</Badge>
            </span>
            {e.sugerencia && (
              <span className="text-[11px] text-tinta-suave">
                La conciliación propone {unidades(e.sugerencia.unidades)} u en {mesCorto(e.sugerencia.periodo)}
              </span>
            )}
          </span>
        );
      },
    },
    { clave: "temporada", titulo: "Temporada", render: (e) => <span className="text-xs text-tinta-suave">{e.temporada === "verano" ? "Verano" : "Invierno"}</span> },
    ...(puedeRecibir
      ? [
          {
            clave: "accion",
            titulo: "",
            render: (e: EntregaLineaApi) =>
              e.pendiente > 0 ? (
                <Button tamano="sm" variante={e.vencida ? "primario" : "secundario"} disabled={ocupado} onClick={() => onConfirmarIngreso(l, numero, e)}>
                  Confirmar ingreso
                </Button>
              ) : null,
          } satisfies Columna<EntregaLineaApi>,
        ]
      : []),
  ];

  const columnasIngresos: Columna<RecepcionLineaApi>[] = [
    { clave: "mes", titulo: "Mes", render: (r) => <span className="whitespace-nowrap">{mesCorto(r.recibida_periodo)}</span> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (r) => <span className="font-mono tabular-nums">{unidades(r.unidades)}</span> },
    { clave: "fecha", titulo: "Fecha", render: (r) => <span className="whitespace-nowrap">{r.fecha_recepcion}</span> },
    { clave: "origen", titulo: "Origen", render: (r) => <span className="text-xs">{ETIQUETA_ORIGEN_INGRESO[r.origen]}</span> },
    { clave: "quien", titulo: "Quién", render: (r) => <span className="text-xs">{r.usuario_nombre ?? "—"}</span> },
    {
      clave: "avisos",
      titulo: "Avisos",
      render: (r) =>
        r.avisos.length === 0 && !r.nota ? (
          <span className="text-tinta-suave">—</span>
        ) : (
          <span className="flex flex-col gap-0.5 text-[11px] text-tinta-suave">
            {r.avisos.map((a) => (
              <span key={a}>{TEXTO_AVISO_RECEPCION[a]}</span>
            ))}
            {r.nota && <span>{r.nota}</span>}
          </span>
        ),
    },
    ...(puedeQuitar
      ? [
          {
            clave: "accion",
            titulo: "",
            render: (r: RecepcionLineaApi) => (
              <Button variante="peligro" tamano="sm" disabled={ocupado} onClick={() => onQuitarIngreso(l, numero, r)}>
                Quitar
              </Button>
            ),
          } satisfies Columna<RecepcionLineaApi>,
        ]
      : []),
  ];

  return (
    <section aria-label={`Línea ${numero} de ${compra.numero}`} className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="text-sm font-semibold">
            Línea {numero} · {ETIQUETA_TIPO_LINEA[l.tipo]}
          </h4>
          <p className="text-sm text-tinta-suave">{descripcionLinea(l)}</p>
        </div>
        {puedeRecibir && confirmables > 0 && l.unidades_canceladas > 0 && (
          <Button tamano="sm" variante="secundario" disabled={ocupado} onClick={() => onConfirmarIngreso(l, numero, null)}>
            Confirmar ingreso tardío
          </Button>
        )}
        {puedeRecibir && confirmables > 0 && l.unidades_canceladas === 0 && l.entregas.length === 0 && (
          <Button tamano="sm" variante="secundario" disabled={ocupado} onClick={() => onConfirmarIngreso(l, numero, null)}>
            Confirmar ingreso
          </Button>
        )}
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
        <Dato titulo="Marca / agrupación" valor={l.marca ?? l.agrupacion_marca ?? "—"} />
        <Dato titulo="Tallas" valor={l.tallas} />
        <Dato titulo="Unidades" valor={`${unidades(l.unidades)}${l.unidades_canceladas > 0 ? ` (${unidades(l.unidades_canceladas)} canceladas)` : ""}`} />
        <Dato titulo="Recibidas" valor={unidades(l.unidades_recibidas)} />
        <Dato titulo="Costo unitario" valor={dinero(compra.moneda, l.costo_unitario)} />
        <Dato titulo="Destino" valor={ETIQUETA_DESTINO(l)} />
      </dl>
      {l.nota && <p className="text-sm text-tinta-suave">Nota: {l.nota}</p>}

      {l.avisos.length > 0 && (
        <ul className="space-y-1 text-xs text-alerta">
          {l.avisos.map((a) => (
            <li key={a}>⚠ {TEXTO_AVISO_LINEA[a]}</li>
          ))}
        </ul>
      )}

      <div className="space-y-1">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Entregas</h5>
        <DataTable columnas={columnasEntregas} filas={l.entregas} claveFila={(e) => e.id} vacio="Sin cronograma de entregas." />
      </div>
      <div className="space-y-1">
        <h5 className="text-xs font-semibold uppercase tracking-wide text-tinta-suave">Ingresos confirmados</h5>
        <DataTable columnas={columnasIngresos} filas={l.recepciones} claveFila={(r) => r.id} vacio="Todavía no se confirmó ningún ingreso de esta línea." />
      </div>

      {l.tipo !== "especifica" && <RepartoLinea linea={l} />}
    </section>
  );
}

function RepartoLinea({ linea: l }: { linea: LineaCompraApi }) {
  if (!l.reparto) {
    return <p className="rounded-md bg-alerta-suave px-3 py-2 text-xs text-alerta">Sin reparto vigente: esta línea no cuenta en el flujo hasta que se apruebe un reparto de la marca en Marcas al barrer.</p>;
  }
  const r = l.reparto;
  return (
    <details className="rounded-md border border-borde">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Reparto guardado{r.version !== null ? ` · versión ${r.version}` : ""}
        {r.error_reparto_pp !== null ? ` · error histórico ${r.error_reparto_pp} pp` : ""}
        {!r.vigente && " · hay una versión más nueva"}
      </summary>
      <div className="space-y-3 px-3 pb-3">
        <ul className="grid gap-x-6 gap-y-0.5 text-sm sm:grid-cols-2">
          {r.filas.map((f) => (
            <li key={`${f.marca_id}|${f.gml_id}|${f.equivalencia_id ?? ""}`} className="flex justify-between gap-3">
              <span className="min-w-0 truncate">
                {f.ruta} <span className="text-tinta-suave">({f.marca})</span>
              </span>
              <span className="font-mono tabular-nums">{unidades(f.unidades)} u</span>
            </li>
          ))}
        </ul>
        {r.por_entrega.length > 1 && (
          <div className="space-y-1 text-xs text-tinta-suave">
            {r.por_entrega.map((pe) => {
              const entrega = l.entregas.find((e) => e.id === pe.entrega_id);
              return (
                <p key={pe.entrega_id}>
                  <strong className="text-tinta">{entrega ? mesLargo(entrega.periodo) : "Entrega"}</strong>
                  {pe.temporada ? ` (${pe.temporada})` : ""}: {pe.filas.map((f) => `${f.ruta} ${unidades(f.unidades)}`).join(" · ")}
                </p>
              );
            })}
          </div>
        )}
      </div>
    </details>
  );
}

function Historial({ eventos }: { eventos: readonly EventoCompraApi[] }) {
  const ordenados = [...eventos].sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Historial de cambios</h3>
      {ordenados.length === 0 ? (
        <p className="text-sm text-tinta-suave">Todavía sin movimientos registrados.</p>
      ) : (
        <ol className="divide-y divide-borde rounded-lg border border-borde bg-superficie">
          {ordenados.map((e) => (
            <li key={e.id} className="px-3 py-2 text-sm">
              <p>
                <strong>{ETIQUETA_ACCION_EVENTO[e.accion]}</strong>
                {e.resumen ? ` · ${e.resumen}` : ""}
              </p>
              <p className="text-xs text-tinta-suave">
                {e.usuario_nombre ?? "—"} · {fechaHora(e.created_at)}
                {e.motivo ? ` · motivo: ${e.motivo}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
