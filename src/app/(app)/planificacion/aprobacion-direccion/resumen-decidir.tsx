import { Card } from "@/components/ui/card";
import { GM_CLAVE_TOTAL, type TableroApi } from "@/lib/direccion/tipos-api";
import { porcentaje } from "@/components/direccion/formato";
import { lineasResumen, type VistaBloqueos } from "./vista-tablero";

/**
 * Resumen para decidir (ficha 14, §4.3): las 3 a 5 líneas que arma el servidor, SIEMPRE de la proyección entera. Si la proyección está en trabajo, la
 * pantalla completa la 5.ª (la del estado) con lo que bloquearía el cierre según `GET /api/direccion/bloqueos`, que se pide aparte: mientras llega
 * dice «comprobando…» y el resto del resumen ya se lee. Nunca pasa de 5 líneas. Debajo, en letra chica, la precisión del método y el objetivo global (solo si hay dato).
 */
export function ResumenDecidir({ tablero, bloqueos }: { tablero: TableroApi; bloqueos: VistaBloqueos }) {
  const d = tablero.decidir;
  const resumen = lineasResumen(d.lineas, bloqueos);
  const total = tablero.crecimientos.find((c) => c.gm_clave === GM_CLAVE_TOTAL);
  const y = tablero.proyeccion.anio_en_curso;
  const implicito =
    total && total.implicito_sobre_corregida_pct !== null && total.con_nino
      ? `; implícito en mismas tiendas: ${porcentaje(total.implicito_sobre_corregida_pct)} sobre ${y} corregido${total.implicito_sobre_real_pct !== null ? ` (${porcentaje(total.implicito_sobre_real_pct)} sobre real)` : ""}`
      : total && total.implicito_sobre_real_pct !== null
        ? `; implícito en mismas tiendas: ${porcentaje(total.implicito_sobre_real_pct)} sobre ${y} real`
        : "";
  return (
    <Card nivel={3} titulo="Resumen para decidir" descripcion="De la proyección entera: no cambia con los filtros de «Explorar».">
      <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-tinta">
        {resumen.lineas.map((linea, i) =>
          i === resumen.viva ? (
            <li key={i} aria-live="polite">
              {linea}
            </li>
          ) : (
            <li key={i}>{linea}</li>
          )
        )}
      </ol>
      {(d.precision.desvio_prueba_anterior_pct !== null || d.objetivo_pct !== null) && (
        <div className="mt-3 space-y-1 border-t border-borde pt-3 text-xs text-tinta-suave">
          {d.precision.desvio_prueba_anterior_pct !== null && (
            <p>
              Precisión del método: con el año anterior se habría desviado {porcentaje(d.precision.desvio_prueba_anterior_pct)} ({d.precision.rotulo}).
            </p>
          )}
          {d.objetivo_pct !== null && (
            <p>
              Objetivo global declarado: {porcentaje(d.objetivo_pct)}
              {implicito}.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
