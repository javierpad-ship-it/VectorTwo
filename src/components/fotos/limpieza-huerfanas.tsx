"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { api } from "@/lib/api-client";
import type { LimpiezaFotosApi, ResultadoLimpiezaFotosApi } from "@/lib/fotos/tipos-api";
import { textoConfirmarLimpieza, textoResultadoLimpieza, textoVistaPreviaLimpieza, totalHuerfanas } from "./vista-fotos";

const URL_LIMPIAR = "/api/compras/fotos/limpiar";

type Paso = "vista" | "confirmar" | "hecho";

/**
 * «Limpiar fotos huérfanas» (solo admin; 08c, §3.3 e I3). Tres pasos en el mismo diálogo: la vista previa (`GET`, cuántos archivos sin dueño hay
 * de hace más de 24 h), la confirmación explícita («No se puede deshacer») y el resultado (`POST { confirmar: true }`). Todo error de la API
 * (incluido `502 almacen_no_disponible`) se muestra en una alerta y deja reintentar. La API exige `requireAdmin`: esconder el botón a los demás
 * roles es comodidad (lo hace el panel).
 */
export function LimpiezaHuerfanas({ onCerrar }: { onCerrar: () => void }) {
  const [previa, setPrevia] = useState<LimpiezaFotosApi | null>(null);
  const [resultado, setResultado] = useState<ResultadoLimpiezaFotosApi | null>(null);
  const [paso, setPaso] = useState<Paso>("vista");
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  // Cambia al pedir de nuevo la vista previa («Reintentar»): vuelve a correr el efecto sin llamar a setState dentro de él.
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let vigente = true;
    api
      .get<LimpiezaFotosApi>(URL_LIMPIAR)
      .then((l) => {
        if (!vigente) return;
        setPrevia(l);
        setError(null);
      })
      .catch((e: unknown) => {
        if (vigente) setError(e instanceof Error ? e.message : "No pudimos revisar las fotos huérfanas.");
      })
      .finally(() => {
        if (vigente) setCargando(false);
      });
    return () => {
      vigente = false;
    };
  }, [intento]);

  async function borrar() {
    if (enviando) return;
    setEnviando(true);
    setError(null);
    try {
      setResultado(await api.post<ResultadoLimpiezaFotosApi>(URL_LIMPIAR, { confirmar: true }));
      setPaso("hecho");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No pudimos borrar las fotos huérfanas.");
      setPaso("vista");
    } finally {
      setEnviando(false);
    }
  }

  const total = previa ? totalHuerfanas(previa) : 0;
  const pie =
    paso === "hecho" ? (
      <Button className="h-11! px-5!" onClick={onCerrar}>
        Cerrar
      </Button>
    ) : paso === "confirmar" ? (
      <>
        <Button variante="secundario" className="h-11! px-5!" onClick={() => setPaso("vista")} disabled={enviando}>
          Volver
        </Button>
        <Button variante="peligro" className="h-11! px-5!" onClick={() => void borrar()} disabled={enviando}>
          {enviando ? "Borrando…" : "Sí, borrar"}
        </Button>
      </>
    ) : (
      <>
        <Button variante="secundario" className="h-11! px-5!" onClick={onCerrar}>
          Cerrar
        </Button>
        {previa === null && error !== null ? (
          <Button
            className="h-11! px-5!"
            onClick={() => {
              setCargando(true);
              setIntento((n) => n + 1);
            }}
          >
            Reintentar
          </Button>
        ) : (
          <Button variante="peligro" className="h-11! px-5!" onClick={() => setPaso("confirmar")} disabled={cargando || total === 0}>
            Borrar…
          </Button>
        )}
      </>
    );

  return (
    <Modal titulo="Limpiar fotos huérfanas" ancho="max-w-md" cerrable={!enviando} onCerrar={onCerrar} pie={pie}>
      <div className="space-y-3 text-sm">
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
        {paso === "vista" && (
          <>
            <p className="text-tinta-suave">
              Una foto huérfana es un archivo del almacenamiento que ninguna línea usa: quedó a medias al subirla o es de una foto que ya se quitó. Solo cuentan las de más de 24 horas.
            </p>
            {cargando && previa === null ? <p className="text-tinta-suave">Revisando…</p> : previa && <p className="font-medium text-tinta">{textoVistaPreviaLimpieza(previa)}</p>}
          </>
        )}
        {paso === "confirmar" && previa && <p className="text-tinta">{textoConfirmarLimpieza(previa)}</p>}
        {paso === "hecho" && resultado && (
          <Alert tono={resultado.fallidos > 0 ? "info" : "exito"}>{textoResultadoLimpieza(resultado)}</Alert>
        )}
      </div>
    </Modal>
  );
}
