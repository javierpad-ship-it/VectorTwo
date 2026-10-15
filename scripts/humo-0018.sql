-- Humo SQL de la migración 0018 (M7 · proyección anual): `venta_proyeccion`, claves de pertenencia, exclusión del CD,
-- permisos (anon / authenticated sin acceso, service_role sí) y las claves foráneas de `tienda_referencia_id`.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones)
--   3. Cargar en `vector_two_local` el fixture sintético de M7 (tiendas T1..T9 y CD; marcas ALFA, ALFA JEANS, DELTA;
--      equivalencias SKINNY, RECTO, PARKA; cargas publicadas hasta 2026-09-01). Nada de datos reales de Lukers.
--   4. su postgres -c "psql -d vector_two_local -f scripts/humo-0018.sql"
--
-- Cada bloque va dentro de `begin … rollback`: no deja nada escrito. `ON_ERROR_STOP off` es a propósito: los bloques de
-- permisos y de claves foráneas DEBEN fallar (el error es el resultado esperado) y el resto tiene que seguir corriendo.
-- Lo esperado de cada bloque está en el `\echo` que lo precede.
\set ON_ERROR_STOP off
begin;
-- Datos: CD con venta en el periodo para comprobar exclusion
insert into cargas_venta_stock(periodo,estado,publicada_at) values ('2026-10-01','en_curso',null);
insert into venta_stock_mensual(carga_id,tienda_id,equivalencia_id,marca_id,agrupacion_talla_id,unidades,venta_soles,costo_vendido,stock_unidades,stock_valorizado)
 select (select id from cargas_venta_stock where periodo='2026-09-01' and estado='publicada'), (select id from tiendas where codigo='CD'), (select id from equivalencias where nombre='SKINNY'), (select id from marcas where codigo='ALFA'), (select id from agrupaciones_talla where codigo='CENTRALES'), 777, 7770, 1,1,1;
create temp table r as select public.venta_proyeccion(
  (select array_agg(id) from genero_mundo_linea),
  (select jsonb_object_agg(id::text, case codigo when 'T1' then '11111' when 'T6' then '00011' else '10101' end) from tiendas where tipo='Tienda' and codigo not in ('T9')),
  (select array_agg(id) from tiendas where codigo in ('T2','CD')),
  date '2023-01-01', date '2025-10-01') x;
\echo '--- claves distintas (T9 ausente => 00000)'
select string_agg(distinct f->>'clave', ',' order by f->>'clave') from r, jsonb_array_elements(x->'filas') f;
select 'T9 clave 00000 filas' , count(*) from r, jsonb_array_elements(x->'filas') f where f->>'clave'='00000';
\echo '--- CD en filas/por_tienda/equivalencias/detalle (esperado 0 unidades 777)'
select 'filas con 777', count(*) from r, jsonb_array_elements(x->'filas') f where (f->>'unidades')::int=777;
select 'por_tienda del CD', count(*) from r, jsonb_array_elements(x->'por_tienda') f where f->>'tienda_id'=(select id::text from tiendas where codigo='CD');
select 'detalle con 777 o CD', count(*) from r, jsonb_array_elements(x->'detalle_w12') f where (f->>'unidades')::int>=777;
select 'suma unidades filas 2026-09 vs venta sin CD', (select sum((f->>'unidades')::int) from r, jsonb_array_elements(x->'filas') f where f->>'periodo'='2026-09-01') as funcion,
 (select sum(v.unidades) from venta_stock_mensual v join cargas_venta_stock c on c.id=v.carga_id join tiendas t on t.id=v.tienda_id where c.periodo='2026-09-01' and c.estado='publicada' and t.tipo='Tienda' and t.codigo<>'T9') as directo;
\echo '--- ALFA JEANS suma en agrupacion de ALFA (RECONOCIDO)'
select 'agrup RECONOCIDO denim 2025-12 funcion', (select sum((f->>'unidades')::int) from r, jsonb_array_elements(x->'filas') f where f->>'periodo'='2025-12-01' and f->>'agrupacion_marca_id'=(select id::text from agrupaciones_marca where codigo='RECONOCIDO') and f->>'gml_id'=(select n.id::text from genero_mundo_linea n join lineas l on l.id=n.linea_id where l.codigo='DENIM')) f,
 (select sum(v.unidades) from venta_stock_mensual v join cargas_venta_stock c on c.id=v.carga_id join equivalencias e on e.id=v.equivalencia_id join marcas m on m.id=v.marca_id where c.periodo='2025-12-01' and c.estado='publicada' and e.nombre in ('SKINNY','RECTO') and m.codigo in ('ALFA','ALFA JEANS','DELTA') and v.tienda_id in (select id from tiendas where tipo='Tienda' and codigo<>'T9')) d;
\echo '--- GMLE da equivalencia_id; GML no'
select 'GMLE con eq', count(*) filter (where f->>'equivalencia_id' is not null), 'GML sin eq', count(*) filter (where f->>'equivalencia_id' is null) from r, jsonb_array_elements(x->'filas') f;
select 'gml con eq != PARKA', count(*) from r, jsonb_array_elements(x->'filas') f where f->>'equivalencia_id' is not null and f->>'equivalencia_id' <> (select id::text from equivalencias where nombre='PARKA');
\echo '--- permisos anon'
rollback;
begin;
set local role anon;
select public.venta_proyeccion(array[]::uuid[], '{}'::jsonb, array[]::uuid[], date '2026-01-01', date '2026-01-01');
rollback;
begin; set local role anon; select count(*) from proyecciones; rollback;
begin; set local role authenticated; select count(*) from proyeccion_filas; rollback;
begin; set local role authenticated; select public.venta_proyeccion(array[]::uuid[], '{}'::jsonb, array[]::uuid[], date '2026-01-01', date '2026-01-01'); rollback;
\echo '--- service_role ejecuta'
begin; set local role service_role; select jsonb_array_length(public.venta_proyeccion(array[]::uuid[], '{}'::jsonb, array[]::uuid[], date '2026-01-01', date '2026-01-01')->'filas'); rollback;
\echo '--- unico parcial 2 cerradas mismo anio (esperado error 2o)'
begin;
insert into proyecciones(anio_en_curso,nombre,estado,hasta_periodo,parametros) values (2031,'a','cerrada','2031-03-01','{}');
insert into proyecciones(anio_en_curso,nombre,estado,hasta_periodo,parametros) values (2031,'b','cerrada','2031-03-01','{}');
rollback;
\echo '--- cardinality 11 meses (esperado error)'
begin;
insert into proyecciones(id,anio_en_curso,nombre,hasta_periodo,parametros) values ('00000000-0000-4000-8000-0000000000aa',2031,'c','2031-03-01','{}');
insert into proyeccion_filas(id,proyeccion_id,gml_id,agrupacion_marca_id,clave,nivel_proyectado,historico) select '00000000-0000-4000-8000-0000000000bb','00000000-0000-4000-8000-0000000000aa',(select id from genero_mundo_linea limit 1),(select id from agrupaciones_marca limit 1),'k','GML','{}';
insert into proyeccion_fila_anios(fila_id,anio,bloque,meses) values ('00000000-0000-4000-8000-0000000000bb',2031,'mismas',array[1,2,3,4,5,6,7,8,9,10,11]);
rollback;
\echo '--- referencia = id (esperado error)'
begin; update tiendas set tienda_referencia_id=id where codigo='T1'; rollback;
\echo '--- borrar tienda en proyeccion / referente (esperado error FK)'
begin; delete from tiendas where codigo='T1'; rollback;
\echo '--- borrar tienda sin hechos que es referente (restrict)'
begin; delete from tiendas where codigo='T4'; select count(*) from tiendas where codigo='T4'; rollback;
\echo '--- decido/origen check'
begin;
insert into proyecciones(id,anio_en_curso,nombre,hasta_periodo,parametros) values ('00000000-0000-4000-8000-0000000000aa',2031,'c','2031-03-01','{}');
insert into proyeccion_filas(id,proyeccion_id,gml_id,agrupacion_marca_id,clave,nivel_proyectado,historico) select '00000000-0000-4000-8000-0000000000bb','00000000-0000-4000-8000-0000000000aa',(select id from genero_mundo_linea limit 1),(select id from agrupaciones_marca limit 1),'k','GML','{}';
insert into proyeccion_fila_anios(fila_id,anio,bloque,decidido) values ('00000000-0000-4000-8000-0000000000bb',2031,'mismas',5);
rollback;
