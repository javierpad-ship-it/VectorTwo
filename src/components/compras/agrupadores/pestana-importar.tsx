"use client";

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { descargarCsv } from "@/components/importador/csv";
import { descargarExcel } from "@/components/importador/excel";
import { PasoArchivo } from "@/components/importador/paso-archivo";
import { BotonesImportar, PasoMapeo } from "@/components/importador/paso-mapeo";
import { TablaErrores, Tarjeta, descripcionTotales } from "@/components/importador/reporte";
import type { ColumnaOmitida } from "@/components/importador/tipos";
import { ETIQUETA_TIPO_AGRUPADOR, type FilaImportacionAgrupadorApi, type ReporteImportacionAgrupadoresApi, type TipoAgrupador } from "@/lib/compras/agrupadores/tipos-api";
import { formatearNumero, plural } from "@/lib/formato";
import { useImportarAgrupadores } from "./use-importar-agrupadores";
import {
  CAMPOS_AGRUPADORES,
  ENCABEZADOS_PLANTILLA_AGRUPADORES,
  ETIQUETA_AVISO_IMPORTACION_AGRUPADOR,
  ETIQUETA_MOTIVO_OMISION_AGRUPADOR,
  FILAS_EJEMPLO_AGRUPADORES,
  NOMBRE_PLANTILLA_AGRUPADORES,
  textoCreaciones,
} from "./vista-importar-agrupadores";

/** Fila omitida con lo que `TablaErrores` necesita (la fila, el motivo y el detalle) más el tipo y la clave. */
type FilaOmitida = { fila: number; motivo: string; detalle?: string; tipo: string; clave: string };

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitida>[] = [
  { clave: "tipo", titulo: "Tipo", valor: (f) => f.tipo },
  { clave: "clave", titulo: "Clave", valor: (f) => f.clave.split("|").join(" · ") },
];

const MOTIVOS_CORREGIBLES: ReadonlySet<string> = new Set(Object.keys(ETIQUETA_MOTIVO_OMISION_AGRUPADOR));

const textoTipo = (t: TipoAgrupador | null) => (t ? ETIQUETA_TIPO_AGRUPADOR[t] : "—");
const claveLegible = (clave: string) => clave.split("|").join(" · ");

/**
 * Pestaña Importar de Viajes y embarques (ficha 08b §3.11 y §4.4b; los tres roles): carga viajes, embarques y paquetes desde UNA hoja con una
 * columna TIPO, en los cuatro pasos del importador compartido (archivo, mapeo, reporte, aplicar). Solo crea: nunca edita ni mueve lo que ya
 * existe ni asigna compras. Reimportar el mismo archivo no duplica nada (cada fila se reconoce por su código o por su clave natural). Aplicar
 * es todo o nada y pide un `confirm` («Se crearán 12 viajes, 18 embarques y 30 paquetes»).
 */
export function PestanaImportar({
  onAplicado,
  enlaceCreado,
  onVerEmbarques,
}: {
  /** Se llama cuando el servidor terminó de aplicar: la pantalla relee las listas. */
  onAplicado: () => void;
  /** A dónde lleva el código de un agrupador creado; `null` si no hay a dónde. */
  enlaceCreado: (c: { tipo: TipoAgrupador; id: string }) => string | null;
  onVerEmbarques: () => void;
}) {
  const imp = useImportarAgrupadores({ alAplicar: onAplicado });
  const { archivo, previa, previaVigente, final } = imp;
  const nuevas = previaVigente?.reporte.resumen.nuevas ?? 0;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <Card
        titulo="Plantilla"
        descripcion="Una sola hoja con una columna TIPO (VIAJE, EMBARQUE o PAQUETE). Escribe el código de cada fila: así puedes reimportar el mismo archivo sin duplicar nada y referir un viaje o un embarque del mismo archivo."
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variante="secundario" onClick={() => descargarCsv(ENCABEZADOS_PLANTILLA_AGRUPADORES, FILAS_EJEMPLO_AGRUPADORES, `${NOMBRE_PLANTILLA_AGRUPADORES}.csv`)}>
              Descargar plantilla (CSV)
            </Button>
            <Button variante="secundario" onClick={() => void descargarExcel(ENCABEZADOS_PLANTILLA_AGRUPADORES, FILAS_EJEMPLO_AGRUPADORES, "AGRUPADORES", `${NOMBRE_PLANTILLA_AGRUPADORES}.xlsx`)}>
              Descargar plantilla (Excel)
            </Button>
          </div>
          <ul className="list-disc space-y-1 pl-5 text-xs text-tinta-suave">
            <li>Solo crea viajes, embarques y paquetes. Lo que ya existe no se edita ni se mueve, y no asigna compras: eso se hace en pantalla o con las columnas del importador de compras.</li>
            <li>El responsable es el correo de un comprador o administrador activo y es obligatorio en los viajes; en embarques y paquetes, vacío hereda.</li>
            <li>Las fechas van como aaaa-mm-dd. Un embarque necesita el Ingreso CD (FECHA_INGRESO_CD, o la columna vieja FECHA_LLEGADA); un viaje, la de inicio.</li>
            <li>Un embarque admite además FECHA_ZARPE (o FECHA_SALIDA), FECHA_ARRIBO, INICIO_OPERATIVO (fecha, o fecha y hora: aaaa-mm-dd hh:mm), FECHA_INGRESO_STOCK (vacía = el mismo día del Ingreso CD) y ORIGEN (California, Nueva York…).</li>
            <li>Un código vacío se numera al aplicar (aamm## según la fecha). Una fila puede apuntar a un viaje o a un embarque del mismo archivo, pero solo por código.</li>
          </ul>
        </div>
      </Card>

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV (UTF-8, coma o punto y coma) o Excel (.xlsx) con la cabecera de la plantilla. Hasta 1 000 filas. Se lee en tu navegador; solo se envían las columnas mapeadas."
        hintHoja="El libro tiene varias hojas; elige la que contiene los agrupadores (la hoja AGRUPADORES del Excel de Viajes y embarques)."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS_AGRUPADORES}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Tipo y nombre son obligatorios; lo demás depende del tipo de fila."
        >
          <BotonesImportar
            mapeoCompleto={imp.mapeoCompleto}
            enviando={imp.enviando}
            previaVigente={previaVigente !== null && nuevas > 0}
            previaDesactualizada={previa !== null && previaVigente === null}
            aplicado={final !== null}
            onEnviar={imp.enviar}
          />
        </PasoMapeo>
      )}

      {previaVigente && !final && archivo && <ReporteImportacionAgrupadores key={previaVigente.firma} titulo="3. Reporte de la previsualización" reporte={previaVigente.reporte} nombreArchivo={archivo.nombre} enlaceCreado={enlaceCreado} />}

      {final && archivo && (
        <>
          <Alert tono="exito">
            Importación aplicada. Se crearon {textoCreaciones(final)}.
            <span className="ml-3">
              <Button tamano="sm" onClick={onVerEmbarques}>
                Ver los embarques
              </Button>
            </span>
          </Alert>
          <ReporteImportacionAgrupadores titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} enlaceCreado={enlaceCreado} />
        </>
      )}
    </div>
  );
}

/**
 * El reporte de una importación de agrupadores, en previsualización o ya aplicada: totales por tipo y por clasificación, las filas nuevas
 * (con el código que tendrán o «se numera al aplicar»), las cambiadas con su diferencia, las omitidas con su motivo y los avisos. Ya
 * aplicada, lista los códigos asignados con un enlace a cada agrupador.
 */
export function ReporteImportacionAgrupadores({
  titulo,
  reporte,
  nombreArchivo,
  enlaceCreado,
}: {
  titulo: string;
  reporte: ReporteImportacionAgrupadoresApi;
  nombreArchivo: string;
  enlaceCreado: (c: { tipo: TipoAgrupador; id: string }) => string | null;
}) {
  const aplicado = reporte.modo === "aplicar";
  const { resumen } = reporte;
  const nuevasFilas = reporte.filas.filter((f) => f.clasificacion === "nueva");
  const cambiadas = reporte.filas.filter((f) => f.clasificacion === "cambiada");
  const omitidas: FilaOmitida[] = reporte.filas
    .filter((f) => f.clasificacion === "omitida")
    .map((f) => ({ fila: f.fila, motivo: f.motivo ?? "tipo_invalido", detalle: f.detalle, tipo: textoTipo(f.tipo), clave: f.clave }));
  const conAvisos = reporte.filas.filter((f) => f.avisos.length > 0);

  const columnasNuevas: Columna<FilaImportacionAgrupadorApi>[] = [
    { clave: "fila", titulo: "Fila", render: (f) => <span className="font-mono text-xs">{f.fila}</span> },
    { clave: "tipo", titulo: "Tipo", render: (f) => textoTipo(f.tipo) },
    { clave: "clave", titulo: "Clave", render: (f) => <span className="text-xs">{claveLegible(f.clave)}</span> },
    {
      clave: "codigo",
      titulo: "Código",
      render: (f) => (f.codigo_final ? <span className="font-mono">{f.codigo_final}</span> : <span className="text-xs text-tinta-suave">se numera al aplicar</span>),
    },
  ];
  const columnasCambiadas: Columna<FilaImportacionAgrupadorApi>[] = [
    { clave: "fila", titulo: "Fila", render: (f) => <span className="font-mono text-xs">{f.fila}</span> },
    { clave: "tipo", titulo: "Tipo", render: (f) => textoTipo(f.tipo) },
    { clave: "clave", titulo: "Clave", render: (f) => <span className="text-xs">{claveLegible(f.clave)}</span> },
    { clave: "detalle", titulo: "Qué difiere", render: (f) => <span className="text-xs">{f.detalle ?? "—"}</span> },
    { clave: "estado", titulo: "Qué pasa", render: () => <Badge tono="alerta">{ETIQUETA_MOTIVO_OMISION_AGRUPADOR.cambiada_requiere_edicion}</Badge> },
  ];

  return (
    <Card titulo={titulo} descripcion={descripcionTotales({ recibidas: reporte.filas.length, procesadas: resumen.nuevas + resumen.iguales, omitidas: resumen.omitidas + resumen.cambiadas })}>
      <div className="space-y-5">
        {resumen.nuevas === 0 && resumen.omitidas === 0 && resumen.cambiadas === 0 && <Alert tono="info">Nada que crear: todo lo del archivo ya existe con el mismo contenido.</Alert>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta
            titulo={aplicado ? "Se crearon" : "Se crearán"}
            tono="exito"
            filas={[
              ["Viajes", resumen.por_tipo.viaje.nuevas],
              ["Embarques", resumen.por_tipo.embarque.nuevas],
              ["Paquetes", resumen.por_tipo.paquete.nuevas],
            ]}
          />
          <Tarjeta titulo="Ya existían (iguales)" tono="neutro" filas={[["Viajes", resumen.por_tipo.viaje.iguales], ["Embarques", resumen.por_tipo.embarque.iguales], ["Paquetes", resumen.por_tipo.paquete.iguales]]} />
          <Tarjeta
            titulo="Existen con otros datos"
            tono={resumen.cambiadas > 0 ? "alerta" : "neutro"}
            filas={[["Viajes", resumen.por_tipo.viaje.cambiadas], ["Embarques", resumen.por_tipo.embarque.cambiadas], ["Paquetes", resumen.por_tipo.paquete.cambiadas]]}
          />
          <Tarjeta titulo="Omitidas" tono={resumen.omitidas > 0 ? "alerta" : "neutro"} filas={[["Viajes", resumen.por_tipo.viaje.omitidas], ["Embarques", resumen.por_tipo.embarque.omitidas], ["Paquetes", resumen.por_tipo.paquete.omitidas]]} />
        </div>

        {aplicado && reporte.creados && reporte.creados.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Códigos asignados ({formatearNumero(reporte.creados.length)})</h3>
            <ul className="flex flex-wrap gap-1.5">
              {reporte.creados.map((c) => {
                const href = enlaceCreado(c);
                const texto = `${ETIQUETA_TIPO_AGRUPADOR[c.tipo]} ${c.codigo}`;
                return (
                  <li key={`${c.tipo}-${c.id}`} className="rounded-md border border-borde px-2 py-0.5 font-mono text-xs">
                    {href ? (
                      <Link href={href} className="text-marca-oscura underline-offset-2 hover:underline">
                        {texto}
                      </Link>
                    ) : (
                      texto
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {nuevasFilas.length > 0 && !aplicado && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Filas nuevas ({formatearNumero(nuevasFilas.length)})</h3>
            <DataTable columnas={columnasNuevas} filas={nuevasFilas} claveFila={(f) => `${f.fila}`} />
          </div>
        )}

        {cambiadas.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Ya existen con otros datos ({formatearNumero(cambiadas.length)})</h3>
            <p className="text-xs text-tinta-suave">Esta importación nunca edita lo que ya existe: estas filas no se tocan. Corrígelas en pantalla (Editar o Cambiar fechas).</p>
            <DataTable columnas={columnasCambiadas} filas={cambiadas} claveFila={(f) => `${f.fila}`} />
          </div>
        )}

        {conAvisos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Avisos ({conAvisos.reduce((a, f) => a + f.avisos.length, 0)})</h3>
            <ul className="space-y-1 text-xs text-alerta">
              {conAvisos.flatMap((f) =>
                f.avisos.map((a) => (
                  <li key={`${f.fila}-${a}`}>
                    ⚠ Fila {f.fila}: {ETIQUETA_AVISO_IMPORTACION_AGRUPADOR[a]}
                  </li>
                )),
              )}
            </ul>
          </div>
        )}

        {omitidas.length > 0 && (
          <TablaErrores
            errores={omitidas}
            todas={omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION_AGRUPADOR}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}
        {omitidas.length === 0 && cambiadas.length === 0 && nuevasFilas.length > 0 && !aplicado && <p className="text-xs text-tinta-suave">Todas las filas son válidas: {plural(nuevasFilas.length, "fila nueva", "filas nuevas")}.</p>}
      </div>
    </Card>
  );
}
