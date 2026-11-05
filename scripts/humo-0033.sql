-- Humo SQL de la migración 0033 (M7 07f, venta por tienda y año de un género x mundo dentro de Crecimientos):
--   * la función de solo lectura `venta_tienda_nodos(uuid[], date, date)`, su forma, su rango, su aislamiento por permisos y que no
--     devuelve nunca un CD ni claves distintas de t, p, u, s y cargas.
--   * el caso sintético de la ficha §8 (Y = 2026, k = 9, MUJER x URBANO con T01..T04, T09, T10, T11 y un CD): los reales por tienda
--     y periodo salen de la función, y el cuadre del vigente con Σ B se comprueba sobre ellos (el reparto por mayor resto, que en la
--     aplicación vive en `venta-por-tienda.ts`, se reproduce aquí con ventanas SOLO para demostrar que los datos de la función bastan
--     para que el subtotal de la base cuadre exacto).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0033.sql"
--
-- NO necesita fixture previo: carga el suyo (géneros, mundos, líneas y nodos, tiendas, cargas, equivalencias y venta). Todo inventado:
-- nada de datos reales de Lukers. Contra PRODUCCIÓN solo valen, por SELECT, las comprobaciones marcadas «solo lectura».
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Cada comprobación imprime `ok = t`; un `ok = f` es un
-- fallo. Los permisos se prueban con `has_function_privilege` y con `set local role` dentro de un bloque `do` con `exception` (es un script
-- de prueba local, no una migración).
\set ON_ERROR_STOP off
\pset pager off
begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
-- Árbol: MUJER x URBANO con DOS nodos (líneas L1 y L2: la función recibe una lista de nodos), HOMBRE x URBANO (un nodo, otro GM) y NIÑO x
-- URBANO (un nodo, va al Resto).
insert into generos (codigo, nombre) values ('H33H', 'HOMBRE H33'), ('H33M', 'MUJER H33'), ('H33N', 'NINO H33');
insert into mundos (codigo, nombre) values ('H33U', 'URBANO H33');
insert into lineas (codigo, nombre, temporada) values ('H33L1', 'LINEA UNO H33', 'Todo el año'), ('H33L2', 'LINEA DOS H33', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML'
from generos g, mundos mu, lineas l
where mu.codigo = 'H33U'
  and ((g.codigo = 'H33M' and l.codigo in ('H33L1', 'H33L2'))
    or (g.codigo = 'H33H' and l.codigo = 'H33L1')
    or (g.codigo = 'H33N' and l.codigo = 'H33L1'));

insert into tiendas (codigo, nombre, tipo) values
  ('T01', 'TIENDA 01 H33', 'Tienda'), ('T02', 'TIENDA 02 H33', 'Tienda'), ('T03', 'TIENDA 03 H33', 'Tienda'),
  ('T04', 'TIENDA 04 H33', 'Tienda'), ('T09', 'TIENDA 09 H33', 'Tienda'), ('T10', 'TIENDA 10 H33', 'Tienda'),
  ('T11', 'TIENDA 11 H33', 'Tienda'), ('T12', 'TIENDA 12 H33', 'Tienda'),
  ('CD1', 'CD UNO H33', 'Centro de Distribución');
insert into agrupaciones_talla (codigo, nombre) values ('H33TA', 'TALLA A H33');
insert into agrupaciones_marca (codigo, nombre) values ('H33AG', 'AGRUPACION H33');
insert into marcas (codigo, nombre, agrupacion_marca_id) select 'H33M', 'MARCA H33', id from agrupaciones_marca where codigo = 'H33AG';

-- Equivalencias: EM1 y EM2 en MUJER x URBANO L1; EM3 en MUJER x URBANO L2 (otro nodo del mismo GM); EH1 en HOMBRE; EN1 en NIÑO (Resto).
insert into equivalencias (genero_mundo_linea_id, codigo, nombre)
select n.id, v.codigo, v.nombre
from (values ('H33M', 'H33L1', 'EM1', 'EQUIV M1 H33'), ('H33M', 'H33L1', 'EM2', 'EQUIV M2 H33'), ('H33M', 'H33L2', 'EM3', 'EQUIV M3 H33'),
             ('H33H', 'H33L1', 'EH1', 'EQUIV H1 H33'), ('H33N', 'H33L1', 'EN1', 'EQUIV N1 H33')) as v(g, l, codigo, nombre)
join generos g on g.codigo = v.g
join lineas l on l.codigo = v.l
join mundos mu on mu.codigo = 'H33U'
join genero_mundo_linea n on n.genero_id = g.id and n.mundo_id = mu.id and n.linea_id = l.id;

-- Cargas publicadas de 2023-01 a 2026-09, MENOS 2024-03 (mes faltante a propósito, caso borde de la ficha §7); más 2026-10 publicada (para
-- probar que p_hasta = 2026-09 la deja fuera) y 2026-11 retirada (no cuenta nunca).
insert into cargas_venta_stock (periodo, estado, publicada_at)
select m::date, 'publicada', now()
from generate_series(date '2023-01-01', date '2026-10-01', interval '1 month') m
where m::date <> date '2024-03-01';
insert into cargas_venta_stock (periodo, estado, publicada_at) values (date '2026-11-01', 'retirada', now());

-- Venta (ficha §8). Algunos periodos con venta en dos equivalencias de la misma tienda (para probar la preagregación) y en dos nodos.
-- s = soles netos; si va nulo, 70,25 por unidad (para ver decimales).
create temp table venta_fixture (periodo date, tienda text, eq text, unidades int, soles numeric(14, 2));
insert into venta_fixture values
  (date '2023-01-01', 'T01', 'EM1', 6000, null), (date '2024-01-01', 'T01', 'EM1', 6300, null),
  (date '2025-03-01', 'T01', 'EM1', 3000, 228000), (date '2025-03-01', 'T01', 'EM3', 2000, 152000),
  (date '2025-11-01', 'T01', 'EM1', 2000, null), (date '2026-02-01', 'T01', 'EM2', 6000, 480000),
  (date '2026-10-01', 'T01', 'EM1', 1000, null),
  (date '2023-01-01', 'T02', 'EM1', 3000, null), (date '2024-01-01', 'T02', 'EM1', 3200, null), (date '2025-03-01', 'T02', 'EM1', 2500, null),
  (date '2025-11-01', 'T02', 'EM1', 1000, null), (date '2026-02-01', 'T02', 'EM1', 3000, null),
  (date '2023-01-01', 'T03', 'EM1', 1200, null), (date '2024-01-01', 'T03', 'EM1', 1100, null), (date '2025-03-01', 'T03', 'EM1', 1000, null),
  (date '2025-11-01', 'T03', 'EM1', 400, null), (date '2026-02-01', 'T03', 'EM1', 1000, null),
  (date '2025-11-01', 'T10', 'EM1', 300, null), (date '2026-02-01', 'T10', 'EM1', 1200, null),
  (date '2023-01-01', 'T04', 'EM1', 1000, null), (date '2024-01-01', 'T04', 'EM1', 1000, null), (date '2025-03-01', 'T04', 'EM1', 800, null),
  (date '2025-11-01', 'T04', 'EM1', 300, null), (date '2026-02-01', 'T04', 'EM1', 800, null),
  (date '2026-06-01', 'T11', 'EM1', 400, null),
  (date '2023-01-01', 'T09', 'EM1', 900, null), (date '2024-02-01', 'T09', 'EM1', 500, null),
  (date '2026-02-01', 'T01', 'EM1', -50, -3512.50),
  (date '2025-03-01', 'CD1', 'EM1', 5000, null),
  (date '2025-03-01', 'T01', 'EH1', 7777, null),
  (date '2026-02-01', 'T01', 'EN1', 123, null), (date '2025-03-01', 'T12', 'EN1', 45, null),
  (date '2026-11-01', 'T01', 'EM1', 999, null);
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, venta_soles)
select c.id, t.id, e.id, (select id from marcas where codigo = 'H33M'), (select id from agrupaciones_talla where codigo = 'H33TA'),
       f.unidades, coalesce(f.soles, f.unidades * 70.25)
from venta_fixture f
join cargas_venta_stock c on c.periodo = f.periodo and c.estado in ('publicada', 'retirada')
join tiendas t on t.codigo = f.tienda
join equivalencias e on e.codigo = f.eq and e.nombre like 'EQUIV % H33';

create temp table nodos as
select
  (select array_agg(n.id order by n.id) from genero_mundo_linea n join generos g on g.id = n.genero_id where g.codigo = 'H33M') as mujer,
  (select array_agg(n.id order by n.id) from genero_mundo_linea n join generos g on g.id = n.genero_id where g.codigo = 'H33H') as hombre,
  (select array_agg(n.id order by n.id) from genero_mundo_linea n join generos g on g.id = n.genero_id where g.codigo = 'H33N') as resto;

create temp table res as
select public.venta_tienda_nodos(n.mujer, date '2023-01-01', date '2026-09-01') as r,
       public.venta_tienda_nodos(n.resto, date '2023-01-01', date '2026-09-01') as r_resto,
       public.venta_tienda_nodos(n.hombre, date '2023-01-01', date '2026-09-01') as r_hombre
from nodos n;

-- Atajo: suma de `u` o `s` de una tienda (por código) en un rango de periodos 'aaaa-mm' dentro de un documento.
create or replace function pg_temp.suma(p_doc jsonb, p_tienda text, p_desde text, p_hasta text, p_campo text)
returns numeric language sql as $$
  select coalesce(sum((s ->> p_campo)::numeric), 0)
  from jsonb_array_elements(p_doc -> 'series') s
  where s ->> 't' = (select id::text from tiendas where codigo = p_tienda)
    and s ->> 'p' >= p_desde and s ->> 'p' <= p_hasta
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Forma del documento
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- el documento solo tiene las claves series y cargas (esperado ok = t)'
select (select array_agg(k order by k) from jsonb_object_keys(r) k) = array['cargas', 'series'] as ok from res;

\echo '--- cada serie trae EXACTAMENTE t, p, u y s: ninguna clave distinta (esperado ok = t)'
select not exists (select 1 from res, jsonb_array_elements(r -> 'series') s
                   where (select array_agg(k order by k) from jsonb_object_keys(s) k) is distinct from array['p', 's', 't', 'u']) as ok;

\echo '--- tipos: t texto uuid, p texto aaaa-mm, u y s numeros (esperado ok = t)'
select not exists (select 1 from res, jsonb_array_elements(r -> 'series') s
                   where jsonb_typeof(s -> 't') <> 'string' or (s ->> 't') !~ '^[0-9a-f-]{36}$'
                      or jsonb_typeof(s -> 'p') <> 'string' or (s ->> 'p') !~ '^[0-9]{4}-[0-9]{2}$'
                      or jsonb_typeof(s -> 'u') <> 'number' or jsonb_typeof(s -> 's') <> 'number') as ok;

\echo '--- orden determinista (t, p): el documento ya viene ordenado y dos llamadas dan lo mismo (esperado ok = t)'
select (select jsonb_agg(s order by s ->> 't', s ->> 'p') from res, jsonb_array_elements(r -> 'series') s) = (select r -> 'series' from res)
   and (select public.venta_tienda_nodos(mujer, date '2023-01-01', date '2026-09-01') from nodos) = (select r from res) as ok;

\echo '--- una sola serie por (tienda, periodo): la preagregacion junta equivalencias y nodos (esperado ok = t)'
select (select count(*) from res, jsonb_array_elements(r -> 'series') s)
     = (select count(distinct (s ->> 't', s ->> 'p')) from res, jsonb_array_elements(r -> 'series') s) as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Sin CD, solo nodos pedidos, rango
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- ninguna serie es del centro de distribucion, en ninguno de los tres documentos (esperado ok = t)'
select not exists (select 1 from res, jsonb_array_elements(r -> 'series') s
                   where s ->> 't' = (select id::text from tiendas where codigo = 'CD1')) as ok;
select not exists (select 1 from res, jsonb_array_elements(r_resto -> 'series') s
                   where s ->> 't' in (select id::text from tiendas where tipo <> 'Tienda')) as ok;

\echo '--- toda serie es de una tienda de tipo Tienda (esperado ok = t)'
select not exists (select 1 from res, jsonb_array_elements(r -> 'series') s
                   where s ->> 't' not in (select id::text from tiendas where tipo = 'Tienda')) as ok;

\echo '--- sum(u) y sum(s) de MUJER x URBANO = lo que suma venta_stock_vigente de sus equivalencias en tiendas Tienda, en el rango (esperado ok = t)'
select (select sum((s ->> 'u')::bigint) from res, jsonb_array_elements(r -> 'series') s)
     = (select sum(v.unidades) from venta_stock_vigente v join tiendas t on t.id = v.tienda_id and t.tipo = 'Tienda' cross join nodos n
        join equivalencias e on e.id = v.equivalencia_id and e.genero_mundo_linea_id = any (n.mujer)
        where v.periodo >= date '2023-01-01' and v.periodo <= date '2026-09-01')
   and (select sum((s ->> 's')::numeric) from res, jsonb_array_elements(r -> 'series') s)
     = (select sum(v.venta_soles) from venta_stock_vigente v join tiendas t on t.id = v.tienda_id and t.tipo = 'Tienda' cross join nodos n
        join equivalencias e on e.id = v.equivalencia_id and e.genero_mundo_linea_id = any (n.mujer)
        where v.periodo >= date '2023-01-01' and v.periodo <= date '2026-09-01') as ok;

\echo '--- la venta del CD (5 000 u) y la de HOMBRE (7 777 u) no entran en MUJER; la de octubre y la de la carga retirada tampoco (esperado ok = t)'
select (select sum((s ->> 'u')::bigint) from res, jsonb_array_elements(r -> 'series') s)
     = 6000 + 6300 + 5000 + 2000 + 6000 - 50
     + 3000 + 3200 + 2500 + 1000 + 3000
     + 1200 + 1100 + 1000 + 400 + 1000
     + 300 + 1200
     + 1000 + 1000 + 800 + 300 + 800
     + 400 + 900 + 500 as ok;

\echo '--- el Resto (NIÑO) solo trae lo suyo, con T12 incluida; HOMBRE solo lo suyo (esperado ok = t)'
select (select sum((s ->> 'u')::bigint) from res, jsonb_array_elements(r_resto -> 'series') s) = 123 + 45
   and (select count(*) from res, jsonb_array_elements(r_resto -> 'series') s) = 2
   and (select sum((s ->> 'u')::bigint) from res, jsonb_array_elements(r_hombre -> 'series') s) = 7777 as ok;

\echo '--- GM y Resto son disjuntos: pedir los nodos de los dos juntos suma exactamente la de cada uno por separado (esperado ok = t)'
select (select sum((s ->> 'u')::bigint) from jsonb_array_elements(public.venta_tienda_nodos((select mujer || resto from nodos), date '2023-01-01', date '2026-09-01') -> 'series') s)
     = (select sum((s ->> 'u')::bigint) from res, jsonb_array_elements(r -> 'series') s)
     + (select sum((s ->> 'u')::bigint) from res, jsonb_array_elements(r_resto -> 'series') s) as ok;

\echo '--- corte en k: con p_hasta = 2026-09 octubre queda fuera; con p_hasta = 2026-10 entra (esperado ok = t)'
select pg_temp.suma(r, 'T01', '2026-01', '2026-12', 'u') = 5950
   and (select sum((s ->> 'u')::bigint) from jsonb_array_elements(public.venta_tienda_nodos((select mujer from nodos), date '2026-01-01', date '2026-10-01') -> 'series') s
        where s ->> 'p' = '2026-10') = 1000 as ok from res;

\echo '--- el año anterior con los mismos k meses: 2025 ene-sep de T01 = 5 000 u y S/ 380 000 (esperado ok = t)'
select (select sum((s ->> 'u')::bigint) from jsonb_array_elements(public.venta_tienda_nodos((select mujer from nodos), date '2025-01-01', date '2025-09-01') -> 'series') s
        where s ->> 't' = (select id::text from tiendas where codigo = 'T01')) = 5000
   and (select sum((s ->> 's')::numeric) from jsonb_array_elements(public.venta_tienda_nodos((select mujer from nodos), date '2025-01-01', date '2025-09-01') -> 'series') s
        where s ->> 't' = (select id::text from tiendas where codigo = 'T01')) = 380000.00 as ok;

\echo '--- el año completo 2025 de T01 son 7 000 u (ene-sep 5 000 + nov 2 000); el neto de devoluciones resta (2026-02: 6 000 - 50 = 5 950 u, S/ 476 487,50) (esperado ok = t)'
select pg_temp.suma(r, 'T01', '2025-01', '2025-12', 'u') = 7000
   and pg_temp.suma(r, 'T01', '2026-02', '2026-02', 'u') = 5950
   and pg_temp.suma(r, 'T01', '2026-02', '2026-02', 's') = 476487.50 as ok from res;

\echo '--- los soles conservan los 2 decimales y el T09 cerrada trae solo sus años reales (esperado ok = t)'
select pg_temp.suma(r, 'T09', '2023-01', '2023-12', 'u') = 900 and pg_temp.suma(r, 'T09', '2023-01', '2023-12', 's') = 63225.00
   and pg_temp.suma(r, 'T09', '2024-01', '2024-12', 'u') = 500 and pg_temp.suma(r, 'T09', '2025-01', '2026-12', 'u') = 0 as ok from res;

\echo '--- tienda sin venta en el GM (T12 en MUJER) no aparece: el backend la completa en ceros (esperado ok = t)'
select not exists (select 1 from res, jsonb_array_elements(r -> 'series') s where s ->> 't' = (select id::text from tiendas where codigo = 'T12')) as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. Cargas
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- cargas: solo [p_desde, p_hasta] y publicadas: 44 meses (45 menos el 2024-03 faltante), sin 2026-10 ni la retirada (esperado ok = t)'
select (select count(*) from res, jsonb_object_keys(r -> 'cargas')) = 44
   and not (r -> 'cargas' ? '2024-03') and not (r -> 'cargas' ? '2026-10') and not (r -> 'cargas' ? '2026-11')
   and r -> 'cargas' ? '2023-01' and r -> 'cargas' ? '2026-09' as ok from res;

\echo '--- cargas: el valor es el id de la carga publicada de ese mes (esperado ok = t)'
select not exists (select 1 from res, jsonb_each_text(r -> 'cargas') c
                   where c.value is distinct from (select x.id::text from cargas_venta_stock x where to_char(x.periodo, 'YYYY-MM') = c.key and x.estado = 'publicada')) as ok;

\echo '--- cargas es identico para GM, Resto y HOMBRE (no depende de los nodos) (esperado ok = t)'
select r -> 'cargas' = r_resto -> 'cargas' and r -> 'cargas' = r_hombre -> 'cargas' as ok from res;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Bordes de los parámetros
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- nodos nulos o vacios: series [] y cargas con los meses del rango (esperado ok = t)'
select public.venta_tienda_nodos(null, date '2023-01-01', date '2026-09-01') -> 'series' = '[]'::jsonb
   and public.venta_tienda_nodos('{}'::uuid[], date '2023-01-01', date '2026-09-01') -> 'series' = '[]'::jsonb
   and jsonb_typeof(public.venta_tienda_nodos(null, date '2023-01-01', date '2026-09-01') -> 'cargas') = 'object' as ok;

\echo '--- nodo inexistente: series [] (esperado ok = t)'
select public.venta_tienda_nodos(array['00000000-0000-0000-0000-000000000000'::uuid], date '2023-01-01', date '2026-09-01') -> 'series' = '[]'::jsonb as ok;

\echo '--- rango invertido o fechas nulas: series [] y cargas objeto vacio, sin error (esperado ok = t)'
select (select public.venta_tienda_nodos(mujer, date '2026-09-01', date '2023-01-01') from nodos) = '{"series": [], "cargas": {}}'::jsonb
   and (select public.venta_tienda_nodos(mujer, null, date '2026-09-01') from nodos) = '{"series": [], "cargas": {}}'::jsonb
   and (select public.venta_tienda_nodos(mujer, date '2023-01-01', null) from nodos) = '{"series": [], "cargas": {}}'::jsonb as ok;

\echo '--- un solo mes (p_desde = p_hasta) trae solo ese mes (esperado ok = t)'
select (select count(*) from jsonb_array_elements((select public.venta_tienda_nodos(mujer, date '2026-02-01', date '2026-02-01') from nodos) -> 'series') s
        where s ->> 'p' <> '2026-02') = 0
   and (select jsonb_array_length(public.venta_tienda_nodos(mujer, date '2026-02-01', date '2026-02-01') -> 'series') from nodos) = 5 as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Caso sintético de la ficha §8: cuadre del vigente con Σ B
-- ---------------------------------------------------------------------------------------------------------------------
-- Datos de entrada que NO vienen de la función (los lee el backend de la proyección): Σ B = 15 600, vigente de T10 = 1 600 (exacto),
-- mismas tiendas T01, T02 y T03. Los pesos salen de la función: real ene-sep 2026 por tienda (T01 lleva en el fixture una devolución de
-- -50 u y pesa 5 950 en lugar de 6 000: se prueba el reparto con lo que da la función, y aparte con los pesos exactos de la ficha).
create or replace function pg_temp.reparto(p_r bigint, p_codigos text[], p_pesos numeric[])
returns table (codigo text, asignado bigint, sin_atribuir bigint) language sql as $$
  with pesos as (
    select c.codigo, greatest(0, p.peso) as peso, c.n
    from unnest(p_codigos) with ordinality as c(codigo, n)
    join unnest(p_pesos) with ordinality as p(peso, n) using (n)
  ),
  total as (select sum(peso) as t from pesos),
  base as (
    select p.codigo, p.peso, floor(p_r * p.peso / nullif(t.t, 0))::bigint as piso,
           (p_r * p.peso / nullif(t.t, 0)) - floor(p_r * p.peso / nullif(t.t, 0)) as resto
    from pesos p, total t
  ),
  faltan as (select p_r - coalesce(sum(piso), 0) as f from base),
  ordenado as (
    select b.*, row_number() over (order by b.resto desc, b.codigo) as pos from base b
  )
  select o.codigo,
         case when (select t from total) > 0 then o.piso + (case when o.pos <= (select f from faltan) then 1 else 0 end) else 0 end,
         case when (select t from total) > 0 then 0::bigint else p_r end
  from ordenado o
$$;

\echo '--- reparto R = 1 000 con real 1:1:1 -> 334 / 333 / 333 en orden de codigo (esperado ok = t)'
select (select array_agg(asignado order by codigo) from pg_temp.reparto(1000, array['T01', 'T02', 'T03'], array[1, 1, 1]::numeric[])) = array[334, 333, 333]::bigint[] as ok;

\echo '--- reparto con pesos 0 en todas -> todo va a sin_atribuir; peso negativo pesa 0 (esperado ok = t)'
select (select max(sin_atribuir) from pg_temp.reparto(1000, array['T01', 'T02'], array[0, 0]::numeric[])) = 1000
   and (select sum(asignado) from pg_temp.reparto(1000, array['T01', 'T02'], array[0, 0]::numeric[])) = 0
   and (select asignado from pg_temp.reparto(1000, array['T01', 'T02'], array[-5, 3]::numeric[]) where codigo = 'T01') = 0
   and (select asignado from pg_temp.reparto(1000, array['T01', 'T02'], array[-5, 3]::numeric[]) where codigo = 'T02') = 1000 as ok;

\echo '--- ficha §8 con los reales de la funcion (T01 ene-sep 2026 = 5 950 con la devolucion): R = 15 600 - 1 600 = 14 000 se reparte y la base suma EXACTO 15 600 = Σ B (esperado ok = t)'
with pesos as (
  select array_agg(c order by c) as codigos,
         array_agg(pg_temp.suma(res.r, c, '2026-01', '2026-09', 'u') order by c) as pesos
  from res, unnest(array['T01', 'T02', 'T03']) c
),
rep as (select rr.* from pesos p, pg_temp.reparto(14000, p.codigos, p.pesos) rr)
select (select sum(asignado) + max(sin_atribuir) from rep) + 1600 = 15600 as ok;

\echo '--- ficha §8 con los reales exactos de la ficha (6 000 : 3 000 : 1 000) -> 8 400 / 4 200 / 1 400 y el proyectado oct-dic = vigente - real (esperado ok = t)'
select (select array_agg(asignado order by codigo) from pg_temp.reparto(14000, array['T01', 'T02', 'T03'], array[6000, 3000, 1000]::numeric[])) = array[8400, 4200, 1400]::bigint[]
   and (8400 - 6000) = 2400 as ok;

\echo '--- T11 (abrio en 2026) y T04 (sale) se reconocen por los reales de la funcion: T11 solo tiene 400 u en 2026 (ene-sep), T04 800; T10 ene-sep 2025 = 0 y 2026 = 1 200 (variacion `nueva`) (esperado ok = t)'
select pg_temp.suma(r, 'T11', '2026-01', '2026-09', 'u') = 400 and pg_temp.suma(r, 'T04', '2026-01', '2026-09', 'u') = 800
   and pg_temp.suma(r, 'T10', '2025-01', '2025-09', 'u') = 0 and pg_temp.suma(r, 'T10', '2026-01', '2026-09', 'u') = 1200
   and pg_temp.suma(r, 'T10', '2025-01', '2025-12', 'u') = 300 as ok from res;

\echo '--- mes faltante: sin 2024-03 en cargas el periodo 2024 saldria incompleto; la funcion ademas NO inventa venta para ese mes (esperado ok = t)'
select not (r -> 'cargas' ? '2024-03') and pg_temp.suma(r, 'T01', '2024-03', '2024-03', 'u') = 0 as ok from res;

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Seguridad y propiedades de la función  [solo lectura]
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- la funcion es stable, security invoker, language sql, search_path vacio, devuelve jsonb y tiene 3 argumentos (esperado ok = t)  [solo lectura]'
select p.provolatile = 's' and not p.prosecdef and l.lanname = 'sql' and p.proconfig @> array['search_path=""']
   and p.prorettype = 'jsonb'::regtype and p.pronargs = 3 as ok
from pg_proc p join pg_language l on l.oid = p.prolang
where p.oid = 'public.venta_tienda_nodos(uuid[], date, date)'::regprocedure;

\echo '--- el cuerpo no lleva comentarios -- (el SQL se aplica en trozos) (esperado ok = t)  [solo lectura]'
select p.prosrc !~ '--' as ok from pg_proc p where p.oid = 'public.venta_tienda_nodos(uuid[], date, date)'::regprocedure;

\echo '--- el cuerpo filtra tipo = Tienda y de venta_stock_vigente solo nombra unidades y venta_soles (esperado ok = t)  [solo lectura]'
select p.prosrc like '%t.tipo = ''Tienda''%'
   and p.prosrc !~* '(costo_vendido|stock_unidades|stock_valorizado)'
   and p.prosrc ~ 'v\.unidades' and p.prosrc ~ 'v\.venta_soles' as ok
from pg_proc p where p.oid = 'public.venta_tienda_nodos(uuid[], date, date)'::regprocedure;

\echo '--- permisos: solo service_role ejecuta; public, anon y authenticated no (esperado ok = t)  [solo lectura]'
select not has_function_privilege('anon', 'public.venta_tienda_nodos(uuid[], date, date)', 'execute')
   and not has_function_privilege('authenticated', 'public.venta_tienda_nodos(uuid[], date, date)', 'execute')
   and not has_function_privilege('public', 'public.venta_tienda_nodos(uuid[], date, date)', 'execute')
   and has_function_privilege('service_role', 'public.venta_tienda_nodos(uuid[], date, date)', 'execute') as ok;

create temp table acceso (rol text, rechazado boolean);
grant all on table acceso to public;
do $$
declare
  v_rol text;
begin
  foreach v_rol in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', v_rol);
      perform public.venta_tienda_nodos(array[]::uuid[], date '2026-01-01', date '2026-01-01');
      reset role;
      insert into acceso values (v_rol, false);
    exception when insufficient_privilege then
      insert into acceso values (v_rol, true);
    end;
  end loop;
end
$$;
\echo '--- ejecutar la funcion como anon y como authenticated falla con permiso denegado (esperado: dos filas rechazado = t)'
select rol, rechazado from acceso order by rol;

\echo '--- la funcion no escribe nada: el estado es el mismo antes y despues (esperado ok = t)'
select (select count(*) from venta_stock_mensual) = (select count(*) from venta_fixture) as ok;

\echo '--- comentario de la funcion (esperado ok = t)  [solo lectura]'
select obj_description('public.venta_tienda_nodos(uuid[], date, date)'::regprocedure, 'pg_proc') like 'M7 07f:%' as ok;

rollback;
