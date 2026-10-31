# 07e · Propuesta de la IA por línea: proyección natural y reparto de la meta del género × mundo

> Estado: **ficha lista; en construcción** (la `0030` está aplicada en Vector2 y la lógica pura de la tanda 1 está en `src/lib/ia/`). Especificada el 2026-10-30, ajustada el mismo día tras la revisión independiente (`arquitecto-revisor`, opus) y las decisiones de Javier (§9), y **ajustada el 2026-10-31 por el cambio de proveedor (decisión 74 de DECISIONES): el primer proveedor es OpenAI y Claude queda como adaptador futuro** (resumen, puntos a verificar y ajustes de código en §11); pendiente de la aprobación final de Javier. Idea de Javier: el crecimiento por género × mundo (GM) que aprueba en Curvas es una **meta**, y son demasiadas filas (≈ 1 606 GML × agrupación de marca con venta en 24 meses) para analizarlas a mano. Quiere que un motor de IA (primero OpenAI; decisión 74) haga la **primera propuesta** de cada fila, con su motivo, y que el planner la revise. Amplía M7 ([07](07-proyeccion-anual.md), [07b](07b-apertura-en-la-linea.md), [07c](07c-crecimientos-por-genero-mundo.md)) sobre el **método 5** de [06e](06e-cierre-del-anio-y-base-sin-nino.md) y la meta global y versionada de [06d](06d-curva-y-crecimiento-por-genero-mundo.md). De [12](12-analisis-marcas-barrer.md) reutiliza la métrica de error de un reparto (`eatPp`, en puntos) y la idea de un backtest que dice si un reparto merece confianza.
>
> - **Alcance en dos entregas (decisión 2 de Javier).**
>   - **Primera entrega, `0.15.0 · M7`:** solo la **distribución de la meta de 2027** (`distribucion_y1`): proyección natural de cada fila **pedida sin la meta**, reparto de la meta del GM, brecha, cuadre en la Matriz, evaluación (backtest) y administración.
>   - **Segunda entrega, `0.15.1 · M7`:** **sublíneas** (`sublineas`) y **cierre del año en curso por la IA** (`cierre_y`). Su diseño se conserva en §10, ya corregido (las participaciones son las de la FILA, no las del nodo). Se construye solo después del hito de `0.15.0`.
> - **Versión y migración.** Commits `M7:`. Versión vigente en `src/lib/version.ts`: `0.14.0 · M6` (método 5, `VERSION_METODO = 5`, base corregida del Niño `B'`, `correccionMaterial`, factores confirmados; construida el 2026-10-30, migración `0029` aplicada en Vector2). **Esta ficha está en construcción:** la `0030` se aplicó el 2026-10-31 y la tanda 1 de lógica pura está en `src/lib/ia/` (con los ajustes de §11.3 pendientes). La `0026` es de `0.13.1 · M8` y la `0028` de M9a. Esta ficha usa **`0030_propuesta_ia.sql`**; la segunda entrega, la siguiente libre. Las versiones se asignan al cerrar (DECISIONES 2026-10-13): si otra entrega cierra antes, esta toma la siguiente libre. `docs/PLAN.md` ya está alineado (2026-10-30): `0.13.1` es de M8, `0.14.0` de M6 (hecha), `0.15.0` y `0.15.1` de esta ficha, y M9a toma la siguiente libre al cerrar.
> - **Cifras reales.** Las midió el revisor el 2026-10-30 en Vector2 (solo `SELECT`), sobre la única proyección en trabajo, que todavía es de **método 3** (calculada el 16/10, datos hasta 2026-09, sin decisiones ni cierre). Son: 1 606 filas base con venta en 24 meses; 509 con ≥ 100 u en 12 meses (97,1 % del volumen); 690 por el criterio real (propuesta de 2027 ≥ 100 o `revision_cola_larga`; 290 de ellas por revisión); con el método 5 se esperan **600 a 700 filas libres**. Cola larga: ≈ 1 097 filas con el 2,9 % del volumen. 36 GM con venta y 29 con alguna fila libre. Los dos GM más grandes, MUJER · URBANO (96 filas libres por venta, 120 en la proyección) y HOMBRE · URBANO (51, 62), suman el 44 % de las unidades: **el modo jerárquico es el camino principal, no un caso borde**. Hay 0 nodos GMLE. Datos publicados: 45 meses (2023-01 a 2026-09). **La tanda 1 vuelve a medir con la proyección de método 5** (§6.1) y rehace el costo de §3.9.
> - **Vector-One** no usa ningún proveedor de IA: no hay nada que citar.
> - Cifras de los ejemplos sintéticas. Ninguna tienda ni marca real aparece en esta ficha ni en los fixtures.

## 1. Objetivo

Javier aprueba en Curvas una meta de crecimiento para 2027 por GM (HOMBRE y MUJER por mundo, más el Resto), sobre 2026 corregido del Niño. Hoy el método estadístico la baja a las filas de forma pareja: todas las filas de un GM crecen el mismo %. Este módulo añade un motor de IA que, por GM, hace una **primera propuesta razonada** por fila:

1. la **proyección natural** de 2027 de cada fila, leyendo cómo se vendió en los últimos años, **sin conocer la meta**;
2. el **reparto de la meta** del GM entre sus filas libres, mostrando **cuánto fuerza cada fila** frente a su natural (la brecha).

Los meses salen siempre de las curvas aprobadas, y las sumas exactas las garantiza el código, no el modelo. La IA no decide nada: es **una fuente más de la cifra que el planner decide**, fila por fila, con el motivo escrito. Solo se enciende si gana en un backtest **al mejor de dos rivales**: el método actual y una regla de tendencia.

**La meta es solo de lo que ya existe** (decisión 4 de Javier): las filas con base en 2026. Las líneas o marcas nuevas de 2027 (sin venta) no entran en la meta ni en la IA; se trabajan aparte.

### 1.1 Decisiones de diseño (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Dónde vive.** Pestaña nueva **«Propuesta IA»** en la proyección (entre «Crecimientos» y «Por línea»), columnas IA en Por línea y un bloque IA en el detalle de la fila. La propuesta del método (`propuesto`) **no cambia**: la IA es una segunda cifra por fila (natural, con meta, brecha) con el botón **«Aceptar IA»**, y «Volver a la propuesta» sigue volviendo a la del método. **Las filas libres se deciden a mano para poder cerrar**: `motivoRechazoCerrar` (`reglas.ts:270-369`, regla 37 de 07) rechaza con `filas_sin_decidir` toda fila base sin decidir, en 2026 o en 2027, con `propuesto ≥ umbral` o `revision_cola_larga`; solo la cola larga se cierra sola con la propuesta. | El método es determinista y reproducible, y sustituirlo por la cifra de un modelo rompería eso y la regla R7 de 06e. Como el planner tiene que decidir cada fila libre de todos modos, la IA le ahorra el análisis, no la decisión. Descartado: reemplazar `propuesto`; una proyección aparte «escenario IA» (dos proyecciones en trabajo con la misma venta y dos respuestas). |
| D2 | **Aceptar IA = decisión con traza.** Se guarda como cualquier decisión manual (`origen = manual`) más `decision_ia_fila_id`, que apunta a la propuesta aceptada; un `check` exige `origen = 'manual'` cuando la columna no es nula. El cliente envía la cifra que vio (`valor_esperado`); si cambió, `409 ia_valor_cambio` con la nueva. **Una fila a la vez; sin aceptación en bloque.** | El `check` de `proyeccion_fila_anios.origen` (`0018`) no admite otro valor y no se puede ampliar sin `DROP`. Nada se aprueba en bloque (DECISIONES 2026-10-15; decisión 33). `valor_esperado` evita aceptar una cifra distinta de la que el planner leyó (otra fila del GM se fijó entre leer y aceptar). |
| D3 | **La meta del GM es la suma de lo que el método propondría si todas sus filas siguieran al GM:** `Meta_GM = Σ_f P^GM_f`, con `P^GM_f = propuesto_f` para las filas sin % propio y `round(B^s_f × (1 + g/100))` solo para las que tienen % propio (§5.1). `metaDeGM` vive en `src/lib/proyeccion/meta-gm.ts` (puro); la IA y la Matriz la importan. | Con filas que siguen al GM, la IA reparte **exactamente** el total que el método da hoy con el % aprobado, sin diferencias de redondeo contra la Matriz: `base_normalizada` se guarda redondeada a centésimas (`decision.ts:339`), pero `propuesto` sale de `B'` sin redondear (`siguiente.ts:107`). Vivir en `proyeccion/` mantiene la regla de que M7 no importa nada de la IA. |
| D4 | **Filas fijas y libres.** Son **fijas**, y cuentan por su vigente, las filas decididas en 2027, las que tienen % propio y las de **cola larga** (propuesta bajo el umbral y sin `revision_cola_larga`). Las demás son **libres**. La IA reparte solo `Meta_libre = Meta_GM − Σ fijas`. | Lo que Javier fijó a mano no se toca. La cola larga se cierra sola con la propuesta y nadie la revisa: si la IA la moviera, la meta no cuadraría al cerrar. Son ≈ 1 097 filas con el 2,9 % del volumen, y casi triplicarían el costo. Hay un parámetro `incluir_cola_larga` (apagado por defecto). |
| D5 | **Tiendas nuevas y cierres quedan fuera de la meta y de la IA.** La meta es de las mismas tiendas de 2027, `M(2027)` (abiertas a más tardar el 1 de enero de 2026; `bloques.ts`). Las tiendas abiertas en 2025 (`N(2026)`) pasan a `M(2027)` y su 2026 ya está dentro de `B` (B2): la meta las incluye. **Ninguna tienda abierta durante 2026 está en `M(2027)`**: es `N(2027)` y, con las aperturas de 2027 y los cierres, sigue con su método (07d) y se muestra solo como contexto. | El % aprobado es sobre mismas tiendas. Mezclar la venta esperada de una apertura en el reparto cambiaría el significado de la meta. |
| D6 | **Resto.** Cada GM del Resto recibe su meta con el % del Resto (`Σ P^GM` de sus filas). La IA reparte dentro de cada GM, **no entre GM del Resto**. | Javier decidió un % único para el Resto. Mover esfuerzo entre GM del Resto sería decidir algo que nadie aprobó. |
| D7 | **La exactitud la pone el código, siempre al leer; las demás filas libres absorben** (decisión 1 de Javier). El modelo devuelve su cifra «con meta» por fila, y el código la usa como **peso** para repartir `Meta_libre` por mayor resto (`asignarMeta`). Se recalcula en cada lectura con la meta y las fijas **de hoy**: si el planner fija una fila o decide un 2026 que mueve la meta, las demás libres absorben la diferencia y el GM sigue sumando su meta. **Cada fila muestra cuánto absorbió desde que la IA propuso, con aviso si pasa del 10 % de su cifra** (§5.1). La salida del modelo se guarda tal cual y nunca se reescribe. | Un modelo no suma con exactitud ni conoce las decisiones que vienen después. Guardar cifras ya normalizadas obligaría a reescribirlas en cada decisión. Mostrar lo absorbido evita que una cifra «de la IA» esconda un ajuste que la IA no propuso. |
| D8 | **Los meses nunca salen de la IA.** Una cifra IA aceptada se reparte como cualquier decisión (`curvaFila × φ`). | Decisión de Javier y DECISIONES 2026-10-15: una sola fuente de estacionalidad. |
| D9 | **El natural se pide sin la meta.** Por GM hay primero una llamada `natural` (sin `meta`, sin la propuesta del método, sin `g`) y después una de `reparto` que recibe la meta y los naturales ya devueltos. La parte común de las dos (historia de las filas) es el mismo bloque y va en el mismo orden (texto fijo → bloque → sufijo): si el proveedor tiene caché por prefijo la aprovecha, pero el diseño no depende de ella (§3.8). | Si el modelo ve la meta al estimar el natural, lo ancla hacia ella y la brecha se ve más chica de lo que es (revisión, bloqueante B3). La propuesta del método es `B^s × (1 + g)`: enviarla en la llamada natural sería mandar la meta encubierta. |
| D10 | **Granularidad: una llamada por petición, conducida por el navegador.** Cada `POST` de un paso hace **una sola** llamada al proveedor y responde. El plan de un GM es `natural` → `reparto` en **modo directo** (≤ 60 filas enviadas, `max_filas_llamada`) o `natural` por lotes → `lineas` → `reparto` por lotes en **modo jerárquico**. Un candado por GM (`ia_corrida_gms`) impide que dos peticiones hagan el mismo paso, y una función transaccional (`registrar_propuesta_ia_gm`) graba la propuesta entera o nada. | Procesar un GM entero por petición podía pasar de 10 minutos (jerárquico con reintentos), duplicar el gasto si el navegador reintentaba mientras el servidor seguía, y dejar una propuesta a medias (I6). Un trabajo en segundo plano en Railway se pierde en un reinicio y no hay cola. |
| D11 | **Encendido tras un backtest que gana al mejor rival.** La capacidad `distribucion_y1` se enciende **solo** si una evaluación con el **mismo proveedor, el mismo modelo y la misma versión de prompt** la dio por ganadora frente al **mejor** del método y de la regla de tendencia, en el reparto y en el natural (§5.4; decisión 5 de Javier). Sin evaluación ganadora, la IA no muestra cifras. | Lo pidió Javier: backtest obligatorio. Si una regla determinista empata con la IA, no hay razón para pagar un modelo. Atar el encendido a proveedor + modelo + prompt impide que un cambio entre sin volver a medirse: **cambiar de proveedor (p. ej. de OpenAI a Claude) o de modelo exige un backtest nuevo** (decisión 74). |
| D12 | **Qué sale al proveedor.** Solo: unidades agregadas por fila, por año relativo (`A−3` … `A`) y mes, de las mismas tiendas de cada año; los nombres del árbol (género, mundo, línea, equivalencia) y de la agrupación de marca, **con los nombres de marca y de tienda reemplazados por alias**; e indicadores **derivados** por el código (variación comparable, disponibilidad, meses con quiebre, factor del Niño, base, aportes de tiendas, meta). **Nunca**: años reales, tiendas (ni nombres, ni códigos, ni cuántas son), soles, costos, stock en unidades o valorizado, marcas, usuarios, el nombre de la empresa ni ids internos. | Es el perímetro que fijó Javier. El revisor midió 196 equivalencias activas cuyo nombre contiene el de una marca (90 idénticas). Javier eligió alias (decisión 3): el proveedor no ve el nombre y el usuario siempre ve el real. Los años relativos quitan al modelo la posibilidad de «recordar» lo que pasó en un año concreto (fuga en el backtest). |
| D13 | **Traza completa y verificable.** Cada llamada guarda (directamente o por su corrida) el proveedor, el modelo, la versión de prompt, la **huella sha-256** de lo enviado, tamaño, tokens, costo, duración y quién la pidió. **La entrada canónica enviada se guarda comprimida en `ia_entradas`, inmutable** (decisión 6 de Javier), con el diccionario de ids cortos y alias. La salida validada se guarda por fila. **Nada de lo enviado ni lo recibido va a los logs.** | Sin la entrada guardada, la huella no se puede verificar: la entrada incluye decisiones que se sobrescriben y meses que se reemplazan (I9). Guardar no amplía lo que sale al proveedor: es la misma información, en la base propia. |
| D14 | **Proveedor y modelo** (decisión 74, 2026-10-31). **El primer proveedor es OpenAI; Claude queda como adaptador futuro.** El código habla con la interfaz `ProveedorIA` (`proveedor.ts`, sin SDK); cada proveedor es un adaptador aparte: `proveedor-openai.ts` en `0.15.0`, `proveedor-anthropic.ts` cuando haya API de Claude. Qué adaptador usa el servidor lo dice `IA_PROVEEDOR` y qué modelos puede usar, `IA_MODELO` (§3.10): **ningún id de modelo ni precio está cableado en el código**. La configuración vigente (admin) guarda `proveedor` y `modelo` y solo enciende una capacidad con una evaluación ganadora del mismo proveedor, modelo y prompt (D11). Candidatos: dos o tres modelos de OpenAI de distinto costo, que elige Javier con `backend` según la documentación y los precios vigentes; se queda **el más barato que gane**. La clave va solo en `OPENAI_API_KEY`, variable secreta en Railway. | TIC no entrega API de Claude y Javier tiene una de OpenAI. La interfaz ya era independiente del SDK y el esquema `0030` es neutral (`proveedor` y `modelo` en texto libre, tokens con nombres neutros): cambiar de proveedor es escribir otro adaptador y volver a evaluar, sin migración. Fijar el modelo en el código obligaría a desplegar para cambiarlo; fijarlo sin medir sería una opinión. |
| D15 | **Un fallo del proveedor no rompe M7.** Todo lo de IA va por rutas y tablas propias. Si el proveedor falla, si falta la clave o si la IA está apagada, M7 funciona idéntico, y Por línea pide las columnas IA aparte. | M7 es el insumo de M8. Un servicio externo no puede bloquear el cierre. |
| D16 | **M8 no cambia.** `GET /api/proyeccion/cerrada` no cambia (ni meses ni campos). | Contrato de M8 (07 §7). |
| D17 | **El código calcula y el modelo juzga.** `B`, `B'`, aportes de tiendas, la meta, las fijas, las variaciones comparables y las señales los calcula el código y se le dan al modelo como hechos. El modelo solo estima (natural, peso) y explica. | Un modelo no debe hacer aritmética de la que dependa una cifra. Cada número enviado se prueba con vitest. |
| D18 | **La meta es solo de lo existente** (decisión 4 de Javier). Entran las filas base de 2027 con `B` no nulo. Una línea o marca nueva de 2027 sin venta no tiene fila en M7 y no entra; una fila con venta reciente (`linea_nueva`) sí entra, con su señal. | El % aprobado se escribe sobre la base de 2026 corregida; lo que no tiene base no puede crecer sobre ella. |
| D19 | **El cuadre de la Matriz es la garantía de la meta.** Como cada fila se decide a mano, una por una, y las decisiones de 2026 mueven la meta después de fijar filas de 2027, nada obliga a que lo decidido sume la meta. La Matriz lo muestra por GM («Desvío frente a la meta») y la pestaña IA lo dice. **Cerrar no lo exige.** | Exigirlo al cerrar sería una regla nueva sobre M7 que Javier no pidió. Mostrarlo en el mismo lugar donde se revisa el total es suficiente para esta entrega. |

### 1.2 Flujo

```
Curvas (06d/06e): meta 2027 por GM y Resto (pct, sobre_base, versión) ──────────────┐
Proyección en trabajo, método 5: B, B', propuesto, decidido, historico, curva, φ ────┼─► armarBloqueGM (puro, lista blanca, años relativos)
venta_lineas_ia(gml[], claves, desde, hasta): unidades por fila × clave × mes ───────┘          │ alias de marcas/tiendas + control de salida
                                                                                                ▼
                                       ia_entradas (inmutable) ◄── bloque canónico ── huella_gm ── ¿propuesta vigente con esa huella (proveedor, modelo y prompt incluidos)? ── sí ─► reusa
                                                                                                │ no
  navegador: POST …/paso (una llamada por petición; candado del GM en ia_corrida_gms)           ▼
      natural (sin meta) ─► [modo jerárquico: lineas (con meta) ─► sub-metas] ─► reparto (con meta y naturales)
                                                                                                │ validar (zod + §5.2) · restituir alias en las razones
                                                                                                ▼
                                       registrar_propuesta_ia_gm (transaccional) ─► ia_propuestas_gm · ia_propuestas_filas
                                                                                                │
Propuesta IA / Por línea / detalle ◄── asignarMeta(Meta_libre de hoy, pesos) + absorción + estado ◄┘
        │  «Aceptar IA» (una fila, 2027, valor_esperado)
        ▼
decidirFila(…, { decision_ia_fila_id }) ─► decidido (origen manual) ─► curvaFila × φ ─► Matriz (cuadre) ─► cerrar ─► M8 (sin cambios)
```

## 2. Modelo de datos (`0030_propuesta_ia.sql`)

Convenciones (las de `0018`, `0025` y `0029`):
- Idempotente: `create table if not exists`, `add column if not exists`, `create index if not exists`, `create or replace function`, `create or replace trigger`.
- **Sin `DROP`, `UPDATE`, `DELETE`, `TRUNCATE`, backfill, seed ni bloques `do $$`.**
- RLS activo sin políticas; `revoke all … from public, anon, authenticated` y `grant … to service_role` sobre cada tabla y función; `comment on` en cada objeto.
- Funciones `security invoker`, `set search_path = ''`, sin comentarios `--` dentro de `$$`.
- **Catálogos sin `check`** (estados, capacidades, tipos de llamada, banderas): los valida zod, para poder ampliarlos en `0.15.1` sin quitar una restricción (criterio de `0025` y `0027`). Solo `check` estructurales: rangos, longitudes, `jsonb_typeof`.
- Identificadores de ≤ 63 caracteres.
- Se aplica en la tanda 1 mientras sigue desplegada `0.13.x`/`0.14.x`, y todo lo que añade es inocuo para ese código: tablas nuevas, una columna nula con su `check` y funciones nuevas.

**Tablas inmutables.** `ia_entradas`, `ia_llamadas`, `ia_propuestas_gm` e `ia_propuestas_filas` son de solo inserción, como `compra_eventos` (M8, decisión 60). Por eso **no llevan `activo` ni `updated_at`**: es una excepción a la convención, documentada igual que `venta_stock_mensual` y `compra_eventos`. Un trigger `before update or delete` por fila rechaza todo cambio, también para `service_role`; la única excepción es el `UPDATE` que **solo** pone en `NULL` una FK `on delete set null`, con el patrón `to_jsonb(new) − col = to_jsonb(old) − col` de `tg_compra_eventos_inmutable`. Además, un trigger **`before truncate` por sentencia** rechaza `TRUNCATE` (un trigger por fila no lo cubre; rev. M10). El dueño de la base puede desactivar triggers: eso queda fuera del alcance de la aplicación y se documenta en el `comment on`.

**Nada es contador.** Costo, tokens y avance de corridas y evaluaciones **se derivan** de `ia_llamadas` y de `ia_corrida_gms` con `sum`/`count` al leer (I6): no hay columnas que se lean, modifiquen y escriban.

### 2.1 `ia_configuraciones` (versionada; la vigente gobierna la IA)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `version` | `integer not null check (version >= 1)` | `max + 1`. **Único** (`ia_configuraciones_version_key`): dos guardados simultáneos no pueden quedar con el mismo número; el segundo falla y la API responde `409 vigente_cambiada` |
| `estado` | `text not null default 'vigente'` | `vigente` / `reemplazada` (zod). **Único parcial** `((true)) where estado = 'vigente'` |
| `proveedor` | `text not null check (char_length(proveedor) between 1 and 40)` | Id corto del adaptador (`openai` en `0.15.0`). **Obligatorio al insertar** (sin default): lo pone el servidor con `IA_PROVEEDOR`, no el cliente. Sin `check` de catálogo: lo valida zod contra los adaptadores registrados |
| `modelo` | `text not null check (char_length(modelo) between 1 and 100)` | Id del modelo en el proveedor, texto libre (D14). Debe estar en `IA_MODELO` (§3.10) |
| `version_prompt` | `text not null check (char_length(version_prompt) between 1 and 20)` | `v1`, `v2`…; la API exige que exista en el código (`PROMPTS`) |
| `capacidades` | `text[] not null default '{}'` | En `0.15.0`, subconjunto de `distribucion_y1` (zod). Vacío = IA apagada sin quitar la clave |
| `evaluacion_id` | `uuid null → ia_evaluaciones on delete restrict` | La evaluación que justifica las capacidades (R23). Índice |
| `tope_usd_corrida` | `numeric(8,2) not null default 10 check (tope_usd_corrida > 0 and tope_usd_corrida <= 500)` | |
| `tope_usd_mes` | `numeric(8,2) not null default 60 check (tope_usd_mes > 0 and tope_usd_mes <= 5000)` | Mes calendario de Lima, corridas y evaluaciones juntas. Es un tope **blando** de la app; el duro es el límite de gasto del proyecto en la cuenta del proveedor, si corta las peticiones (§5.5.9, §6.2) |
| `tope_usd_dia_usuario` | `numeric(8,2) not null default 15 check (tope_usd_dia_usuario > 0 and tope_usd_dia_usuario <= 500)` | Gasto por usuario y día de Lima. **Sustituye a `max_corridas_dia`** (rev. M7): contar corridas penalizaba «Regenerar un GM», que cuesta centavos |
| `max_filas_llamada` | `integer not null default 60 check (max_filas_llamada between 10 and 150)` | Por encima, modo jerárquico (§3.8) |
| `incluir_cola_larga` | `boolean not null default false` | D4 |
| `presupuesto_razonamiento` | `integer not null default 0 check (presupuesto_razonamiento between 0 and 32000)` | Razonamiento del modelo; 0 = sin. Neutral: el adaptador lo traduce al parámetro que tenga el modelo, o rechaza la configuración si no lo admite (lo verifica `backend`, §11.2). Con razonamiento no se fija la temperatura (rev. M8) |
| `precios` | `jsonb not null check (jsonb_typeof(precios) = 'object')` | USD por millón de tokens, con claves **neutras**: `{ entrada, entrada_cache, salida }`. `entrada_cache` es la tarifa de la entrada servida desde la caché del proveedor (si no hay caché, igual a `entrada`). Los escribe el admin desde la página de precios vigente del proveedor; **ningún precio está en el código**. Sin `cache_escritura` ni `cache_lectura`: no hay caché explícita (§3.8) |
| `terminos_extra` | `text[] not null default '{}' check (cardinality(terminos_extra) <= 50)` | Términos que **nunca** salen al proveedor además de marcas y tiendas (el nombre de la empresa, una sigla interna). Los escribe el admin; cada uno de 2 a 60 caracteres (zod). Sin datos reales en el repo |
| `nota` | `text null check (nota is null or char_length(nota) <= 300)` | |
| `perfil_id` (`→ perfiles on delete set null`, índice), `usuario_nombre`, `aprobada_at timestamptz not null default now()` | | |
| `activo`, `created_at`, `updated_at` | | convención; `tg_set_updated_at` |

Sin fila vigente, la IA está apagada (estado inicial; no hay seed). Una versión nueva pasa la anterior a `reemplazada` con `UPDATE … where estado = 'vigente' and id = ?` (patrón 06d) y, si el `insert` falla, la restaura.

### 2.2 `ia_evaluaciones` (backtests; §5.4)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `proveedor`, `modelo`, `version_prompt` | `text not null` (mismos `check` que 2.1; `proveedor` obligatorio al insertar) | lo evaluado: el backtest vale solo para esta terna (D11) |
| `parametros` | `jsonb not null check (jsonb_typeof(parametros) = 'object')` | foto: pliegues, umbrales de §5.4 **incluido el `MEJORA_MIN` aplicado y el número de intento**, `max_filas_llamada`, `presupuesto_razonamiento`, `precios`, semilla del bootstrap y semilla enviada al proveedor si la admite |
| `estado` | `text not null default 'en_curso'` | `en_curso` / `completa` / `fallida` / `cancelada` (zod). **Único parcial** `((true)) where estado = 'en_curso'` |
| `resultados` | `jsonb null check (resultados is null or jsonb_typeof(resultados) = 'object')` | métricas por pliegue (`ResultadosEvaluacionApi`) |
| `veredicto` | `jsonb null check (veredicto is null or jsonb_typeof(veredicto) = 'object')` | `{ distribucion_y1: "gana" \| "no_gana" \| "sin_dato", regla_que_fallo: string \| null }` |
| `tope_usd` | `numeric(8,2) not null default 50 check (tope_usd > 0 and tope_usd <= 500)` | |
| `perfil_id`, `usuario_nombre`, `iniciada_at timestamptz not null default now()`, `terminada_at timestamptz null` | | |
| `activo`, `created_at`, `updated_at` | | convención |

Cada evaluación tiene una corrida de tipo `evaluacion` (2.3) que lleva sus pasos y llamadas. Ninguna evaluación se borra: **todos los intentos quedan registrados**, también los cancelados y fallidos (I4). En un estado terminal, `tg_ia_terminal` rechaza todo cambio **y todo `DELETE`** salvo `perfil_id → NULL`.

### 2.3 `ia_corridas` (una por pedido de propuesta o por evaluación)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `tipo` | `text not null` | `propuesta` / `evaluacion` (zod) |
| `proyeccion_id` | `uuid null → proyecciones on delete set null` | nulo en evaluación; índice |
| `evaluacion_id` | `uuid null → ia_evaluaciones on delete restrict` | índice |
| `configuracion_id` | `uuid null → ia_configuraciones on delete restrict` | la vigente al iniciar (nulo en evaluación); índice |
| `proveedor`, `modelo`, `version_prompt` | `text not null` (mismos `check`; `proveedor` obligatorio al insertar) | copiados de la configuración vigente o de la evaluación. `registrar_propuesta_ia_gm` los toma de aquí, no del payload |
| `anio_en_curso`, `k` | `integer null` | foto de la proyección |
| `calculado_at_proyeccion` | `timestamptz null` | si `proyecciones.calculado_at` cambia a mitad, `409 datos_cambiaron` |
| `alcance` | `jsonb not null check (jsonb_typeof(alcance) = 'object')` | GM pedidos, `regenerar` y la semilla enviada al proveedor si la admite (§3.8) |
| `estado` | `text not null default 'en_curso'` | `en_curso` / `completa` / `parcial` / `detenida` / `cancelada` / `abandonada` (zod). **Único parcial** `(proyeccion_id) where estado = 'en_curso' and proyeccion_id is not null` |
| `motivo_fin` | `text null check (motivo_fin is null or char_length(motivo_fin) <= 120)` | `tope_corrida`, `tope_mensual`, `tope_dia`, `proveedor_inestable`, `limite_proveedor`, `datos_cambiaron`, `clave_invalida` |
| `costo_estimado_usd` | `numeric(10,4) not null check (costo_estimado_usd >= 0)` | lo que confirmó quien la pidió |
| `perfil_id`, `usuario_nombre` | | quién |
| `iniciada_at timestamptz not null default now()`, `ultima_actividad_at timestamptz not null default now()`, `terminada_at timestamptz null` | | caduca a los `CORRIDA_CADUCA_MIN = 30` min sin actividad |
| `activo`, `created_at`, `updated_at` | | convención |

Mutable mientras está `en_curso` (solo `estado`, `motivo_fin`, `ultima_actividad_at`, `terminada_at`); en un estado terminal aplica `tg_ia_terminal`, que rechaza cambios y `DELETE` salvo `perfil_id` y `proyeccion_id → NULL`.

### 2.4 `ia_corrida_gms` (un GM de una corrida: plan, candado y resultados parciales)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `corrida_id` | `uuid not null → ia_corridas on delete restrict` | |
| `pliegue` | `text not null default '' check (char_length(pliegue) <= 40)` | `''` en una propuesta; `D25`, `E25`, `D24`… en evaluación |
| `gm_clave` | `text not null check (char_length(gm_clave) <= 80)` | `<genero_id>.<mundo_id>` |
| — | **único** `(corrida_id, pliegue, gm_clave)` | |
| `estado` | `text not null default 'pendiente'` | `pendiente` / `en_proceso` / `hecho` / `reusado` / `fallido` / `sin_filas_libres` / `bloqueado_privacidad` (zod) |
| `modo` | `text null` | `directo` / `jerarquico` (al armar) |
| `plan` | `jsonb null check (plan is null or jsonb_typeof(plan) = 'array')` | los pasos: `[{ id: "n1", tipo: "natural", lote: 1 }, …, { id: "r1", tipo: "reparto", lote: 1 }]` |
| `parcial` | `jsonb not null default '{}' check (jsonb_typeof(parcial) = 'object')` | salidas **ya validadas** por paso (`{ "n1": {…} }`): cifras, razones restituidas y banderas. Nunca la entrada. El avance es `#claves ÷ #plan` |
| `bloque_ids` | `uuid[] not null default '{}'` | las `ia_entradas` del GM (un bloque por lote) |
| `huella_gm` | `text null check (huella_gm is null or char_length(huella_gm) = 64)` | §5.3, para el reuso |
| `candado_token` | `uuid null` | quién tiene el paso en curso |
| `candado_desde` | `timestamptz null` | el candado vence a los `CANDADO_GM_SEG = 300` s |
| `propuesta_gm_id` | `uuid null → ia_propuestas_gm on delete restrict` | lo pone `registrar_propuesta_ia_gm`. FK circular con 2.7: la columna se añade con `add column if not exists` después de crear `ia_propuestas_gm` |
| `referencia` | `jsonb null check (referencia is null or jsonb_typeof(referencia) = 'object')` | solo evaluación: por id corto de fila, la predicción del método, la de tendencia y el real del año predicho. **No se envía nunca** |
| `error_codigo` | `text null check (error_codigo is null or char_length(error_codigo) <= 60)` | |
| `created_at`, `updated_at` | | `tg_set_updated_at` |

**Candado** (I6). Tomar un paso es un único `UPDATE … set estado = 'en_proceso', candado_token = :t, candado_desde = now() where id = :id and estado in ('pendiente', 'en_proceso') and (candado_token is null or candado_desde < now() − 300 s) returning …`. Sin fila devuelta → `409 gm_en_proceso`: si el navegador reintenta mientras el servidor sigue con la llamada, no hay doble gasto. Al terminar el paso, el servidor guarda `parcial` y suelta el candado **solo si el token coincide**. `tg_ia_terminal` rechaza cambios y `DELETE` sobre filas en `hecho` o `reusado`, sin excepciones. No lleva `activo`: su vida es la de la corrida.

### 2.5 `ia_entradas` (lo enviado, canónico y comprimido; inmutable)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `corrida_id` | `uuid not null → ia_corridas on delete restrict` | índice |
| `tipo` | `text not null` | `bloque` (historia de un lote, común a `natural` y `reparto`) / `sufijo_reparto` / `lineas` (zod) |
| `huella` | `text not null check (char_length(huella) = 64)` | sha-256 de `canonico(contenido)`. **Único** `(corrida_id, huella)`: un reintento reusa la fila |
| `contenido_gz` | `bytea not null check (octet_length(contenido_gz) <= 2000000)` | gzip del JSON canónico **tal como se envió** (con alias, años relativos e ids cortos) |
| `bytes` | `integer not null check (bytes >= 0)` | tamaño sin comprimir |
| `diccionario` | `jsonb not null check (jsonb_typeof(diccionario) = 'object')` | `{ f: { "f001": "<fila_clave>" }, l: { "l01": "<linea_id>" }, e: {…}, alias: { "MARCA_A": { tipo: "marca", id: "<uuid>" } } }`: ids, no nombres |
| `created_at` | `timestamptz not null default now()` | |

Se escribe **antes** de llamar, así una llamada que se corta por tiempo también deja su entrada. Tamaño esperado: 50 a 150 KB sin comprimir por GM; 1 a 2 MB por corrida, mucho menos comprimido. Leerla es solo para el admin (§3.2). Con ella, la huella de cualquier llamada se verifica y la llamada se puede reproducir (I9).

### 2.6 `ia_llamadas` (un intento contra el proveedor; inmutable)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `corrida_id` | `uuid not null → ia_corridas on delete restrict` | índice `(corrida_id, created_at)` |
| `corrida_gm_id` | `uuid not null → ia_corrida_gms on delete restrict` | índice |
| `paso` | `text not null check (char_length(paso) <= 10)` | `n1`, `l`, `r2`… |
| `tipo_llamada` | `text not null` | `natural` / `lineas` / `reparto` (zod) |
| `intento` | `integer not null check (intento >= 1)` | |
| `entrada_bloque_id` | `uuid null → ia_entradas on delete restrict` | |
| `entrada_sufijo_id` | `uuid null → ia_entradas on delete restrict` | |
| `huella_llamada` | `text not null check (char_length(huella_llamada) = 64)` | sha-256 de `canonico({ proveedor, version_prompt, modelo, bloque, sufijo })` (§5.3) |
| `estado` | `text not null` | `ok` / `invalida` / `error_proveedor` / `limite_proveedor` (429) / `tiempo_agotado` / `truncada` / `rechazada` / `clave_invalida` (zod) |
| `modelo_respuesta` | `text null check (… <= 100)` | |
| `id_solicitud` | `text null check (… <= 120)` | id de la petición del proveedor (soporte); nunca cabeceras |
| `bytes_entrada`, `filas_enviadas` | `integer not null check (>= 0)` | |
| `tokens_entrada`, `tokens_entrada_cache`, `tokens_salida` | `integer not null default 0 check (>= 0)` | lo que reporta el proveedor, traducido por el adaptador a nombres neutros. **Disjuntos:** `tokens_entrada` es la entrada cobrada a `precios.entrada`; `tokens_entrada_cache`, la servida desde caché y cobrada a `precios.entrada_cache` (si el proveedor la reporta dentro del total de entrada, el adaptador la resta). Los tokens de razonamiento, si se cobran como salida, van en `tokens_salida`. Cómo lo reporta OpenAI lo verifica `backend` (§11.2) |
| `costo_usd` | `numeric(10,4) not null default 0 check (costo_usd >= 0)` | con los `precios` de la configuración o de la evaluación |
| `duracion_ms` | `integer not null check (duracion_ms >= 0)` | |
| `esperar_ms` | `integer null check (esperar_ms is null or esperar_ms >= 0)` | lo que pidió el proveedor en un `429` o en una sobrecarga |
| `error_codigo` | `text null check (… <= 60)` | `429`, `500`, `503`, `sobrecarga`, `tiempo`, `zod`, `limite_salida`, `faltan_filas`… |
| `error_detalle` | `text null check (… <= 300)` | saneado: nunca la clave, cabeceras ni datos |
| `perfil_id` | `uuid null → perfiles on delete set null` | índice `(perfil_id, created_at)` para el tope por usuario y día; otro `(created_at)` para el tope mensual |
| `created_at` | `timestamptz not null default now()` | |

`ia_llamadas` no repite `proveedor` ni `modelo`: los da su corrida. `modelo_respuesta` guarda el modelo que el proveedor dice haber usado (sirve para detectar un alias que cambió por debajo; R34).

### 2.7 `ia_propuestas_gm` (una por GM terminado; inmutable)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `corrida_id`, `corrida_gm_id` | `uuid not null`, `restrict` | índices |
| `proyeccion_id` | `uuid null → proyecciones on delete set null` | índice `(proyeccion_id, gm_clave, created_at desc)`: **la vigente de un GM es la más reciente** |
| `pliegue` | `text not null default ''` | |
| `gm_clave`, `genero_id` (`→ generos restrict`), `mundo_id` (`→ mundos restrict`), `es_resto boolean not null` | | índices |
| `capacidades` | `text[] not null` | |
| `modo` | `text not null` | `directo` / `jerarquico` |
| `version_metodo` | `integer not null` | `resumen.version_metodo` de la proyección al generar |
| `meta` | `jsonb null check (meta is null or jsonb_typeof(meta) = 'object')` | `MetaGMApi` al generar: `pct`, `sobre_base`, `fuente`, `crecimiento_id`, `version`, `meta_gm`, `fijas` (con su desglose), `meta_libre` |
| `huella_gm`, `huella_historia` | `text not null check (char_length = 64)` | §5.3 |
| `razon_gm` | `text null check (razon_gm is null or char_length(razon_gm) <= 600)` | |
| `banderas_gm`, `avisos` | `text[] not null default '{}'` | |
| `filas_pedidas`, `filas_validas` | `integer not null check (>= 0)` | |
| `desvio_suma_modelo` | `numeric(8,4) null` | `Σ m̂ ÷ Meta_libre − 1` (§5.2) |
| `proveedor`, `modelo`, `version_prompt` | `text not null` (mismos `check`) | los copia `registrar_propuesta_ia_gm` **de la corrida**, no del payload (§2.11) |
| `perfil_id`, `usuario_nombre`, `created_at` | | |

### 2.8 `ia_propuestas_filas` (una por fila base del GM al generar, libre o fija; inmutable)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `propuesta_gm_id` | `uuid not null → ia_propuestas_gm restrict` | lo cubre el único de abajo |
| `fila_id` | `uuid null → proyeccion_filas on delete set null` | índice; nulo en evaluación |
| `fila_clave` | `text not null check (char_length(fila_clave) <= 300)` | sobrevive al `set null` |
| — | **único** `(propuesta_gm_id, fila_clave)` (`ia_propuestas_filas_propuesta_fila_key`; también cubre la FK) | una fila base aparece una sola vez por propuesta: un duplicado en el payload hace fallar `registrar_propuesta_ia_gm` entera |
| `estado_meta` | `text not null` | `libre` / `fija_decidida` / `fija_pct` (zod). La cola larga no se guarda por fila: va resumida en `meta` |
| `base_al_generar`, `base_corregida_al_generar` | `numeric(14,2) null` | `B` y `B'` (para `base_movida`) |
| `p_gm_al_generar` | `integer null check (>= 0)` | `P^GM_f` |
| `aporte_fijo_al_generar` | `integer null check (>= 0)` | solo fijas: su vigente de 2027 |
| `natural_y1` | `integer null check (natural_y1 >= 0)` | de la llamada `natural` |
| `razon_natural` | `text null check (razon_natural is null or char_length(razon_natural) <= 200)` | |
| `meta_y1_modelo` | `integer null check (meta_y1_modelo >= 0)` | el **peso** de `asignarMeta` (D7), ya escalado a la sub-meta en modo jerárquico |
| `meta_y1_al_generar` | `integer null check (meta_y1_al_generar >= 0)` | `asignarMeta` con la meta y las fijas de ese momento: **la referencia de la absorción** (§5.1) |
| `razon` | `text null check (razon is null or char_length(razon) <= 300)` | de la llamada `reparto`, saneada, ≤ 280 |
| `banderas`, `senales`, `avisos` | `text[] not null default '{}'` | |
| `confianza` | `text null` | `alta` / `media` / `baja` |
| `created_at` | `timestamptz not null default now()` | |

Las fijas se guardan (sin cifras IA) para que la absorción y el cambio de la meta se expliquen desde lo guardado.

### 2.9 Una columna en `proyeccion_fila_anios`

| Columna | Tipo | Para qué |
|---|---|---|
| `decision_ia_fila_id` | `uuid null → ia_propuestas_filas(id) on delete restrict`, `check (decision_ia_fila_id is null or coalesce(origen = 'manual', false))`, índice | No nulo = el `decidido` vigente salió de «Aceptar IA» (D2). Lo pone solo el servicio de aceptar; **cualquier otra decisión sobre el registro lo vuelve `null`** (cifra manual, «Aceptar» del método, «Volver a la propuesta»). `calcular` no lo toca (el `upsert` del cálculo no escribe columnas de decisión, `persistencia.ts:148`) y `copiar_de` lo copia: la traza apunta a la propuesta original. |

El `check` va dentro del mismo `add column if not exists` (si la columna ya existe, la cláusula entera se omite: idempotente sin `do $$`); el humo comprueba que existe (rev. M5). **El `coalesce` cierra el hueco del nulo:** con `origen` nulo (registro sin decidir), `origen = 'manual'` da nulo y un `check` deja pasar el nulo, así que sin él un registro sin decidir podría llevar traza de IA. Consecuencia para `decidirFila`: «Volver a la propuesta» pone `decidido`, `origen` y `decision_ia_fila_id` en nulo **en el mismo `UPDATE`**; si limpiara `origen` antes que la columna, el `check` fallaría. `reparto_sublineas` es de `0.15.1` (§10).

### 2.10 Función `venta_lineas_ia(p_gml_ids uuid[], p_grupos jsonb, p_desde date, p_hasta date) returns jsonb`

La **única lectura de venta del módulo**. `language sql`, `stable`, `security invoker`, `search_path = ''`; `revoke execute … from public, anon, authenticated` y `grant … to service_role`. Lee `venta_stock_vigente`; solo tiendas de tipo Tienda (une `tiendas` con `tipo = 'Tienda'`, como `venta_proyeccion`); solo periodos entre `p_desde` y `p_hasta` (el corte de un pliegue se aplica en SQL). **Selecciona únicamente `unidades`**, nunca `venta_soles`, `costo_vendido`, `stock_unidades` ni `stock_valorizado`.

Devuelve **un agregado compacto en columnas con diccionario** (I10), por fila × clave de pertenencia × mes:

```jsonc
{ "dic": { "filas": [["<gml_id>", "<agrupacion_marca_id>", null /* equivalencia: solo en nodos GMLE */], …],
           "claves": ["11111", "00011", …], "desde": "2023-01-01" },
  "f": [0, 0, 1, …],        // índice en dic.filas
  "c": [0, 1, 0, …],        // índice en dic.claves
  "p": [0, 0, 0, …],        // meses desde dic.desde
  "u": [1410, 88, 702, …],  // unidades
  "cargas": { "2023-01": "<carga_id>", … } }
```

- `p_grupos` es `{ tienda_id: clave }` armado con las **claves de pertenencia guardadas por la proyección**: `parametros.bloques[Y].{mismas,nuevas,cierres,fuera}[].clave` (`servicio.ts:384-385`; rev. M1). En un pliegue, `clavesPertenencia(tiendas, Y_pliegue)`.
- La agrupación de marca es la de la unidad de marca (`marcas_unidad` → cabeza), como `venta_proyeccion`. Preagrega por `(equivalencia, tienda, periodo)` como la `0027`.
- Para el GM más grande se esperan unos miles de tuplas (antes ≈ 28 000 filas y 6,3 MB). Presupuesto: ≤ 1 s y ≤ 500 KB. **Medido el 2026-10-31** (bloque «MEDICIÓN 0030» de la migración; MUJER · URBANO, 24 meses, una sola clave): 3 268 tuplas y 66 KB; 0,5 s en caliente y 1,7 s en frío. Se acepta porque es una lectura por GM en el primer paso, no una por llamada; con las claves reales sube el número de tuplas y `backend` lo vuelve a medir en el ensayo en seco.
- Una tienda que no figura en `p_grupos` toma la clave `'00000'` (como `venta_proyeccion`); un límite de fecha nulo no acota ese lado. Las unidades son netas y el orden es determinista (mismos datos, mismo documento).
- Las claves salen del servidor solo como agregados derivados (variación comparable, meses con venta): **nunca se envían al proveedor**.
- En `0.15.1` se añade una lectura aparte por fila × equivalencia para las sublíneas (§10).

### 2.11 Función `registrar_propuesta_ia_gm(p jsonb) returns uuid` (transaccional; patrón M8)

`language plpgsql`, `security invoker`, `search_path = ''`, solo `service_role`. En una transacción (así quedó en la `0030`):
1. bloquea la fila de `ia_corrida_gms` (`for update`) y exige `estado = 'en_proceso'` y `candado_token = p->>'candado_token'`; si no, SQLSTATE **`IA001`** (`traducirErrorDb` → `409 gm_en_proceso`);
2. bloquea la corrida (`for update`) y exige `estado = 'en_curso'`; si no, SQLSTATE **`IA002`** (`409 corrida_terminada`);
3. **modo normal:** inserta `ia_propuestas_gm` y todas sus `ia_propuestas_filas`. **Modo reuso** (`reusa_propuesta_id` presente): no inserta nada y apunta a la propuesta reusada, que debe ser del mismo `gm_clave`; si no, SQLSTATE **`IA003`** (`propuesta_no_reusable`; no debería ocurrir: indica un error del servicio y se traduce a `409` con ese código);
4. pone el GM en `hecho` (o `reusado`) con `propuesta_gm_id` y `huella_gm`, limpia `error_codigo`, suelta el candado y toca `ia_corridas.ultima_actividad_at`.

**De la corrida** se toman `proyeccion_id`, `proveedor`, `modelo` y `version_prompt`; **de la fila del GM**, `corrida_id`, `pliegue` y `gm_clave`. El payload no los lleva (y si los llevara, se ignoran): así una propuesta no puede quedar atribuida a otro proveedor o modelo que el de su corrida. Si algo falla (también un `(propuesta_gm_id, fila_clave)` repetido), no queda propuesta vacía ni a medias (I6).

**Forma del payload** (la arma solo `consultas.ts`):

```jsonc
{ "corrida_gm_id": "<uuid>", "candado_token": "<uuid>",
  "reusa_propuesta_id": "<uuid>",          // solo en modo reuso; entonces no hay "propuesta" ni "filas"
  "huella_gm": "<64 hex>",                 // solo en modo reuso (en modo normal va dentro de "propuesta")
  "propuesta": { "genero_id", "mundo_id", "es_resto", "capacidades": [], "modo", "version_metodo", "meta"?,
                 "huella_gm", "huella_historia", "razon_gm"?, "banderas_gm": [], "avisos": [],
                 "filas_pedidas", "filas_validas", "desvio_suma_modelo"?, "perfil_id"?, "usuario_nombre"? },
  "filas": [ { "fila_id"?, "fila_clave", "estado_meta", "base_al_generar"?, "base_corregida_al_generar"?,
               "p_gm_al_generar"?, "aporte_fijo_al_generar"?, "natural_y1"?, "razon_natural"?, "meta_y1_modelo"?,
               "meta_y1_al_generar"?, "razon"?, "banderas": [], "senales": [], "avisos": [], "confianza"? } ] }
```

Los arreglos ausentes se guardan como `'{}'`. Los catálogos (`modo`, `estado_meta`, `confianza`, banderas) llegan ya validados por zod: la función no los comprueba.

### 2.12 Triggers

- `tg_ia_inmutable()`: una sola función para las cuatro tablas inmutables. Rechaza `DELETE`, `TRUNCATE` (trigger por sentencia) y todo `UPDATE` salvo el que solo pone en `NULL` las FK `on delete set null` de esa tabla.
- `tg_ia_terminal()` (`before update or delete`, por fila): con `old.estado` terminal (evaluaciones: `completa`, `fallida`, `cancelada`; corridas: `completa`, `parcial`, `detenida`, `cancelada`, `abandonada`; GM: `hecho`, `reusado`) rechaza **todo cambio y todo `DELETE`**, salvo poner en `NULL` `perfil_id` (y `proyeccion_id` en corridas); en `ia_corrida_gms`, sin excepciones. `updated_at` no cuenta en la comparación (lo mueve `set_updated_at` en el mismo `UPDATE`; los triggers corren en orden alfabético y `ia_*_terminal` va antes). Con un estado no terminal deja pasar, también el `DELETE` (la aplicación no borra). SQLSTATE `restrict_violation`.
- `tg_set_updated_at` en `ia_configuraciones`, `ia_evaluaciones`, `ia_corridas` e `ia_corrida_gms`.

### 2.13 Lo que no se guarda y lo que no cambia

- **No se guarda** la respuesta cruda del proveedor: solo los campos validados. El texto fijo del prompt vive en el código, versionado.
- **Los logs no reciben** ni lo enviado ni lo recibido: solo ids, tokens, costo, duración y códigos (R26).
- La clave de la API **no está en ninguna tabla**.
- **No cambian:** `proyecciones`, `proyeccion_filas`, `proyeccion_tiendas`, `crecimientos_genero_mundo`, `proyeccion_crecimientos`, `factores_volumen_atipico`, `venta_proyeccion`, `curvas_estacionalidad`, el `check` de `origen`, el de `metodo` y el contrato de `GET /api/proyeccion/cerrada`.

## 3. Contratos

Convenciones de M7:
- Respuestas `{ data }` / `{ error, codigo }` (`ok`, `error`, `errorConCodigo`, `leerCuerpo`, `idDeRuta`, `traducirErrorDb`).
- Cuerpos con zod `strict`. Ninguna mutación por `GET` (07 §7).
- Errores: `401` sin sesión · `403` rol · `400` zod · `404` · `409` regla, con `codigo`.
- Código:
  - lógica pura en `src/lib/ia/` (sin I/O) y `metaDeGM` en `src/lib/proyeccion/meta-gm.ts`;
  - lectura y escritura de la base solo en `src/lib/ia/consultas.ts`, el único archivo que nombra `venta_lineas_ia`, `registrar_propuesta_ia_gm` y las tablas `ia_*`;
  - el proveedor solo en su **adaptador**, `src/lib/ia/proveedor-openai.ts` (`import "server-only"`), que elige `src/lib/ia/proveedores.ts` según `IA_PROVEEDOR` (§3.10, §3.11). El resto del código solo conoce la interfaz `ProveedorIA` de `proveedor.ts` (sin SDK). `proveedor-anthropic.ts` es un adaptador futuro: no se escribe en `0.15.0`.

### 3.1 Rutas de la proyección (`requirePlanner`; el comprador recibe `403`)

| Ruta | Método | Cuerpo / consulta (zod) | Respuesta · errores |
|---|---|---|---|
| `/api/proyeccion/proyecciones/[id]/ia` | GET | — | `EstadoIaProyeccionApi`: `servicio`, `prerrequisitos: { bloquea: MotivoIa[], avisa: MotivoIa[] }`, `corrida_en_curso: CorridaApi \| null`, `gms: GMIaResumenApi[]`, `estimacion_pendientes: EstimacionApi`. `404` |
| `…/[id]/ia/corridas` | POST | `iniciarCorridaSchema = { gms: "pendientes" \| "todos" \| string[] /* gm_clave, 1..60 */, regenerar: boolean = false, costo_confirmado_usd: number ≥ 0 }` | Crea la corrida y sus `ia_corrida_gms` en `pendiente`. `201 { corrida, plan: { gm_clave, modo, llamadas, reusa }[], estimacion }`. `409`: `ia_no_disponible` (con `motivo`), `capacidad_apagada`, `cerrada` / `archivada`, `version_metodo` (< 5), `proyeccion_desactualizada` (motivos no forzables de 06e, `cargas_nuevas`, `curvas_cambiadas`, `crecimientos_cambiados`), `factor_y` (factor de `Y` `faltante`, `desfasado` o `sin_confirmar`, 06e D5; rev. M6), `anio_siguiente_atipico`, `calculo_en_curso`, `corrida_en_curso`, `tope_dia`, `tope_mensual`, `tope_corrida`, `costo_no_confirmado` |
| `…/[id]/ia/corridas/[corridaId]/gm/[clave]/paso` | POST | `{}` | Hace **un** paso del GM: en el primero arma los bloques (con alias y control de salida), los guarda en `ia_entradas`, decide el plan y si se reusa; en cada paso siguiente, **una** llamada al proveedor; en el último, valida y llama `registrar_propuesta_ia_gm`. `200 PasoGMApi`. Un `429`/`529`/`5xx`/tiempo agotado **no** es un error HTTP: responde `siguiente: "esperar"` con `esperar_ms` y el navegador vuelve a llamar. `409`: `corrida_terminada`, `gm_fuera_de_corrida`, `gm_en_proceso` (candado), `datos_cambiaron` (la corrida pasa a `parcial`), `tope_corrida` / `tope_mensual` / `tope_dia` (pasa a `detenida`), `cerrada`, `ia_no_disponible` (`clave_invalida`: la corrida pasa a `detenida`) |
| `…/[id]/ia/corridas/[corridaId]/terminar` | POST | `{ cancelar: boolean = false }` | `CorridaApi` (`completa` / `parcial` / `cancelada`) |
| `…/[id]/ia/gm/[clave]` | GET | — | `GMIaDetalleApi`: meta de hoy, filas con natural, con meta **vigente** (`asignarMeta` al leer), absorbido, brecha, razones, banderas, señales, avisos, estado y propuestas anteriores. `404` si no es un GM de la proyección |
| `…/[id]/ia/filas` | GET | `?genero_id&mundo_id&linea_id` | `{ filas: IaFilaApi[] }` por `fila_id`, para Por línea. Lectura aparte (D15) |
| `…/[id]/ia/filas/[filaId]/aceptar` | POST | `aceptarIaSchema = { anio: int, propuesta_fila_id: uuid, valor_esperado: int ≥ 0, nota?: ≤ 300 }` | Recalcula el valor IA **vigente** de la fila (`asignarMeta` de hoy); si difiere de `valor_esperado`, `409 ia_valor_cambio` con `{ valor_actual }`. Si coincide, llama `decidirFila(id, filaId, anio, { decidido: valor, origen: "manual", nota }, actor, { decision_ia_fila_id })`. Responde `RespuestaDecidirFilaApi` (con B2) más `decision_ia`. `409`: `ia_no_disponible`, `capacidad_apagada`, `anio_no_admitido` (en `0.15.0` solo `Y+1`), `ia_desactualizada`, `ia_no_vigente` (no es de la propuesta vigente del GM), `ia_fila_ajena` (`propuesta_fila_id` es de otra `fila_id`), `fila_no_libre`, `ia_sin_valor`, `ia_valor_cambio`, y los de `decidirFila` (`cerrada`, `calculo_en_curso`, `fila_inactiva`) |

### 3.2 Rutas de administración (`requireAdmin`; planner y comprador reciben `403`)

| Ruta | Método | Cuerpo | Respuesta · errores |
|---|---|---|---|
| `/api/ia/configuracion` | GET | — | `{ vigente: ConfiguracionIaApi \| null, versiones, servicio: ServicioIaApi, prompts: string[] }` (`servicio` trae `proveedor` y `modelos_permitidos`, del entorno) |
| `/api/ia/configuracion` | POST | `configuracionSchema = { modelo: 1..100, version_prompt: enum(PROMPTS), capacidades: enum[] (sin repetidos), evaluacion_id: uuid \| null, tope_usd_corrida, tope_usd_mes, tope_usd_dia_usuario, max_filas_llamada, incluir_cola_larga, presupuesto_razonamiento, precios: { entrada: > 0, entrada_cache: ≥ 0 y ≤ entrada, salida: > 0 } (≤ 1 000), terminos_extra: string(2..60)[] (≤ 50), nota?, version_vigente: int \| null }`. **Sin `proveedor`:** lo pone el servidor con `IA_PROVEEDOR` | `201 ConfiguracionIaApi`. `409`: `sin_proveedor` (falta `IA_PROVEEDOR` o no tiene adaptador), `modelo_no_permitido` (fuera de `IA_MODELO`), `capacidad_sin_evaluacion`, `evaluacion_otro_modelo` (otro proveedor, modelo o prompt), `evaluacion_no_gana`, `vigente_cambiada` (también si choca el único de `version`) |
| `/api/ia/evaluaciones` | GET | — | `EvaluacionApi[]` (todas, con su número de intento) |
| `/api/ia/evaluaciones` | POST | `evaluacionSchema = { modelo, version_prompt, pliegues?: Pliegue[] /* por defecto §5.4 */, precios, tope_usd: ≤ 500, costo_confirmado_usd }` (sin `proveedor`: el del entorno) | `201 { evaluacion, plan: { pliegue, gm_clave }[], estimacion }`. `409`: `evaluacion_en_curso`, `sin_datos_pliegue`, `tope_mensual`, `limite_evaluaciones_mes` (3), `costo_no_confirmado`, `ia_sin_clave`, `sin_proveedor`, `modelo_no_permitido` |
| `/api/ia/evaluaciones/[id]/pliegues/[pliegue]/preparar` | POST | `{}` | Sin llamar al proveedor: arma en memoria la proyección del pliegue (≈ 30 s, una vez por pliegue), guarda los bloques de todos sus GM en `ia_entradas` y la `referencia` (método, tendencia, real) en `ia_corrida_gms`. Idempotente. `200 { gms: number }` |
| `/api/ia/evaluaciones/[id]/gm/[clave]/paso` | POST | `{ pliegue: string }` | Un paso, como en 3.1, leyendo los bloques ya guardados (I10). **Nunca reusa por huella.** Al terminar el último GM del último pliegue calcula `resultados` y `veredicto` y pasa a `completa`. `409 evaluacion_terminada` / `tope` / `pliegue_sin_preparar` |
| `/api/ia/evaluaciones/[id]` | GET | — | `EvaluacionApi` con `resultados` y `veredicto` |
| `/api/ia/evaluaciones/[id]/cancelar` | POST | `{}` | `EvaluacionApi` (`cancelada`) |
| `/api/ia/uso` | GET | `?mes=aaaa-mm` | `{ mes, costo_usd, tope_usd_mes, corridas: CorridaApi[], por_dia: { dia, costo_usd, llamadas }[] }` (todo derivado de `ia_llamadas`) |
| `/api/ia/entradas/[id]` | GET | — | El JSON canónico descomprimido y su diccionario, para auditar una llamada. Solo admin; no se usa en ninguna pantalla del planner |

### 3.3 Cambios en M7 (dueño: Backend B, plan de tandas)

- **`metaDeGM`** (nuevo, `src/lib/proyeccion/meta-gm.ts`, puro; lo escribe la tanda 1): `metaDeGM({ filas, g, sobre_base, fuente }) → { meta_gm, p_gm: Map<fila_id, number>, fuera_base }` con la regla de D3. Lo importan la Matriz y `src/lib/ia/` (rev. M4).
- **`decidirFila`** (`servicio-edicion.ts:158`, hoy con cinco parámetros) gana un sexto opcional `opciones?: { decision_ia_fila_id?: string }`:
  - con él, escribe la columna;
  - sin él, la pone en `null` en todo registro cuya decisión cambie (también al volver a la propuesta);
  - el `PUT` de decisión **no cambia**: solo la ruta de aceptar pasa el parámetro.
- **Lecturas.** `AnioFilaApi` gana `decision_ia: { propuesta_fila_id, proveedor, modelo, version_prompt, generada_at } | null`.
- **`calcular`** conserva `decision_ia_fila_id` (no está en el `upsert` del cálculo). Ni `calcular` ni `cerrar` leen ni escriben tablas `ia_*`.
- **`copiar_de`** (`servicio.ts`) copia la columna.
- **Matriz.** El nodo de mundo dentro de género (el GM) gana `meta_siguiente: { meta_gm, desvio_u, desvio_pct, fuente } | null` (§5.1, «cuadre»), también en el Excel. Se calcula con `metaDeGM` desde las filas que la Matriz ya lee y la foto de crecimientos, sin tablas `ia_*`.
- **No cambian:** `GET /api/proyeccion/cerrada`, `…/mensual`, `leerCerradaParaFlujo`, `motivoRechazoCerrar` (cerrar no exige nada de la IA) ni `VERSION_METODO` (sigue en 5: la IA no cambia el método).

### 3.4 Tipos (`src/lib/ia/tipos-api.ts`, autocontenido)

```ts
export const CAPACIDADES_IA = ["distribucion_y1"] as const;            // 0.15.1 añade "cierre_y" y "sublineas" (sin migración: catálogo sin check)
export type CapacidadIa = (typeof CAPACIDADES_IA)[number];
export type MotivoServicioIa = "sin_clave" | "desactivada_entorno" | "sin_configuracion" | "sin_capacidades" | "clave_invalida" | "tope_mensual"
  | "sin_proveedor" | "proveedor_distinto" | "modelo_no_permitido";   // 2026-10-31 (§3.10)
export type ServicioIaApi = { disponible: boolean; motivo: MotivoServicioIa | null;
  proveedor: string | null /* IA_PROVEEDOR */; modelos_permitidos: string[] /* IA_MODELO */;
  modelo: string | null; version_prompt: string | null; capacidades: CapacidadIa[];
  gasto_mes_usd: number; tope_usd_mes: number | null; tope_usd_corrida: number | null; gasto_dia_usuario_usd: number; tope_usd_dia_usuario: number | null;
  evaluacion: { id: string; fecha: string; veredicto: Record<CapacidadIa, "gana" | "no_gana" | "sin_dato"> } | null };
export type MotivoIa = "version_metodo" | "proyeccion_desactualizada" | "cerrada" | "archivada" | "calculo_en_curso" | "anio_siguiente_atipico"
  | "factor_y" | "reaprobar_pendiente" | "meta_provisional" | "sin_meta" | "decisiones_y_pendientes";
export type EstadoMetaFila = "libre" | "fija_decidida" | "fija_pct" | "fija_cola_larga" | "sin_base";
export type MetaGMApi = { pct: number; sobre_base: "bruta" | "corregida"; fuente: "gm" | "resto" | "resto_provisional"; crecimiento_id: string | null; version: number | null;
  meta_gm: number; fijas: number; fijas_detalle: { decididas: number; pct_propio: number; cola_larga: number }; meta_libre: number;
  filas_libres: number; filas_fijas: number; fuera_base: { filas: number; unidades: number } };
export type EstadoPropuestaGM = "sin_propuesta" | "sin_filas_libres" | "al_dia" | "meta_movida" | "desactualizada" | "fallida" | "bloqueado_privacidad";
export type MotivoDesactualizadaIa = "historia_cambiada" | "filas_libres_nuevas" | "version_metodo" | "capacidad_apagada";
export type BanderaIa = "dato_insuficiente" | "linea_nueva" | "en_salida" | "quiebres" | "nino" | "volatil" | "tiendas_entrantes"
  | "meta_exigente" | "meta_holgada" | "estacionalidad_atipica";
export type SenalIa = "dato_insuficiente" | "linea_nueva" | "quiebres" | "nino" | "temporadas_mezcladas" | "avance_bajo" | "plan_anterior"
  | "revision_cola_larga" | "tiendas_entrantes" | "tiendas_salientes";
export type AvisoIa = "ia_no_cuadro" | "ia_cifra_excesiva" | "brecha_extrema" | "sin_propuesta_ia" | "fijadas_exceden_meta" | "meta_provisional"
  | "base_movida" | "meta_movida" | "absorcion_alta" | "bandera_desconocida" | "fila_extra" | "fila_duplicada" | "razon_recortada";
export type AbsorcionApi = { delta_meta_u: number; desviacion_fijadas_u: number; otros_u: number; absorbido_u: number; absorbido_pct: number | null };
export type IaFilaApi = {
  fila_id: string; propuesta_fila_id: string; estado_meta: EstadoMetaFila; estado_gm: EstadoPropuestaGM; motivos: MotivoDesactualizadaIa[];
  natural_y1: number | null; razon_natural: string | null;
  meta_y1: number | null;                    // vigente: asignarMeta de hoy; null si fija o sin reparto. Es el valor_esperado de «Aceptar IA»
  meta_y1_al_generar: number | null; absorbido_u: number | null; absorbido_pct: number | null;
  brecha_u: number | null; brecha_pct: number | null; contra_metodo_u: number | null;
  pct_sobre_corregida: number | null; pct_sobre_real: number | null;
  razon: string | null; banderas: BanderaIa[]; senales: SenalIa[]; confianza: "alta" | "media" | "baja" | null;
  avisos: AvisoIa[]; aceptable: { y1: boolean; motivo: string | null };
};
export type GMIaResumenApi = { gm_clave: string; genero: string; mundo: string; es_resto: boolean; meta: MetaGMApi | null; estado: EstadoPropuestaGM;
  motivos: MotivoDesactualizadaIa[]; configuracion_cambiada: boolean;
  natural_libres: number | null; meta_libre: number | null; esfuerzo_pct: number | null; filas_forzadas: number; filas_que_ceden: number;
  absorcion: AbsorcionApi | null; filas_y_sin_decidir: number;
  propuesta: { id: string; created_at: string; usuario_nombre: string | null; proveedor: string; modelo: string; version_prompt: string; razon_gm: string | null; costo_usd: number } | null };
export type GMIaDetalleApi = GMIaResumenApi & {
  filas: (IaFilaApi & { linea: string; equivalencia: string | null; agrupacion_marca: string; base: number | null; base_corregida: number | null;
    aporte_entrantes: number | null; aporte_salientes: number | null; metodo_y1: number | null; vigente_y1: number | null; decidida_y1: boolean;
    vigente_y: number | null; decidida_y: boolean })[];
  contexto: { aperturas_y1: number; cierres_y1: number; cola_larga: { filas: number; unidades: number }; vista_previa_curvas: number | null };
  anteriores: { id: string; created_at: string; proveedor: string; modelo: string; version_prompt: string }[] };
export type EstimacionApi = { gms: number; llamadas: number; filas: number; tokens_entrada: number; tokens_salida: number; costo_usd: number; tope_usd: number; reusables: number };
export type CorridaApi = { id: string; estado: string; gm_total: number; gm_hechos: number; gm_reusados: number; gm_fallidos: number;   // derivados
  costo_usd: number; costo_estimado_usd: number; proveedor: string; modelo: string; version_prompt: string; usuario_nombre: string | null;
  iniciada_at: string; terminada_at: string | null; motivo_fin: string | null };
export type EstadoCorridaGM = "pendiente" | "en_proceso" | "hecho" | "reusado" | "fallido" | "sin_filas_libres" | "bloqueado_privacidad";
export type PasoGMApi = { gm_clave: string; pliegue: string | null; estado: EstadoCorridaGM; pasos_hechos: number; pasos_total: number;
  siguiente: "continuar" | "esperar" | "hecho" | "fallido"; esperar_ms: number | null; corrida: CorridaApi };
```

### 3.5 Contrato con el proveedor: la entrada (`armarBloqueGM`, `armarSufijoReparto`, `armarEntradaLineas`; puros)

Se arma **por lista blanca**: cada campo se copia de una estructura tipada, sin `...spread` de filas de la base. Filas, líneas y equivalencias viajan con **ids cortos** (`f001`…, `l01`…, `e01`…). Cifras enteras; porcentajes con un decimal. **Ningún año real**: todo va relativo al año en curso `A` (I4).

```ts
type AnioRel = "A-3" | "A-2" | "A-1" | "A";
export type BloqueGMIa = {                         // idéntico en la llamada natural y en la de reparto del mismo lote (prefijo estable)
  version_entrada: 2;
  contexto: { ultimo_mes_cerrado: number; objetivo: "A+1"; objetivo_normal: true;   // 06e D7: A+1 sin Niño (si no, la corrida no arranca)
    nino: { anio: AnioRel; temporada: "invierno" | "verano"; meses: number[]; factor: number }[];   // factores efectivos usados por la proyección
    umbral_cola_larga: number };
  gm: { id: "g1"; genero: string; mundo: string; es_resto: boolean;
    historia: { anio: AnioRel; unidades: number; comparable_pct: number | null }[];
    fuera_de_meta: { aperturas_y1: number; cierres_y1: number };
    cola_larga: { filas: number; unidades_y1: number } };
  lote: { n: number; de: number };
  filas: FilaEntradaIa[];
};
export type FilaEntradaIa = {
  f: string; l: string; linea: string; equivalencia: string | null /* nodo GMLE */; agrupacion_marca: string;
  temporada: "invierno" | "verano" | "todo_el_ano" | "mixta";
  estado: "libre" | "fija";                       // fija: decidida en A+1 o con % propio (contexto; no se pide cifra)
  meses: Partial<Record<AnioRel, number[]>>;      // unidades de M(Z) de cada año; "A" con ultimo_mes_cerrado valores
  comparable_pct: Partial<Record<"A-2" | "A-1" | "A", number | null>>;
  y: { vendido: number; vigente: number | null; avance: number | null; metodo: "avance" | "plan_anterior" | "otro"; decidido: boolean };
  y1: { base: number | null; base_corregida: number | null; aporte_entrantes: number; aporte_salientes: number; fija_en: number | null; pedir: boolean };
  senales: { lista: SenalIa[]; meses_quiebre_w12: number; disponibilidad: number | null; meses_desde_primera_venta: number; meses_con_venta_24: number };
};
export type SufijoRepartoIa = {                   // solo en la llamada de reparto, después del bloque
  tarea: "reparto";
  meta: { pct: number; sobre: "corregida" | "bruta"; total: number; fijas: number; libre: number; provisional: boolean;
    del_lote: number /* = libre en modo directo; Σ sub-metas de las líneas del lote en jerárquico */ };
  naturales: { f: string; natural_y1: number | null }[];   // lo que devolvió la llamada natural de este lote
};
export type EntradaLineasIa = {                   // modo jerárquico, una sola llamada por GM, después de todas las naturales
  version_entrada: 2; contexto: BloqueGMIa["contexto"]; gm: BloqueGMIa["gm"];
  meta: Omit<SufijoRepartoIa["meta"], "del_lote">;
  lineas: { l: string; linea: string; filas_libres: number; historia: Partial<Record<AnioRel, number>>; comparable_pct: Partial<Record<"A-2" | "A-1" | "A", number | null>>;
    base_corregida: number; natural_y1: number /* Σ naturales de sus filas libres */; fijas: number }[];
};
```

- **De dónde sale cada cosa:**
  - `meses`: de `proyeccion_filas.historico` (unidades por mes de `M(Z)`; **nunca** `venta_soles`, `stock_fin` ni `cobertura`);
  - `comparable_pct`, `meses_desde_primera_venta` y `meses_con_venta_24`: de `venta_lineas_ia`;
  - `y` e `y1`: de `proyeccion_fila_anios`;
  - `aporte_salientes`: `Σ aporteSaliente(…)` (`siguiente.ts:120`) sobre `historico.salientes`, con `cierreBase = propuesto_Y ?? decidido_Y`, como `decision.ts:271-277`; `aporte_entrantes = B − vigente_Y + aporte_salientes` (identidad de `proponerSiguiente`, `siguiente.ts:78-80`; si `B` quedó en 0 por el `max(0, …)`, entrantes = 0 y aviso interno). En el glosario: **`B = cierre de A + entrantes − salientes`** (I5);
  - `meses_quiebre_w12` y `disponibilidad`: de `historico.meses[].quiebre` y `historico.cola_larga`;
  - `nino`: de `parametros.factores_usados`;
  - `meta`: de `metaDeGM` con la foto de crecimientos (`proyeccion_crecimientos` y `crecimiento_resto_usado`, 06d).
- **`y1.pedir`** = fila **libre** (§5.1). Una fija viaja como contexto con `fija_en`.
- **La llamada natural no lleva** `meta`, `g`, `propuesta_metodo` ni nada derivado de ellos (D9, rev. M11). Una prueba lo exige (R10).
- **Las filas de cola larga no viajan** (D4): van resumidas en `gm.cola_larga`.
- **Señales del código** (deterministas; se envían y se muestran aparte):
  - `dato_insuficiente`: menos de 12 meses con venta en los últimos 24;
  - `linea_nueva`: primer mes con venta dentro de los últimos 18;
  - `quiebres`: 3 o más meses de `W12` con quiebre o disponibilidad < 0,75;
  - `nino`: `φ_{A,m} ≠ 1` en algún mes;
  - `tiendas_entrantes` / `tiendas_salientes`: el aporte es ≥ 10 % de `B`;
  - `temporadas_mezcladas`, `avance_bajo`, `plan_anterior` y `revision_cola_larga`: los avisos de la fila.

**Alias y control de salida** (`alias.ts`, dentro de `armarBloqueGM`; decisión 3 de Javier, I8):
1. **Términos prohibidos**, armados en tiempo de ejecución (nunca en el repo): `marcas.nombre` (activas o no), `tiendas.nombre`, `tiendas.codigo` y `ia_configuraciones.terminos_extra`.
2. **Normalización** para comparar: mayúsculas, sin tildes, sin caracteres de formato (ancho cero, LRM, RLM), espacios colapsados. Coincidencia por **palabra o secuencia de palabras completas** (un término de varias palabras también). Solo se ignoran los términos de un carácter: una marca de dos letras se reemplaza igual, porque por palabra completa no toca otras palabras.
3. Cada coincidencia en un texto que viaja (línea, equivalencia, agrupación de marca, género, mundo) se reemplaza por un **alias neutro estable dentro de la corrida**: `MARCA_A`, `MARCA_B`…, `TIENDA_A`…, `TERMINO_A`…. El diccionario (alias → tipo e id, nunca el nombre) va en `ia_entradas.diccionario`.
4. **Control final**: el JSON ya armado se recorre entero; si queda un término prohibido, un uuid, un año real (`/\b(19|20)\d{2}\b/` en claves o textos) o una clave fuera de la lista blanca, **el GM no se envía**: queda `bloqueado_privacidad`, sin llamada, con aviso para el admin.
5. **Al volver**, los alias que aparezcan en `razon`, `razon_natural` y `razon_gm` se restituyen al nombre real **antes de guardar**. El usuario ve siempre nombres reales; el proveedor nunca los ve.

### 3.6 Contrato con el proveedor: la salida (zod, `src/lib/ia/esquemas.ts`)

```ts
export const BANDERAS_IA = ["dato_insuficiente","linea_nueva","en_salida","quiebres","nino","volatil","tiendas_entrantes","meta_exigente","meta_holgada","estacionalidad_atipica"] as const;
const entero = z.number().int().min(0).max(MAX_TOTAL);
const f = z.string().regex(/^f\d{3,4}$/);
export const salidaNaturalIa = z.strictObject({
  version_salida: z.literal(2),
  filas: z.array(z.strictObject({ f, natural_y1: entero, razon_natural: z.string().min(1).max(260), banderas: z.array(z.string().max(40)).max(6), confianza: z.enum(["alta", "media", "baja"]) })).max(150),
});
export const salidaRepartoIa = z.strictObject({
  version_salida: z.literal(2),
  razon_gm: z.string().max(800),                // se recorta a 600 (directo; en jerárquico manda la de `lineas`)
  banderas_gm: z.array(z.string().max(40)).max(6),
  filas: z.array(z.strictObject({ f, meta_y1: entero, razon: z.string().min(1).max(400), banderas: z.array(z.string().max(40)).max(6) })).max(150),
});
export const salidaLineasIa = z.strictObject({
  version_salida: z.literal(2), razon_gm: z.string().max(800), banderas_gm: z.array(z.string().max(40)).max(6),
  lineas: z.array(z.strictObject({ l: z.string().regex(/^l\d{2,3}$/), meta_y1: entero, razon: z.string().min(1).max(400) })).max(150),
});
```

**Se pide JSON y se valida con zod en el servidor, siempre** (`validar.ts` ya lo hace): la validación no depende de lo que garantice el proveedor. El esquema zod se convierte a JSON Schema (`z.toJSONSchema`) y el adaptador lo entrega por el mecanismo de salida estructurada que tenga el proveedor.

**Esta ficha no fija ese mecanismo.** Para OpenAI, cuál usar (salida estructurada con JSON Schema, modo JSON o herramienta forzada), con qué modelos funciona, qué restricciones de JSON Schema admite (`pattern`, `minimum`, `maximum`, `maxItems`, `additionalProperties`, campos opcionales, uniones), cómo reporta una negativa y qué límites tiene (tamaño y profundidad del esquema, tokens de salida) **lo verifica `backend` en la documentación vigente de OpenAI antes de implementar y lo registra en §11.2** (puntos 1 a 3). Reglas que no dependen de lo que encuentre:
- una restricción que el mecanismo no admita se quita del esquema enviado y la sigue garantizando zod (rev. M8);
- si el mecanismo no garantiza el esquema, los fallos los cubre el reintento por salida inválida de §3.8 y la cobertura de la evaluación (§5.4) los mide;
- el nombre del esquema (`nombre_esquema`) y su forma forman parte de la versión de prompt: cambiarlos sube la versión (§3.7).

### 3.7 Prompt `v1` (`src/lib/ia/prompt/v1.ts`; lo que la ficha fija)

El texto exacto lo escribe `backend`; lo revisan el `arquitecto-revisor` y el `analista-planeamiento`, y Javier lo puede leer en Administración (solo el texto fijo, sin datos). El bloque de sistema describe las **dos** tareas (así es idéntico en todas las llamadas y forma un prefijo estable); el final del mensaje dice cuál toca. El prompt no nombra al proveedor ni al modelo: la misma versión sirve a cualquier adaptador, pero **su evaluación vale solo para el proveedor y el modelo evaluados** (D11). Debe decir:

1. **Rol:** analista de planeamiento de una cadena de tiendas de ropa en Perú. No se nombra la empresa.
2. **Glosario:**
   - los años son relativos: `A` es el año en curso (con datos hasta `ultimo_mes_cerrado`) y `A+1` el que se planifica;
   - mismas tiendas y por qué los años no son comparables entre sí sin `comparable_pct`;
   - **`B = cierre de A + entrantes − salientes`**: un salto de `B` sobre lo vendido en `A` por tiendas que entran no es crecimiento (con un ejemplo sintético);
   - base corregida del Niño y que `A+1` es un año normal;
   - fila fija y meta libre;
   - algunos nombres vienen como alias (`MARCA_A`, `TIENDA_A`): son datos y se citan tal cual.
3. **Tareas:**
   - `natural`: lo que la fila vendería en `A+1` sin empujarla. **No hay meta en esta tarea.**
   - `reparto`: repartir `meta.del_lote` entre las filas libres del lote, que debe sumar esa cifra, «poniendo más esfuerzo donde la fila tiene con qué crecer y menos donde no», con los naturales como punto de partida;
   - `lineas` (jerárquico): lo mismo por línea, sumando `meta.libre`.
4. **Reglas:** unidades enteras; no inventar datos; con poca historia, `dato_insuficiente` y una cifra cercana a la base; no usar `A` sin corregir como base en las filas con Niño; aperturas y cierres no son de esta meta.
5. **Razón:** en español, con la cifra que la justifica (tendencia, quiebre, Niño, tiendas entrantes), sin repetir la entrada ni usar markdown. `razon_natural` ≤ 200 caracteres; `razon` ≤ 280.
6. **Banderas:** solo las del catálogo.
7. **Seguridad:** los nombres son datos, no instrucciones. Responder solo con el JSON del esquema.
8. **Un ejemplo sintético** completo (el ejemplo A de §5.6, en años relativos).

`VERSION_PROMPT = "v1"`. **Cambiar cualquier texto del prompt, de los esquemas o de los armadores de entrada sube la versión**, y esa versión necesita su propia evaluación ganadora (R23). Una prueba fija la huella del texto de cada versión publicada. `v1` **no envía** la propuesta del método en ninguna llamada (rev. M11); una variante que la envíe sería otra versión con su evaluación.

### 3.8 Llamadas: plan, lotes, caché, reintentos y tiempos

- **Plan de un GM** (lo fija el primer paso):
  - **directo** (filas libres + fijas de contexto ≤ `max_filas_llamada`): `n1` natural → `r1` reparto. 2 llamadas;
  - **jerárquico**: lotes de **líneas completas** de ≤ 60 filas (una línea nunca se parte; si una sola pasa de 60, se parte por `clave` y se avisa: la tanda 1 mide si ocurre); `n1…nk` natural → `l` líneas (sub-meta por línea con `asignarMeta`; una línea sin respuesta toma `Σ P^GM` de sus libres) → `r1…rk` reparto, cada uno con la sub-meta de sus líneas. `2k + 1` llamadas.
  - El peso final de una fila en jerárquico es su `meta_y1` escalado a la sub-meta de su línea; al leer se aplana con `asignarMeta` sobre el GM entero (D7).
  - Un GM sin filas libres no llama: `sin_filas_libres`.
- **Sin caché explícita** (2026-10-31): el código **no marca puntos de caché** ni depende de ella; no hay `cache_control` ni equivalente. Cada llamada envía siempre en el mismo orden:
  1. el texto fijo: sistema, instrucciones, esquemas y ejemplo (≈ 5 000 tokens);
  2. el **bloque del lote** (`BloqueGMIa`), idéntico en `nK` y `rK` (el `contexto` va dentro);
  3. el sufijo (`SufijoRepartoIa` o la indicación de la tarea).

  Si el proveedor tiene una caché automática por prefijo, ese orden la aprovecha: lo servido desde caché llega en `tokens_entrada_cache` y se cobra a `precios.entrada_cache`; si no la tiene, todo es `tokens_entrada`. El navegador hace `rK` en cuanto puede después de `nK` (en jerárquico, `l` va en medio). Si OpenAI cachea, desde qué tamaño, cuánto dura y cómo lo reporta lo verifica `backend` (§11.2, punto 5). **La estimación de §3.9 supone sin caché**, para no quedarse corta.
- **Razonamiento:** apagado por defecto (`presupuesto_razonamiento = 0`); si se enciende, no se fija la temperatura. Cómo se traduce al modelo lo verifica `backend` (§11.2, punto 4).
- **Tope de salida por llamada:** una constante del código, `MAX_TOKENS_SALIDA = 16 000`, que no depende de ningún id de modelo. Con 60 filas se esperan ≈ 5 000 (natural) y ≈ 6 600 (reparto). `backend` comprueba que los modelos candidatos admiten ese tope (§11.2, punto 4); si uno no lo admite, se baja `max_filas_llamada` en su configuración en vez de cablear el modelo.
- **Una llamada por petición; el navegador conduce los reintentos** (I6, I7):
  - `429`: no gasta intentos; el servidor responde `esperar` con lo que dicen `retry-after` o las cabeceras de límite del proveedor (cuáles manda OpenAI lo verifica `backend`, §11.2 punto 7); tras `MAX_ESPERAS_429 = 10` seguidas en el mismo paso, la corrida pasa a `detenida` (`limite_proveedor`) y la pestaña dice «el proveedor está limitando: sigue más tarde» (lo hecho queda y la próxima corrida lo reusa);
  - `500`, `502`, `503`, `504`, sobrecarga del proveedor (el código que use cada uno; `529` en Anthropic), error de red o tiempo agotado: hasta 3 intentos por paso, esperando `retry-after` o 2 s, 8 s y 30 s;
  - `400`: sin reintento (`invalida`, GM `fallido`);
  - `401` / `403`: sin reintento; servicio `clave_invalida` y corrida `detenida`;
  - corte por el límite de salida (el adaptador lo reporta como `fin = limite_salida`): el lote se parte en dos (el plan crece) una vez por nivel;
  - salida que no pasa zod o §5.2: **un** reintento con los errores **resumidos sin datos** («faltan 3 filas», «la suma difiere 22 %»); si vuelve a fallar, GM `fallido`;
  - negativa del modelo (en la forma en que la reporte el proveedor; el adaptador la traduce a `fin = rechazo`) o respuesta vacía: `rechazada`, sin reintento.
- **Corte de circuito:** 3 GM seguidos `fallido` **por el proveedor** (5xx, sobrecarga, tiempo) → corrida `detenida` (`proveedor_inestable`). **Los 429 no cuentan** (I7).
- **Tiempos:** tiempo límite por llamada 240 s. Cada ruta de paso hace una sola llamada, así que dura a lo sumo eso más el armado. `backend` consulta `node_modules/next/dist/docs/` por la duración máxima de una ruta y lo prueba en Railway. Presupuesto: ≤ 120 s por llamada de 60 filas, medido en la tanda 2.
- **Concurrencia:** el navegador procesa hasta **2 GM a la vez** y baja a 1 tras el primer 429; semáforo de 3 llamadas por proceso (patrón `cache-venta.ts`); una corrida en curso por proyección; una evaluación a la vez; tope de gasto por usuario y día.
- **Reproducibilidad:** temperatura mínima que admita el modelo (sin razonamiento) y, si el proveedor lo admite, una **semilla fija por corrida** (guardada en `alcance`; en la evaluación, en `parametros`). **Ni la temperatura ni la semilla garantizan la misma salida** (determinismo parcial): por eso se guardan la entrada (`ia_entradas`) y la salida validada (`ia_propuestas_*`), y la evaluación mide la estabilidad (`E25`). **Reuso solo en producción:** si el GM tiene la misma `huella_gm` (que incluye proveedor, modelo y prompt) que su propuesta vigente válida, se reusa sin llamar (`reusado`), salvo «Regenerar». **La evaluación nunca reusa** (I4).

### 3.9 Costo: estimación y topes (`costo.ts`)

`costo_usd = (T_ent × p_ent + T_cache × p_cache + T_sal × p_sal) ÷ 10⁶`, con `T_ent = tokens_entrada`, `T_cache = tokens_entrada_cache` (disjuntos, §2.6), `T_sal = tokens_salida` y los `precios` `{ entrada, entrada_cache, salida }` de la configuración (o de la evaluación). **Ningún precio está en el código:** los escribe el admin.

**Estimación previa** (por GM y suma), **sin caché**: por llamada, `T_ent = 5 000 (texto fijo) + ⌈bytes(bloque) ÷ 3⌉ + ⌈bytes(sufijo) ÷ 3⌉` y `T_cache = 0`; `T_sal = 85 × filas` (natural) `+ 110 × filas` (reparto) `+ 150 × llamadas`; margen × 1,2 por reintentos. El divisor 3 (bytes por token) es una aproximación del tokenizador: el ensayo en seco lo calibra contra el uso que reporte el proveedor. Si el proveedor cachea, el gasto real queda por debajo de la estimación (R14).

La corrida **no arranca** si la estimación supera `tope_usd_corrida`, lo que queda de `tope_usd_mes` o lo que queda de `tope_usd_dia_usuario`. **Se detiene** antes de una llamada si el gasto acumulado (derivado de `ia_llamadas`) más la estimación de esa llamada pasa de cualquiera.

**Volumen de tokens con las cifras del revisor, a rehacer con la proyección de método 5 y el ensayo en seco.** Supuestos: ≈ 650 filas libres (centro de 600 a 700), 29 GM con filas libres en ≈ 31 lotes, ≈ 260 tokens por fila en el bloque (sin sublíneas; años relativos) y 500 por lote, ≈ 64 llamadas, texto fijo de 5 000 tokens en cada llamada, **sin caché**. Resultado: ≈ **700 000 tokens de entrada** (≈ 320 000 del texto fijo repetido y ≈ 370 000 de los bloques, que van dos veces) **y ≈ 139 000 de salida**. El costo en US$ es `(M_ent × p_ent + M_sal × p_sal)`, con `M` en millones de tokens y los precios por millón del modelo elegido:

| Escenario | Entrada (M tokens) | Salida (M tokens) |
|---|---|---|
| Corrida completa, filas libres (por defecto) | ≈ 0,70 | ≈ 0,14 |
| Corrida con cola larga (`incluir_cola_larga`, ≈ 1 750 filas) | ≈ 1,5 | ≈ 0,36 |
| Regenerar un GM medio (≈ 22 filas, directo) | ≈ 0,023 | ≈ 0,005 |
| Evaluación por defecto (`D25`, `E25`, `D24`; §5.4) | ≈ 1,9 | ≈ 0,42 |

Más el margen × 1,2. **Esta ficha no trae precios de OpenAI**: `backend` toma los vigentes de los modelos candidatos (§11.2, punto 10), rehace la tabla en US$ en el ensayo en seco y la anota en el CHANGELOG. Pedir el natural sin la meta (D9) añade una llamada por lote: ≈ 0,35 M tokens de entrada más por corrida (el bloque va dos veces), menos si el proveedor cachea el prefijo.

**Topes por defecto** (los de la `0030`): US$ 10 por corrida, US$ 60 al mes, US$ 15 por usuario y día y US$ 50 por evaluación; editables por el admin. Con los precios reales se revisan: deben dejar pasar una corrida con margen y una evaluación, y `tope_usd_mes` debe quedar por debajo del límite de gasto que se fije en la cuenta del proveedor (§6.2).

### 3.10 Variables de entorno y dependencia

- **`OPENAI_API_KEY`:** la clave del proveedor inicial. **Solo** como variable secreta del servicio en Railway (y en `.env.local` de quien quiera probar contra el proveedor real, que no es necesario); **nunca** en el repo, en el chat, en un `NEXT_PUBLIC_*`, en la base ni en un log. Debe ser una clave **dedicada a Vector2** (en un proyecto propio de la cuenta, si la cuenta lo permite) para poder revocarla y ver su gasto sin tocar otros usos. Se lee solo en `proveedor-openai.ts`.
- **`IA_PROVEEDOR`:** id del adaptador que usa el servidor. En `0.15.0` el único valor válido es `openai`. **Sin valor por defecto:** si falta o no tiene adaptador, el servicio queda apagado con motivo `sin_proveedor`. Cuando exista `proveedor-anthropic.ts`, `anthropic` (con su propia `ANTHROPIC_API_KEY`, que `0.15.0` no lee).
- **`IA_MODELO`:** el id o los ids de modelo que el servidor permite usar, separados por comas; el primero es el que proponen los formularios. **Ningún id de modelo vive en el código:** cambiar de modelo es cambiar esta variable, evaluar y guardar una configuración, sin desplegar código. Sin valor, no se puede guardar una configuración ni iniciar una evaluación (`409 modelo_no_permitido`). La configuración vigente manda, porque está atada a su evaluación: si su `proveedor` no es `IA_PROVEEDOR` o su `modelo` deja de estar en `IA_MODELO`, el servicio se apaga (`proveedor_distinto` / `modelo_no_permitido`) en vez de llamar con otro modelo sin evaluar.
- **`IA_DESACTIVADA=1`** (opcional): interruptor de emergencia; manda sobre todo lo demás.
- `IA_PROVEEDOR`, `IA_MODELO` e `IA_DESACTIVADA` se leen solo en `src/lib/ia/entorno.ts` (`import "server-only"`); la clave, solo en el adaptador. `.env.local.example` gana las líneas vacías `IA_PROVEEDOR=`, `IA_MODELO=` y `OPENAI_API_KEY=` con el comentario «opcional: sin ellas la IA queda apagada; nunca pegues la clave en un chat ni la subas al repo».
- **Dependencia:** el SDK oficial de OpenAI para Node con versión fija, o `fetch` directo; `backend` elige tras leer la documentación vigente y lo registra en §11.2 (punto 13). Solo lo importa `proveedor-openai.ts`. **No** se añade `@anthropic-ai/sdk` en `0.15.0`.

### 3.11 Adaptador del proveedor (`ProveedorIA`)

La interfaz (`proveedor.ts`, sin SDK) es lo único que conoce el resto del código. Petición y respuesta **neutrales**:
- **Petición:** `modelo`, `sistema` (texto fijo), `bloque` y `sufijo` (JSON canónicos, en ese orden), `esquema` (JSON Schema) y `nombre_esquema`, `max_tokens` (`MAX_TOKENS_SALIDA`), `temperatura: number | null`, `semilla: number | null`, `presupuesto_razonamiento`, `timeout_ms` y `correccion` (resumen de errores sin datos para el reintento). **Ningún campo de caché.**
- **Respuesta:** `texto` (el JSON devuelto), `uso: { entrada, entrada_cache, salida }` (disjuntos, como `ia_llamadas`), `fin: "normal" | "limite_salida" | "rechazo" | "otro"`, `id_solicitud`, `modelo_respuesta`, `duracion_ms`.
- **Errores tipados** (ya en `proveedor.ts`): `limite` (`429`, con `esperar_ms`), `servicio` (5xx, sobrecarga o red), `tiempo_agotado`, `solicitud_invalida` (`400`) y `clave_invalida` (`401`/`403`). Sus mensajes son genéricos: nunca la clave, cabeceras ni datos.

El adaptador traduce: el uso del proveedor a los tres contadores neutros (restando la entrada cacheada si viene dentro del total, y sumando a `salida` los tokens de razonamiento si se cobran así), el motivo de fin del proveedor a `fin`, los códigos HTTP y cabeceras de límite a errores tipados con `esperar_ms`, y `temperatura` / `semilla` / `presupuesto_razonamiento` a lo que admita el modelo (omitiendo lo que no admita). **Todo lo que dependa de la API concreta de OpenAI lo verifica `backend` en la documentación vigente antes de implementarlo (§11.2)**; nada se escribe de memoria. `proveedores.ts` registra los adaptadores por id (`{ openai: crearProveedorOpenAI }`) y devuelve el de `IA_PROVEEDOR`, o `null` (`sin_proveedor`).

## 4. Pantallas (admin y planner; el comprador no ve nada de esto)

Formato `es-PE` (`src/lib/formato.ts`). Kit: `Card`, `DataTable`, `Tabs`, `Badge`, `Chips`, `Alert`, `Modal`, `Switch`, `Field`, `EmptyState`. Los textos de la IA se pintan **siempre como texto**, nunca como HTML ni markdown. **Siempre se muestran los nombres reales**: los alias solo existen en lo que se envía.

### 4.1 Proyección → pestaña «Propuesta IA» (nueva, entre «Crecimientos» y «Por línea»)

**Cabecera de servicio.**
- Encendida: «IA encendida · OpenAI · modelo … · prompt v1 · meta 2027 · evaluada el 02/11 · gasto de noviembre US$ 3,20 de 60 · hoy US$ 0,40 de 15».
- Apagada, con el motivo y qué hacer: «Falta la clave del proveedor en el servidor (Railway)»; «El servidor no tiene proveedor de IA configurado»; «La configuración vigente es de otro proveedor o de un modelo no permitido: el administrador debe evaluar y guardar una nueva»; «Apagada por el administrador»; «Sin evaluación ganadora: en la evaluación del 02/11 la IA no superó al mejor rival (reparto: WAPE 12,4 % frente a 11,9 % de tendencia)».
- Enlace a Administración → Motor de IA (solo admin).
- **Siempre visible:** «Para cerrar, cada fila libre se decide a mano (por línea). La IA propone; la columna “Desvío frente a la meta” de la Matriz es la única garantía de que lo decidido suma la meta» (D1, D19).

**Antes de generar** (`prerrequisitos`).
- **Bloquea:** proyección cerrada o archivada; `version_metodo` < 5; desactualizada por un motivo no forzable de 06e o por cargas, curvas o crecimientos; cálculo en curso; 2027 marcado atípico; **factor de 2026 `faltante`, `desfasado` o `sin_confirmar`** (06e D5; rev. M6) con enlace a Factores del Niño.
- **Avisa:**
  - Resto provisional («la meta del Resto no está aprobada: la IA reparte el % provisional»);
  - GM sin meta (solo natural y razones);
  - **`reaprobar` pendiente** (una versión `bruta` en un GM con Niño material, 06e D9): «reaprueba antes de generar o la meta cambiará después»;
  - **`decisiones_y_pendientes`**: «Decide primero 2026 en estos GM: cada cierre de 2026 mueve la meta de 2027 y las filas libres la absorben» (con la cuenta por GM; I2).

**Botón «Generar propuesta IA»** con selector: «GM pendientes o desactualizados» (por defecto) · «Todos» · uno. Abre un `Modal` con la estimación (GM, llamadas, filas, tokens, US$), los topes y lo que queda (corrida, mes, hoy), cuántos GM se reusan, la casilla «Regenerar aunque los datos no hayan cambiado» y **Confirmar (US$ 3,60)**. Después: progreso GM a GM (barra por pasos, costo acumulado, «esperando al proveedor…» en un 429, GM fallidos con «Reintentar este GM»), «Detener» y, al terminar, «27 GM al día · 1 fallido · 1 sin filas libres · US$ 3,12».

**Tabla de GM** (una fila por GM; HOMBRE, MUJER y los del Resto agrupados):

| Columna | Qué muestra |
|---|---|
| GM | género · mundo; «Resto» como etiqueta |
| Meta 2027 | «+8,00 % sobre corregido · 26 006 u» (badge «provisional» si aplica) |
| Fijas | unidades y filas fijas |
| Libre | `Meta_libre` |
| Natural IA | Σ natural de las libres |
| Esfuerzo | `Meta_libre ÷ Σ natural − 1`: ámbar desde +10 %, rojo desde +25 %, azul por debajo de −5 % |
| Forzadas / ceden | filas con brecha ≥ +10 % / ≤ −10 % |
| Absorbido | «−1 039 u (8,9 %) desde que la IA propuso» (ámbar si pasa del 5 %) |
| 2026 sin decidir | filas libres de 2026 sin decidir en el GM |
| Estado | al día · meta movida · desactualizada (motivo) · fallida · sin filas libres · bloqueado por privacidad · sin propuesta |
| Generada | fecha, quién, modelo, prompt y costo |
| — | «Ver» |

**Detalle de un GM.**
- Arriba, la **razón del GM** y la tarjeta de la meta: «Meta 26 006 u = Σ propuesta del método con +8 % · fijas 3 386 (1 decidida, 1 cola larga) · libre 22 620 · natural IA 22 000 → esfuerzo +2,8 %». Debajo, **las dos cifras de la meta** (rev. M13): «en filas de M7: 26 006 u · vista previa de Curvas: 25 870 u (Curvas la calcula por curva y agrupación, 06e D10; M7 por fila con su propia base: difieren por la cola larga, filas sin curva y redondeos)». Fuera de la meta: «aperturas 2027 1 240 u · cierres 0 · líneas nuevas de 2027: se planifican aparte».
- **Desglose de la absorción** (si hay propuesta): «Desde que la IA propuso: la meta cambió +0 u; las filas fijadas después se apartaron +1 039 u de lo que la IA les daba; otros 0 u; las libres que quedan absorbieron −1 039 u (−8,9 %)».
- La tabla de filas, **ordenada por |IA con meta − método| descendente** (I1: primero donde la IA más se aparta del método), con totales por línea y GM y Excel (`hojasPropuestaIa`):

| Columna | Qué muestra |
|---|---|
| Línea · AM (o equivalencia en GMLE) | |
| 2025 | real |
| 2026 | vigente, y si está decidida |
| Base 2027 | real / corregida, con «+2 200 u por tiendas que entran» si aplica |
| Método 2027 | `propuesto` |
| **Natural IA** | con su razón al pasar el cursor |
| **IA con meta** | vigente |
| **Absorbido** | «−309 u (−4,6 %)»; ámbar con aviso `absorcion_alta` si pasa del 10 % |
| **Brecha** | u y %: ámbar «forzada» desde +10 %, rojo «muy forzada» desde +25 %, azul «cede» desde −10 % |
| vs método | `contra_metodo_u` |
| % sobre 2026 | corregido / real |
| Confianza | |
| Señales del sistema y lectura de la IA | dos grupos de chips |
| Razón | |
| Decisión | decidida (por IA o a mano) / pendiente |
| — | «Ir a la línea» |

**«Ver propuestas anteriores»** lista las del GM (fecha, modelo, prompt) en solo lectura.

### 4.2 Por línea

- **Switch «Ver IA»**, en la URL `&ia=1`, apagado por defecto. Encendido, la tabla de filas base de 2027 gana «Natural IA», «IA con meta», «Absorbido» y «Brecha» (mismo código de color). Las fijas muestran «fija: decidida / % propio / cola larga».
- **En la celda de decisión de 2027**, junto a «Aceptar» (método), el botón **«Aceptar IA (10 961)»**, que envía la cifra mostrada como `valor_esperado`. Si responde `409 ia_valor_cambio`, la celda se refresca con la cifra nueva y un aviso «la cifra IA cambió a 10 940 porque se fijó otra fila del GM: revisa y acepta de nuevo». Deshabilitado, con el motivo, si el GM está `desactualizada`, la capacidad está apagada, la fila es fija o no hay cifra. Aceptado, el registro lleva el badge **«IA»** con fecha y versión.
- **La razón** se abre con la fila (ícono «¿por qué?»), con las banderas y la razón del natural.
- **Pie de la línea:** «DENIM aporta 10 961 de la meta libre de HOMBRE · URBANO (48 %) · natural 10 300 · brecha +661 u (+6,4 %)».
- **Al fijar una fila** (IA o a mano), Por línea vuelve a pedir `GET …/ia/filas`; la pantalla lo dice una vez («las demás filas libres de HOMBRE · URBANO se ajustaron para seguir sumando la meta: mira la columna Absorbido»).
- **Si `GET …/ia/filas` falla**, las columnas muestran «—» con un `Alert` que no bloquea.

### 4.3 Detalle de la fila

Bloque **«Propuesta IA»**: natural (con su razón), con meta, absorbido, brecha, confianza, señales, lectura de la IA y razón; «generada el 30/10 por J. Pérez · modelo … · prompt v1»; el estado del GM; el aviso `base_movida` («la base corregida cambió 3,1 % desde que la IA propuso; regenera el GM si quieres que lo tenga en cuenta») y `absorcion_alta` («esta fila absorbió −13,2 % desde que la IA propuso: la cifra ya no es la que la IA razonó»).

### 4.4 Matriz

El nodo de cada GM gana dos columnas, también en el Excel:
- **«Meta 2027»**: `Meta_GM`;
- **«Desvío frente a la meta»**: `Σ vigente − Meta_GM`, en u y %, ámbar si pasa de ±1 %.

Título de la columna: «Cuánto se apartan las cifras vigentes de 2027 (decididas o propuestas) de la meta aprobada. Es la garantía de la meta: cerrar no lo exige». No cambia ninguna otra columna.

### 4.5 Administración → «Motor de IA» (`/administracion/ia`, solo admin; entrada en `nav.ts`, sección Administración)

Tres pestañas.

**Configuración.** La vigente y sus versiones. Formulario: proveedor (solo lectura: el de `IA_PROVEEDOR`), modelo (uno de `IA_MODELO`; el primero por defecto), versión de prompt («Ver texto» muestra el prompt fijo sin datos), capacidad (habilitada solo si la evaluación elegida la dio por ganadora), evaluación, topes (corrida, mes, usuario y día), filas por llamada, cola larga, razonamiento, precios por millón (`entrada`, `entrada en caché`, `salida`; vacíos, con la ayuda «cópialos de la página de precios vigente del proveedor») y **términos que nunca salen** (`terminos_extra`, con la ayuda «marcas y tiendas ya se reemplazan solas; añade el nombre de la empresa u otros»). «Guardar versión», con nota. Arriba, el estado del servicio: proveedor del entorno, modelos permitidos y «clave presente en el servidor: sí/no» (nunca el valor).

**Evaluaciones.** «Nueva evaluación»: proveedor (solo lectura), modelo (de `IA_MODELO`), prompt, pliegues por defecto, estimación y confirmación; muestra «intento n.º 4 · mejora mínima exigida 10 % (desde la segunda versión de prompt)». Progreso por pliegue («preparando D25…») y GM. **Informe:** para el reparto y para el natural, una tabla con pliegue, filas, WAPE del método, de tendencia y de la IA, rival a batir, mejora relativa, IC 90 % del bootstrap, por género, GM ganados, estabilidad y cobertura; el veredicto con la regla que falló; costo y duración. **Todas** las evaluaciones anteriores quedan listadas, también canceladas y fallidas.

**Uso.** Por mes: costo, tope y llamadas por día. Corridas: quién, cuándo, proyección, proveedor, modelo, prompt, GM hechos, reusados, fallidos y bloqueados por privacidad, tokens, costo y estado. Por corrida, sus llamadas: GM, paso, intento, estado, tokens (entrada, entrada en caché, salida), modelo de la respuesta, costo, duración, código de error, huella (8 caracteres) y «Ver entrada» (descarga el JSON enviado, con alias; solo admin).

## 5. Reglas de negocio

### 5.1 Notación y fórmulas exactas (`meta.ts`, `absorcion.ts`, `aportes.ts` y `proyeccion/meta-gm.ts`; puras)

**Notación:**
- `Y` = año en curso (2026, `A` en lo enviado), `k` = último mes cerrado, `f` = fila base activa con su GM resuelto con `resumen.gm_gml` (mapa `gml_id → gm_clave`).
- Del registro de 2027 de `f`: `B_f` = `base_siguiente`; `B'_f` = `base_normalizada` (en el método 5, la base corregida del Niño); `P^M_f` = `propuesto`; `V_f` = vigente (`decidido ?? propuesto`).
- `g`, `s`: el % y el `sobre_base` de la fuente de la meta del GM, de la **foto de la proyección** (`proyeccion_crecimientos` para HOMBRE y MUJER; `parametros.crecimiento_resto_usado` para el Resto). `B^s_f = B'_f` si `s = corregida`, `B_f` si `bruta`.
- **B2** es la regla de M7 que recalcula la base y la propuesta de 2027 de una fila al decidir su 2026 (07; `decision.ts`); no confundir con el bloqueante B2 de la revisión.
- Nada se redondea en pasos intermedios. Los repartos enteros usan `repartirEntero` (`proyeccion/reparto.ts`, mayor resto, empate al primero) sobre las filas **ordenadas por `clave`**.

**Meta del GM** (D3, D6, D18; `metaDeGM`):
- Entran las filas base activas de 2027 del GM con `P^M_f` no nulo (que implica `B_f` no nulo; `decision.ts:337`). Las demás (`sin_base`, `sin_curva`) quedan **fuera** y se cuentan en `fuera_base`.
- `P^GM_f = P^M_f` si el registro no tiene `crecimiento_pct` propio (su `propuesto` ya es `round(B^s × (1 + g))` con el `g` del GM o del Resto). Con % propio: `P^GM_f = round(B^s_f × (1 + g/100))`, con `B'` de `base_normalizada` (centésimas: puede diferir en una unidad de lo que daría `B'` sin redondear; se acepta y se documenta; rev. M3).
- `Meta_GM = Σ_f P^GM_f`. Fuente `resto_provisional` si `crecimiento_resto_usado.crecimiento_id` es nulo (aviso `meta_provisional`). Sin `g` en la foto, el GM no tiene meta (`sin_meta`): solo natural y razones.

**Clasificación de 2027** (`estadoFilaMeta`, en este orden):
1. `fija_decidida`: `decidido` no nulo. Aporta `decidido`.
2. `fija_pct`: `crecimiento_pct` propio no nulo. Aporta su vigente.
3. `fija_cola_larga`: `propuesto < umbral_cola_larga`, sin `revision_cola_larga` y con `incluir_cola_larga = false`. Aporta su vigente.
4. `sin_base`: `P^M_f` nulo.
5. `libre`: el resto.

`Σfijas = Σ` aportes y `Meta_libre = Meta_GM − Σfijas`. Si `Meta_libre < 0`, no hay reparto: las libres quedan con `meta_y1 = null` y aviso `fijadas_exceden_meta`.

**Asignación de la meta** (`asignarMeta`, D7; al leer y al generar). Pesos, en este orden por fila (I3):
- `w_f = meta_y1_modelo_f` de la propuesta vigente si **no es nulo**;
- si es nulo (cifra descartada por `ia_cifra_excesiva`, fila que faltó en la respuesta, libre nueva o que dejó de ser fija): `w_f = P^GM_f`, con aviso `sin_propuesta_ia`. **Nunca se pasa un nulo a `repartirEntero`**, que lo trataría como 0 (`reparto.ts:18`) y daría `A = 0`;
- si `Σ w = 0`: `w_f = natural_y1_f ?? 0`; si también es 0, `B^s_f`; si también, pesos iguales.
- `A_f = repartirEntero(Meta_libre, w)`. **`Σ_libres A_f = Meta_libre`** y **`Σfijas + Σ A_f = Meta_GM`**, siempre.

**Lo que se muestra por fila:**
- `brecha_u = A_f − natural_y1_f`; `brecha_pct = A_f ÷ natural_y1_f − 1` (nula si el natural es 0).
- `contra_metodo_u = A_f − P^M_f` (orden de la tabla: `|contra_metodo_u|` descendente, empate por `clave`).
- `pct_sobre_corregida = A_f ÷ B'_f − 1`; `pct_sobre_real = A_f ÷ B_f − 1`.
- **Esfuerzo del GM:** `Meta_libre ÷ Σ_libres natural_y1 − 1`; banderas del GM `meta_exigente` (≥ +10 %) y `meta_holgada` (≤ −5 %), puestas por el código.

**Absorción** (`absorcion.ts`; decisión 1 de Javier, I2). Referencia: `meta_y1_al_generar_f` (`A_f` del momento de generar).
- Por fila libre hoy con referencia: `absorbido_u_f = A_f − meta_y1_al_generar_f`; `absorbido_pct_f = absorbido_u_f ÷ meta_y1_al_generar_f` (nulo si la referencia es 0). Aviso **`absorcion_alta`** si `|absorbido_u_f| > 0,10 × meta_y1_al_generar_f`.
- Por GM: `absorbido_u = Σ absorbido_u_f` y `absorbido_pct = Σ |absorbido_u_f| ÷ Σ meta_y1_al_generar_f` sobre esas filas. **`meta_movida`** si `absorbido_pct > 5 %`.
- Desglose (se muestra): `delta_meta_u = Meta_GM hoy − meta.meta_gm al generar` (decisiones de 2026 por B2, otra versión del %); `desviacion_fijadas_u = Σ_{libre al generar, fija hoy} (aporte hoy − meta_y1_al_generar) + Σ_{fija al generar} (aporte hoy − aporte_fijo_al_generar)`; `otros_u = delta_meta_u − desviacion_fijadas_u − absorbido_u` (cola larga que cambió, libres nuevas, filas que salieron). Así `absorbido_u = delta_meta_u − desviacion_fijadas_u − otros_u` por construcción.
- Como todas las libres conservan su peso, absorben en la misma proporción (salvo redondeo y pesos de respaldo): el % por fila es casi el del GM. Por eso el GM pasa a `meta_movida` (5 %) antes de que las filas avisen (10 %).
- **Es independiente del orden de revisión**: depende solo del estado de hoy y de lo guardado al generar. Aceptar la IA en una fila a su cifra vigente no cambia lo que absorben las demás.

**Cuadre** (Matriz): `desvio_u = Σ_{f ∈ GM con P^M_f no nulo} V_f − Meta_GM` y `desvio_pct = desvio_u ÷ Meta_GM`.

**Variación comparable** (entrada): para `Z ∈ {Y−2, Y−1}`, `comparable_pct_Z = U(Z) ÷ U(Z−1) − 1`, sumando **solo** las claves con `1` en las posiciones de `M(Z)` y `M(Z+1)` (tiendas abiertas todo `Z−1` y todo `Z`). Para `Y`, lo mismo con los meses `1…k` y las claves con `1` en `M(Y)` y `M(Y+1)`. Nula si el denominador es 0.

**Aportes de tiendas** (`aportes.ts`, I5): `aporte_salientes_f = Σ_s aporteSaliente({ cierreBase: propuesto_Y ?? decidido_Y, vendidoBase: vendido_Y, vendidoTienda: s.vendido })` sobre `historico.salientes`; `aporte_entrantes_f = B_f − vigente_Y_f + aporte_salientes_f` (si `B_f = 0` por el `max(0, …)` de `siguiente.ts:80`, entrantes = 0).

### 5.2 Validación y normalización de la salida (`validar.ts`; pura)

| Comprobación | Si falla |
|---|---|
| zod (`salidaNaturalIa` / `salidaRepartoIa` / `salidaLineasIa`) | intento `invalida`; un reintento con el resumen del error; segunda falla → GM `fallido` |
| Cada `f` pedido aparece una vez | duplicado → se toma el primero (aviso `fila_duplicada`); faltan ≤ 5 % → esas filas sin cifra (peso `P^GM` al leer, `sin_propuesta_ia`); faltan > 5 % → `invalida` y reintento |
| `f` no pedido o fija | se ignora (aviso `fila_extra`) |
| `natural_y1` o `meta_y1` > `10 × max(B^s_f, máximo anual de los últimos tres años, 1)` | la cifra se descarta (aviso `ia_cifra_excesiva`; peso `P^GM`) |
| `desvio = Σ meta_y1 ÷ meta.del_lote − 1` (reparto) o `÷ Meta_libre` (líneas) | `\|desvio\| ≤ 3 %`: nada; `3 % < \|desvio\| ≤ 15 %`: aviso `ia_no_cuadro`; `> 15 %`: `invalida` y reintento. Se guarda en `desvio_suma_modelo` |
| `A_f ÷ natural_y1_f ∉ [0,5, 2]` | aviso `brecha_extrema` (no se recorta) |
| Bandera fuera del catálogo | se descarta (aviso `bandera_desconocida`) |
| `razon`, `razon_natural`, `razon_gm` | se restituyen los alias; se quitan caracteres de control, de formato y separadores de línea con **`CARACTERES_PROHIBIDOS_IA = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu`** (más amplio que `CARACTERES_PROHIBIDOS_NOTA` de `curvas/esquemas.ts:324`, que no cubre ancho cero, LRM ni RLM; rev. M9); se colapsan espacios y se recortan (280 / 200 / 600, aviso `razon_recortada`); vacía tras sanear → «sin explicación» |
| Modo jerárquico: líneas sin respuesta en `lineas` | su sub-meta se reparte con `P^GM` (aviso) |

Validar es puro: recibe lo enviado (con el diccionario) y la salida, y devuelve las filas validadas, los avisos e `invalida: motivo | null`.

### 5.3 Estados, huellas y desactualización (`estado.ts`, `huellas.ts`)

**Huellas** (`canonico`: claves ordenadas, sin espacios, números como `JSON.stringify`):
- **`huella` de una entrada**: sha-256 de `canonico(contenido)`; **`huella_llamada`**: de `{ proveedor, version_prompt, modelo, bloque, sufijo }`.
- **`huella_gm`**: de `{ proveedor, version_prompt, modelo, bloques: [huellas de los bloques del GM], meta: { pct, sobre, total, fijas, libre, provisional } }`. Se calcula en el primer paso, antes de llamar: es la clave del reuso.
- `proveedor` entra en las dos desde el 2026-10-31 (un mismo id de modelo no debe reusar entre proveedores). El encabezado de la `0030` describe la composición anterior: es un comentario y no pide migración.
- **`huella_historia`** del GM (revisión, bloqueante B1): sha-256 de `canonico` sobre las filas base **activas** del GM (orden por `clave`) con `historico.anios[].meses[].unidades` y `atipico`, el `vendido` y el `avance` de 2026, `curva_origen`, `factores_mes[Y]` y **el conjunto de claves de esas filas, sin su estado**. Decidir, aceptar la IA, poner un % propio o pasar una fila de libre a fija **no la cambia** (eso lo cubren la absorción y `filas_libres_nuevas`). Todo lo que entra solo cambia con `calcular`, así que se guarda en una **caché en memoria por `(proyeccion_id, calculado_at)`** y `GET …/ia` no relee los ≈ 12 MB de `historico` en cada lectura (I10).

**Estado de la propuesta de un GM** (`estadoPropuestaGM`, al leer), en este orden:
1. **`bloqueado_privacidad`:** el último intento no se envió por el control de salida (§3.5) y no hay propuesta válida anterior.
2. **`fallida`:** el último intento del GM falló y no hay propuesta válida anterior.
3. **`sin_filas_libres`** · 4. **`sin_propuesta`**.
5. **`desactualizada`**, por: `historia_cambiada` (la `huella_historia` de hoy difiere de la guardada); `filas_libres_nuevas` (libres sin cifra IA cuyo `Σ P^GM` pasa del 5 % de `Meta_libre`); `version_metodo` (distinto del de la propuesta); `capacidad_apagada`.
6. **`meta_movida`:** `absorbido_pct > 5 %` (§5.1). Se puede aceptar, con aviso «las libres absorbieron 8,9 % desde que la IA propuso: regenera el GM si quieres su criterio sobre la meta nueva».
7. **`al_dia`.**

`configuracion_cambiada` (proveedor, modelo o prompt distintos de la vigente) es solo informativo. Por fila, `base_movida` es informativo: `|B'_hoy ÷ base_corregida_al_generar − 1| > 2 %`.

**Qué invalida qué:**

| Cambio | Efecto en la IA |
|---|---|
| Aceptar la IA en una fila de 2027 a su cifra vigente | ninguno: las demás no absorben nada |
| Fijar una fila de 2027 a mano o poner un % propio | las libres absorben la diferencia con lo que la IA le daba; `meta_movida` si pasa del 5 %, `absorcion_alta` por fila si pasa del 10 % |
| Decidir el 2026 de una fila (B2) o aprobar otra versión del % | `Meta_GM` cambia → absorción; `base_movida` por fila |
| Publicar un mes, aprobar una curva, cambiar un factor del Niño, mover tiendas de bloque, y recalcular | `historia_cambiada` → `desactualizada` (aceptar deshabilitado; regenerar el GM cuesta centavos) |
| Recalcular sin cambios de datos | ninguno (la huella de historia es la misma) |
| Proyección pasa a otro `version_metodo` | `desactualizada` |
| Nueva configuración con otro proveedor, modelo o prompt | informativo (la próxima corrida no reusa: otra `huella_gm`); lo existente sigue utilizable si la capacidad sigue encendida |
| Se apaga la capacidad | cifras ocultas y no aceptables; las decisiones tomadas quedan |
| Proyección cerrada | todo en solo lectura; no hay corridas nuevas |

**Reproducibilidad.** Reuso por `huella_gm` (solo producción); «Regenerar» crea una propuesta nueva que pasa a ser la vigente. Un modelo no da la misma salida dos veces: la evaluación mide esa variación (estabilidad). Lo reproducible es lo que hace el código con una salida guardada (`asignarMeta`, absorción, estados, reparto mensual) y, con `ia_entradas`, la propia llamada.

**Corridas abandonadas.** Una corrida `en_curso` sin actividad durante `CORRIDA_CADUCA_MIN = 30` minutos pasa a `abandonada` cuando alguien inicia otra en la misma proyección (patrón `CALCULO_CADUCA_MIN`).

### 5.4 Evaluación (backtest) y encendido (`evaluacion.ts`, `servicio-evaluacion.ts`)

**Cómo se arma un pliegue.**
- El paso `preparar` corta la historia en una fecha y arma **en memoria** la proyección del método con `calcularProyeccion` (puro), `hasta_periodo` = corte, desde `cargarContextoCalculo`, las lecturas de M7 y `venta_lineas_ia(…, p_hasta = corte)`. **No escribe ninguna `proyecciones`**; no hay decisiones ni `plan_anterior`. Guarda los bloques de cada GM en `ia_entradas` y la `referencia` en `ia_corrida_gms`: así la proyección del pliegue se arma **una vez por pliegue**, no una por GM (≈ 30 s cada una; I10).
- La entrada se arma **solo con datos ≤ corte** y con **años relativos**; una prueba de propiedad lo exige.
- Las curvas y los factores son los de hoy, que conocen los años de prueba: es una fuga **compartida** por el método y la IA (07 paso 7), y el informe la rotula.

**Pliegues por defecto** (45 meses publicados, 2023-01 a 2026-09; la tanda 1 confirma cuáles se pueden armar):

| Pliegue | Corte | Qué se predice | Rivales | Papel en el veredicto |
|---|---|---|---|---|
| `D25` | 2024-12 (`A` = 2024, `k` = 12; historia `A−1`, `A`) | **natural** de 2025 (entrada **sin meta**) y **reparto** de 2025 entre las libres con **meta oráculo** = Σ real 2025 (`M(2025)`) de las libres de cada GM | reparto: método parejo `repartirEntero(Meta_libre, B^s)` y tendencia `repartirEntero(Meta_libre, B^s × (1 + clamp(t, −50 %, +100 %)))`; natural: `B^s × (1 + g_real del GM)` y `B^s × (1 + clamp(t))` | cuenta |
| `E25` | igual | `D25` repetido con la misma entrada | — | estabilidad |
| `D24` | 2023-12 (`A` = 2023, año Niño; historia solo `A`) | natural y reparto de 2024, con la base 2023 corregida con `φ` 2023: **el caso de 2027** (base corregida) | método parejo (la tendencia no existe con un año de historia) | contraste obligatorio |
| `N26` | 2025-12 | reparto de ene–`k` de 2026 | método parejo | opcional, no por defecto; informativo |

`t` es la `tendencia` de 07 paso 8. **La meta oráculo solo la ve la llamada de reparto; la natural nunca.**

**Métricas** (sobre las filas libres del pliegue; `r` real, `p` predicho):
- **`WAPE = Σ |p − r| ÷ Σ r`.** Con la meta oráculo, `Σ p = Σ r` por GM en el reparto.
- **`EAT_reparto` (pp) = `50 × Σ |p ÷ Σp − r ÷ Σr|`** (la `eatPp` de M12; con totales iguales, `50 × WAPE`).
- **Estabilidad:** `Σ |A¹ − A²| ÷ Σ A¹` entre `D25` y `E25`.
- **Cobertura:** filas con respuesta válida ÷ filas pedidas.
- **Rival** de cada métrica: el mejor (menor WAPE) de los dos; se informa cuál fue.

**Veredicto de `distribucion_y1` (`gana`).** Se cumplen todas (I4, decisión 5 de Javier):
1. **Mejora sobre el mejor rival** en el reparto de `D25`: `1 − WAPE_IA ÷ min(WAPE_M, WAPE_T) ≥ MEJORA_MIN`. `MEJORA_MIN = 0,05` en las evaluaciones de la **primera** versión de prompt evaluada (cualquier modelo) y **0,10 desde la segunda** (se guarda en `parametros`): cada versión nueva es otro intento sobre los mismos pliegues y la vara sube para no premiar el ajuste fino.
2. **Bootstrap por GM:** 1 000 remuestreos de GM con reemplazo y semilla `20261030`; en cada uno, `min(WAPE_M, WAPE_T) − WAPE_IA` recalculado; el percentil 5 es > 0.
3. **Gana en la mayoría de los GM:** la IA tiene menor WAPE que el mejor rival en al menos la mitad de los GM con ≥ 5 filas libres. (Con dos GM al 44 % del volumen, el bootstrap por sí solo casi equivale a «ganó en MUJER y HOMBRE · URBANO».)
4. **No empeora más de un 10 % relativo** frente al mejor rival en HOMBRE, en MUJER ni en el Resto por separado.
5. **Natural:** `WAPE_natural_IA ≤ min(WAPE de B^s × (1 + g_real), WAPE de B^s × (1 + clamp(t)))` en `D25` (revisión, bloqueante B3).
6. **`D24`, contraste:** `WAPE_IA ≤ 1,10 × WAPE_M` en el reparto de `D24`.
7. **Cobertura** ≥ 98 % y **estabilidad** ≤ 5 %.

Con menos de 50 filas libres en `D25`, `sin_dato`.

**Todos los intentos quedan registrados** (`ia_evaluaciones` no se borra; el informe muestra el número de intento y los anteriores). Tope: **3 evaluaciones por mes** (`409 limite_evaluaciones_mes`), además del de costo. **La evaluación nunca reusa por huella**: cada intento llama.

**Encendido.** Una capacidad se enciende solo con una configuración cuyo `evaluacion_id` apunte a una evaluación `completa` con el **mismo `proveedor`, `modelo` y `version_prompt`** y `veredicto.distribucion_y1 = gana` (R23). Recomendación: evaluar con `v1` dos o tres modelos de OpenAI de distinto costo (los elige Javier con `backend` según la documentación y los precios vigentes) y encender el **más barato que gane**.

**El backtest queda atado a proveedor + modelo + versión de prompt** (decisión 74). Cambiar de proveedor (p. ej. a Claude cuando haya API y adaptador), de modelo o de prompt exige una evaluación nueva y ganadora antes de encender. Para que el vínculo sea real, se usan **ids de modelo fijados** (con fecha o versión) si el proveedor los ofrece, no alias que apunten a un modelo que cambia (§11.2, punto 9). Si el `modelo_respuesta` de las llamadas de producción difiere del que se observó en las llamadas de la evaluación que justifica la configuración, Administración lo avisa (informativo; R34).

**Si no gana.** La capacidad **sigue apagada** y la pestaña lo dice con las cifras; no hay «modo solo razones». Caminos: una versión nueva del prompt o de la entrada (`v2`, revisada por el `arquitecto-revisor`, con la vara de 0,10); otro modelo, el razonamiento u otro proveedor con su adaptador (cada uno con su evaluación); si la tendencia gana a la IA y al método, proponer en una ficha aparte un reparto determinista por tendencia, sin IA. Si tras tres versiones ninguna gana, la recomendación es dejar la IA apagada. Javier decide.

### 5.5 Privacidad y seguridad

1. **Clave** (§3.10): `OPENAI_API_KEY`, solo en el servidor, con `import "server-only"`. Nunca va al navegador, a la base, a un log ni a un mensaje de error. Un `401` del proveedor se informa como «clave inválida» sin eco.
2. **Guards:** todo lo de la proyección con `requirePlanner`; configuración, evaluaciones, uso y entradas con `requireAdmin` (gobiernan el gasto); el comprador recibe `403` en todo; ningún `GET` escribe ni llama al proveedor.
3. **Datos mínimos** (D12): lista blanca; `venta_lineas_ia` no lee soles, costos ni stock; ids cortos; años relativos; **alias para marcas, tiendas y términos extra, con control de salida en tiempo de ejecución** (§3.5) además de la prueba sobre el fixture (R10, R11).
4. **Traza** (D13): `ia_entradas` guarda lo enviado, inmutable y solo legible por el admin; los logs no reciben ni lo enviado ni lo recibido (R26).
5. **Inyección de instrucciones:** los únicos textos libres que viajan son nombres del árbol y de agrupaciones de marca (ya con alias); el prompt los declara datos; el modelo no tiene herramientas; su salida son cifras validadas, banderas de catálogo y texto que se pinta como texto. El peor caso, una cifra manipulada, queda acotado por la normalización a la meta y porque nadie la acepta sin verla.
6. **Límites de uso:** topes de US$ por corrida, por mes, por usuario y día y por evaluación; una corrida por proyección y una evaluación a la vez; semáforo de 3 llamadas; candado por GM; corte de circuito.
7. **Fallos del proveedor:** no tocan M7 (D15). Una corrida fallida deja intacta la propuesta vigente anterior.
8. **Modo sin IA:** falta la clave del proveedor (`OPENAI_API_KEY`), falta o no tiene adaptador `IA_PROVEEDOR`, la configuración vigente es de otro proveedor o de un modelo fuera de `IA_MODELO`, `IA_DESACTIVADA=1`, no hay configuración vigente o capacidades, la clave es inválida o se agotó el tope mensual. Las rutas IA de escritura responden `409 ia_no_disponible`; las de lectura devuelven el estado; M7 queda idéntico (R17).
9. **Del lado del proveedor: riesgos propios de OpenAI** (acciones de Javier con TIC en §6.2). Ninguna política del proveedor se afirma aquí: se verifica.
   - **Retención de datos de la organización.** Lo enviado (unidades agregadas, nombres del árbol con alias, años relativos) puede quedar retenido según la política de la cuenta. Revisar con TIC, **antes de encender**, la retención vigente, el uso para entrenamiento y si aplica o se puede pedir *zero data retention*. La minimización de D12 reduce el impacto, no lo elimina.
   - **Límite de gasto mensual del proyecto.** Los topes de la app son blandos (una falla de código o un reinicio a mitad de llamada pueden saltarlos). Fijar en la cuenta un límite del proyecto por encima de `tope_usd_mes` y **confirmar si corta las peticiones o solo avisa**; si solo avisa, los topes de la app son la única barrera: bajar `tope_usd_mes` y revisar Administración → Uso.
   - **Cuotas de uso de la cuenta** (peticiones y tokens por minuto): con cuotas bajas habrá `429` frecuentes y corridas lentas; el diseño lo absorbe (§3.8).
   - **Determinismo parcial.** Temperatura y semilla no garantizan la misma salida: dos corridas con la misma entrada pueden diferir. Por eso se guardan entrada y salida en `ia_*`, la evaluación mide la estabilidad y lo reproducible es lo que el código hace con una salida guardada (§5.3).
   - **Backtest atado a proveedor + modelo + versión de prompt** (D11, §5.4, R23): cambiar cualquiera exige una evaluación nueva. Un alias de modelo que el proveedor actualiza por debajo rompería el vínculo sin aviso: ids fijados y vigilancia de `modelo_respuesta` (R34).
   - **Cambios del proveedor:** retiro de un modelo (la IA queda apagada hasta evaluar otro), cambio de precio (se actualiza `precios` en una configuración nueva) o de API (se ajusta el adaptador; si cambia lo enviado, sube la versión de prompt).

### 5.6 Ejemplos sintéticos (fixture `tests/ia.fixture.ts`)

**A · Reparto de la meta de HOMBRE · URBANO 2027** (`g = 8 %`, `sobre_base = corregida`, `umbral_cola_larga = 100`; invierno con `φ = 0,80`). Ninguna fila tiene % propio, así que `P^GM = propuesto`.

| Fila | `B` | `B'` | `P^GM` = `propuesto` = round(`B'` × 1,08) | Estado | Aporte fijo |
|---|---|---|---|---|---|
| f1 DENIM × RECONOCIDO (todo el año) | 10 000 | 10 000 | 10 800 | libre | — |
| f2 POLO × VALOR (todo el año) | 6 000 | 6 000 | 6 480 | libre | — |
| f3 CASACA × RECONOCIDO (invierno) | 4 000 | 5 000 | 5 400 | libre | — |
| f4 BUZO × MID VALUE | 3 000 | 3 000 | 3 240 | fija_decidida (3 300) | 3 300 |
| f5 GORRO × VALOR | 80 | 80 | 86 | fija_cola_larga (86 < 100) | 86 |

- `Meta_GM = 10 800 + 6 480 + 5 400 + 3 240 + 86 = 26 006`. `Σfijas = 3 386`. `Meta_libre = 22 620`.
- El método propone 22 680 para las libres: 60 u por encima de la meta, porque f4 se decidió 60 u por encima de su propuesta. El método no cuadra la meta; la IA sí.
- Llamada **natural** (sin meta): 10 300 · 6 600 · 5 100 (Σ 22 000).
- Llamada **reparto** (con meta 22 620 y esos naturales): `meta_y1` 11 000 · 6 700 · 5 000 (Σ 22 700; desvío +0,35 %, sin aviso).
- `asignarMeta(22 620, [11 000, 6 700, 5 000])`: exactos 10 961,23 · 6 676,39 · 4 982,38; pisos 22 619; la unidad que falta va al mayor resto (f2, 0,39 frente a 0,38) → **10 961 · 6 677 · 4 982 = 22 620**; `3 386 + 22 620 = 26 006 = Meta_GM`.
- Brechas: f1 **+661 u (+6,4 %)**, f2 **+77 (+1,2 %)**, f3 **−118 (−2,3 %)**; Σ = +620 = 22 620 − 22 000. **Esfuerzo del GM: +2,8 %.**
- Frente al método: +161 · +197 · −418 (Σ −60). Orden de la tabla: f3, f2, f1.
- f3 sobre 2026 corregido: 4 982 ÷ 5 000 − 1 = **−0,4 %**; sobre 2026 real: 4 982 ÷ 4 000 − 1 = **+24,6 %**.

**B · Fijar una fila mueve las demás libres.** El planner fija f1 en 11 500 a mano.
- `Meta_libre = 26 006 − 3 386 − 11 500 = 11 120`. `asignarMeta(11 120, [6 700, 5 000])`: exactos 6 367,86 · 4 752,14; pisos 11 119; el resto a f2 → **6 368 · 4 752**. `3 386 + 11 500 + 6 368 + 4 752 = 26 006`.
- Absorbido: f2 6 368 − 6 677 = **−309 (−4,63 %)**, f3 4 752 − 4 982 = **−230 (−4,62 %)**. GM: 539 ÷ 11 659 = **4,62 %** → `al_dia` (≤ 5 %), sin `absorcion_alta`.
- Si fija f1 en 25 000: `Meta_libre = −2 380` → f2 y f3 sin cifra IA, aviso `fijadas_exceden_meta`.

**H · Absorción, `meta_movida` y `absorcion_alta`** (sobre A).
- f1 fijada en **12 000**: `Meta_libre = 10 620`; exactos 6 081,54 · 4 538,46 → **6 082 · 4 538**. Absorbido −595 (−8,91 %) y −444 (−8,91 %). GM: 1 039 ÷ 11 659 = **8,91 %** → **`meta_movida`**; ninguna fila pasa del 10 %. Desglose: `delta_meta_u = 0`, `desviacion_fijadas_u = 12 000 − 10 961 = +1 039`, `otros_u = 0`, `absorbido_u = −1 039`.
- f1 fijada en **12 500**: `Meta_libre = 10 120`; exactos 5 795,21 · 4 324,79 → **5 795 · 4 325**. Absorbido −882 (−13,21 %) y −657 (−13,19 %) → **`absorcion_alta` en las dos**.
- Si en vez de fijar f1 se **decide su 2026** y su `B'` pasa de 10 000 a 10 500 (B2): `P^GM_f1 = 11 340`, `Meta_GM = 26 546`, `Meta_libre = 23 160`. `asignarMeta(23 160, [11 000, 6 700, 5 000])`: exactos 11 222,91 · 6 835,77 · 5 101,32; pisos 23 158; +1 a f1 y +1 a f2 → **11 223 · 6 836 · 5 101**. Absorbido +262 (+2,39 %), +159 (+2,38 %), +119 (+2,39 %); GM 2,39 % → `al_dia`; `delta_meta_u = +540`. f1 muestra `base_movida` (+5 %): su peso salió de la base vieja. Por eso la pantalla recomienda decidir 2026 antes que 2027.

**I · Tiendas que entran a la base** (I5). Una fila con 2026 decidido en 7 800 (propuesta del método 8 000). Una tienda abierta en 2025 (`N(2026)`, está en `M(2027)`) vendió en esa fila 2 200 en 2026. Una tienda que cierra vendió 300 de los 6 000 vendidos a `k`.
- `aporte_salientes = round(8 000 × 300 ÷ 6 000) = 400`; `B = 7 800 + 2 200 − 400 = 9 600`; `aporte_entrantes = 9 600 − 7 800 + 400 = 2 200`.
- `B` está 23,1 % sobre lo vendido en 2026 sin que la fila crezca: señal `tiendas_entrantes` (2 200 ≥ 10 % de 9 600). Sin salientes sería `B = 10 000`, +28,2 %.

**J · Alias** (I8; nombres sintéticos). Existe la marca «MARCAX» y una tienda de código «Z901».
- La equivalencia «MARCAX SLIM» viaja como «MARCA_A SLIM»; la agrupación de marca «MARCAX» como «MARCA_A». El diccionario guarda `MARCA_A → { tipo: marca, id }`.
- El modelo responde «MARCA_A SLIM rebota con la base corregida»; se guarda y se muestra «MARCAX SLIM rebota con la base corregida».
- «MARCAXL» no es la palabra «MARCAX»: no se reemplaza ni bloquea.
- Si un nombre de línea fuera «LINEA Z901» y el alias fallara, el control final encuentra «Z901» y el GM queda `bloqueado_privacidad`, sin llamada.

**D · Métricas de un pliegue `D25`** (un GM, tres filas libres; meta oráculo 1 800; `B^s` 900 · 520 · 280, Σ 1 700; tendencias +2 %, +10 %, −10 %).
- Real: 1 000 · 500 · 300.
- Reparto del método parejo: `repartirEntero(1 800, [900, 520, 280])` = 953 · 551 · 296 → `WAPE_M = 102 ÷ 1 800 = 5,67 %`.
- Reparto de tendencia: pesos 918 · 572 · 252 → 949 · 591 · 260 → `WAPE_T = 182 ÷ 1 800 = 10,11 %`.
- IA: 1 040 · 470 · 290 → `WAPE_IA = 80 ÷ 1 800 = 4,44 %`. Rival: el método. Mejora `1 − 80 ÷ 102` = **21,6 %**. `EAT_reparto`: 2,83 pp el método y 2,22 pp la IA.
- Natural: parejo con `g_real = 1 800 ÷ 1 700 − 1` → 952,9 · 550,6 · 296,5 → 5,62 %; tendencia 918 · 572 · 252 → 11,22 %; natural IA 980 · 520 · 290 → 50 ÷ 1 800 = **2,78 %** ≤ 5,62 % ✓.

**F · Resto.** El Resto se aprobó con 5 % sobre corregida. NIÑO · URBANO tiene libres con `B'` 1 000 y 500 → `Meta_GM = 1 050 + 525 = 1 575`; NIÑA · CASUAL, una fila con `B'` 801 → `round(841,05) = 841`. Cada GM se reparte por separado.

**G · Costo de una llamada.** Precios **sintéticos** (no son de ningún proveedor) `{ entrada: 2, entrada_cache: 0,5, salida: 8 }` por millón. Uso: 4 200 tokens de entrada, 5 400 de entrada servida desde caché y 1 900 de salida → `(4 200 × 2 + 5 400 × 0,5 + 1 900 × 8) ÷ 10⁶ = 0,0084 + 0,0027 + 0,0152 = US$ 0,0263`. Sin caché, los mismos 9 600 tokens de entrada costarían `(9 600 × 2 + 1 900 × 8) ÷ 10⁶ = US$ 0,0344`.

### 5.7 Reglas que el código garantiza (cada una con su prueba vitest)

Las pruebas **nunca llaman al proveedor real**: `tests/ia.proveedor-falso.ts` implementa `ProveedorIA` con respuestas guionadas (válida, JSON inválido, faltan filas, sobran filas, suma desviada un 20 %, `429` con `retry-after`, sobrecarga tres veces, tiempo agotado, corte por límite de salida, negativa, `401`; con el uso y el `fin` neutros de §3.11); vitest instala un `fetch` que **lanza** ante cualquier URL de `openai.com` o de `anthropic.com`; una prueba estática exige que ningún archivo de `tests/` lea `OPENAI_API_KEY` ni `ANTHROPIC_API_KEY`, y que solo `tests/ia.proveedor-openai.test.ts` importe `proveedor-openai`, inyectándole una clave ficticia y un `fetch` o cliente falso (R35).

| # | Regla | Dónde |
|---|---|---|
| R1 | `asignarMeta`: `Σ A = Meta_libre` y `A ≥ 0` para cualquier conjunto de pesos (propiedad, 1 000 casos con semilla); empate al primero por `clave`; **un peso nulo toma `P^GM` y nunca da `A = 0` por ser nulo** (I3); cadena modelo → `P^GM` → natural → `B^s` → parejo. | `meta.ts` |
| R2 | `metaDeGM`: `P^GM = propuesto` sin % propio y la fórmula con % propio; con `bruta` usa `B` y con `corregida` `B'`; filas con `propuesto` nulo fuera (`fuera_base`). Sin filas apartadas ni % propio, `Meta_GM = Σ P^M` **exacto**, incluidas filas con `B'` de fracción ,5 (rev. M3). | `proyeccion/meta-gm.ts` |
| R3 | Clasificación en el orden de §5.1; con `incluir_cola_larga`, la cola larga es libre; `revision_cola_larga` es libre. | `meta.ts` |
| R4 | Ejemplo A exacto (26 006 / 3 386 / 22 620 → 10 961 · 6 677 · 4 982; brechas; esfuerzo +2,82 %; orden por `|contra_metodo_u|`). | `meta.ts` |
| R5 | Ejemplo B exacto (6 368 · 4 752; absorbido −309 / −230; 4,62 %). `Meta_libre < 0` → `null` y `fijadas_exceden_meta`. | `meta.ts`, `absorcion.ts` |
| R6 | Resto (ejemplo F); Resto provisional → `meta_provisional`; sin `g` → sin reparto. | `meta.ts` |
| R7 | Absorción (ejemplo H): `meta_movida` en 5,01 % sí y 4,99 % no; `absorcion_alta` en 10,01 % sí y 9,99 % no; la identidad del desglose; **aceptar la IA a su cifra vigente deja `absorbido_u` igual**; el resultado no depende del orden en que se fijaron las filas (propiedad). | `absorcion.ts` |
| R8 | Aportes (ejemplo I): `entrantes − salientes = B − vigente_Y` en todo el fixture; señal `tiendas_entrantes` desde el 10 %. | `aportes.ts` |
| R9 | `validarSalida` natural, reparto y líneas: cada fila de §5.2 (duplicado, faltan ≤ 5 % / > 5 %, sobra, fija, cifra excesiva, desvío 3 % / 15 % contra `del_lote`, bandera desconocida, razón con control, ancho cero, LRM, RLM y 400 caracteres). | `validar.ts` |
| R10 | Lista blanca: sobre el fixture, ningún uuid, año real (ni en claves ni en textos), código o nombre de tienda o marca del fixture, ni las claves `soles`, `costo`, `stock`, `tienda`, `email`, `marca`, `clave`; ids `f…`/`l…`/`e…`; meses enteros; ningún periodo posterior al corte (propiedad con cortes aleatorios). **El bloque natural no contiene `meta`, `pct`, `propuesta` ni ninguna cifra que dependa de `g`** (propiedad: cambiar `g` no cambia el bloque). La cola larga no viaja. | `entrada.ts` |
| R11 | Alias y control de salida (ejemplo J): coincidencia por palabra completa y por secuencia; alias estables en la corrida; restitución en las tres razones; un término que sobrevive → `bloqueado_privacidad` y **0 llamadas** al proveedor falso. | `alias.ts` |
| R12 | Huellas: mismo objeto con claves en otro orden → misma huella; cambiar una unidad, el proveedor, el modelo o el prompt la cambia. **`huella_historia` no cambia al decidir, aceptar IA, poner % propio ni pasar una fila de libre a fija** (revisión B1); sí al cambiar `historico`, `curva_origen`, `factores_mes` o el conjunto de filas activas. | `huellas.ts` |
| R13 | `estadoPropuestaGM`: cada estado y motivo de §5.3, en su orden; `base_movida` en 2 %; `filas_libres_nuevas` en 5 %. | `estado.ts` |
| R14 | Costo con tres precios `{ entrada, entrada_cache, salida }`: ejemplo G (0,0263 y 0,0344 sin caché); la estimación nunca queda por debajo del uso del proveedor falso; topes de corrida, mes y usuario-día: no arranca y se detiene antes de la llamada que los pasaría. | `costo.ts`, `servicio.ts` |
| R15 | Pasos: cada `POST` hace a lo sumo **una** llamada; `429` → `esperar` sin gastar intento y **sin contar para el corte de circuito**; 10 esperas seguidas → `detenida` (`limite_proveedor`); sobrecarga o `5xx` × 3 → GM `fallido`; `401` → `clave_invalida` y `detenida`; `fin = limite_salida` → el lote se parte; inválida dos veces → `fallido`; 3 GM fallidos por el proveedor seguidos → `detenida` (`proveedor_inestable`). Dos `POST` simultáneos al mismo GM → uno `409 gm_en_proceso` y **una sola** llamada registrada; un candado vencido se puede retomar. | `servicio-pasos.ts` |
| R16 | `registrar_propuesta_ia_gm` (humo SQL): con token equivocado (`IA001`) o corrida terminada (`IA002`) rechaza sin insertar nada; un error a mitad (p. ej. dos filas con la misma `fila_clave`) no deja propuesta parcial; el GM queda `hecho` con `propuesta_gm_id` y `huella_gm`; `proveedor`, `modelo` y `version_prompt` salen de la corrida aunque el payload traiga otros; reuso con una propuesta de otro GM → `IA003`; reuso válido → `reusado` sin filas nuevas. | SQL |
| R17 | Modo sin IA: sin clave, sin `IA_PROVEEDOR` o con uno sin adaptador, con la vigente de otro proveedor o de un modelo fuera de `IA_MODELO`, con `IA_DESACTIVADA=1`, sin configuración o sin capacidades → `409 ia_no_disponible` con su motivo. **Las pruebas de M7 existentes pasan sin cambios con la IA apagada.** | `servicio.ts`, rutas |
| R18 | Permisos: el comprador recibe `403` en §3.1 y §3.2; el planner `403` en §3.2; sin sesión, `401`. | rutas |
| R19 | Inmutabilidad (`scripts/humo-0030.sql`): `UPDATE`, `DELETE` y `TRUNCATE` sobre las cuatro tablas inmutables fallan también con `service_role`; poner en `NULL` una FK `set null` funciona; una evaluación `completa`, una corrida terminal y un GM `hecho` no se reescriben **ni se borran**; el `check` de `decision_ia_fila_id` falla con `origen ≠ 'manual'` **y con `origen` nulo**; dos configuraciones con la misma `version` fallan; dos filas de propuesta con la misma `(propuesta_gm_id, fila_clave)` fallan; insertar una configuración, evaluación, corrida o propuesta sin `proveedor` falla. La `0030` aplica dos veces. `anon` no lee las tablas ni ejecuta las funciones. | SQL |
| R20 | Una corrida en curso por proyección (`409 corrida_en_curso`); la que lleva 30 min sin actividad pasa a `abandonada`; una evaluación a la vez; más de 3 evaluaciones en el mes → `409`; gasto del usuario en el día por encima del tope → `409 tope_dia`. | `servicio.ts` |
| R21 | Aceptar IA: escribe `decidido` = `A_f` de hoy, `origen = manual` y `decision_ia_fila_id`; `valor_esperado` distinto → `409 ia_valor_cambio` con `valor_actual` y nada escrito; `propuesta_fila_id` de otra fila → `409 ia_fila_ajena`; además `ia_desactualizada`, `ia_no_vigente`, `fila_no_libre`, `anio_no_admitido`. Otra decisión vuelve la columna `null`; `calcular` y `copiar_de` la conservan. Tras aceptar, `Σfijas + Σ A = Meta_GM`. | `servicio.ts`, `servicio-edicion.ts` |
| R22 | Evaluación: ejemplo D exacto (rival = método, mejora 21,6 %, natural 2,78 %); el bootstrap con la semilla da el mismo percentil dos veces; el veredicto falla por cada condición por separado (mejora 4,9 % con `MEJORA_MIN` 0,05 y 9,9 % con 0,10; percentil ≤ 0; gana en menos de la mitad de los GM; un género 11 % peor; natural peor que un rival; `D24` 11 % peor; cobertura 97 %; estabilidad 6 %); con menos de 50 filas, `sin_dato`; `MEJORA_MIN` sube a 0,10 desde la segunda versión de prompt evaluada; **ningún paso de evaluación reusa** (el proveedor falso cuenta las llamadas); un pliegue no ve meses posteriores al corte. | `evaluacion.ts`, `servicio-evaluacion.ts` |
| R23 | Encendido: `POST /api/ia/configuracion` con capacidad sin evaluación, de otro proveedor, modelo o prompt, o `no_gana` → `409`; con un modelo fuera de `IA_MODELO` → `409 modelo_no_permitido`; sin `IA_PROVEEDOR` → `409 sin_proveedor`; con `gana` → `201` y `proveedor = IA_PROVEEDOR`. La huella del texto de cada prompt publicado está fijada. | ruta, `prompt/*.ts` |
| R24 | M7 no depende de la IA: `calcular`, `cerrar`, `matriz`, `mensual` y `cerrada` **no importan nada de `src/lib/ia/`** (la Matriz usa `proyeccion/meta-gm.ts`) ni leen tablas `ia_*` (estático). `GET /api/proyeccion/cerrada` devuelve lo mismo con y sin tablas `ia_*` llenas. | estático, `proyeccion.*` |
| R25 | Estático: solo `proveedor-openai.ts` importa el SDK de OpenAI (si se usa) y nombra `OPENAI_API_KEY`; ningún archivo importa `@anthropic-ai/sdk` ni nombra `ANTHROPIC_API_KEY` en `0.15.0`; solo `entorno.ts` lee `IA_PROVEEDOR`, `IA_MODELO` e `IA_DESACTIVADA`; ningún id de modelo ni precio de proveedor aparece como literal en `src/` (lista de patrones de la prueba); ningún `NEXT_PUBLIC_*` de la IA; ningún componente cliente importa `src/lib/ia/proveedor*`, `servicio*` ni `consultas`; solo `consultas.ts` nombra `venta_lineas_ia`, `registrar_propuesta_ia_gm` y las tablas `ia_*`; toda ruta bajo `/api/ia` usa `requireAdmin` y toda ruta `…/ia` de la proyección `requirePlanner`. | estático |
| R26 | Sin datos en los logs: `src/lib/ia/` no tiene `console.*` salvo `registro.ts`, que solo acepta `{ corrida_id, llamada_id, gm_clave, paso, estado, tokens, costo, duracion_ms, error_codigo }`. La única columna con lo enviado es `ia_entradas.contenido_gz` (prueba sobre `database.types.ts`). | estático |
| R27 | La razón se pinta como texto: sin `dangerouslySetInnerHTML` ni intérprete de markdown; una razón con `<script>` se muestra literal. | pantallas |
| R28 | Modo jerárquico: con 61 filas, plan `n1, n2, l, r1, r2`; lotes de líneas completas de ≤ 60; `Σ` sub-metas = `Meta_libre`; al leer, `asignarMeta` sobre el GM entero da `Σ = Meta_libre`. | `entrada.ts`, `meta.ts` |
| R29 | Reuso en producción: misma `huella_gm` (con proveedor, modelo y prompt) → `reusado` sin llamadas, salvo `regenerar`; con `regenerar`, la nueva es la vigente y la anterior queda en `anteriores`. | `servicio-pasos.ts` |
| R30 | `datos_cambiaron`: si `proyecciones.calculado_at` cambia a mitad, el paso siguiente da `409` y la corrida pasa a `parcial`; lo hecho queda. | `servicio-pasos.ts` |
| R31 | Matriz: `meta_siguiente.desvio_u = Σ V − Meta_GM`; con todas las libres aceptadas a su cifra vigente, 0; Excel con las dos columnas. | `matriz.ts`, `excel.ts` |
| R32 | Prompt: `v1` contiene las reglas de §3.7 (rol sin empresa, años relativos, `B = cierre + entrantes − salientes`, `A+1` normal, alias y nombres como datos, solo JSON) y ningún término de una lista de prohibidos de la prueba (sin datos reales; tampoco nombres de proveedor ni de modelo: `openai`, `gpt`, `anthropic`, `claude`). | `prompt/v1.ts` |
| R34 | Modelo efectivo: si alguna llamada de producción de la configuración vigente trae un `modelo_respuesta` distinto de los observados en las llamadas `ok` de su evaluación, `GET /api/ia/configuracion` lo marca (aviso informativo, no apaga). | `servicio.ts` |
| R35 | Adaptador OpenAI, sin red (clave ficticia y `fetch` o cliente falso con respuestas tomadas de la documentación verificada en §11.2): traduce el uso a `{ entrada, entrada_cache, salida }` disjuntos, el motivo de fin a `fin`, `429` con espera, `401`/`403`, `400`, 5xx, tiempo agotado y negativa a los errores o estados tipados; omite lo que el modelo no admite; ningún mensaje de error contiene la clave ni lo enviado. | `proveedor-openai.ts` |
| R33 | Contadores derivados: `CorridaApi.costo_usd` = `Σ ia_llamadas.costo_usd` de la corrida y los `gm_*` = cuentas de `ia_corrida_gms`, también con pasos concurrentes (no hay columnas de contador). | `consultas.ts`, `servicio.ts` |

### 5.8 Casos borde

| Caso | Comportamiento |
|---|---|
| GM sin filas libres | No se llama: `sin_filas_libres`. |
| GM de 1 fila libre | `A = Meta_libre` sin importar el peso; la IA aporta natural, brecha y razón. |
| Natural 0 y meta > 0 | `brecha_pct` nula, `brecha_u = A`; bandera `en_salida`; aviso `brecha_extrema`. El planner decide. |
| Fila con venta reciente | Señales `linea_nueva` y `dato_insuficiente`; la IA debe acercarse a la base. Entra en la meta (D18). |
| Línea o marca nueva de 2027 sin venta | No tiene fila en M7: fuera de la meta y de la IA (decisión 4 de Javier). |
| Fila con quiebres fuertes | Señal `quiebres`; la IA puede proponer por encima de lo vendido y lo explica. |
| Línea de invierno (Niño 2026) | La meta se calcula sobre `B'`; la razón dice «sobre 2026 corregido». |
| Versión `bruta` en un GM sin Niño material (06e D8) | `B^s = B`; todo igual. Con Niño material y `bruta`: aviso `reaprobar_pendiente`. |
| 2027 marcado atípico · factor de 2026 no confirmado | No se puede generar (`anio_siguiente_atipico`, `factor_y`). |
| Poco avance (enero a abril) | Señales `avance_bajo` / `plan_anterior`. La evaluación solo mide cortes de diciembre: el informe lo rotula como límite. |
| Proyección sin crecimientos aprobados | Sin meta (`sin_meta`); el Resto usa el provisional, con aviso. |
| Tienda abierta en 2025 | Ya está en `B` (`aporte_entrantes`): la meta la incluye. Una abierta durante 2026 o en 2027, no (D5). |
| Nodo que pasa de GML a GMLE entre corridas | Las filas cambian de clave: las nuevas son libres sin cifra IA (`P^GM`); con más del 5 %, `desactualizada`. |
| Decidir 2026 después de aceptar 2027 en el mismo GM | La meta se mueve; la fila aceptada queda fija y la diferencia cae en las libres restantes (absorción) o, si no quedan, en el cuadre de la Matriz. |
| Dos planners aceptando filas del mismo GM | `valor_esperado` protege a cada uno de su vista vieja; aun así el resultado puede desviarse unas unidades de la meta, y el cuadre lo muestra. No se bloquea. |
| Cerrar con filas libres sin decidir | No se puede: `409 filas_sin_decidir` (regla 37). La IA no cambia eso. |
| Navegador reintenta mientras el servidor sigue llamando | `409 gm_en_proceso`; no hay doble gasto. |
| El servidor se reinicia a mitad de un paso | El candado vence a los 300 s y el paso se repite. La llamada en vuelo pudo cobrarse sin quedar en `ia_llamadas`: el gasto de la app la subestima; lo cubre el límite de gasto de la cuenta del proveedor si corta (§5.5.9). |
| Proveedor caído toda la corrida | Corte de circuito tras 3 GM fallidos; M7 normal. |
| Proveedor limitando (429 seguidos) | `detenida` (`limite_proveedor`); una corrida nueva de «pendientes» reusa lo hecho. |
| Equivalencia que se llama igual que una marca | Viaja entera como alias («MARCA_A»); el modelo pierde el nombre, no la historia. |
| Término prohibido que sobrevive al alias | El GM no se envía (`bloqueado_privacidad`); el admin ve el aviso. |
| Cambio de proveedor o de modelo | La configuración nueva necesita su evaluación ganadora; hasta entonces la capacidad no se enciende con ella. Las propuestas existentes quedan con `configuracion_cambiada` (informativo) y siguen aceptables mientras la capacidad vigente siga encendida; la próxima corrida no las reusa (otra `huella_gm`). |
| Se cambia `IA_MODELO` o `IA_PROVEEDOR` en Railway y la vigente queda fuera | El servicio se apaga (`modelo_no_permitido` / `proveedor_distinto`) en vez de llamar con un modelo no evaluado; M7 sigue igual. |
| El proveedor retira el modelo evaluado | Las llamadas fallan con `400`/no encontrado (GM `fallido`); el admin evalúa otro modelo. |

## 6. Criterios de aceptación / hito de prueba

### 6.1 Verificación previa (tanda 1, `datos`; SOLO `SELECT` en `vector-two`, nunca en `lukers-compras`; se repite justo antes de desplegar)

El revisor ya midió lo que se cita en el encabezado sobre la proyección de método 3. Falta, con la proyección **recalculada con el método 5** (si aún no existe, se mide en cuanto Javier recalcule y, hasta entonces, valen las cifras del revisor):
1. `proyecciones` en trabajo, con `resumen->>'version_metodo'` y `calculado_at`.
2. Por GM: filas base de 2027 activas por estado (§5.1) y sus unidades; **total de filas libres**, máximo por GM y **máximo de filas libres por línea** (¿alguna línea pasa de 60?). Con eso, lotes y llamadas por corrida.
3. Crecimientos vigentes de 2027 por GM con `sobre_base`, el Resto (¿aprobado?), las versiones `bruta` en GM con Niño material (`reaprobar`) y el estado de los factores de 2026.
4. Pliegues: meses publicados; para `D24`, cómo se calcularon los factores de 2023 y si se arma la proyección con corte 2023-12; filas libres de `D25` y `D24` (≥ 50).
5. Coincidencias de nombres de marca, de tienda (nombre y código) en **líneas, equivalencias y agrupaciones de marca** (el revisor midió 196 equivalencias), y cuántos términos tienen uno o dos caracteres (riesgo de falsos positivos).
6. `venta_lineas_ia` (después de aplicar la `0030`) para el GM más grande: dos pasadas con `explain (analyze, buffers)`, tiempo y tamaño (≤ 1 s, ≤ 500 KB).
7. Tamaño total de `historico` de la proyección y tiempo de leerlo (para la caché de `huella_historia`).
8. `humo-0030.sql` en verde (R16, R19): dos aplicaciones, permisos de `anon` y `authenticated`, una sola configuración vigente, una corrida en curso por proyección, candado y función transaccional.

Con 2 y 5, `datos` entrega las cifras a `backend` y al `documentador`. En la tanda 2, `backend` hace un **ensayo en seco** (arma y mide los bloques reales sin enviarlos), rehace la tabla de §3.9 y la anota en el CHANGELOG.

### 6.2 Precondiciones del hito

- `0.14.0` desplegada; la proyección recalculada con el método 5; factores de 2026 al día y confirmados.
- Crecimientos de 2027 aprobados «sobre 2026 corregido» (06e), el Resto aprobado y sin `reaprobar` pendiente.
- La `0030` aplicada y `0.15.0` desplegada **con la IA apagada**.
- Un usuario admin, un planner y un comprador de prueba.
- **Acciones de Javier fuera del código** (decisión 7):
  1. con TIC, obtener una **clave de OpenAI dedicada a Vector2** (en un proyecto propio de la cuenta, si la cuenta lo permite), no compartida con otros usos;
  2. poner en el servicio de Railway `OPENAI_API_KEY` como variable secreta, `IA_PROVEEDOR=openai` e `IA_MODELO` con los modelos candidatos (**la clave nunca en el chat ni en un archivo del repo**);
  3. fijar en la cuenta un **límite de gasto mensual** del proyecto por encima del tope de la app (p. ej. US$ 80 para 60) y **confirmar si corta las peticiones o solo avisa** (§5.5.9);
  4. conocer las **cuotas de uso** de la cuenta: con cuotas bajas habrá `429` frecuentes y corridas más lentas;
  5. revisar con TIC la **retención de datos** de la organización (y si aplica *zero data retention*) **antes de encender**;
  6. en Administración → Motor de IA, escribir en «términos que nunca salen» el nombre de la empresa y cualquier otro que quiera proteger.

### 6.3 Hito (Javier y Cowork)

1. **Sin clave:** con `OPENAI_API_KEY` ausente (o sin `IA_PROVEEDOR`, o con `IA_DESACTIVADA=1`), la pestaña dice el motivo («falta la clave en el servidor», «sin proveedor configurado»), y Por línea, la Matriz, la Mensual y cerrar funcionan exactamente igual que en `0.14.0`. La Matriz ya muestra «Meta 2027» y «Desvío frente a la meta» por GM.
2. **[ESCRIBE] Configuración:** como admin, crear la versión 1 con OpenAI (proveedor en solo lectura) y el primer modelo de `IA_MODELO`, prompt `v1`, sin capacidades, precios vigentes copiados de la página del proveedor, topes por defecto y los términos extra. Un modelo fuera de `IA_MODELO` se rechaza. Intentar encender la capacidad sin evaluación → rechazo con el motivo. El planner no ve Administración y recibe `403` en `/api/ia/configuracion`.
3. **[ESCRIBE] Evaluación:** «Nueva evaluación» con ese modelo y `v1`; revisar la estimación (≈ 1,9 M tokens de entrada y 0,42 M de salida, en US$ con los precios cargados) y confirmar. Ver «preparando D25…», el progreso y el informe: WAPE del método, de tendencia y de la IA, rival, mejora, IC 90 %, GM ganados, por género, natural, `D24`, estabilidad, cobertura, veredicto, costo real frente al estimado e intento n.º. Repetir con los otros modelos candidatos si Javier quiere comparar.
4. **Si gana:** guardar la versión 2 con esa evaluación y la capacidad. **Si no gana:** el hito termina aquí con el informe; la IA queda apagada y M7 sigue igual (criterio cumplido: «no se enciende sin ganar»).
5. **[ESCRIBE] Generar:** como planner, «Generar propuesta IA» → estimación → confirmar. Ver el progreso por pasos (y «esperando al proveedor» si hay 429). Al terminar, la tabla de GM con meta, esfuerzo, filas forzadas y «2026 sin decidir». En Administración → Uso, la corrida con tokens (entrada, entrada en caché, salida), costo, proveedor, modelo, prompt y huellas, y «Ver entrada» de una llamada: **los nombres de marca aparecen como alias y no hay ningún año real**.
6. **Cuadre y lectura:** en un GM de HOMBRE con una fila decidida, comprobar con §5.1 que `Σ fijas + Σ IA con meta = Meta_GM` y que la meta es `Σ propuesta del método`. Leer cinco razones (natural y reparto): ¿citan una cifra, tienen sentido y muestran los nombres reales?
7. **[ESCRIBE] Aceptar:** en Por línea, con «Ver IA», aceptar la cifra IA de una fila de 2027. Queda decidida con el badge «IA» y los meses salen de la curva. Las demás libres del GM **no** cambian (absorbido igual).
8. **[ESCRIBE] Fijar a mano y absorción:** fijar otra fila del mismo GM bastante por encima de su cifra IA. Las libres se reajustan, la columna «Absorbido» lo muestra, el GM pasa a «meta movida» si pasa del 5 % y las filas avisan si pasan del 10 %. Con la pantalla abierta en otra pestaña sin refrescar, intentar «Aceptar IA» en una libre → «la cifra IA cambió», y aceptar la nueva.
9. **[ESCRIBE] 2026 primero:** decidir el 2026 de una fila libre del GM y ver cómo cambia la meta en unidades y lo absorbido; «Volver a la propuesta» en la fila aceptada quita el badge.
10. **Desactualización:** aprobar una curva o publicar un mes y recalcular. Los GM afectados quedan «desactualizada: la historia cambió», «Aceptar IA» se deshabilita, y «Regenerar» ese GM vuelve a «al día» (centavos). Recalcular sin cambiar nada deja todo «al día» y la siguiente corrida reusa sin llamar.
11. **Cerrar:** cerrar (o dejarlo descrito). Exige decidir las filas libres como siempre; no pide nada de la IA; la cerrada no cambia al regenerar; en M8 el flujo da las mismas cifras.
12. **Comprador:** no ve la pestaña ni la administración; `403` en `/api/proyeccion/proyecciones/<id>/ia` y en `/api/ia/uso`.
13. Pasan `lint`, `tsc`, `vitest` y `build`; la `0030` corre dos veces, el humo está en verde y `APP_VERSION = "0.15.0 · M7"`.

## 7. Fuera de alcance

- **Sublíneas y cierre del año en curso por la IA**: segunda entrega `0.15.1` (§10).
- **Líneas o marcas nuevas de 2027** sin venta: fuera de la meta y de la IA; se trabajan aparte (decisión 4 de Javier).
- La IA para **aperturas y cierres** de tienda (07d) y para **la meta misma**: el % lo aprueba Javier en Curvas.
- **Mover esfuerzo entre GM** (D6).
- **Exigir el cuadre al cerrar** (D19): si el hito muestra que hace falta, es una regla nueva de M7 con su ficha.
- **Aceptar en bloque**: contradice la decisión del 2026-10-15.
- La **API de lotes asíncronos**, corridas nocturnas o regeneración automática. Una corrida siempre la pide una persona y confirma su costo.
- Chat o preguntas libres al modelo; herramientas del modelo; ajuste fino.
- La IA en M6, M8, M12 o M13.
- Guardar la respuesta cruda; enviar soles, costos, stock en unidades, tiendas, marcas o años reales (D12).
- Que el sistema elija el modelo solo.
- **El adaptador de Claude** (`proveedor-anthropic.ts`): cuando TIC entregue la API, con su propia evaluación ganadora (decisión 74). Tampoco usar dos proveedores a la vez ni repartir llamadas entre ellos.
- Caché explícita del proveedor (puntos de caché marcados por el código).

## Plan de tandas (sin pisarse)

**Regla:** cada archivo tiene **un solo dueño en cada tanda**; un traspaso solo ocurre entre tandas y queda escrito aquí. Lo que la tanda 1 añade a tipos existentes es opcional o nuevo, para que `lint`, `tsc` y `vitest` pasen en cada commit.

**Orden:** después de `0.14.0 · M6` desplegada. La `0030` es inocua para `0.14.x` y puede aplicarse antes.

### Tanda 1 (dos en paralelo)

**Datos** (`datos`), archivos exclusivos:
- `supabase/migrations/0030_propuesta_ia.sql`, `scripts/humo-0030.sql`, `src/lib/supabase/database.types.ts` (regenerado).
- Mediciones de §6.1, **solo `SELECT`** (1 a 5 y 7 antes de aplicar; 6 y 8 después); aplicar la `0030` en `vector-two`.
- Entregar las cifras a `backend` y al `documentador`.

**Backend · lógica pura** (`backend`), archivos exclusivos:
- `src/lib/ia/{tipos,tipos-api,esquemas,canonico,meta,absorcion,aportes,alias,validar,entrada,huellas,estado,costo,evaluacion,excel}.ts`.
- `src/lib/ia/prompt/{index,v1}.ts`.
- `src/lib/ia/proveedor.ts`: solo la interfaz `ProveedorIA`, tipos de petición y respuesta (uso de tokens neutro, `fin`, `id_solicitud`, `esperar_ms`) y errores tipados. Sin SDK (§3.11).
- **`src/lib/proyeccion/meta-gm.ts`** (nuevo; `metaDeGM`). Es el único archivo de `src/lib/proyeccion/` que toca esta tanda.
- `vitest.config.ts` (el `setupFiles` que bloquea `fetch` a `openai.com` y a `anthropic.com`).
- Pruebas: `tests/ia.{meta,absorcion,aportes,alias,validar,entrada,huellas,estado,costo,evaluacion,esquemas,prompt}.test.ts`, `tests/proyeccion.meta-gm.test.ts`, `tests/ia.fixture.ts`, `tests/ia.proveedor-falso.ts`, `tests/setup-sin-red.ts` (R1 a R14, R22 puro, R28 puro, R32).
- Al cerrar la tanda quedan **congelados** `src/lib/ia/{tipos-api,meta,absorcion}.ts` y `src/lib/proyeccion/meta-gm.ts`: en la tanda 2 se importan y nadie los cambia.

### Tanda 1b (`backend`, sola, antes de la tanda 2): ajuste por el cambio de proveedor

La tanda 1 se escribió con Anthropic en mente. Esta tanda aplica §11.3 sobre esos archivos (único dueño: `backend`; **descongela puntualmente** `tipos-api.ts` solo en los tipos de proveedor, precios, uso y motivos; `meta.ts`, `absorcion.ts` y `meta-gm.ts` no se tocan). Tiene que pasar `lint`, `tsc` y `vitest` antes de abrir la tanda 2.

### Tanda 2 (cuatro en paralelo)

**Backend A · servicio IA y rutas** (`backend`):
- `package.json` y `package-lock.json` (SDK de OpenAI con versión fija, si se usa; §3.10), `.env.local.example`.
- **Antes de escribir el adaptador:** los puntos de §11.2 verificados en la documentación vigente de OpenAI y anotados en la ficha.
- `src/lib/ia/{proveedor-openai,proveedores,entorno,consultas,servicio,servicio-pasos,servicio-evaluacion,limites,registro}.ts`.
- `src/app/api/proyeccion/proyecciones/[id]/ia/**` y `src/app/api/ia/**`.
- Lee M7 solo por sus funciones exportadas (`cargarContextoCalculo`, lectores de `proyeccion/consultas.ts`, `calcularProyeccion`, `aporteSaliente`, `bloqueosNinoDeCierre`) **sin modificar archivos de `src/lib/proyeccion/`**. La aceptación llama a `decidirFila` con el parámetro nuevo (contrato abajo).
- Ensayo en seco de §6.1 y tabla de costo.
- Pruebas: `tests/ia.{servicio,pasos,rutas,evaluacion-servicio,estatico,proveedor-openai}.test.ts` y `tests/ia.fake-db.ts` (R14 a R18, R20, R21 de servicio, R23, R25, R26, R29, R30, R33, R34, R35).

**Backend B · integración en M7** (`backend`):
- `src/lib/proyeccion/{servicio-edicion,persistencia,servicio-lectura,servicio,tipos-api,matriz,excel}.ts`: `decidirFila` con `opciones.decision_ia_fila_id`; `copiar_de` copia la columna; `AnioFilaApi.decision_ia`; `meta_siguiente` en la Matriz y su Excel (importa `meta-gm.ts`).
- Pruebas: `tests/proyeccion.{ia-decision,matriz,persistencia,estatico}.test.ts` y los fixtures de M7 que lo necesiten (R21 de edición, R24, R31).
- **Contrato con Backend A**, fijado aquí: `decidirFila(id, filaId, anio, cuerpo, actor, opciones?: { decision_ia_fila_id?: string })`.

**Frontend A · pestaña Propuesta IA y administración** (`frontend`):
- `src/app/(app)/planificacion/proyeccion/{propuesta-ia-tab,propuesta-ia-vista,gm-ia-detalle,generar-ia-modal,use-propuesta-ia}.tsx/ts` (nuevos).
- `vista.ts` (solo `PESTANAS`) y `proyeccion-panel.tsx`.
- `src/app/(app)/administracion/ia/**` y `src/lib/nav.ts`.
- Pruebas: `tests/ia.pantalla-{vista,render}.test.ts` y `tests/ia.pantalla.fixture.ts` (R27 de la pestaña).

**Frontend B · Por línea, detalle y Matriz** (`frontend`):
- `src/app/(app)/planificacion/proyeccion/{linea-tab,tabla-filas,celda-decision,detalle-fila,bloque-decision,matriz-tab,descarga-libro}.tsx/ts`.
- Nuevos: `columnas-ia.tsx` y `use-ia-filas.ts`.
- **No toca** `vista.ts` ni `proyeccion-panel.tsx`.
- Pruebas: `tests/proyeccion.{ia-columnas,pantalla.estatico}.test.ts` (R27 de Por línea y detalle).

### Tanda 3

1. `qa`: lint, tsc, vitest, build, revisión del diff y recorrido en Chromium con la IA apagada y con el proveedor falso inyectado en local. **Nunca contra el proveedor real.**
2. `seguridad` (sonnet, solo lectura): clave (`OPENAI_API_KEY`) solo en el servidor y solo en el adaptador; ningún id de modelo ni precio en el código; lista blanca, alias y control de salida (R10, R11); guards; inmutabilidad, `TRUNCATE` y permisos de la `0030`; `venta_lineas_ia` sin columnas de dinero; candado y función transaccional; logs; XSS de la razón; topes.
3. `documentador`: `CHANGELOG.md` (tabla de costo medida, cómo poner la clave en Railway sin pegarla en un chat, las acciones de Javier de §6.2 y que la IA se despliega apagada); `docs/PLAN.md` (con la alineación de versiones, §8 propuesta 9), `docs/DECISIONES.md` (§8), esta ficha y la sección nueva de `docs/pruebas/cowork-checklist.md`; `src/lib/version.ts` = `0.15.0 · M7`.
4. Despliegue con la IA apagada.

### Tanda 4 (con Javier, en producción)

Javier hace con TIC las acciones de §6.2 (clave dedicada, límite de gasto, retención) y pone las variables en Railway. Después, pasos 2 a 4 del hito y el resto solo si la capacidad gana. El informe de la evaluación se anota en el CHANGELOG (cifras agregadas, sin nombres).

## 8. Propuestas para `docs/DECISIONES.md`

1. **La IA es una fuente más de la cifra decidida, no la propuesta.** M7 conserva la propuesta del método; las filas libres se siguen decidiendo a mano para cerrar (regla 37) y solo la cola larga se cierra sola. La IA muestra natural, cifra con meta, absorbido y brecha con su razón; «Aceptar IA» es una decisión manual con traza (`decision_ia_fila_id`), una fila a la vez, con la cifra que el planner vio. M8 no cambia.
2. **(Matiza 07c, 2026-10-16.)** Dentro de un GM, el método sigue haciendo crecer a todas las filas el mismo %. La IA puede proponer crecimientos distintos por fila, siempre que las libres sumen exactamente la meta del GM (`Σ propuesta del método`, o la fórmula para las filas con % propio). Fijas: decididas, con % propio y cola larga. Aperturas, cierres y tiendas abiertas durante 2026 quedan fuera de la meta. En el Resto, cada GM tiene su meta con el % del Resto.
3. **La meta es solo de lo existente** (Javier, 2026-10-30): filas con base en 2026. Las líneas o marcas nuevas de 2027 se trabajan aparte.
4. **Las libres absorben y se muestra** (Javier, 2026-10-30): al fijar una fila o al moverse la meta, las demás libres absorben la diferencia y el GM suma exacto; cada fila muestra cuánto absorbió desde que la IA propuso (aviso desde el 10 %) y el GM pasa a «meta movida» desde el 5 %. Se recomienda decidir 2026 antes que 2027. El cuadre de la Matriz es la garantía; cerrar no lo exige.
5. **El código garantiza lo exacto.** La salida del modelo es un peso que el código normaliza al leer; un peso nulo toma la cifra del método. Los meses salen siempre de `curvaFila × φ`.
6. **El natural se pide sin la meta** y **se enciende solo si gana al mejor rival** (Javier, 2026-10-30): el método parejo y la regla de tendencia, en reparto y natural, con bootstrap por GM, mayoría de GM, sin empeorar más de un 10 % en ningún género, contraste `D24`, cobertura ≥ 98 % y estabilidad ≤ 5 %. La mejora mínima es 5 % para la primera versión de prompt y 10 % desde la segunda. Todos los intentos quedan registrados y la evaluación nunca reusa.
7. **Privacidad** (Javier, 2026-10-30): al proveedor salen unidades agregadas por fila, año relativo y mes, los nombres del árbol y de agrupaciones de marca **con marcas, tiendas y términos extra reemplazados por alias** (restituidos al volver; el usuario ve siempre nombres reales), e indicadores derivados. Nunca tiendas, soles, costos, stock, años reales ni ids. Lo enviado se guarda canónico e inmutable en `ia_entradas` (solo admin) y nunca en logs. La clave vive solo en Railway.
8. **Proveedor por adaptador, OpenAI primero** (decisión 74, ya registrada el 2026-10-31: esta propuesta queda cubierta por ella): `proveedor` y `modelo` por configuración (`IA_PROVEEDOR`, `IA_MODELO`), sin ids ni precios en el código; encendido atado a proveedor + modelo + prompt; una llamada por petición conducida por el navegador, candado por GM y registro transaccional; topes por corrida, mes, usuario-día y evaluación (blandos) más el límite de gasto del proyecto en la cuenta del proveedor (duro si la cuenta lo permite).
9. **Versiones (alinea PLAN.md):** `0.14.0 · M6` (06e, migración `0029`), `0.15.0 · M7` (esta ficha, `0030`), `0.15.1 · M7` (sublíneas y cierre por IA). M9a toma la siguiente libre al cerrar, con su `0028`.

## 9. Cambios tras la revisión independiente y las decisiones de Javier (2026-10-30)

**Decisiones de Javier (mandan):** (1) absorción visible → D7, §5.1, ejemplo H, R7; (2) primero solo la distribución → encabezado, §1, `CAPACIDADES_IA`, §10; (3) alias → D12, §3.5, ejemplo J, R11; (4) meta solo de lo existente → §1, D18, §5.8; (5) ganar al mejor de método y tendencia → D11, §5.4; (6) `ia_entradas` → D13, §2.5; (7) acciones fuera del código → §6.2.

| Hallazgo | Dónde quedó |
|---|---|
| B1 huella con estado | §5.3 (`huella_historia` sin estado), R12. |
| B2 sublíneas por nodo | §10: participaciones de la fila, `participaciones_w12`. |
| B3 natural anclado a la meta | D9, §3.5 (bloque sin meta), §3.8 (plan natural → reparto), §5.4 (natural en el veredicto, `D25` sin meta), R10. |
| I1 «se cierra con el método» | D1, D19, §4.1 (aviso y orden por `\|contra_metodo_u\|`), §5.8. |
| I2 `meta_movida` | §5.1 absorción, §5.3, ejemplo H, R7, §4.1 «decide 2026 primero». |
| I3 peso nulo, cifra que cambia, pertenencia | §5.1, §3.1 (`valor_esperado`, `ia_valor_cambio`, `ia_fila_ajena`), R1, R21. |
| I4 backtest | §5.4 (mejor rival, mayoría de GM, `D24`, `MEJORA_MIN` 0,10, sin reuso, intentos), años relativos en §3.5, R22. |
| I5 tiendas entrantes | §3.5 `aporte_entrantes`/`aporte_salientes`, glosario §3.7, §5.1, ejemplo I, R8. |
| I6 duración y atomicidad | D10, §2.4 `ia_corrida_gms`, §2.11 función, contadores derivados, §3.8, R15, R16, R33. |
| I7 límites del proveedor | §3.8 (429 sin intento ni circuito), §5.5.9, §6.2. |
| I8 marcas en nombres | §3.5 alias y control de salida, `terminos_extra`. |
| I9 auditoría | §2.5 `ia_entradas`, §3.2 `GET /api/ia/entradas/[id]`. |
| I10 rendimiento | §2.10 agregado compacto, caché de `huella_historia` (§5.3), `preparar` por pliegue (§3.2, §5.4). |
| Menores de la revisión: M1 claves de pertenencia | §2.10. · **M2** tiendas de 2026 | D5. · **M3** redondeo de `B'` | D3, §5.1, R2. · **M4** `metaDeGM` | `proyeccion/meta-gm.ts`, R24. · **M5** `check` | §2.9, R19. · **M6** factores y reaprobar | §3.1, §4.1. · **M7** corridas por día | `tope_usd_dia_usuario`. · **M8** temperatura, JSON Schema, caché | §2.1, §3.6, §3.8. · **M9** saneamiento | §5.2. · **M10** `TRUNCATE` | §2 y §2.12. · **M11** propuesta del método | §3.5, §3.7. · **M12** cifras | encabezado, D4, §3.9. · **M13** dos metas | §4.1. · **M14** versión | encabezado, §8 propuesta 9. |

## 10. Segunda entrega `0.15.1 · M7`: sublíneas y cierre del año por la IA (diseño conservado)

Se construye después del hito de `0.15.0`, con una pasada corta del `arquitecto-revisor` sobre esta sección y su propia migración (la siguiente libre). Lo que cambie en `0.15.0` durante su hito manda sobre esto.

**Capacidades nuevas** en `CAPACIDADES_IA`: `cierre_y` (total de 2026 por fila) y `sublineas` (corte de filas GML en equivalencias con %). Cada una con su evaluación ganadora contra el mejor rival.

**Modelo de datos (migración de `0.15.1`).**
- `ia_propuestas_filas` gana `cierre_y_modelo`, `cierre_y` (`integer null check (>= 0)`), `sublineas_modelo`, `sublineas` (`jsonb null`, `array`) y **`participaciones_w12`** (`jsonb null`, `object`: `{ equivalencia_id: participación }` **de la fila** en `W12`, guardadas al generar).
- `proyeccion_fila_anios` gana `reparto_sublineas jsonb null` (`{ origen: "ia" | "manual", ia_fila_id, partes: [{ equivalencia_id | null, centesimas }], otras: uuid[], por_nombre, at }`; `Σ centesimas = 10 000` lo valida la API); `calcular` lo conserva y `copiar_de` lo copia.
- Función `venta_sublineas_ia(p_filas jsonb, p_grupos jsonb, p_desde date, p_hasta date)`: agregado compacto por fila × equivalencia × (año | `W12`), solo `unidades`.

**Sublíneas, corregidas (revisión, bloqueante B2).** `historico.pesos_equivalencias` se calcula **por nodo GML** (`calculo.ts:198-204` y `:233-237`; CTE `pesos` de la `0021`), no por fila: entre la mezcla de la fila (GML × agrupación de marca) y la del nodo, el revisor midió una mediana de 13 pp, p90 de 37 pp y 181 filas con ≥ 10 pp de diferencia. Por eso **todo se define con las participaciones de la FILA** en `W12`, leídas de `venta_sublineas_ia` y guardadas en `participaciones_w12`:
- **Elegible:** nodo GML, fila base de 2027, `V_f ≥ 300` y al menos dos equivalencias activas no genéricas con participación **de la fila** ≥ 10 % en `W12`. (Con el criterio por nodo, el revisor contó 189 filas elegibles de 308 con ≥ 300 u, el 65 % del volumen y 2,77 partes de media; se vuelve a contar por fila.)
- **Partes:** las relevantes y «otras» (las demás, con la genérica).
- **Normalización:** `centesimas = repartirEntero(10 000, pct_modelo)`; ids desconocidos se descartan (`sublineas_descartadas`); suma 0 → sin sublíneas.
- **Unidades:** `repartirEntero(V_f, centesimas)`; dentro de «otras», por `participaciones_w12` de sus miembros.
- **Aviso `sugerir_gmle`:** alguna parte con participación de la fila ≥ 20 % y `|centesimas ÷ 100 − part_W12| ≥ 10` pp.
- **Línea base de `S25`:** las participaciones de la fila al corte.
- **Huella de historia:** no necesita leer venta: las participaciones de la fila solo cambian con cargas nuevas, que ya cambian `historico`; las de la propuesta se leen de `participaciones_w12`.
- Son **informativas**: no cambian la curva de la fila ni el contrato de M8. Ruta `PUT …/filas/[filaId]/sublineas` (`requirePlanner`) con `validarPartes`.

**Ejemplo C (sublíneas de HOMBRE · URBANO · DENIM, f1, vigente 10 961).** Participaciones **de la fila** en `W12`: SKINNY 42 %, RECTO 40 %, SLIM 15 %, BOOTCUT 3 %, genérica 0 % → tres relevantes; «otras» = BOOTCUT y genérica. El modelo da 39,6 · 41,2 · 16,1 · 3,0 → **39,64 · 41,24 · 16,12 · 3,00 %** → **4 345 · 4 520 · 1 767 · 329** u. Ninguna parte se aparta ≥ 10 pp: sin `sugerir_gmle` (con RECTO al 52 %, sí).

**Cierre de 2026 (`cierre_y`).** `y.pedir` = registro de 2026 sin decidir con `propuesto ≥ umbral` o `revision_cola_larga`. `Ĉ = max(vendido, cierre_y_modelo)` (aviso `ia_bajo_vendido`). Aceptarlo es una decisión de 2026 (`repartirResto` con el real hasta `k` y `curvaFila × φ`) que mueve `B` y la meta: las libres de 2027 lo absorben (§5.1). Se pide en una llamada propia, sin la meta. **Ejemplo E:** vendido 7 200 a `k = 9`, método 9 600; el modelo propone 9 100 → `Ĉ = 9 100` y octubre a diciembre reparten 1 900; si propusiera 7 000 → `Ĉ = 7 200` con aviso. **Evaluación:** pliegues `C24k6`, `C24k9`, `C25k6`, `C25k9` contra el mejor del paso 1 del método y una regla de avance con tendencia, más `|sesgo_IA| ≤ |sesgo_rival| + 1 pp`.

**Pliegue `S25`:** participaciones de 2025 de la fila en filas elegibles; `EAT_sub = Σ U_f × 50 Σ_e |q̂ − q| ÷ Σ U_f`.

**Costo adicional estimado:** el revisor midió ≈ 300 tokens por fila con sublíneas y un 37 % de filas con ellas; con `cierre_y` se suma una llamada por lote. Se rehace en la ficha ajustada de `0.15.1`.

## 11. Cambio de proveedor: OpenAI primero (2026-10-31, decisión 74)

TIC no entrega API de Claude; Javier tiene una de OpenAI. El esquema de la `0030` ya es neutral, así que el cambio no pide migración: cambia el adaptador, la configuración por entorno, el costo y lo que `backend` debe verificar.

### 11.1 Qué cambió en esta ficha

| Tema | Antes | Ahora | Dónde |
|---|---|---|---|
| Proveedor | Claude (Anthropic) | OpenAI; Claude como adaptador futuro | encabezado, D14, §3, §3.10, §3.11, §7 |
| Selección | modelo en la configuración | `IA_PROVEEDOR` + `IA_MODELO` (lista permitida) + `proveedor` y `modelo` en la configuración vigente | §2.1, §3.2, §3.4, §3.10 |
| Clave | `ANTHROPIC_API_KEY` | `OPENAI_API_KEY`, dedicada, solo en Railway | §3.10, §5.5, §6.2 |
| Caché | dos puntos de caché explícitos | sin caché explícita; prefijo estable; estimación sin caché | D9, §3.8, §3.9 |
| Costo y tokens | 4 precios y 4 contadores | `{ entrada, entrada_cache, salida }` y `tokens_entrada`, `tokens_entrada_cache`, `tokens_salida` (disjuntos) | §2.1, §2.6, §3.9, ejemplo G, R14 |
| Salida estructurada | «mecanismo vigente o herramienta forzada» | JSON validado por zod siempre; el mecanismo de OpenAI se verifica (§11.2) | §3.6 |
| Encendido | modelo + prompt | proveedor + modelo + prompt; ids fijados; aviso de `modelo_respuesta` | D11, §5.4, R23, R34 |
| Huellas | sin proveedor | `proveedor` en `huella_llamada` y `huella_gm` | §5.3, R12, R29 |
| `0030` real | — | `unique (version)`, `unique (propuesta_gm_id, fila_clave)`, `check` con `coalesce`, `tg_ia_terminal` rechaza `DELETE`, `proveedor` obligatorio, payload y errores `IA001` a `IA003` de `registrar_propuesta_ia_gm`, medición de `venta_lineas_ia` | §2.1 a §2.12, R16, R19 |
| Riesgos | — | retención, límite de gasto, determinismo parcial, backtest atado | §5.5.9, §6.2 |

### 11.2 Lo que `backend` verifica en la documentación vigente de OpenAI antes de implementar

**Acceso (2026-10-31):** la documentación web (`platform.openai.com/docs`, `developers.openai.com`, `api.openai.com`) no fue accesible desde el entorno de construcción (el proxy respondió 403 al `CONNECT`); lo anotado abajo sale de los tipos del SDK oficial `openai@7.47.0` (paquete npm; `src/resources/chat/completions/completions.ts` y `shared.ts`), que reflejan la especificación de la API, y NO sustituye a la documentación. Lo que dice «pendiente de verificar» debe confirmarse en la documentación vigente antes de encender.

**Nada de esta tabla se afirma de memoria.** `backend` anota en la columna «Resultado» lo que encontró, con la fecha y el enlace de la página consultada; la parte del adaptador que depende de un punto no se escribe hasta que ese punto tenga resultado. Los puntos 11 y 12 los responde TIC con Javier.

| # | Qué verificar | Impacta en | Resultado |
|---|---|---|---|
| 1 | Mecanismo de salida estructurada (JSON Schema estricto, modo JSON o herramienta forzada), cómo se pide y con qué modelos funciona | §3.6, adaptador | **Parcial (2026-10-31, tipos del SDK `openai@7.47.0`).** Chat Completions (`POST /v1/chat/completions`) admite `response_format: { type: "json_schema", json_schema: { name, schema, strict } }` («Structured Outputs», preferido frente al modo `json_object`, que solo asegura JSON válido). Implementado: `strict: true` y el esquema de `jsonSchemaSalida`. **Pendiente de verificar en la documentación:** qué modelos candidatos admiten `json_schema` estricto (si no, la API responde `400` y el GM queda `fallido`; la evaluación lo mostraría). |
| 2 | Subconjunto de JSON Schema admitido (`pattern`, `minimum`/`maximum`, `maxItems`, `additionalProperties`, opcionales, uniones) y límites de tamaño y profundidad del esquema | §3.6, `esquemas.ts` | **Parcial (2026-10-31, `lib/transform.ts` del SDK).** Con `strict: true` solo se admite un subconjunto. El SDK rechaza o transforma `allOf`, `oneOf`, `not`, `if/then/else`, `patternProperties`, `prefixItems`, `uniqueItems`, `minProperties`/`maxProperties`, `dependent*`, `$anchor`/`$dynamic*`; cada objeto debe cerrarse con `additionalProperties: false` y llevar todas sus propiedades en `required` (los esquemas de la ficha ya lo cumplen: `z.strictObject`, sin opcionales ni uniones). `pattern`, `minimum`/`maximum` y `maxItems` no figuran en esa lista, pero no se verificó que el servidor las acepte: `jsonSchemaSalida` ya las quita (rev. M8) y las exige zod al volver. **Pendiente:** límites de tamaño y profundidad del esquema. |
| 3 | Cómo se reportan una negativa del modelo y un corte por límite de salida (motivo de fin) | §3.8, `fin` | **Verificado en los tipos (2026-10-31).** `choices[0].finish_reason` ∈ `stop`, `length` (tope de tokens alcanzado), `content_filter`, `tool_calls`, `function_call`; una negativa llega en `choices[0].message.refusal` (texto). Traducción en `proveedor-openai.ts`: `stop` → `normal`; `length` → `limite_salida`; `content_filter` o `refusal` → `rechazo`; el resto → `otro`. |
| 4 | Parámetros de los modelos candidatos: temperatura, semilla, tope de tokens de salida (≥ `MAX_TOKENS_SALIDA`), razonamiento y qué combinaciones admite | §2.1, §3.8, §3.11 | **Parcial (2026-10-31, tipos).** Existen `temperature`, `seed` (marcado `@deprecated`, «beta», sin garantía de determinismo), `max_completion_tokens` (cota que **incluye los tokens de razonamiento**; `max_tokens` está obsoleto) y `reasoning_effort` ∈ `none`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` («no todos los modelos admiten todos los valores»). El adaptador envía `max_completion_tokens = MAX_TOKENS_SALIDA` y traduce `presupuesto_razonamiento` a `low` (≤ 4 000), `medium` (≤ 16 000) o `high` (umbrales propios, sin respaldo en la documentación); con razonamiento no envía la temperatura. **Decisión:** el servicio NO envía temperatura ni semilla (`null`) hasta saber qué admite cada modelo (un parámetro no admitido daría `400` en toda la corrida); la reproducibilidad descansa en guardar entrada y salida. **Pendiente:** por modelo candidato, qué parámetros admite, si su tope de salida llega a 16 000 y cómo se combinan razonamiento y `max_completion_tokens`. |
| 5 | Caché de prompt: si es automática, tamaño mínimo, duración, cómo aparece en el uso (si los tokens cacheados vienen dentro del total de entrada) | §2.6, §3.8, §3.9 | **Parcial (2026-10-31, tipos).** `usage.prompt_tokens_details.cached_tokens` = «cached tokens present in the prompt» (dentro de `prompt_tokens`): el adaptador resta (`entrada = prompt_tokens − cached_tokens`, `entrada_cache = cached_tokens`). Los tipos describen `prompt_cache_options` («una cache breakpoint implícita por defecto; explícita con `prompt_cache_breakpoint`», para `gpt-5.6` y posteriores) y `prompt_cache_key`/`prompt_cache_retention` (obsoleto); el código **no** usa ninguna. **Aviso:** el uso trae además `prompt_tokens_details.cache_write_tokens` («tokens escritos a la caché»): si el proveedor cobra la escritura con otra tarifa, la estimación sin caché quedaría corta; no está reflejado en `precios` (neutros). **Pendiente:** tamaño mínimo, duración, y si las escrituras se cobran distinto. |
| 6 | Cómo se reportan y cobran los tokens de razonamiento | §2.6, §3.9 | **Parcial (2026-10-31, tipos).** Se reportan en `usage.completion_tokens_details.reasoning_tokens`, como desglose de `completion_tokens`. El adaptador toma `salida = completion_tokens` (el razonamiento va dentro; no se suma otra vez), inferido de los tipos. **Pendiente:** confirmar en la documentación de precios que se cobran a la tarifa de salida. |
| 7 | Errores y cabeceras: `429` (`retry-after`, cabeceras de límite), sobrecarga, 5xx, `401`/`403`, tiempos máximos | §3.8, errores tipados | **Parcial (2026-10-31, `client.ts` y `core/error.ts` del SDK).** El SDK distingue `400`, `401`, `403`, `404`, `409`, `422`, `429` y `>= 500`; considera reintentables `408`, `409`, `429` y `>= 500` y obedece `x-should-retry`; la espera la toma de `retry-after-ms` (ms) y, si falta, de `retry-after` (segundos o fecha HTTP). El adaptador implementa: `401`/`403` → `clave_invalida`; `429` → `limite` con la espera; `408`, `409` y `>= 500` → `servicio` con el código HTTP; el resto → `solicitud_invalida`. **Pendiente:** cabeceras de límite (`x-ratelimit-*`: no aparecen en el SDK), cómo distingue la API una cuota agotada de un límite de ritmo (ambos podrían llegar como `429`; el tope de `MAX_ESPERAS_429` lo acota), tiempos máximos de una petición. |
| 8 | Dónde vienen el id de la petición (soporte) y el modelo efectivo de la respuesta | `id_solicitud`, `modelo_respuesta`, R34 | **Verificado en los tipos (2026-10-31).** Id de la petición: cabecera `x-request-id`. Modelo efectivo: campo `model` del cuerpo de la respuesta. |
| 9 | Ids de modelo fijados (con fecha o versión) frente a alias, y política de retiro de modelos | §5.4, §5.5.9 | pendiente de verificar (no figura en los tipos; lo decide Javier con `backend` al elegir los modelos de `IA_MODELO`) |
| 10 | Precios vigentes de los modelos candidatos: entrada, entrada en caché, salida | `precios`, §3.9 | pendiente de verificar (no hay precios en el código ni en los tipos; los escribe el admin en la configuración y en cada evaluación; la tabla en US$ de §3.9 queda por rehacer con los precios vigentes) |
| 11 | Política de datos de la API de la organización: retención, entrenamiento, *zero data retention* (TIC) | §5.5.9, §6.2 | pendiente (TIC). Nota: el adaptador envía `store: false` (parámetro verificado en los tipos) para no pedir almacenamiento de las salidas del lado del proveedor. |
| 12 | Límite de gasto del proyecto: ¿corta o solo avisa? (TIC) | §5.5.9, §6.2 | pendiente (TIC) |
| 13 | SDK oficial o `fetch`: versión, compatibilidad con el runtime de este Next (`node_modules/next/dist/docs/`) y duración máxima de una ruta en Railway | §3.10, §3.8 | **Decidido: `fetch` directo, sin dependencia nueva (2026-10-31).** La última versión del SDK (`openai@7.47.0`, npm) declara `engines.node >= 22.0.0`, y este proyecto declara `>=20`; con `fetch` no se añade ninguna dependencia, el adaptador es fácil de probar con un `fetch` falso (sin red) y el alcance es el mismo. `AbortSignal.any` exige Node >= 20.3. **Duración de una ruta:** la documentación de Next de este repositorio (`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md`) solo describe `export const maxDuration` como dato para las plataformas de despliegue; las rutas de paso y de preparar lo exportan (300 s). **Pendiente:** probar en Railway que una petición de hasta 240 s no se corta. |

### 11.3 Ajustes al código ya escrito de la tanda 1 (tanda 1b)

- `src/lib/ia/tipos-api.ts`: `PreciosIa` y `UsoTokensIa` pasan a `{ entrada, entrada_cache, salida }`; `MotivoServicioIa` suma `sin_proveedor`, `proveedor_distinto` y `modelo_no_permitido`; `ServicioIaApi` suma `proveedor` y `modelos_permitidos`; `CorridaApi`, `GMIaResumenApi.propuesta` y `GMIaDetalleApi.anteriores` suman `proveedor`.
- `src/lib/ia/costo.ts`: fórmula de tres términos; la estimación sin caché (fuera `cache_escritura`, `cache_lectura` y `sistema_en_cache`; el texto fijo cuenta como entrada en cada llamada).
- `src/lib/ia/huellas.ts`: `proveedor` en `huellaLlamada` y `huellaGM`.
- `src/lib/ia/proveedor.ts`: la petición gana `semilla` y sus comentarios dejan de hablar de «puntos de caché»; `StopReasonIa` (hoy con valores de Anthropic: `end_turn`, `tool_use`, `pause_turn`…) pasa al `fin` neutral de §3.11; el comentario de `ErrorServicioProveedor` habla de «sobrecarga» en vez de `529`. El encabezado ya nombra `proveedor-openai.ts`.
- `src/lib/ia/prompt/v1.ts`: solo el comentario («se cachea» → «prefijo estable»). El texto del prompt no cambia, así que `VERSION_PROMPT` sigue en `v1`.
- `tests/setup-sin-red.ts`, `tests/ia.sin-red.test.ts` y `vitest.config.ts`: bloquear también `openai.com`.
- `tests/ia.costo.test.ts` (ejemplo G nuevo), `tests/ia.huellas.test.ts`, `tests/ia.proveedor-falso.ts` (uso y `fin` neutros) y `tests/ia.prompt.test.ts` (prohibidos `openai`, `gpt`).

### 11.4 Lo que no cambia

El modelo de datos de la `0030` (ya aplicada), la lógica de meta, absorción, validación, alias, entrada, estados y evaluación, los contratos con M7 y M8, el prompt `v1` y el perímetro de privacidad (D12).

## Preguntas abiertas

**Ninguna bloquea la construcción.** Las decisiones de Javier del 2026-10-30 cerraron las que había y la decisión 74 (2026-10-31) fijó el proveedor. Lo que depende de él son las acciones fuera del código de §6.2 (dos de ellas, retención y límite de gasto, **bloquean el encendido**, no la construcción) y, con el informe de evaluación delante, decidir si se enciende y con qué modelo.

Para confirmar al aprobar la ficha (con recomendación):

1. **Condición «gana en la mayoría de los GM»** (§5.4, regla 3 del veredicto). La añadí porque, con dos GM que suman el 44 % del volumen, el bootstrap por GM casi se reduce a «ganó en MUJER · URBANO y HOMBRE · URBANO». Hace más difícil encender la IA. **Recomendación: mantenerla**; si la IA gana en todo menos en esta, el informe lo mostrará y Javier puede decidir con las cifras.
2. **`IA_MODELO` como lista de modelos permitidos** (§3.10). La decisión 74 dice «configuración por `IA_PROVEEDOR` / `IA_MODELO`»; la ficha la interpreta como una lista separada por comas (el primero por defecto) que acota lo que el admin puede evaluar y encender, mientras la configuración vigente, atada a su evaluación, manda. Alternativa: un solo modelo en `IA_MODELO` que gobierna directamente (más simple, pero evaluar otro modelo exige cambiar la variable en Railway cada vez). **Recomendación: la lista.**
3. **`IA_PROVEEDOR` sin valor por defecto** (§3.10): si falta, la IA queda apagada (`sin_proveedor`) en vez de suponer `openai`. **Recomendación: sin valor por defecto**, para que encenderla sea siempre un acto explícito en Railway.
4. **Con TIC, antes de encender** (§5.5.9, §11.2 puntos 11 y 12): ¿la retención de datos de la organización es aceptable o hay que pedir *zero data retention*?, y ¿el límite de gasto del proyecto corta las peticiones o solo avisa? Si solo avisa, se recomienda bajar `tope_usd_mes` por debajo de lo que Javier tolere perder ante una falla.
