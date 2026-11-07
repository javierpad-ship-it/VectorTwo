"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { Rol } from "@/lib/auth/roles";
import { useViajes } from "@/lib/compras/agrupadores/use-agrupadores";
import { useLectura } from "@/app/(app)/planificacion/proyeccion/use-proyeccion";
import { ESTADOS_COMPRA, ORIGENES_COMPRA } from "@/lib/compras/tipos";
import { ETIQUETA_ESTADO_COMPRA, ETIQUETA_ORIGEN_COMPRA } from "@/lib/compras/tipos-api";
import type { FotosModuloApi } from "@/lib/fotos/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChipFiltro } from "@/components/ui/chip-filtro";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Select } from "@/components/ui/form";
import { BarraViajeActiva } from "@/components/compras/agrupadores/barra-viaje-activo";
import { useViajeActivo } from "@/components/compras/agrupadores/use-viaje-activo";
import { VIAJE_TODOS } from "@/components/compras/agrupadores/vista-agrupadores";
import { textoErrorAccion } from "@/components/compras/agrupadores/vista-errores";
import { LimpiezaHuerfanas } from "@/components/fotos/limpieza-huerfanas";
import { TarjetaLineaFotos } from "@/components/fotos/tarjeta-linea-fotos";
import {
  ajustarContadores,
  consultaFotos,
  etiquetaProveedorFotos,
  hayFiltrosFotos,
  leerParametrosFotos,
  paginacion,
  POR_PAGINA_FOTOS,
  textoContador,
  textoPaginacion,
  textoSinLineas,
  urlFotosModulo,
  type ParametrosFotos,
} from "@/components/fotos/vista-fotos";

/**
 * Pantalla /compras/fotos (Compras → Fotos, ficha 08c §4.3), pensada para el celular: la barra del viaje activo, los filtros (proveedor,
 * origen, estado, «Solo sin foto» y búsqueda), el contador «8 de 12 líneas con foto» y una tarjeta por línea con sus fotos. Los tres roles
 * ven y escriben (subir, quitar, descripción y modelo); lo que cada tarjeta permite lo dice la API en `puede`. Solo el admin ve el menú «…»
 * con «Limpiar fotos huérfanas». Los filtros viven en la URL; el viaje activo es una preferencia del navegador que viaja SIEMPRE como
 * `viaje_id` explícito (la API no lee la cookie). Al subir o quitar fotos la lista no se vuelve a pedir: los contadores se corrigen en el
 * sitio (`ajustarContadores`) para que la tarjeta no desaparezca bajo «Solo sin foto» a mitad de trabajo; [Actualizar] relee todo.
 */
export function FotosPanel({ rol, perfilId, viajeActivoInicial }: { rol: Rol; perfilId: string; viajeActivoInicial: string | null }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const parametros = leerParametrosFotos((k) => search.get(k));
  const esAdmin = rol === "admin";

  const viajes = useViajes(true);
  const activo = useViajeActivo({ inicial: viajeActivoInicial, viajes: viajes.datos?.viajes ?? null, perfilId });
  // Espera a saber el viaje activo (cookie, o los viajes para el valor por defecto) para no pedir primero todo y luego lo filtrado; si los
  // viajes no cargan, se muestra el error y la lista sigue con «Todos los viajes».
  const viajeListo = activo.listo || viajes.error !== null;
  const viaje = viajeListo ? activo.valor : null;
  const url = viaje === null ? null : urlFotosModulo(parametros, viaje);
  const lectura = useLectura<FotosModuloApi>(url, true);
  const datos = lectura.datos;

  const [limpiando, setLimpiando] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [masFiltros, setMasFiltros] = useState(false);
  // Fotos que tiene AHORA cada línea de la página, solo de las que cambiaron; se descarta al llegar datos nuevos (la referencia cambia).
  const [conteosDe, setConteosDe] = useState<{ datos: FotosModuloApi | null; mapa: Record<string, number> }>({ datos: null, mapa: {} });
  const conteos = conteosDe.datos === datos ? conteosDe.mapa : SIN_CONTEOS;
  const ajustados = useMemo(() => (datos ? ajustarContadores(datos, conteos) : null), [datos, conteos]);

  const irA = (siguiente: ParametrosFotos) => {
    const q = consultaFotos(siguiente);
    window.history.replaceState(null, "", q === "" ? pathname : `${pathname}?${q}`);
  };
  // Cualquier cambio de filtro vuelve a la primera página.
  const cambiar = (c: Partial<ParametrosFotos>) => irA({ ...parametros, pagina: 1, ...c });

  // La búsqueda de texto espera a que se deje de escribir; el resto de filtros aplica al instante.
  const [texto, setTexto] = useState(parametros.q);
  const [qUrl, setQUrl] = useState(parametros.q);
  if (qUrl !== parametros.q) {
    // La URL cambió por fuera (atrás/adelante): el cuadro la sigue.
    setQUrl(parametros.q);
    setTexto(parametros.q);
  }
  useEffect(() => {
    if (texto === parametros.q) return;
    const t = setTimeout(() => cambiar({ q: texto }), 350);
    return () => clearTimeout(t);
    // `cambiar` se recrea en cada render; solo importa reaccionar al texto escrito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [texto]);

  const pag = paginacion(datos?.total ?? 0, parametros.pagina, datos?.por_pagina ?? POR_PAGINA_FOTOS);
  const viajeFiltra = viaje !== null && viaje !== VIAJE_TODOS;
  const filtrado = hayFiltrosFotos(parametros);
  const errorCarga = lectura.error ?? viajes.error;
  const vacio = textoSinLineas(filtrado, viajeFiltra, parametros.soloSinFoto);
  const proveedores = ajustados?.por_proveedor ?? [];
  const proveedorAusente = parametros.proveedor !== null && !proveedores.some((p) => p.id === parametros.proveedor);

  const secundariosActivos = (parametros.origen ? 1 : 0) + (parametros.estado ? 1 : 0);
  const selectoresSecundarios = (
    <>
      <Field label="Origen">
        <Select value={parametros.origen ?? ""} onChange={(e) => cambiar({ origen: (e.target.value || null) as ParametrosFotos["origen"] })}>
          <option value="">Todos</option>
          {ORIGENES_COMPRA.map((o) => (
            <option key={o} value={o}>
              {ETIQUETA_ORIGEN_COMPRA[o]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Estado de la compra">
        <Select value={parametros.estado ?? ""} onChange={(e) => cambiar({ estado: (e.target.value || null) as ParametrosFotos["estado"] })}>
          <option value="">Sin canceladas</option>
          {ESTADOS_COMPRA.map((s) => (
            <option key={s} value={s}>
              {s === "cancelada" ? "Canceladas" : ETIQUETA_ESTADO_COMPRA[s]}
            </option>
          ))}
        </Select>
      </Field>
    </>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 max-w-3xl">
          <h1 className="text-2xl font-semibold">Fotos de las compras</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Toma o elige hasta 3 fotos por línea; se reducen en tu celular antes de subirse. También puedes completar la descripción y el modelo.
          </p>
        </div>
        {esAdmin && (
          <div
            className="relative shrink-0"
            onKeyDown={(e) => {
              if (e.key === "Escape") setMenuAbierto(false);
            }}
          >
            <Button variante="secundario" className="h-11! w-11! px-0!" aria-haspopup="menu" aria-expanded={menuAbierto} aria-label="Más acciones" onClick={() => setMenuAbierto((v) => !v)}>
              <span aria-hidden="true" className="text-lg leading-none">
                …
              </span>
            </Button>
            {menuAbierto && (
              <div role="menu" className="absolute right-0 z-20 mt-1 w-64 rounded-lg border border-borde bg-superficie p-1 shadow-lg">
                <button
                  type="button"
                  role="menuitem"
                  className="flex h-11 w-full items-center rounded-md px-3 text-left text-sm text-tinta hover:bg-neutro-suave focus-visible:outline-2 focus-visible:outline-marca"
                  onClick={() => {
                    setMenuAbierto(false);
                    setLimpiando(true);
                  }}
                >
                  Limpiar fotos huérfanas
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {errorCarga && (
        <Alert
          onCerrar={() => {
            lectura.setError(null);
            viajes.setError(null);
          }}
        >
          {errorCarga}
        </Alert>
      )}

      <BarraViajeActiva
        valor={activo.valor}
        viajes={viajes.datos?.viajes ?? []}
        onCambiar={(id) => void activo.cambiar(id).then((ok) => ok && cambiar({}))}
        ocupado={activo.ocupado}
        error={activo.error ? textoErrorAccion(activo.error) : null}
        onCerrarError={activo.limpiarError}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Field label="Proveedor" className="md:col-span-2">
          <Select value={parametros.proveedor ?? ""} onChange={(e) => cambiar({ proveedor: e.target.value || null })}>
            <option value="">Todos los proveedores</option>
            {proveedorAusente && <option value={parametros.proveedor ?? ""}>Proveedor elegido (sin líneas con estos filtros)</option>}
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {etiquetaProveedorFotos(p)}
              </option>
            ))}
          </Select>
        </Field>
        {/* Origen y estado: en pantallas anchas, en la misma fila; en el celular, plegados en «Más filtros» para que las tarjetas queden a la vista. */}
        <div className="hidden md:contents">{selectoresSecundarios}</div>
        <Field label="Buscar" className="md:col-span-4">
          <Input type="search" value={texto} maxLength={100} onChange={(e) => setTexto(e.target.value)} placeholder="Descripción, modelo, marca o compra" className="h-11! md:h-10!" />
        </Field>
        <details className="rounded-lg border border-borde bg-superficie px-3 py-2 md:hidden" open={masFiltros} onToggle={(e) => setMasFiltros(e.currentTarget.open)}>
          <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between text-sm font-medium text-tinta">
            <span>Más filtros{secundariosActivos > 0 ? ` (${secundariosActivos})` : ""}</span>
            <span aria-hidden="true" className="text-tinta-suave">
              {masFiltros ? "▴" : "▾"}
            </span>
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-3 pb-1">{selectoresSecundarios}</div>
        </details>
      </div>

      {/* Cabecera fija: el contador y «Solo sin foto» se quedan a la vista mientras se recorren las tarjetas. */}
      <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-borde bg-fondo px-1 py-2">
        <p className="text-sm font-medium text-tinta" aria-live="polite">
          {ajustados ? textoContador(ajustados.contadores) : lectura.cargando ? "Cargando…" : "—"}
          {lectura.cargando && datos ? <span className="font-normal text-tinta-suave"> · actualizando…</span> : null}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <ChipFiltro activo={parametros.soloSinFoto} onCambiar={(v) => cambiar({ soloSinFoto: v })}>
            Solo sin foto
          </ChipFiltro>
          <Button variante="fantasma" className="h-11! md:h-9!" onClick={() => void lectura.recargar()} disabled={lectura.cargando} title="Vuelve a leer las líneas y los contadores">
            Actualizar
          </Button>
        </div>
      </div>

      {datos && datos.lineas.length === 0 && !lectura.cargando && <EmptyState titulo={vacio.titulo} detalle={vacio.detalle} />}
      {!datos && lectura.cargando && <p className="py-8 text-center text-sm text-tinta-suave">Cargando las líneas…</p>}

      {datos && datos.lineas.length > 0 && (
        <>
          <ul className="grid gap-4 lg:grid-cols-2">
            {datos.lineas.map((l) => (
              <li key={l.linea.id}>
                <TarjetaLineaFotos
                  item={l}
                  esAdmin={esAdmin}
                  onCambio={(lineaId, cantidad) => setConteosDe((previo) => ({ datos, mapa: { ...(previo.datos === datos ? previo.mapa : {}), [lineaId]: cantidad } }))}
                />
              </li>
            ))}
          </ul>

          <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <p className="text-sm text-tinta-suave">{textoPaginacion(pag, datos.total)}</p>
            <div className="flex gap-2">
              <Button variante="secundario" className="h-11! px-5!" disabled={!pag.hayAnterior || lectura.cargando} onClick={() => irA({ ...parametros, pagina: pag.pagina - 1 })}>
                Anterior
              </Button>
              <Button variante="secundario" className="h-11! px-5!" disabled={!pag.haySiguiente || lectura.cargando} onClick={() => irA({ ...parametros, pagina: pag.pagina + 1 })}>
                Siguiente
              </Button>
            </div>
          </nav>
        </>
      )}

      {limpiando && <LimpiezaHuerfanas onCerrar={() => setLimpiando(false)} />}
    </div>
  );
}

const SIN_CONTEOS: Record<string, number> = {};
