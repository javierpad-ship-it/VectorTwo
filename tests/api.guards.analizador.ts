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

function saltarPlantilla(texto: string, desde: number): number {
  // `desde` apunta a la primera posición tras la comilla invertida de apertura; devuelve el índice del cierre.
  let i = desde;
  const n = texto.length;
  while (i < n && texto[i] !== "`") {
    if (texto[i] === "\\") {
      i += 2;
    } else if (texto[i] === "$" && texto[i + 1] === "{") {
      i = saltarExpresion(texto, i + 2);
    } else {
      i++;
    }
  }
  return i;
}

/** `desde` apunta tras `${`; devuelve el índice posterior a la `}` que la cierra. */
function saltarExpresion(texto: string, desde: number): number {
  let i = desde;
  let nivel = 0;
  const n = texto.length;
  while (i < n) {
    const c = texto[i];
    if (c === "`") {
      i = saltarPlantilla(texto, i + 1) + 1;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < n && texto[i] !== c) i += texto[i] === "\\" ? 2 : 1;
      i++;
    } else if (c === "{") {
      nivel++;
      i++;
    } else if (c === "}") {
      if (nivel === 0) return i + 1;
      nivel--;
      i++;
    } else {
      i++;
    }
  }
  return n;
}

/** Texto sin comentarios y con el contenido de las cadenas y plantillas vaciado (las comillas se conservan). */
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
    } else if (c === "`") {
      i = saltarPlantilla(texto, i + 1) + 1;
      salida += "``";
    } else if (c === '"' || c === "'") {
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

/**
 * Primera `{` tras los parámetros que abre el cuerpo y no un tipo literal del
 * retorno (`): Promise<{ a: 1 }> {`). Una `{` precedida de `:`, `|`, `&`, `<`,
 * `,` o `(` es de tipo; se salta entera.
 */
function buscarAperturaDeCuerpo(texto: string, desde: number): number {
  let i = desde;
  while (i < texto.length) {
    if (texto[i] === "{") {
      const previo = texto.slice(desde, i).trimEnd().slice(-1);
      if (!previo || !/[:|&<,(]/.test(previo)) return i;
      const fin = cierre(texto, i, "{", "}");
      if (fin < 0) return -1;
      i = fin + 1;
    } else {
      i++;
    }
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
  const abreCuerpo = buscarAperturaDeCuerpo(limpio, cierraParams + 1);
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

/** Módulo (alias `@/`) desde el que debe importarse cada función de la lista blanca. */
const moduloDe = (funcion: string): string | null => {
  const archivo = DELEGADOS[funcion];
  return archivo ? "@/" + archivo.replace(/^src\//, "").replace(/\.ts$/, "") : null;
};

const importaDe = (texto: string, funcion: string, modulo: string) =>
  new RegExp(`import\\s*\\{[^}]*\\b${funcion}\\b[^}]*\\}\\s*from\\s*["']${modulo.replace(/[/.]/g, "\\$&")}["']`).test(texto);

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

  // Si las llaves no cuadran, la limpieza se desincronizó (p. ej. una regex con comillas): no fiarse del análisis.
  const abre = limpio.split("{").length - 1;
  const cierra = limpio.split("}").length - 1;
  if (abre !== cierra) {
    violaciones.push({ archivo, metodo: "*", motivo: "no se pudo analizar el archivo (llaves desbalanceadas tras quitar comentarios y cadenas)" });
    return violaciones;
  }

  // Formas que este analizador no sabe leer: mejor fallar que dejar pasar un handler sin mirar.
  const raras = [
    ...limpio.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s+(${metodos})\\b`, "g")),
    ...limpio.matchAll(new RegExp(`export\\s+(?:const|let|var)\\s*\\{[^}]*\\b(${metodos})\\b[^}]*\\}`, "g")),
    ...limpio.matchAll(new RegExp(`export\\s*\\{[^}]*\\b(${metodos})\\b[^}]*\\}`, "g")),
    ...limpio.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s*\\*\\s*(${metodos})\\b`, "g")),
  ];
  for (const r of raras) violaciones.push({ archivo, metodo: r[1], motivo: "forma de export no soportada: usa `export async function`" });
  if (/export\s*\*/.test(limpio)) {
    violaciones.push({ archivo, metodo: "*", motivo: "`export * from` reexporta handlers que no se pueden revisar: usa `export async function`" });
  }

  const declarados = [...limpio.matchAll(new RegExp(`export\\s+(?:async\\s+)?function\\s+(${metodos})\\b`, "g"))];
  if (declarados.length === 0 && raras.length === 0) {
    violaciones.push({ archivo, metodo: "*", motivo: "el route.ts no exporta ningún método HTTP reconocible (GET, POST, ...)" });
  }

  for (const m of declarados) {
    const metodo = m[1];
    const cuerpo = cuerpoDeFuncion(limpio, metodo);
    if (cuerpo === null) {
      violaciones.push({ archivo, metodo, motivo: "no se pudo leer el cuerpo del handler" });
      continue;
    }
    const primera = primeraSentencia(cuerpo);
    if (primera.tipo === "sin_guard") {
      violaciones.push({ archivo, metodo, motivo: "la primera sentencia no es el guard (requireUser / requirePlanner / requireAdmin)" });
    } else if (primera.tipo === "delegado") {
      const modulo = moduloDe(primera.funcion);
      if (!delegadoValido(primera.funcion)) {
        violaciones.push({ archivo, metodo, motivo: `delega en ${primera.funcion}, que no está en la lista blanca de funciones con guard` });
      } else if (modulo && !importaDe(texto, primera.funcion, modulo)) {
        violaciones.push({ archivo, metodo, motivo: `delega en ${primera.funcion}, pero no la importa de ${modulo} (¿una copia local sin guard?)` });
      }
    }
  }
  return violaciones;
}

/** Texto legible de las violaciones, una por línea, para el mensaje del test. */
export function describirViolaciones(violaciones: readonly Violacion[]): string {
  return violaciones.map((v) => `  - ${v.archivo} -> ${v.metodo}: ${v.motivo}`).join("\n");
}

/** Todos los `route.*` (ts, tsx, js, mjs...) bajo `dir` (ordenados, rutas con `/`). */
export function rutasDeApi(dir: string): string[] {
  const salida: string[] = [];
  const recorrer = (d: string) => {
    for (const nombre of readdirSync(d).sort()) {
      const p = path.join(d, nombre);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (/^route\.(?:[cm]?[jt]sx?)$/.test(nombre)) salida.push(p);
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
