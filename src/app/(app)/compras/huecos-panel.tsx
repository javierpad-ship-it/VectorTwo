"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import type { Rol } from "@/lib/auth/roles";
import { useHuecos } from "@/lib/flujo/use-flujo";
import { plural } from "@/lib/formato";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Select } from "@/components/ui/form";
import { AvisoPorConfirmar } from "@/components/compras/aviso-por-confirmar";
import { AvisosFlujo } from "@/components/compras/avisos-flujo";
import { mesLargo } from "@/components/compras/formato";
import { TarjetaHueco } from "@/components/compras/tarjeta-hueco";
import {
  alcanceEfectivo,
  claveTarjeta,
  consultaHuecos,
  contarPorEstado,
  ETIQUETA_ESTADO,
  filtrarTarjetas,
  leerParametrosHuecos,
  OPCIONES_MESES,
  opcionesHuecos,
  ORDEN_ESTADO,
  type AlcanceHuecos,
  type EstadoHuecos,
  type ParametrosHuecos,
} from "@/components/compras/vista-huecos";

/** Tarjetas que se pintan de una vez; el resto se pide con «Mostrar más» (la lista puede tener más de mil filas). */
const PAGINA = 48;

/**
 * Pantalla /compras (Huecos, M8; ficha 08 §4.2), pensada primero para el celular: una tarjeta por fila del flujo con el estado, el IMI,
 * el saldo por comprar, el stock de la cadena y lo que viene en camino. Los chips de alcance («Mis líneas» o «Todas») y de estado, y los
 * selectores de género, mundo, línea y agrupación viven en la URL y filtran en el navegador; el comprador abre en «Mis líneas» si tiene
 * combinaciones asignadas. El sistema muestra y advierte; qué hueco atacar lo decide la persona.
 */
export function HuecosPanel({ rol }: { rol: Rol }) {
  const search = useSearchParams();
  const pathname = usePathname();
  const parametros = leerParametrosHuecos((k) => search.get(k));
  const huecos = useHuecos(parametros.meses);
  const [paginado, setPaginado] = useState<{ clave: string; limite: number }>({ clave: "", limite: PAGINA });

  const irA = (siguiente: ParametrosHuecos) => {
    const q = consultaHuecos(siguiente);
    window.history.replaceState(null, "", q === "" ? pathname : `${pathname}?${q}`);
  };
  const cambiar = (c: Partial<ParametrosHuecos>) => irA({ ...parametros, ...c });

  const datos = huecos.datos?.datos ?? null;
  const tarjetas = useMemo(() => huecos.datos?.tarjetas ?? [], [huecos.datos]);
  const combinaciones = huecos.datos?.mis_combinaciones.length ?? 0;
  const alcance = alcanceEfectivo(parametros, rol, combinaciones);
  const meses = huecos.datos?.meses ?? parametros.meses ?? 6;

  const visibles = useMemo(() => filtrarTarjetas(tarjetas, parametros, alcance), [tarjetas, parametros, alcance]);
  const conteos = useMemo(() => contarPorEstado(tarjetas, parametros, alcance), [tarjetas, parametros, alcance]);
  const opciones = useMemo(() => opcionesHuecos(tarjetas, parametros), [tarjetas, parametros]);

  const claveFiltros = consultaHuecos({ ...parametros, alcance });
  const limite = paginado.clave === claveFiltros ? paginado.limite : PAGINA;
  const mostradas = visibles.slice(0, limite);

  const fichasMeses = useMemo(() => [...new Set<number>([...OPCIONES_MESES, meses])].sort((a, b) => a - b), [meses]);
  const alcances: ChipItem<AlcanceHuecos>[] = [
    { id: "mias", label: "Mis líneas" },
    { id: "todas", label: "Todas" },
  ];
  const estados: ChipItem<EstadoHuecos>[] = ORDEN_ESTADO.map((e) => ({ id: e, label: ETIQUETA_ESTADO[e], conteo: conteos[e] }));
  const hayFiltrosDeArbol = parametros.genero !== null || parametros.mundo !== null || parametros.linea !== null || parametros.agrupacion !== null;
  const cargandoInicial = huecos.cargando && !huecos.datos;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Huecos</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Qué filas necesitan compra, cuáles tienen de más y qué viene en camino. El estado es la peor señal de los próximos meses; el medidor es el IMI (meses de inventario) al
            cierre del último mes publicado, con el rango objetivo marcado. El sistema propone y avisa: tú decides qué hueco atacar.
          </p>
          {datos && (
            <p className="mt-1 text-xs text-tinta-suave">
              Datos hasta {mesLargo(datos.k_prima)} · proyección cerrada «{datos.cerrada.nombre}» · IMI objetivo {datos.parametros.imi_min}–{datos.parametros.imi_max}
            </p>
          )}
        </div>
        <Link href="/compras/flujo" className="inline-flex h-10 items-center rounded-md border border-borde bg-superficie px-4 text-sm font-medium text-tinta hover:bg-neutro-suave">
          Flujo mensual
        </Link>
      </div>

      {huecos.error && (
        <Alert onCerrar={() => huecos.setError(null)}>
          {huecos.error}
          {rol !== "comprador" && (
            <>
              {" "}
              <Link href="/planificacion/proyeccion" className="underline underline-offset-2">
                Ir a Proyección
              </Link>
            </>
          )}
        </Alert>
      )}

      {datos && <AvisosFlujo datos={datos} enlaceProyeccion={rol !== "comprador"} />}
      {datos && <AvisoPorConfirmar resumen={datos.por_confirmar} mes={datos.periodos[1]} />}

      {cargandoInicial && <p className="py-10 text-center text-sm text-tinta-suave">Cargando huecos…</p>}

      {huecos.datos && (
        <>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Chips etiqueta="Alcance" items={alcances} activo={alcance} onCambiar={(id) => cambiar({ alcance: id })} />
              <Chips etiqueta="Estado" items={estados} activo={parametros.estado} onCambiar={(id) => cambiar({ estado: id })} />
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
              <Field label="Próximos meses">
                <Select value={meses} onChange={(e) => cambiar({ meses: Number(e.target.value) })} aria-label="Meses del saldo por comprar">
                  {fichasMeses.map((n) => (
                    <option key={n} value={n}>
                      {n} {n === 1 ? "mes" : "meses"}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Género">
                <Select value={parametros.genero ?? ""} onChange={(e) => cambiar({ genero: e.target.value || null, mundo: null, linea: null })}>
                  <option value="">Todos</option>
                  {opciones.generos.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Mundo">
                <Select value={parametros.mundo ?? ""} onChange={(e) => cambiar({ mundo: e.target.value || null, linea: null })}>
                  <option value="">Todos</option>
                  {opciones.mundos.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Línea">
                <Select value={parametros.linea ?? ""} onChange={(e) => cambiar({ linea: e.target.value || null })}>
                  <option value="">Todas</option>
                  {opciones.lineas.map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Agrupación">
                <Select value={parametros.agrupacion ?? ""} onChange={(e) => cambiar({ agrupacion: e.target.value || null })}>
                  <option value="">Todas</option>
                  {opciones.agrupaciones.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-tinta-suave">
              <span aria-live="polite">
                {plural(visibles.length, "tarjeta", "tarjetas")}
                {visibles.length !== tarjetas.length ? ` de ${tarjetas.length}` : ""}
                {huecos.cargando ? " · actualizando…" : ""}
              </span>
              {(hayFiltrosDeArbol || parametros.estado !== "todos" || parametros.alcance !== null) && (
                <Button variante="fantasma" tamano="sm" onClick={() => irA({ ...parametros, genero: null, mundo: null, linea: null, agrupacion: null, estado: "todos", alcance: null })}>
                  Quitar filtros
                </Button>
              )}
            </div>
          </div>

          {tarjetas.length === 0 ? (
            <EmptyState titulo="Todavía no hay filas en el flujo" detalle="Aparecen cuando hay una proyección cerrada y stock publicado." />
          ) : visibles.length === 0 ? (
            <EmptyState
              titulo="Ninguna tarjeta con estos filtros"
              detalle={alcance === "mias" ? "«Mis líneas» muestra solo las combinaciones género-mundo de las que eres responsable; prueba con «Todas»." : "Prueba quitando algún filtro."}
            >
              {alcance === "mias" && (
                <Button variante="secundario" tamano="sm" onClick={() => cambiar({ alcance: "todas" })}>
                  Ver todas
                </Button>
              )}
            </EmptyState>
          ) : (
            <>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {mostradas.map((t) => (
                  <li key={claveTarjeta(t)}>
                    <TarjetaHueco tarjeta={t} imiMin={huecos.datos!.datos.parametros.imi_min} imiMax={huecos.datos!.datos.parametros.imi_max} periodos={huecos.datos!.datos.periodos} meses={meses} kPrima={huecos.datos!.datos.k_prima} />
                  </li>
                ))}
              </ul>
              {visibles.length > mostradas.length && (
                <div className="flex justify-center">
                  <Button variante="secundario" onClick={() => setPaginado({ clave: claveFiltros, limite: limite + PAGINA })}>
                    Mostrar más ({visibles.length - mostradas.length} restantes)
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
