"use client";

import { ETIQUETA_DESTINO } from "@/components/marcas/comunes-m2b";
import type { MarcaConGml, ModalidadDestino } from "@/components/marcas/tipos-m2b";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

/**
 * M12 (I3) · «¿Por GML o Mixta?». Una marca al barrer (o marcada sin modalidad) no pasa a Por GML sin preguntar: al asignarle su
 * primer GML hay que decir si el resto de su venta cuenta como «otras» (Por GML) o va al flujo al barrer con el reparto
 * estadístico (Mixta). La respuesta viaja como `modalidad_destino` y vale para todas las marcas de la lista. `onElegir(null)` =
 * cancelar: no se escribe nada.
 */
export function DestinoModalidadDialogo({ marcas, onElegir }: { marcas: readonly Pick<MarcaConGml, "id" | "nombre">[]; onElegir: (destino: ModalidadDestino | null) => void }) {
  return (
    <Modal
      titulo="¿Por GML o Mixta?"
      descripcion={marcas.length === 1 ? `${marcas[0].nombre} está al barrer y va a recibir su primer GML.` : `${marcas.length} marcas están al barrer y van a recibir su primer GML.`}
      onCerrar={() => onElegir(null)}
      ancho="max-w-xl"
      pie={
        <>
          <Button variante="fantasma" onClick={() => onElegir(null)}>
            Cancelar
          </Button>
          <Button variante="secundario" onClick={() => onElegir("por_gml")}>
            {ETIQUETA_DESTINO.por_gml}
          </Button>
          <Button onClick={() => onElegir("mixta")}>{ETIQUETA_DESTINO.mixta}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-tinta">
        {marcas.length > 1 && (
          <ul className="list-disc pl-5 text-tinta-suave">
            {marcas.map((m) => (
              <li key={m.id}>{m.nombre}</li>
            ))}
          </ul>
        )}
        <p>
          <span className="font-medium">Por GML:</span> la marca se ve solo en los GML donde es relevante; su venta en los demás cuenta como «otras» dentro de cada GML.
        </p>
        <p>
          <span className="font-medium">Mixta:</span> esos GML son sus compras específicas (entran directo al flujo del GML) y el resto de su venta sigue yendo al flujo al barrer, con el reparto
          estadístico de Marcas al barrer por GML.
        </p>
        <p className="text-xs text-tinta-suave">
          Se aplica a {marcas.length === 1 ? "esta marca" : "todas las marcas de la lista"}. Su reparto vigente, si lo tiene, quedará obsoleto (configuración cambiada) y las proyecciones de M7 en trabajo quedarán
          desactualizadas.
        </p>
      </div>
    </Modal>
  );
}
