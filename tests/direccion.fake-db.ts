import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { clienteFalso as clienteM7, estado as base, reiniciar as reiniciarM7, sembrar, type ErrorFalso, type Fila } from "./proyeccion.fake-db";
import { abortable } from "./rpc-abortable";

/**
 * Base falsa del tablero de dirección (ficha 14, §6.4). Envuelve la base falsa de M7 y le añade:
 *   - la tabla `aprobaciones_direccion`, de solo inserción (cualquier escritura directa falla: solo inserta la función de registro);
 *   - la FK `restrict` de esa tabla sobre `proyecciones` (borrar una proyección con aprobaciones falla con `23503`);
 *   - las cuatro funciones de la migración 0041 (`huella_proyeccion`, `tablero_proyeccion`, `tablero_venta`, `registrar_aprobacion_direccion`) como
 *     MODELOS en TypeScript de lo que dice su documentación, sobre las tablas de la base falsa y sobre unos hechos de venta sintéticos.
 * Lo que SQL garantiza de verdad (transacción, `for share`, triggers de inmutabilidad, privilegios, redondeos de `numeric`) lo prueba el humo de
 * `datos` (`scripts/humo-0041.sql`); aquí se prueba que TypeScript arma bien los parámetros, cuadra las cifras y traduce bien las respuestas.
 */

export { base, sembrar, type Fila };

/** Un hecho de venta publicado: por tienda, mes, nodo de planificación, equivalencia (solo si el nodo es GMLE) y marca. */
export type Hecho = { tienda_id: string; periodo: string; gml_id: string; equivalencia_id: string | null; marca_id: string; u: number; s: number; stock?: number };

export const estadoDireccion = {
  hechos: [] as Hecho[],
  /** `gml_id → género y mundo` (la tabla `genero_mundo_linea`). */
  nodos: new Map<string, { genero_id: string; mundo_id: string }>(),
  /** `marca_id → unidad de marca` y `unidad → agrupación de marca`. */
  unidadDe: new Map<string, string>(),
  amDeUnidad: new Map<string, string>(),
  /** Todas las ubicaciones con su tipo (`Tienda` o cualquier otro, que es CD). */
  tiendas: [] as { id: string; tipo: string }[],
  llamadas: { huella: 0, tablero_proyeccion: [] as { id: string; p: Fila }[], tablero_venta: [] as Fila[], registrar: [] as Fila[] },
  /** Corre justo antes de que la función de registro calcule la huella (simula a otra persona que decide una fila en medio). */
  antesDeRegistrar: null as null | (() => void),
  /** T3: si está, cada `tablero_venta` espera a esta promesa antes de responder (para probar el tope de lecturas simultáneas). */
  esperaVenta: null as null | ((p: Fila) => Promise<void>),
  /** Hace fallar el próximo `rpc` de ese nombre con ese error (una vez). */
  falloRpc: null as null | { nombre: string; code: string; message: string },
  /** Hoy para `calculo_en_curso` de la función de registro. */
  ahora: () => Date.now(),
  /** El último `id` por el que se filtró `proyecciones` (para la FK `restrict` al borrar). */
  idEnConsulta: null as string | null,
};

const err = (code: string, message: string): ErrorFalso => ({ code, message, details: null, hint: null });
const tabla = (t: string): Fila[] => (base.tablas[t] ??= []);
const md5 = (texto: string) => createHash("md5").update(texto).digest("hex");
const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const nulo = (v: unknown): v is null | undefined => v === null || v === undefined;
const r2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100;
const CERO_UUID = "00000000-0000-0000-0000-000000000000";

let relojAprobaciones = 0;
let siguienteAprobacion = 1;

export function reiniciar() {
  reiniciarM7();
  estadoDireccion.hechos = [];
  estadoDireccion.nodos = new Map();
  estadoDireccion.unidadDe = new Map();
  estadoDireccion.amDeUnidad = new Map();
  estadoDireccion.tiendas = [];
  estadoDireccion.llamadas = { huella: 0, tablero_proyeccion: [], tablero_venta: [], registrar: [] };
  estadoDireccion.antesDeRegistrar = null;
  estadoDireccion.esperaVenta = null;
  estadoDireccion.falloRpc = null;
  estadoDireccion.ahora = () => Date.now();
  estadoDireccion.idEnConsulta = null;
  relojAprobaciones = 0;
  siguienteAprobacion = 1;
  base.falloDeEscritura = (t, modo) => {
    // Trigger de inmutabilidad y privilegios: nadie escribe la tabla directamente (la función de registro inserta por dentro).
    if (t === "aprobaciones_direccion") return err("23001", "aprobaciones_direccion es un registro inmutable");
    // FK `on delete restrict`.
    if (t === "proyecciones" && modo === "delete" && tabla("aprobaciones_direccion").some((a) => a.proyeccion_id === estadoDireccion.idEnConsulta)) {
      return err("23503", 'update or delete on table "proyecciones" violates foreign key constraint "aprobaciones_direccion_proyeccion_id_fkey" on table "aprobaciones_direccion"');
    }
    return null;
  };
}

// ─── huella_proyeccion ───

function huellaDe(id: string): string | null {
  const pp = tabla("proyecciones").find((p) => p.id === id);
  if (!pp) return null;
  const t = (v: unknown) => (nulo(v) ? "~" : String(v));
  const parametros = (pp.parametros ?? {}) as { bloques?: Record<string, Record<string, Fila[]>>; crecimiento_resto_usado?: { pct?: unknown; sobre_base?: unknown } };
  const lineas: string[] = ["v|1", ["p", pp.anio_en_curso, String(pp.hasta_periodo).slice(0, 10), t((pp.resumen as Fila | null)?.version_metodo)].join("|")];
  const b: string[] = [];
  for (const anio of Object.keys(parametros.bloques ?? {})) {
    for (const grupo of ["mismas", "nuevas", "cierres", "fuera"]) {
      for (const ti of parametros.bloques?.[anio]?.[grupo] ?? []) b.push(["b", anio, grupo, t(ti.subbloque), t(ti.tienda_id), t(ti.clave)].join("|"));
    }
  }
  lineas.push(...b.sort());
  const filas = tabla("proyeccion_filas").filter((f) => f.proyeccion_id === id && f.activo);
  const f: string[] = [];
  for (const fila of filas) {
    for (const a of tabla("proyeccion_fila_anios").filter((x) => x.fila_id === fila.id && x.activo)) {
      f.push(["f", fila.clave, a.anio, a.bloque, t(a.subbloque), t(a.propuesto), t(a.decidido ?? a.propuesto), t(a.base_siguiente), t(nulo(a.base_normalizada) ? null : num(a.base_normalizada).toFixed(2)), t(nulo(a.meses) ? null : `{${(a.meses as number[]).join(",")}}`)].join("|"));
    }
  }
  lineas.push(...f.sort());
  lineas.push(
    ...tabla("proyeccion_tiendas")
      .filter((x) => x.proyeccion_id === id && x.activo)
      .map((x) => ["t", x.tienda_id, x.anio, t(x.decidido ?? x.propuesto)].join("|"))
      .sort()
  );
  lineas.push(
    ...tabla("proyeccion_crecimientos")
      .filter((x) => x.proyeccion_id === id && x.activo)
      .map((x) => ["c", x.genero_id, x.mundo_id, num(x.pct).toFixed(2), t(x.sobre_base)].join("|"))
      .sort()
  );
  const resto = parametros.crecimiento_resto_usado;
  lineas.push(["r", typeof resto?.pct === "number" ? String(resto.pct) : "~", typeof resto?.sobre_base === "string" ? resto.sobre_base : "~"].join("|"));
  return md5(lineas.join("\n"));
}

/** La huella de hoy de una proyección de la base falsa (para las pruebas). */
export const huellaFalsa = (id: string): string => huellaDe(id) ?? "";

// ─── tablero_proyeccion ───

const fechaLima = (iso: unknown): string | null => {
  if (nulo(iso)) return null;
  const d = new Date(String(iso));
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};

type Reg = {
  anio: number;
  es_y: boolean;
  bloque: string;
  subbloque: string | null;
  vendido: number;
  propuesto: number | null;
  decidido: number | null;
  origen: string | null;
  lote: unknown;
  ia: unknown;
  por: string | null;
  at: unknown;
  propuesta_al_decidir: unknown;
  meses: number[] | null;
  meses_propuestos: unknown;
  B: number | null;
  Bc: number | null;
  vig: number;
  es_manual: boolean;
  suma_meses: number;
  resto: number;
  clave: string;
  gml_id: string;
  am_id: string;
  tienda_id: string | null;
  temporada: string | null;
  phi: unknown;
  con_factor_y: boolean;
  genero_id: string;
  mundo_id: string;
  con_pm: boolean;
  pm: { marca_id: string; participacion: number }[];
  base_con_b: boolean;
  en_mismas_sig: boolean;
  w: number;
};

const phiDe = (phi: unknown, i: number): number => {
  const v = Array.isArray(phi) ? phi[i] : undefined;
  return typeof v === "number" && v > 0 ? v : 1;
};

function tableroProyeccion(id: string, p: Fila): Fila | null {
  const pp = tabla("proyecciones").find((x) => x.id === id);
  if (!pp) return null;
  const Y = num(pp.anio_en_curso);
  const k = Number(String(pp.hasta_periodo).slice(5, 7));
  const parametros = (pp.parametros ?? {}) as { bloques?: Record<string, Record<string, Fila[]>>; crecimiento_resto_usado?: { pct?: unknown; sobre_base?: unknown } };
  const misIds = new Set((parametros.bloques?.[String(Y + 1)]?.mismas ?? []).map((t) => String(t.tienda_id)));
  const lista = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(String) : null);
  const gmlIds = lista(p.gml_ids);
  const amIds = lista(p.agrupacion_marca_ids);
  const temporadas = lista(p.temporadas);
  const unidad = typeof p.unidad_marca_id === "string" && p.unidad_marca_id !== "" ? p.unidad_marca_id : null;
  const desglose = typeof p.desglose === "string" && p.desglose !== "" ? p.desglose : null;

  const filas = tabla("proyeccion_filas").filter((f) => f.proyeccion_id === id && f.activo && estadoDireccion.nodos.has(String(f.gml_id)));
  const grupoDe = (f: Fila) => `${f.gml_id}|${f.equivalencia_id ?? CERO_UUID}|${f.agrupacion_marca_id}`;
  const baseDe = new Map<string, Fila>();
  for (const f of [...filas].sort((a, b) => (String(a.clave) < String(b.clave) ? -1 : 1))) if (nulo(f.tienda_id) && !baseDe.has(grupoDe(f))) baseDe.set(grupoDe(f), f);
  const anios = tabla("proyeccion_fila_anios");
  const baseConB = new Map<string, boolean>();
  for (const [g, f] of baseDe) baseConB.set(g, anios.some((a) => a.fila_id === f.id && a.activo && a.anio === Y + 1 && !nulo(a.base_siguiente)));

  const reg: Reg[] = [];
  for (const f of filas) {
    const nodo = estadoDireccion.nodos.get(String(f.gml_id));
    if (!nodo) continue;
    const baseFila = baseDe.get(grupoDe(f));
    const pmCrudo = (baseFila?.participaciones as { por_marca?: unknown } | null | undefined)?.por_marca;
    const pm = Array.isArray(pmCrudo) ? (pmCrudo as { marca_id: string; participacion: number }[]) : [];
    const phi = (f.factores_mes as Record<string, unknown> | null | undefined)?.[String(Y)];
    for (const a of anios.filter((x) => x.fila_id === f.id && x.activo && (x.anio === Y || x.anio === Y + 1))) {
      const meses = Array.isArray(a.meses) ? (a.meses as number[]) : null;
      const temporada = nulo(f.temporada) ? null : String(f.temporada);
      const r: Reg = {
        anio: num(a.anio),
        es_y: a.anio === Y,
        bloque: String(a.bloque),
        subbloque: nulo(a.subbloque) ? null : String(a.subbloque),
        vendido: num(a.vendido),
        propuesto: nulo(a.propuesto) ? null : num(a.propuesto),
        decidido: nulo(a.decidido) ? null : num(a.decidido),
        origen: nulo(a.origen) ? null : String(a.origen),
        lote: a.decision_lote_id ?? null,
        ia: a.decision_ia_fila_id ?? null,
        por: nulo(a.decidido_por_nombre) ? null : String(a.decidido_por_nombre),
        at: a.decidido_at ?? null,
        propuesta_al_decidir: a.propuesta_al_decidir ?? null,
        meses,
        meses_propuestos: a.meses_propuestos ?? null,
        B: nulo(a.base_siguiente) ? null : num(a.base_siguiente),
        Bc: nulo(a.base_normalizada) ? null : num(a.base_normalizada),
        vig: num(a.decidido ?? a.propuesto),
        es_manual: !nulo(a.decidido) && nulo(a.decision_lote_id) && nulo(a.decision_ia_fila_id) && a.origen === "manual",
        suma_meses: (meses ?? []).reduce((x, y) => x + y, 0),
        resto: (meses ?? []).reduce((x, y, i) => (i + 1 > k ? x + y : x), 0),
        clave: String(f.clave),
        gml_id: String(f.gml_id),
        am_id: String(f.agrupacion_marca_id),
        tienda_id: nulo(f.tienda_id) ? null : String(f.tienda_id),
        temporada,
        phi,
        con_factor_y: Array.isArray(phi) && phi.some((v) => typeof v === "number" && v !== 1),
        genero_id: nodo.genero_id,
        mundo_id: nodo.mundo_id,
        con_pm: pm.length > 0,
        pm,
        base_con_b: baseConB.get(grupoDe(f)) ?? false,
        en_mismas_sig: !nulo(f.tienda_id) && misIds.has(String(f.tienda_id)),
        w: 1,
      };
      reg.push(r);
    }
  }
  const rec = reg
    .filter((r) => (gmlIds === null || gmlIds.includes(r.gml_id)) && (amIds === null || amIds.includes(r.am_id)) && (temporadas === null || temporadas.includes(r.temporada ?? "sin_temporada")))
    .map((r) => ({ ...r, w: unidad === null ? 1 : r.con_pm ? r.pm.filter((m) => m.marca_id === unidad).reduce((a, m) => a + m.participacion, 0) : 0 }));
  const rs = rec.filter((r) => r.w > 0);
  const suma = <T,>(xs: readonly T[], f: (x: T) => number): number => xs.reduce((a, x) => a + f(x), 0);
  const meses12 = (xs: readonly Reg[], sinNino = false): number[] =>
    Array.from({ length: 12 }, (_, i) => {
      const v = suma(xs, (r) => (r.meses ? (r.w * r.meses[i]) / (sinNino ? phiDe(r.phi, i) : 1) : 0));
      return sinNino ? r2(v) : Math.round(v);
    });

  const claseDe = (r: Reg): string => (r.lote !== null ? "lote" : r.ia !== null ? "ia" : r.decidido === null ? "sin_decidir" : r.origen === "propuesta" ? "propuesta" : r.origen === "escalada" ? "escalada" : "manual");
  const decisionesDe = (xs: readonly Reg[]): Fila => {
    const salida: Fila = {};
    for (const c of ["lote", "ia", "propuesta", "manual", "escalada", "sin_decidir"]) {
      const de = xs.filter((r) => claseDe(r) === c);
      salida[c] = { n: de.length, u: Math.round(suma(de, (r) => r.w * r.vig)) };
    }
    const decididos = xs.filter((r) => r.decidido !== null);
    const porAutor = new Map<string, Reg[]>();
    for (const r of decididos) porAutor.set(r.por ?? "", [...(porAutor.get(r.por ?? "") ?? []), r]);
    salida.autores = [...porAutor]
      .map(([nombre, de]) => {
        const fechas = de.map((r) => fechaLima(r.at)).filter((x): x is string => x !== null).sort();
        return { nombre, n: de.length, u: Math.round(suma(de, (r) => r.w * r.vig)), desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null };
      })
      .sort((a, b) => b.u - a.u || a.nombre.localeCompare(b.nombre));
    const porDia = new Map<string, number>();
    for (const r of decididos) {
      const f = fechaLima(r.at);
      if (f !== null) porDia.set(f, (porDia.get(f) ?? 0) + 1);
    }
    const pico = [...porDia].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0];
    salida.dia_pico = pico ? { fecha: pico[0], n: pico[1] } : null;
    return salida;
  };

  const anioDoc = (anio: number): Fila => {
    const esY = anio === Y;
    const de = rs.filter((r) => r.anio === anio);
    const b = de.filter((r) => r.tienda_id === null);
    const conB = b.filter((r) => r.B !== null);
    const vigConB = Math.round(suma(conB, (r) => r.w * r.vig));
    const propConB = Math.round(suma(conB, (r) => r.w * (r.propuesto ?? 0)));
    const dManual = Math.round(suma(conB.filter((r) => r.es_manual), (r) => r.w * (r.vig - (r.propuesto ?? 0))));
    const tiendas = new Map<string, Reg[]>();
    for (const r of de.filter((x) => x.tienda_id !== null)) {
      const clave = `${r.tienda_id}|${r.bloque}|${r.subbloque ?? ""}`;
      tiendas.set(clave, [...(tiendas.get(clave) ?? []), r]);
    }
    return {
      anio,
      base: {
        meses: meses12(b),
        vigente: Math.round(suma(b, (r) => r.w * r.vig)),
        propuesto: Math.round(suma(b, (r) => r.w * (r.propuesto ?? 0))),
        vendido: Math.round(suma(b, (r) => r.w * r.vendido)),
        sin_meses: Math.round(suma(b, (r) => r.w * (r.vig - r.suma_meses))),
        B: esY || conB.length === 0 ? null : Math.round(suma(conB, (r) => r.w * (r.B ?? 0))),
        B_corr: esY || conB.length === 0 ? null : r2(suma(conB, (r) => r.w * (r.Bc ?? 0))),
        vigente_con_B: esY ? null : vigConB,
        propuesto_con_B: esY ? null : propConB,
        vigente_sin_B: esY ? null : Math.round(suma(b.filter((r) => r.B === null), (r) => r.w * r.vig)),
        delta_manual: esY ? null : dManual,
        delta_otras: esY ? null : vigConB - propConB - dManual,
        meses_sin_nino: esY ? meses12(b, true) : null,
      },
      tiendas: [...tiendas]
        .sort((x, y) => (x[0] < y[0] ? -1 : 1))
        .map(([, xs]) => ({
          t: xs[0].tienda_id,
          bloque: xs[0].bloque,
          subbloque: xs[0].subbloque,
          meses: meses12(xs),
          vigente: Math.round(suma(xs, (r) => r.w * r.vig)),
          sin_meses: Math.round(suma(xs, (r) => r.w * (r.vig - r.suma_meses))),
          para_base: esY && xs[0].en_mismas_sig ? Math.round(suma(xs.filter((r) => r.base_con_b), (r) => r.w * r.vig)) : null,
        })),
      decisiones: decisionesDe(de),
      conteos: {
        registros: de.length,
        propuesta_cambio: de.filter((r) => r.decidido !== null && r.propuesto !== (r.propuesta_al_decidir ?? null)).length,
        curva_cambio: de.filter((r) => r.meses_propuestos !== null).length,
      },
    };
  };

  // por_gm: SIEMPRE de toda la proyección (sin filtros ni unidad de marca).
  const gms = new Map<string, Reg[]>();
  for (const r of reg) gms.set(`${r.genero_id}|${r.mundo_id}`, [...(gms.get(`${r.genero_id}|${r.mundo_id}`) ?? []), r]);
  const porGm = [...gms]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([clave, xs]) => {
      const [g, m] = clave.split("|");
      const y = xs.filter((r) => r.es_y);
      const s = xs.filter((r) => !r.es_y);
      const yBase = y.filter((r) => r.tienda_id === null);
      const sBase = s.filter((r) => r.tienda_id === null);
      const conB = sBase.filter((r) => r.B !== null);
      const sT = s.filter((r) => r.tienda_id !== null);
      const unos = yBase.map((r) => ({ ...r, w: 1 }));
      return {
        g,
        m,
        Y: {
          cierre: suma(y, (r) => r.vig),
          base: suma(yBase, (r) => r.vig),
          fuera_base_exacto: suma(y.filter((r) => r.tienda_id !== null), (r) => r.vig) - suma(y.filter((r) => r.tienda_id !== null && r.en_mismas_sig && r.base_con_b), (r) => r.vig),
          base_meses: meses12(unos),
          base_meses_sin_nino: meses12(unos, true),
        },
        Y1: {
          B: conB.length === 0 ? null : suma(conB, (r) => r.B ?? 0),
          B_corr: conB.length === 0 ? null : r2(suma(conB, (r) => r.Bc ?? 0)),
          propuesto_con_B: suma(conB, (r) => r.propuesto ?? 0),
          vigente_con_B: suma(conB, (r) => r.vig),
          vigente_sin_B: suma(sBase.filter((r) => r.B === null), (r) => r.vig),
          delta_manual: suma(conB.filter((r) => r.es_manual), (r) => r.vig - (r.propuesto ?? 0)),
          delta_otras: suma(conB.filter((r) => !r.es_manual), (r) => r.vig - (r.propuesto ?? 0)),
          nuevas_anterior: suma(sT.filter((r) => r.bloque !== "cierres" && r.subbloque === "nuevas_anterior"), (r) => r.vig),
          aperturas: suma(sT.filter((r) => r.bloque !== "cierres" && r.subbloque !== "nuevas_anterior"), (r) => r.vig),
          cierres: suma(sT.filter((r) => r.bloque === "cierres"), (r) => r.vig),
          total: suma(s, (r) => r.vig),
        },
      };
    });

  // por_dim.
  let porDim: Fila[] | null = null;
  if (desglose !== null && desglose !== "tienda") {
    type Aporte = { d: string; es_y: boolean; tienda_id: string | null; v: number; v_resto: number };
    const aportes: Aporte[] = [];
    if (desglose === "marca") {
      for (const r of rec.filter((x) => x.con_pm)) for (const m of r.pm) if (unidad === null || m.marca_id === unidad) aportes.push({ d: m.marca_id, es_y: r.es_y, tienda_id: r.tienda_id, v: m.participacion * r.vig, v_resto: m.participacion * r.resto });
    } else {
      const dDe = (r: Reg) => (desglose === "genero" ? r.genero_id : desglose === "mundo" ? r.mundo_id : desglose === "linea" ? r.gml_id : desglose === "agrupacion_marca" ? r.am_id : (r.temporada ?? "sin_temporada"));
      for (const r of rs) aportes.push({ d: dDe(r), es_y: r.es_y, tienda_id: r.tienda_id, v: r.w * r.vig, v_resto: r.w * r.resto });
    }
    const ds = [...new Set(aportes.map((a) => a.d))].sort();
    const pares = (xs: Aporte[]) => {
      const m = new Map<string, number>();
      for (const a of xs) m.set(String(a.tienda_id), (m.get(String(a.tienda_id)) ?? 0) + a.v);
      return [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([t, v]) => [t, Math.round(v)]);
    };
    porDim = ds.map((d) => {
      const de = aportes.filter((a) => a.d === d);
      return {
        d,
        Y: { base: Math.round(suma(de.filter((a) => a.es_y && a.tienda_id === null), (a) => a.v)), base_resto: Math.round(suma(de.filter((a) => a.es_y && a.tienda_id === null), (a) => a.v_resto)), tiendas: pares(de.filter((a) => a.es_y && a.tienda_id !== null)) },
        Y1: { base: Math.round(suma(de.filter((a) => !a.es_y && a.tienda_id === null), (a) => a.v)), tiendas: pares(de.filter((a) => !a.es_y && a.tienda_id !== null)) },
      };
    });
  }

  const temporadasDoc = [...new Set(rs.map((r) => r.temporada))].sort((a, b) => (a === null ? 1 : b === null ? -1 : a < b ? -1 : 1));
  const porTemporada = temporadasDoc.map((t) => {
    const de = rs.filter((r) => r.temporada === t && !r.es_y);
    return { temporada: t, Y1: Math.round(suma(de, (r) => r.w * r.vig)), Y1_con_factor_Y: Math.round(suma(de.filter((r) => r.tienda_id === null && r.con_factor_y), (r) => r.w * r.vig)) };
  });

  const paresMap = new Map<string, { gml: string; am: string; y_resto: number; y1: number }>();
  for (const r of rs) {
    const x = paresMap.get(`${r.gml_id}|${r.am_id}`) ?? { gml: r.gml_id, am: r.am_id, y_resto: 0, y1: 0 };
    if (r.es_y) x.y_resto += r.w * r.resto;
    else x.y1 += r.w * r.vig;
    paresMap.set(`${r.gml_id}|${r.am_id}`, x);
  }
  const paresLista = [...paresMap.values()].map((x) => ({ ...x, y_resto: Math.round(x.y_resto), y1: Math.round(x.y1) })).filter((x) => x.y_resto !== 0 || x.y1 !== 0);
  const gmls = [...new Set(paresLista.map((x) => x.gml))].sort();
  const ams = [...new Set(paresLista.map((x) => x.am))].sort();

  const mayores = rs
    .filter((r) => !r.es_y && r.tienda_id === null)
    .map((r) => ({ clave: r.clave, gml_id: r.gml_id, am_id: r.am_id, Y1: Math.round(r.w * r.vig), B: r.B === null ? null : Math.round(r.w * r.B) }))
    .sort((a, b) => b.Y1 - a.Y1 || (a.clave < b.clave ? -1 : 1))
    .slice(0, 20);

  const resto = parametros.crecimiento_resto_usado;
  return {
    huella: huellaDe(id),
    resto: { pct: typeof resto?.pct === "number" ? resto.pct : null, sobre_base: typeof resto?.sobre_base === "string" ? resto.sobre_base : null },
    anios: [anioDoc(Y), anioDoc(Y + 1)],
    por_gm: porGm,
    por_dim: porDim,
    por_temporada: porTemporada,
    por_par: { gml: gmls, am: ams, filas: paresLista.sort((a, b) => (a.gml + a.am < b.gml + b.am ? -1 : 1)).map((x) => [gmls.indexOf(x.gml), ams.indexOf(x.am), x.y_resto, x.y1]) },
    mayores,
    sin_participacion_marca:
      unidad !== null || desglose === "marca"
        ? { Y: Math.round(suma(rec.filter((r) => !r.con_pm && r.es_y), (r) => r.vig)), Y1: Math.round(suma(rec.filter((r) => !r.con_pm && !r.es_y), (r) => r.vig)) }
        : null,
  };
}

// ─── tablero_venta ───

function tableroVenta(p: Fila): Fila {
  const lista = (v: unknown): string[] | null => (Array.isArray(v) ? v.map(String) : null);
  const gmlIds = lista(p.gml_ids);
  const amIds = lista(p.agrupacion_marca_ids);
  const tiendaIds = lista(p.tienda_ids);
  const temporadas = lista(p.temporadas);
  const unidad = typeof p.unidad_marca_id === "string" && p.unidad_marca_id !== "" ? p.unidad_marca_id : null;
  const proyeccionId = typeof p.proyeccion_id === "string" ? p.proyeccion_id : null;
  const desglose = typeof p.desglose === "string" && p.desglose !== "" ? p.desglose : null;
  const desde = typeof p.desde === "string" ? p.desde.slice(0, 7) : null;
  const hasta = typeof p.hasta === "string" ? p.hasta.slice(0, 7) : null;
  const tiendas = estadoDireccion.tiendas.filter((t) => t.tipo === "Tienda").map((t) => t.id).sort();
  const esTienda = new Set(tiendas);
  const publicadas = tabla("cargas_venta_stock").filter((c) => c.estado === "publicada");
  const periodos: Record<string, string> = {};
  if (desde !== null && hasta !== null) for (const c of publicadas) if (String(c.periodo).slice(0, 7) >= desde && String(c.periodo).slice(0, 7) <= hasta) periodos[String(c.periodo).slice(0, 7)] = String(c.id);
  const Y = hasta === null ? 0 : Number(hasta.slice(0, 4));
  const kPrima = typeof p.k_prima === "number" ? p.k_prima : hasta === null ? 12 : Number(hasta.slice(5, 7));
  const publicado = (periodo: string) => periodo in periodos;

  // Filas base activas de la proyección: su temporada por (nodo, equivalencia, AM).
  const temporadaBase = new Map<string, string>();
  if (proyeccionId !== null) {
    for (const f of tabla("proyeccion_filas").filter((x) => x.proyeccion_id === proyeccionId && x.activo && nulo(x.tienda_id))) {
      temporadaBase.set(`${f.gml_id}|${f.equivalencia_id ?? CERO_UUID}|${f.agrupacion_marca_id}`, nulo(f.temporada) ? "sin_temporada" : String(f.temporada));
    }
  }
  const amDe = (h: Hecho) => estadoDireccion.amDeUnidad.get(estadoDireccion.unidadDe.get(h.marca_id) ?? h.marca_id) ?? "";
  const claveBase = (h: Hecho) => `${h.gml_id}|${h.equivalencia_id ?? CERO_UUID}|${amDe(h)}`;
  const hechos = estadoDireccion.hechos.filter((h) => publicado(h.periodo));
  const enProducto = (h: Hecho) => (gmlIds === null || gmlIds.includes(h.gml_id)) && (amIds === null || amIds.includes(amDe(h))) && (unidad === null || (estadoDireccion.unidadDe.get(h.marca_id) ?? h.marca_id) === unidad);
  const enTemporada = (h: Hecho) => temporadas === null || (temporadaBase.has(claveBase(h)) && temporadas.includes(temporadaBase.get(claveBase(h)) as string));
  const enRecorte = (h: Hecho) => enProducto(h) && enTemporada(h);
  const enTiendas = (h: Hecho) => tiendaIds === null || tiendaIds.includes(h.tienda_id);
  const anioDe = (h: Hecho) => Number(h.periodo.slice(0, 4));
  const mesDe = (h: Hecho) => Number(h.periodo.slice(5, 7));

  if (p.solo_tendencia === true) {
    const m = new Map<string, { g: string; mu: string; t: string; cur: number; ant: number }>();
    for (const h of hechos) {
      if (!esTienda.has(h.tienda_id) || mesDe(h) > kPrima) continue;
      const nodo = estadoDireccion.nodos.get(h.gml_id);
      if (!nodo) continue;
      const clave = `${nodo.genero_id}|${nodo.mundo_id}|${h.tienda_id}`;
      const x = m.get(clave) ?? { g: nodo.genero_id, mu: nodo.mundo_id, t: h.tienda_id, cur: 0, ant: 0 };
      if (anioDe(h) === Y) x.cur += h.u;
      else if (anioDe(h) === Y - 1) x.ant += h.u;
      m.set(clave, x);
    }
    return {
      periodos,
      tiendas,
      tendencia_gm: [...m.values()].filter((x) => x.cur !== 0 || x.ant !== 0).sort((a, b) => (a.g + a.mu + a.t < b.g + b.mu + b.t ? -1 : 1)).map((x) => [x.g, x.mu, tiendas.indexOf(x.t), x.cur, x.ant]),
    };
  }

  const porTienda = new Map<string, { t: string; p: string; u: number; s: number }>();
  for (const h of hechos) {
    if (!esTienda.has(h.tienda_id) || !enRecorte(h)) continue;
    const x = porTienda.get(`${h.tienda_id}|${h.periodo}`) ?? { t: h.tienda_id, p: h.periodo, u: 0, s: 0 };
    x.u += h.u;
    x.s += h.s;
    porTienda.set(`${h.tienda_id}|${h.periodo}`, x);
  }

  let porDim: Fila | null = null;
  if (desglose !== null && desglose !== "tienda") {
    const dDe = (h: Hecho): string => {
      const nodo = estadoDireccion.nodos.get(h.gml_id);
      if (desglose === "genero") return nodo?.genero_id ?? "";
      if (desglose === "mundo") return nodo?.mundo_id ?? "";
      if (desglose === "linea") return h.gml_id;
      if (desglose === "agrupacion_marca") return amDe(h);
      if (desglose === "marca") return estadoDireccion.unidadDe.get(h.marca_id) ?? h.marca_id;
      return temporadaBase.get(claveBase(h)) ?? "fuera_universo";
    };
    const m = new Map<string, number[]>();
    for (const h of hechos) {
      if (!esTienda.has(h.tienda_id) || !enRecorte(h) || !enTiendas(h)) continue;
      const x = m.get(dDe(h)) ?? [0, 0, 0, 0, 0, 0, 0];
      const z = anioDe(h);
      if (z === Y - 3) x[0] += h.u;
      if (z === Y - 2) x[1] += h.u;
      if (z === Y - 1) {
        x[2] += h.u;
        x[5] += h.s;
        if (mesDe(h) <= kPrima) x[3] += h.u;
      }
      if (z === Y && mesDe(h) <= kPrima) {
        x[4] += h.u;
        x[6] += h.s;
      }
      m.set(dDe(h), x);
    }
    const ids = [...m].filter(([, x]) => x.some((v) => v !== 0)).map(([d]) => d).sort();
    porDim = { ids, filas: ids.map((d, i) => [i, ...(m.get(d) as number[])]) };
  }

  const ultimos12 = (h: Hecho) => {
    if (hasta === null) return false;
    const total = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7));
    return total(h.periodo) > total(hasta) - 12 && total(h.periodo) <= total(hasta);
  };
  const precios = new Map<string, { gml: string; am: string; u: number; s: number }>();
  for (const h of hechos) {
    if (!esTienda.has(h.tienda_id) || !enRecorte(h) || !enTiendas(h) || !ultimos12(h)) continue;
    const x = precios.get(`${h.gml_id}|${amDe(h)}`) ?? { gml: h.gml_id, am: amDe(h), u: 0, s: 0 };
    x.u += h.u;
    x.s += h.s;
    precios.set(`${h.gml_id}|${amDe(h)}`, x);
  }
  const preciosLista = [...precios.values()].filter((x) => x.u !== 0 || x.s !== 0);
  const gmls = [...new Set(preciosLista.map((x) => x.gml))].sort();
  const ams = [...new Set(preciosLista.map((x) => x.am))].sort();

  const stock = new Map<string, number>();
  let cd = 0;
  for (const h of estadoDireccion.hechos) {
    if (h.periodo !== hasta || !publicado(h.periodo) || nulo(h.stock) || !enRecorte(h)) continue;
    if (esTienda.has(h.tienda_id)) {
      if (enTiendas(h)) stock.set(h.tienda_id, (stock.get(h.tienda_id) ?? 0) + num(h.stock));
    } else cd += num(h.stock);
  }

  let fuera: [number, number][] | null = null;
  if (proyeccionId !== null) {
    const m = new Map<number, number>();
    for (const h of hechos) {
      if (!esTienda.has(h.tienda_id) || !enProducto(h) || temporadaBase.has(claveBase(h))) continue;
      m.set(anioDe(h), (m.get(anioDe(h)) ?? 0) + h.u);
    }
    fuera = [...m].filter(([, u]) => u !== 0).sort((a, b) => a[0] - b[0]);
  }

  return {
    periodos,
    tiendas,
    por_tienda: [...porTienda.values()].sort((a, b) => (a.t + a.p < b.t + b.p ? -1 : 1)).map((x) => [tiendas.indexOf(x.t), x.p, x.u, r2(x.s)]),
    por_dim: porDim,
    precios: { gml: gmls, am: ams, filas: preciosLista.sort((a, b) => (a.gml + a.am < b.gml + b.am ? -1 : 1)).map((x) => [gmls.indexOf(x.gml), ams.indexOf(x.am), x.u, r2(x.s)]) },
    stock: { periodo: hasta, por_tienda: [...stock].filter(([, u]) => u !== 0).sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([t, u]) => [tiendas.indexOf(t), u]), cd: tiendaIds === null ? cd : null },
    tendencia_gm: null,
    fuera_universo: fuera,
  };
}

// ─── registrar_aprobacion_direccion ───

const MOTIVOS = ["crecimiento_alto", "crecimiento_bajo", "contra_tendencia", "tiendas_nuevas", "nino", "filas_sin_decidir", "concentracion", "otro"];
function registrar(p: Fila): { data: Fila | null; error: ErrorFalso | null } {
  const id = String(p.proyeccion_id ?? "");
  const pp = tabla("proyecciones").find((x) => x.id === id);
  if (!pp || pp.activo === false) return { data: { error: "no_encontrada" }, error: null };
  if (pp.estado === "archivada") return { data: { error: "archivada" }, error: null };
  if (!nulo(pp.calculando_desde) && estadoDireccion.ahora() - Date.parse(String(pp.calculando_desde)) < 15 * 60 * 1000) return { data: { error: "calculo_en_curso" }, error: null };
  if (nulo(pp.resumen)) return { data: { error: "sin_calcular" }, error: null };
  estadoDireccion.antesDeRegistrar?.();
  const h = huellaDe(id);
  const resumen = p.resumen as Fila | null;
  if (h !== p.huella_vista || h !== resumen?.huella) return { data: { error: "huella_distinta", huella_actual: h }, error: null };

  // Los `check` de la tabla (la segunda barrera; zod ya validó).
  const resultado = String(p.resultado);
  const motivo = nulo(p.motivo) || p.motivo === "" ? null : String(p.motivo);
  const comentario = nulo(p.comentario) || p.comentario === "" ? null : String(p.comentario);
  if (p.rol !== "admin") return { data: null, error: err("23514", 'new row for relation "aprobaciones_direccion" violates check constraint "aprobaciones_direccion_rol_check"') };
  if (!["aprobada", "con_observaciones", "rechazada"].includes(resultado)) return { data: null, error: err("23514", 'violates check constraint "aprobaciones_direccion_resultado_check"') };
  if (motivo !== null && !MOTIVOS.includes(motivo)) return { data: null, error: err("23514", 'violates check constraint "aprobaciones_direccion_motivo_check"') };
  if (comentario !== null && [...comentario].length > 1000) return { data: null, error: err("23514", 'violates check constraint "aprobaciones_direccion_comentario_check"') };
  if (resultado !== "aprobada" && (motivo === null || comentario === null || [...comentario.trim()].length < 10)) return { data: null, error: err("23514", 'violates check constraint "aprobaciones_direccion_motivo_comentario_check"') };
  const nombre = String(p.usuario_nombre ?? "");
  if (nombre.length < 1 || nombre.length > 200) return { data: null, error: err("23514", 'violates check constraint "aprobaciones_direccion_usuario_nombre_check"') };
  if (Buffer.byteLength(JSON.stringify(resumen), "utf8") > 65536) return { data: null, error: err("23514", 'violates check constraint "aprobaciones_direccion_resumen_check"') };

  const instante = new Date(Date.UTC(2026, 10, 8, 15, 0, 0) + relojAprobaciones++ * 60_000).toISOString();
  const fila: Fila = {
    id: `ad000000-0000-4000-8000-${String(siguienteAprobacion++).padStart(12, "0")}`,
    proyeccion_id: id,
    anio_en_curso: pp.anio_en_curso,
    estado_proyeccion: pp.estado,
    huella: h,
    resultado,
    motivo,
    comentario,
    resumen: JSON.parse(JSON.stringify(resumen)),
    perfil_id: p.perfil_id ?? null,
    usuario_nombre: nombre,
    rol: "admin",
    activo: true,
    created_at: instante,
    updated_at: instante,
  };
  tabla("aprobaciones_direccion").push(fila);
  return { data: { ...fila }, error: null };
}

/** Siembra una aprobación ya registrada (como si la función la hubiera insertado en otro momento). */
export function sembrarAprobacion(fila: Fila): Fila {
  const completa = { activo: true, rol: "admin", motivo: null, comentario: null, perfil_id: null, updated_at: fila.created_at, ...fila };
  tabla("aprobaciones_direccion").push(completa);
  return completa;
}

// ─── Cliente ───

export function clienteFalso() {
  const m7 = clienteM7();
  return {
    from: (t: string) => {
      const consulta = m7.from(t);
      if (t === "proyecciones") {
        const eq = consulta.eq.bind(consulta);
        consulta.eq = (c: string, v: unknown) => {
          if (c === "id") estadoDireccion.idEnConsulta = String(v);
          return eq(c, v);
        };
      }
      return consulta;
    },
    rpc: (nombre: string, args: Record<string, unknown>) => {
      const fallo = estadoDireccion.falloRpc;
      if (fallo && fallo.nombre === nombre) {
        estadoDireccion.falloRpc = null;
        return abortable(Promise.resolve({ data: null, error: err(fallo.code, fallo.message) }));
      }
      if (nombre === "huella_proyeccion") {
        estadoDireccion.llamadas.huella += 1;
        return abortable(Promise.resolve({ data: huellaDe(String(args.p_proyeccion_id)), error: null }));
      }
      if (nombre === "tablero_proyeccion") {
        const p = (args.p ?? {}) as Fila;
        estadoDireccion.llamadas.tablero_proyeccion.push({ id: String(args.p_proyeccion_id), p: JSON.parse(JSON.stringify(p)) });
        return abortable(Promise.resolve({ data: tableroProyeccion(String(args.p_proyeccion_id), p), error: null }));
      }
      if (nombre === "tablero_venta") {
        const p = (args.p ?? {}) as Fila;
        estadoDireccion.llamadas.tablero_venta.push(JSON.parse(JSON.stringify(p)));
        const espera = estadoDireccion.esperaVenta;
        if (espera) return abortable(espera(p).then(() => ({ data: tableroVenta(p), error: null })));
        return abortable(Promise.resolve({ data: tableroVenta(p), error: null }));
      }
      if (nombre === "registrar_aprobacion_direccion") {
        const p = (args.p ?? {}) as Fila;
        estadoDireccion.llamadas.registrar.push(JSON.parse(JSON.stringify(p)));
        return abortable(Promise.resolve(registrar(p)));
      }
      return m7.rpc(nombre, args);
    },
  };
}

// ─── Guards ───

export const estadoRol = { rol: "admin" as "admin" | "planner" | "comprador" | "sin_sesion", perfil: { id: "a0000008-0000-4000-8000-000000000001", email: "admin@example.com", nombre: "Admin A." as string | null, activo: true } };

/** Guards falsos: sin sesión `401`; `requirePlanner` rechaza al comprador y `requireAdmin` rechaza a todos menos al admin, con `403`. */
export function guardFalso() {
  const corta = (mensaje: string, status: number) => ({ user: null, perfil: null, rol: null, response: NextResponse.json({ error: mensaje }, { status }) });
  const pasa = () => ({ user: {}, perfil: { ...estadoRol.perfil, rol: estadoRol.rol }, rol: estadoRol.rol, response: null });
  return {
    requireUser: async () => (estadoRol.rol === "sin_sesion" ? corta("No autenticado.", 401) : pasa()),
    requirePlanner: async () => (estadoRol.rol === "sin_sesion" ? corta("No autenticado.", 401) : estadoRol.rol === "comprador" ? corta("Tu rol es de solo lectura.", 403) : pasa()),
    requireAdmin: async () => (estadoRol.rol === "sin_sesion" ? corta("No autenticado.", 401) : estadoRol.rol !== "admin" ? corta("Requiere permisos de administrador.", 403) : pasa()),
  };
}

/** Foto de todas las tablas de la base falsa (para comprobar que una lectura no cambia nada, R24). */
export const fotoDeLaBase = (): string => JSON.stringify(Object.fromEntries(Object.entries(base.tablas).sort(([a], [b]) => (a < b ? -1 : 1))));
