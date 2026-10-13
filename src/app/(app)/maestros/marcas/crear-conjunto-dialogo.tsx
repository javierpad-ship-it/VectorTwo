"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { mensajeError } from "@/lib/formato";
import type { AgrupacionMarcaFila, MarcaFila } from "@/lib/marcas/tipos-api";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { VistaPreviaNombre } from "@/components/catalogo/vista-previa-nombre";
import { esMarcaGenerica } from "@/components/marcas/comunes-m2b";
import {
  ETIQUETA_MOTIVO_RECHAZO_CONJUNTO,
  type CrearMarcaCuerpoM2b,
  type MarcaConGml,
  type MiembrosCuerpo,
  type MiembrosRespuesta,
} from "@/components/marcas/tipos-m2b";

const ID_FORM = "form-crear-conjunto";

/**
 * Crear un conjunto = elegir su marca cabeza: una marca nueva (nombre,
 * código y agrupación) o una existente. La cabeza es una marca más del
 * maestro; los miembros entran después desde el detalle del conjunto. Con
 * `miembroInicial` (se llega desde el `Select` "Nueva cabeza…" de una fila de
 * Marcas) esa marca entra como primer miembro en la misma operación.
 * Son dos llamadas (crear la marca y asignar el miembro) sin transacción: si
 * la segunda falla, la cabeza ya existe y el mensaje lo dice.
 */
export function CrearConjuntoDialogo({
  marcas,
  agrupaciones,
  miembroInicial = null,
  onCreado,
  onCerrar,
}: {
  marcas: MarcaConGml[];
  agrupaciones: AgrupacionMarcaFila[];
  miembroInicial?: MarcaConGml | null;
  /** Con la cabeza ya creada (y el miembro inicial asignado); quien lo usa cierra y abre el detalle. */
  onCreado: (cabezaId: string) => Promise<void>;
  onCerrar: () => void;
}) {
  const activas = agrupaciones.filter((a) => a.activo).sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"));
  const [modo, setModo] = useState<"nueva" | "existente">("nueva");
  const [nombre, setNombre] = useState("");
  const [codigo, setCodigo] = useState("");
  const [codigoTocado, setCodigoTocado] = useState(false);
  const [agrupacionId, setAgrupacionId] = useState(miembroInicial?.agrupacion_marca_id ?? "");
  const [existenteId, setExistenteId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidatas = marcas
    .filter((m) => m.activo && !esMarcaGenerica(m.nombre) && m.miembros === 0 && !m.conjunto_marca_id && m.id !== miembroInicial?.id)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const nombreFinal = normalizarNombre(nombre);
  const codigoPropuesto = codigoTocado ? aCodigo(codigo) : aCodigo(nombreFinal);
  const generica = modo === "nueva" && esMarcaGenerica(nombreFinal);
  const listo = modo === "nueva" ? nombreFinal !== "" && codigoPropuesto !== "" && agrupacionId !== "" && !generica : existenteId !== "";

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!listo || ocupado) return;
    setOcupado(true);
    setError(null);
    let cabezaId = existenteId;
    try {
      if (modo === "nueva") {
        const cuerpo: CrearMarcaCuerpoM2b = { nombre: nombreFinal, codigo: codigoPropuesto, agrupacion_marca_id: agrupacionId };
        const creada = await api.post<MarcaFila>("/api/marcas", cuerpo);
        cabezaId = creada.id;
      }
      if (miembroInicial) {
        const cuerpo: MiembrosCuerpo = { cabeza_marca_id: cabezaId, accion: "asignar", marca_ids: [miembroInicial.id] };
        const r = await api.post<MiembrosRespuesta>("/api/marcas/conjuntos/miembros", cuerpo);
        const rechazo = r.no_permitidas[0];
        if (rechazo) {
          const motivo = ETIQUETA_MOTIVO_RECHAZO_CONJUNTO[rechazo.motivo] ?? rechazo.motivo;
          throw new Error(
            `${modo === "nueva" ? `La marca ${nombreFinal} se creó, pero ` : ""}${rechazo.marca} no entró al conjunto: ${motivo}.`
          );
        }
      }
      await onCreado(cabezaId);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Modal
      titulo="Crear conjunto de marcas"
      descripcion={
        miembroInicial
          ? `${miembroInicial.nombre} entrará como primer miembro. La cabeza es la marca con la que se verá el conjunto en el flujo.`
          : "La cabeza es la marca con la que se verá el conjunto en el flujo. Los miembros se agregan después, desde el detalle."
      }
      onCerrar={onCerrar}
      cerrable={!ocupado}
      ancho="max-w-xl"
      pie={
        <>
          <Button variante="fantasma" disabled={ocupado} onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" form={ID_FORM} disabled={ocupado || !listo}>
            {ocupado ? "Creando…" : "Crear conjunto"}
          </Button>
        </>
      }
    >
      <form id={ID_FORM} onSubmit={enviar} className="grid gap-4">
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}

        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">Cabeza del conjunto</legend>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="modo-cabeza" checked={modo === "nueva"} onChange={() => setModo("nueva")} />
            Crear una marca cabeza nueva
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="modo-cabeza" checked={modo === "existente"} onChange={() => setModo("existente")} />
            Usar una marca existente como cabeza
          </label>
        </fieldset>

        {modo === "nueva" ? (
          <>
            <Field label="Nombre de la cabeza" hint="Puede ser un nombre que no venda por sí solo (p. ej. BETA HOLDING).">
              <Input required autoFocus value={nombre} onChange={(e) => setNombre(e.target.value)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Código" hint="Solo letras, números y _.">
                <Input
                  value={codigoTocado ? codigo : codigoPropuesto}
                  onChange={(e) => {
                    setCodigo(e.target.value);
                    setCodigoTocado(true);
                  }}
                  className="font-mono"
                />
              </Field>
              <Field label="Agrupación" hint="En el flujo manda la agrupación de la cabeza.">
                <Select required value={agrupacionId} onChange={(e) => setAgrupacionId(e.target.value)}>
                  <option value="">—</option>
                  {activas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.nombre}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <VistaPreviaNombre nombre={nombreFinal} codigo={codigoPropuesto} />
            {generica && <p className="text-xs text-alerta">VARIOS, OTROS y SIN MARCA no pueden ser cabeza de un conjunto.</p>}
          </>
        ) : (
          <Field label="Marca cabeza" hint={`${candidatas.length} marcas activas disponibles (no son miembros ni ya cabezas de otro conjunto).`}>
            <Select value={existenteId} onChange={(e) => setExistenteId(e.target.value)} autoFocus>
              <option value="">Elige una marca…</option>
              {candidatas.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre} · {m.agrupacion_marca.nombre}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </Modal>
  );
}
