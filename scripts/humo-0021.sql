-- Humo SQL de la migración 0021 (M7 · 0.10.1, cola larga con validación de disponibilidad): la clave `disponibilidad` de
-- `venta_proyeccion` y el resto del documento intacto.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0021.sql"
--
-- Como humo-0019-0020.sql, NO necesita fixture previo: carga el suyo (nodo DENIM en GML y nodo CAMISA en GMLE; marcas ALFA,
-- ALFA JEANS (miembro de ALFA) y DELTA; tiendas T1, T2, T3, T4 y el CD; cargas 2026-07 a 2026-09). Todo inventado: nada de
-- datos reales de Lukers.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Cada comprobación imprime `ok = t`;
-- un `ok = f` es un fallo. Las sentencias que DEBEN fallar (permisos de anon) anuncian el error esperado con `\echo`.
-- Nota local: el rol `service_role` del clúster local no tiene BYPASSRLS, así que se lee como `postgres` y los permisos de
-- `service_role` se comprueban con has_function_privilege.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into generos (codigo, nombre) values ('HUMOH', 'HOMBRE HUMO');
insert into mundos (codigo, nombre) values ('HUMOU', 'URBANO HUMO');
insert into lineas (codigo, nombre, temporada) values
  ('HUMODENIM', 'DENIM HUMO', 'Todo el año'), ('HUMOCAM', 'CAMISA HUMO', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, x.nivel
from (values ('HUMODENIM', 'GML'), ('HUMOCAM', 'GMLE')) as x(lin, nivel)
join lineas l on l.codigo = x.lin
join generos g on g.codigo = 'HUMOH'
join mundos mu on mu.codigo = 'HUMOU';
insert into equivalencias (genero_mundo_linea_id, codigo, nombre)
select n.id, x.cod, x.nom
from (values ('HUMODENIM', 'HUMO-SKINNY', 'SKINNY HUMO'), ('HUMOCAM', 'HUMO-ML', 'MANGA LARGA HUMO'),
             ('HUMOCAM', 'HUMO-MC', 'MANGA CORTA HUMO')) as x(lin, cod, nom)
join lineas l on l.codigo = x.lin
join genero_mundo_linea n on n.linea_id = l.id;
insert into agrupaciones_marca (codigo, nombre) values ('HUMOPREM', 'PREMIUM HUMO'), ('HUMORECO', 'RECONOCIDO HUMO');
insert into agrupaciones_talla (codigo, nombre) values ('HUMOCEN', 'CENTRALES HUMO'), ('HUMOEXT', 'EXTREMAS HUMO');
insert into tiendas (codigo, nombre, tipo) values
  ('HUMOT1', 'T1', 'Tienda'), ('HUMOT2', 'T2', 'Tienda'), ('HUMOT3', 'T3', 'Tienda'), ('HUMOT4', 'T4', 'Tienda'),
  ('HUMOCD', 'CD', 'Centro de Distribución');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select x.cod, x.cod, a.id
from (values ('HUMOALFA', 'HUMORECO'), ('HUMODELTA', 'HUMOPREM')) as x(cod, agr)
join agrupaciones_marca a on a.codigo = x.agr;
-- ALFA JEANS es miembro del conjunto de ALFA: su venta y su stock cuentan en la agrupación de ALFA (RECONOCIDO).
insert into marcas (codigo, nombre, agrupacion_marca_id, conjunto_marca_id)
select 'HUMOALFAJ', 'HUMOALFAJ', a.id, b.id
from agrupaciones_marca a, marcas b where a.codigo = 'HUMOPREM' and b.codigo = 'HUMOALFA';
insert into cargas_venta_stock (periodo, estado, publicada_at) values
  ('2026-07-01', 'publicada', now()), ('2026-08-01', 'publicada', now()), ('2026-09-01', 'publicada', now());
-- Una carga en curso del mismo mes: no debe contar (la vista solo ve las publicadas).
insert into cargas_venta_stock (periodo, estado) values ('2026-09-01', 'en_curso');

-- Hechos (mes, marca, equivalencia, tienda, talla, unidades, stock al cierre).
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, stock_unidades)
select c.id, t.id, e.id, m.id, tl.id, x.unid, x.stk
from (values
  -- DENIM (GML) x RECONOCIDO.
  -- T1: dos tallas con stock +5 y -5: la suma por tienda es 0, NO cuenta como "con stock" aunque una talla sea positiva.
  ('2026-07-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT1', 'HUMOCEN', 10,  5),
  ('2026-07-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT1', 'HUMOEXT',  4, -5),
  ('2026-08-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT1', 'HUMOCEN', 10,  5),
  ('2026-08-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT1', 'HUMOEXT',  4, -5),
  ('2026-09-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT1', 'HUMOCEN', 10,  5),
  ('2026-09-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT1', 'HUMOEXT',  4, -5),
  -- T2: con stock en julio y agosto, sin stock en setiembre.
  ('2026-07-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT2', 'HUMOCEN', 20, 10),
  ('2026-08-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT2', 'HUMOCEN', 20, 10),
  ('2026-09-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT2', 'HUMOCEN', 20,  0),
  -- T3: vende pero nunca tiene stock al cierre.
  ('2026-07-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT3', 'HUMOCEN',  7,  0),
  ('2026-08-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT3', 'HUMOCEN',  7,  0),
  ('2026-09-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT3', 'HUMOCEN',  7,  0),
  -- T4 (clave 00001, fuera de M(Y)): con mucho stock y venta; no debe contar en nada de la disponibilidad.
  ('2026-07-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT4', 'HUMOCEN', 100, 50),
  ('2026-08-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT4', 'HUMOCEN', 100, 50),
  ('2026-09-01', 'HUMOALFA',   'HUMO-SKINNY', 'HUMOT4', 'HUMOCEN', 100, 50),
  -- CD con la marca miembro: el stock va a la agrupación de la cabeza (RECONOCIDO). Setiembre con stock 0: la fila existe.
  ('2026-07-01', 'HUMOALFAJ',  'HUMO-SKINNY', 'HUMOCD', 'HUMOCEN',  0, 30),
  ('2026-08-01', 'HUMOALFAJ',  'HUMO-SKINNY', 'HUMOCD', 'HUMOCEN',  0, 30),
  ('2026-09-01', 'HUMOALFAJ',  'HUMO-SKINNY', 'HUMOCD', 'HUMOCEN',  0,  0),
  -- CAMISA (GMLE) x PREMIUM: una fila por equivalencia.
  ('2026-07-01', 'HUMODELTA',  'HUMO-ML', 'HUMOT1', 'HUMOCEN', 3, 4),
  ('2026-08-01', 'HUMODELTA',  'HUMO-ML', 'HUMOT1', 'HUMOCEN', 3, 4),
  ('2026-09-01', 'HUMODELTA',  'HUMO-ML', 'HUMOT1', 'HUMOCEN', 3, 4),
  ('2026-08-01', 'HUMODELTA',  'HUMO-ML', 'HUMOT2', 'HUMOCEN', 1, 0),
  -- MC: T1 solo en setiembre; el CD tiene stock en agosto (mes SIN hechos de tiendas: la fila existe con tiendas_con_stock 0).
  ('2026-09-01', 'HUMODELTA',  'HUMO-MC', 'HUMOT1', 'HUMOCEN', 2, 6),
  ('2026-08-01', 'HUMODELTA',  'HUMO-MC', 'HUMOCD', 'HUMOCEN', 0, 9)
) as x(mes, mar, eq, tie, tal, unid, stk)
join cargas_venta_stock c on c.periodo = x.mes::date and c.estado = 'publicada'
join marcas m on m.codigo = x.mar
join equivalencias e on e.codigo = x.eq
join tiendas t on t.codigo = x.tie
join agrupaciones_talla tl on tl.codigo = x.tal;
-- Hecho de la carga en curso: no debe aparecer.
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, stock_unidades)
select c.id, t.id, e.id, m.id, tl.id, 999, 999
from cargas_venta_stock c, tiendas t, equivalencias e, marcas m, agrupaciones_talla tl
where c.estado = 'en_curso' and t.codigo = 'HUMOT2' and e.codigo = 'HUMO-SKINNY' and m.codigo = 'HUMOALFA' and tl.codigo = 'HUMOCEN';

create temp table r as
select public.venta_proyeccion(
  (select array_agg(id) from genero_mundo_linea where linea_id in (select id from lineas where codigo in ('HUMODENIM', 'HUMOCAM'))),
  (select jsonb_object_agg(id::text, case codigo when 'HUMOT4' then '00001' else '11111' end) from tiendas where tipo = 'Tienda'),
  array[]::uuid[],
  date '2026-07-01', date '2026-08-01') x;
create temp table d as
select (e->>'gml_id')::uuid gml, (e->>'equivalencia_id')::uuid eq, (e->>'agrupacion_marca_id')::uuid ag, (e->>'periodo')::date per,
       (e->>'tiendas_total')::int tt, (e->>'tiendas_con_stock')::int tcs, (e->>'unidades_con_stock')::int ucs, (e->>'stock_cd')::int scd,
       (select codigo from equivalencias where id = (e->>'equivalencia_id')::uuid) eq_cod,
       (select codigo from agrupaciones_marca where id = (e->>'agrupacion_marca_id')::uuid) ag_cod
from r, jsonb_array_elements(x->'disponibilidad') e;

-- ---------------------------------------------------------------------------------------------------------------------
-- Comprobaciones
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- claves del documento: las cinco anteriores mas disponibilidad (esperado ok = t)'
select (select string_agg(k, ',' order by k) from r, jsonb_object_keys(x) k) = 'cargas,detalle_w12,disponibilidad,equivalencias,filas,por_tienda' as ok;

\echo '--- tiendas_total = tiendas de tipo Tienda con 1 en la posicion Y (T1, T2, T3; T4 tiene 0): 3 en todas las filas (esperado ok = t)'
select count(*) > 0 and min(tt) = 3 and max(tt) = 3 as ok from d;

\echo '--- periodo >= p_desde_w12 (2026-08-01): sin filas de julio aunque p_desde sea julio (esperado ok = t)'
select min(per) = date '2026-08-01' as ok from d;

\echo '--- DENIM RECONOCIDO agosto: T1 stock 5 + (-5) = 0 no cuenta, T2 con stock, T3 sin stock, T4 fuera: tcs 1, ucs 20, cd 30 (esperado ok = t)'
select tcs = 1 and ucs = 20 and scd = 30 and eq is null as ok from d where eq_cod is null and ag_cod = 'HUMORECO' and per = date '2026-08-01' and gml = (select id from genero_mundo_linea where linea_id = (select id from lineas where codigo = 'HUMODENIM'));

\echo '--- DENIM RECONOCIDO setiembre: ninguna tienda con stock, cd 0 (la fila existe) (esperado ok = t)'
select tcs = 0 and ucs = 0 and scd = 0 as ok from d where eq_cod is null and ag_cod = 'HUMORECO' and per = date '2026-09-01' and gml = (select id from genero_mundo_linea where linea_id = (select id from lineas where codigo = 'HUMODENIM'));

\echo '--- CAMISA (GMLE): equivalencia_id viene informada; ML agosto: T1 con stock, T2 sin: tcs 1, ucs 3 (esperado ok = t)'
select tcs = 1 and ucs = 3 and scd = 0 and eq is not null as ok from d where eq_cod = 'HUMO-ML' and per = date '2026-08-01';

\echo '--- CAMISA MC agosto: solo stock en el CD; la fila existe con tcs 0 y stock_cd 9 (esperado ok = t)'
select tcs = 0 and ucs = 0 and scd = 9 as ok from d where eq_cod = 'HUMO-MC' and per = date '2026-08-01';

\echo '--- CAMISA MC setiembre: T1 con stock 6, cd sin fila de stock (0) (esperado ok = t)'
select tcs = 1 and ucs = 2 and scd = 0 as ok from d where eq_cod = 'HUMO-MC' and per = date '2026-09-01';

\echo '--- numero de filas: DENIM 2 meses + ML 2 + MC 2 = 6; la carga en curso (999) no aparece (esperado ok = t)'
select count(*) = 6 and coalesce(max(ucs), 0) < 999 and coalesce(max(scd), 0) < 999 as ok from d;

\echo '--- filas no cambia: el CD no aporta unidades ni stock a filas; sus sumas son las de las tiendas (esperado ok = t)'
select (select sum((f->>'unidades')::int) from r, jsonb_array_elements(x->'filas') f) =
       (select sum(v.unidades) from venta_stock_vigente v join tiendas t on t.id = v.tienda_id where t.tipo = 'Tienda' and v.periodo >= date '2026-07-01')
   and (select sum((f->>'stock_unidades')::int) from r, jsonb_array_elements(x->'filas') f) =
       (select sum(v.stock_unidades) from venta_stock_vigente v join tiendas t on t.id = v.tienda_id where t.tipo = 'Tienda' and v.periodo >= date '2026-07-01') as ok;

\echo '--- cruce directo contra venta_stock_vigente (esperado: cero diferencias) '
with base as (
  select e.genero_mundo_linea_id gml, case when n.nivel_planificacion = 'GMLE' then e.id end eq, cab.agrupacion_marca_id ag, v.periodo per,
         v.tienda_id, t.tipo, t.codigo, v.unidades, v.stock_unidades
  from venta_stock_vigente v join equivalencias e on e.id = v.equivalencia_id join genero_mundo_linea n on n.id = e.genero_mundo_linea_id
  join tiendas t on t.id = v.tienda_id join marcas_unidad mu on mu.marca_id = v.marca_id join marcas cab on cab.id = mu.unidad_marca_id
  where v.periodo >= date '2026-08-01'),
pt as (select gml, eq, ag, per, tienda_id, sum(unidades) u, sum(stock_unidades) s from base where tipo = 'Tienda' and codigo <> 'HUMOT4' group by 1, 2, 3, 4, 5),
dt as (select gml, eq, ag, per, count(*) filter (where s > 0) tcs, coalesce(sum(u) filter (where s > 0), 0) ucs from pt group by 1, 2, 3, 4),
dc as (select gml, eq, ag, per, sum(stock_unidades) scd from base where tipo <> 'Tienda' group by 1, 2, 3, 4),
dir as (select coalesce(dt.gml, dc.gml) gml, coalesce(dt.eq, dc.eq) eq, coalesce(dt.ag, dc.ag) ag, coalesce(dt.per, dc.per) per,
               coalesce(dt.tcs, 0) tcs, coalesce(dt.ucs, 0) ucs, coalesce(dc.scd, 0) scd
        from dt full join dc on dt.gml = dc.gml and dt.eq is not distinct from dc.eq and dt.ag = dc.ag and dt.per = dc.per)
select count(*) as filas_union, count(*) filter (where d.gml is null or dir.gml is null) as sin_par,
       count(*) filter (where d.gml is not null and dir.gml is not null and (d.tcs <> dir.tcs or d.ucs <> dir.ucs or d.scd <> dir.scd)) as distintas
from d full join dir on d.gml = dir.gml and d.eq is not distinct from dir.eq and d.ag = dir.ag and d.per = dir.per;

\echo '--- entradas nulas: disponibilidad vacia, sin error (esperado ok = t)'
select jsonb_array_length(public.venta_proyeccion(null, null, null, null, null)->'disponibilidad') = 0 as ok;
select jsonb_array_length(public.venta_proyeccion(array[]::uuid[], '{}'::jsonb, array[]::uuid[], date '2026-01-01', date '2026-01-01')->'disponibilidad') = 0 as ok;

\echo '--- sin p_grupos todas las tiendas quedan 00000: tiendas_total 0 y tiendas_con_stock 0, el CD sigue trayendo su stock (esperado ok = t)'
select count(*) > 0 and max(tt) = 0 and max(tcs) = 0 and sum(scd) > 0 as ok
from (select (e->>'tiendas_total')::int tt, (e->>'tiendas_con_stock')::int tcs, (e->>'stock_cd')::int scd
      from jsonb_array_elements(public.venta_proyeccion((select array_agg(id) from genero_mundo_linea), null, null, date '2026-07-01', date '2026-08-01')->'disponibilidad') e) z;

\echo '--- propiedades de la funcion: stable, security invoker, search_path vacio, service_role si (esperado ok = t)'
select p.provolatile = 's' and not p.prosecdef and p.proconfig = array['search_path=""'] as ok from pg_proc p where p.proname = 'venta_proyeccion';
select has_function_privilege('service_role', 'public.venta_proyeccion(uuid[], jsonb, uuid[], date, date)', 'execute') as service_role_ok,
       not has_function_privilege('anon', 'public.venta_proyeccion(uuid[], jsonb, uuid[], date, date)', 'execute') as anon_sin_acceso,
       not has_function_privilege('authenticated', 'public.venta_proyeccion(uuid[], jsonb, uuid[], date, date)', 'execute') as authenticated_sin_acceso;

\echo '--- permisos: anon no ejecuta (esperado ERROR permission denied for function venta_proyeccion)'
savepoint s;
set local role anon;
select public.venta_proyeccion(array[]::uuid[], '{}'::jsonb, array[]::uuid[], date '2026-01-01', date '2026-01-01');
rollback to savepoint s;

\echo '--- comment on column venta_esperada_promedio con el significado nuevo (esperado ok = t)'
select col_description('public.tiendas'::regclass, (select attnum from pg_attribute where attrelid = 'public.tiendas'::regclass and attname = 'venta_esperada_promedio')) like '%anio de apertura%' as ok;

rollback;
