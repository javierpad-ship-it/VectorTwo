/**
 * Funciones puras de pantalla de M1b (sin React ni dependencias de servidor).
 * Consumen el JSON de `GET /api/responsables` tal como llega; la definición
 * de "faltante" es la del servidor (`celda.faltante` / `motivo_faltante`), no
 * se recalcula aquí. Probadas en `tests/responsables.pantalla.test.ts`.
 */
import { planificarBloque } from "./reglas";
import type { CargaResponsable, CeldaResponsable, CombinacionRef, CompradorAsignable, ResumenResponsables } from "./tipos-api";

// ─── Claves, índices y nombres ───

export function claveCelda(generoId: string, mundoId: string): string {
  return `${generoId}|${mundoId}`;
}

export function indexarCeldas(celdas: readonly CeldaResponsable[]): Map<string, CeldaResponsable> {
  return new Map(celdas.map((c) => [claveCelda(c.genero_id, c.mundo_id), c]));
}

/** Nombre del perfil, o su correo si no tiene nombre. */
export function nombreVisible(p: { nombre: string | null; email: string }): string {
  return p.nombre?.trim() || p.email;
}

/** Orden alfabético en español (sin acentos ni mayúsculas, números naturales). */
export function compararNombres(a: string, b: string): number {
  return a.localeCompare(b, "es", { sensitivity: "base", numeric: true });
}

export function ordenarCompradores(compradores: readonly CompradorAsignable[]): CompradorAsignable[] {
  return [...compradores].sort((a, b) => compararNombres(nombreVisible(a), nombreVisible(b)) || a.email.localeCompare(b.email));
}

// ─── Texto de una celda ───

export type TextoResponsable = { texto: string; tono: "normal" | "alerta" };

/**
 * Lo que se dice del responsable de una celda: su nombre, o el motivo en
 * tono alerta ("Sin responsable", "ANA · desactivado", "ANA · ya no es
 * comprador"). Una celda no vigente sin responsable no dice nada.
 */
export function textoResponsable(celda: CeldaResponsable | null | undefined): TextoResponsable | null {
  if (!celda) return null;
  const r = celda.responsable;
  if (!r) return celda.vigente ? { texto: "Sin responsable", tono: "alerta" } : null;
  const nombre = nombreVisible(r);
  if (celda.motivo_faltante === "responsable_inactivo") return { texto: `${nombre} · desactivado`, tono: "alerta" };
  if (celda.motivo_faltante === "responsable_no_comprador") return { texto: `${nombre} · ya no es comprador`, tono: "alerta" };
  return { texto: nombre, tono: "normal" };
}

/** "12 líneas" / "1 línea" / "sin líneas". */
export function textoLineas(n: number): string {
  if (n <= 0) return "sin líneas";
  return `${n.toLocaleString("es-PE")} ${n === 1 ? "línea" : "líneas"}`;
}

/** ¿La celda tiene un responsable que cuenta (vigente, activo y comprador)? */
export function tieneResponsableValido(c: CeldaResponsable): boolean {
  return c.vigente && c.responsable !== null && !c.faltante;
}

/** Texto de las opciones del selector de una celda cuyo responsable actual ya no es válido. */
export function etiquetaResponsableNoValido(c: CeldaResponsable): string | null {
  const r = c.responsable;
  if (!r || c.motivo_faltante === null || c.motivo_faltante === "sin_responsable") return null;
  const nombre = nombreVisible(r);
  return c.motivo_faltante === "responsable_inactivo" ? `${nombre} (desactivado)` : `${nombre} (ya no es comprador)`;
}

// ─── Encabezados de fila y columna ───

/** "con responsable / vigentes" de un género o de un mundo (la fila "5/5", la columna "7/8"). */
export function conteoEje(
  celdas: readonly CeldaResponsable[],
  eje: { genero_id: string } | { mundo_id: string }
): { con: number; total: number } {
  let con = 0;
  let total = 0;
  for (const c of celdas) {
    if ("genero_id" in eje ? c.genero_id !== eje.genero_id : c.mundo_id !== eje.mundo_id) continue;
    if (!c.vigente) continue;
    total++;
    if (!c.faltante) con++;
  }
  return { con, total };
}

// ─── Resumen ───

/** "1 sin responsable · 1 responsable desactivado · 1 responsable ya no es comprador" (solo lo que no es cero). */
export function desgloseFaltantes(r: ResumenResponsables): string {
  const partes: string[] = [];
  if (r.faltantes_sin_responsable > 0) partes.push(`${r.faltantes_sin_responsable} sin responsable`);
  if (r.faltantes_responsable_inactivo > 0) {
    partes.push(`${r.faltantes_responsable_inactivo} ${r.faltantes_responsable_inactivo === 1 ? "responsable desactivado" : "responsables desactivados"}`);
  }
  if (r.faltantes_responsable_no_comprador > 0) {
    partes.push(
      `${r.faltantes_responsable_no_comprador} ${r.faltantes_responsable_no_comprador === 1 ? "responsable ya no es comprador" : "responsables ya no son compradores"}`
    );
  }
  return partes.join(" · ");
}

/** Por qué una fila de "Carga por responsable" no es válida (a partir de sus celdas), o null si lo es. */
export function motivoCargaNoValida(carga: CargaResponsable, celdas: readonly CeldaResponsable[]): string | null {
  if (carga.valido) return null;
  const r = celdas.find((c) => c.responsable?.id === carga.perfil_id)?.responsable;
  if (r && !r.activo) return "desactivado";
  return "ya no es comprador";
}

// ─── Asignación en bloque ───

/** Fila (`genero_id`), columna (`mundo_id`) o toda la matriz. */
export type AmbitoBloque = "todas" | { genero_id: string } | { mundo_id: string };

/** Las combinaciones vigentes del ámbito: las no vigentes nunca entran. */
export function celdasDelAmbito(celdas: readonly CeldaResponsable[], ambito: AmbitoBloque): CeldaResponsable[] {
  return celdas.filter((c) => {
    if (!c.vigente) return false;
    if (ambito === "todas") return true;
    return "genero_id" in ambito ? c.genero_id === ambito.genero_id : c.mundo_id === ambito.mundo_id;
  });
}

export type PlanBloque = {
  /** Combinaciones vigentes del ámbito: lo que se manda al servidor (las calcula `planificarBloque`). */
  combinaciones: CombinacionRef[];
  /** Cuántas son (`combinaciones.length`). */
  total: number;
  /** Las que se escribirán (asignar o quitar). */
  aplicar: number;
  /** De las que se escriben, las que ya tenían un responsable válido distinto (se pisan solo con la casilla). */
  reemplazos: number;
  /** Con responsable válido que no se tocan por tener la casilla apagada. */
  respetadas: number;
  /** Ya tenían ese responsable (o no tenían y se pide quitar). */
  sinCambio: number;
};

/**
 * Lo que va a pasar al aplicar un bloque, para el texto del panel y el
 * `confirm`. `perfilId = null` es "quitar". Replica la regla del servidor
 * (`planificarAsignacion`): con la casilla apagada no se pisa un responsable
 * válido; uno desactivado o que ya no es comprador sí se reemplaza.
 */
export function planBloque(
  celdas: readonly CeldaResponsable[],
  ambito: AmbitoBloque,
  opciones: { perfilId: string | null; reemplazar: boolean }
): PlanBloque {
  const delAmbito = celdasDelAmbito(celdas, ambito);
  const { combinaciones } = planificarBloque([...celdas], ambito, { soloFaltantes: !opciones.reemplazar });
  const plan: PlanBloque = { combinaciones, total: combinaciones.length, aplicar: 0, reemplazos: 0, respetadas: 0, sinCambio: 0 };
  for (const c of delAmbito) {
    if (opciones.perfilId === null) {
      if (c.responsable) {
        plan.aplicar++;
        if (tieneResponsableValido(c)) plan.reemplazos++;
      } else plan.sinCambio++;
    } else if (c.responsable?.id === opciones.perfilId) {
      plan.sinCambio++;
    } else if (tieneResponsableValido(c)) {
      if (opciones.reemplazar) {
        plan.aplicar++;
        plan.reemplazos++;
      } else plan.respetadas++;
    } else {
      plan.aplicar++;
    }
  }
  return plan;
}

function plural(n: number, singular: string, pluralTxt: string): string {
  return `${n.toLocaleString("es-PE")} ${n === 1 ? singular : pluralTxt}`;
}

/**
 * "Se asignarán 3 de 5 combinaciones de HOMBRE (2 ya tienen responsable y no
 * se tocan)". `ambito` es el nombre del género/mundo o "la matriz completa".
 */
export function describirPlan(plan: PlanBloque, ambito: string, comprador: string | null): string {
  const de = `de ${plural(plan.total, "combinación", "combinaciones")} ${ambito}`;
  const notas: string[] = [];
  if (comprador === null) {
    if (plan.sinCambio > 0) notas.push(`${plan.sinCambio} ya no tienen responsable`);
    return `Se quitará el responsable a ${plan.aplicar} ${de}${notas.length ? ` (${notas.join("; ")})` : ""}.`;
  }
  if (plan.respetadas > 0) {
    notas.push(`${plan.respetadas} ${plan.respetadas === 1 ? "ya tiene responsable y no se toca" : "ya tienen responsable y no se tocan"}`);
  }
  if (plan.reemplazos > 0) {
    notas.push(plan.reemplazos === 1 ? "se reemplazará 1 responsable" : `se reemplazarán ${plan.reemplazos} responsables`);
  }
  if (plan.sinCambio > 0) {
    notas.push(`${plan.sinCambio} ${plan.sinCambio === 1 ? "ya es" : "ya son"} de ${comprador}`);
  }
  return `Se asignarán ${plan.aplicar} ${de}${notas.length ? ` (${notas.join("; ")})` : ""}.`;
}

/** Por qué el botón de aplicar está deshabilitado, o null si se puede aplicar. */
export function motivoBloqueoBloque(
  plan: PlanBloque,
  opciones: { elegido: boolean; quitar: boolean; reemplazar: boolean }
): string | null {
  if (!opciones.elegido) return "Elige un comprador o “Quitar responsable”.";
  if (opciones.quitar && !opciones.reemplazar) return "No se puede quitar el responsable solo a las faltantes.";
  if (plan.total === 0) return "No hay combinaciones vigentes en este ámbito.";
  if (plan.aplicar === 0) return "No hay nada que cambiar.";
  return null;
}

/** Texto del aviso tras aplicar un bloque. */
export function describirResultado(
  r: { asignadas: number; quitadas: number; sin_cambio: number; con_responsable: number; no_encontradas: unknown[]; no_vigentes: unknown[] },
  quitar: boolean
): string {
  const partes: string[] = [];
  if (quitar) partes.push(plural(r.quitadas, "combinación quedó sin responsable", "combinaciones quedaron sin responsable"));
  else partes.push(plural(r.asignadas, "combinación asignada", "combinaciones asignadas"));
  if (r.sin_cambio > 0) partes.push(`${r.sin_cambio} sin cambio`);
  if (r.con_responsable > 0) partes.push(`${r.con_responsable} con responsable (no se tocaron)`);
  if (r.no_vigentes.length > 0) partes.push(plural(r.no_vigentes.length, "no vigente", "no vigentes"));
  if (r.no_encontradas.length > 0) partes.push(plural(r.no_encontradas.length, "ya no existe", "ya no existen"));
  return `${partes.join(" · ")}.`;
}

// ─── Parámetros de URL ───

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?responsable=<id>`: solo se acepta un UUID (viene de la URL, que escribe cualquiera). */
export function leerResponsableParam(v: string | string[] | undefined): string | undefined {
  const valor = Array.isArray(v) ? v[0] : v;
  return valor && UUID.test(valor) ? valor : undefined;
}
