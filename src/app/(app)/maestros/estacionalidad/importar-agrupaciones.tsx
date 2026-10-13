"use client";

import {
  ETIQUETA_MOTIVO_OMISION_AGRUPACIONES,
  MAX_FILAS_IMPORTAR_AGRUPACIONES,
  type AgrupacionNuevaImportada,
  type FilaImportacionAgrupaciones,
  type FilaOmitidaAgrupaciones,
  type MotivoOmisionAgrupaciones,
  type ReporteImportacionAgrupaciones,
} from "@/lib/estacionalidad/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { BadgeTemporada } from "@/components/estacionalidad/temporada";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { CampoImportador, ColumnaOmitida } from "@/components/importador/tipos";
import { descargarCsv } from "@/components/importador/csv";
import { useImportador } from "@/components/importador/use-importador";
import { PasoArchivo } from "@/components/importador/paso-archivo";
import { BotonesImportar, PasoMapeo } from "@/components/importador/paso-mapeo";
import { Celda, TablaErrores, Tarjeta, detalleOmitida } from "@/components/importador/reporte";
import { formatearNumero, plural } from "@/lib/formato";

type Campo = keyof FilaImportacionAgrupaciones;

/** Nombre y géneros son obligatorios; el resto es opcional (las agrupaciones nuevas toman valores por defecto). */
const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "nombre", etiqueta: "Nombre", alias: ["NOMBRE", "AGRUPACION", "AGRUPACIONES", "NOMBRE_AGRUPACION", "AGRUPACION_ESTACIONALIDAD", "ESTACIONALIDAD"] },
  { campo: "generos", etiqueta: "Géneros", alias: ["GENEROS", "GENERO", "GENEROS_LK", "GENERO_LK"] },
  {
    campo: "codigo",
    etiqueta: "Código",
    alias: ["CODIGO", "COD", "CODIGO_AGRUPACION"],
    opcional: true,
    hint: "Sin mapear, el código se deriva del nombre.",
  },
  {
    campo: "temporada",
    etiqueta: "Temporada",
    alias: ["TEMPORADA", "TEMPORADA_AGRUPACION"],
    opcional: true,
    hint: "Sin mapear, las agrupaciones nuevas nacen como Toda temporada.",
  },
  {
    campo: "descripcion",
    etiqueta: "Descripción",
    alias: ["DESCRIPCION", "DESC", "NOTA", "NOTAS", "COMENTARIO", "COMENTARIOS", "OBSERVACION"],
    opcional: true,
    hint: "Sin mapear, las agrupaciones nuevas no tienen descripción.",
  },
  {
    campo: "orden",
    etiqueta: "Orden",
    alias: ["ORDEN", "POSICION", "SECUENCIA"],
    opcional: true,
    hint: "Sin mapear, se numeran a continuación de las que ya existen.",
  },
];

/** Cabecera y fila de ejemplo inventada de la plantilla; el ejemplo hay que borrarlo antes de subir el archivo. */
const ENCABEZADOS_PLANTILLA = ["NOMBRE", "CODIGO", "GENEROS", "TEMPORADA", "DESCRIPCION", "ORDEN"];
const FILA_EJEMPLO = ["ABRIGO EJEMPLO", "ABRIGO_EJEMPLO", "HOMBRE; MUJER", "Invierno", "Fila de ejemplo: bórrala antes de subir el archivo", "10"];

function descargarPlantilla() {
  descargarCsv(ENCABEZADOS_PLANTILLA, [FILA_EJEMPLO], "plantilla-agrupaciones-estacionalidad.csv");
}

/** Todo motivo salvo `ya_existe` (informativo) se arregla en el archivo cuando la fila es un error. */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmisionAgrupaciones> = new Set<MotivoOmisionAgrupaciones>(
  (Object.keys(ETIQUETA_MOTIVO_OMISION_AGRUPACIONES) as MotivoOmisionAgrupaciones[]).filter((m) => m !== "ya_existe")
);

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitidaAgrupaciones>[] = [
  { clave: "nombre", titulo: "Nombre", valor: (f) => f.nombre },
  { clave: "codigo", titulo: "Código", valor: (f) => f.codigo },
  { clave: "generos", titulo: "Géneros", valor: (f) => f.generos },
  { clave: "temporada", titulo: "Temporada", valor: (f) => f.temporada },
  { clave: "descripcion", titulo: "Descripción", valor: (f) => f.descripcion },
  { clave: "orden", titulo: "Orden", valor: (f) => f.orden },
];

/** Errores del archivo (hay que corregirlos) frente a omitidas informativas (ya existe, repetida exacta). */
function separar(omitidas: FilaOmitidaAgrupaciones[]) {
  return {
    errores: omitidas.filter((o) => !o.informativa),
    informativas: omitidas.filter((o) => o.informativa),
  };
}

function mensajeConfirmarAplicar(nombre: string, reporte: ReporteImportacionAgrupaciones): string {
  const { errores, informativas } = separar(reporte.omitidas);
  const partes = [`¿Aplicar la importación de ${nombre}? Se crearán ${plural(reporte.totales.a_crear, "agrupación", "agrupaciones")}. Las que ya existen no se modifican.`];
  if (informativas.length > 0) partes.push(`${plural(informativas.length, "fila", "filas")} no crean nada (ya existen o están repetidas en el archivo).`);
  if (errores.length > 0) partes.push(`Quedarán fuera ${plural(errores.length, "fila con errores", "filas con errores")}: no se cargarán.`);
  return partes.join("\n");
}

/**
 * Importador de agrupaciones de estacionalidad: crea agrupaciones nuevas en
 * bloque con el flujo de cuatro pasos compartido (archivo → mapeo →
 * previsualización → aplicar). Solo crea: una agrupación que ya existe nunca
 * se actualiza ni se borra por archivo.
 */
export function ImportarAgrupaciones({ onAplicado }: { onAplicado: () => void }) {
  const imp = useImportador<Campo, ReporteImportacionAgrupaciones>({
    campos: CAMPOS,
    url: "/api/agrupaciones-estacionalidad/importar",
    confirmarAplicar: mensajeConfirmarAplicar,
    // El servidor rechaza más de 5 000 filas: se avisa antes de enviar.
    maxFilas: MAX_FILAS_IMPORTAR_AGRUPACIONES,
  });
  const { archivo, previa, previaVigente, final } = imp;
  const sinNadaQueCrear = previaVigente !== null && previaVigente.reporte.totales.a_crear === 0;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <Alert tono="info">
        Formato: una fila por agrupación con NOMBRE y GENEROS (obligatorias) y, opcionales, CODIGO (vacío = se deriva del nombre), TEMPORADA (Invierno,
        Verano o Toda temporada; vacía = Toda temporada), DESCRIPCION y ORDEN (vacío = a continuación de las existentes). GENEROS admite uno o más
        géneros separados por coma, punto y coma, barra (/) o barra vertical (|). Solo se crean agrupaciones nuevas: las que ya existen por nombre
        o código se reportan como informativas y no se modifican (se editan en la pestaña Agrupaciones). Los géneros deben existir y estar activos.
        Después asigna las equivalencias desde Asignación o con el importador de Equivalencias.
      </Alert>

      <div className="flex flex-wrap items-center gap-3">
        <Button variante="secundario" tamano="sm" onClick={descargarPlantilla}>
          Descargar plantilla (CSV)
        </Button>
        <span className="text-xs text-tinta-suave">Trae una fila de ejemplo inventada (ABRIGO EJEMPLO): bórrala antes de subir el archivo.</span>
      </div>

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con la cabecera en la primera fila. Se lee en tu navegador; solo se envían las columnas mapeadas."
        hintHoja="El libro tiene varias hojas; elige la que contiene las agrupaciones."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Nombre y Géneros son obligatorios; el resto es opcional."
        >
          <BotonesImportar
            mapeoCompleto={imp.mapeoCompleto}
            enviando={imp.enviando}
            previaVigente={previaVigente !== null}
            previaDesactualizada={previa !== null && previaVigente === null}
            aplicado={final !== null || sinNadaQueCrear}
            onEnviar={imp.enviar}
          />
        </PasoMapeo>
      )}

      {previaVigente && !final && archivo && (
        <Reporte key={previaVigente.firma} titulo="3. Previsualización" reporte={previaVigente.reporte} nombreArchivo={archivo.nombre} />
      )}

      {final && archivo && (
        <>
          <Alert tono={final.totales.creadas > 0 ? "exito" : "info"}>
            {final.totales.creadas > 0
              ? `Importación aplicada: se ${final.totales.creadas === 1 ? "creó" : "crearon"} ${plural(final.totales.creadas, "agrupación", "agrupaciones")}.`
              : "Importación aplicada: no se creó ninguna agrupación."}
            {final.totales.con_error > 0 && ` ${plural(final.totales.con_error, "fila quedó", "filas quedaron")} fuera por errores: corrige el archivo y vuelve a importarlo.`}
            {final.totales.creadas > 0 && (
              <span className="ml-3">
                <Button tamano="sm" onClick={onAplicado}>
                  Ver agrupaciones
                </Button>
              </span>
            )}
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} />
        </>
      )}
    </div>
  );
}

function Reporte({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacionAgrupaciones; nombreArchivo: string }) {
  const aplicado = reporte.modo === "aplicar";
  const t = reporte.totales;
  const { errores, informativas } = separar(reporte.omitidas);

  return (
    <Card
      titulo={titulo}
      descripcion={`${formatearNumero(t.filas)} filas recibidas · ${formatearNumero(aplicado ? t.creadas : t.a_crear)} ${aplicado ? "creadas" : "a crear"} · ${formatearNumero(t.ya_existen)} ya existen · ${formatearNumero(t.con_error)} con errores`}
    >
      <div className="space-y-5">
        {t.a_crear === 0 && (
          <Alert tono="info">
            {t.con_error > 0
              ? "Ninguna fila crea una agrupación: revisa los errores de abajo."
              : "Nada que crear: todas las agrupaciones del archivo ya existen."}
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Tarjeta titulo={aplicado ? "Agrupaciones creadas" : "Agrupaciones a crear"} tono="exito" filas={[["Agrupaciones", aplicado ? t.creadas : t.a_crear]]} />
          <Tarjeta titulo="Ya existen" tono="neutro" filas={[["Filas", t.ya_existen]]} />
          <Tarjeta titulo="Con errores" tono={t.con_error > 0 ? "alerta" : "neutro"} filas={[["Filas", t.con_error]]} />
        </div>

        {reporte.agrupaciones_nuevas.length > 0 && <TablaNuevas agrupaciones={reporte.agrupaciones_nuevas} aplicado={aplicado} />}

        {errores.length > 0 && (
          <TablaErrores
            errores={errores}
            todas={reporte.omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION_AGRUPACIONES}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}

        {informativas.length > 0 && <TablaInformativas informativas={informativas} />}
      </div>
    </Card>
  );
}

/** Todas las agrupaciones que se crearán, con sus géneros y temporada: para detectar tipeos antes de aplicar. */
function TablaNuevas({ agrupaciones, aplicado }: { agrupaciones: AgrupacionNuevaImportada[]; aplicado: boolean }) {
  const columnas: Columna<AgrupacionNuevaImportada>[] = [
    { clave: "fila", titulo: "Fila", render: (g) => <span className="font-mono text-xs">{g.fila}</span> },
    { clave: "nombre", titulo: "Nombre", render: (g) => <span className="font-medium">{g.nombre}</span> },
    { clave: "codigo", titulo: "Código", render: (g) => <code className="font-mono text-xs">{g.codigo}</code> },
    {
      clave: "generos",
      titulo: "Géneros",
      render: (g) => (
        <ul className="flex flex-wrap gap-1" aria-label={`Géneros de ${g.nombre}`}>
          {g.generos.map((nombre) => (
            <li key={nombre}>
              <Badge>{nombre}</Badge>
            </li>
          ))}
        </ul>
      ),
    },
    { clave: "temporada", titulo: "Temporada", render: (g) => <BadgeTemporada temporada={g.temporada} /> },
    { clave: "orden", titulo: "Orden", render: (g) => <span className="font-mono text-xs">{formatearNumero(g.orden)}</span> },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        {aplicado ? "Agrupaciones creadas" : "Agrupaciones que se crearán"} ({formatearNumero(agrupaciones.length)})
      </h3>
      {!aplicado && (
        <p className="text-xs text-tinta-suave">
          Revisa los nombres: dos parecidas suelen ser un error de tipeo («PANTALON INVIERNO» y «PANTALONES INVIERNO»). Al aplicar, nacen sin
          equivalencias: asígnalas después.
        </p>
      )}
      <DataTable columnas={columnas} filas={agrupaciones} claveFila={(g) => `${g.fila}-${g.codigo}`} />
    </div>
  );
}

/** Filas que no crean nada y no hay que corregir: la agrupación ya existe o la fila repite otra idéntica. */
function TablaInformativas({ informativas }: { informativas: FilaOmitidaAgrupaciones[] }) {
  const columnas: Columna<FilaOmitidaAgrupaciones>[] = [
    { clave: "fila", titulo: "Fila", render: (f) => <span className="font-mono text-xs">{f.fila}</span> },
    { clave: "nombre", titulo: "Nombre", render: (f) => <Celda valor={f.nombre} /> },
    { clave: "codigo", titulo: "Código", render: (f) => <Celda valor={f.codigo} /> },
    { clave: "motivo", titulo: "Motivo", render: (f) => <Badge tono="neutro">{ETIQUETA_MOTIVO_OMISION_AGRUPACIONES[f.motivo] ?? f.motivo}</Badge> },
    { clave: "detalle", titulo: "Detalle", render: (f) => <Celda valor={detalleOmitida(f)} /> },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Ya existen o repetidas ({formatearNumero(informativas.length)})</h3>
      <p className="text-xs text-tinta-suave">
        Informativas: no son errores y no hay que corregirlas. Una agrupación que ya existe no se modifica por archivo (se edita en la pestaña
        Agrupaciones); una fila idéntica a otra anterior se procesa una sola vez.
      </p>
      <DataTable columnas={columnas} filas={informativas} claveFila={(f) => `${f.fila}-${f.motivo}`} />
    </div>
  );
}
