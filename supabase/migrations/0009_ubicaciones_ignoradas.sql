-- M5c · Ubicaciones ignoradas (mejora de M5, versión 0.8.2).
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- SIN sentencias destructivas (ni DROP, ni DELETE, ni TRUNCATE, ni UPDATE).
-- Motivo: las migraciones se aplican con `execute_sql` del MCP de Supabase y
-- cualquier sentencia destructiva se queda esperando una confirmación que
-- nunca llega.
--
-- Diseño (docs/modulos/05c-ubicaciones-conciliacion.md § Modelo de datos):
--   * Lista editable de nombres de la columna TIENDA del archivo de venta que
--     NO son tiendas (central, oficinas, almacenes de muestras). Sus filas se
--     excluyen por DECISIÓN (motivo `ubicacion_ignorada`), sin contar como error
--     y sin crear tiendas. Sustituye a la regla de 0.8.0 de crearlas como
--     tiendas desactivadas en `tiendas`: una ubicación ignorada no es una tienda
--     y no debe aparecer en selectores, calendario, importador ni conteos de M4.
--   * La tienda manda: el resolutor busca tienda por nombre, tienda por código,
--     y solo después aquí. Si existe una tienda con el mismo nombre, la fila de
--     esta tabla queda sin efecto (lo calcula el backend al listar; la base no
--     lo impone).
--   * SIN FKs: nada cuelga de aquí. Las filas ignoradas no se cargan, así que
--     nunca hay hechos que apunten a una ubicación; por eso tampoco aplica
--     `on delete`.
--   * SIN `codigo` ni `tipo`: QlikView trae el nombre y se resuelve por nombre.
--     Si algún día el archivo trajera códigos, se añade una columna nullable.
--   * SIN SEED: la lista la llena Javier (tres valores hoy, datos reales de
--     Lukers que no van en el repo).
--   * RLS activo y SIN políticas: solo entra el backend con service_role.

-- ---------------------------------------------------------------------------
-- 1. Ubicaciones ignoradas
-- ---------------------------------------------------------------------------
-- `nombre` llega YA NORMALIZADO desde el backend (`normalizarNombre`: NFC, trim,
-- espacios colapsados, mayúsculas en español), igual que `tiendas.nombre`. Por
-- eso el único es sobre `nombre` plano y no sobre `upper(nombre)`: el backend
-- normaliza siempre antes de escribir.
--
-- `activo` existe por convención (PLAN §4) y NO tiene uso, como en
-- `responsables_genero_mundo`: la baja borra la fila. Una fila con
-- `activo = false` (solo desde el SQL Editor) se lee como si no existiera.
create table if not exists public.ubicaciones_ignoradas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null
    constraint ubicaciones_ignoradas_nombre_len_check
      check (length(nombre) between 1 and 120),
  nota text
    constraint ubicaciones_ignoradas_nota_len_check
      check (nota is null or length(nota) <= 200),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Único por nombre (activo o no). Sirve además para la lectura ordenada por
-- nombre que hace el listado. La tabla tiene del orden de tres filas.
create unique index if not exists ubicaciones_ignoradas_nombre_uniq
  on public.ubicaciones_ignoradas (nombre);

create or replace trigger set_updated_at before update on public.ubicaciones_ignoradas
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
alter table public.ubicaciones_ignoradas enable row level security;
