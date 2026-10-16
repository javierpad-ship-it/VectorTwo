"use client";

import { useState, type ClipboardEvent } from "react";
import { curvaDesde, parsearPegado, type EvaluacionCurvaUsuario } from "@/lib/curvas/curva-usuario";
import type { AgrupacionResultado, CandidataApi, PartidaCurvaUsuario, VigenteResumenApi } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { MESES_CORTOS } from "@/lib/reportes/histograma";
import {
  PARTIDA_EN_BLANCO,
  lineasMedidaEnMuestra,
  normalizarTextos,
  opcionesPartida,
  sumaEnVivo,
  textoEatCandidata,
  textosDeValores,
  textosEnBlanco,
} from "./curva-usuario-vista";
import { claseDiferencia, compararCurvas, etiquetaPropuesta, formatearDiferenciaPp, formatearPctSolo, formatearPp, fraseComparacion, textoPartida, type Comparacion } from "./vista";

/**
 * Tarjeta «Mi curva (curva del usuario)» (06c, paso 4b): doce participaciones en porcentaje que escribe el planner, con
 * suma en vivo y «Normalizar a 100 %»; partir de una candidata, un año, la vigente o pegar desde Excel. Mientras la curva
 * es válida se dibuja en el gráfico y en la tabla año × mes y se mide EN MUESTRA (con los mismos años que se ven; las
 * candidatas se miden fuera de muestra) y se puede elegir «U» en la tabla de candidatas para aprobarla, siempre con nota.
 * El estado (las doce celdas y de dónde se partió) vive en la vista de trabajo: así el gráfico y Aprobar lo comparten.
 */
export function CurvaUsuarioEditor({
  abierta,
  onAbrir,
  textos,
  partida,
  onCambio,
  resultado,
  vigente,
  evaluacion,
  referencia,
  candidataReferencia,
  seleccionadaU,
  onElegirU,
  deshabilitado,
}: {
  abierta: boolean;
  onAbrir: (abierta: boolean) => void;
  textos: string[];
  partida: PartidaCurvaUsuario;
  /** Las celdas nuevas y, si cambió, el punto de partida (si no viene se conserva). */
  onCambio: (textos: string[], partida?: PartidaCurvaUsuario) => void;
  resultado: Pick<AgrupacionResultado, "candidatas" | "anios" | "ruido_normal">;
  vigente: Pick<VigenteResumenApi, "version" | "curva"> | null;
  /** La medida en muestra; `null` mientras la curva no sea válida. */
  evaluacion: EvaluacionCurvaUsuario | null;
  /** La candidata dibujada (propuesta) con la que se compara. */
  referencia: { modelo: CandidataApi["modelo"]; curva: number[] } | null;
  candidataReferencia: CandidataApi | null;
  seleccionadaU: boolean;
  onElegirU: () => void;
  deshabilitado: boolean;
}) {
  const [pegando, setPegando] = useState(false);
  const [pegado, setPegado] = useState("");
  const [aviso, setAviso] = useState<{ tono: "alerta" | "info"; texto: string } | null>(null);
  const suma = sumaEnVivo(textos);
  const opciones = opcionesPartida(resultado, vigente);
  const hayAlgo = textos.some((t) => t.trim() !== "");

  function aplicarPegado(texto: string): boolean {
    const r = parsearPegado(texto);
    if (!r.ok) {
      setAviso({ tono: "alerta", texto: r.error });
      return false;
    }
    onCambio(textosDeValores(r.valores), { tipo: "pegado", referencia: null });
    setAviso(r.aviso ? { tono: "info", texto: r.aviso } : r.origen === "fraccion" ? { tono: "info", texto: "Los valores sumaban 1: se tomaron como fracciones y se pasaron a porcentaje." } : null);
    return true;
  }

  function alPegarEnCelda(e: ClipboardEvent<HTMLInputElement>) {
    const texto = e.clipboardData.getData("text");
    // Un solo número se pega normal en la celda; varios valores (de Excel) llenan las doce.
    if (!/[\t\n;]|\s\S*\s|[\d.,]\s+[\d.,]/.test(texto.trim())) return;
    e.preventDefault();
    aplicarPegado(texto);
  }

  function partirDe(id: string) {
    if (id === "") return;
    if (id === "blanco") {
      onCambio(textosEnBlanco(), PARTIDA_EN_BLANCO);
      setAviso(null);
      return;
    }
    const op = opciones.find((o) => o.id === id);
    if (!op) return;
    const v = curvaDesde(op.partida, resultado as AgrupacionResultado, vigente as VigenteResumenApi | null);
    if (!v) {
      setAviso({ tono: "alerta", texto: "Ese punto de partida no tiene curva." });
      return;
    }
    onCambio(textosDeValores(v), op.partida);
    setAviso(null);
  }

  function normalizar() {
    const t = normalizarTextos(textos);
    if (!t) {
      setAviso({ tono: "alerta", texto: "Hay celdas que no son números o la suma es cero: corrígelas antes de normalizar." });
      return;
    }
    onCambio(t);
    setAviso(null);
  }

  const comparacion: Comparacion | null = evaluacion && referencia ? compararCurvas(referencia.curva, evaluacion.curva, false) : null;

  return (
    <Card
      titulo="Mi curva (curva del usuario)"
      descripcion="Escribe tú las doce participaciones del año; el sistema las mide con los mismos años y el mismo ruido que a las candidatas (en muestra) y puedes aprobarla con una nota."
      acciones={
        <Button variante={abierta ? "fantasma" : "secundario"} tamano="sm" aria-expanded={abierta} onClick={() => onAbrir(!abierta)}>
          {abierta ? "Plegar" : hayAlgo ? "Seguir con mi curva" : "Definir mi curva"}
        </Button>
      }
    >
      {!abierta ? (
        <p className="text-sm text-tinta-suave">
          {evaluacion ? (
            <>
              Tu curva está guardada como borrador en esta pestaña y se ve en el gráfico y en la tabla. {lineasMedidaEnMuestra(evaluacion)[0]}
            </>
          ) : (
            "Plegada. Úsala si tú sabes mejor que el sistema cómo se reparte el año: puedes partir de una candidata, de un año, de la vigente o pegar desde Excel."
          )}
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block w-full max-w-xs">
              <span className="mb-1 block text-sm font-medium text-tinta">Partir de</span>
              <Select value="" disabled={deshabilitado} onChange={(e) => partirDe(e.target.value)} aria-label="Partir de una candidata, un año o la vigente">
                <option value="">Elige un punto de partida…</option>
                <optgroup label="Candidatas del sistema">
                  {opciones.filter((o) => o.id.startsWith("c-")).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.etiqueta}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Un año">
                  {opciones.filter((o) => o.id.startsWith("a-")).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.etiqueta}
                    </option>
                  ))}
                </optgroup>
                {opciones.some((o) => o.id === "v") && (
                  <optgroup label="La curva aprobada">
                    {opciones.filter((o) => o.id === "v").map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.etiqueta}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="blanco">En blanco</option>
              </Select>
            </label>
            <Button variante="secundario" tamano="sm" aria-expanded={pegando} onClick={() => setPegando((p) => !p)} disabled={deshabilitado}>
              Pegar desde Excel
            </Button>
            <p className="text-xs text-tinta-suave">Partiste de: {textoPartida(partida)}.</p>
          </div>

          {pegando && (
            <div className="space-y-2 rounded-lg border border-borde p-3">
              <label className="block text-sm font-medium text-tinta" htmlFor="pegado-curva">
                Pega aquí los doce valores (enero a diciembre), separados por tabulador, salto de línea, punto y coma, espacio o coma
              </label>
              <textarea
                id="pegado-curva"
                value={pegado}
                onChange={(e) => setPegado(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-borde bg-superficie px-3 py-2 font-mono text-sm focus:border-marca focus:outline-none focus:ring-2 focus:ring-marca/20"
                placeholder="5	5	6	8	11	14	13	12	10	7	5	4"
              />
              <div className="flex gap-2">
                <Button
                  tamano="sm"
                  onClick={() => {
                    if (aplicarPegado(pegado)) {
                      setPegado("");
                      setPegando(false);
                    }
                  }}
                  disabled={pegado.trim() === ""}
                >
                  Usar lo pegado
                </Button>
                <Button variante="fantasma" tamano="sm" onClick={() => setPegando(false)}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {aviso && <Alert tono={aviso.tono} onCerrar={() => setAviso(null)}>{aviso.texto}</Alert>}

          <div className="overflow-x-auto rounded-lg border border-borde" role="region" aria-label="Doce participaciones de mi curva (desplazable)" tabIndex={0}>
            <table className="w-full text-sm">
              <caption className="sr-only">Mi curva: participación de cada mes en porcentaje, la candidata dibujada y su diferencia en puntos.</caption>
              <thead className="bg-neutro-suave text-xs text-tinta-suave">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium" />
                  {MESES_CORTOS.map((m) => (
                    <th key={m} scope="col" className="min-w-16 px-1 py-2 text-right font-medium uppercase">
                      {m}
                    </th>
                  ))}
                  <th scope="col" className="min-w-28 px-3 py-2 text-right font-medium">
                    Suma
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde tabular-nums">
                <tr>
                  <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-semibold" style={{ color: "#0f766e" }}>
                    Mi curva (%)
                  </th>
                  {textos.map((t, i) => (
                    <td key={i} className="px-1 py-1">
                      <Input
                        value={t}
                        inputMode="decimal"
                        aria-label={`Mi curva en ${MESES_CORTOS[i]} (porcentaje)`}
                        disabled={deshabilitado}
                        onChange={(e) => onCambio(textos.map((x, j) => (j === i ? e.target.value : x)))}
                        onPaste={alPegarEnCelda}
                        className="h-8 px-1.5 text-right"
                      />
                    </td>
                  ))}
                  <td className={`px-3 py-1.5 text-right text-xs font-medium ${suma.ok ? "text-exito" : "text-alerta"}`} aria-live="polite">
                    {suma.texto}
                  </td>
                </tr>
                {referencia && (
                  <>
                    <tr>
                      <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium text-marca-oscura">
                        {etiquetaPropuesta(referencia.modelo)}
                      </th>
                      {referencia.curva.map((v, i) => (
                        <td key={i} className="px-1 py-1.5 text-right">
                          {formatearPctSolo(v)}
                        </td>
                      ))}
                      <td />
                    </tr>
                    <tr className="bg-neutro-suave/50">
                      <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-medium">
                        Diferencia (pp)
                        <span className="block text-xs font-normal text-tinta-suave">mi curva − propuesta</span>
                      </th>
                      {MESES_CORTOS.map((_, i) => {
                        const d = comparacion ? comparacion.diferencias[i] : null;
                        return (
                          <td key={i} className={`px-1 py-1.5 text-right font-medium ${claseDiferencia(d)}`}>
                            {d === null ? "—" : formatearDiferenciaPp(d)}
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5 text-right text-xs text-tinta-suave">{comparacion ? `EAT ${formatearPp(comparacion.eat)}` : "—"}</td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
          {comparacion && referencia && (
            <p className="text-xs text-tinta-suave">
              {fraseComparacion(comparacion).replace("entre ambas", "entre mi curva y la propuesta")}.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button variante="secundario" tamano="sm" onClick={normalizar} disabled={deshabilitado || !hayAlgo}>
              Normalizar a 100 %
            </Button>
            <Button
              variante="fantasma"
              tamano="sm"
              onClick={() => {
                onCambio(textosEnBlanco(), PARTIDA_EN_BLANCO);
                setAviso(null);
              }}
              disabled={deshabilitado || !hayAlgo}
            >
              Limpiar
            </Button>
          </div>

          {evaluacion ? (
            <div className="space-y-2 rounded-md border border-borde bg-fondo px-3 py-2 text-sm">
              {lineasMedidaEnMuestra(evaluacion).map((l, i) => (
                <p key={i} className="text-tinta">
                  {l}
                </p>
              ))}
              {candidataReferencia && textoEatCandidata(candidataReferencia) && (
                <p className="text-xs text-tinta-suave">Para comparar lo comparable: {textoEatCandidata(candidataReferencia)}.</p>
              )}
              <p className="text-xs text-tinta-suave">
                Para aprobarla elige «U · Mi curva» en la tabla de candidatas (o aquí) y escribe la nota: la curva del usuario siempre lleva motivo. No se marcará obsoleta por datos nuevos: la cambias tú.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button tamano="sm" variante={seleccionadaU ? "primario" : "secundario"} aria-pressed={seleccionadaU} onClick={onElegirU} disabled={deshabilitado}>
                  {seleccionadaU ? "«U · Mi curva» elegida para aprobar" : "Elegir «U · Mi curva» para aprobar"}
                </Button>
                {evaluacion.igual_a && <Badge tono="neutro">Igual a {evaluacion.igual_a}</Badge>}
              </div>
            </div>
          ) : (
            <p className="text-xs text-tinta-suave">
              Mientras la curva no sea válida (doce valores de 0 a 100 que sumen 100 %) no se dibuja ni se mide: {suma.texto.toLowerCase()}. Usa «Normalizar a 100 %» para repartir la diferencia.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
