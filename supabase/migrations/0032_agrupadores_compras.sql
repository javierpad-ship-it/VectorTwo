-- M8 08b-1 · Agrupadores de compras: viajes, embarques y paquetes (versión por fijar al cerrar la entrega).
--
-- Ficha: docs/modulos/08b-agrupadores-de-compras.md (§0.3 permisos, §2 modelo de datos completo, §2.9 funciones, candados e
-- invariantes, §3.11 importador de agrupadores, §5 reglas R1-R26).
-- NUMERACIÓN: la ficha cita esta migración con el marcador `00B1_agrupadores_compras.sql` («el número libre al construir»). Estaban
-- aplicadas 0000-0025, 0027, 0029, 0030 y 0031; la 0026 (0.13.1 · M8) y la 0028 (M9a) siguen reservadas. Esta toma la 0032, que
-- había quedado reservada nominalmente para 07f (`0032_venta_tienda_nodos.sql`): 07f está en espera, NO está construida ni aplicada, y
-- se renumerará a la siguiente libre cuando se retome. Depende de 0000 (`tg_set_updated_at`), 0006 (`perfiles`) y 0025 (`compras`,
-- `compra_lineas`, `compra_linea_entregas`, `compra_linea_repartos`, `compra_linea_recepciones`, `compra_eventos`, `compra_foto`,
-- `compra_recalcular_estado`).
--
-- SE APLICA ANTES DEL CÓDIGO DE 08b-1, con el código anterior desplegado: todo lo que añade es inocuo para él (tablas nuevas, DOS
-- columnas nulas con su FK y funciones nuevas). No hay seed ni backfill. Las compras existentes quedan sin viaje y sus entregas sin
-- embarque (se asignan a mano desde «Sin agrupador» o con las columnas del importador).
--
-- Qué hace:
--   1. `compra_viajes`, `compra_embarques` (con `periodo_llegada` generada), `compra_paquetes` y `compra_entrega_asignaciones`.
--   2. `compra_agrupador_eventos`: auditoría INMUTABLE de los agrupadores (solo inserción; triggers de fila y de `truncate`).
--   3. `compras.viaje_id` y `compra_linea_recepciones.asignacion_id` (esta última la llenan solo las funciones de 08b-2).
--   4. Trigger `before truncate` en `compra_eventos` (cierra el pendiente M-3 de M8); no toca su trigger de fila.
--   5. Ayudantes: `agrupador_responsable_asignable`, `agrupador_nombre_clave`, `agrupador_es_activa`, `agrupador_siguiente_codigo`,
--      `agrupador_foto_embarque`, `compra_foto_entregas`, `agrupadores_desalineados`.
--   6. Funciones de escritura: `guardar_viaje`, `guardar_embarque`, `guardar_paquete`, `cambiar_estado_agrupador`,
--      `asignar_viaje_compras`, `agrupador_mover_entregas` (interno), `aplicar_movimiento_agrupador` e `importar_agrupadores`.
--
-- Idempotente: `create table if not exists`, `add column if not exists`, `create index if not exists`, `create or replace trigger`,
-- `create or replace function`, `revoke`/`grant`/`comment` repetibles. Sin `do $$ ... $$`. Sin `drop`, `delete`, `truncate` ni `update` A
-- NIVEL DE MIGRACIÓN; dentro de las funciones sí hay `insert`, `update` y `delete` (es su trabajo).
--
-- Criterio de la base (ficha §2): solo invariantes ESTRUCTURALES (longitudes, rangos, `revision >= 0`, fechas ordenadas, unidades
-- positivas, la FK compuesta paquete-embarque y los únicos). Los catálogos (`estado`, `tipo`, `accion`) NO llevan `check`: los valida zod.
--
-- Seguridad: RLS activo y SIN políticas en las cinco tablas (solo entra el backend con `service_role`); `revoke all` a public, anon y
-- authenticated y `grant` exacto a service_role. Las funciones son `security invoker`, con `search_path` vacío y solo `service_role`.
-- Quien escribe es el backend: las funciones NO comprueban el rol de la persona (lo hacen los guards de la API, §0.3).
--
-- Convenciones de las funciones de escritura (ficha §2.9): `returns jsonb`, `{ ok: true, ... }` o `{ ok: false, motivo }`;
-- `p_actor = { perfil_id, nombre }`. Orden global de candados: viajes (por id) -> embarques (por id) -> compras (por id), siempre
-- `for update`. `guardar_embarque` y `asignar_viaje_compras` bloquean viajes primero. `aplicar_movimiento_agrupador` NO bloquea
-- viajes: ninguna función espera un viaje mientras sostiene un embarque o una compra, así que respeta el orden como subsecuencia y no
-- serializa todos los movimientos de un viaje.
--
-- Motivos de rechazo que las funciones que RECHAZAN DESPUÉS DE ESCRIBIR (`aplicar_movimiento_agrupador`, `importar_agrupadores`)
-- lanzan con SQLSTATE `AG001` (mensaje = motivo): un bloque `exception` los atrapa, deshace TODO lo escrito por la llamada y devuelve
-- `{ ok: false, motivo }`. Una violación de invariante que delata un plan mal armado (el plan de TypeScript y la base discrepan) se
-- lanza con `AG002` y NO se atrapa: el error llega a la API como un fallo y se ve.
--
-- Los cuerpos de las funciones van sin comentarios `--` (el SQL Editor de Supabase los parsea mal dentro de `$$`): lo que hay que
-- saber de cada una está aquí, encima. Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `compra_viajes` (comercial: dónde y cuándo se compró; también es el «viaje activo»)
-- ---------------------------------------------------------------------------
-- `codigo` (§2.2): `aamm##` u otro `^[A-Z0-9-]{1,30}$`; único por tipo sin distinguir mayúsculas (índice sobre `upper(codigo)`). El
-- código NO cambia si después cambian las fechas y no se reutiliza. `estado` (zod): abierto | cerrado | cancelado. `cerrado` es solo
-- informativo (decisión 95); solo `cancelado` bloquea. `responsable_id`: obligatorio al crear (lo exige la función); nulo solo si se
-- borra el perfil (`set null`). Nunca se borra: se cancela.
create table if not exists public.compra_viajes (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint compra_viajes_codigo_len_check
      check (char_length(codigo) between 1 and 30),
  nombre text not null
    constraint compra_viajes_nombre_len_check
      check (char_length(nombre) between 1 and 120),
  destino text
    constraint compra_viajes_destino_len_check
      check (destino is null or char_length(destino) <= 120),
  fecha_inicio date not null,
  fecha_fin date,
  responsable_id uuid
    constraint compra_viajes_responsable_id_fkey
      references public.perfiles(id) on delete set null,
  estado text not null default 'abierto',
  nota text
    constraint compra_viajes_nota_len_check
      check (nota is null or char_length(nota) <= 500),
  revision integer not null default 0
    constraint compra_viajes_revision_check check (revision >= 0),
  perfil_id uuid
    constraint compra_viajes_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  updated_by_id uuid
    constraint compra_viajes_updated_by_id_fkey
      references public.perfiles(id) on delete set null,
  updated_by_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compra_viajes_fechas_check
    check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

create unique index if not exists compra_viajes_codigo_uniq on public.compra_viajes (upper(codigo));
create index if not exists compra_viajes_estado_idx on public.compra_viajes (estado);
create index if not exists compra_viajes_fecha_inicio_idx on public.compra_viajes (fecha_inicio);
create index if not exists compra_viajes_responsable_id_idx on public.compra_viajes (responsable_id);
create index if not exists compra_viajes_perfil_id_idx on public.compra_viajes (perfil_id);
create index if not exists compra_viajes_updated_by_id_idx on public.compra_viajes (updated_by_id);

create or replace trigger set_updated_at before update on public.compra_viajes
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_viajes is
  'M8 08b-1: viaje de compras (agrupador comercial; en COTV, campaigns). Codigo aamm## o libre, unico por upper(codigo). estado abierto | cerrado (informativo, decision 95) | cancelado (bloquea). Nunca se borra: se cancela. Toda mutacion pasa por funciones plpgsql con revision. No es presupuesto (decision 81).';
comment on column public.compra_viajes.responsable_id is
  'M8 08b-1 2.8: comprador o admin activo (el planner no). Obligatorio al crear; nulo solo si se borra el perfil. Desactivarlo o cambiarle el rol conserva la asignacion (aviso sin_responsable).';

-- ---------------------------------------------------------------------------
-- 2. `compra_embarques` (logístico: qué llega junto, cuándo sale y cuándo llega)
-- ---------------------------------------------------------------------------
-- `tipo` (zod): importacion | local (`local` => `viaje_id` nulo, lo exige la función: local_con_viaje). `viaje_id` restrict.
-- `responsable_id` nulo = hereda del viaje. `puerto_embarque`: puerto REAL de este envío (decisión 96; el habitual del proveedor, de la
-- ficha 08c, es solo una sugerencia). `fecha_llegada_estimada`: llegada al CD; alinea las entregas y se cambia SOLO por movimiento
-- (`aplicar_movimiento_agrupador`). `fecha_llegada_real` solo la escriben las funciones de 08b-2.
-- `periodo_llegada`: primer día del mes de `coalesce(fecha_llegada_real, fecha_llegada_estimada)`. Expresión INMUTABLE con `make_date`
-- (`date_trunc` sobre un `date` sin `::timestamp` resuelve a la versión `stable` y la columna generada falla). La lógica de TypeScript
-- usa exactamente la misma regla (`periodoLlegada`). `estado` (zod): planificado | en_transito | recibido (08b-2) | cancelado.
-- `revision` cubre también a sus paquetes.
create table if not exists public.compra_embarques (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint compra_embarques_codigo_len_check
      check (char_length(codigo) between 1 and 30),
  nombre text not null
    constraint compra_embarques_nombre_len_check
      check (char_length(nombre) between 1 and 120),
  tipo text not null default 'importacion',
  viaje_id uuid
    constraint compra_embarques_viaje_id_fkey
      references public.compra_viajes(id) on delete restrict,
  responsable_id uuid
    constraint compra_embarques_responsable_id_fkey
      references public.perfiles(id) on delete set null,
  referencia_logistica text
    constraint compra_embarques_referencia_len_check
      check (referencia_logistica is null or char_length(referencia_logistica) <= 80),
  puerto_embarque text
    constraint compra_embarques_puerto_len_check
      check (puerto_embarque is null or char_length(puerto_embarque) <= 80),
  fecha_salida_estimada date,
  fecha_llegada_estimada date not null,
  fecha_llegada_real date,
  periodo_llegada date generated always as (
    make_date(
      extract(year from coalesce(fecha_llegada_real, fecha_llegada_estimada))::integer,
      extract(month from coalesce(fecha_llegada_real, fecha_llegada_estimada))::integer,
      1
    )
  ) stored,
  estado text not null default 'planificado',
  nota text
    constraint compra_embarques_nota_len_check
      check (nota is null or char_length(nota) <= 500),
  revision integer not null default 0
    constraint compra_embarques_revision_check check (revision >= 0),
  perfil_id uuid
    constraint compra_embarques_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  updated_by_id uuid
    constraint compra_embarques_updated_by_id_fkey
      references public.perfiles(id) on delete set null,
  updated_by_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Red de seguridad: la función lo valida antes y devuelve salida_despues_de_llegada.
  constraint compra_embarques_salida_llegada_check
    check (fecha_salida_estimada is null or fecha_salida_estimada <= fecha_llegada_estimada)
);

create unique index if not exists compra_embarques_codigo_uniq on public.compra_embarques (upper(codigo));
create index if not exists compra_embarques_viaje_id_idx on public.compra_embarques (viaje_id);
create index if not exists compra_embarques_estado_idx on public.compra_embarques (estado);
create index if not exists compra_embarques_periodo_llegada_idx on public.compra_embarques (periodo_llegada);
create index if not exists compra_embarques_responsable_id_idx on public.compra_embarques (responsable_id);
create index if not exists compra_embarques_perfil_id_idx on public.compra_embarques (perfil_id);
create index if not exists compra_embarques_updated_by_id_idx on public.compra_embarques (updated_by_id);

create or replace trigger set_updated_at before update on public.compra_embarques
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_embarques is
  'M8 08b-1: embarque (agrupador logistico, importacion o local). La fecha de llegada al CD vive aqui y alinea las entregas asignadas (decision 83). periodo_llegada es una columna generada con expresion inmutable. revision cubre tambien a sus paquetes.';
comment on column public.compra_embarques.periodo_llegada is
  'M8 08b-1: primer dia del mes de coalesce(fecha_llegada_real, fecha_llegada_estimada). Generada con make_date (inmutable). TypeScript usa la misma regla (periodoLlegada).';
comment on column public.compra_embarques.puerto_embarque is
  'M8 08b-1 (decision 96): puerto real de este envio, texto libre con sugerencias; el puerto habitual del proveedor (ficha 08c) es solo una sugerencia.';

-- ---------------------------------------------------------------------------
-- 3. `compra_paquetes` (subdivisión de UN embarque)
-- ---------------------------------------------------------------------------
-- `unique (id, embarque_id)` es el destino de la FK compuesta de las asignaciones: así un paquete pertenece a un único embarque y una
-- asignación con paquete lleva el embarque de ese paquete (R1). Sin fecha propia: llega con su embarque. `estado` (zod): abierto |
-- cancelado. `responsable_id` nulo = hereda del embarque.
create table if not exists public.compra_paquetes (
  id uuid primary key default gen_random_uuid(),
  embarque_id uuid not null
    constraint compra_paquetes_embarque_id_fkey
      references public.compra_embarques(id) on delete restrict,
  codigo text not null
    constraint compra_paquetes_codigo_len_check
      check (char_length(codigo) between 1 and 30),
  nombre text not null
    constraint compra_paquetes_nombre_len_check
      check (char_length(nombre) between 1 and 120),
  responsable_id uuid
    constraint compra_paquetes_responsable_id_fkey
      references public.perfiles(id) on delete set null,
  estado text not null default 'abierto',
  nota text
    constraint compra_paquetes_nota_len_check
      check (nota is null or char_length(nota) <= 300),
  perfil_id uuid
    constraint compra_paquetes_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  updated_by_id uuid
    constraint compra_paquetes_updated_by_id_fkey
      references public.perfiles(id) on delete set null,
  updated_by_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compra_paquetes_id_embarque_key unique (id, embarque_id)
);

create unique index if not exists compra_paquetes_codigo_uniq on public.compra_paquetes (upper(codigo));
create index if not exists compra_paquetes_embarque_id_idx on public.compra_paquetes (embarque_id);
create index if not exists compra_paquetes_responsable_id_idx on public.compra_paquetes (responsable_id);
create index if not exists compra_paquetes_perfil_id_idx on public.compra_paquetes (perfil_id);
create index if not exists compra_paquetes_updated_by_id_idx on public.compra_paquetes (updated_by_id);

create or replace trigger set_updated_at before update on public.compra_paquetes
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_paquetes is
  'M8 08b-1: paquete, subdivision de UN embarque (unique (id, embarque_id) para la FK compuesta de las asignaciones). Sin fecha propia: llega con su embarque. estado abierto | cancelado.';

-- ---------------------------------------------------------------------------
-- 4. `compra_entrega_asignaciones` (reparte las unidades de una entrega entre embarques y paquetes)
-- ---------------------------------------------------------------------------
-- M8 tiene `unique (linea_id, periodo)`: dos embarques de la misma línea en el mismo mes se funden en UNA entrega, que no podría
-- pertenecer a dos embarques. Cambiar esa unicidad exigiría un DROP CONSTRAINT, que el proyecto evita; por eso esta tabla reparte
-- UNIDADES y el flujo sigue leyendo `compra_linea_entregas` sin cambios. `entrega_id` y `embarque_id` restrict: nadie borra una entrega
-- con asignaciones sin ocuparse de ellas. FK compuesta `(paquete_id, embarque_id) -> compra_paquetes (id, embarque_id)`: con `paquete_id`
-- nulo (MATCH SIMPLE) no se comprueba; con `on update cascade`, mover un paquete a otro embarque arrastra sus asignaciones.
-- Único `(entrega, embarque, coalesce(paquete, uuid cero))`: dos NULL no chocan en un UNIQUE normal. `activo` es convención, sin uso.
create table if not exists public.compra_entrega_asignaciones (
  id uuid primary key default gen_random_uuid(),
  entrega_id uuid not null
    constraint compra_entrega_asignaciones_entrega_id_fkey
      references public.compra_linea_entregas(id) on delete restrict,
  embarque_id uuid not null
    constraint compra_entrega_asignaciones_embarque_id_fkey
      references public.compra_embarques(id) on delete restrict,
  paquete_id uuid,
  unidades integer not null
    constraint compra_entrega_asignaciones_unidades_check check (unidades > 0),
  perfil_id uuid
    constraint compra_entrega_asignaciones_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  updated_by_id uuid
    constraint compra_entrega_asignaciones_updated_by_id_fkey
      references public.perfiles(id) on delete set null,
  updated_by_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compra_entrega_asignaciones_paquete_embarque_fkey
    foreign key (paquete_id, embarque_id)
    references public.compra_paquetes (id, embarque_id) on update cascade on delete restrict
);

create unique index if not exists compra_entrega_asignaciones_clave_uniq
  on public.compra_entrega_asignaciones (
    entrega_id,
    embarque_id,
    coalesce(paquete_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
-- Cubren las FK (la de `entrega_id` la cubre el prefijo del único).
create index if not exists compra_entrega_asignaciones_embarque_id_idx on public.compra_entrega_asignaciones (embarque_id);
create index if not exists compra_entrega_asignaciones_paquete_id_idx on public.compra_entrega_asignaciones (paquete_id);
create index if not exists compra_entrega_asignaciones_perfil_id_idx on public.compra_entrega_asignaciones (perfil_id);
create index if not exists compra_entrega_asignaciones_updated_by_id_idx on public.compra_entrega_asignaciones (updated_by_id);

create or replace trigger set_updated_at before update on public.compra_entrega_asignaciones
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_entrega_asignaciones is
  'M8 08b-1: reparte las unidades de una entrega (compra_linea_entregas) entre embarques y paquetes. Unico (entrega, embarque, coalesce(paquete, uuid cero)). FK compuesta (paquete, embarque) con on update cascade. La escriben solo las funciones de agrupadores, que suben compras.revision y dejan evento (I5).';

-- ---------------------------------------------------------------------------
-- 5. Columnas nuevas en tablas de M8 (aditivas, nulas, sin backfill)
-- ---------------------------------------------------------------------------
-- `compras.viaje_id`: el viaje se conoce al negociar, antes de que exista un embarque (§2.1). Va en la misma sentencia que su FK
-- (`add column if not exists` omite la cláusula entera si la columna ya existe: repite sin error y sin bloque `do $$`).
alter table public.compras
  add column if not exists viaje_id uuid
    constraint compras_viaje_id_fkey
      references public.compra_viajes(id) on delete restrict;
create index if not exists compras_viaje_id_idx on public.compras (viaje_id);

comment on column public.compras.viaje_id is
  'M8 08b-1: viaje de compras de esta compra (nulo = sin viaje). Lo escribe solo asignar_viaje_compras. Si difiere del viaje del embarque de sus entregas, aviso viaje_distinto (no bloquea).';

-- `compra_linea_recepciones.asignacion_id`: «llegó con este embarque». Nula en todo lo que registra M8; la llenan SOLO las funciones de
-- 08b-2 (`recibir_embarque`). Se crea ya aquí para no tocar M8 dos veces.
alter table public.compra_linea_recepciones
  add column if not exists asignacion_id uuid
    constraint compra_linea_recepciones_asignacion_id_fkey
      references public.compra_entrega_asignaciones(id) on delete restrict;
create index if not exists compra_linea_recepciones_asignacion_id_idx on public.compra_linea_recepciones (asignacion_id);

comment on column public.compra_linea_recepciones.asignacion_id is
  'M8 08b-2: asignacion (entrega x embarque x paquete) con la que llego esta recepcion. Nula en todo lo que registra M8; la llenan solo las funciones de 08b-2.';

-- ---------------------------------------------------------------------------
-- 6. `compra_agrupador_eventos` (auditoría INMUTABLE de agrupadores)
-- ---------------------------------------------------------------------------
-- Sin `updated_at` ni `activo`: nunca cambia. `accion` (zod): crear | editar | cambiar_estado | asignar_viaje | asignar | quitar |
-- mover_a_paquete | cambiar_fecha | pasar_pendientes | mover_paquete | recibir | otra_llegada | revertir_recepcion. `antes` y `despues`
-- son instantáneas. `compras` = [{ compra_id, revision_nueva }]. Las FK a viajes, embarques y paquetes son `restrict`: nada con eventos
-- se borra. Al menos una de las tres debe venir.
create table if not exists public.compra_agrupador_eventos (
  id uuid primary key default gen_random_uuid(),
  viaje_id uuid
    constraint compra_agrupador_eventos_viaje_id_fkey
      references public.compra_viajes(id) on delete restrict,
  embarque_id uuid
    constraint compra_agrupador_eventos_embarque_id_fkey
      references public.compra_embarques(id) on delete restrict,
  paquete_id uuid
    constraint compra_agrupador_eventos_paquete_id_fkey
      references public.compra_paquetes(id) on delete restrict,
  accion text not null,
  antes jsonb,
  despues jsonb,
  motivo text
    constraint compra_agrupador_eventos_motivo_len_check
      check (motivo is null or char_length(motivo) <= 300),
  resumen text
    constraint compra_agrupador_eventos_resumen_len_check
      check (resumen is null or char_length(resumen) <= 300),
  compras jsonb not null default '[]'::jsonb
    constraint compra_agrupador_eventos_compras_check
      check (jsonb_typeof(compras) = 'array'),
  perfil_id uuid
    constraint compra_agrupador_eventos_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now(),
  constraint compra_agrupador_eventos_agrupador_check
    check (num_nonnulls(viaje_id, embarque_id, paquete_id) >= 1)
);

create index if not exists compra_agrupador_eventos_embarque_created_idx on public.compra_agrupador_eventos (embarque_id, created_at);
create index if not exists compra_agrupador_eventos_viaje_created_idx on public.compra_agrupador_eventos (viaje_id, created_at);
create index if not exists compra_agrupador_eventos_paquete_id_idx on public.compra_agrupador_eventos (paquete_id);
create index if not exists compra_agrupador_eventos_perfil_id_idx on public.compra_agrupador_eventos (perfil_id);

comment on table public.compra_agrupador_eventos is
  'M8 08b-1: auditoria de viajes, embarques y paquetes, insert-only. tg_compra_agrupador_inmutable rechaza update, delete y truncate, tambien para service_role; excepcion: perfil_id a NULL (FK set null). antes y despues son instantaneas; compras = [{ compra_id, revision_nueva }].';

-- ---------------------------------------------------------------------------
-- 7. Triggers de inmutabilidad (por fila y por sentencia)
-- ---------------------------------------------------------------------------
-- Mismo patrón que `tg_proyeccion_lote_inmutable` (0031): rechaza DELETE, TRUNCATE (trigger por sentencia: uno por fila no lo cubre) y
-- todo UPDATE salvo el que SOLO pone `perfil_id` en NULL (lo emite la FK `on delete set null` al borrar un perfil). SQLSTATE
-- `restrict_violation`. Las ramas de DELETE y TRUNCATE no tocan `old` ni `new` (en TRUNCATE no existen).
create or replace function public.tg_compra_agrupador_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if old.perfil_id is not null
       and new.perfil_id is null
       and (to_jsonb(new) - 'perfil_id') = (to_jsonb(old) - 'perfil_id') then
      return new;
    end if;
  end if;
  raise exception '% es un registro inmutable: no admite cambios, borrados ni vaciado', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.tg_compra_agrupador_inmutable() from public, anon, authenticated;
grant execute on function public.tg_compra_agrupador_inmutable() to service_role;

comment on function public.tg_compra_agrupador_inmutable() is
  'M8 08b-1: trigger de compra_agrupador_eventos. Rechaza delete, truncate y todo update salvo el que solo pone perfil_id en NULL. Vale tambien para service_role.';

create or replace trigger compra_agrupador_eventos_inmutable
  before update or delete on public.compra_agrupador_eventos
  for each row execute function public.tg_compra_agrupador_inmutable();
create or replace trigger compra_agrupador_eventos_sin_vaciado
  before truncate on public.compra_agrupador_eventos
  for each statement execute function public.tg_compra_agrupador_inmutable();

-- `compra_eventos` (0025) solo tenía el trigger de fila: un `truncate` lo saltaba (pendiente M-3 de M8). Función propia para la
-- sentencia (la de fila de 0025 lee `old`, que en TRUNCATE no existe) y `create or replace trigger`; no se toca el trigger de fila.
create or replace function public.tg_compra_eventos_sin_vaciado()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'compra_eventos es un registro inmutable: no admite vaciado'
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.tg_compra_eventos_sin_vaciado() from public, anon, authenticated;
grant execute on function public.tg_compra_eventos_sin_vaciado() to service_role;

comment on function public.tg_compra_eventos_sin_vaciado() is
  'M8 08b-1 (cierra el pendiente M-3 de M8): trigger por sentencia que rechaza truncate en compra_eventos, tambien para service_role.';

create or replace trigger compra_eventos_sin_vaciado
  before truncate on public.compra_eventos
  for each statement execute function public.tg_compra_eventos_sin_vaciado();

-- ---------------------------------------------------------------------------
-- 8. Ayudantes (solo lectura salvo el candado de `agrupador_siguiente_codigo`)
-- ---------------------------------------------------------------------------
-- 8.1 ¿El perfil es asignable como responsable? (§2.8, decisión 85): perfil ACTIVO con rol comprador o admin; el planner no.
create or replace function public.agrupador_responsable_asignable(p_perfil uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.perfiles p
    where p.id = p_perfil
      and p.activo
      and p.rol in ('comprador', 'admin')
  );
$$;

revoke execute on function public.agrupador_responsable_asignable(uuid) from public, anon, authenticated;
grant execute on function public.agrupador_responsable_asignable(uuid) to service_role;

comment on function public.agrupador_responsable_asignable(uuid) is
  'M8 08b-1 2.8: true si el perfil esta activo y es comprador o admin (el planner no). Solo lectura. Solo service_role.';

-- 8.2 Nombre normalizado para la clave natural del importador (§3.11): mayúsculas, sin espacios de más.
create or replace function public.agrupador_nombre_clave(p_nombre text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select regexp_replace(upper(btrim(p_nombre)), '\s+', ' ', 'g');
$$;

revoke execute on function public.agrupador_nombre_clave(text) from public, anon, authenticated;
grant execute on function public.agrupador_nombre_clave(text) to service_role;

comment on function public.agrupador_nombre_clave(text) is
  'M8 08b-1 3.11: nombre en mayusculas y con los espacios colapsados, para la clave natural del importador de agrupadores. Solo service_role.';

-- 8.3 Asignación ACTIVA (§2.6): compra borrador o confirmada, línea activa y línea no recibida ni cancelada por completo. Lo demás es
-- histórico: compra recibida o cancelada, línea inactiva o con recibidas + canceladas = unidades. Misma regla que `clasificarAsignacion`.
create or replace function public.agrupador_es_activa(
  p_estado text,
  p_linea_activa boolean,
  p_unidades integer,
  p_recibidas integer,
  p_canceladas integer
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select p_estado in ('borrador', 'confirmada')
     and p_linea_activa
     and (p_recibidas + p_canceladas) < p_unidades;
$$;

revoke execute on function public.agrupador_es_activa(text, boolean, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.agrupador_es_activa(text, boolean, integer, integer, integer) to service_role;

comment on function public.agrupador_es_activa(text, boolean, integer, integer, integer) is
  'M8 08b-1 2.6: true si la asignacion es activa (compra borrador o confirmada, linea activa y no recibida/cancelada por completo). Lo demas es historico. Solo service_role.';

-- 8.4 Siguiente código `aamm##` de un tipo (viaje, embarque o paquete) para el mes de `p_referencia` (§2.2). Toma el candado consultivo
-- `agrupador_codigo:<tipo>` dentro de la transacción de quien la llama. El correlativo es el MAYOR `##` de los códigos de ese tipo
-- que cumplen `^<aamm>[0-9]{2}$` (escritos a mano o no) más uno: un hueco no se rellena y un código no se reutiliza. Devuelve NULL si
-- el `99` ya está usado (la función de escritura responde correlativo_agotado). No usa secuencias.
create or replace function public.agrupador_siguiente_codigo(p_tipo text, p_referencia date)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_pref text := to_char(p_referencia, 'YYMM');
  v_patron text := '^' || to_char(p_referencia, 'YYMM') || '[0-9]{2}$';
  v_max integer;
begin
  perform pg_advisory_xact_lock(hashtext('agrupador_codigo:' || p_tipo));
  if p_tipo = 'viaje' then
    select max(substr(upper(c.codigo), 5, 2)::integer) into v_max from public.compra_viajes c where upper(c.codigo) ~ v_patron;
  elsif p_tipo = 'embarque' then
    select max(substr(upper(c.codigo), 5, 2)::integer) into v_max from public.compra_embarques c where upper(c.codigo) ~ v_patron;
  elsif p_tipo = 'paquete' then
    select max(substr(upper(c.codigo), 5, 2)::integer) into v_max from public.compra_paquetes c where upper(c.codigo) ~ v_patron;
  else
    raise exception 'tipo de agrupador desconocido: %', p_tipo using errcode = 'AG002';
  end if;
  if coalesce(v_max, 0) >= 99 then
    return null;
  end if;
  return v_pref || lpad((coalesce(v_max, 0) + 1)::text, 2, '0');
end;
$$;

revoke execute on function public.agrupador_siguiente_codigo(text, date) from public, anon, authenticated;
grant execute on function public.agrupador_siguiente_codigo(text, date) to service_role;

comment on function public.agrupador_siguiente_codigo(text, date) is
  'M8 08b-1 2.2: siguiente codigo aamm## de un tipo para el mes de la fecha dada (maximo mas uno, con pg_advisory_xact_lock agrupador_codigo:<tipo>). NULL si el 99 ya esta usado. Solo service_role.';

-- 8.5 Instantánea de un embarque para `compra_agrupador_eventos.antes` y `despues`.
create or replace function public.agrupador_foto_embarque(p_embarque uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'estado', e.estado,
    'revision', e.revision,
    'viaje_id', e.viaje_id,
    'fecha_salida_estimada', e.fecha_salida_estimada,
    'fecha_llegada_estimada', e.fecha_llegada_estimada,
    'fecha_llegada_real', e.fecha_llegada_real,
    'periodo_llegada', e.periodo_llegada
  )
  from public.compra_embarques e
  where e.id = p_embarque;
$$;

revoke execute on function public.agrupador_foto_embarque(uuid) from public, anon, authenticated;
grant execute on function public.agrupador_foto_embarque(uuid) to service_role;

comment on function public.agrupador_foto_embarque(uuid) is
  'M8 08b-1: instantanea de un embarque (estado, revision, viaje, fechas, periodo) para compra_agrupador_eventos. Solo lectura. Solo service_role.';

-- 8.6 `compra_foto_entregas(p_compra)` (revisión I9): entregas, repartos y asignaciones de la compra. El evento de compras guarda
-- `antes` y `despues` como `compra_foto(c) || compra_foto_entregas(c)`. No se reemplaza `compra_foto` de M8. Los repartos van
-- resumidos por entrega (filas y unidades) para no inflar el evento; `viaje_id` es el de la compra.
create or replace function public.compra_foto_entregas(p_compra uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'viaje_id', (select c.viaje_id from public.compras c where c.id = p_compra),
    'entregas', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', e.id,
                  'linea_id', e.linea_id,
                  'periodo', e.periodo,
                  'unidades', e.unidades,
                  'origen', e.origen)
                order by e.linea_id, e.periodo)
         from public.compra_linea_entregas e
         join public.compra_lineas l on l.id = e.linea_id
         where l.compra_id = p_compra),
      '[]'::jsonb),
    'repartos', coalesce(
      (select jsonb_agg(
                jsonb_build_object('entrega_id', x.entrega_id, 'filas', x.filas, 'unidades', x.unidades)
                order by x.entrega_id)
         from (
           select r.entrega_id, count(*) as filas, sum(r.unidades) as unidades
           from public.compra_linea_repartos r
           join public.compra_lineas l on l.id = r.linea_id
           where l.compra_id = p_compra
           group by r.entrega_id
         ) x),
      '[]'::jsonb),
    'asignaciones', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', a.id,
                  'entrega_id', a.entrega_id,
                  'embarque_id', a.embarque_id,
                  'paquete_id', a.paquete_id,
                  'unidades', a.unidades)
                order by a.entrega_id, a.embarque_id, a.id)
         from public.compra_entrega_asignaciones a
         join public.compra_linea_entregas e on e.id = a.entrega_id
         join public.compra_lineas l on l.id = e.linea_id
         where l.compra_id = p_compra),
      '[]'::jsonb)
  );
$$;

revoke execute on function public.compra_foto_entregas(uuid) from public, anon, authenticated;
grant execute on function public.compra_foto_entregas(uuid) to service_role;

comment on function public.compra_foto_entregas(uuid) is
  'M8 08b-1 (revision I9): entregas, repartos (resumidos por entrega) y asignaciones de una compra, mas su viaje. Los eventos guardan compra_foto(c) || compra_foto_entregas(c). No reemplaza compra_foto de M8. Solo lectura. Solo service_role.';

-- 8.7 `agrupadores_desalineados()`: asignaciones ACTIVAS cuya entrega no está en el mes de llegada de su embarque. Una asignación que
-- vuelve a ser activa por fuera (p. ej. quitar una recepción en M8) puede quedar así: se avisa `desalineada` con «Realinear». El humo
-- exige que no devuelva filas; la aplicación solo avisa.
create or replace function public.agrupadores_desalineados()
returns table (
  asignacion_id uuid,
  embarque_id uuid,
  entrega_id uuid,
  periodo date,
  periodo_llegada date
)
language sql
stable
security invoker
set search_path = ''
as $$
  select a.id, a.embarque_id, a.entrega_id, e.periodo, b.periodo_llegada
  from public.compra_entrega_asignaciones a
  join public.compra_linea_entregas e on e.id = a.entrega_id
  join public.compra_lineas l on l.id = e.linea_id
  join public.compras c on c.id = l.compra_id
  join public.compra_embarques b on b.id = a.embarque_id
  where public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
    and e.periodo <> b.periodo_llegada;
$$;

revoke execute on function public.agrupadores_desalineados() from public, anon, authenticated;
grant execute on function public.agrupadores_desalineados() to service_role;

comment on function public.agrupadores_desalineados() is
  'M8 08b-1 (R2): asignaciones activas con entrega.periodo distinto de embarque.periodo_llegada (aviso desalineada). El humo exige cero filas. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 9. `guardar_viaje(p_viaje, p_revision, p_actor)`
-- ---------------------------------------------------------------------------
-- p_viaje = { id?, codigo?, nombre, destino?, fecha_inicio, fecha_fin?, responsable_id, nota? }. Sin `id` CREA (`p_revision` nulo); con
-- `id` EDITA y exige `p_revision` igual a la vigente. El código solo se escribe al crear: al editar se ignora (no cambia, §2.2). Sin
-- `codigo` se autonumera con el mes de `fecha_inicio`. Al editar, el responsable solo se valida si CAMBIA (desactivar a quien ya era
-- responsable conserva la asignación). Bloquea el viaje (`for update`). Devuelve { ok, viaje_id, codigo, revision, creado } o un motivo:
-- agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable (viaje cancelado),
-- responsable_no_asignable (también si falta al crear), fecha_requerida y fin_antes_de_inicio (los dos, añadidos por esta función).
create or replace function public.guardar_viaje(p_viaje jsonb, p_revision integer, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_id uuid := nullif(p_viaje ->> 'id', '')::uuid;
  v_nombre text := btrim(coalesce(p_viaje ->> 'nombre', ''));
  v_destino text := nullif(btrim(p_viaje ->> 'destino'), '');
  v_inicio date := nullif(p_viaje ->> 'fecha_inicio', '')::date;
  v_fin date := nullif(p_viaje ->> 'fecha_fin', '')::date;
  v_resp uuid := nullif(p_viaje ->> 'responsable_id', '')::uuid;
  v_nota text := nullif(btrim(p_viaje ->> 'nota'), '');
  v_codigo text := upper(btrim(coalesce(p_viaje ->> 'codigo', '')));
  v_viaje public.compra_viajes%rowtype;
  v_antes jsonb;
begin
  if v_id is null then
    if v_inicio is null then
      return jsonb_build_object('ok', false, 'motivo', 'fecha_requerida');
    end if;
    if v_fin is not null and v_fin < v_inicio then
      return jsonb_build_object('ok', false, 'motivo', 'fin_antes_de_inicio');
    end if;
    if v_resp is null or not public.agrupador_responsable_asignable(v_resp) then
      return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
    end if;
    if v_codigo = '' then
      v_codigo := public.agrupador_siguiente_codigo('viaje', v_inicio);
      if v_codigo is null then
        return jsonb_build_object('ok', false, 'motivo', 'correlativo_agotado');
      end if;
    else
      if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
      end if;
      if exists (select 1 from public.compra_viajes x where upper(x.codigo) = v_codigo) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
      end if;
    end if;
    begin
      insert into public.compra_viajes (
        codigo, nombre, destino, fecha_inicio, fecha_fin, responsable_id, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (v_codigo, v_nombre, v_destino, v_inicio, v_fin, v_resp, v_nota, v_perfil, v_nombre_actor, v_perfil, v_nombre_actor)
      returning * into v_viaje;
    exception
      when unique_violation then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
    end;
    insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
    values (
      v_viaje.id, 'crear', null, to_jsonb(v_viaje),
      left(format('Viaje %s creado: %s', v_viaje.codigo, v_viaje.nombre), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'viaje_id', v_viaje.id, 'codigo', v_viaje.codigo, 'revision', v_viaje.revision, 'creado', true);
  end if;

  select * into v_viaje from public.compra_viajes where id = v_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if v_viaje.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if p_revision is null or v_viaje.revision <> p_revision then
    return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
  end if;
  if v_inicio is null then
    return jsonb_build_object('ok', false, 'motivo', 'fecha_requerida');
  end if;
  if v_fin is not null and v_fin < v_inicio then
    return jsonb_build_object('ok', false, 'motivo', 'fin_antes_de_inicio');
  end if;
  if v_resp is distinct from v_viaje.responsable_id and (v_resp is null or not public.agrupador_responsable_asignable(v_resp)) then
    return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
  end if;

  v_antes := to_jsonb(v_viaje);
  update public.compra_viajes
     set nombre = v_nombre,
         destino = v_destino,
         fecha_inicio = v_inicio,
         fecha_fin = v_fin,
         responsable_id = v_resp,
         nota = v_nota,
         revision = revision + 1,
         updated_by_id = v_perfil,
         updated_by_nombre = v_nombre_actor
   where id = v_id
   returning * into v_viaje;

  insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (
    v_viaje.id, 'editar', v_antes, to_jsonb(v_viaje),
    left(format('Viaje %s editado', v_viaje.codigo), 300), v_perfil, v_nombre_actor
  );
  return jsonb_build_object('ok', true, 'viaje_id', v_viaje.id, 'codigo', v_viaje.codigo, 'revision', v_viaje.revision, 'creado', false);
end;
$$;

revoke execute on function public.guardar_viaje(jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_viaje(jsonb, integer, jsonb) to service_role;

comment on function public.guardar_viaje(jsonb, integer, jsonb) is
  'M8 08b-1: crea (sin id, revision nula) o edita (con id y revision) un viaje. Codigo aamm## autonumerado con candado o escrito a mano (unico por upper). El responsable debe ser comprador o admin activo (solo se revalida si cambia). Deja evento crear o editar. Motivos: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable, responsable_no_asignable, fecha_requerida, fin_antes_de_inicio. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 10. `guardar_embarque(p_embarque, p_revision, p_actor)`
-- ---------------------------------------------------------------------------
-- p_embarque = { id?, codigo?, nombre, tipo ('importacion' | 'local'), viaje_id?, responsable_id?, referencia_logistica?,
-- puerto_embarque?, fecha_salida_estimada?, fecha_llegada_estimada?, nota? }. Sin `id` CREA y exige `fecha_llegada_estimada` (el código
-- se numera con su mes); con `id` EDITA todo MENOS la fecha de llegada estimada, que va por movimiento (si llega y difiere de la
-- vigente: fecha_por_movimiento; si es igual, se ignora). La fecha de salida sí se edita aquí (no mueve entregas). Orden de candados:
-- viaje(s) (por id) y después el embarque. Un viaje cerrado se acepta con el aviso `viaje_cerrado`; uno cancelado bloquea
-- (`viaje_cancelado`, solo al crear o al cambiar de viaje). Un embarque `local` no lleva viaje (local_con_viaje). Devuelve
-- { ok, embarque_id, codigo, revision, creado, avisos } o un motivo: agrupador_cambio, codigo_duplicado, codigo_invalido,
-- correlativo_agotado, no_encontrado, no_editable (embarque cancelado), responsable_no_asignable, fecha_por_movimiento,
-- salida_despues_de_llegada, local_con_viaje, viaje_cancelado, fecha_requerida (añadido).
create or replace function public.guardar_embarque(p_embarque jsonb, p_revision integer, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_id uuid := nullif(p_embarque ->> 'id', '')::uuid;
  v_nombre text := btrim(coalesce(p_embarque ->> 'nombre', ''));
  v_tipo text := coalesce(nullif(p_embarque ->> 'tipo', ''), 'importacion');
  v_viaje uuid := nullif(p_embarque ->> 'viaje_id', '')::uuid;
  v_viaje_ant uuid;
  v_resp uuid := nullif(p_embarque ->> 'responsable_id', '')::uuid;
  v_ref text := nullif(btrim(p_embarque ->> 'referencia_logistica'), '');
  v_puerto text := nullif(btrim(p_embarque ->> 'puerto_embarque'), '');
  v_salida date := nullif(p_embarque ->> 'fecha_salida_estimada', '')::date;
  v_llegada date := nullif(p_embarque ->> 'fecha_llegada_estimada', '')::date;
  v_nota text := nullif(btrim(p_embarque ->> 'nota'), '');
  v_codigo text := upper(btrim(coalesce(p_embarque ->> 'codigo', '')));
  v_emb public.compra_embarques%rowtype;
  v_viaje_row public.compra_viajes%rowtype;
  v_avisos jsonb := '[]'::jsonb;
  v_antes jsonb;
begin
  if v_id is not null then
    select e.viaje_id into v_viaje_ant from public.compra_embarques e where e.id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
  end if;

  perform 1
     from public.compra_viajes v
    where v.id in (v_viaje, v_viaje_ant)
    order by v.id
      for update;

  if v_viaje is not null then
    select * into v_viaje_row from public.compra_viajes where id = v_viaje;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    if v_viaje_row.estado = 'cancelado' and v_viaje is distinct from v_viaje_ant then
      return jsonb_build_object('ok', false, 'motivo', 'viaje_cancelado');
    end if;
    if v_viaje_row.estado = 'cerrado' then
      v_avisos := v_avisos || jsonb_build_array(jsonb_build_object('codigo', 'viaje_cerrado', 'viaje', v_viaje_row.codigo));
    end if;
  end if;
  if v_tipo = 'local' and v_viaje is not null then
    return jsonb_build_object('ok', false, 'motivo', 'local_con_viaje');
  end if;
  if v_resp is not null and not public.agrupador_responsable_asignable(v_resp) and v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
  end if;

  if v_id is null then
    if v_llegada is null then
      return jsonb_build_object('ok', false, 'motivo', 'fecha_requerida');
    end if;
    if v_salida is not null and v_salida > v_llegada then
      return jsonb_build_object('ok', false, 'motivo', 'salida_despues_de_llegada');
    end if;
    if v_codigo = '' then
      v_codigo := public.agrupador_siguiente_codigo('embarque', v_llegada);
      if v_codigo is null then
        return jsonb_build_object('ok', false, 'motivo', 'correlativo_agotado');
      end if;
    else
      if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
      end if;
      if exists (select 1 from public.compra_embarques x where upper(x.codigo) = v_codigo) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
      end if;
    end if;
    begin
      insert into public.compra_embarques (
        codigo, nombre, tipo, viaje_id, responsable_id, referencia_logistica, puerto_embarque,
        fecha_salida_estimada, fecha_llegada_estimada, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (
        v_codigo, v_nombre, v_tipo, v_viaje, v_resp, v_ref, v_puerto,
        v_salida, v_llegada, v_nota,
        v_perfil, v_nombre_actor, v_perfil, v_nombre_actor
      )
      returning * into v_emb;
    exception
      when unique_violation then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
    end;
    insert into public.compra_agrupador_eventos (embarque_id, viaje_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
    values (
      v_emb.id, v_emb.viaje_id, 'crear', null, public.agrupador_foto_embarque(v_emb.id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo),
      left(format('Embarque %s creado: %s', v_emb.codigo, v_emb.nombre), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'embarque_id', v_emb.id, 'codigo', v_emb.codigo, 'revision', v_emb.revision, 'creado', true, 'avisos', v_avisos);
  end if;

  select * into v_emb from public.compra_embarques where id = v_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if v_emb.estado = 'cancelado' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if p_revision is null or v_emb.revision <> p_revision then
    return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
  end if;
  if v_llegada is not null and v_llegada <> v_emb.fecha_llegada_estimada then
    return jsonb_build_object('ok', false, 'motivo', 'fecha_por_movimiento');
  end if;
  if v_resp is distinct from v_emb.responsable_id and v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
    return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
  end if;
  if v_salida is not null and v_salida > v_emb.fecha_llegada_estimada then
    return jsonb_build_object('ok', false, 'motivo', 'salida_despues_de_llegada');
  end if;

  v_antes := public.agrupador_foto_embarque(v_id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo);
  update public.compra_embarques
     set nombre = v_nombre,
         tipo = v_tipo,
         viaje_id = v_viaje,
         responsable_id = v_resp,
         referencia_logistica = v_ref,
         puerto_embarque = v_puerto,
         fecha_salida_estimada = v_salida,
         nota = v_nota,
         revision = revision + 1,
         updated_by_id = v_perfil,
         updated_by_nombre = v_nombre_actor
   where id = v_id
   returning * into v_emb;

  insert into public.compra_agrupador_eventos (embarque_id, viaje_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (
    v_emb.id, v_emb.viaje_id, 'editar', v_antes, public.agrupador_foto_embarque(v_emb.id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo),
    left(format('Embarque %s editado', v_emb.codigo), 300), v_perfil, v_nombre_actor
  );
  return jsonb_build_object('ok', true, 'embarque_id', v_emb.id, 'codigo', v_emb.codigo, 'revision', v_emb.revision, 'creado', false, 'avisos', v_avisos);
end;
$$;

revoke execute on function public.guardar_embarque(jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_embarque(jsonb, integer, jsonb) to service_role;

comment on function public.guardar_embarque(jsonb, integer, jsonb) is
  'M8 08b-1: crea o edita un embarque. Edita todo menos fecha_llegada_estimada (va por aplicar_movimiento_agrupador: fecha_por_movimiento). Bloquea viajes y luego el embarque. local sin viaje, salida <= llegada, viaje cancelado bloquea y cerrado avisa. Motivos: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable, responsable_no_asignable, fecha_por_movimiento, salida_despues_de_llegada, local_con_viaje, viaje_cancelado, fecha_requerida. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 11. `guardar_paquete(p_paquete, p_revision_embarque, p_actor)`
-- ---------------------------------------------------------------------------
-- p_paquete = { id?, embarque_id (al crear), codigo?, nombre, responsable_id?, nota? }. `p_revision_embarque` es la revisión del
-- EMBARQUE (su `revision` cubre a sus paquetes): se compara y sube en 1 al crear o editar. Bloquea el embarque. El embarque debe estar
-- planificado o en tránsito (embarque_no_editable); un paquete cancelado no se edita (no_editable, igual que `paqueteDelEmbarque`). El
-- código se numera con el mes de `periodo_llegada` del embarque. Devuelve { ok, paquete_id, embarque_id, codigo, embarque_revision,
-- creado } o un motivo: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable,
-- embarque_no_editable, responsable_no_asignable.
create or replace function public.guardar_paquete(p_paquete jsonb, p_revision_embarque integer, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_id uuid := nullif(p_paquete ->> 'id', '')::uuid;
  v_embarque_id uuid := nullif(p_paquete ->> 'embarque_id', '')::uuid;
  v_nombre text := btrim(coalesce(p_paquete ->> 'nombre', ''));
  v_resp uuid := nullif(p_paquete ->> 'responsable_id', '')::uuid;
  v_nota text := nullif(btrim(p_paquete ->> 'nota'), '');
  v_codigo text := upper(btrim(coalesce(p_paquete ->> 'codigo', '')));
  v_paq public.compra_paquetes%rowtype;
  v_emb public.compra_embarques%rowtype;
  v_antes jsonb;
begin
  if v_id is not null then
    select * into v_paq from public.compra_paquetes where id = v_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    v_embarque_id := v_paq.embarque_id;
  end if;

  select * into v_emb from public.compra_embarques where id = v_embarque_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if p_revision_embarque is null or v_emb.revision <> p_revision_embarque then
    return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
  end if;
  if v_emb.estado not in ('planificado', 'en_transito') then
    return jsonb_build_object('ok', false, 'motivo', 'embarque_no_editable');
  end if;

  if v_id is null then
    if v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
      return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
    end if;
    if v_codigo = '' then
      v_codigo := public.agrupador_siguiente_codigo('paquete', v_emb.periodo_llegada);
      if v_codigo is null then
        return jsonb_build_object('ok', false, 'motivo', 'correlativo_agotado');
      end if;
    else
      if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_invalido');
      end if;
      if exists (select 1 from public.compra_paquetes x where upper(x.codigo) = v_codigo) then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
      end if;
    end if;
    begin
      insert into public.compra_paquetes (
        embarque_id, codigo, nombre, responsable_id, nota, perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (v_embarque_id, v_codigo, v_nombre, v_resp, v_nota, v_perfil, v_nombre_actor, v_perfil, v_nombre_actor)
      returning * into v_paq;
    exception
      when unique_violation then
        return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado');
    end;
    v_antes := null;
  else
    if v_paq.estado <> 'abierto' then
      return jsonb_build_object('ok', false, 'motivo', 'no_editable');
    end if;
    if v_resp is distinct from v_paq.responsable_id and v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
      return jsonb_build_object('ok', false, 'motivo', 'responsable_no_asignable');
    end if;
    v_antes := to_jsonb(v_paq);
    update public.compra_paquetes
       set nombre = v_nombre,
           responsable_id = v_resp,
           nota = v_nota,
           updated_by_id = v_perfil,
           updated_by_nombre = v_nombre_actor
     where id = v_id
     returning * into v_paq;
  end if;

  update public.compra_embarques
     set revision = revision + 1,
         updated_by_id = v_perfil,
         updated_by_nombre = v_nombre_actor
   where id = v_embarque_id
   returning * into v_emb;

  insert into public.compra_agrupador_eventos (paquete_id, embarque_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (
    v_paq.id, v_embarque_id, case when v_id is null then 'crear' else 'editar' end, v_antes, to_jsonb(v_paq),
    left(format('Paquete %s %s', v_paq.codigo, case when v_id is null then 'creado' else 'editado' end), 300), v_perfil, v_nombre_actor
  );
  return jsonb_build_object(
    'ok', true, 'paquete_id', v_paq.id, 'embarque_id', v_embarque_id, 'codigo', v_paq.codigo,
    'embarque_revision', v_emb.revision, 'creado', v_id is null
  );
end;
$$;

revoke execute on function public.guardar_paquete(jsonb, integer, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_paquete(jsonb, integer, jsonb) to service_role;

comment on function public.guardar_paquete(jsonb, integer, jsonb) is
  'M8 08b-1: crea o edita un paquete de un embarque. Bloquea el embarque, compara su revision (cubre a sus paquetes) y la sube. El embarque debe estar planificado o en transito. Codigo con el mes de periodo_llegada. Motivos: agrupador_cambio, codigo_duplicado, codigo_invalido, correlativo_agotado, no_encontrado, no_editable, embarque_no_editable, responsable_no_asignable. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 12. `cambiar_estado_agrupador(p_tipo, p_id, p_accion, p_revision, p_motivo, p_actor)`
-- ---------------------------------------------------------------------------
-- Transiciones de R13 (las que llevan a `recibido` o salen de él son de 08b-2):
--   viaje    cerrar (abierto -> cerrado), reabrir (cerrado -> abierto), cancelar (-> cancelado).
--   embarque en_transito (planificado -> en_transito), volver_a_planificado (en_transito -> planificado), cancelar (-> cancelado,
--            también desde recibido si no queda nada activo ni vinculado).
--   paquete  cancelar (abierto -> cancelado).
-- `cancelar` exige `p_motivo` de 1 a 200 caracteres (motivo_requerido) y es irreversible; las demás no lo piden. Cancelar un viaje
-- exige que no queden compras sin cancelar ni embarques sin cancelar (tiene_compras); cancelar un embarque, que no tenga recepciones
-- vinculadas (tiene_recepciones) ni asignaciones activas (tiene_asignaciones_activas); cancelar un paquete, que no tenga asignaciones
-- activas. `p_revision` es la del viaje o del embarque; para un paquete es la del EMBARQUE (su revision cubre a sus paquetes) y la
-- función la sube. Devuelve { ok, tipo, id, estado, revision } o un motivo: agrupador_cambio, no_encontrado, transicion_invalida,
-- tiene_asignaciones_activas, tiene_compras, tiene_recepciones, motivo_requerido.
create or replace function public.cambiar_estado_agrupador(
  p_tipo text,
  p_id uuid,
  p_accion text,
  p_revision integer,
  p_motivo text,
  p_actor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_motivo text := nullif(btrim(p_motivo), '');
  v_viaje public.compra_viajes%rowtype;
  v_emb public.compra_embarques%rowtype;
  v_paq public.compra_paquetes%rowtype;
  v_hacia text;
  v_activas integer;
  v_antes jsonb;
  v_revision integer;
begin
  if p_tipo = 'viaje' then
    select * into v_viaje from public.compra_viajes where id = p_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    if p_revision is null or v_viaje.revision <> p_revision then
      return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
    end if;
    if v_viaje.estado = 'cancelado' then
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    if p_accion = 'cerrar' and v_viaje.estado = 'abierto' then
      v_hacia := 'cerrado';
    elsif p_accion = 'reabrir' and v_viaje.estado = 'cerrado' then
      v_hacia := 'abierto';
    elsif p_accion = 'cancelar' then
      if v_motivo is null or char_length(v_motivo) > 200 then
        return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido');
      end if;
      if exists (select 1 from public.compras c where c.viaje_id = p_id and c.estado <> 'cancelada')
         or exists (select 1 from public.compra_embarques e where e.viaje_id = p_id and e.estado <> 'cancelado') then
        return jsonb_build_object('ok', false, 'motivo', 'tiene_compras');
      end if;
      v_hacia := 'cancelado';
    else
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    v_antes := jsonb_build_object('estado', v_viaje.estado, 'revision', v_viaje.revision);
    update public.compra_viajes
       set estado = v_hacia, revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = p_id
     returning revision into v_revision;
    insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
    values (
      p_id, 'cambiar_estado', v_antes, jsonb_build_object('estado', v_hacia, 'revision', v_revision), left(v_motivo, 300),
      left(format('Viaje %s: %s a %s', v_viaje.codigo, v_viaje.estado, v_hacia), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'tipo', 'viaje', 'id', p_id, 'estado', v_hacia, 'revision', v_revision);

  elsif p_tipo = 'embarque' then
    select * into v_emb from public.compra_embarques where id = p_id for update;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    if p_revision is null or v_emb.revision <> p_revision then
      return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
    end if;
    if v_emb.estado = 'cancelado' then
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    if p_accion = 'en_transito' and v_emb.estado = 'planificado' then
      v_hacia := 'en_transito';
    elsif p_accion = 'volver_a_planificado' and v_emb.estado = 'en_transito' then
      v_hacia := 'planificado';
    elsif p_accion = 'cancelar' then
      if v_motivo is null or char_length(v_motivo) > 200 then
        return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido');
      end if;
      if exists (
        select 1
        from public.compra_linea_recepciones r
        join public.compra_entrega_asignaciones a on a.id = r.asignacion_id
        where a.embarque_id = p_id
      ) then
        return jsonb_build_object('ok', false, 'motivo', 'tiene_recepciones');
      end if;
      select count(*) into v_activas
        from public.compra_entrega_asignaciones a
        join public.compra_linea_entregas e on e.id = a.entrega_id
        join public.compra_lineas l on l.id = e.linea_id
        join public.compras c on c.id = l.compra_id
       where a.embarque_id = p_id
         and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas);
      if v_activas > 0 then
        return jsonb_build_object('ok', false, 'motivo', 'tiene_asignaciones_activas');
      end if;
      v_hacia := 'cancelado';
    else
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    v_antes := public.agrupador_foto_embarque(p_id);
    update public.compra_embarques
       set estado = v_hacia, revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = p_id
     returning revision into v_revision;
    insert into public.compra_agrupador_eventos (embarque_id, viaje_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
    values (
      p_id, v_emb.viaje_id, 'cambiar_estado', v_antes, public.agrupador_foto_embarque(p_id), left(v_motivo, 300),
      left(format('Embarque %s: %s a %s', v_emb.codigo, v_emb.estado, v_hacia), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'tipo', 'embarque', 'id', p_id, 'estado', v_hacia, 'revision', v_revision);

  elsif p_tipo = 'paquete' then
    select * into v_paq from public.compra_paquetes where id = p_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    select * into v_emb from public.compra_embarques where id = v_paq.embarque_id for update;
    if p_revision is null or v_emb.revision <> p_revision then
      return jsonb_build_object('ok', false, 'motivo', 'agrupador_cambio');
    end if;
    if p_accion <> 'cancelar' or v_paq.estado <> 'abierto' then
      return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
    end if;
    if v_motivo is null or char_length(v_motivo) > 200 then
      return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido');
    end if;
    select count(*) into v_activas
      from public.compra_entrega_asignaciones a
      join public.compra_linea_entregas e on e.id = a.entrega_id
      join public.compra_lineas l on l.id = e.linea_id
      join public.compras c on c.id = l.compra_id
     where a.paquete_id = p_id
       and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas);
    if v_activas > 0 then
      return jsonb_build_object('ok', false, 'motivo', 'tiene_asignaciones_activas');
    end if;
    update public.compra_paquetes
       set estado = 'cancelado', updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = p_id;
    update public.compra_embarques
       set revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = v_paq.embarque_id
     returning revision into v_revision;
    insert into public.compra_agrupador_eventos (paquete_id, embarque_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
    values (
      p_id, v_paq.embarque_id, 'cambiar_estado', jsonb_build_object('estado', 'abierto'), jsonb_build_object('estado', 'cancelado'),
      left(v_motivo, 300), left(format('Paquete %s: abierto a cancelado', v_paq.codigo), 300), v_perfil, v_nombre_actor
    );
    return jsonb_build_object('ok', true, 'tipo', 'paquete', 'id', p_id, 'estado', 'cancelado', 'revision', v_revision, 'embarque_id', v_paq.embarque_id);
  end if;

  return jsonb_build_object('ok', false, 'motivo', 'transicion_invalida');
end;
$$;

revoke execute on function public.cambiar_estado_agrupador(text, uuid, text, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.cambiar_estado_agrupador(text, uuid, text, integer, text, jsonb) to service_role;

comment on function public.cambiar_estado_agrupador(text, uuid, text, integer, text, jsonb) is
  'M8 08b-1 (R13): cambia el estado de un viaje (cerrar, reabrir, cancelar), un embarque (en_transito, volver_a_planificado, cancelar) o un paquete (cancelar). Cancelar exige motivo y que no quede nada activo (viaje: compras o embarques sin cancelar; embarque: recepciones vinculadas o asignaciones activas; paquete: asignaciones activas). Para un paquete, p_revision es la del embarque. Motivos: agrupador_cambio, no_encontrado, transicion_invalida, tiene_asignaciones_activas, tiene_compras, tiene_recepciones, motivo_requerido. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 13. `asignar_viaje_compras(p_viaje, p_compras, p_actor)`
-- ---------------------------------------------------------------------------
-- Pone (`p_viaje` no nulo) o quita (`p_viaje` nulo) el viaje de compras `[{ id, revision }]`. Orden de candados: viajes involucrados (el
-- nuevo y los actuales de las compras, por id) y después las compras (por id). Revisión de cada compra distinta => compra_cambio (sin
-- escribir nada). Una compra que ya tiene ese viaje no cambia ni sube revisión. Cada compra cambiada sube su revisión en 1 y deja un
-- evento `asignar_viaje` en `compra_eventos` (antes/despues = `compra_foto || compra_foto_entregas`); cada viaje involucrado deja un
-- evento `asignar_viaje` en `compra_agrupador_eventos`. NO sube `compra_viajes.revision` (asignar compras no es editar el viaje). Un viaje
-- cerrado se acepta con el aviso `viaje_cerrado` (decisión 95); uno cancelado bloquea (`viaje_cancelado`). Una compra cancelada no se
-- toca (`no_editable`). Devuelve { ok, viaje_id, compras: [{ id, revision }], avisos } o un motivo: compra_cambio, no_editable,
-- viaje_cancelado, no_encontrado (el viaje no existe).
create or replace function public.asignar_viaje_compras(p_viaje uuid, p_compras jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_viaje public.compra_viajes%rowtype;
  v_ids uuid[];
  v_viajes uuid[];
  v_n integer;
  v_c public.compras%rowtype;
  v_item record;
  v_antes jsonb;
  v_rev integer;
  v_res jsonb := '[]'::jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_cambios jsonb := '[]'::jsonb;
  v_ev record;
begin
  if p_compras is null or jsonb_typeof(p_compras) <> 'array' or jsonb_array_length(p_compras) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;

  select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) into v_ids
    from jsonb_to_recordset(p_compras) as x(id uuid, revision integer);

  select coalesce(array_agg(distinct v), '{}'::uuid[]) into v_viajes
    from (
      select p_viaje as v
      union all
      select c.viaje_id from public.compras c where c.id = any (v_ids)
    ) q
   where v is not null;

  perform 1 from public.compra_viajes v where v.id = any (v_viajes) order by v.id for update;

  if p_viaje is not null then
    select * into v_viaje from public.compra_viajes where id = p_viaje;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
    end if;
    if v_viaje.estado = 'cancelado' then
      return jsonb_build_object('ok', false, 'motivo', 'viaje_cancelado');
    end if;
    if v_viaje.estado = 'cerrado' then
      v_avisos := jsonb_build_array(jsonb_build_object('codigo', 'viaje_cerrado', 'viaje', v_viaje.codigo));
    end if;
  end if;

  perform 1 from public.compras c where c.id = any (v_ids) order by c.id for update;
  get diagnostics v_n = row_count;
  if v_n <> cardinality(v_ids) then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_compras) as x(id uuid, revision integer)
    join public.compras c on c.id = x.id
    where c.revision is distinct from x.revision
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;
  if exists (select 1 from public.compras c where c.id = any (v_ids) and c.estado = 'cancelada') then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;

  for v_item in
    select x.id from jsonb_to_recordset(p_compras) as x(id uuid, revision integer) order by x.id
  loop
    select * into v_c from public.compras where id = v_item.id;
    if v_c.viaje_id is not distinct from p_viaje then
      v_res := v_res || jsonb_build_array(jsonb_build_object('id', v_c.id, 'revision', v_c.revision));
      continue;
    end if;
    v_antes := public.compra_foto(v_c.id) || public.compra_foto_entregas(v_c.id);
    update public.compras
       set viaje_id = p_viaje, revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
     where id = v_c.id
     returning revision into v_rev;
    insert into public.compra_eventos (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
    values (
      v_c.id, null, 'asignar_viaje', v_antes, public.compra_foto(v_c.id) || public.compra_foto_entregas(v_c.id), null,
      case when p_viaje is null then 'Viaje quitado de la compra' else left(format('Viaje %s asignado a la compra', v_viaje.codigo), 300) end,
      v_perfil, v_nombre_actor
    );
    v_res := v_res || jsonb_build_array(jsonb_build_object('id', v_c.id, 'revision', v_rev));
    v_cambios := v_cambios || jsonb_build_array(
      jsonb_build_object('compra_id', v_c.id, 'revision_nueva', v_rev, 'viaje_antes', v_c.viaje_id)
    );
  end loop;

  for v_ev in
    select coalesce(p_viaje, (x ->> 'viaje_antes')::uuid) as viaje_id,
           jsonb_agg(jsonb_build_object('compra_id', x -> 'compra_id', 'revision_nueva', x -> 'revision_nueva')) as compras
      from jsonb_array_elements(v_cambios) x
     group by 1
  loop
    insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, resumen, compras, perfil_id, usuario_nombre)
    values (
      v_ev.viaje_id, 'asignar_viaje', null, null,
      left(format('%s compra(s) %s', jsonb_array_length(v_ev.compras), case when p_viaje is null then 'sin este viaje' else 'asignadas al viaje' end), 300),
      v_ev.compras, v_perfil, v_nombre_actor
    );
  end loop;

  return jsonb_build_object('ok', true, 'viaje_id', p_viaje, 'compras', v_res, 'avisos', v_avisos);
end;
$$;

revoke execute on function public.asignar_viaje_compras(uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.asignar_viaje_compras(uuid, jsonb, jsonb) to service_role;

comment on function public.asignar_viaje_compras(uuid, jsonb, jsonb) is
  'M8 08b-1: pone o quita el viaje de compras [{id, revision}]. Bloquea viajes y luego compras, compara revision (compra_cambio), sube la revision y deja evento asignar_viaje por compra y por viaje. Viaje cerrado acepta con aviso viaje_cerrado; cancelado bloquea. Compra cancelada: no_editable. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 14. `agrupador_mover_entregas(p_movimientos, p_repartos, p_actor)` (AYUDANTE INTERNO)
-- ---------------------------------------------------------------------------
-- El paso de escritura de entregas, repartos y asignaciones que comparten `aplicar_movimiento_agrupador` y (08b-2) `recibir_embarque`.
-- SIN candados ni eventos ni revisiones: solo lo llaman ellas, que ya bloquearon y comprobaron todo. Los parámetros 2 y 3 llevan valor
-- por defecto (la ficha solo nombra el primero): son los repartos a escribir y el actor de la autoría de las asignaciones.
--
-- Es la contraparte SQL de `aplicarMovimientos` (src/lib/compras/agrupadores/movimiento.ts); ejecuta los movimientos EN ORDEN, sobre las
-- filas reales. p_movimientos = [{ asignacion_id | null, entrega_id, linea_id, compra_id, unidades, destino: { periodo 'aaaa-mm',
-- embarque_id | null, paquete_id | null } }]. Para cada movimiento:
--   1. Pertenencia: la entrega es de la línea (no_pertenece); si trae `asignacion_id`, esa asignación es de esa entrega
--      (no_pertenece) y tiene al menos las unidades (excede_entrega); si no, hay al menos esas unidades SIN asignar en la entrega
--      (excede_entrega). Con paquete destino: el paquete existe (no_pertenece), es del embarque destino (paquete_de_otro_embarque) y
--      está abierto (no_editable).
--   2. Si el mes cambia, las unidades pasan de la entrega de origen a la del mes destino de la MISMA línea: se crea con
--      `origen = 'embarque'` o se funde con la existente (conserva su `id`). La de origen baja y se BORRA si queda en 0 (sus repartos
--      caen en cascada; ya no tiene asignaciones porque las unidades salían de ellas).
--   3. Asignaciones: con `embarque_id` nulo las unidades quedan sin embarque (la asignación baja y se borra en 0). Con embarque: se SUMAN
--      a la fila que ya exista con (entrega destino, embarque, paquete) o, si la asignación movida sale entera y no hay fila destino, la
--      fila se mueve EN EL LUGAR conservando su `id` (así sus recepciones vinculadas siguen apuntándole); si no, se crea una nueva.
--   4. Recepciones vinculadas (08b-2): nunca se baja una asignación por debajo de lo vinculado ni se cambia de entrega o de embarque una
--      asignación con recepciones: asignacion_con_recepciones. Cambiar solo el paquete es válido.
-- Después escribe `p_repartos` = [{ linea_id, periodo 'aaaa-mm', filas: [{ marca_id, genero_mundo_linea_id, equivalencia_id?,
-- unidades, reparto_id?, reparto_version?, temporada?, error_reparto_pp? }] }]: REEMPLAZA el reparto completo de cada entrega indicada
-- (que debe existir, si no AG002). Devuelve { asignaciones_destino: [uuid] } = filas que recibieron unidades (para verificar I2).
-- Los rechazos de usuario se lanzan con AG001 (mensaje = motivo); el que llama los atrapa y deshace todo.
create or replace function public.agrupador_mover_entregas(
  p_movimientos jsonb,
  p_repartos jsonb default '[]'::jsonb,
  p_actor jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_m jsonb;
  v_asig uuid;
  v_entrega_id uuid;
  v_unidades integer;
  v_periodo date;
  v_emb uuid;
  v_paq uuid;
  v_e public.compra_linea_entregas%rowtype;
  v_d public.compra_linea_entregas%rowtype;
  v_r public.compra_entrega_asignaciones%rowtype;
  v_o public.compra_entrega_asignaciones%rowtype;
  v_hay_o boolean;
  v_cambia boolean;
  v_libres integer;
  v_vinc integer;
  v_pq_emb uuid;
  v_pq_estado text;
  v_destino uuid[] := '{}'::uuid[];
  v_nuevo uuid;
  v_rep jsonb;
  v_ent_id uuid;
begin
  for v_m in select x.value from jsonb_array_elements(coalesce(p_movimientos, '[]'::jsonb)) as x(value) loop
    v_asig := nullif(v_m ->> 'asignacion_id', '')::uuid;
    v_entrega_id := (v_m ->> 'entrega_id')::uuid;
    v_unidades := (v_m ->> 'unidades')::integer;
    v_periodo := (left(v_m -> 'destino' ->> 'periodo', 7) || '-01')::date;
    v_emb := nullif(v_m -> 'destino' ->> 'embarque_id', '')::uuid;
    v_paq := nullif(v_m -> 'destino' ->> 'paquete_id', '')::uuid;

    if v_unidades is null or v_unidades <= 0 then
      raise exception 'plan invalido: unidades del movimiento' using errcode = 'AG002';
    end if;
    if v_paq is not null and v_emb is null then
      raise exception 'plan invalido: paquete sin embarque' using errcode = 'AG002';
    end if;

    select * into v_e from public.compra_linea_entregas where id = v_entrega_id;
    if not found or v_e.linea_id is distinct from (v_m ->> 'linea_id')::uuid then
      raise exception 'no_pertenece' using errcode = 'AG001';
    end if;
    if v_e.unidades < v_unidades then
      raise exception 'excede_entrega' using errcode = 'AG001';
    end if;

    if v_paq is not null then
      select p.embarque_id, p.estado into v_pq_emb, v_pq_estado from public.compra_paquetes p where p.id = v_paq;
      if not found then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if v_pq_emb <> v_emb then
        raise exception 'paquete_de_otro_embarque' using errcode = 'AG001';
      end if;
      if v_pq_estado <> 'abierto' then
        raise exception 'no_editable' using errcode = 'AG001';
      end if;
    end if;

    if v_asig is not null then
      select * into v_r from public.compra_entrega_asignaciones where id = v_asig;
      if not found or v_r.entrega_id <> v_e.id then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if v_r.unidades < v_unidades then
        raise exception 'excede_entrega' using errcode = 'AG001';
      end if;
    else
      select v_e.unidades - coalesce(sum(a.unidades), 0) into v_libres
        from public.compra_entrega_asignaciones a
       where a.entrega_id = v_e.id;
      if v_libres < v_unidades then
        raise exception 'excede_entrega' using errcode = 'AG001';
      end if;
    end if;

    v_cambia := v_periodo <> v_e.periodo;
    if v_cambia then
      select * into v_d from public.compra_linea_entregas where linea_id = v_e.linea_id and periodo = v_periodo;
      if found then
        update public.compra_linea_entregas set unidades = unidades + v_unidades where id = v_d.id returning * into v_d;
      else
        insert into public.compra_linea_entregas (linea_id, periodo, unidades, origen)
        values (v_e.linea_id, v_periodo, v_unidades, 'embarque')
        returning * into v_d;
      end if;
    else
      v_d := v_e;
    end if;

    v_hay_o := false;
    if v_emb is not null then
      select * into v_o
        from public.compra_entrega_asignaciones a
       where a.entrega_id = v_d.id
         and a.embarque_id = v_emb
         and a.paquete_id is not distinct from v_paq;
      v_hay_o := found;
    end if;

    if v_asig is not null then
      if v_hay_o and v_o.id = v_r.id then
        continue;
      end if;
      select coalesce(sum(r.unidades), 0) into v_vinc from public.compra_linea_recepciones r where r.asignacion_id = v_r.id;
      if v_r.unidades = v_unidades and v_emb is not null and not v_hay_o then
        if v_vinc > 0 and (v_d.id <> v_e.id or v_emb <> v_r.embarque_id) then
          raise exception 'asignacion_con_recepciones' using errcode = 'AG001';
        end if;
        update public.compra_entrega_asignaciones
           set entrega_id = v_d.id, embarque_id = v_emb, paquete_id = v_paq,
               updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
         where id = v_r.id;
        v_destino := v_destino || v_r.id;
      else
        if v_r.unidades - v_unidades < v_vinc then
          raise exception 'asignacion_con_recepciones' using errcode = 'AG001';
        end if;
        if v_r.unidades = v_unidades then
          delete from public.compra_entrega_asignaciones where id = v_r.id;
        else
          update public.compra_entrega_asignaciones
             set unidades = unidades - v_unidades, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
           where id = v_r.id;
        end if;
        if v_emb is not null then
          if v_hay_o then
            update public.compra_entrega_asignaciones
               set unidades = unidades + v_unidades, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
             where id = v_o.id;
            v_destino := v_destino || v_o.id;
          else
            insert into public.compra_entrega_asignaciones (entrega_id, embarque_id, paquete_id, unidades, perfil_id, usuario_nombre, updated_by_id, updated_by_nombre)
            values (v_d.id, v_emb, v_paq, v_unidades, v_perfil, v_nombre_actor, v_perfil, v_nombre_actor)
            returning id into v_nuevo;
            v_destino := v_destino || v_nuevo;
          end if;
        end if;
      end if;
    elsif v_emb is not null then
      if v_hay_o then
        update public.compra_entrega_asignaciones
           set unidades = unidades + v_unidades, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
         where id = v_o.id;
        v_destino := v_destino || v_o.id;
      else
        insert into public.compra_entrega_asignaciones (entrega_id, embarque_id, paquete_id, unidades, perfil_id, usuario_nombre, updated_by_id, updated_by_nombre)
        values (v_d.id, v_emb, v_paq, v_unidades, v_perfil, v_nombre_actor, v_perfil, v_nombre_actor)
        returning id into v_nuevo;
        v_destino := v_destino || v_nuevo;
      end if;
    end if;

    if v_cambia then
      if v_e.unidades = v_unidades then
        if exists (select 1 from public.compra_entrega_asignaciones a where a.entrega_id = v_e.id) then
          raise exception 'invariante I1: una entrega que se vacia conserva asignaciones' using errcode = 'AG002';
        end if;
        delete from public.compra_linea_entregas where id = v_e.id;
      else
        update public.compra_linea_entregas set unidades = unidades - v_unidades where id = v_e.id;
      end if;
    end if;
  end loop;

  for v_rep in select x.value from jsonb_array_elements(coalesce(p_repartos, '[]'::jsonb)) as x(value) loop
    select e.id into v_ent_id
      from public.compra_linea_entregas e
     where e.linea_id = (v_rep ->> 'linea_id')::uuid
       and e.periodo = (left(v_rep ->> 'periodo', 7) || '-01')::date;
    if not found then
      raise exception 'plan invalido: reparto de una entrega que no existe' using errcode = 'AG002';
    end if;
    delete from public.compra_linea_repartos where entrega_id = v_ent_id;
    insert into public.compra_linea_repartos (
      linea_id, entrega_id, marca_id, genero_mundo_linea_id, equivalencia_id, unidades,
      reparto_id, reparto_version, temporada, error_reparto_pp
    )
    select
      (v_rep ->> 'linea_id')::uuid,
      v_ent_id,
      (f ->> 'marca_id')::uuid,
      (f ->> 'genero_mundo_linea_id')::uuid,
      nullif(f ->> 'equivalencia_id', '')::uuid,
      (f ->> 'unidades')::integer,
      nullif(f ->> 'reparto_id', '')::uuid,
      nullif(f ->> 'reparto_version', '')::integer,
      nullif(f ->> 'temporada', ''),
      nullif(f ->> 'error_reparto_pp', '')::numeric
    from jsonb_array_elements(coalesce(v_rep -> 'filas', '[]'::jsonb)) as f;
  end loop;

  return jsonb_build_object('asignaciones_destino', to_jsonb(v_destino));
end;
$$;

revoke execute on function public.agrupador_mover_entregas(jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agrupador_mover_entregas(jsonb, jsonb, jsonb) to service_role;

comment on function public.agrupador_mover_entregas(jsonb, jsonb, jsonb) is
  'M8 08b-1 (interno, sin candados ni eventos): ejecuta en orden los movimientos elementales del plan sobre las filas reales (entregas, asignaciones con fusion y movimiento en el lugar) y reemplaza los repartos de las entregas indicadas. Contraparte SQL de aplicarMovimientos. Rechazos con AG001 (mensaje = motivo). Solo lo llaman aplicar_movimiento_agrupador y recibir_embarque. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 15. `aplicar_movimiento_agrupador(p_plan, p_actor)` (función central de 08b-1)
-- ---------------------------------------------------------------------------
-- p_plan = `PlanAplicable` (src/lib/compras/agrupadores/movimiento.ts):
--   { operacion: asignar | quitar | mover_a_paquete | cambiar_fecha | pasar_pendientes | mover_paquete, accion, motivo, resumen,
--     embarques: [{ id, revision, fecha_llegada_estimada? }], paquete_a_mover: { paquete_id, embarque_destino_id } | null,
--     compras: [{ id, revision }], movimientos: [...] (ver `agrupador_mover_entregas`),
--     entregas: [{ linea_id, periodo 'aaaa-mm', unidades }] (estado final esperado de las entregas tocadas; 0 = se borró),
--     repartos: [{ linea_id, periodo, filas: [...] }] }.
-- Orden: (1) bloquea los embarques por id (no_encontrado) y compara su revisión (agrupador_cambio); (2) comprueba el estado de cada
-- embarque según la operación (embarque_no_editable; `quitar` siempre vale, `pasar_pendientes` también desde `recibido`), el motivo
-- (motivo_requerido en cambiar_fecha, mover_paquete y pasar_pendientes) y, en cambiar_fecha, salida <= llegada nueva; (3) bloquea las
-- compras por id y compara su revisión (compra_cambio); (4) comprueba pertenencia (no_pertenece: entregas, líneas y compras del plan,
-- embarques de los movimientos), compra asignable (saldo_cerrado, compra_no_asignable) y que NINGUNA compra con asignación ACTIVA en
-- los embarques del plan falte en la lista (compra_cambio: apareció después de la vista previa); (5) con recepciones vinculadas:
-- embarque_con_recepciones (cambiar el mes de un embarque) o asignacion_con_recepciones (mover un paquete); (6) toma las fotos
-- `antes`; (7) escribe: la fecha del embarque (cambiar_fecha), el embarque del paquete (la FK compuesta con `on update cascade` arrastra
-- sus asignaciones) y los movimientos y repartos con `agrupador_mover_entregas`; (8) verifica contra el plan y la base: las entregas
-- finales coinciden con `entregas` (si no, AG002: el plan de TypeScript y la base discrepan), I3 con `Σ entregas = unidades de la
-- línea` (AG002), 1 a 24 entregas por línea (max_entregas), lotes con `Σ repartos = unidades` por entrega tocada (reparto_sin_vector),
-- I1 `Σ asignaciones <= entrega` (excede_entrega) e I2 en las asignaciones que recibieron unidades (AG002: entrega.periodo =
-- embarque.periodo_llegada; `agrupadores_desalineados() = 0` se exige solo en el humo); (9) llama a `compra_recalcular_estado`, sube
-- `revision` de cada compra del plan (I5; también en mover_a_paquete: lo coherente es subirla siempre que el plan toque compras) y deja
-- su evento en `compra_eventos`; (10) sube la revisión de cada embarque del plan y deja un evento en `compra_agrupador_eventos` por
-- embarque. Sin movimientos (cambiar la fecha dentro del mismo mes) no se toca ninguna compra (R5).
-- Acción del evento de compras: asignar, quitar y mover_a_paquete => `asignar_agrupador`; cambiar_fecha, pasar_pendientes y
-- mover_paquete => `mover_entregas`.
-- Todo rechazo posterior a la primera escritura se lanza con AG001 y un bloque `exception` deshace lo escrito y devuelve
-- { ok: false, motivo }. Devuelve { ok: true, embarques: [{ id, revision }], compras: [{ id, revision }] }.
-- Motivos: agrupador_cambio, compra_cambio, no_pertenece, no_encontrado, no_editable (paquete cancelado), embarque_no_editable,
-- embarque_con_recepciones, asignacion_con_recepciones, excede_entrega, compra_no_asignable, saldo_cerrado, max_entregas,
-- paquete_de_otro_embarque, reparto_sin_vector, motivo_requerido, salida_despues_de_llegada. `sin_pendientes` lo decide TypeScript
-- (no hay movimientos que armar); aquí un plan sin movimientos es válido.
create or replace function public.aplicar_movimiento_agrupador(p_plan jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_op text := p_plan ->> 'operacion';
  v_motivo text := nullif(btrim(p_plan ->> 'motivo'), '');
  v_resumen text := left(coalesce(nullif(btrim(p_plan ->> 'resumen'), ''), p_plan ->> 'operacion'), 300);
  v_movs jsonb := coalesce(p_plan -> 'movimientos', '[]'::jsonb);
  v_pm jsonb := p_plan -> 'paquete_a_mover';
  v_pm_id uuid;
  v_pm_dest uuid;
  v_pm_orig uuid;
  v_pm_estado text;
  v_emb_ids uuid[];
  v_compra_ids uuid[];
  v_lineas uuid[];
  v_n integer;
  v_cf_id uuid;
  v_cf_fecha date;
  v_antes_c jsonb := '{}'::jsonb;
  v_antes_e jsonb := '{}'::jsonb;
  v_id uuid;
  v_res jsonb;
  v_dest uuid[];
  v_rev integer;
  v_accion_compra text;
  v_res_c jsonb := '[]'::jsonb;
  v_res_e jsonb := '[]'::jsonb;
begin
  begin
    if v_op is null or v_op not in ('asignar', 'quitar', 'mover_a_paquete', 'cambiar_fecha', 'pasar_pendientes', 'mover_paquete') then
      raise exception 'plan invalido: operacion desconocida' using errcode = 'AG002';
    end if;
    v_accion_compra := case when v_op in ('asignar', 'quitar', 'mover_a_paquete') then 'asignar_agrupador' else 'mover_entregas' end;

    select coalesce(array_agg((e ->> 'id')::uuid order by (e ->> 'id')::uuid), '{}'::uuid[]) into v_emb_ids
      from jsonb_array_elements(coalesce(p_plan -> 'embarques', '[]'::jsonb)) e;
    if cardinality(v_emb_ids) = 0 then
      raise exception 'plan invalido: sin embarques' using errcode = 'AG002';
    end if;
    select coalesce(array_agg((c ->> 'id')::uuid order by (c ->> 'id')::uuid), '{}'::uuid[]) into v_compra_ids
      from jsonb_array_elements(coalesce(p_plan -> 'compras', '[]'::jsonb)) c;
    select coalesce(array_agg(distinct (m ->> 'linea_id')::uuid), '{}'::uuid[]) into v_lineas
      from jsonb_array_elements(v_movs) m;

    perform 1 from public.compra_embarques e where e.id = any (v_emb_ids) order by e.id for update;
    get diagnostics v_n = row_count;
    if v_n <> cardinality(v_emb_ids) then
      raise exception 'no_encontrado' using errcode = 'AG001';
    end if;
    if exists (
      select 1
      from jsonb_to_recordset(p_plan -> 'embarques') as x(id uuid, revision integer)
      join public.compra_embarques e on e.id = x.id
      where e.revision is distinct from x.revision
    ) then
      raise exception 'agrupador_cambio' using errcode = 'AG001';
    end if;

    if v_op in ('asignar', 'mover_a_paquete', 'cambiar_fecha', 'mover_paquete')
       and exists (select 1 from public.compra_embarques e where e.id = any (v_emb_ids) and e.estado not in ('planificado', 'en_transito')) then
      raise exception 'embarque_no_editable' using errcode = 'AG001';
    end if;
    if v_op = 'pasar_pendientes' then
      if exists (select 1 from public.compra_embarques e where e.id = any (v_emb_ids) and e.estado = 'cancelado') then
        raise exception 'embarque_no_editable' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(v_movs) m
        join public.compra_embarques e on e.id = nullif(m -> 'destino' ->> 'embarque_id', '')::uuid
        where e.estado not in ('planificado', 'en_transito')
      ) then
        raise exception 'embarque_no_editable' using errcode = 'AG001';
      end if;
    end if;
    if v_op in ('cambiar_fecha', 'mover_paquete', 'pasar_pendientes') and v_motivo is null then
      raise exception 'motivo_requerido' using errcode = 'AG001';
    end if;

    if v_op = 'cambiar_fecha' then
      select (x ->> 'id')::uuid, (x ->> 'fecha_llegada_estimada')::date into v_cf_id, v_cf_fecha
        from jsonb_array_elements(p_plan -> 'embarques') x
       where nullif(x ->> 'fecha_llegada_estimada', '') is not null
       limit 1;
      if v_cf_id is null then
        raise exception 'plan invalido: cambiar_fecha sin fecha' using errcode = 'AG002';
      end if;
      if exists (select 1 from public.compra_embarques e where e.id = v_cf_id and e.fecha_salida_estimada > v_cf_fecha) then
        raise exception 'salida_despues_de_llegada' using errcode = 'AG001';
      end if;
    end if;

    if cardinality(v_compra_ids) > 0 then
      perform 1 from public.compras c where c.id = any (v_compra_ids) order by c.id for update;
      get diagnostics v_n = row_count;
      if v_n <> cardinality(v_compra_ids) then
        raise exception 'compra_cambio' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(p_plan -> 'compras') as x(id uuid, revision integer)
        join public.compras c on c.id = x.id
        where c.revision is distinct from x.revision
      ) then
        raise exception 'compra_cambio' using errcode = 'AG001';
      end if;
    end if;

    if jsonb_array_length(v_movs) > 0 then
      if exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(entrega_id uuid, linea_id uuid, compra_id uuid)
        where m.compra_id <> all (v_compra_ids)
           or not exists (
             select 1
             from public.compra_linea_entregas e
             join public.compra_lineas l on l.id = e.linea_id
             where e.id = m.entrega_id and l.id = m.linea_id and l.compra_id = m.compra_id
           )
      ) then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(v_movs) m
        where nullif(m -> 'destino' ->> 'embarque_id', '') is not null
          and (m -> 'destino' ->> 'embarque_id')::uuid <> all (v_emb_ids)
      ) then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(asignacion_id uuid)
        join public.compra_entrega_asignaciones a on a.id = m.asignacion_id
        where a.embarque_id <> all (v_emb_ids)
      ) then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(compra_id uuid)
        join public.compras c on c.id = m.compra_id
        where c.estado = 'recibida' and c.cancelada_at is not null
      ) then
        raise exception 'saldo_cerrado' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from jsonb_to_recordset(v_movs) as m(linea_id uuid, compra_id uuid)
        join public.compras c on c.id = m.compra_id
        join public.compra_lineas l on l.id = m.linea_id
        where not public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
      ) then
        raise exception 'compra_no_asignable' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from public.compra_entrega_asignaciones a
        join public.compra_linea_entregas e on e.id = a.entrega_id
        join public.compra_lineas l on l.id = e.linea_id
        join public.compras c on c.id = l.compra_id
        where a.embarque_id = any (v_emb_ids)
          and public.agrupador_es_activa(c.estado, l.activo, l.unidades, l.unidades_recibidas, l.unidades_canceladas)
          and c.id <> all (v_compra_ids)
      ) then
        raise exception 'compra_cambio' using errcode = 'AG001';
      end if;
    end if;

    if jsonb_typeof(v_pm) = 'object' then
      v_pm_id := (v_pm ->> 'paquete_id')::uuid;
      v_pm_dest := (v_pm ->> 'embarque_destino_id')::uuid;
      select p.embarque_id, p.estado into v_pm_orig, v_pm_estado from public.compra_paquetes p where p.id = v_pm_id;
      if not found then
        raise exception 'no_encontrado' using errcode = 'AG001';
      end if;
      if v_pm_estado <> 'abierto' then
        raise exception 'no_editable' using errcode = 'AG001';
      end if;
      if v_pm_orig <> all (v_emb_ids) or v_pm_dest <> all (v_emb_ids) or v_pm_orig = v_pm_dest then
        raise exception 'no_pertenece' using errcode = 'AG001';
      end if;
      if exists (
        select 1
        from public.compra_linea_recepciones r
        join public.compra_entrega_asignaciones a on a.id = r.asignacion_id
        where a.paquete_id = v_pm_id
      ) then
        raise exception 'asignacion_con_recepciones' using errcode = 'AG001';
      end if;
    end if;

    if v_op = 'cambiar_fecha' and exists (
      select 1
      from public.compra_embarques e
      where e.id = v_cf_id
        and make_date(
              extract(year from coalesce(e.fecha_llegada_real, v_cf_fecha))::integer,
              extract(month from coalesce(e.fecha_llegada_real, v_cf_fecha))::integer,
              1
            ) <> e.periodo_llegada
    ) and exists (
      select 1
      from public.compra_linea_recepciones r
      join public.compra_entrega_asignaciones a on a.id = r.asignacion_id
      where a.embarque_id = v_cf_id
    ) then
      raise exception 'embarque_con_recepciones' using errcode = 'AG001';
    end if;

    foreach v_id in array v_compra_ids loop
      v_antes_c := v_antes_c || jsonb_build_object(v_id::text, public.compra_foto(v_id) || public.compra_foto_entregas(v_id));
    end loop;
    foreach v_id in array v_emb_ids loop
      v_antes_e := v_antes_e || jsonb_build_object(v_id::text, public.agrupador_foto_embarque(v_id));
    end loop;

    if v_op = 'cambiar_fecha' then
      update public.compra_embarques
         set fecha_llegada_estimada = v_cf_fecha
       where id = v_cf_id;
    end if;
    if jsonb_typeof(v_pm) = 'object' then
      update public.compra_paquetes
         set embarque_id = v_pm_dest, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
       where id = v_pm_id;
    end if;

    v_res := public.agrupador_mover_entregas(v_movs, coalesce(p_plan -> 'repartos', '[]'::jsonb), p_actor);
    select coalesce(array_agg(x::uuid), '{}'::uuid[]) into v_dest
      from jsonb_array_elements_text(v_res -> 'asignaciones_destino') x;

    if exists (
      select 1
      from jsonb_to_recordset(coalesce(p_plan -> 'entregas', '[]'::jsonb)) as x(linea_id uuid, periodo text, unidades integer)
      where coalesce(
              (select e.unidades from public.compra_linea_entregas e
                where e.linea_id = x.linea_id and e.periodo = (left(x.periodo, 7) || '-01')::date),
              0
            ) <> x.unidades
    ) then
      raise exception 'plan inconsistente: las entregas que dejo la base no coinciden con el plan' using errcode = 'AG002';
    end if;

    if exists (
      select 1
      from jsonb_to_recordset(coalesce(p_plan -> 'entregas', '[]'::jsonb)) as x(linea_id uuid, periodo text, unidades integer)
      join public.compra_lineas l on l.id = x.linea_id
      join public.compra_linea_entregas e on e.linea_id = x.linea_id and e.periodo = (left(x.periodo, 7) || '-01')::date
      where l.tipo <> 'especifica'
        and e.unidades > 0
        and coalesce((select sum(r.unidades) from public.compra_linea_repartos r where r.entrega_id = e.id), 0) <> e.unidades
    ) then
      raise exception 'reparto_sin_vector' using errcode = 'AG001';
    end if;

    if exists (
      select 1
      from public.compra_lineas l
      where l.id = any (v_lineas)
        and coalesce((select sum(e.unidades) from public.compra_linea_entregas e where e.linea_id = l.id), 0) <> l.unidades
    ) then
      raise exception 'invariante I3: la suma de las entregas ya no es la de la linea' using errcode = 'AG002';
    end if;
    if exists (
      select 1
      from public.compra_lineas l
      where l.id = any (v_lineas)
        and (select count(*) from public.compra_linea_entregas e where e.linea_id = l.id) > 24
    ) then
      raise exception 'max_entregas' using errcode = 'AG001';
    end if;
    if exists (
      select 1
      from public.compra_lineas l
      where l.id = any (v_lineas)
        and not exists (select 1 from public.compra_linea_entregas e where e.linea_id = l.id)
    ) then
      raise exception 'invariante I3: una linea se quedo sin entregas' using errcode = 'AG002';
    end if;
    if exists (
      select 1
      from public.compra_linea_entregas e
      where e.linea_id = any (v_lineas)
        and coalesce((select sum(a.unidades) from public.compra_entrega_asignaciones a where a.entrega_id = e.id), 0) > e.unidades
    ) then
      raise exception 'excede_entrega' using errcode = 'AG001';
    end if;
    if v_op in ('asignar', 'cambiar_fecha', 'mover_paquete', 'pasar_pendientes') and exists (
      select 1
      from public.compra_entrega_asignaciones a
      join public.compra_linea_entregas e on e.id = a.entrega_id
      join public.compra_embarques b on b.id = a.embarque_id
      where a.id = any (v_dest)
        and e.periodo <> b.periodo_llegada
    ) then
      raise exception 'invariante I2: una asignacion que recibio unidades no queda en el mes de llegada de su embarque' using errcode = 'AG002';
    end if;

    foreach v_id in array v_compra_ids loop
      perform public.compra_recalcular_estado(v_id);
      update public.compras
         set revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
       where id = v_id
       returning revision into v_rev;
      v_res_c := v_res_c || jsonb_build_array(jsonb_build_object('id', v_id, 'revision', v_rev));
      insert into public.compra_eventos (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
      values (
        v_id, null, v_accion_compra, v_antes_c -> (v_id::text),
        public.compra_foto(v_id) || public.compra_foto_entregas(v_id),
        left(v_motivo, 300), v_resumen, v_perfil, v_nombre_actor
      );
    end loop;

    foreach v_id in array v_emb_ids loop
      update public.compra_embarques
         set revision = revision + 1, updated_by_id = v_perfil, updated_by_nombre = v_nombre_actor
       where id = v_id
       returning revision into v_rev;
      v_res_e := v_res_e || jsonb_build_array(jsonb_build_object('id', v_id, 'revision', v_rev));
    end loop;

    foreach v_id in array v_emb_ids loop
      insert into public.compra_agrupador_eventos (embarque_id, viaje_id, paquete_id, accion, antes, despues, motivo, resumen, compras, perfil_id, usuario_nombre)
      select
        v_id, e.viaje_id, v_pm_id,
        coalesce(nullif(p_plan ->> 'accion', ''), v_op),
        v_antes_e -> (v_id::text), public.agrupador_foto_embarque(v_id),
        left(v_motivo, 300), v_resumen,
        (select coalesce(jsonb_agg(jsonb_build_object('compra_id', x ->> 'id', 'revision_nueva', (x ->> 'revision')::integer)), '[]'::jsonb)
           from jsonb_array_elements(v_res_c) x),
        v_perfil, v_nombre_actor
      from public.compra_embarques e
      where e.id = v_id;
    end loop;

    return jsonb_build_object('ok', true, 'embarques', v_res_e, 'compras', v_res_c);
  exception
    when sqlstate 'AG001' then
      return jsonb_build_object('ok', false, 'motivo', sqlerrm);
    when unique_violation then
      return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end;
end;
$$;

revoke execute on function public.aplicar_movimiento_agrupador(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.aplicar_movimiento_agrupador(jsonb, jsonb) to service_role;

comment on function public.aplicar_movimiento_agrupador(jsonb, jsonb) is
  'M8 08b-1: aplica un plan de movimiento (asignar, quitar, mover_a_paquete, cambiar_fecha, pasar_pendientes, mover_paquete) en una transaccion. Bloquea embarques y compras en orden, compara revisiones (agrupador_cambio, compra_cambio), comprueba pertenencia y estados, ejecuta los movimientos con agrupador_mover_entregas, verifica I1 a I3 e I2 contra el plan, recalcula, sube revision de compras y embarques (I5) y deja eventos. Todo rechazo deshace lo escrito y devuelve { ok: false, motivo }. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 16. `importar_agrupadores(p_lote, p_actor)` (§3.11, decisión 97)
-- ---------------------------------------------------------------------------
-- p_lote = `LoteImportarAgrupadores` (src/lib/compras/agrupadores/importar.ts): { archivo_nombre, viajes: [...], embarques: [...],
-- paquetes: [...] } con SOLO las filas `nueva`. Cada elemento lleva `fila` (se devuelve en `creados`); viaje { codigo | null, nombre,
-- destino, fecha_inicio, fecha_fin, responsable_id, nota }; embarque { codigo | null, nombre, tipo, viaje_id | null, viaje_codigo |
-- null, responsable_id, referencia_logistica, puerto_embarque, fecha_salida_estimada, fecha_llegada_estimada, nota }; paquete
-- { codigo | null, nombre, embarque_id | null, embarque_codigo | null, responsable_id, nota }. `viaje_id` y `embarque_id` son
-- referencias a EXISTENTES; `viaje_codigo` y `embarque_codigo` son referencias por código a lo que el mismo lote crea (o, si el código
-- ya existe, a eso). SOLO CREA: nunca edita, mueve ni asigna compras.
-- Una sola transacción, todo o nada. Toma el candado consultivo `agrupador_importar` (una importación a la vez), bloquea los viajes y
-- embarques existentes a los que apunta (viajes antes que embarques) y procesa viajes, después embarques y después paquetes; dentro de
-- cada tipo, PRIMERO los que traen código (que ocupan su correlativo) y después los que no, en orden de `fila` (se numeran con
-- `agrupador_siguiente_codigo`: máximo más uno, correlativo_agotado con 99). Vuelve a comprobar cada clave: con código, (tipo, código);
-- sin él, la natural (viaje: nombre y fecha de inicio; embarque: nombre y llegada; paquete: embarque y nombre). Si ya existe,
-- `clave_existente` (alguien la creó entre previsualizar y aplicar, o se aplicó el mismo lote dos veces): la API responde 409
-- vuelve_a_previsualizar y NO se duplica nada. Deja un evento `crear` por agrupador con motivo «Importado de <archivo>».
-- Devuelve { ok: true, creados: [{ tipo, fila, id, codigo }] } o { ok: false, motivo, tipo, fila } con el elemento que falló y uno de:
-- clave_existente, viaje_cancelado, embarque_no_editable (paquete en un embarque cancelado o recibido), responsable_no_asignable,
-- correlativo_agotado, codigo_duplicado, codigo_invalido, local_con_viaje, no_encontrado (una referencia ya no existe),
-- fecha_requerida, fin_antes_de_inicio, salida_despues_de_llegada. Los motivos de lectura del archivo (§3.11) los decide TypeScript.
create or replace function public.importar_agrupadores(p_lote jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre_actor text := nullif(p_actor ->> 'nombre', '');
  v_archivo text := nullif(left(btrim(coalesce(p_lote ->> 'archivo_nombre', '')), 250), '');
  v_motivo_ev text;
  v_it jsonb;
  v_tipo_act text := null;
  v_fila_act integer := null;
  v_codigo text;
  v_ref date;
  v_creados jsonb := '[]'::jsonb;
  v_viaje public.compra_viajes%rowtype;
  v_emb public.compra_embarques%rowtype;
  v_paq public.compra_paquetes%rowtype;
  v_viaje_id uuid;
  v_emb_id uuid;
  v_resp uuid;
  v_nombre text;
  v_inicio date;
  v_fin date;
  v_salida date;
  v_llegada date;
  v_tipo_emb text;
begin
  v_motivo_ev := left('Importado de ' || coalesce(v_archivo, 'archivo'), 300);
  perform pg_advisory_xact_lock(hashtext('agrupador_importar'));

  perform 1
     from public.compra_viajes v
    where v.id in (
      select (e ->> 'viaje_id')::uuid
        from jsonb_array_elements(coalesce(p_lote -> 'embarques', '[]'::jsonb)) e
       where nullif(e ->> 'viaje_id', '') is not null
    )
    order by v.id
      for update;
  perform 1
     from public.compra_embarques b
    where b.id in (
      select (e ->> 'embarque_id')::uuid
        from jsonb_array_elements(coalesce(p_lote -> 'paquetes', '[]'::jsonb)) e
       where nullif(e ->> 'embarque_id', '') is not null
    )
    order by b.id
      for update;

  begin
    v_tipo_act := 'viaje';
    for v_it in
      select x.value
        from jsonb_array_elements(coalesce(p_lote -> 'viajes', '[]'::jsonb)) as x(value)
       order by (case when nullif(btrim(x.value ->> 'codigo'), '') is null then 1 else 0 end), (x.value ->> 'fila')::integer
    loop
      v_fila_act := (v_it ->> 'fila')::integer;
      v_nombre := btrim(coalesce(v_it ->> 'nombre', ''));
      v_resp := nullif(v_it ->> 'responsable_id', '')::uuid;
      v_inicio := nullif(v_it ->> 'fecha_inicio', '')::date;
      v_fin := nullif(v_it ->> 'fecha_fin', '')::date;
      v_codigo := upper(btrim(coalesce(v_it ->> 'codigo', '')));
      if v_inicio is null then
        raise exception 'fecha_requerida' using errcode = 'AG001';
      end if;
      if v_fin is not null and v_fin < v_inicio then
        raise exception 'fin_antes_de_inicio' using errcode = 'AG001';
      end if;
      if v_resp is null or not public.agrupador_responsable_asignable(v_resp) then
        raise exception 'responsable_no_asignable' using errcode = 'AG001';
      end if;
      if v_codigo = '' then
        if exists (
          select 1 from public.compra_viajes x
           where public.agrupador_nombre_clave(x.nombre) = public.agrupador_nombre_clave(v_nombre) and x.fecha_inicio = v_inicio
        ) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
        v_codigo := public.agrupador_siguiente_codigo('viaje', v_inicio);
        if v_codigo is null then
          raise exception 'correlativo_agotado' using errcode = 'AG001';
        end if;
      else
        if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
          raise exception 'codigo_invalido' using errcode = 'AG001';
        end if;
        if exists (select 1 from public.compra_viajes x where upper(x.codigo) = v_codigo) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
      end if;
      insert into public.compra_viajes (
        codigo, nombre, destino, fecha_inicio, fecha_fin, responsable_id, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (
        v_codigo, v_nombre, nullif(btrim(v_it ->> 'destino'), ''), v_inicio, v_fin, v_resp, nullif(btrim(v_it ->> 'nota'), ''),
        v_perfil, v_nombre_actor, v_perfil, v_nombre_actor
      )
      returning * into v_viaje;
      insert into public.compra_agrupador_eventos (viaje_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
      values (
        v_viaje.id, 'crear', null, to_jsonb(v_viaje), v_motivo_ev,
        left(format('Viaje %s creado: %s', v_viaje.codigo, v_viaje.nombre), 300), v_perfil, v_nombre_actor
      );
      v_creados := v_creados || jsonb_build_array(
        jsonb_build_object('tipo', 'viaje', 'fila', v_fila_act, 'id', v_viaje.id, 'codigo', v_viaje.codigo)
      );
    end loop;

    v_tipo_act := 'embarque';
    for v_it in
      select x.value
        from jsonb_array_elements(coalesce(p_lote -> 'embarques', '[]'::jsonb)) as x(value)
       order by (case when nullif(btrim(x.value ->> 'codigo'), '') is null then 1 else 0 end), (x.value ->> 'fila')::integer
    loop
      v_fila_act := (v_it ->> 'fila')::integer;
      v_nombre := btrim(coalesce(v_it ->> 'nombre', ''));
      v_tipo_emb := coalesce(nullif(v_it ->> 'tipo', ''), 'importacion');
      v_resp := nullif(v_it ->> 'responsable_id', '')::uuid;
      v_salida := nullif(v_it ->> 'fecha_salida_estimada', '')::date;
      v_llegada := nullif(v_it ->> 'fecha_llegada_estimada', '')::date;
      v_codigo := upper(btrim(coalesce(v_it ->> 'codigo', '')));
      v_viaje_id := nullif(v_it ->> 'viaje_id', '')::uuid;
      if v_viaje_id is null and nullif(btrim(v_it ->> 'viaje_codigo'), '') is not null then
        select v.id into v_viaje_id from public.compra_viajes v where upper(v.codigo) = upper(btrim(v_it ->> 'viaje_codigo'));
        if not found then
          raise exception 'no_encontrado' using errcode = 'AG001';
        end if;
      end if;
      if v_llegada is null then
        raise exception 'fecha_requerida' using errcode = 'AG001';
      end if;
      if v_salida is not null and v_salida > v_llegada then
        raise exception 'salida_despues_de_llegada' using errcode = 'AG001';
      end if;
      if v_viaje_id is not null then
        select * into v_viaje from public.compra_viajes where id = v_viaje_id;
        if not found then
          raise exception 'no_encontrado' using errcode = 'AG001';
        end if;
        if v_viaje.estado = 'cancelado' then
          raise exception 'viaje_cancelado' using errcode = 'AG001';
        end if;
      end if;
      if v_tipo_emb = 'local' and v_viaje_id is not null then
        raise exception 'local_con_viaje' using errcode = 'AG001';
      end if;
      if v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
        raise exception 'responsable_no_asignable' using errcode = 'AG001';
      end if;
      if v_codigo = '' then
        if exists (
          select 1 from public.compra_embarques x
           where public.agrupador_nombre_clave(x.nombre) = public.agrupador_nombre_clave(v_nombre) and x.fecha_llegada_estimada = v_llegada
        ) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
        v_codigo := public.agrupador_siguiente_codigo('embarque', v_llegada);
        if v_codigo is null then
          raise exception 'correlativo_agotado' using errcode = 'AG001';
        end if;
      else
        if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
          raise exception 'codigo_invalido' using errcode = 'AG001';
        end if;
        if exists (select 1 from public.compra_embarques x where upper(x.codigo) = v_codigo) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
      end if;
      insert into public.compra_embarques (
        codigo, nombre, tipo, viaje_id, responsable_id, referencia_logistica, puerto_embarque,
        fecha_salida_estimada, fecha_llegada_estimada, nota,
        perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (
        v_codigo, v_nombre, v_tipo_emb, v_viaje_id, v_resp, nullif(btrim(v_it ->> 'referencia_logistica'), ''),
        nullif(btrim(v_it ->> 'puerto_embarque'), ''), v_salida, v_llegada, nullif(btrim(v_it ->> 'nota'), ''),
        v_perfil, v_nombre_actor, v_perfil, v_nombre_actor
      )
      returning * into v_emb;
      insert into public.compra_agrupador_eventos (embarque_id, viaje_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
      values (
        v_emb.id, v_emb.viaje_id, 'crear', null,
        public.agrupador_foto_embarque(v_emb.id) || jsonb_build_object('nombre', v_emb.nombre, 'tipo', v_emb.tipo),
        v_motivo_ev, left(format('Embarque %s creado: %s', v_emb.codigo, v_emb.nombre), 300), v_perfil, v_nombre_actor
      );
      v_creados := v_creados || jsonb_build_array(
        jsonb_build_object('tipo', 'embarque', 'fila', v_fila_act, 'id', v_emb.id, 'codigo', v_emb.codigo)
      );
    end loop;

    v_tipo_act := 'paquete';
    for v_it in
      select x.value
        from jsonb_array_elements(coalesce(p_lote -> 'paquetes', '[]'::jsonb)) as x(value)
       order by (case when nullif(btrim(x.value ->> 'codigo'), '') is null then 1 else 0 end), (x.value ->> 'fila')::integer
    loop
      v_fila_act := (v_it ->> 'fila')::integer;
      v_nombre := btrim(coalesce(v_it ->> 'nombre', ''));
      v_resp := nullif(v_it ->> 'responsable_id', '')::uuid;
      v_codigo := upper(btrim(coalesce(v_it ->> 'codigo', '')));
      v_emb_id := nullif(v_it ->> 'embarque_id', '')::uuid;
      if v_emb_id is null and nullif(btrim(v_it ->> 'embarque_codigo'), '') is not null then
        select b.id into v_emb_id from public.compra_embarques b where upper(b.codigo) = upper(btrim(v_it ->> 'embarque_codigo'));
        if not found then
          raise exception 'no_encontrado' using errcode = 'AG001';
        end if;
      end if;
      select * into v_emb from public.compra_embarques where id = v_emb_id;
      if not found then
        raise exception 'no_encontrado' using errcode = 'AG001';
      end if;
      if v_emb.estado not in ('planificado', 'en_transito') then
        raise exception 'embarque_no_editable' using errcode = 'AG001';
      end if;
      if v_resp is not null and not public.agrupador_responsable_asignable(v_resp) then
        raise exception 'responsable_no_asignable' using errcode = 'AG001';
      end if;
      v_ref := v_emb.periodo_llegada;
      if v_codigo = '' then
        if exists (
          select 1 from public.compra_paquetes x
           where x.embarque_id = v_emb_id and public.agrupador_nombre_clave(x.nombre) = public.agrupador_nombre_clave(v_nombre)
        ) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
        v_codigo := public.agrupador_siguiente_codigo('paquete', v_ref);
        if v_codigo is null then
          raise exception 'correlativo_agotado' using errcode = 'AG001';
        end if;
      else
        if v_codigo !~ '^[A-Z0-9-]{1,30}$' then
          raise exception 'codigo_invalido' using errcode = 'AG001';
        end if;
        if exists (select 1 from public.compra_paquetes x where upper(x.codigo) = v_codigo) then
          raise exception 'clave_existente' using errcode = 'AG001';
        end if;
      end if;
      insert into public.compra_paquetes (
        embarque_id, codigo, nombre, responsable_id, nota, perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
      )
      values (v_emb_id, v_codigo, v_nombre, v_resp, nullif(btrim(v_it ->> 'nota'), ''), v_perfil, v_nombre_actor, v_perfil, v_nombre_actor)
      returning * into v_paq;
      insert into public.compra_agrupador_eventos (paquete_id, embarque_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
      values (
        v_paq.id, v_emb_id, 'crear', null, to_jsonb(v_paq), v_motivo_ev,
        left(format('Paquete %s creado: %s', v_paq.codigo, v_paq.nombre), 300), v_perfil, v_nombre_actor
      );
      v_creados := v_creados || jsonb_build_array(
        jsonb_build_object('tipo', 'paquete', 'fila', v_fila_act, 'id', v_paq.id, 'codigo', v_paq.codigo)
      );
    end loop;

    return jsonb_build_object('ok', true, 'creados', v_creados);
  exception
    when sqlstate 'AG001' then
      return jsonb_build_object('ok', false, 'motivo', sqlerrm, 'tipo', v_tipo_act, 'fila', v_fila_act);
    when unique_violation then
      return jsonb_build_object('ok', false, 'motivo', 'codigo_duplicado', 'tipo', v_tipo_act, 'fila', v_fila_act);
  end;
end;
$$;

revoke execute on function public.importar_agrupadores(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.importar_agrupadores(jsonb, jsonb) to service_role;

comment on function public.importar_agrupadores(jsonb, jsonb) is
  'M8 08b-1 (3.11, decision 97): crea viajes, embarques y paquetes de un lote (solo filas nuevas) en una transaccion, todo o nada, bajo el candado agrupador_importar. Reserva primero los codigos escritos y autonumera despues en orden de fila. Vuelve a comprobar cada clave (clave_existente: no duplica; aplicar dos veces el mismo lote no crea nada la segunda vez) y cada referencia. Solo crea: nunca edita, mueve ni asigna compras. Deja un evento crear por agrupador. Devuelve { ok, creados[] } o { ok: false, motivo, tipo, fila }. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 17. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
alter table public.compra_viajes enable row level security;
alter table public.compra_embarques enable row level security;
alter table public.compra_paquetes enable row level security;
alter table public.compra_entrega_asignaciones enable row level security;
alter table public.compra_agrupador_eventos enable row level security;

-- Viajes, embarques y paquetes nunca se borran (se cancelan): service_role lee, inserta y actualiza. Las asignaciones sí se borran
-- (quitar, fundir, mover). `revoke all ... from service_role` y luego el grant exacto: repetible. Sin truncate, trigger ni references.
revoke all on public.compra_viajes from public, anon, authenticated, service_role;
grant select, insert, update on public.compra_viajes to service_role;
revoke all on public.compra_embarques from public, anon, authenticated, service_role;
grant select, insert, update on public.compra_embarques to service_role;
revoke all on public.compra_paquetes from public, anon, authenticated, service_role;
grant select, insert, update on public.compra_paquetes to service_role;
revoke all on public.compra_entrega_asignaciones from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.compra_entrega_asignaciones to service_role;
-- Tabla de solo inserción (igual que las de 0031): service_role solo lee e inserta; el trigger es la segunda barrera para el dueño.
revoke all on public.compra_agrupador_eventos from public, anon, authenticated, service_role;
grant select, insert on public.compra_agrupador_eventos to service_role;
