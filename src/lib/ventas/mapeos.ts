import { normalizarNombre } from "@/lib/arbol/normalizar";
import type { EstadoImportacion } from "@/lib/arbol/importar";
import { crearIndiceDestinos, crearResolutorCombinaciones, textoDestino, type IndiceDestinos } from "./resolver";
import { claveOrigen, comodinInvalido, describirOrigen, esComodinOrigen, normalizarOrigen, ternaVacia } from "./origen-mapeo";
import type {
  CrearMapeoItem,
  EstadoMapeo,
  FilaMapeoCsv,
  ImportarMapeosRespuesta,
  MapeoApi,
  MapeosRespuesta,
  MotivoMapeable,
  MotivoOmisionMapeo,
  OrigenMapeo,
} from "./tipos-mapeo";

/**
 * Lógica pura de los mapeos persistentes (mejora M5b, docs/modulos/05b-
 * mapeo-combinaciones.md): estado de cada mapeo, planificación del alta
 * (`POST /api/ventas/mapeos`) y de la importación (`/importar`). Sin base ni
 * `@supabase/*`: los handlers leen, llaman a estas funciones y escriben el plan.
 */

export const MAX_NOTA_MAPEO = 200;

/** Los once motivos que un mapeo puede reasignar. */
export const MOTIVOS_MAPEABLES = [
  "genero_desconocido",
  "mundo_desconocido",
  "linea_desconocida",
  "nodo_inexistente",
  "equivalencia_inexistente",
  "genero_inactivo",
  "mundo_inactivo",
  "linea_inactiva",
  "nodo_inactivo",
  "equivalencia_inactiva",
  "clasificacion_incompleta",
] as const satisfies readonly MotivoMapeable[];

export function esMotivoMapeable(valor: unknown): valor is MotivoMapeable {
  return typeof valor === "string" && (MOTIVOS_MAPEABLES as readonly string[]).includes(valor);
}

export const ESTADOS_MAPEO: readonly EstadoMapeo[] = ["vigente", "inactivo", "obsoleto", "destino_inactivo"];

export function esEstadoMapeo(valor: unknown): valor is EstadoMapeo {
  return typeof valor === "string" && (ESTADOS_MAPEO as readonly string[]).includes(valor);
}

// ─── Filas de la base ───

/** Fila de la tabla de mapeos (las columnas que usa la lógica pura). */
export type MapeoFila = {
  id: string;
  origen_genero: string;
  origen_mundo: string;
  origen_linea: string;
  origen_equivalencia: string;
  equivalencia_id: string;
  motivo_origen: string | null;
  nota: string | null;
  perfil_id: string | null;
  usuario_nombre: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
};

export const origenDeFila = (f: Pick<MapeoFila, "origen_genero" | "origen_mundo" | "origen_linea" | "origen_equivalencia">): OrigenMapeo => ({
  genero: f.origen_genero,
  mundo: f.origen_mundo,
  linea: f.origen_linea,
  equivalencia: f.origen_equivalencia,
});

/** Columnas de origen de una fila a partir de un origen ya normalizado. */
export const columnasDeOrigen = (o: OrigenMapeo) => ({
  origen_genero: o.genero,
  origen_mundo: o.mundo,
  origen_linea: o.linea,
  origen_equivalencia: o.equivalencia,
});

// ─── Estado ───

export type EvaluadorMapeos = IndiceDestinos & {
  /** `inactivo` → `obsoleto` → `destino_inactivo` → `vigente`, en ese orden. */
  estado(m: { activo: boolean; origen: OrigenMapeo; equivalencia_id: string }): EstadoMapeo;
  aApi(f: MapeoFila): MapeoApi;
};

const DESTINO_DESCONOCIDO = (id: string) => ({
  equivalencia_id: id,
  genero: "",
  mundo: "",
  linea: "",
  equivalencia: "",
  es_generica: false,
  vigente: false,
});

/**
 * Evaluador reutilizable (los índices del árbol se arman una vez). Un origen con
 * comodín `*` nunca es obsoleto: sigue sirviendo para cualquier equivalencia de la
 * terna que no resuelva. Los demás son obsoletos si hoy resuelven `ok` en el árbol
 * (sin mapeos).
 */
export function crearEvaluadorMapeos(estado: EstadoImportacion): EvaluadorMapeos {
  const resolver = crearResolutorCombinaciones(estado);
  const destinos = crearIndiceDestinos(estado);

  const estadoDe = (m: { activo: boolean; origen: OrigenMapeo; equivalencia_id: string }): EstadoMapeo => {
    if (!m.activo) return "inactivo";
    const origen = normalizarOrigen(m.origen);
    if (!esComodinOrigen(origen) && resolver(origen).resultado === "ok") return "obsoleto";
    if (!destinos.vigente(m.equivalencia_id)) return "destino_inactivo";
    return "vigente";
  };

  return {
    ...destinos,
    estado: estadoDe,
    aApi: (f) => {
      const origen = origenDeFila(f);
      return {
        id: f.id,
        origen,
        destino: destinos.describir(f.equivalencia_id) ?? DESTINO_DESCONOCIDO(f.equivalencia_id),
        motivo_origen: esMotivoMapeable(f.motivo_origen) ? f.motivo_origen : null,
        nota: f.nota,
        usuario_nombre: f.usuario_nombre,
        activo: f.activo,
        estado: estadoDe({ activo: f.activo, origen, equivalencia_id: f.equivalencia_id }),
        created_at: f.created_at,
        updated_at: f.updated_at,
      };
    },
  };
}

/** Regla 12: `inactivo` si `!activo`; `obsoleto` si el origen resuelve `ok`; `destino_inactivo` si el destino no es vigente; si no, `vigente`. */
export function estadoMapeo(
  m: { activo: boolean; origen: OrigenMapeo; equivalencia_id: string },
  estado: EstadoImportacion
): EstadoMapeo {
  return crearEvaluadorMapeos(estado).estado(m);
}

export function resumirEstados(mapeos: readonly Pick<MapeoApi, "estado">[]): MapeosRespuesta["resumen"] {
  const resumen: MapeosRespuesta["resumen"] = { vigente: 0, inactivo: 0, obsoleto: 0, destino_inactivo: 0 };
  for (const m of mapeos) resumen[m.estado] += 1;
  return resumen;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** `q`: texto sobre el origen, el destino y la nota (sin tildes ni mayúsculas); `estado`: uno de los cuatro. */
export function filtrarMapeos(mapeos: readonly MapeoApi[], q: string | null, estado: EstadoMapeo | null): MapeoApi[] {
  const buscado = sinTildes(normalizarNombre(q ?? ""));
  return mapeos.filter((m) => {
    if (estado !== null && m.estado !== estado) return false;
    if (buscado === "") return true;
    const heno = sinTildes(
      normalizarNombre(
        [
          m.origen.genero,
          m.origen.mundo,
          m.origen.linea,
          m.origen.equivalencia,
          m.destino.genero,
          m.destino.mundo,
          m.destino.linea,
          m.destino.equivalencia,
          m.nota ?? "",
        ].join(" ")
      )
    );
    return heno.includes(buscado);
  });
}

// ─── Alta (POST /api/ventas/mapeos) ───

export type NuevoMapeo = {
  origen: OrigenMapeo;
  equivalencia_id: string;
  motivo_origen: MotivoMapeable | null;
  nota: string | null;
};

export type ActualizarMapeo = NuevoMapeo & {
  id: string;
  perfil_id: string | null;
  usuario_nombre: string | null;
};

export type CodigoErrorMapeos =
  | "origen_sin_clasificar"
  | "origen_con_comodin_invalido"
  | "origen_repetido_en_peticion"
  | "destino_no_existe"
  | "destino_inactivo"
  | "origen_existe_en_arbol"
  | "origen_repetido";

export type ErrorPlanMapeos = { status: 400 | 404 | 409; codigo: CodigoErrorMapeos; mensaje: string; indice: number };

export type PlanCrearMapeos =
  | { error: ErrorPlanMapeos }
  | { error: null; crear: NuevoMapeo[]; actualizar: ActualizarMapeo[]; sinCambio: number };

/** `nota` en blanco → `null`; recortada de espacios. */
export function normalizarNota(nota: string | null | undefined): string | null {
  if (nota === null || nota === undefined) return null;
  const n = nota.trim();
  return n === "" ? null : n;
}

/**
 * Regla 10. Valida la lista ENTERA antes de que el handler escriba nada (todo o
 * nada): origen con los tres de la terna en blanco → `400`; dos items con el
 * mismo origen → `400`; destino inexistente → `404`; destino no vigente → `409
 * destino_inactivo`; origen que hoy resuelve `ok` en el árbol → `409
 * origen_existe_en_arbol` (el comodín `*` no se mira); origen que ya tiene
 * mapeo con otro destino sin `reemplazar` → `409 origen_repetido`. Con
 * `reemplazar` se actualiza destino y nota (la nota se conserva si no viene) y
 * se reactiva. Mismo destino: `sin_cambio`, salvo que el mapeo esté inactivo
 * (se reactiva) o que `reemplazar` traiga otra nota.
 */
export function planificarCrearMapeos(
  items: readonly CrearMapeoItem[],
  estado: EstadoImportacion,
  existentes: readonly MapeoFila[],
  opciones: { reemplazar?: boolean } = {}
): PlanCrearMapeos {
  const reemplazar = opciones.reemplazar ?? false;
  const resolver = crearResolutorCombinaciones(estado);
  const destinos = crearIndiceDestinos(estado);
  const porOrigen = new Map(existentes.map((e) => [claveOrigen(normalizarOrigen(origenDeFila(e))), e]));

  const vistos = new Set<string>();
  const crear: NuevoMapeo[] = [];
  const actualizar: ActualizarMapeo[] = [];
  let sinCambio = 0;

  for (let indice = 0; indice < items.length; indice++) {
    const item = items[indice];
    const origen = normalizarOrigen(item.origen);
    const texto = describirOrigen(origen);
    const fallo = (status: ErrorPlanMapeos["status"], codigo: CodigoErrorMapeos, mensaje: string): PlanCrearMapeos => ({
      error: { status, codigo, mensaje, indice },
    });

    if (ternaVacia(origen)) {
      return fallo(
        400,
        "origen_sin_clasificar",
        "Un origen necesita al menos género, mundo o línea: las filas sin ninguna de las tres no se pueden asignar."
      );
    }
    if (comodinInvalido(origen)) {
      return fallo(400, "origen_con_comodin_invalido", `El origen «${texto}» usa un comodín mal puesto: «*» solo vale solo, en la equivalencia.`);
    }
    const clave = claveOrigen(origen);
    if (vistos.has(clave)) return fallo(400, "origen_repetido_en_peticion", `El origen «${texto}» está repetido en la petición.`);
    vistos.add(clave);

    const destino = destinos.describir(item.equivalencia_id);
    if (!destino) return fallo(404, "destino_no_existe", "La equivalencia de destino no existe.");
    if (!destino.vigente) {
      return fallo(409, "destino_inactivo", `El destino «${textoDestino(destino)}» está desactivado: elige otro.`);
    }

    if (!esComodinOrigen(origen) && resolver(origen).resultado === "ok") {
      return fallo(409, "origen_existe_en_arbol", `«${texto}» ya existe en el árbol: no hace falta un mapeo.`);
    }

    const nota = item.nota === undefined ? undefined : normalizarNota(item.nota);
    const motivo = item.motivo_origen ?? derivarMotivo(origen, resolver);
    const previo = porOrigen.get(clave);

    if (!previo) {
      crear.push({ origen, equivalencia_id: item.equivalencia_id, motivo_origen: motivo, nota: nota ?? null });
      continue;
    }

    const mismoDestino = previo.equivalencia_id === item.equivalencia_id;
    if (!mismoDestino && !reemplazar) {
      const actual = destinos.describir(previo.equivalencia_id);
      return fallo(
        409,
        "origen_repetido",
        `«${texto}» ya tiene un mapeo${actual ? ` hacia «${textoDestino(actual)}»` : ""}. Confirma el reemplazo para cambiarlo.`
      );
    }
    const notaFinal = nota === undefined ? previo.nota : nota;
    const cambiaNota = reemplazar && nota !== undefined && nota !== previo.nota;
    if (mismoDestino && previo.activo && !cambiaNota) {
      sinCambio += 1;
      continue;
    }
    actualizar.push({
      id: previo.id,
      origen,
      equivalencia_id: item.equivalencia_id,
      motivo_origen: item.motivo_origen ?? (esMotivoMapeable(previo.motivo_origen) ? previo.motivo_origen : motivo),
      nota: notaFinal,
      perfil_id: previo.perfil_id,
      usuario_nombre: previo.usuario_nombre,
    });
  }

  return { error: null, crear, actualizar, sinCambio };
}

/** El motivo con el que fallaría hoy el origen (null con comodín o si resolviera ok). */
function derivarMotivo(origen: OrigenMapeo, resolver: ReturnType<typeof crearResolutorCombinaciones>): MotivoMapeable | null {
  if (esComodinOrigen(origen)) return null;
  const r = resolver(origen);
  return r.resultado === "ok" ? null : r.resultado;
}

// ─── Importación (POST /api/ventas/mapeos/importar) ───

export type PlanImportacionMapeos = {
  recibidas: number;
  /** Mapeos a crear (los que pasaron todas las comprobaciones). */
  crear: NuevoMapeo[];
  omitidas: ImportarMapeosRespuesta["omitidas"];
};

const texto = (v: string | undefined | null) => (typeof v === "string" ? v : "");

/**
 * Regla 11. Por fila: origen con las reglas del archivo (`ORIGEN_EQUIVALENCIA`
 * vacío → `SIN EQUIVALENCIA`, `-` → nombre de `ORIGEN_LINEA`, `*` se conserva);
 * destino resuelto con el resolutor del árbol SIN mapeos. Omite con motivo, en
 * este orden: `origen_sin_clasificar`, `origen_con_comodin_invalido` (`*` en
 * género, mundo o línea, o mezclado con texto en la equivalencia: lo mismo que
 * rechaza el POST), `origen_existe_en_arbol`,
 * `origen_repetido_en_archivo`, `destino_no_resuelve`, `destino_inactivo`, y
 * contra lo ya guardado `existente_igual` / `existente_distinto` (no se
 * actualiza, criterio de M2). Reimportar el mismo archivo crea 0.
 */
export function planificarImportacionMapeos(
  filas: readonly FilaMapeoCsv[],
  estado: EstadoImportacion,
  existentes: readonly MapeoFila[]
): PlanImportacionMapeos {
  const resolver = crearResolutorCombinaciones(estado);
  const porOrigen = new Map(existentes.map((e) => [claveOrigen(normalizarOrigen(origenDeFila(e))), e]));
  const vistos = new Set<string>();
  const crear: NuevoMapeo[] = [];
  const omitidas: PlanImportacionMapeos["omitidas"] = [];

  filas.forEach((f, i) => {
    const fila = i + 1;
    const omitir = (motivo: MotivoOmisionMapeo, detalle: string) => omitidas.push({ motivo, fila, detalle });

    const origen = normalizarOrigen({
      genero: texto(f.ORIGEN_GENERO),
      mundo: texto(f.ORIGEN_MUNDO),
      linea: texto(f.ORIGEN_LINEA),
      equivalencia: texto(f.ORIGEN_EQUIVALENCIA),
    });
    const textoOrigen = describirOrigen(origen);
    if (ternaVacia(origen)) return omitir("origen_sin_clasificar", "Género, mundo y línea en blanco");
    if (comodinInvalido(origen)) return omitir("origen_con_comodin_invalido", textoOrigen);

    if (!esComodinOrigen(origen) && resolver(origen).resultado === "ok") return omitir("origen_existe_en_arbol", textoOrigen);

    const clave = claveOrigen(origen);
    if (vistos.has(clave)) return omitir("origen_repetido_en_archivo", textoOrigen);
    vistos.add(clave);

    const destinoTxt = `${texto(f.DESTINO_GENERO)} / ${texto(f.DESTINO_MUNDO)} / ${texto(f.DESTINO_LINEA)} / ${texto(f.DESTINO_EQUIVALENCIA)}`;
    const r = resolver({
      genero: texto(f.DESTINO_GENERO),
      mundo: texto(f.DESTINO_MUNDO),
      linea: texto(f.DESTINO_LINEA),
      equivalencia: texto(f.DESTINO_EQUIVALENCIA),
    });
    if (r.resultado !== "ok") {
      const inactivo = r.resultado.endsWith("_inactivo") || r.resultado.endsWith("_inactiva");
      return omitir(inactivo ? "destino_inactivo" : "destino_no_resuelve", `${textoOrigen} → ${destinoTxt.trim()}`);
    }

    const previo = porOrigen.get(clave);
    if (previo) {
      return omitir(previo.equivalencia_id === r.equivalencia_id ? "existente_igual" : "existente_distinto", textoOrigen);
    }

    const nota = normalizarNota(f.NOTA);
    crear.push({
      origen,
      equivalencia_id: r.equivalencia_id,
      motivo_origen: derivarMotivo(origen, resolver),
      nota: nota === null ? null : nota.slice(0, MAX_NOTA_MAPEO),
    });
  });

  return { recibidas: filas.length, crear, omitidas };
}
