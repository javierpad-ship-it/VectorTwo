"use client";

import { useState } from "react";
import Papa from "papaparse";
import { api } from "@/lib/api-client";
import { aCodigo } from "@/lib/arbol/normalizar";
import {
  ETIQUETA_MOTIVO_OMISION,
  type FilaImportacion,
  type FilaOmitida,
  type ImportarCuerpo,
  type MotivoOmision,
  type ReporteImportacion,
} from "@/lib/arbol/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { leerArchivoTabular, nombreBase, type TablaLeida } from "@/lib/arbol/leer-archivo";
import { formatearNumero, mensajeError } from "./comunes";

const MAX_FILAS = 10_000;

type Campo = keyof FilaImportacion;
type Mapeo = Record<Campo, string>;

const CAMPOS: { campo: Campo; etiqueta: string; alias: string[] }[] = [
  { campo: "genero", etiqueta: "Género", alias: ["GENERO_LK", "GENERO", "GENEROS"] },
  { campo: "mundo", etiqueta: "Mundo", alias: ["MUNDO", "GRUPO_PRODUCTO", "MUNDOS"] },
  { campo: "linea", etiqueta: "Línea", alias: ["LINEA", "LINEA_SAP", "LINEAS"] },
  { campo: "equivalencia", etiqueta: "Equivalencia", alias: ["EQUIVALENCIA", "EQUIVALENCIAS_LK", "EQUIVALENCIAS"] },
];

const MAPEO_VACIO: Mapeo = { genero: "", mundo: "", linea: "", equivalencia: "" };

/** Repetida dentro del archivo: se procesa una sola vez, no es un error del dato. */
const MOTIVO_DUPLICADA: MotivoOmision = "duplicada_en_archivo";

/** Motivos que se arreglan en el archivo (falta el mundo o el género/mundo no existe en el catálogo). */
const MOTIVOS_CORREGIBLES: ReadonlySet<MotivoOmision> = new Set<MotivoOmision>([
  "mundo_vacio",
  "genero_desconocido",
  "mundo_desconocido",
]);

/** Autodetecta la columna de cada campo por nombre (sin acentos ni caja: "género" → GENERO). */
function detectarMapeo(columnas: string[]): Mapeo {
  const mapeo = { ...MAPEO_VACIO };
  const usadas = new Set<string>();
  for (const { campo, alias } of CAMPOS) {
    for (const a of alias) {
      const col = columnas.find((c) => !usadas.has(c) && aCodigo(c) === a);
      if (col) {
        mapeo[campo] = col;
        usadas.add(col);
        break;
      }
    }
  }
  return mapeo;
}

function plural(n: number, singular: string, pluralTxt: string) {
  return `${formatearNumero(n)} ${n === 1 ? singular : pluralTxt}`;
}

/** Separa las omitidas en errores (hay que mirarlas) y repetidas en el archivo (informativas). */
function separarOmitidas(omitidas: FilaOmitida[]) {
  return {
    errores: omitidas.filter((o) => o.motivo !== MOTIVO_DUPLICADA),
    duplicadas: omitidas.filter((o) => o.motivo === MOTIVO_DUPLICADA),
  };
}

function detalleOmitida(o: FilaOmitida): string {
  if (o.detalle) return o.detalle;
  if (o.fila_original !== undefined) return `Repite la fila ${o.fila_original}`;
  return "";
}

/** Genera el CSV de omitidas en el navegador y lo descarga; con BOM para que Excel respete los acentos. */
function descargarOmitidasCsv(omitidas: FilaOmitida[], nombreArchivo: string) {
  const csv = Papa.unparse({
    fields: ["fila", "genero", "mundo", "linea", "equivalencia", "motivo", "detalle"],
    data: omitidas.map((o) => [
      o.fila,
      o.genero,
      o.mundo,
      o.linea,
      o.equivalencia,
      ETIQUETA_MOTIVO_OMISION[o.motivo] ?? o.motivo,
      detalleOmitida(o),
    ]),
  });
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.download = nombreArchivo;
  enlace.click();
  URL.revokeObjectURL(url);
}

type Archivo = {
  nombre: string;
  tamano: number;
  columnas: string[];
  filas: Record<string, string>[];
  /** Hojas del libro Excel (vacío para CSV) y la hoja leída. */
  hojas: string[];
  hoja: string | null;
};

export function ImportarCsv({ onAplicado }: { onAplicado: () => void }) {
  const [archivo, setArchivo] = useState<Archivo | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [leyendo, setLeyendo] = useState(false);
  const [mapeo, setMapeo] = useState<Mapeo>(MAPEO_VACIO);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<"previsualizar" | "aplicar" | null>(null);
  const [previa, setPrevia] = useState<{ firma: string; reporte: ReporteImportacion } | null>(null);
  const [final, setFinal] = useState<ReporteImportacion | null>(null);

  const mapeoCompleto = CAMPOS.every(({ campo }) => mapeo[campo] !== "");
  const firmaActual = archivo
    ? `${archivo.nombre}|${archivo.tamano}|${archivo.hoja ?? ""}|${archivo.filas.length}|${JSON.stringify(mapeo)}`
    : "";
  const previaVigente = previa !== null && previa.firma === firmaActual;

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setOriginal(f);
    void cargar(f);
  }

  /** Lee (o relee, al cambiar de hoja) el archivo elegido. */
  async function cargar(f: File, hoja?: string) {
    setError(null);
    setPrevia(null);
    setFinal(null);
    setLeyendo(true);
    try {
      const tabla: TablaLeida = await leerArchivoTabular(f, hoja);
      if (tabla.columnas.length === 0 || tabla.filas.length === 0) {
        setArchivo(null);
        setError(
          tabla.hojas.length > 1
            ? `La hoja "${tabla.hoja}" no tiene cabecera o está vacía. Prueba con otra hoja.`
            : "El archivo no tiene cabecera o está vacío."
        );
        return;
      }
      if (tabla.filas.length > MAX_FILAS) {
        setArchivo(null);
        setError(`El archivo tiene ${formatearNumero(tabla.filas.length)} filas; el máximo por importación es ${formatearNumero(MAX_FILAS)}.`);
        return;
      }
      setArchivo({ nombre: f.name, tamano: f.size, columnas: tabla.columnas, filas: tabla.filas, hojas: tabla.hojas, hoja: tabla.hoja });
      setMapeo(detectarMapeo(tabla.columnas));
    } catch (err) {
      setArchivo(null);
      setError(`No se pudo leer el archivo: ${mensajeError(err)}`);
    } finally {
      setLeyendo(false);
    }
  }

  function filasMapeadas(): FilaImportacion[] {
    if (!archivo) return [];
    return archivo.filas.map((f) => ({
      genero: String(f[mapeo.genero] ?? ""),
      mundo: String(f[mapeo.mundo] ?? ""),
      linea: String(f[mapeo.linea] ?? ""),
      equivalencia: String(f[mapeo.equivalencia] ?? ""),
    }));
  }

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

  async function enviar(modo: "previsualizar" | "aplicar") {
    if (!archivo || !mapeoCompleto) return;
    if (modo === "aplicar") {
      if (!previaVigente) return;
      if (!confirm(mensajeConfirmarAplicar(archivo.nombre, previa.reporte))) return;
    }
    setEnviando(modo);
    setError(null);
    try {
      const cuerpo: ImportarCuerpo = { modo, filas: filasMapeadas() };
      const reporte = await api.post<ReporteImportacion>("/api/arbol/importar", cuerpo);
      if (modo === "previsualizar") {
        setPrevia({ firma: firmaActual, reporte });
        setFinal(null);
      } else {
        setFinal(reporte);
      }
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setEnviando(null);
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}

      <Card
        titulo="1. Archivo"
        descripcion="CSV o Excel (.xlsx, .xls) con la cabecera en la primera fila. Se lee en tu navegador; solo se envían las cuatro columnas del árbol ya mapeadas."
      >
        <div className="space-y-4">
          <input
            type="file"
            accept=".csv,text/csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={elegirArchivo}
            disabled={leyendo}
            aria-label="Archivo CSV o Excel"
            className="block text-sm text-tinta file:mr-3 file:rounded-md file:border file:border-borde file:bg-superficie file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-tinta hover:file:bg-neutro-suave"
          />
          {leyendo && <p className="text-sm text-tinta-suave">Leyendo el archivo…</p>}
          {archivo && (
            <p className="text-sm text-tinta-suave">
              <strong className="text-tinta">{archivo.nombre}</strong>
              {archivo.hoja && <> · hoja <strong className="text-tinta">{archivo.hoja}</strong></>} ·{" "}
              {formatearNumero(archivo.filas.length)} filas · {archivo.columnas.length} columnas
            </p>
          )}
          {archivo && original && archivo.hojas.length > 1 && (
            <Field label="Hoja del libro" hint="El libro tiene varias hojas; elige la que contiene el árbol." className="max-w-xs">
              <Select value={archivo.hoja ?? ""} onChange={(e) => void cargar(original, e.target.value)} disabled={leyendo}>
                {archivo.hojas.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
      </Card>

      {archivo && (
        <Card
          titulo="2. Mapeo de columnas"
          descripcion="Detectado por nombre; corrígelo si hace falta. Las cuatro columnas son obligatorias."
        >
          <div className="grid gap-4 md:grid-cols-4">
            {CAMPOS.map(({ campo, etiqueta }) => (
              <Field key={campo} label={etiqueta} hint={mapeo[campo] ? undefined : "Elige una columna"}>
                <Select value={mapeo[campo]} onChange={(e) => setMapeo({ ...mapeo, [campo]: e.target.value })}>
                  <option value="">—</option>
                  {archivo.columnas.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={() => enviar("previsualizar")} disabled={!mapeoCompleto || enviando !== null}>
              {enviando === "previsualizar" ? "Previsualizando…" : "Previsualizar"}
            </Button>
            <Button
              variante="secundario"
              onClick={() => enviar("aplicar")}
              disabled={!previaVigente || enviando !== null || final !== null}
              title={previaVigente ? undefined : "Primero previsualiza este archivo con este mapeo."}
            >
              {enviando === "aplicar" ? "Aplicando…" : "Aplicar"}
            </Button>
            {previa && !previaVigente && (
              <span className="text-xs text-tinta-suave">Cambiaste el archivo o el mapeo: vuelve a previsualizar antes de aplicar.</span>
            )}
          </div>
        </Card>
      )}

      {previaVigente && !final && archivo && (
        <Reporte key={previa.firma} titulo="3. Previsualización" reporte={previa.reporte} nombreArchivo={archivo.nombre} />
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
    <Card
      titulo={titulo}
      descripcion={`${formatearNumero(reporte.totales.recibidas)} filas recibidas · ${formatearNumero(reporte.totales.procesadas)} procesadas · ${formatearNumero(reporte.totales.omitidas)} omitidas`}
    >
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
          <TablaErrores errores={errores} todas={reporte.omitidas} aplicado={aplicado} nombreArchivo={nombreArchivo} />
        )}

        {duplicadas.length > 0 && <TablaDuplicadas duplicadas={duplicadas} />}

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

function Celda({ valor }: { valor: string }) {
  return valor ? <>{valor}</> : <span className="text-tinta-suave">—</span>;
}

/** Columnas comunes a ambas tablas de omitidas: la fila completa normalizada. */
const COLUMNAS_FILA: Columna<FilaOmitida>[] = [
  { clave: "fila", titulo: "Fila", render: (f) => <span className="font-mono text-xs">{f.fila}</span> },
  { clave: "genero", titulo: "Género", render: (f) => <Celda valor={f.genero} /> },
  { clave: "mundo", titulo: "Mundo", render: (f) => <Celda valor={f.mundo} /> },
  { clave: "linea", titulo: "Línea", render: (f) => <Celda valor={f.linea} /> },
  { clave: "equivalencia", titulo: "Equivalencia", render: (f) => <Celda valor={f.equivalencia} /> },
];

type FiltroMotivo = MotivoOmision | "todas";

/** Omitidas con error: filtro por motivo, aviso de corrección y descarga de todas las omitidas en CSV. */
function TablaErrores({
  errores,
  todas,
  aplicado,
  nombreArchivo,
}: {
  errores: FilaOmitida[];
  /** Todas las omitidas (errores y repetidas), para la descarga. */
  todas: FilaOmitida[];
  aplicado: boolean;
  nombreArchivo: string;
}) {
  const [filtro, setFiltro] = useState<FiltroMotivo>("todas");

  const porMotivo = new Map<MotivoOmision, number>();
  for (const o of errores) porMotivo.set(o.motivo, (porMotivo.get(o.motivo) ?? 0) + 1);
  const chips: ChipItem<FiltroMotivo>[] = [
    { id: "todas", label: "Todas", conteo: errores.length },
    ...(Object.keys(ETIQUETA_MOTIVO_OMISION) as MotivoOmision[])
      .filter((m) => porMotivo.has(m))
      .map((m): ChipItem<FiltroMotivo> => ({ id: m, label: ETIQUETA_MOTIVO_OMISION[m], conteo: porMotivo.get(m) })),
  ];
  // Si el motivo filtrado dejó de existir (otro reporte), se vuelve a "todas" sin efectos.
  const filtroVigente: FiltroMotivo = filtro !== "todas" && !porMotivo.has(filtro) ? "todas" : filtro;
  const visibles = filtroVigente === "todas" ? errores : errores.filter((o) => o.motivo === filtroVigente);

  const hayCorregibles = errores.some((o) => MOTIVOS_CORREGIBLES.has(o.motivo));

  const columnas: Columna<FilaOmitida>[] = [
    ...COLUMNAS_FILA,
    {
      clave: "motivo",
      titulo: "Motivo",
      render: (f) => <Badge tono="alerta">{ETIQUETA_MOTIVO_OMISION[f.motivo] ?? f.motivo}</Badge>,
    },
    { clave: "detalle", titulo: "Detalle", render: (f) => <Celda valor={detalleOmitida(f)} /> },
  ];

  const nombreCsv = `omitidas-${nombreBase(nombreArchivo)}.csv`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Filas con errores ({formatearNumero(errores.length)})</h3>
        <Button variante="secundario" tamano="sm" onClick={() => descargarOmitidasCsv(todas, nombreCsv)}>
          Descargar omitidas (CSV)
        </Button>
      </div>

      {hayCorregibles && (
        <Alert>
          {aplicado ? (
            <>
              <strong>Estas filas NO se cargaron.</strong> Corrige el archivo y vuelve a importarlo: lo que ya entró se reconocerá
              como existente.
            </>
          ) : (
            <>
              <strong>Estas filas NO se cargarán.</strong> Corrige el archivo y vuelve a previsualizar, o aplica para cargar solo
              las válidas.
            </>
          )}
        </Alert>
      )}

      <Chips items={chips} activo={filtroVigente} onCambiar={setFiltro} etiqueta="Filtrar por motivo" />

      <DataTable
        columnas={columnas}
        filas={visibles}
        claveFila={(f) => `${f.fila}-${f.motivo}`}
        vacio="Ninguna fila con ese motivo."
      />
    </div>
  );
}

/** Repetidas dentro del archivo: informativas, no hay nada que corregir. */
function TablaDuplicadas({ duplicadas }: { duplicadas: FilaOmitida[] }) {
  const columnas: Columna<FilaOmitida>[] = [
    ...COLUMNAS_FILA,
    {
      clave: "fila_original",
      titulo: "Repite la fila",
      render: (f) => (f.fila_original !== undefined ? <span className="font-mono text-xs">{f.fila_original}</span> : <Celda valor="" />),
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">Repetidas en el archivo ({formatearNumero(duplicadas.length)})</h3>
      <p className="text-xs text-tinta-suave">
        Misma combinación género · mundo · línea · equivalencia que una fila anterior. Se procesan una sola vez; no son errores
        y no hay que corregirlas.
      </p>
      <DataTable columnas={columnas} filas={duplicadas} claveFila={(f) => `${f.fila}-${f.motivo}`} />
    </div>
  );
}

function Tarjeta({
  titulo,
  tono,
  filas,
}: {
  titulo: string;
  tono: "exito" | "neutro" | "alerta";
  filas: [string, number][];
}) {
  const borde = { exito: "border-exito/30", neutro: "border-borde", alerta: "border-alerta/30" }[tono];
  return (
    <div className={`rounded-lg border ${borde} bg-fondo p-3`}>
      <div className="mb-2 text-xs font-medium uppercase tracking-wide text-tinta-suave">{titulo}</div>
      <dl className="space-y-1">
        {filas.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-2 text-sm">
            <dt className="text-tinta-suave">{k}</dt>
            <dd className="font-mono font-medium text-tinta">{formatearNumero(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Muestra({ titulo, items }: { titulo: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-tinta-suave">Ninguna.</p>
      ) : (
        <ul className="flex flex-wrap gap-1">
          {items.map((i) => (
            <li key={i} className="rounded-md border border-borde px-2 py-0.5 font-mono text-xs text-tinta">
              {i}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
