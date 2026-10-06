"use client";

import { useMemo, useState } from "react";
import {
  ETIQUETA_MOTIVO_FALTANTE,
  type AgrupacionEstacionalidadFila,
  type EquivalenciaPlana,
  type EquivalenciasEstacionalidadRespuesta,
  type MotivoFaltante,
} from "@/lib/estacionalidad/tipos-api";
import { formatearNumero, plural } from "@/lib/formato";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { CATALOGOS_VACIOS, FiltrosArbol, descargarFaltantesCsv, useFiltroArbol } from "./comunes";
import { TablaSeleccion } from "./tabla-seleccion";
import { useAsignar } from "./use-asignar";

type FiltroMotivo = "todas" | MotivoFaltante;
type FiltroTipo = "todas" | "reales" | "genericas";

/**
 * Pestaña Faltantes: equivalencias activas y vigentes sin agrupación activa
 * (regla 7), con chips por motivo, real/genérica y género, la misma barra
 * de asignación en bloque y la descarga del CSV en el formato del importador.
 */
export function FaltantesTab({
  lista,
  faltantes,
  cargando,
  agrupaciones,
  puedeEditar,
  onCambio,
  onIrAImportar,
}: {
  lista: EquivalenciasEstacionalidadRespuesta | null;
  faltantes: EquivalenciaPlana[];
  cargando: boolean;
  agrupaciones: AgrupacionEstacionalidadFila[];
  puedeEditar: boolean;
  onCambio: () => Promise<void>;
  onIrAImportar: () => void;
}) {
  const asignacion = useAsignar(onCambio);
  const catalogos = lista ?? CATALOGOS_VACIOS;
  const [motivo, setMotivo] = useState<FiltroMotivo>("todas");
  const [tipo, setTipo] = useState<FiltroTipo>("todas");
  const { filtro, setFiltro, lineasDisponibles, filas } = useFiltroArbol(faltantes, catalogos.lineas);

  // Resumen por género sobre todas las faltantes (no sobre lo filtrado): es el
  // mapa de lo que queda por cerrar, y cada chip fija el filtro de género.
  const porGenero = useMemo(() => {
    const conteo = new Map<string, number>();
    for (const e of faltantes) conteo.set(e.genero_id, (conteo.get(e.genero_id) ?? 0) + 1);
    return [...catalogos.generos]
      .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre))
      .filter((g) => conteo.has(g.id))
      .map((g): ChipItem<string> => ({ id: g.id, label: g.nombre, conteo: conteo.get(g.id) }));
  }, [faltantes, catalogos.generos]);

  const conteos = useMemo(() => {
    let inactiva = 0;
    let genericas = 0;
    for (const e of filas) {
      if (e.motivo_faltante === "agrupacion_inactiva") inactiva++;
      if (e.es_generica) genericas++;
    }
    return { todas: filas.length, sin: filas.length - inactiva, inactiva, genericas, reales: filas.length - genericas };
  }, [filas]);

  const visibles = useMemo(
    () =>
      filas
        .filter((e) => motivo === "todas" || e.motivo_faltante === motivo)
        .filter((e) => tipo === "todas" || (tipo === "genericas" ? e.es_generica : !e.es_generica)),
    [filas, motivo, tipo]
  );

  const chipsMotivo: ChipItem<FiltroMotivo>[] = [
    { id: "todas", label: "Todas", conteo: conteos.todas },
    { id: "sin_agrupacion", label: ETIQUETA_MOTIVO_FALTANTE.sin_agrupacion, conteo: conteos.sin },
    { id: "agrupacion_inactiva", label: ETIQUETA_MOTIVO_FALTANTE.agrupacion_inactiva, conteo: conteos.inactiva },
  ];
  const chipsTipo: ChipItem<FiltroTipo>[] = [
    { id: "todas", label: "Todas", conteo: conteos.todas },
    { id: "reales", label: "Reales", conteo: conteos.reales },
    { id: "genericas", label: "Genéricas", conteo: conteos.genericas },
  ];

  if (lista && faltantes.length === 0) {
    return (
      <div className="space-y-4">
        {asignacion.aviso && (
          <Alert tono="exito" onCerrar={() => asignacion.setAviso(null)}>
            {asignacion.aviso}
          </Alert>
        )}
        <EmptyState titulo="Toda equivalencia activa tiene agrupación." detalle="Listo para M6: cada equivalencia vigente tiene una curva de estacionalidad asignada." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {asignacion.error && <Alert onCerrar={() => asignacion.setError(null)}>{asignacion.error}</Alert>}
      {asignacion.aviso && (
        <Alert tono="exito" onCerrar={() => asignacion.setAviso(null)}>
          {asignacion.aviso}
        </Alert>
      )}

      {porGenero.length > 0 && (
        <Chips<string>
          items={[{ id: "", label: "Todos los géneros", conteo: faltantes.length }, ...porGenero]}
          activo={porGenero.some((g) => g.id === filtro.generoId) ? filtro.generoId : ""}
          onCambiar={(generoId) => setFiltro({ ...filtro, generoId })}
          etiqueta="Faltantes por género"
        />
      )}

      <Card
        titulo={`Faltantes (${formatearNumero(visibles.length)})`}
        descripcion="Una equivalencia sin agrupación no se puede proyectar. Filtra, selecciona y asigna hasta vaciar esta lista."
        acciones={
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variante="secundario"
              tamano="sm"
              disabled={visibles.length === 0}
              title="GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION (vacía): complétalo en Excel y súbelo en Importar."
              onClick={() => descargarFaltantesCsv(visibles, catalogos)}
            >
              Descargar faltantes (CSV)
            </Button>
            {puedeEditar && (
              <Button variante="fantasma" tamano="sm" onClick={onIrAImportar}>
                Importar
              </Button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <FiltrosArbol catalogos={catalogos} lineasDisponibles={lineasDisponibles} filtro={filtro} onCambiar={setFiltro} />
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Chips items={chipsMotivo} activo={motivo} onCambiar={setMotivo} etiqueta="Filtrar por motivo" />
            <Chips items={chipsTipo} activo={tipo} onCambiar={setTipo} etiqueta="Filtrar por tipo de equivalencia" />
          </div>
          <TablaSeleccion
            filas={visibles}
            catalogos={catalogos}
            cargando={cargando}
            vacio="Ninguna faltante coincide con el filtro."
            puedeEditar={puedeEditar}
            agrupaciones={agrupaciones}
            verbo="Asignar a"
            ocupado={asignacion.ocupado}
            onAsignar={asignacion.asignar}
          />
          <p className="text-xs text-tinta-suave">
            El CSV descarga {plural(visibles.length, "fila", "filas")} según los filtros, en el formato exacto del importador (la genérica sale con
            la celda EQUIVALENCIA vacía).
          </p>
        </div>
      </Card>
    </div>
  );
}
