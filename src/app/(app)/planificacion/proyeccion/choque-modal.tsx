"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Modal } from "@/components/ui/modal";
import type { ConflictoFilasManualesApi } from "@/lib/proyeccion/tipos-api";
import {
  nombreFilaChoque,
  textoAvisoListaCambio,
  textoCambioDecidido,
  textoCambioPct,
  textoCasillaPisarDecididas,
  textoListaRecortada,
  tituloSeccionDecididas,
  tituloSeccionPctPropio,
} from "./crecimientos-vista";
import { NUM } from "./comunes";

type FilaPropia = ConflictoFilasManualesApi["pct_propio"]["filas"][number];
type FilaDecidida = ConflictoFilasManualesApi["decididas"]["filas"][number];

const COLUMNAS_PROPIAS: Columna<FilaPropia>[] = [
  { clave: "gm", titulo: "Género · mundo", render: (f) => `${f.genero} · ${f.mundo}` },
  { clave: "fila", titulo: "Línea · agrupación", render: (f) => nombreFilaChoque(f) },
  { clave: "pct", titulo: "% de la fila → % nuevo", className: NUM, render: (f) => textoCambioPct(f.pct_fila, f.pct_nuevo) },
];

const COLUMNAS_DECIDIDAS: Columna<FilaDecidida>[] = [
  { clave: "gm", titulo: "Género · mundo", render: (f) => `${f.genero} · ${f.mundo}` },
  { clave: "fila", titulo: "Línea · agrupación", render: (f) => nombreFilaChoque(f) },
  { clave: "decidido", titulo: "Decidido → propuesta nueva", className: NUM, render: (f) => textoCambioDecidido(f.decidido, f.propuesta_nueva_estimada) },
];

/**
 * El Modal del choque (ficha 07c, §4): el `PUT …/crecimientos` respondió `409 filas_manuales` y no escribió nada. Lista las filas
 * con % propio y las de total decidido que cambiarían, y deja elegir:
 * - **Pisar**: las filas con % propio pasan a seguir la matriz; las decididas solo si se marcó la casilla (desmarcada por defecto).
 * - **Conservar**: no cambia ninguna fila.
 * - **Cancelar**: no se guarda nada.
 * Pisar y Conservar reenvían el `PUT` con la `huella_choque` de esta lista. La pantalla nunca manda `resolucion` sin que Javier pulse.
 * Se monta con `key` = la `huella_choque`: si el servidor responde otra lista, el Modal se reabre con la casilla desmarcada.
 */
export function ChoqueModal({
  conflicto,
  anioSiguiente,
  listaCambio,
  ocupado,
  onPisar,
  onConservar,
  onCancelar,
}: {
  conflicto: ConflictoFilasManualesApi;
  anioSiguiente: number;
  /** El servidor cambió la lista de choques mientras se decidía. */
  listaCambio: boolean;
  ocupado: boolean;
  onPisar: (incluirDecididas: boolean) => void;
  onConservar: () => void;
  onCancelar: () => void;
}) {
  const [incluir, setIncluir] = useState(false);
  const propias = conflicto.pct_propio;
  const decididas = conflicto.decididas;

  return (
    <Modal
      titulo="Este cambio choca con filas fijadas a mano."
      descripcion="No se guardó nada todavía. Elige qué hacer con ellas."
      onCerrar={onCancelar}
      cerrable={!ocupado}
      ancho="max-w-4xl"
      pie={
        <>
          {ocupado && (
            <span role="status" className="mr-auto text-sm text-tinta-suave">
              Guardando y recalculando… (hasta 30 s)
            </span>
          )}
          <Button variante="fantasma" disabled={ocupado} onClick={onCancelar}>
            Cancelar
          </Button>
          <Button variante="secundario" disabled={ocupado} onClick={onConservar} title="Guarda la matriz y no cambia ninguna de estas filas">
            Conservar
          </Button>
          <Button variante="primario" disabled={ocupado} onClick={() => onPisar(decididas.total > 0 && incluir)} title="Las filas con % propio pasan a seguir la matriz">
            Pisar
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {listaCambio && <Alert tono="alerta">{textoAvisoListaCambio}</Alert>}

        {propias.total > 0 && (
          <section className="space-y-2" aria-label="Filas con % propio">
            <h3 className="text-sm font-semibold">{tituloSeccionPctPropio(propias.total)}</h3>
            <p className="text-xs text-tinta-suave">Con «Pisar» siguen la matriz; con «Conservar» mantienen su % (las del Resto o de otras celdas no se tocan).</p>
            <DataTable columnas={COLUMNAS_PROPIAS} filas={propias.filas} claveFila={(f) => f.fila_id} />
            {textoListaRecortada(propias.total, propias.filas.length) && <p className="text-xs text-tinta-suave">{textoListaRecortada(propias.total, propias.filas.length)}</p>}
          </section>
        )}

        {decididas.total > 0 && (
          <section className="space-y-2" aria-label="Filas con el total decidido">
            <h3 className="text-sm font-semibold">{tituloSeccionDecididas(decididas.total, anioSiguiente)}</h3>
            <DataTable columnas={COLUMNAS_DECIDIDAS} filas={decididas.filas} claveFila={(f) => f.fila_id} />
            {textoListaRecortada(decididas.total, decididas.filas.length) && <p className="text-xs text-tinta-suave">{textoListaRecortada(decididas.total, decididas.filas.length)}</p>}
            <label className="flex items-start gap-2 rounded-md border border-borde bg-fondo px-3 py-2 text-sm">
              <Checkbox checked={incluir} disabled={ocupado} onChange={setIncluir} label={textoCasillaPisarDecididas(decididas.total)} className="mt-0.5" />
              <span>{textoCasillaPisarDecididas(decididas.total)}</span>
            </label>
          </section>
        )}
      </div>
    </Modal>
  );
}
