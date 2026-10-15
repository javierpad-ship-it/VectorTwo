"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import type { CorridaDetalleApi, RedComparableVistaPrevia } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { consultaRedComparable, type FormularioParametros } from "./parametros-form";
import { RedComparable } from "./red-comparable";
import { redVistaDesdeRed } from "./vista";
import { useRecurso } from "./use-recurso";

const PIE =
  "El peso de cada tienda se calcula sobre la venta total de la red de ese año. «Dominante»: pesa más que el umbral. «Distinta»: su perfil mensual se aparta de la red más que el ruido entre años normales; es un diagnóstico, no cambia la curva. Si una tienda se aparta de verdad y pesa, el siguiente paso es M6b (curvas por tienda o grupo de tiendas).";

function RedDeCorrida({ corridaId }: { corridaId: string }) {
  const { datos, cargando, error, setError } = useRecurso<CorridaDetalleApi>(`/api/curvas/corridas/${corridaId}`);
  const red = useMemo(() => (datos ? redVistaDesdeRed(datos.red_comparable) : null), [datos]);
  return (
    <div className="space-y-3">
      {error && <Alert onCerrar={() => setError(null)}>No se pudo leer la red de la corrida: {error}</Alert>}
      {!red ? !error && <p className="text-sm text-tinta-suave">{cargando ? "Cargando la red…" : "Sin información."}</p> : <RedComparable red={red} referencia="la red" pie={PIE} />}
    </div>
  );
}

/**
 * Panel plegable «Red comparable por año»: la red de la corrida que se está
 * viendo o, con «Ver red», una vista previa con los parámetros escritos en la
 * tarjeta Calcular (sin recalcular nada ni esperar al cálculo).
 */
export function RedPanel({ corridaId, formulario }: { corridaId: string | null; formulario: FormularioParametros }) {
  const [abierto, setAbierto] = useState(false);
  const [vista, setVista] = useState<RedComparableVistaPrevia | null>(null);
  const [cargandoVista, setCargandoVista] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const consulta = consultaRedComparable(formulario);
  const redPrevia = useMemo(() => (vista ? redVistaDesdeRed(vista.anios) : null), [vista]);

  async function verRed() {
    if (consulta === null) {
      setError("Corrige los parámetros de la tarjeta Calcular para ver la red.");
      return;
    }
    setCargandoVista(true);
    setError(null);
    try {
      setVista(await api.get<RedComparableVistaPrevia>(`/api/curvas/red-comparable?${consulta}`));
      setAbierto(true);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCargandoVista(false);
    }
  }

  return (
    <Card
      titulo="Red comparable por año"
      descripcion="Las tiendas que cuentan en la participación de cada año: abiertas todo el año y con venta en todos los meses."
      acciones={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variante="secundario" tamano="sm" onClick={() => void verRed()} disabled={cargandoVista} title="Calcula la red con los parámetros escritos en Calcular, sin correr el modelo">
            {cargandoVista ? "Leyendo…" : "Ver red"}
          </Button>
          <Button variante="fantasma" tamano="sm" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
            {abierto ? "Ocultar" : "Mostrar"}
          </Button>
        </div>
      }
    >
      {!abierto ? (
        <p className="text-sm text-tinta-suave">Plegado. Muestra qué tiendas entran en cada año, con su peso, los avisos de concentración y las tiendas de perfil distinto.</p>
      ) : (
        <div className="space-y-3">
          {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
          {vista && redPrevia ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-tinta-suave">
                  Vista previa con los parámetros escritos en Calcular · hasta {vista.hasta_periodo} · {vista.meses_publicados.total} meses publicados.
                </p>
                {corridaId && (
                  <Button variante="fantasma" tamano="sm" onClick={() => setVista(null)}>
                    Volver a la red de la corrida
                  </Button>
                )}
              </div>
              <RedComparable red={redPrevia} referencia="la red" pie={PIE} />
            </>
          ) : corridaId ? (
            <RedDeCorrida corridaId={corridaId} />
          ) : (
            <EmptyState titulo="Todavía no hay corrida" detalle="Pulsa «Ver red» para ver qué tiendas entrarían con los parámetros de la tarjeta Calcular." />
          )}
        </div>
      )}
    </Card>
  );
}
