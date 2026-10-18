"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api-client";
import { IMI_MAX_DEFECTO, IMI_MIN_DEFECTO, type ReglaIntercompanyApi } from "@/lib/intercompany/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAccion, useAplicabilidad } from "./use-intercompany";
import {
  avisoMarcaSinClave,
  claveDeRegla,
  cuerpoCrear,
  cuerpoEditar,
  formatearPct,
  hayCambios,
  leerDecimal,
  MAX_NOTA,
  MESES_ADELANTE,
  MESES_ATRAS,
  mesPropuesto,
  nodosParaSelector,
  opcionesMes,
  pctCd,
  periodoCorto,
  rutaNodo,
  TEXTO_AVISO_SIN_CLAVE,
  textoEditable,
  textoErrorAccion,
  validarRegla,
  VALORES_VACIOS,
  valoresDeRegla,
  valoresNuevaVigencia,
  type CampoRegla,
  type NodoIntercompany,
  type ValoresRegla,
} from "./vista";

export type ModoDialogo = { tipo: "nueva" } | { tipo: "vigencia"; base: ReglaIntercompanyApi } | { tipo: "editar"; regla: ReglaIntercompanyApi };

const TITULO: Record<ModoDialogo["tipo"], string> = { nueva: "Nueva regla", vigencia: "Nueva vigencia", editar: "Editar regla" };

/**
 * Nueva regla, nueva vigencia y edición (ficha 13, sección 4). En "nueva vigencia" la clave (marca, GML y equivalencia) queda fija
 * y el rango, el porcentaje y la nota arrancan con los de la regla anterior; en "editar" solo se cambian rango, porcentaje y nota
 * (la fecha no se edita: se elimina y se crea). El botón se deshabilita mientras envía y el error de la API se muestra con `Alert`.
 * Si la marca no tendría clave en la cerrada se avisa antes de guardar y se pide confirmar (no bloquea).
 */
export function DialogoRegla({
  modo,
  marcas,
  nodos,
  reglas,
  hoy,
  onGuardada,
  onCerrar,
}: {
  modo: ModoDialogo;
  marcas: readonly { id: string; nombre: string }[];
  nodos: readonly NodoIntercompany[];
  /** Todas las reglas conocidas (historial): para avisar de una clave y mes repetidos antes de enviar. */
  reglas: readonly ReglaIntercompanyApi[];
  /** Mes en curso `aaaa-mm`. */
  hoy: string;
  onGuardada: (regla: ReglaIntercompanyApi) => void;
  onCerrar: () => void;
}) {
  const idForm = useId();
  const accion = useAccion();
  // El siguiente a hoy; en "nueva vigencia", el siguiente a la última regla de la clave si es posterior (no arranca con "mes repetido").
  const proximoMes = useMemo(() => mesPropuesto(hoy, reglas, modo.tipo === "vigencia" ? claveDeRegla(modo.base) : null), [hoy, reglas, modo]);
  const [valores, setValores] = useState<ValoresRegla>(() =>
    modo.tipo === "editar" ? valoresDeRegla(modo.regla) : modo.tipo === "vigencia" ? valoresNuevaVigencia(modo.base, proximoMes) : VALORES_VACIOS(proximoMes)
  );
  const [soloAmbito, setSoloAmbito] = useState(true);
  const [intentado, setIntentado] = useState(false);

  const editando = modo.tipo === "editar";
  const claveFija = modo.tipo !== "nueva";
  const aplicabilidad = useAplicabilidad(editando ? "" : valores.marcaId, editando ? "" : valores.nodoId);
  const sinClave = !editando && avisoMarcaSinClave(aplicabilidad.datos);

  const nodoFijo = claveFija ? (modo.tipo === "editar" ? modo.regla.genero_mundo_linea_id : modo.base.genero_mundo_linea_id) : null;
  const nodosOpciones = useMemo(() => nodosParaSelector(nodos, soloAmbito, nodoFijo ?? (valores.nodoId || null)), [nodos, soloAmbito, nodoFijo, valores.nodoId]);
  const nodo = nodos.find((n) => n.id === valores.nodoId) ?? null;
  const meses = useMemo(() => opcionesMes(hoy, MESES_ATRAS, MESES_ADELANTE, valores.mes ? [valores.mes] : []), [hoy, valores.mes]);

  const { errores, valida } = validarRegla(valores, { existentes: reglas, editandoId: editando ? modo.regla.id : null, soloRangoYPorcentaje: editando });
  const cambios = editando ? cuerpoEditar(valores, modo.regla) : {};
  const pct = leerDecimal(valores.pct);
  const marcaFija = marcas.find((m) => m.id === valores.marcaId)?.nombre ?? (modo.tipo !== "nueva" ? (modo.tipo === "editar" ? modo.regla.marca : modo.base.marca) : "");
  const rutaFija = nodo ? rutaNodo(nodo) : modo.tipo === "nueva" ? "" : modo.tipo === "editar" ? modo.regla.ruta : modo.base.ruta;

  const poner = (c: Partial<ValoresRegla>) => setValores((v) => ({ ...v, ...c }));
  // Errores que se muestran siempre porque nacen de lo que el planner escribió (rango, mes repetido) y los que esperan al primer intento.
  const error = (c: CampoRegla): string | undefined => (intentado || c === "imiMin" || c === "imiMax" || c === "mes" || (c === "pct" && valores.pct !== "") ? errores[c] : undefined);

  async function guardar() {
    setIntentado(true);
    if (!valida) return;
    if (editando && !hayCambios(cambios)) {
      onCerrar();
      return;
    }
    if (sinClave && !confirm(`${TEXTO_AVISO_SIN_CLAVE}\n\n¿Guardarla de todos modos?`)) return;
    const r = await accion.ejecutar(() =>
      editando ? api.patch<ReglaIntercompanyApi>(`/api/intercompany/reglas/${modo.regla.id}`, cambios) : api.post<ReglaIntercompanyApi>("/api/intercompany/reglas", cuerpoCrear(valores))
    );
    if (r.ok) onGuardada(r.valor);
  }

  const campoError = (c: CampoRegla, hijo: ReactNode) => (
    <>
      {hijo}
      {error(c) && (
        <span id={`${idForm}-${c}`} role="alert" className="mt-1 block text-xs text-alerta">
          {error(c)}
        </span>
      )}
    </>
  );
  const invalido = (c: CampoRegla) => (error(c) ? { "aria-invalid": true as const, "aria-describedby": `${idForm}-${c}` } : {});

  return (
    <Modal
      titulo={TITULO[modo.tipo]}
      descripcion={
        modo.tipo === "vigencia"
          ? "Una regla nueva de la misma clave desde otro mes: la anterior sigue rigiendo hasta entonces."
          : editando
            ? "Cambia el rango, el porcentaje o la nota. La fecha no se edita: elimina la regla y crea otra."
            : "Qué parte de la venta de la marca llega directo del intercompany y qué rango de meses de inventario (IMI) debe tener en ese GML."
      }
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho="max-w-2xl"
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={accion.ocupado}>
            Cancelar
          </Button>
          <Button type="submit" form={idForm} disabled={accion.ocupado}>
            {accion.ocupado ? "Guardando…" : editando ? "Guardar cambios" : "Guardar regla"}
          </Button>
        </>
      }
    >
      <form
        id={idForm}
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void guardar();
        }}
      >
        {accion.error && <Alert onCerrar={accion.limpiar}>{textoErrorAccion(accion.error)}</Alert>}

        {claveFija ? (
          <div className="rounded-md border border-borde bg-neutro-suave px-3 py-2 text-sm">
            <p className="font-medium text-tinta">{marcaFija}</p>
            <p className="text-tinta-suave">
              {editando ? modo.regla.ruta : rutaFija}
              {editando ? ` · desde ${periodoCorto(modo.regla.vigente_desde)}` : ""}
            </p>
          </div>
        ) : (
          <>
            <Field label="Marca" hint="Un miembro de un conjunto se ofrece como su cabeza.">
              {campoError(
                "marcaId",
                <Select value={valores.marcaId} onChange={(e) => poner({ marcaId: e.target.value })} {...invalido("marcaId")}>
                  <option value="">Elige la marca…</option>
                  {marcas.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.nombre}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="GML">
              {campoError(
                "nodoId",
                <Select value={valores.nodoId} onChange={(e) => poner({ nodoId: e.target.value, equivalenciaId: "" })} {...invalido("nodoId")}>
                  <option value="">Elige el género · mundo · línea…</option>
                  {nodosOpciones.map((n) => (
                    <option key={n.id} value={n.id}>
                      {rutaNodo(n)}
                      {n.nivel === "GMLE" ? " (por equivalencia)" : ""}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <label className="flex items-center gap-2 text-sm text-tinta-suave">
              <Checkbox checked={soloAmbito} onChange={setSoloAmbito} label="Mostrar solo hombre formal, casual y RI" />
              Solo hombre formal, casual y RI (ámbito sugerido)
            </label>
            {nodo && nodo.nivel === "GMLE" && (
              <Field label="Equivalencia (opcional)" hint="Sin elegir, la regla es del GML entero; la de una equivalencia manda sobre la del GML.">
                <Select value={valores.equivalenciaId} onChange={(e) => poner({ equivalenciaId: e.target.value })}>
                  <option value="">Todo el GML</option>
                  {nodo.equivalencias
                    .filter((q) => q.activo)
                    .map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.nombre}
                      </option>
                    ))}
                </Select>
              </Field>
            )}
          </>
        )}

        {!editando && (
          <Field label="Vigente desde" hint="Rige desde ese mes (inclusive) y hasta la regla siguiente de la misma clave.">
            {campoError(
              "mes",
              <Select value={valores.mes} onChange={(e) => poner({ mes: e.target.value })} {...invalido("mes")}>
                {meses.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nombre}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-tinta">Rango IMI (meses de inventario)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Mínimo">
              {campoError("imiMin", <Input inputMode="decimal" value={valores.imiMin} onChange={(e) => poner({ imiMin: e.target.value })} {...invalido("imiMin")} />)}
            </Field>
            <Field label="Máximo">
              {campoError("imiMax", <Input inputMode="decimal" value={valores.imiMax} onChange={(e) => poner({ imiMax: e.target.value })} {...invalido("imiMax")} />)}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-tinta-suave">
            <span>
              Por defecto {IMI_MIN_DEFECTO}–{IMI_MAX_DEFECTO}, el mismo rango general del flujo.
            </span>
            <Button
              variante="fantasma"
              tamano="sm"
              onClick={() => poner({ imiMin: textoEditable(IMI_MIN_DEFECTO), imiMax: textoEditable(IMI_MAX_DEFECTO) })}
              disabled={leerDecimal(valores.imiMin) === IMI_MIN_DEFECTO && leerDecimal(valores.imiMax) === IMI_MAX_DEFECTO}
            >
              Volver a {IMI_MIN_DEFECTO}–{IMI_MAX_DEFECTO}
            </Button>
          </div>
        </fieldset>

        <Field label="% directo" hint="Parte de la demanda de la marca que llega directo del intercompany por compras regulares (0 a 100).">
          <div className="flex items-center gap-3">
            <div className="w-32">{campoError("pct", <Input inputMode="decimal" value={valores.pct} onChange={(e) => poner({ pct: e.target.value })} placeholder="80" {...invalido("pct")} />)}</div>
            <span className="text-sm text-tinta-suave" aria-live="polite">
              {pct !== null && pct >= 0 && pct <= 100 ? `% del CD: ${formatearPct(pctCd(pct))}` : "% del CD: —"}
            </span>
          </div>
        </Field>

        <Field label="Nota (opcional)" hint={`${valores.nota.trim().length} / ${MAX_NOTA}`}>
          {campoError("nota", <Input value={valores.nota} maxLength={MAX_NOTA + 50} onChange={(e) => poner({ nota: e.target.value })} {...invalido("nota")} />)}
        </Field>

        {sinClave && <Alert>{TEXTO_AVISO_SIN_CLAVE} Al guardar se te pedirá confirmar.</Alert>}
      </form>
    </Modal>
  );
}
