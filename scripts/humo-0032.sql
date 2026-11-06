-- Humo SQL de la migración 0032 (M8 08b-1, agrupadores de compras: viajes, embarques y paquetes):
--   * estructura: las 5 tablas nuevas con RLS sin políticas y permisos exactos, columna generada `periodo_llegada`, FK compuesta
--     paquete-embarque (on update cascade), únicos por `upper(codigo)`, sin checks de catálogo, columnas nuevas de M8, las 17 funciones
--     (security invoker, search_path vacío, solo service_role, sin `--` en el cuerpo) y los triggers (incluido `before truncate` de
--     `compra_eventos`);
--   * `guardar_viaje`, `guardar_embarque`, `guardar_paquete`: códigos aamm## (autonumeración, hueco que no se rellena, escrito a mano,
--     duplicado, inválido, correlativo agotado), responsable asignable (comprador o admin activos; planner e inactivo no), revisión,
--     `fecha_por_movimiento`, `local_con_viaje`, `salida_despues_de_llegada`, viaje cancelado y cerrado;
--   * `cambiar_estado_agrupador` y `asignar_viaje_compras` (revisión de compras, viaje cerrado con aviso, evento por compra);
--   * `aplicar_movimiento_agrupador`: casos sintéticos 1 a 6, 17 y 18 de la ficha §5, pasar pendientes, mover un paquete, mover a
--     paquete, quitar, fecha en el mismo mes (R5), lotes con reparto, I1 a I3, I2 y I5, rechazos que no dejan nada escrito (rollback),
--     recepciones vinculadas (simuladas con un insert directo) y todos los motivos de §2.9;
--   * `importar_agrupadores`: lote completo de la ficha (caso 19b), autonumeración con los códigos escritos primero, todo o nada,
--     aplicar el MISMO lote dos veces (la segunda no duplica nada: clave_existente) y 1 000 filas en <= 3 s;
--   * inmutabilidad (`UPDATE`, `DELETE` y `TRUNCATE` en las dos tablas de eventos, también como service_role) y permisos de anon y
--     authenticated.
-- `agrupadores_desalineados()` debe devolver 0 filas al final.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0032.sql"
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- Las funciones de agrupadores se llaman con `set local role service_role` (la API corre con ese rol): así el humo prueba también
-- que sus permisos bastan. Todo va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Datos inventados.
-- Contra PRODUCCIÓN solo se corre, por SELECT, la sección 1 (estructura); el resto inserta datos de prueba.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- En Supabase `service_role` tiene BYPASSRLS; el rol de la base local (creado por validar-migraciones-local.sh) no. Sin esto las
-- funciones, que corren con ese rol, no verian `perfiles` (RLS sin politicas) y todo daria responsable_no_asignable.
alter role service_role bypassrls;

create temp table r (n serial, caso text, ok boolean);
create temp table k (n text primary key, v uuid);
create temp table res (k text primary key, v jsonb);
create temp table snap (k text primary key, v bigint);

-- ---------------------------------------------------------------------------------------------------------------------
-- Ayudantes generales
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function pg_temp.falla(t text, patron text default null) returns boolean language plpgsql as $f$
begin
  execute t;
  return false;
exception when others then
  return patron is null or sqlerrm like patron;
end
$f$;

create or replace function pg_temp.id(n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;
create or replace function pg_temp.act(n integer) returns jsonb language sql as $f$
  select jsonb_build_object('perfil_id', pg_temp.id(n), 'nombre', 'Humo 32 ' || n) $f$;
create or replace function pg_temp.kk(n text) returns uuid language sql as $f$ select v from k where k.n = $1 $f$;
create or replace function pg_temp.rk(n text) returns jsonb language sql as $f$ select v from res where res.k = $1 $f$;
create or replace function pg_temp.sn(n text) returns bigint language sql as $f$ select v from snap where snap.k = $1 $f$;
create or replace function pg_temp.good(n text) returns boolean language sql as $f$
  select coalesce((v ->> 'ok')::boolean, false) from res where res.k = $1 $f$;
create or replace function pg_temp.mot(n text) returns text language sql as $f$
  select coalesce(v ->> 'motivo', 'ERR:' || coalesce(v ->> 'error', '?') || ' ' || coalesce(v ->> 'msg', '')) from res where res.k = $1 $f$;

-- Estado de la base.
create or replace function pg_temp.crev(c uuid) returns integer language sql as $f$ select revision from public.compras where id = c $f$;
create or replace function pg_temp.erev(e uuid) returns integer language sql as $f$ select revision from public.compra_embarques where id = e $f$;
create or replace function pg_temp.eid(l uuid, per text) returns uuid language sql as $f$
  select id from public.compra_linea_entregas where linea_id = l and periodo = (per || '-01')::date $f$;
create or replace function pg_temp.eu(l uuid, per text) returns integer language sql as $f$
  select coalesce((select unidades from public.compra_linea_entregas where linea_id = l and periodo = (per || '-01')::date), 0) $f$;
create or replace function pg_temp.sumeu(l uuid) returns integer language sql as $f$
  select coalesce(sum(unidades), 0)::integer from public.compra_linea_entregas where linea_id = l $f$;
create or replace function pg_temp.neu(l uuid) returns integer language sql as $f$
  select count(*)::integer from public.compra_linea_entregas where linea_id = l $f$;
create or replace function pg_temp.au(ent uuid, emb uuid, paq uuid) returns integer language sql as $f$
  select coalesce((select unidades from public.compra_entrega_asignaciones where entrega_id = ent and embarque_id = emb and paquete_id is not distinct from paq), 0) $f$;
create or replace function pg_temp.aid(ent uuid, emb uuid, paq uuid) returns uuid language sql as $f$
  select id from public.compra_entrega_asignaciones where entrega_id = ent and embarque_id = emb and paquete_id is not distinct from paq $f$;
create or replace function pg_temp.nasig(emb uuid) returns integer language sql as $f$
  select count(*)::integer from public.compra_entrega_asignaciones where embarque_id = emb $f$;
create or replace function pg_temp.ncev(c uuid, acc text) returns integer language sql as $f$
  select count(*)::integer from public.compra_eventos where compra_id = c and accion = acc $f$;
create or replace function pg_temp.naev(e uuid, acc text) returns integer language sql as $f$
  select count(*)::integer from public.compra_agrupador_eventos where embarque_id = e and accion = acc $f$;
create or replace function pg_temp.desal() returns integer language sql as $f$
  select count(*)::integer from public.agrupadores_desalineados() $f$;
-- Fotografía de lo que un rechazo no debe tocar: unidades por entrega, asignaciones, revisiones y fecha.
create or replace function pg_temp.foto() returns text language sql as $f$
  select md5(
    coalesce((select string_agg(e.id::text || ':' || e.unidades, ',' order by e.id) from public.compra_linea_entregas e), '') || '|' ||
    coalesce((select string_agg(a.id::text || ':' || a.entrega_id || ':' || a.embarque_id || ':' || coalesce(a.paquete_id::text, '-') || ':' || a.unidades, ',' order by a.id) from public.compra_entrega_asignaciones a), '') || '|' ||
    coalesce((select string_agg(c.id::text || ':' || c.revision, ',' order by c.id) from public.compras c), '') || '|' ||
    coalesce((select string_agg(b.id::text || ':' || b.revision || ':' || b.fecha_llegada_estimada || ':' || b.estado, ',' order by b.id) from public.compra_embarques b), '') || '|' ||
    (select count(*) from public.compra_eventos) || '|' || (select count(*) from public.compra_agrupador_eventos) || '|' ||
    (select count(*) from public.compra_linea_repartos)
  ) $f$;

-- Llamadas con el rol de la API. Devuelven el jsonb de la función o { error, msg } si lanzó una excepción.
create or replace function pg_temp.r_gv(p jsonb, rev integer, a integer) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.guardar_viaje(p, rev, pg_temp.act(a));
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_ge(p jsonb, rev integer, a integer) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.guardar_embarque(p, rev, pg_temp.act(a));
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_gp(p jsonb, rev integer, a integer) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.guardar_paquete(p, rev, pg_temp.act(a));
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_ce(t text, i uuid, ac text, rev integer, mo text, a integer) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.cambiar_estado_agrupador(t, i, ac, rev, mo, pg_temp.act(a));
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_av(viaje uuid, cs jsonb, a integer) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.asignar_viaje_compras(viaje, cs, pg_temp.act(a));
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_ap(p jsonb, a integer) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.aplicar_movimiento_agrupador(p, pg_temp.act(a));
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.r_im(p jsonb, a integer) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.importar_agrupadores(p, pg_temp.act(a));
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;

-- Constructores del plan (imitan a `PlanAplicable` de TypeScript).
create or replace function pg_temp.eb(ids uuid[]) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'revision', e.revision) order by e.id), '[]'::jsonb)
    from public.compra_embarques e where e.id = any (ids) $f$;
create or replace function pg_temp.cs(ids uuid[]) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'revision', c.revision) order by c.id), '[]'::jsonb)
    from public.compras c where c.id = any (ids) $f$;
-- Compras de las asignaciones activas de los embarques, más las `extra` (lo que arma `comprasAfectadas`).
create or replace function pg_temp.cda(emb uuid[], extra uuid[]) returns jsonb language sql as $f$
  select pg_temp.cs(array(
    select distinct l.compra_id
      from public.compra_entrega_asignaciones a
      join public.compra_linea_entregas e on e.id = a.entrega_id
      join public.compra_lineas l on l.id = e.linea_id
      join public.compras c on c.id = l.compra_id
     where a.embarque_id = any (emb)
       and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
    union
    select unnest(extra)
  )) $f$;
create or replace function pg_temp.mv(asig uuid, ent uuid, lin uuid, comp uuid, u integer, per text, emb uuid, paq uuid) returns jsonb language sql as $f$
  select jsonb_build_object('asignacion_id', asig, 'entrega_id', ent, 'linea_id', lin, 'compra_id', comp, 'unidades', u,
           'destino', jsonb_build_object('periodo', per, 'embarque_id', emb, 'paquete_id', paq)) $f$;
create or replace function pg_temp.en(lin uuid, per text, u integer) returns jsonb language sql as $f$
  select jsonb_build_object('linea_id', lin, 'periodo', per, 'unidades', u) $f$;
create or replace function pg_temp.pl(op text, emb jsonb, comp jsonb, movs jsonb, ents jsonb default '[]'::jsonb,
                                      reps jsonb default '[]'::jsonb, extra jsonb default '{}'::jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('operacion', op, 'accion', op, 'motivo', 'humo 32', 'resumen', 'humo 32 ' || op, 'embarques', emb,
           'paquete_a_mover', null, 'compras', comp, 'movimientos', movs, 'entregas', ents, 'repartos', reps) || extra $f$;
-- Pone la fecha nueva en el primer embarque de la lista (cambiar_fecha).
create or replace function pg_temp.conf(emb jsonb, fecha text) returns jsonb language sql as $f$
  select jsonb_set(emb, '{0,fecha_llegada_estimada}', to_jsonb(fecha)) $f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura  [solo lectura: también vale contra producción]
-- ---------------------------------------------------------------------------------------------------------------------
create temp table tablas_ag (n text);
insert into tablas_ag values ('compra_viajes'), ('compra_embarques'), ('compra_paquetes'), ('compra_entrega_asignaciones'), ('compra_agrupador_eventos');
create temp table funciones_ag (n text);
insert into funciones_ag values
  ('guardar_viaje'), ('guardar_embarque'), ('guardar_paquete'), ('cambiar_estado_agrupador'), ('asignar_viaje_compras'),
  ('agrupador_mover_entregas'), ('aplicar_movimiento_agrupador'), ('importar_agrupadores'), ('compra_foto_entregas'),
  ('agrupadores_desalineados'), ('agrupador_responsable_asignable'), ('agrupador_nombre_clave'), ('agrupador_es_activa'),
  ('agrupador_siguiente_codigo'), ('agrupador_foto_embarque'), ('tg_compra_agrupador_inmutable'), ('tg_compra_eventos_sin_vaciado');

insert into r (caso, ok) values
  ('existen las 5 tablas nuevas',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relkind = 'r' and c.relname in (select n from tablas_ag)) = 5),
  ('las 5 tablas tienen RLS activo y ninguna tiene politicas',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relname in (select n from tablas_ag) and c.relrowsecurity) = 5
    and (select count(*) from pg_policies where schemaname = 'public' and tablename in (select n from tablas_ag)) = 0),
  ('anon y authenticated sin ningun permiso sobre las 5 tablas',
    (select count(*) from tablas_ag t, unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'trigger', 'references']) p(priv)
      where has_table_privilege('anon', 'public.' || t.n, p.priv) or has_table_privilege('authenticated', 'public.' || t.n, p.priv)) = 0),
  ('service_role: viajes, embarques y paquetes solo select, insert y update; asignaciones ademas delete; eventos solo select e insert; nunca truncate, trigger ni references',
    (select count(*) from unnest(array['compra_viajes', 'compra_embarques', 'compra_paquetes']) t(n), unnest(array['select', 'insert', 'update']) p(priv)
      where not has_table_privilege('service_role', 'public.' || t.n, p.priv)) = 0
    and (select count(*) from unnest(array['compra_viajes', 'compra_embarques', 'compra_paquetes', 'compra_agrupador_eventos']) t(n), unnest(array['delete', 'truncate', 'trigger', 'references']) p(priv)
      where has_table_privilege('service_role', 'public.' || t.n, p.priv)) = 0
    and has_table_privilege('service_role', 'public.compra_entrega_asignaciones', 'delete')
    and not has_table_privilege('service_role', 'public.compra_entrega_asignaciones', 'truncate')
    and has_table_privilege('service_role', 'public.compra_agrupador_eventos', 'select')
    and has_table_privilege('service_role', 'public.compra_agrupador_eventos', 'insert')
    and not has_table_privilege('service_role', 'public.compra_agrupador_eventos', 'update')),
  ('periodo_llegada es una columna generada almacenada (expresion inmutable con make_date)',
    (select count(*) from pg_attribute where attrelid = 'public.compra_embarques'::regclass and attname = 'periodo_llegada' and attgenerated = 's') = 1),
  ('unicos por upper(codigo) en viajes, embarques y paquetes',
    (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('compra_viajes_codigo_uniq', 'compra_embarques_codigo_uniq', 'compra_paquetes_codigo_uniq')
        and indexdef like '%UNIQUE%upper(codigo)%') = 3),
  ('unico (id, embarque_id) en paquetes y FK compuesta (paquete, embarque) con on update cascade y on delete restrict',
    (select count(*) from pg_constraint where conrelid = 'public.compra_paquetes'::regclass and contype = 'u' and conname = 'compra_paquetes_id_embarque_key') = 1
    and (select count(*) from pg_constraint where conrelid = 'public.compra_entrega_asignaciones'::regclass and contype = 'f'
           and conname = 'compra_entrega_asignaciones_paquete_embarque_fkey' and confupdtype = 'c' and confdeltype = 'r' and array_length(conkey, 1) = 2) = 1),
  ('unico de asignaciones (entrega, embarque, coalesce(paquete, uuid cero))',
    (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'compra_entrega_asignaciones_clave_uniq'
        and indexdef ilike '%UNIQUE%coalesce(paquete_id%') = 1),
  ('ningun check de catalogo (estado, tipo, accion) en las 5 tablas',
    not exists (select 1 from pg_constraint
                 where contype = 'c' and conrelid in (select ('public.' || n)::regclass from tablas_ag)
                   and pg_get_constraintdef(oid) ~ '\m(estado|tipo|accion)\M')),
  ('todas las FK a viajes, embarques, paquetes, entregas y asignaciones son restrict (nada con historia se borra); las de perfiles, set null',
    (select count(*) from pg_constraint
      where contype = 'f' and conrelid in (select ('public.' || n)::regclass from tablas_ag)
        and confrelid in ('public.compra_viajes'::regclass, 'public.compra_embarques'::regclass, 'public.compra_paquetes'::regclass, 'public.compra_linea_entregas'::regclass)
        and confdeltype <> 'r') = 0
    and (select count(*) from pg_constraint
      where contype = 'f' and conrelid in (select ('public.' || n)::regclass from tablas_ag)
        and confrelid = 'public.perfiles'::regclass and confdeltype <> 'n') = 0),
  ('compras.viaje_id y compra_linea_recepciones.asignacion_id: uuid nullable, sin default, con FK restrict e indice',
    (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'viaje_id' and table_name = 'compras'
       and data_type = 'uuid' and is_nullable = 'YES' and column_default is null) = 1
    and (select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'asignacion_id' and table_name = 'compra_linea_recepciones'
       and data_type = 'uuid' and is_nullable = 'YES' and column_default is null) = 1
    and (select count(*) from pg_constraint where contype = 'f' and conname in ('compras_viaje_id_fkey', 'compra_linea_recepciones_asignacion_id_fkey') and confdeltype = 'r') = 2
    and (select count(*) from pg_indexes where schemaname = 'public' and indexname in ('compras_viaje_id_idx', 'compra_linea_recepciones_asignacion_id_idx')) = 2),
  ('las 17 funciones: security invoker, search_path vacio y execute solo para service_role',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in (select n from funciones_ag)
        and not p.prosecdef
        and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path='))
        and not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and has_function_privilege('service_role', p.oid, 'execute')) = 17),
  ('los cuerpos de las 17 funciones no tienen comentarios -- (el SQL Editor los parsea mal)',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in (select n from funciones_ag) and p.prosrc like '%--%') = 0),
  ('set_updated_at en viajes, embarques, paquetes y asignaciones (no en eventos)',
    (select count(*) from pg_trigger t where not t.tgisinternal and t.tgname = 'set_updated_at'
       and t.tgrelid in ('public.compra_viajes'::regclass, 'public.compra_embarques'::regclass, 'public.compra_paquetes'::regclass, 'public.compra_entrega_asignaciones'::regclass)) = 4
    and not exists (select 1 from pg_trigger t where not t.tgisinternal and t.tgname = 'set_updated_at' and t.tgrelid = 'public.compra_agrupador_eventos'::regclass)),
  ('compra_agrupador_eventos: trigger por fila (update, delete) y por sentencia (truncate)',
    (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid = 'public.compra_agrupador_eventos'::regclass
        and t.tgname = 'compra_agrupador_eventos_inmutable' and (t.tgtype & 1) = 1 and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16 and (t.tgtype & 2) = 2) = 1
    and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid = 'public.compra_agrupador_eventos'::regclass
        and t.tgname = 'compra_agrupador_eventos_sin_vaciado' and (t.tgtype & 1) = 0 and (t.tgtype & 32) = 32 and (t.tgtype & 2) = 2) = 1),
  ('compra_eventos: conserva su trigger de fila y suma el de truncate por sentencia (pendiente M-3)',
    (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid = 'public.compra_eventos'::regclass
        and t.tgname = 'compra_eventos_inmutable' and (t.tgtype & 1) = 1) = 1
    and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid = 'public.compra_eventos'::regclass
        and t.tgname = 'compra_eventos_sin_vaciado' and (t.tgtype & 1) = 0 and (t.tgtype & 32) = 32 and (t.tgtype & 2) = 2) = 1),
  ('los identificadores de las tablas, indices y restricciones nuevas miden <= 63 caracteres y los esperados existen sin truncar',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and (c.relname like 'compra\_agrupador%' or c.relname like 'compra\_entrega\_asignaciones%' or c.relname like 'compra\_viajes%'
        or c.relname like 'compra\_embarques%' or c.relname like 'compra\_paquetes%') and length(c.relname) > 63) = 0
    and exists (select 1 from pg_constraint where conname = 'compra_entrega_asignaciones_paquete_embarque_fkey')
    and exists (select 1 from pg_indexes where indexname = 'compra_agrupador_eventos_embarque_created_idx'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture: perfiles, proveedores, GML, marcas y cuatro compras con sus líneas, entregas y repartos
-- ---------------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  (pg_temp.id(1), 'humo32a@example.invalid'), (pg_temp.id(2), 'humo32c1@example.invalid'), (pg_temp.id(3), 'humo32c2@example.invalid'),
  (pg_temp.id(4), 'humo32c3@example.invalid'), (pg_temp.id(5), 'humo32p@example.invalid');
insert into perfiles (id, email, nombre, rol, activo) values
  (pg_temp.id(1), 'humo32a@example.invalid', 'Humo 32 A', 'admin', true),
  (pg_temp.id(2), 'humo32c1@example.invalid', 'Humo 32 C1', 'comprador', true),
  (pg_temp.id(3), 'humo32c2@example.invalid', 'Humo 32 C2', 'comprador', true),
  (pg_temp.id(4), 'humo32c3@example.invalid', 'Humo 32 C3', 'comprador', false),
  (pg_temp.id(5), 'humo32p@example.invalid', 'Humo 32 P', 'planner', true);

insert into proveedores (nombre) values ('FERIA SUR H32'), ('PROVEEDOR NORTE H32'), ('TALLER LIMA CENTRO H32');
insert into generos (codigo, nombre) values ('H32H', 'HOMBRE H32');
insert into mundos (codigo, nombre) values ('H32U', 'URBANO H32');
insert into lineas (codigo, nombre, temporada) values ('H32L1', 'LINEA UNO H32', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML' from lineas l, generos g, mundos mu where l.codigo = 'H32L1' and g.codigo = 'H32H' and mu.codigo = 'H32U';
insert into agrupaciones_marca (codigo, nombre) values ('H32AG1', 'AGRUPACION H32');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select m.codigo, m.codigo, a.id from agrupaciones_marca a, (values ('H32M1'), ('H32M2')) as m(codigo) where a.codigo = 'H32AG1';

create temp table ctx as
select (select id from genero_mundo_linea limit 1) as gml,
       (select id from marcas where codigo = 'H32M1') as m1,
       (select id from marcas where codigo = 'H32M2') as m2,
       (select id from proveedores where nombre = 'FERIA SUR H32') as p1,
       (select id from proveedores where nombre = 'PROVEEDOR NORTE H32') as p2,
       (select id from proveedores where nombre = 'TALLER LIMA CENTRO H32') as p3;

-- Compra A (confirmada): l1 específica 500 u (nov 300, dic 200); l2 lote de la marca M1 de 1 000 u (mar-27 600, abr-27 400).
-- Compra B (confirmada): l3 específica 400 u (nov); l5 específica 600 u (nov 500, dic 100).
-- Compra C (borrador): l4 120 u (nov). Compra D (confirmada): l6 de 240 u en 24 entregas (ene-27 a dic-28, 10 u cada una).
insert into compras (id, proveedor_id, origen, estado, fecha_compra, confirmada_at)
select pg_temp.id(9001), p1, 'carga_inicial', 'confirmada', date '2026-09-10', now() from ctx;
insert into compras (id, proveedor_id, origen, estado, fecha_compra, confirmada_at)
select pg_temp.id(9002), p2, 'carga_inicial', 'confirmada', date '2026-09-12', now() from ctx;
insert into compras (id, proveedor_id, origen, estado, fecha_compra)
select pg_temp.id(9003), p3, 'comprador', 'borrador', date '2026-09-15' from ctx;
insert into compras (id, proveedor_id, origen, estado, fecha_compra, confirmada_at)
select pg_temp.id(9004), p1, 'carga_inicial', 'confirmada', date '2026-09-20', now() from ctx;

insert into compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, marca_id, unidades, llegada_periodo, costo_unitario)
select pg_temp.id(9101), pg_temp.id(9001), 'especifica', gml, null, 500, date '2026-11-01', 10 from ctx
union all select pg_temp.id(9102), pg_temp.id(9001), 'barrer_marca', null, m1, 1000, date '2027-03-01', 8 from ctx
union all select pg_temp.id(9103), pg_temp.id(9002), 'especifica', gml, null, 400, date '2026-11-01', 12 from ctx
union all select pg_temp.id(9105), pg_temp.id(9002), 'especifica', gml, null, 600, date '2026-11-01', 12 from ctx
union all select pg_temp.id(9104), pg_temp.id(9003), 'especifica', gml, null, 120, date '2026-11-01', 9 from ctx
union all select pg_temp.id(9106), pg_temp.id(9004), 'especifica', gml, null, 240, date '2027-01-01', 5 from ctx;

insert into compra_linea_entregas (linea_id, periodo, unidades, origen) values
  (pg_temp.id(9101), date '2026-11-01', 300, 'manual'), (pg_temp.id(9101), date '2026-12-01', 200, 'manual'),
  (pg_temp.id(9102), date '2027-03-01', 600, 'manual'), (pg_temp.id(9102), date '2027-04-01', 400, 'manual'),
  (pg_temp.id(9103), date '2026-11-01', 400, 'manual'),
  (pg_temp.id(9105), date '2026-11-01', 500, 'manual'), (pg_temp.id(9105), date '2026-12-01', 100, 'manual'),
  (pg_temp.id(9104), date '2026-11-01', 120, 'manual');
insert into compra_linea_entregas (linea_id, periodo, unidades, origen)
select pg_temp.id(9106), (date '2027-01-01' + (g || ' month')::interval)::date, 10, 'manual' from generate_series(0, 23) g;

-- Reparto del lote l2: mar-27 (M1 400 + M2 200), abr-27 (M1 270 + M2 130).
insert into compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, unidades)
select pg_temp.id(9102), pg_temp.eid(pg_temp.id(9102), v.per), case v.m when 1 then c.m1 else c.m2 end, c.gml, v.u
  from ctx c, (values ('2027-03', 1, 400), ('2027-03', 2, 200), ('2027-04', 1, 270), ('2027-04', 2, 130)) as v(per, m, u);

insert into k values ('cA', pg_temp.id(9001)), ('cB', pg_temp.id(9002)), ('cC', pg_temp.id(9003)), ('cD', pg_temp.id(9004)),
  ('l1', pg_temp.id(9101)), ('l2', pg_temp.id(9102)), ('l3', pg_temp.id(9103)), ('l4', pg_temp.id(9104)), ('l5', pg_temp.id(9105)), ('l6', pg_temp.id(9106));

insert into r (caso, ok) values
  ('fixture: 4 compras, 6 lineas, 8 + 24 entregas y 4 repartos',
    (select count(*) from compras where id in (select v from k where n like 'c%')) = 4
    and (select count(*) from compra_linea_entregas) = 32 and (select count(*) from compra_linea_repartos) = 4
    and pg_temp.sumeu(pg_temp.kk('l1')) = 500 and pg_temp.sumeu(pg_temp.kk('l2')) = 1000 and pg_temp.sumeu(pg_temp.kk('l6')) = 240);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. guardar_viaje: códigos aamm##, responsable asignable, revisión
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('v1', pg_temp.r_gv(jsonb_build_object('nombre', 'Feria Sur oct-2026', 'destino', 'Lima', 'fecha_inicio', '2026-10-05', 'fecha_fin', '2026-10-12', 'responsable_id', pg_temp.id(2)), null, 3)),
  ('v1b', pg_temp.r_gv(jsonb_build_object('nombre', 'Otro viaje octubre', 'fecha_inicio', '2026-10-20', 'responsable_id', pg_temp.id(1)), null, 2));
insert into k select 'V1', (pg_temp.rk('v1') ->> 'viaje_id')::uuid;
insert into k select 'V1b', (pg_temp.rk('v1b') ->> 'viaje_id')::uuid;

insert into res values
  ('v_dup', pg_temp.r_gv(jsonb_build_object('codigo', '261001', 'nombre', 'X', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(2)), null, 2)),
  ('v_inv', pg_temp.r_gv(jsonb_build_object('codigo', 'AB C', 'nombre', 'X', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(2)), null, 2)),
  ('v_plan', pg_temp.r_gv(jsonb_build_object('nombre', 'X', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(5)), null, 2)),
  ('v_inac', pg_temp.r_gv(jsonb_build_object('nombre', 'X', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(4)), null, 2)),
  ('v_nulo', pg_temp.r_gv(jsonb_build_object('nombre', 'X', 'fecha_inicio', '2026-10-05'), null, 2)),
  ('v_fin', pg_temp.r_gv(jsonb_build_object('nombre', 'X', 'fecha_inicio', '2026-10-05', 'fecha_fin', '2026-10-01', 'responsable_id', pg_temp.id(2)), null, 2)),
  ('v_man', pg_temp.r_gv(jsonb_build_object('codigo', 'abc-1', 'nombre', 'Manual', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(2)), null, 2)),
  ('v_man2', pg_temp.r_gv(jsonb_build_object('codigo', 'ABC-1', 'nombre', 'Manual 2', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(2)), null, 2)),
  ('v_sig', pg_temp.r_gv(jsonb_build_object('nombre', 'Siguiente', 'fecha_inicio', '2026-10-30', 'responsable_id', pg_temp.id(2)), null, 2)),
  ('v_ed', pg_temp.r_gv(jsonb_build_object('id', pg_temp.kk('V1'), 'codigo', 'IGNORADO', 'nombre', 'Feria Sur oct-2026 (editado)', 'destino', 'Lima Norte', 'fecha_inicio', '2026-10-05', 'fecha_fin', '2026-10-14', 'responsable_id', pg_temp.id(2)), 0, 3)),
  ('v_ed_old', pg_temp.r_gv(jsonb_build_object('id', pg_temp.kk('V1'), 'nombre', 'Otra vez', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(2)), 0, 3)),
  ('v_ed_plan', pg_temp.r_gv(jsonb_build_object('id', pg_temp.kk('V1'), 'nombre', 'Planner', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(5)), 1, 3)),
  ('v_ed_no', pg_temp.r_gv(jsonb_build_object('id', pg_temp.id(777), 'nombre', 'X', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(2)), 0, 3));

insert into r (caso, ok) values
  ('viaje 1: crea con codigo 261001 (mes de fecha_inicio), abierto, revision 0, responsable C1, con evento crear',
    pg_temp.good('v1') and pg_temp.rk('v1') ->> 'codigo' = '261001' and (pg_temp.rk('v1') ->> 'revision')::integer = 0
    and (select estado = 'abierto' and responsable_id = pg_temp.id(2) and perfil_id = pg_temp.id(3) from compra_viajes where id = pg_temp.kk('V1'))
    and (select count(*) from compra_agrupador_eventos where viaje_id = pg_temp.kk('V1') and accion = 'crear' and perfil_id = pg_temp.id(3)) = 1),
  ('viaje 2 del mismo mes sin codigo: 261002 (maximo mas uno); admin como responsable es asignable',
    pg_temp.good('v1b') and pg_temp.rk('v1b') ->> 'codigo' = '261002'),
  ('codigo 261001 a mano repetido: codigo_duplicado; con caracteres invalidos: codigo_invalido',
    pg_temp.mot('v_dup') = 'codigo_duplicado' and pg_temp.mot('v_inv') = 'codigo_invalido'),
  ('responsable planner, comprador inactivo o ausente: responsable_no_asignable',
    pg_temp.mot('v_plan') = 'responsable_no_asignable' and pg_temp.mot('v_inac') = 'responsable_no_asignable' and pg_temp.mot('v_nulo') = 'responsable_no_asignable'),
  ('fin antes de inicio: fin_antes_de_inicio',
    pg_temp.mot('v_fin') = 'fin_antes_de_inicio'),
  ('codigo a mano en minusculas se guarda en mayusculas (ABC-1) y repetirlo sin distinguir caja: codigo_duplicado',
    pg_temp.good('v_man') and pg_temp.rk('v_man') ->> 'codigo' = 'ABC-1' and pg_temp.mot('v_man2') = 'codigo_duplicado'),
  ('un codigo escrito a mano que no es aamm## no ocupa correlativo: el siguiente automatico sigue en 261003',
    pg_temp.good('v_sig') and pg_temp.rk('v_sig') ->> 'codigo' = '261003'),
  ('editar con revision vigente: sube a 1, cambia los datos, ignora el codigo, deja evento editar',
    pg_temp.good('v_ed') and (pg_temp.rk('v_ed') ->> 'revision')::integer = 1 and pg_temp.rk('v_ed') ->> 'codigo' = '261001'
    and (select nombre = 'Feria Sur oct-2026 (editado)' and destino = 'Lima Norte' and fecha_fin = date '2026-10-14' from compra_viajes where id = pg_temp.kk('V1'))
    and (select count(*) from compra_agrupador_eventos where viaje_id = pg_temp.kk('V1') and accion = 'editar') = 1),
  ('editar con revision vieja: agrupador_cambio; cambiar el responsable a un planner: responsable_no_asignable; id inexistente: no_encontrado',
    pg_temp.mot('v_ed_old') = 'agrupador_cambio' and pg_temp.mot('v_ed_plan') = 'responsable_no_asignable' and pg_temp.mot('v_ed_no') = 'no_encontrado');

-- Mes con correlativo 99 ya usado: correlativo_agotado (el hueco no se rellena y 99 es el tope).
insert into res values
  ('v99', pg_temp.r_gv(jsonb_build_object('codigo', '270199', 'nombre', 'Noventa y nueve', 'fecha_inicio', '2027-01-10', 'responsable_id', pg_temp.id(2)), null, 2)),
  ('v99b', pg_temp.r_gv(jsonb_build_object('nombre', 'Agotado', 'fecha_inicio', '2027-01-20', 'responsable_id', pg_temp.id(2)), null, 2));
insert into r (caso, ok) values
  ('con el 99 usado el mes: correlativo_agotado (escribe el codigo a mano)', pg_temp.good('v99') and pg_temp.mot('v99b') = 'correlativo_agotado');

-- Desactivar a quien ya era responsable conserva la asignación: editar sin cambiar el responsable no lo revalida.
insert into res values ('v_c2', pg_temp.r_gv(jsonb_build_object('nombre', 'Viaje de C2', 'fecha_inicio', '2026-09-01', 'responsable_id', pg_temp.id(3)), null, 2));
update perfiles set activo = false where id = pg_temp.id(3);
insert into k select 'Vc2', (pg_temp.rk('v_c2') ->> 'viaje_id')::uuid;
insert into res values ('v_c2e', pg_temp.r_gv(jsonb_build_object('id', pg_temp.kk('Vc2'), 'nombre', 'Viaje de C2 (editado)', 'fecha_inicio', '2026-09-01', 'responsable_id', pg_temp.id(3)), 0, 2));
update perfiles set activo = true where id = pg_temp.id(3);
insert into r (caso, ok) values
  ('responsable que se desactivo despues: editar el viaje sin cambiarlo se acepta (conserva la asignacion)', pg_temp.good('v_c2e'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. guardar_embarque: caso 6 (códigos), 10 (local con viaje, salida > llegada), viaje cerrado y cancelado
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('e1', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque noviembre', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1'), 'puerto_embarque', 'Puerto Sur',
      'referencia_logistica', 'BL-1', 'fecha_salida_estimada', '2026-10-25', 'fecha_llegada_estimada', '2026-11-20'), null, 3)),
  ('e3', pg_temp.r_ge(jsonb_build_object('codigo', '261102', 'nombre', 'Local noviembre', 'tipo', 'local', 'fecha_llegada_estimada', '2026-11-05', 'responsable_id', pg_temp.id(1)), null, 2));
insert into k select 'E1', (pg_temp.rk('e1') ->> 'embarque_id')::uuid;
insert into k select 'E3', (pg_temp.rk('e3') ->> 'embarque_id')::uuid;
insert into res values
  ('e_auto', pg_temp.r_ge(jsonb_build_object('nombre', 'Otro de noviembre', 'tipo', 'importacion', 'fecha_llegada_estimada', '2026-11-28'), null, 2)),
  ('e_dup', pg_temp.r_ge(jsonb_build_object('codigo', '261101', 'nombre', 'Dup', 'tipo', 'importacion', 'fecha_llegada_estimada', '2026-11-28'), null, 2)),
  ('e_local', pg_temp.r_ge(jsonb_build_object('nombre', 'Local con viaje', 'tipo', 'local', 'viaje_id', pg_temp.kk('V1'), 'fecha_llegada_estimada', '2026-11-28'), null, 2)),
  ('e_sal', pg_temp.r_ge(jsonb_build_object('nombre', 'Salida tarde', 'tipo', 'importacion', 'fecha_salida_estimada', '2026-12-01', 'fecha_llegada_estimada', '2026-11-28'), null, 2)),
  ('e_plan', pg_temp.r_ge(jsonb_build_object('nombre', 'Resp planner', 'tipo', 'importacion', 'responsable_id', pg_temp.id(5), 'fecha_llegada_estimada', '2026-11-28'), null, 2)),
  ('e_nofecha', pg_temp.r_ge(jsonb_build_object('nombre', 'Sin fecha', 'tipo', 'importacion'), null, 2)),
  ('e2', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque diciembre', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1'), 'fecha_llegada_estimada', '2026-12-10'), null, 2)),
  ('e3b', pg_temp.r_ge(jsonb_build_object('codigo', '270301', 'nombre', 'Embarque marzo 27', 'tipo', 'importacion', 'fecha_llegada_estimada', '2027-03-15'), null, 2)),
  ('e4', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque 2029', 'tipo', 'importacion', 'fecha_llegada_estimada', '2029-01-10'), null, 2)),
  ('e99', pg_temp.r_ge(jsonb_build_object('codigo', '290199', 'nombre', 'Noventa y nueve', 'tipo', 'importacion', 'fecha_llegada_estimada', '2029-01-11'), null, 2)),
  ('e99b', pg_temp.r_ge(jsonb_build_object('nombre', 'Agotado', 'tipo', 'importacion', 'fecha_llegada_estimada', '2029-01-12'), null, 2));
insert into k select 'E2', (pg_temp.rk('e2') ->> 'embarque_id')::uuid;
insert into k select 'E3b', (pg_temp.rk('e3b') ->> 'embarque_id')::uuid;
insert into k select 'E4', (pg_temp.rk('e4') ->> 'embarque_id')::uuid;
insert into k select 'Eauto', (pg_temp.rk('e_auto') ->> 'embarque_id')::uuid;

-- El viaje 261101 a mano convive con el embarque 261101 (cada tipo tiene su numeracion).
insert into res values ('v_261101', pg_temp.r_gv(jsonb_build_object('codigo', '261101', 'nombre', 'Viaje con el mismo codigo', 'fecha_inicio', '2026-11-02', 'responsable_id', pg_temp.id(2)), null, 2));

insert into r (caso, ok) values
  ('embarque 1: codigo 261101 (mes de la llegada), puerto, referencia, salida; con evento crear',
    pg_temp.good('e1') and pg_temp.rk('e1') ->> 'codigo' = '261101' and (pg_temp.rk('e1') ->> 'revision')::integer = 0
    and (select puerto_embarque = 'Puerto Sur' and referencia_logistica = 'BL-1' and fecha_salida_estimada = date '2026-10-25'
            and periodo_llegada = date '2026-11-01' and estado = 'planificado' and viaje_id = pg_temp.kk('V1') from compra_embarques where id = pg_temp.kk('E1'))
    and pg_temp.naev(pg_temp.kk('E1'), 'crear') = 1),
  ('caso 6: con 261101 y 261102 (este a mano) ya creados, otro embarque de nov-26 sin codigo recibe 261103',
    pg_temp.good('e3') and pg_temp.good('e_auto') and pg_temp.rk('e_auto') ->> 'codigo' = '261103'),
  ('caso 6: 261101 a mano otra vez: codigo_duplicado; el viaje 261101 convive con el embarque 261101',
    pg_temp.mot('e_dup') = 'codigo_duplicado' and pg_temp.good('v_261101')),
  ('caso 10: local con viaje: local_con_viaje; salida posterior a la llegada: salida_despues_de_llegada',
    pg_temp.mot('e_local') = 'local_con_viaje' and pg_temp.mot('e_sal') = 'salida_despues_de_llegada'),
  ('responsable planner: responsable_no_asignable; sin fecha de llegada al crear: fecha_requerida',
    pg_temp.mot('e_plan') = 'responsable_no_asignable' and pg_temp.mot('e_nofecha') = 'fecha_requerida'),
  ('embarque 2 de diciembre: 261201; embarque marzo-27 a mano 270301; con el 99 ya usado: correlativo_agotado',
    pg_temp.rk('e2') ->> 'codigo' = '261201' and pg_temp.good('e3b') and pg_temp.good('e99') and pg_temp.mot('e99b') = 'correlativo_agotado'),
  ('el embarque local no lleva viaje (viaje_id nulo) y es del admin',
    (select viaje_id is null and tipo = 'local' and responsable_id = pg_temp.id(1) from compra_embarques where id = pg_temp.kk('E3')));

insert into res values
  ('e1_ed', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'Embarque noviembre (editado)', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1'),
      'puerto_embarque', 'Puerto Norte', 'fecha_salida_estimada', '2026-10-25'), 0, 2)),
  ('e1_fecha', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1'), 'fecha_llegada_estimada', '2026-12-30'), 1, 2)),
  ('e1_misma', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'Embarque noviembre (editado)', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1'), 'puerto_embarque', 'Puerto Norte', 'fecha_salida_estimada', '2026-10-25', 'fecha_llegada_estimada', '2026-11-20'), 1, 2)),
  ('e1_vieja', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1')), 0, 2)),
  ('e1_sal', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1'), 'fecha_salida_estimada', '2026-12-31'), 2, 2)),
  ('e1_loc', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'local', 'viaje_id', pg_temp.kk('V1')), 2, 2));
insert into r (caso, ok) values
  ('editar el embarque: cambia nombre y puerto (no mueve entregas), la salida reenviada igual se conserva, sube la revision y deja evento editar (0038: el PATCH ya no escribe fechas)',
    pg_temp.good('e1_ed') and (pg_temp.rk('e1_ed') ->> 'revision')::integer = 1
    and (select nombre = 'Embarque noviembre (editado)' and puerto_embarque = 'Puerto Norte' and fecha_salida_estimada = date '2026-10-25' and fecha_llegada_estimada = date '2026-11-20' from compra_embarques where id = pg_temp.kk('E1'))
    and pg_temp.naev(pg_temp.kk('E1'), 'editar') >= 1),
  ('editar con otra fecha de llegada: fecha_por_movimiento; con la misma se ignora; revision vieja: agrupador_cambio',
    pg_temp.mot('e1_fecha') = 'fecha_por_movimiento' and pg_temp.good('e1_misma') and pg_temp.mot('e1_vieja') = 'agrupador_cambio'),
  ('editar con otra salida (aunque sea posterior a la llegada): fecha_por_movimiento (0038: las fechas no se editan por PATCH); volverlo local con viaje: local_con_viaje',
    pg_temp.mot('e1_sal') = 'fecha_por_movimiento' and pg_temp.mot('e1_loc') = 'local_con_viaje');

-- Viaje cerrado (aviso) y cancelado (bloquea). Se prueban en la sección 5; aquí solo un embarque nuevo bajo un viaje que luego se cierra.

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. guardar_paquete
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('p1', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E1'), 'nombre', 'Paquete uno', 'responsable_id', pg_temp.id(3)), pg_temp.erev(pg_temp.kk('E1')), 2));
insert into k select 'P1', (pg_temp.rk('p1') ->> 'paquete_id')::uuid;
insert into res values
  ('p2', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E1'), 'nombre', 'Paquete dos'), pg_temp.erev(pg_temp.kk('E1')), 2)),
  ('p_vieja', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E1'), 'nombre', 'Vieja'), 0, 2)),
  ('p_dup', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E1'), 'codigo', '261101', 'nombre', 'Dup'), pg_temp.erev(pg_temp.kk('E1')), 2)),
  ('p_plan', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E1'), 'nombre', 'Planner', 'responsable_id', pg_temp.id(5)), pg_temp.erev(pg_temp.kk('E1')), 2));
insert into k select 'P2', (pg_temp.rk('p2') ->> 'paquete_id')::uuid;
insert into res values
  ('p1_ed', pg_temp.r_gp(jsonb_build_object('id', pg_temp.kk('P1'), 'nombre', 'Paquete uno (editado)', 'responsable_id', pg_temp.id(2)), pg_temp.erev(pg_temp.kk('E1')), 3));
insert into r (caso, ok) values
  ('paquete 1 y 2 de E1: 261101 y 261102 (su propia numeracion, mes del embarque); la revision del embarque sube con cada uno',
    pg_temp.good('p1') and pg_temp.rk('p1') ->> 'codigo' = '261101' and pg_temp.good('p2') and pg_temp.rk('p2') ->> 'codigo' = '261102'
    and (pg_temp.rk('p2') ->> 'embarque_revision')::integer = (pg_temp.rk('p1') ->> 'embarque_revision')::integer + 1
    and (select (despues ->> 'responsable_id')::uuid = pg_temp.id(3) from compra_agrupador_eventos where paquete_id = pg_temp.kk('P1') and accion = 'crear')),
  ('paquete: revision del embarque vieja: agrupador_cambio; codigo repetido: codigo_duplicado; responsable planner: responsable_no_asignable',
    pg_temp.mot('p_vieja') = 'agrupador_cambio' and pg_temp.mot('p_dup') = 'codigo_duplicado' and pg_temp.mot('p_plan') = 'responsable_no_asignable'),
  ('editar un paquete: cambia nombre y responsable, sube la revision del embarque, deja evento editar',
    pg_temp.good('p1_ed') and (select nombre = 'Paquete uno (editado)' and responsable_id = pg_temp.id(2) from compra_paquetes where id = pg_temp.kk('P1'))
    and (select count(*) from compra_agrupador_eventos where paquete_id = pg_temp.kk('P1') and accion = 'editar') = 1);

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. asignar_viaje_compras, cerrar y cancelar un viaje (decisión 95)
-- ---------------------------------------------------------------------------------------------------------------------
insert into snap values ('revA0', pg_temp.crev(pg_temp.kk('cA')));
insert into res values
  ('av1', pg_temp.r_av(pg_temp.kk('V1'), pg_temp.cs(array[pg_temp.kk('cA')]), 3)),
  ('av_vieja', pg_temp.r_av(pg_temp.kk('V1'), jsonb_build_array(jsonb_build_object('id', pg_temp.kk('cB'), 'revision', 5)), 3));
insert into r (caso, ok) values
  ('asignar compra A a V1: sube la revision en 1, deja viaje_id, evento asignar_viaje en la compra y en el viaje',
    pg_temp.good('av1') and pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revA0') + 1
    and (select viaje_id = pg_temp.kk('V1') from compras where id = pg_temp.kk('cA'))
    and pg_temp.ncev(pg_temp.kk('cA'), 'asignar_viaje') = 1
    and (select count(*) from compra_agrupador_eventos where viaje_id = pg_temp.kk('V1') and accion = 'asignar_viaje' and jsonb_array_length(compras) = 1) = 1
    and jsonb_array_length(pg_temp.rk('av1') -> 'avisos') = 0),
  ('asignar con una revision de compra que no es la vigente: compra_cambio y nada escrito',
    pg_temp.mot('av_vieja') = 'compra_cambio' and (select viaje_id is null from compras where id = pg_temp.kk('cB')));

insert into snap values ('revA1', pg_temp.crev(pg_temp.kk('cA')));
insert into res values ('av_igual', pg_temp.r_av(pg_temp.kk('V1'), pg_temp.cs(array[pg_temp.kk('cA')]), 3));
insert into r (caso, ok) values
  ('asignar el mismo viaje otra vez no cambia ni sube la revision', pg_temp.good('av_igual') and pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revA1'));

-- Cerrar V1 como admin; el comprador C2 le añade la compra B y crea un embarque del viaje (con aviso, sin bloquear).
insert into res values ('v_cerrar', pg_temp.r_ce('viaje', pg_temp.kk('V1'), 'cerrar', (select revision from compra_viajes where id = pg_temp.kk('V1')), null, 1));
insert into res values ('av_cerrado', pg_temp.r_av(pg_temp.kk('V1'), pg_temp.cs(array[pg_temp.kk('cB')]), 3));
insert into res values ('e_cerrado', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque bajo viaje cerrado', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1'), 'fecha_llegada_estimada', '2026-12-15'), null, 3));
insert into k select 'Ecerr', (pg_temp.rk('e_cerrado') ->> 'embarque_id')::uuid;
insert into res values ('v_reabrir', pg_temp.r_ce('viaje', pg_temp.kk('V1'), 'reabrir', (select revision from compra_viajes where id = pg_temp.kk('V1')), null, 1));
insert into res values ('v_reabrir2', pg_temp.r_ce('viaje', pg_temp.kk('V1'), 'reabrir', (select revision from compra_viajes where id = pg_temp.kk('V1')), null, 1));
insert into res values ('v_cancel_sin', pg_temp.r_ce('viaje', pg_temp.kk('V1'), 'cancelar', (select revision from compra_viajes where id = pg_temp.kk('V1')), null, 1));
insert into res values ('v_cancel_con', pg_temp.r_ce('viaje', pg_temp.kk('V1'), 'cancelar', (select revision from compra_viajes where id = pg_temp.kk('V1')), 'quiero cancelar', 1));
insert into res values ('v_vieja', pg_temp.r_ce('viaje', pg_temp.kk('V1'), 'cerrar', 0, null, 1));
insert into r (caso, ok) values
  ('caso 19a: cerrar el viaje (admin): estado cerrado, revision +1, evento cambiar_estado',
    pg_temp.good('v_cerrar') and pg_temp.rk('v_cerrar') ->> 'estado' = 'cerrado'
    and (select count(*) from compra_agrupador_eventos where viaje_id = pg_temp.kk('V1') and accion = 'cambiar_estado') >= 1),
  ('caso 19a: con el viaje cerrado, asignarle una compra se aplica con el aviso viaje_cerrado',
    pg_temp.good('av_cerrado') and pg_temp.rk('av_cerrado') -> 'avisos' -> 0 ->> 'codigo' = 'viaje_cerrado'
    and (select viaje_id = pg_temp.kk('V1') from compras where id = pg_temp.kk('cB'))),
  ('caso 19a: crear un embarque de un viaje cerrado se aplica con el aviso viaje_cerrado',
    pg_temp.good('e_cerrado') and pg_temp.rk('e_cerrado') -> 'avisos' -> 0 ->> 'codigo' = 'viaje_cerrado'),
  ('reabrir un viaje cerrado: abierto; reabrir uno abierto: transicion_invalida; revision vieja: agrupador_cambio',
    pg_temp.good('v_reabrir') and pg_temp.rk('v_reabrir') ->> 'estado' = 'abierto' and pg_temp.mot('v_reabrir2') = 'transicion_invalida' and pg_temp.mot('v_vieja') = 'agrupador_cambio'),
  ('cancelar un viaje: exige motivo (motivo_requerido) y que no tenga compras ni embarques sin cancelar (tiene_compras)',
    pg_temp.mot('v_cancel_sin') = 'motivo_requerido' and pg_temp.mot('v_cancel_con') = 'tiene_compras');

-- Quitar el viaje de la compra B; un viaje cancelado bloquea.
insert into res values ('av_quitar', pg_temp.r_av(null, pg_temp.cs(array[pg_temp.kk('cB')]), 3));
insert into res values ('v_x', pg_temp.r_gv(jsonb_build_object('nombre', 'Viaje a cancelar', 'fecha_inicio', '2026-08-01', 'responsable_id', pg_temp.id(2)), null, 2));
insert into k select 'Vx', (pg_temp.rk('v_x') ->> 'viaje_id')::uuid;
insert into res values ('v_x_cancel', pg_temp.r_ce('viaje', pg_temp.kk('Vx'), 'cancelar', 0, 'se cancela el viaje', 1));
insert into res values
  ('e_en_cancelado', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque en viaje cancelado', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('Vx'), 'fecha_llegada_estimada', '2026-12-15'), null, 2)),
  ('av_cancelado', pg_temp.r_av(pg_temp.kk('Vx'), pg_temp.cs(array[pg_temp.kk('cB')]), 2)),
  ('v_x_ed', pg_temp.r_gv(jsonb_build_object('id', pg_temp.kk('Vx'), 'nombre', 'X', 'fecha_inicio', '2026-08-01', 'responsable_id', pg_temp.id(2)), 1, 2)),
  ('v_x_reabrir', pg_temp.r_ce('viaje', pg_temp.kk('Vx'), 'reabrir', 1, null, 1));
insert into r (caso, ok) values
  ('quitar el viaje de una compra (p_viaje nulo): viaje_id nulo, revision +1, evento asignar_viaje',
    pg_temp.good('av_quitar') and (select viaje_id is null from compras where id = pg_temp.kk('cB')) and pg_temp.ncev(pg_temp.kk('cB'), 'asignar_viaje') = 2),
  ('un viaje cancelado es inmutable y bloquea: crear embarque o asignar compras da viaje_cancelado; editar, no_editable; reabrir, transicion_invalida',
    pg_temp.good('v_x_cancel') and pg_temp.mot('e_en_cancelado') = 'viaje_cancelado' and pg_temp.mot('av_cancelado') = 'viaje_cancelado'
    and pg_temp.mot('v_x_ed') = 'no_editable' and pg_temp.mot('v_x_reabrir') = 'transicion_invalida');

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. aplicar_movimiento_agrupador: casos 1 a 5, 17 y 18 de la ficha
-- ---------------------------------------------------------------------------------------------------------------------
-- Caso 1: l1 nov 300 -> E1/P1 y dic 200 -> E2. Nada se mueve (mismo mes).
insert into snap values ('revA2', pg_temp.crev(pg_temp.kk('cA'))), ('revE1a', pg_temp.erev(pg_temp.kk('E1')));
insert into res values
  ('m1', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cA')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('l1'), pg_temp.kk('cA'), 300, '2026-11', pg_temp.kk('E1'), pg_temp.kk('P1')))), 2));
insert into res values
  ('m1b', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E2')], array[pg_temp.kk('cA')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('l1'), pg_temp.kk('cA'), 200, '2026-12', pg_temp.kk('E2'), null))), 2));
insert into r (caso, ok) values
  ('caso 1: asignar nov 300 a E1/P1 y dic 200 a E2: ok, nada se mueve (entregas iguales), asignaciones creadas',
    pg_temp.good('m1') and pg_temp.good('m1b')
    and pg_temp.eu(pg_temp.kk('l1'), '2026-11') = 300 and pg_temp.eu(pg_temp.kk('l1'), '2026-12') = 200
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')) = 300
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('E2'), null) = 200),
  ('caso 1 / I5: la revision de la compra sube en 2 (dos movimientos), la del embarque en 1 cada uno, y quedan los eventos asignar_agrupador',
    pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revA2') + 2 and pg_temp.erev(pg_temp.kk('E1')) = pg_temp.sn('revE1a') + 1
    and pg_temp.ncev(pg_temp.kk('cA'), 'asignar_agrupador') = 2
    and pg_temp.naev(pg_temp.kk('E1'), 'asignar') = 1 and pg_temp.naev(pg_temp.kk('E2'), 'asignar') = 1
    and (select jsonb_array_length(compras) = 1 and compras -> 0 ->> 'compra_id' = pg_temp.kk('cA')::text
         from compra_agrupador_eventos where embarque_id = pg_temp.kk('E1') and accion = 'asignar')),
  ('caso 1 / eventos de compras: antes y despues llevan compra_foto || compra_foto_entregas (entregas, repartos, asignaciones)',
    exists (select 1 from compra_eventos
             where compra_id = pg_temp.kk('cA') and accion = 'asignar_agrupador'
               and antes ? 'entregas' and antes ? 'asignaciones' and antes ? 'lineas' and despues ? 'repartos'
               and jsonb_array_length(antes -> 'asignaciones') = 0 and jsonb_array_length(despues -> 'asignaciones') = 1)),
  ('invariantes tras el caso 1: sin desalineadas',
    pg_temp.desal() = 0);

-- Caso 2: C2 (comprador) asigna la compra B (l3, nov 400) a E2 (dic): la entrega pasa a dic, revision +1, evento con el actor C2.
insert into snap values ('revB0', pg_temp.crev(pg_temp.kk('cB')));
insert into res values
  ('m2', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E2')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l3'), '2026-11'), pg_temp.kk('l3'), pg_temp.kk('cB'), 400, '2026-12', pg_temp.kk('E2'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l3'), '2026-11', 0), pg_temp.en(pg_temp.kk('l3'), '2026-12', 400))), 3));
insert into r (caso, ok) values
  ('caso 2: la entrega nov de 400 pasa a dic (nueva, origen embarque), la de nov desaparece y queda asignada a E2',
    pg_temp.good('m2') and pg_temp.eu(pg_temp.kk('l3'), '2026-11') = 0 and pg_temp.eu(pg_temp.kk('l3'), '2026-12') = 400
    and (select origen = 'embarque' from compra_linea_entregas where id = pg_temp.eid(pg_temp.kk('l3'), '2026-12'))
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l3'), '2026-12'), pg_temp.kk('E2'), null) = 400 and pg_temp.sumeu(pg_temp.kk('l3')) = 400 and pg_temp.neu(pg_temp.kk('l3')) = 1),
  ('caso 2: la revision de la compra B sube en 1 y el evento queda a nombre de C2 con motivo',
    pg_temp.crev(pg_temp.kk('cB')) = pg_temp.sn('revB0') + 1
    and (select perfil_id = pg_temp.id(3) and motivo = 'humo 32' from compra_eventos where compra_id = pg_temp.kk('cB') and accion = 'asignar_agrupador' limit 1));

-- Caso 3: C1 cambia la llegada de 261101 al 03-dic: l1 queda en dic 500 con dos asignaciones.
insert into snap values ('revA3', pg_temp.crev(pg_temp.kk('cA')));
insert into res values
  ('dic_antes', jsonb_build_object('id', pg_temp.eid(pg_temp.kk('l1'), '2026-12')));
insert into res values
  ('m3_mal', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E1')]), '2026-12-03'), pg_temp.cda(array[pg_temp.kk('E1')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('l1'), pg_temp.kk('cA'), 300, '2026-12', pg_temp.kk('E1'), pg_temp.kk('P1'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l1'), '2026-11', 0), pg_temp.en(pg_temp.kk('l1'), '2026-12', 999))), 2));
insert into r (caso, ok) values
  ('un plan cuyo estado final no coincide con lo que dejo la base: excepcion AG002 (no se atrapa) y nada escrito (el caso 3 con 999 en vez de 500)',
    pg_temp.rk('m3_mal') ->> 'error' = 'AG002' and pg_temp.eu(pg_temp.kk('l1'), '2026-11') = 300 and pg_temp.eu(pg_temp.kk('l1'), '2026-12') = 200
    and (select fecha_llegada_estimada = date '2026-11-20' from compra_embarques where id = pg_temp.kk('E1'))
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')) = 300);
insert into res values
  ('m3', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E1')]), '2026-12-03'), pg_temp.cda(array[pg_temp.kk('E1')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('l1'), pg_temp.kk('cA'), 300, '2026-12', pg_temp.kk('E1'), pg_temp.kk('P1'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l1'), '2026-11', 0), pg_temp.en(pg_temp.kk('l1'), '2026-12', 500))), 3));
insert into r (caso, ok) values
  ('caso 3: llegada de E1 al 03-dic: l1 queda en dic 500 (la entrega de dic conserva su id), la de nov desaparece, el embarque queda en dic',
    pg_temp.good('m3') and pg_temp.eu(pg_temp.kk('l1'), '2026-11') = 0 and pg_temp.eu(pg_temp.kk('l1'), '2026-12') = 500
    and pg_temp.eid(pg_temp.kk('l1'), '2026-12') = (pg_temp.rk('dic_antes') ->> 'id')::uuid
    and (select fecha_llegada_estimada = date '2026-12-03' and periodo_llegada = date '2026-12-01' from compra_embarques where id = pg_temp.kk('E1'))),
  ('caso 3: dos asignaciones en la entrega de dic (E1/P1 300 y E2 200), Σ asignaciones <= entrega, I3 conserva 500',
    pg_temp.au(pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('E1'), pg_temp.kk('P1')) = 300
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('E2'), null) = 200 and pg_temp.sumeu(pg_temp.kk('l1')) = 500
    and pg_temp.neu(pg_temp.kk('l1')) = 1),
  ('caso 3 / R2: sin desalineadas despues de mover; evento cambiar_fecha con antes y despues del embarque y el motivo',
    pg_temp.desal() = 0 and pg_temp.naev(pg_temp.kk('E1'), 'cambiar_fecha') = 1
    and (select antes ->> 'fecha_llegada_estimada' = '2026-11-20' and despues ->> 'fecha_llegada_estimada' = '2026-12-03' and motivo = 'humo 32'
         from compra_agrupador_eventos where embarque_id = pg_temp.kk('E1') and accion = 'cambiar_fecha')),
  ('caso 3 / I5: la compra A subio su revision y dejo el evento mover_entregas',
    pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revA3') + 1 and pg_temp.ncev(pg_temp.kk('cA'), 'mover_entregas') = 1);

-- Caso 4: devolverla al 18-nov: l1 vuelve a nov 300 · dic 200, y la entrega de dic conserva su id.
insert into res values
  ('m4', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E1')]), '2026-11-18'), pg_temp.cda(array[pg_temp.kk('E1')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('E1'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('l1'), pg_temp.kk('cA'), 300, '2026-11', pg_temp.kk('E1'), pg_temp.kk('P1'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l1'), '2026-11', 300), pg_temp.en(pg_temp.kk('l1'), '2026-12', 200))), 2));
insert into r (caso, ok) values
  ('caso 4: devolver la llegada al 18-nov: l1 vuelve a nov 300 · dic 200 con el mismo id en la entrega de dic',
    pg_temp.good('m4') and pg_temp.eu(pg_temp.kk('l1'), '2026-11') = 300 and pg_temp.eu(pg_temp.kk('l1'), '2026-12') = 200
    and pg_temp.eid(pg_temp.kk('l1'), '2026-12') = (pg_temp.rk('dic_antes') ->> 'id')::uuid
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')) = 300
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('E2'), null) = 200 and pg_temp.desal() = 0);

-- Caso 5: el lote l2: mar 600 -> E3b (270301) y la llegada a abr-27. La entrega de abr (400 + 600 = 1 000) se reparte de nuevo.
insert into res values
  ('m5a', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E3b')]), pg_temp.cda(array[pg_temp.kk('E3b')], array[pg_temp.kk('cA')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 600, '2027-03', pg_temp.kk('E3b'), null))), 2));
insert into snap values ('rep_antes', (select count(*) from compra_linea_repartos));
insert into res values
  ('m5_sin', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E3b')]), '2027-04-10'), pg_temp.cda(array[pg_temp.kk('E3b')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E3b'), null), pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 600, '2027-04', pg_temp.kk('E3b'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-03', 0), pg_temp.en(pg_temp.kk('l2'), '2027-04', 1000))), 2));
insert into r (caso, ok) values
  ('caso 5 (sin vector): el lote movido sin su reparto: reparto_sin_vector y TODO deshecho (la entrega de mar y la fecha del embarque siguen igual)',
    pg_temp.good('m5a') and pg_temp.mot('m5_sin') = 'reparto_sin_vector'
    and pg_temp.eu(pg_temp.kk('l2'), '2027-03') = 600 and pg_temp.eu(pg_temp.kk('l2'), '2027-04') = 400
    and (select fecha_llegada_estimada = date '2027-03-15' from compra_embarques where id = pg_temp.kk('E3b'))
    and (select count(*) from compra_linea_repartos) = pg_temp.sn('rep_antes'));
insert into res values
  ('m5', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E3b')]), '2027-04-10'), pg_temp.cda(array[pg_temp.kk('E3b')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E3b'), null), pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 600, '2027-04', pg_temp.kk('E3b'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-03', 0), pg_temp.en(pg_temp.kk('l2'), '2027-04', 1000)),
      jsonb_build_array(jsonb_build_object('linea_id', pg_temp.kk('l2'), 'periodo', '2027-04', 'filas', jsonb_build_array(
        jsonb_build_object('marca_id', (select m1 from ctx), 'genero_mundo_linea_id', (select gml from ctx), 'equivalencia_id', null, 'unidades', 700, 'reparto_id', null, 'reparto_version', 2, 'temporada', 'invierno', 'error_reparto_pp', null),
        jsonb_build_object('marca_id', (select m2 from ctx), 'genero_mundo_linea_id', (select gml from ctx), 'equivalencia_id', null, 'unidades', 300, 'reparto_id', null, 'reparto_version', 2, 'temporada', 'invierno', 'error_reparto_pp', null))))), 2));
insert into r (caso, ok) values
  ('caso 5: con el reparto, la entrega de abr queda en 1 000 repartida (700 + 300) y la de mar desaparece con su reparto (cascada)',
    pg_temp.good('m5') and pg_temp.eu(pg_temp.kk('l2'), '2027-04') = 1000 and pg_temp.eu(pg_temp.kk('l2'), '2027-03') = 0
    and (select sum(unidades) = 1000 and count(*) = 2 from compra_linea_repartos where entrega_id = pg_temp.eid(pg_temp.kk('l2'), '2027-04'))
    and (select count(*) from compra_linea_repartos where linea_id = pg_temp.kk('l2')) = 2
    and (select temporada = 'invierno' from compra_linea_repartos where entrega_id = pg_temp.eid(pg_temp.kk('l2'), '2027-04') and marca_id = (select m1 from ctx))),
  ('caso 5: la asignacion queda en la entrega de abr (1 000, Σ asignaciones 600 <= 1 000) y sin desalineadas',
    pg_temp.au(pg_temp.eid(pg_temp.kk('l2'), '2027-04'), pg_temp.kk('E3b'), null) = 600 and pg_temp.desal() = 0);

-- Caso 17: asignar a E2 (dic) 300 de una entrega nov de 500 (l5), con 100 sin embarque en dic: quedan nov 200 y dic 400 (300 + 100).
insert into res values
  ('m17', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E2')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 300, '2026-12', pg_temp.kk('E2'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l5'), '2026-11', 200), pg_temp.en(pg_temp.kk('l5'), '2026-12', 400))), 3));
insert into r (caso, ok) values
  ('caso 17: quedan nov 200 y dic 400 (300 en el embarque y 100 sin embarque); Σ de la linea 600',
    pg_temp.good('m17') and pg_temp.eu(pg_temp.kk('l5'), '2026-11') = 200 and pg_temp.eu(pg_temp.kk('l5'), '2026-12') = 400
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('E2'), null) = 300 and pg_temp.sumeu(pg_temp.kk('l5')) = 600);

-- Fusión de asignaciones (R3): 100 de l5 nov -> E1/P2 y después 50 más a la misma clave: una sola fila de 150.
insert into res values
  ('f1', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 100, '2026-11', pg_temp.kk('E1'), pg_temp.kk('P2')))), 2));
insert into res values
  ('f2', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 50, '2026-11', pg_temp.kk('E1'), pg_temp.kk('P2')))), 2));
insert into r (caso, ok) values
  ('R3: dos asignaciones a la misma clave (entrega, embarque, paquete) se suman en UNA fila de 150',
    pg_temp.good('f1') and pg_temp.good('f2') and pg_temp.au(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P2')) = 150
    and (select count(*) from compra_entrega_asignaciones where entrega_id = pg_temp.eid(pg_temp.kk('l5'), '2026-11') and embarque_id = pg_temp.kk('E1')) = 1);

-- Excede la entrega: asignar 100 cuando solo quedan 50 sin asignar (200 - 150).
create temp table fotos (k text primary key, v text);
insert into fotos values ('ex', pg_temp.foto());
insert into res values
  ('m_ex', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 100, '2026-11', pg_temp.kk('E1'), null))), 2));
insert into r (caso, ok) values
  ('I1: asignar mas de lo que hay sin asignar en la entrega: excede_entrega y nada escrito',
    pg_temp.mot('m_ex') = 'excede_entrega' and pg_temp.foto() = (select v from fotos where k = 'ex'));

-- Pasar pendientes: 100 de la fila E1/P2 (150) a E2 (dic): la fila baja a 50, la entrega de nov a 100 y la de dic sube a 500.
insert into res values
  ('pp', pg_temp.r_ap(pg_temp.pl('pasar_pendientes', pg_temp.eb(array[pg_temp.kk('E1'), pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E1'), pg_temp.kk('E2')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P2')), pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 100, '2026-12', pg_temp.kk('E2'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l5'), '2026-11', 100), pg_temp.en(pg_temp.kk('l5'), '2026-12', 500))), 2));
insert into r (caso, ok) values
  ('pasar pendientes: E1/P2 baja a 50, E2 sube a 400 (se suma a su fila), nov 100 y dic 500; sin desalineadas; dos eventos de embarque',
    pg_temp.good('pp') and pg_temp.au(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P2')) = 50
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('E2'), null) = 400
    and pg_temp.eu(pg_temp.kk('l5'), '2026-11') = 100 and pg_temp.eu(pg_temp.kk('l5'), '2026-12') = 500 and pg_temp.desal() = 0
    and pg_temp.naev(pg_temp.kk('E1'), 'pasar_pendientes') = 1 and pg_temp.naev(pg_temp.kk('E2'), 'pasar_pendientes') = 1);

-- Mover a paquete (mismo embarque, no mueve meses): la fila E1/P2 (50) pasa a P1 en el lugar (conserva su id).
insert into res values ('id_fila', jsonb_build_object('id', pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P2'))));
insert into res values
  ('mp', pg_temp.r_ap(pg_temp.pl('mover_a_paquete', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P2')), pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 50, '2026-11', pg_temp.kk('E1'), pg_temp.kk('P1')))), 2));
insert into r (caso, ok) values
  ('mover a paquete: la fila pasa de P2 a P1 conservando su id; las entregas no cambian',
    pg_temp.good('mp') and pg_temp.au(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')) = 50
    and pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')) = (pg_temp.rk('id_fila') ->> 'id')::uuid
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P2')) = 0
    and pg_temp.eu(pg_temp.kk('l5'), '2026-11') = 100 and pg_temp.naev(pg_temp.kk('E1'), 'mover_a_paquete') = 1);

-- Paquete de otro embarque: P1 es de E1, no de E2.
insert into fotos values ('po', pg_temp.foto());
insert into res values
  ('m_po', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E2')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('l5'), pg_temp.kk('cB'), 10, '2026-12', pg_temp.kk('E2'), pg_temp.kk('P1')))), 2));
insert into r (caso, ok) values
  ('R1: asignar a E2 con un paquete de E1: paquete_de_otro_embarque y nada escrito',
    pg_temp.mot('m_po') = 'paquete_de_otro_embarque' and pg_temp.foto() = (select v from fotos where k = 'po'));

-- Mover un paquete a otro embarque: P2 (vacío) recibe 20 u de l5 (nov) en E1, y pasa con ellas a E2 (dic).
insert into res values
  ('mpq0', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 20, '2026-11', pg_temp.kk('E1'), pg_temp.kk('P2')))), 2));
insert into res values ('id_fila2', jsonb_build_object('id', pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P2'))));
insert into res values
  ('mpq', pg_temp.r_ap(pg_temp.pl('mover_paquete', pg_temp.eb(array[pg_temp.kk('E1'), pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E1'), pg_temp.kk('E2')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P2')), pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 20, '2026-12', pg_temp.kk('E2'), pg_temp.kk('P2'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l5'), '2026-11', 80), pg_temp.en(pg_temp.kk('l5'), '2026-12', 520)),
      '[]'::jsonb,
      jsonb_build_object('paquete_a_mover', jsonb_build_object('paquete_id', pg_temp.kk('P2'), 'embarque_destino_id', pg_temp.kk('E2')))), 2));
insert into r (caso, ok) values
  ('mover el paquete P2 a E2: el paquete cambia de embarque (FK compuesta con cascade), su asignacion pasa a la entrega de dic en el lugar (mismo id) y queda alineada',
    pg_temp.good('mpq0') and pg_temp.good('mpq')
    and (select embarque_id = pg_temp.kk('E2') from compra_paquetes where id = pg_temp.kk('P2'))
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('E2'), pg_temp.kk('P2')) = 20
    and pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('E2'), pg_temp.kk('P2')) = (pg_temp.rk('id_fila2') ->> 'id')::uuid
    and pg_temp.eu(pg_temp.kk('l5'), '2026-11') = 80 and pg_temp.eu(pg_temp.kk('l5'), '2026-12') = 520 and pg_temp.desal() = 0
    and (select count(*) from compra_agrupador_eventos where paquete_id = pg_temp.kk('P2') and accion = 'mover_paquete') = 2),
  ('mover el paquete: sin ninguna asignacion en E1/P2 que quede huerfana (la FK compuesta lo arrastra)',
    not exists (select 1 from compra_entrega_asignaciones a join compra_paquetes p on p.id = a.paquete_id where p.embarque_id <> a.embarque_id));

-- Quitar (R12 y B1): la fila de la compra A en E2 (dic 200) queda sin embarque en el mismo mes.
insert into res values
  ('q1', pg_temp.r_ap(pg_temp.pl('quitar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E2')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('l1'), pg_temp.kk('cA'), 200, '2026-12', null, null))), 2));
insert into r (caso, ok) values
  ('quitar del embarque: la asignacion se borra, la entrega de dic de l1 sigue en 200 (sin embarque en el mismo mes)',
    pg_temp.good('q1') and pg_temp.au(pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('E2'), null) = 0 and pg_temp.eu(pg_temp.kk('l1'), '2026-12') = 200
    and pg_temp.naev(pg_temp.kk('E2'), 'quitar') = 1);

-- R5: cambiar la fecha dentro del mismo mes no toca compras ni revisiones; solo el embarque (revision +1, evento cambiar_fecha).
insert into snap values ('revB_r5', pg_temp.crev(pg_temp.kk('cB'))), ('revA_r5', pg_temp.crev(pg_temp.kk('cA'))), ('revE1_r5', pg_temp.erev(pg_temp.kk('E1')));
insert into res values
  ('r5', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E1')]), '2026-11-25'), '[]'::jsonb, '[]'::jsonb), 2));
insert into r (caso, ok) values
  ('R5: cambiar la llegada dentro del mismo mes: ninguna compra cambia de revision ni de evento; el embarque sube su revision y deja el evento',
    pg_temp.good('r5') and pg_temp.crev(pg_temp.kk('cB')) = pg_temp.sn('revB_r5') and pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revA_r5')
    and pg_temp.erev(pg_temp.kk('E1')) = pg_temp.sn('revE1_r5') + 1
    and (select fecha_llegada_estimada = date '2026-11-25' from compra_embarques where id = pg_temp.kk('E1'))
    and jsonb_array_length(pg_temp.rk('r5') -> 'compras') = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. Rechazos que no dejan nada escrito (cada uno con la fotografía antes y después)
-- ---------------------------------------------------------------------------------------------------------------------
-- Caso 18: la línea l6 tiene 24 entregas; mover 5 u a un mes nuevo daría 25: max_entregas.
insert into fotos values ('max', pg_temp.foto());
insert into res values
  ('m18', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E4')]), pg_temp.cda(array[pg_temp.kk('E4')], array[pg_temp.kk('cD')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l6'), '2027-01'), pg_temp.kk('l6'), pg_temp.kk('cD'), 5, '2029-01', pg_temp.kk('E4'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l6'), '2027-01', 5), pg_temp.en(pg_temp.kk('l6'), '2029-01', 5))), 2));
insert into r (caso, ok) values
  ('caso 18: la linea llegaria a 25 entregas: max_entregas y nada escrito (siguen 24 entregas y 240 u)',
    pg_temp.mot('m18') = 'max_entregas' and pg_temp.neu(pg_temp.kk('l6')) = 24 and pg_temp.sumeu(pg_temp.kk('l6')) = 240
    and pg_temp.foto() = (select v from fotos where k = 'max'));

-- Revisiones desfasadas, compra fuera de la lista y pertenencia.
insert into fotos values ('rev', pg_temp.foto());
insert into res values
  ('c_cambio', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]),
      (select jsonb_agg(jsonb_build_object('id', x ->> 'id', 'revision', (x ->> 'revision')::integer + 7)) from jsonb_array_elements(pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')])) x),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 10, '2026-11', pg_temp.kk('E1'), null))), 2)),
  ('e_cambio', pg_temp.r_ap(pg_temp.pl('asignar', jsonb_build_array(jsonb_build_object('id', pg_temp.kk('E1'), 'revision', 999)), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 10, '2026-11', pg_temp.kk('E1'), null))), 2)),
  ('c_falta', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cs(array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 10, '2026-11', pg_temp.kk('E1'), null))), 2)),
  ('no_pert1', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l3'), pg_temp.kk('cB'), 10, '2026-11', pg_temp.kk('E1'), null))), 2)),
  ('no_pert2', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 10, '2026-11', pg_temp.kk('E2'), null))), 2)),
  ('no_pert3', pg_temp.r_ap(pg_temp.pl('quitar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('l5'), pg_temp.kk('cB'), 10, '2026-12', null, null))), 2));
insert into r (caso, ok) values
  ('compra_cambio: una compra con revision distinta de la vista; agrupador_cambio: embarque con revision distinta; ambos sin escribir nada',
    pg_temp.mot('c_cambio') = 'compra_cambio' and pg_temp.mot('e_cambio') = 'agrupador_cambio' and pg_temp.foto() = (select v from fotos where k = 'rev')),
  ('compra_cambio: una compra con asignacion activa en el embarque que no esta en la lista del plan (aparecio despues de la vista previa)',
    pg_temp.mot('c_falta') = 'compra_cambio'),
  ('R23 / no_pertenece: entrega de otra linea, embarque fuera de la lista, asignacion de otro embarque: no_pertenece (IDOR) y nada escrito',
    pg_temp.mot('no_pert1') = 'no_pertenece' and pg_temp.mot('no_pert2') = 'no_pertenece' and pg_temp.mot('no_pert3') = 'no_pertenece'
    and pg_temp.foto() = (select v from fotos where k = 'rev'));

-- Estados: compra no asignable, saldo cerrado, embarque no editable, motivo requerido, salida > llegada nueva.
insert into fotos values ('est', pg_temp.foto());
update compras set estado = 'cancelada', cancelada_at = now() where id = pg_temp.kk('cC');
insert into res values
  ('cna', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cC')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l4'), '2026-11'), pg_temp.kk('l4'), pg_temp.kk('cC'), 10, '2026-11', pg_temp.kk('E1'), null))), 2));
update compras set estado = 'recibida', cancelada_at = now() where id = pg_temp.kk('cC');
insert into res values
  ('sc', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cC')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l4'), '2026-11'), pg_temp.kk('l4'), pg_temp.kk('cC'), 10, '2026-11', pg_temp.kk('E1'), null))), 2));
update compras set estado = 'borrador', cancelada_at = null where id = pg_temp.kk('cC');
update compra_embarques set estado = 'cancelado' where id = pg_temp.kk('E4');
insert into res values
  ('end1', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E4')]), pg_temp.cda(array[pg_temp.kk('E4')], array[pg_temp.kk('cD')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l6'), '2027-01'), pg_temp.kk('l6'), pg_temp.kk('cD'), 5, '2029-01', pg_temp.kk('E4'), null))), 2));
update compra_embarques set estado = 'planificado' where id = pg_temp.kk('E4');
insert into res values
  ('mreq', pg_temp.r_ap(jsonb_set(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E1')]), '2026-11-26'), '[]'::jsonb, '[]'::jsonb), '{motivo}', 'null'::jsonb), 2)),
  ('msal', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E1')]), '2026-10-01'), '[]'::jsonb, '[]'::jsonb), 2));
insert into r (caso, ok) values
  ('compra cancelada: compra_no_asignable; compra con saldo cerrado (recibida con cancelada_at): saldo_cerrado; ambas sin escribir',
    pg_temp.mot('cna') = 'compra_no_asignable' and pg_temp.mot('sc') = 'saldo_cerrado'),
  ('embarque cancelado: asignar da embarque_no_editable (ya no hay asignaciones activas que cambiar)',
    pg_temp.mot('end1') = 'embarque_no_editable'),
  ('cambiar_fecha sin motivo: motivo_requerido; con la salida (28-oct) posterior a la llegada nueva (1-oct): salida_despues_de_llegada',
    pg_temp.mot('mreq') = 'motivo_requerido' and pg_temp.mot('msal') = 'salida_despues_de_llegada');
insert into r (caso, ok) values ('tras los rechazos de estado: nada escrito', pg_temp.foto() = (select v from fotos where k = 'est'));

-- Recepciones vinculadas (08b-2): se simulan con un insert directo. Mover a paquete se permite; quitar, bajar de lo vinculado y cambiar
-- de mes se rechazan; cancelar el embarque da tiene_recepciones.
insert into compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion, origen, asignacion_id)
select pg_temp.kk('l5'), date '2026-11-01', 30, date '2026-11-20', 'manual', pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1'));
insert into fotos values ('rv', pg_temp.foto());
insert into res values
  ('rv_quitar', pg_temp.r_ap(pg_temp.pl('quitar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 50, '2026-11', null, null))), 2)),
  ('rv_bajar', pg_temp.r_ap(pg_temp.pl('quitar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 30, '2026-11', null, null))), 2)),
  ('rv_fecha', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E1')]), '2026-12-05'), pg_temp.cda(array[pg_temp.kk('E1')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 50, '2026-12', pg_temp.kk('E1'), pg_temp.kk('P1'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l5'), '2026-11', 30), pg_temp.en(pg_temp.kk('l5'), '2026-12', 570))), 2)),
  ('rv_cancel', pg_temp.r_ce('embarque', pg_temp.kk('E1'), 'cancelar', pg_temp.erev(pg_temp.kk('E1')), 'cancelar con recepciones', 1));
insert into r (caso, ok) values
  ('R7: con una recepcion vinculada: quitar la asignacion entera da asignacion_con_recepciones; bajarla por debajo de lo vinculado, tambien',
    pg_temp.mot('rv_quitar') = 'asignacion_con_recepciones' and pg_temp.mot('rv_bajar') = 'asignacion_con_recepciones' and pg_temp.foto() = (select v from fotos where k = 'rv')),
  ('R7: cambiar el mes de un embarque con recepciones vinculadas: embarque_con_recepciones; cancelarlo: tiene_recepciones',
    pg_temp.mot('rv_fecha') = 'embarque_con_recepciones' and pg_temp.mot('rv_cancel') = 'tiene_recepciones');
insert into res values
  ('rv_pq', pg_temp.r_ap(pg_temp.pl('mover_a_paquete', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E1'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 50, '2026-11', pg_temp.kk('E1'), null))), 2));
insert into r (caso, ok) values
  ('R7: mover a paquete (sin paquete) SI se permite con recepciones vinculadas y la recepcion sigue vinculada a la misma asignacion',
    pg_temp.good('rv_pq') and (select count(*) from compra_linea_recepciones r join compra_entrega_asignaciones a on a.id = r.asignacion_id
                                  where a.embarque_id = pg_temp.kk('E1') and a.paquete_id is null and r.unidades = 30) = 1);
-- Una recepcion vinculada impide borrar su asignacion (FK restrict); se quita para seguir.
delete from compra_linea_recepciones where asignacion_id is not null;
select public.compra_recalcular_estado(pg_temp.kk('cB'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. cambiar_estado_agrupador: embarque y paquete; caso 7 (cancelar la compra y después el embarque) y caso 8
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('et1', pg_temp.r_ce('embarque', pg_temp.kk('E3b'), 'en_transito', pg_temp.erev(pg_temp.kk('E3b')), null, 2)),
  ('et2', pg_temp.r_ce('embarque', pg_temp.kk('E3b'), 'en_transito', pg_temp.erev(pg_temp.kk('E3b')), null, 2)),
  ('et3', pg_temp.r_ce('embarque', pg_temp.kk('E3b'), 'volver_a_planificado', pg_temp.erev(pg_temp.kk('E3b')), null, 2)),
  ('et_vieja', pg_temp.r_ce('embarque', pg_temp.kk('E3b'), 'en_transito', 0, null, 2)),
  ('pq_cancel_activa', pg_temp.r_ce('paquete', pg_temp.kk('P1'), 'cancelar', pg_temp.erev(pg_temp.kk('E1')), 'no sirve', 1)),
  ('pq_cancel_sin_motivo', pg_temp.r_ce('paquete', pg_temp.kk('P1'), 'cancelar', pg_temp.erev(pg_temp.kk('E1')), null, 1)),
  ('emb_cancel_activa', pg_temp.r_ce('embarque', pg_temp.kk('E2'), 'cancelar', pg_temp.erev(pg_temp.kk('E2')), 'no llega', 1)),
  ('emb_cancel_vacio', pg_temp.r_ce('embarque', pg_temp.kk('E4'), 'cancelar', pg_temp.erev(pg_temp.kk('E4')), 'no se usa', 1)),
  ('emb_cancel_otra', pg_temp.r_ce('embarque', pg_temp.kk('E4'), 'cancelar', pg_temp.erev(pg_temp.kk('E4')), 'otra vez', 1)),
  ('tipo_raro', pg_temp.r_ce('camion', pg_temp.kk('E4'), 'cancelar', 0, 'x', 1));
insert into r (caso, ok) values
  ('embarque: planificado -> en_transito -> planificado; repetir en_transito: transicion_invalida; revision vieja: agrupador_cambio',
    pg_temp.good('et1') and pg_temp.rk('et1') ->> 'estado' = 'en_transito' and pg_temp.mot('et2') = 'transicion_invalida'
    and pg_temp.good('et3') and pg_temp.rk('et3') ->> 'estado' = 'planificado' and pg_temp.mot('et_vieja') = 'agrupador_cambio'),
  ('cancelar un paquete con asignaciones activas: tiene_asignaciones_activas; sin motivo: motivo_requerido',
    pg_temp.mot('pq_cancel_activa') = 'tiene_asignaciones_activas' and pg_temp.mot('pq_cancel_sin_motivo') = 'motivo_requerido'),
  ('cancelar un embarque con asignaciones activas: tiene_asignaciones_activas',
    pg_temp.mot('emb_cancel_activa') = 'tiene_asignaciones_activas'),
  ('cancelar un embarque vacio: cancelado (evento con motivo); cancelarlo otra vez: transicion_invalida; tipo desconocido: transicion_invalida',
    pg_temp.good('emb_cancel_vacio') and pg_temp.mot('emb_cancel_otra') = 'transicion_invalida' and pg_temp.mot('tipo_raro') = 'transicion_invalida'
    and (select motivo = 'no se usa' and despues ->> 'estado' = 'cancelado' from compra_agrupador_eventos where embarque_id = pg_temp.kk('E4') and accion = 'cambiar_estado'));

-- Cancelar un paquete vacío (P3) y su efecto en la revisión del embarque.
insert into res values ('p3', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E3b'), 'nombre', 'Paquete vacio'), pg_temp.erev(pg_temp.kk('E3b')), 2));
insert into k select 'P3', (pg_temp.rk('p3') ->> 'paquete_id')::uuid;
insert into snap values ('revE3b', pg_temp.erev(pg_temp.kk('E3b')));
insert into res values ('pq_cancel', pg_temp.r_ce('paquete', pg_temp.kk('P3'), 'cancelar', pg_temp.erev(pg_temp.kk('E3b')), 'ya no hace falta', 1));
insert into res values ('pq_cancelado_ed', pg_temp.r_gp(jsonb_build_object('id', pg_temp.kk('P3'), 'nombre', 'Editado'), pg_temp.erev(pg_temp.kk('E3b')), 2));
insert into r (caso, ok) values
  ('cancelar un paquete vacio: cancelado y la revision del embarque sube; un paquete cancelado no se edita (no_editable)',
    pg_temp.good('pq_cancel') and (select estado = 'cancelado' from compra_paquetes where id = pg_temp.kk('P3')) and pg_temp.erev(pg_temp.kk('E3b')) = pg_temp.sn('revE3b') + 1
    and pg_temp.mot('pq_cancelado_ed') = 'no_editable');

-- Caso 7: cancelar la compra B (M8) deja sus asignaciones históricas; entonces E2 ya no tiene activas y se cancela.
update compras set estado = 'cancelada', cancelada_at = now() where id = pg_temp.kk('cB');
insert into res values ('c7', pg_temp.r_ce('embarque', pg_temp.kk('E2'), 'cancelar', pg_temp.erev(pg_temp.kk('E2')), 'sin compras', 1));
insert into r (caso, ok) values
  ('caso 7: con la compra B cancelada (asignaciones historicas) el embarque E2 se cancela aunque conserve filas', pg_temp.good('c7') and pg_temp.nasig(pg_temp.kk('E2')) > 0);

-- Caso 8: una línea vuelve a ser activa (se quita la cancelación): la asignación activa en un embarque cancelado se puede quitar.
update compras set estado = 'confirmada', cancelada_at = null where id = pg_temp.kk('cB');
insert into res values
  ('c8', pg_temp.r_ap(pg_temp.pl('quitar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E2')], '{}'),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l3'), '2026-12'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l3'), '2026-12'), pg_temp.kk('l3'), pg_temp.kk('cB'), 400, '2026-12', null, null))), 2)),
  ('c8_asig', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E2')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l3'), '2026-12'), pg_temp.kk('l3'), pg_temp.kk('cB'), 10, '2026-12', pg_temp.kk('E2'), null))), 2));
insert into r (caso, ok) values
  ('caso 8 / B1: quitar del embarque funciona en un embarque cancelado (la asignacion vuelve a quedar sin embarque); asignar a un cancelado: embarque_no_editable',
    pg_temp.good('c8') and pg_temp.au(pg_temp.eid(pg_temp.kk('l3'), '2026-12'), pg_temp.kk('E2'), null) = 0 and pg_temp.eu(pg_temp.kk('l3'), '2026-12') = 400
    and pg_temp.mot('c8_asig') = 'embarque_no_editable');

-- Estado recibido (08b-2): quitar sigue valiendo, asignar no.
update compra_embarques set estado = 'recibido' where id = pg_temp.kk('E1');
insert into res values
  ('rec_asig', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), pg_temp.cda(array[pg_temp.kk('E1')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cB'), 10, '2026-11', pg_temp.kk('E1'), null))), 2)),
  ('rec_pq', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E1'), 'nombre', 'En recibido'), pg_temp.erev(pg_temp.kk('E1')), 2)),
  ('rec_canc', pg_temp.r_ce('embarque', pg_temp.kk('E1'), 'en_transito', pg_temp.erev(pg_temp.kk('E1')), null, 1));
update compra_embarques set estado = 'planificado' where id = pg_temp.kk('E1');
insert into r (caso, ok) values
  ('embarque recibido: asignar da embarque_no_editable, crear un paquete tambien, y en_transito no sale de recibido (transicion_invalida)',
    pg_temp.mot('rec_asig') = 'embarque_no_editable' and pg_temp.mot('rec_pq') = 'embarque_no_editable' and pg_temp.mot('rec_canc') = 'transicion_invalida');

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. importar_agrupadores (caso 19b, 19c): lote completo, todo o nada, aplicar el mismo lote dos veces
-- ---------------------------------------------------------------------------------------------------------------------
-- 2 viajes (uno con codigo 261201 y otro sin codigo), 3 embarques (uno apunta al viaje 261201 del lote, otro a V1 existente y otro local) y
-- 4 paquetes (por codigo del embarque del lote y por id de uno existente).
create temp table lote as
select jsonb_build_object(
  'archivo_nombre', 'agrupadores-humo.csv',
  'viajes', jsonb_build_array(
    jsonb_build_object('fila', 2, 'codigo', '261201', 'nombre', 'Viaje diciembre', 'destino', 'Lima', 'fecha_inicio', '2026-12-01', 'fecha_fin', '2026-12-10', 'responsable_id', pg_temp.id(2), 'nota', null),
    jsonb_build_object('fila', 3, 'codigo', null, 'nombre', 'Viaje sin codigo', 'destino', null, 'fecha_inicio', '2026-12-15', 'fecha_fin', null, 'responsable_id', pg_temp.id(1), 'nota', 'sin codigo')),
  'embarques', jsonb_build_array(
    jsonb_build_object('fila', 4, 'codigo', 'IMP-A', 'nombre', 'Embarque A', 'tipo', 'importacion', 'viaje_id', null, 'viaje_codigo', '261201', 'responsable_id', null, 'referencia_logistica', 'BL-9', 'puerto_embarque', 'Puerto Sur', 'fecha_salida_estimada', '2026-12-05', 'fecha_llegada_estimada', '2027-01-10', 'nota', null),
    jsonb_build_object('fila', 5, 'codigo', null, 'nombre', 'Embarque B sin codigo', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V1'), 'viaje_codigo', null, 'responsable_id', pg_temp.id(3), 'referencia_logistica', null, 'puerto_embarque', null, 'fecha_salida_estimada', null, 'fecha_llegada_estimada', '2027-02-10', 'nota', null),
    jsonb_build_object('fila', 6, 'codigo', null, 'nombre', 'Embarque local', 'tipo', 'local', 'viaje_id', null, 'viaje_codigo', null, 'responsable_id', pg_temp.id(2), 'referencia_logistica', null, 'puerto_embarque', null, 'fecha_salida_estimada', null, 'fecha_llegada_estimada', '2027-02-12', 'nota', null)),
  'paquetes', jsonb_build_array(
    jsonb_build_object('fila', 7, 'codigo', 'PAQ-A1', 'nombre', 'Paquete A1', 'embarque_id', null, 'embarque_codigo', 'IMP-A', 'responsable_id', null, 'nota', null),
    jsonb_build_object('fila', 8, 'codigo', null, 'nombre', 'Paquete A2', 'embarque_id', null, 'embarque_codigo', 'IMP-A', 'responsable_id', pg_temp.id(2), 'nota', null),
    jsonb_build_object('fila', 9, 'codigo', null, 'nombre', 'Paquete en E3b', 'embarque_id', pg_temp.kk('E3b'), 'embarque_codigo', null, 'responsable_id', null, 'nota', null),
    jsonb_build_object('fila', 10, 'codigo', null, 'nombre', 'Paquete en Eauto', 'embarque_id', pg_temp.kk('Eauto'), 'embarque_codigo', null, 'responsable_id', null, 'nota', null))
) as lote;

insert into snap values ('nv', (select count(*) from compra_viajes)), ('ne', (select count(*) from compra_embarques)), ('np', (select count(*) from compra_paquetes)), ('nev', (select count(*) from compra_agrupador_eventos));
insert into res select 'i1', pg_temp.r_im(lote, 2) from lote;
insert into r (caso, ok) values
  ('caso 19b: importar el lote crea 2 viajes, 3 embarques y 4 paquetes en una transaccion (9 creados)',
    pg_temp.good('i1') and jsonb_array_length(pg_temp.rk('i1') -> 'creados') = 9
    and (select count(*) from compra_viajes) = pg_temp.sn('nv') + 2 and (select count(*) from compra_embarques) = pg_temp.sn('ne') + 3
    and (select count(*) from compra_paquetes) = pg_temp.sn('np') + 4),
  ('caso 19b: el viaje sin codigo se numera 261202 (el 261201 escrito ocupa su correlativo y el maximo manda) y devuelve su fila',
    (select c ->> 'codigo' = '261201' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'viaje' and (c ->> 'fila')::integer = 2)
    and (select c ->> 'codigo' = '261202' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'viaje' and (c ->> 'fila')::integer = 3)),
  ('embarques: IMP-A escrito; el B (nov-26 no: feb-27) sin codigo recibe 270201 y el local 270202, en orden de fila',
    (select c ->> 'codigo' = 'IMP-A' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'embarque' and (c ->> 'fila')::integer = 4)
    and (select c ->> 'codigo' = '270201' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'embarque' and (c ->> 'fila')::integer = 5)
    and (select c ->> 'codigo' = '270202' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'embarque' and (c ->> 'fila')::integer = 6)),
  ('paquetes: PAQ-A1 escrito; los sin codigo toman el mes del embarque (IMP-A: 2701 -> 270101; E3b: 2704 -> 270402 porque su paquete vacio ya tiene 270401; Eauto: 2611 -> 261103, el maximo mas uno)',
    (select c ->> 'codigo' = 'PAQ-A1' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'paquete' and (c ->> 'fila')::integer = 7)
    and (select c ->> 'codigo' = '270101' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'paquete' and (c ->> 'fila')::integer = 8)
    and (select c ->> 'codigo' = '270402' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'paquete' and (c ->> 'fila')::integer = 9)
    and (select c ->> 'codigo' = '261103' from jsonb_array_elements(pg_temp.rk('i1') -> 'creados') c where c ->> 'tipo' = 'paquete' and (c ->> 'fila')::integer = 10)),
  ('referencias: el embarque IMP-A cuelga del viaje 261201 del lote; el B, de V1; el local, sin viaje; los paquetes del embarque correcto',
    (select b.viaje_id = (select id from compra_viajes where codigo = '261201') from compra_embarques b where b.codigo = 'IMP-A')
    and (select b.viaje_id = pg_temp.kk('V1') and b.responsable_id = pg_temp.id(3) from compra_embarques b where b.codigo = '270201')
    and (select b.viaje_id is null and b.tipo = 'local' from compra_embarques b where b.codigo = '270202')
    and (select p.embarque_id = (select id from compra_embarques where codigo = 'IMP-A') from compra_paquetes p where p.codigo = '270101')
    and (select p.embarque_id = pg_temp.kk('E3b') from compra_paquetes p where p.codigo = '270401')),
  ('un evento crear por agrupador con motivo «Importado de agrupadores-humo.csv»',
    (select count(*) from compra_agrupador_eventos) = pg_temp.sn('nev') + 9
    and (select count(*) from compra_agrupador_eventos where accion = 'crear' and motivo = 'Importado de agrupadores-humo.csv') = 9);

-- Aplicar el MISMO lote otra vez: todas las claves existen y NO se duplica nada (clave_existente; la API responde vuelve_a_previsualizar).
insert into snap values ('nv2', (select count(*) from compra_viajes)), ('ne2', (select count(*) from compra_embarques)), ('np2', (select count(*) from compra_paquetes)), ('nev2', (select count(*) from compra_agrupador_eventos));
insert into res select 'i2', pg_temp.r_im(lote, 2) from lote;
insert into r (caso, ok) values
  ('aplicar el mismo lote dos veces: la segunda da clave_existente (con el tipo y la fila) y no duplica ni un viaje, embarque, paquete o evento',
    pg_temp.mot('i2') = 'clave_existente' and pg_temp.rk('i2') ->> 'tipo' = 'viaje'
    and (select count(*) from compra_viajes) = pg_temp.sn('nv2') and (select count(*) from compra_embarques) = pg_temp.sn('ne2')
    and (select count(*) from compra_paquetes) = pg_temp.sn('np2') and (select count(*) from compra_agrupador_eventos) = pg_temp.sn('nev2'));

-- Clave natural (sin código): mismo nombre y fecha que uno existente.
insert into res values
  ('i_nat', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', null, 'nombre', '  viaje   SIN codigo ', 'destino', null, 'fecha_inicio', '2026-12-15', 'fecha_fin', null, 'responsable_id', pg_temp.id(2), 'nota', null)),
     'embarques', '[]'::jsonb, 'paquetes', '[]'::jsonb), 2)),
  ('i_nat_e', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', '[]'::jsonb, 'embarques', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', null, 'nombre', 'embarque b sin codigo', 'tipo', 'importacion', 'viaje_id', null, 'viaje_codigo', null, 'responsable_id', null, 'referencia_logistica', null, 'puerto_embarque', null, 'fecha_salida_estimada', null, 'fecha_llegada_estimada', '2027-02-10', 'nota', null)),
     'paquetes', '[]'::jsonb), 2)),
  ('i_nat_p', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', '[]'::jsonb, 'embarques', '[]'::jsonb, 'paquetes', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', null, 'nombre', 'PAQUETE A2', 'embarque_id', null, 'embarque_codigo', 'IMP-A', 'responsable_id', null, 'nota', null))), 2));
insert into r (caso, ok) values
  ('clave natural: viaje (nombre y fecha de inicio), embarque (nombre y llegada) y paquete (embarque y nombre) existentes dan clave_existente sin distinguir mayusculas ni espacios',
    pg_temp.mot('i_nat') = 'clave_existente' and pg_temp.mot('i_nat_e') = 'clave_existente' and pg_temp.mot('i_nat_p') = 'clave_existente');

-- Todo o nada: una fila buena y otra mala (responsable planner) no crean nada, ni la buena.
insert into snap values ('nv3', (select count(*) from compra_viajes)), ('nev3', (select count(*) from compra_agrupador_eventos));
insert into res values
  ('i_tn', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', null, 'nombre', 'Viaje bueno', 'destino', null, 'fecha_inicio', '2028-01-10', 'fecha_fin', null, 'responsable_id', pg_temp.id(2), 'nota', null),
     jsonb_build_object('fila', 3, 'codigo', null, 'nombre', 'Viaje con planner', 'destino', null, 'fecha_inicio', '2028-01-11', 'fecha_fin', null, 'responsable_id', pg_temp.id(5), 'nota', null)),
     'embarques', '[]'::jsonb, 'paquetes', '[]'::jsonb), 2)),
  ('i_cancel', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', '[]'::jsonb, 'embarques', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', null, 'nombre', 'En viaje cancelado', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('Vx'), 'viaje_codigo', null, 'responsable_id', null, 'referencia_logistica', null, 'puerto_embarque', null, 'fecha_salida_estimada', null, 'fecha_llegada_estimada', '2028-02-10', 'nota', null)),
     'paquetes', '[]'::jsonb), 2)),
  ('i_noed', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', '[]'::jsonb, 'embarques', '[]'::jsonb, 'paquetes', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', null, 'nombre', 'En cancelado', 'embarque_id', pg_temp.kk('E4'), 'embarque_codigo', null, 'responsable_id', null, 'nota', null))), 2)),
  ('i_local', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', '[]'::jsonb, 'embarques', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', null, 'nombre', 'Local con viaje', 'tipo', 'local', 'viaje_id', pg_temp.kk('V1'), 'viaje_codigo', null, 'responsable_id', null, 'referencia_logistica', null, 'puerto_embarque', null, 'fecha_salida_estimada', null, 'fecha_llegada_estimada', '2028-02-10', 'nota', null)),
     'paquetes', '[]'::jsonb), 2)),
  ('i_99', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', null, 'nombre', 'Mes agotado', 'destino', null, 'fecha_inicio', '2027-01-25', 'fecha_fin', null, 'responsable_id', pg_temp.id(2), 'nota', null)),
     'embarques', '[]'::jsonb, 'paquetes', '[]'::jsonb), 2)),
  ('i_cod', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', jsonb_build_array(
     jsonb_build_object('fila', 2, 'codigo', 'MAL CODIGO', 'nombre', 'Codigo malo', 'destino', null, 'fecha_inicio', '2028-03-10', 'fecha_fin', null, 'responsable_id', pg_temp.id(2), 'nota', null)),
     'embarques', '[]'::jsonb, 'paquetes', '[]'::jsonb), 2)),
  ('i_vacio', pg_temp.r_im(jsonb_build_object('archivo_nombre', 'x.csv', 'viajes', '[]'::jsonb, 'embarques', '[]'::jsonb, 'paquetes', '[]'::jsonb), 2));
insert into r (caso, ok) values
  ('caso 19c: todo o nada: una fila con responsable planner (responsable_no_asignable, fila 3) deshace tambien la fila buena',
    pg_temp.mot('i_tn') = 'responsable_no_asignable' and (pg_temp.rk('i_tn') ->> 'fila')::integer = 3
    and (select count(*) from compra_viajes) = pg_temp.sn('nv3') and (select count(*) from compra_agrupador_eventos) = pg_temp.sn('nev3')),
  ('importar: embarque bajo un viaje cancelado: viaje_cancelado; paquete en embarque cancelado: embarque_no_editable; local con viaje: local_con_viaje',
    pg_temp.mot('i_cancel') = 'viaje_cancelado' and pg_temp.mot('i_noed') = 'embarque_no_editable' and pg_temp.mot('i_local') = 'local_con_viaje'),
  ('importar: mes con el 99 usado: correlativo_agotado; codigo con caracteres invalidos: codigo_invalido; lote vacio: ok sin crear',
    pg_temp.mot('i_99') = 'correlativo_agotado' and pg_temp.mot('i_cod') = 'codigo_invalido'
    and pg_temp.good('i_vacio') and jsonb_array_length(pg_temp.rk('i_vacio') -> 'creados') = 0);

-- Importar solo crea: no tocó compras, entregas ni asignaciones.
insert into r (caso, ok) values
  ('importar_agrupadores solo crea: las compras y las entregas siguen como estaban (no asigna, no mueve)',
    (select viaje_id is null from compras where id = pg_temp.kk('cB')) and pg_temp.nasig(pg_temp.kk('E3b')) = 1);

-- Medición: 1 000 filas (150 viajes con código, 350 embarques con código que apuntan a un viaje del lote y 500 paquetes sin código).
create temp table lote_grande as
select jsonb_build_object(
  'archivo_nombre', 'grande.csv',
  'viajes', (select jsonb_agg(jsonb_build_object('fila', i + 1, 'codigo', 'TV' || i, 'nombre', 'Viaje grande ' || i, 'destino', 'Lima', 'fecha_inicio', (date '2030-01-01' + (i % 36 || ' month')::interval)::date,
              'fecha_fin', null, 'responsable_id', pg_temp.id(2), 'nota', null)) from generate_series(0, 149) i),
  'embarques', (select jsonb_agg(jsonb_build_object('fila', 200 + i, 'codigo', 'TE' || i, 'nombre', 'Embarque grande ' || i, 'tipo', 'importacion', 'viaje_id', null, 'viaje_codigo', 'TV' || (i % 150),
              'responsable_id', null, 'referencia_logistica', null, 'puerto_embarque', 'Puerto', 'fecha_salida_estimada', null,
              'fecha_llegada_estimada', (date '2030-01-15' + (i % 36 || ' month')::interval)::date, 'nota', null)) from generate_series(0, 349) i),
  'paquetes', (select jsonb_agg(jsonb_build_object('fila', 600 + i, 'codigo', null, 'nombre', 'Paquete grande ' || i, 'embarque_id', null, 'embarque_codigo', 'TE' || (i % 350),
              'responsable_id', null, 'nota', null)) from generate_series(0, 499) i)
) as lote;
create temp table tiempos (k text primary key, ms numeric);
do $$
declare
  t0 timestamptz;
  v jsonb;
begin
  t0 := clock_timestamp();
  v := pg_temp.r_im((select lote from lote_grande), 2);
  insert into res values ('i_grande', v);
  insert into tiempos values ('importar_1000', extract(epoch from clock_timestamp() - t0) * 1000);
end
$$;
insert into r (caso, ok) values
  ('1 000 filas (150 viajes, 350 embarques, 500 paquetes autonumerados) se importan en <= 3 s y crean 1 000 agrupadores',
    pg_temp.good('i_grande') and jsonb_array_length(pg_temp.rk('i_grande') -> 'creados') = 1000 and (select ms from tiempos where k = 'importar_1000') <= 3000);
select 'importar 1 000 filas: ' || round(ms) || ' ms' as medicion from tiempos where k = 'importar_1000';

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. Lectura de ayudantes y I2 global
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('agrupador_responsable_asignable: comprador y admin activos si; planner e inactivo no',
    public.agrupador_responsable_asignable(pg_temp.id(1)) and public.agrupador_responsable_asignable(pg_temp.id(2))
    and not public.agrupador_responsable_asignable(pg_temp.id(5)) and not public.agrupador_responsable_asignable(pg_temp.id(4))),
  ('agrupador_es_activa: confirmada y pendiente si; recibida, cancelada, linea inactiva o completa no',
    public.agrupador_es_activa('confirmada', true, 100, 10, 0) and public.agrupador_es_activa('borrador', true, 100, 0, 0)
    and not public.agrupador_es_activa('recibida', true, 100, 100, 0) and not public.agrupador_es_activa('cancelada', true, 100, 0, 0)
    and not public.agrupador_es_activa('confirmada', false, 100, 0, 0) and not public.agrupador_es_activa('confirmada', true, 100, 60, 40)),
  ('compra_foto_entregas: entregas, repartos resumidos por entrega, asignaciones y viaje de la compra A',
    (select jsonb_array_length(f -> 'entregas') = 3 and jsonb_array_length(f -> 'repartos') = 1 and jsonb_array_length(f -> 'asignaciones') >= 2 and f ? 'viaje_id'
       from (select public.compra_foto_entregas(pg_temp.kk('cA')) as f) x)),
  ('agrupadores_desalineados() devuelve 0 filas al final de todo el humo (I2 global)',
    pg_temp.desal() = 0);
-- Una asignación activa que queda desalineada por fuera (se mueve la entrega a mano) aparece en la lista.
update compra_linea_entregas set periodo = date '2026-10-01' where id = pg_temp.eid(pg_temp.kk('l2'), '2027-04');
insert into r (caso, ok) values ('agrupadores_desalineados() detecta una asignacion activa fuera de mes (aviso desalineada)', pg_temp.desal() = 1);
update compra_linea_entregas set periodo = date '2027-04-01' where linea_id = pg_temp.kk('l2') and periodo = date '2026-10-01';

-- ---------------------------------------------------------------------------------------------------------------------
-- 11. Inmutabilidad de los eventos (R17) y FK set null
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('como postgres (dueño): update, delete y truncate de compra_agrupador_eventos los rechaza el trigger',
    pg_temp.falla($t$update public.compra_agrupador_eventos set resumen = 'x'$t$, '%inmutable%')
    and pg_temp.falla($t$delete from public.compra_agrupador_eventos$t$, '%inmutable%')
    and pg_temp.falla($t$truncate public.compra_agrupador_eventos$t$, '%inmutable%')),
  ('como postgres (dueño): update, delete y truncate de compra_eventos tambien (el truncate es el trigger nuevo, M-3)',
    pg_temp.falla($t$update public.compra_eventos set resumen = 'x'$t$, '%inmutable%')
    and pg_temp.falla($t$delete from public.compra_eventos$t$, '%inmutable%')
    and pg_temp.falla($t$truncate public.compra_eventos$t$, '%inmutable%'));
do $$
declare
  v_ok boolean := false;
  v_ok2 boolean := false;
  v_ok3 boolean := false;
  v_ok4 boolean := false;
begin
  set local role service_role;
  begin update public.compra_agrupador_eventos set resumen = 'x'; exception when insufficient_privilege then v_ok := true; end;
  begin delete from public.compra_agrupador_eventos; exception when insufficient_privilege then v_ok2 := true; end;
  begin truncate public.compra_agrupador_eventos; exception when insufficient_privilege then v_ok3 := true; end;
  -- 0035: compra_eventos tambien queda en select e insert, asi que el truncate lo frena el permiso; el trigger por sentencia lo prueba el caso del dueño (arriba).
  begin truncate public.compra_eventos; exception when insufficient_privilege then v_ok4 := true; end;
  reset role;
  insert into r (caso, ok) values
    ('como service_role: update, delete y truncate de compra_agrupador_eventos fallan por permiso (solo select e insert)', v_ok and v_ok2 and v_ok3),
    ('como service_role: truncate de compra_eventos lo rechaza el permiso (desde 0035 solo tiene select e insert)', v_ok4);
exception when others then
  reset role;
  insert into r (caso, ok) values ('service_role e inmutabilidad: prueba sin excepcion (fallo: ' || sqlerrm || ')', false);
end
$$;

-- Borrar un perfil pone NULL en perfil_id de los eventos (la FK set null pasa el trigger) y el historial sobrevive.
do $$
declare
  v_antes bigint;
begin
  select count(*) into v_antes from public.compra_agrupador_eventos where perfil_id = pg_temp.id(5);
  perform 1 from public.compra_agrupador_eventos where perfil_id = pg_temp.id(2);
  delete from public.perfiles where id = pg_temp.id(5);
  insert into r (caso, ok) values
    ('borrar un perfil: sus eventos de agrupadores y de compras quedan con perfil_id NULL (set null) y siguen existiendo',
      (select count(*) from public.compra_agrupador_eventos where perfil_id = pg_temp.id(5)) = 0);
exception when others then
  insert into r (caso, ok) values ('borrar un perfil con eventos: la FK set null debe pasar el trigger (fallo: ' || sqlerrm || ')', false);
end
$$;
do $$
declare
  v_antes bigint;
begin
  select count(*) into v_antes from public.compra_agrupador_eventos where perfil_id = pg_temp.id(2);
  delete from public.perfiles where id = pg_temp.id(2);
  insert into r (caso, ok) values
    ('borrar el perfil de C1 (con muchos eventos y como responsable): los eventos conservan el usuario_nombre y perfil_id queda NULL; el viaje V1 queda sin responsable',
      v_antes > 0 and (select count(*) from public.compra_agrupador_eventos where perfil_id = pg_temp.id(2)) = 0
      and (select responsable_id is null from public.compra_viajes where id = pg_temp.kk('V1'))
      and (select count(*) from public.compra_agrupador_eventos where usuario_nombre = 'Humo 32 2') > 0);
exception when others then
  insert into r (caso, ok) values ('borrar el perfil de C1: la FK set null debe pasar el trigger (fallo: ' || sqlerrm || ')', false);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 12. Permisos de anon y authenticated sobre tablas y funciones
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_anon_t boolean := true; v_auth_t boolean := true;
  v_anon_f boolean := true; v_auth_f boolean := true;
  t text;
  f text;
begin
  foreach t in array array['compra_viajes', 'compra_embarques', 'compra_paquetes', 'compra_entrega_asignaciones', 'compra_agrupador_eventos'] loop
    set local role anon;
    begin execute format('select 1 from public.%I', t); v_anon_t := false; exception when insufficient_privilege then null; end;
    reset role;
    set local role authenticated;
    begin execute format('select 1 from public.%I', t); v_auth_t := false; exception when insufficient_privilege then null; end;
    reset role;
  end loop;
  foreach f in array array[
    'public.guardar_viaje(''{}''::jsonb, null, ''{}''::jsonb)', 'public.guardar_embarque(''{}''::jsonb, null, ''{}''::jsonb)',
    'public.guardar_paquete(''{}''::jsonb, null, ''{}''::jsonb)', 'public.aplicar_movimiento_agrupador(''{}''::jsonb, ''{}''::jsonb)',
    'public.importar_agrupadores(''{}''::jsonb, ''{}''::jsonb)', 'public.asignar_viaje_compras(null, ''[]''::jsonb, ''{}''::jsonb)',
    'public.cambiar_estado_agrupador(''viaje'', gen_random_uuid(), ''cerrar'', 0, null, ''{}''::jsonb)', 'public.agrupadores_desalineados()',
    'public.compra_foto_entregas(gen_random_uuid())', 'public.agrupador_mover_entregas(''[]''::jsonb)'
  ] loop
    set local role anon;
    begin execute 'select ' || f; v_anon_f := false; exception when insufficient_privilege then null; end;
    reset role;
    set local role authenticated;
    begin execute 'select ' || f; v_auth_f := false; exception when insufficient_privilege then null; end;
    reset role;
  end loop;
  insert into r (caso, ok) values
    ('anon y authenticated no leen ninguna de las 5 tablas', v_anon_t and v_auth_t),
    ('anon y authenticated no ejecutan ninguna de las funciones de agrupadores', v_anon_f and v_auth_f);
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
