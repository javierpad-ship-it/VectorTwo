-- M1 · Árbol de producto: Género → Mundo → Línea → Equivalencia, más el
-- catálogo cerrado de agrupaciones de talla.
--
-- Idempotente: se puede correr más de una vez. Escrita sin bloques
-- `do $$ ... $$` para que el SQL Editor de Supabase la acepte tal cual.
--
-- Convenciones (ver docs/modulos/01-arbol-producto.md § Modelo de datos):
--   * `nombre` llega ya normalizado desde el backend (NFC, trim, mayúsculas
--     en español). La base solo exige longitud 1–120.
--   * `codigo` es un identificador corto ASCII (`NIÑAS → NINAS`, máximo 40).
--     Su unicidad es sobre `upper(codigo)` para que `h` y `H` no convivan si
--     alguien lo escribe a mano en el SQL Editor.
--   * Toda relación padre → hijo es `on delete restrict`: la acción normal es
--     desactivar (`activo = false`); eliminar solo cuando no hay hijos. El
--     handler traduce la violación de FK (23503) a un 409 legible.
--   * Desactivar NO se propaga en cascada: la vigencia de un nodo se calcula
--     en la aplicación como nodo.activo ∧ genero.activo ∧ mundo.activo ∧
--     linea.activo, así reactivar un padre devuelve los hijos tal cual.
--   * RLS activo y SIN políticas: solo entra el backend con service_role.

-- ---------------------------------------------------------------------------
-- 1. Géneros (raíz del árbol; catálogo fijo, lo edita el admin)
-- ---------------------------------------------------------------------------
create table if not exists public.generos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint generos_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint generos_nombre_len_check check (length(nombre) between 1 and 120),
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists generos_codigo_uniq on public.generos (upper(codigo));
create unique index if not exists generos_nombre_uniq on public.generos (nombre);

drop trigger if exists set_updated_at on public.generos;
create trigger set_updated_at before update on public.generos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Mundos (segundo nivel; todo mundo existe en todo género, por eso no hay
--    tabla genero_mundo)
-- ---------------------------------------------------------------------------
create table if not exists public.mundos (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint mundos_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint mundos_nombre_len_check check (length(nombre) between 1 and 120),
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists mundos_codigo_uniq on public.mundos (upper(codigo));
create unique index if not exists mundos_nombre_uniq on public.mundos (nombre);

drop trigger if exists set_updated_at on public.mundos;
create trigger set_updated_at before update on public.mundos
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Líneas (catálogo: PANTALON existe una sola vez aunque esté en 26 cruces
--    género-mundo; el cruce vive en genero_mundo_linea)
-- ---------------------------------------------------------------------------
-- El archivo de Javier no trae temporada: todas nacen como 'Todo el año' y se
-- ajustan desde la pantalla de Catálogos.
create table if not exists public.lineas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint lineas_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint lineas_nombre_len_check check (length(nombre) between 1 and 120),
  temporada text not null default 'Todo el año'
    constraint lineas_temporada_check check (temporada in ('Verano', 'Invierno', 'Todo el año')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists lineas_codigo_uniq on public.lineas (upper(codigo));
create unique index if not exists lineas_nombre_uniq on public.lineas (nombre);

drop trigger if exists set_updated_at on public.lineas;
create trigger set_updated_at before update on public.lineas
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. Nodo género-mundo-línea (el cruce real con el que se planifica)
-- ---------------------------------------------------------------------------
-- `activo = false` aquí significa "esta línea ya no se trabaja en este
-- género-mundo"; no toca la línea del catálogo ni sus otros nodos.
create table if not exists public.genero_mundo_linea (
  id uuid primary key default gen_random_uuid(),
  genero_id uuid not null
    constraint genero_mundo_linea_genero_id_fkey references public.generos(id) on delete restrict,
  mundo_id uuid not null
    constraint genero_mundo_linea_mundo_id_fkey references public.mundos(id) on delete restrict,
  linea_id uuid not null
    constraint genero_mundo_linea_linea_id_fkey references public.lineas(id) on delete restrict,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- La tripleta única, con genero_id al frente, cubre también las búsquedas por
-- género y por género-mundo. Los otros dos índices responden "¿en qué nodos
-- está PANTALON?" y "¿qué líneas tiene este mundo en toda la red?".
create unique index if not exists genero_mundo_linea_tripleta_uniq
  on public.genero_mundo_linea (genero_id, mundo_id, linea_id);
create index if not exists genero_mundo_linea_linea_id_idx on public.genero_mundo_linea (linea_id);
create index if not exists genero_mundo_linea_mundo_id_idx on public.genero_mundo_linea (mundo_id);

drop trigger if exists set_updated_at on public.genero_mundo_linea;
create trigger set_updated_at before update on public.genero_mundo_linea
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Equivalencias (hoja del árbol; cuelgan del nodo, no de la línea)
-- ---------------------------------------------------------------------------
-- El código es único DENTRO del nodo, no global: VARIOS aparece en 69 nodos.
-- Un futuro código PIVOT concatenará género-mundo-línea-equivalencia, así que
-- la unicidad global no hace falta.
--
-- `es_generica`: el archivo trae filas con equivalencia vacía o `-` ("sin
-- equivalencia definida"). Como las ventas de la Fase 2 llegarán igual y
-- tienen que caer en algún sitio, el importador crea en cada nodo que lo
-- necesite UNA equivalencia `SIN EQUIVALENCIA` marcada como genérica. La
-- bandera la distingue de una equivalencia real con nombre parecido y deja
-- que M3 y los reportes la traten aparte. El índice parcial garantiza a lo
-- sumo una genérica por nodo.
--
-- `agrupacion_estacionalidad_id` NO va aquí: la añade M3.
create table if not exists public.equivalencias (
  id uuid primary key default gen_random_uuid(),
  genero_mundo_linea_id uuid not null
    constraint equivalencias_genero_mundo_linea_id_fkey
    references public.genero_mundo_linea(id) on delete restrict,
  codigo text not null
    constraint equivalencias_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint equivalencias_nombre_len_check check (length(nombre) between 1 and 120),
  es_generica boolean not null default false,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists equivalencias_nodo_nombre_uniq
  on public.equivalencias (genero_mundo_linea_id, nombre);
create unique index if not exists equivalencias_nodo_codigo_uniq
  on public.equivalencias (genero_mundo_linea_id, codigo);
create unique index if not exists equivalencias_nodo_generica_uniq
  on public.equivalencias (genero_mundo_linea_id) where es_generica;

drop trigger if exists set_updated_at on public.equivalencias;
create trigger set_updated_at before update on public.equivalencias
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Agrupaciones de talla (catálogo plano y CERRADO)
-- ---------------------------------------------------------------------------
-- No hay tabla de tallas individuales ni mapeo talla → agrupación: Javier
-- entrega venta y stock ya consolidados por agrupación, así que en Fase 2
-- esto será una columna `agrupacion_talla_id` de las filas de venta/stock.
-- Por eso no se relaciona con nada en M1 y solo tiene seed y lectura; un
-- tercer valor o un renombre rompería la correspondencia con los archivos
-- consolidados. Si algún día cambia, es una migración con su entrada en
-- DECISIONES.
create table if not exists public.agrupaciones_talla (
  id uuid primary key default gen_random_uuid(),
  codigo text not null
    constraint agrupaciones_talla_codigo_len_check check (length(codigo) between 1 and 40),
  nombre text not null
    constraint agrupaciones_talla_nombre_len_check check (length(nombre) between 1 and 120),
  orden integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists agrupaciones_talla_codigo_uniq on public.agrupaciones_talla (upper(codigo));
create unique index if not exists agrupaciones_talla_nombre_uniq on public.agrupaciones_talla (nombre);

drop trigger if exists set_updated_at on public.agrupaciones_talla;
create trigger set_updated_at before update on public.agrupaciones_talla
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Seeds
-- ---------------------------------------------------------------------------
-- El único de `codigo` es un índice sobre la expresión `upper(codigo)`, así
-- que el objetivo del `on conflict` tiene que ser esa misma expresión (entre
-- paréntesis dobles). Postgres la infiere contra el índice y no hace falta
-- un segundo índice redundante sobre `codigo` a secas.
--
-- Los nombres legibles de RI y OTROS se dejan tal cual hasta que Javier
-- confirme qué significan (pregunta abierta 7 de la especificación).
insert into public.generos (codigo, nombre, orden) values
  ('H',          'HOMBRE',     10),
  ('M',          'MUJER',      20),
  ('JOVENCITOS', 'JOVENCITOS', 30),
  ('JOVENCITAS', 'JOVENCITAS', 40),
  ('NINOS',      'NIÑOS',      50),
  ('NINAS',      'NIÑAS',      60),
  ('BEBE',       'BEBE',       70),
  ('OTROS',      'OTROS',      80)
on conflict ((upper(codigo))) do nothing;

-- No existe un mundo "sin asignar": toda línea tiene mundo (regla confirmada
-- por Javier). Las filas de un archivo que vengan con mundo vacío se omiten y
-- se reportan en la previsualización del importador para corregir el archivo.
insert into public.mundos (codigo, nombre, orden) values
  ('CASUAL',      'CASUAL',      10),
  ('URBANO',      'URBANO',      20),
  ('DEPORTIVO',   'DEPORTIVO',   30),
  ('FORMAL',      'FORMAL',      40),
  ('RI',          'RI',          50)
on conflict ((upper(codigo))) do nothing;

insert into public.agrupaciones_talla (codigo, nombre, orden) values
  ('CENTRALES', 'Tallas centrales', 10),
  ('EXTREMAS',  'Tallas extremas',  20)
on conflict ((upper(codigo))) do nothing;

-- ---------------------------------------------------------------------------
-- 8. RLS (sin políticas: solo el backend con service_role)
-- ---------------------------------------------------------------------------
alter table public.generos enable row level security;
alter table public.mundos enable row level security;
alter table public.lineas enable row level security;
alter table public.genero_mundo_linea enable row level security;
alter table public.equivalencias enable row level security;
alter table public.agrupaciones_talla enable row level security;
