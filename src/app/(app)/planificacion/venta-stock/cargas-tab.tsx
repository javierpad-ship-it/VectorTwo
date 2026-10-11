"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { DescartarCargaRespuesta, LimpiarRespuesta, MesCarga } from "@/lib/ventas/tipos-api";
import { DetalleCarga } from "./detalle-carga";
import type { useCargas } from "./use-cargas";
import { formatearEntero, formatearFechaHora, formatearHora, formatearPct, formatearSoles, nombrePeriodo } from "./comunes";

type Filtro = "todos" | "cargados" | "faltantes";

/** La API manda el porcentaje de errores como 0 a 100 (o `null` si no lo conoce). */
function pctIncompleto(m: MesCarga): number | null {
  const v = m.incompleto?.porcentaje;
  return v === null || v === undefined || !Number.isFinite(v) ? null : v / 100;
}

function EstadoMes({ mes }: { mes: MesCarga }) {
  if (mes.estado === "cargado") {
    const pct = pctIncompleto(mes);
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tono="exito">Cargado</Badge>
        {mes.incompleto && <Badge tono="alerta">Incompleto{pct !== null ? ` ${formatearPct(pct)}` : ""}</Badge>}
        {mes.verificacion && !mes.verificacion.coincide && <Badge tono="alerta">Totales no coinciden</Badge>}
        {mes.en_curso && <Badge tono="marca">{mes.en_curso.caducada ? "Recarga caducada" : "Recarga en curso"}</Badge>}
      </span>
    );
  }
  if (mes.estado === "en_curso") {
    const e = mes.en_curso;
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tono="marca">En curso</Badge>
        <span className="text-xs text-tinta-suave">
          {e ? `por ${e.usuario_nombre ?? "alguien"} desde las ${formatearHora(e.created_at)}` : ""}
          {e?.caducada ? " · caducada" : ""}
        </span>
      </span>
    );
  }
  return <Badge tono="alerta">Sin cargar</Badge>;
}

/**
 * Pestaña "Cargas por mes": cobertura de enero de 2023 al último mes cerrado,
 * con los meses que faltan a la vista, totales guardados, retiro, abandono,
 * verificación en SQL y limpieza de filas huérfanas.
 */
export function CargasTab({ cargas, onCambio }: { cargas: ReturnType<typeof useCargas>; onCambio: () => void }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [detalle, setDetalle] = useState<{ id: string; periodo: string } | null>(null);

  const meses = useMemo(() => cargas.datos?.meses ?? [], [cargas.datos]);
  const meta = cargas.datos?.meta;
  // Del rango esperado (enero de 2023 al último mes cerrado): `meses` también trae meses fuera de rango con carga.
  const cargados = meta?.meses_cargados ?? meses.filter((m) => m.estado === "cargado").length;
  const faltantes = meta?.faltantes.length ?? meses.filter((m) => m.estado !== "cargado").length;
  const visibles = useMemo(
    () => meses.filter((m) => (filtro === "todos" ? true : filtro === "cargados" ? m.estado === "cargado" : m.estado !== "cargado")),
    [meses, filtro]
  );
  const desajustados = meses.filter((m) => m.verificacion && !m.verificacion.coincide);
  const verificado = cargas.datos?.verificado === true;
  const pendiente = cargas.datos?.limpieza_pendiente ?? 0;

  const chips: ChipItem<Filtro>[] = [
    { id: "todos", label: "Todos", conteo: meses.length },
    { id: "cargados", label: "Cargados", conteo: cargados },
    { id: "faltantes", label: "Faltantes", conteo: faltantes },
  ];

  async function accion(clave: string, fn: () => Promise<void>) {
    setOcupado(clave);
    setError(null);
    setAviso(null);
    try {
      await fn();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(null);
    }
  }

  function retirar(m: MesCarga) {
    if (!m.carga) return;
    const filas = m.carga.filas !== null ? ` (${formatearNumero(m.carga.filas)} filas)` : "";
    if (
      !confirm(
        `¿Retirar la carga de ${nombrePeriodo(m.periodo)}${filas}?\n\nEl mes dejará de verse en toda la herramienta y quedará como "Sin cargar" hasta que lo vuelvas a cargar. Las filas se borran después con la limpieza.`
      )
    )
      return;
    const id = m.carga.id;
    void accion(`retirar-${m.periodo}`, async () => {
      await api.delete<DescartarCargaRespuesta>(`/api/ventas/cargas/${id}`);
      setDetalle(null);
      setAviso(`Se retiró la carga de ${nombrePeriodo(m.periodo)}.`);
      onCambio();
    });
  }

  function abandonar(m: MesCarga) {
    const e = m.en_curso;
    if (!e) return;
    const motivo = e.caducada
      ? "Lleva más de 30 minutos sin actividad."
      : `Si ${e.usuario_nombre ?? "otra persona"} todavía está cargando, su carga se cancelará y tendrá que empezar de nuevo.`;
    if (!confirm(`¿Abandonar la carga en curso de ${nombrePeriodo(m.periodo)}?\n\n${motivo}\nEl mes que ya estaba publicado, si lo hay, no cambia.`)) return;
    void accion(`abandonar-${m.periodo}`, async () => {
      await api.delete<DescartarCargaRespuesta>(`/api/ventas/cargas/${e.id}`);
      setAviso(`Se abandonó la carga en curso de ${nombrePeriodo(m.periodo)}.`);
      onCambio();
    });
  }

  function limpiar() {
    void accion("limpiar", async () => {
      const r = await api.post<LimpiarRespuesta>("/api/ventas/cargas/limpiar", {});
      setAviso(
        r.cargas_limpiadas === 0
          ? "No había nada que limpiar."
          : `Limpieza hecha: ${plural(r.cargas_limpiadas, "carga", "cargas")} y ${plural(r.filas_borradas, "fila borrada", "filas borradas")}.`
      );
      onCambio();
    });
  }

  const columnas: Columna<MesCarga>[] = [
    { clave: "periodo", titulo: "Mes", render: (m) => <span className="whitespace-nowrap font-medium">{nombrePeriodo(m.periodo)}</span> },
    { clave: "estado", titulo: "Estado", render: (m) => <EstadoMes mes={m} /> },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (m) => formatearEntero(m.carga?.filas) },
    { clave: "unidades", titulo: "Unidades", className: "text-right font-mono", render: (m) => formatearEntero(m.carga?.unidades) },
    { clave: "venta", titulo: "Venta", className: "text-right font-mono", render: (m) => formatearSoles(m.carga?.venta_soles) },
    { clave: "costo", titulo: "Costo", className: "text-right font-mono", render: (m) => formatearSoles(m.carga?.costo_vendido) },
    { clave: "stock_u", titulo: "Stock (u.)", className: "text-right font-mono", render: (m) => formatearEntero(m.carga?.stock_unidades) },
    { clave: "stock_v", titulo: "Stock a costo", className: "text-right font-mono", render: (m) => formatearSoles(m.carga?.stock_valorizado) },
    {
      clave: "archivo",
      titulo: "Archivo",
      render: (m) => <span className="block max-w-48 truncate text-xs text-tinta-suave" title={m.carga?.archivo_nombre ?? undefined}>{m.carga?.archivo_nombre ?? "—"}</span>,
    },
    { clave: "quien", titulo: "Quién", render: (m) => <span className="text-xs">{m.carga?.usuario_nombre ?? "—"}</span> },
    { clave: "fecha", titulo: "Fecha", render: (m) => <span className="whitespace-nowrap text-xs">{formatearFechaHora(m.carga?.publicada_at)}</span> },
    {
      clave: "acciones",
      titulo: "",
      render: (m) => (
        <span className="flex gap-1">
          {m.estado === "cargado" && m.carga && (
            <Button variante="fantasma" tamano="sm" onClick={() => setDetalle({ id: m.carga?.id ?? "", periodo: m.periodo })} aria-label={`Ver el detalle de ${nombrePeriodo(m.periodo)}`}>
              Detalle
            </Button>
          )}
          {m.estado === "cargado" && m.carga && (
            <Button variante="peligro" tamano="sm" disabled={ocupado !== null} onClick={() => retirar(m)}>
              {ocupado === `retirar-${m.periodo}` ? "Retirando…" : "Retirar"}
            </Button>
          )}
          {m.en_curso && (
            <Button variante="secundario" tamano="sm" disabled={ocupado !== null} onClick={() => abandonar(m)}>
              {ocupado === `abandonar-${m.periodo}` ? "Abandonando…" : "Abandonar"}
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {(cargas.error || error) && (
        <Alert
          onCerrar={() => {
            cargas.setError(null);
            setError(null);
          }}
        >
          {error ?? `No se pudieron cargar las cargas: ${cargas.error}`}
        </Alert>
      )}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      {pendiente > 0 && (
        <Alert tono="info">
          <span className="flex flex-wrap items-center gap-3">
            <span>
              <strong>Limpieza pendiente:</strong> {plural(pendiente, "carga reemplazada, retirada o abandonada conserva", "cargas reemplazadas, retiradas o abandonadas conservan")}{" "}
              filas que nadie ve. No afecta a los datos; libera espacio.
            </span>
            <Button tamano="sm" onClick={limpiar} disabled={ocupado !== null}>
              {ocupado === "limpiar" ? "Limpiando…" : "Limpiar ahora"}
            </Button>
          </span>
        </Alert>
      )}

      {verificado && (
        <Alert tono={desajustados.length === 0 ? "exito" : "alerta"}>
          {desajustados.length === 0
            ? "Verificación hecha: los totales guardados de todos los meses cargados coinciden con lo que mide la base."
            : `Verificación hecha: ${plural(desajustados.length, "mes tiene", "meses tienen")} totales distintos a los guardados (${desajustados
                .map((m) => nombrePeriodo(m.periodo))
                .join(", ")}). Alguien pudo tocar la base; recarga el mes.`}
        </Alert>
      )}

      <Card
        titulo={meta ? `${formatearNumero(cargados)} de ${formatearNumero(meta.meses_esperados)} meses cargados` : "Cargas por mes"}
        descripcion={
          meta
            ? `De ${nombrePeriodo(meta.desde)} a ${nombrePeriodo(meta.hasta)}, el último mes cerrado. ${
                faltantes > 0 ? `Faltan ${plural(faltantes, "mes", "meses")}.` : "No falta ninguno."
              }`
            : undefined
        }
        acciones={
          <Button variante="secundario" tamano="sm" onClick={() => void cargas.verificar()} disabled={cargas.verificando || cargas.cargando}>
            {cargas.verificando ? "Verificando…" : "Verificar totales"}
          </Button>
        }
      >
        <div className="space-y-3">
          <Chips items={chips} activo={filtro} onCambiar={setFiltro} etiqueta="Filtrar meses" />
          <DataTable
            columnas={columnas}
            filas={visibles}
            claveFila={(m) => m.periodo}
            cargando={cargas.cargando && meses.length === 0}
            vacio={filtro === "faltantes" ? "No falta ningún mes." : "Ningún mes para mostrar."}
            claseFila={(m) => (m.estado === "cargado" ? "hover:bg-fondo/60" : "bg-alerta-suave/40")}
          />
          <p className="text-xs text-tinta-suave">
            Los totales son los que midió la base al publicar cada mes. Un hueco entre dos meses cargados se ve en ámbar. Retirar un mes lo
            oculta; para reemplazarlo basta cargarlo de nuevo.
          </p>
        </div>
      </Card>

      {detalle && <DetalleCarga key={detalle.id} id={detalle.id} periodo={detalle.periodo} onCerrar={() => setDetalle(null)} />}
    </div>
  );
}
