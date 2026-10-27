import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/form";
import type { ConciliacionApi, ConciliacionFilaApi, SugerenciaApi } from "@/lib/flujo/tipos-api";
import { plural } from "@/lib/formato";
import { mesCorto, mesLargo, porcentaje, sumarMes, unidades } from "./formato";
import { diferenciaConciliacion, ETIQUETA_AVISO_MES, TOLERANCIA_PCT_DIRECTO } from "./vista-flujo";

const CLASE_TONO = { alerta: "font-semibold text-alerta", exito: "text-exito", suave: "text-tinta-suave" } as const;

/**
 * Pestaña Conciliación de Flujo mensual (ficha 08 §4.3b): para un mes cerrado, el ingreso que dice el inventario (stock de fin − stock
 * del mes anterior + venta, a nivel cadena) frente a las recepciones que alguien confirmó y a las entregas programadas. La diferencia
 * dice qué entró sin registrar o qué se registró sin respaldo. Cuando una entrega pendiente puede explicar el ingreso, la fila propone
 * confirmarlo en ese mes con «Aceptar sugerencia»: un clic, a nombre de quien la acepta y nunca automático. Solo admin y planner ven el
 * botón (el comprador ve la sugerencia sin botón en esta entrega).
 */
export function PestanaConciliacion({
  datos,
  cargando,
  periodo,
  meses,
  onPeriodo,
  puedeEscribir,
  aceptando,
  onAceptar,
}: {
  datos: ConciliacionApi | null;
  cargando: boolean;
  periodo: string;
  /** Meses que se pueden conciliar, del más reciente al más antiguo. */
  meses: readonly string[];
  onPeriodo: (mes: string) => void;
  puedeEscribir: boolean;
  /** `entrega_id` de la sugerencia que se está aceptando (el botón queda desactivado mientras la petición está en vuelo). */
  aceptando: string | null;
  onAceptar: (fila: ConciliacionFilaApi, sugerencia: SugerenciaApi) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Mes conciliado" className="w-full max-w-56">
          <Select value={periodo} onChange={(e) => onPeriodo(e.target.value)}>
            {meses.map((m) => (
              <option key={m} value={m}>
                {mesLargo(m)}
              </option>
            ))}
          </Select>
        </Field>
        <p className="max-w-2xl text-xs text-tinta-suave">
          Ingreso inferido = stock del mes − stock del mes anterior + venta, de la cadena (CD y tiendas). Es lo que de verdad llegó. Nunca crea ni cambia compras, recepciones ni stock: solo informa y sugiere.
        </p>
      </div>

      {cargando && !datos && <p className="py-6 text-center text-sm text-tinta-suave">Cargando la conciliación…</p>}
      {cargando && datos && (
        <p className="text-xs text-tinta-suave" role="status">
          Actualizando…
        </p>
      )}

      {datos && !datos.mes_anterior_publicado && (
        <Alert tono="info">
          El mes anterior ({mesLargo(sumarMes(datos.periodo, -1))}) no está publicado: sin su stock no se puede inferir el ingreso de {mesLargo(datos.periodo)}. Publica ese mes en Venta y stock.
        </Alert>
      )}

      {datos && datos.filas.length === 0 && <EmptyState titulo="Ninguna fila con estos filtros" detalle={`Prueba quitando algún filtro para ver la conciliación de ${mesLargo(datos.periodo)}.`} />}

      {datos && datos.filas.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-borde">
            <table className="w-full text-sm">
              <caption className="sr-only">Conciliación de ingresos de {mesLargo(datos.periodo)}</caption>
              <thead className="bg-neutro-suave text-left text-xs uppercase tracking-wide text-tinta-suave">
                <tr>
                  {["Fila", "Venta", "Stock mes anterior", "Stock del mes", "Ingreso inferido", "Recepciones registradas", "Entregas programadas", "Diferencia", "Aviso / sugerencia"].map((t, i) => (
                    <th key={t} scope="col" className={`px-3 py-2 font-medium ${i >= 1 && i <= 7 ? "text-right" : ""}`}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {datos.filas.map((f) => (
                  <FilaConciliacion key={`${f.gml_id}|${f.equivalencia_id ?? ""}|${f.agrupacion_marca_id}|${f.marca_id ?? ""}`} f={f} puedeEscribir={puedeEscribir} aceptando={aceptando} onAceptar={onAceptar} />
                ))}
              </tbody>
              <tfoot className="border-t-2 border-borde bg-neutro-suave/60 font-semibold">
                <tr>
                  <th scope="row" className="px-3 py-2 text-left">
                    Totales
                  </th>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{unidades(datos.totales.venta)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{unidades(datos.totales.ingreso_inferido)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{unidades(datos.totales.recepciones_registradas)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{unidades(datos.totales.entregas_programadas)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {datos.totales.sin_registrar > 0 && <span className="block text-alerta">+{unidades(datos.totales.sin_registrar)} sin registrar</span>}
                    {datos.totales.sin_respaldo > 0 && <span className="block text-alerta">−{unidades(datos.totales.sin_respaldo)} sin respaldo</span>}
                  </td>
                  <td className="px-3 py-2 font-normal text-tinta-suave">{datos.totales.salida_inferida > 0 ? `Salida neta total: ${unidades(datos.totales.salida_inferida)} u` : ""}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {datos.avisos.length > 0 && (
            <p className="text-xs text-tinta-suave">
              <strong className="text-tinta">Avisos del mes:</strong>{" "}
              {datos.avisos
                .map((a) => `${plural(a.filas, "fila", "filas")} ${ETIQUETA_AVISO_MES[a.aviso] ?? a.aviso}${a.unidades !== null ? ` (${a.unidades > 0 ? "" : "−"}${unidades(Math.abs(a.unidades))} u)` : ""}`)
                .join(" · ")}
            </p>
          )}
          <p className="text-xs text-tinta-suave">
            El directo observado de una marca intercompany es lo que llegó sin compra registrada sobre su venta: se infla si no se registran las compras al CD de esa marca. Es una referencia al lado del
            porcentaje de la regla; no la cambia.
          </p>
        </>
      )}
    </div>
  );
}

function FilaConciliacion({
  f,
  puedeEscribir,
  aceptando,
  onAceptar,
}: {
  f: ConciliacionFilaApi;
  puedeEscribir: boolean;
  aceptando: string | null;
  onAceptar: (fila: ConciliacionFilaApi, sugerencia: SugerenciaApi) => void;
}) {
  const dif = diferenciaConciliacion(f);
  const marca = f.marca_id !== null;
  const ocupada = aceptando !== null;
  return (
    <tr className={marca ? "bg-neutro-suave/30" : "hover:bg-fondo/60"}>
      <th scope="row" className="px-3 py-2 text-left font-normal">
        {marca ? (
          <span className="pl-4 text-tinta-suave">de la cual {f.marca} (intercompany)</span>
        ) : (
          <>
            <span className="font-medium">{f.ruta}</span>
            <span className="block text-xs text-tinta-suave">{f.agrupacion_marca}</span>
          </>
        )}
      </th>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{unidades(f.venta)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{f.stock_inicio === null ? <span className="text-tinta-suave">—</span> : unidades(f.stock_inicio)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{unidades(f.stock_fin)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{f.ingreso_inferido === null ? <span className="text-tinta-suave">—</span> : unidades(f.ingreso_inferido)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{unidades(f.recepciones_registradas)}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{unidades(f.entregas_programadas)}</td>
      <td className={`px-3 py-2 text-right text-xs ${CLASE_TONO[dif.tono]}`}>{dif.texto}</td>
      <td className="min-w-64 px-3 py-2 text-xs">
        <div className="space-y-1.5">
          {f.sugerencias.map((s) => (
            <div key={s.entrega_id} className="space-y-1">
              <p>
                <Link href={`/compras/registro?compra=${s.compra_id}`} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
                  {s.compra_numero}
                </Link>{" "}
                · entrega de {mesCorto(s.periodo_entrega)} {s.tipo === "vencida" ? "vencida" : "adelantada"} · {unidades(s.unidades)} u
              </p>
              {s.boton && puedeEscribir ? (
                <Button tamano="sm" disabled={ocupada} onClick={() => onAceptar(f, s)} title="Registra el ingreso de estas unidades en este mes, a tu nombre. Nunca se hace solo.">
                  {aceptando === s.entrega_id ? "Aceptando…" : `Aceptar sugerencia: ${unidades(s.unidades)} u en ${mesCorto(f.periodo)}`}
                </Button>
              ) : (
                <p className="text-tinta-suave">
                  {s.boton ? "Planeamiento puede aceptar esta sugerencia. " : "Es un lote que toca varias filas: confirma el ingreso desde la compra. "}
                  <Link href={`/compras/registro?compra=${s.compra_id}`} className="font-medium text-marca-oscura underline underline-offset-2">
                    Ver compra
                  </Link>
                </p>
              )}
            </div>
          ))}
          {f.avisos.includes("ingreso_sin_registrar") && f.sugerencias.length === 0 && (
            <p className="text-tinta-suave">Ingreso sin compra registrada pendiente: puede ser carga inicial o compra directa.</p>
          )}
          {f.avisos.includes("recepcion_sin_respaldo") && <p className="text-alerta">Recepción registrada que el inventario no muestra: ¿llegó en otro mes?</p>}
          {f.avisos.includes("salida_neta") && <p className="text-alerta">Salida neta: ajuste, merma o devolución a proveedor.</p>}
          {f.avisos.includes("sin_mes_anterior") && <p className="text-tinta-suave">Sin el stock del mes anterior: no se concilia.</p>}
          {f.avisos.includes("reclasificacion_probable") && <p className="text-tinta-suave">Posible reclasificación entre filas de la misma línea.</p>}
          {marca && f.pct_directo_observado && f.pct_directo_regla !== null && (
            <p className="flex flex-wrap items-center gap-1 text-tinta-suave">
              directo observado {porcentaje(f.pct_directo_observado.valor)} (regla: {porcentaje(f.pct_directo_regla)}){" "}
              {Math.abs(f.pct_directo_observado.valor - f.pct_directo_regla) <= TOLERANCIA_PCT_DIRECTO ? <Badge tono="exito">✓ cerca</Badge> : <Badge tono="alerta">lejos de la regla</Badge>}
            </p>
          )}
          {f.sugerencias.length === 0 && f.avisos.length === 0 && !marca && <span className="text-tinta-suave">—</span>}
        </div>
      </td>
    </tr>
  );
}
