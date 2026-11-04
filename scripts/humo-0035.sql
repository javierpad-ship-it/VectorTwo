-- Humo SQL de la migración 0035 (registro de migraciones aplicadas y privilegios de las tablas de solo inserción):
--   * `migraciones_aplicadas`: RLS activo y sin políticas; anon y authenticated sin ningún permiso; service_role solo select e insert;
--     backfill exacto (0000 a 0025, 0027, 0029 a 0034 y la propia 0035; sin 0026 ni 0028), sin duplicados, repetible, con el check de
--     formato del nombre;
--   * las 8 tablas de solo inserción (compra_eventos, compra_agrupador_eventos, ia_entradas, ia_llamadas, ia_propuestas_gm,
--     ia_propuestas_filas, proyeccion_lotes, proyeccion_lote_filas) quedan en select e insert para service_role: update, delete y
--     truncate fallan por PERMISO (42501), también con sus triggers deshabilitados (se prueba el privilegio, no el trigger);
--   * los triggers de inmutabilidad siguen frenando al dueño (postgres), que conserva sus privilegios;
--   * la FK `on delete set null` (borrar un perfil) sigue funcionando sin UPDATE para service_role: la acción referencial corre con
--     los privilegios del dueño de la tabla;
--   * sin daños colaterales: el resto de las tablas conserva sus privilegios (las únicas sin DELETE o sin TRUNCATE son las esperadas).
-- Las funciones existentes (importar_compra, registrar_propuesta_ia_gm, aplicar_lote_proyeccion, guardar_viaje...) se prueban con
-- los humos 0025, 0030, 0031, 0032 y 0034, ajustados en esta tanda donde asumían los privilegios antiguos.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0035.sql"
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- Todo va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Datos inventados.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- En Supabase `service_role` tiene BYPASSRLS; el rol de la base local no (ver humo-0032).
alter role service_role bypassrls;

create temp table r (n serial, caso text, ok boolean);

-- Devuelve el SQLSTATE del error que da `q`, o 'ok' si no falla. `como` es el rol con el que se corre (null = el dueño).
-- `set local role` dentro de la función: si `q` falla, el subtransaction deshecho devuelve el rol.
create or replace function pg_temp.estado(q text, como text default null) returns text language plpgsql as $f$
begin
  if como is not null then
    execute format('set local role %I', como);
  end if;
  execute q;
  reset role;
  return 'ok';
exception when others then
  reset role;
  return sqlstate;
end
$f$;

-- Mismo, pero devuelve el mensaje (para reconocer el trigger de inmutabilidad: restrict_violation con «inmutable»).
create or replace function pg_temp.mensaje(q text) returns text language plpgsql as $f$
begin
  execute q;
  return 'ok';
exception when others then
  return sqlerrm;
end
$f$;

create temp table tablas8 (n text primary key);
insert into tablas8 values ('compra_eventos'), ('compra_agrupador_eventos'), ('ia_entradas'), ('ia_llamadas'), ('ia_propuestas_gm'),
  ('ia_propuestas_filas'), ('proyeccion_lotes'), ('proyeccion_lote_filas');
create temp table privs (p text primary key);
insert into privs values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger');

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Registro de migraciones
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('migraciones_aplicadas existe, con RLS activo y sin ninguna politica',
    (select c.relrowsecurity from pg_class c where c.oid = 'public.migraciones_aplicadas'::regclass)
    and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'migraciones_aplicadas') = 0),
  ('migraciones_aplicadas: anon y authenticated no tienen NINGUN permiso (select, insert, update, delete, truncate, references, trigger)',
    (select count(*) from privs, unnest(array['anon', 'authenticated']) ro(rol)
      where has_table_privilege(ro.rol, 'public.migraciones_aplicadas', privs.p)) = 0),
  ('migraciones_aplicadas: service_role tiene select e insert, y no update, delete, truncate, references ni trigger',
    has_table_privilege('service_role', 'public.migraciones_aplicadas', 'select')
    and has_table_privilege('service_role', 'public.migraciones_aplicadas', 'insert')
    and (select count(*) from privs where p not in ('select', 'insert') and has_table_privilege('service_role', 'public.migraciones_aplicadas', p)) = 0),
  ('migraciones_aplicadas: clave primaria nombre text; columnas nombre, aplicada_at (not null, default now) y nota',
    (select count(*) = 3 from information_schema.columns where table_schema = 'public' and table_name = 'migraciones_aplicadas'
       and ((column_name = 'nombre' and data_type = 'text' and is_nullable = 'NO')
         or (column_name = 'aplicada_at' and data_type = 'timestamp with time zone' and is_nullable = 'NO' and column_default like 'now()%')
         or (column_name = 'nota' and data_type = 'text' and is_nullable = 'YES')))
    and exists (select 1 from pg_constraint where conrelid = 'public.migraciones_aplicadas'::regclass and contype = 'p'
                  and pg_get_constraintdef(oid) = 'PRIMARY KEY (nombre)')),
  ('backfill: 34 filas hasta la 0035 (33 migraciones aplicadas antes del registro y la propia 0035; las posteriores, como la 0036, se registran aparte)',
    (select count(*) from public.migraciones_aplicadas where left(nombre, 4)::int <= 35) = 34),
  ('backfill: los numeros registrados son exactamente 0..25, 27 y 29..35 (ni 0026 ni 0028)',
    (select array_agg(left(nombre, 4)::int order by left(nombre, 4)::int) from public.migraciones_aplicadas where left(nombre, 4)::int <= 35)
      = (select array_agg(g order by g) from generate_series(0, 35) g where g not in (26, 28))),
  ('backfill: sin duplicados de numero (un solo nombre por numero) y todos con el formato NNNN_nombre',
    (select count(distinct left(nombre, 4)) from public.migraciones_aplicadas where left(nombre, 4)::int <= 35) = 34
    and (select count(*) from public.migraciones_aplicadas where nombre !~ '^[0-9]{4}_[a-z0-9_]+$') = 0),
  ('backfill: 33 filas llevan la nota del backfill y la 0035 se registra a si misma con su propia nota',
    (select count(*) from public.migraciones_aplicadas where nota = 'backfill de la 0035: aplicada antes de existir el registro') = 33
    and exists (select 1 from public.migraciones_aplicadas where nombre = '0035_registro_migraciones_y_privilegios'
                  and nota like 'crea el registro%')),
  ('backfill: ninguna fila lleva aplicada_at nulo ni futuro',
    (select count(*) from public.migraciones_aplicadas where aplicada_at is null or aplicada_at > now() + interval '1 minute') = 0);

-- Repetible: volver a insertar el backfill (como lo hace la migracion en su segunda pasada) no duplica ni cambia nada.
create temp table antes_reg as select nombre, aplicada_at, nota from public.migraciones_aplicadas;
insert into public.migraciones_aplicadas (nombre, nota) values ('0000_base', 'otra nota'), ('0035_registro_migraciones_y_privilegios', 'otra nota')
  on conflict (nombre) do nothing;
insert into r (caso, ok) values
  ('backfill repetible: insertar de nuevo con on conflict do nothing no duplica, no cambia notas ni fechas',
    (select count(*) from public.migraciones_aplicadas where left(nombre, 4)::int <= 35) = 34
    and (select count(*) from public.migraciones_aplicadas) = (select count(*) from antes_reg)
    and not exists (select 1 from antes_reg a join public.migraciones_aplicadas m using (nombre)
                      where a.aplicada_at is distinct from m.aplicada_at or a.nota is distinct from m.nota));

-- Como service_role (el rol de la API) y con los otros dos.
insert into r (caso, ok) values
  ('service_role lee la tabla de registro', pg_temp.estado('select count(*) from public.migraciones_aplicadas', 'service_role') = 'ok'),
  ('service_role inserta una migracion nueva (convencion: nombre y nota)',
    pg_temp.estado($q$insert into public.migraciones_aplicadas (nombre, nota) values ('9999_humo_servicio', 'humo') on conflict do nothing$q$, 'service_role') = 'ok'),
  ('service_role NO actualiza el registro (42501)',
    pg_temp.estado($q$update public.migraciones_aplicadas set nota = 'x'$q$, 'service_role') = '42501'),
  ('service_role NO borra del registro (42501)',
    pg_temp.estado($q$delete from public.migraciones_aplicadas$q$, 'service_role') = '42501'),
  ('service_role NO vacia el registro (42501)',
    pg_temp.estado($q$truncate public.migraciones_aplicadas$q$, 'service_role') = '42501'),
  ('anon no lee ni inserta en el registro (42501)',
    pg_temp.estado('select 1 from public.migraciones_aplicadas', 'anon') = '42501'
    and pg_temp.estado($q$insert into public.migraciones_aplicadas (nombre) values ('9999_anon')$q$, 'anon') = '42501'),
  ('authenticated no lee ni inserta en el registro (42501)',
    pg_temp.estado('select 1 from public.migraciones_aplicadas', 'authenticated') = '42501'
    and pg_temp.estado($q$insert into public.migraciones_aplicadas (nombre) values ('9999_auth')$q$, 'authenticated') = '42501'),
  ('el check de formato rechaza nombres sueltos, con mayusculas, sin numero o con .sql (23514)',
    pg_temp.estado($q$insert into public.migraciones_aplicadas (nombre) values ('suelta')$q$) = '23514'
    and pg_temp.estado($q$insert into public.migraciones_aplicadas (nombre) values ('0036_Mayusculas')$q$) = '23514'
    and pg_temp.estado($q$insert into public.migraciones_aplicadas (nombre) values ('0036_x.sql')$q$) = '23514'
    and pg_temp.estado($q$insert into public.migraciones_aplicadas (nombre) values ('36_corta')$q$) = '23514'),
  ('un nombre repetido sin on conflict falla por clave primaria (23505)',
    pg_temp.estado($q$insert into public.migraciones_aplicadas (nombre) values ('0000_base')$q$) = '23505');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Matriz de privilegios
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('las 8 tablas de solo insercion existen, con RLS activo y sin politicas',
    (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (select n from tablas8) and c.relrowsecurity) = 8
    and (select count(*) from pg_policies where schemaname = 'public' and tablename in (select n from tablas8)) = 0),
  ('las 8 tablas: anon y authenticated no tienen NINGUN permiso',
    (select count(*) from tablas8 t cross join privs cross join unnest(array['anon', 'authenticated']) ro(rol)
      where has_table_privilege(ro.rol, 'public.' || t.n, privs.p)) = 0),
  ('las 8 tablas: service_role tiene select e insert',
    (select count(*) from tablas8 t, unnest(array['select', 'insert']) p(priv)
      where not has_table_privilege('service_role', 'public.' || t.n, p.priv)) = 0),
  ('las 8 tablas: service_role NO tiene update, delete, truncate, references ni trigger',
    (select count(*) from tablas8 t, unnest(array['update', 'delete', 'truncate', 'references', 'trigger']) p(priv)
      where has_table_privilege('service_role', 'public.' || t.n, p.priv)) = 0),
  ('las 8 tablas: ni siquiera un update a nivel de columna (perfil_id, proyeccion_id, fila_id): la FK set null no lo necesita',
    (select count(*) from tablas8 t join information_schema.columns c on c.table_schema = 'public' and c.table_name = t.n
      where has_column_privilege('service_role', 'public.' || t.n, c.column_name, 'update')) = 0),
  ('las 8 tablas: el ACL no concede nada a PUBLIC (aclexplode sin grantee 0)',
    (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) x
      where c.relnamespace = 'public'::regnamespace and c.relname in (select n from tablas8) and x.grantee = 0) = 0),
  ('el dueño conserva sus privilegios (el trigger de inmutabilidad es la segunda barrera)',
    (select count(*) from tablas8 t, unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p(priv)
      where not has_table_privilege('postgres', 'public.' || t.n, p.priv)) = 0),
  ('ia_evaluaciones, ia_corridas e ia_corrida_gms: service_role conserva select, insert, update y delete, y pierde truncate',
    (select count(*) from unnest(array['ia_evaluaciones', 'ia_corridas', 'ia_corrida_gms']) t(n), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
      where not has_table_privilege('service_role', 'public.' || t.n, p.priv)) = 0
    and (select count(*) from unnest(array['ia_evaluaciones', 'ia_corridas', 'ia_corrida_gms']) t(n)
      where has_table_privilege('service_role', 'public.' || t.n, 'truncate')) = 0
    and (select count(*) from unnest(array['ia_evaluaciones', 'ia_corridas', 'ia_corrida_gms']) t(n), unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'references', 'trigger']) p(priv)
      where has_table_privilege('anon', 'public.' || t.n, p.priv) or has_table_privilege('authenticated', 'public.' || t.n, p.priv)) = 0),
  -- Sin daños colaterales: el conjunto de tablas SIN delete (o sin truncate) para service_role es exactamente el esperado.
  ('sin daños colaterales: las tablas sin DELETE para service_role son las 8 de solo insercion, el registro y los 3 agrupadores sin borrado (viajes, embarques, paquetes)',
    (select array_agg(c.relname::text order by c.relname) from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not has_table_privilege('service_role', c.oid, 'delete'))
    = (select array_agg(x order by x) from unnest(array['compra_eventos', 'compra_agrupador_eventos', 'ia_entradas', 'ia_llamadas', 'ia_propuestas_gm',
         'ia_propuestas_filas', 'proyeccion_lotes', 'proyeccion_lote_filas', 'migraciones_aplicadas', 'compra_viajes', 'compra_embarques', 'compra_paquetes']) x)),
  ('sin daños colaterales: las tablas sin UPDATE para service_role son solo las 8, el registro',
    (select array_agg(c.relname::text order by c.relname) from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not has_table_privilege('service_role', c.oid, 'update'))
    = (select array_agg(x order by x) from unnest(array['compra_eventos', 'compra_agrupador_eventos', 'ia_entradas', 'ia_llamadas', 'ia_propuestas_gm',
         'ia_propuestas_filas', 'proyeccion_lotes', 'proyeccion_lote_filas', 'migraciones_aplicadas']) x)),
  ('sin daños colaterales: las tablas sin TRUNCATE para service_role son las 8, el registro, los 3 terminales de la IA y las que ya lo tenian quitado (0032)',
    (select array_agg(c.relname::text order by c.relname) from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not has_table_privilege('service_role', c.oid, 'truncate'))
    = (select array_agg(x order by x) from unnest(array['compra_eventos', 'compra_agrupador_eventos', 'ia_entradas', 'ia_llamadas', 'ia_propuestas_gm',
         'ia_propuestas_filas', 'proyeccion_lotes', 'proyeccion_lote_filas', 'migraciones_aplicadas', 'ia_evaluaciones', 'ia_corridas', 'ia_corrida_gms',
         'compra_viajes', 'compra_embarques', 'compra_paquetes', 'compra_entrega_asignaciones']) x)),
  ('sin daños colaterales: anon y authenticated no tienen NINGUN permiso sobre NINGUNA tabla de public',
    (select count(*) from pg_class c cross join privs cross join unnest(array['anon', 'authenticated']) ro(rol)
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and has_table_privilege(ro.rol, c.oid, privs.p)) = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Intentos reales como service_role, con los triggers DESHABILITADOS (simulacion: se prueba el permiso, no el trigger)
-- ---------------------------------------------------------------------------------------------------------------------
-- 42501 = insufficient_privilege. Con el trigger activo el error seria restrict_violation (23001): que salga 42501 con el trigger
-- apagado prueba que el permiso, por si solo, ya frena la operacion. El `rollback` final reactiva los triggers.
alter table public.compra_eventos disable trigger user;
alter table public.compra_agrupador_eventos disable trigger user;
alter table public.ia_entradas disable trigger user;
alter table public.ia_llamadas disable trigger user;
alter table public.ia_propuestas_gm disable trigger user;
alter table public.ia_propuestas_filas disable trigger user;
alter table public.proyeccion_lotes disable trigger user;
alter table public.proyeccion_lote_filas disable trigger user;

insert into r (caso, ok)
select format('service_role no puede %s sobre %s (42501), ni con el trigger deshabilitado', o.op, t.n),
  pg_temp.estado(format(o.sql, t.n), 'service_role') = '42501'
from tablas8 t
cross join (values
  ('delete',   'delete from public.%I'),
  ('update',   'update public.%I set id = id'),
  ('truncate', 'truncate public.%I')) o(op, sql)
order by t.n, o.op;

-- Las columnas FK que el trigger deja poner en NULL tampoco se pueden actualizar a mano con service_role.
insert into r (caso, ok) values
  ('service_role no actualiza a mano perfil_id de compra_eventos (42501)',
    pg_temp.estado('update public.compra_eventos set perfil_id = null', 'service_role') = '42501'),
  ('service_role no actualiza a mano perfil_id de proyeccion_lotes (42501)',
    pg_temp.estado('update public.proyeccion_lotes set perfil_id = null', 'service_role') = '42501'),
  ('service_role no actualiza a mano fila_id de ia_propuestas_filas (42501)',
    pg_temp.estado('update public.ia_propuestas_filas set fila_id = null', 'service_role') = '42501');

alter table public.compra_eventos enable trigger user;
alter table public.compra_agrupador_eventos enable trigger user;
alter table public.ia_entradas enable trigger user;
alter table public.ia_llamadas enable trigger user;
alter table public.ia_propuestas_gm enable trigger user;
alter table public.ia_propuestas_filas enable trigger user;
alter table public.proyeccion_lotes enable trigger user;
alter table public.proyeccion_lote_filas enable trigger user;

insert into r (caso, ok) values
  ('los triggers de las 8 tablas quedan habilitados (tgenabled = O)',
    (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'public'::regnamespace and c.relname in (select n from tablas8) and not t.tgisinternal and t.tgenabled <> 'O') = 0
    and (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relnamespace = 'public'::regnamespace and c.relname in (select n from tablas8) and not t.tgisinternal
        and (t.tgname like '%\_inmutable' or t.tgname like '%\_sin\_vaciado')) = 16),
  ('con los triggers habilitados, service_role sigue sin poder: el permiso se comprueba antes (42501)',
    pg_temp.estado('delete from public.proyeccion_lotes', 'service_role') = '42501'
    and pg_temp.estado('truncate public.compra_eventos', 'service_role') = '42501');

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. El trigger sigue siendo la segunda barrera (el dueño conserva sus privilegios)
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok)
select format('dueño (postgres): truncate sobre %s lo rechaza el trigger por sentencia (inmutable)', t.n),
  -- `cascade`: sin él, las tablas referenciadas por una FK (ia_entradas, ia_propuestas_gm, proyeccion_lotes...) fallan antes de que
  -- dispare el trigger, con «cannot truncate a table referenced in a foreign key constraint»; con cascade llega al trigger.
  pg_temp.mensaje(format('truncate public.%I cascade', t.n)) like '%inmutable%'
from tablas8 t order by t.n;

insert into auth.users (id, email) values ('00000000-0000-4000-8000-000000000a01', 'humo35a@example.invalid');
insert into perfiles (id, email, nombre, rol, activo) values
  ('00000000-0000-4000-8000-000000000a01', 'humo35a@example.invalid', 'Humo 35 A', 'admin', true);

-- Un lote y una linea, insertados COMO service_role (insert + select siguen funcionando).
insert into r (caso, ok) values
  ('service_role inserta en proyeccion_lotes (insert funciona)',
    pg_temp.estado($q$insert into public.proyeccion_lotes (id, confirmacion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen, perfil_id, usuario_nombre)
      values ('00000000-0000-4000-8000-000000000b01', gen_random_uuid(), 'aprobar', 2026, repeat('a', 64), now(), '{}', '00000000-0000-4000-8000-000000000a01', 'Humo 35 A')$q$, 'service_role') = 'ok'),
  ('service_role inserta en proyeccion_lote_filas (insert funciona)',
    pg_temp.estado($q$insert into public.proyeccion_lote_filas (lote_id, fila_clave, gm_clave, anio, fuente, resultado)
      values ('00000000-0000-4000-8000-000000000b01', 'f1', 'g1', 2026, 'metodo', 'aplicada')$q$, 'service_role') = 'ok'),
  ('service_role lee lo que inserto (select funciona)',
    pg_temp.estado($q$select 1 from public.proyeccion_lotes where id = '00000000-0000-4000-8000-000000000b01'$q$, 'service_role') = 'ok'),
  ('dueño (postgres): update sobre proyeccion_lotes lo rechaza el trigger',
    pg_temp.mensaje($q$update public.proyeccion_lotes set nota = 'x'$q$) like '%inmutable%'),
  ('dueño (postgres): delete sobre proyeccion_lotes lo rechaza el trigger',
    pg_temp.mensaje($q$delete from public.proyeccion_lotes$q$) like '%inmutable%'),
  ('dueño (postgres): delete sobre proyeccion_lote_filas lo rechaza el trigger',
    pg_temp.mensaje($q$delete from public.proyeccion_lote_filas$q$) like '%inmutable%');

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. FK on delete set null sin UPDATE para service_role
-- ---------------------------------------------------------------------------------------------------------------------
-- Borrar el perfil con el rol de la API: la acción referencial pone perfil_id en NULL con los privilegios del dueño de la tabla,
-- aunque service_role no tenga update. El trigger deja pasar justo ese cambio.
insert into r (caso, ok) values
  ('antes de borrar el perfil, el lote lo cita', (select perfil_id from public.proyeccion_lotes where id = '00000000-0000-4000-8000-000000000b01') = '00000000-0000-4000-8000-000000000a01');
-- Sentencia aparte: el borrado y las lecturas siguientes no pueden compartir el snapshot de un mismo insert.
insert into r (caso, ok) values
  ('service_role borra el perfil (la FK on delete set null actua sin UPDATE de service_role)',
    pg_temp.estado($q$delete from public.perfiles where id = '00000000-0000-4000-8000-000000000a01'$q$, 'service_role') = 'ok');
insert into r (caso, ok) values
  ('el lote sobrevive con perfil_id NULL y conserva usuario_nombre',
    exists (select 1 from public.proyeccion_lotes where id = '00000000-0000-4000-8000-000000000b01' and perfil_id is null and usuario_nombre = 'Humo 35 A')),
  ('el resto de columnas del lote no cambio (la linea sigue ahi)',
    (select count(*) from public.proyeccion_lote_filas where lote_id = '00000000-0000-4000-8000-000000000b01') = 1);

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;
