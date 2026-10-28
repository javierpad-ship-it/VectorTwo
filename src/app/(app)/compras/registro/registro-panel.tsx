"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useArbol } from "@/lib/arbol/use-arbol";
import type { Rol } from "@/lib/auth/roles";
import type { CompraApi, EntregaLineaApi, LineaCompraApi, RecepcionLineaApi } from "@/lib/compras/tipos-api";
import { quitarIngreso, useAccion, useCompra, useCompras, useMarcas, useProveedores } from "@/lib/compras/use-compras";
import { NOMBRE_ARCHIVO_COMPRAS } from "@/lib/flujo/excel";
import { useHuecos } from "@/lib/flujo/use-flujo";
import { plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AvisoPorConfirmar } from "@/components/compras/aviso-por-confirmar";
import { BarraFiltrosCompras } from "@/components/compras/barra-filtros-compras";
import { descargarCompras } from "@/components/compras/descarga";
import { DetalleCompra } from "@/components/compras/detalle-compra";
import { DialogoCancelar } from "@/components/compras/dialogo-cancelar";
import { DialogoIngreso } from "@/components/compras/dialogo-ingreso";
import { fechaLima } from "@/components/compras/formato";
import { ImportarCompras } from "@/components/compras/importar-compras";
import { ListaCompras } from "@/components/compras/lista-compras";
import { consultaCompras, filtrarCompras, filtrosCompras, leerParametrosCompras, textoConfirmarQuitar, type ParametrosCompras } from "@/components/compras/vista-compras";
import { nodosDeArbol, opcionesArbol } from "@/components/compras/vista-flujo";

type Dialogo = { tipo: "ingreso"; linea: LineaCompraApi; numero: number; entrega: EntregaLineaApi | null } | { tipo: "cancelar" } | null;
type Mensaje = { tono: "exito" | "info" | "alerta"; texto: string };

/**
 * Pantalla /compras/registro (Compras, M8; ficha 08 §4.4 y §4.7). En `0.13.0` es la lista y el detalle de las compras (cabecera, líneas,
 * entregas con su pendiente, ingresos confirmados e historial) más las acciones de admin y planner: **Importar** la carga inicial,
 * **Confirmar ingreso** (por línea o por entrega, en el mes en que llegó), **Quitar** un ingreso y **Cancelar** (con ingresos, cierra el
 * saldo). Todos los roles leen; los botones de escritura se ocultan al comprador y la API los exige con `requirePlanner`. Los filtros y
 * la compra abierta viven en la URL. Arriba, el aviso «Por confirmar» y el filtro del mismo nombre.
 */
export function RegistroPanel({ rol }: { rol: Rol }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const parametros = leerParametrosCompras((k) => search.get(k));
  const puedeEscribir = rol === "admin" || rol === "planner";

  const enLista = !parametros.importar && parametros.compra === null;
  const compras = useCompras(filtrosCompras(parametros));
  const detalle = useCompra(parametros.compra);
  const proveedores = useProveedores();
  const arbol = useArbol(false);
  const marcas = useMarcas(enLista);
  // La cabecera de Huecos trae el último mes publicado y el resumen «Por confirmar» oficial (con el respaldo del inventario).
  const cabecera = useHuecos(1);
  const accion = useAccion();

  // Hoy en Lima se fija al montar: el reloj no se lee en cada render.
  const [hoyFecha] = useState(() => fechaLima());
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const [mensaje, setMensaje] = useState<Mensaje | null>(null);
  const [exportando, setExportando] = useState(false);

  const irA = (siguiente: ParametrosCompras, modo: "push" | "replace") => {
    const q = consultaCompras(siguiente);
    const url = q === "" ? pathname : `${pathname}?${q}`;
    if (modo === "push") window.history.pushState(null, "", url);
    else window.history.replaceState(null, "", url);
  };
  const cambiar = (c: Partial<ParametrosCompras>) => irA({ ...parametros, ...c }, "replace");
  const href = (c: Partial<ParametrosCompras>) => {
    const q = consultaCompras({ ...parametros, ...c });
    return q === "" ? pathname : `${pathname}?${q}`;
  };

  const visibles = filtrarCompras(compras.datos, parametros.q);
  const datosFlujo = cabecera.datos?.datos ?? null;
  const errorCarga = compras.error ?? detalle.error ?? proveedores.error ?? cabecera.error ?? arbol.error ?? marcas.error;
  const limpiarErrores = () => {
    compras.setError(null);
    detalle.setError(null);
    proveedores.setError(null);
    cabecera.setError(null);
    arbol.setError(null);
    marcas.setError(null);
  };

  const nodos = useMemo(() => nodosDeArbol(arbol.arbol), [arbol.arbol]);
  const opciones = opcionesArbol(nodos, parametros);
  const opcionesProveedor = useMemo(() => proveedores.datos.map((p) => ({ id: p.id, nombre: p.nombre })), [proveedores.datos]);
  const opcionesMarca = useMemo(() => (marcas.datos ?? []).filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre })), [marcas.datos]);

  async function recargarTodo() {
    await Promise.all([compras.recargar(), detalle.recargar(), cabecera.recargar()]);
  }

  async function quitar(compra: CompraApi, linea: LineaCompraApi, numero: number, r: RecepcionLineaApi) {
    setMensaje(null);
    if (!confirm(textoConfirmarQuitar(compra, numero, r))) return;
    const res = await accion.ejecutar(() => quitarIngreso(compra.id, r.id, compra.revision));
    if (!res.ok) {
      if (res.error.codigo === "compra_cambio") await recargarTodo();
      return;
    }
    setMensaje({ tono: "exito", texto: `Ingreso quitado de ${compra.numero}, línea ${numero}: esas unidades vuelven a esperarse en el flujo. Queda en el historial.` });
    await recargarTodo();
  }

  /** Excel (ficha 08 §4.4): `COMPRAS`, `ENTREGAS`, `POR_PROVEEDOR` y `COSTO` de las compras que ves en la lista, con los filtros aplicados. */
  async function exportar() {
    setMensaje(null);
    accion.limpiar();
    setExportando(true);
    const r = await accion.ejecutar(() => descargarCompras(visibles));
    setExportando(false);
    if (r.ok) setMensaje({ tono: "exito", texto: `Excel descargado (${NOMBRE_ARCHIVO_COMPRAS}): ${plural(visibles.length, "compra", "compras")} con los filtros que ves.` });
  }

  const compraAbierta = detalle.datos;

  // ── Importar ──
  if (parametros.importar && puedeEscribir) {
    return (
      <div className="space-y-5">
        <Link href={href({ importar: false })} className="inline-flex h-8 items-center rounded-md border border-borde bg-superficie px-3 text-sm font-medium text-tinta hover:bg-neutro-suave">
          ← Volver a Compras
        </Link>
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Importar compras</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Carga las compras en curso desde una plantilla. Entran como ya hechas (confirmadas) y desde ese momento cuentan en el flujo. Es seguro repetir la carga: cada línea se reconoce por
            proveedor, referencia y número de línea, y lo que ya existe no se duplica.
          </p>
        </div>
        <ImportarCompras
          onImportado={() => void recargarTodo()}
          onAplicado={() => irA({ ...parametros, importar: false }, "push")}
        />
      </div>
    );
  }

  // ── Detalle ──
  if (parametros.compra) {
    return (
      <div className="space-y-5">
        <Link href={href({ compra: null })} className="inline-flex h-8 items-center rounded-md border border-borde bg-superficie px-3 text-sm font-medium text-tinta hover:bg-neutro-suave">
          ← Volver a la lista
        </Link>
        {mensaje && (
          <Alert tono={mensaje.tono} onCerrar={() => setMensaje(null)}>
            {mensaje.texto}
          </Alert>
        )}
        {errorCarga && <Alert onCerrar={limpiarErrores}>{errorCarga}</Alert>}
        {accion.error && <Alert onCerrar={accion.limpiar}>{accion.error.mensaje}</Alert>}
        {detalle.cargando && !compraAbierta && <p className="py-8 text-center text-sm text-tinta-suave">Cargando la compra…</p>}
        {compraAbierta && (
          <DetalleCompra
            compra={compraAbierta}
            puedeEscribir={puedeEscribir}
            ocupado={accion.ocupado}
            onConfirmarIngreso={(linea, numero, entrega) => setDialogo({ tipo: "ingreso", linea, numero, entrega })}
            onQuitarIngreso={(linea, numero, r) => void quitar(compraAbierta, linea, numero, r)}
            onCancelar={() => setDialogo({ tipo: "cancelar" })}
          />
        )}
        {compraAbierta && dialogo?.tipo === "ingreso" && (
          <DialogoIngreso
            compra={compraAbierta}
            linea={dialogo.linea}
            numeroLinea={dialogo.numero}
            entrega={dialogo.entrega}
            kPrima={datosFlujo?.k_prima ?? null}
            hoyFecha={hoyFecha}
            onRecargar={recargarTodo}
            onCerrar={() => setDialogo(null)}
            onGuardado={async (c) => {
              setDialogo(null);
              setMensaje({ tono: "exito", texto: `Ingreso confirmado en ${c.numero}. Queda en el historial.` });
              await recargarTodo();
            }}
          />
        )}
        {compraAbierta && dialogo?.tipo === "cancelar" && (
          <DialogoCancelar
            compra={compraAbierta}
            onRecargar={recargarTodo}
            onCerrar={() => setDialogo(null)}
            onCancelada={async (c) => {
              setDialogo(null);
              setMensaje({ tono: "exito", texto: c.saldo_cerrado ? `${c.numero}: saldo cancelado; la compra queda como recibida parcialmente.` : `${c.numero} cancelada: deja de contar en el flujo.` });
              await recargarTodo();
            }}
          />
        )}
      </div>
    );
  }

  // ── Lista ──
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Compras</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Las compras registradas, con su cronograma de entregas, los ingresos que alguien confirmó y su historial. Cuando una entrega llega, confirma su ingreso para que el flujo deje de
            esperarla. El costo de las compras es visible para todos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variante="secundario"
            onClick={() => void exportar()}
            disabled={exportando || compras.cargando || visibles.length === 0}
            title="Descarga las compras de la lista, con sus líneas y entregas, en Excel"
          >
            {exportando ? "Preparando Excel…" : "Excel"}
          </Button>
          {puedeEscribir && (
            <Button onClick={() => irA({ ...parametros, importar: true, compra: null }, "push")}>Importar compras</Button>
          )}
        </div>
      </div>

      {mensaje && (
        <Alert tono={mensaje.tono} onCerrar={() => setMensaje(null)}>
          {mensaje.texto}
        </Alert>
      )}
      {errorCarga && <Alert onCerrar={limpiarErrores}>{errorCarga}</Alert>}
      {accion.error && <Alert onCerrar={accion.limpiar}>{accion.error.mensaje}</Alert>}

      {datosFlujo && <AvisoPorConfirmar resumen={datosFlujo.por_confirmar} mes={datosFlujo.periodos[1]} onRevisar={() => cambiar({ porConfirmar: true })} />}

      <div className="space-y-3">
        <BarraFiltrosCompras
          parametros={parametros}
          proveedores={opcionesProveedor}
          generos={opciones.generos}
          mundos={opciones.mundos}
          lineas={opciones.lineas}
          marcas={opcionesMarca}
          onCambiar={cambiar}
        />
        <p className="text-xs text-tinta-suave" aria-live="polite">
          {plural(visibles.length, "compra", "compras")}
          {visibles.length !== compras.datos.length ? ` de ${compras.datos.length}` : ""}
          {compras.cargando && compras.datos.length > 0 ? " · actualizando…" : ""}
        </p>
      </div>

      <ListaCompras compras={visibles} enlace={(c) => href({ compra: c.id })} cargando={compras.cargando && compras.datos.length === 0} />
    </div>
  );
}
