import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { TEXTO_AVISO_FLUJO, type AvisoFlujo, type DatosFlujoApi } from "@/lib/flujo/tipos-api";
import { plural } from "@/lib/formato";
import { unidades } from "./formato";

/**
 * Avisos de la cabecera del flujo (`DatosFlujoApi.avisos`), en castellano claro para planeamiento y compradores. Los avisos con cifras
 * (`filas_sin_curva`, `stock_en_tiendas_inactivas`, `stock_sin_clave`) las toman de `datos`; `entregas_sin_confirmar` NO se pinta aquí:
 * lo hace `AvisoPorConfirmar` (con su botón «Revisar»). Los que piden actuar van en alerta y los informativos en información.
 */

const INFORMATIVOS: ReadonlySet<AvisoFlujo> = new Set<AvisoFlujo>(["filas_sin_curva", "stock_en_tiendas_inactivas", "stock_sin_clave", "horizonte_corto"]);

export function textoAvisoFlujo(aviso: AvisoFlujo, datos: Pick<DatosFlujoApi, "filas_sin_curva" | "stock_excluido" | "stock_sin_clave">): string {
  switch (aviso) {
    case "filas_sin_curva": {
      const f = datos.filas_sin_curva;
      return `${plural(f.filas, "fila tiene", "filas tienen")} venta proyectada sin curva de estacionalidad (${unidades(f.venta_anual)} u al año) y ${unidades(f.stock)} u de stock: quedan fuera del IMI total. En cuanto una cerrada nueva traiga su curva, el flujo las toma.`;
    }
    case "stock_en_tiendas_inactivas":
      return `Hay ${unidades(datos.stock_excluido.unidades)} u en tiendas desactivadas: no cuentan en el flujo futuro.`;
    case "stock_sin_clave":
      return `Hay ${unidades(datos.stock_sin_clave)} u de stock que no se pudieron ubicar en ninguna fila (marca o equivalencia sin clasificar).`;
    default:
      return TEXTO_AVISO_FLUJO[aviso];
  }
}

export function AvisosFlujo({ datos, enlaceProyeccion = false }: { datos: Pick<DatosFlujoApi, "avisos" | "filas_sin_curva" | "stock_excluido" | "stock_sin_clave">; enlaceProyeccion?: boolean }) {
  const visibles = datos.avisos.filter((a) => a !== "entregas_sin_confirmar");
  const accion = visibles.filter((a) => !INFORMATIVOS.has(a));
  const info = visibles.filter((a) => INFORMATIVOS.has(a));
  if (visibles.length === 0) return null;
  return (
    <div className="space-y-2">
      {accion.length > 0 && (
        <Alert tono="alerta">
          <ul className="list-disc space-y-1 pl-4">
            {accion.map((a) => (
              <li key={a}>
                {textoAvisoFlujo(a, datos)}
                {enlaceProyeccion && (a === "cerrada_atrasada" || a === "cerrada_metodo_anterior" || a === "cerrada_sin_periodo") && (
                  <>
                    {" "}
                    <Link href="/planificacion/proyeccion" className="underline underline-offset-2">
                      Ir a Proyección
                    </Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Alert>
      )}
      {info.length > 0 && (
        <Alert tono="info">
          <ul className="list-disc space-y-1 pl-4">
            {info.map((a) => (
              <li key={a}>{textoAvisoFlujo(a, datos)}</li>
            ))}
          </ul>
        </Alert>
      )}
    </div>
  );
}
