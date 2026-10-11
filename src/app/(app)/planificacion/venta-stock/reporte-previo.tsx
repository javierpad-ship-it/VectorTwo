"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/form";
import { descargarCsv } from "@/components/importador/csv";
import { formatearNumero, plural } from "@/lib/formato";
import { nombreBase } from "@/lib/arbol/leer-archivo";
import { tablaCombinacionesDesconocidas, tablaOmitidas } from "@/lib/ventas/descargas";
import type { InformeCarga, InformeMes } from "@/lib/ventas/tipos";
import type { CombinacionDesconocida } from "@/lib/ventas/informe";
import { DetalleMes } from "./detalle-mes";
import { MarcasNuevas } from "./marcas-nuevas";
import { formatearEntero, formatearPorcentaje, formatearSoles, nombrePeriodo } from "./comunes";
import { ETIQUETA_SALTO, planificarCarga, type MotivoSalto } from "./plan";
import type { Previsualizacion, useCargaVentas } from "./use-carga-ventas";

type Props = { c: ReturnType<typeof useCargaVentas>; informe: InformeCarga; prev: Previsualizacion };

function EstadoDelMes({ mes, salto }: { mes: InformeMes; salto: MotivoSalto | null }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5">
        {mes.estado === "nuevo" && <Badge tono="exito">Nuevo</Badge>}
        {mes.estado === "reemplaza" && <Badge tono="marca">Reemplazará</Badge>}
        {mes.estado === "identico" && <Badge tono="neutro">Idéntico a lo ya cargado</Badge>}
        {mes.bloqueado && <Badge tono="alerta">Bloqueado</Badge>}
        {mes.abierto && <Badge tono="alerta">Mes abierto</Badge>}
        {!mes.identidad_ok && <Badge tono="alerta">Identidad no cierra</Badge>}
        {mes.en_curso && <Badge tono="alerta">Otra carga en curso</Badge>}
      </div>
      {mes.estado === "reemplaza" && mes.publicada && (
        <div className="text-xs text-tinta-suave">Reemplaza la carga de {mes.publicada.filas.toLocaleString("es-PE")} filas.</div>
      )}
      {mes.bloqueado && (
        <div className="text-xs text-alerta">
          {formatearPorcentaje(mes.errores.maximo)} de las filas, la venta o el stock en errores
        </div>
      )}
      {salto && <div className="text-xs text-tinta-suave">Se omite: {ETIQUETA_SALTO[salto].toLowerCase()}.</div>}
    </div>
  );
}

function descargarOmitidas(informe: InformeCarga, nombreArchivo: string) {
  const { campos, datos } = tablaOmitidas(informe);
  descargarCsv(campos, datos, `omitidas-${nombreBase(nombreArchivo)}.csv`);
}

function descargarFormatoArbol(desconocidas: CombinacionDesconocida[], nombreArchivo: string) {
  const { campos, datos } = tablaCombinacionesDesconocidas(desconocidas);
  descargarCsv(campos, datos, `combinaciones-desconocidas-${nombreBase(nombreArchivo)}.csv`);
}

type TiendaDesconocida = { valor: string; filas: number; venta_soles: number; stock_valorizado: number; meses: number };

/** Tiendas del archivo que no existen, sumadas en todos los meses. */
function tiendasDesconocidas(informe: InformeCarga): TiendaDesconocida[] {
  const mapa = new Map<string, TiendaDesconocida>();
  for (const m of informe.meses) {
    for (const e of m.exclusiones) {
      if (e.motivo !== "tienda_desconocida") continue;
      const t = mapa.get(e.valor) ?? { valor: e.valor, filas: 0, venta_soles: 0, stock_valorizado: 0, meses: 0 };
      t.filas += e.filas;
      t.venta_soles += e.venta_soles;
      t.stock_valorizado += e.stock_valorizado;
      t.meses += 1;
      mapa.set(e.valor, t);
    }
  }
  return [...mapa.values()].sort((a, b) => b.filas - a.filas);
}

function TiendasDesconocidas({ tiendas }: { tiendas: TiendaDesconocida[] }) {
  const columnas: Columna<TiendaDesconocida>[] = [
    { clave: "valor", titulo: "Tienda del archivo", render: (t) => <span className="font-medium">{t.valor === "" ? "(vacía)" : t.valor}</span> },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (t) => formatearNumero(t.filas) },
    { clave: "meses", titulo: "Meses", className: "text-right font-mono", render: (t) => formatearNumero(t.meses) },
    { clave: "venta", titulo: "Venta", className: "text-right font-mono", render: (t) => formatearSoles(t.venta_soles) },
    { clave: "stock", titulo: "Stock a costo", className: "text-right font-mono", render: (t) => formatearSoles(t.stock_valorizado) },
  ];
  return (
    <div className="space-y-2">
      <Alert>
        <strong>{plural(tiendas.length, "tienda del archivo no existe", "tiendas del archivo no existen")} en el sistema</strong> y sus filas no se cargan. Si es una tienda real, créala o
        corrige su nombre en{" "}
        <Link href="/maestros/tiendas" className="underline underline-offset-2">
          Tiendas y aperturas
        </Link>
        ; si no debe cargarse nunca (la central, una oficina), créala <strong>desactivada</strong> y desde entonces saldrá como informativa.
      </Alert>
      <DataTable columnas={columnas} filas={tiendas} claveFila={(t) => t.valor} />
    </div>
  );
}

/** Paso 4: reporte previo (diagnósticos, resumen por mes, detalle con conciliación, marcas nuevas, tiendas, descargas). */
export function ReportePrevio({ c, informe, prev }: Props) {
  const [mesElegido, setMesElegido] = useState<string>("");
  const plan = useMemo(() => planificarCarga(informe, c.opciones), [informe, c.opciones]);
  const salto = useMemo(() => new Map(plan.saltados.map((s) => [s.mes.periodo, s.motivo])), [plan]);
  const tiendas = useMemo(() => tiendasDesconocidas(informe), [informe]);
  const desconocidas = prev.resultado.combinacionesDesconocidas;

  const primerConProblema = informe.meses.find((m) => m.bloqueado || !m.identidad_ok)?.periodo ?? informe.meses[0]?.periodo ?? "";
  const periodoDetalle = informe.meses.some((m) => m.periodo === mesElegido) ? mesElegido : primerConProblema;
  const mesDetalle = informe.meses.find((m) => m.periodo === periodoDetalle) ?? null;

  const columnas: Columna<InformeMes>[] = [
    { clave: "periodo", titulo: "Mes", render: (m) => <span className="whitespace-nowrap font-medium">{nombrePeriodo(m.periodo)}</span> },
    { clave: "estado", titulo: "Estado", render: (m) => <EstadoDelMes mes={m} salto={salto.get(m.periodo) ?? null} /> },
    {
      clave: "filas",
      titulo: "Filas: archivo / se cargan / fuera",
      className: "text-right font-mono",
      render: (m) => (
        <div>
          {formatearNumero(m.archivo.filas)} / <strong>{formatearNumero(m.cargado.filas)}</strong> / {formatearNumero(m.excluido.filas + m.fusionadas)}
        </div>
      ),
    },
    ...(
      [
        ["unidades", "Unidades", formatearEntero],
        ["venta_soles", "Venta", formatearSoles],
        ["costo_vendido", "Costo", formatearSoles],
        ["stock_unidades", "Stock (u.)", formatearEntero],
        ["stock_valorizado", "Stock a costo", formatearSoles],
      ] as const
    ).map(
      ([clave, titulo, fmt]): Columna<InformeMes> => ({
        clave,
        titulo: `${titulo} (cargado)`,
        className: "text-right font-mono",
        render: (m) => (
          <div>
            <strong>{fmt(m.cargado[clave])}</strong>
            <div className="text-xs text-tinta-suave">archivo {fmt(m.archivo[clave])}</div>
          </div>
        ),
      })
    ),
    {
      clave: "detalle",
      titulo: "",
      render: (m) => (
        <Button variante="fantasma" tamano="sm" onClick={() => setMesElegido(m.periodo)} aria-label={`Ver el detalle de ${nombrePeriodo(m.periodo)}`}>
          Ver detalle
        </Button>
      ),
    },
  ];

  const hayErrores = informe.meses.some((m) => m.resumen_exclusiones.some((r) => r.tipo === "error")) || informe.sin_mes.filas > 0;

  return (
    <Card
      titulo="4. Reporte previo"
      descripcion={`${formatearNumero(informe.filas_archivo)} filas leídas · ${plural(informe.meses.length, "mes", "meses")} · ${plural(informe.marcas_nuevas.length, "marca nueva", "marcas nuevas")}. Nada se ha guardado todavía.`}
    >
      <div className="space-y-6">
        {informe.diagnosticos.length > 0 && (
          <div className="space-y-2">
            {informe.diagnosticos.map((d, i) => (
              <Alert key={`${d.codigo}-${i}`} tono={d.bloqueante ? "alerta" : "info"}>
                <strong>{d.bloqueante ? "Bloquea la carga: " : "Aviso: "}</strong>
                {d.mensaje}
              </Alert>
            ))}
          </div>
        )}

        {informe.meses.length === 0 && <Alert>El archivo no trae ningún mes con filas legibles.</Alert>}

        {informe.meses.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Un mes por fila</h3>
            <DataTable
              columnas={columnas}
              filas={informe.meses}
              claveFila={(m) => m.periodo}
              claseFila={(m) => (m.bloqueado || !m.identidad_ok ? "bg-alerta-suave/40" : salto.has(m.periodo) ? "bg-neutro-suave/60" : undefined)}
            />
            <p className="text-xs text-tinta-suave">
              «Fuera» suma lo excluido y lo que se fusiona con otra fila de la misma clave. La conciliación contra QlikView, los errores y los avisos de cada mes están en el detalle, abajo.
            </p>
          </div>
        )}

        {mesDetalle && (
          <div className="space-y-3 rounded-lg border border-borde p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h3 className="text-base font-semibold">Detalle de {nombrePeriodo(mesDetalle.periodo)}</h3>
              <Field label="Mes" className="w-56">
                <Select value={periodoDetalle} onChange={(e) => setMesElegido(e.target.value)}>
                  {informe.meses.map((m) => (
                    <option key={m.periodo} value={m.periodo}>
                      {nombrePeriodo(m.periodo)}
                      {m.bloqueado ? " · bloqueado" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <DetalleMes key={mesDetalle.periodo} mes={mesDetalle} textos={c.textosQlik[mesDetalle.periodo]} onTotal={(medida, texto) => c.setTotalQlik(mesDetalle.periodo, medida, texto)} />
          </div>
        )}

        {informe.sin_mes.filas > 0 && (
          <Alert>
            {plural(informe.sin_mes.filas, "fila", "filas")} no tienen un mes que se pueda leer y no pertenecen a ningún mes: no se cargan (están en la descarga de omitidas).
          </Alert>
        )}

        {tiendas.length > 0 && <TiendasDesconocidas tiendas={tiendas} />}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Marcas nuevas</h3>
          <MarcasNuevas
            marcas={informe.marcas_nuevas}
            agrupaciones={prev.respuesta.agrupaciones_marca}
            agrupacionId={c.agrupacionMarcaId}
            onAgrupacion={c.setAgrupacionMarcaId}
          />
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Descargas</h3>
          <div className="flex flex-wrap gap-2">
            <Button variante="secundario" onClick={() => descargarOmitidas(informe, prev.archivoNombre)} disabled={!hayErrores && informe.meses.every((m) => m.exclusiones.length === 0)}>
              Descargar omitidas (CSV)
            </Button>
            <Button variante="secundario" onClick={() => descargarFormatoArbol(desconocidas, prev.archivoNombre)} disabled={desconocidas.length === 0}>
              Descargar combinaciones desconocidas (formato árbol)
            </Button>
          </div>
          <p className="text-xs text-tinta-suave">
            Las combinaciones desconocidas se suben en Árbol de producto → Importar y después se repite la lectura. Las equivalencias nuevas aparecerán en Faltantes de Agrupaciones de
            estacionalidad.
          </p>
        </div>
      </div>
    </Card>
  );
}
