-- M5b · Mapeo de combinaciones históricas (mejora de M5, versión 0.8.1).
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN sentencias destructivas (ni DROP, ni DELETE, ni TRUNCATE, ni UPDATE).
-- Motivo: las migraciones se aplican con `execute_sql` del MCP de Supabase y
-- cualquier sentencia destructiva se queda esperando una confirmación que
-- nunca llega. `on delete cascade` / `on delete set null` en una FK no cuentan
-- (0002 a 0007 ya pasaron por `execute_sql` con ellas).
--
-- Diseño (docs/modulos/05b-mapeo-combinaciones.md § Modelo de datos):
--   * Un mapeo persistente: ORIGEN (género / mundo / línea / equivalencia tal
--     como llegan a `previsualizar`, ya normalizados) -> DESTINO (una
--     `equivalencia_id` del árbol). El resolutor de M5 lo consulta SOLO cuando
--     el árbol no resuelve; nunca se encadena (el destino es un id, no un
--     texto que vuelva a resolverse), así que no hay ciclos por construcción.
--   * Solo esta tabla es nueva. `equivalencias`, `venta_stock_mensual` y
--     `cargas_venta_stock` no cambian: los hechos guardan únicamente la
--     equivalencia destino y la auditoría va en el `reporte` de la carga.
--   * No hay vistas ni funciones nuevas (nada que revocar a anon/authenticated).
--   * RLS activo y SIN políticas: solo entra el backend con service_role.

-- ---------------------------------------------------------------------------
-- 1. Mapeos de combinación
-- ---------------------------------------------------------------------------
-- Origen: las cuatro piezas se guardan en columnas (no en un texto
-- concatenado) para poder buscarlas y para que el único sea exacto.
--   * `origen_genero`, `origen_mundo`, `origen_linea`: NORMALIZADOS
--     (`normalizarNombre`). Se permite '' en uno o en dos (origen de un error
--     `clasificacion_incompleta`). Los tres vacíos es `sin_clasificar`, que NO
--     es mapeable (decisión de Javier: se excluye).
--   * `origen_equivalencia`: ya sustituida (`-` -> nombre de la línea, vacío ->
--     `SIN EQUIVALENCIA`) o el comodín `*` = "cualquier equivalencia de esa
--     terna que no resuelva". Es el único comodín: no existe en género, mundo
--     ni línea (sería una regla de renombre, otro mecanismo).
--
-- Destino: `equivalencia_id`, FK `on delete cascade`. Un mapeo sin destino no
-- sirve para nada, y una equivalencia con hechos cargados ya no se puede
-- eliminar (venta_stock_mensual la protege con `on delete restrict`), así que
-- el cascade solo barre mapeos de equivalencias sin histórico.
--
-- `motivo_origen`: con qué motivo de error se creó (informativo). Los 11
-- mapeables: cinco de combinación inexistente, cinco inactivos y
-- `clasificacion_incompleta`.
--
-- `activo` tiene uso real: un mapeo inactivo no se aplica (pausarlo sin
-- borrarlo). `perfil_id` / `usuario_nombre` siguen el patrón de
-- `cargas_venta_stock`: el nombre se copia para que el historial sobreviva si
-- se elimina al usuario (`perfil_id` pasa a null).
create table if not exists public.mapeos_combinacion (
  id uuid primary key default gen_random_uuid(),
  origen_genero text not null
    constraint mapeos_combinacion_origen_genero_len_check
      check (length(origen_genero) <= 120),
  origen_mundo text not null
    constraint mapeos_combinacion_origen_mundo_len_check
      check (length(origen_mundo) <= 120),
  origen_linea text not null
    constraint mapeos_combinacion_origen_linea_len_check
      check (length(origen_linea) <= 120),
  origen_equivalencia text not null
    constraint mapeos_combinacion_origen_equivalencia_check
      check (origen_equivalencia <> '' and length(origen_equivalencia) <= 120),
  equivalencia_id uuid not null
    constraint mapeos_combinacion_equivalencia_id_fkey
      references public.equivalencias (id) on delete cascade,
  motivo_origen text
    constraint mapeos_combinacion_motivo_origen_check
      check (motivo_origen is null or motivo_origen in (
        'genero_desconocido', 'mundo_desconocido', 'linea_desconocida',
        'nodo_inexistente', 'equivalencia_inexistente',
        'genero_inactivo', 'mundo_inactivo', 'linea_inactiva',
        'nodo_inactivo', 'equivalencia_inactiva',
        'clasificacion_incompleta'
      )),
  nota text
    constraint mapeos_combinacion_nota_len_check
      check (nota is null or length(nota) <= 200),
  perfil_id uuid
    constraint mapeos_combinacion_perfil_id_fkey
      references public.perfiles (id) on delete set null,
  usuario_nombre text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Los tres en blanco = `sin_clasificar`: no hay origen que mapear.
  constraint mapeos_combinacion_terna_no_vacia_check
    check (origen_genero <> '' or origen_mundo <> '' or origen_linea <> '')
);

-- Un origen tiene un solo destino (activo o no). Las cuatro columnas son
-- `not null` (el vacío se guarda como ''), así que un UNIQUE normal basta: no
-- hace falta el truco de `coalesce` para nulos. El comodín `*` es un valor más
-- de `origen_equivalencia`: convive con los exactos de la misma terna. El
-- índice sirve además para la búsqueda por terna que hace el resolutor.
create unique index if not exists mapeos_combinacion_origen_uniq
  on public.mapeos_combinacion
    (origen_genero, origen_mundo, origen_linea, origen_equivalencia);

-- Cubren las FK: eliminar una equivalencia (cascade) o un perfil (set null).
create index if not exists mapeos_combinacion_equivalencia_idx
  on public.mapeos_combinacion (equivalencia_id);
create index if not exists mapeos_combinacion_perfil_id_idx
  on public.mapeos_combinacion (perfil_id);

create or replace trigger set_updated_at before update on public.mapeos_combinacion
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
alter table public.mapeos_combinacion enable row level security;
