# M5 · Carga de venta, costo y stock (histórico mensual)

> Estado: **especificado el 2026-10-11 y revisado el mismo día por el arquitecto (ver "Revisión de diseño (Fable)" al final), pendiente de aprobación de Javier** (`0.8.0 · M5`, migración `0007_venta_stock.sql`). Primer módulo de la Fase 2. Módulos anteriores: [04-tiendas](04-tiendas.md) (la plantilla de importador con reporte previo; M5 usa su código de tienda y su `activo`), [02-marcas](02-marcas.md) (M5 resuelve cada marca contra esa maestra y crea las desconocidas; no cambia `marcas`), [01-arbol-producto](01-arbol-producto.md) (la equivalencia de cada fila se resuelve con las reglas del árbol) y [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) (M6 agrupará esta venta por agrupación de estacionalidad). [01b-responsables](01b-responsables.md) no interviene. Reglas de base en `docs/PLAN.md` y `docs/DECISIONES.md`. Una sola entrega, `0.8.0 · M5`.

## Objetivo

Cargar en Vector2 el histórico mensual de **venta, costo vendido y stock de fin de mes** que Javier exporta de QlikView, de enero de 2023 a septiembre de 2026 (45 meses, del orden de 1,5 millones de filas), con un reporte previo que concilia lo que trae el archivo contra lo que se va a cargar y que dice, agrupado por valor, qué se deja fuera y por qué. Una carga es **un mes completo que reemplaza ese mes**, y un corte a medias nunca deja un mes parcial a la vista.

La marca se guarda **al detalle, tal como viene** (282 en septiembre), con FK a la maestra de M2: cada marca pertenece a uno de los cinco niveles (ULTRA LOW, MID VALUE, VALOR, RECONOCIDO, PREMIUM) y eso es todo lo que hay que saber de ella. No se agrupan marcas dentro de un nivel (Javier lo descartó el 2026-10-11: "sería hacer más completo algo que no se necesita"). Como el detalle se guarda, si algún día hiciera falta agrupar la cola se podría añadir al leer, sin recargar.

**Qué consumen los módulos siguientes de aquí:**

- **M6 (curvas de estacionalidad)**: venta mensual por equivalencia (y por agrupación de estacionalidad) en los 45 meses; tiendas Activas, Cerradas y Planificadas se distinguen con M4. Decidido el 2026-10-06: la curva sale de esta venta real.
- **M7 (proyección anual de unidades)** por género, mundo, línea, equivalencia, agrupación de marca, marca (las cinco principales por equivalencia, que se **derivan de esta venta**: decisión del 2026-10-06, no hay `equivalencia_marca`) y agrupación de talla. Las cinco principales se calculan **ordenando la venta al detalle dentro de cada equivalencia**, sin ninguna bandera ni marca intermedia; la agrupación de marca es la del maestro.
- **CV % = costo ÷ venta neta** se calcula **agregado por línea y mes en M6/M7**, nunca al cargar ni fila a fila: a nivel de fila es muy ruidoso (y con cifras enteras, más). M5 solo guarda `venta_soles` y `costo_vendido` limpios y sumables.
- **Marcas con pronóstico y flujo detallado por línea (M7 y M8)**: requisito de Javier del 2026-10-11. Algunas marcas se pronostican y se compran por separado dentro de su agrupación y línea. Su ejemplo: en la agrupación RECONOCIDO hay que comprar 1.000 jeans, de los cuales 500 son de una marca puntual. La bandera `tratamiento_especial` de `marcas` (M2, definida "para el momento de elaborar los flujos") decide qué marcas llevan su propia línea de pronóstico y flujo; el resto de la agrupación queda como remanente. Qué falta decidir (al especificar M7 y M8, no aquí): si el 500 sale de la participación histórica de la marca dentro de la agrupación y la línea con ajuste del comprador o lo fija el comprador, y si el detalle es por línea o por equivalencia. **M5 no necesita nada adicional**: guarda venta y stock al detalle de marca, por tienda, equivalencia y talla, y de ahí salen la participación histórica de una marca dentro de su agrupación y su línea y su stock, sin ningún campo nuevo.
- **M8 (flujo y necesidad de compra)**: stock de fin de mes por marca, equivalencia, talla y tienda (el CD incluido: es más del 55 % del stock), y con él detectar quiebres a lo largo de toda la historia.

**Una sola entrega, `0.8.0 · M5`**: migración `0007` (las dos tablas, la vista y las tres funciones; `marcas` no cambia), carga de venta y stock con reporte previo y las pestañas **Cargar** y **Cargas por mes**. Con esto Javier carga septiembre como piloto y luego los 45 meses. Hito: piloto, conciliación contra QlikView, reemplazo, corte a medias e histórico completo.

## Decidido con Javier

Respuestas de Javier (2026-10-11) que entran como reglas firmes, no como preguntas:

1. **Las marcas vienen todas, al detalle, y no se agrupan dentro de un nivel.** El archivo trae todas las marcas tal cual y Vector2 las guarda así. Javier consideró agrupar la cola larga dentro de un nivel para tener menos detalle y lo descartó el mismo día: "para las marcas solo hay 5 niveles definidos hoy día. Dentro de uno de los niveles pensaba agrupar marcas para no tener tanto detalle, pero creo que es innecesario… sería hacer más completo algo que no se necesita". Queda: cada marca con su agrupación de M2 (los cinco niveles), sin marca colectiva, sin lista de seguimiento y sin pantalla de marcas sugeridas. Las cinco marcas principales por equivalencia que pide M7 se ordenan directamente por venta.
2. **No hay alias de marcas.** Dos nombres que solo difieren en una palabra (por ejemplo `MARCA A` y `MARCA A PLUS`, o `MARCA B` y `MARCA B DONNA`) son marcas distintas; Javier lo confirmó con dos casos reales. Cada nombre normalizado es una marca distinta; no hay tabla de alias (queda como posible mejora, en "Fuera de alcance").
3. **VARIOS y OTROS van en MID VALUE**: son marcas como cualquier otra (VARIOS pesa ~7 % del stock), con esa agrupación fija aunque al cargar se elija otra por defecto. El guion `-` como marca no lo mencionó: se trata igual (MID VALUE) por defecto, con el nombre `SIN MARCA`; ver pregunta abierta de baja prioridad.
4. **Histórico: enero de 2023 a la fecha**, es decir 2023-01 a 2026-09 (45 meses). Octubre de 2026 no se carga hasta que cierre.
5. **El stock mensual existe para todo el histórico**: "qlik guarda el stock de fin de mes para cada mes". M6 y M7 pueden usar el stock de cada mes para detectar quiebres en toda la historia. El reporte previo conserva una verificación (mes pasado con stock en cero en todas las filas, o idéntico al de otro mes) solo como **red de seguridad** ante un error de exportación.
6. **Formato principal: CSV exportado de QlikView** (un archivo por año o semestre; por mes en el piloto). `.xls` y `.xlsx` quedan soportados como secundarios (sirven para el mes piloto de 32 mil filas). Con CSV desaparece el tope de 65.536 filas del `.xls`.
7. **El CSV real se verificó** (septiembre de 2026): UTF-8 con BOM, separador coma, cabecera en la primera fila, sin separador de miles, sin comillas problemáticas, tildes y Ñ correctas, 32.558 filas (mismas filas y mismo orden que el `.xls`), 2,7 MB por mes (un año ≈ 33 MB; el histórico ≈ 120 MB). Papaparse lo lee sin errores. La detección de codificación y de separador se mantiene como red de seguridad, pero el caso real es UTF-8 con BOM y coma.
8. **Todas las cifras vienen como enteros**, también venta, costo y stock valorizado: QlikView redondeó a soles enteros al exportar (el `.xls` guardaba decimales ocultos). Medido en septiembre contra los valores crudos del `.xls`: unidades y stock en unidades cuadran exactos; venta +0,0008 %, costo +0,016 %, stock valorizado +0,004 % en el total; error máximo por fila 0,50. **Aceptable**: el aviso de cifras enteras es **informativo, nunca bloqueante**. Se recomienda a Javier, de forma opcional, fijar dos decimales en el formato numérico del objeto de QlikView.
9. **El stock valorizado va a costo.**
10. **Los meses atípicos no existen en la carga.** La pregunta de qué meses se tratan como atípicos (por ejemplo el Niño costero de 2023) es de estacionalidad y proyección: M5 carga todos los meses tal cual, sin marcar ni excluir ninguno.
11. **Las marcas desconocidas no bloquean la carga**: se crean solas en la agrupación por defecto que se elige al cargar (propuesta: MID VALUE), con `tratamiento_especial` en falso, y el reporte previo las lista antes de aplicar ("N marcas nuevas, todas quedarán en MID VALUE hasta que las muevas"); Javier las reubica después con el mantenimiento de marcas que ya existe. Ver "Marcas nuevas" en los contratos para los frenos contra marcas basura y la pregunta abierta 3 (si QlikView tiene el nivel de cada marca, mejor cargar primero la lista MARCA, AGRUPACION con el importador de M2).
13. **La agrupación de las marcas se carga antes de la venta.** "Sí, voy a cargar la agrupación de marcas previamente" (2026-10-11): Javier cargará la lista de marcas con su nivel y su tratamiento especial con el importador de M2 (`/maestros/marcas` → Importar, columnas `MARCA`, `AGRUPACION` y `TRATAMIENTO_ESPECIAL`) antes de subir la venta. Con eso las ~280 marcas nacen en su nivel y la alta automática de M5 queda solo como red de seguridad. Cierra la pregunta abierta 3.
14. **Requisito para M7 y M8 registrado**: algunas marcas necesitan pronóstico y flujo detallado por línea (ver "Qué consumen los módulos siguientes"). No añade alcance a M5.
12. De antes: las 3 tiendas del archivo que no existen en el sistema (central y dos oficinas; 13 filas, solo stock) **se excluyen**; la talla `Revisar` se carga como **CENTRALES**; las 57 filas con género, mundo y línea en blanco **se excluyen**; las combinaciones fuera del árbol las agrega Javier con el importador del árbol (**el importador de M5 no crea árbol**); las claves repetidas tras normalizar **se suman** y se avisa.

## Modelo de datos

Migración `supabase/migrations/0007_venta_stock.sql`, idempotente, **sin `DROP`, `DELETE` ni `TRUNCATE`** (ni en el texto de las funciones: se aplica con `execute_sql` y cualquier sentencia destructiva se queda esperando confirmación). RLS activo **sin políticas** en toda tabla nueva. Las funciones y la vista se crean con `create or replace`. El borrado de datos viejos es de tiempo de ejecución (handler), nunca de la migración; por eso la publicación de una carga es un cambio de estado (solo `update`) y no un borrar-e-insertar.

### Cómo se reemplaza un mes sin dejarlo parcial (decisión de diseño central)

Se evaluaron tres caminos:

| Camino | Qué pasa si se corta | Veredicto |
|---|---|---|
| **A. Borrar el mes e insertar el nuevo** | Entre el `delete` y el último `insert` el mes queda vacío o parcial y **visible**; sin transacción en PostgREST no hay forma de evitarlo | Descartado (es lo que "un corte a medias nunca deje un mes parcial visible" prohíbe) |
| **B. Tabla de cargas con estado; filas etiquetadas con `carga_id`; una carga publicada por mes** (elegido) | Las filas de una carga `en_curso` existen pero **nadie las ve**: quien lea solo ve cargas `publicada`. Publicar es un único cambio de estado atómico (función SQL con solo `update`); el corte deja filas huérfanas invisibles que se limpian después | **Elegido** |
| **C. Tabla de paso (staging) y un `insert … select` + `delete` dentro de una función** | Atómico, pero la función tendría que contener `delete` y la migración lo prohíbe | Descartado por la regla de migraciones; además duplica la escritura |
| D. Particiones por mes con intercambio | Exige DDL en tiempo de ejecución (`detach`, `drop`) | Descartado |

Consecuencias del camino B, que el resto de la ficha respeta:

1. **Toda lectura del histórico pasa por la vista `venta_stock_vigente`** (filas de cargas `publicada`). Leer la tabla de hechos directamente cuenta doble los meses recargados. Es una regla probable con un test estático (regla 33).
2. **Un corte nunca deja un mes parcial visible**: o la carga se publicó (todo el mes nuevo) o no (todo el mes viejo sigue ahí).
3. **Una carga que no concilia no se publica**: la función de publicación compara lo que hay en la base contra lo que el cliente dice haber enviado; una tanda perdida o duplicada la detiene.
4. **Idempotencia**: reimportar el mismo mes crea otra carga que reemplaza a la anterior y deja las mismas filas.
5. La limpieza de las filas de cargas reemplazadas, abandonadas o fallidas es un `delete` de handler, fuera de la ruta crítica (si falla, solo quedan huérfanas invisibles y se reintenta).

### `cargas_venta_stock` (una fila por intento de carga de un mes)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `periodo` | `date not null` | primer día del mes; `check (extract(day from periodo) = 1)` |
| `estado` | `text not null default 'en_curso'` | `check (estado in ('en_curso','publicada','reemplazada','retirada','abandonada','fallida'))` |
| `archivo_nombre` | `text null` | `check (archivo_nombre is null or length(archivo_nombre) <= 255)` |
| `perfil_id` | `uuid null` | FK a `perfiles(id)` **`on delete set null`**; índice |
| `usuario_nombre` | `text null` | copia del nombre al cargar, para que el historial sobreviva si se elimina al usuario |
| `filas`, `unidades`, `venta_soles`, `costo_vendido`, `stock_unidades`, `stock_valorizado` | `integer`, `bigint`, `numeric(16,2)`, `numeric(16,2)`, `bigint`, `numeric(16,2)`, todas `null` | los totales **realmente cargados**, calculados por la base al publicar (no los dicta el cliente); `null` mientras no esté publicada |
| `reporte` | `jsonb not null default '{}'` | conciliación declarada por el cliente: totales del archivo, exclusiones por motivo con su peso, avisos, marcas nuevas, `huella_stock`, codificación y separador leídos, totales de QlikView si se escribieron, y `incompleto` con el porcentaje de errores si el mes se cargó forzado (regla 20). Es informativo (auditoría); lo que manda es lo que la base midió. El cliente recorta cada lista a sus 500 primeras entradas por motivo para respetar los 200 KB |
| `publicada_at`, `limpiada_at` | `timestamptz null` | `limpiada_at` marca que las filas huérfanas ya se borraron |
| `created_at`, `updated_at` | `timestamptz not null default now()` | trigger `set_updated_at` con `create or replace trigger`; cada tanda recibida refresca `updated_at` (latido del candado) |

Índices: **`cargas_periodo_publicada_uniq` único parcial sobre `(periodo) where estado = 'publicada'`** (una carga activa por mes: la garantía central); **`cargas_periodo_en_curso_uniq` único parcial sobre `(periodo) where estado = 'en_curso'`** (dos personas no cargan el mismo mes a la vez); `cargas_perfil_id_idx`. Sin `activo`: una carga no se desactiva, cambia de estado. Sin FKs desde `marcas`.

Una carga `en_curso` cuyo `updated_at` tenga más de **30 minutos** se considera caducada: cualquiera puede abandonarla al empezar otra del mismo mes (el candado no se queda trabado por un navegador cerrado). Además, quien abre una carga abandona antes **su propia** `en_curso` del mismo mes aunque no haya caducado: si el usuario cerró la pestaña y vuelve a subir el archivo, no espera 30 minutos (el candado protege contra *otra* persona, no contra uno mismo).

Estados y transiciones válidas: `en_curso → publicada` (función de publicación), `en_curso → abandonada` (cancelación o caducidad), `en_curso → fallida` (no concilió o falló una tanda), `publicada → reemplazada` (la publica otra del mismo mes, en la misma función), `publicada → retirada` (retiro manual de un mes cargado por error). No hay otras.

### `venta_stock_mensual` (tabla de hechos)

Una fila por **carga × tienda × equivalencia × marca × agrupación de talla**. No lleva `periodo`: el mes sale de la carga (no se duplica un dato que podría contradecirse), y cada lectura ya pasa por la vista que une con la carga. Es el grano del archivo (mes, tienda, género, mundo, línea, equivalencia, marca, talla) con género, mundo y línea reemplazados por la equivalencia, de la que se derivan por el árbol.

| Columna | Tipo | Notas |
|---|---|---|
| `carga_id` | `uuid not null` | FK `venta_stock_mensual_carga_id_fkey` → `cargas_venta_stock(id)` `on delete restrict` |
| `tienda_id` | `uuid not null` | FK → `tiendas(id)` `on delete restrict` |
| `equivalencia_id` | `uuid not null` | FK → `equivalencias(id)` `on delete restrict` |
| `marca_id` | `uuid not null` | FK → `marcas(id)` `on delete restrict` |
| `agrupacion_talla_id` | `uuid not null` | FK → `agrupaciones_talla(id)` `on delete restrict` |
| `unidades` | `integer not null default 0` | unidades vendidas; puede ser negativa (devoluciones) |
| `venta_soles` | `numeric(14,2) not null default 0` | **venta neta de IGV**, en soles |
| `costo_vendido` | `numeric(14,2) not null default 0` | costo de lo vendido |
| `stock_unidades` | `integer not null default 0` | stock de fin de mes (`Stk Fin Act`) |
| `stock_valorizado` | `numeric(14,2) not null default 0` | stock a costo (`Stk Val Act`) |

**Clave primaria compuesta** `(carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id)`: es la clave única de los hechos y, con `carga_id` primero, sirve para borrar o contar una carga. **Sin `id`, `activo`, `created_at` ni `updated_at`** (excepción a la convención de PLAN §4, propuesta como decisión nueva): las filas son inmutables, nunca se editan, solo se insertan y se borran en bloque por carga; un `id uuid` más su índice costarían ~70 MB sin usarse. Todas las medidas son `not null default 0` para que `sum()` nunca devuelva `null` y una fila "solo stock" no necesite tratamiento especial.

Por qué **FK a `equivalencia_id` y no copias de género, mundo y línea**: M1 permite mover un nodo de mundo; con copias, cada cambio del árbol dejaría el histórico desfasado (es exactamente lo que falló en Vector-One, donde `agrupacion_marca_id` y las dimensiones vivían duplicadas en cada fila). Con la FK, el histórico **sigue la clasificación vigente del árbol**, lo mismo que hace QlikView con sus campos `_LK`. Si QlikView aplicara la clasificación de cada fecha y no la vigente, ver la pregunta abierta 2.

Por qué **la marca va al detalle con FK a `marcas` y no con su agrupación copiada**: la agrupación (uno de los cinco niveles) se lee del maestro al agregar (`join marcas`, ~500 filas, costo nulo frente al escaneo), de modo que mover una marca de nivel desde `/maestros/marcas` cambia el resultado de M7 sin tocar una sola fila de hechos; en Vector-One `agrupacion_marca_id` vivía copiada en cada fila de `ventas_mensual` y se desfasaba. No hay ninguna otra estructura sobre marcas: ni colectiva, ni lista de seguimiento, ni vista intermedia.

**Índices: la clave primaria más dos índices de lectura.**

| Índice | Columnas | Para qué | Tamaño estimado |
|---|---|---|---|
| `venta_stock_mensual_pkey` | `(carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id)` | unicidad del grano; todo lo que va **por mes** (publicar, contar, limpiar, el stock de un mes para M8) entra por el prefijo `carga_id` y toca solo las ~32 mil filas de esa carga | ≈ 150 MB |
| `venta_stock_mensual_equivalencia_idx` | `(equivalencia_id, carga_id)` | la serie de **una equivalencia** a lo largo de los 45 meses (M6 al revisar una curva, M7 al abrir una equivalencia): ~800 filas por índice en vez de un escaneo de 1,5 millones; también cubre la FK al eliminar una equivalencia | ≈ 75 MB |
| `venta_stock_mensual_marca_idx` | `(marca_id, carga_id)` | la serie de **una marca** (M7 al abrir el detalle de una marca); cubre la FK al eliminar una marca | ≈ 75 MB |

Por qué estos y no los cuatro que marcará el advisor: `agrupacion_talla_id` tiene dos valores (un índice no discrimina nada) y `tienda_id` tiene ~15 (M8 lee el stock de una tienda **por mes**, que ya resuelve el prefijo `carga_id`); sus FK se comprueban al eliminar con un escaneo de la tabla (≈ 0,5 a 2 s en el compute Micro del plan Pro, solo al intentar eliminar una tienda o una agrupación de talla, cosa que además la API rechaza con `409`). Es una excepción parcial al criterio de M3 ("indexar toda FK") justificada con números: cada índice que se evita son ~75 MB y dos índices menos que mantener en cada tanda.

**Lo que ningún índice arregla y M6/M7 deben saber.** Una agregación sobre **toda la historia** (venta por mes × equivalencia, por mes × agrupación de estacionalidad, las cinco marcas por equivalencia) es un escaneo secuencial de 1,5 millones de filas (≈ 235 MB de heap) con un `hash aggregate`: en el compute **Micro** que trae el plan Pro por defecto (2 vCPU compartidos, 1 GB de RAM, disco de red) hay que contar **de 2 a 5 s** por consulta con los datos en caché del sistema operativo y más la primera vez; no es "1 a 2 s". Es aceptable para un cálculo que se lanza una vez (M6 calcula sus curvas y las guarda), no para una pantalla que lo repita en cada clic. Si M6 o M7 necesitan agregados interactivos, la palanca es una tabla de agregados mensual (por ejemplo `(periodo, equivalencia_id, marca_id, agrupacion_talla_id)` sin tienda: ≈ 550 mil filas, ≈ 90 MB) refrescada al publicar una carga (`refresh materialized view` dentro de una función no es `DROP`/`DELETE`/`TRUNCATE`, así que cabe en una migración posterior), o subir el compute a Small (2 GB). Las dos se deciden en ese módulo con la medición del hito de M5 a la vista; M5 no las construye.

### Tiendas del archivo que no son del sistema (sin tabla nueva)

Las tres tiendas del archivo que no existen en el sistema (una central y dos oficinas; 13 filas, solo stock) se ignoran **a propósito** (decisión de Javier). Si no se hace nada, saldrían cada mes como `tienda_desconocida` entre los errores y Javier aprendería a ignorar la lista de errores. La primera versión de esta ficha proponía una tabla `tiendas_excluidas` con un botón "Excluir siempre"; **se descarta**: M4 ya tiene el mecanismo exacto. Javier las crea en `/maestros/tiendas` (con su código real, o uno administrativo) y las **desactiva**: una tienda con `activo = false` es, por definición de M4, "una fila que no debe volver a aparecer", y el resolutor de M5 ya la trata como `tienda_inactiva`, **informativa y con su peso a la vista**, igual que cualquier otra tienda desactivada. Cero estructura nueva, cero endpoints, y la lista de exclusiones vive donde viven las tiendas. Si Javier prefiere no tener esas tres filas en el maestro, la tabla `tiendas_excluidas` (valor normalizado único, nota, tres endpoints y el botón en el reporte) es la alternativa; queda en "Fuera de alcance" y como pregunta abierta 2.

### `marcas`: sin cambios

La migración `0007` **no altera `marcas`**. La primera versión de esta ficha añadía `en_seguimiento`, `es_colectiva`, un `check`, un índice único parcial, la siembra de una marca colectiva y una vista `marca_efectiva`; todo eso se retiró el 2026-10-11 por decisión de Javier (ver "Decidido con Javier", punto 1). Las marcas que el archivo traiga y no existan se crean con la API de M5 (`marcas-nuevas`, más abajo) usando las columnas que `marcas` ya tiene.

### Vista `venta_stock_vigente`

Con **`security_invoker = true`** (Postgres ≥ 15; sin eso, una vista en `public` se lee con los permisos de su dueño y salta el RLS: cualquiera con la clave anónima la consultaría). Con `security_invoker`, `anon` y `authenticated` obtienen **cero filas** (RLS sin políticas), no un error: así hay que escribir la prueba de la regla 34. El `service_role` del backend salta el RLS (`bypassrls`) y las lee completas. Dos notas de implementación verificadas contra el código: (1) `supabase gen types` tipa la vista bajo `Database["public"]["Views"]`, no bajo `Tables<…>`, así que `src/lib/ventas/consultas.ts` declara sus propios alias de fila; (2) no se depende de *embeds* de PostgREST a través de la vista (`select("*, tienda:tiendas(…)")`): toda lectura con nombres de tienda, marca o equivalencia va por función SQL o se completa en Node con los maestros ya cargados.

- **`venta_stock_vigente`**: `cargas_venta_stock.periodo` más todas las columnas de hechos, de las cargas con `estado = 'publicada'`. Es la única puerta de lectura del histórico para M6, M7, M8 y las pantallas. Quien necesite la agrupación de marca hace `join marcas` sobre `marca_id`; quien necesite las cinco principales de una equivalencia ordena por `sum(venta_soles)` dentro de ella.

### Funciones SQL (solo `update` y consultas; `security invoker`, `set search_path = ''`, nombres calificados)

**`revoke execute … from public, anon, authenticated` y `grant execute … to service_role`** en todas: por defecto Supabase deja ejecutables en `rpc` las funciones de `public`, y una función de publicación abierta a la clave anónima sería una puerta trasera.

1. **`publicar_carga_venta_stock(p_carga uuid, p_filas bigint, p_unidades bigint, p_venta numeric, p_costo numeric, p_stock_unidades bigint, p_stock_valorizado numeric) returns jsonb`**. En una sola transacción: bloquea la fila de la carga (`for update`); si no está `en_curso`, devuelve `{ ok: false, motivo: "no_en_curso" }`; mide el conteo y las sumas reales de los hechos de la carga; si **no coinciden exactamente** con lo esperado, devuelve `{ ok: false, motivo: "no_concilia", esperado, medido }` **sin cambiar nada**; si coinciden: pasa la carga `publicada` anterior del mismo periodo (si hay) a `reemplazada`, pasa esta a `publicada` con sus totales medidos y `publicada_at`, y devuelve `{ ok: true, medido, reemplaza: { id, filas } | null }`. El orden de los dos `update` (primero la vieja) es lo que respeta el único parcial. Nunca borra.
2. **`totales_cargas_publicadas() returns table (carga_id uuid, periodo date, filas bigint, unidades bigint, venta_soles numeric, costo_vendido numeric, stock_unidades bigint, stock_valorizado numeric)`**: recalcula desde los hechos los totales de cada carga `publicada` (un escaneo con `group by carga_id`, ≈ 1 a 3 s). Lo usa `GET /api/ventas/cargas?verificar=1` para marcar los meses cuyos totales guardados difieran de los medidos (alguien tocó la base a mano).
3. **`cargas_pendientes_limpieza() returns table (carga_id uuid, estado text, filas bigint)`**: las cargas en estado terminal (`reemplazada`, `retirada`, `abandonada`, `fallida`) que **todavía tienen filas**, con su conteo; cada conteo es un `select count(*) … where carga_id = …` por el prefijo de la clave primaria (instantáneo cuando la carga ya está vacía). Es la fuente de verdad de la limpieza: `limpiada_at` es solo informativa, de modo que una fila huérfana que entrara por una carrera (una tanda que aterriza justo después de abandonar la carga) no se queda invisible para siempre.

**Regla de oro**: ninguna lectura del histórico trae filas a Node. Todo lo que agrega (totales por mes, verificación, limpieza pendiente, y en M6/M7 las curvas y los rankings) se hace en SQL. **Ojo para M6/M7**: el tope de 1 000 filas de PostgREST también aplica a `rpc()` que devuelve `table`, así que una función que devuelva más se lee con `leerTodo` sobre `db.rpc(…).order(…).range(d, h)` (PostgREST acepta `Range` en funciones `setof`) o devuelve `jsonb`. Paginar 1,5 millones de filas con `leerTodo` son 1 500 llamadas y es justo lo que no se debe hacer (Vector-One leía `ventas_mensual` entera desde Node para la estacionalidad). **Tiempo máximo por sentencia**: Supabase fija `statement_timeout` por rol (3 s para `anon`, 8 s para `authenticated`; para `service_role` hay que comprobarlo en el piloto con `show statement_timeout` desde el backend). Todo lo de M5 queda muy por debajo (una tanda de 2 000 filas, publicar, limpiar una carga: décimas de segundo); las agregaciones completas de M6/M7 (2 a 5 s en Micro) son las que deben medirse con ese límite delante.

### Volumen y espacio

Septiembre de 2026 es el mes de referencia: 32.558 filas (11 tiendas, 282 marcas). Un año ≈ 400 mil filas; el histórico de 45 meses ≈ **1,5 millones**.

| Concepto | Por fila | Para 1,5 M filas |
|---|---|---|
| Heap (cabecera 24 B, 5 uuid = 80 B, 2 enteros = 8 B, 3 `numeric` ≈ 24 B, puntero 4 B) | ≈ 140 B | ≈ 235 MB |
| Clave primaria (5 uuid = 80 B + 8 B de cabecera + 4 B de puntero, relleno al 90 %) | ≈ 100 B | ≈ 150 MB |
| Índice `(equivalencia_id, carga_id)` (32 B + 12 B, relleno al 90 %) | ≈ 49 B | ≈ 75 MB |
| Índice `(marca_id, carga_id)` | ≈ 49 B | ≈ 75 MB |
| **Total de la tabla de hechos con sus índices** | | **≈ 535 MB** (rango 480 a 600 MB) |
| Un mes (32.558 filas, con índices) | | ≈ 12 MB |
| Mes recargado (hasta que se limpia la carga vieja) | | +12 MB transitorios (y el espacio de las filas borradas lo recupera `autovacuum`) |

**El proyecto `vector-two` está en el plan Pro** (verificado el 2026-10-11 con la API de la organización: 8 GB de base incluidos, 12 MB usados hoy), así que la pregunta del espacio está cerrada: los ≈ 535 MB caben siete veces y queda sitio para M6 a M8. Se conserva la convención de `uuid` en todas las FK por simplicidad y coherencia con el resto del modelo. Las dos palancas de compactación que se evaluaron (`carga_id` como `integer` identity, −36 MB; `agrupacion_talla_id` como `smallint`, −42 MB) **no se aplican**: ahorrarían un 15 % a cambio de una tabla que no se parece a ninguna otra del sistema y de un `agrupaciones_talla` con dos claves. Lo que sí importa con Pro es el **compute**: el Micro por defecto (1 GB de RAM) es el que fija los 2 a 5 s de las agregaciones completas, no el disco.

## Contratos de API

Todos devuelven `{ data }` con `ok()` o `{ error }` con `error()` de `src/lib/api/respuestas.ts`; cuerpos con `leerCuerpo` y esquemas zod en `src/lib/ventas/esquemas.ts`; ids de ruta con `idDeRuta`; errores de base con `traducirErrorDb`. Errores comunes: `401` sin sesión · `403` sin perfil, inactivo o rol insuficiente · `400` zod · `404` id inexistente o no UUID · `409` regla de negocio, único o FK · `500` genérico. **Todas las rutas de M5, lecturas incluidas, exigen `requirePlanner`.** Es distinto de M1 a M4 (lecturas `requireUser`) a propósito: venta y, sobre todo, **costo** son los datos más sensibles del sistema (de ellos sale el margen), el comprador no ve la pantalla, y en M1b se decidió que "los compradores ven todo" hablando de maestros, no de cifras. Abrir alguna lectura al comprador es una decisión de M8 (el documento para compradores dirá qué cifras lleva) y queda como pregunta abierta 4. Los handlers de M5 viven en `src/app/api/ventas/`. **Límites de cuerpo verificados**: los route handlers de Next 16 no imponen tope propio (el 1 MB por defecto es solo de Server Actions, `serverActions.bodySizeLimit`); el límite de 10 MB `experimental.proxyClientMaxBodySize` se aplica únicamente al clonar el cuerpo para `proxy.ts` (`getCloneableBody` en `next-server.js`), y `proxy.ts` excluye `/api` de su `matcher`; Railway no documenta un tope de cuerpo. Con 400 KB por tanda se está muy por debajo de cualquier límite habitual (1 MB de nginx por defecto), y si un proxy intermedio cortara, el síntoma sería un `413` reproducible en el piloto con el mes de septiembre.

Constantes (en `src/lib/ventas/tipos.ts`): `TANDA_CLIENTE = 10_000` filas por petición del navegador al servidor (≈ 400 KB); `TANDA_INSERT_VENTAS = 2_000` filas por `insert` hacia PostgREST (≈ 460 KB; si en el piloto falla, bajar a 500, que es el `TANDA` ya conocido); **`TANDA_IN = 150`** para todo filtro `.in(...)` (500 ids por URL ya falló en M3); `REINTENTOS_TANDA = 3` (una tanda es idempotente y se reintenta antes de descartar el mes); `CADUCIDAD_CARGA_MIN = 30`; `UMBRAL_BLOQUEO_ERRORES = 0.02`; `INICIO_HISTORICO = "2023-01"`. Ninguna escritura de hechos hace `.select()` después del `insert`: Vector-One devolvía las filas insertadas con sus joins y reventaba con lotes grandes.

### Estructura del archivo

El cliente acepta tal cual las columnas de QlikView y la forma canónica. Las cabeceras se comparan con `aCodigo` (sin acentos ni caja; `AÑO` → `ANO`, `Vta S/` → `VTA_S`), con la misma `detectarMapeo` de `src/components/importador/mapeo.ts`.

| Campo | Obligatorio | QlikView (y su `aCodigo`, que es lo que va en `alias`) | Canónica y otros alias |
|---|---|---|---|
| `anio` | no (sin él, `mes` trae el año) | `AÑO` → `ANO` | `ANIO`, `YEAR` |
| `mes` | sí | `MES` → `MES` | `PERIODO`, `FECHA` |
| `tienda` | sí | `TIENDA` → `TIENDA` | `LOCAL`, `COD_TDA`, `CODIGO_TIENDA` |
| `genero` | sí | `GENERO_LK` → `GENERO_LK` | `GENERO` |
| `mundo` | sí | `MUNDO_LK` → `MUNDO_LK` | `MUNDO`, `GRUPO_PRODUCTO` |
| `linea` | sí | `LINEA_SAP_LK` → `LINEA_SAP_LK` | `LINEA` |
| `equivalencia` | sí | `EQUIVALENCIAS_LK` → `EQUIVALENCIAS_LK` | `EQUIVALENCIA` |
| `marca` | sí | `MARCA` → `MARCA` | — |
| `talla` | sí | `TALLA_e` → `TALLA_E` | `TALLA`, `AGRUPACION_TALLA` |
| `unidades` | sí | `Unv vta` → `UNV_VTA` | `UNIDADES` |
| `venta_soles` | sí | `Vta S/` → `VTA_S` | `VENTA_SOLES`, `VENTA` |
| `costo_vendido` | sí | `Costo Vta` → `COSTO_VTA` | `COSTO_VENDIDO`, `COSTO` |
| `stock_unidades` | sí | `Stk Fin Act` → `STK_FIN_ACT` | `STOCK_UNIDADES`, `STOCK` |
| `stock_valorizado` | sí | `Stk Val Act` → `STK_VAL_ACT` | `STOCK_VALORIZADO` |

`detectarMapeo` compara `aCodigo(columna) === alias`, así que la lista `alias` de cada campo lleva **los códigos** de la tercera y la cuarta columna (no los nombres con espacios). El BOM no estorba: `transformHeader` hace `trim()` (que quita `\uFEFF`) y `aCodigo` descarta lo que no sea letra o dígito.

**Mes.** Con `anio` mapeado: `anio` de cuatro cifras (2000 a 2100, también numérico `2026`) y `mes` como abreviatura o nombre en español sin distinguir caja ni acentos (`ene, feb, mar, abr, may, jun, jul, ago, set, sep, sept, oct, nov, dic` y los meses completos, con `setiembre` y `septiembre`) o número 1 a 12 (`9`, `09`). Sin `anio`: `aaaa-mm`, `aaaa/mm`, `mm/aaaa`, una fecha ISO `aaaa-mm-dd` (ya convertida por el lector desde las fechas de Excel) o `dd/mm/aaaa` (día primero, como en M4); el día se ignora y las fechas con día distinto de 1 se cuentan en una nota. Cualquier otra cosa: `mes_invalido`.

**Tienda.** Por nombre normalizado (el caso real) y, si no, por código (`aCodigo`). Nombre primero porque es lo que trae QlikView; un valor que coincida con una tienda por nombre y con otra por código no existe en la práctica y se resuelve a favor del nombre (test).

**Equivalencia.** Con las funciones del árbol, sin reescribirlas (DECISIONES 2026-10-05): vacío o `SIN EQUIVALENCIA` (`esEquivalenciaGenerica`) → la genérica del nodo; `-` (`esEquivalenciaIgualALinea`) → la equivalencia que se llama como la línea; otro valor → esa equivalencia. El cliente sustituye `-` por el nombre normalizado de la línea antes de agrupar, de modo que `-` y el nombre literal sean la misma clave.

**Talla.** `Central` → CENTRALES; `Extrema` → EXTREMAS; **`Revisar` → CENTRALES con aviso** (cuántas filas y qué peso: en septiembre ~6 % de las filas y ~15 % de la venta, sobre todo denim, pantalón, bermuda y falda); `-` suelto y vacío se tratan como `Revisar`. Cualquier otro valor: `talla_desconocida`. El mapeo es una constante (`MAPEO_TALLA`) fácil de cambiar. No se guarda la talla original: como la unidad de carga es el mes, si Javier decide después repartir `Revisar` de otro modo, recarga los meses y listo.

**Marca.** Normalizada con `normalizarNombre`. Vacía o `-` → la marca **`SIN MARCA`** (código `SIN_MARCA`): `aCodigo("-")` queda vacío y la marca se llamaría `MARCA`; `SIN MARCA` es legible y se trata como `VARIOS` y `OTROS` (ver abajo). Una marca existente y activa se usa tal cual; una existente **desactivada** deja la fila fuera con `marca_inactiva` (informativa y con su peso, el mismo criterio que una tienda desactivada en M4: desactivar es "no debe volver a aparecer"); una desconocida se **crea sola en la agrupación por defecto elegida al cargar** (ver "Marcas nuevas", más abajo).

**Números.** Punto decimal; la coma de miles se tolera solo en grupos de tres (`7,913` y `1,234,567.50` valen); `-` delante o paréntesis para negativos; notación científica tolerada. **Coma decimal no se adivina**: `12,5` o `1.234,56` son `numero_invalido` (agrupado por valor), y si más del 1 % de las celdas numéricas tienen forma de coma decimal el reporte emite un diagnóstico global bloqueante "el archivo parece usar coma decimal; exporta de nuevo con punto decimal". Al guardar: unidades y stock en unidades **enteros** (un decimal real se redondea y se cuenta en un aviso), venta, costo y stock valorizado **redondeados a 2 decimales** (mitad hacia afuera de cero, con tolerancia al ruido de coma flotante: `205.70999999999998` → `205.71`, nunca `-0`). Con las cifras enteras del CSV real el redondeo no hace nada, pero queda correcto si algún día llegan decimales.

**Filas que no son datos.** Una fila con `TOTAL` en tienda, marca o género es `fila_total` (informativa, y fundamental excluirla: contaría doble). Una fila con las cinco medidas en cero tras redondear es `fila_en_cero` (no se guarda: no hay ninguna en septiembre, y cargarlas solo gastaría espacio).

### Cómo exportar de QlikView (instrucciones para Javier)

1. Un objeto tipo **tabla simple** con las 14 columnas (`AÑO`, `MES`, `TIENDA`, `GENERO_LK`, `MUNDO_LK`, `LINEA_SAP_LK`, `EQUIVALENCIAS_LK`, `MARCA`, `TALLA_e`, `Stk Fin Act`, `Unv vta`, `Vta S/`, `Costo Vta`, `Stk Val Act`), **sin fila de totales**, con todas las marcas (sin agrupar).
2. Exportar como **CSV con cabecera** (delimitado por comas). Si el diálogo deja elegir la codificación, **UTF-8** (con BOM sirve: es lo que sale hoy). Probado con el de septiembre de 2026.
3. Números **sin separador de miles**, con **punto decimal**. Hoy salen como enteros (soles enteros) y es aceptable: el error máximo por fila es S/ 0,50 y en los totales de septiembre quedó por debajo del 0,02 %. Opcional: fijar **dos decimales** en el formato numérico del objeto (pestaña Número) para que venta, costo y stock valorizado lleguen con céntimos.
4. **Un archivo por año o semestre** (un año son ~400 mil filas y ~33 MB). Por mes solo para el piloto. Evitar archivos de varios años: el reporte funciona, pero un error cuesta más volver a subirlo.
5. **Meses cerrados**: de enero de 2023 a septiembre de 2026; octubre se carga cuando cierre. Un mes que esté abierto se puede subir, pero pide confirmación porque su venta está incompleta.
6. Apuntar los **totales de QlikView** de cada mes (unidades, venta, costo, stock en unidades y stock valorizado): la pantalla los pide, opcionalmente, para conciliar.

### Lectura del archivo en el navegador (sin cargar todo en memoria)

El archivo **nunca se sube entero al servidor**: se lee en el navegador, por bloques, y solo se envían tandas ya interpretadas. Para el CSV de un año (33 MB) y para el histórico completo (120 MB):

1. **Codificación.** Pre-escaneo del archivo con `TextDecoder("utf-8", { fatal: true })` en trozos (0,3 s para 33 MB); si falla, se lee como Windows-1252. Se muestra la detectada ("UTF-8 con BOM") y se permite cambiarla. El BOM se tolera (papaparse lo quita; test con cabecera con BOM). Una `Ñ` mal decodificada (`NIÃ‘AS`) rompería la coincidencia con tiendas y géneros: por eso la comprobación se hace **antes** de leer.
2. **Separador.** Autodetección de papaparse entre coma, punto y coma, tabulador y barra vertical; selector para corregirlo. Real: coma.
3. **Cabecera y mapeo.** Primero se lee solo la cabecera y las primeras filas (`preview`) para autodetectar el mapeo, que el usuario confirma. Si falta una columna obligatoria, no se avanza.
4. **Lectura en streaming** con `Papa.parse(archivo, { header: true, chunk, worker: true, … })` (fallback sin `worker`): cada bloque (~2 MB) se interpreta fila a fila y se acumula; el progreso sale de `results.meta.cursor` entre el tamaño del archivo; entre bloques se cede el hilo para que la barra se mueva. Las filas crudas **no** se conservan.
5. **Acumulador columnar con diccionarios.** Cada valor distinto de tienda, combinación (género, mundo, línea, equivalencia) y marca se guarda una sola vez y la fila se reduce a índices enteros más sus cinco medidas (arreglos tipados): ≈ 60 B por fila, es decir ~25 MB para un año y ~90 MB para los 1,5 millones, frente a cientos de MB con un objeto por fila. La clave de la fila (`periodo`, `tienda`, `combinación`, `marca`, `talla`) se empaqueta en un entero seguro de 53 bits para detectar y **sumar** las repetidas. Al terminar el archivo quedan en memoria el acumulador y los diccionarios (unas decenas de miles de entradas).
6. **Qué valida la previsualización**: no millones de filas, sino **valores y combinaciones distintas**: ~15 tiendas, ~300 marcas y unas cinco mil combinaciones (género, mundo, línea, equivalencia). Eso viaja al servidor (menos de 1 MB) y el servidor responde cómo se resuelve cada valor. Con esas respuestas el navegador recorre su acumulador y arma el reporte completo (qué se excluye por motivo y cuánto pesa, avisos, conciliación), sin volver a leer el archivo.
7. **Excel (secundario).** `.xls` y `.xlsx` no se pueden leer en streaming: SheetJS carga el libro completo. Se aceptan hasta **150 000 filas** (el mes piloto de 32 mil entra de sobra); por encima, el mensaje es "usa CSV". Una hoja de exactamente 65 536 filas (`.xls`) lanza el aviso `archivo_posiblemente_truncado`. Para Excel se leen los **valores numéricos crudos** (ver "Cambios en el lector").

### División del trabajo entre navegador y servidor

| Paso | Dónde | Qué |
|---|---|---|
| Leer, interpretar, acumular, sumar repetidas | navegador | Funciones puras de `src/lib/ventas/` |
| Resolver valores distintos contra el maestro (tienda, combinación, marca, estado de cada mes) | servidor (`previsualizar`) | Mismas funciones puras con el estado de la base |
| Reporte completo, conciliación, avisos | navegador | Sobre el acumulador y las resoluciones |
| Crear marcas nuevas | servidor (`marcas-nuevas`), una vez por archivo | Idempotente |
| Abrir la carga de un mes, recibir tandas, publicar | servidor | La base mide y concilia; el servidor nunca confía en los totales del cliente para guardar nada |
| Reemplazo atómico del mes | base de datos | `publicar_carga_venta_stock` |

La **interpretación de negocio ocurre una sola vez**, en la previsualización y con el mismo código puro en navegador y servidor. Las tandas llevan ids ya resueltos y no se reinterpretan: la clave foránea garantiza que existen y la publicación garantiza que concilian. La ventana en la que un maestro pueda cambiar entre previsualizar y cargar es de minutos y el reporte guarda cuándo se resolvió. Se descartó reenviar texto y resolverlo en cada tanda: obligaba a releer el árbol, las tiendas y las marcas ~150 veces solo para repetir una decisión ya tomada.

### `POST /api/ventas/previsualizar` · `requirePlanner`

No escribe nada. Recibe solo los valores distintos y devuelve cómo se resuelve cada uno.

```ts
previsualizarSchema = z.object({
  tiendas: z.array(z.string().max(200)).max(500),                       // valores normalizados, sin repetir
  combinaciones: z.array(z.object({ genero: z.string(), mundo: z.string(), linea: z.string(), equivalencia: z.string() })).max(20_000),
  marcas: z.array(z.string().max(200)).max(5_000),                      // ya con SIN MARCA aplicado
  periodos: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).max(120),
});
```

```jsonc
{ "data": {
  "hoy": "2026-10-11", "mes_actual": "2026-10",
  "tiendas": [
    { "valor": "LUKERS EJEMPLO UNO", "resultado": "ok", "id": "…", "codigo": "R101", "tipo": "Tienda", "fecha_apertura": "2019-03-15", "fecha_cierre": null },
    { "valor": "OFICINA CENTRAL EJEMPLO", "resultado": "excluida", "nota": "Central, no es tienda" },
    { "valor": "CD EJEMPLO", "resultado": "ok", "id": "…", "codigo": "RD50", "tipo": "Centro de Distribución", "fecha_apertura": null, "fecha_cierre": null },
    { "valor": "LOCAL DESCONOCIDO", "resultado": "desconocida" }        // o "inactiva"
  ],
  "combinaciones": [                                                    // misma posición que la petición
    { "resultado": "ok", "equivalencia_id": "…" },
    { "resultado": "equivalencia_inexistente" },                         // genero_desconocido | mundo_desconocido | linea_desconocida | nodo_inexistente
    { "resultado": "nodo_inactivo" }                                     // genero_inactivo | mundo_inactivo | linea_inactiva | nodo_inactivo | equivalencia_inactiva
  ],
  "marcas": [
    { "resultado": "existe", "id": "…", "agrupacion_marca_id": "…" },
    { "resultado": "nueva", "comodin": false },
    { "resultado": "inactiva", "id": "…" }
  ],
  "agrupaciones_talla": { "CENTRALES": "…", "EXTREMAS": "…" },
  "agrupaciones_marca": [ { "id": "…", "codigo": "MID_VALUE", "nombre": "MID VALUE" } ],
  "agrupacion_defecto_id": "…",                                          // MID VALUE si existe y está activa
  "periodos": [
    { "periodo": "2026-09",
      "publicada": { "id": "…", "publicada_at": "2026-10-09T15:02:11Z", "filas": 32558, "unidades": 0, "venta_soles": 0, "costo_vendido": 0, "stock_unidades": 0, "stock_valorizado": 0, "usuario_nombre": "Javier" },
      "en_curso": null }
  ],
  "anterior": { "periodo": "2026-08", "filas": 0, "venta_soles": 0, "stock_valorizado": 0 },
  "huellas_stock": [ { "periodo": "2026-08", "filas_con_stock": 0, "stock_unidades": 0, "stock_valorizado": 0 } ]
} }
```

Errores: `400` zod. `en_curso` trae quién y desde cuándo. `anterior` es la carga publicada del mes inmediatamente anterior al primer periodo del archivo (para la comparación de sanidad). `huellas_stock` son las de todos los meses ya publicados (para detectar stock idéntico). La resolución de combinaciones usa el mismo orden de decisiones que el importador del árbol (género → mundo → línea → nodo → equivalencia, genérica por bandera).

### `POST /api/ventas/marcas-nuevas` · `requirePlanner` (marcas nuevas)

Se llama una vez por archivo, **solo después de que el usuario confirme el reporte previo** y antes de abrir ninguna carga, si hay marcas nuevas.

```ts
marcasNuevasSchema = z.object({ nombres: z.array(z.string().min(1).max(120)).min(1).max(5_000), agrupacion_marca_id: z.uuid() });
```

Crea cada marca que no exista con `tratamiento_especial = false`, la agrupación elegida y el código `codigoUnico(aCodigo(nombre), usados, "MARCA")` (el de M2). **`VARIOS`, `OTROS` y `SIN MARCA` van siempre a `MID VALUE`**, sea cual sea la agrupación elegida: así Javier no da de alta cientos de marcas a mano ni se acuerda de los comodines. Inserta con `upsert(… { onConflict: "nombre", ignoreDuplicates: true })` en tandas de 500 (seguro ante una carrera con otro usuario) y devuelve los ids leyendo `marcas` con `leerTodo`, sin ningún `.in` de nombres.

```jsonc
{ "data": { "creadas": 270, "existentes": 12, "ids": { "MARCA EJEMPLO": "…" }, "comodines_en_mid_value": ["VARIOS", "OTROS", "SIN MARCA"] } }
```

Errores: `404` agrupación inexistente; `409` agrupación inactiva, o `MID VALUE` inexistente o inactiva cuando entra un comodín ("Crea o reactiva MID VALUE: VARIOS, OTROS y SIN MARCA van ahí"); `409` si un `23505` de código no se resolvió tras un reintento. Efecto colateral aceptado: si el usuario cancela después, las marcas ya existen; son inofensivas (quedan en la agrupación por defecto sin histórico) y se eliminan o se mueven desde `/maestros/marcas` (eliminar sigue permitido mientras no tengan hechos).

**Alta automática frente a exigir que existan: por qué se mantiene, y con qué frenos.** Exigir que las ~280 marcas existan antes (como hace el árbol con géneros y mundos) obligaría a Javier a dar de alta a mano, o por el importador de M2, cada marca nueva que aparezca en cualquiera de los 45 meses antes de poder cargarlo, y las marcas no son un catálogo raíz de admin sino un maestro del planner (el mismo criterio con el que el importador de M3 crea agrupaciones de estacionalidad). El riesgo real es el inverso: un **error de tipeo en QlikView** (`MARCA A` y `MARCA  A` se funden al normalizar, pero `MARCA A` y `MARCAA` no) crearía una marca basura con una o dos filas, y como no hay alias (decisión de Javier) nadie la fusionaría después. Frenos:

1. El reporte previo muestra **todas las marcas nuevas antes de aplicar**, en una tabla ordenada por venta con filas, venta y stock de cada una, los comodines marcados, el selector de la agrupación por defecto y el texto "N marcas nuevas: todas quedarán en MID VALUE hasta que las muevas desde Agrupaciones y marcas"; la lista se descarga en CSV con las columnas `MARCA, AGRUPACION` (la agrupación por defecto ya puesta) para completarla en Excel y subirla al importador de M2 **antes** de cargar la venta, si Javier prefiere clasificar primero.
2. Las marcas nuevas con **una o dos filas en todo el archivo** y venta mínima se resaltan como "posible error de tipeo" (`posible_tipeo`), con el nombre más parecido entre las existentes (misma `aCodigo` o distancia de una letra) si lo hay, para que Javier corrija el archivo y vuelva a previsualizar.
3. La carga se puede **cancelar** en ese punto sin haber creado nada: `marcas-nuevas` solo se llama tras confirmar.
4. Si QlikView tiene el nivel (1 a 5) de cada marca, lo mejor es exportar una lista `MARCA, AGRUPACION` y cargarla con el importador de M2 que ya existe antes de la venta: entonces el alta automática queda solo como red de seguridad para marcas que aparezcan después (pregunta abierta 3).

El importador de M2 **no actualiza** existentes (decisión del 2026-10-05): si el histórico entra primero y la lista de M2 después, las marcas ya creadas en MID VALUE salen en `diferencias` y se mueven desde la pantalla o con el modo "actualizar" que M2 dejó como pregunta abierta 4. Por eso el hito pide la lista antes del piloto.

### `POST /api/ventas/cargas` · `requirePlanner` (abre la carga de un mes)

```ts
abrirCargaSchema = z.object({
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  archivo_nombre: z.string().max(255),
  archivo: medidasSchema,                    // { filas, unidades, venta_soles, costo_vendido, stock_unidades, stock_valorizado } de TODO el mes del archivo
  reporte: z.record(z.string(), z.unknown()),// informe del cliente; ≤ 200 KB serializado
  reemplazar: z.boolean().default(false),    // confirma reemplazar un mes ya publicado
  mes_abierto: z.boolean().default(false),   // confirma cargar un mes que no ha cerrado
  forzar_incompleto: z.boolean().default(false), // confirma cargar un mes bloqueado por errores ≥ 2 % (regla 20); queda marcado "Incompleto"
});
```

Pasos: (1) pasa a `abandonada` las cargas `en_curso` de ese periodo que hayan caducado (más de 30 minutos) **o que sean del mismo usuario**; (2) si hay una `publicada` y `reemplazar` es `false`: `409 mes_ya_cargado`; (3) si el periodo no es anterior al mes actual (Lima) y `mes_abierto` es `false`: `409 mes_abierto`; (4) inserta la carga `en_curso` con el nombre del usuario; si el único parcial dice que ya hay una vigente: `409 carga_en_curso` ("Carga en curso de ese mes por Ana desde las 10:42"). Respuesta `201`: `{ carga, reemplaza }`.

### `POST /api/ventas/cargas/[id]/filas` · `requirePlanner` (una tanda)

```ts
tandaSchema = z.object({
  tanda: z.number().int().min(1),
  diccionario: z.object({ tiendas: z.array(z.uuid()), equivalencias: z.array(z.uuid()), marcas: z.array(z.uuid()) }),   // ≤ 10 000 cada uno
  filas: z.array(z.tuple([
    z.number().int().min(0),    // índice en diccionario.tiendas
    z.number().int().min(0),    // índice en diccionario.equivalencias
    z.number().int().min(0),    // índice en diccionario.marcas
    z.union([z.literal(0), z.literal(1)]),   // 0 = CENTRALES, 1 = EXTREMAS
    z.number().int(),           // unidades
    z.number(),                 // venta_soles
    z.number(),                 // costo_vendido
    z.number().int(),           // stock_unidades
    z.number(),                 // stock_valorizado
  ])).min(1).max(10_000),
});
```

Filas posicionales y ids por diccionario (≈ 40 B por fila, no 330): una tanda de 10 mil filas pesa ~400 KB. El servidor valida que cada índice caiga dentro de su diccionario, que los números sean finitos y entren en `numeric(14,2)` / `integer`, redondea a 2 decimales por seguridad, arma las filas con la `agrupacion_talla_id` de CENTRALES o EXTREMAS (leída del catálogo) y las escribe con `upsert(filas, { onConflict: "carga_id,tienda_id,equivalencia_id,marca_id,agrupacion_talla_id", ignoreDuplicates: true })` en trozos de `TANDA_INSERT_VENTAS`, sin `select` (la clave primaria es sobre columnas, no expresiones, así que PostgREST lo admite, como el `upsert` de M2). Así **una tanda es idempotente**: si el navegador perdió la respuesta y la reenvía, no duplica ni falla; la publicación sigue siendo quien detecta una tanda perdida. Refresca `updated_at` de la carga (latido). **No se reinterpreta nada de negocio.** Respuesta: `{ tanda, recibidas }` (el conteo de insertadas lo da la base al publicar; `ignoreDuplicates` no lo informa).

Errores: `404` carga inexistente; `409` si la carga no está `en_curso` o caducó; `400` índices o números inválidos. Una tanda que falla por red o con `5xx` se **reintenta hasta `REINTENTOS_TANDA` veces** (es idempotente); si sigue fallando, o ante un `400`/`404`/`409`, el cliente descarta la carga (`DELETE`) y reinicia el mes: un mes son de 4 a 40 tandas (≈ 15 s a 2 min) y un libro de tandas reanudables no compensa. Dos filas que resuelvan a la misma clave dentro de una tanda no pueden ocurrir (el cliente suma antes de enviar) y, si ocurrieran por un error del cliente, `ignoreDuplicates` se quedaría con la primera y la publicación fallaría por `no_concilia`, que es el comportamiento correcto.

### `POST /api/ventas/cargas/[id]/publicar` · `requirePlanner`

```ts
publicarSchema = z.object({ esperado: medidasSchema });   // lo que el cliente envió en las tandas de este mes
```

Llama a `publicar_carga_venta_stock`. `200`: `{ carga, medido, reemplaza }` (la carga ya `publicada`, con totales medidos por la base). Si devuelve `no_concilia`: marca la carga `fallida`, deja el mes anterior intacto y responde `409` con `{ esperado, medido, diferencias }` ("faltan 2 000 filas: se perdió una tanda"). `409` si no estaba `en_curso`.

### `DELETE /api/ventas/cargas/[id]` · `requirePlanner`

`en_curso` → `abandonada`; `publicada` → `retirada` (el mes deja de verse; las filas se limpian después). `200 { id, estado }`; `409` en cualquier otro estado.

### `POST /api/ventas/cargas/limpiar` · `requirePlanner`

Lee `cargas_pendientes_limpieza()` (las cargas en estado terminal que todavía tienen filas) y, para cada una, hace **un** `delete … eq("carga_id", id)`: entra por el prefijo de la clave primaria y borra las ~32 mil filas de un mes en décimas de segundo, muy por debajo de cualquier `statement_timeout`; solo si el piloto midiera lo contrario se partiría por tienda. Luego marca `limpiada_at`. Nunca toca cargas `publicada` ni `en_curso` (la función no las devuelve), es idempotente (una carga ya vacía no aparece) y se puede repetir a voluntad. Lo llama el cliente al terminar de publicar y se ejecuta también al abrir una carga. Respuesta `{ cargas_limpiadas, filas_borradas, pendientes }`. Si falla, solo quedan filas huérfanas e invisibles que la siguiente pasada recoge.

### `GET /api/ventas/cargas` · `requirePlanner`

```jsonc
{ "data": {
  "meta": { "desde": "2023-01", "hasta": "2026-09", "meses_esperados": 45, "meses_cargados": 1, "faltantes": ["2023-01", "…"] },
  "meses": [
    { "periodo": "2026-09", "estado": "cargado",
      "carga": { "id": "…", "archivo_nombre": "ventas_2026.csv", "usuario_nombre": "Javier", "publicada_at": "2026-10-09T15:02:11Z",
                 "filas": 32558, "unidades": 0, "venta_soles": 0, "costo_vendido": 0, "stock_unidades": 0, "stock_valorizado": 0 } },
    { "periodo": "2026-08", "estado": "sin_cargar", "carga": null }       // "en_curso" con quién y desde cuándo
  ],
  "limpieza_pendiente": 0
} }
```

`hasta` es el último mes cerrado según la fecha de Lima. Los totales salen de `cargas_venta_stock`, no de agregar hechos; cada mes trae además `incompleto` (y el porcentaje) si se cargó forzado con errores ≥ 2 %. `limpieza_pendiente` sale de `cargas_pendientes_limpieza()`. Una acción de verificación (`?verificar=1`) llama a `totales_cargas_publicadas()` y marca los meses cuyos totales guardados difieran de los medidos (por si alguien tocó la base a mano).

### Tiendas que no deben cargarse

No hay API propia: se crean y desactivan desde `/maestros/tiendas` (M4) y el resolutor las devuelve como `tienda_inactiva`. Ver "Tiendas del archivo que no son del sistema" en el modelo de datos.

### Cambios en la API de M2 y M4 (eliminar con histórico)

- Eliminar una marca, tienda, equivalencia o agrupación de talla con hechos cargados responde `409` por la FK: `errores-db.ts` suma `venta_stock_mensual_marca_id_fkey`, `…_tienda_id_fkey`, `…_equivalencia_id_fkey` y `…_agrupacion_talla_id_fkey` ("No se puede eliminar: tiene venta o stock cargados. Desactívala."; la rama `asignar` responde `404` "Marca/Tienda/Equivalencia no encontrada.", como las FK de M2 y M3), y los handlers `DELETE` de marcas (`src/app/api/marcas/[id]`, que hoy pasa `0` a `motivoRechazoEliminar`), tiendas y equivalencias anticipan el `409` con el conteo: un `select("carga_id", { count: "exact", head: true })` filtrado por marca o equivalencia usa su índice (instantáneo); por tienda escanea la tabla (≈ 0,5 a 2 s, solo al intentar eliminar). El catálogo cerrado de tallas no tiene `DELETE` útil (ya responde por `eliminarDeCatalogo` sin `hijos`; la FK es la red).

### Cambios en el lector de archivos (`src/lib/arbol/leer-archivo.ts`), sin romper M1 a M4

Solo cambios aditivos; los 584 tests existentes (40 archivos, contados el 2026-10-11) no se tocan:

1. `hojaATabla(utils, hoja, opciones?)`, `libroATabla(...)` y `leerArchivoTabular(archivo, hoja?, opciones?)` aceptan `{ numerosCrudos?: boolean }`, **por defecto `false`** (comportamiento actual, texto con el formato visible). Con `true`, antes de `sheet_to_json` se reemplaza el texto `w` de las celdas numéricas que no son fechas por `String(celda.v)` (precisión completa: `205.70999999999998`, `0.00001`), con la misma técnica que ya usa `fechasExcelAIso` para las fechas. Así `AÑO` con formato `#,##0` no sale como `2,026` y los decimales ocultos de venta y costo no se pierden.
2. El CSV de M5 **no** usa `leerArchivoTabular` (que carga todas las filas): usa el lector por bloques nuevo `src/lib/ventas/leer-por-bloques.ts` (`leerPorBloques(archivo, { separador, codificacion, alBloque, alProgreso, hoja })`), que para Excel reutiliza `esExcel`, `fechasExcelAIso` y la opción de números crudos y entrega la hoja en bloques con `sheet_to_json` y `range`. `useImportador` (que limita a 10 000 filas) tampoco se usa; M5 tiene su propio hook `use-carga-ventas.ts` y reutiliza de `src/components/importador/` lo que sirve: `detectarMapeo`, `mapeoCompleto`, `PasoMapeo`, `Tarjeta`, `Muestra`, `TablaErrores` y `descargarCsv` (con BOM).

## Pantallas

Ruta nueva **`/planificacion/venta-stock`**, en una sección de menú nueva **Planificación** (visible a admin y planner; el comprador no la ve ni entra por URL), con el item **Carga de venta y stock**. La sección Planificación albergará después M6 a M8. `src/lib/nav.ts`: sección con `roles: PLANIFICACION`; `page.tsx` servidor redirige a `/` si el rol no puede editar maestros, igual que `tiendas/page.tsx`. Un solo panel con dos pestañas (`Tabs`): **Cargar · Cargas por mes**. Admin y planner tienen las mismas acciones. Encima, un resumen: "N de 45 meses cargados · último mes cargado · X filas".

### Pestaña Cargar

Flujo por pasos, con un solo botón de acción visible en cada uno:

1. **Archivo.** Selector (CSV, o `.xls` / `.xlsx`) con el texto "Un archivo por año o semestre; por mes para probar". Tras elegir: nombre, tamaño, **codificación detectada** ("UTF-8 con BOM") con selector para corregirla, **separador detectado** ("coma") con selector, y para Excel el selector de hoja. Enlace "Cómo exportar de QlikView" (las seis instrucciones). Aviso si es Excel de más de 150 000 filas.
2. **Mapeo.** Las 14 columnas autodetectadas, con las obligatorias marcadas; `AÑO` y `MES` o `MES` solo. Se avanza solo con el mapeo completo.
3. **Lectura y previsualización.** Barra de avance de lectura ("Leyendo… 45 % · 14,8 de 33 MB · 180 000 filas"), con **Cancelar**. Al terminar, la pantalla manda los valores distintos y recibe las resoluciones. Si la lectura no termina por un error de formato (coma decimal, cabecera rota), el diagnóstico global lo dice en rojo y bloquea.
4. **Reporte previo.** Ver abajo.
5. **Cargar.** Botón **Cargar N meses**, habilitado solo con una previsualización vigente (misma firma de archivo, hoja, separador, codificación y mapeo, como en M1 a M4) y sin bloqueos. `confirm` con los meses, los que reemplazan a una carga existente y las filas que quedan fuera.
6. **Avance.** Ver "Avance y reanudación".

**Reporte previo**, de arriba abajo:

- **Diagnósticos globales** (bloquean todo el archivo): coma decimal, columna obligatoria vacía, archivo posiblemente truncado. El bloqueo por **errores del 2 % o más es por mes** (regla 20): ese mes sale como "Bloqueado: N % de la venta/stock en errores" y se **salta**, los demás meses se cargan; la casilla "Cargar también los meses bloqueados (quedarán marcados Incompleto)" (apagada por defecto) lo fuerza, y el mes se recarga completo cuando se corrija el árbol. Sin esto, un archivo de un año se bloquearía entero por un mes con un error de clasificación.
- **Tarjetas por mes** (una tabla: un mes por fila): periodo, estado ("Nuevo", "Reemplazará la carga del 2026-10-09 (32 558 filas)" o "Idéntico a lo ya cargado: se omite"), filas del archivo, filas que se cargan, filas excluidas, y para cada una de las cinco medidas el valor del archivo y el cargado. Cada mes admite abrir un detalle.
- **Conciliación por mes**, tabla `medida · QlikView (opcional) · archivo · excluido · cargado · diferencia`:
  - Los **totales de QlikView** son campos opcionales que Javier escribe o pega (cinco por mes). Se comparan contra el archivo: unidades y stock en unidades deben ser **exactos**; venta, costo y stock valorizado **coinciden con una diferencia relativa menor al 0,1 %** (mostrada como "coincide"), y por encima de eso se marcan en ámbar. No se exige igualdad exacta: las cifras enteras del CSV no la dan.
  - **Identidad interna**: `archivo = cargado + suma de exclusiones`, **exacta** (en céntimos). Si no cierra, es un error de la herramienta, no de los datos, y el botón Cargar se bloquea.
- **Exclusiones**, en tres bloques con filas, % de filas, y venta, costo y stock afectados (con su % del mes):
  - **Errores** (hay algo que corregir; no se cargan): `mes_invalido`, `numero_invalido`, `clasificacion_incompleta`, `tienda_vacia`, `tienda_desconocida`, `talla_desconocida`, `genero_desconocido`, `mundo_desconocido`, `linea_desconocida`, `nodo_inexistente`, `equivalencia_inexistente`. **Agrupados por valor**, no por fila: cada línea trae el valor (o la combinación), cuántas filas afecta, su peso y la **primera fila** del archivo donde aparece.
  - **Excluidas por decisión** (informativas, sin acción): `sin_clasificar` (género, mundo y línea en blanco; en septiembre 57 filas, ~4 % del stock y ~1 % de la venta), `tienda_inactiva` (incluye las tres que no son del sistema, una vez creadas desactivadas), `marca_inactiva`, `genero_inactivo`, `mundo_inactivo`, `linea_inactiva`, `nodo_inactivo`, `equivalencia_inactiva`, `fila_total`, `fila_en_cero`. Lo desactivado en el maestro es una decisión ya tomada; lo inexistente es una pregunta pendiente.
  - Cada motivo tiene su etiqueta y su peso; si una exclusión informativa pesa más del 2 % de la venta o del stock, se resalta (no bloquea).
- **Descargas**: "Descargar omitidas (CSV)" (BOM; una fila por valor o combinación con motivo, filas, primera fila y pesos) y **"Descargar combinaciones desconocidas (formato árbol)"** con las columnas `GENERO, MUNDO, LINEA, EQUIVALENCIA` (la equivalencia tal como vino: vacío sigue vacío y `-` sigue `-`, para que el importador del árbol de M1 la procese con sus reglas) más `FILAS`, `VENTA`, `STOCK_VALORIZADO` y `MOTIVO`, columnas que el importador del árbol ignora. Javier lo sube en el importador de M1 y repite la previsualización. Las equivalencias nuevas aparecerán en Faltantes de M3.
- **Tiendas desconocidas**: agrupadas por valor con filas y peso, y un enlace a `/maestros/tiendas` con la indicación: si es una tienda real, créala o corrige su nombre; si no debe cargarse nunca (la central, una oficina), créala **desactivada** y a partir de ahí saldrá como `tienda_inactiva`, informativa.
- **Avisos** (se carga igual; ver reglas 22 a 26). Dos niveles: **aviso** (ámbar, abierto) y **nota** (neutro, plegado); cada uno con filas, % y peso, y plegado salvo que pese más del 1 % de la venta o del stock.
  - Avisos: `stock_negativo`; `claves_repetidas_se_suman` (grupos y filas; la tabla ya mostró los valores tras normalizar, por ejemplo el doble espacio en `PANTALON  VARIOS`); `talla_revisar_a_centrales` (filas, venta y stock que pasan a CENTRALES, desglosado por valor original `Revisar`, `-`, vacío); `marcas_nuevas` (tabla de marcas nuevas ordenada por venta con filas, venta y stock de cada una, los comodines marcados, el selector de la agrupación por defecto `MID VALUE`, el texto "N marcas nuevas: todas quedarán en MID VALUE hasta que las muevas", la descarga `MARCA, AGRUPACION` para el importador de M2 y el resalte `posible_tipeo` en las de una o dos filas; ver "Marcas nuevas"); `venta_en_cd`; `fuera_de_vigencia` (venta de una tienda en un mes anterior a su apertura o posterior a su cierre según M4, agrupada por tienda y mes: las fechas pueden ser aproximadas); `unidades_con_decimales`; `mes_abierto`; **`comparacion_mes_anterior`** (filas, venta o stock que difieren más del 25 % del último mes cargado); `archivo_posiblemente_truncado`; y las dos de **red de seguridad del stock**: **`stock_en_cero`** (un mes pasado trae el stock en cero en todas las filas) y **`stock_identico_a_otro_mes`** (la huella de stock del mes coincide con la de otro mes del archivo o ya cargado: delata que QlikView exportó el stock actual y no el de fin de mes). Se muestran en rojo con el mes involucrado.
  - Notas: `unidades_negativas` (devoluciones), `unidades_sin_venta`, `venta_sin_unidades`, `costo_mayor_que_venta`, `costo_sin_venta`, `cifras_enteras`. **Las cifras enteras no alarman**: con soles enteros una fila con unidades y venta menor a S/ 0,50 sale con venta 0 y un costo mayor que la venta es más frecuente (5,7 % de las filas en septiembre, casi todas de montos chicos); por eso estas cinco son notas plegadas, y `cifras_enteras` dice: "las cifras monetarias vienen en soles enteros; error máximo por fila de S/ 0,50, despreciable en los totales". Nunca bloquea. Un CV % por fila no se calcula nunca: se agrega por línea y mes en M6/M7.

**Avance y reanudación.** Cada mes es una carga independiente y se publica en cuanto termina, de modo que **un corte deja meses completos publicados, un mes en curso invisible y el resto sin empezar**. El panel de avance muestra: la barra general ("Mes 7 de 12 · tanda 23 de 40 · 58 %" con tiempo transcurrido y estimado restante), una tabla por mes con estado (Pendiente · Cargando · Publicado · Saltado · Error) y fila a fila, el botón **Cancelar** (abandona la carga en curso y detiene el resto) y un aviso `beforeunload` si se intenta cerrar la pestaña. Una tanda que falla se reintenta hasta tres veces (es idempotente); si no, se descarta ese mes (`DELETE` de su carga), se marca con el motivo y se **continúa con el siguiente**; al final hay un botón **Reintentar los meses con error**. Para **reanudar tras un corte** se vuelve a elegir el mismo archivo: la previsualización marca "Idéntico a lo ya cargado" (mismos totales, misma huella de stock) en los meses publicados y la casilla "Saltar los meses ya cargados con los mismos totales" (activa por defecto) los omite; solo se rehace el mes que se interrumpió (a lo sumo ~2 minutos perdidos). Es la idempotencia hecha operación.

### Pestaña Cargas por mes

Tabla de los meses de `INICIO_HISTORICO` (enero de 2023) al último mes cerrado, **incluidos los que faltan**: periodo · estado (Cargado, Sin cargar, En curso por Ana desde las 10:42, y el badge **Incompleto N %** en ámbar si se forzó con errores) · filas · unidades · venta · costo · stock (unidades y valorizado) · archivo · quién · fecha. Cabecera: "N de 45 meses cargados", con los faltantes en ámbar y un chip Todos · Cargados · Faltantes. Los meses cargados abren el detalle de su reporte (exclusiones y avisos de aquella carga) y un historial de cargas anteriores del mes (reemplazadas). Acciones por mes (planner y admin): **Retirar** (con `confirm`; el mes deja de verse) y, en las `en_curso` caducadas, **Abandonar**. Botón **Verificar totales** (recalcula en SQL y marca diferencias) y aviso "Limpieza pendiente" con **Limpiar ahora**. Es también la vista de **cobertura**: un hueco entre dos meses cargados salta a la vista.

### Otros

- La pantalla de **Marcas** (`/maestros/marcas`) no cambia: las marcas creadas por una carga se ven ordenando por fecha de creación y se mueven de agrupación con el `Select` que ya tiene; la lista completa viene en el reporte de esa carga.
- Tiendas (`/maestros/tiendas`): al eliminar una tienda con histórico, el `409` con el conteo. Es también donde se crean desactivadas las tiendas del archivo que no deben cargarse.
- Página de inicio: M5 aparece como módulo "Listo" y enlazado.

## Reglas de negocio

Funciones puras en `src/lib/ventas/` probadas en `tests/ventas.*.test.ts` (el navegador y el servidor reutilizan las mismas). Las reglas 1 a 32 y la 35 son de vitest (las 31 y 32 de estado de cargas y planificación de tandas); la 33 es un test estático; la 34 es SQL y se prueba con el script de humo local.

**`periodo.ts`**

1. `leerPeriodo(anio, mes)`: `("2026","Set")`, `("2026","sep")`, `("2026","SEPTIEMBRE")`, `("2026","Setiembre")`, `(2026, 9)`, `("2026","09")` → `"2026-09-01"`; `("2026","Ene")` → `"2026-01-01"`; sin distinguir caja ni acentos.
2. `leerPeriodo(null, mes)`: `"2026-09"`, `"2026/09"`, `"09/2026"`, `"2026-09-15"`, `"15/09/2026"` → `"2026-09-01"`; `"09/05/2026"` es 9 de mayo (día primero); el día distinto de 1 se informa como nota.
3. Inválidos → `"invalido"`: `"Sep."`, `"13"`, `"0"`, `""`, `"xx"`, `"2026-13"`, año `"26"`, `"1999"`, `"2101"`. Nunca se usa `new Date(texto)`.
4. `esMesCerrado(periodo, hoyLima)`: `2026-09` con hoy `2026-10-11` → cerrado; `2026-10` → abierto; con hoy `2026-10-01` → septiembre cerrado.

**`numeros.ts`**

5. `leerNumero`: `"7913"` → 7913; `"7,913"` → 7913; `"1,234,567.5"` → 1234567.5; `"-12.5"`, `"(12.5)"` → −12.5; `"1e3"` → 1000; `"12,5"`, `"1.234,56"`, `"1,23"`, `"abc"`, `""`, `"1,2345"` → `"invalido"` (el vacío en una medida es inválido: QlikView exporta `0`). Nunca `-0`.
6. `redondear2`: `205.70999999999998` → `205.71`; `1.005` → `1.01`; `-1.005` → `-1.01`; `0.004` → `0`; `-0.004` → `0` (no `-0`); `0.5` → `0.5`.
7. `aEntero`: `3` → `3`; `2.6` → `3` con la bandera `tuvoDecimales`; `-2.5` → `-3`.
8. `pareceComaDecimal(valores)` es verdadero cuando más del 1 % de las celdas numéricas tienen forma `\d+,\d{1,2}` y falso para `7,913` y `1,234,567`.
9. `todasEnteras(medidas)` detecta el export sin decimales de venta, costo y stock valorizado (alimenta la nota `cifras_enteras`).

**`talla.ts` y `columnas.ts`**

10. `mapearTalla`: `Central`, `CENTRAL`, `centrales` → CENTRALES; `Extrema`, `EXTREMAS` → EXTREMAS; `Revisar`, `-`, `""` → CENTRALES con `revisar: true` y el valor original; `XL` → `null` (`talla_desconocida`).
11. `detectarMapeo` con los 14 encabezados de QlikView exactos (`AÑO`, `MES`, `TIENDA`, `GENERO_LK`, `MUNDO_LK`, `LINEA_SAP_LK`, `EQUIVALENCIAS_LK`, `MARCA`, `TALLA_e`, `Stk Fin Act`, `Unv vta`, `Vta S/`, `Costo Vta`, `Stk Val Act`) mapea los 14 campos; con la forma canónica (`MES`, `TIENDA`, `GENERO`, …, `STOCK_VALORIZADO`) también; una cabecera con BOM delante mapea igual.

**`interpretar.ts`**

12. `interpretarFila` normaliza con `normalizarNombre`: `"PANTALON  VARIOS"` y `"pantalon varios"` dan la misma clave; la equivalencia vacía da `SIN EQUIVALENCIA`; `-` da el nombre de la línea normalizado y es la misma clave que escribir ese nombre.
13. Marca vacía o `-` → `SIN MARCA`; `VARIOS`, `OTROS` y `SIN MARCA` son comodines (`esComodin`).
14. **Precedencia de motivos**, el primero que aplique gana y cada fila cuenta en un solo motivo: `fila_total` → `mes_invalido` → `numero_invalido` → `fila_en_cero` → `sin_clasificar` → `clasificacion_incompleta` → tienda (`tienda_vacia`, `tienda_inactiva`, `tienda_desconocida`) → `talla_desconocida` → combinación (desconocida o inactiva, con su motivo) → `marca_inactiva`. Un test cruza filas con dos fallos y comprueba el motivo.
15. `sin_clasificar` solo si género, mundo y línea están **los tres** en blanco; con uno o dos en blanco es `clasificacion_incompleta` (error). La fila `sin_clasificar` con un ajuste negativo cuenta su peso (negativo) en el motivo.
16. `fila_en_cero`: las cinco medidas en cero tras redondear; una fila con solo stock no lo es.

**`acumulador.ts`**

17. El acumulador agrega N filas con diccionarios y devuelve los mismos totales que una suma directa; las claves repetidas tras normalizar (el doble espacio) **se suman** (todas las medidas, el stock incluido) y se cuentan (`grupos_repetidos`, `filas_repetidas`) con la primera fila; la clave se calcula **después** de aplicar el mapeo de talla (`Central` + `Revisar` de la misma combinación se suman).
18. Las sumas se hacen en céntimos enteros (sin deriva de coma flotante): 100 000 filas con montos de 2 decimales suman exactamente lo mismo en cualquier orden.
19. **Prueba de volumen**: 400 000 filas sintéticas se acumulan en menos de 5 s y el acumulador no guarda objetos por fila (se comprueba con los tamaños de los arreglos tipados, no con la memoria del proceso).

**`informe.ts`**

20. **Identidad**: para cada mes, en las cinco medidas `archivo = cargado + Σ exclusiones`, y en filas `archivo = cargadas + fusionadas + excluidas` (las claves repetidas que se sumaron cuentan como fusionadas, no como excluidas), exacta en céntimos, con datos aleatorios (propiedad con una semilla fija). Bloqueo **por mes**: si los motivos de **error** pesan `UMBRAL_BLOQUEO_ERRORES` (2 %) o más en filas, venta o stock valorizado de un mes, ese mes queda `bloqueado = true` y no se carga salvo `forzar_incompleto`, con lo que la carga guarda `incompleto: true` y el porcentaje; un diagnóstico global bloquea el archivo entero; las exclusiones por decisión nunca bloquean.
21. **Conciliación con QlikView**: unidades y stock en unidades coinciden solo si la diferencia es 0; venta, costo y stock valorizado coinciden con diferencia relativa menor a 0,1 % (y `0,0999 %` coincide, `0,1 %` no); sin totales de QlikView no se emite conciliación contra QlikView y no es un error.
22. `fuera_de_vigencia`: venta o costo de una tienda en un mes anterior al de su `fecha_apertura` o posterior al de su `fecha_cierre` (el mes de apertura y el de cierre cuentan como vigentes); sin fechas no hay aviso. `venta_en_cd`: venta o costo distintos de cero en una tienda tipo Centro de Distribución (el CD solo trae stock).
23. `comparacion_mes_anterior`: filas, venta o stock valorizado que difieren más del 25 % del mes anterior cargado (o del anterior dentro del archivo); sin anterior no se calcula.
24. **Huella de stock** `(filas con stock ≠ 0, Σ stock_unidades, Σ stock_valorizado)`: dos meses con la misma huella disparan `stock_identico_a_otro_mes` (entre meses del archivo y contra los ya publicados); un mes pasado con `filas con stock ≠ 0 = 0` dispara `stock_en_cero`. Dos meses reales distintos nunca coinciden en las tres.
25. `archivo_posiblemente_truncado`: una hoja de exactamente 65 536 filas (`.xls`). Un mes con exactamente 65 535 filas de datos no lo dispara en CSV.
26. Severidades: avisos (stock negativo, claves repetidas, talla Revisar, marcas nuevas, venta en CD, fuera de vigencia, decimales en unidades, mes abierto, comparación, truncado, stock en cero o idéntico) frente a notas (devoluciones, unidades sin venta, venta sin unidades, costo mayor que venta, costo sin venta, cifras enteras). Ninguno bloquea; `cifras_enteras` jamás.
27. Idempotencia: el mismo archivo da el mismo informe, la misma huella y, con el mismo estado del maestro, las mismas tandas.

**`resolver.ts`**

28. Tienda: por nombre normalizado primero, por código después; `excluida` (lista) antes que `desconocida`; inactiva se distingue de desconocida; un valor que coincida por nombre con una tienda y por código con otra se resuelve por nombre.
29. Combinación: orden género → mundo → línea → nodo → equivalencia; `-` y vacío con las funciones del árbol (la genérica se resuelve por `es_generica` aunque el nombre de la genérica cambiara); nodo, equivalencia o catálogo **inactivos** → motivo informativo; **inexistentes** → motivo de error con su detalle (cuál pieza falta). Una combinación cuyo nodo existe pero no la equivalencia es `equivalencia_inexistente`, no `nodo_inexistente`.
30. Marcas: existente activa / nueva / `inactiva`; las nuevas llevan código `codigoUnico` (`MARCA'S` y `MARCA-S` dan `MARCA_S` y `MARCA_S_2`) y `tratamiento_especial = false`; `VARIOS`, `OTROS` y `SIN MARCA` van a la agrupación `MID VALUE` con independencia de la elegida; si `MID VALUE` no existe o está inactiva, es un error de la petición y no se crea nada. `planificarMarcasNuevas` devuelve por marca nueva filas, venta y stock, ordena por venta, y marca `posible_tipeo` (una o dos filas) con la existente más parecida (misma `aCodigo` o distancia de edición 1) si la hay; `csvMarcasNuevas` produce `MARCA, AGRUPACION` con la agrupación por defecto.

**`cargas.ts` (estado y tandas)**

31. Transiciones permitidas: solo las seis de "Estados y transiciones válidas"; cualquier otra lanza error. `cargaCaducada(updated_at, ahora)`: 29 minutos no, 31 sí. Reemplazar una `publicada` exige `reemplazar`; un mes no cerrado exige `mes_abierto`.
32. `partirEnMeses` reparte cada fila en la carga de su mes sin perder ni duplicar ninguna (suma por mes = suma total); `partirEnTandas(filas, 10_000)` conserva el orden y el total; el diccionario de cada tanda solo trae los ids que usa; `mesesASaltar` marca "idéntico" solo si coinciden filas, las cinco medidas y la huella con la carga publicada; `mesBloqueado(informeMes)` aplica el 2 % por mes y `forzar_incompleto` lo levanta; `esReintentable(error)` distingue red y `5xx` (reintentar, hasta 3) de `4xx` (descartar). `TANDA_IN` = 150 y un test garantiza que ninguna ruta de M5 pase más de 150 ids a `.in`.
33. **Test estático**: solo `src/lib/ventas/consultas.ts` menciona `venta_stock_mensual`; cualquier otra lectura va a `venta_stock_vigente` o a una función SQL. Ningún archivo bajo `src/` hace `leerTodo` sobre esas tablas.
34. **SQL (script de humo local, en `scripts/validar-migraciones-local.sh` o uno vecino)**: la `0007` aplica dos veces sin error y sin sentencias `DROP`/`DELETE`/`TRUNCATE` (`on delete restrict` en una FK no cuenta: 0002 a 0006 ya pasaron por `execute_sql` con ella); `publicar_carga_venta_stock` publica una carga, vuelve a publicar otra del mismo mes y deja la primera `reemplazada` y una sola `publicada`; con un total esperado distinto devuelve `no_concilia` y no cambia ningún estado; dos cargas `en_curso` del mismo mes chocan con el único parcial; un `select` por `anon` a la vista devuelve **cero filas** (`security_invoker` + RLS sin políticas) y un `select` a cualquiera de las tres funciones falla con error de permiso (`revoke`); `cargas_pendientes_limpieza()` no devuelve cargas `publicada` ni `en_curso` y deja de devolver una carga en cuanto queda vacía; `totales_cargas_publicadas()` coincide con los totales que guardó la publicación.

**`esquemas.ts`**

35. `tandaSchema` rechaza índices fuera del diccionario, `talla` distinta de 0 o 1, `NaN` o `Infinity`, enteros con decimales, más de 10 000 filas, y acepta negativos; `previsualizarSchema` rechaza periodos mal formados; `abrirCargaSchema` rechaza un `reporte` de más de 200 KB.

## Criterios de aceptación / hito de prueba

Cómo leerlo: `[x]` lo cubren los checks automáticos y la QA; `[ ]` solo se comprueba con la base real y el archivo real, y lo recorre Javier. 

**Antes de construir (verificación con el archivo real)**

- [x] El CSV de septiembre de 2026 existe y se leyó: UTF-8 con BOM, coma, cabecera, 32.558 filas, cifras enteras, tildes correctas.
- [ ] La lista de las 11 tiendas está en M4 con nombres que coincidan por nombre normalizado (el CD incluido), y las tres del archivo que no son del sistema están creadas y **desactivadas**; Javier cargó las combinaciones nuevas (263) con el importador del árbol, o acepta cargar septiembre con esas 1,7 % filas como errores informados (si pesan 2 % o más de la venta o del stock, el mes sale bloqueado y hay que forzarlo o corregir el árbol).
- [ ] **La lista de marcas con agrupación de M2 está cargada antes del piloto** (si QlikView tiene el nivel de cada marca, exportada de ahí), o Javier acepta que las ~280 marcas nazcan en MID VALUE y moverlas después desde `/maestros/marcas`.

**Piloto (septiembre de 2026)**

- [ ] `0007_venta_stock.sql` aplicada dos veces en `vector-two` sin error, sin `DROP`, `DELETE` ni `TRUNCATE`; tipos regenerados (con la vista bajo `Views` y las tres funciones bajo `Functions`); la forma de `marcas` no cambia; `APP_VERSION` = `0.8.0 · M5`.
- [ ] Roles: el menú muestra Planificación → Carga de venta y stock a admin y planner; el comprador no la ve, la ruta lo redirige a `/` y **toda** la API de M5 (`GET /api/ventas/cargas` incluido) le responde `403`.
- [ ] Cargar el CSV de septiembre: la codificación sale "UTF-8 con BOM", el separador "coma", el mapeo se autodetecta (14 columnas), la lectura muestra su barra y termina en segundos.
- [ ] **Reporte previo contra los hechos conocidos**: 32.558 filas; las 3 tiendas desconocidas (13 filas, solo stock) como desconocidas, y tras crearlas desactivadas en M4 como `tienda_inactiva` informativas; las 57 filas sin clasificar como excluidas por decisión; `Revisar` ~6 % de las filas y ~15 % de la venta con su aviso; las 263 combinaciones (36 con nodo nuevo) como errores agrupados por valor con primera fila; las 2 parejas repetidas por el doble espacio como "claves repetidas que se suman"; la nota "cifras enteras" informativa; las marcas nuevas listadas con filas, venta y stock, los comodines en MID VALUE y el texto "quedarán en MID VALUE hasta que las muevas"; el CD con solo stock sin aviso de venta.
- [ ] **Conciliación contra QlikView**: Javier escribe los cinco totales de septiembre; unidades y stock en unidades dan exacto; venta, costo y stock valorizado "coinciden" (< 0,1 %). La identidad `archivo = cargado + exclusiones` cierra.
- [ ] Cargar: el mes aparece publicado en "Cargas por mes" con filas, totales y fecha; los totales medidos por la base coinciden con los esperados; `select count(*) from venta_stock_vigente` es igual a las filas cargadas.
- [ ] **Reemplazo e idempotencia**: subir el mismo archivo otra vez marca "Idéntico a lo ya cargado" y, forzando el reemplazo, deja las mismas filas y los mismos totales; la carga anterior queda `reemplazada` y la limpieza borra sus filas.
- [ ] **Corte a medias**: cancelar o cerrar la pestaña a la mitad de las tandas deja el mes anterior intacto y visible; la carga queda `en_curso` sin que nadie la vea, y tras 30 minutos (o con "Abandonar") se descarta.
- [ ] Un archivo con una columna de coma decimal o una cabecera incompleta se bloquea con el diagnóstico claro; uno con más del 2 % de errores de valor no deja cargar sin corregir.
- [ ] Eliminar una marca o una tienda con histórico responde `409` con el conteo; desactivarla sigue permitido. Mover de agrupación una marca creada por la carga desde `/maestros/marcas` funciona y no toca ninguna fila de hechos.
- [ ] Medición: tiempo del piloto (lectura, tandas, publicación) anotado y comparado con la estimación de abajo; si `TANDA_INSERT_VENTAS = 2 000` falla, se baja a 500 y se anota. Se anota también `show statement_timeout` desde el backend y, en el SQL Editor, `select pg_size_pretty(pg_total_relation_size('venta_stock_mensual'))` (esperado ≈ 12 MB por mes).
- [ ] Corte en una tanda: con la red cortada a mitad de una tanda y restablecida, la tanda se reintenta sola y el mes se publica concilia (`ignoreDuplicates`); con la red cortada del todo, el mes se descarta y los anteriores quedan publicados.
- [ ] Un mes con errores forzados aparece con el badge **Incompleto** y su porcentaje en Cargas por mes; tras corregir el árbol y recargarlo, el badge desaparece.

**Histórico completo (2023-01 a 2026-09)**

- [ ] Cargar 2026 (enero a agosto) en un archivo, y luego 2025, 2024 y 2023 un archivo por año. El panel de avance muestra mes y tanda, y cortar a mitad de un archivo y volver a subirlo salta los meses ya publicados.
- [ ] **Verificación del stock mensual (red de seguridad)**: al cargar el primer mes histórico, el stock **no** sale idéntico al de septiembre (no hay `stock_identico_a_otro_mes` ni `stock_en_cero`); si saliera, QlikView estaría exportando el stock actual y se corrige en la exportación.
- [ ] "Cargas por mes" muestra 45 de 45 meses cargados, sin huecos; octubre de 2026 no está.
- [ ] Total de filas en `venta_stock_vigente` del orden de 1,5 millones; `pg_total_relation_size` de la tabla con sus índices dentro de la estimación (≈ 535 MB, rango 480 a 600); `explain analyze` de una agregación completa por mes × equivalencia sobre la vista anotado (esperado 2 a 5 s en Micro): es el dato con el que M6 y M7 decidirán si necesitan agregados precalculados.

**Tiempos estimados** (a confirmar en el piloto; el servidor es Railway y la base el compute Micro de Supabase, así que cada tanda son 5 `upsert` de 2 000 filas con tres índices que mantener):

| Carga | Lectura y previsualización | Tandas (10 000 filas ≈ 3 s) | Publicar | Total aprox. |
|---|---|---|---|---|
| Septiembre (32.558 filas, 2,7 MB) | 2 a 3 s | 4 tandas, ~12 s | ~1 s | **~20 s** |
| Un año (≈ 400 mil filas, 33 MB) | 10 a 20 s | 40 tandas, ~2 min | 12 × 1 s | **~3 min** |
| Histórico (≈ 1,5 M filas, 120 MB) | 40 a 60 s | 150 tandas, ~8 min | 45 × 1 s | **~10 a 12 min** |

## Fuera de alcance

- **Curvas de estacionalidad (M6), proyección anual (M7), flujo y compras (M8)**; M5 solo deja los datos limpios y las vistas de lectura.
- **CV % = costo ÷ venta neta**: se calcula agregado por línea y mes en M6/M7. M5 no lo calcula, ni al cargar ni fila a fila.
- **Marcar meses atípicos** (por ejemplo el Niño costero de 2023) y el **tratamiento de la liquidación** se deciden en M6 y M7. M5 carga todos los meses tal cual, sin marcar ni excluir ninguno.
- Crear o modificar el árbol desde la carga: el importador de M5 no crea géneros, mundos, líneas, nodos ni equivalencias; descarga las combinaciones desconocidas en el formato del importador del árbol.
- **Tabla de alias de marcas**: Javier confirmó que no hay alias. Si algún día los hubiera, la forma barata sería una columna nullable `alias_de_id` en `marcas` (autorreferencia, sin cadenas) resuelta al leer, sin recargar; no se reserva estructura hoy.
- Tallas individuales: no existen; solo CENTRALES y EXTREMAS, y `Revisar` se reparte como Javier decidió.
- **Agrupar marcas dentro de un nivel** (marca colectiva para la cola, lista de marcas en seguimiento, pantalla de marcas sugeridas por histórico, entrega `0.8.1`): Javier lo descartó el 2026-10-11 ("sería hacer más completo algo que no se necesita"). Si en el futuro hiciera falta, se puede añadir **sin recargar el histórico**, porque el detalle de cada marca queda guardado: sería una bandera en `marcas` y una resolución al leer.
- Actualizar masivamente la agrupación de marcas existentes desde archivo (el importador de M2 no actualiza; se mueven desde la pantalla de marcas, o se construye el modo "actualizar" de la pregunta abierta 4 de M2).
- Cargas parciales de un mes (agregar filas sin reemplazar el mes), cargas diarias o por semana, y la importación directa desde QlikView.
- Particiones por mes, vistas materializadas y cachés de agregados: si M6 o M7 necesitan agregados interactivos sobre 1,5 millones de filas (medición del hito: 2 a 5 s por agregación completa en Micro), es una decisión de ese módulo; una vista materializada refrescada al publicar cabe en una migración posterior sin romper la regla de "sin `DROP`/`DELETE`/`TRUNCATE`".
- Tabla `tiendas_excluidas` y botón "Excluir siempre": descartados en favor de crear desactivadas en M4 las tiendas que no deben cargarse (pregunta abierta 2 por si Javier prefiere la tabla).
- Reanudar una carga tanda a tanda (libro de tandas): la tanda idempotente con reintentos y la carga por mes cubren el caso a un costo máximo de ~2 minutos.
- Auditoría detallada de quién cambió qué más allá del registro de cargas (pendiente desde M0); el comprador no ve la pantalla.

## Decisiones nuevas propuestas

Para que el `documentador` las registre en `docs/DECISIONES.md` cuando Javier apruebe la ficha:

1. **La marca se guarda al detalle, con FK a su maestra, y su agrupación se lee del maestro.** Los hechos referencian la marca tal como viene; el nivel (uno de cinco) sale de `marcas.agrupacion_marca_id` al agregar. Por qué: cambiar una marca de nivel no debe obligar a recargar 45 meses; Vector-One copiaba la agrupación en cada fila y se desfasaba. Descartado por Javier el 2026-10-11: agrupar marcas dentro de un nivel (colectiva, seguimiento, marcas sugeridas).
2. **Las marcas desconocidas se crean solas en la agrupación por defecto, con freno en el reporte previo.** `tratamiento_especial` en falso; VARIOS, OTROS y SIN MARCA siempre en MID VALUE; la lista completa con venta y stock se ve antes de confirmar, se descarga en el formato del importador de M2 y las de una o dos filas se resaltan como posible error de tipeo. Descartado: exigir que existan antes (obligaría a un alta previa por cada mes) y crear alias (no hay).
3. **Una carga es un mes completo y se publica por cambio de estado.** Tabla `cargas_venta_stock`, hechos etiquetados con `carga_id`, una `publicada` por mes por índice único parcial, publicación por función SQL con solo `update` que concilia antes de publicar; la lectura pasa solo por `venta_stock_vigente`; las tandas son `upsert … ignoreDuplicates` (idempotentes, con reintento); la limpieza es un `delete` de handler por carga guiado por `cargas_pendientes_limpieza()`. Descartado: borrar e insertar (un corte deja el mes parcial visible), tabla de paso con `delete` en la función (la migración no admite `delete`), particiones por mes.
4. **La tabla de hechos queda exenta de `id`, `activo` y `updated_at`** (excepción a PLAN §4): filas inmutables, clave primaria compuesta natural, más dos índices de lectura `(equivalencia_id, carga_id)` y `(marca_id, carga_id)`; sin índice por `tienda_id` ni `agrupacion_talla_id` (excepción parcial al criterio "indexar toda FK" de M3, justificada con números). Por qué: ahorra ~70 MB en 1,5 millones de filas y no tiene sentido editar ni desactivar una fila de hechos. `cargas_venta_stock` sigue la convención salvo `activo` (cambia de estado).
5. **Las exclusiones por decisión son informativas; las inexistentes son errores.** Lo desactivado en el maestro (tienda, marca, línea, nodo, equivalencia), las filas sin clasificar, las filas de totales y las filas en cero no alarman; lo desconocido sí. Las tiendas del archivo que no deben cargarse se crean desactivadas en M4 (sin tabla de exclusiones). Un **mes** se bloquea si sus errores pesan el 2 % o más; se puede forzar y queda marcado Incompleto hasta que se recargue.
6. **Resolver una vez, en la previsualización.** El navegador lee el archivo por bloques, acumula en arreglos tipados con diccionarios y manda solo valores distintos; las tandas llevan ids ya resueltos. Descartado: subir el archivo entero, o reenviar texto y reinterpretarlo en cada tanda.
7. **Las medidas llegan a 2 decimales como mucho y las cifras enteras son aceptables.** `redondear2` al guardar; el aviso de cifras enteras es informativo y la conciliación contra QlikView usa tolerancia relativa del 0,1 % para soles y exactitud para unidades.
8. **La talla `Revisar`, `-` y vacío se cargan como CENTRALES con aviso; `-` y vacío como marca son `SIN MARCA`** en MID VALUE, con VARIOS y OTROS.
9. **Toda agregación del histórico se hace en SQL**: ninguna lectura de hechos pasa por `leerTodo`.
10. **Las cifras de venta y costo son de planificación: toda la API de M5 exige `requirePlanner`, lecturas incluidas.** Qué ve el comprador se decide en M8 con el documento para compradores. Descartado: lecturas `requireUser` como en los maestros (dejaría el costo al alcance de un rol que no ve la pantalla).

## Ajustes a lo ya registrado

- [04-tiendas](04-tiendas.md) (preguntas 2 y 4) esperaba resolver la tienda **por código**; el archivo de QlikView trae el **nombre**. M5 resuelve por nombre normalizado y, si no, por código. No cambia nada de M4.
- `docs/PLAN.md` §4 y §5 (M5, M6, M7) se actualizan: dos tablas nuevas (ya no tres: `tiendas_excluidas` se descartó en la revisión), la vista y las tres funciones, `marcas` sin cambios (las columnas de seguimiento y colectiva se retiraron), y la línea pendiente de M6 sobre meses atípicos y liquidación.
- La entrada de `DECISIONES.md` del 2026-10-05 sobre la regla de equivalencias (vale para M5) se cumple tal cual: M5 llama a `esEquivalenciaIgualALinea` y `esEquivalenciaGenerica`, no a copias.
- El hito de M2 no cambia: `0007` no siembra ninguna marca.

## Cambios respecto a la especificación

Vacío: se completa al construir y con la QA.

## Preguntas abiertas para Javier

Quedaron cerradas con las respuestas de arriba: alias, comodines, histórico, stock mensual, formato, cifras enteras, stock a costo y meses atípicos. En la revisión del 2026-10-11 se cerró también la del **plan de Supabase** (es Pro: 8 GB, 12 MB usados; el modelo se construye con `uuid` y sin compactar) y la **verificación del primer mes histórico** pasó al hito (la herramienta avisa sola con `stock_identico_a_otro_mes` y `stock_en_cero`; no hay nada que preguntar). Siguen abiertas, cada una con su valor por defecto si Javier no responde antes de construir:

1. **Clasificación del árbol en el histórico.** La carga asume que los campos `_LK` de QlikView aplican a todo el histórico el **árbol vigente** (la misma clasificación para enero de 2023 y septiembre de 2026), y el modelo lo refleja: si Vector2 mueve una línea de mundo, los 45 meses la siguen. ¿Es así, o QlikView clasifica cada mes con el árbol de su fecha? **Por defecto: árbol vigente.** Si fuera por fecha, habría que exportar el histórico ya clasificado con el árbol de hoy.
2. **Las tres tiendas que no son del sistema** (central y dos oficinas; 13 filas, solo stock). **Por defecto: las creas en `/maestros/tiendas` y las desactivas**; desde ahí salen en el reporte como "tienda desactivada", informativas y con su peso, sin estructura nueva. La alternativa es una tabla de exclusiones con un botón "Excluir siempre" en el reporte, por si no quieres esas tres filas en el maestro de tiendas. Las filas sin clasificar (género, mundo y línea en blanco) se excluyen siempre por regla, también informativas con su peso (~4 % del stock, ~1 % de la venta).
3. **Resuelta (2026-10-11): Javier carga la agrupación de las marcas antes de la venta.** Se conserva el texto original por contexto. **¿QlikView tiene el nivel (1 a 5) de cada marca?** Si lo tiene, lo mejor es exportar una lista `MARCA, AGRUPACION` y cargarla con el importador de marcas que ya existe (`/maestros/marcas` → Importar) **antes** de la venta: así las ~280 marcas nacen en su nivel y el alta automática de M5 queda solo como red de seguridad. Si el histórico entra primero, todas nacen en MID VALUE y el importador de M2 no las corrige después (no actualiza existentes): habría que moverlas desde la pantalla. **Por defecto: cargas la lista primero**; si no existe en QlikView, aceptas que nazcan en MID VALUE y las mueves después.
4. **Qué ve el comprador.** Toda la API de M5 (incluidos los totales por mes de venta y costo) es solo para admin y planner, y el comprador no ve la pantalla. **Por defecto: así se queda hasta M8**, donde el documento para compradores dirá qué cifras lleva. ¿Hay alguna lectura de venta o stock que el comprador deba tener ya?
5. **El guion `-` como marca** (baja prioridad). Se trata como VARIOS y OTROS (MID VALUE) y se guarda con el nombre `SIN MARCA`, porque `-` no se puede mostrar ni derivar a un código. ¿Te sirve ese nombre, o prefieres otro (por ejemplo `VARIOS`, que lo fusionaría con esa marca)? **Por defecto: `SIN MARCA`.**

## Revisión de diseño (Fable)

Revisión del 2026-10-11, hecha contra el código real (`src/lib/arbol/*`, `src/lib/tiendas/importar.ts`, `src/lib/marcas/*`, `src/lib/api/*`, `src/components/importador/*`, `supabase/migrations/0002` a `0006`, `database.types.ts`, `node_modules/next/dist/docs` y `next-server.js`, y Vector-One como referencia) y no contra lo que la ficha decía de sí misma. Durante la revisión Javier cambió el alcance de las marcas (punto 1). Qué se encontró, qué cambió, qué se dejó igual y por qué.

### Qué se cambió

1. **Cambio de alcance de Javier: no se agrupan marcas dentro de un nivel.** Sus palabras: "para las marcas solo hay 5 niveles definidos hoy día. Dentro de uno de los niveles pensaba agrupar marcas para no tener tanto detalle, pero creo que es innecesario… sería hacer más completo algo que no se necesita". Se retiraron: las columnas `en_seguimiento` y `es_colectiva` (la `0007` ya no toca `marcas`), la marca colectiva MIDBRANDS y su siembra, el concepto de "marca suelta", la vista `marca_efectiva`, la función `totales_marca_periodo`, `GET /api/ventas/marcas-sugeridas`, `PUT /api/marcas/seguimiento`, la pestaña Marcas sugeridas, las columnas Seguimiento y Colectiva en `/maestros/marcas`, las reglas 31 a 33 y la entrega `0.8.1`. M5 queda en una sola entrega, `0.8.0`. Sigue vigente: las cinco marcas principales por equivalencia se ordenan directamente por venta al detalle; el stock por marca; la relación marca ↔ equivalencia se deriva de la venta. Como el detalle se guarda, agrupar la cola en el futuro no exigiría recargar (nota en "Fuera de alcance"). La ficha quedó más corta y con una pregunta abierta menos.
2. **Alta automática de marcas desconocidas: se mantiene, con frenos.** Exigir que existan antes (como el árbol con géneros y mundos) obligaría a un alta previa por cada mes del histórico, y las marcas son un maestro del planner, no un catálogo raíz. El riesgo real es el contrario: un error de tipeo en QlikView crearía una marca basura sin alias que la fusione. Frenos: la tabla de marcas nuevas con filas, venta y stock antes de confirmar, la descarga `MARCA, AGRUPACION` para el importador de M2, el resalte `posible_tipeo` en las de una o dos filas con la existente más parecida, y `marcas-nuevas` solo tras confirmar (cancelar no crea nada). Y la pregunta abierta 3: si QlikView tiene el nivel de cada marca, se carga la lista con el importador de M2 antes de la venta y el alta automática queda como red de seguridad. Se dejó escrita la trampa del orden: el importador de M2 no actualiza existentes, así que si el histórico entra primero las marcas quedan en MID VALUE hasta moverlas a mano.
3. **Plan de Supabase: cerrado.** Es Pro (8 GB; 12 MB usados). Se quitó la rama "si es Free hay que compactar" y las dos palancas (`carga_id` entero, talla `smallint`) quedan explícitamente sin aplicar: `uuid` en todas las FK por coherencia. La tabla de espacio pasa de ≈ 380 MB a **≈ 535 MB** porque ahora incluye los dos índices de lectura.
4. **Índices de la tabla de hechos: de "solo la clave primaria" a PK + `(equivalencia_id, carga_id)` + `(marca_id, carga_id)`.** La ficha justificaba no indexar con "las lecturas de M6/M7 son agregaciones de toda la tabla"; es cierto para calcular curvas, pero M6 revisando *una* curva y M7 abriendo *una* equivalencia o *una* marca son lecturas por valor, y sin índice cada una es un escaneo de 1,5 millones de filas (235 MB) en el compute Micro: 2 a 5 s por clic, no "1 a 2 s". Con los dos índices esas lecturas tocan ~800 filas. Costo: ≈ 150 MB y dos índices más por tanda. Se mantienen fuera `tienda_id` (~15 valores; M8 lee stock por mes, que ya resuelve `carga_id`) y `agrupacion_talla_id` (dos valores). La cifra de "1 a 2 s" se corrigió a "2 a 5 s en Micro" con el cálculo (hash aggregate sobre 1,5 M filas en 2 vCPU compartidos y 1 GB) y se dejó escrito que la decisión de agregados precalculados o compute mayor es de M6/M7 con la medición del hito de M5 en la mano; `refresh materialized view` dentro de una función no viola la regla de migraciones, así que la vía está abierta.
5. **Las tandas son `upsert … ignoreDuplicates` sobre la clave primaria, con hasta tres reintentos.** La ficha hacía `insert` plano y "ante cualquier error el cliente descarta el mes". Una respuesta perdida en la red (el caso más común de "error") habría costado un mes entero cada vez. Como la PK es sobre columnas, PostgREST admite el `onConflict` (es el mismo patrón que el `upsert` de M2), y la publicación sigue conciliando contra la base, así que la idempotencia no esconde nada. `clave_repetida` desaparece como error.
6. **El candado de 30 minutos no bloquea al propio usuario.** Si Javier cierra la pestaña y vuelve a subir el archivo, la ficha lo hacía esperar media hora (`409 carga_en_curso`). Ahora abrir una carga abandona la `en_curso` del mismo usuario aunque no haya caducado; el candado sigue protegiendo contra otra persona.
7. **El bloqueo por errores del 2 % es por mes, saltable y forzable con marca visible.** Como estaba, un archivo de un año se bloqueaba entero por un mes con un error de clasificación, y en el piloto las 263 combinaciones nuevas (1,7 % de las filas) rondan el umbral. Ahora el mes bloqueado se salta, los demás se cargan, y la casilla "Cargar también los meses bloqueados" lo fuerza dejando el badge **Incompleto N %** en Cargas por mes hasta que se recargue. Es el criterio de `DECISIONES` del 2026-10-02 ("avisar y dejar cargar lo válido") aplicado al grano del mes, sin trampa: lo forzado se ve.
8. **`tiendas_excluidas` se descarta.** Una tabla, tres endpoints, un botón y una pregunta abierta para tres valores, cuando M4 ya define `activo = false` como "fila que no debe volver a aparecer" y el resolutor de M5 ya tenía `tienda_inactiva` como exclusión informativa. Javier crea las tres desactivadas y listo. Queda como alternativa en la pregunta abierta 2 por si no las quiere en el maestro. `docs/PLAN.md` §4 y §5 se corrigen en consecuencia.
9. **Toda la API de M5 exige `requirePlanner`, lecturas incluidas.** La ficha dejaba `GET /api/ventas/cargas` (totales de venta y **costo** por mes) en `requireUser`: un comprador que no ve la pantalla podía leer el margen de la empresa con `curl`. Es la primera vez que una lectura no es `requireUser`; la razón (cifras de planificación, no vocabulario de maestro) queda como decisión propuesta 10 y como pregunta abierta 4 para que Javier confirme qué verá el comprador en M8.
10. **Contradicción resuelta sobre marcas desactivadas.** "Estructura del archivo" decía que una marca existente se usa "activa o no" y la precedencia de motivos la excluía con `marca_inactiva`. Gana la exclusión informativa, por coherencia con tiendas (M4) y con el significado de `activo` en todo el sistema.
11. **Funciones SQL: de dos a tres (y distintas).** `totales_cargas_publicadas()` para `?verificar=1` (la ficha prometía recalcular en SQL sin decir con qué) y `cargas_pendientes_limpieza()` para que la limpieza se guíe por las filas que de verdad quedan y no por `limpiada_at` (una fila que entrara por una carrera entre una tanda tardía y el abandono habría quedado huérfana para siempre). `limpiar` pasa a un `delete` por carga (prefijo de la PK; décimas de segundo) en lugar de catorce por tienda. Se dejó anotado para M6/M7 que el tope de 1 000 filas de PostgREST también aplica a funciones `setof`.
12. **Prueba de la regla 34 corregida.** Con `security_invoker` y RLS sin políticas, `anon` obtiene **cero filas** de la vista, no un error; el error de permiso solo aparece en las funciones (`revoke execute`). Se añadió que `on delete restrict` no cuenta como `DELETE` prohibido: 0002 a 0006 ya lo llevan y pasaron por `execute_sql`.
13. **Identidad del reporte con filas fusionadas.** `archivo = cargado + exclusiones` en filas no cerraba cuando hay claves repetidas que se suman; ahora `archivo = cargadas + fusionadas + excluidas` en filas y la igualdad exacta en las cinco medidas.
14. **Detalles verificados contra el código y corregidos**: la tabla de columnas lleva los `aCodigo` que `detectarMapeo` compara (`AÑO` → `ANO`, `Vta S/` → `VTA_S`…); el BOM no estorba porque `trim()` quita `\uFEFF`; los tipos de la vista van bajo `Database["public"]["Views"]` y no por `Tables<…>`; no se depende de *embeds* a través de la vista; el `DELETE` de marcas hoy pasa `0` a `motivoRechazoEliminar` y hay que cambiarlo; `MENSAJES_FK` suma también la FK de `agrupacion_talla_id`; son 584 tests (40 archivos), no 583; el límite de 10 MB de `proxyClientMaxBodySize` solo actúa al clonar el cuerpo para `proxy.ts` (`getCloneableBody` en `next-server.js`) y `/api` está fuera del `matcher`; los route handlers no tienen tope propio (el 1 MB es de Server Actions); Railway no documenta tope; `statement_timeout` de `service_role` se mide en el piloto.
15. **Datos reales fuera de la ficha.** Dos nombres de marca reales que ilustraban la regla "sin alias" se cambiaron por ejemplos inventados. Lo demás son conteos y porcentajes.

### Qué se dejó igual y por qué

- **Camino B (cargas con estado + vista + publicación por `update`).** Es la solución más simple que cumple las dos garantías dentro de las reglas de migración: A (borrar e insertar) deja el mes parcial visible y sin transacción en PostgREST no hay cómo evitarlo; C exige `delete` dentro de una función; D exige DDL en tiempo de ejecución. La función de publicación hace falta de todos modos para medir sumas (PostgREST no agrega), y los dos `update` en una transacción respetan el único parcial. Que las filas viejas se limpien después, por handler, es el precio justo.
- **Hechos sin `id`, `activo` ni `updated_at`, PK compuesta con `carga_id` primero, FK `on delete restrict`.** Coherente con "eliminar tiendas y marcas con histórico responde 409" ya anunciado en M2 y M4; el conteo previo al `409` usa los índices nuevos para marca y equivalencia.
- **Marca al detalle con FK a `marcas`, agrupación leída del maestro.** Es lo que queda tras el cambio de alcance y es lo más simple: un `join` de ~500 filas al agregar; Vector-One copiaba la agrupación en cada fila y se desfasaba.
- **`Revisar` → CENTRALES sin guardar la talla original, `SIN MARCA` para el guion, VARIOS y OTROS en MID VALUE.** Decisiones de Javier.
- **Lectura por bloques en el navegador, previsualización por valores distintos, tandas con ids resueltos.** Los cambios en `leer-archivo.ts` son aditivos (`numerosCrudos` por defecto `false`) y M5 no usa `leerArchivoTabular` ni `useImportador` para CSV, así que M1 a M4 y sus 584 tests no se tocan.
- **Migración `0007` única e hito con septiembre como piloto.** Razonables; se añadieron al hito la medición de tamaño y de una agregación completa, el corte en una tanda, el mes forzado y mover de agrupación una marca creada por la carga.

### Riesgos que quedan

- El compute Micro del plan Pro es el límite real para M6/M7, no el disco; la medición del hito es la que debe decidir agregados o compute.
- `statement_timeout` del `service_role` no está verificado desde esta sesión.
- Los nombres de tienda de QlikView tienen que coincidir letra a letra (tras normalizar) con los de M4; si difieren en abreviaturas, se corrigen en M4 antes del piloto.
- Las marcas creadas por la carga nacen todas en la agrupación por defecto: si la lista de M2 no se carga antes, hay ~280 marcas que mover a mano (o un modo "actualizar" en el importador de M2, pregunta 4 de esa ficha).
- La ventana entre previsualizar y cargar no es transaccional (como en M1 a M4): un maestro que cambie en esos minutos se detecta por la FK o por `no_concilia`, no antes.
