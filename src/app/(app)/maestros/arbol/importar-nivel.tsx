"use client";

import {
  ETIQUETA_MOTIVO_OMISION_NIVEL,
  type ArbolRespuesta,
  type CambioNivel,
  type FilaImportacionNivel,
  type FilaOmitidaNivel,
  type MotivoOmisionNivel,
  type ReporteImportacionNivel,
} from "@/lib/arbol/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
import type { CampoImportador, ColumnaOmitida } from "@/components/importador/tipos";
import { useImportador } from "@/components/importador/use-importador";
import { PasoArchivo } from "@/components/importador/paso-archivo";
import { BotonesImportar, PasoMapeo } from "@/components/importador/paso-mapeo";
import { descargarCsv } from "@/components/importador/csv";
import { Muestra, TablaDuplicadas, TablaErrores, Tarjeta, descripcionTotales, separarOmitidas } from "@/components/importador/reporte";
import { formatearNumero, plural } from "@/lib/formato";

type Campo = keyof FilaImportacionNivel;

const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "genero", etiqueta: "Género", alias: ["GENERO", "GENERO_LK", "GENEROS"] },
  { campo: "mundo", etiqueta: "Mundo", alias: ["MUNDO", "GRUPO_PRODUCTO", "MUNDOS"] },
  { campo: "linea", etiqueta: "Línea", alias: ["LINEA", "LINEA_SAP", "LINEAS"] },
  { campo: "nivel", etiqueta: "Nivel", alias: ["NIVEL", "NIVEL_PLANIFICACION", "PLANIFICAR_POR"] },
];

/** Todo se arregla en el archivo salvo la repetida. */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmisionNivel> = new Set<MotivoOmisionNivel>(
  (Object.keys(ETIQUETA_MOTIVO_OMISION_NIVEL) as MotivoOmisionNivel[]).filter((m) => m !== "duplicada_en_archivo")
);

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitidaNivel>[] = [
  { clave: "genero", titulo: "Género", valor: (f) => f.genero },
  { clave: "mundo", titulo: "Mundo", valor: (f) => f.mundo },
  { clave: "linea", titulo: "Línea", valor: (f) => f.linea },
  { clave: "nivel", titulo: "Nivel", valor: (f) => f.nivel },
];

function resumen(r: ReporteImportacionNivel): string {
  const verbo = r.modo === "aplicar" ? "Cambiaron" : "Cambiarán";
  return `${verbo} de nivel ${plural(r.cambios.length, "nodo", "nodos")}; ${formatearNumero(r.sin_cambio)} ya estaban así.`;
}

function mensajeConfirmarAplicar(nombre: string, reporte: ReporteImportacionNivel): string {
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const abren = reporte.cambios.filter((c) => c.a === "GMLE").length;
  const cierran = reporte.cambios.length - abren;
  const partes = [`¿Aplicar la importación de ${nombre}? ${resumen({ ...reporte, modo: "previsualizar" })}`];
  partes.push(`Se abren a GMLE ${abren} y vuelven a GML ${cierran}. El archivo manda; los nodos que no aparecen no se tocan.`);
  if (errores.length > 0) partes.push(`Quedarán fuera ${plural(errores.length, "fila con errores", "filas con errores")}: no se cargarán.`);
  if (duplicadas.length > 0) partes.push(`${plural(duplicadas.length, "fila repetida", "filas repetidas")} en el archivo se cargan una sola vez.`);
  return partes.join("\n");
}

/** Descarga los niveles actuales (todos los nodos vigentes) en el mismo formato que acepta el importador. */
export function descargarNiveles(arbol: ArbolRespuesta | null) {
  if (!arbol) return;
  const filas: string[][] = [];
  for (const g of arbol.generos) {
    for (const m of g.mundos) {
      for (const l of m.lineas) {
        if (l.vigente) filas.push([g.nombre, m.nombre, l.nombre, l.nivel_planificacion]);
      }
    }
  }
  descargarCsv(["GENERO", "MUNDO", "LINEA", "NIVEL"], filas, "niveles-de-planificacion.csv");
}

/** Importador de niveles de planificación (`GENERO, MUNDO, LINEA, NIVEL`): el archivo manda, nunca crea árbol. */
export function ImportarNivel({ arbol, onAplicado }: { arbol: ArbolRespuesta | null; onAplicado: () => void }) {
  const imp = useImportador<Campo, ReporteImportacionNivel>({
    campos: CAMPOS,
    url: "/api/arbol/nodos/nivel/importar",
    confirmarAplicar: mensajeConfirmarAplicar,
  });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <Card
        titulo="Niveles de planificación actuales"
        descripcion="Descarga el CSV con el nivel de cada nodo vigente (GENERO, MUNDO, LINEA, NIVEL): sirve de plantilla para cambiarlo en Excel y volver a subirlo."
      >
        <Button variante="secundario" onClick={() => descargarNiveles(arbol)} disabled={!arbol}>
          Descargar niveles (CSV)
        </Button>
      </Card>

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con GENERO, MUNDO, LINEA y NIVEL (GML o GMLE) en la cabecera. Se lee en tu navegador; solo se envían las cuatro columnas mapeadas."
        hintHoja="El libro tiene varias hojas; elige la que contiene los niveles."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Las cuatro columnas son obligatorias. El nivel acepta GML, GMLE y, como sinónimos, LINEA y EQUIVALENCIA. Aquí el archivo manda: un nodo con otro nivel se cambia; los nodos que no aparecen no se tocan."
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

      {previaVigente && !final && archivo && <Reporte key={previaVigente.firma} titulo="3. Previsualización" reporte={previaVigente.reporte} nombreArchivo={archivo.nombre} />}

      {final && archivo && (
        <>
          <Alert tono="exito">
            Importación aplicada. {resumen(final)}
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

function Reporte({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacionNivel; nombreArchivo: string }) {
  const aplicado = reporte.modo === "aplicar";
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const abren = reporte.cambios.filter((c) => c.a === "GMLE").length;
  const cierran = reporte.cambios.length - abren;

  const columnasCambios: Columna<CambioNivel>[] = [
    { clave: "fila", titulo: "Fila", render: (c) => <span className="font-mono text-xs">{c.fila}</span> },
    { clave: "ruta", titulo: "Nodo", render: (c) => <span className="font-medium">{c.ruta}</span> },
    { clave: "de", titulo: aplicado ? "Era" : "Hoy", render: (c) => c.de },
    { clave: "a", titulo: aplicado ? "Quedó" : "Pasará a", render: (c) => <Badge tono={c.a === "GMLE" ? "marca" : "neutro"}>{c.a}</Badge> },
  ];

  return (
    <Card titulo={titulo} descripcion={descripcionTotales(reporte.totales)}>
      <div className="space-y-5">
        {reporte.cambios.length === 0 && <Alert tono="info">Nada que cambiar: todos los nodos válidos del archivo ya tienen ese nivel.</Alert>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Tarjeta
            titulo={aplicado ? "Cambiaron" : "Cambiarán"}
            tono="exito"
            filas={[
              ["Se abren a GMLE", abren],
              ["Vuelven a GML", cierran],
            ]}
          />
          <Tarjeta titulo="Ya tenían ese nivel" tono="neutro" filas={[["Nodos", reporte.sin_cambio]]} />
          <Tarjeta
            titulo="Omitidas"
            tono={errores.length > 0 ? "alerta" : "neutro"}
            filas={[
              ["Con errores", errores.length],
              ["Repetidas en el archivo", duplicadas.length],
            ]}
          />
        </div>

        {reporte.cambios.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{aplicado ? "Nodos que cambiaron" : "Nodos que cambiarán"} ({formatearNumero(reporte.cambios.length)})</h3>
            <DataTable columnas={columnasCambios} filas={reporte.cambios} claveFila={(c) => `${c.fila}-${c.ruta}`} />
          </div>
        )}

        {errores.length > 0 && (
          <TablaErrores
            errores={errores}
            todas={reporte.omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION_NIVEL}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}

        {duplicadas.length > 0 && (
          <TablaDuplicadas
            duplicadas={duplicadas}
            columnasFila={COLUMNAS_FILA}
            descripcion="Mismo nodo que una fila anterior (la primera aparición manda; si el nivel difiere, el detalle lo dice). Se procesa una sola vez; no es un error."
          />
        )}

        {reporte.muestra.cambios.length > 0 && <Muestra titulo={aplicado ? "Cambios aplicados (muestra)" : "Cambios que se aplicarán (muestra)"} items={reporte.muestra.cambios} />}
      </div>
    </Card>
  );
}
