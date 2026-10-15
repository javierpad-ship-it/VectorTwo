# M6 · Curvas de estacionalidad

> **Nota del 2026-10-15 (rediseño de flujo).** El flujo de **corrida global** descrito en esta ficha (tarjeta Calcular para todas las agrupaciones, corridas guardadas con selector y corrida de referencia, lectura atómica de la vista materializada con candado, tabla de propuestas por corrida) **queda sustituido por la ficha [06b-curvas-trabajo-por-agrupacion](06b-curvas-trabajo-por-agrupacion.md)**: la unidad de trabajo pasa a ser una agrupación a la vez, el cálculo es a demanda con una función SQL filtrada por agrupación (migración `0017`), se guarda solo la foto de cada aprobación y se comprueban los prerrequisitos antes de calcular. **Todo lo demás de esta ficha sigue vigente** (modelo, candidatas, backtesting, red comparable, efecto del Niño en volumen y forma, obsolescencia con huellas, periodos atípicos, contratos con M7) y la 06b lo referencia sin reescribirlo. Lo construido en `0.9.6` se conserva como base; la 06b dice qué se reutiliza, qué se extiende y qué se retira.

> Estado: **paso 1 construido el 2026-10-13 (`0.9.0 · M6`, migración `0011_periodos_atipicos_temporada.sql`); paso 2 LISTO PARA CONSTRUIR desde el 2026-10-14 con la migración `0015_curvas_estacionalidad.sql` (YA APLICADA en `vector-two`, se mantiene como está), una migración pequeña `0016_agregado_estacionalidad.sql` (nueva en esta pasada) y la versión `0.9.6 · M6`** (la vigente es `0.9.5 · M11`). Esta es la **tercera pasada** de la ficha (2026-10-14, tarde): incorpora la revisión independiente de `arquitecto-revisor` sobre la base real, las decisiones que Javier tomó hoy (no hay aprobación en bloque; el ajuste del Niño para M7 es calculado y editable; meses del Niño confirmados; la tienda nueva entra a la red de 2026) y su requisito de que **las curvas no quedan escritas en piedra: una tienda nueva puede modificarlas**. La ficha es coherente de punta a punta con esta pasada; lo que las pasadas anteriores decían distinto queda resumido en "Historial" y no rige. Módulo anterior: [05-venta-stock](05-venta-stock.md); dependen de aquí [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md), [04-tiendas](04-tiendas.md) y [11-reporte-agrupacion-gmle](11-reporte-agrupacion-gmle.md) (de donde se reutilizan las funciones del histograma). Módulo siguiente: [07-proyeccion-anual](07-proyeccion-anual.md), borrador a rediseñar con Javier; M6 le deja contratos estables sin suponer cómo los usará. Reglas de base en `docs/PLAN.md` y `docs/DECISIONES.md`. Ningún dato real de Lukers en esta ficha: los ejemplos son sintéticos y las observaciones sobre la base real se describen en cifras agregadas, sin nombres ni códigos de tiendas ni de agrupaciones.

## Construido (paso 1, `0.9.0 · M6`, 2026-10-13)

El paso 1 es el mantenimiento que pidió Javier, usable antes de que exista ningún cálculo. **Migración `0011_periodos_atipicos_temporada.sql`**: `agrupaciones_estacionalidad.temporada` (`not null default 'todo_el_ano'`, `check` de tres valores, sin backfill) y la tabla `periodos_atipicos` (sin seed, sin FKs, RLS sin políticas). **Rutas** (`requirePlanner`): `GET`/`POST /api/periodos-atipicos`, `PATCH`/`DELETE /api/periodos-atipicos/[id]`, `GET /api/periodos-atipicos/anios` (contrato para M7; `ratio_volumen` siempre `null` hasta el paso 2); `POST`/`PATCH /api/agrupaciones-estacionalidad` aceptan `temporada`, `GET` devuelve `temporada`, `temporada_sugerida` y `temporada_sugerida_distinta`; el importador de M3 acepta la columna opcional `TEMPORADA`. **Archivos**: `src/lib/curvas/` (`atipicos.ts`, `esquemas.ts`, `tipos-api.ts`, `tipos.ts`, `consultas.ts`), pantalla en `src/app/(app)/planificacion/curvas-estacionalidad/` (`curvas-panel`, `periodos-tab`, `formulario-periodo`, `anios-atipicos-card`, `curvas-tab`, `use-recurso`, `meses`, `conteo`) y `src/components/estacionalidad/temporada.tsx`. **Pantalla**: pestaña Periodos atípicos (formulario con vista previa, tabla, tarjeta "Años marcados como atípicos") y pestaña Curvas (tabla de agrupaciones con temporada editable en línea, chips, tarjeta Calcular deshabilitada). **Pruebas**: `tests/periodos.*` (81) y `tests/estacionalidad.temporada.test.ts` (19); 1 409 pruebas en 92 archivos tras las entregas del 2026-10-13. **No probado**: navegador con los tres roles ni Supabase real.

**Pendiente de Javier tras el paso 1 (estado al 2026-10-14).** Los meses del Niño están confirmados (ver "Decidido por Javier"); la propuesta antigua "marzo a mayo de 2023" queda descartada y el prellenado del formulario cambia en el paso 2. Queda: crear los cuatro periodos cuando exista el conjunto `temporadas` (paso 2), **revisar y marcar la temporada de las 10 agrupaciones activas que siguen en "Toda temporada"** (hoy hay 15 activas: 4 de invierno, 1 de verano y 10 de toda temporada; es prerrequisito del hito del paso 2, ver I5) y recorrer el hito del paso 1.

**Cambios respecto a la especificación en el paso 1** (siguen vigentes): no se construyó `GET /api/curvas` (llega en el paso 2); la migración se partió (`0011` + `0015` + `0016`); `GET /api/periodos-atipicos` devuelve el arreglo directamente en `data`; la pantalla abre en Periodos atípicos; falta el chip de temporada en las tarjetas del Mapa de M3; las constantes `TEMPORADAS_AGRUPACION` y `ALCANCES_PERIODO` viven en `tipos-api.ts` y la pantalla usa `use-recurso.ts`.

## Historial de las pasadas anteriores (resumen; no rige donde esta pasada diga otra cosa)

- **2026-10-12 (ficha original)**: participación mensual por agrupación, candidatas con backtesting (EAT), periodos atípicos como catálogo, liquidación como señal y candidata, curva versionada en doce columnas, `requirePlanner` en toda la API, MV `venta_mensual_estacionalidad`.
- **2026-10-13**: la temporada vive en la agrupación (`temporada`), el Niño afecta a las de invierno, la premisa "el Niño cambia el volumen, no la forma" se mide y no se asume; el paso 1 se entrega recortado.
- **2026-10-14 (primera pasada)**: Javier confirma que la lógica de Vector-One sirve hasta M6 (todos los años superpuestos, participación sobre las mismas tiendas, curva propuesta); red comparable por fechas **y por datos**, tienda nueva, concentración visible, candidata `E`, gráfico con todos los años, numeración `0015` / `0.9.6`.
- **2026-10-14 (segunda pasada)**: el Niño afecta el año completo a invierno y adelanta a setiembre el verano; `periodos_atipicos.temporadas text[]`; clase `atipico_completo`; efecto en dos dimensiones (volumen y forma); pestaña Años Niño; `meses_tienda_nueva = 0`. Introdujo `sustitucion_temporada`, `umbral_sustitucion`, `/cruda`, `referencia_volumen = promedio` y la aprobación en bloque, **que esta pasada retira**.

## Tercera pasada (2026-10-14): revisión independiente, decisiones de Javier y recortes

**Datos verificados por el revisor sobre la base real** (sin nombres): 15 agrupaciones de estacionalidad activas (4 de invierno, 1 de verano, 10 de toda temporada; 3 de ellas con 5 o 7 géneros); las **87 líneas** del árbol tienen `temporada = 'Todo el año'`, así que las líneas **no informan** la temporada de ninguna agrupación; la MV tiene **85 385 filas**. Red comparable: **8 tiendas en 2023, 9 en 2024 y 2025, 10 en 2026**. Ruido entre los dos años normales (EAT 2024 frente a 2025): invierno **24, 33, 38 y 66 pp** por agrupación (≈ 29 pp agregado); verano **12,6 pp**; toda temporada **de 8 a 140 pp**. Ratios de volumen **sobre tiendas comunes**: verano 2025/2024 = 1,287 (crecimiento normal) y 2026/2025 enero–setiembre = 1,238; toda temporada 1,104 y 0,975; invierno 1,034 y 0,660; 2023 frente a 2024: invierno 0,626, **verano 0,728 (el verano de 2023 bajó, no subió)**, toda temporada 0,949. En crudo (todas las tiendas) invierno 0,881 y verano 1,513: **las cifras que Javier calculó a mano solo salen sobre tiendas comunes**. Peso de la tienda mayor en la red comparable: 31,1 % (2023), 33,4 % (2024), **38,0 % (2025)**, 26,4 % (2026); la tienda nueva (abierta en noviembre de 2025) pesa **21,7 %** en 2026. Hay 281 filas negativas en la MV (−748 unidades) y **cero** celdas agrupación × tienda × mes negativas. La tienda cuya apertura se corrigió a `2023-06-01` tiene su **primera venta positiva en 2023-07**. Dos agrupaciones tienen años de 26 a 600 unidades y meses en cero. Evidencia del arranque del verano: setiembre–noviembre de 2023 pesan 5,4 / 6,1 / 7,8 % del año frente a 4,2 / 6,6 / 9,3 % en 2024: **no hay todavía un arranque claramente anticipado**. Efecto de la tienda nueva en la forma: participación enero–setiembre de 2026 de la red con y sin ella difiere **≈ 3,3 pp de EAT en nueve meses** (11,1 · 10,0 · 9,9 · 9,7 · 11,3 · 11,7 · 13,0 · 11,8 · 11,5 % frente a 10,1 · 9,5 · 9,8 · 9,8 · 11,4 · 12,3 · 13,1 · 12,1 · 12,0 %); su perfil propio es distinto (enero 14,7 %, invierno más plano), el efecto crece con su peso y, cuando cierre 2026, entrará completa en la curva.

**Decisiones de Javier (2026-10-14).** (a) **No hay aprobación en bloque**: cada curva se aprueba por agrupación tras revisar su detalle (pregunta 8, resuelta "no"). (b) El ajuste de volumen del Niño para M7 es **calculado y editable** (pregunta 14, resuelta; el valor editado vive en M7). (c) Meses del Niño confirmados: invierno año completo 2023 y 2026; verano setiembre–diciembre. (d) La tienda nueva entra a la red de 2026 (`meses_tienda_nueva = 0`). (e) **"Las curvas no quedan escritas en piedra: una nueva tienda puede modificarlas"**: las curvas son un artefacto vivo y versionado, recalcular es una operación normal, la obsolescencia por cambio de red se nombra con su motivo, el detalle compara vigente y propuesta antes de aprobar, y M7 guarda la versión de curva que usó.

**Qué cambia en el diseño** (los valores por defecto son la recomendación del revisor; donde se indica, quedan **pendientes de confirmar por Javier** pero se construyen como parámetros editables):

| # | Cambio | Dónde |
|---|---|---|
| B1 | Veredicto de forma **relativo al ruido**: `forma_cambia` solo si `diferencia_anio > max(umbral_forma, ruido_normal)`; `umbral_forma` (3 pp) es piso; `umbral_bajo_ruido` deja de ser aviso y pasa a ser explicación; el ruido se muestra siempre. *Pendiente de confirmar* | "Efecto de un periodo atípico" |
| B2 | **Sin aprobación en bloque** en toda la ficha; "Aprobar esta curva" vive solo en el detalle; hito "las 15 agrupaciones aprobadas una por una" | API, Pantallas, Reglas, Hito |
| B3 | **Ratio relativo**: por temporada y año, ratio de la temporada, ratio de control (toda temporada del mismo año) y `ratio_relativo` = temporada ÷ control, más el crecimiento entre años normales; se retiran `sustitucion_temporada` y `umbral_sustitucion` | "Efecto…", Salida, Años Niño |
| B4 | **Lectura atómica** del agregado con una función `jsonb` de la `0016` (lock de aviso, `409 calculo_en_curso`), sin paginar la MV; nada se lee de la MV fuera de `calcular` | Modelo de datos, Calcular |
| I1 | Recomendación con pocos pliegues: **empate relativo** a favor de `A` ("sin evidencia para apartarse del promedio"), EAT por pliegue guardada, `igual_a` general, frase comparativa. *Pendiente de confirmar* | Paso 4 |
| I2 | Un año con **más de `max_meses_hueco`** meses atípicos se trata como atípico completo (se mide la forma; nunca se imputa) | Periodos atípicos |
| I3 | **Agrupaciones pequeñas**: años `escaso` fuera del ajuste; aviso `cambio_volumen_extremo`; con menos de dos años no escasos, curva prestada de la temporada; factor de volumen para M7 solo por temporada. *Pendiente de confirmar* | "Pocos años", Candidatas |
| I4 | `F` se redefine como **`T`, curva de la temporada** (prestada); `genero_id` sale de la lectura | Candidatas |
| I5 | Sin sugerencia ni aviso de temporada cuando las líneas no informan; **prerrequisito**: Javier revisa las 10 de toda temporada | Periodos atípicos, Hito |
| I6 | Tienda dominante: cifras corregidas; peso por año **siempre** visible; aviso por agrupación también | Red comparable |
| I7 | Forma parcial de 2026 **también sobre tiendas comunes con 2025**, junto a la de la red completa | "Efecto…" |
| I8 | `/cruda` se recorta; hito corregido (crudo frente a comunes) | API, Hito |
| I9 | **Obsolescencia por agrupación** con huellas (composición, red, cargas) en los `jsonb` existentes; motivo nombrado | Salida, `GET /api/curvas` |
| I10 | **Corrida de referencia** (`referencia` en `0016`); `/anios`, `ratio_volumen` y M7 leen de ella | Modelo de datos, API |
| I11 | Verano queda setiembre–diciembre; se mide primero; peso de los meses imputados visible. *Pendiente de confirmar* | Periodos atípicos |
| I12 | Coherencia: `meses_tienda_nueva = 0` (decisión 11 corregida), cifras reales, primera venta 2023-07, numeración de reglas, pregunta 14 (no 1) para el factor de volumen, ficha 07 corregida | toda la ficha |
| N1–N6 | Requisito de Javier: curvas vivas, `obsoleta` por red con motivo y botón Recalcular, comparador vigente/propuesta, diagnóstico `tienda_distinta`, contrato de versión con M7, calendario de revisión | "Curvas vivas", Pantallas, M7 |
| Menores | `tipos-api.ts` documenta que M7 lee `temporadas`; casilla "Agrupaciones de toda temporada" y atajo "Todas"; serie rellenada con ceros desde los meses publicados; truncado a 0 tras sumar la red; motivo `tienda_desactivada` | varios |

**Recortes para lanzar antes** (van a "Fuera de alcance / segunda entrega"): aprobación en bloque, `/cruda`, candidata `F` tal como era, candidatas `G` y `H` (la liquidación queda como señal), `medida = venta_soles`, `referencia_volumen = promedio`, `umbral_sustitucion` y la etiqueta de cruce, la pestaña Corridas (basta un selector en Curvas), el CV % por línea y el histograma crudo en el detalle, la vista previa de la red con `debounce`. **Núcleo que se construye**: red comparable, gráfico de todos los años superpuestos con tabla año × mes, candidatas `A` `B` `C` `D` `E` (+ `T` prestada) con backtesting y EAT por pliegue, volumen y forma por agrupación y por temporada, pestaña Años Niño reducida, aprobación una por una con comparador, obsolescencia con motivo, diagnóstico por tienda.

## Objetivo

Dar a M7 una **curva mensual por agrupación de estacionalidad**: doce participaciones (cada mes ÷ total del año) que suman 100 %, calculadas sobre la venta real de M5 **sobre las mismas tiendas dentro de cada año**, y **elegidas por el planner, una por una**, entre candidatas que un modelo propone y compara con backtesting. Resuelve lo que M5 dejó abierto: qué meses son atípicos (El Niño costero de 2023 y 2026) y cómo se tratan, cómo se usa el año en curso incompleto, y qué hacer con la liquidación (señal). Las curvas son un **artefacto vivo**: se versionan, se recalculan cuando cambia la red de tiendas, la composición de la agrupación o los datos, y la pantalla dice por qué una curva quedó obsoleta. Sin curva vigente, M7 no puede repartir una agrupación; el hito es "toda agrupación activa con venta tiene curva vigente, aprobada una por una".

## Decidido por Javier

1. **(2026-10-12) La estacionalidad es la participación del mes en el año**: `p_m = venta_m ÷ Σ venta del año`, doce valores que suman 100 %. No se usan índices "1,0 = mes promedio" como en Vector-One.
2. **(2026-10-12 / 2026-10-14) El modelo propone, el planner elige por agrupación.** La curva elegida queda versionada con quién y cuándo. **No hay aprobación en bloque** (2026-10-14): cada curva se aprueba desde el detalle de su agrupación, después de ver el gráfico de todos los años, la tabla de candidatas y el efecto del Niño.
3. **(2026-10-12 / 2026-10-14) 2023 y 2026 son años de El Niño costero**, en un catálogo editable de periodos atípicos (nunca meses fijos en el código). **Meses confirmados**: agrupaciones de **invierno**, año completo (2023-01 a 2023-12; 2026-01 a 2026-12, en curso); agrupaciones de **verano**, **setiembre a diciembre** de 2023 y de 2026. "Marzo a mayo de 2023" queda descartado.
4. **(2026-10-13) La temporada vive en la agrupación de estacionalidad** (`invierno` / `verano` / `todo_el_ano`); un periodo atípico aplica a una agrupación si su temporada está en el conjunto `temporadas` del periodo. La agrupación de marca no interviene.
5. **(2026-10-13) Premisa a validar: el Niño cambia sobre todo el volumen, no la forma.** M6 lo mide por agrupación y año en dos dimensiones separadas (volumen y forma); nada se asume.
6. **(2026-10-14) La lógica de Vector-One sirve hasta M6**: graficar todos los años superpuestos, participación sobre las mismas tiendas (una tienda que abrió en 2025 no cuenta para 2024 ni antes), curva propuesta. "De M7 en adelante hay que diseñar casi desde cero."
7. **(2026-10-14) La tienda abierta el 2025-11-20 cuenta para la red de 2026** (estuvo abierta los doce meses): `meses_tienda_nueva = 0`. La tienda con apertura corregida a `2023-06-01` queda fuera de 2023 por fechas.
8. **(2026-10-14) El ajuste de volumen del Niño para M7 es calculado por M6 y editable en M7** (pregunta 14 resuelta): M6 entrega el factor por temporada y año de la corrida de referencia; el valor editado es un dato de M7.
9. **(2026-10-14) "Las curvas no quedan escritas en piedra. Una nueva tienda puede modificar estas curvas."** Ver "Curvas vivas".
10. De antes (2026-10-06 y 2026-10-11): no hay curvas manuales; la carga no marca ni excluye meses; el CV % se calcula agregado, nunca al cargar.

## Conceptos

### Participación, año y curva

- **Mes**: `periodo` de `venta_stock_vigente` (primer día del mes). **Año**: calendario (pregunta abierta 7, rige el valor por defecto).
- **Medida**: **unidades** en esta entrega (`curvas_estacionalidad.medida = 'unidades'` siempre; `venta_soles` queda para la segunda entrega). La venta y el costo solo sirven para el CV % (señal de liquidación).
- **Serie de un año**: doce valores de unidades de la agrupación **sumados sobre las tiendas de la red comparable de ese año**. La serie se rellena con **ceros a partir de los meses publicados** (un mes publicado sin filas para la agrupación vale 0), nunca a partir de las filas que existan en el agregado (regla 2b, con test). El **truncado a 0 de un mes negativo se hace después de sumar la red** (un mes negativo en una tienda compensa con las otras; si la suma de la red sigue negativa se trunca y se avisa `mes_negativo`). En la base real no hay celdas agrupación × tienda × mes negativas; las 281 filas negativas están en el grano línea y se absorben al sumar.
- **Participación de un año**: `p(Y) = [p_1 … p_12]`, `p_m = u_m ÷ Σ u_k`; con suma ≤ 0 el año es `sin_volumen`. Seis decimales como fracción; en pantalla, porcentaje con un decimal. **Curva**: doce participaciones que suman 1 (`normalizarCurva` ajusta el mes mayor para que la suma sea exacta).
- **Año completo**: los doce meses publicados en M5. Un año con meses sin cargar es `incompleto` (aviso `meses_sin_cargar`) y no entra en nada. **Año en curso**: el de `hasta_periodo` (por defecto el último mes publicado que además está cerrado en Lima, `ultimoMesCerrado`); nunca entra en el ajuste; sirve para la validación parcial y se dibuja como "2026 (parcial, ene–set)".
- **Curva acumulada**: `C_m = Σ_{k≤m} p_k` (doce valores, `C_12 = 1`). Se deriva de la curva vigente y es lo que M7 usará para el "avance de la estacionalidad" (ver "Lo que M7 necesitará"); no se guarda, se calcula con `curvaAcumulada(curva)`.

### Grano: una curva por agrupación para toda la red (confirmado)

Una curva por agrupación de estacionalidad sobre la red comparable de cada año, no por agrupación × tienda: con 10 tiendas y aperturas y cierres, muchas combinaciones no tendrían ni un año normal completo; el volumen por tienda es ruido en las agrupaciones chicas; Vector-One produjo miles de combinaciones irrevisables. Las 15 curvas de la red se revisan a ojo. La puerta a **M6b (curvas por tienda o por grupo de tiendas)** queda abierta con el diagnóstico `tienda_distinta` (abajo), sin construirla ahora.

### Red comparable por año: por fechas y por datos

Para la participación del año `Y` solo cuentan las tiendas que estuvieron **todo el año**. Se decide **una vez por corrida, por tienda y año, sobre la venta total de la tienda** (nunca por agrupación), con la función pura `redComparable(tiendas, ventaMensualPorTienda, anios, hastaPeriodo, parametros)` en `src/lib/curvas/red.ts`. Una tienda entra en `Y` si cumple todas las condiciones:

| # | Condición | Parámetro (defecto) | Motivo de exclusión |
|---|---|---|---|
| 1 | `tipo = 'Tienda'` y activa en M4. Una tienda **desactivada después** de tener hechos se muestra con motivo propio, no se oculta | — | `centro_distribucion`, `tienda_desactivada` |
| 2 | Fechas de M4: `fecha_apertura ≤ Y-01-01` y `fecha_cierre` nula o `≥ Y-12-31` (en el año en curso, `≥` último día de `hasta_periodo`). Sin `fecha_apertura`: entra con aviso `tienda_sin_apertura` | `solo_tiendas_completas` (activo) | `no_abierta_todo_el_ano` |
| 3 | Tienda nueva: `fecha_apertura + meses_tienda_nueva ≤ Y-01-01`. **Por defecto 0: no aplica** (regla de V1 de Javier); con 12 excluiría el primer año completo de una tienda | `meses_tienda_nueva` (0; 0 a 36) | `tienda_nueva` (con el primer año en que entrará) |
| 4 | Datos de M5: unidades `> 0` en cada uno de los doce meses de `Y` (en el año en curso, en cada mes publicado hasta `hasta_periodo`), sobre la venta total de la tienda | `exigir_venta_todo_el_ano` (activo) | `meses_sin_venta` (lista) |

Avisos derivados de la condición 4: si los meses sin venta son un tramo contiguo desde enero (o desde el primer mes publicado) hasta el **primer mes con venta positiva** de la tienda en toda su serie, `apertura_dudosa` (enlace a M4); si el tramo es contiguo al final y no vuelve a vender, `cierre_dudoso`. Con la red de hoy: la tienda corregida a `2023-06-01` queda fuera de 2023 **por fechas** (y además su primera venta positiva es 2023-07: la regla por datos la habría sacado igual) y entra desde 2024; la tienda abierta el 2025-11-20 queda fuera de 2025 por fechas y **entra en 2026**. Resultado esperado: 8 tiendas en 2023, 9 en 2024 y 2025, 10 en 2026. **Año sin red**: si ninguna tienda cumple, el año es `sin_red_comparable`, no entra y la pantalla sugiere relajar los parámetros.

**Pesos y concentración.** `peso(t, Y) = unidades(t, Y) ÷ Σ_red unidades(Y)` sobre la venta total de la red y, en el detalle, sobre la venta de la agrupación. El peso de cada tienda por año **se muestra siempre** (no solo sobre el umbral). Aviso `tienda_dominante` cuando `max_t peso(t, Y) > umbral_tienda_dominante` (0,35): con la base real salta **solo en 2025** (38,0 %; en 2023, 2024 y 2026 la mayor pesa 31,1, 33,4 y 26,4 %); en 2026 la tienda nueva es el segundo peso (21,7 %). Se calcula también **por agrupación** (una tienda puede pesar 26 % en la red y 60 % en una agrupación chica). El modelo no cambia por esto: la candidata `B` lleva la nota del peso, la `E` sirve de contraste.

**Diagnóstico de tiendas que se comportan distinto (`tienda_distinta`, requisito de Javier).** Para cada año de la red y cada tienda que entra: su participación mensual `p(Y, t)` (sobre la venta total de la tienda a nivel de red, y sobre la venta de la agrupación en el detalle), `eat_vs_red = EAT(p(Y, t), p(Y))` y su peso. Aviso **`tienda_distinta`** cuando `eat_vs_red > max(umbral_forma, ruido_normal)` de la red (o de la agrupación en el detalle) **y** la tienda pesa al menos `peso_minimo_diagnostico` (0,05). Es diagnóstico: no cambia la curva. Con la base real, la tienda nueva mueve la participación enero–setiembre de 2026 de la red ≈ 3,3 pp (perfil propio: enero 14,7 %, invierno más plano); cuando cierre 2026 entrará completa en la curva, y el efecto crece con su peso. **Si una tienda se aparta de verdad y pesa, el siguiente paso es M6b** (curvas por tienda o por grupo de tiendas), no un parche en M6.

**Dónde se ve.** Panel "Red comparable por año" en la pestaña Curvas (de la corrida que se está viendo; antes de la primera corrida, con `GET /api/curvas/red-comparable`, sin `debounce`: botón "Ver red") y en el detalle de cada agrupación con los pesos y perfiles de la agrupación. Se guarda en `corridas_estacionalidad.red_comparable`.

### Curvas vivas: versión, obsolescencia y revisión (requisito de Javier, 2026-10-14)

- **"Vigente" no es definitivo.** Cada aprobación crea una versión nueva (`version + 1`) y la anterior pasa a `reemplazada`; **recalcular y volver a aprobar es la operación normal** del planner, no una excepción. Nada se invalida solo: una curva vigente sigue vigente hasta que el planner apruebe otra o la retire.
- **Obsolescencia por agrupación, con motivo.** Cada curva guarda en `anios_utilizados` las **huellas** con las que se calculó (ver "Salida"): `composicion.huella` (md5 de los ids ordenados de sus equivalencias activas), `red_huella` (md5 del maestro de tiendas: id, tipo, activo, `fecha_apertura`, `fecha_cierre`, ordenado por id) y `cargas` (`{ "aaaa-mm": carga_id }` de los meses publicados usados). `GET /api/curvas` compara con el estado actual y devuelve `obsoleta: { motivos: [...] } | null` por agrupación con estos motivos nombrados: `tienda_entra_red` / `tienda_sale_red` (una tienda cumple su primer año completo, cierra, le corrigieron la fecha de apertura o se desactivó: se detecta comparando la red comparable actual, calculada con `venta_mensual_tienda()` y los parámetros de la corrida de la curva, con la guardada en la corrida, año por año, y se nombra la tienda y el año), `composicion_cambiada` (la huella de equivalencias difiere; con cuántas entran y salen), `carga_nueva` (un mes publicado que la corrida no usó, o un mes republicado con otro `carga_id`), `periodo_cambiado` (un periodo atípico activo que aplica a la agrupación cambió después de la corrida) y `temporada_cambiada` (la temporada de la agrupación difiere de la guardada). Sustituye al aviso global por `updated_at` de la segunda pasada.
- **Pantalla**: en la tabla de Curvas, badge **Obsoleta** con el motivo en texto ("Obsoleta: la tienda X entra en la red de 2026") y botón **Recalcular** (abre la tarjeta Calcular con los parámetros de la corrida de referencia). Tras recalcular, el detalle muestra el **comparador vigente / propuesta** antes de aprobar.
- **Comparador vigente / propuesta** (en el detalle, siempre que haya vigente y corrida): las dos curvas superpuestas en el gráfico, tabla de doce columnas con la diferencia mes a mes en puntos (color por signo, `claseVariacion` de M11) y la **EAT entre ambas**; el `confirm` de aprobar la repite ("Reemplaza la v2: difiere 4,1 pp; el mes que más cambia es enero (+1,8)").
- **Calendario de revisión sugerido** (informativo, en la tarjeta Calcular y en PLAN): recalcular **al cerrar cada año calendario** (cuando se publica diciembre) y **cuando una tienda cumple su primer año completo** (entra a la red); además, siempre que la pantalla marque curvas obsoletas. No hay recálculo automático.
- **Contrato con M7**: cada plan guarda el `id` de la curva y su huella; si después se aprueba una versión nueva, M7 avisa "la curva cambió" y ofrece recalcular el reparto mensual mostrando el impacto; **los totales anuales no cambian por una curva nueva, solo su reparto mensual** (ver "Lo que M7 necesitará").

### Periodos atípicos (catálogo editable)

Tabla `periodos_atipicos`: rango de meses (`desde`, `hasta`), `motivo`, `descripcion`, y el **conjunto de temporadas** a las que aplica (`temporadas text[]`, `0015`): una o varias entre `invierno`, `verano` y `todo_el_ano`. Un periodo aplica a una agrupación si su `temporada` está en el conjunto (`periodoAplica`; con `temporadas` nulo, filas del paso 1, deriva de `alcance`: `invierno` → `{invierno}`, `todas` → las tres). `alcance` es columna heredada: solo `temporadasDePeriodo` y `alcanceEspejo` la tocan. **`tipos-api.ts` documenta que M7 debe leer `periodos[].temporadas` y nunca el espejo `alcance`.**

**Catálogo que Javier cargará** (sin seed): **Niño costero 2023 · invierno** (`2023-01` a `2023-12`, `{invierno}`), **Niño costero 2023 · verano** (`2023-09` a `2023-12`, `{verano}`), **Niño costero 2026 · invierno** (`2026-01` a `2026-12`, `{invierno}`, en curso), **Niño costero 2026 · verano** (`2026-09` a `2026-12`, `{verano}`, en curso). Las agrupaciones `todo_el_ano` no reciben ninguno. **Verano (I11, pendiente de confirmar por Javier)**: se deja setiembre–diciembre y se **mide primero**; no se extiende a enero–marzo del año siguiente. La evidencia de 2023 no muestra todavía un arranque claramente anticipado (setiembre–noviembre 5,4 / 6,1 / 7,8 % frente a 4,2 / 6,6 / 9,3 % en 2024) y **el verano de 2023 bajó** (0,728 frente a 2024 sobre tiendas comunes), así que el periodo de verano puede acabar siendo innecesario: el detalle de la agrupación de verano muestra el **peso de los meses imputados** (suma de `r_m` en setiembre–diciembre) para que Javier vea cuánto de la curva viene de la referencia y no del año.

**Temporada de la agrupación.** No nula, por defecto `todo_el_ano`; la fija el planner desde M3 o desde la tabla de M6. **Sugerencia (I5)**: `temporada_sugerida` sigue siendo la mayoritaria de las líneas de sus equivalencias (M1), pero **solo informa y solo avisa `temporada_sugerida_distinta` cuando la sugerida es `invierno` o `verano`**; si las líneas no informan (todas "Todo el año", como las 87 del árbol real) no hay sugerencia ni aviso. El contador antiguo "con sugerida Invierno sin marcar" se retira porque daba falsa seguridad; en su lugar la pantalla cuenta "N agrupaciones activas siguen en Toda temporada: revísalas" y el hito exige que Javier las revise (hoy 10). Se entiende que el factor de verano sale hoy de **una sola agrupación**. El aviso `temporadas_mezcladas` (líneas de más de una temporada) sigue.

**Cómo afecta un periodo atípico a un año completo `Y` de una agrupación** (`tratamiento_atipicos`: `auto` por defecto, `incluir`, `imputar`, `descartar`):

| Clase | Qué es | Qué se hace |
|---|---|---|
| **Normal** | Ningún mes atípico que aplique | Entra tal cual |
| **Con huecos** | Entre 1 y `max_meses_hueco` (4) meses atípicos | `incluir`: entra tal cual. `imputar`: los meses atípicos se rellenan con la referencia y los demás se reescalan. `descartar`: no entra. `auto`: `incluir` si `forma_estable`, `imputar` si `forma_cambia`, `incluir` con aviso `sin_referencia` si no hay año normal |
| **Atípico completo** | **Más de `max_meses_hueco`** meses atípicos, los doce incluidos (I2; antes solo con 12) | No se imputa nunca. `incluir`: entra tal cual. `imputar` o `descartar`: `descartado` (`atipico_completo`). `auto`: `forma_estable` → `incluido`; `forma_cambia` → `descartado`; `sin_comparacion` → `incluido` con aviso. **Siempre cuenta para el volumen** |

`descartado` es un **tratamiento**, no una clase. Imputación (`imputarHuecos`): `r` = promedio simple de las participaciones de los años normales, `R_A = Σ_{m∈A} r_m`; para `m ∉ A`, `p_m = u_m ÷ Σ_{k∉A} u_k × (1 − R_A)`; para `m ∈ A`, `p_m = r_m`. Con el catálogo confirmado: toda temporada → 2023, 2024, 2025 normales; invierno → 2023 atípico completo, 2024 y 2025 normales, 2026 en curso; verano → 2023 con huecos (4), 2024 y 2025 normales, 2026 en curso con huecos declarados.

### Efecto de un periodo atípico: volumen y forma

Para cada agrupación de `invierno` o `verano` y cada año atípico (con huecos, completo o en curso), dos medidas separadas:

**1. Volumen** (`efecto_atipico.volumen`, por año). Sobre **tiendas comunes** (`red(Y) ∩ red(N)`) frente al **año normal más cercano** `N` (`mas_cercano`: 2023 → 2024, 2026 → 2025; la opción `promedio` se recorta): `ratio_volumen(Y) = Σ_{m∈M} u_Y,m ÷ Σ_{m∈M} u_N,m`, con `M` los doce meses o, en el año en curso, solo los cargados (2026 ene–set frente a 2025 ene–set); `ratio_mensual` mes a mes; también el ratio contra cada año normal (sensibilidad). Sin tiendas comunes o referencia 0 → `null`, aviso `sin_referencia_volumen`. Se calcula por agrupación (diagnóstico) y **por temporada** (sumando las agrupaciones de la temporada sobre las tiendas comunes), más `red` (todas).

**2. Ratio relativo y control (B3)**, por temporada y año atípico, guardado en `efecto_atipico.por_temporada[]`: `ratio_temporada`, `ratio_control` = el ratio de **toda temporada** del mismo año sobre las mismas tiendas comunes, **`ratio_relativo = ratio_temporada ÷ ratio_control`** y `crecimiento_normal` = ratio entre los dos años normales de la misma temporada (2025/2024 sobre sus tiendas comunes). Lectura con la base real: invierno 2026 ene–set 0,660 con control 0,975 → relativo ≈ 0,68; invierno 2023 0,626 con control 0,949 → ≈ 0,66 (el invierno de los dos años Niño queda un tercio por debajo de la red); verano 2026 1,238 con control 0,975 → ≈ 1,27, **del mismo orden que el crecimiento normal del verano (1,287)**: el volumen de verano de 2026 no muestra todavía un efecto Niño separable del crecimiento; verano 2023 0,728 con control 0,949 → ≈ 0,77: **bajó**. No hay etiqueta de "sustitución" ni umbral: es una tabla de ratios con sus controles.

**3. Forma** (`efecto_atipico.forma`, por agrupación y año). Referencia `r` = promedio simple de los años normales. Por año atípico completo: `diferencia_anio = EAT(p(Y), r)` en puntos, `pico`, `pico_referencia`, `corrimiento_pico` (en círculo; negativo = se adelanta), `mes_mayor_diferencia`. **Ruido normal**: `ruido_normal = EAT(p(N_a), p(N_b))` con dos normales; con más, el promedio de las EAT entre pares; con uno, `null`. **Veredicto (B1, pendiente de confirmar por Javier)**: `umbral_efectivo = max(umbral_forma, ruido_normal ?? 0)`; `forma_cambia` si `diferencia_anio > umbral_efectivo`, `forma_estable` si no, `sin_comparacion` sin año normal. `umbral_forma` (3 pp) es el **piso**: con el ruido real de invierno (24 a 66 pp por agrupación) un umbral fijo de 3 pp declararía "cambia" a cualquier año; por eso el veredicto es relativo al ruido y la pantalla muestra siempre las tres cifras ("difiere 31 pp de la referencia; los dos años normales difieren 33 pp entre sí: estable respecto al ruido"). Ya no existe el aviso `umbral_bajo_ruido`: es parte de la explicación. **Año en curso (I7)**: forma parcial sobre los `k` meses cargados, renormalizados, en **dos versiones** que se muestran juntas: sobre la **red completa** de 2026 y sobre las **tiendas comunes con 2025** (para separar el efecto de la tienda nueva del efecto del año); `parcial: true`, informativa, nunca cambia el tratamiento. Veredicto por agrupación: `forma_cambia` si algún año completo lo es; `forma_estable` si todos; `sin_comparacion` si ninguno es comparable. `c_inc` / `c_sin` / `diferencia_forma` se siguen calculando para la pantalla (la cifra diluida de la curva). El tratamiento efectivo bajo `auto` sale del veredicto; `incluir`, `imputar` y `descartar` mandan.

**Lo que recibe M7**: `efecto_atipico.por_temporada[]` de la **corrida de referencia** (factor de volumen **solo por temporada**, con `agrupaciones: N` al lado de cada factor; por agrupación solo como diagnóstico, I3), más `claseDeAnio` y `/anios`. Es calculado y editable en M7 (decisión 8).

### Pocos años, agrupaciones pequeñas y curva prestada (I3)

- **Año escaso**: un año utilizable con menos de `min_unidades_ano` (120) unidades se marca `escaso` y **no entra en el ajuste de las candidatas** (sí en el gráfico y en la tabla, atenuado). Aviso **`cambio_volumen_extremo`** cuando el cociente de unidades entre dos años utilizables consecutivos es `> umbral_cambio_volumen` (3) o `< 1/3` (dos agrupaciones reales tienen años de 26 a 600 unidades y meses en cero).
- **Años de ajuste** = utilizables (normales, incluidos, imputados) y no escasos. Con **dos o más** hay curva propia y backtesting (`n` pliegues). Con **menos de dos**, no hay candidatas propias: la única es **`T`, la curva de la temporada** (prestada), y la pantalla lo dice ("sin años suficientes: curva de la temporada").
- **`T`, curva de la temporada** (sustituye a `F`): se calcula una vez por corrida y temporada como si la temporada fuera una agrupación: la serie es la suma de todas las agrupaciones activas de esa temporada sobre la red comparable de cada año, con la misma clasificación de años (misma temporada → mismos meses atípicos) y el mismo tratamiento; candidata `A` sobre esos años. Aparece en la tabla de candidatas de toda agrupación como línea de referencia ("su temporada"), sin EAT propia frente a la agrupación (no se backtestea por agrupación), **elegible siempre** pero **recomendada solo cuando no hay propias**; al elegirla, `origen = 'prestada'`. No lee `genero_id`.
- **Pocos años normales**: con solo 2024 y 2025 normales (invierno hoy) el backtesting tiene dos pliegues de un año y `A`, `B` y `C` coinciden con el año de entrenamiento; aviso `pocos_anos_normales` (menos de tres). Si 2023 resulta `forma_estable`, entra `incluido` y los pliegues pasan a tres (el aviso se mantiene: "2 normales + 1 atípico incluido"). El año en curso nunca entra en el ajuste.

### Año en curso y validación parcial

Para cada candidata, EAT entre la participación real dentro de los `k` meses cargados (excluyendo los atípicos que apliquen) y la candidata renormalizada a esos meses; se exige `k − |A| ≥ 6`. Para invierno en 2026 (todos los meses atípicos) no hay validación parcial: la lectura es la forma parcial del efecto atípico. No entra en la recomendación.

### Liquidación: el CV % como señal

CV % = `costo_vendido ÷ venta_soles` por **agrupación × mes** (sobre la red del año). Un mes está en liquidación si su CV % supera la mediana de los meses no atípicos del año en más de `umbral_liquidacion` (0,15, relativo). Se marca en el gráfico (punto ámbar) y en la tabla, con aviso `liquidacion_fuerte` (más de tres meses en algún año). **No hay candidatas deflactadas ni en soles en esta entrega** (`G`, `H` y el CV % por línea quedan para la segunda); la curva base refleja lo que de verdad se vendió.

## El modelo: candidatas, backtesting y recomendación

TypeScript puro en el servidor (`src/lib/curvas/modelo.ts` y vecinos), sin dependencias; SQL solo agrega. Con 15 agrupaciones × 5 candidatas × 2 a 4 pliegues el cálculo es de milisegundos; lo que cuesta es el refresco del agregado (2 a 5 s).

### Entrada del modelo

```ts
type SerieAnual = { anio: number; meses: number[12]; completo: boolean };
type EntradaAgrupacion = {
  agrupacion_id: string; temporada: "invierno" | "verano" | "todo_el_ano";
  composicion: { equivalencias: number; huella: string };                           // I9: md5 de los ids ordenados de sus equivalencias activas
  unidades: SerieAnual[]; venta: SerieAnual[]; costo: SerieAnual[];                 // sumadas sobre la red comparable de cada año; ceros desde los meses publicados
  por_tienda: { tienda_id: string; unidades: SerieAnual[] }[];                      // solo tiendas de la red de cada año: E, pesos, tiendas comunes, diagnóstico
  atipicos: Set<"aaaa-mm">;
  temporada_sugerida: "invierno" | "verano" | "todo_el_ano" | null;                 // null cuando las líneas no informan (I5)
};
type RedAnio = { anio: number; tiendas: { tienda_id: string; entra: boolean; motivos: string[]; meses_sin_venta: string[]; unidades: number; peso: number;
                                          participacion: number[] | null; eat_vs_red: number | null; distinta: boolean }[];
                 total_unidades: number; dominante: string | null; sin_red: boolean; participacion: number[] | null };
type Parametros = {
  solo_tiendas_completas: boolean; exigir_venta_todo_el_ano: boolean; meses_tienda_nueva: number; umbral_tienda_dominante: number;
  tratamiento_atipicos: "auto" | "incluir" | "imputar" | "descartar"; umbral_forma: number; max_meses_hueco: number;
  min_unidades_ano: number; umbral_cambio_volumen: number; margen_ruido: number; peso_minimo_diagnostico: number; umbral_liquidacion: number };
```

### Paso 1 · Clasificar los años y obtener las participaciones reales

Para cada año completo: `normal`, `con_huecos` o `atipico_completo`; el efecto atípico fija el tratamiento efectivo bajo `auto`; participación `p(Y)` (tal cual o imputada); `escaso` si no llega a `min_unidades_ano`. Resultado: `anios_utilizables` y `anios_ajuste` (los utilizables no escasos), con los avisos por año.

### Paso 2 · Candidatas (catálogo `MODELOS`)

| Código | Nombre | Cálculo | Cuándo aporta |
|---|---|---|---|
| `A` | Promedio simple | media de `p(Y)` sobre `anios_ajuste`, renormalizada | base; con un solo año sería ese año (pero con uno no hay propias) |
| `B` | Ponderado por volumen | `Σ_Y u_m(Y) ÷ Σ_Y Σ_k u_k(Y)` (imputados: medidas reescaladas) | los años grandes pesan más; lleva la nota del peso de la tienda dominante |
| `C` | Ponderado por recencia | pesos `1, 2, …, n` del más antiguo al más reciente | la estacionalidad está cambiando |
| `D` | Suavizada | `A` + media móvil circular de 3 meses (`0,25 · 0,5 · 0,25`), renormalizada | picos de un mes que no se repiten |
| `E` | Promedio de tiendas | por año, la media simple de `p(Y, t)` de las tiendas de la red con ≥ `min_unidades_ano` en la agrupación; `E` = `A` sobre esas curvas | contraste frente a la tienda dominante; `null` con `sin_tiendas_validas` |
| `T` | Curva de la temporada (prestada) | `A` sobre la serie agregada de la temporada (ver arriba) | única candidata sin años de ajuste suficientes; referencia en las demás |

Orden de desempate `A, B, C, D, E` (`T` nunca compite). **`igual_a` (I1)**: una candidata cuya curva es idéntica a otra anterior en el orden (`max_m |Δp_m| < 1e-6`) se marca `igual_a: "A"` y la pantalla la muestra como "Igual a A"; ocurre, por ejemplo, con dos pliegues (`A = B = C` en cada pliegue) y en agrupaciones con una sola tienda válida (`E = A`).

### Paso 3 · Backtesting (dejar un año fuera)

Para cada año de ajuste `T` (pliegue), cada candidata se ajusta sin `T` y se compara con la participación real de `T`. Métrica **EAT** (`Σ_m |ĉ_m − p_m| × 100`, en puntos, 0 a 200) y error máximo mensual. Se guarda la **EAT de cada pliegue** (`eat_por_pliegue: [{ anio, eat, error_max }]`) además del promedio. Con un solo año de ajuste no hay pliegues (y no hay propias).

### Paso 4 · Recomendación (I1, pendiente de confirmar por Javier)

Sea `mejor = argmin EAT` entre las propias con backtesting y `margen = max(EMPATE_EAT = 0,05; margen_ruido (0,25) × ruido_normal)` (con `ruido_normal` nulo, `EMPATE_EAT`). Si `EAT_mejor > EAT_A − margen`, la recomendada es **`A`** con `motivo_recomendacion = "sin_evidencia"` ("sin evidencia para apartarse del promedio"); si no, `mejor` con `motivo_recomendacion = "menor_error"`. Empate exacto entre las demás → la primera en el orden. Sin años de ajuste suficientes → `T` con `origen = 'prestada'`; sin ningún año → `null` y aviso `sin_anos_utilizables`. El detalle muestra la **frase comparativa**: "B se equivoca 27,4 pp frente a 29,1 de A en 2 pruebas; la diferencia (1,7) es menor que la que hay entre dos años normales (33): se recomienda A". Además: **estabilidad** (1 − Σ sd mensual, Alta/Media/Baja), **banda por mes** (`banda: [{ min, max }]` de `p_m` entre años de ajuste: la incertidumbre que M7 podrá mostrar), validación parcial, efecto atípico, avisos.

**Avisos por agrupación**: `sin_anos_utilizables`, `pocos_anos_ajuste` (menos de dos: curva prestada), `escaso` (con los años), `cambio_volumen_extremo`, `meses_sin_cargar`, `mes_negativo`, `forma_cambia`, `sin_referencia`, `sin_referencia_volumen`, `pocos_anos_normales`, `ano_atipico_completo` (con cuántos meses y su tratamiento), `temporada_sugerida_distinta` (solo con sugerida invierno o verano), `temporadas_mezcladas`, `liquidacion_fuerte`, `sin_venta`, `inactiva_con_curva`, `tienda_dominante` (año y peso, sobre la agrupación), `tienda_distinta` (tienda, año, EAT y peso), `sin_red_comparable`, `prestada`.

### Salida (lo que guarda la corrida)

`resultado` = `{ agrupaciones: [...], temporadas: [...] }`. Por agrupación:

```jsonc
{ "agrupacion_id": "…", "temporada": "invierno", "temporada_sugerida": null, "origen": "propia",
  "composicion": { "equivalencias": 140, "huella": "md5…" },                                      // I9
  "efecto_atipico": {
    "volumen": [ { "anio": 2023, "clase": "atipico_completo", "ratio_volumen": 0.63, "meses_comparados": 12, "anio_referencia": 2024,
                   "por_anio_normal": [ { "anio": 2024, "ratio": 0.63 }, { "anio": 2025, "ratio": 0.61 } ], "tiendas_comunes": 7,
                   "unidades": 2980, "unidades_referencia": 4730, "ratio_mensual": [0.60, …] },
                 { "anio": 2026, "clase": "en_curso", "ratio_volumen": 0.66, "meses_comparados": 9, "anio_referencia": 2025, … } ],
    "forma": { "veredicto": "forma_estable", "umbral": 3, "ruido_normal": 33.0, "umbral_efectivo": 33.0, "diferencia_forma": 9.8, "c_inc": [ … ], "c_sin": [ … ],
               "por_anio": [ { "anio": 2023, "diferencia_anio": 31.2, "pico": 6, "pico_referencia": 6, "corrimiento_pico": 0, "mes_mayor_diferencia": 4,
                               "veredicto": "forma_estable", "tratamiento_aplicado": "incluido", "parcial": false },
                             { "anio": 2026, "parcial": true, "meses_comparados": 9, "red_completa": { "diferencia_anio": 12.1, "pico": 7 },
                               "tiendas_comunes": { "diferencia_anio": 9.4, "pico": 7, "tiendas": 9 }, "veredicto": null, "tratamiento_aplicado": null } ] } },
  "anios": [ { "anio": 2023, "clase": "atipico_completo", "meses_atipicos": 12, "tratamiento": "incluido", "unidades": 2980, "escaso": false, "en_ajuste": true,
               "tiendas_en_red": 8, "peso_tienda_mayor": 0.31, "participacion": [ … ], "liquidacion": ["2023-07"],
               "por_tienda": [ { "tienda_id": "…", "unidades": 930, "peso": 0.31, "participacion": [ … ], "eat_vs_red": 8.2, "distinta": false } ] },   // lo que M7 necesita (unidades por tienda × agrupación × año) y el diagnóstico
             { "anio": 2024, "clase": "normal", … }, { "anio": 2025, "clase": "normal", … },
             { "anio": 2026, "clase": "en_curso", "meses_cargados": 9, "meses_atipicos": 9, "participacion_parcial": [ … 9 … ], "por_tienda": [ … ] } ],
  "candidatas": [ { "modelo": "A", "curva": [ … ], "eat": 29.1, "error_max": 7.0, "pliegues": 3, "eat_por_pliegue": [ { "anio": 2023, "eat": 31.0, "error_max": 7.0 }, … ],
                    "eat_parcial": null, "igual_a": null },
                  { "modelo": "B", "curva": [ … ], "eat": 27.4, … }, { "modelo": "E", "curva": null, "motivo": "sin_tiendas_validas" },
                  { "modelo": "T", "curva": [ … ], "eat": null, "prestada": true } ],
  "recomendada": "A", "motivo_recomendacion": "sin_evidencia", "margen": 8.25, "estabilidad": 0.71,
  "banda": [ { "min": 0.018, "max": 0.024 }, … ], "cv_mensual": [ { "periodo": "2023-01", "cv": 0.52 }, … ],
  "avisos": [ { "codigo": "pocos_anos_normales", "detalle": "2 años normales (2024, 2025)" }, { "codigo": "tienda_distinta", "detalle": "2026: tienda X, 14,2 pp, peso 22 %" } ] }
```

Por temporada (`resultado.temporadas[]`): `{ temporada, agrupaciones: N, anios: [ … como arriba, sin por_tienda … ], curva_T: [ … ], anios_ajuste: [ … ] }`. `resultado` pesa **del orden de decenas de KB** (15 agrupaciones × 3 a 6 KB; `check` de 4 MB en la `0015` sobra).

`resumen`: `{ agrupaciones_activas, propias, prestadas, sin_venta, con_avisos, anios_por_clase, agregado: { filas_mv: 85385, refrescada_at, duracion_ms }, meses_publicados: { desde, hasta, faltantes }, unidades_sin_agrupacion, red_huella, cargas: { "2023-01": "carga_id", … }, duracion_ms }` (I9: `red_huella` y `cargas` son las huellas de obsolescencia; `unidades_sin_agrupacion` sale de las filas con agrupación nula del agregado y se guarda aquí para que `GET /api/curvas` no lea la MV).

`efecto_atipico` (nivel corrida, lo que leen la pestaña Años Niño y M7):

```jsonc
{ "umbral_forma": 3, "margen_ruido": 0.25,
  "por_temporada": [ { "anio": 2023, "temporada": "invierno", "agrupaciones": 4, "ratio_volumen": 0.626, "ratio_control": 0.949, "ratio_relativo": 0.66, "crecimiento_normal": 1.034,
                       "anio_referencia": 2024, "tiendas_comunes": 7, "meses_comparados": 12, "unidades": 43000, "unidades_referencia": 68700, "ratio_mensual": [ … ] },
                     { "anio": 2026, "temporada": "invierno", "agrupaciones": 4, "ratio_volumen": 0.660, "ratio_control": 0.975, "ratio_relativo": 0.68, "crecimiento_normal": 1.034, "meses_comparados": 9, … },
                     { "anio": 2026, "temporada": "verano", "agrupaciones": 1, "ratio_volumen": 1.238, "ratio_control": 0.975, "ratio_relativo": 1.27, "crecimiento_normal": 1.287, … },
                     { "anio": 2026, "temporada": "todo_el_ano", "agrupaciones": 10, "ratio_volumen": 0.975, "ratio_control": null, "ratio_relativo": null, "crecimiento_normal": 1.104, … },
                     { "anio": 2026, "temporada": "red", "agrupaciones": 15, "ratio_volumen": 0.93, … } ],
  "crecimiento_normal": [ { "temporada": "invierno", "anio": 2025, "anio_referencia": 2024, "ratio": 1.034, "tiendas_comunes": 9 }, … ],   // lo que M7 necesita
  "forma": { "invierno": { "forma_estable": 3, "forma_cambia": 1, "sin_comparacion": 0, "ruido_normal": [24, 33, 38, 66] }, "verano": { … } },
  "avisos": [ { "codigo": "pocos_anos_normales", "detalle": "invierno: 2 años normales (2024, 2025)" } ] }
```

(Cifras ilustrativas donde no se indica lo contrario; las que coinciden con la base real son agregados sin nombres.)

### Lo que M7 necesitará y M6 guarda

| Dato | Dónde queda en M6 | Estado |
|---|---|---|
| Curva vigente por agrupación (`p01..p12`) y su **curva acumulada** (`curvaAcumulada`, función pura exportada) | `curvas_estacionalidad`; `GET /api/curvas/vigentes` devuelve `curva` y `acumulada` | M6 |
| **Versión de la curva** (`id`, `version`, huellas) para que el plan guarde cuál usó y M7 avise "la curva cambió" y recalcule solo el reparto mensual (los totales anuales no cambian) | `curvas_estacionalidad.id`, `version`, `anios_utilizados.{composicion, red_huella, cargas_huella}`; `GET /api/curvas/vigentes` los incluye | M6 (contrato); el aviso y el recálculo son de M7 |
| Factor de volumen del Niño **por temporada y año** y **crecimiento entre años normales por temporada** | `efecto_atipico.por_temporada[]`, `efecto_atipico.crecimiento_normal[]` de la corrida de referencia; `/anios` los copia | M6 (calculado); edición en M7 |
| Unidades por **tienda × agrupación × año** (red comparable) | `resultado.agrupaciones[].anios[].por_tienda[]` | M6 |
| **Banda de incertidumbre por mes** (mínimo y máximo entre años de ajuste) | `resultado.agrupaciones[].banda` | M6 |
| Pesos para mezclar las curvas de las equivalencias de un GML (unidades por equivalencia × año; 68 nodos GML reparten sus equivalencias entre 2 o 3 agrupaciones) | **M7**: no están en la MV (no lleva `equivalencia_id`); M7 los lee con una función suya sobre `venta_stock_vigente` (equivalencia × año, ~mil filas) | M7 |
| Id de la **corrida de referencia** | `corridas_estacionalidad.referencia`; toda respuesta de M6 que lea de ella devuelve `corrida_id` | M6 |
| Proyección del resto del año (avance de ventas ÷ avance de la estacionalidad) | M7 (ver nota en la ficha 07); M6 solo entrega la curva acumulada | M7 |

## Modelo de datos

Migraciones: `0011` (paso 1, aplicada), **`0015_curvas_estacionalidad.sql` (aplicada en `vector-two` el 2026-10-14; se mantiene tal cual)** y **`0016_agregado_estacionalidad.sql` (nueva, pequeña)**. Todas idempotentes, sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE` (tampoco dentro de funciones), sin bloques `do $$`, `create … if not exists` / `create or replace`, RLS activo sin políticas en toda tabla nueva, `revoke` a `public`, `anon` y `authenticated` más `grant` a `service_role` sobre cada objeto nuevo, `security invoker` y `search_path = ''` en las funciones, como `0014` y `0015`. `datos` verifica que la última migración siga siendo la `0015`; si otra se adelantó, la `0016` toma la siguiente libre y se anota aquí.

### Lo que ya existe (`0011` y `0015`, aplicadas)

- `agrupaciones_estacionalidad.temporada text not null default 'todo_el_ano'` (`check` de tres valores).
- `periodos_atipicos` (`desde`, `hasta`, `motivo`, `descripcion`, `alcance` heredada, **`temporadas text[]`** con `check` de cardinalidad 1 a 3 y `<@` la lista, `activo`, `created_at`, `updated_at`; índice por `desde`).
- Vista materializada **`venta_mensual_estacionalidad`** (`agrupacion_estacionalidad_id` nullable, `genero_id`, `linea_id`, `tienda_id`, `periodo`, `unidades`, `venta_soles`, `costo_vendido`; `left join`; `with no data`; índice único sobre el grano con `coalesce`; índices `(agrupacion, periodo)` y `(linea, periodo)`; **dueña `service_role`**; `revoke` a `anon`/`authenticated`). Hoy tiene **85 385 filas**. Es la primera excepción a "RLS activo sin políticas" (una MV no admite RLS); queda protegida con `revoke`.
- **`refrescar_venta_mensual_estacionalidad() returns jsonb`** (`plpgsql`, `security invoker`): `refresh` sin `concurrently`, devuelve `{ filas, duracion_ms, refrescada_at }`.
- **`venta_mensual_tienda()`** (`sql`, `stable`): venta por tienda y mes sobre `venta_stock_vigente` (~500 filas) para la red comparable sin corrida y para la obsolescencia por red.
- **`corridas_estacionalidad`** (`hasta_periodo`, `parametros`, `resultado` con `check` de 4 MB, `resumen`, `red_comparable`, `efecto_atipico`, `perfil_id`, `usuario_nombre`, `activo`, fechas; índices por `created_at desc` y `perfil_id`).
- **`curvas_estacionalidad`** (`agrupacion_estacionalidad_id` FK `restrict`, `version`, `estado` `vigente`/`reemplazada`/`retirada` con único parcial por agrupación `where estado = 'vigente'`, `corrida_id` FK `restrict`, `modelo` (1 a 10 caracteres: admite `A`…`E` y `T`), `origen`, `recomendada`, `eat`, `error_max`, `anios_utilizados jsonb`, `p01..p12` con `check` de rango y de suma, `medida`, `perfil_id`, `usuario_nombre`, `aprobada_at`, `nota`, `activo`, fechas).

Los campos nuevos de esta pasada (`composicion`, `red_huella`, `cargas`, `eat_por_pliegue`, `banda`, `por_tienda`, `ratio_relativo`…) viven **dentro de los `jsonb` existentes** (`resultado`, `resumen`, `efecto_atipico`, `anios_utilizados`); no hace falta tocar la `0015`.

### `0016_agregado_estacionalidad.sql` (nueva, pequeña)

**1. Función `refrescar_y_leer_agregado_estacionalidad() returns jsonb`** (`plpgsql`, `security invoker`, `set search_path = ''`, `revoke execute … from public, anon, authenticated`, `grant execute … to service_role`). Es la **única** lectura del agregado que hace M6 y la hace en **una sola sentencia**:

1. `if not pg_try_advisory_xact_lock(hashtext('venta_mensual_estacionalidad')) then raise exception 'calculo_en_curso' using errcode = '55P03'; end if;` (lock de aviso ligado a la transacción de la llamada: dos `calcular` a la vez no se pisan el refresco; el segundo recibe el error y el handler responde `409 calculo_en_curso`).
2. `v_refresco := public.refrescar_venta_mensual_estacionalidad();` (reutiliza la `0015`; `service_role` es dueña de la MV).
3. Devuelve `jsonb_build_object('refresco', v_refresco, 'filas', (select coalesce(jsonb_agg(jsonb_build_object('agrupacion_id', agrupacion_estacionalidad_id, 'tienda_id', tienda_id, 'periodo', periodo, 'unidades', unidades, 'venta_soles', venta_soles, 'costo_vendido', costo_vendido)), '[]'::jsonb) from (select agrupacion_estacionalidad_id, tienda_id, periodo, sum(unidades) unidades, sum(venta_soles) venta_soles, sum(costo_vendido) costo_vendido from public.venta_mensual_estacionalidad group by 1, 2, 3) g))`.

Por qué `jsonb` y no `setof`: el grano agrupación × tienda × mes son **≈ 6 500 filas** (15 agrupaciones + la nula × 10 tiendas × 45 meses), por encima del corte de 1 000 filas de PostgREST; paginar un `rpc` con `range` **reejecutaría la función** (y el refresco) por página, y paginar la MV con `leerTodo` (86 páginas) no es atómico y un refresco concurrente la dejaría a medias. Un `jsonb` de ~6 500 objetos pesa ≈ 1 MB y viaja en una respuesta. Las filas con `agrupacion_id` nulo se devuelven (dan `unidades_sin_agrupacion` y entran en la venta total por tienda de la red). `genero_id` y `linea_id` no salen: nada los usa en esta entrega.

**2. `corridas_estacionalidad.referencia boolean not null default false`** (`add column if not exists`) e índice único parcial `corridas_estacionalidad_referencia_uniq on (referencia) where referencia`: a lo sumo una corrida de referencia. La escribe la API (`PATCH /api/curvas/corridas/[id]`), nunca la migración. `comment on column` que lo diga.

Sin tablas nuevas, sin cambios en la MV. Regla 30 (SQL de humo) y 31 (estático) la cubren.

### Diagrama

```
periodos_atipicos (desde, hasta, temporadas[]) ┐
agrupaciones_estacionalidad.temporada ─────────┼─► POST /api/curvas/calcular ─► corridas_estacionalidad (resultado, resumen, red_comparable, efecto_atipico, referencia)
venta_stock_vigente ─► [0016: lock + refresh + jsonb] venta_mensual_estacionalidad ┘                 │ el planner revisa el detalle y aprueba UNA curva por agrupación
tiendas (M4) + venta_mensual_tienda(): red comparable y obsolescencia por red                         ▼
                                                                   curvas_estacionalidad (una `vigente` por agrupación, versionada, con huellas) ─► M7 (guarda id y versión)
```

## Contratos de API

Convenciones de M1 a M5: `{ data }` con `ok()` y `{ error }` con `error()` (`src/lib/api/respuestas.ts`), cuerpos con `leerCuerpo`, esquemas zod en `src/lib/curvas/esquemas.ts`, `idDeRuta`, `traducirErrorDb`, `leerTodo` solo para tablas pequeñas (periodos, agrupaciones, tiendas, corridas). **Toda ruta de M6 exige `requirePlanner`**. Handlers en `src/app/api/curvas/` y `src/app/api/periodos-atipicos/`; lógica pura en `src/lib/curvas/` (`modelo.ts`, `candidatas.ts`, `backtesting.ts`, `atipicos.ts`, `anios.ts`, `red.ts`, `liquidacion.ts`, `obsolescencia.ts`, `reglas.ts`, `grafico.ts`, `esquemas.ts`, `tipos.ts`, `tipos-api.ts`); acceso a datos en `consultas.ts` (el único que nombra `venta_mensual_estacionalidad`, `refrescar_y_leer_agregado_estacionalidad` y `venta_mensual_tienda`). Errores: `401` sin sesión · `403` sin perfil, inactivo o comprador · `400` zod · `404` id inexistente o no UUID · `409` regla de negocio, único, FK o `calculo_en_curso` · `500`.

Constantes (`src/lib/curvas/tipos.ts`; las del cliente en `tipos-api.ts`): `MAX_MESES_HUECO = 4`, `UMBRAL_FORMA = 3`, `MIN_UNIDADES_ANO = 120`, `UMBRAL_CAMBIO_VOLUMEN = 3`, `MARGEN_RUIDO = 0.25`, `EMPATE_EAT = 0.05`, `PESO_MINIMO_DIAGNOSTICO = 0.05`, `MIN_MESES_VALIDACION_PARCIAL = 6`, `UMBRAL_LIQUIDACION = 0.15`, `MESES_TIENDA_NUEVA = 0`, `UMBRAL_TIENDA_DOMINANTE = 0.35`, `CLASES_ANIO = ["normal", "con_huecos", "atipico_completo", "incompleto", "en_curso"]`, `TRATAMIENTOS_ANIO = ["incluido", "imputado", "descartado"]`, `MOTIVOS_RED` (`centro_distribucion`, `tienda_desactivada`, `no_abierta_todo_el_ano`, `tienda_nueva`, `meses_sin_venta`, `apertura_dudosa`, `cierre_dudoso`, `tienda_sin_apertura`), `MOTIVOS_OBSOLETA` (`tienda_entra_red`, `tienda_sale_red`, `composicion_cambiada`, `carga_nueva`, `periodo_cambiado`, `temporada_cambiada`), `MODELOS` (`A`, `B`, `C`, `D`, `E` propias en orden de desempate; `T` prestada), `TEMPORADAS_AGRUPACION`, `ALCANCES_PERIODO` (heredado). **`tipos-api.ts` lleva el comentario de contrato: "M7 lee `periodos[].temporadas`; `alcance` es un espejo heredado y no debe usarse."**

### Periodos atípicos

| Ruta | Método | Cuerpo | Respuesta |
|---|---|---|---|
| `/api/periodos-atipicos` | GET | — | arreglo por `desde` con `meses`, `temporadas` (efectivo) y `agrupaciones_afectadas`; `alcance` (espejo) por compatibilidad. `?incluir_inactivos=1` |
| `/api/periodos-atipicos` | POST | `crearPeriodoAtipicoSchema` | `201` fila; `400` zod |
| `/api/periodos-atipicos/[id]` | PATCH | `editarPeriodoAtipicoSchema` | fila; `404`; `400` rango invertido |
| `/api/periodos-atipicos/[id]` | DELETE | — | `{ id }` |

```ts
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
crearPeriodoAtipicoSchema = z.object({
  desde: mes, hasta: mes, motivo: z.string().trim().min(1).max(120),
  descripcion: z.string().trim().max(500).transform(v => v === "" ? null : v).nullable().optional(),
  temporadas: z.array(z.enum(TEMPORADAS_AGRUPACION)).min(1).max(3).refine(sinRepetidos).default(["invierno"]),
  alcance: z.enum(["invierno", "todas"]).optional(),       // heredado: sin `temporadas`, se traduce; con los dos y contradictorios → 400
}).refine(v => v.hasta >= v.desde, { message: "El mes final no puede ser anterior al inicial.", path: ["hasta"] });
editarPeriodoAtipicoSchema = z.object({ desde, hasta, motivo, descripcion, temporadas, alcance, activo }).partial().refine(noVacio);
// El handler escribe siempre `temporadas` y el espejo `alcance` (`alcanceEspejo`).
```

### Lectura para M7: qué años fueron atípicos (contrato estable)

`claseDeAnio(anio, agrupacion, periodos, mesesPublicados)` en `atipicos.ts` devuelve `{ anio, clase: "normal" | "atipico", meses_atipicos, periodos: [{ id, motivo, alcance, temporadas }], completo }`; su forma no cambia (test de contrato). **`GET /api/periodos-atipicos/anios`** (`?agrupacion_id=` o `?temporada=`, `?desde=&hasta=`) devuelve lo mismo por año más, **desde la corrida de referencia** (I10): `ratio_volumen` (el de la **temporada** de la agrupación o la temporada pedida, nivel temporada siempre, I3), `volumen: { nivel: "temporada", temporada, ratio_control, ratio_relativo, crecimiento_normal, anio_referencia, tiendas_comunes, meses_comparados, agrupaciones, ratio_agrupacion (diagnóstico, solo con ?agrupacion_id), corrida_id } | null` y, en `data`, `corrida_id` (la de referencia) o `null`. Sin corrida de referencia, `ratio_volumen` y `volumen` son `null`.

### Temporada de la agrupación (cambio en M3, construido)

`POST`/`PATCH /api/agrupaciones-estacionalidad` aceptan `temporada`; `GET` devuelve `temporada`, `temporada_sugerida` y `temporada_sugerida_distinta`. **Cambio I5**: `temporada_sugerida_distinta` es falso cuando la sugerida es `todo_el_ano` (las líneas no informan). Cambiar la temporada no recalcula nada: `GET /api/curvas` lo marca como `temporada_cambiada` en la obsolescencia de esa agrupación.

### Estado general

`GET /api/curvas` (`?corrida_id=` opcional: por defecto la de referencia; sin referencia, la última):

```jsonc
{ "data": {
  "datos": { "desde": "2023-01", "hasta": "2026-09", "meses_publicados": 45, "faltantes": [], "ultimo_mes_cerrado": "2026-09" },
  "corrida": { "id": "…", "created_at": "…", "hasta_periodo": "2026-09", "referencia": true, "parametros": { … }, "resumen": { … } } | null,
  "corridas": [ { "id", "created_at", "hasta_periodo", "referencia", "usuario_nombre", "resumen": { "propias", "prestadas", "sin_venta" } } ],   // últimas 20, para el selector
  "agrupaciones": [
    { "id": "…", "nombre": "…", "codigo": "…", "activo": true, "temporada": "invierno", "temporada_sugerida": null, "generos": ["HOMBRE"], "equivalencias_activas": 140, "con_venta": true,
      "vigente": { "id": "…", "version": 2, "modelo": "A", "origen": "propia", "recomendada": true, "eat": 29.1, "aprobada_at": "…", "usuario_nombre": "…", "corrida_id": "…", "curva": [ … ] } | null,
      "obsoleta": { "motivos": [ { "codigo": "tienda_entra_red", "detalle": "tienda X entra en la red de 2026" } ] } | null,                       // I9 + requisito de Javier
      "propuesta": { "recomendada": "A", "motivo_recomendacion": "sin_evidencia", "eat": 29.1, "difiere_de_vigente": true, "eat_vs_vigente": 4.1, "veredicto_forma": "forma_estable", "avisos": [ … ] } | null } ],
  "periodos_atipicos": [ … activos con temporadas … ],
  "resumen": { "agrupaciones_activas": 15, "por_temporada": { "invierno": 4, "verano": 1, "todo_el_ano": 10 }, "sin_revisar_toda_temporada": 10,
               "con_curva_vigente": 0, "sin_curva_con_venta": 15, "sin_venta": 0, "vigentes_prestadas": 0, "obsoletas": 0, "propuestas_distintas": 0, "inactivas_con_curva": 0,
               "unidades_sin_agrupacion": 1230, "forma": { "forma_estable": 3, "forma_cambia": 1, "sin_comparacion": 0 } } } }
```

`obsoleta` se calcula por agrupación con `obsolescencia.ts` (pura) a partir de: la curva vigente (sus huellas en `anios_utilizados`), la corrida de la que salió (`red_comparable`, `parametros`, `resumen.cargas`), el estado actual de `tiendas`, `venta_mensual_tienda()`, las equivalencias activas de la agrupación, los meses publicados con su `carga_id`, los periodos y la temporada. `unidades_sin_agrupacion` sale de `resumen` de la corrida (rotulado "agregado refrescado el …"), no de la MV.

### Calcular

`POST /api/curvas/calcular`:

```ts
calcularSchema = z.object({
  hasta_periodo: mes.optional(),                                     // por defecto min(último publicado, último cerrado en Lima)
  solo_tiendas_completas: z.boolean().default(true),
  exigir_venta_todo_el_ano: z.boolean().default(true),
  meses_tienda_nueva: z.number().int().min(0).max(36).default(0),
  umbral_tienda_dominante: z.number().min(0.1).max(0.9).default(0.35),
  tratamiento_atipicos: z.enum(["auto", "incluir", "imputar", "descartar"]).default("auto"),
  umbral_forma: z.number().min(0.5).max(50).default(3),              // piso en pp; el umbral efectivo es max(umbral, ruido_normal) (B1)
  max_meses_hueco: z.number().int().min(1).max(6).default(4),
  min_unidades_ano: z.number().int().min(0).default(120),
  umbral_cambio_volumen: z.number().min(1.5).max(10).default(3),     // aviso cambio_volumen_extremo (I3)
  margen_ruido: z.number().min(0).max(1).default(0.25),              // recomendación: A salvo que otra la mejore en más de margen_ruido × ruido_normal (I1)
  peso_minimo_diagnostico: z.number().min(0).max(0.5).default(0.05), // tienda_distinta solo si la tienda pesa al menos esto
  umbral_liquidacion: z.number().min(0.05).max(0.5).default(0.15),
  marcar_referencia: z.boolean().default(false),                     // la corrida nueva pasa a ser la de referencia (si no hay ninguna, siempre)
});
```

Pasos: (1) lee agrupaciones con géneros, temporada y equivalencias activas (huella), tiendas (M4), periodos activos, cargas publicadas (`{ periodo, carga_id }`); (2) **una llamada** a `refrescar_y_leer_agregado_estacionalidad()` → `409 calculo_en_curso` si otra corrida está refrescando (errcode `55P03` o mensaje `calculo_en_curso`); (3) `redComparable` (pura) sobre la venta por tienda y mes derivada de las filas (agrupación nula incluida); (4) `calcularCorrida(entrada, parametros)` (pura): series por agrupación rellenadas con ceros desde los meses publicados, truncado tras sumar la red, clasificación, efecto atípico, candidatas, backtesting, recomendación, curva `T` por temporada, diagnóstico por tienda, banda, huellas; (5) `efectoAtipicoCorrida` (pura): ratios por temporada, control, relativo, crecimiento normal; (6) inserta la corrida (`resultado`, `resumen`, `red_comparable`, `efecto_atipico`, `referencia`); si `marcar_referencia` o no hay referencia, primero quita la referencia anterior (`update … set referencia = false where referencia`) y luego inserta con `true`; (7) responde `201 { corrida: { id, created_at, hasta_periodo, referencia, parametros, resumen } }`. Errores: `409 sin_datos`, `409 hasta_periodo_sin_cargar`, `409 calculo_en_curso`, `400` zod. Tiempo esperado: refresco 2 a 5 s + lectura ≈ 1 MB + cálculo de milisegundos.

### Corridas y detalle

| Ruta | Método | Respuesta |
|---|---|---|
| `/api/curvas/corridas` | GET | las últimas 50 sin `resultado` (`id`, `created_at`, `hasta_periodo`, `referencia`, `parametros`, `resumen`, `usuario_nombre`) |
| `/api/curvas/corridas/[id]` | PATCH | `{ referencia: true }` (`marcarReferenciaSchema`): quita la anterior y marca esta; `{ corrida }`; `404` |
| `/api/curvas/corridas/[id]` | GET | la corrida completa (`resultado`, `red_comparable` con `codigo` y `nombre` de tienda, `efecto_atipico`) más `agrupaciones[]` (nombre, géneros, temporada, vigente) |
| `/api/curvas/red-comparable` | GET | vista previa sin corrida: query con los parámetros de red de `calcularSchema` (`leerConsultaRed`), lee `tiendas` y `venta_mensual_tienda()`; `{ anios: RedAnio[] (con perfil y eat_vs_red por tienda), hasta_periodo, meses_publicados }`; `409 sin_datos` |
| `/api/curvas/anios-atipicos` | GET | `?corrida_id=` (por defecto la de referencia). `{ corrida, efecto: corrida.efecto_atipico, periodos, anios: [{ anio, clase_por_temporada, completo }], agrupaciones: [{ id, nombre, temporada, efecto_atipico, avisos }], temporadas: resultado.temporadas }`; sin corrida, `corrida: null`. No lee la MV |
| `/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` | GET | el detalle de la agrupación **tal como lo guardó la corrida** (`resultado.agrupaciones[i]`, la `T` de su temporada, la red de la corrida con los pesos de la agrupación, la vigente actual y el **comparador** `{ eat_vs_vigente, diferencia_por_mes }`); no lee la MV; la cabecera rotula "Corrida del … (datos y parámetros de ese momento)". `404` |

### Elegir, aprobar y retirar curvas (una por una)

| Ruta | Método | Cuerpo | Respuesta |
|---|---|---|---|
| `/api/curvas/agrupaciones/[id]` | PUT | `elegirCurvaSchema` | `201 { curva }` (nueva vigente, con `version`). `404` agrupación o corrida inexistente · `409` agrupación inactiva · `409 candidata_no_disponible` · `409 sin_cambio` (misma `corrida_id` y `modelo`) |
| `/api/curvas/agrupaciones/[id]` | DELETE | — | retira la vigente: `{ id, estado: "retirada" }`; `404` sin vigente |
| `/api/curvas/vigentes` | GET | — | `[{ agrupacion_id, codigo, nombre, curva_id, version, modelo, origen, medida, curva: [12], acumulada: [12], huellas: { composicion, red_huella, cargas_huella }, corrida_id, aprobada_at }]` de agrupaciones activas: lo que M7 leerá y el CSV |

```ts
elegirCurvaSchema = z.object({ corrida_id: z.uuid(), modelo: z.enum(["A", "B", "C", "D", "E", "T"]), nota: z.string().trim().max(300).optional() });
marcarReferenciaSchema = z.object({ referencia: z.literal(true) });
```

`PUT` copia la curva de `corrida.resultado` (`T` de `resultado.temporadas` de su temporada), escribe `recomendada = (modelo === recomendada)`, `origen = modelo === "T" ? "prestada" : "propia"`, `medida = "unidades"`, `eat`/`error_max` (null para `T`), `anios_utilizados = { anios: [{ anio, clase, tratamiento, en_ajuste }], composicion, red_huella, cargas_huella: md5(resumen.cargas) }`, y hace la transición: `update … set estado = 'reemplazada' where agrupacion = $1 and estado = 'vigente'`, luego `insert … version = max + 1`. **No hay `POST /api/curvas/aprobar` ni `aprobarSchema`.** `errores-db.ts` traduce el único parcial (`curvas_estacionalidad_vigente_uniq` → `409 "Esa agrupación ya tiene una curva vigente; vuelve a cargar."`) y la FK de la agrupación.

## Pantallas

Ruta **`/planificacion/curvas-estacionalidad`** (menú Planificación, `roles: PLANIFICACION`; el comprador no la ve y la página redirige a `/`). En M3, el diálogo de la pestaña Agrupaciones suma el `Select` Temporada (con la sugerida al lado solo si es invierno o verano), la tabla una columna Temporada con badge, y el importador la columna `TEMPORADA` (construido en el paso 1); falta el chip en el Mapa.

Panel `curvas-panel.tsx` con `Tabs`: **Curvas · Años Niño · Periodos atípicos** (no hay pestaña Corridas: la corrida se elige con un **selector** en la cabecera de Curvas, con la de referencia marcada y el botón "Marcar como referencia"). Encima, el resumen de `GET /api/curvas`: "15 agrupaciones activas · 12 con curva vigente · 3 sin curva con venta · 2 obsoletas · 10 siguen en Toda temporada"; `Alert` ámbar con las obsoletas y su motivo y el botón **Recalcular**; `Alert` si hay unidades sin agrupación (enlace a Faltantes de M3). Estado con `use-curvas.ts` (patrón `useResponsables`); cualquier escritura recarga.

### Pestaña Curvas

- **Tarjeta Calcular**: parámetros con sus valores por defecto y ayudas cortas (red comparable: "Solo tiendas abiertas todo el año", "Exigir venta en todos los meses", "Meses de tienda nueva" (0), "Umbral de tienda dominante" (35 %); atípicos: tratamiento, "Piso del umbral de forma (pp)" con la nota "el umbral efectivo es el mayor entre este piso y el ruido entre años normales", máximo de huecos; pequeñas: mínimo de unidades por año, umbral de cambio de volumen; recomendación: margen sobre el ruido; diagnóstico: peso mínimo; liquidación: umbral; casilla "Marcar esta corrida como referencia"); vista previa de meses y periodos activos ("45 meses, 2023-01 a 2026-09; 2023, 2024 y 2025 completos; 2026 parcial (9); 4 periodos activos; 4 agrupaciones de invierno, 1 de verano, 10 de toda temporada"); botón **Calcular** con avance ("Refrescando el agregado… · Calculando…"); al terminar, "Corrida del …: 13 con curva propia, 2 prestadas, 0 sin venta". Al pie, el **calendario de revisión sugerido**: "Recalcula al cerrar cada año calendario y cuando una tienda cumpla su primer año completo; la tabla marca las curvas obsoletas con su motivo". Mientras no haya corrida, `EmptyState` "Calcula para ver propuestas".
- **Panel "Red comparable por año"** (plegable): tabla tiendas × años de la corrida que se ve (o del botón "Ver red" con los parámetros escritos, sin `debounce`). Por celda: "Entra" con el **peso siempre visible**, o "Fuera" con el motivo legible ("No abierta todo el año", "Tienda nueva hasta 2027", "Sin venta en ene–may", "Apertura dudosa: vende desde 2023-07 → Corregir en Tiendas", "Cierre dudoso", "Centro de distribución", "Tienda desactivada"); badge **Dominante** sobre el umbral; badge **Distinta** con la EAT frente a la red cuando `tienda_distinta`; fila Total "9 de 10 tiendas · la mayor pesa 38 %". Al desplegar una tienda, su perfil mensual frente al de la red (mini curvas) por año.
- **Filtros**: Género; chips de temporada (Todas · Invierno (4) · Verano (1) · Toda temporada (10)); chips de estado: Todas · Sin curva · Obsoletas · Propuesta distinta · Con avisos · Prestadas · Forma cambia; buscador.
- **Tabla** (`DataTable`, alfabética; inactivas con curva al final):

| Columna | Contenido |
|---|---|
| Agrupación | nombre con color de M3, chips de género, `Select` Temporada en línea (sugerida al lado solo si es invierno o verano) |
| Curva vigente | "v2 · A Promedio simple · EAT 29,1 · Javier, 14/10" o badge "Sin curva"; "Prestada (temporada)"; "Retirada"; badge **Obsoleta** con el motivo en `title` y en texto corto ("tienda entra en la red de 2026") |
| Propuesta (corrida seleccionada) | modelo recomendado, EAT, motivo ("sin evidencia para apartarse del promedio" / "menor error"); badge "Distinta (4,1 pp)" si difiere de la vigente; "—" sin corrida |
| Años | "2023 (Niño completo, incluido) · 2024 · 2025 · 2026 parcial (Niño)"; "(escaso)" donde aplique; color por clase |
| Niño | volumen ("2023 ×0,63 · 2026 ×0,66", diagnóstico por agrupación) y forma ("Estable (31 pp; ruido 33)" / "Cambia (48 pp; ruido 24)") |
| Estabilidad | Alta / Media / Baja |
| Avisos | chips con `title` |
| Mini curva | vigente en sólido, propuesta en contorno (`mini-curva.tsx`, SVG) |
| Acciones | **Ver** (abre el detalle, donde se aprueba) · **Recalcular** (si obsoleta) · **Retirar** (si vigente; `confirm`) |

No hay selección múltiple ni barra de acción: **la aprobación vive solo en el detalle**. Descarga **CSV de curvas vigentes** (`descargarCsv` con BOM): `AGRUPACION, CODIGO, VERSION, MODELO, ORIGEN, ENE … DIC, EAT, APROBADA`.

### Detalle de una agrupación (panel lateral o `?agrupacion=<id>`)

Carga `GET /api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` de la corrida seleccionada; cabecera "Corrida del 14/10/2026 10:42 (referencia) · datos y parámetros de ese momento".

1. **Cabecera**: nombre, géneros, Temporada editable, equivalencias activas, unidades por año, huellas ("composición: 140 equivalencias; red: 8 · 9 · 9 · 10 tiendas") y, si la vigente está obsoleta, el motivo.
2. **Efecto del Niño** (solo con años atípicos), dos sub-bloques: *Volumen* (ratio del año frente al de referencia sobre tiendas comunes, ratio mes a mes en mini barras, nota "el factor que recibe M7 es el de la temporada: ver Años Niño"); *Forma* (por año: `p(Y)` y `r` superpuestas, `diferencia_anio` frente al **umbral efectivo** con las tres cifras, pico y corrimiento, veredicto; para 2026 las **dos formas parciales**, red completa y tiendas comunes con 2025, lado a lado; para verano, el **peso de los meses imputados**).
3. **Gráfico principal: todos los años superpuestos** (`grafico-curvas.tsx`, SVG propio; geometría pura en `src/lib/curvas/grafico.ts`; reutiliza `escalaBonita`, `MESES_CORTOS`, `colorAnio`, `formatearUnidades` de `src/lib/reportes/histograma.ts`): una línea por año (utilizables en continuo; **escasos** atenuados; año en curso discontinuo; imputados punteados en los meses imputados; descartados en gris, apagados por defecto); la **propuesta** en trazo grueso, la **vigente** en gris oscuro, la **banda** min–max como área tenue, `T` encendible; meses en liquidación con punto ámbar; meses atípicos con banda vertical; lectura por mes al pasar el cursor; `aria-label` por polilínea. Conmutador Participación / Unidades.
4. **Comparador vigente / propuesta** (si hay vigente): fila de doce diferencias en puntos con color por signo, "EAT entre ambas: 4,1 pp; el mes que más cambia: enero (+1,8)".
5. **Tabla de candidatas**: `A`…`E` y `T`: nombre, descripción, EAT (con el número de pliegues y, desplegable, la **EAT por pliegue**), error máximo, EAT parcial, badge **Recomendada** con su motivo y la **frase comparativa**, "Igual a A", "No disponible: motivo"; `radio` para dibujarla; botón **Aprobar esta curva** (campo `nota` opcional si no es la recomendada). El `confirm` resume: modelo, años usados con su clase y tratamiento ("2023 Niño completo incluido · 2024 · 2025"), EAT frente al ruido ("29,1 pp; ruido entre normales 33"), diferencia con la vigente y avisos. Debajo, las doce participaciones de la seleccionada y de la vigente.
6. **Tabla año × mes** (`TablaMatriz` de M11): participación con un decimal y unidades de la red debajo; imputados en cursiva; atípicos marcados; año en curso con "—" en los meses sin cargar; cabecera por año con clase, tratamiento, unidades, tiendas en la red, peso de la mayor (badge Dominante), `escaso`, liquidación; columnas Propuesta y Vigente y diferencia. CSV.
7. **Red comparable de esta agrupación** (plegado): el mismo componente con pesos sobre la venta de la agrupación; por tienda, su perfil frente al de la agrupación (mini curvas), `eat_vs_red`, badge **Distinta**, y la nota "si una tienda se aparta de verdad y pesa, el siguiente paso es M6b (curvas por tienda o grupo de tiendas)".

### Pestaña Años Niño (versión reducida)

Se alimenta de `GET /api/curvas/anios-atipicos` (corrida de referencia o la seleccionada). Sin corrida: `EmptyState` y la tarjeta "Años marcados como atípicos" por temporada. Con corrida:

1. **Cabecera**: corrida, piso del umbral y margen sobre el ruido (editables: se guardan para la próxima corrida), chips de temporada.
2. **Bloque "Volumen" (tabla de ratios con controles, B3)**: por temporada y año atípico: `ratio_volumen`, **control** (toda temporada), **ratio relativo**, **crecimiento normal** de la temporada, unidades y referencia, "N tiendas comunes", "N agrupaciones", y en el año en curso "ene–set frente a ene–set de 2025". Fila desplegable con el ratio mes a mes. Texto de lectura generado: "Invierno 2026 (ene–set): 0,66 frente a 2025 en las mismas 9 tiendas; la red de toda temporada hace 0,975: relativo 0,68. Verano 2026: 1,24, relativo 1,27, del orden del crecimiento normal del verano (1,29)". Sin etiqueta de sustitución.
3. **Bloque "Forma"**: tabla filtrable por temporada y veredicto: agrupación, año, clase, `diferencia_anio`, `ruido_normal`, umbral efectivo, pico y corrimiento, veredicto, tratamiento; **Ver** abre el detalle. Conteo por temporada arriba.
4. **Bloque "Lo que recibirá M7"**: tabla "Factor de volumen por temporada y año" (= `por_temporada`, con "N agrupaciones" junto a cada factor y la nota "el verano sale hoy de una sola agrupación") y "Crecimiento entre años normales por temporada"; descarga CSV; nota "en M7 el factor es calculado y editable".
5. **Avisos** relativos al Niño: `pocos_anos_normales`, `sin_referencia_volumen`, `ano_atipico_completo`.

### Pestaña Periodos atípicos

Como en el paso 1, con los cambios del paso 2: el conjunto de temporadas con tres casillas **Invierno · Verano · Agrupaciones de toda temporada** (al menos una) y el atajo **"Todas"** (marca las tres); atajos de rango "Año completo", "Desde setiembre", "En curso"; el `EmptyState` prellena los **cuatro altas confirmados**; tabla con temporadas en badges; tarjeta "Años marcados como atípicos" por temporada con el `ratio_volumen` de la corrida de referencia al lado; aviso de meses sin cargar; pie "Cambiar un periodo no recalcula nada: las curvas afectadas se marcan obsoletas (`periodo_cambiado`)". Enlace "Revisar las agrupaciones en Toda temporada" a la pestaña Curvas con el filtro (contador "10 siguen en Toda temporada"; sin falsa seguridad por sugeridas).

## Reglas de negocio

Funciones puras en `src/lib/curvas/`, probadas en `tests/curvas.*.test.ts` con fixtures sintéticos (`tests/curvas.fixture.ts`). Todas de vitest salvo la 30 (SQL, script de humo) y la 31 (estático).

**`anios.ts`**

1. `clasificarAnio(anio, mesesPublicados, atipicosQueAplican, maxHuecos)`: 12 publicados y 0 atípicos → `normal`; 1 a `maxHuecos` → `con_huecos` (lista); **más de `maxHuecos`, 12 incluidos → `atipico_completo` con `meses_atipicos: n`** (I2; `descartado` no es una clase); algún mes sin publicar → `incompleto`; el año de `hasta_periodo` con menos de 12 → `en_curso`.
2. `participacion(meses)`: `[10, 20, 30, 40, 0, …]` → `[0.1, 0.2, 0.3, 0.4, 0, …]`; suma 1 tras `normalizarCurva`; todo cero → `null`.
2b. `serieDeAgrupacion(filas, mesesPublicados, red)`: devuelve un valor por **mes publicado** (0 si no hay fila), suma solo las tiendas de la red del año y **trunca a 0 después de sumar** (una tienda con −5 y otra con +20 dan 15; la suma −3 da 0 con `mes_negativo`); una agrupación con filas solo en 2024 tiene 2023 y 2025 en ceros, no ausentes (test).
3. `normalizarCurva(v)`: idempotente; suma exactamente 1,000000. `curvaAcumulada(curva)`: creciente, `C_12 = 1`.
4. `redComparable(...)` (`red.ts`): fechas, datos, tienda nueva, CD, desactivada (`tienda_desactivada`), `sin_apertura`; `peso` suma 1 sobre las que entran; `dominante` solo sobre el umbral; `sin_red` con todas fuera; **cada tienda que entra lleva `participacion`, `eat_vs_red` y `distinta`** (`eat_vs_red > max(umbral_forma, ruido_normal)` y `peso ≥ peso_minimo_diagnostico`); una tienda idéntica a la red da `eat_vs_red = 0`; una con enero al doble y peso 2 % no es `distinta` (peso insuficiente).
4b. Tienda nueva: con `meses_tienda_nueva = 0`, abierta el 2025-11-20 → `no_abierta_todo_el_ano` en 2025, **entra en 2026**; con 12 → `tienda_nueva` en 2026 (entra en 2027).
4c. Venta todo el año: unidades 0 en febrero → `meses_sin_venta: ["2024-02"]`; en el año en curso solo se exigen los meses publicados; un mes negativo cuenta como sin venta.
4d. Fechas dudosas: tramo contiguo desde enero (o el primer publicado) hasta el **primer mes con venta positiva** → `apertura_dudosa` con `primer_mes_con_venta` (tienda con apertura 2021 y primera venta positiva en 2023-07 → `meses_sin_venta` ene–jun 2023 y `primer_mes_con_venta: "2023-07"`); tramo al final sin venta posterior → `cierre_dudoso`; hueco en medio → ninguno.
5. `hastaPorDefecto(mesesPublicados, hoyLima)`: último publicado y cerrado.

**`atipicos.ts`**

6. `mesesAtipicos(periodos, agrupacion)`: unión de los rangos activos cuyo conjunto incluye la temporada; `todo_el_ano` no recibe `{invierno}` ni `{verano}`; un rango `2023-09` a `2024-02` reparte entre años. 6a. `temporadasDePeriodo` / `alcanceEspejo` (únicos que tocan `alcance`). 6b. `claseDeAnio`: contrato (claves y tipos fijos; `periodos[]` con `temporadas`).
7. `imputarHuecos(medidas, A, r)`: suma 1; `A` vale `r_m`; los demás conservan proporciones; `pesoImputado = Σ_{m∈A} r_m` se devuelve aparte (lo muestra el detalle de verano).
8. `referencia(aniosNormales)`: promedio simple; sin normales → `null`.
8a. `ruidoNormal(aniosNormales)`: EAT entre los dos; con tres o más, promedio de las EAT entre pares; con uno, `null`.
8b. `compararFormaAnio(p, r, umbralPiso, ruido, mesesComparados?)`: `umbral_efectivo = max(piso, ruido ?? 0)`; `forma_cambia` solo si `diferencia_anio > umbral_efectivo`; año = normal × constante → diferencia 0, estable; curva desplazada un mes → `corrimiento_pico = −1`; con piso 3 y ruido 33, un año a 31 pp es **estable** y uno a 48 pp **cambia**; con ruido nulo manda el piso. `compararFormaParcial(q, r, k, redCompleta, tiendasComunes)` devuelve las dos versiones con `parcial: true` y nunca tratamiento. `compararFormaAgrupacion` como antes.
8c. `tratamientoEfectivo(parametro, veredicto, clase)`: `imputar` sobre `atipico_completo` → `descartado`; `auto` → `incluido` / `imputado` (solo `con_huecos`) / `descartado`; `en_curso` → `null`.
8d. `ratioVolumen(unidadesAnio, unidadesReferencia, meses)` sobre tiendas comunes; `ratioMensual` con `null` donde no hay mes o referencia 0.
8e. `tiendasComunes(redY, redN)`; `referenciaVolumen(anioY, aniosNormales)` → el normal más cercano (empate: el anterior).
8f. `efectoAtipicoCorrida(resultado, red, parametros)`: por temporada y año atípico, `ratio_volumen`, `ratio_control` (el de `todo_el_ano` del mismo año y tiendas comunes; `null` para la propia `todo_el_ano`), `ratio_relativo = ratio_volumen ÷ ratio_control` (`null` si control nulo o 0), `crecimiento_normal` (ratio entre los dos normales más recientes de la temporada sobre sus comunes; `null` con menos de dos), `agrupaciones: N`; `red` = todas; **no existe ninguna etiqueta de sustitución** (test: la salida no tiene la clave).
8g. `pocosAniosNormales(anios)`: menos de tres normales completos.
8h. `temporadaSugerida(lineas)`: mayoritaria; empate o vacío → `todo_el_ano`. `temporadaSugeridaDistinta(temporada, sugerida, n)`: **falso si `sugerida === "todo_el_ano"`** (I5) o sin equivalencias; con 87 líneas "Todo el año" ninguna agrupación avisa, cualquiera que sea su temporada.

**`liquidacion.ts`**

9. `mesesEnLiquidacion(cvMensual, atipicos, umbral)`: mediana sobre meses no atípicos; `cv > mediana × (1 + umbral)` marca; con menos de 3 válidos no marca.
10. `cvMensual(venta, costo)`: `costo ÷ venta` a 4 decimales; venta 0 → `null`.

**`candidatas.ts`**

11. Cada candidata devuelve una curva que suma 1 o `null` con motivo. `A` con `[p, q]` = `(p + q) / 2`; `B` con 100 y 300 unidades pesa 1:3; `C` pesa 1:2:3; `D` deja plana una curva plana y reparte `[0, 1, 0…]` en `[0.25, 0.5, 0.25…]` con diciembre y enero vecinos; `E` con dos tiendas de 100 y 900 unidades y formas distintas es la media simple (`E ≠ B`), ignora la tienda bajo `min_unidades_ano`, `null` con `sin_tiendas_validas`; **las candidatas solo reciben `anios_ajuste`** (un año `escaso` no mueve `A`: test).
11b. `curvaTemporada(agrupacionesDeLaTemporada, red, parametros)`: la serie agregada se clasifica y trata como una agrupación; con dos agrupaciones de formas distintas y volúmenes 1:3, `T` está más cerca de la grande; sin ningún año utilizable en la temporada → `null`.
12. `MODELOS` tiene `A, B, C, D, E` en ese orden y `T` marcada `prestada: true`; nombres y descripciones no vacíos (estático).
12b. `marcarIguales(candidatas)`: una curva idéntica (`max |Δ| < 1e-6`) a otra anterior en el orden recibe `igual_a`; con dos pliegues, `B` y `C` quedan "igual a A" si sus curvas coinciden; `D` no.

**`backtesting.ts`**

13. `eat(curva, real)`: iguales → 0; `[1, 0…]` contra `[0, 1…]` → 200. `errorMax`.
14. `pliegues(anios_ajuste)`: `n` pliegues con `n − 1` años; con 1, cero pliegues; el entrenamiento no contiene el año de prueba; **se guarda `eat_por_pliegue`** y `eat` es su promedio (test: promedio de dos pliegues de 20 y 30 → 25).
15. El real de cada pliegue es la participación en unidades del año de prueba.
16. `validacionParcial(curva, mesesEnCurso, atipicos)`: menos de `MIN_MESES_VALIDACION_PARCIAL` útiles → `null`.

**`modelo.ts`**

17. `recomendar(candidatas, ruido, margenRuido)`: `margen = max(EMPATE_EAT, margenRuido × (ruido ?? 0))`; si `EAT_mejor > EAT_A − margen` → `A` con `sin_evidencia`; si no, `mejor` con `menor_error`; con ruido 33 y margen 0,25, `B` a 27,4 frente a `A` a 29,1 **no** desbanca a `A` (margen 8,25); `B` a 20 sí; sin propias → `T` (`prestada`); sin nada → `null` y `sin_anos_utilizables`.
18. `estabilidad(anios)` y `banda(anios)`: años idénticos → estabilidad 1 y banda de ancho 0; con un año → `null`.
19. `calcularCorrida(entrada, parametros)` es determinista y nunca usa el año en curso en el ajuste (cambiar 2026 no cambia ninguna `curva`, solo `eat_parcial` y la forma parcial); un año `escaso` no cambia ninguna curva; con menos de dos años de ajuste la agrupación sale `origen = 'prestada'` con `recomendada = "T"` y `pocos_anos_ajuste`.
20. Avisos: cada código se emite exactamente en su condición (un test por código); `cambio_volumen_extremo` con 100 y 400 unidades (cociente 4 > 3) y no con 100 y 250; `tienda_distinta` con la tienda del fixture T3 en 2026 (perfil distinto, peso 22 %); `temporada_sugerida_distinta` **no** se emite cuando todas las líneas son "Todo el año".
21. Clases con el catálogo confirmado: invierno 2023 `atipico_completo` (12); verano 2023 `con_huecos` (4); toda temporada `normal`; periodo con las tres temporadas afecta a las tres; un periodo de 7 meses sobre invierno da `atipico_completo` (7) y **nunca se imputa**.
22. `composicion` y huellas: `huellaComposicion(ids)` es md5 de los ids ordenados (independiente del orden de entrada); `huellaRed(tiendas)` cambia si cambia una fecha de apertura, un cierre, `activo` o `tipo`; `huellaCargas(cargas)` cambia si cambia un `carga_id` o entra un mes.
23. Identidad del resumen: `agrupaciones_activas = propias + prestadas + sin_venta`; `resumen.cargas` tiene una clave por mes publicado usado; `unidades_sin_agrupacion` = suma de las filas con agrupación nula.

**`obsolescencia.ts`**

24. `motivosObsoleta(curva, corrida, estadoActual)`: devuelve `[]` si nada cambió; `tienda_entra_red` / `tienda_sale_red` cuando la red comparable recalculada con los parámetros de la corrida difiere de `corrida.red_comparable` en algún año (nombra tienda y año; una tienda que cumple su primer año completo al cerrar 2026 entra en 2026 → `tienda_entra_red`; una fecha de apertura corregida que saca a una tienda de 2024 → `tienda_sale_red`; una tienda desactivada → `tienda_sale_red` con "desactivada"); `composicion_cambiada` con el conteo de equivalencias que entran y salen; `carga_nueva` con los meses; `periodo_cambiado`; `temporada_cambiada`. Cada motivo se prueba por separado y combinados.
25. `difiereDeVigente(propuesta, vigente)` y `eatEntreCurvas`: modelo distinto o `max |Δp| > 0,005` o `|ΔEAT| > 0,5` → verdadero; `eatEntreCurvas` de dos curvas iguales es 0.

**`reglas.ts` (elegir, retirar, referencia)**

26. `motivoRechazoElegir(agrupacion, corrida, modelo)`: inactiva → `409`; corrida inexistente → `404`; candidata no disponible → `409`; misma corrida y modelo → `409 sin_cambio`; `T` solo si la temporada tiene curva en esa corrida.
27. `filaCurva(resultado, temporadas, modelo, parametros, perfil)`: copia la curva (`T` de la temporada), `recomendada`, `origen`, `medida = "unidades"`, `eat`/`error_max` (null para `T`), `anios_utilizados` con `anios`, `composicion`, `red_huella` y `cargas_huella`, `version = anterior + 1`.
28. `planificarReferencia(corridas, id)`: a lo sumo una con `referencia`; marcar una quita la anterior; sin ninguna, "la de referencia" es la última por `created_at`.

**`esquemas.ts`**

29. `calcularSchema` aplica los valores por defecto (`tratamiento_atipicos = "auto"`, `umbral_forma = 3`, `max_meses_hueco = 4`, `min_unidades_ano = 120`, `umbral_cambio_volumen = 3`, `margen_ruido = 0.25`, `peso_minimo_diagnostico = 0.05`, `meses_tienda_nueva = 0`, `umbral_tienda_dominante = 0.35`, `marcar_referencia = false`) y rechaza fuera de rango; **no acepta `medida`, `referencia_volumen` ni `umbral_sustitucion`** (claves desconocidas se ignoran o se rechazan según la convención de `leerCuerpo`; test de que no aparecen en los parámetros guardados); `crearPeriodoAtipicoSchema` como en el paso 1 más `temporadas`; `elegirCurvaSchema` rechaza `F`, `G`, `H` y cualquier modelo fuera de `A`…`E`, `T`; `marcarReferenciaSchema` solo acepta `{ referencia: true }`; **no existe `aprobarSchema`** (estático).

**SQL y estático**

30. **SQL (humo local)**: `0011`, `0015` y `0016` aplican dos veces sin error y sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`; `refrescar_y_leer_agregado_estacionalidad()` devuelve `refresco.filas` igual a `count(*)` de la MV y `filas` con una entrada por agrupación × tienda × mes cuyas sumas coinciden con `venta_mensual_tienda()` sumadas por tienda y mes y con `unidades_mensuales()` por mes; dos sesiones a la vez: la segunda recibe el error `calculo_en_curso` (`55P03`) mientras la primera no termina; `anon` y `authenticated` no pueden ejecutarla ni leer la MV; `corridas_estacionalidad.referencia` nace `false` y dos filas `true` chocan con el único parcial; el resto como en la `0015` (único parcial de vigentes, `check` de suma, `temporadas`).
31. **Estático**: solo `consultas.ts` menciona `venta_mensual_estacionalidad`, `refrescar_y_leer_agregado_estacionalidad`, `refrescar_venta_mensual_estacionalidad` y `venta_mensual_tienda`; ningún archivo de `src/` llama a `leerTodo` sobre la MV; `grafico.ts`, `red.ts`, `modelo.ts` y `obsolescencia.ts` no importan de `@supabase/*` ni de React; ninguna ruta de M6 usa otro guard que `requirePlanner`; no existe `src/app/api/curvas/aprobar` ni `anios-atipicos/cruda`; fuera de `consultas.ts`, `temporadasDePeriodo` y `alcanceEspejo` nadie lee `alcance`; `tipos-api.ts` contiene la nota de contrato sobre `temporadas`; la `0016` no contiene `drop`, `delete`, `truncate` ni `update` fuera de comentarios.

## Casos de prueba sintéticos

Fixture `tests/curvas.fixture.ts`, dos agrupaciones inventadas (nunca nombres reales):

| Agrupación | Temporada | Ene | Feb | Mar | Abr | May | Jun | Jul | Ago | Set | Oct | Nov | Dic | Total 2024 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ABRIGO SINTÉTICO | invierno | 20 | 20 | 60 | 120 | 200 | 240 | 160 | 80 | 40 | 20 | 20 | 20 | 1 000 |
| VERANO SINTÉTICO | verano | 180 | 140 | 80 | 40 | 20 | 20 | 20 | 40 | 60 | 100 | 140 | 160 | 1 000 |

2025 = 2024 × 1,2 salvo diciembre de ABRIGO, que vale 60 (liquidación: CV 0,70 frente a mediana 0,50; **ruido normal de ABRIGO ≈ 5,7 pp, de VERANO 0**). Fixture base: ABRIGO 2023 = 2024 × 0,65 (Niño completo, misma forma); VERANO 2023 = 2024 salvo setiembre–diciembre al doble; 2026 enero–setiembre = 2025 (ABRIGO × 0,65). Periodos: los cuatro confirmados. Fixtures alternos: **"forma corrida"** (ABRIGO 2023 desplazada un mes antes × 0,65), **"huecos"** (periodo `2023-03` a `2023-05`, marzo–mayo al 40 %), **"ruido"** (ABRIGO 2023 = 2024 con abril y junio intercambiados: diferencia ≈ 24 pp), **"escasa"** (una tercera agrupación PEQUEÑA de toda temporada con 2023 = 90 unidades, 2024 = 400, 2025 = 110), **"siete huecos"** (periodo `2023-03` a `2023-09` sobre invierno). Tiendas: **T1** desde 2020 (toda la venta de la tabla); **T2** abre 2024-07-01, 10 unidades/mes; **T3** abre 2025-11-20, 300 unidades/mes con **perfil distinto** (enero al doble, invierno plano); **T4** apertura 2023-06-01 (primera venta positiva 2023-07, 5 unidades/mes; en el fixture "apertura dudosa", apertura 2021); **CD** sin venta. Casos:

1. **Clasificación**: ABRIGO → 2023 `atipico_completo` (12), 2024 y 2025 `normal`, 2026 `en_curso`; VERANO → 2023 `con_huecos` (4); toda temporada → normales; "siete huecos" → ABRIGO 2023 `atipico_completo` (7), nunca imputado.
1b. **Volumen y forma, fixture base**: `ratio_volumen(2023) = 0,65` sobre `{T1}` frente a 2024; `ratio_volumen(2026) = 0,65` frente a 2025 con 9 meses; `diferencia_anio(2023) = 0` → estable; 2023 `incluido`, tres pliegues; `pocos_anos_normales` y `ano_atipico_completo` presentes.
1c. **Forma corrida**: `diferencia_anio ≈ 40 pp > max(3, 5,7)` → `forma_cambia`, `corrimiento_pico = −1`, 2023 `descartado`, y **`ratio_volumen(2023) = 0,65` igual**.
1d. **Ruido (B1)**: con ABRIGO 2023 a ≈ 24 pp y ruido 5,7 → `forma_cambia`; con un fixture donde 2024 y 2025 difieren 30 pp entre sí y 2023 difiere 24 de la referencia → `forma_estable` (umbral efectivo 30); con piso 40 → estable en los dos casos.
1e. **Verano**: `ratio_volumen(2023) = 1,46`, `forma_cambia`, `mes_mayor_diferencia = 12`, `corrimiento_pico = −1`; con `auto`, `imputado` y `pesoImputado = Σ r_{9..12} ≈ 0,46`; con `max_meses_hueco = 3`, `atipico_completo` (4 > 3) y `descartado`.
1f. **Ratios por temporada (B3)**: con una tercera agrupación de toda temporada constante (ratio 1), `por_temporada[2023, invierno]` → `ratio_volumen 0,65`, `ratio_control 1`, `ratio_relativo 0,65`, `crecimiento_normal` = 1,236 (ABRIGO 2025/2024 con la liquidación); `por_temporada[2023, verano]` → 1,46 / 1 / 1,46; `todo_el_ano` → `ratio_control null`; ninguna clave `sustitucion_temporada`.
1g. **Forma parcial doble (I7)**: en 2026 la red completa incluye T3 (perfil distinto) y las tiendas comunes con 2025 no: `red_completa.diferencia_anio > tiendas_comunes.diferencia_anio`; ninguna cambia el tratamiento.
2. **Participación 2024 de ABRIGO** = `[0.02, 0.02, 0.06, 0.12, 0.20, 0.24, 0.16, 0.08, 0.04, 0.02, 0.02, 0.02]` con la red por defecto; con `solo_tiendas_completas = false`, `p_12` sube.
2b. **Red comparable**: 2023 → T1 (T4 fuera `no_abierta_todo_el_ano`; en "apertura dudosa", `meses_sin_venta` ene–jun y `apertura_dudosa` con `primer_mes_con_venta = "2023-07"`); 2024 → T1, T4; 2025 → T1, T2, T4; 2026 → T1, T2, T3, T4. CD → `centro_distribucion`. T4 desactivada en un fixture → `tienda_desactivada`. Con `meses_tienda_nueva = 12`, T3 `tienda_nueva` en 2026.
2c. **Pesos, dominante y distinta**: `peso(T1, 2024) ≈ 0,99`, `dominante = T1`; el peso figura en todos los años; en 2026, `T3` es `distinta` (`eat_vs_red` alto, peso ≈ 0,22) y T2 no (peso < 0,05); el aviso `tienda_distinta` nombra T3 y 2026.
2d. **Serie con ceros**: PEQUEÑA sin filas en 2023-02 tiene `meses[1] = 0` y el año sigue completo; un mes con −3 en T1 y +2 en T4 suma −1 y se trunca a 0 con `mes_negativo`.
3. **Imputación** (fixture "huecos"): meses 3–5 valen `r`; con `descartar`, `anios_ajuste = [2024, 2025]`; con `incluir`, `A` baja en marzo–mayo.
4. **Candidatas y `T`**: VERANO con tres años idénticos → `A = B = C` (marcadas `igual_a: "A"`), `D` difiere, EAT de `A` = 0, recomendada `A` (`menor_error`), estabilidad 1, banda de ancho 0. PEQUEÑA (fixture "escasa"): 2023 y 2025 `escaso`, un solo año de ajuste → sin propias, recomendada `T` (la curva agregada de toda temporada), `origen = 'prestada'`, `pocos_anos_ajuste`, `cambio_volumen_extremo` (90 → 400).
5. **Recomendación relativa (I1)**: ABRIGO base con tres pliegues: `A` y `B` difieren poco (< 1,4 pp = 0,25 × 5,7) → `A` con `sin_evidencia`; con `margen_ruido = 0` y `B` mejor por 0,1 → `B`; `eat_por_pliegue` de `A` tiene tres entradas con los años 2023, 2024 y 2025.
6. **Liquidación como señal**: `mesesEnLiquidacion(2025)` marca diciembre de ABRIGO; ninguna candidata cambia por ello; `liquidacion_fuerte` no se emite (un solo mes).
7. **Validación parcial**: VERANO 2026 (8 meses útiles) EAT parcial de `A` = 0; ABRIGO 2026 → `null` (todos atípicos) y la lectura es la forma parcial.
8. **Pocos años**: sin 2024 ni 2025, ABRIGO con `imputar`/`descartar` → sin años, `T` (o `null` si la temporada entera queda sin años); con `auto` → `sin_comparacion`, 2023 `incluido`, pero **un solo año de ajuste** → prestada igualmente (`pocos_anos_ajuste`).
9. **Obsolescencia (I9 + requisito de Javier)**: curva aprobada con la red del fixture; (a) cerrar 2026 en el fixture (publicar octubre–diciembre) → `carga_nueva`; (b) corregir T4 a apertura 2024-03-01 → `tienda_sale_red` (2024); (c) T3 cumpliendo su primer año completo con `meses_tienda_nueva = 12` al pasar a 2027 → `tienda_entra_red`; (d) añadir una equivalencia a ABRIGO → `composicion_cambiada` (+1); (e) cambiar la temporada → `temporada_cambiada`; (f) nada → `null`.
10. **Elegir y comparar**: elegir `B` con nota → v1 `recomendada = false`; recalcular y elegir `A` → v2, v1 `reemplazada`, `eat_vs_vigente` entre ambas > 0; elegir `T` → `origen = prestada`; `anios_utilizados` lleva las tres huellas; retirar → sin vigente.
11. **Referencia**: calcular sin referencia la marca; calcular después con `marcar_referencia = false` no la mueve; `PATCH` la mueve y `/anios` devuelve el `corrida_id` nuevo y su `ratio_volumen` por temporada.
12. **Determinismo**: misma entrada, mismo resultado; cambiar 2026 no cambia ninguna `curva`.

## Criterios de aceptación / hito de prueba

**Automático**

- [ ] `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (todos los módulos más `tests/curvas.*`), `npm run build` y `scripts/validar-migraciones-local.sh` en verde.
- [x] Paso 1: `0011` aplicada; `APP_VERSION = 0.9.0 · M6`; 1 409 pruebas en 92 archivos.
- [ ] Paso 2: `0015` ya aplicada (se verifica, no se reaplica) y **`0016` aplicada** en `vector-two` sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`; tipos regenerados (`referencia` en `corridas_estacionalidad`, la función nueva bajo `Functions`); `APP_VERSION = 0.9.6 · M6`; PLAN, DECISIONES, CHANGELOG y la ficha 11 actualizados.

**Prerrequisitos de Javier**

- [ ] Faltantes de M3 en cero (o aceptar las unidades sin agrupación, visibles en el aviso).
- [ ] Fechas de apertura y cierre de las tiendas en M4 (la corrección a `2023-06-01` ya está).
- [ ] **Revisar y marcar las 10 agrupaciones activas que siguen en "Toda temporada"** (I5): las líneas no informan (las 87 son "Todo el año"), así que no hay sugerencia posible; mientras no se revisen, el factor de verano sale de una sola agrupación y las de invierno sin marcar no reciben el Niño.
- [ ] Crear los cuatro periodos confirmados en la pestaña Periodos atípicos.

**Hito del paso 1 (`0.9.0 · M6`)**: como estaba (periodos editables; temporada visible en M3 y M6; pestaña Curvas sin corrida; `/anios?temporada=invierno` lista 2023 y 2026 atípicos), con la corrección de que ya no se exige "ninguna con sugerida Invierno sin marcar" sino "las 10 de toda temporada revisadas".

**Hito del paso 2 (`0.9.6 · M6`)**

- [ ] Roles: admin y planner ven el menú; el comprador recibe `403` en toda la API de M6 y la ruta lo redirige.
- [ ] **Calcular** con los parámetros por defecto termina en menos de 10 s; una segunda llamada lanzada en paralelo responde `409 calculo_en_curso`; `resumen.agregado.filas_mv` es del orden de 85 mil; `resultado` pesa decenas de KB; la primera corrida queda marcada como referencia.
- [ ] **Red comparable**: 8 tiendas en 2023, 9 en 2024 y 2025, 10 en 2026; la tienda corregida a `2023-06-01` sale fuera de 2023 por fechas (sin `apertura_dudosa`) y dentro desde 2024; la tienda abierta el 2025-11-20 fuera de 2025 y dentro de 2026 con peso ≈ 22 %; el CD `centro_distribucion`; el **peso de la mayor se ve en todos los años** (≈ 31, 33, 38 y 26 %) y el badge **Dominante** aparece **solo en 2025**; en 2026 la tienda nueva lleva **Distinta** si su EAT frente a la red supera el umbral efectivo (se anota la cifra; la medición previa da ≈ 3,3 pp en nueve meses a nivel de red, probablemente bajo el ruido: se anota si sale o no); subir "Meses de tienda nueva" a 12 la saca de 2026 y mueve la curva parcial.
- [ ] **Periodos con temporadas**: los cuatro periodos creados con los atajos; la tarjeta "Años marcados" muestra invierno y verano por separado con el `ratio_volumen` de la corrida de referencia.
- [ ] **Pestaña Años Niño**: la tabla de ratios por temporada y año reproduce, sobre tiendas comunes, las cifras del revisor (invierno 2026 ene–set ≈ 0,66, verano 2026 ≈ 1,24, toda temporada ≈ 0,975; 2023: invierno ≈ 0,63, **verano ≈ 0,73**, toda temporada ≈ 0,95; crecimiento normal verano ≈ 1,29, invierno ≈ 1,03, toda temporada ≈ 1,10); los ratios relativos quedan ≈ 0,68 / 1,27 / — para 2026; **no** se espera que coincidan con las cifras crudas de todas las tiendas (0,88 y 1,51), que la pantalla ya no muestra; la tabla "Lo que recibirá M7" descarga en CSV con "N agrupaciones" por factor (verano: 1).
- [ ] **Forma relativa al ruido**: para las cuatro agrupaciones de invierno se anota `ruido_normal` (del orden de 24 a 66 pp), `diferencia_anio` de 2023 y el veredicto con el umbral efectivo; con piso 3 la mayoría debería salir **estable respecto al ruido** (se anota el conteo); forzar `tratamiento_atipicos = 'descartar'` deja dos pliegues con `pocos_anos_normales`; la agrupación de verano muestra el peso de los meses imputados.
- [ ] **Validación de la premisa**: se anota el conteo `forma_estable` / `forma_cambia` por temporada y las tres cifras de cada agrupación de invierno; conclusión provisional sobre "el Niño mueve volumen y no forma" con el ruido a la vista.
- [ ] **Detalle y gráfico**: en una agrupación de toda temporada se ven 2023, 2024 y 2025 continuas, 2026 discontinua hasta setiembre, la propuesta gruesa, la banda y `T`; la tabla año × mes coincide con el gráfico y sus unidades con la suma de la red (no con el histograma crudo de M11); la EAT por pliegue se despliega; la frase comparativa se lee; en una agrupación con pocos años ("escaso") la propuesta es `T` y la pantalla lo dice.
- [ ] **Aprobar una por una**: en cada una de las **15 agrupaciones** Javier abre el detalle, revisa el gráfico, las candidatas y el Niño, y pulsa **Aprobar esta curva** (el `confirm` resume modelo, años con su clase, EAT frente al ruido, diferencia con la vigente y avisos); al terminar, `select count(*) from curvas_estacionalidad where estado = 'vigente'` = 15 y "Sin curva con venta" = 0; no existe ningún botón de aprobación en bloque ni selección múltiple.
- [ ] **Comparador**: recalcular con otro parámetro (por ejemplo `meses_tienda_nueva = 12`) y abrir una agrupación muestra vigente y propuesta superpuestas, la diferencia por mes y la EAT entre ambas; aprobar crea v2 y la v1 queda `reemplazada`.
- [ ] **Obsolescencia con motivo**: cambiar la fecha de apertura de una tienda en M4 (y revertirla), publicar un mes nuevo en M5 o mover una equivalencia en M3 hace aparecer **Obsoleta** en las agrupaciones afectadas con el motivo nombrado y el botón Recalcular, sin recalcular nada; recalcular y aprobar lo quita.
- [ ] **Referencia**: marcar otra corrida como referencia cambia el `corrida_id` que devuelve `/anios` y los factores de la pestaña Años Niño.
- [ ] `GET /api/curvas/vigentes` devuelve 15 filas con `curva` (suma 1), `acumulada` (termina en 1), `version`, `curva_id` y huellas; el CSV abre en Excel.
- [ ] Eliminar en M3 una agrupación con curvas responde `409` legible; desactivarla la deja al final con `inactiva_con_curva`.
- [ ] **Validación de negocio (Javier)**: las curvas vigentes de cinco agrupaciones conocidas se parecen a lo que planeamiento usa en Excel; las diferencias se explican con la tabla por año y la red comparable; se anota qué candidata o parámetro las acerca.

## Fuera de alcance / segunda entrega

- **Segunda entrega de M6** (recortes de la tercera pasada): aprobación en bloque (Javier dijo no; si cambia de idea, `POST /api/curvas/aprobar`); `GET /api/curvas/anios-atipicos/cruda` (o su equivalente sobre tiendas comunes); candidatas `G` (unidades a precio normal), `H` (venta neta) y `medida = venta_soles`; `referencia_volumen = promedio`; `umbral_sustitucion` y cualquier etiqueta de cruce; pestaña Corridas; CV % por línea y mes e histograma crudo en el detalle; vista previa de la red con `debounce`; mediana por mes y modelos con tendencia (necesitan cinco años).
- **M6b: curvas por tienda o por grupo de tiendas**: el diagnóstico `tienda_distinta` y los perfiles por tienda de esta entrega son la evidencia para decidirlo; misma tabla de curvas más `tienda_id` o `grupo_id` nullable.
- **Excluir tiendas a mano** (`tiendas_excluidas[]`) o tolerar meses sin venta (`max_meses_sin_venta`).
- **Proyección** (M7): aplicar la curva a un total anual, el avance de ventas ÷ avance de estacionalidad para proponer el total del año por GML × agrupación de marca, el factor de volumen editable, los pesos por equivalencia para mezclar curvas, la participación por tienda, las tiendas nuevas con `venta_esperada_promedio`, el aviso "la curva cambió" y el recálculo del reparto mensual. M6 deja los contratos de "Lo que M7 necesitará".
- **Recálculo automático** de curvas al cambiar la red, los datos o la composición: solo se marca `obsoleta` con motivo; recalcular y aprobar es del planner.
- **Curvas manuales**, curvas por marca, curvas semanales, curvas de stock; refrescar la MV al publicar en M5; heredar la temporada desde las líneas; detección automática de años atípicos; auditoría general.

## Riesgos

- **Ruido entre años normales muy alto** (24 a 66 pp en invierno, hasta 140 pp en alguna de toda temporada): con dos o tres años, cualquier veredicto de forma y cualquier diferencia entre candidatas es pequeña frente al ruido. Por eso el veredicto es relativo al ruido, la recomendación vuelve a `A` salvo evidencia, se guarda la EAT por pliegue y la pantalla enseña siempre las tres cifras. Cada año cerrado mejora esto sin cambiar nada.
- **Tienda nueva y red cambiante**: la tienda nueva ya mueve ≈ 3,3 pp la participación de 2026 y entrará completa al cerrar el año; las curvas son vivas y versionadas, la obsolescencia nombra el motivo, y M7 guarda la versión que usó. Si una tienda se aparta de verdad, M6b.
- **Pocos años completos** y **agrupaciones pequeñas**: años escasos fuera del ajuste y curva prestada de la temporada; el hito lo acepta como provisional.
- **Concentración**: la tienda mayor pesa entre 26 y 38 % según el año; visible siempre, `B` frente a `E` como contraste.
- **Refresco de la MV y `statement_timeout`**: 2 a 5 s estimados; la lectura en una sentencia pesa ≈ 1 MB. Si no cabe, compute Small o partir por año; el lock de aviso evita refrescos solapados.
- **Sin transacción al reemplazar una curva** y al mover la referencia: un fallo entre `update` e `insert` deja la agrupación sin vigente (o sin referencia), visible y reparable repitiendo la acción.
- **Verano**: el periodo setiembre–diciembre puede resultar innecesario (la evidencia de 2023 no muestra arranque anticipado y el verano bajó); se mide primero y Javier decide; el peso imputado se ve.
- **Primera excepción a "RLS sin políticas"** (la MV): protegida con `revoke` y probada (regla 30).

## Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

**Estado.** Registradas el 2026-10-13: la 2, 2b y 3b (construidas) y la 3. Las demás se registran al construir el paso 2, con el texto de abajo (las de pasadas anteriores corregidas donde esta pasada las cambió).

1. **La curva es la participación del mes en el año, por agrupación, sobre la red comparable de cada año.** Confirmado por Javier (2026-10-14).
2. **Catálogo editable de periodos atípicos** (rangos con conjunto `temporadas`, decisión 15); sin seed.
2b. **La temporada vive en la agrupación**; la sugerencia desde las líneas solo informa cuando informa (I5); ampliada por la 15.
3. **Los años atípicos entran tal cual si la forma es estable y se imputan (huecos) o se descartan (completos) si cambia; lo decide una comparación medida.**
4. **El año en curso nunca ajusta; solo valida parcialmente.**
5. **El modelo propone, el planner elige por agrupación, una por una; no hay aprobación en bloque** (Javier, 2026-10-14). Candidatas `A`…`E` propias y `T` prestada; backtesting con EAT por pliegue; recomendación relativa al ruido (18).
6. **La liquidación es una señal (CV % por agrupación y mes), no una candidata, en esta entrega.**
7. **El agregado vive en una MV protegida con `revoke`** y se lee **solo** con una función que refresca y devuelve el grano en un `jsonb` bajo lock de aviso (19).
8. **El modelo corre en TypeScript puro**; SQL solo agrega.
9. **La curva vigente en doce columnas con `check` de suma**, una vigente por agrupación, versionada.
10. **Toda la API de M6 exige `requirePlanner`.**
11. **Red comparable por fechas de M4 y por datos de M5**, por tienda y año sobre la venta total, con `meses_tienda_nueva = 0` por defecto (corregido: la primera pasada decía 12; Javier fijó 0 el 2026-10-14), `exigir_venta_todo_el_ano` y `solo_tiendas_completas`; motivos visibles, incluida `tienda_desactivada`.
12. **La concentración se hace visible, no se corrige**: peso por tienda y año siempre visible, `tienda_dominante` (35 %) por red y por agrupación, `E` como contraste.
13. **La pantalla grafica todos los años superpuestos** reutilizando el histograma de M11.
14. **Migraciones `0015` (aplicada, intacta) y `0016` (pequeña: función de lectura atómica y `referencia`); versión `0.9.6 · M6`.**
15. **El Niño afecta el año completo a invierno y setiembre–diciembre a verano; `periodos_atipicos.temporadas text[]`; `alcance` heredada.** Meses confirmados; "marzo a mayo" descartado.
16. **El efecto atípico se mide en volumen y forma por agrupación y año**; el volumen por temporada lleva **ratio de control y ratio relativo** más el crecimiento entre años normales (B3); **no hay etiqueta de sustitución**; el factor para M7 es por temporada (I3) y es calculado y editable en M7 (Javier, 2026-10-14). Un año con más de `max_meses_hueco` meses atípicos se trata como atípico completo (I2).
17. **`meses_tienda_nueva = 0`**: la tienda abierta el 2025-11-20 entra en la red de 2026; la tienda corregida a `2023-06-01` (primera venta positiva 2023-07) queda fuera de 2023 por fechas.
18. **(Nueva) El veredicto de forma y la recomendación son relativos al ruido entre años normales**: `forma_cambia` solo por encima de `max(umbral_forma, ruido_normal)`; `A` salvo que otra candidata la mejore en más de `max(0,05; 0,25 × ruido_normal)`; `igual_a` general. Descartado: umbral fijo de 3 pp (con ruido de 24 a 66 pp declararía "cambia" a todo); `argmin` sin margen (con dos pliegues elige ruido). *Pendiente de confirmar por Javier; se construye como parámetros.*
19. **(Nueva) Lectura atómica del agregado**: una función `jsonb` bajo `pg_try_advisory_xact_lock` que refresca y devuelve agrupación × tienda × mes; `409 calculo_en_curso`; nada fuera de `calcular` lee la MV. Descartado: paginar la MV con `leerTodo` (86 páginas, no atómico, bloqueable por un refresco concurrente); `setof` (corte de 1 000 filas; paginar un `rpc` reejecuta la función).
20. **(Nueva) Agrupaciones pequeñas**: años `escaso` fuera del ajuste, `cambio_volumen_extremo`, curva prestada **de la temporada** (`T`) con menos de dos años de ajuste; `F` (género) se retira. *Pendiente de confirmar.*
21. **(Nueva) Las curvas son un artefacto vivo** (Javier, 2026-10-14: "no quedan escritas en piedra; una nueva tienda puede modificar estas curvas"): versionadas, con **obsolescencia por agrupación y motivo nombrado** (tienda que entra o sale de la red, composición, carga nueva, periodo, temporada) calculada con huellas guardadas en la curva; comparador vigente/propuesta antes de aprobar; diagnóstico `tienda_distinta`; calendario de revisión (cierre de año y primer año completo de una tienda); M7 guarda la versión de curva y avisa si cambia, sin tocar los totales anuales. Descartado: invalidar curvas solas; recalcular automáticamente.
22. **(Nueva) Corrida de referencia** (`referencia` en `corridas_estacionalidad`): `/anios`, los factores de M7 y la pestaña Años Niño leen de ella; la marca el planner (la primera corrida lo es por defecto).

## Cambios que el documentador debe integrar al construir el paso 2

- `docs/PLAN.md`: §4 y tablas: `0015` (aplicada) + `0016` para el paso 2 de M6, `0.9.6 · M6`; `periodos_atipicos` con `temporadas[]`; `corridas_estacionalidad` con `efecto_atipico` y `referencia`; M7 "borrador a rediseñar, sin número de migración"; candidatas "`A`…`E` y `T`" (ya no "siete" ni "ocho"); red comparable "por fechas de M4 y por datos de M5, tienda nueva con `meses_tienda_nueva = 0`, concentración y tiendas distintas visibles"; curvas vivas con obsolescencia por motivo y calendario de revisión. **§7**: M6 ya no tiene preguntas abiertas salvo las tres de confirmación de esta pasada (B1/I1, I3, I11) y los prerrequisitos (las 10 agrupaciones de toda temporada, los cuatro periodos); se retira "confirmar marzo a mayo de 2023" y "migración `0013`".
- `docs/DECISIONES.md`: entradas con las decisiones 11 a 22 de arriba (fecha 2026-10-14; la 11 corrige el `12` por `0`; la 15 referencia la del 2026-10-13 "el Niño solo afecta a las de invierno" como ampliada; la 16 cierra la pregunta 14; la 5 cierra la 8) y "M7 vuelve a borrador".
- `docs/modulos/07-proyeccion-anual.md`: la nota de M6 en la cabecera queda corregida en esta pasada (el verano de 2023 **bajó**; factor por temporada con control y relativo; curva acumulada; versión de curva y aviso "la curva cambió"; proyección del resto del año = avance de ventas ÷ avance de la estacionalidad).
- `docs/CHANGELOG.md`: `0.9.6 · M6` al cerrar; `src/lib/version.ts`: `APP_VERSION = "0.9.6 · M6"`; `docs/modulos/11-reporte-agrupacion-gmle.md`: la `0014` la tomó M11; M6 usa `0015` y `0016`.

## Preguntas abiertas para Javier

**Estado al 2026-10-14 (tercera pasada).** Resueltas: 1 (temporada), 2 (grano), 3 (meses del Niño), 5 (medida), 8 (**aprobación en bloque: no**), 11 (umbral de forma: 3 pp como piso), 13 (`verano` como conjunto), 14 (**factor de volumen: calculado y editable en M7**), 15 (fecha de apertura), 16 (tienda nueva). Rigen con su valor por defecto y no bloquean: 4 (liquidación: 15 %, solo señal), 6 (tratamiento `auto`), 7 (año calendario), 9 (préstamo: ahora de la temporada, no del género), 10 (cualquier planner aprueba), 12 (sin botón "aplicar la sugerida": las líneas no informan). **Quedan tres confirmaciones**, construidas ya como parámetros con el valor recomendado:

- **C1 (B1 + I1). Veredicto y recomendación relativos al ruido.** Con dos años normales que difieren entre sí 24 a 66 pp (invierno), ¿aceptas que "la forma cambia" solo cuando el año Niño se aparta **más que lo que se apartan los años normales entre sí** (piso 3 pp), y que la recomendación vuelva al promedio simple salvo que otra candidata lo mejore en más de un cuarto de ese ruido? **Recomendación: sí** (lo contrario declara "cambia" a todo y elige ruido). Parámetros `umbral_forma` y `margen_ruido`.
- **C2 (I3). Agrupaciones pequeñas.** ¿Aceptas que un año con menos de 120 unidades no entre en el ajuste, que con menos de dos años útiles la agrupación tome la **curva de su temporada** (prestada) y que el factor de volumen que recibe M7 sea **por temporada** (no por agrupación)? **Recomendación: sí**. Parámetros `min_unidades_ano` y `umbral_cambio_volumen`.
- **C3 (I11). Verano.** El periodo de verano queda setiembre–diciembre y se **mide primero**: la evidencia de 2023 no muestra un arranque anticipado claro (set–nov 5,4 / 6,1 / 7,8 % frente a 4,2 / 6,6 / 9,3 % en 2024) y el verano de 2023 **bajó** (0,73 frente a 2024 en las mismas tiendas). ¿Mantienes el periodo de verano, o prefieres no declararlo hasta ver el veredicto de forma y el ratio relativo? **Recomendación: mantenerlo y medir**; si la forma sale estable y el ratio relativo es del orden del crecimiento normal, se desactiva (una fila).

Además, como prerrequisitos y no como preguntas: revisar las 10 agrupaciones de toda temporada y crear los cuatro periodos.
