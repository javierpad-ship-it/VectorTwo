"use client";

import {
  ETIQUETA_CAMPO_DIFERENCIA,
  ETIQUETA_MOTIVO_OMISION_MARCA,
  type DiferenciaImportacionMarca,
  type FilaImportacionMarca,
  type FilaOmitidaMarca,
  type MotivoOmisionMarca,
  type ReporteImportacionMarcas,
} from "@/lib/marcas/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
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

type Campo = keyof FilaImportacionMarca;

const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "marca", etiqueta: "Marca", alias: ["MARCA", "MARCAS", "BRAND"] },
  {
    campo: "agrupacion",
    etiqueta: "Agrupación",
    alias: ["AGRUPACION", "AGRUPACION_MARCA", "GRUPO", "GRUPO_MARCA", "NIVEL"],
  },
  {
    campo: "tratamiento_especial",
    etiqueta: "Tratamiento especial",
    alias: ["TRATAMIENTO_ESPECIAL", "TRATAMIENTO", "ESPECIAL"],
    opcional: true,
    hint: "Si no la mapeas, las marcas nuevas entran sin tratamiento especial.",
  },
];

/** Todos los motivos salvo la repetida se arreglan en el archivo. */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmisionMarca> = new Set<MotivoOmisionMarca>([
  "marca_vacia",
  "fila_total",
  "agrupacion_vacia",
  "agrupacion_desconocida",
  "agrupacion_inactiva",
  "tratamiento_invalido",
]);

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitidaMarca>[] = [
  { clave: "marca", titulo: "Marca", valor: (f) => f.marca },
  { clave: "agrupacion", titulo: "Agrupación", valor: (f) => f.agrupacion },
  { clave: "tratamiento_especial", titulo: "Tratamiento especial", valor: (f) => f.tratamiento_especial },
];

function resumenCrear(r: ReporteImportacionMarcas): string {
  const verbo = r.modo === "aplicar" ? "Creadas" : "Se crearán";
  return `${verbo} ${plural(r.crear.marcas, "marca", "marcas")} (${formatearNumero(r.crear.con_tratamiento_especial)} con tratamiento especial).`;
}

function mensajeConfirmarAplicar(nombre: string, reporte: ReporteImportacionMarcas): string {
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const partes = [`¿Aplicar la importación de ${nombre}? ${resumenCrear({ ...reporte, modo: "previsualizar" })}`];
  if (errores.length > 0) {
    partes.push(`Quedarán fuera ${plural(errores.length, "fila con errores", "filas con errores")}: no se cargarán.`);
  }
  if (duplicadas.length > 0) {
    partes.push(`${plural(duplicadas.length, "fila repetida", "filas repetidas")} en el archivo se cargan una sola vez.`);
  }
  if (reporte.diferencias.length > 0) {
    partes.push(`${plural(reporte.diferencias.length, "marca existente", "marcas existentes")} con diferencias no se modifican.`);
  }
  return partes.join("\n");
}

export function ImportarMarcas({ onAplicado }: { onAplicado: () => void }) {
  const imp = useImportador<Campo, ReporteImportacionMarcas>({
    campos: CAMPOS,
    url: "/api/marcas/importar",
    confirmarAplicar: mensajeConfirmarAplicar,
  });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con la cabecera en la primera fila. Se lee en tu navegador; solo se envían las columnas mapeadas (marca, agrupación y, si existe, tratamiento especial)."
        hintHoja="El libro tiene varias hojas; elige la que contiene las marcas."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Marca y agrupación son obligatorias. La agrupación se reconoce por código, por nombre o con número delante (1 ULTRA LOW); el tratamiento acepta SI/NO, S/N, X, 1/0."
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
                Ver las marcas
              </Button>
            </span>
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} />
        </>
      )}
    </div>
  );
}

function Reporte({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacionMarcas; nombreArchivo: string }) {
  const c = reporte.crear;
  const nadaNuevo = c.marcas === 0;
  const aplicado = reporte.modo === "aplicar";
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);

  return (
    <Card titulo={titulo} descripcion={descripcionTotales(reporte.totales)}>
      <div className="space-y-5">
        {nadaNuevo && <Alert tono="info">Nada nuevo que crear: todas las marcas válidas del archivo ya existen.</Alert>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta
            titulo={aplicado ? "Creadas" : "Se crearán"}
            tono="exito"
            filas={[
              ["Marcas", c.marcas],
              ["Con tratamiento especial", c.con_tratamiento_especial],
            ]}
          />
          <Tarjeta titulo="Ya existían" tono="neutro" filas={[["Marcas", reporte.existentes.marcas]]} />
          <Tarjeta titulo="Existentes inactivas (no se tocan)" tono="neutro" filas={[["Marcas", reporte.existentes_inactivos.marcas]]} />
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
            etiquetas={ETIQUETA_MOTIVO_OMISION_MARCA}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}

        {duplicadas.length > 0 && (
          <TablaDuplicadas
            duplicadas={duplicadas}
            columnasFila={COLUMNAS_FILA}
            descripcion="Misma marca que una fila anterior (la primera aparición manda, aunque traiga otra agrupación). Se procesan una sola vez; no son errores y no hay que corregirlas."
          />
        )}

        {reporte.diferencias.length > 0 && <TablaDiferencias diferencias={reporte.diferencias} />}

        {reporte.muestra.marcas.length > 0 && (
          <Muestra titulo={aplicado ? "Marcas creadas (muestra)" : "Marcas que se crearán (muestra)"} items={reporte.muestra.marcas} />
        )}
      </div>
    </Card>
  );
}

/** Marcas que ya existen y cuyo archivo trae otra agrupación o tratamiento: informativo. */
function TablaDiferencias({ diferencias }: { diferencias: DiferenciaImportacionMarca[] }) {
  const columnas: Columna<DiferenciaImportacionMarca>[] = [
    { clave: "fila", titulo: "Fila", render: (d) => <span className="font-mono text-xs">{d.fila}</span> },
    { clave: "marca", titulo: "Marca", render: (d) => <span className="font-medium">{d.marca}</span> },
    { clave: "campo", titulo: "Campo", render: (d) => <Badge tono="neutro">{ETIQUETA_CAMPO_DIFERENCIA[d.campo] ?? d.campo}</Badge> },
    { clave: "en_base", titulo: "En la base", render: (d) => d.en_base },
    { clave: "en_archivo", titulo: "En el archivo", render: (d) => d.en_archivo },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Diferencias con lo ya cargado ({formatearNumero(diferencias.length)})</h3>
      <Alert tono="info">
        El importador no modifica marcas existentes; cámbialas desde la pestaña Marcas si el archivo tiene la razón.
      </Alert>
      <DataTable columnas={columnas} filas={diferencias} claveFila={(d) => `${d.fila}-${d.campo}`} />
    </div>
  );
}
