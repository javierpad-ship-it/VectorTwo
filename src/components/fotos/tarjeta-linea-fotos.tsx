"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ETIQUETA_ESTADO_COMPRA } from "@/lib/compras/tipos-api";
import type { LineaConFotosApi } from "@/lib/fotos/tipos-api";
import { FichaLinea } from "./ficha-linea";
import { FotosLinea } from "./fotos-linea";
import { ETIQUETA_TALLAS, textoCostoLinea, titularLinea } from "./vista-fotos";

/**
 * Una línea de compra en Compras → Fotos (08c, §4.3): compra y proveedor, el género · mundo · línea (o «Lote BETA al barrer»), marca, tallas,
 * unidades y costo; la descripción y el modelo (se editan en el sitio) y las fotos con [Cámara] y [Galería]. Lo que puede hacer quien mira lo
 * dice la API en `puede`; una compra cancelada sale en solo lectura (solo el admin ve la ✕ para quitar una foto equivocada). `onCambio` avisa
 * cuántas fotos tiene la línea cada vez que cambia, para corregir los contadores de la pantalla sin volver a pedir la lista.
 */
export function TarjetaLineaFotos({
  item,
  esAdmin,
  onCambio,
}: {
  item: LineaConFotosApi;
  esAdmin: boolean;
  onCambio?: (lineaId: string, cantidad: number) => void;
}) {
  const { compra, linea, puede } = item;
  const [cantidad, setCantidad] = useState(item.fotos.length);
  const cancelada = compra.estado === "cancelada";
  const etiqueta = `${compra.numero}, ${titularLinea(linea)}`;

  return (
    <article className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm" aria-label={`Línea de ${compra.numero}: ${titularLinea(linea)}`}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Link href={`/compras/registro?compra=${compra.id}&viaje=todos`} className="text-sm font-semibold text-marca-oscura underline-offset-2 hover:underline">
            {compra.numero}
          </Link>
          <span className="text-sm text-tinta-suave">· {compra.proveedor.nombre}</span>
          {compra.viaje && <span className="text-xs text-tinta-suave">· {compra.viaje.codigo}</span>}
          <span className="ml-auto flex flex-wrap items-center gap-1">
            {compra.estado !== "confirmada" && compra.estado !== "recibida" && <Badge tono={cancelada ? "alerta" : "neutro"}>{ETIQUETA_ESTADO_COMPRA[compra.estado]}</Badge>}
            <Badge tono={cantidad > 0 ? "exito" : "alerta"}>{cantidad > 0 ? "Con foto" : "Sin foto"}</Badge>
          </span>
        </div>
        <h3 className="text-base font-semibold uppercase tracking-wide text-tinta">{titularLinea(linea)}</h3>
        <p className="text-sm text-tinta-suave">
          {[linea.marca, ETIQUETA_TALLAS[linea.tallas] ?? linea.tallas, `${linea.unidades.toLocaleString("es-PE")} u`, textoCostoLinea(linea.costo_unitario, linea.moneda)]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </header>

      <FichaLinea compraId={compra.id} lineaId={linea.id} descripcion={linea.descripcion} modelo={linea.modelo} editable={puede.editar_ficha} etiqueta={etiqueta} />

      <FotosLinea
        compraId={compra.id}
        lineaId={linea.id}
        fotos={item.fotos}
        etiqueta={etiqueta}
        compraCancelada={cancelada}
        esAdmin={esAdmin}
        puedeSubir={puede.subir}
        puedeQuitar={puede.quitar}
        fotosEnCancelada={item.fotos_en_cancelada}
        onCambio={(n) => {
          setCantidad(n);
          onCambio?.(linea.id, n);
        }}
      />
    </article>
  );
}
