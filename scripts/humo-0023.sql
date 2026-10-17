-- Humo SQL de la migración 0023 (M7 07c + 07d, crecimientos por género x mundo): la tabla `proyeccion_crecimientos`
-- (checks, único, FK, índices, trigger, RLS y permisos), las columnas `proyeccion_fila_anios.base_siguiente` y
-- `base_normalizada`, y los `comment on` (incluido `tiendas.venta_esperada_promedio`, de 07d).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0023.sql"
--
-- Como humo-0022.sql, NO necesita fixture previo: carga el suyo (un género, un mundo, una línea y su nodo, una agrupación de
-- marca, un perfil con su usuario de auth, dos proyecciones y una fila base con un registro de año). Todo inventado: nada de
-- datos reales de Lukers.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Cada comprobación imprime `ok = t`;
-- un `ok = f` es un fallo. Los casos que DEBEN fallar se prueban dentro de un bloque `do` con `exception` (es un script de
-- prueba local, no una migración): imprimen `ok = t` cuando la base los rechaza.
-- Nota local: el rol `service_role` del clúster local no tiene BYPASSRLS, así que los permisos de `service_role` se
-- comprueban con has_table_privilege.
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
from lineas l
join generos g on g.codigo = 'HUMOH'
join mundos mu on mu.codigo = 'HUMOU'
where l.codigo = 'HUMOL1';
insert into agrupaciones_marca (codigo, nombre) values ('HUMOPREM', 'PREMIUM HUMO');

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000b1', 'humo23@example.invalid');
insert into perfiles (id, email, nombre, rol) values ('00000000-0000-4000-8000-0000000000b1', 'humo23@example.invalid', 'Humo 23', 'planner');

insert into proyecciones (anio_en_curso, nombre, hasta_periodo, parametros) values
  (2026, 'HUMO 23 A', date '2026-06-01', '{"crecimiento_pct_defecto": 5}'::jsonb),
  (2026, 'HUMO 23 B', date '2026-06-01', '{}'::jsonb);

insert into proyeccion_filas (proyeccion_id, gml_id, agrupacion_marca_id, clave, nivel_proyectado, historico)
select p.id, n.id, a.id, 'humo23-fila-1', 'GML', '{}'::jsonb
from proyecciones p, genero_mundo_linea n, agrupaciones_marca a
where p.nombre = 'HUMO 23 A' and a.codigo = 'HUMOPREM'
  and n.linea_id = (select id from lineas where codigo = 'HUMOL1');

-- Un registro de año SIN indicar las columnas nuevas: deben quedar nulas (no hay default ni backfill).
insert into proyeccion_fila_anios (fila_id, anio, bloque)
select f.id, 2027, 'mismas' from proyeccion_filas f where f.clave = 'humo23-fila-1';

-- Casos de rechazo: cada uno intenta una sentencia y compara lo que ocurrió con lo esperado. Una sentencia que viola un
-- check, un NOT NULL, un único o una FK se anota como rechazada; una que corre sin error, como aceptada.
create temp table casos (n int, caso text, sentencia text, esperado_ok boolean, ok boolean);

-- Las sentencias van sin comillas dobladas: cada UUID se arma desde la propia base con subconsultas.
insert into casos (n, caso, esperado_ok, sentencia) values
  (1,  'celda valida (HOMBRE x URBANO, 20 %)', true,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, m.id, 20 from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 A' and g.codigo = 'HUMOH' and m.codigo = 'HUMOU' $q$),
  (2,  'misma celda otra vez (unico proyeccion x genero x mundo)', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, m.id, 10 from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 A' and g.codigo = 'HUMOH' and m.codigo = 'HUMOU' $q$),
  (3,  'mismo genero x mundo en OTRA proyeccion (permitido)', true,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, m.id, 7.5 from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 B' and g.codigo = 'HUMOH' and m.codigo = 'HUMOU' $q$),
  (4,  'otro mundo en la misma proyeccion (permitido), pct = -95 (limite inferior)', true,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, m.id, -95 from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 A' and g.codigo = 'HUMOH' and m.codigo = 'HUMOF' $q$),
  (5,  'pct = 500 (limite superior)', true,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, m.id, 500 from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 A' and g.codigo = 'HUMOM' and m.codigo = 'HUMOU' $q$),
  (6,  'pct = -95.01 (bajo el rango)', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, m.id, -95.01 from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 B' and g.codigo = 'HUMOM' and m.codigo = 'HUMOF' $q$),
  (7,  'pct = 500.01 (sobre el rango)', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, m.id, 500.01 from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 B' and g.codigo = 'HUMOM' and m.codigo = 'HUMOF' $q$),
  (8,  'pct nulo', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, m.id, null from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 B' and g.codigo = 'HUMOM' and m.codigo = 'HUMOF' $q$),
  (9,  'nota de 300 caracteres', true,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, nota)
       select p.id, g.id, m.id, 0, repeat('n', 300) from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 B' and g.codigo = 'HUMOM' and m.codigo = 'HUMOU' $q$),
  (10, 'nota de 301 caracteres', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, nota)
       select p.id, g.id, m.id, 0, repeat('n', 301) from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 B' and g.codigo = 'HUMOM' and m.codigo = 'HUMOF' $q$),
  (11, 'proyeccion_id inexistente (FK)', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select gen_random_uuid(), g.id, m.id, 1 from public.generos g, public.mundos m
       where g.codigo = 'HUMOM' and m.codigo = 'HUMOF' $q$),
  (12, 'genero_id inexistente (FK)', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, gen_random_uuid(), m.id, 1 from public.proyecciones p, public.mundos m
       where p.nombre = 'HUMO 23 B' and m.codigo = 'HUMOF' $q$),
  (13, 'mundo_id inexistente (FK)', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct)
       select p.id, g.id, gen_random_uuid(), 1 from public.proyecciones p, public.generos g
       where p.nombre = 'HUMO 23 B' and g.codigo = 'HUMOM' $q$),
  (14, 'perfil_id inexistente (FK)', false,
   $q$ insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, perfil_id)
       select p.id, g.id, m.id, 1, gen_random_uuid() from public.proyecciones p, public.generos g, public.mundos m
       where p.nombre = 'HUMO 23 B' and g.codigo = 'HUMOM' and m.codigo = 'HUMOF' $q$),
  (15, 'eliminar un genero usado por una celda (on delete restrict)', false,
   $q$ delete from public.generos where codigo = 'HUMOM' $q$),
  (16, 'eliminar un mundo usado por una celda (on delete restrict)', false,
   $q$ delete from public.mundos where codigo = 'HUMOF' $q$),
  (17, 'base_siguiente = 0', true,
   $q$ update public.proyeccion_fila_anios set base_siguiente = 0 $q$),
  (18, 'base_siguiente = 17800', true,
   $q$ update public.proyeccion_fila_anios set base_siguiente = 17800 $q$),
  (19, 'base_siguiente = -1', false,
   $q$ update public.proyeccion_fila_anios set base_siguiente = -1 $q$),
  (20, 'base_siguiente de nuevo a nulo (sin base o sin curva)', true,
   $q$ update public.proyeccion_fila_anios set base_siguiente = null $q$),
  (21, 'base_normalizada = 0', true,
   $q$ update public.proyeccion_fila_anios set base_normalizada = 0 $q$),
  (22, 'base_normalizada = 19500.55 (dos decimales)', true,
   $q$ update public.proyeccion_fila_anios set base_normalizada = 19500.55 $q$),
  (23, 'base_normalizada = -0.01', false,
   $q$ update public.proyeccion_fila_anios set base_normalizada = -0.01 $q$),
  (24, 'base_normalizada de nuevo a nulo', true,
   $q$ update public.proyeccion_fila_anios set base_normalizada = null $q$);

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

\echo '--- casos de checks, unico y FK: cada sentencia se acepta o se rechaza como corresponde (esperado: todas las filas ok = t)'
select n, caso, esperado_ok as debe_aceptarse, ok from casos order by n;

-- ---------------------------------------------------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- columnas de proyeccion_crecimientos: id, proyeccion_id, genero_id, mundo_id, pct, nota, perfil_id, usuario_nombre, activo, created_at, updated_at (esperado ok = t)'
select (select string_agg(column_name, ',' order by column_name) from information_schema.columns
        where table_schema = 'public' and table_name = 'proyeccion_crecimientos')
     = 'activo,created_at,genero_id,id,mundo_id,nota,pct,perfil_id,proyeccion_id,updated_at,usuario_nombre' as ok;

\echo '--- tipos y nulabilidad: pct numeric(6,2) not null; activo not null default true; nota, perfil_id y usuario_nombre nulos (esperado ok = t)'
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'proyeccion_crecimientos'
          and ((column_name = 'pct' and data_type = 'numeric' and numeric_precision = 6 and numeric_scale = 2 and is_nullable = 'NO')
            or (column_name = 'activo' and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true')
            or (column_name in ('proyeccion_id', 'genero_id', 'mundo_id') and data_type = 'uuid' and is_nullable = 'NO')
            or (column_name in ('nota', 'usuario_nombre') and data_type = 'text' and is_nullable = 'YES')
            or (column_name = 'perfil_id' and data_type = 'uuid' and is_nullable = 'YES'))) = 8 as ok;

\echo '--- columnas nuevas de proyeccion_fila_anios: base_siguiente integer null, base_normalizada numeric(14,2) null, sin default (esperado ok = t)'
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'proyeccion_fila_anios' and column_default is null and is_nullable = 'YES'
          and ((column_name = 'base_siguiente' and data_type = 'integer')
            or (column_name = 'base_normalizada' and data_type = 'numeric' and numeric_precision = 14 and numeric_scale = 2))) = 2 as ok;

\echo '--- el registro de año insertado sin las columnas nuevas las dejó nulas (sin backfill): ya se probo con los casos 20 y 24; aqui una fila nueva (esperado ok = t)'
insert into proyeccion_fila_anios (fila_id, anio, bloque)
select f.id, 2028, 'mismas' from proyeccion_filas f where f.clave = 'humo23-fila-1';
select base_siguiente is null and base_normalizada is null as ok from proyeccion_fila_anios where anio = 2028;

\echo '--- FK on delete: proyeccion cascade, genero y mundo restrict, perfil set null (esperado ok = t)'
select (select string_agg(conname || ':' || confdeltype::text, ',' order by conname) from pg_constraint
        where conrelid = 'public.proyeccion_crecimientos'::regclass and contype = 'f')
     = 'proyeccion_crecimientos_genero_id_fkey:r,proyeccion_crecimientos_mundo_id_fkey:r,proyeccion_crecimientos_perfil_id_fkey:n,proyeccion_crecimientos_proyeccion_id_fkey:c' as ok;

\echo '--- indices: genero_id, mundo_id, perfil_id y el unico de la celda (esperado ok = t)'
select (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'proyeccion_crecimientos'
          and indexname in ('proyeccion_crecimientos_genero_id_idx', 'proyeccion_crecimientos_mundo_id_idx',
                            'proyeccion_crecimientos_perfil_id_idx', 'proyeccion_crecimientos_celda_key',
                            'proyeccion_crecimientos_pkey')) = 5 as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- Comportamiento: updated_at, perfil set null, cascada
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- trigger set_updated_at: al modificar una celda, updated_at se refresca (esperado ok = t)'
update proyeccion_crecimientos set updated_at = timestamptz '2000-01-01 00:00:00+00' where pct = 20;
update proyeccion_crecimientos set pct = 21 where pct = 20;
select (select count(*) from pg_trigger where tgrelid = 'public.proyeccion_crecimientos'::regclass and tgname = 'set_updated_at' and not tgisinternal) = 1
   and (select updated_at > timestamptz '2000-01-01 00:00:00+00' from proyeccion_crecimientos where pct = 21) as ok;

\echo '--- perfil_id y usuario_nombre se guardan, y al eliminar el perfil perfil_id pasa a nulo conservando usuario_nombre (esperado ok = t)'
update proyeccion_crecimientos set perfil_id = '00000000-0000-4000-8000-0000000000b1', usuario_nombre = 'Humo 23' where pct = 21;
delete from perfiles where id = '00000000-0000-4000-8000-0000000000b1';
select perfil_id is null and usuario_nombre = 'Humo 23' as ok from proyeccion_crecimientos where pct = 21;

\echo '--- al eliminar una proyeccion se van sus celdas y las de la otra se quedan (esperado ok = t)'
select (select count(*) from proyeccion_crecimientos c join proyecciones p on p.id = c.proyeccion_id where p.nombre = 'HUMO 23 A') = 3
   and (select count(*) from proyeccion_crecimientos c join proyecciones p on p.id = c.proyeccion_id where p.nombre = 'HUMO 23 B') = 2 as ok;
delete from proyecciones where nombre = 'HUMO 23 A';
select (select count(*) from proyeccion_crecimientos c join proyecciones p on p.id = c.proyeccion_id where p.nombre = 'HUMO 23 A') = 0
   and (select count(*) from proyeccion_crecimientos) = 2 as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- RLS, permisos y comentarios
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- RLS activo y sin politicas en proyeccion_crecimientos (esperado ok = t)'
select relrowsecurity and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'proyeccion_crecimientos') = 0 as ok
from pg_class where oid = 'public.proyeccion_crecimientos'::regclass;

\echo '--- permisos: anon y authenticated sin ningun privilegio; service_role con todos (esperado ok = t)'
select not has_table_privilege('anon', 'public.proyeccion_crecimientos', 'select,insert,update,delete,truncate,references,trigger')
   and not has_table_privilege('authenticated', 'public.proyeccion_crecimientos', 'select')
   and not has_table_privilege('authenticated', 'public.proyeccion_crecimientos', 'insert')
   and not has_table_privilege('authenticated', 'public.proyeccion_crecimientos', 'update')
   and not has_table_privilege('authenticated', 'public.proyeccion_crecimientos', 'delete')
   and not has_table_privilege('anon', 'public.proyeccion_crecimientos', 'select')
   and has_table_privilege('service_role', 'public.proyeccion_crecimientos', 'select')
   and has_table_privilege('service_role', 'public.proyeccion_crecimientos', 'insert')
   and has_table_privilege('service_role', 'public.proyeccion_crecimientos', 'update')
   and has_table_privilege('service_role', 'public.proyeccion_crecimientos', 'delete') as ok;

\echo '--- ninguna funcion nueva: la migracion no crea funciones (esperado ok = t)'
select count(*) = 0 as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname ilike '%crecimiento%';

\echo '--- comentarios: tabla, pct, perfil_id, activo, base_siguiente, base_normalizada y tiendas.venta_esperada_promedio (esperado ok = t)'
select obj_description('public.proyeccion_crecimientos'::regclass, 'pg_class') is not null
   and col_description('public.proyeccion_crecimientos'::regclass, (select attnum from pg_attribute where attrelid = 'public.proyeccion_crecimientos'::regclass and attname = 'pct')) like '%BRUTA%'
   and col_description('public.proyeccion_crecimientos'::regclass, (select attnum from pg_attribute where attrelid = 'public.proyeccion_crecimientos'::regclass and attname = 'perfil_id')) is not null
   and col_description('public.proyeccion_crecimientos'::regclass, (select attnum from pg_attribute where attrelid = 'public.proyeccion_crecimientos'::regclass and attname = 'activo')) is not null
   and col_description('public.proyeccion_fila_anios'::regclass, (select attnum from pg_attribute where attrelid = 'public.proyeccion_fila_anios'::regclass and attname = 'base_siguiente')) like 'M7 07c%'
   and col_description('public.proyeccion_fila_anios'::regclass, (select attnum from pg_attribute where attrelid = 'public.proyeccion_fila_anios'::regclass and attname = 'base_normalizada')) like 'M7 07c%' as ok;

\echo '--- comentario de tiendas.venta_esperada_promedio: dice 0.10.8, mensual y sin IGV, y ya no es el de la 0021 (esperado ok = t)'
select c like 'M4/M7 0.10.8: venta mensual promedio esperada%' and c like '%sin IGV%' and c not like '%0.10.1: soles%' as ok
from (select col_description('public.tiendas'::regclass, attnum) c from pg_attribute where attrelid = 'public.tiendas'::regclass and attname = 'venta_esperada_promedio') z;

rollback;
