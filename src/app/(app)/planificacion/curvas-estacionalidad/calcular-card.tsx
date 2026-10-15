"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { mensajeError } from "@/lib/formato";
import { TRATAMIENTOS_ATIPICOS, type CalcularRespuesta, type EstadoCurvasApi, type TratamientoAtipicos } from "@/lib/curvas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { REGLAS_CAMPOS, validarFormulario, type CampoNumerico, type FormularioParametros } from "./parametros-form";
import { formatearFechaHora, vistaPreviaDatos } from "./vista";

const ETIQUETA_TRATAMIENTO_PARAM: Record<TratamientoAtipicos, string> = {
  auto: "Automático (según lo que mida la forma)",
  incluir: "Incluir los años atípicos tal cual",
  imputar: "Imputar los meses atípicos con la referencia",
  descartar: "Descartar los años atípicos",
};

const AYUDAS: Record<CampoNumerico, string> = {
  meses_tienda_nueva: "0 = no aplica: la tienda cuenta desde su primer año calendario completo.",
  umbral_tienda_dominante: "Avisa «tienda dominante» cuando la mayor pesa más que esto.",
  umbral_forma: "Piso: el umbral efectivo es el mayor entre este piso y el ruido entre años normales.",
  max_meses_hueco: "Con más meses atípicos, el año se trata como atípico completo (nunca se imputa).",
  min_unidades_ano: "Un año con menos unidades queda «escaso» y no entra en el ajuste.",
  umbral_cambio_volumen: "Avisa si un año vende más de tantas veces (o menos de su inversa) que el anterior.",
  margen_ruido: "Una candidata desbanca al promedio solo si lo mejora en más de este margen × el ruido entre años normales.",
  peso_minimo_diagnostico: "Una tienda solo se marca «distinta» si pesa al menos esto.",
  umbral_liquidacion: "Un mes está en liquidación si su CV % supera la mediana en más de esto (relativo).",
};

/**
 * Tarjeta «Calcular»: parámetros de la corrida con sus defectos y ayudas, vista
 * previa de los meses y periodos, botón Calcular y calendario de revisión. El
 * estado del formulario vive en el panel (lo comparten «Ver red» y la pestaña
 * Años Niño). Recalcular una obsoleta abre esta tarjeta con los parámetros de la
 * corrida de referencia.
 */
export function CalcularCard({
  formulario,
  onFormulario,
  estado,
  abiertoInicial,
  onCalculada,
}: {
  formulario: FormularioParametros;
  onFormulario: (f: FormularioParametros) => void;
  estado: EstadoCurvasApi | null;
  abiertoInicial: boolean;
  /** Corrida nueva calculada: el panel la selecciona y recarga. */
  onCalculada: (r: CalcularRespuesta) => Promise<void> | void;
}) {
  const [parametrosAbiertos, setParametrosAbiertos] = useState(abiertoInicial);
  const [calculando, setCalculando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const { errores } = useMemo(() => validarFormulario(formulario), [formulario]);
  const hayErrores = Object.keys(errores).length > 0;
  const cambiar = <K extends keyof FormularioParametros>(k: K, v: FormularioParametros[K]) => onFormulario({ ...formulario, [k]: v });

  const vista = estado
    ? vistaPreviaDatos(estado.datos, estado.periodos_atipicos.filter((p) => p.activo).length, estado.resumen.por_temporada)
    : null;
  const sinCorridas = estado !== null && estado.corridas.length === 0;

  async function calcular() {
    const { cuerpo } = validarFormulario(formulario);
    if (!cuerpo) {
      setParametrosAbiertos(true);
      return;
    }
    setCalculando(true);
    setError(null);
    setAviso(null);
    try {
      const r = await api.post<CalcularRespuesta>("/api/curvas/calcular", cuerpo);
      const res = r.corrida.resumen;
      setAviso(
        `Corrida del ${formatearFechaHora(r.corrida.created_at)}: ${res.propias} con curva propia, ${res.prestadas} ${res.prestadas === 1 ? "prestada" : "prestadas"}, ${res.sin_venta} sin venta.`
      );
      await onCalculada(r);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setCalculando(false);
    }
  }

  const numero = (campo: CampoNumerico) => (
    <Field key={campo} label={REGLAS_CAMPOS[campo].etiqueta} hint={errores[campo] ?? AYUDAS[campo]}>
      <Input
        inputMode="decimal"
        value={formulario[campo]}
        disabled={calculando}
        onChange={(e) => cambiar(campo, e.target.value)}
        aria-invalid={errores[campo] !== undefined}
      />
    </Field>
  );

  return (
    <Card
      titulo="Calcular curvas"
      descripcion="Corre el modelo sobre la venta publicada en M5. Nada se aprueba solo: cada curva se aprueba una por una desde su detalle."
    >
      <div className="space-y-4">
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
        {aviso && (
          <Alert tono="exito" onCerrar={() => setAviso(null)}>
            {aviso}
          </Alert>
        )}

        {vista && <p className="text-sm text-tinta-suave">{vista}.</p>}

        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <Field label="Hasta el mes" hint="Vacío: el último mes publicado y cerrado." className="w-48">
            <Input
              type="month"
              value={formulario.hasta_periodo}
              min="2000-01"
              max="2100-12"
              disabled={calculando}
              onChange={(e) => cambiar("hasta_periodo", e.target.value)}
              aria-invalid={errores.hasta_periodo !== undefined}
            />
          </Field>
          <div className="pb-6">
            <Switch
              checked={formulario.marcar_referencia}
              onChange={(v) => cambiar("marcar_referencia", v)}
              label={sinCorridas ? "Marcar como referencia (la primera siempre lo es)" : "Marcar esta corrida como referencia"}
              disabled={calculando || sinCorridas}
            />
          </div>
          <div className="flex items-center gap-3 pb-6">
            <Button onClick={() => void calcular()} disabled={calculando || hayErrores || estado === null}>
              {calculando ? "Refrescando el agregado y calculando…" : "Calcular"}
            </Button>
            <Button variante="fantasma" tamano="sm" aria-expanded={parametrosAbiertos} aria-controls="parametros-calculo" onClick={() => setParametrosAbiertos((a) => !a)}>
              {parametrosAbiertos ? "Ocultar parámetros" : "Parámetros"}
            </Button>
          </div>
        </div>
        {calculando && (
          <p className="text-xs text-tinta-suave" role="status">
            Refrescar el agregado de venta toma de 2 a 5 segundos; después el cálculo es inmediato. Si otra corrida está en curso, la API lo avisa.
          </p>
        )}

        <div id="parametros-calculo" hidden={!parametrosAbiertos} className="space-y-5 border-t border-borde pt-4">
          {parametrosAbiertos && (
            <>
              <fieldset className="space-y-3" disabled={calculando}>
                <legend className="mb-1 text-sm font-semibold text-tinta">Red comparable</legend>
                <div className="flex flex-wrap gap-x-8 gap-y-2">
                  <Switch checked={formulario.solo_tiendas_completas} onChange={(v) => cambiar("solo_tiendas_completas", v)} label="Solo tiendas abiertas todo el año" disabled={calculando} />
                  <Switch checked={formulario.exigir_venta_todo_el_ano} onChange={(v) => cambiar("exigir_venta_todo_el_ano", v)} label="Exigir venta en todos los meses" disabled={calculando} />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  {numero("meses_tienda_nueva")}
                  {numero("umbral_tienda_dominante")}
                </div>
              </fieldset>

              <fieldset className="space-y-3" disabled={calculando}>
                <legend className="mb-1 text-sm font-semibold text-tinta">Años atípicos</legend>
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Tratamiento de los años atípicos">
                    <Select value={formulario.tratamiento_atipicos} disabled={calculando} onChange={(e) => cambiar("tratamiento_atipicos", e.target.value as TratamientoAtipicos)}>
                      {TRATAMIENTOS_ATIPICOS.map((t) => (
                        <option key={t} value={t}>
                          {ETIQUETA_TRATAMIENTO_PARAM[t]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {numero("umbral_forma")}
                  {numero("max_meses_hueco")}
                </div>
              </fieldset>

              <fieldset className="space-y-3" disabled={calculando}>
                <legend className="mb-1 text-sm font-semibold text-tinta">Agrupaciones pequeñas, recomendación, diagnóstico y liquidación</legend>
                <div className="grid gap-4 md:grid-cols-3">
                  {numero("min_unidades_ano")}
                  {numero("umbral_cambio_volumen")}
                  {numero("margen_ruido")}
                  {numero("peso_minimo_diagnostico")}
                  {numero("umbral_liquidacion")}
                </div>
              </fieldset>
            </>
          )}
        </div>

        <p className="border-t border-borde pt-3 text-xs text-tinta-suave">
          Calendario de revisión sugerido: recalcula al cerrar cada año calendario (cuando se publica diciembre) y cuando una tienda cumpla su primer año completo; además,
          siempre que la tabla marque curvas obsoletas con su motivo. No hay recálculo automático.
        </p>
      </div>
    </Card>
  );
}
