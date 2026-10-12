"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { mensajeError } from "@/lib/formato";
import { EQUIVALENCIA_GENERICA, esEquivalenciaGenerica, esEquivalenciaIgualALinea, normalizarNombre } from "@/lib/arbol/normalizar";
import { COMODIN_EQUIVALENCIA, type MapeoApi, type OrigenMapeo } from "@/lib/ventas/tipos-mapeo";
import { apiMapeos, esConflictoOrigenRepetido } from "./api-mapeos";
import { useContextoMapeosObligatorio } from "./contexto-mapeos";
import { textoOrigen } from "./origenes-mapeo";
import { SelectorDestino, textoDestino } from "./selector-destino";

const MAX_NOTA = 200;

/**
 * Edición de un mapeo existente: cambiar el destino (mismo selector que el
 * modal de asignar) o editar la nota. Activar y desactivar se hace desde la
 * fila, sin modal.
 */
export function EditarMapeo({ mapeo, modo, onCerrar, onGuardado }: { mapeo: MapeoApi; modo: "destino" | "nota"; onCerrar: () => void; onGuardado: () => void }) {
  const ctx = useContextoMapeosObligatorio();
  const [equivalenciaId, setEquivalenciaId] = useState(mapeo.destino.equivalencia_id);
  const [nota, setNota] = useState(mapeo.nota ?? "");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const destinoNuevo = ctx.porEquivalencia.get(equivalenciaId) ?? null;
  const cambiaDestino = equivalenciaId !== mapeo.destino.equivalencia_id;
  const notaLimpia = nota.trim();
  const cambiaNota = notaLimpia !== (mapeo.nota ?? "");
  const puedeGuardar = !enviando && (modo === "destino" ? cambiaDestino && destinoNuevo !== null : cambiaNota);

  async function guardar() {
    if (!puedeGuardar) return;
    if (modo === "destino" && destinoNuevo) {
      const ok = confirm(
        `¿Cambiar el destino de ${textoOrigen(mapeo.origen)} a ${textoDestino(destinoNuevo.nodo, destinoNuevo.eq.nombre)}?\n\nLos meses ya publicados no cambian: para que reflejen el nuevo destino hay que recargarlos.`
      );
      if (!ok) return;
    }
    setEnviando(true);
    setError(null);
    try {
      await apiMapeos.editar(mapeo.id, modo === "destino" ? { equivalencia_id: equivalenciaId } : { nota: notaLimpia === "" ? null : notaLimpia });
      onGuardado();
    } catch (e) {
      setError(mensajeError(e));
      setEnviando(false);
    }
  }

  const d = mapeo.destino;
  return (
    <Modal
      titulo={modo === "destino" ? "Cambiar el destino del mapeo" : "Editar la nota del mapeo"}
      descripcion={`Origen: ${textoOrigen(mapeo.origen)}`}
      onCerrar={onCerrar}
      cerrable={!enviando}
      ancho="max-w-2xl"
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={!puedeGuardar}>
            {enviando ? "Guardando…" : "Guardar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {modo === "destino" ? (
          <>
            <p className="text-sm text-tinta-suave">
              Destino actual: <strong className="text-tinta">{`${d.genero} / ${d.mundo} / ${d.linea} / ${d.equivalencia}`}</strong>
              {!d.vigente && " (desactivado)"}
            </p>
            <SelectorDestino equivalenciaId={equivalenciaId} onCambiar={setEquivalenciaId} disabled={enviando} />
            <Alert tono="info">Cambiar el destino no modifica los meses ya publicados: para que reflejen el cambio hay que recargar el mes.</Alert>
          </>
        ) : (
          <Field label="Nota" hint={`Máximo ${MAX_NOTA} caracteres. Déjala vacía para quitarla.`}>
            <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={MAX_NOTA} disabled={enviando} />
          </Field>
        )}
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
      </div>
    </Modal>
  );
}

/**
 * Convierte lo que escribe la persona en el origen tal como lo guarda el
 * mapeo: nombres normalizados y la equivalencia con las reglas del árbol
 * (vacío o SIN EQUIVALENCIA → genérica, `-` → nombre de la línea, `*` → comodín).
 * Devuelve el texto del problema si no se puede.
 */
export function origenDesdeTexto(genero: string, mundo: string, linea: string, equivalencia: string): { origen: OrigenMapeo } | { error: string } {
  const g = normalizarNombre(genero);
  const m = normalizarNombre(mundo);
  const l = normalizarNombre(linea);
  if (g === "" && m === "" && l === "") return { error: "Indica al menos el género, el mundo o la línea: sin ninguno no hay qué mapear." };
  const e = normalizarNombre(equivalencia);
  let eq: string;
  if (e === COMODIN_EQUIVALENCIA) eq = COMODIN_EQUIVALENCIA;
  else if (esEquivalenciaGenerica(e)) eq = EQUIVALENCIA_GENERICA.nombre;
  else if (esEquivalenciaIgualALinea(e)) {
    if (l === "") return { error: "Con «-» como equivalencia hace falta la línea (la equivalencia se llama como la línea)." };
    eq = l;
  } else eq = e;
  return { origen: { genero: g, mundo: m, linea: l, equivalencia: eq } };
}

/** Alta a mano de un mapeo para un origen que todavía no apareció en un archivo. */
export function NuevoMapeo({ onCerrar, onGuardado }: { onCerrar: () => void; onGuardado: () => void }) {
  const ctx = useContextoMapeosObligatorio();
  const [genero, setGenero] = useState("");
  const [mundo, setMundo] = useState("");
  const [linea, setLinea] = useState("");
  const [equivalencia, setEquivalencia] = useState("");
  const [equivalenciaId, setEquivalenciaId] = useState("");
  const [nota, setNota] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repetido, setRepetido] = useState(false);

  const origen = origenDesdeTexto(genero, mundo, linea, equivalencia);
  const destino = ctx.porEquivalencia.get(equivalenciaId) ?? null;
  const hayTexto = genero.trim() !== "" || mundo.trim() !== "" || linea.trim() !== "";
  const puedeGuardar = !enviando && "origen" in origen && destino !== null;

  async function guardar(reemplazar: boolean) {
    if (!("origen" in origen) || !destino) return;
    const ok = confirm(
      `¿Crear el mapeo ${textoOrigen(origen.origen)} → ${textoDestino(destino.nodo, destino.eq.nombre)}?${reemplazar ? "\n\nSi el origen ya tenía otro destino, pasará a este." : ""}\n\nSe aplicará en las próximas lecturas de archivos. Los meses ya publicados no cambian hasta recargarlos.`
    );
    if (!ok) return;
    setEnviando(true);
    setError(null);
    setRepetido(false);
    try {
      const notaLimpia = nota.trim();
      await apiMapeos.crear({
        mapeos: [{ origen: origen.origen, equivalencia_id: equivalenciaId, ...(notaLimpia === "" ? {} : { nota: notaLimpia }) }],
        ...(reemplazar ? { reemplazar: true } : {}),
      });
      onGuardado();
    } catch (e) {
      setError(mensajeError(e));
      setRepetido(esConflictoOrigenRepetido(e));
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo="Nuevo mapeo"
      descripcion="Para una combinación del histórico que todavía no apareció en ningún archivo. Si ya la viste en un reporte previo, usa «Asignar» desde allí."
      onCerrar={onCerrar}
      cerrable={!enviando}
      ancho="max-w-3xl"
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={enviando}>
            Cancelar
          </Button>
          {repetido && (
            <Button variante="peligro" onClick={() => void guardar(true)} disabled={!puedeGuardar}>
              Reemplazar el destino anterior
            </Button>
          )}
          <Button onClick={() => void guardar(false)} disabled={!puedeGuardar}>
            {enviando ? "Guardando…" : "Crear mapeo"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Origen (como venía en el archivo)</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Género">
              <Input value={genero} onChange={(e) => setGenero(e.target.value)} disabled={enviando} />
            </Field>
            <Field label="Mundo">
              <Input value={mundo} onChange={(e) => setMundo(e.target.value)} disabled={enviando} />
            </Field>
            <Field label="Línea">
              <Input value={linea} onChange={(e) => setLinea(e.target.value)} disabled={enviando} />
            </Field>
            <Field label="Equivalencia" hint="Vacío = SIN EQUIVALENCIA · «-» = igual a la línea · «*» = cualquier equivalencia de esta terna.">
              <Input value={equivalencia} onChange={(e) => setEquivalencia(e.target.value)} disabled={enviando} />
            </Field>
          </div>
          {hayTexto && ("origen" in origen ? <p className="text-sm text-tinta-suave">Se guardará como: <strong className="break-words text-tinta">{textoOrigen(origen.origen)}</strong></p> : <p className="text-sm text-alerta">{origen.error}</p>)}
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Destino</h3>
          <SelectorDestino equivalenciaId={equivalenciaId} onCambiar={setEquivalenciaId} disabled={enviando} />
        </div>

        <Field label="Nota (opcional)" hint={`Máximo ${MAX_NOTA} caracteres.`}>
          <Input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={MAX_NOTA} disabled={enviando} />
        </Field>

        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
        {repetido && <Alert tono="info">Ese origen ya tiene otro destino. Si quieres cambiarlo, usa «Reemplazar el destino anterior» (o «Cambiar destino» en la tabla).</Alert>}
      </div>
    </Modal>
  );
}
