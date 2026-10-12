import type { ReactNode } from "react";

export type Columna<T> = {
  clave: string;
  titulo: string;
  render: (fila: T) => ReactNode;
  className?: string;
  /** Con `ordenActual` y `onOrdenar`, el encabezado se vuelve un botón que ordena por esta columna. */
  ordenable?: boolean;
};

export type OrdenTabla = { clave: string; dir: "asc" | "desc" };

export function DataTable<T>({
  columnas,
  filas,
  claveFila,
  vacio = "Sin registros.",
  cargando = false,
  claseFila,
  ordenActual,
  onOrdenar,
}: {
  columnas: Columna<T>[];
  filas: T[];
  claveFila: (fila: T) => string;
  vacio?: string;
  cargando?: boolean;
  /** Clase extra por fila (p. ej. para resaltar las que hay que corregir). */
  claseFila?: (fila: T) => string | undefined;
  /** Orden vigente; las columnas `ordenable` lo muestran con una flecha. */
  ordenActual?: OrdenTabla;
  /** Se llama con la clave de la columna pulsada; quien usa la tabla decide el sentido. */
  onOrdenar?: (clave: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-borde">
      <table className="w-full text-sm">
        <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
          <tr>
            {columnas.map((c) => {
              const ordenable = Boolean(c.ordenable && onOrdenar);
              const activa = ordenable && ordenActual?.clave === c.clave;
              return (
                <th
                  key={c.clave}
                  className={`px-3 py-2 font-medium ${c.className ?? ""}`}
                  aria-sort={activa ? (ordenActual?.dir === "asc" ? "ascending" : "descending") : ordenable ? "none" : undefined}
                >
                  {ordenable ? (
                    <button
                      type="button"
                      onClick={() => onOrdenar?.(c.clave)}
                      className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-tinta"
                      title={`Ordenar por ${c.titulo.toLowerCase()}`}
                    >
                      {c.titulo}
                      <span aria-hidden className={activa ? "text-tinta" : "opacity-40"}>
                        {activa ? (ordenActual?.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    c.titulo
                  )}
                </th>
              );
            })}
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
