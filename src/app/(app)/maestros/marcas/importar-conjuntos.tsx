"use client";

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
import {
  ETIQUETA_MOTIVO_OMISION_CONJUNTO,
  type CambioConjunto,
  type ConjuntoACrear,
  type FilaImportacionConjunto,
  type FilaOmitidaConjunto,
  type MotivoOmisionConjunto,
  type ReporteImportacionConjuntos,
} from "@/components/marcas/tipos-m2b";
import { formatearNumero, plural } from "@/lib/formato";

type Campo = keyof FilaImportacionConjunto;

const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "marca", etiqueta: "Marca", alias: ["MARCA", "MARCAS", "BRAND"] },
  { campo: "conjunto", etiqueta: "Conjunto", alias: ["CONJUNTO", "CABEZA", "CASA", "LICENCIA"] },
];

/** Informativas o repetidas: no hay nada que corregir en el archivo. */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmisionConjunto> = new Set<MotivoOmisionConjunto>([
  "marca_vacia",
  "fila_total",
  "marca_desconocida",
  "marca_generica",
  "marca_es_cabeza",
  "conjunto_es_miembro",
  "cabeza_inactiva",
  "agrupacion_inactiva",
]);

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitidaConjunto>[] = [
  { clave: "marca", titulo: "Marca", valor: (f) => f.marca },
  { clave: "conjunto", titulo: "Conjunto", valor: (f) => f.conjunto },
];


function resumen(r: ReporteImportacionConjuntos): string {
  const verbo = r.modo === "aplicar" ? "Asignadas" : "Se asignarán";
  const partes = [`${verbo} ${plural(r.asignar, "marca", "marcas")} a su conjunto`];
  const cambios = r.cambios.length;
  if (cambios > 0) partes.push(`${plural(cambios, "cambia", "cambian")} de conjunto`);
  const crear = r.conjuntos_a_crear.length;
  if (crear > 0) partes.push(`${r.modo === "aplicar" ? "creadas" : "se crearán"} ${plural(crear, "marca cabeza", "marcas cabeza")}`);
  return `${partes.join("; ")}.`;
}

function mensajeConfirmarAplicar(nombre: string, reporte: ReporteImportacionConjuntos): string {
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const partes = [`¿Aplicar la importación de ${nombre}? ${resumen({ ...reporte, modo: "previsualizar" })}`];
  for (const c of reporte.conjuntos_a_crear) partes.push(`Se creará la cabeza ${c.conjunto} en ${c.agrupacion}.`);
  if (reporte.cambios.length > 0) partes.push(`El archivo manda: ${plural(reporte.cambios.length, "marca cambia", "marcas cambian")} de conjunto.`);
  if (errores.length > 0) partes.push(`Quedarán fuera ${plural(errores.length, "fila con errores", "filas con errores")}: no se cargarán.`);
  if (duplicadas.length > 0) partes.push(`${plural(duplicadas.length, "fila repetida", "filas repetidas")} en el archivo se cargan una sola vez.`);
  partes.push("Los miembros cuentan como su cabeza en el flujo; la venta cargada no cambia.");
  return partes.join("\n");
}

/** Hoja `MARCA, CONJUNTO`: el archivo manda (una marca en otro conjunto se cambia) y se crean las cabezas que falten. */
export function ImportarConjuntos({ onAplicado }: { onAplicado: () => void }) {
  const imp = useImportador<Campo, ReporteImportacionConjuntos>({
    campos: CAMPOS,
    url: "/api/marcas/conjuntos/importar",
    confirmarAplicar: mensajeConfirmarAplicar,
  });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con las columnas MARCA y CONJUNTO. Se lee en tu navegador; solo se envían las dos columnas mapeadas. Puede ser otra hoja del libro de marcas."
        hintHoja="El libro tiene varias hojas; elige la que contiene marca y conjunto."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Las dos columnas son obligatorias. La marca debe existir (no se crean marcas miembro); si el conjunto no existe como marca, se crea como cabeza con la agrupación de la fila. Un conjunto vacío no saca a nadie de su conjunto."
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
                Ver los conjuntos
              </Button>
            </span>
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} />
        </>
      )}
    </div>
  );
}

function Reporte({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacionConjuntos; nombreArchivo: string }) {
  const aplicado = reporte.modo === "aplicar";
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const asignar = reporte.asignar;
  const cambios = reporte.cambios;
  const aCrear = reporte.conjuntos_a_crear;
  const nadaNuevo = asignar === 0 && cambios.length === 0 && aCrear.length === 0;
  const sinOpinion = reporte.sin_opinion;

  const columnasCambios: Columna<CambioConjunto>[] = [
    { clave: "fila", titulo: "Fila", render: (c) => <span className="font-mono text-xs">{c.fila}</span> },
    { clave: "marca", titulo: "Marca", render: (c) => <span className="font-medium">{c.marca}</span> },
    { clave: "de", titulo: "Estaba en", render: (c) => c.de },
    { clave: "a", titulo: "Pasa a", render: (c) => <Badge tono="marca">{c.a}</Badge> },
  ];
  const columnasCrear: Columna<ConjuntoACrear>[] = [
    { clave: "conjunto", titulo: "Cabeza que se creará", render: (c) => <span className="font-medium">{c.conjunto}</span> },
    { clave: "agrupacion", titulo: "Agrupación", render: (c) => c.agrupacion },
    { clave: "de", titulo: "Según la fila de", render: (c) => c.de },
  ];

  return (
    <Card titulo={titulo} descripcion={descripcionTotales(reporte.totales)}>
      <div className="space-y-5">
        {nadaNuevo && <Alert tono="info">Nada nuevo: todas las marcas válidas del archivo ya están en su conjunto.</Alert>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Tarjeta titulo={aplicado ? "Asignadas" : "Se asignarán"} tono="exito" filas={[["Marcas", asignar]]} />
          <Tarjeta titulo="Cambian de conjunto" tono={cambios.length > 0 ? "alerta" : "neutro"} filas={[["Marcas", cambios.length]]} />
          <Tarjeta titulo={aplicado ? "Conjuntos creados" : "Conjuntos a crear"} tono="exito" filas={[["Cabezas", aCrear.length]]} />
          <Tarjeta titulo="Ya estaban" tono="neutro" filas={[["Marcas", reporte.existentes]]} />
          <Tarjeta
            titulo="Omitidas"
            tono={errores.length > 0 ? "alerta" : "neutro"}
            filas={[
              ["Con errores", errores.length],
              ["Repetidas en el archivo", duplicadas.length],
              ["Sin conjunto (no opinan)", sinOpinion],
            ]}
          />
        </div>

        {aCrear.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Conjuntos a crear ({formatearNumero(aCrear.length)})</h3>
            <p className="text-xs text-tinta-suave">El conjunto no existe como marca: se crea como cabeza con la agrupación de la primera fila que lo nombra.</p>
            <DataTable columnas={columnasCrear} filas={aCrear} claveFila={(c) => c.conjunto} />
          </div>
        )}

        {cambios.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Cambian de conjunto ({formatearNumero(cambios.length)})</h3>
            <Alert tono="info">En este importador el archivo manda: estas marcas ya estaban en otro conjunto y pasarán al del archivo.</Alert>
            <DataTable columnas={columnasCambios} filas={cambios} claveFila={(c) => `${c.fila}-${c.marca}`} />
          </div>
        )}

        {errores.length > 0 && (
          <TablaErrores
            errores={errores}
            todas={reporte.omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION_CONJUNTO}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}

        {duplicadas.length > 0 && (
          <TablaDuplicadas
            duplicadas={duplicadas}
            columnasFila={COLUMNAS_FILA}
            descripcion="Misma marca que una fila anterior (la primera aparición manda; si el conjunto difiere, el detalle lo dice). Se procesan una sola vez; no son errores."
          />
        )}
      </div>
    </Card>
  );
}
