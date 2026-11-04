-- 0035 · Registro de migraciones aplicadas y privilegios uniformes en las tablas de solo inserción.
--
-- Origen: revisión independiente de arquitectura (2026-11-04), hallazgos 1 y 5b.
--
-- Qué hace (dos cosas, ninguna toca datos de negocio):
--
--   1. `public.migraciones_aplicadas`: registro de qué archivos de `supabase/migrations/` están aplicados en esta base. Las migraciones
--      se aplican con `execute_sql`, así que `supabase_migrations.schema_migrations` (y `list_migrations`) está vacío: hasta hoy la
--      verdad vivía en README, PLAN y CHANGELOG. Se siembra (backfill) con las 33 aplicadas en Vector2 al 2026-11-04 y se
--      registra a sí misma. Convención desde ahora: toda migración termina con
--          insert into public.migraciones_aplicadas (nombre) values ('NNNN_nombre') on conflict do nothing;
--
--   2. Privilegios de `service_role` sobre las 8 tablas de solo inserción (las que tienen trigger de inmutabilidad contra UPDATE,
--      DELETE y TRUNCATE). Antes de esta migración el patrón no era uniforme: `proyeccion_lotes`, `proyeccion_lote_filas` (0031) y
--      `compra_agrupador_eventos` (0032) ya estaban en `select, insert`; `compra_eventos` (0025) y las 5 `ia_*` inmutables (0030)
--      seguían con `grant all`, de modo que solo el trigger frenaba el borrado. Queda `select, insert` en las 8: el trigger pasa a ser
--      la segunda barrera (la que vale para el dueño, `postgres`) y el privilegio la primera (la que vale para la API).
--
-- NUMERACIÓN: la 0035 es la siguiente libre (0026 y 0028 siguen reservadas: `0.13.1 · M8` y M9a; no están aplicadas ni existen como
-- archivo, y por eso NO se siembran en el registro).
--
-- Idempotente: `create table if not exists`, `insert ... on conflict do nothing`, `enable row level security`, y `revoke`/`grant`
-- repetibles (`revoke all` y luego el grant exacto). Sin bloques `do $$ ... $$`, sin DROP, DELETE ni TRUNCATE.
--
-- AVISO DE ORDEN: las migraciones 0013 (`grant all on all tables`), 0025 y 0030 (`grant all` a `service_role`) devuelven privilegios
-- si se vuelven a correr SUELTAS después de esta. En una pasada completa en orden no hay problema (la 0035 corre después y deja el
-- estado final). Si alguien reaplica una de ellas a mano, que reaplique la 0035 a continuación. Toda tabla de solo inserción nueva
-- debe llevar su propio `revoke all ... grant select, insert` (los privilegios por defecto de 0013 dan `all` a `service_role`).

-- ---------------------------------------------------------------------------
-- 1. Registro de migraciones aplicadas
-- ---------------------------------------------------------------------------
-- Excepción a la convención de tablas: sin `id uuid`, `activo` ni `updated_at`. La clave natural es el nombre del archivo sin `.sql`,
-- y el registro es de solo inserción (una migración aplicada no se "desaplica" ni se edita). El check de formato evita nombres
-- sueltos: cuatro dígitos, guion bajo y snake_case, igual que los archivos.
create table if not exists public.migraciones_aplicadas (
  nombre      text primary key
              constraint migraciones_aplicadas_nombre_formato check (nombre ~ '^[0-9]{4}_[a-z0-9_]+$'),
  aplicada_at timestamptz not null default now(),
  nota        text
);

comment on table public.migraciones_aplicadas is
  'Registro de las migraciones de supabase/migrations/ aplicadas en esta base (0035). Solo inserción: service_role lee e inserta. Se aplican con execute_sql, asi que supabase_migrations.schema_migrations esta vacio; esta tabla es la verdad. Cada migracion nueva termina con insert (nombre) on conflict do nothing.';
comment on column public.migraciones_aplicadas.nombre is
  'Nombre del archivo sin .sql, por ejemplo 0035_registro_migraciones_y_privilegios.';
comment on column public.migraciones_aplicadas.aplicada_at is
  'Cuando se registro. En el backfill de la 0035 es la fecha de ese registro, no la de aplicacion real de cada migracion anterior (la nota lo indica).';

-- Backfill: las 33 migraciones aplicadas en Vector2 al 2026-11-04 (0000 a 0025, 0027 y 0029 a 0034), comprobadas contra los objetos
-- que existen en la base. Faltan a propósito 0026 y 0028 (reservadas, sin archivo). En una base local recién creada el resultado
-- es el mismo porque el script de validación aplica todas las migraciones.
insert into public.migraciones_aplicadas (nombre, nota)
select v.nombre, 'backfill de la 0035: aplicada antes de existir el registro'
from (values
  ('0000_base'),
  ('0001_arbol_producto'),
  ('0002_marcas'),
  ('0003_agrupaciones_estacionalidad'),
  ('0004_tiendas'),
  ('0005_agrupacion_estacionalidad_genero'),
  ('0006_responsables'),
  ('0007_venta_stock'),
  ('0008_mapeo_combinaciones'),
  ('0009_ubicaciones_ignoradas'),
  ('0010_nivel_planificacion_marcas_gml'),
  ('0011_periodos_atipicos_temporada'),
  ('0012_sugerir_marcas_relevantes_v2'),
  ('0013_endurecer_permisos'),
  ('0014_unidades_mensuales'),
  ('0015_curvas_estacionalidad'),
  ('0016_agregado_estacionalidad'),
  ('0017_venta_estacionalidad_agrupacion'),
  ('0018_proyeccion_anual'),
  ('0019_analisis_marcas_barrer'),
  ('0020_intercompany'),
  ('0021_proyeccion_disponibilidad'),
  ('0022_composicion_y_curva_usuario'),
  ('0023_crecimientos_por_genero_mundo'),
  ('0024_repartos_temporadas_usadas'),
  ('0025_flujo_y_compras'),
  ('0027_crecimientos_genero_mundo'),
  ('0029_cierre_y_base_sin_nino'),
  ('0030_propuesta_ia'),
  ('0031_lotes_proyeccion'),
  ('0032_agrupadores_compras'),
  ('0033_venta_tienda_nodos'),
  ('0034_importar_borrador_propio')
) as v(nombre)
on conflict (nombre) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Privilegios: las 8 tablas de solo inserción quedan en `select, insert`
-- ---------------------------------------------------------------------------
-- Inventario (Vector2, 2026-11-04; trigger de inmutabilidad contra UPDATE, DELETE y TRUNCATE):
--   compra_eventos (0025, ya con trigger de truncate por 0032), compra_agrupador_eventos (0032), ia_entradas, ia_llamadas,
--   ia_propuestas_gm, ia_propuestas_filas (0030), proyeccion_lotes, proyeccion_lote_filas (0031).
-- Verificado antes de recortar:
--   * Ninguna de las 50 funciones SQL de `public` hace UPDATE, DELETE ni TRUNCATE sobre ellas, ni INSERT ... ON CONFLICT DO UPDATE,
--     ni las bloquea con FOR UPDATE/SHARE (son `security invoker`: correrían con los permisos de `service_role`). Solo insertan.
--   * Ningún servicio de `src/` llama `.update()`, `.delete()` ni `.upsert()` sobre ellas: solo `select` e `insert`.
--
-- Excepciones documentadas de los triggers (`perfil_id`, `proyeccion_id` o `fila_id` a NULL por `on delete set null`): NO exigen
-- UPDATE para `service_role`. Una acción referencial de una FK corre con los privilegios del dueño de la tabla (`postgres`),
-- no con los de quien borró la fila padre; por eso `proyeccion_lotes` y `proyeccion_lote_filas` ya funcionaban sin `update` desde
-- 0031. Se comprueba en `scripts/humo-0035.sql` borrando un perfil con `service_role` sin UPDATE sobre estas tablas. Por eso
-- no se deja ni un UPDATE a nivel de columna.
--
-- `revoke all ... from public, anon, authenticated, service_role` y luego el grant exacto: repetible y sin depender de lo que
-- hubiera antes. `references` y `trigger` también se quitan: el dueño crea las FK y los triggers.
revoke all on public.compra_eventos from public, anon, authenticated, service_role;
grant select, insert on public.compra_eventos to service_role;

revoke all on public.compra_agrupador_eventos from public, anon, authenticated, service_role;
grant select, insert on public.compra_agrupador_eventos to service_role;

revoke all on public.ia_entradas from public, anon, authenticated, service_role;
grant select, insert on public.ia_entradas to service_role;

revoke all on public.ia_llamadas from public, anon, authenticated, service_role;
grant select, insert on public.ia_llamadas to service_role;

revoke all on public.ia_propuestas_gm from public, anon, authenticated, service_role;
grant select, insert on public.ia_propuestas_gm to service_role;

revoke all on public.ia_propuestas_filas from public, anon, authenticated, service_role;
grant select, insert on public.ia_propuestas_filas to service_role;

revoke all on public.proyeccion_lotes from public, anon, authenticated, service_role;
grant select, insert on public.proyeccion_lotes to service_role;

revoke all on public.proyeccion_lote_filas from public, anon, authenticated, service_role;
grant select, insert on public.proyeccion_lote_filas to service_role;

-- Tablas de auditoría de la IA que NO son de solo inserción: `ia_evaluaciones`, `ia_corridas` e `ia_corrida_gms` se actualizan mientras
-- la corrida está en curso (el trigger `tg_ia_terminal` las congela solo en estado terminal), así que conservan select, insert,
-- update y delete (el delete lo deja pasar el trigger fuera de estado terminal; ningún servicio lo usa, pero no es de esta tanda
-- cerrarlo). Lo que SÍ se quita es TRUNCATE: ningún trigger lo frena en ellas y ningún servicio ni función lo usa.
revoke truncate on public.ia_evaluaciones from public, anon, authenticated, service_role;
revoke truncate on public.ia_corridas from public, anon, authenticated, service_role;
revoke truncate on public.ia_corrida_gms from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. RLS (sin políticas: solo el backend con service_role) y permisos del registro
-- ---------------------------------------------------------------------------
alter table public.migraciones_aplicadas enable row level security;

-- Solo inserción, sin update ni delete: una fila del registro no se edita ni se borra desde la API. Quien migra (el dueño) la
-- inserta por su cuenta. `revoke all` primero porque los privilegios por defecto de 0013 dan `all` a `service_role`.
revoke all on public.migraciones_aplicadas from public, anon, authenticated, service_role;
grant select, insert on public.migraciones_aplicadas to service_role;

-- ---------------------------------------------------------------------------
-- 4. Registro de esta migración (convención: la última sentencia de cada migración)
-- ---------------------------------------------------------------------------
insert into public.migraciones_aplicadas (nombre, nota)
values ('0035_registro_migraciones_y_privilegios', 'crea el registro y recorta privilegios de las tablas de solo insercion')
on conflict (nombre) do nothing;
