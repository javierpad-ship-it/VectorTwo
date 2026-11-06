"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DataTable, type Columna } from "@/components/ui/data-table";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { MAX_MOTIVO_MOVIMIENTO, MAX_NOMBRE_AGRUPADOR } from "@/lib/compras/agrupadores/tipos";
import {
  ETIQUETA_CAUSA_FECHA,
  LISTA_CAUSAS_FECHA,
  type AsignacionApi,
  type AvisoDetalleApi,
  type CausaFecha,
  type EmbarqueDetalleApi,
  type PaqueteApi,
  type PlanMovimientoApi,
  type RespuestaMovimientoApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { crearPaquete, esPlan, fijarIngresoPaquete, moverAPaquete, useAccion } from "@/lib/compras/agrupadores/use-agrupadores";
import { plural } from "@/lib/formato";
import { mesCorto, unidades } from "../formato";
import { ExtraMesesPlan, VistaPreviaPlan } from "./dialogo-movimiento";
import { textoFecha, textoLinea } from "./vista-agrupadores";
import {
  DESTINO_NUEVO,
  cambiaDeMes,
  cuerpoMoverAPaquete,
  etiquetaTanda,
  ingresoHeredado,
  itemsDeTanda,
  leerUnidades,
  lotesAlBarrer,
  mesDeDestinoPantalla,
  tandaCambiaDeMes,
  nombreDeTanda,
  paqueteDeTanda,
  pisoDelEmbarque,
  resumenAsignado,
  tandaInicial,
  tandaPideMotivo,
  textoAsignado,
  unidadesEscritas,
  textoErrorBarrer,
  validarTandas,
  type TandaForm,
} from "./vista-barrer";
import { pideRelectura } from "./vista-errores";

const textoIngresoDe = (p: PaqueteApi, heredado: string): string => (p.ingreso_propio && p.fecha_ingreso ? `ingreso propio ${textoFecha(p.fecha_ingreso)}` : `hereda del embarque (${textoFecha(heredado)})`);

/**
 * «Programar lo al barrer» (ficha 08b-1b §2.5 y §4.5; F10 y F11): atajo del detalle del embarque para repartir los lotes al barrer en una o
 * varias tandas. Cada tanda es un paquete —uno que ya existe o uno nuevo con su ingreso propio— y las UNIDADES de cada lote que entran en él;
 * «Agregar otra tanda» reparte el mismo lote en otro paquete y otro mes. La suma queda a la vista («Asignado 1 000 de 1 000 u»).
 *
 * Detrás hay tres llamadas que ya existen, cada una consistente por sí sola: crear el paquete (`POST …/paquetes`), fijar su ingreso sin
 * mercadería (`POST /paquetes/[id]/ingreso`, que no mueve nada) y mover las unidades (`POST …/paquete`). Como un paquete nuevo no existe
 * hasta crearlo, «Ver vista previa» crea primero los paquetes nuevos (el botón lo dice) y luego pide la vista previa de cada tanda. Si el
 * movimiento cambia de mes, la vista previa es obligatoria (con la temporada nueva, las entregas que se funden y los meses que se mueven) y
 * pide motivo y causa. Las tandas se aplican de una en una; si una falla, las anteriores quedan hechas y se ven como «aplicada», y al
 * reintentar no se repite ninguna.
 */
export function DialogoProgramarBarrer({
  embarque,
  onAplicado,
  onCerrar,
  onRecargar,
}: {
  embarque: EmbarqueDetalleApi;
  onAplicado: (r: RespuestaMovimientoApi) => void | Promise<void>;
  onCerrar: () => void;
  /** Relee el detalle del embarque cuando lo que se veía ya no vale, o al cerrar con cambios ya hechos. */
  onRecargar?: () => void | Promise<void>;
}) {
  const accion = useAccion();
  // El embarque vivo: el último que devolvió una de nuestras escrituras, si es más nuevo que el que pasó la pantalla.
  const [ultimo, setUltimo] = useState<EmbarqueDetalleApi | null>(null);
  const emb = ultimo !== null && ultimo.revision >= embarque.revision ? ultimo : embarque;
  const lotes = lotesAlBarrer(emb);
  const [totales] = useState<ReadonlyMap<string, number>>(() => new Map(lotesAlBarrer(embarque).map((l) => [l.id, l.unidades])));
  const [tandas, setTandas] = useState<TandaForm[]>(() => [tandaInicial("t1", lotesAlBarrer(embarque), ingresoHeredado(embarque), true)]);
  const [siguiente, setSiguiente] = useState(2);
  const [motivo, setMotivo] = useState("");
  const [causa, setCausa] = useState<CausaFecha>("programacion");
  const [guardado, setGuardado] = useState<{ firmas: Record<string, string>; planes: Record<string, PlanMovimientoApi> } | null>(null);
  const [trabajando, setTrabajando] = useState<"previa" | "aplicar" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hubo, setHubo] = useState(false);
  const ocupado = trabajando !== null || accion.ocupado;

  const piso = pisoDelEmbarque(emb);
  const heredado = ingresoHeredado(emb);
  const paquetesAbiertos = emb.paquetes.filter((p) => p.estado === "abierto");
  const validacion = validarTandas(tandas, lotes, emb);
  const pendientes = tandas.map((t, i) => ({ t, i })).filter((x) => !x.t.aplicada);
  const pideMotivo = pendientes.some(({ t }) => tandaPideMotivo(t, validacion.items[t.clave] ?? [], emb));
  const faltaMotivo = pideMotivo && motivo.trim() === "";
  const pideVistaPrevia = pendientes.some(({ t }) => tandaCambiaDeMes(t, validacion.items[t.clave] ?? [], emb));
  const hayPaquetesPorCrear = pendientes.some(({ t }) => t.destino === DESTINO_NUEVO && !(t.creado?.ingresoFijado ?? false));

  // La vista previa de una tanda vale mientras no cambie nada de lo que la origina (la revisión del embarque no cuenta: cambia al aplicar otra tanda).
  const firmaDe = (t: TandaForm, i: number): string =>
    JSON.stringify([t.destino, nombreDeTanda(t, i, tandas.length), t.fecha, (validacion.items[t.clave] ?? []).map((x) => [x.id, x.unidades]), motivo.trim(), causa]);
  const planDe = (t: TandaForm, i: number): PlanMovimientoApi | null => (guardado !== null && guardado.firmas[t.clave] === firmaDe(t, i) ? (guardado.planes[t.clave] ?? null) : null);
  const todosConPlan = pendientes.length > 0 && pendientes.every(({ t, i }) => planDe(t, i) !== null);
  const hayPlanViejo = guardado !== null && !todosConPlan;

  const resumen = resumenAsignado(totales, tandas);
  const sinRepartir = resumen.total - resumen.asignado;
  const listo = validacion.errores.length === 0 && !faltaMotivo;
  const pista = validacion.errores[0] ?? (faltaMotivo ? "Escribe el motivo: crear el paquete o mover lo al barrer a otro mes lo pide." : null);

  // ─── Edición de las tandas ───
  const cambiarTanda = (clave: string, cambio: Partial<TandaForm>) => setTandas((ts) => ts.map((t) => (t.clave === clave ? { ...t, ...cambio } : t)));
  const escribirUnidades = (clave: string, id: string, valor: string) => setTandas((ts) => ts.map((t) => (t.clave === clave ? { ...t, unidades: { ...t.unidades, [id]: valor } } : t)));
  const agregarTanda = () => {
    setTandas((ts) => [...ts, tandaInicial(`t${siguiente}`, lotes, heredado, false)]);
    setSiguiente((n) => n + 1);
  };
  const quitarTanda = (clave: string) => setTandas((ts) => ts.filter((t) => t.clave !== clave));
  // «Todo»: lo que le queda al lote después de lo escrito en las otras tandas pendientes.
  const completar = (clave: string, lote: AsignacionApi) => {
    const otras = tandas.filter((t) => t.clave !== clave && !t.aplicada).reduce((a, t) => {
      const v = leerUnidades(t.unidades[lote.id]);
      return a + (typeof v === "number" ? v : 0);
    }, 0);
    escribirUnidades(clave, lote.id, String(Math.max(0, lote.unidades - otras)));
  };

  const cerrar = () => {
    if (hubo) void onRecargar?.();
    onCerrar();
  };

  async function fallar(e: { mensaje: string; codigo: string | null }, tanda: number | null): Promise<void> {
    setError(textoErrorBarrer(e, tanda === null ? undefined : `Tanda ${tanda + 1}`));
    if (pideRelectura(e.codigo)) {
      setGuardado(null);
      await onRecargar?.();
    }
  }

  /**
   * Crea los paquetes nuevos que falten y fija su ingreso propio (sin mercadería: no mueve nada). Cada paso queda anotado en la tanda para que
   * un reintento no repita lo que ya salió bien. Devuelve el embarque vivo y las tandas al día, o `null` si algo falló (el error ya se mostró).
   */
  async function prepararPaquetes(): Promise<{ emb: EmbarqueDetalleApi; tandas: TandaForm[] } | null> {
    let actual = emb;
    let ts = tandas;
    const anotar = (clave: string, cambio: Partial<TandaForm>) => {
      ts = ts.map((t) => (t.clave === clave ? { ...t, ...cambio } : t));
      cambiarTanda(clave, cambio);
    };
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i];
      if (t.aplicada || t.destino !== DESTINO_NUEVO) continue;
      let creado = t.creado;
      if (creado === null) {
        const nombre = nombreDeTanda(t, i, ts.length);
        const previos = new Set(actual.paquetes.map((p) => p.id));
        const base = actual;
        const r = await accion.ejecutar(() => crearPaquete(base.id, { revision_embarque: base.revision, nombre, responsable_id: null, nota: null }));
        if (!r.ok) {
          await fallar(r.error, i);
          return null;
        }
        actual = r.valor.embarque;
        setUltimo(actual);
        setHubo(true);
        const nuevo = actual.paquetes.find((p) => !previos.has(p.id) && p.nombre === nombre) ?? actual.paquetes.find((p) => !previos.has(p.id));
        if (!nuevo) {
          setError(`Tanda ${i + 1}: se creó el paquete, pero no lo encontramos al releer el embarque. Cierra esta ventana y revisa los paquetes.`);
          return null;
        }
        creado = { paqueteId: nuevo.id, ingresoFijado: false };
        anotar(t.clave, { creado });
      }
      if (!creado.ingresoFijado) {
        const base = actual;
        const paqueteId = creado.paqueteId;
        const r = await accion.ejecutar(() => fijarIngresoPaquete(paqueteId, { revision_embarque: base.revision, fecha_ingreso_stock: t.fecha, motivo: motivo.trim(), causa }));
        if (!r.ok) {
          await fallar(r.error, i);
          return null;
        }
        if (!esPlan(r.valor)) {
          actual = r.valor.embarque;
          setUltimo(actual);
        }
        anotar(t.clave, { creado: { paqueteId, ingresoFijado: true } });
      }
    }
    return { emb: actual, tandas: ts };
  }

  async function previsualizar() {
    if (!listo || ocupado) return;
    setError(null);
    setTrabajando("previa");
    try {
      const prep = await prepararPaquetes();
      if (prep === null) return;
      const planes: Record<string, PlanMovimientoApi> = {};
      const firmas: Record<string, string> = {};
      for (let i = 0; i < prep.tandas.length; i++) {
        const t = prep.tandas[i];
        if (t.aplicada) continue;
        const p = paqueteDeTanda(t, prep.emb.paquetes);
        if (p === null) return setError(`Tanda ${i + 1}: no encontramos el paquete. Vuelve a intentarlo.`);
        const { items } = itemsDeTanda(t.unidades, prep.emb.asignaciones);
        const cuerpo = cuerpoMoverAPaquete({ revision: prep.emb.revision, paqueteId: p.id, items, asignaciones: prep.emb.asignaciones, motivo, causa });
        const idEmbarque = prep.emb.id;
        const r = await accion.ejecutar(() => moverAPaquete(idEmbarque, cuerpo, true));
        if (!r.ok) return await fallar(r.error, i);
        if (esPlan(r.valor)) {
          planes[t.clave] = r.valor;
          firmas[t.clave] = firmaDe(t, i);
        }
      }
      setGuardado({ firmas, planes });
    } finally {
      setTrabajando(null);
    }
  }

  async function programar() {
    if (!listo || ocupado || (pideVistaPrevia && !todosConPlan)) return;
    setError(null);
    setTrabajando("aplicar");
    try {
      const prep = await prepararPaquetes();
      if (prep === null) return;
      let actual = prep.emb;
      let ultima: RespuestaMovimientoApi | null = null;
      const avisos: AvisoDetalleApi[] = [];
      for (let i = 0; i < prep.tandas.length; i++) {
        const t = prep.tandas[i];
        if (t.aplicada) continue;
        const p = paqueteDeTanda(t, actual.paquetes);
        if (p === null) return setError(`Tanda ${i + 1}: no encontramos el paquete. Vuelve a intentarlo.`);
        const { items } = itemsDeTanda(t.unidades, actual.asignaciones);
        const plan = planDe(t, i);
        // El mes real del paquete ya creado puede no ser el que se estimó (p. ej. lo subió a la llegada): si ahora cambia de mes, hace falta su vista previa.
        if (plan === null && cambiaDeMes(items, actual.asignaciones, mesDeDestinoPantalla(actual, p), p.id)) {
          setGuardado(null);
          return setError(`Tanda ${i + 1}: esta tanda cambia de mes y falta su vista previa. Pulsa «Ver vista previa» y revisa antes de programar.`);
        }
        const cuerpo = { ...cuerpoMoverAPaquete({ revision: actual.revision, paqueteId: p.id, items, asignaciones: actual.asignaciones, motivo, causa }), ...(plan ? { huella_plan: plan.huella_plan } : {}) };
        const base = actual;
        const r = await accion.ejecutar(() => moverAPaquete(base.id, cuerpo, false));
        if (!r.ok) return await fallar(r.error, i);
        if (esPlan(r.valor)) return setError("El servidor devolvió una vista previa en lugar de aplicar. Vuelve a intentarlo.");
        ultima = r.valor;
        actual = r.valor.embarque;
        setUltimo(actual);
        setHubo(true);
        avisos.push(...r.valor.avisos.filter((a) => !avisos.some((x) => x.aviso === a.aviso && x.detalle === a.detalle)));
        cambiarTanda(t.clave, { aplicada: true });
      }
      if (ultima !== null) await onAplicado({ ...ultima, avisos });
    } finally {
      setTrabajando(null);
    }
  }

  // ─── Pintado ───
  const columnasLotes: Columna<AsignacionApi>[] = [
    { clave: "compra", titulo: "Compra", render: (l) => <span className="whitespace-nowrap font-medium">{l.compra.numero}</span> },
    { clave: "lote", titulo: "Lote", render: (l) => <span className="whitespace-nowrap text-xs">{textoLinea(l.linea)}</span> },
    { clave: "mes", titulo: "Mes", render: (l) => <span className="whitespace-nowrap text-xs">{mesCorto(l.periodo)}</span> },
    {
      clave: "donde",
      titulo: "Dónde está",
      render: (l) => <span className="whitespace-nowrap text-xs">{l.paquete_id === null ? "Sin paquete" : `Paquete ${emb.paquetes.find((p) => p.id === l.paquete_id)?.nombre ?? ""}`}</span>,
    },
    { clave: "unidades", titulo: "Unidades", className: "text-right", render: (l) => <span className="font-mono tabular-nums">{unidades(l.unidades)} u</span> },
    {
      clave: "asignado",
      titulo: "Asignado",
      className: "text-right",
      render: (l) => {
        const x = resumen.porLote.get(l.id);
        return <span className="whitespace-nowrap font-mono text-xs tabular-nums">{x ? `${unidades(x.asignado)} de ${unidades(x.total)} u` : "—"}</span>;
      },
    },
  ];

  if (lotes.length === 0 && !tandas.some((t) => t.aplicada)) {
    return (
      <Modal titulo="Programar lo al barrer" descripcion={`Embarque ${emb.codigo}`} onCerrar={cerrar} ancho="max-w-lg" pie={<Button onClick={cerrar}>Cerrar</Button>}>
        <Alert tono="info">Este embarque no tiene lotes al barrer asignados. Usa «Agregar compras» para asignar un lote al embarque y vuelve aquí.</Alert>
      </Modal>
    );
  }

  return (
    <Modal
      titulo="Programar lo al barrer"
      descripcion={`Embarque ${emb.codigo}: reparte los lotes al barrer en una o varias tandas. Cada tanda es un paquete con su fecha de ingreso al stock.`}
      onCerrar={cerrar}
      cerrable={!ocupado}
      ancho="max-w-4xl"
      pie={
        <>
          <Button variante="secundario" onClick={cerrar} disabled={ocupado}>
            {hubo ? "Cerrar" : "Cancelar"}
          </Button>
          <Button variante="secundario" onClick={() => void previsualizar()} disabled={ocupado || !listo}>
            {trabajando === "previa" ? "Calculando…" : hayPaquetesPorCrear ? "Crear paquetes y ver vista previa" : "Ver vista previa"}
          </Button>
          <Button onClick={() => void programar()} disabled={ocupado || !listo || (pideVistaPrevia && !todosConPlan)} title={pideVistaPrevia && !todosConPlan ? "Esto cambia de mes: primero mira la vista previa." : undefined}>
            {trabajando === "aplicar" ? "Programando…" : "Programar"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert onCerrar={() => setError(null)}>{error}</Alert>}
        {hubo && (
          <Alert tono="info">
            {tandas.some((t) => t.aplicada) ? `${plural(tandas.filter((t) => t.aplicada).length, "tanda ya está aplicada", "tandas ya están aplicadas")}. ` : ""}
            {tandas.some((t) => t.creado !== null) ? "Los paquetes creados quedan en el embarque aunque cierres esta ventana." : ""}
          </Alert>
        )}

        <p className="text-xs text-tinta-suave">
          El embarque llega al CD el {textoFecha(piso)}: el ingreso de un paquete no puede ser antes. Si el ingreso cae en otro mes, esa mercadería cambia de mes en el flujo y se vuelve a repartir con la temporada del mes nuevo.
        </p>

        <section aria-label="Lotes al barrer del embarque" className="space-y-1">
          <h3 className="text-sm font-semibold">Lo que está al barrer</h3>
          <DataTable columnas={columnasLotes} filas={lotes} claveFila={(l) => l.id} />
        </section>

        <section aria-label="Tandas" className="space-y-3">
          {tandas.map((t, i) => {
            if (t.aplicada) {
              const movidas = unidadesEscritas(t);
              return (
                <p key={t.clave} className="rounded-lg border border-exito/30 bg-exito-suave px-3 py-2 text-sm text-exito">
                  <span aria-hidden="true">✓ </span>
                  {etiquetaTanda(t, i, tandas.length, emb.paquetes)}: aplicada ({unidades(movidas)} u).
                </p>
              );
            }
            const p = paqueteDeTanda(t, emb.paquetes);
            const errores = validacion.porTanda[t.clave] ?? [];
            const enTanda = (validacion.items[t.clave] ?? []).reduce((a, x) => a + x.unidades, 0);
            const nombreNuevo = t.destino === DESTINO_NUEVO && t.creado === null;
            return (
              <div key={t.clave} role="group" aria-label={`Tanda ${i + 1}`} className="space-y-3 rounded-lg border border-borde p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Tanda {i + 1}</h3>
                  {pendientes.length > 1 && t.creado === null && (
                    <Button tamano="sm" variante="fantasma" onClick={() => quitarTanda(t.clave)} disabled={ocupado}>
                      Quitar esta tanda
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Paquete de la tanda">
                    <Select value={t.destino} onChange={(e) => cambiarTanda(t.clave, { destino: e.target.value })} disabled={ocupado || t.creado !== null}>
                      <option value={DESTINO_NUEVO}>{t.creado !== null && p ? `${p.nombre} (recién creado)` : "Crear paquete nuevo"}</option>
                      {paquetesAbiertos
                        .filter((x) => x.id !== t.creado?.paqueteId)
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.nombre} · {textoIngresoDe(x, heredado)}
                          </option>
                        ))}
                    </Select>
                  </Field>
                  {nombreNuevo ? (
                    <>
                      <Field label="Nombre del paquete">
                        <Input value={t.nombre ?? nombreDeTanda(t, i, tandas.length)} onChange={(e) => cambiarTanda(t.clave, { nombre: e.target.value })} maxLength={MAX_NOMBRE_AGRUPADOR} disabled={ocupado} autoComplete="off" />
                      </Field>
                      <Field label="Ingreso al stock del paquete" hint={`No ofrece días antes de la llegada del embarque (${textoFecha(piso)}).`} className="sm:col-span-2">
                        <Input type="date" value={t.fecha} min={piso} onChange={(e) => cambiarTanda(t.clave, { fecha: e.target.value })} disabled={ocupado} />
                      </Field>
                    </>
                  ) : (
                    p && (
                      <p className="self-end text-xs text-tinta-suave">
                        {p.nombre}: {textoIngresoDe(p, heredado)}.{" "}
                        {t.creado === null && !(p.ingreso_propio && p.fecha_ingreso) ? "Si quieres otra fecha, usa «Fijar ingreso…» del paquete antes, o crea un paquete nuevo." : ""}
                      </p>
                    )
                  )}
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-medium text-tinta-suave">Unidades de cada lote en esta tanda</p>
                  <ul className="space-y-2">
                    {lotes.map((l) => (
                      <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="min-w-0 flex-1 basis-40 text-sm">
                          <span className="font-medium">{l.compra.numero}</span> · {textoLinea(l.linea)} · <span className="whitespace-nowrap">{mesCorto(l.periodo)}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Input
                            inputMode="numeric"
                            value={t.unidades[l.id] ?? ""}
                            onChange={(e) => escribirUnidades(t.clave, l.id, e.target.value)}
                            aria-label={`Unidades de ${l.compra.numero}, ${textoLinea(l.linea)}, en la tanda ${i + 1}`}
                            className="w-24 text-right font-mono tabular-nums"
                            disabled={ocupado}
                            autoComplete="off"
                          />
                          <span className="whitespace-nowrap text-xs text-tinta-suave">de {unidades(l.unidades)} u</span>
                          <Button tamano="sm" variante="fantasma" onClick={() => completar(t.clave, l)} disabled={ocupado} aria-label={`Poner todo lo que queda de ${l.compra.numero}, ${textoLinea(l.linea)}, en la tanda ${i + 1}`}>
                            Todo
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-tinta-suave">En esta tanda: {unidades(enTanda)} u.</p>
                </div>
                {errores.length > 0 && (
                  <ul className="space-y-0.5 text-xs text-alerta">
                    {errores.map((x) => (
                      <li key={x}>⚠ {x}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          <Button variante="secundario" onClick={agregarTanda} disabled={ocupado}>
            Agregar otra tanda
          </Button>
        </section>

        <p className="text-sm" aria-live="polite">
          <strong className="tabular-nums">{textoAsignado(resumen.asignado, resumen.total)}</strong>
          {sinRepartir > 0 && resumen.asignado > 0 ? ` · faltan ${unidades(sinRepartir)} u: se quedan donde están.` : ""}
          {sinRepartir < 0 ? " · te pasaste de unidades." : ""}
        </p>

        <section aria-label="Motivo y causa" className="grid gap-3 sm:grid-cols-2">
          <Field label={`Causa${pideMotivo ? " *" : ""}`} hint={pideMotivo ? "Obligatoria: se crea un paquete con ingreso propio o algo cambia de mes." : "Se pide si algo cambia de mes."}>
            <Select value={causa} onChange={(e) => setCausa(e.target.value as CausaFecha)} aria-required={pideMotivo} disabled={ocupado}>
              {LISTA_CAUSAS_FECHA.map((c) => (
                <option key={c} value={c}>
                  {ETIQUETA_CAUSA_FECHA[c]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={`Motivo${pideMotivo ? " *" : ""}`} hint="Queda en el historial del embarque.">
            <Textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={MAX_MOTIVO_MOVIMIENTO} rows={2} aria-required={pideMotivo} disabled={ocupado} />
          </Field>
        </section>

        {!listo && pista && <p className="text-xs text-tinta-suave">{pista}</p>}
        {hayPlanViejo && <Alert tono="info">Cambiaste algo: vuelve a mirar la vista previa antes de programar.</Alert>}
        {todosConPlan && (
          <div className="space-y-3" aria-label="Vista previa de las tandas">
            {pendientes.map(({ t, i }) => {
              const plan = planDe(t, i);
              if (plan === null) return null;
              return (
                <div key={t.clave} className="space-y-1">
                  <h3 className="text-sm font-semibold">{etiquetaTanda(t, i, tandas.length, emb.paquetes)}</h3>
                  <VistaPreviaPlan
                    plan={plan}
                    extra={<ExtraMesesPlan plan={plan} />}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}
