import { NextResponse } from "next/server";

/**
 * Base falsa en memoria para probar las rutas de 06d sin red ni datos reales (sintético). Implementa solo lo que usan las consultas:
 * `select` (con proyección de columnas y la relación anidada `proyeccion_fila_anios(...)`), filtros (`eq`, `neq`, `in`, `is`, `gt`,
 * `not … is null`), `order` (con `ascending`), `limit`, `range`, `maybeSingle`, `single`, `insert`, `update`, `delete` y el `rpc`
 * `venta_genero_mundo` (con la agrupación `a` de la 0029). Hace cumplir los dos únicos de `crecimientos_genero_mundo` (una vigente por GM y año; la versión única) con
 * el código y el mensaje de Postgres, y anota cada escritura (`escrituras`) para probar que aprobar no toca ninguna proyección.
 */

export type Fila = Record<string, unknown>;
type ErrorPg = { code: string; message: string };

export type EstadoFalso = {
  tablas: Record<string, Fila[]>;
  rol: "planner" | "comprador" | "sin_sesion";
  siguienteId: number;
  /** Respuesta de `venta_genero_mundo` o un error que se devuelve en cualquier llamada. */
  ventaGM: { respuesta: unknown; error: ErrorPg | null };
  /** Los `p_desde` de cada llamada a `venta_genero_mundo`. */
  llamadasVentaGM: string[];
  /** Una anotación por escritura (`insert`, `update`, `delete`). */
  escrituras: { tabla: string; modo: "insert" | "update" | "delete" }[];
  /** Hace fallar el próximo insert de esa tabla. */
  fallarInsert: Record<string, ErrorPg | undefined>;
  /** Se llama justo antes de cada escritura (simula a otra persona escribiendo en medio). */
  alEscribir: ((tabla: string, modo: "insert" | "update" | "delete") => void) | null;
};

export const estadoFalso: EstadoFalso = {
  tablas: {},
  rol: "planner",
  siguienteId: 1,
  ventaGM: { respuesta: null, error: null },
  llamadasVentaGM: [],
  escrituras: [],
  fallarInsert: {},
  alEscribir: null,
};

export const PERFIL_FALSO = { id: "99999999-9999-4999-8999-999999999999", email: "javier@example.com", nombre: "Javier", rol: "planner", activo: true };

export function guardFalso() {
  return {
    requirePlanner: async () => {
      if (estadoFalso.rol === "sin_sesion") return { user: null, perfil: null, rol: null, response: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
      if (estadoFalso.rol === "comprador") return { user: null, perfil: null, rol: null, response: NextResponse.json({ error: "Tu rol es de solo lectura." }, { status: 403 }) };
      return { user: {}, perfil: PERFIL_FALSO, rol: "planner", response: null };
    },
  };
}

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

type Resultado = { data: unknown; error: { code: string; message: string; details: null; hint: null } | null };

/** Parte `a, b, rel(c, d)` en columnas propias y relaciones anidadas. */
function partirSeleccion(seleccion: string): { propias: string[] | null; anidadas: { tabla: string; columnas: string[] | null }[] } {
  const anidadas: { tabla: string; columnas: string[] | null }[] = [];
  const resto = seleccion.replace(/(\w+)\(([^)]*)\)/g, (_, tabla: string, cols: string) => {
    anidadas.push({ tabla, columnas: cols.trim() === "*" ? null : cols.split(",").map((c) => c.trim()) });
    return "";
  });
  const propias = resto
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
  return { propias: propias.length === 0 || propias.includes("*") ? null : propias, anidadas };
}

const proyectar = (f: Fila, columnas: string[] | null): Fila => (columnas ? Object.fromEntries(columnas.filter((c) => c in f).map((c) => [c, f[c]])) : { ...f });

class Consulta implements PromiseLike<Resultado> {
  private modo: "select" | "insert" | "update" | "delete" = "select";
  private filtros: Array<(f: Fila) => boolean> = [];
  private ordenes: Array<[string, boolean]> = [];
  private carga: Fila = {};
  private una: "single" | "maybeSingle" | null = null;
  private desde = 0;
  private hasta = Infinity;
  private tope = Infinity;
  private seleccion = "*";
  constructor(private readonly tabla: string) {}
  select(columnas = "*") {
    this.seleccion = columnas;
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
  gt(c: string, v: unknown) {
    this.filtros.push((f) => (f[c] as string) > (v as string));
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

  /** Los únicos de `crecimientos_genero_mundo` (0027): una vigente por clave y año, y la versión única por clave. */
  private choque(filas: Fila[], nueva: Fila): ErrorPg | null {
    if (this.tabla !== "crecimientos_genero_mundo") return null;
    const clave = (f: Fila) => [f.anio_aplicacion, f.alcance, f.genero_id ?? "-", f.mundo_id ?? "-"].join("|");
    const otras = filas.filter((f) => f !== nueva && clave(f) === clave(nueva));
    if (nueva.estado === "vigente" && otras.some((f) => f.estado === "vigente")) {
      return { code: "23505", message: 'duplicate key value violates unique constraint "crecimientos_genero_mundo_vigente_uniq"' };
    }
    if (otras.some((f) => f.version === nueva.version)) {
      return { code: "23505", message: 'duplicate key value violates unique constraint "crecimientos_genero_mundo_version_uniq"' };
    }
    return null;
  }

  private ejecutar(): Resultado {
    const filas = (estadoFalso.tablas[this.tabla] ??= []);
    const coincide = (f: Fila) => this.filtros.every((p) => p(f));
    const error = (e: ErrorPg): Resultado => ({ data: null, error: { ...e, details: null, hint: null } });

    let afectadas: Fila[];
    if (this.modo !== "select") {
      estadoFalso.alEscribir?.(this.tabla, this.modo);
      estadoFalso.escrituras.push({ tabla: this.tabla, modo: this.modo });
    }
    if (this.modo === "insert") {
      const falla = estadoFalso.fallarInsert[this.tabla];
      if (falla) {
        estadoFalso.fallarInsert[this.tabla] = undefined;
        return error(falla);
      }
      const n = estadoFalso.siguienteId++;
      const nueva: Fila = {
        id: uuid(n),
        activo: true,
        created_at: `2026-10-27T10:${String(n % 60).padStart(2, "0")}:00Z`,
        updated_at: "2026-10-27T10:00:00Z",
        // `sobre_base` lleva el default de la 0029 (`'bruta'` para siempre): una inserción que no lo trae queda `bruta`.
        ...(this.tabla === "crecimientos_genero_mundo" ? { estado: "vigente", aprobada_at: "2026-10-27T11:00:00Z", nota: null, base_valor: null, genero_id: null, mundo_id: null, proyeccion_referencia_id: null, sobre_base: "bruta" } : {}),
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
      afectadas = filas.filter(coincide);
      for (const [c, asc] of [...this.ordenes].reverse()) {
        afectadas = [...afectadas].sort((a, b) => {
          const x = (a[c] ?? "") as string | number;
          const y = (b[c] ?? "") as string | number;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      afectadas = afectadas.slice(this.desde, this.hasta === Infinity ? undefined : this.hasta + 1);
      if (this.tope !== Infinity) afectadas = afectadas.slice(0, this.tope);
      const { propias, anidadas } = partirSeleccion(this.seleccion);
      afectadas = afectadas.map((f) => {
        const salida = proyectar(f, propias);
        for (const rel of anidadas) {
          const hijos = (estadoFalso.tablas[rel.tabla] ?? []).filter((h) => h.fila_id === f.id);
          salida[rel.tabla] = hijos.map((h) => proyectar(h, rel.columnas));
        }
        return salida;
      });
    }
    if (this.una) return { data: afectadas[0] ?? null, error: null };
    return { data: afectadas, error: null };
  }
}

export function clienteFalso() {
  return {
    from: (t: string) => new Consulta(t),
    rpc: (nombre: string, args?: { p_desde?: string }) => {
      if (nombre === "venta_genero_mundo") {
        estadoFalso.llamadasVentaGM.push(String(args?.p_desde));
        const { respuesta, error } = estadoFalso.ventaGM;
        if (error) return Promise.resolve({ data: null, error: { ...error, details: null, hint: null } });
        return Promise.resolve({ data: respuesta, error: null });
      }
      throw new Error(`rpc inesperado: ${nombre}`);
    },
  };
}
