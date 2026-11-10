import { supabaseAdmin } from "@/lib/supabase/admin";
import { leerVigentes } from "@/lib/crecimientos/consultas-vigentes";
import { leerFilasConAnios, leerTiendasProyeccion, type ProyeccionDb } from "@/lib/proyeccion/consultas";
import { cargarContextoCalculo } from "@/lib/proyeccion/contexto";
import { comoAvisos } from "@/lib/proyeccion/persistencia";
import { bloqueosNinoDeCierre, calculoEnCurso, filaBloqueaCierre, motivoRechazoCerrar, MENSAJE_CALCULO_EN_CURSO_PROYECCION } from "@/lib/proyeccion/reglas";
import { bloqueosNinoDe, crecimientosDeHoy, desactualizadaDe, esMetodoVigente, ninoDeFilas } from "@/lib/proyeccion/servicio";
import { fallaDb, fallaMensaje, falla, listo, parametrosDe, proyeccionOr404, sello, type Db, type Salida } from "@/lib/proyeccion/servicio-base";
import { UMBRAL_COLA_LARGA, type Motivo } from "@/lib/proyeccion/tipos-api";
import { CacheDireccion } from "./cache";
import { leerHuella } from "./consultas";
import type { BloqueoCierreApi, BloqueosCierreApi } from "./tipos-api";

/**
 * Lo que bloquearía el cierre de una proyección en trabajo (ficha 14, §3.5, D12 y R23). NINGUNA regla se reescribe aquí: las causas salen de
 * `motivoRechazoCerrar` de M7 llamada en bucle con EXACTAMENTE los argumentos que arma `cerrarProyeccion`, con sus códigos y sus mensajes tal
 * cual, y el conteo de filas sale de `filaBloqueaCierre`. «Desactualizada» se marca forzable (en M7 se salta con «Cerrar de todos modos»).
 */

type ArgsCerrar = Parameters<typeof motivoRechazoCerrar>[0];

/** Códigos que cortan el bucle: no son causas que se puedan «apagar» para ver la siguiente. */
const CORTAN = new Set(["ya_cerrada", "archivada", "calculo_en_curso"]);
/** Como mucho nueve vueltas (§3.5): hay siete causas distintas. */
const MAX_VUELTAS = 9;

/**
 * El bucle de causas. Cada vuelta anota la causa que devuelve el cierre y la apaga para ver la siguiente; los del Niño se anotan todos de una vez
 * (`bloqueosNinoDeCierre`). `motivos` son los de `desactualizadaDe`: viajan en el detalle de «desactualizada». Puro.
 */
export function causasDeCierre(argsDeCierre: ArgsCerrar, motivos: readonly Motivo[]): BloqueoCierreApi[] {
  let a: ArgsCerrar = { ...argsDeCierre, forzar: false };
  const salida: BloqueoCierreApi[] = [];
  for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta++) {
    const r = motivoRechazoCerrar(a);
    if (r.ok) break;
    const { codigo, mensaje } = r.rechazo;
    if (CORTAN.has(codigo)) {
      salida.push({ codigo, mensaje, forzable: false });
      break;
    }
    if (codigo === "version_metodo") {
      salida.push({ codigo, mensaje, forzable: false });
      a = { ...a, metodoViejo: false };
    } else if (codigo === "crecimientos_cambiados") {
      salida.push({ codigo, mensaje, forzable: false });
      a = { ...a, crecimientosCambiados: false };
    } else if (codigo === "crecimientos_sin_aprobar") {
      salida.push({ codigo, mensaje, detalle: { crecimientos_sin_aprobar: r.crecimientos_sin_aprobar ?? null }, forzable: false });
      a = { ...a, crecimientosSinAprobar: null };
    } else if (codigo === "filas_sin_decidir") {
      salida.push({ codigo, mensaje, detalle: { total_filas_sin_decidir: r.total_filas_sin_decidir ?? 0, total_filas_para_revision: r.total_filas_para_revision ?? 0 }, forzable: false });
      a = { ...a, filasBase: [] };
    } else if (codigo === "tiendas_sin_decidir") {
      salida.push({ codigo, mensaje, detalle: { tiendas_sin_decidir: r.tiendas_sin_decidir ?? [] }, forzable: false });
      a = { ...a, tiendas: [] };
    } else if (codigo === "desactualizada") {
      salida.push({ codigo, mensaje, detalle: { motivos: motivos.map((m) => ({ codigo: m.codigo, mensaje: m.mensaje })) }, forzable: true });
      a = { ...a, desactualizada: false };
    } else {
      // Los del Niño: se anotan todos (el primero es el que respondería el cierre) y se apagan juntos.
      const nino = bloqueosNinoDeCierre(a.bloqueosNino, a.anioEnCurso);
      if (nino.length === 0) {
        // Una causa que este bucle no conoce (una regla nueva de M7): se anota tal cual y se corta, para no girar en vacío.
        salida.push({ codigo, mensaje, ...(r.detalle ? { detalle: r.detalle } : {}), forzable: false });
        break;
      }
      for (const b of nino) salida.push({ codigo: b.codigo, mensaje: b.mensaje, detalle: b.detalle, forzable: false });
      a = { ...a, bloqueosNino: undefined };
    }
  }
  return salida;
}

type ConteoAnio = Extract<BloqueosCierreApi, { aplica: true }>["filas"][number];

/** Conteo por año de las filas base que bloquean el cierre, en unidades y por motivo, registro a registro con `filaBloqueaCierre`. Puro. */
export function contarFilasQueBloquean(filasBase: ArgsCerrar["filasBase"], anioEnCurso: number, umbral: number): ConteoAnio[] {
  return [anioEnCurso, anioEnCurso + 1].map((anio) => {
    const conteo: ConteoAnio = { anio, n: 0, u: 0, por_motivo: { umbral: 0, revision_cola_larga: 0 } };
    for (const f of filasBase) {
      const registro = f.anios[anio];
      if (!registro) continue;
      const motivo = filaBloqueaCierre(registro, umbral);
      if (motivo === null) continue;
      conteo.n += 1;
      conteo.u += registro.propuesto ?? 0;
      conteo.por_motivo[motivo] += 1;
    }
    return conteo;
  });
}

/** Arma la respuesta a partir de los argumentos del cierre. Puro. */
export function armarBloqueos(args: ArgsCerrar, motivos: readonly Motivo[]): BloqueosCierreApi {
  const bloqueos = causasDeCierre(args, motivos);
  return {
    aplica: true,
    puede_cerrar: bloqueos.length === 0,
    puede_forzar: bloqueos.every((b) => b.forzable),
    bloqueos,
    // El mismo valor por defecto que usa `motivoRechazoCerrar` cuando no se le pasa el umbral.
    filas: contarFilasQueBloquean(args.filasBase, args.anioEnCurso, args.umbralColaLarga ?? UMBRAL_COLA_LARGA),
  };
}

/**
 * Los argumentos de `motivoRechazoCerrar` armados COMO LOS ARMA `cerrarProyeccion` (`src/lib/proyeccion/servicio.ts`): las mismas lecturas y las
 * mismas funciones exportadas de M7, en el mismo orden. Si `cerrarProyeccion` cambia sus argumentos, R23 (`tests/direccion.cierre.test.ts`) falla.
 */
export async function argumentosDeCierre(d: Db, p: ProyeccionDb): Promise<Salida<{ args: ArgsCerrar; motivos: Motivo[] }>> {
  const ctxR = await cargarContextoCalculo(d, { conEat: false, conFlujo: true });
  if (ctxR.respuesta) return falla(ctxR.respuesta);
  const ctx = ctxR.data;
  const vigentes = p.estado === "en_trabajo" ? await leerVigentes(d, [p.anio_en_curso + 1]) : { data: [], error: null };
  if (vigentes.error) return fallaDb(vigentes.error, "dirección: leer los crecimientos aprobados");
  const des = await desactualizadaDe(d, p, ctx, { vigentes: vigentes.data });
  if (des.respuesta) return falla(des.respuesta);

  const filas = await leerFilasConAnios(d, p.id, { columnas: "ligeras", tiendaId: null, soloActivas: true });
  if (filas.error) return fallaDb(filas.error, "dirección: leer filas");
  const tiendas = await leerTiendasProyeccion(d, p.id);
  if (tiendas.error) return fallaDb(tiendas.error, "dirección: leer tiendas");
  const parametros = parametrosDe(p.parametros);
  const crecimientosHoy = crecimientosDeHoy(p, ctx, vigentes.data, p.estado === "en_trabajo" ? ninoDeFilas(filas.data, p.anio_en_curso, ctx) : undefined);

  const args: ArgsCerrar = {
    estado: p.estado === "cerrada" ? "cerrada" : p.estado === "archivada" ? "archivada" : "en_trabajo",
    calculandoDesde: p.calculando_desde,
    ahora: sello(),
    anioEnCurso: p.anio_en_curso,
    filasBase: filas.data.map((f) => ({
      clave: f.clave,
      anios: Object.fromEntries(f.proyeccion_fila_anios.filter((a) => a.activo).map((a) => [a.anio, { clave: f.clave, propuesto: a.propuesto, decidido: a.decidido, avisos: comoAvisos(a.avisos) }])),
    })),
    tiendas: tiendas.data
      .filter((t) => t.activo && t.bloque === "nuevas")
      .map((t) => ({ tienda_id: t.tienda_id, anio: t.anio, venta_esperada: t.venta_esperada_usada === null ? null : Number(t.venta_esperada_usada), decidido: t.decidido })),
    desactualizada: des.data.length > 0,
    forzar: false,
    umbralColaLarga: parametros.umbral_cola_larga,
    metodoViejo: !esMetodoVigente(p.resumen),
    crecimientosCambiados: des.data.some((m) => m.codigo === "crecimientos_cambiados"),
    crecimientosSinAprobar: crecimientosHoy.sinAprobar,
    bloqueosNino: bloqueosNinoDe(p, ctx, des.data),
  };
  return listo({ args, motivos: des.data });
}

/** 60 s por `(proyeccion_id, huella, calculado_at)`: carga el contexto de cálculo de M7 y no debe repetirse en cada recarga del tablero. */
export const TTL_BLOQUEOS_MS = 60_000;
const cacheBloqueos = new CacheDireccion<BloqueosCierreApi>(TTL_BLOQUEOS_MS, 12);

/** Solo para pruebas. */
export const vaciarCacheBloqueos = (): void => cacheBloqueos.vaciar();

/**
 * `GET /api/direccion/bloqueos`: solo para una proyección en trabajo (en cerrada o archivada, `{ aplica: false }`). `404` si no existe;
 * `409 calculo_en_curso` mientras se calcula.
 */
export async function leerBloqueos(proyeccionId: string): Promise<Salida<BloqueosCierreApi>> {
  const d: Db = supabaseAdmin();
  const pR = await proyeccionOr404(d, proyeccionId);
  if (pR.respuesta) return falla(pR.respuesta);
  const p = pR.data;
  if (!p.activo) return fallaMensaje("Proyección no encontrada.", 404, "proyeccion_no_encontrada");
  if (p.estado !== "en_trabajo") return listo({ aplica: false });
  if (calculoEnCurso(p.calculando_desde, sello())) return fallaMensaje(MENSAJE_CALCULO_EN_CURSO_PROYECCION, 409, "calculo_en_curso");

  const huella = await leerHuella(d, p.id);
  if (huella.error) return fallaDb(huella.error, "dirección: leer la huella");
  const clave = `${p.id}|${huella.data ?? ""}|${p.calculado_at ?? ""}`;
  let respuesta: Salida<BloqueosCierreApi> | null = null;
  const r = await cacheBloqueos.obtener(clave, async () => {
    const a = await argumentosDeCierre(d, p);
    if (a.respuesta) {
      respuesta = falla(a.respuesta);
      return { data: null, error: "falla" };
    }
    return { data: armarBloqueos(a.data.args, a.data.motivos), error: null };
  });
  if (respuesta) return respuesta;
  if (r.data === null) return fallaMensaje("No se pudo comprobar qué bloquearía el cierre. Vuelve a intentarlo.", 500);
  return listo(r.data);
}
