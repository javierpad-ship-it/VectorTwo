"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { formatearNumero, plural } from "@/lib/formato";
import { MAX_NOTA_LOTE, type FilaLoteApi, type LoteApi } from "@/lib/aprobacion/tipos-api";
import { Cargando, NUM } from "./comunes";
import { ErrorConAcciones, ResumenResultado, type Nombres } from "./confirmar-lote-modal";
import {
  ETIQUETA_ESTADO_LOTE,
  ETIQUETA_FUENTE_FILA_LOTE,
  ETIQUETA_TIPO_LOTE,
  TONO_ESTADO_LOTE,
  lotesRevertibles,
  puedeRevertirLote,
  tandasDeConfirmacion,
  textoPorFuente,
  textoRechazadasLote,
  textoRechazo,
  textoResultadoAprobar,
  textoUsuarioLote,
  totalRechazadasLote,
} from "./aprobacion-vista";
import { useDetalleLote, useReversion, type DestinoReversion } from "./use-aprobacion";
import { formatearMomento, unidades } from "./vista";

export function BadgeEstadoLote({ estado }: { estado: LoteApi["estado"] }) {
  if (estado === null) return <span className="text-tinta-suave">—</span>;
  return <Badge tono={TONO_ESTADO_LOTE[estado]}>{ETIQUETA_ESTADO_LOTE[estado]}</Badge>;
}

/** «Aprobación», «Aprobación · tanda 2 de 3» si la confirmación tiene varias. */
function etiquetaTipo(l: LoteApi, lotes: readonly LoteApi[]): string {
  const tandas = tandasDeConfirmacion(lotes, l.confirmacion_id)
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const base = ETIQUETA_TIPO_LOTE[l.tipo];
  if (tandas.length <= 1) return base;
  return `${base} · tanda ${tandas.findIndex((t) => t.id === l.id) + 1} de ${tandas.length}`;
}

// ─── Historial (§4.5) ───

export function HistorialLotes({
  proyeccionId,
  lotes,
  cargando,
  error,
  editable,
  nombres,
  onRecargar,
  onCambio,
  onIrACrecimientos,
}: {
  proyeccionId: string;
  lotes: readonly LoteApi[] | null;
  cargando: boolean;
  error: string | null;
  /** Se puede revertir: la proyección está en trabajo y sin cálculo en curso. */
  editable: boolean;
  nombres: Nombres;
  onRecargar: () => void;
  /** Se escribió una reversión: la pantalla relee todo. */
  onCambio: () => void | Promise<void>;
  onIrACrecimientos: () => void;
}) {
  const [verId, setVerId] = useState<string | null>(null);
  const [revertir, setRevertir] = useState<DestinoReversion | null>(null);
  const lista = lotes ?? [];

  const columnas: Columna<LoteApi>[] = [
    { clave: "fecha", titulo: "Fecha", render: (l) => <span className="whitespace-nowrap">{formatearMomento(l.created_at)}</span> },
    { clave: "quien", titulo: "Quién", render: (l) => textoUsuarioLote(l) },
    { clave: "tipo", titulo: "Tipo", render: (l) => <span className="whitespace-nowrap">{etiquetaTipo(l, lista)}</span> },
    { clave: "anio", titulo: "Año", className: "text-right", render: (l) => <span className={NUM}>{l.anio}</span> },
    { clave: "pedidas", titulo: "Pedidas", className: "text-right", render: (l) => <span className={NUM}>{formatearNumero(l.resumen.pedidas)}</span> },
    { clave: "aplicadas", titulo: "Aplicadas", className: "text-right", render: (l) => <span className={NUM}>{formatearNumero(l.resumen.aplicadas)}</span> },
    {
      clave: "rechazadas",
      titulo: "Rechazadas",
      render: (l) => {
        const n = totalRechazadasLote(l.resumen);
        return n === 0 ? <span className="text-tinta-suave">0</span> : <span title={textoRechazadasLote(l.resumen)}>{formatearNumero(n)}</span>;
      },
    },
    { clave: "fuente", titulo: "IA y método", render: (l) => <span className="text-xs">{textoPorFuente(l.resumen) || "—"}</span> },
    { clave: "revision", titulo: "Revisión", render: (l) => (l.tipo === "revertir" ? "—" : l.revision_confirmada ? "Confirmada" : "No exigida") },
    { clave: "nota", titulo: "Nota", render: (l) => (l.nota ? <span className="block max-w-56 break-words text-xs">{l.nota}</span> : <span className="text-tinta-suave">—</span>) },
    {
      clave: "estado",
      titulo: "Estado",
      render: (l) => (
        <span className="inline-flex flex-col gap-0.5">
          <BadgeEstadoLote estado={l.estado} />
          {l.estado === "revertido_en_parte" && <span className="text-xs text-tinta-suave">{plural(l.filas_revertidas, "fila revertida", "filas revertidas")}</span>}
        </span>
      ),
    },
    {
      clave: "acciones",
      titulo: "Acciones",
      render: (l) => {
        const tandas = lotesRevertibles(lista, l.confirmacion_id);
        return (
          <span className="flex flex-wrap gap-1.5">
            <Button variante="secundario" tamano="sm" onClick={() => setVerId(l.id)}>
              Ver
            </Button>
            {puedeRevertirLote(l, editable) && (
              <Button variante="peligro" tamano="sm" className="whitespace-nowrap" onClick={() => setRevertir({ tipo: "lote", loteId: l.id, etiqueta: `${etiquetaTipo(l, lista)} del ${formatearMomento(l.created_at)}` })}>
                Revertir lote
              </Button>
            )}
            {editable && l.tipo !== "revertir" && tandas.length > 1 && tandas.some((t) => t.id === l.id) && (
              <Button
                variante="peligro"
                tamano="sm"
                className="whitespace-nowrap"
                onClick={() => setRevertir({ tipo: "confirmacion", confirmacionId: l.confirmacion_id, nLotes: tandas.length, etiqueta: `la confirmación completa (${tandas.length} tandas)` })}
              >
                Revertir confirmación
              </Button>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <Card titulo="Historial de aprobaciones" descripcion="Cada lote queda registrado y no se puede borrar. Revertir devuelve a la propuesta solo lo que nadie cambió después.">
      {error && (
        <div className="mb-3">
          <Alert tono="alerta">
            {error}{" "}
            <button type="button" onClick={onRecargar} className="font-medium underline underline-offset-2">
              Reintentar
            </button>
          </Alert>
        </div>
      )}
      {cargando && lotes === null ? (
        <Cargando texto="Leyendo el historial…" />
      ) : (
        <DataTable columnas={columnas} filas={[...lista]} claveFila={(l) => l.id} vacio="Todavía no se aprobó nada en bloque en esta proyección." />
      )}

      {verId !== null && (
        <DetalleLoteModal
          proyeccionId={proyeccionId}
          lote={lista.find((l) => l.id === verId) ?? null}
          loteId={verId}
          editable={editable}
          nombres={nombres}
          onCerrar={() => setVerId(null)}
          onRevertir={(destino) => {
            setVerId(null);
            setRevertir(destino);
          }}
        />
      )}
      {revertir !== null && (
        <RevertirModal
          key={revertir.tipo === "lote" ? `${revertir.loteId}-${revertir.filas?.join(",") ?? ""}` : revertir.confirmacionId}
          proyeccionId={proyeccionId}
          destino={revertir}
          nombres={nombres}
          onCerrar={async (hecho) => {
            setRevertir(null);
            if (hecho) await onCambio();
          }}
          onIrACrecimientos={onIrACrecimientos}
        />
      )}
    </Card>
  );
}

// ─── Ver un lote ───

function DetalleLoteModal({
  proyeccionId,
  lote,
  loteId,
  editable,
  nombres,
  onCerrar,
  onRevertir,
}: {
  proyeccionId: string;
  lote: LoteApi | null;
  loteId: string;
  editable: boolean;
  nombres: Nombres;
  onCerrar: () => void;
  onRevertir: (d: DestinoReversion) => void;
}) {
  const lectura = useDetalleLote(proyeccionId, loteId);
  const detalle = lectura.datos;
  const [marcadas, setMarcadas] = useState<ReadonlySet<string>>(new Set());
  const puede = detalle !== null && puedeRevertirLote(detalle, editable);
  const revertibles = useMemo(() => (detalle ? detalle.filas.filter((f) => f.resultado === "aplicada" && f.fila_id !== null) : []), [detalle]);
  const marcadasValidas = revertibles.filter((f) => f.fila_id !== null && marcadas.has(f.fila_id));

  function alternar(f: FilaLoteApi, valor: boolean) {
    if (f.fila_id === null) return;
    const id = f.fila_id;
    setMarcadas((prev) => {
      const s = new Set(prev);
      if (valor) s.add(id);
      else s.delete(id);
      return s;
    });
  }

  const columnas: Columna<FilaLoteApi>[] = [
    ...(puede
      ? [
          {
            clave: "marca",
            titulo: "",
            render: (f: FilaLoteApi) =>
              f.resultado === "aplicada" && f.fila_id !== null ? (
                <Checkbox checked={marcadas.has(f.fila_id)} onChange={(v) => alternar(f, v)} label={`Marcar ${f.fila_clave} para revertir`} />
              ) : null,
          },
        ]
      : []),
    { clave: "fila", titulo: "Fila", render: (f) => <span className="block max-w-72 break-words">{f.fila_clave}</span> },
    { clave: "gm", titulo: "GM", render: (f) => nombres.gm.get(f.gm_clave) ?? f.gm_clave },
    { clave: "anio", titulo: "Año", className: "text-right", render: (f) => <span className={NUM}>{f.anio}</span> },
    { clave: "fuente", titulo: "Fuente", render: (f) => ETIQUETA_FUENTE_FILA_LOTE[f.fuente] },
    {
      clave: "resultado",
      titulo: "Resultado",
      render: (f) => (f.resultado === "aplicada" ? <Badge tono="exito">aplicada</Badge> : <span title={textoRechazo(f.resultado)}><Badge tono="alerta">{f.resultado.replace(/_/g, " ")}</Badge></span>),
    },
    { clave: "valor", titulo: "Valor", className: "text-right", render: (f) => <span className={NUM}>{unidades(f.valor)}</span> },
    { clave: "esperado", titulo: "Esperado", className: "text-right", render: (f) => <span className={NUM}>{unidades(f.valor_esperado)}</span> },
    { clave: "antes", titulo: "Antes", className: "text-right", render: (f) => <span className={NUM}>{unidades(f.decidido_anterior)}</span> },
  ];

  return (
    <Modal
      titulo={lote ? `${ETIQUETA_TIPO_LOTE[lote.tipo]} del ${formatearMomento(lote.created_at)}` : "Lote"}
      descripcion={lote ? `${textoUsuarioLote(lote)} · ${lote.anio} · ${textoResultadoAprobar({ aplicadas: lote.resumen.aplicadas, rechazadas: totalRechazadasLote(lote.resumen) }, lote.tipo)}` : undefined}
      onCerrar={onCerrar}
      ancho="max-w-6xl"
      pie={
        <>
          {puede && (
            <Button
              variante="peligro"
              disabled={marcadasValidas.length === 0}
              onClick={() =>
                onRevertir({
                  tipo: "lote",
                  loteId,
                  filas: marcadasValidas.map((f) => f.fila_id as string),
                  etiqueta: `${plural(marcadasValidas.length, "fila marcada", "filas marcadas")} del lote`,
                })
              }
            >
              Revertir las marcadas ({marcadasValidas.length})
            </Button>
          )}
          {puede && (
            <Button variante="peligro" onClick={() => onRevertir({ tipo: "lote", loteId, etiqueta: "el lote entero" })}>
              Revertir el lote entero
            </Button>
          )}
          <Button variante="secundario" onClick={onCerrar}>
            Cerrar
          </Button>
        </>
      }
    >
      {lectura.error && <Alert tono="alerta">{lectura.error}</Alert>}
      {lectura.cargando && !detalle && <Cargando texto="Leyendo el lote…" />}
      {detalle && (
        <div className="space-y-3">
          {detalle.nota && <p className="text-sm text-tinta">Nota: {detalle.nota}</p>}
          <DataTable columnas={columnas} filas={detalle.filas} claveFila={(f) => f.id} vacio="El lote no tiene filas." />
        </div>
      )}
    </Modal>
  );
}

// ─── Revertir (lote, filas marcadas o confirmación) ───

/** Simula la reversión (el efecto en 2027 si es de 2026, lo que no se toca) y, al confirmar, la aplica. */
export function RevertirModal({
  proyeccionId,
  destino,
  nombres,
  onCerrar,
  onIrACrecimientos,
}: {
  proyeccionId: string;
  destino: DestinoReversion;
  nombres: Nombres;
  onCerrar: (huboCambios: boolean) => void | Promise<void>;
  onIrACrecimientos: () => void;
}) {
  // El destino se fija al abrir (el hook genera los `lote_id` de la reversión una sola vez).
  const [fijo] = useState(destino);
  const { estado, resimular, aplicar } = useReversion(proyeccionId, fijo);
  const [nota, setNota] = useState("");
  const hecho = estado.fase === "terminada";
  const sim = estado.sim?.combinado ?? null;
  const final = estado.final;

  function confirmar() {
    if (!sim) return;
    if (!confirm(`¿Revertir ${fijo.etiqueta}? ${plural(sim.totales.aplicadas, "fila vuelve", "filas vuelven")} a la propuesta; lo que otra persona cambió después no se toca.`)) return;
    void aplicar(nota);
  }

  let cuerpo;
  let pie;
  if (hecho && final) {
    cuerpo = (
      <div className="space-y-4">
        <Alert tono={final.totales.aplicadas > 0 ? "exito" : "info"}>{textoResultadoAprobar(final.totales, "revertir")}</Alert>
        {final.crecimientos_a_reaprobar.length > 0 && (
          <Alert tono="alerta">
            {final.crecimientos_a_reaprobar.length === 1 ? "1 GM queda" : `${final.crecimientos_a_reaprobar.length} GM quedan`} con crecimientos que reaprobar.{" "}
            <button type="button" onClick={onIrACrecimientos} className="font-medium underline underline-offset-2">
              Ir a Crecimientos
            </button>
          </Alert>
        )}
        <ResumenResultado r={final} nombres={nombres} reversion />
      </div>
    );
    pie = <Button onClick={() => void onCerrar(true)}>Listo</Button>;
  } else if (estado.fase === "simulando") {
    cuerpo = (
      <p className="py-8 text-center text-sm text-tinta-suave" role="status">
        Simulando la reversión, sin escribir nada…
      </p>
    );
    pie = (
      <Button variante="secundario" onClick={() => void onCerrar(false)}>
        Cancelar
      </Button>
    );
  } else if (estado.fase === "aplicando") {
    cuerpo = (
      <p className="py-8 text-center text-sm font-medium text-tinta" role="status">
        Revirtiendo…
      </p>
    );
    pie = <Button disabled>Escribiendo…</Button>;
  } else if (!sim) {
    cuerpo = estado.error ? (
      <ErrorConAcciones
        error={estado.error}
        acciones={{
          reintentar: { etiqueta: "Simular de nuevo", onClick: resimular },
          simular_de_nuevo: { etiqueta: "Simular de nuevo", onClick: resimular },
          recargar: { etiqueta: "Cerrar y actualizar", onClick: () => void onCerrar(true) },
        }}
      />
    ) : (
      <Alert>No se pudo simular la reversión.</Alert>
    );
    pie = (
      <Button variante="secundario" onClick={() => void onCerrar(false)}>
        Cerrar
      </Button>
    );
  } else {
    cuerpo = (
      <div className="space-y-4">
        {estado.error && (
          <ErrorConAcciones
            error={estado.error}
            acciones={{
              reintentar: { etiqueta: "Reintentar", onClick: confirmar },
              simular_de_nuevo: { etiqueta: "Simular de nuevo", onClick: resimular },
              recargar: { etiqueta: "Cerrar y actualizar", onClick: () => void onCerrar(true) },
            }}
          />
        )}
        {sim.crecimientos_a_reaprobar.length > 0 && (
          <Alert tono="alerta">
            Esta reversión dejará {sim.crecimientos_a_reaprobar.length === 1 ? "1 GM" : `${sim.crecimientos_a_reaprobar.length} GM`} con crecimientos que reaprobar: hasta reaprobarlos no se podrá aprobar el año siguiente ni cerrar.
          </Alert>
        )}
        <ResumenResultado r={sim} nombres={nombres} reversion />
        <Field label="Nota (opcional)" hint="Queda en el historial de la reversión.">
          <Input value={nota} maxLength={MAX_NOTA_LOTE} onChange={(e) => setNota(e.target.value)} />
        </Field>
      </div>
    );
    pie = (
      <>
        <Button variante="secundario" onClick={() => void onCerrar(false)}>
          Cancelar
        </Button>
        <Button variante="peligro" onClick={confirmar} disabled={sim.totales.aplicadas === 0}>
          Revertir {plural(sim.totales.aplicadas, "fila", "filas")}
        </Button>
      </>
    );
  }

  return (
    <Modal titulo={`Revertir ${fijo.etiqueta}`} descripcion="Vuelven a la propuesta solo las filas que nadie cambió después del lote. Una reversión no se puede revertir." onCerrar={() => void onCerrar(hecho)} cerrable={estado.fase !== "aplicando"} ancho="max-w-5xl" pie={pie}>
      {cuerpo}
    </Modal>
  );
}
