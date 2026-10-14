"use client";

import { useMemo } from "react";
import { ANOMALIAS_GMLE, ETIQUETA_ANOMALIA_GMLE, type ReporteAgrupacionGmle } from "@/lib/reportes/tipos-api";
import { DESCRIPCION_ANOMALIA } from "@/lib/reportes/textos";
import { FILTROS_VACIOS, SIN_AGRUPACION, hayFiltros, type FiltroAnomalia, type FiltrosGmle } from "@/lib/reportes/filtros";
import { formatearNumero } from "@/lib/formato";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { Field, Input, Select } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";

/**
 * Barra de filtros común a las tres pestañas. El estado vive en el panel (la
 * URL no lo guarda) y se aplica en memoria con las funciones puras de
 * `filtros.ts`.
 */
export function BarraFiltros({
  reporte,
  filtros,
  onCambiar,
}: {
  reporte: ReporteAgrupacionGmle;
  filtros: FiltrosGmle;
  onCambiar: (cambio: Partial<FiltrosGmle>) => void;
}) {
  const { resumen, agrupaciones, catalogos } = reporte;

  const sinAgrupacion = useMemo(
    () => resumen.equivalencias - agrupaciones.reduce((s, a) => s + a.equivalencias, 0),
    [resumen.equivalencias, agrupaciones]
  );
  const totalAnomalias = ANOMALIAS_GMLE.reduce((s, c) => s + resumen.anomalias[c], 0);

  const chips: ChipItem<FiltroAnomalia>[] = [
    { id: "todas", label: "Todas", conteo: totalAnomalias },
    ...ANOMALIAS_GMLE.map((c) => ({ id: c, label: ETIQUETA_ANOMALIA_GMLE[c], conteo: resumen.anomalias[c] })),
  ];

  return (
    <div className="space-y-3 rounded-xl border border-borde bg-superficie p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Agrupación">
          <Select value={filtros.agrupacion} onChange={(e) => onCambiar({ agrupacion: e.target.value })}>
            <option value="">Todas</option>
            <option value={SIN_AGRUPACION}>Sin agrupación ({formatearNumero(sinAgrupacion)})</option>
            {agrupaciones.map((a) => (
              <option key={a.id} value={a.id}>
                {a.nombre}
                {a.activo ? "" : " (inactiva)"} ({formatearNumero(a.equivalencias)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Género">
          <Select value={filtros.genero} onChange={(e) => onCambiar({ genero: e.target.value })}>
            <option value="">Todos</option>
            {catalogos.generos.map((g) => (
              <option key={g.id} value={g.nombre}>
                {g.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mundo">
          <Select value={filtros.mundo} onChange={(e) => onCambiar({ mundo: e.target.value })}>
            <option value="">Todos</option>
            {catalogos.mundos.map((m) => (
              <option key={m.id} value={m.nombre}>
                {m.nombre}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Nivel">
          <Select value={filtros.nivel} onChange={(e) => onCambiar({ nivel: e.target.value as FiltrosGmle["nivel"] })}>
            <option value="">Todos</option>
            <option value="GML">GML</option>
            <option value="GMLE">GMLE</option>
          </Select>
        </Field>
        <Field label="Buscar" hint="Línea, equivalencia o código">
          <Input
            type="search"
            value={filtros.texto}
            onChange={(e) => onCambiar({ texto: e.target.value })}
            placeholder="Ej. pantalón"
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-tinta">Anomalía</p>
        <Chips<FiltroAnomalia> items={chips} activo={filtros.anomalia} onCambiar={(anomalia) => onCambiar({ anomalia })} etiqueta="Filtrar por anomalía" />
        <p className="text-xs text-tinta-suave">
          El número cuenta cada aviso en su unidad: líneas, nodos, equivalencias o agrupaciones. Al elegir un aviso, las tablas muestran todas las
          equivalencias que lo llevan (los de nodo y línea se propagan a sus equivalencias).{" "}
          {filtros.anomalia !== "todas" && <strong className="text-tinta">{DESCRIPCION_ANOMALIA[filtros.anomalia]}</strong>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Switch checked={filtros.soloGenericas} onChange={(soloGenericas) => onCambiar({ soloGenericas })} label="Solo genéricas" />
        <Switch checked={filtros.soloAnomalias} onChange={(soloAnomalias) => onCambiar({ soloAnomalias })} label="Solo anomalías" />
        <Switch checked={filtros.incluirInactivos} onChange={(incluirInactivos) => onCambiar({ incluirInactivos })} label="Incluir inactivos" />
        <Button variante="fantasma" tamano="sm" className="ml-auto" disabled={!hayFiltros(filtros)} onClick={() => onCambiar(FILTROS_VACIOS)}>
          Limpiar filtros
        </Button>
      </div>
    </div>
  );
}
