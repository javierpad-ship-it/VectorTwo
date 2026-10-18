/**
 * Base falsa en memoria para probar los handlers de M12 sin red ni datos reales. Implementa lo que usan las consultas de
 * `src/lib/marcas-barrer/consultas.ts`: `select`, `eq`, `in`, `order`, `limit`, `range`, `single`, `maybeSingle`, `insert` (uno o
 * varios), `update`, `delete` (con `cascade` de las filas de una versión) y los dos `rpc` (`venta_marca_gml` y
 * `venta_marca_gml_resumen`), que responde el propio test. Hace cumplir el único `(marca_id, version)` y el único PARCIAL de la
 * versión vigente (una por marca) con los mismos códigos de Postgres.
 */

export type Fila = Record<string, unknown>;
export type ErrorFalso = { code: string; message: string; details: null; hint: null };

export type EstadoBd = {
  tablas: Record<string, Fila[]>;
  siguienteId: number;
  /** Respuesta de las dos funciones SQL. */
  rpc: (nombre: string, args: Record<string, unknown>) => unknown;
  llamadasRpc: { nombre: string; args: Record<string, unknown> }[];
  /** Tablas tocadas con `from` (para comprobar que un `401` o `403` no llega a la base). */
  tablasTocadas: string[];
  /** Hace fallar la operación (el test decide cuál); si devuelve un error, esa operación no toca nada. */
  fallo: ((tabla: string, modo: "insert" | "update" | "delete", carga: unknown) => ErrorFalso | null) | null;
};

export const bd: EstadoBd = { tablas: {}, siguienteId: 1, rpc: () => ({}), llamadasRpc: [], tablasTocadas: [], fallo: null };

export function reiniciarBd() {
  bd.tablas = { repartos_marca_barrido: [], reparto_marca_barrido_gml: [] };
  bd.siguienteId = 1;
  bd.rpc = () => ({});
  bd.llamadasRpc = [];
  bd.tablasTocadas = [];
  bd.fallo = null;
  reloj = 0;
}

let reloj = 0;
const uuid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, "0")}`;
const ahora = () => new Date(Date.UTC(2026, 9, 17, 12, 0, 0) + reloj++ * 1000).toISOString();
const err = (code: string, message: string): ErrorFalso => ({ code, message, details: null, hint: null });

type Resultado = { data: unknown; error: ErrorFalso | null };

class Consulta implements PromiseLike<Resultado> {
  private modo: "select" | "insert" | "update" | "delete" = "select";
  private filtros: Array<(f: Fila) => boolean> = [];
  private ordenes: Array<[string, boolean]> = [];
  private carga: Fila | Fila[] = {};
  private una: "single" | "maybeSingle" | null = null;
  private desde = 0;
  private hasta = Infinity;
  private tope = Infinity;
  private pidioFilas = false;
  constructor(private readonly tabla: string) {
    bd.tablasTocadas.push(tabla);
  }
  select() {
    this.pidioFilas = true;
    return this;
  }
  insert(f: Fila | Fila[]) {
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

  private choque(filas: Fila[], nueva: Fila): ErrorFalso | null {
    if (this.tabla !== "repartos_marca_barrido") return null;
    if (filas.some((f) => f !== nueva && f.marca_id === nueva.marca_id && f.version === nueva.version)) {
      return err("23505", 'duplicate key value violates unique constraint "repartos_marca_barrido_marca_version_key"');
    }
    if (nueva.vigente === true && filas.some((f) => f !== nueva && f.marca_id === nueva.marca_id && f.vigente === true)) {
      return err("23505", 'duplicate key value violates unique constraint "repartos_marca_barrido_vigente_uniq"');
    }
    return null;
  }

  private ejecutar(): Resultado {
    const filas = (bd.tablas[this.tabla] ??= []);
    const coincide = (f: Fila) => this.filtros.every((p) => p(f));
    let afectadas: Fila[];
    if (this.modo === "insert") {
      const falla = bd.fallo?.(this.tabla, "insert", this.carga);
      if (falla) return { data: null, error: falla };
      const nuevas = (Array.isArray(this.carga) ? this.carga : [this.carga]).map(
        (c): Fila => ({
          id: uuid(bd.siguienteId++),
          activo: true,
          created_at: ahora(),
          updated_at: ahora(),
          ...(this.tabla === "repartos_marca_barrido" ? { vigente: true, aprobada_at: ahora(), fuente: "historico", alcance: {}, normaliza_nino: true, factores_usados: [], temporadas_usadas: { verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } } } : {}),
          ...(this.tabla === "reparto_marca_barrido_gml" ? { equivalencia_id: null, temporada: null, mes: null, grupo_resto: null, unidades_ventana: 0, participacion_ajustada: null } : {}),
          ...c,
        })
      );
      for (const n of nuevas) {
        const c = this.choque([...filas], n);
        if (c) return { data: null, error: c };
      }
      filas.push(...nuevas);
      afectadas = nuevas;
    } else if (this.modo === "update") {
      afectadas = filas.filter(coincide);
      const falla = bd.fallo?.(this.tabla, "update", this.carga);
      if (falla) return { data: null, error: falla };
      for (const f of afectadas) {
        const antes = { ...f };
        Object.assign(f, this.carga, { updated_at: ahora() });
        const c = this.choque(filas, f);
        if (c) {
          Object.assign(f, antes);
          return { data: null, error: c };
        }
      }
    } else if (this.modo === "delete") {
      const falla = bd.fallo?.(this.tabla, "delete", null);
      if (falla) return { data: null, error: falla };
      afectadas = filas.filter(coincide);
      bd.tablas[this.tabla] = filas.filter((f) => !coincide(f));
      if (this.tabla === "repartos_marca_barrido") {
        const ids = new Set(afectadas.map((f) => f.id));
        bd.tablas.reparto_marca_barrido_gml = (bd.tablas.reparto_marca_barrido_gml ?? []).filter((f) => !ids.has(f.reparto_id));
      }
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
    void this.pidioFilas;
    if (this.una) return { data: afectadas[0] ?? null, error: null };
    return { data: afectadas.map((f) => ({ ...f })), error: null };
  }
}

export function clienteBd() {
  return {
    from: (t: string) => new Consulta(t),
    rpc: (nombre: string, args: Record<string, unknown> = {}) => {
      bd.llamadasRpc.push({ nombre, args });
      bd.tablasTocadas.push(`rpc:${nombre}`);
      return Promise.resolve({ data: bd.rpc(nombre, args), error: null });
    },
  };
}
