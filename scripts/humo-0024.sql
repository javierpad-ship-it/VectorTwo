-- Humo SQL de la migración 0024 (M12): `repartos_marca_barrido.temporadas_usadas` (default de la decisión 31, check de forma,
-- no nulo, permisos heredados, idempotencia del `add column if not exists`).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0024.sql"
--
-- NO necesita fixture previo: carga el suyo (una agrupación y una marca). Todo inventado: nada de datos reales de Lukers.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Cada comprobación imprime `ok = t`;
-- un `ok = f` es un fallo. Las sentencias que DEBEN fallar anuncian el error esperado con `\echo`.
-- Cada una va entre `savepoint` y `rollback to savepoint` para que el error no aborte la transacción.
\set ON_ERROR_STOP off
\pset pager off
begin;

insert into agrupaciones_marca (codigo, nombre) values ('HUMO24AG', 'AGRUPACION HUMO 24');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select 'HUMO24M', 'MARCA HUMO 24', id from agrupaciones_marca where codigo = 'HUMO24AG';

-- 1. Una fila SIN indicar la columna toma el default (mismas claves y meses que TEMPORADAS_DEFECTO de tipos-api.ts).
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config)
select id, 1, 24, 'por_temporada', date '2026-09-01', 'a', 'b' from marcas where codigo = 'HUMO24M';

select 'default = TEMPORADAS_DEFECTO' as prueba,
  temporadas_usadas = '{"verano":{"desde_mes":10,"hasta_mes":3},"invierno":{"desde_mes":4,"hasta_mes":9}}'::jsonb as ok
from repartos_marca_barrido r join marcas m on m.id = r.marca_id where m.codigo = 'HUMO24M' and r.version = 1;

-- 2. La columna es jsonb, no nula, con default, y el check existe.
select 'columna jsonb not null con default' as prueba,
  (select data_type = 'jsonb' and is_nullable = 'NO' and column_default is not null
     from information_schema.columns
    where table_schema = 'public' and table_name = 'repartos_marca_barrido' and column_name = 'temporadas_usadas') as ok;
select 'check repartos_marca_barrido_temporadas_check existe (una sola vez)' as prueba,
  (select count(*) from pg_constraint
    where conrelid = 'public.repartos_marca_barrido'::regclass
      and conname = 'repartos_marca_barrido_temporadas_check') = 1 as ok;

-- 3. Fechas distintas de las de por defecto se guardan tal cual (el reparto conserva las que usó).
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, temporadas_usadas)
select id, 2, false, 24, 'por_temporada', date '2026-09-01', 'a', 'b',
       '{"verano":{"desde_mes":11,"hasta_mes":4},"invierno":{"desde_mes":5,"hasta_mes":10}}'::jsonb
from marcas where codigo = 'HUMO24M';
select 'fechas propias se conservan' as prueba,
  (select temporadas_usadas -> 'verano' ->> 'desde_mes' from repartos_marca_barrido r join marcas m on m.id = r.marca_id
    where m.codigo = 'HUMO24M' and r.version = 2) = '11' as ok;

-- 4. El check rechaza lo que no es un objeto (array, escalar, JSON null) y el NOT NULL rechaza el nulo SQL.
\echo '--- temporadas_usadas = [] (esperado ERROR repartos_marca_barrido_temporadas_check)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, temporadas_usadas)
select id, 3, false, 24, 'anual', date '2026-09-01', 'a', 'b', '[]'::jsonb from marcas where codigo = 'HUMO24M';
rollback to savepoint s;
\echo '--- temporadas_usadas = "verano" (esperado ERROR repartos_marca_barrido_temporadas_check)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, temporadas_usadas)
select id, 3, false, 24, 'anual', date '2026-09-01', 'a', 'b', '"verano"'::jsonb from marcas where codigo = 'HUMO24M';
rollback to savepoint s;
\echo '--- temporadas_usadas = JSON null (esperado ERROR repartos_marca_barrido_temporadas_check)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, temporadas_usadas)
select id, 3, false, 24, 'anual', date '2026-09-01', 'a', 'b', 'null'::jsonb from marcas where codigo = 'HUMO24M';
rollback to savepoint s;
\echo '--- temporadas_usadas = NULL de SQL (esperado ERROR not null)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, temporadas_usadas)
select id, 3, false, 24, 'anual', date '2026-09-01', 'a', 'b', null from marcas where codigo = 'HUMO24M';
rollback to savepoint s;
\echo '--- update a un array (esperado ERROR repartos_marca_barrido_temporadas_check)'
savepoint s;
update repartos_marca_barrido set temporadas_usadas = '[1]'::jsonb where version = 1;
rollback to savepoint s;

select 'solo las dos versiones validas quedaron (los rechazos no escribieron)' as prueba,
  (select count(*) from repartos_marca_barrido r join marcas m on m.id = r.marca_id where m.codigo = 'HUMO24M') = 2 as ok;

-- 5. Permisos heredados de 0019: anon y authenticated sin acceso a la tabla; service_role con acceso; RLS activo.
select 'RLS activo en repartos_marca_barrido' as prueba, relrowsecurity as ok
from pg_class where oid = 'public.repartos_marca_barrido'::regclass;
select 'anon no lee la tabla' as prueba, not has_table_privilege('anon', 'public.repartos_marca_barrido', 'select') as ok;
select 'authenticated no lee la tabla' as prueba, not has_table_privilege('authenticated', 'public.repartos_marca_barrido', 'select') as ok;
select 'service_role si' as prueba, has_table_privilege('service_role', 'public.repartos_marca_barrido', 'select, insert, update') as ok;

rollback;
