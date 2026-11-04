import { readFileSync } from "node:fs";
import ts from "typescript";

/**
 * Lector de `src/lib/supabase/database.types.ts` (el formato del generador oficial de Supabase) con el compilador de TypeScript:
 * devuelve las tablas, vistas y funciones de `Database["public"]` con sus columnas/argumentos, obligatoriedad y tipo. Lo usa el test
 * de deriva (`deriva-tipos.int.test.ts`) para compararlo con el esquema real de Postgres.
 */

export type MiembroTs = { nombre: string; opcional: boolean; tipo: string };
export type RelacionTs = { Row: Map<string, MiembroTs>; Insert: Map<string, MiembroTs>; Update: Map<string, MiembroTs> };
export type FuncionTs = { args: Map<string, MiembroTs>; retorno: string };
export type TiposLeidos = {
  tablas: Map<string, RelacionTs>;
  vistas: Map<string, RelacionTs>;
  /** Una entrada por nombre; mas de una = sobrecarga. */
  funciones: Map<string, FuncionTs[]>;
  enums: Map<string, string[]>;
};

function nombreDe(n: ts.PropertyName, sf: ts.SourceFile): string {
  if (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)) return n.text;
  return n.getText(sf);
}

function miembros(tipo: ts.TypeNode | undefined, sf: ts.SourceFile): Map<string, MiembroTs> {
  const mapa = new Map<string, MiembroTs>();
  if (!tipo || !ts.isTypeLiteralNode(tipo)) return mapa;
  for (const m of tipo.members) {
    if (!ts.isPropertySignature(m) || !m.type) continue;
    const nombre = nombreDe(m.name, sf);
    mapa.set(nombre, { nombre, opcional: Boolean(m.questionToken), tipo: m.type.getText(sf).replace(/\s+/g, " ") });
  }
  return mapa;
}

function propiedad(tipo: ts.TypeNode | undefined, nombre: string, sf: ts.SourceFile): ts.TypeNode | undefined {
  if (!tipo || !ts.isTypeLiteralNode(tipo)) return undefined;
  for (const m of tipo.members) {
    if (ts.isPropertySignature(m) && nombreDe(m.name, sf) === nombre) return m.type;
  }
  return undefined;
}

function relaciones(tipo: ts.TypeNode | undefined, sf: ts.SourceFile): Map<string, RelacionTs> {
  const mapa = new Map<string, RelacionTs>();
  if (!tipo || !ts.isTypeLiteralNode(tipo)) return mapa;
  for (const m of tipo.members) {
    if (!ts.isPropertySignature(m) || !m.type) continue;
    mapa.set(nombreDe(m.name, sf), {
      Row: miembros(propiedad(m.type, "Row", sf), sf),
      Insert: miembros(propiedad(m.type, "Insert", sf), sf),
      Update: miembros(propiedad(m.type, "Update", sf), sf),
    });
  }
  return mapa;
}

function unaFuncion(tipo: ts.TypeNode, sf: ts.SourceFile): FuncionTs {
  const args = propiedad(tipo, "Args", sf);
  const retorno = propiedad(tipo, "Returns", sf);
  return { args: miembros(args, sf), retorno: retorno ? retorno.getText(sf).replace(/\s+/g, " ") : "?" };
}

function funciones(tipo: ts.TypeNode | undefined, sf: ts.SourceFile): Map<string, FuncionTs[]> {
  const mapa = new Map<string, FuncionTs[]>();
  if (!tipo || !ts.isTypeLiteralNode(tipo)) return mapa;
  for (const m of tipo.members) {
    if (!ts.isPropertySignature(m) || !m.type) continue;
    const nombre = nombreDe(m.name, sf);
    const t = m.type;
    // Las sobrecargas se emiten como uniones o como una lista de objetos; una funcion sola es un objeto.
    if (ts.isUnionTypeNode(t)) mapa.set(nombre, t.types.map((x) => unaFuncion(x, sf)));
    else if (ts.isArrayTypeNode(t) || ts.isTupleTypeNode(t)) mapa.set(nombre, []);
    else mapa.set(nombre, [unaFuncion(t, sf)]);
  }
  return mapa;
}

function enums(tipo: ts.TypeNode | undefined, sf: ts.SourceFile): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  if (!tipo || !ts.isTypeLiteralNode(tipo)) return mapa;
  for (const m of tipo.members) {
    if (!ts.isPropertySignature(m) || !m.type) continue;
    const valores = ts.isUnionTypeNode(m.type) ? m.type.types.map((x) => x.getText(sf).replace(/^"|"$/g, "")) : [m.type.getText(sf)];
    mapa.set(nombreDe(m.name, sf), valores);
  }
  return mapa;
}

export function leerTipos(ruta: string): TiposLeidos {
  const texto = readFileSync(ruta, "utf8");
  const sf = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true);
  let publico: ts.TypeNode | undefined;
  sf.forEachChild((n) => {
    if (ts.isTypeAliasDeclaration(n) && n.name.text === "Database") {
      publico = propiedad(n.type, "public", sf);
    }
  });
  if (!publico) throw new Error(`No encuentro Database["public"] en ${ruta}`);
  return {
    tablas: relaciones(propiedad(publico, "Tables", sf), sf),
    vistas: relaciones(propiedad(publico, "Views", sf), sf),
    funciones: funciones(propiedad(publico, "Functions", sf), sf),
    enums: enums(propiedad(publico, "Enums", sf), sf),
  };
}

/** Categoria de un tipo TypeScript del generador: `string | null` -> string, `Json | null` -> Json, `string[]` -> string[]. */
export function categoriaTs(tipo: string): string {
  const sinNulo = tipo
    .split("|")
    .map((t) => t.trim())
    .filter((t) => t !== "null" && t !== "undefined")
    .join(" | ");
  if (/^(string|number|boolean|Json)(\[\])?$/.test(sinNulo)) return sinNulo;
  // Literales (enums o checks): una union de cadenas es un string.
  if (/^("[^"]*"( \| )?)+$/.test(sinNulo)) return "string";
  return sinNulo;
}

export function esNuloTs(tipo: string): boolean {
  return tipo
    .split("|")
    .map((t) => t.trim())
    .includes("null");
}

/** Categoria de un tipo de Postgres (`udt_name` o nombre de tipo) como lo traduce el generador oficial de Supabase. */
export function categoriaPg(udt: string): string {
  const base = udt.startsWith("_") ? udt.slice(1) : udt;
  const arreglo = udt.startsWith("_") ? "[]" : "";
  let cat: string;
  if (["int2", "int4", "int8", "float4", "float8", "numeric", "oid", "money"].includes(base)) cat = "number";
  else if (base === "bool") cat = "boolean";
  else if (["json", "jsonb"].includes(base)) cat = "Json";
  else if (["uuid", "text", "varchar", "bpchar", "citext", "name", "date", "timestamp", "timestamptz", "time", "timetz", "interval", "bytea", "inet", "cidr", "macaddr", "tsvector", "char"].includes(base)) cat = "string";
  else cat = `?${base}`;
  return cat + arreglo;
}
