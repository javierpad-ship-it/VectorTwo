"use client";

import { useState } from "react";
import { formatearNumero, formatearPp } from "@/lib/formato";
import type { AnalisisMarcaApi, RepartoApi } from "@/lib/marcas-barrer/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import { compararConVigente, ETIQUETA_CLAVE_TEMPORADA, claveTemporada, type DiferenciaVigente } from "./ajuste";
import { ETIQUETA_FUENTE, ETIQUETA_MODO_REPARTO, formatearFraccion, formatearPorcentaje, soloFecha, textoAlcance, textoErrorReparto } from "./vista";

/**
 * Versiones del reparto: una por aprobación, la última aprobada es la vigente (el contrato con M8). Cada versión guarda la
 * ventana, el modo, la fuente, el alcance, el error del reparto y quién y cuándo la aprobó. «Comparar con lo calculado hoy»
 * pone al lado, GML por GML, lo aprobado y lo que saldría hoy con los parámetros que se ven en pantalla.
 */
export function VersionesReparto({
  analisis,
  repartos,
  cargando,
  error,
}: {
  analisis: AnalisisMarcaApi;
  repartos: RepartoApi[] | null;
  cargando: boolean;
  error: string | null;
}) {
  const [verVersion, setVerVersion] = useState<RepartoApi | null>(null);
  const [comparando, setComparando] = useState(false);
  const orden = [...(repartos ?? [])].sort((a, b) => b.version - a.version);

  const columnas: Columna<RepartoApi>[] = [
    {
      clave: "version",
      titulo: "Versión",
      className: "whitespace-nowrap",
      render: (r) => (
        <span className="font-medium">
          v{r.version} {r.vigente && <Badge tono="exito">vigente</Badge>}
        </span>
      ),
    },
    { clave: "fecha", titulo: "Aprobada", className: "whitespace-nowrap", render: (r) => soloFecha(r.aprobada_at) },
    { clave: "por", titulo: "Por", render: (r) => r.aprobada_por_nombre ?? "—" },
    { clave: "ventana", titulo: "Ventana", className: "whitespace-nowrap", render: (r) => `${r.ventana_meses} m` },
    { clave: "modo", titulo: "Modo", className: "whitespace-nowrap", render: (r) => ETIQUETA_MODO_REPARTO[r.modo] ?? r.modo },
    { clave: "fuente", titulo: "Fuente", className: "whitespace-nowrap", render: (r) => ETIQUETA_FUENTE[r.fuente] ?? r.fuente },
    { clave: "alcance", titulo: "Alcance", render: (r) => textoAlcance(r.alcance, analisis.opciones_alcance) },
    {
      clave: "error",
      titulo: "Error",
      className: "whitespace-nowrap",
      render: (r) => (r.error_reparto_pp === null ? "—" : textoErrorReparto({ pp: r.error_reparto_pp, veredicto: null })),
    },
    { clave: "nota", titulo: "Nota", className: "min-w-40", render: (r) => r.nota ?? <span className="text-tinta-suave">—</span> },
    {
      clave: "acciones",
      titulo: "",
      render: (r) => (
        <Button tamano="sm" variante="secundario" onClick={() => setVerVersion(r)} aria-label={`Ver las filas de la versión ${r.version}`}>
          Ver filas
        </Button>
      ),
    },
  ];

  return (
    <Card
      titulo="Versiones del reparto"
      descripcion="Cada aprobación crea una versión nueva; la anterior queda guardada. M8 usa la vigente y no la recalcula."
      acciones={
        analisis.vigente ? (
          <Button variante="secundario" onClick={() => setComparando(true)}>
            Comparar v{analisis.vigente.version} con lo calculado hoy
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {error && <Alert>No se pudieron leer las versiones: {error}</Alert>}
        <DataTable columnas={columnas} filas={orden} claveFila={(r) => r.id} cargando={cargando && repartos === null} vacio="Todavía no se aprobó ningún reparto de esta marca." />
      </div>
      {verVersion && <FilasVersionModal reparto={verVersion} onCerrar={() => setVerVersion(null)} />}
      {comparando && analisis.vigente && <CompararModal analisis={analisis} onCerrar={() => setComparando(false)} />}
    </Card>
  );
}

function FilasVersionModal({ reparto, onCerrar }: { reparto: RepartoApi; onCerrar: () => void }) {
  const columnas: Columna<RepartoApi["filas"][number]>[] = [
    { clave: "ruta", titulo: "GML / unidad", render: (f) => <span className="font-medium">{f.ruta}</span> },
    { clave: "temporada", titulo: "Temporada", render: (f) => ETIQUETA_CLAVE_TEMPORADA[claveTemporada(f.temporada)] },
    { clave: "unidades", titulo: "Unid.", className: "text-right tabular-nums", render: (f) => formatearNumero(f.unidades_ventana) },
    { clave: "calculada", titulo: "Calculada", className: "text-right tabular-nums", render: (f) => formatearFraccion(f.participacion_calculada) },
    { clave: "ajustada", titulo: "Ajustada", className: "text-right tabular-nums", render: (f) => formatearFraccion(f.participacion_ajustada) },
    { clave: "vigente", titulo: "Vigente", className: "text-right font-medium tabular-nums", render: (f) => formatearFraccion(f.participacion_vigente) },
    { clave: "resto", titulo: "Resto", render: (f) => (f.grupo_resto ? <Badge>en un resto</Badge> : "") },
  ];
  return (
    <Modal
      titulo={`Versión ${reparto.version} del reparto`}
      descripcion={`Aprobada el ${soloFecha(reparto.aprobada_at)} por ${reparto.aprobada_por_nombre ?? "—"} · hasta ${reparto.hasta_periodo.slice(0, 7)}${reparto.nota ? ` · nota: ${reparto.nota}` : ""}`}
      onCerrar={onCerrar}
      pie={<Button variante="secundario" onClick={onCerrar}>Cerrar</Button>}
    >
      <DataTable columnas={columnas} filas={reparto.filas} claveFila={(f) => `${f.gml_id}|${f.equivalencia_id ?? ""}|${f.temporada ?? ""}`} vacio="La versión no guardó filas." />
    </Modal>
  );
}

function CompararModal({ analisis, onCerrar }: { analisis: AnalisisMarcaApi; onCerrar: () => void }) {
  const { filas, maximoPp } = compararConVigente(analisis);
  const columnas: Columna<DiferenciaVigente>[] = [
    { clave: "ruta", titulo: "GML / unidad", render: (f) => <span className="font-medium">{f.etiqueta}</span> },
    { clave: "temporada", titulo: "Temporada", render: (f) => ETIQUETA_CLAVE_TEMPORADA[f.temporada] },
    { clave: "vigente", titulo: `Vigente v${analisis.vigente?.version}`, className: "text-right tabular-nums", render: (f) => formatearPorcentaje(f.vigente) },
    { clave: "hoy", titulo: "Calculado hoy", className: "text-right tabular-nums", render: (f) => formatearPorcentaje(f.hoy) },
    {
      clave: "dif",
      titulo: "Diferencia",
      className: "text-right tabular-nums",
      render: (f) => <span className={Math.abs(f.difPp) > 5 ? "font-semibold text-alerta" : undefined}>{`${f.difPp > 0 ? "+" : ""}${formatearPp(f.difPp, 1)}`}</span>,
    },
  ];
  return (
    <Modal
      titulo={`Comparar v${analisis.vigente?.version} con lo calculado hoy`}
      descripcion={`Hoy se calcula con ventana de ${analisis.parametros.ventana_meses} meses, ${ETIQUETA_MODO_REPARTO[analisis.parametros.modo_efectivo]}, alcance: ${textoAlcance(analisis.parametros.alcance, analisis.opciones_alcance)}. La diferencia máxima es ${formatearPp(maximoPp, 1)}.`}
      onCerrar={onCerrar}
      pie={<Button variante="secundario" onClick={onCerrar}>Cerrar</Button>}
    >
      <DataTable columnas={columnas} filas={filas} claveFila={(f) => `${f.clave}|${f.temporada}`} vacio="La versión vigente no tiene filas para comparar." />
    </Modal>
  );
}
