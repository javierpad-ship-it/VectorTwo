"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useArbol } from "@/lib/arbol/use-arbol";
import type { Rol } from "@/lib/auth/roles";
import { ETIQUETA_AVISO_AGRUPADOR, type AvisoDetalleApi, type EntregaSinEmbarqueApi } from "@/lib/compras/agrupadores/tipos-api";
import { useOpciones, useViajes } from "@/lib/compras/agrupadores/use-agrupadores";
import { puedeImportar } from "@/lib/compras/permisos";
import type { CompraApi, EntregaLineaApi, LineaCompraApi, RecepcionLineaApi } from "@/lib/compras/tipos-api";
import { quitarIngreso, useAccion, useCompra, useCompras, useMarcas, useProveedores } from "@/lib/compras/use-compras";
import { NOMBRE_ARCHIVO_COMPRAS } from "@/lib/flujo/excel";
import { useHuecos } from "@/lib/flujo/use-flujo";
import { plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { BarraViajeActiva } from "@/components/compras/agrupadores/barra-viaje-activo";
import { DialogoAsignar } from "@/components/compras/agrupadores/dialogo-asignar";
import { mensajeDeMovimiento } from "@/components/compras/agrupadores/detalle-embarque";
import { useViajeActivo } from "@/components/compras/agrupadores/use-viaje-activo";
import { textoAvisoDetalle, viajeParaApi } from "@/components/compras/agrupadores/vista-agrupadores";
import { textoErrorAccion } from "@/components/compras/agrupadores/vista-errores";
import { AvisoPorConfirmar } from "@/components/compras/aviso-por-confirmar";
import { BarraFiltrosCompras } from "@/components/compras/barra-filtros-compras";
import { descargarCompras } from "@/components/compras/descarga";
import { DetalleCompra } from "@/components/compras/detalle-compra";
import { DialogoCancelar } from "@/components/compras/dialogo-cancelar";
import { DialogoIngreso } from "@/components/compras/dialogo-ingreso";
import { DialogoViajeCompra } from "@/components/compras/dialogo-viaje-compra";
import { fechaLima } from "@/components/compras/formato";
import { ImportarCompras } from "@/components/compras/importar-compras";
import { ListaCompras } from "@/components/compras/lista-compras";
import { consultaCompras, filtrarCompras, filtrosCompras, hayFiltrosCompras, leerParametrosCompras, textoConfirmarQuitar, type ParametrosCompras } from "@/components/compras/vista-compras";
import { opcionesEmbarqueFiltro } from "@/components/compras/vista-agrupadores-compras";
import { nodosDeArbol, opcionesArbol } from "@/components/compras/vista-flujo";

type Dialogo =
  | { tipo: "ingreso"; linea: LineaCompraApi; numero: number; entrega: EntregaLineaApi | null }
  | { tipo: "cancelar" }
  | { tipo: "viaje" }
  | { tipo: "embarque"; entregas: EntregaSinEmbarqueApi[] }
  | null;
type Mensaje = { tono: "exito" | "info" | "alerta"; texto: string; avisos?: string[] };

const textoAvisos = (avisos: readonly AvisoDetalleApi[]) => avisos.map((a) => textoAvisoDetalle(a, ETIQUETA_AVISO_AGRUPADOR));

/**
 * Pantalla /compras/registro (Compras, M8; ficha 08 §4.4 y §4.7). En `0.13.0` es la lista y el detalle de las compras (cabecera, líneas,
 * entregas con su pendiente, ingresos confirmados e historial) más las acciones de admin y planner: **Importar** la carga inicial,
 * **Confirmar ingreso** (por línea o por entrega, en el mes en que llegó), **Quitar** un ingreso y **Cancelar** (con ingresos, cierra el
 * saldo). Todos los roles leen; los botones de escritura se ocultan al comprador y la API los exige con `requirePlanner`. Los filtros y
 * la compra abierta viven en la URL. Arriba, el aviso «Por confirmar» y el filtro del mismo nombre.
 *
 * Ficha 08b (T4): la lista se filtra con el **viaje activo** (barra de arriba; preferencia por navegador en una cookie, nunca un permiso:
 * llega a la API como `viaje_id` explícito) y con el filtro de embarque; muestra el viaje y los embarques de cada compra; y el detalle deja
 * cambiar el viaje y asignar entregas a un embarque. Eso lo hacen los TRES roles (decisión 92). **Importar** también: el importador normal
 * es de los tres roles; la carga inicial, solo de admin y planner (`puedeImportar`).
 */
export function RegistroPanel({ rol, perfilId, viajeActivoInicial }: { rol: Rol; perfilId: string; viajeActivoInicial: string | null }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const parametros = leerParametrosCompras((k) => search.get(k));
  const puedeEscribir = rol === "admin" || rol === "planner";
  const puedeImportarCompras = puedeImportar(rol, false);

  const enLista = !parametros.importar && parametros.compra === null;
  // Viajes y opciones (viajes, embarques) para la barra del viaje activo, el filtro de embarque y los diálogos; el importador no los usa.
  const usaAgrupadores = !parametros.importar;
  const viajes = useViajes(usaAgrupadores);
  const opcionesAgrupadores = useOpciones(usaAgrupadores);
  const activo = useViajeActivo({ inicial: viajeActivoInicial, viajes: viajes.datos?.viajes ?? null, perfilId });
  // La lista espera a saber el viaje activo (la cookie, o los viajes para el valor por defecto) para no pedir primero todo y luego lo filtrado;
  // si los viajes no cargan, el error se muestra y la lista sigue con «Todos».
  const viajeActivoListo = activo.listo || viajes.error !== null || !usaAgrupadores;
  const compras = useCompras(viajeActivoListo ? { ...filtrosCompras(parametros), viaje_id: usaAgrupadores ? viajeParaApi(activo.valor) : undefined } : null);
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
  const errorCarga = compras.error ?? detalle.error ?? proveedores.error ?? cabecera.error ?? arbol.error ?? marcas.error ?? viajes.error ?? opcionesAgrupadores.error;
  const limpiarErrores = () => {
    viajes.setError(null);
    opcionesAgrupadores.setError(null);
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
  const opcionesEmbarque = opcionesEmbarqueFiltro(opcionesAgrupadores.datos?.embarques ?? [], parametros.embarque);

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
  const viajeActivoFiltra = usaAgrupadores && activo.valor !== "todos";
  const textoVacio =
    viajeActivoFiltra && compras.datos.length === 0 && !hayFiltrosCompras(parametros)
      ? "Ninguna compra en el viaje activo. Cambia el viaje arriba o elige «Todos los viajes»."
      : viajeActivoFiltra
        ? "Ninguna compra con estos filtros en el viaje activo."
        : undefined;

  // ── Importar ──
  if (parametros.importar && puedeImportarCompras) {
    return (
      <div className="space-y-5">
        <Link href={href({ importar: false })} className="inline-flex h-8 items-center rounded-md border border-borde bg-superficie px-3 text-sm font-medium text-tinta hover:bg-neutro-suave">
          ← Volver a Compras
        </Link>
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Importar compras</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Carga compras desde una plantilla Excel o CSV, con su viaje y su embarque si ya los conoces. Es seguro repetir la carga: cada línea se reconoce por proveedor, referencia y número
            de línea, y lo que ya existe no se duplica.
          </p>
        </div>
        <ImportarCompras
          puedeCargaInicial={puedeImportar(rol, true)}
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
        {mensaje && <AlertaMensaje mensaje={mensaje} onCerrar={() => setMensaje(null)} />}
        {errorCarga && <Alert onCerrar={limpiarErrores}>{errorCarga}</Alert>}
        {accion.error && <Alert onCerrar={accion.limpiar}>{accion.error.mensaje}</Alert>}
        {detalle.cargando && !compraAbierta && <p className="py-8 text-center text-sm text-tinta-suave">Cargando la compra…</p>}
        {compraAbierta && (
          <DetalleCompra
            compra={compraAbierta}
            puedeEscribir={puedeEscribir}
            ocupado={accion.ocupado}
            hoy={hoyFecha}
            onRecargar={recargarTodo}
            onOcLimpiarMensaje={() => setMensaje(null)}
            onOcGuardada={async (texto, avisos) => {
              setMensaje({ tono: avisos.length > 0 ? "info" : "exito", texto, avisos: avisos.map((a) => a.detalle) });
              await recargarTodo();
            }}
            onConfirmarIngreso={(linea, numero, entrega) => setDialogo({ tipo: "ingreso", linea, numero, entrega })}
            onQuitarIngreso={(linea, numero, r) => void quitar(compraAbierta, linea, numero, r)}
            onCancelar={() => setDialogo({ tipo: "cancelar" })}
            onCambiarViaje={() => setDialogo({ tipo: "viaje" })}
            onAsignarEmbarque={(entregas) => setDialogo({ tipo: "embarque", entregas })}
          />
        )}
        {compraAbierta && dialogo?.tipo === "viaje" && (
          <DialogoViajeCompra
            compra={compraAbierta}
            viajes={opcionesAgrupadores.datos?.viajes ?? []}
            onRecargar={recargarTodo}
            onCerrar={() => setDialogo(null)}
            onHecho={async (texto, avisos) => {
              setDialogo(null);
              setMensaje({ tono: avisos.length > 0 ? "info" : "exito", texto, avisos: textoAvisos(avisos) });
              await recargarTodo();
            }}
          />
        )}
        {compraAbierta && dialogo?.tipo === "embarque" && (
          <DialogoAsignar
            modo={{ tipo: "entregas", entregas: dialogo.entregas }}
            opciones={opcionesAgrupadores.datos}
            viajes={opcionesAgrupadores.datos?.viajes ?? []}
            onRecargar={recargarTodo}
            onCerrar={() => setDialogo(null)}
            onAplicado={async (r) => {
              setDialogo(null);
              setMensaje(mensajeDeMovimiento(`Mercadería asignada al embarque ${r.embarque.codigo}.`, r));
              await recargarTodo();
            }}
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
          {puedeImportarCompras && (
            <Button onClick={() => irA({ ...parametros, importar: true, compra: null }, "push")}>Importar compras</Button>
          )}
        </div>
      </div>

      {mensaje && <AlertaMensaje mensaje={mensaje} onCerrar={() => setMensaje(null)} />}
      {errorCarga && <Alert onCerrar={limpiarErrores}>{errorCarga}</Alert>}
      {accion.error && <Alert onCerrar={accion.limpiar}>{accion.error.mensaje}</Alert>}

      <BarraViajeActiva
        valor={activo.valor}
        viajes={opcionesAgrupadores.datos?.viajes ?? viajes.datos?.viajes ?? []}
        onCambiar={(id) => void activo.cambiar(id)}
        ocupado={activo.ocupado}
        error={activo.error ? textoErrorAccion(activo.error) : null}
        onCerrarError={activo.limpiarError}
      />

      {datosFlujo && <AvisoPorConfirmar resumen={datosFlujo.por_confirmar} mes={datosFlujo.periodos[1]} onRevisar={() => cambiar({ porConfirmar: true })} />}

      <div className="space-y-3">
        <BarraFiltrosCompras
          parametros={parametros}
          proveedores={opcionesProveedor}
          generos={opciones.generos}
          mundos={opciones.mundos}
          lineas={opciones.lineas}
          marcas={opcionesMarca}
          embarques={opcionesEmbarque}
          onCambiar={cambiar}
        />
        <p className="text-xs text-tinta-suave" aria-live="polite">
          {plural(visibles.length, "compra", "compras")}
          {visibles.length !== compras.datos.length ? ` de ${compras.datos.length}` : ""}
          {compras.cargando && compras.datos.length > 0 ? " · actualizando…" : ""}
        </p>
      </div>

      <ListaCompras compras={visibles} enlace={(c) => href({ compra: c.id })} cargando={(compras.cargando || !viajeActivoListo) && compras.datos.length === 0} vacio={textoVacio} hoy={hoyFecha} />
    </div>
  );
}

/** El aviso de lo último que se hizo; los avisos de la API (ninguno bloquea) se listan debajo. */
function AlertaMensaje({ mensaje, onCerrar }: { mensaje: Mensaje; onCerrar: () => void }) {
  return (
    <Alert tono={mensaje.tono} onCerrar={onCerrar}>
      {mensaje.texto}
      {mensaje.avisos && mensaje.avisos.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
          {mensaje.avisos.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
    </Alert>
  );
}
