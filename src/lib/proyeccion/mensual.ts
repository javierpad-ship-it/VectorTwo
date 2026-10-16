import { compararAgrupacionMarca, filasVisibles, type AnioPlano, type FilaPlana } from "./matriz";
import type {
  AvisoFila,
  Bloque,
  FilaCerradaApi,
  FilaMensualApi,
  FiltroMatrizApi,
  OrigenMes,
  Participaciones,
  RespuestaMensualApi,
} from "./tipos-api";

/**
 * Vista mensual (Parte 3) y contrato de M8 (ficha 07, paso 6 y reglas 30 y 31). Puro. Solo suma los repartos ya
 * guardados (`meses`): nunca vuelve a repartir ni usa `meses_propuestos`.
 */

const totalDe = (a: AnioPlano) => a.vigente ?? a.decidido ?? a.propuesto ?? 0;

type Acumulado = {
  total: number;
  meses: number[];
  tieneMeses: boolean;
  /** Por mes: ¿todos los sumandos con reparto son reales? */
  todosReales: boolean[];
  sin_curva: number;
  registros: number;
};

const nuevoAcum = (): Acumulado => ({ total: 0, meses: Array<number>(12).fill(0), tieneMeses: false, todosReales: Array<boolean>(12).fill(true), sin_curva: 0, registros: 0 });

function acumular(acum: Acumulado, a: AnioPlano) {
  acum.registros += 1;
  acum.total += totalDe(a);
  if (a.meses === null) {
    // Una fila sin curva aporta su total y nada a los meses: cuenta como `sin_curva`.
    acum.sin_curva += 1;
    return;
  }
  acum.tieneMeses = true;
  for (let i = 0; i < 12; i++) {
    acum.meses[i] += a.meses[i] ?? 0;
    if ((a.origen_meses?.[i] ?? "proyectado") !== "real") acum.todosReales[i] = false;
  }
}

function aAnio(anio: number, acum: Acumulado): FilaMensualApi["anios"][number] {
  return {
    anio,
    total: acum.total,
    meses: acum.tieneMeses ? acum.meses : Array<null>(12).fill(null),
    origen_meses: acum.todosReales.map((r): OrigenMes => (acum.tieneMeses && r ? "real" : "proyectado")),
    sin_curva: acum.sin_curva,
  };
}

/**
 * Regla 30. Una fila por género · mundo · línea (o por agrupación de marca si `porAgrupacion`) y bloque. `bloque =
 * todas` suma los tres bloques; `origen_meses` de una suma es `real` solo si todos los sumandos de ese mes son
 * `real`; una fila sin curva aporta su total y `null` a los meses. Regla 31: mismos filtros que la matriz.
 */
export function armarMensual(
  filas: readonly FilaPlana[],
  opciones: {
    anio: number;
    filtro?: Partial<FiltroMatrizApi>;
    bloque?: Bloque | "todas";
    porAgrupacion?: boolean;
    umbralColaLarga?: number;
  }
): Omit<RespuestaMensualApi, "bloques" | "filtro"> {
  const bloque = opciones.bloque ?? "todas";
  const porAgrupacion = opciones.porAgrupacion ?? false;
  const visibles = filasVisibles(filas, { anio: opciones.anio, filtro: opciones.filtro, umbralColaLarga: opciones.umbralColaLarga });
  const anios = [opciones.anio, opciones.anio + 1];

  const grupos = new Map<string, { fila: FilaPlana; acum: Map<number, Acumulado> }>();
  for (const f of visibles) {
    const clave = porAgrupacion ? `${f.gml_id}|${f.agrupacion_marca_id}` : f.gml_id;
    const g = grupos.get(clave) ?? { fila: f, acum: new Map<number, Acumulado>() };
    for (const a of f.anios) {
      if (!anios.includes(a.anio)) continue;
      if (bloque !== "todas" && a.bloque !== bloque) continue;
      const acum = g.acum.get(a.anio) ?? nuevoAcum();
      acumular(acum, a);
      g.acum.set(a.anio, acum);
    }
    grupos.set(clave, g);
  }

  const comparar = (a: string, b: string) => a.localeCompare(b, "es");
  const resultado: FilaMensualApi[] = [];
  const totales = new Map<number, Acumulado>();
  for (const { fila, acum } of [...grupos.values()].sort(
    (x, y) =>
      comparar(x.fila.genero, y.fila.genero) ||
      comparar(x.fila.mundo, y.fila.mundo) ||
      comparar(x.fila.linea, y.fila.linea) ||
      (porAgrupacion ? compararAgrupacionMarca(x.fila, y.fila) : 0)
  )) {
    if (acum.size === 0) continue;
    resultado.push({
      ids: { genero_id: fila.genero_id, mundo_id: fila.mundo_id, linea_id: fila.linea_id, ...(porAgrupacion ? { agrupacion_marca_id: fila.agrupacion_marca_id } : {}) },
      genero: fila.genero,
      mundo: fila.mundo,
      linea: fila.linea,
      agrupacion_marca: porAgrupacion ? fila.agrupacion_marca : null,
      bloque,
      anios: [...acum].sort((a, b) => a[0] - b[0]).map(([anio, a]) => aAnio(anio, a)),
    });
    for (const [anio, a] of acum) {
      const t = totales.get(anio) ?? nuevoAcum();
      t.total += a.total;
      t.registros += a.registros;
      t.sin_curva += a.sin_curva;
      if (a.tieneMeses) {
        t.tieneMeses = true;
        for (let i = 0; i < 12; i++) {
          t.meses[i] += a.meses[i];
          if (!a.todosReales[i]) t.todosReales[i] = false;
        }
      }
      totales.set(anio, t);
    }
  }
  return {
    filas: resultado,
    totales: [...totales].sort((a, b) => a[0] - b[0]).map(([anio, a]) => {
      const x = aAnio(anio, a);
      return { anio, meses: x.meses, origen_meses: x.origen_meses, total: x.total };
    }),
  };
}

// ─── Contrato de M8 ───

/**
 * Una fila por género · mundo · línea · equivalencia (si GMLE) · agrupación de marca · bloque · tienda · año. Lo que M8
 * puede asumir: `Σ meses = total` cuando `meses` no es nulo; los tres bloques son disjuntos y su suma por fila es el
 * total del año; `participaciones_historicas` solo en las filas base (en las de tienda, `null`).
 */
export function armarFilasCerradas(filas: readonly FilaPlana[], anios: readonly number[]): FilaCerradaApi[] {
  const salida: FilaCerradaApi[] = [];
  const comparar = (a: string, b: string) => a.localeCompare(b, "es");
  const activas = filas.filter((f) => f.activo);
  const ordenadas = [...activas].sort(
    (a, b) =>
      comparar(a.genero, b.genero) ||
      comparar(a.mundo, b.mundo) ||
      comparar(a.linea, b.linea) ||
      comparar(a.equivalencia ?? "", b.equivalencia ?? "") ||
      compararAgrupacionMarca(a, b) ||
      comparar(a.tienda_id ?? "", b.tienda_id ?? "")
  );
  for (const f of ordenadas) {
    for (const a of [...f.anios].sort((x, y) => x.anio - y.anio)) {
      if (!anios.includes(a.anio)) continue;
      const participaciones: Participaciones | null = f.tienda_id === null ? (f.participaciones ?? null) : null;
      const avisos: AvisoFila[] = [...new Set([...f.avisos, ...a.avisos])];
      salida.push({
        gml_id: f.gml_id,
        equivalencia_id: f.equivalencia_id,
        agrupacion_marca_id: f.agrupacion_marca_id,
        genero: f.genero,
        mundo: f.mundo,
        linea: f.linea,
        equivalencia: f.equivalencia,
        agrupacion_marca: f.agrupacion_marca,
        nivel: f.nivel,
        agrupacion_estacionalidad_id: f.agrupacion_estacionalidad?.id ?? null,
        temporada: f.agrupacion_estacionalidad?.temporada ?? null,
        bloque: a.bloque,
        subbloque: a.subbloque,
        tienda_id: f.tienda_id,
        anio: a.anio,
        total: totalDe(a),
        meses: a.meses,
        origen_meses: a.origen_meses,
        curva_origen_usada: a.curva_origen_usada ?? [],
        participaciones_historicas: participaciones,
        avisos,
      });
    }
  }
  return salida;
}

