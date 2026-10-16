/**
 * Base falsa en memoria para probar los handlers de M7 sin red ni datos reales. Implementa lo que usan las consultas de M7:
 * `select` (con columnas y relaciones embebidas filas ↔ años), filtros (`eq`, `neq`, `is`, `in`, `not … is null`), `order`,
 * `range`, `limit`, `single`, `maybeSingle`, `insert`, `update`, `upsert` con `onConflict`, `delete` con `cascade` y el `rpc`
 * `venta_proyeccion`. Hace cumplir los `check` y únicos de la 0018 que importan (la decisión con su origen, doce meses, una
 * sola `cerrada` por año, nombre único por año, `unique (fila_id, anio)`), con los mismos nombres de restricción que Postgres.
 */

export type Fila = Record<string, unknown>;
export type ErrorFalso = { code: string; message: string; details: null; hint: null };

const COLUMNAS: Record<string, string[]> = {
  proyecciones: ["id", "anio_en_curso", "nombre", "estado", "hasta_periodo", "parametros", "resumen", "calculando_desde", "calculado_at", "cerrada_at", "cerrada_por_id", "cerrada_por_nombre", "nota", "perfil_id", "usuario_nombre", "activo", "created_at", "updated_at"],
  proyeccion_filas: ["id", "proyeccion_id", "tienda_id", "gml_id", "equivalencia_id", "agrupacion_marca_id", "clave", "nivel_proyectado", "agrupacion_estacionalidad_id", "temporada", "curva", "curva_origen", "factores_mes", "historico", "participaciones", "composicion", "avisos", "activo", "created_at", "updated_at"],
  proyeccion_fila_anios: ["id", "fila_id", "anio", "bloque", "subbloque", "vendido", "propuesto", "metodo", "referencia_alternativa", "referencia_tres_meses", "explicacion", "crecimiento_pct", "decidido", "origen", "propuesta_al_decidir", "nota", "decidido_at", "decidido_por_id", "decidido_por_nombre", "meses", "origen_meses", "curva_origen_usada", "meses_propuestos", "curva_origen_propuesta", "avisos", "activo", "created_at", "updated_at"],
  proyeccion_tiendas: ["id", "proyeccion_id", "tienda_id", "anio", "bloque", "subbloque", "fecha_usada", "venta_esperada_usada", "referente_id_usado", "origen_composicion", "rampa", "unidades_maduras", "vendido", "propuesto", "metodo", "decidido", "origen", "propuesta_al_decidir", "nota", "decidido_at", "decidido_por_id", "decidido_por_nombre", "explicacion", "referencia_alternativa", "referencia_tres_meses", "avisos", "activo", "created_at", "updated_at"],
  factores_volumen_atipico: ["id", "anio", "temporada", "ratio_calculado", "ratio_aplicado", "huella_cargas", "calculado_at", "tiendas_comunes", "meses_comparados", "parcial", "nota", "perfil_id", "usuario_nombre", "activo", "created_at", "updated_at"],
};

const DEFECTOS: Record<string, Fila> = {
  proyecciones: { estado: "en_trabajo", activo: true },
  proyeccion_filas: { curva_origen: [], avisos: [], activo: true },
  proyeccion_fila_anios: { vendido: 0, metodo: "sin_propuesta", explicacion: "", curva_origen_usada: [], avisos: [], activo: true },
  proyeccion_tiendas: { rampa: [1, 1, 1], vendido: 0, metodo: "sin_propuesta", explicacion: "", avisos: [], activo: true },
  factores_volumen_atipico: { parcial: false, activo: true },
};

const ONCONFLICT: Record<string, string[]> = {
  proyeccion_filas: ["proyeccion_id", "clave"],
  proyeccion_fila_anios: ["fila_id", "anio"],
  proyeccion_tiendas: ["proyeccion_id", "tienda_id", "anio"],
  factores_volumen_atipico: ["anio", "temporada"],
};

/** Relaciones embebidas: `padre.tabla → hijos` (por `fk`) y `hijo.tabla → padre`. */
const RELACIONES: Record<string, Record<string, { fk: string; tipo: "hijos" | "padre" }>> = {
  proyeccion_filas: { proyeccion_fila_anios: { fk: "fila_id", tipo: "hijos" } },
  proyeccion_fila_anios: { proyeccion_filas: { fk: "fila_id", tipo: "padre" } },
};

export type EstadoFalso = {
  tablas: Record<string, Fila[]>;
  siguienteId: number;
  /** Respuesta de `venta_proyeccion` por llamada (lo arma el test con el fixture). */
  venta: (args: { p_gml_ids: string[]; p_grupos: Record<string, string>; p_tiendas_detalle: string[]; p_desde: string; p_desde_w12: string }, llamada: number) => unknown;
  llamadasVenta: number;
  /** Hace fallar el próximo `rpc` con ese error. */
  errorVenta: { code: string; message: string } | null;
  /** Gancho de escritura: si devuelve un error, esa operación falla sin tocar nada (para probar reversiones). */
  falloDeEscritura: ((tabla: string, modo: "insert" | "update" | "delete" | "upsert", carga: Fila | Fila[]) => ErrorFalso | null) | null;
  /** Observador: se avisa de cada operación que se arma (`select`, `insert`, `update`, `upsert`, `delete`) para comprobar el orden de lecturas y escrituras. */
  alOperar: ((tabla: string, operacion: "select" | "insert" | "update" | "upsert" | "delete") => void) | null;
};

export const estado: EstadoFalso = { tablas: {}, siguienteId: 1, venta: () => ({}), llamadasVenta: 0, errorVenta: null, falloDeEscritura: null, alOperar: null };

export function reiniciar() {
  estado.tablas = {};
  estado.siguienteId = 1;
  estado.llamadasVenta = 0;
  estado.errorVenta = null;
  estado.falloDeEscritura = null;
  estado.alOperar = null;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ahora = () => "2026-10-15T15:00:00.000Z";

const err = (code: string, message: string): ErrorFalso => ({ code, message, details: null, hint: null });

function dividir(columnas: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let actual = "";
  for (const c of columnas) {
    if (c === "(") nivel += 1;
    if (c === ")") nivel -= 1;
    if (c === "," && nivel === 0) {
      partes.push(actual.trim());
      actual = "";
    } else actual += c;
  }
  if (actual.trim()) partes.push(actual.trim());
  return partes;
}

type Resultado = { data: unknown; error: ErrorFalso | null };

class Consulta implements PromiseLike<Resultado> {
  private modo: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private filtros: Array<(f: Fila) => boolean> = [];
  private ordenes: Array<[string, boolean]> = [];
  private carga: Fila | Fila[] = {};
  private una: "single" | "maybeSingle" | null = null;
  private desde = 0;
  private hasta = Infinity;
  private tope = Infinity;
  private seleccion: string | null = null;
  private onConflict: string[] | null = null;
  private pidioSelect = false;

  constructor(private readonly tabla: string) {}

  select(columnas = "*") {
    if (this.modo === "select") estado.alOperar?.(this.tabla, "select");
    this.pidioSelect = true;
    this.seleccion = columnas;
    return this;
  }
  insert(f: Fila | Fila[]) {
    estado.alOperar?.(this.tabla, "insert");
    this.modo = "insert";
    this.carga = f;
    return this;
  }
  update(f: Fila) {
    estado.alOperar?.(this.tabla, "update");
    this.modo = "update";
    this.carga = f;
    return this;
  }
  upsert(f: Fila | Fila[], opciones?: { onConflict?: string }) {
    estado.alOperar?.(this.tabla, "upsert");
    this.modo = "upsert";
    this.carga = f;
    this.onConflict = opciones?.onConflict ? opciones.onConflict.split(",").map((c) => c.trim()) : null;
    return this;
  }
  delete() {
    estado.alOperar?.(this.tabla, "delete");
    this.modo = "delete";
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
  is(c: string, v: unknown) {
    this.filtros.push((f) => (v === null ? f[c] === null || f[c] === undefined : f[c] === v));
    return this;
  }
  gt(c: string, v: unknown) {
    this.filtros.push((f) => f[c] !== null && f[c] !== undefined && (f[c] as string | number) > (v as string | number));
    return this;
  }
  lt(c: string, v: unknown) {
    this.filtros.push((f) => f[c] !== null && f[c] !== undefined && (f[c] as string | number) < (v as string | number));
    return this;
  }
  /** Solo la forma `col.is.null,col.lt.valor` que usa M7. */
  or(expresion: string) {
    const m = /^(\w+)\.is\.null,(\w+)\.lt\.(.+)$/.exec(expresion);
    if (!m) throw new Error(`or no soportado: ${expresion}`);
    this.filtros.push((f) => f[m[1]] === null || f[m[1]] === undefined || (f[m[2]] as string) < m[3]);
    return this;
  }
  not(c: string, op: string, v: unknown) {
    if (op === "is" && v === null) this.filtros.push((f) => f[c] !== null && f[c] !== undefined);
    return this;
  }
  order(c: string, o?: { ascending?: boolean }) {
    this.ordenes.push([c, o?.ascending !== false]);
    return this;
  }
  limit(n: number) {
    this.tope = n;
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

  // ─── restricciones de la 0018 ───

  private validar(fila: Fila, filas: Fila[], previa: Fila | null): ErrorFalso | null {
    const t = this.tabla;
    const nulo = (v: unknown) => v === null || v === undefined;
    if (t === "proyecciones") {
      if (fila.estado === "cerrada" && filas.some((f) => f !== previa && f !== fila && f.estado === "cerrada" && f.anio_en_curso === fila.anio_en_curso)) {
        return err("23505", 'duplicate key value violates unique constraint "proyecciones_cerrada_anio_uniq"');
      }
      if (filas.some((f) => f !== previa && f !== fila && f.anio_en_curso === fila.anio_en_curso && String(f.nombre).toUpperCase() === String(fila.nombre).toUpperCase())) {
        return err("23505", 'duplicate key value violates unique constraint "proyecciones_nombre_anio_uniq"');
      }
      if (!["en_trabajo", "cerrada", "archivada"].includes(String(fila.estado))) return err("23514", 'violates check constraint "proyecciones_estado_check"');
    }
    if (t === "proyeccion_fila_anios") {
      if (nulo(fila.decidido) !== nulo(fila.origen)) return err("23514", 'new row for relation "proyeccion_fila_anios" violates check constraint "proyeccion_fila_anios_decision_check"');
      for (const c of ["meses", "meses_propuestos", "origen_meses"]) {
        const v = fila[c];
        if (!nulo(v) && (!Array.isArray(v) || v.length !== 12)) return err("23514", `violates check constraint "proyeccion_fila_anios_${c}_check"`);
      }
      if (Array.isArray(fila.origen_meses) && fila.origen_meses.some((o) => o !== "real" && o !== "proyectado")) return err("23514", 'violates check constraint "proyeccion_fila_anios_origen_meses_check"');
      if ((fila.vendido as number) < 0) return err("23514", 'violates check constraint "proyeccion_fila_anios_vendido_check"');
      if (!nulo(fila.propuesto) && (fila.propuesto as number) < 0) return err("23514", 'violates check constraint "proyeccion_fila_anios_propuesto_check"');
      if (!nulo(fila.decidido) && (fila.decidido as number) < 0) return err("23514", 'violates check constraint "proyeccion_fila_anios_decidido_check"');
      if (!nulo(fila.subbloque) && fila.bloque !== "nuevas") return err("23514", 'violates check constraint "proyeccion_fila_anios_subbloque_bloque_check"');
      for (const c of ["decidido", "propuesto", "vendido", "referencia_alternativa", "referencia_tres_meses", "propuesta_al_decidir"]) {
        const v = fila[c];
        if (!nulo(v) && !Number.isInteger(v)) return err("22P02", `invalid input syntax for type integer: "${String(v)}" (${c})`);
      }
      for (const c of ["meses", "meses_propuestos"]) {
        const v = fila[c];
        if (Array.isArray(v) && v.some((x) => !Number.isInteger(x))) return err("22P02", `invalid input syntax for type integer (${c})`);
      }
    }
    if (t === "proyeccion_tiendas") {
      if (nulo(fila.decidido) !== nulo(fila.origen)) return err("23514", 'violates check constraint "proyeccion_tiendas_decision_check"');
      if (!nulo(fila.origen) && fila.origen !== "propuesta" && fila.origen !== "manual") return err("23514", 'violates check constraint "proyeccion_tiendas_origen_check"');
      if (!Array.isArray(fila.rampa) || fila.rampa.length < 1 || fila.rampa.length > 6) return err("23514", 'violates check constraint "proyeccion_tiendas_rampa_check"');
      for (const c of ["decidido", "propuesto", "vendido", "unidades_maduras", "referencia_alternativa", "referencia_tres_meses", "propuesta_al_decidir"]) {
        const v = fila[c];
        if (!nulo(v) && !Number.isInteger(v)) return err("22P02", `invalid input syntax for type integer: "${String(v)}" (${c})`);
      }
    }
    if (t === "tiendas" && nulo(fila.tienda_referencia_id) === false && fila.tienda_referencia_id === fila.id) {
      return err("23514", 'new row for relation "tiendas" violates check constraint "tiendas_referencia_no_propia_check"');
    }
    if (t === "proyeccion_filas") {
      if ((fila.nivel_proyectado === "GMLE") !== !nulo(fila.equivalencia_id)) return err("23514", 'violates check constraint "proyeccion_filas_nivel_equivalencia_check"');
    }
    if (t === "factores_volumen_atipico") {
      const r = fila.ratio_aplicado;
      if (!nulo(r) && !((r as number) > 0.05 && (r as number) <= 3)) return err("23514", 'violates check constraint "factores_volumen_atipico_ratio_aplicado_check"');
    }
    return null;
  }

  private completa(f: Fila): Fila {
    const base: Fila = {};
    for (const c of COLUMNAS[this.tabla] ?? []) base[c] = null;
    return {
      ...base,
      id: uuid(estado.siguienteId++),
      created_at: ahora(),
      updated_at: ahora(),
      ...(DEFECTOS[this.tabla] ?? {}),
      ...f,
    };
  }

  private cascada(tabla: string, ids: string[]) {
    if (tabla === "proyecciones") {
      const filas = (estado.tablas.proyeccion_filas ?? []).filter((f) => ids.includes(f.proyeccion_id as string));
      this.cascada("proyeccion_filas", filas.map((f) => f.id as string));
      estado.tablas.proyeccion_filas = (estado.tablas.proyeccion_filas ?? []).filter((f) => !ids.includes(f.proyeccion_id as string));
      estado.tablas.proyeccion_tiendas = (estado.tablas.proyeccion_tiendas ?? []).filter((f) => !ids.includes(f.proyeccion_id as string));
    }
    if (tabla === "proyeccion_filas") {
      estado.tablas.proyeccion_fila_anios = (estado.tablas.proyeccion_fila_anios ?? []).filter((a) => !ids.includes(a.fila_id as string));
    }
  }

  private proyectar(f: Fila, seleccion: string): Fila {
    if (seleccion.trim() === "*") return { ...f };
    const salida: Fila = {};
    for (const parte of dividir(seleccion)) {
      const m = /^(\w+)\((.*)\)$/.exec(parte);
      const ruta = /^(\w+):(\w+)->(\w+)$/.exec(parte);
      if (ruta) {
        // `alias:columna->clave` de PostgREST sobre un jsonb.
        const json = f[ruta[2]];
        salida[ruta[1]] = json !== null && typeof json === "object" ? ((json as Fila)[ruta[3]] ?? null) : null;
      } else if (m) {
        const rel = RELACIONES[this.tabla]?.[m[1]];
        if (!rel) throw new Error(`relación no soportada: ${this.tabla} → ${m[1]}`);
        const tablaRel = estado.tablas[m[1]] ?? [];
        if (rel.tipo === "hijos") {
          salida[m[1]] = tablaRel.filter((h) => h[rel.fk] === f.id).map((h) => new Consulta(m[1]).proyectar(h, m[2]));
        } else {
          const padre = tablaRel.find((p) => p.id === f[rel.fk]);
          salida[m[1]] = padre ? new Consulta(m[1]).proyectar(padre, m[2]) : null;
        }
      } else if (parte === "*") {
        Object.assign(salida, f);
      } else if (parte in f) {
        salida[parte] = f[parte];
      }
    }
    return salida;
  }

  private ejecutar(): Resultado {
    if (estado.falloDeEscritura && this.modo !== "select") {
      const e = estado.falloDeEscritura(this.tabla, this.modo, this.carga);
      if (e) return { data: null, error: e };
    }
    const filas = (estado.tablas[this.tabla] ??= []);
    const coincide = (f: Fila) => this.filtros.every((p) => p(f));
    let afectadas: Fila[] = [];

    const guardar = (nueva: Fila): ErrorFalso | null => {
      const e = this.validar(nueva, filas, null);
      if (e) return e;
      filas.push(nueva);
      afectadas.push(nueva);
      return null;
    };

    if (this.modo === "insert") {
      const lista = Array.isArray(this.carga) ? this.carga : [this.carga];
      for (const l of lista) {
        const e = guardar(this.completa(l));
        if (e) return { data: null, error: e };
      }
    } else if (this.modo === "upsert") {
      const clave = this.onConflict ?? ONCONFLICT[this.tabla] ?? ["id"];
      const lista = Array.isArray(this.carga) ? this.carga : [this.carga];
      for (const l of lista) {
        const existente = filas.find((f) => clave.every((c) => f[c] === l[c]));
        if (existente) {
          const antes = { ...existente };
          Object.assign(existente, l, { updated_at: ahora() });
          const e = this.validar(existente, filas, existente);
          if (e) {
            Object.assign(existente, antes);
            return { data: null, error: e };
          }
          afectadas.push(existente);
        } else {
          const e = guardar(this.completa(l));
          if (e) return { data: null, error: e };
        }
      }
    } else if (this.modo === "update") {
      afectadas = filas.filter(coincide);
      for (const f of afectadas) {
        const antes = { ...f };
        Object.assign(f, this.carga, { updated_at: ahora() });
        const e = this.validar(f, filas, f);
        if (e) {
          Object.assign(f, antes);
          return { data: null, error: e };
        }
      }
    } else if (this.modo === "delete") {
      afectadas = filas.filter(coincide);
      // `restrict` de la 0018: una tienda referente de otra o presente en una proyección no se elimina.
      if (this.tabla === "tiendas") {
        for (const f of afectadas) {
          const quien = (estado.tablas.tiendas ?? []).some((t) => t.tienda_referencia_id === f.id && !afectadas.includes(t))
            ? ["tiendas_tienda_referencia_id_fkey", "tiendas"]
            : (estado.tablas.proyeccion_filas ?? []).some((t) => t.tienda_id === f.id)
              ? ["proyeccion_filas_tienda_id_fkey", "proyeccion_filas"]
              : (estado.tablas.proyeccion_tiendas ?? []).some((t) => t.tienda_id === f.id)
                ? ["proyeccion_tiendas_tienda_id_fkey", "proyeccion_tiendas"]
                : null;
          if (quien) return { data: null, error: err("23503", `update or delete on table "tiendas" violates foreign key constraint "${quien[0]}" on table "${quien[1]}"`) };
        }
      }
      estado.tablas[this.tabla] = filas.filter((f) => !coincide(f));
      this.cascada(this.tabla, afectadas.map((f) => f.id as string));
    } else {
      afectadas = filas.filter(coincide);
      for (const [c, asc] of [...this.ordenes].reverse()) {
        afectadas = [...afectadas].sort((a, b) => {
          const x = a[c] as string | number;
          const y = b[c] as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      afectadas = afectadas.slice(this.desde, this.hasta === Infinity ? undefined : this.hasta + 1);
      if (this.tope !== Infinity) afectadas = afectadas.slice(0, this.tope);
    }

    const devuelve = this.modo === "select" || this.pidioSelect;
    const datos = devuelve ? afectadas.map((f) => this.proyectar(f, this.seleccion ?? "*")) : null;
    if (this.una) return { data: datos?.[0] ?? null, error: null };
    return { data: datos, error: null };
  }
}

export function clienteFalso() {
  return {
    from: (t: string) => new Consulta(t),
    rpc: (nombre: string, args: Record<string, unknown>) => {
      if (nombre !== "venta_proyeccion") throw new Error(`rpc inesperado: ${nombre}`);
      estado.llamadasVenta += 1;
      if (estado.errorVenta) return Promise.resolve({ data: null, error: { ...estado.errorVenta, details: null, hint: null } });
      return Promise.resolve({ data: estado.venta(args as never, estado.llamadasVenta), error: null });
    },
  };
}
