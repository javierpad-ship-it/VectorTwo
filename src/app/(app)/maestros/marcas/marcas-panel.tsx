"use client";

import { useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import { esAdmin, puedeEditarMaestros, type Rol } from "@/lib/auth/roles";
import type { AgrupacionMarcaFila, MarcaFila } from "@/lib/marcas/tipos-api";
import { formatearNumero } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { CatalogoPlano, type HijosCatalogo } from "@/components/catalogo/catalogo-plano";
import { MarcasTabla } from "./marcas-tabla";
import { ImportarMarcas } from "./importar-marcas";

type Pestana = "agrupaciones" | "marcas" | "importar";

const HIJOS_MARCAS: HijosCatalogo<AgrupacionMarcaFila> = {
  clave: "marcas",
  titulo: "Marcas",
  avisoDesactivar: (n) => `Quedarán ocultas ${n} marca${n === 1 ? "" : "s"} activa${n === 1 ? "" : "s"} hasta que la reactives.`,
  bloqueoEliminar: "Tiene marcas: desactívala en vez de eliminarla.",
};

export function MarcasPanel({ rol }: { rol: Rol }) {
  const [pestana, setPestana] = useState<Pestana>("marcas");
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  // Las dos colecciones se cargan una vez (con inactivos) y se filtran en
  // memoria; alimentan el resumen, los chips y los selects de la pestaña Marcas.
  const agrupaciones = useColeccion<AgrupacionMarcaFila>("/api/agrupaciones-marca?incluir_inactivos=1");
  const marcas = useColeccion<MarcaFila>("/api/marcas?incluir_inactivos=1");
  const admin = esAdmin(rol);
  const puedeEditar = puedeEditarMaestros(rol);

  async function recargarTodo() {
    await Promise.all([agrupaciones.recargar(), marcas.recargar()]);
  }

  const agrupacionesActivas = agrupaciones.datos.filter((a) => a.activo).length;
  const marcasActivas = marcas.datos.filter((m) => m.activo);
  const conTratamiento = marcasActivas.filter((m) => m.tratamiento_especial).length;
  const cargandoResumen = agrupaciones.cargando || marcas.cargando;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agrupaciones y marcas</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Cada marca pertenece a una agrupación de marca y puede llevar tratamiento especial. Las agrupaciones las mantiene el
            administrador; las marcas, planificación.
          </p>
        </div>
        {pestana !== "importar" && <Switch checked={mostrarInactivos} onChange={setMostrarInactivos} label="Mostrar inactivos" />}
      </div>

      <Tabs<Pestana>
        items={[
          { id: "agrupaciones", label: "Agrupaciones" },
          { id: "marcas", label: "Marcas" },
          { id: "importar", label: "Importar" },
        ]}
        activa={pestana}
        onCambiar={setPestana}
      />

      <p className="text-sm text-tinta-suave">
        {formatearNumero(agrupacionesActivas)} agrupaciones · {formatearNumero(marcasActivas.length)} marcas ·{" "}
        {formatearNumero(conTratamiento)} con tratamiento especial
        {cargandoResumen && <span className="ml-2 italic">Actualizando…</span>}
      </p>

      {agrupaciones.error && (
        <Alert onCerrar={() => agrupaciones.setError(null)}>No se pudieron cargar las agrupaciones: {agrupaciones.error}</Alert>
      )}
      {marcas.error && <Alert onCerrar={() => marcas.setError(null)}>No se pudieron cargar las marcas: {marcas.error}</Alert>}

      {pestana === "agrupaciones" && (
        <CatalogoPlano<AgrupacionMarcaFila>
          key="agrupaciones"
          recurso="agrupaciones-marca"
          singular="agrupación"
          plural="agrupaciones"
          genero="f"
          puedeEditar={admin}
          hijos={HIJOS_MARCAS}
          vigentes={(a) => a.marcas_activas}
          notaPie="Desactivar oculta sus marcas sin perderlas (quedan como «Oculta por agrupación inactiva»); eliminar solo es posible sin marcas."
          mostrarInactivos={mostrarInactivos}
          onCambio={recargarTodo}
        />
      )}

      {pestana === "marcas" && (
        <MarcasTabla
          marcas={marcas.datos}
          cargando={marcas.cargando}
          agrupaciones={agrupaciones.datos}
          puedeEditar={puedeEditar}
          mostrarInactivos={mostrarInactivos}
          onCambio={recargarTodo}
        />
      )}

      {pestana === "importar" && (
        <ImportarMarcas
          onAplicado={() => {
            setPestana("marcas");
            void recargarTodo();
          }}
        />
      )}
    </div>
  );
}
