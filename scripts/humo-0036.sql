-- Humo SQL de la migración 0036 (candados de viajes y embarques: `for no key update` en lugar de `for update`; solo funciones):
--   * las 7 funciones (guardar_viaje, guardar_embarque, guardar_paquete, cambiar_estado_agrupador, asignar_viaje_compras,
--     aplicar_movimiento_agrupador, importar_agrupadores): firma intacta, security invoker, search_path vacío, execute solo para
--     service_role, sin `--` en el cuerpo;
--   * el modo de cada candado, leído del cuerpo: viajes y embarques con `for no key update` (cuántos por función) y NINGÚN
--     `for update` sobre compra_viajes o compra_embarques; solo asignar_viaje_compras y aplicar_movimiento_agrupador conservan un
--     `for update`, el de compras;
--   * el registro `0036_candados_viajes` en migraciones_aplicadas;
--   * las 7 funciones siguen haciendo su trabajo de punta a punta (una sola transacción): crear y editar un viaje, un embarque dentro
--     del viaje y un paquete; cambiar el estado de viaje, embarque y paquete; asignar y quitar el viaje de una compra; asignar y quitar
--     una entrega de un embarque que está en un viaje; importar un viaje, un embarque (por código del viaje) y un paquete (por código
--     del embarque). `agrupadores_desalineados()` devuelve 0 filas.
-- Lo que un humo de UNA transacción no puede probar (que dos sesiones no se interbloqueen y que otra sesión pueda tomar `key share`
-- mientras la función tiene el candado) lo prueban tests/integracion/concurrencia.int.test.ts (compuertas con 3 y 4 conexiones y sondas
-- con `nowait`). Los humos 0032 y 0034 siguen probando el comportamiento funcional completo.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0036.sql"
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- Las funciones se llaman con `set local role service_role` (la API corre con ese rol). Todo va dentro de UNA transacción que termina
-- en `rollback`: no deja nada escrito. Datos inventados. Contra PRODUCCIÓN solo vale la sección 1 (por SELECT; el resto inserta datos).
\set ON_ERROR_STOP off
\pset pager off
begin;

-- En Supabase `service_role` tiene BYPASSRLS; el rol de la base local no (ver humo-0032).
alter role service_role bypassrls;

create temp table r (n serial, caso text, ok boolean);
create temp table k (n text primary key, v uuid);
create temp table res (k text primary key, v jsonb);

create or replace function pg_temp.id(n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;
create or replace function pg_temp.act(n integer) returns jsonb language sql as $f$
  select jsonb_build_object('perfil_id', pg_temp.id(n), 'nombre', 'Humo 36 ' || n) $f$;
create or replace function pg_temp.kk(n text) returns uuid language sql as $f$ select v from k where k.n = $1 $f$;
create or replace function pg_temp.rk(n text) returns jsonb language sql as $f$ select v from res where res.k = $1 $f$;
create or replace function pg_temp.good(n text) returns boolean language sql as $f$
  select coalesce((v ->> 'ok')::boolean, false) from res where res.k = $1 $f$;
create or replace function pg_temp.mot(n text) returns text language sql as $f$
  select coalesce(v ->> 'motivo', 'ERR:' || coalesce(v ->> 'error', '?') || ' ' || coalesce(v ->> 'msg', '')) from res where res.k = $1 $f$;
create or replace function pg_temp.crev(c uuid) returns integer language sql as $f$ select revision from public.compras where id = c $f$;
create or replace function pg_temp.erev(e uuid) returns integer language sql as $f$ select revision from public.compra_embarques where id = e $f$;
create or replace function pg_temp.vrev(v uuid) returns integer language sql as $f$ select revision from public.compra_viajes where id = v $f$;

-- Llamada genérica con el rol de la API: ejecuta `select public.<f>(<args>)` y devuelve el jsonb, o { error, msg } si lanzó.
create or replace function pg_temp.llamar(q text) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  execute q into v;
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;

create temp table funcs (nombre text primary key, firma text, no_key integer, for_update integer);
insert into funcs values
  ('guardar_viaje', 'p_viaje jsonb, p_revision integer, p_actor jsonb', 1, 0),
  ('guardar_embarque', 'p_embarque jsonb, p_revision integer, p_actor jsonb', 2, 0),
  ('guardar_paquete', 'p_paquete jsonb, p_revision_embarque integer, p_actor jsonb', 1, 0),
  ('cambiar_estado_agrupador', 'p_tipo text, p_id uuid, p_accion text, p_revision integer, p_motivo text, p_actor jsonb', 3, 0),
  ('asignar_viaje_compras', 'p_viaje uuid, p_compras jsonb, p_actor jsonb', 1, 1),
  ('aplicar_movimiento_agrupador', 'p_plan jsonb, p_actor jsonb', 1, 1),
  ('importar_agrupadores', 'p_lote jsonb, p_actor jsonb', 2, 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura y modo de los candados  [solo lectura: también vale contra producción]
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('las 7 funciones existen con su firma y devuelven jsonb',
    (select count(*) from funcs f join pg_proc p on p.proname = f.nombre and pg_get_function_identity_arguments(p.oid) = f.firma
       join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public' where p.prorettype = 'jsonb'::regtype) = 7),
  ('las 7: security invoker, search_path vacio y execute solo para service_role (ni public, ni anon, ni authenticated)',
    (select count(*) from funcs f join pg_proc p on p.proname = f.nombre and pg_get_function_identity_arguments(p.oid) = f.firma
       join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
      where not p.prosecdef
        and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path='))
        and not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and not has_function_privilege('public', p.oid, 'execute')
        and has_function_privilege('service_role', p.oid, 'execute')) = 7),
  ('los cuerpos de las 7 no tienen comentarios -- (el SQL Editor los parsea mal)',
    (select count(*) from funcs f join pg_proc p on p.proname = f.nombre join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
      where p.prosrc like '%--%') = 0),
  ('cada funcion tiene exactamente los `for no key update` esperados (viajes y embarques)',
    (select count(*) from funcs f join pg_proc p on p.proname = f.nombre join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
      where (select count(*) from regexp_matches(p.prosrc, '\mfor no key update\M', 'g')) = f.no_key) = 7),
  ('solo asignar_viaje_compras y aplicar_movimiento_agrupador conservan un `for update`, y es el de compras',
    (select count(*) from funcs f join pg_proc p on p.proname = f.nombre join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
      where (select count(*) from regexp_matches(p.prosrc, '\mfor update\M', 'g')) = f.for_update) = 7
    and (select p.prosrc ~ 'public\.compras c where c\.id = any \(v_ids\) order by c\.id for update' from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'public' and p.proname = 'asignar_viaje_compras')
    and (select p.prosrc ~ 'public\.compras c where c\.id = any \(v_compra_ids\) order by c\.id for update' from pg_proc p join pg_namespace s on s.oid = p.pronamespace
          where s.nspname = 'public' and p.proname = 'aplicar_movimiento_agrupador')),
  ('ningun `for update` ni `for share` sobre compra_viajes o compra_embarques en ninguna funcion de public',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.prolang = (select oid from pg_language where lanname = 'plpgsql')
        and (p.prosrc ~* 'compra_viajes[^;]*for (update|share)' or p.prosrc ~* 'compra_embarques[^;]*for (update|share)'
             or p.prosrc ~* 'compra_viajes v[^;]*order by v\.id\s+for update' or p.prosrc ~* 'order by (v|b|e)\.id\s+for update')) = 0),
  ('la 0036 quedo registrada en migraciones_aplicadas',
    exists (select 1 from public.migraciones_aplicadas where nombre = '0036_candados_viajes'));

-- Huella de lo que se aplico (informativo; se compara con la base remota).
\echo '--- md5(prosrc) de las 7 funciones (comparar local contra Vector2)'
select f.nombre, md5(p.prosrc) as md5_prosrc
  from funcs f join pg_proc p on p.proname = f.nombre join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
 order by f.nombre;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  (pg_temp.id(1), 'humo36a@example.invalid'), (pg_temp.id(3), 'humo36c1@example.invalid');
insert into perfiles (id, email, nombre, rol, activo) values
  (pg_temp.id(1), 'humo36a@example.invalid', 'Humo 36 A', 'admin', true),
  (pg_temp.id(3), 'humo36c1@example.invalid', 'Humo 36 C1', 'comprador', true);
insert into proveedores (nombre) values ('FERIA SUR H36');
insert into generos (codigo, nombre) values ('H36H', 'HOMBRE H36');
insert into mundos (codigo, nombre) values ('H36U', 'URBANO H36');
insert into lineas (codigo, nombre, temporada) values ('H36L1', 'LINEA UNO H36', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML' from lineas l, generos g, mundos mu where l.codigo = 'H36L1' and g.codigo = 'H36H' and mu.codigo = 'H36U';

-- Una compra confirmada con una linea de 100 unidades y su entrega de noviembre de 2026.
insert into compras (id, proveedor_id, origen, estado, fecha_compra, referencia, confirmada_at, perfil_id)
select pg_temp.id(10001), p.id, 'carga_inicial', 'confirmada', date '2026-09-10', 'H36-1', now(), pg_temp.id(3)
  from proveedores p where p.nombre = 'FERIA SUR H36';
insert into compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, unidades, llegada_periodo, costo_unitario)
select pg_temp.id(20001), pg_temp.id(10001), 'especifica', g.id, 100, date '2026-11-01', 10 from genero_mundo_linea g limit 1;
insert into compra_linea_entregas (linea_id, periodo, unidades, origen) values (pg_temp.id(20001), date '2026-11-01', 100, 'manual');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Las 7 funciones, de punta a punta
-- ---------------------------------------------------------------------------------------------------------------------
-- guardar_viaje: crear y editar.
insert into res values ('v_crear', pg_temp.llamar(format(
  $q$select public.guardar_viaje(%L::jsonb, null, %L::jsonb)$q$,
  jsonb_build_object('nombre', 'Viaje humo 36', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(3)), pg_temp.act(1))));
insert into k values ('V', (pg_temp.rk('v_crear') ->> 'viaje_id')::uuid);
insert into res values ('v_editar', pg_temp.llamar(format(
  $q$select public.guardar_viaje(%L::jsonb, %s, %L::jsonb)$q$,
  jsonb_build_object('id', pg_temp.kk('V'), 'nombre', 'Viaje humo 36 editado', 'fecha_inicio', '2026-10-05', 'responsable_id', pg_temp.id(3)),
  pg_temp.vrev(pg_temp.kk('V')), pg_temp.act(1))));
insert into r (caso, ok) values
  ('guardar_viaje: crea (revision 0) y edita (revision 1, nombre nuevo)',
    pg_temp.good('v_crear') and pg_temp.good('v_editar') and pg_temp.vrev(pg_temp.kk('V')) = 1
    and (select nombre = 'Viaje humo 36 editado' from compra_viajes where id = pg_temp.kk('V')));

-- guardar_embarque: crear dentro del viaje y editar (cambia el nombre; el viaje se bloquea con no key update).
insert into res values ('e_crear', pg_temp.llamar(format(
  $q$select public.guardar_embarque(%L::jsonb, null, %L::jsonb)$q$,
  jsonb_build_object('nombre', 'Embarque humo 36', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V'), 'fecha_llegada_estimada', '2026-11-15'), pg_temp.act(1))));
insert into k values ('E', (pg_temp.rk('e_crear') ->> 'embarque_id')::uuid);
insert into res values ('e_editar', pg_temp.llamar(format(
  $q$select public.guardar_embarque(%L::jsonb, %s, %L::jsonb)$q$,
  jsonb_build_object('id', pg_temp.kk('E'), 'nombre', 'Embarque humo 36 editado', 'tipo', 'importacion', 'viaje_id', pg_temp.kk('V')),
  pg_temp.erev(pg_temp.kk('E')), pg_temp.act(1))));
insert into r (caso, ok) values
  ('guardar_embarque: crea dentro del viaje y edita (revision 1, nombre nuevo, mismo viaje)',
    pg_temp.good('e_crear') and pg_temp.good('e_editar') and pg_temp.erev(pg_temp.kk('E')) = 1
    and (select nombre = 'Embarque humo 36 editado' and viaje_id = pg_temp.kk('V') from compra_embarques where id = pg_temp.kk('E')));

-- guardar_paquete: crear (sube la revision del embarque).
insert into res values ('p_crear', pg_temp.llamar(format(
  $q$select public.guardar_paquete(%L::jsonb, %s, %L::jsonb)$q$,
  jsonb_build_object('embarque_id', pg_temp.kk('E'), 'nombre', 'Paquete humo 36'), pg_temp.erev(pg_temp.kk('E')), pg_temp.act(1))));
insert into k values ('P', (pg_temp.rk('p_crear') ->> 'paquete_id')::uuid);
insert into r (caso, ok) values
  ('guardar_paquete: crea el paquete y sube la revision del embarque a 2',
    pg_temp.good('p_crear') and pg_temp.erev(pg_temp.kk('E')) = 2 and exists (select 1 from compra_paquetes where id = pg_temp.kk('P') and embarque_id = pg_temp.kk('E')));

-- cambiar_estado_agrupador: paquete (cancelar), embarque (en_transito) y viaje (cerrar y reabrir).
insert into res values ('ce_paq', pg_temp.llamar(format(
  $q$select public.cambiar_estado_agrupador('paquete', %L::uuid, 'cancelar', %s, 'humo 36', %L::jsonb)$q$,
  pg_temp.kk('P'), pg_temp.erev(pg_temp.kk('E')), pg_temp.act(1))));
insert into res values ('ce_emb', pg_temp.llamar(format(
  $q$select public.cambiar_estado_agrupador('embarque', %L::uuid, 'en_transito', %s, null, %L::jsonb)$q$,
  pg_temp.kk('E'), pg_temp.erev(pg_temp.kk('E')), pg_temp.act(1))));
insert into res values ('ce_viaje', pg_temp.llamar(format(
  $q$select public.cambiar_estado_agrupador('viaje', %L::uuid, 'cerrar', %s, null, %L::jsonb)$q$,
  pg_temp.kk('V'), pg_temp.vrev(pg_temp.kk('V')), pg_temp.act(1))));
insert into res values ('ce_viaje2', pg_temp.llamar(format(
  $q$select public.cambiar_estado_agrupador('viaje', %L::uuid, 'reabrir', %s, null, %L::jsonb)$q$,
  pg_temp.kk('V'), pg_temp.vrev(pg_temp.kk('V')), pg_temp.act(1))));
insert into r (caso, ok) values
  ('cambiar_estado_agrupador: cancela el paquete, pone el embarque en transito y cierra y reabre el viaje',
    pg_temp.good('ce_paq') and pg_temp.good('ce_emb') and pg_temp.good('ce_viaje') and pg_temp.good('ce_viaje2')
    and (select estado = 'cancelado' from compra_paquetes where id = pg_temp.kk('P'))
    and (select estado = 'en_transito' from compra_embarques where id = pg_temp.kk('E'))
    and (select estado = 'abierto' from compra_viajes where id = pg_temp.kk('V'))),
  ('cambiar_estado_agrupador: dejo un evento cambiar_estado por cada cambio (paquete, embarque, viaje x2)',
    (select count(*) from compra_agrupador_eventos where accion = 'cambiar_estado' and (paquete_id = pg_temp.kk('P') or embarque_id = pg_temp.kk('E') or viaje_id = pg_temp.kk('V'))) >= 4);

-- asignar_viaje_compras: poner el viaje a la compra y quitarlo.
insert into res values ('av_poner', pg_temp.llamar(format(
  $q$select public.asignar_viaje_compras(%L::uuid, %L::jsonb, %L::jsonb)$q$,
  pg_temp.kk('V'), jsonb_build_array(jsonb_build_object('id', pg_temp.id(10001), 'revision', pg_temp.crev(pg_temp.id(10001)))), pg_temp.act(1))));
insert into r (caso, ok) values
  ('asignar_viaje_compras: pone el viaje a la compra (revision +1) y deja su evento asignar_viaje',
    pg_temp.good('av_poner') and pg_temp.crev(pg_temp.id(10001)) = 1
    and (select viaje_id = pg_temp.kk('V') from compras where id = pg_temp.id(10001))
    and exists (select 1 from compra_eventos where compra_id = pg_temp.id(10001) and accion = 'asignar_viaje'));
insert into res values ('av_quitar', pg_temp.llamar(format(
  $q$select public.asignar_viaje_compras(null, %L::jsonb, %L::jsonb)$q$,
  jsonb_build_array(jsonb_build_object('id', pg_temp.id(10001), 'revision', pg_temp.crev(pg_temp.id(10001)))), pg_temp.act(1))));
insert into r (caso, ok) values
  ('asignar_viaje_compras: quita el viaje (revision 2, sin viaje)',
    pg_temp.good('av_quitar') and pg_temp.crev(pg_temp.id(10001)) = 2 and (select viaje_id is null from compras where id = pg_temp.id(10001)));

-- aplicar_movimiento_agrupador: asignar la entrega al embarque (que esta dentro del viaje) y quitarla.
insert into res values ('am_asignar', pg_temp.llamar(format(
  $q$select public.aplicar_movimiento_agrupador(%L::jsonb, %L::jsonb)$q$,
  jsonb_build_object(
    'operacion', 'asignar', 'accion', 'asignar', 'motivo', 'humo 36', 'resumen', 'humo 36 asignar',
    'embarques', (select jsonb_agg(jsonb_build_object('id', e.id, 'revision', e.revision)) from compra_embarques e where e.id = pg_temp.kk('E')),
    'paquete_a_mover', null,
    'compras', jsonb_build_array(jsonb_build_object('id', pg_temp.id(10001), 'revision', pg_temp.crev(pg_temp.id(10001)))),
    'movimientos', jsonb_build_array(jsonb_build_object(
      'asignacion_id', null, 'entrega_id', (select id from compra_linea_entregas where linea_id = pg_temp.id(20001)), 'linea_id', pg_temp.id(20001),
      'compra_id', pg_temp.id(10001), 'unidades', 100,
      'destino', jsonb_build_object('periodo', '2026-11', 'embarque_id', pg_temp.kk('E'), 'paquete_id', null))),
    'entregas', jsonb_build_array(jsonb_build_object('linea_id', pg_temp.id(20001), 'periodo', '2026-11', 'unidades', 100)),
    'repartos', '[]'::jsonb),
  pg_temp.act(1))));
insert into r (caso, ok) values
  ('aplicar_movimiento_agrupador: asigna la entrega al embarque del viaje (1 asignacion de 100)',
    pg_temp.good('am_asignar') and (select count(*) = 1 and sum(unidades) = 100 from compra_entrega_asignaciones where embarque_id = pg_temp.kk('E')));
insert into res values ('am_quitar', pg_temp.llamar(format(
  $q$select public.aplicar_movimiento_agrupador(%L::jsonb, %L::jsonb)$q$,
  jsonb_build_object(
    'operacion', 'quitar', 'accion', 'quitar', 'motivo', 'humo 36', 'resumen', 'humo 36 quitar',
    'embarques', (select jsonb_agg(jsonb_build_object('id', e.id, 'revision', e.revision)) from compra_embarques e where e.id = pg_temp.kk('E')),
    'paquete_a_mover', null,
    'compras', jsonb_build_array(jsonb_build_object('id', pg_temp.id(10001), 'revision', pg_temp.crev(pg_temp.id(10001)))),
    'movimientos', (select jsonb_agg(jsonb_build_object(
      'asignacion_id', a.id, 'entrega_id', a.entrega_id, 'linea_id', pg_temp.id(20001), 'compra_id', pg_temp.id(10001), 'unidades', a.unidades, 'destino', null))
      from compra_entrega_asignaciones a where a.embarque_id = pg_temp.kk('E')),
    'entregas', jsonb_build_array(jsonb_build_object('linea_id', pg_temp.id(20001), 'periodo', '2026-11', 'unidades', 100)),
    'repartos', '[]'::jsonb),
  pg_temp.act(1))));
insert into r (caso, ok) values
  ('aplicar_movimiento_agrupador: quita la asignacion (el embarque queda sin ninguna)',
    pg_temp.good('am_quitar') and (select count(*) = 0 from compra_entrega_asignaciones where embarque_id = pg_temp.kk('E'))),
  ('aplicar_movimiento_agrupador: dejo un evento asignar_agrupador por cada movimiento en la compra',
    (select count(*) = 2 from compra_eventos where compra_id = pg_temp.id(10001) and accion = 'asignar_agrupador'));

-- importar_agrupadores: un viaje nuevo, un embarque que apunta al viaje existente por codigo y un paquete que apunta al embarque existente por codigo.
insert into res values ('imp', pg_temp.llamar(format(
  $q$select public.importar_agrupadores(%L::jsonb, %L::jsonb)$q$,
  jsonb_build_object(
    'archivo_nombre', 'humo-36.csv',
    'viajes', jsonb_build_array(jsonb_build_object('fila', 1, 'codigo', null, 'nombre', 'Viaje importado 36', 'destino', null, 'fecha_inicio', '2026-12-01',
      'fecha_fin', null, 'responsable_id', pg_temp.id(3), 'nota', null)),
    'embarques', jsonb_build_array(jsonb_build_object('fila', 1, 'codigo', null, 'nombre', 'Embarque importado 36', 'tipo', 'importacion', 'viaje_id', null,
      'viaje_codigo', (select codigo from compra_viajes where id = pg_temp.kk('V')), 'responsable_id', null, 'referencia_logistica', null,
      'puerto_embarque', null, 'fecha_salida_estimada', null, 'fecha_llegada_estimada', '2027-01-15', 'nota', null)),
    'paquetes', jsonb_build_array(jsonb_build_object('fila', 1, 'codigo', null, 'nombre', 'Paquete importado 36', 'embarque_id', pg_temp.kk('E'),
      'embarque_codigo', null, 'responsable_id', null, 'nota', null))),
  pg_temp.act(1))));
insert into r (caso, ok) values
  ('importar_agrupadores: crea el viaje, el embarque (en el viaje existente, por codigo) y el paquete (en el embarque existente)',
    pg_temp.good('imp') and jsonb_array_length(pg_temp.rk('imp') -> 'creados') = 3
    and exists (select 1 from compra_viajes where nombre = 'Viaje importado 36')
    and exists (select 1 from compra_embarques where nombre = 'Embarque importado 36' and viaje_id = pg_temp.kk('V'))
    and exists (select 1 from compra_paquetes where nombre = 'Paquete importado 36' and embarque_id = pg_temp.kk('E')));

insert into r (caso, ok) values
  ('agrupadores_desalineados() devuelve 0 filas', (select count(*) = 0 from public.agrupadores_desalineados()));

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;
