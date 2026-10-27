"use client";

import { useMemo, useState } from "react";
import type { ListaGeneroMundoApi } from "@/lib/crecimientos/tipos-api";
import { CLAVE_RESTO } from "@/lib/crecimientos/tipos-api";
import { Alert } from "@/components/ui/alert";
import { useRecurso } from "../use-recurso";
import { DetalleGM } from "./detalle-gm";
import { ListaGM } from "./lista-gm";
import { consultaApiGM, enTrabajoDe, type FiltroEstadoGM } from "./vista";

/** Qué pide la pantalla: el año de aplicación y la proyección de referencia (`null` = la que elige el servidor). */
export type ConsultaGM = { anio: number | null; proyeccion: string | null };

/** Adónde va la URL: la lista (`gm = null`) o el detalle de un GM; siempre con el año y la proyección. */
export type DestinoGM = { gm: string | null; anio: number | null; proyeccion: string | null };

/**
 * Pestaña «Crecimiento por género × mundo» (06d, §4.1): la lista de GM y, al «Trabajar» uno (o el Resto), su detalle.
 * La clave abierta (`?gm=`), el año y la proyección viven en la URL (M10): recargar o compartir reabre lo mismo.
 * `consulta` inicial sale de la URL; un cambio de año o de proyección vuelve a montar el contenido (una sola carga limpia).
 * Solo admin y planner (la página y la API lo exigen).
 */
export function GeneroMundoTab({
  gm,
  anioUrl,
  proyeccionUrl,
  onIr,
}: {
  gm: string | null;
  anioUrl: number | null;
  proyeccionUrl: string | null;
  onIr: (destino: DestinoGM, modo: "push" | "replace") => void;
}) {
  const [consulta, setConsulta] = useState<ConsultaGM>({ anio: anioUrl, proyeccion: proyeccionUrl });
  const [estado, setEstado] = useState<FiltroEstadoGM>("todos");
  const [genero, setGenero] = useState("");

  return (
    <GeneroMundoContenido
      key={`${consulta.anio ?? "auto"}|${consulta.proyeccion ?? "auto"}`}
      consulta={consulta}
      gm={gm}
      estado={estado}
      onEstado={setEstado}
      genero={genero}
      onGenero={setGenero}
      onIr={onIr}
      onConsulta={(c) => {
        setConsulta(c);
        onIr({ gm: null, anio: c.anio, proyeccion: c.proyeccion }, "replace");
      }}
    />
  );
}

function GeneroMundoContenido({
  consulta,
  gm,
  estado,
  onEstado,
  genero,
  onGenero,
  onIr,
  onConsulta,
}: {
  consulta: ConsultaGM;
  gm: string | null;
  estado: FiltroEstadoGM;
  onEstado: (e: FiltroEstadoGM) => void;
  genero: string;
  onGenero: (g: string) => void;
  onIr: (destino: DestinoGM, modo: "push" | "replace") => void;
  onConsulta: (c: ConsultaGM) => void;
}) {
  const recurso = useRecurso<ListaGeneroMundoApi>(`/api/curvas/genero-mundo${consultaApiGM(consulta)}`);
  const lista = recurso.datos;
  const anio = lista?.anio_aplicacion ?? consulta.anio;
  const proyeccion = lista?.proyeccion_referencia?.id ?? consulta.proyeccion;
  const enTrabajo = useMemo(() => (lista ? enTrabajoDe(lista) : null), [lista]);

  const ir = (clave: string | null, modo: "push" | "replace" = "push") => onIr({ gm: clave, anio, proyeccion }, modo);

  return (
    <div className="space-y-6">
      {recurso.error && <Alert onCerrar={() => recurso.setError(null)}>No se pudo leer el crecimiento por género × mundo: {recurso.error}</Alert>}

      {gm ? (
        <DetalleGM
          key={gm}
          clave={gm}
          anioUrl={consulta.anio}
          proyeccionUrl={consulta.proyeccion}
          proyeccionId={proyeccion}
          enTrabajo={enTrabajo}
          referenciaCargando={recurso.cargando && lista === null}
          onVolver={() => ir(null)}
          onIrAResto={() => ir(CLAVE_RESTO)}
          onCambio={recurso.recargar}
        />
      ) : (
        <ListaGM
          lista={lista}
          cargando={recurso.cargando}
          estado={estado}
          onEstado={onEstado}
          genero={genero}
          onGenero={onGenero}
          onAnio={(a) => onConsulta({ anio: a, proyeccion: null })}
          onProyeccion={(id) => onConsulta({ anio: anio, proyeccion: id })}
          onTrabajar={(clave) => ir(clave)}
        />
      )}
    </div>
  );
}
