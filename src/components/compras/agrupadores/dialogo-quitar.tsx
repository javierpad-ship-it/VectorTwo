"use client";

import { DataTable, type Columna } from "@/components/ui/data-table";
import type { QuitarAsignaciones } from "@/lib/compras/agrupadores/esquemas";
import type { AsignacionApi, EmbarqueDetalleApi, RespuestaMovimientoApi } from "@/lib/compras/agrupadores/tipos-api";
import { quitarAsignaciones } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { mesCorto, unidades } from "../formato";
import { DialogoMovimiento } from "./dialogo-movimiento";
import { nombreConTipo, textoLinea } from "./vista-agrupadores";

/**
 * «Quitar del embarque» (ficha 08b §3.3): las unidades quedan sin embarque en el mismo mes, así que no cambia ninguna fecha. Se permite en
 * cualquier estado del embarque, también cancelado o recibido (es la salida de una mercadería que quedó atada). Pide vista previa y un
 * `confirm`; con recepciones ya confirmadas sobre la asignación, la API responde `409 asignacion_con_recepciones`.
 */
export function DialogoQuitar({
  embarque,
  asignaciones,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  asignaciones: readonly AsignacionApi[];
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const cuerpo: QuitarAsignaciones | null = asignaciones.length === 0 ? null : { revision: embarque.revision, asignaciones: asignaciones.map((a) => ({ id: a.id, compra_revision: a.compra.revision })) };
  const total = asignaciones.reduce((a, x) => a + x.unidades, 0);
  const columnas: Columna<AsignacionApi>[] = [
    { clave: "compra", titulo: "Compra", render: (a) => <span className="whitespace-nowrap font-medium">{a.compra.numero}</span> },
    { clave: "linea", titulo: "Línea", render: (a) => <span className="whitespace-nowrap text-xs">{textoLinea(a.linea)}</span> },
    { clave: "mes", titulo: "Mes", render: (a) => <span className="whitespace-nowrap text-xs">{mesCorto(a.periodo)}</span> },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (a) => <span className="font-mono tabular-nums">{unidades(a.unidades)}</span> },
  ];
  return (
    <DialogoMovimiento
      titulo={`Quitar del ${nombreConTipo("Embarque", embarque.codigo).toLowerCase()}`}
      descripcion="Las unidades quedan sin embarque, en el mismo mes: no se cambia ninguna fecha ni se borra nada."
      cuerpo={cuerpo}
      llamar={(c, previsualizar) => quitarAsignaciones(embarque.id, c, previsualizar)}
      onAplicado={onAplicado}
      onCerrar={onCerrar}
      onRecargar={onRecargar}
      textoAplicar="Quitar del embarque"
      confirmar={(plan) => `¿Quitar ${unidades(plan.unidades_movidas)} u de ${plural(plan.compras_afectadas, "compra", "compras")} del embarque ${embarque.codigo}? Quedan sin embarque, en el mismo mes.`}
      pista="Marca primero qué quitar en el detalle del embarque."
    >
      <div className="space-y-2">
        <p className="text-sm">
          Vas a quitar <strong>{unidades(total)} u</strong> de {plural(asignaciones.length, "asignación", "asignaciones")}.
        </p>
        <DataTable columnas={columnas} filas={asignaciones as AsignacionApi[]} claveFila={(a) => a.id} />
      </div>
    </DialogoMovimiento>
  );
}
