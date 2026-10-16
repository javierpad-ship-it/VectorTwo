"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { formatearNumero, plural } from "@/lib/formato";
import type { FilaApi, ProyeccionApi, RespuestaTiendasApi, TiendaProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { AlertaError, Avisos, BotonEnlace, NUM } from "./comunes";
import { rutaProyeccion, useAccion, useLectura } from "./use-proyeccion";
import {
  ETIQUETA_METODO,
  etiquetaBloqueTienda,
  etiquetaReferenciaAlternativa,
  filaFijada,
  leerEntero,
  leerRampa,
  nombreMes,
  textoComposicion,
  textoPerfilApertura,
  textoRampa,
  unidades,
} from "./vista";

const POR_PAGINA = 50;

/**
 * Las filas GML × agrupación de marca de una tienda nueva, con la cifra que se puede fijar a mano en cada una. Pesan mucho
 * (cientos de filas por tienda), así que no vienen con la tarjeta: se leen bajo demanda al expandir
 * (`GET …/tiendas/[tiendaId]/filas?anio=`), con estado de carga y de error. Si la respuesta de la tienda aún trae `filas`
 * (contrato anterior), se usan esas sin pedir nada.
 */
function FilasDeTienda({
  t,
  proyeccionId,
  bloqueada,
  onCambiarFila,
}: {
  t: TiendaProyeccionApi;
  proyeccionId: string;
  bloqueada: boolean;
  onCambiarFila: (fila: FilaApi, decidido: number | null) => Promise<boolean>;
}) {
  const [abierto, setAbierto] = useState(false);
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const incrustadas = (t as { filas?: FilaApi[] }).filas;
  const lazy = incrustadas === undefined || incrustadas.length === 0;
  const lectura = useLectura<FilaApi[] | { filas: FilaApi[] }>(abierto && lazy ? `${rutaProyeccion(proyeccionId)}/tiendas/${t.tienda_id}/filas?anio=${t.anio}` : null);
  const crudo = lazy ? lectura.datos : incrustadas;
  const todas: FilaApi[] | null = crudo === null ? null : Array.isArray(crudo) ? crudo : crudo.filas;
  const filas = (todas ?? []).filter((f) => f.activo).sort((a, b) => (b.anios.find((x) => x.anio === t.anio)?.vigente ?? 0) - (a.anios.find((x) => x.anio === t.anio)?.vigente ?? 0));
  const visibles = filas.slice(0, mostrar);
  return (
    <details className="rounded-md border border-borde bg-superficie px-3 py-2" onToggle={(e) => setAbierto(e.currentTarget.open)}>
      <summary className="cursor-pointer select-none text-sm font-medium">
        Filas de {t.codigo}
        {todas !== null ? ` (${formatearNumero(filas.length)})` : ""} · GML × agrupación de marca
      </summary>
      {abierto && lazy && lectura.error && (
        <div className="mt-2">
          <AlertaError error={lectura.error} onCerrar={() => lectura.setError(null)} onRecargar={() => void lectura.recargar()} />
        </div>
      )}
      {abierto && lazy && lectura.cargando && todas === null && <p className="mt-2 text-sm text-tinta-suave">Leyendo las filas de {t.codigo}…</p>}
      {todas !== null && (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-neutro-suave text-left uppercase tracking-wide text-tinta-suave">
                <tr>
                  <th className="px-2 py-1 font-medium">Línea</th>
                  <th className="px-2 py-1 font-medium">Agrup. marca</th>
                  <th className="px-2 py-1 text-right font-medium">{t.anio} propuesto</th>
                  <th className="px-2 py-1 text-right font-medium">Vigente</th>
                  {Array.from({ length: 12 }, (_, i) => (
                    <th key={i} className="px-1 py-1 text-right font-medium">
                      {nombreMes(i + 1)}
                    </th>
                  ))}
                  <th className="px-2 py-1 text-right font-medium">Fijar cifra</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde">
                {filas.length === 0 && (
                  <tr>
                    <td colSpan={16} className="px-2 py-4 text-center text-tinta-suave">
                      Sin filas de venta para esta tienda.
                    </td>
                  </tr>
                )}
                {visibles.map((f) => {
                  const r = f.anios.find((x) => x.anio === t.anio);
                  return (
                    <tr key={f.id}>
                      <td className="px-2 py-1">
                        {f.genero} · {f.mundo} · {f.linea}
                      </td>
                      <td className="px-2 py-1">{f.equivalencia ? `${f.equivalencia} · ${f.agrupacion_marca}` : f.agrupacion_marca}</td>
                      <td className={`px-2 py-1 ${NUM}`}>{unidades(r?.propuesto)}</td>
                      <td className={`px-2 py-1 ${NUM} font-semibold`}>{unidades(r?.vigente)}</td>
                      {Array.from({ length: 12 }, (_, i) => (
                        <td key={i} className={`px-1 py-1 ${NUM} ${r?.origen_meses?.[i] === "real" ? "bg-neutro-suave text-tinta-suave" : "italic"}`}>
                          {r?.meses ? formatearNumero(r.meses[i]) : "—"}
                        </td>
                      ))}
                      <td className="px-2 py-1">
                        {t.bloque === "nuevas" && r && (
                          <FijarCifra
                            key={`${f.id}-${r.decidido}-${r.origen}`}
                            registro={r}
                            bloqueada={bloqueada}
                            etiqueta={`${f.linea} ${f.agrupacion_marca}`}
                            onGuardar={async (n) => {
                              const ok = await onCambiarFila(f, n);
                              if (ok && lazy) await lectura.recargar();
                              return ok;
                            }}
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filas.length > mostrar && (
            <div className="mt-2 text-center">
              <Button variante="secundario" tamano="sm" onClick={() => setMostrar((m) => m + POR_PAGINA)}>
                Mostrar {Math.min(POR_PAGINA, filas.length - mostrar)} más
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs text-tinta-suave">
            Una fila fijada a mano no se escala con el total de la tienda; las demás sí. Las filas de tiendas nuevas no entran en las filas base de «Por línea»: la matriz las suma en sus propias columnas.
          </p>
        </>
      )}
    </details>
  );
}

function FijarCifra({ registro, bloqueada, etiqueta, onGuardar }: { registro: NonNullable<FilaApi["anios"][number]>; bloqueada: boolean; etiqueta: string; onGuardar: (n: number | null) => Promise<boolean> }) {
  const fijada = filaFijada(registro);
  const [texto, setTexto] = useState(fijada ? String(registro.decidido) : "");
  const [motivo, setMotivo] = useState<string | null>(null);
  async function enviar() {
    if (texto.trim() === "") {
      if (fijada) await onGuardar(null);
      return;
    }
    const l = leerEntero(texto);
    if (!l.ok) {
      setMotivo(l.motivo);
      return;
    }
    setMotivo(null);
    if (!(fijada && registro.decidido === l.valor)) await onGuardar(l.valor);
  }
  return (
    <div className="flex flex-col items-end gap-0.5">
      <Input
        inputMode="numeric"
        value={texto}
        disabled={bloqueada}
        aria-label={`Fijar la cifra de ${etiqueta}`}
        placeholder="auto"
        title={motivo ?? (fijada ? "Cifra fijada a mano; vacía y Enter para volver a escalarla" : "Escribe una cifra y Enter para fijarla")}
        onChange={(e) => {
          setTexto(e.target.value);
          setMotivo(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void enviar();
          }
        }}
        className={`h-7 w-20! text-right font-mono text-xs tabular-nums ${motivo ? "border-alerta!" : ""}`}
      />
      {motivo && <span className="max-w-32 text-right text-[10px] text-alerta">{motivo}</span>}
    </div>
  );
}

/** Editor de la rampa de maduración de la tienda: de 1 a 6 valores en (0, 5], con el perfil de la apertura histórica al lado. */
function EditorRampa({ t, perfiles, bloqueada, ocupado, onGuardar }: { t: TiendaProyeccionApi; perfiles: RespuestaTiendasApi["perfiles_apertura"]; bloqueada: boolean; ocupado: boolean; onGuardar: (rampa: number[]) => Promise<boolean> }) {
  const [textos, setTextos] = useState<string[]>(() => Array.from({ length: 6 }, (_, i) => (t.rampa[i] === undefined ? "" : String(t.rampa[i]))));
  const [motivo, setMotivo] = useState<string | null>(null);
  async function guardar() {
    const r = leerRampa(textos);
    if (!r.ok) {
      setMotivo(r.motivo);
      return;
    }
    setMotivo(null);
    await onGuardar(r.valor);
  }
  return (
    <details className="rounded-md border border-borde bg-superficie px-3 py-2">
      <summary className="cursor-pointer select-none text-sm font-medium">
        Rampa de maduración de la tienda: <span className="font-mono">{textoRampa(t.rampa)}</span>
        {t.rampa.every((v) => v === 1) ? " (sin rampa)" : ""}
      </summary>
      <div className="mt-3 space-y-3">
        <p className="text-xs text-tinta-suave">
          Cada valor multiplica a la curva en los meses desde la apertura (el primero cuenta solo los días abiertos del mes de apertura); después de la lista, 1. Valores entre 0 y 5: puede haber un pico al abrir.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          {textos.map((v, i) => (
            <Field key={i} label={`Mes ${i + 1}`} className="w-16">
              <Input
                inputMode="decimal"
                value={v}
                disabled={bloqueada || ocupado}
                onChange={(e) => {
                  setTextos((prev) => prev.map((x, j) => (j === i ? e.target.value : x)));
                  setMotivo(null);
                }}
                className="h-8 text-center font-mono"
              />
            </Field>
          ))}
          <Button variante="secundario" tamano="sm" disabled={bloqueada || ocupado} onClick={() => void guardar()}>
            Guardar rampa
          </Button>
        </div>
        {motivo && <p className="text-xs text-alerta">{motivo}</p>}
        {perfiles.length > 0 ? (
          <div className="rounded-md bg-fondo px-3 py-2 text-xs text-tinta-suave">
            <p className="mb-1 font-medium text-tinta">Perfil observado en aperturas con historia (ritmo de cada mes frente al total maduro, sin estacionalidad)</p>
            <ul className="space-y-0.5">
              {perfiles.map((p) => (
                <li key={p.tienda}>
                  <span className="font-mono text-tinta">{p.tienda}</span>: <span className="font-mono">{textoPerfilApertura(p.ratios)}</span> (meses 1 a {p.ratios.length})
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-xs text-tinta-suave">No hay aperturas con historia y doce meses posteriores para mostrar como referencia.</p>
        )}
      </div>
    </details>
  );
}

/** Decisión del total de la tienda en el año: propuesta o cifra, con nota. Se monta con `key` = la decisión vigente. */
function DecisionTienda({ t, bloqueada, ocupado, onEnviar }: { t: TiendaProyeccionApi; bloqueada: boolean; ocupado: boolean; onEnviar: (cuerpo: Record<string, unknown>) => Promise<boolean> }) {
  const [texto, setTexto] = useState(t.decidido === null ? "" : String(t.decidido));
  const [nota, setNota] = useState(t.nota ?? "");
  const [motivo, setMotivo] = useState<string | null>(null);
  const decidida = t.decidido !== null;
  const deshabilitada = bloqueada || ocupado;
  const notaLimpia = nota.trim() === "" ? null : nota.trim();

  async function guardarCifra() {
    const l = leerEntero(texto);
    if (!l.ok) {
      setMotivo(l.motivo);
      return;
    }
    setMotivo(null);
    await onEnviar({ decidido: l.valor, origen: "manual", nota: notaLimpia });
  }

  return (
    <div className="space-y-3 rounded-lg border border-borde px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <Field label={`Unidades de ${t.codigo} en ${t.anio}`} hint={t.propuesto === null ? "Sin propuesta: escribe el total" : `Propuesta ${formatearNumero(t.propuesto)}`}>
          <Input
            inputMode="numeric"
            value={texto}
            disabled={deshabilitada}
            placeholder={t.propuesto === null ? "—" : formatearNumero(t.propuesto)}
            onChange={(e) => {
              setTexto(e.target.value);
              setMotivo(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void guardarCifra();
              }
            }}
            className="font-mono tabular-nums"
          />
        </Field>
        <Field label="Nota" hint="Opcional, hasta 300 caracteres">
          <Input value={nota} maxLength={300} disabled={deshabilitada} onChange={(e) => setNota(e.target.value)} />
        </Field>
      </div>
      {motivo && <p className="text-xs text-alerta">{motivo}</p>}
      {!bloqueada && (
        <div className="flex flex-wrap gap-2">
          <Button tamano="sm" disabled={deshabilitada || t.propuesto === null} onClick={() => void onEnviar({ origen: "propuesta", nota: notaLimpia })}>
            Aceptar la propuesta
          </Button>
          <Button variante="secundario" tamano="sm" disabled={deshabilitada} onClick={() => void guardarCifra()}>
            Guardar esta cifra
          </Button>
          {decidida && (
            <Button variante="fantasma" tamano="sm" disabled={deshabilitada} onClick={() => void onEnviar({ decidido: null, origen: "manual" })}>
              Volver a la propuesta
            </Button>
          )}
        </div>
      )}
      {t.propuesta_al_decidir !== null && decidida && t.propuesta_al_decidir !== t.propuesto && (
        <p className="text-xs text-alerta">
          Decidiste {unidades(t.decidido)} con la propuesta en {unidades(t.propuesta_al_decidir)}; hoy la propuesta es {unidades(t.propuesto)}.
        </p>
      )}
    </div>
  );
}

/**
 * Tarjeta de una tienda nueva o de un cierre por año (ficha 07, paso 2). Arriba, lo de M4 con atajo; debajo, cómo se
 * calculó, las cifras de referencia (últimos tres meses, venta esperada o avance), la decisión del total de la tienda
 * en el año (propuesta o cifra, con nota), la rampa y las filas. Decidir el total de una tienda que pasa a mismas
 * tiendas recalcula en el acto la propuesta del año siguiente de las filas base (B2). Un cierre solo se clasifica.
 */
export function TarjetaTienda({
  t,
  proyeccion,
  perfiles,
  bloqueada,
  abierta,
  onAlternar,
  onAtajo,
  onCambio,
  onRecalcular,
}: {
  t: TiendaProyeccionApi;
  proyeccion: ProyeccionApi;
  perfiles: RespuestaTiendasApi["perfiles_apertura"];
  bloqueada: boolean;
  abierta: boolean;
  onAlternar: () => void;
  onAtajo: () => void;
  onCambio: () => Promise<void>;
  onRecalcular: () => void;
}) {
  const y = proyeccion.anio_en_curso;
  const ruta = `${rutaProyeccion(proyeccion.id)}/tiendas/${t.tienda_id}/anios/${t.anio}`;
  const accion = useAccion();
  const [aviso, setAviso] = useState<string | null>(null);
  const esNueva = t.bloque === "nuevas";
  const decidida = t.decidido !== null;
  const sinDecidirQueAlimenta = esNueva && t.pasa_a_mismas && t.anio === y && !decidida;

  async function enviar(cuerpo: Record<string, unknown>, exito?: (r: TiendaProyeccionApi & { filas_base_recalculadas?: number }) => string | null): Promise<boolean> {
    setAviso(null);
    const r = await accion.ejecutar(() => api.put<TiendaProyeccionApi & { filas_base_recalculadas?: number }>(ruta, cuerpo));
    if (!r.ok) return false;
    setAviso(exito ? exito(r.valor) : null);
    await onCambio();
    return true;
  }

  const mensajeRecalculo = (r: { filas_base_recalculadas?: number }) =>
    t.pasa_a_mismas && (r.filas_base_recalculadas ?? 0) > 0 ? `Se recalculó la propuesta de ${y + 1} de ${plural(r.filas_base_recalculadas ?? 0, "fila base", "filas base")} que incluyen a ${t.codigo}.` : null;

  return (
    <section id={`tienda-${t.tienda_id}-${t.anio}`} className="rounded-xl border border-borde bg-superficie shadow-sm" aria-label={`${t.codigo} en ${t.anio}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-borde px-4 py-3">
        <button type="button" onClick={onAlternar} aria-expanded={abierta} className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-left">
          <span aria-hidden className="text-tinta-suave">
            {abierta ? "▾" : "▸"}
          </span>
          <span className="text-sm font-semibold">
            {t.anio} · {t.codigo} · {t.nombre}
          </span>
          <Badge tono={esNueva ? "marca" : "alerta"}>{etiquetaBloqueTienda(t)}</Badge>
          {t.pasa_a_mismas && <Badge tono="neutro">En {t.anio + 1} pasa a mismas tiendas</Badge>}
          {decidida ? <Badge tono="exito">Decidida · {unidades(t.vigente)}</Badge> : <Badge tono="neutro">Sin decidir · propuesta {unidades(t.propuesto)}</Badge>}
        </button>
        {!bloqueada && (
          <Button variante="secundario" tamano="sm" onClick={onAtajo}>
            Cambiar en Tiendas
          </Button>
        )}
      </header>

      {abierta && (
        <div className="space-y-3 px-4 py-4">
          <p className="text-sm text-tinta-suave">
            {t.bloque === "cierres" ? "Cierra" : "Abre"} el <span className="font-mono text-tinta">{t.fecha_usada}</span>
            {" · "}venta esperada del año de apertura{" "}
            {t.venta_esperada === null ? (
              <span className="text-alerta">sin cargar</span>
            ) : (
              <span className="text-tinta">
                S/ {formatearNumero(t.venta_esperada)} <span className="text-tinta-suave">(sin IGV, desde que abre hasta el 31 de diciembre)</span>
              </span>
            )}
            {" · "}referente: <span className="text-tinta">{t.referente ? `${t.referente.codigo} · ${t.referente.nombre}` : "ninguno (promedio de las mismas tiendas)"}</span>
          </p>

          {sinDecidirQueAlimenta && (
            <Alert tono="alerta">La base de {y + 1} de cada línea incluye a {t.codigo}: decídela antes de las líneas para no volver sobre ellas.</Alert>
          )}
          {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecalcular={onRecalcular} onRecargar={() => void onCambio()} />}
          {aviso && (
            <Alert tono="exito" onCerrar={() => setAviso(null)}>
              {aviso}
            </Alert>
          )}

          <div className="space-y-2 rounded-lg bg-fondo px-3 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-tinta-suave">Cómo se calculó · {ETIQUETA_METODO[t.metodo]}</p>
            {esNueva && (
              <p className="text-sm">
                {textoComposicion(t)}
                {t.unidades_maduras !== null && (
                  <>
                    {" · "}año maduro completo: <span className="font-mono">{formatearNumero(t.unidades_maduras)}</span> u
                  </>
                )}
                {" · "}rampa <span className="font-mono">{textoRampa(t.rampa)}</span>
              </p>
            )}
            {t.explicacion && <p className="whitespace-pre-line text-sm leading-relaxed">{t.explicacion}</p>}
            {(t.referencia_tres_meses !== null || t.referencia_alternativa !== null) && (
              <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-tinta-suave">
                {t.referencia_tres_meses !== null && (
                  <li>
                    Últimos tres meses → <span className="font-mono text-tinta">{unidades(t.referencia_tres_meses)}</span>
                  </li>
                )}
                {t.referencia_alternativa !== null && (
                  <li>
                    {etiquetaReferenciaAlternativa(t.metodo)} → <span className="font-mono text-tinta">{unidades(t.referencia_alternativa)}</span>
                  </li>
                )}
              </ul>
            )}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-tinta-suave">Vendido a la fecha</dt>
                <dd className={NUM}>{unidades(t.vendido)}</dd>
              </div>
              <div>
                <dt className="text-xs text-tinta-suave">Propuesta</dt>
                <dd className={NUM}>{unidades(t.propuesto)}</dd>
              </div>
              <div>
                <dt className="text-xs text-tinta-suave">Decidido</dt>
                <dd className={NUM}>{decidida ? unidades(t.decidido) : "—"}</dd>
              </div>
              <div>
                <dt className="text-xs text-tinta-suave">Vigente</dt>
                <dd className={`${NUM} font-semibold`}>{unidades(t.vigente)}</dd>
              </div>
            </dl>
            <Avisos avisos={t.avisos} detalle />
          </div>

          {esNueva ? (
            <DecisionTienda
              key={`${t.decidido}-${t.origen}-${t.nota}`}
              t={t}
              bloqueada={bloqueada}
              ocupado={accion.ocupado}
              onEnviar={(cuerpo) => enviar(cuerpo, mensajeRecalculo)}
            />
          ) : (
            <p className="rounded-lg border border-borde px-3 py-3 text-sm text-tinta-suave">
              Por ahora un cierre solo se clasifica: se muestra su venta real hasta el último mes cerrado. La proyección de sus meses restantes llega en una versión próxima; no hay nada que decidir.
            </p>
          )}

          {esNueva && <EditorRampa t={t} perfiles={perfiles} bloqueada={bloqueada} ocupado={accion.ocupado} onGuardar={(rampa) => enviar({ origen: "manual", rampa }, () => "Rampa guardada. Las filas de la tienda se repartieron de nuevo con la curva y la rampa.")} />}

          <FilasDeTienda
            t={t}
            proyeccionId={proyeccion.id}
            bloqueada={bloqueada}
            onCambiarFila={async (fila, decidido) => {
              setAviso(null);
              const r = await accion.ejecutar(() => api.put(`${rutaProyeccion(proyeccion.id)}/filas/${fila.id}/anios/${t.anio}`, { decidido, origen: "manual" }));
              if (!r.ok) return false;
              await onCambio();
              return true;
            }}
          />
                    <p className="text-xs text-tinta-suave">
            <BotonEnlace onClick={onAtajo}>Cambiar fecha, venta esperada o referente en Tiendas</BotonEnlace>
          </p>
        </div>
      )}
    </section>
  );
}
