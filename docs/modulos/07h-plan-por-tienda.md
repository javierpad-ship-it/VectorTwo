# 07h · Plan por tienda y mesa de decisión por GML (proyección por tienda, Vector2 y planner lado a lado; aprobación por lámina; escritura de vuelta a la proyección)

> **Estado: especificación revisada el 2026-11-24** (revisión independiente del `arquitecto-revisor` y mediciones del coordinador en la base, §13); **decisiones de Javier recibidas el 2026-11-24 (§11); lista para construir la `0.20.0 · M7 i`.** Sin construir. Ficha de la familia de M7. Base: rama `claude/epic-faraday-40fzee`, commit `84f4cf3`, versión vigente **`0.19.2 · M7 h`**. **Fuente principal:** el documento de Javier «Vector2 · Plan por tienda y mesa de decisión por GML» (2026-11-16, recibido el 2026-11-21; en esta ficha, «las instrucciones», citadas por su número de sección, p. ej. «instr. §5»). Fuente secundaria: el primer pedido del 2026-11-21 (prototipo «Mesa de decisión GML 2027»); donde difieren, mandan las instrucciones. **Tres entregas** (§8): **`0.20.0 · M7 i`** (las correcciones previas de M7 de instr. §3 más devolver a la propuesta la cola larga heredada; migración, la siguiente libre al construir: hoy `0042_devolver_cola_larga.sql`), **`0.21.0 · M7 j`** (carga parcial, motor, láminas, planner, mesa con ajustes y aprobación, Excel; migración siguiente libre, hoy **`0043_plan_por_tienda.sql`**, que trae también los objetos de la escritura) y **`0.21.1 · M7 j`** (escritura de vuelta y sus efectos en 07g y M14; sin migración; si la necesitara, la siguiente libre y `0.22.0 · M7 j`). Commits `M7: ...`. Depende de [07](07-proyeccion-anual.md) (bloques `M(Z)`, `N(Z)`, `C(Z)`; filas base y de tienda; regla 23; `aplicarDecision`; cola larga; cierre; invariante Σ meses de la decisión 149), [07b](07b-apertura-en-la-linea.md) (fijar una fila de tienda mueve el total a `max(D + Δ, Σ fijadas)`), [07f](07f-venta-por-tienda-en-crecimientos.md) (decisión 111, sin cambios), [07g](07g-aprobacion-en-bloque.md) (lotes `proyeccion_lotes` / `proyeccion_lote_filas`; decisión 82), [06e](06e-cierre-del-anio-y-base-sin-nino.md) (factores del Niño), [M4](04-tiendas.md), [M5](05-venta-stock.md), 02b y [M14](14-dashboard-aprobacion-direccion.md). **Todas las cifras de esta ficha son sintéticas**; las de instr. §5.5 y §10 y las mediciones del 2026-11-24 son reales y no entran al repositorio (§6.3).

**Lo que pide Javier (instr. §0 y §1):** planificar el cierre del año en curso y el año siguiente **tienda por tienda y GML por GML**. Para cada **lámina** (un GML o un grupo de GML que el planner trabaja junto) ver lado a lado tres cifras —**la proyección por tienda** (un motor de ritmo; el prototipo la llama «Claudio»), **la proyección actual de Vector2** y **la del planner** (Luis)—, corregir a mano cualquier tienda, con **Benavides (R512) siempre aparte** («tiendas actuales» y «aperturas» se guardan y suman por separado: primero tiendas actuales, después Benavides y al final el total), **aprobar la lámina** eligiendo la fuente de cada año y dejando una nota, y que lo aprobado **vuelva a la proyección de Vector2** (filas decididas) y de ahí al flujo y las compras (M8). Exportar el Excel `plan_claudio`.

## 1. Objetivo

Hoy el volumen de 2027 se decide cruzando a mano tres números de tres sitios: la proyección de Vector2 (por GML × agrupación de marca, sin detalle por tienda en las tiendas existentes), el Excel del planner (por línea y con sus propias agrupaciones de marca) y una lectura de ritmo por tienda que nadie guarda. 07h pone las tres en **una pantalla por lámina** con el detalle por tienda de un **motor reproducible dentro de Vector2** (instr. §5), deja a Javier ajustar tiendas y aprobar la lámina con la fuente elegida, guarda cada aprobación como fila nueva (la vigente es la última) y **escribe lo aprobado en la proyección en trabajo como un lote auditable de 07g**, nunca en la cerrada. Antes, una entrega corta corrige los defectos de M7 que inflan la columna Vector2 (instr. §3) y devuelve a la propuesta la cola larga que quedó decidida sobre la cifra inflada (§8.1).

### 1.1 Decisiones de diseño (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Una «versión del plan por tienda»** (`plan_tienda_versiones`) = una corrida del motor con su corte y sus parámetros, **atada a la proyección en trabajo que recibirá lo aprobado** (instr. §7). Ajustes, decisiones y escrituras cuelgan de la versión. Una cerrada o archivada solo se abre como **referencia de lectura** (columna Vector2), nunca como destino. | Instr. §8 e §11: la cerrada es inmutable. Atar la versión al destino evita aprobar algo que no se puede escribir. **Destino decidido por Javier (2026-11-24, §11): la proyección en trabajo «seguimiento sep»**, recalculada con el método 6, no una copia nueva (§8.4). El sistema sigue dejando elegir cualquiera en trabajo. |
| D2 | **Venta del mes en curso: carga parcial propia del módulo**, por tienda × GML, con `hasta_fecha`, marcada parcial y **superada sola** cuando M5 publica el mes cerrado (instr. §4.1). **Nunca** entra en `venta_stock_mensual` ni en `venta_stock_vigente`. §5.4. | M5 carga meses cerrados por equivalencia × marca × talla y de ahí leen curvas (M6), factores del Niño (06e), proyección (M7), flujo (M8) y el tablero (M14): un mes a medias ahí los contaminaría a todos. El Excel llega por género × mundo × línea × tienda: su grano natural es GML. |
| D3 | **Motor en TypeScript puro** (`src/lib/plan-tienda/motor.ts`, `VERSION_MOTOR = 1`) con las fórmulas de instr. §5 **generalizadas** a año en curso `Y` y corte `d` (los 0,40 y 0,60 salen de `día(d) ÷ días del mes`), alimentado por una función SQL de agregados (`plan_tienda_venta_motor`, como `tablero_venta`). Los resultados quedan en `plan_tienda_valores` (instr. §7) con su `propuesto` inmutable. | Las ramas (temporada, anualización, tienda nueva, Benavides) se prueban mejor en vitest; los agregados en SQL evitan traer 100 mil tuplas. |
| D4 | **Las tiendas se clasifican con los bloques de M7**, no con códigos: «antiguas» = `M(Y)` (2025 completo, instr. §5); «nueva sin año comparable» = actual sin estar en `M(Y)` (hoy R511); **«aperturas» = `N(Z).aperturas`** (hoy R512 en 2027), siempre aparte; los cierres de `Z` también aparte. §5.1.3. | Es exactamente la frontera entre fila base y fila de tienda de la proyección, por donde pasa la escritura; evita el doble conteo y deja la próxima apertura aparte sin tocar código (instr. §1: «poder mover Benavides después sin tocar el resto»). |
| D5 | **Láminas en un catálogo global editable** (`plan_tienda_laminas` + `plan_tienda_lamina_gml`) con `slug` estable; un GML en a lo sumo una lámina; **«Otras líneas menores» por género implícita**; los grupos iniciales de instr. §4.3 se cargan **como datos** (importador de láminas), no como código ni como semilla de la migración. | Un GML nuevo nunca queda fuera. Las migraciones del repo no llevan seed y los nombres de líneas son datos del negocio. |
| D6 | **Ajustes en `plan_tienda_valores.ajustado`** (por GML × tienda × año, con quién y cuándo), con un historial de solo inserción; un ajuste por tienda **a nivel lámina se reparte entre sus GML en proporción a su `propuesto`** (instr. §7, mayor resto). **Decisiones en `plan_tienda_decisiones`, de solo inserción**, una fila por lámina × año y acto; la vigente es la última. | Instr. §7. El reparto proporcional es lo único que deja escribir después por GML sin inventar una mezcla. |
| D7 | **Ajustan, aprueban y retiran láminas el admin y el planner** (Javier, 2026-11-24, §11). **Aplican** lo aprobado el admin y el planner; **pisar lo fijado a mano, solo el admin** (D10). | Matiza la decisión 139 (M14) solo para las láminas: la 139 es la **aprobación de dirección de la proyección entera**, que sigue siendo solo del admin (M14 no cambia). Cada aprobación guarda quién y con qué rol (`plan_tienda_decisiones.rol`). |
| D8 | **La escritura de vuelta es un lote de 07g** (`proyeccion_lotes` de tipo **`plan_tienda`**, una línea por registro en `proyeccion_lote_filas`, instr. §8.3), escrito por una **función hermana** `aplicar_lote_plan_tienda` (mismo candado, dos pasadas, `updated_at`, idempotencia y conteos reales que `aplicar_lote_proyeccion`, que **no se toca**), con la lógica de M7 (`aplicarDecision`, `moverTotalTienda`, `repartirEntero`) y **sin reimplementar el reparto mensual**. Las filas escritas llevan **`origen = 'manual'` y `decision_lote_id`** del lote; **no** `origen = 'plan_tienda'` (§1.2 C7). | Reutiliza la auditoría que ya existe (pedido de Javier) y su «deshacer». La función de 07g solo escribe filas sin decidir (`ya_decidida`); la mesa escribe filas decididas con confirmación, así que necesita su propia condición sin alterar el contrato de 07g. |
| D9 | **Reparto de lo aprobado** (instr. §8.1): por GML (del detalle por tienda), por **bloque de tiendas** (lo de `M(Z)` a las filas base, lo de R511 en 2026 a sus filas `nuevas_anterior`, lo de R512 a sus filas `aperturas`) y dentro de cada bloque **en proporción al `propuesto`** del año (si es 0, `vendido`; si también, la venta de `Y−1` de la fila), con **mayor resto** y **piso de lo vendido en `Y`** (regla de M7). §5.6. | Instr. §8 y regla 41 de M7 (`menor_que_vendido`). |
| D10 | **Conflictos con lo fijado a mano: se listan y se pide confirmación** (instr. §8.6): por lámina, «pisar lo fijado a mano» o «respetarlo (el resto de la lámina absorbe la diferencia)»; sin elección, `409 conflictos_sin_resolver`. Pisar exige admin. | Instr. §8.6. Matiza la decisión 82 D2 (ningún lote toca lo decidido a mano) para este acto explícito y confirmado. |
| D11 | **El detalle por tienda aprobado se guarda** (`plan_tienda_valores`, instr. §8.4) **pero no alimenta todavía** «Ver por tienda» de 07f, la atribución de M14 ni el flujo por tienda de M8. | Decisión 111 sin cambios; el flujo de M8 es a nivel red. Queda previsto (instr. §8.4). |
| D12 | **«Recalcular el flujo» (instr. §8.5) se interpreta como mostrar el antes y el después de la proyección** por GML y en total (tiendas y Benavides por separado). **M8 solo lee la cerrada**: el flujo cambia cuando la proyección en trabajo se cierra con el cierre normal. §1.2 C9. | Contrato de M8 (07 §7, decisión 138). |
| D13 | **Sin tiempo real**: refresco al volver a la pestaña; toda escritura lleva la versión vista y responde `409` si otra persona guardó antes. El sondeo cada 60 s queda para después (§7.1). | El repo no usa canales en vivo; el `409` ya evita pisar el trabajo de otro. |
| D14 | **Kit de Vector2**, no la marca del prototipo; usable en 390 px. | Coherencia. |
| D15 | **Nombre de pantalla del motor: «Por tienda»** (opción «Tiendas» de las instrucciones, título «Proyección por tienda»); en código, `motor`. El planner se rotula «Planner» con el nombre de quien subió el archivo. El Excel conserva `plan_claudio` (instr. §9). | Default de la pregunta 9, sin respuesta de Javier (§11): se construye así. |
| D16 | **La columna «Vector2» es siempre lo vigente real** de la proyección destino (lo que quedaría escrito con esa fuente); la cola larga inflada que aún tenga se **avisa** (`cola_larga_vector2`), no se sustituye por otra cifra. | Revisión H1: aprobar «Vector2» con una cifra y escribir otra rompería el cuadre (R24). |

### 1.2 Dónde chocan las instrucciones con lo que ya hay

| # | Las instrucciones dicen | Vector2 tiene hoy | Resolución |
|---|---|---|---|
| C1 | Venta del mes en curso hasta un día (instr. §4.1) | Solo meses cerrados (M5); lo último publicado es **septiembre de 2026**; octubre **no** está cargado | Carga parcial propia (D2, §5.4). El Excel cubre octubre y noviembre para el motor, pero **octubre debe cargarse por M5** para la corrección (b) de M7 y para la columna Vector2 (§5.4, §8.1) |
| C2 | Editar y escribir por tienda | Las tiendas existentes no tienen filas en la proyección | Escritura por bloque (D9); detalle por tienda guardado en la mesa (D11) |
| C3 | «Tiendas actuales» = filas `mismas` + `nuevas_anterior` de R511 | Para 2026, R511 es `N(2026).nuevas_anterior` (filas de tienda); para **2027**, R511 está en `M(2027)` (fila base) | En 2026 lo de R511 va a sus filas de tienda; en 2027, a la fila base con las demás (§5.6) |
| C4 | Benavides: `proyeccion_tiendas.decidido` de R512 para 2027 | Regla 23: decidir el total de una tienda **reescala todas sus filas no fijadas**, de todos los GML | Se fijan las filas de la lámina y el total se mueve a `max(D + Δ, Σ fijadas)` (07b): las filas de R512 de otras láminas no cambian (§5.6 paso 4) |
| C5 | Pisar decisiones manuales solo con aviso y confirmación | Decisión 82 D2: ningún lote toca lo decidido a mano | D10, decisión propuesta 159 |
| C6 | Lote de tipo `aprobar` | `aplicar_lote_proyeccion` con `aprobar` solo escribe filas **sin decidir**; «Reaprobar» de 07g reescribe toda fila con `decision_lote_id` cuyo valor de hoy difiere | Tipo propio `plan_tienda` y función hermana (D8); «Reaprobar» y «Revertir» de 07g excluyen los lotes `plan_tienda` (§5.7) |
| C7 | `origen = 'plan_tienda'` | `check (origen in ('propuesta','manual','escalada'))`; cambiar un `check` exige `DROP CONSTRAINT`, que las migraciones del repo prohíben, y M7, 07e, 07g y M14 razonan sobre esos tres valores | `origen = 'manual'` + `decision_lote_id` → lote `plan_tienda`; M14 distingue la clase por el tipo del lote (decisión propuesta 158) |
| C8 | «Escalar `meses[]` de cada fila conservando la curva» | El reparto mensual es de M7 (`repartirEntero` con la curva, reales hasta `k`); el invariante «Σ meses = total vigente» ya lo garantiza el recálculo y lo exige el cierre (`0.19.1 · M7 g`, decisión 149; la cerrada guardada antes sigue descuadrada y **no se repara por SQL**: Javier decidió el 2026-11-24 que queda reemplazada cuando se cierre «seguimiento sep», §8.4) | Se usa `aplicarDecision`/`moverTotalTienda`; la función comprueba Σ meses = vigente en cada registro escrito (R31) como defensa |
| C9 | «Recalcular el flujo (`huella_flujo`)» | M8 lee solo la cerrada | D12 |
| C10 | Correcciones de M7 (instr. §3): «dejar que el factor se calcule con 2 o más meses» | **`MIN_MESES_FACTOR = 2` ya está** (`tipos-api.ts:66`); el verano 2026 quedó sin calcular porque **solo septiembre** está publicado y se fijó 1,00 a mano; al publicar octubre el factor pasa solo a `desfasado` y luego a `sin_confirmar`, que bloquean | Publicar octubre por M5, pulsar «Sincronizar», confirmar con el aviso `factor_aplicado_lejos` a la vista (§8.1 e) |
| C11 | Cola larga: «no corregir por disponibilidad bajo un mínimo» y «que no se aprueben en bloque» | `A_f` (anual, de año normal) no tiene tope y se mete entera en los meses que faltan del año (`cola-larga.ts:174`); el universo de 07g incluye `revision_cola_larga` (07g D1); las decisiones tomadas sobre la cifra inflada sobreviven al recálculo | §8.1: corrección solo al resto del año, con mínimo y **sin techo** (Javier, 2026-11-24), devolver lo heredado, exclusión en 07g; `VERSION_METODO` a 6 |
| C12 | Corrección de invierno «hoy 0,68 (Vector2 tiene 0,70)» | El factor oficial vive en `factores_volumen_atipico` | El motor calcula la suya (instr. §5.4) y la muestra junto a la de M6 (§5.1.5) |
| C13 | Temporada del GML | M7 etiqueta cada fila con la agrupación dominante por `W12` | El motor usa la regla del primer pedido (equivalencia con más venta 2024–2025) y la mesa avisa si difiere de M7 (§5.1.2) |
| C14 | Láminas por GML | M7 decide por GML × agrupación de marca (y por equivalencia en nodos GMLE) | La escritura reparte entre todas las filas de los GML de la lámina; la AM no es dimensión de la mesa |
| C15 | Margen 2026 (costo ÷ venta) | M14 no lee `costo_vendido` por diseño | La mesa sí, solo admin y planner (decisión 162; default de la pregunta 8, sin respuesta) |
| C16 | `plan_tienda_versiones.estado` (borrador / aprobada / aplicada) | Los estados del repo se derivan al leer cuando dependen de otras filas | Se deriva (§5.2); no hay columna que se desincronice |
| C17 | Cifras reales en la aceptación | Nada de datos reales en el repo | Caso sintético (§6.1); cifras reales en QA y en el hito, fuera del repo (§6.3) |

## 2. Modelo de datos (la migración de la mesa: la siguiente libre al construir, hoy `supabase/migrations/0043_plan_por_tienda.sql`)

> La entrega previa trae su propia migración (hoy `0042_devolver_cola_larga.sql`, §8.1 b) con `proyeccion_lote_filas.anterior`, `proyeccion_lotes.deshace_lote_id` y la función `devolver_cola_larga`; esta sección los cita en §2.2 pero no los repite. Los números son «la siguiente libre al construir»: `docs/PLAN.md` deja también la siguiente libre a 08b-2 y 08c E2 por orden de cierre.

Convenciones de `docs/PLAN.md` §3 y de `0013` a `0041`: idempotente (`create table if not exists`, `add column if not exists`, `create or replace function`, `create index if not exists`, `create or replace trigger`), **sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`**, sin `do $$`, sin backfill ni seed, cuerpos de función sin `--`, identificadores ≤ 63. Tablas editables: `id uuid`, `activo`, `created_at`, `updated_at` (`tg_set_updated_at`), RLS activo **sin políticas**, `revoke all … from public, anon, authenticated` y `grant select, insert, update` a `service_role` (sin `delete`, `truncate`, `trigger`, `references`; regla de la `0035`). **Tablas de solo inserción** (`plan_tienda_carga_filas`, `plan_tienda_ajustes`, `plan_tienda_decisiones`, `planner_valores`): sin `activo` ni `updated_at` (excepción documentada como 07g y M14), trigger de inmutabilidad (solo admite poner en `null` una FK `on delete set null`; también contra `truncate`), `revoke all … from public, anon, authenticated, service_role` y `grant select, insert` a `service_role`; entran en la lista de tablas de solo inserción de `docs/PLAN.md`. Funciones `security invoker`, `set search_path = ''`, todo calificado, `execute` solo para `service_role`, `comment on`; listas de ids dentro del `jsonb`, sin SQL dinámico. Al final, `insert into public.migraciones_aplicadas (nombre, nota) values ('0043_plan_por_tienda', '…') on conflict (nombre) do nothing`. Se aplica con el MCP **en `vector-two`, nunca en `lukers-compras`**, tras el humo dos veces en local.

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

**Columnas del motor inmutables** (H16): trigger `tg_plan_tienda_valores_motor_inmutable` (`before update`) que rechaza, también para `service_role`, cualquier cambio en columnas distintas de `ajustado`, `ajustado_por`, `ajustado_por_nombre`, `ajustado_at`, `nota` y `updated_at`; `delete` y `truncate` revocados. Sin `id` ni `activo` (PK compuesta; filas de una versión). ≈ 600 GML × 12 tiendas × 2 años ≈ 14 000 filas por versión (solo combinaciones con venta en `Y−3 … Y` o con filas de apertura en la proyección). **R512 vive aquí como cualquier tienda** (instr. §7) con `tratamiento = 'apertura'`, y **toda suma la separa** por el tratamiento, no por el código. `ajustado` solo cambia por la función `ajustar_plan_tienda` (§2.3 d), que deja una fila por celda en `plan_tienda_ajustes` (`version_id`, `lamina_id`, `tienda_id`, `anio`, `valor_lamina_antes`, `valor_lamina_despues` —nulo = vuelve a la propuesta—, `reparto jsonb` por GML, **`origen`** (`'celda' | 'traido'`: «traer ajustes de» otra versión deja una fila por celda copiada con `origen = 'traido'` y **`traido_de_version_id`**; quien copia es el `perfil_id` de la fila, no se hereda el `ajustado_por` de la versión de origen, H16), `perfil_id`, `usuario_nombre`, `created_at`). En `plan_tienda_valores`, una celda traída lleva `ajustado_por` = quien la trajo.

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
| `fuentes` | `jsonb` | no | foto de las cuatro cifras del año al decidir (tiendas con y sin ajustes, Vector2 por bloque y aperturas, planner con su importación, manual), **totales del destino por GML y bloque** y **`huella_detalle`** (sha-256 canónico del detalle final GML × tienda que se escribirá, §5.6 paso 1). **El detalle no se copia aquí** (en «Otras» serían miles de entradas, H7): se recalcula al aplicar desde `plan_tienda_valores` y la cifra aprobada, y si su huella difiere la lámina es `aprobada_con_cambios`. `check (pg_column_size(fuentes) <= 65536)` |
| `nota` | `text` | sí | ≤ 1 000; obligatoria (≥ 10) con `manual` o `retiro` |
| `aprobado_por` (`→ perfiles set null`, índice), `aprobado_por_nombre`, `rol` | | | `check (rol in ('admin','planner'))` (D7: aprueban y retiran el admin y el planner; el comprador nunca) |
| `aprobado_at` | `timestamptz not null default now()` | no | |

`tipo = 'aprobacion'` ⇒ fuente y los tres valores no nulos; `retiro` ⇒ nulos. Índice `(version_id, lamina_id, anio, secuencia desc)`.

#### f) Planner: `planner_importaciones`, `planner_valores` (solo inserción) y `planner_mapeos`

- `planner_importaciones`: `id`, `anio`, `genero_id`, `archivo_nombre`, `huella_archivo`, `fecha_archivo` (la que declara quien sube: 08/10, 07/10; decide qué meses del archivo son reales para el cuadre, §5.5), **`primer_mes`** (`date`, el mes de la primera columna de meses **leído de la fila de cabecera** del archivo, no supuesto, H15), **`incluye_aperturas`** (`'si' | 'no' | 'desconocido'`, por defecto `'desconocido'`: default de la pregunta 7, sin respuesta, §11), `control jsonb` (cuadre de 2025 y ene–`k'` con Vector2 por lámina y género, §5.5), `perfil_id`, `usuario_nombre` (**subido_por**), `activo` (con uso), timestamps. La vigente de un género es la activa más reciente.
- `planner_valores`: `id`, `importacion_id` (`restrict`), `lamina_id` (`restrict`), `pestanas text[]` (las pestañas sumadas), `real_2025`, `real_ytd` (ene–sep), `cierre_2026`, `proy_2027` (`integer null ≥ 0`), `created_at`; único `(importacion_id, lamina_id)`.
- `planner_mapeos` (editable): `genero_id`, `pestana` (normalizada, 1–120), `lamina_id` (`cascade`) o `ignorar boolean`, `perfil_id`, `usuario_nombre`, timestamps; único `(genero_id, pestana)`. Recuerda «esta pestaña es esta lámina» (patrón de `mapeos_combinacion`).

### 2.2 Cambios en tablas existentes (aditivos)

**Ya en la migración de la entrega previa** (§8.1 b; la escritura los reutiliza):
- **`proyeccion_lote_filas.anterior`** `jsonb null`: foto de las columnas de decisión del registro antes de escribir (`decidido`, `origen`, `nota`, `propuesta_al_decidir`, `decidido_por_id`, `decidido_por_nombre`, `decidido_at`, `decision_lote_id`, `decision_ia_fila_id`; en una línea de total de tienda, la decisión de `proyeccion_tiendas` y **`delta_por_gml`**: `{ gml_id: Δ }` de lo que este lote movió ese total por cada GML, para deshacer en parte, H6). Con ella «deshacer» restaura lo que había, no la propuesta.
- **`proyeccion_lotes.deshace_lote_id`** `uuid null → proyeccion_lotes(id) on delete restrict`, índice; `check (deshace_lote_id is null or tipo like 'revertir\_%')`. Lo llevan `revertir_cola_larga` y `revertir_plan_tienda`; las funciones exigen además la otra dirección (ese tipo ⇒ no nulo). **No se toca** el `check` de la `0031` que ata `revierte_lote_id` a `tipo = 'revertir'` (H5): cambiarlo exigiría `DROP CONSTRAINT`.

**En la migración de la mesa** (los usa `0.21.1`):
- **`proyeccion_lotes.plan_tienda_version_id`** `uuid null → plan_tienda_versiones(id) on delete restrict`, índice parcial; `check (plan_tienda_version_id is null or tipo in ('plan_tienda','revertir_plan_tienda'))`. El `tipo` del lote sigue siendo catálogo de zod (sin `check`, 07g §2.0): se añaden `plan_tienda` y `revertir_plan_tienda` (y, desde la entrega previa, `devolver_cola_larga` y `revertir_cola_larga`).
- **`proyeccion_lote_filas.objetivo`** `text null` (`'fila_anio' | 'tienda'`, zod) y **`tienda_id`** `uuid null → tiendas restrict`: una línea por cada total de tienda movido (R512, R511), además de las de filas. Como `fila_clave` y `gm_clave` son obligatorias y únicas por `(lote, fila_clave, anio)` (`0031`), la línea de un total usa **claves sintéticas**: `fila_clave = 'tienda:<codigo>'` y `gm_clave = 'tienda'` (H5).
- `fuente` de `proyeccion_lote_filas` (zod) gana `plan_tienda`.
- **`resumen` de un lote `plan_tienda`** con la forma de 07g más claves propias: `{ pedidas, aplicadas, rechazadas: { codigo: n }, por_fuente: { ia: {0,0}, metodo: {0,0}, plan_tienda: { filas, unidades } }, plan_tienda: { laminas_aplicadas, laminas_rechazadas: { codigo: n }, gml_aplicados, por_clase_anterior: { clase: { filas, unidades } }, conflictos: { pisados, respetados }, totales_tienda: n } }`: la pestaña Aprobación lo lee sin otra rama y 07h usa `plan_tienda`.
- **Año del lote:** `anio = Y` (la columna es obligatoria y el lote cubre `Y` e `Y+1`); la lista de lotes de la pestaña Aprobación, que filtra por año, muestra **también en `Y+1`** los lotes `plan_tienda` y `revertir_plan_tienda` cuyo `anio = Y` (cambio de una línea en la consulta de 07g).
- **`tablero_proyeccion`** (`create or replace`, M14): clasifica «lote `plan_tienda`» antes que «lote» de 07g (§5.7).

Son columnas nulas en tablas de solo inserción: los lotes anteriores quedan iguales y el trigger de inmutabilidad no cambia. **Ningún `check` existente cambia** (en particular el de `origen`, C7, y el de `revierte_lote_id`).

### 2.3 Funciones

| Función | Tipo | Qué hace |
|---|---|---|
| `plan_tienda_venta_motor(p jsonb)` | `sql stable`, `work_mem = '16MB'` | Recibe `{ anio, k, cubetas: [{ c, desde, hasta }] }` (≤ 16 rangos de meses; hoy 12, §5.1.1) y devuelve, de `venta_stock_vigente` **solo de tiendas tipo Tienda** (el CD nunca entra) unida a `equivalencias` → nodo: `cargas` (periodo → carga, para la huella), unidades por tienda × GML × cubeta, soles y costo de `Y` de enero a `k`, stock de tiendas en `k` y la temporada del GML (§5.1.2) con su `pct_minoritaria`. Nunca `stock_valorizado`. ≈ 7 000 combinaciones × 12 cubetas ≤ 700 KB, ≤ 3 s en frío |
| `plan_tienda_vector2(p_proyeccion_id uuid, p_gml_ids uuid[] default null)` | `sql stable` | Por GML: `Σ vigente`, `Σ propuesto` y `Σ vendido` de `Y` y `Y+1` de filas activas, partidos en base (`tienda_id` nulo) y por tienda (`[tienda_id, bloque, subbloque, …]`), filas de cola larga bajo el mínimo (§4.6) y conteos por clase de decisión (manual a mano, propuesta, lote de 07g, lote `plan_tienda`, IA, escalada, sin decidir); más `calculado_at` y `parametros.bloques` en la misma sentencia. ≤ 150 KB, ≤ 300 ms |
| `plan_tienda_resumen(p_version_id uuid)` | `sql stable` | Agregados de la mesa en una sentencia (H17): por lámina (con «Otras» implícita) × año × tratamiento, `Σ propuesto`, `Σ final`, número de celdas ajustadas y `max(updated_at)`; evita traer ≈ 14 000 `plan_tienda_valores` en páginas de 1 000. ≤ 100 KB, ≤ 300 ms. La usa `GET …/mesa`; el detalle de una lámina sí lee sus filas |
| `guardar_carga_plan_tienda(p jsonb)` | `plpgsql` | Cabecera y filas en una transacción; `carga_repetida`, `fecha_invalida` en el `jsonb` (sin `raise`, patrón M14) |
| `guardar_version_plan_tienda(p jsonb)` | `plpgsql` | Inserta la versión y sus `plan_tienda_valores` (≤ 16 000 filas, `jsonb_to_recordset`); misma `huella` y proyección en los últimos 10 min → devuelve la existente (`repetida`). ≤ 2 s |
| `ajustar_plan_tienda(p jsonb)` | `plpgsql` | `{ version_id, lamina_id, version_vista, celdas: [{ tienda_id, anio, valor | null, reparto: [{ gml_id, valor }] }] }`: candado de aviso por `(version, lámina)`; comprueba que la `version_vista` (= nº de filas de `plan_tienda_ajustes` de la lámina) sea la actual (`lamina_cambio`); escribe `ajustado`, quién y cuándo en cada GML y una fila de historial por celda. El reparto por GML lo calcula TypeScript (§5.2) y la función comprueba que sume el valor |
| `registrar_decision_plan_tienda(p jsonb)` | `plpgsql` | `for share` de la versión y de su proyección (debe seguir en trabajo: `proyeccion_no_editable`); candado de aviso por `(version, lámina)`; `secuencia_vista` distinta → `lamina_cambio`; inserta las dos filas del acto. Única escritura de `plan_tienda_decisiones` (prueba estática) |
| `aplicar_lote_plan_tienda(p jsonb)` | `plpgsql` (la usa `0.21.1`) | §5.6 paso 6; escribe tipos `plan_tienda` y `revertir_plan_tienda`. Códigos `PT001`–`PT010`, como los `LP` de 07g |

### 2.4 Rendimiento

| Operación | Presupuesto |
|---|---|
| Crear una versión (agregados + motor + guardar) | ≤ 3 s SQL + ≤ 300 ms TS + ≤ 2 s guardar = **≤ 6 s**, ninguna sentencia cerca de 8 s |
| `GET` de la mesa (lista y KPIs) | ≤ 1,5 s en frío, ≤ 300 ms con caché (versión inmutable salvo `ajustado`; Vector2 por `calculado_at` y `max(updated_at)`) |
| `GET` de una lámina | ≤ 800 ms, ≤ 60 KB |
| Guardar ajustes o aprobar | ≤ 1 s |
| Vista previa de la carga parcial (24 000 filas) | ≤ 4 s, cuerpo ≤ 2 MB (`MAX_BYTES_CUERPO` = 6 MB) |
| Escribir (0.21.1) | ≤ 300 registros escritos por petición (D17 de 07g), ≤ 4 s cada una, en tandas del mismo acto (`confirmacion_id`) que **no parten un GML** (los dos años, sus registros de B2 y sus totales de tienda); una lámina grande («Otras» de un género reúne decenas de GML y cientos de filas por año) va en varias tandas (H7, §5.6) |

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
0.21.1: decisiones vigentes ─► plan (aplicarDecision · moverTotalTienda · repartirEntero de M7) ─► aplicar_lote_plan_tienda
   ─► proyeccion_fila_anios (origen manual + decision_lote_id) · proyeccion_tiendas (R512, R511) · proyeccion_lotes (tipo plan_tienda) + proyeccion_lote_filas (anterior)
   ─► cerrar (M7, sin cambios) ─► M8 lee la cerrada ─► flujo y compras
```

## 3. Contratos de API

Convenciones de M1 a M14: `ok` / `error` / `errorConCodigo` / `leerCuerpo`, `traducirErrorDb`, zod `strict`, `{ data }` / `{ error, codigo }`. **Cada handler empieza con su guard** (prueba estática, `tests/api.guards.roles.test.ts`). Datos solo con `supabaseAdmin()` desde el servidor. Handlers en `src/app/api/plan-tienda/`; lógica pura en `src/lib/plan-tienda/` (`tipos-api.ts` autocontenido, `esquemas.ts`, `cubetas.ts`, `motor.ts`, `laminas.ts`, `ajustes.ts`, `fuentes.ts`, `decisiones.ts`, `carga.ts` y `planner.ts` —resolutores de los importadores—, `excel.ts`; en `0.21.1`, `escritura.ts`); base **solo** en `src/lib/plan-tienda/consultas.ts`, único archivo que nombra las tablas y funciones `plan_tienda_*` y `planner_*` y `aplicar_lote_plan_tienda` (prueba estática); orquestación en `servicio.ts`. Errores: `401` · `403` · `400` · `404` · `409` (regla) · `413` · `503 lectura_lenta` · `500` sin detalles.

**Se reutiliza sin modificar:** de `src/lib/proyeccion/`: `bloquesDeAnio`, `repartirEntero`, `cargarCatalogo`, `leerFilasConAnios`, `calculoEnCurso`, `parametrosDe` y, en `0.21.1`, `aplicarDecision`, `restaurarDecision` (nueva en `0.20.0 · M7 i`), `aplicarDecisionTienda`, `moverTotalTienda`/`totalTiendaTrasMover` (07b), `motivoRechazoDecision`, `motivoRechazoTotalTienda`, `desactualizadaDe`, `bloqueosNinoDeCierre`, `ninoDeFilas`, `payloadAnioDecision`; de `src/lib/arbol/`: `normalizarNombre`, `resolverGml` y el lector de archivos; de `src/lib/ventas/resolver.ts`: tienda por nombre y código y ubicaciones ignoradas (05c); de `src/components/importador/`: el asistente con vista previa; de `src/lib/direccion/`: el semáforo y `GET /api/direccion/estado`.

### 3.1 Rutas de `0.21.0`

| Ruta | Método | Guard | Entrada | Respuesta y errores |
|---|---|---|---|---|
| `/api/plan-tienda/opciones` | GET | `requirePlanner` | `?anio=` | Proyecciones del año (estado; en trabajo primero), versiones (nombre, corte, motor, quién), cargas parciales con su estado derivado, importaciones vigentes del planner por género, géneros, `parametros_defecto`, `version_motor`, `puede_aprobar` |
| `/api/plan-tienda/cargas/previsualizar` | POST | `requirePlanner` | `cargaFilasSchema = { anio, hasta_fecha, archivo_nombre, filas: { genero, mundo, linea, metrica: "Cant Act"\|"Venta Act"\|"CV Act", tienda, valores: { "2023"?, "2024"?, "2025"?, "2026"? } }[] (≤ 30 000) }` | `VistaPreviaCargaApi`: filas resueltas a `(tienda, GML)` (género `H`/`M` → género; mundo y línea por `resolverGml`; tienda por nombre o código), omitidas por motivo (`tienda_desconocida`, `ubicacion_ignorada`, `gml_desconocido`, `metrica_desconocida`, `unidades_negativas`), % de cruce, conciliación con Vector2 por tienda y año completo, `huella_previa`. Sin escribir |
| `/api/plan-tienda/cargas` | POST | `requirePlanner` | `{ …cargaFilasSchema, huella_previa }` | `201`. `409 vista_previa_distinta`, `carga_repetida`, `fecha_invalida`, `fecha_ya_cerrada` (el mes de `hasta_fecha` ya está publicado en M5: no hace falta), `demasiadas_omitidas` (> 2 % de las unidades del año, como M5) |
| `/api/plan-tienda/cargas/[id]` | PATCH | `requirePlanner` | `{ activo: false }` | Retira la carga |
| `/api/plan-tienda/versiones` | POST | `requirePlanner` | `versionSchema = { proyeccion_id, nombre, carga_id: uuid \| null, parametros?: Partial<ParametrosMotor>, traer_ajustes_de?: uuid }` | `201 VersionApi` (o `200 repetida`); con `aviso: "aprobaciones_sin_aplicar"` y la lista si otra versión (de esta u otra proyección en trabajo del año) tiene láminas aprobadas sin aplicar (H10: cada versión nace sin aprobaciones). `409 proyeccion_no_editable` (no está en trabajo), `calculo_en_curso`, `sin_venta`, `mes_faltante` (falta un mes publicado entre enero de `Y−1` y `k'`), `ventana_incompleta` (`k'` < julio), `carga_superada` / `carga_retirada` / `carga_otro_anio`, `503 lectura_lenta`. `traer_ajustes_de` copia los `ajustado` de otra versión de la misma proyección donde la combinación existe (con aviso de las que no) |
| `/api/plan-tienda/versiones/[id]` | PATCH | `requirePlanner` | `{ nombre?, activo? }` | |
| `/api/plan-tienda/laminas` | GET · POST | `requirePlanner` | POST: `{ genero_id, nombre, mundo_etiqueta?, nota?, gml_ids: uuid[1..40], orden? }` | Catálogo con GML, venta `Y−1`, avisos de catálogo (GML ≥ 300 u en «Otras», huérfanas). POST: `409 gml_en_otra_lamina`, `genero_distinto`, `nombre_repetido` |
| `/api/plan-tienda/laminas/[id]` | PATCH | `requirePlanner` | `{ nombre?, mundo_etiqueta?, nota?, orden?, activo?, gml_ids? }` | Cambiar `gml_ids` de una lámina con aprobaciones responde `200` con `aviso: "aprobaciones_desactualizadas"` |
| `/api/plan-tienda/laminas/importar` | POST | `requirePlanner` | `{ simular, filas: { genero, nombre, mundo_etiqueta, nota?, gmls: { mundo, linea }[] }[] (≤ 300) }` | Carga de los grupos iniciales de instr. §4.3 como datos (D5): vista previa con cada GML resuelto o no, choques con láminas existentes; sin `simular`, crea lo que no choca |
| `/api/plan-tienda/planner/previsualizar` | POST | `requirePlanner` | `plannerSchema = { genero_id, archivo_nombre, fecha_archivo, primer_mes, pestanas: { nombre, vta: (number \| null)[] }[] (≤ 80) }` | Lo lee el navegador: de cada pestaña de línea, **la fila «Vta» (fila 34)** con los meses desde el `primer_mes` que declara la fila de cabecera (hoy enero de 2022); la hoja **«OTB - Unidades» se descarta** (§5.5). Devuelve cada pestaña con su lámina (mapeo recordado, nombre igual o sin resolver), los cuatro valores por lámina, el **control de cuadre** con Vector2 y `huella_previa` |
| `/api/plan-tienda/planner` | POST | `requirePlanner` | `{ …plannerSchema, mapeo: { pestana, lamina_id \| null, ignorar }[], recordar, incluye_aperturas, huella_previa }` | `201`. `409 pestana_sin_lamina`, `vista_previa_distinta`. El control que no cuadra **avisa, no bloquea** (instr. §4.2) |
| `/api/plan-tienda/planner/[id]` | PATCH | `requirePlanner` | `{ incluye_aperturas?, activo? }` | |
| `/api/plan-tienda/versiones/[id]/mesa` | GET | `requirePlanner` | `?genero&estado=todas\|pendientes\|aprobadas\|con_planner&q` | `MesaApi` (§3.3), de `plan_tienda_resumen` y `plan_tienda_vector2`: KPIs por género (aprobadas / total; 2027 tiendas + Benavides en cada fuente; aprobado tiendas + Benavides) y láminas agrupadas en «Detalladas por el planner» y «Sin detalle del planner», ordenadas por volumen |
| `/api/plan-tienda/versiones/[id]/laminas/[laminaId]` | GET | `requirePlanner` | — | `LaminaDetalleApi` (§3.3) |
| `/api/plan-tienda/versiones/[id]/laminas/[laminaId]/ajustes` | POST | `requirePlanner` | `ajustesSchema = { version_vista, celdas: { tienda_id, anio, valor: entero \| null }[] (1..60) }` | `200` con la lámina recalculada. `409 lamina_cambio` (trae la versión actual), `proyeccion_no_editable`, `tienda_no_editable` (cierre 2026 de una apertura, tienda fuera) |
| `…/laminas/[laminaId]/aprobar` | POST | **`requirePlanner`** (admin y planner, D7) | `aprobarSchema` (§3.2) | `201`. `403` comprador (lo da el guard); `400 fuente_requerida` («Elige de dónde sale la cifra de 2026 y la de 2027»), `valor_manual_requerido`, `nota_requerida`; `409 fuentes_cambiaron` (con las actuales), `sin_planner`, `lamina_cambio`, `proyeccion_no_editable` |
| `…/laminas/[laminaId]/retirar` | POST | **`requirePlanner`** (admin y planner, D7) | `{ secuencia_vista, nota }` | `201`. `409 sin_aprobacion` |
| `…/laminas/[laminaId]/historial` | GET | `requirePlanner` | — | Decisiones y ajustes de la lámina, más reciente primero |
| `/api/plan-tienda/versiones/[id]/estado` | GET | `requirePlanner` | — | `{ versiones_lamina: { [lamina_id]: n }, calculado_at, max_updated_at }` para el refresco al volver a la pestaña (≤ 100 ms) |
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
  vector2: number | null;                           // SIEMPRE lo vigente real de la proyección destino (D16)
  vector2_exceso_cola_larga: number | null;          // unidades heredadas por encima de lo que propone el método 6 (aviso cola_larga_vector2)
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
  | "carga_menor_que_v2" | "sin_carga" | "venta_posterior_rara" | "correccion_invierno_distinta_m6" | "lamina_cambio" | "bloques_distintos"
  | "ritmo_acotado" | "sin_dato" | "aperturas_cambiaron" | "planner_reimportado";
```

### 3.4 Qué hace el servidor al aprobar

1. `requirePlanner` (admin y planner, D7); zod; perfil, nombre y rol de la sesión (el `rol` guardado sale de la sesión, nunca del cuerpo).
2. Lee la versión (sus `plan_tienda_valores` de los GML de la lámina, con ajustes), Vector2 de la proyección destino y la importación vigente del planner.
3. **Recalcula las cuatro cifras de cada año** con `fuentes.ts` (el mismo código que la pantalla) y las compara con `visto`; si difieren → `409 fuentes_cambiaron` con las actuales.
4. Calcula `valor_tiendas_actuales`, `valor_aperturas` (por GML: el ajustado si lo hay; **si no, el vigente de Vector2 de hoy**, no el `propuesto` congelado de la versión, H9; `visto.aperturas` entra en la comparación de `fuentes_cambiaron`) y `valor_total` por año, y el **detalle final por GML × tienda** que se escribirá (§5.6 paso 1), del que guarda totales y `huella_detalle`.
5. Arma `fuentes` y llama a `registrar_decision_plan_tienda`; traduce sus códigos.

### 3.5 Rutas de `0.21.1` (escritura de vuelta)

| Ruta | Método | Guard | Entrada | Respuesta y errores |
|---|---|---|---|---|
| `/api/plan-tienda/versiones/[id]/aplicar` | POST | `requirePlanner`; **`requireAdmin` si alguna lámina viene con `pisar_manual`** | `aplicarSchema = { confirmacion_id: uuid, laminas: { lamina_id, conflictos: "pisar" \| "respetar" \| null }[] (1..25), simular: boolean, tanda?: { lote_id: uuid, gml_ids: uuid[] }, huella_simulacion?, confirmo_revision: boolean, nota? }` | `simular` → `200 PlanAplicacionApi`: por lámina y GML, **antes y después** de cada año (tiendas actuales y Benavides por separado) y en total; filas que cambian con su clase anterior; **conflictos** (filas fijadas a mano con otra cifra: GML, AM, año, decidido, quién y cuándo); totales de tienda que se mueven (R512, R511); crecimientos que quedarían por reaprobar (07g D15); rechazos con código; y **las tandas** (grupos de GML de ≤ 300 registros escritos, que no parten un GML, H7). Sin `simular`, el navegador manda **una petición por tanda** con su `lote_id` y el mismo `confirmacion_id` (D17 de 07g) → `201` (o `200 repetido`). `409`: `proyeccion_no_editable`, `calculo_en_curso`, `proyeccion_desactualizada` (como 07g D14), `version_metodo`, los del Niño, **`conflictos_sin_resolver`**, `datos_cambiaron`, `simulacion_distinta`, `revision_requerida`, `lote_ajeno`, `sin_laminas_aplicables`, `conflicto_reintentar` |
| `/api/plan-tienda/versiones/[id]/aplicaciones` | GET | `requirePlanner` | — | Lotes `plan_tienda` de la versión con su resumen |
| `/api/plan-tienda/lotes/[loteId]/deshacer` | POST | `requirePlanner` | `{ lote_id: uuid (nuevo), laminas?: uuid[], simular }` | Lote `revertir_plan_tienda` (`deshace_lote_id` = el lote): restaura `anterior` de cada registro que **sigue** con `decision_lote_id` = ese lote, con `restaurarDecision` (lo cambiado después queda `cambiada_despues`); el total de tienda baja en el Δ de las láminas deshechas (§5.6). `409 no_revertible`, `proyeccion_no_editable`, `conflicto_reintentar` |

Códigos por lámina: `aplicada`, `aplicada_parcial` (alguna tanda de sus GML falló: se lista cuáles y se reintenta), `sin_cambios` (lo vigente ya es lo aprobado), `aprobacion_no_vigente`, `lamina_cambio`, `vector2_cambio` (la fuente fue `vector2` y Vector2 cambió desde la aprobación: escribirla desharía un cambio posterior; hay que volver a aprobar), `manual_excede` (respetando lo fijado a mano, ya suma más que lo aprobado para su bloque), `menor_que_vendido`, `menor_que_vendido_tienda` (07b), `sin_base_reparto`, `sin_filas` (cifra > 0 en un bloque sin filas activas), `bloques_distintos`, `cambio_concurrente`.

## 4. Pantallas

### 4.1 Dónde vive y quién la ve

- Ruta **`/planificacion/plan-tienda`**, item **«Plan por tienda (mesa por GML)»** en Planificación de `src/lib/nav.ts` (roles `PLANIFICACION`), después de «Proyección de unidades». El comprador no lo ve y la página lo redirige (decisión 113).
- Pestañas: **Mesa** · **Láminas** · **Datos** (cargas parciales, versiones del motor, importaciones del planner). Versión, género, filtro, búsqueda y lámina en la URL (`?version=&genero=&estado=&q=&lamina=`).
- Kit: `Card`, `DataTable`, `Chips`, `Select`, `Modal`, `DialogoConfirmar`, `Alert`, `Badge`, `EmptyState`, `Tabs`, `Switch`; gráfico con `src/lib/curvas/grafico.ts`; formato `es-PE`; hook `use-plan-tienda.ts` (patrón `useColeccion`).

| Rol | Puede |
|---|---|
| admin | todo: crear versiones, importar, editar láminas, ajustar, **aprobar y retirar**, aplicar (y **pisar lo fijado a mano**), deshacer |
| planner | crear versiones, importar, editar láminas, ajustar, **aprobar y retirar** (Javier, 2026-11-24), aplicar lo aprobado **respetando lo fijado a mano** (la opción «Pisar» no aparece), deshacer |
| comprador | nada |

### 4.2 Barra superior (instr. §6)

- Selector de **versión** («Corte 12-nov · motor v1 · proyección *seguimiento sep*») y botón **«Nueva versión»** (modal: proyección destino en trabajo, carga parcial —o «sin carga: hasta *último mes publicado*» con `Alert` ámbar «sin venta posterior a *mes*: las cifras no son comparables con las de referencia»—, parámetros de §5.1.8, corrección de invierno del motor y de M6 lado a lado, «traer ajustes de» otra versión). Encima, la **lista del orden operativo** (§8.4) con su estado leído de la base, en `Alert` ámbar si falta algo (no bloquea): «octubre publicado en M5», «factores del Niño sincronizados y confirmados», «proyección destino calculada con el método 6», «cola larga heredada devuelta (*N* registros pendientes)» con enlace a Aprobación; y, si otra versión tiene láminas aprobadas sin aplicar, «*N* láminas aprobadas en *versión* no se aplicaron: esta versión nace sin aprobaciones» (H10).
- **Por género** (Hombre primero; en 390 px, una tarjeta por género desplazable en horizontal): láminas aprobadas sobre el total; 2027 **por tiendas + Benavides** (dos números); **Vector2 tiendas + Benavides**; planner; **aprobado tiendas + Benavides**. Botón **«Descargar plan_claudio.xlsx»**.
- Estado de dirección (M14) de la proyección destino en una línea, con enlace.

### 4.3 Columna izquierda: lista

- Filtro Hombre / Mujer (y los demás géneros si tienen láminas); Todas / Pendientes / Aprobadas / Con planner; buscador.
- Dos grupos: **«Detalladas por el planner»** y **«Sin detalle del planner»**, cada uno de mayor a menor 2027 por tiendas; «Otras líneas menores» al final de su género. Cada fila: nombre, `Badge` de estado **en texto**, las tres cifras de 2027 (tiendas actuales) y una marca si tiene avisos.
- En 390 px la lista es la primera vista; al elegir una lámina se abre a pantalla completa con «Volver».

### 4.4 La lámina (instr. §6)

1. **Cabecera**: género · mundo · nombre, GML incluidos (nivel y temporada del motor; `Badge` «M7: *temporada*» si difiere), temporada, nota del grupo y, si la proyección destino aún trae cola larga heredada por encima de lo que propone el método 6, el aviso «Vector2 incluye *N* u de cola larga heredada (filas sin stock): devuélvelas a la propuesta en Aprobación» (§4.6, §8.1 b). La cifra Vector2 de abajo es igualmente la vigente real (D16). Botones **«Anterior»** y **«Siguiente pendiente»**.
2. **Cierre 2026**: cuatro opciones de radio —**Tiendas** (suma de tiendas con ajustes), **Vector2**, **Planner**, **Otra cifra** (campo)—, cada una con barra y **% frente a 2025 real**; ninguna marcada por defecto.
3. **2027 · tiendas actuales**: las mismas cuatro **sin Benavides** (Vector2 = vigente − aperturas; el planner con «no consta si trae Benavides» cuando `incluye_aperturas = desconocido`); **% frente al cierre 2026 por tiendas**. Debajo, **recuadro aparte «Benavides 2027 · abre 15-jun-2027»** con el valor ajustado y lo que propone Vector2 **hoy** (una línea por cada apertura o cierre del año); sin ajuste, Benavides sigue a Vector2 en vivo (H9); con ajuste, si Vector2 cambió desde que se creó la versión, aviso `aperturas_cambiaron` con las dos cifras.
4. **Nota** (≤ 1 000) y **«Aprobar lámina»** (admin y planner; la cabecera muestra quién aprobó y con qué rol): exige elegir 2026 y 2027; sin elegir, el botón queda deshabilitado con el texto «Elige de dónde sale la cifra de 2026 y la de 2027» (y el servidor responde `400 fuente_requerida` si llega igual). «Retirar aprobación» e «Historial». Si la aprobación ya se aplicó, el diálogo de retirar dice: «Retirar no deshace lo escrito en la proyección: para eso usa *Deshacer* en el historial de aplicaciones» (H16).
5. **Tabla por tienda**: Tienda · 2023 · 2024 · 2025 · 2026 al corte · vs 2025 (mismo periodo) · Margen 2026 · **Cierre 2026** (editable) · **2027** (editable) · 27 vs 26. Filas de totales en este orden: **Tiendas actuales**, **Benavides (R512) · abre 15 jun 2027** (2027 editable, 2026 vacío) y **Total con Benavides**. Celdas cambiadas marcadas (fondo y el texto «ajustado» para lectores de pantalla); **vacía = vuelve a la propuesta del motor**; botones **«Volver a la propuesta»** (toda la lámina) y **«Guardar ajustes»** (admin y planner, guarda sin aprobar). Todo se recalcula al escribir, en el navegador: totales, % y la opción «Tiendas» de arriba. Validación en la celda: entero ≥ 0 (si no, «Escribe un número entero de 0 en adelante»). «—» donde no hay dato; 0 solo si la tienda estaba abierta y no vendió. En 390 px, desplazamiento horizontal con la columna Tienda fija, celdas de 44 px, `inputMode="numeric"`.
6. *(Después, §7.1)* Gráfico por tienda.
7. **«Cómo se proyecta»** (desplegable): §5.1 en palabras con las fechas y pesos del corte de la versión («el mismo periodo de 2025 toma noviembre × 12/30…») y la frase de instr. §5.2 («supone que el ritmo de los últimos meses sigue hasta diciembre; el Niño está marcado hasta diciembre de 2026»).

Salir con ajustes sin guardar pide confirmar.

### 4.5 Pestañas Láminas y Datos

- **Láminas**: tabla por género (nombre, mundo, GML en chips, venta `Y−1`, con planner, estado); crear, editar, mover GML (aviso si la lámina tiene aprobación), desactivar; **«Importar láminas»** (CSV o Excel con género, nombre, mundo, nota y la lista de mundo + línea de cada GML; vista previa; es como se cargan los grupos de instr. §4.3); la «Otras» de cada género con sus GML implícitos y el aviso de los que pasan de 300 u.
- **Datos**: *Cargas parciales* (lista con estado vigente / superada / retirada y «Importar venta del mes en curso»: archivo → columnas → vista previa con omitidas, % de cruce con los GML, conciliación por tienda con Vector2 en 2023–2025 y, por tienda, **la venta posterior al último mes publicado** (`X − A` de enero a `k'`, H14) con aviso si es negativa o más del doble de la media mensual reciente → guardar). *Versiones* (motor, corte, parámetros, huella, totales, quién; «Repetir con los mismos parámetros»). *Planner* (por género: archivo → pestañas detectadas con su fila «Vta» y la lámina sugerida → «¿el 2027 incluye Benavides? sí / no / no consta» → control de cuadre → guardar).

### 4.6 Avisos (limitaciones que reconoce el pedido)

| Código | Cuándo | Nivel |
|---|---|---|
| `crecimiento_alto` | 2027 de la lámina por tiendas > 1,5 × su cierre 2026 («revisa si entró una marca nueva en 2025–2026») | atención |
| `posible_quiebre` | stock de tiendas del GML al cierre de `k'` < venta media mensual de julio a `k'` y ritmo del GML < 0,9 («la caída puede ser falta de stock: el motor no ve el stock») | atención |
| `cola_larga_vector2` | la proyección destino trae registros de cola larga decididos «tal cual» por encima de lo que propone hoy el método 6 (§8.1 b, sin devolver); muestra las unidades de exceso. Vector2 sigue siendo la vigente real (D16) | atención |
| `sin_carga` · `venta_posterior_rara` | la combinación no viene en la carga parcial (usa el corte de lo publicado, §5.1.1) / la venta posterior a `k'` de la tienda es negativa o más del doble de su media mensual reciente | info · atención |
| `aperturas_cambiaron` · `planner_reimportado` | Benavides ajustado y Vector2 de la apertura cambió desde la versión / la aprobación usó «Planner» y se importó otro archivo del género (la lámina queda `desactualizada`) | atención |
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

### 4.8 Aplicar a la proyección (0.21.1)

Botón **«Aplicar lo aprobado a la proyección»** en la barra (admin y planner; pisar, solo admin: Javier, 2026-11-24): elige láminas aprobadas (todas por defecto) → **vista previa** (simulación): tabla por lámina y GML con antes y después de 2026, 2027 tiendas actuales y Benavides, y el total; los **conflictos** con lo fijado a mano **agrupados por lámina** (ver abajo); los totales de tienda que se mueven; los GM cuyos crecimientos quedarían por reaprobar → casilla «Revisé el antes y el después» → **Aplicar** (en tandas por GML con barra de progreso; si una tanda falla, la lámina queda «aplicada en parte» con los GML pendientes y el botón «Reintentar lo pendiente»). Después, el resumen escrito por la base y el aviso «El flujo y las compras cambian cuando cierres esta proyección en Proyección» con enlace. Historial de aplicaciones con «Deshacer».

**Conflictos: una confirmación por lámina, nunca una por fila.** El destino es «seguimiento sep» (§8.4), que trae **cientos de cifras de 2027 fijadas a mano** por el planner: casi toda lámina aprobada con una fuente distinta de «Vector2» tendrá conflictos. La vista previa los presenta así:
- **Un bloque por lámina con conflictos**: «*N* filas fijadas a mano en 2027 (y *M* en 2026) · suman *X* · el reparto les daría *Y*», con **una sola elección para toda la lámina** —«Respetar» (el resto de la lámina absorbe la diferencia) o «Pisar» (solo admin)— y, debajo, la **lista desplegable** de esas filas (GML, AM, año, cifra fijada, lo que les daría el reparto, quién y cuándo; marcadas «viene del plan por tienda de una proyección anterior» si es el caso, §5.7). La elección vale para todas las filas de la lista; no hay elección por fila (quien quiera tratar una fila distinta la cambia antes en Por línea).
- Al elegir, el bloque muestra el **resultado de esa elección** con la simulación (respetando: si el resto cuadra, `manual_excede` o `sin_cambios`).
- Botón **«Respetar en todas las láminas»**, que solo rellena la elección de las láminas sin elegir; **no hay «Pisar en todas»**: pisar se elige lámina a lámina.
- Todo se confirma en **una sola confirmación** (la casilla «Revisé el antes y el después», obligatoria si se pisa algo) para todas las láminas elegidas (≤ 25 por aplicación, §3.5 y §6.4).
- Ayuda en pantalla: aprobar 2027 con la fuente **«Vector2»** no escribe nada (Vector2 ya es lo vigente, con las cifras del planner) y por tanto **no genera conflictos**: es el camino cuando Javier acepta lo que el planner fijó en esa lámina.

### 4.9 Refresco y concurrencia (D13)

Al volver a la pestaña (el sondeo cada 60 s queda para después, §7.1), `GET …/estado`; si cambió una lámina, se recarga la lista y, si es la abierta y no hay ajustes sin guardar, también la lámina; si los hay, `Alert` «*Nombre* guardó esta lámina: recarga para ver sus cambios (perderás los tuyos)». Guardar o aprobar con una versión vieja → `409 lamina_cambio` con el mismo texto.

## 5. Reglas de negocio

### 5.1 Motor de proyección por tienda (`src/lib/plan-tienda/motor.ts`, puro, `VERSION_MOTOR = 1`)

Es instr. §5 **generalizada**: el año en curso `Y` y el corte `d` son parámetros; nada en el código dice 2026, noviembre, 0,40 ni 0,60. Notación de las instrucciones, con `Y` en lugar de 2026: `real26 ≡ real(Y)`, `mp25 ≡ mp(Y−1)`, `W26`, `W25`, `resto25`, `y25`. `v_{Z,m}` = unidades de Vector2 (M5, solo tipo Tienda) de la tienda `s` en el GML `g`, mes `m` del año `Z`. Todo en coma flotante; **se redondea una sola vez**, al final de cada cifra por tienda × GML × año (§5.1.7). El motor no lee el reloj ni la base: recibe cubetas, carga parcial, bloques y parámetros.

#### 5.1.1 Corte y ventanas

- **Corte** `d`, mes del corte `m_c`, **peso del mes del corte `α = día(d) ÷ días(m_c)`** (12-nov → 12/30 = 0,40; el «0,60» es `1 − α`). Con carga parcial vigente, `d = hasta_fecha`; **sin carga**, `d` = último día de `k'` (`m_c = k'`, `α = 1`).
- **Venta de `Y` al corte:** `A = Σ_{m=1}^{k'} v_{Y,m}` (Vector2); `X` = unidades de `Y` de la carga parcial (`null` sin carga o si la combinación no viene). **`real(Y) = max(X, A)`** (instr. §4.1 y primer pedido: `f26 = max(Excel, V2 ene–set)`); si `X < A`, aviso `carga_menor_que_v2`.
- **Combinación sin carga** (`X = null` con una carga vigente en la versión: el GML o la tienda no vienen en el archivo, hoy una fracción mínima de los GML): esa tienda × GML **usa el corte de lo publicado** (`d' = ` fin de `k'`, `m_c = k'`, `α = 1`) en **todas** sus ventanas (`real`, `W26`, `W25`, `mp`, `resto25`, `I`, `C`), con aviso `sin_carga` (H14). Si no, `W26` acabaría en `k'` y `W25` en el corte de la carga y el ritmo saldría sesgado a la baja. Las sumas de red (`T_temp`, `T_g`, `R_g`) suman cada combinación con sus propias ventanas: numerador y denominador de cada una son del mismo periodo.
- **Diferencia entre fuentes** (H14): `real = max(X, A)` hace que toda diferencia de fuente de enero a `k'` entre el Excel y M5 caiga en la parte posterior a `k'` (en `W26`, que pesa en el ritmo). La vista previa de la carga muestra por tienda `X − A` («venta posterior a *mes*») y la lámina avisa `venta_posterior_rara` si es negativa o más del doble de la media mensual reciente de la tienda.
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

| Tratamiento | Tiendas | Motor | Fila de la proyección donde se escribe (0.21.1) |
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
| `umbral_lamina` | 300 u/año | 0–100 000 (avisar GML grandes en «Otras»; no es del motor) |

Constante `PARAMETROS_MOTOR_DEFECTO`; la versión guarda los usados. **`VERSION_MOTOR` sube con cualquier cambio de fórmula, ventana o redondeo**, en el mismo commit y con nota en `docs/DECISIONES.md`; entra en la huella. «Repetir con los mismos parámetros» da la misma huella y los mismos `propuesto` si las cargas y los maestros no cambiaron; si cambiaron, dice cuáles.

### 5.2 Ajustes y decisiones

- **Ajuste por tienda** (celda de la lámina): el valor de la lámina para esa tienda y año se reparte entre los GML de la lámina **en proporción a su `propuesto`** con `repartirEntero` (GML ordenados por id; si todos los `propuesto` son 0 o nulos, en proporción a la historia de `Y−1` de la tienda en cada GML; si también es 0, todo al GML de mayor `y25` de la red). Celda vacía → `ajustado = null` en todos los GML de esa tienda y año. Benavides se ajusta igual (por GML, sobre el vigente de Vector2).
- **Las cuatro cifras de un año** (`fuentes.ts`, mismo código en navegador y servidor): *Tiendas* = `Σ final` de las tiendas actuales de la lámina; *Vector2* = §5.1.3 (sin aperturas); *Planner* = `cierre_2026` o `proy_2027` de la importación vigente (si `incluye_aperturas = 'si'`, a `proy_2027` se le resta **el vigente de Vector2 de las aperturas fijado en la versión** (el `propuesto` de sus registros, inmutable), no su `final`: así ajustar Benavides no mueve la cifra del planner ni dispara `fuentes_cambiaron` (H15); se rotula; con `'no'` o `'desconocido'` se compara tal cual, con el aviso en el segundo caso); *Otra cifra* = la escrita. **Las aperturas no tienen selector de fuente** (instr. §5.4): por GML, el **ajustado** si lo hay; **si no, el vigente de Vector2 de hoy** (no el `propuesto` congelado de la versión: si alguien cambia R512 en Proyección después de crear la versión, la mesa lo ve, H9). Aprobar fija `valor_aperturas`; si después cambia el Vector2 vivo de una apertura sin ajuste, la lámina queda `desactualizada` (`aperturas_cambiaron`), igual que con la fuente `vector2`. Con ajuste, el aviso `aperturas_cambiaron` muestra las dos cifras.
- **Aprobar** (admin o planner, D7) exige fuente en los dos años, inserta dos filas (una por año) con el mismo `acto_id`, la foto de las fuentes y el detalle final. Ajustar después deja la aprobación vigente con estado «aprobada con cambios sin aprobar» hasta que el admin o el planner vuelva a aprobar o retire. **Nunca se sobrescribe una aprobación** (instr. §7). **Retirar una aprobación ya aplicada no deshace lo escrito** en la proyección (la pantalla lo dice y remite a «Deshacer» de la aplicación, H16).
- **Estados de una lámina** (derivados): `pendiente`; `con_ajustes`; `aprobada` (último acto = aprobación, sin ajustes posteriores, con la misma composición, la misma `huella_detalle` y —si alguna fuente fue `vector2`— la misma cifra de Vector2); `aprobada_con_cambios`; `desactualizada` (otra composición; Vector2 cambió con fuente `vector2`; **se importó otro archivo del planner del género con fuente `planner`**, H15; o cambió el Vector2 vivo de una apertura sin ajuste); en `0.21.1`, `aplicada` (el último lote `plan_tienda` aplicado es de esta aprobación y lo vigente de Vector2 coincide) y `aplicada_cambiada`.
- **Estado de una versión** (derivado, C16): `borrador` (alguna lámina sin aprobación vigente), `aprobada` (todas aprobadas), `aplicada` (tiene al menos un lote `plan_tienda` aplicado y no deshecho).

### 5.3 Láminas

1. Un género, un `slug` estable, 1 a 40 GML del mismo género; un GML en a lo sumo una lámina activa.
2. **«Otras líneas menores»** (una por género) contiene, al leer, todo GML activo del género sin otra lámina activa: la suma de las láminas de un género es exactamente la de sus GML (R12).
3. **Carga inicial como datos** (D5): los grupos de instr. §4.3 —Hombre: Sacos = casual + formal, Chompas = casual + formal, Bermudas = Bermuda; Mujer: Vestidos, Short, Falda y Carteras = casual + formal; Top = Top urbano + Croptop urbano; Blazer-Saco = Blazer y Sacos casual y formal; Chompas = casual + urbano; Chalecos y Calzados = casual + urbano + formal— se cargan con «Importar láminas» desde un archivo que Javier o el coordinador preparan fuera del repo (en `datos/`); los GML no agrupados quedan en «Otras» (con aviso los de ≥ 300 u en `Y−1`) hasta que alguien les cree lámina; el botón «Sugerir» que lo haría de una vez queda para después (§7.1). El archivo de láminas iniciales que prepara el coordinador ya puede traer una lámina propia por cada GML de ≥ 300 u.
4. **Cambia el árbol:** GML nuevo → «Otras» (aviso si ≥ 300 u); GML desactivado → deja de sumar, tachado en su lámina; lámina sin GML activos → huérfana (decisiones conservadas, no aplicable: `sin_filas`). Una decisión guarda sus `gml_ids`: si la composición cambia, `desactualizada`.
5. **`detallada_por_planner`** la pone el importador del planner (la lámina recibió valores en la importación vigente de su género).
6. La lámina es por GML; la agrupación de marca de Vector2 no es dimensión de la mesa y **nunca se compara con las agrupaciones de marca del planner** (instr. §4.2 e §11).

### 5.4 Carga parcial del mes en curso y M5

- **Grano y formato** (instr. §4.1): `GENERO_LK` (`H`/`M`), `MUNDO_LK`, `LINEA_SAP_LK`, métrica (`Cant Act`, `Venta Act`, `CV Act` = costo ÷ venta), `TIENDA` (nombre, se mapea a código con el resolutor de 05c), columnas de años. Se cruza por **GML**, nunca por equivalencia ni marca.
- **No toca M5**: vive en `plan_tienda_cargas` y solo la lee el motor. `venta_stock_vigente`, las curvas (M6), los factores del Niño (06e), la proyección (M7), el flujo (M8) y el tablero (M14) no la ven.
- **Cuando M5 publica el mes cerrado**: nada se borra ni se reemplaza a mano. El motor toma siempre `real(Y) = max(X, A)`; con el mes publicado, `A` ya lo incluye. Si M5 publica **el mes de `hasta_fecha`** (o uno posterior), la carga pasa a `superada` (derivado) y una versión nueva ya no la ofrece: el corte vuelve a ser el fin de `k'`, o una carga parcial nueva del mes siguiente. Las versiones viejas que la usaron siguen legibles y reproducibles (la carga no se borra).
- **«Si hay venta diaria, usar la venta diaria real»** (instr. §4.1): Vector2 no tiene venta diaria; queda fuera (§7).
- **¿Octubre en M5 es requisito?** **Para el motor, no**: la carga del 12-nov trae octubre y noviembre hasta el 12 (con `k'` = septiembre, `k' = m_c − 2`, el límite permitido). **Pero sí se recomienda cargarlo antes de crear la versión de trabajo**, por tres razones: (1) la corrección (b) de M7 necesita septiembre y octubre publicados para calcular el factor de verano (§8.1); (2) la columna Vector2 se calcula con `k` = septiembre y octubre real no entra en su cierre 2026 hasta recalcular con octubre; (3) con octubre en M5, la carga solo aporta noviembre hasta el 12 y la conciliación es más fina. La ficha **no lo bloquea** (la versión avisa «octubre no está publicado en M5»), pero el orden operativo de §8.4 lo pone como primer paso: decidido, no es pregunta para Javier.

### 5.5 Importación del planner (instr. §4.2)

- **Fuente:** en cada **pestaña de línea**, la fila cuyo rótulo es «Vta» —la fila 34 en los archivos actuales; el lector **busca el rótulo** en la columna de rótulos y avisa si no está en la 34, para no leer otra fila si el archivo cambia— con meses desde el `primer_mes` **leído de la fila de cabecera** (en los archivos actuales, enero de 2022 en la columna `C`; si la cabecera no trae fechas legibles, la vista previa lo dice y no guarda): **2025 = `AM:AX`**, **ene–sep 2026 = `AY:BG`**, **oct–dic 2026 = `BH:BJ`**, **2027 = `BK:BV`**. `real_2025 = Σ AM:AX`; `real_ytd = Σ AY:BG`; `cierre_2026 = Σ AY:BJ`; `proy_2027 = Σ BK:BV`. Los rangos se derivan del `primer_mes` leído (`columnaDeMes(anio, mes)`), no se suponen, de modo que un archivo que empiece en otro mes o el plan de 2027–2028 se leen sin cambiar código (H15).
- **Nunca** la hoja «OTB - Unidades»: el lector la ignora por nombre y la vista previa lo dice.
- **Mapeo pestaña → lámina** con lo recordado (`planner_mapeos`), sugerencia por nombre igual o elección manual; varias pestañas a una lámina se suman; una pestaña puede marcarse «ignorar».
- **Control de cuadre** (instr. §4.2 y criterio 2 de instr. §10): por lámina y por género, `real_2025` frente a `y25` de Vector2 (todas las tiendas tipo Tienda, todos los GML de la lámina) y `real_ytd` frente a Vector2 de enero al **último mes real del archivo** (el anterior al mes de `fecha_archivo`: en un archivo del 08/10, septiembre; octubre ahí es proyección del planner) acotado a `k'` (H15). Diferencia > max(0,5 %, 50 u) en una lámina → `planner_no_cuadra` en esa lámina; por género se muestra la diferencia total. **Avisa, no bloquea.** Si `k'` no es septiembre, se compara enero a `k'` con los meses equivalentes del planner (`AY..`) y se dice.
- Se guarda archivo, fecha, quién y cuándo, `incluye_aperturas` y los cuatro valores por lámina (instr. §4.2). Formato real del archivo: depende de los ejemplos (§10).

### 5.6 Escritura de vuelta a la proyección (`0.21.1`; instr. §8)

**Nunca sobre una cerrada ni una archivada**; siempre sobre la proyección destino de la versión, en trabajo, que después se cierra con el cierre normal de M7. **La unidad atómica es el GML** (H7): un GML se escribe entero (los dos años, todas sus filas, sus registros de B2 y su parte de los totales de tienda) o no se escribe. Una lámina de pocos GML va en una sola tanda; una lámina grande («Otras líneas menores» de un género reúne decenas de GML y cientos de filas por año) se parte en **tandas del mismo acto** (mismo `confirmacion_id`, un lote por tanda) que nunca parten un GML. Si una tanda falla, la lámina queda `aplicada_parcial` con la lista de GML pendientes y «Reintentar lo pendiente» repite solo esos (la simulación se rehace). R24 se cumple por lámina cuando todas sus tandas están aplicadas, y por GML en cada tanda.

**Paso 1 · Destino por GML, tienda y año** (se recalcula al aplicar desde `plan_tienda_valores` y la cifra aprobada; debe dar la `huella_detalle` guardada al aprobar, si no la lámina está `aprobada_con_cambios`). Para cada año: con fuente `tiendas`, el `final` de cada GML × tienda actual; con otra fuente y cifra `T`, ese vector **escalado a `T`** con `repartirEntero` (ordenado por GML y código de tienda; si todo el vector es 0, en proporción a lo vigente de Vector2 por GML y bloque); con **`vector2`**, **lo vigente de hoy de cada fila** (lo que la mesa mostró como Vector2, D16): normalmente nada cambia y el código es `sin_cambios`; si Vector2 cambió desde la aprobación, `vector2_cambio` (volver a aprobar). Aperturas: por GML, el ajustado o el Vector2 vivo (§5.2).

**Paso 2 · Grupos de escritura.** Por GML y año, el destino se agrupa por **bloque de tiendas** según `parametros.bloques` de la proyección: `M(Z)` → **filas base** de ese GML y año (todas sus AM y, en nodos GMLE, equivalencias); cada tienda de `N(Z).nuevas_anterior` (R511 en 2026) → **sus filas de tienda**; cada apertura o cierre (R512 en 2027) → **sus filas de tienda**. Instr. §10.5 se cumple: `Σ decidido(base + R511)` = aprobado de tiendas actuales y `Σ decidido(R512)` = aprobado de Benavides.

**Paso 3 · Reparto dentro de un grupo** con total `T_G`:
- **Conflictos:** filas del grupo **fijadas a mano** = `origen = 'manual'` sin `decision_lote_id` ni `decision_ia_fila_id` (la clase «manual» de M14) con un `decidido` distinto de lo que el reparto les daría. Se listan en la simulación; sin elección para la lámina, `409 conflictos_sin_resolver`. La elección es **por lámina** (una para todas sus filas en conflicto, §4.8), no por fila. Con **«respetar»**, conservan su cifra y `T'_G = T_G − Σ fijadas`; con **«pisar»** (admin), entran al reparto como las demás.
- **Pesos** (instr. §8.1): `propuesto` del año; si todos son 0 o nulos, `vendido`; si también, la venta de `Y−1` de la fila (`historico`); si también y `T'_G > 0` → `sin_base_reparto`.
- **Piso en `Y`:** cada fila recibe al menos su `vendido` (regla de M7, `menor_que_vendido`): `x_r = vendido_r + repartirEntero(T'_G − Σ vendido, pesos'_r)`, con `pesos'_r = max(peso_r − vendido_r, 0)` (si todos son 0, `peso_r`). `T'_G < Σ vendido` → `menor_que_vendido` (o `manual_excede` si lo causa lo respetado). En `Y+1` no hay piso.
- **Mayor resto** con el orden de la `clave` de la fila (determinista).
- Se reemplaza toda otra clase (aceptada tal cual, aprobada en bloque por 07g, aceptada de la IA, escalada, sin decidir), con su foto en `anterior`.

**Paso 4 · Aplicar con la lógica de M7, en memoria y en este orden** (es lo que mantiene coherentes B2 y Σ meses):
1. **Filas de tienda de `Y`** (R511 en 2026): cada fila con `aplicarDecision` (`origen = 'manual'`, que en una fila de tienda es «fijada»); si la tienda tiene total decidido `D` en `Y`, se mueve a **`max(D + Δ, Σ fijadas)`** con `moverTotalTienda` (07b): las filas de esa tienda **de otros GML no cambian**. Si no tiene `D`, no se crea. Como R511 está en `M(Y+1)`, su cambio entra en `B` de las filas base de `Y+1`, **pero solo se rehace B2 de las claves base de los GML de la tanda** (H8): `propagarAnioSiguienteTienda` (`decision.ts:840-853`) devuelve las claves de todas las filas nuevas de la tienda y el patrón de 07b (`servicio-edicion.ts:483-547`) reescribe toda la tienda; 07h filtra esas claves a los GML de la tanda (las demás no cambian de valor, porque sus filas de R511 no se movieron) y no bloquea ni reescribe registros ajenos.
2. **Filas base de `Y`**: `aplicarDecision` por fila; B2 recalcula `propuesto` de `Y+1` de esas filas.
3. **Filas base de `Y+1`**: los pesos se toman **después** del paso 2 (la propuesta de `Y+1` ya recalculada); `aplicarDecision`.
4. **Filas de aperturas de `Y+1`** (R512): `aplicarDecision` por fila y el total de la tienda (instr. §8.2: «actualizar `proyeccion_tiendas.decidido` de R512») a **`max(D + Δ, Σ fijadas)`**; si R512 no tenía `D`, `D' = Σ vigente de todas sus filas antes + Δ`, que deja igual el factor de escala de sus filas de otras láminas. **No** se usa `aplicarDecisionTienda` con el total (regla 23 reescalaría las filas de R512 de todas las láminas, C4).
5. Los `meses` salen de `aplicarDecision` (reparto de M7 con la curva y los reales hasta `k`); **no se escala `meses[]` por fuera** (C8). Antes de mandar nada a la base se comprueba `Σ meses = vigente` en cada registro tocado (R31); si falla, el GML se rechaza con `meses_no_cuadran` (no debería ocurrir desde `0.19.1 · M7 g`: sería un fallo de M7 que hay que reportar).
- `decidido_por_*` = quien **aprobó** la lámina; `decidido_at` = el sello del lote; `nota` = «Plan por tienda · *lámina* · aprobado por *nombre* el *fecha* · aplicado por *nombre*» (con el tope de nota de M7); `decision_lote_id` = el lote; `decision_ia_fila_id = null`.
- **Solo se escribe lo que cambia** (H8): tras aplicar en memoria, se comparan en TypeScript las columnas de cada registro y de cada total de tienda con lo leído; los iguales no se mandan a la base (ni se bloquean `for update`, ni cambian su `updated_at`). Así una lámina no genera `cambio_concurrente` a quien edita otra línea, y R27 se prueba comparando `updated_at`, no solo cifras.

**Paso 5 · Simulación y huella** (como 07g D8): la vista previa devuelve el antes y después por GML y total (tiendas actuales y Benavides por separado), los conflictos, los totales de tienda movidos, los rechazos y los GM cuyos crecimientos quedarían por reaprobar (`ninoDeFilas` en memoria, 07g D15); su `huella_simulacion` (sha-256 canónico) viaja en la confirmación; si el servidor obtiene otra, `409 simulacion_distinta`. Más de 100 filas o algún conflicto pisado → casilla obligatoria «Revisé el antes y el después» (`revision_requerida`).

**Paso 6 · `aplicar_lote_plan_tienda(p jsonb)`** (patrón de `aplicar_lote_proyeccion`, 07g §2.4 y decisión 82-a), **una llamada por tanda**:
1. `select … from proyecciones … for no key update`; en un `revertir_plan_tienda`, `deshace_lote_id` no nulo y de un lote `plan_tienda` de la misma proyección (si no, `PT005`); idempotencia por `lote_id` + `huella_cuerpo` (`repetido` / `PT004 lote_ajeno`).
2. `estado ≠ 'en_trabajo'` → `PT001`; cálculo vivo → `PT002`; `calculado_at` distinto → `PT003 datos_cambiaron`.
3. **Pasada 1, sin escribir:** `for update`, en orden `(fila_id, anio)`, de todos los registros que se leen o escriben (los de las láminas en los dos años, los de B2 y los de `proyeccion_tiendas` tocados); `updated_at::text = esperado` (si no, `cambio_concurrente` en la lámina); la aprobación usada sigue siendo la última de su lámina × año (`aprobacion_no_vigente`); los conflictos «respetar» siguen como se vieron.
4. **Pasada 2:** escribe con la lista fija de columnas de `payloadAnioDecision` sin `activo`, más `decision_lote_id`; en `proyeccion_tiendas`, `decidido`, `origen = 'manual'`, `nota`, `decidido_*`. Prueba estática: la lista coincide con la de `aplicar_lote_proyeccion` (R14 de 07g).
5. Inserta las `proyeccion_lote_filas` (con `anterior`, `objetivo`, `tienda_id`, `fuente = 'plan_tienda'`) y **al final** la cabecera `proyeccion_lotes` (`tipo = 'plan_tienda'`, `plan_tienda_version_id`, `anio` = `Y` —el lote cubre los dos años; la columna es obligatoria y se usa el año en curso—, `resumen` calculado con lo escrito: láminas aplicadas y rechazadas por código, filas y unidades por clase anterior, conteo de conflictos pisados y respetados). FK diferibles como 07g.
6. `PT005` (revertido ajeno o no `plan_tienda`), `PT006` (proyección inexistente), `PT007` (payload inválido), `PT008` (un registro que debía escribirse no se escribió), `PT009` (Σ meses ≠ vigente en un registro escrito: defensa en profundidad de R31), `PT010` (en un deshacer, `decision_lote_id` o `decision_ia_fila_id` distinto del de `anterior` de esa línea). `40P01`/`55P03`/`57014` → `409 conflicto_reintentar`.
7. TypeScript llama **una vez** a `refrescarResumen` de M7.

**Deshacer** (`revertir_plan_tienda`, H6). Lote con `deshace_lote_id` = el lote deshecho, escrito por la misma función, en tandas por GML como la aplicación:
- **Registros:** por cada registro que **sigue** con `decision_lote_id` = el lote deshecho, se restaura `anterior` con **`restaurarDecision`** (`decision.ts`, la pieza nueva de la entrega previa: `armarRegistro` con `previa = anterior`, que conserva `decidido` sea cual sea el origen, más B2 de esas claves). **No** con `aplicarDecision`: con `origen = 'propuesta'` copia la propuesta de hoy (`decision.ts:383-384`) y tras un recálculo no devolvería la cifra anterior. Un registro `escalada` en `anterior` (fila de tienda de R511 o R512 antes de fijarla) se restaura con su cifra y origen `escalada` y la función de la tienda recalcula el resto al mover el total.
- **Regla de `decision_lote_id`** en la función hermana: el valor escrito solo puede ser `null`, el lote propio, o **exactamente el `anterior.decision_lote_id` de esa línea** (un lote de 07g, o el de una aplicación anterior); `decision_ia_fila_id` solo puede volver al de `anterior` (si esa propuesta de IA ya no es la vigente del GM, se restaura igual con aviso `ia_no_vigente` en el resumen). La prueba estática de «misma lista de columnas que 07g» se completa con una prueba de esta regla.
- **Totales de tienda, deshacer parcial** (`laminas?: uuid[]`): el total no vuelve a su `anterior` (que es el de antes de TODO el lote y desharía también las otras láminas): baja en **`Σ Δ` de los GML deshechos** guardados en `anterior.delta_por_gml` de la línea del total, con el mismo `max(D'' , Σ fijadas)` de 07b; si nadie más lo cambió y se deshace todo el lote, el resultado es exactamente `anterior`.
- Lo cambiado después queda `cambiada_despues` y se lista. Siempre permitido con la proyección en trabajo y sin cálculo en curso (como 82-e).

**Qué pasa si la proyección cambió desde que se aprobó la lámina:** la escritura usa los pesos de hoy (las propuestas recalculadas) y la simulación muestra «Vector2 al aprobar *X* · hoy *Y*»; si la fuente aprobada fue `vector2` y Vector2 cambió → `vector2_cambio` (volver a aprobar); un recálculo entre la simulación y la confirmación → `datos_cambiaron`.

**Si el destino deja de estar en trabajo o se crea otra versión con láminas aprobadas sin aplicar** (H10): cada versión nace sin aprobaciones (§7), así que esas aprobaciones quedarían huérfanas. Avisos, **sin bloquear**: «Cerrar» y «Archivar» de M7 sobre una proyección destino de una versión con láminas aprobadas sin aplicar muestran «*N* láminas aprobadas en el plan por tienda no se aplicaron: si cierras, quedan solo como registro» (M7 lee el conteo con una consulta de 07h; único cambio de pantalla en M7 además del `409 tiene_plan_tienda`); «Nueva versión» lo dice también (§4.2). El orden operativo de §8.4 evita el caso. «Traer aprobaciones» de otra versión queda como entrega corta posterior (§7.1).

### 5.7 Efectos en M7, 07g, M14, 07f y M8

- **M7.** Las filas escritas son decisiones normales (`origen = 'manual'`, con autor y nota), sobreviven a cualquier recálculo y no bloquean el cierre. «Por línea» muestra en esas filas el `Badge` «Plan por tienda · *lámina*» (desde el tipo del lote de `decision_lote_id`). Toda decisión individual posterior pone `decision_lote_id = null` (ya es así, 07g §3.6). Cambios en M7: `DELETE` de una proyección con versiones → `409 tiene_plan_tienda`, y el aviso de «Cerrar»/«Archivar» de §5.6 (H10).
- **Procedencia tras `copiar_de`** (H11): `copiar_de` no copia `decision_lote_id` (`0031`), así que lo escrito por 07h en una proyección que se cierra y se vuelve a copiar (seguimiento mensual) llega a la copia como `manual` sin lote. Se conserva la **nota** («Plan por tienda · *lámina* · …», que `copiar_de` sí copia): en la siguiente aplicación esas filas se listan como conflictos **marcadas «viene del plan por tienda de una proyección anterior»** (por el prefijo de la nota), con «respetar» o «pisar» como cualquier conflicto, y M14 las cuenta como «Fijado a mano» (decisión 145: es lo que son en esa copia). No se cambia `copiar_de`.
- **07g.** «Aprobar» no toca estas filas (están decididas). **«Reaprobar» excluye los registros cuyo lote es `plan_tienda`** (cambio en `src/lib/aprobacion/`: el universo de reaprobables filtra por el tipo del lote; sin él, «Reaprobar» pisaría lo aprobado por Javier con el método o la IA). «Revertir» de 07g ya rechaza un lote que no sea `aprobar` o `reaprobar` (`LP005`); la pestaña Aprobación lista los lotes `plan_tienda` con su rótulo y remite a «Deshacer» de 07h. Una fila que un lote de 07g había aprobado y que 07h reescribe sale de ese lote (su `decision_lote_id` cambia), así que revertir el lote de 07g ya no la toca (`cambiada_despues`).
- **07e (IA).** Las filas escritas cuentan como fijas (`manual` con cifra).
- **M14.** Escribir cambia cifras: **invalida la aprobación de dirección** de esa proyección (es lo esperado: la mesa prepara cifras por lámina y M14 aprueba la proyección entera; el orden es aplicar → cerrar → aprobar en M14). `tablero_proyeccion` (`create or replace` en la migración de la mesa, §2.2, para que `0.21.1` no necesite migración) clasifica **lote `plan_tienda` antes que lote de 07g**: «Cómo se decidió» gana la clase «Plan por tienda» y el puente una línea «Plan por tienda» separada de «Fijado a mano» y de «Otras diferencias» (R4 de M14 sigue exacto). **La huella de M14 no cambia** (no incluye el origen ni el lote).
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
- **R18 · Aprueban y retiran el admin y el planner** (`201` con cualquiera de los dos y `rol` guardado de la sesión; `403` comprador; `check (rol in ('admin','planner'))` rechaza otro rol también con `service_role`). La aprobación de dirección de M14 sigue siendo solo del admin (decisión 139, sin cambios).
- **R19 · Concurrencia.** Dos guardados o aprobaciones con la misma versión vista: uno `201`, otro `409 lamina_cambio`; ninguna fila duplicada.
- **R20 · Solo inserción.** `update`, `delete` y `truncate` sobre `plan_tienda_decisiones`, `plan_tienda_ajustes`, `plan_tienda_carga_filas` y `planner_valores` fallan también con `service_role`; las columnas del motor de `plan_tienda_valores` (`propuesto`, `ritmo`, `historia`, …) no cambian tras crear la versión: el trigger lo rechaza también con `service_role` (prueba en el humo).
- **R21 · Valores = fuentes.** El servidor recalcula y rechaza con `409 fuentes_cambiaron`; `valor_total = valor_tiendas_actuales + valor_aperturas`.
- **R22 · Destino en trabajo.** No se crea versión, ni se ajusta, aprueba o aplica sobre una proyección cerrada o archivada; `DELETE` de una proyección con versiones → `409 tiene_plan_tienda`.
- **R23 · Excel.** Tres hojas `plan_claudio`, `tiendas` y `notas`; Benavides en columnas o filas propias en todas; ningún total mezcla aperturas con tiendas actuales.

**Escritura (`0.21.1`)**
- **R24 · Cuadre.** Por lámina (con todas sus tandas aplicadas; por GML en cada tanda) y año, **`Σ vigente`** (`coalesce(decidido, propuesto)`) de sus filas base + filas de R511 = aprobado de tiendas actuales y `Σ vigente` de las filas de R512 = aprobado de Benavides, **exacto** (instr. §10.5). Con fuente `vector2` no se escribe nada y el cuadre se cumple con lo vigente (H16).
- **R25 · Piso.** Ninguna fila de `Y` queda bajo su `vendido`; si no cabe, `menor_que_vendido` y la lámina no se escribe.
- **R26 · Conflictos.** Con filas fijadas a mano distintas y sin elección, `409 conflictos_sin_resolver`; la elección es **una por lámina** y vale para todas sus filas en conflicto (el esquema no admite elección por fila); «respetar» las deja intactas; «pisar» exige admin (`403` al planner).
- **R27 · Solo lo de la lámina.** Los registros de otros GML, incluidas las filas de R512 y R511 de otras láminas y sus registros de B2, **no cambian ni de valor ni de `updated_at`** (el total de la tienda se mueve con `max(D + Δ, Σ fijadas)`; B2 solo para las claves base de los GML de la tanda; los registros iguales no se escriben).
- **R28 · Lote auditable.** Un `proyeccion_lotes` de tipo `plan_tienda` con una `proyeccion_lote_filas` por registro y por total de tienda, con `anterior`; conteos calculados con lo escrito; inmutable.
- **R29 · Idempotencia y concurrencia.** Reintento con el mismo `lote_id` → `repetido`; otro cuerpo → `lote_ajeno`; un registro cambiado entre simulación y escritura → `cambio_concurrente` en su lámina; un recálculo → `datos_cambiaron`.
- **R30 · Deshacer** restaura `anterior` de lo que nadie cambió después **aunque la proyección se haya recalculado** (una fila aceptada tal cual vuelve a su cifra de entonces, no a la propuesta de hoy; una aprobada por 07g vuelve con su lote; una `escalada` vuelve a `escalada`); deshacer una lámina de un lote de varias baja el total de la tienda solo en el Δ de sus GML.
- **R34 · Atomicidad por GML.** Si una tanda falla, ningún registro de sus GML cambia; las tandas ya aplicadas quedan, la lámina es `aplicada_parcial` y reintentar aplica solo lo pendiente.
- **R35 · Aperturas vivas.** Una apertura sin ajuste usa el Vector2 de hoy al aprobar; si cambia después, la lámina queda `desactualizada` y aplicar responde `aperturas_cambiaron`.
- **R31 · Σ meses = vigente** en cada registro escrito (comprobado en TypeScript antes y en la función, `PT009`).
- **R32 · 07g y M14.** «Reaprobar» de 07g no ofrece filas de un lote `plan_tienda`; «Revertir» de 07g rechaza esos lotes; una decisión individual posterior limpia `decision_lote_id`; la huella de M14 no cambia por la migración y sí al aplicar; «Cómo se decidió» y el puente de M14 muestran «Plan por tienda» y el puente sigue exacto. «Cerrar»/«Archivar» de M7 avisan (sin bloquear) con láminas aprobadas sin aplicar.
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
| Combinación tienda × GML que no viene en la carga | Usa el corte de lo publicado (`α = 1` en `k'`) en todas sus ventanas, aviso `sin_carga` |
| «Otras líneas menores» con decenas de GML | Se aplica en varias tandas por GML; si una falla, `aplicada_parcial` y «Reintentar lo pendiente» |
| Destino que se cierra o archiva con láminas aprobadas sin aplicar | M7 avisa al cerrar o archivar; las aprobaciones quedan como registro de lectura; una versión nueva nace sin ellas (§5.6) |
| Se reimporta el plan del planner de un género | Las láminas aprobadas con fuente `planner` pasan a `desactualizada` (`planner_reimportado`) |
| Fila escrita por 07h en una proyección anterior, llegada por `copiar_de` | Conflicto marcado «viene del plan por tienda de una proyección anterior» (§5.7) |
| Destino con cientos de cifras fijadas a mano («seguimiento sep», §8.4) | Conflictos agrupados por lámina con una sola elección por lámina y «Respetar en todas las láminas» (§4.8); aprobar con fuente «Vector2» no genera conflictos |

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

**D · Aprobación.** Aprobar L1 sin fuente de 2027 → `400 fuente_requerida`; con «Tiendas» y «Tiendas»: dos filas (2026: 2 563 / 0 / 2 563; 2027: 2 262 / 360 / 2 622) con el mismo `acto_id`; como planner → `201` con `rol = 'planner'`; como comprador → `403`; dos aprobaciones simultáneas (admin y planner) → una `409 lamina_cambio`.

**E · Escritura (0.21.1).** Proyección en trabajo con, para G1:
- **2027, filas base** (`M(2027)` = T1–T4): A (`propuesto` 1 500, sin decidir), B (`propuesto` 650, **fijada a mano en 700**), C (`propuesto` 300, aprobada en bloque por 07g). Destino 2 262 (tras el ajuste de C). Sin elegir → `409 conflictos_sin_resolver`. **Respetar B**: 1 562 entre A y C por 1 500 : 300 → **A = 1 302, C = 260**, B = 700 (Σ = 2 262). **Pisar B** (admin): 2 262 por 1 500 : 650 : 300 → **A = 1 385, B = 600, C = 277** (Σ = 2 262).
- **2026, filas base** (`M(2026)` = T1–T3, destino 1 328 + 613 + 149 = **2 090**): A (`propuesto` 1 400, vendido 1 000), B (fijada a mano en 600, vendido 450), C (`propuesto` 250, vendido 150). Respetando B: 1 490 con pisos 1 150 y resto 340 por 400 : 100 → **A = 1 272, C = 218**.
- **2026, T4** (filas de tienda `nuevas_anterior`, destino **473**): A_T4 y B_T4 con `propuesto` 300 y 100 (escaladas, vigentes 300 y 100), total decidido de T4 en 2026 `D = 1 000` → **355 y 118**, `D' = max(1 000 + 73, Σ fijadas) = 1 073`; las filas de T4 de otros GML no cambian.
- **2027, T5** (destino **360**): A_T5 y B_T5 con `propuesto` 200 y 100 → **240 y 120**; T5 sin `D` y con 5 000 de vigente total en todos sus GML → `D' = 5 060`.
- Un lote `plan_tienda` con una línea por registro y por total de tienda, con `anterior`; `Σ meses = vigente` en todos; «Reaprobar» de 07g no ofrece A ni C; «Deshacer» devuelve C a su cifra y su lote de 07g, B a 700 y los totales de T4 y T5 a 1 000 y sin decidir. **Deshacer tras recalcular** con propuestas distintas: C vuelve a su cifra de antes (no a la propuesta nueva) y con su lote de 07g. **Deshacer parcial:** con L1 (+60 en T5) y otra lámina L3 (G4, +40 en T5) en el mismo lote, el total de T5 queda en 5 100; deshacer solo L3 lo deja en **5 060** (no vuelve al `anterior` sin decidir, que desharía también L1). Ningún registro de G2 o G3 cambia de `updated_at`.

**G · Entrega previa (`0.20.0 · M7 i`), cola larga (sin techo).** Fila con `k = 9`, curva con `Σ_{m>9} c_m = 0,30`, `φ = 1`, vendido 60, `porAvance` 80, `A_f` 400: disponibilidad 0,40 (`revision`) → `vendido + round(A_f · S_resto) = 60 + 120 = 180` → **propuesto 180** (hoy daría 400); con `A_f` 1 000 → 60 + 300 = **360**, sin recorte (no hay techo: con el método 5 daba 1 000); con `A_f` 50 → 60 + 15 = 75 < `porAvance` → **80** (el piso del avance); disponibilidad 0,10 (`bajo_minimo`) → **80**, sin `revision_cola_larga`, no bloquea y entra en «Aprobar» de 07g si bloquea por `umbral`. **Devolver:** registros de esas filas con `origen = 'propuesta'`, `decidido = propuesta_al_decidir = 400`, uno sin lote y otro con lote de 07g, y un tercero `manual` en 350: devolver deja los dos primeros sin decidir (vigente 180 y 80) y el tercero intacto y listado; deshacer los devuelve a 400 con origen `propuesta`, `propuesta_al_decidir` 400 y el segundo con su lote.

**F · Carga y planner.** Una carga parcial con una tienda desconocida y una ubicación ignorada (omitidas), una combinación con `X < A` (aviso); publicar el mes de `hasta_fecha` en la base falsa la deja `superada`. Un archivo del planner sintético con tres pestañas de línea (fila «Vta» en la 34 y en otra fila en una de ellas, con aviso), una hoja «OTB - Unidades» con cifras distintas (ignorada) y un control que no cuadra en una lámina (aviso, guarda igual).

### 6.2 Hito (Javier y Cowork; sección nueva de `docs/pruebas/cowork-checklist.md`)

1. **Entrega previa `0.20.0 · M7 i`**, en el orden de §8.4: (a) publicar octubre en M5, **pulsar «Sincronizar factores»**, ver el verano 2026 con calculado y, si el aplicado se aparta más de 15 %, el aviso `factor_aplicado_lejos` en el formulario de confirmar; confirmar. (b) **Recalcular «seguimiento sep» con el método 6** (no se crea copia nueva; Javier, 2026-11-24): las filas bajo el mínimo proponen el avance con el aviso de disponibilidad, no bloquean y se aprueban en bloque si bloquean por umbral; las corregidas corrigen solo el resto del año (sin techo) y no aparecen en «Aprobación» ni en «Reaprobar»; las cifras fijadas a mano siguen intactas. (c) En «Aprobación», **«Devolver a la propuesta la cola larga heredada»**: vista previa con los dos años, la lista de «fijadas a mano: no se tocan», confirmar; ver el lote en el historial y que el total de cola larga de «seguimiento sep» baja a lo que propone el método 6 (las cifras se comparan fuera del repo, §6.3); deshacer y volver a devolver; ningún registro fijado a mano cambió. (d) La cerrada no cambió; su crecimientos y M14 no dicen «sin base corregida del Niño».
2. Importar la carga parcial del 12-nov: vista previa con el % de cruce y la conciliación; guardar.
3. Importar los dos archivos del planner: pestañas con su lámina, «OTB» ignorada, control de cuadre por género.
4. Cargar las láminas iniciales (§5.3) y revisar «Otras».
5. Crear una versión con la carga y **«seguimiento sep»** como destino, preparada según §8.4 (la lista del orden operativo en el modal, toda en verde).
6. **Comprobar las cifras reales** de instr. §5.5 (±0,5 %) según §6.3.
7. Recorrer Hombre y Mujer con «Siguiente pendiente»; corregir El Sol y Benavides en Polos urbano Hombre y ver los totales del criterio 3 de las instrucciones.
8. Aprobar láminas con distintas fuentes, unas como admin y otras como planner (la cabecera y el historial dicen quién y con qué rol); retirar una como planner; como comprador, no hay item.
9. Descargar `plan_claudio.xlsx` y revisar las tres hojas y Benavides aparte.
10. **(`0.21.1`)** Aplicar a «seguimiento sep» (incluida la «Otras» de Mujer, que va en varias tandas): ver antes y después y los conflictos con las cifras fijadas a mano **agrupados por lámina, con una sola elección por lámina** (probar «Respetar en todas las láminas», pisar una lámina como admin y comprobar que como planner «Pisar» no aparece; una lámina aprobada con «Vector2» no trae conflictos); comprobar en Proyección que la suma de `decidido` de las filas base + R511 de la lámina es el aprobado de tiendas actuales y la de R512 el de Benavides; ver el lote en «Aprobación» y «Plan por tienda» en «Cómo se decidió» de M14; deshacer una lámina; **cerrar «seguimiento sep»**: reemplaza a la cerrada actual (que queda archivada, sin repararla por SQL) y el flujo cambia.
11. En un teléfono (390 px): lista, lámina, edición de una celda, aprobar.
12. Pasan `npm run lint`, `npx tsc --noEmit`, `npx vitest run` y `npm run build`; `APP_VERSION` de cada entrega.

### 6.3 Las cifras reales: fuera del repositorio

Las cifras de instr. §5.5 y §10 (totales por género, el ejemplo de Polos urbano Hombre y sus tiendas) **no se escriben** en fichas, pruebas, fixtures, commits ni `docs/`. QA y el hito las comprueban **contra la base** con una hoja que el coordinador guarda fuera del repo (`datos/`, ignorada): versión con la carga del 12-nov; la columna «Vector2 de la cerrada `3dad947b`» de instr. §5.5 se compara con una consulta de solo lectura fuera del repo (la mesa ya no muestra una segunda columna de referencia, §7.1); tolerancia ±0,5 %. **Reproducirlas exige la misma venta al 12 de noviembre que usó el prototipo** (la carga parcial con ese archivo) y que las cargas de M5 de 2023 a septiembre de 2026 sean las mismas (la huella de la versión lo deja escrito); con octubre ya publicado en M5 el resultado debe ser el mismo salvo diferencias de fuente entre el Excel y M5 (por eso `max(X, A)`). La columna Vector2 de la cerrada saldrá **con** la cola larga inflada (es la cerrada, no se recalcula); la comparación limpia (instr. §10.6) se hace contra **«seguimiento sep» recalculada con el método 6 y con la cola larga heredada devuelta a la propuesta** (§8.1 b); sus cifras fijadas a mano por el planner entran tal cual (son decisiones, no cola larga heredada).

### 6.4 Seguridad (la revisa `seguridad`, sonnet, solo lectura)

- Cada handler de `src/app/api/plan-tienda/` empieza con su guard; aprobar y retirar con `requirePlanner` (admin y planner, D7); aplicar con `requirePlanner` y `requireAdmin` cuando se pisa lo fijado a mano; ninguna ruta con `requireUser` (decisión 113).
- Perfil, nombre y rol de la sesión; los valores aprobados los recalcula el servidor.
- Tablas nuevas con RLS sin políticas; `anon` y `authenticated` sin privilegios; solo inserción donde corresponde (triggers también contra `truncate`); `check (rol in ('admin','planner'))` en decisiones, con el rol tomado de la sesión.
- Funciones `security invoker`, `search_path = ''`, `execute` solo `service_role`; las de lectura `stable` sin escrituras; `plan_tienda_venta_motor` no lee `stock_valorizado`; costo y margen solo llegan a admin y planner.
- Límites: ≤ 30 000 filas de carga, ≤ 80 pestañas, ≤ 60 celdas por ajuste, ≤ 25 láminas por aplicación, notas ≤ 1 000, `fuentes` ≤ 64 KB, cuerpo ≤ `MAX_BYTES_CUERPO`.
- Los archivos se leen en el navegador; el servidor solo recibe filas tipadas. `500` sin detalles. Nada de datos reales en el repo.

### 6.5 Pruebas (cada archivo con un solo dueño)

- `backend`: `tests/plan-tienda.fixture.ts`, `tests/plan-tienda.fake-db.ts`, `tests/plan-tienda.motor.test.ts` (R1–R11, caso A y B), `tests/plan-tienda.laminas.test.ts` (R12, R13), `tests/plan-tienda.carga.test.ts` (R14, caso F), `tests/plan-tienda.planner.test.ts` (R15), `tests/plan-tienda.ajustes.test.ts` (R16, caso C), `tests/plan-tienda.decisiones.test.ts` (R17–R22, caso D), `tests/plan-tienda.rutas.test.ts`, `tests/plan-tienda.estatico.test.ts` (guard primero, único archivo de base, sin literales de año ni de pesos en el motor, lista de columnas de la escritura igual a la de 07g); en `0.21.1`, `tests/plan-tienda.escritura.test.ts` (R24–R33, caso E) y el ajuste de `tests/aprobacion.*` (reaprobar excluye `plan_tienda`); en `0.20.0 · M7 i`, los de §8.1 (`tests/proyeccion.cola-larga.test.ts`, `tests/aprobacion.devolver.test.ts`, `tests/aprobacion.*`, `tests/proyeccion.version-metodo.test.ts`, `tests/proyeccion.factor-nino.test.ts`; caso G).
- `frontend`: `tests/plan-tienda.vista.test.ts` (filas, totales, «—», Excel R23) y `tests/plan-tienda.render.test.ts` (roles, botones, 390 px, `409 lamina_cambio`).
- `datos`: `scripts/humo-0042.sql` de la entrega previa (§8.1 b) y `scripts/humo-0043.sql` de la mesa (inmutabilidad, columnas del motor inmutables, únicos, `check` de rol y de totales, `aplicar_lote_plan_tienda` con el caso E, dos aplicaciones de la migración).
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
- **Traer aprobaciones de otra versión o proyección** (cada versión nace sin aprobaciones; «traer ajustes» sí está): §7.1.
- Rol `direccion` y aprobadores de láminas fuera de admin y planner (un rol nuevo es un módulo de permisos aparte).
- Tiempo real por canales; la marca y el tema del prototipo.

### 7.1 Después (recortado de `0.21.0` para entregar antes; cada punto, entrega corta propia cuando Javier lo pida)

- **«Sugerir» láminas** (una lámina propia por cada GML no agrupado con ≥ 300 u en `Y−1`): hoy basta «Importar láminas» y la «Otras» implícita con aviso.
- **Segunda columna Vector2 de referencia** (`proyeccion_referencia_id`, p. ej. la cerrada al lado de la copia).
- **Gráfico por tienda** de la lámina (instr. §6.6).
- **Sondeo cada 60 s** de cambios de otras personas (hoy: refresco al volver a la pestaña y `409 lamina_cambio`).
- **Traer aprobaciones** de otra versión (H10), con las que siguen valiendo marcadas y las demás `desactualizadas`.

## 8. Entregas

**Por qué tres.** Las correcciones de M7 cambian cifras de la proyección y deben estar antes de comparar «Vector2» en la mesa (instr. §3); desde la revisión del 2026-11-24 incluyen devolver a la propuesta la cola larga heredada, que necesita una función SQL (§8.1 b). La mesa sola ya da valor (Javier decide por lámina, el Excel `plan_claudio` va al planner) y su hito valida el motor contra las cifras reales antes de escribir nada. La escritura toca el corazón de M7; conviene construirla con las cifras ya validadas.

| Entrega | Versión | Migración (la siguiente libre al construir) | Contenido |
|---|---|---|---|
| Previa | `0.20.0 · M7 i` | hoy `0042_devolver_cola_larga.sql` | §8.1: corrección de cola larga al resto del año con mínimo y sin techo, devolver la heredada, exclusión de 07g, método 6, aviso del factor |
| Mesa | `0.21.0 · M7 j` | hoy `0043_plan_por_tienda.sql` | §8.2 |
| Escritura | `0.21.1 · M7 j` | ninguna (si hiciera falta: siguiente libre y `0.22.0 · M7 j`) | §8.3 |

Si otra entrega con migración cierra antes (08b-2, 08c E2: `docs/PLAN.md` les deja «la siguiente libre por orden de cierre»), cada una toma la siguiente versión menor y el siguiente número libres al cerrar.

### 8.1 Entrega previa `0.20.0 · M7 i` (instr. §3; migración: la siguiente libre al construir, hoy `0042_devolver_cola_larga.sql`)

**Por qué deja de ser «sin migración» (revisión 2026-11-24, H1).** El criterio de Javier es «las filas sin stock no inflan la columna Vector2» (instr. §10.6). El tope solo cambia la **propuesta**; en la copia en trabajo («seguimiento sep» nació de la cerrada con `copiar_de`) las filas de cola larga son **decisiones heredadas «tal cual»** (`origen = 'propuesta'`, `decidido = propuesta_al_decidir`, **sin lote**, porque `copiar_de` no copia `decision_lote_id`), y una decisión sobrevive a cualquier recálculo (`armarRegistro`, `decision.ts:144-183`). Ni «Revertir» de 07g (exige el lote, `plan.ts:385`) ni «Reaprobar» (exige lote, `plan.ts:260`) ni «Aprobar» (solo sin decidir, `plan.ts:257`) las alcanzan, y la función de 07g solo admite `aprobar`, `reaprobar` y `revertir` (`0031`, `aplicar_lote_proyeccion`). Hace falta una **acción nueva, atómica y auditable**, y eso exige SQL: por la regla de versiones de `docs/PLAN.md` (entrega con migración → siguiente versión menor libre), la entrega pasa de `0.19.3` a **`0.20.0 · M7 i`**, y la mesa y la escritura se corren a `0.21.0 · M7 j` y `0.21.1 · M7 j` (§8.2, §8.3).

Verificado en el código (2026-11-24, base `84f4cf3`): `disponibilidadFila` (`cola-larga.ts:88-140`) calcula `A_f` = demanda **anual de año normal** (unidades ÷ `φ`, sobre la curva y las tiendas-mes con stock de `W12`) sin tope; `proponerPorDemandaCorregida` (`cola-larga.ts:160-188`) propone `max(vendido, round(A_f))` y `repartirResto` mete `A_f − vendido` en los meses `k+1..12` del año en curso; la cifra por avance es `porAvance = vendido + round(Σ_{m>k} T_norm · c_m · φ_m)` (`cierre.ts:79-85`); la fila de `Y+1` hereda el veredicto (`avisosColaLarga`) y su propuesta sale de B2 sobre el vigente de `Y`; `MIN_MESES_FACTOR = 2` ya está (`tipos-api.ts:66`); `VERSION_METODO = 5`.

#### (a) La corrección de cola larga: solo al resto del año, con mínimo y sin techo (H3; decidido por Javier el 2026-11-24)

Las mediciones del 2026-11-24 confirman que el tope solo no basta: aun por encima del mínimo, meter la demanda anual corregida entera en octubre–diciembre multiplica varias veces el ritmo de esos tres meses, y en el año del Niño `A_f` (normalizada) infla además las filas de invierno.

Fórmula nueva de la propuesta de una fila base con veredicto de cola larga en **`Y`** (piezas que ya existen: `porAvance` y `vendido` de `proponerCierre`; `A_f` de `disponibilidadFila`; `c_m` = la curva de la fila; `φ_m` = `factoresMes` de `Y`; `k` = último mes publicado):

```
S_resto     = Σ_{m=k+1}^{12} c_m · φ_m                    (peso del resto del año en el año en curso, con su Niño)
corregido   = vendido + round(A_f · S_resto)              (solo los meses que faltan, a ritmo de demanda corregida)
propuesto_Y = max(porAvance, corregido)                    (≥ vendido, porque porAvance ≥ vendido; sin techo)
```

Es decir, `propuesto_Y = max(porAvance, vendido + round(A_f · Σ_{m>k} c_m φ_m))`. **Sin techo:** se le ofreció a Javier un techo de 3 veces el avance (parámetro `multiplo_max_cola_larga`, con su aviso) y **lo descartó** el 2026-11-24 («resto del año, sin techo»). No hay parámetro ni aviso de techo.

- **Por veredicto** (`dispon` = disponibilidad medida; `mín` = `disponibilidad_minima`; `umbral` = `umbral_disponibilidad`, hoy 0,75):

| Caso | Veredicto | Propuesta de `Y` | Bloquea el cierre | 07g en bloque |
|---|---|---|---|---|
| `dispon ≥ umbral` o sin `A_f` | `cierra` (sin cambios) | por avance | no | — |
| `mín ≤ dispon < umbral` y `A_f ≥` umbral de cola larga | `revision` (sin cambios de nombre) | **`propuesto_Y` de arriba** | sí, hasta decidirla en Por línea | **no** (§8.1 c) |
| `mín ≤ dispon < umbral` y `A_f <` umbral de cola larga | `cierra_con_quiebres` (sin cambios) | por avance | no | — |
| **`dispon < mín`** | **`bajo_minimo`** (nuevo) | **por avance** (sin corrección); `A_f` solo informativa | **no** (§8.1 c) | sí, si bloqueara por `umbral` |

- `referencia_alternativa` sigue siendo `porAvance` en `revision`; en `bajo_minimo` guarda `round(A_f)` como «lo que habría propuesto la corrección», rotulada así en la explicación. El reparto mensual sigue siendo `repartirResto(propuesto_Y, real, k, curva, φ)`: con la fórmula nueva el resto del año queda en `round(A_f · S_resto)` (o en lo del avance si es mayor), no en `A_f − vendido`.
- **Año siguiente (`Y+1`): sin cambio de código.** Su propuesta sigue saliendo de B2 sobre el vigente de `Y` (normalizado por `φ` y con el crecimiento): hereda la corrección parcial de `Y` (sin techo, como `Y`). Se descarta usar `A_f` directamente en `Y+1`: devolvería la inflación que Javier señaló en 2027 justo en las filas peor medidas. El registro de `Y+1` hereda el veredicto (y por tanto `revision_cola_larga` o `disponibilidad_bajo_minimo`), como hoy.
- **Diciembre publicado** (`k = 12`): `S_resto = 0` y la propuesta es lo vendido, como el avance.
- **Parámetros nuevos** en `proyecciones.parametros` (jsonb existente; zod en `esquemas.ts`, `parametrosDe` con defecto para las proyecciones anteriores; editables en «Nueva proyección» junto a los umbrales de cola larga, y en «Parámetros» de una en trabajo, que la deja desactualizada por `parametros_cambiados` como cualquier otro):
  - `disponibilidad_minima`: **0,25** por defecto, rango 0 a `umbral_disponibilidad` (confirmado por Javier el 2026-11-24, §11). Es el único parámetro nuevo.
  - **El Flujo (M8) no cambia:** Javier planteó primero una regla de cobertura (de 4 a 7 meses de inventario sobre la venta proyectada de los 3 meses siguientes) y al aclararlo eligió no tocar el Flujo, que sigue con **objetivo 4 y tope 8 meses sobre el promedio de los 12 meses siguientes**. El mínimo de disponibilidad es solo de la corrección de cola larga.
- **Aviso nuevo `disponibilidad_bajo_minimo`** (atención, no bloquea): «Disponibilidad *x %*, bajo el mínimo de *y %*: no se corrige por quiebres; la demanda corregida sería *A_f*». Es el único aviso nuevo de la corrección (no hay aviso de techo).
- **`VERSION_METODO` sube a 6** (§8.1 d). Las proyecciones en trabajo quedan «desactualizadas» (`version_metodo`) hasta recalcular; las decisiones se conservan (de ahí §8.1 b); los lotes de 07g se bloquean hasta recalcular (07g D14). **La cerrada `3dad947b` no se toca.**

#### (b) Devolver a la propuesta la cola larga decidida «tal cual» (H1)

Acción nueva en la pestaña **Aprobación** de Proyección (07g), sobre una proyección **en trabajo, ya recalculada con el método 6** (si no, `409 proyeccion_desactualizada`): botón **«Devolver a la propuesta la cola larga heredada»**, visible cuando hay candidatas, con vista previa y confirmación como un lote de 07g.

- **Candidatas** (un registro de una fila base, en `Y` o en `Y+1`): avisos con `revision_cola_larga` o `disponibilidad_bajo_minimo` (los del recálculo con el método 6); **`origen = 'propuesta'`**; **`decidido = propuesta_al_decidir`** (se aceptó tal cual, nadie escribió una cifra); `decision_ia_fila_id` nulo; **con o sin `decision_lote_id`** (las aprobadas en bloque en la cerrada llegan a la copia sin lote; las aprobadas en bloque en la propia copia, con lote); y `decidido ≠ propuesto` de hoy (si coinciden no hay nada que devolver: `sin_cambio`).
- **Qué hace:** pone `decidido = null` (con `decision_lote_id = null`, que el `check` de la `0031` exige con `decidido` nulo) con la misma lógica que «limpiar la decisión» de Por línea (`aplicarDecision` con `decidido: null`): rehace los meses con la propuesta de hoy y, en `Y`, B2 recalcula la propuesta de `Y+1` de la fila. Después de devolverlas, las de `bajo_minimo` se cierran solas con su propuesta (o entran en Aprobar si su propuesta supera el umbral) y las de `revision` vuelven a pedir decisión en Por línea.
- **Lo que NO toca, y lista:** registros con `origen = 'manual'` (fijados a mano: en «seguimiento sep», los cientos de cifras de 2027 que el planner metió a mano), con traza de IA, `escalada`, o `origen = 'propuesta'` con `decidido ≠ propuesta_al_decidir`. La vista previa los muestra en una tabla aparte «Fijadas a mano: no se tocan» (GML, AM, año, decidido, propuesta de hoy, quién y cuándo) para que el planner las revise en Por línea si quiere.
- **Los dos años en una confirmación:** un lote por año con el mismo `confirmacion_id` (la columna `anio` del lote conserva su sentido y la lista por año de la pestaña los muestra donde corresponden), primero `Y` y después `Y+1` (el lote de `Y` cambia la propuesta de `Y+1` por B2, así que la simulación de `Y+1` se hace sobre el resultado del de `Y`); en tandas de ≤ 300 registros (D17 de 07g, `trocear.ts`), que no parten una fila.
- **Tipo de lote nuevo `devolver_cola_larga`, escrito por una función hermana** `devolver_cola_larga(p jsonb)` (no se toca `aplicar_lote_proyeccion`: su contrato y su prueba estática siguen iguales). Mismo patrón: `for no key update` de la proyección, idempotencia por `lote_id` + `huella_cuerpo`, `calculado_at` igual al de la simulación, pasada 1 con `for update` en orden `(fila_id, anio)` y `updated_at` esperado, pasada 2 con la lista fija de columnas de `payloadAnioDecision`, líneas antes y cabecera al final con el `resumen` calculado con lo escrito. Condición propia del registro objetivo: sigue siendo candidata con la misma cifra que vio la persona (`decidido = decidido_esperado`, `origen = 'propuesta'`, `decidido = propuesta_al_decidir`); si no, `cambiada_despues`. Códigos `DC001`–`DC009` (como `LP` de 07g). `resumen` con **la misma forma que 07g** (`pedidas`, `aplicadas`, `rechazadas`, `por_fuente.ia` y `por_fuente.metodo` en cero y `por_fuente.devolver`), para que la pestaña Aprobación lo lea sin otra rama; `fuente` de las líneas = `devolver`.
- **Foto de lo que había:** cada `proyeccion_lote_filas` guarda en **`anterior`** (columna nueva, §2.2) `decidido`, `origen`, `nota`, `propuesta_al_decidir`, `decidido_por_id`, `decidido_por_nombre`, `decidido_at`, `decision_lote_id` y `decision_ia_fila_id` de antes.
- **Deshacer:** «Deshacer» del lote en el historial de Aprobación crea un lote **`revertir_cola_larga`** con `deshace_lote_id` = el lote devuelto (columna nueva, §2.2; **no** se usa `revierte_lote_id`, cuyo `check` de la `0031` la ata a `tipo = 'revertir'` y no se puede cambiar sin `DROP CONSTRAINT`). Lo escribe la misma función hermana. Por cada línea aplicada cuyo registro **sigue sin decidir**, restaura `anterior` con la función nueva de M7 **`restaurarDecision`** (`decision.ts`: `armarRegistro` con `previa = anterior`, que conserva `decidido` aunque el origen sea `propuesta`, más B2), incluido su `decision_lote_id` anterior (la función permite exactamente ese valor, el de `anterior` de esa línea, y ningún otro); lo decidido después queda `cambiada_despues`. `restaurarDecision` es la misma pieza que usará «Deshacer» de 07h (§5.6, H6).
- **Cómo se ve en M14 («Cómo se decidió»):** las filas devueltas pasan de «Aceptada tal cual» o «Aprobada en bloque» a **«Sin decidir»** (la clasificación de `tablero_proyeccion` no cambia: no tienen decisión ni lote). La huella de M14 cambia (cambian cifras: es lo esperado) y la aprobación de dirección de esa proyección, si la hubiera, queda invalidada. El acto queda en el historial de Aprobación como «Cola larga devuelta a la propuesta · *N* registros · *quién* · *cuándo*».
- **Decidido por Javier (2026-11-24, §11):** se ejecuta **antes de usar la mesa** sobre «seguimiento sep», en el orden operativo de §8.4; lo fijado a mano por el planner no se toca.
- **Migración** (`0042_devolver_cola_larga.sql`, siguiente libre al construir): `proyeccion_lote_filas.anterior jsonb null`; `proyeccion_lotes.deshace_lote_id`; la función `devolver_cola_larga`; registro en `migraciones_aplicadas`. Aditiva, idempotente, sin `DROP`; humo `scripts/humo-0042.sql` (candidatas, `cambiada_despues`, deshacer con lote anterior restaurado, `check` de `deshace_lote_id`, dos aplicaciones de la migración).
- Guard: `requirePlanner` (como los lotes de 07g). Rutas: `POST /api/proyeccion/proyecciones/[id]/aprobacion/devolver-cola-larga` (`{ lote_id, confirmacion_id, anio, simular, huella_simulacion?, items?: { fila_id, decidido_esperado }[] }`, respuesta como `lotes` de 07g) y el «Deshacer» por `…/aprobacion/lotes/[loteId]/revertir` (que despacha a la hermana según el tipo del lote).

#### (c) Qué filas de cola larga quedan en revisión y fuera de los lotes (H4, H12)

- **Confirmado por Javier (2026-11-24, §11):** las filas **bajo el mínimo** (`bajo_minimo`) **ya proponen el avance**: no hay nada que revisar, así que **no bloquean el cierre** y, si su propuesta supera el umbral de cola larga (bloqueo por `umbral`), **se aprueban en bloque** como cualquier fila; llevan el aviso `disponibilidad_bajo_minimo`. Solo las que **siguen corregidas** (`revision`) quedan **«en revisión de verdad»**: bloquean el cierre y **no entran en ningún lote de 07g**. Así la carga a mano baja a las filas corregidas (en las mediciones, del orden de un tercio de las de hoy, × 2 años).
- **Dónde mira la exclusión** (H12): en los **`avisos` del registro** (`revision_cola_larga`), **en los dos años**, no en `motivo_cierre` (que es nulo en una fila decidida, `reglas.ts:144`). Se aplica en **«Aprobar» y en «Reaprobar»** de 07g con el código de rechazo nuevo `cola_larga_revision` («decídela en Por línea»). `FilaPlan` (`src/lib/aprobacion/plan.ts`) gana `revision_cola_larga: boolean` leído de los avisos del registro del año del lote.
- `filaBloqueaCierre` no cambia: `bajo_minimo` no lleva `revision_cola_larga`, así que solo bloquea por `umbral`.

#### (d) `VERSION_METODO = 6` sin romper las pantallas que asumen «anterior a 5 = sin Niño» (H2)

Constante nueva **`VERSION_METODO_MIN_NINO = 5`** en `src/lib/proyeccion/tipos-api.ts` («versión mínima con base corregida del Niño y crecimientos sobre ella»), junto a `VERSION_METODO_MIN_M8 = 5` (que no cambia) y `METODO_MIN_REFERENCIA = 5` (que no cambia). Usos:

| Archivo | Hoy | Cambio |
|---|---|---|
| `src/app/(app)/planificacion/proyeccion/crecimientos-vista.ts:38` (`esMetodoAnterior`) | `< VERSION_METODO` | `< VERSION_METODO_MIN_NINO` (la cerrada de método 5 sigue mostrando sus crecimientos) |
| `crecimientos-vista.ts:44-57` (`textoMetodoAnterior`, `textoCerradaMetodoAnterior`) | «antes de 0.14.0 … Niño no corregidos» para todo `< VERSION_METODO` | textos **por versión**: `< 5` como hoy; `5` → «Se calculó con el método 5: la corrección de cola larga no tenía mínimo y corregía el año entero. Recalcula una proyección en trabajo para aplicar el método nuevo» (en una cerrada: «… sigue sirviendo a M8 tal cual») |
| `src/lib/proyeccion/servicio-crecimientos.ts:219` (`metodoViejo = !esMetodoVigente`) | total `null` para método 5 | función nueva `tieneBaseSinNino(resumen)` (`≥ VERSION_METODO_MIN_NINO`); `esMetodoVigente` queda para lo que de verdad exige el método vigente (cierre, desactualizada, IA, 07g) |
| `src/lib/direccion/alertas.ts:388-397` (`alertaMetodoAnterior`) | «sin base corregida del Niño» para todo `< VERSION_METODO` | texto por versión: `< 5` como hoy; `5` → «Calculada con el método 5: la corrección de cola larga no tenía mínimo y corregía el año entero» (sigue `importante`) |
| `src/app/(app)/planificacion/proyeccion/vista.ts:708` | «método nuevo: la base del año siguiente se corrige del Niño» | «método nuevo (6): la corrección de cola larga tiene mínimo de disponibilidad y solo corrige el resto del año» |
| `src/app/(app)/planificacion/proyeccion/propuesta-ia-vista.ts:160` | «anterior al 5» | «anterior al vigente (*VERSION_METODO*)» |
| `desactualizado.ts:305`, `aprobacion/reglas.ts:47`, `ia/servicio.ts:569`, `servicio.ts:1059`, `direccion/cierre.ts:147` | `< VERSION_METODO` | sin cambio (exigen recalcular: es lo buscado) |

Prueba: `tests/proyeccion.version-metodo.test.ts` (backend): con `VERSION_METODO = 6`, una cerrada de método 5 muestra crecimientos y total, ningún texto dice «antes de 0.14.0» ni «sin base corregida del Niño», y una en trabajo de método 5 está desactualizada.

#### (e) Factor de verano del Niño (H13)

- El cálculo con 2 o más meses **ya existe**; el verano 2026 no tiene calculado porque solo septiembre está publicado. **Requisito operativo: publicar octubre de 2026 por M5 y pulsar «Sincronizar factores»** (la sincronización es manual, `servicio.ts:1336`): con las cargas nuevas el factor pasa a `desfasado` y, tras sincronizar, a `sin_confirmar`; los dos bloquean el cierre y los lotes (`reglas.ts:266-310`), así que el sistema ya obliga a volver a mirarlo.
- **Se queda un solo aviso nuevo, `factor_aplicado_lejos`** (`|aplicado ÷ calculado − 1| > UMBRAL_FACTOR_LEJOS = 0,15`), mostrado **en el formulario de confirmar factores** (PUT de factores) con el calculado y el aplicado lado a lado, en la pestaña Factores y en la cabecera de Proyección. No bloquea. **Se descarta `factor_fijado_sin_calculo`**: tras publicar octubre el propio flujo `desfasado` → `sin_confirmar` cubre ese caso.
- No cambia el método por sí sola.

#### (f) Coherencia con la mesa

La columna **«Vector2» de la mesa es SIEMPRE lo vigente real** de la proyección destino (`coalesce(decidido, propuesto)`: lo que quedaría escrito si se aprueba con esa fuente, §5.6 paso 1). Si la proyección aún trae cola larga heredada inflada, la mesa lo **avisa** (`cola_larga_vector2`, con las unidades de exceso frente a lo que propondría el método 6) y enlaza a §8.1 b; **no** muestra una cifra «con tope» como si fuera Vector2.

**Archivos:** `cola-larga.ts` (fórmula, veredicto `bajo_minimo`, avisos), `cierre.ts` (exponer `porAvance` si hace falta), `calculo.ts`, `decision.ts` (`restaurarDecision`), `reglas.ts`, `tipos-api.ts` (avisos, veredicto, parámetros, `VERSION_METODO = 6`, `VERSION_METODO_MIN_NINO`), `esquemas.ts` y `servicio-base.ts` (parámetros), `src/lib/aprobacion/` (`plan.ts` exclusión y devolución, `consultas.ts`, `servicio.ts`, `esquemas.ts`, `tipos-api.ts`), la ruta de devolver, los archivos de §8.1 d, `factor-nino.ts` y la pestaña Factores, la pestaña Aprobación (botón, vista previa, historial). Pruebas: `tests/proyeccion.cola-larga.test.ts` (RP1–RP4), `tests/aprobacion.devolver.test.ts` (RP5–RP7), `tests/aprobacion.*` (RP8), `tests/proyeccion.version-metodo.test.ts` (RP9), `tests/proyeccion.factor-nino.test.ts` (RP10). Hito: §6.2 punto 1.

#### (g) Invariantes de la entrega previa (vitest; RP5–RP7 también en el humo)

- **RP1 · Solo el resto del año.** En `revision`, `propuesto_Y = max(porAvance, vendido + round(A_f · S_resto))`; los meses `1..k` son el real y los `k+1..12` suman `propuesto_Y − vendido`; con `k = 12`, `propuesto_Y = vendido`.
- **RP2 · Bajo el mínimo no corrige.** `dispon < disponibilidad_minima` ⇒ veredicto `bajo_minimo`, propuesta = la del avance, aviso `disponibilidad_bajo_minimo`, sin `revision_cola_larga`; no bloquea el cierre salvo por `umbral`.
- **RP3 · Sin techo, con piso del avance.** Ninguna propuesta de `revision` baja de `porAvance`; una `A_f` grande no se recorta (caso G: `A_f` 1 000 da 360); `parametrosDe` no expone ningún múltiplo máximo ni existe el aviso de techo (prueba estática sobre `cola-larga.ts` y `tipos-api.ts`).
- **RP4 · `Y+1` por B2.** La propuesta de `Y+1` es la de B2 sobre el vigente de `Y` (misma función que hoy); bajar `Y` baja `Y+1`.
- **RP5 · Devolver solo lo «tal cual».** Solo registros con aviso de cola larga, `origen = 'propuesta'`, `decidido = propuesta_al_decidir`, sin IA y con `decidido ≠ propuesto`; con o sin lote; en los dos años. Un registro `manual` nunca cambia y aparece en la lista «no se tocan».
- **RP6 · Lote auditable.** Un `proyeccion_lotes` de tipo `devolver_cola_larga` por año con una línea por registro, con `anterior`; `resumen` con la forma de 07g; inmutable; reintento → `repetido`; registro cambiado entre simulación y escritura → `cambiada_despues` o `cambio_concurrente`.
- **RP7 · Deshacer exacto.** Tras devolver y recalcular, «Deshacer» deja en cada registro aún sin decidir el `decidido`, `origen`, `propuesta_al_decidir`, autor, fecha y `decision_lote_id` de `anterior` (no la propuesta de hoy); lo decidido después no cambia.
- **RP8 · Exclusión de 07g.** Ningún registro con `revision_cola_larga` (en `Y` o `Y+1`) entra en «Aprobar» ni en «Reaprobar» (`cola_larga_revision`); los `bajo_minimo` sí, si bloquean por `umbral`.
- **RP9 · Método 6 sin romper el 5.** Ver §8.1 d.
- **RP10 · Factor lejos.** `factor_aplicado_lejos` aparece con calculado y aplicado a más de 15 % y no bloquea.

### 8.2 `0.21.0 · M7 j` · la mesa (migración: la siguiente libre al construir, hoy `0043_plan_por_tienda.sql`)

Todo §2 (incluidos los cambios aditivos de §2.2 que aún no estén, `aplicar_lote_plan_tienda` —probada solo por el humo— y el `create or replace` de `tablero_proyeccion` que clasifica los lotes `plan_tienda`, para que `0.21.1` no necesite migración), §3.1 a §3.4, §4.1 a §4.7, §5.1 a §5.5. Requiere `0.20.0 · M7 i` desplegada y la proyección destino preparada según §8.4.

**Recortado para entregar antes (revisión H18) y movido a «Después» (§7.1):** el botón «Sugerir» láminas (la carga inicial por «Importar láminas» y la «Otras» implícita bastan), la segunda columna Vector2 de referencia (`proyeccion_referencia_id`; la cerrada se consulta en Proyección), el gráfico por tienda (instr. §6.6; la tabla trae las mismas cifras) y el sondeo de 60 s (basta el `409 lamina_cambio` y el refresco al volver a la pestaña).

### 8.3 `0.21.1 · M7 j` · la escritura de vuelta (sin migración si la de la mesa basta; si no, la siguiente libre y `0.22.0 · M7 j`)

§3.5, §4.8, §5.6 y §5.7: servicio y rutas de aplicar y deshacer, exclusión de lotes `plan_tienda` en «Reaprobar» de 07g, «Plan por tienda» en M14 (la función ya viene en la migración de la mesa) y el `Badge` en Por línea. La corrección del invariante Σ meses de M7 **ya está** (`0.19.1 · M7 g`, decisión 149): la escritura la comprueba en cada registro (R31) como defensa.

### 8.4 Orden operativo (fijo; lo recorre el hito y lo repite la pantalla «Nueva versión»)

1. **Publicar octubre de 2026 en M5** (y cada mes cerrado que llegue antes de empezar).
2. **Sincronizar factores** del Niño y **confirmar el verano 2026** con el calculado a la vista (`factor_aplicado_lejos` si se aparta).
Destino decidido por Javier el 2026-11-24: **la proyección en trabajo «seguimiento sep»** («lo primero es para tener un primer ejercicio; luego la decisión del planner es la que funciona»). No se crea copia nueva.

3. **Recalcular «seguimiento sep» con el método 6** (queda desactualizada por `version_metodo` al desplegar `0.20.0 · M7 i`; el recálculo conserva todas sus decisiones, incluidas las cifras fijadas a mano).
4. **Devolver a la propuesta la cola larga heredada** en «seguimiento sep» (§8.1 b), en los dos años: solo lo decidido «tal cual»; **lo fijado a mano por el planner no se toca** y se lista para revisarlo.
5. **Crear la versión del plan por tienda** atada a «seguimiento sep» (§4.2).
6. **Mesa** → **aprobar** (admin o planner) → **aplicar** (§5.6; los conflictos con lo fijado a mano, que serán muchos, se resuelven con una elección por lámina, §4.8).
7. **Cerrar «seguimiento sep»** con el cierre normal de M7: **reemplaza a la cerrada actual** (que queda archivada; sus datos descuadrados **no se reparan por SQL**) y el flujo y las compras pasan a leerla → aprobación de dirección en M14 (solo admin).

Crear otra versión (otro corte u otro destino) después de aprobar láminas deja las aprobaciones en la versión vieja: §5.9 y §4.2 lo avisan (H10).


## 9. Plan por tandas (cada archivo con un solo dueño)

**T0 · Revisión y verificación: hecha** (2026-11-24): revisión del `arquitecto-revisor` (§13) y mediciones del coordinador en `vector-two` (solo lectura, fuera del repo): R511 y R512 en sus bloques, sin cierres; último mes publicado septiembre; cola larga en revisión de la cerrada y de la copia por banda, origen y lote (confirman H1 y H3); alcance de R511 (H8); tamaño de «Otras» por género (H7); las dos proyecciones con método 5 (H2). Queda pendiente solo lo de §10.

**Entrega previa `0.20.0 · M7 i`:** `datos` (migración de §8.1 b, humo, `database.types.ts`; la aplica en `vector-two` con el MCP) y `backend` (§8.1 a–e: fórmula, veredicto, parámetros, `restaurarDecision`, exclusión y devolución en `src/lib/aprobacion/`, ruta, `VERSION_METODO_MIN_NINO`, aviso del factor; pruebas RP1–RP10 y caso G) en paralelo → `frontend` (parámetros en Nueva proyección, avisos, botón y vista previa de devolver en Aprobación, textos de §8.1 d, aviso en el formulario de factores) → `qa` → `seguridad` (ruta nueva y función nueva) → `documentador` (`docs/DECISIONES.md` 164 a 166, 07 y 07g «Cambios», `docs/PLAN.md` con la migración, checklist, `APP_VERSION = "0.20.0 · M7 i"`). Hito con Javier (§6.2 punto 1).

**`0.21.0 · M7 j`:**
- **T1 (en paralelo)** · `datos`: la migración de la mesa (hoy `0043_plan_por_tienda.sql`), `scripts/humo-0043.sql`, `database.types.ts`; puerta de medición de `plan_tienda_venta_motor` y `plan_tienda_vector2` (frío y caliente, anotada al pie como en la `0041`); aplica en `vector-two` con el MCP. · `backend`: `tipos-api.ts` y `esquemas.ts` (commit solo, desbloquea a `frontend`).
- **T2 (en paralelo)** · `backend`: `cubetas.ts`, `motor.ts` (primero, con el caso A y B), `laminas.ts`, `ajustes.ts`, `fuentes.ts`, `decisiones.ts`, `carga.ts`, `planner.ts`, `consultas.ts`, `servicio.ts`, rutas de §3.1, semáforo extraído a `src/lib/api/`, `409 tiene_plan_tienda` en el `DELETE` de M7; pruebas de su dueño. · `frontend`: `src/app/(app)/planificacion/plan-tienda/*`, lectores de la carga y del planner (en el navegador, con el lector compartido), `excel.ts`, item del menú; pruebas de su dueño.
- **T3** · `qa`: §6.1 A–D y F con la base falsa, tiempos de `plan_tienda_resumen`, casos borde, tamaños y tiempos en local; **comprobación de las cifras reales fuera del repo** (§6.3) cuando la base tenga la carga del 12-nov.
- **T4** · `seguridad` (sonnet, solo lectura): §6.4.
- **T5** · `documentador`: `CHANGELOG.md`, `docs/PLAN.md` (estado, registro de la migración de la mesa, tablas de solo inserción, versión), `docs/DECISIONES.md` (§12), esta ficha («Construido»), checklist, `APP_VERSION = "0.21.0 · M7 j"`. Hito.

**`0.21.1 · M7 j`:** `backend` (`escritura.ts` con tandas por GML, aplicar y deshacer con `restaurarDecision`, exclusión en 07g, lista de lotes de Aprobación en `Y+1`, aviso de «Cerrar»/«Archivar» en M7, caso E); `frontend` (§4.8, clase «Plan por tienda» en M14, `Badge` en Por línea, aviso al cerrar); `qa`; `seguridad`; `documentador` (`APP_VERSION = "0.21.1 · M7 j"`). Sin `datos`: la migración de la mesa ya trae `aplicar_lote_plan_tienda` y `tablero_proyeccion` (si al construir hiciera falta otra, siguiente libre y `0.22.0 · M7 j`). Hito.

## 10. Insumos: recibidos y pendientes

- **Recibido** (2026-11-21): las instrucciones de Javier (2026-11-16). Resolvieron fórmulas, tiendas, Benavides, planner, láminas iniciales, escritura y Excel.
- **Pendientes** (el coordinador los pide; no se inventan):
  - **`engine.py` y `build.py`** del prototipo. Confirman los supuestos marcados: el `peso` de la anualización (red del GML o de la temporada, §5.1.5), el encogimiento exacto de verano e invierno y de `corr_inv` (§5.1.5), el redondeo, qué cuenta como «filas sin stock» en la cabecera, el orden de la lista y cómo se arma «Otras». Sin ellos se construye con los supuestos y QA los contrasta con las cifras reales: si no cuadran ±0,5 %, se ajusta con `VERSION_MOTOR = 2`.
  - **Un ejemplo del Excel «Venta por tienda por año»** (puede ser con cifras alteradas): rótulos exactos de las columnas, cómo viene la columna del año en curso, nombres de tiendas, `CV Act`, filas de totales que haya que saltar. Bloquea el lector de la carga (T2 de `frontend`), no el resto.
  - **Los dos Excel del planner** (o copias con cifras alteradas): posición real del rótulo «Vta», nombres de pestañas, hojas que no son de línea además de «OTB - Unidades». Bloquea el lector del planner.
  - **El archivo de las láminas iniciales** (§5.3) en el formato de «Importar láminas»; lo prepara el coordinador con la lista de instr. §4.3 y una lámina propia por cada GML de ≥ 300 u (sustituye a «Sugerir», §7.1), fuera del repo.

## 11. Respuestas de Javier (2026-11-24)

Javier respondió por formulario el 2026-11-24 a siete de las diez preguntas; las otras tres se construyen con el default. Ya no queda ninguna pregunta que bloquee la `0.20.0 · M7 i`.

**Decidido por Javier**

| # | Pregunta | Respuesta | Dónde se aplica |
|---|---|---|---|
| 1 | Corrección de cola larga: ¿solo los meses que faltan del año y con techo? | **Solo el resto del año, sin techo.** `propuesto_Y = max(porAvance, vendido + round(A_f · Σ_{m>k} c_m φ_m))`. Se le ofreció un techo de 3 veces el avance como recomendado y lo descartó: no hay parámetro `multiplo_max_cola_larga` ni aviso de techo | §8.1 a, RP1, RP3, caso G, decisión 164 |
| 2 | ¿Por debajo de qué disponibilidad dejamos de corregir? | **25 %** (parámetro `disponibilidad_minima`). Planteó antes una regla de cobertura de inventario y, al aclararlo, eligió **no cambiar el Flujo**: sigue con objetivo 4 y tope 8 meses sobre el promedio de los 12 meses siguientes | §8.1 a |
| 3 | ¿Las líneas bajo el mínimo dejan de bloquear y se aprueban en bloque? | **Sí, como línea normal** (el default): no bloquean el cierre, entran en «Aprobar» de 07g si bloquean por umbral, con el aviso `disponibilidad_bajo_minimo`; solo las que siguen corregidas quedan en revisión obligatoria y fuera de los lotes | §8.1 c, RP2, RP8 |
| 4 | ¿Qué proyección recibe lo aprobado? | **La de trabajo «seguimiento sep»** (la que trae las cifras de 2027 fijadas a mano por el planner): se recalcula con el método 6, no se crea copia nueva. La cerrada actual no se modifica ni se repara por SQL: queda reemplazada cuando se cierre «seguimiento sep» | D1, C8, §4.8 (conflictos por lámina), §6.2, §6.3, §8.4, decisión 169 |
| 5 | ¿Devolvemos a la propuesta la cola larga heredada? | **Sí**, en una sola acción auditable y que se puede deshacer, antes de la mesa; **no toca lo fijado a mano** | §8.1 b, §8.4 paso 4, decisión 165 |
| 6 | ¿Quién aprueba láminas? | **El admin y el planner** (aprueban y retiran) | D7, §2.1 e (`check (rol in ('admin','planner'))`), §3.1, §3.4, §4.1, §4.4, §5.2, R18, caso D, §6.2, §6.4, decisión 171 |
| 10 | ¿Quién aplica lo aprobado a la proyección? | **El admin y el planner; pisar una cifra fijada a mano, solo el admin** (el default) | D7, D10, §3.5, §4.1, §4.8, R26 |

**Sin respuesta: se construye con el default**

| # | Pregunta | Default con que se construye | Si Javier responde distinto |
|---|---|---|---|
| 7 | ¿El 2027 del planner incluye Benavides? | «No consta»: se compara con las tiendas actuales y se avisa (`planner_no_consta_aperturas`) | Se marca en cada importación (`incluye_aperturas`), sin tocar código |
| 8 | ¿El planner ve el margen y el costo por tienda? | Sí (admin y planner); el comprador no ve la mesa | Con «no», la columna Margen solo para el admin: cambio pequeño |
| 9 | Nombre en pantalla de la proyección por tienda | Opción «Tiendas», título «Proyección por tienda»; el Excel sigue siendo `plan_claudio` | Solo textos |

## 12. Propuestas para `docs/DECISIONES.md` (desde la 150)

> **Numeración.** La 149 la tomó el ajuste `0.19.1 · M7 g`; estas propuestas empiezan en la **150**. Las que dependían de una respuesta de Javier ya la llevan (2026-11-24, §11); las de las preguntas 7 a 9, sin respuesta, se registran con el default.

- **150 · El plan por tienda es una ficha de M7 (07h) y trabaja sobre una «versión» atada a una proyección en trabajo.** La cerrada solo se lee; nunca recibe lo aprobado. *Descartado:* aprobar sobre la cerrada (no se podría escribir).
- **151 · La venta del mes en curso entra como carga parcial propia del módulo, por tienda × GML, con `hasta_fecha`, y queda superada sola cuando M5 publica el mes.** Nunca entra en `venta_stock_mensual`. `real(Y) = max(carga, Vector2 enero a k')`; una combinación sin carga usa el corte de lo publicado. *Descartado:* un mes parcial en M5 (contamina curvas, factores, proyección, flujo y tablero).
- **152 · Motor en TypeScript puro, generalizado a año en curso y corte, con `VERSION_MOTOR`, `propuesto` inmutable (trigger) y huella reproducible.** Los pesos del mes del corte salen de días del corte ÷ días del mes.
- **153 · Las tiendas se clasifican con los bloques de M7: antiguas (`M(Y)`), nuevas sin año comparable, aperturas y cierres aparte.** Benavides es aparte por ser apertura de 2027, no por su código; ningún total intermedio mezcla aperturas con tiendas actuales.
- **154 · La temporada de un GML para el motor es la de su equivalencia con más venta en los dos años anteriores**; la pantalla avisa si difiere de la de M7.
- **155 · La corrección de invierno la calcula el motor (ritmo de red de invierno ÷ todo el año, enero al corte), con la de M6 a la vista** (instr. §5.4).
- **156 · Láminas en un catálogo global editable con `slug` estable, un GML en a lo sumo una lámina y «Otras líneas menores» implícita por género;** los grupos iniciales se cargan como datos.
- **157 · El plan del planner se lee de la fila «Vta» de cada pestaña de línea, buscada por rótulo, con rangos relativos al primer mes que declara la cabecera; nunca de «OTB - Unidades»;** el cuadre usa los meses reales según la fecha del archivo y avisa sin bloquear; `incluye_aperturas` empieza en «desconocido»; reimportar deja desactualizadas las aprobaciones con fuente `planner`.
- **158 · La escritura de vuelta es un lote de tipo `plan_tienda` escrito por una función hermana; las filas llevan `origen = 'manual'` y `decision_lote_id`.** «Reaprobar» y «Revertir» de 07g excluyen esos lotes; M14 los clasifica como «Plan por tienda». *Descartado:* `origen = 'plan_tienda'` (exige `DROP CONSTRAINT` y tocar cuatro módulos).
- **159 · Al aplicar, lo fijado a mano se lista y se pide confirmación; pisarlo exige admin.** Matiza la 82 D2 solo para este acto explícito.
- **160 · El reparto va por GML y bloque de tiendas, en proporción al `propuesto` (luego `vendido`, luego la venta del año anterior), con mayor resto y piso de lo vendido; el total de una tienda nueva o apertura se mueve con `max(D + Δ, Σ fijadas)` (07b), no con la regla 23;** B2 solo para los GML de la lámina y solo se escriben los registros que cambian.
- **161 · El detalle por tienda aprobado se guarda pero todavía no alimenta 07f, la atribución de M14 ni el flujo de M8.** La 111 no cambia.
- **162 · La mesa muestra el margen (costo ÷ venta) a admin y planner** (default de la pregunta 8, sin respuesta). Matiza que M14 no lea costo, solo para esta pantalla.
- **163 · Sin tiempo real: versión vista en cada escritura (`409`) y refresco al volver a la pestaña;** el sondeo periódico queda para después.
- **164 · Corrección de cola larga del método 6** (`0.20.0 · M7 i`; preguntas 1 a 3, respondidas el 2026-11-24): en `Y` corrige solo el resto del año, **sin techo**: `max(porAvance, vendido + round(A_f · Σ_{m>k} c_m φ_m))`; bajo `disponibilidad_minima` (25 %) no corrige (veredicto `bajo_minimo`, no bloquea, se aprueba en bloque si bloquea por umbral, aviso); el Flujo de M8 no cambia; `Y+1` por B2 sin cambios; ninguna fila con `revision_cola_larga` entra en lotes de 07g (mirado en los avisos, en los dos años, también en «Reaprobar»); `VERSION_METODO = 6` con `VERSION_METODO_MIN_NINO = 5` para lo que dependía de la base sin Niño; aviso `factor_aplicado_lejos` al confirmar factores. Matiza 07g D1. La cerrada no se toca. *Descartado (por Javier):* un techo de 3 veces el avance (`multiplo_max_cola_larga`).
- **165 · Devolver a la propuesta la cola larga decidida «tal cual»** (pregunta 5, sí de Javier): lote `devolver_cola_larga` por año, función hermana de la de 07g, solo `origen = 'propuesta'` con `decidido = propuesta_al_decidir`, con o sin lote; lo fijado a mano se lista y no se toca; deshacer con un lote `revertir_cola_larga` que restaura la foto `anterior` con `restaurarDecision`. *Descartado:* que el recálculo trate esas decisiones como no tomadas (cambiaría en silencio una regla de M7 que el planner conoce: «las decisiones sobreviven a cualquier recálculo»); dejarlas a la escritura de la mesa (solo arreglaría las láminas aprobadas).
- **166 · Los lotes que deshacen otro lote fuera de 07g llevan `deshace_lote_id`** (columna nueva, `check (deshace_lote_id is null or tipo like 'revertir\_%')`); `revierte_lote_id` sigue reservado a `revertir` de 07g. Deshacer restaura la foto `anterior` (nunca la propuesta de hoy) y solo admite como `decision_lote_id` restaurado el que guarda la foto.
- **167 · La columna «Vector2» de la mesa es siempre lo vigente real de la proyección destino;** lo inflado se avisa, no se sustituye. Las aperturas sin ajuste siguen a Vector2 en vivo.
- **168 · La escritura es atómica por GML (los dos años y sus totales de tienda), en tandas del mismo acto;** una lámina grande («Otras») puede quedar aplicada a medias y se reintenta; `fuentes` guarda totales y huella del detalle, que vive en `plan_tienda_valores`.
- **169 · Orden operativo fijo** (§8.4), con destino **«seguimiento sep»** (Javier, 2026-11-24): publicar octubre → sincronizar y confirmar factores → recalcular «seguimiento sep» con el método 6 (sin copia nueva) → devolver la cola larga heredada (lo fijado a mano no se toca) → crear la versión → mesa → aprobar → aplicar (conflictos con una elección por lámina) → cerrar, que reemplaza a la cerrada actual (no se repara por SQL). Cerrar o archivar el destino, o crear otra versión, con láminas aprobadas sin aplicar avisa sin bloquear.
- **170 · Versiones y migraciones:** `0.20.0 · M7 i` (correcciones previas y devolver; migración siguiente libre, hoy `0042`), `0.21.0 · M7 j` (mesa; siguiente libre, hoy `0043`, con los objetos de la escritura y `tablero_proyeccion`) y `0.21.1 · M7 j` (escritura, sin migración; si la necesitara, siguiente libre y `0.22.0 · M7 j`).
- **171 · Aprueban y retiran láminas el admin y el planner; aplican los dos; pisar lo fijado a mano, solo el admin** (preguntas 6 y 10, 2026-11-24). `check (rol in ('admin','planner'))` en `plan_tienda_decisiones`; guard `requirePlanner` en aprobar y retirar. **Matiza la 139** solo para las láminas: la 139 es la aprobación de dirección de la proyección entera en M14, que sigue siendo solo del admin.


## 13. Revisión independiente (2026-11-24)

Revisión del `arquitecto-revisor` (opus, solo lectura, sin base) sobre la ficha del 2026-11-21, contrastada con las mediciones del coordinador en `vector-two` (consultas Q1–Q5 del revisor; cifras fuera del repo) y con el código en `84f4cf3`. Cómo quedó cada hallazgo:

| # | Gravedad | Hallazgo | Resolución |
|---|---|---|---|
| H1 | bloqueante | Las decisiones heredadas «tal cual» sobreviven al recálculo; en la copia llegan sin lote y ninguna acción de 07g las alcanza; la columna Vector2 «con tope» contradecía lo que se escribe | Confirmado por Q2. Acción nueva «Devolver a la propuesta la cola larga heredada» (lote `devolver_cola_larga`, función hermana, deshacer con `anterior`); lo fijado a mano se lista y no se toca; la entrega pasa a tener migración y a `0.20.0 · M7 i` (§8.1 b). Vector2 = vigente real, lo inflado se avisa (D16, §8.1 f). Pregunta 5: sí (Javier, 2026-11-24) |
| H2 | importante | Subir `VERSION_METODO` a 6 rompía textos y crecimientos que asumen «< 5 = sin Niño» | `VERSION_METODO_MIN_NINO = 5`, textos por versión, lista de archivos y prueba (§8.1 d). Q5: las dos proyecciones son de método 5 |
| H3 | importante | El tope solo no basta: la demanda anual corregida se mete entera en octubre–diciembre | Confirmado por Q1. Corrección solo al resto del año con `A_f · Σ_{m>k} c_m φ_m`, con piso del avance; `Y+1` por B2 sin cambios (§8.1 a). Se propuso además un techo de 3 × avance y **Javier lo descartó** (2026-11-24): sin techo |
| H4 | importante | Carga de trabajo: todas las filas de cola larga × 2 años a mano para cerrar | Bajo el mínimo: veredicto `bajo_minimo`, no bloquea y se aprueba en bloque si bloquea por umbral; solo las corregidas en revisión de verdad (§8.1 c). Pregunta 3: confirmado por Javier |
| H5 | importante | `revertir_plan_tienda` chocaba con el `check` de `revierte_lote_id`; claves de las líneas de total; forma del `resumen`; año del lote | Columna nueva `deshace_lote_id` con su `check` (sin `DROP`), claves sintéticas `tienda:<codigo>`, `resumen` con la forma de 07g más `plan_tienda`, lote con `anio = Y` listado también en `Y+1` (§2.2) |
| H6 | importante | Deshacer con `aplicarDecision` no restaura `anterior`; regla de `decision_lote_id`; total de tienda en deshacer parcial | `restaurarDecision` (`armarRegistro` con `previa = anterior`), `decision_lote_id` restaurable solo al de `anterior`, Δ por GML en la línea del total (§5.6) |
| H7 | importante | «Otras líneas menores» no cabe en los límites ni en `fuentes` | Confirmado por Q4. Atomicidad por GML en tandas del mismo acto; `fuentes` con totales y `huella_detalle`; el detalle vive en `plan_tienda_valores` (§2.1 e, §2.4, §5.6) |
| H8 | importante | Mover el total de R511 arrastraba B2 y reescritura de toda la tienda | B2 solo para las claves de los GML de la tanda; solo se escriben los registros que cambian; R27 con `updated_at` (§5.6, §5.8) |
| H9 | importante | Benavides con `propuesto` congelado frente a Vector2 vivo | Apertura sin ajuste = Vector2 de hoy; `visto.aperturas` en `fuentes_cambiaron`; `aperturas_cambiaron` (§3.4, §5.2, R35) |
| H10 | importante | Destino que se cierra o versión nueva con láminas aprobadas sin aplicar | Aviso sin bloqueo en «Cerrar»/«Archivar» de M7 y en «Nueva versión»; orden operativo fijo (§8.4); «Traer aprobaciones» en §7.1 |
| H11 | menor | `copiar_de` borra la procedencia de lo aplicado | Se documenta; los conflictos se marcan por el prefijo de la nota (§5.7) |
| H12 | menor | La exclusión de 07g debe mirar los avisos, en los dos años y en «Reaprobar» | `FilaPlan.revision_cola_larga` de los avisos del registro; código `cola_larga_revision` (§8.1 c) |
| H13 | menor | El sistema ya obliga a re-mirar el factor al publicar octubre; Sincronizar es manual | Solo `factor_aplicado_lejos` en el formulario de confirmar; se descarta `factor_fijado_sin_calculo`; el hito dice «pulsar Sincronizar» (§8.1 e, §6.2) |
| H14 | menor | Combinación sin carga mezcla ventanas; la diferencia entre fuentes cae en `W26` | Sin carga ⇒ corte de lo publicado en todas sus ventanas (`sin_carga`); `X − A` por tienda en la vista previa y `venta_posterior_rara` (§5.1.1) |
| H15 | menor | Planner: restar aperturas del `final`; reimportar no desactualizaba; rangos supuestos; cuadre con meses proyectados | Se resta el vigente de aperturas fijado en la versión; reimportar desactualiza con fuente `planner`; `primer_mes` leído de la cabecera; cuadre hasta el último mes real según `fecha_archivo` (§2.1 f, §5.2, §5.5) |
| H16 | menor | Inmutabilidad de `propuesto` sin trigger; quién copió ajustes; retirar ya aplicada; R24 con `Σ decidido` | Trigger sobre las columnas del motor; `origen = 'traido'` con quien copió; texto al retirar; R24 con `Σ vigente` (§2.1 d, §4.4, §5.2, §5.8) |
| H17 | menor/importante | `GET mesa` sumaba ~14 000 filas en páginas | Función `plan_tienda_resumen` (§2.3) |
| H18 | menor | Pendientes que ya están, numeración, migración, recortes | Σ meses ya en `0.19.1` (C8, §8.3); decisiones desde la 150; migraciones «siguiente libre al construir»; recortados «Sugerir», segunda columna Vector2, gráfico y sondeo a §7.1 |
