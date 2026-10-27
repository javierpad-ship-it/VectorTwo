"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { Switch } from "@/components/ui/switch";
import { parametrosFlujoSchema } from "@/lib/flujo/esquemas";
import type { ParametrosFlujoApi, ParametrosFlujoCuerpo } from "@/lib/flujo/tipos-api";
import { guardarParametros, useAccion } from "@/lib/flujo/use-flujo";
import { nombreMes } from "./formato";

/**
 * Parámetros del flujo (ficha 08 §4.3; solo admin y planner): IMI mínimo y máximo, meses de la tarjeta, extender el horizonte, fechas de
 * las temporadas y umbrales de la conciliación. Los valores se validan con el mismo esquema que la API y los mensajes salen tal cual.
 * Cambiar las fechas de temporada deja obsoletos los repartos de las marcas al barrer (hay que aprobar una versión nueva) y los lotes ya
 * registrados conservan el suyo hasta que se aplique: el diálogo lo avisa antes de guardar.
 */

type Valores = {
  imi_min: string;
  imi_max: string;
  meses_tarjeta: string;
  extender_horizonte: boolean;
  verano_desde: string;
  verano_hasta: string;
  invierno_desde: string;
  invierno_hasta: string;
  umbral_conciliacion_u: string;
  umbral_conciliacion_pct: string;
};

const texto = (n: number) => String(Math.round(n * 100) / 100);

export const valoresDeParametros = (p: ParametrosFlujoApi): Valores => ({
  imi_min: texto(p.imi_min),
  imi_max: texto(p.imi_max),
  meses_tarjeta: String(p.meses_tarjeta),
  extender_horizonte: p.extender_horizonte,
  verano_desde: String(p.temporadas.verano.desde_mes),
  verano_hasta: String(p.temporadas.verano.hasta_mes),
  invierno_desde: String(p.temporadas.invierno.desde_mes),
  invierno_hasta: String(p.temporadas.invierno.hasta_mes),
  umbral_conciliacion_u: String(p.umbral_conciliacion_u),
  umbral_conciliacion_pct: texto(p.umbral_conciliacion_pct),
});

/** Los números se leen con punto o coma decimal; un texto vacío o no numérico queda como `NaN` y el esquema lo rechaza con su mensaje. */
const leer = (t: string) => (t.trim() === "" ? Number.NaN : Number(t.replace(",", ".")));

export function cuerpoDeValores(v: Valores): ParametrosFlujoCuerpo {
  return {
    imi_min: leer(v.imi_min),
    imi_max: leer(v.imi_max),
    meses_tarjeta: leer(v.meses_tarjeta),
    extender_horizonte: v.extender_horizonte,
    temporadas: {
      verano: { desde_mes: leer(v.verano_desde), hasta_mes: leer(v.verano_hasta) },
      invierno: { desde_mes: leer(v.invierno_desde), hasta_mes: leer(v.invierno_hasta) },
    },
    umbral_conciliacion_u: leer(v.umbral_conciliacion_u),
    umbral_conciliacion_pct: leer(v.umbral_conciliacion_pct),
  };
}

/** Primer mensaje de error del esquema (los mismos que devuelve la API), o `null` si todo es válido. */
export function errorDeValores(v: Valores): string | null {
  const r = parametrosFlujoSchema.safeParse(cuerpoDeValores(v));
  return r.success ? null : (r.error.issues[0]?.message ?? "Revisa los valores.");
}

const MESES = Array.from({ length: 12 }, (_, i) => i + 1);

function SelectorMes({ etiqueta, valor, onChange }: { etiqueta: string; valor: string; onChange: (v: string) => void }) {
  return (
    <Field label={etiqueta}>
      <Select value={valor} onChange={(e) => onChange(e.target.value)}>
        {MESES.map((m) => (
          <option key={m} value={m}>
            {nombreMes(`2000-${String(m).padStart(2, "0")}`)}
          </option>
        ))}
      </Select>
    </Field>
  );
}

export function DialogoParametros({ parametros, onGuardado, onCerrar }: { parametros: ParametrosFlujoApi; onGuardado: (p: ParametrosFlujoApi) => void; onCerrar: () => void }) {
  const [v, setV] = useState<Valores>(() => valoresDeParametros(parametros));
  const accion = useAccion();
  const [intento, setIntento] = useState(false);
  const campo = <K extends keyof Valores>(k: K) => (valor: Valores[K]) => setV((x) => ({ ...x, [k]: valor }));
  const error = errorDeValores(v);
  const cambioTemporadas =
    v.verano_desde !== String(parametros.temporadas.verano.desde_mes) ||
    v.verano_hasta !== String(parametros.temporadas.verano.hasta_mes) ||
    v.invierno_desde !== String(parametros.temporadas.invierno.desde_mes) ||
    v.invierno_hasta !== String(parametros.temporadas.invierno.hasta_mes);

  async function guardar() {
    setIntento(true);
    if (error) return;
    if (cambioTemporadas && !confirm("Cambiar las fechas de temporada deja obsoletos los repartos de las marcas al barrer: habrá que aprobar una versión nueva en Marcas al barrer. Los lotes ya registrados conservan su reparto hasta que se aplique. ¿Guardar?")) return;
    const r = await accion.ejecutar(() => guardarParametros(cuerpoDeValores(v)));
    if (r.ok) onGuardado(r.valor);
  }

  return (
    <Modal
      titulo="Parámetros del flujo"
      descripcion="Valen para toda la compañía. El rango de cada marca intercompany se edita en Maestros › Intercompany."
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho="max-w-2xl"
      pie={
        <>
          <Button variante="secundario" onClick={onCerrar} disabled={accion.ocupado}>
            Cancelar
          </Button>
          <Button onClick={() => void guardar()} disabled={accion.ocupado}>
            {accion.ocupado ? "Guardando…" : "Guardar parámetros"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="IMI mínimo (meses)" hint="Por debajo hay «falta»">
            <Input inputMode="decimal" value={v.imi_min} onChange={(e) => campo("imi_min")(e.target.value)} aria-invalid={intento && error !== null} />
          </Field>
          <Field label="IMI máximo (meses)" hint="Por encima hay «exceso»">
            <Input inputMode="decimal" value={v.imi_max} onChange={(e) => campo("imi_max")(e.target.value)} aria-invalid={intento && error !== null} />
          </Field>
          <Field label="Meses de la tarjeta" hint="Saldo de los próximos N meses">
            <Input inputMode="numeric" value={v.meses_tarjeta} onChange={(e) => campo("meses_tarjeta")(e.target.value)} />
          </Field>
        </div>
        <Switch
          checked={v.extender_horizonte}
          onChange={campo("extender_horizonte")}
          label="Extender el horizonte: repetir los últimos doce meses proyectados para promediar la venta de los meses finales"
          className="items-start"
        />
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-tinta">Temporadas (de llegada)</legend>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SelectorMes etiqueta="Verano desde" valor={v.verano_desde} onChange={campo("verano_desde")} />
            <SelectorMes etiqueta="Verano hasta" valor={v.verano_hasta} onChange={campo("verano_hasta")} />
            <SelectorMes etiqueta="Invierno desde" valor={v.invierno_desde} onChange={campo("invierno_desde")} />
            <SelectorMes etiqueta="Invierno hasta" valor={v.invierno_hasta} onChange={campo("invierno_hasta")} />
          </div>
          <p className="text-xs text-tinta-suave">Deben cubrir los doce meses sin solaparse (por defecto, verano de octubre a marzo e invierno de abril a septiembre).</p>
        </fieldset>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Umbral de la conciliación (unidades)" hint="Ingreso sin registrar que se avisa como mínimo">
            <Input inputMode="numeric" value={v.umbral_conciliacion_u} onChange={(e) => campo("umbral_conciliacion_u")(e.target.value)} />
          </Field>
          <Field label="Umbral de la conciliación (% del ingreso)" hint="O este porcentaje, si es mayor">
            <Input inputMode="decimal" value={v.umbral_conciliacion_pct} onChange={(e) => campo("umbral_conciliacion_pct")(e.target.value)} />
          </Field>
        </div>
        {cambioTemporadas && <Alert tono="info">Estás cambiando las fechas de temporada: los repartos de las marcas al barrer pasarán a «Obsoleto» y hará falta aprobar una versión nueva.</Alert>}
        {intento && error && <Alert>{error}</Alert>}
        {accion.error && <Alert onCerrar={accion.limpiar}>{accion.error.mensaje}</Alert>}
        {parametros.usuario_nombre && parametros.updated_at && (
          <p className="text-xs text-tinta-suave">
            Último cambio: {parametros.usuario_nombre}, {parametros.updated_at.slice(0, 10)}.
          </p>
        )}
      </div>
    </Modal>
  );
}
