import type { Tables } from "@/lib/supabase/database.types";
import { aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { MUESTRA_MAX, codigoUnico } from "@/lib/arbol/importar";
import { esMarcaGenerica, motivoRechazoConjunto, type MarcaConjunto } from "./reglas";
import type {
  CambioConjunto,
  ConjuntoACrear,
  FilaImportacionConjunto,
  FilaOmitidaConjunto,
  MotivoOmisionConjunto,
  ReporteConjuntosBase,
} from "../tipos-api";

/**
 * Importador de conjuntos (02b, regla 25) y núcleo compartido con la columna
 * `CONJUNTO` del importador de marcas de M2 (`planificarConjuntos`: un solo
 * algoritmo, no dos). Puro.
 *
 * Reglas: la marca debe existir (no crea marcas miembro); si el conjunto no
 * existe como marca, SE CREA COMO CABEZA con la agrupación de la fila de la
 * marca (la primera que lo nombra) y se lista antes de aplicar, salvo que esa
 * agrupación esté inactiva (`agrupacion_inactiva`: M2 no admite marcas nuevas en
 * una agrupación inactiva); `CONJUNTO` vacío = "no opina"; el archivo manda (una
 * marca en otro conjunto se cambia y se lista `de → a`). Las reglas de rechazo
 * son las de `motivoRechazoConjunto` evaluadas sobre el estado PROYECTADO: GANA
 * LO PRIMERO. Lo que deciden las filas anteriores del mismo archivo condiciona a
 * las siguientes, así que el resultado SÍ depende del orden de las filas (p. ej.
 * `GAMMA,ALFA JEANS` antes de `ALFA JEANS,ALFA` convierte a ALFA JEANS en cabeza y
 * rechaza la segunda con `marca_es_cabeza`; al revés rechaza la primera con
 * `conjunto_es_miembro`). Es determinista: el mismo archivo da siempre lo mismo.
 * Reimportar tras aplicar no cambia nada.
 */

export { MUESTRA_MAX };

export type MarcaEstadoConjunto = MarcaConjunto & { codigo: string };
export type AgrupacionEstadoConjunto = Pick<Tables<"agrupaciones_marca">, "id" | "nombre" | "activo">;

export type EstadoImportacionConjuntos = {
  agrupaciones: AgrupacionEstadoConjunto[];
  marcas: MarcaEstadoConjunto[];
};

/** Una cabeza que no existe y hay que crear (siempre sin tratamiento especial). */
export type CabezaNueva = { nombre: string; codigo: string; agrupacion_marca_id: string };

/** Una marca que pasa a estar en un conjunto. Los ids que aún no existen (marca o cabeza nuevas) se resuelven por nombre al escribir. */
export type AsignacionConjunto = {
  marca_id: string | null;
  marca_nombre: string;
  cabeza_id: string | null;
  cabeza_nombre: string;
};

/** Quién es la marca de una fila: una existente o, en el importador de marcas, una que se creará. */
export type MarcaDeFila = { id: string | null; nombre: string; agrupacion_marca_id: string; activo: boolean; conjunto_marca_id: string | null };

export type EntradaConjunto = {
  marca: MarcaDeFila;
  /** `CONJUNTO` normalizado; `""` = no opina. */
  conjunto: string;
  /** Agrupación con la que se crearía la cabeza si no existe (la de la fila de la marca). */
  agrupacion_cabeza: { id: string; nombre: string };
};

export type ResultadoConjunto =
  | { tipo: "sin_opinion" }
  | { tipo: "omitida"; motivo: MotivoOmisionConjunto; detalle?: string }
  | { tipo: "existente"; conjunto: string }
  | { tipo: "asignar"; asignacion: AsignacionConjunto }
  | { tipo: "cambio"; asignacion: AsignacionConjunto; de: string; a: string };

const MOTIVO_DESDE_RECHAZO: Record<string, MotivoOmisionConjunto | undefined> = {
  conjunto_propio: "conjunto_igual_marca",
  cabeza_es_miembro: "conjunto_es_miembro",
  marca_es_cabeza: "marca_es_cabeza",
  marca_generica: "marca_generica",
  cabeza_inactiva: "cabeza_inactiva",
};

/**
 * Núcleo compartido. Se crea con el estado de marcas y se llama a `evaluar`
 * fila por fila; cada resultado aceptado actualiza el estado proyectado.
 */
export function planificarConjuntos(estado: EstadoImportacionConjuntos) {
  let proyectadas: MarcaConjunto[] = estado.marcas.map((m) => ({
    id: m.id,
    nombre: m.nombre,
    activo: m.activo,
    agrupacion_marca_id: m.agrupacion_marca_id,
    conjunto_marca_id: m.conjunto_marca_id,
  }));
  const clave = (m: { id: string | null; nombre: string }) => m.id ?? `nueva:${normalizarNombre(m.nombre)}`;
  const porNombre = () => new Map(proyectadas.map((m) => [normalizarNombre(m.nombre), m]));
  const porCodigo = new Map(estado.marcas.map((m) => [m.codigo.toUpperCase(), m.id]));
  const codigosUsados = new Set(estado.marcas.map((m) => m.codigo.toUpperCase()));
  const aCrear: ConjuntoACrear[] = [];
  const cabezasNuevas: CabezaNueva[] = [];

  /** Registra una marca que se creará en este mismo archivo (importador de marcas), para que pueda ser cabeza. */
  const registrarMarcaNueva = (m: MarcaDeFila) => {
    proyectadas = [...proyectadas, { id: clave(m), nombre: m.nombre, activo: true, agrupacion_marca_id: m.agrupacion_marca_id, conjunto_marca_id: null }];
    codigosUsados.add(aCodigo(m.nombre));
  };

  const buscarCabeza = (texto: string): MarcaConjunto | undefined => {
    const norm = normalizarNombre(texto);
    const porN = porNombre().get(norm);
    if (porN) return porN;
    const codigo = aCodigo(texto);
    const id = codigo ? porCodigo.get(codigo) : undefined;
    return id ? proyectadas.find((m) => m.id === id) : undefined;
  };

  const evaluar = (entrada: EntradaConjunto): ResultadoConjunto => {
    const { marca, conjunto } = entrada;
    if (!conjunto) return { tipo: "sin_opinion" };
    const idMarca = clave(marca);
    const proyMarca = proyectadas.find((m) => m.id === idMarca) ?? {
      id: idMarca,
      nombre: marca.nombre,
      activo: marca.activo,
      agrupacion_marca_id: marca.agrupacion_marca_id,
      conjunto_marca_id: marca.conjunto_marca_id,
    };

    let cabeza = buscarCabeza(conjunto);
    const nueva = cabeza === undefined;
    if (!cabeza) {
      cabeza = {
        id: `nueva:${normalizarNombre(conjunto)}`,
        nombre: normalizarNombre(conjunto),
        activo: true,
        agrupacion_marca_id: entrada.agrupacion_cabeza.id,
        conjunto_marca_id: null,
      };
    }

    // Igual a sí misma se informa antes que cualquier otra cosa.
    if (normalizarNombre(marca.nombre) === normalizarNombre(cabeza.nombre)) {
      return { tipo: "omitida", motivo: "conjunto_igual_marca" };
    }
    // Genéricas: marca o cabeza (la regla 21 lo mira al final; aquí se informa primero para dar el motivo claro).
    if (esMarcaGenerica(marca.nombre) || esMarcaGenerica(cabeza.nombre)) {
      return { tipo: "omitida", motivo: "marca_generica", detalle: esMarcaGenerica(marca.nombre) ? marca.nombre : cabeza.nombre };
    }

    const rechazo = motivoRechazoConjunto(proyMarca, cabeza, nueva ? [...proyectadas, cabeza] : proyectadas);
    if (rechazo) {
      const motivo = MOTIVO_DESDE_RECHAZO[rechazo.motivo];
      if (motivo) return { tipo: "omitida", motivo, detalle: rechazo.mensaje };
      return { tipo: "omitida", motivo: "marca_generica", detalle: rechazo.mensaje };
    }

    if (proyMarca.conjunto_marca_id === cabeza.id) return { tipo: "existente", conjunto: cabeza.nombre };

    const previa = proyMarca.conjunto_marca_id
      ? proyectadas.find((m) => m.id === proyMarca.conjunto_marca_id)?.nombre ?? ""
      : null;

    // Aceptada: se proyecta el cambio (y la cabeza nueva, si hace falta).
    if (nueva) {
      const agrupacion = estado.agrupaciones.find((a) => a.id === entrada.agrupacion_cabeza.id);
      if (agrupacion && !agrupacion.activo) {
        return {
          tipo: "omitida",
          motivo: "agrupacion_inactiva",
          detalle: `${cabeza.nombre} no existe y su agrupación ${agrupacion.nombre} está inactiva: reactívala o crea la cabeza en Marcas.`,
        };
      }
      const codigo = codigoUnico(aCodigo(cabeza.nombre), codigosUsados, "MARCA");
      codigosUsados.add(codigo);
      cabezasNuevas.push({ nombre: cabeza.nombre, codigo, agrupacion_marca_id: entrada.agrupacion_cabeza.id });
      aCrear.push({ conjunto: cabeza.nombre, agrupacion: entrada.agrupacion_cabeza.nombre, de: marca.nombre });
      proyectadas = [...proyectadas, cabeza];
    }
    const cabezaId = cabeza.id;
    proyectadas = proyectadas.map((m) => (m.id === idMarca ? { ...m, conjunto_marca_id: cabezaId } : m));

    const asignacion: AsignacionConjunto = {
      marca_id: marca.id,
      marca_nombre: marca.nombre,
      cabeza_id: cabeza.id.startsWith("nueva:") ? null : cabeza.id,
      cabeza_nombre: cabeza.nombre,
    };
    return previa === null
      ? { tipo: "asignar", asignacion }
      : { tipo: "cambio", asignacion, de: previa, a: cabeza.nombre };
  };

  return { evaluar, registrarMarcaNueva, conjuntosACrear: () => aCrear, cabezasNuevas: () => cabezasNuevas };
}

// ─── Importador de la hoja MARCA, CONJUNTO ───

export type PlanImportacionConjuntos = {
  reporte: ReporteConjuntosBase;
  cabezas_nuevas: CabezaNueva[];
  asignaciones: AsignacionConjunto[];
};

export function planificarImportacionConjuntos(
  filas: FilaImportacionConjunto[],
  estado: EstadoImportacionConjuntos
): PlanImportacionConjuntos {
  const planificador = planificarConjuntos(estado);
  const omitidas: FilaOmitidaConjunto[] = [];
  const cambios: CambioConjunto[] = [];
  const asignaciones: AsignacionConjunto[] = [];
  const muestra: string[] = [];
  const agrupacionPorId = new Map(estado.agrupaciones.map((a) => [a.id, a]));
  const marcaPorNombre = new Map(estado.marcas.map((m) => [normalizarNombre(m.nombre), m]));
  const marcaPorCodigo = new Map(estado.marcas.map((m) => [m.codigo.toUpperCase(), m]));
  const vistas = new Map<string, { fila: number; conjunto: string }>();
  let asignar = 0;
  let existentes = 0;
  let sinOpinion = 0;
  let procesadas = 0;

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const marcaTxt = normalizarNombre(cruda.marca);
    const conjuntoTxt = normalizarNombre(cruda.conjunto);
    const omitir = (motivo: MotivoOmisionConjunto, extra: Pick<FilaOmitidaConjunto, "detalle" | "fila_original"> = {}) => {
      omitidas.push({ fila, motivo, ...extra, marca: marcaTxt, conjunto: conjuntoTxt });
    };

    if (!marcaTxt) return omitir("marca_vacia");
    if (marcaTxt === "TOTAL") return omitir("fila_total");
    if (!conjuntoTxt) {
      sinOpinion += 1;
      procesadas += 1;
      return;
    }
    if (esMarcaGenerica(marcaTxt) || esMarcaGenerica(conjuntoTxt)) {
      return omitir("marca_generica", { detalle: esMarcaGenerica(marcaTxt) ? marcaTxt : conjuntoTxt });
    }
    if (marcaTxt === conjuntoTxt) return omitir("conjunto_igual_marca");

    const codigo = aCodigo(cruda.marca);
    const marca = marcaPorNombre.get(marcaTxt) ?? (codigo ? marcaPorCodigo.get(codigo) : undefined);
    if (!marca) return omitir("marca_desconocida", { detalle: marcaTxt });

    // Duplicados por marca: manda la primera aparición.
    const vista = vistas.get(marca.id);
    if (vista) {
      return omitir("duplicada_en_archivo", {
        fila_original: vista.fila,
        ...(vista.conjunto !== conjuntoTxt ? { detalle: `conjunto distinto: ${conjuntoTxt}` } : {}),
      });
    }
    vistas.set(marca.id, { fila, conjunto: conjuntoTxt });

    const agrupacion = agrupacionPorId.get(marca.agrupacion_marca_id);
    const resultado = planificador.evaluar({
      marca: { ...marca },
      conjunto: conjuntoTxt,
      agrupacion_cabeza: { id: marca.agrupacion_marca_id, nombre: agrupacion?.nombre ?? "" },
    });
    switch (resultado.tipo) {
      case "sin_opinion":
        break;
      case "omitida":
        return omitir(resultado.motivo, resultado.detalle === undefined ? {} : { detalle: resultado.detalle });
      case "existente":
        procesadas += 1;
        existentes += 1;
        break;
      case "asignar":
        procesadas += 1;
        asignar += 1;
        asignaciones.push(resultado.asignacion);
        if (muestra.length < MUESTRA_MAX) muestra.push(`${marca.nombre} → ${resultado.asignacion.cabeza_nombre}`);
        break;
      case "cambio":
        procesadas += 1;
        cambios.push({ fila, marca: marca.nombre, de: resultado.de, a: resultado.a });
        asignaciones.push(resultado.asignacion);
        if (muestra.length < MUESTRA_MAX) muestra.push(`${marca.nombre} → ${resultado.a}`);
        break;
    }
  });

  return {
    reporte: {
      totales: { recibidas: filas.length, procesadas, omitidas: omitidas.length },
      asignar,
      cambios,
      conjuntos_a_crear: planificador.conjuntosACrear(),
      existentes,
      sin_opinion: sinOpinion,
      omitidas,
      muestra: { asignaciones: muestra },
    },
    cabezas_nuevas: planificador.cabezasNuevas(),
    asignaciones,
  };
}

/**
 * Aplica el plan en memoria (no muta el estado): crea las cabezas nuevas (si no
 * existen por nombre) y fija `conjunto_marca_id`. Los ids de las cabezas nuevas
 * son deterministas. Sirve para probar idempotencia sin base.
 */
export function aplicarPlanConjuntos(
  estado: EstadoImportacionConjuntos,
  plan: PlanImportacionConjuntos
): EstadoImportacionConjuntos {
  const marcas = [...estado.marcas];
  const idPorNombre = new Map(marcas.map((m) => [normalizarNombre(m.nombre), m.id]));
  plan.cabezas_nuevas.forEach((c, i) => {
    if (idPorNombre.has(c.nombre)) return;
    const id = `plan-cabeza-${i + 1}`;
    marcas.push({ id, nombre: c.nombre, codigo: c.codigo, activo: true, agrupacion_marca_id: c.agrupacion_marca_id, conjunto_marca_id: null });
    idPorNombre.set(c.nombre, id);
  });
  const nuevoConjunto = new Map<string, string>();
  for (const a of plan.asignaciones) {
    const cabeza = a.cabeza_id ?? idPorNombre.get(normalizarNombre(a.cabeza_nombre));
    const marcaId = a.marca_id ?? idPorNombre.get(normalizarNombre(a.marca_nombre));
    if (cabeza && marcaId) nuevoConjunto.set(marcaId, cabeza);
  }
  return { ...estado, marcas: marcas.map((m) => (nuevoConjunto.has(m.id) ? { ...m, conjunto_marca_id: nuevoConjunto.get(m.id) ?? null } : m)) };
}
