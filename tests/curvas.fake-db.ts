import { NextResponse } from "next/server";

/**
 * Base falsa en memoria para probar los handlers de M6 sin red ni datos reales.
 * Implementa solo lo que usan las consultas: `select` (con proyección de columnas
 * y `count` con `head`), filtros (`eq`, `neq`, `in`, `is`, `not … is null`), `order`,
 * `limit`, `range`, `maybeSingle`, `single`, `insert`, `update`, `delete` y los dos
 * `rpc` de M6 (`venta_estacionalidad_agrupacion` y `venta_mensual_tienda`). Hace
 * cumplir el parcial de M6 (una curva vigente por agrupación y su versión única)
 * con el mismo código y mensaje que Postgres, y anota qué columnas se pidieron de
 * cada tabla (para probar que la lista no lee `resultado`).
 */

export type Fila = Record<string, unknown>;

export type EstadoFalso = {
  tablas: Record<string, Fila[]>;
  rol: "planner" | "comprador" | "sin_sesion";
  siguienteId: number;
  /** Respuesta de `venta_estacionalidad_agrupacion(id)` por id (`"null"` sin agrupación), o un error que se devuelve en cualquier llamada. */
  venta: { porId: Record<string, unknown>; error: { code: string; message: string } | null };
  /** Filas de `venta_mensual_tienda()`. */
  ventaTienda: Fila[];
  /** Una anotación por llamada a `venta_estacionalidad_agrupacion` (el id pedido, o null). */
  llamadasVenta: (string | null)[];
  /** Cuántas veces se llamó a `venta_mensual_tienda()`. */
  llamadasVentaTienda: number;
  /** Los `select` pedidos de cada tabla (`*` o las columnas), en orden. */
  columnasLeidas: Record<string, string[]>;
  /** Tablas que se consultaron con `from` (para comprobar que no se lee la vista materializada). */
  tablasLeidas: Set<string>;
  /** Hace fallar el próximo insert en esa tabla (código y mensaje de Postgres). */
  fallarInsert: Record<string, { code: string; message: string } | undefined>;
};

export const estadoFalso: EstadoFalso = {
  tablas: {},
  rol: "planner",
  siguienteId: 1,
  venta: { porId: {}, error: null },
  ventaTienda: [],
  llamadasVenta: [],
  llamadasVentaTienda: 0,
  columnasLeidas: {},
  tablasLeidas: new Set<string>(),
  fallarInsert: {},
};

export const PERFIL_FALSO = { id: "99999999-9999-4999-8999-999999999999", email: "javier@example.com", nombre: "Javier", rol: "planner", activo: true };

export function guardFalso() {
  return {
    requirePlanner: async () => {
      if (estadoFalso.rol === "sin_sesion")
        return { user: null, perfil: null, rol: null, response: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
      if (estadoFalso.rol === "comprador")
        return { user: null, perfil: null, rol: null, response: NextResponse.json({ error: "Tu rol es de solo lectura." }, { status: 403 }) };
      return { user: {}, perfil: PERFIL_FALSO, rol: "planner", response: null };
    },
  };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Resultado = { data: unknown; count?: number | null; error: { code: string; message: string; details: null; hint: null } | null };

class Consulta implements PromiseLike<Resultado> {
  private modo: "select" | "insert" | "update" | "delete" = "select";
  private filtros: Array<(f: Fila) => boolean> = [];
  private ordenes: Array<[string, boolean]> = [];
  private carga: Fila = {};
  private una: "single" | "maybeSingle" | null = null;
  private desde = 0;
  private hasta = Infinity;
  private tope = Infinity;
  private columnas: string[] | null = null;
  private soloConteo = false;
  constructor(
    private readonly tabla: string,
    private readonly origen: Fila[] | null = null
  ) {}
  select(columnas = "*", opciones?: { count?: string; head?: boolean }) {
    (estadoFalso.columnasLeidas[this.tabla] ??= []).push(columnas);
    if (columnas.trim() !== "*") this.columnas = columnas.split(",").map((c) => c.trim());
    this.soloConteo = opciones?.head === true && opciones.count === "exact";
    return this;
  }
  insert(f: Fila) {
    this.modo = "insert";
    this.carga = f;
    return this;
  }
  update(f: Fila) {
    this.modo = "update";
    this.carga = f;
    return this;
  }
  delete() {
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

  private choque(filas: Fila[], nueva: Fila): { code: string; message: string } | null {
    if (this.tabla === "curvas_estacionalidad" && nueva.estado === "vigente") {
      if (filas.some((f) => f !== nueva && f.estado === "vigente" && f.agrupacion_estacionalidad_id === nueva.agrupacion_estacionalidad_id)) {
        return { code: "23505", message: 'duplicate key value violates unique constraint "curvas_estacionalidad_vigente_uniq"' };
      }
    }
    if (this.tabla === "curvas_estacionalidad") {
      if (filas.some((f) => f !== nueva && f.agrupacion_estacionalidad_id === nueva.agrupacion_estacionalidad_id && f.version === nueva.version)) {
        return { code: "23505", message: 'duplicate key value violates unique constraint "curvas_estacionalidad_agrupacion_version_key"' };
      }
    }
    return null;
  }

  private ejecutar(): Resultado {
    estadoFalso.tablasLeidas.add(this.tabla);
    const filas = (estadoFalso.tablas[this.tabla] ??= []);
    const fuente = this.origen ?? filas;
    const coincide = (f: Fila) => this.filtros.every((p) => p(f));
    const error = (e: { code: string; message: string }): Resultado => ({ data: null, error: { ...e, details: null, hint: null } });

    let afectadas: Fila[];
    if (this.modo === "insert") {
      const falla = estadoFalso.fallarInsert[this.tabla];
      if (falla) {
        estadoFalso.fallarInsert[this.tabla] = undefined;
        return error(falla);
      }
      const nueva: Fila = {
        id: uuid(estadoFalso.siguienteId++),
        activo: true,
        created_at: `2026-10-14T10:${String(estadoFalso.siguienteId).padStart(2, "0")}:00Z`,
        updated_at: "2026-10-14T10:00:00Z",
        ...(this.tabla === "corridas_estacionalidad" ? { agrupacion_estacionalidad_id: null } : {}),
        ...(this.tabla === "curvas_estacionalidad" ? { estado: "vigente", aprobada_at: "2026-10-14T10:00:00Z", nota: null } : {}),
        ...this.carga,
      };
      const c = this.choque(filas, nueva);
      if (c) return error(c);
      filas.push(nueva);
      afectadas = [nueva];
    } else if (this.modo === "update") {
      afectadas = filas.filter(coincide);
      for (const f of afectadas) {
        const antes = { ...f };
        Object.assign(f, this.carga);
        const c = this.choque(filas, f);
        if (c) {
          Object.assign(f, antes);
          return error(c);
        }
      }
    } else if (this.modo === "delete") {
      afectadas = filas.filter(coincide);
      estadoFalso.tablas[this.tabla] = filas.filter((f) => !coincide(f));
    } else {
      afectadas = fuente.filter(coincide);
      for (const [c, asc] of [...this.ordenes].reverse()) {
        afectadas = [...afectadas].sort((a, b) => {
          const x = a[c] as string | number;
          const y = b[c] as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.soloConteo) return { data: null, count: afectadas.length, error: null };
      afectadas = afectadas.slice(this.desde, this.hasta === Infinity ? undefined : this.hasta + 1);
      if (this.tope !== Infinity) afectadas = afectadas.slice(0, this.tope);
      const columnas = this.columnas;
      if (columnas) afectadas = afectadas.map((f) => Object.fromEntries(columnas.filter((c) => c in f).map((c) => [c, f[c]])));
    }
    if (this.una) return { data: afectadas[0] ?? null, error: null };
    return { data: afectadas, error: null };
  }
}

export function clienteFalso() {
  return {
    from: (t: string) => new Consulta(t),
    rpc: (nombre: string, args?: { p_agrupacion_id?: string }) => {
      if (nombre === "venta_estacionalidad_agrupacion") {
        const id = args?.p_agrupacion_id ?? null;
        estadoFalso.llamadasVenta.push(id);
        const { porId, error } = estadoFalso.venta;
        if (error) return Promise.resolve({ data: null, error: { ...error, details: null, hint: null } });
        return Promise.resolve({ data: porId[String(id)] ?? null, error: null });
      }
      if (nombre === "venta_mensual_tienda") {
        estadoFalso.llamadasVentaTienda += 1;
        return new Consulta("__venta_mensual_tienda", estadoFalso.ventaTienda);
      }
      throw new Error(`rpc inesperado: ${nombre}`);
    },
  };
}
