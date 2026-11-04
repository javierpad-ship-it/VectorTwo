"use client";

import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { ChipsMultiples } from "@/components/ui/chips-multiples";
import { Field, Input, Select } from "@/components/ui/form";
import { ESTADOS_EMBARQUE, TIPOS_EMBARQUE } from "@/lib/compras/agrupadores/tipos";
import { ETIQUETA_ESTADO_EMBARQUE, ETIQUETA_TIPO_EMBARQUE } from "@/lib/compras/agrupadores/tipos-api";
import { hayFiltrosEmbarques, PARAMETROS_AGRUPADORES_VACIOS, type ParametrosAgrupadores } from "./vista-agrupadores";

/**
 * Filtros de la lista de embarques (ficha 08b §4.1): «Mis embarques» o «Todos» (un filtro, nunca un permiso), estado, tipo, atrasados, mes de
 * llegada (desde y hasta) y texto. Controlado desde fuera: el panel guarda todo en la URL. `mio` es el valor efectivo (ya resuelto el
 * valor por defecto del comprador).
 */
export function FiltrosEmbarques({ parametros, mio, onCambiar }: { parametros: ParametrosAgrupadores; mio: boolean; onCambiar: (c: Partial<ParametrosAgrupadores>) => void }) {
  const estados: ChipItem<string>[] = [{ id: "todos", label: "Todos" }, ...ESTADOS_EMBARQUE.map((e) => ({ id: e as string, label: ETIQUETA_ESTADO_EMBARQUE[e] }))];
  const cambiarDesde = (v: string) => onCambiar({ desde: v || null, hasta: v && parametros.hasta && v > parametros.hasta ? v : parametros.hasta });
  const cambiarHasta = (v: string) => onCambiar({ hasta: v || null, desde: v && parametros.desde && v < parametros.desde ? v : parametros.desde });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Chips
          etiqueta="Responsable"
          items={[
            { id: "mios", label: "Mis embarques" },
            { id: "todos", label: "Todos" },
          ]}
          activo={mio ? "mios" : "todos"}
          onCambiar={(id) => onCambiar({ mio: id === "mios" })}
        />
        <Chips etiqueta="Estado" items={estados} activo={parametros.estado ?? "todos"} onCambiar={(id) => onCambiar({ estado: id === "todos" ? null : (id as ParametrosAgrupadores["estado"]) })} />
        <ChipsMultiples
          etiqueta="Filtro de atrasados"
          items={[{ id: "atrasados", label: "Atrasados", title: "Embarques cuya llegada estimada ya pasó sin recibirse" }]}
          valor={parametros.atrasados ? ["atrasados"] : []}
          onCambiar={(ids) => onCambiar({ atrasados: ids.includes("atrasados") })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Buscar" className="col-span-2 md:col-span-1">
          <Input value={parametros.q} onChange={(e) => onCambiar({ q: e.target.value })} placeholder="Código, nombre, puerto o proveedor" />
        </Field>
        <Field label="Tipo">
          <Select value={parametros.tipo ?? ""} onChange={(e) => onCambiar({ tipo: (e.target.value || null) as ParametrosAgrupadores["tipo"] })}>
            <option value="">Todos</option>
            {TIPOS_EMBARQUE.map((t) => (
              <option key={t} value={t}>
                {ETIQUETA_TIPO_EMBARQUE[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Llega desde">
          <Input type="month" value={parametros.desde ?? ""} max={parametros.hasta ?? undefined} onChange={(e) => cambiarDesde(e.target.value)} />
        </Field>
        <Field label="Llega hasta">
          <Input type="month" value={parametros.hasta ?? ""} min={parametros.desde ?? undefined} onChange={(e) => cambiarHasta(e.target.value)} />
        </Field>
      </div>
      {hayFiltrosEmbarques(parametros) && (
        <Button variante="fantasma" tamano="sm" onClick={() => onCambiar({ ...PARAMETROS_AGRUPADORES_VACIOS, pestana: parametros.pestana, mio: false })}>
          Quitar filtros
        </Button>
      )}
    </div>
  );
}
