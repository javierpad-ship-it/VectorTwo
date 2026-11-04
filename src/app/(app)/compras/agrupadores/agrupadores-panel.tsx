"use client";

import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Rol } from "@/lib/auth/roles";
import { useOpciones, useViajes } from "@/lib/compras/agrupadores/use-agrupadores";
import { Alert } from "@/components/ui/alert";
import { Tabs, type TabItem } from "@/components/ui/tabs";
import { BarraViajeActiva } from "@/components/compras/agrupadores/barra-viaje-activo";
import type { ContextoAgrupadores } from "@/components/compras/agrupadores/contexto";
import type { MensajeAgrupador } from "@/components/compras/agrupadores/detalle-embarque";
import { PanelEmbarques } from "@/components/compras/agrupadores/panel-embarques";
import { PanelViajes } from "@/components/compras/agrupadores/panel-viajes";
import { PestanaImportar } from "@/components/compras/agrupadores/pestana-importar";
import { PestanaSinAgrupador } from "@/components/compras/agrupadores/pestana-sin-agrupador";
import { useViajeActivo } from "@/components/compras/agrupadores/use-viaje-activo";
import { textoErrorAccion } from "@/components/compras/agrupadores/vista-errores";
import { consultaAgrupadores, ETIQUETA_PESTANA, leerParametrosAgrupadores, PESTANAS, type ParametrosAgrupadores, type Pestana } from "@/components/compras/agrupadores/vista-agrupadores";

/**
 * Pantalla /compras/agrupadores (Viajes y embarques, 08b-1; ficha 08b §4). Cuatro pestañas: **Embarques** (por defecto), **Viajes**, **Sin
 * agrupador** e **Importar**. Los tres roles leen y escriben agrupadores (crear, editar, asignar compras, cambiar fechas, importar); cerrar,
 * reabrir y cancelar son de admin y planner: los botones se ocultan por rol y la API decide. La pestaña, los filtros y lo abierto viven en la
 * URL. Arriba, la barra del viaje activo (preferencia por navegador, nunca un permiso) que filtra Embarques y Sin agrupador.
 */
export function AgrupadoresPanel({ rol, perfilId, viajeActivoInicial }: { rol: Rol; perfilId: string; viajeActivoInicial: string | null }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const parametros = leerParametrosAgrupadores((k) => search.get(k));

  const viajes = useViajes();
  const opciones = useOpciones();
  const activo = useViajeActivo({ inicial: viajeActivoInicial, viajes: viajes.datos?.viajes ?? null, perfilId });
  const [mensaje, setMensaje] = useState<MensajeAgrupador | null>(null);

  const irA = (siguiente: ParametrosAgrupadores, modo: "push" | "replace") => {
    const q = consultaAgrupadores(siguiente);
    const url = q === "" ? pathname : `${pathname}?${q}`;
    if (modo === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };
  const href = (c: Partial<ParametrosAgrupadores>) => {
    const q = consultaAgrupadores({ ...parametros, ...c });
    return q === "" ? pathname : `${pathname}?${q}`;
  };
  const cambiarPestana = (p: Pestana) => {
    setMensaje(null);
    irA({ ...parametros, pestana: p, embarque: null, viaje: null }, "push");
  };

  async function recargarBase() {
    await Promise.all([viajes.recargar(), opciones.recargar()]);
  }
  const contexto: ContextoAgrupadores = {
    rol,
    perfilId,
    parametros,
    cambiar: (c) => irA({ ...parametros, ...c }, "replace"),
    navegar: (c) => irA({ ...parametros, ...c }, "push"),
    href,
    viajes: viajes.datos,
    opciones: opciones.datos,
    viajeActivo: activo.valor,
    viajeActivoListo: activo.listo,
    usarComoViajeActivo: async (id) => {
      const ok = await activo.cambiar(id);
      if (ok) setMensaje({ tono: "info", texto: "Viaje activo cambiado: las listas de Compras y de Viajes y embarques muestran solo este viaje." });
    },
    viajeActivoOcupado: activo.ocupado,
    recargarBase,
    setMensaje,
  };

  const items: TabItem<Pestana>[] = PESTANAS.map((p) => ({ id: p, label: ETIQUETA_PESTANA[p] }));
  const errorBase = viajes.error ?? opciones.error;
  const limpiarErrores = () => {
    viajes.setError(null);
    opciones.setError(null);
  };

  return (
    <div className="space-y-5">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold">Viajes y embarques</h1>
        <p className="mt-1 text-sm text-tinta-suave">
          Los agrupadores de las compras: el viaje (dónde y cuándo se compró), el embarque (qué llega junto y cuándo) y el paquete (una parte del embarque), cada uno con su comprador responsable.
        </p>
      </div>

      {parametros.pestana !== "importar" && (
        <BarraViajeActiva
          valor={activo.valor}
          viajes={opciones.datos?.viajes ?? viajes.datos?.viajes ?? []}
          onCambiar={(id) => void activo.cambiar(id)}
          ocupado={activo.ocupado}
          error={activo.error ? textoErrorAccion(activo.error) : null}
          onCerrarError={activo.limpiarError}
        />
      )}

      <Tabs items={items} activa={parametros.pestana} onCambiar={cambiarPestana} />

      {mensaje && (
        <Alert tono={mensaje.tono} onCerrar={() => setMensaje(null)}>
          {mensaje.texto}
          {mensaje.avisos && mensaje.avisos.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {mensaje.avisos.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      {errorBase && <Alert onCerrar={limpiarErrores}>{errorBase}</Alert>}

      {parametros.pestana === "embarques" && <PanelEmbarques ctx={contexto} />}
      {parametros.pestana === "viajes" && <PanelViajes ctx={contexto} />}
      {parametros.pestana === "sin-agrupador" && (
        <PestanaSinAgrupador
          parametros={parametros}
          viajeActivo={activo.valor}
          viajes={viajes.datos?.viajes ?? []}
          opciones={opciones.datos}
          onCambiar={contexto.cambiar}
          onRecargar={recargarBase}
          onMensaje={setMensaje}
        />
      )}
      {parametros.pestana === "importar" && (
        <PestanaImportar
          onAplicado={() => void recargarBase()}
          onVerEmbarques={() => cambiarPestana("embarques")}
          enlaceCreado={(c) => {
            if (c.tipo === "viaje") return href({ pestana: "viajes", viaje: c.id, embarque: null });
            if (c.tipo === "embarque") return href({ pestana: "embarques", embarque: c.id, viaje: null });
            const p = opciones.datos?.paquetes.find((x) => x.id === c.id);
            return p ? href({ pestana: "embarques", embarque: p.embarque_id, viaje: null }) : null;
          }}
        />
      )}
    </div>
  );
}
