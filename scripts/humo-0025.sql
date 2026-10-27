-- Humo SQL de la migración 0025 (M8 0.13.0, flujo de mercadería y compras):
--   * las 8 tablas (proveedores, compras, compra_lineas, compra_linea_entregas, compra_linea_repartos, compra_linea_recepciones,
--     compra_eventos, flujo_parametros): checks estructurales, ausencia de checks de catálogo, únicos con `coalesce`, FK y
--     `on delete`, defaults, triggers, RLS y permisos;
--   * `compras_numero_seq` (numero automático y único, permisos explícitos);
--   * `stock_flujo(carga_id)` y `flujo_huella_base()`;
--   * el trigger `compra_eventos_inmutable` (también para `service_role`) y la FK `restrict` de los eventos;
--   * las cuatro funciones de escritura (`importar_compra`, `registrar_recepciones`, `quitar_recepcion`, `cancelar_compra`) y
--     sus dos ayudantes (`compra_foto`, `compra_recalcular_estado`): atomicidad, `revision`, pertenencia, saldo cerrado (ficha
--     §0.11 y regla 31), permisos y una pasada completa con el rol `service_role`.
-- Regla 20 de la ficha docs/modulos/08-flujo-y-compras.md.
--
-- CÓMO CORRERLO (solo en la base LOCAL de pruebas, nunca contra un proyecto Supabase):
--   1. pg_ctlcluster 16 main start
--   2. bash scripts/validar-migraciones-local.sh        (crea `vector_two_local` con todas las migraciones, dos veces)
--   3. su postgres -c "psql -d vector_two_local -f scripts/humo-0025.sql"
-- Al final imprime la lista de comprobaciones (`ok = t`) y una línea `fallos = 0`; cualquier `ok = f` es un fallo.
--
-- Como humo-0023, 0024 y 0027, NO necesita fixture previo: carga el suyo (géneros, mundos, líneas, nodos, equivalencias,
-- marcas con un conjunto, tiendas y un CD, cargas, venta y stock, un perfil). Todo inventado: nada de datos reales de Lukers.
--
-- TODO va dentro de UNA transacción que termina en `rollback`: no deja nada escrito. Los casos que DEBEN fallar se prueban dentro
-- de un bloque `do` con `exception` (es un script de prueba local, no una migración).
-- Nota local: el rol `service_role` del clúster local no tiene BYPASSRLS; para probar al backend de verdad, la sección 10 le
-- concede BYPASSRLS dentro de la transacción (se deshace con el `rollback`) y ejecuta las funciones con `set local role`.
\set ON_ERROR_STOP off
\pset pager off
begin;

-- ---------------------------------------------------------------------------------------------------------------------
-- Infraestructura de la prueba: una tabla de resultados y un ayudante para armar los JSON con los ids del fixture
-- ---------------------------------------------------------------------------------------------------------------------
create temp table r (n serial, caso text, ok boolean);

-- ---------------------------------------------------------------------------------------------------------------------
-- Fixture
-- ---------------------------------------------------------------------------------------------------------------------
insert into generos (codigo, nombre) values ('H25H', 'HOMBRE H25');
insert into mundos (codigo, nombre) values ('H25U', 'URBANO H25');
insert into lineas (codigo, nombre, temporada) values ('H25L1', 'LINEA UNO H25', 'Todo el año');
insert into genero_mundo_linea (genero_id, mundo_id, linea_id, nivel_planificacion)
select g.id, mu.id, l.id, 'GML'
from lineas l, generos g, mundos mu
where l.codigo = 'H25L1' and g.codigo = 'H25H' and mu.codigo = 'H25U';

insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000d1', 'humo25@example.invalid');
insert into perfiles (id, email, nombre, rol) values ('00000000-0000-4000-8000-0000000000d1', 'humo25@example.invalid', 'Humo 25', 'planner');

insert into equivalencias (genero_mundo_linea_id, codigo, nombre)
select n.id, v.codigo, v.nombre
from (values ('EQ1', 'EQUIVALENCIA UNO H25'), ('EQ2', 'EQUIVALENCIA DOS H25')) as v(codigo, nombre)
cross join genero_mundo_linea n
join lineas l on l.id = n.linea_id and l.codigo = 'H25L1';

insert into agrupaciones_marca (codigo, nombre) values ('H25AG', 'AGRUPACION H25');
insert into marcas (codigo, nombre, agrupacion_marca_id)
select v.codigo, v.nombre, a.id
from (values ('H25CAB', 'MARCA CABEZA H25'), ('H25MIE', 'MARCA MIEMBRO H25'), ('H25SUE', 'MARCA SUELTA H25')) as v(codigo, nombre)
cross join agrupaciones_marca a where a.codigo = 'H25AG';
-- H25MIE es miembro del conjunto de H25CAB: en `marcas_unidad` suma en la cabeza.
update marcas set conjunto_marca_id = (select id from marcas where codigo = 'H25CAB') where codigo = 'H25MIE';

insert into tiendas (codigo, nombre, tipo, activo) values
  ('H25T1', 'TIENDA UNO H25', 'Tienda', true),
  ('H25T2', 'TIENDA DOS INACTIVA H25', 'Tienda', false),
  ('H25CD', 'CD H25', 'Centro de Distribución', true);
insert into agrupaciones_talla (codigo, nombre) values ('H25TA', 'TALLA A H25'), ('H25TB', 'TALLA B H25');

insert into cargas_venta_stock (periodo, estado, publicada_at) values
  (date '2025-09-01', 'publicada', now()),
  (date '2025-10-01', 'en_curso', null),
  (date '2025-08-01', 'retirada', now());

-- Venta y stock de set-2025. Resultado esperado de `stock_flujo`:
--   (EQ1, cabeza): T1 con la miembro (10 u, stock 100) y con la cabeza (5 u, stock 50) suman en la cabeza => unidades 15,
--   stock_tiendas 150; CD de la miembro (stock 300) => stock_cd 300; T2 INACTIVA (7 u, stock 40) => inactivas 40 y 7.
--   (EQ2, suelta): T1 (3 u, stock -4: negativo CRUDO) => stock_tiendas -4, unidades 3; CD (stock 20) => stock_cd 20.
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, stock_unidades)
select c.id, t.id, e.id, m.id, ta.id, v.unidades, v.stock
from (values
  ('H25T1', 'EQ1', 'H25MIE', 'H25TA', 10, 100),
  ('H25T1', 'EQ1', 'H25CAB', 'H25TB', 5, 50),
  ('H25CD', 'EQ1', 'H25MIE', 'H25TA', 0, 300),
  ('H25T2', 'EQ1', 'H25CAB', 'H25TA', 7, 40),
  ('H25T1', 'EQ2', 'H25SUE', 'H25TA', 3, -4),
  ('H25CD', 'EQ2', 'H25SUE', 'H25TA', 0, 20)
) as v(tienda, eq, marca, talla, unidades, stock)
join cargas_venta_stock c on c.periodo = date '2025-09-01'
join tiendas t on t.codigo = v.tienda
join equivalencias e on e.codigo = v.eq and e.nombre like '%H25'
join marcas m on m.codigo = v.marca
join agrupaciones_talla ta on ta.codigo = v.talla;
-- Una fila en la carga en curso: `stock_flujo` no la ve (no está publicada).
insert into venta_stock_mensual (carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id, unidades, stock_unidades)
select c.id, t.id, e.id, m.id, ta.id, 1, 1
from cargas_venta_stock c, tiendas t, equivalencias e, marcas m, agrupaciones_talla ta
where c.periodo = date '2025-10-01' and t.codigo = 'H25T1' and e.codigo = 'EQ1' and e.nombre like '%H25'
  and m.codigo = 'H25SUE' and ta.codigo = 'H25TA';

create temp table ids as
select
  (select n.id from genero_mundo_linea n join lineas l on l.id = n.linea_id and l.codigo = 'H25L1') as gml,
  (select id from equivalencias where codigo = 'EQ1' and nombre like '%H25') as eq1,
  (select id from equivalencias where codigo = 'EQ2' and nombre like '%H25') as eq2,
  (select id from marcas where codigo = 'H25SUE') as marca,
  (select id from marcas where codigo = 'H25CAB') as cab,
  (select id from marcas where codigo = 'H25MIE') as mie,
  '00000000-0000-4000-8000-0000000000d1'::uuid as perfil;

-- Ayudante: sustituye @G (nodo), @E1, @E2 (equivalencias), @M (marca), @P (perfil) en un texto JSON y lo devuelve como jsonb.
create or replace function pg_temp.p(t text) returns jsonb language sql as $f$
  select replace(replace(replace(replace(replace(t, '@G', gml::text), '@E1', eq1::text), '@E2', eq2::text), '@M', marca::text), '@P', perfil::text)::jsonb
  from ids
$f$;

-- Resultado de cada llamada a las funciones, por etiqueta.
create temp table salida (k text primary key, j jsonb);

-- ---------------------------------------------------------------------------------------------------------------------
-- 1. Estructura: checks, únicos, FK, defaults (cada caso intenta una sentencia y compara lo ocurrido con lo esperado)
-- ---------------------------------------------------------------------------------------------------------------------
insert into proveedores (nombre) values ('PROVEEDOR BASE H25');
insert into compras (proveedor_id, fecha_compra, estado)
select id, date '2026-09-10', 'confirmada' from proveedores where nombre = 'PROVEEDOR BASE H25';
insert into compra_lineas (compra_id, unidades, llegada_periodo, genero_mundo_linea_id, marca_id)
select c.id, 100, date '2026-11-01', i.gml, i.marca from compras c, ids i;
insert into compra_linea_entregas (linea_id, periodo, unidades) select id, date '2026-11-01', 60 from compra_lineas;
-- Un evento con `linea_id`: la FK `restrict` de los eventos impide borrar la línea (caso 66).
insert into compra_eventos (compra_id, linea_id, accion, resumen)
select compra_id, id, 'crear', 'evento base' from compra_lineas;

create temp table b as
select
  (select id from proveedores where nombre = 'PROVEEDOR BASE H25') as prov,
  (select id from compras) as compra,
  (select numero from compras) as numero,
  (select id from compra_lineas) as linea,
  (select id from compra_linea_entregas) as entrega;

create temp table casos (n int, caso text, sentencia text, esperado_ok boolean, ok boolean);
insert into casos (n, caso, esperado_ok, sentencia) values
  (1,  'proveedor valido', true, $q$ insert into public.proveedores (nombre) values ('PROVEEDOR CASO 1') $q$),
  (2,  'mismo nombre en minusculas (unico sobre upper(nombre))', false, $q$ insert into public.proveedores (nombre) values ('proveedor caso 1') $q$),
  (3,  'nombre vacio', false, $q$ insert into public.proveedores (nombre) values ('') $q$),
  (4,  'nombre de 121 caracteres', false, $q$ insert into public.proveedores (nombre) values (repeat('n', 121)) $q$),
  (5,  'otro proveedor sin codigo (los codigos nulos no chocan)', true, $q$ insert into public.proveedores (nombre) values ('PROVEEDOR CASO 5') $q$),
  (6,  'proveedor con codigo cx-1', true, $q$ insert into public.proveedores (nombre, codigo) values ('PROVEEDOR CASO 6', 'cx-1') $q$),
  (7,  'codigo CX-1 en otra capitalizacion (unico parcial sobre upper(codigo))', false, $q$ insert into public.proveedores (nombre, codigo) values ('PROVEEDOR CASO 7', 'CX-1') $q$),
  (8,  'nota de proveedor de 301 caracteres', false, $q$ insert into public.proveedores (nombre, nota) values ('PROVEEDOR CASO 8', repeat('n', 301)) $q$),
  (9,  'compra con defaults (numero automatico, borrador, PEN, revision 0)', true, $q$ insert into public.compras (proveedor_id, fecha_compra) select prov, date '2026-09-11' from b $q$),
  (10, 'compra sin fecha_compra', false, $q$ insert into public.compras (proveedor_id) select prov from b $q$),
  (11, 'revision negativa', false, $q$ insert into public.compras (proveedor_id, fecha_compra, revision) select prov, date '2026-09-11', -1 from b $q$),
  (12, 'referencia de 81 caracteres', false, $q$ insert into public.compras (proveedor_id, fecha_compra, referencia) select prov, date '2026-09-11', repeat('r', 81) from b $q$),
  (13, 'motivo_cancelacion de 201 caracteres', false, $q$ insert into public.compras (proveedor_id, fecha_compra, motivo_cancelacion) select prov, date '2026-09-11', repeat('m', 201) from b $q$),
  (14, 'estado, origen y moneda fuera de catalogo (sin check: los valida zod)', true, $q$ insert into public.compras (proveedor_id, fecha_compra, estado, origen, moneda) select prov, date '2026-09-11', 'zzz', 'zzz', 'EUR' from b $q$),
  (15, 'excede_tope_al_confirmar como objeto (debe ser arreglo)', false, $q$ insert into public.compras (proveedor_id, fecha_compra, excede_tope_al_confirmar) select prov, date '2026-09-11', '{}'::jsonb from b $q$),
  (16, 'numero repetido', false, $q$ insert into public.compras (proveedor_id, fecha_compra, numero) select prov, date '2026-09-11', numero from b $q$),
  (17, 'proveedor_id inexistente (FK)', false, $q$ insert into public.compras (proveedor_id, fecha_compra) values (gen_random_uuid(), date '2026-09-11') $q$),
  (18, 'linea valida', true, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo) select compra, 50, date '2026-11-01' from b $q$),
  (19, 'unidades = 0', false, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo) select compra, 0, date '2026-11-01' from b $q$),
  (20, 'unidades negativas', false, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo) select compra, -5, date '2026-11-01' from b $q$),
  (21, 'unidades_recibidas > unidades', false, $q$ insert into public.compra_lineas (compra_id, unidades, unidades_recibidas, llegada_periodo) select compra, 10, 11, date '2026-11-01' from b $q$),
  (22, 'unidades_recibidas negativas', false, $q$ insert into public.compra_lineas (compra_id, unidades, unidades_recibidas, llegada_periodo) select compra, 10, -1, date '2026-11-01' from b $q$),
  (23, 'recibidas + canceladas > unidades (60 + 50 de 100)', false, $q$ insert into public.compra_lineas (compra_id, unidades, unidades_recibidas, unidades_canceladas, llegada_periodo) select compra, 100, 60, 50, date '2026-11-01' from b $q$),
  (24, 'unidades_canceladas negativas', false, $q$ insert into public.compra_lineas (compra_id, unidades, unidades_canceladas, llegada_periodo) select compra, 100, -1, date '2026-11-01' from b $q$),
  (25, 'recibidas + canceladas = unidades (60 + 40)', true, $q$ insert into public.compra_lineas (compra_id, unidades, unidades_recibidas, unidades_canceladas, llegada_periodo) select compra, 100, 60, 40, date '2026-11-01' from b $q$),
  (26, 'llegada_periodo = 2026-01-15 (no es primer dia de mes)', false, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo) select compra, 10, date '2026-01-15' from b $q$),
  (27, 'llegada_periodo nulo', false, $q$ insert into public.compra_lineas (compra_id, unidades) select compra, 10 from b $q$),
  (28, 'costo_unitario negativo', false, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo, costo_unitario) select compra, 10, date '2026-11-01', -0.01 from b $q$),
  (29, 'costo_unitario = 0 (valido)', true, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo, costo_unitario) select compra, 10, date '2026-11-01', 0 from b $q$),
  (30, 'tipo, tallas y destino fuera de catalogo (sin check)', true, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo, tipo, tallas, destino) select compra, 10, date '2026-11-01', 'tipo_futuro', 'zzz', 'destino_futuro' from b $q$),
  (31, 'alcance como arreglo (debe ser objeto)', false, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo, alcance) select compra, 10, date '2026-11-01', '[]'::jsonb from b $q$),
  (32, 'avisos como objeto (debe ser arreglo)', false, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo, avisos) select compra, 10, date '2026-11-01', '{}'::jsonb from b $q$),
  (33, 'nota de linea de 201 caracteres', false, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo, nota) select compra, 10, date '2026-11-01', repeat('n', 201) from b $q$),
  (34, 'compra_id inexistente (FK)', false, $q$ insert into public.compra_lineas (compra_id, unidades, llegada_periodo) values (gen_random_uuid(), 10, date '2026-11-01') $q$),
  (35, 'entrega valida (2026-12-01, 40 u)', true, $q$ insert into public.compra_linea_entregas (linea_id, periodo, unidades) select linea, date '2026-12-01', 40 from b $q$),
  (36, 'entrega con periodo 2026-01-15', false, $q$ insert into public.compra_linea_entregas (linea_id, periodo, unidades) select linea, date '2026-01-15', 10 from b $q$),
  (37, 'entrega con unidades = 0', false, $q$ insert into public.compra_linea_entregas (linea_id, periodo, unidades) select linea, date '2027-01-01', 0 from b $q$),
  (38, 'dos entregas de la misma linea y mes', false, $q$ insert into public.compra_linea_entregas (linea_id, periodo, unidades) select linea, date '2026-12-01', 1 from b $q$),
  (39, 'entrega con origen fuera de catalogo (sin check)', true, $q$ insert into public.compra_linea_entregas (linea_id, periodo, unidades, origen) select linea, date '2027-01-01', 1, 'origen_futuro' from b $q$),
  (40, 'reparto valido sin equivalencia', true, $q$ insert into public.compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, unidades) select b.linea, b.entrega, i.marca, i.gml, 30 from b, ids i $q$),
  (41, 'el mismo reparto otra vez: dos NULL de equivalencia chocan gracias al coalesce', false, $q$ insert into public.compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, unidades) select b.linea, b.entrega, i.marca, i.gml, 5 from b, ids i $q$),
  (42, 'mismo reparto con una equivalencia (clave distinta)', true, $q$ insert into public.compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, equivalencia_id, unidades) select b.linea, b.entrega, i.marca, i.gml, i.eq1, 20 from b, ids i $q$),
  (43, 'reparto con unidades = 0 (se acepta: >= 0)', true, $q$ insert into public.compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, equivalencia_id, unidades) select b.linea, b.entrega, i.marca, i.gml, i.eq2, 0 from b, ids i $q$),
  (44, 'reparto con unidades negativas', false, $q$ insert into public.compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, unidades) select b.linea, b.entrega, i.cab, i.gml, -1 from b, ids i $q$),
  (45, 'entrega_id inexistente (FK)', false, $q$ insert into public.compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, unidades) select b.linea, gen_random_uuid(), i.cab, i.gml, 1 from b, ids i $q$),
  (46, 'reparto_id inexistente (FK a repartos_marca_barrido)', false, $q$ insert into public.compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, unidades, reparto_id) select b.linea, b.entrega, i.cab, i.gml, 1, gen_random_uuid() from b, ids i $q$),
  (47, 'recepcion valida', true, $q$ insert into public.compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion) select linea, date '2026-10-01', 10, date '2026-10-20' from b $q$),
  (48, 'recepcion con unidades = 0', false, $q$ insert into public.compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion) select linea, date '2026-10-01', 0, date '2026-10-20' from b $q$),
  (49, 'recepcion con recibida_periodo 2026-10-15', false, $q$ insert into public.compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion) select linea, date '2026-10-15', 1, date '2026-10-20' from b $q$),
  (50, 'recepcion sin fecha_recepcion', false, $q$ insert into public.compra_linea_recepciones (linea_id, recibida_periodo, unidades) select linea, date '2026-10-01', 1 from b $q$),
  (51, 'recepcion con origen fuera de catalogo (sin check)', true, $q$ insert into public.compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion, origen) select linea, date '2026-10-01', 1, date '2026-10-20', 'origen_futuro' from b $q$),
  (52, 'recepcion con nota de 201 caracteres', false, $q$ insert into public.compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion, nota) select linea, date '2026-10-01', 1, date '2026-10-20', repeat('n', 201) from b $q$),
  (53, 'evento con resumen y motivo nulos y accion futura', true, $q$ insert into public.compra_eventos (compra_id, accion) select compra, 'accion_futura' from b $q$),
  (54, 'evento con resumen de 301 caracteres', false, $q$ insert into public.compra_eventos (compra_id, accion, resumen) select compra, 'crear', repeat('r', 301) from b $q$),
  (55, 'evento con motivo de 301 caracteres', false, $q$ insert into public.compra_eventos (compra_id, accion, motivo) select compra, 'crear', repeat('m', 301) from b $q$),
  (56, 'evento sin accion', false, $q$ insert into public.compra_eventos (compra_id) select compra from b $q$),
  (57, 'evento con compra_id inexistente (FK)', false, $q$ insert into public.compra_eventos (compra_id, accion) values (gen_random_uuid(), 'crear') $q$),
  (58, 'fila global de flujo_parametros con todos los defaults', true, $q$ insert into public.flujo_parametros default values $q$),
  (59, 'segunda fila con clave global', false, $q$ insert into public.flujo_parametros (clave) values ('global') $q$),
  (60, 'otra clave', true, $q$ insert into public.flujo_parametros (clave) values ('prueba') $q$),
  (61, 'imi_min negativo', false, $q$ insert into public.flujo_parametros (clave, imi_min) values ('x1', -1) $q$),
  (62, 'meses_tarjeta = 0', false, $q$ insert into public.flujo_parametros (clave, meses_tarjeta) values ('x2', 0) $q$),
  (63, 'temporadas como arreglo (debe ser objeto)', false, $q$ insert into public.flujo_parametros (clave, temporadas) values ('x3', '[]'::jsonb) $q$),
  (64, 'umbral_conciliacion_u negativo', false, $q$ insert into public.flujo_parametros (clave, umbral_conciliacion_u) values ('x4', -1) $q$),
  (65, 'borrar una compra con lineas y eventos (on delete restrict)', false, $q$ delete from public.compras where id = (select compra from b) $q$),
  (66, 'borrar una linea con eventos (on delete restrict)', false, $q$ delete from public.compra_lineas where id = (select linea from b) $q$),
  (67, 'borrar un proveedor con compras (on delete restrict)', false, $q$ delete from public.proveedores where id = (select prov from b) $q$),
  (68, 'borrar un nodo usado por una linea (on delete restrict)', false, $q$ delete from public.genero_mundo_linea where id = (select gml from ids) $q$),
  (69, 'borrar una marca usada por una linea (on delete restrict)', false, $q$ delete from public.marcas where id = (select marca from ids) $q$);

do $$
declare
  c record;
  v_aceptada boolean;
begin
  for c in select * from casos order by n loop
    begin
      execute c.sentencia;
      v_aceptada := true;
    exception when check_violation or unique_violation or foreign_key_violation or not_null_violation then
      v_aceptada := false;
    end;
    update casos set ok = (v_aceptada = esperado_ok) where n = c.n;
  end loop;
end
$$;

\echo '--- 1. casos de checks, unicos y FK (esperado: todas las filas ok = t)'
select n, caso, esperado_ok as debe_aceptarse, ok from casos order by n;
insert into r (caso, ok) select 'estructura: ' || n || ' ' || caso, coalesce(ok, false) from casos order by n;

-- ---------------------------------------------------------------------------------------------------------------------
-- 2. Defaults, ausencia de checks de catálogo, cascadas, triggers
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok)
select 'numero se asigna solo con formato C-000000 y es unico', (select count(*) from compras where numero ~ '^C-[0-9]{6}$') = (select count(*) from compras)
  and (select count(distinct numero) from compras) = (select count(*) from compras);
insert into r (caso, ok)
select 'compras.revision, estado y moneda por defecto (0, borrador, PEN) y origen comprador',
  (select revision = 0 and estado = 'borrador' and moneda = 'PEN' and origen = 'comprador' and activo and excede_tope_al_confirmar = '[]'::jsonb
     from compras where fecha_compra = date '2026-09-11' and estado = 'borrador' limit 1);
insert into r (caso, ok)
select 'compra_linea_recepciones.origen por defecto = manual',
  (select origen from compra_linea_recepciones where unidades = 10 limit 1) = 'manual';
insert into r (caso, ok)
select 'compra_lineas: tipo especifica, tallas ambas, destino cd, unidades_recibidas y canceladas en 0, alcance {} y avisos []',
  (select tipo = 'especifica' and tallas = 'ambas' and destino = 'cd' and unidades_recibidas = 0 and unidades_canceladas = 0
          and alcance = '{}'::jsonb and avisos = '[]'::jsonb and activo
     from compra_lineas where id = (select linea from b));
insert into r (caso, ok)
select 'compra_linea_entregas.origen por defecto = manual',
  (select origen from compra_linea_entregas where id = (select entrega from b)) = 'manual';
insert into r (caso, ok)
select 'flujo_parametros: defaults 4 / 8 / 6 / true / 10 / 20',
  (select imi_min = 4 and imi_max = 8 and meses_tarjeta = 6 and extender_horizonte and umbral_conciliacion_u = 10
          and umbral_conciliacion_pct = 20 and clave = 'global' and activo
     from flujo_parametros where clave = 'global');
insert into r (caso, ok)
select 'flujo_parametros.temporadas tiene el default (verano 10-3, invierno 4-9)',
  (select temporadas = '{"verano":{"desde_mes":10,"hasta_mes":3},"invierno":{"desde_mes":4,"hasta_mes":9}}'::jsonb
     from flujo_parametros where clave = 'global');
insert into r (caso, ok)
select 'compra_eventos no tiene updated_at ni activo (registro inmutable)',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compra_eventos'
     and column_name in ('updated_at', 'activo')) = 0
  and (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'compra_eventos'
     and column_name in ('resumen', 'motivo', 'antes', 'despues', 'linea_id') and is_nullable = 'YES') = 5;
insert into r (caso, ok)
select 'ninguna de las 8 tablas tiene un check sobre origen, estado, moneda, tallas, destino, tipo, accion ni temporada',
  (select count(*) from pg_constraint
    where contype = 'c'
      and conrelid in ('public.proveedores'::regclass, 'public.compras'::regclass, 'public.compra_lineas'::regclass,
                       'public.compra_linea_entregas'::regclass, 'public.compra_linea_repartos'::regclass,
                       'public.compra_linea_recepciones'::regclass, 'public.compra_eventos'::regclass, 'public.flujo_parametros'::regclass)
      and pg_get_constraintdef(oid) ~ '\y(origen|estado|moneda|tallas|destino|tipo|accion|temporada)\y') = 0;
insert into r (caso, ok)
select 'FK on delete: restrict en compras, lineas y eventos; cascade en entregas, repartos y recepciones (por linea)',
  (select string_agg(conrelid::regclass::text || '.' || conname || ':' || confdeltype::text, ',' order by conrelid::regclass::text, conname)
     from pg_constraint
    where contype = 'f' and conname in (
      'compras_proveedor_id_fkey', 'compra_lineas_compra_id_fkey', 'compra_eventos_compra_id_fkey', 'compra_eventos_linea_id_fkey',
      'compra_linea_entregas_linea_id_fkey', 'compra_linea_repartos_linea_id_fkey', 'compra_linea_repartos_entrega_id_fkey',
      'compra_linea_recepciones_linea_id_fkey', 'compra_linea_repartos_reparto_id_fkey'))
  = 'compra_eventos.compra_eventos_compra_id_fkey:r,compra_eventos.compra_eventos_linea_id_fkey:r,compra_linea_entregas.compra_linea_entregas_linea_id_fkey:c,compra_linea_recepciones.compra_linea_recepciones_linea_id_fkey:c,compra_linea_repartos.compra_linea_repartos_entrega_id_fkey:c,compra_linea_repartos.compra_linea_repartos_linea_id_fkey:c,compra_linea_repartos.compra_linea_repartos_reparto_id_fkey:r,compra_lineas.compra_lineas_compra_id_fkey:r,compras.compras_proveedor_id_fkey:r';

-- Cascada: una línea SIN eventos se borra y se lleva sus entregas, repartos y recepciones; borrar una entrega se lleva sus repartos.
insert into compra_lineas (compra_id, unidades, llegada_periodo, marca_id, genero_mundo_linea_id)
select compra, 20, date '2026-11-01', (select marca from ids), (select gml from ids) from b;
create temp table lx as select id from compra_lineas where unidades = 20 and compra_id = (select compra from b);
insert into compra_linea_entregas (linea_id, periodo, unidades) select id, date '2026-11-01', 20 from lx;
insert into compra_linea_repartos (linea_id, entrega_id, marca_id, genero_mundo_linea_id, unidades)
select e.linea_id, e.id, (select marca from ids), (select gml from ids), 20 from compra_linea_entregas e where e.linea_id = (select id from lx);
insert into compra_linea_recepciones (linea_id, recibida_periodo, unidades, fecha_recepcion) select id, date '2026-11-01', 5, date '2026-11-05' from lx;
delete from compra_linea_entregas where linea_id = (select id from lx);
insert into r (caso, ok)
select 'borrar una entrega borra sus repartos (cascade)', (select count(*) from compra_linea_repartos where linea_id = (select id from lx)) = 0;
insert into compra_linea_entregas (linea_id, periodo, unidades) select id, date '2026-11-01', 20 from lx;
delete from compra_lineas where id = (select id from lx);
insert into r (caso, ok)
select 'borrar una linea sin eventos borra entregas y recepciones (cascade)',
  (select count(*) from compra_linea_entregas where linea_id = (select id from lx)) = 0
  and (select count(*) from compra_linea_recepciones where linea_id = (select id from lx)) = 0;

-- Trigger set_updated_at.
update compras set updated_at = timestamptz '2000-01-01 00:00:00+00' where id = (select compra from b);
update compras set nota = 'tocada' where id = (select compra from b);
insert into r (caso, ok)
select 'set_updated_at refresca updated_at en compras', (select updated_at > timestamptz '2000-01-01 00:00:00+00' from compras where id = (select compra from b));
insert into r (caso, ok)
select 'set_updated_at existe en las 7 tablas con updated_at y NO en compra_eventos',
  (select count(*) from pg_trigger where tgname = 'set_updated_at' and not tgisinternal
     and tgrelid in ('public.proveedores'::regclass, 'public.compras'::regclass, 'public.compra_lineas'::regclass,
                     'public.compra_linea_entregas'::regclass, 'public.compra_linea_repartos'::regclass,
                     'public.compra_linea_recepciones'::regclass, 'public.flujo_parametros'::regclass)) = 7
  and (select count(*) from pg_trigger where tgname = 'set_updated_at' and not tgisinternal and tgrelid = 'public.compra_eventos'::regclass) = 0;

insert into r (caso, ok)
select 'indices unicos: numero, nombre y codigo de proveedor, entrega por (linea, mes), reparto con coalesce, fila global',
  (select count(*) from pg_indexes where schemaname = 'public' and indexname in (
      'compras_numero_key', 'proveedores_nombre_uniq', 'proveedores_codigo_uniq', 'compra_linea_entregas_linea_periodo_key',
      'compra_linea_repartos_clave_uniq', 'flujo_parametros_clave_key')) = 6
  and (select indexdef ~* 'coalesce' from pg_indexes where indexname = 'compra_linea_repartos_clave_uniq')
  and (select indexdef ~ 'WHERE \(codigo IS NOT NULL\)' from pg_indexes where indexname = 'proveedores_codigo_uniq');

-- ---------------------------------------------------------------------------------------------------------------------
-- 3. RLS, permisos y secuencia
-- ---------------------------------------------------------------------------------------------------------------------
insert into r (caso, ok)
select 'RLS activo en las 8 tablas y sin ninguna politica',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in (
      'proveedores', 'compras', 'compra_lineas', 'compra_linea_entregas', 'compra_linea_repartos', 'compra_linea_recepciones',
      'compra_eventos', 'flujo_parametros') and c.relrowsecurity) = 8
  and (select count(*) from pg_policies where schemaname = 'public' and tablename in (
      'proveedores', 'compras', 'compra_lineas', 'compra_linea_entregas', 'compra_linea_repartos', 'compra_linea_recepciones',
      'compra_eventos', 'flujo_parametros')) = 0;
insert into r (caso, ok)
select 'anon y authenticated no tienen ningun permiso sobre las 8 tablas; service_role tiene select, insert, update y delete',
  (select count(*) from (values ('proveedores'), ('compras'), ('compra_lineas'), ('compra_linea_entregas'), ('compra_linea_repartos'),
        ('compra_linea_recepciones'), ('compra_eventos'), ('flujo_parametros')) t(n)
    cross join (values ('anon'), ('authenticated')) ro(rol)
    cross join (values ('select'), ('insert'), ('update'), ('delete')) p(priv)
    where has_table_privilege(ro.rol, 'public.' || t.n, p.priv)) = 0
  and (select count(*) from (values ('proveedores'), ('compras'), ('compra_lineas'), ('compra_linea_entregas'), ('compra_linea_repartos'),
        ('compra_linea_recepciones'), ('compra_eventos'), ('flujo_parametros')) t(n)
    cross join (values ('select'), ('insert'), ('update'), ('delete')) p(priv)
    where not has_table_privilege('service_role', 'public.' || t.n, p.priv)) = 0;
insert into r (caso, ok)
select 'compras_numero_seq: solo service_role la usa (anon y authenticated no)',
  has_sequence_privilege('service_role', 'public.compras_numero_seq', 'usage')
  and has_sequence_privilege('service_role', 'public.compras_numero_seq', 'select')
  and not has_sequence_privilege('anon', 'public.compras_numero_seq', 'usage')
  and not has_sequence_privilege('authenticated', 'public.compras_numero_seq', 'usage')
  and not has_sequence_privilege('anon', 'public.compras_numero_seq', 'select')
  and not has_sequence_privilege('authenticated', 'public.compras_numero_seq', 'select');
insert into r (caso, ok)
select 'las 9 funciones y el trigger: security invoker, search_path vacio, execute solo para service_role',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
      'stock_flujo', 'flujo_huella_base', 'importar_compra', 'registrar_recepciones', 'quitar_recepcion', 'cancelar_compra',
      'compra_foto', 'compra_recalcular_estado', 'tg_compra_eventos_inmutable')
      and not p.prosecdef and p.proconfig @> array['search_path=""']) = 9
  and (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
      'stock_flujo', 'flujo_huella_base', 'importar_compra', 'registrar_recepciones', 'quitar_recepcion', 'cancelar_compra',
      'compra_foto', 'compra_recalcular_estado', 'tg_compra_eventos_inmutable')
      and has_function_privilege('service_role', p.oid, 'execute')
      and not has_function_privilege('anon', p.oid, 'execute')
      and not has_function_privilege('authenticated', p.oid, 'execute')) = 9;
insert into r (caso, ok)
select 'stock_flujo y flujo_huella_base son stable; las de escritura y sus ayudantes de escritura son volatiles',
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('stock_flujo', 'flujo_huella_base', 'compra_foto') and provolatile = 's') = 3
  and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace
         and proname in ('importar_compra', 'registrar_recepciones', 'quitar_recepcion', 'cancelar_compra', 'compra_recalcular_estado')
         and provolatile = 'v') = 5;

-- authenticated y anon no pueden leer ni tocar nada (permiso denegado, 42501).
do $$
declare
  v_lee_auth boolean := false;
  v_lee_anon boolean := false;
  v_ins_auth boolean := false;
  v_fn_auth boolean := false;
begin
  set local role authenticated;
  begin perform 1 from public.compras limit 1; exception when insufficient_privilege then v_lee_auth := true; end;
  begin insert into public.compra_eventos (compra_id, accion) values (gen_random_uuid(), 'x'); exception when insufficient_privilege then v_ins_auth := true; end;
  begin perform public.flujo_huella_base(); exception when insufficient_privilege then v_fn_auth := true; end;
  reset role;
  set local role anon;
  begin perform 1 from public.compra_linea_recepciones limit 1; exception when insufficient_privilege then v_lee_anon := true; end;
  reset role;
  insert into r (caso, ok) values
    ('authenticated no lee compras (permiso denegado)', v_lee_auth),
    ('authenticated no inserta eventos (permiso denegado)', v_ins_auth),
    ('authenticated no ejecuta flujo_huella_base (permiso denegado)', v_fn_auth),
    ('anon no lee recepciones (permiso denegado)', v_lee_anon);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 4. `stock_flujo(p_carga_id)`
-- ---------------------------------------------------------------------------------------------------------------------
insert into salida select 'stock_sep', public.stock_flujo((select id from cargas_venta_stock where periodo = date '2025-09-01'));
insert into salida select 'stock_oct', public.stock_flujo((select id from cargas_venta_stock where periodo = date '2025-10-01'));
insert into salida select 'stock_nada', public.stock_flujo(gen_random_uuid());

-- Cada fila desempaquetada con los uuid de su equivalencia y de su unidad de marca.
create temp table sf as
select
  (s.j -> 'equivalencias' ->> ((x.v ->> 0)::int))::uuid as equivalencia_id,
  (s.j -> 'marcas' ->> ((x.v ->> 1)::int))::uuid as marca_id,
  (x.v ->> 2)::int as stock_cd, (x.v ->> 3)::int as stock_tiendas, (x.v ->> 4)::int as unidades,
  (x.v ->> 5)::int as stock_inactivas, (x.v ->> 6)::int as unidades_inactivas
from salida s, jsonb_array_elements(s.j -> 'filas') x(v)
where s.k = 'stock_sep';

insert into r (caso, ok)
select 'stock_flujo(set): publicada = true, periodo 2025-09 y las claves del contrato',
  (select (j ->> 'publicada')::boolean and j ->> 'periodo' = '2025-09'
     and (select array_agg(k order by k) from jsonb_object_keys(j) k) = array['carga_id', 'equivalencias', 'excluido', 'filas', 'marcas', 'periodo', 'publicada']
     from salida where k = 'stock_sep');
insert into r (caso, ok)
select 'stock_flujo: 2 filas (EQ1 x cabeza y EQ2 x suelta), 2 equivalencias y 2 unidades de marca', (select count(*) from sf) = 2
  and (select jsonb_array_length(j -> 'equivalencias') = 2 and jsonb_array_length(j -> 'marcas') = 2 from salida where k = 'stock_sep');
insert into r (caso, ok)
select 'stock_flujo: la marca miembro suma en su cabeza (la miembro no aparece como unidad)',
  (select marcas @> to_jsonb((select cab::text from ids)) and not marcas @> to_jsonb((select mie::text from ids))
     from (select j -> 'marcas' as marcas from salida where k = 'stock_sep') m);
insert into r (caso, ok)
select 'stock_flujo (EQ1, cabeza): stock_cd 300, stock_tiendas 150, unidades 15 (10 de la miembro + 5 de la cabeza), sin sumar la inactiva',
  (select stock_cd = 300 and stock_tiendas = 150 and unidades = 15 from sf where equivalencia_id = (select eq1 from ids) and marca_id = (select cab from ids));
insert into r (caso, ok)
select 'stock_flujo (EQ1, cabeza): la tienda INACTIVA va aparte (stock 40 y 7 u) y no entra en stock_tiendas',
  (select stock_inactivas = 40 and unidades_inactivas = 7 from sf where equivalencia_id = (select eq1 from ids) and marca_id = (select cab from ids));
insert into r (caso, ok)
select 'stock_flujo (EQ2, suelta): stock_cd 20, stock_tiendas -4 (negativo crudo), unidades 3, sin inactivas',
  (select stock_cd = 20 and stock_tiendas = -4 and unidades = 3 and stock_inactivas = 0 and unidades_inactivas = 0
     from sf where equivalencia_id = (select eq2 from ids) and marca_id = (select marca from ids));
insert into r (caso, ok)
select 'stock_flujo: excluido = 40 u de stock y 7 u de venta de las tiendas desactivadas',
  (select (j -> 'excluido' ->> 'stock')::int = 40 and (j -> 'excluido' ->> 'unidades')::int = 7 from salida where k = 'stock_sep');
insert into r (caso, ok)
select 'stock_flujo(carga en curso): publicada = false, filas vacias, periodo 2025-10',
  (select not (j ->> 'publicada')::boolean and j -> 'filas' = '[]'::jsonb and j ->> 'periodo' = '2025-10' and j -> 'excluido' = '{"stock":0,"unidades":0}'::jsonb
     from salida where k = 'stock_oct');
insert into r (caso, ok)
select 'stock_flujo(carga inexistente): publicada = false, filas vacias y periodo nulo',
  (select not (j ->> 'publicada')::boolean and j -> 'filas' = '[]'::jsonb and j -> 'periodo' = 'null'::jsonb and j -> 'equivalencias' = '[]'::jsonb
     from salida where k = 'stock_nada');
insert into r (caso, ok)
select 'stock_flujo(carga retirada): publicada = false',
  not (public.stock_flujo((select id from cargas_venta_stock where periodo = date '2025-08-01')) ->> 'publicada')::boolean;
insert into r (caso, ok)
select 'stock_flujo es determinista: dos llamadas dan el mismo documento',
  public.stock_flujo((select id from cargas_venta_stock where periodo = date '2025-09-01')) = (select j from salida where k = 'stock_sep');

-- ---------------------------------------------------------------------------------------------------------------------
-- 5. `flujo_huella_base()`
-- ---------------------------------------------------------------------------------------------------------------------
insert into salida select 'huella_0', public.flujo_huella_base();
insert into r (caso, ok)
select 'flujo_huella_base devuelve todas sus claves (cargas, cerradas, compras, parametros, repartos, reglas, config)',
  (select (select array_agg(k order by k) from jsonb_object_keys(j) k) = array['cargas', 'cerradas', 'compras', 'config', 'parametros', 'reglas', 'repartos']
     from salida where k = 'huella_0');
insert into r (caso, ok)
select 'flujo_huella_base: compras trae eventos, ultimo, revision y actualizada; config trae las 7 entradas como [n, max]',
  (select (select array_agg(k order by k) from jsonb_object_keys(j -> 'compras') k) = array['actualizada', 'eventos', 'revision', 'ultimo']
      and (select array_agg(k order by k) from jsonb_object_keys(j -> 'config') k)
        = array['agrupaciones_marca', 'equivalencias', 'genero_mundo_linea', 'marca_gml_especial', 'marcas', 'responsables_genero_mundo', 'tiendas']
      and (select bool_and(jsonb_typeof(v) = 'array' and jsonb_array_length(v) = 2) from jsonb_each(j -> 'config') e(k, v))
      and (select (j -> 'config' -> 'equivalencias' ->> 0)::int >= 2)
     from salida where k = 'huella_0');
insert into r (caso, ok)
select 'flujo_huella_base: solo cuenta las cargas publicadas (set-2025; ni la en curso ni la retirada) con periodo aaaa-mm',
  (select jsonb_array_length(j -> 'cargas') = 1 and j -> 'cargas' -> 0 ->> 'periodo' = '2025-09' and j -> 'cargas' -> 0 ? 'carga_id' and j -> 'cargas' -> 0 ? 'publicada_at'
     from salida where k = 'huella_0');
insert into r (caso, ok)
select 'flujo_huella_base: sin repartos, reglas ni cerradas: arreglo vacio y contadores en 0',
  (select j -> 'cerradas' = '[]'::jsonb and (j -> 'repartos' ->> 'vigentes')::int = 0 and (j -> 'reglas' ->> 'n')::int = 0 from salida where k = 'huella_0');
insert into r (caso, ok)
select 'flujo_huella_base: compras.eventos cuenta los eventos de la tabla y revision suma compras.revision',
  (select (j -> 'compras' ->> 'eventos')::int = (select count(*) from compra_eventos)
      and (j -> 'compras' ->> 'revision')::int = (select sum(revision) from compras)
     from salida where k = 'huella_0');
insert into r (caso, ok)
select 'flujo_huella_base: parametros es la fecha de updated_at de flujo_parametros (hay fila)',
  (select jsonb_typeof(j -> 'parametros') = 'string' from salida where k = 'huella_0');

-- La huella cambia al subir compras.revision, al agregar un evento y al cambiar la configuración; no cambia si no cambia nada.
insert into salida select 'huella_1', public.flujo_huella_base();
insert into r (caso, ok)
select 'flujo_huella_base no cambia si no cambia nada', (select j from salida where k = 'huella_1') = (select j from salida where k = 'huella_0');
update compras set revision = revision + 1 where id = (select compra from b);
insert into salida select 'huella_2', public.flujo_huella_base();
insert into r (caso, ok)
select 'flujo_huella_base cambia al subir compras.revision (sin evento nuevo)',
  (select j from salida where k = 'huella_2') <> (select j from salida where k = 'huella_1')
  and (select j -> 'compras' ->> 'eventos' from salida where k = 'huella_2') = (select j -> 'compras' ->> 'eventos' from salida where k = 'huella_1');
insert into compra_eventos (compra_id, accion) select compra, 'accion_futura' from b;
insert into salida select 'huella_3', public.flujo_huella_base();
insert into r (caso, ok)
select 'flujo_huella_base cambia al agregarse un evento',
  (select (j -> 'compras' ->> 'eventos')::int from salida where k = 'huella_3') = (select (j -> 'compras' ->> 'eventos')::int + 1 from salida where k = 'huella_2');
-- (dentro de una transaccion now() es constante: lo que cambia es el conteo, no la fecha)
insert into tiendas (codigo, nombre, tipo) values ('H25T9', 'TIENDA NUEVA H25', 'Tienda');
insert into salida select 'huella_4', public.flujo_huella_base();
insert into r (caso, ok)
select 'flujo_huella_base cambia al cambiar la configuracion (tiendas)',
  (select j -> 'config' -> 'tiendas' from salida where k = 'huella_4') <> (select j -> 'config' -> 'tiendas' from salida where k = 'huella_3');

-- ---------------------------------------------------------------------------------------------------------------------
-- 6. Auditoría inmutable: el trigger rechaza update y delete, y la FK impide borrar una compra con eventos
-- ---------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_upd boolean := false;
  v_del boolean := false;
  v_fk boolean := false;
  v_msg text;
begin
  begin
    update public.compra_eventos set resumen = 'manipulado';
  exception when others then
    v_upd := sqlerrm like '%inmutable%';
  end;
  begin
    delete from public.compra_eventos;
  exception when others then
    v_del := sqlerrm like '%inmutable%';
  end;
  begin
    delete from public.compras where id = (select compra from b);
  exception when foreign_key_violation then
    v_fk := true;
  end;
  insert into r (caso, ok) values
    ('compra_eventos rechaza update (trigger, con el rol del script)', v_upd),
    ('compra_eventos rechaza delete (trigger, con el rol del script)', v_del),
    ('una compra con lineas y eventos no se puede borrar (restrict)', v_fk);
end
$$;
insert into r (caso, ok)
select 'el trigger compra_eventos_inmutable existe: before update or delete, por fila',
  (select (t.tgtype & 1) = 1 and (t.tgtype & 2) = 2 and (t.tgtype & 8) = 8 and (t.tgtype & 16) = 16 and (t.tgtype & 4) = 0
     from pg_trigger t where t.tgname = 'compra_eventos_inmutable' and t.tgrelid = 'public.compra_eventos'::regclass and not t.tgisinternal);
insert into r (caso, ok)
select 'los eventos no cambiaron tras los intentos de update y delete',
  (select count(*) from compra_eventos where resumen = 'manipulado') = 0 and (select count(*) from compra_eventos) >= 3;

-- ---------------------------------------------------------------------------------------------------------------------
-- 7. `importar_compra`
-- ---------------------------------------------------------------------------------------------------------------------
-- Compra H25-A: dos líneas. L1 específica de 500 (nov 300 y dic 200) con 100 ya recibidas en octubre; L2 lote de una marca de 100
-- (nov 100) con su reparto por entrega.
insert into salida select 'imp_a', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NORTE H25", "proveedor_es_intercompany": false, "referencia": "REF-A", "fecha_compra": "2026-09-10",
    "moneda": "PEN", "nota": "carga inicial de prueba", "origen": "carga_inicial",
    "lineas": [
      { "clave_importacion": "PROVEEDOR NORTE H25|REF-A|1", "huella_importacion": "h1", "tipo": "especifica",
        "genero_mundo_linea_id": "@G", "equivalencia_id": "@E1", "marca_id": "@M", "tallas": "ambas", "unidades": 500, "costo_unitario": 12.5,
        "destino": "cd",
        "entregas": [ { "periodo": "2026-11-01", "unidades": 300 }, { "periodo": "2026-12-01", "unidades": 200 } ],
        "recepciones": [ { "recibida_periodo": "2026-10-01", "unidades": 100, "fecha_recepcion": "2026-10-20" } ] },
      { "clave_importacion": "PROVEEDOR NORTE H25|REF-A|2", "huella_importacion": "h2", "tipo": "barrer_marca",
        "marca_id": "@M", "alcance": { "generos": [] }, "tallas": "centrales", "unidades": 100, "destino": "cd",
        "entregas": [ { "periodo": "2026-11-01", "unidades": 100 } ],
        "repartos": [ { "entrega_periodo": "2026-11-01", "marca_id": "@M", "genero_mundo_linea_id": "@G", "unidades": 70, "temporada": "verano" },
                      { "entrega_periodo": "2026-11-01", "marca_id": "@M", "genero_mundo_linea_id": "@G", "equivalencia_id": "@E1", "unidades": 30, "temporada": "verano" } ] }
    ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));

insert into r (caso, ok)
select 'importar_compra (nueva): ok, creada, proveedor creado, numero C-xxxxxx, revision 0 y estado confirmada',
  (select (j ->> 'ok')::boolean and (j ->> 'creada')::boolean and (j ->> 'proveedor_creado')::boolean and j ->> 'numero' ~ '^C-[0-9]{6}$'
      and (j ->> 'revision')::int = 0 and j ->> 'estado' = 'confirmada' and jsonb_array_length(j -> 'lineas') = 2
     from salida where k = 'imp_a');
insert into r (caso, ok)
select 'importar_compra: la cabecera lleva origen carga_inicial, moneda, confirmada_at y los nombres del actor',
  (select c.origen = 'carga_inicial' and c.estado = 'confirmada' and c.moneda = 'PEN' and c.confirmada_at is not null
      and c.confirmada_por_nombre = 'Humo 25' and c.usuario_nombre = 'Humo 25' and c.updated_by_nombre = 'Humo 25'
      and c.perfil_id = (select perfil from ids) and c.referencia = 'REF-A' and c.fecha_compra = date '2026-09-10'
     from compras c where c.id = (select (j ->> 'compra_id')::uuid from salida where k = 'imp_a'));
insert into r (caso, ok)
select 'importar_compra: el proveedor se crea (unico sobre upper) con el actor',
  (select count(*) from proveedores where upper(nombre) = 'PROVEEDOR NORTE H25' and not es_intercompany and activo and usuario_nombre = 'Humo 25') = 1;
insert into r (caso, ok)
select 'importar_compra: L1 con 500 u, llegada = primera entrega (2026-11-01), 100 recibidas, claves y huella guardadas',
  (select l.unidades = 500 and l.llegada_periodo = date '2026-11-01' and l.unidades_recibidas = 100 and l.unidades_canceladas = 0
      and l.clave_importacion = 'PROVEEDOR NORTE H25|REF-A|1' and l.huella_importacion = 'h1' and l.costo_unitario = 12.5 and l.tipo = 'especifica'
     from compra_lineas l where l.clave_importacion = 'PROVEEDOR NORTE H25|REF-A|1');
insert into r (caso, ok)
select 'importar_compra: 3 entregas (origen importada), 2 repartos por entrega del lote y 1 recepcion de origen importada con el actor',
  (select count(*) from compra_linea_entregas e join compra_lineas l on l.id = e.linea_id where l.clave_importacion like 'PROVEEDOR NORTE H25|REF-A|%' and e.origen = 'importada') = 3
  and (select count(*) from compra_linea_repartos rp join compra_lineas l on l.id = rp.linea_id where l.clave_importacion = 'PROVEEDOR NORTE H25|REF-A|2') = 2
  and (select sum(rp.unidades) from compra_linea_repartos rp join compra_lineas l on l.id = rp.linea_id where l.clave_importacion = 'PROVEEDOR NORTE H25|REF-A|2') = 100
  and (select count(*) from compra_linea_recepciones x join compra_lineas l on l.id = x.linea_id
        where l.clave_importacion = 'PROVEEDOR NORTE H25|REF-A|1' and x.origen = 'importada' and x.usuario_nombre = 'Humo 25' and x.recibida_periodo = date '2026-10-01') = 1;
insert into r (caso, ok)
select 'importar_compra: deja exactamente un evento importar, sin antes, con el despues (foto) y el resumen',
  (select count(*) = 1 and bool_and(accion = 'importar' and antes is null and despues ->> 'estado' = 'confirmada' and resumen is not null
        and jsonb_array_length(despues -> 'lineas') = 2 and jsonb_array_length(despues -> 'importado') = 2 and usuario_nombre = 'Humo 25' and linea_id is null)
     from compra_eventos where compra_id = (select (j ->> 'compra_id')::uuid from salida where k = 'imp_a'));

-- Reimportar la misma clave: rechazada sin escribir nada.
create temp table cuenta0 as
select (select count(*) from compras) as compras, (select count(*) from compra_lineas) as lineas, (select count(*) from compra_eventos) as eventos,
       (select count(*) from proveedores) as proveedores;
insert into salida select 'imp_dup', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "proveedor norte h25", "referencia": "REF-A", "fecha_compra": "2026-09-10",
    "lineas": [ { "clave_importacion": "PROVEEDOR NORTE H25|REF-A|1", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 10,
                  "entregas": [ { "periodo": "2026-11-01", "unidades": 10 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'importar_compra: una clave existente (otra capitalizacion del proveedor) da clave_existente y no escribe nada',
  (select j ->> 'motivo' = 'clave_existente' and not (j ->> 'ok')::boolean from salida where k = 'imp_dup')
  and (select compras = (select count(*) from compras) and lineas = (select count(*) from compra_lineas)
          and eventos = (select count(*) from compra_eventos) and proveedores = (select count(*) from proveedores) from cuenta0);

-- Agregar una línea nueva a la compra existente (mismo proveedor y referencia): sube la revisión.
insert into salida select 'imp_a2', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "Proveedor Norte H25", "referencia": "ref-a", "fecha_compra": "2026-09-10",
    "lineas": [ { "clave_importacion": "PROVEEDOR NORTE H25|REF-A|3", "tipo": "especifica", "genero_mundo_linea_id": "@G", "equivalencia_id": "@E2",
                  "marca_id": "@M", "unidades": 40, "entregas": [ { "periodo": "2026-12-01", "unidades": 40 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'importar_compra sobre una compra existente: la encuentra por proveedor y referencia, agrega la linea y sube revision a 1',
  (select (j ->> 'ok')::boolean and not (j ->> 'creada')::boolean and not (j ->> 'proveedor_creado')::boolean and (j ->> 'revision')::int = 1
      and (j ->> 'compra_id') = (select j ->> 'compra_id' from salida where k = 'imp_a')
     from salida where k = 'imp_a2')
  and (select count(*) from compra_lineas where compra_id = (select (j ->> 'compra_id')::uuid from salida where k = 'imp_a')) = 3
  and (select count(*) from proveedores where upper(nombre) = 'PROVEEDOR NORTE H25') = 1;
insert into r (caso, ok)
select 'importar_compra sobre una existente: segundo evento importar con antes = foto previa y despues = foto nueva',
  (select count(*) = 2 and bool_or(antes is not null and (antes -> 'revision')::int = 0 and (despues -> 'revision')::int = 1)
     from compra_eventos where compra_id = (select (j ->> 'compra_id')::uuid from salida where k = 'imp_a') and accion = 'importar');

-- Validaciones que no escriben.
create temp table cuenta1 as
select (select count(*) from compras) as compras, (select count(*) from compra_lineas) as lineas, (select count(*) from compra_eventos) as eventos,
       (select count(*) from proveedores) as proveedores, (select count(*) from compra_linea_entregas) as entregas;
insert into salida select 'imp_no_cuadra', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NUEVO NOCUADRA H25", "referencia": "REF-X", "fecha_compra": "2026-09-10",
    "lineas": [ { "clave_importacion": "K-NOCUADRA", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 600,
                  "entregas": [ { "periodo": "2026-11-01", "unidades": 300 }, { "periodo": "2026-12-01", "unidades": 200 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'imp_excede', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NUEVO EXCEDE H25", "referencia": "REF-X", "fecha_compra": "2026-09-10",
    "lineas": [ { "clave_importacion": "K-EXCEDE", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 100,
                  "entregas": [ { "periodo": "2026-11-01", "unidades": 100 } ],
                  "recepciones": [ { "recibida_periodo": "2026-10-01", "unidades": 101, "fecha_recepcion": "2026-10-20" } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'imp_sin_lineas', public.importar_compra(pg_temp.p('{"proveedor_nombre":"PROVEEDOR NUEVO SIN LINEAS H25","fecha_compra":"2026-09-10","lineas":[]}'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'imp_sin_prov', public.importar_compra(pg_temp.p($j$
  { "fecha_compra": "2026-09-10", "lineas": [ { "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 1, "entregas": [ { "periodo": "2026-11-01", "unidades": 1 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'imp_clave_repetida', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NUEVO REPETIDA H25", "referencia": "REF-Y", "fecha_compra": "2026-09-10",
    "lineas": [ { "clave_importacion": "K-REP", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 1, "entregas": [ { "periodo": "2026-11-01", "unidades": 1 } ] },
                { "clave_importacion": "K-REP", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 1, "entregas": [ { "periodo": "2026-11-01", "unidades": 1 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'imp_prov_inexistente', public.importar_compra(pg_temp.p($j$
  { "proveedor_id": "00000000-0000-4000-8000-00000000ffff", "fecha_compra": "2026-09-10",
    "lineas": [ { "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 1, "entregas": [ { "periodo": "2026-11-01", "unidades": 1 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'importar_compra: entregas que no suman las unidades => entregas_no_cuadran',
  (select j ->> 'motivo' from salida where k = 'imp_no_cuadra') = 'entregas_no_cuadran';
insert into r (caso, ok)
select 'importar_compra: recepciones mayores que las unidades => excede_pendiente', (select j ->> 'motivo' from salida where k = 'imp_excede') = 'excede_pendiente';
insert into r (caso, ok)
select 'importar_compra: sin lineas => sin_lineas; sin proveedor => proveedor_requerido; proveedor_id inexistente => proveedor_inexistente; clave repetida en el archivo => clave_existente',
  (select j ->> 'motivo' from salida where k = 'imp_sin_lineas') = 'sin_lineas'
  and (select j ->> 'motivo' from salida where k = 'imp_sin_prov') = 'proveedor_requerido'
  and (select j ->> 'motivo' from salida where k = 'imp_prov_inexistente') = 'proveedor_inexistente'
  and (select j ->> 'motivo' from salida where k = 'imp_clave_repetida') = 'clave_existente';
insert into r (caso, ok)
select 'importar_compra: ninguna validacion que falla deja compra, linea, entrega, evento ni proveedor nuevo',
  (select compras = (select count(*) from compras) and lineas = (select count(*) from compra_lineas) and eventos = (select count(*) from compra_eventos)
          and proveedores = (select count(*) from proveedores) and entregas = (select count(*) from compra_linea_entregas) from cuenta1);

-- Proveedor inactivo.
update proveedores set activo = false where upper(nombre) = 'PROVEEDOR NORTE H25';
insert into salida select 'imp_inactivo', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NORTE H25", "referencia": "REF-NUEVA", "fecha_compra": "2026-09-10",
    "lineas": [ { "clave_importacion": "K-INACTIVO", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 1, "entregas": [ { "periodo": "2026-11-01", "unidades": 1 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
update proveedores set activo = true where upper(nombre) = 'PROVEEDOR NORTE H25';
insert into r (caso, ok)
select 'importar_compra: proveedor inactivo => proveedor_inactivo (y nada escrito)',
  (select j ->> 'motivo' from salida where k = 'imp_inactivo') = 'proveedor_inactivo'
  and (select count(*) from compras where referencia = 'REF-NUEVA') = 0;

-- Atomicidad: una línea buena y una mala (entrega con periodo que no es primer dia de mes); proveedor nuevo en la misma llamada.
do $$
declare
  v_fallo boolean := false;
  v_sqlstate text;
begin
  begin
    perform public.importar_compra(pg_temp.p($j$
      { "proveedor_nombre": "PROVEEDOR ATOMICO H25", "referencia": "REF-ATOMICA", "fecha_compra": "2026-09-10",
        "lineas": [
          { "clave_importacion": "K-ATOM-1", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 10,
            "entregas": [ { "periodo": "2026-11-01", "unidades": 10 } ] },
          { "clave_importacion": "K-ATOM-2", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 10,
            "entregas": [ { "periodo": "2026-11-15", "unidades": 10 } ] } ] }
    $j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
  exception when others then
    v_fallo := true;
    v_sqlstate := sqlstate;
  end;
  insert into r (caso, ok) values
    ('importar_compra atomica: una entrega con periodo 2026-11-15 lanza check_violation (23514)', v_fallo and v_sqlstate = '23514'),
    ('importar_compra atomica: no queda compra, lineas, entregas, evento ni proveedor de esa llamada',
      (select count(*) from compras where referencia = 'REF-ATOMICA') = 0
      and (select count(*) from compra_lineas where clave_importacion like 'K-ATOM-%') = 0
      and (select count(*) from proveedores where upper(nombre) = 'PROVEEDOR ATOMICO H25') = 0
      and (select count(*) from compra_eventos where resumen like '%2 linea(s)%' and compra_id not in (select id from compras)) = 0);
end
$$;
-- Otro fallo a mitad: un reparto cuya entrega no existe (entrega_periodo sin entrega) viola not null y deshace todo.
do $$
declare
  v_fallo boolean := false;
begin
  begin
    perform public.importar_compra(pg_temp.p($j$
      { "proveedor_nombre": "PROVEEDOR ATOMICO2 H25", "referencia": "REF-ATOMICA2", "fecha_compra": "2026-09-10",
        "lineas": [ { "clave_importacion": "K-ATOM-3", "tipo": "barrer_marca", "marca_id": "@M", "unidades": 10,
                      "entregas": [ { "periodo": "2026-11-01", "unidades": 10 } ],
                      "repartos": [ { "entrega_periodo": "2026-12-01", "marca_id": "@M", "genero_mundo_linea_id": "@G", "unidades": 10 } ] } ] }
    $j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
  exception when not_null_violation then
    v_fallo := true;
  end;
  insert into r (caso, ok) values
    ('importar_compra atomica: un reparto sin entrega correspondiente lanza not_null_violation y no deja nada',
      v_fallo and (select count(*) from compras where referencia = 'REF-ATOMICA2') = 0
      and (select count(*) from proveedores where upper(nombre) = 'PROVEEDOR ATOMICO2 H25') = 0
      and (select count(*) from compra_lineas where clave_importacion = 'K-ATOM-3') = 0);
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- 8. `registrar_recepciones` y `quitar_recepcion`
-- ---------------------------------------------------------------------------------------------------------------------
-- Compra B (para probar `no_pertenece` con ids de otra compra y para cancelar sin recepciones).
insert into salida select 'imp_b', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR FERIA H25", "referencia": "REF-B", "fecha_compra": "2026-09-12",
    "lineas": [ { "clave_importacion": "PROVEEDOR FERIA H25|REF-B|1", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 80,
                  "entregas": [ { "periodo": "2026-11-01", "unidades": 80 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));

create temp table w as
select
  (select (j ->> 'compra_id')::uuid from salida where k = 'imp_a') as a,
  (select (j ->> 'compra_id')::uuid from salida where k = 'imp_b') as b,
  (select id from compra_lineas where clave_importacion = 'PROVEEDOR NORTE H25|REF-A|1') as a1,
  (select id from compra_lineas where clave_importacion = 'PROVEEDOR NORTE H25|REF-A|2') as a2,
  (select id from compra_lineas where clave_importacion = 'PROVEEDOR NORTE H25|REF-A|3') as a3,
  (select id from compra_lineas where clave_importacion = 'PROVEEDOR FERIA H25|REF-B|1') as b1,
  (select id from compra_linea_recepciones where unidades = 100 and origen = 'importada' limit 1) as a1_rec;

create temp table cuenta2 as
select (select revision from compras where id = (select a from w)) as rev_a, (select count(*) from compra_eventos where compra_id = (select a from w)) as ev_a,
       (select count(*) from compra_linea_recepciones) as recs;

-- Rechazos (no escriben nada).
insert into salida select 'rec_revision', public.registrar_recepciones((select a from w), 99,
  pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-11-01","unidades":10,"fecha_recepcion":"2026-11-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into salida select 'rec_ajena', public.registrar_recepciones((select a from w), 1,
  pg_temp.p('[{"linea_id":"' || (select b1 from w) || '","recibida_periodo":"2026-11-01","unidades":10,"fecha_recepcion":"2026-11-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into salida select 'rec_antes', public.registrar_recepciones((select a from w), 1,
  pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-08-01","unidades":10,"fecha_recepcion":"2026-08-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into salida select 'rec_excede', public.registrar_recepciones((select a from w), 1,
  pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-11-01","unidades":401,"fecha_recepcion":"2026-11-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into salida select 'rec_excede_suma', public.registrar_recepciones((select a from w), 1,
  pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-11-01","unidades":200,"fecha_recepcion":"2026-11-05"},{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-12-01","unidades":201,"fecha_recepcion":"2026-12-05"}]'),
  pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into salida select 'rec_vacia', public.registrar_recepciones((select a from w), 1, '[]'::jsonb, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into salida select 'rec_no_existe', public.registrar_recepciones(gen_random_uuid(), 1,
  pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-11-01","unidades":10,"fecha_recepcion":"2026-11-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into r (caso, ok)
select 'registrar_recepciones: revision distinta => compra_cambio', (select j ->> 'motivo' from salida where k = 'rec_revision') = 'compra_cambio';
insert into r (caso, ok)
select 'registrar_recepciones: una linea de otra compra => no_pertenece', (select j ->> 'motivo' from salida where k = 'rec_ajena') = 'no_pertenece';
insert into r (caso, ok)
select 'registrar_recepciones: periodo anterior al mes de la compra (2026-08 < 2026-09) => recepcion_antes_de_compra',
  (select j ->> 'motivo' from salida where k = 'rec_antes') = 'recepcion_antes_de_compra';
insert into r (caso, ok)
select 'registrar_recepciones: 401 u sobre una linea de 500 con 100 recibidas => excede_pendiente; tambien la suma de dos recepciones (200 + 201)',
  (select j ->> 'motivo' from salida where k = 'rec_excede') = 'excede_pendiente' and (select j ->> 'motivo' from salida where k = 'rec_excede_suma') = 'excede_pendiente';
insert into r (caso, ok)
select 'registrar_recepciones: lista vacia => sin_recepciones; compra inexistente => no_encontrada',
  (select j ->> 'motivo' from salida where k = 'rec_vacia') = 'sin_recepciones' and (select j ->> 'motivo' from salida where k = 'rec_no_existe') = 'no_encontrada';
insert into r (caso, ok)
select 'registrar_recepciones: ningun rechazo deja recepcion, evento ni sube la revision',
  (select revision from compras where id = (select a from w)) = (select rev_a from cuenta2)
  and (select count(*) from compra_eventos where compra_id = (select a from w)) = (select ev_a from cuenta2)
  and (select count(*) from compra_linea_recepciones) = (select recs from cuenta2)
  and (select count(*) from compra_eventos where compra_id = (select b from w)) = 1;

-- Atomicidad: la segunda recepción tiene un recibida_periodo que no es primer dia de mes: check_violation y no queda ni la primera.
do $$
declare
  v_fallo boolean := false;
begin
  begin
    perform public.registrar_recepciones((select a from w), 1,
      pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-11-01","unidades":10,"fecha_recepcion":"2026-11-05"},{"linea_id":"' || (select a3 from w) || '","recibida_periodo":"2026-11-15","unidades":5,"fecha_recepcion":"2026-11-15"}]'),
      pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
  exception when check_violation then
    v_fallo := true;
  end;
  insert into r (caso, ok) values
    ('registrar_recepciones atomica: una recepcion con periodo 2026-11-15 lanza check_violation y no deja la primera, ni evento ni revision',
      v_fallo
      and (select revision from compras where id = (select a from w)) = (select rev_a from cuenta2)
      and (select count(*) from compra_eventos where compra_id = (select a from w)) = (select ev_a from cuenta2)
      and (select count(*) from compra_linea_recepciones) = (select recs from cuenta2)
      and (select unidades_recibidas from compra_lineas where id = (select a1 from w)) = 100);
end
$$;

-- Recepcion valida con origen sugerencia y motivo.
insert into salida select 'rec_ok', public.registrar_recepciones((select a from w), 1,
  pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-11-01","unidades":200,"fecha_recepcion":"2026-11-30","nota":"Aceptada desde la conciliacion","origen":"sugerencia"}]'),
  pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), 'sugerencia de conciliacion 2026-11');
insert into r (caso, ok)
select 'registrar_recepciones: ok, revision 2, estado confirmada (quedan pendientes) y 1 recepcion registrada',
  (select (j ->> 'ok')::boolean and (j ->> 'revision')::int = 2 and j ->> 'estado' = 'confirmada' and jsonb_array_length(j -> 'recepcion_ids') = 1 from salida where k = 'rec_ok')
  and (select revision from compras where id = (select a from w)) = 2;
insert into r (caso, ok)
select 'registrar_recepciones: unidades_recibidas de la linea = suma de recepciones (300) y la recepcion guarda origen, fecha, actor y nota',
  (select unidades_recibidas from compra_lineas where id = (select a1 from w)) = 300
  and (select unidades_recibidas = (select coalesce(sum(unidades), 0) from compra_linea_recepciones where linea_id = (select a1 from w)) from compra_lineas where id = (select a1 from w))
  and (select count(*) from compra_linea_recepciones where linea_id = (select a1 from w) and origen = 'sugerencia' and fecha_recepcion = date '2026-11-30'
        and usuario_nombre = 'Humo 25' and perfil_id = (select perfil from ids) and nota = 'Aceptada desde la conciliacion') = 1;
insert into r (caso, ok)
select 'registrar_recepciones: evento recibir con linea_id, motivo, resumen, updated_by y la revision en la foto',
  (select count(*) = 1 and bool_and(linea_id = (select a1 from w) and motivo = 'sugerencia de conciliacion 2026-11' and resumen like 'Ingreso confirmado: 200 u%'
        and usuario_nombre = 'Humo 25' and (antes ->> 'revision')::int = 1 and (despues ->> 'revision')::int = 2)
     from compra_eventos where compra_id = (select a from w) and accion = 'recibir')
  and (select updated_by_nombre from compras where id = (select a from w)) = 'Humo 25';
insert into r (caso, ok)
select 'auditoria coherente: el despues del evento importar (sin la lista importado) es el antes del evento recibir',
  (select e2.antes = (e1.despues - 'importado')
     from compra_eventos e1, compra_eventos e2
    where e1.compra_id = (select a from w) and e1.accion = 'importar' and (e1.despues ->> 'revision')::int = 1
      and e2.compra_id = (select a from w) and e2.accion = 'recibir');
insert into r (caso, ok)
select 'registrar_recepciones: la misma revision otra vez (ya vieja) => compra_cambio',
  (public.registrar_recepciones((select a from w), 1, pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-11-01","unidades":1,"fecha_recepcion":"2026-11-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null) ->> 'motivo') = 'compra_cambio';

-- Completar todo: la compra pasa a recibida (varias lineas en una sola llamada: el evento no lleva linea_id).
insert into salida select 'rec_todo', public.registrar_recepciones((select a from w), 2,
  pg_temp.p('[{"linea_id":"' || (select a1 from w) || '","recibida_periodo":"2026-12-01","unidades":200,"fecha_recepcion":"2026-12-10"},{"linea_id":"' || (select a2 from w) || '","recibida_periodo":"2026-11-01","unidades":100,"fecha_recepcion":"2026-11-10"},{"linea_id":"' || (select a3 from w) || '","recibida_periodo":"2026-12-01","unidades":40,"fecha_recepcion":"2026-12-10"}]'),
  pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into r (caso, ok)
select 'registrar_recepciones: todas las lineas recibidas por completo => estado recibida y revision 3',
  (select (j ->> 'ok')::boolean and j ->> 'estado' = 'recibida' and (j ->> 'revision')::int = 3 from salida where k = 'rec_todo')
  and (select estado from compras where id = (select a from w)) = 'recibida'
  and (select count(*) from compra_lineas where compra_id = (select a from w) and unidades_recibidas = unidades) = 3;
insert into r (caso, ok)
select 'registrar_recepciones con varias lineas: el evento recibir queda sin linea_id',
  (select count(*) from compra_eventos where compra_id = (select a from w) and accion = 'recibir' and linea_id is null and (despues ->> 'estado') = 'recibida') = 1;

-- Quitar una recepcion.
create temp table cuenta3 as
select (select revision from compras where id = (select a from w)) as rev_a, (select count(*) from compra_eventos where compra_id = (select a from w)) as ev_a,
       (select count(*) from compra_linea_recepciones) as recs;
insert into salida select 'q_revision', public.quitar_recepcion((select a from w), (select a1_rec from w), 1, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'q_ajena', public.quitar_recepcion((select b from w), (select a1_rec from w), 0, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'q_no_existe', public.quitar_recepcion((select a from w), gen_random_uuid(), 3, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'quitar_recepcion: revision distinta => compra_cambio; recepcion de otra compra => no_pertenece; recepcion inexistente => no_pertenece',
  (select j ->> 'motivo' from salida where k = 'q_revision') = 'compra_cambio'
  and (select j ->> 'motivo' from salida where k = 'q_ajena') = 'no_pertenece'
  and (select j ->> 'motivo' from salida where k = 'q_no_existe') = 'no_pertenece';
insert into r (caso, ok)
select 'quitar_recepcion: los rechazos no borran, no suben revision ni escriben evento (ni en la compra A ni en la B)',
  (select revision from compras where id = (select a from w)) = (select rev_a from cuenta3)
  and (select count(*) from compra_eventos where compra_id = (select a from w)) = (select ev_a from cuenta3)
  and (select count(*) from compra_linea_recepciones) = (select recs from cuenta3)
  and (select revision from compras where id = (select b from w)) = 0
  and (select count(*) from compra_eventos where compra_id = (select b from w)) = 1;
insert into salida select 'q_ok', public.quitar_recepcion((select a from w), (select a1_rec from w), 3, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'quitar_recepcion: ok, borra la recepcion, resta de unidades_recibidas (400 de 500) y la compra vuelve de recibida a confirmada',
  (select (j ->> 'ok')::boolean and j ->> 'estado' = 'confirmada' and (j ->> 'revision')::int = 4 from salida where k = 'q_ok')
  and (select count(*) from compra_linea_recepciones where id = (select a1_rec from w)) = 0
  and (select unidades_recibidas from compra_lineas where id = (select a1 from w)) = 400
  and (select estado from compras where id = (select a from w)) = 'confirmada';
insert into r (caso, ok)
select 'quitar_recepcion: evento con la recepcion en el antes y no en el despues, y linea_id de la linea',
  (select count(*) = 1 and bool_and(linea_id = (select a1 from w)
        and (antes -> 'recepciones') @> jsonb_build_array(jsonb_build_object('id', (select a1_rec from w)))
        and not ((despues -> 'recepciones') @> jsonb_build_array(jsonb_build_object('id', (select a1_rec from w))))
        and resumen like 'Ingreso quitado: 100 u de 2026-10')
     from compra_eventos where compra_id = (select a from w) and accion = 'quitar_recepcion')
  and (select count(*) from compra_eventos e where e.compra_id = (select a from w) and e.accion = 'quitar_recepcion' and e.antes -> 'recepciones' @> '[{"unidades":100}]'::jsonb) = 1;

-- ---------------------------------------------------------------------------------------------------------------------
-- 9. `cancelar_compra` (ficha §0.11, regla 31)
-- ---------------------------------------------------------------------------------------------------------------------
-- 9.1 Sin recepciones: queda cancelada y libera la clave de importacion.
insert into salida select 'c_motivo', public.cancelar_compra((select b from w), 0, '   ', pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'c_motivo_largo', public.cancelar_compra((select b from w), 0, repeat('m', 201), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'c_revision', public.cancelar_compra((select b from w), 5, 'error de carga', pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'cancelar_compra: motivo vacio o de mas de 200 caracteres => motivo_requerido; revision distinta => compra_cambio',
  (select j ->> 'motivo' from salida where k = 'c_motivo') = 'motivo_requerido' and (select j ->> 'motivo' from salida where k = 'c_motivo_largo') = 'motivo_requerido'
  and (select j ->> 'motivo' from salida where k = 'c_revision') = 'compra_cambio'
  and (select estado from compras where id = (select b from w)) = 'confirmada';
insert into salida select 'c_b', public.cancelar_compra((select b from w), 0, 'error de carga', pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'cancelar_compra sin recepciones: estado cancelada, motivo, cancelada_at y actor guardados, revision 1, sin saldo cerrado',
  (select (j ->> 'ok')::boolean and j ->> 'estado' = 'cancelada' and (j ->> 'revision')::int = 1 and (j ->> 'unidades_canceladas')::int = 0 from salida where k = 'c_b')
  and (select estado = 'cancelada' and motivo_cancelacion = 'error de carga' and cancelada_at is not null and cancelada_por_nombre = 'Humo 25'
          and cancelada_por_id = (select perfil from ids) and updated_by_nombre = 'Humo 25' from compras where id = (select b from w))
  and (select unidades_canceladas from compra_lineas where id = (select b1 from w)) = 0;
insert into r (caso, ok)
select 'cancelar_compra: evento cancelar con el motivo, el antes (confirmada) y el despues (cancelada)',
  (select count(*) = 1 and bool_and(motivo = 'error de carga' and antes ->> 'estado' = 'confirmada' and despues ->> 'estado' = 'cancelada' and resumen = 'Compra cancelada' and linea_id is null)
     from compra_eventos where compra_id = (select b from w) and accion = 'cancelar');
insert into r (caso, ok)
select 'una compra cancelada es inmutable: cancelar otra vez, recibir y quitar recepcion => no_editable',
  (public.cancelar_compra((select b from w), 1, 'otra vez', pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}')) ->> 'motivo') = 'no_editable'
  and (public.registrar_recepciones((select b from w), 1, pg_temp.p('[{"linea_id":"' || (select b1 from w) || '","recibida_periodo":"2026-11-01","unidades":1,"fecha_recepcion":"2026-11-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null) ->> 'motivo') = 'no_editable'
  and (public.quitar_recepcion((select b from w), gen_random_uuid(), 1, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}')) ->> 'motivo') = 'no_editable';
-- La clave de una compra cancelada se libera: la misma fila se reimporta como compra nueva.
insert into salida select 'imp_b2', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR FERIA H25", "referencia": "REF-B", "fecha_compra": "2026-09-12",
    "lineas": [ { "clave_importacion": "PROVEEDOR FERIA H25|REF-B|1", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 80,
                  "entregas": [ { "periodo": "2026-11-01", "unidades": 80 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'importar_compra: la clave de una compra cancelada se libera; la reimportacion crea una compra nueva (no agrega a la cancelada)',
  (select (j ->> 'ok')::boolean and (j ->> 'creada')::boolean and (j ->> 'compra_id') <> (select b::text from w) and (j ->> 'revision')::int = 0 from salida where k = 'imp_b2')
  and (select count(*) from compra_lineas where clave_importacion = 'PROVEEDOR FERIA H25|REF-B|1') = 2;

-- 9.2 Todo recibido => recibida. Compra C: una linea de 50 totalmente recibida.
insert into salida select 'imp_c', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NORTE H25", "referencia": "REF-C", "fecha_compra": "2026-09-15",
    "lineas": [ { "clave_importacion": "PROVEEDOR NORTE H25|REF-C|1", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 50,
                  "entregas": [ { "periodo": "2026-10-01", "unidades": 50 } ],
                  "recepciones": [ { "recibida_periodo": "2026-10-01", "unidades": 50, "fecha_recepcion": "2026-10-05" } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'importar_compra con RECIBIDAS = UNIDADES: la compra nace recibida (todo llego)',
  (select (j ->> 'ok')::boolean and j ->> 'estado' = 'recibida' from salida where k = 'imp_c');
insert into r (caso, ok)
select 'cancelar_compra sobre una compra con todo recibido => recibida (no hay saldo que cancelar) y no escribe nada',
  (public.cancelar_compra((select (j ->> 'compra_id')::uuid from salida where k = 'imp_c'), 0, 'x', pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}')) ->> 'motivo') = 'recibida'
  and (select revision from compras where id = (select (j ->> 'compra_id')::uuid from salida where k = 'imp_c')) = 0
  and (select count(*) from compra_eventos where compra_id = (select (j ->> 'compra_id')::uuid from salida where k = 'imp_c')) = 1;

-- 9.3 Con recepciones => saldo cerrado (regla 31): compra de 500 (oct 300, nov 200), con 100 en ago y 200 en oct.
insert into salida select 'imp_d', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NORTE H25", "referencia": "REF-D", "fecha_compra": "2026-07-05",
    "lineas": [ { "clave_importacion": "PROVEEDOR NORTE H25|REF-D|1", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 500,
                  "entregas": [ { "periodo": "2026-10-01", "unidades": 300 }, { "periodo": "2026-11-01", "unidades": 200 } ],
                  "recepciones": [ { "recibida_periodo": "2026-08-01", "unidades": 100, "fecha_recepcion": "2026-08-20" } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
create temp table dd as
select (j ->> 'compra_id')::uuid as compra, (select id from compra_lineas where clave_importacion = 'PROVEEDOR NORTE H25|REF-D|1') as linea from salida where k = 'imp_d';
insert into salida select 'd_rec', public.registrar_recepciones((select compra from dd), 0,
  pg_temp.p('[{"linea_id":"' || (select linea from dd) || '","recibida_periodo":"2026-10-01","unidades":200,"fecha_recepcion":"2026-10-25"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into salida select 'd_cancelar', public.cancelar_compra((select compra from dd), 1, 'proveedor no despacha el saldo', pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'cancelar_compra con recepciones (regla 31): estado recibida, unidades_canceladas = 200, pendientes 0, revision 2 y el motivo guardado',
  (select (j ->> 'ok')::boolean and j ->> 'estado' = 'recibida' and (j ->> 'unidades_canceladas')::int = 200 and (j ->> 'revision')::int = 2 from salida where k = 'd_cancelar')
  and (select estado = 'recibida' and cancelada_at is not null and motivo_cancelacion = 'proveedor no despacha el saldo' from compras where id = (select compra from dd))
  and (select unidades = 500 and unidades_recibidas = 300 and unidades_canceladas = 200 and unidades - unidades_recibidas - unidades_canceladas = 0
         from compra_lineas where id = (select linea from dd));
insert into r (caso, ok)
select 'cancelar con recepciones: las recepciones siguen valiendo (2) y el evento marca saldo_cerrado en el despues',
  (select count(*) from compra_linea_recepciones where linea_id = (select linea from dd)) = 2
  and (select count(*) = 1 and bool_and(not (antes ->> 'saldo_cerrado')::boolean and (despues ->> 'saldo_cerrado')::boolean and resumen like 'Saldo cancelado: 200 u%')
        from compra_eventos where compra_id = (select compra from dd) and accion = 'cancelar');
insert into r (caso, ok)
select 'cancelar de nuevo una compra con saldo cerrado => recibida (ya no hay saldo)',
  (public.cancelar_compra((select compra from dd), 2, 'otra vez', pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}')) ->> 'motivo') = 'recibida';

-- 9.4 Ingreso tardio sobre el saldo cerrado: 50 u => recibidas 350, canceladas 150. Mas de lo cancelado => excede_pendiente.
insert into salida select 'd_excede', public.registrar_recepciones((select compra from dd), 2,
  pg_temp.p('[{"linea_id":"' || (select linea from dd) || '","recibida_periodo":"2026-11-01","unidades":201,"fecha_recepcion":"2026-11-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into salida select 'd_tardia', public.registrar_recepciones((select compra from dd), 2,
  pg_temp.p('[{"linea_id":"' || (select linea from dd) || '","recibida_periodo":"2026-11-01","unidades":50,"fecha_recepcion":"2026-11-05"}]'), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'), null);
insert into r (caso, ok)
select 'saldo cerrado: confirmar 201 u (mas de lo cancelado) => excede_pendiente',
  (select j ->> 'motivo' from salida where k = 'd_excede') = 'excede_pendiente';
insert into r (caso, ok)
select 'saldo cerrado: confirmar 50 u tardias => recibidas 350, canceladas 150, sigue recibida y con saldo cerrado',
  (select (j ->> 'ok')::boolean and j ->> 'estado' = 'recibida' and (j ->> 'revision')::int = 3 from salida where k = 'd_tardia')
  and (select unidades_recibidas = 350 and unidades_canceladas = 150 from compra_lineas where id = (select linea from dd))
  and (select estado = 'recibida' and cancelada_at is not null from compras where id = (select compra from dd));

-- 9.5 Quitar recepciones en saldo cerrado: devuelve a lo cancelado; sin ninguna recepcion, la compra pasa a cancelada.
insert into salida select 'd_quitar_tardia', public.quitar_recepcion((select compra from dd),
  (select id from compra_linea_recepciones where linea_id = (select linea from dd) and unidades = 50), 3, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'saldo cerrado: quitar la recepcion tardia devuelve las 50 u a lo cancelado (recibidas 300, canceladas 200, recibida)',
  (select (j ->> 'ok')::boolean and j ->> 'estado' = 'recibida' and (j ->> 'revision')::int = 4 from salida where k = 'd_quitar_tardia')
  and (select unidades_recibidas = 300 and unidades_canceladas = 200 from compra_lineas where id = (select linea from dd));
insert into salida select 'd_quitar_1', public.quitar_recepcion((select compra from dd),
  (select id from compra_linea_recepciones where linea_id = (select linea from dd) and unidades = 100), 4, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'd_quitar_2', public.quitar_recepcion((select compra from dd),
  (select id from compra_linea_recepciones where linea_id = (select linea from dd) and unidades = 200), 5, pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'saldo cerrado: tras quitar la primera recepcion sigue recibida (canceladas 400); al quitar la ultima la compra pasa a cancelada con canceladas = unidades',
  (select j ->> 'estado' from salida where k = 'd_quitar_1') = 'recibida'
  and (select j ->> 'estado' from salida where k = 'd_quitar_2') = 'cancelada'
  and (select estado = 'cancelada' from compras where id = (select compra from dd))
  and (select unidades_recibidas = 0 and unidades_canceladas = 500 from compra_lineas where id = (select linea from dd));
insert into r (caso, ok)
select 'la compra D dejo 7 eventos en orden (importar, recibir, cancelar, recibir, quitar x3) y updated_by_nombre es el actor',
  (select count(*) from compra_eventos where compra_id = (select compra from dd)) = 7
  and (select count(*) from compra_eventos where compra_id = (select compra from dd) and accion = 'recibir') = 2
  and (select count(*) from compra_eventos where compra_id = (select compra from dd) and accion = 'quitar_recepcion') = 3
  and (select updated_by_nombre from compras where id = (select compra from dd)) = 'Humo 25';

-- 9.6 Importar una linea nueva a una compra con saldo cerrado => saldo_cerrado (no se deja una linea ya cancelada). Compra E.
insert into salida select 'imp_e', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NORTE H25", "referencia": "REF-E", "fecha_compra": "2026-09-20",
    "lineas": [ { "clave_importacion": "PROVEEDOR NORTE H25|REF-E|1", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 100,
                  "entregas": [ { "periodo": "2026-11-01", "unidades": 100 } ],
                  "recepciones": [ { "recibida_periodo": "2026-10-01", "unidades": 30, "fecha_recepcion": "2026-10-05" } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'e_cancelar', public.cancelar_compra((select (j ->> 'compra_id')::uuid from salida where k = 'imp_e'), 0, 'cierre de saldo', pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into salida select 'imp_e2', public.importar_compra(pg_temp.p($j$
  { "proveedor_nombre": "PROVEEDOR NORTE H25", "referencia": "REF-E", "fecha_compra": "2026-09-20",
    "lineas": [ { "clave_importacion": "PROVEEDOR NORTE H25|REF-E|2", "genero_mundo_linea_id": "@G", "marca_id": "@M", "unidades": 10,
                  "entregas": [ { "periodo": "2026-11-01", "unidades": 10 } ] } ] }
$j$), pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}'));
insert into r (caso, ok)
select 'importar_compra sobre una compra con saldo cerrado => saldo_cerrado y no agrega la linea',
  (select j ->> 'motivo' from salida where k = 'imp_e2') = 'saldo_cerrado'
  and (select count(*) from compra_lineas where clave_importacion = 'PROVEEDOR NORTE H25|REF-E|2') = 0;

-- ---------------------------------------------------------------------------------------------------------------------
-- 10. Pasada completa como `service_role` (el rol con el que corre la API): permisos de tablas, secuencia y funciones; y el
--     trigger de eventos inmutables TAMBIEN para service_role
-- ---------------------------------------------------------------------------------------------------------------------
-- En el clúster local `service_role` no tiene BYPASSRLS (en Supabase sí): se le concede dentro de la transacción (el `rollback`
-- final lo deshace) para que las tablas con RLS y sin políticas se vean como las ve el backend.
alter role service_role bypassrls;
create temp table pre_sr as
select pg_temp.p('{"proveedor_nombre":"PROVEEDOR SR H25","referencia":"REF-SR","fecha_compra":"2026-09-10","lineas":[{"clave_importacion":"SR|REF-SR|1","genero_mundo_linea_id":"@G","marca_id":"@M","unidades":100,"entregas":[{"periodo":"2026-11-01","unidades":100}]}]}') as imp,
       pg_temp.p('{"perfil_id":"@P","nombre":"Humo 25"}') as actor,
       (select id from cargas_venta_stock where periodo = date '2025-09-01') as carga;
grant select on pre_sr to service_role;
do $$
declare
  v_imp jsonb; v_rec jsonb; v_q jsonb; v_c jsonb; v_stock jsonb; v_huella jsonb;
  v_compra uuid; v_linea uuid; v_recep uuid;
  v_upd boolean := false; v_del boolean := false; v_trunc text;
  v_ok boolean;
  v_pre record;
begin
  select * into v_pre from pre_sr;
  set local role service_role;
  v_imp := public.importar_compra(v_pre.imp, v_pre.actor);
  v_compra := (v_imp ->> 'compra_id')::uuid;
  select id into v_linea from public.compra_lineas where compra_id = v_compra;
  v_rec := public.registrar_recepciones(v_compra, (v_imp ->> 'revision')::int,
    jsonb_build_array(jsonb_build_object('linea_id', v_linea, 'recibida_periodo', '2026-11-01', 'unidades', 40, 'fecha_recepcion', '2026-11-05')),
    v_pre.actor, null);
  select id into v_recep from public.compra_linea_recepciones where linea_id = v_linea;
  v_q := public.quitar_recepcion(v_compra, v_recep, (v_rec ->> 'revision')::int, v_pre.actor);
  v_c := public.cancelar_compra(v_compra, (v_q ->> 'revision')::int, 'prueba con service_role', v_pre.actor);
  v_stock := public.stock_flujo(v_pre.carga);
  v_huella := public.flujo_huella_base();
  begin update public.compra_eventos set resumen = 'manipulado' where compra_id = v_compra; exception when others then v_upd := sqlerrm like '%inmutable%'; end;
  begin delete from public.compra_eventos where compra_id = v_compra; exception when others then v_del := sqlerrm like '%inmutable%'; end;
  reset role;
  insert into r (caso, ok) values
    ('service_role: importar_compra (usa la secuencia compras_numero_seq y escribe 5 tablas) devuelve ok',
      (v_imp ->> 'ok')::boolean and v_imp ->> 'numero' ~ '^C-[0-9]{6}$'),
    ('service_role: registrar_recepciones, quitar_recepcion y cancelar_compra devuelven ok encadenando la revision',
      (v_rec ->> 'ok')::boolean and (v_q ->> 'ok')::boolean and (v_c ->> 'ok')::boolean and v_c ->> 'estado' = 'cancelada' and (v_c ->> 'revision')::int = 3),
    ('service_role: stock_flujo y flujo_huella_base responden (publicada, con filas)',
      (v_stock ->> 'publicada')::boolean and jsonb_array_length(v_stock -> 'filas') = 2 and v_huella ? 'compras'),
    ('service_role: update sobre compra_eventos lo rechaza el trigger (no el permiso)', v_upd),
    ('service_role: delete sobre compra_eventos lo rechaza el trigger (no el permiso)', v_del),
    ('service_role: los eventos de la compra siguen intactos (4 eventos: importar, recibir, quitar_recepcion, cancelar)',
      (select count(*) from compra_eventos where compra_id = v_compra) = 4 and (select count(*) from compra_eventos where compra_id = v_compra and resumen = 'manipulado') = 0);
exception when others then
  insert into r (caso, ok) values ('service_role: pasada completa sin excepcion (fallo: ' || sqlerrm || ')', false);
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
