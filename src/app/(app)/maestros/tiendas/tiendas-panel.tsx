"use client";

import { useMemo, useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import { puedeEditarMaestros, type Rol } from "@/lib/auth/roles";
import type { EstadoTienda, TiendaFila, UbicacionIgnoradaApi } from "@/lib/tiendas/tipos-api";
import { formatearNumero, plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { hoyLimaCliente } from "./comunes";
import { TiendasTab, type FiltroEstado } from "./tiendas-tab";
import { CalendarioTab } from "./calendario-tab";
import { ImportarTiendas } from "./importar-tiendas";
import { UbicacionesTab } from "./ubicaciones-tab";

type Pestana = "tiendas" | "calendario" | "importar" | "ignoradas";

type Ubicaciones = ReturnType<typeof useColeccion<UbicacionIgnoradaApi>>;

/**
 * Pantalla /maestros/tiendas: una sola colección (`?incluir_inactivos=1`)
 * cargada una vez y filtrada en memoria alimenta el resumen y la pestaña
 * Tiendas; el Calendario hace su propia lectura porque depende de `?hoy=`.
 * Admin y planner tienen exactamente las mismas acciones.
 */
export function TiendasPanel({ rol }: { rol: Rol }) {
  // Las ubicaciones ignoradas las lee solo quien puede editar: la API exige planner y un comprador recibiría un 403.
  return puedeEditarMaestros(rol) ? <PanelConUbicaciones rol={rol} /> : <PanelTiendas rol={rol} ubicaciones={null} />;
}

function PanelConUbicaciones({ rol }: { rol: Rol }) {
  const ubicaciones = useColeccion<UbicacionIgnoradaApi>("/api/tiendas/ubicaciones-ignoradas");
  return <PanelTiendas rol={rol} ubicaciones={ubicaciones} />;
}

function PanelTiendas({ rol, ubicaciones }: { rol: Rol; ubicaciones: Ubicaciones | null }) {
  const [pestana, setPestana] = useState<Pestana>("tiendas");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [filtroEstado, setFiltroEstado] = useState<FiltroEstado>("todos");
  // Hoy en Lima, fijado al montar: sirve para el badge previsto del formulario y de la edición.
  const [hoy] = useState(hoyLimaCliente);
  const tiendas = useColeccion<TiendaFila>("/api/tiendas?incluir_inactivos=1");
  const puedeEditar = puedeEditarMaestros(rol);

  const resumen = useMemo(() => {
    const porEstado: Record<EstadoTienda, number> = { Activa: 0, Planificada: 0, Cerrada: 0 };
    let tiendasN = 0;
    let cds = 0;
    const sinFecha: TiendaFila[] = [];
    for (const t of tiendas.datos) {
      if (!t.activo) continue;
      if (t.tipo === "Centro de Distribución") cds++;
      else {
        tiendasN++;
        if (!t.fecha_apertura) sinFecha.push(t);
      }
      porEstado[t.estado]++;
    }
    sinFecha.sort((a, b) => a.codigo.localeCompare(b.codigo));
    return { tiendas: tiendasN, cds, porEstado, sinFecha };
  }, [tiendas.datos]);

  /**
   * Al entrar en Ubicaciones ignoradas se vuelve a leer la lista: crear o eliminar una tienda desde
   * otra pestaña cambia qué filas están «sin efecto», y la lista solo se cargaba al montar.
   */
  function cambiarPestana(siguiente: Pestana) {
    if (siguiente === "ignoradas" && pestana !== "ignoradas" && ubicaciones) void ubicaciones.recargar();
    setPestana(siguiente);
  }

  function irAPlanificadas() {
    setFiltroEstado("Planificada");
    setPestana("tiendas");
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tiendas y aperturas</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            La red de tiendas y centros de distribución con sus fechas de apertura y cierre. El estado (Planificada · Activa ·
            Cerrada) se calcula con las fechas y el día de hoy; no se guarda.
          </p>
        </div>
        {pestana !== "importar" && pestana !== "ignoradas" && <Switch checked={mostrarInactivos} onChange={setMostrarInactivos} label="Mostrar inactivos" />}
      </div>

      <Tabs<Pestana>
        items={[
          { id: "tiendas", label: "Tiendas" },
          { id: "calendario", label: "Calendario" },
          { id: "importar", label: "Importar", disabled: !puedeEditar },
          { id: "ignoradas", label: "Ubicaciones ignoradas", disabled: !puedeEditar },
        ]}
        activa={pestana}
        onCambiar={cambiarPestana}
      />

      <p className="text-sm text-tinta-suave">
        {plural(resumen.tiendas, "tienda", "tiendas")} · {formatearNumero(resumen.cds)} CD · {formatearNumero(resumen.porEstado.Activa)} activas ·{" "}
        {formatearNumero(resumen.porEstado.Planificada)} planificadas · {formatearNumero(resumen.porEstado.Cerrada)} cerradas ·{" "}
        {formatearNumero(resumen.sinFecha.length)} sin fecha de apertura
        {ubicaciones && !ubicaciones.error && !ubicaciones.cargando && <> · {plural(ubicaciones.datos.length, "ubicación ignorada", "ubicaciones ignoradas")}</>}
        {tiendas.cargando && <span className="ml-2 italic">Actualizando…</span>}
      </p>

      {tiendas.error && <Alert onCerrar={() => tiendas.setError(null)}>No se pudieron cargar las tiendas: {tiendas.error}</Alert>}

      {pestana === "tiendas" && (
        <TiendasTab
          tiendas={tiendas.datos}
          cargando={tiendas.cargando}
          puedeEditar={puedeEditar}
          mostrarInactivos={mostrarInactivos}
          hoy={hoy}
          filtroEstado={filtroEstado}
          onFiltroEstado={setFiltroEstado}
          onCambio={tiendas.recargar}
        />
      )}

      {pestana === "calendario" && (
        <CalendarioTab mostrarInactivos={mostrarInactivos} hoyInicial={hoy} sinFechaApertura={resumen.sinFecha} onIrAPlanificadas={irAPlanificadas} />
      )}

      {pestana === "ignoradas" && ubicaciones && (
        <>
          {ubicaciones.error && <Alert onCerrar={() => ubicaciones.setError(null)}>No se pudieron cargar las ubicaciones ignoradas: {ubicaciones.error}</Alert>}
          <UbicacionesTab
            ubicaciones={ubicaciones.datos}
            cargando={ubicaciones.cargando}
            onCambio={ubicaciones.recargar}
            onIrATiendas={() => setPestana("tiendas")}
          />
        </>
      )}

      {pestana === "importar" && (
        <ImportarTiendas
          onAplicado={() => {
            setPestana("tiendas");
            void tiendas.recargar();
          }}
        />
      )}
    </div>
  );
}
