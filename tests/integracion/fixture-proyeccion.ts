import type { Client } from "pg";
import { escalar, filas, sembrarBase, type Base } from "./ayudas";

/**
 * Fixture de proyeccion compartido por las pruebas de integracion: una proyeccion en trabajo con 4 filas x 2 anios, una segunda
 * proyeccion, y una propuesta vigente de IA con sus filas. Datos inventados.
 */

export const FORMATO_ISO = `to_char(%s at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')`;
export const iso = (col: string) => FORMATO_ISO.replace("%s", `(${col})`);

export type Registro = { id: string; iso: string; isoMas1: string };

export type Escenario = {
  b: Base;
  proy: string;
  proyB: string;
  calculadoIso: string;
  calculadoIsoB: string;
  registros: Map<string, Registro>;
  vigente: string;
  propFilas: Map<string, string>;
};

export const clave = (ns: number, k: number) => `IT${ns}-F${k}`;

export async function sembrarProyeccion(c: Client, ns: number): Promise<Escenario> {
  const b = await sembrarBase(c, ns);
  const ag = await c.query<{ id: string }>("insert into public.agrupaciones_marca (codigo, nombre) values ($1, $2) returning id", [`AG${ns}`, `AGRUPACION ${ns}`]);
  const insertarProy = async (nombre: string, calculado: string) =>
    (
      await c.query<{ id: string }>(
        "insert into public.proyecciones (anio_en_curso, nombre, hasta_periodo, parametros, calculado_at) values (2026, $1, date '2026-09-01', '{}'::jsonb, $2::timestamptz) returning id",
        [nombre, calculado]
      )
    ).rows[0].id;
  const proy = await insertarProy(`IT PROY ${ns}`, "2026-11-01 09:00:00.654321+00");
  const proyB = await insertarProy(`IT PROY B ${ns}`, "2026-11-01 09:00:00.111111+00");

  for (let k = 1; k <= 4; k++) {
    const f = await c.query<{ id: string }>(
      "insert into public.proyeccion_filas (proyeccion_id, gml_id, agrupacion_marca_id, clave, nivel_proyectado, historico) values ($1, $2, $3, $4, 'GML', '{}'::jsonb) returning id",
      [proy, b.gml, ag.rows[0].id, clave(ns, k)]
    );
    for (const anio of [2026, 2027]) {
      await c.query(
        "insert into public.proyeccion_fila_anios (fila_id, anio, bloque, vendido, propuesto, metodo, updated_at) values ($1, $2, 'mismas', 100, $3, 'avance', timestamptz '2026-11-01 08:00:00.100000+00' + $4 * interval '1 millisecond' + interval '37 microseconds')",
        [f.rows[0].id, anio, anio === 2026 ? 1000 : 1100, k * 10 + (anio - 2026)]
      );
    }
  }

  // IA: una corrida completa con un GM hecho y una propuesta vigente con sus filas.
  const corrida = await c.query<{ id: string }>(
    "insert into public.ia_corridas (tipo, proyeccion_id, proveedor, modelo, version_prompt, alcance, costo_estimado_usd, estado) values ('propuesta', $1, 'proveedor-x', 'modelo-1', 'v1', '{}'::jsonb, 0, 'completa') returning id",
    [proy]
  );
  const cgm = await c.query<{ id: string }>("insert into public.ia_corrida_gms (corrida_id, gm_clave, estado) values ($1, 'GM-UNO', 'hecho') returning id", [corrida.rows[0].id]);
  const prop = await c.query<{ id: string }>(
    `insert into public.ia_propuestas_gm (corrida_id, corrida_gm_id, proyeccion_id, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo, version_metodo, huella_gm, huella_historia, filas_pedidas, filas_validas, proveedor, modelo, version_prompt, created_at)
     select $1, $2, $3, 'GM-UNO', g.id, m.id, false, array['distribucion_y1'], 'directo', 5, repeat('1', 64), repeat('2', 64), 4, 4, 'proveedor-x', 'modelo-1', 'v1', timestamptz '2026-11-01 10:00:00+00'
       from public.generos g, public.mundos m where g.codigo = $4 and m.codigo = $5 returning id`,
    [corrida.rows[0].id, cgm.rows[0].id, proy, `Git${ns}`, `Mit${ns}`]
  );
  await c.query(
    "insert into public.ia_propuestas_filas (propuesta_gm_id, fila_id, fila_clave, estado_meta) select $1, f.id, f.clave, 'libre' from public.proyeccion_filas f where f.proyeccion_id = $2",
    [prop.rows[0].id, proy]
  );
  const pf = await filas<{ fila_clave: string; id: string }>(c, "select fila_clave, id from public.ia_propuestas_filas where propuesta_gm_id = $1", [prop.rows[0].id]);

  const recs = await filas<{ clave: string; anio: number; id: string; iso: string; iso1: string }>(
    c,
    `select f.clave, a.anio, a.id, ${iso("a.updated_at")} as iso, ${iso("a.updated_at + interval '1 microsecond'")} as iso1
       from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id where f.proyeccion_id = $1`,
    [proy]
  );
  const registros = new Map<string, Registro>();
  for (const r of recs) registros.set(`${r.clave}|${r.anio}`, { id: r.id, iso: r.iso, isoMas1: r.iso1 });

  return {
    b,
    proy,
    proyB,
    calculadoIso: await escalar<string>(c, `select ${iso("calculado_at")} from public.proyecciones where id = $1`, [proy]),
    calculadoIsoB: await escalar<string>(c, `select ${iso("calculado_at")} from public.proyecciones where id = $1`, [proyB]),
    registros,
    vigente: prop.rows[0].id,
    propFilas: new Map(pf.map((x) => [x.fila_clave, x.id])),
  };
}
