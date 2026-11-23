# 07h · Plan por tienda y mesa de decisión por GML (proyección por tienda, Vector2 y planner lado a lado; aprobación por lámina; escritura de vuelta a la proyección)

> **Estado: especificación (2026-11-21), sin construir, pendiente de la revisión del `arquitecto-revisor` y de las respuestas de Javier (§11).** Ficha de la familia de M7. Base: rama `claude/epic-faraday-40fzee`, HEAD `1bb2200`, versión vigente `0.19.0 · M14`. **Fuente principal:** el documento de Javier «Vector2 · Plan por tienda y mesa de decisión por GML» (2026-11-16, recibido el 2026-11-21; en esta ficha, «las instrucciones», citadas por su número de sección, p. ej. «instr. §5»). Fuente secundaria: el primer pedido del 2026-11-21 (prototipo «Mesa de decisión GML 2027»); donde difieren, mandan las instrucciones. **Tres entregas** (§8): **`0.19.3 · M7 i`** (las dos correcciones previas de M7 de instr. §3, sin migración), **`0.20.0 · M7 j`** (carga parcial, motor, láminas, planner, mesa con ajustes y aprobación, Excel; migración **`0042_plan_por_tienda.sql`**, que trae también los objetos de la escritura) y **`0.20.1 · M7 j`** (escritura de vuelta y sus efectos en 07g y M14; sin migración si la `0042` basta, si no la siguiente libre y entonces la etiqueta pasa a `0.21.0 · M7 j`). Commits `M7: ...`. Depende de [07](07-proyeccion-anual.md) (bloques `M(Z)`, `N(Z)`, `C(Z)`; filas base y de tienda; regla 23; `aplicarDecision`; cola larga; cierre), [07b](07b-apertura-en-la-linea.md) (fijar una fila de tienda mueve el total a `max(D + Δ, Σ fijadas)`), [07f](07f-venta-por-tienda-en-crecimientos.md) (decisión 111, sin cambios), [07g](07g-aprobacion-en-bloque.md) (lotes `proyeccion_lotes` / `proyeccion_lote_filas`; decisión 82), [06e](06e-cierre-del-anio-y-base-sin-nino.md) (factores del Niño), [M4](04-tiendas.md), [M5](05-venta-stock.md), 02b y [M14](14-dashboard-aprobacion-direccion.md). **Todas las cifras de esta ficha son sintéticas**; las de instr. §5.5 y §10 son reales y no entran al repositorio (§6.3).

**Lo que pide Javier (instr. §0 y §1):** planificar el cierre del año en curso y el año siguiente **tienda por tienda y GML por GML**. Para cada **lámina** (un GML o un grupo de GML que el planner trabaja junto) ver lado a lado tres cifras —**la proyección por tienda** (un motor de ritmo; el prototipo la llama «Claudio»), **la proyección actual de Vector2** y **la del planner** (Luis)—, corregir a mano cualquier tienda, con **Benavides (R512) siempre aparte** («tiendas actuales» y «aperturas» se guardan y suman por separado: primero tiendas actuales, después Benavides y al final el total), **aprobar la lámina** eligiendo la fuente de cada año y dejando una nota, y que lo aprobado **vuelva a la proyección de Vector2** (filas decididas) y de ahí al flujo y las compras (M8). Exportar el Excel `plan_claudio`.

## 1. Objetivo

Hoy el volumen de 2027 se decide cruzando a mano tres números de tres sitios: la proyección de Vector2 (por GML × agrupación de marca, sin detalle por tienda en las tiendas existentes), el Excel del planner (por línea y con sus propias agrupaciones de marca) y una lectura de ritmo por tienda que nadie guarda. 07h pone las tres en **una pantalla por lámina** con el detalle por tienda de un **motor reproducible dentro de Vector2** (instr. §5), deja a Javier ajustar tiendas y aprobar la lámina con la fuente elegida, guarda cada aprobación como fila nueva (la vigente es la última) y **escribe lo aprobado en la proyección en trabajo como un lote auditable de 07g**, nunca en la cerrada. Antes, una entrega corta corrige dos defectos de M7 que inflan la columna Vector2 (instr. §3).

### 1.1 Decisiones de diseño (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Una «versión del plan por tienda»** (`plan_tienda_versiones`) = una corrida del motor con su corte y sus parámetros, **atada a la proyección en trabajo que recibirá lo aprobado** (instr. §7). Ajustes, decisiones y escrituras cuelgan de la versión. Una cerrada o archivada solo se abre como **referencia de lectura** (columna Vector2), nunca como destino. | Instr. §8 e §11: la cerrada es inmutable. Atar la versión al destino evita aprobar algo que no se puede escribir. Qué proyección recibe lo aprobado es la pregunta 1 de instr. §12 (§11). |
| D2 | **Venta del mes en curso: carga parcial propia del módulo**, por tienda × GML, con `hasta_fecha`, marcada parcial y **superada sola** cuando M5 publica el mes cerrado (instr. §4.1). **Nunca** entra en `venta_stock_mensual` ni en `venta_stock_vigente`. §5.4. | M5 carga meses cerrados por equivalencia × marca × talla y de ahí leen curvas (M6), factores del Niño (06e), proyección (M7), flujo (M8) y el tablero (M14): un mes a medias ahí los contaminaría a todos. El Excel llega por género × mundo × línea × tienda: su grano natural es GML. |
| D3 | **Motor en TypeScript puro** (`src/lib/plan-tienda/motor.ts`, `VERSION_MOTOR = 1`) con las fórmulas de instr. §5 **generalizadas** a año en curso `Y` y corte `d` (los 0,40 y 0,60 salen de `día(d) ÷ días del mes`), alimentado por una función SQL de agregados (`plan_tienda_venta_motor`, como `tablero_venta`). Los resultados quedan en `plan_tienda_valores` (instr. §7) con su `propuesto` inmutable. | Las ramas (temporada, anualización, tienda nueva, Benavides) se prueban mejor en vitest; los agregados en SQL evitan traer 100 mil tuplas. |
| D4 | **Las tiendas se clasifican con los bloques de M7**, no con códigos: «antiguas» = `M(Y)` (2025 completo, instr. §5); «nueva sin año comparable» = actual sin estar en `M(Y)` (hoy R511); **«aperturas» = `N(Z).aperturas`** (hoy R512 en 2027), siempre aparte; los cierres de `Z` también aparte. §5.1.3. | Es exactamente la frontera entre fila base y fila de tienda de la proyección, por donde pasa la escritura; evita el doble conteo y deja la próxima apertura aparte sin tocar código (instr. §1: «poder mover Benavides después sin tocar el resto»). |
| D5 | **Láminas en un catálogo global editable** (`plan_tienda_laminas` + `plan_tienda_lamina_gml`) con `slug` estable; un GML en a lo sumo una lámina; **«Otras líneas menores» por género implícita**; los grupos iniciales de instr. §4.3 se cargan **como datos** (importador de láminas), no como código ni como semilla de la migración. | Un GML nuevo nunca queda fuera. Las migraciones del repo no llevan seed y los nombres de líneas son datos del negocio. |
| D6 | **Ajustes en `plan_tienda_valores.ajustado`** (por GML × tienda × año, con quién y cuándo), con un historial de solo inserción; un ajuste por tienda **a nivel lámina se reparte entre sus GML en proporción a su `propuesto`** (instr. §7, mayor resto). **Decisiones en `plan_tienda_decisiones`, de solo inserción**, una fila por lámina × año y acto; la vigente es la última. | Instr. §7. El reparto proporcional es lo único que deja escribir después por GML sin inventar una mezcla. |
| D7 | **Ajustan admin y planner; aprueba solo el admin** (hoy, Javier). Cambiarlo es la pregunta 4 de instr. §12. | Decisión 139 (M14). |
| D8 | **La escritura de vuelta es un lote de 07g** (`proyeccion_lotes` de tipo **`plan_tienda`**, una línea por registro en `proyeccion_lote_filas`, instr. §8.3), escrito por una **función hermana** `aplicar_lote_plan_tienda` (mismo candado, dos pasadas, `updated_at`, idempotencia y conteos reales que `aplicar_lote_proyeccion`, que **no se toca**), con la lógica de M7 (`aplicarDecision`, `moverTotalTienda`, `repartirEntero`) y **sin reimplementar el reparto mensual**. Las filas escritas llevan **`origen = 'manual'` y `decision_lote_id`** del lote; **no** `origen = 'plan_tienda'` (§1.2 C7). | Reutiliza la auditoría que ya existe (pedido de Javier) y su «deshacer». La función de 07g solo escribe filas sin decidir (`ya_decidida`); la mesa escribe filas decididas con confirmación, así que necesita su propia condición sin alterar el contrato de 07g. |
| D9 | **Reparto de lo aprobado** (instr. §8.1): por GML (del detalle por tienda), por **bloque de tiendas** (lo de `M(Z)` a las filas base, lo de R511 en 2026 a sus filas `nuevas_anterior`, lo de R512 a sus filas `aperturas`) y dentro de cada bloque **en proporción al `propuesto`** del año (si es 0, `vendido`; si también, la venta de `Y−1` de la fila), con **mayor resto** y **piso de lo vendido en `Y`** (regla de M7). §5.6. | Instr. §8 y regla 41 de M7 (`menor_que_vendido`). |
| D10 | **Conflictos con lo fijado a mano: se listan y se pide confirmación** (instr. §8.6): por lámina, «pisar lo fijado a mano» o «respetarlo (el resto de la lámina absorbe la diferencia)»; sin elección, `409 conflictos_sin_resolver`. Pisar exige admin. | Instr. §8.6. Matiza la decisión 82 D2 (ningún lote toca lo decidido a mano) para este acto explícito y confirmado. |
| D11 | **El detalle por tienda aprobado se guarda** (`plan_tienda_valores`, instr. §8.4) **pero no alimenta todavía** «Ver por tienda» de 07f, la atribución de M14 ni el flujo por tienda de M8. | Decisión 111 sin cambios; el flujo de M8 es a nivel red. Queda previsto (instr. §8.4). |
| D12 | **«Recalcular el flujo» (instr. §8.5) se interpreta como mostrar el antes y el después de la proyección** por GML y en total (tiendas y Benavides por separado). **M8 solo lee la cerrada**: el flujo cambia cuando la proyección en trabajo se cierra con el cierre normal. §1.2 C9. | Contrato de M8 (07 §7, decisión 138). |
| D13 | **Sin tiempo real**: refresco al volver a la pestaña y sondeo ligero cada 60 s; toda escritura lleva la versión vista y responde `409` si otra persona guardó antes. | El repo no usa canales en vivo. |
| D14 | **Kit de Vector2**, no la marca del prototipo; usable en 390 px. | Coherencia. |
| D15 | **Nombre de pantalla del motor: «Por tienda»** (opción «Tiendas» de las instrucciones, título «Proyección por tienda»); en código, `motor`. El planner se rotula «Planner» con el nombre de quien subió el archivo. El Excel conserva `plan_claudio` (instr. §9). | Decisión abierta (§11). |

### 1.2 Dónde chocan las instrucciones con lo que ya hay

| # | Las instrucciones dicen | Vector2 tiene hoy | Resolución |
|---|---|---|---|
| C1 | Venta del mes en curso hasta un día (instr. §4.1) | Solo meses cerrados (M5); lo último publicado es **septiembre de 2026**; octubre **no** está cargado | Carga parcial propia (D2, §5.4). El Excel cubre octubre y noviembre para el motor, pero **octubre debe cargarse por M5** para la corrección (b) de M7 y para la columna Vector2 (§5.4, §8.1) |
| C2 | Editar y escribir por tienda | Las tiendas existentes no tienen filas en la proyección | Escritura por bloque (D9); detalle por tienda guardado en la mesa (D11) |
| C3 | «Tiendas actuales» = filas `mismas` + `nuevas_anterior` de R511 | Para 2026, R511 es `N(2026).nuevas_anterior` (filas de tienda); para **2027**, R511 está en `M(2027)` (fila base) | En 2026 lo de R511 va a sus filas de tienda; en 2027, a la fila base con las demás (§5.6) |
| C4 | Benavides: `proyeccion_tiendas.decidido` de R512 para 2027 | Regla 23: decidir el total de una tienda **reescala todas sus filas no fijadas**, de todos los GML | Se fijan las filas de la lámina y el total se mueve a `max(D + Δ, Σ fijadas)` (07b): las filas de R512 de otras láminas no cambian (§5.6 paso 4) |
| C5 | Pisar decisiones manuales solo con aviso y confirmación | Decisión 82 D2: ningún lote toca lo decidido a mano | D10, decisión propuesta 158 |
| C6 | Lote de tipo `aprobar` | `aplicar_lote_proyeccion` con `aprobar` solo escribe filas **sin decidir**; «Reaprobar» de 07g reescribe toda fila con `decision_lote_id` cuyo valor de hoy difiere | Tipo propio `plan_tienda` y función hermana (D8); «Reaprobar» y «Revertir» de 07g excluyen los lotes `plan_tienda` (§5.7) |
| C7 | `origen = 'plan_tienda'` | `check (origen in ('propuesta','manual','escalada'))`; cambiar un `check` exige `DROP CONSTRAINT`, que las migraciones del repo prohíben, y M7, 07e, 07g y M14 razonan sobre esos tres valores | `origen = 'manual'` + `decision_lote_id` → lote `plan_tienda`; M14 distingue la clase por el tipo del lote (decisión propuesta 157) |
| C8 | «Escalar `meses[]` de cada fila conservando la curva» | El reparto mensual es de M7 (`repartirEntero` con la curva, reales hasta `k`); hay un fallo abierto: en las filas `escalada` los doce meses no suman su anual (el recálculo guarda meses nuevos con el `decidido` viejo); otra tarea lo corrige con el invariante «Σ meses = total vigente» | Se usa `aplicarDecision`/`moverTotalTienda`; la función comprueba Σ meses = vigente en cada registro escrito (R31) y la entrega `0.20.1` **depende** de esa corrección |
| C9 | «Recalcular el flujo (`huella_flujo`)» | M8 lee solo la cerrada | D12 |
| C10 | Correcciones de M7 (instr. §3): «dejar que el factor se calcule con 2 o más meses» | **`MIN_MESES_FACTOR = 2` ya está** (`tipos-api.ts:66`); el verano 2026 quedó sin calcular porque **solo septiembre** está publicado y alguien fijó 1,00 a mano | La corrección (b) es: cargar octubre por M5, avisar cuando el aplicado se aparta del calculado o se fijó sin cálculo (§8.1) |
| C11 | Cola larga: «no corregir por disponibilidad bajo un mínimo» y «que no se aprueben en bloque» | `A_f` no tiene tope (`cola-larga.ts:130`); el universo de 07g incluye `revision_cola_larga` (07g D1) | §8.1; sube `VERSION_METODO` a 6 |
| C12 | Corrección de invierno «hoy 0,68 (Vector2 tiene 0,70)» | El factor oficial vive en `factores_volumen_atipico` | El motor calcula la suya (instr. §5.4) y la muestra junto a la de M6 (§5.1.5) |
| C13 | Temporada del GML | M7 etiqueta cada fila con la agrupación dominante por `W12` | El motor usa la regla del primer pedido (equivalencia con más venta 2024–2025) y la mesa avisa si difiere de M7 (§5.1.2) |
| C14 | Láminas por GML | M7 decide por GML × agrupación de marca (y por equivalencia en nodos GMLE) | La escritura reparte entre todas las filas de los GML de la lámina; la AM no es dimensión de la mesa |
| C15 | Margen 2026 (costo ÷ venta) | M14 no lee `costo_vendido` por diseño | La mesa sí, solo admin y planner (decisión 161) |
| C16 | `plan_tienda_versiones.estado` (borrador / aprobada / aplicada) | Los estados del repo se derivan al leer cuando dependen de otras filas | Se deriva (§5.2); no hay columna que se desincronice |
| C17 | Cifras reales en la aceptación | Nada de datos reales en el repo | Caso sintético (§6.1); cifras reales en QA y en el hito, fuera del repo (§6.3) |

## 2. Modelo de datos (`supabase/migrations/0042_plan_por_tienda.sql`)

Convenciones de `docs/PLAN.md` §3 y de `0013` a `0041`: idempotente (`create table if not exists`, `add column if not exists`, `create or replace function`, `create index if not exists`, `create or replace trigger`), **sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`**, sin `do $$`, sin backfill ni seed, cuerpos de función sin `--`, identificadores ≤ 63. Tablas editables: `id uuid`, `activo`, `created_at`, `updated_at` (`tg_set_updated_at`), RLS activo **sin políticas**, `revoke all … from public, anon, authenticated` y `grant select, insert, update` a `service_role` (sin `delete`, `truncate`, `trigger`, `references`; regla de la `0035`). **Tablas de solo inserción** (`plan_tienda_carga_filas`, `plan_tienda_ajustes`, `plan_tienda_decisiones`, `planner_valores`): sin `activo` ni `updated_at` (excepción documentada como 07g y M14), trigger de inmutabilidad (solo admite poner en `null` una FK `on delete set null`; también contra `truncate`), `revoke all … from public, anon, authenticated, service_role` y `grant select, insert` a `service_role`; entran en la lista de tablas de solo inserción de `docs/PLAN.md`. Funciones `security invoker`, `set search_path = ''`, todo calificado, `execute` solo para `service_role`, `comment on`; listas de ids dentro del `jsonb`, sin SQL dinámico. Al final, `insert into public.migraciones_aplicadas (nombre, nota) values ('0042_plan_por_tienda', '…') on conflict (nombre) do nothing`. Se aplica con el MCP **en `vector-two`, nunca en `lukers-compras`**, tras el humo dos veces en local.

### 2.1 Tablas nuevas

#### a) Carga parcial: `plan_tienda_cargas` (cabecera) y `plan_tienda_carga_filas` (solo inserción)

| Columna (`plan_tienda_cargas`) | Tipo | Null | Notas |
|---|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | no | |
| `anio` | `integer` | no | año en curso de la carga (`check between 2024 and 2100`) |
| `hasta_fecha` | `date` | no | último día incluido (12-nov en el ejemplo). API: dentro de `anio` y **posterior** al último día del último mes publicado en M5 al cargar |
| `archivo_nombre` | `text` | no | 1–200 |
| `huella_archivo` | `text` | no | sha-256 (64 hex) de las filas normalizadas; único parcial entre activas (`409 carga_repetida`) |
| `filas`, `unidades_anio` | `integer` | no | medidos al guardar |
| `reporte` | `jsonb` | no | omitidas por motivo, cruce con los GML (las instrucciones esperan 99,8 %) y **conciliación con Vector2** por tienda en los años completos; `check (pg_column_size(reporte) <= 262144)` |
| `perfil_id` (`→ perfiles on delete set null`, índice), `usuario_nombre` | | | de la sesión |
| `activo` | `boolean not null default true` | no | **con uso**: retirar la pone en `false`; no se borra (las versiones la citan) |
| `created_at`, `updated_at` | | | |

Estado derivado al leer (no es columna): `vigente` (activa, la más reciente del año y `hasta_fecha` posterior al fin del último mes publicado), **`superada`** (M5 ya publicó el mes de `hasta_fecha` o uno posterior: el mes cerrado manda, §5.4), `retirada`.

`plan_tienda_carga_filas`: `id`, `carga_id` (`restrict`), `tienda_id` (`→ tiendas restrict`, solo tipo Tienda), `gml_id` (`→ genero_mundo_linea restrict`), `anio` (el de la carga, acumulado a `hasta_fecha`, o un año completo anterior para conciliar), `unidades integer ≥ 0` (un neto negativo se trunca a 0 y se avisa), `venta_soles numeric(14,2) null`, `cv numeric(8,4) null` (la métrica `CV Act` = costo ÷ venta, instr. §4.1), `created_at`. Único `(carga_id, tienda_id, gml_id, anio)`; índice `(carga_id, gml_id)`. ≈ 10 tiendas × 600 GML × 4 años ≈ 24 000 filas.

#### b) `plan_tienda_versiones` (una corrida del motor atada a su proyección destino)

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | `uuid pk` | no | |
| `proyeccion_id` | `uuid → proyecciones on delete restrict` | no | **en trabajo** al crear (API); destino de la escritura. Una proyección con versiones no se elimina (`409 tiene_plan_tienda`: se archiva) |
| `proyeccion_referencia_id` | `uuid → proyecciones on delete restrict` | sí | opcional: otra proyección (p. ej. la cerrada) que se muestra como segunda columna Vector2 de solo lectura (§4.4) |
| `nombre` | `text` | no | 1–80; único `(proyeccion_id, upper(nombre))` |
| `anio` | `integer` | no | año en curso `Y` = el de la proyección |
| `corte_real` | `date` | no | corte efectivo `d` (instr. §7): `hasta_fecha` de la carga parcial, o el último día de `k'` si no hay |
| `carga_id` | `uuid → plan_tienda_cargas on delete restrict` | sí | `null` = sin carga parcial |
| `k_publicado` | `date` | no | último mes publicado de M5 usado (`k'`) |
| `parametros` | `jsonb` | no | `ParametrosMotor` usados (§5.1.8), con la corrección de invierno ya calculada |
| `version_motor` | `integer` | no | `VERSION_MOTOR` al correr |
| `bloques` | `jsonb` | no | foto de `bloquesDeAnio` de `Y` y `Y+1` con que se clasificaron las tiendas |
| `huella_cargas`, `huella_maestros` | `text` | no | md5 del mapa `periodo → carga_id` leído en la misma sentencia y de tiendas, nodos, equivalencias y temporadas |
| `huella` | `text` | no | md5 de `version_motor | parametros | carga (id, huella_archivo) | huella_cargas | huella_maestros`: **misma huella ⇒ mismos `propuesto`** (R7) |
| `resumen` | `jsonb` | no | totales por género (tiendas actuales y aperturas por separado), conteos de avisos, `duracion_ms` |
| `perfil_id`, `usuario_nombre`, `activo` (con uso: archivar una versión), `created_at`, `updated_at` | | | **`creado_por`** de las instrucciones = `perfil_id` + `usuario_nombre` |

Índices: `(proyeccion_id, created_at desc)`, `(huella)`. **No hay columna `estado`** (C16): `borrador` / `aprobada` / `aplicada` se derivan (§5.2).

#### c) Láminas: `plan_tienda_laminas` y `plan_tienda_lamina_gml`

`plan_tienda_laminas`: `id`; **`slug`** (`^[a-z0-9]+(-[a-z0-9]+)*$`, ≤ 80, único, generado al crear y no editable: clave estable de decisiones y del Excel); `genero_id` (`restrict`); `nombre` (1–80; único `(genero_id, upper(nombre))` entre activas); `mundo_etiqueta` (≤ 60, texto libre: «Casual + formal», «Urbano»; instr. §7); `nota` (≤ 300, la nota del grupo que muestra la cabecera); **`es_otras`** (`boolean`, único parcial `(genero_id) where es_otras and activo`: una «Otras líneas menores» por género, sin filas de GML); `detallada_por_planner` (`boolean`, derivable pero guardado para ordenar la lista en «Detalladas por el planner» / «Sin detalle»; lo actualiza el importador del planner); `orden` (`integer null`); `activo`; timestamps.

`plan_tienda_lamina_gml`: `id`, `lamina_id` (`on delete cascade`, índice), `gml_id` (`restrict`, **único**: un GML en a lo sumo una lámina), timestamps; sin `activo` (el vínculo existe o no, como `agrupacion_estacionalidad_genero`; quitar borra la fila, excepción con `delete` para `service_role`). Todos los GML de una lámina son de su género (API).

#### d) `plan_tienda_valores` (motor + ajustes; una fila por versión × GML × tienda × año) y `plan_tienda_ajustes` (historial, solo inserción)

| Columna (`plan_tienda_valores`) | Tipo | Null | Notas |
|---|---|---|---|
| `version_id` | `uuid → plan_tienda_versiones on delete restrict` | no | PK compuesta con las tres siguientes |
| `gml_id` | `uuid → genero_mundo_linea restrict` | no | índice `(version_id, gml_id)` |
| `tienda_id` | `uuid → tiendas restrict` | no | |
| `anio` | `integer` | no | `Y` o `Y+1` |
| `tratamiento` | `text` | no | `check in ('antigua','nueva','apertura','cierre')` (§5.1.3) |
| `temporada` | `text` | sí | del GML para el motor |
| `historia` | `integer[]` | sí | solo en el registro de `Y`: `Y−3`, `Y−2`, `Y−1` y `Y` al corte; un elemento nulo = «—» |
| `real_corte` | `integer` | sí | `real26` (instr. §5): venta de `Y` hasta el corte; solo `Y` |
| `mismo_periodo_ant` | `integer` | sí | `mp25`; solo `Y` |
| `ritmo` | `numeric(8,4)` | sí | `T_sg` (en `Y`) o `T27` (en `Y+1`), ya acotado |
| `venta_soles`, `margen` | `numeric(14,2)`, `numeric(6,4)` | sí | de `Y` al corte; margen = `1 − cv` (o `1 − costo ÷ venta` de M5) |
| `propuesto` | `integer` | sí | lo del motor; en aperturas, el vigente de Vector2 de sus filas (instr. §5.4). **Inmutable**: solo lo escribe `guardar_version_plan_tienda` al crear |
| `ajustado` | `integer` | sí | `null` = sin ajuste; `check (ajustado >= 0)` |
| `final` | `integer generated always as (coalesce(ajustado, propuesto)) stored` | sí | instr. §7 |
| `ajustado_por` (`→ perfiles set null`), `ajustado_por_nombre`, `ajustado_at`, `nota` (≤ 300) | | sí | |
| `avisos` | `text[] not null default '{}'` | no | |
| `created_at`, `updated_at` | | no | |

Sin `id` ni `activo` (PK compuesta; filas de una versión). ≈ 600 GML × 12 tiendas × 2 años ≈ 14 000 filas por versión (solo combinaciones con venta en `Y−3 … Y` o con filas de apertura en la proyección). **R512 vive aquí como cualquier tienda** (instr. §7) con `tratamiento = 'apertura'`, y **toda suma la separa** por el tratamiento, no por el código. `ajustado` solo cambia por la función `ajustar_plan_tienda` (§2.3 d), que deja una fila por celda en `plan_tienda_ajustes` (`version_id`, `lamina_id`, `tienda_id`, `anio`, `valor_lamina_antes`, `valor_lamina_despues` —nulo = vuelve a la propuesta—, `reparto jsonb` por GML, `perfil_id`, `usuario_nombre`, `created_at`).

#### e) `plan_tienda_decisiones` (solo inserción; la vigente es la última)

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | `uuid pk` | no | |
| `version_id` | `uuid → plan_tienda_versiones restrict` | no | |
| `lamina_id` | `uuid → plan_tienda_laminas restrict` | no | |
| `acto_id` | `uuid` | no | agrupa las dos filas (2026 y 2027) de una misma aprobación o retiro |
| `secuencia` | `integer` | no | `check >= 1`; único `(version_id, lamina_id, anio, secuencia)`: `max + 1` asignado por la función comprobando la vista (concurrencia, R19) |
| `anio` | `integer` | no | `Y` o `Y+1` (instr. §7) |
| `tipo` | `text` | no | `check in ('aprobacion','retiro')` |
| `fuente` | `text` | sí | `check in ('tiendas','vector2','planner','manual')` (nombres de instr. §7); obligatoria en `aprobacion` |
| `valor_tiendas_actuales` | `integer` | sí | |
| `valor_aperturas` | `integer` | sí | Benavides (y toda apertura o cierre de ese año); en `Y` hoy 0 |
| `valor_total` | `integer` | sí | `check (valor_total = valor_tiendas_actuales + valor_aperturas)` |
| `gml_ids` | `uuid[]` | no | composición de la lámina al decidir (para «Otras», la implícita) |
| `fuentes` | `jsonb` | no | foto de las cuatro cifras del año al decidir (tiendas con y sin ajustes, Vector2 por bloque y aperturas, planner con su importación, manual) y del detalle final por tienda y GML que se escribirá; `check (pg_column_size(fuentes) <= 65536)` |
| `nota` | `text` | sí | ≤ 1 000; obligatoria (≥ 10) con `manual` o `retiro` |
| `aprobado_por` (`→ perfiles set null`, índice), `aprobado_por_nombre`, `rol` | | | `check (rol = 'admin')` hoy (D7) |
| `aprobado_at` | `timestamptz not null default now()` | no | |

`tipo = 'aprobacion'` ⇒ fuente y los tres valores no nulos; `retiro` ⇒ nulos. Índice `(version_id, lamina_id, anio, secuencia desc)`.

#### f) Planner: `planner_importaciones`, `planner_valores` (solo inserción) y `planner_mapeos`

- `planner_importaciones`: `id`, `anio`, `genero_id`, `archivo_nombre`, `huella_archivo`, `fecha_archivo` (la que declara quien sube: 08/10, 07/10), **`incluye_aperturas`** (`'si' | 'no' | 'desconocido'`, por defecto `'desconocido'`: pregunta 3 de instr. §12), `control jsonb` (cuadre de 2025 y ene–`k'` con Vector2 por lámina y género, §5.5), `perfil_id`, `usuario_nombre` (**subido_por**), `activo` (con uso), timestamps. La vigente de un género es la activa más reciente.
- `planner_valores`: `id`, `importacion_id` (`restrict`), `lamina_id` (`restrict`), `pestanas text[]` (las pestañas sumadas), `real_2025`, `real_ytd` (ene–sep), `cierre_2026`, `proy_2027` (`integer null ≥ 0`), `created_at`; único `(importacion_id, lamina_id)`.
- `planner_mapeos` (editable): `genero_id`, `pestana` (normalizada, 1–120), `lamina_id` (`cascade`) o `ignorar boolean`, `perfil_id`, `usuario_nombre`, timestamps; único `(genero_id, pestana)`. Recuerda «esta pestaña es esta lámina» (patrón de `mapeos_combinacion`).

### 2.2 Cambios en tablas existentes (aditivos; los usa `0.20.1`)

- **`proyeccion_lotes.plan_tienda_version_id`** `uuid null → plan_tienda_versiones(id) on delete restrict`, índice parcial; `check (plan_tienda_version_id is null or tipo in ('plan_tienda','revertir_plan_tienda'))`. El `tipo` del lote sigue siendo catálogo de zod (sin `check`, 07g §2.0): se añaden `plan_tienda` y `revertir_plan_tienda`.
- **`proyeccion_lote_filas.anterior`** `jsonb null`: foto de las columnas de decisión del registro antes de escribir (`decidido`, `origen`, `nota`, `propuesta_al_decidir`, `decidido_por_id`, `decidido_por_nombre`, `decidido_at`, `decision_lote_id`, `decision_ia_fila_id`; en un objetivo de tienda, la decisión de `proyeccion_tiendas`). Con ella «deshacer» restaura lo que había, no la propuesta.
- **`proyeccion_lote_filas.objetivo`** `text null` (`'fila_anio' | 'tienda'`, zod) y **`tienda_id`** `uuid null → tiendas restrict`: una línea por cada total de tienda movido (R512, R511), además de las de filas.
- `fuente` de `proyeccion_lote_filas` (zod) gana `plan_tienda`.

Son columnas nulas en tablas de solo inserción: los lotes anteriores quedan iguales y el trigger de inmutabilidad no cambia. **Ningún `check` existente cambia** (en particular el de `origen`, C7).

### 2.3 Funciones

| Función | Tipo | Qué hace |
|---|---|---|
| `plan_tienda_venta_motor(p jsonb)` | `sql stable`, `work_mem = '16MB'` | Recibe `{ anio, k, cubetas: [{ c, desde, hasta }] }` (≤ 16 rangos de meses; hoy 12, §5.1.1) y devuelve, de `venta_stock_vigente` **solo de tiendas tipo Tienda** (el CD nunca entra) unida a `equivalencias` → nodo: `cargas` (periodo → carga, para la huella), unidades por tienda × GML × cubeta, soles y costo de `Y` de enero a `k`, stock de tiendas en `k` y la temporada del GML (§5.1.2) con su `pct_minoritaria`. Nunca `stock_valorizado`. ≈ 7 000 combinaciones × 12 cubetas ≤ 700 KB, ≤ 3 s en frío |
| `plan_tienda_vector2(p_proyeccion_id uuid, p_gml_ids uuid[] default null)` | `sql stable` | Por GML: `Σ vigente`, `Σ propuesto` y `Σ vendido` de `Y` y `Y+1` de filas activas, partidos en base (`tienda_id` nulo) y por tienda (`[tienda_id, bloque, subbloque, …]`), filas de cola larga bajo el mínimo (§4.6) y conteos por clase de decisión (manual a mano, propuesta, lote de 07g, lote `plan_tienda`, IA, escalada, sin decidir); más `calculado_at` y `parametros.bloques` en la misma sentencia. ≤ 150 KB, ≤ 300 ms |
| `guardar_carga_plan_tienda(p jsonb)` | `plpgsql` | Cabecera y filas en una transacción; `carga_repetida`, `fecha_invalida` en el `jsonb` (sin `raise`, patrón M14) |
| `guardar_version_plan_tienda(p jsonb)` | `plpgsql` | Inserta la versión y sus `plan_tienda_valores` (≤ 16 000 filas, `jsonb_to_recordset`); misma `huella` y proyección en los últimos 10 min → devuelve la existente (`repetida`). ≤ 2 s |
| `ajustar_plan_tienda(p jsonb)` | `plpgsql` | `{ version_id, lamina_id, version_vista, celdas: [{ tienda_id, anio, valor | null, reparto: [{ gml_id, valor }] }] }`: candado de aviso por `(version, lámina)`; comprueba que la `version_vista` (= nº de filas de `plan_tienda_ajustes` de la lámina) sea la actual (`lamina_cambio`); escribe `ajustado`, quién y cuándo en cada GML y una fila de historial por celda. El reparto por GML lo calcula TypeScript (§5.2) y la función comprueba que sume el valor |
| `registrar_decision_plan_tienda(p jsonb)` | `plpgsql` | `for share` de la versión y de su proyección (debe seguir en trabajo: `proyeccion_no_editable`); candado de aviso por `(version, lámina)`; `secuencia_vista` distinta → `lamina_cambio`; inserta las dos filas del acto. Única escritura de `plan_tienda_decisiones` (prueba estática) |
| `aplicar_lote_plan_tienda(p jsonb)` | `plpgsql` (la usa `0.20.1`) | §5.6 paso 6. Códigos `PT001`–`PT009`, como los `LP` de 07g |

### 2.4 Rendimiento

| Operación | Presupuesto |
|---|---|
| Crear una versión (agregados + motor + guardar) | ≤ 3 s SQL + ≤ 300 ms TS + ≤ 2 s guardar = **≤ 6 s**, ninguna sentencia cerca de 8 s |
| `GET` de la mesa (lista y KPIs) | ≤ 1,5 s en frío, ≤ 300 ms con caché (versión inmutable salvo `ajustado`; Vector2 por `calculado_at` y `max(updated_at)`) |
| `GET` de una lámina | ≤ 800 ms, ≤ 60 KB |
| Guardar ajustes o aprobar | ≤ 1 s |
| Vista previa de la carga parcial (24 000 filas) | ≤ 4 s, cuerpo ≤ 2 MB (`MAX_BYTES_CUERPO` = 6 MB) |
| Escribir (0.20.1) | ≤ 25 láminas o ≤ 300 filas por petición (D17 de 07g), ≤ 4 s cada una, en tandas que no parten una lámina |

Las lecturas pesadas de venta pasan por el semáforo de la decisión 147 (se reutiliza el de `src/lib/direccion/semaforo.ts`, extraído a `src/lib/api/` sin duplicarlo).

### 2.5 Diagrama

```
Excel «Venta por tienda por año» ─(navegador)─► previsualizar ─► guardar_carga_plan_tienda ─► plan_tienda_cargas + filas   (nunca venta_stock_mensual)
venta_stock_vigente (sin CD, meses cerrados) ─► plan_tienda_venta_motor(cubetas) ─┐
tiendas ─► bloquesDeAnio (M7) ─────────────────────────────────────────────────────┼─► motor.ts (puro) ─► guardar_version_plan_tienda ─► plan_tienda_versiones + plan_tienda_valores (propuesto)
carga parcial vigente (opcional) ──────────────────────────────────────────────────┤
proyección destino ─► plan_tienda_vector2 (aperturas de R512 como propuesto) ───────┘
plan_tienda_laminas + lamina_gml (+ «Otras») · planner_importaciones + planner_valores ─► GET /api/plan-tienda/… ─► mesa (ajustes en el navegador)
   ajustar_plan_tienda ─► plan_tienda_valores.ajustado + plan_tienda_ajustes   ·   registrar_decision_plan_tienda ─► plan_tienda_decisiones
0.20.1: decisiones vigentes ─► plan (aplicarDecision · moverTotalTienda · repartirEntero de M7) ─► aplicar_lote_plan_tienda
   ─► proyeccion_fila_anios (origen manual + decision_lote_id) · proyeccion_tiendas (R512, R511) · proyeccion_lotes (tipo plan_tienda) + proyeccion_lote_filas (anterior)
   ─► cerrar (M7, sin cambios) ─► M8 lee la cerrada ─► flujo y compras
```

## 3. Contratos de API

Convenciones de M1 a M14: `ok` / `error` / `errorConCodigo` / `leerCuerpo`, `traducirErrorDb`, zod `strict`, `{ data }` / `{ error, codigo }`. **Cada handler empieza con su guard** (prueba estática, `tests/api.guards.roles.test.ts`). Datos solo con `supabaseAdmin()` desde el servidor. Handlers en `src/app/api/plan-tienda/`; lógica pura en `src/lib/plan-tienda/` (`tipos-api.ts` autocontenido, `esquemas.ts`, `cubetas.ts`, `motor.ts`, `laminas.ts`, `ajustes.ts`, `fuentes.ts`, `decisiones.ts`, `carga.ts` y `planner.ts` —resolutores de los importadores—, `excel.ts`; en `0.20.1`, `escritura.ts`); base **solo** en `src/lib/plan-tienda/consultas.ts`, único archivo que nombra las tablas y funciones `plan_tienda_*` y `planner_*` y `aplicar_lote_plan_tienda` (prueba estática); orquestación en `servicio.ts`. Errores: `401` · `403` · `400` · `404` · `409` (regla) · `413` · `503 lectura_lenta` · `500` sin detalles.

**Se reutiliza sin modificar:** de `src/lib/proyeccion/`: `bloquesDeAnio`, `repartirEntero`, `cargarCatalogo`, `leerFilasConAnios`, `calculoEnCurso`, `parametrosDe` y, en `0.20.1`, `aplicarDecision`, `aplicarDecisionTienda`, `moverTotalTienda`/`totalTiendaTrasMover` (07b), `motivoRechazoDecision`, `motivoRechazoTotalTienda`, `desactualizadaDe`, `bloqueosNinoDeCierre`, `ninoDeFilas`, `payloadAnioDecision`; de `src/lib/arbol/`: `normalizarNombre`, `resolverGml` y el lector de archivos; de `src/lib/ventas/resolver.ts`: tienda por nombre y código y ubicaciones ignoradas (05c); de `src/components/importador/`: el asistente con vista previa; de `src/lib/direccion/`: el semáforo y `GET /api/direccion/estado`.

### 3.1 Rutas de `0.20.0`

| Ruta | Método | Guard | Entrada | Respuesta y errores |
|---|---|---|---|---|
| `/api/plan-tienda/opciones` | GET | `requirePlanner` | `?anio=` | Proyecciones del año (estado; en trabajo primero), versiones (nombre, corte, motor, quién), cargas parciales con su estado derivado, importaciones vigentes del planner por género, géneros, `parametros_defecto`, `version_motor`, `puede_aprobar` |
| `/api/plan-tienda/cargas/previsualizar` | POST | `requirePlanner` | `cargaFilasSchema = { anio, hasta_fecha, archivo_nombre, filas: { genero, mundo, linea, metrica: "Cant Act"\|"Venta Act"\|"CV Act", tienda, valores: { "2023"?, "2024"?, "2025"?, "2026"? } }[] (≤ 30 000) }` | `VistaPreviaCargaApi`: filas resueltas a `(tienda, GML)` (género `H`/`M` → género; mundo y línea por `resolverGml`; tienda por nombre o código), omitidas por motivo (`tienda_desconocida`, `ubicacion_ignorada`, `gml_desconocido`, `metrica_desconocida`, `unidades_negativas`), % de cruce, conciliación con Vector2 por tienda y año completo, `huella_previa`. Sin escribir |
| `/api/plan-tienda/cargas` | POST | `requirePlanner` | `{ …cargaFilasSchema, huella_previa }` | `201`. `409 vista_previa_distinta`, `carga_repetida`, `fecha_invalida`, `fecha_ya_cerrada` (el mes de `hasta_fecha` ya está publicado en M5: no hace falta), `demasiadas_omitidas` (> 2 % de las unidades del año, como M5) |
| `/api/plan-tienda/cargas/[id]` | PATCH | `requirePlanner` | `{ activo: false }` | Retira la carga |
| `/api/plan-tienda/versiones` | POST | `requirePlanner` | `versionSchema = { proyeccion_id, nombre, carga_id: uuid \| null, parametros?: Partial<ParametrosMotor>, proyeccion_referencia_id?, traer_ajustes_de?: uuid }` | `201 VersionApi` (o `200 repetida`). `409 proyeccion_no_editable` (no está en trabajo), `calculo_en_curso`, `sin_venta`, `mes_faltante` (falta un mes publicado entre enero de `Y−1` y `k'`), `ventana_incompleta` (`k'` < julio), `carga_superada` / `carga_retirada` / `carga_otro_anio`, `503 lectura_lenta`. `traer_ajustes_de` copia los `ajustado` de otra versión de la misma proyección donde la combinación existe (con aviso de las que no) |
| `/api/plan-tienda/versiones/[id]` | PATCH | `requirePlanner` | `{ nombre?, activo? }` | |
| `/api/plan-tienda/laminas` | GET · POST | `requirePlanner` | POST: `{ genero_id, nombre, mundo_etiqueta?, nota?, gml_ids: uuid[1..40], orden? }` | Catálogo con GML, venta `Y−1`, avisos de catálogo (GML ≥ 300 u en «Otras», huérfanas). POST: `409 gml_en_otra_lamina`, `genero_distinto`, `nombre_repetido` |
| `/api/plan-tienda/laminas/[id]` | PATCH | `requirePlanner` | `{ nombre?, mundo_etiqueta?, nota?, orden?, activo?, gml_ids? }` | Cambiar `gml_ids` de una lámina con aprobaciones responde `200` con `aviso: "aprobaciones_desactualizadas"` |
| `/api/plan-tienda/laminas/importar` | POST | `requirePlanner` | `{ simular, filas: { genero, nombre, mundo_etiqueta, nota?, gmls: { mundo, linea }[] }[] (≤ 300) }` | Carga de los grupos iniciales de instr. §4.3 como datos (D5): vista previa con cada GML resuelto o no, choques con láminas existentes; sin `simular`, crea lo que no choca |
| `/api/plan-tienda/laminas/sugerir` | POST | `requirePlanner` | `{ genero_id, umbral?: 300 }` | Propuesta sin escribir (§5.3) |
| `/api/plan-tienda/planner/previsualizar` | POST | `requirePlanner` | `plannerSchema = { genero_id, archivo_nombre, fecha_archivo, pestanas: { nombre, vta: (number \| null)[] }[] (≤ 80) }` | Lo lee el navegador: de cada pestaña de línea, **la fila «Vta» (fila 34)** con los meses desde 2022-01; la hoja **«OTB - Unidades» se descarta** (§5.5). Devuelve cada pestaña con su lámina (mapeo recordado, nombre igual o sin resolver), los cuatro valores por lámina, el **control de cuadre** con Vector2 y `huella_previa` |
| `/api/plan-tienda/planner` | POST | `requirePlanner` | `{ …plannerSchema, mapeo: { pestana, lamina_id \| null, ignorar }[], recordar, incluye_aperturas, huella_previa }` | `201`. `409 pestana_sin_lamina`, `vista_previa_distinta`. El control que no cuadra **avisa, no bloquea** (instr. §4.2) |
| `/api/plan-tienda/planner/[id]` | PATCH | `requirePlanner` | `{ incluye_aperturas?, activo? }` | |
| `/api/plan-tienda/versiones/[id]/mesa` | GET | `requirePlanner` | `?genero&estado=todas\|pendientes\|aprobadas\|con_planner&q` | `MesaApi` (§3.3): KPIs por género (aprobadas / total; 2027 tiendas + Benavides en cada fuente; aprobado tiendas + Benavides) y láminas agrupadas en «Detalladas por el planner» y «Sin detalle del planner», ordenadas por volumen |
| `/api/plan-tienda/versiones/[id]/laminas/[laminaId]` | GET | `requirePlanner` | — | `LaminaDetalleApi` (§3.3) |
| `/api/plan-tienda/versiones/[id]/laminas/[laminaId]/ajustes` | POST | `requirePlanner` | `ajustesSchema = { version_vista, celdas: { tienda_id, anio, valor: entero \| null }[] (1..60) }` | `200` con la lámina recalculada. `409 lamina_cambio` (trae la versión actual), `proyeccion_no_editable`, `tienda_no_editable` (cierre 2026 de una apertura, tienda fuera) |
| `…/laminas/[laminaId]/aprobar` | POST | **`requireAdmin`** | `aprobarSchema` (§3.2) | `201`. `403` planner; `400 fuente_requerida` («Elige de dónde sale la cifra de 2026 y la de 2027»), `valor_manual_requerido`, `nota_requerida`; `409 fuentes_cambiaron` (con las actuales), `sin_planner`, `lamina_cambio`, `proyeccion_no_editable` |
| `…/laminas/[laminaId]/retirar` | POST | **`requireAdmin`** | `{ secuencia_vista, nota }` | `201`. `409 sin_aprobacion` |
| `…/laminas/[laminaId]/historial` | GET | `requirePlanner` | — | Decisiones y ajustes de la lámina, más reciente primero |
| `/api/plan-tienda/versiones/[id]/estado` | GET | `requirePlanner` | — | `{ versiones_lamina: { [lamina_id]: n }, calculado_at, max_updated_at }` para el sondeo (≤ 100 ms) |
| `/api/plan-tienda/versiones/[id]/exportar` | GET | `requirePlanner` | `?genero?` | Todas las láminas con su tabla por tienda (≤ 600 KB) para el Excel del navegador |
| `/api/proyeccion/proyecciones/[id]` | DELETE | (M7) | — | **Cambio mínimo en M7:** la FK de `plan_tienda_versiones` se traduce a `409 tiene_plan_tienda` |

### 3.2 Esquemas (`src/lib/plan-tienda/esquemas.ts`, zod 4)

```ts
const uuid = z.string().uuid();
const entero = z.int().min(0).max(MAX_TOTAL);                       // MAX_TOTAL de M7
export const FUENTES = ["tiendas", "vector2", "planner", "manual"] as const;

export const ajustesSchema = z.strictObject({
  version_vista: z.int().min(0),
  celdas: z.array(z.strictObject({ tienda_id: uuid, anio: z.int(), valor: entero.nullable() })).min(1).max(60),  // null = vuelve a la propuesta
});

const decisionAnio = z.strictObject({
  fuente: z.enum(FUENTES).nullable(),
  valor_manual: entero.nullable(),                                  // tiendas actuales, solo con "manual"
  visto: z.strictObject({ tiendas: entero.nullable(), vector2: entero.nullable(), planner: entero.nullable(), aperturas: entero }),
});
export const aprobarSchema = z.strictObject({
  secuencia_vista: z.int().min(0), version_ajustes_vista: z.int().min(0),
  y: decisionAnio, y1: decisionAnio,
  nota: z.string().trim().max(1000).nullable(),
}).superRefine((v, ctx) => {
  /* y.fuente e y1.fuente no nulas ("fuente_requerida"); "manual" ⇒ valor_manual y nota ≥ 10 ("valor_manual_requerido", "nota_requerida") */
});
```

`ParametrosMotor` (§5.1.8) con rangos en zod. Los esquemas de importación siguen el patrón de M5 y 08b: el navegador lee y normaliza, el servidor resuelve ids, recalcula la vista previa y su huella y solo guarda si coincide.

### 3.3 Tipos (`src/lib/plan-tienda/tipos-api.ts`, autocontenido)

```ts
export type Fuente = "tiendas" | "vector2" | "planner" | "manual";
export type Tratamiento = "antigua" | "nueva" | "apertura" | "cierre";
export type EstadoLamina = "pendiente" | "con_ajustes" | "aprobada" | "aprobada_con_cambios" | "desactualizada" | "aplicada" | "aplicada_cambiada";

export type CifrasAnioApi = {                       // siempre SIN aperturas
  tiendas: number | null; tiendas_sin_ajustes: number | null;
  vector2: number | null; vector2_referencia: number | null;      // proyección destino y, si hay, la de referencia (p. ej. la cerrada)
  planner: number | null; planner_nota: "no_consta_aperturas" | "incluye_aperturas_restadas" | null;
  base_pct: number | null;                          // 2025 real (para Y) o cierre Y de «tiendas» (para Y+1)
  aprobado: number | null; fuente_aprobada: Fuente | null };
export type AperturasApi = { tienda_id: string; codigo: string; nombre: string; abre: string | null; motivo: "apertura" | "cierre";
  vector2: number | null; ajustado: number | null; final: number | null; aprobado: number | null }[];

export type LaminaResumenApi = {
  id: string; slug: string; genero: string; nombre: string; mundo_etiqueta: string | null; es_otras: boolean; detallada_por_planner: boolean;
  gml: { id: string; nombre: string; nivel: "GML" | "GMLE"; temporada_motor: string | null; temporada_m7: string | null }[];
  y: CifrasAnioApi; y1: CifrasAnioApi; aperturas_y1: AperturasApi;          // Benavides siempre aquí, nunca dentro de y1
  total_y1: { tiendas_mas_aperturas: number | null; aprobado: number | null };
  estado: EstadoLamina; secuencia: number; version_ajustes: number; aprobado_por: string | null; aprobado_at: string | null;
  avisos: AvisoPlan[] };

export type TiendaLaminaApi = {
  tienda_id: string; codigo: string; nombre: string; tratamiento_y: Tratamiento | null; tratamiento_y1: Tratamiento | null;
  historia: (number | null)[];                      // Y−3, Y−2, Y−1, Y al corte; null = «—»
  vs_mismo_periodo: number | null;                  // real_corte ÷ mismo_periodo_ant − 1
  margen: number | null;
  y: { propuesto: number | null; ajustado: number | null; final: number | null };
  y1: { propuesto: number | null; ajustado: number | null; final: number | null; vs_y: number | null };
  avisos: AvisoPlan[] };

export type LaminaDetalleApi = LaminaResumenApi & {
  tiendas: TiendaLaminaApi[];                       // antiguas y nuevas; las aperturas en `aperturas_y1`
  totales: { tiendas_actuales: { y: number; y1: number }; aperturas: { y1: number }; total: { y: number; y1: number } };
  planner: { importacion_id: string; archivo: string; fecha: string; incluye_aperturas: "si" | "no" | "desconocido";
             real_2025: number | null; real_ytd: number | null; cierre_2026: number | null; proy_2027: number | null } | null;
  vector2_detalle: { y: { base: number; tiendas: [string, number][] }; y1: { base: number; tiendas: [string, number][] }; cola_larga_bajo_minimo: number };
  como_se_proyecta: string[];                       // las fórmulas de §5.1 en palabras, con las fechas del corte (instr. §6.7)
  puede_editar: boolean; puede_aprobar: boolean };

export type AvisoPlan = { codigo: CodigoAvisoPlan; texto: string; nivel: "info" | "atencion" };
export type CodigoAvisoPlan = "anualizada" | "tienda_nueva" | "crecimiento_alto" | "posible_quiebre" | "cola_larga_vector2"
  | "planner_no_consta_aperturas" | "planner_no_cuadra" | "temporadas_mezcladas" | "temporada_distinta_m7" | "sin_temporada"
  | "carga_menor_que_v2" | "correccion_invierno_distinta_m6" | "lamina_cambio" | "bloques_distintos" | "ritmo_acotado" | "sin_dato";
```

### 3.4 Qué hace el servidor al aprobar

1. zod; `requireAdmin`; perfil, nombre y rol de la sesión.
2. Lee la versión (sus `plan_tienda_valores` de los GML de la lámina, con ajustes), Vector2 de la proyección destino y la importación vigente del planner.
3. **Recalcula las cuatro cifras de cada año** con `fuentes.ts` (el mismo código que la pantalla) y las compara con `visto`; si difieren → `409 fuentes_cambiaron` con las actuales.
4. Calcula `valor_tiendas_actuales`, `valor_aperturas` (final de las aperturas: ajustado o Vector2) y `valor_total` por año, y el **detalle final por GML × tienda** que se escribirá (§5.6 paso 1).
5. Arma `fuentes` y llama a `registrar_decision_plan_tienda`; traduce sus códigos.

### 3.5 Rutas de `0.20.1` (escritura de vuelta)

| Ruta | Método | Guard | Entrada | Respuesta y errores |
|---|---|---|---|---|
| `/api/plan-tienda/versiones/[id]/aplicar` | POST | `requirePlanner`; **`requireAdmin` si alguna lámina viene con `pisar_manual`** | `aplicarSchema = { lote_id: uuid, confirmacion_id: uuid, laminas: { lamina_id, conflictos: "pisar" \| "respetar" \| null }[] (1..25), simular: boolean, huella_simulacion?, confirmo_revision: boolean, nota? }` | `simular` → `200 PlanAplicacionApi`: por lámina y GML, **antes y después** de cada año (tiendas actuales y Benavides por separado) y en total; filas que cambian con su clase anterior; **conflictos** (filas fijadas a mano con otra cifra: GML, AM, año, decidido, quién y cuándo); totales de tienda que se mueven (R512, R511); crecimientos que quedarían por reaprobar (07g D15); rechazos con código. Sin `simular` → `201` (o `200 repetido`). `409`: `proyeccion_no_editable`, `calculo_en_curso`, `proyeccion_desactualizada` (como 07g D14), `version_metodo`, los del Niño, **`conflictos_sin_resolver`**, `datos_cambiaron`, `simulacion_distinta`, `revision_requerida`, `lote_ajeno`, `sin_laminas_aplicables`, `conflicto_reintentar` |
| `/api/plan-tienda/versiones/[id]/aplicaciones` | GET | `requirePlanner` | — | Lotes `plan_tienda` de la versión con su resumen |
| `/api/plan-tienda/lotes/[loteId]/deshacer` | POST | `requirePlanner` | `{ lote_id: uuid (nuevo), laminas?: uuid[], simular }` | Lote `revertir_plan_tienda`: restaura `anterior` de cada registro que **sigue** con `decision_lote_id` = ese lote (lo cambiado después queda `cambiada_despues`), y el total de tienda si nadie lo cambió. `409 no_revertible`, `proyeccion_no_editable`, `conflicto_reintentar` |

Códigos por lámina: `aplicada`, `sin_cambios` (lo vigente ya es lo aprobado), `aprobacion_no_vigente`, `lamina_cambio`, `vector2_cambio` (la fuente fue `vector2` y Vector2 cambió desde la aprobación: escribirla desharía un cambio posterior; hay que volver a aprobar), `manual_excede` (respetando lo fijado a mano, ya suma más que lo aprobado para su bloque), `menor_que_vendido`, `menor_que_vendido_tienda` (07b), `sin_base_reparto`, `sin_filas` (cifra > 0 en un bloque sin filas activas), `bloques_distintos`, `cambio_concurrente`.

## 4. Pantallas

### 4.1 Dónde vive y quién la ve

- Ruta **`/planificacion/plan-tienda`**, item **«Plan por tienda (mesa por GML)»** en Planificación de `src/lib/nav.ts` (roles `PLANIFICACION`), después de «Proyección de unidades». El comprador no lo ve y la página lo redirige (decisión 113).
- Pestañas: **Mesa** · **Láminas** · **Datos** (cargas parciales, versiones del motor, importaciones del planner). Versión, género, filtro, búsqueda y lámina en la URL (`?version=&genero=&estado=&q=&lamina=`).
- Kit: `Card`, `DataTable`, `Chips`, `Select`, `Modal`, `DialogoConfirmar`, `Alert`, `Badge`, `EmptyState`, `Tabs`, `Switch`; gráfico con `src/lib/curvas/grafico.ts`; formato `es-PE`; hook `use-plan-tienda.ts` (patrón `useColeccion`).

| Rol | Puede |
|---|---|
| admin | todo: crear versiones, importar, editar láminas, ajustar, **aprobar y retirar**, aplicar (y **pisar lo fijado a mano**), deshacer |
| planner | crear versiones, importar, editar láminas, **ajustar**, aplicar lo aprobado respetando lo fijado a mano (decisión abierta 6), deshacer. «Aprobar lámina» no aparece |
| comprador | nada |

### 4.2 Barra superior (instr. §6)

- Selector de **versión** («Corte 12-nov · motor v1 · proyección *seguimiento sep*») y botón **«Nueva versión»** (modal: proyección destino en trabajo, carga parcial —o «sin carga: hasta *último mes publicado*» con `Alert` ámbar «sin venta posterior a *mes*: las cifras no son comparables con las de referencia»—, parámetros de §5.1.8, corrección de invierno del motor y de M6 lado a lado, «traer ajustes de» otra versión).
- **Por género** (Hombre primero; en 390 px, una tarjeta por género desplazable en horizontal): láminas aprobadas sobre el total; 2027 **por tiendas + Benavides** (dos números); **Vector2 tiendas + Benavides**; planner; **aprobado tiendas + Benavides**. Botón **«Descargar plan_claudio.xlsx»**.
- Estado de dirección (M14) de la proyección destino en una línea, con enlace.

### 4.3 Columna izquierda: lista

- Filtro Hombre / Mujer (y los demás géneros si tienen láminas); Todas / Pendientes / Aprobadas / Con planner; buscador.
- Dos grupos: **«Detalladas por el planner»** y **«Sin detalle del planner»**, cada uno de mayor a menor 2027 por tiendas; «Otras líneas menores» al final de su género. Cada fila: nombre, `Badge` de estado **en texto**, las tres cifras de 2027 (tiendas actuales) y una marca si tiene avisos.
- En 390 px la lista es la primera vista; al elegir una lámina se abre a pantalla completa con «Volver».

### 4.4 La lámina (instr. §6)

1. **Cabecera**: género · mundo · nombre, GML incluidos (nivel y temporada del motor; `Badge` «M7: *temporada*» si difiere), temporada, nota del grupo y, si Vector2 trae unidades de filas de cola larga bajo el mínimo de disponibilidad, el aviso «Vector2 incluye N u de filas sin stock» (§4.6). Botones **«Anterior»** y **«Siguiente pendiente»**.
2. **Cierre 2026**: cuatro opciones de radio —**Tiendas** (suma de tiendas con ajustes), **Vector2**, **Planner**, **Otra cifra** (campo)—, cada una con barra y **% frente a 2025 real**; ninguna marcada por defecto. Si hay proyección de referencia, debajo de Vector2 una línea gris «cerrada: *X*».
3. **2027 · tiendas actuales**: las mismas cuatro **sin Benavides** (Vector2 = vigente − aperturas; el planner con «no consta si trae Benavides» cuando `incluye_aperturas = desconocido`); **% frente al cierre 2026 por tiendas**. Debajo, **recuadro aparte «Benavides 2027 · abre 15-jun-2027»** con el valor ajustado y lo que propone Vector2 (una línea por cada apertura o cierre del año).
4. **Nota** (≤ 1 000) y **«Aprobar lámina»** (solo admin): exige elegir 2026 y 2027; sin elegir, el botón queda deshabilitado con el texto «Elige de dónde sale la cifra de 2026 y la de 2027» (y el servidor responde `400 fuente_requerida` si llega igual). «Retirar aprobación» e «Historial».
5. **Tabla por tienda**: Tienda · 2023 · 2024 · 2025 · 2026 al corte · vs 2025 (mismo periodo) · Margen 2026 · **Cierre 2026** (editable) · **2027** (editable) · 27 vs 26. Filas de totales en este orden: **Tiendas actuales**, **Benavides (R512) · abre 15 jun 2027** (2027 editable, 2026 vacío) y **Total con Benavides**. Celdas cambiadas marcadas (fondo y el texto «ajustado» para lectores de pantalla); **vacía = vuelve a la propuesta del motor**; botones **«Volver a la propuesta»** (toda la lámina) y **«Guardar ajustes»** (admin y planner, guarda sin aprobar). Todo se recalcula al escribir, en el navegador: totales, % y la opción «Tiendas» de arriba. Validación en la celda: entero ≥ 0 (si no, «Escribe un número entero de 0 en adelante»). «—» donde no hay dato; 0 solo si la tienda estaba abierta y no vendió. En 390 px, desplazamiento horizontal con la columna Tienda fija, celdas de 44 px, `inputMode="numeric"`.
6. **Gráfico** por tienda: 2025 real, cierre 2026 y 2027 con los ajustes; Benavides solo con 2027, con trama distinta y rotulada «aparte».
7. **«Cómo se proyecta»** (desplegable): §5.1 en palabras con las fechas y pesos del corte de la versión («el mismo periodo de 2025 toma noviembre × 12/30…») y la frase de instr. §5.2 («supone que el ritmo de los últimos meses sigue hasta diciembre; el Niño está marcado hasta diciembre de 2026»).

Salir con ajustes sin guardar pide confirmar.

### 4.5 Pestañas Láminas y Datos

- **Láminas**: tabla por género (nombre, mundo, GML en chips, venta `Y−1`, con planner, estado); crear, editar, mover GML (aviso si la lámina tiene aprobación), desactivar; **«Importar láminas»** (CSV o Excel con género, nombre, mundo, nota y la lista de mundo + línea de cada GML; vista previa; es como se cargan los grupos de instr. §4.3); **«Sugerir»** (§5.3); la «Otras» de cada género con sus GML implícitos y el aviso de los que pasan de 300 u.
- **Datos**: *Cargas parciales* (lista con estado vigente / superada / retirada y «Importar venta del mes en curso»: archivo → columnas → vista previa con omitidas, % de cruce con los GML y conciliación por tienda con Vector2 en 2023–2025 → guardar). *Versiones* (motor, corte, parámetros, huella, totales, quién; «Repetir con los mismos parámetros»). *Planner* (por género: archivo → pestañas detectadas con su fila «Vta» y la lámina sugerida → «¿el 2027 incluye Benavides? sí / no / no consta» → control de cuadre → guardar).

### 4.6 Avisos (limitaciones que reconoce el pedido)

| Código | Cuándo | Nivel |
|---|---|---|
| `crecimiento_alto` | 2027 de la lámina por tiendas > 1,5 × su cierre 2026 («revisa si entró una marca nueva en 2025–2026») | atención |
| `posible_quiebre` | stock de tiendas del GML al cierre de `k'` < venta media mensual de julio a `k'` y ritmo del GML < 0,9 («la caída puede ser falta de stock: el motor no ve el stock») | atención |
| `cola_larga_vector2` | Vector2 incluye filas de cola larga con disponibilidad bajo el mínimo (§8.1) cuyo vigente supera lo que propondría el método con el tope; muestra cuántas unidades | atención |
| `planner_no_consta_aperturas` · `planner_no_cuadra` | `incluye_aperturas = desconocido` / el control de §5.5 no cuadró para esa lámina | info · atención |
| `anualizada` · `tienda_nueva` · `ritmo_acotado` · `sin_dato` | §5.1 | info |
| `temporadas_mezcladas` · `temporada_distinta_m7` · `sin_temporada` | §5.1.2 | info |
| `carga_menor_que_v2` | la carga parcial trae menos que Vector2 de enero a `k'` en la tienda × GML (se usa Vector2) | info |
| `correccion_invierno_distinta_m6` | la corrección de invierno del motor difiere más de 0,03 del factor de M6 | atención |
| `lamina_cambio` · `bloques_distintos` | aprobación con otra composición / bloques de la versión distintos de los guardados en la proyección | atención |

Quedan para después (§7): corregir el motor por stock y por marcas nuevas.

### 4.7 Excel `plan_claudio.xlsx` (navegador, SheetJS bajo demanda, instr. §9)

- **`plan_claudio`**: una fila por lámina: género, mundo, línea (nombre de la lámina), GML incluidos, temporada, 2025 real, 2026 al corte. Cierre 2026: tiendas, Vector2, planner, aprobado y fuente. 2027: tiendas actuales (motor con ajustes), Vector2 sin Benavides, planner, Benavides de Vector2, Benavides ajustado, aprobado tiendas, aprobado Benavides, aprobado total y fuente. Cantidad de ajustes por tienda, nota, quién y cuándo.
- **`tiendas`**: una fila por lámina × tienda: historia 2023–2026, mismo periodo 2025, margen 2026, cierre 2026 propuesto y final, 2027 propuesto y final; **más una fila de Benavides por lámina**, marcada «apertura».
- **`notas`**: fuentes, fecha de corte, versión del motor y parámetros, proyección destino y de referencia, importación del planner por género, y la convención «Benavides no suma en tiendas actuales; total = tiendas actuales + Benavides».

### 4.8 Aplicar a la proyección (0.20.1)

Botón **«Aplicar lo aprobado a la proyección»** en la barra (admin y planner): elige láminas aprobadas (todas por defecto) → **vista previa** (simulación): tabla por lámina y GML con antes y después de 2026, 2027 tiendas actuales y Benavides, y el total; la lista de **conflictos** con lo fijado a mano (GML, AM, año, cifra, quién y cuándo) con la elección por lámina «Pisar» (solo admin) o «Respetar»; los totales de tienda que se mueven; los GM cuyos crecimientos quedarían por reaprobar → casilla «Revisé el antes y el después» → **Aplicar**. Después, el resumen escrito por la base y el aviso «El flujo y las compras cambian cuando cierres esta proyección en Proyección» con enlace. Historial de aplicaciones con «Deshacer».

### 4.9 Refresco y concurrencia (D13)

Al volver a la pestaña y cada 60 s, `GET …/estado`; si cambió una lámina, se recarga la lista y, si es la abierta y no hay ajustes sin guardar, también la lámina; si los hay, `Alert` «*Nombre* guardó esta lámina: recarga para ver sus cambios (perderás los tuyos)». Guardar o aprobar con una versión vieja → `409 lamina_cambio` con el mismo texto.

## 5. Reglas de negocio

### 5.1 Motor de proyección por tienda (`src/lib/plan-tienda/motor.ts`, puro, `VERSION_MOTOR = 1`)

Es instr. §5 **generalizada**: el año en curso `Y` y el corte `d` son parámetros; nada en el código dice 2026, noviembre, 0,40 ni 0,60. Notación de las instrucciones, con `Y` en lugar de 2026: `real26 ≡ real(Y)`, `mp25 ≡ mp(Y−1)`, `W26`, `W25`, `resto25`, `y25`. `v_{Z,m}` = unidades de Vector2 (M5, solo tipo Tienda) de la tienda `s` en el GML `g`, mes `m` del año `Z`. Todo en coma flotante; **se redondea una sola vez**, al final de cada cifra por tienda × GML × año (§5.1.7). El motor no lee el reloj ni la base: recibe cubetas, carga parcial, bloques y parámetros.

#### 5.1.1 Corte y ventanas

- **Corte** `d`, mes del corte `m_c`, **peso del mes del corte `α = día(d) ÷ días(m_c)`** (12-nov → 12/30 = 0,40; el «0,60» es `1 − α`). Con carga parcial vigente, `d = hasta_fecha`; **sin carga**, `d` = último día de `k'` (`m_c = k'`, `α = 1`).
- **Venta de `Y` al corte:** `A = Σ_{m=1}^{k'} v_{Y,m}` (Vector2); `X` = unidades de `Y` de la carga parcial (`null` sin carga o si la combinación no viene). **`real(Y) = max(X, A)`** (instr. §4.1 y primer pedido: `f26 = max(Excel, V2 ene–set)`); si `X < A`, aviso `carga_menor_que_v2`.
- **Definiciones** (instr. §5, generalizadas):

| Instrucciones (corte 12-nov, `k'` = set) | General |
|---|---|
| `mp25 = ene–set 2025 + oct 2025 + 0,40 × nov 2025` | `mp(Y−1) = Σ_{m=1}^{m_c−1} v_{Y−1,m} + α · v_{Y−1,m_c}` |
| `W26 = jul–set 2026 + (oct 2026 hasta el corte)` | `W26 = real(Y) − Σ_{m=1}^{i−1} v_{Y,m}` (del 1 de julio al corte) |
| `W25 = jul–set 2025 + oct 2025 + 0,40 × nov 2025` | `W25 = Σ_{m=i}^{m_c−1} v_{Y−1,m} + α · v_{Y−1,m_c}` |
| `resto25 = 0,60 × nov 2025 + dic 2025` | `resto25 = (1 − α) · v_{Y−1,m_c} + Σ_{m=m_c+1}^{12} v_{Y−1,m}` |
| `y25` | `Σ_{m=1}^{12} v_{Y−1,m}` |
| Ventana de verano ene–jun | `H26 = Σ_{m=1}^{6} v_{Y,m}`, `H25 = Σ_{m=1}^{6} v_{Y−1,m}` |
| Ventana de invierno ene–12 nov | `I26 = real(Y)`, `I25 = mp(Y−1)` |
| Ventana corta de la tienda nueva: oct 2026 + nov 2026 al corte; en la red: oct 2025 + 0,40 × nov 2025 | `C26 = real(Y) − Σ_{m=1}^{m_c−2} v_{Y,m}`; `C25 = v_{Y−1,m_c−1} + α · v_{Y−1,m_c}` |

  con `i = mes_inicio_ritmo` (julio). **Se derivan del corte** `α`, `m_c`, la parte posterior a `k'` de cada ventana, `mp`, `W25`, `resto25`, `C26` y `C25`; **son constantes** (parámetros, §5.1.8) el inicio de la ventana de ritmo (julio), la ventana de verano (enero a junio, antes del Niño de verano), 500, 150, 300, los límites y el umbral de 100. Cuando M5 publique octubre, el mismo corte da las mismas ventanas: octubre pasa de la carga a Vector2 (`A` crece, `X − A` baja).
- **Requisitos:** `k' ≥ 6` y `k' ≥ i` (`409 ventana_incompleta`); sin meses publicados faltantes entre enero de `Y−1` y `k'` (`mes_faltante`); `k' ≥ m_c − 2` (la carga no puede adelantarse más de un mes completo a lo publicado: `409 carga_adelantada`, porque `C26` necesita los meses anteriores publicados); `d` dentro de `Y`.
- **Cubetas** que pide el servidor a `plan_tienda_venta_motor` (13): `y23`, `y24`, `y25`; de `Y−1`: `1..6`, `i..m_c−1`, `m_c`, `m_c+1..12`, `1..m_c−1`, `m_c−1`; de `Y`: `1..6`, `1..i−1`, `1..m_c−2`, `1..k'`.
- **Margen** (`1 − costo ÷ venta` de `Y`): de la carga parcial (`1 − CV Act`) si trae la métrica; si no, de Vector2 enero a `k'` (rotulado). **Conciliación** de la carga (vista previa): unidades por tienda y año completo frente a Vector2; diferencias > 1 % se listan.

#### 5.1.2 Temporada del GML

La de la agrupación de estacionalidad de **la equivalencia del nodo con más unidades en `Y−2` y `Y−1`** (empate: código); sin venta en esos años, la de `Y`. Equivalencia o agrupación sin temporada → `sin_temporada`, que se trata como **todo el año** en todo (también en `T_temp`) con aviso. `pct_minoritaria` > 20 % → `temporadas_mezcladas`. La lámina muestra además la de M7 (la de mayor vigente entre las filas base del GML) y avisa si difiere. Un nodo GMLE se proyecta entero (§7).

#### 5.1.3 Tiendas (bloques de M7)

Con `bloquesDeAnio(tiendas, Z)` de M7, sin copiar sus reglas, para `Z ∈ {Y, Y+1}`:

| Tratamiento | Tiendas | Motor | Fila de la proyección donde se escribe (0.20.1) |
|---|---|---|---|
| `antigua` | `M(Y)`: 2025 completo (instr. §5: R401, R402, R501–R506, R510) | §5.1.4 y §5.1.5 | base de `Z` |
| `nueva` | en `M(Z) ∪ N(Z).nuevas_anterior` pero no en `M(Y)` (R511: `N(Y).nuevas_anterior` en 2026, `M(Y+1)` en 2027) | §5.1.6 | 2026: sus filas `nuevas_anterior`; 2027: base |
| `apertura` | `N(Z).aperturas` (R512, abre el 2027-06-15) | no proyecta: `propuesto` = vigente de Vector2 de sus filas por GML (instr. §5.4), editable | sus filas `nuevas` / `aperturas` y `proyeccion_tiendas` |
| `cierre` | `C(Z)` | no proyecta: vigente de Vector2, editable | sus filas `cierres` |
| (fuera) | el resto | nada | — |

- **Tiendas actuales de `Z`** = `antigua ∪ nueva`; **aperturas de `Z`** = `apertura ∪ cierre` (hoy solo R512 en 2027; un cierre se rotula «cierre»). Se guardan y se suman por separado; **total = tiendas actuales + aperturas**; nunca hay un total intermedio que las mezcle (instr. §11).
- **Vector2 por año**: tiendas actuales de 2027 = `Σ vigente` de las filas base de `Y+1` + filas de tienda de `N(Y+1).nuevas_anterior`; Benavides = filas de tienda de R512 en `Y+1`; 2026 = base de `Y` + filas `nuevas_anterior` de `Y` (R511). Cada tienda está en un solo bloque por año (regla 1 de M7): sin doble conteo.
- Las sumas de red (`T_temp`, `T_g`, `R_g`, pesos) usan **solo las antiguas**.
- Bloques de la versión ≠ `parametros.bloques` de la proyección destino → `bloques_distintos` y la lámina no se aplica hasta recalcular una u otra.

#### 5.1.4 Ritmo con encogimiento (instr. §5.1)

```
T_temp = Σ_{g∈temp} Σ_antiguas W26 ÷ Σ Σ W25                         (denominador 0 → 1, aviso sin_dato)
T_g    = (Σ_antiguas W26 + K × T_temp) ÷ (Σ_antiguas W25 + K)         K = 500
T_sg   = (W26 + k × T_g) ÷ (W25 + k)                                  k = 150
0,25 ≤ T_sg ≤ 6                                                        (aviso ritmo_acotado si toca un límite)
```

Propiedades: tienda sin venta en las dos ventanas → `T_sg = T_g`; con un solo GML en la temporada, `T_g = T_temp`.

#### 5.1.5 Tienda antigua: cierre y año siguiente (instr. §5.2 y §5.4)

- **Cierre:** `cierre(Y) = real(Y) + resto25 × T_sg`. Siempre ≥ `real(Y)`.
- **Año siguiente** (año normal, sin Niño), encogido igual que §5.1.4 sobre la ventana de su temporada y acotado a 0,25–6:

| Temporada | Ventana | `T27` | `p27` |
|---|---|---|---|
| Todo el año (y sin temporada) | `W` (jul–corte) | `T_sg` | `y25 × T_sg` |
| Verano | `H` (ene–jun) | `(H26 + k·T_gH) ÷ (H25 + k)`, `T_gH = (ΣH26 + K·T_tempH) ÷ (ΣH25 + K)`, `T_tempH = Σ_{verano} ΣH26 ÷ ΣΣH25` | `y25 × T27` |
| Invierno | `I` (ene–corte) | análogo sobre `I26` / `I25` | `y25 × T27 ÷ corr_inv` |

- **Corrección de invierno** (instr. §5.4): `corr_inv = T_tempI(invierno) ÷ T_tempI(todo el año)`, los ritmos de red de las dos temporadas en la ventana de enero al corte (hoy ≈ 0,68 según las instrucciones; M6 tiene ≈ 0,70). Se guarda calculada en `parametros`; la versión puede fijarla a mano (`corr_inv.fuente = 'manual'`, 0,30–1,50) o tomar la de M6 (`'m6'`, `ratio_aplicado ?? ratio_calculado` de invierno de `Y`). Aviso si difiere de M6 en más de 0,03. Propiedad: una tienda × GML de invierno que se mueve igual que la red da `p27 = y25 × T_tempI(todo el año)`.
- **Anualización** (instr. §5.4): si la ventana de `Y−1` de su temporada (`W25`, `H25` o `I25`) es **< 100 u**, `p27 = B26 ÷ peso` (en invierno, además `÷ corr_inv`), con `B26` la misma ventana de `Y` y **`peso = Σ_antiguas B25_g ÷ Σ_antiguas y25_g`** (el peso de esa ventana en el 2025 de la red **del GML**; si el GML no tiene `y25` en la red, el de la temporada; si tampoco, `null` y `sin_dato`). Aviso `anualizada`. *Supuesto a confirmar con `engine.py` (§10): que «la red» sea la del GML y no la de la temporada.*

#### 5.1.6 Tienda nueva sin año comparable (instr. §5.3; hoy R511)

```
R_g      = (Σ_antiguas resto25 + 300 × R_temp) ÷ (Σ_antiguas C25 + 300)      R_temp = Σ_{g∈temp} Σ_antiguas resto25 ÷ Σ Σ C25
resto    = C26 × R_g
cierre(Y)= real(Y) + resto
p27      = B26 ÷ peso   (todo el año: W; verano: H; invierno: I y ÷ corr_inv)  — la anualización de §5.1.5 con su propia venta reciente
```

Denominadores 0 → `R_temp = 0` (el cierre queda en `real(Y)`) con `sin_dato`. Nunca da error: lo que falta sale «—» con aviso `tienda_nueva`. `mismo_periodo_ant` y `ritmo` quedan nulos.

#### 5.1.7 Salida, redondeo y nulos

- Un registro de `plan_tienda_valores` por GML × tienda × año (`Y`: `cierre(Y)`; `Y+1`: `p27`).
- **Redondeo** al entero más cercano (mitades hacia arriba), una vez por GML × tienda × año; toda suma (lámina, tienda, género) es suma de enteros, así que tabla, tarjetas y Excel cuadran exacto.
- **«—» y no 0** (regla del primer pedido): un elemento de `historia` es nulo si la tienda no estuvo abierta ningún día de ese año; `propuesto` es nulo sin dato. Un 0 es dato.
- `K`, `k` y 300 son > 0 (zod): las divisiones de §5.1.4 a §5.1.6 nunca son por 0.
- El CD nunca entra. Orden determinista (GML, código de tienda): misma entrada, misma salida (R7).

#### 5.1.8 Parámetros y versión

| Parámetro | Defecto | Rango |
|---|---|---|
| `K` (GML hacia la red) | 500 | 0 < K ≤ 100 000 |
| `k` (tienda hacia el GML) | 150 | 0 < k ≤ 100 000 |
| `K_resto` (tienda nueva hacia la temporada) | 300 | 0 < K_resto ≤ 100 000 |
| `ritmo_min`, `ritmo_max` | 0,25 · 6 | `0,01 ≤ min < max ≤ 20` |
| `umbral_anualizar` | 100 u | 0–100 000 |
| `mes_inicio_ritmo` | 7 | 1–`k'` |
| `meses_verano` | 1–6 | dentro de 1–`k'` |
| `corr_inv` | `{ fuente: 'motor' }` | `motor` / `m6` / `manual` (0,30–1,50) |
| `umbral_lamina` | 300 u/año | 0–100 000 (sugerir y avisar «Otras»; no es del motor) |

Constante `PARAMETROS_MOTOR_DEFECTO`; la versión guarda los usados. **`VERSION_MOTOR` sube con cualquier cambio de fórmula, ventana o redondeo**, en el mismo commit y con nota en `docs/DECISIONES.md`; entra en la huella. «Repetir con los mismos parámetros» da la misma huella y los mismos `propuesto` si las cargas y los maestros no cambiaron; si cambiaron, dice cuáles.

### 5.2 Ajustes y decisiones

- **Ajuste por tienda** (celda de la lámina): el valor de la lámina para esa tienda y año se reparte entre los GML de la lámina **en proporción a su `propuesto`** con `repartirEntero` (GML ordenados por id; si todos los `propuesto` son 0 o nulos, en proporción a la historia de `Y−1` de la tienda en cada GML; si también es 0, todo al GML de mayor `y25` de la red). Celda vacía → `ajustado = null` en todos los GML de esa tienda y año. Benavides se ajusta igual (por GML, sobre el vigente de Vector2).
- **Las cuatro cifras de un año** (`fuentes.ts`, mismo código en navegador y servidor): *Tiendas* = `Σ final` de las tiendas actuales de la lámina; *Vector2* = §5.1.3 (sin aperturas); *Planner* = `cierre_2026` o `proy_2027` de la importación vigente (si `incluye_aperturas = 'si'`, a `proy_2027` se le resta el final de las aperturas y se rotula; con `'no'` o `'desconocido'` se compara tal cual, con el aviso en el segundo caso); *Otra cifra* = la escrita. **Las aperturas no tienen selector de fuente**: siempre su `final` (ajustado o Vector2), instr. §5.4.
- **Aprobar** (solo admin) exige fuente en los dos años, inserta dos filas (una por año) con el mismo `acto_id`, la foto de las fuentes y el detalle final. Ajustar después deja la aprobación vigente con estado «aprobada con cambios sin aprobar» hasta que el admin vuelva a aprobar o retire. **Nunca se sobrescribe una aprobación** (instr. §7).
- **Estados de una lámina** (derivados): `pendiente`; `con_ajustes`; `aprobada` (último acto = aprobación, sin ajustes posteriores, con la misma composición y —si alguna fuente fue `vector2`— la misma cifra de Vector2); `aprobada_con_cambios`; `desactualizada`; en `0.20.1`, `aplicada` (el último lote `plan_tienda` aplicado es de esta aprobación y lo vigente de Vector2 coincide) y `aplicada_cambiada`.
- **Estado de una versión** (derivado, C16): `borrador` (alguna lámina sin aprobación vigente), `aprobada` (todas aprobadas), `aplicada` (tiene al menos un lote `plan_tienda` aplicado y no deshecho).

### 5.3 Láminas

1. Un género, un `slug` estable, 1 a 40 GML del mismo género; un GML en a lo sumo una lámina activa.
2. **«Otras líneas menores»** (una por género) contiene, al leer, todo GML activo del género sin otra lámina activa: la suma de las láminas de un género es exactamente la de sus GML (R12).
3. **Carga inicial como datos** (D5): los grupos de instr. §4.3 —Hombre: Sacos = casual + formal, Chompas = casual + formal, Bermudas = Bermuda; Mujer: Vestidos, Short, Falda y Carteras = casual + formal; Top = Top urbano + Croptop urbano; Blazer-Saco = Blazer y Sacos casual y formal; Chompas = casual + urbano; Chalecos y Calzados = casual + urbano + formal— se cargan con «Importar láminas» desde un archivo que Javier o el coordinador preparan fuera del repo (en `datos/`); después, **«Sugerir»** propone una lámina propia por cada GML no agrupado con ≥ 300 u en `Y−1` y deja el resto en «Otras».
4. **Cambia el árbol:** GML nuevo → «Otras» (aviso si ≥ 300 u); GML desactivado → deja de sumar, tachado en su lámina; lámina sin GML activos → huérfana (decisiones conservadas, no aplicable: `sin_filas`). Una decisión guarda sus `gml_ids`: si la composición cambia, `desactualizada`.
5. **`detallada_por_planner`** la pone el importador del planner (la lámina recibió valores en la importación vigente de su género).
6. La lámina es por GML; la agrupación de marca de Vector2 no es dimensión de la mesa y **nunca se compara con las agrupaciones de marca del planner** (instr. §4.2 e §11).

### 5.4 Carga parcial del mes en curso y M5

- **Grano y formato** (instr. §4.1): `GENERO_LK` (`H`/`M`), `MUNDO_LK`, `LINEA_SAP_LK`, métrica (`Cant Act`, `Venta Act`, `CV Act` = costo ÷ venta), `TIENDA` (nombre, se mapea a código con el resolutor de 05c), columnas de años. Se cruza por **GML**, nunca por equivalencia ni marca.
- **No toca M5**: vive en `plan_tienda_cargas` y solo la lee el motor. `venta_stock_vigente`, las curvas (M6), los factores del Niño (06e), la proyección (M7), el flujo (M8) y el tablero (M14) no la ven.
- **Cuando M5 publica el mes cerrado**: nada se borra ni se reemplaza a mano. El motor toma siempre `real(Y) = max(X, A)`; con el mes publicado, `A` ya lo incluye. Si M5 publica **el mes de `hasta_fecha`** (o uno posterior), la carga pasa a `superada` (derivado) y una versión nueva ya no la ofrece: el corte vuelve a ser el fin de `k'`, o una carga parcial nueva del mes siguiente. Las versiones viejas que la usaron siguen legibles y reproducibles (la carga no se borra).
- **«Si hay venta diaria, usar la venta diaria real»** (instr. §4.1): Vector2 no tiene venta diaria; queda fuera (§7).
- **¿Octubre en M5 es requisito?** **Para el motor, no**: la carga del 12-nov trae octubre y noviembre hasta el 12 (con `k'` = septiembre, `k' = m_c − 2`, el límite permitido). **Pero sí se recomienda cargarlo antes de crear la versión de trabajo**, por tres razones: (1) la corrección (b) de M7 necesita septiembre y octubre publicados para calcular el factor de verano (§8.1); (2) la columna Vector2 se calcula con `k` = septiembre y octubre real no entra en su cierre 2026 hasta recalcular con octubre; (3) con octubre en M5, la carga solo aporta noviembre hasta el 12 y la conciliación es más fina. La ficha **no lo bloquea** (la versión avisa «octubre no está publicado en M5») y deja la decisión a Javier (§11, pregunta 7).

### 5.5 Importación del planner (instr. §4.2)

- **Fuente:** en cada **pestaña de línea**, la fila cuyo rótulo es «Vta» —la fila 34 en los archivos actuales; el lector **busca el rótulo** en la columna de rótulos y avisa si no está en la 34, para no leer otra fila si el archivo cambia— con meses desde 2022-01: **2025 = `AM:AX`**, **ene–sep 2026 = `AY:BG`**, **oct–dic 2026 = `BH:BJ`**, **2027 = `BK:BV`**. `real_2025 = Σ AM:AX`; `real_ytd = Σ AY:BG`; `cierre_2026 = Σ AY:BJ`; `proy_2027 = Σ BK:BV`. Los rangos son constantes del lector derivadas de «enero de 2022 en la columna `C`» (`columnaDeMes(anio, mes)`), de modo que el plan de 2027–2028 solo cambia el año base.
- **Nunca** la hoja «OTB - Unidades»: el lector la ignora por nombre y la vista previa lo dice.
- **Mapeo pestaña → lámina** con lo recordado (`planner_mapeos`), sugerencia por nombre igual o elección manual; varias pestañas a una lámina se suman; una pestaña puede marcarse «ignorar».
- **Control de cuadre** (instr. §4.2 y criterio 2 de instr. §10): por lámina y por género, `real_2025` frente a `y25` de Vector2 (todas las tiendas tipo Tienda, todos los GML de la lámina) y `real_ytd` frente a enero a `k'` de `Y`. Diferencia > max(0,5 %, 50 u) en una lámina → `planner_no_cuadra` en esa lámina; por género se muestra la diferencia total. **Avisa, no bloquea.** Si `k'` no es septiembre, se compara enero a `k'` con los meses equivalentes del planner (`AY..`) y se dice.
- Se guarda archivo, fecha, quién y cuándo, `incluye_aperturas` y los cuatro valores por lámina (instr. §4.2). Formato real del archivo: depende de los ejemplos (§10).

### 5.6 Escritura de vuelta a la proyección (`0.20.1`; instr. §8)

**Nunca sobre una cerrada ni una archivada**; siempre sobre la proyección destino de la versión, en trabajo, que después se cierra con el cierre normal de M7. Una lámina se escribe entera (los dos años, todas sus filas y totales de tienda) o no se escribe; las láminas son independientes.

**Paso 1 · Destino por GML, tienda y año** (al aprobar, guardado en `fuentes`). Para cada año: con fuente `tiendas`, el `final` de cada GML × tienda actual; con otra fuente y cifra `T`, ese vector **escalado a `T`** con `repartirEntero` (ordenado por GML y código de tienda; si todo el vector es 0, en proporción a lo vigente de Vector2 por GML y bloque); con `vector2`, lo vigente (normalmente no cambia nada: `sin_cambios`). Aperturas: su `final` por GML.

**Paso 2 · Grupos de escritura.** Por GML y año, el destino se agrupa por **bloque de tiendas** según `parametros.bloques` de la proyección: `M(Z)` → **filas base** de ese GML y año (todas sus AM y, en nodos GMLE, equivalencias); cada tienda de `N(Z).nuevas_anterior` (R511 en 2026) → **sus filas de tienda**; cada apertura o cierre (R512 en 2027) → **sus filas de tienda**. Instr. §10.5 se cumple: `Σ decidido(base + R511)` = aprobado de tiendas actuales y `Σ decidido(R512)` = aprobado de Benavides.

**Paso 3 · Reparto dentro de un grupo** con total `T_G`:
- **Conflictos:** filas del grupo **fijadas a mano** = `origen = 'manual'` sin `decision_lote_id` ni `decision_ia_fila_id` (la clase «manual» de M14) con un `decidido` distinto de lo que el reparto les daría. Se listan en la simulación; sin elección para la lámina, `409 conflictos_sin_resolver`. Con **«respetar»**, conservan su cifra y `T'_G = T_G − Σ fijadas`; con **«pisar»** (admin), entran al reparto como las demás.
- **Pesos** (instr. §8.1): `propuesto` del año; si todos son 0 o nulos, `vendido`; si también, la venta de `Y−1` de la fila (`historico`); si también y `T'_G > 0` → `sin_base_reparto`.
- **Piso en `Y`:** cada fila recibe al menos su `vendido` (regla de M7, `menor_que_vendido`): `x_r = vendido_r + repartirEntero(T'_G − Σ vendido, pesos'_r)`, con `pesos'_r = max(peso_r − vendido_r, 0)` (si todos son 0, `peso_r`). `T'_G < Σ vendido` → `menor_que_vendido` (o `manual_excede` si lo causa lo respetado). En `Y+1` no hay piso.
- **Mayor resto** con el orden de la `clave` de la fila (determinista).
- Se reemplaza toda otra clase (aceptada tal cual, aprobada en bloque por 07g, aceptada de la IA, escalada, sin decidir), con su foto en `anterior`.

**Paso 4 · Aplicar con la lógica de M7, en memoria y en este orden** (es lo que mantiene coherentes B2 y Σ meses):
1. **Filas de tienda de `Y`** (R511 en 2026): cada fila con `aplicarDecision` (`origen = 'manual'`, que en una fila de tienda es «fijada»); si la tienda tiene total decidido `D` en `Y`, se mueve a **`max(D + Δ, Σ fijadas)`** con `moverTotalTienda` (07b): las filas de esa tienda **de otros GML no cambian**. Si no tiene `D`, no se crea. Como R511 está en `M(Y+1)`, su cambio entra en `B` de las filas base de `Y+1` (B2, `propagarTienda`).
2. **Filas base de `Y`**: `aplicarDecision` por fila; B2 recalcula `propuesto` de `Y+1` de esas filas.
3. **Filas base de `Y+1`**: los pesos se toman **después** del paso 2 (la propuesta de `Y+1` ya recalculada); `aplicarDecision`.
4. **Filas de aperturas de `Y+1`** (R512): `aplicarDecision` por fila y el total de la tienda (instr. §8.2: «actualizar `proyeccion_tiendas.decidido` de R512») a **`max(D + Δ, Σ fijadas)`**; si R512 no tenía `D`, `D' = Σ vigente de todas sus filas antes + Δ`, que deja igual el factor de escala de sus filas de otras láminas. **No** se usa `aplicarDecisionTienda` con el total (regla 23 reescalaría las filas de R512 de todas las láminas, C4).
5. Los `meses` salen de `aplicarDecision` (reparto de M7 con la curva y los reales hasta `k`); **no se escala `meses[]` por fuera** (C8). Antes de mandar nada a la base se comprueba `Σ meses = vigente` en cada registro tocado (R31); si falla, la lámina se rechaza con `meses_no_cuadran` (señal de que falta la corrección de M7 en curso).
- `decidido_por_*` = quien **aprobó** la lámina; `decidido_at` = el sello del lote; `nota` = «Plan por tienda · *lámina* · aprobado por *nombre* el *fecha* · aplicado por *nombre*» (con el tope de nota de M7); `decision_lote_id` = el lote; `decision_ia_fila_id = null`.

**Paso 5 · Simulación y huella** (como 07g D8): la vista previa devuelve el antes y después por GML y total (tiendas actuales y Benavides por separado), los conflictos, los totales de tienda movidos, los rechazos y los GM cuyos crecimientos quedarían por reaprobar (`ninoDeFilas` en memoria, 07g D15); su `huella_simulacion` (sha-256 canónico) viaja en la confirmación; si el servidor obtiene otra, `409 simulacion_distinta`. Más de 100 filas o algún conflicto pisado → casilla obligatoria «Revisé el antes y el después» (`revision_requerida`).

**Paso 6 · `aplicar_lote_plan_tienda(p jsonb)`** (patrón de `aplicar_lote_proyeccion`, 07g §2.4 y decisión 82-a):
1. `select … from proyecciones … for no key update`; idempotencia por `lote_id` + `huella_cuerpo` (`repetido` / `PT004 lote_ajeno`).
2. `estado ≠ 'en_trabajo'` → `PT001`; cálculo vivo → `PT002`; `calculado_at` distinto → `PT003 datos_cambiaron`.
3. **Pasada 1, sin escribir:** `for update`, en orden `(fila_id, anio)`, de todos los registros que se leen o escriben (los de las láminas en los dos años, los de B2 y los de `proyeccion_tiendas` tocados); `updated_at::text = esperado` (si no, `cambio_concurrente` en la lámina); la aprobación usada sigue siendo la última de su lámina × año (`aprobacion_no_vigente`); los conflictos «respetar» siguen como se vieron.
4. **Pasada 2:** escribe con la lista fija de columnas de `payloadAnioDecision` sin `activo`, más `decision_lote_id`; en `proyeccion_tiendas`, `decidido`, `origen = 'manual'`, `nota`, `decidido_*`. Prueba estática: la lista coincide con la de `aplicar_lote_proyeccion` (R14 de 07g).
5. Inserta las `proyeccion_lote_filas` (con `anterior`, `objetivo`, `tienda_id`, `fuente = 'plan_tienda'`) y **al final** la cabecera `proyeccion_lotes` (`tipo = 'plan_tienda'`, `plan_tienda_version_id`, `anio` = `Y` —el lote cubre los dos años; la columna es obligatoria y se usa el año en curso—, `resumen` calculado con lo escrito: láminas aplicadas y rechazadas por código, filas y unidades por clase anterior, conteo de conflictos pisados y respetados). FK diferibles como 07g.
6. `PT005` (revertido ajeno o no `plan_tienda`), `PT006` (proyección inexistente), `PT007` (payload inválido), `PT008` (un registro que debía escribirse no se escribió), `PT009` (Σ meses ≠ vigente en un registro escrito: defensa en profundidad de R31). `40P01`/`55P03`/`57014` → `409 conflicto_reintentar`.
7. TypeScript llama **una vez** a `refrescarResumen` de M7.

**Deshacer** (`revertir_plan_tienda`): por cada registro que sigue con `decision_lote_id` = el lote, restaura `anterior` (cifra, origen, autor, lote o traza de IA anteriores) con `aplicarDecision` y B2; los totales de tienda vuelven a su `anterior` si nadie los cambió después (si no, `cambiada_despues` y se avisa). Siempre permitido con la proyección en trabajo y sin cálculo en curso (como 82-e).

**Qué pasa si la proyección cambió desde que se aprobó la lámina:** la escritura usa los pesos de hoy (las propuestas recalculadas) y la simulación muestra «Vector2 al aprobar *X* · hoy *Y*»; si la fuente aprobada fue `vector2` y Vector2 cambió → `vector2_cambio` (volver a aprobar); un recálculo entre la simulación y la confirmación → `datos_cambiaron`.

### 5.7 Efectos en M7, 07g, M14, 07f y M8

- **M7.** Las filas escritas son decisiones normales (`origen = 'manual'`, con autor y nota), sobreviven a cualquier recálculo y no bloquean el cierre. «Por línea» muestra en esas filas el `Badge` «Plan por tienda · *lámina*» (desde el tipo del lote de `decision_lote_id`). Toda decisión individual posterior pone `decision_lote_id = null` (ya es así, 07g §3.6). `copiar_de` no copia `decision_lote_id` (ya es así). Único cambio de M7: `DELETE` de una proyección con versiones → `409 tiene_plan_tienda`.
- **07g.** «Aprobar» no toca estas filas (están decididas). **«Reaprobar» excluye los registros cuyo lote es `plan_tienda`** (cambio en `src/lib/aprobacion/`: el universo de reaprobables filtra por el tipo del lote; sin él, «Reaprobar» pisaría lo aprobado por Javier con el método o la IA). «Revertir» de 07g ya rechaza un lote que no sea `aprobar` o `reaprobar` (`LP005`); la pestaña Aprobación lista los lotes `plan_tienda` con su rótulo y remite a «Deshacer» de 07h. Una fila que un lote de 07g había aprobado y que 07h reescribe sale de ese lote (su `decision_lote_id` cambia), así que revertir el lote de 07g ya no la toca (`cambiada_despues`).
- **07e (IA).** Las filas escritas cuentan como fijas (`manual` con cifra).
- **M14.** Escribir cambia cifras: **invalida la aprobación de dirección** de esa proyección (es lo esperado: la mesa prepara cifras por lámina y M14 aprueba la proyección entera; el orden es aplicar → cerrar → aprobar en M14). En `0.20.1`, `tablero_proyeccion` (`create or replace` en la migración de la entrega, o en la `0042` si ya se sabe) clasifica **lote `plan_tienda` antes que lote de 07g**: «Cómo se decidió» gana la clase «Plan por tienda» y el puente una línea «Plan por tienda» separada de «Fijado a mano» y de «Otras diferencias» (R4 de M14 sigue exacto). **La huella de M14 no cambia** (no incluye el origen ni el lote).
- **07f y la atribución de M14:** sin cambios (D11).
- **M8:** sin cambios de contrato; el flujo cambia al cerrar la proyección (D12).

### 5.8 Invariantes (vitest; las de la base, también en el humo)

**Motor**
- **R1 · Corte.** Con corte el 12 del mes `m_c` de 30 días, `α = 0,4`; `mp`, `W25` y `resto25` toman `α` y `1 − α` del mes del corte; con corte el último día del mes, `α = 1` y `resto25` es la suma de los meses siguientes; sin carga, `d` = fin de `k'`. `real(Y) = max(X, A)`; `X < A` da el aviso y usa `A`. Ninguna fórmula contiene un año o un mes fijo (prueba estática sobre `motor.ts` y `cubetas.ts`: sin literales `2025`, `2026`, `0.4`, `0.6`).
- **R2 · Ritmo.** Las tres fórmulas de §5.1.4 con `K` y `k` de parámetro; acotado; `T_sg = T_g` sin venta propia; `T_g = T_temp` con un solo GML.
- **R3 · Cierre.** `cierre(Y) = real(Y) + resto25 × T_sg ≥ real(Y)`.
- **R4 · 2027 por temporada.** Las tres filas de §5.1.5; propiedades de neutralidad (todo el año: tienda igual a la red ⇒ `p27 = y25 × T_temp`; invierno ⇒ `y25 × T_tempI(todo el año)`).
- **R5 · Anualización.** Ventana de `Y−1` < 100 u ⇒ `p27 = B26 ÷ peso` (y `÷ corr_inv` en invierno), nunca `y25 × ritmo`.
- **R6 · Tienda nueva.** R511 sintética proyecta sin error, con `R_g` encogido con 300; `cierre ≥ real`; `p27` anualizado.
- **R7 · Reproducible.** Misma entrada ⇒ misma huella y mismos `propuesto`; cambiar `VERSION_MOTOR`, un parámetro, la carga o una carga de M5 cambia la huella.
- **R8 · Tiendas por bloque.** Antiguas = `M(Y)`; R511 sintética `nueva`; R512 sintética `apertura`; el CD nunca aparece; **una apertura nunca suma en tiendas actuales** (en `fuentes.ts`, en `plan_tienda_vector2`, en la API y en el Excel); total = tiendas actuales + aperturas.
- **R9 · «—» y no 0.** Tienda sin abrir en un año ⇒ `null` en la historia; abierta sin venta ⇒ 0.
- **R10 · Temporada** según §5.1.2, con empate y `sin_temporada` como todo el año.
- **R11 · Redondeo.** Una vez por GML × tienda × año; toda suma es suma de enteros.

**Láminas, carga y planner**
- **R12 · Cobertura.** Un GML en a lo sumo una lámina; con «Otras» implícita, `Σ láminas de un género = Σ GML del género` (nada fuera, nada dos veces).
- **R13 · Slug estable** y único; cambiar la composición deja las aprobaciones `desactualizadas`, no las borra ni las mueve.
- **R14 · Carga parcial aislada.** Guardar una carga no cambia ni un byte de `venta_stock_vigente`, de las curvas, de los factores ni de ninguna proyección; publicar en M5 el mes de `hasta_fecha` la deja `superada`.
- **R15 · Planner.** Lee la fila con rótulo «Vta» y los rangos `AM:AX`, `AY:BG`, `BH:BJ`, `BK:BV` relativos a enero de 2022; **ignora «OTB - Unidades»**; el control de cuadre avisa y no bloquea; la huella de la vista previa protege el guardado.

**Ajustes y decisiones**
- **R16 · Ajuste por tienda.** Se reparte entre los GML de la lámina en proporción al `propuesto` y suma exacto; **celda vacía = vuelve a la propuesta** en todos los GML; totales, % y la opción «Tiendas» se recalculan (función pura compartida, probada con el caso de §6.1 C).
- **R17 · Aprobar exige las dos fuentes** (`400 fuente_requerida`); «Otra cifra» exige valor y nota.
- **R18 · Solo el admin aprueba y retira** (`403` planner; `check (rol = 'admin')`).
- **R19 · Concurrencia.** Dos guardados o aprobaciones con la misma versión vista: uno `201`, otro `409 lamina_cambio`; ninguna fila duplicada.
- **R20 · Solo inserción.** `update`, `delete` y `truncate` sobre `plan_tienda_decisiones`, `plan_tienda_ajustes`, `plan_tienda_carga_filas` y `planner_valores` fallan también con `service_role`; `propuesto` de `plan_tienda_valores` no cambia tras crear la versión (prueba en el humo).
- **R21 · Valores = fuentes.** El servidor recalcula y rechaza con `409 fuentes_cambiaron`; `valor_total = valor_tiendas_actuales + valor_aperturas`.
- **R22 · Destino en trabajo.** No se crea versión, ni se ajusta, aprueba o aplica sobre una proyección cerrada o archivada; `DELETE` de una proyección con versiones → `409 tiene_plan_tienda`.
- **R23 · Excel.** Tres hojas `plan_claudio`, `tiendas` y `notas`; Benavides en columnas o filas propias en todas; ningún total mezcla aperturas con tiendas actuales.

**Escritura (`0.20.1`)**
- **R24 · Cuadre.** Por lámina y año, `Σ decidido` de sus filas base + filas de R511 = aprobado de tiendas actuales y `Σ decidido` de las filas de R512 = aprobado de Benavides, **exacto** (instr. §10.5).
- **R25 · Piso.** Ninguna fila de `Y` queda bajo su `vendido`; si no cabe, `menor_que_vendido` y la lámina no se escribe.
- **R26 · Conflictos.** Con filas fijadas a mano distintas y sin elección, `409 conflictos_sin_resolver`; «respetar» las deja intactas; «pisar» exige admin.
- **R27 · Solo lo de la lámina.** Las filas de otros GML, incluidas las de R512 y R511 de otras láminas, no cambian (el total de la tienda se mueve con `max(D + Δ, Σ fijadas)`).
- **R28 · Lote auditable.** Un `proyeccion_lotes` de tipo `plan_tienda` con una `proyeccion_lote_filas` por registro y por total de tienda, con `anterior`; conteos calculados con lo escrito; inmutable.
- **R29 · Idempotencia y concurrencia.** Reintento con el mismo `lote_id` → `repetido`; otro cuerpo → `lote_ajeno`; un registro cambiado entre simulación y escritura → `cambio_concurrente` en su lámina; un recálculo → `datos_cambiaron`.
- **R30 · Deshacer** restaura `anterior` de lo que nadie cambió después, incluidos los totales de tienda.
- **R31 · Σ meses = vigente** en cada registro escrito (comprobado en TypeScript antes y en la función, `PT009`).
- **R32 · 07g y M14.** «Reaprobar» de 07g no ofrece filas de un lote `plan_tienda`; «Revertir» de 07g rechaza esos lotes; una decisión individual posterior limpia `decision_lote_id`; la huella de M14 no cambia por la migración y sí al aplicar; «Cómo se decidió» y el puente de M14 muestran «Plan por tienda» y el puente sigue exacto.
- **R33 · Cerrada intacta.** Ninguna operación de 07h cambia la cerrada, `GET /api/proyeccion/cerrada` ni el flujo (comparación antes y después en la base falsa).

### 5.9 Casos borde

| Caso | Comportamiento |
|---|---|
| Sin carga parcial | Corte = fin de `k'`; `Alert` «sin venta posterior a *mes*» |
| Carga parcial con `hasta_fecha` dentro de un mes ya publicado | `409 fecha_ya_cerrada` |
| M5 publica noviembre después de crear la versión | La versión sigue igual (es una foto); la carga queda `superada`; «Nueva versión» usa noviembre de M5 |
| Combinación tienda × GML que solo está en la carga | Entra (`A = 0`, `real = X`); su historia de Vector2 es «—» o 0 según la apertura |
| GML sin venta en las ventanas | `T_g = T_temp`; tienda sin venta: `T_sg = T_g`; `p27 = 0` si `y25 = 0` y la ventana de `Y` es 0 |
| Tienda que cierra durante `Y` o `Y+1` | `cierre`: va con las aperturas (aparte) con lo vigente de Vector2 |
| Lámina sin planner | Opción «Planner» deshabilitada con «sin plan»; se lista en «Sin detalle del planner» |
| Planner con una pestaña sin lámina | `409 pestana_sin_lamina` hasta asignarla o marcarla «ignorar» |
| Lámina con GML de nivel GMLE | El motor lo trata entero; la escritura reparte entre las filas por equivalencia |
| Dos personas ajustando la misma lámina | La segunda recibe `409 lamina_cambio` (§4.9) |
| Aprobación y después se recalcula la proyección | La lámina sigue `aprobada` salvo que la fuente fuera `vector2` y Vector2 cambiara (`desactualizada`) |
| Lámina aprobada cuyas filas están todas fijadas a mano y se elige «respetar» | `manual_excede` o `sin_cambios` según cuadre; la vista previa lo dice antes de confirmar |
| R512 sin filas de un GML de la lámina con Benavides aprobado > 0 | `sin_filas` en esa lámina (no se crean filas: las crea el cálculo de M7) |
| Proyección destino desactualizada (p. ej. tras `VERSION_METODO = 6`) | Aplicar bloqueado (`proyeccion_desactualizada`) hasta recalcular; ajustar y aprobar siguen permitidos |

## 6. Criterios de aceptación / hito de prueba

### 6.1 Caso sintético (`tests/plan-tienda.fixture.ts`; todas las cifras inventadas)

**Tiendas** (`Y = 2026`, corte 12-nov, `α = 0,4`, `k'` = septiembre): T1, T2 y T3 antiguas (`M(2026)`); T4 abrió el 2025-11-20 (`N(2026).nuevas_anterior`, `M(2027)`: la «R511»); T5 abre el 2027-06-15 (`N(2027).aperturas`: la «R512»); un CD con venta (nunca aparece).

**A · Motor, lámina L1 = GML G1 (todo el año).** En la temporada «todo el año» hay además G5 (solo T1: jul–sep 2025 = 80, oct 2025 = 10, nov 2025 = 15, dic 2025 = 30; ene–jun 2026 = 0, jul–sep 2026 = 70, carga = 85 al corte).

| G1 | jul–sep 25 | oct 25 | nov 25 | dic 25 | y25 | ene–jun 26 | jul–sep 26 | carga al corte |
|---|---|---|---|---|---|---|---|---|
| T1 | 300 | 100 | 100 | 200 | 1 200 | 570 | 330 | 1 050 |
| T2 | 150 | 50 | 50 | 100 | 600 | 330 | 120 | 500 |
| T3 | 30 | 10 | 10 | 20 | 120 | 55 | 45 | 120 |
| T4 | — | — | 5 | 15 | 20 | 190 | 110 | 360 |

Resultados esperados: `W25` = 440 / 220 / 44; `W26` = 480 / 170 / 65; con G5 (`W25` = 96, `W26` = 85), **`T_temp = 800 ÷ 800 = 1`**; `T_g(G1) = (715 + 500) ÷ (704 + 500) = 1,009136…`; `T_sg` = 1,070119… / 0,868569… / 1,115312…. **Cierre 2026**: T1 = 1 050 + 260 × 1,070119 = **1 328**; T2 = 500 + 130 × 0,868569 = **613**; T3 = 120 + 26 × 1,115312 = **149**; T4 (nueva): `C26` = 60, `R_temp = 455 ÷ 240 = 1,895833`, `R_g = (416 + 300 × 1,895833) ÷ (224 + 300) = 1,879294`, cierre = 360 + 60 × 1,879294 = **473**. **2027**: T1 = 1 200 × 1,070119 = **1 284**; T2 = **521**; T3 tiene `W25 = 44 < 100` ⇒ anualizada: `peso = 704 ÷ 1 920 = 0,366667`, 65 ÷ 0,366667 = **177**; T4 = 170 ÷ 0,366667 = **464**. **Tiendas actuales L1: cierre 2026 = 2 563; 2027 = 2 446.** T5 (apertura) 2027 = **300** (vigente de Vector2 de sus filas de G1). Total 2027 = 2 746.

**B · Verano e invierno** (G2 y G3 con tres tiendas): neutralidad de R4 (tiendas que se mueven igual que la red), `corr_inv` = cociente de los ritmos de red de invierno y todo el año en la ventana enero–corte, y un caso con `I25 < 100` anualizado con `÷ corr_inv`.

**C · Criterio 3 de las instrucciones, en sintético.** En L1, corregir T1 2027 de **1 284 a 1 100** y T5 (la «Benavides») de **300 a 360**: tiendas actuales pasa de **2 446 a 2 262**; Benavides queda en **360**; total con Benavides = **2 622**; la opción «Tiendas» del bloque 2027 muestra **2 262**; borrar la celda de T1 vuelve a 1 284 y a 2 446. **Reparto del ajuste entre GML:** en una lámina L2 = Ga + Gb con `propuesto` de T1 en 2027 de 300 y 100, ajustar T1 a 500 deja **375 y 125**.

**D · Aprobación.** Aprobar L1 sin fuente de 2027 → `400 fuente_requerida`; con «Tiendas» y «Tiendas»: dos filas (2026: 2 563 / 0 / 2 563; 2027: 2 262 / 360 / 2 622) con el mismo `acto_id`; como planner → `403`; dos aprobaciones simultáneas → una `409 lamina_cambio`.

**E · Escritura (0.20.1).** Proyección en trabajo con, para G1:
- **2027, filas base** (`M(2027)` = T1–T4): A (`propuesto` 1 500, sin decidir), B (`propuesto` 650, **fijada a mano en 700**), C (`propuesto` 300, aprobada en bloque por 07g). Destino 2 262 (tras el ajuste de C). Sin elegir → `409 conflictos_sin_resolver`. **Respetar B**: 1 562 entre A y C por 1 500 : 300 → **A = 1 302, C = 260**, B = 700 (Σ = 2 262). **Pisar B** (admin): 2 262 por 1 500 : 650 : 300 → **A = 1 385, B = 600, C = 277** (Σ = 2 262).
- **2026, filas base** (`M(2026)` = T1–T3, destino 1 328 + 613 + 149 = **2 090**): A (`propuesto` 1 400, vendido 1 000), B (fijada a mano en 600, vendido 450), C (`propuesto` 250, vendido 150). Respetando B: 1 490 con pisos 1 150 y resto 340 por 400 : 100 → **A = 1 272, C = 218**.
- **2026, T4** (filas de tienda `nuevas_anterior`, destino **473**): A_T4 y B_T4 con `propuesto` 300 y 100 (escaladas, vigentes 300 y 100), total decidido de T4 en 2026 `D = 1 000` → **355 y 118**, `D' = max(1 000 + 73, Σ fijadas) = 1 073`; las filas de T4 de otros GML no cambian.
- **2027, T5** (destino **360**): A_T5 y B_T5 con `propuesto` 200 y 100 → **240 y 120**; T5 sin `D` y con 5 000 de vigente total en todos sus GML → `D' = 5 060`.
- Un lote `plan_tienda` con una línea por registro y por total de tienda, con `anterior`; `Σ meses = vigente` en todos; «Reaprobar» de 07g no ofrece A ni C; «Deshacer» devuelve C a su cifra y su lote de 07g, B a 700 y los totales de T4 y T5 a 1 000 y sin decidir.

**F · Carga y planner.** Una carga parcial con una tienda desconocida y una ubicación ignorada (omitidas), una combinación con `X < A` (aviso); publicar el mes de `hasta_fecha` en la base falsa la deja `superada`. Un archivo del planner sintético con tres pestañas de línea (fila «Vta» en la 34 y en otra fila en una de ellas, con aviso), una hoja «OTB - Unidades» con cifras distintas (ignorada) y un control que no cuadra en una lámina (aviso, guarda igual).

### 6.2 Hito (Javier y Cowork; sección nueva de `docs/pruebas/cowork-checklist.md`)

1. **Entrega previa `0.19.3 · M7 i`**: en una copia en trabajo recalculada, ninguna fila de cola larga con disponibilidad bajo 25 % recibe la corrección; esas filas no aparecen como aprobables en «Aprobación»; en Factores del Niño, con septiembre y octubre publicados, el verano 2026 tiene calculado y, si el aplicado se aparta, se ve el aviso; la cerrada no cambió.
2. Importar la carga parcial del 12-nov: vista previa con el % de cruce y la conciliación; guardar.
3. Importar los dos archivos del planner: pestañas con su lámina, «OTB» ignorada, control de cuadre por género.
4. Cargar las láminas iniciales (§5.3) y revisar «Otras».
5. Crear una versión con la carga y la proyección destino en trabajo, con la cerrada como referencia.
6. **Comprobar las cifras reales** de instr. §5.5 (±0,5 %) según §6.3.
7. Recorrer Hombre y Mujer con «Siguiente pendiente»; corregir El Sol y Benavides en Polos urbano Hombre y ver los totales del criterio 3 de las instrucciones.
8. Aprobar láminas con distintas fuentes; como planner, no aparece «Aprobar»; como comprador, no hay item.
9. Descargar `plan_claudio.xlsx` y revisar las tres hojas y Benavides aparte.
10. **(`0.20.1`)** Aplicar a la proyección en trabajo: ver antes y después, los conflictos con lo fijado el 08/11 y elegir; comprobar en Proyección que la suma de `decidido` de las filas base + R511 de la lámina es el aprobado de tiendas actuales y la de R512 el de Benavides; ver el lote en «Aprobación» y «Plan por tienda» en «Cómo se decidió» de M14; deshacer una lámina; cerrar la proyección y ver el flujo cambiado.
11. En un teléfono (390 px): lista, lámina, edición de una celda, aprobar.
12. Pasan `npm run lint`, `npx tsc --noEmit`, `npx vitest run` y `npm run build`; `APP_VERSION` de cada entrega.

### 6.3 Las cifras reales: fuera del repositorio

Las cifras de instr. §5.5 y §10 (totales por género, el ejemplo de Polos urbano Hombre y sus tiendas) **no se escriben** en fichas, pruebas, fixtures, commits ni `docs/`. QA y el hito las comprueban **contra la base** con una hoja que el coordinador guarda fuera del repo (`datos/`, ignorada): versión con la carga del 12-nov y la cerrada `3dad947b` como referencia de Vector2; tolerancia ±0,5 %. **Reproducirlas exige la misma venta al 12 de noviembre que usó el prototipo** (la carga parcial con ese archivo) y que las cargas de M5 de 2023 a septiembre de 2026 sean las mismas (la huella de la versión lo deja escrito); con octubre ya publicado en M5 el resultado debe ser el mismo salvo diferencias de fuente entre el Excel y M5 (por eso `max(X, A)`). La columna Vector2 de la cerrada saldrá **con** la cola larga inflada (es la cerrada, no se recalcula); la comparación limpia (instr. §10.6) se hace contra la copia en trabajo recalculada con el método 6.

### 6.4 Seguridad (la revisa `seguridad`, sonnet, solo lectura)

- Cada handler de `src/app/api/plan-tienda/` empieza con su guard; aprobar y retirar con `requireAdmin`; aplicar con `requirePlanner` y `requireAdmin` cuando se pisa lo fijado a mano; ninguna ruta con `requireUser` (decisión 113).
- Perfil, nombre y rol de la sesión; los valores aprobados los recalcula el servidor.
- Tablas nuevas con RLS sin políticas; `anon` y `authenticated` sin privilegios; solo inserción donde corresponde (triggers también contra `truncate`); `check (rol = 'admin')` en decisiones.
- Funciones `security invoker`, `search_path = ''`, `execute` solo `service_role`; las de lectura `stable` sin escrituras; `plan_tienda_venta_motor` no lee `stock_valorizado`; costo y margen solo llegan a admin y planner.
- Límites: ≤ 30 000 filas de carga, ≤ 80 pestañas, ≤ 60 celdas por ajuste, ≤ 25 láminas por aplicación, notas ≤ 1 000, `fuentes` ≤ 64 KB, cuerpo ≤ `MAX_BYTES_CUERPO`.
- Los archivos se leen en el navegador; el servidor solo recibe filas tipadas. `500` sin detalles. Nada de datos reales en el repo.

### 6.5 Pruebas (cada archivo con un solo dueño)

- `backend`: `tests/plan-tienda.fixture.ts`, `tests/plan-tienda.fake-db.ts`, `tests/plan-tienda.motor.test.ts` (R1–R11, caso A y B), `tests/plan-tienda.laminas.test.ts` (R12, R13), `tests/plan-tienda.carga.test.ts` (R14, caso F), `tests/plan-tienda.planner.test.ts` (R15), `tests/plan-tienda.ajustes.test.ts` (R16, caso C), `tests/plan-tienda.decisiones.test.ts` (R17–R22, caso D), `tests/plan-tienda.rutas.test.ts`, `tests/plan-tienda.estatico.test.ts` (guard primero, único archivo de base, sin literales de año ni de pesos en el motor, lista de columnas de la escritura igual a la de 07g); en `0.20.1`, `tests/plan-tienda.escritura.test.ts` (R24–R33, caso E) y el ajuste de `tests/aprobacion.*` (reaprobar excluye `plan_tienda`); en `0.19.3`, `tests/proyeccion.cola-larga.test.ts` (mínimo de disponibilidad) y `tests/aprobacion.*` (exclusión).
- `frontend`: `tests/plan-tienda.vista.test.ts` (filas, totales, «—», Excel R23) y `tests/plan-tienda.render.test.ts` (roles, botones, 390 px, `409 lamina_cambio`).
- `datos`: `scripts/humo-0042.sql` (inmutabilidad, `propuesto` inmutable, únicos, `check` de rol y de totales, `aplicar_lote_plan_tienda` con el caso E, dos aplicaciones de la migración).
- `qa`: `tests/plan-tienda.qa.test.ts` (casos borde de §5.9 que falten).
- `tests/api.guards.roles.test.ts`: las rutas nuevas (`backend`).

## 7. Fuera de alcance y limitaciones

- **El motor no ve el stock**: una línea quebrada en 2026 sale baja aunque la demanda exista (aviso `posible_quiebre`; corregir por stock queda para otra ficha).
- **Marcas que entraron en 2025–2026** inflan la tendencia (aviso `crecimiento_alto` > 1,5 × cierre; descontar el efecto de la marca queda para después).
- **Cola larga**: la corrige la entrega previa en M7 (§8.1); la mesa solo avisa y no la arregla por su cuenta.
- **Venta diaria** (instr. §4.1, «si hay venta diaria, usarla»): Vector2 no la tiene.
- **Nodos GMLE**: el motor los proyecta enteros (por GML); un motor por equivalencia queda para después.
- **Agrupación de marca** como dimensión de la mesa, y cualquier comparación con las agrupaciones del planner (instr. §11).
- **Flujo por tienda en M8** con el detalle aprobado (instr. §8.4: queda previsto, D11); alimentar 07f o la atribución de M14 con ese detalle.
- **Vista previa del flujo** con una proyección en trabajo (M8 lee la cerrada).
- **Traer aprobaciones de otra versión o proyección** (cada versión nace sin aprobaciones; «traer ajustes» sí está): propuesta para una entrega posterior si Javier la pide.
- Rol `direccion` y aprobadores además del admin (pregunta 4).
- Tiempo real por canales; la marca y el tema del prototipo.

## 8. Entregas

**Por qué tres.** Las correcciones de M7 cambian cifras de la proyección y deben estar antes de comparar «Vector2» en la mesa (instr. §3); no necesitan migración. La mesa sola ya da valor (Javier decide por lámina, el Excel `plan_claudio` va al planner) y su hito valida el motor contra las cifras reales antes de escribir nada. La escritura toca el corazón de M7 y depende de la corrección del invariante Σ meses que otra tarea está haciendo ahora; conviene construirla cuando ese arreglo esté y con las cifras ya validadas.

### 8.1 Entrega previa `0.19.3 · M7 i` (sin migración; instr. §3)

Verificado en el código (2026-11-21): `disponibilidadFila` (`src/lib/proyeccion/cola-larga.ts:88-140`) calcula `A_f` sin tope y, con `dispon < 0,75` y `A_f ≥` umbral, marca `revision` y `proponerPorDemandaCorregida` propone `max(vendido, round(A_f))`; el universo de 07g incluye `revision_cola_larga` (07g D1, `src/lib/aprobacion/plan.ts`); `MIN_MESES_FACTOR = 2` (`src/lib/proyeccion/tipos-api.ts:66`) y `factorRelativoPeriodo` deja `ratio_calculado = null` con menos de 2 meses del periodo con dato (`factor-nino.ts:72-84`); `VERSION_METODO = 5` y una proyección con versión menor queda «desactualizada» (`desactualizado.ts:304-306`).

**(a) Tope a la corrección de cola larga.**
- Nuevo parámetro de la proyección `disponibilidad_minima` (0,25 por defecto; 0–`umbral_disponibilidad`), en `parametros` (jsonb existente: sin migración), editable en «Nueva proyección» junto a los umbrales de cola larga; las proyecciones calculadas antes lo leen como 0,25 al recalcular.
- En `disponibilidadFila`: con `dispon < disponibilidad_minima`, **no se corrige**: `A_f` se informa pero no se propone; la propuesta queda la del avance; si `A_f ≥` umbral el veredicto sigue siendo `revision` (la fila **bloquea el cierre y se decide a mano**, «revisión de verdad»), con el aviso nuevo `disponibilidad_bajo_minimo` y `A_f` como `referencia_alternativa`; si no, `cierra_con_quiebres` como hoy. Entre el mínimo y el umbral, como hoy.
- **Ninguna fila `revision_cola_larga` se aprueba en bloque** (código de exclusión nuevo `cola_larga_revision` en 07g, con el texto «decídela en Por línea»), en los dos años. Matiza 07g D1 (decisión propuesta 163).
- **`VERSION_METODO` sube a 6**: toda proyección queda «desactualizada» (`version_metodo`) hasta recalcular; las decisiones se conservan; los lotes de 07g se bloquean hasta recalcular (07g D14). **La cerrada `3dad947b` no se toca** (una cerrada no se recalcula; sigue siendo lo que lee M8, rotulada «método anterior»).
- **Decisiones heredadas sobre la propuesta sin tope** (las 372 filas que se aprobaron en bloque en la cerrada; en la copia en trabajo llegan como decisiones copiadas): recalcular no las cambia (las decisiones sobreviven). Tratamiento: (1) la Matriz gana el chip «Cola larga decidida sobre la propuesta anterior» (filas con `disponibilidad_bajo_minimo` y `propuesta_cambio` cuyo origen no es «a mano»), con el exceso en unidades; (2) si en la proyección en trabajo esas filas tienen `decision_lote_id`, se devuelven a revisión con «Revertir» de 07g sobre esas filas (ya existe, sin migración); si son copiadas, se deciden una por una o las reescribe la aplicación de 07h; (3) la columna **Vector2 de la mesa** usa, para esas filas, la propuesta con tope en lugar del `decidido` heredado y lo dice (instr. §10.6), mostrando el «tal cual» en el detalle. `T0` mide cuántas hay en `e8d2acf8` y de qué clase.

**(b) Factor de verano del Niño.**
- El cálculo con 2 o más meses **ya existe**; el verano 2026 no tiene calculado porque solo septiembre está publicado. **Requisito operativo: publicar octubre de 2026 por M5** (con septiembre y octubre, `meses_periodo_con_dato = 2`).
- Avisos nuevos (en Factores del Niño, en la cabecera de Proyección y en las alertas de M14 si la proyección mostrada lo usa): `factor_aplicado_lejos` cuando hay calculado y aplicado y `|aplicado ÷ calculado − 1| > 0,15` (constante `UMBRAL_FACTOR_LEJOS`), y `factor_fijado_sin_calculo` cuando el aplicado se escribió sin calculado. **No bloquean**; cambiar el aplicado ya deja la proyección desactualizada por `factores_cambiados`.
- No cambia el método: no sube `VERSION_METODO` por sí sola.

Archivos: `cola-larga.ts`, `calculo.ts`, `reglas.ts`, `tipos-api.ts` (aviso, parámetro, `VERSION_METODO`), `src/lib/aprobacion/plan.ts` (exclusión), `factor-nino.ts` y la pestaña Factores (avisos), `matriz.ts` (chip). Pruebas: `tests/proyeccion.cola-larga.test.ts`, `tests/aprobacion.*`, `tests/proyeccion.factor-nino.test.ts`. Hito: §6.2 punto 1.

### 8.2 `0.20.0 · M7 j` (migración `0042`)

Todo §2 (incluidos los cambios aditivos de §2.2 y `aplicar_lote_plan_tienda`, probada solo por el humo), §3.1 a §3.4, §4.1 a §4.7 y §4.9, §5.1 a §5.5. Requiere `0.19.3` desplegada.

### 8.3 `0.20.1 · M7 j` (sin migración si la `0042` basta)

§3.5, §4.8, §5.6 y §5.7: servicio y rutas de aplicar y deshacer, exclusión de lotes `plan_tienda` en «Reaprobar» de 07g, «Plan por tienda» en M14 (`tablero_proyeccion` con `create or replace`: si no se adelantó en la `0042`, va en la **siguiente migración libre** y la etiqueta pasa a `0.21.0 · M7 j`, por la regla de versiones de `docs/PLAN.md` §5). **Depende de la corrección del invariante Σ meses de M7** (otra tarea): sin ella, `aplicarDecision` puede escribir meses que no cuadran en las filas escaladas y la función los rechazaría (`PT009`).

## 9. Plan por tandas (cada archivo con un solo dueño)

**T0 · Revisión y verificación** (antes de construir nada):
- `arquitecto-revisor` (opus) revisa esta ficha; el `arquitecto` ajusta.
- `datos` (solo `SELECT` en `vector-two`): R512 (apertura 2027-06-15, referencia R511) y R511 (2025-11-20) en `tiendas` y en `parametros.bloques` de `3dad947b` y `e8d2acf8` (R512 en `aperturas` de 2027, R511 en `nuevas_anterior` de 2026 y `mismas` de 2027); que no haya cierres en 2026 ni 2027; cuántas filas `revision_cola_larga` y con `dispon < 0,25` hay en `e8d2acf8`, por origen, lote y año, y su exceso; estado del factor de verano 2026; meses publicados; cuántas filas de `e8d2acf8` están fijadas a mano (los conflictos esperados).
- El coordinador consigue los insumos de §10.

**Entrega previa `0.19.3 · M7 i`:** `backend` (§8.1 y sus pruebas) → `frontend` (avisos, chip, parámetro en Nueva proyección) → `qa` → `seguridad` (corta: no hay rutas nuevas) → `documentador` (`docs/DECISIONES.md` 163, 07 «Cambios», 07g D1, checklist, `APP_VERSION = "0.19.3 · M7 i"`). Hito con Javier.

**`0.20.0 · M7 j`:**
- **T1 (en paralelo)** · `datos`: `0042_plan_por_tienda.sql`, `scripts/humo-0042.sql`, `database.types.ts`; puerta de medición de `plan_tienda_venta_motor` y `plan_tienda_vector2` (frío y caliente, anotada al pie como en la `0041`); aplica en `vector-two` con el MCP. · `backend`: `tipos-api.ts` y `esquemas.ts` (commit solo, desbloquea a `frontend`).
- **T2 (en paralelo)** · `backend`: `cubetas.ts`, `motor.ts` (primero, con el caso A y B), `laminas.ts`, `ajustes.ts`, `fuentes.ts`, `decisiones.ts`, `carga.ts`, `planner.ts`, `consultas.ts`, `servicio.ts`, rutas de §3.1, semáforo extraído a `src/lib/api/`, `409 tiene_plan_tienda` en el `DELETE` de M7; pruebas de su dueño. · `frontend`: `src/app/(app)/planificacion/plan-tienda/*`, lectores de la carga y del planner (en el navegador, con el lector compartido), `excel.ts`, item del menú; pruebas de su dueño.
- **T3** · `qa`: §6.1 A–D y F con la base falsa, casos borde, tamaños y tiempos en local; **comprobación de las cifras reales fuera del repo** (§6.3) cuando la base tenga la carga del 12-nov.
- **T4** · `seguridad` (sonnet, solo lectura): §6.4.
- **T5** · `documentador`: `CHANGELOG.md`, `docs/PLAN.md` (estado, registro de la `0042`, tablas de solo inserción, versión), `docs/DECISIONES.md` (§12), esta ficha («Construido»), checklist, `APP_VERSION = "0.20.0 · M7 j"`. Hito.

**`0.20.1 · M7 j`:** `backend` (`escritura.ts`, aplicar y deshacer, exclusión en 07g, caso E) y `datos` (`create or replace` de `tablero_proyeccion` si hace falta, en la siguiente libre) en paralelo; `frontend` (§4.8, clase «Plan por tienda» en M14 y `Badge` en Por línea); `qa`; `seguridad`; `documentador` (`APP_VERSION`). Hito.

## 10. Insumos: recibidos y pendientes

- **Recibido** (2026-11-21): las instrucciones de Javier (2026-11-16). Resolvieron fórmulas, tiendas, Benavides, planner, láminas iniciales, escritura y Excel.
- **Pendientes** (el coordinador los pide; no se inventan):
  - **`engine.py` y `build.py`** del prototipo. Confirman los supuestos marcados: el `peso` de la anualización (red del GML o de la temporada, §5.1.5), el encogimiento exacto de verano e invierno y de `corr_inv` (§5.1.5), el redondeo, qué cuenta como «filas sin stock» en la cabecera, el orden de la lista y cómo se arma «Otras». Sin ellos se construye con los supuestos y QA los contrasta con las cifras reales: si no cuadran ±0,5 %, se ajusta con `VERSION_MOTOR = 2`.
  - **Un ejemplo del Excel «Venta por tienda por año»** (puede ser con cifras alteradas): rótulos exactos de las columnas, cómo viene la columna del año en curso, nombres de tiendas, `CV Act`, filas de totales que haya que saltar. Bloquea el lector de la carga (T2 de `frontend`), no el resto.
  - **Los dos Excel del planner** (o copias con cifras alteradas): posición real del rótulo «Vta», nombres de pestañas, hojas que no son de línea además de «OTB - Unidades». Bloquea el lector del planner.
  - **El archivo de las láminas iniciales** (§5.3) en el formato de «Importar láminas»; lo prepara el coordinador con la lista de instr. §4.3, fuera del repo.

## 11. Preguntas abiertas para Javier (con el default que permite construir)

**Las cuatro de instr. §12, tal cual («no las supongas»):**
1. **¿Qué proyección recibe lo aprobado: la de seguimiento del 08/11 o una nueva con corte noviembre?** *Default para construir:* la versión elige su proyección destino entre las en trabajo (cualquiera de las dos sirve). *Recomendación:* una copia nueva de la cerrada, recalculada **con octubre publicado en M5 y el método 6**: llega sin la cola larga inflada y con menos conflictos que «seguimiento sep», que trae 304 filas de 2027 fijadas a mano. *Qué cambia:* solo la operación y cuántos conflictos aparecen al aplicar; el código es el mismo.
2. **¿Mínimo de disponibilidad para la corrección de cola larga: 25 % u otro?** *Default:* 25 %, parámetro de la proyección. *Qué cambia:* solo el valor por defecto (y cuántas filas quedan en revisión).
3. **¿El 2027 del planner incluye Benavides?** *Default:* `desconocido`: se compara con tiendas actuales y se avisa «no consta si trae Benavides». *Qué cambia:* con «sí», a su 2027 se le resta Benavides antes de compararlo; con «no», desaparece el aviso. Se marca por importación, sin tocar código.
4. **¿Quién más aprueba láminas además de Javier?** *Default:* solo el admin (`check (rol = 'admin')`). *Qué cambia:* si es un planner, se relaja el `check` y el guard (migración pequeña y decisión que matiza la 139); si es otra persona de dirección, un rol nuevo es un módulo de permisos aparte.

**Las que encontré al diseñar:**
5. **Nombre en pantalla de «Claudio».** *Default:* «Tiendas» como opción y «Proyección por tienda» como título; el Excel conserva `plan_claudio`. Alternativas: «Motor», «Ritmo por tienda», «Claudio».
6. **¿El planner puede aplicar lo aprobado a la proyección?** *Default:* sí, respetando lo fijado a mano; pisar, solo el admin. Alternativa: aplicar solo el admin.
7. **¿Octubre en M5 es requisito para crear la versión de trabajo?** *Default:* aviso, no bloqueo (la carga del 12-nov cubre octubre para el motor). Lo exige de hecho la corrección (b) del verano.
8. **`origen = 'plan_tienda'` o marca por el lote.** *Default:* `origen = 'manual'` + lote `plan_tienda` (C7). Pedir el origen nuevo obliga a una migración con `DROP CONSTRAINT` (excepción explícita a la regla de migraciones) y a revisar M7, 07e, 07g y M14.
9. **Reparto de tiendas actuales entre fila base y filas de R511.** *Default:* por bloque, con el detalle por tienda (lo de R511 a sus filas). Lectura literal de instr. §8.1: mezclar base y R511 y repartir todo por `propuesto`. Las dos cumplen instr. §10.5.
10. **Corrección de invierno del motor.** *Default:* la calcula el motor (≈ 0,68) y muestra la de M6 (≈ 0,70) al lado. Alternativa: usar la de M6 (cambia las láminas de invierno ≈ 3 %).
11. **Exclusión de 07g.** *Default:* ninguna fila `revision_cola_larga` se aprueba en bloque. Alternativa: solo las que quedan bajo el mínimo.
12. **¿Margen y costo visibles para el planner?** *Default:* sí (admin y planner).
13. **Géneros además de Hombre y Mujer.** *Default:* el catálogo y la mesa admiten todos; la lista muestra los que tengan láminas.

## 12. Propuestas para `docs/DECISIONES.md` (desde la 149)

> **Nota de versiones (coordinador, 2026-11-23).** La `0.19.2 · M7 h` la tomó una tanda de arreglos de pantalla de Proyección; por la regla de versiones las tres entregas de esta ficha quedan en `0.19.3 · M7 i` (correcciones previas), `0.20.0 · M7 j` (la mesa) y `0.20.1 · M7 j` (la escritura de vuelta).
>
> **Nota de numeración (coordinador, 2026-11-23).** La decisión 149 quedó tomada por el ajuste `0.19.1 · M7 g` (recálculo de las filas escaladas). Las propuestas de esta ficha conservan aquí su número de trabajo, pero al pasar a vigentes se registran **a partir de la 150**, en el mismo orden.

- **149 · El plan por tienda es una ficha de M7 (07h) y trabaja sobre una «versión» atada a una proyección en trabajo.** La cerrada solo se lee (columna de referencia); nunca recibe lo aprobado. *Descartado:* aprobar sobre la cerrada (no se podría escribir).
- **150 · La venta del mes en curso entra como carga parcial propia del módulo, por tienda × GML, con `hasta_fecha`, y queda superada sola cuando M5 publica el mes.** Nunca entra en `venta_stock_mensual`. `real(Y) = max(carga, Vector2 enero a k')`. *Descartado:* un mes parcial en M5 (contamina curvas, factores, proyección, flujo y tablero); calcular solo con meses cerrados (no reproduce el método de Javier).
- **151 · Motor en TypeScript puro, generalizado a año en curso y corte, con `VERSION_MOTOR`, `propuesto` inmutable y huella reproducible.** Los pesos del mes del corte salen de días del corte ÷ días del mes.
- **152 · Las tiendas se clasifican con los bloques de M7: antiguas (`M(Y)`), nuevas sin año comparable, aperturas y cierres aparte.** Benavides es aparte por ser apertura de 2027, no por su código; ningún total intermedio mezcla aperturas con tiendas actuales.
- **153 · La temporada de un GML para el motor es la de su equivalencia con más venta en los dos años anteriores**; la pantalla avisa si difiere de la de M7.
- **154 · La corrección de invierno la calcula el motor (ritmo de red de invierno ÷ todo el año, enero al corte), con la de M6 a la vista.**
- **155 · Láminas en un catálogo global editable con `slug` estable, un GML en a lo sumo una lámina y «Otras líneas menores» implícita por género;** los grupos iniciales se cargan como datos. *Descartado:* semilla en la migración (el repo no la usa) o láminas por versión.
- **156 · El plan del planner se lee de la fila «Vta» de cada pestaña de línea, buscada por rótulo, con rangos relativos a enero de 2022; nunca de «OTB - Unidades»;** el cuadre con Vector2 avisa y no bloquea; `incluye_aperturas` empieza en «desconocido».
- **157 · La escritura de vuelta es un lote de 07g de tipo `plan_tienda` escrito por una función hermana; las filas llevan `origen = 'manual'` y `decision_lote_id`.** «Reaprobar» y «Revertir» de 07g excluyen esos lotes; M14 los clasifica como «Plan por tienda». *Descartado:* `origen = 'plan_tienda'` (exige `DROP CONSTRAINT` y tocar cuatro módulos) y reutilizar `aplicar_lote_proyeccion` (su `aprobar` solo escribe filas sin decidir).
- **158 · Al aplicar, lo fijado a mano se lista y se pide confirmación; pisarlo exige admin.** Matiza la 82 D2 solo para este acto explícito.
- **159 · El reparto va por GML y bloque de tiendas, en proporción al `propuesto` (luego `vendido`, luego la venta del año anterior), con mayor resto y piso de lo vendido; el total de una tienda nueva o apertura se mueve con `max(D + Δ, Σ fijadas)` (07b), no con la regla 23.** Los meses los reparte M7 (`aplicarDecision`) y se comprueba `Σ meses = vigente`.
- **160 · El detalle por tienda aprobado se guarda pero todavía no alimenta 07f, la atribución de M14 ni el flujo de M8.** La 111 no cambia.
- **161 · La mesa muestra el margen (costo ÷ venta) a admin y planner.** Matiza que M14 no lea costo, solo para esta pantalla.
- **162 · Sin tiempo real: sondeo ligero y versión vista en cada escritura.**
- **163 · Correcciones de M7 previas al plan por tienda** (`0.19.3 · M7 i`): sin corrección por disponibilidad bajo un mínimo (25 %, parámetro), ninguna fila `revision_cola_larga` en lotes de 07g, `VERSION_METODO = 6`; avisos cuando el factor del Niño aplicado se aparta del calculado o se fijó sin cálculo; octubre en M5 como requisito operativo del factor de verano. Matiza 07g D1. La cerrada no se toca.
- **164 · Versiones y migración:** `0.19.3 · M7 i` (correcciones previas, sin migración), `0.20.0 · M7 j` (`0042_plan_por_tienda.sql`, con los objetos de la escritura) y `0.20.1 · M7 j` (sin migración; si la necesita, siguiente libre y `0.21.0 · M7 j`). Las letras siguen la serie de entregas de M7: la corrección del invariante Σ meses que otra tarea tiene en el árbol de trabajo ya usa `0.19.1 · M7 g` (sin commit al escribir esta ficha; además ocupa el parche `0.19.1` que `docs/PLAN.md` reservaba para la segunda entrega opcional de M14, que el `documentador` debe mover). Si el orden de cierre cambia, cada entrega toma el parche o la menor siguiente libre y la letra siguiente al cerrar.
