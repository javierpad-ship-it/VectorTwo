"use client";

import { useState } from "react";
import Papa from "papaparse";
import { api } from "@/lib/api-client";
import { aCodigo } from "@/lib/arbol/normalizar";
import {
  ETIQUETA_MOTIVO_OMISION,
  type FilaImportacion,
  type FilaOmitida,
  type FilaSinMundo,
  type ImportarCuerpo,
  type ReporteImportacion,
} from "@/lib/arbol/tipos-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Columna } from "@/components/ui/data-table";
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

type Archivo = {
  nombre: string;
  tamano: number;
  columnas: string[];
  filas: Record<string, string>[];
};

export function ImportarCsv({ onAplicado }: { onAplicado: () => void }) {
  const [archivo, setArchivo] = useState<Archivo | null>(null);
  const [mapeo, setMapeo] = useState<Mapeo>(MAPEO_VACIO);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<"previsualizar" | "aplicar" | null>(null);
  const [previa, setPrevia] = useState<{ firma: string; reporte: ReporteImportacion } | null>(null);
  const [final, setFinal] = useState<ReporteImportacion | null>(null);

  const mapeoCompleto = CAMPOS.every(({ campo }) => mapeo[campo] !== "");
  const firmaActual = archivo ? `${archivo.nombre}|${archivo.tamano}|${archivo.filas.length}|${JSON.stringify(mapeo)}` : "";
  const previaVigente = previa !== null && previa.firma === firmaActual;

  function elegirArchivo(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setError(null);
    setPrevia(null);
    setFinal(null);
    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: (r) => {
        const columnas = (r.meta.fields ?? []).filter((c) => c !== "");
        if (columnas.length === 0 || r.data.length === 0) {
          setError("El archivo no tiene cabecera o está vacío.");
          return;
        }
        if (r.data.length > MAX_FILAS) {
          setError(`El archivo tiene ${formatearNumero(r.data.length)} filas; el máximo por importación es ${formatearNumero(MAX_FILAS)}.`);
          return;
        }
        setArchivo({ nombre: f.name, tamano: f.size, columnas, filas: r.data });
        setMapeo(detectarMapeo(columnas));
      },
      error: (err) => setError(`No se pudo leer el archivo: ${err.message}`),
    });
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

  async function enviar(modo: "previsualizar" | "aplicar") {
    if (!archivo || !mapeoCompleto) return;
    if (modo === "aplicar") {
      if (!previaVigente) return;
      const c = previa.reporte.crear;
      const total = c.lineas + c.nodos + c.equivalencias + c.equivalencias_genericas;
      if (!confirm(`¿Aplicar la importación de ${archivo.nombre}? Se crearán ${formatearNumero(total)} registros nuevos.`)) return;
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
        descripcion="CSV con cabecera. Se lee en tu navegador; solo se envían las cuatro columnas del árbol ya mapeadas."
      >
        <div className="space-y-4">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={elegirArchivo}
            aria-label="Archivo CSV"
            className="block text-sm text-tinta file:mr-3 file:rounded-md file:border file:border-borde file:bg-superficie file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-tinta hover:file:bg-neutro-suave"
          />
          {archivo && (
            <p className="text-sm text-tinta-suave">
              <strong className="text-tinta">{archivo.nombre}</strong> · {formatearNumero(archivo.filas.length)} filas ·{" "}
              {archivo.columnas.length} columnas
            </p>
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
              <Field key={campo} label={etiqueta} hint={mapeo[campo] ? undefined : "Sin asignar"}>
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

      {previaVigente && !final && <Reporte titulo="3. Previsualización" reporte={previa.reporte} />}

      {final && (
        <>
          <Alert tono="exito">
            Importación aplicada. {resumenCrear(final)}
            <span className="ml-3">
              <Button tamano="sm" onClick={onAplicado}>
                Ver el árbol
              </Button>
            </span>
          </Alert>
          <Reporte titulo="4. Resultado" reporte={final} />
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

function Reporte({ titulo, reporte }: { titulo: string; reporte: ReporteImportacion }) {
  const c = reporte.crear;
  const nadaNuevo = c.lineas + c.nodos + c.equivalencias + c.equivalencias_genericas === 0;
  const aplicado = reporte.modo === "aplicar";

  const colSinMundo: Columna<FilaSinMundo>[] = [
    { clave: "fila", titulo: "Fila", render: (f) => <span className="font-mono text-xs">{f.fila}</span> },
    { clave: "genero", titulo: "Género", render: (f) => f.genero },
    { clave: "linea", titulo: "Línea", render: (f) => f.linea },
    { clave: "equivalencia", titulo: "Equivalencia", render: (f) => f.equivalencia },
  ];
  const colOmitidas: Columna<FilaOmitida>[] = [
    { clave: "fila", titulo: "Fila", render: (f) => <span className="font-mono text-xs">{f.fila}</span> },
    {
      clave: "motivo",
      titulo: "Motivo",
      render: (f) => (
        <span>
          <Badge tono="alerta">{ETIQUETA_MOTIVO_OMISION[f.motivo] ?? f.motivo}</Badge>
          {f.detalle && <span className="ml-2 text-xs text-tinta-suave">{f.detalle}</span>}
        </span>
      ),
    },
  ];

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
            tono={reporte.totales.omitidas > 0 ? "alerta" : "neutro"}
            filas={[
              ["Filas", reporte.totales.omitidas],
              ["Sin mundo (a SIN ASIGNAR)", reporte.sin_mundo.length],
            ]}
          />
        </div>

        {reporte.sin_mundo.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">
              Sin mundo: {reporte.sin_mundo.length} fila{reporte.sin_mundo.length === 1 ? "" : "s"}
            </h3>
            <p className="mb-2 text-xs text-tinta-suave">
              Estas líneas {aplicado ? "quedaron" : "irán"} en el mundo SIN ASIGNAR; podrás moverlas después desde el árbol.
            </p>
            <DataTable columnas={colSinMundo} filas={reporte.sin_mundo} claveFila={(f) => String(f.fila)} />
          </div>
        )}

        {reporte.omitidas.length > 0 && (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Filas omitidas</h3>
            <DataTable columnas={colOmitidas} filas={reporte.omitidas} claveFila={(f) => `${f.fila}-${f.motivo}`} />
          </div>
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
