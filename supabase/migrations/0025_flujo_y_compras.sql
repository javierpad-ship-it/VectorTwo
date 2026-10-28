-- M8 0.13.0 · Flujo de mercadería y compras: modelo de datos completo, lecturas del flujo y escritura transaccional.
--
-- Ficha: docs/modulos/08-flujo-y-compras.md (§0.1 «qué entra en 0025», §0.11 cancelar cierra el saldo, §0.12 escritura
-- transaccional y auditoría inmutable, §0.13 importador, §6 modelo de datos, §6.9 a §6.11 funciones).
-- Numeración: 0025 (esta) = M8 0.13.0; 0026 queda para 0.13.1 (solo funciones de escritura); 0027 ya la usa 0.12.1 (M6 06d);
-- M9a será la 0028 (`proveedor_contactos` y `compra_linea_mezcla`).
--
-- Qué hace:
--   1. Tablas: `proveedores`, `compras`, `compra_lineas`, `compra_linea_entregas`, `compra_linea_repartos`,
--      `compra_linea_recepciones`, `compra_eventos` y `flujo_parametros`, con TODAS sus columnas (también las que solo usará
--      0.13.1, como `justificacion_exceso` o `excede_tope_al_confirmar`): así 0.13.1 no necesita `add column` sobre tablas
--      con datos reales ni regenerar tipos dos veces.
--   2. Secuencia `compras_numero_seq` (el `numero` legible 'C-000001').
--   3. Lecturas del flujo: `stock_flujo(p_carga_id)` (stock y venta de UN mes, por equivalencia x unidad de marca) y
--      `flujo_huella_base()` (una sola llamada barata que dice si algo de lo que usa el flujo cambió).
--   4. Escritura de compras de 0.13.0, una función plpgsql por operación y UNA transacción por llamada:
--      `importar_compra`, `registrar_recepciones` (también la usa «Aceptar sugerencia»), `quitar_recepcion` y
--      `cancelar_compra`; más dos ayudantes internos: `compra_foto` (instantánea para los eventos) y
--      `compra_recalcular_estado` (recalcula recibidas, canceladas, llegada y estado).
--   5. Auditoría inmutable: el trigger `compra_eventos_inmutable` rechaza todo cambio o borrado de un evento, TAMBIÉN para
--      `service_role` (con el que corre la API: quitarle un permiso no alcanzaría).
--
-- Idempotente: `create table if not exists`, `create sequence if not exists`, `create index if not exists`,
-- `create or replace trigger`, `create or replace function`, `revoke`/`grant`/`comment` repetibles. Sin bloques `do $$ ... $$`
-- (las comillas de dólar del cuerpo de una función no son un bloque anónimo). Sin `drop`, `delete`, `truncate` ni `update` A
-- NIVEL DE MIGRACIÓN (con `execute_sql` esas sentencias se quedan esperando una confirmación que nunca llega); dentro de los
-- cuerpos de las funciones de escritura sí hay `insert`, `update` y `delete` (como en `publicar_carga_venta_stock` de 0007).
-- Sin backfill ni seed: `flujo_parametros` se lee con `coalesce(fila, valores por defecto)`.
--
-- Criterio de la base (ficha §6, «I9»): solo invariantes ESTRUCTURALES (no negativos, primer día de mes,
-- `recibidas + canceladas <= unidades`, longitudes). Los catálogos (`origen`, `estado`, `moneda`, `tallas`, `destino`, `tipo`,
-- `accion`, `temporada`) NO llevan `check`: los valida zod, para poder ampliarlos sin tener que quitar una restricción.
--
-- Seguridad: RLS activo y SIN políticas (solo entra el backend con `service_role`); `revoke` a public, anon y authenticated y
-- `grant` a service_role. Funciones `security invoker`, `search_path` vacío, solo `service_role`.
--
-- Los cuerpos de las funciones van sin comentarios `--` (el SQL Editor de Supabase los parsea mal dentro de `$$`): lo que hay
-- que saber de cada una está aquí, encima.
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 0. Secuencia del número de compra
-- ---------------------------------------------------------------------------
-- 'C-' + 6 dígitos. La secuencia no se reinicia ni se reutiliza: un número saltado (una transacción que falló) es normal.
-- Permisos EXPLÍCITOS (ficha §0.12): `nextval` lo ejecuta el rol que inserta (`service_role`, security invoker).
create sequence if not exists public.compras_numero_seq;

revoke all on sequence public.compras_numero_seq from public, anon, authenticated;
grant usage, select on sequence public.compras_numero_seq to service_role;

-- ---------------------------------------------------------------------------
-- 1. `proveedores`
-- ---------------------------------------------------------------------------
-- En M8 solo se crea desde el importador (`importar_compra`); la pantalla completa es de M9a. Único sobre `upper(nombre)` y
-- sobre `upper(codigo)` (este último solo si hay código). Sin `banco` ni `cuenta_bancaria` (segunda entrega). Un proveedor con
-- compras no se borra: se desactiva (`activo = false`, un inactivo no se ofrece y `importar_compra` lo rechaza).
-- `es_intercompany`: el proveedor es una marca hermana (JH, DONATELLI, VH) cuyas compras entran por el CD.
create table if not exists public.proveedores (
  id uuid primary key default gen_random_uuid(),
  codigo text
    constraint proveedores_codigo_len_check
      check (codigo is null or char_length(codigo) between 1 and 40),
  nombre text not null
    constraint proveedores_nombre_len_check
      check (char_length(nombre) between 1 and 120),
  pais text
    constraint proveedores_pais_len_check
      check (pais is null or char_length(pais) <= 80),
  ciudad text
    constraint proveedores_ciudad_len_check
      check (ciudad is null or char_length(ciudad) <= 80),
  identificacion text
    constraint proveedores_identificacion_len_check
      check (identificacion is null or char_length(identificacion) <= 40),
  es_intercompany boolean not null default false,
  nota text
    constraint proveedores_nota_len_check
      check (nota is null or char_length(nota) <= 300),
  perfil_id uuid
    constraint proveedores_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists proveedores_nombre_uniq
  on public.proveedores (upper(nombre));
-- El código es opcional: el único parcial deja varios proveedores sin código.
create unique index if not exists proveedores_codigo_uniq
  on public.proveedores (upper(codigo))
  where codigo is not null;
create index if not exists proveedores_perfil_id_idx
  on public.proveedores (perfil_id);

create or replace trigger set_updated_at before update on public.proveedores
  for each row execute function public.tg_set_updated_at();

comment on table public.proveedores is
  'M8 0.13.0: proveedores de las compras. Unico sobre upper(nombre) y sobre upper(codigo). En M8 solo los crea el importador; la pantalla completa es de M9a. Un proveedor con compras no se borra: se desactiva.';

-- ---------------------------------------------------------------------------
-- 2. `compras` (cabecera)
-- ---------------------------------------------------------------------------
-- `numero` se asigna solo ('C-000001') y es único. `origen`, `estado` y `moneda` son catálogo en zod (sin check):
--   origen: comprador | carga_inicial | intercompany_cd
--   estado: borrador | confirmada | recibida | cancelada   (0.13.0 no crea borradores; el importador deja `confirmada`)
--   moneda: PEN | USD
-- SALDO CERRADO (ficha §0.11): una compra `recibida` con `cancelada_at` no nulo es una compra a la que se le canceló el saldo
-- pendiente (cada línea guarda `unidades_canceladas = unidades - unidades_recibidas`). Una compra `cancelada` sin recepciones
-- es inmutable y deja de contar.
-- `revision`: versión para la concurrencia. Toda función de escritura bloquea la compra (`for update`), compara la revisión y la
-- sube en 1; si no coincide devuelve `compra_cambio`. Es un entero y no `updated_at`, para no depender de la precisión del
-- `timestamptz` al viajar en JSON. Una compra recién creada por `importar_compra` queda en 0.
-- `perfil_id` / `usuario_nombre`: quién la CREÓ (no «asignada a»); `updated_by_*`: quién la modificó por última vez (el detalle
-- completo está en `compra_eventos`). Los nombres se copian para que el historial sobreviva si se elimina el perfil.
-- Una compra NUNCA se borra: la FK `restrict` de `compra_eventos` lo impide; se cancela.
create table if not exists public.compras (
  id uuid primary key default gen_random_uuid(),
  numero text not null
    default ('C-' || lpad(nextval('public.compras_numero_seq')::text, 6, '0')),
  proveedor_id uuid not null
    constraint compras_proveedor_id_fkey
      references public.proveedores(id) on delete restrict,
  origen text not null default 'comprador',
  estado text not null default 'borrador',
  -- La API la exige: sin `default current_date`.
  fecha_compra date not null,
  referencia text
    constraint compras_referencia_len_check
      check (referencia is null or char_length(referencia) <= 80),
  moneda text not null default 'PEN',
  nota text
    constraint compras_nota_len_check
      check (nota is null or char_length(nota) <= 500),
  confirmada_at timestamptz,
  confirmada_por_id uuid
    constraint compras_confirmada_por_id_fkey
      references public.perfiles(id) on delete set null,
  confirmada_por_nombre text,
  cancelada_at timestamptz,
  cancelada_por_id uuid
    constraint compras_cancelada_por_id_fkey
      references public.perfiles(id) on delete set null,
  cancelada_por_nombre text,
  motivo_cancelacion text
    constraint compras_motivo_cancelacion_len_check
      check (motivo_cancelacion is null or char_length(motivo_cancelacion) <= 200),
  -- Obligatoria (la API) al confirmar con exceso del tope (decisión 26): aquí queda la última; todas, en `compra_eventos.motivo`.
  justificacion_exceso text
    constraint compras_justificacion_exceso_len_check
      check (justificacion_exceso is null or char_length(justificacion_exceso) <= 300),
  -- Foto del exceso al confirmar: [{ periodo, imi, exceso }].
  excede_tope_al_confirmar jsonb not null default '[]'::jsonb
    constraint compras_excede_tope_check
      check (jsonb_typeof(excede_tope_al_confirmar) = 'array'),
  perfil_id uuid
    constraint compras_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  revision integer not null default 0
    constraint compras_revision_check check (revision >= 0),
  updated_by_id uuid
    constraint compras_updated_by_id_fkey
      references public.perfiles(id) on delete set null,
  updated_by_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compras_numero_key unique (numero)
);

-- Cubren las FK (el advisor marca toda FK sin índice) y los filtros de la lista de Compras.
create index if not exists compras_proveedor_id_idx on public.compras (proveedor_id);
create index if not exists compras_estado_idx on public.compras (estado);
create index if not exists compras_perfil_id_idx on public.compras (perfil_id);
create index if not exists compras_confirmada_por_id_idx on public.compras (confirmada_por_id);
create index if not exists compras_cancelada_por_id_idx on public.compras (cancelada_por_id);
create index if not exists compras_updated_by_id_idx on public.compras (updated_by_id);

create or replace trigger set_updated_at before update on public.compras
  for each row execute function public.tg_set_updated_at();

comment on table public.compras is
  'M8 0.13.0: cabecera de una compra. Nunca se borra (compra_eventos la referencia con restrict): se cancela. Una compra recibida con cancelada_at no nulo tiene el saldo cerrado. Toda mutacion pasa por funciones plpgsql que comparan revision y dejan un evento.';
comment on column public.compras.revision is
  'M8: version para la concurrencia. Cada funcion de escritura bloquea la compra, compara esta revision y la sube en 1; si no coincide responde compra_cambio (409). Una compra creada por importar_compra queda en 0.';
comment on column public.compras.cancelada_at is
  'M8 0.11: con estado recibida significa saldo cerrado (unidades_canceladas > 0 en sus lineas); con estado cancelada, compra cancelada sin recepciones.';

-- ---------------------------------------------------------------------------
-- 3. `compra_lineas`
-- ---------------------------------------------------------------------------
-- `tipo` (zod): especifica | barrer_marca | barrer_mezcla. La API garantiza: específica => GML no nulo y exactamente una de
-- marca o agrupación; barrer_marca => GML nulo, marca no nula (`barrido` o `mixta`) y agrupación nula; barrer_mezcla (M9a) =>
-- GML, marca y agrupación nulos. Por eso las cuatro FK al árbol y a las marcas admiten nulo.
-- `unidades_recibidas` y `unidades_canceladas` SOLO las escriben las funciones de escritura (así los check se validan atómicos y
-- no hace falta un trigger). Pendiente de la línea = unidades - recibidas - canceladas.
-- `llegada_periodo` = la primera entrega de `compra_linea_entregas` (la mantienen las funciones; sirve a filtros e índices).
-- `clave_importacion` (proveedor | referencia | línea, normalizados) y `huella_importacion` (hash del contenido) distinguen
-- `igual` de `cambiada` al reimportar. La clave NO es única en la base: la unicidad entre compras no canceladas la garantiza
-- `importar_compra` bajo candado (una compra cancelada libera su clave, y un único parcial no puede mirar otra tabla).
-- Una línea nunca se borra: se desactiva (`activo = false`, desde 0.13.1).
create table if not exists public.compra_lineas (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null
    constraint compra_lineas_compra_id_fkey
      references public.compras(id) on delete restrict,
  tipo text not null default 'especifica',
  genero_mundo_linea_id uuid
    constraint compra_lineas_genero_mundo_linea_id_fkey
      references public.genero_mundo_linea(id) on delete restrict,
  equivalencia_id uuid
    constraint compra_lineas_equivalencia_id_fkey
      references public.equivalencias(id) on delete restrict,
  marca_id uuid
    constraint compra_lineas_marca_id_fkey
      references public.marcas(id) on delete restrict,
  agrupacion_marca_id uuid
    constraint compra_lineas_agrupacion_marca_id_fkey
      references public.agrupaciones_marca(id) on delete restrict,
  tallas text not null default 'ambas',
  unidades integer not null
    constraint compra_lineas_unidades_check check (unidades > 0),
  unidades_recibidas integer not null default 0
    constraint compra_lineas_recibidas_check
      check (unidades_recibidas >= 0 and unidades_recibidas <= unidades),
  unidades_canceladas integer not null default 0
    constraint compra_lineas_canceladas_check
      check (unidades_canceladas >= 0 and unidades_recibidas + unidades_canceladas <= unidades),
  costo_unitario numeric(12, 4)
    constraint compra_lineas_costo_check
      check (costo_unitario is null or costo_unitario >= 0),
  llegada_periodo date not null
    constraint compra_lineas_llegada_dia1_check
      check (extract(day from llegada_periodo) = 1),
  destino text not null default 'cd',
  tienda_id uuid
    constraint compra_lineas_tienda_id_fkey
      references public.tiendas(id) on delete restrict,
  -- Solo barrer_marca: { generos?, mundos?, lineas? }.
  alcance jsonb not null default '{}'::jsonb
    constraint compra_lineas_alcance_check
      check (jsonb_typeof(alcance) = 'object'),
  clave_importacion text,
  huella_importacion text,
  nota text
    constraint compra_lineas_nota_len_check
      check (nota is null or char_length(nota) <= 200),
  -- Avisos que calcula la API al guardar.
  avisos jsonb not null default '[]'::jsonb
    constraint compra_lineas_avisos_check
      check (jsonb_typeof(avisos) = 'array'),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists compra_lineas_compra_id_idx on public.compra_lineas (compra_id);
create index if not exists compra_lineas_gml_llegada_idx
  on public.compra_lineas (genero_mundo_linea_id, llegada_periodo);
create index if not exists compra_lineas_llegada_idx on public.compra_lineas (llegada_periodo);
create index if not exists compra_lineas_marca_id_idx on public.compra_lineas (marca_id);
-- Cubren las demás FK.
create index if not exists compra_lineas_equivalencia_id_idx on public.compra_lineas (equivalencia_id);
create index if not exists compra_lineas_agrupacion_marca_id_idx on public.compra_lineas (agrupacion_marca_id);
create index if not exists compra_lineas_tienda_id_idx on public.compra_lineas (tienda_id);
-- Parcial: la clave solo existe en lo importado. No único (ver arriba).
create index if not exists compra_lineas_clave_importacion_idx
  on public.compra_lineas (clave_importacion)
  where clave_importacion is not null;

create or replace trigger set_updated_at before update on public.compra_lineas
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_lineas is
  'M8 0.13.0: lineas de una compra (especifica, barrer_marca o, desde M9a, barrer_mezcla). Nunca se borran: se desactivan. unidades_recibidas y unidades_canceladas las escriben solo las funciones de escritura.';
comment on column public.compra_lineas.unidades_canceladas is
  'M8 0.11: saldo cerrado al cancelar una compra con recepciones (unidades - unidades_recibidas). Conserva las unidades originales para el historial y el costo. Pendiente = unidades - recibidas - canceladas.';
comment on column public.compra_lineas.clave_importacion is
  'M8 0.13: proveedor | referencia | linea normalizados (mayusculas y sin espacios sobrantes). No es unica: la unicidad entre compras no canceladas la garantiza importar_compra bajo un candado consultivo.';

-- ---------------------------------------------------------------------------
-- 4. `compra_linea_entregas` (el cronograma de entregas parciales, decisión 31)
-- ---------------------------------------------------------------------------
-- Una entrega por (línea, mes): dos entregas del mismo mes se funden en una. Invariantes que verifican la API y las funciones
-- de escritura: suma de unidades = `compra_lineas.unidades` y al menos una entrega por línea. Las recepciones NO apuntan a una
-- entrega: se asignan FIFO al leer, así una recepción adelantada o atrasada no exige mover el cronograma.
-- `origen` (zod): manual | estacionalidad | importada. Quitar una entrega la borra (la línea entera no se borra nunca).
create table if not exists public.compra_linea_entregas (
  id uuid primary key default gen_random_uuid(),
  linea_id uuid not null
    constraint compra_linea_entregas_linea_id_fkey
      references public.compra_lineas(id) on delete cascade,
  periodo date not null
    constraint compra_linea_entregas_periodo_dia1_check
      check (extract(day from periodo) = 1),
  unidades integer not null
    constraint compra_linea_entregas_unidades_check check (unidades > 0),
  origen text not null default 'manual',
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- También cubre la FK a la línea (`linea_id` va primero).
  constraint compra_linea_entregas_linea_periodo_key unique (linea_id, periodo)
);

create or replace trigger set_updated_at before update on public.compra_linea_entregas
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_linea_entregas is
  'M8 0.13.0: cronograma de entregas de una linea (mes x unidades). Unico por (linea, mes). La suma = unidades de la linea (lo verifican la API y las funciones). Las recepciones se asignan FIFO al leer: no apuntan a una entrega.';

-- ---------------------------------------------------------------------------
-- 5. `compra_linea_repartos` (el reparto guardado de un lote de una marca, por entrega)
-- ---------------------------------------------------------------------------
-- El reparto es POR ENTREGA porque la temporada la decide el mes de recepción. `marca_id` es la unidad de marca de cada fila
-- (la de la línea en `barrer_marca`, la de la fila de mezcla en `barrer_mezcla`). `reparto_id` es la versión de M12 con que se
-- repartió (nulo en mezcla; `restrict`: no se borra una versión que una compra usa). `reparto_cambio` = `reparto_id` distinto del
-- vigente de la marca. La suma por entrega = unidades de la entrega (la verifica la API).
-- El único lleva `coalesce(equivalencia_id, uuid cero)` porque `equivalencia_id` admite nulo y dos NULL no chocan en un UNIQUE.
create table if not exists public.compra_linea_repartos (
  id uuid primary key default gen_random_uuid(),
  linea_id uuid not null
    constraint compra_linea_repartos_linea_id_fkey
      references public.compra_lineas(id) on delete cascade,
  entrega_id uuid not null
    constraint compra_linea_repartos_entrega_id_fkey
      references public.compra_linea_entregas(id) on delete cascade,
  marca_id uuid not null
    constraint compra_linea_repartos_marca_id_fkey
      references public.marcas(id) on delete restrict,
  genero_mundo_linea_id uuid not null
    constraint compra_linea_repartos_genero_mundo_linea_id_fkey
      references public.genero_mundo_linea(id) on delete restrict,
  equivalencia_id uuid
    constraint compra_linea_repartos_equivalencia_id_fkey
      references public.equivalencias(id) on delete restrict,
  unidades integer not null
    constraint compra_linea_repartos_unidades_check check (unidades >= 0),
  reparto_id uuid
    constraint compra_linea_repartos_reparto_id_fkey
      references public.repartos_marca_barrido(id) on delete restrict,
  reparto_version integer,
  temporada text,
  error_reparto_pp numeric(6, 2),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists compra_linea_repartos_clave_uniq
  on public.compra_linea_repartos (
    entrega_id,
    marca_id,
    genero_mundo_linea_id,
    coalesce(equivalencia_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
-- Cubren las FK (la de `entrega_id` ya la cubre el prefijo del único).
create index if not exists compra_linea_repartos_linea_id_idx on public.compra_linea_repartos (linea_id);
create index if not exists compra_linea_repartos_marca_id_idx on public.compra_linea_repartos (marca_id);
create index if not exists compra_linea_repartos_gml_idx on public.compra_linea_repartos (genero_mundo_linea_id);
create index if not exists compra_linea_repartos_equivalencia_id_idx on public.compra_linea_repartos (equivalencia_id);
create index if not exists compra_linea_repartos_reparto_id_idx on public.compra_linea_repartos (reparto_id);

create or replace trigger set_updated_at before update on public.compra_linea_repartos
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_linea_repartos is
  'M8 0.13.0: reparto guardado de un lote (barrer_marca) por entrega, marca y GML. La temporada la decide el mes de recepcion de la entrega. reparto_id = version de M12 usada (restrict). Unico por (entrega, marca, GML, equivalencia con coalesce).';

-- ---------------------------------------------------------------------------
-- 6. `compra_linea_recepciones` («Confirmar ingreso», ficha §0.5)
-- ---------------------------------------------------------------------------
-- Una recepción es la confirmación de que unidades de una línea ingresaron en el mes `recibida_periodo` (X). Si X <= k' esas
-- unidades ya están en el stock publicado y dejan de esperarse; si X > k' suman en X. `origen` (zod): manual | sugerencia |
-- importada. Quitar una recepción la borra dentro de `quitar_recepcion`, que recalcula `unidades_recibidas`; la recepción entera
-- queda en el `antes` del evento. Regla de la API: `recibida_periodo >= mes(fecha_compra)`; `registrar_recepciones` también la
-- aplica (`recepcion_antes_de_compra`).
create table if not exists public.compra_linea_recepciones (
  id uuid primary key default gen_random_uuid(),
  linea_id uuid not null
    constraint compra_linea_recepciones_linea_id_fkey
      references public.compra_lineas(id) on delete cascade,
  recibida_periodo date not null
    constraint compra_linea_recepciones_periodo_dia1_check
      check (extract(day from recibida_periodo) = 1),
  unidades integer not null
    constraint compra_linea_recepciones_unidades_check check (unidades > 0),
  fecha_recepcion date not null,
  origen text not null default 'manual',
  perfil_id uuid
    constraint compra_linea_recepciones_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  nota text
    constraint compra_linea_recepciones_nota_len_check
      check (nota is null or char_length(nota) <= 200),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists compra_linea_recepciones_linea_id_idx on public.compra_linea_recepciones (linea_id);
create index if not exists compra_linea_recepciones_perfil_id_idx on public.compra_linea_recepciones (perfil_id);

create or replace trigger set_updated_at before update on public.compra_linea_recepciones
  for each row execute function public.tg_set_updated_at();

comment on table public.compra_linea_recepciones is
  'M8 0.13.0: confirmaciones de ingreso (recepciones) de una linea en un mes X. Si X <= k prima ya estan en el stock publicado; si X > k prima suman en X. origen: manual, sugerencia (Aceptar sugerencia) o importada. Las escriben solo las funciones de escritura.';

-- ---------------------------------------------------------------------------
-- 7. `compra_eventos` (auditoría inmutable, decisión 28)
-- ---------------------------------------------------------------------------
-- Sin `updated_at` ni `activo`: es un registro inmutable de verdad. `accion` (zod): crear | editar_cabecera | agregar_linea |
-- editar_linea | quitar_linea | confirmar | recibir | quitar_recepcion | cancelar | aplicar_reparto | importar. `antes` / `despues`
-- son instantáneas (`compra_foto`); `motivo` (<= 300) es el motivo de una cancelación, la justificación de un exceso, el motivo de
-- una edición o «sugerencia de conciliación aaaa-mm»; `resumen` (<= 300) es el texto corto del cambio.
-- Las FK a `compras` y `compra_lineas` son `restrict`: una compra o línea con eventos no se borra.
-- Índices: `(compra_id, created_at)` para el historial y `(created_at)` porque `flujo_huella_base()` lee el último evento.
create table if not exists public.compra_eventos (
  id uuid primary key default gen_random_uuid(),
  compra_id uuid not null
    constraint compra_eventos_compra_id_fkey
      references public.compras(id) on delete restrict,
  linea_id uuid
    constraint compra_eventos_linea_id_fkey
      references public.compra_lineas(id) on delete restrict,
  accion text not null,
  antes jsonb,
  despues jsonb,
  motivo text
    constraint compra_eventos_motivo_len_check
      check (motivo is null or char_length(motivo) <= 300),
  resumen text
    constraint compra_eventos_resumen_len_check
      check (resumen is null or char_length(resumen) <= 300),
  perfil_id uuid
    constraint compra_eventos_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists compra_eventos_compra_created_idx on public.compra_eventos (compra_id, created_at);
create index if not exists compra_eventos_created_at_idx on public.compra_eventos (created_at);
create index if not exists compra_eventos_linea_id_idx on public.compra_eventos (linea_id);
create index if not exists compra_eventos_perfil_id_idx on public.compra_eventos (perfil_id);

-- Única excepción: el UPDATE que solo pone `perfil_id` en NULL (lo emite la FK `on delete set null` al borrar un perfil: el
-- historial sobrevive sin el autor; el nombre se conserva en `usuario_nombre`). El DELETE nunca se permite.
-- Trigger de inmutabilidad. Vale para TODOS los roles, `service_role` incluido: la API corre con él, así que un `revoke` no
-- bastaría. (Un borrado en bloque con la sentencia de vaciado de tabla no pasa por un trigger de fila: la API nunca la ejecuta
-- y la migración no la nombra.)
create or replace function public.tg_compra_eventos_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.perfil_id is not null
     and new.perfil_id is null
     and (to_jsonb(new) - 'perfil_id') = (to_jsonb(old) - 'perfil_id') then
    return new;
  end if;
  raise exception 'compra_eventos es un registro inmutable: no admite cambios ni borrados'
    using errcode = 'restrict_violation';
end;
$$;

create or replace trigger compra_eventos_inmutable
  before update or delete on public.compra_eventos
  for each row execute function public.tg_compra_eventos_inmutable();

revoke execute on function public.tg_compra_eventos_inmutable() from public, anon, authenticated;
grant execute on function public.tg_compra_eventos_inmutable() to service_role;

comment on table public.compra_eventos is
  'M8 0.13.0: auditoria de compras, insert-only. El trigger compra_eventos_inmutable rechaza todo cambio o borrado, tambien para service_role. FK restrict a compras y lineas: nada con eventos se borra. antes y despues son instantaneas (compra_foto).';

-- ---------------------------------------------------------------------------
-- 8. `flujo_parametros` (una fila por convención, clave 'global')
-- ---------------------------------------------------------------------------
-- Sin seed: la API lee `coalesce(fila, valores por defecto)` y escribe con `upsert` de una fila. `imi_max >= imi_min` y que las
-- temporadas cubran los doce meses sin solaparse lo valida zod (`motivoTemporadasInvalidas`). M12 lee el mismo valor de
-- `temporadas`.
create table if not exists public.flujo_parametros (
  id uuid primary key default gen_random_uuid(),
  clave text not null default 'global',
  imi_min numeric(4, 1) not null default 4
    constraint flujo_parametros_imi_min_check check (imi_min >= 0),
  imi_max numeric(4, 1) not null default 8
    constraint flujo_parametros_imi_max_check check (imi_max >= 0),
  meses_tarjeta integer not null default 6
    constraint flujo_parametros_meses_tarjeta_check check (meses_tarjeta > 0),
  extender_horizonte boolean not null default true,
  temporadas jsonb not null
    default '{"verano":{"desde_mes":10,"hasta_mes":3},"invierno":{"desde_mes":4,"hasta_mes":9}}'::jsonb
    constraint flujo_parametros_temporadas_check
      check (jsonb_typeof(temporadas) = 'object'),
  umbral_conciliacion_u integer not null default 10
    constraint flujo_parametros_umbral_u_check check (umbral_conciliacion_u >= 0),
  umbral_conciliacion_pct numeric(5, 2) not null default 20
    constraint flujo_parametros_umbral_pct_check check (umbral_conciliacion_pct >= 0),
  perfil_id uuid
    constraint flujo_parametros_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint flujo_parametros_clave_key unique (clave)
);

create index if not exists flujo_parametros_perfil_id_idx on public.flujo_parametros (perfil_id);

create or replace trigger set_updated_at before update on public.flujo_parametros
  for each row execute function public.tg_set_updated_at();

comment on table public.flujo_parametros is
  'M8 0.13.0: parametros del flujo (rango IMI, meses de la tarjeta, horizonte, temporadas, umbrales de conciliacion). Una fila con clave global; sin seed: la API lee coalesce(fila, defaults). temporadas la leen tambien M12 y las entregas de compras.';

-- ---------------------------------------------------------------------------
-- 9. `stock_flujo(p_carga_id uuid)`: stock y venta de UN mes (una carga publicada)
-- ---------------------------------------------------------------------------
-- Un mes por llamada y por carga (una carga publicada no cambia nunca: M8 la guarda en caché por `carga_id`). Agrega las filas de
-- `venta_stock_mensual` de esa carga (entra por el prefijo `carga_id` de la clave primaria) con `tiendas` y `marcas_unidad`
-- (un miembro de un conjunto suma en su cabeza), por (equivalencia, unidad de marca), SIN talla (el desglose por talla es de
-- 0.13.1). Devuelve arreglos compactos para no pasar de unos 0,25 MB por mes:
--   { "carga_id", "periodo" ('aaaa-mm'), "publicada": bool,
--     "equivalencias": [uuid, ...], "marcas": [uuid, ...],     (ordenadas por id; los índices de `filas` son de base 0)
--     "filas": [[i_equivalencia, i_marca, stock_cd, stock_tiendas, unidades, stock_inactivas, unidades_inactivas], ...],
--     "excluido": { "stock": int, "unidades": int } }
-- * `stock_cd` = stock de fin de mes de las ubicaciones ACTIVAS de tipo 'Centro de Distribución'; `stock_tiendas` = el de las
--   ACTIVAS de tipo 'Tienda'. `unidades` = venta del mes de todas las ubicaciones activas (el CD hoy vende 0; sumarlas todas
--   mantiene la identidad stock inicial + ingreso - venta = stock final de la conciliación).
-- * `stock_inactivas` y `unidades_inactivas` = lo mismo de las ubicaciones DESACTIVADAS: el flujo futuro las deja fuera y avisa
--   `stock_en_tiendas_inactivas`; la conciliación sí las suma (si no, cerrar una tienda y pasar su stock al CD parecería un
--   ingreso, ficha §0.15). `excluido` = los totales de esas dos columnas.
-- * Valores crudos: pueden ser negativos (devoluciones, ajustes); M8 los lleva a 0 con aviso.
-- * Si la carga no existe o no está `publicada`: `publicada = false` y `filas` vacío (`periodo` nulo si no existe).
-- MEDICIÓN en Vector2 (set-2026, aplicada el 2026-10-28): 7 762 filas y 287 KB de texto con `stock_flujo`; `flujo_huella_base()` 6,4 KB. Tiempos en frío: los mide `qa`.
-- `stable`, `security invoker`, `search_path` vacío, solo `service_role`.
create or replace function public.stock_flujo(p_carga_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with carga as (
    select c.id, c.periodo, (c.estado = 'publicada') as publicada
    from public.cargas_venta_stock c
    where c.id = p_carga_id
  ),
  agr as (
    select
      v.equivalencia_id,
      mu.unidad_marca_id,
      sum(case when t.activo and t.tipo = 'Centro de Distribución' then v.stock_unidades else 0 end)::bigint as stock_cd,
      sum(case when t.activo and t.tipo = 'Tienda' then v.stock_unidades else 0 end)::bigint as stock_tiendas,
      sum(case when t.activo then v.unidades else 0 end)::bigint as unidades,
      sum(case when t.activo then 0 else v.stock_unidades end)::bigint as stock_inactivas,
      sum(case when t.activo then 0 else v.unidades end)::bigint as unidades_inactivas
    from carga c
    join public.venta_stock_mensual v on v.carga_id = c.id
    join public.tiendas t on t.id = v.tienda_id
    join public.marcas_unidad mu on mu.marca_id = v.marca_id
    where c.publicada
    group by v.equivalencia_id, mu.unidad_marca_id
  ),
  eqs as (
    select d.equivalencia_id, (row_number() over (order by d.equivalencia_id) - 1)::integer as i
    from (select distinct a.equivalencia_id from agr a) d
  ),
  mks as (
    select d.unidad_marca_id, (row_number() over (order by d.unidad_marca_id) - 1)::integer as i
    from (select distinct a.unidad_marca_id from agr a) d
  )
  select jsonb_build_object(
    'carga_id', p_carga_id,
    'periodo', (select to_char(c.periodo, 'YYYY-MM') from carga c),
    'publicada', coalesce((select c.publicada from carga c), false),
    'equivalencias', coalesce((select jsonb_agg(e.equivalencia_id order by e.i) from eqs e), '[]'::jsonb),
    'marcas', coalesce((select jsonb_agg(m.unidad_marca_id order by m.i) from mks m), '[]'::jsonb),
    'filas', coalesce(
      (select jsonb_agg(
                jsonb_build_array(e.i, m.i, a.stock_cd, a.stock_tiendas, a.unidades, a.stock_inactivas, a.unidades_inactivas)
                order by e.i, m.i
              )
         from agr a
         join eqs e on e.equivalencia_id = a.equivalencia_id
         join mks m on m.unidad_marca_id = a.unidad_marca_id),
      '[]'::jsonb),
    'excluido', jsonb_build_object(
      'stock', coalesce((select sum(a.stock_inactivas) from agr a), 0),
      'unidades', coalesce((select sum(a.unidades_inactivas) from agr a), 0)
    )
  );
$$;

revoke execute on function public.stock_flujo(uuid) from public, anon, authenticated;
grant execute on function public.stock_flujo(uuid) to service_role;

comment on function public.stock_flujo(uuid) is
  'M8 0.13.0: stock de fin de mes y venta de UNA carga publicada por (equivalencia, unidad de marca), sin talla. Arreglos compactos: equivalencias, marcas y filas [i_eq, i_marca, stock_cd, stock_tiendas, unidades, stock_inactivas, unidades_inactivas] con indices base 0. Las ubicaciones desactivadas van aparte (excluido). Carga no publicada: publicada false y filas vacio. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 10. `flujo_huella_base()`: ¿cambió algo de lo que usa el flujo?
-- ---------------------------------------------------------------------------
-- Una sola llamada barata (sin escritura) con los marcadores de cada insumo; M8 los combina con el mes de hoy en Lima y la versión
-- del método para formar la huella del cálculo. Es más sensible que necesario, nunca menos:
--   cargas      todas las publicadas { periodo ('aaaa-mm'), carga_id, publicada_at }
--   cerradas    proyecciones cerradas { id, anio_en_curso, updated_at }
--   compras     { eventos: n, ultimo: max(created_at de compra_eventos), revision: sum(compras.revision),
--                 actualizada: max(compras.updated_at) }   (se suma la revisión por si alguien escribiera sin evento)
--   parametros  updated_at de flujo_parametros, o nulo
--   repartos    { vigentes: n, ultima: max(aprobada_at) de las versiones vigentes }
--   reglas      { n, ultima: max(updated_at) } de las reglas intercompany activas
--   config      { marcas, marca_gml_especial, agrupaciones_marca, genero_mundo_linea, equivalencias, tiendas,
--                 responsables_genero_mundo }, cada una como [n, max(updated_at)]
-- `stable`, `security invoker`, `search_path` vacío, solo `service_role`.
create or replace function public.flujo_huella_base()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'cargas', coalesce(
      (select jsonb_agg(
                jsonb_build_object('periodo', to_char(c.periodo, 'YYYY-MM'), 'carga_id', c.id, 'publicada_at', c.publicada_at)
                order by c.periodo)
         from public.cargas_venta_stock c
         where c.estado = 'publicada'),
      '[]'::jsonb),
    'cerradas', coalesce(
      (select jsonb_agg(
                jsonb_build_object('id', p.id, 'anio_en_curso', p.anio_en_curso, 'updated_at', p.updated_at)
                order by p.anio_en_curso, p.id)
         from public.proyecciones p
         where p.estado = 'cerrada'),
      '[]'::jsonb),
    'compras', jsonb_build_object(
      'eventos', (select count(*) from public.compra_eventos),
      'ultimo', (select max(e.created_at) from public.compra_eventos e),
      'revision', (select coalesce(sum(c.revision), 0) from public.compras c),
      'actualizada', (select max(c.updated_at) from public.compras c)
    ),
    'parametros', (select max(fp.updated_at) from public.flujo_parametros fp),
    'repartos', jsonb_build_object(
      'vigentes', (select count(*) from public.repartos_marca_barrido r where r.vigente),
      'ultima', (select max(r.aprobada_at) from public.repartos_marca_barrido r where r.vigente)
    ),
    'reglas', jsonb_build_object(
      'n', (select count(*) from public.intercompany_reglas ir where ir.activo),
      'ultima', (select max(ir.updated_at) from public.intercompany_reglas ir where ir.activo)
    ),
    'config', jsonb_build_object(
      'marcas', (select jsonb_build_array(count(*), max(x.updated_at)) from public.marcas x),
      'marca_gml_especial', (select jsonb_build_array(count(*), max(x.updated_at)) from public.marca_gml_especial x),
      'agrupaciones_marca', (select jsonb_build_array(count(*), max(x.updated_at)) from public.agrupaciones_marca x),
      'genero_mundo_linea', (select jsonb_build_array(count(*), max(x.updated_at)) from public.genero_mundo_linea x),
      'equivalencias', (select jsonb_build_array(count(*), max(x.updated_at)) from public.equivalencias x),
      'tiendas', (select jsonb_build_array(count(*), max(x.updated_at)) from public.tiendas x),
      'responsables_genero_mundo', (select jsonb_build_array(count(*), max(x.updated_at)) from public.responsables_genero_mundo x)
    )
  );
$$;

revoke execute on function public.flujo_huella_base() from public, anon, authenticated;
grant execute on function public.flujo_huella_base() to service_role;

comment on function public.flujo_huella_base() is
  'M8 0.13.0: marcadores baratos de todo lo que usa el flujo (cargas publicadas, proyecciones cerradas, compras, parametros, repartos vigentes, reglas intercompany, configuracion). M8 los combina con el mes de hoy y la version del metodo para formar la huella del calculo. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 11. Ayudantes internos de las funciones de escritura
-- ---------------------------------------------------------------------------
-- 11.1 `compra_foto(p_compra)`: instantánea de una compra para `compra_eventos.antes` / `despues`:
--   { estado, revision, saldo_cerrado, lineas: [{ id, unidades, unidades_recibidas, unidades_canceladas }],
--     recepciones: [{ id, linea_id, recibida_periodo, unidades, fecha_recepcion, origen }] }
-- Es la MISMA forma antes y después, para que el `despues` de un evento coincida con el `antes` del siguiente sobre la misma
-- compra. Solo lectura.
create or replace function public.compra_foto(p_compra uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'estado', c.estado,
    'revision', c.revision,
    'saldo_cerrado', (c.estado = 'recibida' and c.cancelada_at is not null),
    'lineas', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', l.id,
                  'unidades', l.unidades,
                  'unidades_recibidas', l.unidades_recibidas,
                  'unidades_canceladas', l.unidades_canceladas)
                order by l.created_at, l.id)
         from public.compra_lineas l
         where l.compra_id = c.id),
      '[]'::jsonb),
    'recepciones', coalesce(
      (select jsonb_agg(
                jsonb_build_object(
                  'id', r.id,
                  'linea_id', r.linea_id,
                  'recibida_periodo', r.recibida_periodo,
                  'unidades', r.unidades,
                  'fecha_recepcion', r.fecha_recepcion,
                  'origen', r.origen)
                order by r.recibida_periodo, r.created_at, r.id)
         from public.compra_linea_recepciones r
         join public.compra_lineas l on l.id = r.linea_id
         where l.compra_id = c.id),
      '[]'::jsonb)
  )
  from public.compras c
  where c.id = p_compra;
$$;

revoke execute on function public.compra_foto(uuid) from public, anon, authenticated;
grant execute on function public.compra_foto(uuid) to service_role;

comment on function public.compra_foto(uuid) is
  'M8 0.13.0: instantanea de una compra (estado, revision, saldo cerrado, lineas con recibidas y canceladas, recepciones) para los campos antes y despues de compra_eventos. Solo lectura. Solo service_role.';

-- 11.2 `compra_recalcular_estado(p_compra)`: recalcula, dentro de la transacción de quien la llama, lo que depende de las
-- recepciones: `unidades_recibidas` y `unidades_canceladas` de cada línea, `llegada_periodo` (la primera entrega) y el `estado`
-- de la compra. Devuelve el estado resultante (nulo si la compra no existe). NO sube `revision` ni deja evento: eso lo hace cada
-- función de escritura, que es la dueña de la operación.
--   * `borrador` y `cancelada` no cambian de estado.
--   * Compra con saldo cerrado (`cancelada_at` no nulo): cada línea queda con `canceladas = unidades - recibidas` (una recepción
--     tardía consume lo cancelado; quitar una lo devuelve) y el estado es `recibida`, o `cancelada` si no queda ninguna recepción.
--   * Compra normal: `recibida` si todas las líneas activas están recibidas por completo; si no, `confirmada`.
-- `recibidas` y `canceladas` se escriben en UNA sola sentencia: los check `recibidas <= unidades` y
-- `recibidas + canceladas <= unidades` se evalúan por fila al final de cada sentencia y no admitirían un orden intermedio.
create or replace function public.compra_recalcular_estado(p_compra uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_compra public.compras%rowtype;
  v_cerrado boolean;
  v_recibidas bigint;
  v_estado text;
begin
  select * into v_compra from public.compras where id = p_compra;
  if not found then
    return null;
  end if;

  v_cerrado := v_compra.cancelada_at is not null;

  update public.compra_lineas l
  set unidades_recibidas = x.rec,
      unidades_canceladas = case when v_cerrado then l.unidades - x.rec else l.unidades_canceladas end
  from (
    select l2.id, coalesce(sum(r.unidades), 0)::integer as rec
    from public.compra_lineas l2
    left join public.compra_linea_recepciones r on r.linea_id = l2.id
    where l2.compra_id = p_compra
    group by l2.id
  ) x
  where l.id = x.id
    and (l.unidades_recibidas is distinct from x.rec
      or (v_cerrado and l.unidades_canceladas is distinct from l.unidades - x.rec));

  update public.compra_lineas l
  set llegada_periodo = e.primera
  from (
    select en.linea_id, min(en.periodo) as primera
    from public.compra_linea_entregas en
    join public.compra_lineas l2 on l2.id = en.linea_id
    where l2.compra_id = p_compra
    group by en.linea_id
  ) e
  where l.id = e.linea_id
    and l.llegada_periodo is distinct from e.primera;

  if v_compra.estado in ('borrador', 'cancelada') then
    return v_compra.estado;
  end if;

  select coalesce(sum(l.unidades_recibidas), 0) into v_recibidas
  from public.compra_lineas l
  where l.compra_id = p_compra and l.activo;

  if v_cerrado then
    v_estado := case when v_recibidas = 0 then 'cancelada' else 'recibida' end;
  elsif exists (select 1 from public.compra_lineas l where l.compra_id = p_compra and l.activo)
    and not exists (
      select 1 from public.compra_lineas l
      where l.compra_id = p_compra and l.activo and l.unidades_recibidas < l.unidades
    ) then
    v_estado := 'recibida';
  else
    v_estado := 'confirmada';
  end if;

  if v_estado is distinct from v_compra.estado then
    update public.compras set estado = v_estado where id = p_compra;
  end if;

  return v_estado;
end;
$$;

revoke execute on function public.compra_recalcular_estado(uuid) from public, anon, authenticated;
grant execute on function public.compra_recalcular_estado(uuid) to service_role;

comment on function public.compra_recalcular_estado(uuid) is
  'M8 0.13.0: recalcula unidades_recibidas, unidades_canceladas (saldo cerrado), llegada_periodo y estado de una compra dentro de la transaccion de quien la llama. No sube revision ni deja evento: eso lo hace cada funcion de escritura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 12. Funciones de escritura de 0.13.0 (ficha §0.12 y §6.11)
-- ---------------------------------------------------------------------------
-- Contrato común. `returns jsonb`: `{ ok: true, compra_id, revision, estado, ... }` o `{ ok: false, motivo }`. `p_actor` =
-- `{ perfil_id, nombre }`. Cada una, en una sola transacción: (1) bloquea la compra (`for update`) y compara `revision`
-- (distinta => `compra_cambio`); (2) comprueba pertenencia (`no_pertenece`); (3) escribe; (4) recalcula con
-- `compra_recalcular_estado` y sube `revision` en 1 con `updated_by_*`; (5) inserta el evento con `antes` y `despues`.
-- TODA validación de negocio va ANTES de la primera escritura: una función que devuelve `ok = false` no deja nada escrito. Lo que
-- viola un check estructural (p. ej. una entrega con periodo que no es primer día de mes) lanza una excepción y deshace todo.
-- Motivos que devuelven, además de los de la ficha: `no_encontrada` (la compra no existe), `no_confirmada` (recibir sobre un
-- borrador), `sin_recepciones` (lista vacía), `motivo_requerido` (cancelar sin motivo de 1 a 200 caracteres), `sin_lineas`,
-- `entregas_no_cuadran`, `proveedor_requerido`, `proveedor_inexistente` y `saldo_cerrado` (importar una línea nueva a una compra
-- con saldo cerrado).

-- 12.1 `registrar_recepciones`: «Confirmar ingreso» de una o varias líneas de UNA compra.
--   p_recepciones = [{ linea_id, recibida_periodo ('aaaa-mm-01'), unidades, fecha_recepcion ('aaaa-mm-dd'), nota?, origen? }]
--   `origen` por recepción: 'manual' (por defecto) o 'sugerencia' (Aceptar sugerencia). `p_motivo` va al evento (p. ej.
--   «sugerencia de conciliación 2026-10»).
-- Motivos: compra_cambio, no_pertenece, no_editable (cancelada), excede_pendiente, recepcion_antes_de_compra.
-- En una compra con saldo cerrado se puede confirmar un ingreso tardío hasta lo cancelado: la recepción consume
-- `unidades_canceladas` (pasa de cancelado a recibido); `excede_pendiente` ya no cabe cuando `recibidas + nuevas > unidades`.
create or replace function public.registrar_recepciones(
  p_compra uuid,
  p_revision integer,
  p_recepciones jsonb,
  p_actor jsonb,
  p_motivo text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_compra public.compras%rowtype;
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre text := nullif(p_actor ->> 'nombre', '');
  v_antes jsonb;
  v_estado text;
  v_revision integer;
  v_ids uuid[];
  v_lineas uuid[];
  v_total bigint;
begin
  select * into v_compra from public.compras where id = p_compra for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrada');
  end if;
  if v_compra.revision <> p_revision then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;
  if v_compra.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if v_compra.estado = 'borrador' then
    return jsonb_build_object('ok', false, 'motivo', 'no_confirmada');
  end if;
  if p_recepciones is null
     or jsonb_typeof(p_recepciones) <> 'array'
     or jsonb_array_length(p_recepciones) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_recepciones');
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_recepciones) as r(linea_id uuid)
    where not exists (
      select 1 from public.compra_lineas l where l.id = r.linea_id and l.compra_id = p_compra
    )
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_recepciones) as r(recibida_periodo date)
    where r.recibida_periodo < date_trunc('month', v_compra.fecha_compra)::date
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'recepcion_antes_de_compra');
  end if;

  if exists (
    select 1
    from public.compra_lineas l
    join (
      select r.linea_id, sum(r.unidades) as nuevas
      from jsonb_to_recordset(p_recepciones) as r(linea_id uuid, unidades integer)
      group by r.linea_id
    ) n on n.linea_id = l.id
    where l.unidades_recibidas + n.nuevas > l.unidades
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'excede_pendiente');
  end if;

  v_antes := public.compra_foto(p_compra);

  with ins as (
    insert into public.compra_linea_recepciones
      (linea_id, recibida_periodo, unidades, fecha_recepcion, origen, perfil_id, usuario_nombre, nota)
    select r.linea_id, r.recibida_periodo, r.unidades, r.fecha_recepcion,
           coalesce(r.origen, 'manual'), v_perfil, v_nombre, r.nota
    from jsonb_to_recordset(p_recepciones) as r(
      linea_id uuid, recibida_periodo date, unidades integer, fecha_recepcion date, nota text, origen text
    )
    returning id, linea_id, unidades
  )
  select array_agg(ins.id), array_agg(distinct ins.linea_id), sum(ins.unidades)
  into v_ids, v_lineas, v_total
  from ins;

  v_estado := public.compra_recalcular_estado(p_compra);

  update public.compras
  set revision = revision + 1,
      updated_by_id = v_perfil,
      updated_by_nombre = v_nombre
  where id = p_compra
  returning revision into v_revision;

  insert into public.compra_eventos
    (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
  values (
    p_compra,
    case when array_length(v_lineas, 1) = 1 then v_lineas[1] else null end,
    'recibir',
    v_antes,
    public.compra_foto(p_compra),
    nullif(btrim(p_motivo), ''),
    format('Ingreso confirmado: %s u en %s recepcion(es)', v_total, array_length(v_ids, 1)),
    v_perfil,
    v_nombre
  );

  return jsonb_build_object(
    'ok', true,
    'compra_id', p_compra,
    'revision', v_revision,
    'estado', v_estado,
    'recepcion_ids', to_jsonb(v_ids)
  );
end;
$$;

revoke execute on function public.registrar_recepciones(uuid, integer, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.registrar_recepciones(uuid, integer, jsonb, jsonb, text) to service_role;

comment on function public.registrar_recepciones(uuid, integer, jsonb, jsonb, text) is
  'M8 0.13.0: confirmar ingreso (recepciones) de una o varias lineas de una compra, en una transaccion. Bloquea la compra, compara revision, comprueba pertenencia, mes de la compra y excedente, inserta, recalcula estado y deja el evento recibir. Devuelve ok o un motivo. Solo service_role.';

-- 12.2 `quitar_recepcion`: borra UNA recepción (la recepción entera queda en el `antes` del evento).
-- Motivos: compra_cambio, no_pertenece (la recepción no es de una línea de esta compra), no_editable (cancelada).
-- En una compra con saldo cerrado, quitarla devuelve las unidades a lo cancelado; si no queda ninguna recepción, la compra pasa
-- a `cancelada`. En una compra normal, una `recibida` vuelve a `confirmada`.
create or replace function public.quitar_recepcion(
  p_compra uuid,
  p_recepcion uuid,
  p_revision integer,
  p_actor jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_compra public.compras%rowtype;
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre text := nullif(p_actor ->> 'nombre', '');
  v_rec public.compra_linea_recepciones%rowtype;
  v_antes jsonb;
  v_estado text;
  v_revision integer;
begin
  select * into v_compra from public.compras where id = p_compra for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrada');
  end if;
  if v_compra.revision <> p_revision then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;
  if v_compra.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;

  select r.* into v_rec
  from public.compra_linea_recepciones r
  join public.compra_lineas l on l.id = r.linea_id
  where r.id = p_recepcion and l.compra_id = p_compra;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_pertenece');
  end if;

  v_antes := public.compra_foto(p_compra);

  delete from public.compra_linea_recepciones where id = p_recepcion;

  v_estado := public.compra_recalcular_estado(p_compra);

  update public.compras
  set revision = revision + 1,
      updated_by_id = v_perfil,
      updated_by_nombre = v_nombre
  where id = p_compra
  returning revision into v_revision;

  insert into public.compra_eventos
    (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
  values (
    p_compra,
    v_rec.linea_id,
    'quitar_recepcion',
    v_antes,
    public.compra_foto(p_compra),
    null,
    format('Ingreso quitado: %s u de %s', v_rec.unidades, to_char(v_rec.recibida_periodo, 'YYYY-MM')),
    v_perfil,
    v_nombre
  );

  return jsonb_build_object(
    'ok', true,
    'compra_id', p_compra,
    'revision', v_revision,
    'estado', v_estado
  );
end;
$$;

revoke execute on function public.quitar_recepcion(uuid, uuid, integer, jsonb) from public, anon, authenticated;
grant execute on function public.quitar_recepcion(uuid, uuid, integer, jsonb) to service_role;

comment on function public.quitar_recepcion(uuid, uuid, integer, jsonb) is
  'M8 0.13.0: quita una recepcion en una transaccion (bloquea la compra, compara revision, comprueba pertenencia, recalcula estado, deja el evento quitar_recepcion con la foto completa). Con saldo cerrado devuelve las unidades a lo cancelado; sin recepciones la compra pasa a cancelada. Solo service_role.';

-- 12.3 `cancelar_compra`: cancela una compra (ficha §0.11).
--   * Estado `recibida` (todo llegó, o saldo ya cerrado) => motivo `recibida`: no hay saldo que cancelar.
--   * Sin recepciones => `cancelada` (inmutable; todo deja de contar y libera la clave de importación de sus líneas).
--   * Con recepciones => cierra el saldo: cada línea `canceladas = unidades - recibidas`, la compra queda `recibida` con
--     `cancelada_at` lleno; las recepciones siguen valiendo.
-- `p_motivo` obligatorio (1 a 200 caracteres sin contar espacios de los bordes). Motivos: compra_cambio, recibida, no_editable
-- (ya cancelada), motivo_requerido.
create or replace function public.cancelar_compra(
  p_compra uuid,
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
  v_compra public.compras%rowtype;
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre text := nullif(p_actor ->> 'nombre', '');
  v_motivo text := btrim(p_motivo);
  v_antes jsonb;
  v_estado text;
  v_recibidas bigint;
  v_canceladas bigint;
  v_revision integer;
begin
  select * into v_compra from public.compras where id = p_compra for update;
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'no_encontrada');
  end if;
  if v_compra.revision <> p_revision then
    return jsonb_build_object('ok', false, 'motivo', 'compra_cambio');
  end if;
  if v_compra.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'motivo', 'no_editable');
  end if;
  if v_compra.estado = 'recibida' then
    return jsonb_build_object('ok', false, 'motivo', 'recibida');
  end if;
  if v_motivo is null or char_length(v_motivo) not between 1 and 200 then
    return jsonb_build_object('ok', false, 'motivo', 'motivo_requerido');
  end if;

  v_antes := public.compra_foto(p_compra);

  select coalesce(sum(l.unidades_recibidas), 0) into v_recibidas
  from public.compra_lineas l
  where l.compra_id = p_compra;

  update public.compras
  set cancelada_at = now(),
      cancelada_por_id = v_perfil,
      cancelada_por_nombre = v_nombre,
      motivo_cancelacion = v_motivo,
      estado = case when v_recibidas = 0 then 'cancelada' else estado end
  where id = p_compra;

  if v_recibidas = 0 then
    v_estado := 'cancelada';
    v_canceladas := 0;
  else
    v_estado := public.compra_recalcular_estado(p_compra);
    select coalesce(sum(l.unidades_canceladas), 0) into v_canceladas
    from public.compra_lineas l
    where l.compra_id = p_compra;
  end if;

  update public.compras
  set revision = revision + 1,
      updated_by_id = v_perfil,
      updated_by_nombre = v_nombre
  where id = p_compra
  returning revision into v_revision;

  insert into public.compra_eventos
    (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
  values (
    p_compra,
    null,
    'cancelar',
    v_antes,
    public.compra_foto(p_compra),
    v_motivo,
    case
      when v_recibidas = 0 then 'Compra cancelada'
      else format('Saldo cancelado: %s u; la compra queda recibida (%s u recibidas)', v_canceladas, v_recibidas)
    end,
    v_perfil,
    v_nombre
  );

  return jsonb_build_object(
    'ok', true,
    'compra_id', p_compra,
    'revision', v_revision,
    'estado', v_estado,
    'unidades_canceladas', v_canceladas
  );
end;
$$;

revoke execute on function public.cancelar_compra(uuid, integer, text, jsonb) from public, anon, authenticated;
grant execute on function public.cancelar_compra(uuid, integer, text, jsonb) to service_role;

comment on function public.cancelar_compra(uuid, integer, text, jsonb) is
  'M8 0.13.0 (ficha 0.11): cancela una compra en una transaccion. Sin recepciones queda cancelada; con recepciones cierra el saldo (canceladas = unidades - recibidas) y queda recibida con cancelada_at; todo recibido devuelve el motivo recibida. Exige motivo de 1 a 200 caracteres. Deja el evento cancelar. Solo service_role.';

-- 12.4 `importar_compra`: carga inicial de UNA compra (ficha §0.13), todo o nada.
--   p_compra = {
--     proveedor_id?: uuid, proveedor_nombre?: text, proveedor_es_intercompany?: bool,   (uno de los dos primeros)
--     referencia?: text, fecha_compra: 'aaaa-mm-dd', moneda?: 'PEN', nota?: text,
--     origen?: 'carga_inicial', estado?: 'confirmada',
--     lineas: [{
--       clave_importacion?: text, huella_importacion?: text, tipo?: 'especifica', genero_mundo_linea_id?, equivalencia_id?,
--       marca_id?, agrupacion_marca_id?, tallas?: 'ambas', unidades: int, costo_unitario?: numeric, destino?: 'cd',
--       tienda_id?, alcance?: {}, nota?, avisos?: [],
--       entregas: [{ periodo: 'aaaa-mm-01', unidades: int, origen?: 'importada' }],
--       repartos?: [{ entrega_periodo: 'aaaa-mm-01', marca_id, genero_mundo_linea_id, equivalencia_id?, unidades,
--                     reparto_id?, reparto_version?, temporada?, error_reparto_pp? }],
--       recepciones?: [{ recibida_periodo: 'aaaa-mm-01', unidades, fecha_recepcion: 'aaaa-mm-dd', nota? }]
--     }] }
-- Qué hace, bajo un candado consultivo GLOBAL de importación (`pg_advisory_xact_lock`: dos importaciones nunca corren a la vez y
-- las comprobaciones de clave son seguras): (1) valida todo sin escribir; (2) resuelve el proveedor (por id o por
-- `upper(nombre)`; lo crea si falta; uno inactivo => `proveedor_inactivo`); (3) toma la compra existente de ese proveedor y
-- referencia (sin cancelar) o crea una nueva; (4) inserta líneas con sus entregas, repartos por entrega y recepciones `importada`;
-- (5) recalcula estado y deja el evento `importar`.
-- Una compra nueva queda con `revision = 0` y estado `confirmada` (`confirmada_at` y `confirmada_por_*` del actor); si la compra
-- ya existía, sube `revision` en 1.
-- Los repartos se enlazan a su entrega por `entrega_periodo` (todavía no hay ids): uno sin entrega correspondiente viola
-- `not null` y deshace todo.
-- Motivos: clave_existente (otra compra no cancelada ya tiene esa clave, o se repite en el archivo), proveedor_inactivo,
-- proveedor_requerido, proveedor_inexistente, sin_lineas, entregas_no_cuadran (la suma de entregas no es la de unidades o no hay
-- ninguna), excede_pendiente (recepciones > unidades), saldo_cerrado.
-- Devuelve { ok, compra_id, numero, revision, estado, creada, proveedor_id, proveedor_creado, lineas: [{ clave_importacion,
-- linea_id }] }.
create or replace function public.importar_compra(p_compra jsonb, p_actor jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_perfil uuid := nullif(p_actor ->> 'perfil_id', '')::uuid;
  v_nombre text := nullif(p_actor ->> 'nombre', '');
  v_prov_id uuid := nullif(p_compra ->> 'proveedor_id', '')::uuid;
  v_prov_nombre text := nullif(btrim(p_compra ->> 'proveedor_nombre'), '');
  v_prov_activo boolean;
  v_prov_creado boolean := false;
  v_referencia text := nullif(btrim(p_compra ->> 'referencia'), '');
  v_estado_nuevo text := coalesce(nullif(p_compra ->> 'estado', ''), 'confirmada');
  v_compra public.compras%rowtype;
  v_existia boolean := false;
  v_compra_id uuid;
  v_antes jsonb;
  v_estado text;
  v_revision integer;
  v_numero text;
  v_l jsonb;
  v_linea_id uuid;
  v_ids jsonb := '[]'::jsonb;
  v_unidades bigint := 0;
  v_n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended('vector2:importar_compra', 0));

  if p_compra -> 'lineas' is null
     or jsonb_typeof(p_compra -> 'lineas') <> 'array'
     or jsonb_array_length(p_compra -> 'lineas') = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sin_lineas');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_compra -> 'lineas') l
    where coalesce(
            (select sum((e ->> 'unidades')::integer) from jsonb_array_elements(l -> 'entregas') e),
            0
          ) <> (l ->> 'unidades')::integer
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'entregas_no_cuadran');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_compra -> 'lineas') l
    where coalesce(
            (select sum((x ->> 'unidades')::integer) from jsonb_array_elements(l -> 'recepciones') x),
            0
          ) > (l ->> 'unidades')::integer
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'excede_pendiente');
  end if;

  if exists (
    select 1
    from (
      select l ->> 'clave_importacion' as clave
      from jsonb_array_elements(p_compra -> 'lineas') l
      where nullif(l ->> 'clave_importacion', '') is not null
    ) k
    group by k.clave
    having count(*) > 1
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'clave_existente');
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_compra -> 'lineas') l
    join public.compra_lineas cl on cl.clave_importacion = (l ->> 'clave_importacion')
    join public.compras c on c.id = cl.compra_id and c.estado <> 'cancelada'
    where nullif(l ->> 'clave_importacion', '') is not null
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'clave_existente');
  end if;

  if v_prov_id is not null then
    select p.activo into v_prov_activo from public.proveedores p where p.id = v_prov_id;
    if not found then
      return jsonb_build_object('ok', false, 'motivo', 'proveedor_inexistente');
    end if;
  elsif v_prov_nombre is not null then
    select p.id, p.activo into v_prov_id, v_prov_activo
    from public.proveedores p
    where upper(p.nombre) = upper(v_prov_nombre);
  else
    return jsonb_build_object('ok', false, 'motivo', 'proveedor_requerido');
  end if;

  if v_prov_id is not null and not v_prov_activo then
    return jsonb_build_object('ok', false, 'motivo', 'proveedor_inactivo');
  end if;

  if v_prov_id is not null and v_referencia is not null then
    select * into v_compra
    from public.compras c
    where c.proveedor_id = v_prov_id
      and upper(btrim(c.referencia)) = upper(v_referencia)
      and c.estado <> 'cancelada'
    order by c.created_at, c.id
    limit 1
    for update;
    v_existia := found;
    if v_existia and v_compra.cancelada_at is not null then
      return jsonb_build_object('ok', false, 'motivo', 'saldo_cerrado');
    end if;
  end if;

  if v_prov_id is null then
    insert into public.proveedores (nombre, es_intercompany, perfil_id, usuario_nombre)
    values (v_prov_nombre, coalesce((p_compra ->> 'proveedor_es_intercompany')::boolean, false), v_perfil, v_nombre)
    returning id into v_prov_id;
    v_prov_creado := true;
  end if;

  if v_existia then
    v_compra_id := v_compra.id;
    v_numero := v_compra.numero;
    v_antes := public.compra_foto(v_compra_id);
  else
    insert into public.compras (
      proveedor_id, origen, estado, fecha_compra, referencia, moneda, nota,
      confirmada_at, confirmada_por_id, confirmada_por_nombre,
      perfil_id, usuario_nombre, updated_by_id, updated_by_nombre
    )
    values (
      v_prov_id,
      coalesce(nullif(p_compra ->> 'origen', ''), 'carga_inicial'),
      v_estado_nuevo,
      (p_compra ->> 'fecha_compra')::date,
      v_referencia,
      coalesce(nullif(p_compra ->> 'moneda', ''), 'PEN'),
      nullif(p_compra ->> 'nota', ''),
      case when v_estado_nuevo = 'borrador' then null else now() end,
      case when v_estado_nuevo = 'borrador' then null else v_perfil end,
      case when v_estado_nuevo = 'borrador' then null else v_nombre end,
      v_perfil, v_nombre, v_perfil, v_nombre
    )
    returning id, numero into v_compra_id, v_numero;
    v_antes := null;
  end if;

  for v_l in select value from jsonb_array_elements(p_compra -> 'lineas') loop
    insert into public.compra_lineas (
      compra_id, tipo, genero_mundo_linea_id, equivalencia_id, marca_id, agrupacion_marca_id, tallas,
      unidades, costo_unitario, llegada_periodo, destino, tienda_id, alcance,
      clave_importacion, huella_importacion, nota, avisos
    )
    values (
      v_compra_id,
      coalesce(nullif(v_l ->> 'tipo', ''), 'especifica'),
      nullif(v_l ->> 'genero_mundo_linea_id', '')::uuid,
      nullif(v_l ->> 'equivalencia_id', '')::uuid,
      nullif(v_l ->> 'marca_id', '')::uuid,
      nullif(v_l ->> 'agrupacion_marca_id', '')::uuid,
      coalesce(nullif(v_l ->> 'tallas', ''), 'ambas'),
      (v_l ->> 'unidades')::integer,
      nullif(v_l ->> 'costo_unitario', '')::numeric,
      (select min((e ->> 'periodo')::date) from jsonb_array_elements(v_l -> 'entregas') e),
      coalesce(nullif(v_l ->> 'destino', ''), 'cd'),
      nullif(v_l ->> 'tienda_id', '')::uuid,
      case when jsonb_typeof(v_l -> 'alcance') = 'object' then v_l -> 'alcance' else '{}'::jsonb end,
      nullif(v_l ->> 'clave_importacion', ''),
      nullif(v_l ->> 'huella_importacion', ''),
      nullif(v_l ->> 'nota', ''),
      case when jsonb_typeof(v_l -> 'avisos') = 'array' then v_l -> 'avisos' else '[]'::jsonb end
    )
    returning id into v_linea_id;

    insert into public.compra_linea_entregas (linea_id, periodo, unidades, origen)
    select v_linea_id, (e ->> 'periodo')::date, (e ->> 'unidades')::integer, coalesce(nullif(e ->> 'origen', ''), 'importada')
    from jsonb_array_elements(v_l -> 'entregas') e;

    insert into public.compra_linea_repartos (
      linea_id, entrega_id, marca_id, genero_mundo_linea_id, equivalencia_id, unidades,
      reparto_id, reparto_version, temporada, error_reparto_pp
    )
    select
      v_linea_id,
      en.id,
      (r ->> 'marca_id')::uuid,
      (r ->> 'genero_mundo_linea_id')::uuid,
      nullif(r ->> 'equivalencia_id', '')::uuid,
      (r ->> 'unidades')::integer,
      nullif(r ->> 'reparto_id', '')::uuid,
      nullif(r ->> 'reparto_version', '')::integer,
      nullif(r ->> 'temporada', ''),
      nullif(r ->> 'error_reparto_pp', '')::numeric
    from jsonb_array_elements(v_l -> 'repartos') r
    left join public.compra_linea_entregas en
      on en.linea_id = v_linea_id and en.periodo = (r ->> 'entrega_periodo')::date;

    insert into public.compra_linea_recepciones
      (linea_id, recibida_periodo, unidades, fecha_recepcion, origen, perfil_id, usuario_nombre, nota)
    select v_linea_id, (x ->> 'recibida_periodo')::date, (x ->> 'unidades')::integer, (x ->> 'fecha_recepcion')::date,
           'importada', v_perfil, v_nombre, nullif(x ->> 'nota', '')
    from jsonb_array_elements(v_l -> 'recepciones') x;

    v_ids := v_ids || jsonb_build_array(
      jsonb_build_object('clave_importacion', nullif(v_l ->> 'clave_importacion', ''), 'linea_id', v_linea_id)
    );
    v_unidades := v_unidades + (v_l ->> 'unidades')::integer;
    v_n := v_n + 1;
  end loop;

  v_estado := public.compra_recalcular_estado(v_compra_id);

  if v_existia then
    update public.compras
    set revision = revision + 1,
        updated_by_id = v_perfil,
        updated_by_nombre = v_nombre
    where id = v_compra_id
    returning revision into v_revision;
  else
    select c.revision into v_revision from public.compras c where c.id = v_compra_id;
  end if;

  insert into public.compra_eventos
    (compra_id, linea_id, accion, antes, despues, motivo, resumen, perfil_id, usuario_nombre)
  values (
    v_compra_id,
    null,
    'importar',
    v_antes,
    public.compra_foto(v_compra_id) || jsonb_build_object('importado', v_ids),
    null,
    format('Importada%s: %s linea(s) nueva(s), %s u', case when v_existia then ' en compra existente' else '' end, v_n, v_unidades),
    v_perfil,
    v_nombre
  );

  return jsonb_build_object(
    'ok', true,
    'compra_id', v_compra_id,
    'numero', v_numero,
    'revision', v_revision,
    'estado', v_estado,
    'creada', not v_existia,
    'proveedor_id', v_prov_id,
    'proveedor_creado', v_prov_creado,
    'lineas', v_ids
  );
end;
$$;

revoke execute on function public.importar_compra(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.importar_compra(jsonb, jsonb) to service_role;

comment on function public.importar_compra(jsonb, jsonb) is
  'M8 0.13.0 (ficha 0.13): importa UNA compra (cabecera, lineas, entregas, repartos por entrega y recepciones importada) en una transaccion, bajo un candado consultivo global. Crea el proveedor si falta, agrega lineas nuevas a la compra existente de ese proveedor y referencia (sin cancelar) y deja el evento importar. Valida todo antes de escribir; un fallo estructural deshace todo. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 13. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
alter table public.proveedores enable row level security;
alter table public.compras enable row level security;
alter table public.compra_lineas enable row level security;
alter table public.compra_linea_entregas enable row level security;
alter table public.compra_linea_repartos enable row level security;
alter table public.compra_linea_recepciones enable row level security;
alter table public.compra_eventos enable row level security;
alter table public.flujo_parametros enable row level security;

revoke all on public.proveedores from public, anon, authenticated;
grant all on public.proveedores to service_role;
revoke all on public.compras from public, anon, authenticated;
grant all on public.compras to service_role;
revoke all on public.compra_lineas from public, anon, authenticated;
grant all on public.compra_lineas to service_role;
revoke all on public.compra_linea_entregas from public, anon, authenticated;
grant all on public.compra_linea_entregas to service_role;
revoke all on public.compra_linea_repartos from public, anon, authenticated;
grant all on public.compra_linea_repartos to service_role;
revoke all on public.compra_linea_recepciones from public, anon, authenticated;
grant all on public.compra_linea_recepciones to service_role;
revoke all on public.compra_eventos from public, anon, authenticated;
grant all on public.compra_eventos to service_role;
revoke all on public.flujo_parametros from public, anon, authenticated;
grant all on public.flujo_parametros to service_role;
