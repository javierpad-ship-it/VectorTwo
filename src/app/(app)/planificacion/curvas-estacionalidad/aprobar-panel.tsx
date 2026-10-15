"use client";

import type { ModeloCurva, TrabajoAgrupacionApi } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { AlertaAccion } from "./alerta-accion";
import { ComparadorCurvas } from "./comparador-curvas";
import type { AccionSugerida, ErrorAprobar } from "./trabajo-vista";
import { ETIQUETA_AVISO_VIGENTE, formatearDiaMes, formatearFechaHora, modeloConNombre, textoObsoleta, type Comparacion } from "./vista";

export const ID_NOTA_APROBACION = "nota-aprobacion";

/**
 * Bloque «Aprobada frente a propuesta»: la curva aprobada vigente (con su obsolescencia, sus avisos y los
 * datos con que se aprobó), el comparador con la propuesta, el campo «Nota / motivo» y el botón
 * «Aprobar esta curva». Los errores del PUT (los `409`) se muestran aquí, junto al botón, con una acción sugerida.
 */
export function AprobarPanel({
  datos,
  modelo,
  propuesta,
  vigente,
  comparacion,
  avisoNoComparable,
  nota,
  onNota,
  motivosNota,
  puedeAprobar,
  motivoNoPuede,
  ocupado,
  error,
  aviso,
  onAprobar,
  onAccion,
  onCerrarError,
  onCerrarAviso,
}: {
  datos: TrabajoAgrupacionApi;
  modelo: ModeloCurva | null;
  propuesta: { etiqueta: string; curva: number[] } | null;
  vigente: { etiqueta: string; curva: number[] } | null;
  comparacion: Comparacion | null;
  avisoNoComparable: string | null;
  nota: string;
  onNota: (v: string) => void;
  /** Por qué la nota es obligatoria ahora (vacío = opcional). */
  motivosNota: string[];
  puedeAprobar: boolean;
  /** Por qué el botón está deshabilitado (para el `title` y el texto de ayuda). */
  motivoNoPuede: string | null;
  ocupado: boolean;
  error: ErrorAprobar | null;
  aviso: string | null;
  onAprobar: () => void;
  onAccion: (a: AccionSugerida) => void;
  onCerrarError: () => void;
  onCerrarAviso: () => void;
}) {
  const v = datos.vigente;
  const motivoObsoleta = textoObsoleta(datos.obsoleta);
  const siguiente = (v?.version ?? 0) + 1;
  const notaObligatoria = motivosNota.length > 0;

  function accion(a: AccionSugerida) {
    if (a.tipo === "nota") {
      document.getElementById(ID_NOTA_APROBACION)?.focus();
      return;
    }
    onAccion(a);
  }

  return (
    <Card titulo="Aprobada frente a propuesta" descripcion="Compara la candidata elegida con la curva aprobada y apruébala, una agrupación a la vez.">
      <div className="space-y-4">
        {v ? (
          <div className="space-y-1.5 text-sm">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-tinta">
              <strong>Vigente v{v.version}</strong>
              <span>· {modeloConNombre(v.modelo)}</span>
              <span className="text-tinta-suave" title={`Aprobada el ${formatearFechaHora(v.aprobada_at)}`}>
                · aprobada el {formatearDiaMes(v.aprobada_at)} por {v.usuario_nombre ?? "—"}
                {v.hasta_periodo ? ` con datos hasta ${v.hasta_periodo}` : ""}
              </span>
              {v.origen === "prestada" && <Badge tono="marca">Prestada (temporada)</Badge>}
              {motivoObsoleta ? <Badge tono="alerta">Obsoleta</Badge> : <Badge tono="exito">Al día</Badge>}
            </p>
            {motivoObsoleta && <p className="text-alerta">{motivoObsoleta}.</p>}
            {datos.avisos_vigente.length > 0 && (
              <ul className="space-y-0.5 text-xs text-tinta-suave" aria-label="Avisos de la curva vigente">
                {datos.avisos_vigente.map((a, i) => (
                  <li key={`${a.codigo}-${i}`}>
                    <span className="font-medium text-tinta">{ETIQUETA_AVISO_VIGENTE[a.codigo]}:</span> {a.detalle}
                  </li>
                ))}
              </ul>
            )}
            {v.nota && <p className="text-xs text-tinta-suave">Nota de esa versión: «{v.nota}»</p>}
          </div>
        ) : (
          <p className="text-sm text-tinta-suave">Esta agrupación no tiene curva aprobada: aprobar la propuesta creará la versión 1.</p>
        )}

        {propuesta ? (
          <ComparadorCurvas propuesta={propuesta} vigente={vigente} comparacion={comparacion} avisoNoComparable={avisoNoComparable} />
        ) : (
          <p className="text-sm text-tinta-suave">No hay candidata con curva para comparar o aprobar.</p>
        )}

        <div className="space-y-3 border-t border-borde pt-4">
          <Field
            label="Nota / motivo"
            hint={
              notaObligatoria
                ? `Obligatoria ahora: ${motivosNota.join("; ")}.`
                : "Obligatoria si eliges otra candidata que la recomendada, excluyes años o tiendas, o el tratamiento del Niño no es automático."
            }
          >
            <Input
              id={ID_NOTA_APROBACION}
              value={nota}
              maxLength={300}
              disabled={ocupado}
              aria-required={notaObligatoria}
              aria-invalid={notaObligatoria && nota.trim() === "" && error?.accion?.tipo === "nota" ? true : undefined}
              onChange={(e) => onNota(e.target.value)}
              placeholder="Por qué apruebas esta curva y no la que propone el sistema, o por qué excluyes lo que excluyes"
            />
          </Field>

          {error && <AlertaAccion error={error} onAccion={accion} onCerrar={onCerrarError} />}
          {aviso && (
            <Alert tono="exito" onCerrar={onCerrarAviso}>
              {aviso}
            </Alert>
          )}

          <div className="flex flex-wrap items-center justify-end gap-3">
            {motivoNoPuede && <p className="mr-auto text-xs text-tinta-suave">{motivoNoPuede}</p>}
            <Button onClick={onAprobar} disabled={!puedeAprobar || ocupado} title={motivoNoPuede ?? undefined}>
              {ocupado ? "Guardando…" : `Aprobar esta curva${modelo ? ` (${modelo})` : ""} como versión ${siguiente}`}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
