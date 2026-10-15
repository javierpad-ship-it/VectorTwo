-- Humo SQL de las migraciones 0019 (M12 · análisis de marcas al barrer y modalidad mixta) y 0020 (M13 · intercompany).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0019-0020.sql"
--
-- A diferencia de humo-0018.sql, este humo NO necesita fixture previo: carga el suyo (marcas ALFA, BETA, BETA UNO, GAMMA,
-- DELTA, OMEGA; nodos DENIM, POLO, SANDALIA y CAMISA como GMLE; tiendas T01, T02 y el CD; cargas 2026-07 a 2026-09).
-- Todo inventado: nada de datos reales de Lukers.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Las sentencias que DEBEN fallar van
-- entre `savepoint` y `rollback to savepoint`, de modo que el error es el resultado esperado y el resto sigue corriendo
-- (`ON_ERROR_STOP off` es a propósito). Cada comprobación positiva imprime `ok = t`; cada negativa deja un `ERROR:` en la
-- salida, precedido por un `\echo` que lo anuncia. Un `ok = f` o un `ERROR:` sin anunciar es un fallo.
--
-- Nota local: el rol `service_role` del clúster local NO tiene BYPASSRLS (en Supabase sí), así que las lecturas de datos se
-- hacen como `postgres` (superusuario) y los permisos de `service_role` se comprueban con has_*_privilege.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into generos (codigo, nombre) values ('HUMOH', 'HOMBRE HUMO'), ('HUMOM', 'MUJER HUMO');
insert into mundos (codigo, nombre) values ('HUMOU', 'URBANO HUMO'), ('HUMOC', 'CASUAL HUMO');
insert into lineas (codigo, nombre, temporada) values
  ('HUMODENIM', 'DENIM HUMO', 'Todo el año'), ('HUMOPOLO', 'POLO HUMO', 'Todo el año'),
  ('HUMOSAND', 'SANDALIA HUMO', 'Todo el año'), ('HUMOCAM', 'CAMISA HUMO', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, x.nivel
from (values
  ('HUMOH', 'HUMOU', 'HUMODENIM', 'GML'),
  ('HUMOH', 'HUMOC', 'HUMOPOLO', 'GML'),
  ('HUMOM', 'HUMOC', 'HUMOSAND', 'GML'),
  ('HUMOH', 'HUMOU', 'HUMOCAM', 'GMLE')
) as x(g, mu, l, nivel)
join generos g on g.codigo = x.g
join mundos mu on mu.codigo = x.mu
join lineas l on l.codigo = x.l;
insert into equivalencias (genero_mundo_linea_id, codigo, nombre)
select n.id, x.cod, x.nom
from (values
  ('HUMODENIM', 'HUMO-SKINNY', 'SKINNY HUMO'), ('HUMODENIM', 'HUMO-RECTO', 'RECTO HUMO'),
  ('HUMOPOLO', 'HUMO-POLO1', 'POLO BASICO HUMO'), ('HUMOSAND', 'HUMO-SAND1', 'SANDALIA PLANA HUMO'),
  ('HUMOCAM', 'HUMO-ML', 'MANGA LARGA HUMO'), ('HUMOCAM', 'HUMO-MC', 'MANGA CORTA HUMO')
) as x(lin, cod, nom)
join lineas l on l.codigo = x.lin
join genero_mundo_linea n on n.linea_id = l.id;
insert into agrupaciones_marca (codigo, nombre) values ('HUMOPREM', 'PREMIUM HUMO'), ('HUMORECO', 'RECONOCIDO HUMO');
insert into agrupaciones_talla (codigo, nombre) values ('HUMOCEN', 'CENTRALES HUMO'), ('HUMOEXT', 'EXTREMAS HUMO');
insert into tiendas (codigo, nombre, tipo) values
  ('HUMOT01', 'Tienda 01', 'Tienda'), ('HUMOT02', 'Tienda 02', 'Tienda'),
  ('HUMOCD', 'Centro de distribucion', 'Centro de Distribución');
insert into marcas (codigo, nombre, agrupacion_marca_id, tratamiento_especial, modalidad_tratamiento, resto_al_barrer)
select x.cod, x.cod, a.id, x.esp, x.modal, x.resto
from (values
  ('HUMOBETA',  'HUMOPREM', true,  'barrido', false),
  ('HUMOALFA',  'HUMORECO', true,  'por_gml', false),
  ('HUMOGAMMA', 'HUMORECO', true,  'por_gml', true),
  ('HUMODELTA', 'HUMOPREM', true,  null,      false),
  ('HUMOOMEGA', 'HUMORECO', false, null,      false)
) as x(cod, agr, esp, modal, resto)
join agrupaciones_marca a on a.codigo = x.agr;
-- BETA UNO es miembro del conjunto de BETA: su venta cuenta en BETA.
insert into marcas (codigo, nombre, agrupacion_marca_id, conjunto_marca_id)
select 'HUMOBETAUNO', 'HUMOBETAUNO', a.id, b.id
from agrupaciones_marca a, marcas b where a.codigo = 'HUMOPREM' and b.codigo = 'HUMOBETA';
-- GML específicos: ALFA en DENIM (por_gml) y GAMMA (mixta) en CAMISA.
insert into marca_gml_especial (marca_id, genero_mundo_linea_id)
select m.id, n.id
from (values ('HUMOALFA', 'HUMODENIM'), ('HUMOGAMMA', 'HUMOCAM')) as x(mar, lin)
join marcas m on m.codigo = x.mar
join lineas l on l.codigo = x.lin
join genero_mundo_linea n on n.linea_id = l.id;
-- Cargas: tres publicadas y una en curso del mismo mes (que no debe contar).
insert into cargas_venta_stock (periodo, estado, publicada_at) values
  ('2026-07-01', 'publicada', now()), ('2026-08-01', 'publicada', now()), ('2026-09-01', 'publicada', now());
insert into cargas_venta_stock (periodo, estado) values ('2026-09-01', 'en_curso');
-- Hechos. BETA en DENIM se parte en dos tallas para comprobar que la función las suma (sin talla en la salida).
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades)
select c.id, t.id, e.id, m.id, tl.id, x.unid
from (values
  -- marca, equivalencia (codigo), tienda, talla, unidades por mes
  ('HUMOBETA',     'HUMO-SKINNY',   'HUMOT01', 'HUMOCEN', 60),
  ('HUMOBETA',     'HUMO-RECTO',    'HUMOT01', 'HUMOEXT', 40),
  ('HUMOBETA',     'HUMO-POLO1',    'HUMOT02', 'HUMOCEN', 50),
  ('HUMOBETAUNO',  'HUMO-SAND1',    'HUMOT01', 'HUMOCEN', 20),
  ('HUMOBETA',     'HUMO-SKINNY',   'HUMOCD',  'HUMOCEN', 30),
  ('HUMOALFA',     'HUMO-SKINNY',   'HUMOT01', 'HUMOCEN', 200),
  ('HUMOGAMMA',    'HUMO-ML',       'HUMOT01', 'HUMOCEN', 40),
  ('HUMOGAMMA',    'HUMO-MC',       'HUMOT01', 'HUMOCEN', 10),
  ('HUMOGAMMA',    'HUMO-SKINNY',   'HUMOT01', 'HUMOCEN', 60)
) as x(mar, eq, tie, tal, unid)
join marcas m on m.codigo = x.mar
join equivalencias e on e.codigo = x.eq
join tiendas t on t.codigo = x.tie
join agrupaciones_talla tl on tl.codigo = x.tal
cross join cargas_venta_stock c
where c.estado = 'publicada';
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades)
select c.id, t.id, e.id, m.id, tl.id, 999
from cargas_venta_stock c, tiendas t, equivalencias e, marcas m, agrupaciones_talla tl
where c.estado = 'en_curso' and t.codigo = 'HUMOT01' and e.codigo = 'HUMO-SKINNY' and m.codigo = 'HUMOBETA' and tl.codigo = 'HUMOCEN';

-- ---------------------------------------------------------------------------------------------------------------------
-- 0019 · columna `resto_al_barrer`
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- marcas.resto_al_barrer: todas nacen en false menos GAMMA (fixture); default false (esperado ok = t)'
select 'default false' as prueba,
  (select column_default from information_schema.columns where table_name = 'marcas' and column_name = 'resto_al_barrer') = 'false' as ok;
\echo '--- check: resto_al_barrer = true con modalidad barrido (esperado ERROR marcas_resto_al_barrer_check)'
savepoint s;
update marcas set resto_al_barrer = true where codigo = 'HUMOBETA';
rollback to savepoint s;
\echo '--- check: resto_al_barrer = true con casilla sin modalidad (esperado ERROR marcas_resto_al_barrer_check)'
savepoint s;
update marcas set resto_al_barrer = true where codigo = 'HUMODELTA';
rollback to savepoint s;
\echo '--- check: resto_al_barrer = true sin casilla (esperado ERROR; la casilla en false con modalidad ya lo impide 0010)'
savepoint s;
update marcas set resto_al_barrer = true where codigo = 'HUMOOMEGA';
rollback to savepoint s;
\echo '--- check: apagar la bandera de la mixta y volver a encenderla SI se permite (esperado ok = t)'
savepoint s;
update marcas set resto_al_barrer = false where codigo = 'HUMOGAMMA';
update marcas set resto_al_barrer = true where codigo = 'HUMOGAMMA';
select 'mixta reencendida' as prueba, resto_al_barrer as ok from marcas where codigo = 'HUMOGAMMA';
release savepoint s;

-- ---------------------------------------------------------------------------------------------------------------------
-- 0019 · vista `marca_gml_especial_vigente` (dos filas por mixta)
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- vista: BETA 1 fila (barrido, GML nulo); GAMMA 2 (nula + CAMISA); ALFA 1 (DENIM); DELTA 1 (nula); BETA UNO 0; OMEGA 0'
select m.codigo, count(*) as filas,
  string_agg(v.modalidad || ':' || coalesce(l.nombre, 'null'), ', ' order by l.nombre nulls first) as detalle
from marca_gml_especial_vigente v
join marcas m on m.id = v.marca_id
left join genero_mundo_linea n on n.id = v.genero_mundo_linea_id
left join lineas l on l.id = n.linea_id
where m.codigo like 'HUMO%'
group by m.codigo order by m.codigo;
select 'vista GAMMA = 2 filas' as prueba,
  (select count(*) from marca_gml_especial_vigente v join marcas m on m.id = v.marca_id where m.codigo = 'HUMOGAMMA') = 2 as ok;
\echo '--- vista: GAMMA sin la bandera vuelve a UNA fila (comportamiento de 0010) (esperado ok = t)'
savepoint s;
update marcas set resto_al_barrer = false where codigo = 'HUMOGAMMA';
select 'GAMMA por_gml pura = 1 fila' as prueba,
  (select count(*) from marca_gml_especial_vigente v join marcas m on m.id = v.marca_id where m.codigo = 'HUMOGAMMA') = 1 as ok;
rollback to savepoint s;
\echo '--- vista: sigue siendo security_invoker (esperado {security_invoker=true})'
select reloptions from pg_class where relname = 'marca_gml_especial_vigente';

-- ---------------------------------------------------------------------------------------------------------------------
-- 0019 · venta_marca_gml
-- ---------------------------------------------------------------------------------------------------------------------
create temp table r_beta on commit drop as
  select public.venta_marca_gml(
    (select array_agg(id) from marcas where codigo = 'HUMOBETA'), date '2026-07-01', date '2026-09-01') x;
create temp table r_gamma on commit drop as
  select public.venta_marca_gml(
    (select array_agg(id) from marcas where codigo = 'HUMOGAMMA'), date '2026-07-01', date '2026-09-01') x;
\echo '--- venta_marca_gml(BETA): hechos = DENIM 3 x 100 (dos tallas sumadas), POLO 3 x 50, SANDALIA 3 x 20 (BETA UNO suma en BETA); CD y carga en curso fuera'
select l.nombre as gml, count(*) as meses, sum((h->>'unidades')::int) as unidades, min((h->>'unidades')::int) as por_mes
from r_beta, jsonb_array_elements(x->'hechos') h
join genero_mundo_linea n on n.id = (h->>'gml_id')::uuid
join lineas l on l.id = n.linea_id
group by l.nombre order by l.nombre;
select 'sin talla ni tienda en los hechos' as prueba,
  (select count(*) from r_beta, jsonb_array_elements(x->'hechos') h
    where h ? 'agrupacion_talla_id' or h ? 'tienda_id') = 0 as ok;
select 'solo la unidad BETA' as prueba,
  (select count(distinct h->>'unidad_marca_id') from r_beta, jsonb_array_elements(x->'hechos') h) = 1
  and (select h->>'unidad_marca_id' from r_beta, jsonb_array_elements(x->'hechos') h limit 1)
      = (select id::text from marcas where codigo = 'HUMOBETA') as ok;
select 'CD y en_curso no cuentan (total 510 = 3 x (100+50+20))' as prueba,
  (select sum((h->>'unidades')::int) from r_beta, jsonb_array_elements(x->'hechos') h) = 510 as ok;
select 'cargas = 3 meses publicados, ninguna en_curso' as prueba,
  (select count(*) from r_beta, jsonb_object_keys(x->'cargas')) = 3
  and (select count(*) from r_beta, jsonb_each_text(x->'cargas') c
        join cargas_venta_stock cv on cv.id = c.value::uuid where cv.estado = 'publicada') = 3 as ok;
select 'periodo con formato aaaa-mm-dd' as prueba,
  (select count(*) from r_beta, jsonb_array_elements(x->'hechos') h where h->>'periodo' ~ '^\d{4}-\d{2}-01$')
  = (select count(*) from r_beta, jsonb_array_elements(x->'hechos') h) as ok;
\echo '--- venta_marca_gml: totales U de las MISMAS g, de todas las marcas: DENIM = BETA 100 + ALFA 200 + GAMMA 60 = 360 por mes; POLO 50; SANDALIA 20 (sin CAMISA)'
select l.nombre as gml, count(*) as meses, min((t->>'unidades')::int) as por_mes
from r_beta, jsonb_array_elements(x->'totales') t
join genero_mundo_linea n on n.id = (t->>'gml_id')::uuid
join lineas l on l.id = n.linea_id
group by l.nombre order by l.nombre;
select 'totales sin CAMISA (BETA no vende ahi)' as prueba,
  (select count(*) from r_beta, jsonb_array_elements(x->'totales') t
    join genero_mundo_linea n on n.id = (t->>'gml_id')::uuid join lineas l on l.id = n.linea_id
    where l.nombre = 'CAMISA HUMO') = 0 as ok;
\echo '--- venta_marca_gml(GAMMA): CAMISA es GMLE -> una fila por equivalencia (MANGA LARGA 40, MANGA CORTA 10 por mes); DENIM es GML -> equivalencia nula'
select l.nombre as gml, coalesce(e.nombre, 'null') as equivalencia, count(*) as meses, min((h->>'unidades')::int) as por_mes
from r_gamma, jsonb_array_elements(x->'hechos') h
join genero_mundo_linea n on n.id = (h->>'gml_id')::uuid
join lineas l on l.id = n.linea_id
left join equivalencias e on e.id = (h->>'equivalencia_id')::uuid
group by l.nombre, e.nombre order by l.nombre, e.nombre;
\echo '--- venta_marca_gml: entradas nulas o vacias devuelven documento vacio (esperado ok = t); un miembro (BETA UNO) no devuelve hechos'
select 'p_marca_ids nulo' as prueba,
  jsonb_array_length(public.venta_marca_gml(null, null, null)->'hechos') = 0 as ok;
select 'miembro BETA UNO no es unidad' as prueba,
  jsonb_array_length(public.venta_marca_gml(
    (select array_agg(id) from marcas where codigo = 'HUMOBETAUNO'), null, null)->'hechos') = 0 as ok;
select 'ventana de un mes' as prueba,
  (select sum((h->>'unidades')::int) from jsonb_array_elements(
    public.venta_marca_gml((select array_agg(id) from marcas where codigo = 'HUMOBETA'),
                           date '2026-08-01', date '2026-08-01')->'hechos') h) = 170 as ok;

-- ---------------------------------------------------------------------------------------------------------------------
-- 0019 · venta_marca_gml_resumen
-- ---------------------------------------------------------------------------------------------------------------------
create temp table r_res on commit drop as
  select public.venta_marca_gml_resumen(date '2026-07-01', date '2026-09-01', 200) x;
\echo '--- resumen (umbral 200): una fila por unidad con parte al barrer: BETA (barrido) 510 u, 3 g, 2 pequenas (POLO 150, SANDALIA 60); GAMMA (mixta); DELTA (sin venta, ceros); ni ALFA ni OMEGA ni BETA UNO'
select m.codigo, (u->>'unidades')::int as unidades, (u->>'gml_con_venta')::int as gml_con_venta, (u->>'gml_pequenos')::int as gml_pequenos
from r_res, jsonb_array_elements(x->'unidades') u
join marcas m on m.id = (u->>'unidad_marca_id')::uuid
order by m.codigo;
select 'resumen: 3 unidades (BETA, GAMMA, DELTA)' as prueba,
  (select jsonb_array_length(x->'unidades') from r_res) = 3 as ok;
select 'resumen: BETA 510 u, 3 g, 2 pequenos' as prueba,
  (select (u->>'unidades')::int = 510 and (u->>'gml_con_venta')::int = 3 and (u->>'gml_pequenos')::int = 2
     from r_res, jsonb_array_elements(x->'unidades') u
     where u->>'unidad_marca_id' = (select id::text from marcas where codigo = 'HUMOBETA')) as ok;
select 'resumen: DELTA aparece con ceros' as prueba,
  (select (u->>'unidades')::int = 0 and (u->>'gml_con_venta')::int = 0
     from r_res, jsonb_array_elements(x->'unidades') u
     where u->>'unidad_marca_id' = (select id::text from marcas where codigo = 'HUMODELTA')) as ok;
select 'resumen: umbral por defecto 50 -> BETA 0 pequenos' as prueba,
  (select (u->>'gml_pequenos')::int = 0
     from jsonb_array_elements(public.venta_marca_gml_resumen(date '2026-07-01', date '2026-09-01')->'unidades') u
     where u->>'unidad_marca_id' = (select id::text from marcas where codigo = 'HUMOBETA')) as ok;
select 'resumen: por_gml de BETA = 3 filas (una por g, sin periodo)' as prueba,
  (select count(*) from r_res, jsonb_array_elements(x->'por_gml') g
     where g->>'unidad_marca_id' = (select id::text from marcas where codigo = 'HUMOBETA')) = 3 as ok;
select 'resumen: cargas = 3' as prueba, (select count(*) from r_res, jsonb_object_keys(x->'cargas')) = 3 as ok;
\echo '--- resumen: una mixta pasa a por_gml pura -> sale de la lista (esperado GAMMA ausente: ok = t)'
savepoint s;
update marcas set resto_al_barrer = false where codigo = 'HUMOGAMMA';
select 'GAMMA fuera de la lista' as prueba,
  not exists (select 1 from jsonb_array_elements(public.venta_marca_gml_resumen(date '2026-07-01', date '2026-09-01')->'unidades') u
              where u->>'unidad_marca_id' = (select id::text from marcas where codigo = 'HUMOGAMMA')) as ok;
rollback to savepoint s;

-- ---------------------------------------------------------------------------------------------------------------------
-- 0019 · repartos_marca_barrido y reparto_marca_barrido_gml
-- ---------------------------------------------------------------------------------------------------------------------
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config)
select id, 1, false, 24, 'por_temporada', date '2026-09-01', 'hc1', 'hf1' from marcas where codigo = 'HUMOBETA';
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config)
select id, 2, true, 24, 'por_temporada', date '2026-09-01', 'hc2', 'hf2' from marcas where codigo = 'HUMOBETA';
\echo '--- unico parcial: dos vigentes de la misma marca (esperado ERROR repartos_marca_barrido_vigente_uniq)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config)
select id, 3, true, 24, 'anual', date '2026-09-01', 'hc3', 'hf3' from marcas where codigo = 'HUMOBETA';
rollback to savepoint s;
\echo '--- unico (marca, version): version repetida (esperado ERROR repartos_marca_barrido_marca_version_key)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config)
select id, 1, false, 24, 'anual', date '2026-09-01', 'hc', 'hf' from marcas where codigo = 'HUMOBETA';
rollback to savepoint s;
\echo '--- una vigente en OTRA marca si se permite (esperado ok = t)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, vigente, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config)
select id, 1, true, 12, 'anual', date '2026-09-01', 'hc', 'hf' from marcas where codigo = 'HUMOGAMMA';
select 'vigentes por marca = 1' as prueba,
  (select count(*) from repartos_marca_barrido where vigente and marca_id in (select id from marcas where codigo in ('HUMOBETA', 'HUMOGAMMA'))) = 2 as ok;
rollback to savepoint s;
\echo '--- checks de repartos: version 0, ventana 0, hasta_periodo dia 15, share 1.5, error negativo, alcance no objeto, nota de 301 (esperado 7 ERROR)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config) select id, 0, 24, 'anual', date '2026-09-01', 'a', 'b' from marcas where codigo = 'HUMOGAMMA';
rollback to savepoint s;
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config) select id, 5, 0, 'anual', date '2026-09-01', 'a', 'b' from marcas where codigo = 'HUMOGAMMA';
rollback to savepoint s;
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config) select id, 5, 24, 'anual', date '2026-09-15', 'a', 'b' from marcas where codigo = 'HUMOGAMMA';
rollback to savepoint s;
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, share_barrido) select id, 5, 24, 'anual', date '2026-09-01', 'a', 'b', 1.5 from marcas where codigo = 'HUMOGAMMA';
rollback to savepoint s;
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, error_reparto_pp) select id, 5, 24, 'anual', date '2026-09-01', 'a', 'b', -1 from marcas where codigo = 'HUMOGAMMA';
rollback to savepoint s;
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, alcance) select id, 5, 24, 'anual', date '2026-09-01', 'a', 'b', '[]'::jsonb from marcas where codigo = 'HUMOGAMMA';
rollback to savepoint s;
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config, nota) select id, 5, 24, 'anual', date '2026-09-01', 'a', 'b', repeat('x', 301) from marcas where codigo = 'HUMOGAMMA';
rollback to savepoint s;
\echo '--- catalogos SIN check (I9): modo y fuente libres (esperado ok = t)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, fuente, hasta_periodo, huella_cargas, huella_config)
select id, 5, 18, 'por_mes', 'otra_fuente', date '2026-09-01', 'a', 'b' from marcas where codigo = 'HUMOGAMMA';
select 'modo/fuente/ventana sin check' as prueba, count(*) = 1 as ok from repartos_marca_barrido where fuente = 'otra_fuente';
rollback to savepoint s;
\echo '--- defaults: aprobada_at no nulo, vigente true, fuente historico, alcance {}, normaliza_nino true (esperado ok = t)'
savepoint s;
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config)
select id, 1, 24, 'anual', date '2026-09-01', 'a', 'b' from marcas where codigo = 'HUMOGAMMA';
select 'defaults' as prueba,
  (aprobada_at is not null and vigente and fuente = 'historico' and alcance = '{}'::jsonb and normaliza_nino and factores_usados = '[]'::jsonb) as ok
from repartos_marca_barrido r join marcas m on m.id = r.marca_id where m.codigo = 'HUMOGAMMA';
rollback to savepoint s;

-- Filas del reparto vigente de BETA (v2): DENIM verano 0.6, POLO verano 0.4, DENIM invierno 1.0.
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, temporada, unidades_ventana, participacion_calculada, participacion_vigente)
select r.id, n.id, x.temp, x.unid, x.p, x.p
from (values ('HUMODENIM', 'verano', 300, 0.6), ('HUMOPOLO', 'verano', 150, 0.4), ('HUMODENIM', 'invierno', 300, 1.0)) as x(lin, temp, unid, p)
join lineas l on l.codigo = x.lin
join genero_mundo_linea n on n.linea_id = l.id
cross join repartos_marca_barrido r
where r.vigente and r.marca_id = (select id from marcas where codigo = 'HUMOBETA');
\echo '--- unico de expresion: mismo g y temporada con equivalencia nula (esperado ERROR reparto_marca_barrido_gml_clave_uniq)'
savepoint s;
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, temporada, participacion_calculada, participacion_vigente)
select r.id, n.id, 'verano', 0.1, 0.1
from repartos_marca_barrido r, lineas l join genero_mundo_linea n on n.linea_id = l.id
where r.vigente and l.codigo = 'HUMODENIM';
rollback to savepoint s;
\echo '--- unico de expresion: misma g con OTRA temporada, y la misma g sin temporada (anual), si se permiten (esperado ok = t)'
savepoint s;
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, temporada, participacion_calculada, participacion_vigente)
select r.id, n.id, null, 1, 1
from repartos_marca_barrido r, lineas l join genero_mundo_linea n on n.linea_id = l.id
where r.vigente and l.codigo = 'HUMOPOLO';
select 'anual (temporada nula) convive con verano' as prueba, count(*) = 2 as ok
from reparto_marca_barrido_gml g join genero_mundo_linea n on n.id = g.genero_mundo_linea_id join lineas l on l.id = n.linea_id where l.codigo = 'HUMOPOLO';
rollback to savepoint s;
\echo '--- unico de expresion: dos filas de la misma g con equivalencias DISTINTAS en GMLE si se permiten; con la MISMA equivalencia y mes nulo no (esperado ok = t y luego ERROR)'
savepoint s;
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, equivalencia_id, temporada, participacion_calculada, participacion_vigente)
select r.id, n.id, e.id, 'verano', 0.2, 0.2
from repartos_marca_barrido r, lineas l
join genero_mundo_linea n on n.linea_id = l.id
join equivalencias e on e.genero_mundo_linea_id = n.id
where r.vigente and l.codigo = 'HUMOCAM';
select 'dos equivalencias de CAMISA' as prueba, count(*) = 2 as ok
from reparto_marca_barrido_gml g join equivalencias e on e.id = g.equivalencia_id where e.codigo in ('HUMO-ML', 'HUMO-MC');
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, equivalencia_id, temporada, participacion_calculada, participacion_vigente)
select r.id, n.id, e.id, 'verano', 0.2, 0.2
from repartos_marca_barrido r, lineas l
join genero_mundo_linea n on n.linea_id = l.id
join equivalencias e on e.genero_mundo_linea_id = n.id and e.codigo = 'HUMO-ML'
where r.vigente and l.codigo = 'HUMOCAM';
rollback to savepoint s;
\echo '--- checks de filas: participacion 1.2, mes 13, unidades negativas (esperado 3 ERROR)'
savepoint s;
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, temporada, participacion_calculada, participacion_vigente)
select r.id, n.id, 'x', 1.2, 1.2 from repartos_marca_barrido r, lineas l join genero_mundo_linea n on n.linea_id = l.id where r.vigente and l.codigo = 'HUMOSAND';
rollback to savepoint s;
savepoint s;
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, temporada, mes, participacion_calculada, participacion_vigente)
select r.id, n.id, 'x', 13, 0.1, 0.1 from repartos_marca_barrido r, lineas l join genero_mundo_linea n on n.linea_id = l.id where r.vigente and l.codigo = 'HUMOSAND';
rollback to savepoint s;
savepoint s;
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, temporada, unidades_ventana, participacion_calculada, participacion_vigente)
select r.id, n.id, 'x', -1, 0.1, 0.1 from repartos_marca_barrido r, lineas l join genero_mundo_linea n on n.linea_id = l.id where r.vigente and l.codigo = 'HUMOSAND';
rollback to savepoint s;
\echo '--- participacion_vigente puede diferir de coalesce(ajustada, calculada) (resto expandido): NO hay check (esperado ok = t)'
savepoint s;
insert into reparto_marca_barrido_gml (reparto_id, genero_mundo_linea_id, temporada, participacion_calculada, participacion_ajustada, participacion_vigente, grupo_resto)
select r.id, n.id, 'x', 0.1, null, 0.3, 'g|m' from repartos_marca_barrido r, lineas l join genero_mundo_linea n on n.linea_id = l.id where r.vigente and l.codigo = 'HUMOSAND';
select 'vigente 0.3 con calculada 0.1 y ajustada nula' as prueba, count(*) = 1 as ok from reparto_marca_barrido_gml where participacion_vigente = 0.3;
rollback to savepoint s;
\echo '--- suma por temporada del reparto vigente de BETA = 1 en verano e invierno (esperado ok = t)'
select 'suma por temporada' as prueba, bool_and(round(s, 4) = 1) as ok
from (select temporada, sum(participacion_vigente) s from reparto_marca_barrido_gml g
        join repartos_marca_barrido r on r.id = g.reparto_id where r.vigente group by temporada) q;
\echo '--- on delete cascade: borrar una version se lleva sus filas; restrict: borrar la marca con repartos falla (esperado ok = t y luego ERROR)'
savepoint s;
delete from repartos_marca_barrido where vigente and marca_id = (select id from marcas where codigo = 'HUMOBETA');
select 'filas del reparto borrado' as prueba, count(*) = 0 as ok from reparto_marca_barrido_gml;
rollback to savepoint s;
\echo '--- restrict: una marca SIN venta pero con reparto no se puede borrar (esperado ERROR repartos_marca_barrido_marca_id_fkey)'
savepoint s;
insert into marcas (codigo, nombre, agrupacion_marca_id) select 'HUMOSINVENTA', 'HUMOSINVENTA', id from agrupaciones_marca where codigo = 'HUMOPREM';
insert into repartos_marca_barrido (marca_id, version, ventana_meses, modo, hasta_periodo, huella_cargas, huella_config)
select id, 1, 24, 'anual', date '2026-09-01', 'a', 'b' from marcas where codigo = 'HUMOSINVENTA';
delete from marcas where codigo = 'HUMOSINVENTA';
rollback to savepoint s;
\echo '--- trigger set_updated_at: updated_at avanza al modificar (esperado ok = t)'
savepoint s;
update repartos_marca_barrido set updated_at = now() - interval '1 day' where vigente;
update repartos_marca_barrido set nota = 'cambio' where vigente;
select 'updated_at del reparto avanza' as prueba, bool_and(updated_at > now() - interval '1 minute') as ok from repartos_marca_barrido where vigente;
rollback to savepoint s;

-- ---------------------------------------------------------------------------------------------------------------------
-- 0019 · proyecciones.huella_flujo
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- proyecciones.huella_flujo existe, text y admite nulo (esperado ok = t)'
select 'huella_flujo text null' as prueba,
  (select data_type = 'text' and is_nullable = 'YES' from information_schema.columns
     where table_name = 'proyecciones' and column_name = 'huella_flujo') as ok;
savepoint s;
insert into proyecciones (anio_en_curso, nombre, hasta_periodo, parametros) values (2031, 'humo', '2031-03-01', '{}');
select 'una proyeccion nueva nace con huella_flujo nula' as prueba, huella_flujo is null as ok from proyecciones where nombre = 'humo';
update proyecciones set huella_flujo = 'abc' where nombre = 'humo';
select 'se puede escribir' as prueba, huella_flujo = 'abc' as ok from proyecciones where nombre = 'humo';
rollback to savepoint s;

-- ---------------------------------------------------------------------------------------------------------------------
-- 0020 · intercompany_reglas y vista intercompany_vigente
-- ---------------------------------------------------------------------------------------------------------------------
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, equivalencia_id, vigente_desde, cobertura_min_meses, cobertura_max_meses, pct_directo, nota)
select m.id, n.id, e.id, x.desde::date, x.cmin, x.cmax, x.pct, x.nota
from (values
  -- marca, linea, equivalencia, desde, min, max, pct, nota
  ('HUMOBETA',  'HUMODENIM', null::text,           '2026-01-01', 2.0, 4.0, 80.0, 'acuerdo 2026'),
  ('HUMOBETA',  'HUMODENIM', null,                 '2026-06-01', 1.5, 3.0, 50.0, null),
  ('HUMOBETA',  'HUMOCAM',   null,                 '2026-01-01', 2.0, 4.0, 80.0, null),
  ('HUMOBETA',  'HUMOCAM',   'HUMO-MC',            '2026-06-01', 1.5, 3.0, 50.0, 'manga corta'),
  ('HUMOGAMMA', 'HUMOPOLO',  null,                 '2026-01-01', 2.0, 4.0, 70.0, null)
) as x(mar, lin, eq, desde, cmin, cmax, pct, nota)
join marcas m on m.codigo = x.mar
join lineas l on l.codigo = x.lin
join genero_mundo_linea n on n.linea_id = l.id
left join equivalencias e on e.codigo = x.eq;
\echo '--- unico de expresion: misma clave y mes con equivalencia nula (esperado ERROR intercompany_reglas_clave_uniq)'
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses)
select m.id, n.id, date '2026-01-01', 2, 4
from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOBETA' and l.codigo = 'HUMODENIM';
rollback to savepoint s;
\echo '--- unico de expresion: misma clave en OTRO mes, y GML + equivalencia el mismo mes, si se permiten (esperado ok = t)'
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses)
select m.id, n.id, date '2026-09-01', 2, 4
from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOBETA' and l.codigo = 'HUMODENIM';
select 'tres reglas de BETA en DENIM' as prueba, count(*) = 3 as ok
from intercompany_reglas r join marcas m on m.id = r.marca_id join genero_mundo_linea n on n.id = r.genero_mundo_linea_id join lineas l on l.id = n.linea_id
where m.codigo = 'HUMOBETA' and l.codigo = 'HUMODENIM';
rollback to savepoint s;
\echo '--- checks: vigente_desde 2026-01-15, pct 101, pct -1, cobertura negativa, nota vacia, nota de 201 (esperado 6 ERROR)'
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses)
select m.id, n.id, date '2026-01-15', 2, 4 from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMODENIM';
rollback to savepoint s;
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses, pct_directo)
select m.id, n.id, date '2026-01-01', 2, 4, 101 from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMODENIM';
rollback to savepoint s;
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses, pct_directo)
select m.id, n.id, date '2026-01-01', 2, 4, -1 from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMODENIM';
rollback to savepoint s;
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses)
select m.id, n.id, date '2026-01-01', -0.5, 4 from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMODENIM';
rollback to savepoint s;
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses, nota)
select m.id, n.id, date '2026-01-01', 2, 4, '' from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMODENIM';
rollback to savepoint s;
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses, nota)
select m.id, n.id, date '2026-01-01', 2, 4, repeat('x', 201) from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMODENIM';
rollback to savepoint s;
\echo '--- la base NO valida que el tope sea >= minimo ni el rango 0,5-24 (eso es zod, I9) (esperado ok = t)'
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses, pct_directo)
select m.id, n.id, date '2026-01-01', 6, 1.5, 0 from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMODENIM';
select 'tope < minimo se guarda' as prueba, count(*) = 1 as ok from intercompany_reglas where cobertura_min_meses = 6 and cobertura_max_meses = 1.5;
rollback to savepoint s;
\echo '--- vista intercompany_vigente: hasta_derivado por CLAVE EXACTA. BETA·DENIM 2026-01 cierra 2026-05, 2026-06 abierta; BETA·CAMISA (GML) abierta aunque exista la de MANGA CORTA; GAMMA·POLO abierta'
select m.codigo as marca, l.nombre as gml, coalesce(v.equivalencia_nombre, '-') as equivalencia, v.vigente_desde, v.hasta_derivado, v.cobertura_min_meses as cmin, v.cobertura_max_meses as cmax, v.pct_directo
from intercompany_vigente v join marcas m on m.id = v.marca_id join genero_mundo_linea n on n.id = v.genero_mundo_linea_id join lineas l on l.id = n.linea_id
order by m.codigo, l.nombre, v.equivalencia_nombre nulls first, v.vigente_desde;
select 'BETA·DENIM 2026-01 -> hasta 2026-05-01' as prueba,
  (select hasta_derivado from intercompany_vigente where marca_nombre = 'HUMOBETA' and linea_nombre = 'DENIM HUMO' and vigente_desde = date '2026-01-01') = date '2026-05-01' as ok;
select 'BETA·DENIM 2026-06 abierta' as prueba,
  (select hasta_derivado is null from intercompany_vigente where marca_nombre = 'HUMOBETA' and linea_nombre = 'DENIM HUMO' and vigente_desde = date '2026-06-01') as ok;
select 'regla de la equivalencia no cierra la del GML' as prueba,
  (select hasta_derivado is null from intercompany_vigente where marca_nombre = 'HUMOBETA' and linea_nombre = 'CAMISA HUMO' and equivalencia_id is null) as ok;
\echo '--- vista: una regla INACTIVA posterior no cierra a la anterior ni aparece (esperado ok = t)'
savepoint s;
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses, activo)
select m.id, n.id, date '2026-03-01', 2, 4, false from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMOPOLO';
select 'GAMMA·POLO sigue abierta con una inactiva posterior' as prueba,
  (select hasta_derivado is null from intercompany_vigente where marca_nombre = 'HUMOGAMMA' and linea_nombre = 'POLO HUMO' and vigente_desde = date '2026-01-01') as ok;
select 'la inactiva no aparece en la vista' as prueba,
  (select count(*) from intercompany_vigente where marca_nombre = 'HUMOGAMMA' and linea_nombre = 'POLO HUMO') = 1 as ok;
rollback to savepoint s;
\echo '--- vista: eliminar la regla de junio deja la de enero abierta (esperado ok = t)'
savepoint s;
delete from intercompany_reglas where marca_id = (select id from marcas where codigo = 'HUMOBETA')
  and vigente_desde = date '2026-06-01' and equivalencia_id is null
  and genero_mundo_linea_id = (select n.id from genero_mundo_linea n join lineas l on l.id = n.linea_id where l.codigo = 'HUMODENIM');
select 'BETA·DENIM enero abierta' as prueba,
  (select hasta_derivado is null from intercompany_vigente where marca_nombre = 'HUMOBETA' and linea_nombre = 'DENIM HUMO') as ok;
rollback to savepoint s;
\echo '--- vista: security_invoker (esperado {security_invoker=true})'
select reloptions from pg_class where relname = 'intercompany_vigente';
\echo '--- restrict: marca, nodo y equivalencia SIN venta pero con una regla no se pueden borrar (esperado 3 ERROR intercompany_reglas_*_fkey)'
savepoint s;
insert into marcas (codigo, nombre, agrupacion_marca_id) select 'HUMOSINVENTA', 'HUMOSINVENTA', id from agrupaciones_marca where codigo = 'HUMOPREM';
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses)
select m.id, n.id, date '2026-01-01', 2, 4 from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOSINVENTA' and l.codigo = 'HUMOPOLO';
delete from marcas where codigo = 'HUMOSINVENTA';
rollback to savepoint s;
savepoint s;
insert into lineas (codigo, nombre, temporada) values ('HUMOLIN2', 'LINEA DOS HUMO', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id) select g.id, mu.id, l.id from generos g, mundos mu, lineas l where g.codigo = 'HUMOH' and mu.codigo = 'HUMOU' and l.codigo = 'HUMOLIN2';
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, vigente_desde, cobertura_min_meses, cobertura_max_meses)
select m.id, n.id, date '2026-01-01', 2, 4 from marcas m, lineas l join genero_mundo_linea n on n.linea_id = l.id where m.codigo = 'HUMOGAMMA' and l.codigo = 'HUMOLIN2';
delete from genero_mundo_linea where linea_id = (select id from lineas where codigo = 'HUMOLIN2');
rollback to savepoint s;
savepoint s;
insert into lineas (codigo, nombre, temporada) values ('HUMOLIN2', 'LINEA DOS HUMO', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion) select g.id, mu.id, l.id, 'GMLE' from generos g, mundos mu, lineas l where g.codigo = 'HUMOH' and mu.codigo = 'HUMOU' and l.codigo = 'HUMOLIN2';
insert into equivalencias (genero_mundo_linea_id, codigo, nombre) select n.id, 'HUMO-EQ2', 'EQUIVALENCIA DOS HUMO' from genero_mundo_linea n join lineas l on l.id = n.linea_id where l.codigo = 'HUMOLIN2';
insert into intercompany_reglas (marca_id, genero_mundo_linea_id, equivalencia_id, vigente_desde, cobertura_min_meses, cobertura_max_meses)
select m.id, e.genero_mundo_linea_id, e.id, date '2026-01-01', 2, 4 from marcas m, equivalencias e where m.codigo = 'HUMOGAMMA' and e.codigo = 'HUMO-EQ2';
delete from equivalencias where codigo = 'HUMO-EQ2';
rollback to savepoint s;
\echo '--- perfil_id on delete set null (esperado ok = t)'
savepoint s;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'humo@example.invalid');
insert into perfiles (id, email, nombre, rol) values ('00000000-0000-4000-8000-0000000000a1', 'humo@example.invalid', 'Humo', 'planner');
update intercompany_reglas set perfil_id = '00000000-0000-4000-8000-0000000000a1', usuario_nombre = 'Humo' where marca_id = (select id from marcas where codigo = 'HUMOGAMMA');
delete from perfiles where id = '00000000-0000-4000-8000-0000000000a1';
select 'perfil_id nulo y nombre conservado' as prueba, perfil_id is null and usuario_nombre = 'Humo' as ok from intercompany_reglas where marca_id = (select id from marcas where codigo = 'HUMOGAMMA');
rollback to savepoint s;

-- ---------------------------------------------------------------------------------------------------------------------
-- Permisos y RLS (0019 y 0020)
-- ---------------------------------------------------------------------------------------------------------------------
\echo '--- RLS activo en las 3 tablas nuevas, sin politicas (esperado rls = t, politicas = 0)'
select c.relname, c.relrowsecurity as rls, (select count(*) from pg_policies p where p.tablename = c.relname) as politicas
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('repartos_marca_barrido', 'reparto_marca_barrido_gml', 'intercompany_reglas') order by 1;
\echo '--- privilegios: anon y authenticated sin nada; service_role con todo (esperado anon = f, authenticated = f, service_role = t en cada fila)'
select o as objeto,
  has_table_privilege('anon', 'public.' || o, 'select') or has_table_privilege('anon', 'public.' || o, 'insert') as anon,
  has_table_privilege('authenticated', 'public.' || o, 'select') or has_table_privilege('authenticated', 'public.' || o, 'insert') as authenticated,
  has_table_privilege('service_role', 'public.' || o, 'select') as service_role
from unnest(array['repartos_marca_barrido', 'reparto_marca_barrido_gml', 'intercompany_reglas', 'intercompany_vigente', 'marca_gml_especial_vigente']) o;
select f as funcion,
  has_function_privilege('anon', f, 'execute') as anon,
  has_function_privilege('authenticated', f, 'execute') as authenticated,
  has_function_privilege('service_role', f, 'execute') as service_role
from unnest(array['public.venta_marca_gml(uuid[], date, date)', 'public.venta_marca_gml_resumen(date, date, integer)']) f;
\echo '--- anon intenta leer las tablas, las vistas y ejecutar las funciones (esperado 8 ERROR permission denied)'
savepoint s;
set local role anon;
select count(*) from repartos_marca_barrido;
rollback to savepoint s;
savepoint s;
set local role anon;
select count(*) from intercompany_reglas;
rollback to savepoint s;
savepoint s;
set local role anon;
select count(*) from intercompany_vigente;
rollback to savepoint s;
savepoint s;
set local role anon;
select public.venta_marca_gml(array[]::uuid[], null, null);
rollback to savepoint s;
savepoint s;
set local role anon;
select public.venta_marca_gml_resumen(null, null);
rollback to savepoint s;
savepoint s;
set local role authenticated;
select count(*) from reparto_marca_barrido_gml;
rollback to savepoint s;
savepoint s;
set local role authenticated;
select public.venta_marca_gml_resumen(null, null);
rollback to savepoint s;
savepoint s;
set local role authenticated;
select count(*) from marca_gml_especial_vigente;
rollback to savepoint s;
\echo '--- service_role ejecuta las funciones (esperado ok = t)'
savepoint s;
set local role service_role;
select 'venta_marca_gml' as prueba, jsonb_array_length(public.venta_marca_gml(array[]::uuid[], null, null)->'hechos') = 0 as ok;
select 'venta_marca_gml_resumen' as prueba, jsonb_typeof(public.venta_marca_gml_resumen(null, null)->'unidades') = 'array' as ok;
rollback to savepoint s;

rollback;
