import type { IndiceNodos } from "@/lib/arbol/nivel/indice";
import type {
  AsignarGmlCuerpo,
  AsignarGmlRespuesta,
  CambioMarcaBloque,
  NoPermitidaGml,
} from "../tipos-api";
import { cambioMarca, motivoRechazoAsignacion, type AsignacionGmlEntrada, type MarcaGml } from "./reglas";
import { marcasPorId } from "../conjuntos/reglas";

/**
 * Asignación de GML en bloque (02b, regla 8). `planificarAsignacionBloque` es
 * pura: el handler lee marcas, árbol y asignaciones una sola vez, la llama y
 * escribe lo que dice el plan (upsert con `ignoreDuplicates` en tandas de 500;
 * `delete … in (ids)` y `update marcas … in (ids)` en tandas de 150).
 */

export type EstadoAsignacion = {
  marcas: readonly MarcaGml[];
  nodos: IndiceNodos;
  asignaciones: readonly Pick<AsignacionGmlEntrada, "id" | "marca_id" | "genero_mundo_linea_id" | "activo">[];
};

/** El cuerpo ya validado por `asignarGmlSchema` (la nota llega normalizada: texto o `null`). */
export type CuerpoAsignacion = Extract<AsignarGmlCuerpo, { forma: "cartesiano" }> | Extract<AsignarGmlCuerpo, { forma: "pares" }>;

export type PlanAsignacion = {
  reporte: AsignarGmlRespuesta;
  /** Pares nuevos que hay que insertar, con su nota. */
  insertar: { marca_id: string; genero_mundo_linea_id: string; nota: string | null }[];
  /** Ids de asignaciones que hay que borrar (`quitar`). */
  borrar_ids: string[];
  /** Marcas que pasan a marcadas `por_gml` (las de `cambios_marca`). */
  marcar_ids: string[];
};

const clave = (marcaId: string, nodoId: string) => `${marcaId}|${nodoId}`;

/** Regla 8, paso 1: reduce las dos formas a pares únicos, en orden estable (marca, luego GML). */
export function paresDelCuerpo(cuerpo: CuerpoAsignacion): { marca_id: string; nodo_id: string }[] {
  if (cuerpo.forma === "pares") {
    const vistos = new Set<string>();
    const pares: { marca_id: string; nodo_id: string }[] = [];
    for (const p of cuerpo.pares) {
      const k = clave(p.marca_id, p.nodo_id);
      if (vistos.has(k)) continue;
      vistos.add(k);
      pares.push({ marca_id: p.marca_id, nodo_id: p.nodo_id });
    }
    return pares;
  }
  const marcas = [...new Set(cuerpo.marca_ids)];
  const nodos = [...new Set(cuerpo.nodo_ids)];
  return marcas.flatMap((marca_id) => nodos.map((nodo_id) => ({ marca_id, nodo_id })));
}

/**
 * Regla 8. `asignar`: marca o nodo inexistente o rechazo de la regla 7 →
 * `no_permitidas` (no abortan el bloque); par existente → `sin_cambio`; resto →
 * `asignadas`; `cambios_marca` = marcas con al menos una asignada y
 * `cambioMarca ≠ null`. `quitar`: existente → `quitadas`, si no `sin_cambio`
 * (nunca se rechaza por vigencia). Invariante: `pares = asignadas + sin_cambio
 * + quitadas + |no_permitidas|`. Aplicar en memoria y replanificar da
 * `asignadas = 0` y `cambios_marca = []`.
 */
export function planificarAsignacionBloque(cuerpo: CuerpoAsignacion, estado: EstadoAsignacion): PlanAsignacion {
  const pares = paresDelCuerpo(cuerpo);
  const marcas = marcasPorId(estado.marcas);
  const existentes = new Map<string, string>();
  for (const a of estado.asignaciones) {
    if (a.activo) existentes.set(clave(a.marca_id, a.genero_mundo_linea_id), a.id);
  }
  const nota = cuerpo.nota === undefined || cuerpo.nota === null || cuerpo.nota.trim() === "" ? null : cuerpo.nota.trim();

  const no_permitidas: NoPermitidaGml[] = [];
  const insertar: PlanAsignacion["insertar"] = [];
  const borrar_ids: string[] = [];
  let sin_cambio = 0;
  const conAsignada = new Map<string, MarcaGml>();

  for (const par of pares) {
    const marca = marcas.get(par.marca_id);
    const nodo = estado.nodos.get(par.nodo_id);
    const idExistente = existentes.get(clave(par.marca_id, par.nodo_id));

    if (cuerpo.accion === "quitar") {
      if (!marca || !nodo) {
        no_permitidas.push({
          marca_id: par.marca_id,
          marca: marca?.nombre ?? "",
          nodo_id: par.nodo_id,
          ruta: nodo?.ruta ?? "",
          motivo: !marca ? "marca_no_encontrada" : "nodo_no_encontrado",
        });
      } else if (idExistente) {
        borrar_ids.push(idExistente);
      } else {
        sin_cambio += 1;
      }
      continue;
    }

    const rechazo = motivoRechazoAsignacion(marca, nodo, estado.marcas);
    if (rechazo) {
      no_permitidas.push({
        marca_id: par.marca_id,
        marca: marca?.nombre ?? "",
        nodo_id: par.nodo_id,
        ruta: nodo?.ruta ?? "",
        motivo: rechazo.motivo,
        ...(rechazo.detalle ? { detalle: rechazo.detalle } : {}),
      });
      continue;
    }
    if (idExistente) {
      sin_cambio += 1;
      continue;
    }
    insertar.push({ marca_id: par.marca_id, genero_mundo_linea_id: par.nodo_id, nota });
    if (marca && !conAsignada.has(marca.id)) conAsignada.set(marca.id, marca);
  }

  const cambios_marca: CambioMarcaBloque[] = [];
  for (const marca of conAsignada.values()) {
    const cambio = cambioMarca(marca);
    if (cambio) cambios_marca.push({ marca_id: marca.id, marca: marca.nombre, de: cambio.de, a: cambio.a });
  }

  return {
    reporte: {
      accion: cuerpo.accion,
      pares: pares.length,
      asignadas: insertar.length,
      sin_cambio,
      quitadas: borrar_ids.length,
      no_permitidas,
      cambios_marca,
    },
    insertar,
    borrar_ids,
    marcar_ids: cambios_marca.map((c) => c.marca_id),
  };
}

/** Aplica el plan en memoria (para probar idempotencia sin base). No muta el estado recibido. */
export function aplicarPlanAsignacion(estado: EstadoAsignacion, plan: PlanAsignacion): EstadoAsignacion {
  const borrar = new Set(plan.borrar_ids);
  const marcar = new Set(plan.marcar_ids);
  const asignaciones = estado.asignaciones.filter((a) => !borrar.has(a.id));
  plan.insertar.forEach((p, i) => {
    asignaciones.push({
      id: `plan-asignacion-${asignaciones.length + i + 1}`,
      marca_id: p.marca_id,
      genero_mundo_linea_id: p.genero_mundo_linea_id,
      activo: true,
    });
  });
  const marcas = estado.marcas.map((m) =>
    marcar.has(m.id) ? { ...m, tratamiento_especial: true, modalidad_tratamiento: "por_gml" } : m
  );
  return { ...estado, marcas, asignaciones };
}
