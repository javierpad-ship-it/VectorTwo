import "server-only";
import { randomUUID } from "node:crypto";
import type { Rol } from "@/lib/auth/roles";
import { errorConCodigo, errorConDetalle } from "@/lib/api/respuestas";
import { falla, fallaDb, fallaMensaje, listo, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { borrarObjetos, copiarObjeto, descargarObjeto, firmarObjeto, subirJpeg } from "./almacen";
import { HORAS_HUERFANAS, MAX_FOTOS_POR_LINEA, TANDA_LIMPIEZA, TTL_URL_FOTO_SEGUNDOS } from "./constantes";
import {
  leerContextoLinea,
  leerDatosLeyenda,
  leerFotoActiva,
  leerOrigenDeFotos,
  rpcAgregarFotoLinea,
  rpcEditarFichaLinea,
  rpcFotosHuerfanas,
  rpcQuitarFotoLinea,
  rpcTraerFotosLinea,
  type ActorFotoDb,
  type FotoDb,
  type RespuestaRpc,
} from "./consultas";
import { rutasDeFoto, urlMiniatura } from "./rutas";
import {
  ESTADO_HTTP_ERROR_FOTO,
  MENSAJE_ERROR_FOTO,
  type CodigoErrorFoto,
  type FotoGrandeApi,
  type FotoLineaApi,
  type LimpiezaFotosApi,
  type LineaFichaApi,
  type RespuestaTraerFotosApi,
  type ResultadoLimpiezaFotosApi,
} from "./tipos-api";
import { leerSubida } from "./validar";
import type { FichaLinea } from "./esquemas";

/**
 * Servicio de las fotos de las líneas y de la ficha de la línea (08c, §3.3). Solo servidor. Valida la subida, habla con el almacén
 * (`almacen.ts`) y escribe SOLO con las funciones `rpc` de `0039`. Si la función rechaza o falla DESPUÉS de subir, borra los objetos que
 * subió; lo que no pueda borrar lo recoge la limpieza (`fotos_huerfanas`). No toca `compras.revision` ni `flujo` (decisión 88).
 */

export type UsuarioFotos = { id: string; nombre: string; rol: Rol };

const actorDe = (u: UsuarioFotos): ActorFotoDb => ({ perfil_id: u.id, nombre: u.nombre, rol: u.rol });

const falloFoto = (codigo: CodigoErrorFoto): Salida<never> => fallaMensaje(MENSAJE_ERROR_FOTO[codigo], ESTADO_HTTP_ERROR_FOTO[codigo], codigo);

type Funcion = { ok: boolean; motivo: string | null; datos: Record<string, unknown> };

/** El `jsonb` de una función de `0039`: `{ ok: true, … }` o `{ ok: false, motivo }`. Cualquier otra cosa se trata como fallo inesperado. */
function leerFuncion(r: RespuestaRpc): Funcion | null {
  const d = r.data;
  if (typeof d !== "object" || d === null || Array.isArray(d)) return null;
  const datos = d as Record<string, unknown>;
  return { ok: datos.ok === true, motivo: typeof datos.motivo === "string" ? datos.motivo : null, datos };
}

const MOTIVOS_A_CODIGO: Readonly<Record<string, CodigoErrorFoto>> = {
  no_pertenece: "no_pertenece",
  no_editable: "no_editable",
  max_fotos: "max_fotos",
  ya_quitada: "ya_quitada",
  linea_cambio: "linea_cambio",
  sin_origen: "sin_origen",
  foto_invalida: "formato_invalido",
  ruta_invalida: "formato_invalido",
};

const falloInesperado = (contexto: string): Salida<never> => {
  console.error(`[fotos] respuesta inesperada de la base: ${contexto}`);
  return fallaMensaje("No pudimos completar la operación. Inténtalo de nuevo.", 500);
};

/** Borra objetos y, si falla, lo deja anotado en el log: la limpieza los recogerá (24 h después). */
async function limpiarObjetos(d: Db, rutas: readonly string[], contexto: string): Promise<void> {
  const r = await borrarObjetos(d, rutas);
  if (!r.ok) console.error(`[fotos] no se pudieron borrar ${rutas.length} objeto(s) (${contexto}): ${r.mensaje}`);
}

const aFotoLineaApi = (f: { id: string; ancho: number; alto: number }, por: string | null, at: string): FotoLineaApi => ({
  id: f.id,
  miniatura_url: urlMiniatura(f.id),
  ancho: f.ancho,
  alto: f.alto,
  subida_por: { nombre: por, at },
});

// ─── Subir ───

/** `POST …/fotos` (§3.3, pasos 2 a 9). `201` con la foto o el error con su código. */
export async function subirFotoLinea(d: Db, usuario: UsuarioFotos, compraId: string, lineaId: string, request: Request): Promise<Salida<FotoLineaApi>> {
  const subida = await leerSubida(request);
  if (!subida.ok) return falloFoto(subida.codigo);
  const s = subida.subida;

  // Pre-chequeo barato: evita subir dos objetos para una línea que ya sabemos que no admite la foto. La base vuelve a decidir bajo candado.
  const ctx = await leerContextoLinea(d, compraId, lineaId);
  if (ctx.error) return fallaDb(ctx.error, "fotos: leer la línea");
  if (!ctx.data.compra || !ctx.data.linea) return falloFoto("no_pertenece");
  if (ctx.data.compra.estado === "cancelada" || !ctx.data.linea.activo) return falloFoto("no_editable");
  if (ctx.data.activas >= MAX_FOTOS_POR_LINEA) return falloFoto("max_fotos");

  const fotoId = randomUUID();
  const rutas = rutasDeFoto(compraId, lineaId, fotoId);
  const grande = await subirJpeg(d, rutas.ruta, s.foto);
  if (!grande.ok) {
    console.error(`[fotos] fallo al subir la foto: ${grande.mensaje}`);
    return falloFoto("almacen_no_disponible");
  }
  const chica = await subirJpeg(d, rutas.ruta_miniatura, s.miniatura);
  if (!chica.ok) {
    console.error(`[fotos] fallo al subir la miniatura: ${chica.mensaje}`);
    await limpiarObjetos(d, [rutas.ruta], "subida a medias");
    return falloFoto("almacen_no_disponible");
  }

  const r = await rpcAgregarFotoLinea(d, compraId, lineaId, { id: fotoId, ancho: s.ancho, alto: s.alto, bytes: s.bytes_foto, bytes_miniatura: s.bytes_miniatura, ...rutas }, actorDe(usuario));
  if (r.error) {
    await limpiarObjetos(d, [rutas.ruta, rutas.ruta_miniatura], "la función falló");
    return fallaDb(r.error, "fotos: agregar_foto_linea");
  }
  const f = leerFuncion(r);
  if (!f) {
    await limpiarObjetos(d, [rutas.ruta, rutas.ruta_miniatura], "respuesta inesperada");
    return falloInesperado("agregar_foto_linea");
  }
  if (!f.ok) {
    await limpiarObjetos(d, [rutas.ruta, rutas.ruta_miniatura], `rechazada: ${f.motivo}`);
    const codigo = f.motivo ? MOTIVOS_A_CODIGO[f.motivo] : undefined;
    return codigo ? falloFoto(codigo) : falloInesperado(`agregar_foto_linea motivo ${f.motivo}`);
  }
  const creada = typeof (f.datos.foto as { created_at?: unknown } | undefined)?.created_at === "string" ? ((f.datos.foto as { created_at: string }).created_at) : new Date().toISOString();
  return listo(aFotoLineaApi({ id: fotoId, ancho: s.ancho, alto: s.alto }, usuario.nombre, creada));
}

// ─── Quitar ───

/** `DELETE …/fotos/[fotoId]`: la función pone `activo = false` y devuelve las rutas; después se borran los objetos. */
export async function quitarFotoLinea(d: Db, usuario: UsuarioFotos, compraId: string, lineaId: string, fotoId: string): Promise<Salida<{ id: string }>> {
  const r = await rpcQuitarFotoLinea(d, compraId, lineaId, fotoId, actorDe(usuario));
  if (r.error) return fallaDb(r.error, "fotos: quitar_foto_linea");
  const f = leerFuncion(r);
  if (!f) return falloInesperado("quitar_foto_linea");
  if (!f.ok) {
    const codigo = f.motivo ? MOTIVOS_A_CODIGO[f.motivo] : undefined;
    return codigo ? falloFoto(codigo) : falloInesperado(`quitar_foto_linea motivo ${f.motivo}`);
  }
  const rutas = [f.datos.ruta, f.datos.ruta_miniatura].filter((x): x is string => typeof x === "string");
  // Si el borrado falla, la fila ya está inactiva: el objeto lo recoge la limpieza (caso b).
  await limpiarObjetos(d, rutas, "foto quitada");
  return listo({ id: fotoId });
}

// ─── Ficha de la línea ───

/** `PATCH …/ficha`: descripción y modelo, con los valores que vio el formulario (`409 linea_cambio`). No usa la `revision` de la compra. */
export async function editarFichaLinea(d: Db, usuario: UsuarioFotos, compraId: string, lineaId: string, cuerpo: FichaLinea): Promise<Salida<LineaFichaApi>> {
  const r = await rpcEditarFichaLinea(d, compraId, lineaId, cuerpo.antes, { descripcion: cuerpo.descripcion, modelo: cuerpo.modelo }, actorDe(usuario));
  if (r.error) return fallaDb(r.error, "fotos: editar_ficha_linea");
  const f = leerFuncion(r);
  if (!f) return falloInesperado("editar_ficha_linea");
  if (!f.ok) {
    if (f.motivo === "linea_cambio") {
      return falla(errorConDetalle(MENSAJE_ERROR_FOTO.linea_cambio, 409, "linea_cambio", { actual: f.datos.actual ?? null }));
    }
    const codigo = f.motivo ? MOTIVOS_A_CODIGO[f.motivo] : undefined;
    return codigo ? falloFoto(codigo) : falloInesperado(`editar_ficha_linea motivo ${f.motivo}`);
  }
  const texto = (v: unknown) => (typeof v === "string" ? v : null);
  return listo({ linea_id: lineaId, descripcion: texto(f.datos.descripcion), modelo: texto(f.datos.modelo) });
}

// ─── Traer fotos de la versión cancelada ───

/**
 * `POST …/fotos/traer` (decisión 104): copia en Storage las fotos activas de la misma línea de la versión cancelada (misma
 * `clave_importacion` y proveedor) hasta completar 3, y las registra con `traer_fotos_linea`. Las del origen no cambian. Traer dos veces
 * no duplica: las ya traídas se saltan sin copiar.
 */
export async function traerFotosDeCancelada(d: Db, usuario: UsuarioFotos, compraId: string, lineaId: string): Promise<Salida<RespuestaTraerFotosApi>> {
  const ctx = await leerContextoLinea(d, compraId, lineaId);
  if (ctx.error) return fallaDb(ctx.error, "fotos: leer la línea");
  if (!ctx.data.compra || !ctx.data.linea) return falloFoto("no_pertenece");
  if (ctx.data.compra.estado === "cancelada" || !ctx.data.linea.activo) return falloFoto("no_editable");

  const origen = await leerOrigenDeFotos(d, ctx.data.linea, ctx.data.compra.proveedor_id);
  if (origen.error) return fallaDb(origen.error, "fotos: buscar las fotos de la versión cancelada");
  if (!origen.data) return falloFoto("sin_origen");

  const yaTraidas = new Set(origen.data.ya_traidas);
  const nuevas = origen.data.fotos.filter((f) => !yaTraidas.has(f.id));
  const saltadas = origen.data.fotos.length - nuevas.length;
  if (nuevas.length === 0) return listo({ traidas: [], saltadas, activas: ctx.data.activas });
  if (ctx.data.activas >= MAX_FOTOS_POR_LINEA) return falloFoto("max_fotos");

  // Solo se copian las que caben: la función acepta las más antiguas hasta llegar a 3 activas.
  const cupo = MAX_FOTOS_POR_LINEA - ctx.data.activas;
  const acopiar = nuevas.slice(0, cupo);
  const copias = acopiar.map((o) => ({ origen: o, id: randomUUID() }));
  const copiadas: string[] = [];
  for (const c of copias) {
    const nuevasRutas = rutasDeFoto(compraId, lineaId, c.id);
    const g = await copiarObjeto(d, c.origen.ruta, nuevasRutas.ruta);
    if (!g.ok) {
      console.error(`[fotos] fallo al copiar la foto: ${g.mensaje}`);
      await limpiarObjetos(d, copiadas, "copia a medias");
      return falloFoto("almacen_no_disponible");
    }
    copiadas.push(nuevasRutas.ruta);
    const m = await copiarObjeto(d, c.origen.ruta_miniatura, nuevasRutas.ruta_miniatura);
    if (!m.ok) {
      console.error(`[fotos] fallo al copiar la miniatura: ${m.mensaje}`);
      await limpiarObjetos(d, copiadas, "copia a medias");
      return falloFoto("almacen_no_disponible");
    }
    copiadas.push(nuevasRutas.ruta_miniatura);
  }

  const todasLasCopias = () => copias.flatMap((c) => Object.values(rutasDeFoto(compraId, lineaId, c.id)));
  const r = await rpcTraerFotosLinea(d, compraId, lineaId, origen.data.linea_id, copias.map((c) => ({ id: c.id, origen_foto_id: c.origen.id })), actorDe(usuario));
  if (r.error) {
    await limpiarObjetos(d, todasLasCopias(), "la función falló");
    return fallaDb(r.error, "fotos: traer_fotos_linea");
  }
  const f = leerFuncion(r);
  if (!f) {
    await limpiarObjetos(d, todasLasCopias(), "respuesta inesperada");
    return falloInesperado("traer_fotos_linea");
  }
  if (!f.ok) {
    await limpiarObjetos(d, todasLasCopias(), `rechazada: ${f.motivo}`);
    const codigo = f.motivo ? MOTIVOS_A_CODIGO[f.motivo] : undefined;
    return codigo ? falloFoto(codigo) : falloInesperado(`traer_fotos_linea motivo ${f.motivo}`);
  }

  // Las copias que la función no aceptó (carrera o cupo) se borran.
  const descartadas = Array.isArray(f.datos.descartadas) ? f.datos.descartadas.filter((x): x is string => typeof x === "string") : [];
  if (descartadas.length > 0) await limpiarObjetos(d, descartadas.flatMap((id) => Object.values(rutasDeFoto(compraId, lineaId, id))), "copias descartadas");

  const traidasDb = Array.isArray(f.datos.traidas) ? (f.datos.traidas as { id?: unknown; origen_foto_id?: unknown }[]) : [];
  const porOrigen = new Map<string, FotoDb>(origen.data.fotos.map((o) => [o.id, o]));
  const ahora = new Date().toISOString();
  const traidas: FotoLineaApi[] = [];
  for (const t of traidasDb) {
    if (typeof t.id !== "string" || typeof t.origen_foto_id !== "string") continue;
    const o = porOrigen.get(t.origen_foto_id);
    if (o) traidas.push(aFotoLineaApi({ id: t.id, ancho: o.ancho, alto: o.alto }, usuario.nombre, ahora));
  }
  const funcionSaltadas = typeof f.datos.saltadas === "number" ? f.datos.saltadas : 0;
  const activas = typeof f.datos.activas === "number" ? f.datos.activas : ctx.data.activas + traidas.length;
  return listo({ traidas, saltadas: saltadas + funcionSaltadas, activas });
}

// ─── Leer una foto ───

/** `GET /api/compras/fotos/[fotoId]`: la foto grande firmada a demanda (TTL de 1 h). `404` si no existe o está quitada. */
export async function leerFotoGrande(d: Db, fotoId: string): Promise<Salida<FotoGrandeApi>> {
  const foto = await leerFotoActiva(d, fotoId);
  if (foto.error) return fallaDb(foto.error, "fotos: leer la foto");
  if (!foto.data) return falloFoto("no_encontrado");
  const firma = await firmarObjeto(d, foto.data.ruta, TTL_URL_FOTO_SEGUNDOS);
  if (!firma.ok) {
    console.error(`[fotos] no se pudo firmar la foto: ${firma.mensaje}`);
    return falloFoto("almacen_no_disponible");
  }
  const datos = await leerDatosLeyenda(d, foto.data);
  if (datos.error) return fallaDb(datos.error, "fotos: leer la leyenda");
  const l = datos.data;
  const leyenda = l ? [l.numero, l.proveedor, [l.modelo, l.descripcion].filter(Boolean).join(" · ") || null].filter((x): x is string => !!x).join(" · ") : "";
  return listo({ url: firma.url, expira_at: firma.expira_at, ancho: foto.data.ancho, alto: foto.data.alto, leyenda });
}

/** Los bytes de la miniatura de una foto activa, bajados con `service_role` (`GET …/miniatura`). */
export async function leerMiniatura(d: Db, fotoId: string): Promise<Salida<Uint8Array>> {
  const foto = await leerFotoActiva(d, fotoId);
  if (foto.error) return fallaDb(foto.error, "fotos: leer la foto");
  if (!foto.data) return falloFoto("no_encontrado");
  const bajada = await descargarObjeto(d, foto.data.ruta_miniatura);
  if (!bajada.ok) {
    console.error(`[fotos] no se pudo bajar la miniatura: ${bajada.mensaje}`);
    return falloFoto("almacen_no_disponible");
  }
  return listo(bajada.bytes);
}

// ─── Limpieza de huérfanas (solo admin) ───

type Huerfanas = { sin_fila: string[]; quitadas: string[] };

async function leerHuerfanas(d: Db): Promise<Salida<Huerfanas>> {
  const r = await rpcFotosHuerfanas(d, HORAS_HUERFANAS, TANDA_LIMPIEZA);
  if (r.error) return fallaDb(r.error, "fotos: fotos_huerfanas");
  const datos = r.data;
  if (typeof datos !== "object" || datos === null || Array.isArray(datos)) return falloInesperado("fotos_huerfanas");
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const o = datos as Record<string, unknown>;
  return listo({ sin_fila: lista(o.sin_fila), quitadas: lista(o.quitadas) });
}

/** `GET /api/compras/fotos/limpiar`: cuántos objetos borraría (hasta 1 000 por tanda). */
export async function contarHuerfanas(d: Db): Promise<Salida<LimpiezaFotosApi>> {
  const h = await leerHuerfanas(d);
  if (h.respuesta) return h;
  return listo({ sin_fila: h.data.sin_fila.length, quitadas: h.data.quitadas.length, horas: HORAS_HUERFANAS });
}

const MAX_TANDAS_LIMPIEZA = 50;

/**
 * `POST /api/compras/fotos/limpiar`: borra los objetos de `fotos_huerfanas(24)` con `.remove()`, en tandas de 1 000, sin tocar filas. Si una
 * tanda falla, la cuenta como fallida y se detiene (no se reintenta en bucle). Sin ningún borrado y con fallos → `502`.
 */
export async function limpiarHuerfanas(d: Db): Promise<Salida<ResultadoLimpiezaFotosApi>> {
  let borrados = 0;
  let fallidos = 0;
  for (let i = 0; i < MAX_TANDAS_LIMPIEZA; i += 1) {
    const h = await leerHuerfanas(d);
    if (h.respuesta) return h;
    const nombres = [...h.data.sin_fila, ...h.data.quitadas];
    if (nombres.length === 0) break;
    const r = await borrarObjetos(d, nombres);
    if (!r.ok) {
      console.error(`[fotos] la limpieza no pudo borrar ${nombres.length} objeto(s): ${r.mensaje}`);
      fallidos += nombres.length;
      break;
    }
    borrados += nombres.length;
    if (nombres.length < TANDA_LIMPIEZA) break;
  }
  if (borrados === 0 && fallidos > 0) return falla(errorConCodigo(MENSAJE_ERROR_FOTO.almacen_no_disponible, 502, "almacen_no_disponible"));
  return listo({ borrados, fallidos });
}

