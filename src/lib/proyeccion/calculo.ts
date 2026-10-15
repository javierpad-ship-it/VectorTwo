import { huellaCargas } from "@/lib/curvas/huellas";
import { aPeriodo } from "@/lib/ventas/periodo";
import { bloquesDeAnio, clasificarTienda, claveIncluye, clavesPertenencia, esMisma, idsDe } from "./bloques";
import { indiceMes, partesDeFecha } from "./calendario";
import { proponerCierre, pruebaPorAvance } from "./cierre";
import { proponerCierreTienda } from "./cierres-tienda";
import { composicionPromedio, composicionTienda, tieneHistoria, type ComposicionTienda, type HechoTiendaFila } from "./composicion";
import { curvaFila, type ResultadoCurvaFila } from "./curva-fila";
import {
  aplicarDecisionTienda,
  armarRegistro,
  pesosDeTienda,
  recalcularBaseSiguiente,
  registroDe,
  type ContextoModelo,
  type InfoTienda,
} from "./decision";
import { explicar, textoCurva } from "./explicar";
import { factoresMes, normalizar, UNOS } from "./nino";
import { participacionesFila } from "./participaciones";
import { soloReales } from "./reparto";
import {
  maduroDeVigente,
  mesesCompletos,
  perfilApertura,
  proponerFilaTienda,
} from "./tiendas-nuevas";
import {
  claveBaseDe,
  claveFila,
  SIN_PREVIAS,
  VERSION_METODO,
  type AvisoFila,
  type DetalleW12,
  type EntradaCalculo,
  type FilaModelo,
  type FilaVenta,
  type FilaVentaTienda,
  type HistoricoAnio,
  type HistoricoFila,
  type Metodo,
  type NodoProy,
  type OrigenComposicion,
  type RegistroModelo,
  type ResumenProyeccion,
  type SalidaCalculo,
  type TiendaModelo,
  type TiendaProy,
} from "./tipos";

/**
 * `calcularProyeccion(entrada)` (ficha 07, regla 40). Determinista: nunca lee el reloj ni meses posteriores a
 * `hasta_periodo`; recibe `k` y `hoy`. Devuelve los bloques, las filas base y de tienda con sus registros por año,
 * las decisiones por tienda y el resumen. Conserva las decisiones previas (`previas`) y propaga la base del año
 * siguiente en el orden: tiendas de `Y` → filas base de `Y` → tiendas de `Y+1` → filas base de `Y+1` (B2).
 */

type Serie = { u: number[]; s: number[]; st: number[] };
const nuevaSerie = (): Serie => ({ u: Array<number>(12).fill(0), s: Array<number>(12).fill(0), st: Array<number>(12).fill(0) });

type AcumBase = {
  gml_id: string;
  equivalencia_id: string | null;
  agrupacion_marca_id: string;
  filas: FilaVenta[];
  /** `M(Z)`: lo vendido por los tiendas con `1` en la posición de `Z`. */
  ser: Map<number, Serie>;
  /** `M(Y−1) ∩ M(Y)` para `Y−2` y `Y−1` (tendencia). */
  tend: Map<number, number[]>;
};

const anioMes = (periodo: string) => ({ anio: Number(periodo.slice(0, 4)), mes: Number(periodo.slice(5, 7)) });
const claveBase = (gml: string, eq: string | null, agm: string) => claveFila(null, gml, eq, agm);

type CtxUnidad = {
  nodo: NodoProy;
  curva: number[] | null;
  curva_origen: ResultadoCurvaFila["curva_origen"];
  avisos: AvisoFila[];
  agrupacion_estacionalidad_id: string | null;
  temporada: string | null;
  phi: Map<number, number[]>;
  mesesAtipicos: Map<number, string[]>;
  factores_mes: Record<number, number[]> | null;
  pesos_equivalencias: { equivalencia_id: string; peso: number }[];
  eat_m6: number | null;
};

function ventanaW12(anio: number, k: number): string[] {
  const fin = indiceMes(anio, k);
  return Array.from({ length: 12 }, (_, i) => {
    const idx = fin - 11 + i;
    return aPeriodo(Math.floor(idx / 12), (idx % 12) + 1);
  });
}

export function calcularProyeccion(e: EntradaCalculo): SalidaCalculo {
  const Y = e.anio;
  const Y1 = Y + 1;
  const k = e.k;
  const previas = e.previas ?? SIN_PREVIAS;
  const umbralCola = e.parametros.umbral_cola_larga;
  const gDefecto = e.parametros.crecimiento_pct_defecto;

  // ── 0. Bloques de tiendas ──
  const claves = clavesPertenencia(e.tiendas, Y);
  const bloques = { [Y]: bloquesDeAnio(e.tiendas, Y, claves), [Y1]: bloquesDeAnio(e.tiendas, Y1, claves) };
  const tiendaPorId = new Map(e.tiendas.map((t) => [t.id, t]));
  const mismasSiguiente = idsDe(bloques[Y1].mismas);
  const mismasEnCurso = idsDe(bloques[Y].mismas);
  const infoTiendas = new Map<string, InfoTienda>(
    e.tiendas.map((t) => [
      t.id,
      {
        codigo: t.codigo,
        nombre: t.nombre,
        fecha_apertura: t.fecha_apertura,
        fecha_cierre: t.fecha_cierre,
        venta_esperada: t.venta_esperada,
        referente_codigo: t.referente_id ? (tiendaPorId.get(t.referente_id)?.codigo ?? null) : null,
        rampa: previas.tiendas.get(`${t.id}#${Y}`)?.rampa ?? previas.tiendas.get(`${t.id}#${Y1}`)?.rampa ?? t.rampa ?? null,
      },
    ])
  );
  const ventana = ventanaW12(Y, k);
  const enVentana = new Set(ventana);

  // ── 1. Contexto por unidad (curva, factores del Niño) ──
  const nodos = new Map(e.nodos.map((n) => [n.gml_id, n]));
  const vigentes = new Map(e.vigentes.map((v) => [v.agrupacion_id, v]));
  const agrupaciones = new Map(e.agrupaciones.map((a) => [a.id, a]));
  const pesosPorNodo = new Map<string, Map<string, number>>();
  for (const p of e.venta.equivalencias) {
    if (p.equivalencia_id === null) continue;
    const m = pesosPorNodo.get(p.gml_id) ?? new Map<string, number>();
    m.set(p.equivalencia_id, (m.get(p.equivalencia_id) ?? 0) + p.unidades);
    pesosPorNodo.set(p.gml_id, m);
  }
  const nombresCurva = new Map(e.agrupaciones.map((a) => [a.id, a.nombre]));

  const unidades = new Map<string, CtxUnidad | null>();
  const unidadDe = (gml: string, eq: string | null): CtxUnidad | null => {
    const clave = `${gml}|${eq ?? ""}`;
    const guardado = unidades.get(clave);
    if (guardado !== undefined) return guardado;
    const nodo = nodos.get(gml);
    if (!nodo || (nodo.nivel === "GMLE") !== (eq !== null)) {
      unidades.set(clave, null);
      return null;
    }
    const equivalencias = nodo.equivalencias.map((x) => ({ id: x.id, agrupacion_estacionalidad_id: x.agrupacion_estacionalidad_id }));
    const pesos = pesosPorNodo.get(gml) ?? new Map<string, number>();
    const cf = curvaFila({ nivel: nodo.nivel, equivalencia_id: eq }, equivalencias, vigentes, agrupaciones, pesos);
    const phi = new Map<number, number[]>();
    const atipicos = new Map<number, string[]>();
    const avisos = new Set<AvisoFila>(cf.avisos);
    for (let z = Y - 3; z <= Y1; z++) {
      const r = factoresMes(cf.componentes, e.periodos, e.factores, z, { objetivo: z === Y1 });
      phi.set(z, r.factores);
      atipicos.set(z, r.mesesAtipicos);
      if (z >= Y - 1) for (const a of r.avisos) avisos.add(a);
    }
    const hayNino = [...phi.values()].some((f) => f.some((x) => Math.abs(x - 1) > 1e-9));
    const factores_mes: Record<number, number[]> | null = hayNino ? Object.fromEntries([...phi].map(([z, f]) => [z, f])) : null;

    // Pesos de las equivalencias (solo un GML con varias).
    const pesosEq: { equivalencia_id: string; peso: number }[] = [];
    if (nodo.nivel === "GML") {
      const total = [...pesos.values()].reduce((a, b) => a + b, 0);
      if (total > 0) for (const [id, u] of [...pesos].sort((a, b) => a[0].localeCompare(b[0]))) if (u > 0) pesosEq.push({ equivalencia_id: id, peso: u / total });
    }
    // EAT de M6 dejando `Y−1` fuera: promedio ponderado por el peso de cada agrupación (si la vigente lo trae).
    let eat: number | null = null;
    let pesoEat = 0;
    let sumaEat = 0;
    for (const o of cf.curva_origen) {
      const pliegue = vigentes.get(o.agrupacion_id)?.eat_por_pliegue?.find((p) => p.anio === Y - 1);
      if (pliegue) {
        sumaEat += pliegue.eat * o.peso;
        pesoEat += o.peso;
      }
    }
    if (pesoEat > 0) eat = sumaEat / pesoEat;

    const ctx: CtxUnidad = {
      nodo,
      curva: cf.curva,
      curva_origen: cf.curva_origen,
      avisos: [...avisos],
      agrupacion_estacionalidad_id: cf.dominante?.id ?? null,
      temporada: cf.dominante?.temporada ?? null,
      phi,
      mesesAtipicos: atipicos,
      factores_mes,
      pesos_equivalencias: pesosEq,
      eat_m6: eat,
    };
    unidades.set(clave, ctx);
    return ctx;
  };
  const phiDe = (u: CtxUnidad, z: number) => u.phi.get(z) ?? UNOS;

  // ── 2. Venta por fila base y por tienda ──
  const bases = new Map<string, AcumBase>();
  let totalTodasY = 0;
  let totalMY = 0;
  for (const f of e.venta.filas) {
    const { anio, mes } = anioMes(f.periodo);
    const clave = claveBase(f.gml_id, f.equivalencia_id, f.agrupacion_marca_id);
    let acum = bases.get(clave);
    if (!acum) {
      acum = { gml_id: f.gml_id, equivalencia_id: f.equivalencia_id, agrupacion_marca_id: f.agrupacion_marca_id, filas: [], ser: new Map(), tend: new Map() };
      bases.set(clave, acum);
    }
    acum.filas.push(f);
    if (claveIncluye(f.clave, Y, anio)) {
      const s = acum.ser.get(anio) ?? nuevaSerie();
      s.u[mes - 1] += f.unidades;
      s.s[mes - 1] += f.venta_soles;
      s.st[mes - 1] += f.stock_unidades;
      acum.ser.set(anio, s);
    }
    if ((anio === Y - 1 || anio === Y - 2) && claveIncluye(f.clave, Y, Y - 1) && claveIncluye(f.clave, Y, Y)) {
      const t = acum.tend.get(anio) ?? Array<number>(12).fill(0);
      t[mes - 1] += f.unidades;
      acum.tend.set(anio, t);
    }
    if (anio === Y && mes <= k) {
      totalTodasY += f.unidades;
      if (claveIncluye(f.clave, Y, Y)) totalMY += f.unidades;
    }
  }

  const porTienda = new Map<string, Map<string, FilaVentaTienda[]>>();
  let totalTiendasNuevasCierres = 0;
  const idsNC = new Set([...bloques[Y].nuevas, ...bloques[Y].cierres].map((t) => t.tienda_id));
  for (const r of e.venta.por_tienda) {
    const clave = claveBase(r.gml_id, r.equivalencia_id, r.agrupacion_marca_id);
    const m = porTienda.get(r.tienda_id) ?? new Map<string, FilaVentaTienda[]>();
    const lista = m.get(clave) ?? [];
    lista.push(r);
    m.set(clave, lista);
    porTienda.set(r.tienda_id, m);
    const { anio, mes } = anioMes(r.periodo);
    if (idsNC.has(r.tienda_id) && anio === Y && mes <= k) totalTiendasNuevasCierres += r.unidades;
  }
  const fueraBloque = Math.max(0, totalTodasY - totalMY - totalTiendasNuevasCierres);

  /** Unidades mensuales de una tienda en una fila base durante un año. */
  const serieTienda = (tiendaId: string, clave: string, anio: number): number[] => {
    const serie = Array<number>(12).fill(0);
    for (const r of porTienda.get(tiendaId)?.get(clave) ?? []) {
      const p = anioMes(r.periodo);
      if (p.anio === anio) serie[p.mes - 1] += r.unidades;
    }
    return serie;
  };

  // Contexto del modelo (lo comparten el cálculo y las decisiones).
  const planNombre = e.planAnterior?.nombre ?? null;
  const ctxModelo: ContextoModelo = {
    anio: Y,
    k,
    crecimiento_pct_defecto: gDefecto,
    umbral_cola_larga: umbralCola,
    rampa_maduracion: e.parametros.rampa_maduracion,
    nombresCurva,
    mismasSiguiente,
    tiendas: infoTiendas,
    crecimientoDe: (cb) => previas.filas.get(`${cb}#${Y1}`)?.crecimiento_pct ?? gDefecto,
    planAnteriorNombre: planNombre,
  };

  const textoCurvaDe = (u: CtxUnidad) =>
    textoCurva(u.curva_origen.map((o) => ({ nombre: nombresCurva.get(o.agrupacion_id) ?? "curva", version: o.version, peso: o.peso })));

  // ── 3. Tiendas nuevas y cierres: año en curso ──
  const filasTienda = new Map<string, FilaModelo>();
  const tiendasModelo: TiendaModelo[] = [];
  const perfiles: { tienda: string; ratios: number[] }[] = [];

  // Composición de una tienda sobre `W12` con sus propios hechos.
  const composicionDeTienda = (tiendaId: string): ComposicionTienda => {
    const hechos: HechoTiendaFila[] = [];
    for (const [clave, rows] of porTienda.get(tiendaId) ?? []) {
      for (const r of rows) hechos.push({ fila: clave, periodo: r.periodo.slice(0, 7), unidades: r.unidades, venta_soles: r.venta_soles });
    }
    return composicionTienda(hechos, ventana, (clave, periodo) => {
      const a = bases.get(clave);
      const u = a ? unidadDe(a.gml_id, a.equivalencia_id) : null;
      const { anio, mes } = anioMes(periodo);
      return u ? (phiDe(u, anio)[mes - 1] ?? 1) : 1;
    });
  };
  const composicionesCache = new Map<string, ComposicionTienda>();
  const composicionCacheada = (id: string) => {
    let c = composicionesCache.get(id);
    if (!c) {
      c = composicionDeTienda(id);
      composicionesCache.set(id, c);
    }
    return c;
  };
  // Promedio de las tiendas de `M(Z)` con igual peso; si ninguna trae detalle, la composición agregada de `M(Z)`.
  const composicionRed = (z: number): ComposicionTienda => {
    const ids = e.tiendas.filter((t) => esMisma(t, z) && porTienda.has(t.id)).map((t) => t.id);
    if (ids.length > 0) return composicionPromedio(ids.map(composicionCacheada));
    const hechos: HechoTiendaFila[] = [];
    for (const [clave, a] of bases) {
      for (const f of a.filas) {
        const periodo = f.periodo.slice(0, 7);
        if (enVentana.has(periodo) && claveIncluye(f.clave, Y, z)) hechos.push({ fila: clave, periodo, unidades: f.unidades, venta_soles: f.venta_soles });
      }
    }
    return composicionTienda(hechos, ventana, (clave, periodo) => {
      const a = bases.get(clave);
      const u = a ? unidadDe(a.gml_id, a.equivalencia_id) : null;
      const { anio, mes } = anioMes(periodo);
      return u ? (phiDe(u, anio)[mes - 1] ?? 1) : 1;
    });
  };

  type PlanTienda = {
    tienda: TiendaProy;
    rampa: number[];
    origen: OrigenComposicion;
    comp: Map<number, ComposicionTienda>;
    avisos: AvisoFila[];
  };

  const planDeTienda = (t: TiendaProy, anios: number[]): PlanTienda => {
    const rampa =
      previas.tiendas.get(`${t.id}#${Y}`)?.rampa ?? previas.tiendas.get(`${t.id}#${Y1}`)?.rampa ?? t.rampa ?? [...e.parametros.rampa_maduracion];
    const avisos: AvisoFila[] = [];
    let origen: OrigenComposicion = "red";
    let refComp: ComposicionTienda | null = null;
    const referente = t.referente_id ? tiendaPorId.get(t.referente_id) : undefined;
    if (referente && referente.id !== t.id) {
      const c = composicionCacheada(referente.id);
      if (tieneHistoria(c)) {
        refComp = c;
        origen = "referente";
      } else {
        avisos.push("referente_sin_historia");
      }
    } else {
      avisos.push("sin_referente");
    }
    const comp = new Map<number, ComposicionTienda>();
    for (const z of anios) comp.set(z, refComp ?? composicionRed(z));
    return { tienda: t, rampa, origen, comp, avisos };
  };

  const filaDeTienda = (t: TiendaProy, clave: string, a: AcumBase, u: CtxUnidad, comp: ComposicionTienda | null, origen: OrigenComposicion, md: number | null): FilaModelo => {
    const cb = clave;
    const clv = claveFila(t.id, a.gml_id, a.equivalencia_id, a.agrupacion_marca_id);
    const existente = filasTienda.get(clv);
    if (existente) return existente;
    const cf = comp?.filas.find((f) => f.fila === cb);
    const fila: FilaModelo = {
      clave: clv,
      tienda_id: t.id,
      gml_id: a.gml_id,
      equivalencia_id: a.equivalencia_id,
      agrupacion_marca_id: a.agrupacion_marca_id,
      nivel: u.nodo.nivel,
      agrupacion_estacionalidad_id: u.agrupacion_estacionalidad_id,
      temporada: u.temporada,
      curva: u.curva,
      curva_origen: u.curva_origen,
      factores_mes: u.factores_mes,
      historico: null,
      participaciones: null,
      composicion: cf ? { origen, s: cf.s, p: cf.p, unidades_maduras: md ?? 0 } : null,
      avisos: [...u.avisos],
      activo: true,
      registros: [],
    };
    filasTienda.set(clv, fila);
    return fila;
  };

  const registrar = (fila: FilaModelo, reg: RegistroModelo) => {
    fila.registros = [...fila.registros.filter((r) => r.anio !== reg.anio), reg].sort((x, y) => x.anio - y.anio);
  };

  // Estado por (tienda, año): filas y método.
  const estadoTienda = new Map<string, { filas: FilaModelo[]; metodo: Metodo; plan: PlanTienda | null; unidadesMaduras: number | null; avisos: Set<AvisoFila>; maduro: number | null; vendidoNormalizado: number | null }>();

  const procesarTienda = (t: TiendaProy, z: number) => {
    const c = clasificarTienda(t, z);
    if (c.bloque !== "nuevas" && c.bloque !== "cierres") return;
    const esY = z === Y;
    const anios = [z];
    const plan = c.bloque === "nuevas" ? planDeTienda(t, anios) : null;
    const comp = plan ? (plan.comp.get(z) ?? null) : null;
    const info = infoTiendas.get(t.id) as InfoTienda;
    const rampa = plan?.rampa ?? [...e.parametros.rampa_maduracion];
    const E = t.venta_esperada;
    const avisosT = new Set<AvisoFila>(plan?.avisos ?? []);
    // Canibalización: solo aviso (no se resta nada a las mismas tiendas de la zona).
    if (c.bloque === "nuevas" && t.zona && e.tiendas.some((o) => o.id !== t.id && o.tipo === "Tienda" && o.activo && o.zona === t.zona)) {
      avisosT.add("canibalizacion");
    }
    const filasDeEstaTienda: FilaModelo[] = [];
    let metodoTienda: Metodo = "sin_propuesta";
    let unidadesMaduras: number | null = E === null ? null : 0;
    // Total maduro `A` de la tienda (suma de sus filas) y el `V'` normalizado del que sale, para la frase (regla 27).
    let maduroTienda: number | null = null;
    let vendidoNormTienda: number | null = null;

    // Universo de filas: composición ∪ ventas propias del año.
    const claves = new Set<string>();
    if (comp) for (const f of comp.filas) claves.add(f.fila);
    for (const [clave, rows] of porTienda.get(t.id) ?? []) {
      const hayVenta = rows.some((r) => {
        const p = anioMes(r.periodo);
        if (c.bloque === "cierres" && z === Y1) return enVentana.has(r.periodo.slice(0, 7)) && r.unidades > 0;
        return p.anio === Y && p.mes <= k && r.unidades > 0;
      });
      if (hayVenta) claves.add(clave);
    }
    if (E !== null && comp) unidadesMaduras = comp.filas.reduce((s, f) => s + (f.p > 0 ? (E * 12 * f.s) / f.p : 0), 0);

    for (const clave of [...claves].sort()) {
      const a = bases.get(clave);
      if (!a) continue;
      const u = unidadDe(a.gml_id, a.equivalencia_id);
      if (!u) continue;
      const cf = comp?.filas.find((f) => f.fila === clave);
      const md = E !== null && cf && cf.p > 0 ? (E * 12 * cf.s) / cf.p : E !== null ? 0 : null;
      const fila = filaDeTienda(t, clave, a, u, comp, plan?.origen ?? "propia", md);
      const phi = phiDe(u, z);
      const real = esY ? serieTienda(t.id, clave, Y) : Array<number>(12).fill(0);
      const realK = soloReales(real, k);
      const vendido = esY ? realK.reduce((s, x) => s + x, 0) : 0;

      let base: Omit<RegistroModelo, "curva_origen_usada" | "curva_origen_propuesta" | "vigente" | "decidido" | "origen" | "propuesta_al_decidir" | "nota" | "decidido_por_nombre" | "decidido_at" | "meses" | "meses_propuestos" | "origen_meses" | "crecimiento_pct">;
      let pesosExtra: number[];
      if (c.bloque === "cierres") {
        const cierre = t.fecha_cierre as string;
        const r = proponerCierreTienda({ vendido, fechaCierre: cierre, anio: z, anioEnCurso: Y, k });
        const q = pesosDeTienda(info, "cierres", rampa, z);
        pesosExtra = q;
        metodoTienda = "cierre";
        for (const x of r.avisos) avisosT.add(x);
        base = {
          anio: z,
          bloque: "cierres",
          subbloque: null,
          vendido,
          propuesto: r.propuesto,
          metodo: "cierre",
          referencia_alternativa: null,
          referencia_tres_meses: null,
          explicacion: "",
          avance: null,
          avisos: r.avisos,
        };
      } else {
        const r = pesosDeTienda(info, "nuevas", rampa, z);
        pesosExtra = r;
        const regY = registroDe(fila, Y);
        let maduroPrevio: number | null = null;
        if (!esY && c.subbloque === "nuevas_anterior" && regY) {
          maduroPrevio = maduroDeVigente({ vigente: regY.vigente, curva: u.curva, rampa: pesosDeTienda(info, "nuevas", rampa, Y), phi: phiDe(u, Y) });
        }
        const g = ctxModelo.crecimientoDe?.(clave) ?? gDefecto;
        const res = proponerFilaTienda({
          esAnioEnCurso: esY,
          k: esY ? k : 0,
          subbloque: c.subbloque ?? "aperturas",
          nCompletos: t.fecha_apertura ? mesesCompletos(t.fecha_apertura, Y, k) : 0,
          real: realK,
          curva: u.curva,
          rampa: r,
          phi,
          maduras: md,
          maduroPrevio,
          crecimiento: g,
        });
        if ((res.metodo === "avance_propio" || res.metodo === "maduro_propio") && res.maduro_propio !== null) maduroTienda = (maduroTienda ?? 0) + res.maduro_propio;
        if (res.metodo === "avance_propio" && res.vendido_normalizado !== null) vendidoNormTienda = (vendidoNormTienda ?? 0) + res.vendido_normalizado;
        if (metodoTienda === "sin_propuesta" || res.metodo !== "sin_propuesta") metodoTienda = res.metodo === "sin_propuesta" ? metodoTienda : res.metodo;
        for (const x of res.avisos) avisosT.add(x);
        base = {
          anio: z,
          bloque: "nuevas",
          subbloque: c.subbloque ?? null,
          vendido: res.vendido,
          propuesto: res.propuesto,
          metodo: res.metodo,
          referencia_alternativa: res.referencia_alternativa,
          referencia_tres_meses: res.referencia_tres_meses,
          explicacion: "",
          avance: null,
          avisos: res.avisos,
        };
      }

      // Cifra fijada a mano de la fila (sobrevive al recálculo): solo `manual`.
      const previaFila = previas.filas.get(`${fila.clave}#${z}`);
      const fijada = previaFila && previaFila.origen === "manual" && previaFila.decidido !== null ? previaFila : null;
      const reg = armarRegistro(base, fijada, {
        anio: z,
        anioEnCurso: Y,
        k: esY ? k : 0,
        curva: u.curva,
        curva_origen: u.curva_origen,
        phi,
        pesosExtra,
        real: realK,
      });
      registrar(fila, reg);
      filasDeEstaTienda.push(fila);
    }
    estadoTienda.set(`${t.id}#${z}`, { filas: filasDeEstaTienda, metodo: metodoTienda, plan, unidadesMaduras, avisos: avisosT, maduro: maduroTienda, vendidoNormalizado: vendidoNormTienda });
  };

  const tiendasConBloque = e.tiendas.filter((t) => ["nuevas", "cierres"].includes(clasificarTienda(t, Y).bloque) || ["nuevas", "cierres"].includes(clasificarTienda(t, Y1).bloque));

  // Cierre de la decisión de una tienda y año: escala sus filas y arma `TiendaModelo`.
  const cerrarTienda = (t: TiendaProy, z: number) => {
    const st = estadoTienda.get(`${t.id}#${z}`);
    const c = clasificarTienda(t, z);
    if (!st || (c.bloque !== "nuevas" && c.bloque !== "cierres")) return;
    const previa = previas.tiendas.get(`${t.id}#${z}`);
    let filas = st.filas;
    let decidido: number | null = null;
    let origen: "propuesta" | "manual" | null = null;
    const avisos = new Set<AvisoFila>(st.avisos);
    if (previa && previa.decidido !== null) {
      const r = aplicarDecisionTienda({
        filas: st.filas,
        tiendaId: t.id,
        anio: z,
        decision: { decidido: previa.decidido, origen: "manual", nota: previa.nota, decidido_por_nombre: previa.decidido_por_nombre, decidido_at: previa.decidido_at },
        ctx: ctxModelo,
      });
      filas = r.filas;
      for (const f of r.filas) filasTienda.set(f.clave, f);
      for (const a of r.tienda.avisos) avisos.add(a);
      decidido = previa.decidido;
      origen = previa.origen ?? "manual";
    }
    const registros = filas.map((f) => registroDe(f, z)).filter((r): r is RegistroModelo => r !== undefined);
    const vendido = registros.reduce((s, r) => s + r.vendido, 0);
    const propuesto = registros.some((r) => r.propuesto !== null) ? registros.reduce((s, r) => s + (r.propuesto ?? 0), 0) : null;
    const propuestaAlDecidir = decidido === null ? null : (previa?.propuesta_al_decidir ?? propuesto);
    if (decidido !== null && propuestaAlDecidir !== propuesto) avisos.add("propuesta_cambio");
    const refAlt = registros.some((r) => r.referencia_alternativa !== null) ? registros.reduce((s, r) => s + (r.referencia_alternativa ?? 0), 0) : null;
    const ref3 = registros.some((r) => r.referencia_tres_meses !== null) ? registros.reduce((s, r) => s + (r.referencia_tres_meses ?? 0), 0) : null;
    const maduro = c.bloque === "nuevas" ? st.maduro : null;
    // Todas las curvas que usan sus filas (una tienda con líneas distintas no usa una sola).
    const curvasDeLaTienda = [...new Set(filas.map((f) => textoCurvaDe(unidadDe(f.gml_id, f.equivalencia_id) as CtxUnidad)).filter((x): x is string => x !== null))];
    const info = infoTiendas.get(t.id) as InfoTienda;
    const metodo = c.bloque === "cierres" ? "cierre" : st.metodo;
    const explicacion = explicar({
      metodo,
      anio: z,
      anioEnCurso: Y,
      k: z === Y ? k : 0,
      vendido,
      propuesto,
      curvaTexto: curvasDeLaTienda.length > 0 ? curvasDeLaTienda.join("; ") : null,
      tienda: { codigo: info.codigo, nombre: info.nombre },
      referente: info.referente_codigo,
      origenComposicion: st.plan?.origen ?? "propia",
      ventaEsperada: t.venta_esperada,
      unidadesMaduras: st.unidadesMaduras,
      rampa: st.plan?.rampa,
      apertura: t.fecha_apertura,
      fechaCierre: t.fecha_cierre,
      mesesCompletos: t.fecha_apertura ? mesesCompletos(t.fecha_apertura, Y, k) : 0,
      referenciaAlternativa: refAlt,
      referenciaTresMeses: ref3,
      totalMaduro: maduro,
      vendidoNormalizado: c.bloque === "nuevas" ? st.vendidoNormalizado : null,
      crecimiento: gDefecto,
    });
    tiendasModelo.push({
      tienda_id: t.id,
      anio: z,
      bloque: c.bloque,
      subbloque: c.bloque === "nuevas" ? (c.subbloque ?? null) : null,
      fecha_usada: (c.bloque === "cierres" ? t.fecha_cierre : t.fecha_apertura) as string,
      venta_esperada_usada: t.venta_esperada,
      referente_id_usado: t.referente_id,
      origen_composicion: st.plan?.origen ?? "propia",
      rampa: st.plan?.rampa ?? [...e.parametros.rampa_maduracion],
      unidades_maduras: st.unidadesMaduras === null ? null : Math.round(st.unidadesMaduras),
      vendido,
      propuesto,
      metodo,
      decidido,
      origen,
      propuesta_al_decidir: propuestaAlDecidir,
      nota: previa?.nota ?? null,
      decidido_por_nombre: previa?.decidido_por_nombre ?? null,
      decidido_at: previa?.decidido_at ?? null,
      explicacion,
      referencia_alternativa: refAlt,
      referencia_tres_meses: ref3,
      avisos: [...avisos],
    });
  };

  // Año en curso.
  for (const t of tiendasConBloque) procesarTienda(t, Y);
  for (const t of tiendasConBloque) cerrarTienda(t, Y);

  // ── 4. Filas base del año en curso ──
  const filasBase: FilaModelo[] = [];
  const mismasPorAnio = new Map<number, string[]>();
  for (let z = Y - 3; z <= Y; z++) {
    mismasPorAnio.set(z, e.tiendas.filter((t) => esMisma(t, z)).map((t) => t.codigo).sort((a, b) => a.localeCompare(b, "es")));
  }
  const detallePorBase = new Map<string, DetalleW12[]>();
  for (const d of e.venta.detalle_w12) {
    const cb = claveBase(d.gml_id, d.equivalencia_id, d.agrupacion_marca_id);
    const l = detallePorBase.get(cb) ?? [];
    l.push(d);
    detallePorBase.set(cb, l);
  }
  const salientesIds = [...mismasEnCurso].filter((id) => !mismasSiguiente.has(id));
  let sumaPropuestaPrueba = 0;
  let sumaRealPrueba = 0;

  for (const [clave, a] of [...bases].sort((x, y) => x[0].localeCompare(y[0]))) {
    const u = unidadDe(a.gml_id, a.equivalencia_id);
    if (!u) continue;
    const avisos = new Set<AvisoFila>(u.avisos);
    // Meses negativos: se truncan a 0 después de sumar las tiendas (M6, regla 2b).
    const aSerie = (z: number) => {
      const s = a.ser.get(z) ?? nuevaSerie();
      const u2 = s.u.map((x) => (x < 0 ? 0 : x));
      if (s.u.some((x) => x < 0) && z >= Y - 1) avisos.add("mes_negativo");
      return { ...s, u: u2 };
    };
    const sY = aSerie(Y);
    const phiY = phiDe(u, Y);
    const planAnt = e.planAnterior?.totales.get(clave) ?? null;
    const ventaPrev = aSerie(Y - 1).u.reduce((x, y) => x + y, 0) > 0;
    const cierre = proponerCierre({ serie: sY.u, k, curva: u.curva, factoresMes: phiY, umbralAvance: e.parametros.umbral_avance, planAnterior: planAnt, ventaAnioAnterior: ventaPrev });
    for (const x of cierre.avisos) avisos.add(x);
    if (cierre.propuesto !== null && cierre.propuesto < umbralCola) avisos.add("cola_larga");

    // Histórico por año con la red de cada año.
    const anios: HistoricoAnio[] = [];
    for (let z = Y - 3; z <= Y; z++) {
      const s = aSerie(z);
      const phi = phiDe(u, z);
      const atip = new Set(u.mesesAtipicos.get(z) ?? []);
      const limite = z === Y ? k : 12;
      const meses = Array.from({ length: 12 }, (_, i) => {
        const unidadesMes = i < limite ? s.u[i] : 0;
        const stock = i < limite ? s.st[i] : 0;
        const cobertura = unidadesMes > 0 ? stock / unidadesMes : null;
        const quiebre = cobertura !== null && cobertura < e.parametros.umbral_cobertura;
        if (quiebre && z === Y) avisos.add("quiebre");
        const periodo = aPeriodo(z, i + 1);
        return { periodo, unidades: unidadesMes, venta_soles: i < limite ? s.s[i] : 0, stock_fin: stock, cobertura, quiebre, atipico: atip.has(periodo) };
      });
      const total = meses.reduce((x, m) => x + m.unidades, 0);
      anios.push({
        anio: z,
        clase: z === Y ? "en_curso" : atip.size > 0 ? "atipico" : "normal",
        meses_atipicos: [...atip].sort(),
        total,
        total_normalizado: normalizar(meses.map((m) => m.unidades), phi).reduce((x, y) => x + y, 0),
        tiendas: mismasPorAnio.get(z) ?? [],
        meses,
      });
    }

    // Tendencia sobre `M(Y−1) ∩ M(Y)`, normalizada.
    let tendencia: number | null = null;
    const t1 = a.tend.get(Y - 1);
    const t2 = a.tend.get(Y - 2);
    if (t1 && t2) {
      const n1 = normalizar(t1, phiDe(u, Y - 1)).reduce((x, y) => x + y, 0);
      const n2 = normalizar(t2, phiDe(u, Y - 2)).reduce((x, y) => x + y, 0);
      if (n2 > 0) tendencia = n1 / n2 - 1;
    }

    // Prueba con el año anterior (dentro de muestra).
    let prueba: HistoricoFila["prueba_anterior"] = null;
    const sPrev = aSerie(Y - 1);
    const realPrev = sPrev.u.reduce((x, y) => x + y, 0);
    const propPrev = pruebaPorAvance({ serie: sPrev.u, k, curva: u.curva, factoresMes: phiDe(u, Y - 1) });
    if (propPrev !== null && realPrev > 0) {
      prueba = { anio: Y - 1, propuesto: propPrev, real: realPrev, desvio_pct: (propPrev / realPrev - 1) * 100, dentro_de_muestra: true, eat_m6: u.eat_m6 };
      sumaPropuestaPrueba += propPrev;
      sumaRealPrueba += realPrev;
    }

    const salientes = salientesIds
      .map((id) => {
        const serie = soloReales(serieTienda(id, clave, Y), k);
        return { tienda_id: id, vendido: serie.reduce((x, y) => x + y, 0), meses: serie };
      })
      .filter((s) => s.vendido > 0);

    const historico: HistoricoFila = {
      anios,
      tendencia,
      prueba_anterior: prueba,
      pesos_equivalencias: u.pesos_equivalencias,
      salientes,
    };

    const resto = cierre.meses;
    const explicacion = explicar({
      metodo: cierre.metodo,
      anio: Y,
      anioEnCurso: Y,
      k,
      vendido: cierre.vendido,
      propuesto: cierre.propuesto,
      curvaTexto: textoCurvaDe(u),
      tiendas: mismasEnCurso.size,
      avance: cierre.avance,
      phi: phiY,
      restoMeses: resto,
      planAnterior: planAnt !== null && planNombre ? { nombre: planNombre, total: planAnt } : null,
      referenciaAlternativa: cierre.referencia_alternativa,
    });

    const reg = armarRegistro(
      {
        anio: Y,
        bloque: "mismas",
        subbloque: null,
        vendido: cierre.vendido,
        propuesto: cierre.propuesto,
        metodo: cierre.metodo,
        referencia_alternativa: cierre.referencia_alternativa,
        referencia_tres_meses: null,
        explicacion,
        avance: cierre.avance,
        avisos: [...avisos],
      },
      previas.filas.get(`${clave}#${Y}`),
      { anio: Y, anioEnCurso: Y, k, curva: u.curva, curva_origen: u.curva_origen, phi: phiY, real: sY.u }
    );

    const detalle = detallePorBase.get(clave) ?? [];
    filasBase.push({
      clave,
      tienda_id: null,
      gml_id: a.gml_id,
      equivalencia_id: a.equivalencia_id,
      agrupacion_marca_id: a.agrupacion_marca_id,
      nivel: u.nodo.nivel,
      agrupacion_estacionalidad_id: u.agrupacion_estacionalidad_id,
      temporada: u.temporada,
      curva: u.curva,
      curva_origen: u.curva_origen,
      factores_mes: u.factores_mes,
      historico,
      participaciones: e.configFlujo ? participacionesFila(detalle, e.configFlujo) : null,
      composicion: null,
      avisos: [...avisos],
      activo: true,
      registros: [reg],
    });
  }

  // ── 5. Tiendas nuevas y cierres: año siguiente (usan lo vigente de `Y`) ──
  for (const t of tiendasConBloque) procesarTienda(t, Y1);
  for (const t of tiendasConBloque) cerrarTienda(t, Y1);

  // ── 6. Filas base del año siguiente (B2) ──
  const tiendasPorBase = new Map<string, FilaModelo[]>();
  for (const f of filasTienda.values()) {
    const cb = claveBaseDe(f.clave);
    const l = tiendasPorBase.get(cb) ?? [];
    l.push(f);
    tiendasPorBase.set(cb, l);
  }
  const filasBaseFinal = filasBase.map((f) => recalcularBaseSiguiente(f, tiendasPorBase.get(f.clave) ?? [], ctxModelo, previas.filas.get(`${f.clave}#${Y1}`) ?? null));

  // ── 7. Perfil de las aperturas históricas (referencia de la rampa) ──
  for (const t of e.tiendas) {
    if (!t.fecha_apertura || t.tipo !== "Tienda" || !porTienda.has(t.id)) continue;
    const { anio: aa, mes: am } = partesDeFecha(t.fecha_apertura);
    const inicio = indiceMes(aa, am);
    const ultimo = indiceMes(Y, k);
    if (inicio + 12 > ultimo + 1) continue;
    const unidadesMes = Array<number>(12).fill(0);
    const curvaMes = Array<number>(12).fill(0);
    const pesoMes = Array<number>(12).fill(0);
    let completo = true;
    for (const [clave, rows] of porTienda.get(t.id) ?? []) {
      const a = bases.get(clave);
      const u = a ? unidadDe(a.gml_id, a.equivalencia_id) : null;
      for (const r of rows) {
        const p = anioMes(r.periodo);
        const j = indiceMes(p.anio, p.mes) - inicio;
        if (j < 0 || j >= 12) continue;
        unidadesMes[j] += r.unidades;
        if (u?.curva) {
          curvaMes[j] += r.unidades * u.curva[p.mes - 1];
          pesoMes[j] += r.unidades;
        }
      }
    }
    for (let j = 0; j < 12; j++) if (!(pesoMes[j] > 0)) completo = false;
    if (!completo) continue;
    const ratios = perfilApertura(unidadesMes, curvaMes.map((c, j) => c / pesoMes[j]));
    if (ratios) perfiles.push({ tienda: t.codigo, ratios });
  }

  // ── 8. Resumen ──
  const resumen = armarResumen({
    filas: [...filasBaseFinal, ...filasTienda.values()],
    filasBase: filasBaseFinal,
    anio: Y,
    huellaCargas: huellaCargas(e.venta.cargas),
    curvasUsadas: e.vigentes.map((v) => ({ agrupacion_id: v.agrupacion_id, curva_id: v.curva_id, version: v.version })),
    desvio: sumaRealPrueba > 0 ? (sumaPropuestaPrueba / sumaRealPrueba - 1) * 100 : null,
    perfiles,
    fueraBloque,
  });

  return {
    bloques,
    claves,
    filas: [...filasBaseFinal, ...[...filasTienda.values()].sort((x, y) => x.clave.localeCompare(y.clave))],
    tiendas: tiendasModelo.sort((x, y) => x.tienda_id.localeCompare(y.tienda_id) || x.anio - y.anio),
    resumen,
  };
}

function armarResumen(args: {
  filas: FilaModelo[];
  filasBase: FilaModelo[];
  anio: number;
  huellaCargas: string;
  curvasUsadas: ResumenProyeccion["curvas_usadas"];
  desvio: number | null;
  perfiles: ResumenProyeccion["perfiles_apertura"];
  fueraBloque: number;
}): ResumenProyeccion {
  const Y = args.anio;
  const filasPorAnio: Record<number, number> = { [Y]: 0, [Y + 1]: 0 };
  const decididas: Record<number, number> = { [Y]: 0, [Y + 1]: 0 };
  const totales: ResumenProyeccion["totales"] = {
    [Y]: { mismas: 0, nuevas_anterior: 0, aperturas: 0, cierres: 0, total: 0 },
    [Y + 1]: { mismas: 0, nuevas_anterior: 0, aperturas: 0, cierres: 0, total: 0 },
  };
  const avisos: ResumenProyeccion["avisos"] = {};
  for (const f of args.filas) {
    for (const r of f.registros) {
      const t = totales[r.anio];
      if (!t) continue;
      const v = r.vigente ?? 0;
      if (r.bloque === "mismas") t.mismas += v;
      else if (r.bloque === "cierres") t.cierres += v;
      else if (r.subbloque === "nuevas_anterior") t.nuevas_anterior += v;
      else t.aperturas += v;
      t.total += v;
      if (f.tienda_id === null) {
        filasPorAnio[r.anio] += 1;
        if (r.decidido !== null) decididas[r.anio] += 1;
      }
      for (const a of r.avisos) avisos[a] = (avisos[a] ?? 0) + 1;
    }
  }
  return {
    filas: args.filasBase.length,
    filas_por_anio: filasPorAnio,
    decididas,
    totales,
    avisos,
    huella_cargas: args.huellaCargas,
    curvas_usadas: args.curvasUsadas,
    desvio_prueba_anterior_pct: args.desvio,
    perfiles_apertura: args.perfiles,
    fuera_bloque: args.fueraBloque,
    version_metodo: VERSION_METODO,
    duracion_ms: null,
  };
}

