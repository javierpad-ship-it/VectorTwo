"use client";

import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { ChipsMultiples } from "@/components/ui/chips-multiples";
import { Field, Input, Select } from "@/components/ui/form";
import { ESTADOS_COMPRA, ORIGENES_COMPRA } from "@/lib/compras/tipos";
import { ETIQUETA_ORIGEN_COMPRA } from "@/lib/compras/tipos-api";
import { ETIQUETA_FILTRO_ESTADO, hayFiltrosCompras, PARAMETROS_COMPRAS_VACIOS, type ParametrosCompras } from "./vista-compras";
import type { OpcionId } from "./vista-flujo";

/**
 * Filtros de la lista de compras (ficha 08 §4.4): estado, «Por confirmar», texto, proveedor, origen, mes de entrega (desde y hasta),
 * género, mundo y línea (en cascada) y marca. Todos viajan al servidor salvo el texto, que se aplica en el navegador. Controlado desde
 * fuera: el panel guarda todo en la URL.
 */
export function BarraFiltrosCompras({
  parametros,
  proveedores,
  generos,
  mundos,
  lineas,
  marcas,
  onCambiar,
}: {
  parametros: ParametrosCompras;
  proveedores: readonly OpcionId[];
  generos: readonly OpcionId[];
  mundos: readonly OpcionId[];
  lineas: readonly OpcionId[];
  marcas: readonly OpcionId[];
  onCambiar: (cambios: Partial<ParametrosCompras>) => void;
}) {
  const estadoItems: ChipItem<string>[] = [{ id: "todos", label: "Todas" }, ...ESTADOS_COMPRA.map((e) => ({ id: e as string, label: ETIQUETA_FILTRO_ESTADO[e] }))];
  // Un mes «desde» posterior al «hasta» (o al revés) lo rechaza la API: se arrastra el otro extremo para que el rango siempre sea válido.
  const cambiarDesde = (v: string) => onCambiar({ desde: v || null, hasta: v && parametros.hasta && v > parametros.hasta ? v : parametros.hasta });
  const cambiarHasta = (v: string) => onCambiar({ hasta: v || null, desde: v && parametros.desde && v < parametros.desde ? v : parametros.desde });
  const opciones = (xs: readonly OpcionId[]) =>
    xs.map((x) => (
      <option key={x.id} value={x.id}>
        {x.nombre}
      </option>
    ));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Chips etiqueta="Estado" items={estadoItems} activo={parametros.estado ?? "todos"} onCambiar={(id) => onCambiar({ estado: id === "todos" ? null : (id as ParametrosCompras["estado"]) })} />
        <ChipsMultiples
          etiqueta="Filtro por confirmar"
          items={[{ id: "por_confirmar", label: "Por confirmar", title: "Compras con entregas vencidas sin confirmar" }]}
          valor={parametros.porConfirmar ? ["por_confirmar"] : []}
          onCambiar={(ids) => onCambiar({ porConfirmar: ids.includes("por_confirmar") })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
        <Field label="Buscar" className="col-span-2 md:col-span-1">
          <Input value={parametros.q} onChange={(e) => onCambiar({ q: e.target.value })} placeholder="Número, proveedor o referencia" />
        </Field>
        <Field label="Proveedor">
          <Select value={parametros.proveedor ?? ""} onChange={(e) => onCambiar({ proveedor: e.target.value || null })}>
            <option value="">Todos</option>
            {opciones(proveedores)}
          </Select>
        </Field>
        <Field label="Origen">
          <Select value={parametros.origen ?? ""} onChange={(e) => onCambiar({ origen: (e.target.value || null) as ParametrosCompras["origen"] })}>
            <option value="">Todos</option>
            {ORIGENES_COMPRA.map((o) => (
              <option key={o} value={o}>
                {ETIQUETA_ORIGEN_COMPRA[o]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Marca">
          <Select value={parametros.marca ?? ""} onChange={(e) => onCambiar({ marca: e.target.value || null })}>
            <option value="">Todas</option>
            {opciones(marcas)}
          </Select>
        </Field>
        <Field label="Entrega desde">
          <Input type="month" placeholder="aaaa-mm" value={parametros.desde ?? ""} max={parametros.hasta ?? undefined} onChange={(e) => cambiarDesde(e.target.value)} />
        </Field>
        <Field label="Entrega hasta">
          <Input type="month" placeholder="aaaa-mm" value={parametros.hasta ?? ""} min={parametros.desde ?? undefined} onChange={(e) => cambiarHasta(e.target.value)} />
        </Field>
        <Field label="Género">
          <Select value={parametros.genero ?? ""} onChange={(e) => onCambiar({ genero: e.target.value || null, mundo: null, linea: null })}>
            <option value="">Todos</option>
            {opciones(generos)}
          </Select>
        </Field>
        <Field label="Mundo">
          <Select value={parametros.mundo ?? ""} onChange={(e) => onCambiar({ mundo: e.target.value || null, linea: null })}>
            <option value="">Todos</option>
            {opciones(mundos)}
          </Select>
        </Field>
        <Field label="Línea">
          <Select value={parametros.linea ?? ""} onChange={(e) => onCambiar({ linea: e.target.value || null })}>
            <option value="">Todas</option>
            {opciones(lineas)}
          </Select>
        </Field>
      </div>
      {hayFiltrosCompras(parametros) && (
        <Button variante="fantasma" tamano="sm" onClick={() => onCambiar({ ...PARAMETROS_COMPRAS_VACIOS, compra: null, importar: false })}>
          Quitar filtros
        </Button>
      )}
    </div>
  );
}
