import type { ReactNode } from "react";

export type Columna<T> = {
  clave: string;
  titulo: string;
  render: (fila: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({
  columnas,
  filas,
  claveFila,
  vacio = "Sin registros.",
  cargando = false,
  claseFila,
}: {
  columnas: Columna<T>[];
  filas: T[];
  claveFila: (fila: T) => string;
  vacio?: string;
  cargando?: boolean;
  /** Clase extra por fila (p. ej. para resaltar las que hay que corregir). */
  claseFila?: (fila: T) => string | undefined;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-borde">
      <table className="w-full text-sm">
        <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
          <tr>
            {columnas.map((c) => (
              <th key={c.clave} className={`px-3 py-2 font-medium ${c.className ?? ""}`}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borde">
          {cargando && (
            <tr>
              <td colSpan={columnas.length} className="px-3 py-6 text-center text-tinta-suave">
                Cargando…
              </td>
            </tr>
          )}
          {!cargando && filas.length === 0 && (
            <tr>
              <td colSpan={columnas.length} className="px-3 py-6 text-center text-tinta-suave">
                {vacio}
              </td>
            </tr>
          )}
          {!cargando &&
            filas.map((fila) => (
              <tr key={claveFila(fila)} className={claseFila?.(fila) ?? "hover:bg-fondo/60"}>
                {columnas.map((c) => (
                  <td key={c.clave} className={`px-3 py-2 align-middle ${c.className ?? ""}`}>
                    {c.render(fila)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
