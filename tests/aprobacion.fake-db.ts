import { clienteIaFalso, estado, reiniciar as reiniciarIa, sembrar, type Fila } from "./ia.fake-db";

/**
 * Base falsa de la aprobación en bloque (ficha 07g). Envuelve la base falsa de la propuesta con IA (que a su vez envuelve la de M7) y le añade la función
 * `aplicar_lote_proyeccion` (migración 0031) como un MODELO en TypeScript de lo que dice su documentación: candado, idempotencia por `lote.id` (`repetido` o
 * `LP004`), estado de la proyección (`LP001`), cálculo vivo (`LP002`), `calculado_at` (`LP003`), lote revertido (`LP005`), y por grupo la comprobación de
 * `updated_at` y de `registros_lectura` (`cambio_concurrente`, TODOS los grupos contra el estado del inicio del lote, antes de escribir el primero), de `activo` (`fila_inactiva`), del objetivo según el tipo (`ya_decidida`, `cambiada_despues`), de la propuesta
 * vigente (`ia_no_vigente`, `ia_fila_ajena`), la atomicidad (grupo `ia` entero; `metodo` y `revertir` por fila) y la lista fija de columnas (`LP007`). Calcula
 * el `resumen` con lo que de verdad escribió e inserta la cabecera AL FINAL. Lo que SQL garantiza de verdad (transacción, bloqueos, FK diferibles, triggers) lo prueba
 * el humo de `datos` (`scripts/humo-0031.sql`); aquí se prueba que TypeScript arma bien el payload y traduce bien la respuesta.
 *
 * Los `updated_at` que escribe este modelo salen de un reloj propio, de segundo en segundo, con la misma forma que devuelve la base falsa (ISO).
 */

export { estado, sembrar, type Fila };

type ErrorDb = { code: string; message: string; details: null; hint: null };
const err = (code: string, message: string): ErrorDb => ({ code, message, details: null, hint: null });

export const estadoAprobacion = {
  /** Cuántas veces se llamó a `aplicar_lote_proyeccion` y con qué payload (copia profunda). */
  llamadas: 0,
  payloads: [] as unknown[],
  /** Hace fallar la próxima llamada con ese SQLSTATE (una vez). */
  falloRpc: null as { code: string; message: string } | null,
  /** Gancho que corre justo antes de escribir (simula a otra persona que cambia algo entre la foto del servidor y la función). */
  antesDeRpc: null as null | (() => void),
  reloj: 0,
  /** H2: con `true`, cada lectura (`select`) suma a `bytes` el tamaño en JSON de lo que devolvió, por tabla; sirve para comprobar el volumen que lee una petición. */
  medir: false,
  bytes: { total: 0, porTabla: {} as Record<string, number> },
};

export function reiniciar() {
  reiniciarIa();
  estadoAprobacion.llamadas = 0;
  estadoAprobacion.payloads = [];
  estadoAprobacion.falloRpc = null;
  estadoAprobacion.antesDeRpc = null;
  estadoAprobacion.reloj = 0;
  estadoAprobacion.medir = false;
  estadoAprobacion.bytes = { total: 0, porTabla: {} };
}

const tabla = (t: string): Fila[] => (estado.tablas[t] ??= []);
const ahora = () => new Date(Date.UTC(2026, 10, 3, 12, 0, 0) + estadoAprobacion.reloj++ * 1000).toISOString();

const PERMITIDAS = [
  "bloque", "subbloque", "vendido", "propuesto", "metodo", "referencia_alternativa", "referencia_tres_meses", "explicacion", "base_siguiente", "base_normalizada", "meses",
  "origen_meses", "curva_origen_usada", "meses_propuestos", "curva_origen_propuesta", "avisos", "crecimiento_pct", "decidido", "origen", "propuesta_al_decidir", "nota", "decidido_at",
  "decidido_por_id", "decidido_por_nombre", "decision_ia_fila_id", "decision_lote_id",
];

type RegistroPayload = { id: string; updated_at_esperado: string; objetivo: boolean; set: Fila };
type FilaPayload = {
  fila_id: string;
  fila_clave: string;
  anio: number;
  fuente?: string;
  valor?: number;
  valor_esperado?: number;
  valor_actual?: number;
  decidido_anterior?: number;
  decidido_esperado?: number;
  propuesta_fila_id?: string;
  rechazo?: string;
  registros?: RegistroPayload[];
};
type GrupoPayload = { tipo: "ia" | "metodo" | "revertir"; gm_clave: string; propuesta_gm_id?: string; registros_lectura: { id: string; updated_at_esperado: string }[]; filas: FilaPayload[] };
type LotePayload = Fila & { id: string; proyeccion_id: string; tipo: string; revierte_lote_id?: string; huella_cuerpo: string; calculado_at_esperado: string; anio: number };

class ErrorLote extends Error {
  constructor(public readonly code: string, mensaje: string) {
    super(mensaje);
  }
}

function respuesta(loteId: string, repetido: boolean) {
  const lote = tabla("proyeccion_lotes").find((l) => l.id === loteId) as Fila;
  const filas = tabla("proyeccion_lote_filas")
    .filter((f) => f.lote_id === loteId)
    .sort((a, b) => String(a.gm_clave).localeCompare(String(b.gm_clave)) || String(a.fila_clave).localeCompare(String(b.fila_clave)) || (a.anio as number) - (b.anio as number))
    .map((f) => ({
      fila_id: f.fila_id,
      fila_clave: f.fila_clave,
      anio: f.anio,
      gm_clave: f.gm_clave,
      fuente: f.fuente,
      resultado: f.resultado === "aplicada" ? "aplicada" : "rechazada",
      codigo: f.resultado === "aplicada" ? null : f.resultado,
      valor: f.valor,
      valor_actual: f.valor_actual,
    }));
  return { lote_id: loteId, repetido, resumen: lote.resumen, filas };
}

/** La propuesta vigente de un GM: `created_at desc, id asc` (el orden de `leerPropuestaVigenteDeGM`). */
function vigenteDe(proyeccionId: string, gm: string): string | null {
  const todas = tabla("ia_propuestas_gm").filter((p) => p.proyeccion_id === proyeccionId && p.gm_clave === gm);
  todas.sort((a, b) => (a.created_at === b.created_at ? String(a.id).localeCompare(String(b.id)) : String(a.created_at) < String(b.created_at) ? 1 : -1));
  return (todas[0]?.id as string | undefined) ?? null;
}

function aplicar(p: { lote: LotePayload; grupos: GrupoPayload[] }): { data: unknown; error: ErrorDb | null } {
  estadoAprobacion.llamadas += 1;
  estadoAprobacion.payloads.push(JSON.parse(JSON.stringify(p)));
  if (estadoAprobacion.falloRpc) {
    const e = estadoAprobacion.falloRpc;
    estadoAprobacion.falloRpc = null;
    return { data: null, error: err(e.code, e.message) };
  }
  estadoAprobacion.antesDeRpc?.();
  const lote = p.lote;
  const proy = tabla("proyecciones").find((x) => x.id === lote.proyeccion_id);
  if (!proy) return { data: null, error: err("LP006", "proyeccion_no_encontrada") };
  const previo = tabla("proyeccion_lotes").find((l) => l.id === lote.id);
  if (previo) {
    if (previo.proyeccion_id === proy.id && previo.huella_cuerpo === lote.huella_cuerpo) return { data: respuesta(lote.id, true), error: null };
    return { data: null, error: err("LP004", "lote_ajeno") };
  }
  if (proy.estado !== "en_trabajo") return { data: null, error: err("LP001", `proyeccion_${String(proy.estado)}`) };
  if (proy.calculando_desde && Date.parse(proy.calculando_desde as string) > Date.now() - 15 * 60_000) return { data: null, error: err("LP002", "calculo_en_curso") };
  if (!proy.calculado_at || proy.calculado_at !== lote.calculado_at_esperado) return { data: null, error: err("LP003", "datos_cambiaron") };
  if (lote.tipo === "revertir") {
    const rev = tabla("proyeccion_lotes").find((l) => l.id === lote.revierte_lote_id);
    if (!rev || rev.proyeccion_id !== proy.id || !["aprobar", "reaprobar"].includes(rev.tipo as string)) return { data: null, error: err("LP005", "no_revertible") };
  }

  // «Transacción»: lo que cambie se deshace si algo lanza (LP007, LP008).
  const copia = JSON.parse(JSON.stringify({ a: tabla("proyeccion_fila_anios"), f: tabla("proyeccion_lote_filas") })) as { a: Fila[]; f: Fila[] };
  try {
    const delProy = (id: string): Fila | undefined => {
      const a = tabla("proyeccion_fila_anios").find((x) => x.id === id);
      if (!a) return undefined;
      const fila = tabla("proyeccion_filas").find((f) => f.id === a.fila_id);
      return fila?.proyeccion_id === proy.id ? a : undefined;
    };
    const lineas: Fila[] = [];
    // Fase 1 (H1): TODOS los grupos se comprueban contra el estado del INICIO del lote, antes de escribir el primero. Así las escrituras propias del lote
    // (p. ej. el `Y+1` que un grupo de método reescribe) no invalidan los `registros_lectura` de otro grupo, y el orden de los grupos no cambia el resultado.
    // Un cambio de terceros sí: sigue dando `cambio_concurrente`, con la misma atomicidad por tipo de grupo (el grupo `ia` entero; `metodo` y `revertir` por fila).
    const evaluados = p.grupos.map((g) => {
      if (!["ia", "metodo", "revertir"].includes(g.tipo) || (g.tipo === "revertir") !== (lote.tipo === "revertir")) throw new ErrorLote("LP007", "payload_invalido: tipo de grupo incoherente con el tipo de lote");
      const lecturaMal = g.registros_lectura.some((l) => {
        const r = delProy(l.id);
        return !r || r.updated_at !== l.updated_at_esperado;
      });
      let codigoGrupo: string | null = null;
      if (lecturaMal) codigoGrupo = "cambio_concurrente";
      else if (g.tipo === "ia" && vigenteDe(proy.id as string, g.gm_clave) !== (g.propuesta_gm_id ?? null)) codigoGrupo = "ia_no_vigente";

      const codigos: (string | null)[] = [];
      for (const f of g.filas) {
        let cf: string | null = f.rechazo ?? null;
        if (cf === null) {
          let objetivos = 0;
          for (const r of f.registros ?? []) {
            const llaves = Object.keys(r.set ?? {});
            if (llaves.some((k) => !PERMITIDAS.includes(k))) throw new ErrorLote("LP007", "payload_invalido: columna fuera de la lista fija de set");
            const idLote = r.set?.decision_lote_id;
            if (idLote !== undefined && idLote !== null && (lote.tipo === "revertir" || idLote !== lote.id)) throw new ErrorLote("LP007", "payload_invalido: decision_lote_id solo puede ser null o el id del lote");
            const a = delProy(r.id);
            if (!a) {
              cf ??= "cambio_concurrente";
              if (r.objetivo) objetivos += 1;
              continue;
            }
            if (a.fila_id !== f.fila_id) throw new ErrorLote("LP007", "payload_invalido: un registro no es de la fila indicada");
            if (r.objetivo) {
              objetivos += 1;
              if (a.anio !== f.anio) throw new ErrorLote("LP007", "payload_invalido: el registro objetivo no es del anio de la fila");
            }
            if (cf === null && a.updated_at !== r.updated_at_esperado) cf = "cambio_concurrente";
            if (cf === null && !a.activo) cf = "fila_inactiva";
            if (cf === null && r.objetivo) {
              if (lote.tipo === "aprobar") {
                if (a.decidido !== null && a.decidido !== undefined) cf = "ya_decidida";
              } else if (lote.tipo === "reaprobar") {
                if (!a.decision_lote_id || a.decidido !== (f.decidido_esperado ?? null)) cf = "cambiada_despues";
              } else if ((a.decision_lote_id ?? null) !== lote.revierte_lote_id) cf = "cambiada_despues";
            }
          }
          if (objetivos !== 1) throw new ErrorLote("LP007", "payload_invalido: cada fila lleva exactamente un registro objetivo");
          if (cf === null && g.tipo === "ia") {
            const pf = tabla("ia_propuestas_filas").find((x) => x.id === f.propuesta_fila_id);
            if (!f.propuesta_fila_id || !g.propuesta_gm_id || !pf || pf.propuesta_gm_id !== g.propuesta_gm_id) cf = "ia_fila_ajena";
          }
        }
        codigos.push(cf);
      }
      return { g, codigoGrupo, codigos, falla: codigos.some((c) => c !== null) };
    });

    // Fase 2: se escribe lo que pasó, grupo a grupo (el `updated_at` nuevo ya no se compara con nada: todo se comprobó arriba).
    for (const { g, codigoGrupo, codigos, falla } of evaluados) {
      g.filas.forEach((f, i) => {
        let cf = codigos[i];
        if (cf === null) {
          if (codigoGrupo !== null) cf = codigoGrupo;
          else if (g.tipo === "ia" && falla) cf = "grupo_rechazado";
        }
        if (cf === null) {
          for (const r of f.registros ?? []) {
            const a = delProy(r.id) as Fila;
            Object.assign(a, r.set, { updated_at: ahora() });
            if (a.decision_lote_id && (a.decidido === null || a.decidido === undefined)) throw new ErrorLote("23514", "violates check constraint proyeccion_fila_anios_decision_lote_check");
          }
        }
        lineas.push({
          lote_id: lote.id,
          fila_id: tabla("proyeccion_filas").some((x) => x.id === f.fila_id) ? f.fila_id : null,
          fila_clave: f.fila_clave,
          gm_clave: g.gm_clave,
          anio: f.anio,
          fuente: f.fuente ?? g.tipo,
          resultado: cf ?? "aplicada",
          valor: f.valor ?? null,
          valor_esperado: f.valor_esperado ?? null,
          valor_actual: f.valor_actual ?? null,
          decidido_anterior: f.decidido_anterior ?? null,
          propuesta_fila_id: f.propuesta_fila_id ?? null,
        });
      });
    }
    for (const l of lineas) tabla("proyeccion_lote_filas").push({ id: `lf-${tabla("proyeccion_lote_filas").length + 1}`, created_at: ahora(), ...l });
    const aplicadas = lineas.filter((l) => l.resultado === "aplicada");
    const rechazadas: Record<string, number> = {};
    for (const l of lineas) if (l.resultado !== "aplicada") rechazadas[l.resultado as string] = (rechazadas[l.resultado as string] ?? 0) + 1;
    const porFuente: Record<string, { filas: number; unidades: number }> = { ia: { filas: 0, unidades: 0 }, metodo: { filas: 0, unidades: 0 } };
    for (const l of aplicadas) {
      const x = (porFuente[l.fuente as string] ??= { filas: 0, unidades: 0 });
      x.filas += 1;
      x.unidades += (l.valor as number | null) ?? 0;
    }
    tabla("proyeccion_lotes").push({
      id: lote.id,
      confirmacion_id: lote.confirmacion_id,
      proyeccion_id: proy.id,
      tipo: lote.tipo,
      revierte_lote_id: lote.revierte_lote_id ?? null,
      anio: lote.anio,
      huella_cuerpo: lote.huella_cuerpo,
      calculado_at_proyeccion: proy.calculado_at,
      filtro: lote.filtro ?? {},
      resumen: { pedidas: lineas.length, aplicadas: aplicadas.length, rechazadas, por_fuente: porFuente },
      efecto_gm_previsto: lote.efecto_gm_previsto ?? [],
      revision_confirmada: lote.revision_confirmada ?? false,
      propuestas_gm: lote.propuestas_gm ?? [],
      nota: lote.nota ?? null,
      perfil_id: lote.perfil_id ?? null,
      usuario_nombre: lote.usuario_nombre ?? null,
      created_at: ahora(),
    });
    return { data: respuesta(lote.id, false), error: null };
  } catch (e) {
    estado.tablas.proyeccion_fila_anios = copia.a;
    estado.tablas.proyeccion_lote_filas = copia.f;
    if (e instanceof ErrorLote) return { data: null, error: err(e.code, e.message) };
    throw e;
  }
}

type ConsultaMedible = { then: (ok?: (r: { data: unknown }) => unknown, ko?: (e: unknown) => unknown) => unknown };

export function clienteAprobacionFalso() {
  const base = clienteIaFalso();
  return {
    from: (t: string) => {
      const q = base.from(t);
      if (!estadoAprobacion.medir) return q;
      const c = q as unknown as ConsultaMedible;
      const original = c.then.bind(c);
      c.then = (ok, ko) =>
        original((r) => {
          const n = JSON.stringify(r.data ?? null).length;
          estadoAprobacion.bytes.total += n;
          estadoAprobacion.bytes.porTabla[t] = (estadoAprobacion.bytes.porTabla[t] ?? 0) + n;
          return ok ? ok(r) : r;
        }, ko);
      return q;
    },
    rpc: (nombre: string, args: Record<string, unknown>) => (nombre === "aplicar_lote_proyeccion" ? Promise.resolve(aplicar(args.p as never)) : base.rpc(nombre, args)),
  };
}
