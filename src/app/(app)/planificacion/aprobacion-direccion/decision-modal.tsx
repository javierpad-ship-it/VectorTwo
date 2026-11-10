"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { MAX_COMENTARIO_DIRECCION, MIN_COMENTARIO_DIRECCION, MOTIVOS_DIRECCION, type AprobacionApi, type MotivoDireccion, type ResultadoAprobacion, type TableroApi } from "@/lib/direccion/tipos-api";
import { ETIQUETA_MOTIVO } from "@/components/direccion/formato";
import { useAccion, type ErrorAccion } from "../proyeccion/use-proyeccion";
import { BloqueosCierre, ListaAlertas } from "./alertas-tablero";
import {
  cuerpoDecision,
  largoComentario,
  motivoNoEnviar,
  OPCIONES_RESULTADO,
  RUTA_API_DIRECCION,
  TEXTO_CONFIRMO,
  TEXTO_EN_TRABAJO_AL_DECIDIR,
  TEXTO_HUELLA_DISTINTA,
  type FiltrosVista,
  type FormularioDecision,
  type VistaBloqueos,
} from "./vista-tablero";

const ESTADO_EN_TEXTO: Record<TableroApi["proyeccion"]["estado"], string> = { en_trabajo: "en trabajo", cerrada: "cerrada", archivada: "archivada" };

type PropsContenido = {
  tablero: TableroApi;
  bloqueos: VistaBloqueos;
  formulario: FormularioDecision;
  onFormulario: (cambio: Partial<FormularioDecision>) => void;
  error: ErrorAccion | null;
  ocupado: boolean;
  onRecargar: () => void;
};

/**
 * El cuerpo del diálogo de decisión (ficha 14, §4.10): sobre qué se decide (la proyección ENTERA, no el recorte), el resumen, lo que bloquearía el
 * cierre y las alertas importantes, las tres opciones, el motivo y el comentario (obligatorios si no es «Aprobar», con contador) y la casilla
 * obligatoria. Sin estado propio: lo lleva `DecisionModal`.
 */
export function ContenidoDecision({ tablero, bloqueos, formulario, onFormulario, error, ocupado, onRecargar }: PropsContenido) {
  const p = tablero.proyeccion;
  const exigeMotivo = formulario.resultado !== null && formulario.resultado !== "aprobada";
  const largo = largoComentario(formulario.comentario);
  const huellaDistinta = error?.codigo === "huella_distinta";
  return (
    <div className="space-y-4">
      <p className="text-sm text-tinta">
        Vas a decidir sobre{" "}
        <strong>
          {p.nombre} ({ESTADO_EN_TEXTO[p.estado]})
        </strong>{" "}
        completa, no sobre el recorte que estás mirando.
      </p>

      {huellaDistinta && (
        <Alert tono="alerta">
          <span className="block">{TEXTO_HUELLA_DISTINTA}</span>
          <span className="mt-2 block">
            <Button variante="secundario" className="h-11! px-5!" onClick={onRecargar}>
              Recargar
            </Button>
          </span>
        </Alert>
      )}
      {error && !huellaDistinta && <Alert tono="alerta">{error.mensaje}</Alert>}

      <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-tinta">
        {tablero.decidir.lineas.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ol>

      {bloqueos.estado !== "no_aplica" && (
        <div className="space-y-1">
          <BloqueosCierre bloqueos={bloqueos} />
          {bloqueos.estado === "listo" && bloqueos.duros.length > 0 && <p className="text-xs text-tinta-suave">Puedes aprobar igual: la aprobación es un juicio de dirección, no un control del cierre.</p>}
        </div>
      )}
      <ListaAlertas alertas={tablero.alertas.filter((a) => a.nivel === "importante")} alcance="proyeccion" vacio="Sin alertas importantes." />

      {p.estado === "en_trabajo" && <Alert tono="info">{TEXTO_EN_TRABAJO_AL_DECIDIR}</Alert>}

      <div role="radiogroup" aria-label="Decisión" className="grid gap-2 sm:grid-cols-3">
        {OPCIONES_RESULTADO.map((o) => {
          const elegida = formulario.resultado === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={elegida}
              disabled={ocupado || huellaDistinta}
              onClick={() => onFormulario({ resultado: o.id })}
              className={`min-h-11 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-marca disabled:cursor-not-allowed disabled:opacity-50 ${
                elegida ? (o.id === "rechazada" ? "border-alerta bg-alerta-suave text-alerta" : "border-marca bg-marca-suave text-marca-oscura") : "border-borde bg-superficie text-tinta hover:bg-neutro-suave"
              }`}
            >
              {o.etiqueta}
            </button>
          );
        })}
      </div>

      {exigeMotivo && (
        <Field label="Motivo">
          <Select className="h-11" value={formulario.motivo} disabled={ocupado || huellaDistinta} onChange={(e) => onFormulario({ motivo: e.target.value as MotivoDireccion | "" })}>
            <option value="">Elige un motivo</option>
            {MOTIVOS_DIRECCION.map((m) => (
              <option key={m} value={m}>
                {ETIQUETA_MOTIVO[m]}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {formulario.resultado !== null && (
        <Field
          label={exigeMotivo ? "Comentario (obligatorio)" : "Comentario (opcional)"}
          hint={`${largo} de ${MAX_COMENTARIO_DIRECCION} caracteres${exigeMotivo ? ` · mínimo ${MIN_COMENTARIO_DIRECCION}${largo < MIN_COMENTARIO_DIRECCION ? ` (faltan ${MIN_COMENTARIO_DIRECCION - largo})` : ""}` : ""}`}
        >
          <Textarea rows={4} maxLength={MAX_COMENTARIO_DIRECCION} value={formulario.comentario} disabled={ocupado || huellaDistinta} onChange={(e) => onFormulario({ comentario: e.target.value })} />
        </Field>
      )}

      <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-borde px-3 py-2 text-sm text-tinta">
        <Checkbox checked={formulario.confirmo} disabled={ocupado || huellaDistinta} onChange={(v) => onFormulario({ confirmo: v })} label={TEXTO_CONFIRMO} className="h-5 w-5 shrink-0" />
        <span>{TEXTO_CONFIRMO}</span>
      </label>
    </div>
  );
}

const TEXTO_BOTON: Record<ResultadoAprobacion, string> = { aprobada: "Registrar aprobación", con_observaciones: "Registrar con observaciones", rechazada: "Registrar rechazo" };

/**
 * Decisión de dirección (ficha 14, §4.10; solo admin): registra una aprobación sobre la huella de cifras que el admin tiene en pantalla. Si la
 * proyección cambió entre tanto, la API responde `409 huella_distinta`: no se registra nada y se ofrece «Recargar». El botón queda deshabilitado
 * mientras envía y hasta que el formulario cumple las reglas (las mismas que valida el servidor). Al registrar, se cierra y la pantalla se relee.
 */
export function DecisionModal({
  tablero,
  filtros,
  bloqueos,
  onCerrar,
  onRegistrada,
  onRecargar,
}: {
  tablero: TableroApi;
  filtros: FiltrosVista;
  bloqueos: VistaBloqueos;
  onCerrar: () => void;
  onRegistrada: (a: AprobacionApi) => void;
  onRecargar: () => void;
}) {
  const [formulario, setFormulario] = useState<FormularioDecision>({ resultado: null, motivo: "", comentario: "", confirmo: false });
  const accion = useAccion();
  const falta = motivoNoEnviar(formulario);
  const huellaDistinta = accion.error?.codigo === "huella_distinta";

  async function enviar() {
    if (formulario.resultado === null || falta !== null) return;
    const cuerpo = cuerpoDecision({ ...formulario, resultado: formulario.resultado }, tablero, filtros);
    const r = await accion.ejecutar(() => api.post<AprobacionApi>(`${RUTA_API_DIRECCION}/aprobaciones`, cuerpo));
    if (r.ok) onRegistrada(r.valor);
  }

  return (
    <Modal
      titulo="Decisión de dirección"
      descripcion="Queda registrada a tu nombre, con la fecha y las cifras exactas que estás viendo. No bloquea el cierre ni las compras."
      ancho="max-w-2xl"
      cerrable={!accion.ocupado}
      onCerrar={onCerrar}
      pie={
        <>
          {falta !== null && !huellaDistinta && <p className="mr-auto min-w-0 flex-1 basis-full text-xs text-tinta-suave sm:basis-0">{falta}</p>}
          <Button variante="secundario" className="h-11! px-5!" onClick={onCerrar} disabled={accion.ocupado}>
            Cancelar
          </Button>
          <Button variante={formulario.resultado === "rechazada" ? "peligro" : "primario"} className="h-11! px-5!" onClick={() => void enviar()} disabled={accion.ocupado || falta !== null || huellaDistinta}>
            {accion.ocupado ? "Registrando…" : formulario.resultado ? TEXTO_BOTON[formulario.resultado] : "Registrar decisión"}
          </Button>
        </>
      }
    >
      <ContenidoDecision
        tablero={tablero}
        bloqueos={bloqueos}
        formulario={formulario}
        onFormulario={(c) => {
          accion.limpiar();
          setFormulario((f) => ({ ...f, ...c }));
        }}
        error={accion.error}
        ocupado={accion.ocupado}
        onRecargar={onRecargar}
      />
    </Modal>
  );
}
