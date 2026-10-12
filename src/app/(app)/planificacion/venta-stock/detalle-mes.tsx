"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Chips, type ChipItem } from "@/components/ui/chips";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/form";
import { formatearNumero, plural } from "@/lib/formato";
import {
  ETIQUETAS_MEDIDA,
  ETIQUETAS_MOTIVO,
  MEDIDAS_DINERO,
  type Aviso,
  type DetalleAviso,
  type Exclusion,
  type FilaConciliacion,
  type InformeMes,
  type MedidaVenta,
  type ResumenExclusion,
} from "@/lib/ventas/tipos";
import { formatearEntero, formatearPct, formatearPorcentaje, formatearSoles, formatearSoles2 } from "./comunes";
import { useContextoMapeos } from "./contexto-mapeos";
import { origenesDeGrupo, reasignadasDe, unirOrigenes, type IndiceOrigenes, type OrigenAsignable } from "./origenes-mapeo";
import { textoQlikInvalido } from "./plan";

const esDinero = (m: MedidaVenta) => (MEDIDAS_DINERO as readonly MedidaVenta[]).includes(m);
const formatearMedida = (m: MedidaVenta, v: number) => (esDinero(m) ? formatearSoles2(v) : formatearEntero(v));

// ─── Conciliación ───

function EstadoQlikCelda({ f }: { f: FilaConciliacion }) {
  if (f.estado_qlik === "sin_qlik") return <span className="text-tinta-suave">—</span>;
  if (f.estado_qlik === "coincide") {
    return (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tono="exito">Coincide</Badge>
        {f.diferencia_qlik !== null && f.diferencia_qlik !== 0 && <span className="font-mono text-xs text-tinta-suave">{formatearMedida(f.medida, f.diferencia_qlik)}</span>}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Badge tono="alerta">Difiere</Badge>
      <span className="font-mono text-xs text-alerta">
        {f.diferencia_qlik !== null ? formatearMedida(f.medida, f.diferencia_qlik) : ""}
        {f.diferencia_relativa !== null && ` (${formatearPct(f.diferencia_relativa)})`}
      </span>
    </span>
  );
}

/** Tabla `medida · QlikView (opcional) · archivo · excluido · cargado · diferencia` de un mes. */
export function Conciliacion({
  mes,
  textos,
  onTotal,
}: {
  mes: InformeMes;
  textos: Partial<Record<MedidaVenta, string>> | undefined;
  onTotal: (medida: MedidaVenta, texto: string) => void;
}) {
  const columnas: Columna<FilaConciliacion>[] = [
    { clave: "medida", titulo: "Medida", render: (f) => <span className="whitespace-nowrap font-medium">{ETIQUETAS_MEDIDA[f.medida]}</span> },
    {
      clave: "qlik",
      titulo: "Total de QlikView (opcional)",
      render: (f) => {
        const t = textos?.[f.medida];
        const invalido = textoQlikInvalido(t);
        return (
          <div className="w-44">
            <Input
              inputMode="decimal"
              value={t ?? ""}
              onChange={(e) => onTotal(f.medida, e.target.value)}
              placeholder={esDinero(f.medida) ? "Ej.: 1234567" : "Ej.: 45678"}
              aria-label={`Total de QlikView de ${ETIQUETAS_MEDIDA[f.medida]} de ${mes.periodo}`}
              aria-invalid={invalido}
              className={`h-8 text-right font-mono ${invalido ? "border-alerta" : ""}`}
            />
            {invalido && <span className="text-xs text-alerta">Número no válido</span>}
          </div>
        );
      },
    },
    { clave: "archivo", titulo: "Archivo", className: "text-right font-mono", render: (f) => formatearMedida(f.medida, f.archivo) },
    { clave: "excluido", titulo: "Excluido", className: "text-right font-mono", render: (f) => formatearMedida(f.medida, f.excluido) },
    { clave: "cargado", titulo: "Cargado", className: "text-right font-mono font-medium", render: (f) => formatearMedida(f.medida, f.cargado) },
    { clave: "dif", titulo: "Archivo frente a QlikView", render: (f) => <EstadoQlikCelda f={f} /> },
  ];

  return (
    <div className="space-y-2">
      <DataTable columnas={columnas} filas={mes.conciliacion} claveFila={(f) => f.medida} />
      <p className="text-xs text-tinta-suave">
        Unidades y stock en unidades deben coincidir exactos; venta, costo y stock valorizado coinciden con una diferencia menor al 0,1 % (las cifras enteras del CSV no dan
        igualdad exacta). Escribir los totales no vuelve a leer el archivo.
      </p>
      {!mes.identidad_ok && (
        <Alert>
          <strong>La identidad archivo = cargado + excluido no cierra.</strong> Es un error de la herramienta, no de tus datos: no se puede cargar este mes. Avisa al equipo con este archivo.
        </Alert>
      )}
    </div>
  );
}

// ─── Exclusiones ───

const LIMITE_FILAS = 100;

function Pct({ valor }: { valor: number }) {
  return <span className="text-xs text-tinta-suave"> ({formatearPorcentaje(valor)})</span>;
}

function porcentajeDe(parte: number, total: number): number {
  return total === 0 ? 0 : (Math.abs(parte) / Math.abs(total)) * 100;
}

function valorLegible(e: Exclusion): string {
  if (e.combinacion) {
    const c = e.combinacion;
    return [c.genero, c.mundo, c.linea, c.equivalencia === "" ? "(equivalencia vacía)" : c.equivalencia].join(" · ");
  }
  return e.valor === "" ? "(vacío)" : e.valor;
}

/**
 * Lo que necesita el bloque de errores para ofrecer "Asignar" (mapeo de combinaciones, ficha M5b):
 * las combinaciones exactas de cada grupo y la acción que abre el modal. Sin esto el bloque no
 * muestra casillas ni botones (el reporte guardado de una carga es de solo lectura).
 */
export type Asignacion = {
  /** Combinaciones exactas de cada grupo de error mapeable (por mes y grupo). */
  indice: IndiceOrigenes;
  /** Hay lectura en memoria y nada en marcha: se puede asignar. */
  disponible: boolean;
  onAsignar: (origenes: OrigenAsignable[]) => void;
};

const claveSeleccion = (e: Exclusion) => `${e.motivo}\u0000${e.valor}`;

function TablaGrupos({
  mes,
  grupos,
  tipo,
  asignacion,
  seleccion,
  onSeleccion,
}: {
  mes: InformeMes;
  grupos: Exclusion[];
  tipo: "error" | "decision";
  asignacion?: Asignacion;
  seleccion: ReadonlySet<string>;
  onSeleccion: (clave: string, marcado: boolean) => void;
}) {
  const [limite, setLimite] = useState(LIMITE_FILAS);
  const visibles = grupos.slice(0, limite);
  const origenesDe = (e: Exclusion): OrigenAsignable[] => (asignacion ? origenesDeGrupo(asignacion.indice, mes.periodo, e) : []);
  const columnas: Columna<Exclusion>[] = [
    ...(asignacion
      ? [
          {
            clave: "elegir",
            titulo: "Elegir",
            render: (e: Exclusion) =>
              origenesDe(e).length > 0 ? (
                <Checkbox checked={seleccion.has(claveSeleccion(e))} onChange={(v) => onSeleccion(claveSeleccion(e), v)} disabled={!asignacion.disponible} label={`Elegir ${valorLegible(e)} para asignarlo`} />
              ) : null,
          },
        ]
      : []),
    {
      clave: "valor",
      titulo: tipo === "error" ? "Valor o combinación que hay que corregir" : "Valor",
      render: (e) => (
        <div>
          <span className="break-words">{valorLegible(e)}</span>
          <div className="text-xs text-tinta-suave">{ETIQUETAS_MOTIVO[e.motivo]}</div>
        </div>
      ),
    },
    {
      clave: "filas",
      titulo: "Filas",
      className: "text-right font-mono",
      render: (e) => (
        <>
          {formatearNumero(e.filas)}
          <Pct valor={porcentajeDe(e.filas, mes.archivo.filas)} />
        </>
      ),
    },
    {
      clave: "venta",
      titulo: "Venta",
      className: "text-right font-mono",
      render: (e) => (
        <>
          {formatearSoles(e.venta_soles)}
          <Pct valor={porcentajeDe(e.venta_soles, mes.archivo.venta_soles)} />
        </>
      ),
    },
    { clave: "costo", titulo: "Costo", className: "text-right font-mono", render: (e) => formatearSoles(e.costo_vendido) },
    {
      clave: "stock",
      titulo: "Stock a costo",
      className: "text-right font-mono",
      render: (e) => (
        <>
          {formatearSoles(e.stock_valorizado)}
          <Pct valor={porcentajeDe(e.stock_valorizado, mes.archivo.stock_valorizado)} />
        </>
      ),
    },
    { clave: "primera", titulo: "Primera fila", className: "text-right font-mono", render: (e) => formatearNumero(e.primera_fila) },
    ...(asignacion
      ? [
          {
            clave: "asignar",
            titulo: "",
            render: (e: Exclusion) => {
              const origenes = origenesDe(e);
              if (origenes.length === 0) return null;
              return (
                <Button
                  variante="secundario"
                  tamano="sm"
                  disabled={!asignacion.disponible}
                  onClick={() => asignacion.onAsignar(unirOrigenes([origenes]))}
                  aria-label={`Asignar ${valorLegible(e)} a un GML o GMLE`}
                >
                  Asignar
                </Button>
              );
            },
          },
        ]
      : []),
  ];
  return (
    <div className="space-y-2">
      <DataTable
        columnas={columnas}
        filas={visibles}
        claveFila={(e) => `${e.motivo}|${e.valor}|${e.combinacion?.equivalencia ?? ""}|${e.primera_fila}`}
        vacio="Ninguna."
      />
      {grupos.length > limite && (
        <Button variante="secundario" tamano="sm" onClick={() => setLimite((l) => l + LIMITE_FILAS)}>
          Mostrar más ({formatearNumero(grupos.length - limite)} restantes)
        </Button>
      )}
    </div>
  );
}

export function TablaResumenExclusiones({ resumen }: { resumen: ResumenExclusion[] }) {
  const columnas: Columna<ResumenExclusion>[] = [
    { clave: "motivo", titulo: "Motivo", render: (r) => ETIQUETAS_MOTIVO[r.motivo] ?? r.motivo },
    {
      clave: "tipo",
      titulo: "Tipo",
      render: (r) => <Badge tono={r.tipo === "error" ? "alerta" : "neutro"}>{r.tipo === "error" ? "Error" : "Decisión"}</Badge>,
    },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (r) => formatearNumero(r.filas) },
    { clave: "pf", titulo: "% filas", className: "text-right font-mono", render: (r) => formatearPorcentaje(r.pct_filas) },
    { clave: "pv", titulo: "% venta", className: "text-right font-mono", render: (r) => formatearPorcentaje(r.pct_venta) },
    { clave: "ps", titulo: "% stock", className: "text-right font-mono", render: (r) => formatearPorcentaje(r.pct_stock) },
  ];
  return <DataTable columnas={columnas} filas={resumen} claveFila={(r) => `${r.tipo}-${r.motivo}`} vacio="No se excluyó ninguna fila." />;
}

/** Conciliación de solo lectura (la de una carga ya publicada). */
export function ConciliacionGuardada({ filas }: { filas: FilaConciliacion[] }) {
  const columnas: Columna<FilaConciliacion>[] = [
    { clave: "medida", titulo: "Medida", render: (f) => <span className="whitespace-nowrap font-medium">{ETIQUETAS_MEDIDA[f.medida] ?? f.medida}</span> },
    { clave: "qlik", titulo: "QlikView", className: "text-right font-mono", render: (f) => (f.qlik === null ? "—" : formatearMedida(f.medida, f.qlik)) },
    { clave: "archivo", titulo: "Archivo", className: "text-right font-mono", render: (f) => formatearMedida(f.medida, f.archivo) },
    { clave: "excluido", titulo: "Excluido", className: "text-right font-mono", render: (f) => formatearMedida(f.medida, f.excluido) },
    { clave: "cargado", titulo: "Cargado", className: "text-right font-mono font-medium", render: (f) => formatearMedida(f.medida, f.cargado) },
    { clave: "dif", titulo: "Archivo frente a QlikView", render: (f) => <EstadoQlikCelda f={f} /> },
  ];
  return <DataTable columnas={columnas} filas={filas} claveFila={(f) => f.medida} />;
}

function BloqueExclusiones({
  mes,
  tipo,
  titulo,
  ayuda,
  asignacion,
}: {
  mes: InformeMes;
  tipo: "error" | "decision";
  titulo: string;
  ayuda: React.ReactNode;
  asignacion?: Asignacion;
}) {
  const [filtro, setFiltroEstado] = useState<string>("todos");
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set());
  /** Cambiar el chip de motivo limpia la selección: "Asignar seleccionados" solo toca lo que se ve. */
  const setFiltro = (f: string) => {
    setFiltroEstado(f);
    setSeleccion(new Set());
  };
  const resumen = mes.resumen_exclusiones.filter((r) => r.tipo === tipo);
  const grupos = mes.exclusiones.filter((e) => e.tipo === tipo);
  if (resumen.length === 0) return null;
  const filas = resumen.reduce((s, r) => s + r.filas, 0);
  const vigente = filtro !== "todos" && !resumen.some((r) => r.motivo === filtro) ? "todos" : filtro;
  const chips: ChipItem<string>[] = [
    { id: "todos", label: "Todos", conteo: filas },
    ...resumen.map((r): ChipItem<string> => ({ id: r.motivo, label: ETIQUETAS_MOTIVO[r.motivo], conteo: r.filas })),
  ];
  const visibles = vigente === "todos" ? grupos : grupos.filter((e) => e.motivo === vigente);

  // Grupos que se pueden asignar (motivo mapeable y con combinaciones de origen conocidas).
  const mapeables = asignacion ? visibles.filter((e) => origenesDeGrupo(asignacion.indice, mes.periodo, e).length > 0) : [];
  const elegidos = mapeables.filter((e) => seleccion.has(claveSeleccion(e)));
  const marcar = (clave: string, marcado: boolean) =>
    setSeleccion((previa) => {
      const sig = new Set(previa);
      if (marcado) sig.add(clave);
      else sig.delete(clave);
      return sig;
    });
  function asignarElegidos() {
    if (!asignacion || elegidos.length === 0) return;
    asignacion.onAsignar(unirOrigenes(elegidos.map((e) => origenesDeGrupo(asignacion.indice, mes.periodo, e))));
  }

  const columnasResumen: Columna<ResumenExclusion>[] = [
    { clave: "motivo", titulo: "Motivo", render: (r) => ETIQUETAS_MOTIVO[r.motivo] },
    { clave: "grupos", titulo: "Valores", className: "text-right font-mono", render: (r) => formatearNumero(r.grupos) },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (r) => formatearNumero(r.filas) },
    { clave: "pf", titulo: "% filas", className: "text-right font-mono", render: (r) => formatearPorcentaje(r.pct_filas) },
    { clave: "pv", titulo: "% venta", className: "text-right font-mono", render: (r) => formatearPorcentaje(r.pct_venta) },
    { clave: "ps", titulo: "% stock", className: "text-right font-mono", render: (r) => formatearPorcentaje(r.pct_stock) },
    {
      clave: "nota",
      titulo: "",
      render: (r) => (r.resaltada ? <Badge tono="alerta">Pesa más del 2 %</Badge> : null),
    },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-semibold">
        {titulo} ({plural(filas, "fila", "filas")})
      </h4>
      <div className="text-xs text-tinta-suave">{ayuda}</div>
      <DataTable columnas={columnasResumen} filas={resumen} claveFila={(r) => r.motivo} claseFila={(r) => (r.resaltada ? "bg-alerta-suave/40" : undefined)} />
      <Chips items={chips} activo={vigente} onCambiar={setFiltro} etiqueta={`Filtrar ${titulo.toLowerCase()} por motivo`} />
      {asignacion && mapeables.length > 0 && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Button tamano="sm" onClick={asignarElegidos} disabled={!asignacion.disponible || elegidos.length === 0}>
              Asignar seleccionados ({elegidos.length})
            </Button>
            <Button variante="secundario" tamano="sm" onClick={() => setSeleccion(new Set(mapeables.map(claveSeleccion)))} disabled={!asignacion.disponible}>
              {vigente === "todos" ? "Seleccionar todos" : "Seleccionar todos los de este motivo"} ({mapeables.length})
            </Button>
            <Button variante="fantasma" tamano="sm" onClick={() => setSeleccion(new Set())} disabled={elegidos.length === 0}>
              Quitar la selección
            </Button>
          </div>
          {!asignacion.disponible && (
            <p className="text-xs text-tinta-suave">
              Para asignar hay que tener la lectura del archivo en esta pantalla y nada en marcha (la lectura se libera al terminar una carga o al elegir otro archivo): vuelve a leer el archivo.
            </p>
          )}
        </div>
      )}
      <TablaGrupos key={vigente} mes={mes} grupos={visibles} tipo={tipo} asignacion={asignacion} seleccion={seleccion} onSeleccion={marcar} />
    </div>
  );
}

// ─── Avisos ───

function DetalleDeAviso({ detalle }: { detalle: DetalleAviso[] }) {
  const columnas: Columna<DetalleAviso>[] = [
    { clave: "valor", titulo: "Valor", render: (d) => <span className="break-words">{d.valor === "" ? "(vacío)" : d.valor}</span> },
    { clave: "filas", titulo: "Filas", className: "text-right font-mono", render: (d) => formatearNumero(d.filas) },
    { clave: "venta", titulo: "Venta", className: "text-right font-mono", render: (d) => formatearSoles(d.venta_soles) },
    { clave: "stock", titulo: "Stock a costo", className: "text-right font-mono", render: (d) => formatearSoles(d.stock_valorizado) },
  ];
  return <DataTable columnas={columnas} filas={detalle.slice(0, 50)} claveFila={(d) => d.valor} />;
}

function ItemAviso({ aviso }: { aviso: Aviso }) {
  const ctx = useContextoMapeos();
  const tono = aviso.rojo ? "alerta" : aviso.severidad === "aviso" ? "alerta" : "neutro";
  return (
    <details open={!aviso.plegado} className={`rounded-lg border px-3 py-2 text-sm ${aviso.rojo ? "border-alerta bg-alerta-suave" : "border-borde bg-superficie"}`}>
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <Badge tono={tono}>{aviso.rojo ? "Revisa antes de cargar" : aviso.severidad === "aviso" ? "Aviso" : "Nota"}</Badge>
        <span className="font-medium">{aviso.mensaje}</span>
      </summary>
      <div className="mt-2 space-y-2">
        {(aviso.filas > 0 || aviso.venta_soles !== 0 || aviso.stock_valorizado !== 0) && (
          <p className="text-xs text-tinta-suave">
            {formatearNumero(aviso.filas)} filas ({formatearPorcentaje(aviso.pct_filas)}) · venta {formatearSoles(aviso.venta_soles)} ({formatearPorcentaje(aviso.pct_venta)}) · stock a costo{" "}
            {formatearSoles(aviso.stock_valorizado)} ({formatearPorcentaje(aviso.pct_stock)})
          </p>
        )}
        {aviso.detalle.length > 0 && <DetalleDeAviso detalle={aviso.detalle} />}
        {(aviso.codigo as string) === "mapeos_no_aplicables" && (
          <p className="text-xs">
            Esas filas conservan su error original porque el destino del mapeo está desactivado. Reactiva el destino en el árbol, cambia el destino del mapeo o desactívalo en la pestaña Mapeos.
            {ctx && (
              <>
                {" "}
                <button type="button" onClick={ctx.irAMapeos} className="font-medium underline underline-offset-2">
                  Ir a la pestaña Mapeos
                </button>
              </>
            )}
          </p>
        )}
        {(aviso.codigo as string) === "reasignadas_por_mapeo" && (
          <p className="text-xs text-tinta-suave">
            Estas filas se cargan al destino de un mapeo (origen → destino). Si un mapeo está mal, cámbialo o elimínalo en la pestaña Mapeos y recarga el mes.
          </p>
        )}
        {aviso.codigo === "cifras_enteras" && (
          <p className="text-xs text-tinta-suave">
            Las cifras monetarias vienen en soles enteros; el error máximo por fila es de S/ 0,50 y es despreciable en los totales. No bloquea nada.
          </p>
        )}
      </div>
    </details>
  );
}

/** Avisos y notas ya armados (del reporte previo o del reporte guardado con una carga). */
export function ListaAvisos({ avisos }: { avisos: Aviso[] }) {
  if (avisos.length === 0) return <p className="text-sm text-tinta-suave">Sin avisos ni notas para este mes.</p>;
  const importantes = avisos.filter((a) => a.severidad === "aviso" || a.rojo);
  const notas = avisos.filter((a) => !(a.severidad === "aviso" || a.rojo));
  return (
    <div className="space-y-2">
      {importantes.map((a) => (
        <ItemAviso key={a.codigo} aviso={a} />
      ))}
      {notas.length > 0 && (
        <div className="space-y-2">
          <h4 className="pt-1 text-xs font-medium uppercase tracking-wide text-tinta-suave">Notas (informativas)</h4>
          {notas.map((a) => (
            <ItemAviso key={a.codigo} aviso={a} />
          ))}
        </div>
      )}
    </div>
  );
}

export function AvisosDelMes({ mes }: { mes: InformeMes }) {
  return <ListaAvisos avisos={mes.avisos} />;
}

// ─── Detalle completo de un mes ───

export function DetalleMes({
  mes,
  textos,
  onTotal,
  asignacion,
}: {
  mes: InformeMes;
  textos: Partial<Record<MedidaVenta, string>> | undefined;
  onTotal: (medida: MedidaVenta, texto: string) => void;
  /** Con esto el bloque de errores ofrece "Asignar" (mapeo de combinaciones). */
  asignacion?: Asignacion;
}) {
  const excluidas = mes.excluido.filas;
  const reasignadas = reasignadasDe(mes);
  return (
    <div className="space-y-6">
      <p className="text-sm text-tinta-suave">
        {formatearNumero(mes.archivo.filas)} filas en el archivo = {formatearNumero(mes.cargado.filas)} que se cargan + {formatearNumero(mes.fusionadas)} sumadas a otra de la
        misma clave + {formatearNumero(excluidas)} excluidas.
        {reasignadas.filas > 0 && (
          <>
            {" "}
            De las que se cargan, <strong className="text-tinta">{formatearNumero(reasignadas.filas)} están reasignadas por mapeo</strong> (iban a errores; el detalle <em>origen → destino</em> está en los avisos).
          </>
        )}
      </p>

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Conciliación</h4>
        <Conciliacion mes={mes} textos={textos} onTotal={onTotal} />
      </div>

      {mes.bloqueado && (
        <Alert>
          <strong>Mes bloqueado:</strong> los errores pesan {formatearPorcentaje(mes.errores.pct_filas)} de las filas, {formatearPorcentaje(mes.errores.pct_venta)} de la venta y{" "}
          {formatearPorcentaje(mes.errores.pct_stock)} del stock a costo (el umbral es 2 %). Corrige lo marcado como error y vuelve a leer, asigna las combinaciones a su GML o GMLE (el bloqueo se recalcula tras aplicar los mapeos), o carga el mes igual con
          «Cargar también los meses bloqueados» (quedará marcado Incompleto hasta que lo recargues).
        </Alert>
      )}

      <BloqueExclusiones
        mes={mes}
        tipo="error"
        titulo="Errores: no se cargan"
        ayuda={
          <>
            Hay algo que corregir: se agrupan por valor, con su peso y la primera fila del archivo donde aparecen. Si la combinación existió con otro nombre, asígnala a su GML o GMLE
            actual; si debe existir, descárgala abajo en formato árbol y súbela en Árbol de producto → Importar.
          </>
        }
        asignacion={asignacion}
      />
      <BloqueExclusiones
        mes={mes}
        tipo="decision"
        titulo="Excluidas por decisión (informativas)"
        ayuda={
          <>
            Ya son decisiones tomadas en los maestros o por regla (por ejemplo, tiendas desactivadas o filas sin clasificar). No hay nada que hacer; se resaltan si pesan más del 2 %. Si quieres
            cargar una combinación desactivada en el árbol, puedes asignarla a un GML o GMLE vigente.
          </>
        }
        asignacion={asignacion}
      />
      {mes.resumen_exclusiones.length === 0 && <p className="text-sm text-tinta-suave">No se excluye ninguna fila de este mes.</p>}

      <div className="space-y-2">
        <h4 className="text-sm font-semibold">Avisos y notas (se carga igual)</h4>
        <AvisosDelMes mes={mes} />
      </div>
    </div>
  );
}
