import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Analizador estático de los route handlers (M-7 de la auditoría de seguridad).
 * Lee el código como texto, sin ejecutarlo: quita comentarios y literales
 * (para que ni una mención en un comentario cuente como guard ni una llave en
 * una cadena desajuste el cuerpo) y mira la PRIMERA sentencia de cada handler
 * exportado. Esa sentencia debe ser el guard:
 *
 *   const { response } = await requireUser();   // o requirePlanner / requireAdmin
 *   if (response) return response;
 *
 * o bien delegar con `return f(...)` en una función de la lista blanca
 * (`DELEGADOS`), cuyo propio cuerpo se comprueba aparte con la misma regla.
 */

export const METODOS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] as const;

/** Funciones que los route handlers pueden invocar como único cuerpo porque ellas aplican el guard. */
export const DELEGADOS: Readonly<Record<string, string>> = {
  listarCatalogo: "src/lib/api/catalogo.ts",
  crearEnCatalogo: "src/lib/api/catalogo.ts",
  editarEnCatalogo: "src/lib/api/catalogo.ts",
  eliminarDeCatalogo: "src/lib/api/catalogo.ts",
  listarAgrupaciones: "src/lib/estacionalidad/agrupaciones.ts",
  crearAgrupacion: "src/lib/estacionalidad/agrupaciones.ts",
  editarAgrupacion: "src/lib/estacionalidad/agrupaciones.ts",
};

/** Texto sin comentarios y con el contenido de las cadenas vaciado (las comillas se conservan). */
export function limpiar(texto: string): string {
  let salida = "";
  let i = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    const d = texto[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && texto[i] !== "\n") i++;
    } else if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(texto[i] === "*" && texto[i + 1] === "/")) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      salida += c;
      i++;
      while (i < n && texto[i] !== c) {
        if (texto[i] === "\\") i++;
        i++;
      }
      salida += c;
      i++;
    } else {
      salida += c;
      i++;
    }
  }
  return salida;
}

/** Índice del cierre que corresponde al `abre` de la posición `desde` (que debe ser el carácter de apertura). */
function cierre(texto: string, desde: number, abre: string, cierra: string): number {
  let nivel = 0;
  for (let i = desde; i < texto.length; i++) {
    if (texto[i] === abre) nivel++;
    else if (texto[i] === cierra && --nivel === 0) return i;
  }
  return -1;
}

/** Cuerpo (entre llaves) de `export [async] function nombre(...)`, o `null` si no existe. */
export function cuerpoDeFuncion(limpio: string, nombre: string): string | null {
  const m = new RegExp(`export\\s+(?:async\\s+)?function\\s+${nombre}\\s*(?:<[^()]*>)?\\s*\\(`).exec(limpio);
  if (!m) return null;
  const abreParams = m.index + m[0].length - 1;
  const cierraParams = cierre(limpio, abreParams, "(", ")");
  if (cierraParams < 0) return null;
  const abreCuerpo = limpio.indexOf("{", cierraParams);
  if (abreCuerpo < 0) return null;
  const cierraCuerpo = cierre(limpio, abreCuerpo, "{", "}");
  if (cierraCuerpo < 0) return null;
  return limpio.slice(abreCuerpo + 1, cierraCuerpo);
}

const CIERRE_GUARD = String.raw`\s*;\s*if\s*\(\s*response\s*\)\s*return\s+response\s*;`;
const DESESTRUCTURA = String.raw`^\s*const\s*\{[^}]*\bresponse\b[^}]*\}\s*=\s*await\s+`;
const GUARD_DIRECTO = new RegExp(`${DESESTRUCTURA}(requireUser|requirePlanner|requireAdmin)\\(\\s*\\)${CIERRE_GUARD}`);
const GUARD_DE_CATALOGO = new RegExp(`${DESESTRUCTURA}cfg\\.(guardLectura|guardEscritura)\\(\\s*\\)${CIERRE_GUARD}`);
const DELEGACION = /^\s*return\s+(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/;

export type PrimeraSentencia =
  | { tipo: "guard"; guard: string }
  | { tipo: "delegado"; funcion: string }
  | { tipo: "sin_guard" };

export function primeraSentencia(cuerpo: string, permitirConfigCatalogo = false): PrimeraSentencia {
  const g = GUARD_DIRECTO.exec(cuerpo);
  if (g) return { tipo: "guard", guard: g[1] };
  if (permitirConfigCatalogo) {
    const c = GUARD_DE_CATALOGO.exec(cuerpo);
    if (c) return { tipo: "guard", guard: `cfg.${c[1]}` };
  }
  const d = DELEGACION.exec(cuerpo);
  if (d) return { tipo: "delegado", funcion: d[1] };
  return { tipo: "sin_guard" };
}

export type Violacion = { archivo: string; metodo: string; motivo: string };

/**
 * Revisa el texto de un `route.ts`. `delegadoValido(f)` dice si `f` está en la
 * lista blanca; su cuerpo se comprueba en otro lado (`violacionesDeDelegados`).
 */
export function analizarRuta(
  archivo: string,
  texto: string,
  delegadoValido: (funcion: string) => boolean = (f) => f in DELEGADOS
): Violacion[] {
  const limpio = limpiar(texto);
  const violaciones: Violacion[] = [];
  const metodos = METODOS.join("|");

  // Formas que este analizador no sabe leer: mejor fallar que dejar pasar un handler sin mirar.
  const raras = [
    ...limpio.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+(${metodos})\\b`, "g")),
    ...limpio.matchAll(new RegExp(`export\\s*\\{[^}]*\\b(${metodos})\\b[^}]*\\}`, "g")),
  ];
  for (const r of raras) violaciones.push({ archivo, metodo: r[1], motivo: "forma de export no soportada: usa `export async function`" });

  for (const m of limpio.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s+(${metodos})\\b`, "g"))) {
    const metodo = m[1];
    const cuerpo = cuerpoDeFuncion(limpio, metodo);
    if (cuerpo === null) {
      violaciones.push({ archivo, metodo, motivo: "no se pudo leer el cuerpo del handler" });
      continue;
    }
    const primera = primeraSentencia(cuerpo);
    if (primera.tipo === "sin_guard") {
      violaciones.push({ archivo, metodo, motivo: "la primera sentencia no es el guard (requireUser / requirePlanner / requireAdmin)" });
    } else if (primera.tipo === "delegado" && !delegadoValido(primera.funcion)) {
      violaciones.push({ archivo, metodo, motivo: `delega en ${primera.funcion}, que no está en la lista blanca de funciones con guard` });
    }
  }
  return violaciones;
}

/** Todos los `route.ts` bajo `dir` (ordenados, rutas con `/`). */
export function rutasDeApi(dir: string): string[] {
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const nombre of readdirSync(d).sort()) {
      const p = path.join(d, nombre);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (nombre === "route.ts") salida.push(p);
    }
  };
  recorrer(dir);
  return salida;
}

export function escanearRutas(dir: string, raiz: string = dir, delegadoValido?: (f: string) => boolean): Violacion[] {
  return rutasDeApi(dir).flatMap((p) =>
    analizarRuta(path.relative(raiz, p).split(path.sep).join("/"), readFileSync(p, "utf8"), delegadoValido)
  );
}
