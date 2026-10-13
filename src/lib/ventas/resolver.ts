import type { Tables } from "@/lib/supabase/database.types";
import { aCodigo, esEquivalenciaGenerica, esEquivalenciaIgualALinea, normalizarNombre } from "@/lib/arbol/normalizar";
import { codigoUnico, type EstadoImportacion } from "@/lib/arbol/importar";
import type { AgrupacionMarcaEstado, MarcaEstado, MarcaNueva } from "@/lib/marcas/importar";
import { motivoRechazoAgrupacionDestino } from "@/lib/marcas/reglas";
import { esTipoTienda } from "@/lib/tiendas/estado";
import type { UbicacionesIgnoradasIndice } from "@/lib/tiendas/ubicaciones";
import { esComodin } from "./interpretar";
import { claveOrigen, claveTerna, esComodinOrigen, normalizarOrigen, ternaVacia, vacioLegible } from "./origen-mapeo";
import type { DestinoMapeo, MapeoNoAplicableApi, OrigenMapeo } from "./tipos-mapeo";
import {
  AGRUPACION_COMODINES,
  FILAS_POSIBLE_TIPEO,
  type MarcaNuevaInforme,
} from "./tipos";
import type {
  CombinacionPeticion,
  PrevisualizarRespuesta,
  ResolucionCombinacionApi,
  ResolucionMarcaApi,
  ResolucionTiendaApi,
} from "./tipos-api";

/**
 * Resolución de los valores distintos del archivo contra los maestros
 * (docs/modulos/05-venta-stock.md, reglas 28–30). Funciones puras: el
 * servidor las llama con el estado leído de la base (`previsualizar`) y los
 * tests con estados fabricados. La equivalencia usa las funciones del árbol
 * (`esEquivalenciaGenerica`, `esEquivalenciaIgualALinea`), sin reescribirlas.
 */

// ─── Tiendas ───

export type TiendaResolvible = Pick<
  Tables<"tiendas">,
  "id" | "codigo" | "nombre" | "tipo" | "fecha_apertura" | "fecha_cierre" | "activo"
>;

/**
 * Ubicaciones ignoradas (M5c): nombre normalizado → `{ id, nota }` de la fila de
 * `ubicaciones_ignoradas`. `indiceUbicacionesIgnoradas` (src/lib/tiendas/ubicaciones.ts)
 * lo arma desde las filas de la base.
 */
export type TiendasIgnoradas = UbicacionesIgnoradasIndice;

/**
 * Regla 28 (M5c). Orden: tienda por nombre normalizado (es lo que trae
 * QlikView) → tienda por código → ubicación ignorada → desconocida. Un valor
 * que coincida por nombre con una tienda y por código con otra se resuelve a
 * favor del nombre. La tienda manda: si existe (activa o no) gana a la lista de
 * ignoradas. `inactiva` se distingue de `desconocida`.
 */
export function crearResolutorTiendas(
  tiendas: readonly TiendaResolvible[],
  ignoradas: TiendasIgnoradas = new Map()
): (valor: string) => ResolucionTiendaApi {
  const porNombre = new Map<string, TiendaResolvible>();
  const porCodigo = new Map<string, TiendaResolvible>();
  for (const t of tiendas) {
    porNombre.set(normalizarNombre(t.nombre), t);
    const c = aCodigo(t.codigo);
    if (c !== "") porCodigo.set(c, t);
  }

  return (valor: string): ResolucionTiendaApi => {
    const nombre = normalizarNombre(valor);
    const codigo = aCodigo(valor);
    const t = porNombre.get(nombre) ?? (codigo !== "" ? porCodigo.get(codigo) : undefined);
    if (!t) {
      const ig = ignoradas.get(nombre);
      return ig !== undefined
        ? { valor: nombre, resultado: "ignorada", id: ig.id, nota: ig.nota }
        : { valor: nombre, resultado: "desconocida" };
    }
    if (!t.activo) return { valor: nombre, resultado: "inactiva" };
    return {
      valor: nombre,
      resultado: "ok",
      id: t.id,
      codigo: t.codigo,
      tipo: esTipoTienda(t.tipo) ? t.tipo : "Tienda",
      fecha_apertura: t.fecha_apertura,
      fecha_cierre: t.fecha_cierre,
    };
  };
}

export function resolverTienda(
  valor: string,
  tiendas: readonly TiendaResolvible[],
  ignoradas: TiendasIgnoradas = new Map()
): ResolucionTiendaApi {
  return crearResolutorTiendas(tiendas, ignoradas)(valor);
}

/**
 * Regla 7 de M5c: marca `valor` como ubicación ignorada en una respuesta de
 * `previsualizar` SIN volver a llamar al servidor. Cambia solo la posición de
 * ese valor en `tiendas` de `desconocida` a `ignorada` (la tienda manda: un valor
 * `ok` o `inactiva` no se toca). Devuelve una respuesta nueva; la original no
 * se modifica. Idempotente: aplicarla dos veces da lo mismo, y si el valor ya
 * estaba ignorada se actualizan `id` y `nota`. Con el resultado, el hook vuelve a
 * ejecutar `construirInforme` sobre el mismo acumulador.
 */
export function marcarIgnorada(
  respuesta: PrevisualizarRespuesta,
  valor: string,
  id: string,
  nota: string | null
): PrevisualizarRespuesta {
  const nombre = normalizarNombre(valor);
  return {
    ...respuesta,
    tiendas: respuesta.tiendas.map((t) =>
      t.valor === nombre && (t.resultado === "desconocida" || t.resultado === "ignorada")
        ? { valor: nombre, resultado: "ignorada" as const, id, nota }
        : t
    ),
  };
}

// ─── Combinaciones ───

type Catalogo = { id: string; codigo: string; nombre: string; activo: boolean };

function buscarActivoOInactivo(catalogo: readonly Catalogo[], valor: string): { item: Catalogo; activo: boolean } | null {
  const nombre = normalizarNombre(valor);
  const codigo = aCodigo(valor);
  if (nombre === "") return null;
  const coincide = (c: Catalogo) =>
    (codigo !== "" && c.codigo.toUpperCase() === codigo) || normalizarNombre(c.nombre) === nombre;
  const activo = catalogo.find((c) => c.activo && coincide(c));
  if (activo) return { item: activo, activo: true };
  const cualquiera = catalogo.find(coincide);
  return cualquiera ? { item: cualquiera, activo: false } : null;
}

/** Un mapeo tal como lo consume el resolutor (solo se aplican los `activo`). */
export type MapeoResolvible = { id: string; origen: OrigenMapeo; equivalencia_id: string; activo: boolean };

/** Destinos posibles de un mapeo: qué equivalencia es y si hoy es vigente (M1: `nodoVigente` y su cadena). */
export type IndiceDestinos = {
  /** Equivalencia activa en un nodo vigente (nodo, línea, género y mundo activos). */
  vigente(equivalenciaId: string): boolean;
  /** `null` si la equivalencia ya no existe. */
  describir(equivalenciaId: string): DestinoMapeo | null;
};

export function crearIndiceDestinos(estado: EstadoImportacion): IndiceDestinos {
  const generos = new Map(estado.generos.map((g) => [g.id, g]));
  const mundos = new Map(estado.mundos.map((m) => [m.id, m]));
  const lineas = new Map(estado.lineas.map((l) => [l.id, l]));
  const nodos = new Map(estado.nodos.map((n) => [n.id, n]));
  const equivalencias = new Map(estado.equivalencias.map((e) => [e.id, e]));

  const describir = (id: string): DestinoMapeo | null => {
    const eq = equivalencias.get(id);
    if (!eq) return null;
    const nodo = nodos.get(eq.genero_mundo_linea_id);
    const genero = nodo ? generos.get(nodo.genero_id) : undefined;
    const mundo = nodo ? mundos.get(nodo.mundo_id) : undefined;
    const linea = nodo ? lineas.get(nodo.linea_id) : undefined;
    return {
      equivalencia_id: eq.id,
      genero: genero?.nombre ?? "",
      mundo: mundo?.nombre ?? "",
      linea: linea?.nombre ?? "",
      equivalencia: eq.nombre,
      es_generica: eq.es_generica,
      vigente: Boolean(eq.activo && nodo?.activo && genero?.activo && mundo?.activo && linea?.activo),
    };
  };
  return { vigente: (id) => describir(id)?.vigente ?? false, describir };
}

export const textoDestino = (d: Pick<DestinoMapeo, "genero" | "mundo" | "linea" | "equivalencia">): string =>
  `${d.genero} / ${d.mundo} / ${d.linea} / ${d.equivalencia}`;

/**
 * Resolutor de combinaciones. Recibe el estado del árbol y, opcionalmente, los
 * mapeos. `mapeosNoAplicables()` lista (una vez por mapeo y en el orden en que
 * aparecieron) los mapeos activos que se cruzaron con una combinación pero cuyo
 * destino no es vigente.
 */
export type ResolutorCombinaciones = ((c: CombinacionPeticion) => ResolucionCombinacionApi) & {
  mapeosNoAplicables(): MapeoNoAplicableApi[];
};

/**
 * Regla 29. Orden género → mundo → línea → nodo → equivalencia. `-` y vacío
 * con las funciones del árbol (la genérica se resuelve por `es_generica`
 * aunque su nombre cambiara). Inactivos → motivo informativo; inexistentes →
 * motivo de error con su detalle. Una combinación cuyo nodo existe pero no la
 * equivalencia es `equivalencia_inexistente`, no `nodo_inexistente`.
 *
 * M5b. Antes del género, uno o dos de género, mundo y línea en blanco dan
 * `clasificacion_incompleta` (con los tres en blanco, `sin_clasificar` ya se
 * decidió al interpretar la fila). El árbol manda: solo si no resuelve `ok`
 * se consulta el mapeo, exacto antes que comodín (`*` en la equivalencia,
 * terna completa). Nunca se encadena: el destino es un id del árbol. Si el
 * mapeo activo elegido apunta a un destino no vigente, no se aplica (la fila
 * conserva su motivo) y se anota para `mapeosNoAplicables()`; no se prueba
 * entonces el comodín. Un mapeo inactivo se ignora.
 */
export function crearResolutorCombinaciones(
  estado: EstadoImportacion,
  mapeos: readonly MapeoResolvible[] = []
): ResolutorCombinaciones {
  const lineasPorNombre = new Map(estado.lineas.map((l) => [normalizarNombre(l.nombre), l]));
  const nodos = new Map(estado.nodos.map((n) => [`${n.genero_id}|${n.mundo_id}|${n.linea_id}`, n]));
  const porNodo = new Map<string, { porNombre: Map<string, (typeof estado.equivalencias)[number]>; generica: (typeof estado.equivalencias)[number] | null }>();
  for (const e of estado.equivalencias) {
    let g = porNodo.get(e.genero_mundo_linea_id);
    if (!g) {
      g = { porNombre: new Map(), generica: null };
      porNodo.set(e.genero_mundo_linea_id, g);
    }
    g.porNombre.set(normalizarNombre(e.nombre), e);
    if (e.es_generica) g.generica = e;
  }

  // Índices de mapeos activos: exacto por origen completo, comodín por terna.
  const exactos = new Map<string, MapeoResolvible>();
  const comodines = new Map<string, MapeoResolvible>();
  for (const m of mapeos) {
    if (!m.activo) continue;
    const origen = normalizarOrigen(m.origen);
    if (ternaVacia(origen)) continue;
    const indice = esComodinOrigen(origen) ? comodines : exactos;
    const clave = esComodinOrigen(origen) ? claveTerna(origen) : claveOrigen(origen);
    if (!indice.has(clave)) indice.set(clave, { ...m, origen });
  }
  const hayMapeos = exactos.size > 0 || comodines.size > 0;
  const destinos = hayMapeos ? crearIndiceDestinos(estado) : null;
  const noAplicables = new Map<string, MapeoNoAplicableApi>();

  const resolverArbol = (c: CombinacionPeticion): ResolucionCombinacionApi => {
    const generoTxt = normalizarNombre(c.genero);
    const mundoTxt = normalizarNombre(c.mundo);
    const lineaTxt = normalizarNombre(c.linea);

    const enBlanco = [generoTxt, mundoTxt, lineaTxt].filter((v) => v === "").length;
    if (enBlanco === 1 || enBlanco === 2) {
      return { resultado: "clasificacion_incompleta", detalle: `${vacioLegible(generoTxt)} / ${vacioLegible(mundoTxt)} / ${vacioLegible(lineaTxt)}` };
    }

    const genero = buscarActivoOInactivo(estado.generos, generoTxt);
    if (!genero) return { resultado: "genero_desconocido", detalle: generoTxt };
    if (!genero.activo) return { resultado: "genero_inactivo", detalle: generoTxt };

    const mundo = buscarActivoOInactivo(estado.mundos, mundoTxt);
    if (!mundo) return { resultado: "mundo_desconocido", detalle: mundoTxt };
    if (!mundo.activo) return { resultado: "mundo_inactivo", detalle: mundoTxt };

    const linea = lineasPorNombre.get(lineaTxt);
    if (!linea) return { resultado: "linea_desconocida", detalle: lineaTxt };
    if (!linea.activo) return { resultado: "linea_inactiva", detalle: lineaTxt };

    const terna = `${generoTxt} / ${mundoTxt} / ${lineaTxt}`;
    const nodo = nodos.get(`${genero.item.id}|${mundo.item.id}|${linea.id}`);
    if (!nodo) return { resultado: "nodo_inexistente", detalle: terna };
    if (!nodo.activo) return { resultado: "nodo_inactivo", detalle: terna };

    const equivalenciaTxt = normalizarNombre(c.equivalencia);
    const eqs = porNodo.get(nodo.id);
    const nombreEq = esEquivalenciaIgualALinea(equivalenciaTxt) ? lineaTxt : equivalenciaTxt;
    const eq = esEquivalenciaGenerica(equivalenciaTxt)
      ? (eqs?.generica ?? eqs?.porNombre.get(normalizarNombre("SIN EQUIVALENCIA")))
      : eqs?.porNombre.get(nombreEq);
    const detalleEq = `${terna} / ${esEquivalenciaGenerica(equivalenciaTxt) ? "SIN EQUIVALENCIA" : nombreEq}`;
    if (!eq) return { resultado: "equivalencia_inexistente", detalle: detalleEq };
    if (!eq.activo) return { resultado: "equivalencia_inactiva", detalle: detalleEq };
    return { resultado: "ok", equivalencia_id: eq.id };
  };

  const resolutor = (c: CombinacionPeticion): ResolucionCombinacionApi => {
    const base = resolverArbol(c);
    if (base.resultado === "ok" || !destinos) return base;

    const origen = normalizarOrigen(c);
    if (ternaVacia(origen)) return base;
    const mapeo = exactos.get(claveOrigen(origen)) ?? comodines.get(claveTerna(origen));
    if (!mapeo) return base;

    const destino = destinos.describir(mapeo.equivalencia_id);
    if (!destino || !destino.vigente) {
      if (!noAplicables.has(mapeo.id)) {
        noAplicables.set(mapeo.id, {
          id: mapeo.id,
          origen: mapeo.origen,
          motivo: "destino_inactivo",
          ...(destino ? { destino: textoDestino(destino) } : {}),
        });
      }
      return { ...base, mapeo_no_aplicable: mapeo.id };
    }
    return {
      resultado: "ok",
      equivalencia_id: mapeo.equivalencia_id,
      mapeo: { id: mapeo.id, motivo_original: base.resultado, destino: textoDestino(destino) },
    };
  };

  return Object.assign(resolutor, { mapeosNoAplicables: () => [...noAplicables.values()] });
}

export function resolverCombinacion(
  c: CombinacionPeticion,
  estado: EstadoImportacion,
  mapeos: readonly MapeoResolvible[] = []
): ResolucionCombinacionApi {
  return crearResolutorCombinaciones(estado, mapeos)(c);
}

// ─── Marcas ───

/** `true` si `a` y `b` difieren en exactamente una inserción, borrado o sustitución. */
export function distanciaEdicionUno(a: string, b: string): boolean {
  if (a === b) return false;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) return a.slice(i + 1) === b.slice(i + 1);
  if (la < lb) return a.slice(i) === b.slice(i + 1);
  return a.slice(i + 1) === b.slice(i);
}

export type MarcaResolvible = Pick<MarcaEstado, "id" | "nombre" | "agrupacion_marca_id" | "activo">;

/**
 * Regla 30 (resolución). Existente activa → `existe`; desactivada → `inactiva`
 * (informativa); desconocida → `nueva`, con `comodin` y la existente más
 * parecida (misma `aCodigo` o distancia de edición 1) para el resalte de posible
 * error de tipeo.
 */
export function crearResolutorMarcas(marcas: readonly MarcaResolvible[]): (valor: string) => ResolucionMarcaApi {
  const porNombre = new Map<string, MarcaResolvible>();
  const porCodigo = new Map<string, string>();
  const nombres: string[] = [];
  for (const m of marcas) {
    const n = normalizarNombre(m.nombre);
    porNombre.set(n, m);
    nombres.push(n);
    const c = aCodigo(n);
    if (c !== "" && !porCodigo.has(c)) porCodigo.set(c, n);
  }

  return (valor: string): ResolucionMarcaApi => {
    const nombre = normalizarNombre(valor);
    const m = porNombre.get(nombre);
    if (m) {
      return m.activo
        ? { resultado: "existe", id: m.id, agrupacion_marca_id: m.agrupacion_marca_id }
        : { resultado: "inactiva", id: m.id };
    }
    const comodin = esComodin(nombre);
    let parecida: string | null = null;
    if (!comodin) {
      const c = aCodigo(nombre);
      parecida = (c !== "" ? porCodigo.get(c) : undefined) ?? nombres.find((n) => distanciaEdicionUno(nombre, n)) ?? null;
    }
    return { resultado: "nueva", comodin, parecida };
  };
}

export function resolverMarca(valor: string, marcas: readonly MarcaResolvible[]): ResolucionMarcaApi {
  return crearResolutorMarcas(marcas)(valor);
}

// ─── Alta de marcas nuevas (servidor, `marcas-nuevas`) ───

export type PlanAltaMarcas =
  | {
      error: null;
      /** Marcas a crear (nombre ya normalizado, código único, `tratamiento_especial = false`). */
      crear: MarcaNueva[];
      /** Nombres pedidos que ya existían. */
      existentes: number;
      /** Comodines entre las que se crean (van a MID VALUE). */
      comodines: string[];
    }
  | { error: { status: 404 | 409; mensaje: string } };

export const MENSAJE_MID_VALUE =
  "Crea o reactiva MID VALUE: VARIOS, OTROS y SIN MARCA van ahí.";

/** MID VALUE por código o nombre (activa o no), o `undefined`. */
export function buscarMidValue(agrupaciones: readonly AgrupacionMarcaEstado[]): AgrupacionMarcaEstado | undefined {
  return agrupaciones.find(
    (a) => normalizarNombre(a.nombre) === AGRUPACION_COMODINES || a.codigo.toUpperCase() === "MID_VALUE"
  );
}

/** MID VALUE si existe y está activa. */
export function agrupacionPorDefecto(agrupaciones: readonly AgrupacionMarcaEstado[]): AgrupacionMarcaEstado | null {
  const a = buscarMidValue(agrupaciones);
  return a && a.activo ? a : null;
}

/**
 * Regla 30. Marcas desconocidas → `tratamiento_especial = false`, la
 * agrupación elegida y el código `codigoUnico(aCodigo(nombre), usados,
 * "MARCA")` de M2 (`MARCA'S` y `MARCA-S` dan `MARCA_S` y `MARCA_S_2`).
 * `VARIOS`, `OTROS` y `SIN MARCA` van siempre a MID VALUE, con independencia
 * de la elegida; si MID VALUE no existe o está inactiva y entra un comodín, es
 * un error de la petición y no se crea nada.
 */
export function planificarAltaMarcas(
  nombres: readonly string[],
  marcas: readonly Pick<MarcaEstado, "nombre" | "codigo">[],
  agrupaciones: readonly AgrupacionMarcaEstado[],
  agrupacionElegidaId: string
): PlanAltaMarcas {
  const elegida = agrupaciones.find((a) => a.id === agrupacionElegidaId);
  const rechazo = motivoRechazoAgrupacionDestino(elegida);
  if (rechazo) return { error: { status: elegida ? 409 : 404, mensaje: rechazo } };

  const existentes = new Set(marcas.map((m) => normalizarNombre(m.nombre)));
  const usados = new Set(marcas.map((m) => m.codigo.toUpperCase()));
  const midValue = buscarMidValue(agrupaciones);

  const vistos = new Set<string>();
  const crear: MarcaNueva[] = [];
  const comodines: string[] = [];
  let yaExistian = 0;

  for (const crudo of nombres) {
    const nombre = normalizarNombre(crudo);
    if (nombre === "" || vistos.has(nombre)) continue;
    vistos.add(nombre);
    if (existentes.has(nombre)) {
      yaExistian += 1;
      continue;
    }
    const comodin = esComodin(nombre);
    if (comodin && (!midValue || !midValue.activo)) {
      return { error: { status: 409, mensaje: MENSAJE_MID_VALUE } };
    }
    const destino = comodin ? (midValue as AgrupacionMarcaEstado) : (elegida as AgrupacionMarcaEstado);
    const codigo = codigoUnico(aCodigo(nombre), usados, "MARCA");
    usados.add(codigo);
    crear.push({ nombre, codigo, agrupacion_marca_id: destino.id, tratamiento_especial: false });
    if (comodin) comodines.push(nombre);
  }

  return { error: null, crear, existentes: yaExistian, comodines };
}

// ─── Marcas nuevas en el reporte previo (cliente) ───

export type CandidataMarcaNueva = {
  nombre: string;
  comodin: boolean;
  parecida: string | null;
  filas: number;
  venta_soles: number;
  stock_unidades: number;
  stock_valorizado: number;
};

/**
 * Regla 30. Por marca nueva: filas, venta y stock, ordenadas por venta (de la
 * mayor a la menor; desempata el nombre); marca `posible_tipeo` a las de una o
 * dos filas en todo el archivo (no comodines), con la existente más parecida
 * si la hay.
 */
export function planificarMarcasNuevas(candidatas: readonly CandidataMarcaNueva[]): MarcaNuevaInforme[] {
  return candidatas
    .map((c) => ({
      nombre: c.nombre,
      comodin: c.comodin,
      filas: c.filas,
      venta_soles: c.venta_soles,
      stock_unidades: c.stock_unidades,
      stock_valorizado: c.stock_valorizado,
      posible_tipeo: !c.comodin && c.filas <= FILAS_POSIBLE_TIPEO,
      parecida: c.parecida,
    }))
    .sort((a, b) => b.venta_soles - a.venta_soles || a.nombre.localeCompare(b.nombre, "es"));
}

/** Columnas y filas de la descarga `MARCA, AGRUPACION` para el importador de M2 (la agrupación por defecto ya puesta; los comodines van a MID VALUE). */
export function filasMarcasNuevas(
  marcas: readonly Pick<MarcaNuevaInforme, "nombre" | "comodin">[],
  agrupacionPorDefecto: string
): { campos: string[]; datos: string[][] } {
  return {
    campos: ["MARCA", "AGRUPACION"],
    datos: marcas.map((m) => [m.nombre, m.comodin ? AGRUPACION_COMODINES : agrupacionPorDefecto]),
  };
}

const celdaCsv = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Mismo contenido como texto CSV (sin BOM: `descargarCsv` lo agrega). */
export function csvMarcasNuevas(
  marcas: readonly Pick<MarcaNuevaInforme, "nombre" | "comodin">[],
  agrupacionPorDefecto: string
): string {
  const { campos, datos } = filasMarcasNuevas(marcas, agrupacionPorDefecto);
  return [campos, ...datos].map((f) => f.map(celdaCsv).join(",")).join("\r\n");
}
