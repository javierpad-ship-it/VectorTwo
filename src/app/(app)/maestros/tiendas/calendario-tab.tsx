"use client";

import { useMemo, useState, type ReactNode } from "react";
import { agruparPorMes } from "@/lib/tiendas/aperturas";
import type { EventoTienda, TiendaFila } from "@/lib/tiendas/tipos-api";
import { formatearNumero, plural } from "@/lib/formato";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/form";
import { BadgeEstado, formatearDiaMes, formatearMonto } from "./comunes";
import { useAperturas } from "./use-aperturas";

function claveEvento(e: EventoTienda): string {
  return `${e.tienda_id}-${e.evento}`;
}

/** Primer día del mes de hace 12 meses respecto a `hoy` (ISO): corte por defecto del historial. */
function corteHistorial(hoy: string): string {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(hoy);
  if (!m) return "0000-00-00";
  return `${Number(m[1]) - 1}-${m[2]}-01`;
}

/**
 * Pestaña Calendario: línea de tiempo de aperturas y cierres agrupada por
 * mes, con "Ver la red al día" (`?hoy=`) para simular otra fecha.
 */
export function CalendarioTab({
  mostrarInactivos,
  hoyInicial,
  sinFechaApertura,
  onIrAPlanificadas,
}: {
  mostrarInactivos: boolean;
  hoyInicial: string;
  /** Tiendas activas de tipo Tienda sin apertura (de la colección del panel), para listar sus códigos. */
  sinFechaApertura: TiendaFila[];
  onIrAPlanificadas: () => void;
}) {
  const [hoy, setHoy] = useState(hoyInicial);
  const [todoHistorial, setTodoHistorial] = useState(false);
  const { datos, cargando, error, setError, fechaValida } = useAperturas(hoy, mostrarInactivos);

  const eventos = useMemo(() => datos?.eventos ?? [], [datos]);
  const corte = corteHistorial(hoy);
  const { visibles, ocultos } = useMemo(() => {
    if (todoHistorial) return { visibles: eventos, ocultos: 0 };
    const v = eventos.filter((e) => e.fecha >= corte);
    return { visibles: v, ocultos: eventos.length - v.length };
  }, [eventos, corte, todoHistorial]);
  const grupos = useMemo(() => agruparPorMes(visibles), [visibles]);
  // El separador "Hoy" va antes del primer evento no pasado, solo si hay algo pasado antes;
  // si todo es pasado, al final de la lista; si nada es pasado, no hace falta.
  const separador = useMemo(() => {
    const hayPasados = visibles.some((e) => e.pasado);
    if (!hayPasados) return { antesDe: null, alFinal: false };
    const primero = visibles.find((e) => !e.pasado);
    return primero ? { antesDe: claveEvento(primero), alFinal: false } : { antesDe: null, alFinal: true };
  }, [visibles]);

  const resumen = datos?.resumen;
  const simulando = hoy !== hoyInicial;

  const filasGrupos: ReactNode[] = grupos.map((g) => (
    <section key={g.mes}>
      <h3 className="mb-1 text-sm font-semibold text-tinta first-letter:uppercase">{g.etiqueta}</h3>
      <ul className="divide-y divide-borde rounded-lg border border-borde">
        {g.eventos.map((e: EventoTienda) => (
          <li key={claveEvento(e)}>
            {separador.antesDe === claveEvento(e) && <SeparadorHoy hoy={hoy} />}
            <FilaEvento evento={e} />
          </li>
        ))}
      </ul>
    </section>
  ));

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>No se pudo cargar el calendario: {error}</Alert>}

      <div className="grid gap-3 sm:grid-cols-3">
        <TarjetaResumen titulo="Próximas aperturas" valor={resumen?.proximas_aperturas} tono="exito" />
        <TarjetaResumen titulo="Próximos cierres" valor={resumen?.proximos_cierres} tono="neutro" />
        <TarjetaResumen titulo="Sin fecha de apertura" valor={resumen?.sin_fecha_apertura} tono={sinFechaApertura.length > 0 ? "alerta" : "neutro"}>
          {sinFechaApertura.length > 0 && (
            <div className="mt-2 space-y-2 text-xs">
              <p className="text-tinta-suave">Quedan Planificadas y la proyección (M7) no sabrá desde cuándo venden. Completa la fecha en la pestaña Tiendas.</p>
              <ul className="flex flex-wrap gap-1">
                {sinFechaApertura.map((t) => (
                  <li key={t.id} className="rounded-md border border-borde bg-superficie px-1.5 py-0.5 font-mono text-tinta" title={t.nombre}>
                    {t.codigo}
                  </li>
                ))}
              </ul>
              <button type="button" onClick={onIrAPlanificadas} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
                Ver las planificadas en Tiendas →
              </button>
            </div>
          )}
        </TarjetaResumen>
      </div>

      <Card
        titulo="Línea de tiempo"
        descripcion={
          datos
            ? `${plural(datos.eventos.length, "fecha registrada", "fechas registradas")} · red al día ${formatearDiaMes(datos.hoy)}/${datos.hoy.slice(0, 4)}`
            : "Aperturas y cierres registrados, por mes."
        }
        acciones={
          <Field label="Ver la red al día" hint={simulando ? "Simulación: los estados se calculan a esa fecha." : undefined} className="w-44">
            <Input type="date" value={hoy} onChange={(e) => setHoy(e.target.value)} className="h-8" aria-label="Ver la red al día" />
          </Field>
        }
      >
        {!fechaValida ? (
          <Alert>Escribe una fecha válida para ver la red a ese día.</Alert>
        ) : cargando && !datos ? (
          <p className="py-6 text-center text-sm text-tinta-suave">Cargando…</p>
        ) : eventos.length === 0 ? (
          <EmptyState titulo="Sin fechas registradas." detalle="Carga las fechas de apertura en la pestaña Tiendas." />
        ) : (
          <div className="space-y-5">
            {simulando && (
              <Alert tono="info">
                Viendo la red al {formatearDiaMes(hoy)}/{hoy.slice(0, 4)}: el estado de cada tienda y qué cuenta como pasado se calculan a esa
                fecha.{" "}
                <button type="button" onClick={() => setHoy(hoyInicial)} className="font-medium underline-offset-2 hover:underline">
                  Volver a hoy
                </button>
              </Alert>
            )}
            {ocultos > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
                <span>Se muestran los últimos 12 meses y todo el futuro; {plural(ocultos, "fecha anterior oculta", "fechas anteriores ocultas")}.</span>
                <Button variante="secundario" tamano="sm" onClick={() => setTodoHistorial(true)}>
                  Ver todo el historial
                </Button>
              </div>
            )}
            {todoHistorial && eventos.some((e) => e.fecha < corte) && (
              <div className="text-xs text-tinta-suave">
                <Button variante="fantasma" tamano="sm" onClick={() => setTodoHistorial(false)}>
                  Ver solo los últimos 12 meses
                </Button>
              </div>
            )}
            {visibles.length === 0 ? (
              <EmptyState titulo="Sin fechas en los últimos 12 meses ni en el futuro." detalle="Usa «Ver todo el historial» para ver las anteriores." />
            ) : (
              <>
                {filasGrupos}
                {separador.alFinal && <SeparadorHoy hoy={hoy} />}
              </>
            )}
            {cargando && <p className="text-xs italic text-tinta-suave">Actualizando…</p>}
          </div>
        )}
      </Card>
    </div>
  );
}

function FilaEvento({ evento: e }: { evento: EventoTienda }) {
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm ${e.pasado ? "opacity-60" : ""}`}>
      <span className="w-12 font-mono text-xs text-tinta-suave">{formatearDiaMes(e.fecha)}</span>
      {e.evento === "apertura" ? <Badge tono="exito">Apertura</Badge> : <Badge tono="alerta">Cierre</Badge>}
      <code className="font-mono text-xs">{e.codigo}</code>
      <span className="font-medium">{e.nombre}</span>
      {e.tipo === "Centro de Distribución" && <Badge tono="marca">CD</Badge>}
      {e.zona && <span className="text-tinta-suave">{e.zona}</span>}
      {e.evento === "apertura" && e.venta_esperada_promedio !== null && (
        <span className="font-mono text-xs text-tinta-suave" title="Venta esperada (S/ por mes)">
          {formatearMonto(e.venta_esperada_promedio)}
        </span>
      )}
      <span className="ml-auto">
        <BadgeEstado estado={e.estado} />
      </span>
    </div>
  );
}

function SeparadorHoy({ hoy }: { hoy: string }) {
  return (
    <div className="flex items-center gap-2 bg-marca-suave px-3 py-1 text-xs font-semibold uppercase tracking-wide text-marca-oscura" role="separator">
      Hoy <span className="font-mono font-normal normal-case">{formatearDiaMes(hoy)}/{hoy.slice(0, 4)}</span>
    </div>
  );
}

function TarjetaResumen({
  titulo,
  valor,
  tono,
  children,
}: {
  titulo: string;
  valor: number | undefined;
  tono: "exito" | "neutro" | "alerta";
  children?: ReactNode;
}) {
  const borde = { exito: "border-exito/30", neutro: "border-borde", alerta: "border-alerta/30" }[tono];
  return (
    <div className={`rounded-lg border ${borde} bg-fondo p-3`}>
      <div className="text-xs font-medium uppercase tracking-wide text-tinta-suave">{titulo}</div>
      <div className="mt-1 font-mono text-2xl font-semibold text-tinta">{valor === undefined ? "…" : formatearNumero(valor)}</div>
      {children}
    </div>
  );
}
