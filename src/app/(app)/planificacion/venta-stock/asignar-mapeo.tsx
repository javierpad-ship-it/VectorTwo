"use client";

import { useEffect, useMemo, useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { formatearNumero, mensajeError, plural } from "@/lib/formato";
import type { ResultadoInforme } from "@/lib/ventas/informe";
import { ETIQUETAS_MOTIVO } from "@/lib/ventas/tipos";
import { COMODIN_EQUIVALENCIA, type CrearMapeoItem, type SugerenciaMapeo } from "@/lib/ventas/tipos-mapeo";
import { apiMapeos, esConflictoOrigenRepetido } from "./api-mapeos";
import { formatearSoles, nombrePeriodo } from "./comunes";
import { useContextoMapeosObligatorio } from "./contexto-mapeos";
import { filasReasignadas, textoOrigen, textoTerna, type OrigenAsignable } from "./origenes-mapeo";
import { SelectorDestino, textoDestino } from "./selector-destino";

/** Máximo de combinaciones por asignación (límite de la API: 500 por petición). */
export const MAX_ORIGENES_ASIGNAR = 500;
const FILAS_VISIBLES = 25;

const puntuacionTexto = (n: number) => n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Props = {
  /** Combinaciones de origen elegidas, sin repetir y ordenadas por peso. */
  origenes: OrigenAsignable[];
  /** Filas reasignadas por mapeo que ya tiene el reporte (para decir cuántas suma esta asignación). */
  reasignadasAntes: number;
  /** Meses que estaban bloqueados (errores de 2 % o más) antes de asignar: se dice cuáles dejan de estarlo. */
  bloqueadosAntes: string[];
  /** Vuelve a llamar a `previsualizar` y rehace el informe sin releer el archivo. */
  recalcular: () => Promise<ResultadoInforme>;
  onCerrar: () => void;
};

type FilaOrigen = { o: OrigenAsignable; i: number };

/**
 * Modal "Asignar destino" (ficha M5b, "Pantallas"): los orígenes elegidos con
 * su peso y sus 3 mejores sugerencias, el selector de destino (GML y
 * equivalencia), la opción de comodín cuando comparten terna, una nota y
 * "Guardar y recalcular". La sugerencia es una ayuda: nunca se aplica sola.
 */
export function AsignarMapeo({ origenes, reasignadasAntes, bloqueadosAntes, recalcular, onCerrar }: Props) {
  const ctx = useContextoMapeosObligatorio();
  const [sugerencias, setSugerencias] = useState<SugerenciaMapeo[][] | null>(null);
  const [errorSugerencias, setErrorSugerencias] = useState<string | null>(null);
  const [equivalenciaId, setEquivalenciaId] = useState("");
  const [comodin, setComodin] = useState(false);
  const [nota, setNota] = useState("");
  const [fase, setFase] = useState<"editando" | "guardado">("editando");
  const [ocupado, setOcupado] = useState<"guardando" | "recalculando" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repetido, setRepetido] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [limite, setLimite] = useState(FILAS_VISIBLES);

  const excede = origenes.length > MAX_ORIGENES_ASIGNAR;
  const primero = origenes[0];
  const ternaUnica = primero !== undefined && origenes.every((o) => o.origen.genero === primero.origen.genero && o.origen.mundo === primero.origen.mundo && o.origen.linea === primero.origen.linea);
  const filasTotales = origenes.reduce((s, o) => s + o.filas, 0);
  const destino = ctx.porEquivalencia.get(equivalenciaId) ?? null;
  const bloqueado = ocupado !== null || fase === "guardado";

  useEffect(() => {
    if (origenes.length === 0 || origenes.length > MAX_ORIGENES_ASIGNAR) return;
    let vigente = true;
    apiMapeos
      .sugerir({ combinaciones: origenes.map((o) => o.origen) })
      .then((r) => {
        if (vigente) setSugerencias(r.sugerencias);
      })
      .catch((e: unknown) => {
        if (vigente) setErrorSugerencias(mensajeError(e));
      });
    return () => {
      vigente = false;
    };
  }, [origenes]);

  const cargandoSugerencias = sugerencias === null && errorSugerencias === null && !excede && origenes.length > 0;
  const filas: FilaOrigen[] = useMemo(() => origenes.slice(0, limite).map((o, i) => ({ o, i })), [origenes, limite]);

  const columnas: Columna<FilaOrigen>[] = [
    {
      clave: "origen",
      titulo: "Origen (del archivo)",
      render: ({ o }) => (
        <div>
          <span className="break-words font-medium">{textoOrigen(o.origen)}</span>
          <div className="text-xs text-tinta-suave">{ETIQUETAS_MOTIVO[o.motivo]}</div>
        </div>
      ),
    },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: ({ o }) => formatearNumero(o.filas) },
    { clave: "venta", titulo: "Venta", className: "text-right font-mono", render: ({ o }) => formatearSoles(o.venta_soles) },
    { clave: "stock", titulo: "Stock a costo", className: "text-right font-mono", render: ({ o }) => formatearSoles(o.stock_valorizado) },
    {
      clave: "sugerencias",
      titulo: "Sugerencias",
      render: ({ i }) => {
        if (excede) return <span className="text-xs text-tinta-suave">—</span>;
        if (cargandoSugerencias) return <span className="text-xs text-tinta-suave">Buscando…</span>;
        if (errorSugerencias !== null) return <span className="text-xs text-tinta-suave">No disponibles</span>;
        const lista = sugerencias?.[i] ?? [];
        if (lista.length === 0) return <span className="text-xs text-tinta-suave">Sin sugerencia: elige el destino a mano.</span>;
        return (
          <ul className="space-y-1">
            {lista.map((s) => {
              const elegida = s.equivalencia_id === equivalenciaId;
              return (
                <li key={s.equivalencia_id}>
                  <button
                    type="button"
                    disabled={bloqueado}
                    aria-pressed={elegida}
                    onClick={() => setEquivalenciaId(s.equivalencia_id)}
                    className={`w-full rounded-md border px-2 py-1 text-left text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:cursor-not-allowed disabled:opacity-60 ${
                      elegida ? "border-marca bg-marca-suave" : s.fuerte ? "border-exito/40 bg-exito-suave/50 hover:bg-exito-suave" : "border-borde hover:bg-neutro-suave"
                    }`}
                  >
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="break-words font-medium">{`${s.genero} / ${s.mundo} / ${s.linea} / ${s.equivalencia}`}</span>
                      <span className="font-mono">{puntuacionTexto(s.puntuacion)}</span>
                      {s.fuerte && <Badge tono="exito">Sugerida</Badge>}
                    </span>
                    <span className="block text-tinta-suave">{s.razon}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        );
      },
    },
  ];

  /** Los mapeos que se guardarán: uno por combinación, o uno solo con comodín. */
  function itemsAGuardar(): CrearMapeoItem[] {
    const notaLimpia = nota.trim();
    const extra = notaLimpia === "" ? {} : { nota: notaLimpia };
    if (comodin && ternaUnica && primero) {
      const { genero, mundo, linea } = primero.origen;
      return [{ origen: { genero, mundo, linea, equivalencia: COMODIN_EQUIVALENCIA }, equivalencia_id: equivalenciaId, motivo_origen: primero.motivo, ...extra }];
    }
    return origenes.map((o) => ({ origen: o.origen, equivalencia_id: equivalenciaId, motivo_origen: o.motivo, ...extra }));
  }

  async function recalcularYMostrar() {
    setOcupado("recalculando");
    setError(null);
    try {
      const r = await recalcular();
      const sumadas = Math.max(0, filasReasignadas(r.informe) - reasignadasAntes);
      const desbloqueados = r.informe.meses.filter((m) => !m.bloqueado && bloqueadosAntes.includes(m.periodo)).map((m) => nombrePeriodo(m.periodo));
      const texto =
        sumadas > 0
          ? `Reporte recalculado: ${plural(sumadas, "fila reasignada", "filas reasignadas")}.`
          : "Reporte recalculado: ninguna fila se reasignó (el mapeo quedó guardado, pero esas combinaciones ya no resuelven en este archivo).";
      setResultado(desbloqueados.length > 0 ? `${texto} ${desbloqueados.length === 1 ? "Este mes ya no está bloqueado" : "Estos meses ya no están bloqueados"}: ${desbloqueados.join(", ")}.` : texto);
    } catch (e) {
      setError(`El mapeo ya está guardado, pero no se pudo recalcular el reporte: ${mensajeError(e)}`);
    } finally {
      setOcupado(null);
    }
  }

  async function guardar(reemplazar: boolean) {
    if (!destino || excede || origenes.length === 0) return;
    const items = itemsAGuardar();
    const cuantos = comodin && ternaUnica ? `la terna ${textoTerna(primero.origen)} con cualquier equivalencia que no resuelva` : plural(origenes.length, "combinación", "combinaciones");
    const texto = [
      `¿Asignar ${cuantos} a ${textoDestino(destino.nodo, destino.eq.nombre)}?`,
      `Afecta a ${plural(filasTotales, "fila", "filas")} de este archivo y a cualquier archivo futuro mientras el mapeo esté activo.`,
      reemplazar ? "Los orígenes que ya tenían otro destino pasarán a este." : "",
      "Los meses ya publicados no cambian: para que reflejen el mapeo hay que recargarlos.",
    ]
      .filter(Boolean)
      .join("\n\n");
    if (!confirm(texto)) return;
    setOcupado("guardando");
    setError(null);
    setRepetido(false);
    try {
      await apiMapeos.crear({ mapeos: items, ...(reemplazar ? { reemplazar: true } : {}) });
    } catch (e) {
      setError(mensajeError(e));
      setRepetido(esConflictoOrigenRepetido(e));
      setOcupado(null);
      return;
    }
    setFase("guardado");
    await recalcularYMostrar();
  }

  const puedeGuardar = destino !== null && !excede && origenes.length > 0 && ocupado === null && fase === "editando";

  const pie = (
    <>
      {ocupado === "guardando" && <span className="mr-auto text-sm text-tinta-suave">Guardando el mapeo…</span>}
      {ocupado === "recalculando" && <span className="mr-auto text-sm text-tinta-suave">Recalculando el reporte (sin releer el archivo)…</span>}
      <Button variante="secundario" onClick={onCerrar} disabled={ocupado !== null}>
        {fase === "guardado" ? "Cerrar" : "Cancelar"}
      </Button>
      {fase === "guardado" ? (
        <Button onClick={() => void recalcularYMostrar()} disabled={ocupado !== null || resultado !== null}>
          Reintentar el recálculo
        </Button>
      ) : (
        <>
          {repetido && (
            <Button variante="peligro" onClick={() => void guardar(true)} disabled={!puedeGuardar}>
              Reemplazar el destino anterior y recalcular
            </Button>
          )}
          <Button onClick={() => void guardar(false)} disabled={!puedeGuardar}>
            Guardar y recalcular
          </Button>
        </>
      )}
    </>
  );

  return (
    <Modal
      titulo="Asignar destino"
      descripcion={`${plural(origenes.length, "combinación", "combinaciones")} del archivo (${plural(filasTotales, "fila", "filas")}) irán al mismo GML o GMLE del árbol.`}
      onCerrar={onCerrar}
      cerrable={ocupado === null}
      ancho="max-w-5xl"
      pie={pie}
    >
      <div className="space-y-5">
        {excede && (
          <Alert>
            Elegiste {formatearNumero(origenes.length)} combinaciones y el máximo por asignación es {formatearNumero(MAX_ORIGENES_ASIGNAR)}. Cierra y elige menos grupos (por ejemplo, un motivo o un valor a la vez).
          </Alert>
        )}
        {errorSugerencias !== null && <Alert tono="info">No se pudieron calcular las sugerencias ({errorSugerencias}). Puedes elegir el destino a mano.</Alert>}

        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Qué se va a asignar</h3>
          <DataTable columnas={columnas} filas={filas} claveFila={({ o }) => o.clave} />
          {origenes.length > limite && (
            <Button variante="secundario" tamano="sm" onClick={() => setLimite((l) => l + FILAS_VISIBLES)}>
              Mostrar más ({formatearNumero(origenes.length - limite)} restantes)
            </Button>
          )}
          <p className="text-xs text-tinta-suave">
            Ordenadas por venta más stock. Las sugerencias son una ayuda (similitud del nombre con lo que hay hoy en el árbol): elige una con un clic o busca el destino abajo; nada se aplica hasta que pulses
            Guardar.
          </p>
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Destino</h3>
          <SelectorDestino equivalenciaId={equivalenciaId} onCambiar={setEquivalenciaId} disabled={bloqueado} />
          {equivalenciaId !== "" && destino === null && (
            <Alert tono="info">La sugerencia elegida ya no es un destino vigente en el árbol cargado en pantalla. Elige otro destino o recarga la página si cambiaste el árbol hace un momento.</Alert>
          )}
        </div>

        <div className="space-y-3">
          <label className={`flex items-start gap-2 text-sm ${ternaUnica ? "" : "opacity-60"}`}>
            <Checkbox checked={comodin && ternaUnica} disabled={!ternaUnica || bloqueado} onChange={setComodin} label="Aplicar a cualquier equivalencia de esta terna" className="mt-0.5" />
            <span>
              <span className="font-medium">Aplicar a cualquier equivalencia de esta terna</span>
              <span className="block text-xs text-tinta-suave">
                {ternaUnica
                  ? `Crea un solo mapeo para ${primero ? textoTerna(primero.origen) : ""} con cualquier equivalencia que no resuelva, también las que aparezcan en otros años. Úsalo solo si todas deben ir al mismo destino.`
                  : "Solo disponible cuando todas las combinaciones elegidas comparten género, mundo y línea."}
              </span>
            </span>
          </label>

          <Field label="Nota (opcional)" hint="Máximo 200 caracteres. Queda en la pestaña Mapeos.">
            <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={200} disabled={bloqueado} />
          </Field>
        </div>

        <p className="text-sm text-tinta-suave">
          {comodin && ternaUnica ? "Se guardará 1 mapeo comodín." : `Se ${origenes.length === 1 ? "guardará" : "guardarán"} ${plural(origenes.length, "mapeo", "mapeos")}.`} Cambiar o borrar un mapeo después no modifica los meses ya
          publicados: hay que recargar el mes.
        </p>

        {resultado && <Alert tono="exito">{resultado}</Alert>}
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
        {repetido && (
          <Alert tono="info">Alguno de estos orígenes ya tiene otro destino. Si quieres cambiarlo, usa «Reemplazar el destino anterior y recalcular».</Alert>
        )}
      </div>
    </Modal>
  );
}
