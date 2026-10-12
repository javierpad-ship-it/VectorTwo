"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { PasoArchivo } from "@/components/importador/paso-archivo";
import { BotonesImportar, PasoMapeo } from "@/components/importador/paso-mapeo";
import { Tarjeta, descripcionTotales } from "@/components/importador/reporte";
import type { CampoImportador } from "@/components/importador/tipos";
import { useImportador } from "@/components/importador/use-importador";
import { formatearNumero, plural } from "@/lib/formato";
import type { FilaMapeoCsv, ImportarMapeosRespuesta, MotivoOmisionMapeo } from "@/lib/ventas/tipos-mapeo";

type Campo = keyof FilaMapeoCsv;

const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "ORIGEN_GENERO", etiqueta: "Origen · género", alias: ["ORIGEN_GENERO", "GENERO_ORIGEN"] },
  { campo: "ORIGEN_MUNDO", etiqueta: "Origen · mundo", alias: ["ORIGEN_MUNDO", "MUNDO_ORIGEN"] },
  { campo: "ORIGEN_LINEA", etiqueta: "Origen · línea", alias: ["ORIGEN_LINEA", "LINEA_ORIGEN"] },
  { campo: "ORIGEN_EQUIVALENCIA", etiqueta: "Origen · equivalencia", alias: ["ORIGEN_EQUIVALENCIA", "EQUIVALENCIA_ORIGEN"] },
  { campo: "DESTINO_GENERO", etiqueta: "Destino · género", alias: ["DESTINO_GENERO", "GENERO_DESTINO"] },
  { campo: "DESTINO_MUNDO", etiqueta: "Destino · mundo", alias: ["DESTINO_MUNDO", "MUNDO_DESTINO"] },
  { campo: "DESTINO_LINEA", etiqueta: "Destino · línea", alias: ["DESTINO_LINEA", "LINEA_DESTINO"] },
  { campo: "DESTINO_EQUIVALENCIA", etiqueta: "Destino · equivalencia", alias: ["DESTINO_EQUIVALENCIA", "EQUIVALENCIA_DESTINO"] },
  { campo: "NOTA", etiqueta: "Nota", alias: ["NOTA", "NOTAS", "COMENTARIO"], opcional: true, hint: "Si no la mapeas, los mapeos nuevos entran sin nota." },
];

const MAX_FILAS_MAPEOS = 5_000;

const ETIQUETA_OMISION: Record<MotivoOmisionMapeo, string> = {
  origen_sin_clasificar: "Origen sin género, mundo ni línea",
  origen_con_comodin_invalido: "Comodín «*» mal puesto en el origen (solo vale solo, en la equivalencia)",
  origen_existe_en_arbol: "El origen ya existe en el árbol",
  origen_repetido_en_archivo: "Origen repetido en el archivo",
  destino_no_resuelve: "El destino no existe en el árbol",
  destino_inactivo: "El destino está desactivado",
  existente_igual: "Ya existía igual",
  existente_distinto: "Ya existe con otro destino (no se cambia)",
};

/** Omitidas que no son un problema del archivo: el mapeo ya estaba. */
const INFORMATIVAS: ReadonlySet<MotivoOmisionMapeo> = new Set<MotivoOmisionMapeo>(["existente_igual"]);

type Omitida = ImportarMapeosRespuesta["omitidas"][number];

function resumenCrear(r: ImportarMapeosRespuesta, aplicado: boolean): string {
  return aplicado ? `Creados ${plural(r.creados, "mapeo", "mapeos")}.` : `Se crearán ${plural(r.crear, "mapeo", "mapeos")}.`;
}

/**
 * Importador de mapeos desde CSV o Excel (el mismo archivo que baja «Descargar
 * CSV»; la columna ESTADO se ignora): archivo → mapeo de columnas →
 * previsualizar (con las omitidas por motivo) → aplicar. Idempotente: un
 * origen que ya existe nunca se cambia desde aquí; para cambiarlo se usa «Cambiar destino».
 */
export function ImportarMapeos({ onAplicado }: { onAplicado: () => void }) {
  const imp = useImportador<Campo, ImportarMapeosRespuesta>({
    campos: CAMPOS,
    url: "/api/ventas/mapeos/importar",
    maxFilas: MAX_FILAS_MAPEOS,
    confirmarAplicar: (nombre, r) =>
      [
        `¿Aplicar la importación de ${nombre}? ${resumenCrear(r, false)}`,
        r.omitidas.length > 0 ? `${plural(r.omitidas.length, "fila omitida", "filas omitidas")} no se cargarán.` : "",
        "Los meses ya publicados no cambian: para que reflejen los mapeos hay que recargarlos.",
      ]
        .filter(Boolean)
        .join("\n"),
  });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion={`CSV o Excel (.xlsx, .xls) con la cabecera en la primera fila, hasta ${formatearNumero(MAX_FILAS_MAPEOS)} filas: el mismo archivo que baja «Descargar CSV». Se lee en tu navegador; solo se envían las columnas mapeadas.`}
        hintHoja="El libro tiene varias hojas; elige la que contiene los mapeos."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. En la equivalencia del origen y del destino valen vacío, «-» (igual a la línea) y SIN EQUIVALENCIA; «*» en el origen es el comodín. La columna ESTADO se ignora."
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

      {previaVigente && !final && archivo && <Reporte key={previaVigente.firma} titulo="3. Previsualización" reporte={previaVigente.reporte} aplicado={false} />}

      {final && archivo && (
        <>
          <Alert tono="exito">
            Importación aplicada. {resumenCrear(final, true)}
            <span className="ml-3">
              <Button tamano="sm" onClick={onAplicado}>
                Ver los mapeos
              </Button>
            </span>
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} aplicado />
        </>
      )}
    </div>
  );
}

function Reporte({ titulo, reporte, aplicado }: { titulo: string; reporte: ImportarMapeosRespuesta; aplicado: boolean }) {
  const [filtro, setFiltro] = useState<string>("todas");
  const problemas = reporte.omitidas.filter((o) => !INFORMATIVAS.has(o.motivo));
  const informativas = reporte.omitidas.length - problemas.length;
  const procesadas = reporte.recibidas - reporte.omitidas.length;

  const porMotivo = new Map<MotivoOmisionMapeo, number>();
  for (const o of reporte.omitidas) porMotivo.set(o.motivo, (porMotivo.get(o.motivo) ?? 0) + 1);
  const chips: ChipItem<string>[] = [
    { id: "todas", label: "Todas", conteo: reporte.omitidas.length },
    ...(Object.keys(ETIQUETA_OMISION) as MotivoOmisionMapeo[]).filter((m) => porMotivo.has(m)).map((m): ChipItem<string> => ({ id: m, label: ETIQUETA_OMISION[m], conteo: porMotivo.get(m) })),
  ];
  const vigente = filtro !== "todas" && !porMotivo.has(filtro as MotivoOmisionMapeo) ? "todas" : filtro;
  const visibles = vigente === "todas" ? reporte.omitidas : reporte.omitidas.filter((o) => o.motivo === vigente);

  const columnas: Columna<Omitida>[] = [
    { clave: "fila", titulo: "Fila", render: (o) => <span className="font-mono text-xs">{o.fila}</span> },
    { clave: "motivo", titulo: "Motivo", render: (o) => <Badge tono={INFORMATIVAS.has(o.motivo) ? "neutro" : "alerta"}>{ETIQUETA_OMISION[o.motivo] ?? o.motivo}</Badge> },
    { clave: "detalle", titulo: "Detalle", render: (o) => (o.detalle ? <span className="break-words">{o.detalle}</span> : <span className="text-tinta-suave">—</span>) },
  ];

  return (
    <Card titulo={titulo} descripcion={descripcionTotales({ recibidas: reporte.recibidas, procesadas, omitidas: reporte.omitidas.length })}>
      <div className="space-y-5">
        {reporte.crear === 0 && !aplicado && (
          <Alert tono="info">Nada nuevo que crear: todos los mapeos válidos del archivo ya existen (o se omiten por los motivos de abajo).</Alert>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <Tarjeta titulo={aplicado ? "Creados" : "Se crearán"} tono="exito" filas={[["Mapeos", aplicado ? reporte.creados : reporte.crear]]} />
          <Tarjeta titulo="Ya existían igual" tono="neutro" filas={[["Filas", informativas]]} />
          <Tarjeta titulo="Omitidas con problema" tono={problemas.length > 0 ? "alerta" : "neutro"} filas={[["Filas", problemas.length]]} />
        </div>

        {reporte.omitidas.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold">Filas omitidas ({formatearNumero(reporte.omitidas.length)})</h3>
            {problemas.length > 0 && (
              <Alert>
                <strong>{aplicado ? "Estas filas NO se cargaron." : "Estas filas NO se cargarán."}</strong> Corrige el archivo y vuelve a importarlo: lo que ya entró se reconocerá como existente. Un origen que ya tiene otro
                destino no se cambia desde aquí: usa «Cambiar destino» en la tabla.
              </Alert>
            )}
            <Chips items={chips} activo={vigente} onCambiar={setFiltro} etiqueta="Filtrar omitidas por motivo" />
            <DataTable columnas={columnas} filas={visibles} claveFila={(o) => `${o.fila}-${o.motivo}`} vacio="Ninguna fila con ese motivo." />
          </div>
        )}
      </div>
    </Card>
  );
}
