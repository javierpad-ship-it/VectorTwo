import { MESES_CORTOS } from "@/lib/reportes/histograma";
import { claseDiferencia, formatearDiferenciaPp, formatearPctSolo, fraseComparacion, type Comparacion } from "./vista";

/**
 * Comparador aprobada / propuesta: las doce participaciones de la candidata
 * seleccionada y de la curva aprobada, la diferencia mes a mes en puntos (color por
 * signo) y la EAT entre ambas. Las dos curvas también van superpuestas en el
 * gráfico de arriba.
 */
export function ComparadorCurvas({
  propuesta,
  vigente,
  comparacion,
  avisoNoComparable = null,
}: {
  propuesta: { etiqueta: string; curva: number[] };
  vigente: { etiqueta: string; curva: number[] } | null;
  comparacion: Comparacion | null;
  /** «EAT no comparable con el cálculo anterior (…)»: los años de ajuste no son los de la aprobada. */
  avisoNoComparable?: string | null;
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-borde">
        <table className="w-full text-sm">
          <caption className="sr-only">Participación mensual de la curva propuesta y de la aprobada, y su diferencia en puntos porcentuales.</caption>
          <thead className="bg-neutro-suave text-xs text-tinta-suave">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium" />
              {MESES_CORTOS.map((m) => (
                <th key={m} scope="col" className="px-2 py-2 text-right font-medium uppercase">
                  {m}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-borde tabular-nums">
            <tr>
              <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-marca-oscura">
                {propuesta.etiqueta}
              </th>
              {propuesta.curva.map((v, i) => (
                <td key={i} className="px-2 py-1.5 text-right">
                  {formatearPctSolo(v)}
                </td>
              ))}
            </tr>
            {vigente && (
              <>
                <tr>
                  <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                    {vigente.etiqueta}
                  </th>
                  {vigente.curva.map((v, i) => (
                    <td key={i} className="px-2 py-1.5 text-right">
                      {formatearPctSolo(v)}
                    </td>
                  ))}
                </tr>
                <tr className="bg-neutro-suave/50">
                  <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                    Diferencia (pp)
                  </th>
                  {(comparacion?.diferencias ?? []).map((d, i) => (
                    <td key={i} className={`px-2 py-1.5 text-right font-medium ${claseDiferencia(d)}`}>
                      {formatearDiferenciaPp(d)}
                    </td>
                  ))}
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
      {vigente && comparacion ? (
        <p className="text-sm text-tinta">
          {fraseComparacion(comparacion)}.{" "}
          {!comparacion.difiere && <span className="text-tinta-suave">Prácticamente igual a la aprobada.</span>}
          {avisoNoComparable && <span className="block text-alerta">{avisoNoComparable}</span>}
        </p>
      ) : (
        <p className="text-sm text-tinta-suave">No hay curva aprobada con la que comparar: aprobar esta creará la versión 1.</p>
      )}
    </div>
  );
}
