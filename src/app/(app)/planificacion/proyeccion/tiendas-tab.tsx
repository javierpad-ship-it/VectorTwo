"use client";

import { useEffect, useMemo, useState } from "react";
import { useColeccion } from "@/lib/use-coleccion";
import type { TiendaFila } from "@/lib/tiendas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProyeccionApi, RespuestaTiendasApi } from "@/lib/proyeccion/tipos-api";
import { AtajoTienda } from "./atajo-tienda";
import { AlertaError, Cargando } from "./comunes";
import { TarjetaTienda } from "./tarjeta-tienda";
import { rutaProyeccion, useLectura } from "./use-proyeccion";
import { ordenarTiendas } from "./vista";

/**
 * Pestaña Tiendas nuevas y cierres (ficha 07, paso 2). Va ANTES de «Por línea» en el orden de trabajo: la base del año
 * siguiente de cada línea incluye las tiendas nuevas del año en curso que pasan a mismas tiendas, así que decidirlas
 * primero evita volver sobre las líneas. Dos secciones por año, una tarjeta por tienda.
 */
export function TiendasTab({
  proyeccion,
  tiendaId,
  bloqueada,
  onCambio,
  onRecalcular,
}: {
  proyeccion: ProyeccionApi;
  tiendaId: string | null;
  bloqueada: boolean;
  onCambio: () => Promise<void>;
  onRecalcular: () => void;
}) {
  const y = proyeccion.anio_en_curso;
  const lectura = useLectura<RespuestaTiendasApi>(`${rutaProyeccion(proyeccion.id)}/tiendas`);
  const m4 = useColeccion<TiendaFila>("/api/tiendas");
  const [alternadas, setAlternadas] = useState<Record<string, boolean>>({});
  const [atajo, setAtajo] = useState<string | null>(null);
  const datos = lectura.datos;

  const tiendas = useMemo(() => ordenarTiendas(datos?.tiendas ?? []), [datos]);
  const total = tiendas.length;
  const abiertaPorDefecto = (id: string) => (tiendaId ? id === tiendaId : total <= 4);

  // Al llegar desde la matriz con `&tienda=`, la tarjeta se desplaza a la vista.
  useEffect(() => {
    if (!tiendaId || !datos) return;
    document.getElementById(`tienda-${tiendaId}-${y}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [tiendaId, datos, y]);

  async function cambio() {
    await Promise.all([lectura.recargar(), onCambio()]);
  }

  const sinDecidir = tiendas.filter((t) => t.bloque === "nuevas" && t.decidido === null);
  const atajoTienda = atajo ? m4.datos.find((t) => t.id === atajo) : undefined;

  /** Una tarjeta; abierta por defecto si hay pocas o si es la que se pidió con `&tienda=`. */
  const tarjeta = (t: RespuestaTiendasApi["tiendas"][number]) => {
    const clave = `${t.tienda_id}-${t.anio}`;
    const abierta = alternadas[clave] ?? abiertaPorDefecto(t.tienda_id);
    return (
      <TarjetaTienda
        key={clave}
        t={t}
        proyeccion={proyeccion}
        perfiles={datos?.perfiles_apertura ?? []}
        bloqueada={bloqueada}
        abierta={abierta}
        onAlternar={() => setAlternadas((prev) => ({ ...prev, [clave]: !abierta }))}
        onAtajo={() => setAtajo(t.tienda_id)}
        onCambio={cambio}
        onRecalcular={onRecalcular}
      />
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta-suave">
        Una tarjeta por tienda nueva y año: cómo se calculó su cifra, las referencias al lado y tu decisión del total de la tienda. Las fechas, la venta mensual promedio esperada (S/, sin IGV) y la tienda de referencia
        son de Tiendas (M4): se corrigen con «Cambiar en Tiendas» y se recalcula la proyección.
      </p>
      {lectura.error && <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />}
      {m4.error && <Alert onCerrar={() => m4.setError(null)}>No se pudieron leer las tiendas de M4 para el atajo: {m4.error}</Alert>}
      {lectura.cargando && !datos && <Cargando />}

      {datos && sinDecidir.length > 0 && !bloqueada && (
        <Alert tono="info">
          {sinDecidir.length === 1 ? "Queda 1 tienda nueva sin decidir." : `Quedan ${sinDecidir.length} tiendas nuevas sin decidir.`} Para cerrar la proyección hay que decidir las que tienen venta esperada.
        </Alert>
      )}

      {datos && tiendas.length === 0 && (
        <EmptyState
          titulo="No hay tiendas nuevas ni cierres en esta proyección"
          detalle={`Ninguna tienda abre o cierra entre ${y} y ${y + 1} según las fechas de Tiendas. Si esperabas alguna, revisa sus fechas en Tiendas y recalcula.`}
        />
      )}

      {datos &&
        [y, y + 1].map((anio) => {
          const delAnio = tiendas.filter((t) => t.anio === anio);
          if (delAnio.length === 0) return null;
          const nuevas = delAnio.filter((t) => t.bloque === "nuevas");
          const cierres = delAnio.filter((t) => t.bloque === "cierres");
          return (
            <section key={anio} className="space-y-3">
              <h2 className="text-lg font-semibold">{anio}</h2>
              {nuevas.length > 0 && <h3 className="text-sm font-medium text-tinta-suave">Tiendas nuevas</h3>}
              {nuevas.map(tarjeta)}
              {cierres.length > 0 && <h3 className="text-sm font-medium text-tinta-suave">Cierres</h3>}
              {cierres.map(tarjeta)}
            </section>
          );
        })}

      {atajoTienda && <AtajoTienda tienda={atajoTienda} tiendas={m4.datos} onCerrar={() => setAtajo(null)} onGuardado={cambio} />}
    </div>
  );

}
