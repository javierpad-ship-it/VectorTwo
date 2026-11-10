import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { AprobacionApi } from "@/lib/direccion/tipos-api";
import { filasHistorial, type FilaHistorial } from "./vista-tablero";

const TONO: Record<FilaHistorial["resultado"], "exito" | "marca" | "alerta"> = { aprobada: "exito", con_observaciones: "marca", rechazada: "alerta" };

const COLUMNAS: Columna<FilaHistorial>[] = [
  { clave: "fecha", titulo: "Fecha y hora (Lima)", className: "whitespace-nowrap", render: (h) => h.fecha },
  { clave: "quien", titulo: "Quién", className: "whitespace-nowrap", render: (h) => h.quien },
  {
    clave: "resultado",
    titulo: "Resultado",
    render: (h) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tono={TONO[h.resultado]}>{h.etiqueta}</Badge>
        {h.invalidada && <Badge tono="alerta">{h.invalidada}</Badge>}
      </span>
    ),
  },
  { clave: "motivo", titulo: "Motivo", render: (h) => h.motivo || "—" },
  { clave: "comentario", titulo: "Comentario", className: "min-w-56 whitespace-pre-wrap", render: (h) => h.comentario || "—" },
  { clave: "sobre", titulo: "Sobre", className: "whitespace-nowrap", render: (h) => h.sobre },
];

/**
 * Historial de aprobaciones de la proyección mostrada (ficha 14, §4.10), para todos los que ven la página: fecha y hora de Lima, quién, resultado
 * (con texto), motivo, comentario, sobre qué estado se decidió y si quedó invalidada. De la más reciente a la más antigua.
 */
export function HistorialAprobaciones({ historial, cargando, error, onReintentar }: { historial: readonly AprobacionApi[] | null; cargando: boolean; error: string | null; onReintentar?: () => void }) {
  return (
    <Card titulo="Historial de aprobaciones" descripcion="Cada decisión de dirección sobre esta proyección. Un registro nunca se edita ni se borra: una decisión nueva se suma.">
      {error && (
        <div className="mb-3">
          <Alert tono="alerta">
            No se pudo leer el historial: {error}
            {onReintentar && (
              <>
                {" "}
                <button type="button" onClick={onReintentar} className="font-medium underline underline-offset-2">
                  Reintentar
                </button>
              </>
            )}
          </Alert>
        </div>
      )}
      {!error && <DataTable columnas={COLUMNAS} filas={historial ? filasHistorial(historial) : []} claveFila={(h) => h.id} cargando={cargando && historial === null} vacio="Esta proyección todavía no tiene decisiones de dirección." />}
    </Card>
  );
}
