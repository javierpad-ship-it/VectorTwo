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
import { Muestra, TablaDuplicadas, TablaErrores, Tarjeta, descripcionTotales, separarOmitidas } from "@/components/importador/reporte";
import {
  ETIQUETA_MOTIVO_OMISION_GML,
  type CambioMarcaBloque,
  type DiferenciaImportacionGml,
  type FilaImportacionGml,
  type FilaOmitidaGml,
  type MotivoOmisionGml,
  type ReporteImportacionGml,
} from "@/components/marcas/tipos-m2b";
import { formatearNumero, plural } from "@/lib/formato";

type Campo = keyof FilaImportacionGml;
type Cambio = CambioMarcaBloque;
type Diferencia = DiferenciaImportacionGml;

const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "marca", etiqueta: "Marca", alias: ["MARCA", "MARCAS", "BRAND"] },
  { campo: "genero", etiqueta: "Género", alias: ["GENERO", "SEXO"] },
  { campo: "mundo", etiqueta: "Mundo", alias: ["MUNDO", "GRUPO_PRODUCTO"] },
  { campo: "linea", etiqueta: "Línea", alias: ["LINEA"] },
  { campo: "nota", etiqueta: "Nota", alias: ["NOTA", "OBSERVACION", "COMENTARIO"], opcional: true, hint: "Opcional, hasta 200 caracteres." },
];

/** Todo se arregla en el archivo salvo la repetida. */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmisionGml> = new Set<MotivoOmisionGml>(
  (Object.keys(ETIQUETA_MOTIVO_OMISION_GML) as MotivoOmisionGml[]).filter((m) => m !== "duplicada_en_archivo")
);

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitidaGml>[] = [
  { clave: "marca", titulo: "Marca", valor: (f) => f.marca },
  { clave: "genero", titulo: "Género", valor: (f) => f.genero },
  { clave: "mundo", titulo: "Mundo", valor: (f) => f.mundo },
  { clave: "linea", titulo: "Línea", valor: (f) => f.linea },
  { clave: "nota", titulo: "Nota", valor: (f) => f.nota },
];

const TEXTO_DE: Record<Cambio["de"], string> = { sin_tratamiento: "Sin tratamiento especial", barrido: "Al barrer", sin_modalidad: "Sin modalidad" };

function resumen(r: ReporteImportacionGml): string {
  const verbo = r.modo === "aplicar" ? "Creadas" : "Se crearán";
  const marcadas = r.cambios_marca.length;
  return `${verbo} ${plural(r.crear.asignaciones, "asignación", "asignaciones")}${marcadas > 0 ? ` (${plural(marcadas, "marca se marca", "marcas se marcan")} o pasa${marcadas === 1 ? "" : "n"} a Por GML)` : ""}.`;
}

function mensajeConfirmarAplicar(nombre: string, reporte: ReporteImportacionGml): string {
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const partes = [`¿Aplicar la importación de ${nombre}? ${resumen({ ...reporte, modo: "previsualizar" })}`];
  const cambios = reporte.cambios_marca;
  if (cambios.length > 0) {
    partes.push("Estas marcas quedarán con tratamiento especial en Por GML:");
    for (const c of cambios.slice(0, 15)) partes.push(`· ${c.marca} (${TEXTO_DE[c.de]} → Por GML)`);
    if (cambios.length > 15) partes.push(`· y ${cambios.length - 15} más`);
  }
  if (errores.length > 0) partes.push(`Quedarán fuera ${plural(errores.length, "fila con errores", "filas con errores")}: no se cargarán.`);
  if (duplicadas.length > 0) partes.push(`${plural(duplicadas.length, "fila repetida", "filas repetidas")} en el archivo se cargan una sola vez.`);
  partes.push("No se quita ninguna asignación que el archivo no traiga.");
  return partes.join("\n");
}

/** Hoja de marcas relevantes por GML: carga, no sincronización (no quita lo ausente) y nunca crea árbol ni marcas. */
export function ImportarGml({ onAplicado }: { onAplicado: () => void }) {
  const imp = useImportador<Campo, ReporteImportacionGml>({
    campos: CAMPOS,
    url: "/api/marcas/gml-especial/importar",
    confirmarAplicar: mensajeConfirmarAplicar,
  });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <Alert tono="info">
        Las marcas sin tratamiento especial se marcarán al recibir GML; se listan antes de aplicar. El importador nunca crea marcas ni árbol: lo que no
        exista aparece como omitido.
      </Alert>

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con MARCA, GENERO, MUNDO y LINEA (y NOTA, opcional). Puede ser la segunda hoja del libro de marcas. Se lee en tu navegador; solo se envían las columnas mapeadas."
        hintHoja="El libro tiene varias hojas; elige la que contiene las marcas relevantes por GML."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Marca, género, mundo y línea son obligatorios y se reconocen por nombre o por código."
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
                Ver las marcas relevantes
              </Button>
            </span>
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} />
        </>
      )}
    </div>
  );
}

function Reporte({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacionGml; nombreArchivo: string }) {
  const aplicado = reporte.modo === "aplicar";
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const cambios = reporte.cambios_marca;
  const diferencias = reporte.diferencias;
  const porMarca = reporte.crear.por_marca;
  const sinNuevas = reporte.crear.asignaciones === 0;

  const columnasCambios: Columna<Cambio>[] = [
    { clave: "marca", titulo: "Marca", render: (c) => <span className="font-medium">{c.marca}</span> },
    { clave: "de", titulo: "Hoy", render: (c) => TEXTO_DE[c.de] ?? c.de },
    { clave: "a", titulo: aplicado ? "Quedó" : "Pasará a", render: () => <Badge tono="exito">Por GML</Badge> },
  ];
  const columnasDif: Columna<Diferencia>[] = [
    { clave: "fila", titulo: "Fila", render: (d) => <span className="font-mono text-xs">{d.fila}</span> },
    { clave: "marca", titulo: "Marca", render: (d) => <span className="font-medium">{d.marca}</span> },
    { clave: "ruta", titulo: "GML", render: (d) => d.ruta },
    { clave: "en_base", titulo: "Nota en la base", render: (d) => d.en_base ?? <span className="text-tinta-suave">—</span> },
    { clave: "en_archivo", titulo: "Nota en el archivo", render: (d) => d.en_archivo ?? <span className="text-tinta-suave">—</span> },
  ];

  return (
    <Card titulo={titulo} descripcion={descripcionTotales(reporte.totales)}>
      <div className="space-y-5">
        {sinNuevas && cambios.length === 0 && <Alert tono="info">Nada nuevo: todas las asignaciones válidas del archivo ya existen.</Alert>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta titulo={aplicado ? "Creadas" : "Se crearán"} tono="exito" filas={[["Asignaciones", reporte.crear.asignaciones]]} />
          <Tarjeta titulo="Ya existían" tono="neutro" filas={[["Asignaciones", reporte.existentes.asignaciones]]} />
          <Tarjeta
            titulo={aplicado ? "Se marcaron / pasaron a Por GML" : "Se marcarán / pasarán a Por GML"}
            tono={cambios.length > 0 ? "alerta" : "neutro"}
            filas={[["Marcas", cambios.length]]}
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

        {cambios.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{aplicado ? "Marcas que cambiaron" : "Marcas que cambiarán"} ({formatearNumero(cambios.length)})</h3>
            <Alert tono="info">
              Hacer relevante a una marca la deja con tratamiento especial en Por GML: las marcas sin casilla se marcan y las que estaban al barrer pasan a
              Por GML.
            </Alert>
            <DataTable columnas={columnasCambios} filas={cambios} claveFila={(c) => c.marca_id} />
          </div>
        )}

        {errores.length > 0 && (
          <TablaErrores
            errores={errores}
            todas={reporte.omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION_GML}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}

        {duplicadas.length > 0 && (
          <TablaDuplicadas
            duplicadas={duplicadas}
            columnasFila={COLUMNAS_FILA}
            descripcion="Misma marca y GML que una fila anterior (la primera aparición manda). Se procesan una sola vez; no son errores."
          />
        )}

        {diferencias.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">Diferencias de nota ({formatearNumero(diferencias.length)})</h3>
            <Alert tono="info">La asignación ya existe con otra nota; el importador no la modifica (se edita en Por marca).</Alert>
            <DataTable columnas={columnasDif} filas={diferencias} claveFila={(d) => `${d.fila}-${d.marca}`} />
          </div>
        )}

        {porMarca.length > 0 && (
          <Muestra
            titulo={aplicado ? "Asignaciones creadas por marca" : "Asignaciones que se crearán por marca"}
            items={porMarca.slice(0, 20).map((m) => `${m.marca} · ${m.asignaciones}`)}
          />
        )}
      </div>
    </Card>
  );
}
