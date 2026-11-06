-- 0039 · Proveedores (ficha, contactos, historial) y fotos de las líneas de compra (08c · E1).
--
-- Ficha: docs/modulos/08c-proveedores-y-fotos-de-compras.md (§2 modelo, §2.5 Storage, §2.7 funciones, §11 respuestas de Javier).
-- Decisiones 87 y 100 a 106. Depende de 0025 (`proveedores`, `compras`, `compra_lineas`, `compra_eventos`), 0035 (registro y patrón de
-- tablas de solo inserción) y 0038. La 0038 es la última aplicada en Vector2, que tiene 0 proveedores, 0 compras y 0 líneas: no hay nada
-- que mover ni backfill.
--
-- Qué hace (en este orden):
--   1. `proveedores`: doce columnas nuevas, todas opcionales salvo `revision` (dirección, región, puerto habitual, incoterm, moneda,
--      plazos, condiciones de pago, `revision`, `updated_by_*` y `clave_origen`). Sin backfill.
--   2. `proveedor_contactos`: contactos del proveedor (hasta 20, a lo sumo uno principal). Se guardan con la ficha, en una transacción.
--   3. `proveedor_eventos`: historial de cambios del proveedor, de SOLO INSERCIÓN (decisión 103): trigger de fila y de TRUNCATE, y solo
--      `select, insert` para `service_role` (patrón de la 0035).
--   4. `compra_lineas.descripcion` y `compra_lineas.modelo` (opcionales; solo las escriben funciones).
--   5. `compra_linea_fotos`: hasta 3 fotos activas por línea, con `origen_foto_id` (traer las de la versión cancelada, decisión 104) y
--      `clave_origen` (carga desde COTV, decisión 106). Nunca se borra una fila: quitar = `activo = false`.
--   6. El bucket PRIVADO `compras-fotos` de Storage, SIN ninguna política en `storage.objects` (ver «Storage» abajo).
--   7. Funciones (todas `security invoker`, `search_path` vacío, solo `service_role`, `returns jsonb` con `{ ok: true, ... }` o
--      `{ ok: false, motivo }`): proveedor_foto (ayudante), guardar_proveedor, cambiar_activo_proveedor, eliminar_proveedor,
--      agregar_foto_linea, quitar_foto_linea, traer_fotos_linea, editar_ficha_linea y fotos_huerfanas (solo lectura).
--   8. RLS activo sin políticas, privilegios explícitos y registro en `migraciones_aplicadas` (convención de la 0035).
--
-- QUÉ NO HACE: `parametros_precio` y `guardar_parametros_precio` son de E2 (`00E2_parametros_precio`), no de esta migración.
--
-- Idempotente: se corre dos veces sin error. Sin `drop`, `delete`, `truncate` ni `update` a nivel de migración (los hay dentro de las
-- funciones, que es su trabajo). Sin bloques `do $$`. Los cuerpos de las funciones no llevan comentarios `--` (se aplican por
-- `execute_sql` en trozos): lo que hay que saber de cada una está en el comentario que la precede.
--
-- STORAGE. En Supabase el esquema `storage` ya existe y la inserción del bucket es una fila más. En el PostgreSQL local y en la CI
-- (`postgres:17` plano) no existe: `scripts/validar-migraciones-local.sh` crea un esquema `storage` mínimo (buckets y objects, con RLS y
-- sin políticas, y el trigger que rechaza el DELETE directo) ANTES de las migraciones. La migración no lo crea: en Supabase sería
-- tocar un esquema que no es nuestro. Estado comprobado en Vector2 el 2026-11-06: 0 buckets, 0 políticas en el esquema `storage`, 0
-- objetos, RLS activo en `storage.objects`; `anon` y `authenticated` conservan sus grants sobre `storage.objects` y solo los frena el
-- RLS sin políticas (por eso el humo exige 0 políticas en TODO el esquema, no solo las que nombren el bucket). `storage.objects` tiene
-- el trigger `protect_objects_delete`: los objetos no se borran por SQL, se borran con la API de Storage (`.remove()`).
--
-- CANDADOS (desvío respecto a la ficha, §2.7, que dice «las funciones de esta ficha toman solo la línea, así que no hay interbloqueo»).
-- Insertar una foto o un evento hace que Postgres tome `FOR KEY SHARE` sobre la fila de la compra (la FK `compra_id`). Si una función de
-- la compra (`editar_linea` de 0.13.1, `registrar_recepciones`...) tiene la compra `FOR UPDATE` y quiere la línea, y nosotras tenemos la
-- línea `FOR UPDATE` y esperamos la compra por la FK, hay un ciclo (40P01). Por eso `agregar_foto_linea`, `quitar_foto_linea`,
-- `traer_fotos_linea` y `editar_ficha_linea` toman PRIMERO la compra `FOR KEY SHARE` y después la línea `FOR UPDATE`: el mismo orden
-- compra -> línea de las demás funciones. `FOR KEY SHARE` no sube `compras.revision` ni bloquea a otras fotos (es compatible consigo
-- mismo); solo espera si alguien tiene la compra `FOR UPDATE` en ese instante, y entonces espera, no da 409. Lo prueba
-- `tests/integracion/concurrencia.int.test.ts`.
--
-- ACTOR. Las funciones leen de `p_actor`: `perfil_id` (o `id`, alias de la ficha), `nombre`, `rol` y `origen`. `rol` solo lo mira
-- `quitar_foto_linea` (compra cancelada: solo `admin`) y `guardar_proveedor` (un `comprador` no cambia `es_intercompany`); sin `rol` rige
-- el caso más restrictivo en quitar y no hay restricción en guardar (la API aplica su propio guard). `origen = 'carga_cotv'` solo lo
-- manda la carga C1 (§12.5 de la ficha) y hace que el evento sea `importar`.

-- >>> TROZO 1 (columnas nuevas y tablas)
-- ---------------------------------------------------------------------------
-- 1. `proveedores`: columnas nuevas
-- ---------------------------------------------------------------------------
-- Cada `check` va dentro de su `add column if not exists`: si la columna ya existe, la cláusula completa se omite (segunda pasada).
-- `pais` sigue siendo texto libre (la API valida contra `PAISES`); `incoterm` y `moneda` son catálogo en zod, sin check (PLAN §4).
-- `revision` controla la concurrencia de la edición (ficha + contactos se guardan juntos); `updated_by_*` es quién cambió por última
-- vez (`perfil_id` y `usuario_nombre` siguen siendo quién lo creó).
-- `clave_origen` (`cotv:supplier:{id}`) identifica el registro de origen de una carga: solo la escribe la carga C1 a través de
-- `guardar_proveedor`; la API no la recibe ni la devuelve (decisión 106).
alter table public.proveedores
  add column if not exists direccion text
    constraint proveedores_direccion_len_check check (direccion is null or char_length(direccion) <= 300),
  add column if not exists region text
    constraint proveedores_region_len_check check (region is null or char_length(region) <= 80),
  add column if not exists puerto_embarque text
    constraint proveedores_puerto_embarque_len_check check (puerto_embarque is null or char_length(puerto_embarque) <= 80),
  add column if not exists incoterm text,
  add column if not exists moneda text,
  add column if not exists plazo_produccion_dias integer
    constraint proveedores_plazo_produccion_check check (plazo_produccion_dias is null or plazo_produccion_dias between 0 and 365),
  add column if not exists plazo_transito_dias integer
    constraint proveedores_plazo_transito_check check (plazo_transito_dias is null or plazo_transito_dias between 0 and 180),
  add column if not exists condiciones_pago text
    constraint proveedores_condiciones_pago_len_check check (condiciones_pago is null or char_length(condiciones_pago) <= 200),
  add column if not exists revision integer not null default 0
    constraint proveedores_revision_check check (revision >= 0),
  add column if not exists updated_by_id uuid
    constraint proveedores_updated_by_id_fkey references public.perfiles(id) on delete set null,
  add column if not exists updated_by_nombre text,
  add column if not exists clave_origen text
    constraint proveedores_clave_origen_len_check check (clave_origen is null or char_length(clave_origen) between 1 and 80);

create index if not exists proveedores_updated_by_id_idx on public.proveedores (updated_by_id);
-- Único parcial: dos proveedores sin clave de origen no chocan.
create unique index if not exists proveedores_clave_origen_uidx
  on public.proveedores (clave_origen)
  where clave_origen is not null;

comment on column public.proveedores.puerto_embarque is
  'Puerto habitual de embarque (texto libre con sugerencias). El puerto real de un envio es dato del embarque (08b).';
comment on column public.proveedores.incoterm is
  'Incoterm habitual (catalogo zod). Solo informativo: el costo de una compra es siempre FOB (decision 102).';
comment on column public.proveedores.moneda is
  'Moneda habitual (USD o PEN, catalogo zod). Prellena la moneda de una compra nueva.';
comment on column public.proveedores.revision is
  'Concurrencia optimista de la edicion: guardar_proveedor compara y sube en 1 (409 proveedor_cambio si otro guardo antes).';
comment on column public.proveedores.clave_origen is
  'Clave del registro de origen de una carga (cotv:supplier:{uuid de COTV}). Solo la escribe la carga C1; la API no la recibe ni la devuelve (decision 106).';

-- ---------------------------------------------------------------------------
-- 2. `proveedor_contactos`
-- ---------------------------------------------------------------------------
-- Hasta 20 por proveedor (lo comprueba `guardar_proveedor`) y, como mucho, UNO principal (índice único parcial). Quitar un contacto borra
-- la fila dentro de `guardar_proveedor` (reemplaza la lista en la misma transacción que la ficha): `activo` existe por la convención de
-- PLAN §4 y no tiene uso. El correo se valida con el mismo patrón que usa la carga desde COTV (Q4); zod valida el formato fino.
create table if not exists public.proveedor_contactos (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid not null
    constraint proveedor_contactos_proveedor_id_fkey
      references public.proveedores(id) on delete cascade,
  nombre text not null
    constraint proveedor_contactos_nombre_len_check check (char_length(nombre) between 1 and 120),
  cargo text
    constraint proveedor_contactos_cargo_len_check check (cargo is null or char_length(cargo) <= 80),
  telefono text
    constraint proveedor_contactos_telefono_len_check check (telefono is null or char_length(telefono) <= 40),
  correo text
    constraint proveedor_contactos_correo_len_check check (correo is null or char_length(correo) <= 120)
    constraint proveedor_contactos_correo_formato_check check (correo is null or correo ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  es_principal boolean not null default false,
  orden smallint not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists proveedor_contactos_proveedor_id_idx on public.proveedor_contactos (proveedor_id);
create unique index if not exists proveedor_contactos_principal_uidx
  on public.proveedor_contactos (proveedor_id)
  where es_principal;

create or replace trigger set_updated_at before update on public.proveedor_contactos
  for each row execute function public.tg_set_updated_at();

comment on table public.proveedor_contactos is
  '08c E1: contactos del proveedor (nombre, cargo, telefono, correo). Hasta 20 y, como mucho, uno principal. Se reemplazan junto con la ficha en guardar_proveedor, en una transaccion. Sin datos bancarios.';

-- ---------------------------------------------------------------------------
-- 3. `proveedor_eventos` (historial inmutable, decisión 103)
-- ---------------------------------------------------------------------------
-- Excepción documentada a la convención de tablas, la misma que `compra_eventos`: sin `activo` ni `updated_at` (nunca se edita).
-- `accion` (catálogo zod): crear | editar | desactivar | reactivar | eliminar | importar. `proveedor_nombre` es una copia para que el
-- historial de un proveedor borrado siga legible; `antes` y `despues` son instantáneas de ficha y contactos (nunca banco).
-- `proveedor_id` es `on delete set null`: borrar un proveedor sin compras deja sus eventos con `proveedor_id` nulo.
create table if not exists public.proveedor_eventos (
  id uuid primary key default gen_random_uuid(),
  proveedor_id uuid
    constraint proveedor_eventos_proveedor_id_fkey
      references public.proveedores(id) on delete set null,
  proveedor_nombre text not null
    constraint proveedor_eventos_proveedor_nombre_len_check check (char_length(proveedor_nombre) between 1 and 120),
  accion text not null,
  antes jsonb,
  despues jsonb,
  resumen text
    constraint proveedor_eventos_resumen_len_check check (resumen is null or char_length(resumen) <= 300),
  perfil_id uuid
    constraint proveedor_eventos_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists proveedor_eventos_proveedor_created_idx on public.proveedor_eventos (proveedor_id, created_at desc);
create index if not exists proveedor_eventos_perfil_id_idx on public.proveedor_eventos (perfil_id);

-- Mismo patrón que `tg_compra_agrupador_inmutable` (0032): rechaza DELETE, TRUNCATE (trigger por sentencia: uno por fila no lo cubre)
-- y todo UPDATE salvo el que SOLO pone en NULL `proveedor_id` o `perfil_id` (lo emiten las FK `on delete set null` al borrar un
-- proveedor sin compras o un perfil), con todo lo demás igual. Vale para TODOS los roles, `service_role` incluido. SQLSTATE
-- `restrict_violation`. Las ramas de DELETE y TRUNCATE no tocan `old` ni `new` (en TRUNCATE no existen).
create or replace function public.tg_proveedor_eventos_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.proveedor_id is null or new.proveedor_id is not distinct from old.proveedor_id)
     and (new.perfil_id is null or new.perfil_id is not distinct from old.perfil_id)
     and ((old.proveedor_id is not null and new.proveedor_id is null) or (old.perfil_id is not null and new.perfil_id is null))
     and (to_jsonb(new) - 'proveedor_id' - 'perfil_id') = (to_jsonb(old) - 'proveedor_id' - 'perfil_id') then
    return new;
  end if;
  raise exception '% es un registro inmutable: no admite cambios, borrados ni vaciado', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.tg_proveedor_eventos_inmutable() from public, anon, authenticated;
grant execute on function public.tg_proveedor_eventos_inmutable() to service_role;

comment on function public.tg_proveedor_eventos_inmutable() is
  '08c E1: trigger de proveedor_eventos. Rechaza delete, truncate y todo update salvo el que solo pone proveedor_id o perfil_id en NULL. Vale tambien para service_role.';

create or replace trigger proveedor_eventos_inmutable
  before update or delete on public.proveedor_eventos
  for each row execute function public.tg_proveedor_eventos_inmutable();
create or replace trigger proveedor_eventos_sin_vaciado
  before truncate on public.proveedor_eventos
  for each statement execute function public.tg_proveedor_eventos_inmutable();

comment on table public.proveedor_eventos is
  '08c E1: historial de cambios del proveedor, insert-only (decision 103). Triggers contra update, delete y truncate, tambien para service_role; excepcion: proveedor_id o perfil_id a NULL (FK set null). antes y despues son instantaneas de ficha y contactos. Un proveedor cargado desde COTV tiene un evento importar.';

-- ---------------------------------------------------------------------------
-- 4. `compra_lineas`: descripción y modelo
-- ---------------------------------------------------------------------------
-- `descripcion` dice qué es el producto y sale al proveedor en la proforma externa; `nota` (0025) es un comentario interno y no sale.
-- Las escribe `editar_ficha_linea` (con el candado de la línea y `p_antes`, sin tocar `compras.revision`, decisión 88) y, más adelante,
-- `editar_linea` de 0.13.1.
alter table public.compra_lineas
  add column if not exists descripcion text
    constraint compra_lineas_descripcion_len_check check (descripcion is null or char_length(descripcion) <= 200),
  add column if not exists modelo text
    constraint compra_lineas_modelo_len_check check (modelo is null or char_length(modelo) <= 60);

comment on column public.compra_lineas.descripcion is
  'Que es el producto (<= 200). Sale en la proforma externa; no es nota. Solo la escriben funciones (editar_ficha_linea).';
comment on column public.compra_lineas.modelo is
  'Codigo o estilo del proveedor (<= 60). Solo la escriben funciones (editar_ficha_linea).';

-- ---------------------------------------------------------------------------
-- 5. `compra_linea_fotos`
-- ---------------------------------------------------------------------------
-- `id` es también el nombre del objeto en Storage. `ruta` y `ruta_miniatura` se arman con ids, nunca con nombres: el `check` fija el
-- formato exacto `compras/{compra_id}/{linea_id}/{id}.jpg` (y `_min.jpg`), así una ruta no puede salirse de su carpeta ni apuntar al
-- objeto de otra foto. Nunca salen por la API. `compra_id` copia la de la línea (la función exige que coincida) para filtrar sin unir.
-- Una fila no se borra jamás: quitar = `activo = false` con `quitada_*` (por eso `service_role` no tiene delete, ver privilegios).
-- `origen_foto_id`: foto de la versión cancelada de la que esta es copia («Traer fotos de la versión cancelada»). `clave_origen`:
-- `cotv:photo:{id}` de la carga C2; único global SIN filtrar por `activo` (una foto de COTV que alguien quitó no se vuelve a cargar).
create table if not exists public.compra_linea_fotos (
  id uuid primary key default gen_random_uuid(),
  linea_id uuid not null
    constraint compra_linea_fotos_linea_id_fkey
      references public.compra_lineas(id) on delete restrict,
  compra_id uuid not null
    constraint compra_linea_fotos_compra_id_fkey
      references public.compras(id) on delete restrict,
  ruta text not null
    constraint compra_linea_fotos_ruta_check
      check (ruta = 'compras/' || compra_id::text || '/' || linea_id::text || '/' || id::text || '.jpg'),
  ruta_miniatura text not null
    constraint compra_linea_fotos_ruta_miniatura_check
      check (ruta_miniatura = 'compras/' || compra_id::text || '/' || linea_id::text || '/' || id::text || '_min.jpg'),
  ancho smallint not null
    constraint compra_linea_fotos_ancho_check check (ancho between 1 and 800),
  alto smallint not null
    constraint compra_linea_fotos_alto_check check (alto between 1 and 800),
  bytes integer not null
    constraint compra_linea_fotos_bytes_check check (bytes between 1 and 409600),
  bytes_miniatura integer not null
    constraint compra_linea_fotos_bytes_miniatura_check check (bytes_miniatura between 1 and 61440),
  subida_por_id uuid
    constraint compra_linea_fotos_subida_por_id_fkey
      references public.perfiles(id) on delete set null,
  subida_por_nombre text,
  quitada_at timestamptz,
  quitada_por_id uuid
    constraint compra_linea_fotos_quitada_por_id_fkey
      references public.perfiles(id) on delete set null,
  quitada_por_nombre text,
  activo boolean not null default true,
  origen_foto_id uuid
    constraint compra_linea_fotos_origen_foto_id_fkey
      references public.compra_linea_fotos(id) on delete restrict,
  clave_origen text
    constraint compra_linea_fotos_clave_origen_len_check check (clave_origen is null or char_length(clave_origen) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compra_linea_fotos_quitada_check check (activo or quitada_at is not null),
  constraint compra_linea_fotos_ruta_key unique (ruta),
  constraint compra_linea_fotos_ruta_miniatura_key unique (ruta_miniatura)
);

-- Índices parciales: lo que se consulta es lo activo. La principal de una línea es la activa más antigua.
create index if not exists compra_linea_fotos_linea_created_idx on public.compra_linea_fotos (linea_id, created_at) where activo;
create index if not exists compra_linea_fotos_compra_idx on public.compra_linea_fotos (compra_id) where activo;
create index if not exists compra_linea_fotos_created_idx on public.compra_linea_fotos (created_at desc) where activo;
-- Las FK a perfiles y la autorreferencia llevan su índice (borrar un perfil o una foto no debe recorrer la tabla).
create index if not exists compra_linea_fotos_subida_por_id_idx on public.compra_linea_fotos (subida_por_id);
create index if not exists compra_linea_fotos_quitada_por_id_idx on public.compra_linea_fotos (quitada_por_id);
create index if not exists compra_linea_fotos_origen_foto_id_idx on public.compra_linea_fotos (origen_foto_id) where origen_foto_id is not null;
-- Traer dos veces no duplica: una foto de origen solo puede estar una vez ACTIVA en la línea destino.
create unique index if not exists compra_linea_fotos_traida_uidx
  on public.compra_linea_fotos (linea_id, origen_foto_id)
  where activo and origen_foto_id is not null;
-- Idempotencia de la carga C2.
create unique index if not exists compra_linea_fotos_clave_origen_uidx
  on public.compra_linea_fotos (clave_origen)
  where clave_origen is not null;

create or replace trigger set_updated_at before update on public.compra_linea_fotos
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_linea_fotos is
  '08c E1: fotos de las lineas de compra (hasta 3 activas por linea). El objeto vive en el bucket privado compras-fotos (ruta con ids). No toca compras.revision ni compra_eventos (decision 88). Una fila nunca se borra: quitar = activo false con quitada_*.';
comment on column public.compra_linea_fotos.ruta is
  'compras/{compra_id}/{linea_id}/{id}.jpg. Nunca sale por la API.';
comment on column public.compra_linea_fotos.origen_foto_id is
  'Foto de la version cancelada de la que esta es copia (Traer fotos de la version cancelada, decision 104).';
comment on column public.compra_linea_fotos.clave_origen is
  'cotv:photo:{uuid de COTV}. Unico global, sin filtrar por activo. Solo la escribe la carga C2 por agregar_foto_linea (decision 106).';

-- >>> TROZO 2 (bucket)
-- ---------------------------------------------------------------------------
-- 6. Bucket privado `compras-fotos`
-- ---------------------------------------------------------------------------
-- Privado, solo JPEG y 400 KB como máximo (la foto; la miniatura pesa ≤ 60 KB). `on conflict do nothing`: si el bucket ya existe no se
-- toca. NINGUNA política en `storage.objects`: con el RLS que Supabase ya tiene activo, nadie con `anon` o `authenticated` lee, sube
-- ni borra; solo `service_role`, desde los route handlers (`supabaseAdmin()`).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('compras-fotos', 'compras-fotos', false, 409600, array['image/jpeg'])
on conflict (id) do nothing;

-- >>> TROZO 3 (proveedor_foto y guardar_proveedor)
-- ---------------------------------------------------------------------------
-- 7. Funciones de proveedores
-- ---------------------------------------------------------------------------
-- 7.1 `proveedor_foto(p_proveedor)`: instantánea de la ficha y los contactos (la que van `antes` y `despues` de `proveedor_eventos`).
-- Nunca banco ni `clave_origen` ni `revision`. Ayudante de `guardar_proveedor`, `cambiar_activo_proveedor` y `eliminar_proveedor`;
-- las mismas claves arman el `v_nuevo` con que `guardar_proveedor` decide si un guardado cambia algo.
create or replace function public.proveedor_foto(p_proveedor uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'nombre', p.nombre,
    'codigo', p.codigo,
    'pais', p.pais,
    'region', p.region,
    'ciudad', p.ciudad,
    'direccion', p.direccion,
    'identificacion', p.identificacion,
    'es_intercompany', p.es_intercompany,
    'puerto_embarque', p.puerto_embarque,
    'incoterm', p.incoterm,
    'moneda', p.moneda,
    'plazo_produccion_dias', p.plazo_produccion_dias,
    'plazo_transito_dias', p.plazo_transito_dias,
    'condiciones_pago', p.condiciones_pago,
    'nota', p.nota,
    'activo', p.activo,
    'contactos', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'nombre', k.nombre,
                  'cargo', k.cargo,
                  'telefono', k.telefono,
                  'correo', k.correo,
                  'es_principal', k.es_principal,
                  'orden', k.orden)
                order by k.orden, k.created_at, k.id)
         from public.proveedor_contactos k
         where k.proveedor_id = p.id),
      '[]'::jsonb)
  )
  from public.proveedores p
  where p.id = p_proveedor;
$$;

revoke execute on function public.proveedor_foto(uuid) from public, anon, authenticated;
grant execute on function public.proveedor_foto(uuid) to service_role;

comment on function public.proveedor_foto(uuid) is
  '08c E1: instantanea jsonb de la ficha y los contactos de un proveedor (nunca banco, clave_origen ni revision). Es el antes y el despues de proveedor_eventos. Solo service_role.';

-- 7.2 `guardar_proveedor(p_id, p_revision, p_proveedor, p_contactos, p_actor)`: crea o edita la ficha y reemplaza los contactos en la
-- MISMA transacción. Un contacto inválido a mitad (nombre vacío, correo mal formado) lanza el `check` de la tabla y no queda ni la
-- ficha ni los contactos cambiados (R13).
--   p_id nulo: CREA. Con `p_proveedor.clave_origen` (solo la carga C1) y un proveedor que ya la tiene: no escribe y responde
--     `ya_cargado` con su `proveedor_id`. Con `p_actor.origen = 'carga_cotv'` el evento es `importar` («Carga desde COTV»).
--   p_id con valor: EDITA. Bloquea la fila (`for update`), compara `p_revision` y, si cambió algo, actualiza la ficha, reemplaza los
--     contactos (solo si cambiaron), sube `revision` y `updated_by_*` y deja UN evento `editar`. Un guardado sin cambios no escribe
--     evento ni sube `revision` (`sin_cambios: true`).
--   p_proveedor: SIEMPRE la ficha completa (reemplazo: una clave ausente o vacía queda nula). Excepción: `es_intercompany` ausente se
--     conserva. `nombre` es obligatorio (1 a 120). `clave_origen` solo cuenta al crear. Banco y cuenta no existen.
--   p_contactos: arreglo de `{ nombre, cargo, telefono, correo, es_principal }` (hasta 20, a lo sumo un principal; si ninguno lo es,
--     el primero pasa a principal). `[]` quita todos; NULL en una edición los conserva (al crear equivale a `[]`).
-- Motivos: ficha_invalida (no es objeto o falta el nombre), contactos_invalidos (no es arreglo, más de 20 o más de un principal),
-- solo_planner_intercompany (rol `comprador` cambiando `es_intercompany`), no_encontrado, proveedor_cambio (con `revision` actual),
-- nombre_repetido y codigo_repetido (con `conflicto { id, nombre, activo }`), ya_cargado. Lo que se rechaza no deja nada escrito.
create or replace function public.guardar_proveedor(
  p_id uuid,
  p_revision integer,
  p_proveedor jsonb,
  p_contactos jsonb,
  p_actor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := coalesce(nullif(p_actor ->> 'perfil_id', ''), nullif(p_actor ->> 'id', ''))::uuid;
  v_actor text := nullif(btrim(p_actor ->> 'nombre'), '');
  v_rol text := p_actor ->> 'rol';
  v_carga boolean := coalesce(p_actor ->> 'origen', '') = 'carga_cotv';
  v_prov public.proveedores%rowtype;
  v_id uuid;
  v_revision integer;
  v_nombre text;
  v_codigo text;
  v_pais text;
  v_region text;
  v_ciudad text;
  v_direccion text;
  v_identificacion text;
  v_intercompany boolean;
  v_puerto text;
  v_incoterm text;
  v_moneda text;
  v_produccion integer;
  v_transito integer;
  v_pago text;
  v_nota text;
  v_clave text;
  v_principales integer;
  v_contactos jsonb;
  v_antes jsonb;
  v_nuevo jsonb;
  v_despues jsonb;
  v_resumen text;
  v_constraint text;
  v_conflicto jsonb;
begin
  if p_proveedor is null or jsonb_typeof(p_proveedor) <> 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_invalida');
  end if;
  v_nombre := nullif(btrim(p_proveedor ->> 'nombre'), '');
  if v_nombre is null or char_length(v_nombre) > 120 then
    return jsonb_build_object('ok', false, 'motivo', 'ficha_invalida');
  end if;
  v_codigo := nullif(btrim(p_proveedor ->> 'codigo'), '');
  v_pais := nullif(btrim(p_proveedor ->> 'pais'), '');
  v_region := nullif(btrim(p_proveedor ->> 'region'), '');
  v_ciudad := nullif(btrim(p_proveedor ->> 'ciudad'), '');
  v_direccion := nullif(btrim(p_proveedor ->> 'direccion'), '');
  v_identificacion := nullif(btrim(p_proveedor ->> 'identificacion'), '');
  v_intercompany := (p_proveedor ->> 'es_intercompany')::boolean;
  v_puerto := nullif(btrim(p_proveedor ->> 'puerto_embarque'), '');
  v_incoterm := nullif(btrim(p_proveedor ->> 'incoterm'), '');
  v_moneda := nullif(btrim(p_proveedor ->> 'moneda'), '');
  v_produccion := nullif(btrim(p_proveedor ->> 'plazo_produccion_dias'), '')::integer;
  v_transito := nullif(btrim(p_proveedor ->> 'plazo_transito_dias'), '')::integer;
  v_pago := nullif(btrim(p_proveedor ->> 'condiciones_pago'), '');
  v_nota := nullif(btrim(p_proveedor ->> 'nota'), '');
  v_clave := nullif(btrim(p_proveedor ->> 'clave_origen'), '');

  if p_contactos is not null then
    if jsonb_typeof(p_contactos) <> 'array'
       or jsonb_array_length(p_contactos) > 20
       or exists (select 1 from jsonb_array_elements(p_contactos) as e(value) where jsonb_typeof(e.value) <> 'object') then
      return jsonb_build_object('ok', false, 'motivo', 'contactos_invalidos');
    end if;
    select count(*) into v_principales
    from jsonb_array_elements(p_contactos) as e(value)
    where coalesce((e.value ->> 'es_principal')::boolean, false);
    if v_principales > 1 then
      return jsonb_build_object('ok', false, 'motivo', 'contactos_invalidos');
    end if;
    select coalesce(
             jsonb_agg(
               jsonb_build_object(
                 'nombre', x.nombre,
                 'cargo', x.cargo,
                 'telefono', x.telefono,
                 'correo', x.correo,
                 'es_principal', x.es_principal,
                 'orden', x.orden)
               order by x.orden),
             '[]'::jsonb)
    into v_contactos
    from (
      select nullif(btrim(e.value ->> 'nombre'), '') as nombre,
             nullif(btrim(e.value ->> 'cargo'), '') as cargo,
             nullif(btrim(e.value ->> 'telefono'), '') as telefono,
             nullif(btrim(e.value ->> 'correo'), '') as correo,
             case when v_principales = 0 then e.ord = 1 else coalesce((e.value ->> 'es_principal')::boolean, false) end as es_principal,
             (e.ord - 1)::integer as orden
      from jsonb_array_elements(p_contactos) with ordinality as e(value, ord)
    ) x;
  end if;

  if p_id is null then
    if v_clave is not null then
      select p.id into v_id from public.proveedores p where p.clave_origen = v_clave;
      if found then
        return jsonb_build_object('ok', false, 'motivo', 'ya_cargado', 'proveedor_id', v_id);
      end if;
    end if;
    if v_rol = 'comprador' and coalesce(v_intercompany, false) then
      return jsonb_build_object('ok', false, 'motivo', 'solo_planner_intercompany');
    end if;
    begin
      insert into public.proveedores (
        nombre, codigo, pais, region, ciudad, direccion, identificacion, es_intercompany, puerto_embarque, incoterm, moneda,
        plazo_produccion_dias, plazo_transito_dias, condiciones_pago, nota, clave_origen, perfil_id, usuario_nombre,
        updated_by_id, updated_by_nombre, revision)
      values (
        v_nombre, v_codigo, v_pais, v_region, v_ciudad, v_direccion, v_identificacion, coalesce(v_intercompany, false), v_puerto,
        v_incoterm, v_moneda, v_produccion, v_transito, v_pago, v_nota, v_clave, v_perfil, v_actor,
        v_perfil, v_actor, 0)
      returning id into v_id;
      if v_contactos is not null and jsonb_array_length(v_contactos) > 0 then
        insert into public.proveedor_contactos (proveedor_id, nombre, cargo, telefono, correo, es_principal, orden)
        select v_id, k.nombre, k.cargo, k.telefono, k.correo, k.es_principal, k.orden
        from jsonb_to_recordset(v_contactos) as k(
          nombre text, cargo text, telefono text, correo text, es_principal boolean, orden integer);
      end if;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'proveedores_nombre_uniq' then
        select jsonb_build_object('id', x.id, 'nombre', x.nombre, 'activo', x.activo) into v_conflicto
        from public.proveedores x where upper(x.nombre) = upper(v_nombre);
        return jsonb_build_object('ok', false, 'motivo', 'nombre_repetido', 'conflicto', v_conflicto);
      elsif v_constraint = 'proveedores_codigo_uniq' then
        select jsonb_build_object('id', x.id, 'nombre', x.nombre, 'activo', x.activo) into v_conflicto
        from public.proveedores x where upper(x.codigo) = upper(v_codigo);
        return jsonb_build_object('ok', false, 'motivo', 'codigo_repetido', 'conflicto', v_conflicto);
      elsif v_constraint = 'proveedores_clave_origen_uidx' then
        select x.id into v_id from public.proveedores x where x.clave_origen = v_clave;
        return jsonb_build_object('ok', false, 'motivo', 'ya_cargado', 'proveedor_id', v_id);
      end if;
      raise;
    end;
    v_despues := public.proveedor_foto(v_id);
    insert into public.proveedor_eventos (proveedor_id, proveedor_nombre, accion, antes, despues, resumen, perfil_id, usuario_nombre)
    values (
      v_id, v_nombre, case when v_carga then 'importar' else 'crear' end, null, v_despues,
      case when v_carga then 'Carga desde COTV' else left('Proveedor creado: ' || v_nombre, 300) end,
      v_perfil, v_actor);
    return jsonb_build_object(
      'ok', true,
      'proveedor_id', v_id,
      'revision', 0,
      'accion', case when v_carga then 'importar' else 'crear' end,
      'sin_cambios', false);
  end if;

  select * into v_prov from public.proveedores p where p.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if p_revision is null or v_prov.revision <> p_revision then
    return jsonb_build_object('ok', false, 'motivo', 'proveedor_cambio', 'revision', v_prov.revision);
  end if;
  if v_rol = 'comprador' and v_intercompany is not null and v_intercompany <> v_prov.es_intercompany then
    return jsonb_build_object('ok', false, 'motivo', 'solo_planner_intercompany');
  end if;

  v_intercompany := coalesce(v_intercompany, v_prov.es_intercompany);
  v_antes := public.proveedor_foto(p_id);
  if v_contactos is null then
    v_contactos := v_antes -> 'contactos';
  end if;
  v_nuevo := jsonb_build_object(
    'nombre', v_nombre,
    'codigo', v_codigo,
    'pais', v_pais,
    'region', v_region,
    'ciudad', v_ciudad,
    'direccion', v_direccion,
    'identificacion', v_identificacion,
    'es_intercompany', v_intercompany,
    'puerto_embarque', v_puerto,
    'incoterm', v_incoterm,
    'moneda', v_moneda,
    'plazo_produccion_dias', v_produccion,
    'plazo_transito_dias', v_transito,
    'condiciones_pago', v_pago,
    'nota', v_nota,
    'activo', v_prov.activo,
    'contactos', v_contactos);
  if v_nuevo = v_antes then
    return jsonb_build_object(
      'ok', true,
      'proveedor_id', p_id,
      'revision', v_prov.revision,
      'accion', 'editar',
      'sin_cambios', true);
  end if;

  begin
    update public.proveedores
    set nombre = v_nombre,
        codigo = v_codigo,
        pais = v_pais,
        region = v_region,
        ciudad = v_ciudad,
        direccion = v_direccion,
        identificacion = v_identificacion,
        es_intercompany = v_intercompany,
        puerto_embarque = v_puerto,
        incoterm = v_incoterm,
        moneda = v_moneda,
        plazo_produccion_dias = v_produccion,
        plazo_transito_dias = v_transito,
        condiciones_pago = v_pago,
        nota = v_nota,
        revision = revision + 1,
        updated_by_id = v_perfil,
        updated_by_nombre = v_actor
    where id = p_id
    returning revision into v_revision;
    if (v_nuevo -> 'contactos') is distinct from (v_antes -> 'contactos') then
      delete from public.proveedor_contactos where proveedor_id = p_id;
      insert into public.proveedor_contactos (proveedor_id, nombre, cargo, telefono, correo, es_principal, orden)
      select p_id, k.nombre, k.cargo, k.telefono, k.correo, k.es_principal, k.orden
      from jsonb_to_recordset(v_contactos) as k(
        nombre text, cargo text, telefono text, correo text, es_principal boolean, orden integer);
    end if;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'proveedores_nombre_uniq' then
      select jsonb_build_object('id', x.id, 'nombre', x.nombre, 'activo', x.activo) into v_conflicto
      from public.proveedores x where upper(x.nombre) = upper(v_nombre) and x.id <> p_id;
      return jsonb_build_object('ok', false, 'motivo', 'nombre_repetido', 'conflicto', v_conflicto);
    elsif v_constraint = 'proveedores_codigo_uniq' then
      select jsonb_build_object('id', x.id, 'nombre', x.nombre, 'activo', x.activo) into v_conflicto
      from public.proveedores x where upper(x.codigo) = upper(v_codigo) and x.id <> p_id;
      return jsonb_build_object('ok', false, 'motivo', 'codigo_repetido', 'conflicto', v_conflicto);
    end if;
    raise;
  end;

  v_despues := public.proveedor_foto(p_id);
  select string_agg(
           case when k.key = 'contactos' then 'contactos modificados'
                else k.key || ': ' || coalesce(v_antes ->> k.key, '—') || ' → ' || coalesce(v_despues ->> k.key, '—') end,
           '; ' order by k.key)
  into v_resumen
  from jsonb_object_keys(v_despues) as k(key)
  where (v_antes -> k.key) is distinct from (v_despues -> k.key);
  insert into public.proveedor_eventos (proveedor_id, proveedor_nombre, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (p_id, v_nombre, 'editar', v_antes, v_despues, left('Cambios: ' || coalesce(v_resumen, ''), 300), v_perfil, v_actor);

  return jsonb_build_object(
    'ok', true,
    'proveedor_id', p_id,
    'revision', v_revision,
    'accion', 'editar',
    'sin_cambios', false);
end;
$$;

revoke execute on function public.guardar_proveedor(uuid, integer, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.guardar_proveedor(uuid, integer, jsonb, jsonb, jsonb) to service_role;

comment on function public.guardar_proveedor(uuid, integer, jsonb, jsonb, jsonb) is
  '08c E1: crea o edita un proveedor y reemplaza sus contactos en una transaccion, con revision (proveedor_cambio), unicos de nombre y codigo atrapados, clave_origen idempotente (ya_cargado) y un evento por guardado con cambios. Sin cambios no escribe ni sube revision. Solo service_role.';

-- >>> TROZO 4 (cambiar_activo_proveedor y eliminar_proveedor)
-- 7.3 `cambiar_activo_proveedor(p_id, p_activo, p_actor)`: desactiva o reactiva. Si ya está en ese estado no escribe (`sin_cambios`).
-- Sube `revision` (quien tiene la ficha abierta recibe `proveedor_cambio` al guardar) y deja el evento `desactivar` o `reactivar`.
-- Motivos: no_encontrado, activo_invalido (`p_activo` nulo).
create or replace function public.cambiar_activo_proveedor(p_id uuid, p_activo boolean, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := coalesce(nullif(p_actor ->> 'perfil_id', ''), nullif(p_actor ->> 'id', ''))::uuid;
  v_actor text := nullif(btrim(p_actor ->> 'nombre'), '');
  v_prov public.proveedores%rowtype;
  v_antes jsonb;
  v_revision integer;
begin
  if p_activo is null then
    return jsonb_build_object('ok', false, 'motivo', 'activo_invalido');
  end if;
  select * into v_prov from public.proveedores p where p.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  if v_prov.activo = p_activo then
    return jsonb_build_object('ok', true, 'proveedor_id', p_id, 'revision', v_prov.revision, 'activo', v_prov.activo, 'sin_cambios', true);
  end if;
  v_antes := public.proveedor_foto(p_id);
  update public.proveedores
  set activo = p_activo,
      revision = revision + 1,
      updated_by_id = v_perfil,
      updated_by_nombre = v_actor
  where id = p_id
  returning revision into v_revision;
  insert into public.proveedor_eventos (proveedor_id, proveedor_nombre, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (
    p_id, v_prov.nombre, case when p_activo then 'reactivar' else 'desactivar' end, v_antes, public.proveedor_foto(p_id),
    case when p_activo then 'Proveedor reactivado' else 'Proveedor desactivado' end, v_perfil, v_actor);
  return jsonb_build_object('ok', true, 'proveedor_id', p_id, 'revision', v_revision, 'activo', p_activo, 'sin_cambios', false);
end;
$$;

revoke execute on function public.cambiar_activo_proveedor(uuid, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.cambiar_activo_proveedor(uuid, boolean, jsonb) to service_role;

comment on function public.cambiar_activo_proveedor(uuid, boolean, jsonb) is
  '08c E1: desactiva o reactiva un proveedor. Sube revision y deja el evento desactivar o reactivar; sin cambio de estado no escribe. Solo service_role.';

-- 7.4 `eliminar_proveedor(p_id, p_actor)`: lo borra (con sus contactos, en cascada) si NO tiene ninguna compra, de ningún estado; si
-- tiene, lo desactiva. Es la regla `accionEliminarProveedor` de M8. El evento `eliminar` se inserta ANTES del borrado: la FK `on delete
-- set null` deja después sus eventos (este y los anteriores) con `proveedor_id` nulo y `proveedor_nombre` intacto. Bloquear la fila
-- (`for update`) serializa contra quien inserte una compra de este proveedor (la FK de `compras` toma `for key share`).
-- Respuesta: `{ ok, proveedor_id, accion: 'borrado' | 'desactivado' }`. Motivos: no_encontrado.
create or replace function public.eliminar_proveedor(p_id uuid, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := coalesce(nullif(p_actor ->> 'perfil_id', ''), nullif(p_actor ->> 'id', ''))::uuid;
  v_actor text := nullif(btrim(p_actor ->> 'nombre'), '');
  v_prov public.proveedores%rowtype;
  v_antes jsonb;
begin
  select * into v_prov from public.proveedores p where p.id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrado');
  end if;
  v_antes := public.proveedor_foto(p_id);
  if exists (select 1 from public.compras c where c.proveedor_id = p_id) then
    if v_prov.activo then
      update public.proveedores
      set activo = false,
          revision = revision + 1,
          updated_by_id = v_perfil,
          updated_by_nombre = v_actor
      where id = p_id;
      insert into public.proveedor_eventos (proveedor_id, proveedor_nombre, accion, antes, despues, resumen, perfil_id, usuario_nombre)
      values (
        p_id, v_prov.nombre, 'desactivar', v_antes, public.proveedor_foto(p_id),
        'Tenía compras: se desactivó en lugar de eliminarse', v_perfil, v_actor);
    end if;
    return jsonb_build_object('ok', true, 'proveedor_id', p_id, 'accion', 'desactivado');
  end if;
  insert into public.proveedor_eventos (proveedor_id, proveedor_nombre, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (p_id, v_prov.nombre, 'eliminar', v_antes, null, 'Proveedor eliminado: ' || left(v_prov.nombre, 200), v_perfil, v_actor);
  delete from public.proveedores where id = p_id;
  return jsonb_build_object('ok', true, 'proveedor_id', p_id, 'accion', 'borrado');
end;
$$;

revoke execute on function public.eliminar_proveedor(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.eliminar_proveedor(uuid, jsonb) to service_role;

comment on function public.eliminar_proveedor(uuid, jsonb) is
  '08c E1: borra un proveedor sin compras (contactos en cascada; sus eventos quedan con proveedor_id nulo) o, si tiene alguna compra de cualquier estado, lo desactiva. Deja el evento eliminar (antes del borrado) o desactivar. Solo service_role.';

-- >>> TROZO 5 (agregar_foto_linea y quitar_foto_linea)
-- ---------------------------------------------------------------------------
-- 8. Funciones de fotos y ficha de la línea
-- ---------------------------------------------------------------------------
-- Contrato común de las cuatro (agregar, quitar, traer y editar ficha): validan sin locks; luego toman la compra `FOR KEY SHARE` y la
-- línea `FOR UPDATE` (en ese orden, ver CANDADOS arriba); no leen ni suben `compras.revision` y no tocan `compra_eventos` salvo
-- `editar_ficha_linea` (decisión 88). Lo que se rechaza no deja nada escrito. `no_pertenece` cubre tanto la línea que no es de la
-- compra como la que no existe.

-- 8.1 `agregar_foto_linea(p_compra, p_linea, p_foto, p_actor)`.
--   p_foto = { id, ancho, alto, bytes, bytes_miniatura, clave_origen? }. `id` lo genera la API ANTES de subir (es el nombre de los dos
--   objetos); la función arma `ruta` y `ruta_miniatura` con ids y las devuelve para que el servicio compruebe que subió a esas. Si
--   `p_foto` trae `ruta` o `ruta_miniatura` y no coinciden → `ruta_invalida`. `clave_origen` (≤ 80) solo la manda la carga C2: si ya
--   hay una fila con esa clave (en cualquier línea, activa o quitada), no escribe y responde `ya_cargada` con su `foto_id`.
--   Comprueba que la línea es de la compra y que está activa y la compra no cancelada, y que hay menos de 3 fotos activas (el candado
--   de la línea serializa dos llamadas a la vez). Una compra en borrador, recibida o con saldo cerrado sí admite fotos.
--   Devuelve `{ ok, foto_id, ruta, ruta_miniatura, activas, foto: { id, linea_id, compra_id, ancho, alto, bytes, bytes_miniatura,
--   subida_por_id, subida_por_nombre, created_at } }`; con `ok = false` la API borra los dos objetos que subió.
-- Motivos: foto_invalida (id, tamaños o clave fuera de rango), ruta_invalida, no_pertenece, ya_cargada, no_editable, max_fotos.
create or replace function public.agregar_foto_linea(p_compra uuid, p_linea uuid, p_foto jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := coalesce(nullif(p_actor ->> 'perfil_id', ''), nullif(p_actor ->> 'id', ''))::uuid;
  v_actor text := nullif(btrim(p_actor ->> 'nombre'), '');
  v_estado text;
  v_linea public.compra_lineas%rowtype;
  v_id uuid;
  v_ancho integer;
  v_alto integer;
  v_bytes integer;
  v_bytes_min integer;
  v_clave text;
  v_ruta text;
  v_ruta_min text;
  v_existente uuid;
  v_activas integer;
  v_creada timestamptz;
  v_constraint text;
begin
  if p_foto is null or jsonb_typeof(p_foto) <> 'object' then
    return jsonb_build_object('ok', false, 'motivo', 'foto_invalida');
  end if;
  begin
    v_id := (p_foto ->> 'id')::uuid;
    v_ancho := (p_foto ->> 'ancho')::integer;
    v_alto := (p_foto ->> 'alto')::integer;
    v_bytes := (p_foto ->> 'bytes')::integer;
    v_bytes_min := (p_foto ->> 'bytes_miniatura')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    return jsonb_build_object('ok', false, 'motivo', 'foto_invalida');
  end;
  v_clave := nullif(btrim(p_foto ->> 'clave_origen'), '');
  if v_id is null
     or v_ancho is null or v_ancho not between 1 and 800
     or v_alto is null or v_alto not between 1 and 800
     or v_bytes is null or v_bytes not between 1 and 409600
     or v_bytes_min is null or v_bytes_min not between 1 and 61440
     or (v_clave is not null and char_length(v_clave) > 80) then
    return jsonb_build_object('ok', false, 'motivo', 'foto_invalida');
  end if;
  v_ruta := 'compras/' || p_compra::text || '/' || p_linea::text || '/' || v_id::text || '.jpg';
  v_ruta_min := 'compras/' || p_compra::text || '/' || p_linea::text || '/' || v_id::text || '_min.jpg';
  if ((p_foto ->> 'ruta') is not null and (p_foto ->> 'ruta') <> v_ruta)
     or ((p_foto ->> 'ruta_miniatura') is not null and (p_foto ->> 'ruta_miniatura') <> v_ruta_min) then
    return jsonb_build_object('ok', false, 'motivo', 'ruta_invalida');
  end if;

  select c.estado into v_estado from public.compras c where c.id = p_compra for key share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  select * into v_linea from public.compra_lineas l where l.id = p_linea and l.compra_id = p_compra for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  if v_clave is not null then
    select f.id into v_existente from public.compra_linea_fotos f where f.clave_origen = v_clave;
    if found then
      return jsonb_build_object('ok', false, 'motivo', 'ya_cargada', 'foto_id', v_existente);
    end if;
  end if;
  if v_estado = 'cancelada' or not v_linea.activo then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  select count(*) into v_activas from public.compra_linea_fotos f where f.linea_id = p_linea and f.activo;
  if v_activas >= 3 then
    return jsonb_build_object('ok', false, 'motivo', 'max_fotos');
  end if;

  begin
    insert into public.compra_linea_fotos (
      id, linea_id, compra_id, ruta, ruta_miniatura, ancho, alto, bytes, bytes_miniatura,
      subida_por_id, subida_por_nombre, clave_origen)
    values (v_id, p_linea, p_compra, v_ruta, v_ruta_min, v_ancho, v_alto, v_bytes, v_bytes_min, v_perfil, v_actor, v_clave)
    returning created_at into v_creada;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'compra_linea_fotos_clave_origen_uidx' then
      select f.id into v_existente from public.compra_linea_fotos f where f.clave_origen = v_clave;
      return jsonb_build_object('ok', false, 'motivo', 'ya_cargada', 'foto_id', v_existente);
    end if;
    raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'foto_id', v_id,
    'ruta', v_ruta,
    'ruta_miniatura', v_ruta_min,
    'activas', v_activas + 1,
    'foto', jsonb_build_object(
      'id', v_id,
      'linea_id', p_linea,
      'compra_id', p_compra,
      'ancho', v_ancho,
      'alto', v_alto,
      'bytes', v_bytes,
      'bytes_miniatura', v_bytes_min,
      'subida_por_id', v_perfil,
      'subida_por_nombre', v_actor,
      'created_at', v_creada));
end;
$$;

revoke execute on function public.agregar_foto_linea(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.agregar_foto_linea(uuid, uuid, jsonb, jsonb) to service_role;

comment on function public.agregar_foto_linea(uuid, uuid, jsonb, jsonb) is
  '08c E1: registra una foto de una linea (el servicio ya subio los dos objetos). Bloquea la compra for key share y la linea for update (no toca compras.revision ni compra_eventos), comprueba pertenencia, linea activa, compra no cancelada y maximo 3 activas, y arma las rutas con ids. clave_origen idempotente (ya_cargada). Solo service_role.';

-- 8.2 `quitar_foto_linea(p_compra, p_linea, p_foto, p_actor)`: pone `activo = false` y `quitada_*`. En una compra cancelada solo quita
-- `p_actor.rol = 'admin'` (así el admin retira una foto equivocada de una compra ya cancelada); sin `rol` rige `no_editable`. Una línea
-- inactiva sí admite quitar. Devuelve `ruta` y `ruta_miniatura` para que la API borre los objetos con `.remove()` (si falla, queda para
-- la limpieza de `fotos_huerfanas`). Motivos: no_pertenece (la foto no es de esa línea y compra, o no existe), no_editable, ya_quitada.
create or replace function public.quitar_foto_linea(p_compra uuid, p_linea uuid, p_foto uuid, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := coalesce(nullif(p_actor ->> 'perfil_id', ''), nullif(p_actor ->> 'id', ''))::uuid;
  v_actor text := nullif(btrim(p_actor ->> 'nombre'), '');
  v_rol text := p_actor ->> 'rol';
  v_estado text;
  v_foto public.compra_linea_fotos%rowtype;
begin
  select c.estado into v_estado from public.compras c where c.id = p_compra for key share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  perform 1 from public.compra_lineas l where l.id = p_linea and l.compra_id = p_compra for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  select * into v_foto from public.compra_linea_fotos f
  where f.id = p_foto and f.linea_id = p_linea and f.compra_id = p_compra;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  if v_estado = 'cancelada' and v_rol is distinct from 'admin' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if not v_foto.activo then
    return jsonb_build_object('ok', false, 'motivo', 'ya_quitada');
  end if;
  update public.compra_linea_fotos
  set activo = false,
      quitada_at = now(),
      quitada_por_id = v_perfil,
      quitada_por_nombre = v_actor
  where id = p_foto;
  return jsonb_build_object(
    'ok', true,
    'foto_id', p_foto,
    'ruta', v_foto.ruta,
    'ruta_miniatura', v_foto.ruta_miniatura,
    'activas', (select count(*) from public.compra_linea_fotos f where f.linea_id = p_linea and f.activo));
end;
$$;

revoke execute on function public.quitar_foto_linea(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.quitar_foto_linea(uuid, uuid, uuid, jsonb) to service_role;

comment on function public.quitar_foto_linea(uuid, uuid, uuid, jsonb) is
  '08c E1: quita una foto (activo false, quitada_*) y devuelve las dos rutas para que la API borre los objetos. En compra cancelada solo si p_actor.rol es admin. No toca compras.revision ni compra_eventos. Solo service_role.';

-- >>> TROZO 6 (traer_fotos_linea y editar_ficha_linea)
-- 8.3 `traer_fotos_linea(p_compra, p_linea, p_origen, p_fotos, p_actor)` (decisión 104): trae a la línea DESTINO (`p_linea`) fotos de
-- la línea `p_origen` de una compra CANCELADA del mismo proveedor y con la misma `clave_importacion` (la que pone el importador; una
-- línea manual no tiene clave y da `sin_origen`). El servicio ya copió cada foto activa del origen en Storage a rutas nuevas y manda
--   p_fotos = [{ id (el nuevo, el de la copia), origen_foto_id (la foto de la línea origen) }]
-- Las dimensiones y los bytes se leen de la foto de origen (copia idéntica), no de lo que mande el servicio. La función decide cuáles
-- entran: salta las que ya están ACTIVAS en el destino (`saltadas`), y de las demás acepta las más antiguas del origen hasta llegar a 3
-- activas; el resto va a `descartadas` (también las `origen_foto_id` que ya no son una foto activa del origen). Respuesta:
--   { ok: true, traidas: [{ id, origen_foto_id, ruta, ruta_miniatura }], saltadas, descartadas: [uuid de las copias que NO entraron,
--     para que la API borre esos objetos], activas }
-- Traer dos veces no duplica (la segunda: `traidas = []`, `saltadas = n`). Una foto traída no hereda `clave_origen`; guarda el vínculo
-- en `origen_foto_id`. Sus `created_at` conservan el orden del origen (microsegundo a microsegundo desde `now()`): la principal sigue
-- siendo la más antigua. Las fotos del origen no cambian. Con `ok = false` la API borra TODAS las copias.
-- Motivos: foto_invalida (no es arreglo, vacío, ids repetidos o un `id` que ya existe), no_pertenece, no_editable, sin_origen, max_fotos
-- (hay fotos por traer pero la línea ya tiene 3 activas).
create or replace function public.traer_fotos_linea(p_compra uuid, p_linea uuid, p_origen uuid, p_fotos jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := coalesce(nullif(p_actor ->> 'perfil_id', ''), nullif(p_actor ->> 'id', ''))::uuid;
  v_actor text := nullif(btrim(p_actor ->> 'nombre'), '');
  v_estado text;
  v_proveedor uuid;
  v_linea public.compra_lineas%rowtype;
  v_origen public.compra_lineas%rowtype;
  v_origen_estado text;
  v_origen_proveedor uuid;
  v_activas integer;
  v_cupo integer;
  v_validas integer;
  v_nuevas integer;
  v_aceptadas uuid[];
  v_descartadas uuid[];
  v_traidas jsonb;
begin
  if p_fotos is null or jsonb_typeof(p_fotos) <> 'array' or jsonb_array_length(p_fotos) = 0
     or exists (select 1 from jsonb_array_elements(p_fotos) as e(value) where jsonb_typeof(e.value) <> 'object') then
    return jsonb_build_object('ok', false, 'motivo', 'foto_invalida');
  end if;
  begin
    if (select count(distinct x.id) <> count(*) or bool_or(x.id is null or x.origen_foto_id is null)
          from jsonb_to_recordset(p_fotos) as x(id uuid, origen_foto_id uuid)) then
      return jsonb_build_object('ok', false, 'motivo', 'foto_invalida');
    end if;
  exception when invalid_text_representation then
    return jsonb_build_object('ok', false, 'motivo', 'foto_invalida');
  end;
  if exists (
    select 1 from public.compra_linea_fotos f
    where f.id in (select x.id from jsonb_to_recordset(p_fotos) as x(id uuid))
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'foto_invalida');
  end if;

  select c.estado, c.proveedor_id into v_estado, v_proveedor from public.compras c where c.id = p_compra for key share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  select * into v_linea from public.compra_lineas l where l.id = p_linea and l.compra_id = p_compra for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  if v_estado = 'cancelada' or not v_linea.activo then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;

  select * into v_origen from public.compra_lineas l where l.id = p_origen;
  if not found or p_origen = p_linea then
    return jsonb_build_object('ok', false, 'motivo', 'sin_origen');
  end if;
  select c.estado, c.proveedor_id into v_origen_estado, v_origen_proveedor from public.compras c where c.id = v_origen.compra_id;
  if v_origen_estado is distinct from 'cancelada'
     or v_origen_proveedor is distinct from v_proveedor
     or v_origen.clave_importacion is null
     or v_origen.clave_importacion is distinct from v_linea.clave_importacion then
    return jsonb_build_object('ok', false, 'motivo', 'sin_origen');
  end if;

  select count(*) into v_validas
  from jsonb_to_recordset(p_fotos) as x(id uuid, origen_foto_id uuid)
  join public.compra_linea_fotos o on o.id = x.origen_foto_id and o.linea_id = p_origen and o.activo;
  if v_validas = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_origen');
  end if;

  select count(*) into v_activas from public.compra_linea_fotos f where f.linea_id = p_linea and f.activo;
  v_cupo := greatest(3 - v_activas, 0);

  select count(*) into v_nuevas
  from jsonb_to_recordset(p_fotos) as x(id uuid, origen_foto_id uuid)
  join public.compra_linea_fotos o on o.id = x.origen_foto_id and o.linea_id = p_origen and o.activo
  where not exists (
    select 1 from public.compra_linea_fotos t where t.linea_id = p_linea and t.activo and t.origen_foto_id = o.id);
  if v_nuevas > 0 and v_cupo = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'max_fotos');
  end if;

  select coalesce(array_agg(c.nuevo_id order by c.rn), '{}'::uuid[]) into v_aceptadas
  from (
    select x.id as nuevo_id, row_number() over (order by o.created_at, o.id) as rn
    from jsonb_to_recordset(p_fotos) as x(id uuid, origen_foto_id uuid)
    join public.compra_linea_fotos o on o.id = x.origen_foto_id and o.linea_id = p_origen and o.activo
    where not exists (
      select 1 from public.compra_linea_fotos t where t.linea_id = p_linea and t.activo and t.origen_foto_id = o.id)
  ) c
  where c.rn <= v_cupo;

  select coalesce(array_agg(x.id), '{}'::uuid[]) into v_descartadas
  from jsonb_to_recordset(p_fotos) as x(id uuid)
  where x.id <> all (v_aceptadas);

  with cand as (
    select x.id as nuevo_id, o.id as origen_id, o.ancho, o.alto, o.bytes, o.bytes_miniatura,
           row_number() over (order by o.created_at, o.id) as rn
    from jsonb_to_recordset(p_fotos) as x(id uuid, origen_foto_id uuid)
    join public.compra_linea_fotos o on o.id = x.origen_foto_id and o.linea_id = p_origen and o.activo
    where not exists (
      select 1 from public.compra_linea_fotos t where t.linea_id = p_linea and t.activo and t.origen_foto_id = o.id)
  ),
  ins as (
    insert into public.compra_linea_fotos (
      id, linea_id, compra_id, ruta, ruta_miniatura, ancho, alto, bytes, bytes_miniatura,
      subida_por_id, subida_por_nombre, origen_foto_id, created_at)
    select c.nuevo_id, p_linea, p_compra,
           'compras/' || p_compra::text || '/' || p_linea::text || '/' || c.nuevo_id::text || '.jpg',
           'compras/' || p_compra::text || '/' || p_linea::text || '/' || c.nuevo_id::text || '_min.jpg',
           c.ancho, c.alto, c.bytes, c.bytes_miniatura, v_perfil, v_actor, c.origen_id,
           now() + (c.rn * interval '1 microsecond')
    from cand c
    where c.nuevo_id = any (v_aceptadas)
    returning id, origen_foto_id, ruta, ruta_miniatura, created_at
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('id', i.id, 'origen_foto_id', i.origen_foto_id, 'ruta', i.ruta, 'ruta_miniatura', i.ruta_miniatura)
           order by i.created_at),
         '[]'::jsonb)
  into v_traidas
  from ins i;

  return jsonb_build_object(
    'ok', true,
    'traidas', v_traidas,
    'saltadas', v_validas - v_nuevas,
    'descartadas', to_jsonb(v_descartadas),
    'activas', v_activas + coalesce(array_length(v_aceptadas, 1), 0));
end;
$$;

revoke execute on function public.traer_fotos_linea(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.traer_fotos_linea(uuid, uuid, uuid, jsonb, jsonb) to service_role;

comment on function public.traer_fotos_linea(uuid, uuid, uuid, jsonb, jsonb) is
  '08c E1 (decision 104): trae a una linea las fotos activas de la misma linea (misma clave_importacion y proveedor) de una compra cancelada. Registra las copias que hizo el servicio hasta 3 activas, salta las ya traidas y devuelve las copias descartadas para que la API las borre. No toca compras.revision ni compra_eventos. Solo service_role.';

-- 8.4 `editar_ficha_linea(p_compra, p_linea, p_antes, p_descripcion, p_modelo, p_actor)` (decisión 88): escribe `descripcion` y
-- `modelo` de UNA línea sin leer ni subir `compras.revision`. Candado de la línea y comparación de los valores guardados con
-- `p_antes = { descripcion, modelo }` (con `is distinct from`, textos recortados y vacío = nulo): si alguno cambió, `linea_cambio` sin
-- escribir (devuelve `actual`). Por qué no la `revision` de la compra: Fotos tiene una tarjeta por línea; con la revisión de la compra,
-- editar una descripción, asignar la compra a un viaje (08b) o confirmar un ingreso dejaría viejas las copias de las otras tarjetas y
-- daría 409 falsos. Si coinciden y hay cambios, actualiza e inserta el evento `editar_linea` con `antes`, `despues` y el `resumen`
-- («descripción: — → Jean slim azul medio»); el evento mueve la huella del flujo una vez (cuenta eventos) sin cambiar cifras. Si no hay
-- cambios, responde `sin_cambios` y no escribe. Los largos (200 y 60) los exigen los `check` de la tabla (zod los valida antes).
-- Motivos: linea_cambio, no_pertenece, no_editable (línea inactiva o compra cancelada).
create or replace function public.editar_ficha_linea(
  p_compra uuid,
  p_linea uuid,
  p_antes jsonb,
  p_descripcion text,
  p_modelo text,
  p_actor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := coalesce(nullif(p_actor ->> 'perfil_id', ''), nullif(p_actor ->> 'id', ''))::uuid;
  v_actor text := nullif(btrim(p_actor ->> 'nombre'), '');
  v_estado text;
  v_linea public.compra_lineas%rowtype;
  v_antes_desc text := nullif(btrim(p_antes ->> 'descripcion'), '');
  v_antes_mod text := nullif(btrim(p_antes ->> 'modelo'), '');
  v_desc text := nullif(btrim(p_descripcion), '');
  v_mod text := nullif(btrim(p_modelo), '');
  v_resumen text;
begin
  select c.estado into v_estado from public.compras c where c.id = p_compra for key share;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  select * into v_linea from public.compra_lineas l where l.id = p_linea and l.compra_id = p_compra for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;
  if v_estado = 'cancelada' or not v_linea.activo then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if v_linea.descripcion is distinct from v_antes_desc or v_linea.modelo is distinct from v_antes_mod then
    return jsonb_build_object(
      'ok', false,
      'motivo', 'linea_cambio',
      'actual', jsonb_build_object('descripcion', v_linea.descripcion, 'modelo', v_linea.modelo));
  end if;
  if v_linea.descripcion is not distinct from v_desc and v_linea.modelo is not distinct from v_mod then
    return jsonb_build_object(
      'ok', true,
      'linea_id', p_linea,
      'descripcion', v_linea.descripcion,
      'modelo', v_linea.modelo,
      'sin_cambios', true);
  end if;

  select string_agg(t.texto, '; ' order by t.orden)
  into v_resumen
  from (
    select 1 as orden, 'descripción: ' || coalesce(v_linea.descripcion, '—') || ' → ' || coalesce(v_desc, '—') as texto
    where v_linea.descripcion is distinct from v_desc
    union all
    select 2, 'modelo: ' || coalesce(v_linea.modelo, '—') || ' → ' || coalesce(v_mod, '—')
    where v_linea.modelo is distinct from v_mod
  ) t;

  update public.compra_lineas set descripcion = v_desc, modelo = v_mod where id = p_linea;

  insert into public.compra_eventos (compra_id, linea_id, accion, antes, despues, resumen, perfil_id, usuario_nombre)
  values (
    p_compra,
    p_linea,
    'editar_linea',
    jsonb_build_object('descripcion', v_linea.descripcion, 'modelo', v_linea.modelo),
    jsonb_build_object('descripcion', v_desc, 'modelo', v_mod),
    left(v_resumen, 300),
    v_perfil,
    v_actor);

  return jsonb_build_object(
    'ok', true,
    'linea_id', p_linea,
    'descripcion', v_desc,
    'modelo', v_mod,
    'sin_cambios', false);
end;
$$;

revoke execute on function public.editar_ficha_linea(uuid, uuid, jsonb, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.editar_ficha_linea(uuid, uuid, jsonb, text, text, jsonb) to service_role;

comment on function public.editar_ficha_linea(uuid, uuid, jsonb, text, text, jsonb) is
  '08c E1 (decision 88): escribe descripcion y modelo de una linea con el candado de la linea y los valores previos (p_antes), sin leer ni subir compras.revision (linea_cambio si cambiaron). Deja el evento editar_linea. Solo service_role.';

-- >>> TROZO 7 (fotos_huerfanas, RLS, privilegios y registro)
-- 8.5 `fotos_huerfanas(p_horas, p_limite)`: SOLO LECTURA (`stable`). Cruza `storage.objects` del bucket `compras-fotos` con
-- `compra_linea_fotos` y devuelve `{ sin_fila: text[], quitadas: text[] }`:
--   (a) `sin_fila`: objetos sin ninguna fila (ni por `ruta` ni por `ruta_miniatura`) con `created_at` de hace más de `p_horas` (una
--       subida en curso, que sube los objetos ANTES de registrar la fila, queda fuera);
--   (b) `quitadas`: `ruta` y `ruta_miniatura` de filas con `activo = false` y `quitada_at` de hace más de `p_horas` cuyo objeto SIGUE
--       existiendo (falló el `.remove()` que sigue a `quitar_foto_linea`).
-- Como mucho `p_limite` nombres en total (primero (a), el resto para (b)); nunca el objeto de una fila activa. No borra nada: borra la
-- API con `.remove()` (los objetos no se borran por SQL: `protect_objects_delete`). Va en SQL porque `list` de Storage no es recursivo
-- y las rutas tienen tres niveles. `p_horas` debe ser >= 0 y `p_limite` >= 1; si no, lanza `invalid_parameter_value`.
create or replace function public.fotos_huerfanas(p_horas integer, p_limite integer default 1000)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_limite_hasta timestamptz;
  v_sin_fila text[];
  v_quitadas text[];
begin
  if p_horas is null or p_horas < 0 or p_limite is null or p_limite < 1 then
    raise exception 'fotos_huerfanas: p_horas debe ser >= 0 y p_limite >= 1' using errcode = 'invalid_parameter_value';
  end if;
  v_limite_hasta := now() - make_interval(hours => p_horas);

  select coalesce(array_agg(t.name), '{}'::text[]) into v_sin_fila
  from (
    select o.name
    from storage.objects o
    where o.bucket_id = 'compras-fotos'
      and o.created_at < v_limite_hasta
      and not exists (select 1 from public.compra_linea_fotos f where f.ruta = o.name or f.ruta_miniatura = o.name)
    order by o.created_at, o.name
    limit p_limite
  ) t;

  select coalesce(array_agg(t.name), '{}'::text[]) into v_quitadas
  from (
    select o.name
    from storage.objects o
    join public.compra_linea_fotos f on o.name = f.ruta or o.name = f.ruta_miniatura
    where o.bucket_id = 'compras-fotos'
      and not f.activo
      and f.quitada_at < v_limite_hasta
    order by f.quitada_at, o.name
    limit greatest(p_limite - coalesce(array_length(v_sin_fila, 1), 0), 0)
  ) t;

  return jsonb_build_object('sin_fila', to_jsonb(v_sin_fila), 'quitadas', to_jsonb(v_quitadas));
end;
$$;

revoke execute on function public.fotos_huerfanas(integer, integer) from public, anon, authenticated;
grant execute on function public.fotos_huerfanas(integer, integer) to service_role;

comment on function public.fotos_huerfanas(integer, integer) is
  '08c E1: solo lectura. Objetos del bucket compras-fotos sin fila (mas de p_horas) y objetos de filas quitadas hace mas de p_horas que siguen existiendo; como mucho p_limite nombres. Nunca el objeto de una fila activa. No borra: borra la API con .remove(). Solo service_role.';

-- ---------------------------------------------------------------------------
-- 9. RLS (sin políticas: solo el backend con service_role) y privilegios
-- ---------------------------------------------------------------------------
alter table public.proveedor_contactos enable row level security;
alter table public.proveedor_eventos enable row level security;
alter table public.compra_linea_fotos enable row level security;

-- `revoke all` primero: los privilegios por defecto de 0013 dan `all` a `service_role` en todo objeto nuevo. `references` y `trigger`
-- también se quitan (el dueño crea las FK y los triggers).
--   proveedor_contactos: select, insert, update, delete (`guardar_proveedor` reemplaza la lista; el borrado en cascada de un proveedor
--     lo hace la FK con los privilegios del dueño). Sin truncate.
--   proveedor_eventos: SOLO select e insert (patrón de la 0035): el trigger es la segunda barrera. Las FK `on delete set null` no
--     necesitan UPDATE para service_role (corren con los privilegios del dueño).
--   compra_linea_fotos: select, insert y update; SIN delete ni truncate (una foto nunca se borra, solo se quita).
revoke all on public.proveedor_contactos from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.proveedor_contactos to service_role;

revoke all on public.proveedor_eventos from public, anon, authenticated, service_role;
grant select, insert on public.proveedor_eventos to service_role;

revoke all on public.compra_linea_fotos from public, anon, authenticated, service_role;
grant select, insert, update on public.compra_linea_fotos to service_role;

-- ---------------------------------------------------------------------------
-- 10. Registro de esta migración (convención de la 0035: la última sentencia)
-- ---------------------------------------------------------------------------
insert into public.migraciones_aplicadas (nombre, nota)
values ('0039_proveedores_y_fotos', 'proveedores (ficha, contactos, historial), fotos de lineas, bucket privado compras-fotos y sus funciones (08c E1)')
on conflict (nombre) do nothing;
