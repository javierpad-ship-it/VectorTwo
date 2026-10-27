-- Humo SQL de la migración 0027 (M6 06d, crecimiento por género x mundo global y versionado):
--   * la tabla `crecimientos_genero_mundo` (checks de forma sin catálogo cerrado, únicos con `coalesce`, único parcial de
--     vigente, FK, índices, trigger, RLS y permisos);
--   * las columnas `proyeccion_crecimientos.crecimiento_id` y `version` (foto de lo aplicado);
--   * la función `venta_genero_mundo(date)` (tipo Tienda, árbol vigente, temporada, cargas publicadas, permisos).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0027.sql"
--
-- Como humo-0023.sql y humo-0024.sql, NO necesita fixture previo: carga el suyo (géneros, mundos, líneas y nodos, tiendas,
-- cargas, equivalencias, venta, una proyección y un perfil). Todo inventado: nada de datos reales de Lukers.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Cada comprobación imprime `ok = t`;
-- un `ok = f` es un fallo. Los casos que DEBEN fallar se prueban dentro de un bloque `do` con `exception` (es un script de
-- prueba local, no una migración): imprimen `ok = t` cuando la base los rechaza.
-- Nota local: el rol `service_role` del clúster local no tiene BYPASSRLS, así que los permisos de `service_role` se
-- comprueban con has_table_privilege y has_function_privilege.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into generos (codigo, nombre) values ('HUMOH', 'HOMBRE HUMO'), ('HUMOM', 'MUJER HUMO');
insert into mundos (codigo, nombre) values ('HUMOU', 'URBANO HUMO'), ('HUMOF', 'FORMAL HUMO');
insert into lineas (codigo, nombre, temporada) values ('HUMOL1', 'LINEA UNO HUMO', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML'
from lineas l, generos g, mundos mu
where l.codigo = 'HUMOL1' and g.codigo in ('HUMOH', 'HUMOM') and mu.codigo in ('HUMOU', 'HUMOF');

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000c1', 'humo27@example.invalid');
insert into perfiles (id, email, nombre, rol) values ('00000000-0000-4000-8000-0000000000c1', 'humo27@example.invalid', 'Humo 27', 'planner');

insert into proyecciones (anio_en_curso, nombre, hasta_periodo, parametros) values
  (2026, 'HUMO 27 A', date '2026-09-01', '{"crecimiento_pct_defecto": 5}'::jsonb),
  (2026, 'HUMO 27 B', date '2026-09-01', '{}'::jsonb);

-- Los ids que usan los casos, en una tabla temporal para que cada sentencia quepa en una línea.
create temp table ids as
select
  (select id from generos where codigo = 'HUMOH') as g_h,
  (select id from generos where codigo = 'HUMOM') as g_m,
  (select id from mundos where codigo = 'HUMOU') as m_u,
  (select id from mundos where codigo = 'HUMOF') as m_f,
  (select id from proyecciones where nombre = 'HUMO 27 A') as p_a,
  (select id from proyecciones where nombre = 'HUMO 27 B') as p_b;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Tabla `crecimientos_genero_mundo`: casos de aceptación y rechazo
-- ---------------------------------------------------------------------------------------------------------------------
-- Cada caso intenta una sentencia y compara lo ocurrido con lo esperado. Una sentencia que viola un check, un NOT NULL, un
-- único o una FK se anota como rechazada; una que corre sin error, como aceptada. Van en orden: los últimos dependen de las
-- filas que dejaron los primeros.
create temp table casos (n int, caso text, sentencia text, esperado_ok boolean, ok boolean);

insert into casos (n, caso, esperado_ok, sentencia) values
  (1,  'GM valido (HOMBRE x URBANO, 2027, v1 vigente, 15 %)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
       select 2027, 'gm', g_h, m_u, 1, 15, 'acumulado', '{}'::jsonb from ids $q$),
  (2,  'Resto valido (sin genero ni mundo, v1 vigente)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia)
       select 2027, 'resto', 1, 5, 'ninguna', '{}'::jsonb from ids $q$),
  (3,  'gm sin mundo (check de forma)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, version, pct, base_tipo, referencia)
       select 2027, 'gm', g_m, 1, 1, 'ninguna', '{}'::jsonb from ids $q$),
  (4,  'gm sin genero (check de forma)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, mundo_id, version, pct, base_tipo, referencia)
       select 2027, 'gm', m_f, 1, 1, 'ninguna', '{}'::jsonb from ids $q$),
  (5,  'resto con genero (check de forma)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, version, pct, base_tipo, referencia)
       select 2028, 'resto', g_h, 1, 1, 'ninguna', '{}'::jsonb from ids $q$),
  (6,  'resto con mundo (check de forma)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, mundo_id, version, pct, base_tipo, referencia)
       select 2028, 'resto', m_u, 1, 1, 'ninguna', '{}'::jsonb from ids $q$),
  (7,  'alcance futuro sin catalogo cerrado (por_genero con genero y sin mundo): la base no lo rechaza, lo valida zod', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, version, pct, base_tipo, referencia)
       select 2027, 'por_genero', g_m, 1, 1, 'ninguna', '{}'::jsonb from ids $q$),
  (8,  'base_tipo fuera del catalogo (sin check: lo valida zod)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
       select 2027, 'gm', g_m, m_f, 1, 1, 'base_futura', '{}'::jsonb from ids $q$),
  (9,  'anio_aplicacion = 2024 (limite inferior)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia)
       values (2024, 'resto', 1, 1, 'ninguna', '{}'::jsonb) $q$),
  (10, 'anio_aplicacion = 2100 (limite superior)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia)
       values (2100, 'resto', 1, 1, 'ninguna', '{}'::jsonb) $q$),
  (11, 'anio_aplicacion = 2023 (bajo el rango)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia)
       values (2023, 'resto', 1, 1, 'ninguna', '{}'::jsonb) $q$),
  (12, 'anio_aplicacion = 2101 (sobre el rango)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia)
       values (2101, 'resto', 1, 1, 'ninguna', '{}'::jsonb) $q$),
  (13, 'version = 0', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia)
       values (2029, 'resto', 0, 1, 'ninguna', '{}'::jsonb) $q$),
  (14, 'estado = retirada (entra desde ya)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2029, 'resto', 1, 'retirada', 1, 'ninguna', '{}'::jsonb) $q$),
  (15, 'estado = reemplazada', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2029, 'resto', 2, 'reemplazada', 1, 'ninguna', '{}'::jsonb) $q$),
  (16, 'estado fuera del catalogo', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2029, 'resto', 3, 'borrada', 1, 'ninguna', '{}'::jsonb) $q$),
  (17, 'pct = -95 (limite inferior)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2030, 'resto', 1, 'reemplazada', -95, 'ninguna', '{}'::jsonb) $q$),
  (18, 'pct = 500 (limite superior)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2030, 'resto', 2, 'reemplazada', 500, 'ninguna', '{}'::jsonb) $q$),
  (19, 'pct = -95.01', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2030, 'resto', 3, 'reemplazada', -95.01, 'ninguna', '{}'::jsonb) $q$),
  (20, 'pct = 500.01', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2030, 'resto', 3, 'reemplazada', 500.01, 'ninguna', '{}'::jsonb) $q$),
  (21, 'pct nulo', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2030, 'resto', 3, 'reemplazada', null, 'ninguna', '{}'::jsonb) $q$),
  (22, 'nota de 300 caracteres', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, nota, base_tipo, referencia)
       values (2031, 'resto', 1, 'reemplazada', 1, repeat('n', 300), 'ninguna', '{}'::jsonb) $q$),
  (23, 'nota de 301 caracteres', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, nota, base_tipo, referencia)
       values (2031, 'resto', 2, 'reemplazada', 1, repeat('n', 301), 'ninguna', '{}'::jsonb) $q$),
  (24, 'referencia = array (debe ser objeto)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2031, 'resto', 2, 'reemplazada', 1, 'ninguna', '[]'::jsonb) $q$),
  (25, 'referencia = JSON null', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2031, 'resto', 2, 'reemplazada', 1, 'ninguna', 'null'::jsonb) $q$),
  (26, 'referencia = NULL de SQL', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2031, 'resto', 2, 'reemplazada', 1, 'ninguna', null) $q$),
  (27, 'base_tipo nulo', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2031, 'resto', 2, 'reemplazada', 1, null, '{}'::jsonb) $q$),
  (28, 'base_valor con dos decimales y fuera de pct (numeric(8,2))', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, base_valor, referencia)
       values (2031, 'resto', 3, 'reemplazada', 1, 'acumulado', 18.37, '{}'::jsonb) $q$),
  (29, 'misma clave y version otra vez para un GM (unico con coalesce)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, estado, pct, base_tipo, referencia)
       select 2027, 'gm', g_h, m_u, 1, 'reemplazada', 9, 'ninguna', '{}'::jsonb from ids $q$),
  (30, 'misma clave y version otra vez para el Resto: los dos NULL chocan gracias al coalesce', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, estado, pct, base_tipo, referencia)
       values (2027, 'resto', 1, 'reemplazada', 9, 'ninguna', '{}'::jsonb) $q$),
  (31, 'segunda vigente del mismo GM (unico parcial de vigente), version 2', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
       select 2027, 'gm', g_h, m_u, 2, 16, 'acumulado', '{}'::jsonb from ids $q$),
  (32, 'segunda vigente del Resto, version 2 (unico parcial con NULL)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia)
       values (2027, 'resto', 2, 6, 'ninguna', '{}'::jsonb) $q$),
  (33, 'v2 del GM como reemplazada: se acepta (versiones distintas, una sola vigente)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, estado, pct, base_tipo, referencia)
       select 2027, 'gm', g_h, m_u, 2, 'reemplazada', 16, 'acumulado', '{}'::jsonb from ids $q$),
  (34, 'el mismo GM en OTRO anio puede tener su propia vigente', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
       select 2028, 'gm', g_h, m_u, 1, 3, 'ninguna', '{}'::jsonb from ids $q$),
  (35, 'otro GM del mismo anio puede tener su vigente (HOMBRE x FORMAL)', true,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
       select 2027, 'gm', g_h, m_f, 1, 4, 'ninguna', '{}'::jsonb from ids $q$),
  (36, 'genero_id inexistente (FK)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
       select 2032, 'gm', gen_random_uuid(), m_u, 1, 1, 'ninguna', '{}'::jsonb from ids $q$),
  (37, 'mundo_id inexistente (FK)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
       select 2032, 'gm', g_h, gen_random_uuid(), 1, 1, 'ninguna', '{}'::jsonb from ids $q$),
  (38, 'proyeccion_referencia_id inexistente (FK)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia, proyeccion_referencia_id)
       values (2032, 'resto', 1, 1, 'ninguna', '{}'::jsonb, gen_random_uuid()) $q$),
  (39, 'perfil_id inexistente (FK)', false,
   $q$ insert into public.crecimientos_genero_mundo (anio_aplicacion, alcance, version, pct, base_tipo, referencia, perfil_id)
       values (2032, 'resto', 1, 1, 'ninguna', '{}'::jsonb, gen_random_uuid()) $q$),
  (40, 'eliminar un genero usado por un crecimiento (on delete restrict)', false,
   $q$ delete from public.generos where codigo = 'HUMOH' $q$),
  (41, 'eliminar un mundo usado por un crecimiento (on delete restrict)', false,
   $q$ delete from public.mundos where codigo = 'HUMOU' $q$);

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

\echo '--- casos de checks, unicos y FK de crecimientos_genero_mundo (esperado: todas las filas ok = t)'
select n, caso, esperado_ok as debe_aceptarse, ok from casos order by n;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Estructura de `crecimientos_genero_mundo`
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- columnas de crecimientos_genero_mundo (esperado ok = t)'
select (select string_agg(column_name, ',' order by column_name) from information_schema.columns
        where table_schema = 'public' and table_name = 'crecimientos_genero_mundo')
     = 'activo,alcance,anio_aplicacion,aprobada_at,base_tipo,base_valor,created_at,estado,genero_id,id,mundo_id,nota,pct,perfil_id,proyeccion_referencia_id,referencia,updated_at,usuario_nombre,version' as ok;

\echo '--- tipos y nulabilidad: pct numeric(6,2), base_valor numeric(8,2) nulo, referencia jsonb not null, estado default vigente (esperado ok = t)'
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'crecimientos_genero_mundo'
          and ((column_name = 'pct' and data_type = 'numeric' and numeric_precision = 6 and numeric_scale = 2 and is_nullable = 'NO')
            or (column_name = 'base_valor' and data_type = 'numeric' and numeric_precision = 8 and numeric_scale = 2 and is_nullable = 'YES')
            or (column_name = 'referencia' and data_type = 'jsonb' and is_nullable = 'NO')
            or (column_name = 'estado' and data_type = 'text' and is_nullable = 'NO' and column_default like '''vigente''%')
            or (column_name in ('alcance', 'base_tipo') and data_type = 'text' and is_nullable = 'NO')
            or (column_name in ('genero_id', 'mundo_id', 'proyeccion_referencia_id', 'perfil_id') and data_type = 'uuid' and is_nullable = 'YES')
            or (column_name in ('anio_aplicacion', 'version') and data_type = 'integer' and is_nullable = 'NO')
            or (column_name = 'aprobada_at' and data_type = 'timestamp with time zone' and is_nullable = 'NO' and column_default = 'now()')
            or (column_name = 'activo' and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'))) = 14 as ok;

\echo '--- ni alcance ni base_tipo llevan check de catalogo: solo hay checks de anio, version, estado, pct, nota, referencia y forma (esperado ok = t)'
select (select string_agg(conname, ',' order by conname) from pg_constraint
        where conrelid = 'public.crecimientos_genero_mundo'::regclass and contype = 'c')
     = 'crecimientos_genero_mundo_anio_check,crecimientos_genero_mundo_estado_check,crecimientos_genero_mundo_gm_check,crecimientos_genero_mundo_nota_len_check,crecimientos_genero_mundo_pct_check,crecimientos_genero_mundo_referencia_check,crecimientos_genero_mundo_resto_check,crecimientos_genero_mundo_version_check' as ok;

\echo '--- FK on delete: genero y mundo restrict, proyeccion_referencia y perfil set null (esperado ok = t)'
select (select string_agg(conname || ':' || confdeltype::text, ',' order by conname) from pg_constraint
        where conrelid = 'public.crecimientos_genero_mundo'::regclass and contype = 'f')
     = 'crecimientos_genero_mundo_genero_id_fkey:r,crecimientos_genero_mundo_mundo_id_fkey:r,crecimientos_genero_mundo_perfil_id_fkey:n,crecimientos_genero_mundo_proyeccion_referencia_id_fkey:n' as ok;

\echo '--- indices: dos unicos (version y vigente parcial) y uno por FK (esperado ok = t)'
select (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'crecimientos_genero_mundo'
          and indexname in ('crecimientos_genero_mundo_pkey', 'crecimientos_genero_mundo_version_uniq', 'crecimientos_genero_mundo_vigente_uniq',
                            'crecimientos_genero_mundo_genero_id_idx', 'crecimientos_genero_mundo_mundo_id_idx',
                            'crecimientos_genero_mundo_proyeccion_referencia_id_idx', 'crecimientos_genero_mundo_perfil_id_idx')) = 7
   and (select indexdef like '%WHERE (estado = ''vigente''::text)' from pg_indexes where indexname = 'crecimientos_genero_mundo_vigente_uniq')
   and (select indexdef like 'CREATE UNIQUE INDEX%coalesce%' or indexdef like 'CREATE UNIQUE INDEX%COALESCE%' from pg_indexes where indexname = 'crecimientos_genero_mundo_version_uniq') as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Comportamiento: updated_at, versionado (reemplazar la vigente), set null
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- trigger set_updated_at: al modificar una version, updated_at se refresca (esperado ok = t)'
update crecimientos_genero_mundo set updated_at = timestamptz '2000-01-01 00:00:00+00' where anio_aplicacion = 2028;
update crecimientos_genero_mundo set pct = 3.5 where anio_aplicacion = 2028;
select (select count(*) from pg_trigger where tgrelid = 'public.crecimientos_genero_mundo'::regclass and tgname = 'set_updated_at' and not tgisinternal) = 1
   and (select updated_at > timestamptz '2000-01-01 00:00:00+00' from crecimientos_genero_mundo where anio_aplicacion = 2028) as ok;

\echo '--- flujo de aprobar: la vigente pasa a reemplazada y entra la version siguiente como vigente (esperado ok = t)'
update crecimientos_genero_mundo set estado = 'reemplazada'
 where anio_aplicacion = 2027 and alcance = 'gm' and genero_id = (select g_h from ids) and mundo_id = (select m_u from ids) and estado = 'vigente';
insert into crecimientos_genero_mundo (anio_aplicacion, alcance, genero_id, mundo_id, version, pct, base_tipo, referencia)
select 2027, 'gm', g_h, m_u, 3, 17, 'acumulado', '{}'::jsonb from ids;
select (select count(*) from crecimientos_genero_mundo where anio_aplicacion = 2027 and alcance = 'gm' and genero_id = (select g_h from ids) and mundo_id = (select m_u from ids) and estado = 'vigente') = 1
   and (select count(*) from crecimientos_genero_mundo where anio_aplicacion = 2027 and alcance = 'gm' and genero_id = (select g_h from ids) and mundo_id = (select m_u from ids)) = 3 as ok;

\echo '--- perfil_id y proyeccion_referencia_id se guardan; al eliminarlos pasan a nulo y la version sobrevive con usuario_nombre (esperado ok = t)'
update crecimientos_genero_mundo
   set perfil_id = '00000000-0000-4000-8000-0000000000c1', usuario_nombre = 'Humo 27', proyeccion_referencia_id = (select p_b from ids)
 where anio_aplicacion = 2028;
select perfil_id is not null and proyeccion_referencia_id is not null from crecimientos_genero_mundo where anio_aplicacion = 2028;
delete from perfiles where id = '00000000-0000-4000-8000-0000000000c1';
delete from proyecciones where nombre = 'HUMO 27 B';
select perfil_id is null and proyeccion_referencia_id is null and usuario_nombre = 'Humo 27' as ok
from crecimientos_genero_mundo where anio_aplicacion = 2028;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. `proyeccion_crecimientos`: foto de lo aplicado (crecimiento_id y version)
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- columnas nuevas de proyeccion_crecimientos: crecimiento_id uuid null y version integer null, sin default (esperado ok = t)'
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'proyeccion_crecimientos' and column_default is null and is_nullable = 'YES'
          and ((column_name = 'crecimiento_id' and data_type = 'uuid')
            or (column_name = 'version' and data_type = 'integer'))) = 2 as ok;

\echo '--- una celda SIN las columnas nuevas queda con nulos: celda de 0.10.8, sin backfill (esperado ok = t)'
insert into proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
select p_a, g_m, m_u, 8 from ids;
select crecimiento_id is null and version is null as ok
from proyeccion_crecimientos c join ids on c.proyeccion_id = ids.p_a and c.genero_id = ids.g_m and c.mundo_id = ids.m_u;

\echo '--- una celda con crecimiento_id y version (foto de la v3 vigente) se guarda; version = 0 se rechaza; crecimiento_id inexistente se rechaza'
create temp table casos2 (n int, caso text, sentencia text, esperado_ok boolean, ok boolean);
insert into casos2 (n, caso, esperado_ok, sentencia) values
  (1, 'celda con crecimiento_id y version = 3', true,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, crecimiento_id, version)
       select i.p_a, i.g_h, i.m_u, c.pct, c.id, c.version from ids i
       join public.crecimientos_genero_mundo c on c.anio_aplicacion = 2027 and c.alcance = 'gm' and c.genero_id = i.g_h and c.mundo_id = i.m_u and c.estado = 'vigente' $q$),
  (2, 'version = 0 en la foto', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, version)
       select p_a, g_h, m_f, 1, 0 from ids $q$),
  (3, 'crecimiento_id inexistente (FK)', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, crecimiento_id)
       select p_a, g_h, m_f, 1, gen_random_uuid() from ids $q$),
  (4, 'eliminar una version usada por una foto (on delete restrict)', false,
   $q$ delete from public.crecimientos_genero_mundo where version = 3 and anio_aplicacion = 2027 and alcance = 'gm' $q$);
do $$
declare
  c record;
  v_aceptada boolean;
begin
  for c in select * from casos2 order by n loop
    begin
      execute c.sentencia;
      v_aceptada := true;
    exception when check_violation or unique_violation or foreign_key_violation or not_null_violation then
      v_aceptada := false;
    end;
    update casos2 set ok = (v_aceptada = esperado_ok) where n = c.n;
  end loop;
end
$$;
select n, caso, esperado_ok as debe_aceptarse, ok from casos2 order by n;

\echo '--- FK de proyeccion_crecimientos: crecimiento_id restrict y las de 0023 intactas; indice nuevo (esperado ok = t)'
select (select string_agg(conname || ':' || confdeltype::text, ',' order by conname) from pg_constraint
        where conrelid = 'public.proyeccion_crecimientos'::regclass and contype = 'f')
     = 'proyeccion_crecimientos_crecimiento_id_fkey:r,proyeccion_crecimientos_genero_id_fkey:r,proyeccion_crecimientos_mundo_id_fkey:r,proyeccion_crecimientos_perfil_id_fkey:n,proyeccion_crecimientos_proyeccion_id_fkey:c'
   and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'proyeccion_crecimientos_crecimiento_id_idx') as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Función `venta_genero_mundo(date)`
-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture de venta. Nodos: HOMBRE x URBANO (nh), MUJER x URBANO (nm) y MUJER x FORMAL (nf).
insert into tiendas (codigo, nombre, tipo) values
  ('HUMO27T1', 'HUMO 27 TIENDA 1', 'Tienda'),
  ('HUMO27T2', 'HUMO 27 TIENDA 2', 'Tienda'),
  ('HUMO27CD', 'HUMO 27 CD', 'Centro de Distribución');
insert into agrupaciones_estacionalidad (codigo, nombre, temporada, activo) values
  ('HUMO27INV', 'INVIERNO HUMO 27', 'invierno', true),
  ('HUMO27OFF', 'VERANO INACTIVA HUMO 27', 'verano', false);
insert into agrupaciones_talla (codigo, nombre) values ('HUMO27TA', 'TALLA A HUMO 27'), ('HUMO27TB', 'TALLA B HUMO 27');
insert into agrupaciones_marca (codigo, nombre) values ('HUMO27AG', 'AGRUPACION HUMO 27');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select 'HUMO27M', 'MARCA HUMO 27', id from agrupaciones_marca where codigo = 'HUMO27AG';

-- eqA: HOMBRE x URBANO, agrupacion INVIERNO activa. eqB: mismo nodo, sin agrupacion. eqC: MUJER x URBANO, agrupacion INACTIVA.
insert into equivalencias (genero_mundo_linea_id, codigo, nombre, agrupacion_estacionalidad_id)
select n.id, v.codigo, v.nombre, (select id from agrupaciones_estacionalidad where codigo = v.agr)
from (values ('HUMOH', 'HUMOU', 'EQA', 'EQUIVALENCIA A HUMO 27', 'HUMO27INV'),
             ('HUMOH', 'HUMOU', 'EQB', 'EQUIVALENCIA B HUMO 27', null),
             ('HUMOM', 'HUMOU', 'EQC', 'EQUIVALENCIA C HUMO 27', 'HUMO27OFF')) as v(g, m, codigo, nombre, agr)
join generos g on g.codigo = v.g
join mundos mu on mu.codigo = v.m
join genero_mundo_linea n on n.genero_id = g.id and n.mundo_id = mu.id
join lineas l on l.id = n.linea_id and l.codigo = 'HUMOL1';

-- Cargas: 2024-12, 2025-01 y 2025-02 publicadas; 2025-03 retirada (no cuenta).
insert into cargas_venta_stock (periodo, estado, publicada_at) values
  (date '2024-12-01', 'publicada', now()),
  (date '2025-01-01', 'publicada', now()),
  (date '2025-02-01', 'publicada', now()),
  (date '2025-03-01', 'retirada', now());

-- Venta (periodo, tienda, equivalencia, talla, unidades). eqA en 2025-01 de T1 va en DOS tallas: se suman (10 + 5).
create temp table venta_fixture (periodo date, tienda text, eq text, talla text, unidades int);
insert into venta_fixture values
  (date '2025-01-01', 'HUMO27T1', 'EQA', 'HUMO27TA', 10),
  (date '2025-01-01', 'HUMO27T1', 'EQA', 'HUMO27TB', 5),
  (date '2025-02-01', 'HUMO27T1', 'EQA', 'HUMO27TA', 7),
  (date '2025-01-01', 'HUMO27T2', 'EQA', 'HUMO27TA', 3),
  (date '2025-01-01', 'HUMO27T1', 'EQB', 'HUMO27TA', 4),
  (date '2025-01-01', 'HUMO27T1', 'EQC', 'HUMO27TA', -2),
  (date '2025-01-01', 'HUMO27CD', 'EQA', 'HUMO27TA', 100),
  (date '2024-12-01', 'HUMO27T1', 'EQA', 'HUMO27TA', 50),
  (date '2025-03-01', 'HUMO27T1', 'EQA', 'HUMO27TA', 999);
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades)
select c.id, t.id, e.id, (select id from marcas where codigo = 'HUMO27M'), ta.id, f.unidades
from venta_fixture f
join cargas_venta_stock c on c.periodo = f.periodo
join tiendas t on t.codigo = f.tienda
join equivalencias e on e.codigo = f.eq and e.nombre like 'EQUIVALENCIA % HUMO 27'
join agrupaciones_talla ta on ta.codigo = f.talla;

-- Atajo: la serie de una combinación (genero, mundo, temporada, tienda) como jsonb, o null si no existe.
create temp table res as select public.venta_genero_mundo(date '2025-01-01') as r;
create temp table res_dic as select public.venta_genero_mundo(date '2024-12-01') as r;
create or replace function pg_temp.serie(p_res jsonb, p_gen text, p_mun text, p_temp text, p_tienda text)
returns jsonb language sql as $$
  select s -> 'u'
  from jsonb_array_elements(p_res -> 'series') s
  where s ->> 'g' = (select id::text from generos where codigo = p_gen)
    and s ->> 'm' = (select id::text from mundos where codigo = p_mun)
    and s ->> 'temp' = p_temp
    and s ->> 't' = (select id::text from tiendas where codigo = p_tienda)
$$;

\echo '--- 4 series con p_desde = 2025-01-01: el CD, la carga retirada y diciembre de 2024 quedan fuera (esperado ok = t)'
select jsonb_array_length(r -> 'series') = 4 as ok from res;

\echo '--- HOMBRE x URBANO, invierno, T1: las dos tallas se suman (15) y febrero entra (7) (esperado ok = t)'
select pg_temp.serie(r, 'HUMOH', 'HUMOU', 'invierno', 'HUMO27T1') = '{"2025-01": 15, "2025-02": 7}'::jsonb as ok from res;

\echo '--- HOMBRE x URBANO, invierno, T2: otra tienda, otra serie (esperado ok = t)'
select pg_temp.serie(r, 'HUMOH', 'HUMOU', 'invierno', 'HUMO27T2') = '{"2025-01": 3}'::jsonb as ok from res;

\echo '--- HOMBRE x URBANO, equivalencia sin agrupacion: temporada sin_agrupacion, separada de invierno (esperado ok = t)'
select pg_temp.serie(r, 'HUMOH', 'HUMOU', 'sin_agrupacion', 'HUMO27T1') = '{"2025-01": 4}'::jsonb as ok from res;

\echo '--- MUJER x URBANO con agrupacion INACTIVA: temporada sin_agrupacion; neto negativo se conserva (esperado ok = t)'
select pg_temp.serie(r, 'HUMOM', 'HUMOU', 'sin_agrupacion', 'HUMO27T1') = '{"2025-01": -2}'::jsonb as ok from res;

\echo '--- ninguna serie es del centro de distribucion (esperado ok = t)'
select not exists (select 1 from jsonb_array_elements(r -> 'series') s where s ->> 't' = (select id::text from tiendas where codigo = 'HUMO27CD')) as ok from res;

\echo '--- p_desde = 2024-12-01 suma diciembre de 2024 a la serie de HOMBRE x URBANO invierno T1 (esperado ok = t)'
select pg_temp.serie(r, 'HUMOH', 'HUMOU', 'invierno', 'HUMO27T1') = '{"2024-12": 50, "2025-01": 15, "2025-02": 7}'::jsonb
   and jsonb_array_length(r -> 'series') = 4 as ok from res_dic;

\echo '--- cargas: periodo aaaa-mm -> carga_id de las tres cargas publicadas, sin la retirada y sin depender de p_desde (esperado ok = t)'
select (select array_agg(k order by k) from jsonb_object_keys(r -> 'cargas') k) = array['2024-12', '2025-01', '2025-02']
   and (r -> 'cargas' ->> '2025-01')::uuid = (select id from cargas_venta_stock where periodo = date '2025-01-01')
   and (r -> 'cargas') = (select r -> 'cargas' from res_dic) as ok from res;

\echo '--- el GM sale del arbol vigente: si eqC pasa de MUJER x URBANO a MUJER x FORMAL se lleva su historia (esperado ok = t)'
update equivalencias set genero_mundo_linea_id = (
  select n.id from genero_mundo_linea n join generos g on g.id = n.genero_id and g.codigo = 'HUMOM'
  join mundos mu on mu.id = n.mundo_id and mu.codigo = 'HUMOF')
 where nombre = 'EQUIVALENCIA C HUMO 27';
select pg_temp.serie(public.venta_genero_mundo(date '2025-01-01'), 'HUMOM', 'HUMOF', 'sin_agrupacion', 'HUMO27T1') = '{"2025-01": -2}'::jsonb
   and pg_temp.serie(public.venta_genero_mundo(date '2025-01-01'), 'HUMOM', 'HUMOU', 'sin_agrupacion', 'HUMO27T1') is null as ok;

\echo '--- sin venta desde esa fecha: series [] y cargas igual (esperado ok = t)'
select (public.venta_genero_mundo(date '2100-01-01') -> 'series') = '[]'::jsonb
   and jsonb_typeof(public.venta_genero_mundo(date '2100-01-01') -> 'cargas') = 'object' as ok;

\echo '--- determinismo: dos llamadas con los mismos datos dan el mismo documento (esperado ok = t)'
select public.venta_genero_mundo(date '2025-01-01') = public.venta_genero_mundo(date '2025-01-01') as ok;

\echo '--- la funcion es stable, security invoker, language sql y con search_path vacio (esperado ok = t)'
select p.provolatile = 's' and not p.prosecdef and l.lanname = 'sql' and p.proconfig = array['search_path=""'] as ok
from pg_proc p join pg_language l on l.oid = p.prolang
where p.oid = 'public.venta_genero_mundo(date)'::regprocedure;

\echo '--- permisos de la funcion: solo service_role ejecuta (esperado ok = t)'
select not has_function_privilege('anon', 'public.venta_genero_mundo(date)', 'execute')
   and not has_function_privilege('authenticated', 'public.venta_genero_mundo(date)', 'execute')
   and not has_function_privilege('public', 'public.venta_genero_mundo(date)', 'execute')
   and has_function_privilege('service_role', 'public.venta_genero_mundo(date)', 'execute') as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. RLS, permisos y comentarios
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- RLS activo y sin politicas en crecimientos_genero_mundo y proyeccion_crecimientos (esperado ok = t)'
select bool_and(c.relrowsecurity) and (select count(*) from pg_policies where schemaname = 'public' and tablename in ('crecimientos_genero_mundo', 'proyeccion_crecimientos')) = 0 as ok
from pg_class c where c.oid in ('public.crecimientos_genero_mundo'::regclass, 'public.proyeccion_crecimientos'::regclass);

\echo '--- permisos de la tabla: anon y authenticated sin ningun privilegio; service_role con todos (esperado ok = t)'
select not has_table_privilege('anon', 'public.crecimientos_genero_mundo', 'select,insert,update,delete,truncate,references,trigger')
   and not has_table_privilege('authenticated', 'public.crecimientos_genero_mundo', 'select,insert,update,delete')
   and has_table_privilege('service_role', 'public.crecimientos_genero_mundo', 'select,insert,update,delete') as ok;

\echo '--- comentarios: tabla, columnas clave, columnas nuevas de la foto y la funcion (esperado ok = t)'
select obj_description('public.crecimientos_genero_mundo'::regclass, 'pg_class') like 'M6 06d:%'
   and (select count(*) from pg_attribute a where a.attrelid = 'public.crecimientos_genero_mundo'::regclass and a.attnum > 0 and not a.attisdropped
          and col_description(a.attrelid, a.attnum) is null and a.attname in ('anio_aplicacion', 'alcance', 'estado', 'pct', 'base_tipo', 'base_valor', 'referencia', 'proyeccion_referencia_id', 'perfil_id', 'activo')) = 0
   and col_description('public.proyeccion_crecimientos'::regclass, (select attnum from pg_attribute where attrelid = 'public.proyeccion_crecimientos'::regclass and attname = 'crecimiento_id')) like 'M6 06d:%'
   and col_description('public.proyeccion_crecimientos'::regclass, (select attnum from pg_attribute where attrelid = 'public.proyeccion_crecimientos'::regclass and attname = 'version')) like 'M6 06d:%'
   and obj_description('public.venta_genero_mundo(date)'::regprocedure, 'pg_proc') like 'M6 06d:%' as ok;

rollback;
