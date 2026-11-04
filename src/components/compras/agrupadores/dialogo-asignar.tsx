"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input, Select } from "@/components/ui/form";
import type { AsignarEntregas } from "@/lib/compras/agrupadores/esquemas";
import type { EmbarqueDetalleApi, EntregaSinEmbarqueApi, OpcionesAgrupadoresApi, RespuestaMovimientoApi, ViajeApi } from "@/lib/compras/agrupadores/tipos-api";
import { asignarEntregas, useSinAsignar } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { mesCorto, unidades } from "../formato";
import { DialogoMovimiento } from "./dialogo-movimiento";
import { errorUnidades, etiquetaViaje, textoLinea, viajesParaSelector, VIAJE_SIN_VIAJE } from "./vista-agrupadores";

/** Qué se asigna: las candidatas de un embarque que ya está abierto («Agregar compras»), o entregas ya elegidas a un embarque por elegir. */
export type ModoAsignar = { tipo: "embarque"; embarque: EmbarqueDetalleApi } | { tipo: "entregas"; entregas: readonly EntregaSinEmbarqueApi[] };

const sinNormalizar = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

/**
 * Asignar mercadería a un embarque (ficha 08b §3.4 y §4.2). Dos usos:
 *
 *  - **Agregar compras** desde el detalle del embarque: el modal carga las entregas sin embarque (compras en borrador o confirmadas) con
 *    filtros por viaje, mes, proveedor y texto; se marcan las que viajan y se ajustan las unidades.
 *  - **Asignar a embarque…** desde Sin agrupador o desde un viaje: las entregas ya vienen elegidas y falta elegir el embarque y el paquete.
 *
 * En los dos, las unidades no pueden pasar de lo que queda sin asignar en la entrega («Solo hay 120 u sin asignar en esta entrega») y la vista
 * previa dice qué meses cambian y qué avisos hay (viaje distinto, lote que cambia de temporada, mes cerrado…) antes de escribir.
 */
export function DialogoAsignar({
  modo,
  opciones,
  viajes,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  modo: ModoAsignar;
  /** Para elegir el embarque y el paquete de destino cuando las entregas ya vienen elegidas. */
  opciones: OpcionesAgrupadoresApi | null;
  viajes: readonly Pick<ViajeApi, "id" | "codigo" | "nombre" | "estado" | "fecha_inicio">[];
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  onRecargar?: () => void | Promise<void>;
}) {
  const fijo = modo.tipo === "embarque";
  const [filtros, setFiltros] = useState({ viaje: "", desde: "", hasta: "", proveedor: "", q: "" });
  const lectura = useSinAsignar(fijo ? { viaje_id: filtros.viaje || undefined, desde: filtros.desde || undefined, hasta: filtros.hasta || undefined } : null);
  const [embarqueElegido, setEmbarqueElegido] = useState("");
  const [paquete, setPaquete] = useState("");
  /** Marcas explícitas por entrega y unidades escritas (texto, para poder teclear); sin marca explícita, `entregas` llegan todas marcadas. */
  const [marcas, setMarcas] = useState<Record<string, boolean>>({});
  const [escritas, setEscritas] = useState<Record<string, string>>({});

  const candidatas = useMemo<EntregaSinEmbarqueApi[]>(() => (modo.tipo === "entregas" ? [...modo.entregas] : (lectura.datos?.entregas ?? [])).filter((e) => e.sin_asignar > 0), [modo, lectura.datos]);
  const proveedores = useMemo(() => [...new Map(candidatas.map((e) => [e.compra.proveedor.id, e.compra.proveedor.nombre])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [candidatas]);
  const visibles = useMemo(() => {
    const q = sinNormalizar(filtros.q.trim());
    return candidatas.filter((e) => {
      if (filtros.proveedor && e.compra.proveedor.id !== filtros.proveedor) return false;
      if (q === "") return true;
      return sinNormalizar([e.compra.numero, e.compra.proveedor.nombre, textoLinea(e.linea)].join(" ")).includes(q);
    });
  }, [candidatas, filtros.proveedor, filtros.q]);

  // Con las entregas ya elegidas vienen todas marcadas hasta que la persona las desmarque; las candidatas, ninguna.
  const estaMarcada = (e: EntregaSinEmbarqueApi) => marcas[e.entrega_id] ?? modo.tipo === "entregas";
  const unidadesDe = (e: EntregaSinEmbarqueApi) => escritas[e.entrega_id] ?? String(e.sin_asignar);

  const marcar = (e: EntregaSinEmbarqueApi, v: boolean) => setMarcas((m) => ({ ...m, [e.entrega_id]: v }));
  const ponerUnidades = (e: EntregaSinEmbarqueApi, t: string) => setEscritas((m) => ({ ...m, [e.entrega_id]: t }));
  const marcarTodas = (v: boolean) => setMarcas((m) => ({ ...m, ...Object.fromEntries(visibles.map((e) => [e.entrega_id, v])) }));

  const elegidas = candidatas.filter(estaMarcada);
  const errores = new Map(elegidas.map((e) => [e.entrega_id, errorUnidades(unidadesDe(e), e.sin_asignar)] as const));
  const hayError = [...errores.values()].some((x) => x !== null);

  // Embarque de destino: el abierto, o el que se elige entre los que aceptan mercadería.
  const destinos = (opciones?.embarques ?? []).filter((e) => e.estado === "planificado" || e.estado === "en_transito");
  const destino = modo.tipo === "embarque" ? { id: modo.embarque.id, revision: modo.embarque.revision } : (destinos.find((e) => e.id === embarqueElegido) ?? null);
  const paquetes = modo.tipo === "embarque" ? modo.embarque.paquetes.filter((p) => p.estado === "abierto") : (opciones?.paquetes ?? []).filter((p) => p.estado === "abierto" && p.embarque_id === embarqueElegido);

  const cuerpo: AsignarEntregas | null =
    destino && elegidas.length > 0 && !hayError
      ? {
          revision: destino.revision,
          paquete_id: paquete || null,
          items: elegidas.map((e) => ({ entrega_id: e.entrega_id, unidades: Number(unidadesDe(e)), compra_revision: e.compra.revision })),
        }
      : null;
  const pista = !destino ? "Elige el embarque de destino." : elegidas.length === 0 ? "Marca al menos una entrega." : hayError ? "Corrige las unidades marcadas en rojo." : undefined;
  const totalUnidades = elegidas.reduce((a, e) => a + (errores.get(e.entrega_id) === null ? Number(unidadesDe(e)) : 0), 0);

  const columnas: Columna<EntregaSinEmbarqueApi>[] = [
    {
      clave: "marca",
      titulo: "",
      render: (e) => <Checkbox checked={estaMarcada(e)} onChange={(v) => marcar(e, v)} label={`Asignar ${e.compra.numero}, ${textoLinea(e.linea)}, ${mesCorto(e.periodo)}`} />,
    },
    { clave: "compra", titulo: "Compra", render: (e) => <span className="whitespace-nowrap font-medium">{e.compra.numero}</span> },
    { clave: "proveedor", titulo: "Proveedor", render: (e) => <span className="text-xs">{e.compra.proveedor.nombre}</span> },
    { clave: "linea", titulo: "Línea", render: (e) => <span className="whitespace-nowrap text-xs">{textoLinea(e.linea)}</span> },
    { clave: "mes", titulo: "Mes", render: (e) => <span className="whitespace-nowrap text-xs">{mesCorto(e.periodo)}</span> },
    { clave: "sin", titulo: "Sin asignar", className: "text-right", render: (e) => <span className="font-mono tabular-nums">{unidades(e.sin_asignar)}</span> },
    {
      clave: "unidades",
      titulo: "A asignar",
      className: "min-w-28",
      render: (e) => {
        if (!estaMarcada(e)) return <span className="text-tinta-suave">—</span>;
        const v = unidadesDe(e);
        const err = errores.get(e.entrega_id) ?? null;
        return (
          <div>
            <Input
              inputMode="numeric"
              value={v}
              onChange={(ev) => ponerUnidades(e, ev.target.value)}
              aria-label={`Unidades de ${e.compra.numero}, ${textoLinea(e.linea)}`}
              aria-invalid={err !== null}
              className="h-8 w-24 text-right font-mono"
            />
            {err && <p className="mt-0.5 max-w-48 text-[11px] text-alerta">{err}</p>}
          </div>
        );
      },
    },
  ];

  const titulo = modo.tipo === "embarque" ? `Agregar compras · Embarque ${modo.embarque.codigo}` : "Asignar a embarque";
  const descripcion =
    modo.tipo === "embarque"
      ? "Las entregas sin embarque de compras en borrador o confirmadas. Si su mes no es el de llegada del embarque, pasan al mes del embarque."
      : "Elige el embarque y, si quieres, el paquete. Las entregas que no estén en el mes de llegada pasan a ese mes.";

  return (
    <DialogoMovimiento
      titulo={titulo}
      descripcion={descripcion}
      cuerpo={cuerpo}
      llamar={(c, previsualizar) => asignarEntregas(destino?.id ?? "", c, previsualizar)}
      onAplicado={onAplicado}
      onCerrar={onCerrar}
      onRecargar={onRecargar}
      textoAplicar={`Asignar${totalUnidades > 0 ? ` ${unidades(totalUnidades)} u` : ""}`}
      pista={pista}
      ancho="max-w-5xl"
    >
      <div className="space-y-4">
        {modo.tipo === "entregas" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Embarque de destino">
              <Select
                value={embarqueElegido}
                onChange={(e) => {
                  setEmbarqueElegido(e.target.value);
                  setPaquete("");
                }}
              >
                <option value="">Elige un embarque</option>
                {destinos.map((e) => (
                  <option key={e.id} value={e.id}>
                    Embarque {e.codigo} · {mesCorto(e.periodo_llegada)} · {e.nombre}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Paquete" hint="Opcional.">
              <Select value={paquete} onChange={(e) => setPaquete(e.target.value)} disabled={embarqueElegido === ""}>
                <option value="">Sin paquete</option>
                {paquetes.map((p) => (
                  <option key={p.id} value={p.id}>
                    Paquete {p.codigo} · {p.nombre}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {modo.tipo === "embarque" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="Viaje">
                <Select value={filtros.viaje} onChange={(e) => setFiltros((f) => ({ ...f, viaje: e.target.value }))}>
                  <option value="">Todos</option>
                  <option value={VIAJE_SIN_VIAJE}>Compras sin viaje</option>
                  {viajesParaSelector(viajes).map((v) => (
                    <option key={v.id} value={v.id}>
                      {etiquetaViaje(v)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Proveedor">
                <Select value={filtros.proveedor} onChange={(e) => setFiltros((f) => ({ ...f, proveedor: e.target.value }))}>
                  <option value="">Todos</option>
                  {proveedores.map(([id, nombre]) => (
                    <option key={id} value={id}>
                      {nombre}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Mes desde">
                <Input type="month" value={filtros.desde} max={filtros.hasta || undefined} onChange={(e) => setFiltros((f) => ({ ...f, desde: e.target.value }))} />
              </Field>
              <Field label="Mes hasta">
                <Input type="month" value={filtros.hasta} min={filtros.desde || undefined} onChange={(e) => setFiltros((f) => ({ ...f, hasta: e.target.value }))} />
              </Field>
              <Field label="Buscar" className="sm:col-span-2 lg:col-span-1">
                <Input value={filtros.q} onChange={(e) => setFiltros((f) => ({ ...f, q: e.target.value }))} placeholder="Compra, proveedor o línea" />
              </Field>
            </div>
            {lectura.error && <p className="text-sm text-alerta">{lectura.error}</p>}
          </>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-tinta-suave" aria-live="polite">
            {plural(visibles.length, "entrega sin embarque", "entregas sin embarque")} · {plural(elegidas.length, "marcada", "marcadas")}
            {lectura.cargando ? " · cargando…" : ""}
          </p>
          <div className="flex gap-2">
            <Button variante="fantasma" tamano="sm" onClick={() => marcarTodas(true)} disabled={visibles.length === 0}>
              Marcar las visibles
            </Button>
            <Button variante="fantasma" tamano="sm" onClick={() => marcarTodas(false)} disabled={elegidas.length === 0}>
              Quitar marcas
            </Button>
          </div>
        </div>
        <DataTable columnas={columnas} filas={visibles} claveFila={(e) => e.entrega_id} cargando={fijo && lectura.cargando && candidatas.length === 0} vacio="No hay entregas sin embarque con estos filtros." />
      </div>
    </DialogoMovimiento>
  );
}
