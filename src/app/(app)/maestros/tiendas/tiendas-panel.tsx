"use client";

import { useMemo, useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import { puedeEditarMaestros, type Rol } from "@/lib/auth/roles";
import type { EstadoTienda, TiendaFila } from "@/lib/tiendas/tipos-api";
import { formatearNumero, plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { hoyLimaCliente } from "./comunes";
import { TiendasTab, type FiltroEstado } from "./tiendas-tab";
import { CalendarioTab } from "./calendario-tab";
import { ImportarTiendas } from "./importar-tiendas";

type Pestana = "tiendas" | "calendario" | "importar";

/**
 * Pantalla /maestros/tiendas: una sola colección (`?incluir_inactivos=1`)
 * cargada una vez y filtrada en memoria alimenta el resumen y la pestaña
 * Tiendas; el Calendario hace su propia lectura porque depende de `?hoy=`.
 * Admin y planner tienen exactamente las mismas acciones.
 */
export function TiendasPanel({ rol }: { rol: Rol }) {
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
        {pestana !== "importar" && <Switch checked={mostrarInactivos} onChange={setMostrarInactivos} label="Mostrar inactivos" />}
      </div>

      <Tabs<Pestana>
        items={[
          { id: "tiendas", label: "Tiendas" },
          { id: "calendario", label: "Calendario" },
          { id: "importar", label: "Importar", disabled: !puedeEditar },
        ]}
        activa={pestana}
        onCambiar={setPestana}
      />

      <p className="text-sm text-tinta-suave">
        {plural(resumen.tiendas, "tienda", "tiendas")} · {formatearNumero(resumen.cds)} CD · {formatearNumero(resumen.porEstado.Activa)} activas ·{" "}
        {formatearNumero(resumen.porEstado.Planificada)} planificadas · {formatearNumero(resumen.porEstado.Cerrada)} cerradas ·{" "}
        {formatearNumero(resumen.sinFecha.length)} sin fecha de apertura
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
