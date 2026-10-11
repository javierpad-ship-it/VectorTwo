import {
  CAMPOS_VENTA,
  LIMITES_PREVISUALIZAR,
  MEDIDAS_C_CERO,
  type Combinacion,
  type FilaInterpretada,
  type MedidasC,
  type MotivoExclusion,
} from "./tipos";

/**
 * Acumulador columnar con diccionarios (docs/modulos/05-venta-stock.md,
 * "Lectura del archivo en el navegador", paso 5, y reglas 17–19).
 *
 * Cada valor distinto de tienda, combinación (género, mundo, línea,
 * equivalencia) y marca se guarda UNA vez; la fila se reduce a índices
 * enteros más sus cinco medidas en arreglos tipados (≈ 60 B por fila, no un
 * objeto por fila). La clave de la fila (periodo, tienda, combinación,
 * marca, talla) se empaqueta en un entero seguro de 47 bits y vive en una
 * tabla hash abierta sobre `Float64Array`: las filas repetidas se detectan y
 * se SUMAN. Las sumas son de céntimos y unidades enteros, así que no
 * dependen del orden ni derivan por coma flotante.
 *
 * Las filas que se excluyen por reglas de la propia fila (total, mes
 * inválido, número inválido…) no entran al almacén columnar: se cuentan por
 * (motivo, mes, valor) con su primera fila. Las filas con talla desconocida
 * se cuentan aparte porque deben ceder ante un error de tienda (precedencia).
 */

// Radios del empaquetado (el periodo es el factor más externo: hasta 128). 128 · 512 · 32 768 · 8 192 · 8 = 2^47 < 2^53.
const R_TIENDA = 512;
const R_COMBO = 32_768;
const R_MARCA = 8_192;
const R_TALLA = 8;

const LIMITE_GRUPOS_EXCLUSION = 5_000;
const VALOR_OTROS = "(otros valores)";
/** `periodo` de las exclusiones que no pertenecen a ningún mes. */
export const SIN_MES = -1;

export function empaquetarClave(periodo: number, tienda: number, combo: number, marca: number, talla: number): number {
  return (((periodo * R_TIENDA + tienda) * R_COMBO + combo) * R_MARCA + marca) * R_TALLA + talla;
}

/** Tabla hash abierta de claves numéricas (≥ 0) a enteros. Sin un objeto por clave. */
export class TablaClaves {
  private llaves: Float64Array;
  private valores: Int32Array;
  private mascara: number;
  private usados = 0;

  constructor(capacidad = 1024) {
    let c = 16;
    while (c < capacidad) c *= 2;
    this.llaves = new Float64Array(c).fill(-1);
    this.valores = new Int32Array(c);
    this.mascara = c - 1;
  }

  get tamano(): number {
    return this.usados;
  }

  get bytes(): number {
    return this.llaves.byteLength + this.valores.byteLength;
  }

  private static hash(k: number): number {
    const bajo = (k % 4_294_967_296) | 0;
    const alto = Math.floor(k / 4_294_967_296) | 0;
    let h = Math.imul(bajo ^ Math.imul(alto, 0x9e3779b1), 0x85ebca6b);
    h ^= h >>> 15;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 13;
    return h;
  }

  /** Valor de la clave, o -1 si no está. */
  buscar(clave: number): number {
    let i = TablaClaves.hash(clave) & this.mascara;
    for (;;) {
      const k = this.llaves[i];
      if (k === -1) return -1;
      if (k === clave) return this.valores[i];
      i = (i + 1) & this.mascara;
    }
  }

  /** Si la clave existe devuelve su valor; si no, la inserta con `nuevo` y devuelve -1. */
  encontrarOInsertar(clave: number, nuevo: number): number {
    if ((this.usados + 1) * 2 > this.llaves.length) this.crecer();
    let i = TablaClaves.hash(clave) & this.mascara;
    for (;;) {
      const k = this.llaves[i];
      if (k === -1) {
        this.llaves[i] = clave;
        this.valores[i] = nuevo;
        this.usados += 1;
        return -1;
      }
      if (k === clave) return this.valores[i];
      i = (i + 1) & this.mascara;
    }
  }

  private crecer(): void {
    const llavesViejas = this.llaves;
    const valoresViejos = this.valores;
    const capacidad = llavesViejas.length * 2;
    this.llaves = new Float64Array(capacidad).fill(-1);
    this.valores = new Int32Array(capacidad);
    this.mascara = capacidad - 1;
    for (let j = 0; j < llavesViejas.length; j++) {
      const k = llavesViejas[j];
      if (k === -1) continue;
      let i = TablaClaves.hash(k) & this.mascara;
      while (this.llaves[i] !== -1) i = (i + 1) & this.mascara;
      this.llaves[i] = k;
      this.valores[i] = valoresViejos[j];
    }
  }
}

/** Diccionario con tope: cada valor distinto se guarda una sola vez. */
class Diccionario<T> {
  readonly valores: T[] = [];
  private readonly indice = new Map<string, number>();
  constructor(private readonly tope: number) {}

  /** Índice del valor (lo crea si hace falta), o -1 si ya no caben más. */
  internar(clave: string, crear: () => T): number {
    const previo = this.indice.get(clave);
    if (previo !== undefined) return previo;
    if (this.valores.length >= this.tope) return -1;
    const n = this.valores.length;
    this.valores.push(crear());
    this.indice.set(clave, n);
    return n;
  }
}

/** Suma de medidas con su cuenta de filas. */
export type Tally = MedidasC & { filas: number };

export const tallyVacio = (): Tally => ({ ...MEDIDAS_C_CERO, filas: 0 });

export function sumarEn(destino: Tally, m: MedidasC, filas = 1): void {
  destino.filas += filas;
  destino.unidades += m.unidades;
  destino.venta += m.venta;
  destino.costo += m.costo;
  destino.stock_unidades += m.stock_unidades;
  destino.stock_valorizado += m.stock_valorizado;
}

export type ExclusionAcum = Tally & {
  motivo: MotivoExclusion;
  /** Índice de periodo, o `SIN_MES`. */
  periodo: number;
  valor: string;
  primera_fila: number;
};

export type TallaDesconocidaAcum = Tally & {
  periodo: number;
  tienda: number;
  talla: string;
  primera_fila: number;
};

export type StatsPeriodo = {
  /** Todo lo que trae el archivo para el mes (todas las filas con mes válido). */
  archivo: Tally;
  filas_decimales_unidades: number;
  filas_con_centavos: number;
  filas_dia_distinto_de_1: number;
};

/** Almacén columnar de entradas (una por clave empaquetada, ya sumadas). */
export class Entradas {
  n = 0;
  periodo: Uint8Array;
  tienda: Uint16Array;
  combo: Uint16Array;
  marca: Uint16Array;
  talla: Uint8Array;
  filas: Int32Array;
  primera: Int32Array;
  unidades: Float64Array;
  venta: Float64Array;
  costo: Float64Array;
  stockUnidades: Float64Array;
  stockValorizado: Float64Array;

  constructor(capacidad = 1024) {
    this.periodo = new Uint8Array(capacidad);
    this.tienda = new Uint16Array(capacidad);
    this.combo = new Uint16Array(capacidad);
    this.marca = new Uint16Array(capacidad);
    this.talla = new Uint8Array(capacidad);
    this.filas = new Int32Array(capacidad);
    this.primera = new Int32Array(capacidad);
    this.unidades = new Float64Array(capacidad);
    this.venta = new Float64Array(capacidad);
    this.costo = new Float64Array(capacidad);
    this.stockUnidades = new Float64Array(capacidad);
    this.stockValorizado = new Float64Array(capacidad);
  }

  get bytes(): number {
    return (
      this.periodo.byteLength +
      this.tienda.byteLength +
      this.combo.byteLength +
      this.marca.byteLength +
      this.talla.byteLength +
      this.filas.byteLength +
      this.primera.byteLength +
      this.unidades.byteLength * 5
    );
  }

  private crecer(): void {
    const c = this.periodo.length * 2;
    const copiar = <A extends { set(a: ArrayLike<number>): void }>(v: A, nuevo: A): A => {
      nuevo.set(v as unknown as ArrayLike<number>);
      return nuevo;
    };
    this.periodo = copiar(this.periodo, new Uint8Array(c));
    this.tienda = copiar(this.tienda, new Uint16Array(c));
    this.combo = copiar(this.combo, new Uint16Array(c));
    this.marca = copiar(this.marca, new Uint16Array(c));
    this.talla = copiar(this.talla, new Uint8Array(c));
    this.filas = copiar(this.filas, new Int32Array(c));
    this.primera = copiar(this.primera, new Int32Array(c));
    this.unidades = copiar(this.unidades, new Float64Array(c));
    this.venta = copiar(this.venta, new Float64Array(c));
    this.costo = copiar(this.costo, new Float64Array(c));
    this.stockUnidades = copiar(this.stockUnidades, new Float64Array(c));
    this.stockValorizado = copiar(this.stockValorizado, new Float64Array(c));
  }

  /** Agrega una entrada nueva y devuelve su posición. */
  nueva(p: number, t: number, c: number, m: number, talla: number, fila: number, med: MedidasC): number {
    if (this.n === this.periodo.length) this.crecer();
    const i = this.n++;
    this.periodo[i] = p;
    this.tienda[i] = t;
    this.combo[i] = c;
    this.marca[i] = m;
    this.talla[i] = talla;
    this.filas[i] = 1;
    this.primera[i] = fila;
    this.unidades[i] = med.unidades;
    this.venta[i] = med.venta;
    this.costo[i] = med.costo;
    this.stockUnidades[i] = med.stock_unidades;
    this.stockValorizado[i] = med.stock_valorizado;
    return i;
  }

  sumar(i: number, med: MedidasC): void {
    this.filas[i] += 1;
    this.unidades[i] += med.unidades;
    this.venta[i] += med.venta;
    this.costo[i] += med.costo;
    this.stockUnidades[i] += med.stock_unidades;
    this.stockValorizado[i] += med.stock_valorizado;
  }
}

export type Diccionarios = {
  periodos: string[];
  tiendas: string[];
  combinaciones: Combinacion[];
  marcas: string[];
};

export class Acumulador {
  /** Filas de datos vistas (todas). */
  filas = 0;
  /** Celdas numéricas y de forma de coma decimal (diagnóstico global). */
  celdasNumericas = 0;
  celdasComa = 0;
  /** Cuántas filas tenían en blanco cada campo exigible (índice = `CAMPOS_VENTA`). */
  readonly vaciosPorCampo: number[] = CAMPOS_VENTA.map(() => 0);
  /** Filas que no pertenecen a ningún mes. */
  readonly sinMes: Tally = tallyVacio();
  /** Agrupadas: `periodo`, `tienda` y `marca` son índices de los diccionarios. */
  readonly stats: StatsPeriodo[] = [];
  readonly exclusiones = new Map<string, ExclusionAcum>();
  readonly tallasDesconocidas = new Map<string, TallaDesconocidaAcum>();
  readonly entradas = new Entradas();
  /** Se activa si algún diccionario llegó a su tope. */
  readonly desbordes = { periodos: false, tiendas: false, combinaciones: false, marcas: false };

  private readonly dPeriodos = new Diccionario<string>(LIMITES_PREVISUALIZAR.periodos);
  private readonly dTiendas = new Diccionario<string>(LIMITES_PREVISUALIZAR.tiendas);
  private readonly dCombos = new Diccionario<Combinacion>(LIMITES_PREVISUALIZAR.combinaciones);
  private readonly dMarcas = new Diccionario<string>(LIMITES_PREVISUALIZAR.marcas);
  private readonly tabla = new TablaClaves(4096);
  private readonly gruposPorMotivo = new Map<MotivoExclusion, number>();

  get diccionarios(): Diccionarios {
    return {
      periodos: this.dPeriodos.valores,
      tiendas: this.dTiendas.valores,
      combinaciones: this.dCombos.valores,
      marcas: this.dMarcas.valores,
    };
  }

  /** Bytes de los arreglos tipados (no del proceso): prueba de que no hay un objeto por fila. */
  get bytesArreglos(): number {
    return this.entradas.bytes + this.tabla.bytes;
  }

  /** Claves distintas (filas únicas) acumuladas. */
  get entradasUnicas(): number {
    return this.entradas.n;
  }

  private periodoIdx(periodo: string): number {
    const i = this.dPeriodos.internar(periodo, () => periodo);
    if (i === -1) {
      this.desbordes.periodos = true;
      return -1;
    }
    if (this.stats[i] === undefined) {
      this.stats[i] = {
        archivo: tallyVacio(),
        filas_decimales_unidades: 0,
        filas_con_centavos: 0,
        filas_dia_distinto_de_1: 0,
      };
    }
    return i;
  }

  private agregarExclusion(
    motivo: MotivoExclusion,
    periodo: number,
    valor: string,
    medidas: MedidasC,
    fila: number,
    filas = 1,
    primeraFila = fila
  ): void {
    let clave = `${motivo}\u0000${periodo}\u0000${valor}`;
    let grupo = this.exclusiones.get(clave);
    if (!grupo) {
      const n = this.gruposPorMotivo.get(motivo) ?? 0;
      if (n >= LIMITE_GRUPOS_EXCLUSION) {
        valor = VALOR_OTROS;
        clave = `${motivo}\u0000${periodo}\u0000${valor}`;
        grupo = this.exclusiones.get(clave);
      }
      if (!grupo) {
        grupo = { ...tallyVacio(), motivo, periodo, valor, primera_fila: primeraFila };
        this.exclusiones.set(clave, grupo);
        this.gruposPorMotivo.set(motivo, n + 1);
      }
    }
    sumarEn(grupo, medidas, filas);
    if (primeraFila < grupo.primera_fila) grupo.primera_fila = primeraFila;
  }

  /**
   * Agrega una fila interpretada. `nroFila` es la posición de la fila en el
   * archivo (1 = primera fila de datos): sirve para decirle al usuario dónde
   * mirar.
   */
  agregar(f: FilaInterpretada, nroFila: number): void {
    this.filas += 1;
    this.celdasNumericas += f.celdas_numericas;
    this.celdasComa += f.celdas_coma;
    if (f.vacios !== 0) {
      for (let i = 0; i < CAMPOS_VENTA.length; i++) {
        if ((f.vacios & 2 ** i) !== 0) this.vaciosPorCampo[i] += 1;
      }
    }

    if (f.tipo === "excluida") {
      const p = f.periodo === null ? SIN_MES : this.periodoIdx(f.periodo);
      let motivo: MotivoExclusion = f.motivo;
      let valor = f.valor;
      if (f.periodo !== null && p === SIN_MES) {
        // Más meses distintos de los que admite la previsualización.
        motivo = "demasiados_valores";
        valor = "Más de 120 meses distintos";
      }
      if (p === SIN_MES) sumarEn(this.sinMes, f.medidas);
      else sumarEn(this.stats[p].archivo, f.medidas);
      this.agregarExclusion(motivo, p, valor, f.medidas, nroFila);
      return;
    }

    const p = this.periodoIdx(f.periodo);
    if (p === -1) {
      sumarEn(this.sinMes, f.medidas);
      this.agregarExclusion("demasiados_valores", SIN_MES, "Más de 120 meses distintos", f.medidas, nroFila);
      return;
    }
    const st = this.stats[p];
    sumarEn(st.archivo, f.medidas);
    if (f.extras.decimales_unidades) st.filas_decimales_unidades += 1;
    if (f.extras.centavos) st.filas_con_centavos += 1;
    if (f.extras.dia_distinto_de_1) st.filas_dia_distinto_de_1 += 1;

    const t = this.dTiendas.internar(f.tienda, () => f.tienda);
    if (t === -1) {
      this.desbordes.tiendas = true;
      this.agregarExclusion("demasiados_valores", p, "Más de 500 tiendas distintas", f.medidas, nroFila);
      return;
    }

    if (f.tipo === "talla_desconocida") {
      let clave = `${p}\u0000${t}\u0000${f.talla}`;
      let grupo = this.tallasDesconocidas.get(clave);
      if (!grupo && this.tallasDesconocidas.size >= LIMITE_GRUPOS_EXCLUSION) {
        clave = `${p}\u0000${t}\u0000${VALOR_OTROS}`;
        grupo = this.tallasDesconocidas.get(clave);
      }
      if (!grupo) {
        grupo = {
          ...tallyVacio(),
          periodo: p,
          tienda: t,
          talla: clave.endsWith(VALOR_OTROS) ? VALOR_OTROS : f.talla,
          primera_fila: nroFila,
        };
        this.tallasDesconocidas.set(clave, grupo);
      }
      sumarEn(grupo, f.medidas);
      if (nroFila < grupo.primera_fila) grupo.primera_fila = nroFila;
      return;
    }

    const c = this.dCombos.internar(
      `${f.combinacion.genero}\u0001${f.combinacion.mundo}\u0001${f.combinacion.linea}\u0001${f.combinacion.equivalencia}`,
      () => f.combinacion
    );
    if (c === -1) {
      this.desbordes.combinaciones = true;
      this.agregarExclusion("demasiados_valores", p, "Más de 20 000 combinaciones distintas", f.medidas, nroFila);
      return;
    }
    const m = this.dMarcas.internar(f.marca, () => f.marca);
    if (m === -1) {
      this.desbordes.marcas = true;
      this.agregarExclusion("demasiados_valores", p, "Más de 5 000 marcas distintas", f.medidas, nroFila);
      return;
    }

    const clave = empaquetarClave(p, t, c, m, f.talla);
    const existente = this.tabla.encontrarOInsertar(clave, this.entradas.n);
    if (existente === -1) this.entradas.nueva(p, t, c, m, f.talla, nroFila, f.medidas);
    else this.entradas.sumar(existente, f.medidas);
  }
}

export function crearAcumulador(): Acumulador {
  return new Acumulador();
}
