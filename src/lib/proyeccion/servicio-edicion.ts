import { supabaseAdmin } from "@/lib/supabase/admin";
import { registrarErrorDb } from "@/lib/api/errores-db";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { cargarCatalogo } from "./contexto";
import {
  actualizarComposicionFila,
  actualizarTiendaProyeccion,
  actualizarTotalTiendaCondicional,
  cambiarEstadoProyeccion,
  leerAniosPorIds,
  leerProyeccionDb,
  leerFilasConAnios,
  leerIdentidadFila,
  leerTiendasProyeccion,
  upsertAnios,
  type ProyeccionDb,
} from "./consultas";
import { aplicarCurvaNueva, aplicarDecision, aplicarDecisionTienda, fraccionDeTienda, moverTotalTienda, recalcularBaseSiguiente, registroDe, unidadesMadurasDeTienda, type ContextoModelo, type ResultadoDecisionTienda, type TotalesOtrosAnios } from "./decision";
import { notaMoverTotal, totalTiendaTrasMover } from "./apertura-linea";
import { conteosResumen } from "./resumen";
import { explicar, textoCurva } from "./explicar";
import { anioMaduroSoles, mesesCompletos, unidadesMadurasEntero } from "./tiendas-nuevas";
import { aAnioApi, aFilaModelo, aRegistro, payloadAnioDecision, comoJson, type Catalogo, type FilaConAnios, type TiendaPyDb } from "./persistencia";
import { motivoRechazoAplicarCurva, motivoRechazoDecision, motivoRechazoEdicion, motivoRechazoTotalTienda } from "./reglas";
import {
  aTiendaApi,
  contextoModelo,
  falla,
  fallaDb,
  fallaMensaje,
  fallaRegla,
  kDe,
  listo,
  parametrosDe,
  proyeccionOr404,
  sello,
  limiteCalculoVivo,
  type Actor,
  type Db,
  type Salida,
} from "./servicio-base";
import type { DecisionCuerpo, DecisionTiendaCuerpo } from "./esquemas";
import { claveBaseDe, type FilaModelo, type RegistroModelo, type RespuestaDecidirFilaApi, type ResumenProyeccion, type TiendaProyeccionApi } from "./tipos";

/**
 * Escrituras de las decisiones sobre una proyección en trabajo (Parte 1 y tiendas nuevas) y "aplicar curva nueva". Todas
 * corren sobre lo guardado, SIN releer venta: milisegundos. Cada una rechaza con `409` si la proyección está cerrada, archivada
 * o calculándose. Solo servidor.
 */

const db = (): Db => supabaseAdmin();

const MENSAJE_TIENDA_CAMBIO = "La tienda cambió mientras editabas; recarga y vuelve a intentar.";
const MENSAJE_GUARDADO_PARCIAL = "No se pudo terminar de guardar el cambio. Recarga la proyección y revisa la tienda antes de volver a intentar.";

const estadoDe = (p: ProyeccionDb) => (p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : ("en_trabajo" as const));

const anioValido = (p: ProyeccionDb, anio: number) => anio === p.anio_en_curso || anio === p.anio_en_curso + 1;

/**
 * Última comprobación ANTES de escribir: las decisiones leen y calculan en varias idas a la base; si mientras tanto alguien
 * cerró, archivó o puso a calcular la proyección, no se escribe nada (`409`). Releer es más barato que una transacción y deja
 * la ventana en milisegundos; el cierre y el cálculo, además, se protegen con UPDATE condicional.
 */
async function sigueEditable(d: Db, id: string): Promise<Salida<null>> {
  const r = await proyeccionOr404(d, id);
  if (r.respuesta) return falla(r.respuesta);
  const rechazo = motivoRechazoEdicion({ estado: estadoDe(r.data), calculandoDesde: r.data.calculando_desde, ahora: sello() });
  if (rechazo) return fallaRegla(rechazo);
  return listo(null);
}

/** Escribe los registros de varias filas con su decisión (los decididos ahora llevan quién los decidió). */
async function guardarRegistros(d: Db, filas: readonly FilaModelo[], ids: ReadonlyMap<string, string>, anios: readonly number[], selloDecision: string, actor: Actor) {
  const payloads: TablesInsert<"proyeccion_fila_anios">[] = [];
  for (const f of filas) {
    const filaId = ids.get(f.clave);
    if (!filaId) continue;
    for (const r of f.registros) {
      if (!anios.includes(r.anio)) continue;
      payloads.push(payloadAnioDecision(filaId, r, r.decidido_at === selloDecision ? actor.id : undefined));
    }
  }
  return upsertAnios(d, payloads);
}

/**
 * El `resumen` guarda conteos (`decididas`, `filas_para_revision`, `totales`, `avisos`) que son un reflejo de lo decidido, no una foto
 * del momento de calcular: tras cada decisión se rehacen desde las filas actuales (columnas ligeras, sin `historico`) para que la
 * cabecera, el modal de Cerrar y la lista de proyecciones no digan «0 decididas» después de decidir. Es un `UPDATE` condicional
 * (solo en trabajo y sin cálculo vivo); si falla no se pierde la decisión, que ya está guardada: el siguiente refresco lo repone.
 */
export async function refrescarResumen(d: Db, p: ProyeccionDb): Promise<void> {
  const resumen = p.resumen as unknown as ResumenProyeccion | null;
  if (resumen === null || typeof resumen !== "object") return;
  const filas = await leerFilasConAnios(d, p.id, { columnas: "ligeras", soloActivas: true });
  if (filas.error) return;
  const k = kDe(p);
  const Y = p.anio_en_curso;
  const conteos = conteosResumen(
    filas.data.map((f) => ({ clave: f.clave, tienda_id: f.tienda_id, registros: f.proyeccion_fila_anios.filter((a) => a.activo).map((a) => aRegistro(a, null, k, Y)) })),
    Y
  );
  // El `p` de quien llama pudo quedar viejo (otro `calcular` o decisión corrió mientras se leían las filas): se relee el `resumen` justo
  // antes de escribir y SOLO se pisan las claves de conteo, nunca el resto (huella, curvas usadas, versión del método…).
  const fresco = await leerProyeccionDb(d, p.id);
  const actual = fresco.data?.resumen as unknown as ResumenProyeccion | null | undefined;
  if (fresco.error || !fresco.data || fresco.data.estado !== "en_trabajo" || !actual || typeof actual !== "object") return;
  const nuevo: ResumenProyeccion = { ...actual, ...conteos };
  await cambiarEstadoProyeccion(d, p.id, "en_trabajo", { resumen: comoJson(nuevo) }, { sinCalculoDesde: limiteCalculoVivo(sello()) });
}

const idsDe = (filas: readonly FilaConAnios[]) => new Map(filas.map((f) => [f.clave, f.id]));

/** Las filas de la misma GML-AM (la base y las de tienda) de una fila. */
async function grupoDe(d: Db, proyeccionId: string, gmlId: string, agrupacionMarcaId: string, equivalenciaId: string | null) {
  const r = await leerFilasConAnios(d, proyeccionId, { columnas: "completas", gmlId, agrupacionMarcaId });
  if (r.error) return { data: [] as FilaConAnios[], error: r.error };
  return { data: r.data.filter((f) => (f.equivalencia_id ?? null) === equivalenciaId), error: null };
}

// ─── PUT /filas/[filaId]/anios/[anio] ───

/**
 * Decide el total de un año de una fila: `decidido = null` vuelve a la propuesta, `origen = propuesta` copia la propuesta, `manual`
 * escribe la cifra. En una fila base del año en curso recalcula en el acto la propuesta del año siguiente (B2).
 *
 * `0.10.7` (07b), fila de tienda: aceptar la propuesta la FIJA (`manual`, D1). Si la tienda ya tiene total decidido `D`, el total pasa a
 * `D + Δ` («solo se mueve lo modificado», decisión de Javier) y se guarda como decisión del planner (quién, cuándo y «ajustado desde la
 * línea …»); las demás filas no se mueven y `Σ fijadas ≤ D'` siempre (D3). Sin `D`, solo se fija la fila (la tienda sigue sin decidir) y el
 * año siguiente de la fila se rehace (D2). Con `409 menor_que_vendido` si el total movido queda bajo lo vendido de la tienda en `Y`.
 */
export async function decidirFila(id: string, filaId: string, anio: number, cuerpo: DecisionCuerpo, actor: Actor): Promise<Salida<RespuestaDecidirFilaApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  if (!anioValido(p, anio)) return fallaMensaje("Ese año no es parte de la proyección.", 404);
  const ahora = sello();

  const grupoFila = await leerIdentidadFila(d, id, filaId);
  if (grupoFila.error) return fallaDb(grupoFila.error, "proyección: leer fila");
  if (!grupoFila.data) return fallaMensaje("Fila no encontrada.", 404);
  const g = grupoFila.data;
  const grupo = await grupoDe(d, id, g.gml_id, g.agrupacion_marca_id, g.equivalencia_id);
  if (grupo.error) return fallaDb(grupo.error, "proyección: leer el grupo de la fila");
  const objetivo = grupo.data.find((f) => f.id === filaId);
  if (!objetivo) return fallaMensaje("Fila no encontrada.", 404);

  const k = kDe(p);
  const Y = p.anio_en_curso;
  const modelos = grupo.data.map((f) => aFilaModelo(f, k, Y));
  const modelo = modelos.find((f) => f.clave === objetivo.clave) as FilaModelo;
  const registro = registroDe(modelo, anio);
  if (!registro) return fallaMensaje("Esa fila no tiene un registro para ese año.", 404);

  // Qué se pide exactamente (solo crecimiento = no se toca la decisión que ya había).
  const soloCrecimiento = cuerpo.decidido === undefined && cuerpo.crecimiento_pct !== undefined && cuerpo.origen === "manual";
  const volver = cuerpo.decidido === null;
  const decidido = volver ? null : soloCrecimiento ? registro.decidido : cuerpo.origen === "propuesta" ? (registro.propuesto ?? 0) : (cuerpo.decidido ?? null);
  const rechazo = motivoRechazoDecision({
    estado: estadoDe(p),
    calculandoDesde: p.calculando_desde,
    ahora,
    filaActiva: objetivo.activo && (objetivo.proyeccion_fila_anios.find((a) => a.anio === anio)?.activo ?? true),
    anio,
    anioEnCurso: Y,
    vendido: registro.vendido,
    propuesto: registro.propuesto,
    decidido: soloCrecimiento ? (registro.decidido ?? null) : volver ? null : (decidido ?? 0),
    origen: soloCrecimiento ? "manual" : cuerpo.origen,
  });
  if (rechazo) return fallaRegla(rechazo);
  if (cuerpo.crecimiento_pct !== undefined && !(modelo.tienda_id === null && anio === Y + 1)) {
    return fallaMensaje("El crecimiento solo se escribe en el año siguiente de una fila de mismas tiendas.", 400);
  }

  const cat = await cargarCatalogo(d);
  if (cat.respuesta) return falla(cat.respuesta);
  const tiendasRows = await leerTiendasProyeccion(d, id);
  if (tiendasRows.error) return fallaDb(tiendasRows.error, "proyección: leer tiendas");
  const parametros = parametrosDe(p.parametros);
  const ctx = contextoModelo(p, parametros, cat.data.catalogo, tiendasRows.data, modelos);

  const tiendasDeLaFila = modelos.filter((f) => f.tienda_id !== null);
  const nuevo = aplicarDecision(
    modelo,
    tiendasDeLaFila,
    anio,
    {
      decidido: soloCrecimiento ? (registro.decidido ?? null) : volver ? null : (decidido ?? null),
      origen: soloCrecimiento ? "manual" : cuerpo.origen,
      nota: cuerpo.nota === undefined ? (volver ? null : registro.nota) : cuerpo.nota,
      crecimiento_pct: cuerpo.crecimiento_pct,
      decidido_por_nombre: actor.nombre,
      decidido_at: ahora,
    },
    ctx
  );

  if (modelo.tienda_id === null) {
    // Justo antes de la primera escritura: cuanto menos se lee entre esta comprobación y el guardado, menos crece la ventana con un cierre.
    const editable = await sigueEditable(d, id);
    if (editable.respuesta) return falla(editable.respuesta);
    const w = await guardarRegistros(d, [nuevo], idsDe(grupo.data), [Y, Y + 1], ahora, actor);
    if (w.error) return fallaDb(w.error, "proyección: guardar la decisión");
    await refrescarResumen(d, p);
    const r = registroDe(nuevo, anio) as NonNullable<ReturnType<typeof registroDe>>;
    return listo(aAnioApi(r));
  }

  // Una fila de tienda: se guarda su cifra y, si la tienda ya tiene total decidido, ese total se mueve en lo que cambió la fila.
  const tiendaId = modelo.tienda_id;
  const filaTienda = tiendasRows.data.find((t) => t.tienda_id === tiendaId && t.anio === anio && t.activo);
  let mover: { decidido: number; nota: string | null } | null = null;
  const registroNuevo = registroDe(nuevo, anio);
  if (filaTienda && filaTienda.decidido !== null && !volver && registroNuevo) {
    // Σ de lo fijado a mano en TODAS las filas de la tienda (con la nueva): el total nunca queda por debajo (D3).
    // Solo cuentan filas y años activos: una fila desactivada no «fija» nada en el total de la tienda.
    const deLaTienda = await leerFilasConAnios(d, id, { columnas: "completas", tiendaId, soloActivas: true });
    if (deLaTienda.error) return fallaDb(deLaTienda.error, "proyección: leer las filas de la tienda");
    const modelosTienda = deLaTienda.data
      .filter((f) => f.activo)
      .map((f) => aFilaModelo({ ...f, proyeccion_fila_anios: f.proyeccion_fila_anios.filter((a) => a.activo) }, k, Y))
      .map((f) => (f.clave === nuevo.clave ? nuevo : f));
    const sumaFijadas = modelosTienda.reduce((s, f) => {
      const r = registroDe(f, anio);
      return s + (r && r.origen === "manual" && r.decidido !== null ? r.decidido : 0);
    }, 0);
    const total = totalTiendaTrasMover({ decidido: filaTienda.decidido, vigenteAnterior: registro.vigente, vigenteNuevo: registroNuevo.vigente ?? 0, sumaFijadas });
    const rechazoTotal = motivoRechazoTotalTienda({ anio, anioEnCurso: Y, nuevoTotal: total, vendidoTienda: filaTienda.vendido });
    if (rechazoTotal) return fallaRegla(rechazoTotal);
    const nodo = cat.data.catalogo.nodos.get(g.gml_id);
    const linea = nodo ? `${nodo.genero} · ${nodo.mundo} · ${nodo.linea}` : "de esta fila";
    mover = { decidido: total, nota: notaMoverTotal(filaTienda.nota, linea) };
  }

  // Justo antes de la primera escritura (ver arriba).
  const editable = await sigueEditable(d, id);
  if (editable.respuesta) return falla(editable.respuesta);
  // Bloqueo optimista: el total nuevo es `D + Δ` sobre el `D` que se leyó; si otro PUT lo movió entretanto, el UPDATE condicional no toca
  // ninguna fila y se responde 409 SIN haber escrito la fila (el total se mueve ANTES de guardarla, así no queda nada a medias).
  if (mover && filaTienda) {
    const bloqueo = await actualizarTotalTiendaCondicional(d, filaTienda.id, filaTienda.decidido, {
      decidido: mover.decidido,
      origen: "manual",
      nota: mover.nota,
      decidido_at: ahora,
      decidido_por_id: actor.id,
      decidido_por_nombre: actor.nombre,
    });
    if (bloqueo.error) return fallaDb(bloqueo.error, "proyección: mover el total de la tienda");
    if (!bloqueo.data) return fallaMensaje(MENSAJE_TIENDA_CAMBIO, 409, "conflicto");
  }
  const w = await guardarRegistros(d, [nuevo], idsDe(grupo.data), [anio], ahora, actor);
  if (w.error) {
    // La fila no se escribió: se devuelve el total a como estaba (solo si nadie lo movió después).
    if (mover && filaTienda) {
      await actualizarTotalTiendaCondicional(d, filaTienda.id, mover.decidido, {
        decidido: filaTienda.decidido,
        origen: filaTienda.origen,
        nota: filaTienda.nota,
        decidido_at: filaTienda.decidido_at,
        decidido_por_id: filaTienda.decidido_por_id,
        decidido_por_nombre: filaTienda.decidido_por_nombre,
      });
    }
    return fallaDb(w.error, "proyección: guardar la decisión");
  }
  const fila = await propagarTienda(d, p, parametros, cat.data.catalogo, tiendasRows.data, ctx, tiendaId, anio, actor, ahora, null, mover);
  if (fila.respuesta) return falla(fila.respuesta);
  await refrescarResumen(d, p);
  const recargada = await grupoDe(d, id, g.gml_id, g.agrupacion_marca_id, g.equivalencia_id);
  if (recargada.error) return fallaDb(recargada.error, "proyección: releer la fila");
  const r = recargada.data.find((f) => f.id === filaId);
  const reg = r ? aFilaModelo(r, k, Y).registros.find((x) => x.anio === anio) : undefined;
  const t = fila.data.tienda;
  return listo({ ...aAnioApi(reg ?? registro), tienda: { anio, decidido: t.decidido, suma_filas: t.suma_filas ?? 0 } });
}

/** Fallo de base a mitad de `propagarTienda`: lo ya guardado puede ser parcial. Detalle crudo al log; al usuario, que recargue. */
function fallaGuardado(e: Parameters<typeof registrarErrorDb>[0], contexto: string): Salida<never> {
  registrarErrorDb(e, contexto);
  return fallaMensaje(MENSAJE_GUARDADO_PARCIAL, 500, "guardado_parcial");
}

/**
 * Tras fijar una fila de tienda: re-escala las demás con el total decidido de la tienda (si lo hay) y propaga a la base del año
 * siguiente (B2) si la tienda pasa a `M(Y+1)`.
 */
async function propagarTienda(
  d: Db,
  p: ProyeccionDb,
  parametros: ReturnType<typeof parametrosDe>,
  catalogo: Catalogo,
  tiendasRows: readonly TiendaPyDb[],
  ctx: ContextoModelo,
  tiendaId: string,
  anio: number,
  actor: Actor,
  ahora: string,
  decision: { decidido: number | null; origen: "propuesta" | "manual"; nota?: string | null; rampa?: readonly number[] | null } | null,
  /** `0.10.7`: el total de la tienda pasa a este valor (decisión explícita del planner) sin re-escalar las demás filas. */
  mover: { decidido: number; nota: string | null } | null = null
): Promise<Salida<{ tienda: TiendaProyeccionApi; filas_base_recalculadas: number }>> {
  const k = kDe(p);
  const Y = p.anio_en_curso;
  const filas = await leerFilasConAnios(d, p.id, { columnas: "completas", tiendaId });
  if (filas.error) return fallaGuardado(filas.error, "proyección: leer las filas de la tienda");
  const modelos = filas.data.map((f) => aFilaModelo(f, k, Y));
  const fila = tiendasRows.find((t) => t.tienda_id === tiendaId && t.anio === anio);

  // Total decidido de la tienda en sus OTROS años: al rehacer uno (p. ej. `Y+1` tras editar `Y`) se vuelve a aplicar, para que `Σ filas = D` en los dos.
  const otrosTotales: TotalesOtrosAnios = new Map(
    tiendasRows
      .filter((t) => t.tienda_id === tiendaId && t.anio !== anio && t.activo && t.decidido !== null)
      .map((t) => [t.anio, { decidido: t.decidido as number, decidido_por_nombre: t.decidido_por_nombre, decidido_at: t.decidido_at }] as const)
  );
  const D = decision ?? (fila && fila.decidido !== null ? { decidido: fila.decidido, origen: (fila.origen === "propuesta" ? "propuesta" : "manual") as "propuesta" | "manual", nota: fila.nota } : null);
  const r: ResultadoDecisionTienda = mover
    ? moverTotalTienda({ filas: modelos, tiendaId, anio, decision: mover, ctx, otrosTotales })
    : aplicarDecisionTienda({
        filas: modelos,
        tiendaId,
        anio,
        decision: D
          ? { decidido: D.decidido, origen: D.origen, nota: D.nota ?? null, rampa: decision?.rampa ?? null, decidido_por_nombre: actor.nombre, decidido_at: ahora }
          : { decidido: null, origen: "manual", rampa: null },
        ctx,
        otrosTotales,
      });
  // Sin total decidido `aplicarDecisionTienda` solo suelta las escaladas huérfanas y conserva las fijadas (`manual`); además rehace el año
  // siguiente de la tienda (D2): por eso se guardan SIEMPRE sus filas, no las leídas.
  const filasFinales = r.filas;
  const anios = decision?.rampa ? [Y, Y + 1] : [anio, ...(anio === Y ? [Y + 1] : [])];
  const ids = idsDe(filas.data);
  // Otra vez justo antes de escribir: desde la comprobación del handler se han leído filas y tiendas.
  const editable = await sigueEditable(d, p.id);
  if (editable.respuesta) return falla(editable.respuesta);
  const w = await guardarRegistros(d, filasFinales, ids, anios, ahora, actor);
  if (w.error) return fallaGuardado(w.error, "proyección: guardar las filas de la tienda");

  // Totales de la tienda (ambos años) y su decisión.
  // Con una rampa nueva `F` cambia: las unidades maduras (de la tienda y de cada fila) se rehacen con la rampa efectiva.
  const maduras = decision?.rampa ? unidadesMadurasDeTienda(filasFinales, ctx.tiendas.get(tiendaId), decision.rampa) : null;
  if (maduras) {
    for (const f of filasFinales) {
      const md = maduras.porFila.get(f.clave);
      const filaId = ids.get(f.clave);
      if (md === undefined || !filaId || !f.composicion) continue;
      const e = await actualizarComposicionFila(d, filaId, comoJson({ ...f.composicion, unidades_maduras: md }));
      if (e.error) return fallaGuardado(e.error, "proyección: guardar la composición de la tienda");
    }
  }
  const filasDeLaTienda = tiendasRows.filter((t) => t.tienda_id === tiendaId);
  for (const t of filasDeLaTienda) {
    const registros = filasFinales.map((f) => registroDe(f, t.anio)).filter((x): x is NonNullable<typeof x> => x !== undefined);
    const vendido = registros.reduce((s, x) => s + x.vendido, 0);
    const propuesto = registros.some((x) => x.propuesto !== null) ? registros.reduce((s, x) => s + (x.propuesto ?? 0), 0) : null;
    const esEste = t.anio === anio;
    const cambio: Parameters<typeof actualizarTiendaProyeccion>[2] = { vendido, propuesto };
    if (decision?.rampa) cambio.rampa = [...decision.rampa];
    if (maduras && t.bloque === "nuevas") cambio.unidades_maduras = unidadesMadurasEntero(maduras.total);
    if (esEste && (decision || mover)) {
      const D2 = r.tienda;
      cambio.decidido = D2.decidido;
      cambio.origen = D2.origen;
      cambio.propuesta_al_decidir = D2.propuesta_al_decidir;
      cambio.nota = D2.nota;
      cambio.decidido_at = D2.decidido === null ? null : ahora;
      cambio.decidido_por_id = D2.decidido === null ? null : actor.id;
      cambio.decidido_por_nombre = D2.decidido === null ? null : actor.nombre;
    }
    const act = await actualizarTiendaProyeccion(d, t.id, cambio);
    if (act.error) return fallaGuardado(act.error, "proyección: guardar la tienda");
  }

  // B2: la base del año siguiente de cada GML-AM de la tienda que pasa a `M(Y+1)`.
  let recalculadas = 0;
  if (anio === Y && ctx.mismasSiguiente.has(tiendaId)) {
    const claves = [...new Set(filasFinales.filter((f) => registroDe(f, Y)?.bloque === "nuevas").map((f) => claveBaseDe(f.clave)))];
    const gmlIds = [...new Set(claves.map((c) => c.split("|")[1]))];
    const grupo = await leerFilasConAnios(d, p.id, { columnas: "completas", gmlIds });
    if (grupo.error) return fallaGuardado(grupo.error, "proyección: leer las filas base");
    const todas = grupo.data.map((f) => aFilaModelo(f, k, Y));
    const sustituidas = new Map(filasFinales.map((f) => [f.clave, f]));
    const conCambios = todas.map((f) => sustituidas.get(f.clave) ?? f);
    const porClave = new Map<string, FilaModelo[]>();
    for (const f of conCambios) if (f.tienda_id !== null) porClave.set(claveBaseDe(f.clave), [...(porClave.get(claveBaseDe(f.clave)) ?? []), f]);
    const bases = conCambios.filter((f) => f.tienda_id === null && claves.includes(f.clave));
    const nuevasBases = bases.map((b) => recalcularBaseSiguiente(b, porClave.get(b.clave) ?? [], ctx));
    const idsBase = idsDe(grupo.data);
    const wb = await guardarRegistros(d, nuevasBases, idsBase, [Y + 1], ahora, actor);
    if (wb.error) return fallaGuardado(wb.error, "proyección: guardar la base del año siguiente");
    recalculadas = nuevasBases.length;
  }

  const tiendasActual = await leerTiendasProyeccion(d, p.id);
  if (tiendasActual.error) return fallaGuardado(tiendasActual.error, "proyección: releer tiendas");
  const rowFinal = tiendasActual.data.find((t) => t.tienda_id === tiendaId && t.anio === anio);
  if (!rowFinal) return fallaMensaje("La tienda no está en esa proyección.", 404);
  // Las filas de la tienda no viajan en la respuesta (pesan mucho): se piden con `GET …/tiendas/[tiendaId]/filas?anio=`.
  // Suma de lo vigente de las filas de la tienda en ese año y cuántas están fijadas (la tarjeta y la respuesta de una fila la usan).
  const regsAnio = filasFinales.map((f) => registroDe(f, anio)).filter((x): x is RegistroModelo => x !== undefined);
  const resumenFilas = {
    suma_filas: regsAnio.length === 0 ? null : regsAnio.reduce((s, x) => s + (x.vigente ?? 0), 0),
    filas_fijadas: regsAnio.filter((x) => x.origen === "manual" && x.decidido !== null).length,
  };
  return listo({ tienda: aTiendaApi(rowFinal, [], catalogo, parametros, p, resumenFilas), filas_base_recalculadas: recalculadas });
}

// ─── PUT /tiendas/[tiendaId]/anios/[anio] ───

/**
 * Decide el total de una tienda nueva (o cierre) en un año, o cambia su rampa. Reescala sus filas no fijadas (`escalada`); si la
 * tienda de `Y` pasa a `M(Y+1)` recalcula en el acto la propuesta de `Y+1` de las filas base de sus GML-AM (B2).
 */
export async function decidirTienda(id: string, tiendaId: string, anio: number, cuerpo: DecisionTiendaCuerpo, actor: Actor): Promise<Salida<TiendaProyeccionApi & { filas_base_recalculadas: number }>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  if (!anioValido(p, anio)) return fallaMensaje("Ese año no es parte de la proyección.", 404);
  const ahora = sello();
  const rechazo = motivoRechazoEdicion({ estado: estadoDe(p), calculandoDesde: p.calculando_desde, ahora });
  if (rechazo) return fallaRegla(rechazo);

  const tiendasRows = await leerTiendasProyeccion(d, id);
  if (tiendasRows.error) return fallaDb(tiendasRows.error, "proyección: leer tiendas");
  const fila = tiendasRows.data.find((t) => t.tienda_id === tiendaId && t.anio === anio && t.activo);
  if (!fila) return fallaMensaje("La tienda no está en esa proyección para ese año.", 404);

  const k = kDe(p);
  const Y = p.anio_en_curso;
  const soloRampa = cuerpo.decidido === undefined && cuerpo.rampa !== undefined;
  const volver = cuerpo.decidido === null;
  let decidido: number | null;
  if (volver) decidido = null;
  else if (soloRampa) decidido = fila.decidido;
  else if (cuerpo.origen === "propuesta") decidido = fila.propuesto === null ? null : fila.propuesto;
  else decidido = cuerpo.decidido ?? null;

  if (!volver && !soloRampa && cuerpo.origen === "propuesta" && fila.propuesto === null) {
    return fallaMensaje("No hay propuesta que aceptar: escribe el total.", 409, "sin_propuesta");
  }
  if (decidido !== null && anio === Y && decidido < fila.vendido && !soloRampa) {
    return fallaMensaje(`El total de ${anio} no puede ser menor que lo ya vendido (${fila.vendido.toLocaleString("es-PE")}).`, 409, "menor_que_vendido");
  }

  const cat = await cargarCatalogo(d);
  if (cat.respuesta) return falla(cat.respuesta);
  const parametros = parametrosDe(p.parametros);
  const filas = await leerFilasConAnios(d, id, { columnas: "completas", tiendaId });
  if (filas.error) return fallaDb(filas.error, "proyección: leer las filas de la tienda");
  const ctx = contextoModelo(p, parametros, cat.data.catalogo, tiendasRows.data, filas.data.map((f) => aFilaModelo(f, k, Y)));

  const resultado = await propagarTienda(d, p, parametros, cat.data.catalogo, tiendasRows.data, ctx, tiendaId, anio, actor, ahora, {
    decidido,
    origen: soloRampa ? (fila.origen === "propuesta" ? "propuesta" : "manual") : cuerpo.origen,
    nota: cuerpo.nota === undefined ? fila.nota : cuerpo.nota,
    rampa: cuerpo.rampa ?? null,
  });
  if (resultado.respuesta) return falla(resultado.respuesta);
  await refrescarResumen(d, p);

  // La frase de la tarjeta se rehace solo si cambió la rampa (lo único que la altera); si no, queda la que se guardó al calcular.
  const t = resultado.data.tienda;
  if (cuerpo.rampa === undefined) return listo({ ...t, filas_base_recalculadas: resultado.data.filas_base_recalculadas });
  // Todas las curvas que usan las filas de la tienda (una tienda con varias líneas no usa una sola).
  const curvasUsadas = [
    ...new Set(
      filas.data
        .map((f) => textoCurva(aFilaModelo(f, k, Y).curva_origen.map((o) => ({ nombre: ctx.nombresCurva.get(o.agrupacion_id) ?? "curva", version: o.version, peso: o.peso }))))
        .filter((x): x is string => x !== null)
    ),
  ];
  // `F` y `K = E ÷ F` con la rampa nueva (la frase de una apertura los nombra).
  const fraccion = t.bloque === "nuevas" ? fraccionDeTienda(filas.data.map((f) => aFilaModelo(f, k, Y)), ctx.tiendas.get(tiendaId), t.rampa) : null;
  const frase = explicar({
    metodo: t.metodo,
    anio,
    anioEnCurso: Y,
    k: anio === Y ? k : 0,
    vendido: t.vendido,
    propuesto: t.propuesto,
    curvaTexto: curvasUsadas.length > 0 ? curvasUsadas.join("; ") : null,
    tienda: { codigo: t.codigo, nombre: t.nombre },
    referente: t.referente?.codigo ?? null,
    origenComposicion: t.origen_composicion,
    ventaEsperada: t.venta_esperada,
    unidadesMaduras: t.unidades_maduras,
    rampa: t.rampa,
    apertura: t.bloque === "nuevas" ? t.fecha_usada : null,
    fechaCierre: t.bloque === "cierres" ? t.fecha_usada : null,
    mesesCompletos: t.bloque === "nuevas" ? mesesCompletos(t.fecha_usada, Y, k) : 0,
    referenciaAlternativa: t.referencia_alternativa,
    referenciaTresMeses: t.referencia_tres_meses,
    fraccionAnioApertura: fraccion,
    anioMaduroSoles: fraccion !== null && t.venta_esperada !== null ? anioMaduroSoles(t.venta_esperada, fraccion) : null,
    crecimiento: parametros.crecimiento_pct_defecto,
  });
  const fila2 = (await leerTiendasProyeccion(d, id)).data.find((x) => x.tienda_id === tiendaId && x.anio === anio);
  if (fila2) {
    const actualizado = await actualizarTiendaProyeccion(d, fila2.id, { explicacion: frase });
    if (actualizado.error) return fallaDb(actualizado.error, "proyección: guardar la explicación");
  }
  return listo({ ...resultado.data.tienda, explicacion: frase, filas_base_recalculadas: resultado.data.filas_base_recalculadas });
}

// ─── POST /aplicar-curva ───

/**
 * I8. Copia `meses_propuestos` → `meses` y `curva_origen_propuesta` → `curva_origen_usada` en los registros indicados que tengan
 * `meses_propuestos`; devuelve cuántos. Sobre una cerrada es `409`: una cerrada nunca se vuelve a repartir.
 */
export async function aplicarCurva(id: string, cuerpo: { fila_anio_ids?: string[]; gml_id?: string; anio?: number }): Promise<Salida<{ aplicadas: number }>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const rechazo = motivoRechazoAplicarCurva({ estado: estadoDe(pR.data), calculandoDesde: pR.data.calculando_desde, ahora: sello() });
  if (rechazo) return fallaRegla(rechazo);

  type Anio = FilaConAnios["proyeccion_fila_anios"][number];
  let registros: { id: string; anio: Anio }[] = [];
  if (cuerpo.fila_anio_ids) {
    const r = await leerAniosPorIds(d, cuerpo.fila_anio_ids);
    if (r.error) return fallaDb(r.error, "proyección: leer registros");
    registros = r.data.filter((a) => a.proyeccion_filas?.proyeccion_id === id).map((a) => ({ id: a.id, anio: a }));
  } else if (cuerpo.gml_id) {
    const r = await leerFilasConAnios(d, id, { columnas: "completas", gmlId: cuerpo.gml_id, soloActivas: true });
    if (r.error) return fallaDb(r.error, "proyección: leer la línea");
    for (const f of r.data) for (const a of f.proyeccion_fila_anios) if (a.activo && (cuerpo.anio === undefined || a.anio === cuerpo.anio)) registros.push({ id: a.id, anio: a });
  }

  // Un solo `upsert` en lote con las columnas de la curva (no se tocan las decisiones ni el resto del registro).
  const k = kDe(pR.data);
  const lote: TablesInsert<"proyeccion_fila_anios">[] = [];
  for (const x of registros) {
    if (!x.anio.activo || x.anio.meses_propuestos === null || x.anio.meses_propuestos === undefined) continue;
    const nuevo = aplicarCurvaNueva(aRegistro(x.anio, null, k, pR.data.anio_en_curso));
    lote.push({
      fila_id: x.anio.fila_id,
      anio: x.anio.anio,
      bloque: x.anio.bloque,
      meses: nuevo.meses,
      meses_propuestos: null,
      curva_origen_usada: comoJson(nuevo.curva_origen_usada),
      curva_origen_propuesta: null,
      avisos: comoJson(nuevo.avisos),
    });
  }
  if (lote.length > 0) {
    const editable = await sigueEditable(d, id);
    if (editable.respuesta) return falla(editable.respuesta);
    const r = await upsertAnios(d, lote);
    if (r.error) return fallaDb(r.error, "proyección: aplicar la curva nueva");
    await refrescarResumen(d, pR.data);
  }
  const aplicadas = lote.length;
  return listo({ aplicadas });
}
