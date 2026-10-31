-- M7 07e · Propuesta de la IA por línea (primera entrega, versión 0.15.0): modelo de datos, lectura compacta de venta
-- y escritura transaccional de la propuesta de un GM.
--
-- Ficha: docs/modulos/07e-propuesta-con-ia.md (§2 Modelo de datos, §2.10 y §2.11 funciones, §2.12 triggers, §5.5 privacidad).
-- Numeración: la 0026 es de 0.13.1 · M8, la 0028 de M9a y la 0029 de 0.14.0 · M6. Depende de 0000 (`tg_set_updated_at`),
-- 0004 (`tiendas`), 0006 (`perfiles`), 0007 (`venta_stock_vigente`, `cargas_venta_stock`), 0018 (`proyecciones`,
-- `proyeccion_filas`, `proyeccion_fila_anios`) y 0019 (`marcas_unidad`). NO depende de 0025 a 0029.
--
-- SE APLICA EN LA TANDA 1, ANTES DEL CÓDIGO DE 0.15.0, con 0.13.x/0.14.x desplegada: todo lo que añade es inocuo para ese
-- código (tablas nuevas, UNA columna nula con su `check` y funciones nuevas). La IA se despliega APAGADA: no hay seed, y sin
-- fila vigente en `ia_configuraciones` el servicio responde «sin_configuracion».
--
-- Qué hace:
--   1. Tablas de configuración y de trabajo: `ia_evaluaciones`, `ia_configuraciones`, `ia_corridas`, `ia_corrida_gms`.
--   2. Tablas INMUTABLES (solo inserción): `ia_entradas`, `ia_llamadas`, `ia_propuestas_gm`, `ia_propuestas_filas`.
--   3. `ia_corrida_gms.propuesta_gm_id` (FK circular con `ia_propuestas_gm`: se añade después de crearla).
--   4. `proyeccion_fila_anios.decision_ia_fila_id` con su `check` (D2): «Aceptar IA» deja la traza de la propuesta aceptada.
--   5. Triggers: `tg_ia_inmutable` (update/delete por fila + truncate por sentencia) y `tg_ia_terminal` (estados terminales).
--   6. `venta_lineas_ia(...)`: la ÚNICA lectura de venta del módulo; solo `unidades`, nunca soles, costos ni stock (D12).
--   7. `registrar_propuesta_ia_gm(p jsonb)`: graba la propuesta de un GM entera o nada (I6).
--
-- Idempotente: `create table if not exists`, `add column if not exists` (que omite también el `check` y la FK en línea si la
-- columna ya existe), `create index if not exists`, `create or replace trigger`, `create or replace function`,
-- `revoke`/`grant`/`comment` repetibles. Sin bloques `do $$ ... $$` (las comillas de dólar del cuerpo de una función no son
-- un bloque anónimo). Sin `drop`, `delete`, `truncate` ni `update` A NIVEL DE MIGRACIÓN (con `execute_sql` esas sentencias se
-- quedan esperando una confirmación que nunca llega); dentro de `registrar_propuesta_ia_gm` sí hay `insert` y `update`. Sin
-- backfill ni seed.
--
-- Criterio de la base (ficha §2): solo invariantes ESTRUCTURALES (rangos, longitudes, `jsonb_typeof`, huellas de 64
-- caracteres, y el `check` de `decision_ia_fila_id`). Los catálogos (`estado`, `tipo`, `tipo_llamada`, `modo`, `capacidades`,
-- `estado_meta`, `confianza`, `banderas`) NO llevan `check`: los valida zod, para poder ampliarlos en 0.15.1 (`cierre_y`,
-- `sublineas`) sin quitar una restricción.
--
-- EXCEPCIÓN A LA CONVENCIÓN: las cuatro tablas inmutables no llevan `activo` ni `updated_at` (igual que `compra_eventos` y
-- `venta_stock_mensual`): nunca cambian, así que no hay nada que desactivar ni que marcar. `ia_corrida_gms` tampoco lleva
-- `activo`: su vida es la de su corrida.
--
-- NEUTRAL AL PROVEEDOR: el esquema no está atado a ningún proveedor de IA. `proveedor` (identificador corto, p. ej. el
-- nombre del adaptador) y `modelo` son texto libre con solo un rango de longitud: sin `check` de catálogo, sin supuestos de
-- ids de modelo (los valida zod y el adaptador). Los tokens usan nombres neutros (`tokens_entrada`, `tokens_entrada_cache`,
-- `tokens_salida`) y `precios` usa claves neutras. Cambiar de proveedor o añadir uno segundo no pide migración.
--
-- Nada es contador: el costo, los tokens y el avance se derivan de `ia_llamadas` y `ia_corrida_gms` con `sum`/`count` al
-- leer. No hay columnas que se lean, modifiquen y escriban.
--
-- Seguridad: RLS activo y SIN políticas (solo entra el backend con `service_role`); `revoke` a public, anon y authenticated y
-- `grant` a service_role. Funciones `security invoker`, `search_path` vacío, solo `service_role`. Los triggers de
-- inmutabilidad valen para TODOS los roles, `service_role` incluido: la API corre con él, así que un `revoke` no bastaría.
-- El dueño de la base puede desactivar triggers: eso queda fuera del alcance de la aplicación.
--
-- Los cuerpos de las funciones van sin comentarios `--` (el SQL Editor de Supabase los parsea mal dentro de `$$`): lo que hay
-- que saber de cada una está aquí, encima.
--
-- Todos los identificadores miden <= 63 caracteres.

-- ---------------------------------------------------------------------------
-- 1. `ia_evaluaciones` (backtests, §2.2 y §5.4)
-- ---------------------------------------------------------------------------
-- `estado` (zod): en_curso | completa | fallida | cancelada. Una sola evaluación `en_curso` a la vez (índice único parcial).
-- Ninguna evaluación se borra: todos los intentos quedan registrados. En un estado terminal, `tg_ia_terminal` rechaza todo
-- cambio salvo `perfil_id` -> NULL (la FK `on delete set null` al borrar un usuario).
create table if not exists public.ia_evaluaciones (
  id uuid primary key default gen_random_uuid(),
  proveedor text not null
    constraint ia_evaluaciones_proveedor_len_check
      check (char_length(proveedor) between 1 and 40),
  modelo text not null
    constraint ia_evaluaciones_modelo_len_check
      check (char_length(modelo) between 1 and 100),
  version_prompt text not null
    constraint ia_evaluaciones_version_prompt_len_check
      check (char_length(version_prompt) between 1 and 20),
  -- Foto de lo evaluado: pliegues, umbrales de 5.4 (incluidos MEJORA_MIN aplicado y número de intento), max_filas_llamada,
  -- presupuesto_razonamiento, precios y semilla del bootstrap.
  parametros jsonb not null
    constraint ia_evaluaciones_parametros_check
      check (jsonb_typeof(parametros) = 'object'),
  estado text not null default 'en_curso',
  resultados jsonb
    constraint ia_evaluaciones_resultados_check
      check (resultados is null or jsonb_typeof(resultados) = 'object'),
  -- { distribucion_y1: "gana" | "no_gana" | "sin_dato", regla_que_fallo: string | null }
  veredicto jsonb
    constraint ia_evaluaciones_veredicto_check
      check (veredicto is null or jsonb_typeof(veredicto) = 'object'),
  tope_usd numeric(8, 2) not null default 50
    constraint ia_evaluaciones_tope_usd_check
      check (tope_usd > 0 and tope_usd <= 500),
  perfil_id uuid
    constraint ia_evaluaciones_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  iniciada_at timestamptz not null default now(),
  terminada_at timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ia_evaluaciones_en_curso_uniq
  on public.ia_evaluaciones ((true))
  where estado = 'en_curso';
create index if not exists ia_evaluaciones_perfil_id_idx on public.ia_evaluaciones (perfil_id);

create or replace trigger set_updated_at before update on public.ia_evaluaciones
  for each row execute function public.tg_set_updated_at();

comment on table public.ia_evaluaciones is
  'M7 07e 0.15.0: backtests que justifican encender una capacidad de la IA. Una sola en_curso a la vez. Nunca se borran (todos los intentos quedan). En estado terminal (completa, fallida, cancelada) tg_ia_terminal rechaza todo cambio salvo perfil_id a NULL.';

-- ---------------------------------------------------------------------------
-- 2. `ia_configuraciones` (versionada; la vigente gobierna la IA; §2.1)
-- ---------------------------------------------------------------------------
-- Sin fila vigente la IA está apagada (estado inicial; NO hay seed). `estado` (zod): vigente | reemplazada. Una versión nueva
-- pasa la anterior a `reemplazada` con `UPDATE ... where estado = 'vigente' and id = ?` (patrón 06d) y, si el insert falla, la
-- restaura. `version` es única: dos configuraciones concurrentes no pueden quedar con el mismo número.
-- `capacidades` (zod): en 0.15.0 subconjunto de {distribucion_y1}; vacío = IA apagada sin quitar la clave.
create table if not exists public.ia_configuraciones (
  id uuid primary key default gen_random_uuid(),
  version integer not null
    constraint ia_configuraciones_version_check check (version >= 1),
  estado text not null default 'vigente',
  proveedor text not null
    constraint ia_configuraciones_proveedor_len_check
      check (char_length(proveedor) between 1 and 40),
  modelo text not null
    constraint ia_configuraciones_modelo_len_check
      check (char_length(modelo) between 1 and 100),
  version_prompt text not null
    constraint ia_configuraciones_version_prompt_len_check
      check (char_length(version_prompt) between 1 and 20),
  capacidades text[] not null default '{}',
  evaluacion_id uuid
    constraint ia_configuraciones_evaluacion_id_fkey
      references public.ia_evaluaciones(id) on delete restrict,
  tope_usd_corrida numeric(8, 2) not null default 10
    constraint ia_configuraciones_tope_usd_corrida_check
      check (tope_usd_corrida > 0 and tope_usd_corrida <= 500),
  tope_usd_mes numeric(8, 2) not null default 60
    constraint ia_configuraciones_tope_usd_mes_check
      check (tope_usd_mes > 0 and tope_usd_mes <= 5000),
  tope_usd_dia_usuario numeric(8, 2) not null default 15
    constraint ia_configuraciones_tope_usd_dia_usuario_check
      check (tope_usd_dia_usuario > 0 and tope_usd_dia_usuario <= 500),
  max_filas_llamada integer not null default 60
    constraint ia_configuraciones_max_filas_llamada_check
      check (max_filas_llamada between 10 and 150),
  incluir_cola_larga boolean not null default false,
  presupuesto_razonamiento integer not null default 0
    constraint ia_configuraciones_presupuesto_razonamiento_check
      check (presupuesto_razonamiento between 0 and 32000),
  -- USD por millón de tokens, con claves NEUTRAS (válidas para cualquier proveedor): { entrada, entrada_cache, salida }.
  -- `entrada_cache` es la tarifa de los tokens de entrada servidos desde caché del proveedor (si no la hay, igual a `entrada`).
  precios jsonb not null
    constraint ia_configuraciones_precios_check
      check (jsonb_typeof(precios) = 'object'),
  -- Términos que NUNCA salen al proveedor además de marcas y tiendas (nombre de la empresa, siglas). Cada uno de 2 a 60
  -- caracteres lo valida zod.
  terminos_extra text[] not null default '{}'
    constraint ia_configuraciones_terminos_extra_check
      check (cardinality(terminos_extra) <= 50),
  nota text
    constraint ia_configuraciones_nota_len_check
      check (nota is null or char_length(nota) <= 300),
  perfil_id uuid
    constraint ia_configuraciones_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  aprobada_at timestamptz not null default now(),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ia_configuraciones_version_key unique (version)
);

-- Solo una vigente: dos filas con `estado = 'vigente'` chocarían en el mismo valor constante.
create unique index if not exists ia_configuraciones_vigente_uniq
  on public.ia_configuraciones ((true))
  where estado = 'vigente';
create index if not exists ia_configuraciones_evaluacion_id_idx on public.ia_configuraciones (evaluacion_id);
create index if not exists ia_configuraciones_perfil_id_idx on public.ia_configuraciones (perfil_id);

create or replace trigger set_updated_at before update on public.ia_configuraciones
  for each row execute function public.tg_set_updated_at();

comment on table public.ia_configuraciones is
  'M7 07e 0.15.0: configuracion versionada del motor de IA (modelo, prompt, capacidades, topes de USD, precios, terminos que nunca salen). Una sola vigente (indice unico parcial). Sin fila vigente la IA esta apagada: no hay seed. La clave de la API no esta en ninguna tabla.';
comment on column public.ia_configuraciones.tope_usd_mes is
  'M7 07e: tope BLANDO de la app (mes calendario de Lima, corridas y evaluaciones juntas). El tope duro lo fija el administrador en la consola del proveedor.';
comment on column public.ia_configuraciones.terminos_extra is
  'M7 07e: terminos que nunca salen al proveedor ademas de marcas y tiendas. Cada uno de 2 a 60 caracteres (zod). Sin datos reales en el repositorio.';

-- ---------------------------------------------------------------------------
-- 3. `ia_corridas` (una por pedido de propuesta o por evaluación; §2.3)
-- ---------------------------------------------------------------------------
-- `tipo` (zod): propuesta | evaluacion. `estado` (zod): en_curso | completa | parcial | detenida | cancelada | abandonada.
-- Una sola corrida `en_curso` por proyección (índice único parcial). Mutable mientras está `en_curso` (solo estado,
-- motivo_fin, ultima_actividad_at y terminada_at); en un estado terminal aplica `tg_ia_terminal`, que solo deja pasar
-- `perfil_id` -> NULL y `proyeccion_id` -> NULL (las FK `on delete set null`).
-- `calculado_at_proyeccion`: si `proyecciones.calculado_at` cambia a mitad de la corrida, la API responde 409 datos_cambiaron.
create table if not exists public.ia_corridas (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,
  proyeccion_id uuid
    constraint ia_corridas_proyeccion_id_fkey
      references public.proyecciones(id) on delete set null,
  evaluacion_id uuid
    constraint ia_corridas_evaluacion_id_fkey
      references public.ia_evaluaciones(id) on delete restrict,
  configuracion_id uuid
    constraint ia_corridas_configuracion_id_fkey
      references public.ia_configuraciones(id) on delete restrict,
  proveedor text not null
    constraint ia_corridas_proveedor_len_check
      check (char_length(proveedor) between 1 and 40),
  modelo text not null
    constraint ia_corridas_modelo_len_check
      check (char_length(modelo) between 1 and 100),
  version_prompt text not null
    constraint ia_corridas_version_prompt_len_check
      check (char_length(version_prompt) between 1 and 20),
  anio_en_curso integer,
  k integer,
  calculado_at_proyeccion timestamptz,
  -- GM pedidos y `regenerar`.
  alcance jsonb not null
    constraint ia_corridas_alcance_check
      check (jsonb_typeof(alcance) = 'object'),
  estado text not null default 'en_curso',
  motivo_fin text
    constraint ia_corridas_motivo_fin_len_check
      check (motivo_fin is null or char_length(motivo_fin) <= 120),
  costo_estimado_usd numeric(10, 4) not null
    constraint ia_corridas_costo_estimado_check
      check (costo_estimado_usd >= 0),
  perfil_id uuid
    constraint ia_corridas_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  iniciada_at timestamptz not null default now(),
  ultima_actividad_at timestamptz not null default now(),
  terminada_at timestamptz,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- El `where proyeccion_id is not null` deja fuera las corridas de evaluación (sin proyección).
create unique index if not exists ia_corridas_en_curso_proyeccion_uniq
  on public.ia_corridas (proyeccion_id)
  where estado = 'en_curso' and proyeccion_id is not null;
create index if not exists ia_corridas_proyeccion_id_idx on public.ia_corridas (proyeccion_id);
create index if not exists ia_corridas_evaluacion_id_idx on public.ia_corridas (evaluacion_id);
create index if not exists ia_corridas_configuracion_id_idx on public.ia_corridas (configuracion_id);
create index if not exists ia_corridas_perfil_id_idx on public.ia_corridas (perfil_id);

create or replace trigger set_updated_at before update on public.ia_corridas
  for each row execute function public.tg_set_updated_at();

comment on table public.ia_corridas is
  'M7 07e 0.15.0: una corrida por pedido de propuesta (tipo propuesta) o por evaluacion (tipo evaluacion). Una sola en_curso por proyeccion. Caduca a los 30 min sin actividad (la API la pasa a abandonada). En estado terminal tg_ia_terminal rechaza todo cambio salvo perfil_id y proyeccion_id a NULL.';

-- ---------------------------------------------------------------------------
-- 4. `ia_corrida_gms` (un GM de una corrida: plan, candado y resultados parciales; §2.4)
-- ---------------------------------------------------------------------------
-- `estado` (zod): pendiente | en_proceso | hecho | reusado | fallido | sin_filas_libres | bloqueado_privacidad.
-- `modo` (zod): directo | jerarquico. `pliegue` es '' en una propuesta y D25, E25, D24... en una evaluación.
-- CANDADO (I6): tomar un paso es un único UPDATE `set estado = 'en_proceso', candado_token = :t, candado_desde = now()
-- where id = :id and estado in ('pendiente','en_proceso') and (candado_token is null or candado_desde < now() - 300 s)`.
-- Sin fila devuelta = 409 gm_en_proceso: si el navegador reintenta mientras el servidor sigue con la llamada, no hay doble
-- gasto. Al terminar el paso el servidor suelta el candado solo si el token coincide. `tg_ia_terminal` rechaza cambios sobre
-- filas en `hecho` o `reusado`.
-- `propuesta_gm_id` se añade más abajo (sección 8): FK circular con `ia_propuestas_gm`.
-- `referencia` (solo evaluación): por id corto de fila, la predicción del método, la de tendencia y el real. NO se envía nunca.
create table if not exists public.ia_corrida_gms (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null
    constraint ia_corrida_gms_corrida_id_fkey
      references public.ia_corridas(id) on delete restrict,
  pliegue text not null default ''
    constraint ia_corrida_gms_pliegue_len_check
      check (char_length(pliegue) <= 40),
  gm_clave text not null
    constraint ia_corrida_gms_gm_clave_len_check
      check (char_length(gm_clave) <= 80),
  estado text not null default 'pendiente',
  modo text,
  plan jsonb
    constraint ia_corrida_gms_plan_check
      check (plan is null or jsonb_typeof(plan) = 'array'),
  parcial jsonb not null default '{}'::jsonb
    constraint ia_corrida_gms_parcial_check
      check (jsonb_typeof(parcial) = 'object'),
  bloque_ids uuid[] not null default '{}',
  huella_gm text
    constraint ia_corrida_gms_huella_gm_len_check
      check (huella_gm is null or char_length(huella_gm) = 64),
  candado_token uuid,
  candado_desde timestamptz,
  referencia jsonb
    constraint ia_corrida_gms_referencia_check
      check (referencia is null or jsonb_typeof(referencia) = 'object'),
  error_codigo text
    constraint ia_corrida_gms_error_codigo_len_check
      check (error_codigo is null or char_length(error_codigo) <= 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- También cubre la FK a la corrida (`corrida_id` va primero).
  constraint ia_corrida_gms_corrida_pliegue_gm_key unique (corrida_id, pliegue, gm_clave)
);

create or replace trigger set_updated_at before update on public.ia_corrida_gms
  for each row execute function public.tg_set_updated_at();

comment on table public.ia_corrida_gms is
  'M7 07e 0.15.0: un GM de una corrida (x pliegue en evaluacion): plan de pasos, candado (candado_token y candado_desde, vence a los 300 s), salidas ya validadas por paso (parcial) y referencia de la evaluacion. Unico por (corrida, pliegue, GM). Sin activo: su vida es la de la corrida. En hecho o reusado tg_ia_terminal rechaza todo cambio.';
comment on column public.ia_corrida_gms.parcial is
  'M7 07e: salidas YA VALIDADAS por paso ({ n1: {...} }): cifras, razones restituidas y banderas. Nunca la entrada. El avance es el numero de claves dividido entre los pasos del plan.';
comment on column public.ia_corrida_gms.referencia is
  'M7 07e: solo evaluacion. Por id corto de fila, la prediccion del metodo, la de tendencia y el real del anio predicho. NO se envia nunca al proveedor.';

-- ---------------------------------------------------------------------------
-- 5. `ia_entradas` (lo enviado, canónico y comprimido; INMUTABLE; §2.5)
-- ---------------------------------------------------------------------------
-- `tipo` (zod): bloque | sufijo_reparto | lineas. Se escribe ANTES de llamar, así una llamada que se corta por tiempo también
-- deja su entrada. `huella` = sha-256 de la forma canónica del contenido; único por (corrida, huella): un reintento reusa la
-- fila. `contenido_gz` es el gzip del JSON canónico TAL COMO SE ENVIÓ (con alias, años relativos e ids cortos);
-- `diccionario` traduce ids cortos y alias a ids reales (ids, no nombres). Con ella se verifica la huella de cualquier llamada.
-- Sin `activo` ni `updated_at` (tabla inmutable).
create table if not exists public.ia_entradas (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null
    constraint ia_entradas_corrida_id_fkey
      references public.ia_corridas(id) on delete restrict,
  tipo text not null,
  huella text not null
    constraint ia_entradas_huella_len_check
      check (char_length(huella) = 64),
  contenido_gz bytea not null
    constraint ia_entradas_contenido_gz_size_check
      check (octet_length(contenido_gz) <= 2000000),
  bytes integer not null
    constraint ia_entradas_bytes_check
      check (bytes >= 0),
  diccionario jsonb not null
    constraint ia_entradas_diccionario_check
      check (jsonb_typeof(diccionario) = 'object'),
  created_at timestamptz not null default now(),
  -- También cubre la FK a la corrida (`corrida_id` va primero).
  constraint ia_entradas_corrida_huella_key unique (corrida_id, huella)
);

comment on table public.ia_entradas is
  'M7 07e 0.15.0: lo enviado al proveedor, canonico y comprimido (gzip), con el diccionario de ids cortos y alias. INMUTABLE (insert-only): tg_ia_inmutable rechaza update, delete y truncate, tambien para service_role. Solo lo lee el admin. El dueño de la base puede desactivar triggers: queda fuera del alcance de la aplicacion.';
comment on column public.ia_entradas.contenido_gz is
  'M7 07e: gzip del JSON canonico tal como se envio (alias, anios relativos, ids cortos). La unica columna con lo enviado; los logs no lo reciben.';

-- ---------------------------------------------------------------------------
-- 6. `ia_llamadas` (un intento contra el proveedor; INMUTABLE; §2.6)
-- ---------------------------------------------------------------------------
-- `tipo_llamada` (zod): natural | lineas | reparto. `estado` (zod): ok | invalida | error_proveedor | limite_proveedor |
-- tiempo_agotado | truncada | rechazada | clave_invalida. `huella_llamada` = sha-256 de { version_prompt, modelo, bloque,
-- sufijo }. `id_solicitud` es el id de la petición del proveedor (soporte); nunca cabeceras ni la clave. `error_detalle`
-- va saneado: nunca la clave, cabeceras ni datos. Única excepción a la inmutabilidad: `perfil_id` -> NULL (FK set null).
create table if not exists public.ia_llamadas (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null
    constraint ia_llamadas_corrida_id_fkey
      references public.ia_corridas(id) on delete restrict,
  corrida_gm_id uuid not null
    constraint ia_llamadas_corrida_gm_id_fkey
      references public.ia_corrida_gms(id) on delete restrict,
  paso text not null
    constraint ia_llamadas_paso_len_check
      check (char_length(paso) <= 10),
  tipo_llamada text not null,
  intento integer not null
    constraint ia_llamadas_intento_check
      check (intento >= 1),
  entrada_bloque_id uuid
    constraint ia_llamadas_entrada_bloque_id_fkey
      references public.ia_entradas(id) on delete restrict,
  entrada_sufijo_id uuid
    constraint ia_llamadas_entrada_sufijo_id_fkey
      references public.ia_entradas(id) on delete restrict,
  huella_llamada text not null
    constraint ia_llamadas_huella_llamada_len_check
      check (char_length(huella_llamada) = 64),
  estado text not null,
  modelo_respuesta text
    constraint ia_llamadas_modelo_respuesta_len_check
      check (modelo_respuesta is null or char_length(modelo_respuesta) <= 100),
  id_solicitud text
    constraint ia_llamadas_id_solicitud_len_check
      check (id_solicitud is null or char_length(id_solicitud) <= 120),
  bytes_entrada integer not null
    constraint ia_llamadas_bytes_entrada_check
      check (bytes_entrada >= 0),
  filas_enviadas integer not null
    constraint ia_llamadas_filas_enviadas_check
      check (filas_enviadas >= 0),
  tokens_entrada integer not null default 0
    constraint ia_llamadas_tokens_entrada_check
      check (tokens_entrada >= 0),
  tokens_salida integer not null default 0
    constraint ia_llamadas_tokens_salida_check
      check (tokens_salida >= 0),
  tokens_entrada_cache integer not null default 0
    constraint ia_llamadas_tokens_entrada_cache_check
      check (tokens_entrada_cache >= 0),
  costo_usd numeric(10, 4) not null default 0
    constraint ia_llamadas_costo_usd_check
      check (costo_usd >= 0),
  duracion_ms integer not null
    constraint ia_llamadas_duracion_ms_check
      check (duracion_ms >= 0),
  esperar_ms integer
    constraint ia_llamadas_esperar_ms_check
      check (esperar_ms is null or esperar_ms >= 0),
  error_codigo text
    constraint ia_llamadas_error_codigo_len_check
      check (error_codigo is null or char_length(error_codigo) <= 60),
  error_detalle text
    constraint ia_llamadas_error_detalle_len_check
      check (error_detalle is null or char_length(error_detalle) <= 300),
  perfil_id uuid
    constraint ia_llamadas_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists ia_llamadas_corrida_created_idx on public.ia_llamadas (corrida_id, created_at);
create index if not exists ia_llamadas_corrida_gm_id_idx on public.ia_llamadas (corrida_gm_id);
create index if not exists ia_llamadas_entrada_bloque_id_idx on public.ia_llamadas (entrada_bloque_id);
create index if not exists ia_llamadas_entrada_sufijo_id_idx on public.ia_llamadas (entrada_sufijo_id);
-- Los topes por usuario y día y por mes suman `costo_usd` por ventana de tiempo: el prefijo (perfil_id) cubre la FK.
create index if not exists ia_llamadas_perfil_created_idx on public.ia_llamadas (perfil_id, created_at);
create index if not exists ia_llamadas_created_at_idx on public.ia_llamadas (created_at);

comment on table public.ia_llamadas is
  'M7 07e 0.15.0: un intento contra el proveedor (tokens, costo, duracion, huella, estado). INMUTABLE (insert-only): tg_ia_inmutable rechaza update, delete y truncate, tambien para service_role; unica excepcion, perfil_id a NULL. Nunca guarda la respuesta cruda ni la clave.';

-- ---------------------------------------------------------------------------
-- 7. `ia_propuestas_gm` (una por GM terminado; INMUTABLE; §2.7)
-- ---------------------------------------------------------------------------
-- La vigente de un GM es la más reciente: índice `(proyeccion_id, gm_clave, created_at desc)`.
-- `modo` (zod): directo | jerarquico. `meta` es la foto de `MetaGMApi` al generar. `desvio_suma_modelo` = suma de lo que
-- devolvió el modelo / meta libre - 1. Excepciones a la inmutabilidad: `proyeccion_id` y `perfil_id` -> NULL (FK set null).
create table if not exists public.ia_propuestas_gm (
  id uuid primary key default gen_random_uuid(),
  corrida_id uuid not null
    constraint ia_propuestas_gm_corrida_id_fkey
      references public.ia_corridas(id) on delete restrict,
  corrida_gm_id uuid not null
    constraint ia_propuestas_gm_corrida_gm_id_fkey
      references public.ia_corrida_gms(id) on delete restrict,
  proyeccion_id uuid
    constraint ia_propuestas_gm_proyeccion_id_fkey
      references public.proyecciones(id) on delete set null,
  pliegue text not null default ''
    constraint ia_propuestas_gm_pliegue_len_check
      check (char_length(pliegue) <= 40),
  gm_clave text not null
    constraint ia_propuestas_gm_gm_clave_len_check
      check (char_length(gm_clave) <= 80),
  genero_id uuid not null
    constraint ia_propuestas_gm_genero_id_fkey
      references public.generos(id) on delete restrict,
  mundo_id uuid not null
    constraint ia_propuestas_gm_mundo_id_fkey
      references public.mundos(id) on delete restrict,
  es_resto boolean not null,
  capacidades text[] not null,
  modo text not null,
  version_metodo integer not null,
  meta jsonb
    constraint ia_propuestas_gm_meta_check
      check (meta is null or jsonb_typeof(meta) = 'object'),
  huella_gm text not null
    constraint ia_propuestas_gm_huella_gm_len_check
      check (char_length(huella_gm) = 64),
  huella_historia text not null
    constraint ia_propuestas_gm_huella_historia_len_check
      check (char_length(huella_historia) = 64),
  razon_gm text
    constraint ia_propuestas_gm_razon_gm_len_check
      check (razon_gm is null or char_length(razon_gm) <= 600),
  banderas_gm text[] not null default '{}',
  avisos text[] not null default '{}',
  filas_pedidas integer not null
    constraint ia_propuestas_gm_filas_pedidas_check
      check (filas_pedidas >= 0),
  filas_validas integer not null
    constraint ia_propuestas_gm_filas_validas_check
      check (filas_validas >= 0),
  desvio_suma_modelo numeric(8, 4),
  proveedor text not null
    constraint ia_propuestas_gm_proveedor_len_check
      check (char_length(proveedor) between 1 and 40),
  modelo text not null
    constraint ia_propuestas_gm_modelo_len_check
      check (char_length(modelo) between 1 and 100),
  version_prompt text not null
    constraint ia_propuestas_gm_version_prompt_len_check
      check (char_length(version_prompt) between 1 and 20),
  perfil_id uuid
    constraint ia_propuestas_gm_perfil_id_fkey
      references public.perfiles(id) on delete set null,
  usuario_nombre text,
  created_at timestamptz not null default now()
);

create index if not exists ia_propuestas_gm_corrida_id_idx on public.ia_propuestas_gm (corrida_id);
create index if not exists ia_propuestas_gm_corrida_gm_id_idx on public.ia_propuestas_gm (corrida_gm_id);
-- La más reciente por (proyección, GM) es la vigente; el prefijo (proyeccion_id) cubre la FK.
create index if not exists ia_propuestas_gm_vigente_idx
  on public.ia_propuestas_gm (proyeccion_id, gm_clave, created_at desc);
create index if not exists ia_propuestas_gm_gm_clave_idx on public.ia_propuestas_gm (gm_clave);
create index if not exists ia_propuestas_gm_genero_id_idx on public.ia_propuestas_gm (genero_id);
create index if not exists ia_propuestas_gm_mundo_id_idx on public.ia_propuestas_gm (mundo_id);
create index if not exists ia_propuestas_gm_perfil_id_idx on public.ia_propuestas_gm (perfil_id);

comment on table public.ia_propuestas_gm is
  'M7 07e 0.15.0: propuesta de la IA para un GM (una por GM terminado). INMUTABLE (insert-only): tg_ia_inmutable rechaza update, delete y truncate, tambien para service_role; excepciones: proyeccion_id y perfil_id a NULL. La vigente de un GM es la mas reciente de la proyeccion.';

-- ---------------------------------------------------------------------------
-- 8. `ia_corrida_gms.propuesta_gm_id` (cierra la FK circular)
-- ---------------------------------------------------------------------------
-- La pone `registrar_propuesta_ia_gm`. `restrict`: una propuesta con corrida no se borra.
alter table public.ia_corrida_gms
  add column if not exists propuesta_gm_id uuid
    constraint ia_corrida_gms_propuesta_gm_id_fkey
      references public.ia_propuestas_gm(id) on delete restrict;

create index if not exists ia_corrida_gms_propuesta_gm_id_idx on public.ia_corrida_gms (propuesta_gm_id);

comment on column public.ia_corrida_gms.propuesta_gm_id is
  'M7 07e: la propuesta que dejo (o reuso) este GM; la escribe solo registrar_propuesta_ia_gm. FK circular con ia_propuestas_gm: por eso la columna se anade despues de crear esa tabla.';

-- ---------------------------------------------------------------------------
-- 9. `ia_propuestas_filas` (una por fila base del GM al generar; INMUTABLE; §2.8)
-- ---------------------------------------------------------------------------
-- Libre o fija. `estado_meta` (zod): libre | fija_decidida | fija_pct (la cola larga va resumida en `ia_propuestas_gm.meta`).
-- `confianza` (zod): alta | media | baja. `fila_clave` sobrevive al `set null` de `fila_id` (que es nulo en evaluación).
-- `meta_y1_modelo` es el PESO de `asignarMeta` (D7); `meta_y1_al_generar` es la referencia de la absorción. Único por
-- (propuesta, fila_clave): una fila base aparece una sola vez en la propuesta. Excepción a la inmutabilidad: `fila_id` -> NULL.
create table if not exists public.ia_propuestas_filas (
  id uuid primary key default gen_random_uuid(),
  propuesta_gm_id uuid not null
    constraint ia_propuestas_filas_propuesta_gm_id_fkey
      references public.ia_propuestas_gm(id) on delete restrict,
  fila_id uuid
    constraint ia_propuestas_filas_fila_id_fkey
      references public.proyeccion_filas(id) on delete set null,
  fila_clave text not null
    constraint ia_propuestas_filas_fila_clave_len_check
      check (char_length(fila_clave) <= 300),
  estado_meta text not null,
  base_al_generar numeric(14, 2),
  base_corregida_al_generar numeric(14, 2),
  p_gm_al_generar integer
    constraint ia_propuestas_filas_p_gm_check
      check (p_gm_al_generar is null or p_gm_al_generar >= 0),
  aporte_fijo_al_generar integer
    constraint ia_propuestas_filas_aporte_fijo_check
      check (aporte_fijo_al_generar is null or aporte_fijo_al_generar >= 0),
  natural_y1 integer
    constraint ia_propuestas_filas_natural_y1_check
      check (natural_y1 is null or natural_y1 >= 0),
  razon_natural text
    constraint ia_propuestas_filas_razon_natural_len_check
      check (razon_natural is null or char_length(razon_natural) <= 200),
  meta_y1_modelo integer
    constraint ia_propuestas_filas_meta_y1_modelo_check
      check (meta_y1_modelo is null or meta_y1_modelo >= 0),
  meta_y1_al_generar integer
    constraint ia_propuestas_filas_meta_y1_al_generar_check
      check (meta_y1_al_generar is null or meta_y1_al_generar >= 0),
  razon text
    constraint ia_propuestas_filas_razon_len_check
      check (razon is null or char_length(razon) <= 300),
  banderas text[] not null default '{}',
  senales text[] not null default '{}',
  avisos text[] not null default '{}',
  confianza text,
  created_at timestamptz not null default now(),
  -- También cubre la FK a la propuesta (`propuesta_gm_id` va primero).
  constraint ia_propuestas_filas_propuesta_fila_key unique (propuesta_gm_id, fila_clave)
);

create index if not exists ia_propuestas_filas_fila_id_idx on public.ia_propuestas_filas (fila_id);

comment on table public.ia_propuestas_filas is
  'M7 07e 0.15.0: una fila por fila base del GM al generar (libre o fija), con el natural, el peso del modelo, la cifra de referencia de la absorcion, la razon y las banderas. INMUTABLE (insert-only): tg_ia_inmutable rechaza update, delete y truncate, tambien para service_role; excepcion: fila_id a NULL. Unica por (propuesta, fila_clave).';

-- ---------------------------------------------------------------------------
-- 10. `proyeccion_fila_anios.decision_ia_fila_id` (D2, §2.9)
-- ---------------------------------------------------------------------------
-- No nulo = el `decidido` vigente salió de «Aceptar IA» y apunta a la propuesta aceptada. Lo pone SOLO el servicio de aceptar;
-- cualquier otra decisión sobre el registro lo vuelve null. `calcular` no lo toca (su upsert no escribe columnas de decisión)
-- y `copiar_de` lo copia. El `check` exige `origen = 'manual'`: el de `origen` (0018) no admite otro valor y no se puede
-- ampliar sin `drop`. `coalesce(..., false)` cierra el hueco del nulo: con `origen` nulo (fila sin decidir) la comparación
-- `origen = 'manual'` da nulo y un `check` deja pasar el nulo, así que sin el `coalesce` una fila sin decidir podría llevar
-- traza de IA; «Volver a la propuesta» pone `decidido`, `origen` y `decision_ia_fila_id` en nulo a la vez, y sigue valiendo.
-- Va DENTRO del mismo `add column if not exists`: si la columna ya existe la cláusula entera se omite, así la migración
-- repite sin error y sin bloque `do $$`. Nullable: inocuo para el código de 0.13.x y 0.14.x.
alter table public.proyeccion_fila_anios
  add column if not exists decision_ia_fila_id uuid
    constraint proyeccion_fila_anios_decision_ia_fila_id_fkey
      references public.ia_propuestas_filas(id) on delete restrict
    constraint proyeccion_fila_anios_decision_ia_origen_check
      check (decision_ia_fila_id is null or coalesce(origen = 'manual', false));

create index if not exists proyeccion_fila_anios_decision_ia_fila_id_idx
  on public.proyeccion_fila_anios (decision_ia_fila_id);

comment on column public.proyeccion_fila_anios.decision_ia_fila_id is
  'M7 07e (D2): no nulo = el decidido vigente salio de Aceptar IA y apunta a la propuesta aceptada (ia_propuestas_filas). Solo lo escribe el servicio de aceptar; cualquier otra decision lo vuelve null; calcular no lo toca y copiar_de lo copia. check: solo con origen manual.';

-- ---------------------------------------------------------------------------
-- 11. Triggers de inmutabilidad y de estado terminal (§2.12)
-- ---------------------------------------------------------------------------
-- `tg_ia_inmutable()`: UNA función para las cuatro tablas inmutables. Rechaza DELETE, TRUNCATE (trigger por sentencia: uno
-- por fila no lo cubre) y todo UPDATE salvo el que SOLO pone en NULL una FK `on delete set null` de esa tabla (las lista el
-- `case`): lo emite la FK al borrar un usuario, una proyección o una fila, y el historial sobrevive sin el vínculo. Patrón
-- `to_jsonb(new) - col = to_jsonb(old) - col` de `tg_compra_eventos_inmutable`. SQLSTATE `restrict_violation`.
-- Las ramas de DELETE y TRUNCATE no tocan `old`/`new` (en TRUNCATE no existen).
create or replace function public.tg_ia_inmutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_cols text[];
  v_col text;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'UPDATE' then
    v_cols := case tg_table_name
      when 'ia_llamadas' then array['perfil_id']
      when 'ia_propuestas_gm' then array['perfil_id', 'proyeccion_id']
      when 'ia_propuestas_filas' then array['fila_id']
      else array[]::text[]
    end;
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    if (v_new - v_cols) = (v_old - v_cols) then
      foreach v_col in array v_cols loop
        if (v_new -> v_col) is distinct from (v_old -> v_col) and (v_new ->> v_col) is not null then
          raise exception '% es un registro inmutable: solo se admite poner % en NULL', tg_table_name, v_col
            using errcode = 'restrict_violation';
        end if;
      end loop;
      return new;
    end if;
  end if;
  raise exception '% es un registro inmutable: no admite cambios, borrados ni vaciado', tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.tg_ia_inmutable() from public, anon, authenticated;
grant execute on function public.tg_ia_inmutable() to service_role;

comment on function public.tg_ia_inmutable() is
  'M7 07e: trigger de las cuatro tablas inmutables de la IA (ia_entradas, ia_llamadas, ia_propuestas_gm, ia_propuestas_filas). Rechaza delete, truncate y todo update salvo el que solo pone en NULL una FK on delete set null de la tabla. Vale tambien para service_role.';

create or replace trigger ia_entradas_inmutable
  before update or delete on public.ia_entradas
  for each row execute function public.tg_ia_inmutable();
create or replace trigger ia_entradas_sin_vaciado
  before truncate on public.ia_entradas
  for each statement execute function public.tg_ia_inmutable();

create or replace trigger ia_llamadas_inmutable
  before update or delete on public.ia_llamadas
  for each row execute function public.tg_ia_inmutable();
create or replace trigger ia_llamadas_sin_vaciado
  before truncate on public.ia_llamadas
  for each statement execute function public.tg_ia_inmutable();

create or replace trigger ia_propuestas_gm_inmutable
  before update or delete on public.ia_propuestas_gm
  for each row execute function public.tg_ia_inmutable();
create or replace trigger ia_propuestas_gm_sin_vaciado
  before truncate on public.ia_propuestas_gm
  for each statement execute function public.tg_ia_inmutable();

create or replace trigger ia_propuestas_filas_inmutable
  before update or delete on public.ia_propuestas_filas
  for each row execute function public.tg_ia_inmutable();
create or replace trigger ia_propuestas_filas_sin_vaciado
  before truncate on public.ia_propuestas_filas
  for each statement execute function public.tg_ia_inmutable();

-- `tg_ia_terminal()`: en `ia_evaluaciones` (completa, fallida, cancelada) e `ia_corridas` (completa, parcial, detenida,
-- cancelada, abandonada) rechaza todo cambio y todo borrado cuando `old.estado` es terminal, salvo las FK `set null`
-- (`perfil_id`; y `proyeccion_id` en corridas); en `ia_corrida_gms`, cuando `old.estado` es hecho o reusado (sin excepciones).
-- `updated_at` se excluye de la comparación: el trigger `set_updated_at` lo mueve en el mismo UPDATE. Un estado que no es
-- terminal pasa sin más.
create or replace function public.tg_ia_terminal()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_terminal boolean;
  v_cols text[];
  v_col text;
  v_old jsonb;
  v_new jsonb;
begin
  v_terminal := case tg_table_name
    when 'ia_corrida_gms' then old.estado in ('hecho', 'reusado')
    when 'ia_corridas' then old.estado in ('completa', 'parcial', 'detenida', 'cancelada', 'abandonada')
    else old.estado in ('completa', 'fallida', 'cancelada')
  end;
  if not v_terminal then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_cols := case tg_table_name
      when 'ia_corridas' then array['perfil_id', 'proyeccion_id']
      when 'ia_evaluaciones' then array['perfil_id']
      else array[]::text[]
    end;
    v_old := to_jsonb(old) - 'updated_at';
    v_new := to_jsonb(new) - 'updated_at';
    if (v_new - v_cols) = (v_old - v_cols) then
      foreach v_col in array v_cols loop
        if (v_new -> v_col) is distinct from (v_old -> v_col) and (v_new ->> v_col) is not null then
          raise exception '% en estado % no admite cambios: solo se admite poner % en NULL', tg_table_name, old.estado, v_col
            using errcode = 'restrict_violation';
        end if;
      end loop;
      return new;
    end if;
  end if;
  raise exception '% en estado % no admite cambios ni borrados', tg_table_name, old.estado
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.tg_ia_terminal() from public, anon, authenticated;
grant execute on function public.tg_ia_terminal() to service_role;

comment on function public.tg_ia_terminal() is
  'M7 07e: trigger de ia_evaluaciones, ia_corridas e ia_corrida_gms. Con old.estado terminal (evaluaciones: completa, fallida, cancelada; corridas: completa, parcial, detenida, cancelada, abandonada; GM: hecho, reusado) rechaza todo cambio y borrado, salvo poner en NULL perfil_id (y proyeccion_id en corridas).';

-- Orden de disparo: alfabético por nombre. `ia_*_terminal` corre antes que `set_updated_at`.
create or replace trigger ia_evaluaciones_terminal
  before update or delete on public.ia_evaluaciones
  for each row execute function public.tg_ia_terminal();
create or replace trigger ia_corridas_terminal
  before update or delete on public.ia_corridas
  for each row execute function public.tg_ia_terminal();
create or replace trigger ia_corrida_gms_terminal
  before update or delete on public.ia_corrida_gms
  for each row execute function public.tg_ia_terminal();

-- ---------------------------------------------------------------------------
-- 12. `venta_lineas_ia(p_gml_ids, p_grupos, p_desde, p_hasta)` (§2.10)
-- ---------------------------------------------------------------------------
-- La ÚNICA lectura de venta del módulo. Lee `venta_stock_vigente` (solo cargas publicadas) y SELECCIONA ÚNICAMENTE
-- `unidades`: ni `venta_soles`, ni `costo_vendido`, ni `stock_unidades`, ni `stock_valorizado` (D12, §5.5). Solo tiendas de
-- tipo Tienda (como `venta_proyeccion`) y solo periodos entre `p_desde` y `p_hasta` (el corte de un pliegue de evaluación se
-- aplica aquí, en SQL; un límite nulo no acota ese lado).
--
-- `p_grupos` es `{ tienda_id: clave }` con las claves de pertenencia que guardó la proyección
-- (`parametros.bloques[Y].{mismas,nuevas,cierres,fuera}[].clave`); una tienda que no figura toma '00000', igual que
-- `venta_proyeccion`. Las claves salen del servidor solo como agregados derivados: nunca se envían al proveedor.
-- La agrupación de marca es la de la unidad de marca (`marcas_unidad` -> cabeza), como `venta_proyeccion`. El nodo GMLE lleva
-- la equivalencia (`equivalencia_id`); en un nodo GML es null y se suma todo el nodo.
--
-- Forma COMPACTA en columnas con diccionario (I10): una tupla por fila x clave x mes, en arrays paralelos del mismo orden
-- (fila, clave, mes), único por construcción:
--   { "dic": { "filas": [[gml_id, agrupacion_marca_id, equivalencia_id|null], ...],
--              "claves": ["11111", ...], "desde": "2023-01-01" },
--     "f": [índice en dic.filas], "c": [índice en dic.claves], "p": [meses desde dic.desde], "u": [unidades netas],
--     "cargas": { "2023-01": "<carga_id>", ... } }
-- `dic.desde` es el primer periodo con datos (null si no hay ninguno). Las unidades son netas (sin filtrar signos ni ceros).
-- `cargas` sale de la misma sentencia (mismo estado de datos) y solo cubre el rango pedido: sirve a las huellas.
-- Preagrega por (equivalencia, marca, clave, periodo) ANTES de subir a (nodo, agrupación): igual que 0027/0029, evita
-- agrupar cientos de miles de filas por una expresión de más columnas.
-- Orden determinista: mismos datos, mismo documento (útil para las huellas).
--
-- MEDICIÓN en vector-two: ver el bloque «MEDICIÓN 0030» al final de este archivo.
--
-- `stable`, `security invoker` y `search_path` vacío (todo calificado con esquema): la ejecuta solo el backend.
create or replace function public.venta_lineas_ia(
  p_gml_ids uuid[],
  p_grupos jsonb,
  p_desde date,
  p_hasta date
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with tds as materialized (
    select
      t.id as tienda_id,
      coalesce(p_grupos ->> t.id::text, '00000') as clave
    from public.tiendas t
    where t.tipo = 'Tienda'
  ),
  marcas_u as materialized (
    select mu.marca_id, cab.agrupacion_marca_id
    from public.marcas_unidad mu
    join public.marcas cab on cab.id = mu.unidad_marca_id
  ),
  equivalencias_nodo as materialized (
    select
      e.id as equivalencia_real_id,
      e.genero_mundo_linea_id as gml_id,
      case when n.nivel_planificacion = 'GMLE' then e.id end as equivalencia_id
    from public.equivalencias e
    join public.genero_mundo_linea n on n.id = e.genero_mundo_linea_id
    where e.genero_mundo_linea_id = any (coalesce(p_gml_ids, '{}'::uuid[]))
  ),
  por_equivalencia as (
    select
      v.equivalencia_id as equivalencia_real_id,
      v.marca_id,
      td.clave,
      v.periodo,
      sum(v.unidades)::bigint as unidades
    from public.venta_stock_vigente v
    join equivalencias_nodo q on q.equivalencia_real_id = v.equivalencia_id
    join tds td on td.tienda_id = v.tienda_id
    where v.periodo >= coalesce(p_desde, v.periodo)
      and v.periodo <= coalesce(p_hasta, v.periodo)
    group by v.equivalencia_id, v.marca_id, td.clave, v.periodo
  ),
  celdas as (
    select
      q.gml_id,
      mu.agrupacion_marca_id,
      q.equivalencia_id,
      p.clave,
      p.periodo,
      sum(p.unidades)::bigint as unidades
    from por_equivalencia p
    join equivalencias_nodo q on q.equivalencia_real_id = p.equivalencia_real_id
    join marcas_u mu on mu.marca_id = p.marca_id
    group by q.gml_id, mu.agrupacion_marca_id, q.equivalencia_id, p.clave, p.periodo
  ),
  desde as (
    select min(c.periodo) as d from celdas c
  ),
  indexadas as (
    select
      c.gml_id,
      c.agrupacion_marca_id,
      c.equivalencia_id,
      c.clave,
      c.unidades,
      (dense_rank() over (
        order by c.gml_id, c.agrupacion_marca_id nulls first, c.equivalencia_id nulls first
      ) - 1)::int as f,
      (dense_rank() over (order by c.clave) - 1)::int as k,
      (((extract(year from c.periodo) - extract(year from ds.d)) * 12)
        + (extract(month from c.periodo) - extract(month from ds.d)))::int as p
    from celdas c
    cross join desde ds
  )
  select jsonb_build_object(
    'dic',
      jsonb_build_object(
        'filas',
          coalesce(
            (select jsonb_agg(
                      jsonb_build_array(x.gml_id, x.agrupacion_marca_id, x.equivalencia_id)
                      order by x.f)
               from (select distinct i.f, i.gml_id, i.agrupacion_marca_id, i.equivalencia_id from indexadas i) x),
            '[]'::jsonb),
        'claves',
          coalesce(
            (select jsonb_agg(x.clave order by x.k)
               from (select distinct i.k, i.clave from indexadas i) x),
            '[]'::jsonb),
        'desde', (select d from desde)
      ),
    'f', coalesce((select jsonb_agg(i.f order by i.f, i.k, i.p) from indexadas i), '[]'::jsonb),
    'c', coalesce((select jsonb_agg(i.k order by i.f, i.k, i.p) from indexadas i), '[]'::jsonb),
    'p', coalesce((select jsonb_agg(i.p order by i.f, i.k, i.p) from indexadas i), '[]'::jsonb),
    'u', coalesce((select jsonb_agg(i.unidades order by i.f, i.k, i.p) from indexadas i), '[]'::jsonb),
    'cargas',
      coalesce(
        (select jsonb_object_agg(to_char(m.periodo, 'YYYY-MM'), m.id order by m.periodo)
           from public.cargas_venta_stock m
          where m.estado = 'publicada'
            and m.periodo >= coalesce(p_desde, m.periodo)
            and m.periodo <= coalesce(p_hasta, m.periodo)),
        '{}'::jsonb)
  );
$$;

revoke execute on function public.venta_lineas_ia(uuid[], jsonb, date, date) from public, anon, authenticated;
grant execute on function public.venta_lineas_ia(uuid[], jsonb, date, date) to service_role;

comment on function public.venta_lineas_ia(uuid[], jsonb, date, date) is
  'M7 07e 0.15.0: unica lectura de venta de la IA. Unidades (nunca soles, costos ni stock) de venta_stock_vigente, solo tiendas tipo Tienda, entre p_desde y p_hasta, por fila (nodo x agrupacion de marca x equivalencia si GMLE) x clave de pertenencia x mes, en arrays paralelos f, c, p, u con diccionario dic { filas, claves, desde } y cargas { aaaa-mm: carga_id }. Solo lectura. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 13. `registrar_propuesta_ia_gm(p jsonb) returns uuid` (§2.11; patrón M8)
-- ---------------------------------------------------------------------------
-- Graba la propuesta entera de UN GM o nada: todo en la transacción de la llamada. Pasos:
--   1. bloquea el GM de la corrida (`for update`) y exige `estado = 'en_proceso'` y `candado_token` igual al del payload;
--      si no, SQLSTATE 'IA001' (mensaje `gm_en_proceso`; la API lo traduce a 409 gm_en_proceso);
--   2. bloquea la corrida y exige `estado = 'en_curso'`; si no, SQLSTATE 'IA002' (`corrida_terminada`, 409);
--   3. modo normal: inserta `ia_propuestas_gm` y todas sus `ia_propuestas_filas`. Modo REUSO (`reusa_propuesta_id`): no inserta
--      nada y apunta a la propuesta reusada, que debe ser del mismo `gm_clave` (si no, SQLSTATE 'IA003',
--      `propuesta_no_reusable`);
--   4. pone el GM en `hecho` (o `reusado`) con `propuesta_gm_id` y `huella_gm`, suelta el candado y toca
--      `ia_corridas.ultima_actividad_at`.
-- Cualquier error a mitad revierte todo: no queda propuesta vacía ni a medias. De la corrida se toman `proyeccion_id`,
-- `proveedor`, `modelo` y `version_prompt` (no del payload); de la fila del GM, `corrida_id`, `pliegue` y `gm_clave`.
--
-- Payload:
--   { corrida_gm_id, candado_token, reusa_propuesta_id?, huella_gm?,
--     propuesta: { genero_id, mundo_id, es_resto, capacidades[], modo, version_metodo, meta?, huella_gm, huella_historia,
--                  razon_gm?, banderas_gm[], avisos[], filas_pedidas, filas_validas, desvio_suma_modelo?, perfil_id?,
--                  usuario_nombre? },
--     filas: [ { fila_id?, fila_clave, estado_meta, base_al_generar?, base_corregida_al_generar?, p_gm_al_generar?,
--                aporte_fijo_al_generar?, natural_y1?, razon_natural?, meta_y1_modelo?, meta_y1_al_generar?, razon?,
--                banderas[], senales[], avisos[], confianza? } ] }
-- En modo reuso `huella_gm` va al nivel superior (no hay `propuesta`).
-- `security invoker`, `search_path` vacío, solo `service_role`. Cuerpo sin comentarios `--`.
create or replace function public.registrar_propuesta_ia_gm(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_gm public.ia_corrida_gms%rowtype;
  v_corrida public.ia_corridas%rowtype;
  v_reusa uuid := nullif(p ->> 'reusa_propuesta_id', '')::uuid;
  v_prop jsonb := p -> 'propuesta';
  v_huella text;
  v_id uuid;
begin
  select * into v_gm
    from public.ia_corrida_gms
   where id = (p ->> 'corrida_gm_id')::uuid
     for update;
  if not found
     or v_gm.estado is distinct from 'en_proceso'
     or v_gm.candado_token is distinct from (p ->> 'candado_token')::uuid then
    raise exception 'gm_en_proceso' using errcode = 'IA001';
  end if;

  select * into v_corrida
    from public.ia_corridas
   where id = v_gm.corrida_id
     for update;
  if not found or v_corrida.estado is distinct from 'en_curso' then
    raise exception 'corrida_terminada' using errcode = 'IA002';
  end if;

  if v_reusa is not null then
    perform 1
       from public.ia_propuestas_gm
      where id = v_reusa
        and gm_clave = v_gm.gm_clave;
    if not found then
      raise exception 'propuesta_no_reusable' using errcode = 'IA003';
    end if;
    v_id := v_reusa;
    v_huella := p ->> 'huella_gm';
  else
    v_huella := v_prop ->> 'huella_gm';
    insert into public.ia_propuestas_gm (
      corrida_id, corrida_gm_id, proyeccion_id, pliegue, gm_clave, genero_id, mundo_id, es_resto, capacidades, modo,
      version_metodo, meta, huella_gm, huella_historia, razon_gm, banderas_gm, avisos, filas_pedidas, filas_validas,
      desvio_suma_modelo, proveedor, modelo, version_prompt, perfil_id, usuario_nombre
    )
    select
      v_gm.corrida_id, v_gm.id, v_corrida.proyeccion_id, v_gm.pliegue, v_gm.gm_clave, x.genero_id, x.mundo_id, x.es_resto,
      coalesce(x.capacidades, '{}'::text[]), x.modo, x.version_metodo, x.meta, x.huella_gm, x.huella_historia, x.razon_gm,
      coalesce(x.banderas_gm, '{}'::text[]), coalesce(x.avisos, '{}'::text[]), x.filas_pedidas, x.filas_validas,
      x.desvio_suma_modelo, v_corrida.proveedor, v_corrida.modelo, v_corrida.version_prompt, x.perfil_id, x.usuario_nombre
    from jsonb_to_record(v_prop) as x(
      genero_id uuid, mundo_id uuid, es_resto boolean, capacidades text[], modo text, version_metodo integer, meta jsonb,
      huella_gm text, huella_historia text, razon_gm text, banderas_gm text[], avisos text[], filas_pedidas integer,
      filas_validas integer, desvio_suma_modelo numeric, perfil_id uuid, usuario_nombre text
    )
    returning id into v_id;

    insert into public.ia_propuestas_filas (
      propuesta_gm_id, fila_id, fila_clave, estado_meta, base_al_generar, base_corregida_al_generar, p_gm_al_generar,
      aporte_fijo_al_generar, natural_y1, razon_natural, meta_y1_modelo, meta_y1_al_generar, razon, banderas, senales,
      avisos, confianza
    )
    select
      v_id, f.fila_id, f.fila_clave, f.estado_meta, f.base_al_generar, f.base_corregida_al_generar, f.p_gm_al_generar,
      f.aporte_fijo_al_generar, f.natural_y1, f.razon_natural, f.meta_y1_modelo, f.meta_y1_al_generar, f.razon,
      coalesce(f.banderas, '{}'::text[]), coalesce(f.senales, '{}'::text[]), coalesce(f.avisos, '{}'::text[]), f.confianza
    from jsonb_to_recordset(coalesce(p -> 'filas', '[]'::jsonb)) as f(
      fila_id uuid, fila_clave text, estado_meta text, base_al_generar numeric, base_corregida_al_generar numeric,
      p_gm_al_generar integer, aporte_fijo_al_generar integer, natural_y1 integer, razon_natural text,
      meta_y1_modelo integer, meta_y1_al_generar integer, razon text, banderas text[], senales text[], avisos text[],
      confianza text
    );
  end if;

  update public.ia_corrida_gms
     set estado = case when v_reusa is null then 'hecho' else 'reusado' end,
         propuesta_gm_id = v_id,
         huella_gm = coalesce(v_huella, huella_gm),
         candado_token = null,
         candado_desde = null,
         error_codigo = null
   where id = v_gm.id;

  update public.ia_corridas
     set ultima_actividad_at = now()
   where id = v_gm.corrida_id;

  return v_id;
end;
$$;

revoke execute on function public.registrar_propuesta_ia_gm(jsonb) from public, anon, authenticated;
grant execute on function public.registrar_propuesta_ia_gm(jsonb) to service_role;

comment on function public.registrar_propuesta_ia_gm(jsonb) is
  'M7 07e 0.15.0: graba la propuesta entera de un GM o nada (una transaccion). Exige GM en_proceso con el candado_token del payload (si no, SQLSTATE IA001 gm_en_proceso) y corrida en_curso (IA002 corrida_terminada). Modo reuso con reusa_propuesta_id (misma gm_clave, si no IA003): no inserta filas y deja el GM en reusado. Deja el GM en hecho con propuesta_gm_id, suelta el candado y toca ultima_actividad_at. Solo service_role.';

-- ---------------------------------------------------------------------------
-- 14. RLS (sin políticas: solo el backend con service_role) y permisos
-- ---------------------------------------------------------------------------
alter table public.ia_evaluaciones enable row level security;
alter table public.ia_configuraciones enable row level security;
alter table public.ia_corridas enable row level security;
alter table public.ia_corrida_gms enable row level security;
alter table public.ia_entradas enable row level security;
alter table public.ia_llamadas enable row level security;
alter table public.ia_propuestas_gm enable row level security;
alter table public.ia_propuestas_filas enable row level security;
-- `proyeccion_fila_anios` ya tiene RLS (0018); repetirlo es inocuo.
alter table public.proyeccion_fila_anios enable row level security;

revoke all on public.ia_evaluaciones from public, anon, authenticated;
grant all on public.ia_evaluaciones to service_role;
revoke all on public.ia_configuraciones from public, anon, authenticated;
grant all on public.ia_configuraciones to service_role;
revoke all on public.ia_corridas from public, anon, authenticated;
grant all on public.ia_corridas to service_role;
revoke all on public.ia_corrida_gms from public, anon, authenticated;
grant all on public.ia_corrida_gms to service_role;
revoke all on public.ia_entradas from public, anon, authenticated;
grant all on public.ia_entradas to service_role;
revoke all on public.ia_llamadas from public, anon, authenticated;
grant all on public.ia_llamadas to service_role;
revoke all on public.ia_propuestas_gm from public, anon, authenticated;
grant all on public.ia_propuestas_gm to service_role;
revoke all on public.ia_propuestas_filas from public, anon, authenticated;
grant all on public.ia_propuestas_filas to service_role;

-- ---------------------------------------------------------------------------
-- MEDICIÓN 0030 (venta_lineas_ia en vector-two)
-- ---------------------------------------------------------------------------
-- (se completa tras medir; ver más abajo)
