"use client";

import {
  ETIQUETA_MOTIVO_OMISION,
  type FilaImportacion,
  type FilaOmitida,
  type MotivoOmision,
  type ReporteImportacion,
} from "@/lib/arbol/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { CampoImportador, ColumnaOmitida } from "@/components/importador/tipos";
import { useImportador } from "@/components/importador/use-importador";
import { PasoArchivo } from "@/components/importador/paso-archivo";
import { BotonesImportar, PasoMapeo } from "@/components/importador/paso-mapeo";
import {
  Muestra,
  TablaDuplicadas,
  TablaErrores,
  Tarjeta,
  descripcionTotales,
  separarOmitidas,
} from "@/components/importador/reporte";
import { formatearNumero, plural } from "@/lib/formato";

type Campo = keyof FilaImportacion;

const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "genero", etiqueta: "Género", alias: ["GENERO_LK", "GENERO", "GENEROS"] },
  { campo: "mundo", etiqueta: "Mundo", alias: ["MUNDO", "GRUPO_PRODUCTO", "MUNDOS"] },
  { campo: "linea", etiqueta: "Línea", alias: ["LINEA", "LINEA_SAP", "LINEAS"] },
  { campo: "equivalencia", etiqueta: "Equivalencia", alias: ["EQUIVALENCIA", "EQUIVALENCIAS_LK", "EQUIVALENCIAS"] },
];

/** Motivos que se arreglan en el archivo (falta el mundo o el género/mundo no existe en el catálogo). */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmision> = new Set<MotivoOmision>([
  "mundo_vacio",
  "genero_desconocido",
  "mundo_desconocido",
]);

/** Columnas comunes a ambas tablas de omitidas: la fila completa normalizada. */
const COLUMNAS_FILA: ColumnaOmitida<FilaOmitida>[] = [
  { clave: "genero", titulo: "Género", valor: (f) => f.genero },
  { clave: "mundo", titulo: "Mundo", valor: (f) => f.mundo },
  { clave: "linea", titulo: "Línea", valor: (f) => f.linea },
  { clave: "equivalencia", titulo: "Equivalencia", valor: (f) => f.equivalencia },
];

function mensajeConfirmarAplicar(nombre: string, reporte: ReporteImportacion): string {
  const c = reporte.crear;
  const total = c.lineas + c.nodos + c.equivalencias + c.equivalencias_genericas;
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const partes = [`¿Aplicar la importación de ${nombre}? Se crearán ${plural(total, "registro nuevo", "registros nuevos")}.`];
  if (errores.length > 0) {
    partes.push(`Quedarán fuera ${plural(errores.length, "fila con errores", "filas con errores")}: no se cargarán.`);
  }
  if (duplicadas.length > 0) {
    partes.push(`${plural(duplicadas.length, "fila repetida", "filas repetidas")} en el archivo se cargan una sola vez.`);
  }
  return partes.join("\n");
}

export function ImportarCsv({ onAplicado }: { onAplicado: () => void }) {
  const imp = useImportador<Campo, ReporteImportacion>({
    campos: CAMPOS,
    url: "/api/arbol/importar",
    confirmarAplicar: mensajeConfirmarAplicar,
  });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con la cabecera en la primera fila. Se lee en tu navegador; solo se envían las cuatro columnas del árbol ya mapeadas."
        hintHoja="El libro tiene varias hojas; elige la que contiene el árbol."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Las cuatro columnas son obligatorias."
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
            Importación aplicada. {resumenCrear(final)}
            <span className="ml-3">
              <Button tamano="sm" onClick={onAplicado}>
                Ver el árbol
              </Button>
            </span>
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} />
        </>
      )}
    </div>
  );
}

function resumenCrear(r: ReporteImportacion): string {
  const c = r.crear;
  const verbo = r.modo === "aplicar" ? "Creadas" : "Se crearán";
  return `${verbo} ${formatearNumero(c.lineas)} líneas, ${formatearNumero(c.nodos)} nodos, ${formatearNumero(c.equivalencias)} equivalencias y ${formatearNumero(c.equivalencias_genericas)} genéricas.`;
}

function Reporte({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacion; nombreArchivo: string }) {
  const c = reporte.crear;
  const nadaNuevo = c.lineas + c.nodos + c.equivalencias + c.equivalencias_genericas === 0;
  const aplicado = reporte.modo === "aplicar";
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);

  return (
    <Card titulo={titulo} descripcion={descripcionTotales(reporte.totales)}>
      <div className="space-y-5">
        {nadaNuevo && (
          <Alert tono="info">
            Nada nuevo que crear: todo lo que trae el archivo ya existe en el árbol.
          </Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta
            titulo={aplicado ? "Creados" : "Se crearán"}
            tono="exito"
            filas={[
              ["Líneas", c.lineas],
              ["Nodos", c.nodos],
              ["Equivalencias", c.equivalencias],
              ["Genéricas (SIN EQUIVALENCIA)", c.equivalencias_genericas],
            ]}
          />
          <Tarjeta
            titulo="Ya existían"
            tono="neutro"
            filas={[
              ["Líneas", reporte.existentes.lineas],
              ["Nodos", reporte.existentes.nodos],
              ["Equivalencias", reporte.existentes.equivalencias],
            ]}
          />
          <Tarjeta
            titulo="Existentes inactivos (no se tocan)"
            tono="neutro"
            filas={[
              ["Líneas", reporte.existentes_inactivos.lineas],
              ["Nodos", reporte.existentes_inactivos.nodos],
              ["Equivalencias", reporte.existentes_inactivos.equivalencias],
            ]}
          />
          <Tarjeta
            titulo="Omitidas"
            tono={errores.length > 0 ? "alerta" : "neutro"}
            filas={[
              ["Con errores", errores.length],
              ["Repetidas en el archivo", duplicadas.length],
            ]}
          />
        </div>

        {errores.length > 0 && (
          <TablaErrores
            errores={errores}
            todas={reporte.omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}

        {duplicadas.length > 0 && (
          <TablaDuplicadas
            duplicadas={duplicadas}
            columnasFila={COLUMNAS_FILA}
            descripcion="Misma combinación género · mundo · línea · equivalencia que una fila anterior. Se procesan una sola vez; no son errores y no hay que corregirlas."
          />
        )}

        {(reporte.muestra.lineas.length > 0 || reporte.muestra.nodos.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            <Muestra titulo={aplicado ? "Líneas creadas (muestra)" : "Líneas que se crearán (muestra)"} items={reporte.muestra.lineas} />
            <Muestra titulo={aplicado ? "Nodos creados (muestra)" : "Nodos que se crearán (muestra)"} items={reporte.muestra.nodos} />
          </div>
        )}
      </div>
    </Card>
  );
}
