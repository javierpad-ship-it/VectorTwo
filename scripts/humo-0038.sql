-- Humo SQL de la migración 0038 (fechas logísticas del embarque, línea de tiempo de la compra, número de OC y mes de destino por
-- asignación; ficha docs/modulos/08b-fechas-logisticas.md, revisión 5). Cubre los casos F de la ficha que son de base de datos:
--   * estructura (solo lectura, vale también contra Vector2): columnas y `check` nuevos, `periodo_llegada` con su expresión nueva,
--     `periodo_ingreso`, índices de OC, las 9 funciones tocadas (firma, security invoker, search_path vacío, execute solo para
--     service_role, sin `--` en el cuerpo, candados `for no key update`/`for update` intactos), la regla `coalesce(pq.periodo_ingreso,
--     b.periodo_llegada)` en el cuerpo de las funciones de §2.4 bis, el orden de las columnas (solo PostgreSQL 17) y el registro;
--   * F1, F46 (alta con y sin ingreso al stock, códigos con el mes del Ingreso CD), F22 (el PATCH conserva la salida), F19, F20, F21,
--     F40 (hito confirmado, I7 en todo guardado, `check` del catálogo), F4 a F9 (ingreso al stock, I6, causa y motivo), F3 (mueve el mes),
--     F11, F34, F35, F36, F38 (paquetes, mes de destino, piso, I9), F13 (recepciones por asignación), F45 (I2 general y
--     `agrupadores_desalineados`), F24 (resumen de hitos), F27 a F30 y F43 (OC: sin subir revisión, evento, única por proveedor);
--   * F2: con el fixture cargado se vuelve la columna `periodo_llegada` a su expresión de la 0037 y se aplica el archivo de la
--     migración (con `\i`): los meses, las entregas y las asignaciones no se mueven, `agrupadores_desalineados() = 0` y aplicarla otra
--     vez no da error. En PostgreSQL 16 recorre el camino de «recrear la columna» y en 17 el de `set expression`.
-- Lo que un humo de UNA transacción no puede probar (la concurrencia: (a) a (g) de la ficha) lo prueba
-- tests/integracion/concurrencia.int.test.ts. Lo que es de TypeScript (planes, hitos, línea de tiempo, importadores) lo prueban sus
-- pruebas de vitest. Los humos 0025, 0032, 0034 a 0037 siguen probando el resto.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase), DESDE LA RAÍZ DEL REPOSITORIO (usa `\i` con una
-- ruta relativa para el caso F2):
--   1. bash scripts/validar-migraciones-local.sh          (crea la base con todas las migraciones, dos veces)
--   2. bash scripts/correr-humos.sh scripts/humo-0038.sql
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- Las funciones se llaman con `set local role service_role` (la API corre con ese rol). Todo va dentro de UNA transacción que termina
-- en `rollback`: no deja nada escrito. Datos inventados. Contra Vector2 solo vale la sección 1 (por SELECT).
\set ON_ERROR_STOP off
\pset pager off
begin;

alter role service_role bypassrls;

create temp table r (n serial, caso text, ok boolean);
create temp table k (n text primary key, v uuid);
create temp table res (k text primary key, v jsonb);
create temp table snap (k text primary key, v bigint);
create temp table sj (k text primary key, v jsonb);
create temp table sellados (id uuid primary key, n serial);

create or replace function pg_temp.falla(t text, patron text default null) returns boolean language plpgsql as $f$
begin
  execute t;
  return false;
exception when others then
  return patron is null or sqlerrm like patron or sqlstate = patron;
end
$f$;

create or replace function pg_temp.id(n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;
create or replace function pg_temp.act(n integer) returns jsonb language sql as $f$
  select jsonb_build_object('perfil_id', pg_temp.id(n), 'nombre', 'Humo 38 ' || n) $f$;
create or replace function pg_temp.kk(n text) returns uuid language sql as $f$ select v from k where k.n = $1 $f$;
create or replace function pg_temp.rk(n text) returns jsonb language sql as $f$ select v from res where res.k = $1 $f$;
create or replace function pg_temp.sn(n text) returns bigint language sql as $f$ select v from snap where snap.k = $1 $f$;
create or replace function pg_temp.sjk(n text) returns jsonb language sql as $f$ select v from sj where sj.k = $1 $f$;
create or replace function pg_temp.good(n text) returns boolean language sql as $f$
  select coalesce((v ->> 'ok')::boolean, false) from res where res.k = $1 $f$;
create or replace function pg_temp.mot(n text) returns text language sql as $f$
  select coalesce(v ->> 'motivo', 'ERR:' || coalesce(v ->> 'error', '?') || ' ' || coalesce(v ->> 'msg', '')) from res where res.k = $1 $f$;
create or replace function pg_temp.err(n text) returns text language sql as $f$ select v ->> 'error' from res where res.k = $1 $f$;

create or replace function pg_temp.crev(c uuid) returns integer language sql as $f$ select revision from public.compras where id = c $f$;
create or replace function pg_temp.erev(e uuid) returns integer language sql as $f$ select revision from public.compra_embarques where id = e $f$;
create or replace function pg_temp.per(e uuid) returns text language sql as $f$ select to_char(periodo_llegada, 'YYYY-MM') from public.compra_embarques where id = e $f$;
create or replace function pg_temp.eid(l uuid, per text) returns uuid language sql as $f$
  select id from public.compra_linea_entregas where linea_id = l and periodo = (per || '-01')::date $f$;
create or replace function pg_temp.eu(l uuid, per text) returns integer language sql as $f$
  select coalesce((select unidades from public.compra_linea_entregas where linea_id = l and periodo = (per || '-01')::date), 0) $f$;
create or replace function pg_temp.sumeu(l uuid) returns integer language sql as $f$
  select coalesce(sum(unidades), 0)::integer from public.compra_linea_entregas where linea_id = l $f$;
create or replace function pg_temp.au(ent uuid, emb uuid, paq uuid) returns integer language sql as $f$
  select coalesce((select unidades from public.compra_entrega_asignaciones where entrega_id = ent and embarque_id = emb and paquete_id is not distinct from paq), 0) $f$;
create or replace function pg_temp.aid(ent uuid, emb uuid, paq uuid) returns uuid language sql as $f$
  select id from public.compra_entrega_asignaciones where entrega_id = ent and embarque_id = emb and paquete_id is not distinct from paq $f$;
create or replace function pg_temp.ncev(c uuid, acc text) returns integer language sql as $f$
  select count(*)::integer from public.compra_eventos where compra_id = c and accion = acc $f$;
create or replace function pg_temp.naev(e uuid, acc text) returns integer language sql as $f$
  select count(*)::integer from public.compra_agrupador_eventos where embarque_id = e and accion = acc $f$;
create or replace function pg_temp.desal() returns integer language sql as $f$
  select count(*)::integer from public.agrupadores_desalineados() $f$;
create or replace function pg_temp.foto() returns text language sql as $f$
  select md5(
    coalesce((select string_agg(e.id::text || ':' || e.unidades, ',' order by e.id) from public.compra_linea_entregas e), '') || '|' ||
    coalesce((select string_agg(a.id::text || ':' || a.entrega_id || ':' || a.embarque_id || ':' || coalesce(a.paquete_id::text, '-') || ':' || a.unidades, ',' order by a.id) from public.compra_entrega_asignaciones a), '') || '|' ||
    coalesce((select string_agg(c.id::text || ':' || c.revision || ':' || coalesce(c.numero_oc, '-'), ',' order by c.id) from public.compras c), '') || '|' ||
    coalesce((select string_agg(b.id::text || ':' || b.revision || ':' || b.fecha_llegada_estimada || ':' || b.estado || ':' || coalesce(b.fecha_ingreso_estimada::text, '-') || ':' || coalesce(b.hito_confirmado, '-'), ',' order by b.id) from public.compra_embarques b), '') || '|' ||
    coalesce((select string_agg(p.id::text || ':' || p.embarque_id || ':' || coalesce(p.fecha_ingreso_estimada::text, '-'), ',' order by p.id) from public.compra_paquetes p), '') || '|' ||
    (select count(*) from public.compra_eventos) || '|' || (select count(*) from public.compra_agrupador_eventos) || '|' ||
    (select count(*) from public.compra_linea_repartos)
  ) $f$;
create or replace function pg_temp.huella() returns jsonb language sql as $f$ select public.flujo_huella_base() $f$;

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
create or replace function pg_temp.r_oc(c uuid, antes text, nuevo text, mo text, a integer) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.editar_oc_compra(c, antes, nuevo, mo, pg_temp.act(a));
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', sqlstate, 'msg', sqlerrm);
end $f$;

-- Los eventos comparten `created_at` (una sola transacción) y su orden desempata por un uuid al azar: se sellan con tiempos crecientes,
-- en el orden en que se crearon, para que `agrupador_hitos_resumen` (fecha original, última causa) sea determinista en el humo.
create or replace function pg_temp.sellar() returns void language plpgsql as $f$
begin
  alter table public.compra_agrupador_eventos disable trigger compra_agrupador_eventos_inmutable;
  insert into sellados (id) select e.id from public.compra_agrupador_eventos e where e.id not in (select id from sellados) order by e.created_at, e.id;
  update public.compra_agrupador_eventos e
     set created_at = now() - interval '1 day' + (s.n::text || ' seconds')::interval
    from sellados s
   where s.id = e.id;
  alter table public.compra_agrupador_eventos enable trigger compra_agrupador_eventos_inmutable;
end $f$;

-- Constructores del plan (imitan a `PlanAplicable` de TypeScript).
create or replace function pg_temp.cs(ids uuid[]) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'revision', c.revision) order by c.id), '[]'::jsonb)
    from public.compras c where c.id = any (ids) $f$;
create or replace function pg_temp.eb(ids uuid[]) returns jsonb language sql as $f$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'revision', e.revision) order by e.id), '[]'::jsonb)
    from public.compra_embarques e where e.id = any (ids) $f$;
-- Compras de las asignaciones activas de los embarques, mas las `extra` (lo que arma `comprasAfectadas`).
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
create or replace function pg_temp.pq(p uuid, emb uuid, fecha text, ajustado boolean default false) returns jsonb language sql as $f$
  select jsonb_build_object('id', p, 'embarque_id', emb, 'fecha_ingreso_estimada', fecha, 'ajustado', ajustado) $f$;
create or replace function pg_temp.rep(lin uuid, per text, m1 uuid, gml uuid, u1 integer, m2 uuid, u2 integer, temp text) returns jsonb language sql as $f$
  select jsonb_build_object('linea_id', lin, 'periodo', per, 'filas', jsonb_build_array(
    jsonb_build_object('marca_id', m1, 'genero_mundo_linea_id', gml, 'unidades', u1, 'temporada', temp),
    jsonb_build_object('marca_id', m2, 'genero_mundo_linea_id', gml, 'unidades', u2, 'temporada', temp))) $f$;
-- Plan de `cambiar_fecha` (nuevo): `cambios` son las claves del embarque que cambian (clave presente = valor nuevo).
create or replace function pg_temp.pf(e uuid, cambios jsonb, paqs jsonb default '[]'::jsonb, comp jsonb default '[]'::jsonb,
                                      movs jsonb default '[]'::jsonb, ents jsonb default '[]'::jsonb, reps jsonb default '[]'::jsonb,
                                      extra jsonb default '{}'::jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('operacion', 'cambiar_fecha', 'accion', 'cambiar_fecha', 'motivo', 'humo 38', 'causa', 'otro', 'resumen', 'humo 38 fechas',
           'embarques', jsonb_build_array(jsonb_build_object('id', e, 'revision', (select revision from public.compra_embarques where id = e)) || cambios),
           'paquetes', paqs, 'paquete_a_mover', null, 'compras', comp, 'movimientos', movs, 'entregas', ents, 'repartos', reps) || extra $f$;
create or replace function pg_temp.pl(op text, emb jsonb, comp jsonb, movs jsonb, ents jsonb default '[]'::jsonb,
                                      reps jsonb default '[]'::jsonb, extra jsonb default '{}'::jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('operacion', op, 'accion', op, 'motivo', 'humo 38', 'causa', 'programacion', 'resumen', 'humo 38 ' || op, 'embarques', emb,
           'paquete_a_mover', null, 'compras', comp, 'movimientos', movs, 'entregas', ents, 'repartos', reps) || extra $f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura  [solo lectura: también vale contra Vector2]
-- ---------------------------------------------------------------------------------------------------------------------
create temp table funcs (nombre text primary key, firma text, no_key integer, for_update integer);
insert into funcs values
  ('guardar_embarque', 'p_embarque jsonb, p_revision integer, p_actor jsonb', 2, 0),
  ('guardar_paquete', 'p_paquete jsonb, p_revision_embarque integer, p_actor jsonb', 1, 0),
  ('cambiar_estado_agrupador', 'p_tipo text, p_id uuid, p_accion text, p_revision integer, p_motivo text, p_actor jsonb', 3, 0),
  ('aplicar_movimiento_agrupador', 'p_plan jsonb, p_actor jsonb', 1, 1),
  ('importar_agrupadores', 'p_lote jsonb, p_actor jsonb', 2, 0),
  ('editar_oc_compra', 'p_compra uuid, p_antes text, p_numero_oc text, p_motivo text, p_actor jsonb', 1, 0);
create temp table funcs_otras (nombre text primary key, firma text);
insert into funcs_otras values
  ('agrupador_foto_embarque', 'p_embarque uuid'),
  ('agrupadores_desalineados', ''),
  ('agrupador_hito_violado', 'p_embarque uuid'),
  ('agrupador_hitos_resumen', 'p_embarques uuid[]');

insert into r (caso, ok) values
  ('compra_embarques: columnas nuevas con su tipo (fecha_puerto_estimada, fecha_inicio_operativo_estimada, hora_inicio_operativo, hito_confirmado, origen, fecha_ingreso_estimada)',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'compra_embarques' and is_nullable = 'YES'
        and (column_name, data_type) in (('fecha_puerto_estimada', 'date'), ('fecha_inicio_operativo_estimada', 'date'), ('hora_inicio_operativo', 'time without time zone'),
                                         ('hito_confirmado', 'text'), ('origen', 'text'), ('fecha_ingreso_estimada', 'date'))) = 6),
  ('compra_paquetes.fecha_ingreso_estimada (date nula) y periodo_ingreso (generada almacenada); compra_agrupador_eventos.causa; compras.numero_oc',
    (select count(*) from information_schema.columns
      where table_schema = 'public' and is_nullable = 'YES'
        and (table_name, column_name, data_type) in (('compra_paquetes', 'fecha_ingreso_estimada', 'date'), ('compra_paquetes', 'periodo_ingreso', 'date'),
                                                     ('compra_agrupador_eventos', 'causa', 'text'), ('compras', 'numero_oc', 'text'))) = 4
    and (select count(*) from pg_attribute where attrelid = 'public.compra_paquetes'::regclass and attname = 'periodo_ingreso' and attgenerated = 's') = 1),
  ('los check nuevos existen: hora sin fecha, catalogo de hito_confirmado, largo de origen, catalogo de causa y formato de numero_oc',
    (select count(*) from pg_constraint where conname in ('compra_embarques_hora_sin_fecha_check', 'compra_embarques_hito_confirmado_check',
        'compra_embarques_origen_len_check', 'compra_agrupador_eventos_causa_check', 'compras_numero_oc_check') and contype = 'c') = 5),
  ('periodo_llegada es generada almacenada y su expresion lee coalesce(fecha_llegada_real, fecha_ingreso_estimada, fecha_llegada_estimada) (decision 115)',
    (select attgenerated = 's' from pg_attribute where attrelid = 'public.compra_embarques'::regclass and attname = 'periodo_llegada')
    and (select replace(pg_get_expr(d.adbin, d.adrelid), ' ', '') like '%COALESCE(fecha_llegada_real,fecha_ingreso_estimada,fecha_llegada_estimada)%'
           from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
          where d.adrelid = 'public.compra_embarques'::regclass and a.attname = 'periodo_llegada')),
  ('orden de las columnas de compra_embarques: en PostgreSQL 17 `set expression` conserva la posicion de periodo_llegada (antes de las columnas nuevas); en 16 se recrea al final',
    current_setting('server_version_num')::integer < 170000
    or (select a.attnum < (select attnum from pg_attribute where attrelid = a.attrelid and attname = 'fecha_puerto_estimada')
          from pg_attribute a where a.attrelid = 'public.compra_embarques'::regclass and a.attname = 'periodo_llegada')),
  ('indices: periodo_llegada, compras_numero_oc_idx (parcial por upper(btrim)) y compras_proveedor_oc_uidx (unico parcial por proveedor y upper(btrim), sin canceladas)',
    exists (select 1 from pg_indexes where indexname = 'compra_embarques_periodo_llegada_idx')
    and (select indexdef like '%upper(btrim(numero_oc))%' and indexdef like '%numero_oc IS NOT NULL%' and indexdef not like '%UNIQUE%' from pg_indexes where indexname = 'compras_numero_oc_idx')
    and (select indexdef like '%UNIQUE%' and indexdef like '%(proveedor_id, upper(btrim(numero_oc)))%' and indexdef like '%numero_oc IS NOT NULL%' and indexdef like '%cancelada%'
           from pg_indexes where indexname = 'compras_proveedor_oc_uidx')),
  ('las 6 funciones de escritura existen con su firma y devuelven jsonb',
    (select count(*) from funcs f join pg_proc p on p.proname = f.nombre and pg_get_function_identity_arguments(p.oid) = f.firma
       join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public' where p.prorettype = 'jsonb'::regtype) = 6),
  ('las 4 de lectura (foto, desalineados, hito_violado, hitos_resumen) existen con su firma',
    (select count(*) from funcs_otras f join pg_proc p on p.proname = f.nombre and pg_get_function_identity_arguments(p.oid) = f.firma
       join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public') = 4),
  ('agrupadores_desalineados() conserva sus 5 columnas de salida (misma firma: asignacion_id, embarque_id, entrega_id, periodo, periodo_llegada)',
    (select pg_get_function_result(p.oid) from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public' where p.proname = 'agrupadores_desalineados')
      = 'TABLE(asignacion_id uuid, embarque_id uuid, entrega_id uuid, periodo date, periodo_llegada date)'),
  ('las 10: security invoker, search_path vacio y execute solo para service_role (ni public, ni anon, ni authenticated)',
    (select count(*) from (select nombre, firma from funcs union all select nombre, firma from funcs_otras) f
       join pg_proc p on p.proname = f.nombre and pg_get_function_identity_arguments(p.oid) = f.firma
       join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
      where not p.prosecdef
        and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path='))
        and not exists (select 1 from unnest(p.proconfig) c where c like 'work_mem%')
        and not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and not has_function_privilege('public', p.oid, 'execute')
        and has_function_privilege('service_role', p.oid, 'execute')) = 10),
  ('los cuerpos de las 10 no tienen comentarios -- (el SQL Editor los parsea mal)',
    (select count(*) from (select nombre from funcs union all select nombre from funcs_otras) f
       join pg_proc p on p.proname = f.nombre join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
      where p.prosrc like '%--%') = 0),
  ('candados intactos (0036): cada funcion de escritura tiene los `for no key update` y `for update` esperados',
    (select count(*) from funcs f join pg_proc p on p.proname = f.nombre join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
      where (select count(*) from regexp_matches(p.prosrc, '\mfor no key update\M', 'g')) = f.no_key
        and (select count(*) from regexp_matches(p.prosrc, '\mfor update\M', 'g')) = f.for_update) = 6),
  ('la regla de §2.4 bis esta en linea en aplicar_movimiento_agrupador y agrupadores_desalineados: coalesce(pq.periodo_ingreso, b.periodo_llegada) con left join de compra_paquetes',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace and s.nspname = 'public'
      where p.proname in ('aplicar_movimiento_agrupador', 'agrupadores_desalineados')
        and p.prosrc like '%coalesce(pq.periodo_ingreso, b.periodo_llegada)%'
        and p.prosrc like '%left join public.compra_paquetes pq on pq.id = a.paquete_id%') = 2),
  ('la OC no sube la revision: editar_oc_compra no escribe `revision` y deja la accion editar_oc',
    (select p.prosrc not like '%revision = revision + 1%' and p.prosrc like '%''editar_oc''%' from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname = 'editar_oc_compra')),
  ('la 0038 quedo registrada en migraciones_aplicadas',
    exists (select 1 from public.migraciones_aplicadas where nombre = '0038_fechas_logisticas_embarque'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture: perfiles, proveedores, GML, marcas, cinco compras, embarques y asignaciones
-- ---------------------------------------------------------------------------------------------------------------------
insert into auth.users (id, email) values
  (pg_temp.id(1), 'humo38a@example.invalid'), (pg_temp.id(2), 'humo38c1@example.invalid'), (pg_temp.id(3), 'humo38c2@example.invalid');
insert into perfiles (id, email, nombre, rol, activo) values
  (pg_temp.id(1), 'humo38a@example.invalid', 'Humo 38 A', 'admin', true),
  (pg_temp.id(2), 'humo38c1@example.invalid', 'Humo 38 C1', 'comprador', true),
  (pg_temp.id(3), 'humo38c2@example.invalid', 'Humo 38 C2', 'comprador', true);
insert into proveedores (nombre) values ('PROVEEDOR NORTE H38'), ('FERIA SUR H38');
insert into generos (codigo, nombre) values ('H38H', 'HOMBRE H38');
insert into mundos (codigo, nombre) values ('H38U', 'URBANO H38');
insert into lineas (codigo, nombre, temporada) values ('H38L1', 'LINEA UNO H38', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML' from lineas l, generos g, mundos mu where l.codigo = 'H38L1' and g.codigo = 'H38H' and mu.codigo = 'H38U';
insert into agrupaciones_marca (codigo, nombre) values ('H38AG1', 'AGRUPACION H38');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select m.codigo, m.codigo, a.id from agrupaciones_marca a, (values ('H38M1'), ('H38M2')) as m(codigo) where a.codigo = 'H38AG1';

create temp table ctx as
select (select id from genero_mundo_linea limit 1) as gml,
       (select id from marcas where codigo = 'H38M1') as m1,
       (select id from marcas where codigo = 'H38M2') as m2,
       (select id from proveedores where nombre = 'PROVEEDOR NORTE H38') as norte,
       (select id from proveedores where nombre = 'FERIA SUR H38') as sur;

-- cA (Norte): l1 500 u (nov 300 + dic 200) y l2 lote al barrer 1 000 u (mar-27 600 + abr-27 400, repartido). cB (Sur): l3 400 u (nov).
-- cC (Norte): l4 500 u (nov 300 + dic 200). cD (Sur): l5 400 u (nov). cX (Norte, sin lineas): para probar la OC de una compra cancelada.
insert into compras (id, proveedor_id, origen, estado, fecha_compra, confirmada_at)
select pg_temp.id(9001), norte, 'carga_inicial', 'confirmada', date '2026-07-06', now() from ctx
union all select pg_temp.id(9002), sur, 'carga_inicial', 'confirmada', date '2026-07-10', now() from ctx
union all select pg_temp.id(9003), norte, 'carga_inicial', 'confirmada', date '2026-07-11', now() from ctx
union all select pg_temp.id(9004), sur, 'carga_inicial', 'confirmada', date '2026-07-12', now() from ctx
union all select pg_temp.id(9005), norte, 'carga_inicial', 'confirmada', date '2026-07-13', now() from ctx;
insert into compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, marca_id, unidades, llegada_periodo, costo_unitario)
select pg_temp.id(9101), pg_temp.id(9001), 'especifica', gml, null, 500, date '2026-11-01', 10 from ctx
union all select pg_temp.id(9102), pg_temp.id(9001), 'barrer_marca', null, m1, 1000, date '2027-03-01', 8 from ctx
union all select pg_temp.id(9103), pg_temp.id(9002), 'especifica', gml, null, 400, date '2026-11-01', 12 from ctx
union all select pg_temp.id(9104), pg_temp.id(9003), 'especifica', gml, null, 500, date '2026-11-01', 9 from ctx
union all select pg_temp.id(9105), pg_temp.id(9004), 'especifica', gml, null, 400, date '2026-11-01', 9 from ctx;
insert into compra_linea_entregas (linea_id, periodo, unidades, origen) values
  (pg_temp.id(9101), date '2026-11-01', 300, 'manual'), (pg_temp.id(9101), date '2026-12-01', 200, 'manual'),
  (pg_temp.id(9102), date '2027-03-01', 600, 'manual'), (pg_temp.id(9102), date '2027-04-01', 400, 'manual'),
  (pg_temp.id(9103), date '2026-11-01', 400, 'manual'),
  (pg_temp.id(9104), date '2026-11-01', 300, 'manual'), (pg_temp.id(9104), date '2026-12-01', 200, 'manual'),
  (pg_temp.id(9105), date '2026-11-01', 400, 'manual');
insert into compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, unidades, temporada)
select pg_temp.id(9102), e.id, case v.m when 1 then c.m1 else c.m2 end, c.gml, v.u, v.t
  from ctx c, (values ('2027-03', 1, 400, 'verano'), ('2027-03', 2, 200, 'verano'), ('2027-04', 1, 270, 'invierno'), ('2027-04', 2, 130, 'invierno')) as v(per, m, u, t)
  join public.compra_linea_entregas e on e.linea_id = pg_temp.id(9102) and e.periodo = (v.per || '-01')::date;
insert into k values ('cA', pg_temp.id(9001)), ('cB', pg_temp.id(9002)), ('cC', pg_temp.id(9003)), ('cD', pg_temp.id(9004)), ('cX', pg_temp.id(9005)),
  ('l1', pg_temp.id(9101)), ('l2', pg_temp.id(9102)), ('l3', pg_temp.id(9103)), ('l4', pg_temp.id(9104)), ('l5', pg_temp.id(9105));

-- Embarques por la función de la API. E1 (261101): importación, Zarpe 05-oct, Arribo 08-nov, Ingreso CD 15-nov. E5: Ingreso CD 15-nov.
-- E2 (270301): Ingreso CD 05-mar-27. E3 (270401): 20-abr-27. E4 (270601): 15-jun-27.
insert into res values
  ('e1', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E1 H38', 'tipo', 'importacion', 'fecha_salida_estimada', '2026-10-05', 'fecha_puerto_estimada', '2026-11-08', 'fecha_llegada_estimada', '2026-11-15', 'origen', 'California'), null, 2)),
  ('e5', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E5 H38', 'tipo', 'importacion', 'fecha_llegada_estimada', '2026-11-15'), null, 2)),
  ('e2', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E2 H38', 'tipo', 'importacion', 'fecha_llegada_estimada', '2027-03-05'), null, 2)),
  ('e3', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E3 H38', 'tipo', 'importacion', 'fecha_llegada_estimada', '2027-04-20'), null, 2)),
  ('e4', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E4 H38', 'tipo', 'importacion', 'fecha_llegada_estimada', '2027-06-15'), null, 2));
insert into k select 'E1', (pg_temp.rk('e1') ->> 'embarque_id')::uuid;
insert into k select 'E5', (pg_temp.rk('e5') ->> 'embarque_id')::uuid;
insert into k select 'E2', (pg_temp.rk('e2') ->> 'embarque_id')::uuid;
insert into k select 'E3', (pg_temp.rk('e3') ->> 'embarque_id')::uuid;
insert into k select 'E4', (pg_temp.rk('e4') ->> 'embarque_id')::uuid;
insert into compra_entrega_asignaciones (entrega_id, embarque_id, paquete_id, unidades) values
  (pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('E1'), null, 300),
  (pg_temp.eid(pg_temp.kk('l3'), '2026-11'), pg_temp.kk('E1'), null, 400),
  (pg_temp.eid(pg_temp.kk('l4'), '2026-11'), pg_temp.kk('E5'), null, 300),
  (pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E5'), null, 400),
  (pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E2'), null, 600);
select pg_temp.sellar();

insert into r (caso, ok) values
  ('fixture: 5 compras, 5 lineas, 5 embarques; antes de empezar, sin desalineadas y la salida de E1 guardada',
    (select count(*) from compras where id in (select v from k where n like 'c%')) = 5
    and pg_temp.good('e1') and pg_temp.good('e5') and pg_temp.good('e2') and pg_temp.good('e3') and pg_temp.good('e4')
    and pg_temp.per(pg_temp.kk('E1')) = '2026-11' and pg_temp.per(pg_temp.kk('E2')) = '2027-03' and pg_temp.desal() = 0
    and (select fecha_salida_estimada = date '2026-10-05' and fecha_puerto_estimada = date '2026-11-08' and origen = 'California' from compra_embarques where id = pg_temp.kk('E1')));

-- ---------------------------------------------------------------------------------------------------------------------
-- F1 y F46: alta con y sin ingreso al stock; el código toma el mes del Ingreso CD (embarque y paquete)
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('f1_a', pg_temp.r_ge(jsonb_build_object('nombre', 'F1 sin ingreso', 'tipo', 'importacion', 'fecha_llegada_estimada', '2026-11-15'), null, 2)),
  ('f1_b', pg_temp.r_ge(jsonb_build_object('nombre', 'F1 con ingreso', 'tipo', 'importacion', 'fecha_llegada_estimada', '2026-11-15', 'fecha_ingreso_estimada', '2026-12-02'), null, 2)),
  ('f1_c', pg_temp.r_ge(jsonb_build_object('nombre', 'F1 sin Ingreso CD', 'tipo', 'importacion', 'fecha_ingreso_estimada', '2026-12-02'), null, 2)),
  ('f19_hora', pg_temp.r_ge(jsonb_build_object('nombre', 'F19 hora sin fecha', 'tipo', 'importacion', 'fecha_llegada_estimada', '2026-11-15', 'hora_inicio_operativo', '09:22'), null, 2)),
  ('f19_local', pg_temp.r_ge(jsonb_build_object('nombre', 'F19 local con arribo', 'tipo', 'local', 'fecha_llegada_estimada', '2026-11-15', 'fecha_puerto_estimada', '2026-11-10'), null, 2)),
  ('f19_zarpe', pg_temp.r_ge(jsonb_build_object('nombre', 'F19 zarpe tarde', 'tipo', 'importacion', 'fecha_llegada_estimada', '2026-11-22', 'fecha_salida_estimada', '2026-11-25'), null, 2));
insert into k select 'E1a', (pg_temp.rk('f1_a') ->> 'embarque_id')::uuid;
insert into k select 'E1b', (pg_temp.rk('f1_b') ->> 'embarque_id')::uuid;
insert into res values
  ('f46_p', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E1b'), 'nombre', 'Paquete F46'), pg_temp.erev(pg_temp.kk('E1b')), 2)),
  ('f46_im', pg_temp.r_im(jsonb_build_object(
    'embarques', jsonb_build_array(jsonb_build_object('fila', 1, 'codigo', null, 'nombre', 'F46 importado', 'tipo', 'importacion', 'viaje_id', null, 'viaje_codigo', null,
      'responsable_id', null, 'referencia_logistica', null, 'puerto_embarque', null, 'fecha_salida_estimada', '2026-11-01', 'fecha_puerto_estimada', '2026-11-09',
      'fecha_llegada_estimada', '2026-11-15', 'fecha_inicio_operativo_estimada', '2026-11-16', 'hora_inicio_operativo', '09:22', 'fecha_ingreso_estimada', '2026-12-02',
      'origen', 'Nueva York', 'nota', null)),
    'paquetes', jsonb_build_array(jsonb_build_object('fila', 1, 'codigo', null, 'nombre', 'Paquete F46 importado', 'embarque_id', null,
      'embarque_codigo', 'F46IMP', 'responsable_id', null, 'nota', null))), 2));
insert into r (caso, ok) values
  ('F1: Ingreso CD 15-nov sin ingreso al stock: ingreso nulo, mes nov, codigo 2611##; con ingreso 02-dic: mes dic y codigo 2611##; sin Ingreso CD: fecha_requerida',
    pg_temp.good('f1_a') and pg_temp.rk('f1_a') ->> 'codigo' like '2611%' and pg_temp.per(pg_temp.kk('E1a')) = '2026-11'
    and (select fecha_ingreso_estimada is null from compra_embarques where id = pg_temp.kk('E1a'))
    and pg_temp.good('f1_b') and pg_temp.rk('f1_b') ->> 'codigo' like '2611%' and pg_temp.per(pg_temp.kk('E1b')) = '2026-12'
    and pg_temp.mot('f1_c') = 'fecha_requerida'),
  ('F19: hora sin fecha al crear: hora_sin_fecha; Arribo en un local: puerto_en_local; Zarpe 25-nov con Ingreso CD 22-nov: salida_despues_de_llegada',
    pg_temp.mot('f19_hora') = 'hora_sin_fecha' and pg_temp.mot('f19_local') = 'puerto_en_local' and pg_temp.mot('f19_zarpe') = 'salida_despues_de_llegada'),
  ('F46: el paquete de un embarque con Ingreso CD 15-nov e ingreso 02-dic (cuenta en dic) es 2611##: el mes del Ingreso CD, no el del ingreso al stock',
    pg_temp.good('f46_p') and pg_temp.rk('f46_p') ->> 'codigo' like '2611%'),
  ('F46 por el importador de agrupadores: crea el embarque con los cinco hitos, origen e ingreso (mes dic); el paquete que apunta a su codigo toma 2611##',
    pg_temp.good('f46_im') or pg_temp.mot('f46_im') = 'no_encontrado');

-- El importador resuelve el paquete por el código del embarque: se importa en dos lotes (el embarque primero).
insert into res values
  ('f46_im1', pg_temp.r_im(jsonb_build_object(
    'embarques', jsonb_build_array(jsonb_build_object('fila', 1, 'codigo', 'F46IMP', 'nombre', 'F46 importado', 'tipo', 'importacion', 'viaje_id', null, 'viaje_codigo', null,
      'responsable_id', null, 'referencia_logistica', null, 'puerto_embarque', null, 'fecha_salida_estimada', '2026-11-01', 'fecha_puerto_estimada', '2026-11-09',
      'fecha_llegada_estimada', '2026-11-15', 'fecha_inicio_operativo_estimada', '2026-11-16', 'hora_inicio_operativo', '09:22', 'fecha_ingreso_estimada', '2026-12-02',
      'origen', 'Nueva York', 'nota', null))), 2));
insert into res values
  ('f46_im2', pg_temp.r_im(jsonb_build_object(
    'paquetes', jsonb_build_array(jsonb_build_object('fila', 1, 'codigo', null, 'nombre', 'Paquete F46 importado', 'embarque_id', null,
      'embarque_codigo', 'F46IMP', 'responsable_id', null, 'nota', null))), 2)),
  ('f18_hora', pg_temp.r_im(jsonb_build_object(
    'embarques', jsonb_build_array(jsonb_build_object('fila', 1, 'codigo', null, 'nombre', 'F18 hora sin fecha', 'tipo', 'importacion', 'viaje_id', null, 'viaje_codigo', null,
      'responsable_id', null, 'referencia_logistica', null, 'puerto_embarque', null, 'fecha_salida_estimada', null, 'fecha_llegada_estimada', '2026-11-15',
      'hora_inicio_operativo', '09:22', 'nota', null))), 2));
insert into r (caso, ok) values
  ('importar_agrupadores: el embarque entra con Arribo, Inicio operativo (fecha y hora), ingreso al stock y origen; mes dic; el paquete importado toma el prefijo del Ingreso CD (2611); hora sin fecha: hora_sin_fecha',
    pg_temp.good('f46_im1') and pg_temp.good('f46_im2')
    and (select fecha_puerto_estimada = date '2026-11-09' and fecha_inicio_operativo_estimada = date '2026-11-16' and hora_inicio_operativo = time '09:22'
           and fecha_ingreso_estimada = date '2026-12-02' and origen = 'Nueva York' and periodo_llegada = date '2026-12-01'
           from compra_embarques where codigo = 'F46IMP')
    and (select codigo like '2611%' from compra_paquetes where nombre = 'Paquete F46 importado')
    and pg_temp.mot('f18_hora') = 'hora_sin_fecha');

-- ---------------------------------------------------------------------------------------------------------------------
-- F22: el PATCH (guardar_embarque al editar) no escribe fechas: clave ausente conserva, presente y distinta da fecha_por_movimiento
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('f22_ausente', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'Embarque E1 H38 (editado)', 'tipo', 'importacion', 'origen', 'California'), pg_temp.erev(pg_temp.kk('E1')), 2));
insert into res values
  ('f22_otra', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'importacion', 'fecha_salida_estimada', '2026-10-06'), pg_temp.erev(pg_temp.kk('E1')), 2)),
  ('f22_nula', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'importacion', 'fecha_salida_estimada', null), pg_temp.erev(pg_temp.kk('E1')), 2)),
  ('f22_misma', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'Embarque E1 H38', 'tipo', 'importacion', 'fecha_salida_estimada', '2026-10-05', 'fecha_llegada_estimada', '2026-11-15', 'origen', 'California'), pg_temp.erev(pg_temp.kk('E1')), 2)),
  ('f22_hora', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'importacion', 'hora_inicio_operativo', '09:22'), pg_temp.erev(pg_temp.kk('E1')), 2)),
  ('f22_ingreso', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'importacion', 'fecha_ingreso_estimada', '2026-12-02'), pg_temp.erev(pg_temp.kk('E1')), 2)),
  ('f40_local', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E1'), 'nombre', 'X', 'tipo', 'local'), pg_temp.erev(pg_temp.kk('E1')), 2));
insert into r (caso, ok) values
  ('F22: un PATCH sin fecha_salida_estimada conserva la salida (antes la borraba); con otra, con null explicito, con hora o con ingreso al stock: fecha_por_movimiento; con la misma: ok; el origen si se edita',
    pg_temp.good('f22_ausente') and (select fecha_salida_estimada = date '2026-10-05' and fecha_puerto_estimada = date '2026-11-08' and nombre = 'Embarque E1 H38' from compra_embarques where id = pg_temp.kk('E1'))
    and pg_temp.mot('f22_otra') = 'fecha_por_movimiento' and pg_temp.mot('f22_nula') = 'fecha_por_movimiento'
    and pg_temp.mot('f22_hora') = 'fecha_por_movimiento' and pg_temp.mot('f22_ingreso') = 'fecha_por_movimiento'
    and pg_temp.good('f22_misma')),
  ('F40 (d): pasar a local con Arribo con fecha: puerto_en_local',
    pg_temp.mot('f40_local') = 'puerto_en_local');

-- ---------------------------------------------------------------------------------------------------------------------
-- F4, F8, F9: cambios que no mueven el mes (I6): ingreso al stock en el mismo mes, Arribo, completar un hito vacío
-- ---------------------------------------------------------------------------------------------------------------------
insert into sj values ('h0', pg_temp.huella());
insert into snap values ('revcA0', pg_temp.crev(pg_temp.kk('cA'))), ('revcB0', pg_temp.crev(pg_temp.kk('cB'))),
  ('ncev0', (select count(*) from compra_eventos)), ('nev0', pg_temp.naev(pg_temp.kk('E1'), 'cambiar_fecha')), ('revE1_0', pg_temp.erev(pg_temp.kk('E1')));
insert into res values
  ('f4', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_ingreso_estimada', '2026-11-28'), extra => '{"causa": "cola_conteo"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F4 / I6: fijar el ingreso al stock de E1 en 28-nov (mismo mes): se aplica, un evento con causa cola_conteo, el mes sigue nov, las compras no suben revision ni dejan evento y la huella del flujo no cambia',
    pg_temp.good('f4') and pg_temp.per(pg_temp.kk('E1')) = '2026-11'
    and (select fecha_ingreso_estimada = date '2026-11-28' from compra_embarques where id = pg_temp.kk('E1'))
    and pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revcA0') and pg_temp.crev(pg_temp.kk('cB')) = pg_temp.sn('revcB0')
    and (select count(*) from compra_eventos) = pg_temp.sn('ncev0')
    and pg_temp.naev(pg_temp.kk('E1'), 'cambiar_fecha') = pg_temp.sn('nev0') + 1 and pg_temp.erev(pg_temp.kk('E1')) = pg_temp.sn('revE1_0') + 1
    and (select causa = 'cola_conteo' and motivo = 'humo 38' and (despues ->> 'fecha_ingreso_estimada') = '2026-11-28' and (antes ->> 'fecha_ingreso_estimada') is null
           from compra_agrupador_eventos where embarque_id = pg_temp.kk('E1') and accion = 'cambiar_fecha' order by created_at desc limit 1)
    and pg_temp.huella() = pg_temp.sjk('h0') and pg_temp.desal() = 0);

insert into res values
  ('f8', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_puerto_estimada', '2026-11-18'), extra => '{"causa": "naviera"}'), 2));
select pg_temp.sellar();
insert into res values
  ('f9_sin_causa', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_puerto_estimada', '2026-11-20'), extra => '{"causa": null}'), 2)),
  ('f9_sin_motivo', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_puerto_estimada', '2026-11-20'), extra => '{"motivo": null}'), 2)),
  ('f9_completar', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_inicio_operativo_estimada', '2026-11-30'), extra => '{"motivo": null, "causa": null}'), 2)),
  ('f9_hora_sola', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('hora_inicio_operativo', '10:30'), extra => '{"motivo": null, "causa": null}'), 2)),
  ('f9_sin_cambios', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_puerto_estimada', '2026-11-18')), 2)),
  ('f9_causa_mala', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_puerto_estimada', '2026-11-21'), extra => '{"causa": "clima"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F8 / I6: cambiar el Arribo de 08-nov a 18-nov (naviera): compras sin cambio y la huella del flujo identica a la de antes',
    pg_temp.good('f8') and (select fecha_puerto_estimada = date '2026-11-18' from compra_embarques where id = pg_temp.kk('E1'))
    and pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revcA0') and (select count(*) from compra_eventos) = pg_temp.sn('ncev0')
    and (select jsonb_array_length(compras) = 0 from compra_agrupador_eventos where embarque_id = pg_temp.kk('E1') and accion = 'cambiar_fecha' order by created_at desc limit 1)),
  ('F9: reprogramar el Arribo sin causa: causa_requerida; sin motivo: motivo_requerido; sin cambios: sin_cambios; una causa fuera del catalogo es un plan invalido (AG002)',
    pg_temp.mot('f9_sin_causa') = 'causa_requerida' and pg_temp.mot('f9_sin_motivo') = 'motivo_requerido' and pg_temp.mot('f9_sin_cambios') = 'sin_cambios'
    and pg_temp.err('f9_causa_mala') = 'AG002'),
  ('F9: completar un Inicio operativo vacio, y despues una hora vacia, no pide motivo ni causa',
    pg_temp.good('f9_completar') and pg_temp.good('f9_hora_sola')
    and (select fecha_inicio_operativo_estimada = date '2026-11-30' and hora_inicio_operativo = time '10:30' from compra_embarques where id = pg_temp.kk('E1'))),
  ('I6 en conjunto: tras F4, F8 y F9 el mes de E1 sigue en nov, sin desalineadas, y la huella del flujo es la de antes',
    pg_temp.per(pg_temp.kk('E1')) = '2026-11' and pg_temp.desal() = 0 and pg_temp.huella() = pg_temp.sjk('h0'));

-- ---------------------------------------------------------------------------------------------------------------------
-- F5, F6, F7: el ingreso al stock mueve el mes; igualar al Ingreso CD lo devuelve; fijado no se mueve con el Ingreso CD
-- ---------------------------------------------------------------------------------------------------------------------
insert into snap values ('revcA1', pg_temp.crev(pg_temp.kk('cA'))), ('revcB1', pg_temp.crev(pg_temp.kk('cB'))), ('idl1dic', 0);
insert into res values ('id_l1_dic', jsonb_build_object('id', pg_temp.eid(pg_temp.kk('l1'), '2026-12')));
-- F5: fijar el ingreso al stock en 04-dic (programacion): l1 nov 300 y l3 nov 400 pasan a dic (la de l1 se funde con la dic 200).
insert into res values
  ('f5', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_ingreso_estimada', '2026-12-04'), '[]'::jsonb,
      pg_temp.cs(array[pg_temp.kk('cA'), pg_temp.kk('cB')]),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('E1'), null), pg_temp.eid(pg_temp.kk('l1'), '2026-11'), pg_temp.kk('l1'), pg_temp.kk('cA'), 300, '2026-12', pg_temp.kk('E1'), null),
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l3'), '2026-11'), pg_temp.kk('E1'), null), pg_temp.eid(pg_temp.kk('l3'), '2026-11'), pg_temp.kk('l3'), pg_temp.kk('cB'), 400, '2026-12', pg_temp.kk('E1'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l1'), '2026-11', 0), pg_temp.en(pg_temp.kk('l1'), '2026-12', 500), pg_temp.en(pg_temp.kk('l3'), '2026-11', 0), pg_temp.en(pg_temp.kk('l3'), '2026-12', 400)),
      '[]'::jsonb, '{"causa": "programacion"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F5: fijar el ingreso al stock de E1 en 04-dic (programacion): el mes pasa a dic, l1 nov 300 se funde con dic 200 (la entrega de dic conserva su id), l3 nov 400 pasa a dic, revision +1 en las dos compras, sin desalineadas',
    pg_temp.good('f5') and pg_temp.per(pg_temp.kk('E1')) = '2026-12'
    and pg_temp.eu(pg_temp.kk('l1'), '2026-11') = 0 and pg_temp.eu(pg_temp.kk('l1'), '2026-12') = 500 and pg_temp.eu(pg_temp.kk('l3'), '2026-12') = 400
    and pg_temp.eid(pg_temp.kk('l1'), '2026-12') = (pg_temp.rk('id_l1_dic') ->> 'id')::uuid
    and pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revcA1') + 1 and pg_temp.crev(pg_temp.kk('cB')) = pg_temp.sn('revcB1') + 1
    and pg_temp.ncev(pg_temp.kk('cA'), 'mover_entregas') = 1 and pg_temp.desal() = 0),
  ('F5: la reprogramacion con causa programacion queda en el evento con su causa',
    exists (select 1 from compra_agrupador_eventos where embarque_id = pg_temp.kk('E1') and accion = 'cambiar_fecha' and causa = 'programacion'
              and (despues ->> 'periodo_llegada') = '2026-12-01' and (antes ->> 'periodo_llegada') = '2026-11-01'));

-- F7: con el ingreso fijado en 04-dic, mover el Ingreso CD a 10-dic (naviera): el ingreso queda en 04-dic y no se mueve nada.
insert into sj values ('h1', pg_temp.huella());
insert into res values
  ('f7', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_llegada_estimada', '2026-12-10'), extra => '{"causa": "naviera"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F7: Ingreso CD 15-nov -> 10-dic con el ingreso fijado en 04-dic: el ingreso queda en 04-dic, el mes sigue en dic y no se mueve nada (compras intactas)',
    pg_temp.good('f7') and pg_temp.per(pg_temp.kk('E1')) = '2026-12'
    and (select fecha_llegada_estimada = date '2026-12-10' and fecha_ingreso_estimada = date '2026-12-04' from compra_embarques where id = pg_temp.kk('E1'))
    and pg_temp.huella() = pg_temp.sjk('h1') and pg_temp.desal() = 0);

-- F6: igualar al Ingreso CD (clave presente en null): con el Ingreso CD en 10-dic sigue en dic; se mueve el Ingreso CD a 15-nov antes
-- (para que igualar devuelva el mes) y se verifica que l1 vuelve a nov 300 + dic 200 con su id de dic.
insert into res values
  ('f6_cd', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_llegada_estimada', '2026-11-15'), extra => '{"causa": "correccion"}'), 2));
select pg_temp.sellar();
insert into res values
  ('f6', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_ingreso_estimada', null), '[]'::jsonb,
      pg_temp.cs(array[pg_temp.kk('cA'), pg_temp.kk('cB')]),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('E1'), null), pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('l1'), pg_temp.kk('cA'), 300, '2026-11', pg_temp.kk('E1'), null),
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l3'), '2026-12'), pg_temp.kk('E1'), null), pg_temp.eid(pg_temp.kk('l3'), '2026-12'), pg_temp.kk('l3'), pg_temp.kk('cB'), 400, '2026-11', pg_temp.kk('E1'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l1'), '2026-11', 300), pg_temp.en(pg_temp.kk('l1'), '2026-12', 200), pg_temp.en(pg_temp.kk('l3'), '2026-11', 400), pg_temp.en(pg_temp.kk('l3'), '2026-12', 0)),
      '[]'::jsonb, '{"causa": "programacion"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F6: «Igualar al Ingreso CD» (ingreso en null) vuelve a nov: l1 queda nov 300 + dic 200 (la de dic con su id original), l3 nov 400, ingreso nulo',
    pg_temp.good('f6_cd') and pg_temp.good('f6') and pg_temp.per(pg_temp.kk('E1')) = '2026-11'
    and (select fecha_ingreso_estimada is null from compra_embarques where id = pg_temp.kk('E1'))
    and pg_temp.eu(pg_temp.kk('l1'), '2026-11') = 300 and pg_temp.eu(pg_temp.kk('l1'), '2026-12') = 200
    and pg_temp.eid(pg_temp.kk('l1'), '2026-12') = (pg_temp.rk('id_l1_dic') ->> 'id')::uuid
    and pg_temp.eu(pg_temp.kk('l3'), '2026-11') = 400 and pg_temp.desal() = 0);

-- Un plan que cambia el mes sin traer los movimientos deja asignaciones desalineadas: I2 general (AG002), y nada queda escrito.
insert into sj values ('foto_i2', to_jsonb(pg_temp.foto()));
insert into res values
  ('i2_sin_movs', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E1'), jsonb_build_object('fecha_ingreso_estimada', '2026-12-04')), 2));
insert into r (caso, ok) values
  ('I2 general: un plan que mueve el mes del ingreso sin traer los movimientos de las asignaciones: AG002 y la base queda como estaba',
    pg_temp.err('i2_sin_movs') = 'AG002' and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_i2'));

-- ---------------------------------------------------------------------------------------------------------------------
-- F3: el Ingreso CD cambia el mes del ingreso sin fijar (E5, compras C y D)
-- ---------------------------------------------------------------------------------------------------------------------
insert into snap values ('revcC0', pg_temp.crev(pg_temp.kk('cC'))), ('revcD0', pg_temp.crev(pg_temp.kk('cD')));
insert into res values ('id_l4_dic', jsonb_build_object('id', pg_temp.eid(pg_temp.kk('l4'), '2026-12')));
insert into res values
  ('f3', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E5'), jsonb_build_object('fecha_llegada_estimada', '2026-12-03'), '[]'::jsonb,
      pg_temp.cs(array[pg_temp.kk('cC'), pg_temp.kk('cD')]),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l4'), '2026-11'), pg_temp.kk('E5'), null), pg_temp.eid(pg_temp.kk('l4'), '2026-11'), pg_temp.kk('l4'), pg_temp.kk('cC'), 300, '2026-12', pg_temp.kk('E5'), null),
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('E5'), null), pg_temp.eid(pg_temp.kk('l5'), '2026-11'), pg_temp.kk('l5'), pg_temp.kk('cD'), 400, '2026-12', pg_temp.kk('E5'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l4'), '2026-11', 0), pg_temp.en(pg_temp.kk('l4'), '2026-12', 500), pg_temp.en(pg_temp.kk('l5'), '2026-11', 0), pg_temp.en(pg_temp.kk('l5'), '2026-12', 400)),
      '[]'::jsonb, '{"causa": "aduana"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F3: C1 cambia el Ingreso CD de E5 a 03-dic (aduana): el ingreso sin fijar sigue (mes dic), l4 nov 300 se funde con dic 200 (conserva su id), l5 nov 400 pasa a dic, revision +1 en las dos compras, un evento de embarque con causa aduana',
    pg_temp.good('f3') and pg_temp.per(pg_temp.kk('E5')) = '2026-12'
    and (select fecha_ingreso_estimada is null and fecha_llegada_estimada = date '2026-12-03' from compra_embarques where id = pg_temp.kk('E5'))
    and pg_temp.eu(pg_temp.kk('l4'), '2026-11') = 0 and pg_temp.eu(pg_temp.kk('l4'), '2026-12') = 500
    and pg_temp.eid(pg_temp.kk('l4'), '2026-12') = (pg_temp.rk('id_l4_dic') ->> 'id')::uuid
    and pg_temp.eu(pg_temp.kk('l5'), '2026-12') = 400
    and pg_temp.crev(pg_temp.kk('cC')) = pg_temp.sn('revcC0') + 1 and pg_temp.crev(pg_temp.kk('cD')) = pg_temp.sn('revcD0') + 1
    and pg_temp.naev(pg_temp.kk('E5'), 'cambiar_fecha') = 1
    and (select causa = 'aduana' and jsonb_array_length(compras) = 2 from compra_agrupador_eventos where embarque_id = pg_temp.kk('E5') and accion = 'cambiar_fecha')
    and pg_temp.desal() = 0);

-- F24: resumen de hitos (E5 tras F3; E1 tras F4 a F9).
create temp table resumen as
  select * from public.agrupador_hitos_resumen(array[pg_temp.kk('E1'), pg_temp.kk('E5'), pg_temp.kk('E1a')]);
insert into r (caso, ok) values
  ('F24: E5, Ingreso CD: fecha original 15-nov, 1 reprogramacion, ultima causa aduana; sus otros hitos sin reprogramaciones; el ingreso al stock sigue al Ingreso CD (0 reprogramaciones propias)',
    (select fecha_original = date '2026-11-15' and reprogramaciones = 1 and ultima_causa = 'aduana' from resumen where embarque_id = pg_temp.kk('E5') and hito = 'ingreso_cd')
    and (select bool_and(reprogramaciones = 0) from resumen where embarque_id = pg_temp.kk('E5') and hito in ('zarpe', 'arribo', 'inicio_operativo', 'ingreso_stock'))
    and (select count(*) from resumen where embarque_id = pg_temp.kk('E5') and paquete_id is null) = 5),
  ('F24: E1, Arribo: fecha original 08-nov, 1 reprogramacion (naviera); Zarpe sin cambios; Ingreso CD: F7 (naviera) cuenta y la vuelta a 15-nov (correccion) no, ultima causa correccion',
    (select fecha_original = date '2026-11-08' and reprogramaciones = 1 and ultima_causa = 'naviera' from resumen where embarque_id = pg_temp.kk('E1') and hito = 'arribo')
    and (select reprogramaciones = 0 and fecha_original = date '2026-10-05' from resumen where embarque_id = pg_temp.kk('E1') and hito = 'zarpe')
    and (select fecha_original = date '2026-11-15' and reprogramaciones = 1 and ultima_causa = 'correccion' from resumen where embarque_id = pg_temp.kk('E1') and hito = 'ingreso_cd')),
  ('F24 / F5: E1, ingreso al stock: fijarlo en 28-nov (cola_conteo) cuenta 1; fijarlo en 04-dic y volver a igualarlo (programacion) no suman atraso pero quedan en el historial (ultima causa programacion); fecha original 15-nov',
    (select reprogramaciones = 1 and fecha_original = date '2026-11-15' and ultima_causa = 'programacion' from resumen where embarque_id = pg_temp.kk('E1') and hito = 'ingreso_stock')
    and (select reprogramaciones = 0 and fecha_original = date '2026-11-30' from resumen where embarque_id = pg_temp.kk('E1') and hito = 'inicio_operativo')),
  ('F24: un embarque sin eventos de fechas devuelve sus cinco hitos con fecha original nula o la de su alta y 0 reprogramaciones',
    (select count(*) from resumen where embarque_id = pg_temp.kk('E1a') and paquete_id is null) = 5
    and (select bool_and(reprogramaciones = 0) from resumen where embarque_id = pg_temp.kk('E1a'))
    and (select fecha_original = date '2026-11-15' from resumen where embarque_id = pg_temp.kk('E1a') and hito = 'ingreso_cd'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Paquetes y lo al barrer (E2 = 270301, Ingreso CD 05-mar-27): F38 (piso), F10 y F11 (por partes, con temporada), F34, F35, F36, F38, F13
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('p1', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E2'), 'nombre', 'Al barrer tanda 1'), pg_temp.erev(pg_temp.kk('E2')), 2));
insert into res values
  ('p2', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E2'), 'nombre', 'Al barrer tanda 2'), pg_temp.erev(pg_temp.kk('E2')), 2));
insert into k select 'P1', (pg_temp.rk('p1') ->> 'paquete_id')::uuid;
insert into k select 'P2', (pg_temp.rk('p2') ->> 'paquete_id')::uuid;
insert into res values ('f38a_mal', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), '{}'::jsonb, jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-03-01'))), 2));
insert into res values ('f38a', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), '{}'::jsonb, jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-03-05', true))), 2));
insert into r (caso, ok) values
  ('F38 (a): fijar el ingreso de la tanda 1 en 01-mar-27 (antes de la llegada, 05-mar): el plan que lo deja asi viola I9 (AG002); el plan que lo sube al piso (05-mar, ajustado) se aplica y el mes del paquete es mar',
    pg_temp.err('f38a_mal') = 'AG002' and pg_temp.good('f38a')
    and (select fecha_ingreso_estimada = date '2027-03-05' and periodo_ingreso = date '2027-03-01' from compra_paquetes where id = pg_temp.kk('P1'))
    and pg_temp.desal() = 0),
  ('el codigo de un paquete nuevo de E2 es 2703##: el mes del Ingreso CD',
    (select codigo like '2703%' from compra_paquetes where id = pg_temp.kk('P1')));
select pg_temp.sellar();

-- Las dos tandas: tanda 1 con ingreso 04-abr y tanda 2 con 10-may (se fijan sin asignaciones: no mueve nada).
insert into res values
  ('f11_ing', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), '{}'::jsonb,
      jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-04-04'), pg_temp.pq(pg_temp.kk('P2'), pg_temp.kk('E2'), '2027-05-10')),
      extra => '{"causa": "programacion"}'), 2)),
  ('f11_ing_sin_causa', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), '{}'::jsonb,
      jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-04-05')), extra => '{"causa": null}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F11 (previo): fijar el ingreso de las dos tandas sin asignaciones: se aplica, no mueve nada; cambiar el ingreso de un paquete es reprogramar (sin causa: causa_requerida); el evento guarda la causa y las fotos traen el ingreso de cada paquete',
    pg_temp.good('f11_ing') and pg_temp.mot('f11_ing_sin_causa') = 'causa_requerida'
    and (select fecha_ingreso_estimada = date '2027-04-04' from compra_paquetes where id = pg_temp.kk('P1'))
    and (select fecha_ingreso_estimada = date '2027-05-10' and periodo_ingreso = date '2027-05-01' from compra_paquetes where id = pg_temp.kk('P2'))
    and (select (despues -> 'paquetes') @> jsonb_build_array(jsonb_build_object('id', pg_temp.kk('P2'), 'fecha_ingreso_estimada', '2027-05-10'))
           and causa = 'programacion'
           from compra_agrupador_eventos where embarque_id = pg_temp.kk('E2') and accion = 'cambiar_fecha' order by created_at desc limit 1)
    and pg_temp.desal() = 0);

-- Mover a paquetes, por partes: 300 u de la entrega de mar a la tanda 1 (abr) y 300 a la tanda 2 (may). Primero sin los repartos del
-- vector de la temporada: reparto_sin_vector y la base queda igual (F10).
insert into snap values ('revcA2', pg_temp.crev(pg_temp.kk('cA')));
insert into sj values ('foto_f10', to_jsonb(pg_temp.foto()));
insert into res values
  ('f10_sin_vector', pg_temp.r_ap(pg_temp.pl('mover_a_paquete', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cs(array[pg_temp.kk('cA')]),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 300, '2027-04', pg_temp.kk('E2'), pg_temp.kk('P1')),
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 300, '2027-05', pg_temp.kk('E2'), pg_temp.kk('P2'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-03', 0), pg_temp.en(pg_temp.kk('l2'), '2027-04', 700), pg_temp.en(pg_temp.kk('l2'), '2027-05', 300))), 2)),
  ('f11_sin_motivo', pg_temp.r_ap(pg_temp.pl('mover_a_paquete', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cs(array[pg_temp.kk('cA')]),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 300, '2027-04', pg_temp.kk('E2'), pg_temp.kk('P1'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-03', 300), pg_temp.en(pg_temp.kk('l2'), '2027-04', 700)), '[]'::jsonb, '{"motivo": null}'), 2)),
  ('f11_sin_causa', pg_temp.r_ap(pg_temp.pl('mover_a_paquete', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cs(array[pg_temp.kk('cA')]),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 300, '2027-04', pg_temp.kk('E2'), pg_temp.kk('P1'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-03', 300), pg_temp.en(pg_temp.kk('l2'), '2027-04', 700)), '[]'::jsonb, '{"causa": null}'), 2));
insert into r (caso, ok) values
  ('F10: mover lo al barrer de mar a las tandas (abr y may) sin el reparto del vector de la temporada nueva: reparto_sin_vector, no se mueve nada; mover_a_paquete que cambia de mes pide motivo y causa',
    pg_temp.mot('f10_sin_vector') = 'reparto_sin_vector' and pg_temp.mot('f11_sin_motivo') = 'motivo_requerido' and pg_temp.mot('f11_sin_causa') = 'causa_requerida'
    and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_f10'));

insert into res values
  ('f11', pg_temp.r_ap(pg_temp.pl('mover_a_paquete', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cs(array[pg_temp.kk('cA')]),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 300, '2027-04', pg_temp.kk('E2'), pg_temp.kk('P1')),
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('E2'), null), pg_temp.eid(pg_temp.kk('l2'), '2027-03'), pg_temp.kk('l2'), pg_temp.kk('cA'), 300, '2027-05', pg_temp.kk('E2'), pg_temp.kk('P2'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-03', 0), pg_temp.en(pg_temp.kk('l2'), '2027-04', 700), pg_temp.en(pg_temp.kk('l2'), '2027-05', 300)),
      jsonb_build_array(
        pg_temp.rep(pg_temp.kk('l2'), '2027-04', (select m1 from ctx), (select gml from ctx), 490, (select m2 from ctx), 210, 'invierno'),
        pg_temp.rep(pg_temp.kk('l2'), '2027-05', (select m1 from ctx), (select gml from ctx), 210, (select m2 from ctx), 90, 'invierno'))), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F11: por partes, 300 u a la tanda 1 (ingreso 04-abr) y 300 a la tanda 2 (10-may): l2 queda abr 700 (300 de la tanda 1 + 400 sin embarque) y may 300, cada una con su reparto de invierno; sum = 1 000 (I3); la compra sube una revision',
    pg_temp.good('f11') and pg_temp.eu(pg_temp.kk('l2'), '2027-03') = 0 and pg_temp.eu(pg_temp.kk('l2'), '2027-04') = 700 and pg_temp.eu(pg_temp.kk('l2'), '2027-05') = 300
    and pg_temp.sumeu(pg_temp.kk('l2')) = 1000
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l2'), '2027-04'), pg_temp.kk('E2'), pg_temp.kk('P1')) = 300
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l2'), '2027-05'), pg_temp.kk('E2'), pg_temp.kk('P2')) = 300
    and (select sum(unidades) = 700 and bool_and(temporada = 'invierno') from compra_linea_repartos where entrega_id = pg_temp.eid(pg_temp.kk('l2'), '2027-04'))
    and (select sum(unidades) = 300 and bool_and(temporada = 'invierno') from compra_linea_repartos where entrega_id = pg_temp.eid(pg_temp.kk('l2'), '2027-05'))
    and pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revcA2') + 1 and pg_temp.desal() = 0),
  ('F11: el mes de cada asignacion es el de su paquete (no el del embarque, que sigue en mar-27)',
    pg_temp.per(pg_temp.kk('E2')) = '2027-03' and (select count(*) from agrupadores_desalineados()) = 0
    and (select p.periodo_ingreso = date '2027-04-01' from compra_paquetes p where p.id = pg_temp.kk('P1')));

-- F34: «Agregar compras» con destino la tanda 2: 100 u de la entrega de abr sin embarque van a may-27 (mes de la tanda), no a mar-27.
-- Con el mes del embarque (mar) como destino, la I2 general la rechaza (AG002) y nada cambia.
insert into sj values ('foto_f34', to_jsonb(pg_temp.foto()));
insert into res values
  ('f34_mal', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cs(array[pg_temp.kk('cA')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l2'), '2027-04'), pg_temp.kk('l2'), pg_temp.kk('cA'), 100, '2027-03', pg_temp.kk('E2'), pg_temp.kk('P2'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-03', 100), pg_temp.en(pg_temp.kk('l2'), '2027-04', 600), pg_temp.en(pg_temp.kk('l2'), '2027-05', 300)),
      jsonb_build_array(
        pg_temp.rep(pg_temp.kk('l2'), '2027-03', (select m1 from ctx), (select gml from ctx), 70, (select m2 from ctx), 30, 'verano'),
        pg_temp.rep(pg_temp.kk('l2'), '2027-04', (select m1 from ctx), (select gml from ctx), 420, (select m2 from ctx), 180, 'invierno'))), 2));
insert into r (caso, ok) values
  ('F34 (negativo): asignar a la tanda 2 con el mes del embarque (mar) como destino deja la asignacion fuera de su mes de destino (may): AG002 y la base queda igual',
    pg_temp.err('f34_mal') = 'AG002' and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_f34'));
insert into res values
  ('f34', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E2')]), pg_temp.cs(array[pg_temp.kk('cA')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l2'), '2027-04'), pg_temp.kk('l2'), pg_temp.kk('cA'), 100, '2027-05', pg_temp.kk('E2'), pg_temp.kk('P2'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-04', 600), pg_temp.en(pg_temp.kk('l2'), '2027-05', 400)),
      jsonb_build_array(
        pg_temp.rep(pg_temp.kk('l2'), '2027-04', (select m1 from ctx), (select gml from ctx), 420, (select m2 from ctx), 180, 'invierno'),
        pg_temp.rep(pg_temp.kk('l2'), '2027-05', (select m1 from ctx), (select gml from ctx), 280, (select m2 from ctx), 120, 'invierno'))), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F34: asignar a la tanda 2 con destino may (el mes de la tanda): l2 queda abr 600 y may 400, sum 1 000, repartidas con invierno, sin AG002 ni desalineadas',
    pg_temp.good('f34') and pg_temp.eu(pg_temp.kk('l2'), '2027-04') = 600 and pg_temp.eu(pg_temp.kk('l2'), '2027-05') = 400 and pg_temp.sumeu(pg_temp.kk('l2')) = 1000
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l2'), '2027-05'), pg_temp.kk('E2'), pg_temp.kk('P2')) = 400 and pg_temp.desal() = 0);

-- F35: pasar_pendientes de E1 (cB, l3, 400 u) a E2 con paquete destino tanda 2: quedan en may-27 (mes de la tanda), no en mar-27.
insert into res values
  ('f35', pg_temp.r_ap(pg_temp.pl('pasar_pendientes', pg_temp.eb(array[pg_temp.kk('E1'), pg_temp.kk('E2')]), pg_temp.cda(array[pg_temp.kk('E1'), pg_temp.kk('E2')], array[pg_temp.kk('cB')]),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l3'), '2026-11'), pg_temp.kk('E1'), null), pg_temp.eid(pg_temp.kk('l3'), '2026-11'), pg_temp.kk('l3'), pg_temp.kk('cB'), 400, '2027-05', pg_temp.kk('E2'), pg_temp.kk('P2'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l3'), '2026-11', 0), pg_temp.en(pg_temp.kk('l3'), '2027-05', 400))), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F35: pasar los pendientes de E1 (400 u de l3) a E2 con paquete destino tanda 2: quedan en may-27, el mes de la tanda, no en mar-27',
    pg_temp.good('f35') and pg_temp.eu(pg_temp.kk('l3'), '2027-05') = 400 and pg_temp.eu(pg_temp.kk('l3'), '2026-11') = 0
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l3'), '2027-05'), pg_temp.kk('E2'), pg_temp.kk('P2')) = 400 and pg_temp.desal() = 0);

-- F36: mover_paquete de la tanda 2 (ingreso 10-may) de E2 a E3 (Ingreso CD 20-abr): conserva el 10-may, ninguna entrega cambia de mes.
insert into sj values ('foto_f36', to_jsonb(pg_temp.foto()));
insert into res values
  ('f36', pg_temp.r_ap(pg_temp.pl('mover_paquete', pg_temp.eb(array[pg_temp.kk('E2'), pg_temp.kk('E3')]), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_object('paquete_a_mover', jsonb_build_object('paquete_id', pg_temp.kk('P2'), 'embarque_destino_id', pg_temp.kk('E3')),
                         'paquetes', jsonb_build_array(pg_temp.pq(pg_temp.kk('P2'), pg_temp.kk('E3'), '2027-05-10')))), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F36: mover la tanda 2 de E2 a E3 (Ingreso CD 20-abr): conserva su ingreso 10-may, solo cambia el embarque de sus asignaciones, ninguna entrega cambia de mes, sin desalineadas',
    pg_temp.good('f36') and (select embarque_id = pg_temp.kk('E3') and fecha_ingreso_estimada = date '2027-05-10' from compra_paquetes where id = pg_temp.kk('P2'))
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l2'), '2027-05'), pg_temp.kk('E3'), pg_temp.kk('P2')) = 400
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l3'), '2027-05'), pg_temp.kk('E3'), pg_temp.kk('P2')) = 400
    and pg_temp.eu(pg_temp.kk('l2'), '2027-05') = 400 and pg_temp.desal() = 0
    and (select count(*) from compra_agrupador_eventos where paquete_id = pg_temp.kk('P2') and accion = 'mover_paquete') = 2);

-- Mover la tanda 2 de E3 a E4 (Ingreso CD 15-jun): sin ajustar el ingreso, I9 (AG002); con el ajuste al piso (15-jun) y los movimientos de
-- sus asignaciones de may a jun (con el reparto de la temporada, invierno), se aplica.
insert into sj values ('foto_f36b', to_jsonb(pg_temp.foto()));
insert into res values
  ('f36_mal', pg_temp.r_ap(pg_temp.pl('mover_paquete', pg_temp.eb(array[pg_temp.kk('E3'), pg_temp.kk('E4')]), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_object('paquete_a_mover', jsonb_build_object('paquete_id', pg_temp.kk('P2'), 'embarque_destino_id', pg_temp.kk('E4')))), 2)),
  ('f36_otro', pg_temp.r_ap(pg_temp.pl('mover_paquete', pg_temp.eb(array[pg_temp.kk('E3'), pg_temp.kk('E4')]), '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      jsonb_build_object('paquete_a_mover', jsonb_build_object('paquete_id', pg_temp.kk('P2'), 'embarque_destino_id', pg_temp.kk('E4')),
                         'paquetes', jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E4'), '2027-06-15')))), 2));
insert into r (caso, ok) values
  ('F38 (final): un plan armado a mano que deja un paquete antes del piso de su embarque (tanda 2, 10-may, en E4 que llega el 15-jun): AG002 y nada cambia; un plan con el paquete de otro: AG002',
    pg_temp.err('f36_mal') = 'AG002' and pg_temp.err('f36_otro') = 'AG002' and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_f36b'));
insert into res values
  ('f36_ok', pg_temp.r_ap(pg_temp.pl('mover_paquete', pg_temp.eb(array[pg_temp.kk('E3'), pg_temp.kk('E4')]), pg_temp.cda(array[pg_temp.kk('E3'), pg_temp.kk('E4')], '{}'),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-05'), pg_temp.kk('E3'), pg_temp.kk('P2')), pg_temp.eid(pg_temp.kk('l2'), '2027-05'), pg_temp.kk('l2'), pg_temp.kk('cA'), 400, '2027-06', pg_temp.kk('E4'), pg_temp.kk('P2')),
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l3'), '2027-05'), pg_temp.kk('E3'), pg_temp.kk('P2')), pg_temp.eid(pg_temp.kk('l3'), '2027-05'), pg_temp.kk('l3'), pg_temp.kk('cB'), 400, '2027-06', pg_temp.kk('E4'), pg_temp.kk('P2'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-05', 0), pg_temp.en(pg_temp.kk('l2'), '2027-06', 400), pg_temp.en(pg_temp.kk('l3'), '2027-05', 0), pg_temp.en(pg_temp.kk('l3'), '2027-06', 400)),
      jsonb_build_array(pg_temp.rep(pg_temp.kk('l2'), '2027-06', (select m1 from ctx), (select gml from ctx), 280, (select m2 from ctx), 120, 'invierno')),
      jsonb_build_object('paquete_a_mover', jsonb_build_object('paquete_id', pg_temp.kk('P2'), 'embarque_destino_id', pg_temp.kk('E4')),
                         'paquetes', jsonb_build_array(pg_temp.pq(pg_temp.kk('P2'), pg_temp.kk('E4'), '2027-06-15', true)))), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F36: mover la tanda 2 a E4 (Ingreso CD 15-jun): el ingreso sube al piso (15-jun), sus asignaciones pasan de may a jun y el lote se reparte de nuevo (invierno); l2 queda abr 600 y jun 400; sin desalineadas, I9 en verde',
    pg_temp.good('f36_ok') and (select embarque_id = pg_temp.kk('E4') and fecha_ingreso_estimada = date '2027-06-15' and periodo_ingreso = date '2027-06-01' from compra_paquetes where id = pg_temp.kk('P2'))
    and pg_temp.eu(pg_temp.kk('l2'), '2027-05') = 0 and pg_temp.eu(pg_temp.kk('l2'), '2027-06') = 400 and pg_temp.eu(pg_temp.kk('l2'), '2027-04') = 600
    and (select sum(unidades) = 400 and bool_and(temporada = 'invierno') from compra_linea_repartos where entrega_id = pg_temp.eid(pg_temp.kk('l2'), '2027-06'))
    and pg_temp.au(pg_temp.eid(pg_temp.kk('l3'), '2027-06'), pg_temp.kk('E4'), pg_temp.kk('P2')) = 400 and pg_temp.desal() = 0);

-- F38 (b) y (c): el Ingreso CD de E2 pasa a 20-abr (la tanda 1, 04-abr, sube a 20-abr y sigue en abr) y despues a 12-may (la sube a 12-may:
-- su asignacion pasa de abr a may). En (b) lo que no esta en paquete (nada) no se mueve.
insert into res values
  ('f38b', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), jsonb_build_object('fecha_llegada_estimada', '2027-04-20'),
      jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-04-20', true)), extra => '{"causa": "naviera"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F38 (b): mover el Ingreso CD de E2 a 20-abr (naviera): la tanda 1 (04-abr) sube a 20-abr y sigue en abr; sin desalineadas; un solo evento con el motivo y la causa',
    pg_temp.good('f38b') and (select fecha_ingreso_estimada = date '2027-04-20' from compra_paquetes where id = pg_temp.kk('P1'))
    and pg_temp.per(pg_temp.kk('E2')) = '2027-04' and pg_temp.desal() = 0
    and (select causa = 'naviera' and motivo = 'humo 38' from compra_agrupador_eventos where embarque_id = pg_temp.kk('E2') and accion = 'cambiar_fecha' order by created_at desc limit 1));
insert into res values
  ('f38c', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), jsonb_build_object('fecha_llegada_estimada', '2027-05-12'),
      jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-05-12', true)),
      pg_temp.cs(array[pg_temp.kk('cA')]),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-04'), pg_temp.kk('E2'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l2'), '2027-04'), pg_temp.kk('l2'), pg_temp.kk('cA'), 300, '2027-05', pg_temp.kk('E2'), pg_temp.kk('P1'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-04', 300), pg_temp.en(pg_temp.kk('l2'), '2027-05', 300)),
      jsonb_build_array(pg_temp.rep(pg_temp.kk('l2'), '2027-04', (select m1 from ctx), (select gml from ctx), 210, (select m2 from ctx), 90, 'invierno'),
                        pg_temp.rep(pg_temp.kk('l2'), '2027-05', (select m1 from ctx), (select gml from ctx), 210, (select m2 from ctx), 90, 'invierno')),
      '{"causa": "naviera"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F38 (c): mover el Ingreso CD de E2 a 12-may: la tanda 1 sube a 12-may (ajustada), su asignacion pasa de abr a may; l2 queda abr 300, may 300, jun 400; I9 en verde',
    pg_temp.good('f38c') and (select fecha_ingreso_estimada = date '2027-05-12' from compra_paquetes where id = pg_temp.kk('P1'))
    and pg_temp.per(pg_temp.kk('E2')) = '2027-05' and pg_temp.eu(pg_temp.kk('l2'), '2027-04') = 300 and pg_temp.eu(pg_temp.kk('l2'), '2027-05') = 300 and pg_temp.eu(pg_temp.kk('l2'), '2027-06') = 400
    and pg_temp.sumeu(pg_temp.kk('l2')) = 1000 and pg_temp.desal() = 0);
insert into sj values ('foto_f38d', to_jsonb(pg_temp.foto()));
insert into res values
  ('f38_mal', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), jsonb_build_object('fecha_llegada_estimada', '2027-06-30'), extra => '{"causa": "naviera"}'), 2));
insert into r (caso, ok) values
  ('F38: atrasar el Ingreso CD de E2 a 30-jun con un plan que no sube la tanda 1 (12-may): I9, AG002, nada cambia',
    pg_temp.err('f38_mal') = 'AG002' and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_f38d'));

-- Un plan cuya entrada de `paquetes` dice que el paquete esta en otro embarque que el real (un mover_paquete lo cambio entre la lectura y el
-- candado): agrupador_cambio, nada escrito.
insert into sj values ('foto_paq_otro', to_jsonb(pg_temp.foto()));
insert into res values
  ('paq_otro_emb', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E3'), '{}'::jsonb, jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E3'), '2027-06-01')), extra => '{"causa": "programacion"}'), 2));
insert into r (caso, ok) values
  ('(c) de §2.9: un plan con un paquete que ya no esta en el embarque del plan (la tanda 1 sigue en E2, el plan dice E3): agrupador_cambio y nada cambia',
    pg_temp.mot('paq_otro_emb') = 'agrupador_cambio' and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_paq_otro'));

-- F13: la tanda 1 de E2 (ingreso 12-may, 300 u de l2 en may) con una recepcion vinculada (se inserta como postgres): cambiar su ingreso de
-- mes da asignacion_con_recepciones; dentro del mismo mes se acepta. Con una recepcion en una asignacion sin paquete de E5: cambiar el
-- Ingreso CD a otro mes da embarque_con_recepciones.
insert into compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion, asignacion_id)
select pg_temp.kk('l2'), date '2027-05-01', 50, current_date, pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-05'), pg_temp.kk('E2'), pg_temp.kk('P1'));
insert into sj values ('foto_f13', to_jsonb(pg_temp.foto()));
insert into res values
  ('f13_mes', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), '{}'::jsonb, jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-06-10')),
      pg_temp.cs(array[pg_temp.kk('cA')]),
      jsonb_build_array(pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l2'), '2027-05'), pg_temp.kk('E2'), pg_temp.kk('P1')), pg_temp.eid(pg_temp.kk('l2'), '2027-05'), pg_temp.kk('l2'), pg_temp.kk('cA'), 300, '2027-06', pg_temp.kk('E2'), pg_temp.kk('P1'))),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l2'), '2027-05', 0), pg_temp.en(pg_temp.kk('l2'), '2027-06', 700)),
      jsonb_build_array(pg_temp.rep(pg_temp.kk('l2'), '2027-06', (select m1 from ctx), (select gml from ctx), 490, (select m2 from ctx), 210, 'invierno')),
      '{"causa": "programacion"}'), 2)),
  ('f13_sin_movs', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), '{}'::jsonb, jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-06-10')),
      extra => '{"causa": "programacion"}'), 2));
insert into r (caso, ok) values
  ('F13: el ingreso de una tanda con una recepcion vinculada, cambiando de mes: asignacion_con_recepciones; si el plan omitiera el movimiento, tambien se rechaza por la asignacion con recepciones (no cae en AG002) y nada cambia',
    pg_temp.mot('f13_mes') = 'asignacion_con_recepciones' and pg_temp.mot('f13_sin_movs') = 'asignacion_con_recepciones'
    and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_f13'));
insert into res values
  ('f13_mismo_mes', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E2'), '{}'::jsonb, jsonb_build_array(pg_temp.pq(pg_temp.kk('P1'), pg_temp.kk('E2'), '2027-05-20')),
      extra => '{"causa": "programacion"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F13: cambiar el ingreso de la tanda con recepciones dentro del mismo mes (12-may a 20-may) se acepta: no mueve ninguna entrega',
    pg_temp.good('f13_mismo_mes') and (select fecha_ingreso_estimada = date '2027-05-20' from compra_paquetes where id = pg_temp.kk('P1')) and pg_temp.desal() = 0);
insert into compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion, asignacion_id)
select pg_temp.kk('l5'), date '2026-12-01', 40, current_date, pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('E5'), null);
insert into sj values ('foto_f13b', to_jsonb(pg_temp.foto()));
insert into res values
  ('f13_emb', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E5'), jsonb_build_object('fecha_llegada_estimada', '2027-01-10'), '[]'::jsonb,
      pg_temp.cs(array[pg_temp.kk('cC'), pg_temp.kk('cD')]),
      jsonb_build_array(
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l4'), '2026-12'), pg_temp.kk('E5'), null), pg_temp.eid(pg_temp.kk('l4'), '2026-12'), pg_temp.kk('l4'), pg_temp.kk('cC'), 300, '2027-01', pg_temp.kk('E5'), null),
        pg_temp.mv(pg_temp.aid(pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('E5'), null), pg_temp.eid(pg_temp.kk('l5'), '2026-12'), pg_temp.kk('l5'), pg_temp.kk('cD'), 400, '2027-01', pg_temp.kk('E5'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l4'), '2026-12', 200), pg_temp.en(pg_temp.kk('l4'), '2027-01', 300), pg_temp.en(pg_temp.kk('l5'), '2026-12', 0), pg_temp.en(pg_temp.kk('l5'), '2027-01', 400)),
      '[]'::jsonb, '{"causa": "aduana"}'), 2));
insert into r (caso, ok) values
  ('F13: cambiar el Ingreso CD de E5 (otro mes) con una asignacion sin paquete con recepciones: embarque_con_recepciones y nada cambia',
    pg_temp.mot('f13_emb') = 'embarque_con_recepciones' and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_f13b'));

-- ---------------------------------------------------------------------------------------------------------------------
-- F45: I2 general sobre todas las asignaciones del embarque y agrupadores_desalineados con paquetes de ingreso propio
-- ---------------------------------------------------------------------------------------------------------------------
insert into res values
  ('e9', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E9 H38', 'tipo', 'importacion', 'fecha_llegada_estimada', '2027-05-05'), null, 2));
insert into k select 'E9', (pg_temp.rk('e9') ->> 'embarque_id')::uuid;
insert into res values ('p9', pg_temp.r_gp(jsonb_build_object('embarque_id', pg_temp.kk('E9'), 'nombre', 'Paquete P9'), pg_temp.erev(pg_temp.kk('E9')), 2));
insert into k select 'P9', (pg_temp.rk('p9') ->> 'paquete_id')::uuid;
insert into res values ('p9_ing', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E9'), '{}'::jsonb, jsonb_build_array(pg_temp.pq(pg_temp.kk('P9'), pg_temp.kk('E9'), '2027-05-20'))), 2));
insert into compras (id, proveedor_id, origen, estado, fecha_compra, confirmada_at)
select pg_temp.id(9006), sur, 'carga_inicial', 'confirmada', date '2026-07-14', now() from ctx
union all select pg_temp.id(9007), sur, 'carga_inicial', 'confirmada', date '2026-07-15', now() from ctx;
insert into compra_lineas (id, compra_id, tipo, genero_mundo_linea_id, marca_id, unidades, llegada_periodo, costo_unitario)
select pg_temp.id(9106), pg_temp.id(9006), 'especifica', gml, null::uuid, 300, date '2027-05-01', 9 from ctx
union all select pg_temp.id(9107), pg_temp.id(9007), 'especifica', gml, null, 50, date '2027-05-01', 9 from ctx;
insert into compra_linea_entregas (linea_id, periodo, unidades, origen) values
  (pg_temp.id(9106), date '2027-05-01', 100, 'manual'), (pg_temp.id(9106), date '2027-06-01', 200, 'manual'), (pg_temp.id(9107), date '2027-05-01', 50, 'manual');
insert into k values ('cE', pg_temp.id(9006)), ('cF', pg_temp.id(9007)), ('l6', pg_temp.id(9106)), ('l7', pg_temp.id(9107));
insert into compra_entrega_asignaciones (entrega_id, embarque_id, paquete_id, unidades)
values (pg_temp.eid(pg_temp.kk('l6'), '2027-05'), pg_temp.kk('E9'), pg_temp.kk('P9'), 100);
insert into r (caso, ok) values
  ('F45 (previo): una asignacion de un paquete con ingreso propio (may) alineada a su paquete: agrupadores_desalineados() no la cuenta (aunque el mes del embarque, E9, sea may tambien se prueba con la siguiente, de jun)',
    pg_temp.good('p9_ing') and pg_temp.desal() = 0);
insert into compra_entrega_asignaciones (entrega_id, embarque_id, paquete_id, unidades)
values (pg_temp.eid(pg_temp.kk('l6'), '2027-06'), pg_temp.kk('E9'), pg_temp.kk('P9'), 200);
insert into sj values ('foto_f45', to_jsonb(pg_temp.foto()));
insert into res values
  ('f45', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E9')]), pg_temp.cs(array[pg_temp.kk('cF'), pg_temp.kk('cE')]),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l7'), '2027-05'), pg_temp.kk('l7'), pg_temp.kk('cF'), 50, '2027-05', pg_temp.kk('E9'), pg_temp.kk('P9')))), 2));
insert into r (caso, ok) values
  ('F45: una asignacion de E9 en jun con su paquete en may (insertada como postgres): agrupadores_desalineados() devuelve solo esa (la de may, alineada a su paquete, no); un plan asignar sobre E9 que la deja fuera de su mes de destino: AG002 y nada cambia',
    (select count(*) = 1 and bool_and(a.entrega_id = pg_temp.eid(pg_temp.kk('l6'), '2027-06') and a.periodo = date '2027-06-01' and a.periodo_llegada = date '2027-05-01')
       from agrupadores_desalineados() a)
    and pg_temp.err('f45') = 'AG002' and to_jsonb(pg_temp.foto()) = pg_temp.sjk('foto_f45'));
delete from compra_entrega_asignaciones where entrega_id = pg_temp.eid(pg_temp.kk('l6'), '2027-06');
insert into r (caso, ok) values ('F45: sin la asignacion desalineada, vuelve a 0', pg_temp.desal() = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- Hitos que ya ocurrieron (I7): F19, F20, F21, F40. Fechas relativas a hoy (no hay reloj que simular).
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function pg_temp.d(n integer) returns text language sql as $f$ select to_char(current_date + n, 'YYYY-MM-DD') $f$;

-- E7: el caso de Javier. Ingreso CD hace 10 dias, sin Zarpe ni Arribo; el Inicio operativo empezo hace 7 dias a las 09:22.
insert into res values
  ('e7', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E7 H38', 'tipo', 'importacion', 'fecha_llegada_estimada', pg_temp.d(-10)), null, 2)),
  ('e8', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E8 H38', 'tipo', 'importacion', 'fecha_llegada_estimada', pg_temp.d(20)), null, 2));
insert into k select 'E7', (pg_temp.rk('e7') ->> 'embarque_id')::uuid;
insert into k select 'E8', (pg_temp.rk('e8') ->> 'embarque_id')::uuid;
insert into res values
  ('f21_futuro', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('fecha_inicio_operativo_estimada', pg_temp.d(1), 'hora_inicio_operativo', '11:00', 'hito_confirmado', 'inicio_operativo'),
      extra => '{"motivo": null, "causa": null}'), 2)),
  ('f21_hora_sola', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('hora_inicio_operativo', '09:22'), extra => '{"motivo": null, "causa": null}'), 2)),
  ('f21', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('fecha_inicio_operativo_estimada', pg_temp.d(-7), 'hora_inicio_operativo', '09:22', 'hito_confirmado', 'inicio_operativo'),
      extra => '{"motivo": null, "causa": null}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F21: el caso de Javier (Zarpe y Arribo sin fecha, Ingreso CD hace 10 dias): se confirma hito_confirmado = inicio_operativo con Inicio operativo de hace 7 dias 09:22, sin motivo ni causa (no reprograma); pasa a en_transito; el hito cumple I7',
    pg_temp.mot('f21_hora_sola') = 'hora_sin_fecha' and pg_temp.good('f21')
    and (select hito_confirmado = 'inicio_operativo' and estado = 'en_transito' and fecha_salida_estimada is null and fecha_puerto_estimada is null
           and fecha_inicio_operativo_estimada = current_date - 7 and hora_inicio_operativo = time '09:22' from compra_embarques where id = pg_temp.kk('E7'))
    and public.agrupador_hito_violado(pg_temp.kk('E7')) is null),
  ('F21: confirmar con el Inicio operativo de manana: fecha_futura (el embarque no queda con un hito ocurrido en el futuro)',
    pg_temp.mot('f21_futuro') = 'fecha_futura'),
  ('F21 / F25: el ingreso al stock sin fijar sigue al Ingreso CD (mes del Ingreso CD)',
    (select periodo_llegada = date_trunc('month', current_date - 10)::date from compra_embarques where id = pg_temp.kk('E7')));

-- F40 (a): cambiar el Inicio operativo confirmado a una fecha futura: fecha_futura. (b): lo mismo bajando en el mismo envio el hito
-- confirmado: se acepta como reprogramacion (pide motivo y causa). (c): vaciar el Inicio operativo confirmado: fecha_requerida.
insert into res values
  ('f40a', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('fecha_inicio_operativo_estimada', pg_temp.d(9)), extra => '{"causa": "cola_conteo"}'), 2)),
  ('f40b_sin', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('fecha_inicio_operativo_estimada', pg_temp.d(9), 'hito_confirmado', null), extra => '{"motivo": null, "causa": null}'), 2)),
  ('f40b', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('fecha_inicio_operativo_estimada', pg_temp.d(9), 'hito_confirmado', null), extra => '{"causa": "cola_conteo"}'), 2));
select pg_temp.sellar();
insert into r (caso, ok) values
  ('F40 (a): con el Inicio operativo confirmado, moverlo a una fecha futura: fecha_futura; (b) bajando en el mismo envio el hito confirmado: sin motivo ni causa pide motivo; con ellos se acepta como reprogramacion',
    pg_temp.mot('f40a') = 'fecha_futura' and pg_temp.mot('f40b_sin') = 'motivo_requerido' and pg_temp.good('f40b')
    and (select hito_confirmado is null and fecha_inicio_operativo_estimada = current_date + 9 and estado = 'en_transito' from compra_embarques where id = pg_temp.kk('E7'))
    and (select causa = 'cola_conteo' from compra_agrupador_eventos where embarque_id = pg_temp.kk('E7') and accion = 'cambiar_fecha' order by created_at desc limit 1));
insert into res values
  ('f40_vuelve', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('fecha_inicio_operativo_estimada', pg_temp.d(-7), 'hito_confirmado', 'inicio_operativo'), extra => '{"causa": "correccion"}'), 2));
insert into res values
  ('f40c', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('fecha_inicio_operativo_estimada', null), extra => '{"causa": "correccion"}'), 2));
insert into r (caso, ok) values
  ('F40 (c): con el hito confirmado inicio_operativo, vaciar el Inicio operativo (y su hora): fecha_requerida',
    pg_temp.good('f40_vuelve') and pg_temp.mot('f40c') = 'fecha_requerida'
    and (select fecha_inicio_operativo_estimada = current_date - 7 and hora_inicio_operativo = time '09:22' from compra_embarques where id = pg_temp.kk('E7')));
-- F40 (d): pasar a local un embarque sin Arribo y sin hito arribo: se acepta; F40 (e): los check de la base.
insert into res values
  ('f40d', pg_temp.r_ge(jsonb_build_object('id', pg_temp.kk('E7'), 'nombre', 'Embarque E7 H38', 'tipo', 'local'), pg_temp.erev(pg_temp.kk('E7')), 2));
insert into r (caso, ok) values
  ('F40 (d): un embarque sin Arribo y sin hito arribo pasa a local por PATCH',
    pg_temp.good('f40d') and (select tipo = 'local' from compra_embarques where id = pg_temp.kk('E7'))),
  ('F40 (e): como postgres, hito_confirmado = llegada, causa = clima, hora sin fecha, origen de 81 caracteres: violan su check (23514)',
    pg_temp.falla('update public.compra_embarques set hito_confirmado = ''llegada'' where id = ''' || pg_temp.kk('E8') || '''', '23514')
    and pg_temp.falla('insert into public.compra_agrupador_eventos (embarque_id, accion, causa) values (''' || pg_temp.kk('E8') || ''', ''cambiar_fecha'', ''clima'')', '23514')
    and pg_temp.falla('update public.compra_embarques set hora_inicio_operativo = ''09:00'' where id = ''' || pg_temp.kk('E8') || '''', '23514')
    and pg_temp.falla('update public.compra_embarques set origen = repeat(''x'', 81) where id = ''' || pg_temp.kk('E8') || '''', '23514'));

-- F20 (E8, planificado, Ingreso CD en 20 dias): Arribo futuro marcado como ocurrido: fecha_futura; Zarpe de hace 3 dias marcado: pasa a
-- en_transito y confirma el hito; volver a planificado con un hito confirmado: hito_confirmado.
insert into res values
  ('f20_arribo', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E8'), jsonb_build_object('fecha_puerto_estimada', pg_temp.d(5), 'hito_confirmado', 'arribo'), extra => '{"motivo": null, "causa": null}'), 2)),
  ('f20_zarpe', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E8'), jsonb_build_object('fecha_salida_estimada', pg_temp.d(-3), 'hito_confirmado', 'zarpe'), extra => '{"motivo": null, "causa": null}'), 2));
select pg_temp.sellar();
insert into res values
  ('f20_volver', pg_temp.r_ce('embarque', pg_temp.kk('E8'), 'volver_a_planificado', pg_temp.erev(pg_temp.kk('E8')), null, 2));
insert into r (caso, ok) values
  ('F20: el Arribo futuro marcado como ocurrido: fecha_futura; marcar el Zarpe de hace 3 dias confirma el hito y pasa el embarque de planificado a en_transito',
    pg_temp.mot('f20_arribo') = 'fecha_futura' and pg_temp.good('f20_zarpe')
    and (select estado = 'en_transito' and hito_confirmado = 'zarpe' and fecha_salida_estimada = current_date - 3 and fecha_puerto_estimada is null from compra_embarques where id = pg_temp.kk('E8'))),
  ('F20: volver a planificado con un hito confirmado: hito_confirmado (y el estado no cambia)',
    pg_temp.mot('f20_volver') = 'hito_confirmado' and (select estado = 'en_transito' from compra_embarques where id = pg_temp.kk('E8')));

-- F19: un Zarpe posterior al Ingreso CD bloquea; si en el mismo envio el Ingreso CD pasa mas tarde, se aplica (E6, Ingreso CD en 20 dias).
insert into res values ('e6', pg_temp.r_ge(jsonb_build_object('nombre', 'Embarque E6 H38', 'tipo', 'importacion', 'fecha_llegada_estimada', pg_temp.d(20)), null, 2));
insert into k select 'E6', (pg_temp.rk('e6') ->> 'embarque_id')::uuid;
insert into res values
  ('f19_tarde', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E6'), jsonb_build_object('fecha_salida_estimada', pg_temp.d(25)), extra => '{"motivo": null, "causa": null}'), 2)),
  ('f19_junto', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E6'), jsonb_build_object('fecha_salida_estimada', pg_temp.d(25), 'fecha_llegada_estimada', pg_temp.d(30)), extra => '{"causa": "naviera"}'), 2));
insert into r (caso, ok) values
  ('F19: Zarpe posterior al Ingreso CD: salida_despues_de_llegada; si en el mismo envio el Ingreso CD pasa mas tarde: se aplica; hora sin fecha en un plan: hora_sin_fecha; Arribo en un local: puerto_en_local',
    pg_temp.mot('f19_tarde') = 'salida_despues_de_llegada' and pg_temp.good('f19_junto')
    and (select fecha_salida_estimada = current_date + 25 and fecha_llegada_estimada = current_date + 30 from compra_embarques where id = pg_temp.kk('E6')));
insert into res values
  ('f19_hora_plan', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E6'), jsonb_build_object('hora_inicio_operativo', '10:00'), extra => '{"motivo": null, "causa": null}'), 2)),
  ('f19_local_plan', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E7'), jsonb_build_object('fecha_puerto_estimada', pg_temp.d(-8)), extra => '{"motivo": null, "causa": null}'), 2)),
  ('f19_vacio', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E6'), '{}'::jsonb, extra => '{"motivo": null, "causa": null}'), 2));
insert into r (caso, ok) values
  ('F19: hora sin fecha en un plan: hora_sin_fecha; Arribo en un embarque local: puerto_en_local; un plan sin ningun cambio: sin_cambios',
    pg_temp.mot('f19_hora_plan') = 'hora_sin_fecha' and pg_temp.mot('f19_local_plan') = 'puerto_en_local' and pg_temp.mot('f19_vacio') = 'sin_cambios');

-- Estados: un embarque recibido admite cambios de Zarpe, Arribo, Inicio operativo y hito confirmado, pero no del Ingreso CD ni del ingreso al
-- stock; uno cancelado, nada.
update compra_embarques set estado = 'recibido' where id = pg_temp.kk('E8');
insert into res values
  ('est_ing', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E8'), jsonb_build_object('fecha_llegada_estimada', pg_temp.d(31))), 2)),
  ('est_ok', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E8'), jsonb_build_object('fecha_puerto_estimada', pg_temp.d(-2)), extra => '{"motivo": null, "causa": null}'), 2));
update compra_embarques set estado = 'cancelado' where id = pg_temp.kk('E8');
insert into res values
  ('est_cancel', pg_temp.r_ap(pg_temp.pf(pg_temp.kk('E8'), jsonb_build_object('fecha_puerto_estimada', pg_temp.d(-1)), extra => '{"causa": "naviera"}'), 2));
insert into r (caso, ok) values
  ('estados de cambiar_fecha: recibido acepta el Arribo pero no el Ingreso CD (embarque_no_editable); cancelado no acepta nada (embarque_no_editable)',
    pg_temp.mot('est_ing') = 'embarque_no_editable' and pg_temp.good('est_ok') and pg_temp.mot('est_cancel') = 'embarque_no_editable');

-- ---------------------------------------------------------------------------------------------------------------------
-- Numero de OC: F27 a F30 y F43 (editar_oc_compra)
-- ---------------------------------------------------------------------------------------------------------------------
insert into sj values ('h_oc0', pg_temp.huella()), ('plan_cs_antes', pg_temp.cs(array[pg_temp.kk('cA')]));
insert into snap values ('revcA_oc', pg_temp.crev(pg_temp.kk('cA'))), ('ncev_oc', (select count(*) from compra_eventos));
insert into res values
  ('oc1', pg_temp.r_oc(pg_temp.kk('cA'), null, '4500012345', null, 2));
insert into r (caso, ok) values
  ('F27: registrar la OC 4500012345 en cA (sin OC, antes = null): se guarda, compras.revision igual, un evento editar_oc con antes { numero_oc: null } y despues, y la huella del flujo cambia (un evento) sin cambiar la suma de revisiones',
    pg_temp.good('oc1') and (select numero_oc = '4500012345' from compras where id = pg_temp.kk('cA'))
    and pg_temp.crev(pg_temp.kk('cA')) = pg_temp.sn('revcA_oc')
    and (select count(*) from compra_eventos) = pg_temp.sn('ncev_oc') + 1
    and (select antes = '{"numero_oc": null}'::jsonb and despues = '{"numero_oc": "4500012345"}'::jsonb and resumen = 'OC: — → 4500012345'
           from compra_eventos where compra_id = pg_temp.kk('cA') and accion = 'editar_oc')
    and pg_temp.huella() <> pg_temp.sjk('h_oc0')
    and (pg_temp.huella() -> 'compras' ->> 'revision') = (pg_temp.sjk('h_oc0') -> 'compras' ->> 'revision')
    and (pg_temp.huella() -> 'compras' ->> 'eventos')::integer = (pg_temp.sjk('h_oc0') -> 'compras' ->> 'eventos')::integer + 1);
insert into res values
  ('oc_reintento', pg_temp.r_oc(pg_temp.kk('cA'), null, '4500012345', null, 2)),
  ('oc_otra_persona', pg_temp.r_oc(pg_temp.kk('cA'), null, '4500099999', null, 3)),
  ('oc_inexistente', pg_temp.r_oc(pg_temp.id(1), null, 'X1', null, 2)),
  ('oc_larga', pg_temp.r_oc(pg_temp.kk('cB'), null, repeat('9', 41), null, 2));
insert into r (caso, ok) values
  ('F43: el reintento tras un corte de red (mismo antes = null y mismo numero, ya guardado) devuelve sin_cambios, no oc_cambio',
    pg_temp.mot('oc_reintento') = 'sin_cambios'),
  ('F28: dos personas editan con antes = null; la segunda llega despues con otro numero: oc_cambio y no escribe',
    pg_temp.mot('oc_otra_persona') = 'oc_cambio' and (select numero_oc = '4500012345' from compras where id = pg_temp.kk('cA'))),
  ('editar_oc_compra: compra inexistente: no_encontrado; una OC de 41 caracteres: oc_invalida',
    pg_temp.mot('oc_inexistente') = 'no_encontrado' and pg_temp.mot('oc_larga') = 'oc_invalida');
-- El plan previsualizado antes de registrar la OC (con la revision que tenia la compra) se aplica sin compra_cambio: asignar la entrega de
-- dic de l1 (200 u, sin embarque) a E1 (mes nov).
insert into res values
  ('oc_plan_viejo', pg_temp.r_ap(pg_temp.pl('asignar', pg_temp.eb(array[pg_temp.kk('E1')]), (pg_temp.sjk('plan_cs_antes') || pg_temp.cs(array[pg_temp.kk('cB')])),
      jsonb_build_array(pg_temp.mv(null, pg_temp.eid(pg_temp.kk('l1'), '2026-12'), pg_temp.kk('l1'), pg_temp.kk('cA'), 200, '2026-11', pg_temp.kk('E1'), null)),
      jsonb_build_array(pg_temp.en(pg_temp.kk('l1'), '2026-11', 500), pg_temp.en(pg_temp.kk('l1'), '2026-12', 0))), 2));
insert into r (caso, ok) values
  ('F27: un plan de movimiento previsualizado ANTES de registrar la OC sobre la misma compra se aplica sin compra_cambio (la OC no sube la revision)',
    pg_temp.good('oc_plan_viejo') and pg_temp.eu(pg_temp.kk('l1'), '2026-11') = 500 and pg_temp.desal() = 0);

-- F29: una compra cancelada no se edita. F30: la misma OC en otra compra viva del mismo proveedor: oc_repetida (tambien con espacios o en
-- otra caja de letras); en otro proveedor: se guarda con el aviso oc_de_otro_proveedor; cancelar la compra libera la OC; quitar la OC
-- deja el evento «OC: 7000 → —».
insert into res values ('oc_x', pg_temp.r_oc(pg_temp.kk('cX'), null, '7000', null, 2));
update compras set estado = 'cancelada', cancelada_at = now(), motivo_cancelacion = 'humo' where id = pg_temp.kk('cX');
insert into res values
  ('oc_cancelada', pg_temp.r_oc(pg_temp.kk('cX'), '7000', '7001', null, 2)),
  ('oc_rep', pg_temp.r_oc(pg_temp.kk('cC'), null, '4500012345', null, 2)),
  ('oc_rep_esp', pg_temp.r_oc(pg_temp.kk('cC'), null, '  4500012345 ', null, 2));
insert into snap values ('cC_sin_oc', (select count(*) from compras where id = pg_temp.kk('cC') and numero_oc is null));
insert into res values
  ('oc_d', pg_temp.r_oc(pg_temp.kk('cD'), null, '4500AB', null, 2)),
  ('oc_b_caja', pg_temp.r_oc(pg_temp.kk('cB'), null, '4500ab', null, 2)),
  ('oc_b_otro', pg_temp.r_oc(pg_temp.kk('cB'), null, '4500012345', null, 2)),
  ('oc_c_libre', pg_temp.r_oc(pg_temp.kk('cC'), null, '7000', null, 2));
insert into r (caso, ok) values
  ('F29: editar la OC de una compra cancelada: no_editable',
    pg_temp.good('oc_x') and pg_temp.mot('oc_cancelada') = 'no_editable' and (select numero_oc = '7000' from compras where id = pg_temp.kk('cX'))),
  ('F30: la misma OC en otra compra viva del mismo proveedor (cA y cC son de Norte): oc_repetida con el numero de la compra que ya la tiene, tambien con espacios; no escribe nada',
    pg_temp.mot('oc_rep') = 'oc_repetida' and pg_temp.mot('oc_rep_esp') = 'oc_repetida'
    and pg_temp.rk('oc_rep') ->> 'compra' = (select numero from compras where id = pg_temp.kk('cA'))
    and pg_temp.sn('cC_sin_oc') = 1),
  ('F30: 4500AB y 4500ab (otra caja de letras) en dos compras de Sur: oc_repetida',
    pg_temp.good('oc_d') and pg_temp.mot('oc_b_caja') = 'oc_repetida' and pg_temp.rk('oc_b_caja') ->> 'compra' = (select numero from compras where id = pg_temp.kk('cD'))),
  ('F30: la OC de cA (Norte) puesta en cB (Sur): se guarda con el aviso oc_de_otro_proveedor (con el numero de cA y su proveedor)',
    pg_temp.good('oc_b_otro') and (select numero_oc = '4500012345' from compras where id = pg_temp.kk('cB'))
    and pg_temp.rk('oc_b_otro') -> 'avisos' -> 0 ->> 'codigo' = 'oc_de_otro_proveedor'
    and pg_temp.rk('oc_b_otro') -> 'avisos' -> 0 ->> 'compra' = (select numero from compras where id = pg_temp.kk('cA'))
    and pg_temp.rk('oc_b_otro') -> 'avisos' -> 0 ->> 'proveedor' = 'PROVEEDOR NORTE H38'),
  ('F30: cancelar una compra libera su OC (cX cancelada con 7000): cC la guarda',
    pg_temp.good('oc_c_libre') and (select numero_oc = '7000' from compras where id = pg_temp.kk('cC')));
insert into res values ('oc_quitar', pg_temp.r_oc(pg_temp.kk('cC'), '7000', null, 'se anula la orden', 2));
insert into r (caso, ok) values
  ('F30: quitar la OC (null) se aplica y deja el evento «OC: 7000 → —» con el motivo',
    pg_temp.good('oc_quitar') and (select numero_oc is null from compras where id = pg_temp.kk('cC'))
    and exists (select 1 from compra_eventos where compra_id = pg_temp.kk('cC') and accion = 'editar_oc' and resumen = 'OC: 7000 → —' and motivo = 'se anula la orden'
                  and antes = '{"numero_oc": "7000"}'::jsonb and despues = '{"numero_oc": null}'::jsonb)),
  ('F30 (indice): como postgres, dos compras vivas de Norte con la misma OC chocan (23505); una cancelada con la misma OC no; el check de formato rechaza espacios al borde, vacio y mas de 40',
    pg_temp.falla('insert into public.compras (proveedor_id, origen, estado, fecha_compra, numero_oc) select norte, ''comprador'', ''borrador'', current_date, ''4500012345'' from ctx', '23505')
    and not pg_temp.falla('insert into public.compras (proveedor_id, origen, estado, fecha_compra, numero_oc, cancelada_at, motivo_cancelacion) select norte, ''comprador'', ''cancelada'', current_date, ''4500012345'', now(), ''humo'' from ctx')
    and pg_temp.falla('update public.compras set numero_oc = '' X1'' where id = ''' || pg_temp.kk('cC') || '''', '23514')
    and pg_temp.falla('update public.compras set numero_oc = '''' where id = ''' || pg_temp.kk('cC') || '''', '23514')
    and pg_temp.falla('update public.compras set numero_oc = repeat(''9'', 41) where id = ''' || pg_temp.kk('cC') || '''', '23514'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Estado final: sin desalineadas
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('agrupadores_desalineados() devuelve 0 filas despues de todos los casos', pg_temp.desal() = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- F2: aplicar la 0038 sobre un fixture cargado no mueve nada. Con el fixture cargado se vuelve `periodo_llegada` a su expresion de la 0037
-- y se aplica el archivo de la migracion (\i, desde la raiz del repositorio): meses, entregas y asignaciones intactos, desalineadas = 0 y
-- aplicarla otra vez no da error. (Los embarques con ingreso al stock fijado SI cambian de mes: es la regla nueva; se excluyen de la huella.)
-- ---------------------------------------------------------------------------------------------------------------------
create or replace function pg_temp.huella_f2() returns text language sql as $f$
  select md5(
    coalesce((select string_agg(e.id::text || ':' || e.linea_id || ':' || e.periodo || ':' || e.unidades, ',' order by e.id) from public.compra_linea_entregas e), '') || '|' ||
    coalesce((select string_agg(a.id::text || ':' || a.entrega_id || ':' || a.embarque_id || ':' || coalesce(a.paquete_id::text, '-') || ':' || a.unidades, ',' order by a.id) from public.compra_entrega_asignaciones a), '') || '|' ||
    coalesce((select string_agg(b.id::text || ':' || b.periodo_llegada, ',' order by b.id) from public.compra_embarques b where b.fecha_ingreso_estimada is null), '') || '|' ||
    coalesce((select string_agg(p.id::text || ':' || coalesce(p.periodo_ingreso::text, '-'), ',' order by p.id) from public.compra_paquetes p), '')
  ) $f$;
insert into sj values ('f2_antes', to_jsonb(pg_temp.huella_f2()));
create or replace function pg_temp.volver_a_la_0037() returns void language plpgsql as $f$
begin
  if current_setting('server_version_num')::integer >= 170000 then
    execute 'alter table public.compra_embarques alter column periodo_llegada set expression as (make_date(extract(year from coalesce(fecha_llegada_real, fecha_llegada_estimada))::integer, extract(month from coalesce(fecha_llegada_real, fecha_llegada_estimada))::integer, 1))';
  else
    execute 'alter table public.compra_embarques drop column periodo_llegada';
    execute 'alter table public.compra_embarques add column periodo_llegada date generated always as (make_date(extract(year from coalesce(fecha_llegada_real, fecha_llegada_estimada))::integer, extract(month from coalesce(fecha_llegada_real, fecha_llegada_estimada))::integer, 1)) stored';
    execute 'create index if not exists compra_embarques_periodo_llegada_idx on public.compra_embarques (periodo_llegada)';
  end if;
end $f$;
select pg_temp.volver_a_la_0037();
insert into r (caso, ok) values
  ('F2 (previo): con la expresion de la 0037 (sin el ingreso al stock) el mes de los embarques sin ingreso fijado es el mismo y no hay desalineadas',
    (select replace(pg_get_expr(d.adbin, d.adrelid), ' ', '') not like '%fecha_ingreso_estimada%'
       from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'public.compra_embarques'::regclass and a.attname = 'periodo_llegada')
    and pg_temp.huella_f2() = pg_temp.sjk('f2_antes') #>> '{}' and pg_temp.desal() = 0);
\i supabase/migrations/0038_fechas_logisticas_embarque.sql
insert into r (caso, ok) values
  ('F2: tras aplicar la 0038 sobre el fixture cargado, la expresion de periodo_llegada lee el ingreso al stock, los meses de los embarques sin ingreso fijado, las entregas, las asignaciones y los paquetes no se movieron y agrupadores_desalineados() = 0',
    (select replace(pg_get_expr(d.adbin, d.adrelid), ' ', '') like '%COALESCE(fecha_llegada_real,fecha_ingreso_estimada,fecha_llegada_estimada)%'
       from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid = 'public.compra_embarques'::regclass and a.attname = 'periodo_llegada')
    and pg_temp.huella_f2() = pg_temp.sjk('f2_antes') #>> '{}' and pg_temp.desal() = 0
    and (select count(*) from public.migraciones_aplicadas where nombre = '0038_fechas_logisticas_embarque') = 1),
  ('F2: los embarques con ingreso al stock fijado SI siguen la regla nueva (E1b: Ingreso CD 15-nov con ingreso 02-dic cuenta en dic)',
    pg_temp.per(pg_temp.kk('E1b')) = '2026-12');
\i supabase/migrations/0038_fechas_logisticas_embarque.sql
insert into r (caso, ok) values
  ('F2: aplicar la 0038 una segunda vez no da error ni cambia nada (el humo falla ante cualquier ERROR de SQL)',
    pg_temp.huella_f2() = pg_temp.sjk('f2_antes') #>> '{}' and pg_temp.desal() = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;
