-- Humo SQL de la migración 0039 (08c · E1: proveedores, historial, contactos y fotos de las líneas de compra):
--   * permisos y RLS: las 3 tablas nuevas con RLS activo y sin políticas; anon y authenticated sin ningún permiso; service_role con
--     lo justo (`proveedor_eventos` solo select e insert; `compra_linea_fotos` sin delete ni truncate; `proveedor_contactos` sin
--     truncate); las 9 funciones nuevas security invoker, search_path vacío, solo service_role y sin comentarios `--` en el cuerpo;
--   * Storage: el bucket `compras-fotos` existe, es PRIVADO (400 KB, solo JPEG) y NO hay ninguna política en TODO el esquema `storage`
--     (R9, M3); anon y authenticated no ven ni escriben objetos aunque conserven sus grants;
--   * `proveedor_eventos` es inmutable (UPDATE, DELETE y TRUNCATE) para el dueño y para service_role, con o sin privilegios, salvo el
--     UPDATE que solo pone `proveedor_id` o `perfil_id` en NULL (FK `set null`), que sigue funcionando (R11 de RP4);
--   * `guardar_proveedor`: crear, editar con revisión (`proveedor_cambio`), sin cambios no escribe, nombre y código repetidos con su
--     `conflicto`, contactos reemplazados en la MISMA transacción (un contacto inválido a mitad no deja nada, R13), `ya_cargado`, evento
--     `importar` (un evento por proveedor cargado) y `solo_planner_intercompany`;
--   * `cambiar_activo_proveedor` y `eliminar_proveedor` (borra sin compras y conserva sus eventos con `proveedor_id` nulo; desactiva
--     con compras);
--   * fotos: `agregar_foto_linea` (máximo 3 activas, `ya_cargada`, compra cancelada, ids cruzados, rutas con ids), `quitar_foto_linea`
--     (admin en compra cancelada, `ya_quitada`), `traer_fotos_linea` (una sola vez, hasta 3, origen intacto), todas SIN tocar
--     `compras.revision`, `compra_eventos` ni `flujo_huella_base()` (R7);
--   * `editar_ficha_linea`: sin `compras.revision`, `linea_cambio` con `p_antes` y sin 409 falso aunque la revisión de la compra haya
--     cambiado (R7b), evento `editar_linea` con antes, después y resumen;
--   * `fotos_huerfanas`: solo lectura, objetos sin fila y objetos de fotos quitadas con más de N horas, nunca los de una foto activa
--     ni los recientes (R10), con `p_limite`.
-- La concurrencia REAL (dos conexiones a la vez: máximo 3 fotos, candado compra -> línea sin interbloqueo) la prueba
-- tests/integracion/concurrencia.int.test.ts: un humo corre en una sola sesión. Aquí se prueba la secuencia (5 llamadas seguidas dejan
-- exactamente 3).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea la base local con todas las migraciones, dos veces)
--   3. bash scripts/correr-humos.sh scripts/humo-0039.sql
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- Las funciones se llaman con `set local role service_role` (la API corre con ese rol). Todo va dentro de UNA transacción que termina
-- en `rollback`: no deja nada escrito. Datos inventados.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- En Supabase `service_role` tiene BYPASSRLS; el rol de la base local no (ver humo-0032).
alter role service_role bypassrls;

create temp table r (n serial, caso text, ok boolean);
create temp table k (n text primary key, v uuid);
create temp table res (k text primary key, v jsonb);
create temp table privs (p text primary key);
insert into privs values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger');

create or replace function pg_temp.id(n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;
create or replace function pg_temp.act(n integer, rol text default null) returns jsonb language sql as $f$
  select jsonb_build_object('perfil_id', pg_temp.id(n), 'nombre', 'Humo 39 ' || n)
         || case when rol is null then '{}'::jsonb else jsonb_build_object('rol', rol) end $f$;
create or replace function pg_temp.kk(n text) returns uuid language sql as $f$ select v from k where k.n = $1 $f$;
create or replace function pg_temp.rk(n text) returns jsonb language sql as $f$ select v from res where res.k = $1 $f$;
create or replace function pg_temp.good(n text) returns boolean language sql as $f$
  select coalesce((v ->> 'ok')::boolean, false) from res where res.k = $1 $f$;
create or replace function pg_temp.mot(n text) returns text language sql as $f$
  select coalesce(v ->> 'motivo', 'ERR:' || coalesce(v ->> 'error', '?') || ' ' || coalesce(v ->> 'msg', '')) from res where res.k = $1 $f$;
create or replace function pg_temp.crev(c uuid) returns integer language sql as $f$ select revision from public.compras where id = c $f$;
create or replace function pg_temp.prev(p uuid) returns integer language sql as $f$ select revision from public.proveedores where id = p $f$;
create or replace function pg_temp.nev(p uuid, acc text default null) returns integer language sql as $f$
  select count(*)::integer from public.proveedor_eventos where proveedor_id = p and (acc is null or accion = acc) $f$;
create or replace function pg_temp.ncev(c uuid, acc text default null) returns integer language sql as $f$
  select count(*)::integer from public.compra_eventos where compra_id = c and (acc is null or accion = acc) $f$;
create or replace function pg_temp.nact(l uuid) returns integer language sql as $f$
  select count(*)::integer from public.compra_linea_fotos where linea_id = l and activo $f$;
create or replace function pg_temp.ncont(p uuid) returns integer language sql as $f$
  select count(*)::integer from public.proveedor_contactos where proveedor_id = p $f$;
create or replace function pg_temp.foto(n integer, extra jsonb default '{}'::jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('id', pg_temp.id(n), 'ancho', 800, 'alto', 600, 'bytes', 150000, 'bytes_miniatura', 20000) || extra $f$;
create or replace function pg_temp.ruta(c uuid, l uuid, f uuid, min boolean default false) returns text language sql as $f$
  select 'compras/' || c::text || '/' || l::text || '/' || f::text || case when min then '_min.jpg' else '.jpg' end $f$;

-- Devuelve el SQLSTATE del error que da `q`, o 'ok' si no falla. `como` es el rol con el que se corre (null = el dueño).
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
create or replace function pg_temp.mensaje(q text) returns text language plpgsql as $f$
begin
  execute q;
  return 'ok';
exception when others then
  return sqlerrm;
end
$f$;
-- Cuenta lo que un rol ve de `storage.objects` (con RLS sin políticas, anon y authenticated ven 0 aunque tengan select).
create or replace function pg_temp.ve_objetos(como text) returns text language plpgsql as $f$
declare v bigint;
begin
  execute format('set local role %I', como);
  select count(*) into v from storage.objects;
  reset role;
  return v::text;
exception when others then
  reset role;
  return sqlstate;
end
$f$;

-- Llamadas con el rol de la API. Devuelven el jsonb de la función o { error, msg } si lanzó una excepción (y deshacen lo que hizo).
create or replace function pg_temp.r_gp(p_id uuid, rev integer, prov jsonb, cont jsonb, a jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.guardar_proveedor(p_id, rev, prov, cont, a);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_ca(p_id uuid, activo boolean, a jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.cambiar_activo_proveedor(p_id, activo, a);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_ep(p_id uuid, a jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.eliminar_proveedor(p_id, a);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_af(c uuid, l uuid, f jsonb, a jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.agregar_foto_linea(c, l, f, a);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_qf(c uuid, l uuid, f uuid, a jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.quitar_foto_linea(c, l, f, a);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_tf(c uuid, l uuid, o uuid, f jsonb, a jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.traer_fotos_linea(c, l, o, f, a);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_ef(c uuid, l uuid, antes jsonb, d text, m text, a jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.editar_ficha_linea(c, l, antes, d, m, a);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_fh(horas integer, limite integer default 1000) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.fotos_huerfanas(horas, limite);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture: cuatro perfiles, un nodo género × mundo × línea, proveedores y compras con líneas (insert directo, como los humos)
-- ---------------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  (pg_temp.id(9001), 'h39a@example.invalid'), (pg_temp.id(9002), 'h39p@example.invalid'),
  (pg_temp.id(9003), 'h39c@example.invalid'), (pg_temp.id(9004), 'h39d@example.invalid');
insert into public.perfiles (id, email, nombre, rol, activo) values
  (pg_temp.id(9001), 'h39a@example.invalid', 'Humo 39 admin', 'admin', true),
  (pg_temp.id(9002), 'h39p@example.invalid', 'Humo 39 planner', 'planner', true),
  (pg_temp.id(9003), 'h39c@example.invalid', 'Humo 39 comprador', 'comprador', true),
  (pg_temp.id(9004), 'h39d@example.invalid', 'Humo 39 comprador 2', 'comprador', true);
insert into public.generos (codigo, nombre) values ('GH39', 'GENERO H39');
insert into public.mundos (codigo, nombre) values ('MH39', 'MUNDO H39');
insert into public.lineas (codigo, nombre, temporada) values ('LH39', 'LINEA H39', 'Todo el año');
insert into public.genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
  select g.id, m.id, l.id, 'GML' from public.generos g, public.mundos m, public.lineas l
  where g.codigo = 'GH39' and m.codigo = 'MH39' and l.codigo = 'LH39';

-- Proveedor «con compras» (por el camino normal: guardar_proveedor).
insert into res values ('prov_a', pg_temp.r_gp(null, null, '{"nombre":"Humo Norte","pais":"Perú"}', '[]', pg_temp.act(9003, 'comprador')));
insert into k select 'PA', (pg_temp.rk('prov_a') ->> 'proveedor_id')::uuid;

-- Compras: C1 confirmada (L1, L2, L3), C2 borrador (L4), C3 cancelada (L5 con clave K1), C4 recibida (L6), C5 otra confirmada (L7),
-- C6 confirmada (L8 con clave K1: la «versión corregida» de C3; L9 sin clave). Todas del proveedor PA salvo C7 (L10, de otro proveedor).
insert into res values ('prov_b', pg_temp.r_gp(null, null, '{"nombre":"Humo Otro Proveedor"}', '[]', pg_temp.act(9001, 'admin')));
insert into k select 'PB', (pg_temp.rk('prov_b') ->> 'proveedor_id')::uuid;
insert into public.compras (id, proveedor_id, origen, estado, fecha_compra, referencia, confirmada_at, perfil_id, cancelada_at) values
  (pg_temp.id(1001), pg_temp.kk('PA'), 'carga_inicial', 'confirmada', date '2026-09-10', 'H39-1', now(), pg_temp.id(9001), null),
  (pg_temp.id(1002), pg_temp.kk('PA'), 'comprador', 'borrador', date '2026-09-10', 'H39-2', null, pg_temp.id(9003), null),
  (pg_temp.id(1003), pg_temp.kk('PA'), 'carga_inicial', 'cancelada', date '2026-09-10', 'H39-3', now(), pg_temp.id(9001), now()),
  (pg_temp.id(1004), pg_temp.kk('PA'), 'carga_inicial', 'recibida', date '2026-09-10', 'H39-4', now(), pg_temp.id(9001), null),
  (pg_temp.id(1005), pg_temp.kk('PA'), 'carga_inicial', 'confirmada', date '2026-09-10', 'H39-5', now(), pg_temp.id(9001), null),
  (pg_temp.id(1006), pg_temp.kk('PA'), 'carga_inicial', 'confirmada', date '2026-09-10', 'H39-3B', now(), pg_temp.id(9001), null),
  (pg_temp.id(1007), pg_temp.kk('PB'), 'carga_inicial', 'confirmada', date '2026-09-10', 'H39-7', now(), pg_temp.id(9001), null);
insert into public.compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, unidades, llegada_periodo, costo_unitario, clave_importacion, activo)
select pg_temp.id(l), pg_temp.id(c), 'especifica', g.id, 100, date '2026-11-01', 10, clave, coalesce(activo, true)
from (values
  (2001, 1001, null::text, null::boolean), (2002, 1001, null, null), (2003, 1001, null, false),
  (2004, 1002, null, null), (2005, 1003, 'PA|H39-3|1', null), (2006, 1004, null, null), (2007, 1005, null, null),
  (2008, 1006, 'PA|H39-3|1', null), (2009, 1006, null, null), (2010, 1007, 'PB|H39-7|1', null)
) v(l, c, clave, activo),
(select id from public.genero_mundo_linea limit 1) g;

-- Huella del estado que las fotos NO deben mover.
create temp table base as
  select (select revision from public.compras where id = pg_temp.id(1001)) as rev1,
         (select count(*) from public.compra_eventos) as eventos,
         public.flujo_huella_base()::text as huella;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura, RLS y privilegios
-- ---------------------------------------------------------------------------------------------------------------------
create temp table tablas3 (n text primary key);
insert into tablas3 values ('proveedor_contactos'), ('proveedor_eventos'), ('compra_linea_fotos');
create temp table funcs9 (n text primary key);
insert into funcs9 values ('proveedor_foto'), ('guardar_proveedor'), ('cambiar_activo_proveedor'), ('eliminar_proveedor'),
  ('agregar_foto_linea'), ('quitar_foto_linea'), ('traer_fotos_linea'), ('editar_ficha_linea'), ('fotos_huerfanas');

insert into r (caso, ok) values
  ('las 3 tablas nuevas existen, con RLS activo y sin ninguna politica',
    (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (select n from tablas3) and c.relrowsecurity) = 3
    and (select count(*) from pg_policies where schemaname = 'public') = 0),
  ('las 3 tablas: anon y authenticated no tienen NINGUN permiso',
    (select count(*) from tablas3 t cross join privs cross join unnest(array['anon', 'authenticated']) ro(rol)
      where has_table_privilege(ro.rol, 'public.' || t.n, privs.p)) = 0),
  ('las 3 tablas: el ACL no concede nada a PUBLIC',
    (select count(*) from pg_class c cross join lateral aclexplode(c.relacl) x
      where c.relnamespace = 'public'::regnamespace and c.relname in (select n from tablas3) and x.grantee = 0) = 0),
  ('proveedor_contactos: service_role tiene select, insert, update y delete, y no truncate, references ni trigger',
    (select count(*) from unnest(array['select', 'insert', 'update', 'delete']) p(priv)
      where not has_table_privilege('service_role', 'public.proveedor_contactos', p.priv)) = 0
    and (select count(*) from unnest(array['truncate', 'references', 'trigger']) p(priv)
      where has_table_privilege('service_role', 'public.proveedor_contactos', p.priv)) = 0),
  ('proveedor_eventos: service_role tiene SOLO select e insert (ni update, delete, truncate, references ni trigger)',
    has_table_privilege('service_role', 'public.proveedor_eventos', 'select')
    and has_table_privilege('service_role', 'public.proveedor_eventos', 'insert')
    and (select count(*) from privs where p not in ('select', 'insert') and has_table_privilege('service_role', 'public.proveedor_eventos', p)) = 0),
  ('proveedor_eventos: ni un update a nivel de columna para service_role (la FK set null no lo necesita)',
    (select count(*) from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'proveedor_eventos'
        and has_column_privilege('service_role', 'public.proveedor_eventos', c.column_name, 'update')) = 0),
  ('compra_linea_fotos: service_role tiene select, insert y update, y NO delete, truncate, references ni trigger (una foto nunca se borra)',
    has_table_privilege('service_role', 'public.compra_linea_fotos', 'select')
    and has_table_privilege('service_role', 'public.compra_linea_fotos', 'insert')
    and has_table_privilege('service_role', 'public.compra_linea_fotos', 'update')
    and (select count(*) from unnest(array['delete', 'truncate', 'references', 'trigger']) p(priv)
      where has_table_privilege('service_role', 'public.compra_linea_fotos', p.priv)) = 0),
  ('las 9 funciones nuevas existen, son security invoker y fijan search_path vacio',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select n from funcs9)
       and not p.prosecdef and 'search_path=""' = any (p.proconfig)) = 9),
  ('las 9 funciones: execute solo para service_role (ni anon, ni authenticated, ni PUBLIC)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (select n from funcs9)
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')
       and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)) = 9),
  ('las 9 funciones y el trigger de eventos: ningun cuerpo lleva comentarios con dos guiones (se aplican por execute_sql en trozos)',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
       and (p.proname in (select n from funcs9) or p.proname = 'tg_proveedor_eventos_inmutable') and p.prosrc like '%--%') = 0),
  ('fotos_huerfanas es de solo lectura (stable); proveedor_foto tambien',
    (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('fotos_huerfanas', 'proveedor_foto') and p.provolatile = 's') = 2),
  ('anon y authenticated reciben 42501 al llamar cada funcion nueva',
    pg_temp.estado($q$select public.guardar_proveedor(null, null, '{"nombre":"X"}', null, '{}')$q$, 'anon') = '42501'
    and pg_temp.estado($q$select public.guardar_proveedor(null, null, '{"nombre":"X"}', null, '{}')$q$, 'authenticated') = '42501'
    and pg_temp.estado($q$select public.fotos_huerfanas(24)$q$, 'anon') = '42501'
    and pg_temp.estado($q$select public.fotos_huerfanas(24)$q$, 'authenticated') = '42501'
    and pg_temp.estado($q$select public.agregar_foto_linea(gen_random_uuid(), gen_random_uuid(), '{}', '{}')$q$, 'anon') = '42501'
    and pg_temp.estado($q$select public.editar_ficha_linea(gen_random_uuid(), gen_random_uuid(), '{}', null, null, '{}')$q$, 'authenticated') = '42501'),
  ('anon y authenticated reciben 42501 al leer o escribir las tablas nuevas',
    pg_temp.estado('select 1 from public.proveedor_eventos', 'anon') = '42501'
    and pg_temp.estado('select 1 from public.compra_linea_fotos', 'authenticated') = '42501'
    and pg_temp.estado($q$insert into public.proveedor_contactos (proveedor_id, nombre) values (gen_random_uuid(), 'x')$q$, 'authenticated') = '42501'),
  ('proveedores: las 12 columnas nuevas existen (revision not null default 0; el resto, opcional)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proveedores'
       and column_name in ('direccion', 'region', 'puerto_embarque', 'incoterm', 'moneda', 'plazo_produccion_dias', 'plazo_transito_dias',
         'condiciones_pago', 'revision', 'updated_by_id', 'updated_by_nombre', 'clave_origen')) = 12
    and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proveedores'
       and column_name = 'revision' and is_nullable = 'NO' and column_default = '0') = 1
    and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proveedores'
       and column_name in ('direccion', 'region', 'puerto_embarque', 'incoterm', 'moneda', 'plazo_produccion_dias', 'plazo_transito_dias',
         'condiciones_pago', 'updated_by_id', 'updated_by_nombre', 'clave_origen') and is_nullable = 'YES') = 11),
  ('compra_lineas: descripcion y modelo opcionales (check de 200 y 60)',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compra_lineas'
       and column_name in ('descripcion', 'modelo') and is_nullable = 'YES') = 2
    and pg_temp.estado($q$update public.compra_lineas set descripcion = repeat('x', 201) where id = pg_temp.id(2001)$q$) = '23514'
    and pg_temp.estado($q$update public.compra_lineas set modelo = repeat('x', 61) where id = pg_temp.id(2001)$q$) = '23514'),
  ('indices unicos parciales: clave_origen de proveedores y de fotos, un solo contacto principal, foto traida una vez por linea',
    (select count(*) from pg_indexes where schemaname = 'public' and indexname in
       ('proveedores_clave_origen_uidx', 'compra_linea_fotos_clave_origen_uidx', 'proveedor_contactos_principal_uidx', 'compra_linea_fotos_traida_uidx')
       and indexdef like 'CREATE UNIQUE INDEX%' and indexdef like '%WHERE%') = 4),
  ('la migracion se registro a si misma en migraciones_aplicadas',
    exists (select 1 from public.migraciones_aplicadas where nombre = '0039_proveedores_y_fotos'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Storage: bucket privado y ninguna política en el esquema `storage` (R9, M3)
-- ---------------------------------------------------------------------------------------------------------------------
insert into storage.objects (bucket_id, name, created_at) values
  ('compras-fotos', 'compras/humo/visible-solo-al-servicio.jpg', now() - interval '30 hours');
insert into r (caso, ok) values
  ('el bucket compras-fotos existe, es PRIVADO, de 400 KB y solo image/jpeg',
    exists (select 1 from storage.buckets where id = 'compras-fotos' and name = 'compras-fotos' and public = false
              and file_size_limit = 409600 and allowed_mime_types = array['image/jpeg'])),
  ('NINGUNA politica en TODO el esquema storage (no basta buscar las que nombren compras-fotos: una using(true) abriria el bucket sin nombrarlo)',
    (select count(*) from pg_policies where schemaname = 'storage') = 0),
  ('RLS activo en storage.objects',
    (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass)),
  ('anon y authenticated no ven NINGUN objeto aunque conserven el grant (RLS sin politicas), y service_role si',
    pg_temp.ve_objetos('anon') = '0' and pg_temp.ve_objetos('authenticated') = '0' and pg_temp.ve_objetos('service_role') <> '0'),
  ('anon y authenticated no pueden subir un objeto al bucket (RLS, 42501)',
    pg_temp.estado($q$insert into storage.objects (bucket_id, name) values ('compras-fotos', 'compras/x/y/z.jpg')$q$, 'anon') = '42501'
    and pg_temp.estado($q$insert into storage.objects (bucket_id, name) values ('compras-fotos', 'compras/x/y/z.jpg')$q$, 'authenticated') = '42501'),
  ('volver a insertar el bucket con on conflict do nothing no lo cambia (idempotente)',
    pg_temp.estado($q$insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('compras-fotos', 'compras-fotos', true, 1, array['image/png']) on conflict (id) do nothing$q$) = 'ok'
    and exists (select 1 from storage.buckets where id = 'compras-fotos' and public = false and file_size_limit = 409600)),
  ('los objetos no se borran por SQL (protect_objects_delete): el DELETE directo falla',
    pg_temp.estado($q$delete from storage.objects where bucket_id = 'compras-fotos'$q$) <> 'ok');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. proveedor_eventos es inmutable (decisión 103)
-- ---------------------------------------------------------------------------------------------------------------------
-- Un evento de prueba, por el camino normal (PA ya tiene su evento crear).
insert into r (caso, ok) values
  ('PA tiene su evento crear con despues y sin antes, a nombre de quien lo creo',
    exists (select 1 from public.proveedor_eventos where proveedor_id = pg_temp.kk('PA') and accion = 'crear' and antes is null
              and despues ->> 'nombre' = 'Humo Norte' and perfil_id = pg_temp.id(9003) and usuario_nombre = 'Humo 39 9003'
              and proveedor_nombre = 'Humo Norte'));
-- Sentencia aparte: un TRUNCATE no puede correr mientras otra consulta de la MISMA sentencia lee la tabla (55006).
insert into r (caso, ok) values
  ('dueño: UPDATE, DELETE y TRUNCATE sobre proveedor_eventos los rechaza el trigger (restrict_violation 23001, inmutable)',
    pg_temp.estado($q$update public.proveedor_eventos set resumen = 'x'$q$) = '23001'
    and pg_temp.estado($q$delete from public.proveedor_eventos$q$) = '23001'
    and pg_temp.estado($q$truncate public.proveedor_eventos$q$) = '23001'
    and pg_temp.mensaje($q$update public.proveedor_eventos set resumen = 'x'$q$) like '%inmutable%'
    and pg_temp.mensaje($q$truncate public.proveedor_eventos$q$) like '%inmutable%'),
  ('service_role: UPDATE, DELETE y TRUNCATE los frena el permiso (42501)',
    pg_temp.estado($q$update public.proveedor_eventos set resumen = 'x'$q$, 'service_role') = '42501'
    and pg_temp.estado($q$delete from public.proveedor_eventos$q$, 'service_role') = '42501'
    and pg_temp.estado($q$truncate public.proveedor_eventos$q$, 'service_role') = '42501');

-- Segunda barrera: aunque alguien devolviera los privilegios a service_role, el trigger sigue rechazando.
grant update, delete, truncate on public.proveedor_eventos to service_role;
insert into r (caso, ok) values
  ('aun con update, delete y truncate concedidos, service_role sigue rechazado por el trigger (23001)',
    pg_temp.estado($q$update public.proveedor_eventos set resumen = 'x'$q$, 'service_role') = '23001'
    and pg_temp.estado($q$delete from public.proveedor_eventos$q$, 'service_role') = '23001'
    and pg_temp.estado($q$truncate public.proveedor_eventos$q$, 'service_role') = '23001'),
  ('poner perfil_id en NULL y cambiar otra columna a la vez sigue prohibido (23001); un UPDATE que no cambia nada tambien',
    pg_temp.estado($q$update public.proveedor_eventos set perfil_id = null, resumen = 'cambiado'$q$, 'service_role') = '23001'
    and pg_temp.estado($q$update public.proveedor_eventos set resumen = resumen$q$, 'service_role') = '23001'
    and pg_temp.estado($q$update public.proveedor_eventos set perfil_id = (select id from public.perfiles limit 1)$q$) = '23001');
revoke update, delete, truncate on public.proveedor_eventos from service_role;
insert into r (caso, ok) values
  ('se devolvieron los privilegios: service_role vuelve a tener solo select e insert',
    (select count(*) from privs where p not in ('select', 'insert') and has_table_privilege('service_role', 'public.proveedor_eventos', p)) = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. guardar_proveedor
-- ---------------------------------------------------------------------------------------------------------------------
-- Crear con ficha completa y dos contactos (ninguno principal: el primero pasa a serlo).
insert into res values
  ('c1', pg_temp.r_gp(null, null,
    '{"nombre":"  Textiles Delta Ltd.  ","codigo":"TDL","pais":"China","region":"Zhejiang","ciudad":"Ningbo","direccion":"Calle 1","identificacion":"TAX-1","puerto_embarque":"Ningbo","incoterm":"FOB","moneda":"USD","plazo_produccion_dias":45,"plazo_transito_dias":35,"condiciones_pago":"30/70","nota":"n"}',
    '[{"nombre":"Ana","cargo":"Ventas","telefono":"+86 1","correo":"ana@example.invalid"},{"nombre":"Beto","correo":""}]',
    pg_temp.act(9003, 'comprador')));
insert into k select 'T', (pg_temp.rk('c1') ->> 'proveedor_id')::uuid;
insert into r (caso, ok) values
  ('crear: ok, revision 0, accion crear, sin_cambios false',
    pg_temp.good('c1') and (pg_temp.rk('c1') ->> 'revision')::int = 0 and pg_temp.rk('c1') ->> 'accion' = 'crear' and (pg_temp.rk('c1') ->> 'sin_cambios')::boolean = false),
  ('crear: el nombre se guarda recortado y todos los campos de la ficha quedan escritos, con quien lo creo en perfil_id y updated_by_id',
    exists (select 1 from public.proveedores where id = pg_temp.kk('T') and nombre = 'Textiles Delta Ltd.' and codigo = 'TDL' and pais = 'China'
      and region = 'Zhejiang' and ciudad = 'Ningbo' and direccion = 'Calle 1' and identificacion = 'TAX-1' and puerto_embarque = 'Ningbo'
      and incoterm = 'FOB' and moneda = 'USD' and plazo_produccion_dias = 45 and plazo_transito_dias = 35 and condiciones_pago = '30/70'
      and nota = 'n' and revision = 0 and activo and not es_intercompany and perfil_id = pg_temp.id(9003) and updated_by_id = pg_temp.id(9003)
      and clave_origen is null)),
  ('crear: dos contactos, el primero es el principal (R13), con orden 0 y 1; correo vacio queda nulo',
    pg_temp.ncont(pg_temp.kk('T')) = 2
    and exists (select 1 from public.proveedor_contactos where proveedor_id = pg_temp.kk('T') and nombre = 'Ana' and es_principal and orden = 0 and correo = 'ana@example.invalid')
    and exists (select 1 from public.proveedor_contactos where proveedor_id = pg_temp.kk('T') and nombre = 'Beto' and not es_principal and orden = 1 and correo is null)),
  ('crear: deja exactamente un evento crear con la instantanea (ficha y contactos) en despues y sin antes',
    pg_temp.nev(pg_temp.kk('T')) = 1
    and exists (select 1 from public.proveedor_eventos where proveedor_id = pg_temp.kk('T') and accion = 'crear' and antes is null
      and despues ->> 'pais' = 'China' and jsonb_array_length(despues -> 'contactos') = 2 and resumen like 'Proveedor creado:%')),
  ('la instantanea nunca trae banco, clave_origen ni revision',
    not (public.proveedor_foto(pg_temp.kk('T')) ?| array['banco', 'cuenta', 'bank_name', 'bank_account', 'clave_origen', 'revision'])),
  ('proveedor_foto de un id inexistente devuelve NULL',
    public.proveedor_foto(gen_random_uuid()) is null);

-- Nombre y código repetidos (único sobre upper): también con espacios y mayúsculas distintas; el repetido inactivo se señala.
insert into res values
  ('nr', pg_temp.r_gp(null, null, '{"nombre":"textiles delta ltd. "}', null, pg_temp.act(9003, 'comprador'))),
  ('cr', pg_temp.r_gp(null, null, '{"nombre":"Otro Nombre H39","codigo":"tdl"}', null, pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('nombre repetido (R11): nombre_repetido con conflicto { id, nombre, activo true } y nada escrito',
    pg_temp.mot('nr') = 'nombre_repetido' and (pg_temp.rk('nr') #>> '{conflicto,id}')::uuid = pg_temp.kk('T')
    and pg_temp.rk('nr') #>> '{conflicto,nombre}' = 'Textiles Delta Ltd.' and (pg_temp.rk('nr') #>> '{conflicto,activo}')::boolean
    and (select count(*) from public.proveedores where upper(nombre) = 'TEXTILES DELTA LTD.') = 1),
  ('codigo repetido: codigo_repetido con conflicto, sin crear el proveedor',
    pg_temp.mot('cr') = 'codigo_repetido' and (pg_temp.rk('cr') #>> '{conflicto,id}')::uuid = pg_temp.kk('T')
    and not exists (select 1 from public.proveedores where nombre = 'Otro Nombre H39'));

-- Sin cambios: no escribe evento ni sube revision. (Mismo contenido que lo guardado.)
insert into res values
  ('sc', pg_temp.r_gp(pg_temp.kk('T'), 0,
    '{"nombre":"Textiles Delta Ltd.","codigo":"TDL","pais":"China","region":"Zhejiang","ciudad":"Ningbo","direccion":"Calle 1","identificacion":"TAX-1","puerto_embarque":"Ningbo","incoterm":"FOB","moneda":"USD","plazo_produccion_dias":45,"plazo_transito_dias":35,"condiciones_pago":"30/70","nota":"n"}',
    '[{"nombre":"Ana","cargo":"Ventas","telefono":"+86 1","correo":"ana@example.invalid","es_principal":true},{"nombre":"Beto"}]',
    pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('un guardado sin cambios: ok, sin_cambios true, no sube revision ni escribe evento y no toca los contactos (mismos ids)',
    pg_temp.good('sc') and (pg_temp.rk('sc') ->> 'sin_cambios')::boolean and pg_temp.prev(pg_temp.kk('T')) = 0 and pg_temp.nev(pg_temp.kk('T')) = 1
    and pg_temp.ncont(pg_temp.kk('T')) = 2);

-- Editar: renombrar y cambiar el teléfono de un contacto en un solo guardado.
insert into res values
  ('e1', pg_temp.r_gp(pg_temp.kk('T'), 0,
    '{"nombre":"Textiles Delta Limited","codigo":"TDL","pais":"China","region":"Zhejiang","ciudad":"Ningbo","direccion":"Calle 1","identificacion":"TAX-1","puerto_embarque":"Shenzhen","incoterm":"FOB","moneda":"USD","plazo_produccion_dias":45,"plazo_transito_dias":35,"condiciones_pago":"30/70","nota":"n"}',
    '[{"nombre":"Ana","cargo":"Ventas","telefono":"+86 999","correo":"ana@example.invalid","es_principal":true},{"nombre":"Beto"}]',
    pg_temp.act(9004, 'comprador')));
insert into r (caso, ok) values
  ('editar: ok, revision 1, updated_by del que edito y el creador intacto',
    pg_temp.good('e1') and (pg_temp.rk('e1') ->> 'revision')::int = 1 and not (pg_temp.rk('e1') ->> 'sin_cambios')::boolean
    and exists (select 1 from public.proveedores where id = pg_temp.kk('T') and nombre = 'Textiles Delta Limited' and puerto_embarque = 'Shenzhen'
      and revision = 1 and updated_by_id = pg_temp.id(9004) and perfil_id = pg_temp.id(9003))),
  ('editar (RP4): UN evento editar con antes y despues del nombre y del contacto anterior, y el resumen nombra los campos',
    pg_temp.nev(pg_temp.kk('T'), 'editar') = 1
    and exists (select 1 from public.proveedor_eventos where proveedor_id = pg_temp.kk('T') and accion = 'editar'
      and antes ->> 'nombre' = 'Textiles Delta Ltd.' and despues ->> 'nombre' = 'Textiles Delta Limited'
      and antes #>> '{contactos,0,telefono}' = '+86 1' and despues #>> '{contactos,0,telefono}' = '+86 999'
      and resumen like 'Cambios:%nombre: Textiles Delta Ltd. → Textiles Delta Limited%' and resumen like '%puerto_embarque: Ningbo → Shenzhen%'
      and resumen like '%contactos modificados%' and proveedor_nombre = 'Textiles Delta Limited' and perfil_id = pg_temp.id(9004))),
  ('editar: los contactos se reemplazaron (siguen siendo 2, con el telefono nuevo)',
    pg_temp.ncont(pg_temp.kk('T')) = 2
    and exists (select 1 from public.proveedor_contactos where proveedor_id = pg_temp.kk('T') and nombre = 'Ana' and telefono = '+86 999' and es_principal));

-- Revisión vieja (R15): proveedor_cambio, sin escribir nada.
insert into res values
  ('rv', pg_temp.r_gp(pg_temp.kk('T'), 0, '{"nombre":"Cambio Con Revision Vieja"}', '[]', pg_temp.act(9003, 'comprador'))),
  ('rn', pg_temp.r_gp(pg_temp.kk('T'), null, '{"nombre":"Cambio Sin Revision"}', '[]', pg_temp.act(9003, 'comprador'))),
  ('nf', pg_temp.r_gp(gen_random_uuid(), 0, '{"nombre":"No Existe"}', '[]', pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('revision vieja (R15): proveedor_cambio con la revision actual, sin cambiar nada (ficha, contactos, revision ni eventos)',
    pg_temp.mot('rv') = 'proveedor_cambio' and (pg_temp.rk('rv') ->> 'revision')::int = 1
    and exists (select 1 from public.proveedores where id = pg_temp.kk('T') and nombre = 'Textiles Delta Limited' and revision = 1)
    and pg_temp.ncont(pg_temp.kk('T')) = 2 and pg_temp.nev(pg_temp.kk('T')) = 2),
  ('editar sin p_revision tambien es proveedor_cambio; un id que no existe es no_encontrado',
    pg_temp.mot('rn') = 'proveedor_cambio' and pg_temp.mot('nf') = 'no_encontrado');

-- Atomicidad de contactos (R13): un contacto inválido a mitad no deja ni ficha ni contactos cambiados.
insert into res values
  ('at1', pg_temp.r_gp(pg_temp.kk('T'), 1,
    '{"nombre":"Textiles Delta Limited","pais":"Chile","puerto_embarque":"Valparaiso"}',
    '[{"nombre":"Carlos","correo":"carlos@example.invalid"},{"nombre":"   "},{"nombre":"Dora"}]', pg_temp.act(9003, 'comprador'))),
  ('at2', pg_temp.r_gp(pg_temp.kk('T'), 1,
    '{"nombre":"Textiles Delta Limited","pais":"Chile"}',
    '[{"nombre":"Carlos","correo":"sin-arroba"}]', pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('contacto sin nombre a mitad de la lista: la excepcion deshace TODO (not null 23502): pais, puerto, contactos, revision y eventos igual que antes',
    pg_temp.rk('at1') ->> 'error' = '23502'
    and exists (select 1 from public.proveedores where id = pg_temp.kk('T') and pais = 'China' and puerto_embarque = 'Shenzhen' and revision = 1)
    and pg_temp.ncont(pg_temp.kk('T')) = 2 and exists (select 1 from public.proveedor_contactos where proveedor_id = pg_temp.kk('T') and nombre = 'Ana')
    and pg_temp.nev(pg_temp.kk('T')) = 2),
  ('correo mal formado: el check lo rechaza (23514) y no queda nada cambiado',
    pg_temp.rk('at2') ->> 'error' = '23514'
    and exists (select 1 from public.proveedores where id = pg_temp.kk('T') and pais = 'China' and revision = 1) and pg_temp.ncont(pg_temp.kk('T')) = 2);

-- Contactos: más de 20, más de un principal, no arreglo; el primero principal; NULL conserva; [] quita todos.
insert into res values
  ('c21', pg_temp.r_gp(pg_temp.kk('T'), 1, '{"nombre":"Textiles Delta Limited"}',
    (select jsonb_agg(jsonb_build_object('nombre', 'C' || g)) from generate_series(1, 21) g), pg_temp.act(9003))),
  ('c2p', pg_temp.r_gp(pg_temp.kk('T'), 1, '{"nombre":"Textiles Delta Limited"}',
    '[{"nombre":"A","es_principal":true},{"nombre":"B","es_principal":true}]', pg_temp.act(9003))),
  ('cna', pg_temp.r_gp(pg_temp.kk('T'), 1, '{"nombre":"Textiles Delta Limited"}', '{"nombre":"A"}', pg_temp.act(9003))),
  ('fin', pg_temp.r_gp(pg_temp.kk('T'), 1, '[1,2]', null, pg_temp.act(9003))),
  ('fsn', pg_temp.r_gp(pg_temp.kk('T'), 1, '{"pais":"China"}', null, pg_temp.act(9003)));
insert into r (caso, ok) values
  ('21 contactos, dos principales, contactos que no es arreglo: contactos_invalidos sin escribir',
    pg_temp.mot('c21') = 'contactos_invalidos' and pg_temp.mot('c2p') = 'contactos_invalidos' and pg_temp.mot('cna') = 'contactos_invalidos'
    and pg_temp.prev(pg_temp.kk('T')) = 1 and pg_temp.ncont(pg_temp.kk('T')) = 2),
  ('ficha que no es objeto o sin nombre: ficha_invalida',
    pg_temp.mot('fin') = 'ficha_invalida' and pg_temp.mot('fsn') = 'ficha_invalida');
insert into res values
  ('c20', pg_temp.r_gp(pg_temp.kk('T'), 1, '{"nombre":"Textiles Delta Limited","pais":"China"}',
    (select jsonb_agg(jsonb_build_object('nombre', 'C' || g, 'es_principal', g = 3)) from generate_series(1, 20) g), pg_temp.act(9003)));
insert into r (caso, ok) values
  ('exactamente 20 contactos entran; el marcado principal es el unico principal',
    pg_temp.good('c20') and pg_temp.ncont(pg_temp.kk('T')) = 20
    and (select count(*) from public.proveedor_contactos where proveedor_id = pg_temp.kk('T') and es_principal and nombre = 'C3') = 1);
insert into res values
  ('cnull', pg_temp.r_gp(pg_temp.kk('T'), 2, '{"nombre":"Textiles Delta Limited","pais":"China","moneda":"PEN"}', null, pg_temp.act(9003)));
insert into r (caso, ok) values
  ('p_contactos NULL en una edicion conserva los contactos (y el resto de la ficha se reemplaza: lo ausente queda nulo)',
    pg_temp.good('cnull') and pg_temp.ncont(pg_temp.kk('T')) = 20
    and exists (select 1 from public.proveedores where id = pg_temp.kk('T') and moneda = 'PEN' and puerto_embarque is null and ciudad is null and revision = 3));
insert into res values
  ('cvac', pg_temp.r_gp(pg_temp.kk('T'), 3, '{"nombre":"Textiles Delta Limited","pais":"China","moneda":"PEN"}', '[]', pg_temp.act(9003)));
insert into r (caso, ok) values
  ('[] quita todos los contactos',
    pg_temp.good('cvac') and pg_temp.ncont(pg_temp.kk('T')) = 0);

-- Renombrar a un nombre que ya existe en la edición: nombre_repetido (y nada cambia).
insert into res values
  ('rep', pg_temp.r_gp(pg_temp.kk('T'), 4, '{"nombre":"HUMO NORTE","pais":"China"}', null, pg_temp.act(9003)));
insert into r (caso, ok) values
  ('editar a un nombre ya usado por otro: nombre_repetido con el conflicto, sin cambiar nada',
    pg_temp.mot('rep') = 'nombre_repetido' and (pg_temp.rk('rep') #>> '{conflicto,id}')::uuid = pg_temp.kk('PA')
    and pg_temp.prev(pg_temp.kk('T')) = 4 and exists (select 1 from public.proveedores where id = pg_temp.kk('T') and nombre = 'Textiles Delta Limited'));

-- Intercompany: un comprador no lo marca ni lo cambia; el planner sí.
insert into res values
  ('ic1', pg_temp.r_gp(null, null, '{"nombre":"Marca Hermana H39","es_intercompany":true}', null, pg_temp.act(9003, 'comprador'))),
  ('ic2', pg_temp.r_gp(pg_temp.kk('T'), 4, '{"nombre":"Textiles Delta Limited","pais":"China","moneda":"PEN","es_intercompany":true}', null, pg_temp.act(9003, 'comprador'))),
  ('ic3', pg_temp.r_gp(null, null, '{"nombre":"Marca Hermana H39","es_intercompany":true}', null, pg_temp.act(9002, 'planner')));
insert into r (caso, ok) values
  ('un comprador no crea ni edita es_intercompany (solo_planner_intercompany), sin escribir; el planner si',
    pg_temp.mot('ic1') = 'solo_planner_intercompany' and pg_temp.mot('ic2') = 'solo_planner_intercompany'
    and not exists (select 1 from public.proveedores where nombre = 'Marca Hermana H39' and false)
    and pg_temp.good('ic3') and exists (select 1 from public.proveedores where nombre = 'Marca Hermana H39' and es_intercompany)
    and pg_temp.prev(pg_temp.kk('T')) = 4);

-- Carga desde COTV: clave_origen, ya_cargado, evento importar.
insert into res values
  ('cv1', pg_temp.r_gp(null, null, '{"nombre":"Proveedor De Carga H39","pais":"Perú","clave_origen":"cotv:supplier:humo-1"}',
    '[{"nombre":"Contacto Carga","correo":"carga@example.invalid"}]', '{"nombre":"Carga desde COTV","rol":"admin","origen":"carga_cotv"}'));
insert into k select 'CV', (pg_temp.rk('cv1') ->> 'proveedor_id')::uuid;
insert into res values
  ('cv2', pg_temp.r_gp(null, null, '{"nombre":"Proveedor De Carga H39","pais":"Perú","clave_origen":"cotv:supplier:humo-1"}',
    '[{"nombre":"Contacto Carga"}]', '{"nombre":"Carga desde COTV","rol":"admin","origen":"carga_cotv"}')),
  ('cv3', pg_temp.r_gp(null, null, '{"nombre":"Nombre Distinto Mismo Origen H39","clave_origen":"cotv:supplier:humo-1"}', null,
    '{"nombre":"Carga desde COTV","rol":"admin","origen":"carga_cotv"}'));
insert into r (caso, ok) values
  ('carga: crea con clave_origen y el evento es importar con el resumen Carga desde COTV y el actor sin perfil',
    pg_temp.good('cv1') and pg_temp.rk('cv1') ->> 'accion' = 'importar'
    and exists (select 1 from public.proveedores where id = pg_temp.kk('CV') and clave_origen = 'cotv:supplier:humo-1' and perfil_id is null and usuario_nombre = 'Carga desde COTV')
    and pg_temp.nev(pg_temp.kk('CV')) = 1
    and exists (select 1 from public.proveedor_eventos where proveedor_id = pg_temp.kk('CV') and accion = 'importar' and resumen = 'Carga desde COTV' and perfil_id is null and usuario_nombre = 'Carga desde COTV')
    and pg_temp.ncont(pg_temp.kk('CV')) = 1),
  ('segunda pasada: ya_cargado con el proveedor_id del primero, aunque cambie el nombre; no crea ficha, contactos ni evento',
    pg_temp.mot('cv2') = 'ya_cargado' and (pg_temp.rk('cv2') ->> 'proveedor_id')::uuid = pg_temp.kk('CV')
    and pg_temp.mot('cv3') = 'ya_cargado' and (pg_temp.rk('cv3') ->> 'proveedor_id')::uuid = pg_temp.kk('CV')
    and (select count(*) from public.proveedores where clave_origen like 'cotv:supplier:%') = 1
    and pg_temp.nev(pg_temp.kk('CV')) = 1 and pg_temp.ncont(pg_temp.kk('CV')) = 1),
  ('un proveedor cargado desde COTV tiene exactamente UN evento importar (por proveedor cargado)',
    (select count(*) from public.proveedor_eventos where accion = 'importar') = 1),
  ('el indice unico de clave_origen impide dos proveedores con la misma clave aunque se escriba a mano (23505)',
    pg_temp.estado($q$insert into public.proveedores (nombre, clave_origen) values ('Otra Ficha H39', 'cotv:supplier:humo-1')$q$) = '23505'
    and pg_temp.estado($q$insert into public.proveedores (nombre, clave_origen) values ('Sin Clave H39 1', null), ('Sin Clave H39 2', null)$q$) = 'ok');

-- clave_origen en una edición no cuenta (solo al crear): no cambia la clave guardada.
insert into res values
  ('ce', pg_temp.r_gp(pg_temp.kk('CV'), 0, '{"nombre":"Proveedor De Carga H39","pais":"Perú","clave_origen":"cotv:supplier:otra","direccion":"Av. 1"}', null, pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('editar un proveedor cargado: la clave_origen del cuerpo se ignora y queda la original',
    pg_temp.good('ce') and exists (select 1 from public.proveedores where id = pg_temp.kk('CV') and clave_origen = 'cotv:supplier:humo-1' and direccion = 'Av. 1' and revision = 1)
    and pg_temp.nev(pg_temp.kk('CV'), 'editar') = 1);

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. cambiar_activo_proveedor y eliminar_proveedor
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('d1', pg_temp.r_ca(pg_temp.kk('T'), false, pg_temp.act(9002, 'planner'))),
  ('d2', pg_temp.r_ca(pg_temp.kk('T'), false, pg_temp.act(9002, 'planner')));
insert into r (caso, ok) values
  ('desactivar: ok, activo false, revision +1 y un evento desactivar con antes y despues',
    pg_temp.good('d1') and exists (select 1 from public.proveedores where id = pg_temp.kk('T') and not activo and revision = 5 and updated_by_id = pg_temp.id(9002))
    and exists (select 1 from public.proveedor_eventos where proveedor_id = pg_temp.kk('T') and accion = 'desactivar' and (antes ->> 'activo')::boolean and not (despues ->> 'activo')::boolean)),
  ('desactivar de nuevo: sin_cambios, sin evento ni revision',
    pg_temp.good('d2') and (pg_temp.rk('d2') ->> 'sin_cambios')::boolean and pg_temp.prev(pg_temp.kk('T')) = 5 and pg_temp.nev(pg_temp.kk('T'), 'desactivar') = 1);
insert into res values
  ('inact', pg_temp.r_gp(null, null, '{"nombre":"textiles delta limited"}', null, pg_temp.act(9003, 'comprador'))),
  ('r1', pg_temp.r_ca(pg_temp.kk('T'), true, pg_temp.act(9002, 'planner'))),
  ('r2', pg_temp.r_ca(gen_random_uuid(), true, pg_temp.act(9002, 'planner'))),
  ('r3', pg_temp.r_ca(pg_temp.kk('T'), null, pg_temp.act(9002, 'planner')));
insert into r (caso, ok) values
  ('el repetido INACTIVO se avisa con conflicto.activo = false (el mensaje pide reactivarlo)',
    pg_temp.mot('inact') = 'nombre_repetido' and not (pg_temp.rk('inact') #>> '{conflicto,activo}')::boolean),
  ('reactivar: ok, evento reactivar; un id inexistente es no_encontrado; activo nulo es activo_invalido',
    pg_temp.good('r1') and pg_temp.nev(pg_temp.kk('T'), 'reactivar') = 1 and pg_temp.mot('r2') = 'no_encontrado' and pg_temp.mot('r3') = 'activo_invalido'
    and exists (select 1 from public.proveedores where id = pg_temp.kk('T') and activo and revision = 6));

-- Eliminar sin compras: se borra, con sus contactos, y conserva sus eventos con proveedor_id nulo (RP4).
insert into res values ('x1', pg_temp.r_gp(null, null, '{"nombre":"Se Elimina H39","pais":"Perú"}', '[{"nombre":"Contacto X"}]', pg_temp.act(9003, 'comprador')));
insert into k select 'X', (pg_temp.rk('x1') ->> 'proveedor_id')::uuid;
insert into res values ('x2', pg_temp.r_gp(pg_temp.kk('X'), 0, '{"nombre":"Se Elimina H39","pais":"Chile"}', null, pg_temp.act(9003, 'comprador')));
create temp table x_antes as select count(*) as n from public.proveedor_eventos where proveedor_id = pg_temp.kk('X');
insert into res values ('x3', pg_temp.r_ep(pg_temp.kk('X'), pg_temp.act(9002, 'planner')));
insert into res values ('x3b', pg_temp.r_ep(pg_temp.kk('X'), pg_temp.act(9002, 'planner')));
insert into r (caso, ok) values
  ('eliminar sin compras: accion borrado, el proveedor y sus contactos desaparecen',
    pg_temp.good('x3') and pg_temp.rk('x3') ->> 'accion' = 'borrado'
    and not exists (select 1 from public.proveedores where id = pg_temp.kk('X')) and pg_temp.ncont(pg_temp.kk('X')) = 0),
  ('eliminar sin compras (RP4): sus 3 eventos (crear, editar, eliminar) quedan con proveedor_id NULL y el nombre copiado; el eliminar trae el antes',
    (select n from x_antes) = 2
    and (select count(*) from public.proveedor_eventos where proveedor_nombre = 'Se Elimina H39' and proveedor_id is null) = 3
    and exists (select 1 from public.proveedor_eventos where proveedor_nombre = 'Se Elimina H39' and accion = 'eliminar' and antes ->> 'pais' = 'Chile' and despues is null
      and resumen = 'Proveedor eliminado: Se Elimina H39' and perfil_id = pg_temp.id(9002))),
  ('eliminar de nuevo un proveedor ya eliminado: no_encontrado',
    pg_temp.mot('x3b') = 'no_encontrado');

-- Eliminar con compras (PA tiene compras de todos los estados): se desactiva.
insert into res values ('x4', pg_temp.r_ep(pg_temp.kk('PA'), pg_temp.act(9002, 'planner')));
insert into res values ('x5', pg_temp.r_ep(pg_temp.kk('PA'), pg_temp.act(9002, 'planner')));
insert into r (caso, ok) values
  ('eliminar con compras: accion desactivado (el proveedor y sus compras siguen ahi) con un evento desactivar',
    pg_temp.good('x4') and pg_temp.rk('x4') ->> 'accion' = 'desactivado'
    and exists (select 1 from public.proveedores where id = pg_temp.kk('PA') and not activo)
    and exists (select 1 from public.proveedor_eventos where proveedor_id = pg_temp.kk('PA') and accion = 'desactivar' and resumen like 'Tenía compras%')
    and (select count(*) from public.compras where proveedor_id = pg_temp.kk('PA')) = 6),
  ('eliminar con compras otra vez (ya inactivo): sigue en desactivado y no duplica el evento',
    pg_temp.rk('x5') ->> 'accion' = 'desactivado' and pg_temp.nev(pg_temp.kk('PA'), 'desactivar') = 1);
-- Se reactiva para las pruebas de fotos (no importa el estado del proveedor).
insert into res values ('x6', pg_temp.r_ca(pg_temp.kk('PA'), true, pg_temp.act(9002, 'planner')));

-- Borrar un perfil deja sus eventos con perfil_id nulo (la FK set null sigue funcionando; 9004 edito a T).
delete from public.perfiles where id = pg_temp.id(9004);
insert into r (caso, ok) values
  ('borrar un perfil: sus eventos de proveedor quedan con perfil_id nulo y usuario_nombre intacto (la unica modificacion que admite el trigger)',
    not exists (select 1 from public.proveedor_eventos where perfil_id = pg_temp.id(9004))
    and exists (select 1 from public.proveedor_eventos where accion = 'editar' and proveedor_id = pg_temp.kk('T') and perfil_id is null and usuario_nombre = 'Humo 39 9004'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Fotos: agregar_foto_linea
-- ---------------------------------------------------------------------------------------------------------------------
create temp table base2 as
  select (select revision from public.compras where id = pg_temp.id(1001)) as rev1,
         (select count(*) from public.compra_eventos) as eventos,
         public.flujo_huella_base()::text as huella;

insert into res values
  ('f1', pg_temp.r_af(pg_temp.id(1001), pg_temp.id(2001), pg_temp.foto(3001), pg_temp.act(9003, 'comprador'))),
  ('f2', pg_temp.r_af(pg_temp.id(1001), pg_temp.id(2001), pg_temp.foto(3002), pg_temp.act(9003, 'comprador'))),
  ('f3', pg_temp.r_af(pg_temp.id(1001), pg_temp.id(2001), pg_temp.foto(3003), pg_temp.act(9001, 'admin'))),
  ('f4', pg_temp.r_af(pg_temp.id(1001), pg_temp.id(2001), pg_temp.foto(3004), pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('agregar: ok, devuelve las rutas armadas con ids, la cuenta de activas y la foto',
    pg_temp.good('f1') and pg_temp.rk('f1') ->> 'ruta' = pg_temp.ruta(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3001))
    and pg_temp.rk('f1') ->> 'ruta_miniatura' = pg_temp.ruta(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3001), true)
    and (pg_temp.rk('f1') ->> 'activas')::int = 1 and (pg_temp.rk('f1') #>> '{foto,ancho}')::int = 800
    and (pg_temp.rk('f1') #>> '{foto,subida_por_id}')::uuid = pg_temp.id(9003)),
  ('agregar: la fila queda con compra_id de la linea, quien la subio, activa y sin quitada_*, con las mismas rutas',
    exists (select 1 from public.compra_linea_fotos where id = pg_temp.id(3001) and linea_id = pg_temp.id(2001) and compra_id = pg_temp.id(1001)
      and activo and quitada_at is null and quitada_por_id is null and subida_por_id = pg_temp.id(9003) and subida_por_nombre = 'Humo 39 9003'
      and ruta = pg_temp.ruta(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3001)) and origen_foto_id is null and clave_origen is null)),
  ('R4: la tercera entra y la CUARTA da max_fotos sin escribir (3 activas, no 4)',
    pg_temp.good('f2') and pg_temp.good('f3') and pg_temp.mot('f4') = 'max_fotos' and pg_temp.nact(pg_temp.id(2001)) = 3
    and not exists (select 1 from public.compra_linea_fotos where id = pg_temp.id(3004))),
  ('R7: subir 3 fotos NO cambia compras.revision, compra_eventos ni flujo_huella_base()',
    pg_temp.crev(pg_temp.id(1001)) = (select rev1 from base2) and (select count(*) from public.compra_eventos) = (select eventos from base2)
    and public.flujo_huella_base()::text = (select huella from base2));

-- Cinco llamadas seguidas sobre otra línea: exactamente 3 entran (la concurrencia real la prueba el test de integración).
insert into res
select 'seq' || g, pg_temp.r_af(pg_temp.id(1001), pg_temp.id(2002), pg_temp.foto(3100 + g), pg_temp.act(9003, 'comprador'))
from generate_series(1, 5) g;
insert into r (caso, ok) values
  ('5 llamadas seguidas sobre una linea vacia dejan exactamente 3 fotos activas (3 ok y 2 max_fotos)',
    (select count(*) from res where k like 'seq%' and (v ->> 'ok')::boolean) = 3
    and (select count(*) from res where k like 'seq%' and v ->> 'motivo' = 'max_fotos') = 2 and pg_temp.nact(pg_temp.id(2002)) = 3);

-- Validaciones de la foto y de la ruta.
insert into res values
  ('i1', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3201, '{"ancho":801}'), pg_temp.act(9003))),
  ('i2', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3202, '{"bytes":409601}'), pg_temp.act(9003))),
  ('i3', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3203, '{"bytes_miniatura":61441}'), pg_temp.act(9003))),
  ('i4', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3204, '{"alto":0}'), pg_temp.act(9003))),
  ('i5', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), '{"ancho":10,"alto":10,"bytes":10,"bytes_miniatura":10}', pg_temp.act(9003))),
  ('i6', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3206, '{"ancho":"abc"}'), pg_temp.act(9003))),
  ('i7', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), '[1]', pg_temp.act(9003))),
  ('i8', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3208, jsonb_build_object('ruta', 'compras/otra/ruta.jpg')), pg_temp.act(9003))),
  ('i9', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3209, jsonb_build_object('ruta_miniatura', '../../etc/x_min.jpg')), pg_temp.act(9003))),
  ('i10', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3210, jsonb_build_object('clave_origen', repeat('x', 81))), pg_temp.act(9003))),
  ('i11', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3211, jsonb_build_object('ruta', pg_temp.ruta(pg_temp.id(1005), pg_temp.id(2007), pg_temp.id(3211)))), pg_temp.act(9003))),
  ('i12', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3001), pg_temp.act(9003)));
insert into r (caso, ok) values
  ('foto_invalida: ancho 801, 400 KB + 1, miniatura de 60 KB + 1, alto 0, sin id, ancho no numerico, cuerpo que no es objeto',
    pg_temp.mot('i1') = 'foto_invalida' and pg_temp.mot('i2') = 'foto_invalida' and pg_temp.mot('i3') = 'foto_invalida' and pg_temp.mot('i4') = 'foto_invalida'
    and pg_temp.mot('i5') = 'foto_invalida' and pg_temp.mot('i6') = 'foto_invalida' and pg_temp.mot('i7') = 'foto_invalida' and pg_temp.mot('i10') = 'foto_invalida'),
  ('ruta_invalida: una ruta o miniatura que no es la de los ids (incluido un intento de salirse de la carpeta); la ruta correcta si pasa',
    pg_temp.mot('i8') = 'ruta_invalida' and pg_temp.mot('i9') = 'ruta_invalida' and pg_temp.good('i11')),
  ('un id de foto que ya existe (otra linea): no se duplica; sale por la excepcion de la clave primaria o la de la ruta, sin escribir nada',
    pg_temp.rk('i12') ->> 'error' is not null or pg_temp.mot('i12') in ('no_editable', 'max_fotos', 'foto_invalida')),
  ('los rechazos no escribieron fotos nuevas (solo la i11)',
    (select count(*) from public.compra_linea_fotos where linea_id = pg_temp.id(2007)) = 1);

-- Pertenencia, línea inactiva, estados de la compra.
insert into res values
  ('p1', pg_temp.r_af(pg_temp.id(1002), pg_temp.id(2001), pg_temp.foto(3301), pg_temp.act(9003))),
  ('p2', pg_temp.r_af(pg_temp.id(1001), pg_temp.id(9999), pg_temp.foto(3302), pg_temp.act(9003))),
  ('p3', pg_temp.r_af(pg_temp.id(9999), pg_temp.id(2001), pg_temp.foto(3303), pg_temp.act(9003))),
  ('p4', pg_temp.r_af(pg_temp.id(1001), pg_temp.id(2003), pg_temp.foto(3304), pg_temp.act(9003))),
  ('p5', pg_temp.r_af(pg_temp.id(1003), pg_temp.id(2005), pg_temp.foto(3305), pg_temp.act(9003))),
  ('p6', pg_temp.r_af(pg_temp.id(1002), pg_temp.id(2004), pg_temp.foto(3306), pg_temp.act(9003))),
  ('p7', pg_temp.r_af(pg_temp.id(1004), pg_temp.id(2006), pg_temp.foto(3307), pg_temp.act(9003)));
insert into r (caso, ok) values
  ('ids cruzados: una linea de otra compra, una linea o compra inexistentes: no_pertenece, sin escribir',
    pg_temp.mot('p1') = 'no_pertenece' and pg_temp.mot('p2') = 'no_pertenece' and pg_temp.mot('p3') = 'no_pertenece'
    and not exists (select 1 from public.compra_linea_fotos where id in (pg_temp.id(3301), pg_temp.id(3302), pg_temp.id(3303)))),
  ('R6: linea inactiva y compra cancelada: no_editable',
    pg_temp.mot('p4') = 'no_editable' and pg_temp.mot('p5') = 'no_editable'),
  ('R6: una compra en borrador y una recibida SI admiten fotos',
    pg_temp.good('p6') and pg_temp.good('p7'));

-- clave_origen: idempotencia (ya_cargada), global y sin filtrar por activo.
insert into res values
  ('k1', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3401, jsonb_build_object('clave_origen', 'cotv:photo:humo-1')), pg_temp.act(9001, 'admin'))),
  ('k2', pg_temp.r_af(pg_temp.id(1005), pg_temp.id(2007), pg_temp.foto(3402, jsonb_build_object('clave_origen', 'cotv:photo:humo-1')), pg_temp.act(9001, 'admin'))),
  ('k3', pg_temp.r_af(pg_temp.id(1001), pg_temp.id(2002), pg_temp.foto(3403, jsonb_build_object('clave_origen', 'cotv:photo:humo-1')), pg_temp.act(9001, 'admin')));
insert into r (caso, ok) values
  ('clave_origen: la primera entra; la segunda (misma linea) y la tercera (otra linea, aunque llena) dan ya_cargada con el foto_id de la primera y sin escribir',
    pg_temp.good('k1') and pg_temp.mot('k2') = 'ya_cargada' and pg_temp.mot('k3') = 'ya_cargada'
    and (pg_temp.rk('k2') ->> 'foto_id')::uuid = pg_temp.id(3401) and (pg_temp.rk('k3') ->> 'foto_id')::uuid = pg_temp.id(3401)
    and (select count(*) from public.compra_linea_fotos where clave_origen = 'cotv:photo:humo-1') = 1
    and not exists (select 1 from public.compra_linea_fotos where id in (pg_temp.id(3402), pg_temp.id(3403)))),
  ('el indice unico de clave_origen de fotos no mira activo: tampoco entra a mano una repetida (23505)',
    pg_temp.estado($q$insert into public.compra_linea_fotos (id, linea_id, compra_id, ruta, ruta_miniatura, ancho, alto, bytes, bytes_miniatura, clave_origen, activo, quitada_at)
      select pg_temp.id(3410), pg_temp.id(2007), pg_temp.id(1005),
             pg_temp.ruta(pg_temp.id(1005), pg_temp.id(2007), pg_temp.id(3410)), pg_temp.ruta(pg_temp.id(1005), pg_temp.id(2007), pg_temp.id(3410), true),
             1, 1, 1, 1, 'cotv:photo:humo-1', false, now()$q$) = '23505');

-- Los checks de la tabla (defensa en profundidad, por si alguien inserta a mano).
insert into r (caso, ok) values
  ('compra_linea_fotos: el check exige la ruta con los ids de la fila (23514 con otra ruta) y activo o quitada_at',
    pg_temp.estado($q$insert into public.compra_linea_fotos (id, linea_id, compra_id, ruta, ruta_miniatura, ancho, alto, bytes, bytes_miniatura)
      values (pg_temp.id(3420), pg_temp.id(2007), pg_temp.id(1005), 'compras/x.jpg', pg_temp.ruta(pg_temp.id(1005), pg_temp.id(2007), pg_temp.id(3420), true), 1, 1, 1, 1)$q$) = '23514'
    and pg_temp.estado($q$insert into public.compra_linea_fotos (id, linea_id, compra_id, ruta, ruta_miniatura, ancho, alto, bytes, bytes_miniatura, activo)
      values (pg_temp.id(3421), pg_temp.id(2007), pg_temp.id(1005), pg_temp.ruta(pg_temp.id(1005), pg_temp.id(2007), pg_temp.id(3421)), pg_temp.ruta(pg_temp.id(1005), pg_temp.id(2007), pg_temp.id(3421), true), 1, 1, 1, 1, false)$q$) = '23514'),
  ('compra_linea_fotos: una linea con fotos no se puede borrar (restrict) y una foto con copias tampoco',
    pg_temp.estado($q$delete from public.compra_lineas where id = pg_temp.id(2001)$q$) in ('23503', '23001')
    and pg_temp.estado($q$delete from public.compra_linea_fotos where id = pg_temp.id(3001)$q$, 'service_role') = '42501');

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. quitar_foto_linea
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('q1', pg_temp.r_qf(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3001), pg_temp.act(9003, 'comprador'))),
  ('q2', pg_temp.r_qf(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3001), pg_temp.act(9003, 'comprador'))),
  ('q3', pg_temp.r_qf(pg_temp.id(1001), pg_temp.id(2002), pg_temp.id(3002), pg_temp.act(9003, 'comprador'))),
  ('q4', pg_temp.r_qf(pg_temp.id(1005), pg_temp.id(2001), pg_temp.id(3002), pg_temp.act(9003, 'comprador'))),
  ('q5', pg_temp.r_qf(pg_temp.id(1001), pg_temp.id(2001), gen_random_uuid(), pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('R5 quitar: ok, activo false, quitada_at y quitada_por*, devuelve las dos rutas y la cuenta de activas',
    pg_temp.good('q1') and pg_temp.rk('q1') ->> 'ruta' = pg_temp.ruta(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3001))
    and pg_temp.rk('q1') ->> 'ruta_miniatura' = pg_temp.ruta(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3001), true) and (pg_temp.rk('q1') ->> 'activas')::int = 2
    and exists (select 1 from public.compra_linea_fotos where id = pg_temp.id(3001) and not activo and quitada_at is not null
      and quitada_por_id = pg_temp.id(9003) and quitada_por_nombre = 'Humo 39 9003')),
  ('R5 quitar dos veces: ya_quitada, sin cambiar nada',
    pg_temp.mot('q2') = 'ya_quitada'),
  ('R5 ids cruzados: una foto de otra linea (q3), de otra compra (q4) o inexistente (q5): no_pertenece',
    pg_temp.mot('q3') = 'no_pertenece' and pg_temp.mot('q4') = 'no_pertenece' and pg_temp.mot('q5') = 'no_pertenece'
    and exists (select 1 from public.compra_linea_fotos where id = pg_temp.id(3002) and activo)),
  ('quitar libera un cupo: ya se puede agregar otra (la linea tenia 3, ahora 2)',
    (select (v ->> 'ok')::boolean from (select pg_temp.r_af(pg_temp.id(1001), pg_temp.id(2001), pg_temp.foto(3011), pg_temp.act(9003, 'comprador')) as v) x)
    and pg_temp.nact(pg_temp.id(2001)) = 3);

-- Compra cancelada: se siembra una foto en C3 (cuando estaba viva) y se cancela la compra.
update public.compras set estado = 'confirmada', cancelada_at = null where id = pg_temp.id(1003);
insert into res values
  ('c3a', pg_temp.r_af(pg_temp.id(1003), pg_temp.id(2005), pg_temp.foto(3501), pg_temp.act(9003, 'comprador'))),
  ('c3b', pg_temp.r_af(pg_temp.id(1003), pg_temp.id(2005), pg_temp.foto(3502), pg_temp.act(9003, 'comprador')));
update public.compras set estado = 'cancelada', cancelada_at = now() where id = pg_temp.id(1003);
insert into res values
  ('qc1', pg_temp.r_qf(pg_temp.id(1003), pg_temp.id(2005), pg_temp.id(3501), pg_temp.act(9003, 'comprador'))),
  ('qc2', pg_temp.r_qf(pg_temp.id(1003), pg_temp.id(2005), pg_temp.id(3501), pg_temp.act(9002, 'planner'))),
  ('qc3', pg_temp.r_qf(pg_temp.id(1003), pg_temp.id(2005), pg_temp.id(3501), '{"nombre":"sin rol"}')),
  ('qc4', pg_temp.r_qf(pg_temp.id(1003), pg_temp.id(2005), pg_temp.id(3501), pg_temp.act(9001, 'admin')));
insert into r (caso, ok) values
  ('R6 compra cancelada: comprador, planner y un actor sin rol no quitan (no_editable); el admin si',
    pg_temp.mot('qc1') = 'no_editable' and pg_temp.mot('qc2') = 'no_editable' and pg_temp.mot('qc3') = 'no_editable' and pg_temp.good('qc4')
    and exists (select 1 from public.compra_linea_fotos where id = pg_temp.id(3501) and not activo and quitada_por_id = pg_temp.id(9001))
    and exists (select 1 from public.compra_linea_fotos where id = pg_temp.id(3502) and activo)),
  ('R6 compra cancelada: tampoco se agrega foto ni se edita la ficha (no_editable)',
    (select v ->> 'motivo' from (select pg_temp.r_af(pg_temp.id(1003), pg_temp.id(2005), pg_temp.foto(3503), pg_temp.act(9001, 'admin')) as v) x) = 'no_editable');

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. traer_fotos_linea (decisión 104)
-- ---------------------------------------------------------------------------------------------------------------------
-- Origen: L5 (compra C3 cancelada, clave PA|H39-3|1) con la foto 3502 activa (la 3501 se quitó). Se le agrega una más, antigua, para
-- ordenar: la 3502 es del instante anterior. Destino: L8 (compra C6 viva, misma clave y proveedor).
update public.compras set estado = 'confirmada', cancelada_at = null where id = pg_temp.id(1003);
insert into res values ('o3', pg_temp.r_af(pg_temp.id(1003), pg_temp.id(2005), pg_temp.foto(3503), pg_temp.act(9003, 'comprador')));
insert into res values ('o4', pg_temp.r_af(pg_temp.id(1003), pg_temp.id(2005), pg_temp.foto(3504), pg_temp.act(9003, 'comprador')));
update public.compras set estado = 'cancelada', cancelada_at = now() where id = pg_temp.id(1003);
-- Origen activo: 3502, 3503, 3504 (3 fotos). Destino: sin fotos.
create temp table orig as
  select jsonb_agg(jsonb_build_object('id', pg_temp.id(3600 + n), 'origen_foto_id', pg_temp.id(3500 + n)) order by n) as fotos
  from (values (2), (3), (4)) v(n);
-- Otro juego de copias (ids sin usar) para los intentos que se rechazan.
create temp table orig2 as
  select jsonb_agg(jsonb_build_object('id', pg_temp.id(3950 + n), 'origen_foto_id', pg_temp.id(3500 + n)) order by n) as fotos
  from (values (2), (3), (4)) v(n);
insert into res values
  ('t1', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(2005), (select fotos from orig), pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('RP5 traer: ok, trae las 3 activas del origen (copias con sus rutas nuevas y el vinculo origen_foto_id), saltadas 0, descartadas vacio',
    pg_temp.good('t1') and jsonb_array_length(pg_temp.rk('t1') -> 'traidas') = 3 and (pg_temp.rk('t1') ->> 'saltadas')::int = 0
    and jsonb_array_length(pg_temp.rk('t1') -> 'descartadas') = 0 and (pg_temp.rk('t1') ->> 'activas')::int = 3
    and pg_temp.nact(pg_temp.id(2008)) = 3
    and (select count(*) from public.compra_linea_fotos where linea_id = pg_temp.id(2008) and origen_foto_id in (pg_temp.id(3502), pg_temp.id(3503), pg_temp.id(3504))) = 3
    and exists (select 1 from public.compra_linea_fotos where id = pg_temp.id(3602) and linea_id = pg_temp.id(2008) and compra_id = pg_temp.id(1006)
      and ruta = pg_temp.ruta(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(3602)) and clave_origen is null and subida_por_id = pg_temp.id(9003))),
  ('RP5 traer: el orden del origen se conserva (la principal del destino es la copia de la mas antigua) y las dimensiones salen del origen',
    (select id from public.compra_linea_fotos where linea_id = pg_temp.id(2008) and activo order by created_at, id limit 1) = pg_temp.id(3602)
    and (select count(*) from public.compra_linea_fotos d join public.compra_linea_fotos o on o.id = d.origen_foto_id
         where d.linea_id = pg_temp.id(2008) and d.ancho = o.ancho and d.alto = o.alto and d.bytes = o.bytes and d.bytes_miniatura = o.bytes_miniatura) = 3),
  ('RP5 traer: el origen queda intacto (3 activas y sin cambios en sus filas)',
    pg_temp.nact(pg_temp.id(2005)) = 3 and (select count(*) from public.compra_linea_fotos where linea_id = pg_temp.id(2005) and activo and origen_foto_id is null) = 3),
  ('RP5 traer no toca compras.revision ni compra_eventos',
    pg_temp.crev(pg_temp.id(1006)) = 0 and pg_temp.ncev(pg_temp.id(1006)) = 0);

-- Traer otra vez: la segunda trae 0 y avisa de las saltadas; la línea ya está llena (3) pero eso no es max_fotos porque no hay nuevas.
insert into res values
  ('t2', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(2005),
    (select jsonb_agg(jsonb_build_object('id', pg_temp.id(3700 + n), 'origen_foto_id', pg_temp.id(3500 + n)) order by n) from (values (2), (3), (4)) v(n)),
    pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('RP5 traer dos veces no duplica: la segunda trae 0, saltadas 3 y descarta las 3 copias nuevas (la API las borra)',
    pg_temp.good('t2') and jsonb_array_length(pg_temp.rk('t2') -> 'traidas') = 0 and (pg_temp.rk('t2') ->> 'saltadas')::int = 3
    and jsonb_array_length(pg_temp.rk('t2') -> 'descartadas') = 3 and pg_temp.nact(pg_temp.id(2008)) = 3
    and not exists (select 1 from public.compra_linea_fotos where id in (pg_temp.id(3702), pg_temp.id(3703), pg_temp.id(3704))));

-- Cupo: el destino L9 (sin clave) da sin_origen; un destino con 2 fotos propias solo recibe 1 (la mas antigua del origen).
insert into res values
  ('t3', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2009), pg_temp.id(2005), (select fotos from orig2), pg_temp.act(9003, 'comprador'))),
  ('t4', pg_temp.r_tf(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(2005), (select fotos from orig2), pg_temp.act(9003, 'comprador'))),
  ('t5', pg_temp.r_tf(pg_temp.id(1007), pg_temp.id(2010), pg_temp.id(2005), (select fotos from orig2), pg_temp.act(9003, 'comprador'))),
  ('t6', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(2008), (select fotos from orig2), pg_temp.act(9003, 'comprador'))),
  ('t7', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(2005), '[]', pg_temp.act(9003, 'comprador'))),
  ('t8', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(2005),
    '[{"id":"00000000-0000-4000-8000-000000009991","origen_foto_id":"00000000-0000-4000-8000-000000003502"},{"id":"00000000-0000-4000-8000-000000009991","origen_foto_id":"00000000-0000-4000-8000-000000003503"}]',
    pg_temp.act(9003, 'comprador'))),
  ('t9', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(2005),
    '[{"id":"00000000-0000-4000-8000-000000003001","origen_foto_id":"00000000-0000-4000-8000-000000003502"}]', pg_temp.act(9003, 'comprador'))),
  ('t10', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(2005),
    '[{"id":"00000000-0000-4000-8000-000000009992","origen_foto_id":"00000000-0000-4000-8000-000000003001"}]', pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('traer sin origen valido: destino sin clave (t3), origen en compra viva (t4), otro proveedor (t5), el mismo destino como origen (t6) y una foto que no es del origen (t10): sin_origen',
    pg_temp.mot('t3') = 'sin_origen' and pg_temp.mot('t4') = 'sin_origen' and pg_temp.mot('t5') = 'sin_origen' and pg_temp.mot('t6') = 'sin_origen' and pg_temp.mot('t10') = 'sin_origen'
    and pg_temp.nact(pg_temp.id(2009)) = 0),
  ('traer con lista vacia, ids repetidos o un id de copia que ya existe: foto_invalida',
    pg_temp.mot('t7') = 'foto_invalida' and pg_temp.mot('t8') = 'foto_invalida' and pg_temp.mot('t9') = 'foto_invalida');

-- Cupo: se quita una copia del destino (queda con 2) y una propia llena el cupo: no entra nada nuevo salvo lo que quepa.
insert into res values ('qt', pg_temp.r_qf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(3604), pg_temp.act(9003, 'comprador')));
insert into res values
  ('t11', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2008), pg_temp.id(2005),
    '[{"id":"00000000-0000-4000-8000-000000003802","origen_foto_id":"00000000-0000-4000-8000-000000003502"},{"id":"00000000-0000-4000-8000-000000003803","origen_foto_id":"00000000-0000-4000-8000-000000003503"},{"id":"00000000-0000-4000-8000-000000003804","origen_foto_id":"00000000-0000-4000-8000-000000003504"}]',
    pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('traer cuando una copia fue quitada: se vuelve a traer SOLO esa (las otras se saltan), quedan 3 activas y descarta las copias sobrantes',
    pg_temp.good('qt') and pg_temp.good('t11') and jsonb_array_length(pg_temp.rk('t11') -> 'traidas') = 1 and (pg_temp.rk('t11') ->> 'saltadas')::int = 2
    and pg_temp.rk('t11') #>> '{traidas,0,origen_foto_id}' = pg_temp.id(3504)::text and pg_temp.nact(pg_temp.id(2008)) = 3
    and jsonb_array_length(pg_temp.rk('t11') -> 'descartadas') = 2);

-- Cupo parcial y max_fotos: un destino sin vinculos con 2 propias recibe solo 1; con 3 propias, max_fotos.
update public.compras set estado = 'confirmada', cancelada_at = null where id = pg_temp.id(1003);
update public.compra_lineas set clave_importacion = 'PA|H39-3|1' where id = pg_temp.id(2009);
update public.compras set estado = 'cancelada', cancelada_at = now() where id = pg_temp.id(1003);
insert into res values
  ('u1', pg_temp.r_af(pg_temp.id(1006), pg_temp.id(2009), pg_temp.foto(3901), pg_temp.act(9003, 'comprador'))),
  ('u2', pg_temp.r_af(pg_temp.id(1006), pg_temp.id(2009), pg_temp.foto(3902), pg_temp.act(9003, 'comprador')));
insert into res values
  ('t12', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2009), pg_temp.id(2005),
    '[{"id":"00000000-0000-4000-8000-000000003812","origen_foto_id":"00000000-0000-4000-8000-000000003502"},{"id":"00000000-0000-4000-8000-000000003813","origen_foto_id":"00000000-0000-4000-8000-000000003503"},{"id":"00000000-0000-4000-8000-000000003814","origen_foto_id":"00000000-0000-4000-8000-000000003504"}]',
    pg_temp.act(9003, 'comprador')));
insert into res values
  ('t13', pg_temp.r_tf(pg_temp.id(1006), pg_temp.id(2009), pg_temp.id(2005),
    '[{"id":"00000000-0000-4000-8000-000000003822","origen_foto_id":"00000000-0000-4000-8000-000000003504"}]', pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('cupo parcial: con 2 fotos propias solo entra 1 de 3 (la mas antigua del origen) y las otras 2 copias se descartan',
    pg_temp.good('t12') and jsonb_array_length(pg_temp.rk('t12') -> 'traidas') = 1 and pg_temp.rk('t12') #>> '{traidas,0,origen_foto_id}' = pg_temp.id(3502)::text
    and jsonb_array_length(pg_temp.rk('t12') -> 'descartadas') = 2 and pg_temp.nact(pg_temp.id(2009)) = 3),
  ('linea llena y una foto nueva por traer: max_fotos, sin escribir',
    pg_temp.mot('t13') = 'max_fotos' and pg_temp.nact(pg_temp.id(2009)) = 3 and not exists (select 1 from public.compra_linea_fotos where id = pg_temp.id(3822)));

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. editar_ficha_linea (decisión 88)
-- ---------------------------------------------------------------------------------------------------------------------
create temp table base3 as
  select pg_temp.crev(pg_temp.id(1001)) as rev1, (select count(*) from public.compra_eventos) as eventos, public.flujo_huella_base()::text as huella;
insert into res values
  ('e1f', pg_temp.r_ef(pg_temp.id(1001), pg_temp.id(2001), '{"descripcion":null,"modelo":null}', '  Jean slim azul medio ', 'DL-2231', pg_temp.act(9003, 'comprador'))),
  ('e2f', pg_temp.r_ef(pg_temp.id(1001), pg_temp.id(2001), '{"descripcion":null,"modelo":null}', 'Otra descripcion', null, pg_temp.act(9003, 'comprador'))),
  ('e3f', pg_temp.r_ef(pg_temp.id(1001), pg_temp.id(2001), '{"descripcion":"Jean slim azul medio","modelo":"DL-2231"}', 'Jean slim azul medio', 'DL-2231', pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('editar ficha: ok; guarda descripcion recortada y modelo, sin_cambios false',
    pg_temp.good('e1f') and exists (select 1 from public.compra_lineas where id = pg_temp.id(2001) and descripcion = 'Jean slim azul medio' and modelo = 'DL-2231')
    and not (pg_temp.rk('e1f') ->> 'sin_cambios')::boolean and pg_temp.rk('e1f') ->> 'descripcion' = 'Jean slim azul medio'),
  ('R7 editar ficha NO cambia compras.revision y deja UN evento editar_linea de la linea (mueve la huella una vez)',
    pg_temp.crev(pg_temp.id(1001)) = (select rev1 from base3) and (select count(*) from public.compra_eventos) = (select eventos from base3) + 1
    and public.flujo_huella_base()::text <> (select huella from base3)
    and exists (select 1 from public.compra_eventos where compra_id = pg_temp.id(1001) and linea_id = pg_temp.id(2001) and accion = 'editar_linea'
      and antes = '{"descripcion":null,"modelo":null}'::jsonb and despues = '{"descripcion":"Jean slim azul medio","modelo":"DL-2231"}'::jsonb
      and resumen = 'descripción: — → Jean slim azul medio; modelo: — → DL-2231' and perfil_id = pg_temp.id(9003) and usuario_nombre = 'Humo 39 9003')),
  ('R7b editar con antes distinto de lo guardado: linea_cambio con el valor actual y sin escribir',
    pg_temp.mot('e2f') = 'linea_cambio' and pg_temp.rk('e2f') #>> '{actual,descripcion}' = 'Jean slim azul medio' and pg_temp.rk('e2f') #>> '{actual,modelo}' = 'DL-2231'
    and exists (select 1 from public.compra_lineas where id = pg_temp.id(2001) and descripcion = 'Jean slim azul medio')),
  ('editar sin cambios: ok, sin_cambios true y ni evento ni escritura',
    pg_temp.good('e3f') and (pg_temp.rk('e3f') ->> 'sin_cambios')::boolean and (select count(*) from public.compra_eventos) = (select eventos from base3) + 1);

-- R7b: la compra cambió de revision entre medias (otra línea editada, asignada a un viaje, ingreso confirmado): sin 409 falso.
update public.compras set revision = revision + 5 where id = pg_temp.id(1001);
insert into res values
  ('e4f', pg_temp.r_ef(pg_temp.id(1001), pg_temp.id(2001), '{"descripcion":"Jean slim azul medio","modelo":"DL-2231"}', 'Jean slim azul oscuro', 'DL-2231', pg_temp.act(9002, 'planner'))),
  ('e5f', pg_temp.r_ef(pg_temp.id(1001), pg_temp.id(2001), '{"descripcion":"Jean slim azul oscuro","modelo":"DL-2231"}', null, null, pg_temp.act(9003, 'comprador'))),
  ('e6f', pg_temp.r_ef(pg_temp.id(1001), pg_temp.id(2002), '{}', 'Segunda linea', null, pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('R7b con la revision de la compra distinta (subio 5 entre medias): el antes correcto edita igual, sin 409 falso, y la revision queda como estaba',
    pg_temp.good('e4f') and pg_temp.crev(pg_temp.id(1001)) = (select rev1 from base3) + 5
    and exists (select 1 from public.compra_eventos where linea_id = pg_temp.id(2001) and accion = 'editar_linea'
      and despues ->> 'descripcion' = 'Jean slim azul oscuro' and perfil_id = pg_temp.id(9002))),
  ('editar ficha: vaciar descripcion y modelo los deja nulos (resumen con —); el antes vacio de otra linea tambien vale',
    pg_temp.good('e5f') and exists (select 1 from public.compra_lineas where id = pg_temp.id(2001) and descripcion is null and modelo is null)
    and exists (select 1 from public.compra_eventos where linea_id = pg_temp.id(2001) and accion = 'editar_linea' and resumen = 'descripción: Jean slim azul oscuro → —; modelo: DL-2231 → —')
    and pg_temp.good('e6f'));
insert into res values
  ('e7f', pg_temp.r_ef(pg_temp.id(1001), pg_temp.id(2003), '{}', 'Linea inactiva', null, pg_temp.act(9003, 'comprador'))),
  ('e8f', pg_temp.r_ef(pg_temp.id(1003), pg_temp.id(2005), '{}', 'Compra cancelada', null, pg_temp.act(9003, 'comprador'))),
  ('e9f', pg_temp.r_ef(pg_temp.id(1002), pg_temp.id(2001), '{}', 'Linea de otra compra', null, pg_temp.act(9003, 'comprador'))),
  ('e10f', pg_temp.r_ef(pg_temp.id(1001), pg_temp.id(2001), '{}', repeat('x', 201), null, pg_temp.act(9003, 'comprador'))),
  ('e11f', pg_temp.r_ef(pg_temp.id(1002), pg_temp.id(2004), '{}', 'Borrador si', 'B-1', pg_temp.act(9003, 'comprador')));
insert into r (caso, ok) values
  ('editar ficha: linea inactiva y compra cancelada dan no_editable; una linea de otra compra, no_pertenece; un borrador SI se edita',
    pg_temp.mot('e7f') = 'no_editable' and pg_temp.mot('e8f') = 'no_editable' and pg_temp.mot('e9f') = 'no_pertenece' and pg_temp.good('e11f')),
  ('editar ficha: una descripcion de 201 caracteres la frena el check (23514) y no deja nada (ni evento)',
    pg_temp.rk('e10f') ->> 'error' = '23514' and exists (select 1 from public.compra_lineas where id = pg_temp.id(2001) and descripcion is null)
    and not exists (select 1 from public.compra_eventos where resumen like '%xxxxxxxx%'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. fotos_huerfanas (R10)
-- ---------------------------------------------------------------------------------------------------------------------
-- Objetos sembrados (insert directo como el dueño). Antiguos = hace 30 h; recientes = hace 1 h.
--   O_ACT:  objeto de una foto ACTIVA (3011, ruta y miniatura), antiguo      -> nunca
--   O_SIN:  sin fila y antiguo (dos objetos)                                 -> sin_fila
--   O_NEW:  sin fila y reciente (subida en curso)                            -> nunca
--   O_QUI:  foto quitada hace 30 h cuyo objeto sigue (ruta y miniatura)      -> quitadas
--   O_QNEW: foto quitada hace 1 h cuyo objeto sigue                          -> nunca
--   O_QSIN: foto quitada hace 30 h cuyo objeto ya no existe                  -> nunca (no hay objeto)
insert into storage.buckets (id, name, public) values ('otro-bucket', 'otro-bucket', false);
insert into storage.objects (bucket_id, name, created_at) values
  ('compras-fotos', pg_temp.ruta(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3011)), now() - interval '30 hours'),
  ('compras-fotos', pg_temp.ruta(pg_temp.id(1001), pg_temp.id(2001), pg_temp.id(3011), true), now() - interval '30 hours'),
  ('compras-fotos', 'compras/huerfano/uno.jpg', now() - interval '30 hours'),
  ('compras-fotos', 'compras/huerfano/dos_min.jpg', now() - interval '29 hours'),
  ('compras-fotos', 'compras/huerfano/reciente.jpg', now() - interval '1 hour'),
  ('compras-fotos', pg_temp.ruta(pg_temp.id(1003), pg_temp.id(2005), pg_temp.id(3501)), now() - interval '40 hours'),
  ('compras-fotos', pg_temp.ruta(pg_temp.id(1003), pg_temp.id(2005), pg_temp.id(3501), true), now() - interval '40 hours'),
  ('compras-fotos', pg_temp.ruta(pg_temp.id(1001), pg_temp.id(2002), pg_temp.id(3101)), now() - interval '40 hours'),
  ('otro-bucket', 'compras/huerfano/de-otro-bucket.jpg', now() - interval '30 hours');
-- Hay que quitar la foto 3101 (de L2) y dejarla con quitada_at reciente; 3501 ya se quito (por el admin, hace un momento): se envejece.
insert into res values ('qrec', pg_temp.r_qf(pg_temp.id(1001), pg_temp.id(2002), pg_temp.id(3101), pg_temp.act(9003, 'comprador')));
update public.compra_linea_fotos set quitada_at = now() - interval '1 hour' where id = pg_temp.id(3101);
update public.compra_linea_fotos set quitada_at = now() - interval '30 hours' where id = pg_temp.id(3501);
-- Una quitada hace 30 h cuyo objeto no existe (3102 se quita y se envejece, sin objeto).
insert into res values ('qsin', pg_temp.r_qf(pg_temp.id(1001), pg_temp.id(2002), pg_temp.id(3102), pg_temp.act(9003, 'comprador')));
update public.compra_linea_fotos set quitada_at = now() - interval '30 hours' where id = pg_temp.id(3102);

create temp table n_obj as select count(*) as n from storage.objects;
create temp table n_fil as select count(*) as n, md5(string_agg(id::text || activo::text || coalesce(quitada_at::text, ''), ',' order by id)) as h from public.compra_linea_fotos;
insert into res values ('h24', pg_temp.r_fh(24)), ('h0', pg_temp.r_fh(0)), ('h24l', pg_temp.r_fh(24, 2)), ('h24l1', pg_temp.r_fh(24, 1)),
  ('hneg', pg_temp.r_fh(-1)), ('hlim', pg_temp.r_fh(24, 0)), ('hnull', pg_temp.r_fh(null));
insert into r (caso, ok) values
  ('R10 sin_fila (24 h): los tres objetos antiguos sin fila (los dos de aqui y el de la seccion 2; y solo esos), de este bucket',
    (select array_agg(x order by x) from jsonb_array_elements_text(pg_temp.rk('h24') -> 'sin_fila') x)
      = array['compras/huerfano/dos_min.jpg', 'compras/huerfano/uno.jpg', 'compras/humo/visible-solo-al-servicio.jpg']),
  ('R10 quitadas (24 h): ruta y miniatura de la foto quitada hace 30 h cuyo objeto sigue; no la de hace 1 h ni la que ya no tiene objeto',
    (select array_agg(x order by x) from jsonb_array_elements_text(pg_temp.rk('h24') -> 'quitadas') x)
      = array[pg_temp.ruta(pg_temp.id(1003), pg_temp.id(2005), pg_temp.id(3501)), pg_temp.ruta(pg_temp.id(1003), pg_temp.id(2005), pg_temp.id(3501), true)]),
  ('R10 NUNCA devuelve el objeto de una fila activa, ni el sin fila reciente (subida en curso), ni el de otro bucket',
    not (pg_temp.rk('h24')::text like '%' || pg_temp.id(3011)::text || '%') and not (pg_temp.rk('h24')::text like '%reciente.jpg%')
    and not (pg_temp.rk('h24')::text like '%de-otro-bucket%') and not (pg_temp.rk('h24')::text like '%' || pg_temp.id(3101)::text || '%')),
  ('R10 con 0 horas: aparecen tambien el sin fila reciente y la quitada de hace 1 h (el umbral manda), pero nunca la activa',
    (select count(*) from jsonb_array_elements_text(pg_temp.rk('h0') -> 'sin_fila')) = 4
    and (select count(*) from jsonb_array_elements_text(pg_temp.rk('h0') -> 'quitadas')) = 3
    and not (pg_temp.rk('h0')::text like '%' || pg_temp.id(3011)::text || '%')),
  ('p_limite: como mucho N nombres EN TOTAL (primero los sin fila, el resto para las quitadas)',
    jsonb_array_length(pg_temp.rk('h24l') -> 'sin_fila') + jsonb_array_length(pg_temp.rk('h24l') -> 'quitadas') = 2
    and jsonb_array_length(pg_temp.rk('h24l1') -> 'sin_fila') = 1 and jsonb_array_length(pg_temp.rk('h24l1') -> 'quitadas') = 0
    and jsonb_array_length(pg_temp.rk('h24') -> 'sin_fila') + jsonb_array_length(pg_temp.rk('h24') -> 'quitadas') = 5),
  ('parametros invalidos (horas negativas o nulas, limite 0): excepcion invalid_parameter_value (22023)',
    pg_temp.rk('hneg') ->> 'error' = '22023' and pg_temp.rk('hlim') ->> 'error' = '22023' and pg_temp.rk('hnull') ->> 'error' = '22023'),
  ('fotos_huerfanas es de SOLO LECTURA: ni objetos ni filas cambiaron tras llamarla',
    (select n from n_obj) = (select count(*) from storage.objects)
    and (select h from n_fil) = (select md5(string_agg(id::text || activo::text || coalesce(quitada_at::text, ''), ',' order by id)) from public.compra_linea_fotos)
    and (select n from n_fil) = (select count(*) from public.compra_linea_fotos));

-- ---------------------------------------------------------------------------------------------------------------------
-- 11. Nada de lo anterior tocó el flujo
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('al final, subir, quitar y traer fotos no cambio compras.revision de C6 (ni C2 y C5 sin tocar); solo la ficha de la linea dejo eventos',
    pg_temp.crev(pg_temp.id(1006)) = 0 and pg_temp.crev(pg_temp.id(1005)) = 0 and pg_temp.crev(pg_temp.id(1007)) = 0
    and (select count(*) from public.compra_eventos where accion not in ('editar_linea')) = 0),
  ('la unica accion que dejaron las 4 funciones de linea en compra_eventos es editar_linea',
    (select count(distinct accion) from public.compra_eventos) = 1);

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;
