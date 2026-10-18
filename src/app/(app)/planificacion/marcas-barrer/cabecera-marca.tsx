"use client";

import { api } from "@/lib/api-client";
import { formatearNumero } from "@/lib/formato";
import { VENTANAS, type AnalisisMarcaApi, type ModalidadEfectiva } from "@/lib/marcas-barrer/tipos-api";
import { cuerpoModalidad, MODALIDADES_ELEGIBLES, textoConfirmarModalidad } from "@/components/marcas/comunes-m2b";
import { useGmlEspecial } from "@/components/marcas/use-gml-especial";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ChipsMultiples } from "@/components/ui/chips-multiples";
import { Field, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { useAccion } from "./use-marcas-barrer";
import { ETIQUETA_MODALIDAD_BARRER as ETIQUETA_MODALIDAD, ETIQUETA_MODO, periodoCorto, textoNino, TEXTO_AVISO, type ParametrosVista } from "./vista";

/**
 * Cabecera de la marca abierta (paso 1): quién es, su modalidad (con el atajo para cambiarla, que pide confirmación y
 * enumera lo que cambia), y los parámetros del análisis (ventana, modo, normalización del Niño y alcance). Los parámetros
 * viven en la URL: el padre los cambia y relee el análisis.
 */
export function CabeceraMarca({
  analisis,
  parametros,
  onParametros,
  onModalidadCambiada,
  ocupado,
}: {
  analisis: AnalisisMarcaApi;
  parametros: ParametrosVista;
  onParametros: (cambios: Partial<Pick<ParametrosVista, "ventana" | "modo" | "normalizaNino" | "alcance">>) => void;
  /** Se escribió la modalidad: el padre relee (o, si la marca dejó de ser analizable, vuelve a la lista). */
  onModalidadCambiada: (nueva: ModalidadEfectiva) => void;
  ocupado: boolean;
}) {
  const { marca, parametros: p } = analisis;
  const asignaciones = useGmlEspecial(false);
  const accion = useAccion();
  const mia = asignaciones.datos?.marcas.find((m) => m.id === marca.id);
  const gmlAsignados = mia?.gml ?? [];
  const nombreGml = (g: { genero: string; mundo: string; linea: string }) => `${g.genero} · ${g.mundo} · ${g.linea}`;

  async function cambiarModalidad(valor: string) {
    if (!MODALIDADES_ELEGIBLES.includes(valor as ModalidadEfectiva) || valor === marca.modalidad) return;
    const nueva = valor as ModalidadEfectiva;
    const cambian = marca.modalidad === "mixta" ? marca.gml_especificos.map((g) => g.ruta) : gmlAsignados.map(nombreGml);
    if (!confirm(textoConfirmarModalidad({ nombre: marca.nombre, de: marca.modalidad, a: nueva, gml: cambian, tieneReparto: analisis.vigente !== null }))) return;
    const r = await accion.ejecutar(() => api.patch(`/api/marcas/${marca.id}`, cuerpoModalidad(nueva)));
    if (r.ok) onModalidadCambiada(nueva);
  }

  const nino = textoNino(p.factores, p.normaliza_nino);
  const alcance = parametros.alcance;
  const opciones = analisis.opciones_alcance;
  const cambiarAlcance = (clave: "generos" | "mundos" | "lineas", ids: string[]) => onParametros({ alcance: { ...alcance, [clave]: ids } });
  const nAlcance = alcance.generos.length + alcance.mundos.length + alcance.lineas.length;

  return (
    <Card>
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-tinta">
              {marca.nombre}{" "}
              <Badge tono={marca.modalidad === "mixta" ? "marca" : "neutro"}>{ETIQUETA_MODALIDAD[marca.modalidad]}</Badge>
            </h2>
            <p className="mt-1 text-sm text-tinta-suave">
              Agrupación {marca.agrupacion_marca}
              {marca.miembros.length > 0 ? ` · conjunto: ${marca.miembros.join(", ")}` : ""} · ventana {periodoCorto(p.desde_periodo)} → {periodoCorto(p.hasta_periodo)} ({p.ventana_meses} m) ·{" "}
              {ETIQUETA_MODO[p.modo_efectivo]}
              {p.modo_efectivo !== p.modo ? " (cayó a anual: una temporada tiene pocos meses)" : ""}
              {nAlcance > 0 ? " · con alcance" : ""}
            </p>
            {nino && <p className="mt-0.5 text-sm text-tinta-suave">{nino}</p>}
            {marca.modalidad === "mixta" && (
              <p className="mt-0.5 text-sm text-tinta-suave">
                GML específicos: {marca.gml_especificos.length > 0 ? marca.gml_especificos.map((g) => g.ruta).join("; ") : "ninguno todavía (se comporta como al barrer)"}
              </p>
            )}
          </div>
          <Field label="Modalidad de la marca" className="w-48">
            <Select value={marca.modalidad} onChange={(e) => void cambiarModalidad(e.target.value)} disabled={accion.ocupado || ocupado}>
              {MODALIDADES_ELEGIBLES.map((m) => (
                <option key={m} value={m}>
                  {ETIQUETA_MODALIDAD[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {accion.error && <Alert onCerrar={accion.limpiar}>No se pudo cambiar la modalidad: {accion.error.mensaje}</Alert>}
        {asignaciones.error && <Alert onCerrar={() => asignaciones.setError(null)}>No se pudieron leer los GML asignados (el aviso de cambio de modalidad saldrá incompleto): {asignaciones.error}</Alert>}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
          <Field label="Ventana">
            <Select value={parametros.ventana} onChange={(e) => onParametros({ ventana: Number(e.target.value) as ParametrosVista["ventana"] })} disabled={ocupado}>
              {VENTANAS.map((v) => (
                <option key={v} value={v}>
                  {v} meses{v === 24 ? " (por defecto)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Modo del reparto">
            <Select value={parametros.modo} onChange={(e) => onParametros({ modo: e.target.value as ParametrosVista["modo"] })} disabled={ocupado}>
              {(Object.keys(ETIQUETA_MODO) as ParametrosVista["modo"][]).map((m) => (
                <option key={m} value={m}>
                  {ETIQUETA_MODO[m]}
                  {m === "por_temporada" ? " (por defecto)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <div className="pb-2">
            <Switch checked={parametros.normalizaNino} onChange={(v) => onParametros({ normalizaNino: v })} label="Normalizar el Niño" disabled={ocupado} />
          </div>
        </div>

        <fieldset className="space-y-2" aria-describedby="ayuda-alcance">
          <legend className="text-sm font-medium text-tinta">
            Alcance del reparto {nAlcance > 0 && <Button tamano="sm" variante="fantasma" onClick={() => onParametros({ alcance: { generos: [], mundos: [], lineas: [] } })}>Quitar el alcance</Button>}
          </legend>
          <p id="ayuda-alcance" className="text-xs text-tinta-suave">
            Vacío = todos los GML con venta al barrer. Acota, por ejemplo, «solo se compra para hombre»: lo que queda fuera no se reparte ni entra en el denominador.
          </p>
          <GrupoChips titulo="Género" items={opciones.generos} valor={alcance.generos} onCambiar={(ids) => cambiarAlcance("generos", ids)} disabled={ocupado} />
          <GrupoChips titulo="Mundo" items={opciones.mundos} valor={alcance.mundos} onCambiar={(ids) => cambiarAlcance("mundos", ids)} disabled={ocupado} />
          {opciones.lineas.length > 0 && (
            <details open={alcance.lineas.length > 0}>
              <summary className="cursor-pointer text-sm text-tinta-suave hover:text-tinta">
                Líneas ({opciones.lineas.length}
                {alcance.lineas.length > 0 ? `, ${alcance.lineas.length} elegidas` : ""})
              </summary>
              <div className="mt-2">
                <ChipsMultiples
                  etiqueta="Líneas del alcance"
                  items={opciones.lineas.map((o) => ({ id: o.id, label: o.nombre }))}
                  valor={alcance.lineas}
                  onCambiar={(ids) => cambiarAlcance("lineas", ids)}
                  disabled={ocupado}
                />
              </div>
            </details>
          )}
        </fieldset>

        {analisis.avisos.filter((a) => a !== "sin_reparto").length > 0 && (
          <Alert tono="info">
            <span className="block font-medium">Ten en cuenta:</span>
            <ul className="mt-1 list-disc pl-5">
              {analisis.avisos
                .filter((a) => a !== "sin_reparto")
                .map((a) => (
                  <li key={a}>{TEXTO_AVISO[a]}</li>
                ))}
            </ul>
          </Alert>
        )}
        <p className="text-xs text-tinta-suave">
          {formatearNumero(analisis.unidades_barrer)} unidades al barrer en la ventana
          {marca.modalidad === "mixta" ? ` y ${formatearNumero(analisis.unidades_especificas)} específicas` : ""}.
        </p>
      </div>
    </Card>
  );
}

function GrupoChips({ titulo, items, valor, onCambiar, disabled }: { titulo: string; items: { id: string; nombre: string }[]; valor: string[]; onCambiar: (ids: string[]) => void; disabled: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <span className="w-14 pt-1 text-xs font-medium uppercase tracking-wide text-tinta-suave">{titulo}</span>
      <ChipsMultiples etiqueta={`${titulo} del alcance`} items={items.map((o) => ({ id: o.id, label: o.nombre }))} valor={valor} onCambiar={onCambiar} disabled={disabled} />
    </div>
  );
}
