"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import type { BloquesApi, ProyeccionApi, RespuestaProyeccionApi } from "@/lib/proyeccion/tipos-api";
import { RAMPA_MADURACION, UMBRAL_COLA_LARGA, UMBRAL_DISPONIBILIDAD } from "@/lib/proyeccion/tipos-api";
import { AlertaError } from "./comunes";
import { ComposicionBloques } from "./composicion-bloques";
import { useAccion } from "./use-proyeccion";
import { leerEntero, leerPorcentaje, leerRampa, leerUmbralDisponibilidad, mesAaaaMm, mesesElegibles, nombrePorDefecto, textoPerfilApertura, textoTendencia, textoRampa } from "./vista";

const ID_FORM = "form-proyeccion";

/** Casillas de la rampa de maduración (de 1 a 6 valores). */
function CamposRampa({ textos, onCambio, disabled }: { textos: readonly string[]; onCambio: (t: string[]) => void; disabled: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {textos.map((v, i) => (
        <Field key={i} label={`Mes ${i + 1}`} className="w-16">
          <Input
            inputMode="decimal"
            value={v}
            disabled={disabled}
            onChange={(e) => onCambio(textos.map((x, j) => (j === i ? e.target.value : x)))}
            className="h-9 text-center font-mono"
          />
        </Field>
      ))}
    </div>
  );
}

const casillasDeRampa = (rampa: readonly number[]): string[] => Array.from({ length: 6 }, (_, i) => (rampa[i] === undefined ? "" : String(rampa[i])));

/**
 * Nueva proyección (ficha 07, paso 1) o edición de sus parámetros. Nombre, «datos hasta» (arranca en el último mes
 * cerrado y solo se puede retroceder dentro del año en curso), crecimiento por defecto del año siguiente, rampa de
 * maduración (sin rampa por defecto: `1 · 1 · 1`; con el perfil observado de las aperturas históricas como referencia),
 * umbral de cola larga y, al crear, «copiar decisiones de» otra proyección del mismo año. Debajo, la composición de los
 * bloques de tiendas que el sistema deduce de Tiendas. Al crear se calcula: puede tardar.
 */
export function FormularioProyeccion({
  estado,
  proyeccion,
  bloques,
  perfiles,
  copiarDeInicial,
  onCerrar,
  onGuardada,
}: {
  estado: RespuestaProyeccionApi;
  /** Con proyección, se editan sus parámetros; sin ella, se crea una nueva. */
  proyeccion?: ProyeccionApi;
  bloques: BloquesApi;
  perfiles: { tienda: string; ratios: number[] }[];
  /** Al crear, la proyección de la que se copian las decisiones de entrada («Copiar para seguir»). */
  copiarDeInicial?: string;
  onCerrar: () => void;
  onGuardada: (p: ProyeccionApi) => Promise<void> | void;
}) {
  const editando = proyeccion !== undefined;
  const ultimo = estado.datos.ultimo_mes_cerrado;
  const anioBase = editando ? proyeccion.anio_en_curso : Number((ultimo ?? estado.datos.hasta ?? "0000").slice(0, 4));
  const [nombre, setNombre] = useState(editando ? proyeccion.nombre : nombrePorDefecto(anioBase));
  const [hasta, setHasta] = useState(editando ? mesAaaaMm(proyeccion.hasta_periodo) : ultimo ? mesAaaaMm(ultimo) : "");
  const [crecimiento, setCrecimiento] = useState(String(editando ? proyeccion.parametros.crecimiento_pct_defecto : 0));
  const [rampa, setRampa] = useState<string[]>(casillasDeRampa(editando ? proyeccion.parametros.rampa_maduracion : RAMPA_MADURACION));
  const [cola, setCola] = useState(String(editando ? proyeccion.parametros.umbral_cola_larga : UMBRAL_COLA_LARGA));
  const [disponibilidad, setDisponibilidad] = useState(String(editando ? (proyeccion.parametros.umbral_disponibilidad ?? UMBRAL_DISPONIBILIDAD) : UMBRAL_DISPONIBILIDAD));
  const [copiarDe, setCopiarDe] = useState(copiarDeInicial ?? "");
  const [motivo, setMotivo] = useState<string | null>(null);
  const accion = useAccion();

  const mesesHasta = ultimo ? mesesElegibles(editando ? `${proyeccion.anio_en_curso}-12` : ultimo).filter((m) => !ultimo || m <= mesAaaaMm(ultimo)) : [];
  const mismoAnio = estado.proyecciones.filter((p) => p.anio_en_curso === anioBase && (!editando || p.id !== proyeccion.id));
  const sinMeses = !editando && !ultimo;
  const rampaActual = leerRampa(rampa);

  async function enviar(e?: React.FormEvent) {
    e?.preventDefault();
    if (accion.ocupado) return;
    if (nombre.trim() === "") return setMotivo("El nombre es obligatorio.");
    const g = leerPorcentaje(crecimiento);
    if (!g.ok) return setMotivo(g.motivo);
    const r = leerRampa(rampa);
    if (!r.ok) return setMotivo(r.motivo);
    const c = leerEntero(cola);
    if (!c.ok) return setMotivo("El umbral de cola larga debe ser un número entero.");
    const u = leerUmbralDisponibilidad(disponibilidad);
    if (!u.ok) return setMotivo(u.motivo);
    setMotivo(null);
    const parametros = { crecimiento_pct_defecto: g.valor, rampa_maduracion: r.valor, umbral_cola_larga: c.valor, umbral_disponibilidad: u.valor };
    let cuerpoEdicion: Record<string, unknown> | null = null;
    if (editando) {
      // Al editar solo se manda lo que cambió: un parámetro igual no debe dejar la proyección «pendiente de recalcular».
      const p0 = proyeccion.parametros;
      const cambiados: Record<string, unknown> = {};
      if (parametros.crecimiento_pct_defecto !== p0.crecimiento_pct_defecto) cambiados.crecimiento_pct_defecto = parametros.crecimiento_pct_defecto;
      if (parametros.umbral_cola_larga !== p0.umbral_cola_larga) cambiados.umbral_cola_larga = parametros.umbral_cola_larga;
      if (parametros.umbral_disponibilidad !== (p0.umbral_disponibilidad ?? UMBRAL_DISPONIBILIDAD)) cambiados.umbral_disponibilidad = parametros.umbral_disponibilidad;
      if (textoRampa(parametros.rampa_maduracion) !== textoRampa(p0.rampa_maduracion)) cambiados.rampa_maduracion = parametros.rampa_maduracion;
      cuerpoEdicion = {
        ...(nombre.trim() !== proyeccion.nombre ? { nombre: nombre.trim() } : {}),
        ...(hasta !== "" && hasta !== mesAaaaMm(proyeccion.hasta_periodo) ? { hasta_periodo: hasta } : {}),
        ...(Object.keys(cambiados).length > 0 ? { parametros: cambiados } : {}),
      };
      if (Object.keys(cuerpoEdicion).length === 0) {
        onCerrar();
        return;
      }
    }
    const res = await accion.ejecutar(() =>
      editando
        ? api.patch<ProyeccionApi>(`/api/proyeccion/proyecciones/${proyeccion.id}`, cuerpoEdicion)
        : api.post<ProyeccionApi>("/api/proyeccion/proyecciones", { nombre: nombre.trim(), ...(hasta ? { hasta_periodo: hasta } : {}), parametros, ...(copiarDe ? { copiar_de: copiarDe } : {}) })
    );
    if (!res.ok) return;
    await onGuardada(res.valor);
    onCerrar();
  }

  // La tendencia del último año completo como referencia del crecimiento: se muestra solo si la API la entrega
  // (`datos.tendencia_ultimo_anio_pct`, en %); si no, no se inventa.
  const tendencia = textoTendencia((estado.datos as unknown as { tendencia_ultimo_anio_pct?: number | null }).tendencia_ultimo_anio_pct, anioBase);
  const perfilTexto = perfiles.length > 0 ? perfiles.map((p) => `${p.tienda}: ${textoPerfilApertura(p.ratios)}`).join(" · ") : null;

  return (
    <Modal
      titulo={editando ? `Parámetros · ${proyeccion.nombre}` : "Nueva proyección"}
      descripcion={editando ? "Cambiar un parámetro deja la proyección pendiente de recalcular; tus decisiones se conservan." : "Al crearla se calcula con la venta publicada hasta el mes elegido. Puede tardar hasta un minuto."}
      onCerrar={onCerrar}
      cerrable={!accion.ocupado}
      ancho="max-w-3xl"
      pie={
        <>
          {accion.ocupado && <span className="mr-auto text-sm text-tinta-suave">{editando ? "Guardando…" : "Calculando la proyección… no cierres esta ventana."}</span>}
          <Button variante="fantasma" disabled={accion.ocupado} onClick={onCerrar}>
            Cancelar
          </Button>
          <Button type="submit" form={ID_FORM} disabled={accion.ocupado || sinMeses}>
            {accion.ocupado ? (editando ? "Guardando…" : "Calculando…") : editando ? "Guardar parámetros" : "Crear y calcular"}
          </Button>
        </>
      }
    >
      <form id={ID_FORM} onSubmit={(e) => void enviar(e)} className="space-y-4">
        {sinMeses && <Alert tono="alerta">No hay meses publicados en M5: carga venta y stock antes de proyectar.</Alert>}
        {accion.error && <AlertaError error={accion.error} onCerrar={accion.limpiar} onRecalcular={() => void enviar()} />}
        {motivo && <Alert tono="alerta">{motivo}</Alert>}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nombre">
            <Input value={nombre} maxLength={80} disabled={accion.ocupado} onChange={(e) => setNombre(e.target.value)} />
          </Field>
          <Field label="Datos hasta" hint={ultimo ? `Último mes cerrado: ${mesAaaaMm(ultimo)}. Solo se puede retroceder dentro de ${anioBase}.` : "Sin meses publicados."}>
            <Select value={hasta} disabled={accion.ocupado || mesesHasta.length === 0} onChange={(e) => setHasta(e.target.value)}>
              {mesesHasta.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {mesesHasta.length === 0 && <option value="">—</option>}
            </Select>
          </Field>
          <Field label="Crecimiento por defecto del año siguiente (%)" hint={`Cada fila puede tener el suyo. Alimenta solo la propuesta del año siguiente.${tendencia ? ` ${tendencia}` : ""}`}>
            <Input inputMode="decimal" value={crecimiento} disabled={accion.ocupado} onChange={(e) => setCrecimiento(e.target.value)} className="font-mono" />
          </Field>
          <Field label="Umbral de cola larga (unidades)" hint="Una fila con propuesta menor se puede cerrar sin decidir: toma la propuesta.">
            <Input inputMode="numeric" value={cola} disabled={accion.ocupado} onChange={(e) => setCola(e.target.value)} className="font-mono" />
          </Field>
        </div>

        <Field
          label="Umbral de disponibilidad (0 a 1)"
          hint={`Una fila de cola larga con disponibilidad menor que este umbral tuvo un quiebre relevante y se corrige por demanda (queda «para revisión» si supera el umbral de cola larga). Por defecto ${UMBRAL_DISPONIBILIDAD}. La disponibilidad es un proxy mensual: tienda-meses con stock al cierre del mes ÷ tienda-meses totales. Una tienda sin stock puede ser un quiebre o una línea que no se surte en esa tienda; por eso el umbral es editable.`}
        >
          <Input inputMode="decimal" value={disponibilidad} disabled={accion.ocupado} onChange={(e) => { setDisponibilidad(e.target.value); setMotivo(null); }} className="max-w-40 font-mono" />
        </Field>

        <div className="space-y-2">
          <p className="text-sm font-medium">
            Rampa de maduración de las tiendas nuevas: <span className="font-mono">{rampaActual.ok ? textoRampa(rampaActual.valor) : "—"}</span>
            {rampaActual.ok && rampaActual.valor.every((v) => v === 1) ? <span className="font-normal text-tinta-suave"> (sin rampa)</span> : null}
          </p>
          <CamposRampa textos={rampa} onCambio={(t) => { setRampa(t); setMotivo(null); }} disabled={accion.ocupado} />
          <p className="text-xs text-tinta-suave">
            Cada valor multiplica a la curva en los meses desde la apertura; después, 1. Por defecto no hay rampa. Valores entre 0 y 5: una tienda puede vender más al abrir.
            {perfilTexto ? ` Perfil observado en aperturas con historia (ritmo del mes frente al total maduro): ${perfilTexto}.` : " Aún no hay una apertura con historia para mostrar su perfil como referencia."}
          </p>
        </div>

        {!editando && (
          <Field label="Copiar decisiones de" hint={mismoAnio.length === 0 ? `No hay otra proyección de ${anioBase}.` : "Trae las decisiones de otra proyección del mismo año; lo que ya no exista se ignora."}>
            <Select value={copiarDe} disabled={accion.ocupado || mismoAnio.length === 0} onChange={(e) => setCopiarDe(e.target.value)}>
              <option value="">No copiar</option>
              {mismoAnio.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre} ({p.estado === "en_trabajo" ? "en trabajo" : p.estado})
                </option>
              ))}
            </Select>
          </Field>
        )}

        <ComposicionBloques bloques={bloques} anios={[anioBase, anioBase + 1]} abierto titulo="Composición de los bloques de tiendas que se deduce de Tiendas" />
      </form>
    </Modal>
  );
}
