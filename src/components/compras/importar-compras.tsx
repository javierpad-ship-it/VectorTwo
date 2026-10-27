"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { descargarExcel } from "@/components/importador/excel";
import { PasoArchivo } from "@/components/importador/paso-archivo";
import { BotonesImportar, PasoMapeo } from "@/components/importador/paso-mapeo";
import { Muestra, TablaErrores, Tarjeta, descripcionTotales } from "@/components/importador/reporte";
import type { CampoImportador, ColumnaOmitida } from "@/components/importador/tipos";
import {
  ETIQUETA_TIPO_LINEA,
  type AplicadaImportacionApi,
  type AvisoImportacionCompra,
  type ClasificacionLineaImportada,
  type CompraImportacionApi,
  type FilaOmitidaCompra,
  type LineaImportacionApi,
  type NoAplicadaImportacionApi,
  type ReporteImportacionComprasApi,
} from "@/lib/compras/tipos-api";
import { formatearNumero, plural } from "@/lib/formato";
import { mesCorto, unidades } from "./formato";
import { useImportarCompras, type CampoCompra } from "./use-importar-compras";
import { ETIQUETA_MOTIVO_OMISION_COMPRA } from "./vista-importar";

/** Columnas de la plantilla. El ordinal de la línea se rotula `LINEA_ORDINAL` para no confundirlo con la línea de producto (`LINEA`). */
const CAMPOS: CampoImportador<CampoCompra>[] = [
  { campo: "proveedor", etiqueta: "Proveedor", alias: ["PROVEEDOR", "NOMBRE_PROVEEDOR"] },
  { campo: "fecha_compra", etiqueta: "Fecha de la compra", alias: ["FECHA_COMPRA", "FECHA"] },
  { campo: "referencia", etiqueta: "Referencia", alias: ["REFERENCIA", "REF", "ORDEN_DE_COMPRA", "OC", "PO"] },
  { campo: "linea_ordinal", etiqueta: "Número de línea", alias: ["LINEA_ORDINAL", "N_LINEA", "NRO_LINEA", "NUMERO_LINEA", "ORDINAL", "ITEM"] },
  { campo: "unidades", etiqueta: "Unidades", alias: ["UNIDADES", "CANTIDAD", "UNID"] },
  { campo: "tipo", etiqueta: "Tipo", alias: ["TIPO"], opcional: true, hint: "ESPECIFICA o UNA_MARCA; vacío = específica." },
  { campo: "genero", etiqueta: "Género", alias: ["GENERO"], opcional: true, hint: "Solo en líneas específicas." },
  { campo: "mundo", etiqueta: "Mundo", alias: ["MUNDO"], opcional: true, hint: "Solo en líneas específicas." },
  { campo: "linea", etiqueta: "Línea de producto", alias: ["LINEA", "LINEA_PRODUCTO"], opcional: true, hint: "Solo en líneas específicas." },
  { campo: "equivalencia", etiqueta: "Equivalencia", alias: ["EQUIVALENCIA"], opcional: true, hint: "Solo si el nodo se abre a equivalencias." },
  { campo: "marca", etiqueta: "Marca", alias: ["MARCA"], opcional: true, hint: "Marca o agrupación de marca, no las dos." },
  { campo: "agrupacion_marca", etiqueta: "Agrupación de marca", alias: ["AGRUPACION_MARCA", "AGRUPACION_DE_MARCA", "AGRUPACION"], opcional: true },
  { campo: "tallas", etiqueta: "Tallas", alias: ["TALLAS", "TALLA"], opcional: true, hint: "centrales, extremas o ambas." },
  { campo: "costo_unitario", etiqueta: "Costo unitario", alias: ["COSTO_UNITARIO", "COSTO", "COSTO_U"], opcional: true },
  { campo: "moneda", etiqueta: "Moneda", alias: ["MONEDA"], opcional: true, hint: "PEN o USD." },
  { campo: "llegada", etiqueta: "Llegada (aaaa-mm)", alias: ["LLEGADA", "MES_LLEGADA"], opcional: true, hint: "Una sola entrega." },
  { campo: "entregas", etiqueta: "Entregas (cronograma)", alias: ["ENTREGAS", "CRONOGRAMA"], opcional: true, hint: "2026-11:300;2026-12:200; manda sobre la llegada." },
  { campo: "recibidas", etiqueta: "Unidades ya recibidas", alias: ["RECIBIDAS", "UNIDADES_RECIBIDAS"], opcional: true, hint: "Lo que ya está en el stock." },
  { campo: "destino", etiqueta: "Destino", alias: ["DESTINO"], opcional: true, hint: "CD, un código de tienda o DIRECTO." },
  { campo: "alcance", etiqueta: "Alcance", alias: ["ALCANCE"], opcional: true, hint: "Solo en UNA_MARCA: HOMBRE;URBANO,CASUAL." },
  { campo: "nota", etiqueta: "Nota", alias: ["NOTA", "NOTAS"], opcional: true },
];

const COLUMNAS_PLANTILLA = ["PROVEEDOR", "FECHA_COMPRA", "REFERENCIA", "LINEA_ORDINAL", "TIPO", "GENERO", "MUNDO", "LINEA", "EQUIVALENCIA", "MARCA", "AGRUPACION_MARCA", "TALLAS", "UNIDADES", "COSTO_UNITARIO", "MONEDA", "LLEGADA", "ENTREGAS", "RECIBIDAS", "DESTINO", "ALCANCE", "NOTA"];
const FILA_EJEMPLO = ["Proveedor Norte", "2026-10-14", "PO-2211", "1", "ESPECIFICA", "HOMBRE", "URBANO", "DENIM", "", "ALFA", "", "centrales", "500", "38", "PEN", "", "2026-11:300;2026-12:200", "0", "CD", "", "Fila de ejemplo: bórrala o reemplázala"];

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitidaCompra>[] = [
  { clave: "proveedor", titulo: "Proveedor", valor: (f) => f.proveedor },
  { clave: "referencia", titulo: "Referencia", valor: (f) => f.referencia },
  { clave: "linea", titulo: "Línea n.º", valor: (f) => f.linea_ordinal },
];

const MOTIVOS_CORREGIBLES: ReadonlySet<string> = new Set(Object.keys(ETIQUETA_MOTIVO_OMISION_COMPRA));

const ETIQUETA_CLASIFICACION: Record<ClasificacionLineaImportada, { texto: string; tono: "exito" | "neutro" | "alerta" }> = {
  nueva: { texto: "Nueva", tono: "exito" },
  igual: { texto: "Igual (no hace nada)", tono: "neutro" },
  cambiada: { texto: "Cambiada (se omite)", tono: "alerta" },
};

const ETIQUETA_AVISO: Record<AvisoImportacionCompra, string> = {
  sin_reparto: "sin reparto vigente",
  entrega_pasada: "entrega en un mes ya publicado sin ingreso: quedará vencida",
  directo_con_regla: "directo con regla: se suma a la reposición esperada",
  directo_sin_regla: "directo sin regla de intercompany",
  exceso: "deja el IMI sobre el máximo (informativo)",
  miembro_resuelto: "miembro de agrupación resuelto",
};

function resumen(r: ReporteImportacionComprasApi): string {
  const verbo = r.modo === "aplicar" ? "Se crearon" : "Se crearán";
  const lineasNuevas = r.compras_a_crear.reduce((a, c) => a + c.lineas_nuevas, 0);
  return `${verbo} ${plural(r.compras_a_crear.length, "compra", "compras")} con ${plural(lineasNuevas, "línea nueva", "líneas nuevas")} y ${plural(r.proveedores_a_crear.length, "proveedor", "proveedores")}.`;
}

function mensajeConfirmarAplicar(nombre: string, r: ReporteImportacionComprasApi): string {
  const partes = [`¿Aplicar la carga inicial de ${nombre}? ${resumen({ ...r, modo: "previsualizar" })}`];
  partes.push("Las compras entran como ya hechas (confirmadas, origen carga inicial) y, desde ahora, cuentan en el flujo. Se aplican una por una: si algo se corta, reimporta el archivo y se completará lo que falte.");
  if (r.omitidas.length > 0) partes.push(`Quedarán fuera ${plural(r.omitidas.length, "fila omitida", "filas omitidas")}: no se cargarán.`);
  return partes.join("\n");
}

/**
 * Importar compras (ficha 08 §4.7; solo admin y planner): la carga inicial de las compras en curso desde una plantilla Excel o CSV, en
 * cuatro pasos (archivo, mapeo, previsualizar, aplicar). En `0.13.0` la casilla «Carga inicial de compras ya hechas» es obligatoria: crea
 * compras confirmadas con origen carga inicial. Es idempotente por la clave proveedor + referencia + línea: reimportar el mismo archivo no
 * duplica nada, insertar o corregir filas solo afecta a esas filas, y las líneas cambiadas se omiten (para corregirlas se cancela la compra
 * y se reimporta). Crea proveedores nuevos; nunca marcas ni árbol de producto.
 */
export function ImportarCompras({ onAplicado }: { onAplicado: () => void }) {
  // La casilla es obligatoria en `0.13.0`: arranca marcada y sin ella la API responde 400.
  const [cargaInicial, setCargaInicial] = useState(true);
  const imp = useImportarCompras({ campos: CAMPOS, cargaInicial, confirmarAplicar: mensajeConfirmarAplicar });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <Card titulo="Plantilla y modo" descripcion="Descarga la plantilla, llénala con las compras en curso y súbela. Cada línea necesita proveedor, fecha, referencia y número de línea: con eso, reimportar el mismo archivo no duplica nada.">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button variante="secundario" onClick={() => void descargarExcel(COLUMNAS_PLANTILLA, [FILA_EJEMPLO], "COMPRAS", "plantilla-compras.xlsx")}>
              Descargar plantilla (Excel)
            </Button>
          </div>
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={cargaInicial} onChange={setCargaInicial} label="Carga inicial de compras ya hechas" className="mt-0.5" />
            <span>
              <strong>Carga inicial de compras ya hechas.</strong> Entran confirmadas y a nombre de quien importa. Por ahora es la única forma de importar: sin marcarla, la API no aplica nada.
            </span>
          </label>
          {!cargaInicial && <Alert tono="info">Por ahora solo se pueden importar compras ya hechas: marca la casilla «Carga inicial de compras ya hechas».</Alert>}
        </div>
      </Card>

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con la cabecera de la plantilla. Se lee en tu navegador; solo se envían las columnas mapeadas."
        hintHoja="El libro tiene varias hojas; elige la que contiene las compras (la hoja MEZCLA de varias marcas se activa con la herramienta del comprador)."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Proveedor, fecha, referencia, número de línea y unidades son obligatorios; el resto depende del tipo de línea. Si tu archivo repite el encabezado LINEA (el número y la línea de producto), renombra el primero a LINEA_ORDINAL."
        >
          <BotonesImportar
            mapeoCompleto={imp.mapeoCompleto && cargaInicial}
            enviando={imp.enviando}
            previaVigente={previaVigente !== null}
            previaDesactualizada={previa !== null && previaVigente === null}
            aplicado={final !== null}
            onEnviar={imp.enviar}
          />
        </PasoMapeo>
      )}

      {previaVigente && !final && archivo && <ReporteImportacionCompras key={previaVigente.firma} titulo="3. Previsualización" reporte={previaVigente.reporte} nombreArchivo={archivo.nombre} />}

      {final && archivo && (
        <>
          <Alert tono={final.no_aplicadas.length === 0 ? "exito" : "alerta"}>
            {final.no_aplicadas.length === 0 ? "Importación aplicada. " : `Importación aplicada con ${plural(final.no_aplicadas.length, "compra sin aplicar", "compras sin aplicar")}: reimporta el archivo y se completará lo que falte. `}
            {resumen(final)}
            <span className="ml-3">
              <Button tamano="sm" onClick={onAplicado}>
                Ver las compras
              </Button>
            </span>
          </Alert>
          <ReporteImportacionCompras titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} />
        </>
      )}
    </div>
  );
}

export function ReporteImportacionCompras({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacionComprasApi; nombreArchivo: string }) {
  const aplicado = reporte.modo === "aplicar";
  const lineasNuevas = reporte.compras_a_crear.reduce((a, c) => a + c.lineas_nuevas, 0);

  const columnasCompras: Columna<CompraImportacionApi>[] = [
    { clave: "proveedor", titulo: "Proveedor", render: (c) => <span className="font-medium">{c.proveedor}</span> },
    { clave: "referencia", titulo: "Referencia", render: (c) => c.referencia },
    { clave: "fecha", titulo: "Fecha", render: (c) => c.fecha_compra },
    { clave: "moneda", titulo: "Moneda", render: (c) => c.moneda },
    { clave: "lineas", titulo: "Líneas", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{c.lineas}</span> },
    { clave: "nuevas", titulo: "Nuevas", className: "text-right", render: (c) => <span className="font-mono tabular-nums">{c.lineas_nuevas}</span> },
    { clave: "existente", titulo: "Compra", render: (c) => (c.existente ? <span className="text-xs">se agregan a {c.existente.numero}</span> : <Badge tono="exito">Compra nueva</Badge>) },
  ];

  const columnasLineas: Columna<LineaImportacionApi>[] = [
    { clave: "fila", titulo: "Fila", render: (l) => <span className="font-mono text-xs">{l.fila}</span> },
    { clave: "clave", titulo: "Compra · línea", render: (l) => <span className="text-xs">{l.clave.split("|").join(" · ")}</span> },
    {
      clave: "clasificacion",
      titulo: "Estado",
      render: (l) => {
        const c = ETIQUETA_CLASIFICACION[l.clasificacion];
        return (
          <span className="flex flex-col gap-0.5">
            <span>
              <Badge tono={c.tono}>{c.texto}</Badge>
            </span>
            {l.cambios.length > 0 && <span className="text-[11px] text-tinta-suave">{l.cambios.join("; ")}</span>}
          </span>
        );
      },
    },
    { clave: "tipo", titulo: "Tipo", render: (l) => <span className="text-xs">{ETIQUETA_TIPO_LINEA[l.tipo]}</span> },
    {
      clave: "donde",
      titulo: "GML / marca",
      render: (l) => (
        <span className="text-xs">
          {l.ruta ?? "al barrer"}
          <span className="block text-tinta-suave">{l.marca ?? l.agrupacion_marca ?? "—"}</span>
        </span>
      ),
    },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (l) => <span className="font-mono tabular-nums">{unidades(l.unidades)}</span> },
    { clave: "recibidas", titulo: "Recibidas", className: "text-right", render: (l) => <span className="font-mono tabular-nums">{unidades(l.recibidas)}</span> },
    { clave: "entregas", titulo: "Entregas", render: (l) => <span className="whitespace-nowrap text-xs">{l.entregas.map((e) => `${mesCorto(e.periodo)} · ${unidades(e.unidades)}`).join(" | ") || "—"}</span> },
    { clave: "avisos", titulo: "Avisos", render: (l) => (l.avisos.length === 0 ? <span className="text-tinta-suave">—</span> : <span className="flex flex-col gap-0.5 text-[11px] text-alerta">{l.avisos.map((a) => <span key={a}>⚠ {ETIQUETA_AVISO[a]}</span>)}</span>) },
  ];

  const columnasAplicadas: Columna<AplicadaImportacionApi>[] = [
    { clave: "numero", titulo: "Compra", render: (a) => <span className="font-medium">{a.numero}</span> },
    { clave: "clave", titulo: "Clave", render: (a) => <span className="text-xs">{a.clave.split("|").join(" · ")}</span> },
    { clave: "lineas", titulo: "Líneas", className: "text-right", render: (a) => <span className="font-mono tabular-nums">{a.lineas}</span> },
  ];
  const columnasNoAplicadas: Columna<NoAplicadaImportacionApi>[] = [
    { clave: "proveedor", titulo: "Proveedor", render: (n) => n.proveedor },
    { clave: "referencia", titulo: "Referencia", render: (n) => n.referencia },
    { clave: "motivo", titulo: "Motivo", render: (n) => <span className="text-xs text-alerta">{n.mensaje}</span> },
  ];

  return (
    <Card titulo={titulo} descripcion={descripcionTotales(reporte.totales)}>
      <div className="space-y-5">
        {reporte.totales.nuevas === 0 && reporte.omitidas.length === 0 && <Alert tono="info">Nada que cargar: todas las líneas del archivo ya existen con el mismo contenido.</Alert>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tarjeta
            titulo={aplicado ? "Se crearon" : "Se crearán"}
            tono="exito"
            filas={[
              ["Compras", reporte.compras_a_crear.filter((c) => !c.existente).length],
              ["Líneas nuevas", lineasNuevas],
              ["Proveedores", reporte.proveedores_a_crear.length],
            ]}
          />
          <Tarjeta
            titulo="Ya existían"
            tono="neutro"
            filas={[
              ["Líneas iguales", reporte.totales.iguales],
              ["Líneas cambiadas", reporte.totales.cambiadas],
            ]}
          />
          <Tarjeta titulo="Omitidas" tono={reporte.omitidas.length > 0 ? "alerta" : "neutro"} filas={[["Filas", reporte.omitidas.length]]} />
        </div>
        {reporte.k_prima && <p className="-mt-3 text-xs text-tinta-suave">Último mes publicado: {mesCorto(reporte.k_prima)}. Las entregas hasta ese mes sin unidades recibidas quedarán vencidas y la conciliación las mostrará.</p>}

        {reporte.proveedores_a_crear.length > 0 && <Muestra titulo={aplicado ? "Proveedores creados" : "Proveedores que se crearán"} items={reporte.proveedores_a_crear} />}

        {reporte.compras_a_crear.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Compras ({formatearNumero(reporte.compras_a_crear.length)})</h3>
            <DataTable columnas={columnasCompras} filas={reporte.compras_a_crear} claveFila={(c) => c.clave} />
          </div>
        )}

        {reporte.lineas.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Líneas ({formatearNumero(reporte.lineas.length)})</h3>
            <DataTable columnas={columnasLineas} filas={reporte.lineas} claveFila={(l) => l.clave} />
          </div>
        )}

        {reporte.avisos.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Avisos ({reporte.avisos.length})</h3>
            <ul className="space-y-1 text-xs text-alerta">
              {reporte.avisos.map((a, i) => (
                <li key={`${a.fila}-${a.aviso}-${i}`}>
                  ⚠ Fila {a.fila}: {ETIQUETA_AVISO[a.aviso]}
                  {a.detalle ? ` (${a.detalle})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}

        {aplicado && reporte.aplicadas.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Compras aplicadas ({reporte.aplicadas.length})</h3>
            <DataTable columnas={columnasAplicadas} filas={reporte.aplicadas} claveFila={(a) => a.compra_id} />
          </div>
        )}
        {aplicado && reporte.no_aplicadas.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Compras que no se aplicaron ({reporte.no_aplicadas.length})</h3>
            <DataTable columnas={columnasNoAplicadas} filas={reporte.no_aplicadas} claveFila={(n) => n.clave} />
          </div>
        )}

        {reporte.omitidas.length > 0 && (
          <TablaErrores
            errores={reporte.omitidas}
            todas={reporte.omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION_COMPRA}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}
      </div>
    </Card>
  );
}
