import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requirePlanner, requireUser } from "@/lib/auth/guard";
import { puedeEditarMaestros } from "@/lib/auth/roles";
import { error, leerCuerpo, ok } from "@/lib/api/respuestas";
import { traducirErrorDb } from "@/lib/api/errores-db";
import { incluirInactivos } from "@/lib/api/catalogo";
import type { TablesInsert } from "@/lib/supabase/database.types";
import { normalizarNombre } from "@/lib/arbol/normalizar";
import { crearTiendaSchema, filtrosTiendasSchema } from "@/lib/tiendas/esquemas";
import { aTiendaFila, leerTiendas, referentesDe } from "@/lib/tiendas/consultas";
import { hoyLima } from "@/lib/tiendas/estado";
import { motivoRechazoReferencia, motivoRechazoTienda } from "@/lib/tiendas/reglas";

/** Lee los filtros de la query string; `""` cuenta como ausente. */
function parametros(request: NextRequest, claves: string[]): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const clave of claves) {
    const v = request.nextUrl.searchParams.get(clave);
    if (v !== null && v !== "") salida[clave] = v;
  }
  return salida;
}

/**
 * Tiendas por `codigo` con `estado` calculado (`requireUser`). Filtros
 * opcionales combinados con AND: `tipo`, `estado` (se aplica en memoria tras
 * calcular), `zona` (comparada normalizada), `hoy` (`aaaa-mm-dd`, por defecto
 * `hoyLima()`); `400` si alguno no es válido. `?incluir_inactivos=1` incluye
 * las desactivadas. Quien no puede editar maestros (comprador) recibe
 * `venta_esperada_promedio: null` y, igual, la tienda de referencia (`tienda_referencia_id` y `tienda_referencia` en `null`, M7).
 */
export async function GET(request: NextRequest) {
  const { response, rol } = await requireUser();
  if (response) return response;

  const parseado = filtrosTiendasSchema.safeParse(parametros(request, ["tipo", "estado", "zona", "hoy"]));
  if (!parseado.success) {
    const primero = parseado.error.issues[0];
    return error(`${primero.path.join(".")}: ${primero.message}`, 400);
  }
  const filtros = parseado.data;
  const hoy = filtros.hoy ?? hoyLima();
  const zona = filtros.zona === undefined ? undefined : normalizarNombre(filtros.zona);

  const verVentaEsperada = puedeEditarMaestros(rol);

  const db = supabaseAdmin();
  // Se leen todas (son pocas): el nombre de un referente se resuelve aunque no esté en el listado.
  const { data: todas, error: err } = await leerTiendas(db, { soloActivas: false });
  if (err) return traducirErrorDb(err, "listar tiendas");
  const referentes = referentesDe(todas);
  const data = incluirInactivos(request) ? todas : todas.filter((t) => t.activo);

  const filas = data
    .map((t) => aTiendaFila(t, hoy, verVentaEsperada, referentes))
    .filter((t) => filtros.tipo === undefined || t.tipo === filtros.tipo)
    .filter((t) => filtros.estado === undefined || t.estado === filtros.estado)
    .filter((t) => zona === undefined || t.zona === zona);
  return ok(filas);
}

/**
 * Crea una tienda (`requirePlanner`), 201 con su `estado`. Orden: zod (forma
 * y normalización) → `motivoRechazoTienda` sobre la fila resultante (`400`)
 * → escribir → `traducirErrorDb` (`409` código o nombre repetido; `400` si
 * un `check` atrapa algo que se escapó).
 */
export async function POST(request: NextRequest) {
  const { response } = await requirePlanner();
  if (response) return response;

  const { datos, respuesta } = await leerCuerpo(request, crearTiendaSchema);
  if (respuesta) return respuesta;

  // El esquema ya lo comprobó; se repite para que el orden de comprobaciones sea explícito en el handler.
  const motivo = motivoRechazoTienda(datos);
  if (motivo) return error(motivo.mensaje, 400);

  const referenciaId = datos.tienda_referencia_id ?? null;
  if (referenciaId !== null) {
    const { data: ref, error: errRef } = await supabaseAdmin().from("tiendas").select("id, tipo, activo").eq("id", referenciaId).maybeSingle();
    if (errRef) return traducirErrorDb(errRef, "buscar tienda de referencia");
    const m = motivoRechazoReferencia({ tiendaId: null, tipo: datos.tipo, referenciaId, referente: ref });
    if (m) return error(m, 400);
  }

  const nueva: TablesInsert<"tiendas"> = {
    codigo: datos.codigo,
    nombre: datos.nombre,
    tipo: datos.tipo,
    zona: datos.zona,
    razon_social: datos.razon_social,
    fecha_apertura: datos.fecha_apertura,
    fecha_cierre: datos.fecha_cierre,
    venta_esperada_promedio: datos.venta_esperada_promedio,
    tienda_referencia_id: referenciaId,
  };
  const db = supabaseAdmin();
  const { data, error: err } = await db.from("tiendas").insert(nueva).select("*").single();
  if (err) return traducirErrorDb(err, "crear tienda");
  const referentes = referenciaId ? await referenteDe(db, referenciaId) : undefined;
  return ok(aTiendaFila(data, hoyLima(), true, referentes), 201);
}

/** El referente como mapa de un elemento (para el nombre en la respuesta de alta y edición). */
async function referenteDe(db: ReturnType<typeof supabaseAdmin>, id: string) {
  const { data } = await db.from("tiendas").select("id, codigo, nombre").eq("id", id).maybeSingle();
  return data ? referentesDe([data]) : undefined;
}
