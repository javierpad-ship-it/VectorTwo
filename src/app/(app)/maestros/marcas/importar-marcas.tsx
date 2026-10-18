"use client";

import {
  ETIQUETA_CAMPO_DIFERENCIA,
  ETIQUETA_MOTIVO_OMISION_CONJUNTO,
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
    hint: "Si no la mapeas, las marcas nuevas entran sin tratamiento especial. MIXTA la marca con modalidad mixta.",
  },
  {
    campo: "conjunto",
    etiqueta: "Conjunto",
    alias: ["CONJUNTO", "CASA", "LICENCIA"],
    opcional: true,
    hint: "Si no la mapeas, las marcas nuevas entran sin conjunto (los conjuntos se arman en la pestaña Conjuntos).",
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
  { clave: "conjunto", titulo: "Conjunto", valor: (f) => f.conjunto ?? "" },
];

function resumenCrear(r: ReporteImportacionMarcas): string {
  const verbo = r.modo === "aplicar" ? "Creadas" : "Se crearán";
  return `${verbo} ${plural(r.crear.marcas, "marca", "marcas")} (${formatearNumero(r.crear.con_tratamiento_especial)} con tratamiento especial, ${formatearNumero(r.crear.con_conjunto)} con conjunto).`;
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
  const aCrear = reporte.conjuntos.a_crear;
  if (aCrear.length > 0) {
    partes.push(`Se crearán ${plural(aCrear.length, "marca cabeza", "marcas cabeza")} de conjunto: ${aCrear.map((c) => `${c.conjunto} → ${c.agrupacion}`).join(", ")}.`);
  }
  const sinConjunto = reporte.conjuntos.omitidos.length;
  if (sinConjunto > 0) {
    partes.push(`${plural(sinConjunto, "marca nueva entra", "marcas nuevas entran")} sin conjunto (la columna CONJUNTO no se pudo aplicar).`);
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
        descripcion="CSV o Excel (.xlsx, .xls) con la cabecera en la primera fila. Se lee en tu navegador; solo se envían las columnas mapeadas (marca, agrupación y, si existen, tratamiento especial y conjunto)."
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
          descripcion="Detectado por nombre; corrígelo si hace falta. Marca y agrupación son obligatorias. La agrupación se reconoce por código, por nombre o con número delante (1 ULTRA LOW); el tratamiento acepta SI/NO, S/N, X, 1/0 y MIXTA (con tratamiento y modalidad mixta)."
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
              ["Con conjunto", c.con_conjunto],
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

        {reporte.conjuntos.a_crear.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Conjuntos a crear ({formatearNumero(reporte.conjuntos.a_crear.length)})</h3>
            <p className="text-xs text-tinta-suave">Marcas cabeza que no existen todavía: se crean con la agrupación de la primera fila que las nombra.</p>
            <Muestra
              titulo={aplicado ? "Cabezas creadas" : "Cabezas que se crearán"}
              items={reporte.conjuntos.a_crear.map((c) => `${c.conjunto} → ${c.agrupacion} (de ${c.de})`)}
            />
          </div>
        )}

        {reporte.conjuntos.omitidos.length > 0 && <TablaConjuntosOmitidos omitidos={reporte.conjuntos.omitidos} />}

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

/** Filas cuya columna CONJUNTO no se aplicó: la marca nueva entra igual, sin conjunto. */
function TablaConjuntosOmitidos({ omitidos }: { omitidos: ReporteImportacionMarcas["conjuntos"]["omitidos"] }) {
  const columnas: Columna<(typeof omitidos)[number]>[] = [
    { clave: "fila", titulo: "Fila", render: (o) => <span className="font-mono text-xs">{o.fila}</span> },
    { clave: "marca", titulo: "Marca", render: (o) => <span className="font-medium">{o.marca}</span> },
    { clave: "conjunto", titulo: "Conjunto del archivo", render: (o) => o.conjunto },
    { clave: "motivo", titulo: "Motivo", render: (o) => <Badge tono="alerta">{ETIQUETA_MOTIVO_OMISION_CONJUNTO[o.motivo] ?? o.motivo}</Badge> },
    { clave: "detalle", titulo: "Detalle", render: (o) => o.detalle ?? <span className="text-tinta-suave">—</span> },
  ];
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Conjuntos que no se aplicaron ({formatearNumero(omitidos.length)})</h3>
      <Alert tono="info">La marca se crea igual, sin conjunto. Arma el conjunto después en la pestaña Conjuntos o con el importador de conjuntos.</Alert>
      <DataTable columnas={columnas} filas={omitidos} claveFila={(o) => `${o.fila}-${o.motivo}`} />
    </div>
  );
}
