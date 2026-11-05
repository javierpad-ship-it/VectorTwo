"use client";

import { useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/form";
import type { ConjuntosPorTiendaApi, ProyeccionApi, VentaPorTiendaApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, BotonEnlace, Cargando, NUM } from "./comunes";
import { descargarLibro } from "./descarga-libro";
import {
  cabeceraPorTienda,
  claseFilaPorTienda,
  hojasPorTienda,
  mesCorto,
  motivosPresentes,
  tablaPorTienda,
  textoAlertaDatosCambiados,
  textoBaseAlRecalcular,
  textoElegirConjunto,
  textoFaltan,
  textoLeyendaMotivos,
  textoLeyendaPorTienda,
  tituloPorTienda,
  type CeldaPeriodo,
  type CeldaVariacion,
  type CeldaVigente,
  type ColumnaPorTienda,
  type FilaPorTienda,
  type OpcionPorTienda,
} from "./venta-por-tienda-vista";
import { rutaProyeccion, useLectura } from "./use-proyeccion";
import { formatearMomento, nombreArchivoProyeccion } from "./vista";

/**
 * «Ver por tienda» (ficha 07f): la venta por tienda y año de un género × mundo (o del Resto) debajo de la tabla de Crecimientos. SOLO LECTURA: lee
 * `GET …/crecimientos/por-tienda?gm=` (`requirePlanner`) y no escribe nada. Muestra qué tiendas y qué años hay detrás de la «Base 2026 (u)»
 * de esa fila: las tiendas de la base marcadas aparte de las que quedan fuera, y un subtotal de la base que cuadra exacto con Σ B. La elección vive en la URL
 * (`?por_tienda=`), la lleva `proyeccion-panel.tsx`.
 */

/** La lectura de un conjunto: `clave` es `<genero_id>.<mundo_id>` o `resto`. Se vuelve a leer al cambiar de conjunto o de proyección. */
export function useVentaPorTienda(proyeccionId: string, clave: string) {
  return useLectura<VentaPorTiendaApi>(`${rutaProyeccion(proyeccionId)}/crecimientos/por-tienda?gm=${encodeURIComponent(clave)}`);
}

/**
 * Corrección 2026-11-05: la lista de conjuntos que se pueden ver por tienda (`GET …/crecimientos/por-tienda` sin `gm`). No depende de las filas ni del cálculo de la proyección:
 * con método anterior o sin calcular también responde, así el selector siempre tiene sus opciones.
 */
export function useConjuntosPorTienda(proyeccionId: string) {
  return useLectura<ConjuntosPorTiendaApi>(`${rutaProyeccion(proyeccionId)}/crecimientos/por-tienda`);
}

/**
 * La sección «Venta por tienda» SIN conjunto elegido (proyección de método anterior, sin calcular o sin filas por GM: no hay tabla con botones «Ver por tienda»). Trae el
 * selector de los conjuntos y una línea que dice para qué sirve; al elegir, la URL toma `?por_tienda=` y aparece la tarjeta.
 */
export function SelectorPorTienda({ opciones, anioSiguiente, cargando = false, onClave }: { opciones: readonly OpcionPorTienda[]; anioSiguiente: number; cargando?: boolean; onClave: (clave: string) => void }) {
  return (
    <Card titulo="Venta por tienda" descripcion={textoElegirConjunto(anioSiguiente)}>
      <div className="min-w-0 space-y-3">
        <Field label="Género · mundo" className="w-full sm:max-w-xs">
          <Select
            value=""
            disabled={cargando && opciones.length <= 1}
            onChange={(e) => {
              if (e.target.value) onClave(e.target.value);
            }}
          >
            <option value="">{cargando && opciones.length <= 1 ? "Leyendo los conjuntos…" : "Elige un conjunto…"}</option>
            {opciones.map((o) => (
              <option key={o.clave} value={o.clave}>
                {o.nombre}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Card>
  );
}

export function VentaPorTienda({
  proyeccion,
  clave,
  opciones,
  puedeRecalcular,
  onClave,
  onCerrar,
  onRecalcular,
}: {
  proyeccion: ProyeccionApi;
  clave: string;
  opciones: readonly OpcionPorTienda[];
  /** Proyección en trabajo y sin cálculo en curso: ofrece «Recalcular» donde la API lo pide. */
  puedeRecalcular: boolean;
  onClave: (clave: string) => void;
  onCerrar: () => void;
  onRecalcular: () => void;
}) {
  const lectura = useVentaPorTienda(proyeccion.id, clave);
  const datos = lectura.datos;
  const raiz = useRef<HTMLDivElement>(null);
  const [descargando, setDescargando] = useState(false);
  const [errorExcel, setErrorExcel] = useState<string | null>(null);
  const nombre = opciones.find((o) => o.clave === clave)?.nombre ?? datos?.conjunto.nombre ?? clave;

  // Al abrir (o cambiar de conjunto) la tarjeta se acerca a la vista: queda debajo de la tabla y en el móvil podría quedar fuera de pantalla.
  useEffect(() => {
    raiz.current?.scrollIntoView({ block: "nearest" });
  }, [clave]);

  async function descargar() {
    if (!datos) return;
    setDescargando(true);
    setErrorExcel(null);
    try {
      const hojas = hojasPorTienda({ datos, proyeccion: proyeccion.nombre, fecha: formatearMomento(new Date().toISOString()) });
      await descargarLibro({ POR_TIENDA: hojas.POR_TIENDA, FILTROS: hojas.FILTROS }, nombreArchivoProyeccion(proyeccion.anio_en_curso, "por-tienda"));
    } catch (e) {
      setErrorExcel(e instanceof Error ? e.message : "No se pudo generar el Excel.");
    } finally {
      setDescargando(false);
    }
  }

  return (
    <div ref={raiz} aria-busy={lectura.cargando}>
      <Card
        titulo={tituloPorTienda(nombre)}
        acciones={
          <Button variante="fantasma" tamano="sm" onClick={onCerrar}>
            Cerrar
          </Button>
        }
      >
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <Field label="Género · mundo" className="w-full sm:max-w-xs">
              <Select value={clave} onChange={(e) => onClave(e.target.value)}>
                {opciones.map((o) => (
                  <option key={o.clave} value={o.clave}>
                    {o.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variante="secundario" disabled={!datos || descargando} onClick={() => void descargar()}>
              {descargando ? "Generando…" : "Descargar Excel"}
            </Button>
          </div>

          {errorExcel && <Alert onCerrar={() => setErrorExcel(null)}>No se pudo generar el Excel: {errorExcel}</Alert>}
          {lectura.error &&
            (lectura.codigo === "sin_calcular" ? (
              <Alert tono="alerta" onCerrar={() => lectura.setError(null)}>
                <span className="block">{lectura.error}</span>
                {puedeRecalcular && (
                  <span className="mt-1 block">
                    <BotonEnlace onClick={onRecalcular}>Calcular</BotonEnlace>
                  </span>
                )}
              </Alert>
            ) : (
              <AlertaError error={{ mensaje: lectura.error, codigo: lectura.codigo }} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />
            ))}
          {lectura.cargando && !datos && <Cargando texto="Leyendo la venta por tienda…" />}
          {datos && <ContenidoVentaPorTienda datos={datos} proyeccion={proyeccion} puedeRecalcular={puedeRecalcular} onRecalcular={onRecalcular} />}
        </div>
      </Card>
    </div>
  );
}

/** Lo ya leído: cabecera, leyenda, avisos y tabla. Sin hooks: la renderiza igual el servidor en las pruebas. */
export function ContenidoVentaPorTienda({
  datos,
  proyeccion,
  puedeRecalcular = false,
  onRecalcular,
}: {
  datos: VentaPorTiendaApi;
  proyeccion: Pick<ProyeccionApi, "desactualizada">;
  puedeRecalcular?: boolean;
  onRecalcular?: () => void;
}) {
  const cambiaron = textoAlertaDatosCambiados(proyeccion);
  return (
    <div className="min-w-0 space-y-3">
      <div className="space-y-1">
        <p className="text-sm">
          {cabeceraPorTienda(datos).map((p, i) => (p.negrita ? <strong key={i}>{p.texto}</strong> : <span key={i}>{p.texto}</span>))}
        </p>
        <p className="text-xs text-tinta-suave">{textoLeyendaPorTienda(datos.hasta_periodo)}</p>
      </div>

      {cambiaron && (
        <Alert tono="alerta">
          <span className="block">{cambiaron}</span>
          {puedeRecalcular && onRecalcular && (
            <span className="mt-1 block">
              <BotonEnlace onClick={onRecalcular}>Recalcular</BotonEnlace>
            </span>
          )}
        </Alert>
      )}
      {datos.base.motivo_nulo === "metodo_anterior" && (
        <Alert tono="info">
          <span className="block">{textoBaseAlRecalcular(datos.anio_siguiente, datos.anio_en_curso)}</span>
          {puedeRecalcular && onRecalcular && (
            <span className="mt-1 block">
              <BotonEnlace onClick={onRecalcular}>Recalcular</BotonEnlace>
            </span>
          )}
        </Alert>
      )}
      {datos.avisos.map((a, i) => (
        <Alert key={`${a.codigo}-${i}`} tono={a.codigo === "filas_sin_base" ? "info" : "alerta"}>
          {a.mensaje}
        </Alert>
      ))}

      <TablaVentaPorTienda datos={datos} />
    </div>
  );
}

// ─── La tabla ───

function Periodo({ c }: { c: CeldaPeriodo | undefined }) {
  if (!c) return null;
  return (
    <span className="block" title={c.titulo ?? undefined}>
      <span className={`${NUM} block ${c.gris ? "text-tinta-suave" : ""}`}>{c.u}</span>
      <span className={`${NUM} block text-xs text-tinta-suave`}>{c.s}</span>
      {c.parcial && <span className="block text-right text-xs italic text-tinta-suave">parcial</span>}
    </span>
  );
}

function Variacion({ c }: { c: CeldaVariacion | undefined }) {
  if (!c) return null;
  return (
    <span className="block" title={c.titulo}>
      {c.lineas.map((l, i) => (
        <span key={i} className={`${NUM} block whitespace-nowrap ${l.negativo ? "text-alerta" : l.motivo ? "text-tinta-suave" : ""}`}>
          {l.texto}
        </span>
      ))}
      {c.comparable && (
        <span className={`${NUM} block text-xs text-tinta-suave`} title={c.comparable.titulo}>
          {c.comparable.texto}
        </span>
      )}
    </span>
  );
}

function Vigente({ c }: { c: CeldaVigente | null }) {
  if (!c) return <span className="block text-right text-tinta-suave">—</span>;
  return (
    <span className="block" title={c.titulo ?? undefined}>
      <span className={`${NUM} block`}>{c.principal}</span>
      {c.detalle && <span className={`${NUM} block text-xs text-tinta-suave`}>{c.detalle}</span>}
      {c.marca && <span className="block text-right text-xs font-medium text-marca-oscura">{c.marca}</span>}
    </span>
  );
}

function CeldaTienda({ f }: { f: FilaPorTienda }) {
  if (f.tipo !== "tienda") {
    return (
      <div>
        <span>{f.nombre}</span>
        {f.nota && <p className="text-xs font-normal text-tinta-suave">{f.nota}</p>}
      </div>
    );
  }
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-xs text-tinta-suave">{f.codigo}</span>
        <span className="font-medium">{f.nombre}</span>
        {f.insignia && (
          <span title={f.insignia.titulo}>
            <Badge tono={f.insignia.tono}>{f.insignia.texto}</Badge>
          </span>
        )}
      </div>
      {f.nota && <p className="text-xs text-tinta-suave">{f.nota}</p>}
    </div>
  );
}

function columnaDe(c: ColumnaPorTienda): Columna<FilaPorTienda> {
  const faltan = textoFaltan(c.faltan);
  const encabezado = (
    <span className="block">
      <span className="block">{c.titulo}</span>
      {c.subtitulo && <span className="block text-[0.65rem] font-normal normal-case text-tinta-suave">{c.subtitulo}</span>}
      {faltan && (
        <span className="mt-1 block normal-case" title={`Sin carga publicada: ${c.faltan.join(", ")}`}>
          <Badge tono="alerta">{faltan}</Badge>
        </span>
      )}
    </span>
  );
  switch (c.tipo) {
    case "tienda":
      return { clave: c.clave, titulo: c.titulo, className: "min-w-48", render: (f) => <CeldaTienda f={f} /> };
    case "periodo":
      return { clave: c.clave, titulo: c.titulo, encabezado, className: "min-w-28 text-right", render: (f) => <Periodo c={f.periodos[c.periodo ?? ""]} /> };
    case "variacion":
      return { clave: c.clave, titulo: `Variación ${c.subtitulo ?? ""}`.trim(), encabezado, className: "min-w-28 text-right", render: (f) => <Variacion c={f.variaciones[c.periodo ?? ""]} /> };
    case "vigente":
      return { clave: c.clave, titulo: c.titulo, encabezado, className: "min-w-40 text-right", render: (f) => <Vigente c={f.vigente} /> };
  }
}

/**
 * La tabla de §5: tiendas de la base, «Sin atribuir a tienda», subtotal de la base (su vigente = Σ B), tiendas de fuera con su subtotal y el total del conjunto.
 * Dentro de `DataTable` (desplazamiento horizontal propio: la página no se ensancha).
 */
export function TablaVentaPorTienda({ datos }: { datos: VentaPorTiendaApi }) {
  const t = tablaPorTienda(datos);
  const hayComparable = t.filas.some((f) => Object.values(f.variaciones).some((v) => v.comparable));
  const leyendaMotivos = textoLeyendaMotivos(motivosPresentes(t.filas));
  return (
    <div className="min-w-0 space-y-2">
      <section aria-label={`Venta por tienda y año de ${datos.conjunto.nombre}`}>
        <DataTable columnas={t.columnas.map(columnaDe)} filas={t.filas} claveFila={(f) => f.clave} claseFila={claseFilaPorTienda} vacio="Sin venta por tienda en este conjunto." />
      </section>
      <div className="space-y-1 text-xs text-tinta-suave">
        {t.conVigente && (
          <p>
            «Estimado»: el resto de la base se reparte entre las mismas tiendas en proporción a su real ene–{mesCorto(datos.k)}; el subtotal cuadra exacto con la base de {datos.anio_siguiente}. Las tiendas que entran y las aperturas de {datos.anio_en_curso} usan su
            vigente exacto.
          </p>
        )}
        {leyendaMotivos && <p>{leyendaMotivos}</p>}
        {hayComparable && <p>«Comparable»: la misma variación sin las tiendas que no estuvieron abiertas todo el periodo.</p>}
      </div>
    </div>
  );
}
