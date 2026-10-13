"use client";

import { useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import { esAdmin, puedeEditarMaestros, type Rol } from "@/lib/auth/roles";
import type { AgrupacionMarcaFila } from "@/lib/marcas/tipos-api";
import { formatearNumero } from "@/lib/formato";
import { resumenTratamiento } from "@/components/marcas/comunes-m2b";
import type { MarcaConGml } from "@/components/marcas/tipos-m2b";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { CatalogoPlano, type HijosCatalogo } from "@/components/catalogo/catalogo-plano";
import { MarcasTabla } from "./marcas-tabla";
import { ConjuntosTab } from "./conjuntos-tab";
import { GmlTab, type FocoGml } from "./gml-tab";
import { ImportarPanel } from "./importar-panel";
import type { PestanaMarcas } from "./pestanas";

const HIJOS_MARCAS: HijosCatalogo<AgrupacionMarcaFila> = {
  clave: "marcas",
  titulo: "Marcas",
  avisoDesactivar: (n) => `Quedarán ocultas ${n} marca${n === 1 ? "" : "s"} activa${n === 1 ? "" : "s"} hasta que la reactives.`,
  bloqueoEliminar: "Tiene marcas: desactívala en vez de eliminarla.",
};

export function MarcasPanel({
  rol,
  pestanaInicial = "marcas",
  nodoInicial = null,
  marcaInicial = null,
}: {
  rol: Rol;
  pestanaInicial?: PestanaMarcas;
  /** Nodo que abre la vista Por GML (enlace desde el árbol). */
  nodoInicial?: string | null;
  /** Marca que abre la vista Por marca. */
  marcaInicial?: string | null;
}) {
  const [pestana, setPestana] = useState<PestanaMarcas>(pestanaInicial);
  const [mostrarInactivos, setMostrarInactivos] = useState(false);
  const [foco, setFoco] = useState<FocoGml>({ marcaId: marcaInicial, nodoId: nodoInicial });
  const [cabezaFoco, setCabezaFoco] = useState<string | null>(null);
  // Las dos colecciones se cargan una vez (con inactivos) y se filtran en
  // memoria; alimentan el resumen, los chips y los selects de las pestañas.
  const agrupaciones = useColeccion<AgrupacionMarcaFila>("/api/agrupaciones-marca?incluir_inactivos=1");
  const marcas = useColeccion<MarcaConGml>("/api/marcas?incluir_inactivos=1");
  const admin = esAdmin(rol);
  const puedeEditar = puedeEditarMaestros(rol);

  async function recargarTodo() {
    await Promise.all([agrupaciones.recargar(), marcas.recargar()]);
  }

  function irAGml(marcaId: string) {
    setFoco({ marcaId, nodoId: null });
    setPestana("gml");
  }

  function irAConjunto(cabezaId: string) {
    setCabezaFoco(cabezaId);
    setPestana("conjuntos");
  }

  const agrupacionesActivas = agrupaciones.datos.filter((a) => a.activo).length;
  const marcasActivas = marcas.datos.filter((m) => m.activo);
  // Mismos criterios que el resumen de la pestaña de relevantes (miembros fuera; pendientes = sin GML).
  const { marcadas: conTratamiento, porGml, barrido, sinModalidad, pendientes } = resumenTratamiento(marcasActivas);
  const conjuntos = marcas.datos.filter((m) => m.miembros > 0).length;
  const marcasEnConjunto = marcas.datos.filter((m) => m.conjunto_marca_id).length;
  const cargandoResumen = agrupaciones.cargando || marcas.cargando;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Agrupaciones y marcas</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Cada marca pertenece a una agrupación de marca y puede llevar tratamiento especial, por GML o al barrer. Varias marcas pueden formar un
            conjunto que el flujo ve como una sola. Las agrupaciones las mantiene el administrador; las marcas, planificación.
          </p>
        </div>
        {(pestana === "agrupaciones" || pestana === "marcas" || pestana === "gml") && (
          <Switch checked={mostrarInactivos} onChange={setMostrarInactivos} label={pestana === "gml" ? "Mostrar marcas inactivas" : "Mostrar inactivos"} />
        )}
      </div>

      <Tabs<PestanaMarcas>
        items={[
          { id: "agrupaciones", label: "Agrupaciones" },
          { id: "marcas", label: "Marcas" },
          { id: "conjuntos", label: "Conjuntos" },
          { id: "gml", label: "Marcas relevantes por GML" },
          { id: "importar", label: "Importar" },
        ]}
        activa={pestana}
        onCambiar={setPestana}
      />

      <p className="text-sm text-tinta-suave">
        {formatearNumero(agrupacionesActivas)} agrupaciones · {formatearNumero(marcasActivas.length)} marcas · {formatearNumero(conjuntos)}{" "}
        {conjuntos === 1 ? "conjunto" : "conjuntos"} ({formatearNumero(marcasEnConjunto)} marca{marcasEnConjunto === 1 ? "" : "s"}) ·{" "}
        {formatearNumero(conTratamiento)} con tratamiento especial ({formatearNumero(porGml)} por GML · {formatearNumero(barrido)} al barrer
        {sinModalidad > 0 ? ` · ${formatearNumero(sinModalidad)} sin modalidad` : ""} · {formatearNumero(pendientes)} pendiente{pendientes === 1 ? "" : "s"})
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
          onIrAGml={irAGml}
          onIrAConjunto={irAConjunto}
        />
      )}

      {pestana === "conjuntos" && puedeEditar && (
        <ConjuntosTab marcas={marcas.datos} agrupaciones={agrupaciones.datos} cabezaInicial={cabezaFoco} onCambio={recargarTodo} />
      )}

      {pestana === "gml" && puedeEditar && (
        <GmlTab
          marcas={marcas.datos}
          agrupaciones={agrupaciones.datos}
          mostrarInactivos={mostrarInactivos}
          foco={foco}
          onCambio={recargarTodo}
          onIrAConjuntos={irAConjunto}
        />
      )}

      {pestana === "importar" && (
        <ImportarPanel
          onAplicado={(tipo) => {
            setPestana(tipo === "marcas" ? "marcas" : tipo === "conjuntos" ? "conjuntos" : "gml");
            void recargarTodo();
          }}
        />
      )}
    </div>
  );
}
