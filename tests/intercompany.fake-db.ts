/**
 * Base falsa en memoria para probar los handlers de M13 sin red ni datos reales. Implementa lo que usan las consultas de
 * `src/lib/intercompany/consultas.ts` y las lecturas del árbol y de marcas que comparten: `select`, `eq`, `in`, `order` (con
 * `nullsFirst`), `range`, `limit`, `single`, `maybeSingle`, `insert`, `update` y `delete`. Hace cumplir el ÚNICO de EXPRESIÓN de
 * `intercompany_reglas` (marca, nodo, `coalesce(equivalencia, cero)`, `vigente_desde`) con el mismo código de Postgres (23505) y
 * anota las tablas tocadas (para comprobar que un `401` o `403` no llega a la base) y las escrituras.
 */

export type Fila = Record<string, unknown>;
export type ErrorFalso = { code: string; message: string; details: null; hint: null };

export type EstadoBd = {
  tablas: Record<string, Fila[]>;
  siguienteId: number;
  tablasTocadas: string[];
  /** Una anotación por escritura (`insert`, `update`, `delete`) sobre `intercompany_reglas`. */
  escrituras: { modo: "insert" | "update" | "delete"; carga: unknown }[];
  /** Hace fallar la escritura (el test decide cuál); si devuelve un error, esa operación no toca nada. */
  fallo: ((tabla: string, modo: "insert" | "update" | "delete", carga: unknown) => ErrorFalso | null) | null;
  /** Hace fallar una LECTURA (`select`) de esa tabla (para probar qué pasa si falla la lectura posterior a una escritura). */
  falloLectura: ((tabla: string) => ErrorFalso | null) | null;
};

export const bd: EstadoBd = { tablas: {}, siguienteId: 1, tablasTocadas: [], escrituras: [], fallo: null, falloLectura: null };

let reloj = 0;
const uuid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const ahora = () => new Date(Date.UTC(2026, 9, 18, 12, 0, 0) + reloj++ * 1000).toISOString();
const err = (code: string, message: string): ErrorFalso => ({ code, message, details: null, hint: null });
const CERO = "00000000-0000-0000-0000-000000000000";

export function reiniciarBd(tablas: Record<string, Fila[]>) {
  bd.tablas = Object.fromEntries(Object.entries(tablas).map(([k, v]) => [k, v.map((f) => ({ ...f }))]));
  bd.siguienteId = 1;
  bd.tablasTocadas = [];
  bd.escrituras = [];
  bd.fallo = null;
  bd.falloLectura = null;
  reloj = 0;
}

type Resultado = { data: unknown; error: ErrorFalso | null };

class Consulta implements PromiseLike<Resultado> {
  private modo: "select" | "insert" | "update" | "delete" = "select";
  private filtros: Array<(f: Fila) => boolean> = [];
  private ordenes: Array<[string, boolean, boolean]> = [];
  private carga: Fila = {};
  private una: "single" | "maybeSingle" | null = null;
  private desde = 0;
  private hasta = Infinity;
  private tope = Infinity;
  constructor(private readonly tabla: string) {
    bd.tablasTocadas.push(tabla);
  }
  select() {
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
  in(c: string, v: unknown[]) {
    this.filtros.push((f) => v.includes(f[c]));
    return this;
  }
  order(c: string, o?: { ascending?: boolean; nullsFirst?: boolean }) {
    this.ordenes.push([c, o?.ascending !== false, o?.nullsFirst === true]);
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

  private clave = (f: Fila) => `${f.marca_id}|${f.genero_mundo_linea_id}|${(f.equivalencia_id as string | null) ?? CERO}|${f.vigente_desde}`;

  private choque(filas: Fila[], nueva: Fila): ErrorFalso | null {
    if (this.tabla !== "intercompany_reglas") return null;
    if (filas.some((f) => f !== nueva && this.clave(f) === this.clave(nueva))) {
      return err("23505", 'duplicate key value violates unique constraint "intercompany_reglas_clave_uniq"');
    }
    return null;
  }

  private ejecutar(): Resultado {
    const filas = (bd.tablas[this.tabla] ??= []);
    const coincide = (f: Fila) => this.filtros.every((p) => p(f));
    const escribe = this.tabla === "intercompany_reglas" && this.modo !== "select";
    if (escribe) bd.escrituras.push({ modo: this.modo as "insert" | "update" | "delete", carga: this.carga });
    let afectadas: Fila[];

    if (this.modo === "insert") {
      const falla = bd.fallo?.(this.tabla, "insert", this.carga);
      if (falla) return { data: null, error: falla };
      const nueva: Fila = { id: uuid(bd.siguienteId++), activo: true, created_at: ahora(), updated_at: ahora(), ...this.carga };
      const c = this.choque(filas, nueva);
      if (c) return { data: null, error: c };
      filas.push(nueva);
      afectadas = [nueva];
    } else if (this.modo === "update") {
      afectadas = filas.filter(coincide);
      const falla = bd.fallo?.(this.tabla, "update", this.carga);
      if (falla) return { data: null, error: falla };
      for (const f of afectadas) Object.assign(f, this.carga, { updated_at: ahora() });
    } else if (this.modo === "delete") {
      const falla = bd.fallo?.(this.tabla, "delete", null);
      if (falla) return { data: null, error: falla };
      afectadas = filas.filter(coincide);
      bd.tablas[this.tabla] = filas.filter((f) => !coincide(f));
    } else {
      const falla = bd.falloLectura?.(this.tabla);
      if (falla) return { data: null, error: falla };
      afectadas = filas.filter(coincide);
      for (const [c, asc, nullsFirst] of [...this.ordenes].reverse()) {
        afectadas = [...afectadas].sort((a, b) => {
          const x = a[c] as string | number | null | undefined;
          const y = b[c] as string | number | null | undefined;
          const xn = x === null || x === undefined;
          const yn = y === null || y === undefined;
          if (xn || yn) return xn && yn ? 0 : xn ? (nullsFirst ? -1 : 1) : nullsFirst ? 1 : -1;
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      afectadas = afectadas.slice(this.desde, this.hasta === Infinity ? undefined : this.hasta + 1);
      if (this.tope !== Infinity) afectadas = afectadas.slice(0, this.tope);
    }
    if (this.una) return { data: afectadas[0] ? { ...afectadas[0] } : null, error: null };
    return { data: afectadas.map((f) => ({ ...f })), error: null };
  }
}

export function clienteBd() {
  return { from: (t: string) => new Consulta(t) };
}
