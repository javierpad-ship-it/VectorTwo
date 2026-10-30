import { Alert } from "@/components/ui/alert";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import { formatearFactorTabla, formatearUds, type MesDiagnostico, type ResumenDiagnostico, filasDiagnostico } from "./vista";

/**
 * «Cómo crece … atípicamente» (06e §4.1 punto 3 y §5.2): los doce meses con lo vendido en el año de referencia y en el año en curso, el ratio,
 * la red y el ratio ÷ red; los meses del periodo atípico van resaltados. Debajo, la línea de resumen y el aviso de dato frágil. Solo informa:
 * el factor lo escribe Javier en Proyección → Factores del Niño.
 */
export function DiagnosticoTemporada({
  titulo,
  anioY,
  anioRef,
  meses,
  resumen,
}: {
  titulo: string;
  anioY: number;
  anioRef: number;
  meses: readonly (MesDiagnostico & { relativo: number | null })[];
  resumen: ResumenDiagnostico;
}) {
  const filas = filasDiagnostico(meses);
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-tinta">{titulo}</h4>
      {resumen.aviso && <Alert tono="info">{resumen.aviso}</Alert>}
      {resumen.linea && <p className="text-sm text-tinta">{resumen.linea}</p>}
      <div className="overflow-x-auto rounded-lg border border-borde" role="region" aria-label={`${titulo} (desplazable)`} tabIndex={0}>
        <table className="w-full text-sm">
          <caption className="sr-only">
            {titulo}: unidades de {anioRef} y de {anioY}, ratio, red y ratio entre red de cada mes. Los meses del periodo atípico están resaltados.
          </caption>
          <thead className="bg-neutro-suave text-xs text-tinta-suave">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Mes
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {anioRef}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {anioY}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Ratio
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Red
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Ratio ÷ red
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde tabular-nums">
            {filas.map((f) => (
              <tr key={f.m} data-periodo={f.en_periodo ? "si" : undefined} className={f.en_periodo ? "bg-alerta-suave/60 font-semibold" : undefined}>
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-tinta">
                  {MESES_CORTOS[f.m - 1]}
                  {f.en_periodo && <span className="ml-1.5 text-xs text-alerta">periodo</span>}
                </th>
                <td className="px-3 py-1.5 text-right">{formatearUds(f.u_ref)}</td>
                <td className="px-3 py-1.5 text-right">{formatearUds(f.u)}</td>
                <td className="px-3 py-1.5 text-right">{formatearFactorTabla(f.ratio)}</td>
                <td className="px-3 py-1.5 text-right">{formatearFactorTabla(f.control)}</td>
                <td className="px-3 py-1.5 text-right">{formatearFactorTabla(f.relativo)}</td>
              </tr>
            ))}
            {filas.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-tinta-suave">
                  Todavía no hay meses para comparar.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
