import type {
  AsignableApi,
  AvisoAgrupador,
  AvisoDetalleApi,
  CostoPorMonedaApi,
  EmbarqueApi,
  EstadoEmbarque,
  EstadoViaje,
  OpcionViajeApi,
  PlanMovimientoApi,
  ResponsableEfectivoApi,
  TipoEmbarque,
  ViajeApi,
} from "@/lib/compras/agrupadores/tipos-api";
import { ESTADOS_EMBARQUE, ESTADOS_VIAJE, TIPOS_EMBARQUE } from "@/lib/compras/agrupadores/tipos";
import type { Rol } from "@/lib/auth/roles";
import { plural } from "@/lib/formato";
import { dinero, mesCorto, unidades } from "../formato";

/**
 * Lógica pura de las pantallas de agrupadores de compras (ficha 08b §3.8, §4): parámetros de la URL, filtros, viaje activo, códigos
 * propuestos, textos del resumen de un movimiento y permisos de la pantalla por rol. Sin React y sin I/O, para poder probarla y para que
 * la usen los server components (la cookie del viaje activo se valida aquí). Los permisos de aquí solo ocultan botones: la API decide.
 */

// ─── Permisos de pantalla (§0.3; la API los exige con `requireUser` o `requirePlanner`) ───

/** Cerrar, reabrir y cancelar un viaje, cancelar un embarque o un paquete y revertir una recepción: solo admin y planner. */
export const puedeCerrarOCancelar = (rol: Rol): boolean => rol === "admin" || rol === "planner";

// ─── Viaje activo (§3.8) ───

/** Nombre de la cookie por navegador. La escribe solo `PUT /api/compras/viaje-activo`; ninguna ruta de la API la lee (R22). */
export const COOKIE_VIAJE_ACTIVO = "v2_viaje_activo";

export const VIAJE_TODOS = "todos";
export const VIAJE_SIN_VIAJE = "sin_viaje";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/** El valor de la cookie si es un `uuid`, `todos` o `sin_viaje`; cualquier otra cosa se trata como ausente. */
export function parsearViajeActivo(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  if (valor === VIAJE_TODOS || valor === VIAJE_SIN_VIAJE) return valor;
  return UUID.test(valor) ? valor : null;
}

/**
 * El viaje activo que se aplica: el guardado si sigue siendo válido (existe y no está cancelado); si no, el último viaje abierto (por
 * `fecha_inicio`) del que el usuario es responsable; si no tiene, «todos». Sin la lista de viajes (`null`) se confía en lo guardado.
 */
export function viajeActivoEfectivo(guardado: string | null, viajes: readonly ViajeApi[] | null, perfilId: string): string {
  if (guardado === VIAJE_TODOS || guardado === VIAJE_SIN_VIAJE) return guardado;
  if (guardado !== null) {
    if (viajes === null) return guardado;
    const v = viajes.find((x) => x.id === guardado);
    if (v && v.estado !== "cancelado") return guardado;
  }
  const propios = (viajes ?? []).filter((v) => v.estado === "abierto" && v.responsable?.perfil_id === perfilId);
  propios.sort((a, b) => (a.fecha_inicio < b.fecha_inicio ? 1 : a.fecha_inicio > b.fecha_inicio ? -1 : 0));
  return propios[0]?.id ?? VIAJE_TODOS;
}

/** Lo que viaja como `viaje_id` a la API de listas: nada con «todos». */
export const viajeParaApi = (viajeActivo: string): string | undefined => (viajeActivo === VIAJE_TODOS ? undefined : viajeActivo);

/** Viajes abiertos primero y cerrados al final (marcados), sin los cancelados: para todo selector de viaje. */
export function viajesParaSelector<T extends { estado: EstadoViaje; fecha_inicio: string }>(viajes: readonly T[]): T[] {
  const porFecha = (a: T, b: T) => (a.fecha_inicio < b.fecha_inicio ? 1 : a.fecha_inicio > b.fecha_inicio ? -1 : 0);
  const abiertos = viajes.filter((v) => v.estado === "abierto").sort(porFecha);
  const cerrados = viajes.filter((v) => v.estado === "cerrado").sort(porFecha);
  return [...abiertos, ...cerrados];
}

/** `261001 · Feria Sur · oct-2026`, con «(cerrado)» si el viaje está cerrado. */
export const etiquetaViaje = (v: Pick<OpcionViajeApi, "codigo" | "nombre" | "estado">): string => `${v.codigo} · ${v.nombre}${v.estado === "cerrado" ? " (cerrado)" : ""}`;

// ─── Parámetros de la URL ───

export const PESTANAS = ["embarques", "viajes", "sin-agrupador", "importar"] as const;
export type Pestana = (typeof PESTANAS)[number];

export const ETIQUETA_PESTANA: Record<Pestana, string> = {
  embarques: "Embarques",
  viajes: "Viajes",
  "sin-agrupador": "Sin agrupador",
  importar: "Importar",
};

export type ParametrosAgrupadores = {
  pestana: Pestana;
  /** Embarque abierto (detalle) o `null` para la lista. */
  embarque: string | null;
  /** Viaje abierto (detalle) o `null` para la lista. */
  viaje: string | null;
  /** `true` = «Mis …», `false` = «Todos», `null` = por defecto (el comprador que es responsable de alguno abre en «Mis»). */
  mio: boolean | null;
  estado: EstadoEmbarque | null;
  estadoViaje: EstadoViaje | null;
  tipo: TipoEmbarque | null;
  atrasados: boolean;
  /** Mes de llegada (`aaaa-mm`), desde y hasta. En Sin agrupador, mes de la entrega. */
  desde: string | null;
  hasta: string | null;
  proveedor: string | null;
  q: string;
};

export const PARAMETROS_AGRUPADORES_VACIOS: ParametrosAgrupadores = {
  pestana: "embarques",
  embarque: null,
  viaje: null,
  mio: null,
  estado: null,
  estadoViaje: null,
  tipo: null,
  atrasados: false,
  desde: null,
  hasta: null,
  proveedor: null,
  q: "",
};

export function leerParametrosAgrupadores(get: (clave: string) => string | null): ParametrosAgrupadores {
  const uuidONulo = (k: string) => {
    const v = get(k);
    return v !== null && UUID.test(v) ? v : null;
  };
  const mesONulo = (k: string) => {
    const v = get(k);
    return v !== null && MES.test(v) ? v : null;
  };
  const enLista = <T extends string>(valor: string | null, lista: readonly T[]): T | null => (valor !== null && (lista as readonly string[]).includes(valor) ? (valor as T) : null);
  const desde = mesONulo("desde");
  const hasta = mesONulo("hasta");
  const rangoAlReves = desde !== null && hasta !== null && desde > hasta;
  const mio = get("mio");
  return {
    pestana: enLista(get("pestana"), PESTANAS) ?? "embarques",
    embarque: uuidONulo("embarque"),
    viaje: uuidONulo("viaje"),
    mio: mio === "1" ? true : mio === "0" ? false : null,
    estado: enLista(get("estado"), ESTADOS_EMBARQUE),
    estadoViaje: enLista(get("estado_viaje"), ESTADOS_VIAJE),
    tipo: enLista(get("tipo"), TIPOS_EMBARQUE),
    atrasados: get("atrasados") === "1",
    // Un rango al revés se ignora entero: la API lo rechazaría con 400.
    desde: rangoAlReves ? null : desde,
    hasta: rangoAlReves ? null : hasta,
    proveedor: uuidONulo("proveedor"),
    q: get("q") ?? "",
  };
}

export function consultaAgrupadores(p: ParametrosAgrupadores): string {
  const q = new URLSearchParams();
  if (p.pestana !== "embarques") q.set("pestana", p.pestana);
  if (p.embarque) q.set("embarque", p.embarque);
  if (p.viaje) q.set("viaje", p.viaje);
  if (p.mio !== null) q.set("mio", p.mio ? "1" : "0");
  if (p.estado) q.set("estado", p.estado);
  if (p.estadoViaje) q.set("estado_viaje", p.estadoViaje);
  if (p.tipo) q.set("tipo", p.tipo);
  if (p.atrasados) q.set("atrasados", "1");
  if (p.desde) q.set("desde", p.desde);
  if (p.hasta) q.set("hasta", p.hasta);
  if (p.proveedor) q.set("proveedor", p.proveedor);
  if (p.q.trim() !== "") q.set("q", p.q);
  return q.toString();
}

export const hayFiltrosEmbarques = (p: ParametrosAgrupadores): boolean =>
  p.mio === true || p.estado !== null || p.tipo !== null || p.atrasados || p.desde !== null || p.hasta !== null || p.q.trim() !== "";

// ─── Filtros de listas ───

const sinAcentos = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("es");

/** ¿Es el usuario el responsable efectivo? (el filtro «Mis…», nunca un permiso). */
export const esMio = (r: ResponsableEfectivoApi | { perfil_id: string } | null | undefined, perfilId: string): boolean => r?.perfil_id === perfilId;

/** El comprador que es responsable de algún embarque o viaje abre con «Mis…» activo; el resto, con «Todos». */
export function mioEfectivo(parametro: boolean | null, rol: Rol, hayMios: boolean): boolean {
  if (parametro !== null) return parametro;
  return rol === "comprador" && hayMios;
}

export function filtrarEmbarques(lista: readonly EmbarqueApi[], p: ParametrosAgrupadores, perfilId: string, mio: boolean): EmbarqueApi[] {
  const q = sinAcentos(p.q.trim());
  return lista.filter((e) => {
    if (mio && !esMio(e.responsable_efectivo, perfilId)) return false;
    if (q === "") return true;
    const texto = [e.codigo, e.nombre, e.viaje?.codigo ?? "", e.viaje?.nombre ?? "", e.puerto_embarque ?? "", e.referencia_logistica ?? "", ...e.proveedores.map((x) => x.nombre)].join(" ");
    return sinAcentos(texto).includes(q);
  });
}

/** Por llegada estimada y después por código: el orden en que se buscan. */
export function ordenarEmbarques(lista: readonly EmbarqueApi[]): EmbarqueApi[] {
  return [...lista].sort((a, b) => (a.fecha_llegada_estimada === b.fecha_llegada_estimada ? a.codigo.localeCompare(b.codigo) : a.fecha_llegada_estimada < b.fecha_llegada_estimada ? -1 : 1));
}

export function filtrarViajes(lista: readonly ViajeApi[], p: ParametrosAgrupadores, perfilId: string, mio: boolean): ViajeApi[] {
  const q = sinAcentos(p.q.trim());
  return lista.filter((v) => {
    if (p.estadoViaje && v.estado !== p.estadoViaje) return false;
    if (mio && !esMio(v.responsable, perfilId)) return false;
    if (q === "") return true;
    return sinAcentos([v.codigo, v.nombre, v.destino ?? "", v.responsable?.nombre ?? ""].join(" ")).includes(q);
  });
}

/** Abiertos primero, después cerrados y cancelados; dentro de cada grupo, el más reciente arriba. */
export function ordenarViajes(lista: readonly ViajeApi[]): ViajeApi[] {
  const peso: Record<EstadoViaje, number> = { abierto: 0, cerrado: 1, cancelado: 2 };
  return [...lista].sort((a, b) => (peso[a.estado] - peso[b.estado] !== 0 ? peso[a.estado] - peso[b.estado] : a.fecha_inicio < b.fecha_inicio ? 1 : a.fecha_inicio > b.fecha_inicio ? -1 : 0));
}

// ─── Códigos aamm## (§2.2) ───

/**
 * El código que propone el formulario: `aamm` de la fecha de referencia y el siguiente correlativo de los códigos ya usados de ese
 * tipo (`^aamm##$`; los escritos a mano con otro formato no cuentan). Un hueco no se rellena. `null` si falta la fecha o ya están los
 * 99 (hay que escribirlo a mano). Es una propuesta: el servidor autonumera si el campo llega vacío y decide el definitivo.
 */
export function sugerirCodigo(fechaReferencia: string, existentes: readonly string[]): string | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])/.exec(fechaReferencia);
  if (!m) return null;
  const aamm = `${m[1].slice(2)}${m[2]}`;
  let max = 0;
  for (const c of existentes) {
    const x = /^(\d{4})(\d{2})$/.exec(c.trim());
    if (x && x[1] === aamm) max = Math.max(max, Number(x[2]));
  }
  return max >= 99 ? null : `${aamm}${String(max + 1).padStart(2, "0")}`;
}

// ─── Textos ───

/** `S/ 9,000.00 · US$ 11,400.00`; `—` si no hay costo. Las monedas nunca se mezclan. */
export function textoCostoMonedas(c: CostoPorMonedaApi): string {
  const partes: string[] = [];
  if (c.PEN > 0) partes.push(dinero("PEN", c.PEN));
  if (c.USD > 0) partes.push(dinero("USD", c.USD));
  return partes.length === 0 ? "—" : partes.join(" · ");
}

/** `2026-11-20` → `20/11/2026`; `—` si no hay fecha o no es válida. */
export function textoFecha(fecha: string | null): string {
  if (fecha === null || !FECHA.test(fecha)) return "—";
  const [a, m, d] = fecha.split("-");
  return `${d}/${m}/${a}`;
}

/** `Embarque 261101`, `Viaje 261001`, `Paquete 261101`: la pantalla siempre antepone el tipo (§2.2). */
export const nombreConTipo = (tipo: "Viaje" | "Embarque" | "Paquete", codigo: string): string => `${tipo} ${codigo}`;

export type TonoAviso = "alerta" | "neutro";

/** Avisos que piden atención (rojo); el resto informa. */
const AVISOS_DE_ATENCION: readonly AvisoAgrupador[] = ["atrasado", "sin_responsable", "desalineada", "en_embarque_cancelado", "llegada_antes_de_compra"];
export const tonoAviso = (a: AvisoAgrupador): TonoAviso => (AVISOS_DE_ATENCION.includes(a) ? "alerta" : "neutro");

/** Quién es el responsable y de dónde sale: el propio, o heredado del embarque o del viaje. */
export function textoResponsable(r: ResponsableEfectivoApi | null): { nombre: string; heredado: string | null } {
  if (r === null) return { nombre: "Sin responsable", heredado: null };
  const nombre = r.nombre ?? "Sin nombre";
  if (r.origen === "propio") return { nombre, heredado: null };
  return { nombre, heredado: r.origen === "viaje" ? "Heredado del viaje" : "Heredado del embarque" };
}

/** Lo que se muestra en un selector de responsable: nombre y rol. */
export const etiquetaAsignable = (a: AsignableApi): string => `${a.nombre ?? a.email}${a.rol === "admin" ? " (administrador)" : ""}`;

/** Unidades del embarque: asignadas, recibidas (estimado en 08b-1) y pendientes. */
export function textoUnidadesEmbarque(t: Pick<EmbarqueApi["totales"], "unidades" | "recibidas" | "pendientes">): string {
  return `${unidades(t.unidades)} u · ${unidades(t.recibidas)} recibidas (est.) · ${unidades(t.pendientes)} pendientes`;
}

const unico = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

/**
 * Frase de arriba de una vista previa: qué mueve la operación, de qué meses a cuáles. «Mueve 12 líneas de 5 compras de nov-26 a dic-26».
 * Los avisos (temporada, lo recibido que no se mueve…) los lista la vista aparte.
 */
export function resumenPlan(plan: PlanMovimientoApi): string {
  const lineas = plural(plan.lineas, "línea", "líneas");
  const compras = plural(plan.compras_afectadas, "compra", "compras");
  const u = `${unidades(plan.unidades_movidas)} u`;
  const cambian = plan.movimientos.filter((m) => m.de.periodo !== m.a.periodo);
  const meses = (xs: string[]) => unico(xs).sort().map(mesCorto).join(", ");
  const deA = cambian.length > 0 ? ` de ${meses(cambian.map((m) => m.de.periodo))} a ${meses(cambian.map((m) => m.a.periodo))}` : "";
  switch (plan.operacion) {
    case "cambiar_fecha":
      return cambian.length > 0 ? `Mueve ${lineas} de ${compras}${deA} (${u}).` : "El mes no cambia: solo cambia la fecha del embarque y no se toca ninguna compra.";
    case "asignar":
      return `Asigna ${u} de ${lineas} de ${compras} al embarque${deA}.`;
    case "quitar":
      return `Quita ${u} de ${lineas} de ${compras} del embarque; quedan sin embarque en el mismo mes.`;
    case "pasar_pendientes":
      return `Pasa ${u} pendientes de ${lineas} de ${compras} a otro embarque${deA}.`;
    case "mover_paquete":
      return `Mueve el paquete a otro embarque: ${u} de ${lineas} de ${compras}${deA}.`;
    case "mover_a_paquete":
      return `Cambia de paquete ${u} de ${lineas} de ${compras}; no cambia ningún mes.`;
    default:
      return `Mueve ${u} de ${lineas} de ${compras}${deA}.`;
  }
}

/** El texto de un aviso: el detalle del servidor si lo trae, si no la etiqueta corta. */
export function textoAvisoDetalle(a: AvisoDetalleApi, etiquetas: Record<AvisoAgrupador, string>): string {
  return a.detalle && a.detalle.trim() !== "" ? a.detalle : etiquetas[a.aviso];
}

/** Validadores de formato de mes (`aaaa-mm`) y de fecha (`aaaa-mm-dd`). */
export const esMesValido = (v: string): boolean => MES.test(v);
export const esFechaValida = (v: string): boolean => FECHA.test(v);

/** ¿La salida es posterior a la llegada? (la función la rechaza con `409`; aquí se avisa antes de enviar). */
export const salidaDespuesDeLlegada = (salida: string, llegada: string): boolean => salida !== "" && llegada !== "" && salida > llegada;

// ─── Líneas de compra en las tablas de agrupadores ───

/** Texto corto de una línea: la ruta y la marca en una específica; «Lote · MARCA» en una al barrer. */
export function textoLinea(l: { tipo: string; gml: string | null; marca: string | null; agrupacion_marca: string | null }): string {
  const marca = l.marca ?? l.agrupacion_marca;
  if (l.tipo === "barrer_marca") return `Lote${marca ? ` · ${marca}` : ""}`;
  return [l.gml, marca].filter(Boolean).join(" · ") || "—";
}

/** Valida las unidades escritas para una entrega: entero positivo y no más de lo que queda sin asignar. `null` = válido. */
export function errorUnidades(texto: string, sinAsignar: number): string | null {
  const t = texto.trim();
  if (!/^\d+$/.test(t) || Number(t) <= 0) return "Escribe un número entero mayor que cero.";
  if (Number(t) > sinAsignar) return `Solo hay ${unidades(sinAsignar)} u sin asignar en esta entrega.`;
  return null;
}
