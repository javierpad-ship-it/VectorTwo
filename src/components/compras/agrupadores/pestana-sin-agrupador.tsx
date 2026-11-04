"use client";

import { useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import type { AvisoDetalleApi, CompraSinViajeApi, EntregaSinEmbarqueApi, OpcionesAgrupadoresApi, ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { ETIQUETA_AVISO_AGRUPADOR } from "@/lib/compras/agrupadores/tipos-api";
import { useSinAsignar } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { unidades } from "../formato";
import { DialogoAsignar } from "./dialogo-asignar";
import { DialogoComprasViaje } from "./dialogo-compras-viaje";
import { mensajeDeMovimiento, type MensajeAgrupador } from "./detalle-embarque";
import { TablaCompras, TablaEntregasSinEmbarque } from "./tablas-sin-agrupador";
import { textoAvisoDetalle, textoLinea, viajeParaApi, VIAJE_TODOS, type ParametrosAgrupadores } from "./vista-agrupadores";

type Dialogo = { tipo: "embarque"; entregas: EntregaSinEmbarqueApi[] } | { tipo: "viaje"; compras: CompraSinViajeApi[] } | null;

const sinNormalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

/**
 * Pestaña «Sin agrupador» (ficha 08b §4.4): el respaldo manual de lo que ya estaba cargado. «Entregas sin embarque» (compras en borrador o
 * confirmadas, por mes) con «Asignar a embarque…», y «Compras sin viaje» con «Asignar a viaje…». Respeta el viaje activo: con un viaje
 * elegido, las entregas son las de ese viaje (las compras sin viaje se muestran siempre, porque son las candidatas a entrar al viaje).
 */
export function PestanaSinAgrupador({
  parametros,
  viajeActivo,
  viajes,
  opciones,
  onCambiar,
  onRecargar,
  onMensaje,
}: {
  parametros: ParametrosAgrupadores;
  viajeActivo: string;
  viajes: readonly ViajeApi[];
  opciones: OpcionesAgrupadoresApi | null;
  onCambiar: (c: Partial<ParametrosAgrupadores>) => void;
  /** Relee las listas y las opciones tras una escritura. */
  onRecargar: () => void | Promise<void>;
  onMensaje: (m: MensajeAgrupador | null) => void;
}) {
  const lectura = useSinAsignar({ viaje_id: viajeParaApi(viajeActivo), desde: parametros.desde ?? undefined, hasta: parametros.hasta ?? undefined });
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [entregasMarcadas, setEntregasMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [comprasMarcadas, setComprasMarcadas] = useState<ReadonlySet<string>>(new Set());
  const [proveedor, setProveedor] = useState("");

  const entregas = useMemo(() => lectura.datos?.entregas ?? [], [lectura.datos]);
  const comprasSinViaje = useMemo(() => lectura.datos?.compras_sin_viaje ?? [], [lectura.datos]);
  const proveedores = useMemo(
    () => [...new Map([...entregas.map((e) => e.compra.proveedor), ...comprasSinViaje.map((c) => c.proveedor)].map((p) => [p.id, p.nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1])),
    [entregas, comprasSinViaje],
  );
  const q = sinNormalizar(parametros.q.trim());
  const entregasVisibles = entregas.filter(
    (e) => (proveedor === "" || e.compra.proveedor.id === proveedor) && (q === "" || sinNormalizar(`${e.compra.numero} ${e.compra.proveedor.nombre} ${textoLinea(e.linea)}`).includes(q)),
  );
  const comprasVisibles = comprasSinViaje.filter((c) => (proveedor === "" || c.proveedor.id === proveedor) && (q === "" || sinNormalizar(`${c.numero} ${c.proveedor.nombre}`).includes(q)));

  const alternar = (set: ReadonlySet<string>, poner: (s: ReadonlySet<string>) => void) => (id: string, marcada: boolean) => {
    const n = new Set(set);
    if (marcada) n.add(id);
    else n.delete(id);
    poner(n);
  };
  const marcadasE = entregasVisibles.filter((e) => entregasMarcadas.has(e.entrega_id));
  const marcadasC = comprasVisibles.filter((c) => comprasMarcadas.has(c.id));
  const totalSinAsignar = entregasVisibles.reduce((a, e) => a + e.sin_asignar, 0);

  async function tras(m: MensajeAgrupador) {
    setDialogo(null);
    setEntregasMarcadas(new Set());
    setComprasMarcadas(new Set());
    onMensaje(m);
    await Promise.all([onRecargar(), lectura.recargar()]);
  }
  const avisosTexto = (avisos: AvisoDetalleApi[]) => avisos.map((a) => textoAvisoDetalle(a, ETIQUETA_AVISO_AGRUPADOR));

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-tinta-suave">
        El respaldo manual de lo ya cargado: las entregas que todavía no están en un embarque y las compras que no tienen viaje. Marca lo que corresponda y asígnalo.
        {viajeActivo !== VIAJE_TODOS && " Las entregas son las del viaje activo."}
      </p>
      {lectura.error && <Alert onCerrar={() => lectura.setError(null)}>{lectura.error}</Alert>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Field label="Buscar" className="col-span-2 md:col-span-1">
          <Input value={parametros.q} onChange={(e) => onCambiar({ q: e.target.value })} placeholder="Compra, proveedor o línea" />
        </Field>
        <Field label="Proveedor">
          <Select value={proveedor} onChange={(e) => setProveedor(e.target.value)}>
            <option value="">Todos</option>
            {proveedores.map(([id, nombre]) => (
              <option key={id} value={id}>
                {nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mes de la entrega desde">
          <Input type="month" value={parametros.desde ?? ""} max={parametros.hasta ?? undefined} onChange={(e) => onCambiar({ desde: e.target.value || null })} />
        </Field>
        <Field label="Mes de la entrega hasta">
          <Input type="month" value={parametros.hasta ?? ""} min={parametros.desde ?? undefined} onChange={(e) => onCambiar({ hasta: e.target.value || null })} />
        </Field>
      </div>

      <Card
        titulo="Entregas sin embarque"
        descripcion={`${plural(entregasVisibles.length, "entrega", "entregas")} · ${unidades(totalSinAsignar)} u sin asignar`}
        acciones={
          <Button tamano="sm" disabled={marcadasE.length === 0} onClick={() => setDialogo({ tipo: "embarque", entregas: marcadasE })}>
            Asignar a embarque…{marcadasE.length > 0 ? ` (${marcadasE.length})` : ""}
          </Button>
        }
      >
        <TablaEntregasSinEmbarque
          entregas={entregasVisibles}
          seleccion={entregasMarcadas}
          onAlternar={alternar(entregasMarcadas, setEntregasMarcadas)}
          cargando={lectura.cargando && !lectura.datos}
          vacio="No hay entregas sin embarque con estos filtros."
        />
      </Card>

      <Card
        titulo="Compras sin viaje"
        descripcion={plural(comprasVisibles.length, "compra", "compras")}
        acciones={
          <Button tamano="sm" disabled={marcadasC.length === 0} onClick={() => setDialogo({ tipo: "viaje", compras: marcadasC })}>
            Asignar a viaje…{marcadasC.length > 0 ? ` (${marcadasC.length})` : ""}
          </Button>
        }
      >
        <TablaCompras
          compras={comprasVisibles}
          seleccion={comprasMarcadas}
          onAlternar={alternar(comprasMarcadas, setComprasMarcadas)}
          cargando={lectura.cargando && !lectura.datos}
          conOrigen
          vacio="Todas las compras tienen viaje."
        />
      </Card>

      {dialogo?.tipo === "embarque" && (
        <DialogoAsignar
          modo={{ tipo: "entregas", entregas: dialogo.entregas }}
          opciones={opciones}
          viajes={viajes}
          onCerrar={() => setDialogo(null)}
          onRecargar={async () => {
            await Promise.all([onRecargar(), lectura.recargar()]);
          }}
          onAplicado={(r) => tras({ ...mensajeDeMovimiento(`Mercadería asignada al embarque ${r.embarque.codigo}.`, r), avisos: avisosTexto(r.avisos) })}
        />
      )}
      {dialogo?.tipo === "viaje" && (
        <DialogoComprasViaje
          modo={{ tipo: "asignar", compras: dialogo.compras, viajes, viajeInicial: viajeActivo !== VIAJE_TODOS && viajes.some((v) => v.id === viajeActivo && v.estado !== "cancelado") ? viajeActivo : undefined }}
          onCerrar={() => setDialogo(null)}
          onRecargar={async () => {
            await Promise.all([onRecargar(), lectura.recargar()]);
          }}
          onHecho={(texto, avisos) => tras({ tono: avisos.length > 0 ? "info" : "exito", texto, avisos: avisosTexto(avisos) })}
        />
      )}
    </div>
  );
}
