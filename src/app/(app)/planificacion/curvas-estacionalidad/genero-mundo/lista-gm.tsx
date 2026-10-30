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
  baseSiguienteGM,
  contarEstadosGM,
  esBrutaAntigua,
  etiquetaProyeccion,
  filasCsvLista,
  filasDeLista,
  filtrarFilasGM,
  formatearPctPlano,
  formatearPctSigno,
  formatearUds,
  generosDeLista,
  hayNino,
  hayReferenciaValida,
  insigniasCierre,
  referenciasElegibles,
  textoAnioSiguienteAtipico,
  textoCorreccionNino,
  textoEstadoGM,
  textoFijoLista,
  textoMotivoNulo,
  textoOrigenBase,
  textoSinReferencia,
  textoSobreBase,
  textoTotalSinAprobar,
  textoUltimoMes,
  totalSobreReal,
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
        <strong className="text-sm">{formatearPctSigno(r.pct_bruto)}</strong> <span className="text-tinta-suave">real</span>
      </p>
      <p>
        {formatearPctSigno(r.pct_sin_nino)} <span className="text-tinta-suave">corregido</span>
      </p>
      {(r.extremo || r.fragil) && (
        <p className="flex flex-wrap gap-1">
          {r.extremo && (
            <span title="Más de 50 % de crecimiento real, arriba o abajo: revísalo antes de apoyarte en él">
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

function CifraCierre({ f }: { f: FilaGMApi }) {
  const c = f.cierre;
  if (!c || c.cierre === null) {
    const motivo = textoMotivoNulo(c?.motivo_nulo ?? null);
    return motivo ? <span className="block max-w-40 text-xs text-tinta-suave">— {motivo}</span> : SIN_DATO;
  }
  const conNino = hayNino(f);
  const insignias = insigniasCierre(c);
  return (
    <div className="space-y-0.5 text-xs tabular-nums">
      <p>
        <strong className="text-sm">{formatearUds(conNino ? c.cierre_corregido : c.cierre)}</strong> <span className="text-tinta-suave">{conNino ? "u corregidas" : "u"}</span>
      </p>
      <p>
        <strong>{formatearPctSigno(c.pct)}</strong> <span className="text-tinta-suave">real</span>
      </p>
      {conNino && (
        <p>
          {formatearPctSigno(c.pct_corregido)} <span className="text-tinta-suave">corregido</span>
        </p>
      )}
      {insignias.length > 0 && (
        <p className="flex max-w-44 flex-wrap gap-1">
          {insignias.map((i) => (
            <span key={i.texto} title={i.titulo}>
              <Badge tono="alerta">{i.texto}</Badge>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function CifraBase({ f }: { f: FilaGMApi }) {
  const b = baseSiguienteGM(f);
  if (!b) return SIN_DATO;
  const conNino = hayNino(f);
  const correccion = textoCorreccionNino(f);
  return (
    <div className="space-y-0.5 text-xs tabular-nums">
      <p>
        {conNino ? (
          <>
            <strong className="text-sm">{formatearUds(b.real)}</strong> <span className="text-tinta-suave">real</span> / <strong className="text-sm">{formatearUds(b.corregida)}</strong>{" "}
            <span className="text-tinta-suave">corregida</span>
          </>
        ) : (
          <strong className="text-sm">{formatearUds(b.corregida)}</strong>
        )}
      </p>
      {correccion && <p className={conNino ? "text-tinta" : "text-tinta-suave"}>{correccion}</p>}
      <p className="text-tinta-suave">{textoOrigenBase(b)}</p>
      {f.fuera_base && f.fuera_base.unidades > 0 && (
        <p className="max-w-44 text-alerta" title={`${f.fuera_base.filas} filas de la proyección no tienen base: su venta no entra en la base de M7`}>
          {formatearUds(f.fuera_base.unidades)} u de venta fuera de la base de M7
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
  const totales = totalSobreReal(lista);
  const atipico = lista.anio_siguiente_atipico ?? null;
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
              <p className="text-xs text-tinta-suave">ponderado por la base {anio} corregida</p>
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
      titulo: `Acumulado ${anio - 1} (real / corregido)`,
      render: (x) => (x.tipo === "total" ? SIN_DATO : <CifraReferencia r={x.fila.acumulado} />),
    },
    {
      clave: "cierre",
      titulo: `Cierre ${anio - 1} por curva (mismas tiendas)`,
      render: (x) => (x.tipo === "total" ? SIN_DATO : <CifraCierre f={x.fila} />),
    },
    {
      clave: "aplicado",
      titulo: "Aplicado hoy (sobre corregido · sobre real)",
      className: "text-right",
      render: (x) => {
        if (x.tipo === "total") return SIN_DATO;
        const r = x.fila.aplicado_hoy;
        if (r.pct_bruto === null && r.pct_sin_nino === null) {
          const motivo = textoMotivoNulo(r.motivo_nulo);
          return motivo ? <span className="block max-w-36 text-xs text-tinta-suave">— {motivo}</span> : SIN_DATO;
        }
        return (
          <div className="space-y-0.5 text-xs tabular-nums">
            <p>
              <strong className="text-sm">{formatearPctSigno(r.pct_sin_nino, 2)}</strong> <span className="text-tinta-suave">corregido</span>
            </p>
            <p>
              {formatearPctSigno(r.pct_bruto, 2)} <span className="text-tinta-suave">real</span>
            </p>
          </div>
        );
      },
    },
    {
      clave: "base",
      titulo: `Base ${anio} (tiendas de ${anio})`,
      render: (x) =>
        x.tipo === "total" ? (
          <span className="tabular-nums" title={`Suma de la base ${anio} de la proyección de referencia`}>
            {formatearUds(lista.total.base)}
          </span>
        ) : (
          <CifraBase f={x.fila} />
        ),
    },
    {
      clave: "aprobado",
      titulo: `Crecimiento ${anio} aprobado`,
      render: (x) => {
        if (x.tipo === "total")
          return lista.total.pct_ponderado === null ? (
            <span className="text-tinta-suave" title="Sin proyección de referencia de método 5 no se puede ponderar">
              —
            </span>
          ) : (
            <div className="space-y-0.5 text-xs tabular-nums" title={`Ponderado por la base ${anio} corregida`}>
              <p>
                <strong className="text-sm">{formatearPctPlano(lista.total.pct_ponderado, 2)}</strong> <span className="text-tinta-suave">sobre {anio - 1} corregido</span>
              </p>
              <p>
                {formatearPctSigno(totales.real, 2)} <span className="text-tinta-suave">sobre {anio - 1} real</span>
              </p>
            </div>
          );
        const f = x.fila;
        if (!f.detallable) return <span className="text-xs text-tinta-suave">sigue al Resto</span>;
        const v = f.vigente;
        if (!v) return SIN_DATO;
        const pideReaprobar = esBrutaAntigua(v) && hayNino(f);
        return (
          <div className="min-w-36 space-y-0.5 text-xs">
            <p className="text-sm text-tinta">
              <strong className="tabular-nums">{formatearPctPlano(v.pct, 2)}</strong> <span className="text-tinta-suave">· v{v.version}</span>
            </p>
            <p className="text-tinta-suave">{textoSobreBase(v, anio - 1)}</p>
            {v.equivalente_real !== null && v.equivalente_real !== undefined && <p className="text-tinta-suave">= {formatearPctSigno(v.equivalente_real, 2)} sobre {anio - 1} real</p>}
            <p className="text-tinta-suave" title={`Aprobada el ${formatearFechaHora(v.aprobada_at)}`}>
              {v.por_nombre ?? "—"} · {formatearDiaMes(v.aprobada_at)}
            </p>
            {(esBrutaAntigua(v) || pideReaprobar) && (
              <p className="flex flex-wrap gap-1">
                {esBrutaAntigua(v) && <Badge tono="neutro">bruto · antes de 0.14.0</Badge>}
                {pideReaprobar && (
                  <span title="Este género × mundo tuvo Niño material: la versión sobre real hay que reaprobarla sobre corregido para poder cerrar la proyección">
                    <Badge tono="alerta">reaprobar</Badge>
                  </span>
                )}
              </p>
            )}
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
      {atipico && <Alert tono="alerta">{textoAnioSiguienteAtipico(anio, atipico.meses)} Aprobar queda deshabilitado en todos los géneros × mundos.</Alert>}
      {!referenciaValida && <Alert tono="info">{textoSinReferencia(anio)}</Alert>}

      <Card
        titulo="Crecimiento por género × mundo"
        descripcion={`Cierra ${anio - 1} por curva, corrige el efecto del Niño y aprueba una sola vez el crecimiento de ${anio} de cada género × mundo. Todas las proyecciones leen lo aprobado. Último mes cerrado: ${textoUltimoMes(lista.ultimo_mes_cerrado)}.`}
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
            <Field label={`Proyección de referencia (${anio - 1})`} hint="Solo proyecciones calculadas con el método 5 (0.14.0). De ella salen «Aplicado hoy», «Reaprobar» y la base de la proyección.">
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
            Acumulado: {lista.resto.acumulado.periodo}, de las mismas tiendas. «Cierre por curva» proyecta el resto del año con la curva vigente de cada agrupación; «corregido» quita el efecto
            del Niño con su factor relativo. La base {anio} usa las tiendas que tendrá {anio}; «por curva» es una estimación sin la proyección. «Extremo» marca un crecimiento real de más de 50 % y
            «frágil» uno basado en pocas tiendas o pocas unidades: solo informan, no bloquean ni sugieren un %. Solo HOMBRE, MUJER y el Resto se aprueban; los demás géneros se ven aquí pero
            siguen al Resto.
          </p>
        </div>
      </Card>
    </div>
  );
}
