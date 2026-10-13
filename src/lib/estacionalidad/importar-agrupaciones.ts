import type { Tables } from "@/lib/supabase/database.types";
import { MAX_CODIGO, MAX_NOMBRE, aCodigo, normalizarNombre } from "@/lib/arbol/normalizar";
import { buscarEnCatalogo, resolverCatalogo } from "@/lib/arbol/importar";
import { compararOrdenNombre } from "@/lib/arbol/armar-arbol";
import { MAX_DESCRIPCION } from "./esquemas";
import { TEMPORADA_NO_RECONOCIDA, leerTemporadaImportada } from "./importar";
import type {
  AgrupacionNuevaImportada,
  FilaImportacionAgrupaciones,
  FilaOmitidaAgrupaciones,
  MotivoOmisionAgrupaciones,
  ReporteImportacionAgrupaciones,
  TemporadaAgrupacion,
} from "./tipos-api";

/**
 * Importador masivo de agrupaciones de estacionalidad (carga en bloque de
 * agrupaciones NUEVAS). Dos funciones puras:
 *
 *   planificarImportacionAgrupaciones(filas, estado) → plan + reporte, sin tocar nada.
 *   aplicarPlanAgrupaciones(estado, plan)            → nuevo estado en memoria, para
 *                                                       probar idempotencia sin base.
 *
 * Solo CREA: una agrupación que ya existe (mismo nombre normalizado, o mismo
 * código cuando el archivo no trae `CODIGO` y se deriva del nombre) nunca se
 * actualiza ni se reactiva; su fila sale como `ya_existe` (informativa), así que
 * reimportar el mismo archivo da 0 creadas. Las filas con error no se crean y se
 * listan con su motivo. Los géneros se resuelven con `resolverCatalogo` (nombre o
 * código normalizado, solo activos) igual que el importador de asignaciones.
 *
 * Orden de las comprobaciones de una fila (la primera que falla manda):
 * nombre vacío → `TOTAL` → nombre largo → ya existe → nombre repetido en el
 * archivo → géneros → temporada → orden → descripción → código inválido → código
 * en uso → código repetido en el archivo. Cuando gana la primera fila de un
 * nombre o código repetido, las siguientes no cuentan: una fila rechazada no
 * reserva nada.
 *
 * `orden` vacío: el siguiente múltiplo de 10 tras el mayor `orden` actual
 * (agrupaciones existentes y filas ya aceptadas del archivo, también las que
 * traen `orden` explícito), creciente fila a fila; una fila rechazada no
 * consume número.
 */

const ORDEN_MAXIMO = 2_147_483_647; // máximo de `integer` en Postgres

export type GeneroImportacion = Pick<Tables<"generos">, "id" | "codigo" | "nombre" | "activo"> & { orden?: number };
export type AgrupacionImportacion = Pick<Tables<"agrupaciones_estacionalidad">, "codigo" | "nombre" | "activo" | "orden">;

/** Géneros y agrupaciones actuales, completos (activos e inactivos), leídos planos de la base o fabricados en los tests. */
export type EstadoImportacionAgrupaciones = {
  generos: GeneroImportacion[];
  agrupaciones: AgrupacionImportacion[];
};

/** Lo que se escribe por cada agrupación nueva (los géneros, ya como ids y en el orden del catálogo). */
export type AgrupacionACrear = {
  nombre: string;
  codigo: string;
  descripcion: string | null;
  orden: number;
  temporada: TemporadaAgrupacion;
  genero_ids: string[];
};

export type ReporteImportacionAgrupacionesBase = Omit<ReporteImportacionAgrupaciones, "modo">;

export type PlanImportacionAgrupaciones = {
  reporte: ReporteImportacionAgrupacionesBase;
  crear: AgrupacionACrear[];
};

/** Texto de una celda: las celdas numéricas del Excel llegan como número. */
function texto(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (typeof valor === "number" && Number.isFinite(valor)) return String(valor);
  return "";
}

const sinEspaciosEnBarra = (t: string) => t.replace(/\s*\/\s*/g, "/");

/**
 * Separa la celda de géneros por coma, punto y coma, barra o `|`, normaliza cada
 * pedazo, descarta los vacíos y quita los repetidos (conserva el orden).
 *
 * Con el catálogo, la barra no parte un nombre de género que la lleva
 * (`HOMBRE/MUJER`): en cada tramo separado por coma, `;` o `|` se busca primero la
 * corrida más larga de pedazos unidos por `/` que coincide con el nombre completo
 * de un género, y solo lo que no coincide con ninguno se parte por `/`. Así
 * `HOMBRE/MUJER, NIÑOS` son dos géneros y `HOMBRE/MUJER` sin ese género en el
 * catálogo, también dos.
 */
export function separarGeneros(valor: unknown, catalogo: ReadonlyArray<Pick<GeneroImportacion, "nombre">> = []): string[] {
  const conBarra = new Map<string, string>();
  for (const g of catalogo) {
    const nombre = normalizarNombre(g.nombre);
    if (nombre.includes("/")) conBarra.set(sinEspaciosEnBarra(nombre), nombre);
  }
  const vistos = new Set<string>();
  const partes: string[] = [];
  const agregar = (token: string) => {
    if (token && !vistos.has(token)) {
      vistos.add(token);
      partes.push(token);
    }
  };
  for (const tramo of texto(valor).split(/[,;|]/)) {
    const piezas = tramo
      .split("/")
      .map((p) => normalizarNombre(p))
      .filter((p) => p !== "");
    let i = 0;
    while (i < piezas.length) {
      let hasta = i + 1;
      let token = piezas[i];
      for (let j = piezas.length; j > i + 1; j--) {
        const completo = conBarra.get(piezas.slice(i, j).join("/"));
        if (completo !== undefined) {
          hasta = j;
          token = completo;
          break;
        }
      }
      agregar(token);
      i = hasta;
    }
  }
  return partes;
}

/**
 * Lee la columna `orden`: vacío → `null` (se asigna solo); entero ≥ 0 (`"30"`,
 * `"30.0"`, `"30,0"`) → el número; cualquier otra cosa → `"invalido"`.
 */
export function leerOrdenImportado(valor: unknown): number | null | "invalido" {
  const t = texto(valor).trim();
  if (t === "") return null;
  if (!/^\d+(?:[.,]0+)?$/.test(t)) return "invalido";
  const n = Number.parseInt(t, 10);
  return Number.isSafeInteger(n) && n <= ORDEN_MAXIMO ? n : "invalido";
}

/**
 * Siguiente múltiplo de 10 estrictamente mayor que `mayor` (`0` → 10, `20` → 30,
 * `25` → 30), o `null` si ya no cabe en un `integer` de Postgres.
 */
export function siguienteOrden(mayor: number): number | null {
  const siguiente = (Math.floor(Math.max(mayor, 0) / 10) + 1) * 10;
  return siguiente > ORDEN_MAXIMO ? null : siguiente;
}

type Huella = { codigo: string; generos: string; temporada: string; descripcion: string; orden: string };
const CAMPOS_HUELLA: ReadonlyArray<[keyof Huella, string]> = [
  ["codigo", "código"],
  ["generos", "géneros"],
  ["temporada", "temporada"],
  ["descripcion", "descripción"],
  ["orden", "orden"],
];

export function planificarImportacionAgrupaciones(
  filas: FilaImportacionAgrupaciones[],
  estado: EstadoImportacionAgrupaciones
): PlanImportacionAgrupaciones {
  const omitidas: FilaOmitidaAgrupaciones[] = [];
  const crear: AgrupacionACrear[] = [];
  const nuevas: AgrupacionNuevaImportada[] = [];

  // Índices del estado actual.
  const porNombre = new Map(estado.agrupaciones.map((a) => [normalizarNombre(a.nombre), a]));
  const porCodigo = new Map(estado.agrupaciones.map((a) => [a.codigo.toUpperCase(), a]));
  const generosOrdenados = [...estado.generos].sort((a, b) =>
    compararOrdenNombre({ orden: a.orden ?? 0, nombre: a.nombre }, { orden: b.orden ?? 0, nombre: b.nombre })
  );
  let mayorOrden = estado.agrupaciones.reduce((max, a) => Math.max(max, a.orden), 0);

  // Lo aceptado dentro del archivo: gana la primera fila de cada nombre y de cada código.
  const nombresVistos = new Map<string, { fila: number; huella: Huella }>();
  const codigosVistos = new Map<string, { fila: number; nombre: string }>();

  filas.forEach((cruda, i) => {
    const fila = i + 1;
    const nombreTxt = normalizarNombre(texto(cruda.nombre));
    const codigoCrudo = texto(cruda.codigo).trim();
    const generosTxt = normalizarNombre(texto(cruda.generos));
    const temporadaTxt = normalizarNombre(texto(cruda.temporada));
    const descripcionTxt = texto(cruda.descripcion).trim();
    const ordenTxt = texto(cruda.orden).trim();

    /** Anota la omisión con la fila normalizada, para que se pueda corregir el archivo. */
    const omitir = (
      motivo: MotivoOmisionAgrupaciones,
      extra: { detalle?: string; fila_original?: number; informativa?: boolean } = {}
    ) => {
      omitidas.push({
        fila,
        motivo,
        ...(extra.detalle === undefined ? {} : { detalle: extra.detalle }),
        ...(extra.fila_original === undefined ? {} : { fila_original: extra.fila_original }),
        informativa: extra.informativa ?? false,
        nombre: nombreTxt,
        codigo: normalizarNombre(codigoCrudo),
        generos: generosTxt,
        temporada: temporadaTxt,
        descripcion: descripcionTxt,
        orden: ordenTxt,
      });
    };

    // 1. Vacíos, fila de totales y longitud del nombre.
    if (!nombreTxt) return omitir("nombre_vacio");
    if (nombreTxt === "TOTAL") return omitir("fila_total");
    if (nombreTxt.length > MAX_NOMBRE) {
      return omitir("nombre_largo", { detalle: `${nombreTxt.length} caracteres; el máximo es ${MAX_NOMBRE}.` });
    }

    // 2. Ya existe (por nombre, o por código derivado cuando el archivo no trae CODIGO): nunca se actualiza.
    const derivado = aCodigo(nombreTxt);
    const existente = porNombre.get(nombreTxt) ?? (codigoCrudo === "" && derivado ? porCodigo.get(derivado) : undefined);
    if (existente) {
      const partes = [
        normalizarNombre(existente.nombre) === nombreTxt ? undefined : `Ya existe como ${existente.nombre}`,
        existente.activo ? undefined : "está inactiva y no se reactiva",
      ].filter((p): p is string => p !== undefined);
      const frase = partes.join("; ");
      return omitir("ya_existe", {
        informativa: true,
        ...(frase ? { detalle: `${frase.charAt(0).toLocaleUpperCase("es")}${frase.slice(1)}.` } : {}),
      });
    }

    // Géneros: nombre o código, solo activos. Se resuelven antes de mirar los repetidos
    // porque la huella compara géneros ya resueltos, no el texto escrito.
    const tokens = separarGeneros(cruda.generos, estado.generos);
    const elegidos = new Map<string, GeneroImportacion>();
    const desconocidos: string[] = [];
    const inactivos: string[] = [];
    const clavesGeneros = new Set<string>();
    for (const token of tokens) {
      const encontrado = buscarEnCatalogo(estado.generos, token);
      const activo = resolverCatalogo(estado.generos, token);
      if (activo) elegidos.set(activo.id, activo);
      else if (encontrado) inactivos.push(token);
      else desconocidos.push(token);
      clavesGeneros.add(encontrado?.id ?? `?${token}`);
    }

    // Lo que identifica la fila para saber si una repetida es exacta.
    const temporadaLeida = leerTemporadaImportada(temporadaTxt);
    const ordenLeido = leerOrdenImportado(ordenTxt);
    const huella: Huella = {
      codigo: codigoCrudo ? aCodigo(codigoCrudo) : derivado,
      generos: [...clavesGeneros].sort().join("|"),
      temporada: temporadaLeida === TEMPORADA_NO_RECONOCIDA ? temporadaTxt : (temporadaLeida ?? "todo_el_ano"),
      descripcion: descripcionTxt,
      orden: ordenLeido === null || ordenLeido === "invalido" ? ordenTxt : String(ordenLeido),
    };

    // 3. Nombre repetido dentro del archivo: gana la primera. Informativa solo si es idéntica.
    const vista = nombresVistos.get(nombreTxt);
    if (vista) {
      const distintos = CAMPOS_HUELLA.filter(([campo]) => huella[campo] !== vista.huella[campo]).map(([, etiqueta]) => etiqueta);
      const exacta = distintos.length === 0;
      return omitir("nombre_repetido_en_archivo", {
        fila_original: vista.fila,
        informativa: exacta,
        detalle: exacta
          ? `Idéntica a la fila ${vista.fila}.`
          : `Difiere de la fila ${vista.fila} en ${distintos.join(", ")}; se usa la de la fila ${vista.fila}.`,
      });
    }

    // 4. Géneros.
    if (tokens.length === 0) return omitir("genero_vacio");
    if (desconocidos.length > 0) return omitir("genero_desconocido", { detalle: desconocidos.join(", ") });
    if (inactivos.length > 0) return omitir("genero_inactivo", { detalle: inactivos.join(", ") });

    // 5. Temporada, orden y descripción.
    if (temporadaLeida === TEMPORADA_NO_RECONOCIDA) return omitir("temporada_invalida", { detalle: temporadaTxt });
    if (ordenLeido === "invalido") return omitir("orden_invalido", { detalle: ordenTxt });
    if (descripcionTxt.length > MAX_DESCRIPCION) {
      return omitir("descripcion_larga", { detalle: `${descripcionTxt.length} caracteres; el máximo es ${MAX_DESCRIPCION}.` });
    }

    // 6. Código: el del archivo (normalizado) o el derivado del nombre.
    if (codigoCrudo.length > MAX_CODIGO) {
      return omitir("codigo_invalido", { detalle: `Tiene ${codigoCrudo.length} caracteres; el máximo es ${MAX_CODIGO}.` });
    }
    const codigo = codigoCrudo ? aCodigo(codigoCrudo) : derivado;
    if (!codigo) {
      return omitir("codigo_invalido", {
        detalle: codigoCrudo ? "Usa letras o números." : "El nombre no tiene letras ni números para armar el código.",
      });
    }
    const enUso = porCodigo.get(codigo);
    if (enUso) return omitir("codigo_en_uso", { detalle: `Lo tiene la agrupación ${enUso.nombre}.` });
    const codigoVisto = codigosVistos.get(codigo);
    if (codigoVisto) {
      return omitir("codigo_repetido_en_archivo", {
        fila_original: codigoVisto.fila,
        detalle: `Lo usa ${codigoVisto.nombre} en la fila ${codigoVisto.fila}.`,
      });
    }

    // 7. Aceptada: orden, géneros por el orden del catálogo y registro de lo visto.
    const orden = ordenLeido ?? siguienteOrden(mayorOrden);
    if (orden === null) {
      return omitir("orden_invalido", {
        detalle: `No hay un orden siguiente disponible: el máximo es ${ORDEN_MAXIMO}. Indica el orden a mano.`,
      });
    }
    mayorOrden = Math.max(mayorOrden, orden);
    const generos = generosOrdenados.filter((g) => elegidos.has(g.id));
    const temporada: TemporadaAgrupacion = temporadaLeida ?? "todo_el_ano";
    const descripcion = descripcionTxt === "" ? null : descripcionTxt;

    nombresVistos.set(nombreTxt, { fila, huella });
    codigosVistos.set(codigo, { fila, nombre: nombreTxt });
    crear.push({ nombre: nombreTxt, codigo, descripcion, orden, temporada, genero_ids: generos.map((g) => g.id) });
    nuevas.push({ fila, nombre: nombreTxt, codigo, generos: generos.map((g) => g.nombre), temporada, orden, descripcion });
  });

  const reporte: ReporteImportacionAgrupacionesBase = {
    totales: {
      filas: filas.length,
      a_crear: crear.length,
      creadas: 0,
      ya_existen: omitidas.filter((o) => o.motivo === "ya_existe").length,
      omitidas: omitidas.length,
      con_error: omitidas.filter((o) => !o.informativa).length,
    },
    agrupaciones_nuevas: nuevas,
    omitidas,
  };
  return { reporte, crear };
}

/**
 * Aplica el plan en memoria con la misma semántica que el `upsert … ignoreDuplicates`
 * del handler: si ya existe una agrupación con ese nombre no se crea ni se toca.
 * Devuelve un estado nuevo; no muta el recibido.
 */
export function aplicarPlanAgrupaciones(
  estado: EstadoImportacionAgrupaciones,
  plan: PlanImportacionAgrupaciones
): EstadoImportacionAgrupaciones {
  const nombres = new Set(estado.agrupaciones.map((a) => normalizarNombre(a.nombre)));
  const agrupaciones = [...estado.agrupaciones];
  for (const a of plan.crear) {
    if (nombres.has(a.nombre)) continue;
    nombres.add(a.nombre);
    agrupaciones.push({ nombre: a.nombre, codigo: a.codigo, orden: a.orden, activo: true });
  }
  return { ...estado, agrupaciones };
}

/**
 * Mensaje de pantalla cuando la escritura se detiene a mitad: cuántas agrupaciones
 * se crearon antes, si alguna quedó sin género (la compensación también falló) y
 * que reimportar el mismo archivo completa el resto sin duplicar.
 */
export function mensajeFalloCrearAgrupaciones(detalleDb: string, creadas: number, sinGenero: number): string {
  const plural = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;
  const partes = [
    `La importación se detuvo al crear agrupaciones: ${detalleDb} Se ${creadas === 1 ? "creó" : "crearon"} ${plural(creadas, "agrupación", "agrupaciones")} antes de fallar.`,
  ];
  if (sinGenero > 0) {
    partes.push(
      `${plural(sinGenero, "agrupación quedó", "agrupaciones quedaron")} sin género: asígnalas en Agrupaciones (pestaña Agrupaciones) antes de volver a importar.`
    );
  }
  partes.push("Vuelve a importar el mismo archivo para completar el resto sin duplicar.");
  return partes.join(" ");
}
