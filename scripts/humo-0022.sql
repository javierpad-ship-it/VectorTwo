-- Humo SQL de la migración 0022 (M6 06c, composición de la agrupación y curva del usuario): las columnas
-- `curvas_estacionalidad.origen_curva` y `curva_manual` con sus checks de coherencia, y la función
-- `venta_composicion_agrupacion(p_agrupacion_id, p_red, p_hasta)`.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0022.sql"
--
-- Como humo-0021.sql, NO necesita fixture previo: carga el suyo (agrupaciones HUMOA y HUMOB; dos GML; equivalencias activas,
-- una desactivada y una sin agrupación; tiendas T1, T2, T3; cargas 2025-01 a 2025-03 y 2026-01 más una en curso). Todo
-- inventado: nada de datos reales de Lukers.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Cada comprobación imprime `ok = t`;
-- un `ok = f` es un fallo. Los casos de checks que DEBEN fallar se prueban dentro de un bloque `do` con `exception` (es un
-- script de prueba local, no una migración): imprimen `ok = t` cuando la base los rechaza.
-- Nota local: el rol `service_role` del clúster local no tiene BYPASSRLS, así que se lee como `postgres` y los permisos de
-- `service_role` se comprueban con has_function_privilege.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into generos (codigo, nombre) values ('HUMOH', 'HOMBRE HUMO');
insert into mundos (codigo, nombre) values ('HUMOU', 'URBANO HUMO');
insert into lineas (codigo, nombre, temporada) values
  ('HUMOL1', 'LINEA UNO HUMO', 'Todo el año'), ('HUMOL2', 'LINEA DOS HUMO', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML'
from lineas l
join generos g on g.codigo = 'HUMOH'
join mundos mu on mu.codigo = 'HUMOU'
where l.codigo in ('HUMOL1', 'HUMOL2');
insert into agrupaciones_estacionalidad (codigo, nombre) values ('HUMOA', 'AGRUPACION A HUMO'), ('HUMOB', 'AGRUPACION B HUMO');

-- E1, E2 (desactivada) y E4 en A; E3 en B (mismo GML que E1: "también en otras agrupaciones"); E5 sin agrupación.
insert into equivalencias (genero_mundo_linea_id, codigo, nombre, agrupacion_estacionalidad_id, activo)
select n.id, x.cod, x.cod, a.id, x.act
from (values
  ('HUMOL1', 'HUMO-E1', 'HUMOA', true),
  ('HUMOL1', 'HUMO-E2', 'HUMOA', false),
  ('HUMOL1', 'HUMO-E3', 'HUMOB', true),
  ('HUMOL2', 'HUMO-E4', 'HUMOA', true),
  ('HUMOL1', 'HUMO-E5', null,    true)
) as x(lin, cod, agr, act)
join lineas l on l.codigo = x.lin
join genero_mundo_linea n on n.linea_id = l.id
left join agrupaciones_estacionalidad a on a.codigo = x.agr;

insert into agrupaciones_marca (codigo, nombre) values ('HUMOPREM', 'PREMIUM HUMO');
insert into agrupaciones_talla (codigo, nombre) values ('HUMOCEN', 'CENTRALES HUMO'), ('HUMOEXT', 'EXTREMAS HUMO');
insert into tiendas (codigo, nombre, tipo) values
  ('HUMOT1', 'T1', 'Tienda'), ('HUMOT2', 'T2', 'Tienda'), ('HUMOT3', 'T3', 'Tienda');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select 'HUMOALFA', 'HUMOALFA', a.id from agrupaciones_marca a where a.codigo = 'HUMOPREM';

insert into cargas_venta_stock (periodo, estado, publicada_at) values
  ('2025-01-01', 'publicada', now()), ('2025-02-01', 'publicada', now()), ('2025-03-01', 'publicada', now()),
  ('2026-01-01', 'publicada', now());
-- Una carga en curso de febrero: no debe contar (la vista solo ve las publicadas).
insert into cargas_venta_stock (periodo, estado) values ('2025-02-01', 'en_curso');

insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, stock_unidades)
select c.id, t.id, e.id, m.id, tl.id, x.unid, 0
from (values
  -- E1 en T1 enero: dos tallas (6 + 4 = 10) para probar que se agrega antes de cruzar con la red.
  ('2025-01-01', 'HUMO-E1', 'HUMOT1', 'HUMOCEN',   6),
  ('2025-01-01', 'HUMO-E1', 'HUMOT1', 'HUMOEXT',   4),
  ('2025-01-01', 'HUMO-E1', 'HUMOT2', 'HUMOCEN',   5),
  -- T3 no está en la red de 2025: su venta NO entra en nodos ni equivalencias.
  ('2025-01-01', 'HUMO-E1', 'HUMOT3', 'HUMOCEN', 100),
  -- E2 está desactivada pero sigue apuntando a A: su venta cuenta (igual que la 0017).
  ('2025-01-01', 'HUMO-E2', 'HUMOT1', 'HUMOCEN',   3),
  ('2025-01-01', 'HUMO-E4', 'HUMOT1', 'HUMOCEN',   7),
  ('2025-02-01', 'HUMO-E1', 'HUMOT1', 'HUMOCEN',  20),
  ('2025-02-01', 'HUMO-E4', 'HUMOT2', 'HUMOCEN',   8),
  -- E3 es del mismo GML que E1 pero de la agrupación B: va a `otras` (todas las tiendas, sin filtro de red).
  ('2025-02-01', 'HUMO-E3', 'HUMOT1', 'HUMOCEN',  50),
  ('2025-03-01', 'HUMO-E1', 'HUMOT1', 'HUMOCEN',  30),
  ('2025-03-01', 'HUMO-E3', 'HUMOT3', 'HUMOCEN',  40),
  -- E5 no tiene agrupación: no cuenta ni en la agrupación ni en `otras`.
  ('2025-03-01', 'HUMO-E5', 'HUMOT1', 'HUMOCEN', 999),
  -- 2026-01: año que no está en p_red -> sin filas de ese año en nodos ni equivalencias.
  ('2026-01-01', 'HUMO-E1', 'HUMOT1', 'HUMOCEN', 1000)
) as x(mes, eq, tie, tal, unid)
join cargas_venta_stock c on c.periodo = x.mes::date and c.estado = 'publicada'
join marcas m on m.codigo = 'HUMOALFA'
join equivalencias e on e.codigo = x.eq
join tiendas t on t.codigo = x.tie
join agrupaciones_talla tl on tl.codigo = x.tal;
-- Hecho de la carga en curso: no debe aparecer.
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, stock_unidades)
select c.id, t.id, e.id, m.id, tl.id, 999, 0
from cargas_venta_stock c, tiendas t, equivalencias e, marcas m, agrupaciones_talla tl
where c.estado = 'en_curso' and t.codigo = 'HUMOT1' and e.codigo = 'HUMO-E1' and m.codigo = 'HUMOALFA' and tl.codigo = 'HUMOCEN';

-- Redes de prueba.
create temp table redes as
select
  (select jsonb_build_object('2025', jsonb_agg(id order by codigo)) from tiendas where codigo in ('HUMOT1', 'HUMOT2')) as t12,
  (select jsonb_build_object('2025', jsonb_agg(id order by codigo), '2026', jsonb_agg(id order by codigo))
     from tiendas where codigo in ('HUMOT1', 'HUMOT2', 'HUMOT3')) as todas;

create temp table r as
select public.venta_composicion_agrupacion(a.id, redes.t12, date '2026-01-01') x
from agrupaciones_estacionalidad a, redes where a.codigo = 'HUMOA';
create temp table r_feb as
select public.venta_composicion_agrupacion(a.id, redes.t12, date '2025-02-01') x
from agrupaciones_estacionalidad a, redes where a.codigo = 'HUMOA';

create temp table n as
select (e->>'gml_id')::uuid gml, (e->>'periodo')::date per, (e->>'unidades')::bigint u,
       (select l.codigo from genero_mundo_linea g join lineas l on l.id = g.linea_id where g.id = (e->>'gml_id')::uuid) lin
from r, jsonb_array_elements(x->'nodos') e;
create temp table q as
select (e->>'equivalencia_id')::uuid eq, (e->>'anio')::int anio, (e->>'unidades')::bigint u,
       (select codigo from equivalencias where id = (e->>'equivalencia_id')::uuid) eq_cod
from r, jsonb_array_elements(x->'equivalencias') e;
create temp table o as
select (e->>'gml_id')::uuid gml, (e->>'agrupacion_id')::uuid agr, (e->>'anio')::int anio, (e->>'unidades')::bigint u,
       (select codigo from agrupaciones_estacionalidad where id = (e->>'agrupacion_id')::uuid) agr_cod
from r, jsonb_array_elements(x->'otras') e;

-- ---------------------------------------------------------------------------------------------------------------------
-- Función: forma del documento
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- claves del documento: cargas, equivalencias, nodos, otras (esperado ok = t)'
select (select string_agg(k, ',' order by k) from r, jsonb_object_keys(x) k) = 'cargas,equivalencias,nodos,otras' as ok;

\echo '--- nodos: 5 filas GML x mes (L1: ene 18 = 6+4+5+3, feb 20, mar 30; L2: ene 7, feb 8) (esperado ok = t)'
select (select count(*) from n) = 5
   and (select u from n where lin = 'HUMOL1' and per = date '2025-01-01') = 18
   and (select u from n where lin = 'HUMOL1' and per = date '2025-02-01') = 20
   and (select u from n where lin = 'HUMOL1' and per = date '2025-03-01') = 30
   and (select u from n where lin = 'HUMOL2' and per = date '2025-01-01') = 7
   and (select u from n where lin = 'HUMOL2' and per = date '2025-02-01') = 8 as ok;

\echo '--- T3 fuera de la red de 2025 (100 en enero) y 2026 ausente de p_red (1000): no entran; el total es 83 (esperado ok = t)'
select (select sum(u) from n) = 83 and (select count(*) from n where per >= date '2026-01-01') = 0 as ok;

\echo '--- equivalencias: E1 2025 = 65, E2 (desactivada) 2025 = 3, E4 2025 = 15; sin E3 ni E5; nada de 2026 (esperado ok = t)'
select (select count(*) from q) = 3
   and (select u from q where eq_cod = 'HUMO-E1' and anio = 2025) = 65
   and (select u from q where eq_cod = 'HUMO-E2' and anio = 2025) = 3
   and (select u from q where eq_cod = 'HUMO-E4' and anio = 2025) = 15
   and (select sum(u) from q) = (select sum(u) from n) as ok;

\echo '--- otras: el GML de L1 vende 90 (50 + 40) en la agrupacion B en 2025, sin filtro de red; ninguna fila de A; E5 (sin agrupacion) no cuenta (esperado ok = t)'
select (select count(*) from o) = 1
   and (select u from o where agr_cod = 'HUMOB' and anio = 2025) = 90
   and (select count(*) from o where agr_cod = 'HUMOA') = 0 as ok;

\echo '--- cargas: 4 periodos publicados (la carga en curso no cuenta) y es igual a la de venta_estacionalidad_agrupacion (esperado ok = t)'
select (select count(*) from r, jsonb_object_keys(x->'cargas')) = 4
   and (select x->'cargas' from r) = (select public.venta_estacionalidad_agrupacion(a.id)->'cargas' from agrupaciones_estacionalidad a where a.codigo = 'HUMOA') as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- Función: p_hasta, p_red nulo o vacío, año ausente
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- p_hasta = 2025-02-01: sin marzo; total nodos 53 y otras sin la venta de marzo (50) (esperado ok = t)'
select (select max((e->>'periodo')::date) from r_feb, jsonb_array_elements(x->'nodos') e) = date '2025-02-01'
   and (select sum((e->>'unidades')::bigint) from r_feb, jsonb_array_elements(x->'nodos') e) = 53
   and (select sum((e->>'unidades')::bigint) from r_feb, jsonb_array_elements(x->'otras') e) = 50 as ok;

\echo '--- p_red nulo, vacio, no objeto o con tiendas vacias: nodos y equivalencias vacios; otras y cargas siguen (esperado ok = t)'
select bool_and(jsonb_array_length(v->'nodos') = 0 and jsonb_array_length(v->'equivalencias') = 0
                and jsonb_array_length(v->'otras') = 1 and (select count(*) from jsonb_object_keys(v->'cargas')) = 4) as ok
from (
  select public.venta_composicion_agrupacion(a.id, p, date '2026-01-01') v
  from agrupaciones_estacionalidad a,
       (values (null::jsonb), ('{}'::jsonb), ('[]'::jsonb), ('{"2025": []}'::jsonb)) as t(p)
  where a.codigo = 'HUMOA'
) z;

\echo '--- p_agrupacion_id nulo y p_hasta nulo: sin filas y sin error (esperado ok = t)'
select jsonb_array_length(public.venta_composicion_agrupacion(null, redes.t12, date '2026-01-01')->'nodos') = 0
   and jsonb_array_length((select public.venta_composicion_agrupacion(a.id, redes.t12, null)->'nodos' from agrupaciones_estacionalidad a where a.codigo = 'HUMOA')) = 0 as ok
from redes;

\echo '--- red con todas las tiendas en 2025 y 2026: cada mes suma lo mismo que `agrupacion` de venta_estacionalidad_agrupacion (esperado ok = t)'
select count(*) = 4 and bool_and(c.u = a.u) as ok
from (
  select (e->>'periodo')::date p, sum((e->>'unidades')::bigint) u
  from (select public.venta_composicion_agrupacion(g.id, redes.todas, date '2026-01-01') j
        from agrupaciones_estacionalidad g, redes where g.codigo = 'HUMOA') s, jsonb_array_elements(s.j->'nodos') e
  group by 1
) c
join (
  select (e->>'periodo')::date p, sum((e->>'unidades')::bigint) u
  from (select public.venta_estacionalidad_agrupacion(g.id) j from agrupaciones_estacionalidad g where g.codigo = 'HUMOA') s,
       jsonb_array_elements(s.j->'agrupacion') e
  group by 1
) a using (p);

\echo '--- permisos: anon y authenticated no pueden ejecutarla; service_role si (esperado ok = t)'
select not has_function_privilege('anon', 'public.venta_composicion_agrupacion(uuid, jsonb, date)', 'execute')
   and not has_function_privilege('authenticated', 'public.venta_composicion_agrupacion(uuid, jsonb, date)', 'execute')
   and has_function_privilege('service_role', 'public.venta_composicion_agrupacion(uuid, jsonb, date)', 'execute') as ok;

\echo '--- propiedades: stable, security invoker, search_path vacio (esperado ok = t)'
select provolatile = 's' and not prosecdef and proconfig = array['search_path=""'] as ok
from pg_proc where proname = 'venta_composicion_agrupacion';

-- ---------------------------------------------------------------------------------------------------------------------
-- Columnas y checks de coherencia de curvas_estacionalidad
-- ---------------------------------------------------------------------------------------------------------------------
insert into corridas_estacionalidad (hasta_periodo, parametros, resultado, resumen, agrupacion_estacionalidad_id)
select date '2026-01-01', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, a.id from agrupaciones_estacionalidad a where a.codigo = 'HUMOA';

\echo '--- columnas: origen_curva text not null default sistema; curva_manual jsonb nullable (esperado ok = t)'
select (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'curvas_estacionalidad'
          and ((column_name = 'origen_curva' and data_type = 'text' and is_nullable = 'NO' and column_default like '''sistema''%')
            or (column_name = 'curva_manual' and data_type = 'jsonb' and is_nullable = 'YES'))) = 2 as ok;

-- Cada caso intenta insertar una curva con una combinación (modelo, origen_curva, curva_manual) y compara lo que ocurrió
-- con lo esperado. Las curvas se insertan 'reemplazada' y con versión propia: no chocan con el único de vigente.
create temp table casos (n int, caso text, modelo text, origen_curva text, curva_manual text, esperado_ok boolean, ok boolean);
insert into casos (n, caso, modelo, origen_curva, curva_manual, esperado_ok) values
  (1,  'modelo A, sistema, sin curva_manual',                'A', 'sistema',  null,         true),
  (2,  'modelo T, sistema, sin curva_manual',                'T', 'sistema',  null,         true),
  (3,  'modelo F, avanzada, sin curva_manual',               'F', 'avanzada', null,         true),
  (4,  'modelo U, usuario, curva_manual objeto',             'U', 'usuario',  '{"a":1}',    true),
  (5,  'modelo U con origen_curva sistema',                  'U', 'sistema',  null,         false),
  (6,  'modelo A con origen_curva usuario',                  'A', 'usuario',  '{"a":1}',    false),
  (7,  'modelo A con origen_curva avanzada',                 'A', 'avanzada', null,         false),
  (8,  'modelo F con origen_curva sistema',                  'F', 'sistema',  null,         false),
  (9,  'curva_manual no nulo con origen_curva sistema',      'A', 'sistema',  '{"a":1}',    false),
  (10, 'origen_curva usuario con curva_manual nulo',         'U', 'usuario',  null,         false),
  (11, 'curva_manual que no es objeto (arreglo)',            'U', 'usuario',  '[1,2]',      false),
  (12, 'curva_manual que no es objeto (numero)',             'U', 'usuario',  '5',          false),
  (13, 'origen_curva fuera de la lista',                     'A', 'otro',     null,         false),
  (14, 'modelo U, avanzada y curva_manual (cruce)',          'U', 'avanzada', '{"a":1}',    false);

do $$
declare
  c record;
  v_agr uuid := (select id from public.agrupaciones_estacionalidad where codigo = 'HUMOA');
  v_corrida uuid := (select id from public.corridas_estacionalidad limit 1);
  v_aceptada boolean;
begin
  for c in select * from casos order by n loop
    begin
      insert into public.curvas_estacionalidad
        (agrupacion_estacionalidad_id, version, estado, corrida_id, modelo, origen, origen_curva, curva_manual, recomendada,
         anios_utilizados, medida, p01, p02, p03, p04, p05, p06, p07, p08, p09, p10, p11, p12)
      values
        (v_agr, 100 + c.n, 'reemplazada', v_corrida, c.modelo, 'propia', c.origen_curva, c.curva_manual::jsonb, false,
         '[]'::jsonb, 'unidades', 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.12);
      v_aceptada := true;
    exception when check_violation then
      v_aceptada := false;
    end;
    update casos set ok = (v_aceptada = esperado_ok) where n = c.n;
  end loop;
end
$$;

\echo '--- coherencia de checks: cada caso se acepta o se rechaza como corresponde (esperado: todas las filas ok = t)'
select n, caso, esperado_ok as debe_aceptarse, ok from casos order by n;

\echo '--- sin indicar origen_curva ni curva_manual: la fila queda sistema y sin curva_manual (el default; esperado ok = t)'
insert into curvas_estacionalidad
  (agrupacion_estacionalidad_id, version, estado, corrida_id, modelo, origen, recomendada, anios_utilizados, medida,
   p01, p02, p03, p04, p05, p06, p07, p08, p09, p10, p11, p12)
select a.id, 200, 'vigente', (select id from corridas_estacionalidad limit 1), 'B', 'propia', true, '[]'::jsonb, 'unidades',
       0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.08, 0.12
from agrupaciones_estacionalidad a where a.codigo = 'HUMOA';
select origen_curva = 'sistema' and curva_manual is null as ok from curvas_estacionalidad where version = 200;

\echo '--- ninguna fila quedo incoherente (modelo U <=> usuario, F <=> avanzada, curva_manual <=> usuario) (esperado ok = t)'
select count(*) > 0
   and bool_and((origen_curva = 'usuario') = (modelo = 'U'))
   and bool_and((origen_curva = 'avanzada') = (modelo = 'F'))
   and bool_and((curva_manual is not null) = (origen_curva = 'usuario')) as ok
from curvas_estacionalidad;

\echo '--- RLS activo en curvas_estacionalidad (esperado ok = t)'
select relrowsecurity as ok from pg_class where oid = 'public.curvas_estacionalidad'::regclass;

rollback;
