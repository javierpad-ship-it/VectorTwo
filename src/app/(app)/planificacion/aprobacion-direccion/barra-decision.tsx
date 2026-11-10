import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import type { OpcionesTableroApi, TableroApi } from "@/lib/direccion/tipos-api";
import { enlaceTablero, textoEstadoDireccion, tonoEstadoDireccion } from "@/components/direccion/formato";
import { etiquetaProyeccion, textoCabecera, textoComparando, textoCompararPorDefecto, textoDatosMasNuevos, type FiltrosVista } from "./vista-tablero";

/** El estado de dirección de la proyección mostrada, en texto (nunca solo un color). */
export function EstadoDireccion({ tablero }: { tablero: Pick<TableroApi, "decidir"> }) {
  const d = tablero.decidir;
  return <Badge tono={tonoEstadoDireccion(d.estado)}>{textoEstadoDireccion(d.estado, d.vigente ?? d.ultima)}</Badge>;
}

type Props = {
  opciones: OpcionesTableroApi | null;
  tablero: TableroApi | null;
  filtros: FiltrosVista;
  esAdmin: boolean;
  /** Se está releyendo el tablero: «Decidir» espera a las cifras nuevas. */
  cargando: boolean;
  exportando: boolean;
  onProyeccion: (id: string) => void;
  onComparar: (valor: string | null) => void;
  onDecidir: () => void;
  onExcel: () => void;
};

/** ¿Se muestra el botón «Decidir»? Solo al admin y nunca en una archivada (§4.10). */
export function muestraDecidir(esAdmin: boolean, tablero: Pick<TableroApi, "proyeccion"> | null): boolean {
  return esAdmin && tablero !== null && tablero.proyeccion.estado !== "archivada";
}

/**
 * Cabecera fija del tablero (ficha 14, §4.2, bloque 1): qué proyección se mira (cuál, su estado, quién la cerró y cuándo, hasta qué mes tiene datos y
 * si es la que usa Compras), el estado de dirección en texto, el selector de proyección, «Comparar con» (por defecto, la última aprobada), «Descargar
 * Excel» y, solo para el admin, «Decidir». En escritorio queda pegada arriba; en el móvil, «Decidir» va además en una barra fija abajo.
 */
export function BarraDecision({ opciones, tablero, filtros, esAdmin, cargando, exportando, onProyeccion, onComparar, onDecidir, onExcel }: Props) {
  const idMostrada = tablero?.proyeccion.id ?? filtros.proyeccion ?? opciones?.por_defecto?.proyeccion_id ?? "";
  const proyecciones = opciones?.proyecciones ?? [];
  // La comparada por defecto es la de la proyección MOSTRADA (`tablero.comparada`), no `opciones.comparar_por_defecto` (relativa a la por defecto).
  const comparando = textoComparando(tablero);
  return (
    <>
      {/* Solo esta franja queda pegada arriba en escritorio (qué se mira, su estado y «Decidir»): los selectores van debajo, sin robar alto a lo que hay que leer. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 rounded-xl border border-borde bg-superficie px-4 py-3 shadow-sm md:sticky md:top-0 md:z-20">
        <div className="min-w-0 space-y-1">
          {tablero ? (
            <>
              <p className="text-sm font-medium leading-relaxed text-tinta">{textoCabecera(tablero.proyeccion)}</p>
              <EstadoDireccion tablero={tablero} />
            </>
          ) : (
            <p className="text-sm text-tinta-suave">{cargando ? "Cargando el tablero…" : "Sin tablero que mostrar."}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variante="secundario" onClick={onExcel} disabled={tablero === null || exportando || cargando} title="Descarga en Excel lo que ves, con tus filtros">
            {exportando ? "Preparando Excel…" : "Descargar Excel"}
          </Button>
          {muestraDecidir(esAdmin, tablero) && (
            <span className="hidden md:inline-flex">
              <Button className="h-11! px-6!" onClick={onDecidir} disabled={cargando || !tablero?.decidir.puede_aprobar} title={tablero?.decidir.puede_aprobar ? "Aprobar, aprobar con observaciones o rechazar la proyección entera" : "Esta proyección no se puede aprobar ahora"}>
                Decidir
              </Button>
            </span>
          )}
        </div>
      </div>
      <div className="space-y-2 rounded-xl border border-borde bg-superficie px-4 py-3 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-tinta-suave">Proyección</span>
            <Select aria-label="Proyección" value={idMostrada} onChange={(e) => e.target.value && onProyeccion(e.target.value)} disabled={proyecciones.length === 0}>
              {idMostrada === "" && <option value="">Elige una proyección</option>}
              {idMostrada !== "" && !proyecciones.some((p) => p.id === idMostrada) && <option value={idMostrada}>{tablero?.proyeccion.nombre ?? "Proyección elegida"}</option>}
              {proyecciones.map((p) => (
                <option key={p.id} value={p.id}>
                  {etiquetaProyeccion(p)}
                </option>
              ))}
            </Select>
          </label>
          <label className="block min-w-0">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-tinta-suave">Comparar con</span>
            <Select aria-label="Comparar con" value={filtros.comparar ?? ""} onChange={(e) => onComparar(e.target.value || null)} disabled={opciones === null}>
              <option value="">{textoCompararPorDefecto(filtros, tablero)}</option>
              {proyecciones
                .filter((p) => p.id !== idMostrada)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {etiquetaProyeccion(p)}
                  </option>
                ))}
              <option value="ninguna">Sin comparar</option>
            </Select>
          </label>
        </div>
        {comparando && <p className="text-xs text-tinta-suave">{comparando}</p>}
      </div>
    </>
  );
}

/** Avisos bajo la cabecera: en trabajo (con enlace a la que usa Compras), archivada y venta publicada más nueva que los datos de la proyección. */
export function AvisosCabecera({ tablero, opciones }: { tablero: TableroApi; opciones: OpcionesTableroApi | null }) {
  const p = tablero.proyeccion;
  const usaCompras = opciones?.proyecciones.find((x) => x.usa_compras && x.id !== p.id);
  const masNuevos = textoDatosMasNuevos(tablero);
  if (p.estado === "cerrada" && !masNuevos) return null;
  return (
    <div className="space-y-2">
      {p.estado === "en_trabajo" && (
        <Alert tono="alerta">
          En trabajo: las cifras pueden cambiar
          {usaCompras ? (
            <>
              ; la que usa Compras es{" "}
              <Link href={enlaceTablero(usaCompras.id)} className="font-medium underline underline-offset-2">
                {usaCompras.nombre}
              </Link>
              .
            </>
          ) : p.usa_compras ? (
            "."
          ) : (
            "; Compras todavía no usa ninguna proyección cerrada."
          )}
        </Alert>
      )}
      {p.estado === "archivada" && <Alert tono="neutro">Archivada: solo lectura. Una proyección archivada se puede mirar, pero no se aprueba.</Alert>}
      {masNuevos && <Alert tono="info">{masNuevos}</Alert>}
    </div>
  );
}

/** «Decidir» siempre a la vista en el móvil: barra fija abajo, con el estado de dirección en texto. Solo para el admin. */
export function BarraDecidirMovil({ tablero, cargando, onDecidir }: { tablero: TableroApi; cargando: boolean; onDecidir: () => void }) {
  const d = tablero.decidir;
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-borde bg-superficie px-4 py-2 shadow-lg md:hidden">
      <p className="min-w-0 flex-1 text-xs leading-snug text-tinta">{textoEstadoDireccion(d.estado, d.vigente ?? d.ultima)}</p>
      <Button className="h-11! shrink-0 px-6!" onClick={onDecidir} disabled={cargando || !d.puede_aprobar}>
        Decidir
      </Button>
    </div>
  );
}
