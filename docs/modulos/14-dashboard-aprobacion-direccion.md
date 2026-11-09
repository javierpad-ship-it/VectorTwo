# M14 · Tablero de aprobación de dirección (proyección mes a mes frente a lo vendido)

> Estado: **especificada (2026-11-09), pendiente de las decisiones de Javier (§10) y de la revisión independiente (`arquitecto-revisor`, opus) antes de construir.** Módulo nuevo, número 14 (libre: las fichas llegan hasta `13-intercompany.md`). Versión prevista **`0.19.0 · M14`** (la siguiente a la vigente `0.18.0 · M8 c`; módulo nuevo, sube la menor). Commits `M14: ...`. Una migración, citada con el marcador **`00D1_tablero_direccion.sql`** (decisión 48: `datos` le pone la siguiente libre al cerrar; hoy sería la **`0041`**, que `docs/PLAN.md` §5 tiene reservada para «la tabla de agregados de venta» cuyo alcance «lo fija su ficha»: esta ficha es la que lo fija, §2.4). Depende de [07](07-proyeccion-anual.md) (§3 bloques, §5 método, §6.3 a 6.6, `GET /api/proyeccion/cerrada` y `…/mensual`), [07c](07c-crecimientos-por-genero-mundo.md) (crecimiento declarado por GM), [06e](06e-cierre-del-anio-y-base-sin-nino.md) (base corregida del Niño, `estadoFactorY`), [07f](07f-venta-por-tienda-en-crecimientos.md) (venta por tienda sin CD, atribución por tienda informativa, decisiones 110 a 113), [07g](07g-aprobacion-en-bloque.md) (huellas, filas aprobadas en bloque) y [08](08-flujo-y-compras.md) (M8 lee la cerrada). Cifras sintéticas; ningún dato real de Lukers.

**Petición de Javier (textual):** «para poder aprobar a nivel de dirección necesito un dashboard para aprobar las proyecciones, donde vea y pueda filtrar por GML y tiendas lo que se está proyectando para cada mes, teniendo en cuenta lo vendido en los años pasados y el que va en curso». **Precisión posterior (coordinador, a pedido de Javier):** la **agrupación de marca es un filtro de primer nivel**, combinable con todos los demás, que se aplica a lo proyectado y a la venta de años pasados y del año en curso y sale en el Excel; si es razonable, también la **marca individual** dentro de una agrupación.

## 1. Objetivo

Hoy la proyección se trabaja en cinco pestañas pensadas para el planner (Por línea, Matriz, Mensual, Crecimientos, Aprobación en bloque) y no hay un lugar donde dirección vea, en una sola pantalla y mes a mes, **qué se está proyectando** (el cierre del año en curso y el año siguiente) **frente a lo vendido** en los tres años anteriores y en lo que va del año, recortado por género, mundo, línea, agrupación de marca, marca y tienda. M14 da ese tablero (gráfico mensual, tabla, comparativos y alertas) en **solo lectura**, y añade un **registro inmutable de aprobación de dirección**: quién aprobó, cuándo, qué proyección y con qué huella exacta de cifras, con resultado *aprobada*, *con observaciones* o *rechazada*. La aprobación **queda invalidada sola** si la proyección cambia después. No cambia ningún cálculo de M7 ni lo que M8 lee.

### 1.1 Decisiones de diseño (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Tablero de solo lectura sobre lo guardado.** Lee `proyeccion_fila_anios.meses` (el reparto ya hecho) y nunca recalcula ni reparte. | Es lo que dice 07 §5 paso 6 («la vista Mensual y `GET /api/proyeccion/cerrada` suman; nunca vuelven a repartir»). Así lo que ve dirección es exactamente lo que M8 consumirá. |
| D2 | **Unidades, no soles.** El histórico trae soles, pero la proyección no proyecta soles (decisión 110: no se inventan soles del cierre). El tablero compara unidades con unidades. | Mezclar S/ reales con u proyectadas invita a leer un crecimiento en soles que nadie decidió. Soles: §7. |
| D3 | **Agrupación de marca (AM) como filtro de primer nivel**, con el mismo peso que GML y tienda. En la proyección es exacto (cada fila es GML × AM). En la venta es exacto (se resuelve con la unidad de marca, como `venta_proyeccion`). | Petición expresa de Javier. |
| D4 | **Marca individual: sí, como filtro de segundo paso dentro de una AM.** Venta: exacta. Proyección: **estimada** con `participaciones.por_marca` de la fila base (07 «Cambios 0.10.1» punto 4, I6), rotulada «estimado». | M7 no decide por marca; la única forma honesta de recortar lo proyectado por marca es la participación histórica que ya guarda la cerrada y que M8 usa para repartir. Descartado: releer venta por marca para cada fila (no cambia nada: es la misma participación). |
| D5 | **Tienda: exacta en tiendas nuevas y cierres; estimada en mismas tiendas.** Las filas base (`tienda_id null`) suman todo `M(Z)` y no tienen tienda; lo de una tienda «misma» se atribuye por su participación en la venta de los últimos 12 meses cerrados del mismo recorte, rotulado «estimado». | Es el criterio de 07f (decisión 111: atribución informativa proporcional al real, que cuadra en la suma). Descartado: guardar la proyección por tienda (cambiaría M7 y el contrato de M8). |
| D6 | **Se muestra por defecto la cerrada vigente** del año en curso (la que lee M8), con un selector para ver otra (en trabajo, archivada) y la opción **«Comparar con»** una segunda proyección (p. ej. la cerrada frente a «seguimiento sep»). | Dirección aprueba lo que va a comprar; la en trabajo es útil para ver hacia dónde se mueve. §4.3. |
| D7 | **Aprobar es solo del `admin`** (`requireAdmin`); admin y planner ven el tablero y el historial; el comprador no ve nada (decisión 113). **Sin rol nuevo.** | Es la opción más simple y segura con los tres roles de hoy. Un rol `direccion` (ver sin poder editar maestros) se puede añadir después sin cambiar el registro (guarda `rol` y `perfil_id`). §5.1. |
| D8 | **La aprobación no bloquea ni el cierre ni el flujo/compras; se ve como estado y aviso** («cerrada sin aprobación de dirección vigente») en la cabecera de Proyección y de Flujo mensual. | §5.1: las opciones de bloquear quedan descartadas con su porqué. |
| D9 | **Huella de cifras calculada en SQL** (`huella_proyeccion`), en una sola sentencia; la aprobación guarda la huella y se compara al leer. Cambia la huella → la aprobación pasa a **invalidada** (derivado, no se escribe). | Evita paginar 9 000 registros en Node para hacer un hash y garantiza que la huella sale de un solo estado de los datos. |
| D10 | **Dos funciones de lectura agregadas y filtradas en SQL** (venta y proyección), que devuelven un `jsonb` pequeño (≤ 300 KB), más una caché en proceso por huella. Plan B medido: una tabla de agregados de venta de solo inserción por carga (§2.4). | El límite de 1 000 filas de PostgREST no aplica a un `jsonb` de una fila, y el corte de 8 s se respeta agregando en la base. |

## 2. Modelo de datos (`00D1_tablero_direccion.sql`)

Convenciones de `docs/PLAN.md` §3 y de `0013` a `0040`: idempotente (`create table if not exists`, `create or replace function`, `create index if not exists`, `create or replace trigger`), **sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`** en la migración, sin bloques `do $$`, sin backfill, cuerpos de función sin comentarios `--`, identificadores ≤ 63 caracteres. Toda tabla con `id uuid`, `activo`, `created_at`, `updated_at`, RLS activo **sin políticas**, `revoke all … from public, anon, authenticated`. Funciones `security invoker`, `set search_path = ''`, todo calificado con esquema, `revoke execute … from public, anon, authenticated`, `grant execute … to service_role`, `comment on`. Al final, `insert into public.migraciones_aplicadas … on conflict do nothing` (patrón de la `0035`). Se aplica con el MCP de Supabase **en `vector-two`, nunca en `lukers-compras`**.

### 2.1 Tabla `aprobaciones_direccion` (solo inserción)

Una fila por acto de aprobación. Nunca se edita ni se borra: una aprobación nueva sobre la misma proyección **no reemplaza** la anterior, se suma al historial; la «vigente» se deriva al leer (§5, R10).

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | no | |
| `proyeccion_id` | `uuid → proyecciones(id) on delete restrict` | no | **`restrict`**: una proyección con aprobaciones no se puede eliminar (hoy solo se elimina una en trabajo sin decisiones, 07 §6.3); la API traduce el error a `409 tiene_aprobaciones` («archívala»). Índice `(proyeccion_id, created_at desc)`. |
| `anio_en_curso` | `integer` | no | Copia de `proyecciones.anio_en_curso` al aprobar; `check between 2024 and 2100`. Para listar sin unir. |
| `estado_proyeccion` | `text` | no | `check in ('en_trabajo','cerrada')`: el estado de la proyección **al aprobar**. Una archivada no se aprueba. |
| `huella` | `text` | no | `check (huella ~ '^[0-9a-f]{32}$')`: md5 de `huella_proyeccion` (§2.3) en el instante de aprobar, calculada **por la función de registro**, no por el cliente. |
| `resultado` | `text` | no | `check in ('aprobada','con_observaciones','rechazada')`. |
| `comentario` | `text` | sí | `check (char_length(comentario) <= 1000)`. |
| `motivo` | `text` | sí | `check (char_length(motivo) <= 60)`; catálogo validado por zod (§3.2): `crecimiento_alto`, `crecimiento_bajo`, `tiendas_nuevas`, `nino`, `filas_sin_decidir`, `concentracion`, `otro`. **Obligatorio si `resultado <> 'aprobada'`**: `check ((resultado = 'aprobada') or (motivo is not null and comentario is not null and char_length(btrim(comentario)) >= 10))`. |
| `resumen` | `jsonb` | no | Foto de lo que se aprobó, para leerla aunque la proyección cambie: `{ hasta_periodo, version_metodo, totales: { anio, vigente, vendido }[], por_gm: { gm_clave, nombre, en_curso, siguiente, crecimiento_declarado_pct, crecimiento_implicito_pct }[], alertas: { codigo, cantidad }[], filtros_vistos }`. Lo arma el servidor (≤ 32 KB; `check (pg_column_size(resumen) <= 65536)`). `filtros_vistos` es informativo: **la aprobación es siempre de la proyección entera**, no del recorte (R12). |
| `perfil_id` | `uuid → perfiles(id) on delete set null` | sí | Índice. `set null` para no impedir eliminar un usuario; el nombre queda. |
| `usuario_nombre` | `text` | no | Nombre o correo al aprobar (`check (char_length(usuario_nombre) between 1 and 200)`). |
| `rol` | `text` | no | `check in ('admin','planner','comprador')`: el rol al aprobar (hoy siempre `admin`; queda para cuando exista otro rol aprobador). |
| `activo` | `boolean not null default true` | no | Por convención; **sin uso** (no se «desactiva» una aprobación: se registra otra). |
| `created_at`, `updated_at` | `timestamptz not null default now()` | no | Trigger `tg_set_updated_at` por convención (nunca se dispara: no hay `update`). |

**Inmutabilidad (patrón de `proveedor_eventos`, `0039`).** Función de trigger `tg_aprobaciones_direccion_inmutable()` que rechaza `delete`, `truncate` y todo `update` **salvo** el que solo pone `perfil_id` en `null` (lo hace la FK `set null`), con `errcode = 'restrict_violation'` y el mensaje «aprobaciones_direccion es un registro inmutable». Triggers `before update or delete … for each row` y `before truncate … for each statement`. Vale también para `service_role`.

**Privilegios (regla de la `0035` y hallazgo H-6 de la `0040`).** `revoke all on public.aprobaciones_direccion from public, anon, authenticated, service_role;` y después `grant select, insert on … to service_role;` (sin `update`, `delete`, `truncate`, `references` ni `trigger`). Se añade a la lista de tablas de solo inserción que `docs/PLAN.md` cita en la `0035`.

**Por qué una tabla propia y no columnas en `proyecciones`.** Una proyección puede tener varias aprobaciones en su vida (una con observaciones, luego aprobada; aprobada, cambia, vuelta a aprobar) y la pregunta de auditoría es «quién vio qué y cuándo»: con columnas se pisaría la historia. **Por qué `restrict` y no `cascade`.** Borrar una proyección no debe borrar el rastro de una decisión de dirección.

### 2.2 Qué se lee de lo que ya existe (sin escribir nada)

| Dato | De dónde | Para qué |
|---|---|---|
| `anio_en_curso`, `nombre`, `estado`, `hasta_periodo` (`k`), `calculando_desde`, `cerrada_at`, `cerrada_por_nombre`, `resumen.version_metodo`, `resumen.gm_con_nino`, `parametros.bloques[Y]` y `[Y+1]` (con `claves`), `parametros.factores_usados` | `proyecciones` | Cabecera, bloques de tiendas (mismas, nuevas, aperturas, cierres, fuera) **con los que se calculó**, claves de pertenencia `M(Y−3)…M(Y+1)` para «mismas tiendas» en los años históricos |
| Por registro activo: `anio`, `bloque`, `subbloque`, `vendido`, `propuesto`, `decidido`, `origen`, `meses[12]`, `origen_meses[12]`, `base_siguiente` (`B`), `base_normalizada` (`B'`), `crecimiento_pct`, `avisos`; de la fila: `gml_id`, `equivalencia_id`, `agrupacion_marca_id`, `tienda_id`, `participaciones->'por_marca'` (solo filas base) | `proyeccion_fila_anios` ⋈ `proyeccion_filas` (`activo = true`), **dentro de `tablero_proyeccion`** (§2.3) | Serie mensual proyectada, totales, decididas / sin decidir, crecimiento implícito, alertas |
| `decidido`, `propuesto`, `vendido`, `bloque`, `subbloque`, `fecha_usada` por tienda y año | `proyeccion_tiendas` (pocas filas, `leerTodo`) | Tiendas nuevas y cierres sin decidir; textos de apertura |
| `pct`, `sobre_base` por GM; el Resto en `parametros.crecimiento_pct_defecto` / `crecimiento_resto_usado` | `proyeccion_crecimientos` (≤ 2 × 5 filas) | Crecimiento **declarado** |
| Efectivo, `parcial`, estado por temporada de `Y` | `factores_volumen_atipico` + `estadoFactorY` (`src/lib/proyeccion`), reutilizado tal cual | Alerta «factor provisional» |
| Venta histórica y del año en curso por mes, tienda y dimensión del desglose | `venta_stock_vigente` (solo cargas publicadas), **dentro de `tablero_venta`** (§2.3) | Las líneas 2023, 2024, 2025 y el real del año en curso |
| Catálogo (géneros, mundos, líneas, nodos GML/GMLE, agrupaciones de marca, marcas y su unidad de marca, tiendas con código y nombre) | `cargarCatalogo`, `leerAgrupacionesMarca`, tablas pequeñas con `leerTodo` | Filtros y nombres |

**No lee** `historico` de las filas (es pesado y no hace falta: el histórico sale de la venta), `ia_*`, stock ni costo.

### 2.3 Cuatro funciones nuevas

**a) `tablero_venta(p jsonb) returns jsonb`** — `language sql stable security invoker set search_path = ''`.

- **Entrada** (`p`, validada antes por zod en el servidor; la función tolera claves ausentes): `{ "gml_ids": uuid[] | null, "agrupacion_marca_ids": uuid[] | null, "marca_ids": uuid[] | null, "tienda_ids": uuid[] | null, "desde": "aaaa-mm-01", "hasta": "aaaa-mm-01", "desglose": "genero" | "mundo" | "linea" | "agrupacion_marca" | "marca" | "tienda" | null, "proyeccion_id": uuid | null }`. `null` = sin filtro en esa dimensión. Los `gml_ids` los arma el backend desde el catálogo (género / mundo / línea → nodos), igual que 07f, y viajan en el cuerpo del `rpc`.
- **Qué lee.** `venta_stock_vigente` ⋈ `tiendas` con **`tipo = 'Tienda'`** (el CD nunca entra) ⋈ `equivalencias` (para el nodo) ⋈ `marcas_unidad` ⋈ `marcas` (la **agrupación de la unidad de marca**, exactamente como `venta_proyeccion`: `join marcas_unidad mu on mu.marca_id = v.marca_id join marcas cab on cab.id = mu.unidad_marca_id`, AM = `cab.agrupacion_marca_id`). El filtro de marca individual es sobre `v.marca_id` (la marca real vendida, no la cabeza). Selecciona **solo `unidades`** (ni soles, ni costo, ni stock: D2; una prueba estática lo verifica). Preagrega por `(equivalencia_id, marca_id, tienda_id, periodo)` y después sube, como `0027`, `0029` y `0033`.
- **Salida** (claves cortas, orden determinista):
  `{ "por_tienda": [ { "t": tienda_id, "p": "aaaa-mm", "u": n } ], "por_dim": [ { "d": id_de_la_dimensión, "p": "aaaa-mm", "u": n } ] | null, "fuera_universo": [ { "a": anio, "u": n } ] | null, "cargas": { "aaaa-mm": carga_id } }`.
  - `por_tienda` siempre (≤ 15 tiendas × 48 meses ≈ 720 tuplas): de ahí salen el total, las mismas tiendas de cada año (con las claves guardadas) y la atribución por tienda (D5).
  - `por_dim` solo si `desglose` no es nulo; `d` es el `genero_id`, `mundo_id`, `gml_id` (línea = nodo GML), `agrupacion_marca_id`, `marca_id` o `tienda_id`. Tope práctico: ≈ 220 nodos × 48 meses ≈ 10 600 tuplas (≈ 250 KB) con `desglose = linea` sin filtros, que es el peor caso.
  - `fuera_universo` solo con `proyeccion_id`: unidades por año de las combinaciones (nodo, AM) que **no** tienen fila activa en esa proyección (semiunión con `proyeccion_filas`): explica por qué 2023 puede traer venta de líneas que ya no se proyectan (fila sin venta en 24 meses, 07 §3).
  - `cargas` del mismo CTE: meses publicados dentro de `[desde, hasta]` (para «faltan meses» y para la huella de la caché).
- **Rango.** El backend pide desde enero de `Y−3` hasta el **último mes publicado `k'`** (no el `k` de la proyección): el año en curso se ve con todo lo vendido. ≤ 48 meses.

**b) `tablero_proyeccion(p_proyeccion_id uuid, p jsonb) returns jsonb`** — `language sql stable security invoker set search_path = ''`.

- **Entrada** `p`: los mismos filtros que `tablero_venta` salvo `desde`/`hasta` (la proyección trae sus dos años), más `"bloque": "todas" | "mismas" | "nuevas" | "cierres"`.
- **Cómo filtra.**
  - GML / AM: sobre `proyeccion_filas.gml_id` y `agrupacion_marca_id` (exacto).
  - Tienda (`tienda_ids` no nulo): las filas de tienda (`tienda_id = any(...)`) entran **exactas**; las filas base (`tienda_id is null`) entran **enteras**, separadas en la clave `"mismas_sin_atribuir"`, y el servidor las atribuye en TypeScript (D5, §4.4 regla de atribución): la función no conoce la venta por tienda y no debe adivinarla.
  - Marca (`marca_ids` no nulo): cada registro se multiplica por la participación de esas marcas en la fila base del mismo `(gml_id, equivalencia_id, agrupacion_marca_id)` (`participaciones->'por_marca'`; en las filas de tienda, la de su fila base, como hace M8). Si la fila base no trae `por_marca` (cerrada de `0.10.0`), su aporte cuenta en `"sin_participacion_marca"` y no en la serie. Los meses se suman en `numeric` y se redondean **una sola vez al final**, por mes, con `round` (la tabla avisa «estimado; puede no sumar exacto por redondeo»).
- **Salida:**
  ```jsonc
  { "anios": [ { "anio": 2026,
                 "bloques": { "mismas": { "meses": [12 numeros], "vigente": n, "vendido": n }, "nuevas_anterior": {…}, "aperturas": {…}, "cierres": {…} },
                 "por_tienda": [ { "t": tienda_id, "bloque": "nuevas", "subbloque": "aperturas", "meses": [12], "vigente": n } ],
                 "mismas_sin_atribuir": { "meses": [12], "vigente": n } | null,
                 "sin_meses": n,                       // vigente de registros con meses = null (sin curva): cuentan en el total, no en la serie
                 "base": { "B": n, "B_corr": n } | null, // solo Y+1, filas base con B no nulo
                 "conteos": { "registros": n, "decididos": n, "sin_decidir_bloquea": n, "sin_decidir_cola_larga": n, "aprobados_en_bloque": n,
                              "propuesta_cambio": n, "curva_cambio": n, "sin_curva": n } } ],
    "por_dim": [ { "d": id, "anio": n, "meses": [12], "vigente": n } ] | null,
    "mayores": [ { "fila_id", "gml_id", "agrupacion_marca_id", "anio": Y+1, "vigente": n, "base": n | null } ],   // las 20 filas base de mayor vigente en Y+1 dentro del recorte
    "por_gm": [ { "genero_id", "mundo_id", "B": n, "B_corr": n, "siguiente": n, "en_curso": n } ],               // para crecimiento implícito vs declarado
    "sin_participacion_marca": n | null,
    "huella": "md5" }
  ```
  `vigente = decidido ?? propuesto`; `sin_decidir_bloquea` cuenta los registros base con `decidido is null` y `propuesto >= parametros.umbral_cola_larga` (la misma regla que bloquea cerrar, 07 paso 7); `aprobados_en_bloque` cuenta los que tienen lote aplicado (07g: `proyeccion_fila_anios.decision_lote_id` no nulo, columna de la `0031`). `huella` es la de §2.3 c, calculada en la misma sentencia: lo que se dibuja y lo que se aprueba salen del mismo estado.
- **Tamaño:** ≤ 60 KB sin desglose; ≤ 200 KB con `desglose = linea` (≈ 220 nodos × 2 años × 12 meses).

**c) `huella_proyeccion(p_proyeccion_id uuid) returns text`** — `language sql stable security invoker set search_path = ''`.

`md5` de la concatenación ordenada de:
1. `proyecciones`: `id`, `anio_en_curso`, `hasta_periodo`, `resumen->>'version_metodo'`, `parametros->'bloques'` (texto canónico de `jsonb`).
2. Cada registro **activo** de `proyeccion_fila_anios` de filas activas, ordenado por `(fila_id, anio)`: `fila_id`, `anio`, `bloque`, `coalesce(decidido, propuesto)`, `meses` (texto del arreglo).
3. Cada fila de `proyeccion_tiendas` activa, ordenada por `(tienda_id, anio)`: `tienda_id`, `anio`, `coalesce(decidido, propuesto)`.
4. `proyeccion_crecimientos` ordenado por `(genero_id, mundo_id)`: `pct`, `sobre_base`; y `parametros->'crecimiento_pct_defecto'`.

**No entran** `estado`, `nombre`, `nota`, `cerrada_at`, `updated_at`, `explicacion`, `avisos` ni quién decidió: **cerrar una proyección aprobada en trabajo no invalida la aprobación** si las cifras son las mismas (R11), y renombrarla tampoco. Entra todo lo que mueve una cifra mensual que M8 leería o un crecimiento declarado que dirección vio. `md5` porque es nativo (sin `pgcrypto`), basta para detectar cambios (no es un control contra un atacante: quien puede escribir la proyección ya es planner) y es la misma convención de las huellas de M6. Costo: ≈ 9 000 registros × ~80 bytes → un `string_agg` de ~0,7 MB, **objetivo ≤ 300 ms**.

**d) `registrar_aprobacion_direccion(p jsonb) returns jsonb`** — `language plpgsql volatile security invoker set search_path = ''`.

Entrada: `{ proyeccion_id, huella_vista, resultado, motivo, comentario, resumen, perfil_id, usuario_nombre, rol }` (todo validado antes por zod; el servidor pone perfil, nombre y rol desde la sesión, nunca desde el cuerpo). En una transacción:
1. `select … from proyecciones where id = … for share` (impide que otra sesión cierre, archive o borre la proyección mientras se registra; `calcular` y las decisiones escriben `proyeccion_fila_anios`, no `proyecciones`, así que el paso 3 es el que de verdad los detecta).
2. Si no existe → `{ "error": "no_encontrada" }`; si `estado = 'archivada'` → `archivada`; si `calculando_desde` vivo (< 15 min, `CALCULO_CADUCA_MIN`) → `calculo_en_curso`; si nunca se calculó (`resumen is null`) → `sin_calcular`.
3. `huella_proyeccion(id)` ≠ `huella_vista` → `{ "error": "huella_distinta", "huella_actual": … }` **sin insertar**.
4. `insert into aprobaciones_direccion …` con la huella **recalculada** y `estado_proyeccion` leído en el paso 1; devuelve la fila.

Los códigos de error vuelven en el `jsonb` (no `raise`), como `aplicar_lote_proyeccion` de 07g, para que el handler los traduzca a `409` sin parsear mensajes. Es la **única** función que escribe en `aprobaciones_direccion`; el handler no hace `insert` directo (prueba estática).

**Todas:** `revoke execute … from public, anon, authenticated;` `grant execute … to service_role;` `comment on function`. `tablero_venta` lleva `set work_mem = '16MB'` como las siete lecturas pesadas de la `0037`.

### 2.4 Rendimiento y el plan B de la tabla de agregados (reserva `0041`)

**Plan A (el que se construye):** `tablero_venta` agrega sobre `venta_stock_vigente` en cada llamada (≈ 0,9 a 1,5 millones de filas con talla). Referencias medidas en Vector2 de lecturas parecidas: `venta_mensual_tienda` 0,5 s; `venta_estacionalidad_agrupacion` 0,6 a 1,5 s; `venta_tienda_nodos` del Resto 1,3 a 2,1 s en caliente. Se espera ≈ 1 a 2 s sin filtros y menos con filtro de GML (semiunión sobre `equivalencias`, índice existente). Encima, una **caché en proceso por huella** (patrón de `src/lib/curvas/cache-venta-tienda.ts`): clave = `huellaCargas` + huella de maestros (equivalencias → nodo, marcas → unidad → AM; md5 de ids y FKs, una lectura pequeña) + filtros canónicos; LRU de 24 entradas, TTL de seguridad 5 min, *single-flight*, nunca guarda lo leído si la huella cambió en medio. Cambiar de filtro y volver es instantáneo; el primer recorte nuevo paga la agregación.

**Puerta de medición (la corre `datos` en la tanda 1, antes de que `backend` empiece la tanda 2):** `explain (analyze, buffers)` de `tablero_venta` en `vector-two`, dos pasadas, en cuatro casos: (1) sin filtros con `desglose = linea`; (2) sin filtros con `desglose = marca`; (3) una AM sola; (4) una marca y una tienda. Se anotan al pie de la migración tiempo frío/caliente y tamaño.
- Si el caso 1 o 2 pasa de **2,5 s en frío** o el documento de **300 KB**, se activa el **plan B dentro de la misma migración** (no abre otra versión).

**Plan B (diseñado, se construye solo si la puerta lo pide): tabla `venta_agregada_carga`**, la «tabla de agregados de venta» que reservaba la `0041`.
- Grano: `(carga_id, tienda_id, equivalencia_id, marca_id)` con `unidades bigint` y `venta_soles numeric(14,2)` (soles por si M14b u otro módulo los quiere; esta ficha no los lee). Sin `periodo` (sale de la carga), sin talla (es lo que reduce el tamaño, se espera 3 a 6 veces menos filas). Único sobre las cuatro claves; FK `carga_id → cargas_venta_stock on delete cascade` (una carga solo se borra si nunca se publicó).
- **Solo inserción e inmutable**, porque los hechos de una carga no cambian nunca (es el argumento de la caché de `venta_mensual_tienda`): se llena con `agregar_carga_venta(p_carga_id)` (`insert … select … on conflict do nothing`), que llama la API de M5 **después de publicar** y que `tablero_venta` también llama, en modo perezoso, para cada carga publicada que todavía no tenga filas. Republicar un mes crea filas de la carga nueva; las de la vieja quedan y se ignoran porque `tablero_venta` une con `cargas_venta_stock.estado = 'publicada'`.
- **Por qué no guarda nodo ni AM:** el nodo de una equivalencia y la agrupación de una marca se editan en los maestros; guardarlos obligaría a invalidar la tabla. Se resuelven al leer con el mismo `join` que el plan A.
- Mismo trigger de inmutabilidad, `grant select, insert` a `service_role`, RLS sin políticas.
- Descartado: una vista materializada (06b la abandonó por el candado y el refresco) y una tabla con nodo/AM desnormalizados (se pudre al editar maestros).

**Proyección:** `tablero_proyeccion` recorre ≈ 9 000 registros con `unnest(meses) with ordinality`: objetivo ≤ 400 ms; no necesita caché, pero el servidor guarda la última respuesta por `(proyeccion_id, huella, filtros)` (LRU 24) porque la huella sale de la misma llamada.

**Presupuesto de la pantalla:** primera carga del tablero (opciones + venta + proyección en paralelo) **≤ 3 s en frío y ≤ 1 s en caliente**; cambio de filtro **≤ 2 s en frío, ≤ 300 ms con caché**; respuesta de `GET /api/direccion/tablero` **≤ 400 KB** (sin desglose ≤ 120 KB); registrar una aprobación ≤ 1 s. Ninguna sentencia cerca de los 8 s de PostgREST.

**Costo del filtro de AM y de marca (respuesta a la pregunta del coordinador).**
- AM en la proyección: **gratis** (columna de la fila, índice `(proyeccion_id, gml_id)` existente; el filtro se aplica en el mismo recorrido).
- AM en la venta: el `join` con `marcas_unidad` y `marcas` ya está en el plan A (lo necesita el desglose por AM); filtrar **reduce** filas tras el `join`. Costo marginal ≈ 0.
- Marca en la venta: filtro directo sobre `v.marca_id`, que ya tiene índice (`venta_stock_mensual_marca_idx`, `0007`); no se crea índice nuevo sobre la tabla de hechos. Si la medición del caso 4 pasa de 1,5 s, se resuelve con el plan B.
- Marca en la proyección: lee `participaciones->'por_marca'` de las filas base del recorte (≈ 2 000 objetos `jsonb` chicos): + 50 a 150 ms estimados.
- `desglose = marca` es el más pesado en tamaño (cientos de marcas × 48 meses): por eso la pantalla solo lo ofrece **con una AM elegida** (§4.4), lo que lo acota a decenas de marcas.

### 2.5 Diagrama

```
venta_stock_vigente ─► tablero_venta(filtros) ─┐ (caché por huella de cargas + maestros + filtros)
  (sin CD, solo u)      [plan B: venta_agregada_carga]
                                               ├─► servicio del tablero (TS puro: armarTablero) ─► GET /api/direccion/tablero ─► pantalla (gráfico + tablas + alertas)
proyeccion_filas ⋈ proyeccion_fila_anios ─► tablero_proyeccion(id, filtros) ─┤      ▲ atribución por tienda (D5), comparativos, alertas
proyeccion_tiendas, proyeccion_crecimientos, factores (estadoFactorY) ───────┘      │
                                                     huella_proyeccion(id) ──────────┴─► registrar_aprobacion_direccion(p) ─► aprobaciones_direccion (solo inserción)
                                                                                                         ▲ POST /api/direccion/aprobaciones (requireAdmin)
```

## 3. Contratos de API

Convenciones de M1 a M8: `ok` / `error` / `errorConCodigo` / `leerCuerpo` (`src/lib/api/respuestas.ts`), `traducirErrorDb`, `leerTodo` solo para tablas pequeñas. **Cada handler empieza con su guard como primera sentencia** (prueba estática, como `tests/api.guards.roles.test.ts`). Datos solo con `supabaseAdmin()` desde el servidor. Handlers en `src/app/api/direccion/`; lógica pura en `src/lib/direccion/` (`tipos-api.ts` autocontenido, `esquemas.ts`, `tablero.ts`, `atribucion.ts`, `comparativos.ts`, `alertas.ts`, `aprobacion.ts`, `excel.ts`); acceso a datos solo en `src/lib/direccion/consultas.ts`, **único archivo que nombra `tablero_venta`, `tablero_proyeccion`, `huella_proyeccion` y `registrar_aprobacion_direccion`** (prueba estática); caché en `src/lib/direccion/cache.ts` (sin `@supabase/*`). Reutiliza sin modificar `src/lib/proyeccion/` (`estadoFactorY`, `correccionMaterial`, `UMBRAL_CORRECCION_NINO`, `generosDeMatriz`, `claveGM`, tipos de bloques, `calculoEnCurso`), `src/lib/arbol/consultas.ts` (`leerTodo`, catálogo) y `src/lib/curvas/grafico.ts`. Errores: `401` sin sesión · `403` rol · `400` zod · `404` · `409` regla · `500` (`fallaDb`, sin filtrar detalles de la base).

### 3.1 Rutas

| Ruta | Método | Guard | Entrada | Respuesta `{ data }` y errores |
|---|---|---|---|---|
| `/api/direccion/opciones` | GET | `requirePlanner` | — | `OpcionesTableroApi`: proyecciones no eliminadas (id, nombre, año, estado, `hasta_periodo`, `cerrada_at`, cuál es la **cerrada vigente** de cada año y cuál la **en trabajo más reciente**), géneros, mundos, líneas (con `genero_id`, `mundo_id`), agrupaciones de marca (orden de M2), marcas por agrupación (solo activas o con venta; id, nombre, `agrupacion_marca_id`), tiendas `tipo = 'Tienda'` (id, código, nombre, apertura, cierre, activa). No lee venta. |
| `/api/direccion/tablero` | GET | `requirePlanner` | query `tableroQuerySchema` (§3.2) | `200 TableroApi` (§3.3). `400` filtros mal formados o `marca_id` sin `agrupacion_marca_id` (o de otra AM: `400 marca_fuera_de_agrupacion`); `404 proyeccion_no_encontrada`; `409 sin_calcular` («Calcula la proyección para verla en el tablero»); `409 calculo_en_curso` (mensaje de M7); `409 comparar_igual` (comparar con la misma); `500`. Una proyección **archivada** se puede ver (solo lectura, sin botón de aprobar). |
| `/api/direccion/aprobaciones` | GET | `requirePlanner` | `?proyeccion_id=<uuid>` (obligatorio) | `{ huella_actual, vigente: AprobacionApi \| null, estado: EstadoAprobacion, historial: AprobacionApi[] }` (más reciente primero; cada una con `invalidada: boolean` = su huella ≠ la actual). `404`; `400`. |
| `/api/direccion/aprobaciones` | POST | **`requireAdmin`** | `aprobarSchema` (§3.2) | `201 AprobacionApi`. `403` planner o comprador; `400` (zod: motivo y comentario obligatorios si no es `aprobada`; `confirmo_revision` debe ser `true`); `404 proyeccion_no_encontrada`; `409 huella_distinta` («La proyección cambió mientras la mirabas: vuelve a cargar el tablero», con `huella_actual`); `409 archivada`; `409 calculo_en_curso`; `409 sin_calcular`; `500`. El servidor arma `resumen` con `armarResumenAprobacion` sobre una lectura **sin filtros** del tablero de esa proyección (la aprobación es de la proyección entera, R12) y llama a `registrar_aprobacion_direccion`. |
| `/api/direccion/estado` | GET | `requirePlanner` | `?proyeccion_id=<uuid>` | `{ estado: EstadoAprobacion, vigente: { resultado, usuario_nombre, created_at } \| null }`. Lectura barata (una aprobación + una huella) para el aviso de cabecera en Proyección y en Flujo mensual (§4.6). `404`. |

Ninguna ruta `GET` tiene efectos; la única mutación es el `POST`. No hay `PUT`, `PATCH` ni `DELETE` de aprobaciones (no existen: se registra otra). No hay ruta de descarga: el Excel se arma en el navegador (§4.5).

### 3.2 Esquemas (`src/lib/direccion/esquemas.ts`)

```ts
const uuid = z.string().uuid();
const listaUuid = (max: number) => z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(uuid).max(max));

export const tableroQuerySchema = z.object({
  proyeccion_id: uuid.optional(),                       // ausente = la cerrada vigente del año en curso de hoy; si no hay, la en trabajo más reciente
  comparar_id: uuid.optional(),                         // segunda proyección dibujada aparte (D6)
  genero_id: uuid.optional(), mundo_id: uuid.optional(), linea_id: uuid.optional(),   // como la Matriz de M7; se combinan entre sí
  agrupacion_marca_ids: listaUuid(40).optional(),       // primer nivel (D3); varias a la vez
  marca_id: uuid.optional(),                            // exige UNA agrupacion_marca_ids y pertenecer a ella (D4)
  tienda_ids: listaUuid(30).optional(),                 // incluye aperturas sin historia
  bloque: z.enum(["todas", "mismas", "nuevas", "cierres"]).default("todas"),
  desglose: z.enum(["genero", "mundo", "linea", "agrupacion_marca", "marca", "tienda"]).default("mundo"),
}).superRefine(/* marca_id ⇒ exactamente una AM; desglose = marca ⇒ una AM elegida; desglose = tienda con bloque ≠ todas permitido */);

export const MOTIVOS_DIRECCION = ["crecimiento_alto", "crecimiento_bajo", "tiendas_nuevas", "nino", "filas_sin_decidir", "concentracion", "otro"] as const;

export const aprobarSchema = z.object({
  proyeccion_id: uuid,
  huella_vista: z.string().regex(/^[0-9a-f]{32}$/),     // la que trajo el GET del tablero
  resultado: z.enum(["aprobada", "con_observaciones", "rechazada"]),
  motivo: z.enum(MOTIVOS_DIRECCION).nullable(),
  comentario: z.string().trim().max(1000).nullable(),
  confirmo_revision: z.literal(true),                   // «Revisé las alertas»: casilla obligatoria (salvaguarda de 07g §4.4)
  filtros_vistos: tableroQuerySchema.partial().optional(),
}).superRefine((v, ctx) => { /* resultado ≠ aprobada ⇒ motivo no nulo y comentario ≥ 10 caracteres */ });
```

### 3.3 Tipos (`src/lib/direccion/tipos-api.ts`, autocontenido)

```ts
export type Bloque = "mismas" | "nuevas" | "cierres";
export type Exactitud = "exacto" | "estimado";
export type SerieMensualApi = { clave: string; etiqueta: string; anio: number;
  tipo: "real" | "real_parcial" | "proyectado" | "comparada";            // real = año completo vendido; real_parcial = año en curso hasta k'
  meses: (number | null)[];                                               // 12; null = mes sin dato (futuro o sin carga)
  origen_meses: ("real" | "proyectado" | null)[]; total: number | null; exactitud: Exactitud };
export type ComparativoApi = { clave: "siguiente_vs_en_curso" | "siguiente_vs_hace_dos" | "en_curso_vs_anterior" | "en_curso_vs_hace_dos"
  | "en_curso_ac_vs_anterior_ac" | "anterior_vs_hace_dos";
  etiqueta: string;                                                       // «2027 vs 2026 (cierre)», «2026 ene–set vs 2025 ene–set»
  total: { pct: number | null; motivo: null | "sin_base" | "incompleto" | "nueva" };
  mismas: { pct: number | null; tiendas: string[]; motivo: null | "sin_base" | "incompleto" } };   // mismas tiendas del año de la izquierda
export type CrecimientoGMApi = { gm_clave: string; nombre: string;      // «HOMBRE · URBANO» o «Resto»
  declarado_pct: number | null; sobre_base: "bruta" | "corregida" | null;
  base_real: number | null; base_corregida: number | null; con_nino: boolean;
  siguiente_mismas: number | null;
  implicito_sobre_real_pct: number | null; implicito_sobre_corregida_pct: number | null;
  desvio_pp: number | null;                                               // implícito (en la base del declarado) − declarado
  semaforo: "ok" | "revisar" | "sin_dato" };                              // |desvio| ≥ UMBRAL_DESVIO_PP (2 pp) ⇒ revisar
export type CodigoAlerta = "factor_provisional" | "factor_desfasado" | "factor_faltante" | "filas_sin_decidir" | "tiendas_sin_decidir"
  | "base_corregida_nino" | "tienda_nueva_relevante" | "apertura_sin_historia" | "concentracion" | "desvio_crecimiento"
  | "propuesta_cambio" | "curva_cambio" | "sin_curva" | "desactualizada" | "datos_mas_nuevos" | "metodo_anterior"
  | "fuera_universo" | "meses_faltantes" | "atribucion_estimada" | "marca_estimada" | "comparada_distinta_k";
export type AlertaApi = { codigo: CodigoAlerta; nivel: "bloquea_cierre" | "importante" | "info"; titulo: string; detalle: string;
  cifras: Record<string, number | string>; enlace: string | null };    // enlace a la pestaña de M7 donde se resuelve
export type FilaDesgloseApi = { id: string; nombre: string; exactitud: Exactitud;
  anios: { anio: number; tipo: "real" | "real_parcial" | "cierre" | "proyectado"; total: number | null }[];
  en_curso_ac: number | null; anterior_ac: number | null;                // ene–k del año en curso y del anterior
  comparativos: Pick<ComparativoApi, "clave" | "total">[]; participacion_siguiente: number | null };
export type EstadoAprobacion = "sin_aprobacion" | "aprobada" | "con_observaciones" | "rechazada" | "invalidada";
export type AprobacionApi = { id: string; proyeccion_id: string; estado_proyeccion: "en_trabajo" | "cerrada"; resultado: "aprobada" | "con_observaciones" | "rechazada";
  motivo: string | null; comentario: string | null; usuario_nombre: string; rol: string; created_at: string; huella: string; invalidada: boolean;
  resumen: { hasta_periodo: string; version_metodo: number; totales: { anio: number; vigente: number; vendido: number }[] } };
export type TableroApi = {
  proyeccion: { id: string; nombre: string; estado: "en_trabajo" | "cerrada" | "archivada"; anio_en_curso: number; anio_siguiente: number;
    hasta_periodo: string; k: number; cerrada_at: string | null; es_cerrada_vigente: boolean; version_metodo: number | null };
  comparada: TableroApi["proyeccion"] | null;
  datos: { ultimo_publicado: string; k_prima: number; meses_faltantes: string[] };   // k' puede ser > k
  filtros: { aplicados: Record<string, string | string[]>; texto: string; exactitud: Exactitud };   // «HOMBRE · URBANO · AM: RECONOCIDO · T03 (estimado)»
  series: SerieMensualApi[];        // 2023, 2024, 2025 reales; 2026 real hasta k'; 2026 proyectado k+1..12; 2027 proyectado; comparada si hay
  tabla_mensual: { filas: { clave: string; etiqueta: string; meses: (number | null)[]; total: number | null; tipo: SerieMensualApi["tipo"] | "variacion" }[] };
  kpis: { en_curso: { real_ac: number; cierre: number; proyectado_resto: number }; siguiente: number;
    anterior: number; hace_dos: number; hace_tres: number; comparativos: ComparativoApi[] };
  por_bloque: { anio: number; mismas: number; nuevas_anterior: number; aperturas: number; cierres: number; sin_meses: number }[];
  crecimientos: CrecimientoGMApi[];  // siempre de toda la proyección (no se recorta por filtros: el % es por GM)
  desglose: { dimension: string; filas: FilaDesgloseApi[]; total: FilaDesgloseApi };
  alertas: AlertaApi[];              // ordenadas: bloquea_cierre, importante, info
  mayores: { fila: string; vigente: number; participacion: number; crecimiento_pct: number | null }[];   // 10 mayores del recorte en Y+1
  aprobacion: { estado: EstadoAprobacion; vigente: AprobacionApi | null; puede_aprobar: boolean };      // puede_aprobar = rol admin y no archivada
  huella: string;                    // huella_proyeccion de la proyección mostrada (la que se manda al aprobar)
};
```

Constantes (`src/lib/direccion/tipos-api.ts`): `UMBRAL_DESVIO_PP = 2`, `UMBRAL_CONCENTRACION_TOP10 = 0.40`, `UMBRAL_FILA_DOMINANTE = 0.05`, `UMBRAL_TIENDA_NUEVA_RELEVANTE = 0.05` (participación de una tienda nueva o apertura en el `Y+1` del recorte), `MESES_ATRIBUCION = 12`, `MAX_TIENDAS = 30`, `MAX_AGRUPACIONES = 40`.

## 4. Pantallas

### 4.1 Dónde vive y quién la ve

- Ruta **`/planificacion/aprobacion-direccion`**, item **«Aprobación de dirección»** en la sección Planificación de `nav.ts` (roles `PLANIFICACION`: admin y planner). El comprador no lo ve y `puedeVerRuta` lo redirige (decisión 113: los datos de la proyección no se abren al comprador).
- **Admin:** ve todo y tiene el panel «Decisión de dirección» con los tres botones.
- **Planner:** ve todo (prepara la proyección y necesita saber qué verá dirección y qué observó), sin el panel de decisión; en su lugar, el estado y el historial.
- Kit existente: `Card`, `DataTable`, `Chips`, `ChipsMultiples`, `ChipFiltro`, `Select` y `Field` (`form.tsx`), `Tabs`, `Badge`, `Alert`, `Modal`, `DialogoConfirmar`, `EmptyState`, `Switch`, `Checkbox`. Hook propio `use-tablero-direccion.ts` (patrón `use-proyeccion.ts`). Formato `es-PE` de `src/lib/formato.ts` (miles con coma, mes «set»), igual en pantalla y Excel.
- Archivos: `src/app/(app)/planificacion/aprobacion-direccion/page.tsx`, `tablero-panel.tsx`, `filtros-tablero.tsx`, `grafico-tablero.tsx`, `tabla-mensual.tsx`, `tabla-desglose.tsx`, `crecimientos-gm.tsx`, `alertas-tablero.tsx`, `decision-direccion.tsx`, `historial-aprobaciones.tsx`, `vista-tablero.ts` (puro: filas, textos, hojas de Excel).

### 4.2 Estructura de la página (de arriba abajo; en móvil, una columna en el mismo orden)

1. **Cabecera.** Selector de proyección («Proyección 2026–2027 · **cerrada** el 07 nov 2026 · datos hasta set 2026 · la que usa Compras») y `Badge` de estado **en texto**: «Sin aprobación de dirección» · «Aprobada por *nombre* el 08 nov 2026» · «Con observaciones» · «Rechazada» · «Aprobación invalidada: la proyección cambió después del 08 nov». Debajo, si `k' > k`: «Hay venta publicada hasta oct 2026; esta proyección se calculó con datos hasta set 2026» (alerta `datos_mas_nuevos`). Si la proyección mostrada es en trabajo: `Alert` ámbar «En trabajo: las cifras pueden cambiar; la que usa Compras es *Proyección 2026–2027 (cerrada)*» con enlace para cambiar. Control **«Comparar con»** (`Select`, opcional).
2. **Filtros** (barra; en móvil, un botón «Filtros (3)» que abre un `Modal` de pantalla completa con los mismos controles). Todos en la URL (`?proyeccion=&comparar=&genero=&mundo=&linea=&am=&marca=&tiendas=&bloque=&desglose=`) para compartir el enlace y recargar sin perder el recorte.
   - Género · Mundo · Línea (`Select` encadenados, como la Matriz de M7).
   - **Agrupación de marca** (`ChipsMultiples`, primer nivel, junto a GML; «Todas» por defecto).
   - **Marca** (`Select` con búsqueda), **habilitado solo con una agrupación elegida**; texto de ayuda: «Lo proyectado por marca es estimado con la participación histórica de la marca en su fila».
   - **Tiendas** (`ChipsMultiples` agrupado por estado al año siguiente: «Mismas tiendas 2027», «Nuevas del año anterior», «Aperturas 2027», «Cierres», «Cerradas»; cada chip con código y nombre; las aperturas sin historia también aparecen).
   - **Bloque**: `Chips` «Todas · Mismas tiendas · Tiendas nuevas · Cierres».
   - Botón «Limpiar filtros». Bajo la barra, el **resumen del recorte en texto** («HOMBRE · URBANO · AM: RECONOCIDO · tiendas: T03, T12 · cifras de T03 estimadas»).
3. **Tarjetas de cifras (KPIs)**, cuatro en fila (dos por fila en móvil), cada una con el número y una frase:
   - «**2027 proyectado** · 53 208 u · +6,4 % vs cierre 2026 · +13,2 % vs 2025».
   - «**2026 cierre** · 50 001 u = real ene–set 34 000 + proyectado oct–dic 16 001 · +6,4 % vs 2025».
   - «**2026 en lo que va** · ene–set 34 000 u · +3,0 % vs 2025 ene–set».
   - «**Mismas tiendas** · 2027 vs 2026: +6,7 % sobre real, +5,0 % sobre corregido (4 tiendas) · total con nuevas, aperturas y cierres: +6,4 %».
4. **Gráfico mensual** (§4.3) con su tabla mensual debajo (§4.4).
5. **Crecimiento declarado frente a implícito** por GM (§4.4, tabla 3).
6. **Alertas para aprobar** (§4.4, lista).
7. **Desglose** por la dimensión elegida (§4.4, tabla 2) y **las 10 filas mayores** del recorte.
8. **Decisión de dirección** (solo admin) e **Historial de aprobaciones** (todos los que ven la página) (§4.6).

### 4.3 Gráfico mensual

- **SVG propio, sin librerías**, reutilizando `calcularGeometriaCurvas` y `lecturaMes` de `src/lib/curvas/grafico.ts` en modo unidades, como `grafico-mensual-fila.tsx` de M7 (que es su punto de partida). Eje X: ene … dic; eje Y: unidades con miles `es-PE`.
- **Series** (una línea por año; se distinguen por **trazo y grosor, no solo por color**):
  - 2023, 2024, 2025: real, líneas finas continuas en grises/azules decrecientes; el año del Niño con guion y punto (la convención de M6).
  - 2026: **real** hasta `k'` (continuo, grueso) y **proyectado** desde `k+1` (discontinuo, grueso, mismo color); si `k' > k`, en los meses `k+1 … k'` se ven los dos puntos (real y proyectado) y la lectura del mes dice la diferencia.
  - 2027: proyectado, discontinuo, el más grueso y el color de acento.
  - «Comparar con»: la otra proyección en punteado fino, con su nombre en la leyenda.
  - Línea vertical en `k` con el rótulo «datos hasta set 2026».
- **Conmutadores** (`Chips`): «Mensual · Acumulado» y, en la leyenda, cada serie se enciende o apaga (por defecto: 2024, 2025, 2026 y 2027; 2023 apagado para no saturar en móvil).
- **Accesible:** `<figure aria-describedby="tabla-mensual">` con un `<figcaption>` que resume en texto («2027 proyecta 53 208 u, +6,4 % sobre el cierre 2026; el mes mayor es diciembre con 5 641 u»); la tabla mensual es la alternativa con las cifras exactas; navegación por teclado entre meses (flechas) con la lectura del mes en una región `aria-live="polite"` («Diciembre: 2025 5 210 · 2026 5 380 proyectado · 2027 5 641 proyectado»); contraste AA; en pantallas de menos de 640 px el gráfico ocupa el ancho y la leyenda pasa debajo, en dos columnas.
- **Exactitud en el gráfico:** si el recorte incluye una tienda «misma» o una marca, la leyenda de 2026 proyectado y 2027 dice «(estimado)» y hay una nota debajo (§4.4 atribución).

### 4.4 Tablas, comparativos, atribución y alertas

**Tabla 1 · Mensual** (`DataTable` con desplazamiento horizontal y primera columna fija): filas `2023`, `2024`, `2025`, `2026 real`, `2026 proyectado`, `2026 cierre` (real + proyectado), `2027`, y dos filas de variación «2027 vs 2026 cierre (%)» y «2026 vs 2025 (%)» mes a mes; columnas `ene … dic`, `Total`, `ene–k`. Real en redonda, proyectado en cursiva (la convención de la vista Mensual de M7), y **cada celda proyectada lleva la palabra «proy.» en su `title` y en lector de pantalla** (no solo la cursiva). Meses sin carga: «—» con `title` «sin carga publicada».

**Comparativos** (`comparativos.ts`, puros; §5 R4 a R6):
- **vs año anterior:** `2027 ÷ 2026 cierre − 1`; `2026 cierre ÷ 2025 − 1`; `2026 ene–k' ÷ 2025 ene–k' − 1` (el único comparativo 100 % real del año en curso).
- **vs dos años:** `2027 ÷ 2025 − 1`; `2026 cierre ÷ 2024 − 1`.
- **Mismas tiendas frente a total:** para un comparativo «Z vs Z−1», «mismas» usa solo las tiendas de `M(Z)` (las abiertas los doce meses de `Z−1` y todo `Z`; claves de pertenencia guardadas en `parametros.bloques`), tanto en el numerador como en el denominador; para `2027 vs 2026`, mismas = filas base de `Y+1` frente a su base `B` (exacto, es lo que mide M7). «Total» = todas las tiendas (sin CD), con nuevas, aperturas y cierres.
- Motivos en lugar de un %: `sin_base` (denominador 0), `incompleto` (falta un mes publicado en alguno de los dos), `nueva` (solo tiendas sin año anterior en el recorte).

**Regla de atribución por tienda (D5; `atribucion.ts`, pura).** Con `tienda_ids` elegidas:
- Tiendas nuevas, aperturas y cierres elegidas: su proyección **exacta** (filas con `tienda_id`).
- Tienda `t` de `M(Z)` elegida: `proy_t,Z,m = mismas_Z,m × s_t,Z`, con `s_t,Z = venta_t ÷ Σ_{u ∈ M(Z)} venta_u` sobre los **12 meses cerrados hasta `k`** del mismo recorte (GML, AM, marca), de `por_tienda` de `tablero_venta`. Para `Z = Y+1` el conjunto es `M(Y+1)` (incluye las nuevas del año anterior que entran a la base, con sus meses reales). Si `Σ venta = 0`, reparto por igual y aviso. Enteros por mayor resto al final, por mes.
- Invariante: con **todas** las tiendas de `M(Z)` elegidas, la suma atribuida es exactamente `mismas_Z` (R7).
- Rótulo «estimado» en la tarjeta, la tabla, el gráfico y el Excel; alerta `atribucion_estimada` («T03: 2027 estimado con su participación de oct 2025–set 2026 en mismas tiendas, 18,4 %»).

**Tabla 2 · Desglose** por la dimensión elegida (`Select`: Género · Mundo · Línea · Agrupación de marca · Marca [solo con una AM] · Tienda): una fila por elemento con `2023`, `2024`, `2025`, `2025 ene–k`, `2026 ene–k`, `2026 cierre`, `2027`, `% 27/26`, `% 27/25`, `% 26/25`, `% ene–k`, `part. 2027`; total al pie, que cuadra con los KPIs (R3). Orden por 2027 descendente. Filas estimadas con `Badge` «estimado». Paginación de 200 como M11 (`src/lib/reportes/paginacion.ts`).

**Las 10 filas mayores** (GML × AM) del recorte en 2027, con su participación y crecimiento; si las 10 suman ≥ 40 % o una sola ≥ 5 % del recorte, alerta `concentracion`.

**Tabla 3 · Crecimiento declarado frente a implícito** (siempre de la proyección entera, una fila por GM de HOMBRE y MUJER más el Resto, y el Total):
- Declarado: `proyeccion_crecimientos.pct` (o el Resto), con «sobre 2026 corregido» o «sobre 2026 real» según `sobre_base` (06e D6).
- Implícito: `Σ vigente 2027 de las filas base del GM ÷ Σ B − 1` («sobre real») y `÷ Σ B' − 1` («sobre corregido»); se compara con el declarado **en su misma base**.
- Desvío en puntos y semáforo **en texto**: «coincide» (< 2 pp) · «revisar: +4,3 pp» (decisiones a mano o filas fijadas que se apartan del %). Columna «Niño»: «base corregida +1,6 % (B' 48 380 frente a B 47 600)» si `correccionMaterial`.
- Al pie: «Total 2027 mismas tiendas +6,7 % sobre real (+5,0 % sobre corregido) · con nuevas, aperturas y cierres +6,4 %», que puentea al KPI.

**Alertas para aprobar** (`alertas.ts`; lista con icono **y** palabra de nivel: «Bloquea el cierre», «Importante», «Informativo»; cada una con su enlace a la pestaña de M7 donde se arregla):

| Código | Nivel | Cuándo | Texto de ejemplo |
|---|---|---|---|
| `filas_sin_decidir` | bloquea_cierre (en trabajo) / info (cerrada) | registros base con `propuesto ≥ umbral_cola_larga` y sin decidir, por año | «2027: 37 filas sin decidir con 41 200 u propuestas (4,4 % del año)» |
| `tiendas_sin_decidir` | bloquea_cierre | `proyeccion_tiendas` con propuesta y sin decisión | «Apertura T12 (abr 2027) sin decidir: 8 300 u propuestas» |
| `factor_provisional` / `factor_desfasado` / `factor_faltante` | bloquea_cierre si es de `Y` y la proyección está en trabajo; importante si es cerrada | `estadoFactorY` ≠ `ok` (06e D5) | «Factor del Niño de verano 2026: provisional (1 mes del periodo, escrito a mano 1,12). Mueve 2027 de las líneas de verano» |
| `base_corregida_nino` | importante | algún GM con `correccionMaterial` | «4 GM con base 2027 corregida del Niño: 2027 se apoya en 2026 dividido por 0,70 en invierno» |
| `tienda_nueva_relevante` | importante | una tienda nueva del año anterior o apertura pesa ≥ 5 % del 2027 del recorte, o una tienda que entra a la base pesa ≥ 5 % de `B` | «T10 entra a mismas tiendas en 2027 y es el 8,6 % de la base: abrió en nov 2025 y su 2026 es real ene–set más proyectado oct–dic» (con los datos reales, es el caso de la tienda nueva grande que entra a la base de 2027) |
| `apertura_sin_historia` | importante | apertura de `Y+1` proyectada por venta esperada | «T12 se proyecta por venta esperada S/ … y referente T05: no tiene venta propia» |
| `concentracion` | importante | top 10 ≥ 40 % o una fila ≥ 5 % | «Las 10 filas mayores son el 46 % de 2027; DENIM · RECONOCIDO sola, el 7 %» |
| `desvio_crecimiento` | importante | algún GM con semáforo «revisar» | «MUJER · URBANO: declarado +8,0 %, implícito +12,3 %» |
| `propuesta_cambio` / `curva_cambio` | info | conteos > 0 | «112 filas decididas cuya propuesta cambió al recalcular» |
| `sin_curva` | importante | `sin_meses > 0` | «1 240 u de 2027 sin reparto mensual (filas sin curva): suman al total, no al gráfico» |
| `desactualizada` | importante (en trabajo) | `desactualizada` de M7 no vacío | «Desactualizada: cargas nuevas, crecimientos cambiados» |
| `datos_mas_nuevos` | info | `k' > k` | «Hay oct 2026 publicado: en el gráfico ves el real de oct junto al proyectado» |
| `metodo_anterior` | importante | `version_metodo < VERSION_METODO` | «Calculada con el método 4: sin base corregida del Niño» |
| `fuera_universo` | info | `fuera_universo` > 0 | «2023 incluye 3 100 u de filas que ya no se proyectan (sin venta en 24 meses)» |
| `meses_faltantes` | importante | falta una carga en el rango | «Falta mar 2024: las cifras de 2024 están incompletas» |
| `atribucion_estimada` / `marca_estimada` | info | filtro de tienda «misma» o de marca | ver arriba; para marca: «Marca X: 2027 estimado con su participación de oct 2025–set 2026 en su fila (63 %)»; si hay `sin_participacion_marca`, «N u sin participación por marca no se pueden recortar» |
| `comparada_distinta_k` | info | «Comparar con» una de otro `hasta_periodo` | «La comparada se calculó con datos hasta ago 2026» |

### 4.5 Exportar a Excel

Botón «Descargar Excel» (admin y planner), generado **en el navegador** con `descargarLibro` de `src/app/(app)/planificacion/proyeccion/descarga-libro.ts` (SheetJS bajo demanda, patrón de M11 y M7) sobre la respuesta ya cargada. Nombre `nombreArchivoProyeccion(Y, "direccion")` → `proyeccion-2026-2027-direccion.xlsx`. Hojas:
- `RESUMEN`: proyección, estado, aprobación vigente (o «sin aprobación»), KPIs y comparativos (total y mismas).
- `MENSUAL`: la tabla 1, con una columna `TIPO` (`real`/`proyectado`/`variacion`) y `EXACTITUD`.
- `DESGLOSE`: la tabla 2 con la dimensión elegida.
- `CRECIMIENTOS`: la tabla 3.
- `ALERTAS`: código, nivel, texto.
- `APROBACIONES`: el historial (fecha, quién, resultado, motivo, comentario, `invalidada`).
- `FILTROS`: **todos los filtros, incluida la agrupación de marca y la marca**, las tiendas, el bloque, la comparada, `k`, `k'`, la huella y la fecha de descarga; y la nota de exactitud.

### 4.6 Decisión de dirección, historial y avisos en otras pantallas

**Panel «Decisión de dirección» (solo admin; oculto en archivadas).**
- Resumen fijo (no depende del filtro): «Vas a decidir sobre *Proyección 2026–2027 (cerrada)* completa: 2026 cierre 50 001 u · 2027 53 208 u (+6,4 %) · 3 alertas importantes» (cifras del caso sintético de §6).
- Tres botones: **Aprobar** · **Aprobar con observaciones** · **Rechazar**. Cada uno abre un `Modal` con: el resumen, la lista de alertas «Bloquea el cierre» e «Importante», la casilla obligatoria «Revisé las alertas y las cifras de toda la proyección», y:
  - Aprobar: comentario opcional.
  - Con observaciones / Rechazar: `Select` de motivo y comentario obligatorios (≥ 10 caracteres; contador visible).
- Al confirmar: `POST`; con `409 huella_distinta`, el modal dice «La proyección cambió mientras la mirabas (alguien decidió o recalculó). Vuelve a cargar el tablero y revisa de nuevo» con el botón «Recargar», y no registra nada.
- Si la proyección está **en trabajo**: el modal añade «Esta proyección todavía no está cerrada. Si se cierra sin cambiar cifras, tu aprobación sigue vigente; si cambia una cifra, queda invalidada».
- Si hay alertas «Bloquea el cierre» y la proyección está en trabajo: **se puede aprobar igual** (la aprobación es un juicio de dirección, no un control técnico), pero el modal las lista primero.

**Historial** (`Card`, todos los que ven la página): fecha y hora (Lima), quién, rol, resultado (`Badge` con texto), motivo, comentario, «sobre: en trabajo / cerrada», y «**invalidada**: la proyección cambió después» cuando su huella no es la actual. Más reciente primero.

**Avisos en otras pantallas** (solo admin y planner; una línea, sin bloquear nada):
- Cabecera de Proyección de unidades (`cabecera-proyeccion.tsx`): «Dirección: aprobada el 08 nov por *nombre*» / «sin aprobación» / «aprobación invalidada» con enlace al tablero.
- Cabecera de Flujo mensual (`/compras/flujo`): **solo si el rol es admin o planner**, «La cerrada que usa el flujo no tiene aprobación de dirección vigente» con enlace. El comprador no ve el aviso (los datos de aprobación son de planificación, decisión 113).
- Ambos leen `GET /api/direccion/estado`.

## 5. Reglas de negocio

### 5.1 Qué significa «aprobar a nivel de dirección»

**Qué es.** Un **juicio de dirección registrado** sobre una proyección entera, con su huella de cifras: «vi estas cifras, en esta fecha, y las apruebo / las apruebo con observaciones / las rechazo, por este motivo». No modifica la proyección, no cambia decisiones de filas y no es un paso técnico del cálculo.

**Estados** (derivados al leer; nada se actualiza):
- `sin_aprobacion`: no hay ninguna aprobación de esa proyección.
- `aprobada` / `con_observaciones` / `rechazada`: la **más reciente** de esa proyección y su huella **coincide** con la actual.
- `invalidada`: la más reciente tiene otra huella (la proyección cambió después). Una aprobación anterior con la misma huella que la actual **no revive**: manda siempre la más reciente (R10).

**Sobre qué se aprueba.** Sobre una proyección **en trabajo o cerrada** (no archivada). Recomendado: aprobar la en trabajo cuando el planner la da por lista, y cerrarla después; como la huella no incluye el estado, la aprobación sobrevive al cierre si no cambió ninguna cifra (R11). También se puede aprobar la cerrada directamente.

**¿Bloquea algo? Recomendación: no (opción A).**

| Opción | Qué haría | Veredicto |
|---|---|---|
| **A · Informativa con aviso** (recomendada) | La aprobación se registra y se ve en el tablero, en la cabecera de Proyección y, para admin y planner, en Flujo mensual. Ni cerrar ni M8 la exigen. | **Elegida.** No toca el contrato de M8 ni el cierre de M7 (ya validados por QA y pendientes de hito); Javier es a la vez quien decide filas y quien aprueba, así que un bloqueo sería un clic más sin control real; y un mes con la cerrada atascada en una aprobación dejaría Compras sin demanda. Se puede endurecer después (B o C) sin cambiar la tabla. |
| B · Cerrar exige aprobación vigente | `POST …/cerrar` responde `409 sin_aprobacion_direccion` si la en trabajo no tiene una `aprobada` o `con_observaciones` vigente | Descartada por ahora: obliga al planner a esperar al admin para cada cierre mensual de seguimiento; toca `cerrar` de M7 y sus pruebas; y crea un orden rígido (aprobar en trabajo → cerrar) que no deja aprobar la cerrada. |
| C · M8 solo lee una cerrada aprobada | `leerProyeccionCerrada` salta las cerradas sin aprobación vigente | Descartada: cambia el contrato de M8 (07 §7, «una cerrada nunca cambia»), puede dejar el flujo sin cerrada (`404 sin_cerrada`) y mezcla un permiso de dirección con una lectura técnica. |
| D · Una `rechazada` reabre o archiva la proyección | El rechazo devuelve la cerrada a en trabajo | Descartada: una cerrada nunca se vuelve a abrir (07 paso 7); el planner copia y sigue. El rechazo queda como registro y como aviso. |

**Quién aprueba. Recomendación: solo `admin`** (`requireAdmin` en el `POST`; la pantalla oculta el panel a los demás).
- Hoy el admin es quien tiene «todo» (PLAN §3); el planner trabaja la proyección y no debería aprobar su propio trabajo; el comprador no ve Planificación.
- **Sin rol nuevo en esta entrega.** Un rol `direccion` (ve Planificación en solo lectura y aprueba, sin administrar usuarios ni editar maestros) exigiría tocar `roles.ts`, el `check` de `perfiles.rol`, `nav.ts`, los guards y todas las pruebas de roles: es un módulo de permisos aparte. La tabla ya guarda `rol` para cuando exista. Si Javier quiere que una persona de dirección apruebe sin ser admin, es la decisión 2 de §10.
- Descartado: que cualquier planner apruebe (se aprueba a sí mismo) y que aprobar requiera dos firmas (no hay dos personas de dirección en el sistema hoy).

### 5.2 Invariantes (vitest; las de la base, con el humo de la migración)

**Cifras y cuadres**
- **R1 · Proyectado = M7.** Sin filtros y bloque «Todas», el total por año del tablero es `Σ (decidido ?? propuesto)` de los registros activos de la proyección (incluidas las filas de tienda), y la suma de `meses` por mes coincide con los `totales` de `GET …/mensual` de M7 sobre la misma base falsa; `sin_meses` es la diferencia exacta entre total y `Σ meses`.
- **R2 · Real = M5 sin CD.** Sin filtros, el real de cada mes es la suma de `unidades` de `venta_stock_vigente` de tiendas `tipo = 'Tienda'` de ese periodo. Una venta del CD en la base falsa no aparece en ninguna cifra.
- **R3 · Totales que cuadran.** En el desglose, `Σ filas = total` por columna para toda dimensión (con filas exactas); los KPIs, la tabla mensual, el desglose y el gráfico dicen el mismo número para el mismo año. Con filas estimadas, la diferencia por redondeo es ≤ 12 u por año y se rotula.
- **R4 · Cierre del año en curso.** `2026 cierre = real ene–k + proyectado (k+1)–dic` de la proyección; el real del gráfico usa `k'`, pero el cierre usa el `vendido` guardado hasta `k` (lo que la proyección usó), y si `k' > k` ambos se muestran sin sumarse dos veces.
- **R5 · Comparativos.** Cada % se calcula sobre sumas (nunca promedio de %); `ene–k'` del año anterior usa los mismos `k'` meses; motivos `sin_base`, `incompleto` y `nueva` en los casos de §4.4.
- **R6 · Mismas tiendas.** El comparativo «Z vs Z−1» de mismas tiendas usa el mismo conjunto `M(Z)` (de `parametros.bloques`) arriba y abajo; para 2027 vs 2026 coincide con `Σ vigente(Y+1, mismas) ÷ Σ B − 1`. Cambiar una fecha en M4 después de calcular no cambia el conjunto (sale de los bloques guardados, como 07f regla 4).
- **R7 · Atribución por tienda.** Con todas las tiendas de `M(Z)` elegidas, `Σ atribuido = mismas_Z` exacto por mes; con una tienda sin venta en los 12 meses, su parte es 0; con `Σ venta = 0`, reparto por igual con aviso; las nuevas y cierres elegidos dan su cifra exacta.
- **R8 · Marca.** Con una marca de participación 0,25 en su única fila base y una fila de tienda de la misma GML × AM, lo proyectado es `round(0,25 × vigente)` de las dos; una fila base sin `por_marca` suma a `sin_participacion_marca` y no a la serie; la venta de la marca es exacta (filtra `marca_id` real, no la cabeza).
- **R9 · Filtros combinados.** GML × AM × marca × tienda × bloque se aplican **a la vez** a proyección y venta (propiedad: el total con filtro A ∧ B es ≤ el de A y el de B; la unión disjunta de las AM suma el total sin filtro de AM).

**Aprobación**
- **R10 · Estado.** El estado es el de la aprobación más reciente comparada con la huella actual; una más antigua con la huella actual no revive; sin aprobaciones, `sin_aprobacion`.
- **R11 · Qué mueve la huella.** Cambian la huella: decidir o cambiar una fila (`decidido`), recalcular con otra propuesta en una fila sin decidir, aplicar curva nueva (`meses`), decidir una tienda, aplicar un lote de 07g, cambiar un crecimiento de GM o el Resto, cambiar `hasta_periodo`. **No** la cambian: cerrar, renombrar, editar la nota, recalcular sin cambiar ninguna cifra, una carga nueva de venta (no toca la proyección), archivar otra proyección. Probado en SQL con el humo (dos llamadas, mismo resultado) y en vitest con el falso.
- **R12 · Siempre la proyección entera.** El `resumen` y la huella de una aprobación no dependen de los filtros con que se miraba (`filtros_vistos` es solo informativo); dos `POST` con filtros distintos sobre la misma proyección guardan la misma huella.
- **R13 · Concurrencia.** Si entre el `GET` y el `POST` cambia una cifra, el `POST` responde `409 huella_distinta` y no inserta nada (la función recalcula la huella en la misma transacción). Dos `POST` simultáneos con la misma huella insertan dos filas (es historial; no hay único que lo impida, a propósito).
- **R14 · Inmutable.** `update` y `delete` sobre `aprobaciones_direccion` fallan también con `service_role`, salvo poner `perfil_id` en `null`; `truncate` falla. `service_role` solo tiene `select, insert`.
- **R15 · Motivo.** `con_observaciones` y `rechazada` exigen motivo del catálogo y comentario ≥ 10 caracteres (zod y `check`); `aprobada` los admite opcionales.
- **R16 · Roles.** `POST /api/direccion/aprobaciones`: `401` sin sesión, `403` planner y comprador, `201` admin. Las tres rutas `GET`: `401`, `403` comprador, `200` admin y planner. La primera sentencia de cada handler es el guard (prueba estática).
- **R17 · Una proyección con aprobaciones no se elimina.** `DELETE /api/proyeccion/proyecciones/[id]` responde `409 tiene_aprobaciones` (traducción de la FK `restrict`).
- **R18 · Archivada.** Se ve en el tablero, no se aprueba (`409 archivada`, `puede_aprobar = false`).

**Aislamiento**
- **R19 · Solo lectura de M7.** Los servicios de `src/lib/direccion/` no llaman a `insert`, `update`, `upsert` ni `delete` sobre tablas, y el único `rpc` que escribe es `registrar_aprobacion_direccion`; no nombran `ia_*`, `venta_proyeccion`, `stock` ni `costo`. `tablero_venta` solo nombra `unidades` de `venta_stock_vigente` (prueba estática sobre el archivo de la migración).
- **R20 · Cerrada intacta.** Abrir el tablero y aprobar no cambia ni un byte de `GET /api/proyeccion/cerrada` (comparación antes/después en la base falsa).

### 5.3 Casos borde

| Caso | Comportamiento |
|---|---|
| No hay ninguna cerrada (enero, antes del primer cierre) | Se abre la en trabajo más reciente con su `Alert`; si no hay ninguna, `EmptyState` «No hay proyección calculada» con enlace a Proyección |
| Dos proyecciones del mismo año (cerrada y «seguimiento sep» en trabajo) | Por defecto la cerrada vigente; el selector muestra las dos y «Comparar con» las superpone |
| Proyección de método 4 o anterior | Se ve; alerta `metodo_anterior`; la tabla de crecimientos dice «sin base corregida» y no calcula implícito sobre corregida |
| `k' > k` (venta más nueva que la proyección) | Real hasta `k'` en el gráfico y la tabla; el cierre usa `k`; alerta `datos_mas_nuevos` |
| `k = 12` (proyección hecha en enero con todo el año anterior) | No hay «proyectado» del año en curso; la columna `ene–k` no se repite |
| Año histórico incompleto (primer mes cargado no es enero, o un mes faltante) | `Badge` «faltan: mar 2024» en la cabecera de la columna; comparativos de ese año `incompleto` |
| Tienda que abre en `Y+1` (apertura) elegida sola | Historia vacía, 2027 exacto por venta esperada; comparativos `nueva`; alerta `apertura_sin_historia` |
| Tienda cerrada antes de `Y` elegida | Solo historia; proyección 0; texto «cerró el 31 ago 2024» |
| CD | No aparece en filtros ni cifras |
| Filtro que deja todo en cero | `EmptyState` «Sin venta ni proyección con estos filtros» y botón «Limpiar filtros» |
| Marca sin participación en la cerrada (`por_marca` nulo, cerrada de `0.10.0`) | Venta exacta; proyección vacía con alerta `marca_estimada` «la proyección no trae participación por marca» |
| Filas sin curva (`meses = null`) | Suman al total y a los KPIs, no al gráfico; alerta `sin_curva` con las unidades |
| Fila inactiva (`activo = false`) | No cuenta (como M7) |
| Cálculo en curso | `409 calculo_en_curso`: «Se está recalculando; vuelve en unos minutos» y botón «Reintentar» |
| La proyección cambia mientras el admin tiene el modal abierto | `409 huella_distinta`, nada se registra |
| Usuario aprobador eliminado después | `perfil_id` pasa a `null`; el historial conserva `usuario_nombre` y `rol` |
| Comparada de otro año en curso | Permitida; se alinean los años por calendario (2027 con 2027); alerta si su `hasta_periodo` difiere |
| Más de 30 tiendas o 40 AM en la URL | `400` con mensaje |
| Pantalla de 360–390 px | Filtros en modal, KPIs en 2 × 2, gráfico al ancho con leyenda debajo, tablas con primera columna fija y desplazamiento horizontal, panel de decisión al final en una columna; los botones de decidir tienen ≥ 44 px de alto |

## 6. Criterios de aceptación / hito de prueba

### 6.1 Caso sintético (`tests/direccion.fixture.ts`)

`Y = 2026`, `k = 9` (set), `k' = 10` (oct 2026 publicado después de cerrar). Recorte HOMBRE · URBANO. Tiendas: T01, T02, T03 (mismas siempre); T04 (misma en 2026, cierra el 2027-06-30); T10 (abrió el 2025-11-15: nueva del año anterior en 2026, entra a mismas en 2027); T12 (apertura abr 2027); T09 (cerró el 2024-08-31); CD1 con venta (no debe aparecer).

| Cifra | Valor | De dónde |
|---|---|---|
| Real 2023 / 2024 / 2025 | 40 000 / 42 000 / 47 000 (T10: 300 en 2025) | venta |
| Real 2025 ene–set / 2026 ene–set | 33 000 / 34 000 → **+3,0 %** | venta |
| 2026 cierre | 50 001 = real 34 000 + proyectado oct–dic 16 001 → **+6,4 % vs 2025**, +19,0 % vs 2024 | proyección |
| 2026 por bloque | mismas (T01–T04) 45 901 · T10 4 100 (real 3 000 + proy. 1 100) | proyección |
| Mismas tiendas 2026 vs 2025 (`M(2026)` = T01–T04) | 45 901 ÷ 46 700 − 1 = **−1,7 %** frente a **+6,4 %** total | R6 |
| Base `B` 2027 | (45 901 − 2 401 de T04) + 4 100 de T10 = **47 600**; `B'` corregida del Niño = 48 380 | proyección |
| 2027 | **53 208** = mismas 50 800 + apertura T12 1 408 + cierre T04 1 000 → **+6,4 % vs cierre 2026**, **+13,2 % vs 2025** | proyección |
| Crecimiento HOMBRE · URBANO | declarado +5,0 % sobre corregida; implícito 50 800 ÷ 48 380 − 1 = **+5,0 %** («coincide»); sobre real 50 800 ÷ 47 600 − 1 = +6,7 % | R6, tabla 3 |
| MUJER · URBANO (otra celda) | declarado +8,0 %, implícito +12,3 % → «revisar: +4,3 pp» y alerta `desvio_crecimiento` | tabla 3 |
| Filtro T03 | venta T03 oct 2025–set 2026 = 8 400 de 45 650 en `M(2027)` → `s = 18,4 %` → 2027 de T03 **≈ 9 348 u (estimado)** | R7 |
| Filtro T12 | historia vacía; 2027 = 1 408 exacto; comparativos «nueva»; alerta `apertura_sin_historia` | §5.3 |
| Filtro AM RECONOCIDO + marca X (participación 0,63 en su fila) | venta exacta de X; 2027 = `round(0,63 × vigente)` por mes, rotulado «estimado» | R8 |
| Mes oct 2026 | real 4 300 y proyectado 4 053 a la vez en el gráfico; el cierre sigue siendo 50 001 | R4 |

**Aprobación (secuencia del humo y de `tests/direccion.aprobacion.test.ts`):** (1) el admin aprueba la en trabajo con huella `h1` → `aprobada`; (2) el planner cambia una fila de 4 300 a 4 400 → huella `h2` → estado `invalidada`; (3) el admin aprueba con observaciones (motivo `crecimiento_alto`, comentario) → `con_observaciones`; (4) el planner cierra sin tocar cifras → la huella sigue en `h2` y el estado sigue `con_observaciones`; (5) un `POST` con `h1` → `409 huella_distinta` y sin fila nueva; (6) un `update` directo de la fila → error de inmutabilidad.

### 6.2 Hito (Javier y Cowork; sección **S** de `docs/pruebas/cowork-checklist.md`)

1. Como admin, Planificación → «Aprobación de dirección» abre por defecto la **cerrada** del 7 nov con el estado «Sin aprobación de dirección» en texto; el selector deja abrir «seguimiento sep» (en trabajo, con su aviso ámbar) y «Comparar con» superpone las dos.
2. Sin filtros, el **2027** del tablero es el mismo número que el Total 2027 de la Matriz de M7 de esa proyección, y el **2026 cierre** el mismo que el Total 2026; el gráfico muestra 2023, 2024 y 2025 reales, 2026 real hasta el último mes publicado y proyectado desde octubre, y 2027 proyectado.
3. Filtrar por **género, mundo, línea, agrupación de marca, marca y tienda** (una a la vez y combinadas) cambia gráfico, KPIs, tablas y comparativos; la AM y la marca afectan a lo proyectado **y** a la venta de 2023–2026; una marca y una tienda «misma» se rotulan «estimado»; una apertura sola muestra solo 2027.
4. Los comparativos dicen «vs 2026», «vs 2025» y «mismas tiendas» con sus tiendas; el de mismas tiendas 2027 vs 2026 coincide con el crecimiento implícito de mismas tiendas de la tabla de crecimientos.
5. La tabla de crecimientos muestra, por GM, el % declarado y el implícito en la misma base, con el desvío en texto, y la base corregida del Niño cuando aplica.
6. Las alertas listan, con su nivel en palabras: factores provisionales, filas y tiendas sin decidir, base corregida del Niño, la tienda nueva grande que entra a la base de 2027, concentración y desvíos; cada una lleva a la pestaña de M7 donde se arregla.
7. **Aprobar**: como admin, aprobar con un comentario; el estado pasa a «Aprobada por *nombre*». Como planner, la página se ve igual pero sin botones de decidir; como comprador, el menú no tiene el item y la URL directa redirige.
8. Con la en trabajo aprobada, cambiar una fila en M7 y volver: el estado dice «Aprobación invalidada». Rechazar o aprobar con observaciones exige motivo y comentario.
9. Con dos pestañas: abrir el modal de aprobar en una, cambiar una fila en otra, confirmar en la primera → mensaje «La proyección cambió mientras la mirabas» y el historial no gana fila.
10. La cabecera de Proyección y la de Flujo mensual (como admin o planner) muestran el estado de dirección de la cerrada; Compras y el flujo funcionan igual con o sin aprobación.
11. «Descargar Excel» baja `proyeccion-2026-2027-direccion.xlsx` con las hojas de §4.5 y la hoja `FILTROS` con la agrupación de marca y la marca usadas.
12. En un teléfono (390 px): filtros en el modal, gráfico legible, tablas desplazables, panel de decisión usable.
13. Rendimiento: la primera carga del tablero tarda ≤ 3 s y un cambio de filtro ≤ 2 s (cronómetro a mano en producción; `datos` deja las mediciones SQL al pie de la migración).
14. Pasan `npm run lint`, `npx tsc --noEmit`, `npx vitest run` y `npm run build`, y `APP_VERSION = "0.19.0 · M14"`.

### 6.3 Seguridad (lo revisa `seguridad`, sonnet, solo lectura)

- Cada handler de `src/app/api/direccion/` empieza con su guard; `POST /aprobaciones` con `requireAdmin`; ninguna ruta usa `requireUser` (el comprador no ve datos de proyección, decisión 113).
- `perfil_id`, `usuario_nombre` y `rol` salen de la sesión, nunca del cuerpo; la huella guardada es la recalculada en la base, no la del cliente.
- `aprobaciones_direccion`: RLS activo sin políticas; `anon` y `authenticated` sin privilegios; `service_role` solo `select, insert`; triggers de inmutabilidad (también `truncate`); FK `restrict` a `proyecciones`.
- Funciones: `security invoker`, `search_path = ''`, todo calificado; `execute` solo para `service_role`; `tablero_venta` y `tablero_proyeccion` `stable` sin escrituras; `registrar_aprobacion_direccion` solo inserta en su tabla. Las listas de ids entran como `uuid[]` dentro del `jsonb` (sin SQL dinámico, sin `format`/`execute`).
- Límites de entrada: ≤ 30 tiendas, ≤ 40 AM, comentario ≤ 1 000, `resumen` ≤ 64 KB, cuerpo ≤ `MAX_BYTES_CUERPO`.
- Errores `500` sin detalles de la base; los `409` con código y mensaje en castellano.
- El Excel se arma en el navegador con datos ya autorizados; no hay ruta de descarga.
- Nada de datos reales en fixtures, pruebas ni ficha.

### 6.4 Pruebas (vitest; cada archivo con un solo dueño)

- `tests/direccion.fixture.ts` y `tests/direccion.fake-db.ts` (rpc falsos de las cuatro funciones sobre la base falsa de M7) — `backend`.
- `tests/direccion.tablero.test.ts` (R1 a R9), `tests/direccion.atribucion.test.ts` (R7, propiedad con 5 000 casos aleatorios: suma exacta), `tests/direccion.comparativos.test.ts` (R5, R6), `tests/direccion.alertas.test.ts` (cada código de §4.4), `tests/direccion.aprobacion.test.ts` (R10 a R13, R15, R18, la secuencia de §6.1), `tests/direccion.rutas.test.ts` (R16, R17, errores de §3.1), `tests/direccion.estatico.test.ts` (R19: guard primero, único archivo que nombra las funciones, sin escrituras, la migración solo nombra `unidades`) — `backend`.
- `tests/direccion.vista.test.ts` (filas, textos, exactitud, hojas de Excel con `FILTROS` que trae AM y marca) y `tests/direccion.render.test.ts` (roles: panel solo admin; estado en texto; aviso de en trabajo; `409 huella_distinta`; móvil con filtros en modal) — `frontend`.
- `tests/api.guards.roles.test.ts` (añadir las cinco rutas) — `backend`.
- `scripts/humo-00D1.sql` (R11, R13, R14, R20 y los cuadres R1–R2 en SQL; dos aplicaciones de la migración sin error) — `datos`.
- `tests/direccion.qa.test.ts` (casos borde de §5.3 que falten) — `qa`.

## 7. Fuera de alcance

- **Soles** en el tablero (la proyección no proyecta soles; decisión 110) y precio medio proyectado.
- Rol nuevo `direccion` y abrir Planificación a otros roles (decisión 2 de §10 si Javier lo pide; es un módulo de permisos).
- Que la aprobación **bloquee** el cierre o el flujo (opciones B y C de §5.1), y que un rechazo reabra o archive la proyección.
- Aprobar **por GM o por recorte** (la aprobación es de la proyección entera; las observaciones por GM van en el comentario).
- Editar cifras desde el tablero: es de solo lectura; las decisiones se toman en M7.
- Notificaciones (correo, aviso al planner) de una aprobación o un rechazo.
- Stock, cobertura, compras o IMI en el tablero (eso es M8).
- Proyección por tienda «misma» exacta (cambiaría M7 y el contrato de M8) y por marca exacta.
- Datos de la IA (07e) en el tablero.
- Firmas dobles o aprobación por varios niveles.

## 8. Plan por tandas (cada archivo con un solo dueño)

**T0 · Revisión.** `arquitecto-revisor` (opus) revisa esta ficha; el `arquitecto` (opus) la ajusta; Javier responde §10 (o se construye con los defaults).

**T1 (en paralelo).**
- **`datos`:** `supabase/migrations/00D1_tablero_direccion.sql` → la siguiente libre (hoy `0041`), `scripts/humo-00D1.sql`, `src/lib/supabase/database.types.ts` regenerado. Aplica en **`vector-two`** (nunca `lukers-compras`) con el MCP, corre el humo dos veces y **la puerta de medición de §2.4** (cuatro casos, dos pasadas, frío y caliente, tamaño); si se pasa del umbral, añade el plan B en la misma migración y lo anota. Actualiza la tabla de reservas de `docs/PLAN.md` §5 en el mismo commit (la `0041` deja de ser «reservada sin ficha»).
- **`backend` · contratos:** `src/lib/direccion/tipos-api.ts` y `src/lib/direccion/esquemas.ts`, commit solo, para desbloquear a `frontend`.

**T2 (en paralelo, tras T1).**
- **`backend`:** `src/lib/direccion/consultas.ts`, `cache.ts`, `tablero.ts`, `atribucion.ts`, `comparativos.ts`, `alertas.ts`, `aprobacion.ts`, `servicio.ts`; rutas `src/app/api/direccion/{opciones,tablero,aprobaciones,estado}/route.ts`; en M7, solo la traducción `409 tiene_aprobaciones` del `DELETE` de proyecciones (`src/app/api/proyeccion/proyecciones/[id]/route.ts` y `traducirErrorDb` si hace falta); pruebas de §6.4 de su dueño. Importa sin modificar `src/lib/proyeccion/` y `src/lib/curvas/grafico.ts`.
- **`frontend`:** `src/app/(app)/planificacion/aprobacion-direccion/*` (§4.1), `src/lib/direccion/excel.ts` (hojas, puro), el item en `src/lib/nav.ts`, la línea de estado en `cabecera-proyeccion.tsx` y en la cabecera de Flujo mensual (solo admin y planner); pruebas de §6.4 de su dueño. Importa sin modificar el kit de UI, `descarga-libro.ts`, `formato.ts`, `grafico-mensual-fila.tsx` como referencia.

**T3 · `qa`:** las cuatro verificaciones, §6.2 con la base falsa, casos borde de §5.3 en `tests/direccion.qa.test.ts`; mide en local el tamaño de las respuestas.

**T4 · `seguridad` (sonnet):** §6.3, solo lectura; hallazgos a `backend` y `datos`, que corrigen (si hace falta una migración de corrección, toma la siguiente libre y se registra dentro de la `0.19.0`, como la `0040`).

**T5 · `documentador`:** `CHANGELOG.md`, `docs/PLAN.md` (estado de módulos, reservas, lista de tablas de solo inserción, versión), `docs/DECISIONES.md` (§9 de propuestas a vigentes), esta ficha (sección «Construido»), `docs/pruebas/cowork-checklist.md` (sección S) y `src/lib/version.ts` → **`0.19.0 · M14`**. Luego, hito con Javier.

## 9. Propuestas para `docs/DECISIONES.md` (numeración siguiente: 134 en adelante)

- **134 · El tablero de dirección es de solo lectura, en unidades, sobre lo guardado.** Suma `meses` de la proyección y la venta publicada sin CD; nunca reparte ni proyecta soles. Descartado: soles estimados (decisión 110).
- **135 · La agrupación de marca es filtro de primer nivel; la marca individual se estima en lo proyectado** con `participaciones.por_marca` y es exacta en la venta. Descartado: releer venta por marca para cada fila.
- **136 · Lo proyectado de una tienda «misma» es una atribución informativa** por su participación en los 12 meses cerrados del mismo recorte, que cuadra con el bloque; nuevas, aperturas y cierres son exactos (extiende la 111).
- **137 · La aprobación de dirección es un registro de solo inserción con huella de cifras;** su estado (incluido «invalidada») se deriva al leer y manda la más reciente; la huella no incluye el estado, así que cerrar sin cambios no la invalida.
- **138 · La aprobación no bloquea el cierre ni el flujo** (opción A de §5.1); se ve como aviso para admin y planner.
- **139 · Solo el admin aprueba; no hay rol nuevo en `0.19.0`.**
- **140 · La migración reservada `0041` («tabla de agregados de venta») la toma M14:** funciones de lectura del tablero, la tabla de aprobaciones y, solo si la medición lo exige, `venta_agregada_carga` (solo inserción por carga, sin nodo ni AM desnormalizados).

Cambios en otros documentos (los hace `documentador` en T5): `docs/PLAN.md` §3 (el admin aprueba en dirección), §5 (fila M14 y reservas); 07 §6.3 (eliminar una proyección con aprobaciones → `409 tiene_aprobaciones`); 08 §0.2 (aviso informativo de dirección en Flujo, sin cambio de contrato).

## 10. Decisiones que necesita Javier

*Si no respondes, se construye con la recomendación de cada una.*

1. **¿La aprobación de dirección bloquea algo?** Opciones: A, que solo informe (estado y aviso en Proyección y Flujo); B, que no se pueda cerrar sin aprobación; C, que Compras solo use una cerrada aprobada. **Recomendación: A.** No frena el cierre mensual ni deja Compras sin demanda. Se puede endurecer después sin perder el historial.
2. **¿Quién aprueba?** **Recomendación: solo el admin**, sin rol nuevo. Si quieres que apruebe alguien de dirección que no sea admin, hace falta un rol `direccion` (solo lectura de Planificación más aprobar). Sería un cambio de permisos aparte, posterior a este módulo.
3. **¿Qué proyección abre el tablero por defecto?** **Recomendación: la cerrada vigente**, que es la que usa Compras, con un selector y «Comparar con» para ver la en trabajo («seguimiento sep»). La alternativa es abrir la en trabajo más reciente.
4. **¿Aceptas cifras estimadas al filtrar una tienda «misma» o una marca?** La proyección no se guarda por tienda (mismas tiendas) ni por marca. **Recomendación: sí, rotuladas «estimado».** La tienda se estima con su participación de los últimos 12 meses y la marca con su participación histórica en la fila. La alternativa es mostrar en esos filtros solo la venta, y lo proyectado del bloque entero sin recortar.
