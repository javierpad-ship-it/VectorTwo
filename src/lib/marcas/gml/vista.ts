import { compararNombre } from "@/lib/arbol/armar-arbol";
import { compararNodos, type IndiceNodos, type NodoInfo } from "@/lib/arbol/nivel/indice";
import { modalidadEfectiva } from "../reglas";
import { marcasPorId, miembrosPorCabeza, unidadDeMarca, type UnidadDeMarca } from "../conjuntos/reglas";
import {
  marcaVigenteGml,
  motivoIgnorada,
  motivoPendiente,
  type AgrupacionGml,
  type AsignacionGmlEntrada,
  type MarcaGml,
} from "./reglas";
import type {
  AsignacionGml,
  EstadoGmlEspecial,
  MarcaEstadoGml,
  MixtaVigente,
  NodoEstadoGml,
  PendienteVigente,
  ResumenGmlEspecial,
  VigentesRespuesta,
} from "../tipos-api";

/**
 * Armado de las vistas de las marcas relevantes por GML (02b, reglas 9 a 11):
 * el estado para la pantalla (`armarVistaGml`), la configuración vigente que
 * leen M7 y M8 (`armarVigentes`) y su equivalente en TypeScript de la vista SQL
 * de vigentes (`unidadesFlujoEspecial`). Puras, sin I/O.
 */

export type EstadoVistaGml = {
  marcas: readonly MarcaGml[];
  agrupaciones: readonly AgrupacionGml[];
  asignaciones: readonly AsignacionGmlEntrada[];
  nodos: IndiceNodos;
};

export type OpcionesVistaGml = {
  incluirInactivas?: boolean;
  /** Solo la marca con este id (el resumen sigue siendo el de todas). */
  marcaId?: string;
  /** Solo las asignaciones de este nodo (y las marcas que las tienen). */
  nodoId?: string;
};

type Contexto = {
  marcasPorId: Map<string, MarcaGml>;
  agrupaciones: Map<string, AgrupacionGml>;
  unidades: Map<string, UnidadDeMarca>;
  asignacionesPorMarca: Map<string, AsignacionGmlEntrada[]>;
};

function contexto(estado: EstadoVistaGml): Contexto {
  const porId = marcasPorId(estado.marcas);
  const unidades = new Map<string, UnidadDeMarca>();
  for (const m of estado.marcas) unidades.set(m.id, unidadDeMarca(m, estado.marcas));
  const asignacionesPorMarca = new Map<string, AsignacionGmlEntrada[]>();
  for (const a of estado.asignaciones) {
    if (!a.activo) continue; // `activo = false` se lee como ausente
    if (!estado.nodos.has(a.genero_mundo_linea_id)) continue; // imposible con la FK
    const lista = asignacionesPorMarca.get(a.marca_id) ?? [];
    lista.push(a);
    asignacionesPorMarca.set(a.marca_id, lista);
  }
  return {
    marcasPorId: porId,
    agrupaciones: new Map(estado.agrupaciones.map((a) => [a.id, a])),
    unidades,
    asignacionesPorMarca,
  };
}

/** Una asignación en la forma de la pantalla, con su vigencia o su motivo de ignorada. */
function formaAsignacion(
  a: AsignacionGmlEntrada,
  nodo: NodoInfo,
  marca: MarcaGml,
  agrupacion: AgrupacionGml | undefined,
  unidad: UnidadDeMarca,
  nombreCabeza: string | undefined
): AsignacionGml {
  const ignorada = motivoIgnorada(marca, agrupacion, unidad, nodo, nombreCabeza);
  return {
    id: a.id,
    genero_mundo_linea_id: a.genero_mundo_linea_id,
    genero: nodo.genero,
    mundo: nodo.mundo,
    linea: nodo.linea,
    nivel_planificacion: nodo.nivel_planificacion,
    nota: a.nota,
    vigente: ignorada === null,
    motivo_ignorada: ignorada?.motivo ?? null,
    ...(ignorada?.detalle ? { detalle: ignorada.detalle } : {}),
    created_at: a.created_at,
  };
}

/** Las asignaciones de una marca en la forma de la pantalla, por ruta del nodo. */
function asignacionesDeMarca(marca: MarcaGml, estado: EstadoVistaGml, ctx: Contexto): AsignacionGml[] {
  const unidad = ctx.unidades.get(marca.id) ?? unidadDeMarca(marca, estado.marcas);
  const agrupacion = ctx.agrupaciones.get(marca.agrupacion_marca_id);
  const cabeza = unidad.en_conjunto ? ctx.marcasPorId.get(unidad.unidad_marca_id) : undefined;
  const lista = (ctx.asignacionesPorMarca.get(marca.id) ?? []).flatMap((a) => {
    const nodo = estado.nodos.get(a.genero_mundo_linea_id);
    return nodo ? [{ a, nodo }] : [];
  });
  lista.sort((x, y) => compararNodos(x.nodo, y.nodo));
  return lista.map(({ a, nodo }) => formaAsignacion(a, nodo, marca, agrupacion, unidad, cabeza?.nombre));
}

/**
 * Una sola asignación en la forma de la pantalla (para las respuestas de
 * `POST` y `PATCH`). `marca` es el estado de la marca que se quiere considerar
 * (p. ej. ya marcada `por_gml` tras asignar). `undefined` si el nodo no existe.
 */
export function describirAsignacion(
  a: AsignacionGmlEntrada,
  marca: MarcaGml,
  estado: EstadoVistaGml
): AsignacionGml | undefined {
  const nodo = estado.nodos.get(a.genero_mundo_linea_id);
  if (!nodo) return undefined;
  const marcas = estado.marcas.map((m) => (m.id === marca.id ? marca : m));
  const unidad = unidadDeMarca(marca, marcas);
  const cabeza = unidad.en_conjunto ? marcas.find((m) => m.id === unidad.unidad_marca_id) : undefined;
  const agrupacion = estado.agrupaciones.find((g) => g.id === marca.agrupacion_marca_id);
  return formaAsignacion(a, nodo, marca, agrupacion, unidad, cabeza?.nombre);
}

/**
 * Cuenta las asignaciones de cada marca (todas y vigentes), para
 * `GET /api/marcas`. Misma vigencia que `armarVistaGml`.
 */
export function contarAsignaciones(estado: EstadoVistaGml): Map<string, { asignados: number; vigentes: number }> {
  const ctx = contexto(estado);
  const conteo = new Map<string, { asignados: number; vigentes: number }>();
  for (const marca of estado.marcas) {
    const gml = asignacionesDeMarca(marca, estado, ctx);
    conteo.set(marca.id, { asignados: gml.length, vigentes: gml.filter((g) => g.vigente).length });
  }
  return conteo;
}

const compararAgrupacion = (a: AgrupacionGml | undefined, b: AgrupacionGml | undefined) =>
  (a?.orden ?? 0) - (b?.orden ?? 0) || compararNombre(a?.nombre ?? "", b?.nombre ?? "");

/**
 * Regla 10. El estado de `GET /api/marcas/gml-especial`:
 *
 *   - `marcas[]`: marcas marcadas o con alguna asignación (las desmarcadas
 *     conservan las suyas, visibles como `marca_sin_tratamiento`), por nombre;
 *     las inactivas solo con `incluirInactivas`;
 *   - `por_nodo`: exactamente los nodos con al menos una asignación entre esas
 *     marcas, agrupadas por la agrupación de la marca, cada marca una vez;
 *   - `resumen`: `marcadas = por_gml + barrido + sin_modalidad` (los miembros de
 *     un conjunto efectivo no cuentan: su configuración propia está ignorada) y
 *     `asignaciones = vigentes + ignoradas`.
 */
export function armarVistaGml(estado: EstadoVistaGml, opciones: OpcionesVistaGml = {}): EstadoGmlEspecial {
  const ctx = contexto(estado);
  const miembros = miembrosPorCabeza(estado.marcas);

  type Fila = { marca: MarcaGml; entrada: MarcaEstadoGml; enConjunto: boolean };
  const filas: Fila[] = [];
  for (const marca of estado.marcas) {
    if (!opciones.incluirInactivas && !marca.activo) continue;
    const gml = asignacionesDeMarca(marca, estado, ctx);
    if (!marca.tratamiento_especial && gml.length === 0) continue;

    const unidad = ctx.unidades.get(marca.id) ?? unidadDeMarca(marca, estado.marcas);
    const agrupacion = ctx.agrupaciones.get(marca.agrupacion_marca_id);
    const vigentes = gml.filter((g) => g.vigente).length;
    const pendiente = motivoPendiente(marca, agrupacion, vigentes, unidad.en_conjunto);
    const cabeza = marca.conjunto_marca_id ? ctx.marcasPorId.get(marca.conjunto_marca_id) : undefined;
    filas.push({
      marca,
      enConjunto: unidad.en_conjunto,
      entrada: {
        id: marca.id,
        nombre: marca.nombre,
        codigo: marca.codigo ?? "",
        activo: marca.activo,
        vigente: marcaVigenteGml(marca, agrupacion),
        agrupacion_marca: {
          id: marca.agrupacion_marca_id,
          nombre: agrupacion?.nombre ?? "",
          activo: agrupacion?.activo ?? false,
        },
        modalidad_tratamiento: marca.modalidad_tratamiento === "por_gml" || marca.modalidad_tratamiento === "barrido" ? marca.modalidad_tratamiento : null,
        modalidad_efectiva: modalidadEfectiva(marca),
        nota_tratamiento: marca.nota_tratamiento ?? null,
        conjunto: cabeza ? { id: cabeza.id, nombre: cabeza.nombre } : null,
        miembros: (miembros.get(marca.id) ?? []).map((m) => m.nombre).sort(compararNombre),
        gml,
        pendiente: pendiente !== null,
        motivo_pendiente: pendiente,
      },
    });
  }
  filas.sort((a, b) => compararNombre(a.marca.nombre, b.marca.nombre) || (a.marca.id < b.marca.id ? -1 : 1));

  // Resumen: sobre todas las filas listadas (el filtro por marca o nodo no lo altera).
  const resumen: ResumenGmlEspecial = {
    marcadas: 0,
    por_gml: 0,
    barrido: 0,
    mixta: 0,
    sin_modalidad: 0,
    asignaciones: 0,
    asignaciones_vigentes: 0,
    asignaciones_ignoradas: 0,
    pendientes_sin_gml: 0,
    pendientes_mixta_sin_gml: 0,
    nodos_con_relevantes: 0,
    nodos_con_mas_de_4_por_agrupacion: 0,
  };
  for (const f of filas) {
    const e = f.entrada;
    if (f.marca.tratamiento_especial && !f.enConjunto) {
      resumen.marcadas += 1;
      // M12: la modalidad que cuenta es la efectiva (una mixta es `por_gml` en la columna); `sin_modalidad` es la casilla con columna nula.
      if (f.marca.modalidad_tratamiento === null) resumen.sin_modalidad += 1;
      else if (modalidadEfectiva(f.marca) === "mixta") resumen.mixta += 1;
      else if (f.marca.modalidad_tratamiento === "por_gml") resumen.por_gml += 1;
      else resumen.barrido += 1;
    }
    resumen.asignaciones += e.gml.length;
    resumen.asignaciones_vigentes += e.gml.filter((g) => g.vigente).length;
    resumen.asignaciones_ignoradas += e.gml.filter((g) => !g.vigente).length;
    // `pendientes_sin_gml` conserva su contrato (solo `sin_gml`); las mixtas sin GML se cuentan aparte.
    if (e.motivo_pendiente === "sin_gml") resumen.pendientes_sin_gml += 1;
    else if (e.motivo_pendiente === "mixta_sin_gml") resumen.pendientes_mixta_sin_gml += 1;
  }
  resumen.asignaciones_ignoradas = resumen.asignaciones - resumen.asignaciones_vigentes;

  // Vista inversa: nodos con al menos una asignación.
  type Acumulado = { nodo: NodoInfo; porAgrupacion: Map<string, { marca_id: string; nombre: string; vigente: boolean }[]>; vigentes: number };
  const porNodo = new Map<string, Acumulado>();
  for (const f of filas) {
    for (const g of f.entrada.gml) {
      const nodo = estado.nodos.get(g.genero_mundo_linea_id);
      if (!nodo) continue;
      const acc = porNodo.get(nodo.id) ?? { nodo, porAgrupacion: new Map(), vigentes: 0 };
      const lista = acc.porAgrupacion.get(f.marca.agrupacion_marca_id) ?? [];
      lista.push({ marca_id: f.marca.id, nombre: f.marca.nombre, vigente: g.vigente });
      acc.porAgrupacion.set(f.marca.agrupacion_marca_id, lista);
      if (g.vigente) acc.vigentes += 1;
      porNodo.set(nodo.id, acc);
    }
  }
  const por_nodo_todos: NodoEstadoGml[] = [...porNodo.values()]
    .sort((a, b) => compararNodos(a.nodo, b.nodo))
    .map((acc) => ({
      genero_mundo_linea_id: acc.nodo.id,
      genero: acc.nodo.genero,
      mundo: acc.nodo.mundo,
      linea: acc.nodo.linea,
      vigente: acc.nodo.vigente,
      nivel_planificacion: acc.nodo.nivel_planificacion,
      agrupaciones: [...acc.porAgrupacion.entries()]
        .sort(([x], [y]) => compararAgrupacion(ctx.agrupaciones.get(x), ctx.agrupaciones.get(y)))
        .map(([agrupacionId, marcas]) => ({
          agrupacion_marca_id: agrupacionId,
          nombre: ctx.agrupaciones.get(agrupacionId)?.nombre ?? "",
          marcas: marcas.sort((a, b) => compararNombre(a.nombre, b.nombre)),
        })),
      relevantes_vigentes: acc.vigentes,
    }));
  resumen.nodos_con_relevantes = por_nodo_todos.length;
  resumen.nodos_con_mas_de_4_por_agrupacion = por_nodo_todos.filter((n) =>
    n.agrupaciones.some((a) => a.marcas.filter((m) => m.vigente).length > 4)
  ).length;

  // Filtros de la consulta (después del resumen, que es global).
  let marcas = filas.map((f) => f.entrada);
  let por_nodo = por_nodo_todos;
  if (opciones.marcaId) marcas = marcas.filter((m) => m.id === opciones.marcaId);
  if (opciones.nodoId) {
    const nodoId = opciones.nodoId;
    por_nodo = por_nodo.filter((n) => n.genero_mundo_linea_id === nodoId);
    marcas = marcas
      .filter((m) => m.gml.some((g) => g.genero_mundo_linea_id === nodoId))
      .map((m) => ({ ...m, gml: m.gml.filter((g) => g.genero_mundo_linea_id === nodoId) }));
  }
  return { marcas, por_nodo, resumen };
}

// ─── Equivalente en TypeScript de la vista SQL de vigentes ───

/** Una fila de la vista de vigentes: una por unidad al barrer (GML `null`) y una por par unidad × GML vigente. */
export type UnidadFlujoEspecial = {
  marca_id: string;
  agrupacion_marca_id: string;
  modalidad: "barrido" | "por_gml";
  genero_mundo_linea_id: string | null;
};

export type PendienteFlujo = { marca_id: string; marca: string; motivo: "sin_gml" | "sin_modalidad" | "mixta_sin_gml" };

export type FlujoEspecial = { unidades: UnidadFlujoEspecial[]; pendientes: PendienteFlujo[] };

/**
 * Regla 10: lo mismo que la vista SQL de vigentes (la prueba SQL
 * comprueba que coinciden). Solo las UNIDADES de marca (marcas que son su propia
 * unidad: cabezas y sueltas): la configuración propia de un miembro de un
 * conjunto efectivo nunca produce filas. Una marca `por_gml` sin pares vigentes
 * no produce ninguna y va a `pendientes`, igual que la marca marcada sin
 * modalidad (que además fluye como `barrido`). M12: una `mixta` produce las DOS
 * clases de fila (una de GML nulo, su resto al barrer, y una por GML vigente);
 * sin GML vigentes solo la nula y va a `pendientes` como `mixta_sin_gml`.
 */
export function unidadesFlujoEspecial(estado: EstadoVistaGml): FlujoEspecial {
  const ctx = contexto(estado);
  const unidades: UnidadFlujoEspecial[] = [];
  const pendientes: PendienteFlujo[] = [];

  for (const marca of estado.marcas) {
    const unidad = ctx.unidades.get(marca.id) ?? unidadDeMarca(marca, estado.marcas);
    if (unidad.en_conjunto) continue; // un miembro nunca produce unidades
    const agrupacion = ctx.agrupaciones.get(marca.agrupacion_marca_id);
    if (!marca.tratamiento_especial || !marcaVigenteGml(marca, agrupacion)) continue;

    const efectiva = modalidadEfectiva(marca);
    let vigentes = 0;
    if (efectiva === "barrido" || efectiva === "mixta") {
      unidades.push({
        marca_id: marca.id,
        agrupacion_marca_id: marca.agrupacion_marca_id,
        modalidad: "barrido",
        genero_mundo_linea_id: null,
      });
    }
    if (efectiva !== "barrido") {
      for (const a of ctx.asignacionesPorMarca.get(marca.id) ?? []) {
        const nodo = estado.nodos.get(a.genero_mundo_linea_id);
        if (!nodo?.vigente) continue;
        vigentes += 1;
        unidades.push({
          marca_id: marca.id,
          agrupacion_marca_id: marca.agrupacion_marca_id,
          modalidad: "por_gml",
          genero_mundo_linea_id: nodo.id,
        });
      }
    }
    const pendiente = motivoPendiente(marca, agrupacion, vigentes);
    if (pendiente === "sin_gml" || pendiente === "sin_modalidad" || pendiente === "mixta_sin_gml") {
      pendientes.push({ marca_id: marca.id, marca: marca.nombre, motivo: pendiente });
    }
  }
  return { unidades, pendientes };
}

/**
 * `GET /api/marcas/gml-especial/vigentes`: la configuración vigente ya en la
 * forma de "mi flujo de Jeans" (regla 10 y "Lo que M7 y M8 consumen"). Los
 * miembros se listan por nombre (activos o no: la membresía vale igual).
 */
export function armarVigentes(estado: EstadoVistaGml, calculadoAt: string): VigentesRespuesta {
  const ctx = contexto(estado);
  const flujo = unidadesFlujoEspecial(estado);
  const miembros = miembrosPorCabeza(estado.marcas);
  const agrupacionNombre = (id: string) => ctx.agrupaciones.get(id)?.nombre ?? "";

  // Miembros que de verdad cuentan para esa cabeza (la cabeza activa); una cabeza inactiva no los reúne.
  const miembrosEfectivos = (marcaId: string) =>
    (miembros.get(marcaId) ?? [])
      .filter((m) => ctx.unidades.get(m.id)?.unidad_marca_id === marcaId)
      .map((m) => m.nombre)
      .sort(compararNombre);

  const gmlMapa = new Map<string, Map<string, { marca_id: string; marca: string; miembros: string[] }[]>>();
  for (const u of flujo.unidades) {
    if (u.modalidad !== "por_gml" || !u.genero_mundo_linea_id) continue;
    const marca = ctx.marcasPorId.get(u.marca_id);
    if (!marca) continue;
    const porAgrupacion = gmlMapa.get(u.genero_mundo_linea_id) ?? new Map();
    const lista = porAgrupacion.get(u.agrupacion_marca_id) ?? [];
    lista.push({ marca_id: marca.id, marca: marca.nombre, miembros: miembrosEfectivos(marca.id) });
    porAgrupacion.set(u.agrupacion_marca_id, lista);
    gmlMapa.set(u.genero_mundo_linea_id, porAgrupacion);
  }

  const gml = [...gmlMapa.entries()]
    .flatMap(([nodoId, porAgrupacion]) => {
      const nodo = estado.nodos.get(nodoId);
      return nodo ? [{ nodo, porAgrupacion }] : [];
    })
    .sort((a, b) => compararNodos(a.nodo, b.nodo))
    .map(({ nodo, porAgrupacion }) => ({
      genero_mundo_linea_id: nodo.id,
      genero: nodo.genero,
      mundo: nodo.mundo,
      linea: nodo.linea,
      nivel_planificacion: nodo.nivel_planificacion,
      agrupaciones: [...porAgrupacion.entries()]
        .sort(([x], [y]) => compararAgrupacion(ctx.agrupaciones.get(x), ctx.agrupaciones.get(y)))
        .map(([agrupacionId, relevantes]) => ({
          agrupacion_marca_id: agrupacionId,
          agrupacion: agrupacionNombre(agrupacionId),
          relevantes: relevantes.sort((a, b) => compararNombre(a.marca, b.marca)),
        })),
    }));

  const aBarrido = (u: UnidadFlujoEspecial) => {
    const marca = ctx.marcasPorId.get(u.marca_id);
    return marca
      ? [
          {
            efectiva: modalidadEfectiva(marca),
            fila: {
              marca_id: marca.id,
              marca: marca.nombre,
              agrupacion_marca_id: u.agrupacion_marca_id,
              agrupacion: agrupacionNombre(u.agrupacion_marca_id),
              miembros: miembrosEfectivos(marca.id),
            },
          },
        ]
      : [];
  };
  const filasBarrido = flujo.unidades.filter((u) => u.modalidad === "barrido").flatMap(aBarrido);
  const barrido = filasBarrido.filter((b) => b.efectiva !== "mixta").map((b) => b.fila).sort((a, b) => compararNombre(a.marca, b.marca));
  const nodosPorMixta = new Map<string, { genero_mundo_linea_id: string }[]>();
  for (const u of flujo.unidades) {
    if (u.modalidad !== "por_gml" || !u.genero_mundo_linea_id) continue;
    const marca = ctx.marcasPorId.get(u.marca_id);
    if (!marca || modalidadEfectiva(marca) !== "mixta") continue;
    const lista = nodosPorMixta.get(u.marca_id) ?? [];
    lista.push({ genero_mundo_linea_id: u.genero_mundo_linea_id });
    nodosPorMixta.set(u.marca_id, lista);
  }
  const mixtas: MixtaVigente[] = filasBarrido
    .filter((b) => b.efectiva === "mixta")
    .map((b) => ({
      ...b.fila,
      gml_especificos: (nodosPorMixta.get(b.fila.marca_id) ?? []).sort((x, y) =>
        x.genero_mundo_linea_id < y.genero_mundo_linea_id ? -1 : x.genero_mundo_linea_id > y.genero_mundo_linea_id ? 1 : 0
      ),
    }))
    .sort((a, b) => compararNombre(a.marca, b.marca));

  const unidades = estado.marcas
    .flatMap((m) => {
      const u = ctx.unidades.get(m.id);
      return u?.en_conjunto ? [{ marca_id: m.id, unidad_marca_id: u.unidad_marca_id }] : [];
    })
    .sort((a, b) => (a.marca_id < b.marca_id ? -1 : a.marca_id > b.marca_id ? 1 : 0));

  const pendientes: PendienteVigente[] = flujo.pendientes
    .map((p) => ({ marca_id: p.marca_id, marca: p.marca, motivo: p.motivo }))
    .sort((a, b) => compararNombre(a.marca, b.marca));

  const nodos_gmle = [...estado.nodos.values()].filter((n) => n.vigente && n.nivel_planificacion === "GMLE").length;

  return { gml, barrido, mixtas, unidades, pendientes, nodos_gmle, calculado_at: calculadoAt };
}
