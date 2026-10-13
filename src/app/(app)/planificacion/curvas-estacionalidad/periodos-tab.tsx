"use client";

import { useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { mensajeError, plural } from "@/lib/formato";
import type { CargasRespuesta } from "@/lib/ventas/tipos-api";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { AniosAtipicosCard } from "./anios-atipicos-card";
import { pendientesDeInvierno } from "./curvas-tab";
import { ETIQUETA_ALCANCE } from "@/lib/curvas/tipos-api";
import {
  CamposPeriodo,
  PERIODO_VACIO,
  motivoNoEnviable,
  type ValoresPeriodo,
} from "./formulario-periodo";
import { contarMeses, mesCorto, textoRango } from "./meses";
import type { AgrupacionConTemporada, AniosAtipicosRespuesta, CrearPeriodoAtipicoCuerpo, PeriodoAtipicoLista } from "./tipos";
import { useRecurso } from "./use-recurso";

/** Los dos altas que se esperan, para prellenar el formulario (nada se guarda hasta pulsar Crear). */
const PRELLENADO_2023: ValoresPeriodo = {
  desde: "2023-03",
  hasta: "2023-05",
  motivo: "Niño costero 2023",
  descripcion: "Propuesta: marzo a mayo; confirmar con planeamiento.",
  alcance: "invierno",
};
const PRELLENADO_2026: ValoresPeriodo = {
  desde: "",
  hasta: "",
  motivo: "Niño costero 2026",
  descripcion: "Meses por definir.",
  alcance: "invierno",
};

const ID_FORM_NUEVO = "form-periodo-nuevo";
const ID_MOTIVO_NUEVO = "periodo-motivo-nuevo";

/** La API puede devolver la lista directa o dentro de `{ periodos }`. */
function listaDePeriodos(d: PeriodoAtipicoLista[] | { periodos: PeriodoAtipicoLista[] } | null): PeriodoAtipicoLista[] {
  if (!d) return [];
  return Array.isArray(d) ? d : (d.periodos ?? []);
}

function cuerpoDe(v: ValoresPeriodo): CrearPeriodoAtipicoCuerpo {
  return {
    desde: v.desde,
    hasta: v.hasta,
    motivo: v.motivo.trim(),
    descripcion: v.descripcion.trim() === "" ? null : v.descripcion.trim(),
    alcance: v.alcance,
  };
}

/**
 * Pestaña Periodos atípicos (paso 1 de M6): el mantenimiento de los rangos de
 * meses distorsionados (El Niño costero 2023 y 2026). Funciona sin corridas ni
 * agregado: alta, edición en diálogo, activar/desactivar y eliminar. Cambiar un
 * periodo no recalcula nada.
 */
export function PeriodosTab({
  agrupaciones,
  onIrACurvas,
}: {
  agrupaciones: AgrupacionConTemporada[];
  /** Lleva a la pestaña Curvas con las agrupaciones cuya temporada falta decidir. */
  onIrACurvas: () => void;
}) {
  const periodosApi = useRecurso<PeriodoAtipicoLista[] | { periodos: PeriodoAtipicoLista[] }>("/api/periodos-atipicos?incluir_inactivos=1");
  const aniosApi = useRecurso<AniosAtipicosRespuesta>("/api/periodos-atipicos/anios?temporada=invierno");
  const cargasApi = useRecurso<CargasRespuesta>("/api/ventas/cargas");
  const periodos = useMemo(() => listaDePeriodos(periodosApi.datos), [periodosApi.datos]);
  const ultimoCargado = cargasApi.datos?.meta.ultimo_cargado ? mesCorto(cargasApi.datos.meta.ultimo_cargado) : null;

  const [form, setForm] = useState<ValoresPeriodo>(PERIODO_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<{ id: string; valores: ValoresPeriodo } | null>(null);
  const pendientes = useMemo(() => pendientesDeInvierno(agrupaciones), [agrupaciones]);

  const recargarPeriodos = periodosApi.recargar;
  const recargarAnios = aniosApi.recargar;
  const setErrorPeriodos = periodosApi.setError;

  async function ejecutar(accion: () => Promise<unknown>): Promise<boolean> {
    setOcupado(true);
    setErrorPeriodos(null);
    try {
      await accion();
      await Promise.all([recargarPeriodos(), recargarAnios()]);
      return true;
    } catch (e) {
      setErrorPeriodos(mensajeError(e));
      return false;
    } finally {
      setOcupado(false);
    }
  }

  function prellenar(v: ValoresPeriodo) {
    setForm(v);
    setAviso(null);
    // Evento de usuario, no efecto: se lleva la vista y el foco al formulario.
    document.getElementById(ID_FORM_NUEVO)?.scrollIntoView({ behavior: "smooth", block: "center" });
    document.getElementById(ID_MOTIVO_NUEVO)?.focus({ preventScroll: true });
  }

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (motivoNoEnviable(form) !== null) return;
    setGuardando(true);
    setAviso(null);
    const ok = await ejecutar(() => api.post<PeriodoAtipicoLista>("/api/periodos-atipicos", cuerpoDe(form)));
    if (ok) {
      setAviso(`Periodo «${form.motivo.trim()}» creado. Cambiarlo no recalcula nada.`);
      setForm(PERIODO_VACIO);
    }
    setGuardando(false);
  }

  async function guardarEdicion() {
    if (!edicion || motivoNoEnviable(edicion.valores) !== null) return;
    const ok = await ejecutar(() => api.patch<PeriodoAtipicoLista>(`/api/periodos-atipicos/${edicion.id}`, cuerpoDe(edicion.valores)));
    if (ok) setEdicion(null);
  }

  function alternarActivo(p: PeriodoAtipicoLista) {
    if (p.activo && !confirm(`¿Desactivar el periodo «${p.motivo}»? Dejará de contar en los cálculos, pero se conserva el registro.`)) return;
    void ejecutar(() => api.patch<PeriodoAtipicoLista>(`/api/periodos-atipicos/${p.id}`, { activo: !p.activo }));
  }

  function eliminar(p: PeriodoAtipicoLista) {
    if (!confirm(`¿Eliminar definitivamente el periodo «${p.motivo}»? Esta acción no se puede deshacer.`)) return;
    void ejecutar(() => api.delete(`/api/periodos-atipicos/${p.id}`));
  }

  function abrirEdicion(p: PeriodoAtipicoLista) {
    periodosApi.setError(null);
    setEdicion({
      id: p.id,
      valores: { desde: mesCorto(p.desde), hasta: mesCorto(p.hasta), motivo: p.motivo, descripcion: p.descripcion ?? "", alcance: p.alcance },
    });
  }

  function cerrarEdicion() {
    periodosApi.setError(null);
    setEdicion(null);
  }

  const columnas: Columna<PeriodoAtipicoLista>[] = [
    {
      clave: "rango",
      titulo: "Rango",
      render: (p) => (
        <span className="whitespace-nowrap">
          {textoRango(p.desde, p.hasta)}
          <span className="ml-2 font-mono text-xs text-tinta-suave">
            {mesCorto(p.desde)} a {mesCorto(p.hasta)}
          </span>
        </span>
      ),
    },
    {
      clave: "meses",
      titulo: "Meses",
      render: (p) => <span className="font-mono text-xs text-tinta-suave">{p.meses ?? contarMeses(mesCorto(p.desde), mesCorto(p.hasta)) ?? "—"}</span>,
    },
    {
      clave: "motivo",
      titulo: "Motivo",
      render: (p) => (
        <div className="max-w-72">
          <span className="font-medium">{p.motivo}</span>
          {p.descripcion && (
            <span className="block truncate text-xs text-tinta-suave" title={p.descripcion}>
              {p.descripcion}
            </span>
          )}
        </div>
      ),
    },
    {
      clave: "alcance",
      titulo: "Alcance",
      render: (p) => <Badge tono={p.alcance === "invierno" ? "marca" : "alerta"}>{ETIQUETA_ALCANCE[p.alcance]}</Badge>,
    },
    {
      clave: "afectadas",
      titulo: "Agrupaciones afectadas",
      className: "text-right",
      render: (p) => <span className="font-mono text-xs text-tinta-suave">{p.agrupaciones_afectadas ?? "—"}</span>,
    },
    {
      clave: "estado",
      titulo: "Estado",
      render: (p) => <Badge tono={p.activo ? "exito" : "alerta"}>{p.activo ? "Activo" : "Desactivado"}</Badge>,
    },
    {
      clave: "acciones",
      titulo: "",
      className: "text-right",
      render: (p) => (
        <div className="flex justify-end gap-1">
          <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => abrirEdicion(p)}>
            Editar
          </Button>
          <Button variante="fantasma" tamano="sm" disabled={ocupado} onClick={() => alternarActivo(p)}>
            {p.activo ? "Desactivar" : "Reactivar"}
          </Button>
          <Button variante="peligro" tamano="sm" disabled={ocupado} onClick={() => eliminar(p)}>
            Eliminar
          </Button>
        </div>
      ),
    },
  ];

  const sinPeriodos = !periodosApi.cargando && periodosApi.datos !== null && periodos.length === 0;
  const motivoNoCrear = motivoNoEnviable(form);

  return (
    <div className="space-y-6">
      {periodosApi.error && !edicion && <Alert onCerrar={() => periodosApi.setError(null)}>{periodosApi.error}</Alert>}
      {cargasApi.error && (
        <Alert onCerrar={() => cargasApi.setError(null)}>
          No se pudo leer el último mes cargado en M5, así que no se avisará de los meses sin cargar: {cargasApi.error}
        </Alert>
      )}
      {aviso && (
        <Alert tono="exito" onCerrar={() => setAviso(null)}>
          {aviso}
        </Alert>
      )}

      <AniosAtipicosCard datos={aniosApi.datos} cargando={aniosApi.cargando} error={aniosApi.error} onCerrarError={() => aniosApi.setError(null)} />

      {pendientes.length > 0 && (
        <Alert tono="info">
          {plural(pendientes.length, "agrupación sigue", "agrupaciones siguen")} como «Toda temporada» aunque sus líneas sugieren Invierno: un periodo de
          alcance «invierno» no las alcanzaría.{" "}
          <button type="button" onClick={onIrACurvas} className="font-medium underline underline-offset-2">
            Marcar la temporada de las agrupaciones
          </button>
        </Alert>
      )}

      {sinPeriodos && (
        <EmptyState
          titulo="Todavía no hay periodos atípicos"
          detalle="Crea los dos que se esperan: «Niño costero 2023» (propuesta: marzo a mayo, confirmar con planeamiento) y «Niño costero 2026» (meses por definir). Los botones solo rellenan el formulario; nada se guarda hasta pulsar Crear."
        >
          <Button onClick={() => prellenar(PRELLENADO_2023)}>Prellenar Niño costero 2023</Button>
          <Button variante="secundario" onClick={() => prellenar(PRELLENADO_2026)}>
            Prellenar Niño costero 2026
          </Button>
        </EmptyState>
      )}

      <Card titulo="Nuevo periodo atípico" descripcion="Un rango de meses cuya venta está distorsionada (se solapan: cuenta la unión).">
        <form id={ID_FORM_NUEVO} onSubmit={crear} className="grid gap-4 md:grid-cols-4">
          <CamposPeriodo
            valores={form}
            onCambiar={setForm}
            disabled={guardando || ocupado}
            agrupaciones={agrupaciones}
            ultimoCargado={ultimoCargado}
            idMotivo={ID_MOTIVO_NUEVO}
          />
          <div className="flex flex-wrap items-center gap-3 md:col-span-4">
            <Button type="submit" disabled={guardando || ocupado || motivoNoCrear !== null} title={motivoNoCrear ?? undefined}>
              {guardando ? "Creando…" : "Crear periodo"}
            </Button>
            {motivoNoCrear && (form.motivo !== "" || form.desde !== "" || form.hasta !== "") && (
              <span className="text-xs text-tinta-suave">{motivoNoCrear}</span>
            )}
          </div>
        </form>
      </Card>

      <Card titulo="Periodos atípicos">
        <DataTable
          columnas={columnas}
          filas={periodos}
          claveFila={(p) => p.id}
          cargando={periodosApi.cargando && periodosApi.datos === null}
          vacio="Todavía no hay periodos."
          claseFila={(p) => (p.activo ? undefined : "bg-neutro-suave/60 text-tinta-suave")}
        />
        <p className="mt-3 text-xs text-tinta-suave">
          Cambiar un periodo no recalcula nada: el cálculo de curvas llega en el paso 2 y usará los periodos activos. Desactivar un periodo lo saca
          del cálculo sin perder el registro.
        </p>
      </Card>

      {edicion && (
        <Modal
          titulo="Editar periodo atípico"
          descripcion="Los cambios se aplican al pulsar Guardar."
          onCerrar={cerrarEdicion}
          cerrable={!ocupado}
          ancho="max-w-3xl"
          pie={
            <>
              <Button variante="fantasma" disabled={ocupado} onClick={cerrarEdicion}>
                Cancelar
              </Button>
              <Button type="submit" form="form-periodo-edicion" disabled={ocupado || motivoNoEnviable(edicion.valores) !== null}>
                {ocupado ? "Guardando…" : "Guardar"}
              </Button>
            </>
          }
        >
          <form
            id="form-periodo-edicion"
            onSubmit={(e) => {
              e.preventDefault();
              void guardarEdicion();
            }}
            className="grid gap-4 md:grid-cols-4"
          >
            {periodosApi.error && (
              <div className="md:col-span-4">
                <Alert onCerrar={() => periodosApi.setError(null)}>{periodosApi.error}</Alert>
              </div>
            )}
            <CamposPeriodo
              valores={edicion.valores}
              onCambiar={(valores) => setEdicion({ ...edicion, valores })}
              disabled={ocupado}
              agrupaciones={agrupaciones}
              ultimoCargado={ultimoCargado}
            />
          </form>
        </Modal>
      )}
    </div>
  );
}
