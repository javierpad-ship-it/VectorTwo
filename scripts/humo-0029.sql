-- Humo SQL de la migración 0029 (M6 06e, cierre del año en curso por curva y base del año siguiente sin el Niño):
--   * `crecimientos_genero_mundo.sobre_base` (text not null default 'bruta', sin check de catálogo; B1 de la revisión);
--   * `proyeccion_crecimientos.sobre_base` (text null, sin default: nulo = foto de antes de 0.14.0);
--   * las seis columnas nuevas de `factores_volumen_atipico` (formula, ratio_volumen, ratio_control, huella_composicion,
--     aplicado_huella, diagnostico) con sus checks y compatibles con lo que escribe 0.13.x;
--   * la función `venta_genero_mundo(date)` con la dimensión `a` (agrupación) y sus propiedades de seguridad.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0029.sql"
--
-- Como humo-0027.sql, NO necesita fixture previo: carga el suyo (géneros, mundos, líneas y nodos, tiendas, cargas,
-- agrupaciones, equivalencias, venta y una proyección). Todo inventado: nada de datos reales de Lukers.
--
-- Contra PRODUCCIÓN solo se corren, por SELECT de solo lectura, las comprobaciones de estructura (secciones 1, 3 y 5,
-- marcadas «solo lectura»): el resto inserta datos de prueba y es solo para la base local.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Cada comprobación imprime `ok = t`;
-- un `ok = f` es un fallo. Los casos que DEBEN fallar se prueban dentro de un bloque `do` con `exception` (es un script de
-- prueba local, no una migración): imprimen `ok = t` cuando la base los rechaza.
-- Nota local: el rol `service_role` del clúster local no tiene BYPASSRLS, así que sus permisos se comprueban con
-- has_table_privilege y has_function_privilege.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. `sobre_base`: default 'bruta' para siempre (B1)  [estructura: solo lectura]
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- crecimientos_genero_mundo.sobre_base: text, not null, column_default = ''bruta''::text (esperado ok = t)'
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'crecimientos_genero_mundo' and column_name = 'sobre_base'
          and data_type = 'text' and is_nullable = 'NO' and column_default = '''bruta''::text') = 1 as ok;

\echo '--- proyeccion_crecimientos.sobre_base: text, nullable, SIN default (esperado ok = t)'
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'proyeccion_crecimientos' and column_name = 'sobre_base'
          and data_type = 'text' and is_nullable = 'YES' and column_default is null) = 1 as ok;

\echo '--- sobre_base no lleva check de catalogo en ninguna de las dos tablas (esperado ok = t)'
select not exists (select 1 from pg_constraint
                   where contype = 'c' and conrelid in ('public.crecimientos_genero_mundo'::regclass, 'public.proyeccion_crecimientos'::regclass)
                     and pg_get_constraintdef(oid) like '%sobre_base%') as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into generos (codigo, nombre) values ('HUMOH', 'HOMBRE HUMO'), ('HUMOM', 'MUJER HUMO');
insert into mundos (codigo, nombre) values ('HUMOU', 'URBANO HUMO');
insert into lineas (codigo, nombre, temporada) values ('HUMOL1', 'LINEA UNO HUMO', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML'
from lineas l, generos g, mundos mu
where l.codigo = 'HUMOL1' and g.codigo in ('HUMOH', 'HUMOM') and mu.codigo = 'HUMOU';

insert into proyecciones (anio_en_curso, nombre, hasta_periodo, parametros) values
  (2026, 'HUMO 29 A', date '2026-09-01', '{}'::jsonb);

create temp table ids as
select
  (select id from generos where codigo = 'HUMOH') as g_h,
  (select id from generos where codigo = 'HUMOM') as g_m,
  (select id from mundos where codigo = 'HUMOU') as m_u,
  (select id from proyecciones where nombre = 'HUMO 29 A') as p_a;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. `crecimientos_genero_mundo.sobre_base`: comportamiento
-- ---------------------------------------------------------------------------------------------------------------------
create temp table casos (n int, caso text, sentencia text, esperado_ok boolean, ok boolean);
insert into casos (n, caso, esperado_ok, sentencia) values
  (1, 'insert SIN sobre_base (lo que hace 0.13.x): se acepta', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
       select 2027, 'gm', g_h, m_u, 1, 15, 'acumulado', '{}'::jsonb from ids $q$),
  (2, 'insert con sobre_base = corregida (0.14.0, explicito)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, estado, pct, base_tipo, referencia, sobre_base)
       select 2027, 'gm', g_h, m_u, 2, 'reemplazada', 8, 'cierre_curva', '{}'::jsonb, 'corregida' from ids $q$),
  (3, 'insert con sobre_base = bruta explicito', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia, sobre_base)
       values (2027, 'resto', 1, 5, 'ninguna', '{}'::jsonb, 'bruta') $q$),
  (4, 'sobre_base nulo explicito (not null)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia, sobre_base)
       values (2028, 'resto', 1, 'reemplazada', 1, 'ninguna', '{}'::jsonb, null) $q$),
  (5, 'sobre_base fuera del catalogo (sin check: lo valida zod)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia, sobre_base)
       values (2028, 'resto', 2, 'reemplazada', 1, 'ninguna', '{}'::jsonb, 'otra_futura') $q$),
  (6, 'proyeccion_crecimientos SIN sobre_base (foto de 0.13.x): se acepta', true,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p_a, g_m, m_u, 8 from ids $q$),
  (7, 'proyeccion_crecimientos con sobre_base = corregida', true,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, sobre_base)
       select p_a, g_h, m_u, 8, 'corregida' from ids $q$);

do $$
declare
  c record;
  v_aceptada boolean;
begin
  for c in select * from casos order by n loop
    begin
      execute c.sentencia;
      v_aceptada := true;
    exception when check_violation or unique_violation or foreign_key_violation or not_null_violation then
      v_aceptada := false;
    end;
    update casos set ok = (v_aceptada = esperado_ok) where n = c.n;
  end loop;
end
$$;

\echo '--- casos de sobre_base (esperado: todas las filas ok = t)'
select n, caso, esperado_ok as debe_aceptarse, ok from casos order by n;

\echo '--- la fila escrita SIN sobre_base quedo en bruta; la explicita, en corregida (esperado ok = t)'
select (select sobre_base from crecimientos_genero_mundo where anio_aplicacion = 2027 and alcance = 'gm' and version = 1) = 'bruta'
   and (select sobre_base from crecimientos_genero_mundo where anio_aplicacion = 2027 and alcance = 'gm' and version = 2) = 'corregida' as ok;

\echo '--- la foto escrita SIN sobre_base quedo en nulo (se lee como bruta); la explicita guarda su valor (esperado ok = t)'
select (select sobre_base is null from proyeccion_crecimientos c join ids on c.proyeccion_id = ids.p_a and c.genero_id = ids.g_m)
   and (select sobre_base = 'corregida' from proyeccion_crecimientos c join ids on c.proyeccion_id = ids.p_a and c.genero_id = ids.g_h) as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. `factores_volumen_atipico`: columnas nuevas  [estructura: solo lectura]
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- columnas nuevas de factores_volumen_atipico: tipos y todas nullable, sin default (esperado ok = t)'
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'factores_volumen_atipico' and is_nullable = 'YES' and column_default is null
          and ((column_name in ('formula', 'huella_composicion', 'aplicado_huella') and data_type = 'text')
            or (column_name in ('ratio_volumen', 'ratio_control') and data_type = 'numeric' and numeric_precision = 6 and numeric_scale = 4)
            or (column_name = 'diagnostico' and data_type = 'jsonb'))) = 6 as ok;

\echo '--- checks de factores_volumen_atipico: los de 0018 mas ratio_volumen y ratio_control; formula sin check (esperado ok = t)'
select (select string_agg(conname, ',' order by conname) from pg_constraint
        where conrelid = 'public.factores_volumen_atipico'::regclass and contype = 'c')
     = 'factores_volumen_atipico_anio_check,factores_volumen_atipico_meses_comparados_check,factores_volumen_atipico_nota_len_check,factores_volumen_atipico_ratio_aplicado_check,factores_volumen_atipico_ratio_calculado_check,factores_volumen_atipico_ratio_control_check,factores_volumen_atipico_ratio_volumen_check,factores_volumen_atipico_temporada_check,factores_volumen_atipico_tiendas_comunes_check' as ok;

create temp table casos2 (n int, caso text, sentencia text, esperado_ok boolean, ok boolean);
insert into casos2 (n, caso, esperado_ok, sentencia) values
  (1, 'fila como la escribe 0.13.x (sin columnas nuevas): se acepta y queda con nulos', true,
   $q$ insert into public.factores_volumen_atipico (anio, temporada, ratio_calculado, huella_cargas, calculado_at, tiendas_comunes, meses_comparados, parcial)
       values (2090, 'invierno', 0.6602, 'h1', now(), 9, 9, true) $q$),
  (2, 'fila 0.14.0 completa (formula, ratios, huellas y diagnostico)', true,
   $q$ insert into public.factores_volumen_atipico (anio, temporada, ratio_calculado, ratio_volumen, ratio_control, formula, huella_cargas, huella_composicion, aplicado_huella, diagnostico, meses_comparados, parcial)
       values (2090, 'verano', 0.7020, 0.6609, 0.9414, 'relativo_periodo', 'h1', 'c1', 'h1', '{"meses": [], "ratio_fuera": null}'::jsonb, 9, true) $q$),
  (3, 'ratio_volumen = 0 (check > 0)', false,
   $q$ insert into public.factores_volumen_atipico (anio, temporada, ratio_volumen) values (2091, 'invierno', 0) $q$),
  (4, 'ratio_volumen negativo', false,
   $q$ insert into public.factores_volumen_atipico (anio, temporada, ratio_volumen) values (2091, 'invierno', -0.1) $q$),
  (5, 'ratio_control = 0 (check > 0)', false,
   $q$ insert into public.factores_volumen_atipico (anio, temporada, ratio_control) values (2091, 'invierno', 0) $q$),
  (6, 'ratio_control nulo (permitido)', true,
   $q$ insert into public.factores_volumen_atipico (anio, temporada, ratio_control, ratio_volumen) values (2091, 'invierno', null, null) $q$),
  (7, 'formula fuera del catalogo (sin check: lo valida el codigo)', true,
   $q$ insert into public.factores_volumen_atipico (anio, temporada, formula) values (2092, 'invierno', 'formula_futura') $q$),
  (8, 'ratio_volumen = 100 desborda numeric(6,4)', false,
   $q$ insert into public.factores_volumen_atipico (anio, temporada, ratio_volumen) values (2093, 'invierno', 100) $q$);
do $$
declare
  c record;
  v_aceptada boolean;
begin
  for c in select * from casos2 order by n loop
    begin
      execute c.sentencia;
      v_aceptada := true;
    exception when check_violation or unique_violation or foreign_key_violation or not_null_violation or numeric_value_out_of_range then
      v_aceptada := false;
    end;
    update casos2 set ok = (v_aceptada = esperado_ok) where n = c.n;
  end loop;
end
$$;
\echo '--- casos de factores_volumen_atipico (esperado: todas las filas ok = t)'
select n, caso, esperado_ok as debe_aceptarse, ok from casos2 order by n;

\echo '--- la fila de 0.13.x quedo con las seis columnas nuevas en nulo (esperado ok = t)'
select formula is null and ratio_volumen is null and ratio_control is null and huella_composicion is null
   and aplicado_huella is null and diagnostico is null as ok
from factores_volumen_atipico where anio = 2090 and temporada = 'invierno';

\echo '--- trigger set_updated_at sigue activo en factores_volumen_atipico (esperado ok = t)'
select (select count(*) from pg_trigger where tgrelid = 'public.factores_volumen_atipico'::regclass and tgname = 'set_updated_at' and not tgisinternal) = 1 as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Función `venta_genero_mundo(date)` con la dimensión `a`
-- ---------------------------------------------------------------------------------------------------------------------
-- Nodos: HOMBRE x URBANO (nh) y MUJER x URBANO (nm).
-- Agrupaciones: INV1 e INV2 (las dos invierno, activas), OFF (verano, inactiva).
insert into tiendas (codigo, nombre, tipo) values
  ('HUMO29T1', 'HUMO 29 TIENDA 1', 'Tienda'),
  ('HUMO29T2', 'HUMO 29 TIENDA 2', 'Tienda'),
  ('HUMO29CD', 'HUMO 29 CD', 'Centro de Distribución');
insert into agrupaciones_estacionalidad (codigo, nombre, temporada, activo) values
  ('HUMO29INV1', 'INVIERNO UNO HUMO 29', 'invierno', true),
  ('HUMO29INV2', 'INVIERNO DOS HUMO 29', 'invierno', true),
  ('HUMO29OFF', 'VERANO INACTIVA HUMO 29', 'verano', false);
insert into agrupaciones_talla (codigo, nombre) values ('HUMO29TA', 'TALLA A HUMO 29');
insert into agrupaciones_marca (codigo, nombre) values ('HUMO29AG', 'AGRUPACION HUMO 29');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select 'HUMO29M', 'MARCA HUMO 29', id from agrupaciones_marca where codigo = 'HUMO29AG';

-- eqA: HOMBRE, INV1. eqB: HOMBRE, INV2 (misma temporada que eqA, otra agrupacion). eqC: HOMBRE, sin agrupacion.
-- eqD: MUJER, agrupacion INACTIVA (OFF).
insert into equivalencias (genero_mundo_linea_id, codigo, nombre, agrupacion_estacionalidad_id)
select n.id, v.codigo, v.nombre, (select id from agrupaciones_estacionalidad where codigo = v.agr)
from (values ('HUMOH', 'EQA', 'EQUIVALENCIA A HUMO 29', 'HUMO29INV1'),
             ('HUMOH', 'EQB', 'EQUIVALENCIA B HUMO 29', 'HUMO29INV2'),
             ('HUMOH', 'EQC', 'EQUIVALENCIA C HUMO 29', null),
             ('HUMOM', 'EQD', 'EQUIVALENCIA D HUMO 29', 'HUMO29OFF')) as v(g, codigo, nombre, agr)
join generos g on g.codigo = v.g
join mundos mu on mu.codigo = 'HUMOU'
join genero_mundo_linea n on n.genero_id = g.id and n.mundo_id = mu.id
join lineas l on l.id = n.linea_id and l.codigo = 'HUMOL1';

insert into cargas_venta_stock (periodo, estado, publicada_at) values
  (date '2025-01-01', 'publicada', now()),
  (date '2025-02-01', 'publicada', now()),
  (date '2025-03-01', 'retirada', now());

create temp table venta_fixture (periodo date, tienda text, eq text, unidades int);
insert into venta_fixture values
  (date '2025-01-01', 'HUMO29T1', 'EQA', 10),
  (date '2025-02-01', 'HUMO29T1', 'EQA', 7),
  (date '2025-01-01', 'HUMO29T1', 'EQB', 5),
  (date '2025-01-01', 'HUMO29T2', 'EQB', 3),
  (date '2025-01-01', 'HUMO29T1', 'EQC', 4),
  (date '2025-01-01', 'HUMO29T1', 'EQD', -2),
  (date '2025-01-01', 'HUMO29CD', 'EQA', 100),
  (date '2025-03-01', 'HUMO29T1', 'EQA', 999);
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades)
select c.id, t.id, e.id, (select id from marcas where codigo = 'HUMO29M'), (select id from agrupaciones_talla where codigo = 'HUMO29TA'), f.unidades
from venta_fixture f
join cargas_venta_stock c on c.periodo = f.periodo
join tiendas t on t.codigo = f.tienda
join equivalencias e on e.codigo = f.eq and e.nombre like 'EQUIVALENCIA % HUMO 29';

create temp table res as select public.venta_genero_mundo(date '2025-01-01') as r;

-- Atajo: la serie de (genero, mundo, agrupacion codigo o null, tienda) como jsonb, o null si no existe.
create or replace function pg_temp.serie(p_res jsonb, p_gen text, p_agr text, p_tienda text)
returns jsonb language sql as $$
  select s -> 'u'
  from jsonb_array_elements(p_res -> 'series') s
  where s ->> 'g' = (select id::text from generos where codigo = p_gen)
    and s ->> 'm' = (select id::text from mundos where codigo = 'HUMOU')
    and (s -> 'a' = 'null'::jsonb) = (p_agr is null)
    and (p_agr is null or s ->> 'a' = (select id::text from agrupaciones_estacionalidad where codigo = p_agr))
    and s ->> 't' = (select id::text from tiendas where codigo = p_tienda)
$$;

\echo '--- 5 series: A/T1, B/T1, B/T2, sin agrupacion/T1 y la inactiva/T1; el CD y la carga retirada quedan fuera (esperado ok = t)'
select jsonb_array_length(r -> 'series') = 5 as ok from res;

\echo '--- cada serie trae las claves g, m, temp, a, t, u (esperado ok = t)'
select not exists (select 1 from jsonb_array_elements(r -> 'series') s
                   where not (s ?& array['g', 'm', 'temp', 'a', 't', 'u'])) as ok from res;

\echo '--- INV1 e INV2 (misma temporada, invierno) salen en series SEPARADAS con su agrupacion en `a` (esperado ok = t)'
select pg_temp.serie(r, 'HUMOH', 'HUMO29INV1', 'HUMO29T1') = '{"2025-01": 10, "2025-02": 7}'::jsonb
   and pg_temp.serie(r, 'HUMOH', 'HUMO29INV2', 'HUMO29T1') = '{"2025-01": 5}'::jsonb
   and pg_temp.serie(r, 'HUMOH', 'HUMO29INV2', 'HUMO29T2') = '{"2025-01": 3}'::jsonb as ok from res;

\echo '--- `temp` se mantiene: invierno en INV1 e INV2 (esperado ok = t)'
select (select count(*) from jsonb_array_elements(r -> 'series') s where s ->> 'temp' = 'invierno' and s ->> 'a' is not null) = 3 as ok from res;

\echo '--- sin agrupacion y con agrupacion INACTIVA: a = JSON null y temp = sin_agrupacion; neto negativo se conserva (esperado ok = t)'
select pg_temp.serie(r, 'HUMOH', null, 'HUMO29T1') = '{"2025-01": 4}'::jsonb
   and pg_temp.serie(r, 'HUMOM', null, 'HUMO29T1') = '{"2025-01": -2}'::jsonb
   and (select count(*) from jsonb_array_elements(r -> 'series') s where s ->> 'temp' = 'sin_agrupacion' and s -> 'a' = 'null'::jsonb) = 2 as ok from res;

\echo '--- COMPATIBILIDAD (R21): el lector viejo suma por (g, m, temp, t) ignorando `a` y obtiene lo mismo que daba 0027: invierno HOMBRE T1 = 15 + 7 en enero y febrero (esperado ok = t)'
select (select jsonb_object_agg(k, v) from (
          select m.key as k, sum(m.value::int) as v
          from jsonb_array_elements(r -> 'series') s, jsonb_each_text(s -> 'u') m
          where s ->> 'g' = (select id::text from generos where codigo = 'HUMOH') and s ->> 'temp' = 'invierno' and s ->> 't' = (select id::text from tiendas where codigo = 'HUMO29T1')
          group by m.key) x) = '{"2025-01": 15, "2025-02": 7}'::jsonb as ok from res;

\echo '--- ninguna serie es del centro de distribucion (esperado ok = t)'
select not exists (select 1 from jsonb_array_elements(r -> 'series') s where s ->> 't' = (select id::text from tiendas where codigo = 'HUMO29CD')) as ok from res;

\echo '--- cargas: solo las dos publicadas, sin la retirada (esperado ok = t)'
select (select array_agg(k order by k) from jsonb_object_keys(r -> 'cargas') k) = array['2025-01', '2025-02'] as ok from res;

\echo '--- orden determinista: dos llamadas con los mismos datos dan el mismo documento (esperado ok = t)'
select public.venta_genero_mundo(date '2025-01-01') = public.venta_genero_mundo(date '2025-01-01') as ok;

\echo '--- sin venta desde esa fecha: series [] y cargas objeto (esperado ok = t)'
select (public.venta_genero_mundo(date '2100-01-01') -> 'series') = '[]'::jsonb
   and jsonb_typeof(public.venta_genero_mundo(date '2100-01-01') -> 'cargas') = 'object' as ok;

\echo '--- la funcion es stable, security invoker, language sql, search_path vacio y devuelve jsonb (esperado ok = t)  [solo lectura]'
select p.provolatile = 's' and not p.prosecdef and l.lanname = 'sql' and p.proconfig = array['search_path=""']
   and p.prorettype = 'jsonb'::regtype and p.pronargs = 1 as ok
from pg_proc p join pg_language l on l.oid = p.prolang
where p.oid = 'public.venta_genero_mundo(date)'::regprocedure;

\echo '--- el cuerpo de la funcion no lleva comentarios -- (el SQL Editor los parsea mal) (esperado ok = t)  [solo lectura]'
select p.prosrc !~ '--' as ok from pg_proc p where p.oid = 'public.venta_genero_mundo(date)'::regprocedure;

\echo '--- permisos de la funcion: solo service_role ejecuta (esperado ok = t)  [solo lectura]'
select not has_function_privilege('anon', 'public.venta_genero_mundo(date)', 'execute')
   and not has_function_privilege('authenticated', 'public.venta_genero_mundo(date)', 'execute')
   and not has_function_privilege('public', 'public.venta_genero_mundo(date)', 'execute')
   and has_function_privilege('service_role', 'public.venta_genero_mundo(date)', 'execute') as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. RLS, permisos y comentarios  [solo lectura]
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- RLS activo y sin politicas en las tres tablas tocadas (esperado ok = t)'
select bool_and(c.relrowsecurity)
   and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('crecimientos_genero_mundo', 'proyeccion_crecimientos', 'factores_volumen_atipico')) = 0 as ok
from pg_class c where c.oid in ('public.crecimientos_genero_mundo'::regclass, 'public.proyeccion_crecimientos'::regclass, 'public.factores_volumen_atipico'::regclass);

\echo '--- comentarios de las columnas y de la funcion (esperado ok = t)'
select (select count(*) from pg_attribute a
        where a.attnum > 0 and not a.attisdropped
          and ((a.attrelid = 'public.crecimientos_genero_mundo'::regclass and a.attname in ('sobre_base', 'pct'))
            or (a.attrelid = 'public.proyeccion_crecimientos'::regclass and a.attname = 'sobre_base')
            or (a.attrelid = 'public.factores_volumen_atipico'::regclass and a.attname in ('formula', 'ratio_volumen', 'ratio_control', 'huella_composicion', 'aplicado_huella', 'diagnostico', 'meses_comparados', 'ratio_calculado'))
            or (a.attrelid = 'public.proyeccion_fila_anios'::regclass and a.attname = 'base_normalizada'))
          and (col_description(a.attrelid, a.attnum) like '%06e%'
            or col_description(a.attrelid, a.attnum) like 'Desde 0.14.0%'
            or col_description(a.attrelid, a.attnum) like 'Factor calculado. Desde 0.14.0%')) = 12
   and obj_description('public.venta_genero_mundo(date)'::regprocedure, 'pg_proc') like 'M6 06d/06e:%' as ok;

rollback;
