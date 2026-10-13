# M7 · Proyección anual de unidades

> Estado: **especificación pendiente de aprobación por Javier (escrita el 2026-10-13)**. No hay código ni migración. Módulos de los que depende: [05-venta-stock](05-venta-stock.md) (hechos mensuales: venta neta, costo vendido y stock de fin de mes por tienda × equivalencia × marca × agrupación de talla, desde 2023-01), [06-curvas-estacionalidad](06-curvas-estacionalidad.md) (curva vigente por agrupación de estacionalidad, `temporada`, `periodos_atipicos`, `claseDeAnio`, `ratio_volumen`), [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) (`nivel_planificacion`, marcas relevantes por GML, al barrer, conjuntos, `claveFlujo`, `curvaUnidad`, vistas `marcas_unidad` y `marca_gml_especial_vigente`), [04-tiendas](04-tiendas.md) (apertura, cierre, `venta_esperada_promedio`) y [01-arbol-producto](01-arbol-producto.md). Migración prevista: `0014_proyeccion_anual.sql` (renumerada el 2026-10-13 desde `0012`: la `0012` la tomó `sugerir_marcas_relevantes_v2` de M2b y el paso 2 de M6, vista materializada, corridas y curvas, pasó a `0013`); versión prevista `0.10.0 · M7` (después de `0.9.1 · M6`, cuyo cálculo de curvas es prerrequisito del reparto mensual; el mantenimiento de M7 funciona antes). Toda la API, lecturas incluidas, es `requirePlanner` (criterio de M5 y M6: venta y costo son margen). Ningún dato real de Lukers en esta ficha: ALFA, BETA, GAMMA y las cifras son sintéticas.

## 1. Objetivo

Convertir el histórico de M5 en una **proyección anual de unidades por fila de flujo** (unidad de planificación GML o GMLE × agrupación de marca × marca relevante u "otras" × agrupación de talla, más el flujo propio de las marcas al barrer) **repartida en doce meses** con la curva de M6, dentro de **escenarios nombrados** que el planner ajusta (crecimiento, totales fijados, tiendas, factor del Niño) y aprueba. Separa lo **automático** (base histórica normalizada, aporte de tiendas, señal de quiebre, curva) de lo **editable** (supuestos) para que recalcular nunca pise una decisión del planner. El escenario aprobado de un año es el único insumo de volumen de M8 (flujo y compra).

## 2. Decidido por Javier (acumulado 2026-10-11 → 13)

1. Dimensiones: Género / Mundo / Línea / Equivalencia / Agrupación de marca / Marca / Agrupación de talla. La mayoría se planifica a nivel **GML**; solo algunos nodos se abren a **GMLE** (`genero_mundo_linea.nivel_planificacion`, 02b).
2. Dentro de cada unidad y agrupación de marca (RECONOCIDO…), las **3-4 marcas relevantes** de ese GML (`marca_gml_especial`) y **"otras de la agrupación"**; las marcas **al barrer** tienen flujo propio sin detalle por GML; un **conjunto** (ALFA + ALFA JEANS + ALFA KIDS) es una sola unidad de marca. "5 principales por equivalencia" queda como **desglose informativo** (ranking por venta dentro de la fila), no como fila de planificación: la fila es la que define `claveFlujo`.
3. **"La estacionalidad no cambia tanto, lo que cambia es el volumen"**: la forma la pone M6; M7 trabaja el volumen. Los años de Niño (2023, 2026) de las agrupaciones de **invierno** son atípicos en volumen y **se normalizan** con `ratio_volumen` (M6) o con un factor del planner.
4. **CV % = costo ÷ venta neta** agregado por línea-mes (y aquí por unidad-mes) como **señal** de liquidación; no corrige nada por sí solo.
5. Aperturas y cierres de M4 entran en la proyección (red comparable, tiendas nuevas con `venta_esperada_promedio`, cerradas).
6. La curva de una unidad GML es la **mezcla ponderada** de las curvas de sus equivalencias (`curvaUnidad`, 02b); GMLE = la curva de la equivalencia.
7. El quiebre de stock se detecta con el **stock de fin de mes** de M5.

## 3. Conceptos

- **Unidad de planificación (`unidad`)**: nodo GML vigente (`nivel = 'GML'`, `equivalencia_id = null`) o una equivalencia activa de un nodo `GMLE`. Identificador: `(gml_id, equivalencia_id | null)`.
- **Fila de flujo (`fila`)**: `claveFlujo` de 02b × `agrupacion_talla_id`. Dos tipos: `unidad` → `(gml_id, equivalencia_id|null, agrupacion_marca_id, marca_id|null, agrupacion_talla_id)`; `barrido` → `(marca_id, agrupacion_talla_id)`. Es la partición completa y disjunta de los hechos de M5 (02b, regla 12). Tamaño esperado: ~556 nodos × ≤ 5 agrupaciones × (relevantes + 1) × 2 tallas ≈ 8 000-12 000 filas con venta.
- **Agrupación de estacionalidad dominante de una unidad**: la de mayor peso en unidades entre sus equivalencias activas en la ventana base (empate: la primera por nombre). Da la `temporada`, los meses atípicos (`claseDeAnio`) y el ratio del Niño de la unidad. Si las equivalencias de la unidad mezclan temporadas → aviso `temporadas_mezcladas_unidad` (caso raro cuando Javier agrupa por GML; con GMLE es imposible).
- **Ventana base (W)**: los meses de histórico que fijan el volumen. Tres métodos (`metodo_base`): `ultimos_12` (por defecto: los 12 meses hasta `hasta_periodo`, p. ej. 2025-10 a 2026-09), `ultimo_anio_completo` (el calendario completo anterior) y `promedio_ponderado` (los últimos `anios_promedio` = 3 años completos, pesos 1, 2, 3, cada año normalizado antes de promediar).
- **Año objetivo (T)**: `anio_objetivo` del escenario (2027). Calendario enero-diciembre (M6, pregunta 7).
- **Escenario**: una versión nombrada de la proyección de un año (`"2027 base"`, `"2027 agresivo"`), con sus parámetros, sus supuestos y sus resultados. A lo sumo uno **aprobado** por año objetivo: ese es el que M8 lee.
- **Base** (automática) vs **supuestos** (planner): `total_f = aplicarSupuestos(base_f × F_u, supuestos)`. Recalcular rehace la base y vuelve a aplicar los supuestos; editar un supuesto reaplica solo sobre la base guardada, sin tocar el agregado.

## 4. Método de proyección (TypeScript puro en el servidor, `src/lib/proyeccion/`)

Entrada por unidad: la serie mensual de cada fila (`unidades`, `venta_soles`, `costo_vendido`, `stock_unidades`) para toda la red y, por unidad, la serie por tienda; las tiendas de M4; la curva vigente por agrupación (M6); los periodos atípicos y los ratios; los supuestos del escenario.

**Paso 1 · Normalización del Niño (por fila y mes, solo unidades cuya agrupación dominante es de `invierno`).** `A` = `claseDeAnio(año, agrupación, periodos, mesesPublicados).meses_atipicos` de cada año de W. Para `m ∈ A`: `u'_m = u_m ÷ ratio`, con `ratio` = `ratio_aplicado` de `factores_volumen_atipico` para (periodo, agrupación) (manual) o, si no hay, el `ratio_volumen` de la última corrida de M6 (`ratio_calculado`); sin ninguno → sin normalizar y aviso `sin_ratio`. Para `m ∉ A`: `u'_m = u_m`. Es la opción **(a)** de M6 (corregir el histórico base), elegida porque la base debe ser "un año normal"; la opción (b), un factor sobre el año objetivo si T fuera de Niño, es el parámetro `factor_objetivo_invierno` (por defecto 1) del paso 5. Un ratio ≤ 0,05 o > 3 se rechaza (`400`).

**Paso 2 · Señal e imputación de quiebres (por fila y mes).** `cobertura_m = stock_fin_m ÷ u'_m` (red). Un mes es **quiebre** si `u'_m > 0` y `cobertura_m < umbral_cobertura` (por defecto **0,25**: al cerrar el mes quedaba menos de un cuarto de lo vendido). Con `ajuste_quiebres = 'senal'` (por defecto) solo se marca y se estima `perdidas_m = max(0, esperado_m − u'_m)`; con `'imputar'`, `u''_m = max(u'_m, esperado_m)`, donde `esperado_m = c_m ÷ Σ_{k∉Q} c_k × Σ_{k∉Q} u'_k` (lo que el mes habría vendido siguiendo la curva `c` de la unidad y los meses sin quiebre `Q`); con `'ninguno'` no se evalúa. Sin curva o con menos de 6 meses sin quiebre no se imputa (`sin_curva`, `quiebres_demasiados`). Es una señal de red: un quiebre en una sola tienda queda diluido (M8 lo trata por tienda).

**Paso 3 · Volumen base de la fila.** `ultimos_12` y `ultimo_anio_completo`: `B_f = Σ_{m∈W} u''_m`. `promedio_ponderado`: `B_f = Σ_Y w_Y × Σ_{m∈Y} u''_m ÷ Σ_Y w_Y` sobre los años completos de W. Se guarda además, por año completo del histórico, el total crudo y el normalizado (tabla "Años" de la pantalla) y la **tendencia** informativa `tendencia_f = total_norm(R) ÷ total_norm(R−1) − 1` (R = último año completo; `null` si falta alguno o el anterior es 0).

**Paso 4 · Aporte de tiendas (por unidad; se aplica a todas sus filas).** Con las fechas de M4 (`estadoTienda`, `hoyLima`), para cada tienda de tipo Tienda y activa:
- `completa`: abierta los 12 meses de W (`fecha_apertura ≤ inicio W`, sin cierre dentro de W) → `base_t = unidades_t,W`.
- `parcial`: abrió dentro de W (`meses_t` ≥ 1 con hechos) → `base_t = unidades_t,W × 12 ÷ meses_t`.
- `nueva`: sin hechos en W y `fecha_apertura ≤ T-12-31` (Planificada o recién abierta) → `base_t = ū × escala_t`, con `ū` = promedio de `base_t` de las completas y `escala_t = venta_esperada_promedio_t ÷ promedio(venta_soles mensual por tienda completa en W)`; sin `venta_esperada_promedio` → `escala_t = 1` y aviso `tienda_sin_venta_esperada`. `incluir_planificadas = false` las deja fuera.
- `fracción_t` = meses de T en los que la tienda está abierta ÷ 12 (apertura dentro de T, cierre dentro de T; cerrada antes de T → 0 → `cerrada`; `fecha_cierre` es el último día con venta, M4).
- `F_u = Σ_t base_t × fracción_t ÷ Σ_{t completas ∪ parciales} unidades_t,W`; si el denominador es 0, `F_u = 1` con aviso `sin_tiendas_base`. Supuesto: la mezcla de marcas y tallas de una tienda nueva es la de la red (no hay histórico que diga otra cosa). El CD y las tiendas desactivadas no entran; una tienda sin `fecha_apertura` cuenta como `completa` con aviso `tienda_sin_apertura`.

**Paso 5 · Crecimiento, factor y supuestos.** `pre_f = B_f × F_u × (1 + g_u) × φ_u`, con `g_u` = `crecimiento_pct` del supuesto de la unidad, si no el del escenario (por defecto **0**: la tendencia se muestra y se puede copiar con un botón, nunca se aplica sola), y `φ_u = factor_objetivo_invierno` solo si la unidad es de invierno (por defecto 1). Después `aplicarSupuestos`: un supuesto `fila` con `unidades_fijadas` manda sobre su fila; un supuesto `unidad_agrupacion` con `unidades_fijadas` fija el total de esa agrupación de marca en la unidad: las filas fijadas se respetan y el resto (relevantes no fijadas y "otras", por talla) se reparte en proporción a su `pre_f`; si `Σ fijadas > total` el resto queda en 0 con aviso `fijadas_exceden`. Un supuesto `unidad_agrupacion` con `crecimiento_pct` sustituye a `g_u` para esa agrupación. Así el ejemplo de Javier ("1 000 jeans RECONOCIDO, 500 de ALFA") sale por **participación histórica con crecimiento** y se puede **fijar** a mano en cualquiera de los dos niveles (resuelve lo que PLAN dejaba abierto).

**Paso 6 · Reparto mensual.** `c_u = curvaUnidad(unidad, equivalencias, curvasVigentes, pesos)` con `pesos` = unidades de cada equivalencia en W (02b); para una fila `barrido`, la misma función con nivel `GML` sobre las equivalencias donde la marca vendió en W. `m_f = repartirEntero(total_f, c_u)`: redondeo por **mayor resto** (los doce enteros suman exactamente `total_f`). Sin curva (`curva: null` o `curva_incompleta`) la fila conserva `total_anual` y `m01..m12 = null`, aviso `sin_curva`; el hito exige que no quede ninguna con venta. Todas las filas de una unidad usan la misma curva (la talla y la marca no tienen curva propia; fuera de alcance).

**Paso 7 · Señales informativas.** CV % por línea-mes y por unidad-mes en W (`cvMensual` de M6) con la marca de liquidación de M6 (`mesesEnLiquidacion`); ranking de las 5 marcas con más venta dentro de cada fila "otras" (desglose, sale de los hechos). No alteran cifras.

Precalculado o al vuelo: el **agregado** se precalcula (MV de abajo, refrescada al calcular, como M6); el **cálculo** corre una vez por `calcular` y escribe `proyeccion_unidades` y `proyeccion_filas`; la **edición de supuestos** reaplica los pasos 5-6 sobre la `base` guardada de la unidad afectada (TypeScript puro, milisegundos, sin leer la MV); las pantallas solo leen tablas.

## 5. Modelo de datos (`0014_proyeccion_anual.sql`)

Idempotente, sin `DROP`/`DELETE`/`TRUNCATE`, `create or replace` en vistas y funciones, RLS activo sin políticas en toda tabla, `id uuid`, `activo`, `created_at`/`updated_at` con trigger.

### Vista materializada `venta_mensual_flujo` (agregado precalculado)

Grano: `(gml_id, equivalencia_id null, tipo, agrupacion_marca_id null, marca_id null, agrupacion_talla_id, tienda_id, periodo)` con `unidades bigint`, `venta_soles`, `costo_vendido numeric`, `stock_unidades bigint`. Es `claveFlujo` escrita en SQL: `venta_stock_vigente h join equivalencias e join genero_mundo_linea n join marcas_unidad u on u.marca_id = h.marca_id join marcas cab on cab.id = u.unidad_marca_id left join marca_gml_especial_vigente v on v.marca_id = u.unidad_marca_id and (v.genero_mundo_linea_id is null or v.genero_mundo_linea_id = n.id)`; `tipo = 'barrido'` si `v.modalidad = 'barrido'`, `equivalencia_id = case when n.nivel_planificacion = 'GMLE' then e.id end`, `marca_id = case when v.modalidad = 'por_gml' then u.unidad_marca_id end` (barrido: `u.unidad_marca_id`), `agrupacion_marca_id = cab.agrupacion_marca_id` (**siempre la de la unidad de marca**, nunca la del miembro). La MV no guarda la equivalencia de los hechos de un nodo GML (se colapsa a la unidad a propósito); los pesos que `curvaUnidad` y la agrupación dominante necesitan salen de una segunda vista materializada ligera, `venta_mensual_equivalencia (equivalencia_id, periodo, unidades)` (≈ 1 900 × 45 ≈ 85 mil filas), refrescada a la vez. Tamaño estimado de `venta_mensual_flujo`: 200-400 mil filas, 30-50 MB (de 1,5 millones). Índices: `(gml_id, periodo)`, `(marca_id, periodo) where tipo = 'barrido'`. Seguridad como M6: `revoke all … from public, anon, authenticated; grant select to service_role` (segunda MV bajo la misma excepción a "RLS sin políticas"). Un test SQL comprueba que la MV y `claveFlujo` (TS) parten igual un juego sintético de hechos.

### Funciones SQL (`security definer`, `set search_path = ''`, `revoke … from public, anon, authenticated`, `grant to service_role`)

- `refrescar_venta_mensual_flujo() returns jsonb` → `{ filas, duracion_ms, refrescada_at }`; refresca las dos MV. La llama `calcular` siempre (el nivel de un nodo, un conjunto o una marca relevante pueden haber cambiado).
- `serie_flujo(p_gml_ids uuid[], p_desde date, p_hasta date) returns jsonb`: para esos nodos, `{ filas: [{ clave…, meses: [{ periodo, unidades, venta_soles, costo_vendido, stock_unidades }] }], tiendas: [{ gml_id, equivalencia_id, tienda_id, periodo, unidades, venta_soles }], equivalencias: [{ gml_id, equivalencia_id, unidades }] }` (la serie por fila es de red; la de tienda, por unidad). Devuelve `jsonb` para esquivar el tope de 1 000 filas de PostgREST; el servidor la llama en tandas de `TANDA_GML = 20` nodos, 4 en paralelo. `serie_barrido(p_desde, p_hasta)` hace lo mismo para las filas al barrer. Nunca escriben.

### `escenarios_proyeccion`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `nombre` | `text not null` | 1-80, `trim`; único `(anio_objetivo, upper(nombre))` |
| `anio_objetivo` | `integer not null` | `check between 2024 and 2100` |
| `estado` | `text not null default 'borrador'` | `check in ('borrador','aprobado','archivado')`; **único parcial `(anio_objetivo) where estado = 'aprobado'`**: la garantía que M8 necesita |
| `parametros` | `jsonb not null` | `ParametrosEscenario` (abajo) |
| `resumen` | `jsonb null` | del último cálculo: totales, conteos, avisos, `agregado_refrescado_at`, `duracion_ms`, `curvas_usadas`, `ratios_usados` |
| `calculado_at` | `timestamptz null` | `null` = nunca calculado |
| `aprobado_at`, `aprobado_por_id → perfiles on delete set null`, `aprobado_por_nombre` | | quién aprobó |
| `nota` | `text null ≤ 500` | |
| `perfil_id → perfiles on delete set null`, `usuario_nombre` | | quién lo creó |
| `activo`, `created_at`, `updated_at` | | `activo` por convención; eliminar solo en `borrador` sin filas (si no, `409`: se archiva) |

Transiciones: `borrador → aprobado` (primero el aprobado anterior del mismo año pasa a `archivado`, después se aprueba este; sin transacción, como M6: un fallo deja el año sin aprobado, visible y reparable repitiendo), `aprobado → archivado`, `borrador → archivado`. Un escenario aprobado **no se recalcula ni se editan sus supuestos** (`409 aprobado`): se copia a un borrador nuevo (`copiar_de`).

### `supuestos_proyeccion` (lo que edita el planner)

| Columna | Tipo | Notas |
|---|---|---|
| `escenario_id` | `uuid not null → escenarios_proyeccion on delete cascade` | índice |
| `ambito` | `text not null` | `check in ('unidad','unidad_agrupacion','fila','barrido')` |
| `gml_id` (`→ genero_mundo_linea on delete cascade`), `equivalencia_id` (`→ equivalencias on delete cascade`), `agrupacion_marca_id` (`→ agrupaciones_marca on delete cascade`), `marca_id` (`→ marcas on delete cascade`), `agrupacion_talla_id` (`→ agrupaciones_talla on delete restrict`) | `uuid null` | `check` por ámbito: `unidad` exige `gml_id` y nada de marca/talla; `unidad_agrupacion` exige `gml_id` + `agrupacion_marca_id`; `fila` exige `gml_id` + `agrupacion_marca_id` + `agrupacion_talla_id` (`marca_id` null = "otras"); `barrido` exige `marca_id` + `agrupacion_talla_id` y `gml_id` null |
| `clave` | `text not null` | texto canónico del ámbito (`textoClaveSupuesto`), único `(escenario_id, clave)`: evita el problema de `null` en únicos compuestos |
| `crecimiento_pct` | `numeric(6,2) null` | `check between -95 and 500`; no en `fila`/`barrido` |
| `unidades_fijadas` | `integer null` | `check >= 0`; no en `unidad`; `check (crecimiento_pct is not null or unidades_fijadas is not null)` y no los dos a la vez |
| `nota` | `text null ≤ 300` | |
| `perfil_id`, `usuario_nombre` | | quién |
| `activo`, `created_at`, `updated_at` | | `activo` sin uso (quitar borra) |

### `factores_volumen_atipico` (ratio del Niño, independiente del escenario)

`periodo_atipico_id → periodos_atipicos on delete cascade`, `agrupacion_estacionalidad_id → agrupaciones_estacionalidad on delete cascade`, `ratio_calculado numeric(6,4) null` (copiado de la última corrida de M6 al abrir la pestaña o al calcular; `corrida_id` nullable), `ratio_aplicado numeric(6,4) null` (`check > 0.05 and <= 3`; `null` = usar el calculado), `origen text check in ('corrida','manual')`, `nota ≤ 200`, `perfil_id`, `usuario_nombre`; único `(periodo_atipico_id, agrupacion_estacionalidad_id)`. Las filas se crean al vuelo (`PUT`) solo para las agrupaciones de invierno (o todas, si el periodo es `todas`). Es un hecho sobre el histórico, no un supuesto de escenario: por eso vive fuera; cada escenario guarda en `resumen.ratios_usados` los que aplicó.

### `proyeccion_unidades` (una fila por unidad por escenario; lo que M8 necesita de tiendas y curva)

`escenario_id` (cascade), `gml_id` (restrict), `equivalencia_id null` (restrict), `nivel_proyectado text check in ('GML','GMLE')`, `agrupacion_estacionalidad_id null` (dominante), `temporada`, `curva jsonb null` (12), `curva_origen jsonb` (`[{ agrupacion_id, version, peso }]`), `factor_tiendas numeric(8,4)`, `tiendas jsonb` (`[{ tienda_id, clase, base, fraccion, escala }]`), `anios_atipicos jsonb`, `ratio_aplicado numeric null`, `total_base`, `total_anual integer`, `avisos jsonb`; único `(escenario_id, gml_id, coalesce(equivalencia_id, '00000000-…'))` vía columna `clave text` única `(escenario_id, clave)`. Índice `(escenario_id, gml_id)`.

### `proyeccion_filas` (el resultado; contrato de M8)

| Columna | Tipo | Notas |
|---|---|---|
| `escenario_id` | `uuid not null → escenarios_proyeccion on delete cascade` | |
| `clave` | `text not null` | `textoClaveFlujo(clave) + '|' + agrupacion_talla_id`; único `(escenario_id, clave)` |
| `tipo` | `text check in ('unidad','barrido')` | |
| `gml_id`, `equivalencia_id`, `agrupacion_marca_id`, `marca_id`, `agrupacion_talla_id` | `uuid null` (talla `not null`) | FKs `on delete restrict`; mismos `check` por tipo que `claveFlujo` |
| `base` | `jsonb not null` | `BaseFila`: serie W cruda, normalizada e imputada por mes, quiebres, años completos (crudo/normalizado), tendencia, ranking de 5 marcas en "otras" |
| `total_base` | `numeric(14,2) not null` | `B_f` |
| `pre_supuestos` | `numeric(14,2) not null` | `B_f × F_u × (1+g) × φ` |
| `total_anual` | `integer not null` | tras supuestos; `check >= 0` |
| `m01` … `m12` | `integer null` | `check (todos null o Σ = total_anual)` |
| `supuesto_aplicado` | `text null` | `'fila'` / `'unidad_agrupacion'` / `null` |
| `avisos` | `jsonb not null default '[]'` | |
| `created_at`, `updated_at` | | sin `id`, sin `activo` (filas derivadas, se reescriben en cada cálculo; misma excepción que `venta_stock_mensual`) |

Índices: `(escenario_id, gml_id)`, `(escenario_id, marca_id) where tipo = 'barrido'`. Reescritura por cálculo: `upsert` por `(escenario_id, clave)` en tandas de 500 y, al final, el handler borra las filas del escenario cuya `clave` no está en el resultado nuevo (`delete … where escenario_id = $1 and clave = any($2)` en tandas; nunca en migración ni en función).

### Diagrama

```
venta_stock_vigente ─► [refresh] venta_mensual_flujo (MV, claveFlujo en SQL) ─► serie_flujo(gml[]) ─┐
curvas_estacionalidad (vigentes) + curvaUnidad ──────────────────────────────────────────────────────┤
periodos_atipicos + claseDeAnio + factores_volumen_atipico (ratio) ──────────────────────────────────┼─► calcularEscenario (TS puro)
tiendas (apertura, cierre, venta_esperada) ──────────────────────────────────────────────────────────┤        │
supuestos_proyeccion (planner) ──────────────────────────────────────────────────────────────────────┘        ▼
                                                    escenarios_proyeccion (uno `aprobado` por año) ─► proyeccion_unidades + proyeccion_filas ─► M8
```

## 6. Contratos de API

Convenciones de M1-M6: `ok`/`error`/`leerCuerpo`/`idDeRuta` (`src/lib/api/respuestas.ts`), `traducirErrorDb`, `leerTodo`. Handlers en `src/app/api/proyeccion/`; lógica pura en `src/lib/proyeccion/` (`tipos-api.ts` autocontenido, `tipos.ts`, `esquemas.ts`, `base.ts`, `atipicos.ts`, `quiebres.ts`, `tiendas.ts`, `supuestos.ts`, `reparto.ts`, `modelo.ts`, `reglas.ts`, `csv.ts`); acceso a datos solo en `consultas.ts` (único archivo que nombra las MV y las funciones). Errores: `401` · `403` (comprador) · `400` zod · `404` · `409` regla · `500`. **Tipos explícitos** (para construir backend y frontend en paralelo):

```ts
export type MetodoBase = "ultimos_12" | "ultimo_anio_completo" | "promedio_ponderado";
export type AjusteQuiebres = "ninguno" | "senal" | "imputar";
export type ParametrosEscenario = {
  hasta_periodo: string;                 // "aaaa-mm"; por defecto el último mes publicado y cerrado en Lima
  metodo_base: MetodoBase;               // "ultimos_12"
  anios_promedio: number;                // 3 (solo promedio_ponderado)
  normalizar_atipicos: boolean;          // true
  ajuste_quiebres: AjusteQuiebres;       // "senal"
  umbral_cobertura: number;              // 0.25
  crecimiento_pct: number;               // 0
  factor_objetivo_invierno: number;      // 1
  incluir_planificadas: boolean;         // true
  min_unidades_fila: number;             // 12: por debajo la fila se marca `escasa` (se proyecta igual)
};
export type EstadoEscenario = "borrador" | "aprobado" | "archivado";
export type EscenarioApi = { id: string; nombre: string; anio_objetivo: number; estado: EstadoEscenario; parametros: ParametrosEscenario;
  resumen: ResumenEscenario | null; calculado_at: string | null; desactualizado: MotivoDesactualizado[]; aprobado_at: string | null;
  aprobado_por_nombre: string | null; nota: string | null; usuario_nombre: string | null; supuestos: number; created_at: string; updated_at: string };
export type MotivoDesactualizado = "cargas_nuevas" | "curvas_cambiadas" | "nivel_cambiado" | "marcas_gml_cambiadas" | "tiendas_cambiadas" | "periodos_cambiados" | "ratios_cambiados" | "supuestos_sin_aplicar";
export type ResumenEscenario = { unidades: number; filas: number; filas_barrido: number; total_anual: number; total_base: number;
  por_genero: { genero: string; total_anual: number; total_base: number }[]; sin_curva: number; con_quiebres: number; escasas: number;
  tiendas: { completas: number; parciales: number; nuevas: number; cerradas: number }; ratios_usados: { periodo_atipico_id: string; agrupacion_id: string; ratio: number; origen: "manual" | "corrida" }[];
  curvas_usadas: { agrupacion_id: string; version: number }[]; niveles: Record<string, "GML" | "GMLE">; avisos: { codigo: AvisoProyeccion; n: number }[];
  agregado_refrescado_at: string; duracion_ms: number };
export type AvisoProyeccion = "sin_curva" | "curva_incompleta" | "sin_ratio" | "temporadas_mezcladas_unidad" | "quiebre" | "quiebres_demasiados" | "escasa"
  | "tienda_sin_venta_esperada" | "tienda_sin_apertura" | "sin_tiendas_base" | "fijadas_exceden" | "marca_pendiente_gml" | "nivel_cambiado";
export type ClaseTienda = "completa" | "parcial" | "nueva" | "cerrada";
export type TiendaAporte = { tienda_id: string; codigo: string; nombre: string; clase: ClaseTienda; unidades_w: number; meses_w: number; base: number; fraccion: number; escala: number | null; aporte: number };
export type MesBase = { periodo: string; unidades: number; normalizadas: number; imputadas: number; stock_fin: number; cobertura: number | null; atipico: boolean; quiebre: boolean; perdidas: number; cv: number | null; liquidacion: boolean };
export type AnioBase = { anio: number; completo: boolean; clase: "normal" | "atipico"; meses_atipicos: string[]; total: number; total_normalizado: number };
export type BaseFila = { ventana: { desde: string; hasta: string; metodo: MetodoBase }; meses: MesBase[]; anios: AnioBase[]; tendencia: number | null; top_marcas: { marca_id: string; marca: string; unidades: number }[] };
export type FilaProyeccionApi = { clave: string; tipo: "unidad" | "barrido"; gml_id: string | null; equivalencia_id: string | null; agrupacion_marca_id: string | null; marca_id: string | null;
  agrupacion_talla_id: string; genero: string; mundo: string; linea: string; equivalencia: string | null; agrupacion_marca: string | null; marca: string | null; agrupacion_talla: string;
  total_base: number; pre_supuestos: number; total_anual: number; meses: (number | null)[]; supuesto_aplicado: "fila" | "unidad_agrupacion" | null; avisos: AvisoProyeccion[] };
export type UnidadProyeccionApi = { gml_id: string; equivalencia_id: string | null; nivel: "GML" | "GMLE"; genero: string; mundo: string; linea: string; equivalencia: string | null;
  agrupacion_estacionalidad: { id: string; nombre: string; temporada: TemporadaAgrupacion } | null; curva: number[] | null; curva_origen: { agrupacion_id: string; version: number; peso: number }[];
  factor_tiendas: number; tiendas: TiendaAporte[]; anios_atipicos: { anio: number; meses_atipicos: string[]; ratio: number | null }[]; crecimiento_aplicado: number; factor_objetivo: number;
  total_base: number; total_anual: number; filas: number; avisos: AvisoProyeccion[]; supuestos: SupuestoApi[] };
export type AmbitoSupuesto = "unidad" | "unidad_agrupacion" | "fila" | "barrido";
export type SupuestoApi = { id: string; ambito: AmbitoSupuesto; clave: string; gml_id: string | null; equivalencia_id: string | null; agrupacion_marca_id: string | null; marca_id: string | null;
  agrupacion_talla_id: string | null; crecimiento_pct: number | null; unidades_fijadas: number | null; nota: string | null; usuario_nombre: string | null; updated_at: string };
export type FactorAtipicoApi = { periodo_atipico_id: string; motivo: string; agrupacion_estacionalidad_id: string; agrupacion: string; ratio_calculado: number | null; corrida_id: string | null;
  ratio_aplicado: number | null; ratio_efectivo: number | null; origen: "corrida" | "manual" | null; nota: string | null };
```

| Ruta | Método | Cuerpo (zod, `esquemas.ts`) | Respuesta `{ data }` y errores |
|---|---|---|---|
| `/api/proyeccion` | GET | — | `{ datos: { desde, hasta, meses_publicados, ultimo_mes_cerrado, curvas_vigentes, agrupaciones_sin_curva, nodos_gmle, marcas_pendientes_gml }, escenarios: EscenarioApi[] (sin `resumen.avisos` largos), aprobados: { anio, escenario_id }[] }` |
| `/api/proyeccion/escenarios` | POST | `crearEscenarioSchema = { nombre: 1-80, anio_objetivo: int, parametros: parametrosSchema.partial() (defaults), nota?, copiar_de?: uuid }` | `201 EscenarioApi`; `copiar_de` duplica parámetros y supuestos (no resultados); `409` nombre repetido en ese año; `409 anio_sin_historico` si `anio_objetivo ≤ año de hasta_periodo` |
| `/api/proyeccion/escenarios/[id]` | GET / PATCH / DELETE | `editarEscenarioSchema = { nombre?, parametros?: parametrosSchema.partial(), nota? }` | `EscenarioApi`; `PATCH` de parámetros marca `supuestos_sin_aplicar`→ `desactualizado`; `409 aprobado` al editar un aprobado; `DELETE` solo `borrador` (`409` si no) |
| `/api/proyeccion/escenarios/[id]/calcular` | POST | `{}` | `201 { escenario: EscenarioApi }`; pasos: refresco de MV → series por tandas → `calcularEscenario` → `upsert` unidades y filas → borrado de claves huérfanas → `resumen`; `409 sin_datos` sin mes publicado; `409 aprobado`; `409 sin_curvas` si no hay ninguna curva vigente (se puede forzar con `?sin_reparto=1`: totales anuales sin meses). 10 000 filas ≈ 5-15 s en Micro (ver riesgos) |
| `/api/proyeccion/escenarios/[id]/unidades` | GET | `?genero_id&mundo_id&linea_id&temporada&aviso&q` | `UnidadProyeccionApi[]` sin `tiendas` ni `supuestos` (ligero) + `totales` |
| `/api/proyeccion/escenarios/[id]/unidades/[gmlId]` | GET | `?equivalencia_id=` (obligatorio si el nodo es GMLE) | `{ unidad: UnidadProyeccionApi, filas: (FilaProyeccionApi & { base: BaseFila })[], cv_por_linea: { periodo, cv }[] }`; `404` |
| `/api/proyeccion/escenarios/[id]/filas` | GET | `?gml_id&tipo&formato=csv` | `FilaProyeccionApi[]` (todas las del escenario si no hay filtro; ≈ 3 MB; CSV con BOM: `GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION_MARCA, MARCA, TALLA, BASE, PRE, TOTAL, ENE…DIC, SUPUESTO, AVISOS`) |
| `/api/proyeccion/escenarios/[id]/supuestos` | PUT | `supuestosSchema = { supuestos: z.array(supuestoSchema).min(1).max(500) }`, `supuestoSchema = { ambito, gml_id?, equivalencia_id?, agrupacion_marca_id?, marca_id?, agrupacion_talla_id?, crecimiento_pct?: -95..500, unidades_fijadas?: int ≥ 0, nota? }` con `superRefine` por ámbito y "uno de los dos" | `{ guardados: SupuestoApi[], unidades_recalculadas: number, filas_recalculadas: number }`; reaplica pasos 5-6 sobre la `base` guardada de las unidades afectadas; `409 aprobado`; `409 unidad_sin_calcular` si el escenario no tiene esa unidad (hay que calcular primero) |
| `/api/proyeccion/escenarios/[id]/supuestos/[supuestoId]` | DELETE | — | `{ id, filas_recalculadas }`; `409 aprobado` |
| `/api/proyeccion/escenarios/[id]/aprobar` | POST | `{ nota? }` | `EscenarioApi` aprobado; `409 sin_calcular`, `409 desactualizado` (salvo `?forzar=1`), `409 ya_aprobado`; archiva el aprobado anterior del mismo año y lo devuelve en `archivado_id` |
| `/api/proyeccion/escenarios/[id]/archivar` | POST | — | `EscenarioApi` |
| `/api/proyeccion/factores-atipicos` | GET / PUT | `PUT { factores: [{ periodo_atipico_id, agrupacion_estacionalidad_id, ratio_aplicado: number \| null (0.05-3), nota? }] }` | `FactorAtipicoApi[]` (todas las parejas periodo × agrupación afectada, exista fila o no; `GET ?sincronizar=1` copia `ratio_volumen` de la última corrida de M6 en `ratio_calculado`); `409` agrupación no afectada por el periodo |
| `/api/proyeccion/aprobada` | GET | `?anio=2027` | **Contrato de M8**: `{ escenario: EscenarioApi, unidades: UnidadProyeccionApi[], filas: FilaProyeccionApi[] }`; `404 sin_aprobado`. En código, M8 usa `leerProyeccionAprobada(db, anio)` de `consultas.ts` (misma forma) y los tipos de `tipos-api.ts`; nunca recalcula |

Constantes (`tipos.ts`): `UMBRAL_COBERTURA = 0.25`, `MIN_MESES_SIN_QUIEBRE = 6`, `MIN_UNIDADES_FILA = 12`, `TANDA_GML = 20`, `PARALELO_SERIES = 4`, `TANDA_UPSERT = 500`, `RATIO_MIN = 0.05`, `RATIO_MAX = 3`, `TOP_MARCAS = 5`, `PARAMETROS_POR_DEFECTO`.

## 7. Pantallas

Ruta **`/planificacion/proyeccion`**, item "Proyección anual" en la sección Planificación de `nav.ts` (`PLANIFICACION`); el comprador no la ve ni entra (`page.tsx` redirige). Panel cliente `proyeccion-panel.tsx` con `Tabs`: **Escenarios · Proyección · Factores del Niño**. Datos con un hook propio `use-proyeccion.ts` (patrón `useResponsables`); toda escritura recarga. Kit: `Card`, `DataTable`, `Chips`, `Select`, `Modal`, `Alert`, `Badge`, `EmptyState`, `Switch`, `mini-curva` de M6 reutilizada.

**Escenarios.** Tabla: nombre, año objetivo, estado (badge), calculado el, total anual, supuestos, creado por, acciones **Abrir · Calcular · Copiar · Aprobar · Archivar · Eliminar** (solo borrador). Botón **Nuevo escenario** (`Modal`: nombre, año objetivo con valor por defecto = año siguiente al último mes publicado, "copiar de", parámetros plegados con sus valores por defecto y ayuda de una línea cada uno). `Alert` ámbar por escenario desactualizado con sus motivos ("hay un mes nuevo en M5 · cambió una curva · un nodo cambió de nivel"). `Alert` de prerrequisitos de `GET /api/proyeccion`: "N agrupaciones sin curva vigente (M6)", "N marcas marcadas sin GML (02b)", "N tiendas sin fecha de apertura (M4)".

**Proyección** (del escenario abierto; selector arriba). Cabecera: total anual vs total base, por género (barras), filtros `Select` Género / Mundo / Línea, `Chips` temporada, `Chips` de avisos (Sin curva N · Quiebres N · Escasas N · Fijadas N), buscador; `Input` **crecimiento global** del escenario con "Aplicar" (= `PATCH parametros` + reaplicar). Tabla por **unidad** (`DataTable`, una fila por GML o GMLE): Género · Mundo · Línea · Equivalencia · nivel (badge GML/GMLE) · temporada · base · factor tiendas · crecimiento (editable en línea = supuesto `unidad`) · total anual · mini curva · avisos · **Ver**. Barra con selección múltiple: "Aplicar crecimiento X % a N unidades" (supuestos en bloque, `confirm`). **Detalle de la unidad** (ruta `?unidad=<gml>&equivalencia=<id>`): (1) cabecera con curva (origen: agrupaciones y pesos), años atípicos y ratio aplicado, factor de tiendas con su tabla (`clase`, meses, base, fracción, escala, aporte; enlace a M4); (2) **tabla de filas** agrupada por agrupación de marca: marca (o "Otras de RECONOCIDO", con sus 5 principales en `title`), talla, base, pre, **total anual (editable = supuesto `fila`)**, los 12 meses, badge del supuesto aplicado, avisos; en la cabecera de cada agrupación, su total (**editable = supuesto `unidad_agrupacion`**) y su crecimiento; (3) **gráfico** SVG (`grafico-base.tsx`): serie mensual cruda, normalizada e imputada de la fila seleccionada, meses atípicos sombreados, quiebres con punto rojo, liquidación ámbar; (4) tabla "Años": año, clase, total crudo, normalizado, tendencia; (5) CV % por línea-mes. Validación en pantalla: `unidades_fijadas ≥ 0` entero, `crecimiento_pct` entre −95 y 500, aviso si `Σ fijadas > total de la agrupación`. Un `Alert` fijo "Escenario aprobado: solo lectura; copia para cambiar" cuando corresponda. **Descargar CSV** del escenario. **Al barrer**: sección propia al final de la tabla de unidades ("Marcas al barrer", una fila por marca × talla, mismo detalle sin tiendas por GML).

**Factores del Niño.** Tabla periodo atípico × agrupación afectada: ratio calculado (M6, con la corrida y fecha; botón **Sincronizar con M6**), ratio aplicado (editable; vacío = usar el calculado), origen, nota; `EmptyState` si no hay periodos (enlace a M6). Texto de ayuda: "0,62 = los meses del Niño vendieron un 38 % menos de lo esperado; al proyectar, esos meses se dividen entre el ratio". Cambiar un ratio marca `ratios_cambiados` en todo escenario borrador calculado.

## 8. Reglas de negocio (vitest, funciones puras)

**`atipicos.ts`** · 1. `normalizarAtipicos(meses, A, ratio)`: `m ∈ A` → `u ÷ ratio`; `m ∉ A` sin cambio; `ratio = null` → sin cambio y aviso `sin_ratio`; `A` vacío → idéntico. 2. `ratioEfectivo(factor)` = `ratio_aplicado ?? ratio_calculado ?? null`. 3. `agrupacionDominante(pesosPorEquivalencia, equivalencias)`: mayor peso; empate por nombre; `temporadas_mezcladas_unidad` si hay más de una temporada con peso > 0.
**`quiebres.ts`** · 4. `cobertura(stock, u)`: `u ≤ 0` → `null`. 5. `marcarQuiebres(meses, umbral)`: `cobertura < umbral` y `u > 0` → quiebre. 6. `imputarQuiebres(meses, curva, Q)`: `u'' = max(u', esperado)`; sin curva o `12 − |Q| < MIN_MESES_SIN_QUIEBRE` → sin cambio y aviso; `perdidas = max(0, esperado − u')`; con `Q` vacío → idéntico.
**`base.ts`** · 7. `ventana(metodo, hastaPeriodo, mesesPublicados, aniosPromedio)`: `ultimos_12` devuelve exactamente 12 meses terminados en `hasta`; `ultimo_anio_completo` el calendario anterior completo (si el año de `hasta` es completo con diciembre, ese); `promedio_ponderado` los últimos N completos; falta de meses publicados → `409 ventana_incompleta`. 8. `volumenBase(meses, metodo, pesos)`: suma o promedio ponderado con pesos `1..N`. 9. `tendencia(anios)`: `R ÷ (R−1) − 1` sobre normalizados; `null` si falta alguno o el anterior es 0.
**`tiendas.ts`** · 10. `claseTienda(t, W, T, hoy)`: completa / parcial / nueva / cerrada / fuera (CD, inactiva, apertura después de T); sin apertura → completa + aviso. 11. `fraccionAnio(t, T)`: abierta todo T → 1; apertura 2027-04-01 → 9/12; cierre 2027-06-30 → 6/12; cierre 2026-12-31 → 0. 12. `factorTiendas(aportes)`: `Σ base × fracción ÷ Σ unidades_W (completas+parciales)`; sin denominador → 1 + aviso; `escala` = `venta_esperada ÷ promedio soles mensual completas`; sin venta esperada → 1 + aviso.
**`supuestos.ts`** · 13. `textoClaveSupuesto` es canónico e inyectivo por ámbito. 14. `aplicarSupuestos(filasUnidad, supuestos, g_u, φ)`: sin supuestos → `total = round(pre)`; `fila` fijada manda; `unidad_agrupacion` fijado reparte el resto en proporción a `pre`; `Σ fijadas > total` → resto 0 + `fijadas_exceden`; `unidad_agrupacion.crecimiento_pct` sustituye a `g_u` para esa agrupación; `φ` solo en unidades de invierno. 15. `validarSupuesto` rechaza campos ajenos al ámbito y "ninguno o los dos" valores.
**`reparto.ts`** · 16. `repartirEntero(total, curva)`: suma exacta; `[1001, plana]` → cinco 84 y siete 83; `total = 0` → doce ceros; curva `null` → `null`. 17. Idempotente al sumar: `Σ repartirEntero(t, c) = t` para `t` en `0..5000` (test de propiedad).
**`modelo.ts`** · 18. `calcularEscenario` es determinista; nunca usa meses posteriores a `hasta_periodo`. 19. Identidad por unidad: `Σ_f total_anual = total_anual de la unidad` y `Σ_f m_k = total_anual_k` mensual. 20. `nivel_proyectado` guardado por unidad; `motivosDesactualizado` emite `nivel_cambiado` si el nivel actual del nodo difiere, y los otros siete motivos solo cuando su fecha es posterior a `calculado_at` (`max(updated_at)` de curvas, `marca_gml_especial`, `marcas`, `tiendas`, `periodos_atipicos`, `factores_volumen_atipico`; `publicada_at` de cargas; `supuestos.updated_at > calculado_at` → `supuestos_sin_aplicar`). 21. Filas `barrido` nunca llevan `gml_id` y usan `curvaUnidad` con nivel GML sobre las equivalencias donde vendieron. 22. Una fila con `total_base < min_unidades_fila` lleva `escasa` y se proyecta igual.
**`reglas.ts`** · 23. `motivoRechazoAprobar(escenario, desactualizado, forzar)`: sin calcular → `409`; desactualizado sin forzar → `409`; ya aprobado → `409`; si no, `null`. 24. `planificarAprobacion`: el aprobado anterior del mismo año pasa a `archivado` antes del `update` del nuevo. 25. `puedeEditar(escenario)`: solo `borrador`. 26. `puedeEliminar`: `borrador` sin `calculado_at`.
**SQL (script de humo local)** · 27. `0014` aplica dos veces; `venta_mensual_flujo` parte un juego sintético igual que `claveFlujo` (ALFA JEANS suma en ALFA con la agrupación de ALFA; una marca `por_gml` no relevante en ese GML cae en "otras"; una al barrer sale con `tipo = 'barrido'` y `gml_id` null); `anon` no lee las MV ni ejecuta `serie_flujo`; el único parcial de `aprobado` rechaza dos aprobados del mismo año; el `check` de meses rechaza `Σ m ≠ total_anual`.
**Estático** · 28. Solo `consultas.ts` nombra `venta_mensual_flujo`, `serie_flujo`, `serie_barrido` y `refrescar_venta_mensual_flujo`; `src/lib/proyeccion/` no importa de `src/components/` ni `@supabase/*` fuera de `consultas.ts`; toda ruta de M7 usa `requirePlanner`.

## 9. Casos de prueba sintéticos (`tests/proyeccion.fixture.ts`)

Árbol: nodo **HOMBRE · URBANO · DENIM** (GML) con equivalencias SKINNY y RECTO en la agrupación "DENIM SINTÉTICO" (`todo_el_ano`, curva plana 1/12); nodo **HOMBRE · CASUAL · ABRIGO** (GMLE) con equivalencia PARKA en "ABRIGO SINTÉTICO" (`invierno`, curva de M6 `[.02,.02,.06,.12,.20,.24,.16,.08,.04,.02,.02,.02]`). Marcas: ALFA (RECONOCIDO, relevante en DENIM; conjunto con ALFA JEANS), GAMMA (RECONOCIDO, relevante), DELTA (RECONOCIDO, no marcada), BETA (PREMIUM, al barrer). Tiendas: T1 (abierta 2020), T2 (abre 2026-07-01), T3 (Planificada 2027-04-01, `venta_esperada` = la mitad de la venta mensual de T1), CD. Periodo atípico "Niño 2023" 2023-03..05 alcance invierno, `ratio_calculado = 0,4`. `hasta_periodo = 2026-09`, `anio_objetivo = 2027`, parámetros por defecto.

1. **Partición**: hechos de ALFA JEANS en SKINNY caen en la fila `(DENIM, null, RECONOCIDO, ALFA, talla)`; DELTA cae en `(DENIM, null, RECONOCIDO, null, talla)`; BETA en `(barrido, BETA, talla)`; en ABRIGO (GMLE) la fila lleva `equivalencia_id = PARKA`. `Σ unidades de todas las filas = Σ hechos` (completa y disjunta).
2. **Ventana y base**: `ultimos_12` = 2025-10..2026-09; ALFA Centrales vende 100/mes en T1 → `B = 1 200`; con `ultimo_anio_completo` → 2025 (1 200 si 2025 también es 100/mes); `promedio_ponderado` con 2023 = 800, 2024 = 1 000, 2025 = 1 200 → `(800 + 2 000 + 3 600) ÷ 6 = 1 066,67`.
3. **Niño**: PARKA en 2023 = `[20,20,24,48,80,240,160,80,40,20,20,20]` (marzo-mayo al 40 %) → normalizado `[…,60,120,200,…]`, total 772 → 1 000; `AnioBase.clase = "atipico"`, `meses_atipicos = ["2023-03","2023-04","2023-05"]`; con `ratio_aplicado = 0,5` → 48/120/160, total 928; sin factor ni corrida → 772 y `sin_ratio`; DENIM (todo el año) no se toca.
4. **Quiebre**: PARKA junio de 2026 vende 150 con stock fin 20 (cobertura 0,13 < 0,25) → quiebre; esperado = `0,24 ÷ 0,76 × Σ otros (760) = 240`; `senal` → `perdidas = 90`, base sin cambio; `imputar` → junio 240.
5. **Tiendas en DENIM**: T1 completa 1 200; T2 parcial 30 unidades en 3 meses → base 120; T3 nueva, escala 0,5, fracción 9/12 → `ū × 0,5 × 0,75 = 450`; `F_u = (1 200 + 120 + 450) ÷ 1 230 = 1,439`; con `incluir_planificadas = false` → `1 320 ÷ 1 230 = 1,073`; si T1 cierra el 2027-06-30 → su aporte 600. El CD nunca aparece.
6. **Supuestos**: unidad DENIM con `pre` ALFA 500, GAMMA 200, otras 300 (por talla sumadas); crecimiento unidad 10 % → 550/220/330; supuesto `unidad_agrupacion` RECONOCIDO = 1 000 sin crecimiento → 500/200/300; además `fila` ALFA Centrales = 400 (su `pre` era 350) → ALFA 400 + ALFA Extremas y GAMMA y otras reparten 600 en proporción; fijadas 1 200 en una agrupación de 1 000 → resto 0 y `fijadas_exceden`.
7. **Reparto**: total 1 001 con curva plana → cinco meses de 84 y siete de 83 (suma 1 001); PARKA 1 000 con su curva → `[20,20,60,120,200,240,160,80,40,20,20,20]`; sin curva → `meses = null` y `sin_curva`.
8. **Curva de la unidad**: SKINNY (peso 700) y RECTO (300) en la misma agrupación → la curva es esa; si RECTO pasara a otra agrupación con curva distinta, mezcla 0,7/0,3; si RECTO no tuviera curva → `curva_incompleta` y mezcla solo de SKINNY.
9. **Desactualizado**: publicar 2026-10 en M5, cambiar DENIM a GMLE, aprobar una curva nueva o editar un ratio producen cada uno su motivo; un supuesto nuevo produce `supuestos_sin_aplicar` solo hasta que el `PUT` reaplica (en la práctica nunca, porque el `PUT` reaplica al guardar; el motivo cubre una escritura fallida).
10. **Aprobación**: aprobar "2027 base" y luego "2027 agresivo" deja el primero `archivado`; `GET /api/proyeccion/aprobada?anio=2027` devuelve el segundo con `Σ filas = total_anual`; editar supuestos del aprobado → `409`.

## 10. Criterios de aceptación / hito de prueba

**Automático** · `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (todos más `tests/proyeccion.*`), `npm run build`, `scripts/validar-migraciones-local.sh`; `0014` aplicada en `vector-two`; tipos regenerados; `APP_VERSION = 0.10.0 · M7`.

**Prerrequisitos de Javier** · Histórico de M5 cargado hasta el último mes cerrado; curvas vigentes de M6 (`0.9.1`) para las agrupaciones con venta; nodos GMLE, marcas relevantes y conjuntos de 02b cargados; tiendas con fechas y `venta_esperada_promedio` en las Planificadas; periodo "Niño costero 2023" creado.

**Hito (Javier, en Railway)**
- [ ] Roles: admin y planner ven Planificación → Proyección anual; el comprador no la ve, la URL lo redirige y `GET /api/proyeccion` le responde `403`.
- [ ] Factores del Niño: al abrir, "Sincronizar con M6" trae el `ratio_volumen` de cada agrupación de invierno para 2023; editar uno a mano y ver `origen = manual`.
- [ ] Crear "2027 base" con parámetros por defecto; **Calcular** termina en menos de 30 s (anotar el tiempo del refresco y del cálculo: son las mediciones de M8); el resumen dice unidades, filas, total anual, tiendas por clase y cuántas filas quedaron sin curva (debe ser 0 si M6 está completo).
- [ ] Abrir HOMBRE·URBANO·DENIM (o el nodo real equivalente): dentro de RECONOCIDO aparecen las marcas relevantes de ese GML y "Otras de RECONOCIDO", por talla; un conjunto aparece una sola vez con el nombre de la cabeza; las marcas al barrer están en su sección, sin GML.
- [ ] En una unidad de invierno, la tabla "Años" muestra 2023 como Niño con total crudo y normalizado, y el gráfico sombrea marzo-mayo; en una de verano, 2023 sale normal.
- [ ] Una tienda Planificada con apertura en 2027 aparece como `nueva` con su escala y fracción; una cerrada en 2026 aparece `cerrada` con aporte 0; apagar `incluir_planificadas` y recalcular baja el total.
- [ ] Fijar "RECONOCIDO de ese GML = 1 000" y "ALFA = 500": los totales cambian al instante, los meses suman exactamente y el badge muestra el supuesto; borrar el supuesto devuelve la participación histórica.
- [ ] Un mes con quiebre conocido por Javier aparece marcado; cambiar a `imputar` y recalcular sube ese mes y el total; volver a `senal` lo deja como estaba.
- [ ] Publicar un mes nuevo en M5 muestra "desactualizado"; aprobar sin recalcular responde `409` y con "forzar" aprueba; copiar el escenario y aprobar la copia archiva el anterior; `GET /api/proyeccion/aprobada?anio=2027` responde el nuevo.
- [ ] Descargar el CSV y compararlo con la planificación en Excel de cinco unidades conocidas (dos de invierno, dos de verano, una al barrer): las diferencias se explican con la tabla de años, el factor de tiendas o un supuesto. Si no, anotar qué parámetro las acerca antes de abrir M8.

## 11. Fuera de alcance

- Flujo de mercadería, stock objetivo, necesidad de compra, quiebre por tienda y documento para compradores (**M8**); distribución de la proyección **por tienda** (M7 entrega el factor y los aportes por unidad en `proyeccion_unidades.tiendas`; si M8 necesita unidades por tienda y mes, las deriva de ahí: `m_f × aporte_t ÷ Σ aportes`).
- Curvas por marca, talla o tienda; curvas manuales; modelos de tendencia (regresión, Holt-Winters): la tendencia se muestra y el crecimiento lo decide el planner.
- Proyección en soles o margen objetivo; precios; elasticidad de la liquidación (solo señal CV %).
- Flujos de aprobación por rol (cualquier planner aprueba; pregunta 9) y auditoría general (pendiente desde M0).
- Filtro "Mis combinaciones" por responsable (M1b): se añade en M8 con el documento para compradores.
- Reproyección automática al publicar un mes (M5 no se toca; M7 avisa `cargas_nuevas`).

## 12. Riesgos

- **Tamaño del cálculo**: ~10 000 filas × 45 meses leídas por `serie_flujo` en tandas (≈ 30 llamadas de 2-4 MB) y 10 000 `upsert` en 20 tandas; estimación 5-15 s en Micro, aceptable para una acción con avance. Si el refresco de la MV (1,5 M filas con tres `join`) supera el `statement_timeout` del `service_role`, la salida es compute Small o partir la MV por año (igual que M6). El piloto de M6 debe haber medido ya el refresco de su MV.
- **Filas chicas**: la cola larga de marcas y las tallas extremas producen bases de pocas unidades; se marcan `escasa` y se proyectan igual (el planner puede fijarlas). No se inventa un mínimo.
- **Tienda nueva con mezcla de red**: supuesto simplificador; si Javier sabe que una tienda nueva tendrá otra mezcla, se fija con supuestos; un `factor por tienda × unidad` es extensión natural de `supuestos_proyeccion` (ámbito `unidad_tienda`) sin cambiar el modelo.
- **Ratio del Niño por agrupación dominante**: en unidades GML con equivalencias de distintas agrupaciones se aplica el ratio de la dominante; el aviso lo señala y abrir el nodo a GMLE lo resuelve.
- **Sin transacción** al aprobar (archivar el anterior y aprobar el nuevo) y al recalcular (upsert + borrado de huérfanas): un fallo intermedio es visible (`desactualizado`, año sin aprobado) y se repara repitiendo.
- **Dependencia de M6 paso 2**: sin curvas vigentes M7 proyecta totales anuales sin meses (`?sin_reparto=1`), suficiente para revisar volúmenes pero no para M8.

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md` al aprobar)

1. **La fila de proyección es `claveFlujo` × agrupación de talla, y la unidad es GML o GMLE según `nivel_planificacion`**; "5 principales por equivalencia" pasa a desglose informativo. Descartado: proyectar por equivalencia siempre (contradice 02b) o por marca individual (cola larga irrevisable, como Vector-One).
2. **Base automática y supuestos del planner separados**: recalcular rehace la base y reaplica los supuestos; editar un supuesto reaplica sin leer el agregado. Descartado: editar cifras finales a mano (se perderían al recalcular, como en Vector-One).
3. **El Niño se normaliza en el histórico (opción a de M6) dividiendo los meses atípicos por `ratio_volumen`, con ratio editable por periodo × agrupación en una tabla fuera del escenario**; el factor sobre el año objetivo es un parámetro aparte (`factor_objetivo_invierno`, por defecto 1). Descartado: `reduccion_invierno_nino_pct` global de Vector-One; descartar años enteros.
4. **Escenarios nombrados por año objetivo, uno aprobado por año (único parcial), aprobado = solo lectura; M8 lee solo el aprobado.** Descartado: una única proyección "viva" sin versiones.
5. **Tiendas: red con clases completa / parcial / nueva / cerrada y factor por unidad**; tienda nueva = promedio de las completas × `venta_esperada ÷ promedio`. Descartado: modelar la mezcla por tienda (sin datos).
6. **El quiebre es una señal por defecto (`cobertura < 0,25`) y la imputación con la curva es opcional**. Descartado: corregir siempre (inventa venta).
7. **Agregado en una segunda MV (`venta_mensual_flujo`) protegida con `revoke`, con `claveFlujo` escrita en SQL y verificada contra la función pura**; lectura por función `jsonb` en tandas de nodos. Descartado: `leerTodo` sobre 300 mil filas; calcular en SQL.
8. **Toda la API de M7 es `requirePlanner`** (criterio de M5 y M6).

## 14. Cambios que hay que hacer en PLAN.md y otras fichas (los integra el orquestador)

- **PLAN §4, diagrama y tabla**: añadir `escenarios_proyeccion` (uno `aprobado` por año), `supuestos_proyeccion`, `factores_volumen_atipico`, `proyeccion_unidades`, `proyeccion_filas`, MV `venta_mensual_flujo` y `venta_mensual_equivalencia`, funciones `serie_flujo`, `serie_barrido`, `refrescar_venta_mensual_flujo`; migración `0014`; nota de que `proyeccion_filas` no lleva `id` ni `activo` (misma excepción que `venta_stock_mensual`) y de que es la segunda MV bajo la excepción de M6 a "RLS sin políticas".
- **PLAN §5, fila M7**: estado "Especificación escrita el 2026-10-13 (`docs/modulos/07-proyeccion-anual.md`), pendiente de aprobación"; versión `0.10.0 · M7`; resumen: unidad GML/GMLE, filas `claveFlujo` × talla, escenarios con un aprobado por año, base automática (normalización del Niño por ratio editable, señal de quiebre, tiendas completas/parciales/nuevas/cerradas) y supuestos del planner (crecimiento por unidad o agrupación, totales fijados por agrupación o fila: resuelve "los 500 de ALFA salen de la participación histórica y se pueden fijar"), reparto con `curvaUnidad` y mayor resto; hito. Resolver en esa fila la pregunta "¿corrige el histórico o aplica factor al objetivo?": **histórico (a)**, con `factor_objetivo_invierno` como parámetro aparte; y la 14 de M6: **calculado y editable, fuera del escenario**.
- **PLAN §5, fila M8**: "consume `GET /api/proyeccion/aprobada?anio=` / `leerProyeccionAprobada` (filas con `m01..m12`, unidades con curva, factor y aportes por tienda); nunca recalcula; la distribución por tienda se deriva de `proyeccion_unidades.tiendas`".
- **PLAN §6**: M7 es el primer módulo donde el `analista-planeamiento` revisa fórmulas (pasos 1-6) y los casos sintéticos antes de construir.
- **PLAN §7**: pendientes de Javier para M7: respuestas a las preguntas de abajo; `venta_esperada_promedio` en las tiendas Planificadas; meses del Niño 2026 (afecta la ventana `ultimos_12` de 2027 si incluye 2026-03..05: con el periodo creado se normalizan solos).
- **Ficha 06**: en "Fuera de alcance → Ajuste de volumen" y en la pregunta 14 anotar "resuelto en 07: opción (a), ratio calculado y editable en `factores_volumen_atipico`". Contrato que M7 usa tal cual: `claseDeAnio`, `GET /api/periodos-atipicos/anios`, `comparacion_forma.ratio_volumen` de la corrida, `curvas_estacionalidad` vigentes (`p01..p12`).
- **Ficha 02b**: en "Lo que M7 y M8 consumen" (4) anotar que M7 guarda `nivel_proyectado` en `proyeccion_unidades` y emite `nivel_cambiado`; que `claveFlujo` tiene su equivalente SQL en la MV de M7 (verificados iguales); y que el "desglose por miembro" queda como `top_marcas` dentro de "otras" (no por miembro de conjunto).
- **Ficha 04**: en "Para qué sirve a M7" precisar las clases de tienda y que `venta_esperada_promedio` se compara con el promedio mensual en soles de las tiendas completas de la ventana; añadir a la pregunta 4 que M7 asume soles netos por mes.
- **Ficha 05**: en "Lo que ningún índice arregla" anotar que M7 resolvió con MV + función `jsonb` por tandas de nodos.
- **`nav.ts`**: item "Proyección anual" en Planificación (al construir).

## 15. Preguntas abiertas para Javier (valor por defecto si no responde)

1. **Ventana base.** ¿Últimos 12 meses publicados, último año calendario completo o promedio ponderado de los últimos tres? **Por defecto: últimos 12 meses** (recoge el volumen más reciente; cada año nuevo entra solo).
2. **Crecimiento.** ¿Parte de 0 y lo fijas tú por unidad, o parte de la tendencia calculada (último año ÷ anterior)? **Por defecto: 0 con la tendencia visible y un botón para copiarla.**
3. **El Niño en la base.** Confirmas normalizar el histórico dividiendo los meses atípicos por el ratio (opción a), con el ratio de M6 editable por agrupación. **Por defecto: sí, calculado y editable; el factor sobre 2027 queda en 1.** Si crees que 2027 será Niño, lo pones en `factor_objetivo_invierno`.
4. **Quiebres.** ¿Solo señal o imputar con la curva? ¿Umbral de cobertura de 0,25 meses? **Por defecto: señal, 0,25.**
5. **Tiendas nuevas.** La escala es `venta_esperada ÷ venta mensual promedio de las tiendas con año completo`, con la mezcla de la red. **Por defecto: así; sin venta esperada, escala 1 con aviso.** ¿Incluir las Planificadas automáticamente? **Por defecto: sí.**
6. **Los 500 de ALFA.** Salen de la participación histórica con el crecimiento de la unidad y se pueden fijar por agrupación ("RECONOCIDO = 1 000") o por fila ("ALFA = 500"); "otras" absorbe el resto. ¿Te sirve, o el comprador debe poder fijarlos (Fase 3)? **Por defecto: lo fija el planner; el comprador en M9.**
7. **Tallas.** Centrales y Extremas siguen su participación histórica dentro de cada marca; ¿quieres fijar la participación de Extremas por unidad (p. ej. 15 %)? **Por defecto: histórica, fijable solo por fila.**
8. **Año objetivo y horizonte.** Un año calendario completo por escenario. ¿Necesitas proyectar 2026 oct-dic (lo que queda del año en curso) además de 2027? **Por defecto: solo años completos; para lo que queda de 2026 se crea un escenario 2026 y M8 usa de él los meses futuros.**
9. **Quién aprueba.** Cualquier planner o admin, con nombre y fecha. ¿Solo tú? **Por defecto: cualquier planner.**
10. **Un aprobado por año.** Aprobar un escenario nuevo archiva el anterior automáticamente. **Por defecto: sí, con `confirm`.**
11. **Filas escasas.** Filas con menos de 12 unidades en la ventana se proyectan igual y se marcan. ¿Prefieres agruparlas en "otras" aunque la marca sea relevante? **Por defecto: se proyectan igual.**
12. **Marcas marcadas sin GML** (`pendientes` de 02b): hoy caen en "otras" con aviso `marca_pendiente_gml`. ¿Bloquear el cálculo hasta resolverlas? **Por defecto: avisar, no bloquear.**
13. **CSV.** ¿Formato de columnas igual al de tu Excel de planeamiento (una fila por fila de flujo con doce meses)? Si me pasas la cabecera, el CSV la copia. **Por defecto: el formato de la sección 6.**
14. **Nombre del menú.** "Proyección anual" o "Proyección de unidades". **Por defecto: "Proyección anual".**
