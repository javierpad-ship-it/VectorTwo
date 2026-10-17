import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { registrarErrorDb } from "@/lib/api/errores-db";
import type { Json, TablesInsert } from "@/lib/supabase/database.types";
import { cargarCatalogo, cargarContextoCalculo } from "./contexto";
import {
  borrarCrecimientos,
  escribirParametrosConCandado,
  leerCrecimientos,
  leerDecisionesDeFilas,
  leerFilasConAnios,
  leerGenerosMundos,
  leerProyeccionDb,
  leerTiendasProyeccion,
  pisarRegistros,
  soltarCalculo,
  tomarCalculo,
  upsertCrecimientos,
  type CrecimientoDb,
  type ProyeccionDb,
} from "./consultas";
import {
  agregarFilas,
  celdasFaltantes,
  claveGM,
  filasEnChoque,
  generosDeMatriz,
  matrizDeCeldas,
  type FilaCrecimiento,
  type FilaEnChoqueDecidida,
  type FilaEnChoquePct,
  type MatrizYResto,
} from "./crecimientos";
import { crecimientosCambiados } from "./desactualizado";
import { huellaChoque, huellaDeMatriz, huellaMatriz } from "./huellas-crecimientos";
import type { GuardarCrecimientosCuerpo } from "./esquemas";
import { MENSAJE_CALCULO_EN_CURSO_PROYECCION, calculoEnCurso, motivoRechazoEdicion } from "./reglas";
import { ejecutarCalculo, esMetodoVigente, rechazoCalculoSimultaneo } from "./servicio";
import {
  falla,
  fallaDb,
  fallaMensaje,
  fallaRegla,
  listo,
  nombreDeFilaPorClave,
  parametrosDe,
  proyeccionOr404,
  sello,
  type Actor,
  type Db,
  type Salida,
} from "./servicio-base";
import { GENEROS_MATRIZ, type CeldaCrecimientoApi, type ParametrosProyeccion, type ResumenProyeccion, type RespuestaCrecimientosApi, type RespuestaGuardarCrecimientosApi } from "./tipos";
import type { Catalogo } from "./persistencia";

/**
 * Servicio de la matriz de crecimientos por género × mundo (ficha 07c). `GET` lee sin escribir; `PUT` es el reemplazo completo e
 * idempotente: valida, detecta choques con filas fijadas a mano, toma el candado de cálculo, escribe y ENCADENA el recálculo en el servidor
 * (un solo botón, «Guardar y recalcular»). Solo servidor.
 */

const db = (): Db => supabaseAdmin();

const MAX_FILAS_CHOQUE = 200;

// Un fallo a mitad de las escrituras puede haber movido la huella (celdas ya guardadas): reintentar con la pantalla vieja daría `409 conflicto`.
const MENSAJE_GUARDADO_PARCIAL = "No se pudo terminar de guardar los crecimientos. Recarga la pantalla para ver qué quedó guardado y vuelve a pulsar «Guardar y recalcular».";
const MENSAJE_CONFLICTO = "La matriz de crecimientos cambió mientras la editabas (alguien más la guardó). Recarga la pantalla y vuelve a intentar.";

const estadoDe = (p: ProyeccionDb) => (p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : ("en_trabajo" as const));

const conExtra = (mensaje: string, status: number, codigo: string, extra: Record<string, unknown>): NextResponse =>
  NextResponse.json({ error: mensaje, codigo, ...extra }, { status, headers: { "Cache-Control": "no-store" } });

const fallaConExtra = (mensaje: string, status: number, codigo: string, extra: Record<string, unknown>): Salida<never> => falla(conExtra(mensaje, status, codigo, extra));

// ─── Lectura de lo que hace falta ───

type FilaBase = FilaCrecimiento & { clave: string; gml_id: string };

type Datos = {
  p: ProyeccionDb;
  parametros: ParametrosProyeccion;
  celdas: CrecimientoDb[];
  catalogo: Catalogo;
  generos: { id: string; nombre: string }[];
  /** Nombres de TODOS los géneros y mundos del catálogo (también inactivos), para rotular celdas guardadas que ya no se muestran. */
  nombresGeneros: ReadonlyMap<string, string>;
  nombresMundos: ReadonlyMap<string, string>;
  mundosActivos: { id: string; nombre: string; orden: number | null }[];
  /** Filas base activas de `Y+1` con su GM resuelto desde el árbol vigente. */
  filas: FilaBase[];
};

async function cargarDatos(d: Db, p: ProyeccionDb): Promise<Salida<Datos>> {
  const [celdas, gm, cat, filas] = await Promise.all([
    leerCrecimientos(d, p.id),
    leerGenerosMundos(d),
    cargarCatalogo(d),
    leerFilasConAnios(d, p.id, { columnas: "ligeras", tiendaId: null, soloActivas: true }),
  ]);
  if (celdas.error) return fallaDb(celdas.error, "crecimientos: leer la matriz");
  if (gm.error) return fallaDb(gm.error, "crecimientos: leer géneros y mundos");
  if (cat.respuesta) return falla(cat.respuesta);
  if (filas.error) return fallaDb(filas.error, "crecimientos: leer las filas");
  const catalogo = cat.data.catalogo;
  const anioSig = p.anio_en_curso + 1;
  const base: FilaBase[] = [];
  for (const f of filas.data) {
    const a = f.proyeccion_fila_anios.find((x) => x.anio === anioSig && x.activo);
    const nodo = catalogo.nodos.get(f.gml_id);
    if (!a || !nodo) continue;
    base.push({
      fila_id: f.id,
      clave: f.clave,
      gml_id: f.gml_id,
      genero_id: nodo.genero_id,
      mundo_id: nodo.mundo_id,
      crecimiento_pct: a.crecimiento_pct === null || a.crecimiento_pct === undefined ? null : Number(a.crecimiento_pct),
      decidido: a.decidido ?? null,
      propuesto: a.propuesto ?? null,
      base_siguiente: a.base_siguiente === null || a.base_siguiente === undefined ? null : Number(a.base_siguiente),
      base_normalizada: a.base_normalizada === null || a.base_normalizada === undefined ? null : Number(a.base_normalizada),
    });
  }
  return listo({
    p,
    parametros: parametrosDe(p.parametros),
    celdas: celdas.data,
    catalogo,
    generos: generosDeMatriz(gm.generos).map((g) => ({ id: g.id, nombre: g.nombre })),
    nombresGeneros: new Map(gm.generos.map((g) => [g.id, g.nombre])),
    nombresMundos: new Map(gm.mundos.map((m) => [m.id, m.nombre])),
    mundosActivos: gm.mundos.filter((m) => m.activo).map((m) => ({ id: m.id, nombre: m.nombre, orden: m.orden })),
    filas: base,
  });
}

/** Las celdas guardadas de los géneros de la matriz, listas para comparar (más el Resto). */
function matrizGuardada(dt: Datos): MatrizYResto {
  const m = matrizDeCeldas(dt.celdas.map((c) => ({ genero_id: c.genero_id, mundo_id: c.mundo_id, pct: Number(c.pct) })), dt.generos.map((g) => g.id));
  return { celdas: m.celdas, generos: m.generos, resto: dt.parametros.crecimiento_pct_defecto };
}

/** La `huella` del bloqueo optimista de lo guardado hoy. */
function huellaActual(dt: Datos): string {
  const idsMatriz = new Set(dt.generos.map((g) => g.id));
  return huellaMatriz(
    dt.celdas.filter((c) => idsMatriz.has(c.genero_id)).map((c) => ({ genero_id: c.genero_id, mundo_id: c.mundo_id, pct: Number(c.pct), nota: c.nota })),
    { pct: dt.parametros.crecimiento_pct_defecto, nota: dt.parametros.crecimiento_resto_meta?.nota ?? null },
    dt.parametros.crecimiento_objetivo_pct ?? null
  );
}

/** Las celdas obligatorias: cada GM (género de la matriz × mundo activo) con al menos una fila base activa de `Y+1`. */
function paresObligatorios(dt: Datos): { genero_id: string; mundo_id: string; genero: string; mundo: string }[] {
  const generos = new Map(dt.generos.map((g) => [g.id, g.nombre]));
  const mundos = new Map(dt.mundosActivos.map((m) => [m.id, m.nombre]));
  const vistos = new Map<string, { genero_id: string; mundo_id: string; genero: string; mundo: string }>();
  for (const f of dt.filas) {
    if (!generos.has(f.genero_id) || !mundos.has(f.mundo_id)) continue;
    vistos.set(claveGM(f.genero_id, f.mundo_id), { genero_id: f.genero_id, mundo_id: f.mundo_id, genero: generos.get(f.genero_id) as string, mundo: mundos.get(f.mundo_id) as string });
  }
  const ordenMundo = new Map(dt.mundosActivos.map((m, i) => [m.id, i]));
  const ordenGenero = new Map(dt.generos.map((g, i) => [g.id, i]));
  return [...vistos.values()].sort(
    (a, b) => (ordenMundo.get(a.mundo_id) ?? 0) - (ordenMundo.get(b.mundo_id) ?? 0) || (ordenGenero.get(a.genero_id) ?? 0) - (ordenGenero.get(b.genero_id) ?? 0)
  );
}

// ─── GET ───

function respuestaDe(dt: Datos): RespuestaCrecimientosApi {
  const { p, parametros } = dt;
  const Y = p.anio_en_curso;
  const idsMatriz = new Set(dt.generos.map((g) => g.id));
  const guardada = new Map(dt.celdas.filter((c) => idsMatriz.has(c.genero_id)).map((c) => [claveGM(c.genero_id, c.mundo_id), c]));

  // Mundos de la matriz: los activos con alguna fila base de HOMBRE o MUJER, o con una celda guardada, en el orden del catálogo.
  const conFilas = new Set(dt.filas.filter((f) => idsMatriz.has(f.genero_id)).map((f) => f.mundo_id));
  const conCelda = new Set([...guardada.values()].map((c) => c.mundo_id));
  const mundos = dt.mundosActivos.filter((m) => conFilas.has(m.id) || conCelda.has(m.id));
  const mundosMostrados = new Set(mundos.map((m) => m.id));

  const filasDe = new Map<string, FilaBase[]>();
  const filasResto: FilaBase[] = [];
  for (const f of dt.filas) {
    if (idsMatriz.has(f.genero_id) && mundosMostrados.has(f.mundo_id)) {
      const k = claveGM(f.genero_id, f.mundo_id);
      filasDe.set(k, [...(filasDe.get(k) ?? []), f]);
    } else filasResto.push(f);
  }

  const celdas: CeldaCrecimientoApi[] = [];
  for (const m of mundos) {
    for (const g of dt.generos) {
      const k = claveGM(g.id, m.id);
      const c = guardada.get(k);
      const filas = filasDe.get(k) ?? [];
      celdas.push({
        genero_id: g.id,
        mundo_id: m.id,
        pct: c ? Number(c.pct) : null,
        nota: c?.nota ?? null,
        actualizado_por: c?.usuario_nombre ?? null,
        actualizado_at: c?.updated_at ?? null,
        sin_filas: filas.length === 0,
        agregado: agregarFilas(filas),
      });
    }
  }

  const porGenero = new Map<string, number>();
  for (const f of filasResto) {
    const nombre = dt.catalogo.nodos.get(f.gml_id)?.genero ?? "—";
    porGenero.set(nombre, (porGenero.get(nombre) ?? 0) + (f.base_siguiente ?? 0));
  }
  const resumen = p.resumen as unknown as ResumenProyeccion | null;
  const totales = resumen?.totales?.[Y + 1];
  const metodoViejo = !esMetodoVigente(p.resumen);
  const gmPorNodo = new Map([...dt.catalogo.nodos].map(([id, n]) => [id, claveGM(n.genero_id, n.mundo_id)]));
  const cambiados = crecimientosCambiados(resumen, { huella: huellaDeMatriz(matrizGuardada(dt), parametros.crecimiento_pct_defecto), gm_por_nodo: gmPorNodo });
  const meta = parametros.crecimiento_resto_meta;

  return {
    editable: estadoDe(p) === "en_trabajo" && !calculoEnCurso(p.calculando_desde, sello()),
    anio_en_curso: Y,
    anio_siguiente: Y + 1,
    huella: huellaActual(dt),
    al_dia: estadoDe(p) !== "en_trabajo" || (!metodoViejo && !cambiados),
    metodo_viejo: metodoViejo,
    generos: dt.generos,
    generos_faltantes: GENEROS_MATRIZ.filter((nombre) => !dt.generos.some((g) => g.nombre.trim().toUpperCase() === nombre)),
    mundos,
    celdas,
    resto: {
      pct: parametros.crecimiento_pct_defecto,
      nota: meta?.nota ?? null,
      actualizado_por: meta?.por_nombre ?? null,
      actualizado_at: meta?.at ?? null,
      agregado: agregarFilas(filasResto),
      por_genero: [...porGenero].map(([genero, base]) => ({ genero, base })).sort((a, b) => b.base - a.base || a.genero.localeCompare(b.genero, "es")),
    },
    objetivo_pct: parametros.crecimiento_objetivo_pct ?? null,
    puente: {
      total_en_curso: resumen?.totales?.[Y]?.total ?? 0,
      nuevas_anterior: totales?.nuevas_anterior ?? 0,
      aperturas: totales?.aperturas ?? 0,
      cierres: totales?.cierres ?? 0,
      cierres_sin_decidir: 0,
    },
  };
}

/** Lee la matriz y arma la respuesta (con los cierres de `Y+1` sin decidir, que salen de `proyeccion_tiendas`). */
async function armarRespuesta(d: Db, p: ProyeccionDb): Promise<Salida<RespuestaCrecimientosApi>> {
  const dt = await cargarDatos(d, p);
  if (dt.respuesta) return falla(dt.respuesta);
  const tiendas = await leerTiendasProyeccion(d, p.id);
  if (tiendas.error) return fallaDb(tiendas.error, "crecimientos: leer las tiendas");
  const r = respuestaDe(dt.data);
  const sinDecidir = tiendas.data.filter((t) => t.activo && t.bloque === "cierres" && t.anio === p.anio_en_curso + 1 && t.decidido === null).length;
  return listo({ ...r, puente: { ...r.puente, cierres_sin_decidir: sinDecidir } });
}

/** `GET …/crecimientos`: la matriz, los efectivos agregados y los conteos de choques posibles. `404` si la proyección no existe. */
export async function leerCrecimientosDeProyeccion(id: string): Promise<Salida<RespuestaCrecimientosApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  return armarRespuesta(d, pR.data);
}

// ─── PUT ───

const compararTexto = (a: string | null, b: string | null) => (a ?? "").localeCompare(b ?? "", "es");

/** El cuerpo del `409 filas_manuales`: las dos listas (≤ 200 cada una) con nombres legibles y la `huella_choque` de TODAS las filas. */
function conflictoFilasManuales(
  mensaje: string,
  choques: { pct_propio: FilaEnChoquePct[]; decididas: FilaEnChoqueDecidida[] },
  huella: string,
  catalogo: Catalogo,
  filas: ReadonlyMap<string, FilaBase>
): Salida<never> {
  const nombres = (id: string) => {
    const f = filas.get(id) as FilaBase;
    const n = nombreDeFilaPorClave(f.clave, catalogo);
    return { fila_id: id, genero: n.genero ?? "—", mundo: n.mundo ?? "—", linea: n.linea ?? "—", equivalencia: n.equivalencia, agrupacion_marca: n.agrupacion_marca ?? "—" };
  };
  const orden = (a: { genero: string; mundo: string; linea: string; equivalencia: string | null; agrupacion_marca: string; fila_id: string }, b: typeof a) =>
    compararTexto(a.genero, b.genero) || compararTexto(a.mundo, b.mundo) || compararTexto(a.linea, b.linea) || compararTexto(a.equivalencia, b.equivalencia) || compararTexto(a.agrupacion_marca, b.agrupacion_marca) || compararTexto(a.fila_id, b.fila_id);
  const propias = choques.pct_propio.map((c) => ({ ...nombres(c.fila.fila_id), pct_fila: c.pct_fila, pct_nuevo: c.pct_nuevo })).sort(orden);
  const decididas = choques.decididas.map((c) => ({ ...nombres(c.fila.fila_id), decidido: c.decidido, propuesta_nueva_estimada: c.propuesta_nueva_estimada })).sort(orden);
  return fallaConExtra(mensaje, 409, "filas_manuales", {
    huella_choque: huella,
    pct_propio: { total: propias.length, filas: propias.slice(0, MAX_FILAS_CHOQUE) },
    decididas: { total: decididas.length, filas: decididas.slice(0, MAX_FILAS_CHOQUE) },
  });
}

/** Un fallo de base a mitad de las escrituras: lo ya guardado puede ser parcial; el detalle crudo va al log y el usuario puede repetir. */
function fallaGuardado(e: Parameters<typeof registrarErrorDb>[0], contexto: string): Salida<never> {
  registrarErrorDb(e, contexto);
  return fallaMensaje(MENSAJE_GUARDADO_PARCIAL, 500, "guardado_parcial");
}

/** `{ codigo, mensaje }` de una respuesta de error (la del recálculo fallido, que no corta el `PUT`). */
async function describirFalla(r: NextResponse): Promise<{ codigo: string; mensaje: string }> {
  try {
    const cuerpo = (await r.clone().json()) as { error?: string; codigo?: string };
    return { codigo: cuerpo.codigo ?? "recalculo_fallido", mensaje: cuerpo.error ?? "No se pudo recalcular la proyección." };
  } catch {
    return { codigo: "recalculo_fallido", mensaje: "No se pudo recalcular la proyección." };
  }
}

/**
 * `PUT …/crecimientos`. Orden (ficha 07c §3): 1. proyección en trabajo y sin cálculo vivo; 2. `huella`; 3. celdas, géneros, mundos y matriz
 * completa; 4. choques con filas fijadas a mano (`409 filas_manuales`); 5. candado de cálculo condicional; 6. escrituras; 7. recálculo
 * encadenado; 8. `revertidas`; 9. la respuesta del `GET` recalculado. Reemplazo completo e idempotente con la misma `huella`; tras un fallo a mitad
 * de las escrituras (`500 guardado_parcial`) la huella puede haber cambiado: hay que recargar y volver a guardar. Las celdas guardadas que
 * ya no se pueden enviar (mundo desactivado) se borran y se devuelven en `celdas_descartadas`.
 */
export async function guardarCrecimientos(id: string, cuerpo: GuardarCrecimientosCuerpo, actor: Actor): Promise<Salida<RespuestaGuardarCrecimientosApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  const rechazo = motivoRechazoEdicion({ estado: estadoDe(p), calculandoDesde: p.calculando_desde, ahora: sello() });
  if (rechazo) return fallaRegla(rechazo);

  // La resolución solo responde a un choque que ya se vio, y «incluir decididas» solo vale con «pisar».
  if (cuerpo.resolucion !== undefined && cuerpo.huella_choque === undefined) {
    return fallaMensaje("Para resolver el choque con filas fijadas a mano hace falta la lista que viste: vuelve a guardar para verla.", 400, "resolucion_invalida");
  }
  if (cuerpo.incluir_decididas === true && cuerpo.resolucion !== "pisar") {
    return fallaMensaje("«Incluir las filas con total decidido» solo vale con «Pisar».", 400, "resolucion_invalida");
  }

  const dtR = await cargarDatos(d, p);
  if (dtR.respuesta) return falla(dtR.respuesta);
  const dt = dtR.data;

  // 2. Bloqueo optimista.
  if (huellaActual(dt) !== cuerpo.huella) return fallaMensaje(MENSAJE_CONFLICTO, 409, "conflicto");

  // 3. Celdas, géneros, mundos y matriz completa.
  const generosOk = new Map(dt.generos.map((g) => [g.id, g.nombre]));
  const mundosOk = new Map(dt.mundosActivos.map((m) => [m.id, m.nombre]));
  const enviadas = new Set<string>();
  for (const c of cuerpo.celdas) {
    const k = claveGM(c.genero_id, c.mundo_id);
    if (enviadas.has(k)) return fallaMensaje("Hay una celda repetida (mismo género y mundo): cada combinación se escribe una sola vez.", 400, "celda_repetida");
    enviadas.add(k);
  }
  for (const c of cuerpo.celdas) {
    if (!generosOk.has(c.genero_id)) return fallaMensaje("Solo se escriben crecimientos de HOMBRE y MUJER: los demás géneros siguen el Resto.", 400, "genero_no_permitido");
    if (!mundosOk.has(c.mundo_id)) return fallaMensaje("Una celda tiene un mundo que no existe o está desactivado.", 400, "mundo_inactivo");
  }
  const faltan = celdasFaltantes(paresObligatorios(dt), enviadas);
  if (faltan.length > 0) {
    const lista = faltan.map((f) => `${f.genero} · ${f.mundo}`).join(", ");
    return fallaConExtra(
      `Faltan ${faltan.length} ${faltan.length === 1 ? "celda" : "celdas"}: ${lista}. Escribe un % en cada una (puede ser el mismo del Resto).`,
      400,
      "celdas_incompletas",
      { faltan: faltan.map((f) => ({ genero: f.genero, mundo: f.mundo })) }
    );
  }

  // 4. Choques con filas fijadas a mano.
  const guardada = matrizGuardada(dt);
  const borrador: MatrizYResto = {
    celdas: new Map(cuerpo.celdas.map((c) => [claveGM(c.genero_id, c.mundo_id), c.pct])),
    generos: guardada.generos,
    resto: cuerpo.resto.pct,
  };
  const choques = filasEnChoque(guardada, borrador, dt.filas);
  const hayChoque = choques.pct_propio.length + choques.decididas.length > 0;
  const porId = new Map(dt.filas.map((f) => [f.fila_id, f]));
  let resolucion: "pisar" | "conservar" | undefined;
  if (hayChoque) {
    const huella = huellaChoque([...choques.pct_propio, ...choques.decididas].map((c) => ({ fila_id: c.fila.fila_id, crecimiento_pct: c.fila.crecimiento_pct, decidido: c.fila.decidido })));
    if (cuerpo.resolucion === undefined) {
      return conflictoFilasManuales("Este cambio choca con filas fijadas a mano: decide qué hacer con ellas.", choques, huella, dt.catalogo, porId);
    }
    if (cuerpo.huella_choque !== huella) {
      return conflictoFilasManuales("Las filas en choque cambiaron mientras decidías: revisa la lista nueva.", choques, huella, dt.catalogo, porId);
    }
    resolucion = cuerpo.resolucion;
  }

  // 5. Candado de cálculo, condicional al `calculando_desde` y al `updated_at` leídos en el paso 1.
  const libre = await rechazoCalculoSimultaneo(d, id);
  if (libre.respuesta) return falla(libre.respuesta);
  const ahora = sello();
  const tomado = await tomarCalculo(d, id, p.calculando_desde, ahora, p.updated_at);
  if (tomado.error) return fallaDb(tomado.error, "crecimientos: tomar el candado de cálculo");
  if (!tomado.data) {
    const actual = await leerProyeccionDb(d, id);
    if (actual.data && calculoEnCurso(actual.data.calculando_desde, sello())) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
    return fallaMensaje(MENSAJE_CONFLICTO, 409, "conflicto");
  }
  const valorTomado = tomado.data.calculando_desde ?? ahora;
  const Y = p.anio_en_curso;
  const anioSig = Y + 1;

  // 6. Escrituras (en tandas); cualquier fallo libera el candado y responde `500 guardado_parcial`.
  const pisar = resolucion === "pisar";
  const incluirDecididas = pisar && cuerpo.incluir_decididas === true;
  const filasPct = pisar ? choques.pct_propio.map((c) => c.fila.fila_id) : [];
  const filasDecididas = incluirDecididas ? choques.decididas.map((c) => c.fila.fila_id) : [];
  const pisadas: RespuestaGuardarCrecimientosApi["pisadas"] = [];
  if (pisar) {
    const porFila = new Map<string, { pct_anterior: number | null; decidido_anterior: number | null }>();
    for (const c of choques.pct_propio) porFila.set(c.fila.fila_id, { pct_anterior: c.pct_fila, decidido_anterior: null });
    if (incluirDecididas) {
      for (const c of choques.decididas) porFila.set(c.fila.fila_id, { pct_anterior: porFila.get(c.fila.fila_id)?.pct_anterior ?? null, decidido_anterior: c.decidido });
    }
    for (const [fila_id, v] of porFila) pisadas.push({ fila_id, ...v });
  }
  // Lo guardado que este reemplazo completo borra: la pantalla solo envía lo que muestra, así que esto son celdas de un mundo desactivado.
  const descartadas: RespuestaGuardarCrecimientosApi["celdas_descartadas"] = dt.celdas
    .filter((c) => !enviadas.has(claveGM(c.genero_id, c.mundo_id)))
    .map((c) => ({ genero: dt.nombresGeneros.get(c.genero_id) ?? "Género", mundo: dt.nombresMundos.get(c.mundo_id) ?? "Mundo", pct: Number(c.pct) }))
    .sort((a, b) => compararTexto(a.genero, b.genero) || compararTexto(a.mundo, b.mundo));
  const enChoque = new Set([...choques.pct_propio, ...choques.decididas].map((c) => c.fila.fila_id));
  const conservadas = hayChoque ? [...enChoque].filter((f) => !filasPct.includes(f) && !filasDecididas.includes(f)).length : 0;

  const liberar = () => soltarCalculo(d, id, valorTomado);
  // `recalculo` se decide en el paso 7; cualquier excepción inesperada entre el candado y el recálculo libera el candado antes de propagarse.
  let recalculo: RespuestaGuardarCrecimientosApi["recalculo"] = { ok: true };
  try {
    if (pisar && (filasPct.length > 0 || filasDecididas.length > 0)) {
      const w = await pisarRegistros(d, anioSig, { conPctPropio: filasPct, decididas: filasDecididas });
      if (w.error) {
        await liberar();
        return fallaGuardado(w.error, "crecimientos: pisar las filas fijadas a mano");
      }
    }

    // Las celdas que no cambian conservan su quién y su cuándo (no se reescriben).
    const previas = new Map(dt.celdas.map((c) => [claveGM(c.genero_id, c.mundo_id), c]));
    const cambiadas: TablesInsert<"proyeccion_crecimientos">[] = [];
    for (const c of cuerpo.celdas) {
      const antes = previas.get(claveGM(c.genero_id, c.mundo_id));
      const nota = c.nota ?? null;
      if (antes && Number(antes.pct) === c.pct && (antes.nota ?? null) === nota) continue;
      cambiadas.push({ proyeccion_id: id, genero_id: c.genero_id, mundo_id: c.mundo_id, pct: c.pct, nota, perfil_id: actor.id, usuario_nombre: actor.nombre });
    }
    const sobran = dt.celdas.filter((c) => !enviadas.has(claveGM(c.genero_id, c.mundo_id))).map((c) => c.id);
    const up = await upsertCrecimientos(d, cambiadas);
    if (up.error) {
      await liberar();
      return fallaGuardado(up.error, "crecimientos: guardar las celdas");
    }
    const del = await borrarCrecimientos(d, sobran);
    if (del.error) {
      await liberar();
      return fallaGuardado(del.error, "crecimientos: borrar las celdas que ya no están");
    }

    // El Resto, su nota y el objetivo: `UPDATE` condicional al candado tomado, sobre el `parametros` que acaba de devolver el candado.
    const parametros = parametrosDe(tomado.data.parametros);
    const restoNotaAntes = parametros.crecimiento_resto_meta?.nota ?? null;
    const restoNota = cuerpo.resto.nota ?? null;
    const restoCambio = parametros.crecimiento_pct_defecto !== cuerpo.resto.pct || restoNotaAntes !== restoNota || parametros.crecimiento_resto_meta === undefined;
    parametros.crecimiento_pct_defecto = cuerpo.resto.pct;
    if (restoCambio) parametros.crecimiento_resto_meta = { nota: restoNota, por_nombre: actor.nombre, at: ahora };
    parametros.crecimiento_objetivo_pct = cuerpo.objetivo_pct;
    const wp = await escribirParametrosConCandado(d, id, valorTomado, parametros as unknown as Json);
    if (wp.error) {
      await liberar();
      return fallaGuardado(wp.error, "crecimientos: guardar el Resto y el objetivo");
    }
    if (!wp.data) {
      await liberar();
      return fallaMensaje(MENSAJE_CONFLICTO, 409, "conflicto");
    }

    // 7. Recálculo encadenado con el candado ya tomado (rehace `propuesto`, `meses`, `base_siguiente` y la explicación de TODAS las filas). Si
    // falla, la matriz queda guardada y la proyección queda con `crecimientos_cambiados`: 200 con `recalculo.ok = false`.
    const ctx = await cargarContextoCalculo(d);
    if (ctx.respuesta) {
      await liberar();
      recalculo = { ok: false, ...(await describirFalla(ctx.respuesta)) };
    } else {
      const calculada = await ejecutarCalculo(d, wp.data, ctx.data, { previasDe: null, candado: valorTomado });
      if (calculada.respuesta) recalculo = { ok: false, ...(await describirFalla(calculada.respuesta)) };
    }
  } catch (e) {
    await liberar();
    throw e;
  }

  // 8. Las filas pisadas que, al releer, volvieron a tener % propio o total (una decisión concurrente): `revertidas`.
  const revertidas: string[] = [];
  if (pisadas.length > 0) {
    const ahoraFilas = await leerDecisionesDeFilas(d, anioSig, pisadas.map((x) => x.fila_id));
    if (ahoraFilas.error) return fallaDb(ahoraFilas.error, "crecimientos: releer las filas pisadas");
    const conPct = new Set(filasPct);
    const conTotal = new Set(filasDecididas);
    for (const f of ahoraFilas.data) {
      if ((conPct.has(f.fila_id) && f.crecimiento_pct !== null) || (conTotal.has(f.fila_id) && f.decidido !== null)) revertidas.push(f.fila_id);
    }
  }

  // 9. El `GET` recalculado.
  const fresca = await proyeccionOr404(d, id);
  if (fresca.respuesta) return falla(fresca.respuesta);
  const respuesta = await armarRespuesta(d, fresca.data);
  if (respuesta.respuesta) return falla(respuesta.respuesta);
  return listo({ ...respuesta.data, pisadas, conservadas, revertidas, celdas_descartadas: descartadas, recalculo });
}

