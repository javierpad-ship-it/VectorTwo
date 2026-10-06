"use client";

import {
  ETIQUETA_MOTIVO_OMISION_ESTACIONALIDAD,
  type AgrupacionNuevaImportacion,
  type FilaImportacionEstacionalidad,
  type FilaOmitidaEstacionalidad,
  type MotivoOmisionEstacionalidad,
  type ReasignacionImportacion,
  type ReporteImportacionEstacionalidad,
} from "@/lib/estacionalidad/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { CampoImportador, ColumnaOmitida } from "@/components/importador/tipos";
import { useImportador } from "@/components/importador/use-importador";
import { PasoArchivo } from "@/components/importador/paso-archivo";
import { BotonesImportar, PasoMapeo } from "@/components/importador/paso-mapeo";
import { TablaDuplicadas, TablaErrores, Tarjeta, descripcionTotales, separarOmitidas } from "@/components/importador/reporte";
import { formatearNumero, plural } from "@/lib/formato";

type Campo = keyof FilaImportacionEstacionalidad;

/** Las cuatro del árbol con los mismos alias que M1, más la agrupación. Las cinco son obligatorias. */
const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "genero", etiqueta: "Género", alias: ["GENERO_LK", "GENERO", "GENEROS"] },
  { campo: "mundo", etiqueta: "Mundo", alias: ["MUNDO", "GRUPO_PRODUCTO", "MUNDOS"] },
  { campo: "linea", etiqueta: "Línea", alias: ["LINEA", "LINEA_SAP", "LINEAS"] },
  { campo: "equivalencia", etiqueta: "Equivalencia", alias: ["EQUIVALENCIA", "EQUIVALENCIAS_LK", "EQUIVALENCIAS"] },
  {
    campo: "agrupacion",
    etiqueta: "Agrupación",
    alias: ["AGRUPACION", "AGRUPACION_ESTACIONALIDAD", "ESTACIONALIDAD", "CURVA"],
  },
];

/** Todos los motivos salvo la repetida se arreglan en el archivo. */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmisionEstacionalidad> = new Set<MotivoOmisionEstacionalidad>(
  (Object.keys(ETIQUETA_MOTIVO_OMISION_ESTACIONALIDAD) as MotivoOmisionEstacionalidad[]).filter((m) => m !== "duplicada_en_archivo")
);

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitidaEstacionalidad>[] = [
  { clave: "genero", titulo: "Género", valor: (f) => f.genero },
  { clave: "mundo", titulo: "Mundo", valor: (f) => f.mundo },
  { clave: "linea", titulo: "Línea", valor: (f) => f.linea },
  { clave: "equivalencia", titulo: "Equivalencia", valor: (f) => f.equivalencia },
  { clave: "agrupacion", titulo: "Agrupación", valor: (f) => f.agrupacion },
];

function nadaQueCambiar(r: ReporteImportacionEstacionalidad): boolean {
  return r.crear.agrupaciones === 0 && r.asignar.nuevas === 0 && r.asignar.reasignadas === 0;
}

function resumenCambios(r: ReporteImportacionEstacionalidad): string {
  const futuro = r.modo !== "aplicar";
  return `${futuro ? "Se crearán" : "Se crearon"} ${plural(r.crear.agrupaciones, "agrupación", "agrupaciones")}, ${futuro ? "se asignarán" : "se asignaron"} ${plural(
    r.asignar.nuevas,
    "equivalencia",
    "equivalencias"
  )} y ${formatearNumero(r.asignar.reasignadas)} ${futuro ? "cambiarán" : "cambiaron"} de agrupación.`;
}

function mensajeConfirmarAplicar(nombre: string, reporte: ReporteImportacionEstacionalidad): string {
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const partes = [`¿Aplicar la importación de ${nombre}? ${resumenCambios({ ...reporte, modo: "previsualizar" })}`];
  if (reporte.asignar.sin_cambio > 0) partes.push(`${plural(reporte.asignar.sin_cambio, "equivalencia", "equivalencias")} ya ${reporte.asignar.sin_cambio === 1 ? "tiene" : "tienen"} esa agrupación.`);
  if (errores.length > 0) partes.push(`Quedarán fuera ${plural(errores.length, "fila con errores", "filas con errores")}: no se cargarán.`);
  if (duplicadas.length > 0) partes.push(`${plural(duplicadas.length, "fila repetida", "filas repetidas")} en el archivo se procesan una sola vez.`);
  return partes.join("\n");
}

/**
 * Pestaña Importar: el flujo de cuatro pasos del importador compartido con
 * las cinco columnas `GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION`. Crea
 * agrupaciones y asigna; nunca toca el árbol ni quita agrupaciones.
 */
export function ImportarEstacionalidad({ onAplicado }: { onAplicado: () => void }) {
  const imp = useImportador<Campo, ReporteImportacionEstacionalidad>({
    campos: CAMPOS,
    url: "/api/estacionalidad/importar",
    confirmarAplicar: mensajeConfirmarAplicar,
  });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <Alert tono="info">
        Formato: las cuatro columnas del árbol más AGRUPACION (descárgalo listo desde Faltantes). Equivalencia vacía = la genérica del nodo; «-»
        = la que se llama como la línea. Las agrupaciones que no existan se crean con los géneros de sus filas; una equivalencia solo se asigna a una
        agrupación que incluya su género. Las filas que no casen con el árbol o con los géneros de la agrupación se reportan y no se cargan. Nunca se quita una agrupación por archivo.
      </Alert>

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con la cabecera en la primera fila. Se lee en tu navegador; solo se envían las cinco columnas mapeadas."
        hintHoja="El libro tiene varias hojas; elige la que contiene las asignaciones."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Las cinco columnas son obligatorias."
        >
          <BotonesImportar
            mapeoCompleto={imp.mapeoCompleto}
            enviando={imp.enviando}
            previaVigente={previaVigente !== null}
            previaDesactualizada={previa !== null && previaVigente === null}
            aplicado={final !== null}
            onEnviar={imp.enviar}
          />
        </PasoMapeo>
      )}

      {previaVigente && !final && archivo && (
        <Reporte key={previaVigente.firma} titulo="3. Previsualización" reporte={previaVigente.reporte} nombreArchivo={archivo.nombre} />
      )}

      {final && archivo && (
        <>
          <Alert tono="exito">
            Importación aplicada. {nadaQueCambiar(final) ? "Nada que cambiar: todo ya estaba igual." : resumenCambios(final)}
            <span className="ml-3">
              <Button tamano="sm" onClick={onAplicado}>
                Ver faltantes
              </Button>
            </span>
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} />
        </>
      )}
    </div>
  );
}

function Reporte({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacionEstacionalidad; nombreArchivo: string }) {
  const aplicado = reporte.modo === "aplicar";
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const a = reporte.asignar;

  return (
    <Card titulo={titulo} descripcion={descripcionTotales(reporte.totales)}>
      <div className="space-y-5">
        {nadaQueCambiar(reporte) && (
          <Alert tono="info">
            Nada que cambiar: todas las filas válidas del archivo ya tienen esa agrupación ({formatearNumero(a.sin_cambio)} sin cambio).
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tarjeta titulo={aplicado ? "Agrupaciones creadas" : "Agrupaciones a crear"} tono="exito" filas={[["Agrupaciones", reporte.crear.agrupaciones]]} />
          <Tarjeta titulo="Asignaciones nuevas" tono="exito" filas={[["Equivalencias", a.nuevas]]} />
          <Tarjeta titulo="Cambian de agrupación" tono={a.reasignadas > 0 ? "alerta" : "neutro"} filas={[["Equivalencias", a.reasignadas]]} />
          <Tarjeta titulo="Sin cambio" tono="neutro" filas={[["Equivalencias", a.sin_cambio]]} />
          <Tarjeta
            titulo="Omitidas"
            tono={errores.length > 0 ? "alerta" : "neutro"}
            filas={[
              ["Con errores", errores.length],
              ["Repetidas en el archivo", duplicadas.length],
            ]}
          />
        </div>

        {reporte.muestra.agrupaciones.length > 0 && <TablaAgrupacionesNuevas agrupaciones={reporte.muestra.agrupaciones} aplicado={aplicado} />}

        {reporte.reasignaciones.length > 0 && <TablaReasignaciones reasignaciones={reporte.reasignaciones} total={a.reasignadas} aplicado={aplicado} />}

        {errores.length > 0 && (
          <TablaErrores
            errores={errores}
            todas={reporte.omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION_ESTACIONALIDAD}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}

        {duplicadas.length > 0 && (
          <TablaDuplicadas
            duplicadas={duplicadas}
            columnasFila={COLUMNAS_FILA}
            descripcion="Misma equivalencia que una fila anterior con la misma agrupación. Se procesan una sola vez; no son errores y no hay que corregirlas. (Si la agrupación fuera distinta, saldría como «Contradictoria en el archivo» entre los errores.)"
          />
        )}
      </div>
    </Card>
  );
}

/** Todas las agrupaciones que se crearán, con cuántas filas apuntan a cada una: para detectar tipeos antes de aplicar. */
function TablaAgrupacionesNuevas({ agrupaciones, aplicado }: { agrupaciones: AgrupacionNuevaImportacion[]; aplicado: boolean }) {
  const columnas: Columna<AgrupacionNuevaImportacion>[] = [
    { clave: "nombre", titulo: "Nombre", render: (g) => <span className="font-medium">{g.nombre}</span> },
    { clave: "codigo", titulo: "Código", render: (g) => <code className="font-mono text-xs">{g.codigo}</code> },
    {
      clave: "generos",
      titulo: "Géneros",
      render: (g) =>
        (g.generos ?? []).length > 0 ? (
          <ul className="flex flex-wrap gap-1" aria-label={`Géneros de ${g.nombre}`}>
            {g.generos.map((nombre) => (
              <li key={nombre}>
                <Badge>{nombre}</Badge>
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-tinta-suave">—</span>
        ),
    },
    { clave: "equivalencias", titulo: "Equivalencias en el archivo", render: (g) => <span className="font-mono text-xs">{formatearNumero(g.equivalencias)}</span> },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        {aplicado ? "Agrupaciones creadas" : "Agrupaciones que se crearán"} ({formatearNumero(agrupaciones.length)})
      </h3>
      {!aplicado && (
        <p className="text-xs text-tinta-suave">
          Las agrupaciones nuevas se crean con los géneros de sus filas (la columna Géneros). Una agrupación que ya existe conserva los suyos: las
          filas de otro género se omiten y se reportan en «Filas con errores». Revisa los nombres: una con pocas equivalencias junto a otra parecida suele ser un error de tipeo («PANTALON INVIERNO» vs «PANTALONES
          INVIERNO»).
        </p>
      )}
      <DataTable columnas={columnas} filas={agrupaciones} claveFila={(g) => g.codigo} />
    </div>
  );
}

/** Equivalencias que ya tenían otra agrupación: el archivo manda, pero se muestran una por una. */
function TablaReasignaciones({ reasignaciones, total, aplicado }: { reasignaciones: ReasignacionImportacion[]; total: number; aplicado: boolean }) {
  const columnas: Columna<ReasignacionImportacion>[] = [
    { clave: "ruta", titulo: "Ruta", render: (r) => <span className="text-xs text-tinta-suave">{r.ruta}</span> },
    { clave: "equivalencia", titulo: "Equivalencia", render: (r) => <span className="font-medium">{r.equivalencia}</span> },
    { clave: "de", titulo: "De", render: (r) => r.de },
    { clave: "a", titulo: "A", render: (r) => <span className="font-medium">{r.a}</span> },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">
        {aplicado ? "Cambiaron de agrupación" : "Cambiarán de agrupación"} ({formatearNumero(total)})
      </h3>
      <Alert tono={aplicado ? "info" : "alerta"}>
        {aplicado ? "El archivo mandó: estas equivalencias ya tienen la agrupación nueva." : "El archivo manda: al aplicar, estas equivalencias pasan a la agrupación nueva."}
        {reasignaciones.length < total && ` Se muestran las primeras ${formatearNumero(reasignaciones.length)}.`}
      </Alert>
      <DataTable columnas={columnas} filas={reasignaciones} claveFila={(r) => `${r.ruta}|${r.equivalencia}`} />
    </div>
  );
}
