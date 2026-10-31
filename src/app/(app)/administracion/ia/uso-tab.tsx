"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/form";
import type { CorridaApi } from "@/lib/ia/tipos-api";
import { AlertaError, Cargando, NUM } from "@/app/(app)/planificacion/proyeccion/comunes";
import { etiquetaProveedor, textoEstadoCorrida, usd } from "@/app/(app)/planificacion/proyeccion/propuesta-ia-vista";
import { useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import { formatearMomento, unidades } from "@/app/(app)/planificacion/proyeccion/vista";
import { diaCorto, nombreMes, type RespuestaUsoApi } from "./ia-vista";

type DiaUso = RespuestaUsoApi["por_dia"][number];

/** El uso de un mes ya leído: costo contra tope, llamadas por día y corridas. */
export function UsoVista({ datos }: { datos: RespuestaUsoApi }) {
  const dias: Columna<DiaUso>[] = [
    { clave: "dia", titulo: "Día", render: (d) => diaCorto(d.dia) },
    { clave: "llamadas", titulo: "Llamadas", className: NUM, render: (d) => unidades(d.llamadas) },
    { clave: "costo", titulo: "Costo", className: NUM, render: (d) => usd(d.costo_usd) },
  ];
  const corridas: Columna<CorridaApi>[] = [
    { clave: "cuando", titulo: "Cuándo", render: (c) => formatearMomento(c.iniciada_at) },
    { clave: "quien", titulo: "Quién", render: (c) => c.usuario_nombre ?? "—" },
    { clave: "terna", titulo: "Proveedor · modelo · prompt", render: (c) => `${etiquetaProveedor(c.proveedor)} · ${c.modelo} · ${c.version_prompt}` },
    { clave: "gm", titulo: "GM hechos · reusados · fallidos", className: NUM, render: (c) => `${c.gm_hechos} · ${c.gm_reusados} · ${c.gm_fallidos} de ${c.gm_total}` },
    { clave: "costo", titulo: "Costo (estimado)", className: NUM, render: (c) => `${usd(c.costo_usd)} (${usd(c.costo_estimado_usd)})` },
    {
      clave: "estado",
      titulo: "Estado",
      render: (c) => (
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tono={c.estado === "completa" ? "exito" : c.estado === "en_curso" ? "marca" : "alerta"}>{textoEstadoCorrida(c.estado)}</Badge>
          {c.motivo_fin && <span className="text-xs text-tinta-suave">{c.motivo_fin.replace(/_/g, " ")}</span>}
        </span>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <Card titulo={`Uso de ${nombreMes(datos.mes)}`} descripcion="Todo se deriva de las llamadas registradas; corridas y evaluaciones cuentan juntas contra el tope.">
        <p className="text-sm">
          Costo del mes: <span className="font-mono font-semibold tabular-nums">{usd(datos.costo_usd)}</span>
          {datos.tope_usd_mes !== null && (
            <>
              {" "}
              de <span className="font-mono tabular-nums">{usd(datos.tope_usd_mes)}</span> de tope
            </>
          )}
          .
        </p>
      </Card>
      <Card titulo="Por día">
        <DataTable columnas={dias} filas={datos.por_dia} claveFila={(d) => d.dia} vacio="Sin llamadas en este mes." />
      </Card>
      <Card titulo="Corridas" descripcion="Cada pedido de propuesta o evaluación del mes.">
        <DataTable columnas={corridas} filas={datos.corridas} claveFila={(c) => c.id} vacio="Sin corridas en este mes." />
      </Card>
    </div>
  );
}

/** Pestaña Uso: por mes (el del servidor por defecto). */
export function UsoTab() {
  const [mes, setMes] = useState("");
  const lectura = useLectura<RespuestaUsoApi>(mes ? `/api/ia/uso?mes=${encodeURIComponent(mes)}` : "/api/ia/uso");
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <Field label="Mes">
          <Input type="month" value={mes || lectura.datos?.mes || ""} onChange={(e) => setMes(e.target.value)} />
        </Field>
      </div>
      {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
      {lectura.cargando && !lectura.datos && <Cargando texto="Leyendo el uso…" />}
      {lectura.datos && <UsoVista datos={lectura.datos} />}
    </div>
  );
}
