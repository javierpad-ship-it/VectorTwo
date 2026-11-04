-- Humo SQL de la migración 0034 (correcciones de 08b-1 tras QA y seguridad; solo funciones):
--   * `importar_compra` (A1/A2): un actor restringido (clave `restringido: true` en `p_actor`, o perfil con rol comprador) solo agrega a
--     una compra existente si está en `borrador` y es suya; si no, `compra_no_borrador` sin escribir nada. Admin y planner siguen
--     agregando a cualquier compra viva. Cancelada y saldo cerrado conservan su regla;
--   * `aplicar_movimiento_agrupador` (M1): bloquea y compara la revisión de las 200 compras del plan, pero solo sube revisión y deja
--     evento en la compra cuyas entregas o asignaciones cambiaron; si cambian todas (cambiar el mes de llegada), suben todas;
--   * `asignar_viaje_compras` (B2): un id repetido en `p_compras` no da `compra_cambio` y la compra se procesa una vez;
--   * `asignar_viaje_compras` (B3): mover una compra del viaje A al B deja evento en A y en B;
--   * las 3 funciones: security invoker, search_path vacío, solo service_role, sin `--` en el cuerpo.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0034.sql"
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
create temp table snap (k text primary key, v bigint);
create temp table tmr (k text primary key, ms numeric);

create or replace function pg_temp.id(n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;
-- Actor: `a` es el perfil; `restr` pone la clave `restringido` (null = no la manda).
create or replace function pg_temp.act(n integer, restr boolean default null) returns jsonb language sql as $f$
  select jsonb_build_object('perfil_id', pg_temp.id(n), 'nombre', 'Humo 34 ' || n)
         || case when restr is null then '{}'::jsonb else jsonb_build_object('restringido', restr) end $f$;
create or replace function pg_temp.kk(n text) returns uuid language sql as $f$ select v from k where k.n = $1 $f$;
create or replace function pg_temp.rk(n text) returns jsonb language sql as $f$ select v from res where res.k = $1 $f$;
create or replace function pg_temp.sn(n text) returns bigint language sql as $f$ select v from snap where snap.k = $1 $f$;
create or replace function pg_temp.good(n text) returns boolean language sql as $f$
  select coalesce((v ->> 'ok')::boolean, false) from res where res.k = $1 $f$;
create or replace function pg_temp.mot(n text) returns text language sql as $f$
  select coalesce(v ->> 'motivo', 'ERR:' || coalesce(v ->> 'error', '?') || ' ' || coalesce(v ->> 'msg', '')) from res where res.k = $1 $f$;
create or replace function pg_temp.crev(c uuid) returns integer language sql as $f$ select revision from public.compras where id = c $f$;
create or replace function pg_temp.erev(e uuid) returns integer language sql as $f$ select revision from public.compra_embarques where id = e $f$;
create or replace function pg_temp.nlin(c uuid) returns integer language sql as $f$ select count(*)::integer from public.compra_lineas where compra_id = c $f$;
create or replace function pg_temp.ncev(c uuid, acc text) returns integer language sql as $f$
  select count(*)::integer from public.compra_eventos where compra_id = c and accion = acc $f$;
create or replace function pg_temp.eid(l uuid, per text) returns uuid language sql as $f$
  select id from public.compra_linea_entregas where linea_id = l and periodo = (per || '-01')::date $f$;
create or replace function pg_temp.desal() returns integer language sql as $f$
  select count(*)::integer from public.agrupadores_desalineados() $f$;
-- Fotografía de lo que un rechazo no debe tocar: compras, líneas, entregas, eventos, asignaciones y proveedores.
create or replace function pg_temp.foto() returns text language sql as $f$
  select md5(
    coalesce((select string_agg(c.id::text || ':' || c.revision || ':' || c.estado, ',' order by c.id) from public.compras c), '') || '|' ||
    coalesce((select string_agg(l.id::text || ':' || l.unidades, ',' order by l.id) from public.compra_lineas l), '') || '|' ||
    coalesce((select string_agg(e.id::text || ':' || e.unidades, ',' order by e.id) from public.compra_linea_entregas e), '') || '|' ||
    coalesce((select string_agg(a.id::text || ':' || a.entrega_id || ':' || a.embarque_id || ':' || a.unidades, ',' order by a.id) from public.compra_entrega_asignaciones a), '') || '|' ||
    (select count(*) from public.compra_eventos) || '|' || (select count(*) from public.compra_agrupador_eventos) || '|' ||
    (select count(*) from public.proveedores) || '|' || (select count(*) from public.compra_linea_repartos)
  ) $f$;

-- Llamadas con el rol de la API. Devuelven el jsonb de la función o { error, msg } si lanzó una excepción.
create or replace function pg_temp.r_ic(p jsonb, a jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.importar_compra(p, a);
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

-- Constructores del plan (imitan a `PlanAplicable` de TypeScript; ver humo-0032).
create or replace function pg_temp.cs(ids uuid[]) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'revision', c.revision) order by c.id), '[]'::jsonb)
    from public.compras c where c.id = any (ids) $f$;
create or replace function pg_temp.eb(ids uuid[]) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'revision', e.revision) order by e.id), '[]'::jsonb)
    from public.compra_embarques e where e.id = any (ids) $f$;
-- Compras con asignación ACTIVA en los embarques, más las `extra` (lo que arma `comprasAfectadas`).
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
create or replace function pg_temp.pl(op text, emb jsonb, comp jsonb, movs jsonb, ents jsonb default '[]'::jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('operacion', op, 'accion', op, 'motivo', 'humo 34', 'resumen', 'humo 34 ' || op, 'embarques', emb,
           'paquete_a_mover', null, 'compras', comp, 'movimientos', movs, 'entregas', ents, 'repartos', '[]'::jsonb) $f$;
create or replace function pg_temp.conf(emb jsonb, fecha text) returns jsonb language sql as $f$
  select jsonb_set(emb, '{0,fecha_llegada_estimada}', to_jsonb(fecha)) $f$;
-- Carga útil de importar_compra: una línea específica de `u` unidades en dic-2026 con una clave nueva.
create or replace function pg_temp.imp(ref text, clave text, u integer default 10) returns jsonb language sql as $f$
  select jsonb_build_object('proveedor_nombre', 'FERIA SUR H34', 'referencia', ref, 'fecha_compra', '2026-10-01', 'moneda', 'PEN',
    'estado', 'borrador', 'origen', 'comprador',
    'lineas', jsonb_build_array(jsonb_build_object('clave_importacion', clave, 'tipo', 'especifica',
       'genero_mundo_linea_id', (select id from public.genero_mundo_linea limit 1), 'unidades', u,
       'entregas', jsonb_build_array(jsonb_build_object('periodo', '2026-12-01', 'unidades', u))))) $f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura  [solo lectura: también vale contra producción]
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('las 3 funciones: security invoker, search_path vacio y execute solo para service_role',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('importar_compra', 'aplicar_movimiento_agrupador', 'asignar_viaje_compras')
        and not p.prosecdef
        and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path='))
        and not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and has_function_privilege('service_role', p.oid, 'execute')) = 3),
  ('los cuerpos de las 3 funciones no tienen comentarios -- (el SQL Editor los parsea mal)',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('importar_compra', 'aplicar_movimiento_agrupador', 'asignar_viaje_compras') and p.prosrc like '%--%') = 0),
  ('importar_compra conserva su firma (jsonb, jsonb) y devuelve jsonb; ninguna de las 3 firmas cambio',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.prorettype = 'jsonb'::regtype
        and pg_get_function_identity_arguments(p.oid) in ('p_compra jsonb, p_actor jsonb', 'p_plan jsonb, p_actor jsonb', 'p_viaje uuid, p_compras jsonb, p_actor jsonb')
        and p.proname in ('importar_compra', 'aplicar_movimiento_agrupador', 'asignar_viaje_compras')) = 3);

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  (pg_temp.id(1), 'humo34a@example.invalid'), (pg_temp.id(2), 'humo34p@example.invalid'),
  (pg_temp.id(3), 'humo34c1@example.invalid'), (pg_temp.id(4), 'humo34c2@example.invalid');
insert into perfiles (id, email, nombre, rol, activo) values
  (pg_temp.id(1), 'humo34a@example.invalid', 'Humo 34 A', 'admin', true),
  (pg_temp.id(2), 'humo34p@example.invalid', 'Humo 34 P', 'planner', true),
  (pg_temp.id(3), 'humo34c1@example.invalid', 'Humo 34 C1', 'comprador', true),
  (pg_temp.id(4), 'humo34c2@example.invalid', 'Humo 34 C2', 'comprador', true);

insert into proveedores (nombre) values ('FERIA SUR H34');
insert into generos (codigo, nombre) values ('H34H', 'HOMBRE H34');
insert into mundos (codigo, nombre) values ('H34U', 'URBANO H34');
insert into lineas (codigo, nombre, temporada) values ('H34L1', 'LINEA UNO H34', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML' from lineas l, generos g, mundos mu where l.codigo = 'H34L1' and g.codigo = 'H34H' and mu.codigo = 'H34U';

create temp table ctx as
select (select id from genero_mundo_linea limit 1) as gml, (select id from proveedores where nombre = 'FERIA SUR H34') as p1;

-- Compras de la sección 2 (misma referencia de proveedor FERIA SUR H34, una por caso):
--   R-CONF  confirmada de carga inicial (dueña: el admin)      R-C1  borrador de C1      R-C2  borrador de C2
--   R-HUER  borrador sin dueño (perfil borrado)                R-PLAN borrador del planner
--   R-CANC y R-CANC2  canceladas (se ignoran y se crea una nueva)          R-SALDO recibida con saldo cerrado (cancelada_at)
insert into compras (id, proveedor_id, origen, estado, fecha_compra, referencia, confirmada_at, perfil_id, cancelada_at)
select pg_temp.id(v.n), c.p1, v.origen, v.estado, date '2026-09-10', v.ref, case when v.estado = 'borrador' then null else now() end, v.perfil,
       case when v.ref = 'R-SALDO' then now() else null end
  from ctx c,
  (values (8001, 'carga_inicial', 'confirmada', 'R-CONF', pg_temp.id(1)), (8002, 'comprador', 'borrador', 'R-C1', pg_temp.id(3)),
          (8003, 'comprador', 'borrador', 'R-C2', pg_temp.id(4)), (8004, 'comprador', 'borrador', 'R-HUER', null::uuid),
          (8005, 'comprador', 'borrador', 'R-PLAN', pg_temp.id(2)), (8006, 'comprador', 'cancelada', 'R-CANC', pg_temp.id(3)),
          (8007, 'carga_inicial', 'recibida', 'R-SALDO', pg_temp.id(1)), (8008, 'comprador', 'cancelada', 'R-CANC2', pg_temp.id(3))) as v(n, origen, estado, ref, perfil);
insert into compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, unidades, llegada_periodo, costo_unitario)
select pg_temp.id(8100 + (n - 8000)), pg_temp.id(n), 'especifica', c.gml, 100, date '2026-11-01', 10 from ctx c, generate_series(8001, 8008) n;
insert into compra_linea_entregas (linea_id, periodo, unidades, origen)
select pg_temp.id(8100 + (n - 8000)), date '2026-11-01', 100, 'manual' from generate_series(8001, 8008) n;
update compra_lineas set unidades_recibidas = 100 where id = pg_temp.id(8107);
insert into k select 'c' || (n - 8000), pg_temp.id(n) from generate_series(8001, 8008) n;

insert into r (caso, ok) values
  ('fixture: 8 compras con una linea y una entrega cada una',
    (select count(*) from compras where id in (select v from k where n like 'c%')) = 8 and (select count(*) from compra_linea_entregas) = 8);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. importar_compra: el comprador solo agrega a su propio borrador (A1/A2)
-- ---------------------------------------------------------------------------------------------------------------------
-- 2.1 Comprador (clave restringido = true) + compra confirmada de carga inicial: rechazo y NADA escrito.
insert into snap values ('f0', 0);
create temp table fotos (k text primary key, v text);
insert into fotos values ('f0', pg_temp.foto());
insert into res values ('ic_conf', pg_temp.r_ic(pg_temp.imp('R-CONF', 'H34-001'), pg_temp.act(3, true)));
insert into fotos values ('f1', pg_temp.foto());
-- 2.2 Comprador + borrador ajeno (de C2).
insert into res values ('ic_ajeno', pg_temp.r_ic(pg_temp.imp('R-C2', 'H34-002'), pg_temp.act(3, true)));
insert into fotos values ('f2', pg_temp.foto());
-- 2.3 Comprador SIN la clave en el actor (el backend la olvida): lo detiene el rol del perfil.
insert into res values ('ic_sin_clave', pg_temp.r_ic(pg_temp.imp('R-CONF', 'H34-003'), pg_temp.act(3)));
insert into fotos values ('f3', pg_temp.foto());
-- 2.4 Comprador con restringido = false explicito: la clave solo puede añadir restriccion, nunca quitarla.
insert into res values ('ic_falso', pg_temp.r_ic(pg_temp.imp('R-C2', 'H34-004'), pg_temp.act(3, false)));
insert into fotos values ('f4', pg_temp.foto());
-- 2.5 Comprador + borrador sin dueño (perfil borrado): se rechaza.
insert into res values ('ic_huerfano', pg_temp.r_ic(pg_temp.imp('R-HUER', 'H34-005'), pg_temp.act(3, true)));
insert into fotos values ('f5', pg_temp.foto());
-- 2.6 La clave restringido = true en un perfil admin tambien restringe (el backend decide, no solo el rol).
insert into res values ('ic_admin_restr', pg_temp.r_ic(pg_temp.imp('R-CONF', 'H34-006'), pg_temp.act(1, true)));
insert into fotos values ('f6', pg_temp.foto());
-- 2.7 Actor sin perfil_id y restringido: no es dueño de nada.
insert into res values ('ic_sin_perfil', pg_temp.r_ic(pg_temp.imp('R-C1', 'H34-007'), jsonb_build_object('nombre', 'anonimo', 'restringido', true)));
insert into fotos values ('f7', pg_temp.foto());

insert into r (caso, ok) values
  ('A1: comprador (restringido) + compra confirmada de carga inicial: ok = false, motivo compra_no_borrador, forma { ok, motivo }',
    not pg_temp.good('ic_conf') and pg_temp.mot('ic_conf') = 'compra_no_borrador' and pg_temp.rk('ic_conf') = '{"ok": false, "motivo": "compra_no_borrador"}'::jsonb),
  ('A1: ... y no escribio nada (compras, lineas, entregas, eventos, proveedores, revisiones iguales)',
    (select v from fotos where k = 'f1') = (select v from fotos where k = 'f0')),
  ('A2: comprador + borrador de otro comprador: compra_no_borrador y nada escrito',
    pg_temp.mot('ic_ajeno') = 'compra_no_borrador' and (select v from fotos where k = 'f2') = (select v from fotos where k = 'f1')),
  ('defensa en profundidad: comprador sin la clave restringido tambien recibe compra_no_borrador (rol del perfil) y nada escrito',
    pg_temp.mot('ic_sin_clave') = 'compra_no_borrador' and (select v from fotos where k = 'f3') = (select v from fotos where k = 'f2')),
  ('comprador con restringido = false sigue restringido (la clave solo anade restriccion)',
    pg_temp.mot('ic_falso') = 'compra_no_borrador' and (select v from fotos where k = 'f4') = (select v from fotos where k = 'f3')),
  ('comprador + borrador sin dueño (perfil_id nulo): compra_no_borrador',
    pg_temp.mot('ic_huerfano') = 'compra_no_borrador' and (select v from fotos where k = 'f5') = (select v from fotos where k = 'f4')),
  ('restringido = true con perfil admin tambien restringe: confirmada ajena rechazada',
    pg_temp.mot('ic_admin_restr') = 'compra_no_borrador' and (select v from fotos where k = 'f6') = (select v from fotos where k = 'f5')),
  ('actor restringido sin perfil_id: ni siquiera su borrador (no es dueño de nada)',
    pg_temp.mot('ic_sin_perfil') = 'compra_no_borrador' and (select v from fotos where k = 'f7') = (select v from fotos where k = 'f6'));

-- 2.8 Comprador + su PROPIO borrador: agrega la linea (revision +1, evento importar, sigue en borrador).
insert into snap values ('revC1', pg_temp.crev(pg_temp.kk('c2'))), ('linC1', pg_temp.nlin(pg_temp.kk('c2')));
insert into res values ('ic_propio', pg_temp.r_ic(pg_temp.imp('R-C1', 'H34-010'), pg_temp.act(3, true)));
insert into r (caso, ok) values
  ('comprador + su propio borrador: ok, no crea compra, agrega la linea, revision +1, sigue en borrador, evento importar',
    pg_temp.good('ic_propio') and not (pg_temp.rk('ic_propio') ->> 'creada')::boolean
    and (pg_temp.rk('ic_propio') ->> 'compra_id')::uuid = pg_temp.kk('c2')
    and pg_temp.nlin(pg_temp.kk('c2')) = pg_temp.sn('linC1') + 1 and pg_temp.crev(pg_temp.kk('c2')) = pg_temp.sn('revC1') + 1
    and pg_temp.rk('ic_propio') ->> 'estado' = 'borrador'
    and pg_temp.ncev(pg_temp.kk('c2'), 'importar') = 1);

-- 2.9 Comprador + referencia nueva: crea SU compra (sin cambios respecto de hoy).
insert into res values ('ic_nueva', pg_temp.r_ic(pg_temp.imp('R-NUEVA-C1', 'H34-011'), pg_temp.act(3, true)));
insert into r (caso, ok) values
  ('comprador + referencia nueva: crea su compra (creada = true, borrador, a su nombre)',
    pg_temp.good('ic_nueva') and (pg_temp.rk('ic_nueva') ->> 'creada')::boolean
    and (select estado = 'borrador' and perfil_id = pg_temp.id(3) from compras where id = (pg_temp.rk('ic_nueva') ->> 'compra_id')::uuid));

-- 2.10 Admin y planner (sin la clave): agregan a CUALQUIER compra viva, como hoy.
insert into snap values ('revConf0', pg_temp.crev(pg_temp.kk('c1'))), ('revAjeno0', pg_temp.crev(pg_temp.kk('c3'))), ('revPlan0', pg_temp.crev(pg_temp.kk('c5')));
insert into res values
  ('ic_adm_conf', pg_temp.r_ic(pg_temp.imp('R-CONF', 'H34-020'), pg_temp.act(1))),
  ('ic_adm_ajeno', pg_temp.r_ic(pg_temp.imp('R-C2', 'H34-021'), pg_temp.act(1, false))),
  ('ic_pla_conf', pg_temp.r_ic(pg_temp.imp('R-CONF', 'H34-022'), pg_temp.act(2))),
  ('ic_pla_ajeno', pg_temp.r_ic(pg_temp.imp('R-C1', 'H34-023'), pg_temp.act(2))),
  ('ic_adm_huer', pg_temp.r_ic(pg_temp.imp('R-HUER', 'H34-024'), pg_temp.act(1)));
insert into r (caso, ok) values
  ('admin agrega a una compra confirmada de carga inicial y a un borrador ajeno (sin restriccion)',
    pg_temp.good('ic_adm_conf') and not (pg_temp.rk('ic_adm_conf') ->> 'creada')::boolean and pg_temp.good('ic_adm_ajeno')
    and not (pg_temp.rk('ic_adm_ajeno') ->> 'creada')::boolean and pg_temp.good('ic_adm_huer')),
  ('planner agrega a una confirmada y a un borrador ajeno (sin restriccion)',
    pg_temp.good('ic_pla_conf') and not (pg_temp.rk('ic_pla_conf') ->> 'creada')::boolean and pg_temp.good('ic_pla_ajeno')
    and not (pg_temp.rk('ic_pla_ajeno') ->> 'creada')::boolean),
  ('admin y planner: la confirmada sube su revision en 2 (dos importaciones) y suma 2 lineas; el borrador de C2 sube 1',
    pg_temp.crev(pg_temp.kk('c1')) = pg_temp.sn('revConf0') + 2 and pg_temp.nlin(pg_temp.kk('c1')) = 3
    and pg_temp.crev(pg_temp.kk('c3')) = pg_temp.sn('revAjeno0') + 1);

-- 2.11 Compra cancelada: se ignora (no se agrega) y se crea una nueva, tambien con el actor restringido.
insert into res values
  ('ic_canc_c1', pg_temp.r_ic(pg_temp.imp('R-CANC', 'H34-030'), pg_temp.act(3, true))),
  ('ic_canc_adm', pg_temp.r_ic(pg_temp.imp('R-CANC2', 'H34-031'), pg_temp.act(1)));
-- 2.12 Saldo cerrado (recibida con cancelada_at): conserva su motivo para todos; va antes que compra_no_borrador.
insert into fotos values ('f8', pg_temp.foto());
insert into res values
  ('ic_saldo_adm', pg_temp.r_ic(pg_temp.imp('R-SALDO', 'H34-032'), pg_temp.act(1))),
  ('ic_saldo_c1', pg_temp.r_ic(pg_temp.imp('R-SALDO', 'H34-033'), pg_temp.act(3, true)));
insert into fotos values ('f9', pg_temp.foto());
insert into r (caso, ok) values
  ('compra cancelada: sigue su regla (se ignora): crea una compra nueva, con comprador restringido y con admin; la cancelada no cambia',
    pg_temp.good('ic_canc_c1') and (pg_temp.rk('ic_canc_c1') ->> 'creada')::boolean and pg_temp.good('ic_canc_adm') and (pg_temp.rk('ic_canc_adm') ->> 'creada')::boolean
    and (pg_temp.rk('ic_canc_c1') ->> 'compra_id')::uuid <> pg_temp.kk('c6') and pg_temp.nlin(pg_temp.kk('c6')) = 1 and pg_temp.crev(pg_temp.kk('c6')) = 0),
  ('saldo cerrado: saldo_cerrado para admin y tambien para el comprador restringido (ese motivo va primero) y nada escrito',
    pg_temp.mot('ic_saldo_adm') = 'saldo_cerrado' and pg_temp.mot('ic_saldo_c1') = 'saldo_cerrado' and (select v from fotos where k = 'f9') = (select v from fotos where k = 'f8'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. aplicar_movimiento_agrupador (M1): 200 compras en un embarque, solo sube la revision de la tocada
-- ---------------------------------------------------------------------------------------------------------------------
-- 200 compras confirmadas (una linea de 100 u en nov-2026, ya asignada entera al embarque E); la compra 1 tiene ademas una segunda
-- linea de 50 u en nov sin asignar. El embarque llega en nov-2026.
insert into res values ('e_m1', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque M1', 'tipo', 'importacion', 'fecha_llegada_estimada', '2026-11-15'), null, 1));
insert into k select 'E', (pg_temp.rk('e_m1') ->> 'embarque_id')::uuid;

insert into compras (id, proveedor_id, origen, estado, fecha_compra, referencia, confirmada_at, perfil_id)
select pg_temp.id(20000 + g), c.p1, 'comprador', 'confirmada', date '2026-09-20', 'M1-' || g, now(), pg_temp.id(3) from ctx c, generate_series(1, 200) g;
insert into compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, unidades, llegada_periodo, costo_unitario)
select pg_temp.id(30000 + g), pg_temp.id(20000 + g), 'especifica', c.gml, 100, date '2026-11-01', 10 from ctx c, generate_series(1, 200) g;
insert into compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, unidades, llegada_periodo, costo_unitario)
select pg_temp.id(31000), pg_temp.id(20001), 'especifica', c.gml, 50, date '2026-11-01', 10 from ctx c;
insert into compra_linea_entregas (linea_id, periodo, unidades, origen)
select pg_temp.id(30000 + g), date '2026-11-01', 100, 'manual' from generate_series(1, 200) g;
insert into compra_linea_entregas (linea_id, periodo, unidades, origen) values (pg_temp.id(31000), date '2026-11-01', 50, 'manual');
insert into compra_entrega_asignaciones (entrega_id, embarque_id, unidades)
select e.id, pg_temp.kk('E'), e.unidades from compra_linea_entregas e where e.linea_id between pg_temp.id(30001) and pg_temp.id(30200);

create temp table m1_antes as select id, revision from compras where id between pg_temp.id(20001) and pg_temp.id(20200);
insert into snap values ('revE0', pg_temp.erev(pg_temp.kk('E')));
insert into r (caso, ok) values
  ('fixture M1: 200 compras con una asignacion activa cada una en el embarque; el plan por defecto las lista todas',
    (select count(*) from compra_entrega_asignaciones where embarque_id = pg_temp.kk('E')) = 200
    and jsonb_array_length(pg_temp.cda(array[pg_temp.kk('E')], array[]::uuid[])) = 200);

-- 3.1 Asignar la linea extra (50 u) de la compra 1: el plan lista las 200 compras, solo la 1 cambia.
insert into snap values ('t0', (extract(epoch from clock_timestamp()) * 1000)::bigint);
insert into res values
  ('m1_asignar', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E')]), pg_temp.cda(array[pg_temp.kk('E')], array[pg_temp.id(20001)]),
      jsonb_build_array(jsonb_build_object('asignacion_id', null, 'entrega_id', pg_temp.eid(pg_temp.id(31000), '2026-11'), 'linea_id', pg_temp.id(31000),
        'compra_id', pg_temp.id(20001), 'unidades', 50,
        'destino', jsonb_build_object('periodo', '2026-11', 'embarque_id', pg_temp.kk('E'), 'paquete_id', null))),
      jsonb_build_array(jsonb_build_object('linea_id', pg_temp.id(31000), 'periodo', '2026-11', 'unidades', 50))), 3));
insert into tmr values ('m1_asignar', (extract(epoch from clock_timestamp()) * 1000) - pg_temp.sn('t0'));

insert into r (caso, ok) values
  ('M1: asignar una linea mas con 200 compras en el plan: ok y el embarque sube 1',
    pg_temp.good('m1_asignar') and pg_temp.erev(pg_temp.kk('E')) = pg_temp.sn('revE0') + 1),
  ('M1: solo la compra tocada sube de revision (+1); las otras 199 conservan la suya',
    (select revision from compras where id = pg_temp.id(20001)) = (select revision from m1_antes where id = pg_temp.id(20001)) + 1
    and (select count(*) from compras c join m1_antes a on a.id = c.id where c.revision <> a.revision) = 1),
  ('M1: la respuesta trae compras = solo la tocada, con su revision nueva',
    jsonb_array_length(pg_temp.rk('m1_asignar') -> 'compras') = 1
    and pg_temp.rk('m1_asignar') -> 'compras' -> 0 ->> 'id' = pg_temp.id(20001)::text
    and (pg_temp.rk('m1_asignar') -> 'compras' -> 0 ->> 'revision')::integer = pg_temp.crev(pg_temp.id(20001))),
  ('M1: un solo evento asignar_agrupador en compra_eventos (el de la tocada) y ninguno en las otras 199',
    (select count(*) from compra_eventos where accion = 'asignar_agrupador' and compra_id between pg_temp.id(20001) and pg_temp.id(20200)) = 1
    and pg_temp.ncev(pg_temp.id(20001), 'asignar_agrupador') = 1),
  ('M1: el evento de la tocada trae antes (1 asignacion) y despues (2) y el del embarque lista solo esa compra',
    exists (select 1 from compra_eventos where compra_id = pg_temp.id(20001) and accion = 'asignar_agrupador'
              and jsonb_array_length(antes -> 'asignaciones') = 1 and jsonb_array_length(despues -> 'asignaciones') = 2 and antes ? 'estado' and despues ? 'estado')
    and (select jsonb_array_length(compras) = 1 and compras -> 0 ->> 'compra_id' = pg_temp.id(20001)::text
           from compra_agrupador_eventos where embarque_id = pg_temp.kk('E') and accion = 'asignar'
           order by created_at desc limit 1)),
  ('M1: invariantes: sin desalineadas',
    pg_temp.desal() = 0);

-- 3.2 Sigue comparando la revision de las 200: si CUALQUIERA cambio (aunque no se toque), compra_cambio y nada escrito.
update compras set revision = revision + 1 where id = pg_temp.id(20150);
insert into fotos values ('m0', pg_temp.foto());
create temp table plan_viejo as
  select pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E')]),
           (select jsonb_agg(case when (x ->> 'id')::uuid = pg_temp.id(20150) then jsonb_set(x, '{revision}', to_jsonb(((x ->> 'revision')::integer - 1))) else x end)
              from jsonb_array_elements(pg_temp.cda(array[pg_temp.kk('E')], array[]::uuid[])) x),
           jsonb_build_array(jsonb_build_object('asignacion_id', (select id from compra_entrega_asignaciones where entrega_id = pg_temp.eid(pg_temp.id(30002), '2026-11')),
             'entrega_id', pg_temp.eid(pg_temp.id(30002), '2026-11'), 'linea_id', pg_temp.id(30002), 'compra_id', pg_temp.id(20002), 'unidades', 100,
             'destino', jsonb_build_object('periodo', '2026-11', 'embarque_id', pg_temp.kk('E'), 'paquete_id', null)))) as p;
insert into res select 'm1_vieja', pg_temp.r_ap((select p from plan_viejo), 3);
insert into fotos values ('m1', pg_temp.foto());
insert into r (caso, ok) values
  ('M1: una compra del plan que NO se toca pero cambio de revision sigue dando compra_cambio, sin escribir nada',
    pg_temp.mot('m1_vieja') = 'compra_cambio' and (select v from fotos where k = 'm1') = (select v from fotos where k = 'm0'));

-- 3.3 Una compra con asignacion activa que falta en la lista del plan: compra_cambio (sigue exigiendo todas).
insert into res values
  ('m1_falta', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E')]),
      (select jsonb_agg(x) from jsonb_array_elements(pg_temp.cda(array[pg_temp.kk('E')], array[pg_temp.id(20001)])) x where (x ->> 'id')::uuid <> pg_temp.id(20199)),
      jsonb_build_array(jsonb_build_object('asignacion_id', (select id from compra_entrega_asignaciones where entrega_id = pg_temp.eid(pg_temp.id(30002), '2026-11')),
        'entrega_id', pg_temp.eid(pg_temp.id(30002), '2026-11'), 'linea_id', pg_temp.id(30002), 'compra_id', pg_temp.id(20002), 'unidades', 100,
        'destino', jsonb_build_object('periodo', '2026-11', 'embarque_id', pg_temp.kk('E'), 'paquete_id', null)))), 3));
insert into r (caso, ok) values
  ('M1: un plan que omite una compra con asignacion activa del embarque: compra_cambio',
    pg_temp.mot('m1_falta') = 'compra_cambio' and (select v from fotos where k = 'm1') = pg_temp.foto());

-- 3.4 Si el movimiento toca a todas (cambiar el mes de llegada de nov a dic), suben las 200 y la respuesta las trae todas.
create temp table m1_antes2 as select id, revision from compras where id between pg_temp.id(20001) and pg_temp.id(20200);
create temp table plan_fecha as
  select pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E')]), '2026-12-10'),
           pg_temp.cda(array[pg_temp.kk('E')], array[]::uuid[]),
           (select jsonb_agg(jsonb_build_object('asignacion_id', a.id, 'entrega_id', a.entrega_id, 'linea_id', e.linea_id, 'compra_id', l.compra_id, 'unidades', a.unidades,
                     'destino', jsonb_build_object('periodo', '2026-12', 'embarque_id', a.embarque_id, 'paquete_id', null)))
              from compra_entrega_asignaciones a join compra_linea_entregas e on e.id = a.entrega_id join compra_lineas l on l.id = e.linea_id
             where a.embarque_id = pg_temp.kk('E')),
           (select jsonb_agg(x) from (
              select jsonb_build_object('linea_id', e.linea_id, 'periodo', '2026-11', 'unidades', 0) as x
                from compra_entrega_asignaciones a join compra_linea_entregas e on e.id = a.entrega_id where a.embarque_id = pg_temp.kk('E')
              union all
              select jsonb_build_object('linea_id', e.linea_id, 'periodo', '2026-12', 'unidades', a.unidades)
                from compra_entrega_asignaciones a join compra_linea_entregas e on e.id = a.entrega_id where a.embarque_id = pg_temp.kk('E')) q)) as p;
insert into res select 'm1_fecha', pg_temp.r_ap((select p from plan_fecha), 3);
insert into r (caso, ok) values
  ('M1: cambiar la llegada a dic mueve las entregas de las 200 compras: ok, todas suben +1 y la respuesta trae 200',
    pg_temp.good('m1_fecha') and jsonb_array_length(pg_temp.rk('m1_fecha') -> 'compras') = 200
    and (select count(*) from compras c join m1_antes2 a on a.id = c.id where c.revision = a.revision + 1) = 200),
  ('M1: 200 eventos mover_entregas (uno por compra) y el evento cambiar_fecha del embarque lista 200 compras',
    (select count(*) from compra_eventos where accion = 'mover_entregas' and compra_id between pg_temp.id(20001) and pg_temp.id(20200)) = 200
    and (select jsonb_array_length(compras) = 200 from compra_agrupador_eventos where embarque_id = pg_temp.kk('E') and accion = 'cambiar_fecha')),
  ('M1: tras mover el mes, sin desalineadas', pg_temp.desal() = 0);

-- 3.5 Mismo mes: la fecha cambia sin tocar entregas y no sube ninguna compra (R5), con 200 compras en el plan.
create temp table m1_antes3 as select id, revision from compras where id between pg_temp.id(20001) and pg_temp.id(20200);
insert into res values
  ('m1_mismo_mes', pg_temp.r_ap(pg_temp.pl('cambiar_fecha', pg_temp.conf(pg_temp.eb(array[pg_temp.kk('E')]), '2026-12-20'), '[]'::jsonb, '[]'::jsonb), 3));
insert into r (caso, ok) values
  ('M1: cambiar la fecha dentro del mismo mes no toca ninguna compra (compras = [])',
    pg_temp.good('m1_mismo_mes') and jsonb_array_length(pg_temp.rk('m1_mismo_mes') -> 'compras') = 0
    and (select count(*) from compras c join m1_antes3 a on a.id = c.id where c.revision <> a.revision) = 0);

-- 3.6 Un movimiento que no cambia nada (mover una asignacion al paquete y embarque en que ya esta) no sube la revision.
insert into snap values ('rev2', pg_temp.crev(pg_temp.id(20002)));
insert into res values
  ('m1_noop', pg_temp.r_ap(pg_temp.pl('mover_a_paquete', pg_temp.eb(array[pg_temp.kk('E')]), pg_temp.cda(array[pg_temp.kk('E')], array[]::uuid[]),
      jsonb_build_array(jsonb_build_object('asignacion_id', (select id from compra_entrega_asignaciones where entrega_id = pg_temp.eid(pg_temp.id(30002), '2026-12')),
        'entrega_id', pg_temp.eid(pg_temp.id(30002), '2026-12'), 'linea_id', pg_temp.id(30002), 'compra_id', pg_temp.id(20002), 'unidades', 100,
        'destino', jsonb_build_object('periodo', '2026-12', 'embarque_id', pg_temp.kk('E'), 'paquete_id', null)))), 3));
insert into r (caso, ok) values
  ('M1: un movimiento que deja todo igual: ok y ninguna compra sube de revision (compras = [])',
    pg_temp.good('m1_noop') and jsonb_array_length(pg_temp.rk('m1_noop') -> 'compras') = 0 and pg_temp.crev(pg_temp.id(20002)) = pg_temp.sn('rev2'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. asignar_viaje_compras: id repetido (B2) y evento en el viaje de origen (B3)
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('vA', pg_temp.r_gv(jsonb_build_object('nombre', 'Viaje A', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(3)), null, 1)),
  ('vB', pg_temp.r_gv(jsonb_build_object('nombre', 'Viaje B', 'fecha_inicio', '2026-10-06', 'responsable_id', pg_temp.id(3)), null, 1));
insert into k select 'VA', (pg_temp.rk('vA') ->> 'viaje_id')::uuid;
insert into k select 'VB', (pg_temp.rk('vB') ->> 'viaje_id')::uuid;

-- B2: la misma compra dos veces (misma revision): se procesa una vez, sin compra_cambio.
insert into snap values ('revD0', pg_temp.crev(pg_temp.id(20010)));
insert into res values
  ('dup', pg_temp.r_av(pg_temp.kk('VA'),
     jsonb_build_array(jsonb_build_object('id', pg_temp.id(20010), 'revision', pg_temp.crev(pg_temp.id(20010))),
                       jsonb_build_object('id', pg_temp.id(20010), 'revision', pg_temp.crev(pg_temp.id(20010))),
                       jsonb_build_object('id', pg_temp.id(20011), 'revision', pg_temp.crev(pg_temp.id(20011)))), 3));
insert into r (caso, ok) values
  ('B2: un id repetido en p_compras no da compra_cambio: ok, la compra sube +1 una sola vez y sale una sola vez en compras',
    pg_temp.good('dup') and pg_temp.crev(pg_temp.id(20010)) = pg_temp.sn('revD0') + 1 and jsonb_array_length(pg_temp.rk('dup') -> 'compras') = 2
    and pg_temp.ncev(pg_temp.id(20010), 'asignar_viaje') = 1
    and (select viaje_id = pg_temp.kk('VA') from compras where id = pg_temp.id(20010))),
  ('B2: el evento del viaje A cuenta 2 compras (no 3)',
    (select count(*) = 1 and bool_and(jsonb_array_length(compras) = 2) from compra_agrupador_eventos where viaje_id = pg_temp.kk('VA') and accion = 'asignar_viaje'));

-- B2: el mismo id con DOS revisiones distintas sigue siendo una vista vencida: compra_cambio y nada escrito.
insert into fotos values ('d0', pg_temp.foto());
insert into res values
  ('dup_rev', pg_temp.r_av(pg_temp.kk('VB'),
     jsonb_build_array(jsonb_build_object('id', pg_temp.id(20012), 'revision', pg_temp.crev(pg_temp.id(20012))),
                       jsonb_build_object('id', pg_temp.id(20012), 'revision', pg_temp.crev(pg_temp.id(20012)) + 1)), 3));
insert into r (caso, ok) values
  ('B2: el mismo id con dos revisiones distintas: compra_cambio y nada escrito',
    pg_temp.mot('dup_rev') = 'compra_cambio' and (select v from fotos where k = 'd0') = pg_temp.foto());

-- B3: mover 20010 y 20011 de A a B: evento en B (entraron) y tambien en A (salieron).
insert into res values
  ('mover_ab', pg_temp.r_av(pg_temp.kk('VB'),
     jsonb_build_array(jsonb_build_object('id', pg_temp.id(20010), 'revision', pg_temp.crev(pg_temp.id(20010))),
                       jsonb_build_object('id', pg_temp.id(20011), 'revision', pg_temp.crev(pg_temp.id(20011))),
                       jsonb_build_object('id', pg_temp.id(20013), 'revision', pg_temp.crev(pg_temp.id(20013)))), 3));
insert into r (caso, ok) values
  ('B3: mover compras del viaje A al B: ok, las 3 quedan en B',
    pg_temp.good('mover_ab') and (select count(*) from compras where id in (pg_temp.id(20010), pg_temp.id(20011), pg_temp.id(20013)) and viaje_id = pg_temp.kk('VB')) = 3),
  ('B3: el viaje B tiene un evento asignar_viaje con las 3 compras (entraron)',
    exists (select 1 from compra_agrupador_eventos where viaje_id = pg_temp.kk('VB') and accion = 'asignar_viaje' and jsonb_array_length(compras) = 3 and resumen like '%asignadas al viaje%')),
  ('B3: el viaje A tambien tiene evento nuevo, con solo las 2 que salieron (la tercera venia sin viaje) y resumen pasadas a otro viaje',
    (select count(*) from compra_agrupador_eventos where viaje_id = pg_temp.kk('VA') and accion = 'asignar_viaje') = 2
    and exists (select 1 from compra_agrupador_eventos where viaje_id = pg_temp.kk('VA') and accion = 'asignar_viaje' and jsonb_array_length(compras) = 2 and resumen like '%pasadas a otro viaje%'));

-- B3: quitar el viaje (p_viaje nulo): un evento por viaje de origen, como antes; el viaje que no tenia compras no recibe evento.
insert into res values
  ('quitar', pg_temp.r_av(null,
     jsonb_build_array(jsonb_build_object('id', pg_temp.id(20010), 'revision', pg_temp.crev(pg_temp.id(20010))),
                       jsonb_build_object('id', pg_temp.id(20013), 'revision', pg_temp.crev(pg_temp.id(20013)))), 3));
insert into r (caso, ok) values
  ('quitar el viaje: un evento en B con las 2 que salieron y resumen sin este viaje; A no recibe otro',
    pg_temp.good('quitar')
    and exists (select 1 from compra_agrupador_eventos where viaje_id = pg_temp.kk('VB') and accion = 'asignar_viaje' and jsonb_array_length(compras) = 2 and resumen like '%sin este viaje%')
    and (select count(*) from compra_agrupador_eventos where viaje_id = pg_temp.kk('VA') and accion = 'asignar_viaje') = 2);

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- tiempo del plan de 200 compras (ms, solo informativo)'
select k, round(ms) as ms from tmr;
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;
