import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Alert } from "@/components/ui/alert";
import type { EntregaDetalleApi, FilaFlujoDetalleApi, ParametrosFlujoApi, SubflujoApi } from "@/lib/flujo/tipos-api";
import { ETIQUETA_TIPO_LINEA } from "@/lib/compras/tipos-api";
import { imi, mesCorto, mesLargo, porcentaje, unidades, unidadesU } from "./formato";
import { columnasDesdeK, columnasDetalle, filasMatrizDetalle, filasMatrizResto, filasMatrizSubflujo, OPCIONES_HISTORIA, type MesesHistoria } from "./matriz";
import { SelloSenal } from "./senal";
import { TablaMatriz } from "./tabla-matriz";
import { TEXTO_AVISO_FILA } from "./vista-flujo";

/**
 * Flujo mes a mes de UNA fila (ficha 08 §4.3): la tabla con la historia, el mes publicado y el horizonte; las entregas que llegan con
 * enlace a su compra; y, cuando hay una regla de intercompany, el subflujo de cada marca con su rango propio, su reposición directa y
 * el % directo observado frente al de la regla, más el resto de la fila. En la fila completa la reposición directa suma al stock
 * (§0.9): por eso su stock baja la demanda menos esa reposición, no la demanda entera.
 */
export function DetalleFila({
  detalle,
  parametros,
  historia,
  onHistoria,
}: {
  detalle: FilaFlujoDetalleApi;
  parametros: Pick<ParametrosFlujoApi, "imi_min" | "imi_max">;
  historia: MesesHistoria;
  onHistoria: (n: MesesHistoria) => void;
}) {
  const ctx = { imiMin: parametros.imi_min, imiMax: parametros.imi_max };
  const columnas = columnasDetalle(detalle, historia);
  const filas = filasMatrizDetalle(detalle, columnas, ctx);
  const kPrima = detalle.meses[0]?.periodo ?? "";
  const columnasK = columnasDesdeK(detalle.meses);
  const opciones: ChipItem<string>[] = OPCIONES_HISTORIA.map((n) => ({ id: String(n), label: n === 1 ? "Sin historia" : `${n} meses` }));
  const ruta = `${detalle.genero} · ${detalle.mundo} · ${detalle.linea}${detalle.equivalencia ? ` › ${detalle.equivalencia}` : ""}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">
            {ruta} <span className="text-tinta-suave">×</span> {detalle.agrupacion_marca}
          </h2>
          <p className="mt-0.5 text-sm text-tinta-suave">
            Stock a {mesLargo(kPrima)}: cadena {unidades(detalle.stock_k.total)} (CD {unidades(detalle.stock_k.cd)} · tiendas {unidades(detalle.stock_k.tiendas)}) · intercompany:{" "}
            {detalle.subflujos.length > 0 ? detalle.subflujos.map((s) => s.marca).join(", ") : "—"}
            {detalle.responsable ? ` · responsable: ${detalle.responsable.nombre}` : ""}
          </p>
        </div>
        <SelloSenal senal={detalle.resumen.senal} />
      </div>

      {detalle.avisos.length > 0 && (
        <Alert tono="info">
          <ul className="list-disc space-y-1 pl-4">
            {detalle.avisos.map((a) => (
              <li key={a}>{TEXTO_AVISO_FILA[a]}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm text-tinta-suave">
        <span>Historia:</span>
        <Chips etiqueta="Meses de historia" items={opciones} activo={String(historia)} onCambiar={(id) => onHistoria(Number(id) as MesesHistoria)} />
      </div>

      <TablaMatriz columnas={columnas} filas={filas} titulo={`Flujo mensual de ${ruta} × ${detalle.agrupacion_marca}`} />

      {detalle.avisos.includes("posible_doble_conteo") && (
        <p className="text-xs text-alerta">
          ⚠ El stock y el IMI de los meses siguientes pueden estar inflados: {unidadesU(detalle.resumen.posible_doble_conteo)} por confirmar. Revisa la pestaña Conciliación y confirma su ingreso.
        </p>
      )}
      {detalle.avisos.includes("sin_curva") && (
        <p className="text-xs text-tinta-suave">Esta fila no tiene curva de estacionalidad: se muestra el stock sin venta y sin IMI, y queda fuera del IMI total.</p>
      )}

      <EntregasQueLlegan entregas={detalle.entregas} />

      {detalle.subflujos.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">Subflujo intercompany</h3>
          {detalle.subflujos.map((s) => (
            <BloqueSubflujo key={s.regla_id} s={s} columnas={columnasK} />
          ))}
          {detalle.resto && (
            <details className="rounded-lg border border-borde bg-superficie">
              <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Resto de la fila (rango {parametros.imi_min}–{parametros.imi_max})</summary>
              <div className="px-4 pb-4">
                <TablaMatriz columnas={columnasK} filas={filasMatrizResto(detalle.resto.meses, columnasK, ctx)} titulo="Resto de la fila" />
              </div>
            </details>
          )}
          <p className="text-xs text-tinta-suave">
            Fila completa: el stock es el del resto más el de cada marca (con su reposición directa), y el saldo y el exceso se suman por componente, cada uno con su rango. Por eso el stock
            de la fila baja la demanda menos la reposición directa, no la demanda entera.
          </p>
        </section>
      )}
    </div>
  );
}

function BloqueSubflujo({ s, columnas }: { s: SubflujoApi; columnas: ReturnType<typeof columnasDesdeK> }) {
  const filas = filasMatrizSubflujo(s, columnas);
  const obs = s.pct_directo_observado;
  const obs12 = s.pct_directo_observado_12m;
  return (
    <details open className="rounded-lg border border-borde bg-superficie">
      <summary className="cursor-pointer px-4 py-2 text-sm font-medium">
        {s.marca} · rango {s.imi_min}–{s.imi_max} · {porcentaje(s.pct_directo)} directo · <span className="text-tinta-suave">{s.resumen.imi_k === null ? "sin IMI" : `IMI ${imi(s.resumen.imi_k)}`}</span>{" "}
        <SelloSenal senal={s.resumen.senal} />
      </summary>
      <div className="space-y-2 px-4 pb-4">
        <p className="text-xs text-tinta-suave">
          Directo observado: {obs ? `${porcentaje(obs.valor)} de la venta en ${mesLargo(obs.periodo)}` : "sin dato del último mes"}
          {obs12 ? ` · ${porcentaje(obs12.valor)} en los doce meses (${mesCorto(obs12.desde)} a ${mesCorto(obs12.hasta)})` : ""} · regla: {porcentaje(s.pct_directo)}. Es una referencia: se infla si no se registran
          las compras al CD de esta marca y no cambia la regla.
        </p>
        <TablaMatriz columnas={columnas} filas={filas} titulo={`Subflujo de ${s.marca}`} />
      </div>
    </details>
  );
}

function EntregasQueLlegan({ entregas }: { entregas: readonly EntregaDetalleApi[] }) {
  const columnas: Columna<EntregaDetalleApi>[] = [
    { clave: "periodo", titulo: "Llega", render: (e) => <span className="whitespace-nowrap">{mesCorto(e.periodo)}</span> },
    {
      clave: "compra",
      titulo: "Compra",
      render: (e) => (
        <Link href={`/compras/registro?compra=${e.compra_id}`} className="font-medium text-marca-oscura underline-offset-2 hover:underline">
          {e.numero}
        </Link>
      ),
    },
    { clave: "proveedor", titulo: "Proveedor", render: (e) => e.proveedor },
    {
      clave: "marca",
      titulo: "Marca / agrupación",
      render: (e) => (
        <span>
          {e.marca ?? e.agrupacion_marca}
          {e.tipo !== "especifica" && <span className="block text-[11px] text-tinta-suave">{ETIQUETA_TIPO_LINEA[e.tipo]}</span>}
        </span>
      ),
    },
    { clave: "tallas", titulo: "Tallas", render: (e) => e.tallas },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (e) => <span className="font-mono tabular-nums">{unidades(e.unidades)}</span> },
    { clave: "pendiente", titulo: "Pendiente", className: "text-right", render: (e) => <span className="font-mono tabular-nums">{unidades(e.pendiente)}</span> },
    { clave: "estado", titulo: "Estado", render: (e) => (e.vencida ? <Badge tono="alerta">Vencida · por confirmar</Badge> : <Badge tono="neutro">{e.estado}</Badge>) },
  ];
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-semibold">Entregas que llegan</h3>
      <DataTable columnas={columnas} filas={entregas as EntregaDetalleApi[]} claveFila={(e) => e.entrega_id} vacio="Ninguna compra confirmada espera entregas en esta fila." />
    </section>
  );
}
