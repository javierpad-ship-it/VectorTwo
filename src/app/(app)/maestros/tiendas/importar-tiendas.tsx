"use client";

import {
  ETIQUETA_CAMPO_DIFERENCIA_TIENDA,
  ETIQUETA_MOTIVO_OMISION_TIENDA,
  type DiferenciaImportacionTienda,
  type FilaImportacionTienda,
  type FilaOmitidaTienda,
  type MotivoOmisionTienda,
  type ReporteImportacionTiendas,
} from "@/lib/tiendas/tipos-api";
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
import { formatearNumero, plural } from "@/lib/formato";

type Campo = keyof FilaImportacionTienda;

const NOTA_OPCIONAL = "Si no la mapeas, entra vacía.";

/** Alias ya en forma `aCodigo` (sin acentos ni caja): "Cod.Tda" → COD_TDA, "Razón Social" → RAZON_SOCIAL. */
const CAMPOS: CampoImportador<Campo>[] = [
  { campo: "codigo", etiqueta: "Código", alias: ["CODIGO", "COD_TDA", "CODIGO_TIENDA", "COD"] },
  { campo: "nombre", etiqueta: "Nombre", alias: ["NOMBRE", "TIENDA", "NOMBRE_TIENDA", "DESCRIPCION", "LOCAL"] },
  { campo: "tipo", etiqueta: "Tipo", alias: ["TIPO", "TIPO_UBICACION", "CLASE"], opcional: true, hint: "Sin mapear, todas entran como Tienda." },
  { campo: "zona", etiqueta: "Zona", alias: ["ZONA", "ZONA_COMERCIAL", "REGION"], opcional: true, hint: NOTA_OPCIONAL },
  { campo: "razon_social", etiqueta: "Razón social", alias: ["RAZON_SOCIAL", "EMPRESA", "SOCIEDAD"], opcional: true, hint: NOTA_OPCIONAL },
  {
    campo: "fecha_apertura",
    etiqueta: "Fecha de apertura",
    alias: ["FECHA_APERTURA", "APERTURA", "FECHA_INICIO", "INICIO"],
    opcional: true,
    hint: "Sin mapear, las tiendas quedan Planificadas.",
  },
  { campo: "fecha_cierre", etiqueta: "Fecha de cierre", alias: ["FECHA_CIERRE", "CIERRE", "FECHA_FIN", "FIN"], opcional: true, hint: NOTA_OPCIONAL },
  {
    campo: "venta_esperada",
    etiqueta: "Venta esperada",
    alias: ["VENTA_ESPERADA", "VENTA_ESPERADA_PROMEDIO", "VENTA_PROM", "VENTA_MENSUAL"],
    opcional: true,
    hint: NOTA_OPCIONAL,
  },
];

/** Todos los motivos salvo la repetida se arreglan en el archivo. */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmisionTienda> = new Set<MotivoOmisionTienda>([
  "codigo_vacio",
  "nombre_vacio",
  "fila_total",
  "tipo_invalido",
  "fecha_apertura_invalida",
  "fecha_cierre_invalida",
  "cierre_sin_apertura",
  "cierre_antes_de_apertura",
  "venta_invalida",
  "venta_en_cd",
  "nombre_repetido",
]);

const COLUMNAS_FILA: ColumnaOmitida<FilaOmitidaTienda>[] = [
  { clave: "codigo", titulo: "Código", valor: (f) => f.codigo },
  { clave: "nombre", titulo: "Nombre", valor: (f) => f.nombre },
  { clave: "tipo", titulo: "Tipo", valor: (f) => f.tipo },
  { clave: "zona", titulo: "Zona", valor: (f) => f.zona },
  { clave: "razon_social", titulo: "Razón social", valor: (f) => f.razon_social },
  { clave: "fecha_apertura", titulo: "Apertura", valor: (f) => f.fecha_apertura },
  { clave: "fecha_cierre", titulo: "Cierre", valor: (f) => f.fecha_cierre },
  { clave: "venta_esperada", titulo: "Venta esperada", valor: (f) => f.venta_esperada },
];

function resumenCrear(r: ReporteImportacionTiendas): string {
  const verbo = r.modo === "aplicar" ? "Creadas" : "Se crearán";
  const c = r.crear;
  const base = `${verbo} ${plural(c.tiendas, "tienda", "tiendas")} y ${plural(c.centros_distribucion, "centro de distribución", "centros de distribución")}`;
  return c.sin_fecha_apertura > 0 ? `${base} (${formatearNumero(c.sin_fecha_apertura)} sin fecha de apertura, quedarán Planificadas).` : `${base}.`;
}

function mensajeConfirmarAplicar(nombre: string, reporte: ReporteImportacionTiendas): string {
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);
  const partes = [`¿Aplicar la importación de ${nombre}? ${resumenCrear({ ...reporte, modo: "previsualizar" })}`];
  if (errores.length > 0) {
    partes.push(`Quedarán fuera ${plural(errores.length, "fila con errores", "filas con errores")}: no se cargarán.`);
  }
  if (duplicadas.length > 0) {
    partes.push(`${plural(duplicadas.length, "fila repetida", "filas repetidas")} en el archivo se cargan una sola vez.`);
  }
  if (reporte.diferencias.length > 0) {
    partes.push(`${plural(reporte.diferencias.length, "diferencia", "diferencias")} con tiendas existentes no se aplican.`);
  }
  return partes.join("\n");
}

export function ImportarTiendas({ onAplicado }: { onAplicado: () => void }) {
  const imp = useImportador<Campo, ReporteImportacionTiendas>({
    campos: CAMPOS,
    url: "/api/tiendas/importar",
    confirmarAplicar: mensajeConfirmarAplicar,
  });
  const { archivo, previa, previaVigente, final } = imp;

  return (
    <div className="space-y-6">
      {imp.error && <Alert onCerrar={() => imp.setError(null)}>{imp.error}</Alert>}

      <PasoArchivo
        archivo={archivo}
        leyendo={imp.leyendo}
        descripcion="CSV o Excel (.xlsx, .xls) con la cabecera en la primera fila, como el archivo de códigos de tiendas. Se lee en tu navegador; solo se envían las columnas mapeadas. Una columna Tda# se ignora."
        hintHoja="El libro tiene varias hojas; elige la que contiene las tiendas."
        onElegir={imp.elegirArchivo}
        onCambiarHoja={imp.cambiarHoja}
      />

      {archivo && (
        <PasoMapeo
          campos={CAMPOS}
          columnas={archivo.columnas}
          mapeo={imp.mapeo}
          onCambiar={imp.setMapeo}
          descripcion="Detectado por nombre; corrígelo si hace falta. Código y nombre son obligatorios; las columnas que no mapees entran vacías: tipo Tienda, sin zona, sin fechas. Fechas con el día primero (15/03/2019); montos como 85000 o S/ 85,000.00; tipo Tienda/CD."
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
                Ver las tiendas
              </Button>
            </span>
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} nombreArchivo={archivo.nombre} />
        </>
      )}
    </div>
  );
}

function Reporte({ titulo, reporte, nombreArchivo }: { titulo: string; reporte: ReporteImportacionTiendas; nombreArchivo: string }) {
  const c = reporte.crear;
  const nadaNuevo = c.tiendas + c.centros_distribucion === 0;
  const aplicado = reporte.modo === "aplicar";
  const { errores, duplicadas } = separarOmitidas(reporte.omitidas);

  return (
    <Card titulo={titulo} descripcion={descripcionTotales(reporte.totales)}>
      <div className="space-y-5">
        {nadaNuevo && <Alert tono="info">Nada nuevo que crear: todas las tiendas válidas del archivo ya existen.</Alert>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tarjeta
            titulo={aplicado ? "Creadas" : "Se crearán"}
            tono={c.sin_fecha_apertura > 0 ? "alerta" : "exito"}
            filas={[
              ["Tiendas", c.tiendas],
              ["Centros de distribución", c.centros_distribucion],
              ["Sin fecha de apertura", c.sin_fecha_apertura],
            ]}
          />
          <Tarjeta titulo="Ya existían" tono="neutro" filas={[["Tiendas", reporte.existentes.tiendas]]} />
          <Tarjeta titulo="Existentes inactivas (no se tocan)" tono="neutro" filas={[["Tiendas", reporte.existentes_inactivos.tiendas]]} />
          <Tarjeta
            titulo="Omitidas"
            tono={errores.length > 0 ? "alerta" : "neutro"}
            filas={[
              ["Con errores", errores.length],
              ["Repetidas en el archivo", duplicadas.length],
            ]}
          />
        </div>

        {c.sin_fecha_apertura > 0 && (
          <Alert>
            <strong>{plural(c.sin_fecha_apertura, "tienda sin fecha de apertura", "tiendas sin fecha de apertura")}</strong>
            {aplicado ? " quedaron" : " quedarán"} Planificadas hasta que la registres en la pestaña Tiendas; la proyección (M7) no sabrá desde cuándo
            venden.
          </Alert>
        )}

        {errores.length > 0 && (
          <TablaErrores
            errores={errores}
            todas={reporte.omitidas}
            aplicado={aplicado}
            nombreArchivo={nombreArchivo}
            columnasFila={COLUMNAS_FILA}
            etiquetas={ETIQUETA_MOTIVO_OMISION_TIENDA}
            motivosCorregibles={MOTIVOS_CORREGIBLES}
          />
        )}

        {duplicadas.length > 0 && (
          <TablaDuplicadas
            duplicadas={duplicadas}
            columnasFila={COLUMNAS_FILA}
            descripcion="Mismo código que una fila anterior (la primera aparición manda, aunque traiga otros datos; el detalle dice en qué difieren). Se procesan una sola vez; no son errores y no hay que corregirlas."
          />
        )}

        {reporte.diferencias.length > 0 && <TablaDiferencias diferencias={reporte.diferencias} />}

        {reporte.muestra.tiendas.length > 0 && (
          <Muestra titulo={aplicado ? "Tiendas creadas con su estado (muestra)" : "Tiendas que se crearán con su estado (muestra)"} items={reporte.muestra.tiendas} />
        )}
      </div>
    </Card>
  );
}

/** Tiendas que ya existen y cuyo archivo trae otro valor en algún campo: informativo. */
function TablaDiferencias({ diferencias }: { diferencias: DiferenciaImportacionTienda[] }) {
  const columnas: Columna<DiferenciaImportacionTienda>[] = [
    { clave: "fila", titulo: "Fila", render: (d) => <span className="font-mono text-xs">{d.fila}</span> },
    { clave: "codigo", titulo: "Código", render: (d) => <code className="font-mono text-xs">{d.codigo}</code> },
    { clave: "campo", titulo: "Campo", render: (d) => <Badge tono="neutro">{ETIQUETA_CAMPO_DIFERENCIA_TIENDA[d.campo] ?? d.campo}</Badge> },
    { clave: "en_base", titulo: "En la base", render: (d) => d.en_base },
    { clave: "en_archivo", titulo: "En el archivo", render: (d) => d.en_archivo },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Diferencias con lo ya cargado ({formatearNumero(diferencias.length)})</h3>
      <Alert tono="info">El importador no modifica tiendas existentes; cámbialas desde la pestaña Tiendas si el archivo tiene la razón.</Alert>
      <DataTable columnas={columnas} filas={diferencias} claveFila={(d) => `${d.fila}-${d.campo}`} />
    </div>
  );
}
