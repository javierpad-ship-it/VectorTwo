"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { AprobarRepartoCuerpo, ModalidadEfectiva, RepartoApi } from "@/lib/marcas-barrer/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { alcanceParaCuerpo, filasAjustables, filasParaAprobar, hayEdiciones, SIN_AJUSTES, temporadasDe, type EstadoAjuste, type FuenteReparto } from "./ajuste";
import { BloqueEstacionalidad } from "./bloque-estacionalidad";
import { BloqueParteBarrer } from "./bloque-parte-barrer";
import { BloquePeso } from "./bloque-peso";
import { BloqueReparto, type AccionAprobar } from "./bloque-reparto";
import { CabeceraMarca } from "./cabecera-marca";
import { descargarMarca } from "./descarga";
import { useAccion, useAnalisisMarca, useRepartosMarca } from "./use-marcas-barrer";
import { VersionesReparto } from "./versiones-reparto";
import { soloFecha, type ParametrosVista } from "./vista";

/**
 * Paso 1 · Abrir una marca. Orquesta el análisis (parámetros en la URL), el estado de los ajustes (que se reinicia cuando
 * llega un análisis con otra huella: los datos cambiaron) y la única puerta de escritura del reparto: `POST …/repartos`, con
 * la huella del análisis sobre el que el planner decidió. Un `409 huella_cambiada` se explica y se ofrece volver a calcular.
 */
export function DetalleMarca({
  marcaId,
  parametros,
  onParametros,
  onVolver,
}: {
  marcaId: string;
  parametros: ParametrosVista;
  onParametros: (cambios: Partial<Pick<ParametrosVista, "ventana" | "modo" | "normalizaNino" | "alcance">>) => void;
  onVolver: (aviso?: string) => void;
}) {
  const lectura = useAnalisisMarca(marcaId, parametros);
  const repartos = useRepartosMarca(marcaId);
  const analisis = lectura.datos;
  const aprobar = useAccion();
  const [fuenteElegida, setFuenteElegida] = useState<FuenteReparto>("historico");
  const [ajuste, setAjuste] = useState<EstadoAjuste>(SIN_AJUSTES);
  const [nota, setNota] = useState("");
  const [exito, setExito] = useState<string | null>(null);
  const [huellaVista, setHuellaVista] = useState<string | null>(null);
  const [errorExcel, setErrorExcel] = useState<string | null>(null);

  // Un análisis con otra huella (otros parámetros, datos nuevos, otra aprobación) descarta lo que se estaba editando.
  if (analisis && analisis.huella !== huellaVista) {
    setHuellaVista(analisis.huella);
    setAjuste(SIN_AJUSTES);
    setNota("");
  }

  const fuente: FuenteReparto = analisis?.parametros.fuente_disponible.includes(fuenteElegida) ? fuenteElegida : "historico";
  const releyendo = lectura.cargando;

  function conAvisoDeAjustes(accion: () => void) {
    if (hayEdiciones(ajuste) && !confirm("Esto recalcula el análisis y descarta los ajustes que todavía no aprobaste. ¿Seguir?")) return;
    accion();
  }

  async function aprobarReparto() {
    if (!analisis) return;
    const cuerpo: AprobarRepartoCuerpo = {
      ventana_meses: analisis.parametros.ventana_meses,
      modo: analisis.parametros.modo,
      fuente,
      alcance: alcanceParaCuerpo(analisis.parametros.alcance),
      normaliza_nino: analisis.parametros.normaliza_nino,
      huella: analisis.huella,
      filas: filasParaAprobar(filasAjustables(analisis, fuente), temporadasDe(analisis), ajuste),
      ...(nota.trim() ? { nota: nota.trim() } : {}),
    };
    setExito(null);
    const r = await aprobar.ejecutar(() => api.post<RepartoApi>(`/api/marcas-barrer/${marcaId}/repartos`, cuerpo));
    if (r.ok) {
      setExito(`Reparto aprobado como v${r.valor.version} por ${r.valor.aprobada_por_nombre ?? "—"} el ${soloFecha(r.valor.aprobada_at)}. Es el vigente que usará el flujo.`);
      await Promise.all([lectura.recargar(), repartos.recargar()]);
    }
  }

  function modalidadCambiada(nueva: ModalidadEfectiva) {
    if (nueva === "por_gml") {
      onVolver("La marca pasó a Por GML: ya no tiene parte al barrer, así que no se analiza aquí.");
      return;
    }
    void Promise.all([lectura.recargar(), repartos.recargar()]);
  }

  async function descargar() {
    if (!analisis) return;
    setErrorExcel(null);
    try {
      await descargarMarca(analisis);
    } catch (e) {
      setErrorExcel(e instanceof Error ? e.message : "No se pudo generar el Excel.");
    }
  }

  const versiones = repartos.datos ?? [];
  const proximaVersion = Math.max(analisis?.vigente?.version ?? 0, ...versiones.map((v) => v.version)) + 1;
  const accion: AccionAprobar = {
    ocupado: aprobar.ocupado || releyendo,
    error: aprobar.error,
    proximaVersion,
    onAprobar: () => void aprobarReparto(),
    onRecalcular: () => {
      aprobar.limpiar();
      setAjuste(SIN_AJUSTES);
      void lectura.recargar();
    },
    exito,
    onCerrarExito: () => setExito(null),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variante="fantasma" onClick={() => conAvisoDeAjustes(() => onVolver())}>
          ← Marcas al barrer
        </Button>
        <div className="flex items-center gap-2">
          {releyendo && analisis && (
            <span className="text-sm text-tinta-suave" role="status">
              Actualizando…
            </span>
          )}
          <Button variante="secundario" onClick={() => void descargar()} disabled={!analisis}>
            Excel de la marca
          </Button>
        </div>
      </div>

      {lectura.error && (
        <Alert>
          No se pudo leer el análisis: {lectura.error}{" "}
          <button type="button" onClick={() => onVolver()} className="font-semibold underline">
            Volver a la lista
          </button>
        </Alert>
      )}
      {errorExcel && <Alert onCerrar={() => setErrorExcel(null)}>{errorExcel}</Alert>}

      {!analisis && !lectura.error && <p className="py-10 text-center text-sm text-tinta-suave">Cargando el análisis…</p>}
      {!analisis && lectura.error && <EmptyState titulo="No hay análisis que mostrar" detalle="La marca ya no es al barrer ni mixta, o no existe." />}

      {analisis && (
        <>
          <CabeceraMarca
            analisis={analisis}
            parametros={parametros}
            ocupado={releyendo}
            onParametros={(c) => conAvisoDeAjustes(() => onParametros(c))}
            onModalidadCambiada={modalidadCambiada}
          />
          <BloqueReparto
            analisis={analisis}
            fuente={fuente}
            onFuente={(f) =>
              conAvisoDeAjustes(() => {
                setFuenteElegida(f);
                setAjuste(SIN_AJUSTES);
              })
            }
            ajuste={ajuste}
            onAjuste={setAjuste}
            nota={nota}
            onNota={setNota}
            accion={accion}
          />
          <BloquePeso analisis={analisis} />
          <BloqueEstacionalidad analisis={analisis} />
          <BloqueParteBarrer analisis={analisis} />
          <VersionesReparto analisis={analisis} repartos={repartos.datos} cargando={repartos.cargando} error={repartos.error} />
        </>
      )}
    </div>
  );
}
