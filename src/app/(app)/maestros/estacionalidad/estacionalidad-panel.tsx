"use client";

import { useMemo, useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import { puedeEditarMaestros, type Rol } from "@/lib/auth/roles";
import type { AgrupacionEstacionalidadFila, EquivalenciaPlana } from "@/lib/estacionalidad/tipos-api";
import { formatearNumero } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Tabs } from "@/components/ui/tabs";
import { useEstacionalidad } from "./use-estacionalidad";
import { MapaTab } from "./mapa-tab";
import { AgrupacionesTab } from "./agrupaciones-tab";
import { AsignacionTab, type VistaAsignacion } from "./asignacion-tab";
import { FaltantesTab } from "./faltantes-tab";
import { ImportarEstacionalidad } from "./importar-estacionalidad";
import type { PestanaEstacionalidad } from "@/lib/estacionalidad/pestanas";

const EMPTY: EquivalenciaPlana[] = [];

export function EstacionalidadPanel({ rol, pestanaInicial = "mapa" }: { rol: Rol; pestanaInicial?: PestanaEstacionalidad }) {
  const puedeEditar = puedeEditarMaestros(rol);
  const [pestana, setPestana] = useState<PestanaEstacionalidad>(pestanaInicial);
  const [mostrarInactivas, setMostrarInactivas] = useState(false);
  const [vista, setVista] = useState<VistaAsignacion>("arbol");
  const [agrupacionVistaId, setAgrupacionVistaId] = useState("");

  // La lista plana (una sola carga, 1 956 filas con el árbol real) alimenta el
  // resumen, Asignación y Faltantes (= las filas con `faltante`); el catálogo
  // alimenta los `Select` de destino. Toda escritura recarga ambos.
  const lista = useEstacionalidad(mostrarInactivas);
  const agrupaciones = useColeccion<AgrupacionEstacionalidadFila>("/api/agrupaciones-estacionalidad?incluir_inactivos=1");

  async function recargarTodo() {
    await Promise.all([lista.recargar(), agrupaciones.recargar()]);
  }

  const equivalencias = lista.datos?.equivalencias ?? EMPTY;
  const faltantes = useMemo(() => equivalencias.filter((e) => e.faltante), [equivalencias]);

  // Resumen sobre las activas y vigentes, valga o no «Mostrar inactivas»
  // (coincide con `resumen` de la API sin `incluir_inactivos`).
  const resumen = useMemo(() => {
    let total = 0;
    let conAgrupacion = 0;
    let genericas = 0;
    let porInactiva = 0;
    for (const e of equivalencias) {
      if (!e.activo || !e.vigente) continue;
      total++;
      if (e.agrupacion !== null) conAgrupacion++;
      if (e.faltante && e.es_generica) genericas++;
      if (e.motivo_faltante === "agrupacion_inactiva") porInactiva++;
    }
    return { total, conAgrupacion, faltantes: faltantes.length, genericas, porInactiva };
  }, [equivalencias, faltantes]);

  function irAAgrupacion(id: string) {
    setVista("agrupacion");
    setAgrupacionVistaId(id);
    setPestana("asignacion");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agrupaciones de estacionalidad</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Cada equivalencia del árbol pertenece a una agrupación, y cada agrupación tendrá su curva de estacionalidad (M6). Una equivalencia sin
          agrupación no se puede proyectar.
        </p>
      </div>

      <Tabs<PestanaEstacionalidad>
        items={[
          { id: "mapa", label: "Mapa" },
          { id: "agrupaciones", label: "Agrupaciones" },
          { id: "asignacion", label: "Asignación" },
          { id: "faltantes", label: lista.datos ? `Faltantes (${formatearNumero(resumen.faltantes)})` : "Faltantes" },
          { id: "importar", label: "Importar", disabled: !puedeEditar },
        ]}
        activa={pestana}
        onCambiar={setPestana}
      />

      <p className="text-sm text-tinta-suave">
        {lista.datos ? (
          <>
            {formatearNumero(resumen.total)} equivalencias · {formatearNumero(resumen.conAgrupacion)} con agrupación ·{" "}
            <strong className={resumen.faltantes > 0 ? "text-alerta" : "text-exito"}>{formatearNumero(resumen.faltantes)} faltantes</strong> (
            {formatearNumero(resumen.genericas)} genéricas{resumen.porInactiva > 0 && `, ${formatearNumero(resumen.porInactiva)} por agrupación inactiva`})
          </>
        ) : (
          "Cargando equivalencias…"
        )}
        {(lista.cargando || agrupaciones.cargando) && <span className="ml-2 italic">Actualizando…</span>}
      </p>

      {lista.error && <Alert onCerrar={() => lista.setError(null)}>No se pudieron cargar las equivalencias: {lista.error}</Alert>}
      {agrupaciones.error && (
        <Alert onCerrar={() => agrupaciones.setError(null)}>No se pudieron cargar las agrupaciones: {agrupaciones.error}</Alert>
      )}

      {pestana === "mapa" && (
        <MapaTab lista={lista.datos} cargando={lista.cargando} agrupaciones={agrupaciones.datos} onAsignar={irAAgrupacion} onIrAFaltantes={() => setPestana("faltantes")} />
      )}

      {pestana === "agrupaciones" && <AgrupacionesTab puedeEditar={puedeEditar} onCambio={recargarTodo} onVerEquivalencias={irAAgrupacion} />}

      {pestana === "asignacion" && (
        <AsignacionTab
          lista={lista.datos}
          cargando={lista.cargando}
          agrupaciones={agrupaciones.datos}
          puedeEditar={puedeEditar}
          vista={vista}
          onVista={setVista}
          agrupacionId={agrupacionVistaId}
          onAgrupacionId={setAgrupacionVistaId}
          mostrarInactivas={mostrarInactivas}
          onMostrarInactivas={setMostrarInactivas}
          onCambio={recargarTodo}
        />
      )}

      {pestana === "faltantes" && (
        <FaltantesTab
          lista={lista.datos}
          faltantes={faltantes}
          cargando={lista.cargando}
          agrupaciones={agrupaciones.datos}
          puedeEditar={puedeEditar}
          onCambio={recargarTodo}
          onIrAImportar={() => setPestana("importar")}
        />
      )}

      {pestana === "importar" && puedeEditar && (
        <ImportarEstacionalidad
          onAplicado={() => {
            setPestana("faltantes");
            void recargarTodo();
          }}
        />
      )}
    </div>
  );
}
