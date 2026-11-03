-- Humo SQL de la migración 0031 (M7 07g, aprobación en bloque de la proyección, versión 0.15.0 · M7 c):
--   * las 2 tablas nuevas: RLS sin políticas, permisos, sin `activo` ni `updated_at`, checks estructurales, ausencia de
--     checks de catálogo (`tipo` solo con el check de pareja con `revierte_lote_id`), identificadores <= 63;
--   * FK diferibles (`proyeccion_lote_filas.lote_id` y `proyeccion_fila_anios.decision_lote_id`) y su comportamiento al
--     comprometer (R19): sin cabecera, la comprobación falla; con la cabecera insertada después, pasa;
--   * `check` de `decision_lote_id` (implica decidido no nulo);
--   * inmutabilidad (R19): update, delete y truncate fallan también con `service_role`; solo se admite poner en NULL una FK
--     `set null` (perfil, proyección, fila), de verdad con el `delete` del padre;
--   * `aplicar_lote_proyeccion`: aprobar por método, reaprobar, revertir, grupo IA entero o nada, método atómico por fila,
--     lista fija de columnas, `updated_at` exacto (1 microsegundo de diferencia), `registros_lectura`, `activo`, propuesta
--     vigente con el orden `created_at desc, id asc`, idempotencia (`repetido`, `lote_ajeno`), estado, cálculo vivo y
--     `calculado_at` (LP001 a LP008), errores que deshacen todo (R10), `resumen` calculado en SQL = `proyeccion_lote_filas`
--     (R19), permisos (`service_role` sí; `anon` y `authenticated` no).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0031.sql"
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- NO cubre la concurrencia real entre dos sesiones (todo corre en una transacción): esa se probó a mano con dos sesiones
-- `psql` (mismo `lote_id` en paralelo -> uno aplica y el otro `repetido`; mismo `lote_id` en otra proyección -> LP004 por la
-- ruta de `unique_violation`). Ver el informe de la tanda.
--
-- Carga su propio fixture (género, mundo, línea, nodo GML, agrupaciones, dos proyecciones, siete filas base con sus registros
-- de 2026 y 2027, tres propuestas de IA con sus filas, dos perfiles). Todo inventado: nada de datos reales de Lukers.
--
-- Contra PRODUCCIÓN solo se corren, por SELECT de solo lectura, las comprobaciones de estructura (sección 1): el resto
-- inserta datos de prueba y es solo para la base local.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito.
\set ON_ERROR_STOP off
\pset pager off
begin;

create temp table r (n serial, caso text, ok boolean);

-- Ayudante: ejecuta una sentencia y devuelve true si falló con un mensaje que cumple el patrón (o con cualquier mensaje si el
-- patrón es nulo).
create or replace function pg_temp.falla(t text, patron text default null) returns boolean language plpgsql as $f$
begin
  execute t;
  return false;
exception when others then
  if patron is not null and sqlerrm not like patron then
    raise notice 'falla con otro mensaje: % -> %', t, sqlerrm;
  end if;
  return patron is null or sqlerrm like patron;
end
$f$;

create or replace function pg_temp.msg(t text) returns text language plpgsql as $f$
begin
  execute t;
  return null;
exception when others then
  return sqlerrm;
end
$f$;

create or replace function pg_temp.acepta(t text) returns boolean language plpgsql as $f$
begin
  execute t;
  return true;
exception when others then
  raise notice 'acepta fallo: % -> %', t, sqlerrm;
  return false;
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura  [solo lectura: también vale contra producción]
-- ---------------------------------------------------------------------------------------------------------------------
create temp table tablas_lote (n text);
insert into tablas_lote values ('proyeccion_lotes'), ('proyeccion_lote_filas');

insert into r (caso, ok) values
  ('existen las 2 tablas nuevas',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relkind = 'r' and c.relname in (select n from tablas_lote)) = 2),
  ('las 2 tablas tienen RLS activo y ninguna tiene politicas',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relname in (select n from tablas_lote) and c.relrowsecurity) = 2
    and (select count(*) from pg_policies where schemaname = 'public' and tablename in (select n from tablas_lote)) = 0),
  ('anon y authenticated sin ningun permiso sobre las 2 tablas; service_role con select, insert, update y delete',
    (select count(*) from tablas_lote t, unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p(priv)
      where has_table_privilege('anon', 'public.' || t.n, p.priv) or has_table_privilege('authenticated', 'public.' || t.n, p.priv)) = 0
    and (select count(*) from tablas_lote t, unnest(array['select', 'insert', 'update', 'delete']) p(priv)
      where not has_table_privilege('service_role', 'public.' || t.n, p.priv)) = 0),
  ('las 2 tablas inmutables NO llevan activo ni updated_at',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name in (select n from tablas_lote)
       and column_name in ('activo', 'updated_at')) = 0),
  ('proyeccion_lotes.id es la clave primaria proyeccion_lotes_pkey y no tiene default (lo genera el navegador)',
    (select count(*) from pg_constraint where conrelid = 'public.proyeccion_lotes'::regclass and contype = 'p' and conname = 'proyeccion_lotes_pkey') = 1
    and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proyeccion_lotes'
           and column_name = 'id' and column_default is null) = 1),
  ('ningun check de catalogo en fuente ni resultado; tipo solo en el check de pareja con revierte_lote_id',
    not exists (select 1 from pg_constraint
                 where contype = 'c' and conrelid in (select ('public.' || n)::regclass from tablas_lote)
                   and pg_get_constraintdef(oid) ~ '\m(fuente|resultado)\M' and pg_get_constraintdef(oid) !~ 'char_length')
    and (select count(*) from pg_constraint
          where contype = 'c' and conrelid = 'public.proyeccion_lotes'::regclass and pg_get_constraintdef(oid) ~ '\mtipo\M') = 1
    and exists (select 1 from pg_constraint where conname = 'proyeccion_lotes_revierte_tipo_check')),
  ('decision_lote_id: uuid nullable, sin default',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proyeccion_fila_anios'
       and column_name = 'decision_lote_id' and data_type = 'uuid' and is_nullable = 'YES' and column_default is null) = 1),
  ('FK diferibles (deferrable initially deferred): lote_filas.lote_id y fila_anios.decision_lote_id, ambas on delete restrict',
    (select count(*) from pg_constraint
      where contype = 'f' and conname in ('proyeccion_lote_filas_lote_id_fkey', 'proyeccion_fila_anios_decision_lote_id_fkey')
        and condeferrable and condeferred and confdeltype = 'r' and confrelid = 'public.proyeccion_lotes'::regclass) = 2),
  ('las demas FK de proyeccion_lotes no son diferibles: proyeccion_id y perfil_id set null; revierte_lote_id restrict',
    (select count(*) from pg_constraint where contype = 'f' and conrelid = 'public.proyeccion_lotes'::regclass and not condeferrable
       and ((conname in ('proyeccion_lotes_proyeccion_id_fkey', 'proyeccion_lotes_perfil_id_fkey') and confdeltype = 'n')
         or (conname = 'proyeccion_lotes_revierte_lote_id_fkey' and confdeltype = 'r'))) = 3),
  ('fila_id de lote_filas es set null; propuesta_fila_id es restrict',
    (select count(*) from pg_constraint where contype = 'f' and conrelid = 'public.proyeccion_lote_filas'::regclass
       and ((conname = 'proyeccion_lote_filas_fila_id_fkey' and confdeltype = 'n')
         or (conname = 'proyeccion_lote_filas_propuesta_fila_id_fkey' and confdeltype = 'r'))) = 2),
  ('el check de decision_lote_id existe: decision_lote_id nulo o decidido no nulo',
    (select count(*) from pg_constraint where conrelid = 'public.proyeccion_fila_anios'::regclass and contype = 'c'
       and conname = 'proyeccion_fila_anios_decision_lote_decidido_check'
       and pg_get_constraintdef(oid) like '%decision_lote_id IS NULL%decidido IS NOT NULL%') = 1),
  ('unico (lote_id, fila_clave, anio) en lote_filas',
    (select count(*) from pg_constraint where conrelid = 'public.proyeccion_lote_filas'::regclass and contype = 'u'
       and conname = 'proyeccion_lote_filas_lote_fila_anio_key') = 1),
  ('las 3 funciones nuevas y el trigger: security invoker, search_path vacio y execute solo para service_role',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public'
        and p.proname in ('aplicar_lote_proyeccion', 'respuesta_lote_proyeccion', 'tg_proyeccion_lote_inmutable')
        and not p.prosecdef
        and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path='))
        and not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and has_function_privilege('service_role', p.oid, 'execute')) = 3),
  ('los cuerpos de las 3 funciones no tienen comentarios -- (el SQL Editor los parsea mal)',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('aplicar_lote_proyeccion', 'respuesta_lote_proyeccion', 'tg_proyeccion_lote_inmutable')
        and p.prosrc like '%--%') = 0),
  ('4 triggers de inmutabilidad: por fila (update, delete) y por sentencia (truncate) en las 2 tablas',
    (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgrelid in (select ('public.' || n)::regclass from tablas_lote)
        and t.tgname in ('proyeccion_lotes_inmutable', 'proyeccion_lote_filas_inmutable') and (t.tgtype & 1) = 1
        and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16 and (t.tgtype & 2) = 2) = 2
    and (select count(*) from pg_trigger t
      where not t.tgisinternal and t.tgrelid in (select ('public.' || n)::regclass from tablas_lote)
        and t.tgname in ('proyeccion_lotes_sin_vaciado', 'proyeccion_lote_filas_sin_vaciado') and (t.tgtype & 1) = 0
        and (t.tgtype & 32) = 32 and (t.tgtype & 2) = 2) = 2),
  ('lista fija de columnas (R14): cada columna de proyeccion_fila_anios salvo id, fila_id, anio, activo, created_at y updated_at se asigna con la clausula de set, y esas 6 nunca',
    not exists (select 1 from information_schema.columns c, pg_proc p
                 where c.table_schema = 'public' and c.table_name = 'proyeccion_fila_anios'
                   and c.column_name not in ('id', 'fila_id', 'anio', 'activo', 'created_at', 'updated_at')
                   and p.proname = 'aplicar_lote_proyeccion'
                   and p.prosrc not like '%' || c.column_name || ' = case when v_set ? ''' || c.column_name || '''%')
    and not exists (select 1 from pg_proc p
                     where p.proname = 'aplicar_lote_proyeccion'
                       and p.prosrc ~ '(^|[^_a-z])(id|fila_id|anio|activo|created_at|updated_at) = case when'))
  ,
  ('la clausula update de la funcion tiene exactamente 26 columnas',
    (select (length(p.prosrc) - length(replace(p.prosrc, ' = case when v_set ? ''', ''))) / length(' = case when v_set ? ''')
       from pg_proc p where p.proname = 'aplicar_lote_proyeccion') = 26),
  ('todos los identificadores de las 2 tablas miden <= 63 caracteres (sin truncar)',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relname like 'proyeccion\_lote%' and length(c.relname) > 63) = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into generos (codigo, nombre) values ('H31H', 'HOMBRE H31');
insert into mundos (codigo, nombre) values ('H31U', 'URBANO H31');
insert into lineas (codigo, nombre, temporada) values ('H31L1', 'LINEA UNO H31', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML' from lineas l, generos g, mundos mu where l.codigo = 'H31L1' and g.codigo = 'H31H' and mu.codigo = 'H31U';
insert into agrupaciones_marca (codigo, nombre) values ('H31AG1', 'AGRUPACION UNO H31');

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000d1', 'humo31a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000d2', 'humo31b@example.invalid');
insert into perfiles (id, email, nombre, rol) values
  ('00000000-0000-4000-8000-0000000000d1', 'humo31a@example.invalid', 'Humo 31 A', 'admin'),
  ('00000000-0000-4000-8000-0000000000d2', 'humo31b@example.invalid', 'Humo 31 B', 'planner');

-- Dos proyecciones en trabajo, ya calculadas (calculado_at con microsegundos, para probar la comparacion exacta).
insert into proyecciones (anio_en_curso, nombre, hasta_periodo, parametros, calculado_at) values
  (2026, 'HUMO 31 A', date '2026-09-01', '{}'::jsonb, timestamptz '2026-11-01 09:00:00.654321+00'),
  (2026, 'HUMO 31 B', date '2026-09-01', '{}'::jsonb, timestamptz '2026-11-01 09:00:00.111111+00');

-- A: F1..F4 en GM-UNO y F5..F7 en GM-DOS (el GM es solo la clave del grupo). B: una fila.
insert into proyeccion_filas (proyeccion_id, gml_id, agrupacion_marca_id, clave, nivel_proyectado, historico)
select p.id, n.id, a.id, v.clave, 'GML', '{}'::jsonb
from proyecciones p, genero_mundo_linea n, agrupaciones_marca a,
     (values ('HUMO 31 A', 'H31-F1'), ('HUMO 31 A', 'H31-F2'), ('HUMO 31 A', 'H31-F3'), ('HUMO 31 A', 'H31-F4'),
             ('HUMO 31 A', 'H31-F5'), ('HUMO 31 A', 'H31-F6'), ('HUMO 31 A', 'H31-F7'), ('HUMO 31 B', 'H31-B1')) as v(proy, clave)
where a.codigo = 'H31AG1' and p.nombre = v.proy
  and n.linea_id = (select id from lineas where codigo = 'H31L1');

-- Registros 2026 (propuesto 1000) y 2027 (propuesto 1100). `updated_at` fijado con microsegundos distintos por registro.
insert into proyeccion_fila_anios (fila_id, anio, bloque, vendido, propuesto, metodo, updated_at)
select f.id, a.anio, 'mismas', 100, case a.anio when 2026 then 1000 else 1100 end, 'avance',
       timestamptz '2026-11-01 08:00:00.100000+00' + (row_number() over (order by f.clave, a.anio)) * interval '1 millisecond' + interval '37 microseconds'
from proyeccion_filas f cross join (values (2026), (2027)) as a(anio);

-- F4 decidida a mano en los dos años (decision_lote_id nulo).
update proyeccion_fila_anios a
   set decidido = 3300, origen = 'manual', decidido_at = now(), decidido_por_nombre = 'a mano'
  from proyeccion_filas f
 where f.id = a.fila_id and f.clave = 'H31-F4';

-- IA: una corrida completa de A con un GM hecho, y tres propuestas de GM-UNO: una antigua y dos con el MISMO created_at (la
-- vigente es la de menor id: orden `created_at desc, id asc`).
insert into ia_corridas (tipo, proyeccion_id, proveedor, modelo, version_prompt, alcance, costo_estimado_usd, estado)
select 'propuesta', p.id, 'proveedor-x', 'modelo-1', 'v1', '{}'::jsonb, 0, 'completa' from proyecciones p where p.nombre = 'HUMO 31 A';
insert into ia_corrida_gms (corrida_id, gm_clave, estado) select id, 'GM-UNO', 'hecho' from ia_corridas;
insert into ia_propuestas_gm (corrida_id, corrida_gm_id, proyeccion_id, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo,
    version_metodo, huella_gm, huella_historia, filas_pedidas, filas_validas, proveedor, modelo, version_prompt, created_at)
select c.id, g.id, c.proyeccion_id, 'GM-UNO', ge.id, mu.id, false, array['distribucion_y1'], 'directo', 5, repeat('1', 64), repeat('2', 64),
       3, 3, 'proveedor-x', 'modelo-1', 'v1', v.creada
from ia_corridas c, ia_corrida_gms g, generos ge, mundos mu,
     (values (timestamptz '2026-11-01 09:30:00+00'), (timestamptz '2026-11-01 10:00:00+00'), (timestamptz '2026-11-01 10:00:00+00')) as v(creada)
where ge.codigo = 'H31H' and mu.codigo = 'H31U';
insert into ia_propuestas_filas (propuesta_gm_id, fila_id, fila_clave, estado_meta)
select p.id, f.id, f.clave, case f.clave when 'H31-F4' then 'fija_decidida' else 'libre' end
from ia_propuestas_gm p, proyeccion_filas f
where f.clave in ('H31-F1', 'H31-F2', 'H31-F3', 'H31-F4');

create temp table ids as
select
  (select id from proyecciones where nombre = 'HUMO 31 A') as proy_a,
  (select id from proyecciones where nombre = 'HUMO 31 B') as proy_b,
  '00000000-0000-4000-8000-0000000000d1'::uuid as perfil_a,
  '00000000-0000-4000-8000-0000000000d2'::uuid as perfil_b,
  (select id from ia_propuestas_gm order by created_at desc, id asc limit 1) as p_vig,
  (select id from ia_propuestas_gm order by created_at desc, id desc limit 1) as p_empate,
  (select id from ia_propuestas_gm order by created_at asc limit 1) as p_antigua;

insert into r (caso, ok) values
  ('fixture: la propuesta vigente (created_at desc, id asc) no es ni la antigua ni la del empate',
    (select p_vig <> p_empate and p_vig <> p_antigua and p_empate <> p_antigua from ids));

-- ---------------------------------------------------------------------------------------------------------------------
-- Ayudantes del payload (imitan lo que hace TypeScript: la foto con updated_at en texto ISO con microsegundos)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function pg_temp.id(n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;

create or replace function pg_temp.iso(t timestamptz) returns text language sql as $f$
  select to_char(t at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"') $f$;

-- Registro del payload. `p_desfase` mueve el updated_at esperado (un microsegundo basta para que sea otro).
create or replace function pg_temp.reg(p_clave text, p_anio integer, p_obj boolean, p_set jsonb default '{}'::jsonb,
                                       p_desfase interval default interval '0') returns jsonb language sql as $f$
  select jsonb_build_object('id', a.id, 'updated_at_esperado', pg_temp.iso(a.updated_at + p_desfase), 'objetivo', p_obj, 'set', p_set)
    from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id
   where f.clave = p_clave and a.anio = p_anio $f$;

create or replace function pg_temp.fila(p_clave text, p_anio integer, p_fuente text, p_valor integer, p_regs jsonb,
                                        p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('fila_id', f.id, 'fila_clave', f.clave, 'anio', p_anio, 'fuente', p_fuente, 'valor', p_valor, 'registros', p_regs) || p_extra
    from public.proyeccion_filas f where f.clave = p_clave $f$;

create or replace function pg_temp.lectura(p_claves text[]) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'updated_at_esperado', pg_temp.iso(a.updated_at)) order by f.clave, a.anio), '[]'::jsonb)
    from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id
   where f.clave = any (p_claves) $f$;

create or replace function pg_temp.lote(p_id uuid, p_tipo text, p_proy uuid default null, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('id', p_id, 'confirmacion_id', gen_random_uuid(), 'proyeccion_id', pr.id, 'tipo', p_tipo, 'anio', 2026,
           'huella_cuerpo', md5(p_id::text) || md5('humo31'), 'calculado_at_esperado', pg_temp.iso(pr.calculado_at),
           'filtro', '{"genero": "H31H"}'::jsonb, 'efecto_gm_previsto', '[{"gm_clave": "GM-UNO"}]'::jsonb, 'revision_confirmada', true,
           'propuestas_gm', '[]'::jsonb, 'nota', 'humo', 'perfil_id', (select perfil_a from ids), 'usuario_nombre', 'Humo 31') || p_extra
    from public.proyecciones pr where pr.id = coalesce(p_proy, (select proy_a from ids)) $f$;

create or replace function pg_temp.grupo(p_tipo text, p_gm text, p_filas jsonb, p_lectura jsonb default '[]'::jsonb, p_prop uuid default null)
  returns jsonb language sql as $f$
  select jsonb_build_object('tipo', p_tipo, 'gm_clave', p_gm, 'registros_lectura', p_lectura, 'filas', p_filas)
         || case when p_prop is null then '{}'::jsonb else jsonb_build_object('propuesta_gm_id', p_prop) end $f$;

create or replace function pg_temp.payload(p_lote jsonb, p_grupos jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('lote', p_lote, 'grupos', p_grupos) $f$;

create or replace function pg_temp.set_met(p_valor integer, p_lote uuid) returns jsonb language sql as $f$
  select jsonb_build_object('decidido', p_valor, 'origen', 'propuesta', 'propuesta_al_decidir', p_valor, 'nota', null,
           'decidido_at', now(), 'decidido_por_id', (select perfil_a from ids), 'decidido_por_nombre', 'Humo 31',
           'decision_ia_fila_id', null, 'decision_lote_id', p_lote) $f$;

create or replace function pg_temp.set_ia(p_valor integer, p_lote uuid, p_ipf uuid) returns jsonb language sql as $f$
  select jsonb_build_object('decidido', p_valor, 'origen', 'manual', 'propuesta_al_decidir', p_valor + 10, 'nota', null,
           'decidido_at', now(), 'decidido_por_id', (select perfil_a from ids), 'decidido_por_nombre', 'Humo 31',
           'decision_ia_fila_id', p_ipf, 'decision_lote_id', p_lote) $f$;

create or replace function pg_temp.set_rev() returns jsonb language sql as $f$
  select jsonb_build_object('decidido', null, 'origen', null, 'propuesta_al_decidir', null, 'nota', null, 'decidido_at', null,
           'decidido_por_id', null, 'decidido_por_nombre', null, 'decision_ia_fila_id', null, 'decision_lote_id', null) $f$;

create or replace function pg_temp.ipf(p_prop uuid, p_clave text) returns uuid language sql as $f$
  select id from public.ia_propuestas_filas where propuesta_gm_id = p_prop and fila_clave = p_clave $f$;

-- Fila de IA: objetivo 2027 con la traza de su propuesta.
create or replace function pg_temp.fila_ia(p_clave text, p_valor integer, p_lote uuid, p_prop uuid, p_extra jsonb default '{}'::jsonb)
  returns jsonb language sql as $f$
  select pg_temp.fila(p_clave, 2027, 'ia', p_valor,
           jsonb_build_array(pg_temp.reg(p_clave, 2027, true, pg_temp.set_ia(p_valor, p_lote, pg_temp.ipf(p_prop, p_clave)))),
           jsonb_build_object('propuesta_fila_id', pg_temp.ipf(p_prop, p_clave), 'valor_esperado', p_valor) || p_extra) $f$;

-- Fila de método: objetivo 2026.
create or replace function pg_temp.fila_met(p_clave text, p_valor integer, p_lote uuid, p_extra jsonb default '{}'::jsonb)
  returns jsonb language sql as $f$
  select pg_temp.fila(p_clave, 2026, 'metodo', p_valor,
           jsonb_build_array(pg_temp.reg(p_clave, 2026, true, pg_temp.set_met(p_valor, p_lote))),
           jsonb_build_object('valor_esperado', p_valor) || p_extra) $f$;

create or replace function pg_temp.aplica(p jsonb) returns jsonb language plpgsql as $f$
begin
  return public.aplicar_lote_proyeccion(p);
exception when others then
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end
$f$;

create temp table res (k text primary key, v jsonb);

-- Emula «alguien cambio el registro»: en la vida real es OTRA transaccion y su `now()` es posterior. Aqui todo corre en una sola
-- transaccion (now() constante), asi que un update normal puede no mover `updated_at`: se desactiva el trigger y se suma un
-- microsegundo.
create or replace function pg_temp.toca(p_clave text, p_anio integer) returns void language plpgsql as $f$
begin
  set constraints all immediate;
  alter table public.proyeccion_fila_anios disable trigger set_updated_at;
  update public.proyeccion_fila_anios a set updated_at = a.updated_at + interval '1 microsecond'
    from public.proyeccion_filas f where f.id = a.fila_id and f.clave = p_clave and a.anio = p_anio;
  alter table public.proyeccion_fila_anios enable trigger set_updated_at;
  set constraints all deferred;
end
$f$;

-- Código o `aplicada` de una fila en una respuesta guardada.
create or replace function pg_temp.rc(p_k text, p_clave text, p_anio integer) returns text language sql as $f$
  select coalesce(e ->> 'codigo', 'aplicada') from res, jsonb_array_elements(res.v -> 'filas') e
   where res.k = p_k and e ->> 'fila_clave' = p_clave and (e ->> 'anio')::integer = p_anio $f$;

-- Valor (como texto) de una columna de un registro.
create or replace function pg_temp.v(p_clave text, p_anio integer, p_col text) returns text language sql as $f$
  select to_jsonb(a) ->> p_col from public.proyeccion_fila_anios a join public.proyeccion_filas f on f.id = a.fila_id
   where f.clave = p_clave and a.anio = p_anio $f$;

create or replace function pg_temp.nlote(p_id uuid) returns bigint language sql as $f$
  select count(*) from public.proyeccion_lotes where id = p_id $f$;
create or replace function pg_temp.nfilas(p_id uuid) returns bigint language sql as $f$
  select count(*) from public.proyeccion_lote_filas where lote_id = p_id $f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Aprobar por método (lote 3101): F6 aplicada (con su 2027 recalculado), F5 con un registro de 2027 desfasado un
--    microsegundo (cambio_concurrente: la fila entera o nada), F7 rechazada por TypeScript
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_p jsonb;
begin
  v_p := pg_temp.payload(pg_temp.lote(pg_temp.id(3101), 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(
      pg_temp.fila('H31-F5', 2026, 'metodo', 1000, jsonb_build_array(
        pg_temp.reg('H31-F5', 2026, true, pg_temp.set_met(1000, pg_temp.id(3101))),
        pg_temp.reg('H31-F5', 2027, false, '{"propuesto": 777}'::jsonb, interval '1 microsecond'))),
      pg_temp.fila('H31-F6', 2026, 'metodo', 1000, jsonb_build_array(
        pg_temp.reg('H31-F6', 2026, true, pg_temp.set_met(1000, pg_temp.id(3101))),
        pg_temp.reg('H31-F6', 2027, false,
          '{"propuesto": 555, "explicacion": "recalculada", "meses": [1,2,3,4,5,6,7,8,9,10,11,12], "avisos": ["propuesta_cambio"], "curva_origen_propuesta": null}'::jsonb))),
      pg_temp.fila('H31-F7', 2026, 'metodo', null, '[]'::jsonb,
        '{"rechazo": "propuesta_cambio", "valor_esperado": 1000, "valor_actual": 1010}'::jsonb)))));
  insert into res values ('p1', v_p), ('s1', pg_temp.aplica(v_p));
end
$$;

insert into r (caso, ok) values
  ('S1 aprobar metodo: sin error y repetido = false',
    (select v ->> 'error' is null and (v ->> 'repetido')::boolean = false from res where k = 's1')),
  ('S1: F6 aplicada, F5 cambio_concurrente (un microsegundo de desfase en su 2027), F7 propuesta_cambio (de TypeScript)',
    pg_temp.rc('s1', 'H31-F6', 2026) = 'aplicada' and pg_temp.rc('s1', 'H31-F5', 2026) = 'cambio_concurrente'
    and pg_temp.rc('s1', 'H31-F7', 2026) = 'propuesta_cambio'),
  ('S1: F6 2026 queda decidida = 1000, origen propuesta, con decision_lote_id del lote',
    pg_temp.v('H31-F6', 2026, 'decidido') = '1000' and pg_temp.v('H31-F6', 2026, 'origen') = 'propuesta'
    and pg_temp.v('H31-F6', 2026, 'decision_lote_id') = pg_temp.id(3101)::text
    and pg_temp.v('H31-F6', 2026, 'decidido_por_nombre') = 'Humo 31'),
  ('S1: el 2027 de F6 (solo recalculado) cambia lo que trae set y conserva lo demas (decidido, decision_lote_id, vendido, activo)',
    pg_temp.v('H31-F6', 2027, 'propuesto') = '555' and pg_temp.v('H31-F6', 2027, 'explicacion') = 'recalculada'
    and pg_temp.v('H31-F6', 2027, 'meses') = '[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]' and pg_temp.v('H31-F6', 2027, 'avisos') = '["propuesta_cambio"]'
    and pg_temp.v('H31-F6', 2027, 'decidido') is null and pg_temp.v('H31-F6', 2027, 'decision_lote_id') is null
    and pg_temp.v('H31-F6', 2027, 'vendido') = '100' and pg_temp.v('H31-F6', 2027, 'activo') = 'true'),
  ('S1: F5 no se escribio en ningun año (Y e Y+1 juntos o ninguno, R10)',
    pg_temp.v('H31-F5', 2026, 'decidido') is null and pg_temp.v('H31-F5', 2026, 'decision_lote_id') is null
    and pg_temp.v('H31-F5', 2027, 'propuesto') = '1100'),
  ('S1: el lote tiene 3 lineas y su resumen es { pedidas 3, aplicadas 1, rechazadas {cambio_concurrente 1, propuesta_cambio 1}, metodo 1 fila y 1000 u, ia 0 }',
    (select l.resumen = '{"pedidas": 3, "aplicadas": 1, "rechazadas": {"cambio_concurrente": 1, "propuesta_cambio": 1},
                          "por_fuente": {"ia": {"filas": 0, "unidades": 0}, "metodo": {"filas": 1, "unidades": 1000}}}'::jsonb
       from public.proyeccion_lotes l where l.id = pg_temp.id(3101)) and pg_temp.nfilas(pg_temp.id(3101)) = 3),
  ('S1: la linea de F7 conserva valor_esperado y valor_actual de TypeScript; F7 queda sin decidir',
    (select count(*) from public.proyeccion_lote_filas where lote_id = pg_temp.id(3101) and fila_clave = 'H31-F7'
        and resultado = 'propuesta_cambio' and valor_esperado = 1000 and valor_actual = 1010) = 1
    and pg_temp.v('H31-F7', 2026, 'decidido') is null),
  ('S1: la cabecera guarda calculado_at de la proyeccion, huella, filtro, efecto previsto, revision y perfil',
    (select l.calculado_at_proyeccion = timestamptz '2026-11-01 09:00:00.654321+00' and char_length(l.huella_cuerpo) = 64
            and l.filtro = '{"genero": "H31H"}'::jsonb and l.efecto_gm_previsto = '[{"gm_clave": "GM-UNO"}]'::jsonb
            and l.revision_confirmada and l.perfil_id = (select perfil_a from ids) and l.tipo = 'aprobar' and l.anio = 2026
       from public.proyeccion_lotes l where l.id = pg_temp.id(3101)));

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Idempotencia (R9): mismo lote_id y misma huella = repetido; otra huella u otra proyeccion = LP004
-- ---------------------------------------------------------------------------------------------------------------------
insert into res select 'antes_s3', jsonb_build_object('upd', (select to_jsonb(a) ->> 'updated_at' from public.proyeccion_fila_anios a
   join public.proyeccion_filas f on f.id = a.fila_id where f.clave = 'H31-F6' and a.anio = 2026));
insert into res select 's3a', pg_temp.aplica(v) from res where k = 'p1';
insert into res select 's3b', pg_temp.aplica(jsonb_set(v, '{lote,huella_cuerpo}', to_jsonb(md5('otra') || md5('otra')))) from res where k = 'p1';
insert into res select 's3c', pg_temp.aplica(jsonb_set(jsonb_set(v, '{lote,proyeccion_id}', to_jsonb((select proy_b from ids))),
   '{lote,calculado_at_esperado}', to_jsonb(pg_temp.iso((select calculado_at from proyecciones where nombre = 'HUMO 31 B'))))) from res where k = 'p1';

insert into r (caso, ok) values
  ('S3 reintento con el mismo cuerpo: repetido = true y devuelve lo guardado (resumen y 3 filas)',
    (select (v ->> 'repetido')::boolean and v ->> 'error' is null and jsonb_array_length(v -> 'filas') = 3
            and (v -> 'resumen' ->> 'aplicadas')::integer = 1 from res where k = 's3a')),
  ('S3: el reintento no escribe nada (un solo lote, 3 lineas, F6 sin tocar)',
    pg_temp.nlote(pg_temp.id(3101)) = 1 and pg_temp.nfilas(pg_temp.id(3101)) = 3
    and (select v ->> 'upd' from res where k = 'antes_s3') = pg_temp.v('H31-F6', 2026, 'updated_at')),
  ('S3 mismo lote_id con otra huella: LP004 lote_ajeno',
    (select v ->> 'error' = 'LP004' and v ->> 'msg' = 'lote_ajeno' from res where k = 's3b')),
  ('S3 mismo lote_id en otra proyeccion: LP004 lote_ajeno',
    (select v ->> 'error' = 'LP004' from res where k = 's3c'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Aprobar sobre lo ya decidido (lote 3102): metodo es atomico POR FILA. F1 y F2 se aplican; F4 (a mano) y F6 (de un lote)
--    quedan ya_decidida y nada de ellas se escribe (R1)
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_p jsonb;
  v_l uuid := pg_temp.id(3102);
begin
  v_p := pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_met('H31-F1', 1000, v_l), pg_temp.fila_met('H31-F2', 1000, v_l), pg_temp.fila_met('H31-F4', 1000, v_l))),
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(pg_temp.fila_met('H31-F6', 1000, v_l)))));
  insert into res values ('s4', pg_temp.aplica(v_p));
end
$$;

insert into r (caso, ok) values
  ('S4 aprobar: F1 y F2 aplicadas; F4 (decidida a mano) y F6 (decidida por otro lote) ya_decidida',
    pg_temp.rc('s4', 'H31-F1', 2026) = 'aplicada' and pg_temp.rc('s4', 'H31-F2', 2026) = 'aplicada'
    and pg_temp.rc('s4', 'H31-F4', 2026) = 'ya_decidida' and pg_temp.rc('s4', 'H31-F6', 2026) = 'ya_decidida'),
  ('S4: la fila rechazada no arrastra a las demas del grupo metodo (F1 y F2 quedan decididas por el lote 3102)',
    pg_temp.v('H31-F1', 2026, 'decision_lote_id') = pg_temp.id(3102)::text and pg_temp.v('H31-F2', 2026, 'decision_lote_id') = pg_temp.id(3102)::text),
  ('S4: lo decidido a mano (F4: 3300, sin lote) y lo del lote 3101 (F6) no se tocaron (R1)',
    pg_temp.v('H31-F4', 2026, 'decidido') = '3300' and pg_temp.v('H31-F4', 2026, 'origen') = 'manual' and pg_temp.v('H31-F4', 2026, 'decision_lote_id') is null
    and pg_temp.v('H31-F6', 2026, 'decision_lote_id') = pg_temp.id(3101)::text),
  ('S4: resumen { pedidas 4, aplicadas 2, rechazadas {ya_decidida 2}, metodo 2 filas y 2000 u }',
    (select l.resumen = '{"pedidas": 4, "aplicadas": 2, "rechazadas": {"ya_decidida": 2},
                          "por_fuente": {"ia": {"filas": 0, "unidades": 0}, "metodo": {"filas": 2, "unidades": 2000}}}'::jsonb
       from public.proyeccion_lotes l where l.id = pg_temp.id(3102)));

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Reaprobar (lote 3103): solo registros con decision_lote_id cuyo decidido sigue siendo el esperado (R24)
--    Tras un «recalculo» (propuesto de F1 = 1200): F1 se reaprueba; F2 (esperado erroneo), F3 (nunca aprobada en bloque) y
--    F4 (a mano) quedan cambiada_despues
-- ---------------------------------------------------------------------------------------------------------------------
update public.proyeccion_fila_anios a set propuesto = 1200
  from public.proyeccion_filas f where f.id = a.fila_id and f.clave = 'H31-F1' and a.anio = 2026;

do $$
declare
  v_p jsonb;
  v_l uuid := pg_temp.id(3103);
begin
  v_p := pg_temp.payload(pg_temp.lote(v_l, 'reaprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_met('H31-F1', 1200, v_l, '{"decidido_esperado": 1000}'::jsonb),
      pg_temp.fila_met('H31-F2', 1200, v_l, '{"decidido_esperado": 999}'::jsonb),
      pg_temp.fila_met('H31-F3', 1200, v_l, '{"decidido_esperado": 1000}'::jsonb),
      pg_temp.fila_met('H31-F4', 1200, v_l, '{"decidido_esperado": 3300}'::jsonb)))));
  insert into res values ('s5', pg_temp.aplica(v_p));
end
$$;

insert into r (caso, ok) values
  ('S5 reaprobar: F1 aplicada; F2, F3 y F4 cambiada_despues',
    pg_temp.rc('s5', 'H31-F1', 2026) = 'aplicada' and pg_temp.rc('s5', 'H31-F2', 2026) = 'cambiada_despues'
    and pg_temp.rc('s5', 'H31-F3', 2026) = 'cambiada_despues' and pg_temp.rc('s5', 'H31-F4', 2026) = 'cambiada_despues'),
  ('S5: F1 pasa a 1200 con el decision_lote_id del lote nuevo; F2 conserva el del lote anterior; F3 sin decidir; F4 a mano intacta',
    pg_temp.v('H31-F1', 2026, 'decidido') = '1200' and pg_temp.v('H31-F1', 2026, 'decision_lote_id') = pg_temp.id(3103)::text
    and pg_temp.v('H31-F1', 2026, 'propuesta_al_decidir') = '1200'
    and pg_temp.v('H31-F2', 2026, 'decision_lote_id') = pg_temp.id(3102)::text and pg_temp.v('H31-F2', 2026, 'decidido') = '1000'
    and pg_temp.v('H31-F3', 2026, 'decidido') is null and pg_temp.v('H31-F4', 2026, 'decidido') = '3300'),
  ('S5: el lote es de tipo reaprobar y su resumen { pedidas 4, aplicadas 1, rechazadas {cambiada_despues 3} }',
    (select l.tipo = 'reaprobar' and l.resumen -> 'rechazadas' = '{"cambiada_despues": 3}'::jsonb and (l.resumen ->> 'aplicadas')::integer = 1
       from public.proyeccion_lotes l where l.id = pg_temp.id(3103)));

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. IA: un grupo se escribe ENTERO o NO SE ESCRIBE (D7). Los casos de rechazo no escriben nada en F1..F3 de 2027
-- ---------------------------------------------------------------------------------------------------------------------
-- 6a. registros_lectura: cambia F4 2027 (no seleccionada) despues de la foto -> las tres filas cambio_concurrente (ejemplo L')
do $$
declare
  v_p jsonb;
  v_l uuid := pg_temp.id(3141);
  v_vig uuid := (select p_vig from ids);
begin
  v_p := pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('ia', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_ia('H31-F1', 1150, v_l, v_vig), pg_temp.fila_ia('H31-F2', 1100, v_l, v_vig), pg_temp.fila_ia('H31-F3', 1050, v_l, v_vig)),
      pg_temp.lectura(array['H31-F1', 'H31-F2', 'H31-F3', 'H31-F4']), v_vig)));
  perform pg_temp.toca('H31-F4', 2027);
  insert into res values ('s6a', pg_temp.aplica(v_p));
end
$$;

-- 6b. propuesta no vigente: la antigua y la del empate (el orden es created_at desc, id asc)
do $$
declare
  v_l uuid;
  v_antigua uuid := (select p_antigua from ids);
  v_empate uuid := (select p_empate from ids);
begin
  v_l := pg_temp.id(3142);
  insert into res values ('s6b', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('ia', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_ia('H31-F1', 1150, v_l, v_antigua), pg_temp.fila_ia('H31-F2', 1100, v_l, v_antigua), pg_temp.fila_ia('H31-F3', 1050, v_l, v_antigua)),
      pg_temp.lectura(array['H31-F1', 'H31-F2', 'H31-F3', 'H31-F4']), v_antigua)))));
  v_l := pg_temp.id(3143);
  insert into res values ('s6b2', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('ia', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_ia('H31-F1', 1150, v_l, v_empate), pg_temp.fila_ia('H31-F2', 1100, v_l, v_empate), pg_temp.fila_ia('H31-F3', 1050, v_l, v_empate)),
      pg_temp.lectura(array['H31-F1', 'H31-F2', 'H31-F3', 'H31-F4']), v_empate)))));
end
$$;

-- 6c. una fila rechazada por TypeScript (confianza_baja) tumba al resto del grupo IA (ejemplo C)
do $$
declare
  v_l uuid := pg_temp.id(3144);
  v_vig uuid := (select p_vig from ids);
begin
  insert into res values ('s6c', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('ia', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_ia('H31-F1', 1150, v_l, v_vig), pg_temp.fila_ia('H31-F2', 1100, v_l, v_vig),
      pg_temp.fila('H31-F3', 2027, 'ia', null, '[]'::jsonb, '{"rechazo": "confianza_baja"}'::jsonb)),
      pg_temp.lectura(array['H31-F1', 'H31-F2', 'H31-F3', 'H31-F4']), v_vig)))));
end
$$;

-- 6d. una fila ya decidida (F4 a mano) en el grupo: ya_decidida y el resto grupo_rechazado
do $$
declare
  v_l uuid := pg_temp.id(3145);
  v_vig uuid := (select p_vig from ids);
begin
  insert into res values ('s6d', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('ia', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_ia('H31-F1', 1150, v_l, v_vig), pg_temp.fila_ia('H31-F2', 1100, v_l, v_vig), pg_temp.fila_ia('H31-F3', 1050, v_l, v_vig),
      pg_temp.fila_ia('H31-F4', 1000, v_l, v_vig)),
      pg_temp.lectura(array['H31-F1', 'H31-F2', 'H31-F3', 'H31-F4']), v_vig)))));
end
$$;

-- 6e. propuesta_fila_id de OTRA propuesta (la del empate) dentro de un grupo de la vigente: ia_fila_ajena
do $$
declare
  v_l uuid := pg_temp.id(3146);
  v_vig uuid := (select p_vig from ids);
  v_empate uuid := (select p_empate from ids);
begin
  insert into res values ('s6e', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('ia', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_ia('H31-F1', 1150, v_l, v_vig, jsonb_build_object('propuesta_fila_id', pg_temp.ipf(v_empate, 'H31-F1'))),
      pg_temp.fila_ia('H31-F2', 1100, v_l, v_vig), pg_temp.fila_ia('H31-F3', 1050, v_l, v_vig)),
      pg_temp.lectura(array['H31-F1', 'H31-F2', 'H31-F3', 'H31-F4']), v_vig)))));
end
$$;

insert into r (caso, ok) values
  ('S6a registros_lectura cambiado (F4 no seleccionada): las 3 filas cambio_concurrente, nada escrito (L-prima)',
    pg_temp.rc('s6a', 'H31-F1', 2027) = 'cambio_concurrente' and pg_temp.rc('s6a', 'H31-F2', 2027) = 'cambio_concurrente'
    and pg_temp.rc('s6a', 'H31-F3', 2027) = 'cambio_concurrente'
    and pg_temp.v('H31-F1', 2027, 'decidido') is null and pg_temp.v('H31-F2', 2027, 'decidido') is null and pg_temp.v('H31-F3', 2027, 'decidido') is null),
  ('S6a: resumen { pedidas 3, aplicadas 0, rechazadas {cambio_concurrente 3} }',
    (select l.resumen -> 'rechazadas' = '{"cambio_concurrente": 3}'::jsonb and (l.resumen ->> 'aplicadas')::integer = 0
       from public.proyeccion_lotes l where l.id = pg_temp.id(3141))),
  ('S6b propuesta antigua en un grupo ia: las 3 filas ia_no_vigente, nada escrito',
    pg_temp.rc('s6b', 'H31-F1', 2027) = 'ia_no_vigente' and pg_temp.rc('s6b', 'H31-F2', 2027) = 'ia_no_vigente'
    and pg_temp.rc('s6b', 'H31-F3', 2027) = 'ia_no_vigente' and pg_temp.v('H31-F1', 2027, 'decidido') is null),
  ('S6b propuesta con el mismo created_at pero id mayor (no es la vigente, created_at desc, id asc): ia_no_vigente',
    pg_temp.rc('s6b2', 'H31-F1', 2027) = 'ia_no_vigente' and pg_temp.rc('s6b2', 'H31-F3', 2027) = 'ia_no_vigente'),
  ('S6c una fila rechazada por TypeScript (confianza_baja): F3 confianza_baja y F1 y F2 grupo_rechazado, nada escrito',
    pg_temp.rc('s6c', 'H31-F3', 2027) = 'confianza_baja' and pg_temp.rc('s6c', 'H31-F1', 2027) = 'grupo_rechazado'
    and pg_temp.rc('s6c', 'H31-F2', 2027) = 'grupo_rechazado' and pg_temp.v('H31-F2', 2027, 'decidido') is null),
  ('S6d una fila ya decidida a mano (F4) en el grupo ia: F4 ya_decidida y F1, F2, F3 grupo_rechazado; F4 intacta',
    pg_temp.rc('s6d', 'H31-F4', 2027) = 'ya_decidida' and pg_temp.rc('s6d', 'H31-F1', 2027) = 'grupo_rechazado'
    and pg_temp.rc('s6d', 'H31-F2', 2027) = 'grupo_rechazado' and pg_temp.rc('s6d', 'H31-F3', 2027) = 'grupo_rechazado'
    and pg_temp.v('H31-F4', 2027, 'decidido') = '3300' and pg_temp.v('H31-F1', 2027, 'decidido') is null),
  ('S6e propuesta_fila_id de otra propuesta: F1 ia_fila_ajena y F2 y F3 grupo_rechazado',
    pg_temp.rc('s6e', 'H31-F1', 2027) = 'ia_fila_ajena' and pg_temp.rc('s6e', 'H31-F2', 2027) = 'grupo_rechazado'
    and pg_temp.rc('s6e', 'H31-F3', 2027) = 'grupo_rechazado' and pg_temp.v('H31-F1', 2027, 'decidido') is null);

-- 6f. Exito (lote 3147): grupo ia con F1..F3 y, en el mismo lote, un grupo metodo con F5 2026
do $$
declare
  v_l uuid := pg_temp.id(3147);
  v_vig uuid := (select p_vig from ids);
begin
  insert into res values ('s6f', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('ia', 'GM-UNO', jsonb_build_array(
      pg_temp.fila_ia('H31-F1', 1150, v_l, v_vig), pg_temp.fila_ia('H31-F2', 1100, v_l, v_vig), pg_temp.fila_ia('H31-F3', 1050, v_l, v_vig)),
      pg_temp.lectura(array['H31-F1', 'H31-F2', 'H31-F3', 'H31-F4']), v_vig),
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(pg_temp.fila_met('H31-F5', 1000, v_l)))))));
end
$$;

insert into r (caso, ok) values
  ('S6f grupo ia entero + grupo metodo: las 4 filas aplicadas',
    (select v ->> 'error' is null from res where k = 's6f') and pg_temp.rc('s6f', 'H31-F1', 2027) = 'aplicada'
    and pg_temp.rc('s6f', 'H31-F2', 2027) = 'aplicada' and pg_temp.rc('s6f', 'H31-F3', 2027) = 'aplicada'
    and pg_temp.rc('s6f', 'H31-F5', 2026) = 'aplicada'),
  ('S6f: F1 2027 decidida = 1150, origen manual, con la traza de su propuesta (decision_ia_fila_id) y el decision_lote_id del lote',
    pg_temp.v('H31-F1', 2027, 'decidido') = '1150' and pg_temp.v('H31-F1', 2027, 'origen') = 'manual'
    and pg_temp.v('H31-F1', 2027, 'decision_ia_fila_id') = pg_temp.ipf((select p_vig from ids), 'H31-F1')::text
    and pg_temp.v('H31-F1', 2027, 'decision_lote_id') = pg_temp.id(3147)::text
    and pg_temp.v('H31-F2', 2027, 'decidido') = '1100' and pg_temp.v('H31-F3', 2027, 'decidido') = '1050'),
  ('S6f: el 2026 de esas filas (otros registros) no se toco: F3 2026 sigue sin decidir',
    pg_temp.v('H31-F3', 2026, 'decidido') is null),
  ('S6f: resumen { pedidas 4, aplicadas 4, ia 3 filas y 3300 u, metodo 1 fila y 1000 u }; las lineas de IA guardan propuesta_fila_id',
    (select l.resumen = '{"pedidas": 4, "aplicadas": 4, "rechazadas": {},
                          "por_fuente": {"ia": {"filas": 3, "unidades": 3300}, "metodo": {"filas": 1, "unidades": 1000}}}'::jsonb
       from public.proyeccion_lotes l where l.id = pg_temp.id(3147))
    and (select count(*) from public.proyeccion_lote_filas where lote_id = pg_temp.id(3147) and fuente = 'ia' and propuesta_fila_id is not null) = 3);

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Revertir (R11): solo registros con decision_lote_id = revierte_lote_id (lote 3161 revierte el 3147)
--    Alguien decide F3 2027 a mano antes: F3 queda cambiada_despues; F1, F2 y F5 vuelven a sin decidir
-- ---------------------------------------------------------------------------------------------------------------------
update public.proyeccion_fila_anios a
   set decidido = 5000, origen = 'manual', decidido_at = now(), decision_lote_id = null, decision_ia_fila_id = null
  from public.proyeccion_filas f where f.id = a.fila_id and f.clave = 'H31-F3' and a.anio = 2027;

do $$
declare
  v_l uuid := pg_temp.id(3161);
begin
  insert into res values ('s7', pg_temp.aplica(pg_temp.payload(
    pg_temp.lote(v_l, 'revertir', null, jsonb_build_object('revierte_lote_id', pg_temp.id(3147))),
    jsonb_build_array(
      pg_temp.grupo('revertir', 'GM-UNO', jsonb_build_array(
        pg_temp.fila('H31-F1', 2027, 'revertir', null, jsonb_build_array(pg_temp.reg('H31-F1', 2027, true, pg_temp.set_rev()))),
        pg_temp.fila('H31-F2', 2027, 'revertir', null, jsonb_build_array(pg_temp.reg('H31-F2', 2027, true, pg_temp.set_rev()))),
        pg_temp.fila('H31-F3', 2027, 'revertir', null, jsonb_build_array(pg_temp.reg('H31-F3', 2027, true, pg_temp.set_rev())))),
        pg_temp.lectura(array['H31-F1', 'H31-F2', 'H31-F3', 'H31-F4'])),
      pg_temp.grupo('revertir', 'GM-DOS', jsonb_build_array(
        pg_temp.fila('H31-F5', 2026, 'revertir', null, jsonb_build_array(pg_temp.reg('H31-F5', 2026, true, pg_temp.set_rev())))))))));
end
$$;

insert into r (caso, ok) values
  ('S7 revertir: F1, F2 y F5 aplicadas; F3 (cambiada a mano despues) cambiada_despues',
    (select v ->> 'error' is null from res where k = 's7') and pg_temp.rc('s7', 'H31-F1', 2027) = 'aplicada'
    and pg_temp.rc('s7', 'H31-F2', 2027) = 'aplicada' and pg_temp.rc('s7', 'H31-F5', 2026) = 'aplicada'
    and pg_temp.rc('s7', 'H31-F3', 2027) = 'cambiada_despues'),
  ('S7: F1 y F2 2027 y F5 2026 vuelven a sin decidir y sin trazas (decidido, origen, decision_ia_fila_id y decision_lote_id nulos)',
    pg_temp.v('H31-F1', 2027, 'decidido') is null and pg_temp.v('H31-F1', 2027, 'origen') is null
    and pg_temp.v('H31-F1', 2027, 'decision_ia_fila_id') is null and pg_temp.v('H31-F1', 2027, 'decision_lote_id') is null
    and pg_temp.v('H31-F2', 2027, 'decidido') is null and pg_temp.v('H31-F5', 2026, 'decidido') is null
    and pg_temp.v('H31-F5', 2026, 'decision_lote_id') is null),
  ('S7: lo cambiado a mano (F3 2027 = 5000) no se toco',
    pg_temp.v('H31-F3', 2027, 'decidido') = '5000' and pg_temp.v('H31-F3', 2027, 'origen') = 'manual'),
  ('S7: el lote de reversion apunta al revertido y su resumen trae la fuente revertir (3 filas aplicadas, 0 u) y rechazadas {cambiada_despues 1}',
    (select l.tipo = 'revertir' and l.revierte_lote_id = pg_temp.id(3147) and l.resumen -> 'rechazadas' = '{"cambiada_despues": 1}'::jsonb
            and l.resumen -> 'por_fuente' -> 'revertir' = '{"filas": 3, "unidades": 0}'::jsonb
            and l.resumen -> 'por_fuente' -> 'ia' = '{"filas": 0, "unidades": 0}'::jsonb
       from public.proyeccion_lotes l where l.id = pg_temp.id(3161)));

-- 7b. Revertir otra vez el mismo lote: nada que revertir (decision_lote_id ya es nulo): todo cambiada_despues, 0 aplicadas
insert into res values ('s7b', pg_temp.aplica(pg_temp.payload(
  pg_temp.lote(pg_temp.id(3162), 'revertir', null, jsonb_build_object('revierte_lote_id', pg_temp.id(3147))),
  jsonb_build_array(pg_temp.grupo('revertir', 'GM-UNO', jsonb_build_array(
    pg_temp.fila('H31-F1', 2027, 'revertir', null, jsonb_build_array(pg_temp.reg('H31-F1', 2027, true, pg_temp.set_rev()))),
    pg_temp.fila('H31-F2', 2027, 'revertir', null, jsonb_build_array(pg_temp.reg('H31-F2', 2027, true, pg_temp.set_rev())))))))));

-- 7c. Errores de revertir
insert into res values
  ('s7c1', pg_temp.aplica(pg_temp.payload(
    pg_temp.lote(pg_temp.id(3163), 'revertir', null, jsonb_build_object('revierte_lote_id', pg_temp.id(3161))),
    jsonb_build_array(pg_temp.grupo('revertir', 'GM-UNO', '[]'::jsonb))))),
  ('s7c2', pg_temp.aplica(pg_temp.payload(
    pg_temp.lote(pg_temp.id(3164), 'revertir', null, jsonb_build_object('revierte_lote_id', pg_temp.id(9999))),
    jsonb_build_array(pg_temp.grupo('revertir', 'GM-UNO', '[]'::jsonb))))),
  ('s7c3', pg_temp.aplica(pg_temp.payload(
    pg_temp.lote(pg_temp.id(3165), 'revertir', null, jsonb_build_object('revierte_lote_id', pg_temp.id(3147))),
    jsonb_build_array(pg_temp.grupo('metodo', 'GM-UNO', '[]'::jsonb))))),
  ('s7c4', pg_temp.aplica(pg_temp.payload(
    pg_temp.lote(pg_temp.id(3166), 'aprobar', null, jsonb_build_object('revierte_lote_id', pg_temp.id(3147))),
    jsonb_build_array(pg_temp.grupo('metodo', 'GM-UNO', '[]'::jsonb))))),
  ('s7c5', pg_temp.aplica(pg_temp.payload(pg_temp.lote(pg_temp.id(3167), 'revertir'), jsonb_build_array(pg_temp.grupo('revertir', 'GM-UNO', '[]'::jsonb))))),
  ('s7c6', pg_temp.aplica(pg_temp.payload(
    pg_temp.lote(pg_temp.id(3168), 'revertir', null, jsonb_build_object('revierte_lote_id', pg_temp.id(3147))),
    jsonb_build_array(pg_temp.grupo('revertir', 'GM-UNO', jsonb_build_array(
      pg_temp.fila('H31-F2', 2027, 'revertir', null, jsonb_build_array(pg_temp.reg('H31-F2', 2027, true,
        pg_temp.set_rev() || jsonb_build_object('decision_lote_id', pg_temp.id(3168))))))))))),
  ('s7c7', pg_temp.aplica(pg_temp.payload(pg_temp.lote(pg_temp.id(3169), 'aprobar'), jsonb_build_array(
      pg_temp.grupo('revertir', 'GM-UNO', '[]'::jsonb)))));

insert into r (caso, ok) values
  ('S7b revertir dos veces el mismo lote: las 2 filas cambiada_despues y 0 aplicadas',
    pg_temp.rc('s7b', 'H31-F1', 2027) = 'cambiada_despues' and pg_temp.rc('s7b', 'H31-F2', 2027) = 'cambiada_despues'
    and (select (l.resumen ->> 'aplicadas')::integer = 0 from public.proyeccion_lotes l where l.id = pg_temp.id(3162))),
  ('S7c revertir una reversion: LP005 no_revertible',
    (select v ->> 'error' = 'LP005' and v ->> 'msg' = 'no_revertible' from res where k = 's7c1')),
  ('S7c revertir un lote que no existe: LP005',
    (select v ->> 'error' = 'LP005' from res where k = 's7c2')),
  ('S7c lote revertir con un grupo metodo: LP007 (grupo incoherente con el tipo de lote)',
    (select v ->> 'error' = 'LP007' from res where k = 's7c3')),
  ('S7c revierte_lote_id con tipo aprobar: LP007 (la pareja revierte_lote_id y revertir)',
    (select v ->> 'error' = 'LP007' from res where k = 's7c4')),
  ('S7c tipo revertir sin revierte_lote_id: LP007',
    (select v ->> 'error' = 'LP007' from res where k = 's7c5')),
  ('S7c revertir con un decision_lote_id no nulo en set: LP007',
    (select v ->> 'error' = 'LP007' from res where k = 's7c6')),
  ('S7c lote aprobar con un grupo revertir: LP007',
    (select v ->> 'error' = 'LP007' from res where k = 's7c7')),
  ('S7c ninguno de esos errores dejo lote ni lineas (R10: error = nada escrito)',
    (select count(*) from public.proyeccion_lotes where id in (pg_temp.id(3163), pg_temp.id(3164), pg_temp.id(3165), pg_temp.id(3166),
        pg_temp.id(3167), pg_temp.id(3168), pg_temp.id(3169))) = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. Estado, calculo vivo, calculado_at y proyeccion inexistente (R10), sobre la proyeccion B
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function pg_temp.lote_b(p_id uuid, p_extra jsonb default '{}'::jsonb) returns jsonb language sql as $f$
  select pg_temp.payload(pg_temp.lote(p_id, 'aprobar', (select proy_b from ids), p_extra), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-B', jsonb_build_array(pg_temp.fila_met('H31-B1', 1000, p_id))))) $f$;

update public.proyecciones set estado = 'cerrada', cerrada_at = now() where nombre = 'HUMO 31 B';
insert into res values ('s8a', pg_temp.aplica(pg_temp.lote_b(pg_temp.id(3171))));
update public.proyecciones set estado = 'archivada' where nombre = 'HUMO 31 B';
insert into res values ('s8b', pg_temp.aplica(pg_temp.lote_b(pg_temp.id(3172))));
update public.proyecciones set estado = 'en_trabajo', calculando_desde = now() - interval '5 minutes' where nombre = 'HUMO 31 B';
insert into res values ('s8c', pg_temp.aplica(pg_temp.lote_b(pg_temp.id(3173))));
update public.proyecciones set calculando_desde = now() - interval '20 minutes' where nombre = 'HUMO 31 B';
insert into res values ('s8d', pg_temp.aplica(pg_temp.lote_b(pg_temp.id(3174),
  jsonb_build_object('calculado_at_esperado', pg_temp.iso((select calculado_at + interval '1 microsecond' from proyecciones where nombre = 'HUMO 31 B'))))));
insert into res values ('s8e', pg_temp.aplica(pg_temp.lote_b(pg_temp.id(3175), jsonb_build_object('proyeccion_id', gen_random_uuid()))));

insert into r (caso, ok) values
  ('S8 proyeccion cerrada: LP001 proyeccion_cerrada',
    (select v ->> 'error' = 'LP001' and v ->> 'msg' = 'proyeccion_cerrada' from res where k = 's8a')),
  ('S8 proyeccion archivada: LP001 proyeccion_archivada',
    (select v ->> 'error' = 'LP001' and v ->> 'msg' = 'proyeccion_archivada' from res where k = 's8b')),
  ('S8 calculo vivo (calculando_desde de hace 5 minutos): LP002 calculo_en_curso',
    (select v ->> 'error' = 'LP002' and v ->> 'msg' = 'calculo_en_curso' from res where k = 's8c')),
  ('S8 calculo caducado (hace 20 minutos) no bloquea, pero calculado_at distinto en un microsegundo: LP003 datos_cambiaron',
    (select v ->> 'error' = 'LP003' and v ->> 'msg' = 'datos_cambiaron' from res where k = 's8d')),
  ('S8 proyeccion inexistente: LP006',
    (select v ->> 'error' = 'LP006' from res where k = 's8e')),
  ('S8 ninguno de los 5 dejo lote ni escribio el registro de B',
    (select count(*) from public.proyeccion_lotes where id in (pg_temp.id(3171), pg_temp.id(3172), pg_temp.id(3173), pg_temp.id(3174), pg_temp.id(3175))) = 0
    and pg_temp.v('H31-B1', 2026, 'decidido') is null);

-- Con el calculo caducado y el calculado_at correcto, el lote de B se aplica (sera el lote de B para las pruebas de borrado)
insert into res values ('s8f', pg_temp.aplica(pg_temp.lote_b(pg_temp.id(3176))));
insert into r (caso, ok) values
  ('S8 calculo caducado y calculado_at correcto: el lote de B se aplica y B1 2026 queda decidida por el lote 3176',
    pg_temp.rc('s8f', 'H31-B1', 2026) = 'aplicada' and pg_temp.v('H31-B1', 2026, 'decision_lote_id') = pg_temp.id(3176)::text);

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. Payload invalido (LP007): se deshace todo, incluso lo ya escrito por filas anteriores (R10, R14)
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_l uuid := pg_temp.id(3181);
  k text;
  v_e text := '';
  v_p jsonb;
begin
  -- 9a. claves fuera de la lista fija (activo, id, fila_id, anio): LP007 cada una
  foreach k in array array['activo', 'id', 'fila_id', 'anio', 'created_at', 'updated_at', 'columna_inventada'] loop
    v_p := pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
      pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(
        pg_temp.fila('H31-F7', 2026, 'metodo', 1000, jsonb_build_array(
          pg_temp.reg('H31-F7', 2026, true,
            pg_temp.set_met(1000, v_l) || jsonb_build_object(k, case k when 'activo' then to_jsonb(true) else to_jsonb(5) end))))))));
    v_e := v_e || coalesce(pg_temp.aplica(v_p) ->> 'error', 'sin_error') || ',';
  end loop;
  insert into res values ('s9a', jsonb_build_object('errores', v_e));

  -- 9b. fila valida y despues una con una clave prohibida: LP007 y la primera NO queda escrita
  insert into res values ('s9b', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(
      pg_temp.fila_met('H31-F7', 1000, v_l),
      pg_temp.fila('H31-F3', 2026, 'metodo', 1000, jsonb_build_array(
        pg_temp.reg('H31-F3', 2026, true, pg_temp.set_met(1000, v_l) || '{"activo": false}'::jsonb)))))))));

  -- 9c. decision_lote_id de otro lote
  insert into res values ('s9c', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(
      pg_temp.fila('H31-F7', 2026, 'metodo', 1000, jsonb_build_array(
        pg_temp.reg('H31-F7', 2026, true, pg_temp.set_met(1000, pg_temp.id(7777)))))))))));

  -- 9d. un registro de otra fila dentro de la fila
  insert into res values ('s9d', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(
      pg_temp.fila('H31-F7', 2026, 'metodo', 1000, jsonb_build_array(
        pg_temp.reg('H31-F3', 2026, true, pg_temp.set_met(1000, v_l))))))))));

  -- 9e. sin registro objetivo
  insert into res values ('s9e', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(
      pg_temp.fila('H31-F7', 2026, 'metodo', 1000, jsonb_build_array(
        pg_temp.reg('H31-F7', 2026, false, pg_temp.set_met(1000, v_l))))))))));

  -- 9f. fila sin registros y sin rechazo
  insert into res values ('s9f', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(pg_temp.fila('H31-F7', 2026, 'metodo', 1000, '[]'::jsonb)))))));

  -- 9g. tipo de lote desconocido; sin grupos; sin lote
  insert into res values
    ('s9g1', pg_temp.aplica(pg_temp.payload(pg_temp.lote(v_l, 'otro'), '[]'::jsonb))),
    ('s9g2', pg_temp.aplica(jsonb_build_object('lote', pg_temp.lote(v_l, 'aprobar')))),
    ('s9g3', pg_temp.aplica('{}'::jsonb));
end
$$;

insert into r (caso, ok) values
  ('S9a claves fuera de la lista fija de set (activo, id, fila_id, anio, created_at, updated_at, inventada): LP007 las 7',
    (select v ->> 'errores' = 'LP007,LP007,LP007,LP007,LP007,LP007,LP007,' from res where k = 's9a')),
  ('S9b error en la segunda fila: LP007 y la primera (F7 2026, valida) NO queda escrita; sin lote ni lineas',
    (select v ->> 'error' = 'LP007' from res where k = 's9b') and pg_temp.v('H31-F7', 2026, 'decidido') is null
    and pg_temp.nlote(pg_temp.id(3181)) = 0 and pg_temp.nfilas(pg_temp.id(3181)) = 0),
  ('S9c decision_lote_id que no es el del lote: LP007',
    (select v ->> 'error' = 'LP007' from res where k = 's9c')),
  ('S9d un registro de otra fila dentro de la fila: LP007 (y F3 2026 sin tocar)',
    (select v ->> 'error' = 'LP007' from res where k = 's9d') and pg_temp.v('H31-F3', 2026, 'decidido') is null),
  ('S9e fila sin registro objetivo: LP007',
    (select v ->> 'error' = 'LP007' from res where k = 's9e')),
  ('S9f fila sin registros y sin rechazo: LP007',
    (select v ->> 'error' = 'LP007' from res where k = 's9f')),
  ('S9g tipo desconocido, sin grupos y payload vacio: LP007 los 3',
    (select count(*) from res where k in ('s9g1', 's9g2', 's9g3') and v ->> 'error' = 'LP007') = 3);

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. Registro de otra proyeccion, registro inactivo y registros_lectura de un grupo metodo
-- ---------------------------------------------------------------------------------------------------------------------
-- 10a. un registro de B dentro de un lote de A: cuenta como ausente, cambio_concurrente, y B no se escribe
insert into res values ('s10a', pg_temp.aplica(pg_temp.payload(pg_temp.lote(pg_temp.id(3191), 'aprobar'), jsonb_build_array(
  pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(
    jsonb_build_object('fila_id', (select id from proyeccion_filas where clave = 'H31-F7'), 'fila_clave', 'H31-F7', 'anio', 2027, 'fuente', 'metodo', 'valor', 1100,
      'registros', jsonb_build_array(pg_temp.reg('H31-B1', 2027, true, pg_temp.set_met(1100, pg_temp.id(3191)))))))))));

-- 10b. registro inactivo (F7 2027 desactivada por un recalculo antes de la foto): fila_inactiva
update public.proyeccion_fila_anios a set activo = false
  from public.proyeccion_filas f where f.id = a.fila_id and f.clave = 'H31-F7' and a.anio = 2027;
insert into res values ('s10b', pg_temp.aplica(pg_temp.payload(pg_temp.lote(pg_temp.id(3192), 'aprobar'), jsonb_build_array(
  pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(
    pg_temp.fila('H31-F7', 2027, 'metodo', 1100, jsonb_build_array(pg_temp.reg('H31-F7', 2027, true, pg_temp.set_met(1100, pg_temp.id(3192)))))))))));

-- 10c. registros_lectura de un grupo metodo: cambia F6 2027 despues de la foto -> las filas sin codigo propio salen cambio_concurrente
do $$
declare
  v_l uuid := pg_temp.id(3193);
  v_p jsonb;
begin
  v_p := pg_temp.payload(pg_temp.lote(v_l, 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(pg_temp.fila_met('H31-F7', 1000, v_l)),
      pg_temp.lectura(array['H31-F6']))));
  perform pg_temp.toca('H31-F6', 2027);
  insert into res values ('s10c', pg_temp.aplica(v_p));
end
$$;

insert into r (caso, ok) values
  ('S10a registro de otra proyeccion en un lote de A: cambio_concurrente y el registro de B 2027 sigue sin decidir',
    pg_temp.rc('s10a', 'H31-F7', 2027) = 'cambio_concurrente' and pg_temp.v('H31-B1', 2027, 'decidido') is null),
  ('S10b registro inactivo: fila_inactiva y no se escribe (un lote nunca reactiva ni escribe un registro inactivo)',
    pg_temp.rc('s10b', 'H31-F7', 2027) = 'fila_inactiva' and pg_temp.v('H31-F7', 2027, 'decidido') is null
    and pg_temp.v('H31-F7', 2027, 'activo') = 'false'),
  ('S10c registros_lectura cambiado en un grupo metodo: la fila F7 2026 sale cambio_concurrente y no se escribe',
    pg_temp.rc('s10c', 'H31-F7', 2026) = 'cambio_concurrente' and pg_temp.v('H31-F7', 2026, 'decidido') is null);

-- ---------------------------------------------------------------------------------------------------------------------
-- 11. Auditoria (R19): el resumen de CADA lote creado coincide con sus proyeccion_lote_filas (tambien con rechazos)
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('R19: hay al menos 14 lotes en la prueba (con y sin rechazos) y los de resultados mixtos incluidos',
    (select count(*) from public.proyeccion_lotes) >= 14),
  ('R19: resumen.pedidas = count(lineas) y resumen.aplicadas = count(lineas aplicadas) en TODOS los lotes',
    not exists (select 1 from public.proyeccion_lotes l
                 where (l.resumen ->> 'pedidas')::integer <> (select count(*) from public.proyeccion_lote_filas f where f.lote_id = l.id)
                    or (l.resumen ->> 'aplicadas')::integer
                       <> (select count(*) from public.proyeccion_lote_filas f where f.lote_id = l.id and f.resultado = 'aplicada'))),
  ('R19: resumen.rechazadas = lineas rechazadas agrupadas por codigo, en TODOS los lotes',
    not exists (select 1 from public.proyeccion_lotes l
                 where l.resumen -> 'rechazadas' is distinct from coalesce((
                         select jsonb_object_agg(x.resultado, x.n)
                           from (select f.resultado, count(*) as n from public.proyeccion_lote_filas f
                                  where f.lote_id = l.id and f.resultado <> 'aplicada' group by f.resultado) x), '{}'::jsonb))),
  ('R19: resumen.por_fuente.{ia,metodo}.{filas,unidades} = lineas aplicadas por fuente (suma de valor), en TODOS los lotes',
    not exists (select 1 from public.proyeccion_lotes l, unnest(array['ia', 'metodo']) as fu(fuente)
                 where (l.resumen -> 'por_fuente' -> fu.fuente ->> 'filas')::integer
                         <> (select count(*) from public.proyeccion_lote_filas f where f.lote_id = l.id and f.resultado = 'aplicada' and f.fuente = fu.fuente)
                    or (l.resumen -> 'por_fuente' -> fu.fuente ->> 'unidades')::integer
                         <> (select coalesce(sum(f.valor), 0) from public.proyeccion_lote_filas f where f.lote_id = l.id and f.resultado = 'aplicada' and f.fuente = fu.fuente))),
  ('R19: todo registro con decision_lote_id apunta a un lote existente que lo decidio (y tiene decidido)',
    not exists (select 1 from public.proyeccion_fila_anios a
                 where a.decision_lote_id is not null
                   and (a.decidido is null or not exists (select 1 from public.proyeccion_lotes l where l.id = a.decision_lote_id)))),
  ('R1: ningun registro decidido a mano (F4: origen manual y decision_lote_id nulo) fue tocado por ningun lote',
    pg_temp.v('H31-F4', 2026, 'decidido') = '3300' and pg_temp.v('H31-F4', 2027, 'decidido') = '3300'
    and pg_temp.v('H31-F4', 2026, 'decision_lote_id') is null and pg_temp.v('H31-F4', 2027, 'decision_lote_id') is null
    and pg_temp.v('H31-F4', 2026, 'decidido_por_nombre') = 'a mano');

-- ---------------------------------------------------------------------------------------------------------------------
-- 12. Checks estructurales de las tablas (y de decision_lote_id)
-- ---------------------------------------------------------------------------------------------------------------------
-- Fixtures auxiliares: el lote 3101 existe; lo usamos como FK valida.
insert into r (caso, ok) values
  ('check: decision_lote_id sin decidido (F3 2026 sin decidir, lote existente) lo rechaza el check de decidido',
    pg_temp.falla(format('update public.proyeccion_fila_anios a set decision_lote_id = %L from public.proyeccion_filas f where f.id = a.fila_id and f.clave = ''H31-F3'' and a.anio = 2026',
                         pg_temp.id(3101)), '%proyeccion_fila_anios_decision_lote_decidido_check%')),
  ('check: decision_lote_id con decidido (y origen) es aceptado cuando el lote existe',
    pg_temp.acepta(format('update public.proyeccion_fila_anios a set decidido = 10, origen = ''propuesta'', decision_lote_id = %L from public.proyeccion_filas f where f.id = a.fila_id and f.clave = ''H31-F3'' and a.anio = 2026',
                          pg_temp.id(3101)))),
  ('check: huella_cuerpo de 63 caracteres',
    pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen) values (%L, gen_random_uuid(), ''aprobar'', 2026, repeat(''a'', 63), now(), ''{}'')', pg_temp.id(5001)),
                  '%proyeccion_lotes_huella_cuerpo_len_check%')),
  ('check: anio 2023 en el lote',
    pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen) values (%L, gen_random_uuid(), ''aprobar'', 2023, repeat(''a'', 64), now(), ''{}'')', pg_temp.id(5002)),
                  '%proyeccion_lotes_anio_check%')),
  ('check: tipo revertir sin revierte_lote_id',
    pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen) values (%L, gen_random_uuid(), ''revertir'', 2026, repeat(''a'', 64), now(), ''{}'')', pg_temp.id(5003)),
                  '%proyeccion_lotes_revierte_tipo_check%')),
  ('check: tipo aprobar con revierte_lote_id',
    pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, revierte_lote_id, anio, huella_cuerpo, calculado_at_proyeccion, resumen) values (%L, gen_random_uuid(), ''aprobar'', %L, 2026, repeat(''a'', 64), now(), ''{}'')', pg_temp.id(5004), pg_temp.id(3101)),
                  '%proyeccion_lotes_revierte_tipo_check%')),
  ('check: revierte_lote_id apuntando a un lote que no existe (FK inmediata, no diferible)',
    pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, revierte_lote_id, anio, huella_cuerpo, calculado_at_proyeccion, resumen) values (%L, gen_random_uuid(), ''revertir'', gen_random_uuid(), 2026, repeat(''a'', 64), now(), ''{}'')', pg_temp.id(5005)),
                  '%proyeccion_lotes_revierte_lote_id_fkey%')),
  ('check: filtro que no es objeto, efecto_gm_previsto que no es arreglo, resumen que no es objeto, nota de 301',
    pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen, filtro) values (%L, gen_random_uuid(), ''aprobar'', 2026, repeat(''a'', 64), now(), ''{}'', ''[]'')', pg_temp.id(5006)), '%proyeccion_lotes_filtro_check%')
    and pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen, efecto_gm_previsto) values (%L, gen_random_uuid(), ''aprobar'', 2026, repeat(''a'', 64), now(), ''{}'', ''{}'')', pg_temp.id(5007)), '%proyeccion_lotes_efecto_gm_previsto_check%')
    and pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen) values (%L, gen_random_uuid(), ''aprobar'', 2026, repeat(''a'', 64), now(), ''[]'')', pg_temp.id(5008)), '%proyeccion_lotes_resumen_check%')
    and pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen, nota) values (%L, gen_random_uuid(), ''aprobar'', 2026, repeat(''a'', 64), now(), ''{}'', repeat(''n'', 301))', pg_temp.id(5009)), '%proyeccion_lotes_nota_len_check%')),
  ('check: el id del lote es unico (clave primaria proyeccion_lotes_pkey)',
    pg_temp.falla(format('insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen) values (%L, gen_random_uuid(), ''aprobar'', 2026, repeat(''a'', 64), now(), ''{}'')', pg_temp.id(3101)),
                  '%proyeccion_lotes_pkey%')),
  ('lineas: valor negativo, anio 2023, fila_clave de 301, gm_clave de 81 y resultado vacio los rechazan sus checks',
    pg_temp.falla(format('insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado, valor) values (%L, ''x1'', ''g'', 2026, ''metodo'', ''aplicada'', -1)', pg_temp.id(3101)), '%proyeccion_lote_filas_valor_check%')
    and pg_temp.falla(format('insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values (%L, ''x2'', ''g'', 2023, ''metodo'', ''aplicada'')', pg_temp.id(3101)), '%proyeccion_lote_filas_anio_check%')
    and pg_temp.falla(format('insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values (%L, repeat(''k'', 301), ''g'', 2026, ''metodo'', ''aplicada'')', pg_temp.id(3101)), '%proyeccion_lote_filas_fila_clave_len_check%')
    and pg_temp.falla(format('insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values (%L, ''x4'', repeat(''g'', 81), 2026, ''metodo'', ''aplicada'')', pg_temp.id(3101)), '%proyeccion_lote_filas_gm_clave_len_check%')
    and pg_temp.falla(format('insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values (%L, ''x5'', ''g'', 2026, ''metodo'', '''')', pg_temp.id(3101)), '%proyeccion_lote_filas_resultado_len_check%')),
  ('lineas: (lote, fila_clave, anio) es unico; fuente y resultado fuera de catalogo se aceptan (sin check de catalogo)',
    pg_temp.falla(format('insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values (%L, ''H31-F6'', ''GM-DOS'', 2026, ''metodo'', ''aplicada'')', pg_temp.id(3101)), '%proyeccion_lote_filas_lote_fila_anio_key%')
    and pg_temp.acepta(format('insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values (%L, ''H31-X'', ''GM-DOS'', 2026, ''fuente_futura'', ''codigo_futuro'')', pg_temp.id(3101))));

-- ---------------------------------------------------------------------------------------------------------------------
-- 13. FK diferibles (R19): sin cabecera, la comprobacion falla; con la cabecera insertada DESPUES, pasa
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_l uuid := pg_temp.id(6001);
  v_sin_cabecera boolean := false;
  v_con_cabecera boolean := false;
  v_registro boolean := false;
  v_diferida boolean := false;
begin
  -- Una linea con un lote que todavia no existe: la FK diferida NO falla al insertar
  begin
    insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values (v_l, 'H31-D1', 'GM-DOS', 2026, 'metodo', 'aplicada');
    v_diferida := true;
    set constraints public.proyeccion_lote_filas_lote_id_fkey immediate;
  exception when foreign_key_violation then
    v_sin_cabecera := true;
  end;
  set constraints all deferred;

  -- Linea primero y cabecera despues, en la misma transaccion: pasa al comprobar
  begin
    insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado) values (v_l, 'H31-D1', 'GM-DOS', 2026, 'metodo', 'aplicada');
    insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen)
      values (v_l, gen_random_uuid(), 'aprobar', 2026, repeat('d', 64), now(), '{}'::jsonb);
    set constraints public.proyeccion_lote_filas_lote_id_fkey immediate;
    v_con_cabecera := true;
  exception when others then
    v_con_cabecera := false;
  end;
  set constraints all deferred;

  -- Registro con un decision_lote_id inexistente: la FK diferida falla al comprobar
  begin
    update public.proyeccion_fila_anios a set decidido = 11, origen = 'propuesta', decision_lote_id = gen_random_uuid()
      from public.proyeccion_filas f where f.id = a.fila_id and f.clave = 'H31-F6' and a.anio = 2027;
    set constraints public.proyeccion_fila_anios_decision_lote_id_fkey immediate;
  exception when foreign_key_violation then
    v_registro := true;
  end;
  set constraints all deferred;

  insert into r (caso, ok) values
    ('FK diferida: insertar una linea sin cabecera NO falla en el insert (se comprueba al commit)', v_diferida),
    ('FK diferida: sin cabecera, la comprobacion (set constraints immediate, equivale al commit) falla', v_sin_cabecera),
    ('FK diferida: con la cabecera insertada despues de la linea, la comprobacion pasa', v_con_cabecera),
    ('FK diferida de decision_lote_id: un lote inexistente falla al comprobar', v_registro);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 14. Pasada como `service_role` (el rol con el que corre la API), inmutabilidad y permisos de anon y authenticated
-- ---------------------------------------------------------------------------------------------------------------------
-- En el cluster local `service_role` no tiene BYPASSRLS (en Supabase si): se le concede dentro de la transaccion (el
-- `rollback` lo deshace).
alter role service_role bypassrls;
grant usage on schema public to service_role, anon, authenticated;
grant select on r, ids, res to service_role, anon, authenticated;

-- La payload se arma como postgres (la foto de TypeScript) y se aplica como service_role: lote 3201, F7 2026 por metodo.
do $$
declare
  v_p jsonb;
  v_res jsonb;
  v_upd boolean := false;
  v_del boolean := false;
  v_trunc_filas boolean := false;
  v_trunc_lotes boolean := false;
  v_upd_filas boolean := false;
  v_del_filas boolean := false;
  v_l uuid := pg_temp.id(3201);
begin
  update public.proyeccion_fila_anios a set activo = true
    from public.proyeccion_filas f where f.id = a.fila_id and f.clave = 'H31-F7' and a.anio = 2027;
  v_p := pg_temp.payload(pg_temp.lote(pg_temp.id(3201), 'aprobar'), jsonb_build_array(
    pg_temp.grupo('metodo', 'GM-DOS', jsonb_build_array(pg_temp.fila_met('H31-F7', 1000, pg_temp.id(3201))))));
  set local role service_role;
  v_res := public.aplicar_lote_proyeccion(v_p);
  set constraints all immediate;
  begin update public.proyeccion_lotes set nota = 'cambio' where id = v_l; exception when others then v_upd := sqlerrm like '%inmutable%'; end;
  begin delete from public.proyeccion_lotes where id = v_l; exception when others then v_del := sqlerrm like '%inmutable%'; end;
  begin update public.proyeccion_lote_filas set valor = 1 where lote_id = v_l; exception when others then v_upd_filas := sqlerrm like '%inmutable%'; end;
  begin delete from public.proyeccion_lote_filas where lote_id = v_l; exception when others then v_del_filas := sqlerrm like '%inmutable%'; end;
  begin truncate table public.proyeccion_lote_filas; exception when others then v_trunc_filas := sqlerrm like '%inmutable%'; end;
  begin truncate table public.proyeccion_lotes, public.proyeccion_lote_filas, public.proyeccion_fila_anios; exception when others then v_trunc_lotes := sqlerrm like '%inmutable%'; end;
  reset role;
  set constraints all deferred;
  insert into r (caso, ok) values
    ('service_role: aplicar_lote_proyeccion funciona con el rol de la API (permisos de funcion y de tablas) y aplica F7 2026',
      v_res ->> 'lote_id' = pg_temp.id(3201)::text and not (v_res ->> 'repetido')::boolean
      and pg_temp.v('H31-F7', 2026, 'decision_lote_id') = pg_temp.id(3201)::text),
    ('service_role: update sobre proyeccion_lotes lo rechaza el trigger (no el permiso)', v_upd),
    ('service_role: delete sobre proyeccion_lotes lo rechaza el trigger', v_del),
    ('service_role: update sobre proyeccion_lote_filas lo rechaza el trigger', v_upd_filas),
    ('service_role: delete sobre proyeccion_lote_filas lo rechaza el trigger', v_del_filas),
    ('service_role: truncate sobre proyeccion_lote_filas lo rechaza el trigger', v_trunc_filas),
    ('service_role: truncate sobre proyeccion_lotes (junto con sus tablas referentes) lo rechaza el trigger', v_trunc_lotes),
    ('service_role: tras los intentos el lote y su linea siguen intactos',
      pg_temp.nlote(pg_temp.id(3201)) = 1 and pg_temp.nfilas(pg_temp.id(3201)) = 1
      and (select nota from public.proyeccion_lotes where id = pg_temp.id(3201)) = 'humo');
exception when others then
  reset role;
  insert into r (caso, ok) values ('service_role: pasada completa sin excepcion (fallo: ' || sqlerrm || ')', false);
end
$$;

-- Como postgres: update, delete y truncate fallan tambien. `truncate` no admite eventos de FK diferida pendientes: se comprueban ya.
set constraints all immediate;
insert into r (caso, ok) values
  ('postgres: update de nota en proyeccion_lotes rechazado por el trigger',
    pg_temp.falla(format('update public.proyeccion_lotes set nota = ''x'' where id = %L', pg_temp.id(3101)), '%inmutable%')),
  ('postgres: update de valor en una linea rechazado por el trigger',
    pg_temp.falla(format('update public.proyeccion_lote_filas set valor = 2 where lote_id = %L', pg_temp.id(3101)), '%inmutable%')),
  ('postgres: update de lote_id en una linea (mover una linea a otro lote) rechazado',
    pg_temp.falla(format('update public.proyeccion_lote_filas set lote_id = %L where lote_id = %L', pg_temp.id(3102), pg_temp.id(3101)), '%inmutable%')),
  ('postgres: delete de un lote rechazado por el trigger',
    pg_temp.falla(format('delete from public.proyeccion_lotes where id = %L', pg_temp.id(3101)), '%inmutable%')),
  ('postgres: delete de una linea rechazado por el trigger',
    pg_temp.falla(format('delete from public.proyeccion_lote_filas where lote_id = %L', pg_temp.id(3101)), '%inmutable%')),
  ('postgres: truncate de proyeccion_lote_filas rechazado por el trigger por sentencia',
    pg_temp.falla('truncate table public.proyeccion_lote_filas', '%inmutable%')),
  ('postgres: truncate de proyeccion_lotes (con sus tablas referentes) rechazado por el trigger por sentencia',
    pg_temp.falla('truncate table public.proyeccion_lotes, public.proyeccion_lote_filas, public.proyeccion_fila_anios', '%inmutable%')),
  ('postgres: update que pone perfil_id en un perfil distinto (no NULL) rechazado',
    pg_temp.falla(format('update public.proyeccion_lotes set perfil_id = %L where id = %L', (select perfil_b from ids), pg_temp.id(3101)), '%solo se admite poner%')),
  ('postgres: update que pone perfil_id en NULL es aceptado (la unica excepcion, la de la FK set null)',
    pg_temp.acepta(format('update public.proyeccion_lotes set perfil_id = null where id = %L', pg_temp.id(3102))));

-- La excepcion de verdad: borrar el perfil (FK set null a lotes), la proyeccion B (set null en lotes; set null de fila_id en
-- lineas) y una fila (set null). El historial sobrevive sin el vinculo.
do $$
declare
  v_perfil_antes integer;
  v_lineas_b integer;
begin
  select count(*) into v_perfil_antes from public.proyeccion_lotes where perfil_id = (select perfil_a from ids);
  delete from public.perfiles where id = (select perfil_a from ids);
  select count(*) into v_lineas_b from public.proyeccion_lote_filas where lote_id = pg_temp.id(3176) and fila_id is not null;
  delete from public.proyecciones where nombre = 'HUMO 31 B';
  insert into r (caso, ok) values
    ('borrar el perfil: los lotes que lo referian quedan con perfil_id NULL (set null) y siguen existiendo',
      v_perfil_antes > 0 and (select count(*) from public.proyeccion_lotes where perfil_id = (select perfil_a from ids)) = 0
      and pg_temp.nlote(pg_temp.id(3101)) = 1),
    ('borrar la proyeccion B: su lote queda con proyeccion_id NULL, y su linea con fila_id NULL (fila_clave sobrevive)',
      v_lineas_b = 1
      and (select proyeccion_id is null from public.proyeccion_lotes where id = pg_temp.id(3176))
      and (select count(*) from public.proyeccion_lote_filas where lote_id = pg_temp.id(3176) and fila_id is null and fila_clave = 'H31-B1') = 1);
exception when others then
  insert into r (caso, ok) values ('borrar perfil y proyeccion: la FK set null debe pasar el trigger (fallo: ' || sqlerrm || ')', false);
end
$$;

-- Permisos de anon y authenticated
do $$
declare
  v_anon_sel boolean := false; v_auth_sel boolean := false;
  v_anon_ins boolean := false; v_auth_ins boolean := false;
  v_anon_fn boolean := false; v_auth_fn boolean := false;
  v_anon_rs boolean := false; v_auth_rs boolean := false;
  v_anon_trg boolean := false; v_auth_trg boolean := false;
begin
  set local role anon;
  begin perform 1 from public.proyeccion_lotes; exception when insufficient_privilege then v_anon_sel := true; end;
  begin perform 1 from public.proyeccion_lote_filas; exception when insufficient_privilege then v_anon_ins := true; end;
  begin perform public.aplicar_lote_proyeccion('{}'::jsonb); exception when insufficient_privilege then v_anon_fn := true; end;
  begin perform public.respuesta_lote_proyeccion(gen_random_uuid(), false); exception when insufficient_privilege then v_anon_rs := true; end;
  begin perform public.tg_proyeccion_lote_inmutable(); exception when insufficient_privilege then v_anon_trg := true; end;
  reset role;
  set local role authenticated;
  begin perform 1 from public.proyeccion_lotes; exception when insufficient_privilege then v_auth_sel := true; end;
  begin perform 1 from public.proyeccion_lote_filas; exception when insufficient_privilege then v_auth_ins := true; end;
  begin perform public.aplicar_lote_proyeccion('{}'::jsonb); exception when insufficient_privilege then v_auth_fn := true; end;
  begin perform public.respuesta_lote_proyeccion(gen_random_uuid(), false); exception when insufficient_privilege then v_auth_rs := true; end;
  begin perform public.tg_proyeccion_lote_inmutable(); exception when insufficient_privilege then v_auth_trg := true; end;
  reset role;
  insert into r (caso, ok) values
    ('anon no lee las 2 tablas ni ejecuta aplicar_lote_proyeccion, respuesta_lote_proyeccion ni el trigger',
      v_anon_sel and v_anon_ins and v_anon_fn and v_anon_rs and v_anon_trg),
    ('authenticated no lee las 2 tablas ni ejecuta aplicar_lote_proyeccion, respuesta_lote_proyeccion ni el trigger',
      v_auth_sel and v_auth_ins and v_auth_fn and v_auth_rs and v_auth_trg);
exception when others then
  reset role;
  insert into r (caso, ok) values ('anon y authenticated: prueba sin excepcion (fallo: ' || sqlerrm || ')', false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;
