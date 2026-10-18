"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useArbol } from "@/lib/arbol/use-arbol";
import { useColeccion } from "@/lib/use-coleccion";
import type { ReglaIntercompanyApi } from "@/lib/intercompany/tipos-api";
import type { MarcaFila } from "@/lib/marcas/tipos-api";
import { esMarcaGenerica } from "@/components/marcas/comunes-m2b";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { BarraFiltros } from "./barra-filtros";
import { RUTA_MARCAS, RUTA_PROYECCION, enlaceMarca } from "./comunes";
import { DialogoRegla, type ModoDialogo } from "./dialogo-regla";
import { PestanaHistorial } from "./pestana-historial";
import { PestanaReglas } from "./pestana-reglas";
import { useReglas } from "./use-intercompany";
import {
  consultaVista,
  filtrarReglas,
  filtrosEfectivos,
  indiceNodos,
  leerParametros,
  mesDe,
  mesDeApi,
  nodosDelArbol,
  opcionesMarca,
  parametrosTrasGuardar,
  textosAvisos,
  type Pestana,
  type ParametrosVista,
} from "./vista";

/**
 * Pantalla /maestros/intercompany (M13, ficha 13 sección 4): las reglas de intercompany por marca × GML con su vigencia por mes
 * (pestaña Reglas) y la secuencia de cada clave con editar y eliminar (pestaña Historial). La pestaña, el mes y los filtros viven en
 * la URL (`?pestana=&marca=&genero=&mundo=&linea=&mes=&solo=`): recargar o compartir el enlace reabre lo mismo. Se maneja con la API
 * de historial del navegador, que Next integra con `useSearchParams` (patrón de M12). Solo admin y planner. El sistema muestra y
 * valida; el rango, el porcentaje y la fecha los decide el planner.
 */
export function IntercompanyPanel() {
  const search = useSearchParams();
  const pathname = usePathname();
  const parametros = leerParametros((k) => search.get(k));
  // El mes en curso se fija al montar: el reloj no se lee en cada render.
  const [hoy] = useState(() => mesDe(new Date()));
  const mes = parametros.mes ?? hoy;

  const vigentes = useReglas(mes, false);
  const historial = useReglas(mes, true);
  const arbol = useArbol(true);
  const marcas = useColeccion<MarcaFila>("/api/marcas");

  const [dialogo, setDialogo] = useState<ModoDialogo | null>(null);
  const [aviso, setAviso] = useState<{ tono: "exito" | "info" | "alerta"; mensaje: string; atajo?: ReglaIntercompanyApi } | null>(null);

  const irA = useCallback(
    (siguiente: ParametrosVista, modo: "push" | "replace") => {
      const q = consultaVista(siguiente);
      const url = q === "" ? pathname : `${pathname}?${q}`;
      if (modo === "push") window.history.pushState(null, "", url);
      else window.history.replaceState(null, "", url);
    },
    [pathname]
  );
  const cambiar = (c: Partial<ParametrosVista>) => irA({ ...parametros, ...c }, "replace");
  const cambiarPestana = (p: Pestana) => irA({ ...parametros, pestana: p }, "push");

  const nodos = useMemo(() => nodosDelArbol(arbol.arbol), [arbol.arbol]);
  const indice = useMemo(() => indiceNodos(nodos), [nodos]);
  const filtros = useMemo(() => filtrosEfectivos(parametros, nodos), [parametros, nodos]);
  const todas = useMemo(() => historial.datos ?? [], [historial.datos]);
  const opcionesDeMarca = useMemo(() => opcionesMarca(marcas.datos, esMarcaGenerica), [marcas.datos]);
  // Las marcas del filtro son las que ya tienen alguna regla (la lista de marcas intercompany se deriva de las reglas).
  const marcasConRegla = useMemo(() => [...new Map(todas.map((r) => [r.marca_id, r.marca])).entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [todas]);
  const mesesConReglas = useMemo(() => todas.map((r) => mesDeApi(r.vigente_desde)), [todas]);

  const vigentesFiltradas = useMemo(() => filtrarReglas(vigentes.datos ?? [], filtros, indice), [vigentes.datos, filtros, indice]);
  const historialFiltrado = useMemo(() => filtrarReglas(todas, filtros, indice), [todas, filtros, indice]);

  const errorCarga = vigentes.error ?? historial.error ?? arbol.error ?? marcas.error;
  const cargando = (vigentes.cargando && !vigentes.datos) || arbol.cargando || (historial.cargando && !historial.datos);

  async function recargar() {
    await Promise.all([vigentes.recargar(), historial.recargar()]);
  }

  async function guardada(r: ReglaIntercompanyApi, accion: string) {
    setDialogo(null);
    // El diálogo propone otro mes (el siguiente a hoy o a la última regla de la clave): la pantalla pasa a ese mes, en la URL, para que la regla guardada se vea.
    irA(parametrosTrasGuardar(parametros, r.vigente_desde, hoy), "replace");
    const avisos = textosAvisos(r.avisos);
    const sinClave = r.aplicable === false;
    setAviso({
      tono: sinClave ? "alerta" : "exito",
      mensaje: `${accion}: ${r.marca} en ${r.ruta}, desde ${r.vigente_desde}.${avisos.length ? ` ${avisos.join(" ")}` : ""}${sinClave ? " Quedó no aplicable: la marca no tiene venta propia en ese GML en la proyección cerrada." : ""}`,
      atajo: sinClave ? r : undefined,
    });
    await recargar();
  }

  const sinReglas = !cargando && todas.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h1 className="text-2xl font-semibold">Intercompany</h1>
          <p className="mt-1 text-sm text-tinta-suave">
            Parte de la venta de JOHN HOLDEN, DONATELLI y VAN HEUSEN llega directo del intercompany por compras regulares. Aquí defines, por marca y GML y desde qué mes, qué parte llega
            directo y qué rango de meses de inventario (IMI, 4–8 por defecto) debe tener la marca. El flujo la trata aparte, con su demanda y su stock completos: no se resta nada.
            Tú decides los números; el sistema solo avisa si una regla no se puede aplicar.
          </p>
        </div>
        <Button onClick={() => setDialogo({ tipo: "nueva" })}>+ Nueva regla</Button>
      </div>

      {aviso && (
        <Alert tono={aviso.tono} onCerrar={() => setAviso(null)}>
          {aviso.mensaje}
          {aviso.atajo && (
            <>
              {" "}
              <Link href={enlaceMarca(aviso.atajo.marca_id)} className="underline underline-offset-2">
                Marcarla relevante en el GML
              </Link>{" "}
              ·{" "}
              <Link href={RUTA_PROYECCION} className="underline underline-offset-2">
                Cerrar una proyección 0.10.1
              </Link>
            </>
          )}
        </Alert>
      )}
      {errorCarga && (
        <Alert
          onCerrar={() => {
            vigentes.setError(null);
            historial.setError(null);
            arbol.setError(null);
            marcas.setError(null);
          }}
        >
          {errorCarga}
        </Alert>
      )}

      <BarraFiltros parametros={parametros} mes={mes} hoy={hoy} nodos={nodos} marcas={marcasConRegla} mesesConReglas={mesesConReglas} onCambiar={cambiar} />

      <Tabs
        activa={parametros.pestana}
        onCambiar={cambiarPestana}
        items={[
          { id: "reglas", label: "Reglas" },
          { id: "historial", label: "Historial" },
        ]}
      />

      {parametros.pestana === "reglas" ? (
        <PestanaReglas
          reglas={vigentesFiltradas}
          mes={mes}
          cargando={cargando}
          sinReglas={sinReglas}
          vigentesEnMes={vigentes.datos?.length ?? 0}
          parametros={parametros}
          nodos={nodos}
          marcas={marcasConRegla}
          onNueva={() => setDialogo({ tipo: "nueva" })}
          onNuevaVigencia={(base) => setDialogo({ tipo: "vigencia", base })}
          onVerHistorial={(r) => irA({ ...parametros, pestana: "historial", marca: r.marca_id }, "push")}
        />
      ) : (
        <PestanaHistorial
          reglas={historialFiltrado}
          todas={todas}
          mes={mes}
          cargando={cargando}
          onEditar={(regla) => setDialogo({ tipo: "editar", regla })}
          onNuevaVigencia={(base) => setDialogo({ tipo: "vigencia", base })}
          onEliminada={async (r) => {
            setAviso({ tono: "exito", mensaje: `Regla eliminada: ${r.marca} en ${r.ruta}, desde ${r.vigente_desde}.` });
            await recargar();
          }}
        />
      )}

      <p className="text-xs text-tinta-suave">
        ¿La marca no aparece al crear una regla? Revisa que esté cargada y vigente en{" "}
        <Link href={RUTA_MARCAS} className="underline underline-offset-2">
          Agrupaciones y marcas
        </Link>
        .
      </p>

      {dialogo && (
        <DialogoRegla
          modo={dialogo}
          marcas={opcionesDeMarca}
          nodos={nodos}
          reglas={todas}
          hoy={hoy}
          onGuardada={(r) => void guardada(r, dialogo.tipo === "editar" ? "Regla actualizada" : dialogo.tipo === "vigencia" ? "Nueva vigencia guardada" : "Regla creada")}
          onCerrar={() => setDialogo(null)}
        />
      )}
    </div>
  );
}
