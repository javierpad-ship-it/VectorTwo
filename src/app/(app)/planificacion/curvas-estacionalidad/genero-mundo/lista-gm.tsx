"use client";

import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Select } from "@/components/ui/form";
import type { FilaGMApi, ListaGeneroMundoApi, ReferenciaApi } from "@/lib/crecimientos/tipos-api";
import { descargarCsv } from "@/components/importador/csv";
import { formatearDiaMes, formatearFechaHora } from "../vista";
import {
  FILTROS_ESTADO_GM,
  contarEstadosGM,
  etiquetaProyeccion,
  filasCsvLista,
  filasDeLista,
  filtrarFilasGM,
  formatearPctPlano,
  formatearPctSigno,
  formatearUds,
  generosDeLista,
  hayReferenciaValida,
  referenciasElegibles,
  textoEstadoGM,
  textoFijoLista,
  textoMotivoNulo,
  textoSinReferencia,
  textoTotalSinAprobar,
  textoUltimoMes,
  tituloGM,
  type FilaListaGM,
  type FiltroEstadoGM,
} from "./vista";

const SIN_DATO = <span className="text-tinta-suave">—</span>;

function CifraReferencia({ r }: { r: ReferenciaApi }) {
  if (r.pct_bruto === null && r.pct_sin_nino === null) {
    const motivo = textoMotivoNulo(r.motivo_nulo);
    return motivo ? <span className="block max-w-40 text-xs text-tinta-suave">— {motivo}</span> : SIN_DATO;
  }
  return (
    <div className="space-y-0.5 text-xs tabular-nums">
      <p>
        <strong className="text-sm">{formatearPctSigno(r.pct_bruto)}</strong> <span className="text-tinta-suave">bruto</span>
      </p>
      <p>
        {formatearPctSigno(r.pct_sin_nino)} <span className="text-tinta-suave">sin Niño</span>
      </p>
      {(r.extremo || r.fragil) && (
        <p className="flex flex-wrap gap-1">
          {r.extremo && (
            <span title="Más de 50 % de crecimiento bruto, arriba o abajo: revísalo antes de apoyarte en él">
              <Badge tono="alerta">extremo</Badge>
            </span>
          )}
          {r.fragil && (
            <span title="Menos de 3 tiendas o menos de 120 unidades en el periodo anterior">
              <Badge tono="alerta">frágil</Badge>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function BadgeEstado({ f }: { f: FilaGMApi }) {
  const texto = textoEstadoGM(f);
  const tono = !f.detallable ? "neutro" : f.estado === "aprobado" ? "exito" : "alerta";
  return (
    <span title={f.estado === "obsoleto" ? texto : undefined}>
      <Badge tono={tono}>{f.estado === "obsoleto" && f.detallable ? "Obsoleto" : texto}</Badge>
      {f.estado === "obsoleto" && f.detallable && <span className="mt-0.5 block max-w-48 text-xs text-alerta">{texto.replace(/^Obsoleto: /, "")}</span>}
    </span>
  );
}

/**
 * Lista de la pestaña «Crecimiento por género × mundo» (06d, §4.1): cabecera (año de aplicación y proyección de
 * referencia), una fila por género × mundo con venta, el Resto y el Total ponderado. «Trabajar» abre el detalle. Es
 * presentación pura: quien la monta carga los datos y mueve la URL.
 */
export function ListaGM({
  lista,
  cargando,
  estado,
  onEstado,
  genero,
  onGenero,
  onAnio,
  onProyeccion,
  onTrabajar,
}: {
  lista: ListaGeneroMundoApi | null;
  cargando: boolean;
  estado: FiltroEstadoGM;
  onEstado: (e: FiltroEstadoGM) => void;
  genero: string;
  onGenero: (g: string) => void;
  onAnio: (anio: number) => void;
  onProyeccion: (id: string) => void;
  onTrabajar: (clave: string) => void;
}) {
  if (!lista) {
    return (
      <Card titulo="Crecimiento por género × mundo" descripcion={cargando ? "Cargando…" : "No se pudo cargar la lista."}>
        <p className="text-sm text-tinta-suave">{cargando ? "Calculando las cifras de cada género × mundo. La primera carga puede tardar unos segundos." : "Revisa el aviso de arriba y recarga la página."}</p>
      </Card>
    );
  }

  const anio = lista.anio_aplicacion;
  const elegibles = referenciasElegibles(lista);
  const referenciaValida = hayReferenciaValida(lista);
  const filasVisibles = filtrarFilasGM(lista.filas, { estado, genero });
  const filas = filasDeLista(lista, { estado, genero });
  const conteos = contarEstadosGM(lista.filas);
  const generos = generosDeLista(lista.filas);
  const items: ChipItem<FiltroEstadoGM>[] = FILTROS_ESTADO_GM.map((f) => ({ id: f.id, label: f.label, conteo: conteos[f.id] }));

  function descargar() {
    if (!lista) return;
    const { campos, datos } = filasCsvLista(lista, filasVisibles);
    descargarCsv(campos, datos, `crecimiento-genero-mundo-${anio}.csv`);
  }

  const columnas: Columna<FilaListaGM>[] = [
    {
      clave: "gm",
      titulo: "Género · mundo",
      render: (x) => {
        if (x.tipo === "total")
          return (
            <div className="min-w-40">
              <p className="font-semibold text-tinta">Total ponderado</p>
              <p className="text-xs text-tinta-suave">ponderado por la base {anio}</p>
            </div>
          );
        const f = x.fila;
        return (
          <div className={`min-w-40 space-y-1 ${f.detallable ? "" : "text-tinta-suave"}`}>
            <p className="font-medium">{tituloGM(f)}</p>
            {x.tipo === "resto" && <p className="text-xs text-tinta-suave">Todo lo que no se aprueba por separado (los demás géneros).</p>}
            {!f.mundo_activo && (
              <span title="El mundo está desactivado: solo se puede aprobar si tiene filas base en una proyección en trabajo">
                <Badge tono="neutro">mundo desactivado</Badge>
              </span>
            )}
            {!f.detallable && <p className="text-xs">sigue al Resto</p>}
          </div>
        );
      },
    },
    {
      clave: "anterior",
      titulo: `u. ${anio - 2}`,
      className: "text-right",
      render: (x) => (x.tipo === "total" ? SIN_DATO : <span className="tabular-nums" title="Unidades del año anterior de las mismas tiendas">{formatearUds(x.fila.unidades_anterior)}</span>),
    },
    {
      clave: "acumulado",
      titulo: `Acumulado ${anio - 1} (bruto / sin Niño)`,
      render: (x) => (x.tipo === "total" ? SIN_DATO : <CifraReferencia r={x.fila.acumulado} />),
    },
    {
      clave: "aplicado",
      titulo: "Aplicado hoy",
      className: "text-right",
      render: (x) => {
        if (x.tipo === "total") return SIN_DATO;
        const r = x.fila.aplicado_hoy;
        if (r.pct_bruto === null) {
          const motivo = textoMotivoNulo(r.motivo_nulo);
          return motivo ? <span className="block max-w-36 text-xs text-tinta-suave">— {motivo}</span> : SIN_DATO;
        }
        return <span className="tabular-nums">{formatearPctSigno(r.pct_bruto)}</span>;
      },
    },
    {
      clave: "base",
      titulo: `Base ${anio}`,
      className: "text-right",
      render: (x) => <span className="tabular-nums" title={`Suma de la base de ${anio} de la proyección de referencia`}>{formatearUds(x.tipo === "total" ? lista.total.base : x.fila.base_siguiente)}</span>,
    },
    {
      clave: "aprobado",
      titulo: `Crecimiento ${anio} aprobado`,
      render: (x) => {
        if (x.tipo === "total")
          return lista.total.pct_ponderado === null ? (
            <span className="text-tinta-suave" title="Sin proyección de referencia válida no se puede ponderar">
              —
            </span>
          ) : (
            <strong className="tabular-nums">{formatearPctPlano(lista.total.pct_ponderado)}</strong>
          );
        const f = x.fila;
        if (!f.detallable) return <span className="text-xs text-tinta-suave">sigue al Resto</span>;
        const v = f.vigente;
        if (!v) return SIN_DATO;
        return (
          <div className="min-w-32 space-y-0.5 text-xs">
            <p className="text-sm text-tinta">
              <strong className="tabular-nums">{formatearPctPlano(v.pct)}</strong> <span className="text-tinta-suave">· v{v.version}</span>
            </p>
            <p className="text-tinta-suave" title={`Aprobada el ${formatearFechaHora(v.aprobada_at)}`}>
              {v.por_nombre ?? "—"} · {formatearDiaMes(v.aprobada_at)}
            </p>
          </div>
        );
      },
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (x) => (x.tipo === "total" ? <span className="block max-w-48 text-xs text-tinta-suave">{textoTotalSinAprobar(lista.total.sin_aprobar)}</span> : <BadgeEstado f={x.fila} />),
    },
    {
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (x) =>
        x.tipo === "total" ? null : (
          <Button tamano="sm" onClick={() => onTrabajar(x.fila.clave)} title={`Abrir ${tituloGM(x.fila)}: curva de venta, referencias${x.fila.detallable ? " y aprobación" : ""}`}>
            Trabajar
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      {!referenciaValida && <Alert tono="info">{textoSinReferencia(anio)}</Alert>}

      <Card
        titulo="Crecimiento por género × mundo"
        descripcion={`Analiza la curva de venta de cada género × mundo de las mismas tiendas y aprueba una sola vez el crecimiento de ${anio}. Todas las proyecciones leen lo aprobado. Último mes cerrado: ${textoUltimoMes(lista.ultimo_mes_cerrado)}.`}
        acciones={
          <Button variante="secundario" tamano="sm" onClick={descargar}>
            Descargar CSV
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="grid items-start gap-3 md:grid-cols-3">
            <Field label="Año de aplicación" hint="El año al que se aplica el crecimiento aprobado.">
              <Select value={String(anio)} onChange={(e) => onAnio(Number(e.target.value))}>
                {lista.anios_permitidos.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`Proyección de referencia (${anio - 1})`} hint="Solo proyecciones calculadas con el método actual. De ella salen «Cierre proyectado», «Aplicado hoy» y la base.">
              <Select value={lista.proyeccion_referencia?.id ?? ""} onChange={(e) => e.target.value && onProyeccion(e.target.value)} disabled={elegibles.length === 0}>
                {lista.proyeccion_referencia === null && <option value="">{elegibles.length === 0 ? "Ninguna disponible" : "Elige una proyección"}</option>}
                {elegibles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {etiquetaProyeccion(p)}
                    {p.calculado_at ? ` · calculada ${formatearDiaMes(p.calculado_at)}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <p className="text-sm text-tinta">{textoFijoLista(anio)}</p>

          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <Chips<FiltroEstadoGM> items={items} activo={estado} onCambiar={onEstado} etiqueta="Filtrar por estado" />
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-tinta-suave">Género</span>
              <Select value={genero} onChange={(e) => onGenero(e.target.value)} className="w-44!">
                <option value="">Todos</option>
                {generos.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          <DataTable
            columnas={columnas}
            filas={filas}
            claveFila={(x) => (x.tipo === "total" ? "total" : x.fila.clave)}
            claseFila={(x) => (x.tipo === "total" ? "bg-neutro-suave/60 font-medium" : x.tipo === "resto" ? "bg-marca-suave/30" : undefined)}
          />
          {filasVisibles.length === 0 && <p className="text-sm text-tinta-suave">Ningún género × mundo coincide con los filtros (el Resto y el Total siempre se muestran).</p>}
          <p className="text-xs text-tinta-suave">
            Acumulado: {lista.resto.acumulado.periodo}, de las mismas tiendas. «Sin Niño» quita el efecto del Niño de ese año. «Extremo» marca un crecimiento bruto de más de 50 %
            y «frágil» uno basado en pocas tiendas o pocas unidades: solo informan, no bloquean ni sugieren un %. Solo HOMBRE, MUJER y el Resto se aprueban; los demás géneros
            se ven aquí pero siguen al Resto.
          </p>
        </div>
      </Card>
    </div>
  );
}
