-- Humo SQL de la migración 0037 (estadísticas del planificador y `work_mem = 16MB` de las lecturas pesadas de venta):
--   * registro `0037_estadisticas_y_work_mem` en migraciones_aplicadas;
--   * las 7 funciones (venta_proyeccion, venta_genero_mundo, venta_tienda_nodos, venta_mensual_tienda, venta_estacionalidad_agrupacion,
--     venta_composicion_agrupacion, unidades_mensuales): `proconfig` lleva `work_mem=16MB` UNA sola vez (la migración es repetible
--     sin duplicar) y conserva `search_path=""`; firma, security invoker, estabilidad `stable` y permisos (execute solo para service_role)
--     intactos;
--   * un `alter function ... set` NO cambia el cuerpo: el md5 de `prosrc` de cada función es el que tenían en vector-two ANTES de la
--     0037 (medido el 2026-11-04 por SELECT);
--   * ninguna de las 7 funciones llama a otra función de `public` (un `SET` de función no se hereda a otra que declare el suyo ni se
--     aplica a un `SET LOCAL` posterior; sin cadenas, el `work_mem` de cada una rige todo su trabajo);
--   * las 46 tablas de las migraciones que nunca se habían analizado (más `tiendas`) tienen ahora `reltuples >= 0` (en una tabla nunca analizada es -1);
--   * el mecanismo que arregla el plan: con 11 tiendas de tipo Tienda y 1 centro de distribución, antes de `analyze` el planificador
--     estima 1 fila para `tipo = 'Tienda'` y después de `analyze public.tiendas` estima 11.
-- Lo que este humo NO puede probar (necesita los 870 mil hechos reales): que el plan de `venta_proyeccion` entre por
-- `venta_stock_mensual_equivalencia_idx` y los tiempos. Eso se midió en vector-two con `explain (analyze, buffers)` y está en el
-- informe de la tanda (antes y después). La sección 5 es SOLO LECTURA y sirve también contra vector-two (SQL Editor): trae los datos
-- de `proconfig`, estadísticas y estimación de `tiendas` para pegarlos en el informe.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase; las secciones 1 a 4 insertan datos de prueba):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0037.sql"
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- Todo va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Datos inventados.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- En Supabase `service_role` tiene BYPASSRLS; el rol de la base local no (ver humo-0032).
alter role service_role bypassrls;

create temp table r (n serial, caso text, ok boolean);

-- md5 de `prosrc` de cada función en vector-two el 2026-11-04, antes de aplicar la 0037.
create temp table fn (firma text primary key, md5_esperado text not null);
insert into fn (firma, md5_esperado) values
  ('public.venta_proyeccion(uuid[], jsonb, uuid[], date, date)', '98dc898783343d463709a4f2efb0c278'),
  ('public.venta_genero_mundo(date)', 'fa4a3900e7c86ba4a838e83e8785b924'),
  ('public.venta_tienda_nodos(uuid[], date, date)', 'd43a9e563c7f87335d8bcbb8de9249d1'),
  ('public.venta_mensual_tienda()', '039020fa2d4ceda3d547a40e9f8fc461'),
  ('public.venta_estacionalidad_agrupacion(uuid)', 'b63cc5b372fffb15188cd490b6593841'),
  ('public.venta_composicion_agrupacion(uuid, jsonb, date)', 'f396894c254aef8d0591d78e6832df49'),
  ('public.unidades_mensuales(uuid[])', '148a338f23c2929ecc64df23c7f37ba7');

-- Estimación de filas del planificador para una consulta (`explain (format json)`).
create or replace function pg_temp.filas_estimadas(q text) returns numeric language plpgsql as $f$
declare j json;
begin
  execute 'explain (format json) ' || q into j;
  return (j -> 0 -> 'Plan' ->> 'Plan Rows')::numeric;
end;
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Registro y las 7 funciones: work_mem, search_path, permisos, cuerpo intacto
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok) values
  ('la 0037 esta registrada en migraciones_aplicadas',
    exists (select 1 from public.migraciones_aplicadas where nombre = '0037_estadisticas_y_work_mem')),
  ('existen las 7 funciones con la firma esperada',
    (select count(*) from fn where to_regprocedure(firma) is not null) = 7);

insert into r (caso, ok)
select format('%s: proconfig lleva work_mem=16MB una sola vez', f.firma),
  (select count(*) from unnest(p.proconfig) c where c like 'work_mem=%') = 1
  and 'work_mem=16MB' = any (p.proconfig)
from fn f join pg_proc p on p.oid = to_regprocedure(f.firma);

insert into r (caso, ok)
select format('%s: conserva search_path vacio, stable, security invoker', f.firma),
  ('search_path=""' = any (p.proconfig) or 'search_path=' = any (p.proconfig)) and p.provolatile = 's' and not p.prosecdef
from fn f join pg_proc p on p.oid = to_regprocedure(f.firma);

insert into r (caso, ok)
select format('%s: el cuerpo (md5 de prosrc) es el de antes de la 0037', f.firma),
  md5(p.prosrc) = f.md5_esperado
from fn f join pg_proc p on p.oid = to_regprocedure(f.firma);

insert into r (caso, ok)
select format('%s: execute solo para service_role (anon y authenticated no)', f.firma),
  has_function_privilege('service_role', to_regprocedure(f.firma), 'execute')
  and not has_function_privilege('anon', to_regprocedure(f.firma), 'execute')
  and not has_function_privilege('authenticated', to_regprocedure(f.firma), 'execute')
from fn f;

-- Ninguna de las 7 llama a otra función de `public` (busca `nombre(` de cualquier función propia en el cuerpo).
insert into r (caso, ok)
select format('%s: no llama a ninguna otra funcion de public (sin cadenas de SET)', f.firma),
  not exists (
    select 1
    from pg_proc d
    join pg_namespace dn on dn.oid = d.pronamespace
    where dn.nspname = 'public' and d.oid <> p.oid and d.prokind = 'f'
      and p.prosrc ~ ('(^|[^a-z_])' || d.proname || '[[:space:]]*\(')
  )
from fn f join pg_proc p on p.oid = to_regprocedure(f.firma);

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Repetir el `alter function` no duplica ni cambia nada (idempotencia del mecanismo)
-- ---------------------------------------------------------------------------------------------------------------------
create temp table antes as
  select f.firma, p.proconfig, md5(p.prosrc) as m
  from fn f join pg_proc p on p.oid = to_regprocedure(f.firma);

alter function public.venta_proyeccion(uuid[], jsonb, uuid[], date, date) set work_mem = '16MB';
alter function public.venta_genero_mundo(date) set work_mem = '16MB';
alter function public.venta_tienda_nodos(uuid[], date, date) set work_mem = '16MB';
alter function public.venta_mensual_tienda() set work_mem = '16MB';
alter function public.venta_estacionalidad_agrupacion(uuid) set work_mem = '16MB';
alter function public.venta_composicion_agrupacion(uuid, jsonb, date) set work_mem = '16MB';
alter function public.unidades_mensuales(uuid[]) set work_mem = '16MB';

insert into r (caso, ok)
select format('%s: tras repetir el alter, proconfig y prosrc son identicos', a.firma),
  (select array_agg(c order by c) from unnest(p.proconfig) c) is not distinct from (select array_agg(c order by c) from unnest(a.proconfig) c)
  and md5(p.prosrc) = a.m
from antes a join pg_proc p on p.oid = to_regprocedure(a.firma);

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Las tablas que nunca se analizaron ya tienen estadisticas (reltuples >= 0; en una tabla nunca analizada vale -1)
-- ---------------------------------------------------------------------------------------------------------------------
create temp table analizadas (tabla text primary key);
insert into analizadas (tabla) values
  ('tiendas'), ('agrupacion_estacionalidad_genero'), ('agrupaciones_estacionalidad'), ('agrupaciones_marca'), ('agrupaciones_talla'),
  ('compra_agrupador_eventos'), ('compra_embarques'), ('compra_entrega_asignaciones'), ('compra_eventos'), ('compra_linea_entregas'),
  ('compra_linea_recepciones'), ('compra_linea_repartos'), ('compra_lineas'), ('compra_paquetes'), ('compra_viajes'), ('compras'),
  ('corridas_estacionalidad'), ('crecimientos_genero_mundo'), ('curvas_estacionalidad'), ('factores_volumen_atipico'),
  ('flujo_parametros'), ('generos'), ('ia_configuraciones'), ('ia_corrida_gms'), ('ia_corridas'), ('ia_entradas'),
  ('ia_evaluaciones'), ('ia_llamadas'), ('ia_propuestas_filas'), ('ia_propuestas_gm'), ('intercompany_reglas'),
  ('mapeos_combinacion'), ('marca_gml_especial'), ('migraciones_aplicadas'), ('mundos'), ('perfiles'), ('periodos_atipicos'),
  ('proveedores'), ('proyeccion_crecimientos'), ('proyeccion_lote_filas'), ('proyeccion_lotes'), ('proyeccion_tiendas'),
  ('proyecciones'), ('reparto_marca_barrido_gml'), ('repartos_marca_barrido'),
  ('responsables_genero_mundo'), ('ubicaciones_ignoradas');

insert into r (caso, ok) values
  ('la lista del humo tiene las 46 tablas de la migracion mas tiendas (47 en total)',
    (select count(*) from analizadas) = 47);

insert into r (caso, ok)
select format('public.%s: tiene estadisticas (reltuples >= 0)', a.tabla),
  coalesce((select c.reltuples >= 0 from pg_class c where c.oid = to_regclass('public.' || a.tabla)), false)
from analizadas a order by a.tabla;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. El mecanismo: la estimacion de `tiendas` pasa de 1 fila a 11 con `analyze`
-- ---------------------------------------------------------------------------------------------------------------------
-- 11 tiendas de tipo Tienda y 1 centro de distribucion, inventadas. Sin analizar, la selectividad por defecto de `tipo = 'Tienda'`
-- (0,5 %) da 1 fila; con `analyze` el planificador conoce la lista de valores mas comunes y estima 11.
insert into public.tiendas (codigo, nombre, tipo)
select 'H37-' || g, 'Humo 37 tienda ' || g, 'Tienda' from generate_series(1, 11) g;
insert into public.tiendas (codigo, nombre, tipo) values ('H37-CD', 'Humo 37 CD', 'Centro de Distribución');

create temp table est (k text primary key, v numeric);
insert into est (k, v)
select 'antes', pg_temp.filas_estimadas($q$select * from public.tiendas t where t.tipo = 'Tienda'$q$);

-- En la base local la 0037 analizo `tiendas` cuando estaba vacia (no deja filas en pg_statistic), asi que las 12 filas recien
-- insertadas siguen sin estadisticas utiles y "antes" mide la estimacion por defecto.
analyze public.tiendas;
insert into est (k, v)
select 'despues', pg_temp.filas_estimadas($q$select * from public.tiendas t where t.tipo = 'Tienda'$q$);

insert into r (caso, ok) values
  ('sin estadisticas utiles, la estimacion de tipo = Tienda es menor que 11 (antes del analyze)',
    (select v from est where k = 'antes') < 11),
  ('tras analyze public.tiendas, la estimacion de tipo = Tienda es exactamente 11',
    (select v from est where k = 'despues') = 11),
  ('tras analyze, pg_stats conoce la columna tipo de tiendas',
    exists (select 1 from pg_stats where schemaname = 'public' and tablename = 'tiendas' and attname = 'tipo'));

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. SOLO LECTURA (vale tambien contra vector-two en el SQL Editor): constancia de `proconfig`, estadisticas y estimacion
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- constancia: proconfig y md5 de prosrc de las 7 funciones'
select p.oid::regprocedure::text as funcion, p.proconfig, md5(p.prosrc) as md5_prosrc
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('venta_proyeccion', 'venta_genero_mundo', 'venta_tienda_nodos', 'venta_mensual_tienda',
                    'venta_estacionalidad_agrupacion', 'venta_composicion_agrupacion', 'unidades_mensuales')
order by 1;

\echo '--- constancia: tablas de public sin estadisticas (reltuples = -1 y sin filas en pg_stats); esperado en vector-two y local migrado: ninguna'
select c.relname as tabla, c.reltuples
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.reltuples < 0
  and not exists (select 1 from pg_stats p where p.schemaname = 'public' and p.tablename = c.relname)
order by 1;
