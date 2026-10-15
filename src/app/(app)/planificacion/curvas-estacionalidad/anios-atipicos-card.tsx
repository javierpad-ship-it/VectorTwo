"use client";

import { ETIQUETA_TEMPORADA, type AniosAtipicosRespuesta, type TemporadaAgrupacion } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { BadgeTemporada } from "@/components/estacionalidad/temporada";
import { resumirMeses } from "./meses";

export type AniosDeTemporada = {
  temporada: TemporadaAgrupacion;
  datos: AniosAtipicosRespuesta | null;
  cargando: boolean;
  error: string | null;
  onCerrarError: () => void;
};

/**
 * «Años marcados como atípicos»: lo que `GET /api/periodos-atipicos/anios`
 * entrega a M7 por temporada (qué años fueron de El Niño y con qué meses). No
 * muestra el ratio de volumen: ese es de la pestaña Años Niño, que lo calcula a demanda.
 */
export function AniosAtipicosCard({ porTemporada }: { porTemporada: AniosDeTemporada[] }) {
  return (
    <Card titulo="Años marcados como atípicos" descripcion="Por temporada de agrupación, según los periodos activos. El efecto en el volumen se mide en la pestaña Años Niño.">
      <div className="space-y-4">
        {porTemporada.map((t) => (
          <FilaTemporada key={t.temporada} {...t} />
        ))}
        <p className="text-xs text-tinta-suave">
          M7 lee esta lista por temporada al proyectar.
        </p>
      </div>
    </Card>
  );
}

function FilaTemporada({ temporada, datos, cargando, error, onCerrarError }: AniosDeTemporada) {
  const atipicos = datos?.anios.filter((a) => a.clase === "atipico") ?? [];
  const normales = datos?.resumen.anios_normales_completos ?? [];

  return (
    <div className="space-y-1 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeTemporada temporada={temporada} />
      </div>
      {error && <Alert onCerrar={onCerrarError}>No se pudo leer los años atípicos de {ETIQUETA_TEMPORADA[temporada].toLowerCase()}: {error}</Alert>}
      {!datos ? (
        !error && <p className="text-tinta-suave">{cargando ? "Cargando…" : "Sin información."}</p>
      ) : (
        <>
          <p>
            <strong>Atípicos: </strong>
            {atipicos.length === 0 ? (
              <span className="text-tinta-suave">ninguno.</span>
            ) : (
              atipicos.map((a, i) => {
                const motivos = a.periodos.map((p) => p.motivo).join(" + ");
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
        </>
      )}
    </div>
  );
}
