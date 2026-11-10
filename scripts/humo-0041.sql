-- Humo SQL de la migración 0041 (M14 · tablero de aprobación de dirección):
--   * permisos y RLS: `aprobaciones_direccion` con RLS activo y sin políticas; anon y authenticated sin ningún permiso; service_role
--     solo select e insert; las 5 funciones security invoker, search_path vacío, solo service_role y sin comentarios `--` en el cuerpo;
--     `tablero_venta` con work_mem 16MB y hash_mem_multiplier 8 y sin nombrar costo ni stock valorizado; la migración queda registrada;
--   * `huella_proyeccion` (R12): qué la mueve (decidir, propuesta, curva, B, B', tienda, crecimiento, Resto, datos hasta, pertenencia a
--     un bloque, método, desactivar) y qué NO (renombrar, nota, nombre o zona de una tienda, autores, recalcular sin cambiar cifras,
--     una carga de venta, un crecimiento inactivo, el Resto provisional, cerrar); el Resto es el APLICADO (`crecimiento_resto_usado`);
--     la fórmula lleva versión; una copia sin cambios tiene la MISMA huella (por contenido, D9);
--   * `tablero_proyeccion` (R1, R4): el caso sintético de la ficha §6.1 (Y = 2026, k = 9; HOMBRE x URBANO detallado y MUJER x URBANO en
--     totales): 2026 cierre 78 501 y 2027 84 714, meses, base, B y B', tiendas de bloque con `para_base`, puente exacto por GM,
--     decisiones por origen, autores y día pico (en hora de Lima), conteos, temporadas, pares para valorizar, mayores, filtros, desgloses,
--     unidad de marca (estimada con `por_marca`, redondeo una sola vez) y `sin_participacion_marca`;
--   * `tablero_venta` (R2): real sin CD, por tienda y mes, cuadre contra la fuente, desgloses con acumulados a k', precios de 12 meses,
--     stock del último mes (tiendas y CD), tendencia sin filtros, semiunión por temporada con las filas base (nodo GMLE incluido),
--     `fuera_universo`, y que `tienda_ids` no cambia `por_tienda` (R10);
--   * `registrar_aprobacion_direccion` y la secuencia de la ficha §6.1 (R14, R16): aprobar en trabajo, cambiar una fila (invalida),
--     con observaciones, cerrar sin tocar cifras (sigue vigente), huella vieja (`huella_distinta` sin fila nueva), resumen con otra
--     huella, archivada, cálculo en curso, sin calcular, no encontrada, los `check` de la tabla y dos registros con la misma huella;
--   * inmutabilidad (R17): update, delete y truncate fallan para el dueño y para service_role; borrar un perfil deja `perfil_id` nulo;
--     una proyección con aprobaciones no se puede borrar (FK restrict);
--   * R25: leer el tablero y aprobar no cambia ni un byte de las tablas de la proyección.
-- La concurrencia REAL (dos conexiones a la vez) no cabe en un humo de una sola sesión: aquí se prueba la secuencia.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea la base local con todas las migraciones, dos veces)
--   3. bash scripts/correr-humos.sh scripts/humo-0041.sql
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- NO necesita fixture previo: carga el suyo (árbol, tiendas, marcas, cargas, venta y dos proyecciones). Todo inventado (las cifras
-- son las de la ficha §6.1): nada de datos reales de Lukers. Las funciones se llaman con `set local role service_role` (la API corre
-- con ese rol). Todo va dentro de UNA transacción que termina en `rollback`: no deja nada escrito.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- En Supabase `service_role` tiene BYPASSRLS; el rol de la base local no (ver humo-0032).
alter role service_role bypassrls;

create temp table r (n serial, caso text, ok boolean);
create temp table res (k text primary key, v jsonb);
create temp table hu (k text primary key, v text);
create temp table privs (p text primary key);
insert into privs values ('select'), ('insert'), ('update'), ('delete'), ('truncate'), ('references'), ('trigger');

create or replace function pg_temp.id(n integer) returns uuid language sql as $f$
  select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $f$;
create or replace function pg_temp.rk(n text) returns jsonb language sql as $f$ select v from res where res.k = $1 $f$;
create or replace function pg_temp.hk(n text) returns text language sql as $f$ select v from hu where hu.k = $1 $f$;
-- Número en una ruta del documento.
create or replace function pg_temp.jn(doc jsonb, variadic ruta text[]) returns numeric language sql as $f$
  select (doc #>> ruta)::numeric $f$;

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

-- Llamadas con el rol de la API. Devuelven el resultado de la función o { error: 'EXC', sqlstate, msg } si lanzó una excepción.
create or replace function pg_temp.tp(p_id uuid, p jsonb default '{}'::jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.tablero_proyeccion(p_id, p);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', 'EXC', 'sqlstate', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.tv(p jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.tablero_venta(p);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', 'EXC', 'sqlstate', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.reg(p jsonb) returns jsonb language plpgsql as $f$
declare v jsonb;
begin
  set local role service_role;
  v := public.registrar_aprobacion_direccion(p);
  reset role;
  return v;
exception when others then
  reset role;
  return jsonb_build_object('error', 'EXC', 'sqlstate', sqlstate, 'msg', sqlerrm);
end $f$;
create or replace function pg_temp.h(p_id uuid) returns text language plpgsql as $f$
declare v text;
begin
  set local role service_role;
  v := public.huella_proyeccion(p_id);
  reset role;
  return v;
exception when others then
  reset role;
  return 'EXC ' || sqlstate;
end $f$;

-- ¿La sentencia `q` mueve la huella de la proyección 100 y `q_rev` la devuelve a la de antes?
create or replace function pg_temp.mueve(q text, q_rev text) returns boolean language plpgsql as $f$
declare h0 text; h1 text; h2 text;
begin
  h0 := public.huella_proyeccion(pg_temp.id(100));
  execute q;
  h1 := public.huella_proyeccion(pg_temp.id(100));
  execute q_rev;
  h2 := public.huella_proyeccion(pg_temp.id(100));
  return h0 is not null and h1 is distinct from h0 and h2 = h0;
end $f$;
create or replace function pg_temp.no_mueve(q text, q_rev text) returns boolean language plpgsql as $f$
declare h0 text; h1 text; h2 text;
begin
  h0 := public.huella_proyeccion(pg_temp.id(100));
  execute q;
  h1 := public.huella_proyeccion(pg_temp.id(100));
  execute q_rev;
  h2 := public.huella_proyeccion(pg_temp.id(100));
  return h0 is not null and h1 = h0 and h2 = h0;
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture (ficha §6.1)
-- ---------------------------------------------------------------------------------------------------------------------
-- Árbol: HOMBRE x URBANO con L1 (nodo GML) y L2 (nodo GMLE: sus filas llevan equivalencia), MUJER x URBANO L1 y NIÑO x URBANO L1 (vende
-- en 2023 y NO tiene filas en la proyección: `fuera_universo`).
insert into generos (codigo, nombre) values ('H41H', 'HOMBRE H41'), ('H41M', 'MUJER H41'), ('H41N', 'NINO H41');
insert into mundos (codigo, nombre) values ('H41U', 'URBANO H41');
insert into lineas (codigo, nombre, temporada) values ('H41L1', 'LINEA UNO H41', 'Todo el año'), ('H41L2', 'LINEA DOS H41', 'Invierno');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, v.nivel
from (values ('H41H', 'H41L1', 'GML'), ('H41H', 'H41L2', 'GMLE'), ('H41M', 'H41L1', 'GML'), ('H41N', 'H41L1', 'GML')) as v(g, l, nivel)
join generos g on g.codigo = v.g
join lineas l on l.codigo = v.l
join mundos mu on mu.codigo = 'H41U';

create temp table nd as
select case g.codigo when 'H41H' then 'HU' when 'H41M' then 'MU' else 'NU' end || right(l.codigo, 1) as cod, n.id, n.genero_id, n.mundo_id
from genero_mundo_linea n
join generos g on g.id = n.genero_id
join lineas l on l.id = n.linea_id
where g.codigo in ('H41H', 'H41M', 'H41N');
create or replace function pg_temp.nodo(c text) returns uuid language sql as $f$ select id from nd where cod = c $f$;
create or replace function pg_temp.gen(c text) returns uuid language sql as $f$ select id from generos where codigo = c $f$;

insert into tiendas (codigo, nombre, tipo, fecha_apertura, fecha_cierre) values
  ('H41T01', 'TIENDA 01 H41', 'Tienda', date '2015-01-01', null), ('H41T02', 'TIENDA 02 H41', 'Tienda', date '2015-01-01', null),
  ('H41T03', 'TIENDA 03 H41', 'Tienda', date '2015-01-01', null), ('H41T04', 'TIENDA 04 H41', 'Tienda', date '2015-01-01', date '2027-06-30'),
  ('H41T09', 'TIENDA 09 H41', 'Tienda', date '2015-01-01', date '2024-08-31'), ('H41T10', 'TIENDA 10 H41', 'Tienda', date '2025-11-15', null),
  ('H41T12', 'TIENDA 12 H41', 'Tienda', date '2027-04-01', null),
  ('H41CD1', 'CD UNO H41', 'Centro de Distribución', null, null);
create temp table ti as select right(codigo, 3) as cod, id from tiendas where codigo like 'H41%';
create or replace function pg_temp.t(c text) returns uuid language sql as $f$ select id from ti where cod = c $f$;

insert into agrupaciones_talla (codigo, nombre) values ('H41TA', 'TALLA A H41'), ('H41TB', 'TALLA B H41');
insert into agrupaciones_marca (codigo, nombre) values ('H41AMA', 'AM-A H41'), ('H41AMB', 'AM-B H41');
create or replace function pg_temp.am(c text) returns uuid language sql as $f$ select id from agrupaciones_marca where codigo = 'H41AM' || c $f$;
-- Marcas: X (cabeza de unidad, AM-A), X2 (miembro del conjunto de X: su unidad es X), A2 (otra unidad de AM-A) y B1 (AM-B).
insert into marcas (codigo, nombre, agrupacion_marca_id) values
  ('H41X', 'MARCA X H41', pg_temp.am('A')), ('H41A2', 'MARCA A2 H41', pg_temp.am('A')), ('H41B1', 'MARCA B1 H41', pg_temp.am('B'));
insert into marcas (codigo, nombre, agrupacion_marca_id, conjunto_marca_id)
select 'H41X2', 'MARCA X2 H41', pg_temp.am('A'), id from marcas where codigo = 'H41X';
create or replace function pg_temp.mc(c text) returns uuid language sql as $f$ select id from marcas where codigo = 'H41' || c $f$;

insert into equivalencias (genero_mundo_linea_id, codigo, nombre) values
  (pg_temp.nodo('HU1'), 'EH1', 'EQUIV H1 H41'), (pg_temp.nodo('HU2'), 'EH2', 'EQUIV H2 H41'),
  (pg_temp.nodo('MU1'), 'EM1', 'EQUIV M1 H41'), (pg_temp.nodo('NU1'), 'EN1', 'EQUIV N1 H41');
create or replace function pg_temp.eq(c text) returns uuid language sql as $f$ select id from equivalencias where codigo = c and nombre like '% H41' $f$;

-- Cargas publicadas de 2023-01 a 2026-10 (k' = 10) y una RETIRADA de 2026-11 (no cuenta nunca).
insert into cargas_venta_stock (periodo, estado, publicada_at)
select m::date, 'publicada', now() from generate_series(date '2023-01-01', date '2026-10-01', interval '1 month') m;
insert into cargas_venta_stock (periodo, estado, publicada_at) values (date '2026-11-01', 'retirada', now());
create or replace function pg_temp.carga(d date) returns uuid language sql as $f$
  select id from cargas_venta_stock where periodo = d and estado in ('publicada', 'retirada') $f$;

-- Venta de HOMBRE x URBANO por tienda y mes (ficha §6.1). 2023 y 2024 van enteros en junio (solo importa el total del año).
create temp table vt (periodo date, tienda text, u integer);
insert into vt values
  (date '2023-06-01', 'T01', 19000), (date '2023-06-01', 'T02', 12000), (date '2023-06-01', 'T03', 6000), (date '2023-06-01', 'T04', 2500),
  (date '2023-06-01', 'T09', 500),
  (date '2024-06-01', 'T01', 20000), (date '2024-06-01', 'T02', 12500), (date '2024-06-01', 'T03', 6500), (date '2024-06-01', 'T04', 2700),
  (date '2024-06-01', 'T09', 300);
insert into vt
select make_date(x.anio, m.i::integer, 1), x.tienda, m.u
from (values
  (2025, 'T01', array[1607, 1378, 1493, 1607, 1952, 1837, 2182, 1722, 1722, 1600, 1800, 3100]),
  (2025, 'T02', array[996, 853, 924, 995, 1209, 1138, 1351, 1067, 1067, 1083, 1219, 2098]),
  (2025, 'T03', array[338, 304, 371, 608, 810, 877, 911, 742, 439, 600, 600, 900]),
  (2025, 'T04', array[259, 222, 241, 259, 315, 296, 352, 278, 278, 172, 194, 334]),
  (2025, 'T10', array[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 100, 200]),
  (2026, 'T01', array[1556, 1333, 1444, 1555, 1889, 1778, 2111, 1667, 1667, 1650]),
  (2026, 'T02', array[933, 800, 867, 933, 1133, 1067, 1267, 1000, 1000, 1000]),
  (2026, 'T03', array[313, 281, 344, 563, 750, 812, 844, 687, 406, 400]),
  (2026, 'T04', array[207, 178, 193, 207, 252, 237, 282, 222, 222, 240]),
  (2026, 'T10', array[334, 334, 334, 333, 333, 333, 333, 333, 333, 1010])
) as x(anio, tienda, arr)
cross join lateral unnest(x.arr) with ordinality as m(u, i)
where m.u <> 0;

-- Cada total de tienda y mes se reparte entre L1 (EH1) y L2 (EH2) y entre las marcas X, X2, A2 (AM-A) y B1 (AM-B), en enteros que suman
-- el total. Precio por unidad: 47 (2023), 48 (2024), 49,42 (ene–oct 2025) y 52 (nov 2025 en adelante: los 12 meses de `precios`).
create temp table vd as
select v.periodo, v.tienda, x.eq, x.marca, x.u,
       x.u * case when v.periodo < date '2024-01-01' then 47 when v.periodo < date '2025-01-01' then 48
                  when v.periodo < date '2025-11-01' then 49.42 else 52 end as s
from vt v
cross join lateral (
  select floor(v.u * 0.20)::integer as b1, floor(v.u * 0.10)::integer as x2l, floor(v.u * 0.05)::integer as b2l,
         case when v.u >= 100 then 10 else 0 end as xx2, case when v.u >= 100 then 20 else 0 end as a2
) p
cross join lateral (values
  ('EH1', 'B1', p.b1), ('EH2', 'X', p.x2l), ('EH2', 'B1', p.b2l), ('EH1', 'X2', p.xx2), ('EH1', 'A2', p.a2),
  ('EH1', 'X', v.u - p.b1 - p.x2l - p.b2l - p.xx2 - p.a2)
) as x(eq, marca, u)
where x.u <> 0;
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, venta_soles)
select pg_temp.carga(d.periodo), pg_temp.t(d.tienda), pg_temp.eq(d.eq), pg_temp.mc(d.marca),
       (select id from agrupaciones_talla where codigo = 'H41TA'), d.u, d.s
from vd d;

-- Lo demás, con la talla B para no chocar con la clave primaria: el ajuste de soles de 2025 (para que el año dé S/ 2 350 000), MUJER x
-- URBANO (2025: 27 500, ene–oct 21 000; 2026: ene–set 20 000 y oct 2 300; solo T01–T03), NIÑO (3 100 u en 2023, sin filas en la
-- proyección), el CD (900 u en 2025 que NO deben aparecer y 12 000 de stock en oct 2026), el stock de oct 2026 por tienda, un stock de
-- set 2026 que NO debe contar y una venta en la carga retirada que tampoco.
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, venta_soles, stock_unidades)
select pg_temp.carga(x.periodo), pg_temp.t(x.tienda), pg_temp.eq(x.eq), pg_temp.mc(x.marca),
       (select id from agrupaciones_talla where codigo = 'H41TB'), x.u, x.s, x.stock
from (values
  (date '2025-01-01', 'T01', 'EH1', 'X', 0, 53.90, 0),
  (date '2025-05-01', 'T01', 'EM1', 'X', 21000, 1260000.00, 0), (date '2025-12-01', 'T02', 'EM1', 'B1', 6500, 390000.00, 0),
  (date '2026-03-01', 'T01', 'EM1', 'X', 20000, 1200000.00, 0), (date '2026-10-01', 'T03', 'EM1', 'B1', 2300, 138000.00, 0),
  (date '2023-02-01', 'T01', 'EN1', 'B1', 3100, 31000.00, 0),
  (date '2025-03-01', 'CD1', 'EH1', 'X', 900, 45000.00, 0), (date '2026-10-01', 'CD1', 'EH1', 'X', 0, 0.00, 12000),
  (date '2026-10-01', 'T01', 'EH1', 'X', 0, 0.00, 8000), (date '2026-10-01', 'T02', 'EH1', 'X', 0, 0.00, 5000),
  (date '2026-10-01', 'T03', 'EH1', 'X', 0, 0.00, 2500), (date '2026-10-01', 'T04', 'EH1', 'X', 0, 0.00, 1000),
  (date '2026-10-01', 'T10', 'EH1', 'X', 0, 0.00, 1500), (date '2026-10-01', 'T01', 'EM1', 'X', 0, 0.00, 700),
  (date '2026-09-01', 'T01', 'EH1', 'X', 0, 0.00, 99999),
  (date '2026-11-01', 'T01', 'EH1', 'X', 999, 51948.00, 5)
) as x(periodo, tienda, eq, marca, u, s, stock);

-- Perfiles.
insert into auth.users (id, email) values (pg_temp.id(9001), 'admin41@humo.test'), (pg_temp.id(9002), 'planner41@humo.test');
insert into public.perfiles (id, email, nombre, rol, activo) values
  (pg_temp.id(9001), 'admin41@humo.test', 'Admin A.', 'admin', true), (pg_temp.id(9002), 'planner41@humo.test', 'Planner P.', 'planner', true);

-- Proyección 100: «Proyección 2026–2027», EN TRABAJO (la secuencia de aprobación la cierra después), Y = 2026, k = 9.
-- El Resto PROVISIONAL (`crecimiento_pct_defecto`, 20) no es el que se aplicó (`crecimiento_resto_usado`: 3 % sobre la base corregida).
-- bloques[2026]: mismas T01–T04, nuevas T10 (del año anterior), fuera T09 y T12. bloques[2027]: mismas T01, T02, T03, T10; nuevas T12
-- (aperturas); cierres T04; fuera T09. Cada tienda trae su `clave` de pertenencia de cinco posiciones.
create or replace function pg_temp.tb(c text, clave text, sub text default null) returns jsonb language sql as $f$
  select jsonb_strip_nulls(jsonb_build_object('tienda_id', pg_temp.t(c), 'codigo', c, 'nombre', 'TIENDA ' || c, 'zona', 'LIMA',
                                              'clave', clave, 'subbloque', sub)) $f$;
insert into proyecciones (id, anio_en_curso, nombre, estado, hasta_periodo, parametros, resumen, calculado_at, nota, usuario_nombre)
values (
  pg_temp.id(100), 2026, 'Proyeccion 2026-2027 H41', 'en_trabajo', date '2026-09-01',
  jsonb_build_object(
    'crecimiento_pct_defecto', 20, 'crecimiento_objetivo_pct', 6.0,
    'crecimiento_resto_usado', jsonb_build_object('pct', 3, 'sobre_base', 'corregida', 'version', 2, 'por_nombre', 'Planner P.',
                                                  'at', '2026-11-07T12:00:00+00:00', 'crecimiento_id', null),
    'bloques', jsonb_build_object(
      '2026', jsonb_build_object(
        'mismas', jsonb_build_array(pg_temp.tb('T01', '11111'), pg_temp.tb('T02', '11111'), pg_temp.tb('T03', '11111'), pg_temp.tb('T04', '11110')),
        'nuevas', jsonb_build_array(pg_temp.tb('T10', '00001', 'nuevas_anterior')),
        'cierres', '[]'::jsonb,
        'fuera', jsonb_build_array(pg_temp.tb('T09', '10000'), pg_temp.tb('T12', '00000'))),
      '2027', jsonb_build_object(
        'mismas', jsonb_build_array(pg_temp.tb('T01', '11111'), pg_temp.tb('T02', '11111'), pg_temp.tb('T03', '11111'), pg_temp.tb('T10', '00001')),
        'nuevas', jsonb_build_array(pg_temp.tb('T12', '00000', 'aperturas')),
        'cierres', jsonb_build_array(pg_temp.tb('T04', '11110')),
        'fuera', jsonb_build_array(pg_temp.tb('T09', '10000'))))),
  '{"version_metodo": 5, "desvio_prueba_anterior_pct": -3.2}'::jsonb,
  timestamptz '2026-11-07 12:00:00+00', 'nota inicial', 'Planner P.');

-- Filas. Base de HOMBRE x URBANO: F1 L1·AM-A, F2 L1·AM-B (todo el año), F3 L2·AM-A y F4 L2·AM-B (invierno, nodo GMLE, factor del Niño
-- 0,70 en jun–ago de 2026). Tienda: FT10 (T10, nueva del año anterior, L1·AM-A), FT04 (T04, cierre, L1·AM-B) y FT12 (T12, apertura,
-- L1·AM-A). Base de MUJER x URBANO: M1 (AM-A) y M2 (AM-B), sin temporada. `por_marca`: X pesa 0,63 en F1 y 0,40 en F3; F4 y M2 no traen.
create temp table fx (cod text primary key, id uuid, tienda text, nodo text, eq text, am text, temporada text, factores jsonb, pm jsonb);
insert into fx values
  ('F1', pg_temp.id(201), null, 'HU1', null, 'A', 'todo_el_ano', null,
    jsonb_build_array(jsonb_build_object('marca_id', pg_temp.mc('X'), 'participacion', 0.63), jsonb_build_object('marca_id', pg_temp.mc('A2'), 'participacion', 0.37))),
  ('F2', pg_temp.id(202), null, 'HU1', null, 'B', 'todo_el_ano', null,
    jsonb_build_array(jsonb_build_object('marca_id', pg_temp.mc('B1'), 'participacion', 1))),
  ('F3', pg_temp.id(203), null, 'HU2', 'EH2', 'A', 'invierno', '{"2026": [1, 1, 1, 1, 1, 0.7, 0.7, 0.7, 1, 1, 1, 1], "2027": [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]}',
    jsonb_build_array(jsonb_build_object('marca_id', pg_temp.mc('X'), 'participacion', 0.40), jsonb_build_object('marca_id', pg_temp.mc('A2'), 'participacion', 0.60))),
  ('F4', pg_temp.id(204), null, 'HU2', 'EH2', 'B', 'invierno', '{"2026": [1, 1, 1, 1, 1, 0.7, 0.7, 0.7, 1, 1, 1, 1]}', null),
  ('FT10', pg_temp.id(205), 'T10', 'HU1', null, 'A', 'todo_el_ano', null, null),
  ('FT04', pg_temp.id(206), 'T04', 'HU1', null, 'B', 'todo_el_ano', null, null),
  ('FT12', pg_temp.id(207), 'T12', 'HU1', null, 'A', 'todo_el_ano', null, null),
  ('M1', pg_temp.id(208), null, 'MU1', null, 'A', null, null,
    jsonb_build_array(jsonb_build_object('marca_id', pg_temp.mc('A2'), 'participacion', 1))),
  ('M2', pg_temp.id(209), null, 'MU1', null, 'B', null, null, null);
insert into proyeccion_filas (id, proyeccion_id, tienda_id, gml_id, equivalencia_id, agrupacion_marca_id, clave, nivel_proyectado, temporada,
                              factores_mes, historico, participaciones)
select f.id, pg_temp.id(100), pg_temp.t(f.tienda), pg_temp.nodo(f.nodo), pg_temp.eq(f.eq), pg_temp.am(f.am),
       coalesce(pg_temp.t(f.tienda)::text, '') || '|' || pg_temp.nodo(f.nodo)::text || '|' || coalesce(pg_temp.eq(f.eq)::text, '') || '|' || pg_temp.am(f.am)::text,
       case when f.eq is null then 'GML' else 'GMLE' end, f.temporada, f.factores, '{}'::jsonb,
       case when f.pm is null then null else jsonb_build_object('por_marca', f.pm, 'por_talla', '[]'::jsonb) end
from fx f;
create or replace function pg_temp.f(c text) returns uuid language sql as $f$ select id from fx where cod = c $f$;

-- Un lote (07g) para las filas decididas en bloque.
insert into proyeccion_lotes (id, confirmacion_id, proyeccion_id, tipo, anio, huella_cuerpo, calculado_at_proyeccion, resumen)
values (pg_temp.id(300), gen_random_uuid(), pg_temp.id(100), 'aprobar', 2027, repeat('a', 64), timestamptz '2026-11-07 12:00:00+00', '{}'::jsonb);

-- Registros. `d` = decidido, `o` = origen, `pad` = propuesta_al_decidir, `lote` = decidido en bloque, `quien` y `cuando` = autor y hora.
-- Una decisión va a las 03:00 UTC del 8 de noviembre: en Lima es el 7 a las 22:00 (los autores y el día pico van en hora de Lima).
create temp table ax (cod text, anio integer, bloque text, sub text, vendido integer, prop integer, d integer, o text, pad integer, lote boolean,
                      quien text, cuando timestamptz, meses integer[], b integer, bc numeric, mp integer[]);
insert into ax values
  ('F1', 2026, 'mismas', null, 16150, 24000, 24000, 'propuesta', 24000, false, 'Planner P.', '2026-11-07 15:00:00+00',
    array[1196, 779, 1035, 1445, 2211, 2571, 3181, 2252, 1480, 1750, 1900, 4200], null, null, null),
  ('F2', 2026, 'mismas', null, 6750, 10000, 10000, 'propuesta', 10000, false, 'Planner P.', '2026-11-07 15:00:00+00',
    array[750, 750, 750, 750, 750, 750, 750, 750, 750, 800, 950, 1500], null, null, null),
  ('F3', 2026, 'mismas', null, 5400, 8001, 8001, 'propuesta', 8001, false, 'Planner P.', '2026-11-07 15:00:00+00',
    array[700, 700, 700, 700, 700, 400, 400, 400, 700, 700, 800, 1101], null, null, null),
  ('F4', 2026, 'mismas', null, 2700, 3900, 3900, 'propuesta', 3900, false, 'Planner P.', '2026-11-07 15:00:00+00',
    array[363, 363, 363, 363, 363, 173, 173, 174, 365, 350, 400, 450], null, null, null),
  ('FT10', 2026, 'nuevas', 'nuevas_anterior', 3000, 4100, 4100, 'propuesta', 4100, false, 'Planner P.', '2026-11-07 15:00:00+00',
    array[334, 334, 334, 333, 333, 333, 333, 333, 333, 300, 330, 470], null, null, null),
  ('M1', 2026, 'mismas', null, 12000, 17500, 17500, 'propuesta', 17500, false, 'Planner P.', '2026-11-07 15:00:00+00',
    array[1334, 1334, 1334, 1333, 1333, 1333, 1333, 1333, 1333, 1800, 1800, 1900], null, null, null),
  ('M2', 2026, 'mismas', null, 8000, 11000, null, null, null, false, null, null,
    array[889, 889, 889, 889, 889, 889, 889, 889, 888, 1000, 1000, 1000], null, null, null),
  ('F1', 2027, 'mismas', null, 0, 25000, 25000, 'propuesta', 25000, true, 'Planner P.', '2026-11-07 15:00:00+00',
    array[1413, 910, 1162, 1413, 2168, 1916, 2671, 1664, 1664, 1916, 2417, 5686], 23500, 23500.00,
    array[1400, 923, 1162, 1413, 2168, 1916, 2671, 1664, 1664, 1916, 2417, 5686]),
  ('F2', 2027, 'mismas', null, 0, 12000, 12000, 'propuesta', 11900, false, 'Planner P.', '2026-11-08 03:00:00+00',
    array[1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 11300, 11300.00, null),
  ('F3', 2027, 'mismas', null, 0, 8883, 9000, 'manual', 8883, false, 'Planner P.', '2026-11-07 15:00:00+00',
    array[750, 750, 750, 750, 750, 750, 750, 750, 750, 750, 750, 750], 8200, 8700.40, null),
  ('F4', 2027, 'mismas', null, 0, 4300, 4300, 'propuesta', 4300, true, 'Planner P.', '2026-11-07 15:00:00+00',
    array[358, 358, 358, 358, 358, 358, 358, 358, 358, 358, 360, 360], 4040, 4292.60, null),
  ('FT04', 2027, 'cierres', null, 0, 1000, 1000, 'propuesta', 1000, false, 'Planner P.', '2026-11-07 15:00:00+00',
    array[150, 140, 150, 160, 200, 200, 0, 0, 0, 0, 0, 0], null, null, null),
  ('FT12', 2027, 'nuevas', 'aperturas', 0, 1300, 1408, 'manual', 1300, false, 'Admin A.', '2026-11-06 15:00:00+00',
    array[0, 0, 0, 100, 120, 130, 150, 160, 150, 170, 180, 248], null, null, null),
  ('M1', 2027, 'mismas', null, 0, 18780, 20006, 'manual', 18780, false, 'Admin A.', '2026-11-05 15:00:00+00',
    array[1667, 1667, 1667, 1667, 1667, 1667, 1667, 1667, 1667, 1667, 1667, 1669], 17500, 17500.00, null),
  ('M2', 2027, 'mismas', null, 0, 12000, 12000, 'propuesta', 12000, true, 'Planner P.', '2026-11-07 15:00:00+00',
    array[1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000], 11000, 11000.00, null);
insert into proyeccion_fila_anios (id, fila_id, anio, bloque, subbloque, vendido, propuesto, decidido, origen, propuesta_al_decidir, decision_lote_id,
                                   decidido_por_nombre, decidido_at, meses, base_siguiente, base_normalizada, meses_propuestos)
select md5(a.cod || a.anio)::uuid, pg_temp.f(a.cod), a.anio, a.bloque, a.sub, a.vendido, a.prop, a.d, a.o, a.pad,
       case when a.lote then pg_temp.id(300) end, a.quien, a.cuando, a.meses, a.b, a.bc, a.mp
from ax a;
create or replace function pg_temp.a(c text, anio integer) returns uuid language sql as $f$ select md5(c || anio)::uuid $f$;

insert into proyeccion_tiendas (proyeccion_id, tienda_id, anio, bloque, subbloque, fecha_usada, propuesto, decidido, origen) values
  (pg_temp.id(100), pg_temp.t('T10'), 2026, 'nuevas', 'nuevas_anterior', date '2025-11-15', 4100, 4100, 'propuesta'),
  (pg_temp.id(100), pg_temp.t('T12'), 2027, 'nuevas', 'aperturas', date '2027-04-01', 1300, 1408, 'manual'),
  (pg_temp.id(100), pg_temp.t('T04'), 2027, 'cierres', null, date '2027-06-30', 1000, null, null);
-- Crecimientos: HOMBRE +5 % sobre corregida (v2), MUJER +8 % (v4) y uno INACTIVO de NIÑO (no entra en la huella).
insert into proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, version, sobre_base, usuario_nombre, activo) values
  (pg_temp.id(100), pg_temp.gen('H41H'), (select id from mundos where codigo = 'H41U'), 5.0, 2, 'corregida', 'Planner P.', true),
  (pg_temp.id(100), pg_temp.gen('H41M'), (select id from mundos where codigo = 'H41U'), 8.0, 4, 'bruta', 'Planner P.', true),
  (pg_temp.id(100), pg_temp.gen('H41N'), (select id from mundos where codigo = 'H41U'), 9.0, 1, 'bruta', 'Planner P.', false);

-- Copia de una proyección (lo que hace «copiar de»): mismas cifras y mismas `clave`, otros ids; no copia el lote ni los autores.
create or replace function pg_temp.copiar(p_origen uuid, p_nuevo uuid, p_nombre text) returns uuid language plpgsql as $f$
begin
  insert into public.proyecciones (id, anio_en_curso, nombre, estado, hasta_periodo, parametros, resumen, calculado_at)
  select p_nuevo, anio_en_curso, p_nombre, 'en_trabajo', hasta_periodo, parametros, resumen, calculado_at
  from public.proyecciones where id = p_origen;
  insert into public.proyeccion_filas (id, proyeccion_id, tienda_id, gml_id, equivalencia_id, agrupacion_marca_id, clave, nivel_proyectado,
                                       temporada, factores_mes, historico, participaciones, activo)
  select md5(p_nuevo::text || f.id::text)::uuid, p_nuevo, f.tienda_id, f.gml_id, f.equivalencia_id, f.agrupacion_marca_id, f.clave,
         f.nivel_proyectado, f.temporada, f.factores_mes, f.historico, f.participaciones, f.activo
  from public.proyeccion_filas f where f.proyeccion_id = p_origen;
  insert into public.proyeccion_fila_anios (fila_id, anio, bloque, subbloque, vendido, propuesto, decidido, origen, propuesta_al_decidir,
                                            meses, base_siguiente, base_normalizada, activo)
  select md5(p_nuevo::text || f.id::text)::uuid, a.anio, a.bloque, a.subbloque, a.vendido, a.propuesto, a.decidido, a.origen,
         a.propuesta_al_decidir, a.meses, a.base_siguiente, a.base_normalizada, a.activo
  from public.proyeccion_filas f join public.proyeccion_fila_anios a on a.fila_id = f.id where f.proyeccion_id = p_origen;
  insert into public.proyeccion_tiendas (proyeccion_id, tienda_id, anio, bloque, subbloque, fecha_usada, propuesto, decidido, origen, activo)
  select p_nuevo, tienda_id, anio, bloque, subbloque, fecha_usada, propuesto, decidido, origen, activo
  from public.proyeccion_tiendas where proyeccion_id = p_origen;
  insert into public.proyeccion_crecimientos (proyeccion_id, genero_id, mundo_id, pct, version, sobre_base, activo)
  select p_nuevo, genero_id, mundo_id, pct, version, sobre_base, activo
  from public.proyeccion_crecimientos where proyeccion_id = p_origen;
  return p_nuevo;
end $f$;

-- Atajos sobre los documentos.
-- Suma de `u` (col 2) o `s` (col 3) de `por_tienda` entre dos meses 'aaaa-mm', de una tienda (por código) o de todas.
create or replace function pg_temp.pts(doc jsonb, desde text, hasta text, tienda text default null, col integer default 2)
returns numeric language sql as $f$
  select coalesce(sum((e ->> col)::numeric), 0)
  from jsonb_array_elements(doc -> 'por_tienda') e
  where e ->> 1 >= desde and e ->> 1 <= hasta
    and (tienda is null or (e ->> 0)::integer = (
      select (x.i - 1)::integer from jsonb_array_elements_text(doc -> 'tiendas') with ordinality as x(id, i) where x.id = pg_temp.t(tienda)::text))
$f$;
-- Suma de la columna `col` de las filas de `por_dim` (todas, o la del id dado).
create or replace function pg_temp.pds(doc jsonb, col integer, d text default null) returns numeric language sql as $f$
  select coalesce(sum((e ->> col)::numeric), 0)
  from jsonb_array_elements(doc -> 'por_dim' -> 'filas') e
  where d is null or (doc -> 'por_dim' -> 'ids' ->> (e ->> 0)::integer) = d
$f$;
-- Año `i` (0 = Y, 1 = Y+1) de un documento de tablero_proyeccion.
create or replace function pg_temp.an(doc jsonb, i integer) returns jsonb language sql as $f$ select doc -> 'anios' -> i $f$;
-- Total del año: base más tiendas.
create or replace function pg_temp.tot(doc jsonb, i integer) returns numeric language sql as $f$
  select (doc -> 'anios' -> i -> 'base' ->> 'vigente')::numeric
       + coalesce((select sum((x ->> 'vigente')::numeric) from jsonb_array_elements(doc -> 'anios' -> i -> 'tiendas') x), 0) $f$;
-- Una tienda de bloque del año `i`.
create or replace function pg_temp.tda(doc jsonb, i integer, tienda text) returns jsonb language sql as $f$
  select x from jsonb_array_elements(doc -> 'anios' -> i -> 'tiendas') x where x ->> 't' = pg_temp.t(tienda)::text $f$;
-- Un GM de `por_gm`.
create or replace function pg_temp.gm(doc jsonb, genero text) returns jsonb language sql as $f$
  select x from jsonb_array_elements(doc -> 'por_gm') x where x ->> 'g' = pg_temp.gen(genero)::text $f$;
-- Suma de un campo de `por_gm` (ruta de dos claves) sobre todos los GM.
create or replace function pg_temp.gms(doc jsonb, a text, b text) returns numeric language sql as $f$
  select coalesce(sum((x -> a ->> b)::numeric), 0) from jsonb_array_elements(doc -> 'por_gm') x $f$;
-- Un elemento de `por_dim` de tablero_proyeccion.
create or replace function pg_temp.pd(doc jsonb, d text) returns jsonb language sql as $f$
  select x from jsonb_array_elements(doc -> 'por_dim') x where x ->> 'd' = d $f$;
-- Total de `por_dim` del año (clave 'Y' o 'Y1'): base más tiendas de todos los elementos.
create or replace function pg_temp.pdt(doc jsonb, anio text) returns numeric language sql as $f$
  select coalesce(sum((x -> anio ->> 'base')::numeric), 0)
       + coalesce((select sum((y ->> 1)::numeric) from jsonb_array_elements(doc -> 'por_dim') x2, jsonb_array_elements(x2 -> anio -> 'tiendas') y), 0)
  from jsonb_array_elements(doc -> 'por_dim') x $f$;
-- Payload de registrar_aprobacion_direccion.
create or replace function pg_temp.pl(proy uuid, huella text, resultado text default 'aprobada', motivo text default null,
                                      comentario text default null, extra jsonb default '{}'::jsonb) returns jsonb language sql as $f$
  select jsonb_build_object('proyeccion_id', proy, 'huella_vista', huella, 'resultado', resultado, 'motivo', motivo, 'comentario', comentario,
                            'resumen', jsonb_build_object('huella', huella, 'hasta_periodo', '2026-09-01', 'version_metodo', 5, 'totales', '[]'::jsonb),
                            'perfil_id', pg_temp.id(9001), 'usuario_nombre', 'Admin A.', 'rol', 'admin') || extra $f$;
-- Estado de dirección derivado (lo que hará el backend, ficha §5.1): manda la aprobación más reciente y vale si su huella es la actual.
-- Todo el humo corre en una transacción y `created_at` es `now()`: el desempate es el orden físico de inserción (`ctid`).
create or replace function pg_temp.estado_dir(proy uuid) returns text language sql as $f$
  select case when x.id is null then 'sin_aprobacion'
              when x.huella = public.huella_proyeccion(proy) then x.resultado
              else 'invalidada' end
  from (select 1) uno
  left join lateral (
    select a.id, a.huella, a.resultado from public.aprobaciones_direccion a where a.proyeccion_id = proy order by a.created_at desc, a.ctid desc limit 1
  ) x on true $f$;
create or replace function pg_temp.napr(proy uuid default null) returns integer language sql as $f$
  select count(*)::integer from public.aprobaciones_direccion where proy is null or proyeccion_id = proy $f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura, permisos y RLS
-- ---------------------------------------------------------------------------------------------------------------------
create temp table fn as
select p.oid, p.proname, p.prosrc, p.prosecdef, p.provolatile, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('huella_proyeccion', 'tablero_proyeccion', 'tablero_venta', 'registrar_aprobacion_direccion', 'tg_aprobaciones_direccion_inmutable');

insert into r (caso, ok) values
  ('aprobaciones_direccion existe con RLS activo y SIN politicas',
    (select c.relrowsecurity from pg_class c where c.oid = 'public.aprobaciones_direccion'::regclass)
    and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'aprobaciones_direccion') = 0),
  ('anon y authenticated no tienen NINGUN privilegio sobre la tabla',
    not exists (select 1 from privs, (values ('anon'), ('authenticated')) as x(rol)
                where has_table_privilege(x.rol, 'public.aprobaciones_direccion', privs.p))),
  ('service_role tiene EXACTAMENTE select e insert (sin update, delete, truncate, references ni trigger)',
    (select array_agg(privs.p order by privs.p) from privs where has_table_privilege('service_role', 'public.aprobaciones_direccion', privs.p))
      = array['insert', 'select']),
  ('las 5 funciones existen, son security invoker y llevan search_path vacio',
    (select count(*) from fn) = 5
    and not exists (select 1 from fn where prosecdef)
    and not exists (select 1 from fn where not coalesce(proconfig, '{}') @> array['search_path=""'])),
  ('execute de las 5 funciones: service_role si; anon, authenticated y public no',
    not exists (select 1 from fn where not has_function_privilege('service_role', oid, 'execute'))
    and not exists (select 1 from fn where has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute'))
    and not exists (select 1 from fn, pg_proc p, aclexplode(p.proacl) a where p.oid = fn.oid and a.grantee = 0)),
  ('volatilidad: huella y los dos tableros son stable; registrar es volatile',
    (select array_agg(proname::text order by proname) from fn where provolatile = 's') = array['huella_proyeccion', 'tablero_proyeccion', 'tablero_venta']
    and (select provolatile from fn where proname = 'registrar_aprobacion_direccion') = 'v'),
  ('tablero_venta lleva work_mem = 16MB y hash_mem_multiplier = 8 (y las demas no): sin ellos el plan agrega ordenando en disco',
    (select proconfig @> array['work_mem=16MB', 'hash_mem_multiplier=8'] from fn where proname = 'tablero_venta')
    and not exists (select 1 from fn where proname <> 'tablero_venta' and (proconfig::text like '%work_mem%' or proconfig::text like '%hash_mem%'))),
  ('tablero_venta cruza los hechos solo con tablas reales: el recorrido no nombra ninguna CTE de dimensiones ni usa nested loops forzados',
    (select prosrc like '%group by grouping sets%' and prosrc like '%join public.marcas_unidad mu on mu.marca_id = v.marca_id%'
            and prosrc like '%join public.tiendas t on t.id = v.tienda_id and t.tipo = ''Tienda''%' from fn where proname = 'tablero_venta')),
  ('ningun cuerpo de funcion lleva comentarios -- ni SQL dinamico (execute o format)',
    not exists (select 1 from fn where prosrc like '%--%' or prosrc ~* '\mexecute\M' or prosrc ~* '\mformat\s*\(')),
  ('tablero_venta lee de venta_stock_vigente y NO nombra costo ni stock valorizado (R24)',
    (select prosrc like '%public.venta_stock_vigente%' and prosrc !~* 'costo|valorizado|venta_stock_mensual' from fn where proname = 'tablero_venta')),
  ('las lecturas no escriben: huella y tableros no contienen insert, update ni delete; registrar solo inserta en su tabla',
    not exists (select 1 from fn where proname in ('huella_proyeccion', 'tablero_proyeccion', 'tablero_venta') and prosrc ~* '\m(insert|update|delete|truncate)\M')
    and (select prosrc ~* 'insert into public\.aprobaciones_direccion' and prosrc !~* '\m(delete|truncate)\M' and prosrc !~* '\mupdate\s+public' from fn where proname = 'registrar_aprobacion_direccion')),
  ('indices: (proyeccion_id, created_at desc), parcial de no rechazadas y perfil_id',
    (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'aprobaciones_direccion'
       and indexname in ('aprobaciones_direccion_proyeccion_created_idx', 'aprobaciones_direccion_no_rechazada_idx', 'aprobaciones_direccion_perfil_id_idx')) = 3
    and (select indexdef like '%WHERE (resultado <> ''rechazada''::text)%' from pg_indexes where indexname = 'aprobaciones_direccion_no_rechazada_idx')),
  ('triggers: inmutable por fila (update y delete), sin vaciado por sentencia (truncate) y set_updated_at; el inmutable va antes por nombre',
    (select array_agg(tgname::text order by tgname) from pg_trigger where tgrelid = 'public.aprobaciones_direccion'::regclass and not tgisinternal)
      = array['aprobaciones_direccion_inmutable', 'aprobaciones_direccion_sin_vaciado', 'set_updated_at']),
  ('columnas de convencion (id, activo, created_at, updated_at) y los 12 check con nombre',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'aprobaciones_direccion'
       and column_name in ('id', 'activo', 'created_at', 'updated_at') and column_default is not null) = 4
    and (select count(*) from pg_constraint where conrelid = 'public.aprobaciones_direccion'::regclass and contype = 'c') = 12),
  ('FK: proyeccion_id on delete restrict y perfil_id on delete set null',
    (select confdeltype from pg_constraint where conname = 'aprobaciones_direccion_proyeccion_id_fkey') = 'r'
    and (select confdeltype from pg_constraint where conname = 'aprobaciones_direccion_perfil_id_fkey') = 'n'),
  ('la migracion quedo registrada en migraciones_aplicadas',
    exists (select 1 from public.migraciones_aplicadas where nombre = '0041_tablero_direccion')),
  ('anon no puede ejecutar ninguna de las cuatro funciones (42501)',
    pg_temp.estado(format('select public.huella_proyeccion(%L)', pg_temp.id(100)), 'anon') = '42501'
    and pg_temp.estado(format('select public.tablero_proyeccion(%L, ''{}'')', pg_temp.id(100)), 'authenticated') = '42501'
    and pg_temp.estado('select public.tablero_venta(''{}'')', 'anon') = '42501'
    and pg_temp.estado('select public.registrar_aprobacion_direccion(''{}'')', 'authenticated') = '42501');

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. huella_proyeccion (R12)
-- ---------------------------------------------------------------------------------------------------------------------
insert into hu values ('h0', pg_temp.h(pg_temp.id(100)));
insert into r (caso, ok) values
  ('huella: 32 hexadecimales, determinista y NULL si la proyeccion no existe',
    pg_temp.hk('h0') ~ '^[0-9a-f]{32}$' and pg_temp.h(pg_temp.id(100)) = pg_temp.hk('h0') and pg_temp.h(pg_temp.id(999)) is null),
  ('la huella no depende de DateStyle (hasta_periodo va con to_char)',
    pg_temp.mensaje('set local datestyle = ''SQL, DMY''') = 'ok' and public.huella_proyeccion(pg_temp.id(100)) = pg_temp.hk('h0')
    and pg_temp.mensaje('set local datestyle = ''ISO, MDY''') = 'ok'),
  ('MUEVE: decidir o cambiar una fila (4 300 a 4 400)',
    pg_temp.mueve(format('update proyeccion_fila_anios set decidido = 4400 where id = %L', pg_temp.a('F4', 2027)),
                  format('update proyeccion_fila_anios set decidido = 4300 where id = %L', pg_temp.a('F4', 2027)))),
  ('MUEVE: recalcular con otra propuesta en una fila ya decidida (el vigente no cambia, el puente si)',
    pg_temp.mueve(format('update proyeccion_fila_anios set propuesto = 25100 where id = %L', pg_temp.a('F1', 2027)),
                  format('update proyeccion_fila_anios set propuesto = 25000 where id = %L', pg_temp.a('F1', 2027)))),
  ('MUEVE: aplicar una curva nueva (meses), aunque el total no cambie',
    pg_temp.mueve(format('update proyeccion_fila_anios set meses = array[1001, 999, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000] where id = %L', pg_temp.a('F2', 2027)),
                  format('update proyeccion_fila_anios set meses = array[1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000] where id = %L', pg_temp.a('F2', 2027)))),
  ('MUEVE: cambiar B (base_siguiente) y cambiar B corregida (base_normalizada), cada una por separado',
    pg_temp.mueve(format('update proyeccion_fila_anios set base_siguiente = 23600 where id = %L', pg_temp.a('F1', 2027)),
                  format('update proyeccion_fila_anios set base_siguiente = 23500 where id = %L', pg_temp.a('F1', 2027)))
    and pg_temp.mueve(format('update proyeccion_fila_anios set base_normalizada = 8700.41 where id = %L', pg_temp.a('F3', 2027)),
                      format('update proyeccion_fila_anios set base_normalizada = 8700.40 where id = %L', pg_temp.a('F3', 2027)))),
  ('MUEVE: decidir una tienda (proyeccion_tiendas)',
    pg_temp.mueve(format('update proyeccion_tiendas set decidido = 990, origen = ''manual'' where proyeccion_id = %L and tienda_id = %L and anio = 2027', pg_temp.id(100), pg_temp.t('T04')),
                  format('update proyeccion_tiendas set decidido = null, origen = null where proyeccion_id = %L and tienda_id = %L and anio = 2027', pg_temp.id(100), pg_temp.t('T04')))),
  ('MUEVE: cambiar el % de un GM o su base (sobre_base)',
    pg_temp.mueve(format('update proyeccion_crecimientos set pct = 5.5 where proyeccion_id = %L and genero_id = %L', pg_temp.id(100), pg_temp.gen('H41H')),
                  format('update proyeccion_crecimientos set pct = 5.0 where proyeccion_id = %L and genero_id = %L', pg_temp.id(100), pg_temp.gen('H41H')))
    and pg_temp.mueve(format('update proyeccion_crecimientos set sobre_base = ''bruta'' where proyeccion_id = %L and genero_id = %L', pg_temp.id(100), pg_temp.gen('H41H')),
                      format('update proyeccion_crecimientos set sobre_base = ''corregida'' where proyeccion_id = %L and genero_id = %L', pg_temp.id(100), pg_temp.gen('H41H')))),
  ('MUEVE: el Resto que de verdad se aplico (crecimiento_resto_usado): su % y su base; y que falte (pasa al valor fijo r|~|~)',
    pg_temp.mueve(format('update proyecciones set parametros = jsonb_set(parametros, ''{crecimiento_resto_usado,pct}'', ''4'') where id = %L', pg_temp.id(100)),
                  format('update proyecciones set parametros = jsonb_set(parametros, ''{crecimiento_resto_usado,pct}'', ''3'') where id = %L', pg_temp.id(100)))
    and pg_temp.mueve(format('update proyecciones set parametros = jsonb_set(parametros, ''{crecimiento_resto_usado,sobre_base}'', ''"bruta"'') where id = %L', pg_temp.id(100)),
                      format('update proyecciones set parametros = jsonb_set(parametros, ''{crecimiento_resto_usado,sobre_base}'', ''"corregida"'') where id = %L', pg_temp.id(100)))
    and pg_temp.mueve(format('update proyecciones set parametros = parametros - ''crecimiento_resto_usado'' || jsonb_build_object(''guardado'', parametros -> ''crecimiento_resto_usado'') where id = %L', pg_temp.id(100)),
                      format('update proyecciones set parametros = parametros - ''guardado'' || jsonb_build_object(''crecimiento_resto_usado'', parametros -> ''guardado'') where id = %L', pg_temp.id(100)))),
  ('NO mueve: el Resto PROVISIONAL (crecimiento_pct_defecto, que nunca se aplica), ni quien fijo el Resto, cuando o su version, ni escribir 3 como 3.0',
    pg_temp.no_mueve(format('update proyecciones set parametros = jsonb_set(parametros, ''{crecimiento_pct_defecto}'', ''25'') where id = %L', pg_temp.id(100)),
                     format('update proyecciones set parametros = jsonb_set(parametros, ''{crecimiento_pct_defecto}'', ''20'') where id = %L', pg_temp.id(100)))
    and pg_temp.no_mueve(format('update proyecciones set parametros = jsonb_set(jsonb_set(jsonb_set(parametros, ''{crecimiento_resto_usado,por_nombre}'', ''"Otro"''), ''{crecimiento_resto_usado,version}'', ''9''), ''{crecimiento_resto_usado,at}'', ''"2030-01-01"'') where id = %L', pg_temp.id(100)),
                         format('update proyecciones set parametros = jsonb_set(jsonb_set(jsonb_set(parametros, ''{crecimiento_resto_usado,por_nombre}'', ''"Planner P."''), ''{crecimiento_resto_usado,version}'', ''2''), ''{crecimiento_resto_usado,at}'', ''"2026-11-07T12:00:00+00:00"'') where id = %L', pg_temp.id(100)))
    and pg_temp.no_mueve(format('update proyecciones set parametros = jsonb_set(parametros, ''{crecimiento_resto_usado,pct}'', ''3.0'') where id = %L', pg_temp.id(100)),
                         format('update proyecciones set parametros = jsonb_set(parametros, ''{crecimiento_resto_usado,pct}'', ''3'') where id = %L', pg_temp.id(100)))),
  ('la formula lleva VERSION (primera linea v|1) y la regla esta escrita en el comentario de la funcion: cambiarla invalida las aprobaciones',
    (select prosrc ~ 'md5\(concat_ws\(E''\\n'',\s+concat_ws\(''\|'', ''v'', ''1''\),' from fn where proname = 'huella_proyeccion')
    and (select obj_description(oid, 'pg_proc') ~* 'version 1' and obj_description(oid, 'pg_proc') ~* 'invalida todas las aprobaciones'
         from fn where proname = 'huella_proyeccion')
    and (select prosrc !~ 'crecimiento_pct_defecto' from fn where proname = 'huella_proyeccion')
    and not exists (select 1 from fn where proname in ('tablero_proyeccion', 'tablero_venta', 'registrar_aprobacion_direccion') and prosrc ~ 'crecimiento_pct_defecto')),
  ('MUEVE: cambiar hasta_periodo y cambiar la version del metodo',
    pg_temp.mueve(format('update proyecciones set hasta_periodo = date ''2026-08-01'' where id = %L', pg_temp.id(100)),
                  format('update proyecciones set hasta_periodo = date ''2026-09-01'' where id = %L', pg_temp.id(100)))
    and pg_temp.mueve(format('update proyecciones set resumen = jsonb_set(resumen, ''{version_metodo}'', ''4'') where id = %L', pg_temp.id(100)),
                      format('update proyecciones set resumen = jsonb_set(resumen, ''{version_metodo}'', ''5'') where id = %L', pg_temp.id(100)))),
  ('MUEVE: la pertenencia de una tienda a un bloque (su clave, o pasar de mismas a fuera)',
    pg_temp.mueve(format('update proyecciones set parametros = jsonb_set(parametros, ''{bloques,2027,mismas,0,clave}'', ''"11110"'') where id = %L', pg_temp.id(100)),
                  format('update proyecciones set parametros = jsonb_set(parametros, ''{bloques,2027,mismas,0,clave}'', ''"11111"'') where id = %L', pg_temp.id(100)))
    and pg_temp.mueve(format('update proyecciones set parametros = jsonb_set(jsonb_set(parametros, ''{bloques,2027,fuera}'', parametros #> ''{bloques,2027,fuera}'' || (parametros #> ''{bloques,2027,mismas,3}'')), ''{bloques,2027,mismas}'', (parametros #> ''{bloques,2027,mismas}'') - 3) where id = %L', pg_temp.id(100)),
                      format('update proyecciones set parametros = jsonb_set(jsonb_set(parametros, ''{bloques,2027,mismas}'', parametros #> ''{bloques,2027,mismas}'' || (parametros #> ''{bloques,2027,fuera,1}'')), ''{bloques,2027,fuera}'', (parametros #> ''{bloques,2027,fuera}'') - 1) where id = %L', pg_temp.id(100)))),
  ('MUEVE: desactivar un registro, desactivar una fila y desactivar un crecimiento',
    pg_temp.mueve(format('update proyeccion_fila_anios set activo = false where id = %L', pg_temp.a('M2', 2027)),
                  format('update proyeccion_fila_anios set activo = true where id = %L', pg_temp.a('M2', 2027)))
    and pg_temp.mueve(format('update proyeccion_filas set activo = false where id = %L', pg_temp.f('FT12')),
                      format('update proyeccion_filas set activo = true where id = %L', pg_temp.f('FT12')))
    and pg_temp.mueve(format('update proyeccion_crecimientos set activo = false where proyeccion_id = %L and genero_id = %L', pg_temp.id(100), pg_temp.gen('H41M')),
                      format('update proyeccion_crecimientos set activo = true where proyeccion_id = %L and genero_id = %L', pg_temp.id(100), pg_temp.gen('H41M')))),
  ('NO mueve: renombrar la proyeccion, editar la nota o cambiar quien la creo',
    pg_temp.no_mueve(format('update proyecciones set nombre = ''Otro nombre H41'', nota = ''otra nota'', usuario_nombre = ''Otro'' where id = %L', pg_temp.id(100)),
                     format('update proyecciones set nombre = ''Proyeccion 2026-2027 H41'', nota = ''nota inicial'', usuario_nombre = ''Planner P.'' where id = %L', pg_temp.id(100)))),
  ('NO mueve: renombrar una tienda o cambiar su zona dentro de los bloques (solo pertenencia)',
    pg_temp.no_mueve(format('update proyecciones set parametros = jsonb_set(jsonb_set(parametros, ''{bloques,2027,mismas,0,nombre}'', ''"RENOMBRADA"''), ''{bloques,2027,mismas,0,zona}'', ''"NORTE"'') where id = %L', pg_temp.id(100)),
                     format('update proyecciones set parametros = jsonb_set(jsonb_set(parametros, ''{bloques,2027,mismas,0,nombre}'', ''"TIENDA T01"''), ''{bloques,2027,mismas,0,zona}'', ''"LIMA"'') where id = %L', pg_temp.id(100)))),
  ('NO mueve: quien decidio, cuando, el origen de la decision ni la nota de la fila (mismo vigente)',
    pg_temp.no_mueve(format('update proyeccion_fila_anios set origen = ''manual'', decidido_por_nombre = ''Otro'', decidido_at = now(), nota = ''x'', propuesta_al_decidir = 1 where id = %L', pg_temp.a('F2', 2027)),
                     format('update proyeccion_fila_anios set origen = ''propuesta'', decidido_por_nombre = ''Planner P.'', decidido_at = timestamptz ''2026-11-08 03:00:00+00'', nota = null, propuesta_al_decidir = 11900 where id = %L', pg_temp.a('F2', 2027)))),
  ('NO mueve: recalcular sin que cambie ninguna cifra (explicacion, metodo, historico, calculado_at)',
    pg_temp.no_mueve(format('update proyeccion_fila_anios set explicacion = ''recalculada'', metodo = ''crecimiento'' where fila_id = %L', pg_temp.f('F1'))
                       || format('; update proyeccion_filas set historico = ''{"x": 1}'' where proyeccion_id = %L; update proyecciones set calculado_at = now() where id = %L', pg_temp.id(100), pg_temp.id(100)),
                     format('update proyeccion_fila_anios set explicacion = '''', metodo = ''sin_propuesta'' where fila_id = %L', pg_temp.f('F1'))
                       || format('; update proyeccion_filas set historico = ''{}'' where proyeccion_id = %L; update proyecciones set calculado_at = timestamptz ''2026-11-07 12:00:00+00'' where id = %L', pg_temp.id(100), pg_temp.id(100)))),
  ('NO mueve: un crecimiento INACTIVO que cambia, ni una carga nueva de venta',
    pg_temp.no_mueve(format('update proyeccion_crecimientos set pct = 20 where proyeccion_id = %L and genero_id = %L', pg_temp.id(100), pg_temp.gen('H41N')),
                     format('update proyeccion_crecimientos set pct = 9 where proyeccion_id = %L and genero_id = %L', pg_temp.id(100), pg_temp.gen('H41N')))
    and pg_temp.no_mueve('update venta_stock_mensual set unidades = unidades + 1 where unidades > 0', 'update venta_stock_mensual set unidades = unidades - 1 where unidades > 1')),
  ('NO mueve: cerrar (y volver a abrir) sin cambiar cifras',
    pg_temp.no_mueve(format('update proyecciones set estado = ''cerrada'', cerrada_at = now(), cerrada_por_nombre = ''Planner P.'' where id = %L', pg_temp.id(100)),
                     format('update proyecciones set estado = ''en_trabajo'', cerrada_at = null, cerrada_por_nombre = null where id = %L', pg_temp.id(100)))),
  ('despues de todas las pruebas de ida y vuelta la huella es la del principio',
    pg_temp.h(pg_temp.id(100)) = pg_temp.hk('h0'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. tablero_proyeccion (R1, R4, forma, filtros, desgloses, unidad de marca)
-- ---------------------------------------------------------------------------------------------------------------------
create temp table hun as select array[pg_temp.nodo('HU1'), pg_temp.nodo('HU2')] as ids;
insert into res values
  ('tp0', pg_temp.tp(pg_temp.id(100), '{}'::jsonb)),
  ('tp_null', pg_temp.tp(pg_temp.id(100), null)),
  ('tp_nulos', pg_temp.tp(pg_temp.id(100), '{"gml_ids": null, "agrupacion_marca_ids": null, "unidad_marca_id": null, "temporadas": null, "desglose": null}'::jsonb)),
  ('tp_hu', pg_temp.tp(pg_temp.id(100), jsonb_build_object('gml_ids', (select to_jsonb(ids) from hun)))),
  ('tp_ama', pg_temp.tp(pg_temp.id(100), jsonb_build_object('agrupacion_marca_ids', jsonb_build_array(pg_temp.am('A'))))),
  ('tp_amb', pg_temp.tp(pg_temp.id(100), jsonb_build_object('agrupacion_marca_ids', jsonb_build_array(pg_temp.am('B'))))),
  ('tp_inv', pg_temp.tp(pg_temp.id(100), '{"temporadas": ["invierno"]}'::jsonb)),
  ('tp_tea', pg_temp.tp(pg_temp.id(100), '{"temporadas": ["todo_el_ano"]}'::jsonb)),
  ('tp_sin', pg_temp.tp(pg_temp.id(100), '{"temporadas": ["sin_temporada"]}'::jsonb)),
  ('tp_vacio', pg_temp.tp(pg_temp.id(100), '{"gml_ids": []}'::jsonb)),
  ('tp_lin', pg_temp.tp(pg_temp.id(100), '{"desglose": "linea"}'::jsonb)),
  ('tp_gen', pg_temp.tp(pg_temp.id(100), '{"desglose": "genero"}'::jsonb)),
  ('tp_mun', pg_temp.tp(pg_temp.id(100), '{"desglose": "mundo"}'::jsonb)),
  ('tp_dam', pg_temp.tp(pg_temp.id(100), '{"desglose": "agrupacion_marca"}'::jsonb)),
  ('tp_tem', pg_temp.tp(pg_temp.id(100), '{"desglose": "temporada"}'::jsonb)),
  ('tp_tie', pg_temp.tp(pg_temp.id(100), '{"desglose": "tienda"}'::jsonb)),
  ('tp_mar', pg_temp.tp(pg_temp.id(100), '{"desglose": "marca"}'::jsonb)),
  ('tp_x', pg_temp.tp(pg_temp.id(100), jsonb_build_object('gml_ids', (select to_jsonb(ids) from hun), 'unidad_marca_id', pg_temp.mc('X')))),
  ('tp_xa', pg_temp.tp(pg_temp.id(100), jsonb_build_object('gml_ids', (select to_jsonb(ids) from hun), 'unidad_marca_id', pg_temp.mc('X'),
                                                         'agrupacion_marca_ids', jsonb_build_array(pg_temp.am('A'))))),
  ('tp_x2', pg_temp.tp(pg_temp.id(100), jsonb_build_object('unidad_marca_id', pg_temp.mc('X2')))),
  ('tp_no', pg_temp.tp(pg_temp.id(999), '{}'::jsonb));

insert into r (caso, ok) values
  ('forma: el documento trae exactamente sus 9 claves y ninguna llamada lanzo error',
    (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rk('tp0')) k)
      = array['anios', 'huella', 'mayores', 'por_dim', 'por_gm', 'por_par', 'por_temporada', 'resto', 'sin_participacion_marca']
    and not exists (select 1 from res where k like 'tp%' and v ->> 'error' = 'EXC')),
  ('forma: anios son Y y Y+1 en ese orden, con base, tiendas, decisiones y conteos; base trae sus 13 claves siempre',
    jsonb_array_length(pg_temp.rk('tp0') -> 'anios') = 2
    and pg_temp.jn(pg_temp.rk('tp0'), 'anios', '0', 'anio') = 2026 and pg_temp.jn(pg_temp.rk('tp0'), 'anios', '1', 'anio') = 2027
    and (select array_agg(k order by k) from jsonb_object_keys(pg_temp.an(pg_temp.rk('tp0'), 0)) k) = array['anio', 'base', 'conteos', 'decisiones', 'tiendas']
    and (select count(*) from jsonb_object_keys(pg_temp.an(pg_temp.rk('tp0'), 0) -> 'base')) = 13
    and (select count(*) from jsonb_object_keys(pg_temp.an(pg_temp.rk('tp0'), 1) -> 'base')) = 13),
  ('resto: el % DECLARADO del Resto y su base salen de crecimiento_resto_usado (3 sobre corregida), no del provisional (20); no depende de filtros',
    pg_temp.rk('tp0') -> 'resto' = '{"pct": 3, "sobre_base": "corregida"}'::jsonb
    and pg_temp.rk('tp_hu') -> 'resto' = pg_temp.rk('tp0') -> 'resto' and pg_temp.rk('tp_x') -> 'resto' = pg_temp.rk('tp0') -> 'resto'),
  ('puente, «decisiones a mano» partido en dos (anios[Y+1].base): delta_manual 1 343 (filas con origen manual) y delta_otras 0; suman vigente − propuesta; null en Y',
    pg_temp.jn(pg_temp.rk('tp0'), 'anios', '1', 'base', 'delta_manual') = 1343
    and pg_temp.jn(pg_temp.rk('tp0'), 'anios', '1', 'base', 'delta_otras') = 0
    and pg_temp.jn(pg_temp.rk('tp0'), 'anios', '1', 'base', 'delta_manual') + pg_temp.jn(pg_temp.rk('tp0'), 'anios', '1', 'base', 'delta_otras')
        = pg_temp.jn(pg_temp.rk('tp0'), 'anios', '1', 'base', 'vigente_con_B') - pg_temp.jn(pg_temp.rk('tp0'), 'anios', '1', 'base', 'propuesto_con_B')
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '1', 'base', 'delta_manual') = 117
    and pg_temp.an(pg_temp.rk('tp0'), 0) -> 'base' -> 'delta_manual' = 'null'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 0) -> 'base' -> 'delta_otras' = 'null'::jsonb),
  ('puente por GM: delta_manual (HOMBRE 117, MUJER 1 226) y delta_otras (0); en cada GM delta_manual + delta_otras = vigente_con_B − propuesto_con_B',
    pg_temp.jn(pg_temp.gm(pg_temp.rk('tp0'), 'H41H'), 'Y1', 'delta_manual') = 117
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tp0'), 'H41M'), 'Y1', 'delta_manual') = 1226
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'delta_manual') = 1343 and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'delta_otras') = 0
    and not exists (select 1 from res, jsonb_array_elements(v -> 'por_gm') x where k in ('tp0', 'tpv')
                    and (x -> 'Y1' ->> 'delta_manual')::numeric + (x -> 'Y1' ->> 'delta_otras')::numeric
                        <> (x -> 'Y1' ->> 'vigente_con_B')::numeric - (x -> 'Y1' ->> 'propuesto_con_B')::numeric)),
  ('D10: la huella del documento es la de huella_proyeccion',
    pg_temp.rk('tp0') ->> 'huella' = pg_temp.hk('h0') and pg_temp.rk('tp_hu') ->> 'huella' = pg_temp.hk('h0')),
  ('p nulo, p vacio y p con todas las claves en null dan el mismo documento (ausente o null = sin filtro)',
    pg_temp.rk('tp_null') = pg_temp.rk('tp0') and pg_temp.rk('tp_nulos') = pg_temp.rk('tp0')),
  ('una proyeccion que no existe devuelve NULL',
    pg_temp.rk('tp_no') is null),
  ('R1: 2026 cierre = 78 501 y 2027 = 84 714, iguales a la suma de coalesce(decidido, propuesto) de los registros activos',
    pg_temp.tot(pg_temp.rk('tp0'), 0) = 78501 and pg_temp.tot(pg_temp.rk('tp0'), 1) = 84714
    and pg_temp.tot(pg_temp.rk('tp0'), 0) = (select sum(coalesce(a.decidido, a.propuesto)) from proyeccion_filas f join proyeccion_fila_anios a on a.fila_id = f.id
                                             where f.proyeccion_id = pg_temp.id(100) and f.activo and a.activo and a.anio = 2026)
    and pg_temp.tot(pg_temp.rk('tp0'), 1) = (select sum(coalesce(a.decidido, a.propuesto)) from proyeccion_filas f join proyeccion_fila_anios a on a.fila_id = f.id
                                             where f.proyeccion_id = pg_temp.id(100) and f.activo and a.activo and a.anio = 2027)),
  ('R1: por mes, base mas tiendas de 2027 = suma directa de `meses` de los registros; sin_meses = 0 en todo',
    (select array_agg(s order by i) from (
       select m.i, sum(m.u::numeric) as s
       from (select pg_temp.an(pg_temp.rk('tp0'), 1) -> 'base' -> 'meses' as arr
             union all select x -> 'meses' from jsonb_array_elements(pg_temp.an(pg_temp.rk('tp0'), 1) -> 'tiendas') x) q
       cross join lateral jsonb_array_elements_text(q.arr) with ordinality as m(u, i)
       group by m.i) z)
    = (select array_agg(s order by i) from (
       select m.i, sum(m.u)::numeric as s
       from proyeccion_filas f join proyeccion_fila_anios a on a.fila_id = f.id cross join lateral unnest(a.meses) with ordinality as m(u, i)
       where f.proyeccion_id = pg_temp.id(100) and a.anio = 2027 group by m.i) z)
    and pg_temp.jn(pg_temp.rk('tp0'), 'anios', '0', 'base', 'sin_meses') = 0 and pg_temp.jn(pg_temp.rk('tp0'), 'anios', '1', 'base', 'sin_meses') = 0
    and not exists (select 1 from jsonb_array_elements(pg_temp.rk('tp0') -> 'anios') z, jsonb_array_elements(z -> 'tiendas') x where (x ->> 'sin_meses')::numeric <> 0)),
  ('HOMBRE x URBANO, 2026: base 45 901 (vendido 31 000), meses de la ficha, T10 4 100, cierre 50 001',
    pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '0', 'base', 'vigente') = 45901
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '0', 'base', 'vendido') = 31000
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '0', 'base', 'propuesto') = 45901
    and pg_temp.an(pg_temp.rk('tp_hu'), 0) -> 'base' -> 'meses' = '[3009, 2592, 2848, 3258, 4024, 3894, 4504, 3576, 3295, 3600, 4050, 7251]'::jsonb
    and pg_temp.tot(pg_temp.rk('tp_hu'), 0) = 50001),
  ('HOMBRE x URBANO, 2027: base 50 300, B 47 040, B corregida 47 793 (suma con decimales), propuesta 50 183, meses de la ficha, total 52 708',
    pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '1', 'base', 'vigente') = 50300
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '1', 'base', 'B') = 47040
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '1', 'base', 'B_corr') = 47793
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '1', 'base', 'propuesto_con_B') = 50183
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '1', 'base', 'vigente_con_B') = 50300
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '1', 'base', 'vigente_sin_B') = 0
    and pg_temp.an(pg_temp.rk('tp_hu'), 1) -> 'base' -> 'meses' = '[3521, 3018, 3270, 3521, 4276, 4024, 4779, 3772, 3772, 4024, 4527, 7796]'::jsonb
    and pg_temp.tot(pg_temp.rk('tp_hu'), 1) = 52708),
  ('lo que solo aplica a un anio va en null en el otro: B y con/sin B en Y; meses_sin_nino en Y+1',
    pg_temp.an(pg_temp.rk('tp_hu'), 0) -> 'base' -> 'B' = 'null'::jsonb and pg_temp.an(pg_temp.rk('tp_hu'), 0) -> 'base' -> 'B_corr' = 'null'::jsonb
    and pg_temp.an(pg_temp.rk('tp_hu'), 0) -> 'base' -> 'vigente_con_B' = 'null'::jsonb
    and pg_temp.an(pg_temp.rk('tp_hu'), 1) -> 'base' -> 'meses_sin_nino' = 'null'::jsonb
    and jsonb_array_length(pg_temp.an(pg_temp.rk('tp_hu'), 0) -> 'base' -> 'meses_sin_nino') = 12),
  ('«2026 sin Nino»: junio a agosto divide por 0,70 las filas de invierno (573 u pasan a 818,57) y el resto queda igual',
    pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '0', 'base', 'meses_sin_nino', '5') = 3894 - 573 + 818.57
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '0', 'base', 'meses_sin_nino', '6') = 4504 - 573 + 818.57
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '0', 'base', 'meses_sin_nino', '7') = 3576 - 574 + 820
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '0', 'base', 'meses_sin_nino', '0') = 3009
    and pg_temp.jn(pg_temp.rk('tp_hu'), 'anios', '0', 'base', 'meses_sin_nino', '11') = 7251),
  ('tiendas de bloque: T10 (2026, nuevas del anio anterior, 4 100, para_base 4 100); T04 (2027, cierres, 1 000) y T12 (2027, aperturas, 1 408) sin para_base',
    jsonb_array_length(pg_temp.an(pg_temp.rk('tp_hu'), 0) -> 'tiendas') = 1 and jsonb_array_length(pg_temp.an(pg_temp.rk('tp_hu'), 1) -> 'tiendas') = 2
    and pg_temp.tda(pg_temp.rk('tp_hu'), 0, 'T10') @> '{"bloque": "nuevas", "subbloque": "nuevas_anterior", "vigente": 4100, "para_base": 4100, "sin_meses": 0}'::jsonb
    and pg_temp.tda(pg_temp.rk('tp_hu'), 0, 'T10') -> 'meses' = '[334, 334, 334, 333, 333, 333, 333, 333, 333, 300, 330, 470]'::jsonb
    and pg_temp.tda(pg_temp.rk('tp_hu'), 1, 'T04') @> '{"bloque": "cierres", "subbloque": null, "vigente": 1000, "para_base": null}'::jsonb
    and pg_temp.tda(pg_temp.rk('tp_hu'), 1, 'T04') -> 'meses' = '[150, 140, 150, 160, 200, 200, 0, 0, 0, 0, 0, 0]'::jsonb
    and pg_temp.tda(pg_temp.rk('tp_hu'), 1, 'T12') @> '{"bloque": "nuevas", "subbloque": "aperturas", "vigente": 1408, "para_base": null}'::jsonb),
  ('R4 puente total (por_gm): 78 501 − 0 − 2 961 = 75 540 (B) + 753 + 4 670 + 1 343 + 0 = 82 306 + 0 + 1 408 + 1 000 = 84 714',
    pg_temp.gms(pg_temp.rk('tp0'), 'Y', 'cierre') = 78501
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y', 'fuera_base_exacto') = 0
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'B') = 75540
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y', 'cierre') - pg_temp.gms(pg_temp.rk('tp0'), 'Y', 'fuera_base_exacto') - pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'B') = 2961
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'B_corr') - pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'B') = 753
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'propuesto_con_B') - pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'B_corr') = 4670
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'vigente_con_B') - pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'propuesto_con_B') = 1343
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'vigente_sin_B') = 0
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'vigente_con_B') = 82306
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'nuevas_anterior') = 0
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'aperturas') = 1408
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'cierres') = 1000
    and pg_temp.gms(pg_temp.rk('tp0'), 'Y1', 'total') = 84714),
  ('R4 por GM: en cada GM con B + sin B + nuevas del anio anterior + aperturas + cierres = total, y la suma de los GM es el total',
    not exists (select 1 from jsonb_array_elements(pg_temp.rk('tp0') -> 'por_gm') x
                where (x -> 'Y1' ->> 'vigente_con_B')::numeric + (x -> 'Y1' ->> 'vigente_sin_B')::numeric + (x -> 'Y1' ->> 'nuevas_anterior')::numeric
                    + (x -> 'Y1' ->> 'aperturas')::numeric + (x -> 'Y1' ->> 'cierres')::numeric <> (x -> 'Y1' ->> 'total')::numeric)
    and jsonb_array_length(pg_temp.rk('tp0') -> 'por_gm') = 2
    and pg_temp.gm(pg_temp.rk('tp0'), 'H41H') -> 'Y' @> '{"cierre": 50001, "base": 45901, "fuera_base_exacto": 0}'::jsonb
    and (select array_agg(k order by k) from jsonb_object_keys(pg_temp.gm(pg_temp.rk('tp0'), 'H41H') -> 'Y') k)
        = array['base', 'base_meses', 'base_meses_sin_nino', 'cierre', 'fuera_base_exacto']
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tp0'), 'H41H'), 'Y1', 'total') = 52708
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tp0'), 'H41M'), 'Y', 'cierre') = 28500
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tp0'), 'H41M'), 'Y1', 'B') = 28500
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tp0'), 'H41M'), 'Y1', 'B_corr') = 28500
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tp0'), 'H41M'), 'Y1', 'propuesto_con_B') = 30780
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tp0'), 'H41M'), 'Y1', 'total') = 32006),
  ('I-E por_gm.Y.base_meses y base_meses_sin_nino: HOMBRE x URBANO ene–oct suma 34 600 y, sin Nino, 35 337,14 (1 720 u de invierno en jun–ago entre 0,70)',
    pg_temp.gm(pg_temp.rk('tp0'), 'H41H') -> 'Y' -> 'base_meses' = '[3009, 2592, 2848, 3258, 4024, 3894, 4504, 3576, 3295, 3600, 4050, 7251]'::jsonb
    and (select sum(m::numeric) from jsonb_array_elements_text(pg_temp.gm(pg_temp.rk('tp0'), 'H41H') -> 'Y' -> 'base_meses') with ordinality as q(m, i) where i <= 10) = 34600
    and (select sum(m::numeric) from jsonb_array_elements_text(pg_temp.gm(pg_temp.rk('tp0'), 'H41H') -> 'Y' -> 'base_meses_sin_nino') with ordinality as q(m, i) where i <= 10) = 35337.14
    and pg_temp.gm(pg_temp.rk('tp0'), 'H41H') -> 'Y' -> 'base_meses_sin_nino' = pg_temp.an(pg_temp.rk('tp_hu'), 0) -> 'base' -> 'meses_sin_nino'
    and pg_temp.gm(pg_temp.rk('tp0'), 'H41H') -> 'Y' -> 'base_meses' = pg_temp.an(pg_temp.rk('tp_hu'), 0) -> 'base' -> 'meses'),
  ('I-E en un GM sin Nino las dos series son iguales; la suma por GM de base_meses es la de anios[Y].base.meses; 12 valores siempre',
    (select sum(m::numeric) from jsonb_array_elements_text(pg_temp.gm(pg_temp.rk('tp0'), 'H41M') -> 'Y' -> 'base_meses') m)
      = (select sum(m::numeric) from jsonb_array_elements_text(pg_temp.gm(pg_temp.rk('tp0'), 'H41M') -> 'Y' -> 'base_meses_sin_nino') m)
    and (select sum(m::numeric) from jsonb_array_elements_text(pg_temp.gm(pg_temp.rk('tp0'), 'H41M') -> 'Y' -> 'base_meses') m) = 28500
    and (select sum(m::numeric) from jsonb_array_elements(pg_temp.rk('tp0') -> 'por_gm') x, jsonb_array_elements_text(x -> 'Y' -> 'base_meses') m)
      = (select sum(m::numeric) from jsonb_array_elements_text(pg_temp.an(pg_temp.rk('tp0'), 0) -> 'base' -> 'meses') m)
    and not exists (select 1 from jsonb_array_elements(pg_temp.rk('tp0') -> 'por_gm') x
                    where jsonb_array_length(x -> 'Y' -> 'base_meses') <> 12 or jsonb_array_length(x -> 'Y' -> 'base_meses_sin_nino') <> 12)),
  ('por_gm es SIEMPRE de toda la proyeccion: no cambia con filtros, con unidad de marca ni con desglose',
    pg_temp.rk('tp_hu') -> 'por_gm' = pg_temp.rk('tp0') -> 'por_gm' and pg_temp.rk('tp_x') -> 'por_gm' = pg_temp.rk('tp0') -> 'por_gm'
    and pg_temp.rk('tp_inv') -> 'por_gm' = pg_temp.rk('tp0') -> 'por_gm' and pg_temp.rk('tp_vacio') -> 'por_gm' = pg_temp.rk('tp0') -> 'por_gm'
    and pg_temp.rk('tp_lin') -> 'por_gm' = pg_temp.rk('tp0') -> 'por_gm'),
  ('decisiones 2027 (excluyentes, lote > ia > origen > sin decidir): en bloque 3 / 41 300, tal cual 2 / 13 000, a mano 3 / 30 414',
    pg_temp.an(pg_temp.rk('tp0'), 1) -> 'decisiones' -> 'lote' = '{"n": 3, "u": 41300}'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 1) -> 'decisiones' -> 'propuesta' = '{"n": 2, "u": 13000}'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 1) -> 'decisiones' -> 'manual' = '{"n": 3, "u": 30414}'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 1) -> 'decisiones' -> 'ia' = '{"n": 0, "u": 0}'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 1) -> 'decisiones' -> 'escalada' = '{"n": 0, "u": 0}'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 1) -> 'decisiones' -> 'sin_decidir' = '{"n": 0, "u": 0}'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 0) -> 'decisiones' -> 'sin_decidir' = '{"n": 1, "u": 11000}'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 0) -> 'decisiones' -> 'propuesta' = '{"n": 6, "u": 67501}'::jsonb),
  ('autores y dia pico de 2027 en hora de Lima: Planner P. 6 registros el 07 nov (uno decidido el 8 a las 03:00 UTC); Admin A. 2, del 05 al 06 nov',
    pg_temp.an(pg_temp.rk('tp0'), 1) -> 'decisiones' -> 'autores'
      = '[{"nombre": "Planner P.", "n": 6, "u": 63300, "desde": "2026-11-07", "hasta": "2026-11-07"}, {"nombre": "Admin A.", "n": 2, "u": 21414, "desde": "2026-11-05", "hasta": "2026-11-06"}]'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 1) -> 'decisiones' -> 'dia_pico' = '{"fecha": "2026-11-07", "n": 6}'::jsonb),
  ('conteos: 7 registros en 2026 y 8 en 2027; en 2027 una propuesta que cambio despues de decidir y una curva propuesta pendiente',
    pg_temp.an(pg_temp.rk('tp0'), 0) -> 'conteos' = '{"registros": 7, "propuesta_cambio": 0, "curva_cambio": 0}'::jsonb
    and pg_temp.an(pg_temp.rk('tp0'), 1) -> 'conteos' = '{"registros": 8, "propuesta_cambio": 1, "curva_cambio": 1}'::jsonb),
  ('por_temporada: invierno 13 300 (todo con factor del Nino en 2026: lo que expone un factor provisional); todo el anio 39 408; sin temporada 32 006',
    pg_temp.rk('tp0') -> 'por_temporada'
      = '[{"temporada": "invierno", "Y1": 13300, "Y1_con_factor_Y": 13300}, {"temporada": "todo_el_ano", "Y1": 39408, "Y1_con_factor_Y": 0}, {"temporada": null, "Y1": 32006, "Y1_con_factor_Y": 0}]'::jsonb),
  ('por_par (para valorizar): en HOMBRE x URBANO el proyectado de oct–dic suma 16 001 y 2027 suma 52 708; el par L1 x AM-A es 8 950 y 26 408',
    (select sum((x ->> 2)::numeric) from jsonb_array_elements(pg_temp.rk('tp_hu') -> 'por_par' -> 'filas') x) = 16001
    and (select sum((x ->> 3)::numeric) from jsonb_array_elements(pg_temp.rk('tp_hu') -> 'por_par' -> 'filas') x) = 52708
    and jsonb_array_length(pg_temp.rk('tp_hu') -> 'por_par' -> 'filas') = 4
    and exists (select 1 from jsonb_array_elements(pg_temp.rk('tp_hu') -> 'por_par' -> 'filas') x
                where pg_temp.rk('tp_hu') -> 'por_par' -> 'gml' ->> (x ->> 0)::integer = pg_temp.nodo('HU1')::text
                  and pg_temp.rk('tp_hu') -> 'por_par' -> 'am' ->> (x ->> 1)::integer = pg_temp.am('A')::text
                  and (x ->> 2)::numeric = 8950 and (x ->> 3)::numeric = 26408)
    and (select sum((x ->> 3)::numeric) from jsonb_array_elements(pg_temp.rk('tp0') -> 'por_par' -> 'filas') x) = 84714),
  ('mayores: las filas base por 2027 descendente (empate por clave); la primera es L1 x AM-A con 25 000 y B 23 500',
    jsonb_array_length(pg_temp.rk('tp0') -> 'mayores') = 6
    and pg_temp.rk('tp0') -> 'mayores' -> 0 @> jsonb_build_object('gml_id', pg_temp.nodo('HU1'), 'am_id', pg_temp.am('A'), 'Y1', 25000, 'B', 23500)
    and (select array_agg((x ->> 'Y1')::integer order by i) from jsonb_array_elements(pg_temp.rk('tp0') -> 'mayores') with ordinality as q(x, i))
        = array[25000, 20006, 12000, 12000, 9000, 4300]),
  ('R10: la union disjunta de las agrupaciones de marca suma el total, y la de las temporadas tambien (los dos anios)',
    pg_temp.tot(pg_temp.rk('tp_ama'), 0) + pg_temp.tot(pg_temp.rk('tp_amb'), 0) = 78501
    and pg_temp.tot(pg_temp.rk('tp_ama'), 1) + pg_temp.tot(pg_temp.rk('tp_amb'), 1) = 84714
    and pg_temp.tot(pg_temp.rk('tp_inv'), 1) + pg_temp.tot(pg_temp.rk('tp_tea'), 1) + pg_temp.tot(pg_temp.rk('tp_sin'), 1) = 84714
    and pg_temp.tot(pg_temp.rk('tp_inv'), 1) = 13300 and pg_temp.tot(pg_temp.rk('tp_sin'), 1) = 32006
    and pg_temp.tot(pg_temp.rk('tp_inv'), 0) + pg_temp.tot(pg_temp.rk('tp_tea'), 0) + pg_temp.tot(pg_temp.rk('tp_sin'), 0) = 78501),
  ('un arreglo vacio no coincide con nada: series en cero, sin tiendas, sin pares ni mayores (y por_gm intacto)',
    pg_temp.tot(pg_temp.rk('tp_vacio'), 0) = 0 and pg_temp.tot(pg_temp.rk('tp_vacio'), 1) = 0
    and pg_temp.an(pg_temp.rk('tp_vacio'), 1) -> 'base' -> 'meses' = '[0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]'::jsonb
    and pg_temp.rk('tp_vacio') -> 'por_par' = '{"gml": [], "am": [], "filas": []}'::jsonb and pg_temp.rk('tp_vacio') -> 'mayores' = '[]'::jsonb
    and pg_temp.an(pg_temp.rk('tp_vacio'), 1) -> 'conteos' ->> 'registros' = '0'),
  ('desglose por linea: L1 de HOMBRE = base 34 000 (resto de oct–dic 11 100) y T10 4 100 en 2026; base 37 000 mas T04 1 000 y T12 1 408 en 2027',
    pg_temp.pd(pg_temp.rk('tp_lin'), pg_temp.nodo('HU1')::text) -> 'Y'
      = jsonb_build_object('base', 34000, 'base_resto', 11100, 'tiendas', jsonb_build_array(jsonb_build_array(pg_temp.t('T10'), 4100)))
    and pg_temp.jn(pg_temp.pd(pg_temp.rk('tp_lin'), pg_temp.nodo('HU1')::text), 'Y1', 'base') = 37000
    and (select sum((y ->> 1)::numeric) from jsonb_array_elements(pg_temp.pd(pg_temp.rk('tp_lin'), pg_temp.nodo('HU1')::text) -> 'Y1' -> 'tiendas') y) = 2408
    and jsonb_array_length(pg_temp.rk('tp_lin') -> 'por_dim') = 3),
  ('R5: en cada desglose (genero, mundo, linea, agrupacion de marca, temporada) la suma de los elementos es el total de cada anio',
    not exists (select 1 from res where k in ('tp_lin', 'tp_gen', 'tp_mun', 'tp_dam', 'tp_tem')
                and (pg_temp.pdt(v, 'Y') <> 78501 or pg_temp.pdt(v, 'Y1') <> 84714))
    and pg_temp.jn(pg_temp.pd(pg_temp.rk('tp_gen'), pg_temp.gen('H41M')::text), 'Y1', 'base') = 32006
    and pg_temp.jn(pg_temp.pd(pg_temp.rk('tp_tem'), 'sin_temporada'), 'Y1', 'base') = 32006
    and pg_temp.jn(pg_temp.pd(pg_temp.rk('tp_tem'), 'invierno'), 'Y1', 'base') = 13300
    and pg_temp.jn(pg_temp.pd(pg_temp.rk('tp_dam'), pg_temp.am('B')::text), 'Y1', 'base') = 28300),
  ('por_dim es null sin desglose y con desglose = tienda (la tienda sale de `tiendas` y de la atribucion)',
    pg_temp.rk('tp0') -> 'por_dim' = 'null'::jsonb and pg_temp.rk('tp_tie') -> 'por_dim' = 'null'::jsonb
    and pg_temp.rk('tp0') -> 'sin_participacion_marca' = 'null'::jsonb),
  ('R9 unidad de marca X en HOMBRE x URBANO: 2027 = 0,63 x (25 000 + 1 408) + 0,40 x 9 000 = 20 237 (19 350 de base y 887 de T12)',
    pg_temp.jn(pg_temp.rk('tp_x'), 'anios', '1', 'base', 'vigente') = 19350
    and pg_temp.jn(pg_temp.tda(pg_temp.rk('tp_x'), 1, 'T12'), 'vigente') = 887
    and pg_temp.tot(pg_temp.rk('tp_x'), 1) = 20237
    and jsonb_array_length(pg_temp.an(pg_temp.rk('tp_x'), 1) -> 'tiendas') = 1
    and pg_temp.jn(pg_temp.tda(pg_temp.rk('tp_x'), 0, 'T10'), 'vigente') = 2583
    and pg_temp.jn(pg_temp.tda(pg_temp.rk('tp_x'), 0, 'T10'), 'para_base') = 2583),
  ('R9 redondeo UNA vez por mes: enero de 2027 = round(0,63 x 1 413 + 0,40 x 750) = 1 190; la suma de los 12 meses difiere del total en 12 u o menos',
    pg_temp.jn(pg_temp.rk('tp_x'), 'anios', '1', 'base', 'meses', '0') = 1190
    and abs((select sum(m::numeric) from jsonb_array_elements_text(pg_temp.an(pg_temp.rk('tp_x'), 1) -> 'base' -> 'meses') m) - 19350) <= 12
    and pg_temp.jn(pg_temp.rk('tp_x'), 'anios', '1', 'base', 'B') = round(0.63 * 23500 + 0.40 * 8200)),
  ('R9 una fila base sin por_marca va a sin_participacion_marca (L2 x AM-B: 3 900 y 4 300) y no a la serie; con la AM de la unidad no queda nada fuera',
    pg_temp.rk('tp_x') -> 'sin_participacion_marca' = '{"Y": 3900, "Y1": 4300}'::jsonb
    and pg_temp.rk('tp_xa') -> 'sin_participacion_marca' = '{"Y": 0, "Y1": 0}'::jsonb
    and pg_temp.tot(pg_temp.rk('tp_xa'), 1) = 20237),
  ('la «marca» es la UNIDAD de marca: un miembro de un conjunto (X2) no tiene participacion propia y no proyecta nada',
    pg_temp.tot(pg_temp.rk('tp_x2'), 1) = 0 and pg_temp.rk('tp_x2') -> 'sin_participacion_marca' = '{"Y": 14900, "Y1": 16300}'::jsonb),
  ('desglose por marca: cada registro se reparte con por_marca de su fila base; X = 19 350 de base en 2027; lo repartido mas lo que no trae por_marca es el total',
    pg_temp.jn(pg_temp.pd(pg_temp.rk('tp_mar'), pg_temp.mc('X')::text), 'Y1', 'base') = 19350
    and pg_temp.pdt(pg_temp.rk('tp_mar'), 'Y1') + pg_temp.jn(pg_temp.rk('tp_mar'), 'sin_participacion_marca', 'Y1') = 84714
    and pg_temp.rk('tp_mar') -> 'sin_participacion_marca' = '{"Y": 14900, "Y1": 16300}'::jsonb
    and pg_temp.tot(pg_temp.rk('tp_mar'), 1) = 84714
    and jsonb_array_length(pg_temp.rk('tp_mar') -> 'por_dim') = 3),
  ('determinista: dos llamadas iguales dan el mismo documento',
    pg_temp.tp(pg_temp.id(100), '{"desglose": "linea"}'::jsonb) = pg_temp.rk('tp_lin'));

-- Variantes sobre una COPIA (proyección 101): registros sin B, sin meses e inactivos.
select pg_temp.copiar(pg_temp.id(100), pg_temp.id(101), 'Copia variantes H41') is not null as copia_creada;
update proyeccion_fila_anios a set base_siguiente = null, base_normalizada = null
  from proyeccion_filas f where f.id = a.fila_id and f.proyeccion_id = pg_temp.id(101) and f.clave = (select clave from proyeccion_filas where id = pg_temp.f('F1')) and a.anio = 2027;
update proyeccion_fila_anios a set meses = null
  from proyeccion_filas f where f.id = a.fila_id and f.proyeccion_id = pg_temp.id(101) and f.clave = (select clave from proyeccion_filas where id = pg_temp.f('M2')) and a.anio = 2027;
update proyeccion_fila_anios a set activo = false
  from proyeccion_filas f where f.id = a.fila_id and f.proyeccion_id = pg_temp.id(101) and f.clave = (select clave from proyeccion_filas where id = pg_temp.f('FT12'));
update proyeccion_filas set activo = false
  where proyeccion_id = pg_temp.id(101) and clave = (select clave from proyeccion_filas where id = pg_temp.f('FT04'));
-- Una fila ACEPTADA TAL CUAL (12 000) cuya propuesta baja despues a 11 950 al recalcular: 50 u que no son una decision a mano.
update proyeccion_fila_anios a set propuesto = 11950
  from proyeccion_filas f where f.id = a.fila_id and f.proyeccion_id = pg_temp.id(101) and f.clave = (select clave from proyeccion_filas where id = pg_temp.f('F2')) and a.anio = 2027;
-- Una fila con origen manual (20 006 frente a 18 780) que despues queda dentro de un lote: se clasifica `lote`, no `manual`.
update proyeccion_fila_anios a set decision_lote_id = pg_temp.id(300)
  from proyeccion_filas f where f.id = a.fila_id and f.proyeccion_id = pg_temp.id(101) and f.clave = (select clave from proyeccion_filas where id = pg_temp.f('M1')) and a.anio = 2027;
insert into res values ('tpv', pg_temp.tp(pg_temp.id(101), '{}'::jsonb)),
  ('tpv_x', pg_temp.tp(pg_temp.id(101), jsonb_build_object('gml_ids', (select to_jsonb(ids) from hun), 'unidad_marca_id', pg_temp.mc('B1'))));
insert into r (caso, ok) values
  ('variante sin B: si la fila base de T10 no tiene B, su 2026 no entra a la base (para_base 0) y queda en fuera_base_exacto (4 100); la fila va a vigente_sin_B',
    pg_temp.jn(pg_temp.tda(pg_temp.rk('tpv'), 0, 'T10'), 'para_base') = 0
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tpv'), 'H41H'), 'Y', 'fuera_base_exacto') = 4100
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tpv'), 'H41H'), 'Y1', 'vigente_sin_B') = 25000
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tpv'), 'H41H'), 'Y1', 'B') = 47040 - 23500
    and pg_temp.jn(pg_temp.rk('tpv'), 'anios', '1', 'base', 'vigente_sin_B') = 25000),
  ('variante sin meses (R1): un registro sin `meses` suma al total y no a los meses; sin_meses es exactamente la diferencia (12 000)',
    pg_temp.jn(pg_temp.rk('tpv'), 'anios', '1', 'base', 'sin_meses') = 12000
    and pg_temp.jn(pg_temp.rk('tpv'), 'anios', '1', 'base', 'vigente') = 82306
    and (select sum(m::numeric) from jsonb_array_elements_text(pg_temp.an(pg_temp.rk('tpv'), 1) -> 'base' -> 'meses') m) = 82306 - 12000),
  ('variante inactivos: un registro inactivo y una fila inactiva no cuentan (2027 sin T12 ni T04: 82 306; en cada GM el puente sigue cuadrando)',
    pg_temp.tot(pg_temp.rk('tpv'), 1) = 82306 and jsonb_array_length(pg_temp.an(pg_temp.rk('tpv'), 1) -> 'tiendas') = 0
    and pg_temp.gms(pg_temp.rk('tpv'), 'Y1', 'total') = 82306
    and not exists (select 1 from jsonb_array_elements(pg_temp.rk('tpv') -> 'por_gm') x
                    where (x -> 'Y1' ->> 'vigente_con_B')::numeric + (x -> 'Y1' ->> 'vigente_sin_B')::numeric + (x -> 'Y1' ->> 'nuevas_anterior')::numeric
                        + (x -> 'Y1' ->> 'aperturas')::numeric + (x -> 'Y1' ->> 'cierres')::numeric <> (x -> 'Y1' ->> 'total')::numeric)),
  ('variante delta_otras: una fila aceptada cuya propuesta cambio despues (12 000 frente a 11 950) va a delta_otras (50), no a delta_manual (117)',
    pg_temp.jn(pg_temp.gm(pg_temp.rk('tpv'), 'H41H'), 'Y1', 'delta_manual') = 117
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tpv'), 'H41H'), 'Y1', 'delta_otras') = 50),
  ('variante clasificacion excluyente: una fila con origen manual que esta en un lote NO es «fijado a mano» (MUJER: delta_manual 0, delta_otras 1 226); la identidad se mantiene',
    pg_temp.jn(pg_temp.gm(pg_temp.rk('tpv'), 'H41M'), 'Y1', 'delta_manual') = 0
    and pg_temp.jn(pg_temp.gm(pg_temp.rk('tpv'), 'H41M'), 'Y1', 'delta_otras') = 1226
    and pg_temp.jn(pg_temp.rk('tpv'), 'anios', '1', 'base', 'delta_manual') = 117
    and pg_temp.jn(pg_temp.rk('tpv'), 'anios', '1', 'base', 'delta_otras') = 1276
    and pg_temp.jn(pg_temp.rk('tpv'), 'anios', '1', 'base', 'vigente_con_B') - pg_temp.jn(pg_temp.rk('tpv'), 'anios', '1', 'base', 'propuesto_con_B') = 1393
    and pg_temp.an(pg_temp.rk('tpv'), 1) -> 'decisiones' -> 'manual' ->> 'n' = '1'),
  ('variante delta con unidad de marca (B1 pesa 1 en L1 x AM-B): la identidad se mantiene tambien con pesos (delta_manual 0, delta_otras 50)',
    pg_temp.jn(pg_temp.rk('tpv_x'), 'anios', '1', 'base', 'delta_manual') = 0
    and pg_temp.jn(pg_temp.rk('tpv_x'), 'anios', '1', 'base', 'delta_otras') = 50
    and pg_temp.jn(pg_temp.rk('tpv_x'), 'anios', '1', 'base', 'vigente_con_B') = 12000),
  ('la copia con cifras cambiadas tiene OTRA huella que la original',
    pg_temp.rk('tpv') ->> 'huella' <> pg_temp.hk('h0') and pg_temp.rk('tpv') ->> 'huella' = pg_temp.h(pg_temp.id(101)));

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. tablero_venta (R2, forma, filtros, desgloses, precios, stock, tendencia, universo)
-- ---------------------------------------------------------------------------------------------------------------------
create temp table pv as select '{"desde": "2023-01-01", "hasta": "2026-10-01", "k": 9, "k_prima": 10}'::jsonb as b,
                               (select to_jsonb(ids) from hun) as hu;
insert into res
select x.k, pg_temp.tv(pv.b || x.extra)
from pv, lateral (values
  ('tv0', '{}'::jsonb),
  ('tv_proy', jsonb_build_object('proyeccion_id', pg_temp.id(100))),
  ('tv_hu', jsonb_build_object('gml_ids', pv.hu)),
  ('tv_hu_lin', jsonb_build_object('gml_ids', pv.hu, 'desglose', 'linea')),
  ('tv_hu_t03', jsonb_build_object('gml_ids', pv.hu, 'desglose', 'linea', 'tienda_ids', jsonb_build_array(pg_temp.t('T03')))),
  ('tv_gen', '{"desglose": "genero"}'::jsonb),
  ('tv_tie', '{"desglose": "tienda"}'::jsonb),
  ('tv_ama', jsonb_build_object('agrupacion_marca_ids', jsonb_build_array(pg_temp.am('A')))),
  ('tv_amb', jsonb_build_object('agrupacion_marca_ids', jsonb_build_array(pg_temp.am('B')))),
  ('tv_x', jsonb_build_object('unidad_marca_id', pg_temp.mc('X'))),
  ('tv_mar', '{"desglose": "marca"}'::jsonb),
  ('tv_inv', jsonb_build_object('temporadas', '["invierno"]'::jsonb, 'proyeccion_id', pg_temp.id(100))),
  ('tv_inv_sinproy', '{"temporadas": ["invierno"]}'::jsonb),
  ('tv_tem', jsonb_build_object('desglose', 'temporada', 'proyeccion_id', pg_temp.id(100))),
  ('tv_set', '{"hasta": "2026-09-01", "k_prima": 9}'::jsonb),
  ('tv_tend', '{"solo_tendencia": true}'::jsonb),
  ('tv_tend_hu', jsonb_build_object('solo_tendencia', true, 'gml_ids', pv.hu, 'agrupacion_marca_ids', jsonb_build_array(pg_temp.am('A')))),
  ('tv_vacio', '{"gml_ids": []}'::jsonb)
) as x(k, extra);
insert into res values ('tv_nada', pg_temp.tv('{}'::jsonb)), ('tv_nulo', pg_temp.tv(null));

-- La fuente, para cuadrar: hechos de tiendas de tipo Tienda en cargas publicadas del rango.
create temp table fuente as
select c.periodo, t.id as tienda_id, n.genero_id, e.genero_mundo_linea_id as gml_id, e.codigo as eq, mu.unidad_marca_id, cab.agrupacion_marca_id as am_id,
       m.unidades, m.venta_soles
from venta_stock_mensual m
join cargas_venta_stock c on c.id = m.carga_id and c.estado = 'publicada'
join tiendas t on t.id = m.tienda_id and t.tipo = 'Tienda'
join equivalencias e on e.id = m.equivalencia_id
join genero_mundo_linea n on n.id = e.genero_mundo_linea_id
join marcas_unidad mu on mu.marca_id = m.marca_id
join marcas cab on cab.id = mu.unidad_marca_id
where c.periodo between date '2023-01-01' and date '2026-10-01';

insert into r (caso, ok) values
  ('forma: el documento trae exactamente sus 8 claves; con solo_tendencia SOLO periodos, tiendas y tendencia_gm; ninguna llamada lanzo error',
    (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rk('tv0')) k)
      = array['fuera_universo', 'periodos', 'por_dim', 'por_tienda', 'precios', 'stock', 'tendencia_gm', 'tiendas']
    and (select array_agg(k order by k) from jsonb_object_keys(pg_temp.rk('tv_tend')) k) = array['periodos', 'tendencia_gm', 'tiendas']
    and not exists (select 1 from res where k like 'tv%' and v ->> 'error' = 'EXC')),
  ('R2: sin filtros, el real de cada tienda y mes es la suma de unidades y soles de la fuente (tiendas de tipo Tienda, cargas publicadas)',
    (select count(*) from jsonb_array_elements(pg_temp.rk('tv0') -> 'por_tienda')) = (select count(*) from (select 1 from fuente group by tienda_id, periodo) q)
    and not exists (
      select 1 from (select tienda_id, to_char(periodo, 'YYYY-MM') as mes, sum(unidades) as u, sum(venta_soles) as s from fuente group by 1, 2) q
      where not exists (select 1 from jsonb_array_elements(pg_temp.rk('tv0') -> 'por_tienda') e
                        where pg_temp.rk('tv0') -> 'tiendas' ->> (e ->> 0)::integer = q.tienda_id::text and e ->> 1 = q.mes
                          and (e ->> 2)::numeric = q.u and (e ->> 3)::numeric = q.s))
    and pg_temp.pts(pg_temp.rk('tv0'), '2023-01', '2026-10') = (select sum(unidades) from fuente)),
  ('R2: el CD no aparece: no esta en el indice de tiendas y sus 900 u de 2025 no suman en ninguna cifra',
    not (pg_temp.rk('tv0') -> 'tiendas' @> jsonb_build_array(pg_temp.t('CD1')))
    and pg_temp.rk('tv0') -> 'tiendas' @> jsonb_build_array(pg_temp.t('T01'), pg_temp.t('T12'))
    and pg_temp.pts(pg_temp.rk('tv_hu'), '2025-01', '2025-12') = 47000),
  ('HOMBRE x URBANO: 2023 = 40 000, 2024 = 42 000, 2025 = 47 000; 2026 ene–set = 34 000 y octubre = 4 300; T03 2025 = 7 500',
    pg_temp.pts(pg_temp.rk('tv_hu'), '2023-01', '2023-12') = 40000 and pg_temp.pts(pg_temp.rk('tv_hu'), '2024-01', '2024-12') = 42000
    and pg_temp.pts(pg_temp.rk('tv_hu'), '2026-01', '2026-09') = 34000 and pg_temp.pts(pg_temp.rk('tv_hu'), '2026-10', '2026-10') = 4300
    and pg_temp.pts(pg_temp.rk('tv_hu'), '2025-01', '2025-12', 'T03') = 7500 and pg_temp.pts(pg_temp.rk('tv_hu'), '2026-01', '2026-09', 'T03') = 5000
    and pg_temp.pts(pg_temp.rk('tv_hu'), '2025-01', '2025-09') = 33000),
  ('soles reales de HOMBRE x URBANO: 2023 S/ 1 880 000, 2024 S/ 2 016 000, 2025 S/ 2 350 000, 2026 ene–set S/ 1 768 000 y ene–oct S/ 1 991 600',
    pg_temp.pts(pg_temp.rk('tv_hu'), '2023-01', '2023-12', null, 3) = 1880000 and pg_temp.pts(pg_temp.rk('tv_hu'), '2024-01', '2024-12', null, 3) = 2016000
    and pg_temp.pts(pg_temp.rk('tv_hu'), '2025-01', '2025-12', null, 3) = 2350000
    and pg_temp.pts(pg_temp.rk('tv_hu'), '2026-01', '2026-09', null, 3) = 1768000 and pg_temp.pts(pg_temp.rk('tv_hu'), '2026-01', '2026-10', null, 3) = 1991600),
  ('periodos: los 46 meses publicados con su carga; la carga retirada de nov 2026 no existe para el tablero; con hasta = set quedan 45',
    (select count(*) from jsonb_object_keys(pg_temp.rk('tv0') -> 'periodos')) = 46
    and pg_temp.rk('tv0') -> 'periodos' ->> '2026-10' = pg_temp.carga(date '2026-10-01')::text
    and not (pg_temp.rk('tv0') -> 'periodos' ? '2026-11')
    and (select count(*) from jsonb_object_keys(pg_temp.rk('tv_set') -> 'periodos')) = 45
    and pg_temp.pts(pg_temp.rk('tv_set'), '2026-10', '2026-12') = 0
    and pg_temp.rk('tv_set') -> 'stock' ->> 'periodo' = '2026-09'),
  ('por_dim por linea en HOMBRE x URBANO: Y−3 40 000, Y−2 42 000, Y−1 47 000, ene–oct 2025 36 455, ene–oct 2026 38 300, S/ de Y−1 y del acumulado',
    pg_temp.pds(pg_temp.rk('tv_hu_lin'), 1) = 40000 and pg_temp.pds(pg_temp.rk('tv_hu_lin'), 2) = 42000 and pg_temp.pds(pg_temp.rk('tv_hu_lin'), 3) = 47000
    and pg_temp.pds(pg_temp.rk('tv_hu_lin'), 4) = 36455 and pg_temp.pds(pg_temp.rk('tv_hu_lin'), 5) = 38300
    and pg_temp.pds(pg_temp.rk('tv_hu_lin'), 6) = 2350000 and pg_temp.pds(pg_temp.rk('tv_hu_lin'), 7) = 1991600
    and jsonb_array_length(pg_temp.rk('tv_hu_lin') -> 'por_dim' -> 'ids') = 2
    and pg_temp.pds(pg_temp.rk('tv_hu_lin'), 3, pg_temp.nodo('HU2')::text) = (select sum(unidades) from fuente where eq = 'EH2' and periodo between date '2025-01-01' and date '2025-12-01')),
  ('por_dim por genero sin filtros: tres generos; NINO vendio 3 100 en Y−3 y nada mas; MUJER 27 500 en Y−1, 21 000 y 22 300 en los acumulados',
    jsonb_array_length(pg_temp.rk('tv_gen') -> 'por_dim' -> 'ids') >= 3
    and pg_temp.pds(pg_temp.rk('tv_gen'), 1, pg_temp.gen('H41N')::text) = 3100 and pg_temp.pds(pg_temp.rk('tv_gen'), 3, pg_temp.gen('H41N')::text) = 0
    and pg_temp.pds(pg_temp.rk('tv_gen'), 3, pg_temp.gen('H41M')::text) = 27500
    and pg_temp.pds(pg_temp.rk('tv_gen'), 4, pg_temp.gen('H41M')::text) = 21000 and pg_temp.pds(pg_temp.rk('tv_gen'), 5, pg_temp.gen('H41M')::text) = 22300
    and pg_temp.pds(pg_temp.rk('tv_gen'), 5) = (select sum(unidades) from fuente where periodo between date '2026-01-01' and date '2026-10-01')),
  ('por_dim es null sin desglose y con desglose = tienda; tendencia_gm es null sin solo_tendencia; fuera_universo es null sin proyeccion_id',
    pg_temp.rk('tv0') -> 'por_dim' = 'null'::jsonb and pg_temp.rk('tv_tie') -> 'por_dim' = 'null'::jsonb
    and pg_temp.rk('tv0') -> 'tendencia_gm' = 'null'::jsonb and pg_temp.rk('tv0') -> 'fuera_universo' = 'null'::jsonb),
  ('precios: los 12 meses de nov 2025 a oct 2026 de HOMBRE x URBANO son 48 845 u a S/ 52,00 en cada par (nodo x agrupacion de marca)',
    (select sum((x ->> 2)::numeric) from jsonb_array_elements(pg_temp.rk('tv_hu') -> 'precios' -> 'filas') x) = 48845
    and (select sum((x ->> 3)::numeric) from jsonb_array_elements(pg_temp.rk('tv_hu') -> 'precios' -> 'filas') x) = 48845 * 52
    and not exists (select 1 from jsonb_array_elements(pg_temp.rk('tv_hu') -> 'precios' -> 'filas') x where (x ->> 3)::numeric <> (x ->> 2)::numeric * 52)
    and jsonb_array_length(pg_temp.rk('tv_hu') -> 'precios' -> 'filas') = 4
    and jsonb_array_length(pg_temp.rk('tv_hu') -> 'precios' -> 'gml') = 2 and jsonb_array_length(pg_temp.rk('tv_hu') -> 'precios' -> 'am') = 2),
  ('stock de oct 2026 de HOMBRE x URBANO: 18 000 en tiendas y 12 000 en el CD; el stock de set no cuenta; sin filtros suma el de MUJER (700)',
    pg_temp.rk('tv_hu') -> 'stock' ->> 'periodo' = '2026-10'
    and (select sum((x ->> 1)::numeric) from jsonb_array_elements(pg_temp.rk('tv_hu') -> 'stock' -> 'por_tienda') x) = 18000
    and pg_temp.jn(pg_temp.rk('tv_hu'), 'stock', 'cd') = 12000
    and (select sum((x ->> 1)::numeric) from jsonb_array_elements(pg_temp.rk('tv0') -> 'stock' -> 'por_tienda') x) = 18700
    and jsonb_array_length(pg_temp.rk('tv_hu') -> 'stock' -> 'por_tienda') = 5),
  ('con tienda_ids el stock es solo el de esas tiendas (T03: 2 500) y el del CD va en null',
    jsonb_array_length(pg_temp.rk('tv_hu_t03') -> 'stock' -> 'por_tienda') = 1
    and pg_temp.jn(pg_temp.rk('tv_hu_t03'), 'stock', 'por_tienda', '0', '1') = 2500
    and pg_temp.rk('tv_hu_t03') -> 'stock' -> 'cd' = 'null'::jsonb),
  ('R10: tienda_ids NO cambia por_tienda (la atribucion necesita a todas) pero si recorta por_dim (T03: 7 500 en Y−1) y precios',
    pg_temp.rk('tv_hu_t03') -> 'por_tienda' = pg_temp.rk('tv_hu') -> 'por_tienda'
    and pg_temp.pds(pg_temp.rk('tv_hu_t03'), 3) = 7500 and pg_temp.pds(pg_temp.rk('tv_hu_t03'), 5) = 5400
    and (select sum((x ->> 2)::numeric) from jsonb_array_elements(pg_temp.rk('tv_hu_t03') -> 'precios' -> 'filas') x) = 600 + 900 + 5400),
  ('R10: la union disjunta de las agrupaciones de marca suma el total sin filtro; cada una es la de la UNIDAD de marca',
    pg_temp.pts(pg_temp.rk('tv_ama'), '2023-01', '2026-10') + pg_temp.pts(pg_temp.rk('tv_amb'), '2023-01', '2026-10') = pg_temp.pts(pg_temp.rk('tv0'), '2023-01', '2026-10')
    and pg_temp.pts(pg_temp.rk('tv_ama'), '2023-01', '2026-10') = (select sum(unidades) from fuente where am_id = pg_temp.am('A'))
    and pg_temp.pts(pg_temp.rk('tv_ama'), '2023-01', '2026-10', null, 3) = (select sum(venta_soles) from fuente where am_id = pg_temp.am('A'))),
  ('R9: la venta de una unidad de marca es la de TODAS sus marcas (X y X2)',
    pg_temp.pts(pg_temp.rk('tv_x'), '2023-01', '2026-10') = (select sum(unidades) from fuente where unidad_marca_id = pg_temp.mc('X'))
    and (select sum(unidades) from fuente where unidad_marca_id = pg_temp.mc('X'))
        > (select sum(m.unidades) from venta_stock_mensual m join cargas_venta_stock c on c.id = m.carga_id and c.estado = 'publicada'
           join tiendas t on t.id = m.tienda_id and t.tipo = 'Tienda' where m.marca_id = pg_temp.mc('X'))),
  ('desglose por marca: los elementos son UNIDADES de marca (X2 no aparece: va dentro de X) y suman el total',
    not (pg_temp.rk('tv_mar') -> 'por_dim' -> 'ids' @> jsonb_build_array(pg_temp.mc('X2')))
    and pg_temp.rk('tv_mar') -> 'por_dim' -> 'ids' @> jsonb_build_array(pg_temp.mc('X'), pg_temp.mc('A2'), pg_temp.mc('B1'))
    and pg_temp.pds(pg_temp.rk('tv_mar'), 3) = (select sum(unidades) from fuente where periodo between date '2025-01-01' and date '2025-12-01')
    and pg_temp.pds(pg_temp.rk('tv_mar'), 3, pg_temp.mc('X')::text)
        = (select sum(unidades) from fuente where unidad_marca_id = pg_temp.mc('X') and periodo between date '2025-01-01' and date '2025-12-01')
    and pg_temp.rk('tv_mar') -> 'por_tienda' = pg_temp.rk('tv0') -> 'por_tienda'),
  ('temporada = invierno (semiunion con las filas base; nodo GMLE por equivalencia): solo la venta de L2, en venta, precios y stock',
    pg_temp.pts(pg_temp.rk('tv_inv'), '2023-01', '2026-10') = (select sum(unidades) from fuente where eq = 'EH2')
    and (select sum(unidades) from fuente where eq = 'EH2') > 0
    and (select sum((x ->> 2)::numeric) from jsonb_array_elements(pg_temp.rk('tv_inv') -> 'precios' -> 'filas') x)
        = (select sum(unidades) from fuente where eq = 'EH2' and periodo >= date '2025-11-01')
    and pg_temp.rk('tv_inv') -> 'stock' -> 'por_tienda' = '[]'::jsonb and pg_temp.jn(pg_temp.rk('tv_inv'), 'stock', 'cd') = 0),
  ('un filtro de temporada sin proyeccion_id no deja nada (no hay filas base contra las que cruzar)',
    pg_temp.rk('tv_inv_sinproy') -> 'por_tienda' = '[]'::jsonb and pg_temp.rk('tv_inv_sinproy') -> 'fuera_universo' = 'null'::jsonb),
  ('fuera_universo: la venta sin fila base en la proyeccion (NINO, 3 100 u en 2023), por anio; no depende del filtro de temporada',
    pg_temp.rk('tv_proy') -> 'fuera_universo' = '[[2023, 3100]]'::jsonb
    and pg_temp.rk('tv_inv') -> 'fuera_universo' = '[[2023, 3100]]'::jsonb
    and pg_temp.rk('tv_proy') -> 'por_tienda' = pg_temp.rk('tv0') -> 'por_tienda'),
  ('desglose por temporada: invierno, todo_el_ano, sin_temporada (MUJER) y fuera_universo (NINO); suman el total',
    (select array_agg(x order by x) from jsonb_array_elements_text(pg_temp.rk('tv_tem') -> 'por_dim' -> 'ids') x)
      = array['fuera_universo', 'invierno', 'sin_temporada', 'todo_el_ano']
    and pg_temp.pds(pg_temp.rk('tv_tem'), 1, 'fuera_universo') = 3100
    and pg_temp.pds(pg_temp.rk('tv_tem'), 3, 'sin_temporada') = 27500
    and pg_temp.pds(pg_temp.rk('tv_tem'), 3, 'invierno') = (select sum(unidades) from fuente where eq = 'EH2' and periodo between date '2025-01-01' and date '2025-12-01')
    and pg_temp.pds(pg_temp.rk('tv_tem'), 3) = 47000 + 27500),
  ('tendencia_gm (ene–oct de 2026 y de 2025): HOMBRE x URBANO en las mismas tiendas de 2026 (T01–T04) 34 290 frente a 36 455; MUJER 22 300 frente a 21 000',
    (select sum((x ->> 3)::numeric) from jsonb_array_elements(pg_temp.rk('tv_tend') -> 'tendencia_gm') x
     where x ->> 0 = pg_temp.gen('H41H')::text
       and pg_temp.rk('tv_tend') -> 'tiendas' ->> (x ->> 2)::integer in (pg_temp.t('T01')::text, pg_temp.t('T02')::text, pg_temp.t('T03')::text, pg_temp.t('T04')::text)) = 34290
    and (select sum((x ->> 4)::numeric) from jsonb_array_elements(pg_temp.rk('tv_tend') -> 'tendencia_gm') x
     where x ->> 0 = pg_temp.gen('H41H')::text
       and pg_temp.rk('tv_tend') -> 'tiendas' ->> (x ->> 2)::integer in (pg_temp.t('T01')::text, pg_temp.t('T02')::text, pg_temp.t('T03')::text, pg_temp.t('T04')::text)) = 36455
    and (select sum((x ->> 3)::numeric) from jsonb_array_elements(pg_temp.rk('tv_tend') -> 'tendencia_gm') x where x ->> 0 = pg_temp.gen('H41M')::text) = 22300
    and (select sum((x ->> 4)::numeric) from jsonb_array_elements(pg_temp.rk('tv_tend') -> 'tendencia_gm') x where x ->> 0 = pg_temp.gen('H41M')::text) = 21000),
  ('tendencia_gm va SIEMPRE sin filtros (aunque se pasen GML y AM) y no incluye al CD',
    pg_temp.rk('tv_tend_hu') -> 'tendencia_gm' = pg_temp.rk('tv_tend') -> 'tendencia_gm'
    and (select sum((x ->> 4)::numeric) from jsonb_array_elements(pg_temp.rk('tv_tend') -> 'tendencia_gm') x)
        = (select sum(unidades) from fuente where periodo between date '2025-01-01' and date '2025-10-01')),
  ('un arreglo vacio no coincide con nada; sin desde ni hasta (o con p nulo) el documento sale vacio y sin error',
    pg_temp.rk('tv_vacio') -> 'por_tienda' = '[]'::jsonb and pg_temp.rk('tv_vacio') -> 'precios' -> 'filas' = '[]'::jsonb
    and pg_temp.rk('tv_vacio') -> 'stock' -> 'por_tienda' = '[]'::jsonb
    and pg_temp.rk('tv_nada') -> 'por_tienda' = '[]'::jsonb and pg_temp.rk('tv_nada') -> 'periodos' = '{}'::jsonb
    and pg_temp.rk('tv_nulo') -> 'por_tienda' = '[]'::jsonb and pg_temp.rk('tv_nulo') ->> 'error' is null),
  ('determinista: dos llamadas iguales dan el mismo documento',
    (select pg_temp.tv(pv.b || jsonb_build_object('gml_ids', pv.hu, 'desglose', 'linea')) from pv) = pg_temp.rk('tv_hu_lin'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. registrar_aprobacion_direccion: la secuencia de la ficha §6.1 (R14, R16) y los rechazos
-- ---------------------------------------------------------------------------------------------------------------------
-- (1) El admin aprueba la proyección EN TRABAJO con la huella h1.
insert into hu values ('h1', pg_temp.h(pg_temp.id(100)));
insert into r (caso, ok) values
  ('antes de aprobar: sin_aprobacion',
    pg_temp.estado_dir(pg_temp.id(100)) = 'sin_aprobacion' and pg_temp.napr() = 0);
insert into res values ('a1', pg_temp.reg(pg_temp.pl(pg_temp.id(100), pg_temp.hk('h1'))));
insert into r (caso, ok) values
  ('(1) aprobar en trabajo: devuelve la fila (con id, sin error), con la huella recalculada, el estado al aprobar y el rol admin',
    pg_temp.rk('a1') ->> 'error' is null and pg_temp.rk('a1') ->> 'id' is not null
    and pg_temp.rk('a1') ->> 'huella' = pg_temp.hk('h1') and pg_temp.rk('a1') ->> 'estado_proyeccion' = 'en_trabajo'
    and pg_temp.rk('a1') ->> 'resultado' = 'aprobada' and pg_temp.rk('a1') ->> 'rol' = 'admin' and pg_temp.rk('a1') ->> 'anio_en_curso' = '2026'
    and pg_temp.rk('a1') ->> 'usuario_nombre' = 'Admin A.' and pg_temp.rk('a1') ->> 'perfil_id' = pg_temp.id(9001)::text
    and pg_temp.rk('a1') -> 'resumen' ->> 'huella' = pg_temp.hk('h1') and pg_temp.rk('a1') -> 'motivo' = 'null'::jsonb
    and pg_temp.napr(pg_temp.id(100)) = 1 and pg_temp.estado_dir(pg_temp.id(100)) = 'aprobada');

-- (2) El planner cambia una fila de 4 300 a 4 400: huella h2, la aprobación queda invalidada.
update proyeccion_fila_anios set decidido = 4400 where id = pg_temp.a('F4', 2027);
insert into hu values ('h2', pg_temp.h(pg_temp.id(100)));
insert into r (caso, ok) values
  ('(2) cambiar una fila da otra huella y la aprobacion queda invalidada (sin tocar la fila de la aprobacion)',
    pg_temp.hk('h2') <> pg_temp.hk('h1') and pg_temp.estado_dir(pg_temp.id(100)) = 'invalidada' and pg_temp.napr(pg_temp.id(100)) = 1);

-- (5) Un registro con la huella vieja h1: huella_distinta, sin fila nueva (R16). (8) Un resumen con otra huella: lo mismo (R14).
insert into res values
  ('a_vieja', pg_temp.reg(pg_temp.pl(pg_temp.id(100), pg_temp.hk('h1')))),
  ('a_res', pg_temp.reg(pg_temp.pl(pg_temp.id(100), pg_temp.hk('h2'), 'aprobada', null, null,
                                   jsonb_build_object('resumen', jsonb_build_object('huella', pg_temp.hk('h1')))))),
  ('a_res_sin', pg_temp.reg(pg_temp.pl(pg_temp.id(100), pg_temp.hk('h2'), 'aprobada', null, null, '{"resumen": {"totales": []}}'::jsonb))),
  ('a_sin_vista', pg_temp.reg(pg_temp.pl(pg_temp.id(100), pg_temp.hk('h2')) - 'huella_vista'));
insert into r (caso, ok) values
  ('(5) R16: con la huella que ya no es la actual responde huella_distinta con huella_actual y NO inserta',
    pg_temp.rk('a_vieja') = jsonb_build_object('error', 'huella_distinta', 'huella_actual', pg_temp.hk('h2')) and pg_temp.napr(pg_temp.id(100)) = 1),
  ('(8) R14: si el resumen trae otra huella (o ninguna), o falta huella_vista, responde huella_distinta y NO inserta',
    pg_temp.rk('a_res') ->> 'error' = 'huella_distinta' and pg_temp.rk('a_res_sin') ->> 'error' = 'huella_distinta'
    and pg_temp.rk('a_sin_vista') ->> 'error' = 'huella_distinta' and pg_temp.napr(pg_temp.id(100)) = 1);

-- (3) El admin aprueba con observaciones.
insert into res values ('a2', pg_temp.reg(pg_temp.pl(pg_temp.id(100), pg_temp.hk('h2'), 'con_observaciones', 'crecimiento_alto', 'Revisar el crecimiento de MUJER')));
insert into r (caso, ok) values
  ('(3) con observaciones (motivo y comentario): se registra y es la vigente (cuenta como aprobacion)',
    pg_temp.rk('a2') ->> 'error' is null and pg_temp.rk('a2') ->> 'resultado' = 'con_observaciones' and pg_temp.rk('a2') ->> 'motivo' = 'crecimiento_alto'
    and pg_temp.rk('a2') ->> 'huella' = pg_temp.hk('h2') and pg_temp.napr(pg_temp.id(100)) = 2
    and pg_temp.estado_dir(pg_temp.id(100)) = 'con_observaciones');

-- (4) El planner la cierra sin tocar cifras: misma huella, sigue vigente.
update proyecciones set estado = 'cerrada', cerrada_at = now(), cerrada_por_nombre = 'Planner P.', cerrada_por_id = pg_temp.id(9002) where id = pg_temp.id(100);
insert into r (caso, ok) values
  ('(4) cerrar sin tocar cifras no cambia la huella: la aprobacion sigue vigente',
    pg_temp.h(pg_temp.id(100)) = pg_temp.hk('h2') and pg_temp.estado_dir(pg_temp.id(100)) = 'con_observaciones');

-- R25: foto de las tablas de la proyección cerrada antes de leer el tablero y de aprobarla.
create or replace function pg_temp.foto(proy uuid) returns text language sql as $f$
  select md5(
    (select md5(string_agg(p::text, '|' order by p.id)) from proyecciones p where p.id = proy)
    || (select md5(string_agg(f::text, '|' order by f.id)) from proyeccion_filas f where f.proyeccion_id = proy)
    || (select md5(string_agg(a::text, '|' order by a.id)) from proyeccion_fila_anios a join proyeccion_filas f on f.id = a.fila_id where f.proyeccion_id = proy)
    || (select md5(string_agg(t::text, '|' order by t.id)) from proyeccion_tiendas t where t.proyeccion_id = proy)
    || (select md5(string_agg(c::text, '|' order by c.id)) from proyeccion_crecimientos c where c.proyeccion_id = proy)
    || (select md5(string_agg(m::text, '|' order by m.carga_id, m.tienda_id, m.equivalencia_id, m.marca_id, m.agrupacion_talla_id)) from venta_stock_mensual m)) $f$;
insert into hu values ('foto', pg_temp.foto(pg_temp.id(100)));

insert into res values
  ('tp_cerrada', pg_temp.tp(pg_temp.id(100), '{"desglose": "linea"}'::jsonb)),
  ('tv_cerrada', (select pg_temp.tv(pv.b || jsonb_build_object('proyeccion_id', pg_temp.id(100), 'desglose', 'linea')) from pv)),
  ('a3', pg_temp.reg(pg_temp.pl(pg_temp.id(100), pg_temp.hk('h2')))),
  ('a4', pg_temp.reg(pg_temp.pl(pg_temp.id(100), pg_temp.hk('h2'), 'rechazada', 'otro', 'No se aprueba por ahora')));
insert into r (caso, ok) values
  ('aprobar la cerrada: estado_proyeccion = cerrada; el tablero de la cerrada trae la huella h2 y 2027 = 84 814 (la fila cambiada)',
    pg_temp.rk('a3') ->> 'estado_proyeccion' = 'cerrada' and pg_temp.rk('a3') ->> 'huella' = pg_temp.hk('h2')
    and pg_temp.rk('tp_cerrada') ->> 'huella' = pg_temp.hk('h2') and pg_temp.tot(pg_temp.rk('tp_cerrada'), 1) = 84814),
  ('R16: dos registros seguidos con la misma huella son dos filas de historial (a proposito no hay unico); manda la mas reciente (rechazada)',
    pg_temp.rk('a4') ->> 'error' is null and pg_temp.napr(pg_temp.id(100)) = 4
    and (select count(*) from aprobaciones_direccion where proyeccion_id = pg_temp.id(100) and huella = pg_temp.hk('h2')) = 3
    and pg_temp.estado_dir(pg_temp.id(100)) = 'rechazada'),
  ('R25: leer el tablero (proyeccion y venta) y aprobar no cambio ni un byte de las tablas de la proyeccion ni de la venta',
    pg_temp.foto(pg_temp.id(100)) = pg_temp.hk('foto'));

-- (7) Una copia sin cambios de la cerrada: misma huella, sin aprobación propia.
select pg_temp.copiar(pg_temp.id(100), pg_temp.id(102), 'Copia seguimiento H41') is not null as copia_creada;
insert into r (caso, ok) values
  ('(7) D9: una copia sin cambios (otros ids, sin lote ni autores) tiene la MISMA huella que la original',
    pg_temp.h(pg_temp.id(102)) = pg_temp.hk('h2') and pg_temp.tp(pg_temp.id(102), '{}'::jsonb) ->> 'huella' = pg_temp.hk('h2')),
  ('(7) la aprobacion NO se transfiere: la copia esta sin_aprobacion aunque su huella sea la de una aprobada',
    pg_temp.estado_dir(pg_temp.id(102)) = 'sin_aprobacion' and pg_temp.napr(pg_temp.id(102)) = 0
    and exists (select 1 from aprobaciones_direccion where huella = pg_temp.h(pg_temp.id(102)) and proyeccion_id <> pg_temp.id(102)));

-- Rechazos de estado: no encontrada, archivada, cálculo en curso (y uno caducado de 20 minutos no bloquea), sin calcular.
select pg_temp.copiar(pg_temp.id(100), pg_temp.id(103), 'Copia archivada H41') is not null as copia_creada;
update proyecciones set estado = 'archivada' where id = pg_temp.id(103);
select pg_temp.copiar(pg_temp.id(100), pg_temp.id(104), 'Copia calculando H41') is not null as copia_creada;
update proyecciones set calculando_desde = now() - interval '5 minutes' where id = pg_temp.id(104);
select pg_temp.copiar(pg_temp.id(100), pg_temp.id(105), 'Copia sin calcular H41') is not null as copia_creada;
update proyecciones set resumen = null where id = pg_temp.id(105);
select pg_temp.copiar(pg_temp.id(100), pg_temp.id(106), 'Copia inactiva H41') is not null as copia_creada;
update proyecciones set activo = false where id = pg_temp.id(106);
insert into res values
  ('e_no', pg_temp.reg(pg_temp.pl(pg_temp.id(999), pg_temp.hk('h2')))),
  ('e_nulo', pg_temp.reg(null)),
  ('e_arch', pg_temp.reg(pg_temp.pl(pg_temp.id(103), pg_temp.h(pg_temp.id(103))))),
  ('e_calc', pg_temp.reg(pg_temp.pl(pg_temp.id(104), pg_temp.h(pg_temp.id(104))))),
  ('e_sinc', pg_temp.reg(pg_temp.pl(pg_temp.id(105), pg_temp.h(pg_temp.id(105))))),
  ('e_inactiva', pg_temp.reg(pg_temp.pl(pg_temp.id(106), pg_temp.h(pg_temp.id(106)))));
update proyecciones set calculando_desde = now() - interval '20 minutes' where id = pg_temp.id(104);
insert into res values ('e_calc_caduco', pg_temp.reg(pg_temp.pl(pg_temp.id(104), pg_temp.h(pg_temp.id(104)))));
insert into r (caso, ok) values
  ('los codigos vuelven en el jsonb, sin excepcion: no_encontrada (tambien con p nulo), archivada, calculo_en_curso y sin_calcular; ninguno inserta',
    pg_temp.rk('e_no') = '{"error": "no_encontrada"}'::jsonb and pg_temp.rk('e_nulo') = '{"error": "no_encontrada"}'::jsonb
    and pg_temp.rk('e_arch') = '{"error": "archivada"}'::jsonb and pg_temp.rk('e_calc') = '{"error": "calculo_en_curso"}'::jsonb
    and pg_temp.rk('e_sinc') = '{"error": "sin_calcular"}'::jsonb
    and pg_temp.napr(pg_temp.id(103)) = 0 and pg_temp.napr(pg_temp.id(105)) = 0),
  ('una proyeccion INACTIVA (activo = false) se rechaza con el mismo codigo que una que no existe, aunque la huella coincida; no inserta',
    pg_temp.rk('e_inactiva') = '{"error": "no_encontrada"}'::jsonb and pg_temp.napr(pg_temp.id(106)) = 0
    and pg_temp.h(pg_temp.id(106)) = pg_temp.hk('h2')),
  ('un calculo de hace 20 minutos ya caduco (15 min): la aprobacion se registra',
    pg_temp.rk('e_calc_caduco') ->> 'error' is null and pg_temp.napr(pg_temp.id(104)) = 1);

-- Los `check` de la tabla (R18): por la función (zod ya validó; la base es la segunda barrera) y con un insert directo del dueño.
insert into res values
  ('c_rol', pg_temp.reg(pg_temp.pl(pg_temp.id(102), pg_temp.hk('h2'), 'aprobada', null, null, '{"rol": "planner"}'::jsonb))),
  ('c_motivo', pg_temp.reg(pg_temp.pl(pg_temp.id(102), pg_temp.hk('h2'), 'con_observaciones', null, 'Comentario suficiente'))),
  ('c_corto', pg_temp.reg(pg_temp.pl(pg_temp.id(102), pg_temp.hk('h2'), 'rechazada', 'otro', '  corto    '))),
  ('c_catalogo', pg_temp.reg(pg_temp.pl(pg_temp.id(102), pg_temp.hk('h2'), 'rechazada', 'porque_si', 'Comentario suficiente'))),
  ('c_resultado', pg_temp.reg(pg_temp.pl(pg_temp.id(102), pg_temp.hk('h2'), 'pendiente', 'otro', 'Comentario suficiente'))),
  ('c_largo', pg_temp.reg(pg_temp.pl(pg_temp.id(102), pg_temp.hk('h2'), 'aprobada', null, repeat('x', 1001)))),
  ('c_nombre', pg_temp.reg(pg_temp.pl(pg_temp.id(102), pg_temp.hk('h2'), 'aprobada', null, null, '{"usuario_nombre": ""}'::jsonb))),
  ('c_grande', pg_temp.reg(pg_temp.pl(pg_temp.id(102), pg_temp.hk('h2'), 'aprobada', null, null,
     jsonb_build_object('resumen', jsonb_build_object('huella', pg_temp.hk('h2'), 'relleno', (select jsonb_agg(md5(i::text)) from generate_series(1, 2500) i))))));
insert into r (caso, ok) values
  ('R18 check: un rol distinto de admin lo rechaza la tabla (23514)',
    pg_temp.rk('c_rol') ->> 'sqlstate' = '23514' and pg_temp.rk('c_rol') ->> 'msg' like '%aprobaciones_direccion_rol_check%'),
  ('R18 check: con_observaciones o rechazada exigen motivo del catalogo y comentario de 10 caracteres o mas (sin contar espacios de los lados)',
    pg_temp.rk('c_motivo') ->> 'msg' like '%aprobaciones_direccion_motivo_comentario_check%'
    and pg_temp.rk('c_corto') ->> 'msg' like '%aprobaciones_direccion_motivo_comentario_check%'
    and pg_temp.rk('c_catalogo') ->> 'msg' like '%aprobaciones_direccion_motivo_check%'),
  ('check: resultado fuera de catalogo, comentario de 1 001, usuario_nombre vacio y resumen de mas de 64 KB',
    pg_temp.rk('c_resultado') ->> 'msg' like '%aprobaciones_direccion_resultado_check%'
    and pg_temp.rk('c_largo') ->> 'msg' like '%aprobaciones_direccion_comentario_len_check%'
    and pg_temp.rk('c_nombre') ->> 'msg' like '%aprobaciones_direccion_usuario_nombre_len_check%'
    and pg_temp.rk('c_grande') ->> 'msg' like '%aprobaciones_direccion_resumen_tamano_check%'),
  ('check (insert directo del dueno): un resumen SIN huella no pasa (un `=` con NULL lo dejaria pasar), ni uno con otra huella, ni un arreglo',
    pg_temp.mensaje(format('insert into public.aprobaciones_direccion (proyeccion_id, anio_en_curso, estado_proyeccion, huella, resultado, resumen, usuario_nombre, rol) values (%L, 2026, ''cerrada'', %L, ''aprobada'', ''{"totales": []}'', ''x'', ''admin'')', pg_temp.id(102), pg_temp.hk('h2')))
      like '%aprobaciones_direccion_resumen_huella_check%'
    and pg_temp.mensaje(format('insert into public.aprobaciones_direccion (proyeccion_id, anio_en_curso, estado_proyeccion, huella, resultado, resumen, usuario_nombre, rol) values (%L, 2026, ''cerrada'', %L, ''aprobada'', %L, ''x'', ''admin'')', pg_temp.id(102), pg_temp.hk('h2'), jsonb_build_object('huella', pg_temp.hk('h1'))))
      like '%aprobaciones_direccion_resumen_huella_check%'
    and pg_temp.mensaje(format('insert into public.aprobaciones_direccion (proyeccion_id, anio_en_curso, estado_proyeccion, huella, resultado, resumen, usuario_nombre, rol) values (%L, 2026, ''cerrada'', %L, ''aprobada'', ''[]'', ''x'', ''admin'')', pg_temp.id(102), pg_temp.hk('h2')))
      like '%aprobaciones_direccion_resumen_%'),
  ('check (insert directo): huella mal formada, estado archivada y anio fuera de rango',
    pg_temp.mensaje(format('insert into public.aprobaciones_direccion (proyeccion_id, anio_en_curso, estado_proyeccion, huella, resultado, resumen, usuario_nombre, rol) values (%L, 2026, ''cerrada'', ''ABC'', ''aprobada'', ''{"huella": "ABC"}'', ''x'', ''admin'')', pg_temp.id(102)))
      like '%aprobaciones_direccion_huella_check%'
    and pg_temp.mensaje(format('insert into public.aprobaciones_direccion (proyeccion_id, anio_en_curso, estado_proyeccion, huella, resultado, resumen, usuario_nombre, rol) values (%L, 2026, ''archivada'', %L, ''aprobada'', %L, ''x'', ''admin'')', pg_temp.id(102), pg_temp.hk('h2'), jsonb_build_object('huella', pg_temp.hk('h2'))))
      like '%aprobaciones_direccion_estado_proyeccion_check%'
    and pg_temp.mensaje(format('insert into public.aprobaciones_direccion (proyeccion_id, anio_en_curso, estado_proyeccion, huella, resultado, resumen, usuario_nombre, rol) values (%L, 2023, ''cerrada'', %L, ''aprobada'', %L, ''x'', ''admin'')', pg_temp.id(102), pg_temp.hk('h2'), jsonb_build_object('huella', pg_temp.hk('h2'))))
      like '%aprobaciones_direccion_anio_check%'),
  ('ninguno de los rechazos dejo fila: la copia 102 sigue sin aprobaciones',
    pg_temp.napr(pg_temp.id(102)) = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Inmutabilidad (R17), FK y lo que ve cada rol
-- ---------------------------------------------------------------------------------------------------------------------
create temp table antes as select md5(string_agg((to_jsonb(a) - 'perfil_id' - 'updated_at')::text, '|' order by a.id)) as h, count(*) as n from aprobaciones_direccion a;
insert into r (caso, ok) values
  ('(6) R17: como DUENO, update, delete y truncate fallan con restrict_violation (23001) y el mensaje de registro inmutable',
    pg_temp.estado(format('update public.aprobaciones_direccion set comentario = ''cambiado'' where id = %L', pg_temp.rk('a1') ->> 'id')) = '23001'
    and pg_temp.estado(format('update public.aprobaciones_direccion set resultado = ''aprobada'' where id = %L', pg_temp.rk('a4') ->> 'id')) = '23001'
    and pg_temp.estado(format('delete from public.aprobaciones_direccion where id = %L', pg_temp.rk('a1') ->> 'id')) = '23001'
    and pg_temp.estado('truncate public.aprobaciones_direccion') = '23001'
    and pg_temp.mensaje(format('update public.aprobaciones_direccion set activo = false where id = %L', pg_temp.rk('a1') ->> 'id')) = 'aprobaciones_direccion es un registro inmutable'),
  ('R17: el dueno tampoco puede cambiar perfil_id a OTRO perfil, ni ponerlo en null cambiando algo mas a la vez',
    pg_temp.estado(format('update public.aprobaciones_direccion set perfil_id = %L where id = %L', pg_temp.id(9002), pg_temp.rk('a1') ->> 'id')) = '23001'
    and pg_temp.estado(format('update public.aprobaciones_direccion set perfil_id = null, usuario_nombre = ''Otro'' where id = %L', pg_temp.rk('a1') ->> 'id')) = '23001'),
  ('R17: como service_role, update, delete y truncate fallan por PRIVILEGIO (42501) antes de llegar al trigger',
    pg_temp.estado(format('update public.aprobaciones_direccion set comentario = ''cambiado'' where id = %L', pg_temp.rk('a1') ->> 'id'), 'service_role') = '42501'
    and pg_temp.estado(format('delete from public.aprobaciones_direccion where id = %L', pg_temp.rk('a1') ->> 'id'), 'service_role') = '42501'
    and pg_temp.estado('truncate public.aprobaciones_direccion', 'service_role') = '42501'),
  ('service_role lee la tabla (BYPASSRLS); anon y authenticated no pueden ni leerla ni insertar (42501)',
    pg_temp.estado('select count(*) from public.aprobaciones_direccion', 'service_role') = 'ok'
    and pg_temp.estado('select count(*) from public.aprobaciones_direccion', 'anon') = '42501'
    and pg_temp.estado('select count(*) from public.aprobaciones_direccion', 'authenticated') = '42501'
    and pg_temp.estado(format('insert into public.aprobaciones_direccion (proyeccion_id, anio_en_curso, estado_proyeccion, huella, resultado, resumen, usuario_nombre, rol) values (%L, 2026, ''cerrada'', %L, ''aprobada'', %L, ''x'', ''admin'')', pg_temp.id(102), pg_temp.hk('h2'), jsonb_build_object('huella', pg_temp.hk('h2'))), 'authenticated') = '42501'),
  ('R20: una proyeccion con aprobaciones no se puede borrar (FK restrict: 23503 en PostgreSQL 16 y 17, 23001 desde el 18), tampoco con service_role',
    pg_temp.estado(format('delete from public.proyecciones where id = %L', pg_temp.id(100))) in ('23503', '23001')
    and pg_temp.estado(format('delete from public.proyecciones where id = %L', pg_temp.id(100)), 'service_role') in ('23503', '23001')
    and pg_temp.mensaje(format('delete from public.proyecciones where id = %L', pg_temp.id(100))) like '%aprobaciones_direccion_proyeccion_id_fkey%');
-- El borrado va en su propia sentencia: una consulta no ve lo que cambia una funcion llamada dentro de ella misma.
insert into res values ('del105', to_jsonb(pg_temp.estado(format('delete from public.proyecciones where id = %L', pg_temp.id(105)), 'service_role')));
insert into r (caso, ok) values
  ('R20: una proyeccion SIN aprobaciones se borra como siempre (la de las aprobaciones sigue ahi)',
    pg_temp.rk('del105') = '"ok"'::jsonb
    and exists (select 1 from proyecciones where id = pg_temp.id(100)) and not exists (select 1 from proyecciones where id = pg_temp.id(105)));

-- Usuario aprobador eliminado: la FK pone perfil_id en NULL (corre con los privilegios del dueño de la tabla) y el resto queda igual.
insert into res values ('borra_perfil', to_jsonb(pg_temp.estado(format('delete from auth.users where id = %L', pg_temp.id(9001)))));
insert into r (caso, ok) values
  ('R17 excepcion: al eliminar al usuario aprobador, perfil_id pasa a NULL en sus aprobaciones (el trigger lo deja pasar) y quedan nombre y rol',
    pg_temp.rk('borra_perfil') = '"ok"'::jsonb
    and not exists (select 1 from perfiles where id = pg_temp.id(9001))
    and (select count(*) from aprobaciones_direccion where perfil_id is not null) = 0
    and (select count(*) from aprobaciones_direccion where usuario_nombre = 'Admin A.' and rol = 'admin') = (select n from antes)),
  ('al final el historial esta completo e intacto: mismas filas y mismo contenido (salvo perfil_id), 5 aprobaciones en total',
    (select md5(string_agg((to_jsonb(a) - 'perfil_id' - 'updated_at')::text, '|' order by a.id)) from aprobaciones_direccion a) = (select h from antes)
    and pg_temp.napr() = (select n from antes) and pg_temp.napr() = 5);

-- ---------------------------------------------------------------------------------------------------------------------
-- Resultado
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- comprobaciones (esperado: todas las filas ok = t)'
select n, caso, ok from r order by n;
\echo '--- resumen (esperado: fallos = 0)'
select count(*) as comprobaciones, count(*) filter (where not ok) as fallos, count(*) filter (where ok is null) as sin_resultado from r;

rollback;
