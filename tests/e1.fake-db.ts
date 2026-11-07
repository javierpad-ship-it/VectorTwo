import { NextResponse } from "next/server";
import type { Rol } from "@/lib/auth/roles";

/**
 * Doble de base de las pruebas de los handlers de 08c E1 (proveedores y fotos de línea): tablas en memoria, un Storage en memoria y las
 * funciones `rpc` de `0039` simuladas al nivel de su contrato JSON (`{ ok, motivo, … }`, con los mismos motivos y el mismo orden de
 * comprobaciones que el SQL). No reemplaza al humo SQL ni a la prueba de integración: comprueba que el servicio y los handlers usan bien el
 * contrato. Todo inventado.
 */

export type Fila = Record<string, unknown>;
type ErrorRpc = { code: string; message: string; details: null; hint: null };
type Resultado = { data: unknown; error: ErrorRpc | null };

export const PERFILES = {
  admin: { id: "a0000000-0000-4000-8000-000000000001", email: "admin@ejemplo.pe", nombre: "Admin Uno", rol: "admin" as Rol },
  planner: { id: "a0000000-0000-4000-8000-000000000002", email: "planner@ejemplo.pe", nombre: "Planner Uno", rol: "planner" as Rol },
  comprador: { id: "a0000000-0000-4000-8000-000000000003", email: "c1@ejemplo.pe", nombre: "Comprador Uno", rol: "comprador" as Rol },
};

export const IDS = {
  provNorte: "10000000-0000-4000-8000-000000000001",
  provSur: "10000000-0000-4000-8000-000000000002",
  provDelta: "10000000-0000-4000-8000-000000000003",
  compraA: "40000000-0000-4000-8000-00000000000a",
  lineaA1: "30000000-0000-4000-8000-0000000000a1",
  lineaA2: "30000000-0000-4000-8000-0000000000a2",
  compraCancelada: "40000000-0000-4000-8000-00000000000c",
  lineaCancelada: "30000000-0000-4000-8000-0000000000c1",
  compraOtra: "40000000-0000-4000-8000-00000000000b",
  lineaOtra: "30000000-0000-4000-8000-0000000000b1",
  compraNueva: "40000000-0000-4000-8000-00000000000d",
  lineaNueva: "30000000-0000-4000-8000-0000000000d1",
};

type Escenario = {
  tablas: Record<string, Fila[]>;
  usuario: { rol: Rol | "sin_sesion"; perfil: (typeof PERFILES)[keyof typeof PERFILES] };
  llamadas: { nombre: string; args: Record<string, unknown> }[];
  /** Objetos de Storage: ruta → bytes y fecha de creación. */
  objetos: Map<string, { bytes: Uint8Array; created_at: string }>;
  /** Operaciones de Storage, en orden: `upload:ruta`, `remove:a|b`, `copy:a>b`, `download:r`, `sign:r`. */
  operaciones: string[];
  fallos: { subirN: number | null; remove: boolean; copy: boolean; download: boolean; firma: boolean; rpc: string | null };
  /** Hace que `agregar_foto_linea` rechace con este motivo aunque el pre-chequeo haya pasado (una carrera). */
  forzarMotivoAgregar: string | null;
  contador: number;
  subidas: number;
};

export const escenario: Escenario = {
  tablas: {},
  usuario: { rol: "planner", perfil: PERFILES.planner },
  llamadas: [],
  objetos: new Map(),
  operaciones: [],
  fallos: { subirN: null, remove: false, copy: false, download: false, firma: false, rpc: null },
  forzarMotivoAgregar: null,
  contador: 1,
  subidas: 0,
};

export const tabla = (nombre: string): Fila[] => (escenario.tablas[nombre] ??= []);
const nuevoId = () => `f0000000-0000-4000-8000-${String(escenario.contador++).padStart(12, "0")}`;
const sello = () => new Date(Date.UTC(2026, 10, 6, 12, 0, escenario.contador)).toISOString();
const err = (code: string, message: string): ErrorRpc => ({ code, message, details: null, hint: null });
const respuesta = (data: unknown): Promise<Resultado> => Promise.resolve({ data, error: null });

// ─── Semillas ───

const proveedor = (id: string, nombre: string, extra: Fila = {}): Fila => ({
  id, codigo: null, nombre, pais: "China", region: null, ciudad: null, direccion: null, identificacion: null, es_intercompany: false, nota: null, activo: true,
  puerto_embarque: null, incoterm: null, moneda: null, plazo_produccion_dias: null, plazo_transito_dias: null, condiciones_pago: null, revision: 0,
  perfil_id: null, usuario_nombre: "Alguien", updated_by_id: null, updated_by_nombre: null, clave_origen: "cotv:supplier:secreto-que-no-sale",
  created_at: "2026-10-01T10:00:00.000Z", updated_at: "2026-10-01T10:00:00.000Z", ...extra,
});

const compra = (id: string, numero: string, proveedor_id: string, estado: string, extra: Fila = {}): Fila => ({
  id, numero, proveedor_id, estado, origen: "comprador", fecha_compra: "2026-10-10", moneda: "USD", revision: 3, cancelada_at: estado === "cancelada" ? "2026-10-20T10:00:00.000Z" : null,
  created_at: "2026-10-10T10:00:00.000Z", updated_at: "2026-10-10T10:00:00.000Z", ...extra,
});

const linea = (id: string, compra_id: string, extra: Fila = {}): Fila => ({
  id, compra_id, activo: true, clave_importacion: null, descripcion: null, modelo: null, unidades: 100, unidades_canceladas: 0, costo_unitario: 3.15,
  created_at: "2026-10-10T10:00:00.000Z", ...extra,
});

export function reiniciarEscenario(): void {
  escenario.tablas = {};
  escenario.usuario = { rol: "planner", perfil: PERFILES.planner };
  escenario.llamadas = [];
  escenario.objetos = new Map();
  escenario.operaciones = [];
  escenario.fallos = { subirN: null, remove: false, copy: false, download: false, firma: false, rpc: null };
  escenario.forzarMotivoAgregar = null;
  escenario.contador = 1;
  escenario.subidas = 0;
  tabla("proveedores").push(
    proveedor(IDS.provNorte, "Proveedor Norte", { pais: "China", region: "Zhejiang", puerto_embarque: "Ningbo", incoterm: "FOB", moneda: "USD" }),
    proveedor(IDS.provSur, "Feria Sur", { pais: null }),
    proveedor(IDS.provDelta, "Textiles Delta Ltd.", { codigo: "DELTA", activo: false }),
  );
  tabla("proveedor_contactos").push({ id: nuevoId(), proveedor_id: IDS.provNorte, nombre: "Ana Prueba", cargo: "Ventas", telefono: "111", correo: "ana@ejemplo.com", es_principal: true, orden: 0, created_at: sello() });
  tabla("compras").push(
    compra(IDS.compraA, "C-000101", IDS.provNorte, "confirmada"),
    compra(IDS.compraCancelada, "C-000090", IDS.provNorte, "cancelada"),
    compra(IDS.compraOtra, "C-000102", IDS.provSur, "confirmada"),
    compra(IDS.compraNueva, "C-000103", IDS.provNorte, "confirmada"),
  );
  tabla("compra_lineas").push(
    linea(IDS.lineaA1, IDS.compraA),
    linea(IDS.lineaA2, IDS.compraA, { activo: false }),
    linea(IDS.lineaCancelada, IDS.compraCancelada, { clave_importacion: "NORTE|REF-1|1", created_at: "2026-10-12T10:00:00.000Z" }),
    linea(IDS.lineaOtra, IDS.compraOtra),
    linea(IDS.lineaNueva, IDS.compraNueva, { clave_importacion: "NORTE|REF-1|1", created_at: "2026-10-25T10:00:00.000Z" }),
  );
}

/** Pone una foto activa ya registrada (y su objeto en Storage) en una línea. Devuelve su id. */
export function sembrarFoto(compraId: string, lineaId: string, extra: Fila = {}): string {
  const id = (extra.id as string | undefined) ?? nuevoId();
  const ruta = `compras/${compraId}/${lineaId}/${id}.jpg`;
  const ruta_miniatura = `compras/${compraId}/${lineaId}/${id}_min.jpg`;
  tabla("compra_linea_fotos").push({
    id, linea_id: lineaId, compra_id: compraId, ruta, ruta_miniatura, ancho: 800, alto: 600, bytes: 100, bytes_miniatura: 50, subida_por_id: PERFILES.comprador.id,
    subida_por_nombre: "Comprador Uno", quitada_at: null, quitada_por_id: null, quitada_por_nombre: null, activo: true, origen_foto_id: null, clave_origen: null,
    created_at: sello(), updated_at: sello(), ...extra,
  });
  escenario.objetos.set(ruta, { bytes: Uint8Array.from([0xff, 0xd8, 0xff, 1]), created_at: "2026-11-01T10:00:00.000Z" });
  escenario.objetos.set(ruta_miniatura, { bytes: Uint8Array.from([0xff, 0xd8, 0xff, 2]), created_at: "2026-11-01T10:00:00.000Z" });
  return id;
}

export const fotosActivas = (lineaId: string) => tabla("compra_linea_fotos").filter((f) => f.linea_id === lineaId && f.activo);
export const llamadasA = (nombre: string) => escenario.llamadas.filter((l) => l.nombre === nombre);
export const eventosProveedor = (id: string | null) => tabla("proveedor_eventos").filter((e) => e.proveedor_id === id);

// ─── Guard falso (requireUser, requirePlanner y requireAdmin) ───

export function guardFalso() {
  const rechazo = (mensaje: string, status: number) => ({ user: null, perfil: null, rol: null, response: NextResponse.json({ error: mensaje }, { status }) });
  const requireUser = async () => {
    if (escenario.usuario.rol === "sin_sesion") return rechazo("No autenticado.", 401);
    return { user: {}, perfil: escenario.usuario.perfil, rol: escenario.usuario.rol, response: null };
  };
  return {
    requireUser,
    requirePlanner: async () => {
      const r = await requireUser();
      if (r.response) return r;
      if (r.rol === "comprador") return rechazo("Tu rol es de solo lectura.", 403);
      return r;
    },
    requireAdmin: async () => {
      const r = await requireUser();
      if (r.response) return r;
      if (r.rol !== "admin") return rechazo("Solo un administrador puede hacer esto.", 403);
      return r;
    },
  };
}

// ─── Consultas ───

class Consulta implements PromiseLike<Resultado> {
  private filtros: Array<(f: Fila) => boolean> = [];
  private ordenes: Array<[string, boolean]> = [];
  private una: "single" | "maybeSingle" | null = null;
  private desde = 0;
  private hasta = Infinity;
  constructor(private readonly nombre: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] === v);
    return this;
  }
  neq(c: string, v: unknown) {
    this.filtros.push((f) => f[c] !== v);
    return this;
  }
  in(c: string, v: unknown[]) {
    this.filtros.push((f) => v.includes(f[c]));
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.ordenes.push([c, o?.ascending !== false]);
    return this;
  }
  range(d: number, h: number) {
    this.desde = d;
    this.hasta = h;
    return this;
  }
  single() {
    this.una = "single";
    return this;
  }
  maybeSingle() {
    this.una = "maybeSingle";
    return this;
  }
  then<A, B>(ok?: ((v: Resultado) => A | PromiseLike<A>) | null, ko?: ((r: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.ejecutar()).then(ok, ko);
  }
  private ejecutar(): Resultado {
    let r = tabla(this.nombre).filter((f) => this.filtros.every((p) => p(f)));
    for (const [c, asc] of [...this.ordenes].reverse()) {
      r = [...r].sort((a, b) => {
        const x = a[c] as string | number;
        const y = b[c] as string | number;
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
      });
    }
    r = r.slice(this.desde, this.hasta === Infinity ? undefined : Math.min(this.hasta + 1, this.desde + 1000));
    if (this.una) return { data: r[0] ? { ...r[0] } : null, error: null };
    return { data: r.map((f) => ({ ...f })), error: null };
  }
}

// ─── Storage ───

const BUCKET = "compras-fotos";

function almacenFalso(bucket: string) {
  if (bucket !== BUCKET) throw new Error(`bucket inesperado: ${bucket}`);
  return {
    upload: async (ruta: string, bytes: Uint8Array, opciones: { contentType?: string; upsert?: boolean }) => {
      escenario.operaciones.push(`upload:${ruta}`);
      escenario.subidas += 1;
      if (escenario.fallos.subirN !== null && escenario.subidas === escenario.fallos.subirN) return { data: null, error: { message: "Storage caído" } };
      if (opciones.upsert !== false) throw new Error("la subida debe ser con upsert: false");
      if (opciones.contentType !== "image/jpeg") throw new Error("la subida debe ser image/jpeg");
      if (escenario.objetos.has(ruta)) return { data: null, error: { message: "The resource already exists" } };
      escenario.objetos.set(ruta, { bytes, created_at: new Date().toISOString() });
      return { data: { path: ruta }, error: null };
    },
    remove: async (rutas: string[]) => {
      escenario.operaciones.push(`remove:${rutas.join("|")}`);
      if (escenario.fallos.remove) return { data: null, error: { message: "Storage caído" } };
      for (const r of rutas) escenario.objetos.delete(r);
      return { data: rutas.map((name) => ({ name })), error: null };
    },
    copy: async (desde: string, hasta: string) => {
      escenario.operaciones.push(`copy:${desde}>${hasta}`);
      const o = escenario.objetos.get(desde);
      if (escenario.fallos.copy || !o) return { data: null, error: { message: "no se pudo copiar" } };
      escenario.objetos.set(hasta, { bytes: o.bytes, created_at: new Date().toISOString() });
      return { data: { path: hasta }, error: null };
    },
    download: async (ruta: string) => {
      escenario.operaciones.push(`download:${ruta}`);
      const o = escenario.objetos.get(ruta);
      if (escenario.fallos.download || !o) return { data: null, error: { message: "no existe" } };
      return { data: new Blob([o.bytes as BlobPart]), error: null };
    },
    createSignedUrl: async (ruta: string, segundos: number) => {
      escenario.operaciones.push(`sign:${ruta}`);
      if (escenario.fallos.firma || !escenario.objetos.has(ruta)) return { data: null, error: { message: "no se pudo firmar" } };
      return { data: { signedUrl: `https://storage.ejemplo.test/firmada/${ruta}?t=${segundos}` }, error: null };
    },
  };
}

// ─── Funciones rpc de 0039 (contrato JSON) ───

const actorDe = (a: Fila) => ({ perfil: (a.perfil_id ?? a.id ?? null) as string | null, nombre: ((a.nombre as string | undefined) ?? "").trim() || null, rol: (a.rol as string | undefined) ?? null, origen: (a.origen as string | undefined) ?? "" });
const nulo = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v === undefined ? null : v);

function foto(p: Fila, contactos: Fila[]): Fila {
  return {
    nombre: p.nombre, codigo: p.codigo, pais: p.pais, region: p.region, ciudad: p.ciudad, direccion: p.direccion, identificacion: p.identificacion, es_intercompany: p.es_intercompany,
    puerto_embarque: p.puerto_embarque, incoterm: p.incoterm, moneda: p.moneda, plazo_produccion_dias: p.plazo_produccion_dias, plazo_transito_dias: p.plazo_transito_dias,
    condiciones_pago: p.condiciones_pago, nota: p.nota, activo: p.activo,
    contactos: contactos.map((k) => ({ nombre: k.nombre, cargo: k.cargo, telefono: k.telefono, correo: k.correo, es_principal: k.es_principal, orden: k.orden })),
  };
}
const contactosDe = (id: string) => tabla("proveedor_contactos").filter((k) => k.proveedor_id === id).sort((a, b) => Number(a.orden) - Number(b.orden));
const fotoDe = (id: string) => foto(tabla("proveedores").find((p) => p.id === id) as Fila, contactosDe(id));

function evento(proveedor_id: string, nombre: string, accion: string, antes: unknown, despues: unknown, resumen: string, a: ReturnType<typeof actorDe>) {
  tabla("proveedor_eventos").push({ id: nuevoId(), proveedor_id, proveedor_nombre: nombre, accion, antes, despues, resumen, perfil_id: a.perfil, usuario_nombre: a.nombre, created_at: sello() });
}

function conflicto(p: Fila) {
  return { id: p.id, nombre: p.nombre, activo: p.activo };
}

function rpcGuardarProveedor(args: Record<string, unknown>) {
  const a = actorDe(args.p_actor as Fila);
  const prov = args.p_proveedor as Fila | null;
  const fallo = (motivo: string, extra: Fila = {}) => ({ ok: false, motivo, ...extra });
  if (!prov || typeof prov !== "object") return fallo("ficha_invalida");
  const nombre = nulo(prov.nombre) as string | null;
  if (!nombre || nombre.length > 120) return fallo("ficha_invalida");
  let contactos: Fila[] | null = null;
  if (args.p_contactos !== null && args.p_contactos !== undefined) {
    const lista = args.p_contactos as Fila[];
    if (!Array.isArray(lista) || lista.length > 20 || lista.filter((c) => c.es_principal === true).length > 1) return fallo("contactos_invalidos");
    const hayPrincipal = lista.some((c) => c.es_principal === true);
    contactos = lista.map((c, i) => ({ nombre: nulo(c.nombre), cargo: nulo(c.cargo), telefono: nulo(c.telefono), correo: nulo(c.correo), es_principal: hayPrincipal ? c.es_principal === true : i === 0, orden: i }));
  }
  const campos = ["codigo", "pais", "region", "ciudad", "direccion", "identificacion", "puerto_embarque", "incoterm", "moneda", "plazo_produccion_dias", "plazo_transito_dias", "condiciones_pago", "nota"];
  const ficha: Fila = { nombre };
  for (const c of campos) ficha[c] = nulo(prov[c]);
  const todos = tabla("proveedores");
  const repetidoNombre = (excluir: unknown) => todos.find((p) => p.id !== excluir && String(p.nombre).toUpperCase() === nombre.toUpperCase());
  const repetidoCodigo = (excluir: unknown) => ficha.codigo !== null && todos.find((p) => p.id !== excluir && p.codigo !== null && String(p.codigo).toUpperCase() === String(ficha.codigo).toUpperCase());

  if (args.p_id === null || args.p_id === undefined) {
    const clave = nulo(prov.clave_origen) as string | null;
    if (clave) {
      const ya = todos.find((p) => p.clave_origen === clave);
      if (ya) return fallo("ya_cargado", { proveedor_id: ya.id });
    }
    if (a.rol === "comprador" && prov.es_intercompany === true) return fallo("solo_planner_intercompany");
    const n = repetidoNombre(null);
    if (n) return fallo("nombre_repetido", { conflicto: conflicto(n) });
    const c = repetidoCodigo(null);
    if (c) return fallo("codigo_repetido", { conflicto: conflicto(c as Fila) });
    const id = nuevoId();
    todos.push({ id, ...proveedor(id, nombre), ...ficha, es_intercompany: prov.es_intercompany === true, clave_origen: clave, revision: 0, usuario_nombre: a.nombre, updated_by_nombre: a.nombre });
    for (const k of contactos ?? []) tabla("proveedor_contactos").push({ id: nuevoId(), proveedor_id: id, created_at: sello(), ...k });
    evento(id, nombre, a.origen === "carga_cotv" ? "importar" : "crear", null, fotoDe(id), a.origen === "carga_cotv" ? "Carga desde COTV" : `Proveedor creado: ${nombre}`, a);
    return { ok: true, proveedor_id: id, revision: 0, accion: a.origen === "carga_cotv" ? "importar" : "crear", sin_cambios: false };
  }

  const actual = todos.find((p) => p.id === args.p_id);
  if (!actual) return fallo("no_encontrado");
  if (args.p_revision === null || actual.revision !== args.p_revision) return fallo("proveedor_cambio", { revision: actual.revision });
  if (a.rol === "comprador" && prov.es_intercompany !== undefined && prov.es_intercompany !== actual.es_intercompany) return fallo("solo_planner_intercompany");
  const antes = fotoDe(actual.id as string);
  const interco = prov.es_intercompany === undefined ? actual.es_intercompany : prov.es_intercompany;
  const nuevo: Fila = { ...ficha, es_intercompany: interco, activo: actual.activo, contactos: contactos ? contactos.map((k) => ({ nombre: k.nombre, cargo: k.cargo, telefono: k.telefono, correo: k.correo, es_principal: k.es_principal, orden: k.orden })) : antes.contactos };
  if (JSON.stringify(Object.keys(nuevo).sort().map((k) => [k, nuevo[k]])) === JSON.stringify(Object.keys(antes).sort().map((k) => [k, antes[k]]))) {
    return { ok: true, proveedor_id: actual.id, revision: actual.revision, accion: "editar", sin_cambios: true };
  }
  const n = repetidoNombre(actual.id);
  if (n) return fallo("nombre_repetido", { conflicto: conflicto(n) });
  const c = repetidoCodigo(actual.id);
  if (c) return fallo("codigo_repetido", { conflicto: conflicto(c as Fila) });
  Object.assign(actual, ficha, { es_intercompany: interco, revision: Number(actual.revision) + 1, updated_by_id: a.perfil, updated_by_nombre: a.nombre, updated_at: sello() });
  if (contactos && JSON.stringify(nuevo.contactos) !== JSON.stringify(antes.contactos)) {
    escenario.tablas.proveedor_contactos = tabla("proveedor_contactos").filter((k) => k.proveedor_id !== actual.id);
    for (const k of contactos) tabla("proveedor_contactos").push({ id: nuevoId(), proveedor_id: actual.id, created_at: sello(), ...k });
  }
  evento(actual.id as string, nombre, "editar", antes, fotoDe(actual.id as string), "Cambios", a);
  return { ok: true, proveedor_id: actual.id, revision: actual.revision, accion: "editar", sin_cambios: false };
}

function rpcCambiarActivo(args: Record<string, unknown>) {
  const a = actorDe(args.p_actor as Fila);
  if (args.p_activo === null || args.p_activo === undefined) return { ok: false, motivo: "activo_invalido" };
  const p = tabla("proveedores").find((x) => x.id === args.p_id);
  if (!p) return { ok: false, motivo: "no_encontrado" };
  if (p.activo === args.p_activo) return { ok: true, proveedor_id: p.id, revision: p.revision, activo: p.activo, sin_cambios: true };
  const antes = fotoDe(p.id as string);
  Object.assign(p, { activo: args.p_activo, revision: Number(p.revision) + 1, updated_by_id: a.perfil, updated_by_nombre: a.nombre });
  evento(p.id as string, p.nombre as string, p.activo ? "reactivar" : "desactivar", antes, fotoDe(p.id as string), p.activo ? "Proveedor reactivado" : "Proveedor desactivado", a);
  return { ok: true, proveedor_id: p.id, revision: p.revision, activo: p.activo, sin_cambios: false };
}

function rpcEliminar(args: Record<string, unknown>) {
  const a = actorDe(args.p_actor as Fila);
  const p = tabla("proveedores").find((x) => x.id === args.p_id);
  if (!p) return { ok: false, motivo: "no_encontrado" };
  const antes = fotoDe(p.id as string);
  if (tabla("compras").some((c) => c.proveedor_id === p.id)) {
    if (p.activo) {
      Object.assign(p, { activo: false, revision: Number(p.revision) + 1 });
      evento(p.id as string, p.nombre as string, "desactivar", antes, fotoDe(p.id as string), "Tenía compras: se desactivó en lugar de eliminarse", a);
    }
    return { ok: true, proveedor_id: p.id, accion: "desactivado" };
  }
  evento(p.id as string, p.nombre as string, "eliminar", antes, null, `Proveedor eliminado: ${p.nombre}`, a);
  for (const e of tabla("proveedor_eventos")) if (e.proveedor_id === p.id) e.proveedor_id = null;
  escenario.tablas.proveedores = tabla("proveedores").filter((x) => x.id !== p.id);
  escenario.tablas.proveedor_contactos = tabla("proveedor_contactos").filter((k) => k.proveedor_id !== p.id);
  return { ok: true, proveedor_id: p.id, accion: "borrado" };
}

const lineaDeCompra = (compra: unknown, lineaId: unknown) => tabla("compra_lineas").find((l) => l.id === lineaId && l.compra_id === compra);
const compraPorId = (id: unknown) => tabla("compras").find((c) => c.id === id);

function rpcAgregarFoto(args: Record<string, unknown>) {
  const a = actorDe(args.p_actor as Fila);
  const f = args.p_foto as Fila;
  const fallo = (motivo: string, extra: Fila = {}) => ({ ok: false, motivo, ...extra });
  const rango = (v: unknown, max: number) => typeof v === "number" && v >= 1 && v <= max;
  if (typeof f.id !== "string" || !rango(f.ancho, 800) || !rango(f.alto, 800) || !rango(f.bytes, 409_600) || !rango(f.bytes_miniatura, 61_440)) return fallo("foto_invalida");
  const ruta = `compras/${args.p_compra}/${args.p_linea}/${f.id}.jpg`;
  const rutaMin = `compras/${args.p_compra}/${args.p_linea}/${f.id}_min.jpg`;
  if ((f.ruta !== undefined && f.ruta !== ruta) || (f.ruta_miniatura !== undefined && f.ruta_miniatura !== rutaMin)) return fallo("ruta_invalida");
  const c = compraPorId(args.p_compra);
  if (!c) return fallo("no_pertenece");
  const l = lineaDeCompra(args.p_compra, args.p_linea);
  if (!l) return fallo("no_pertenece");
  if (escenario.forzarMotivoAgregar) return fallo(escenario.forzarMotivoAgregar);
  if (c.estado === "cancelada" || !l.activo) return fallo("no_editable");
  if (fotosActivas(args.p_linea as string).length >= 3) return fallo("max_fotos");
  const creada = sello();
  tabla("compra_linea_fotos").push({
    id: f.id, linea_id: args.p_linea, compra_id: args.p_compra, ruta, ruta_miniatura: rutaMin, ancho: f.ancho, alto: f.alto, bytes: f.bytes, bytes_miniatura: f.bytes_miniatura,
    subida_por_id: a.perfil, subida_por_nombre: a.nombre, quitada_at: null, quitada_por_id: null, quitada_por_nombre: null, activo: true, origen_foto_id: null, clave_origen: null, created_at: creada, updated_at: creada,
  });
  return { ok: true, foto_id: f.id, ruta, ruta_miniatura: rutaMin, activas: fotosActivas(args.p_linea as string).length, foto: { id: f.id, created_at: creada } };
}

function rpcQuitarFoto(args: Record<string, unknown>) {
  const a = actorDe(args.p_actor as Fila);
  const c = compraPorId(args.p_compra);
  if (!c || !lineaDeCompra(args.p_compra, args.p_linea)) return { ok: false, motivo: "no_pertenece" };
  const f = tabla("compra_linea_fotos").find((x) => x.id === args.p_foto && x.linea_id === args.p_linea && x.compra_id === args.p_compra);
  if (!f) return { ok: false, motivo: "no_pertenece" };
  if (c.estado === "cancelada" && a.rol !== "admin") return { ok: false, motivo: "no_editable" };
  if (!f.activo) return { ok: false, motivo: "ya_quitada" };
  Object.assign(f, { activo: false, quitada_at: sello(), quitada_por_id: a.perfil, quitada_por_nombre: a.nombre });
  return { ok: true, foto_id: f.id, ruta: f.ruta, ruta_miniatura: f.ruta_miniatura, activas: fotosActivas(args.p_linea as string).length };
}

function rpcTraerFotos(args: Record<string, unknown>) {
  const a = actorDe(args.p_actor as Fila);
  const lista = args.p_fotos as { id: string; origen_foto_id: string }[];
  const fallo = (motivo: string) => ({ ok: false, motivo });
  if (!Array.isArray(lista) || lista.length === 0 || new Set(lista.map((x) => x.id)).size !== lista.length) return fallo("foto_invalida");
  if (lista.some((x) => tabla("compra_linea_fotos").some((f) => f.id === x.id))) return fallo("foto_invalida");
  const c = compraPorId(args.p_compra);
  const l = lineaDeCompra(args.p_compra, args.p_linea);
  if (!c || !l) return fallo("no_pertenece");
  if (c.estado === "cancelada" || !l.activo) return fallo("no_editable");
  const o = tabla("compra_lineas").find((x) => x.id === args.p_origen);
  if (!o || args.p_origen === args.p_linea) return fallo("sin_origen");
  const co = compraPorId(o.compra_id);
  if (!co || co.estado !== "cancelada" || co.proveedor_id !== c.proveedor_id || o.clave_importacion === null || o.clave_importacion !== l.clave_importacion) return fallo("sin_origen");
  const origenes = lista.map((x) => ({ x, o: tabla("compra_linea_fotos").find((f) => f.id === x.origen_foto_id && f.linea_id === args.p_origen && f.activo) })).filter((e) => e.o);
  if (origenes.length === 0) return fallo("sin_origen");
  const activas = fotosActivas(args.p_linea as string);
  const cupo = Math.max(3 - activas.length, 0);
  const nuevas = origenes.filter((e) => !activas.some((t) => t.origen_foto_id === (e.o as Fila).id)).sort((p, q) => String((p.o as Fila).created_at).localeCompare(String((q.o as Fila).created_at)));
  if (nuevas.length > 0 && cupo === 0) return fallo("max_fotos");
  const aceptadas = nuevas.slice(0, cupo);
  const traidas = aceptadas.map((e) => {
    const of = e.o as Fila;
    const ruta = `compras/${args.p_compra}/${args.p_linea}/${e.x.id}.jpg`;
    const rutaMin = `compras/${args.p_compra}/${args.p_linea}/${e.x.id}_min.jpg`;
    tabla("compra_linea_fotos").push({
      id: e.x.id, linea_id: args.p_linea, compra_id: args.p_compra, ruta, ruta_miniatura: rutaMin, ancho: of.ancho, alto: of.alto, bytes: of.bytes, bytes_miniatura: of.bytes_miniatura,
      subida_por_id: a.perfil, subida_por_nombre: a.nombre, quitada_at: null, quitada_por_id: null, quitada_por_nombre: null, activo: true, origen_foto_id: of.id, clave_origen: null, created_at: sello(), updated_at: sello(),
    });
    return { id: e.x.id, origen_foto_id: of.id, ruta, ruta_miniatura: rutaMin };
  });
  const aceptadasIds = new Set(aceptadas.map((e) => e.x.id));
  return { ok: true, traidas, saltadas: origenes.length - nuevas.length, descartadas: lista.filter((x) => !aceptadasIds.has(x.id)).map((x) => x.id), activas: activas.length + traidas.length };
}

function rpcEditarFicha(args: Record<string, unknown>) {
  const a = actorDe(args.p_actor as Fila);
  const c = compraPorId(args.p_compra);
  const l = lineaDeCompra(args.p_compra, args.p_linea);
  if (!c || !l) return { ok: false, motivo: "no_pertenece" };
  if (c.estado === "cancelada" || !l.activo) return { ok: false, motivo: "no_editable" };
  const antes = args.p_antes as Fila;
  if (l.descripcion !== nulo(antes.descripcion) || l.modelo !== nulo(antes.modelo)) return { ok: false, motivo: "linea_cambio", actual: { descripcion: l.descripcion, modelo: l.modelo } };
  const desc = nulo(args.p_descripcion);
  const mod = nulo(args.p_modelo);
  if (l.descripcion === desc && l.modelo === mod) return { ok: true, linea_id: l.id, descripcion: l.descripcion, modelo: l.modelo, sin_cambios: true };
  tabla("compra_eventos").push({
    id: nuevoId(), compra_id: c.id, linea_id: l.id, accion: "editar_linea", antes: { descripcion: l.descripcion, modelo: l.modelo }, despues: { descripcion: desc, modelo: mod },
    resumen: `descripción: ${l.descripcion ?? "—"} → ${desc ?? "—"}`, perfil_id: a.perfil, usuario_nombre: a.nombre, created_at: sello(),
  });
  Object.assign(l, { descripcion: desc, modelo: mod });
  return { ok: true, linea_id: l.id, descripcion: desc, modelo: mod, sin_cambios: false };
}

function rpcHuerfanas(args: Record<string, unknown>) {
  const limite = Date.now() - Number(args.p_horas) * 3_600_000;
  const filas = tabla("compra_linea_fotos");
  const sin_fila = [...escenario.objetos.entries()].filter(([ruta, o]) => Date.parse(o.created_at) < limite && !filas.some((f) => f.ruta === ruta || f.ruta_miniatura === ruta)).map(([ruta]) => ruta);
  const quitadas = filas
    .filter((f) => !f.activo && f.quitada_at !== null && Date.parse(String(f.quitada_at)) < limite)
    .flatMap((f) => [f.ruta as string, f.ruta_miniatura as string])
    .filter((ruta) => escenario.objetos.has(ruta));
  return { sin_fila: sin_fila.slice(0, Number(args.p_limite ?? 1000)), quitadas: quitadas.slice(0, Math.max(Number(args.p_limite ?? 1000) - sin_fila.length, 0)) };
}

function resolverRpc(nombre: string, args: Record<string, unknown>): Promise<Resultado> {
  if (escenario.fallos.rpc === nombre) return Promise.resolve({ data: null, error: err("XX000", "fallo simulado de la base") });
  switch (nombre) {
    case "guardar_proveedor":
      return respuesta(rpcGuardarProveedor(args));
    case "cambiar_activo_proveedor":
      return respuesta(rpcCambiarActivo(args));
    case "eliminar_proveedor":
      return respuesta(rpcEliminar(args));
    case "agregar_foto_linea":
      return respuesta(rpcAgregarFoto(args));
    case "quitar_foto_linea":
      return respuesta(rpcQuitarFoto(args));
    case "traer_fotos_linea":
      return respuesta(rpcTraerFotos(args));
    case "editar_ficha_linea":
      return respuesta(rpcEditarFicha(args));
    case "fotos_huerfanas":
      return respuesta(rpcHuerfanas(args));
    default:
      return Promise.resolve({ data: null, error: err("42883", `función desconocida: ${nombre}`) });
  }
}

export function clienteFalso() {
  return {
    from: (nombre: string) => new Consulta(nombre),
    rpc: (nombre: string, args: Record<string, unknown> = {}) => {
      escenario.llamadas.push({ nombre, args });
      return resolverRpc(nombre, args);
    },
    storage: { from: almacenFalso },
  };
}
