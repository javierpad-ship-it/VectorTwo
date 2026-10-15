"use client";

import { useMemo, useState } from "react";
import { formatearNumero } from "@/lib/formato";
import type { RedComparableVistaPrevia } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { RedComparable } from "./red-comparable";
import { redVistaDesdeRed } from "./vista";
import { useRecurso } from "./use-recurso";

const PIE =
  "El peso de cada tienda se calcula sobre la venta total de la red de ese año. «Dominante»: pesa más que el umbral. «Distinta»: su perfil mensual se aparta de la red más que el ruido entre años normales; es un diagnóstico, no cambia la curva. Es la red «de la casa» con los parámetros por defecto: cada agrupación ve esta misma red con sus pesos propios en su vista de trabajo, donde también puedes excluir tiendas.";

/** Lee la red al desplegar el panel (una sola lectura de `GET /api/curvas/red-comparable`, sin corrida). */
function RedCargada() {
  const { datos, cargando, error, setError } = useRecurso<RedComparableVistaPrevia>("/api/curvas/red-comparable");
  const red = useMemo(() => (datos ? redVistaDesdeRed(datos.anios) : null), [datos]);
  return (
    <div className="space-y-3">
      {error && <Alert onCerrar={() => setError(null)}>No se pudo leer la red comparable: {error}</Alert>}
      {!datos || !red ? (
        !error && <p className="text-sm text-tinta-suave">{cargando ? "Leyendo la red…" : "Sin información."}</p>
      ) : (
        <>
          <p className="text-sm text-tinta-suave">
            Con los parámetros por defecto · datos hasta {datos.hasta_periodo} · {formatearNumero(datos.meses_publicados.total)} meses publicados
            {datos.meses_publicados.faltantes.length > 0 ? ` · faltan ${datos.meses_publicados.faltantes.join(", ")}` : ""}.
          </p>
          <RedComparable red={red} referencia="la red" pie={PIE} />
        </>
      )}
    </div>
  );
}

/**
 * Panel plegable «Red comparable por año»: qué tiendas cuentan en la participación de cada año (abiertas todo el
 * año y con venta en todos los meses), con sus pesos, los avisos de concentración y las tiendas de perfil distinto.
 * No depende de ninguna agrupación ni corrida: lee `GET /api/curvas/red-comparable` con los parámetros por defecto.
 */
export function RedPanel() {
  const [abierto, setAbierto] = useState(false);
  return (
    <Card
      titulo="Red comparable por año"
      descripcion="Las tiendas que cuentan en la participación de cada año: abiertas todo el año y con venta en todos los meses."
      acciones={
        <Button variante="fantasma" tamano="sm" aria-expanded={abierto} onClick={() => setAbierto((a) => !a)}>
          {abierto ? "Ocultar" : "Mostrar"}
        </Button>
      }
    >
      {!abierto ? (
        <p className="text-sm text-tinta-suave">Plegado. Muestra qué tiendas entran en cada año, con su peso, los avisos de concentración y las tiendas de perfil distinto.</p>
      ) : (
        <RedCargada />
      )}
    </Card>
  );
}
