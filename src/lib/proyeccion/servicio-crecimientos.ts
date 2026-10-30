import { supabaseAdmin } from "@/lib/supabase/admin";
import { leerVigentes } from "@/lib/crecimientos/consultas-vigentes";
import { faltantesDeCierre, gmExigidos, sobreBaseDe, type GmConNino, type VigenteCrecimiento } from "@/lib/crecimientos/vigentes";
import { cargarCatalogo } from "./contexto";
import { leerCrecimientos, leerFilasConAnios, leerGenerosMundos, leerTiendasProyeccion, type CrecimientoDb, type ProyeccionDb } from "./consultas";
import { agregarFilas, calcularPromedio, claveGM, generosDeMatriz, type FilaCrecimiento } from "./crecimientos";
import { esMetodoVigente } from "./servicio";
import { falla, fallaDb, fotoDe, listo, parametrosDe, proyeccionOr404, type Db, type Salida } from "./servicio-base";
import type { Catalogo } from "./persistencia";
import type {
  AgregadoCrecimientoApi,
  CeldaParaPromedio,
  CrecimientoAplicadoApi,
  CrecimientosSinAprobarApi,
  FilaResumenCrecimientoApi,
  PuenteApi,
  ResumenCrecimientosProyeccionApi,
  ResumenProyeccion,
  SobreBase,
} from "./tipos";

/**
 * Servicio del resumen de solo lectura de los crecimientos de una proyección (ficha 06d §4.2). Desde `0.12.1` el crecimiento es global y se aprueba en
 * Curvas de estacionalidad: aquí solo se lee lo que aplicó el último cálculo (la FOTO: `proyeccion_crecimientos` y `parametros.crecimiento_resto_usado`),
 * lo que hay aprobado hoy en el global y lo que falta para cerrar. No escribe nada. Solo servidor.
 */

const db = (): Db => supabaseAdmin();

type FilaBase = FilaCrecimiento & { gml_id: string };

type Datos = {
  p: ProyeccionDb;
  celdas: CrecimientoDb[];
  vigentes: VigenteCrecimiento[];
  catalogo: Catalogo;
  /** HOMBRE y MUJER (los que se encontraron en el catálogo), en ese orden. */
  generos: { id: string; nombre: string }[];
  nombresGeneros: ReadonlyMap<string, string>;
  nombresMundos: ReadonlyMap<string, string>;
  /** Orden de los mundos en el catálogo. */
  ordenMundos: ReadonlyMap<string, number>;
  /** Filas base activas de `Y+1` con su GM resuelto desde el árbol vigente. */
  filas: FilaBase[];
  /** Cierres de `Y+1` sin total decidido (hoy proponen 0). */
  cierresSinDecidir: number;
};

async function cargarDatos(d: Db, p: ProyeccionDb): Promise<Salida<Datos>> {
  const anioSig = p.anio_en_curso + 1;
  const [celdas, vigentes, gm, cat, filas, tiendas] = await Promise.all([
    leerCrecimientos(d, p.id),
    leerVigentes(d, [anioSig]),
    leerGenerosMundos(d),
    cargarCatalogo(d),
    leerFilasConAnios(d, p.id, { columnas: "ligeras", tiendaId: null, soloActivas: true }),
    leerTiendasProyeccion(d, p.id),
  ]);
  if (celdas.error) return fallaDb(celdas.error, "crecimientos: leer la foto");
  if (vigentes.error) return fallaDb(vigentes.error, "crecimientos: leer los aprobados");
  if (gm.error) return fallaDb(gm.error, "crecimientos: leer géneros y mundos");
  if (cat.respuesta) return falla(cat.respuesta);
  if (filas.error) return fallaDb(filas.error, "crecimientos: leer las filas");
  if (tiendas.error) return fallaDb(tiendas.error, "crecimientos: leer las tiendas");
  const catalogo = cat.data.catalogo;
  const base: FilaBase[] = [];
  for (const f of filas.data) {
    const a = f.proyeccion_fila_anios.find((x) => x.anio === anioSig && x.activo);
    const nodo = catalogo.nodos.get(f.gml_id);
    if (!a || !nodo) continue;
    base.push({
      fila_id: f.id,
      gml_id: f.gml_id,
      genero_id: nodo.genero_id,
      mundo_id: nodo.mundo_id,
      crecimiento_pct: a.crecimiento_pct === null || a.crecimiento_pct === undefined ? null : Number(a.crecimiento_pct),
      decidido: a.decidido ?? null,
      propuesto: a.propuesto ?? null,
      base_siguiente: a.base_siguiente === null || a.base_siguiente === undefined ? null : Number(a.base_siguiente),
      // 0.14.0: `B'` (la base corregida del Niño). El % propio de una fila es siempre «sobre 2026 corregido».
      base_normalizada: a.base_normalizada === null || a.base_normalizada === undefined ? null : Number(a.base_normalizada),
      sobre_base: "corregida",
    });
  }
  return listo({
    p,
    celdas: celdas.data,
    vigentes: vigentes.data,
    catalogo,
    generos: generosDeMatriz(gm.generos).map((g) => ({ id: g.id, nombre: g.nombre })),
    nombresGeneros: new Map(gm.generos.map((g) => [g.id, g.nombre])),
    nombresMundos: new Map(gm.mundos.map((m) => [m.id, m.nombre])),
    ordenMundos: new Map(gm.mundos.map((m, i) => [m.id, i])),
    filas: base,
    cierresSinDecidir: tiendas.data.filter((t) => t.activo && t.bloque === "cierres" && t.anio === anioSig && t.decidido === null).length,
  });
}

const aplicadoDe = (x: { pct: number; version: number | null } | null): CrecimientoAplicadoApi | null => (x ? { pct: x.pct, version: x.version } : null);

/**
 * `calcularPromedio(…, { sobre: 'corregida' })` supone que el % de TODOS los conjuntos es sobre `B'`. Un GM (o el Resto) aplicado con `bruta` (versión de antes de 0.14.0)
 * se escribió sobre `B`: se le pasa el agregado con su base corregida igual a la real, así su `siguiente` es `B × (1 + g)` y pesa por `Σ B`. Es solo para el Total.
 */
const agregadoParaPromedio = (a: AgregadoCrecimientoApi, sobre: SobreBase): AgregadoCrecimientoApi =>
  sobre === "corregida"
    ? a
    : { ...a, base_normalizada: a.base, base_libre_corregida: a.base_libre, pct_propio: { ...a.pct_propio, base_corregida: a.pct_propio.base }, decididas: { ...a.decididas, base_corregida: a.decididas.base } };

/**
 * Arma el resumen. La foto manda en «aplicado»; el global solo da «vigente hoy». Un GM de HOMBRE o MUJER sin celda en la foto siguió al Resto: su
 * «aplicado» es el del Resto (así ninguna celda queda vacía y el Total siempre se puede calcular).
 */
function resumenDe(dt: Datos): ResumenCrecimientosProyeccionApi {
  const { p } = dt;
  const Y = p.anio_en_curso;
  const anioSig = Y + 1;
  const parametros = parametrosDe(p.parametros);
  const resumen = p.resumen as unknown as Partial<ResumenProyeccion> | null;
  const enTrabajo = p.estado === "en_trabajo";
  const idsMatriz = dt.generos.map((g) => g.id);
  const foto = fotoDe(p, dt.celdas, idsMatriz);
  const celdasFoto = new Map(dt.celdas.filter((c) => idsMatriz.includes(c.genero_id)).map((c) => [claveGM(c.genero_id, c.mundo_id), c]));
  const vigentesGM = new Map<string, VigenteCrecimiento>();
  for (const v of dt.vigentes) {
    if (v.alcance === "gm" && v.genero_id !== null && v.mundo_id !== null && idsMatriz.includes(v.genero_id)) vigentesGM.set(claveGM(v.genero_id, v.mundo_id), v);
  }
  const vigenteResto = dt.vigentes.find((v) => v.alcance === "resto") ?? null;
  const resto = foto.resto;
  const enlace = (clave: string) => `/planificacion/curvas-estacionalidad?gm=${clave}&anio=${anioSig}&proyeccion=${p.id}`;
  const vigenteHoy = (v: VigenteCrecimiento | null | undefined): FilaResumenCrecimientoApi["vigente_hoy"] =>
    v ? { pct: Number(v.pct), version: v.version, sobre_base: sobreBaseDe(v), por_nombre: v.usuario_nombre, aprobada_at: v.aprobada_at } : null;

  // Los GM que se muestran: los de HOMBRE y MUJER con filas base de `Y+1` o con celda en la foto.
  const filasDe = new Map<string, FilaBase[]>();
  const filasResto: FilaBase[] = [];
  const detallados = new Set(idsMatriz);
  for (const f of dt.filas) {
    if (detallados.has(f.genero_id)) {
      const k = claveGM(f.genero_id, f.mundo_id);
      filasDe.set(k, [...(filasDe.get(k) ?? []), f]);
    } else filasResto.push(f);
  }
  const claves = new Set([...filasDe.keys(), ...celdasFoto.keys()]);
  const ordenGenero = new Map(idsMatriz.map((id, i) => [id, i]));
  const ordenadas = [...claves]
    .map((k) => {
      const [genero_id = "", mundo_id = ""] = k.split("|");
      return { k, genero_id, mundo_id };
    })
    .sort(
      (a, b) =>
        (ordenGenero.get(a.genero_id) ?? 0) - (ordenGenero.get(b.genero_id) ?? 0) ||
        (dt.ordenMundos.get(a.mundo_id) ?? 0) - (dt.ordenMundos.get(b.mundo_id) ?? 0) ||
        a.k.localeCompare(b.k)
    );

  const filasApi: FilaResumenCrecimientoApi[] = [];
  const paraPromedio: CeldaParaPromedio[] = [];
  for (const { k, genero_id, mundo_id } of ordenadas) {
    const celda = celdasFoto.get(k);
    const vigente = vigentesGM.get(k) ?? null;
    const agregado = agregarFilas(filasDe.get(k) ?? []);
    // 06e: la foto dice sobre qué base se aplicó cada GM (`null` = foto de antes de 0.14.0 = `bruta`); un GM sin celda siguió al Resto.
    const sobre: SobreBase = celda ? (celda.sobre_base === "corregida" ? "corregida" : "bruta") : (resto.sobre_base ?? "bruta");
    const aplicado: FilaResumenCrecimientoApi["aplicado"] = celda
      ? {
          pct: Number(celda.pct),
          version: celda.version ?? null,
          provisional: false,
          sobre_base: sobre,
          por_nombre: celda.usuario_nombre,
          // La foto no guarda cuándo se aprobó: si la versión aplicada sigue vigente, su fecha; si no, cuándo la escribió el cálculo.
          at: celda.crecimiento_id && vigente && vigente.id === celda.crecimiento_id ? vigente.aprobada_at : celda.updated_at,
        }
      : { pct: resto.pct, version: resto.version, provisional: resto.crecimiento_id === null, sobre_base: sobre, por_nombre: resto.por_nombre, at: resto.at };
    const genero = dt.nombresGeneros.get(genero_id) ?? "Género";
    const mundo = dt.nombresMundos.get(mundo_id) ?? "Mundo";
    const clave = `${genero_id}.${mundo_id}`;
    filasApi.push({
      clave,
      genero,
      mundo,
      aplicado,
      vigente_hoy: vigenteHoy(vigente),
      agregado,
      resultante_pct: agregado.base > 0 ? (agregado.siguiente_vigente / agregado.base - 1) * 100 : null,
      enlace: enlace(clave),
    });
    paraPromedio.push({ genero, mundo, pct: aplicado.pct, sin_filas: (filasDe.get(k) ?? []).length === 0, agregado: agregadoParaPromedio(agregado, sobre) });
  }

  const agregadoResto = agregarFilas(filasResto);
  const porGenero = new Map<string, number>();
  for (const f of filasResto) {
    const nombre = dt.catalogo.nodos.get(f.gml_id)?.genero ?? "—";
    porGenero.set(nombre, (porGenero.get(nombre) ?? 0) + (f.base_siguiente ?? 0));
  }
  const filaResto: ResumenCrecimientosProyeccionApi["resto"] = {
    clave: "resto",
    genero: null,
    mundo: null,
    aplicado: { pct: resto.pct, version: resto.version, provisional: resto.crecimiento_id === null, sobre_base: resto.sobre_base ?? "bruta", por_nombre: resto.por_nombre, at: resto.at },
    vigente_hoy: vigenteHoy(vigenteResto),
    agregado: agregadoResto,
    resultante_pct: agregadoResto.base > 0 ? (agregadoResto.siguiente_vigente / agregadoResto.base - 1) * 100 : null,
    enlace: enlace("resto"),
    por_genero: [...porGenero].map(([genero, base]) => ({ genero, base })).sort((a, b) => b.base - a.base || a.genero.localeCompare(b.genero, "es")),
  };

  const totales = resumen?.totales?.[anioSig];
  const puente: PuenteApi = {
    total_en_curso: resumen?.totales?.[Y]?.total ?? 0,
    nuevas_anterior: totales?.nuevas_anterior ?? 0,
    aperturas: totales?.aperturas ?? 0,
    cierres: totales?.cierres ?? 0,
    cierres_sin_decidir: dt.cierresSinDecidir,
  };
  const metodoViejo = !esMetodoVigente(p.resumen);
  // 0.14.0: el Total es «sobre 2026 corregido» (el % que se aprueba se aplica sobre `Σ B'`); `pct_resultante_real` de cada fila lo da sobre `Σ B`.
  const total = metodoViejo
    ? null
    : (calcularPromedio(paraPromedio, { pct: resto.pct, agregado: agregadoParaPromedio(agregadoResto, resto.sobre_base ?? "bruta") }, parametros.crecimiento_objetivo_pct ?? null, puente, { sobre: "corregida" }).resultado ?? null);

  // Lo que cambió en el global después de calcular (solo tiene sentido en una proyección en trabajo, que se recalcula).
  const cambiados: ResumenCrecimientosProyeccionApi["cambiados"] = [];
  if (enTrabajo && !metodoViejo) {
    for (const f of filasApi) {
      const celda = celdasFoto.get(f.clave.replace(".", "|"));
      const v = vigentesGM.get(f.clave.replace(".", "|")) ?? null;
      const aplicadoId = celda?.crecimiento_id ?? null;
      const cambia = celda ? (v?.id ?? null) !== aplicadoId || (v !== null && Number(v.pct) !== Number(celda.pct)) : v !== null;
      if (cambia) {
        cambiados.push({
          clave: f.clave,
          nombre: `${f.genero} · ${f.mundo}`,
          aplicado: celda ? aplicadoDe({ pct: Number(celda.pct), version: celda.version ?? null }) : null,
          vigente: v ? { pct: Number(v.pct), version: v.version } : null,
        });
      }
    }
    // Un GM aprobado hoy que el cálculo no usó y que no tiene filas base no cambia nada: solo cuentan los que se muestran.
    const idAplicadoResto = resto.crecimiento_id;
    if ((vigenteResto?.id ?? null) !== idAplicadoResto || (vigenteResto !== null && Number(vigenteResto.pct) !== resto.pct)) {
      cambiados.push({ clave: "resto", nombre: "Resto", aplicado: aplicadoDe(resto), vigente: vigenteResto ? { pct: Number(vigenteResto.pct), version: vigenteResto.version } : null });
    }
  }

  // Lo que falta aprobar para cerrar (I4), con los mismos vigentes que la desactualización. 0.14.0: y las vigentes `bruta` con Niño material (`reaprobar`).
  let sinAprobar: CrecimientosSinAprobarApi | null = null;
  if (enTrabajo) {
    const nombreGM = (clave: string) => {
      const [g = "", m = ""] = clave.split("|");
      return `${dt.nombresGeneros.get(g) ?? "Género"} · ${dt.nombresMundos.get(m) ?? "Mundo"}`;
    };
    const conNino: GmConNino = new Map(
      (resumen?.gm_con_nino ?? []).map((clave) => [clave, { nombre: clave === "resto" ? "Resto" : nombreGM(clave), correccion_pct: resumen?.gm_correccion_nino_pct?.[clave] ?? 0 }])
    );
    const faltan = faltantesDeCierre(gmExigidos(resumen?.gm_gml ?? {}, idsMatriz), dt.vigentes, anioSig, conNino);
    if (faltan.gm.length > 0 || faltan.resto_provisional || faltan.reaprobar.length > 0) {
      sinAprobar = {
        faltan: faltan.gm.map((clave) => {
          const [g = "", m = ""] = clave.split("|");
          return { clave: `${g}.${m}`, nombre: nombreGM(clave) };
        }),
        resto_provisional: faltan.resto_provisional,
        reaprobar: faltan.reaprobar.map((r) => ({ ...r, clave: r.clave.replace("|", ".") })),
      };
    }
  }

  return {
    anio_siguiente: anioSig,
    version_metodo: typeof resumen?.version_metodo === "number" ? resumen.version_metodo : null,
    filas: filasApi,
    resto: filaResto,
    total,
    puente,
    objetivo_pct: parametros.crecimiento_objetivo_pct ?? null,
    cambiados,
    sin_aprobar: sinAprobar,
  };
}

/** `GET …/crecimientos`: el resumen de solo lectura. `404` si la proyección no existe. No escribe nada. */
export async function leerCrecimientosDeProyeccion(id: string): Promise<Salida<ResumenCrecimientosProyeccionApi>> {
  const d = db();
  const pR = await proyeccionOr404(d, id);
  if (pR.respuesta) return falla(pR.respuesta);
  const dt = await cargarDatos(d, pR.data);
  if (dt.respuesta) return falla(dt.respuesta);
  return listo(resumenDe(dt.data));
}
