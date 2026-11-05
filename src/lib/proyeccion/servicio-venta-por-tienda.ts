import { supabaseAdmin } from "@/lib/supabase/admin";
import { leerTiendas } from "@/lib/tiendas/consultas";
import { cargarCatalogo } from "./contexto";
import { leerFilasConAnios, leerGenerosMundos, leerVentaTiendaNodos } from "./consultas";
import { generosDeMatriz, type FilaCrecimiento } from "./crecimientos";
import { calculoEnCurso, MENSAJE_CALCULO_EN_CURSO_PROYECCION } from "./reglas";
import { falla, fallaDb, fallaMensaje, kDe, listo, parametrosDe, proyeccionOr404, sello, type Db, type Salida } from "./servicio-base";
import type { ConjuntosPorTiendaApi, ResumenProyeccion, VentaPorTiendaApi } from "./tipos";
import { armarVentaPorTienda, desdeVentaTienda, vigentesDeTiendasNuevas, type FilaTiendaNueva, type TiendaMaestroVenta } from "./venta-por-tienda";

/**
 * Servicio de «Ver por tienda» de Crecimientos (ficha 07f, §2.3 y §4). SOLO LECTURA: lee la proyección ya calculada, sus filas base de `Y+1`, sus filas de tienda de `Y`, las
 * tiendas de M4 (nombre y código) y la venta publicada por tienda con soles (`venta_tienda_nodos`, sin CD). No escribe nada, no lee `historico`, factores, IA ni stock. Lo
 * que se muestra se arma en `venta-por-tienda.ts` (puro). Solo servidor.
 */

const db = (): Db => supabaseAdmin();

export const MENSAJE_SIN_CALCULAR = "Calcula la proyección para ver la venta por tienda.";
export const MENSAJE_GENERO_NO_DETALLADO = "Ese género va en el Resto: usa gm=resto.";
export const MENSAJE_GM_NO_ENCONTRADO = "Ese género y mundo no existen en el catálogo.";
const MENSAJE_VENTA_ILEGIBLE = "No se pudo leer la venta por tienda. Inténtalo de nuevo.";

const numeroONulo = (v: number | string | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/**
 * `GET …/crecimientos/por-tienda` SIN `gm` (corrección 2026-11-05): los conjuntos que se pueden ver por tienda, HOMBRE y MUJER (`generosDeMatriz`) × cada mundo activo y el Resto, con la
 * clave que acepta `?gm=`. Sale solo del catálogo de géneros y mundos (no de las filas de la proyección ni de su cálculo): sirve con una proyección de método anterior o sin calcular.
 * `404` si la proyección no existe. No lee venta, filas ni tiendas.
 */
export async function leerConjuntosPorTienda(id: string): Promise<Salida<ConjuntosPorTiendaApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const gm = await leerGenerosMundos(d);
  if (gm.error) return fallaDb(gm.error, "por tienda: leer géneros y mundos");
  const mundos = gm.mundos.filter((m) => m.activo !== false);
  const conjuntos: ConjuntosPorTiendaApi["conjuntos"] = [];
  for (const g of generosDeMatriz(gm.generos)) {
    for (const m of mundos) conjuntos.push({ clave: `${g.id}.${m.id}`, nombre: `${g.nombre} · ${m.nombre}`, es_resto: false });
  }
  conjuntos.push({ clave: "resto", nombre: "Resto", es_resto: true });
  return listo({ conjuntos });
}

/**
 * `GET …/crecimientos/por-tienda?gm=`: la venta por tienda y año de un género × mundo (`genero_id.mundo_id`) o del Resto (`resto`). `404` si la proyección no existe o el
 * género o el mundo no están en el catálogo; `400 genero_no_detallado` si el género no es de la matriz (va en el Resto); `409 calculo_en_curso` o `409 sin_calcular`.
 */
export async function leerVentaPorTienda(id: string, gm: string): Promise<Salida<VentaPorTiendaApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  if (p.estado === "en_trabajo" && calculoEnCurso(p.calculando_desde, sello())) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");
  const Y = p.anio_en_curso;
  const bloques = parametrosDe(p.parametros).bloques;
  const bloquesY = bloques[Y];
  const bloquesSig = bloques[Y + 1];
  if (!bloquesY || !bloquesSig) return fallaMensaje(MENSAJE_SIN_CALCULAR, 409, "sin_calcular");

  // El conjunto: los nodos de un género × mundo de HOMBRE o MUJER, o los de todos los demás géneros (el Resto), con el árbol vigente: la misma asignación que `GET …/crecimientos`.
  const [cat, gmCatalogo] = await Promise.all([cargarCatalogo(d), leerGenerosMundos(d)]);
  if (cat.respuesta) return falla(cat.respuesta);
  if (gmCatalogo.error) return fallaDb(gmCatalogo.error, "por tienda: leer géneros y mundos");
  const catalogo = cat.data.catalogo;
  const detallados = new Set(generosDeMatriz(gmCatalogo.generos).map((g) => g.id));
  const esResto = gm === "resto";
  let conjunto: VentaPorTiendaApi["conjunto"];
  let nodos: string[];
  let claveResumen: string;
  if (esResto) {
    conjunto = { clave: "resto", nombre: "Resto", es_resto: true };
    nodos = [...catalogo.nodos].filter(([, n]) => !detallados.has(n.genero_id)).map(([nodoId]) => nodoId);
    claveResumen = "resto";
  } else {
    const [generoId = "", mundoId = ""] = gm.toLowerCase().split(".");
    const genero = gmCatalogo.generos.find((g) => g.id === generoId);
    const mundo = gmCatalogo.mundos.find((m) => m.id === mundoId);
    if (!genero || !mundo) return fallaMensaje(MENSAJE_GM_NO_ENCONTRADO, 404, "gm_no_encontrado");
    if (!detallados.has(generoId)) return fallaMensaje(MENSAJE_GENERO_NO_DETALLADO, 400, "genero_no_detallado");
    conjunto = { clave: `${generoId}.${mundoId}`, nombre: `${genero.nombre} · ${mundo.nombre}`, es_resto: false };
    nodos = [...catalogo.nodos].filter(([, n]) => n.genero_id === generoId && n.mundo_id === mundoId).map(([nodoId]) => nodoId);
    claveResumen = `${generoId}|${mundoId}`;
  }
  const nodosDelConjunto = new Set(nodos);
  const hasta = p.hasta_periodo.slice(0, 7);

  const [filasBase, filasTienda, tiendas, venta] = await Promise.all([
    leerFilasConAnios(d, id, { columnas: "ligeras", tiendaId: null, soloActivas: true }),
    leerFilasConAnios(d, id, { columnas: "ligeras", soloTiendas: true, soloActivas: true }),
    leerTiendas(d, { soloActivas: false }),
    leerVentaTiendaNodos(d, { gmlIds: nodos, desde: desdeVentaTienda(Y), hasta }),
  ]);
  if (filasBase.error) return fallaDb(filasBase.error, "por tienda: leer las filas base");
  if (filasTienda.error) return fallaDb(filasTienda.error, "por tienda: leer las filas de tienda");
  if (tiendas.error) return fallaDb(tiendas.error, "por tienda: leer las tiendas");
  if (venta.error) return fallaDb(venta.error, "por tienda: leer la venta");
  if (!venta.data) return fallaMensaje(MENSAJE_VENTA_ILEGIBLE, 500);

  // Filas base activas de `Y+1` del conjunto (las mismas que agrega `GET …/crecimientos`); `clavesConB` son las que tienen `B`.
  const filas: FilaCrecimiento[] = [];
  const clavesConB = new Set<string>();
  for (const f of filasBase.data) {
    if (!nodosDelConjunto.has(f.gml_id)) continue;
    const a = f.proyeccion_fila_anios.find((x) => x.anio === Y + 1 && x.activo);
    const nodo = catalogo.nodos.get(f.gml_id);
    if (!a || !nodo) continue;
    const b = numeroONulo(a.base_siguiente);
    filas.push({
      fila_id: f.id,
      genero_id: nodo.genero_id,
      mundo_id: nodo.mundo_id,
      crecimiento_pct: numeroONulo(a.crecimiento_pct),
      decidido: a.decidido ?? null,
      propuesto: a.propuesto ?? null,
      base_siguiente: b,
      base_normalizada: numeroONulo(a.base_normalizada),
      sobre_base: "corregida",
    });
    if (b !== null) clavesConB.add(f.clave);
  }

  // Filas de tienda activas con registro de `Y` en `nuevas`: vigente = decidido ?? propuesto.
  const nuevas: FilaTiendaNueva[] = [];
  for (const f of filasTienda.data) {
    if (f.tienda_id === null || !nodosDelConjunto.has(f.gml_id)) continue;
    const r = f.proyeccion_fila_anios.find((x) => x.anio === Y && x.activo && x.bloque === "nuevas");
    if (!r) continue;
    nuevas.push({ tienda_id: f.tienda_id, clave: f.clave, vigente: Number(r.decidido ?? r.propuesto ?? 0) });
  }

  const maestro = new Map<string, TiendaMaestroVenta>(
    tiendas.data.map((t) => [t.id, { id: t.id, codigo: t.codigo, nombre: t.nombre, tipo: t.tipo, fecha_apertura: t.fecha_apertura, fecha_cierre: t.fecha_cierre }])
  );
  const resumen = p.resumen as unknown as Partial<ResumenProyeccion> | null;

  return listo(
    armarVentaPorTienda({
      conjunto,
      anio: Y,
      hastaPeriodo: hasta,
      k: kDe(p),
      versionMetodo: typeof resumen?.version_metodo === "number" ? resumen.version_metodo : null,
      series: venta.data.series,
      cargas: venta.data.cargas,
      bloquesY,
      bloquesSig,
      maestro,
      filasBase: filas,
      vigentes: vigentesDeTiendasNuevas(nuevas, clavesConB),
      fueraBase: resumen?.gm_fuera_base?.[claveResumen] ?? null,
    })
  );
}
