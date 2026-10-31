-- Humo SQL de la migración 0030 (M7 07e, propuesta de la IA por línea, versión 0.15.0):
--   * las 8 tablas `ia_*`: RLS sin políticas, permisos, checks estructurales, ausencia de checks de catálogo y neutralidad
--     frente al proveedor (`proveedor` y `modelo` son texto libre; tokens y precios con nombres neutros);
--   * una sola configuración vigente, una sola evaluación `en_curso`, una sola corrida `en_curso` por proyección (R20);
--   * inmutabilidad de `ia_entradas`, `ia_llamadas`, `ia_propuestas_gm` e `ia_propuestas_filas`: update, delete y truncate
--     fallan (también para `service_role`) y las únicas excepciones son poner en NULL una FK `set null` (R19);
--   * estados terminales de evaluaciones, corridas y GM (`tg_ia_terminal`);
--   * `proyeccion_fila_anios.decision_ia_fila_id` y su `check` (R19, rev. M5);
--   * `venta_lineas_ia`: forma compacta, solo unidades (nunca soles, costos ni stock), tiendas de tipo Tienda, rango
--     `p_desde`..`p_hasta`, claves de pertenencia, nodo GML frente a GMLE, determinismo;
--   * `registrar_propuesta_ia_gm`: token equivocado, corrida terminada, error a mitad (nada a medias), éxito, reuso y
--     permisos (R16).
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0030.sql"
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- Como humo-0025/0027/0029, NO necesita fixture previo: carga el suyo (géneros, mundos, líneas, nodos GML y GMLE,
-- equivalencias, marcas, tiendas y un CD, cargas, venta con soles/costos/stock, una proyección con filas y un perfil). Todo
-- inventado: nada de datos reales de Lukers.
--
-- Contra PRODUCCIÓN solo se corren, por SELECT de solo lectura, las comprobaciones de estructura (sección 1): el resto
-- inserta datos de prueba y es solo para la base local.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Los casos que DEBEN fallar se prueban
-- dentro de un bloque `do` con `exception` (es un script de prueba local, no una migración).
-- Nota local: el rol `service_role` del clúster local no tiene BYPASSRLS; para probar al backend de verdad, la sección 8 le
-- concede BYPASSRLS dentro de la transacción (se deshace con el `rollback`) y ejecuta con `set local role`.
\set ON_ERROR_STOP off
\pset pager off
begin;

create temp table r (n serial, caso text, ok boolean);

-- Ayudante: ejecuta una sentencia y devuelve true si falló con un mensaje que cumple el patrón (o con cualquier mensaje si el
-- patrón es nulo). Devuelve false si la sentencia se aceptó o si falló por otro motivo.
create or replace function pg_temp.falla(t text, patron text default null) returns boolean language plpgsql as $f$
begin
  execute t;
  return false;
exception when others then
  if patron is not null and sqlerrm not like patron then
    raise notice 'falla con otro mensaje: % -> %', t, sqlerrm;
  end if;
  return patron is null or sqlerrm like patron;
end
$f$;

-- Ayudante: ejecuta una sentencia y devuelve el mensaje del error (nulo si se aceptó). Para `truncate`, que no puede correr dentro
-- del mismo `insert ... select` que lee la tabla («being used by active queries»): se ejecuta en su propia sentencia.
create or replace function pg_temp.msg(t text) returns text language plpgsql as $f$
begin
  execute t;
  return null;
exception when others then
  return sqlerrm;
end
$f$;

-- Ayudante: ejecuta una sentencia y devuelve true si se aceptó.
create or replace function pg_temp.acepta(t text) returns boolean language plpgsql as $f$
begin
  execute t;
  return true;
exception when others then
  raise notice 'acepta fallo: % -> %', t, sqlerrm;
  return false;
end
$f$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura  [solo lectura: también vale contra producción]
-- ---------------------------------------------------------------------------------------------------------------------
create temp table tablas_ia (n text);
insert into tablas_ia values ('ia_evaluaciones'), ('ia_configuraciones'), ('ia_corridas'), ('ia_corrida_gms'),
  ('ia_entradas'), ('ia_llamadas'), ('ia_propuestas_gm'), ('ia_propuestas_filas');

insert into r (caso, ok) values
  ('existen las 8 tablas ia_*',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relkind = 'r' and c.relname in (select n from tablas_ia)) = 8),
  ('las 8 tablas tienen RLS activo',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relname in (select n from tablas_ia) and c.relrowsecurity) = 8),
  ('ninguna tabla ia_* tiene politicas (solo entra service_role)',
    (select count(*) from pg_policies where schemaname = 'public' and tablename in (select n from tablas_ia)) = 0),
  ('anon y authenticated no tienen ningun permiso sobre las 8 tablas; service_role tiene select, insert, update y delete',
    (select count(*) from tablas_ia t, unnest(array['select', 'insert', 'update', 'delete', 'truncate']) p(priv)
      where has_table_privilege('anon', 'public.' || t.n, p.priv) or has_table_privilege('authenticated', 'public.' || t.n, p.priv)) = 0
    and (select count(*) from tablas_ia t, unnest(array['select', 'insert', 'update', 'delete']) p(priv)
      where not has_table_privilege('service_role', 'public.' || t.n, p.priv)) = 0),
  ('las 4 tablas inmutables NO llevan activo ni updated_at; las 3 mutables con activo (config, evaluaciones, corridas) si',
    (select count(*) from information_schema.columns where table_schema = 'public'
       and table_name in ('ia_entradas', 'ia_llamadas', 'ia_propuestas_gm', 'ia_propuestas_filas')
       and column_name in ('activo', 'updated_at')) = 0
    and (select count(*) from information_schema.columns where table_schema = 'public'
       and table_name in ('ia_configuraciones', 'ia_evaluaciones', 'ia_corridas') and column_name in ('activo', 'updated_at')) = 6),
  ('ninguna tabla ia_* lleva check sobre un catalogo (estado, tipo, tipo_llamada, modo, capacidades, estado_meta, confianza, proveedor sin longitud)',
    not exists (select 1 from pg_constraint
                 where contype = 'c' and conrelid in (select ('public.' || n)::regclass from tablas_ia)
                   and (pg_get_constraintdef(oid) ~ '\m(estado|tipo|tipo_llamada|modo|capacidades|estado_meta|confianza|bandera|banderas|senales)\M'
                        and pg_get_constraintdef(oid) !~ 'char_length'))),
  ('proveedor y modelo son texto libre: su unico check es de longitud (sin lista de proveedores ni de ids de modelo)',
    (select count(*) from pg_constraint
      where contype = 'c' and conrelid in (select ('public.' || n)::regclass from tablas_ia)
        and pg_get_constraintdef(oid) ~ '\m(proveedor|modelo)\M'
        and pg_get_constraintdef(oid) !~ 'char_length') = 0),
  ('neutral al proveedor: ninguna columna ia_* se llama anthropic, openai, claude, cache_escritura ni cache_lectura',
    not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name in (select n from tablas_ia)
                   and column_name ~* '(anthropic|openai|claude|gpt|cache_escritura|cache_lectura)')),
  ('tokens con nombres neutros: tokens_entrada, tokens_entrada_cache y tokens_salida existen en ia_llamadas',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'ia_llamadas'
       and column_name in ('tokens_entrada', 'tokens_entrada_cache', 'tokens_salida')) = 3),
  ('decision_ia_fila_id: uuid nullable, sin default, con FK a ia_propuestas_filas on delete restrict',
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'proyeccion_fila_anios'
       and column_name = 'decision_ia_fila_id' and data_type = 'uuid' and is_nullable = 'YES' and column_default is null) = 1
    and (select count(*) from pg_constraint where conrelid = 'public.proyeccion_fila_anios'::regclass and contype = 'f'
           and confrelid = 'public.ia_propuestas_filas'::regclass and confdeltype = 'r') = 1),
  ('el check de decision_ia_fila_id existe (rev. M5)',
    (select count(*) from pg_constraint where conrelid = 'public.proyeccion_fila_anios'::regclass and contype = 'c'
       and conname = 'proyeccion_fila_anios_decision_ia_origen_check'
       and pg_get_constraintdef(oid) like '%decision_ia_fila_id IS NULL%origen%manual%') = 1),
  ('las 4 funciones: security invoker, search_path vacio y execute solo para service_role',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('venta_lineas_ia', 'registrar_propuesta_ia_gm', 'tg_ia_inmutable', 'tg_ia_terminal')
        and not p.prosecdef
        and exists (select 1 from unnest(p.proconfig) c where c in ('search_path=""', 'search_path='))
        and not has_function_privilege('anon', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and has_function_privilege('service_role', p.oid, 'execute')) = 4),
  ('los cuerpos de las 4 funciones no tienen comentarios -- (el SQL Editor los parsea mal)',
    (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace
      where s.nspname = 'public' and p.proname in ('venta_lineas_ia', 'registrar_propuesta_ia_gm', 'tg_ia_inmutable', 'tg_ia_terminal')
        and p.prosrc like '%--%') = 0),
  ('venta_lineas_ia es stable y su cuerpo NO nombra soles, costos ni stock (solo unidades)',
    (select provolatile = 's' and prosrc not like '%venta_soles%' and prosrc not like '%costo_vendido%'
            and prosrc not like '%stock_unidades%' and prosrc not like '%stock_valorizado%'
       from pg_proc where proname = 'venta_lineas_ia' and pronamespace = 'public'::regnamespace)),
  ('triggers: 4 de inmutabilidad por fila, 4 de truncate por sentencia, 3 de estado terminal, 4 set_updated_at',
    (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid in (select ('public.' || n)::regclass from tablas_ia)
       and t.tgname like '%\_inmutable' and (t.tgtype & 1) = 1 and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16) = 4
    and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid in (select ('public.' || n)::regclass from tablas_ia)
       and t.tgname like '%\_sin_vaciado' and (t.tgtype & 1) = 0 and (t.tgtype & 32) = 32) = 4
    and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid in (select ('public.' || n)::regclass from tablas_ia)
       and t.tgname like '%\_terminal') = 3
    and (select count(*) from pg_trigger t where not t.tgisinternal and t.tgrelid in (select ('public.' || n)::regclass from tablas_ia)
       and t.tgname = 'set_updated_at') = 4),
  ('indices unicos parciales: una configuracion vigente, una evaluacion en_curso, una corrida en_curso por proyeccion',
    (select count(*) from pg_indexes where schemaname = 'public'
       and indexname in ('ia_configuraciones_vigente_uniq', 'ia_evaluaciones_en_curso_uniq', 'ia_corridas_en_curso_proyeccion_uniq')) = 3),
  ('todos los indices e identificadores de las tablas ia_* miden <= 63 caracteres (sin truncar)',
    (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
      where s.nspname = 'public' and c.relname like 'ia\_%' and length(c.relname) > 63) = 0);

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into generos (codigo, nombre) values ('H30H', 'HOMBRE H30');
insert into mundos (codigo, nombre) values ('H30U', 'URBANO H30');
insert into lineas (codigo, nombre, temporada) values ('H30L1', 'LINEA UNO H30', 'Todo el año'), ('H30L2', 'LINEA DOS H30', 'Todo el año');
-- L1 es un nodo GML; L2, un nodo GMLE (lleva la equivalencia).
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, case l.codigo when 'H30L1' then 'GML' else 'GMLE' end
from lineas l, generos g, mundos mu
where l.codigo in ('H30L1', 'H30L2') and g.codigo = 'H30H' and mu.codigo = 'H30U';

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'humo30a@example.invalid'),
  ('00000000-0000-4000-8000-0000000000e2', 'humo30b@example.invalid');
insert into perfiles (id, email, nombre, rol) values
  ('00000000-0000-4000-8000-0000000000e1', 'humo30a@example.invalid', 'Humo 30 A', 'admin'),
  ('00000000-0000-4000-8000-0000000000e2', 'humo30b@example.invalid', 'Humo 30 B', 'planner');

insert into equivalencias (genero_mundo_linea_id, codigo, nombre)
select n.id, v.codigo, v.nombre
from (values ('H30L1', 'EQ1', 'EQUIVALENCIA UNO H30'), ('H30L1', 'EQ2', 'EQUIVALENCIA DOS H30'), ('H30L2', 'EQ3', 'EQUIVALENCIA TRES H30'))
  as v(linea, codigo, nombre)
join lineas l on l.codigo = v.linea
join genero_mundo_linea n on n.linea_id = l.id;

insert into agrupaciones_marca (codigo, nombre) values ('H30AG1', 'AGRUPACION UNO H30'), ('H30AG2', 'AGRUPACION DOS H30');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select v.codigo, v.nombre, a.id
from (values ('H30CAB', 'MARCA CABEZA H30', 'H30AG1'), ('H30MIE', 'MARCA MIEMBRO H30', 'H30AG2'), ('H30SUE', 'MARCA SUELTA H30', 'H30AG2'))
  as v(codigo, nombre, ag)
join agrupaciones_marca a on a.codigo = v.ag;
-- H30MIE es miembro del conjunto de H30CAB: en `marcas_unidad` suma en la cabeza (agrupación 1).
update marcas set conjunto_marca_id = (select id from marcas where codigo = 'H30CAB') where codigo = 'H30MIE';

insert into tiendas (codigo, nombre, tipo, activo) values
  ('H30T1', 'TIENDA UNO H30', 'Tienda', true),
  ('H30T2', 'TIENDA DOS H30', 'Tienda', true),
  ('H30CD', 'CD H30', 'Centro de Distribución', true);
insert into agrupaciones_talla (codigo, nombre) values ('H30TA', 'TALLA A H30');

insert into cargas_venta_stock (periodo, estado, publicada_at) values
  (date '2025-01-01', 'publicada', now()),
  (date '2025-02-01', 'publicada', now()),
  (date '2025-03-01', 'publicada', now()),
  (date '2025-04-01', 'en_curso', null);

-- Venta con soles, costo y stock DISTINTOS de cero en todas las filas: si `venta_lineas_ia` los leyera, se vería en el JSON.
-- Esperado para el nodo GML (L1) con grupos { T1: '11111', T2: '00001' } entre 2025-01 y 2025-03:
--   (agrup2 [MIE suma en cabeza => agrup1], clave 11111): EQ1 ene = 10 (MIE T1) + 5 (CAB T1) = 15 en agrupacion 1; feb = 4.
--   (agrup1/cabeza + miembro): ver la comprobacion; el CD no cuenta; T2 con clave '00001' ene = 7; la carga en curso no cuenta.
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, venta_soles, costo_vendido, stock_unidades, stock_valorizado)
select c.id, t.id, e.id, m.id, ta.id, v.unidades, v.soles, v.costo, v.stock, v.valor
from (values
  (date '2025-01-01', 'H30T1', 'EQ1', 'H30MIE', 10, 1000.50, 600.25, 100, 5000.00),
  (date '2025-01-01', 'H30T1', 'EQ1', 'H30CAB', 5, 500.50, 300.25, 50, 2500.00),
  (date '2025-01-01', 'H30T2', 'EQ1', 'H30SUE', 7, 700.50, 420.25, 70, 3500.00),
  (date '2025-01-01', 'H30CD', 'EQ1', 'H30SUE', 99, 9999.00, 5999.00, 999, 99999.00),
  (date '2025-02-01', 'H30T1', 'EQ2', 'H30SUE', 4, 400.50, 240.25, 40, 2000.00),
  (date '2025-03-01', 'H30T1', 'EQ2', 'H30CAB', 6, 600.50, 360.25, 60, 3000.00),
  (date '2025-01-01', 'H30T1', 'EQ3', 'H30SUE', 3, 300.50, 180.25, 30, 1500.00),
  (date '2025-02-01', 'H30T2', 'EQ3', 'H30SUE', 2, 200.50, 120.25, 20, 1000.00)
) as v(periodo, tienda, eq, marca, unidades, soles, costo, stock, valor)
join cargas_venta_stock c on c.periodo = v.periodo
join tiendas t on t.codigo = v.tienda
join equivalencias e on e.codigo = v.eq and e.nombre like '%H30'
join marcas m on m.codigo = v.marca
join agrupaciones_talla ta on ta.codigo = 'H30TA';
-- Una fila en la carga en curso: la lectura no la ve (no está publicada).
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, venta_soles, costo_vendido, stock_unidades, stock_valorizado)
select c.id, t.id, e.id, m.id, ta.id, 1000, 1, 1, 1, 1
from cargas_venta_stock c, tiendas t, equivalencias e, marcas m, agrupaciones_talla ta
where c.periodo = date '2025-04-01' and t.codigo = 'H30T1' and e.codigo = 'EQ1' and e.nombre like '%H30'
  and m.codigo = 'H30SUE' and ta.codigo = 'H30TA';

-- Proyecciones (la B y la C solo sirven para tener a quién colgar una corrida) y dos filas base con su año 2027.
insert into proyecciones (anio_en_curso, nombre, hasta_periodo, parametros) values
  (2026, 'HUMO 30 A', date '2026-09-01', '{}'::jsonb),
  (2026, 'HUMO 30 B', date '2026-09-01', '{}'::jsonb);
insert into proyeccion_filas (proyeccion_id, gml_id, agrupacion_marca_id, clave, nivel_proyectado, historico)
select p.id, n.id, a.id, 'FILA ' || l.codigo, 'GML', '{}'::jsonb
from proyecciones p, lineas l
join genero_mundo_linea n on n.linea_id = l.id
join agrupaciones_marca a on a.codigo = 'H30AG1'
where p.nombre = 'HUMO 30 A' and l.codigo in ('H30L1', 'H30L2');
insert into proyeccion_fila_anios (fila_id, anio, bloque, vendido)
select f.id, 2027, 'mismas', 100 from proyeccion_filas f;

create temp table ids as
select
  (select n.id from genero_mundo_linea n join lineas l on l.id = n.linea_id and l.codigo = 'H30L1') as gml1,
  (select n.id from genero_mundo_linea n join lineas l on l.id = n.linea_id and l.codigo = 'H30L2') as gml2,
  (select id from equivalencias where codigo = 'EQ3' and nombre like '%H30') as eq3,
  (select id from agrupaciones_marca where codigo = 'H30AG1') as ag1,
  (select id from agrupaciones_marca where codigo = 'H30AG2') as ag2,
  (select id from tiendas where codigo = 'H30T1') as t1,
  (select id from tiendas where codigo = 'H30T2') as t2,
  (select id from tiendas where codigo = 'H30CD') as cd,
  (select id from generos where codigo = 'H30H') as genero,
  (select id from mundos where codigo = 'H30U') as mundo,
  (select id from proyecciones where nombre = 'HUMO 30 A') as proy_a,
  (select id from proyecciones where nombre = 'HUMO 30 B') as proy_b,
  (select id from proyeccion_filas where clave = 'FILA H30L1') as fila1,
  (select id from proyeccion_filas where clave = 'FILA H30L2') as fila2,
  '00000000-0000-4000-8000-0000000000e1'::uuid as perfil_a,
  '00000000-0000-4000-8000-0000000000e2'::uuid as perfil_b;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Configuraciones, evaluaciones y corridas: checks estructurales y unicidad
-- ---------------------------------------------------------------------------------------------------------------------
create temp table casos (n int, caso text, sentencia text, esperado_ok boolean, ok boolean);
insert into casos (n, caso, esperado_ok, sentencia) values
  (1, 'configuracion minima valida (sin evaluacion, capacidades vacias por defecto)', true,
   $q$ insert into public.ia_configuraciones (version, proveedor, modelo, version_prompt, precios)
       values (1, 'proveedor-x', 'modelo-cualquiera-v9', 'v1', '{"entrada": 1, "entrada_cache": 0.5, "salida": 4}'::jsonb) $q$),
  (2, 'segunda configuracion VIGENTE (indice unico parcial)', false,
   $q$ insert into public.ia_configuraciones (version, proveedor, modelo, version_prompt, precios)
       values (2, 'proveedor-x', 'm', 'v1', '{}'::jsonb) $q$),
  (3, 'misma version aunque este reemplazada (unico por version)', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios)
       values (1, 'reemplazada', 'proveedor-x', 'm', 'v1', '{}'::jsonb) $q$),
  (4, 'estado fuera de catalogo (sin check: lo valida zod) y otro proveedor y modelo libres', true,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, capacidades, precios)
       values (3, 'cualquier_estado', 'otro-proveedor', 'un-modelo-que-no-existe', 'v2', array['capacidad_futura'], '{}'::jsonb) $q$),
  (5, 'version = 0', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios) values (0, 'r', 'p', 'm', 'v1', '{}'::jsonb) $q$),
  (6, 'modelo vacio', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios) values (4, 'r', 'p', '', 'v1', '{}'::jsonb) $q$),
  (7, 'proveedor vacio', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios) values (4, 'r', '', 'm', 'v1', '{}'::jsonb) $q$),
  (8, 'proveedor de 41 caracteres', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios) values (4, 'r', repeat('p', 41), 'm', 'v1', '{}'::jsonb) $q$),
  (9, 'version_prompt de 21 caracteres', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios) values (4, 'r', 'p', 'm', repeat('v', 21), '{}'::jsonb) $q$),
  (10, 'tope_usd_corrida = 0', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios, tope_usd_corrida) values (4, 'r', 'p', 'm', 'v1', '{}'::jsonb, 0) $q$),
  (11, 'tope_usd_mes = 5001', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios, tope_usd_mes) values (4, 'r', 'p', 'm', 'v1', '{}'::jsonb, 5001) $q$),
  (12, 'tope_usd_dia_usuario = 501', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios, tope_usd_dia_usuario) values (4, 'r', 'p', 'm', 'v1', '{}'::jsonb, 501) $q$),
  (13, 'max_filas_llamada = 9', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios, max_filas_llamada) values (4, 'r', 'p', 'm', 'v1', '{}'::jsonb, 9) $q$),
  (14, 'max_filas_llamada = 151', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios, max_filas_llamada) values (4, 'r', 'p', 'm', 'v1', '{}'::jsonb, 151) $q$),
  (15, 'presupuesto_razonamiento = 32001', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios, presupuesto_razonamiento) values (4, 'r', 'p', 'm', 'v1', '{}'::jsonb, 32001) $q$),
  (16, 'precios que no es objeto (arreglo)', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios) values (4, 'r', 'p', 'm', 'v1', '[]'::jsonb) $q$),
  (17, 'terminos_extra con 51 elementos', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios, terminos_extra)
       select 4, 'r', 'p', 'm', 'v1', '{}'::jsonb, array_agg('t' || g) from generate_series(1, 51) g $q$),
  (18, 'nota de 301 caracteres', false,
   $q$ insert into public.ia_configuraciones (version, estado, proveedor, modelo, version_prompt, precios, nota) values (4, 'r', 'p', 'm', 'v1', '{}'::jsonb, repeat('n', 301)) $q$),
  (19, 'evaluacion minima en_curso', true,
   $q$ insert into public.ia_evaluaciones (proveedor, modelo, version_prompt, parametros) values ('proveedor-x', 'modelo-1', 'v1', '{}'::jsonb) $q$),
  (20, 'segunda evaluacion en_curso (indice unico parcial)', false,
   $q$ insert into public.ia_evaluaciones (proveedor, modelo, version_prompt, parametros) values ('proveedor-x', 'modelo-2', 'v1', '{}'::jsonb) $q$),
  (21, 'evaluaciones terminadas: varias a la vez', true,
   $q$ insert into public.ia_evaluaciones (proveedor, modelo, version_prompt, parametros, estado, veredicto)
       values ('proveedor-x', 'modelo-3', 'v1', '{}'::jsonb, 'completa', '{"distribucion_y1": "gana", "regla_que_fallo": null}'::jsonb),
              ('proveedor-x', 'modelo-4', 'v1', '{}'::jsonb, 'cancelada', null) $q$),
  (22, 'evaluacion con parametros que no es objeto', false,
   $q$ insert into public.ia_evaluaciones (proveedor, modelo, version_prompt, parametros, estado) values ('p', 'm', 'v1', '[]'::jsonb, 'fallida') $q$),
  (23, 'evaluacion con tope_usd = 501', false,
   $q$ insert into public.ia_evaluaciones (proveedor, modelo, version_prompt, parametros, estado, tope_usd) values ('p', 'm', 'v1', '{}'::jsonb, 'fallida', 501) $q$),
  (24, 'evaluacion con resultados que no es objeto', false,
   $q$ insert into public.ia_evaluaciones (proveedor, modelo, version_prompt, parametros, estado, resultados) values ('p', 'm', 'v1', '{}'::jsonb, 'fallida', '[]'::jsonb) $q$),
  (25, 'corrida de propuesta en_curso en la proyeccion A', true,
   $q$ insert into public.ia_corridas (tipo, proyeccion_id, proveedor, modelo, version_prompt, alcance, costo_estimado_usd)
       select 'propuesta', proy_a, 'proveedor-x', 'modelo-1', 'v1', '{}'::jsonb, 1.5 from ids $q$),
  (26, 'segunda corrida en_curso en la MISMA proyeccion (indice unico parcial)', false,
   $q$ insert into public.ia_corridas (tipo, proyeccion_id, proveedor, modelo, version_prompt, alcance, costo_estimado_usd)
       select 'propuesta', proy_a, 'proveedor-x', 'modelo-1', 'v1', '{}'::jsonb, 1 from ids $q$),
  (27, 'corrida en_curso en OTRA proyeccion', true,
   $q$ insert into public.ia_corridas (tipo, proyeccion_id, proveedor, modelo, version_prompt, alcance, costo_estimado_usd)
       select 'propuesta', proy_b, 'proveedor-x', 'modelo-1', 'v1', '{}'::jsonb, 1 from ids $q$),
  (28, 'dos corridas de evaluacion en_curso (proyeccion nula: el unico parcial las deja pasar)', true,
   $q$ insert into public.ia_corridas (tipo, proveedor, modelo, version_prompt, alcance, costo_estimado_usd)
       values ('evaluacion', 'p', 'm', 'v1', '{}'::jsonb, 1), ('evaluacion', 'p', 'm', 'v1', '{}'::jsonb, 1) $q$),
  (29, 'corrida sin proveedor (not null)', false,
   $q$ insert into public.ia_corridas (tipo, proveedor, modelo, version_prompt, alcance, costo_estimado_usd) values ('evaluacion', null, 'm', 'v1', '{}'::jsonb, 1) $q$),
  (30, 'corrida con costo estimado negativo', false,
   $q$ insert into public.ia_corridas (tipo, proveedor, modelo, version_prompt, alcance, costo_estimado_usd) values ('evaluacion', 'p', 'm', 'v1', '{}'::jsonb, -1) $q$),
  (31, 'corrida con alcance que no es objeto', false,
   $q$ insert into public.ia_corridas (tipo, proveedor, modelo, version_prompt, alcance, costo_estimado_usd) values ('evaluacion', 'p', 'm', 'v1', '[]'::jsonb, 1) $q$),
  (32, 'corrida con motivo_fin de 121 caracteres', false,
   $q$ insert into public.ia_corridas (tipo, proveedor, modelo, version_prompt, alcance, costo_estimado_usd, motivo_fin, estado)
       values ('evaluacion', 'p', 'm', 'v1', '{}'::jsonb, 1, repeat('m', 121), 'detenida') $q$);

do $$
declare
  c record;
  v_aceptada boolean;
begin
  for c in select * from casos order by n loop
    begin
      execute c.sentencia;
      v_aceptada := true;
    exception when others then
      v_aceptada := false;
    end;
    update casos set ok = (v_aceptada = esperado_ok) where n = c.n;
  end loop;
end
$$;

insert into r (caso, ok) select 'configuraciones, evaluaciones y corridas: ' || caso, ok from casos order by n;

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. GM de corrida, entradas, llamadas, propuestas y filas: estructura y datos base de la inmutabilidad
-- ---------------------------------------------------------------------------------------------------------------------
create temp table b as
select
  (select id from ia_corridas where proyeccion_id = (select proy_a from ids)) as corrida_a,
  (select id from ia_corridas where proyeccion_id = (select proy_b from ids)) as corrida_b;

insert into ia_corrida_gms (corrida_id, gm_clave, estado, modo, plan, candado_token, candado_desde)
select corrida_a, 'GM-UNO', 'en_proceso', 'directo', '[{"id": "n1", "tipo": "natural", "lote": 1}]'::jsonb,
       '00000000-0000-4000-8000-0000000000f1', now()
from b;
insert into ia_corrida_gms (corrida_id, gm_clave, estado, candado_token, candado_desde)
select corrida_a, 'GM-DOS', 'en_proceso', '00000000-0000-4000-8000-0000000000f2', now() from b;
insert into ia_corrida_gms (corrida_id, gm_clave) select corrida_a, 'GM-TRES' from b;
insert into ia_corrida_gms (corrida_id, gm_clave, estado, candado_token, candado_desde)
select corrida_b, 'GM-UNO', 'en_proceso', '00000000-0000-4000-8000-0000000000f3', now() from b;

create temp table c as
select
  (select id from ia_corrida_gms where gm_clave = 'GM-UNO' and corrida_id = (select corrida_a from b)) as gm1,
  (select id from ia_corrida_gms where gm_clave = 'GM-DOS') as gm2,
  (select id from ia_corrida_gms where gm_clave = 'GM-TRES') as gm3,
  (select id from ia_corrida_gms where gm_clave = 'GM-UNO' and corrida_id = (select corrida_b from b)) as gm_b1;

insert into casos (n, caso, esperado_ok, sentencia) values
  (101, 'GM duplicado en la misma corrida y pliegue (unico)', false,
   $q$ insert into public.ia_corrida_gms (corrida_id, gm_clave) select corrida_a, 'GM-UNO' from b $q$),
  (102, 'mismo GM en otro pliegue de la misma corrida', true,
   $q$ insert into public.ia_corrida_gms (corrida_id, pliegue, gm_clave) select corrida_a, 'D25', 'GM-UNO' from b $q$),
  (103, 'GM con huella_gm de 63 caracteres', false,
   $q$ insert into public.ia_corrida_gms (corrida_id, gm_clave, huella_gm) select corrida_a, 'GM-HUELLA', repeat('a', 63) from b $q$),
  (104, 'GM con huella_gm de 64 caracteres', true,
   $q$ insert into public.ia_corrida_gms (corrida_id, gm_clave, huella_gm) select corrida_a, 'GM-HUELLA', repeat('a', 64) from b $q$),
  (105, 'GM con plan que no es arreglo', false,
   $q$ insert into public.ia_corrida_gms (corrida_id, gm_clave, plan) select corrida_a, 'GM-PLAN', '{}'::jsonb from b $q$),
  (106, 'GM con parcial que no es objeto', false,
   $q$ insert into public.ia_corrida_gms (corrida_id, gm_clave, parcial) select corrida_a, 'GM-PARCIAL', '[]'::jsonb from b $q$),
  (107, 'GM con gm_clave de 81 caracteres', false,
   $q$ insert into public.ia_corrida_gms (corrida_id, gm_clave) select corrida_a, repeat('g', 81) from b $q$),
  (108, 'GM con referencia que no es objeto', false,
   $q$ insert into public.ia_corrida_gms (corrida_id, gm_clave, referencia) select corrida_a, 'GM-REF', '[]'::jsonb from b $q$),
  (110, 'entrada valida (gzip como bytea)', true,
   $q$ insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario)
       select corrida_a, 'bloque', repeat('b', 64), '\x1f8b0800'::bytea, 120, '{"f": {"f001": "fila-1"}}'::jsonb from b $q$),
  (111, 'misma huella en la misma corrida (unico: un reintento reusa la fila)', false,
   $q$ insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario)
       select corrida_a, 'bloque', repeat('b', 64), '\x00'::bytea, 1, '{}'::jsonb from b $q$),
  (112, 'misma huella en otra corrida', true,
   $q$ insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario)
       select corrida_b, 'bloque', repeat('b', 64), '\x00'::bytea, 1, '{}'::jsonb from b $q$),
  (113, 'entrada con huella de 63 caracteres', false,
   $q$ insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario)
       select corrida_a, 'bloque', repeat('c', 63), '\x00'::bytea, 1, '{}'::jsonb from b $q$),
  (114, 'entrada con contenido de mas de 2 000 000 bytes', false,
   $q$ insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario)
       select corrida_a, 'bloque', repeat('d', 64), decode(repeat('00', 2000001), 'hex'), 1, '{}'::jsonb from b $q$),
  (115, 'entrada con bytes negativos', false,
   $q$ insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario)
       select corrida_a, 'bloque', repeat('e', 64), '\x00'::bytea, -1, '{}'::jsonb from b $q$),
  (116, 'entrada con diccionario que no es objeto', false,
   $q$ insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario)
       select corrida_a, 'bloque', repeat('f', 64), '\x00'::bytea, 1, '[]'::jsonb from b $q$),
  (117, 'entrada de tipo fuera de catalogo (sin check: lo valida zod)', true,
   $q$ insert into public.ia_entradas (corrida_id, tipo, huella, contenido_gz, bytes, diccionario)
       select corrida_a, 'tipo_futuro', repeat('1', 64), '\x00'::bytea, 1, '{}'::jsonb from b $q$),
  (120, 'llamada valida con tokens neutros', true,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, entrada_bloque_id, huella_llamada, estado,
         bytes_entrada, filas_enviadas, tokens_entrada, tokens_entrada_cache, tokens_salida, costo_usd, duracion_ms, perfil_id)
       select b.corrida_a, c.gm1, 'n1', 'natural', 1, (select id from ia_entradas where huella = repeat('b', 64) and corrida_id = b.corrida_a),
              repeat('9', 64), 'ok', 120, 12, 1000, 400, 300, 0.0123, 1800, (select perfil_a from ids)
       from b, c $q$),
  (121, 'llamada con intento = 0', false,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms)
       select b.corrida_a, c.gm1, 'n1', 'natural', 0, repeat('9', 64), 'ok', 1, 1, 1 from b, c $q$),
  (122, 'llamada con paso de 11 caracteres', false,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms)
       select b.corrida_a, c.gm1, repeat('p', 11), 'natural', 1, repeat('9', 64), 'ok', 1, 1, 1 from b, c $q$),
  (123, 'llamada con tokens_entrada_cache negativos', false,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms, tokens_entrada_cache)
       select b.corrida_a, c.gm1, 'n1', 'natural', 1, repeat('9', 64), 'ok', 1, 1, 1, -1 from b, c $q$),
  (124, 'llamada con costo_usd negativo', false,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms, costo_usd)
       select b.corrida_a, c.gm1, 'n1', 'natural', 1, repeat('9', 64), 'ok', 1, 1, 1, -0.0001 from b, c $q$),
  (125, 'llamada con huella de 63 caracteres', false,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms)
       select b.corrida_a, c.gm1, 'n1', 'natural', 1, repeat('9', 63), 'ok', 1, 1, 1 from b, c $q$),
  (126, 'llamada con error_detalle de 301 caracteres', false,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms, error_detalle)
       select b.corrida_a, c.gm1, 'n1', 'natural', 1, repeat('9', 64), 'error_proveedor', 1, 1, 1, repeat('e', 301) from b, c $q$),
  (127, 'llamada con esperar_ms negativo', false,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms, esperar_ms)
       select b.corrida_a, c.gm1, 'n1', 'natural', 1, repeat('9', 64), 'limite_proveedor', 1, 1, 1, -5 from b, c $q$),
  (128, 'llamada con estado y tipo_llamada fuera de catalogo (sin check)', true,
   $q$ insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms)
       select b.corrida_a, c.gm1, 'x', 'tipo_futuro', 1, repeat('8', 64), 'estado_futuro', 1, 1, 1 from b, c $q$),
  (130, 'propuesta de GM valida', true,
   $q$ insert into public.ia_propuestas_gm (corrida_id, corrida_gm_id, proyeccion_id, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo,
         version_metodo, meta, huella_gm, huella_historia, banderas_gm, filas_pedidas, filas_validas, desvio_suma_modelo, proveedor, modelo, version_prompt, perfil_id)
       select b.corrida_a, c.gm1, i.proy_a, 'GM-UNO', i.genero, i.mundo, false, array['distribucion_y1'], 'directo', 5,
              '{"pct": 8}'::jsonb, repeat('1', 64), repeat('2', 64), array['meta_exigente'], 2, 2, 0.0035, 'proveedor-x', 'modelo-1', 'v1', i.perfil_a
       from b, c, ids i $q$),
  (131, 'propuesta con huella_historia de 63 caracteres', false,
   $q$ insert into public.ia_propuestas_gm (corrida_id, corrida_gm_id, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo, version_metodo,
         huella_gm, huella_historia, filas_pedidas, filas_validas, proveedor, modelo, version_prompt)
       select b.corrida_a, c.gm2, 'GM-DOS', i.genero, i.mundo, false, '{}', 'directo', 5, repeat('1', 64), repeat('2', 63), 1, 1, 'p', 'm', 'v1' from b, c, ids i $q$),
  (132, 'propuesta con razon_gm de 601 caracteres', false,
   $q$ insert into public.ia_propuestas_gm (corrida_id, corrida_gm_id, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo, version_metodo,
         huella_gm, huella_historia, razon_gm, filas_pedidas, filas_validas, proveedor, modelo, version_prompt)
       select b.corrida_a, c.gm2, 'GM-DOS', i.genero, i.mundo, false, '{}', 'directo', 5, repeat('1', 64), repeat('2', 64), repeat('r', 601), 1, 1, 'p', 'm', 'v1' from b, c, ids i $q$),
  (133, 'propuesta con filas_validas negativas', false,
   $q$ insert into public.ia_propuestas_gm (corrida_id, corrida_gm_id, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo, version_metodo,
         huella_gm, huella_historia, filas_pedidas, filas_validas, proveedor, modelo, version_prompt)
       select b.corrida_a, c.gm2, 'GM-DOS', i.genero, i.mundo, false, '{}', 'directo', 5, repeat('1', 64), repeat('2', 64), 1, -1, 'p', 'm', 'v1' from b, c, ids i $q$),
  (134, 'propuesta con meta que no es objeto', false,
   $q$ insert into public.ia_propuestas_gm (corrida_id, corrida_gm_id, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo, version_metodo,
         huella_gm, huella_historia, meta, filas_pedidas, filas_validas, proveedor, modelo, version_prompt)
       select b.corrida_a, c.gm2, 'GM-DOS', i.genero, i.mundo, false, '{}', 'directo', 5, repeat('1', 64), repeat('2', 64), '[]'::jsonb, 1, 1, 'p', 'm', 'v1' from b, c, ids i $q$),
  (135, 'propuesta sin proveedor (not null)', false,
   $q$ insert into public.ia_propuestas_gm (corrida_id, corrida_gm_id, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo, version_metodo,
         huella_gm, huella_historia, filas_pedidas, filas_validas, modelo, version_prompt)
       select b.corrida_a, c.gm2, 'GM-DOS', i.genero, i.mundo, false, '{}', 'directo', 5, repeat('1', 64), repeat('2', 64), 1, 1, 'm', 'v1' from b, c, ids i $q$),
  (140, 'fila de propuesta valida (con fila_id)', true,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_id, fila_clave, estado_meta, base_al_generar, base_corregida_al_generar, p_gm_al_generar,
         natural_y1, razon_natural, meta_y1_modelo, meta_y1_al_generar, razon, banderas, confianza)
       select p.id, i.fila1, 'FILA H30L1', 'libre', 1000.50, 1100.00, 1188, 1150, 'natural', 1200, 1190, 'razon', array['quiebres'], 'alta'
       from ia_propuestas_gm p, ids i where p.gm_clave = 'GM-UNO' $q$),
  (141, 'segunda fila con la misma fila_clave en la misma propuesta (unico)', false,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_clave, estado_meta)
       select p.id, 'FILA H30L1', 'libre' from ia_propuestas_gm p where p.gm_clave = 'GM-UNO' $q$),
  (142, 'fila sin fila_id (evaluacion) y fija con aporte', true,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_clave, estado_meta, aporte_fijo_al_generar)
       select p.id, 'f002', 'fija_decidida', 300 from ia_propuestas_gm p where p.gm_clave = 'GM-UNO' $q$),
  (143, 'fila con natural_y1 negativo', false,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_clave, estado_meta, natural_y1)
       select p.id, 'f003', 'libre', -1 from ia_propuestas_gm p where p.gm_clave = 'GM-UNO' $q$),
  (144, 'fila con razon de 301 caracteres', false,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_clave, estado_meta, razon)
       select p.id, 'f003', 'libre', repeat('r', 301) from ia_propuestas_gm p where p.gm_clave = 'GM-UNO' $q$),
  (145, 'fila con razon_natural de 201 caracteres', false,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_clave, estado_meta, razon_natural)
       select p.id, 'f003', 'libre', repeat('r', 201) from ia_propuestas_gm p where p.gm_clave = 'GM-UNO' $q$),
  (146, 'fila con fila_clave de 301 caracteres', false,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_clave, estado_meta)
       select p.id, repeat('k', 301), 'libre' from ia_propuestas_gm p where p.gm_clave = 'GM-UNO' $q$),
  (147, 'fila con fila_id inexistente (FK)', false,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_id, fila_clave, estado_meta)
       select p.id, gen_random_uuid(), 'f004', 'libre' from ia_propuestas_gm p where p.gm_clave = 'GM-UNO' $q$),
  (148, 'fila con estado_meta y confianza fuera de catalogo (sin check)', true,
   $q$ insert into public.ia_propuestas_filas (propuesta_gm_id, fila_clave, estado_meta, confianza)
       select p.id, 'f005', 'estado_futuro', 'confianza_futura' from ia_propuestas_gm p where p.gm_clave = 'GM-UNO' $q$);

do $$
declare
  c record;
  v_aceptada boolean;
begin
  for c in select * from casos where n >= 100 order by n loop
    begin
      execute c.sentencia;
      v_aceptada := true;
    exception when others then
      v_aceptada := false;
      raise notice 'caso % rechazado: %', c.n, sqlerrm;
    end;
    update casos set ok = (v_aceptada = esperado_ok) where n = c.n;
  end loop;
end
$$;

insert into r (caso, ok) select 'tablas de trabajo e inmutables: ' || caso, ok from casos where n >= 100 order by n;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. Inmutabilidad (R19): update, delete y truncate fallan; solo se admite poner en NULL una FK set null
-- ---------------------------------------------------------------------------------------------------------------------
-- Se corre como superusuario: el trigger rechaza a TODOS los roles (el permiso no interviene).
create temp table tr (k text primary key, m text);
insert into tr select 'entradas', pg_temp.msg($q$ truncate table public.ia_entradas cascade $q$);
insert into tr select 'llamadas', pg_temp.msg($q$ truncate table public.ia_llamadas $q$);
insert into tr select 'llamadas_cascade', pg_temp.msg($q$ truncate table public.ia_llamadas cascade $q$);
insert into tr select 'propuestas_gm', pg_temp.msg($q$ truncate table public.ia_propuestas_gm cascade $q$);
insert into tr select 'propuestas_filas', pg_temp.msg($q$ truncate table public.ia_propuestas_filas cascade $q$);
insert into r (caso, ok)
select 'truncate de ' || k || ' rechazado por el trigger por sentencia (tambien con cascade, que alcanza a las tablas con FK)', m like '%inmutable%'
from tr order by k;

insert into r (caso, ok) values
  ('ia_entradas: update rechazado por el trigger',
    pg_temp.falla($q$ update public.ia_entradas set bytes = 999 $q$, '%inmutable%')),
  ('ia_entradas: delete rechazado por el trigger',
    pg_temp.falla($q$ delete from public.ia_entradas $q$, '%inmutable%')),
  ('ia_llamadas: update rechazado',
    pg_temp.falla($q$ update public.ia_llamadas set costo_usd = 0 $q$, '%inmutable%')),
  ('ia_llamadas: update que pone perfil_id en NULL Y cambia otra columna, rechazado',
    pg_temp.falla($q$ update public.ia_llamadas set perfil_id = null, costo_usd = 0 $q$, '%inmutable%')),
  ('ia_llamadas: delete rechazado',
    pg_temp.falla($q$ delete from public.ia_llamadas $q$, '%inmutable%')),
  ('ia_propuestas_gm: update rechazado',
    pg_temp.falla($q$ update public.ia_propuestas_gm set razon_gm = 'cambiada' $q$, '%inmutable%')),
  ('ia_propuestas_gm: delete rechazado',
    pg_temp.falla($q$ delete from public.ia_propuestas_gm $q$, '%inmutable%')),
  ('ia_propuestas_filas: update rechazado',
    pg_temp.falla($q$ update public.ia_propuestas_filas set razon = 'cambiada' $q$, '%inmutable%')),
  ('ia_propuestas_filas: delete rechazado',
    pg_temp.falla($q$ delete from public.ia_propuestas_filas $q$, '%inmutable%')),
  ('ia_propuestas_filas: update que pone fila_id en un valor distinto (no NULL) rechazado',
    pg_temp.falla($q$ update public.ia_propuestas_filas set fila_id = (select fila2 from ids) where fila_clave = 'FILA H30L1' $q$, '%inmutable%')),
  ('las 4 tablas inmutables siguen intactas tras los intentos',
    (select count(*) from ia_entradas) = 3 and (select count(*) from ia_llamadas) = 2
    and (select count(*) from ia_propuestas_gm) = 1 and (select count(*) from ia_propuestas_filas) = 3);

-- Las excepciones: poner en NULL una FK `set null` (lo que emiten las FK al borrar un usuario, una proyeccion o una fila).
-- Cada acción se ejecuta en su propia sentencia ANTES de leer el resultado (las subconsultas de un mismo insert se evalúan
-- antes que las funciones del select).
create temp table ac (k text primary key, ok boolean);
insert into ac select 'llam_perfil', pg_temp.acepta($q$ update public.ia_llamadas set perfil_id = null where perfil_id is not null $q$);
insert into ac select 'prop_null', pg_temp.acepta($q$ update public.ia_propuestas_gm set perfil_id = null, proyeccion_id = null $q$);
insert into ac select 'fila_null', pg_temp.acepta($q$ update public.ia_propuestas_filas set fila_id = null where fila_id is not null $q$);

insert into r (caso, ok) values
  ('ia_llamadas: update que SOLO pone perfil_id en NULL se acepta',
    (select ok from ac where k = 'llam_perfil') and (select count(*) from ia_llamadas where perfil_id is not null) = 0),
  ('ia_llamadas: volver a poner un perfil (NULL a valor) rechazado',
    pg_temp.falla($q$ update public.ia_llamadas set perfil_id = (select perfil_a from ids) $q$, '%inmutable%')),
  ('ia_propuestas_gm: update que SOLO pone proyeccion_id y perfil_id en NULL se acepta',
    (select ok from ac where k = 'prop_null')
    and (select count(*) from ia_propuestas_gm where perfil_id is null and proyeccion_id is null) = 1),
  ('ia_propuestas_filas: update que SOLO pone fila_id en NULL se acepta',
    (select ok from ac where k = 'fila_null') and (select count(*) from ia_propuestas_filas where fila_id is null) = 3);

-- Y de verdad por las FK: borrar un perfil, una proyeccion y una fila base deja el historial, con el vinculo en NULL.
insert into ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms, perfil_id)
select b.corrida_a, c.gm1, 'r1', 'reparto', 1, repeat('7', 64), 'ok', 1, 1, 1, i.perfil_b from b, c, ids i;
insert into ia_propuestas_filas (propuesta_gm_id, fila_id, fila_clave, estado_meta)
select p.id, i.fila2, 'FILA H30L2', 'libre' from ia_propuestas_gm p, ids i where p.gm_clave = 'GM-UNO';
insert into ac select 'del_perfil', pg_temp.acepta($q$ delete from public.perfiles where id = (select perfil_b from ids) $q$);
insert into ac select 'del_fila', pg_temp.acepta($q$ delete from public.proyeccion_filas where id = (select fila2 from ids) $q$);
insert into ac select 'del_proy', pg_temp.acepta($q$ delete from public.proyecciones where id = (select proy_b from ids) $q$);
insert into r (caso, ok) values
  ('borrar un perfil (FK set null) no falla por la inmutabilidad: la llamada queda con perfil_id NULL',
    (select ok from ac where k = 'del_perfil') and (select perfil_id is null from ia_llamadas where huella_llamada = repeat('7', 64))),
  ('borrar una fila base (FK set null) deja la fila de propuesta con fila_clave y fila_id NULL',
    (select ok from ac where k = 'del_fila') and (select fila_id is null from ia_propuestas_filas where fila_clave = 'FILA H30L2')),
  ('borrar una proyeccion (FK set null) deja la corrida en_curso y sus propuestas con proyeccion_id NULL',
    (select ok from ac where k = 'del_proy')
    and (select proyeccion_id is null from ia_corridas where id = (select corrida_b from b))
    and (select count(*) from ia_corrida_gms where id = (select gm_b1 from c)) = 1);

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. Estados terminales (tg_ia_terminal)
-- ---------------------------------------------------------------------------------------------------------------------
create temp table t as
select
  (select id from ia_evaluaciones where estado = 'completa') as ev_completa,
  (select id from ia_evaluaciones where estado = 'en_curso') as ev_curso;

insert into r (caso, ok) values
  ('evaluacion en_curso: se puede completar (update de estado y veredicto)',
    pg_temp.acepta($q$ update public.ia_evaluaciones set estado = 'completa', veredicto = '{"distribucion_y1": "no_gana", "regla_que_fallo": "mejora"}'::jsonb, terminada_at = now() where id = (select ev_curso from t) $q$)),
  ('evaluacion completa: no se reescribe (estado)',
    pg_temp.falla($q$ update public.ia_evaluaciones set estado = 'en_curso' where id = (select ev_curso from t) $q$, '%no admite cambios%')),
  ('evaluacion completa: no se reescribe (veredicto)',
    pg_temp.falla($q$ update public.ia_evaluaciones set veredicto = '{"distribucion_y1": "gana"}'::jsonb where id = (select ev_completa from t) $q$, '%no admite cambios%')),
  ('evaluacion completa: no se borra',
    pg_temp.falla($q$ delete from public.ia_evaluaciones where id = (select ev_completa from t) $q$, '%no admite cambios%')),
  ('una evaluacion completa no impide crear otra en_curso (la unica en_curso ya termino)',
    pg_temp.acepta($q$ insert into public.ia_evaluaciones (proveedor, modelo, version_prompt, parametros) values ('p', 'm5', 'v1', '{}'::jsonb) $q$));

-- Corrida: en_curso -> detenida, luego congelada salvo las FK set null.
update ia_corridas set estado = 'detenida', motivo_fin = 'tope_mensual', terminada_at = now() where id = (select corrida_a from b);
insert into r (caso, ok) values
  ('corrida detenida: cambiar motivo_fin rechazado',
    pg_temp.falla($q$ update public.ia_corridas set motivo_fin = 'otro' where id = (select corrida_a from b) $q$, '%no admite cambios%')),
  ('corrida detenida: volver a en_curso rechazado',
    pg_temp.falla($q$ update public.ia_corridas set estado = 'en_curso' where id = (select corrida_a from b) $q$, '%no admite cambios%')),
  ('corrida detenida: delete rechazado',
    pg_temp.falla($q$ delete from public.ia_corridas where id = (select corrida_a from b) $q$, '%no admite cambios%')),
  ('corrida detenida: poner proyeccion_id y perfil_id en NULL se acepta (FK set null)',
    pg_temp.acepta($q$ update public.ia_corridas set proyeccion_id = null, perfil_id = null where id = (select corrida_a from b) $q$)),
  ('corrida detenida: poner proyeccion_id en un valor (no NULL) rechazado',
    pg_temp.falla($q$ update public.ia_corridas set proyeccion_id = (select proy_a from ids) where id = (select corrida_a from b) $q$, '%no admite cambios%'));

-- GM: hecho o reusado congelados; en_proceso mutable.
update ia_corrida_gms set estado = 'hecho', candado_token = null where id = (select gm3 from c);
insert into r (caso, ok) values
  ('GM en_proceso: se puede mutar (parcial) sin restriccion',
    pg_temp.acepta($q$ update public.ia_corrida_gms set parcial = '{"n1": {"filas": 1}}'::jsonb where id = (select gm2 from c) $q$)),
  ('GM hecho: update rechazado',
    pg_temp.falla($q$ update public.ia_corrida_gms set error_codigo = 'x' where id = (select gm3 from c) $q$, '%no admite cambios%')),
  ('GM hecho: delete rechazado',
    pg_temp.falla($q$ delete from public.ia_corrida_gms where id = (select gm3 from c) $q$, '%no admite cambios%')),
  ('GM fallido: sigue mutable (se puede reintentar)',
    pg_temp.acepta($q$ update public.ia_corrida_gms set estado = 'fallido' where id = (select gm2 from c) $q$)
    and pg_temp.acepta($q$ update public.ia_corrida_gms set estado = 'pendiente' where id = (select gm2 from c) $q$));

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. proyeccion_fila_anios.decision_ia_fila_id y su check (R19)
-- ---------------------------------------------------------------------------------------------------------------------
-- Una fila propuesta valida para apuntar (la de la propuesta GM-UNO, fila_clave 'FILA H30L1').
create temp table d as
select (select id from ia_propuestas_filas where fila_clave = 'FILA H30L1') as pf,
       (select a.id from proyeccion_fila_anios a join ids i on a.fila_id = i.fila1 where a.anio = 2027) as anio1;

insert into r (caso, ok) values
  ('decision_ia_fila_id: una fila 2027 sin decidir lo tiene nulo (inocuo para 0.13.x y 0.14.x)',
    (select decision_ia_fila_id is null from proyeccion_fila_anios where id = (select anio1 from d))),
  ('decision_ia_fila_id con origen = propuesta rechazado por el check',
    pg_temp.falla($q$ update public.proyeccion_fila_anios set decidido = 5, origen = 'propuesta', decision_ia_fila_id = (select pf from d) where id = (select anio1 from d) $q$, '%decision_ia_origen_check%')),
  ('decision_ia_fila_id con origen = escalada rechazado por el check',
    pg_temp.falla($q$ update public.proyeccion_fila_anios set decidido = 5, origen = 'escalada', decision_ia_fila_id = (select pf from d) where id = (select anio1 from d) $q$, '%decision_ia_origen_check%')),
  ('decision_ia_fila_id con decidido nulo (origen nulo) rechazado por el check',
    pg_temp.falla($q$ update public.proyeccion_fila_anios set decision_ia_fila_id = (select pf from d) where id = (select anio1 from d) $q$)),
  ('decision_ia_fila_id con un id que no existe: FK rechazada',
    pg_temp.falla($q$ update public.proyeccion_fila_anios set decidido = 5, origen = 'manual', decision_ia_fila_id = gen_random_uuid() where id = (select anio1 from d) $q$, '%foreign key%')),
  ('decision_ia_fila_id con origen = manual y una propuesta existente: se acepta',
    pg_temp.acepta($q$ update public.proyeccion_fila_anios set decidido = 1190, origen = 'manual', decision_ia_fila_id = (select pf from d) where id = (select anio1 from d) $q$)),
  ('la propuesta aceptada no se puede borrar: el trigger de inmutabilidad lo rechaza (y la FK restrict tambien)',
    pg_temp.falla($q$ delete from public.ia_propuestas_filas where id = (select pf from d) $q$)),
  ('cualquier otra decision vuelve la columna a nulo: se acepta (cifra manual sin traza)',
    pg_temp.acepta($q$ update public.proyeccion_fila_anios set decidido = 1200, origen = 'manual', decision_ia_fila_id = null where id = (select anio1 from d) $q$)),
  ('volver a la propuesta (decidido y origen nulos) con la columna nula: se acepta',
    pg_temp.acepta($q$ update public.proyeccion_fila_anios set decidido = null, origen = null, decision_ia_fila_id = null where id = (select anio1 from d) $q$));

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. venta_lineas_ia: forma, solo unidades, tiendas, rango, claves, GML y GMLE
-- ---------------------------------------------------------------------------------------------------------------------
-- Grupos: T1 = '11111', T2 = '00001', el CD no figura. Nodo GML (L1) y nodo GMLE (L2) a la vez.
create temp table vl as
select public.venta_lineas_ia(
         array[i.gml1, i.gml2],
         jsonb_build_object(i.t1::text, '11111', i.t2::text, '00001'),
         date '2025-01-01', date '2025-03-01') as j
from ids i;

-- Helper: desarma la salida en tuplas legibles (gml, agrupacion, equivalencia, clave, mes, unidades).
create temp table vl_tuplas as
select
  (j #>> array['dic', 'filas', (f.v)::text, '0'])::uuid as gml_id,
  (j #>> array['dic', 'filas', (f.v)::text, '1'])::uuid as agrupacion_marca_id,
  (j #>> array['dic', 'filas', (f.v)::text, '2'])::uuid as equivalencia_id,
  j #>> array['dic', 'claves', (c.v)::text] as clave,
  (date '2025-01-01' + make_interval(months => ((j #>> array['p', (f.ord - 1)::text])::int))) as mes,
  (j #>> array['u', (f.ord - 1)::text])::bigint as unidades
from vl,
  lateral jsonb_array_elements_text(j -> 'f') with ordinality as f(v, ord)
  join lateral jsonb_array_elements_text(j -> 'c') with ordinality as c(v, ord2) on c.ord2 = f.ord;

insert into r (caso, ok) values
  ('venta_lineas_ia: claves de primer nivel exactamente dic, f, c, p, u, cargas',
    (select array(select jsonb_object_keys(j) order by 1) = array['c', 'cargas', 'dic', 'f', 'p', 'u'] from vl)),
  ('venta_lineas_ia: dic trae exactamente filas, claves y desde',
    (select array(select jsonb_object_keys(j -> 'dic') order by 1) = array['claves', 'desde', 'filas'] from vl)),
  ('venta_lineas_ia: los arreglos f, c, p y u miden lo mismo',
    (select jsonb_array_length(j -> 'f') = jsonb_array_length(j -> 'c') and jsonb_array_length(j -> 'c') = jsonb_array_length(j -> 'p')
        and jsonb_array_length(j -> 'p') = jsonb_array_length(j -> 'u') and jsonb_array_length(j -> 'u') > 0 from vl)),
  ('venta_lineas_ia: la salida NO contiene soles, costo, stock ni venta (solo unidades): ni en claves ni en el texto',
    (select j::text !~* '(soles|costo|stock|valoriz|venta)' from vl)),
  ('venta_lineas_ia: dic.desde es el primer periodo con datos (2025-01-01)',
    (select j #>> '{dic,desde}' = '2025-01-01' from vl)),
  ('venta_lineas_ia: el CD no cuenta (99 u de EQ1 ene en el CD no aparecen) y la carga en curso tampoco (1000 u)',
    (select coalesce(sum(unidades), 0) from vl_tuplas) = 15 + 7 + 4 + 6 + 3 + 2),
  ('venta_lineas_ia: marca miembro suma en la cabeza: EQ1 ene clave 11111 = 10 (miembro) + 5 (cabeza) = 15 en la agrupacion de la cabeza',
    (select unidades from vl_tuplas t, ids i where t.gml_id = i.gml1 and t.agrupacion_marca_id = i.ag1 and t.clave = '11111' and t.mes = date '2025-01-01') = 15),
  ('venta_lineas_ia: T2 (clave 00001) en la agrupacion 2 en enero = 7',
    (select unidades from vl_tuplas t, ids i where t.gml_id = i.gml1 and t.agrupacion_marca_id = i.ag2 and t.clave = '00001' and t.mes = date '2025-01-01') = 7),
  ('venta_lineas_ia: nodo GML (L1): equivalencia_id es nulo y se suma todo el nodo (EQ1 + EQ2)',
    (select count(*) from vl_tuplas t, ids i where t.gml_id = i.gml1 and t.equivalencia_id is null) = 4
    and (select sum(unidades) from vl_tuplas t, ids i where t.gml_id = i.gml1) = 15 + 7 + 4 + 6),
  ('venta_lineas_ia: nodo GMLE (L2): lleva la equivalencia',
    (select count(*) from vl_tuplas t, ids i where t.gml_id = i.gml2 and t.equivalencia_id = i.eq3) = 2
    and (select sum(unidades) from vl_tuplas t, ids i where t.gml_id = i.gml2) = 5),
  ('venta_lineas_ia: dic.claves ordenadas y sin repetir (00001, 11111)',
    (select j #> '{dic,claves}' = '["00001", "11111"]'::jsonb from vl)),
  ('venta_lineas_ia: cargas solo de las publicadas del rango (3), no la en curso',
    (select jsonb_typeof(j -> 'cargas') = 'object' and (select count(*) from jsonb_object_keys(j -> 'cargas')) = 3
        and not (j -> 'cargas' ? '2025-04') from vl)),
  ('venta_lineas_ia: cargas trae el id de la carga publicada del mes',
    (select (j #>> '{cargas,2025-02}')::uuid = (select id from cargas_venta_stock where periodo = date '2025-02-01') from vl));

-- Rango: p_hasta corta en SQL (un pliegue no ve meses posteriores) y p_desde recorta el inicio.
create temp table vl2 as
select public.venta_lineas_ia(array[i.gml1, i.gml2], jsonb_build_object(i.t1::text, '11111', i.t2::text, '00001'), date '2025-01-01', date '2025-01-31') as j_hasta,
       public.venta_lineas_ia(array[i.gml1, i.gml2], jsonb_build_object(i.t1::text, '11111', i.t2::text, '00001'), date '2025-02-01', null) as j_desde,
       public.venta_lineas_ia(array[i.gml1, i.gml2], jsonb_build_object(i.t1::text, '11111', i.t2::text, '00001'), null, null) as j_todo,
       public.venta_lineas_ia(array[i.gml1, i.gml2], jsonb_build_object(i.t1::text, '11111', i.t2::text, '00001'), date '2025-01-01', date '2025-03-01') as j_igual,
       public.venta_lineas_ia(array[]::uuid[], '{}'::jsonb, date '2025-01-01', date '2025-03-01') as j_vacio,
       public.venta_lineas_ia(array[i.gml1], '{}'::jsonb, date '2025-01-01', date '2025-01-01') as j_sin_grupos
from ids i;

insert into r (caso, ok) values
  ('venta_lineas_ia: p_hasta = 2025-01-31 solo deja enero (15 + 7 + 3 u) y sus cargas',
    (select (select sum(x::bigint) from jsonb_array_elements_text(j_hasta -> 'u') x) = 25
        and (select count(*) from jsonb_object_keys(j_hasta -> 'cargas')) = 1 from vl2)),
  ('venta_lineas_ia: p_desde = 2025-02-01 sin hasta deja feb y mar (4 + 6 + 2) y dic.desde = 2025-02-01',
    (select (select sum(x::bigint) from jsonb_array_elements_text(j_desde -> 'u') x) = 12
        and j_desde #>> '{dic,desde}' = '2025-02-01' from vl2)),
  ('venta_lineas_ia: sin limites no se queda con la carga en curso (abril 2025 sigue fuera)',
    (select (select sum(x::bigint) from jsonb_array_elements_text(j_todo -> 'u') x) = 37 from vl2)),
  ('venta_lineas_ia: determinista (mismos datos, mismo documento)',
    (select j_igual = (select j from vl) from vl2)),
  ('venta_lineas_ia: sin nodos devuelve arreglos vacios, claves y filas vacias, desde nulo y cargas del rango',
    (select j_vacio -> 'f' = '[]'::jsonb and j_vacio -> 'u' = '[]'::jsonb and j_vacio #> '{dic,filas}' = '[]'::jsonb
        and j_vacio #> '{dic,claves}' = '[]'::jsonb and j_vacio #> '{dic,desde}' = 'null'::jsonb and jsonb_typeof(j_vacio -> 'cargas') = 'object' from vl2)),
  ('venta_lineas_ia: una tienda sin clave en p_grupos toma 00000',
    (select j_sin_grupos #> '{dic,claves}' = '["00000"]'::jsonb from vl2));

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. registrar_propuesta_ia_gm (R16)
-- ---------------------------------------------------------------------------------------------------------------------
-- Se arma un escenario aparte: una corrida nueva (la A quedó detenida arriba) en la proyección A.
create temp table e as select gen_random_uuid() as corrida_ok, gen_random_uuid() as corrida_cerrada;
insert into ia_corridas (id, tipo, proyeccion_id, proveedor, modelo, version_prompt, alcance, costo_estimado_usd, perfil_id)
select e.corrida_ok, 'propuesta', i.proy_a, 'proveedor-x', 'modelo-1', 'v1', '{}'::jsonb, 2, i.perfil_a from e, ids i;
insert into ia_corridas (id, tipo, proveedor, modelo, version_prompt, alcance, costo_estimado_usd, estado, terminada_at)
select e.corrida_cerrada, 'evaluacion', 'proveedor-x', 'modelo-1', 'v1', '{}'::jsonb, 2, 'cancelada', now() from e;
update ia_corridas set ultima_actividad_at = now() - interval '1 hour' where id = (select corrida_ok from e);

insert into ia_corrida_gms (corrida_id, gm_clave, estado, candado_token, candado_desde, pliegue)
select corrida_ok, 'GM-UNO', 'en_proceso', '00000000-0000-4000-8000-0000000000a1'::uuid, now(), '' from e
union all select corrida_ok, 'GM-ERROR', 'en_proceso', '00000000-0000-4000-8000-0000000000a2'::uuid, now(), '' from e
union all select corrida_ok, 'GM-DOS', 'pendiente', null::uuid, null::timestamptz, '' from e
union all select corrida_ok, 'GM-REUSO', 'en_proceso', '00000000-0000-4000-8000-0000000000a4'::uuid, now(), '' from e
union all select corrida_ok, 'GM-SR', 'en_proceso', '00000000-0000-4000-8000-0000000000a5'::uuid, now(), '' from e
union all select corrida_cerrada, 'GM-CERR', 'en_proceso', '00000000-0000-4000-8000-0000000000a3'::uuid, now(), 'D25' from e;

create temp table g as
select
  (select id from ia_corrida_gms where gm_clave = 'GM-UNO' and corrida_id = (select corrida_ok from e)) as gm_ok,
  (select id from ia_corrida_gms where gm_clave = 'GM-ERROR') as gm_error,
  (select id from ia_corrida_gms where gm_clave = 'GM-DOS' and corrida_id = (select corrida_ok from e)) as gm_pend,
  (select id from ia_corrida_gms where gm_clave = 'GM-REUSO') as gm_reuso,
  (select id from ia_corrida_gms where gm_clave = 'GM-SR') as gm_sr,
  (select id from ia_corrida_gms where gm_clave = 'GM-CERR') as gm_cerr;

-- Payload de prueba: dos filas (una libre con fila_id real, otra fija sin fila_id).
create or replace function pg_temp.payload(p_gm uuid, p_token text, p_clave text, p_filas jsonb default null) returns jsonb language sql as $f$
  select jsonb_build_object(
    'corrida_gm_id', p_gm, 'candado_token', p_token,
    'propuesta', jsonb_build_object(
      'genero_id', i.genero, 'mundo_id', i.mundo, 'es_resto', false, 'capacidades', jsonb_build_array('distribucion_y1'),
      'modo', 'directo', 'version_metodo', 5, 'meta', jsonb_build_object('pct', 8, 'meta_gm', 1000),
      'huella_gm', repeat('a', 64), 'huella_historia', repeat('b', 64), 'razon_gm', 'razon del GM',
      'banderas_gm', jsonb_build_array('meta_exigente'), 'avisos', jsonb_build_array(), 'filas_pedidas', 2, 'filas_validas', 2,
      'desvio_suma_modelo', 0.0035, 'perfil_id', i.perfil_a, 'usuario_nombre', 'Humo 30 A'),
    'filas', coalesce(p_filas, jsonb_build_array(
      jsonb_build_object('fila_id', i.fila1, 'fila_clave', p_clave || '-1', 'estado_meta', 'libre', 'base_al_generar', 1000.5,
        'base_corregida_al_generar', 1100, 'p_gm_al_generar', 1188, 'natural_y1', 1150, 'razon_natural', 'natural',
        'meta_y1_modelo', 1200, 'meta_y1_al_generar', 1190, 'razon', 'razon', 'banderas', jsonb_build_array('quiebres'),
        'senales', jsonb_build_array('nino'), 'avisos', jsonb_build_array(), 'confianza', 'alta'),
      jsonb_build_object('fila_clave', p_clave || '-2', 'estado_meta', 'fija_decidida', 'aporte_fijo_al_generar', 300)
    )))
  from ids i
$f$;

-- 8.a token equivocado: IA001, nada insertado
create temp table sal (k text primary key, v text);
do $$
declare
  v_antes int := (select count(*) from public.ia_propuestas_gm);
  v_msg text; v_state text;
begin
  begin
    perform public.registrar_propuesta_ia_gm(pg_temp.payload((select gm_ok from g), '00000000-0000-4000-8000-00000000dead', 'A'));
  exception when others then v_msg := sqlerrm; v_state := sqlstate;
  end;
  insert into sal values ('token_msg', v_msg), ('token_state', v_state), ('token_delta', ((select count(*) from public.ia_propuestas_gm) - v_antes)::text);
end
$$;

-- 8.b GM en estado pendiente (sin candado): IA001
do $$
declare v_msg text; v_state text;
begin
  begin
    perform public.registrar_propuesta_ia_gm(pg_temp.payload((select gm_pend from g), '00000000-0000-4000-8000-0000000000a1', 'P'));
  exception when others then v_msg := sqlerrm; v_state := sqlstate;
  end;
  insert into sal values ('pend_msg', v_msg), ('pend_state', v_state);
end
$$;

-- 8.c corrida terminada: IA002, nada insertado
do $$
declare
  v_antes int := (select count(*) from public.ia_propuestas_gm);
  v_msg text; v_state text;
begin
  begin
    perform public.registrar_propuesta_ia_gm(pg_temp.payload((select gm_cerr from g), '00000000-0000-4000-8000-0000000000a3', 'C'));
  exception when others then v_msg := sqlerrm; v_state := sqlstate;
  end;
  insert into sal values ('cerr_msg', v_msg), ('cerr_state', v_state), ('cerr_delta', ((select count(*) from public.ia_propuestas_gm) - v_antes)::text);
end
$$;

-- 8.d error a mitad (la segunda fila apunta a una fila_id inexistente: FK): no queda propuesta parcial y el GM sigue en_proceso
do $$
declare
  v_antes_gm int := (select count(*) from public.ia_propuestas_gm);
  v_antes_filas int := (select count(*) from public.ia_propuestas_filas);
  v_msg text; v_state text;
begin
  begin
    perform public.registrar_propuesta_ia_gm(pg_temp.payload((select gm_error from g), '00000000-0000-4000-8000-0000000000a2', 'E',
      jsonb_build_array(
        jsonb_build_object('fila_id', (select fila1 from ids), 'fila_clave', 'E-1', 'estado_meta', 'libre'),
        jsonb_build_object('fila_id', gen_random_uuid(), 'fila_clave', 'E-2', 'estado_meta', 'libre'))));
  exception when others then v_msg := sqlerrm; v_state := sqlstate;
  end;
  insert into sal values ('mitad_state', v_state),
    ('mitad_delta_gm', ((select count(*) from public.ia_propuestas_gm) - v_antes_gm)::text),
    ('mitad_delta_filas', ((select count(*) from public.ia_propuestas_filas) - v_antes_filas)::text),
    ('mitad_gm', (select estado || '/' || (candado_token is not null)::text || '/' || (propuesta_gm_id is null)::text from public.ia_corrida_gms where id = (select gm_error from g)));
end
$$;

-- 8.e éxito
do $$
declare v_id uuid;
begin
  v_id := public.registrar_propuesta_ia_gm(pg_temp.payload((select gm_ok from g), '00000000-0000-4000-8000-0000000000a1', 'OK'));
  insert into sal values ('ok_id', v_id::text);
end
$$;

-- 8.f reuso de una propuesta de otra corrida con el mismo gm_clave (GM-UNO), y con un gm_clave distinto (IA003)
do $$
declare
  v_ok uuid := (select id from public.ia_propuestas_gm where corrida_gm_id = (select gm_ok from g));
  v_id uuid;
  v_antes int := (select count(*) from public.ia_propuestas_gm);
  v_antes_f int := (select count(*) from public.ia_propuestas_filas);
  v_msg text; v_state text;
begin
  begin
    perform public.registrar_propuesta_ia_gm(jsonb_build_object('corrida_gm_id', (select gm_reuso from g),
      'candado_token', '00000000-0000-4000-8000-0000000000a4', 'reusa_propuesta_id', v_ok, 'huella_gm', repeat('c', 64)));
  exception when others then v_msg := sqlerrm; v_state := sqlstate;
  end;
  insert into sal values ('reuso_otro_state', v_state);
  update public.ia_corrida_gms set gm_clave = 'GM-UNO', pliegue = 'R' where id = (select gm_reuso from g);
  v_id := public.registrar_propuesta_ia_gm(jsonb_build_object('corrida_gm_id', (select gm_reuso from g),
    'candado_token', '00000000-0000-4000-8000-0000000000a4', 'reusa_propuesta_id', v_ok, 'huella_gm', repeat('c', 64)));
  insert into sal values ('reuso_id', v_id::text), ('reuso_ok', v_ok::text),
    ('reuso_delta', ((select count(*) from public.ia_propuestas_gm) - v_antes)::text),
    ('reuso_delta_f', ((select count(*) from public.ia_propuestas_filas) - v_antes_f)::text);
end
$$;

insert into r (caso, ok) values
  ('registrar: token equivocado -> SQLSTATE IA001 gm_en_proceso y nada insertado',
    (select v from sal where k = 'token_msg') = 'gm_en_proceso' and (select v from sal where k = 'token_state') = 'IA001'
    and (select v from sal where k = 'token_delta') = '0'),
  ('registrar: GM que no esta en_proceso (pendiente, sin candado) -> IA001',
    (select v from sal where k = 'pend_state') = 'IA001'),
  ('registrar: corrida terminada -> SQLSTATE IA002 corrida_terminada y nada insertado',
    (select v from sal where k = 'cerr_msg') = 'corrida_terminada' and (select v from sal where k = 'cerr_state') = 'IA002'
    and (select v from sal where k = 'cerr_delta') = '0'),
  ('registrar: error a mitad (FK de la segunda fila) -> falla, no queda propuesta ni filas parciales y el GM sigue en_proceso con su candado',
    (select v from sal where k = 'mitad_state') is not null
    and (select v from sal where k = 'mitad_delta_gm') = '0' and (select v from sal where k = 'mitad_delta_filas') = '0'
    and (select v from sal where k = 'mitad_gm') = 'en_proceso/true/true'),
  ('registrar: exito devuelve el id de la propuesta',
    (select v::uuid from sal where k = 'ok_id') = (select id from ia_propuestas_gm where corrida_gm_id = (select gm_ok from g))),
  ('registrar: el GM queda hecho con propuesta_gm_id, candado suelto y huella_gm',
    (select estado = 'hecho' and propuesta_gm_id = (select v::uuid from sal where k = 'ok_id') and candado_token is null and candado_desde is null
            and huella_gm = repeat('a', 64) from ia_corrida_gms where id = (select gm_ok from g))),
  ('registrar: inserta la propuesta y sus 2 filas (libre y fija) con confianza y senales',
    (select count(*) from ia_propuestas_filas where propuesta_gm_id = (select v::uuid from sal where k = 'ok_id')) = 2
    and (select confianza = 'alta' and senales = array['nino'] and banderas = array['quiebres'] and base_corregida_al_generar = 1100
           from ia_propuestas_filas where fila_clave = 'OK-1')
    and (select estado_meta = 'fija_decidida' and fila_id is null and aporte_fijo_al_generar = 300 and banderas = '{}'
           from ia_propuestas_filas where fila_clave = 'OK-2')),
  ('registrar: proyeccion_id, proveedor, modelo y version_prompt salen de la corrida (no del payload) y pliegue/gm_clave del GM',
    (select p.proyeccion_id = (select proy_a from ids) and p.proveedor = 'proveedor-x' and p.modelo = 'modelo-1' and p.version_prompt = 'v1'
            and p.gm_clave = 'GM-UNO' and p.pliegue = '' and p.corrida_id = (select corrida_ok from e)
            and p.capacidades = array['distribucion_y1'] and p.banderas_gm = array['meta_exigente'] and p.desvio_suma_modelo = 0.0035
       from ia_propuestas_gm p where p.id = (select v::uuid from sal where k = 'ok_id'))),
  ('registrar: toca ultima_actividad_at de la corrida',
    (select ultima_actividad_at > now() - interval '1 minute' from ia_corridas where id = (select corrida_ok from e))),
  ('registrar: repetir con el mismo token (GM ya hecho) -> IA001',
    pg_temp.falla($q$ select public.registrar_propuesta_ia_gm(pg_temp.payload((select gm_ok from g), '00000000-0000-4000-8000-0000000000a1', 'OK')) $q$, 'gm_en_proceso')),
  ('registrar (reuso): una propuesta de otro gm_clave -> IA003 propuesta_no_reusable',
    (select v from sal where k = 'reuso_otro_state') = 'IA003'),
  ('registrar (reuso): no inserta propuesta ni filas; apunta a la reusada y deja el GM en reusado',
    (select v from sal where k = 'reuso_id') = (select v from sal where k = 'reuso_ok')
    and (select v from sal where k = 'reuso_delta') = '0' and (select v from sal where k = 'reuso_delta_f') = '0'
    and (select estado = 'reusado' and propuesta_gm_id = (select v::uuid from sal where k = 'reuso_ok') and candado_token is null and huella_gm = repeat('c', 64)
           from ia_corrida_gms where id = (select gm_reuso from g))),
  ('un GM reusado queda congelado (tg_ia_terminal)',
    pg_temp.falla($q$ update public.ia_corrida_gms set estado = 'pendiente' where id = (select gm_reuso from g) $q$, '%no admite cambios%'));

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. Pasada completa como `service_role` (el rol con el que corre la API) y permisos de anon y authenticated
-- ---------------------------------------------------------------------------------------------------------------------
-- En el clúster local `service_role` no tiene BYPASSRLS (en Supabase sí): se le concede dentro de la transacción (el
-- `rollback` lo deshace).
alter role service_role bypassrls;
grant usage on schema public to service_role, anon, authenticated;
grant select on r, ids, g, e, b, c, sal to service_role, anon, authenticated;

do $$
declare
  v_venta jsonb;
  v_id uuid;
  v_ins boolean := false;
  v_upd boolean := false;
  v_del boolean := false;
  v_trunc boolean := false;
begin
  set local role service_role;
  v_venta := public.venta_lineas_ia(array[(select gml1 from ids)], jsonb_build_object((select t1 from ids)::text, '11111'), date '2025-01-01', date '2025-03-01');
  v_id := public.registrar_propuesta_ia_gm(pg_temp.payload((select gm_sr from g), '00000000-0000-4000-8000-0000000000a5', 'SR'));
  insert into public.ia_llamadas (corrida_id, corrida_gm_id, paso, tipo_llamada, intento, huella_llamada, estado, bytes_entrada, filas_enviadas, duracion_ms)
    select (select corrida_ok from e), (select gm_sr from g), 'n1', 'natural', 1, repeat('5', 64), 'ok', 1, 1, 1;
  v_ins := true;
  begin update public.ia_llamadas set costo_usd = 9 where huella_llamada = repeat('5', 64); exception when others then v_upd := sqlerrm like '%inmutable%'; end;
  begin delete from public.ia_propuestas_gm where id = v_id; exception when others then v_del := sqlerrm like '%inmutable%'; end;
  begin truncate table public.ia_llamadas; exception when others then v_trunc := sqlerrm like '%inmutable%'; end;
  reset role;
  insert into r (caso, ok) values
    ('service_role: venta_lineas_ia y registrar_propuesta_ia_gm funcionan (permisos de funcion y de tablas)',
      jsonb_array_length(v_venta -> 'u') > 0 and v_id is not null and v_ins),
    ('service_role: update sobre ia_llamadas lo rechaza el trigger (no el permiso)', v_upd),
    ('service_role: delete sobre ia_propuestas_gm lo rechaza el trigger (no el permiso)', v_del),
    ('service_role: truncate sobre ia_llamadas lo rechaza el trigger (no el permiso)', v_trunc),
    ('service_role: la propuesta registrada con el rol de la API existe',
      (select count(*) from ia_propuestas_gm where id = v_id) = 1);
exception when others then
  reset role;
  insert into r (caso, ok) values ('service_role: pasada completa sin excepcion (fallo: ' || sqlerrm || ')', false);
end
$$;

do $$
declare
  v_anon_sel boolean := false; v_auth_sel boolean := false;
  v_anon_fn boolean := false; v_auth_fn boolean := false;
  v_anon_reg boolean := false; v_auth_reg boolean := false;
begin
  set local role anon;
  begin perform 1 from public.ia_entradas; exception when insufficient_privilege then v_anon_sel := true; end;
  begin perform public.venta_lineas_ia(array[]::uuid[], '{}'::jsonb, null, null); exception when insufficient_privilege then v_anon_fn := true; end;
  begin perform public.registrar_propuesta_ia_gm('{}'::jsonb); exception when insufficient_privilege then v_anon_reg := true; end;
  reset role;
  set local role authenticated;
  begin perform 1 from public.ia_propuestas_gm; exception when insufficient_privilege then v_auth_sel := true; end;
  begin perform public.venta_lineas_ia(array[]::uuid[], '{}'::jsonb, null, null); exception when insufficient_privilege then v_auth_fn := true; end;
  begin perform public.registrar_propuesta_ia_gm('{}'::jsonb); exception when insufficient_privilege then v_auth_reg := true; end;
  reset role;
  insert into r (caso, ok) values
    ('anon no lee ia_entradas ni ejecuta venta_lineas_ia ni registrar_propuesta_ia_gm', v_anon_sel and v_anon_fn and v_anon_reg),
    ('authenticated no lee ia_propuestas_gm ni ejecuta venta_lineas_ia ni registrar_propuesta_ia_gm', v_auth_sel and v_auth_fn and v_auth_reg);
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
