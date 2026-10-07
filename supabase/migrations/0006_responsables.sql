-- M1b · Responsables género-mundo.
--
-- Javier: "a nivel de género-mundo asignar un responsable". Cada combinación
-- género × mundo tiene como máximo UN responsable (titular), que es un
-- comprador. El responsable sirve para FILTRAR, no para limitar permisos:
-- los compradores ven todo.
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN `DROP`, `DELETE` ni `TRUNCATE`. Como en `0002`–`0005`, el trigger se
-- declara con `create or replace trigger` (Postgres ≥ 14), que ya es
-- idempotente por sí solo. Motivo: las migraciones se aplican con
-- `execute_sql` del MCP de Supabase y cualquier sentencia destructiva se queda
-- esperando una confirmación que nunca llega. `0000`–`0005` ya están aplicadas
-- y no se tocan.
--
-- Convenciones (ver docs/modulos/01b-responsables.md § Modelo de datos):
--   * La tabla guarda solo las combinaciones ASIGNADAS: la ausencia de fila
--     significa "sin responsable". El par género × mundo no existe como
--     entidad (los mundos existen en todos los géneros), así que la matriz de
--     40 celdas se arma en memoria con el producto cartesiano de los catálogos
--     y no hay que sincronizar una tabla pre-poblada al crear un género o un
--     mundo.
--   * La base NO valida que el perfil sea comprador ni que esté activo: eso
--     cambia por otras pantallas (`/usuarios`) y el backend lo calcula como
--     "faltante" (`responsable_inactivo`, `responsable_no_comprador`). Las
--     asignaciones se conservan al desactivar a un usuario o cambiarle el rol.
--   * Sin seed: los responsables los asigna Javier.
--   * RLS activo y SIN políticas: solo entra el backend con service_role.
--   * Todos los nombres de constraint e índice miden ≤ 63 caracteres (el
--     límite de identificadores de Postgres; en `0005` uno se truncó).

-- ---------------------------------------------------------------------------
-- 1. Responsable de cada combinación género × mundo
-- ---------------------------------------------------------------------------
-- Las tres FK difieren a propósito:
--   * `genero_id` y `mundo_id` → `on delete restrict`. Son catálogos del árbol
--     y su regla (M1) es que nada se elimina con hijos: se desactiva. Una
--     asignación cuenta como hijo, así que un género o mundo con responsables
--     no se puede borrar y arrastrar en silencio el reparto de compradores; el
--     handler lo traduce a un 409 claro.
--   * `perfil_id` → `on delete cascade`. DECISIÓN DE JAVIER: "si elimino al
--     comprador quedarían sin asignar". La asignación es un atributo de la
--     persona y nada cuelga de ella (en la Fase 3 las compras cuelgan del
--     usuario que las registra y de la combinación, no de esta fila). Con
--     `cascade`, la fila existe si y solo si hay alguien asignado; `set null`
--     obligaría a `perfil_id` nullable y dejaría dos representaciones de "sin
--     responsable" (sin fila o fila con null). El borrado llega por la cadena
--     `auth.users → perfiles → responsables_genero_mundo`, toda en cascada, y
--     eliminar un usuario nunca se bloquea por esto.
--
-- `activo` existe solo por la convención de PLAN §4 ("toda tabla lleva
-- `activo`") y NO SE USA: la API no lo expone, quitar un responsable borra la
-- fila y toda asignación se escribe con `activo = true`. Las lecturas tratan
-- una fila con `activo = false` (solo posible desde el SQL Editor) como sin
-- responsable.
create table if not exists public.responsables_genero_mundo (
  id uuid primary key default gen_random_uuid(),
  genero_id uuid not null
    constraint responsables_genero_mundo_genero_id_fkey
    references public.generos(id) on delete restrict,
  mundo_id uuid not null
    constraint responsables_genero_mundo_mundo_id_fkey
    references public.mundos(id) on delete restrict,
  perfil_id uuid not null
    constraint responsables_genero_mundo_perfil_id_fkey
    references public.perfiles(id) on delete cascade,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Un responsable por combinación. Sobre COLUMNAS (no expresiones) para que
-- PostgREST lo admita en `onConflict: "genero_id,mundo_id"` del `upsert`. Con
-- `genero_id` al frente, también cubre la FK hacia `generos`.
create unique index if not exists responsables_genero_mundo_par_uniq
  on public.responsables_genero_mundo (genero_id, mundo_id);

-- Los índices de FK no aceleran nada con ~40 filas; se crean porque el
-- advisor de Supabase marca las FK sin índice (criterio fijado en M3).
-- `mundo_id`: comprobación de FK al eliminar un mundo.
create index if not exists responsables_genero_mundo_mundo_id_idx
  on public.responsables_genero_mundo (mundo_id);
-- `perfil_id`: el borrado en cascada al eliminar un usuario y "¿de cuántas
-- combinaciones es responsable este usuario?" (`/usuarios`).
create index if not exists responsables_genero_mundo_perfil_id_idx
  on public.responsables_genero_mundo (perfil_id);

create or replace trigger set_updated_at before update on public.responsables_genero_mundo
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
alter table public.responsables_genero_mundo enable row level security;
