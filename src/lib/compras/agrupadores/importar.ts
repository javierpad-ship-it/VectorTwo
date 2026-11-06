import { FECHA_INVALIDA, aIso, esDiaReal, leerFecha } from "@/lib/tiendas/fechas";
import type { Mes } from "@/lib/compras/tipos";
import { aammDe, normalizarCodigo, siguienteCodigo } from "./codigos";
import { sumarDias } from "./fechas";
import { mesDeDestino, periodoLlegada } from "./movimiento";
import { mesDe } from "@/lib/compras/reglas";
import type { FilaAgrupador } from "./esquemas";
import { esAsignable, responsableEfectivo } from "./responsable";
import type { AgrupadorImportacionCompraApi, FilaImportacionAgrupadorApi, ReporteImportacionAgrupadoresApi, ResumenClasificacionApi } from "./tipos-api";
import {
  MAX_DESTINO_VIAJE,
  MAX_NOMBRE_AGRUPADOR,
  MAX_NOTA_EMBARQUE,
  MAX_NOTA_PAQUETE,
  MAX_NOTA_VIAJE,
  MAX_ORIGEN_EMBARQUE,
  MAX_PUERTO_EMBARQUE,
  MAX_REFERENCIA_LOGISTICA,
  PATRON_CODIGO_AGRUPADOR,
  TIPOS_AGRUPADOR,
  TIPOS_EMBARQUE,
  VALORES_TIPO_EMBARQUE_IMPORTADOR,
  VALORES_TIPO_IMPORTADOR,
  type ActorAgrupador,
  type AvisoImportacionAgrupador,
  type AvisoImportacionCompraAgrupador,
  type EmbarqueRegistro,
  type MotivoOmisionAgrupador,
  type MotivoOmisionCompraAgrupador,
  type PaqueteRegistro,
  type PerfilRegistro,
  type TipoAgrupador,
  type TipoEmbarque,
  type ViajeRegistro,
} from "./tipos";

/**
 * Importadores de agrupadores (ficha 08b, §3.9 y §3.11; R21 y R25). PURO: lee celdas de texto, valida, clasifica contra lo que ya existe
 * y arma el lote que aplica `importar_agrupadores` (una transacción). Nunca lee ni escribe la base: el servicio (T3b) le pasa el estado.
 *
 * A · Importador de AGRUPADORES (`previsualizarImportacionAgrupadores`; §3.11):
 *  - Una sola hoja con una columna `TIPO` (`VIAJE`, `EMBARQUE`, `PAQUETE`). SOLO CREA: nunca edita, mueve ni asigna compras.
 *  - Se procesan viajes, después embarques y después paquetes, sin importar el orden de las filas. Un embarque puede apuntar a un viaje
 *    y un paquete a un embarque del mismo archivo, pero solo POR CÓDIGO: la fila referida debe traer `CODIGO` (si no,
 *    `referencia_sin_codigo`); si apunta a una fila que se omitió, `referencia_omitida`. Un código que existe en la base manda sobre el archivo.
 *  - Clave: con `CODIGO`, (tipo, código). Sin él, la natural: viaje (NOMBRE en mayúsculas, FECHA_INICIO); embarque (NOMBRE en mayúsculas,
 *    FECHA_INGRESO_CD, o su sinónimo FECHA_LLEGADA); paquete (EMBARQUE, NOMBRE en mayúsculas). Contra la base cada fila es `nueva`, `igual` (mismo contenido normalizado: no
 *    hace nada) o `cambiada` (otro contenido: no se aplica, `cambiada_requiere_edicion` con la diferencia). Reimportar no duplica nada.
 *  - Los códigos sin escribir se numeran al aplicar: primero quedan reservados los escritos (ocupan su correlativo) y después se
 *    autonumera en orden de fila (el máximo más uno por mes, `correlativo_agotado` con 99). En `previsualizar` quedan nulos («se numera
 *    al aplicar»); `codigos_simulados` es su espejo para pruebas y para el humo de `importar_agrupadores`.
 *
 * B · Columnas `VIAJE`, `EMBARQUE` y `PAQUETE` del importador de COMPRAS (`evaluarAgrupadoresDeFilaCompra`; §3.9):
 *  - Se clasifica primero la fila como en M8 (con la huella de lo que dice el archivo: las columnas de agrupador NO entran en ella).
 *  - Las reglas solo se aplican a `nueva` y a `igual` sin asignación; a una `igual` ya asignada a otro embarque, `agrupador_distinto` (aviso:
 *    no se toca; los cambios se hacen en pantalla); una `cambiada` sigue su regla de M8.
 *  - Con `EMBARQUE`, la llegada debe caer en el mes del embarque y la fila no puede traer más de una entrega.
 */

// ─── Lectores de celdas ───

const texto = (v: string | undefined | null): string => (v ?? "").trim();
const mayusculas = (v: string): string => v.trim().toUpperCase().replace(/\s+/g, " ");
const sinAcentos = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "");
const palabra = (v: string): string => sinAcentos(v).trim().toUpperCase().replace(/\s+/g, "_");

const ORIGEN_EXCEL_MS = Date.UTC(1899, 11, 30);
const MS_POR_DIA = 86_400_000;

/** `aaaa-mm-dd` (o número de serie de Excel, origen 1899-12-30); `null` si vacío; `"invalida"` si no es un día real entre 2000 y 2100. */
export function leerFechaAgrupador(valor: string): string | null | "invalida" {
  const t = valor.trim();
  if (t === "") return null;
  if (/^\d{5}(?:\.0+)?$/.test(t)) {
    const d = new Date(ORIGEN_EXCEL_MS + Math.floor(Number(t)) * MS_POR_DIA);
    const anio = d.getUTCFullYear();
    if (anio < 2000 || anio > 2100) return "invalida";
    return aIso(anio, d.getUTCMonth() + 1, d.getUTCDate());
  }
  const f = leerFecha(t);
  if (f === FECHA_INVALIDA) return "invalida";
  if (f === null) return null;
  const [a, m, d] = f.split("-").map(Number);
  return a >= 2000 && a <= 2100 && esDiaReal(a, m, d) ? f : "invalida";
}

/**
 * `INICIO_OPERATIVO` (08b-1b §3.6): `aaaa-mm-dd` (solo fecha), `aaaa-mm-dd hh:mm`, `dd/mm/aaaa hh:mm` o una celda de fecha y hora de Excel
 * (número de serie con fracción; el lector del navegador ya suele pasarla a texto). Devuelve `{ fecha, hora }` (la hora `hh:mm` o `null` si
 * solo vino la fecha), `null` si está vacío, `"invalida"` si la fecha no es válida y `"hora_invalida"` si la hora está fuera de rango.
 */
export function leerInicioOperativo(valor: string): { fecha: string; hora: string | null } | null | "invalida" | "hora_invalida" {
  const t = valor.trim();
  if (t === "") return null;
  const serie = /^(\d{5})(\.\d+)?$/.exec(t);
  if (serie) {
    const fecha = leerFechaAgrupador(serie[1]);
    if (fecha === "invalida" || fecha === null) return "invalida";
    if (serie[2] === undefined) return { fecha, hora: null };
    const minutos = Math.round(Number(serie[2]) * 1440);
    if (minutos >= 1440) return { fecha: sumarDias(fecha, 1), hora: "00:00" };
    return { fecha, hora: `${String(Math.floor(minutos / 60)).padStart(2, "0")}:${String(minutos % 60).padStart(2, "0")}` };
  }
  const partes = /^(\S+?)(?:[ T]+(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(t);
  if (!partes) return "invalida";
  const fecha = leerFechaAgrupador(partes[1]);
  if (fecha === "invalida" || fecha === null) return "invalida";
  if (partes[2] === undefined) return { fecha, hora: null };
  const h = Number(partes[2]);
  const m = Number(partes[3]);
  if (h > 23 || m > 59) return "hora_invalida";
  return { fecha, hora: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` };
}

// ─── Estado y resultados ───

export type PerfilConCorreo = PerfilRegistro & { email: string };

/** Lo que el importador necesita saber del mundo: lo que ya existe (todos los estados, también cancelados) y los perfiles con su correo. */
export type EstadoImportacionAgrupadores = {
  viajes: readonly ViajeRegistro[];
  embarques: readonly EmbarqueRegistro[];
  paquetes: readonly PaqueteRegistro[];
  perfiles: readonly PerfilConCorreo[];
};

export type LoteViaje = {
  fila: number;
  /** Nulo = se numera al aplicar (`aamm` de `fecha_inicio`). */
  codigo: string | null;
  nombre: string;
  destino: string | null;
  fecha_inicio: string;
  fecha_fin: string | null;
  responsable_id: string;
  nota: string | null;
};

export type LoteEmbarque = {
  fila: number;
  /** Nulo = se numera al aplicar (`aamm` del Ingreso CD, `fecha_llegada_estimada`). */
  codigo: string | null;
  nombre: string;
  tipo: TipoEmbarque;
  /** Un viaje que ya existe. */
  viaje_id: string | null;
  /** O el código de un viaje de este mismo lote (un `LoteViaje` con ese `codigo`). Uno de los dos o ninguno; nunca ambos. */
  viaje_codigo: string | null;
  responsable_id: string | null;
  referencia_logistica: string | null;
  puerto_embarque: string | null;
  /** Zarpe. */
  fecha_salida_estimada: string | null;
  /** Arribo; nulo en un `LOCAL` (se ignora con aviso). */
  fecha_puerto_estimada: string | null;
  /** Ingreso CD (obligatoria). */
  fecha_llegada_estimada: string;
  fecha_inicio_operativo_estimada: string | null;
  hora_inicio_operativo: string | null;
  /** Ingreso al stock fijado; nulo = el día del Ingreso CD. */
  fecha_ingreso_estimada: string | null;
  origen: string | null;
  nota: string | null;
};

export type LotePaquete = {
  fila: number;
  /** Nulo = se numera al aplicar (`aamm` del Ingreso CD de su embarque; 08b-1b §2.4). */
  codigo: string | null;
  nombre: string;
  /** Un embarque que ya existe. */
  embarque_id: string | null;
  /** O el código de un embarque de este mismo lote. Uno de los dos; nunca ambos. */
  embarque_codigo: string | null;
  responsable_id: string | null;
  nota: string | null;
};

/**
 * `p_lote` de `importar_agrupadores(p_lote, p_actor)`: solo las filas `nueva`. La función crea viajes, después embarques y después
 * paquetes; resuelve `viaje_codigo` y `embarque_codigo` entre lo que acaba de crear; reserva primero los códigos escritos y autonumera
 * los nulos en orden de fila; vuelve a comprobar cada clave y cada referencia (`clave_existente`, `viaje_cancelado`,
 * `embarque_no_editable`, `responsable_no_asignable`, `correlativo_agotado`, `codigo_duplicado`); deja un evento `crear` por agrupador
 * con motivo «Importado de <archivo>» y devuelve `{ ok: true, creados: [{ tipo, fila, id, codigo }] }`.
 */
export type LoteImportarAgrupadores = { archivo_nombre: string; viajes: LoteViaje[]; embarques: LoteEmbarque[]; paquetes: LotePaquete[] };

export type ResultadoPrevisualizacionAgrupadores = {
  reporte: ReporteImportacionAgrupadoresApi;
  lote: LoteImportarAgrupadores;
  /** Fila → código que recibirá cada nueva sin código, simulando la numeración de la función. Solo para pruebas y humo; no se envía al cliente. */
  codigos_simulados: ReadonlyMap<number, string>;
};

// ─── Lectura y validación de una fila ───

type DatosFila = {
  fila: number;
  tipo: TipoAgrupador;
  codigo: string | null;
  nombre: string;
  destino: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  viaje_ref: string | null;
  tipo_embarque: TipoEmbarque;
  /** Zarpe (`FECHA_ZARPE` o su sinónimo `FECHA_SALIDA`). */
  fecha_salida: string | null;
  fecha_arribo: string | null;
  /** Ingreso CD (`FECHA_INGRESO_CD` o su sinónimo `FECHA_LLEGADA`). */
  fecha_llegada: string | null;
  inicio_fecha: string | null;
  inicio_hora: string | null;
  fecha_ingreso_stock: string | null;
  origen: string | null;
  puerto: string | null;
  referencia_logistica: string | null;
  embarque_ref: string | null;
  responsable: PerfilConCorreo | null;
  nota: string | null;
  /** Avisos de la lectura de la fila (`arribo_ignorado_en_local`). */
  avisos: AvisoImportacionAgrupador[];
};

type Omision = { motivo: MotivoOmisionAgrupador; detalle?: string };
type Lectura = { ok: true; datos: DatosFila } | { ok: false; tipo: TipoAgrupador | null; omision: Omision };

const falla = (tipo: TipoAgrupador | null, motivo: MotivoOmisionAgrupador, detalle?: string): Lectura => ({ ok: false, tipo, omision: detalle === undefined ? { motivo } : { motivo, detalle } });

function leerTipoAgrupador(valor: string): TipoAgrupador | null {
  const p = palabra(valor);
  return TIPOS_AGRUPADOR.find((t) => VALORES_TIPO_IMPORTADOR[t] === p) ?? null;
}

function leerTipoEmbarque(valor: string): TipoEmbarque | null {
  const p = palabra(valor);
  if (p === "") return "importacion";
  return TIPOS_EMBARQUE.find((t) => VALORES_TIPO_EMBARQUE_IMPORTADOR[t] === p) ?? null;
}

function leerFilaAgrupador(f: FilaAgrupador, perfiles: readonly PerfilConCorreo[]): Lectura {
  const todoVacio = [f.tipo, f.codigo, f.nombre, f.viaje, f.embarque, f.tipo_embarque, f.destino, f.fecha_inicio, f.fecha_fin, f.fecha_salida, f.fecha_llegada, f.fecha_zarpe, f.fecha_arribo, f.fecha_ingreso_cd, f.inicio_operativo, f.fecha_ingreso_stock, f.origen, f.puerto, f.referencia_logistica, f.responsable, f.nota].every((v) => texto(v) === "");
  if (todoVacio) return falla(null, "tipo_invalido", "La fila está vacía.");
  const tipo = leerTipoAgrupador(f.tipo);
  if (tipo === null) return falla(null, "tipo_invalido", `«${texto(f.tipo)}» no es un tipo válido (VIAJE, EMBARQUE o PAQUETE).`);

  const nombre = texto(f.nombre).replace(/\s+/g, " ");
  if (nombre === "") return falla(tipo, "nombre_requerido", "Escribe el nombre.");
  if (nombre.length > MAX_NOMBRE_AGRUPADOR) return falla(tipo, "nombre_largo", `El nombre no puede superar ${MAX_NOMBRE_AGRUPADOR} caracteres.`);

  const codigoCrudo = normalizarCodigo(texto(f.codigo));
  if (codigoCrudo !== "" && !PATRON_CODIGO_AGRUPADOR.test(codigoCrudo)) return falla(tipo, "codigo_invalido", `«${texto(f.codigo)}» no es un código válido (letras, números y guiones; hasta 30).`);
  const codigo = codigoCrudo === "" ? null : codigoCrudo;

  const notaMax = tipo === "viaje" ? MAX_NOTA_VIAJE : tipo === "embarque" ? MAX_NOTA_EMBARQUE : MAX_NOTA_PAQUETE;
  const largos: [string, string, number][] = [["La nota", texto(f.nota), notaMax]];
  if (tipo === "viaje") largos.push(["El destino", texto(f.destino), MAX_DESTINO_VIAJE]);
  if (tipo === "embarque") largos.push(["El puerto", texto(f.puerto), MAX_PUERTO_EMBARQUE], ["La referencia logística", texto(f.referencia_logistica), MAX_REFERENCIA_LOGISTICA], ["El origen", texto(f.origen), MAX_ORIGEN_EMBARQUE]);
  for (const [campo, valor, max] of largos) if (valor.length > max) return falla(tipo, "campo_largo", `${campo} no puede superar ${max} caracteres.`);

  const vacioANulo = (v: string | undefined) => (texto(v) === "" ? null : texto(v));
  const base = {
    fila: 0,
    tipo,
    codigo,
    nombre,
    destino: null,
    fecha_inicio: null,
    fecha_fin: null,
    viaje_ref: null,
    tipo_embarque: "importacion" as TipoEmbarque,
    fecha_salida: null,
    fecha_arribo: null,
    fecha_llegada: null,
    inicio_fecha: null,
    inicio_hora: null,
    fecha_ingreso_stock: null,
    origen: null,
    puerto: null,
    referencia_logistica: null,
    embarque_ref: null,
    responsable: null,
    nota: vacioANulo(f.nota),
    avisos: [],
  } satisfies Omit<DatosFila, "fila"> & { fila: number };
  const datos: DatosFila = { ...base };

  // Fechas y campos propios de cada tipo.
  if (tipo === "viaje") {
    const inicio = leerFechaAgrupador(texto(f.fecha_inicio));
    if (inicio === null) return falla(tipo, "fecha_requerida", "Indica FECHA_INICIO (aaaa-mm-dd).");
    if (inicio === "invalida") return falla(tipo, "fecha_invalida", `«${texto(f.fecha_inicio)}» no es una fecha válida (aaaa-mm-dd).`);
    const fin = leerFechaAgrupador(texto(f.fecha_fin));
    if (fin === "invalida") return falla(tipo, "fecha_invalida", `«${texto(f.fecha_fin)}» no es una fecha válida (aaaa-mm-dd).`);
    if (fin !== null && fin < inicio) return falla(tipo, "fin_antes_de_inicio", "La fecha de fin no puede ser anterior a la de inicio.");
    datos.fecha_inicio = inicio;
    datos.fecha_fin = fin;
    datos.destino = vacioANulo(f.destino);
  } else if (tipo === "embarque") {
    const tipoEmb = leerTipoEmbarque(texto(f.tipo_embarque));
    if (tipoEmb === null) return falla(tipo, "tipo_invalido", `«${texto(f.tipo_embarque)}» no es un tipo de embarque válido (IMPORTACION o LOCAL).`);
    // Cada hito y su sinónimo viejo (`FECHA_SALIDA` = Zarpe, `FECHA_LLEGADA` = Ingreso CD): si traen valores distintos, la fila se omite.
    const parSinonimo = (nuevo: string | undefined, viejo: string | undefined, nombreNuevo: string, nombreViejo: string): { ok: true; valor: string | null } | { ok: false; falla: Lectura } => {
      const a = leerFechaAgrupador(texto(nuevo));
      const b = leerFechaAgrupador(texto(viejo));
      if (a === "invalida") return { ok: false, falla: falla(tipo, "fecha_invalida", `«${texto(nuevo)}» no es una fecha válida (aaaa-mm-dd) en ${nombreNuevo}.`) };
      if (b === "invalida") return { ok: false, falla: falla(tipo, "fecha_invalida", `«${texto(viejo)}» no es una fecha válida (aaaa-mm-dd) en ${nombreViejo}.`) };
      if (a !== null && b !== null && a !== b) return { ok: false, falla: falla(tipo, "fechas_en_conflicto", `${nombreNuevo} (${a}) y ${nombreViejo} (${b}) traen fechas distintas: deja solo una.`) };
      return { ok: true, valor: a ?? b };
    };
    const ingresoCd = parSinonimo(f.fecha_ingreso_cd, f.fecha_llegada, "FECHA_INGRESO_CD", "FECHA_LLEGADA");
    if (!ingresoCd.ok) return ingresoCd.falla;
    const llegada = ingresoCd.valor;
    if (llegada === null) return falla(tipo, "fecha_requerida", "Indica FECHA_INGRESO_CD (aaaa-mm-dd; el nombre viejo FECHA_LLEGADA también vale).");
    const zarpe = parSinonimo(f.fecha_zarpe, f.fecha_salida, "FECHA_ZARPE", "FECHA_SALIDA");
    if (!zarpe.ok) return zarpe.falla;
    const salida = zarpe.valor;
    if (salida !== null && salida > llegada) return falla(tipo, "salida_despues_de_llegada", "El zarpe no puede ser posterior al ingreso al CD.");
    const arribo = leerFechaAgrupador(texto(f.fecha_arribo));
    if (arribo === "invalida") return falla(tipo, "fecha_invalida", `«${texto(f.fecha_arribo)}» no es una fecha válida (aaaa-mm-dd) en FECHA_ARRIBO.`);
    const inicio = leerInicioOperativo(texto(f.inicio_operativo));
    if (inicio === "invalida") return falla(tipo, "fecha_invalida", `«${texto(f.inicio_operativo)}» no es una fecha válida en INICIO_OPERATIVO (aaaa-mm-dd o aaaa-mm-dd hh:mm).`);
    if (inicio === "hora_invalida") return falla(tipo, "hora_invalida", `La hora de «${texto(f.inicio_operativo)}» no es válida: usa hh:mm de 00:00 a 23:59.`);
    const ingresoStock = leerFechaAgrupador(texto(f.fecha_ingreso_stock));
    if (ingresoStock === "invalida") return falla(tipo, "fecha_invalida", `«${texto(f.fecha_ingreso_stock)}» no es una fecha válida (aaaa-mm-dd) en FECHA_INGRESO_STOCK.`);
    if (tipoEmb === "local" && texto(f.viaje) !== "") return falla(tipo, "local_con_viaje", "Un embarque local no lleva viaje.");
    // Un `LOCAL` no pasa por puerto: el arribo se ignora con aviso (la base lo rechazaría con `puerto_en_local`).
    if (tipoEmb === "local" && arribo !== null) datos.avisos.push("arribo_ignorado_en_local");
    datos.tipo_embarque = tipoEmb;
    datos.fecha_llegada = llegada;
    datos.fecha_salida = salida;
    datos.fecha_arribo = tipoEmb === "local" ? null : arribo;
    datos.inicio_fecha = inicio === null ? null : inicio.fecha;
    datos.inicio_hora = inicio === null ? null : inicio.hora;
    datos.fecha_ingreso_stock = ingresoStock;
    datos.origen = vacioANulo(f.origen);
    datos.viaje_ref = texto(f.viaje) === "" ? null : mayusculas(f.viaje ?? "");
    datos.puerto = vacioANulo(f.puerto);
    datos.referencia_logistica = vacioANulo(f.referencia_logistica);
  } else {
    if (texto(f.embarque) === "") return falla(tipo, "embarque_requerido", "Indica el código del embarque (columna EMBARQUE).");
    datos.embarque_ref = mayusculas(f.embarque ?? "");
  }

  // Responsable: obligatorio en el viaje; opcional en los otros (vacío = hereda).
  const correo = texto(f.responsable).toLowerCase();
  if (correo === "") {
    if (tipo === "viaje") return falla(tipo, "responsable_requerido", "Indica el correo del responsable (comprador o administrador).");
  } else {
    const perfil = perfiles.find((p) => p.email.trim().toLowerCase() === correo);
    if (!perfil) return falla(tipo, "responsable_desconocido", `No hay un usuario con el correo «${texto(f.responsable)}».`);
    if (!esAsignable(perfil)) return falla(tipo, "responsable_no_asignable", `El usuario «${texto(f.responsable)}» no puede ser responsable: elige un comprador o un administrador activos.`);
    datos.responsable = perfil;
  }
  return { ok: true, datos };
}

// ─── Claves ───

/** Clave natural (§3.11) de una fila ya leída; `embarque_codigo` es el código de la fila de embarque a la que apunta un paquete. */
const claveNatural = (d: DatosFila): string =>
  d.tipo === "viaje" ? `viaje|${mayusculas(d.nombre)}|${d.fecha_inicio}` : d.tipo === "embarque" ? `embarque|${mayusculas(d.nombre)}|${d.fecha_llegada}` : `paquete|${d.embarque_ref}|${mayusculas(d.nombre)}`;
const claveCodigo = (tipo: TipoAgrupador, codigo: string) => `${tipo}|${codigo}`;
const claveDeFila = (d: DatosFila): string => (d.codigo !== null ? claveCodigo(d.tipo, d.codigo) : claveNatural(d));

// ─── Previsualizar ───

type EstadoFila = {
  fila: number;
  tipo: TipoAgrupador | null;
  clave: string;
  datos?: DatosFila;
  /** Código y nombre tal como se escribieron (normalizados), también en una fila que no pasó la lectura: sirven para resolver referencias. */
  codigo_texto: string | null;
  nombre_texto: string;
  clasificacion: FilaImportacionAgrupadorApi["clasificacion"];
  motivo?: MotivoOmisionAgrupador;
  detalle?: string;
  avisos: AvisoImportacionAgrupador[];
  /** Registro existente al que corresponde (en `igual` y `cambiada`). */
  existente?: { id: string; codigo: string };
  codigo_final: string | null;
  /** Referencias ya resueltas de una fila `nueva`. */
  viaje_id?: string | null;
  viaje_codigo?: string | null;
  embarque_id?: string | null;
  embarque_codigo?: string | null;
};

const sinReferenciaEnBase = null;

/**
 * Previsualiza el importador de agrupadores (R25). `filas` son las del cuerpo (texto). Devuelve el reporte (`modo = "previsualizar"`), el
 * lote para `importar_agrupadores` y los códigos simulados. No depende del orden de las filas.
 */
export function previsualizarImportacionAgrupadores(
  filas: readonly FilaAgrupador[],
  estado: EstadoImportacionAgrupadores,
  opciones: { archivo_nombre?: string } = {},
): ResultadoPrevisualizacionAgrupadores {
  const estados = new Map<number, EstadoFila>();
  const orden: number[] = [];

  // Existentes por código y por clave natural.
  const viajePorCodigo = new Map(estado.viajes.map((v) => [normalizarCodigo(v.codigo), v]));
  const embarquePorCodigo = new Map(estado.embarques.map((e) => [normalizarCodigo(e.codigo), e]));
  const embarquePorId = new Map(estado.embarques.map((e) => [e.id, e]));
  const viajePorId = new Map(estado.viajes.map((v) => [v.id, v]));
  const paquetePorCodigo = new Map(estado.paquetes.map((p) => [normalizarCodigo(p.codigo), p]));
  const perfilPorId = new Map(estado.perfiles.map((p) => [p.id, p]));
  const naturalExistente = new Map<string, { tipo: TipoAgrupador; id: string }>();
  for (const v of estado.viajes) naturalExistente.set(`viaje|${mayusculas(v.nombre)}|${v.fecha_inicio}`, { tipo: "viaje", id: v.id });
  for (const e of estado.embarques) naturalExistente.set(`embarque|${mayusculas(e.nombre)}|${e.fecha_llegada_estimada}`, { tipo: "embarque", id: e.id });
  for (const p of estado.paquetes) {
    const e = embarquePorId.get(p.embarque_id);
    if (e) naturalExistente.set(`paquete|${normalizarCodigo(e.codigo)}|${mayusculas(p.nombre)}`, { tipo: "paquete", id: p.id });
  }

  // Pasada 0: leer cada fila.
  for (const f of filas) {
    orden.push(f.fila);
    const lectura = leerFilaAgrupador(f, estado.perfiles);
    if (!lectura.ok) {
      const crudo = normalizarCodigo(texto(f.codigo));
      estados.set(f.fila, { fila: f.fila, tipo: lectura.tipo, clave: "", codigo_texto: crudo === "" ? null : crudo, nombre_texto: mayusculas(f.nombre ?? ""), clasificacion: "omitida", motivo: lectura.omision.motivo, ...(lectura.omision.detalle === undefined ? {} : { detalle: lectura.omision.detalle }), avisos: [], codigo_final: null });
      continue;
    }
    const datos = { ...lectura.datos, fila: f.fila };
    estados.set(f.fila, { fila: f.fila, tipo: datos.tipo, clave: claveDeFila(datos), datos, codigo_texto: datos.codigo, nombre_texto: mayusculas(datos.nombre), clasificacion: "nueva", avisos: [...datos.avisos], codigo_final: datos.codigo });
  }

  const omitir = (e: EstadoFila, motivo: MotivoOmisionAgrupador, detalle?: string) => {
    e.clasificacion = "omitida";
    e.motivo = motivo;
    if (detalle !== undefined) e.detalle = detalle;
    delete e.existente;
  };

  // Pasada 0b: la misma clave dos veces → manda la primera fila válida.
  const vistas = new Map<string, number>();
  for (const n of orden) {
    const e = estados.get(n) as EstadoFila;
    if (!e.datos) continue;
    const previa = vistas.get(e.clave);
    if (previa !== undefined) {
      omitir(e, e.datos.codigo !== null ? "codigo_repetido_en_archivo" : "fila_repetida", `La clave ya está en la fila ${previa}.`);
      continue;
    }
    vistas.set(e.clave, n);
  }

  // Filas del archivo por (tipo, código) y por nombre (las sin código, para `referencia_sin_codigo`).
  const todasDelTipo = (tipo: TipoAgrupador) => orden.map((n) => estados.get(n) as EstadoFila).filter((e) => e.tipo === tipo);
  const delArchivo = (tipo: TipoAgrupador) => todasDelTipo(tipo).filter((e) => e.datos);
  const porCodigoArchivo = (tipo: TipoAgrupador, codigo: string) => todasDelTipo(tipo).find((e) => e.codigo_texto === codigo);
  const sinCodigoPorNombre = (tipo: TipoAgrupador, nombre: string) => todasDelTipo(tipo).find((e) => e.codigo_texto === null && e.nombre_texto === nombre);

  type Referencia =
    | { ok: true; existente: ViajeRegistro | EmbarqueRegistro | null; delArchivo: EstadoFila | null }
    | { ok: false; omision: Omision };

  const resolver = (tipo: "viaje" | "embarque", ref: string): Referencia => {
    const enBase = tipo === "viaje" ? viajePorCodigo.get(ref) : embarquePorCodigo.get(ref);
    if (enBase) return { ok: true, existente: enBase, delArchivo: null };
    const fila = porCodigoArchivo(tipo, ref);
    if (fila) {
      if (fila.clasificacion === "omitida") return { ok: false, omision: { motivo: "referencia_omitida", detalle: `La fila ${fila.fila} (${tipo} ${ref}) se omitió.` } };
      return { ok: true, existente: null, delArchivo: fila };
    }
    if (sinCodigoPorNombre(tipo, ref)) return { ok: false, omision: { motivo: "referencia_sin_codigo", detalle: `La fila de ${tipo} «${ref}» no trae código: solo se puede referir por código.` } };
    return { ok: false, omision: { motivo: tipo === "viaje" ? "viaje_desconocido" : "embarque_desconocido", detalle: `No existe el ${tipo} «${ref}».` } };
  };

  const textoCmp = (v: string | null) => v ?? "—";
  // El nombre se compara sin distinguir mayúsculas ni espacios de más (es la clave natural); el resto, tal cual.
  const igualNombre = (a: string | null, b: string | null) => (a === null || b === null ? a === b : mayusculas(a) === mayusculas(b));
  const diferencias = (pares: [string, string | null, string | null][]): string[] =>
    pares.filter(([campo, a, b]) => (campo === "nombre" ? !igualNombre(a, b) : (a ?? null) !== (b ?? null))).map(([campo, a, b]) => `${campo} ${textoCmp(a)} → ${textoCmp(b)}`);
  const correoDe = (id: string | null) => (id === null ? null : (perfilPorId.get(id)?.email ?? id));
  /** «2026-11-05 09:22» o solo «2026-11-05»; con `conHora` falso se compara solo el día (el archivo no dijo hora). */
  const textoInicio = (fecha: string | null, hora: string | null, conHora: boolean): string | null => (fecha === null ? null : conHora && hora ? `${fecha} ${hora.slice(0, 5)}` : fecha);

  // Pasada 1: viajes.
  for (const e of delArchivo("viaje")) {
    if (e.clasificacion === "omitida") continue;
    const d = e.datos as DatosFila;
    const existente = d.codigo !== null ? viajePorCodigo.get(d.codigo) : (() => {
      const n = naturalExistente.get(claveNatural(d));
      return n?.tipo === "viaje" ? estado.viajes.find((v) => v.id === n.id) : undefined;
    })();
    if (!existente) continue; // nueva
    const dif = diferencias([
      ["nombre", existente.nombre, d.nombre],
      ["destino", existente.destino, d.destino],
      ["fecha_inicio", existente.fecha_inicio, d.fecha_inicio],
      ["fecha_fin", existente.fecha_fin, d.fecha_fin],
      ["responsable", correoDe(existente.responsable_id), d.responsable?.email ?? null],
      ["nota", existente.nota, d.nota],
    ]);
    e.existente = { id: existente.id, codigo: existente.codigo };
    e.codigo_final = existente.codigo;
    if (dif.length === 0) e.clasificacion = "igual";
    else {
      e.clasificacion = "cambiada";
      e.motivo = "cambiada_requiere_edicion";
      e.detalle = dif.join("; ");
    }
  }

  // Pasada 2: embarques.
  for (const e of delArchivo("embarque")) {
    if (e.clasificacion === "omitida") continue;
    const d = e.datos as DatosFila;
    let viajeExistente: ViajeRegistro | null = null;
    let viajeArchivo: EstadoFila | null = null;
    if (d.viaje_ref !== null) {
      const r = resolver("viaje", d.viaje_ref);
      if (!r.ok) {
        omitir(e, r.omision.motivo, r.omision.detalle);
        continue;
      }
      viajeExistente = r.existente as ViajeRegistro | null;
      viajeArchivo = r.delArchivo;
      if (viajeExistente?.estado === "cancelado") {
        omitir(e, "viaje_cancelado", `El viaje ${viajeExistente.codigo} está cancelado.`);
        continue;
      }
    }
    const existente = d.codigo !== null ? embarquePorCodigo.get(d.codigo) : (() => {
      const n = naturalExistente.get(claveNatural(d));
      return n?.tipo === "embarque" ? estado.embarques.find((x) => x.id === n.id) : undefined;
    })();
    if (existente) {
      const viajeDeExistente = existente.viaje_id ? (viajePorId.get(existente.viaje_id)?.codigo ?? null) : null;
      const viajeDelArchivo = viajeExistente?.codigo ?? viajeArchivo?.datos?.codigo ?? null;
      const dif = diferencias([
        ["nombre", existente.nombre, d.nombre],
        ["tipo", existente.tipo, d.tipo_embarque],
        ["viaje", viajeDeExistente, viajeDelArchivo],
        ["fecha_salida", existente.fecha_salida_estimada, d.fecha_salida],
        ["fecha_llegada", existente.fecha_llegada_estimada, d.fecha_llegada],
        ["puerto", existente.puerto_embarque, d.puerto],
        ["referencia_logistica", existente.referencia_logistica, d.referencia_logistica],
        ["responsable", correoDe(existente.responsable_id), d.responsable?.email ?? null],
        ["nota", existente.nota, d.nota],
        // 08b-1b (§3.6): las columnas nuevas solo se comparan si el archivo las dice; una ausente «no dice nada» (así reimportar un archivo
        // viejo sobre un embarque al que después se le cargaron arribo, inicio operativo, ingreso al stock u origen sigue dando `igual`).
        ...(d.fecha_arribo === null ? [] : ([["fecha_arribo", existente.fecha_puerto_estimada, d.fecha_arribo]] as [string, string | null, string | null][])),
        ...(d.inicio_fecha === null ? [] : ([["inicio_operativo", textoInicio(existente.fecha_inicio_operativo_estimada, existente.hora_inicio_operativo, d.inicio_hora !== null), textoInicio(d.inicio_fecha, d.inicio_hora, d.inicio_hora !== null)]] as [string, string | null, string | null][])),
        ...(d.fecha_ingreso_stock === null ? [] : ([["fecha_ingreso_stock", existente.fecha_ingreso_estimada, d.fecha_ingreso_stock]] as [string, string | null, string | null][])),
        ...(d.origen === null ? [] : ([["origen", existente.origen, d.origen]] as [string, string | null, string | null][])),
      ]);
      e.existente = { id: existente.id, codigo: existente.codigo };
      e.codigo_final = existente.codigo;
      if (dif.length === 0) e.clasificacion = "igual";
      else {
        e.clasificacion = "cambiada";
        e.motivo = "cambiada_requiere_edicion";
        e.detalle = dif.join("; ");
      }
      continue;
    }
    // Nueva.
    e.viaje_id = viajeExistente?.id ?? sinReferenciaEnBase;
    e.viaje_codigo = viajeArchivo?.datos?.codigo ?? null;
    if (viajeExistente?.estado === "cerrado") e.avisos.push("viaje_cerrado");
    const viajeResp = viajeExistente ? viajeExistente.responsable_id : (viajeArchivo?.datos?.responsable?.id ?? null);
    if (responsableEfectivo({ propio: d.responsable?.id ?? null, viaje: viajeResp }, estado.perfiles).faltante) e.avisos.push("sin_responsable");
  }

  // Pasada 3: paquetes.
  for (const e of delArchivo("paquete")) {
    if (e.clasificacion === "omitida") continue;
    const d = e.datos as DatosFila;
    const r = resolver("embarque", d.embarque_ref as string);
    if (!r.ok) {
      omitir(e, r.omision.motivo, r.omision.detalle);
      continue;
    }
    const embarqueBase = r.existente as EmbarqueRegistro | null;
    const embarqueArchivo = r.delArchivo;
    if (embarqueBase && (embarqueBase.estado === "cancelado" || embarqueBase.estado === "recibido")) {
      omitir(e, "embarque_no_editable", `El embarque ${embarqueBase.codigo} está ${embarqueBase.estado === "cancelado" ? "cancelado" : "recibido"}.`);
      continue;
    }
    const existente = d.codigo !== null ? paquetePorCodigo.get(d.codigo) : (() => {
      const n = naturalExistente.get(claveNatural(d));
      return n?.tipo === "paquete" ? estado.paquetes.find((x) => x.id === n.id) : undefined;
    })();
    if (existente) {
      const embarqueDeExistente = embarquePorId.get(existente.embarque_id)?.codigo ?? null;
      const dif = diferencias([
        ["nombre", existente.nombre, d.nombre],
        ["embarque", embarqueDeExistente, embarqueBase?.codigo ?? embarqueArchivo?.datos?.codigo ?? null],
        ["responsable", correoDe(existente.responsable_id), d.responsable?.email ?? null],
        ["nota", existente.nota, d.nota],
      ]);
      e.existente = { id: existente.id, codigo: existente.codigo };
      e.codigo_final = existente.codigo;
      if (dif.length === 0) e.clasificacion = "igual";
      else {
        e.clasificacion = "cambiada";
        e.motivo = "cambiada_requiere_edicion";
        e.detalle = dif.join("; ");
      }
      continue;
    }
    e.embarque_id = embarqueBase?.id ?? null;
    e.embarque_codigo = embarqueArchivo?.datos?.codigo ?? null;
    // Responsable heredable: el del embarque (propio) y, si no, el del viaje del embarque.
    let propioEmbarque: string | null;
    let viajeResp: string | null;
    if (embarqueBase) {
      propioEmbarque = embarqueBase.responsable_id;
      viajeResp = embarqueBase.viaje_id ? (viajePorId.get(embarqueBase.viaje_id)?.responsable_id ?? null) : null;
    } else {
      const de = embarqueArchivo?.datos;
      propioEmbarque = de?.responsable?.id ?? null;
      const rv = de?.viaje_ref ? (viajePorCodigo.get(de.viaje_ref) ?? null) : null;
      const rvArchivo = de?.viaje_ref && !rv ? porCodigoArchivo("viaje", de.viaje_ref) : undefined;
      viajeResp = rv ? rv.responsable_id : (rvArchivo?.datos?.responsable?.id ?? null);
    }
    if (responsableEfectivo({ propio: d.responsable?.id ?? null, embarque: propioEmbarque, viaje: viajeResp }, estado.perfiles).faltante) e.avisos.push("sin_responsable");
  }

  // Numeración simulada de las nuevas sin código: primero se reservan los escritos y después se autonumera en orden de fila.
  const codigosSimulados = new Map<number, string>();
  const reservados: Record<TipoAgrupador, string[]> = {
    viaje: estado.viajes.map((v) => v.codigo),
    embarque: estado.embarques.map((x) => x.codigo),
    paquete: estado.paquetes.map((p) => p.codigo),
  };
  const nuevas = (tipo: TipoAgrupador) => delArchivo(tipo).filter((e) => e.clasificacion === "nueva");
  for (const tipo of TIPOS_AGRUPADOR) for (const e of nuevas(tipo)) if (e.datos?.codigo) reservados[tipo].push(e.datos.codigo);
  // El código de un paquete nuevo toma el mes del INGRESO CD de su embarque (no el del ingreso al stock): así embarque y paquetes comparten
  // prefijo aunque el ingreso se fije en otro mes (08b-1b §2.4, MEDIO 1).
  const mesPaquete = (e: EstadoFila): Mes | null => {
    if (e.embarque_id) {
      const eb = embarquePorId.get(e.embarque_id);
      return eb ? mesDe(eb.fecha_llegada_estimada) : null;
    }
    const llegada = porCodigoArchivo("embarque", e.embarque_codigo ?? "")?.datos?.fecha_llegada;
    return llegada ? llegada.slice(0, 7) : null;
  };
  for (const tipo of TIPOS_AGRUPADOR) {
    for (const e of nuevas(tipo)) {
      const d = e.datos as DatosFila;
      if (d.codigo !== null) continue;
      const referencia = tipo === "viaje" ? d.fecha_inicio : tipo === "embarque" ? d.fecha_llegada : mesPaquete(e);
      const aamm = referencia ? aammDe(referencia) : null;
      const s = aamm === null ? null : siguienteCodigo(aamm, reservados[tipo]);
      if (s === null || !s.ok) {
        omitir(e, "correlativo_agotado", "Ya se usaron los 99 códigos de ese mes: escribe el código a mano.");
        continue;
      }
      reservados[tipo].push(s.codigo);
      codigosSimulados.set(e.fila, s.codigo);
    }
  }

  // Reporte y lote.
  const resumenVacio = (): ResumenClasificacionApi => ({ nuevas: 0, iguales: 0, cambiadas: 0, omitidas: 0 });
  const resumen: ReporteImportacionAgrupadoresApi["resumen"] = { ...resumenVacio(), por_tipo: { viaje: resumenVacio(), embarque: resumenVacio(), paquete: resumenVacio() } };
  const campo = { nueva: "nuevas", igual: "iguales", cambiada: "cambiadas", omitida: "omitidas" } as const;
  const reporteFilas: FilaImportacionAgrupadorApi[] = [];
  const lote: LoteImportarAgrupadores = { archivo_nombre: opciones.archivo_nombre ?? "", viajes: [], embarques: [], paquetes: [] };

  for (const n of [...orden].sort((a, b) => a - b)) {
    const e = estados.get(n) as EstadoFila;
    resumen[campo[e.clasificacion]] += 1;
    if (e.tipo) resumen.por_tipo[e.tipo][campo[e.clasificacion]] += 1;
    const d = e.datos;
    reporteFilas.push({
      fila: e.fila,
      tipo: e.tipo,
      clave: e.clave,
      clasificacion: e.clasificacion,
      codigo_final: e.clasificacion === "nueva" ? (d?.codigo ?? null) : (e.codigo_final ?? d?.codigo ?? null),
      ...(e.motivo === undefined ? {} : { motivo: e.motivo }),
      ...(e.detalle === undefined ? {} : { detalle: e.detalle }),
      avisos: e.avisos,
    });
    if (e.clasificacion !== "nueva" || !d) continue;
    if (d.tipo === "viaje") {
      lote.viajes.push({ fila: d.fila, codigo: d.codigo, nombre: d.nombre, destino: d.destino, fecha_inicio: d.fecha_inicio as string, fecha_fin: d.fecha_fin, responsable_id: (d.responsable as PerfilConCorreo).id, nota: d.nota });
    } else if (d.tipo === "embarque") {
      lote.embarques.push({
        fila: d.fila,
        codigo: d.codigo,
        nombre: d.nombre,
        tipo: d.tipo_embarque,
        viaje_id: e.viaje_id ?? null,
        viaje_codigo: e.viaje_id ? null : (e.viaje_codigo ?? null),
        responsable_id: d.responsable?.id ?? null,
        referencia_logistica: d.referencia_logistica,
        puerto_embarque: d.puerto,
        fecha_salida_estimada: d.fecha_salida,
        fecha_puerto_estimada: d.fecha_arribo,
        fecha_llegada_estimada: d.fecha_llegada as string,
        fecha_inicio_operativo_estimada: d.inicio_fecha,
        hora_inicio_operativo: d.inicio_fecha === null ? null : d.inicio_hora,
        fecha_ingreso_estimada: d.fecha_ingreso_stock,
        origen: d.origen,
        nota: d.nota,
      });
    } else {
      lote.paquetes.push({ fila: d.fila, codigo: d.codigo, nombre: d.nombre, embarque_id: e.embarque_id ?? null, embarque_codigo: e.embarque_id ? null : (e.embarque_codigo ?? null), responsable_id: d.responsable?.id ?? null, nota: d.nota });
    }
  }

  return { reporte: { modo: "previsualizar", resumen, filas: reporteFilas }, lote, codigos_simulados: codigosSimulados };
}

/**
 * Reporte de `aplicar`: el de la previsualización con `modo = "aplicar"`, los códigos asignados en `codigo_final` y la lista `creados`.
 * `creados` es lo que devuelve `importar_agrupadores`: `[{ tipo, fila, id, codigo }]`.
 */
export function reporteAplicado(previo: ReporteImportacionAgrupadoresApi, creados: readonly { tipo: TipoAgrupador; fila: number; id: string; codigo: string }[]): ReporteImportacionAgrupadoresApi {
  const porFila = new Map(creados.map((c) => [c.fila, c]));
  return {
    ...previo,
    modo: "aplicar",
    filas: previo.filas.map((f) => (f.clasificacion === "nueva" && porFila.has(f.fila) ? { ...f, codigo_final: (porFila.get(f.fila) as { codigo: string }).codigo } : f)),
    creados: creados.map((c) => ({ tipo: c.tipo, id: c.id, codigo: c.codigo })),
  };
}

/** Argumentos de `importar_agrupadores(p_lote, p_actor)`. */
export const argsImportarAgrupadores = (lote: LoteImportarAgrupadores, actor: ActorAgrupador): { p_lote: LoteImportarAgrupadores; p_actor: ActorAgrupador } => ({ p_lote: lote, p_actor: actor });

/** `true` si el lote no crea nada (todo `igual`, `cambiada` u omitido): la API no llama a la función. */
export const loteVacio = (lote: LoteImportarAgrupadores): boolean => lote.viajes.length + lote.embarques.length + lote.paquetes.length === 0;

/**
 * Espejo en memoria de `importar_agrupadores` (R25): materializa el lote como registros nuevos con los códigos simulados y ids
 * `sim-<tipo>-<fila>`. Sirve para probar que reimportar el mismo archivo da todo `igual` y como referencia del humo de la función.
 */
export function simularAplicacionLote(lote: LoteImportarAgrupadores, estado: EstadoImportacionAgrupadores, codigos: ReadonlyMap<number, string>): EstadoImportacionAgrupadores {
  const codigoDe = (fila: number, escrito: string | null) => escrito ?? (codigos.get(fila) as string);
  const viajes: ViajeRegistro[] = lote.viajes.map((v) => ({ id: `sim-viaje-${v.fila}`, codigo: codigoDe(v.fila, v.codigo), nombre: v.nombre, destino: v.destino, fecha_inicio: v.fecha_inicio, fecha_fin: v.fecha_fin, responsable_id: v.responsable_id, estado: "abierto", nota: v.nota, revision: 0 }));
  const idViaje = (codigo: string | null) => viajes.find((v) => v.codigo === codigo)?.id ?? null;
  const embarques: EmbarqueRegistro[] = lote.embarques.map((e) => ({
    id: `sim-embarque-${e.fila}`,
    codigo: codigoDe(e.fila, e.codigo),
    nombre: e.nombre,
    tipo: e.tipo,
    viaje_id: e.viaje_id ?? idViaje(e.viaje_codigo),
    responsable_id: e.responsable_id,
    referencia_logistica: e.referencia_logistica,
    puerto_embarque: e.puerto_embarque,
    fecha_salida_estimada: e.fecha_salida_estimada,
    fecha_puerto_estimada: e.fecha_puerto_estimada,
    fecha_llegada_estimada: e.fecha_llegada_estimada,
    fecha_inicio_operativo_estimada: e.fecha_inicio_operativo_estimada,
    hora_inicio_operativo: e.hora_inicio_operativo,
    fecha_ingreso_estimada: e.fecha_ingreso_estimada,
    fecha_llegada_real: null,
    // 08b-1b §2.4 bis: al crear no hay ingreso real, así que el mes es el de `coalesce(FECHA_INGRESO_STOCK, FECHA_INGRESO_CD)`.
    periodo_llegada: periodoLlegada(null, e.fecha_ingreso_estimada, e.fecha_llegada_estimada),
    hito_confirmado: null,
    origen: e.origen,
    estado: "planificado",
    nota: e.nota,
    revision: 0,
  }));
  const idEmbarque = (codigo: string | null) => embarques.find((e) => e.codigo === codigo)?.id ?? null;
  const paquetes: PaqueteRegistro[] = lote.paquetes.map((p) => ({ id: `sim-paquete-${p.fila}`, embarque_id: (p.embarque_id ?? idEmbarque(p.embarque_codigo)) as string, codigo: codigoDe(p.fila, p.codigo), nombre: p.nombre, responsable_id: p.responsable_id, estado: "abierto", nota: p.nota, fecha_ingreso_estimada: null, periodo_ingreso: null }));
  return { viajes: [...estado.viajes, ...viajes], embarques: [...estado.embarques, ...embarques], paquetes: [...estado.paquetes, ...paquetes], perfiles: estado.perfiles };
}

// ─── Columnas VIAJE, EMBARQUE y PAQUETE del importador de compras (§3.9, R21) ───

export type CatalogoAgrupadoresCompra = {
  viajes: readonly Pick<ViajeRegistro, "id" | "codigo" | "estado">[];
  embarques: readonly Pick<EmbarqueRegistro, "id" | "codigo" | "estado" | "viaje_id" | "periodo_llegada">[];
  /** `periodo_ingreso`: el mes del ingreso propio del paquete (08b-1b); ausente o nulo = hereda el del embarque. */
  paquetes: readonly (Pick<PaqueteRegistro, "id" | "codigo" | "embarque_id" | "estado"> & Partial<Pick<PaqueteRegistro, "periodo_ingreso">>)[];
};

export type EntradaAgrupadoresFilaCompra = {
  fila: number;
  /** Celdas de texto tal como vienen (vacías = `""`). */
  viaje: string;
  embarque: string;
  paquete: string;
  /** Clasificación de M8 de la fila (con la huella de lo que dice el archivo; estas columnas no entran en ella). */
  clasificacion: "nueva" | "igual" | "cambiada";
  /** Entregas de la línea del archivo (de `LLEGADA` o de `ENTREGAS`): mes y unidades. */
  entregas: readonly { periodo: Mes; unidades: number }[];
  /** `compras.viaje_id` de la compra a la que pertenece la fila (nulo si la compra es nueva o no tiene viaje). */
  compra_viaje_id: string | null;
  /** En una `igual`: embarques a los que ya está asignada alguna entrega de la línea (vacío = sin asignación). */
  embarques_asignados: readonly string[];
};

export type ResultadoAgrupadoresFilaCompra = {
  api: AgrupadorImportacionCompraApi;
  /**
   * Lo que se aplica tras `importar_compra` (en este orden): `viaje_id` → `asignar_viaje_compras`; `embarque_id` (y `paquete_id`, que
   * puede ser nulo) → `aplicar_movimiento_agrupador` con `asignar` de la entrega entera de la línea. Nulos = nada que aplicar.
   * Si la compra tiene varias filas con `VIAJE` distinto, el servicio aplica el de la primera y las otras dan `agrupador_distinto`.
   */
  aplicar: { viaje_id: string | null; embarque_id: string | null; paquete_id: string | null };
  /** `true` si la fila se omite entera (el servicio no la manda a M8): código desconocido, viaje cancelado, llegada distinta, etc. */
  omite_fila: boolean;
};

const buscarCodigo = <T extends { codigo: string }>(lista: readonly T[], ref: string): T | undefined => lista.find((x) => normalizarCodigo(x.codigo) === ref);

/**
 * §3.9, R21. Evalúa las tres columnas de agrupador de UNA fila del importador de compras. Primero se clasifica la fila como en M8; las
 * reglas solo se aplican a `nueva` y a `igual` sin asignación. A una `igual` ya asignada a OTRO embarque se le pone el aviso
 * `agrupador_distinto` y no se toca; una `cambiada` sigue su regla de M8 (nada de agrupador). Las filas sin las tres columnas
 * devuelven `null`.
 *
 * Con `EMBARQUE`: la fila no puede traer más de una entrega (`entregas_con_embarque`) y su mes debe ser el MES DE DESTINO de la asignación:
 * `mesDeDestino(embarque, paquete de la fila)` (`llegada_distinta_del_embarque`; `LLEGADA` sigue siendo obligatoria). `PAQUETE` sin `EMBARQUE`: `paquete_sin_embarque`. Códigos
 * desconocidos: `viaje_desconocido`, `embarque_desconocido`, `paquete_desconocido` (el importador no crea agrupadores). `VIAJE` cerrado
 * se acepta con el aviso `viaje_cerrado`; cancelado, `viaje_cancelado`. Un embarque cancelado o recibido, `embarque_no_editable`.
 * Avisos que no bloquean: `viaje_distinto` (el viaje de la columna no es el del embarque).
 */
export function evaluarAgrupadoresDeFilaCompra(entrada: EntradaAgrupadoresFilaCompra, catalogo: CatalogoAgrupadoresCompra): ResultadoAgrupadoresFilaCompra | null {
  const viajeTxt = normalizarCodigo(entrada.viaje);
  const embarqueTxt = normalizarCodigo(entrada.embarque);
  const paqueteTxt = normalizarCodigo(entrada.paquete);
  if (viajeTxt === "" && embarqueTxt === "" && paqueteTxt === "") return null;

  const nada = { viaje_id: null, embarque_id: null, paquete_id: null };
  const base = (api: Partial<AgrupadorImportacionCompraApi>): AgrupadorImportacionCompraApi => ({ fila: entrada.fila, viaje: null, embarque: null, paquete: null, resultado: "sin_cambio", avisos: [], ...api });

  // Una `cambiada` sigue su regla de M8: no se toca ningún agrupador.
  if (entrada.clasificacion === "cambiada") return { api: base({}), aplicar: nada, omite_fila: false };

  const viaje = viajeTxt === "" ? null : (buscarCodigo(catalogo.viajes, viajeTxt) ?? null);
  const embarque = embarqueTxt === "" ? null : (buscarCodigo(catalogo.embarques, embarqueTxt) ?? null);
  const paquete = paqueteTxt === "" ? null : (buscarCodigo(catalogo.paquetes, paqueteTxt) ?? null);
  const resumirViaje = viaje ? { id: viaje.id, codigo: viaje.codigo } : null;
  const resumirEmbarque = embarque ? { id: embarque.id, codigo: embarque.codigo } : null;
  const resumirPaquete = paquete ? { id: paquete.id, codigo: paquete.codigo } : null;

  // `igual` ya asignada a un embarque: solo `agrupador_distinto` si lo que pide el archivo es otra cosa.
  if (entrada.clasificacion === "igual" && entrada.embarques_asignados.length > 0) {
    const mismo = embarque !== null && entrada.embarques_asignados.includes(embarque.id);
    const avisos: AvisoImportacionCompraAgrupador[] = [];
    if ((embarqueTxt !== "" && !mismo) || (embarqueTxt === "" && paqueteTxt !== "")) avisos.push("agrupador_distinto");
    // El viaje es de la compra: si no tiene, se le pone (las reglas de viaje valen igual que en una nueva).
    const viajeIgual = viaje !== null && entrada.compra_viaje_id === viaje.id;
    if (viajeTxt !== "" && !viajeIgual && entrada.compra_viaje_id !== null) avisos.push("agrupador_distinto");
    if (viajeTxt !== "" && entrada.compra_viaje_id === null && viaje && viaje.estado !== "cancelado") {
      if (viaje.estado === "cerrado") avisos.push("viaje_cerrado");
      return { api: base({ viaje: resumirViaje, embarque: resumirEmbarque, paquete: resumirPaquete, resultado: "asignado", avisos }), aplicar: { viaje_id: viaje.id, embarque_id: null, paquete_id: null }, omite_fila: false };
    }
    return { api: base({ viaje: resumirViaje, embarque: resumirEmbarque, paquete: resumirPaquete, resultado: "sin_cambio", avisos }), aplicar: nada, omite_fila: false };
  }

  const omitir = (motivo: MotivoOmisionCompraAgrupador, avisos: AvisoImportacionCompraAgrupador[] = []): ResultadoAgrupadoresFilaCompra => ({
    api: base({ viaje: resumirViaje, embarque: resumirEmbarque, paquete: resumirPaquete, resultado: "omitido", motivo, avisos }),
    aplicar: nada,
    omite_fila: true,
  });

  if (viajeTxt !== "") {
    if (!viaje) return omitir("viaje_desconocido");
    if (viaje.estado === "cancelado") return omitir("viaje_cancelado");
  }
  if (paqueteTxt !== "" && embarqueTxt === "") return omitir("paquete_sin_embarque");
  if (embarqueTxt !== "") {
    if (!embarque) return omitir("embarque_desconocido");
    if (embarque.estado === "cancelado" || embarque.estado === "recibido") return omitir("embarque_no_editable");
    if (paqueteTxt !== "") {
      if (!paquete || paquete.embarque_id !== embarque.id || paquete.estado !== "abierto") return omitir("paquete_desconocido");
    }
    if (entrada.entregas.length > 1) return omitir("entregas_con_embarque");
    // Regla 3 (08b-1b §2.4 bis): `LLEGADA` debe caer en el MES DE DESTINO: el del ingreso propio del paquete de la fila (si lo tiene) y, si no,
    // el del ingreso al stock del embarque.
    const mes = entrada.entregas[0]?.periodo;
    if (mes === undefined || mes !== mesDeDestino(embarque, paquete ? { periodo_ingreso: paquete.periodo_ingreso ?? null } : null)) return omitir("llegada_distinta_del_embarque");
  }

  const avisos: AvisoImportacionCompraAgrupador[] = [];
  if (viaje?.estado === "cerrado") avisos.push("viaje_cerrado");
  if (viaje && embarque && embarque.viaje_id !== null && embarque.viaje_id !== viaje.id) avisos.push("viaje_distinto");
  // El viaje de la compra: si ya tiene otro, no se toca (se cambia en pantalla).
  let viajeAplicar: string | null = null;
  if (viaje) {
    if (entrada.compra_viaje_id === null) viajeAplicar = viaje.id;
    else if (entrada.compra_viaje_id !== viaje.id) avisos.push("agrupador_distinto");
  }
  const aplicar = { viaje_id: viajeAplicar, embarque_id: embarque?.id ?? null, paquete_id: paquete?.id ?? null };
  const algo = aplicar.viaje_id !== null || aplicar.embarque_id !== null;
  return { api: base({ viaje: resumirViaje, embarque: resumirEmbarque, paquete: resumirPaquete, resultado: algo ? "asignado" : "sin_cambio", avisos }), aplicar, omite_fila: false };
}

/** Un `AgrupadorImportacionCompraApi` sin asignar ni avisos, para filas sin columnas de agrupador. */
export const sinAgrupadorEnFila = (fila: number): AgrupadorImportacionCompraApi => ({ fila, viaje: null, embarque: null, paquete: null, resultado: "sin_cambio", avisos: [] });
