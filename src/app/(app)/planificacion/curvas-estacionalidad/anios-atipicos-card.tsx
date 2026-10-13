"use client";

import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import type { AniosAtipicosRespuesta } from "./tipos";
import { resumirMeses } from "./meses";

const ALCANCE_CORTO = { invierno: "invierno", todas: "todas las agrupaciones" } as const;

/**
 * «Años marcados como atípicos»: lo que `GET /api/periodos-atipicos/anios?temporada=invierno`
 * entrega a M7 (qué años fueron de El Niño y con qué meses), tal como lo verá
 * quien proyecte unidades de invierno.
 */
export function AniosAtipicosCard({
  datos,
  cargando,
  error,
  onCerrarError,
}: {
  datos: AniosAtipicosRespuesta | null;
  cargando: boolean;
  error: string | null;
  onCerrarError: () => void;
}) {
  const atipicos = datos?.anios.filter((a) => a.clase === "atipico") ?? [];
  const normales = datos?.resumen.anios_normales_completos ?? [];

  return (
    <Card titulo="Años marcados como atípicos" descripcion="Para las agrupaciones de invierno, según los periodos activos.">
      {error && (
        <div className="mb-3">
          <Alert onCerrar={onCerrarError}>No se pudo leer la lista de años atípicos: {error}</Alert>
        </div>
      )}
      {!datos ? (
        <p className="text-sm text-tinta-suave">{cargando ? "Cargando…" : "Sin información."}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            <strong>Atípicos: </strong>
            {atipicos.length === 0 ? (
              <span className="text-tinta-suave">ninguno todavía. Crea los periodos de abajo para marcarlos.</span>
            ) : (
              atipicos.map((a, i) => {
                const motivos = a.periodos.map((p) => `${p.motivo} (${ALCANCE_CORTO[p.alcance]})`).join(" + ");
                return (
                  <span key={a.anio}>
                    {i > 0 && " · "}
                    <strong>{a.anio}</strong> ({motivos}: {resumirMeses(a.meses_atipicos, false)}
                    {a.completo ? "" : "; año aún sin cargar completo"})
                  </span>
                );
              })
            )}
          </p>
          <p>
            <strong>Normales completos: </strong>
            {normales.length === 0 ? <span className="text-tinta-suave">ninguno</span> : normales.join(", ")}
          </p>
          <p className="text-xs text-tinta-suave">M7 usa esta lista al proyectar unidades de invierno.</p>
        </div>
      )}
    </Card>
  );
}
