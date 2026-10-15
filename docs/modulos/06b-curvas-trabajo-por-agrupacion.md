# M6b · Curvas de estacionalidad: trabajo agrupación por agrupación

> Estado actual: **construida en `0.9.7 · M6`, en validación** (la tarjeta de M6 en Inicio dice "En validación"); en lo que se apartó de la especificación, manda la nota "Cambios respecto a la especificación" más abajo. Historia: **especificada el 2026-10-15, revisada el mismo día por el `arquitecto-revisor` (opus) y ajustada con su informe; las decisiones que quedaban abiertas las tomó Javier ("Decidido por Javier", puntos 7 a 12). Lista para construir** (ver "Orden de construcción" al final). Sustituye el flujo de **corrida global** de la ficha [06-curvas-estacionalidad](06-curvas-estacionalidad.md) (tercera pasada, construida en `0.9.6 · M6`) por un flujo en el que **la unidad de trabajo es una agrupación de estacionalidad**: se abre, se ve en un mismo gráfico y tabla la curva aprobada vigente, la curva de cada año y la que propone el sistema, se ajustan sus parámetros, y se aprueba esa curva. La lógica estadística de la 06 (red comparable por fechas y por datos, candidatas `A`…`E` y `T`, backtesting con EAT, veredicto de forma relativo al ruido, recomendación con empate relativo, volumen y forma del Niño por separado, obsolescencia con huellas) **se conserva tal cual**; lo que cambia es cómo se llega a ella, qué se lee, qué se guarda y qué ve el planner. Migración **`0017_venta_estacionalidad_agrupacion.sql`** (**ya aplicada y commiteada**: función, columna, FK e índice; esta revisión le añade un ajuste con `create or replace` en el mismo archivo, ver "Modelo de datos" 1b) y versión **`0.9.7 · M6`** (la vigente es `0.9.6 · M6`); commits con prefijo `M6:`. Módulo anterior: [05-venta-stock](05-venta-stock.md); dependen de aquí [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) (temporada), [04-tiendas](04-tiendas.md) (fechas de apertura y cierre) y [07-proyeccion-anual](07-proyeccion-anual.md) (contratos de salida, que no cambian). Ningún dato real de Lukers en esta ficha: los ejemplos son sintéticos y las observaciones sobre la base real van en cifras agregadas sin nombres.

## Objetivo

Que el planner trabaje la estacionalidad **como la trabaja de verdad**: abre una agrupación, mira superpuestas la curva que aprobó, las curvas de cada uno de los últimos años (participación mensual sobre la red comparable de ese año, con el año en curso parcial y los años del Niño diferenciados) y la que el sistema propone hoy, entiende en una frase por qué el sistema propone esa, mueve si hace falta los parámetros de **esa** agrupación (años, tratamiento del Niño, red de tiendas, candidata) y aprueba. La `0.9.6` construyó el motor completo y lo expuso con una corrida global ("Calcular" para las 15 agrupaciones, guardada entera, y después una tabla con propuestas); Javier la probó y describió otra forma de trabajar: **agrupación por agrupación**, con la vista única de aprobada, años y sistema, y con el sistema comprobando antes de calcular que esa agrupación tiene lo que necesita (temporada marcada, periodos del Niño cargados, meses y fechas de tiendas completos). Esta ficha reordena el módulo alrededor de ese flujo, reutilizando casi todo lo construido, y deja para M7 los mismos contratos que ya tenía (curva vigente con versión y huellas, curva acumulada, factor de volumen por temporada).

## Decidido por Javier

Rigen todas las decisiones de la 06 (1 a 10 de "Decidido por Javier" y 1 a 22 de "Decisiones nuevas"), más lo dicho el **2026-10-15** tras probar la `0.9.6` desplegada:

1. **"Se tiene que trabajar agrupación de estacionalidad una por una."** La pantalla principal lista las agrupaciones con su estado y, al abrir una, se trabaja esa.
2. **"Tener una vista de la curva que definimos aprobada y las de los últimos años, así como la que genera el sistema en automático."** Las tres en el mismo gráfico y la misma tabla, con la diferencia mes a mes entre aprobada y propuesta.
3. **La lógica de Vector-One sirve hasta M6**: todos los años superpuestos; participación medida para las mismas tiendas (solo las que estuvieron todo el año); una curva propuesta con una lógica explicable. Se mantiene.
4. **Las curvas no quedan escritas en piedra**: una tienda nueva puede modificarlas (requisito del 2026-10-14, vigente). No hay aprobación en bloque; cada curva se aprueba por agrupación tras revisar su detalle.
5. **El Niño de 2023 y 2026 afecta el año completo a invierno y adelanta el verano (desde setiembre).** Catálogo de periodos atípicos como está en la 06; el cálculo de una agrupación de invierno o verano **no corre sin periodos cargados** (ver "Prerrequisitos").
6. De la 06 y sin cambio: `meses_tienda_nueva = 0`; veredicto de forma relativo al ruido; recomendación con empate relativo al promedio simple; volumen y forma por separado y por temporada; rol `requirePlanner` en toda la API; M7 recibe la curva vigente con versión y huellas, la curva acumulada por unidad y el factor de volumen por temporada (calculado aquí, editable en M7).

Resueltas el **2026-10-15** (eran las preguntas abiertas de la primera versión de esta ficha, más lo que pidió el informe del `arquitecto-revisor`):

7. **Periodos del Niño como prerrequisito bloqueante.** Una agrupación de invierno o verano no se calcula sin un periodo atípico para su temporada; la casilla "Confirmo que esta temporada no tiene años atípicos" lo levanta y queda en la foto.
8. **Toda temporada: solo aviso** ("Sigue en Toda temporada") hasta la primera aprobación; sin casilla.
9. **Nota obligatoria** al aprobar una candidata distinta de la recomendada **y también** cuando se excluye algún año o alguna tienda a mano o el tratamiento del Niño no es `auto`. Un solo campo "Nota / motivo".
10. **Al reabrir una agrupación se parte de los parámetros de su última aprobación**, con "Restablecer" a la vista. **Excepción: `hasta_periodo` nunca se hereda**: cada apertura arranca en el defecto y la cabecera dice "la vigente usó datos hasta X".
11. **"Comparar con el sistema" por fila** en la lista. El botón en bloque "Comparar las obsoletas", la edición de temporada en línea en la lista y los umbrales avanzados del panel se **difieren a una segunda entrega** para recortar alcance.
12. **Una curva prestada (`T`) depende de las otras agrupaciones de su temporada**: se marca obsoleta si cambia la composición o la temporada de cualquiera de ellas (motivo `temporada_recompuesta`); si la curva es propia, solo aviso.

## Qué cambia y qué no (resumen para quien construyó la 0.9.6)

| Aspecto | `0.9.6` (corrida global) | `0.9.7` (por agrupación) |
|---|---|---|
| Unidad de trabajo | Una corrida para las 15 agrupaciones; luego tabla con propuestas | **Una agrupación**: lista con estado → abrir → trabajar → aprobar |
| Cuándo se calcula | Al pulsar Calcular (2 a 5 s: refresco de la MV + lectura de 1 MB) | **Al abrir la agrupación y al cambiar un parámetro** (una lectura filtrada, medida en 0.6 a 1.5 s; la lectura se cachea en memoria por huella, así que mover un parámetro tarda milisegundos) |
| Lectura de la venta | `refrescar_y_leer_agregado_estacionalidad()` (MV completa, lock) | **`venta_estacionalidad_agrupacion(p_agrupacion_id)`** (`0017`): la agrupación × tienda × mes, las temporadas × tienda × mes (de donde sale el total por tienda) y las cargas publicadas (`cargas`, para la huella), en un `jsonb`; sin MV y sin `venta_mensual_tienda()` |
| Qué se guarda | Toda corrida (120 KB) y la corrida de referencia | **Solo la foto de cada aprobación** (fila de `corridas_estacionalidad` con alcance de una agrupación, ~40 KB medidos) y la curva versionada. Los cálculos que se miran y no se aprueban no se guardan |
| Prerrequisitos | Se calculaba con el catálogo vacío (0 periodos) | **Se comprueban antes de calcular**, con motivo, y bloquean cuando falta lo imprescindible |
| Parámetros | Globales, en la tarjeta Calcular | **De esa agrupación**, visibles en su panel; se guardan en la foto y son el punto de partida de la siguiente revisión |
| Estado de la lista | Depende de la corrida seleccionada | **Sin corrida**: `sin_curva` / `al_dia` / `al_dia_distinta` (se aprobó una candidata distinta de la recomendada) / `obsoleta` (con motivo) / `inactiva_con_curva`; "Comparar con el sistema" a demanda |
| Factor del Niño para M7 | De la corrida de referencia | **Calculado a demanda** desde las series por temporada (misma función SQL sin agrupación); M7 guarda el valor que usó (ya era editable allí) |
| Pestañas | Curvas · Años Niño · Periodos atípicos | **Agrupaciones · Años Niño (apoyo) · Periodos atípicos** |
| Modelo (`src/lib/curvas/`) | — | **Sin cambios de fórmula.** Tres extensiones de entrada: series agregadas por temporada (para `T` y el control), `anios_excluidos` y `tiendas_excluidas`; más la constante `VERSION_MODELO`, que entra en la huella y en la foto |

## Requisitos que vienen del informe QA de la `0.9.6` (sin bloqueantes; se resuelven en este rediseño)

| # | Hallazgo | Requisito en `0.9.7` |
|---|---|---|
| Q1 | Un año `descartado` tiene `participacion = null` y su curva real en `participacion_real`; `serieDeAnio` (`src/components/curvas/series.ts:62`) y `celdaAnioMes` (`vista.ts:830`) leen solo `participacion`, así que **el año desaparece** del gráfico y de la tabla | En la vista "curvas de los últimos años" **se ven todos los años con red**: cada serie usa `participacion_real ?? participacion` (y `participacion_parcial` en el año en curso); los descartados y excluidos a mano van en gris y **visibles por defecto** (decisión del dueño: "todos visibles"; las casillas "Mostrar" permiten apagarlos), los imputados punteados en sus meses, los del Niño con banda vertical, el año en curso discontinuo. Un año desaparece solo si no tiene red (`sin_red_comparable`) o no tiene volumen, y entonces la tabla lo lista con "—" y el motivo. Regla 47 |
| Q2 | `ruido_normal` solo viaja en `efecto_atipico.forma`, que es `null` en agrupaciones sin periodo atípico (hoy las 10 de toda temporada); el `confirm` dice "ruido: no medible" aunque haya dos años normales | `AgrupacionResultado.ruido_normal: number | null` **a nivel de agrupación** (la EAT entre sus años normales, calculada siempre que haya dos, exista o no periodo atípico) y `ruido_normal_detalle` con los pares; la frase de recomendación, la tabla de candidatas ("EAT 29.1 · ruido 33"), el `confirm` y la lista lo muestran **siempre junto al EAT**; "no medible" solo con menos de dos años normales. `efecto_atipico.forma.ruido_normal` sigue siendo el mismo valor. **`ruido_normal` también viaja en la lista y en las versiones**: la `vigente` de cada fila de `GET /api/curvas` y cada elemento de `GET …/versiones` llevan el `ruido_normal` de su foto (`resumen.ruido_normal`), para leer "EAT frente a ruido" sin abrir la agrupación. Regla 48 |
| Q3 | `carga_nueva` compara todos los meses publicados hoy con `resumen.cargas` de la corrida sin mirar `hasta_periodo` (`obsolescencia.ts:113`, `lectura.ts:119`): un mes posterior al `hasta` de la curva la marca obsoleta y **recalcular y aprobar no la limpia** si ese mes sigue fuera de `hasta` | Regla corregida: `carga_nueva` solo por **meses `≤ hasta_periodo` de la foto** que no estén en `cargas` o estén republicados con otro `carga_id`; un mes publicado posterior a `hasta` se informa aparte como **`datos_posteriores`** (aviso, no obsolescencia: "hay 1 mes publicado después de 2026-08; la curva sigue al día hasta ese mes") y se convierte en `carga_nueva` solo cuando el `hasta` por defecto (último publicado y cerrado) ya lo incluye. Reaprobar con el `hasta` nuevo la limpia; la foto guarda `hasta_periodo`, `hasta_fue_por_defecto` y `cargas` solo hasta ahí. Con `hasta_fue_por_defecto = false` (el planner paró antes a propósito) los meses posteriores son **siempre** aviso `datos_posteriores`. `hasta_periodo` **nunca se hereda** al reabrir. Regla 49 |
| Q4 | La `frase` del backend usaba coma decimal y el front, punto | Toda cifra de texto que genera el servidor (`formatearPuntos`, `formatearPp`, `formatearDecimal`, frases, detalles de avisos) y la pantalla usan el **mismo formateador `es-PE`** (`src/lib/formato.ts`): **punto decimal y coma de miles** (`27.4 pp`, `12,345`). Lo construido es esto, no la coma decimal que proponía la primera versión de la ficha (el `es-PE` de `toLocaleString` ya da punto decimal, y es lo que Javier lee en el resto de Vector2). Test de que ninguna `frase` ni `detalle` contiene un decimal con coma (`\d,\d` que no sea separador de miles `\d,\d{3}`) |
| Q5 | El detalle vive en estado React y se pierde al recargar | La agrupación abierta va en la URL: **`?agrupacion=<id>`** (y `&modelo=` para la candidata dibujada); recargar o compartir el enlace reabre la misma vista; "← Agrupaciones" quita el parámetro. Mismo patrón que `?hoy=` de M4 |
| Q6 | Contadores de "sin venta" incoherentes (`sin_venta` cuenta `origen === null` en el modelo y "tiene unidades" en `conVenta`) | Una sola definición: **`sin_venta` = la agrupación no tiene unidades positivas en ningún mes publicado** (venta cruda, antes de aplicar la red; la misma definición en el prerrequisito, en el modelo y en la lista; prerrequisito bloqueante en la vista: no hay nada que calcular ni aprobar); una agrupación **con venta pero sin años de ajuste suficientes** es `prestada` (candidata `T`) y **sí se puede aprobar** (el `confirm` lo dice: "curva prestada de la temporada"). `origen = null` solo ocurre si además `T` no existe (la temporada entera sin años), y entonces `sin_curva_posible` bloquea la aprobación. Regla 50 |
| Q7 | `/api/periodos-atipicos/anios` leía la corrida completa (~250 KB) tres veces | El flujo por agrupación lee solo lo de la agrupación: `calcular` lee una agrupación y las series por temporada; `/anios` sin `con_volumen` no lee venta; con `con_volumen=1` llama una vez a `venta_estacionalidad_agrupacion(null)` y no toca `corridas_estacionalidad`; la lista lee las fotos de las vigentes **sin `resultado`** (`select` de columnas): `parametros`, `red_comparable` y `resumen`, donde la obsolescencia encuentra todo lo que necesita (`cargas`, `temporada`, `atipicos`, `huella_temporada`, `hasta_periodo`, `hasta_fue_por_defecto`, `version_modelo`; ver "Foto de aprobación"). `resultado` solo lo lee "Ver foto". Regla 46 (estático) lo cubre |

## Flujo de usuario paso a paso (planner)

**Paso 0 · Entrar.** `/planificacion/curvas-estacionalidad` abre en la pestaña **Agrupaciones**. Arriba, el resumen: "15 agrupaciones activas · 0 con curva aprobada · 15 sin curva · 0 obsoletas"; avisos globales de prerrequisitos (por ejemplo "No hay periodos atípicos cargados: las 5 agrupaciones de invierno y verano no se pueden calcular → Periodos atípicos"; "2 tiendas sin fecha de apertura → Tiendas"; "Falta cargar 2025-11"). *Decide*: por dónde empezar (filtros por temporada, estado, género; buscador).

**Paso 1 · Abrir una agrupación.** Pulsa **Trabajar** en una fila. La pantalla pasa a la vista de esa agrupación y pide `POST /api/curvas/agrupaciones/[id]/calcular` con los parámetros iniciales: el cuerpo es `{ partir_de_vigente: true }` y el servidor usa los de su última aprobación si existe, **salvo `hasta_periodo`, que arranca siempre en el defecto**; si no hay aprobación, los valores por defecto. Si la vigente usó otro `hasta`, la cabecera lo dice: "la vigente usó datos hasta 2026-08". Mientras llega: "Leyendo la venta de HO INVIERNO (45 meses, 10 tiendas)…".

**Paso 2 · Prerrequisitos.** Lo primero que se ve es la tarjeta **Antes de calcular**. Si algo bloquea (sin periodos para su temporada, tienda con venta sin fecha de apertura, sin ningún año completo, sin venta, sin equivalencias), no hay gráfico: se muestra el motivo con el enlace para arreglarlo y, cuando aplica, la casilla de excepción ("Confirmo que esta temporada no tiene años atípicos"). Si solo avisa (temporada "Toda temporada" sin confirmar, meses sin cargar que dejan un año incompleto, apertura dudosa, pocos años normales), el cálculo sigue y los avisos quedan visibles. *Decide*: corregir en M3/M4/M5/Periodos y volver, o aceptar la excepción.

**Paso 3 · Mirar las curvas.** Bloque **Curvas de la agrupación**: un gráfico con (a) la **aprobada vigente** (v2, gris oscuro), (b) **cada año** (2023 Niño completo, 2024, 2025 en continuo; 2026 parcial ene–set en discontinuo; descartados en gris), (c) la **propuesta del sistema** (trazo grueso) y la banda mín–máx; debajo, la tabla año × mes con las mismas filas, más las filas "Propuesta", "Aprobada v2" y "Diferencia (pp)". Conmutador Participación / Unidades. *Decide*: si lo que ve tiene sentido (un año raro, un mes en cero, una tienda que distorsiona), antes de mirar ninguna cifra de ajuste.

**Paso 4 · Entender la recomendación.** Bloque **Lo que propone el sistema**: la frase de recomendación ("Propone **A · Promedio simple** de 2023, 2024 y 2025 (2023, año del Niño, entra incluido: su forma difiere 31 pp de la referencia y los dos años normales difieren 33 pp entre sí). B se equivoca 27.4 pp frente a 29.1 de A en 3 pruebas; la diferencia (1.7) es menor que el margen de empate (0.25 × 33 ≈ 8.3 pp): sin evidencia para apartarse del promedio."), la tabla de candidatas con EAT y **el número de pruebas** de cada una (y EAT por pliegue desplegable), "Igual a A", "No disponible: motivo", y el `radio` para dibujar otra candidata en el gráfico y en la tabla. Al lado, el bloque **Efecto del Niño en esta agrupación** (volumen por año sobre tiendas comunes; forma con las tres cifras y el veredicto; para 2026 las dos formas parciales). *Decide*: quedarse con la recomendada o elegir otra (con nota).

**Paso 5 · Ajustar parámetros de esta agrupación (opcional).** Panel **Parámetros de esta agrupación** (plegado por defecto cuando no hay nada fuera del valor por defecto). Primera entrega: años (cada año con su clase y una casilla "Excluir del ajuste"), tratamiento del Niño (`auto` / incluir / imputar / descartar), la lista de tiendas de la red con casilla "Excluir", y "Calcular hasta" (arranca siempre en el defecto). Los umbrales (piso de forma, margen sobre el ruido, mínimo de unidades por año, máximo de huecos, dominante, liquidación, meses de tienda nueva, solo tiendas completas, exigir venta todo el año) van con su valor por defecto y su edición se difiere a la segunda entrega (siguen en el esquema y en la foto). Cada cambio **recalcula** (debounce 300 ms, cancelando la petición anterior; la lectura de venta está cacheada por huella, así que la respuesta tarda milisegundos) y el gráfico, la tabla, la recomendación y el comparador se actualizan; un chip "3 parámetros distintos del valor por defecto" y el botón "Restablecer". **Excluir un año o una tienda, o fijar un tratamiento distinto de `auto`, exige escribir el motivo** en el campo "Nota / motivo" antes de aprobar. *Decide*: qué años y tiendas cuentan para esta agrupación y con qué tratamiento del Niño, y por qué.

**Paso 6 · Comparar con la aprobada.** Bloque **Aprobada frente a propuesta** (solo si hay vigente): EAT entre ambas, la fila de doce diferencias con color por signo, "el mes que más cambia: enero (+1.8)"; si el conjunto de años de ajuste no es el de la aprobación vigente, el aviso "EAT no comparable con el cálculo anterior (la vigente usó 2024 y 2025; hoy 2023, 2024 y 2025)"; si la foto vigente se hizo con otra versión del modelo, "calculada con un modelo anterior"; y, si la vigente está **obsoleta**, el motivo nombrado ("la tienda T10 entra en la red de 2026; mes publicado después: 2026-09"). *Decide*: si vale la pena reemplazar la vigente.

**Paso 7 · Aprobar.** Botón **Aprobar esta curva** (campo "Nota / motivo", obligatorio si la elegida no es la recomendada, si hay años o tiendas excluidos a mano o si el tratamiento no es `auto`: así queda escrito por qué). El `confirm` resume: agrupación, temporada, candidata, años usados con clase y tratamiento, años y tiendas excluidos a mano, EAT frente al ruido (y "no comparable" si cambió el conjunto de años), diferencia con la vigente, `hasta`, avisos. `PUT /api/curvas/agrupaciones/[id]` con `{ modelo, parametros (con hasta_periodo explícito), huella_calculo, version_vigente, nota }`: el servidor recalcula con esos parámetros, comprueba que la huella coincide (si los datos cambiaron entre abrir y aprobar responde `409 datos_cambiados` y la pantalla recarga) y que la vigente sigue siendo la que el planner vio (`409 vigente_cambiada` si otro usuario aprobó o retiró mientras tanto), guarda la **foto** y crea la versión siguiente. Mensaje: "Curva A aprobada como versión 3 de HO INVIERNO". La lista la muestra "Al día".

**Paso 8 · Historial.** Bloque **Versiones** al pie: v3 vigente, v2 reemplazada, v1 reemplazada (modelo, fecha, quién, nota, mini curva); "Ver foto" abre el detalle congelado de esa versión (datos y parámetros de aquel momento, comparado con **la curva de esa misma foto**, sin obsolescencia). **Retirar** (confirm) deja la agrupación sin curva.

**Paso 9 · Volver a la lista y seguir con la siguiente.** "← Agrupaciones" conserva filtros; la fila recién aprobada queda "Al día · v3 · A · hoy". Cuando cambien los datos (mes nuevo ya cerrado, tienda que cumple su primer año completo, equivalencia movida, periodo editado, y, si la curva es prestada, composición o temporada de otra agrupación de su temporada), la fila pasará a **Obsoleta** con el motivo; **Comparar con el sistema** (por fila) calcula la propuesta de hoy y muestra la diferencia, sin aprobar nada.

### Qué decide el planner y qué decide el sistema

| Decisión | Quién | Dónde |
|---|---|---|
| Qué agrupación trabajar y en qué orden | planner | lista |
| Temporada de la agrupación | planner (M3 o cabecera de la agrupación) | prerrequisito (avisa) |
| Qué meses son del Niño | planner (catálogo) | prerrequisito (bloquea sin periodos para invierno/verano) |
| Qué tiendas forman la red de cada año | sistema (fechas de M4 y venta de M5) + planner (exclusión manual con motivo visible) | panel Red |
| Qué años entran en el ajuste | sistema (clase, escaso, tratamiento efectivo) + planner (`anios_excluidos`, `tratamiento_atipicos`) | panel Años |
| Qué candidata se propone | sistema (backtesting, empate relativo al ruido) | bloque Lo que propone el sistema |
| Qué candidata se aprueba | **planner**, una por agrupación | botón Aprobar |
| Cuándo una curva está obsoleta | sistema (huellas) | lista y cabecera |
| Cuándo reaprobar | planner | lista → Trabajar |

## Conceptos nuevos o ajustados

### Cálculo a demanda y foto de aprobación

Un **cálculo** es la ejecución de `calcularCorrida` (06, regla 19, sin cambios) sobre la entrada de **una** agrupación; es determinista, dura milisegundos y **no se guarda**. Lo que se guarda es la **foto de aprobación**: la fila de `corridas_estacionalidad` que `PUT` inserta justo antes de la curva, con `agrupacion_estacionalidad_id` (nueva columna), `parametros` (incluidos `anios_excluidos` y `tiendas_excluidas`), `resultado = { agrupaciones: [la agrupación], temporadas: [la suya y, si es distinta, todo_el_ano como control] }`, `red_comparable`, `efecto_atipico` (solo su temporada y el control), `resumen` (`cargas` solo hasta `hasta_periodo`, `cargas_huella`, `red_huella`, `composicion_huella`, `temporada`, `huella_temporada`, `atipicos` (los meses atípicos aplicados a su temporada, `aaaa-mm`, ordenados), `ruido_normal`, `huella_calculo`, `hasta_periodo`, `hasta_fue_por_defecto`, `version_modelo`, `meses_publicados`, `duracion_ms`) y quién. **Todo lo que la obsolescencia y la lista necesitan está en `parametros`, `red_comparable` y `resumen`**: `resultado` no se vuelve a leer salvo en "Ver foto" (es lo más simple y fiable: la lista nunca deserializa 40 KB por fila, y la obsolescencia no depende de la forma interna de `resultado`). `curvas_estacionalidad.corrida_id` apunta a la foto: el contrato con M7 (`GET /api/curvas/vigentes`, `curva_id`, `version`, huellas) **no cambia**.

**Huella de cálculo** (`huella_calculo`, `huellas.ts`): md5 de `VERSION_MODELO | cargas_huella | red_huella | composicion.huella | temporada | huella_temporada | hasta_periodo | periodos aplicables (id, desde, hasta ordenados) | parámetros canónicos`. Identifica la entrada: dos cálculos con la misma huella dan el mismo resultado (regla 19). Sirve para (a) rechazar una aprobación cuya entrada ya no es la que el planner vio (`409 datos_cambiados`) y (b) saber en la lista, sin calcular, que "el sistema hoy" propondría lo mismo que al aprobar.

**Huella de temporada** (`huella_temporada`, `huellas.ts`, nueva): md5 de los tríos ordenados `(id, temporada, huella de composición)` de las agrupaciones **activas** de la temporada de la agrupación y de las de toda temporada (el control). Cubre lo que la huella de cálculo no cubría: la curva `T` y el control de todo el año salen de las **otras** agrupaciones, así que una composición movida o una temporada cambiada en cualquiera de ellas cambia la entrada. Se guarda en la foto; la obsolescencia la compara con la de hoy (motivo `temporada_recompuesta` si la curva vigente es prestada; aviso si es propia, porque su curva no depende de `T`). `cargas_huella` sale de `cargas` de la misma función SQL (mismo estado que los datos).

**Versión del modelo** (`VERSION_MODELO`, constante en `modelo.ts`, entera, empieza en `1`): sube cuando cambia una fórmula o un valor por defecto que altera el resultado con la misma entrada. Entra en la huella y en la foto (`version_modelo`); una vigente con `version_modelo < VERSION_MODELO` recibe el aviso `modelo_anterior` ("calculada con un modelo anterior"; no es obsolescencia: los datos no cambiaron, pero el planner sabe que hoy el sistema puede proponer otra cosa).

**Caché de lectura** (`src/lib/curvas/cache-venta.ts`, servidor): la salida de `venta_estacionalidad_agrupacion(id)` se guarda en memoria del proceso (Railway es un proceso persistente) con clave `id | cargas_huella | composicion.huella | huella_temporada`, TTL 120 s y a lo sumo 20 entradas (LRU). Las tres huellas de la clave salen de lecturas pequeñas (`cargas_venta_stock`, `equivalencias`, `agrupaciones_estacionalidad`) que `calcular` hace de todos modos; si la clave coincide, no se llama a la función (el modelo corre en milisegundos y mover un parámetro responde al instante). Descartado: recalcular en el navegador (habría que enviar ~200 KB de venta y meter el modelo en el bundle; el `PUT` recalcula igual en el servidor). Una entrada caducada o con otra huella se lee de nuevo: la caché nunca devuelve un estado distinto del que la huella describe. `cargas_huella` de la respuesta y la huella de la caché son la misma cosa.

### Estado de una agrupación en la lista (sin corrida)

| Estado | Condición | Cómo se ve |
|---|---|---|
| `sin_curva` | sin curva vigente | badge "Sin curva"; botón Trabajar |
| `al_dia` | vigente, `obsoleta = null` y `recomendada = true` en la foto | "Al día · v2 · A · 15/10 · Javier" |
| `al_dia_distinta` | vigente, no obsoleta, pero se aprobó una candidata distinta de la recomendada | "Al día · v2 · **B** (el sistema proponía A)"; `title` con la nota |
| `obsoleta` | `motivosObsoleta` no vacío (06, regla 24, más `temporada_recompuesta` para curvas prestadas, regla 51) | badge ámbar "Obsoleta: la tienda X entra en la red de 2026"; botón Comparar con el sistema |
| `inactiva_con_curva` | agrupación inactiva con vigente | al final, atenuada |

Además del estado, dos **avisos** por fila que no cambian el estado: `datos_posteriores` (mes publicado después del `hasta` de la curva, no cerrado o con `hasta_fue_por_defecto = false`) y `modelo_anterior` (`version_modelo` de la foto menor que `VERSION_MODELO`). Si la curva vigente es propia y cambió `huella_temporada`, aviso `temporada_recompuesta` (no obsolescencia).

Por qué basta con esto: si nada de lo que la huella cubre cambió, el modelo es determinista y la propuesta de hoy es la de la foto; si algo cambió, la curva es `obsoleta` por definición y la propuesta de hoy se calcula a demanda ("Comparar con el sistema"). No hace falta una corrida global ni guardar propuestas. El resultado de "Comparar" vive en memoria de la pantalla (columna "Sistema hoy": candidata, EAT frente a la vigente, "difiere 4.1 pp") hasta recargar.

### Prerrequisitos de una agrupación (lo que faltó en la 0.9.6)

`prerrequisitosAgrupacion(entrada)` (pura, `src/lib/curvas/prerrequisitos.ts`) devuelve `{ bloquea: Prerrequisito[], avisa: Prerrequisito[] }` con `{ codigo, detalle, enlace: { pantalla, id? } | null }`. Se evalúa **sobre la entrada ya armada** (`armarEntradaAgrupacion` es pura y barata; así `sin_venta`, `sin_anio_completo` y `tienda_sin_apertura` miran exactamente los mismos datos que el modelo y no hay dos definiciones); con `bloquea` no vacío, el endpoint responde `200` con `calculo: null` (la pantalla muestra la tarjeta y nada más). `tienda_sin_apertura` solo cuenta tiendas **con venta publicada** (una tienda sin venta y sin fecha no impide decidir la red).

| Código | Nivel | Condición | Arreglo |
|---|---|---|---|
| `sin_meses_publicados` | bloquea | M5 sin cargas publicadas | Venta y stock |
| `sin_anio_completo` | bloquea | ningún año calendario con los 12 meses publicados antes de `hasta_periodo` | cargar los meses que faltan (lista) |
| `periodos_temporada_faltantes` | bloquea | agrupación de `invierno` o `verano` **y** ningún periodo atípico activo cuyo conjunto `temporadas` incluya la suya; se levanta con `sin_periodos_confirmado = true` (casilla "Confirmo que esta temporada no tiene años atípicos", que se guarda en la foto) | Periodos atípicos |
| `tienda_sin_apertura` | bloquea | una tienda de tipo Tienda, activa, **con venta publicada** y sin `fecha_apertura` (la red comparable no se puede decidir) | Tiendas (enlace a la fila) |
| `sin_venta` | bloquea | la agrupación no tiene unidades positivas en ningún mes publicado (venta cruda, antes de la red; Q6) | revisar la asignación en M3 |
| `composicion_vacia` | bloquea | 0 equivalencias activas | M3 |
| `temporada_sin_confirmar` | avisa | `temporada = todo_el_ano` y la agrupación nunca tuvo curva aprobada (al aprobar, el `confirm` repite la temporada: aprobar la confirma) | cabecera o M3 |
| `meses_sin_cargar` | avisa | huecos en la serie publicada hasta `hasta_periodo` (los años afectados son `incompleto` y no entran) | Venta y stock |
| `periodo_fuera_de_datos` | avisa | un periodo aplicable incluye meses posteriores al último publicado (normal en el año en curso) | — |
| `apertura_dudosa` / `cierre_dudoso` | avisa | de la red comparable (06, regla 4d) | Tiendas |
| `pocos_anos_normales`, `escaso`, `cambio_volumen_extremo`, `tienda_dominante`, `tienda_distinta`, … | avisa | avisos del modelo (06), se muestran en el mismo bloque | — |

En la lista, los prerrequisitos **globales** (los que no dependen de la agrupación: meses, periodos por temporada, tiendas sin apertura) se calculan una vez y se muestran arriba; por fila, un icono si la agrupación tiene alguno que bloquea (sin calcular: temporada y conteo de periodos aplicables, composición, y para `sin_venta` el dato de la última foto o "—").

### Parámetros por agrupación

`ParametrosCurvas` de la 06 (sin cambios de nombre ni valor por defecto) más tres campos:

| Campo | Tipo | Defecto | Efecto |
|---|---|---|---|
| `anios_excluidos` | `number[]` | `[]` | el año queda `tratamiento = 'descartado'` con motivo `excluido_manual`, fuera del ajuste y de la referencia de forma; se dibuja en gris; sigue contando para el volumen (diagnóstico) |
| `tiendas_excluidas` | `uuid[]` | `[]` | la tienda sale de la red de todos los años con motivo `excluida_manual` (nuevo en `MOTIVOS_RED`) |
| `sin_periodos_confirmado` | `boolean` | `false` | levanta `periodos_temporada_faltantes` |

Los parámetros de la **última aprobación** son el punto de partida al reabrir la agrupación (con el botón "Restablecer valores por defecto"); así "Comparar con el sistema" compara like-for-like. **Excepción: `hasta_periodo` nunca se hereda**: cada apertura arranca en el defecto (último mes publicado y cerrado en Lima), la cabecera dice "la vigente usó datos hasta 2026-08" cuando difiere, y el `PUT` exige el `hasta_periodo` **explícito** que devolvió `calcular` (`datos.hasta_periodo`). El servidor guarda en la foto `hasta_fue_por_defecto` (`true` si el `hasta` aprobado era el defecto en ese momento): con `false`, los meses publicados posteriores son solo aviso `datos_posteriores`, nunca `carga_nueva` (el planner eligió parar ahí a propósito).

**Nota obligatoria** (`409 nota_requerida`): apartarse de la recomendada, `anios_excluidos` o `tiendas_excluidas` no vacíos, o `tratamiento_atipicos ≠ 'auto'`. Es un solo campo "Nota / motivo" que queda en la versión (`nota`) y se ve en la lista y en Versiones.

**Primera entrega** del panel: años, tratamiento del Niño, tiendas y "Calcular hasta". Los umbrales (`umbral_forma`, `margen_ruido`, `min_unidades_ano`, `max_meses_hueco`, `umbral_tienda_dominante`, `umbral_cambio_volumen`, `umbral_liquidacion`, `meses_tienda_nueva`, `solo_tiendas_completas`, `exigir_venta_todo_el_ano`) siguen en el esquema y en la foto con su valor por defecto; su edición en pantalla es de la segunda entrega.

### Las tres curvas en el mismo gráfico y la misma tabla

Series (todas existen ya en `AgrupacionResultado`): **aprobada vigente** (`vigente.curva`), **años** (`anios[].participacion_real ?? participacion` continuo, de modo que un año descartado o excluido sigue dibujado, Q1; `participacion` imputada punteada en los meses imputados; `participacion_parcial` del año en curso discontinuo; escasos atenuados; descartados y excluidos en gris, visibles por defecto; meses atípicos con banda vertical; liquidación con punto ámbar), **propuesta** (la candidata elegida con el `radio`; por defecto la recomendada; `T` encendible) y **banda** mín–máx. La tabla año × mes (`TablaMatriz`) añade al pie las filas **Propuesta**, **Aprobada vN** y **Diferencia (pp)** con color por signo (`claseVariacion` de M11), y la cabecera de cada año lleva clase, tratamiento, unidades, tiendas en la red y peso de la mayor. CSV con las mismas filas.

## Modelo de datos

Migración **`0017_venta_estacionalidad_agrupacion.sql`**: **ya aplicada en `vector-two` y commiteada** (función, columna con FK, índice y `comment on`). Esta revisión le añade **un ajuste en el mismo archivo** (apartado 1b): se reescribe la función con `create or replace function`, idempotente, sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE` (tampoco dentro de la función), sin bloques `do $$`; `datos` reaplica la `0017` completa (todas sus sentencias son repetibles), regenera los tipos y comprueba que sigue siendo la última. Convenciones de `0014` a `0016`: `revoke` a `public`, `anon` y `authenticated` más `grant` a `service_role`, `security invoker` y `search_path = ''`.

### 1. Función `venta_estacionalidad_agrupacion(p_agrupacion_id uuid default null) returns jsonb`

`language sql`, `stable`. Es la **única lectura de venta de M6** a partir de esta entrega y devuelve, en una sola sentencia (un solo estado de los datos), tres bloques sobre `venta_stock_vigente` (solo cargas publicadas):

```jsonc
{ "agrupacion": [ { "tienda_id": "…", "periodo": "2024-01-01", "unidades": 930, "venta_soles": 41200.50, "costo_vendido": 20100.25 }, … ] | null,   // solo con p_agrupacion_id; medido 263 a 457 objetos según la agrupación
  "temporadas": [ { "temporada": "invierno", "tienda_id": "…", "periodo": "2024-01-01", "unidades": 12030 }, … ],                                // temporada × tienda × mes, medido ~1 371 objetos
  "meses_publicados": [ "2023-01-01", … ],                                                                                                       // de cargas_venta_stock publicadas
  "cargas": { "2023-01-01": "<carga_id>", … } }                                                                                                  // 1b: periodo → id de la carga publicada (misma forma que leerCargasPublicadas)
```

- `temporada` sale de `equivalencias → agrupaciones_estacionalidad`: la `temporada` de la agrupación **activa**; `'sin_agrupacion'` para equivalencias sin agrupación o con agrupación inactiva. Así la suma de `temporadas` por tienda y mes es la **venta total de la tienda** (la red comparable se decide sobre la venta total, 06 regla 4), y los objetos con `sin_agrupacion` dan `unidades_sin_agrupacion`. `calcular` y `PUT` **no llaman** a `venta_mensual_tienda()` ni a `leerCargasPublicadas` (todo sale de esta función, un solo estado de los datos); `venta_mensual_tienda()` se conserva para `GET /api/curvas` (obsolescencia de la lista, como hoy), `GET /api/curvas/red-comparable` y M11.
- `agrupacion` es la suma por tienda y mes de las equivalencias con `agrupacion_estacionalidad_id = p_agrupacion_id` (activas o no: los hechos de una equivalencia desactivada siguen siendo venta de esa agrupación mientras apunte a ella; coincide con lo que hacía la MV). Entra por el índice de `equivalencias(agrupacion_estacionalidad_id)` y el de `venta_stock_mensual(equivalencia_id, carga_id)`.
- `numeric` viaja como número o texto (lo normaliza `leerAgregado`, que se reutiliza con la forma nueva); `date` como `aaaa-mm-dd`.
- Por qué `jsonb` y no `setof`: `temporadas` supera el corte de 1 000 filas de PostgREST; paginar un `rpc` reejecutaría el agregado por página. ~1 600 a 1 800 objetos pesan menos de 250 KB.
- Costo: un agregado completo de `venta_stock_vigente` (870 359 filas hoy, `group by` de tres columnas; del orden de `venta_mensual_tienda()`, que ya corre en cada `GET /api/curvas`) más uno indexado para la agrupación. **Medido en `vector-two`: 0.6 a 1.5 s con y sin id**, dentro del objetivo (< 3 s la vista); se vuelve a anotar en el hito. Si dejara de caber, la salida de reserva es que la **misma función** lea de la MV `venta_mensual_estacionalidad` refrescada con `refrescar_venta_mensual_estacionalidad()` cuando cambie la huella de cargas (una función nueva en una `0018`, sin tocar la API); por eso la MV no se declara muerta, solo sin uso.
- Con `p_agrupacion_id` nulo (`agrupacion: null`) sirve a la pestaña Años Niño y a `/anios` (factor por temporada).

### 1b. Ajuste de esta revisión (mismo archivo `0017`, `create or replace function`)

La función devuelve además **`cargas`**: `jsonb` objeto `{ periodo (aaaa-mm-dd) → id de la carga publicada }`, construido en la misma sentencia a partir del CTE `meses` (que pasa a seleccionar `c.periodo, c.id` de `cargas_venta_stock` con `estado = 'publicada'`; `jsonb_object_agg(periodo::text, id)`; M5 garantiza una publicada por periodo). Por qué: la huella de cargas y los datos deben salir del **mismo estado** (una sola sentencia `stable`); si `calcular` leyera `cargas_venta_stock` aparte, una publicación entre las dos lecturas daría una huella que no describe los datos leídos. `meses_publicados` se conserva (es `Object.keys(cargas)` ordenado; se mantiene por compatibilidad del `jsonb`, cuesta nada). Cambia el `comment on function` para nombrar `cargas`. Sin cambios en la columna, la FK, el índice ni los `comment on` del apartado 3 (se dejan tal cual en el archivo: son repetibles). `datos` aplica la `0017` completa de nuevo con el MCP y regenera `database.types.ts`.

### 2. `corridas_estacionalidad.agrupacion_estacionalidad_id uuid null`

`add column if not exists … references public.agrupaciones_estacionalidad(id) on delete restrict`; índice `corridas_estacionalidad_agrupacion_idx (agrupacion_estacionalidad_id, created_at desc)`. **Nulo = corrida global heredada de la `0.9.6`** (hay una en la base; se conserva como historial, sin uso); **no nulo = foto de aprobación de esa agrupación**. `comment on column`. El `check` de 4 MB de `resultado` sigue sobrando; no se toca.

### 3. Lo que queda sin uso (no se puede borrar; se documenta con `comment on`)

- `corridas_estacionalidad.referencia` y su índice único parcial: **sin uso desde `0.9.7`** (ninguna ruta lo lee ni lo escribe; el factor del Niño se calcula a demanda). El comentario lo dice.
- MV `venta_mensual_estacionalidad`, `refrescar_venta_mensual_estacionalidad()` y `refrescar_y_leer_agregado_estacionalidad()`: **sin uso**; quedan como reserva de rendimiento (arriba). La MV sigue protegida con `revoke` y vacía o con el último refresco; nadie la lee.
- `venta_mensual_tienda()` y `unidades_mensuales()`: siguen en uso (obsolescencia, vista previa de la red, M11).

### Diagrama

```
periodos_atipicos (temporadas[]) ─┐
agrupaciones_estacionalidad.temporada ─┼─► prerrequisitosAgrupacion ─► [bloquea] tarjeta "Antes de calcular"
tiendas (M4) ─────────────────────┤
cargas publicadas (M5) ───────────┤
venta_stock_vigente ─► venta_estacionalidad_agrupacion(id) [0017, jsonb] ─┘
        │  (una lectura por apertura o cambio de parámetro; nada se guarda)
        ▼
armarEntradaAgrupacion ─► calcularCorrida (06, sin cambios) ─► POST /api/curvas/agrupaciones/[id]/calcular ─► pantalla: aprobada · años · propuesta
        │ el planner aprueba UNA curva con sus parámetros y la huella del cálculo
        ▼
PUT /api/curvas/agrupaciones/[id] ─► recalcula, compara huella ─► corridas_estacionalidad (foto, agrupacion_estacionalidad_id) ─► curvas_estacionalidad (vigente v+1) ─► M7 (GET /api/curvas/vigentes: sin cambios)
```

## Contratos de API

Convenciones de la 06: `{ data }` con `ok()`, `{ error, codigo }` con `errorConCodigo`, cuerpos con `leerCuerpo`, esquemas zod en `src/lib/curvas/esquemas.ts`, `idDeRuta`, `traducirErrorDb`. **Toda ruta de M6 exige `requirePlanner`.** Errores: `401` · `403` · `400` zod · `404` id inexistente o no UUID · `409` regla de negocio · `500`.

### Rutas que cambian o nacen

| Ruta | Método | Cuerpo / query | Respuesta |
|---|---|---|---|
| `/api/curvas` | GET | — | **`EstadoCurvasApi` v2** (abajo): sin `corrida` ni `corridas`; `estado` por agrupación; prerrequisitos globales |
| `/api/curvas/agrupaciones/[id]/calcular` | **POST** (lectura con cuerpo, como `POST /api/reportes/agrupacion-gmle/unidades-mensuales`) | `calcularAgrupacionSchema` | `200 TrabajoAgrupacionApi` (abajo). `404` agrupación · `409 hasta_periodo_sin_cargar` (el `hasta_periodo` pedido no está publicado en Venta y stock). Nunca escribe |
| `/api/curvas/agrupaciones/[id]` | PUT | `aprobarCurvaSchema` | `201 { curva, foto_id }`. `404` · los `409` se evalúan **en este orden** (el servidor responde el primero que se cumple): `hasta_periodo_sin_cargar` (el `hasta_periodo` enviado no es un mes publicado) · `agrupacion_inactiva` · `prerrequisitos` (algún bloqueante) · `sin_curva_posible` (`origen = null`: ni propia ni `T`) · `candidata_no_disponible` · `datos_cambiados` (la huella recalculada difiere de `huella_calculo`) · `vigente_cambiada` (`version_vigente` enviada ≠ versión vigente hoy: otro usuario aprobó o retiró mientras tanto) · `sin_cambio` (misma candidata y misma huella que la vigente) · `nota_requerida` (candidata distinta de la recomendada, años o tiendas excluidos, o tratamiento ≠ `auto`, sin nota) |
| `/api/curvas/agrupaciones/[id]` | DELETE | — | retira la vigente (sin cambios) |
| `/api/curvas/agrupaciones/[id]/versiones` | **GET** | — | `{ versiones: [{ id, version, estado, modelo, origen, recomendada, eat, curva, nota, aprobada_at, usuario_nombre, foto_id, parametros_resumen }] }` por `version desc` |
| `/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` | GET | `?modelo=` | **se conserva con dos ajustes**: lee la foto con `leerCorridaPorId` (no `resolverCorrida`, que se borra) y el comparador compara con **la curva de esa foto** (`curvas_estacionalidad where corrida_id = [id]`), no con la vigente de hoy; **sin obsolescencia** (es una foto). `404` si la corrida no es de esa agrupación |
| `/api/curvas/anios-atipicos` | GET | — | **calcula a demanda** con `venta_estacionalidad_agrupacion(null)`: `{ efecto: EfectoAtipicoCorrida, periodos, anios, temporadas, calculado_at, huella_cargas }`; ya no recibe `corrida_id` |
| `/api/periodos-atipicos/anios` | GET | `?con_volumen=1` y `?agrupacion_id=` opcionales | sin `con_volumen`, `ratio_volumen` y `volumen` son `null` (barato; la pestaña Periodos lo usa así). Con `con_volumen=1` (M7 y la pestaña Años Niño) se calculan a demanda llamando **una vez** a `venta_estacionalidad_agrupacion(agrupacion_id ?? null)` (con `agrupacion_id` el diagnóstico de la agrupación sale de `agrupacion`, no de ninguna corrida); `corrida_id` pasa a `null` siempre y se añaden `calculado_at`, `huella_cargas` y el aviso `parametros_por_defecto` ("el factor se calculó con los parámetros por defecto, no con los de cada curva aprobada") |
| `/api/curvas/vigentes` · `/api/curvas/red-comparable` · `/api/periodos-atipicos*` | | | **sin cambios** |

### Rutas que se retiran (se borran los handlers)

`POST /api/curvas/calcular`, `GET /api/curvas/corridas`, `GET` y `PATCH /api/curvas/corridas/[id]`. El test estático de guards no las echa de menos; se añade un test estático de que **no existen** (regla 31b).

### Esquemas

```ts
export const calcularAgrupacionSchema = calcularSchema                       // 06: mismos campos y defectos, sin marcar_referencia
  .omit({ marcar_referencia: true })
  .extend({
    anios_excluidos: z.array(z.number().int().min(2000).max(2100)).max(20).default([]),
    tiendas_excluidas: z.array(z.uuid()).max(100).default([]),
    sin_periodos_confirmado: z.boolean().default(false),
    hasta_periodo: mes.optional(),                    // por defecto el último mes publicado y cerrado; nunca se hereda
    partir_de_vigente: z.boolean().default(false),   // solo en el cuerpo de calcular (ver abajo)
  }).strict();                                         // clave desconocida (p. ej. marcar_referencia) -> 400

export const aprobarCurvaSchema = z.object({
  modelo: z.enum(MODELOS_CURVA),                                             // A..E, T
  parametros: z.object({ hasta_periodo: mes, ...camposParametros }).strict(), // los que vio el planner (sin partir_de_vigente); hasta_periodo OBLIGATORIO (el que devolvió calcular en datos.hasta_periodo)
  huella_calculo: z.string().regex(/^[0-9a-f]{32}$/),                         // la que devolvió calcular
  version_vigente: z.number().int().min(1).nullable(),                        // la versión vigente que vio el planner (null si no había)
  nota: z.string().trim().max(300).optional(),                                // sin saltos de línea ni caracteres de control o de dirección de texto
}).strict();
// No existen `elegirCurvaSchema` (sustituido), `marcarReferenciaSchema` ni `aprobarSchema` en bloque (estático).
```

**`partir_de_vigente` en el cuerpo de calcular.** Lo construido resuelve el punto de partida "los parámetros de la última aprobación" (decisión 10) **en el servidor**: con `{ partir_de_vigente: true }` el handler lee la foto de la vigente y usa sus parámetros (los demás campos del cuerpo se ignoran) y **nunca** su `hasta_periodo`, que arranca en el defecto o en el `hasta_periodo` que venga en el cuerpo. La pantalla abre la agrupación con `CUERPO_APERTURA = { partir_de_vigente: true }`; al mover un parámetro envía los parámetros completos y `partir_de_vigente` queda en `false`; "Restablecer" envía el cuerpo vacío (valores por defecto). `PUT` no lo acepta (su `parametros` es el conjunto completo que el planner vio, con `hasta_periodo` explícito).

**Errores en el cliente (`src/lib/api-client.ts`).** `ErrorApi` extiende `Error` y guarda `status` y `codigo` (el `{ error, codigo }` de la API); `codigoDeError(e)` devuelve el `codigo` o `null`. Así la pantalla distingue un `409` de otro sin leer el texto: `errorDeAprobar(codigo, mensaje)` (`trabajo-vista.ts`) devuelve el mensaje y una acción sugerida (volver a calcular o cargar para `datos_cambiados`, `vigente_cambiada` y `prerrequisitos`; escribir la nota para `nota_requerida`; elegir otra candidata para `candidata_no_disponible`; enlace a Venta y stock o a Agrupaciones de estacionalidad según el caso). `mensajeError(e)` sigue funcionando igual.

### `POST /api/curvas/agrupaciones/[id]/calcular` → `TrabajoAgrupacionApi`

Pasos del handler: (1) en paralelo, `leerAgrupacionConDatos(id)` (géneros, equivalencias activas, huella, temporada, última foto si tiene vigente), `leerAgrupacionesDeTemporada(temporada)` (id, temporada y huella de composición de las activas de su temporada y de toda temporada → `huella_temporada`), `leerTiendas`, `leerPeriodos(activos)`, `leerCurvaVigente`, y la lectura de venta **por la caché** (`leerVentaAgrupacionCacheada(id, clave)`: una llamada a `venta_estacionalidad_agrupacion(id)` solo si la clave no está; `cargas` de la respuesta da `cargas_huella`; **no** se llama a `venta_mensual_tienda()` ni a `leerCargasPublicadas`); (2) `armarEntradaAgrupacion` (series de la agrupación y de **todas las temporadas presentes** en `temporadas` sobre la red comparable de cada año; `tiendas_excluidas` aplicadas en `redComparable`); (3) `prerrequisitosAgrupacion(entrada)` → si bloquea, `200` con `calculo: null`; (4) `calcularCorrida` (06) con `series_temporada` y `efectoAtipicoCorrida` con los grupos de temporada; (5) obsolescencia de la vigente a partir de su foto (`motivosObsoleta` con `huella_temporada` y `hasta_fue_por_defecto`; aviso `modelo_anterior`); (6) comparador vigente / candidata pedida, con `comparable_con_vigente` (mismo conjunto de años de ajuste); (7) `huella_calculo` con `VERSION_MODELO` y `huella_temporada`.

```jsonc
{ "data": {
  "agrupacion": { "id", "nombre", "codigo", "activo", "temporada", "temporada_sugerida", "generos", "equivalencias_activas" },
  "datos": { "desde": "2023-01", "hasta": "2026-09", "meses_publicados": 45, "faltantes": [], "hasta_periodo": "2026-09", "hasta_fue_por_defecto": true, "ultimo_mes_cerrado": "2026-09", "cargas_huella": "md5…" },
  "parametros": { …efectivos, con defectos aplicados… },
  "prerrequisitos": { "bloquea": [], "avisa": [ { "codigo": "temporada_sin_confirmar", "detalle": "Sigue en Toda temporada: confirma la temporada antes de aprobar", "enlace": null } ] },
  "huella_calculo": "md5…",
  "huella_temporada": "md5…",
  "version_modelo": 1,
  "calculo": {                                                       // null si bloquea
    "resultado": { …AgrupacionResultado de la 06; añade ruido_normal y ruido_normal_detalle a nivel de agrupación (Q2: es `prep.ruido`, que ya se calcula siempre), candidatas[].pruebas (número de pliegues del backtesting) y anios[].tratamiento_motivo con 'excluido_manual'… },
    "temporada_curva": { …TemporadaResultado de su temporada… },
    "efecto_temporada": [ …EfectoTemporadaAnio de su temporada y de todo_el_ano (control)… ],
    "red": [ …RedAnioApi con codigo y nombre; motivos incluyen 'excluida_manual'… ],
    "tiendas": [ { "id", "codigo", "nombre" } ],
    "duracion_ms": 1840 },
  "vigente": { …VigenteResumenApi… , "foto_id": "…", "recomendada_entonces": "A", "parametros": { … }, "huella_calculo": "md5…", "hasta_periodo": "2026-08", "hasta_fue_por_defecto": true, "version_modelo": 1, "anios_ajuste": [2024, 2025], "nota": null } | null,
  "obsoleta": { "motivos": [ … ] } | null,
  "avisos_vigente": [ "datos_posteriores" | "modelo_anterior" | "temporada_recompuesta" ],
  "comparador": { …ComparadorApi (candidata pedida por `?modelo=` o la recomendada frente a la vigente)…, "comparable_con_vigente": true } | null,
  "versiones": 2 } }
```

### `PUT /api/curvas/agrupaciones/[id]`

(1) Lee lo mismo que `calcular` (la caché vale: la huella se recalcula igual); (2) `prerrequisitosAgrupacion` → `409 prerrequisitos` si bloquea; (3) recalcula con `parametros` (con el `hasta_periodo` explícito del cuerpo; si ese mes no está publicado, `409 hasta_periodo_sin_cargar` antes que cualquier otro 409; `hasta_fue_por_defecto = (hasta_periodo === hastaPorDefecto(hoy))`); (4) `huella_calculo` recalculada ≠ enviada → `409 datos_cambiados` ("Los datos cambiaron desde que abriste la agrupación: vuelve a cargar"); `version_vigente` ≠ versión de la vigente de hoy (o `null` con vigente, o número sin vigente) → `409 vigente_cambiada` ("Otra persona aprobó o retiró una curva de esta agrupación: vuelve a cargar"); (5) `motivoRechazoAprobar` (regla 26 ajustada: inactiva, `sin_curva_posible`, candidata sin curva, `sin_cambio` si la vigente tiene la misma `huella_calculo` y el mismo `modelo`, `nota_requerida` en los tres casos del punto 9 de "Decidido por Javier"); (6) inserta la **foto** en `corridas_estacionalidad` (`agrupacion_estacionalidad_id = id`, `referencia = false`, `resumen` completo según "Foto de aprobación"); (7) `filaCurva` (regla 27, sin cambios salvo `anios_utilizados` que añade `huella_calculo`, `huella_temporada`, `version_modelo`, `hasta_fue_por_defecto`, `recomendada_entonces`, `anios_ajuste`, `anios_excluidos`, `tiendas_excluidas`) con `corrida_id = foto.id`, transición `reemplazada` → `insert` como hoy (sin transacción, con la misma compensación); (8) `201 { curva, foto_id }`. Una foto sin curva (fallo en el paso 7) es basura inofensiva: no la referencia nadie y las versiones la ignoran. **El orden en que se evalúan los `409` es el de la tabla de rutas (y de la regla 41)**, no el de los pasos numerados: `hasta_periodo_sin_cargar`, `agrupacion_inactiva`, `prerrequisitos`, `sin_curva_posible`, `candidata_no_disponible`, `datos_cambiados`, `vigente_cambiada`, `sin_cambio`, `nota_requerida`.

### `GET /api/curvas` → `EstadoCurvasApi` v2

```jsonc
{ "data": {
  "datos": { "desde", "hasta", "meses_publicados", "faltantes", "ultimo_mes_cerrado" },
  "prerrequisitos_globales": [ { "codigo": "periodos_temporada_faltantes", "detalle": "No hay periodos atípicos para invierno (4 agrupaciones) ni verano (1)", "enlace": { "pantalla": "periodos" } } ],
  "agrupaciones": [ { "id", "nombre", "codigo", "activo", "temporada", "temporada_sugerida", "generos", "equivalencias_activas", "periodos_aplicables": 2,
                      "vigente": { "id", "version", "modelo", "origen", "recomendada", "recomendada_entonces", "eat", "aprobada_at", "usuario_nombre", "foto_id", "hasta_periodo", "hasta_fue_por_defecto", "version_modelo", "curva", "nota" } | null,
                      "obsoleta": { "motivos": [ … ] } | null,
                      "avisos_vigente": [ "datos_posteriores" | "modelo_anterior" | "temporada_recompuesta" ],
                      "estado": "sin_curva" | "al_dia" | "al_dia_distinta" | "obsoleta" | "inactiva_con_curva",
                      "bloqueada_por": [ "periodos_temporada_faltantes" ],          // prerrequisitos evaluables sin calcular
                      "versiones": 2 } ],
  "periodos_atipicos": [ … ],
  "resumen": { "agrupaciones_activas": 15, "por_temporada": { … }, "sin_revisar_toda_temporada": 10, "con_curva_vigente": 0, "sin_curva": 15, "obsoletas": 0,
               "al_dia_distintas": 0, "inactivas_con_curva": 0, "bloqueadas": 5, "bloqueadas_sin_curva": 5, "calculables_sin_curva": 10, "vigentes_prestadas": 0, "equivalencias_sin_agrupacion": 0 } } }
```

Lee: agrupaciones con datos (de ahí salen las `huella_temporada` de hoy por temporada, sin lectura extra), vigentes, periodos, cargas, tiendas, `venta_mensual_tienda()` (obsolescencia, como hoy), fotos de las vigentes (`leerCorridasPorIds` sin `resultado`), conteo de versiones y de equivalencias sin agrupación. **No llama a `venta_estacionalidad_agrupacion`**: la lista nunca calcula. `bloqueadas_sin_curva` cuenta las `sin_curva` con algún `bloqueada_por`; `calculables_sin_curva = sin_curva − bloqueadas_sin_curva`.

### Contratos de lógica pura (lo que `backend` escribe y `tests/curvas.*` prueban)

| Función | Archivo | Estado |
|---|---|---|
| `calcularCorrida`, candidatas, backtesting, `recomendar`, `efectoAtipicoCorrida`, `compararFormaAnio`, `redComparable`, `motivosObsoleta`, `evaluarObsolescencia`, `filaCurva`, `armarComparador`, huellas | `modelo.ts`, `candidatas.ts`, `backtesting.ts`, `efecto.ts`, `atipicos.ts`, `red.ts`, `obsolescencia.ts`, `reglas.ts`, `huellas.ts` | **sin cambios de fórmula** |
| `armarGrupoTemporada(t, miembros, ctx, agregada?: { serie, atipicos })` | `modelo.ts` | extensión: con `agregada` usa `serie` (temporada × tienda × mes de la función SQL) en vez de sumar `miembros` y **`atipicos = mesesAtipicos(periodos, { temporada: t })`** (los meses del Niño de esa temporada; sin esto `T` y el control tratarían 2023 como normal); sin `agregada`, como hoy (compatibilidad y tests existentes) |
| `calcularCorrida` recorre **todas las temporadas presentes en `series_temporada`**, no solo las de los miembros | `modelo.ts` | extensión: con una sola agrupación de invierno, `temporadas` trae también `todo_el_ano` (control del Niño) y, si hay datos, `verano`; sin esto el control, la pestaña Años Niño y `/anios?con_volumen=1` quedarían vacíos |
| `EntradaCorrida.series_temporada?: { temporada, por_tienda: { tienda_id, unidades: SerieAnual[] }[] }[]` | `modelo.ts` | tipo nuevo opcional |
| `VERSION_MODELO` | `modelo.ts` | constante nueva (`1`); entra en `huellaCalculo` y en la foto |
| `huellaTemporada(agrupaciones)` | `huellas.ts` | nueva: md5 de tríos ordenados `(id, temporada, composicion.huella)` de las activas de la temporada y de toda temporada |
| `motivosObsoleta` con `temporada_recompuesta` (prestada) / aviso (propia), `hasta_fue_por_defecto`, `modelo_anterior` | `obsolescencia.ts` | extensión; `EstadoGuardado` lee `temporada`, `atipicos`, `huella_temporada`, `hasta_periodo`, `hasta_fue_por_defecto`, `version_modelo` de `resumen` |
| `leerVentaAgrupacionCacheada(db, id, clave)` | `cache-venta.ts` | nueva: LRU en memoria, TTL 120 s, 20 entradas; clave `id | cargas_huella | composicion.huella | huella_temporada` |
| `candidatas[].pruebas` y `comparador.comparable_con_vigente` | `backtesting.ts`, `reglas.ts` | extensión: número de pliegues; `true` si el conjunto de años de ajuste coincide con `anios_ajuste` de la foto vigente |
| `redComparable(…, parametros)` con `tiendas_excluidas` | `red.ts` | extensión: motivo `excluida_manual`, evaluado antes de la condición 1 |
| `anios_excluidos` en `analizarAgrupacion` | `modelo.ts` | extensión: `tratamiento = 'descartado'`, `tratamiento_motivo = 'excluido_manual'`, `en_ajuste = false`, aviso `anio_excluido` |
| `armarEntradaAgrupacion(datos, parametros)` | `entrada.ts` | nueva: a partir de `{ agrupacion, temporadas, meses_publicados }` de la función SQL; `ventaPorTienda` suma `temporadas` (incluida `sin_agrupacion`) |
| `leerVentaEstacionalidad(json)` | `agregado.ts` | nueva (misma validación que `leerAgregado`, forma nueva) |
| `prerrequisitosAgrupacion(entrada)` | `prerrequisitos.ts` | nueva |
| `ruidoNormalAgrupacion(anios)` → `ruido_normal`, `ruido_normal_detalle` en `AgrupacionResultado` (Q2) | `modelo.ts` (usa `ruidoNormal` de `atipicos.ts`) | extensión |
| `EstadoGuardado.hasta_periodo`, aviso `datos_posteriores`, `EstadoActual.hasta_por_defecto` (Q3) | `obsolescencia.ts` | corrección de regla |
| `serieDeAnio`, `celdaAnioMes` con `participacion_real ?? participacion` (Q1) | `series.ts`, `vista.ts` | corrección |
| `huellaCalculo(partes)` | `huellas.ts` | nueva |
| `estadoDeAgrupacion(vigente, obsoleta, activo)` y `armarEstadoCurvas` v2 | `estado.ts` | ajustadas (sin corrida) |
| `motivoRechazoAprobar(agrupacion, calculo, modelo, vigente, version_vigente, parametros, nota)` | `reglas.ts` | sustituye a `motivoRechazoElegir`; incluye `sin_curva_posible`, `vigente_cambiada` y la nota en tres casos |
| `resolverCorrida`, `corridaDeReferencia`, `planificarReferencia`, `marcarReferencia`, `quitarReferencia`, `refrescarYLeerAgregado` | `lectura.ts`, `reglas.ts`, `consultas.ts` | **se borran** (y sus tests); `leerCorridaPorId` **se queda** (lo usa "Ver foto") |

## Pantallas

Ruta `/planificacion/curvas-estacionalidad` (menú Planificación; admin y planner; el comprador no la ve y la página redirige a `/`). La agrupación abierta vive en la URL (`?agrupacion=<id>&modelo=A`, Q5): recargar reabre la misma vista con los mismos parámetros iniciales. `curvas-panel.tsx` conserva el `Tabs` con tres pestañas: **Agrupaciones · Años Niño · Periodos atípicos**. Se reutilizan `useColeccion` / `useRecurso`, el kit de UI (`Card`, `DataTable`, `Chips`, `Badge`, `Alert`, `EmptyState`, `Modal`), `BadgeAgrupacion` con los colores de M3, `BadgeTemporada`, `GraficoCurvas`, `MiniCurva`, `series.ts`, `CandidatasTabla`, `ComparadorCurvas`, `TablaAnioMes`, `EfectoNinoDetalle`, `RedComparable` y `parametros-form.ts` (que pasa a alimentar el panel por agrupación).

### Pestaña Agrupaciones (lista)

```
Curvas de estacionalidad                                                     [Descargar curvas vigentes (CSV)]
La curva mensual de cada agrupación sale de la venta real... Trabaja las agrupaciones una por una.

┌ Resumen ────────────────────────────────────────────────────────────────────────────────────────────┐
│ 15 agrupaciones activas · 3 con curva al día · 1 aprobada distinta de la recomendada · 2 obsoletas   │
│ · 9 sin curva · 10 siguen en Toda temporada (revísalas)                                              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
⚠ Antes de calcular (global)
  • No hay periodos atípicos para invierno (4 agrupaciones) ni verano (1): no se pueden calcular → Periodos atípicos
  • 1 tienda con venta sin fecha de apertura → Tiendas
  • 2 equivalencias activas sin agrupación → Faltantes de M3

Filtros: Temporada [Todas 15 | Invierno 4 | Verano 1 | Toda temporada 10]  Estado [Todas | Sin curva 9 | Obsoletas 2 | Distintas 1 | Al día 3 | Bloqueadas 5]
         Género [▾]  Buscar [__________]                                                                  [▸ Red comparable por año]

┌─────────────────────┬────────────┬──────────────────────────────┬──────────────────────────────┬───────────┬──────────┬───────────┐
│ Agrupación          │ Temporada  │ Curva aprobada               │ Estado                       │ Sistema   │ Mini     │ Acciones  │
│                     │            │                              │                              │ hoy       │ curva    │           │
├─────────────────────┼────────────┼──────────────────────────────┼──────────────────────────────┼───────────┼──────────┼───────────┤
│ ● HO INVIERNO  H    │ Invierno ▾ │ v2 · A Promedio simple       │ ● Al día                     │ = (A)     │ ∿        │ Trabajar  │
│                     │            │ EAT 29.1 · Javier · 15/10    │                              │           │          │ Retirar   │
│ ● MU VERANO    M    │ Verano ▾   │ v1 · B Ponderado por volumen │ ● Al día · distinta de la    │ A (vs B)  │ ∿        │ Trabajar  │
│                     │            │ nota: "2025 tuvo..."         │   recomendada (A)            │           │          │           │
│ ● INF INVIERNO I    │ Invierno ▾ │ v1 · A                       │ ▲ Obsoleta: la tienda T10    │ Comparar  │ ∿        │ Trabajar  │
│                     │            │                              │   entra en la red de 2026;   │ → A,      │          │           │
│                     │            │                              │   mes publicado después:     │ difiere   │          │           │
│                     │            │                              │   2026-09                    │ 4.1 pp    │          │           │
│ ● ACC CASUAL   H M  │ Toda temp ▾│ Sin curva                    │ ○ Sin curva                  │ —         │          │ Trabajar  │
│ ● NIÑOS INV    I    │ Invierno ▾ │ Sin curva                    │ ⊘ Bloqueada: sin periodos    │ —         │          │ Trabajar  │
│                     │            │                              │   para invierno              │           │          │           │
└─────────────────────┴────────────┴──────────────────────────────┴──────────────────────────────┴───────────┴──────────┴───────────┘
Inactivas con curva (1) al final, atenuadas.
```

- **Sistema hoy**: "= (A)" cuando `al_dia` (determinismo: sin calcular); "A (vs B)" cuando `al_dia_distinta` (de la foto); "Comparar" cuando `obsoleta` o `sin_curva`; tras pulsar Comparar (por fila), la celda muestra la candidata recomendada hoy, la EAT frente a la vigente y "difiere N pp" (o "sin vigente"); se puede cancelar. Los resultados no se guardan. El botón en bloque "Comparar las obsoletas" es de la segunda entrega.
- Junto al estado, los avisos de la vigente como iconos con `title`: "datos posteriores (2026-09)", "calculada con un modelo anterior", "la temporada cambió de composición" (curva propia).
- La temporada se cambia en M3 o en la cabecera de la vista de la agrupación (mismo `PATCH` de M3): cambiarla marca la curva `obsoleta` (`temporada_cambiada`) y las prestadas de su temporada anterior y nueva (`temporada_recompuesta`). La edición en línea en la lista es de la segunda entrega.
- **Red comparable por año** (plegable, `RedPanel` con `GET /api/curvas/red-comparable` y los parámetros por defecto): tabla tiendas × años, pesos siempre visibles, Dominante, Distinta, motivos legibles. Es la red "de la casa"; cada agrupación la ve con sus pesos propios en su vista. **`red-panel.tsx` hoy lee `GET /api/curvas/corridas/[id]` y depende de la tarjeta Calcular**: pasa a leer solo `GET /api/curvas/red-comparable` (ruta que se conserva) y deja de recibir `corridaId`.
- No hay tarjeta Calcular, selector de corridas, "Marcar como referencia" ni selección múltiple.

### Vista de una agrupación ("Trabajar")

```
← Agrupaciones        ● HO INVIERNO   H   Temporada [Invierno ▾]   140 equivalencias · Red: 8 · 9 · 9 · 10 tiendas · Calculado en 1.8 s (datos hasta 2026-09 · la vigente usó hasta 2026-08)

┌ Antes de calcular ───────────────────────────────────────────────────────────────────────────────────┐
│ ✔ Temporada invierno · ✔ 2 periodos del Niño aplican (2023 completo, 2026 en curso) · ✔ 45 meses sin huecos│
│ ⚠ Pocos años normales: 2 (2024, 2025) · ⚠ Tienda T10 pesa 22 % en 2026 y se aparta 14 pp de la red    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
(si bloquea, en su lugar:)
┌ No se puede calcular todavía ────────────────────────────────────────────────────────────────────────┐
│ ✖ No hay periodos atípicos para invierno. Crea los periodos del Niño 2023 y 2026 → Periodos atípicos  │
│   [ ] Confirmo que esta temporada no tiene años atípicos (se guardará con la curva)                   │
│ ✖ La tienda T04 tiene venta y no tiene fecha de apertura → Tiendas                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌ Curvas de la agrupación ─────────────────────────── [Participación | Unidades]  [Mostrar: ☑2023 ☑2024 ☑2025 ☑2026 ☐T ☑banda] ┐
│ 25 %┤                                        ━━━ Propuesta (A)      ─── Aprobada v2 (A)                                     │
│     │                    ╭──╮                ─── 2024   ─── 2025    ┄┄┄ 2023 (Niño completo, incluido)   ╌╌╌ 2026 parcial ene–set │
│ 15 %┤               ╭────╯  ╰───╮            ░░░ banda mín–máx      ▌ meses atípicos    • liquidación                        │
│     │          ╭────╯           ╰────╮                                                                                        │
│  5 %┤ ─────────╯                     ╰───────────                                                                             │
│     └──┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬───┬─                                                                         │
│       Ene Feb Mar Abr May Jun Jul Ago Set Oct Nov Dic                 (lectura por mes al pasar el cursor)                    │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
┌ Tabla año × mes ─────────────────────────────────────────────────────────────────────────────────────── [CSV] ┐
│ Año / fila            Ene   Feb   Mar   Abr   May   Jun   Jul   Ago   Set   Oct   Nov   Dic   Total  Tiendas  Clase          │
│ 2023 Niño · incluido  2.1   2.0   6.2  12.4  19.8  23.9  16.1   8.0   4.1   2.0   2.1   1.3   2 980   8      atípico completo│
│ 2024 normal           2.0   2.0   6.0  12.0  20.0  24.0  16.0   8.0   4.0   2.0   2.0   2.0   4 730   9      normal          │
│ 2025 normal           1.9   2.1   6.1  11.8  20.3  23.7  16.2   8.1   3.9   2.0   2.0   1.9   5 680   9      normal          │
│ 2026 parcial (Niño)   2.4   2.2   6.6  12.9  21.0  24.1  15.8   8.4   6.6    —     —     —    3 040  10      en curso        │
│ ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│
│ Propuesta A           2.0   2.0   6.1  12.1  20.0  23.9  16.1   8.0   4.0   2.0   2.0   1.7   100 %                            │
│ Aprobada v2 (A)       2.0   2.0   6.0  12.0  20.0  24.0  16.0   8.0   4.0   2.0   2.0   2.0   100 %                            │
│ Diferencia (pp)      +0.0  +0.0  +0.1  +0.1  +0.0  −0.1  +0.1  +0.0  +0.0  +0.0  +0.0  −0.3   EAT 0.8                          │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌ Lo que propone el sistema ──────────────────────────────────┐ ┌ Efecto del Niño en esta agrupación ─────────────────────────┐
│ Propone A · Promedio simple de 2023, 2024 y 2025.           │ │ Volumen (tiendas comunes, frente al año normal más cercano) │
│ 2023 (Niño, año completo) entra tal cual: su forma difiere  │ │   2023 ×0.63 frente a 2024 (7 tiendas) · 2026 ene–set ×0.66 │
│ 31 pp de la referencia y los dos años normales difieren     │ │   frente a 2025 (9 tiendas)                                 │
│ 33 pp entre sí: estable respecto al ruido.                  │ │ Forma: 2023 difiere 31 pp · ruido 33 · umbral 33 → Estable  │
│ B se equivoca 27.4 pp frente a 29.1 de A en 3 pruebas; la   │ │   pico junio (= referencia) · 2026 parcial: 12.1 pp (red    │
│ diferencia (1.7) es menor que el margen (0.25 × 33 ≈ 8.3):  │ │   completa) / 9.4 pp (tiendas comunes con 2025)             │
│ para apartarse del promedio.                                │ │ El factor que recibirá M7 es el de la temporada → Años Niño │
│                                                             │ └─────────────────────────────────────────────────────────────┘
│ ( ) A Promedio simple     EAT 29.1 · 3 pruebas · ruido 33 ▸ ★│
│ ( ) B Ponderado volumen   EAT 27.4 · 3 pruebas  la mayor 38 %│
│ ( ) C Ponderado recencia  EAT 28.0 · 3 pruebas              │
│ ( ) D Suavizada           EAT 30.2 · 3 pruebas              │
│ ( ) E Promedio de tiendas EAT 31.5 · 3 pruebas              │
│ ( ) T Curva de la temporada (referencia, prestada)          │
│ Estabilidad: Media (0.71) · Ruido entre años normales: 33 pp│
│ (2024 frente a 2025; se muestra aunque no haya Niño)        │
└─────────────────────────────────────────────────────────────┘

┌ Parámetros de esta agrupación ───────────────────────────── [▸ plegado: "3 distintos del valor por defecto" · Restablecer] ┐
│ Años          [☑ 2023 Niño completo · incluido (auto)] [☑ 2024] [☑ 2025] [2026 parcial: solo valida]   Excluir del ajuste: ☐ ☐ ☐ │
│ Niño          Tratamiento (auto ▾)                                                                                            │
│ Red           Tiendas: T01 ☑ · T02 ☑ · … · T10 ☑ (entra en 2026, 22 %) · T04 (fuera 2023: no abierta todo el año)   Excluir ☐ │
│ Datos         Calcular hasta [2026-09 ▾]  (arranca siempre en el último mes cerrado; la vigente usó 2026-08)                   │
│ Umbrales      con los valores por defecto (piso 3 pp · margen 0.25 · dominante 35 % · …) — edición en la segunda entrega      │
│ ⓘ Excluir un año o una tienda, o un tratamiento distinto de auto, piden el motivo en "Nota / motivo" antes de aprobar          │
└───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

┌ Aprobada frente a propuesta ────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Vigente v2 · A · aprobada el 15/10 por Javier con datos hasta 2026-08 · ▲ Obsoleta: mes publicado después y cerrado: 2026-09 │
│ EAT entre ambas: 0.8 pp · el mes que más cambia: diciembre (−0.3) · ⚠ EAT no comparable: la vigente ajustó con 2024 y 2025    │
│ Nota / motivo [______________________________________]  (obligatoria si eliges otra candidata, excluyes años o tiendas,       │
│                                                         o el tratamiento no es auto)                                          │
│                                                                                  [Aprobar esta curva (A) como versión 3]      │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

▸ Red comparable de esta agrupación (pesos sobre la venta de la agrupación; perfil de cada tienda frente a la agrupación; Distinta)
▸ Versiones (3): v3 vigente · A · hoy · Javier    v2 reemplazada · A · 15/10 · Javier · [Ver foto]    v1 reemplazada · B · 14/10 · nota: "…" · [Ver foto]    [Retirar la vigente]
```

Comportamiento: el `radio` de candidatas cambia la serie "Propuesta" del gráfico, la fila de la tabla y el comparador (sin llamar al servidor: todas las candidatas vienen en `resultado`); cualquier cambio en Parámetros vuelve a pedir `calcular` (debounce 300 ms, `signal` para cancelar) y muestra "Recalculando…" sin vaciar el gráfico; el botón Aprobar queda deshabilitado mientras recalcula, si bloquea algún prerrequisito, si la agrupación está inactiva o si la candidata elegida no tiene curva. "Ver foto" abre `GET /api/curvas/corridas/[foto]/agrupaciones/[id]` en un `Modal` de solo lectura con la cabecera "Foto del 15/10/2026 10:42 · datos hasta 2026-08 · modelo v1 · parámetros de ese momento"; su comparador es contra la curva de **esa** foto (diferencia 0.0 por construcción salvo que se aprobara otra candidata) y no muestra obsolescencia. Si la versión abierta tiene `version_modelo < VERSION_MODELO`, la cabecera añade "calculada con un modelo anterior".

### Pestaña Años Niño (vista de apoyo)

Como en la 06 pero sin corrida: botón **Calcular efecto por temporada** (o automático al entrar, con "Calculando…") que llama a `GET /api/curvas/anios-atipicos`; cabecera "Calculado ahora con los datos hasta 2026-09 · con los parámetros por defecto (no con los de cada curva aprobada)"; bloques Volumen (tabla de ratios con control y relativo, lectura generada), Forma (por agrupación: requiere abrir cada una; aquí se muestra solo lo agregado por temporada que la función devuelve: `forma` con conteos no está disponible sin calcular cada agrupación, así que el bloque Forma lista las agrupaciones de la temporada con "Ver" → Trabajar), **Lo que recibirá M7** (factor por temporada y año con "N agrupaciones", crecimiento normal, CSV, nota "calculado a demanda; M7 guarda el valor que use y puede editarlo") y avisos. Sin "Marcar como referencia".

### Pestaña Periodos atípicos

Sin cambios de fondo. El pie dice: "Cambiar un periodo no recalcula nada: las curvas aprobadas afectadas se marcan obsoletas (`periodo_cambiado`) y las agrupaciones de invierno y verano no se pueden calcular sin al menos un periodo para su temporada (o la confirmación explícita)". La tarjeta "Años marcados como atípicos" deja de mostrar `ratio_volumen` (es de la pestaña Años Niño).

## Reglas de negocio

Se mantienen las reglas 1 a 29 de la 06 salvo donde se indica; las nuevas continúan la numeración. Todas con vitest sobre fixtures sintéticos salvo la 30 (SQL de humo) y 31 (estático).

**`prerrequisitos.ts`**

32. `prerrequisitosAgrupacion`: con el fixture base y sin periodos, ABRIGO (invierno) → `bloquea: [periodos_temporada_faltantes]`; con `sin_periodos_confirmado = true` → pasa a `avisa`; PEQUEÑA (`todo_el_ano`) sin periodos → no bloquea; una tienda `Tienda` activa con venta y `fecha_apertura = null` → `tienda_sin_apertura` bloquea (una tienda sin venta y sin apertura no bloquea); sin ningún año con 12 meses publicados → `sin_anio_completo`; agrupación con 0 unidades positivas → `sin_venta`; 0 equivalencias → `composicion_vacia`; `todo_el_ano` sin versiones → `avisa: temporada_sin_confirmar`; con una versión aprobada, no; huecos en la serie → `meses_sin_cargar` con la lista; cada código se prueba por separado y el orden de `bloquea` es estable.
33. Los prerrequisitos globales de `GET /api/curvas` son la unión de los que no dependen de la agrupación (`armarPrerrequisitosGlobales`), y `bloqueada_por` de cada fila solo contiene los evaluables sin venta (`periodos_temporada_faltantes`, `composicion_vacia`, `tienda_sin_apertura`).

**`huellas.ts`**

34. `huellaCalculo` cambia si cambia cualquiera de: `VERSION_MODELO`, un `carga_id`, el maestro de tiendas (fecha, activo, tipo), la composición, la temporada, `huella_temporada`, `hasta_periodo`, un periodo aplicable (rango o alta/baja), cualquier parámetro (incluidos `anios_excluidos` y `tiendas_excluidas`, insensibles al orden); no cambia si cambia el nombre de una tienda o un periodo que no aplica a la temporada.
34b. `huellaTemporada`: insensible al orden de entrada; cambia si una agrupación activa de la temporada o de toda temporada cambia de composición o de temporada, si se activa o desactiva una, o si una de otra temporada pasa a esta; no cambia por una agrupación de otra temporada (ni por su composición) ni por el nombre.

**`entrada.ts` y `modelo.ts`**

35. `armarEntradaAgrupacion`: con la forma `{ agrupacion, temporadas, meses_publicados }` del fixture, la venta total por tienda es la suma de `temporadas` (incluida `sin_agrupacion`), la red comparable coincide con la que daba `armarEntradaCorrida` sobre el agregado completo (mismo fixture, misma red: 2023 → T1; 2024 → T1, T4; 2025 → T1, T2, T4; 2026 → T1, T2, T3, T4), y `series_temporada` lleva una entrada por temporada presente.
36. `calcularCorrida` con una sola agrupación y `series_temporada`: la `curva_T` de su temporada es la de la serie agregada (con ABRIGO y una segunda agrupación de invierno en la serie agregada 1:3, `T` está más cerca de la grande, como la regla 11b) y **no** la `A` de la agrupación; el grupo de temporada recibe `atipicos = mesesAtipicos(periodos, { temporada })`, así que 2023 sale atípico en `T` y en el ratio de volumen de invierno (y normal en el control `todo_el_ano`); `temporadas` del resultado lleva **todas** las presentes en `series_temporada` (con ABRIGO sola, también `todo_el_ano` y `verano`), de modo que el control del Niño y `/anios?con_volumen=1` no quedan vacíos; sin `series_temporada` el comportamiento es el de hoy (los tests de la 06 siguen pasando sin cambios).
37. `anios_excluidos = [2024]`: 2024 sale `tratamiento = 'descartado'`, `tratamiento_motivo = 'excluido_manual'`, `en_ajuste = false`, aviso `anio_excluido`; las candidatas se ajustan sin él; su `ratio_volumen` (si era atípico) se sigue midiendo; excluir todos los años de ajuste → `pocos_anos_ajuste` y `T`.
38. `tiendas_excluidas = [T1]`: T1 `entra = false` con motivo `excluida_manual` en todos los años, antes de evaluar fechas y datos; los pesos se reparten entre las demás; `huellaRed` no cambia (la exclusión es parámetro, no maestro).
39. Determinismo con huella: dos llamadas con la misma `huella_calculo` dan `resultado` idéntico (JSON igual); cambiar una unidad en un mes publicado cambia la huella.

**`estado.ts` y `reglas.ts`**

40. `estadoDeAgrupacion`: sin vigente → `sin_curva`; vigente con motivos → `obsoleta`; vigente sin motivos y `recomendada` → `al_dia`; vigente sin motivos y `recomendada = false` → `al_dia_distinta`; inactiva con vigente → `inactiva_con_curva` (gana a los demás). `resumen.sin_curva + con_curva_vigente = agrupaciones_activas`.
41. `motivoRechazoAprobar`, en este orden (precedido en el handler por `hasta_periodo_sin_cargar` si el `hasta_periodo` no está publicado): inactiva → `409 agrupacion_inactiva`; algún `bloquea` → `409 prerrequisitos` (con la lista); `origen = null` → `409 sin_curva_posible`; candidata sin curva o `T` sin `curva_T` → `409 candidata_no_disponible`; `huella_calculo` enviada ≠ recalculada → `409 datos_cambiados`; `version_vigente` ≠ la vigente de hoy (incluido `null` con vigente y número sin vigente) → `409 vigente_cambiada`; vigente con el mismo `modelo` y la misma `huella_calculo` → `409 sin_cambio`; nota vacía con `modelo ≠ recomendada`, o `anios_excluidos` o `tiendas_excluidas` no vacíos, o `tratamiento_atipicos ≠ 'auto'` → `409 nota_requerida` (el mensaje dice cuál de los tres); si no, `null`.
42. `filaCurva`: `anios_utilizados` lleva además `huella_calculo`, `huella_temporada`, `version_modelo`, `hasta_fue_por_defecto`, `recomendada_entonces`, `anios_ajuste`, `anios_excluidos`, `tiendas_excluidas` y `sin_periodos_confirmado`; `corrida_id` es el id de la foto; `version = anterior + 1`; `huellasDeCurva` sigue devolviendo las tres huellas (contrato de M7 intacto).
43. `versionesDeAgrupacion(filas)`: ordenadas por `version desc`; a lo sumo una `vigente`; `foto_id = corrida_id`; `parametros_resumen` lista solo los parámetros distintos del valor por defecto.

**`esquemas.ts`**

44. `calcularAgrupacionSchema` aplica los defectos de la 06, rechaza `marcar_referencia` (clave desconocida según la convención de `leerCuerpo`), acepta `anios_excluidos` (enteros 2000–2100, ≤ 20) y `tiendas_excluidas` (uuid, ≤ 100); `aprobarCurvaSchema` exige `huella_calculo` de 32 hex y `parametros` completos; **no existen** `elegirCurvaSchema`, `marcarReferenciaSchema` ni `aprobarSchema` (estático).

**Hallazgos de QA (Q1, Q2, Q3, Q6)**

47. `serieDeAnio` y `celdaAnioMes`: un año `descartado` (por tratamiento o `excluido_manual`) con `participacion_real` produce serie y celdas (gris, **`porDefecto = true`**: decisión del dueño "todos los años visibles", se apagan a mano con las casillas); un año `imputado` dibuja `participacion` con los meses imputados punteados y la tabla muestra la real en `title`; un año `sin_red_comparable`, sin volumen o **`incompleto`** (año pasado con meses sin cargar: `participacion_real = null` porque no hay año entero que repartir) devuelve `null` y la tabla lo lista con "—" y el motivo ("meses sin cargar: 2024-05"); solo el año en curso se dibuja parcial (`participacion_parcial`); con el fixture "forma corrida" (2023 descartado) el gráfico tiene cuatro series, no tres.
48. `ruidoNormalAgrupacion(anios)`: EAT entre las participaciones reales de los años `normal` completos, no escasos y **no excluidos a mano** (un año en `anios_excluidos` sale del ruido igual que sale del ajuste y de la referencia de forma); es el mismo valor que `prep.ruido`, que ya se calcula siempre: solo se expone; `null` con menos de dos; con tres o más, promedio de los pares y `ruido_normal_detalle = [{ anios: [2024, 2025], eat }]`; PEQUEÑA (`todo_el_ano`, sin periodos) con 2024 y 2025 normales tiene `ruido_normal` no nulo aunque `efecto_atipico.forma` sea `null`; en ABRIGO coincide con `efecto_atipico.forma.ruido_normal`; `recomendar` recibe este valor (el margen de empate ya no depende de que exista un periodo); `textoConfirmarAprobacion` dice "no medible" solo cuando es `null`.
49. `motivosObsoleta` con `hasta_periodo`: `carga_nueva` solo considera meses `≤ guardado.hasta_periodo` (nuevo campo de `EstadoGuardado`); un mes publicado posterior produce `datos_posteriores` (aviso, no motivo) salvo que `guardado.hasta_fue_por_defecto = true` **y** `actual.hasta_por_defecto > guardado.hasta_periodo`, en cuyo caso sí es `carga_nueva` ("mes publicado después y ya cerrado: 2026-09"); con `hasta_fue_por_defecto = false` es siempre `datos_posteriores`; recalcular con el `hasta` nuevo y aprobar deja `motivos = []`; republicar un mes `≤ hasta` con otro `carga_id` sigue siendo `carga_nueva`.
50. `sin_venta` y prestadas: `prerrequisitosAgrupacion` bloquea `sin_venta` cuando la venta cruda de la agrupación (antes de la red) no tiene ningún mes publicado con unidades positivas (misma definición que `conVenta` del modelo y que `vigentes_prestadas` de la lista); con venta y `origen = 'prestada'` la aprobación de `T` está permitida y la fila cuenta en `con_curva_vigente` y `vigentes_prestadas`; con `origen = null` (ni propias ni `T`) `motivoRechazoAprobar` devuelve `409 sin_curva_posible`; el resumen cumple `activas = al_dia + al_dia_distintas + obsoletas + sin_curva` y `sin_curva = bloqueadas + calculables_sin_curva`.

**Hallazgos del `arquitecto-revisor` (2026-10-15)**

51. `temporada_recompuesta`: con la foto de una curva **prestada** (`origen = 'prestada'`) y una segunda agrupación de invierno que cambia su composición (o su temporada, o se desactiva), `motivosObsoleta` devuelve `temporada_recompuesta` con el detalle ("cambió la composición de INVIERNO 2"); con la misma situación y una curva **propia**, `motivos = []` y el aviso `temporada_recompuesta`; cambiar una agrupación de verano no afecta a la prestada de invierno; el control de toda temporada sí cuenta (una agrupación de toda temporada movida cambia la huella de todas las temporadas).
52. **Foto suficiente**: `evaluarObsolescencia` y `estadoDeAgrupacion` funcionan con una foto leída **sin `resultado`** (`parametros`, `red_comparable`, `resumen`); el test construye la foto con `resumen` completo y `resultado = undefined` y obtiene los mismos motivos que con la foto entera; `resumen.atipicos` y `resumen.temporada` son los que compara `periodo_cambiado` / `temporada_cambiada` (ya no se buscan en `anios_utilizados`).
53. **`hasta_periodo` nunca se hereda**: `parametrosIniciales(foto, hoy)` copia todos los parámetros de la foto salvo `hasta_periodo`, que es `hastaPorDefecto(hoy)`; el `PUT` sin `hasta_periodo` → `400`; con un `hasta_periodo` que no coincide con el que `calcular` devolvió la huella difiere → `409 datos_cambiados`; `hasta_fue_por_defecto` es `true` solo si el `hasta` aprobado es `hastaPorDefecto(hoy)`.
54. **`version_vigente`**: `PUT` con `version_vigente = 1` cuando la vigente es v2 → `409 vigente_cambiada`; con `null` y vigente → `409 vigente_cambiada`; con `2` y vigente v2 → sigue; sin vigente y `version_vigente = null` → sigue; sin vigente y `1` → `409 vigente_cambiada`.
55. **`VERSION_MODELO`**: entra en `huellaCalculo` (cambiarla cambia la huella con la misma entrada) y en `resumen.version_modelo`; una foto con `version_modelo = VERSION_MODELO − 1` produce el aviso `modelo_anterior` y **no** `obsoleta`; `GET /api/curvas` lo devuelve en `avisos_vigente`.
56. **Pruebas y comparabilidad**: cada candidata lleva `pruebas` igual al número de pliegues del backtesting (3 con 2023–2025 en ajuste; 2 con 2024–2025; `0` y `eat = null` con un solo año); `comparable_con_vigente = true` si el conjunto de años en ajuste coincide con `anios_ajuste` de la foto vigente, `false` si no (y la vista muestra el aviso), `null` sin vigente.
57. **Nota en tres casos**: `anios_excluidos = [2023]` sin nota → `409 nota_requerida` aunque el modelo sea la recomendada; `tratamiento_atipicos = 'descartar'` sin nota → `409 nota_requerida`; `tiendas_excluidas = [T3]` sin nota → `409 nota_requerida`; con nota en cualquiera → `201` y la nota queda en la versión.
58. **Caché**: `leerVentaAgrupacionCacheada` con la misma clave no vuelve a llamar a la función (espía: una llamada en dos lecturas); cambiar cualquiera de las tres huellas de la clave la vuelve a llamar; pasada la TTL también; nunca devuelve una entrada con otra clave.
59. **`/anios` con `agrupacion_id`**: el handler pasa el id a `venta_estacionalidad_agrupacion` (espía) y el diagnóstico de la agrupación sale de `agrupacion`, no de ninguna corrida; la respuesta lleva `huella_cargas` igual a `cargas_huella` de `calcular` sobre el mismo estado y el aviso `parametros_por_defecto`.

**SQL y estático**

45. **SQL (humo local)**: la `0017` aplica dos veces sin error y sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`; `venta_estacionalidad_agrupacion(null)` devuelve `agrupacion = null`, `cargas` con una entrada por mes publicado (mismo contenido que `leerCargasPublicadas`), `meses_publicados = keys(cargas)` ordenado, y `temporadas` cuya suma por tienda y mes coincide con `venta_mensual_tienda()` y cuya suma por mes coincide con `unidades_mensuales()`; con un id, `agrupacion` suma lo mismo que `unidades_mensuales(sus equivalencias)` por mes; las equivalencias sin agrupación o con agrupación inactiva salen como `sin_agrupacion`; `anon` y `authenticated` no pueden ejecutarla; `corridas_estacionalidad.agrupacion_estacionalidad_id` admite nulo, rechaza un id inexistente y bloquea el borrado de la agrupación (`restrict`); se anota de nuevo la **duración** de la función con y sin id sobre la base real (medida: 0.6 a 1.5 s; objetivo < 2 s).
46. **Estático**: no existen `src/app/api/curvas/calcular`, `src/app/api/curvas/corridas/route.ts` ni `src/app/api/curvas/corridas/[id]/route.ts`; existen `…/agrupaciones/[id]/calcular/route.ts` y `…/agrupaciones/[id]/versiones/route.ts`; solo `consultas.ts` nombra `venta_estacionalidad_agrupacion`; **ningún archivo de `src/` nombra** `venta_mensual_estacionalidad`, `refrescar_venta_mensual_estacionalidad`, `refrescar_y_leer_agregado_estacionalidad`, `resolverCorrida` ni `referencia` de corridas; ningún componente nombra `/api/curvas/corridas/` salvo seguido de `/agrupaciones/` ("Ver foto"); `red-panel.tsx` no recibe `corridaId`; `VERSION_MODELO` aparece en `huellas.ts` y en el `resumen` de la foto; `prerrequisitos.ts`, `modelo.ts`, `red.ts`, `huellas.ts`, `cache-venta.ts` y `obsolescencia.ts` no importan de `@supabase/*` ni de React; toda ruta de M6 usa `requirePlanner`; la `0017` no contiene `drop`, `delete`, `truncate` ni `update` fuera de comentarios.

## Casos de prueba sintéticos

Mismo fixture `tests/curvas.fixture.ts` de la 06 (ABRIGO SINTÉTICO de invierno, VERANO SINTÉTICO, PEQUEÑA de toda temporada; tiendas T1 a T4 y CD; los cuatro periodos confirmados), reescrito en la forma `{ agrupacion, temporadas, meses_publicados }` con una función `fixtureVentaEstacionalidad(agrupacionId)` que la deriva de las series existentes (así los casos 1 a 12 de la 06 se reejecutan por agrupación con los mismos resultados esperados: participación 2024 de ABRIGO, red por año, volumen 0.65, forma estable/corrida, verano imputado, recomendación relativa, obsolescencia a–f, determinismo). Casos nuevos:

13. **Prerrequisitos**: fixture sin periodos → ABRIGO bloqueada (`periodos_temporada_faltantes`), PEQUEÑA no; con la casilla de confirmación, ABRIGO calcula y 2023 sale `normal` (sin atípicos) con el aviso en `avisa`; T4 con `fecha_apertura = null` y venta → bloquea las tres agrupaciones con enlace a Tiendas; quitar 2024-05 de los publicados → `meses_sin_cargar` avisa, 2024 `incompleto`, y con 2023 también incompleto y 2025 normal → sigue calculando (un año completo basta para no bloquear) pero `pocos_anos_ajuste` y `T`.
14. **Tres curvas en la vista**: ABRIGO con vigente v1 = `A` del fixture base: `calcular` devuelve `vigente.curva`, `resultado.anios[].participacion_real` (4 años) y `comparador` con `eat_vs_vigente = 0` y `difiere = false`; pedir `?modelo=B` cambia el comparador a `B` sin cambiar `resultado`.
15. **Parámetros que recalculan**: con `tiendas_excluidas = [T3]`, la red de 2026 pasa a T1, T2, T4 y la forma parcial de 2026 (red completa) se acerca a la de tiendas comunes; con `anios_excluidos = [2023]` sobre el fixture base, las candidatas coinciden con las de `tratamiento_atipicos = 'descartar'`; con `meses_tienda_nueva = 12`, T3 `tienda_nueva` en 2026.
16. **Aprobar con huella**: `calcular` → `huella_calculo = h`; `PUT` con `h` y `modelo = A` → `201`, foto con `agrupacion_estacionalidad_id`, curva v1 con `corrida_id = foto.id`; publicar un mes en el fixture y repetir el `PUT` con `h` → `409 datos_cambiados`; `PUT` de `B` sin nota → `409 nota_requerida`; con nota → v2 `recomendada = false`; `PUT` de `A` con la misma huella que la v1 (fixture sin cambios) → `409 sin_cambio`.
17. **Estados de la lista**: tras 16, ABRIGO `al_dia`; tras aprobar `B` con nota, `al_dia_distinta` con `recomendada_entonces = "A"`; tras publicar un mes, `obsoleta` (`carga_nueva`); PEQUEÑA sin curva, `sin_curva`; desactivar ABRIGO → `inactiva_con_curva`; sin periodos en el fixture, ABRIGO y VERANO `bloqueada_por: ["periodos_temporada_faltantes"]` y PEQUEÑA `[]`.
18. **Versiones y foto**: `versiones` de ABRIGO lista v2 vigente, v1 reemplazada con sus `foto_id`; `GET /api/curvas/corridas/[foto v1]/agrupaciones/[ABRIGO]` devuelve el resultado congelado (los años de entonces) aunque el fixture tenga ya un mes más; con el id de otra agrupación → `404`.
19. **Años Niño a demanda**: `anios-atipicos` sobre el fixture con las tres agrupaciones reproduce `por_temporada[2023, invierno] = 0.65 / control 1 / relativo 0.65` y `verano 1.46` (caso 1f de la 06) sin ninguna corrida en la base; `/anios?temporada=invierno&con_volumen=1` devuelve `ratio_volumen` y `corrida_id: null`; sin `con_volumen`, `ratio_volumen: null` y no llama a la función de venta (espía).
20. **Determinismo y rendimiento**: diez llamadas a `calcular` con la misma entrada dan el mismo `huella_calculo` y el mismo `resultado`; `calcularCorrida` sobre una agrupación con 4 años y 10 tiendas tarda < 50 ms (test de humo local, no de CI).
21. **Todos los años visibles (Q1)**: fixture "forma corrida" → `construirSeries` devuelve 2023 (gris, visible por defecto), 2024, 2025 y 2026, las cuatro encendidas; `filasCsvAnioMes` incluye 2023 con su participación real; con `anios_excluidos = [2024]`, 2024 sigue en el gráfico en gris.
22. **Ruido sin Niño (Q2)**: PEQUEÑA con 2024 = 2025 × 1.2 → `ruido_normal = 0`; con abril y junio intercambiados en 2025 → ≈ 24 pp; el `confirm` de PEQUEÑA muestra "ruido entre años normales: 24"; `efecto_atipico.forma` sigue `null`.
23. **Obsolescencia por mes posterior (Q3)**: curva aprobada con `hasta = 2026-08`; publicar 2026-09 en el fixture con `hoy` tal que 2026-09 no está cerrado → `datos_posteriores`, sin motivos; con `hoy` que lo cierra → `carga_nueva`; reaprobar con `hasta = 2026-09` → sin motivos; republicar 2024-03 → `carga_nueva` en ambos casos.
24. **Sin venta y prestada (Q6)**: una cuarta agrupación VACÍA sin filas → `sin_venta` bloquea y `PUT` responde `409 prerrequisitos`; PEQUEÑA (prestada) → `PUT` de `T` responde `201` con `origen = 'prestada'`; si la temporada entera queda sin años → `409 sin_curva_posible`.
25. **Formato (Q4)**: ninguna `frase`, `detalle` de aviso ni motivo de obsolescencia generado por `modelo.ts`, `obsolescencia.ts` o `prerrequisitos.ts` contiene un decimal con coma (solo punto decimal y coma de miles, como el `es-PE` de `src/lib/formato.ts`); `formatearPuntos` y `formatearPp` dan el mismo texto para 27.43 (`27.4` y `27.4 pp`).
26. **Curva prestada y temporada recompuesta (regla 51)**: PEQUEÑA se vuelve de invierno sin años propios suficientes y aprueba `T`; mover una equivalencia de ABRIGO a VERANO cambia `huella_temporada` de invierno → PEQUEÑA `obsoleta` (`temporada_recompuesta`) y ABRIGO (propia) solo con aviso; revertir la equivalencia limpia ambas; el detalle nombra la agrupación que cambió.
27. **Control del Niño con una sola agrupación (regla 36)**: `calcular` de ABRIGO sola devuelve `efecto_temporada` con `invierno` **y** `todo_el_ano` (control 1.00 del caso 1f) y 2023 atípico en la serie `T`; `anios-atipicos` reproduce el ratio relativo 0.65 sin que exista ninguna corrida.
28. **`hasta` explícito (reglas 49 y 53)**: aprobar con `hasta = 2026-07` cuando el defecto es 2026-08 → `hasta_fue_por_defecto = false`; publicar 2026-09 y cerrarlo → sigue `datos_posteriores`, nunca `carga_nueva`; reabrir la agrupación → `parametros.hasta_periodo = 2026-08` (no 2026-07) y la cabecera "la vigente usó hasta 2026-07".
29. **Concurrencia (regla 54)**: dos pestañas abren ABRIGO sin vigente; la primera aprueba (v1); la segunda envía `version_vigente = null` → `409 vigente_cambiada`; recarga, envía `1` y aprueba v2.
30. **Modelo anterior (regla 55)**: una foto con `version_modelo = 0` en el fixture → la lista muestra `al_dia` con `avisos_vigente = ["modelo_anterior"]`; "Ver foto" de esa versión compara con su propia curva (diferencia 0.0) y no evalúa obsolescencia.
31. **Pruebas y comparabilidad (regla 56)**: ABRIGO con 2023 excluido → `pruebas = 2` en cada candidata y, frente a una vigente ajustada con 2023–2025, `comparable_con_vigente = false`.

## Hito de prueba (para recorrer con Cowork, usuario planner; nada se escribe salvo en los pasos marcados ✍️)

**Automático**

- [ ] `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build` y `scripts/validar-migraciones-local.sh` en verde; `0017` **con el ajuste 1b** reaplicada en `vector-two` (la `0015` y la `0016` se verifican, no se reaplican; `select venta_estacionalidad_agrupacion(null) ? 'cargas'` devuelve `true`); tipos regenerados (`agrupacion_estacionalidad_id` en `corridas_estacionalidad`, `venta_estacionalidad_agrupacion` bajo `Functions`); `APP_VERSION = 0.9.7 · M6`; PLAN, DECISIONES, CHANGELOG, la ficha 06 (nota de cabecera) y `docs/pruebas/cowork-checklist.md` (sección D reescrita con lo de abajo) actualizados.

**Prerrequisitos de Javier** (los mismos de la 06): faltantes de M3 en cero; fechas de apertura y cierre en M4; las 10 agrupaciones de toda temporada revisadas; ✍️ los cuatro periodos del Niño creados (la pantalla no deja calcular invierno ni verano sin ellos).

**Recorrido**

1. [ ] Roles: el comprador no ve el menú y recibe `403` en toda la API de M6; `POST …/calcular` y `PUT` con comprador → `403`.
2. [ ] **Lista sin periodos** (antes del paso ✍️): la pestaña Agrupaciones abre primero; arriba el aviso "No hay periodos atípicos para invierno (4) ni verano (1)"; las 5 filas marcan "Bloqueada: sin periodos"; las 10 de toda temporada, "Sin curva"; no existe ninguna tarjeta Calcular, selector de corridas ni botón de referencia.
3. [ ] **Trabajar una de invierno sin periodos**: abre la vista, muestra la tarjeta "No se puede calcular todavía" con el enlace a Periodos atípicos y la casilla de confirmación; sin gráfico; marcar la casilla calcula y 2023 sale "normal" con el aviso (se desmarca después; no aprobar).
4. [ ] ✍️ Crear los cuatro periodos con los atajos. Volver a la lista: las 5 filas pasan a "Sin curva".
5. [ ] **Trabajar una de toda temporada** (datos reales, cifras agregadas): la vista aparece en **menos de 3 s** (anotar `duracion_ms` de la cabecera y el tiempo total percibido); se ven 2023, 2024 y 2025 continuas, 2026 discontinua hasta setiembre, la propuesta gruesa y la banda; **no hay aprobada** (fila "Aprobada" ausente); la tabla año × mes suma 100 % por año y sus unidades coinciden con la suma de la red (no con el histograma crudo de M11); la frase de recomendación se lee entera; el `radio` cambia la propuesta sin llamar al servidor; el aviso "Sigue en Toda temporada: confirma la temporada" aparece.
6. [ ] **Trabajar una de invierno**: red 8 · 9 · 9 · 10; 2023 "Niño completo" con su tratamiento y las tres cifras del veredicto; 2026 parcial con las dos formas; volumen 2023 y 2026 sobre tiendas comunes; T10 (la tienda nueva) con su peso en 2026 y, si aplica, "Distinta".
7. [ ] **Parámetros**: excluir T10 de la red → recalcula en **menos de 1 s** (caché: la segunda lectura no toca la función SQL), la red de 2026 baja a 9 y la curva parcial de 2026 cambia; "Restablecer" vuelve; excluir 2023 del ajuste → las candidatas cambian, 2023 queda en gris, cada candidata dice "2 pruebas" y aparece "EAT no comparable" si hay vigente; el chip cuenta los parámetros distintos del valor por defecto; intentar aprobar con T10 excluida y sin nota → "nota requerida"; el panel no muestra umbrales editables.
8. [ ] ✍️ **Aprobar** en una agrupación de toda temporada la recomendada: `confirm` con agrupación, temporada, candidata, años, EAT frente al ruido y avisos; "Curva A aprobada como versión 1"; la vista muestra la fila "Aprobada v1" igual a la propuesta (diferencia 0.0) y la lista "Al día · v1".
9. [ ] ✍️ **Aprobar otra candidata** en la misma agrupación sin nota → mensaje "nota requerida"; con nota → v2, la lista "Al día · distinta de la recomendada (A)", y en Versiones v1 "reemplazada" con "Ver foto" que abre el detalle congelado **comparado con la curva v1** (diferencia 0.0) y sin aviso de obsolescencia.
9b. [ ] **Dos pestañas**: con la misma agrupación abierta en dos pestañas, aprobar en una y luego en la otra → `409 vigente_cambiada` legible y recarga.
9c. [ ] **`hasta` no heredado**: aprobar con "Calcular hasta" un mes antes del defecto; reabrir → el selector vuelve al defecto y la cabecera dice "la vigente usó hasta …"; la lista no la marca obsoleta por el mes siguiente ("datos posteriores").
10. [ ] **Datos cambiados**: dejar abierta una agrupación, en otra pestaña cambiar su temporada (o una fecha de tienda en M4 y revertirla), volver y pulsar Aprobar → `409 datos_cambiados` legible y recarga; la lista marca **Obsoleta** con el motivo; "Comparar con el sistema" llena la columna Sistema hoy sin crear nada en la base (`select count(*) from corridas_estacionalidad` no cambia).
11. [ ] ✍️ **Las 15 una por una**: Javier recorre cada agrupación, revisa, ajusta si hace falta y aprueba; al final `select count(*) from curvas_estacionalidad where estado = 'vigente'` = 15 y `select count(*) from corridas_estacionalidad where agrupacion_estacionalidad_id is not null` = número de aprobaciones; "Sin curva" = 0; sin aprobación en bloque en ningún sitio.
12. [ ] **Años Niño**: calcular a demanda reproduce sobre tiendas comunes las cifras de la 06 (invierno 2026 ene–set ≈ 0.66, verano 2026 ≈ 1.24, toda temporada ≈ 0.975; 2023: invierno ≈ 0.63, verano ≈ 0.73, toda temporada ≈ 0.95); "Lo que recibirá M7" descarga CSV; `/anios?temporada=invierno&con_volumen=1` devuelve el mismo `ratio_volumen` con `corrida_id: null`.
12a. [ ] **Curva prestada**: en una agrupación cuya curva aprobada sea `T` (si la hay), mover una equivalencia entre dos agrupaciones de su temporada en M3 y volver → "Obsoleta: cambió la composición de …"; en una propia de la misma temporada, solo el aviso; revertir limpia ambas.
12b. [ ] **Hallazgos de QA**: en una agrupación de invierno con 2023 descartado (forzar `tratamiento = descartar`), 2023 sigue visible en gris y en la tabla; en una de toda temporada el ruido entre años normales aparece junto al EAT y en el `confirm`; tras aprobar con datos hasta 2026-09, la lista no marca Obsoleta por un mes posterior no cerrado (si lo hubiera) sino "datos posteriores"; recargar el navegador con `?agrupacion=<id>` reabre la misma vista; todas las cifras se leen con punto decimal (`27.4`), en la pantalla y en las frases del servidor.
13. [ ] `GET /api/curvas/vigentes` devuelve 15 filas con `curva` (suma 1), `acumulada`, `version`, `curva_id` y huellas (contrato con M7 intacto); el CSV abre en Excel.
14. [ ] **Validación de negocio (Javier)**: en cinco agrupaciones conocidas, la curva aprobada se parece a la del Excel de planeamiento; donde difiere, la tabla año × mes, la red comparable y los parámetros explican por qué; se anota qué parámetro la acerca y si alguna curva "aprobada distinta de la recomendada" tiene su nota.

## Cambios respecto a la especificación

Lo construido en `0.9.7 · M6` se apartó de la primera versión de esta ficha en siete puntos. El texto de la ficha ya está alineado; esta lista deja el rastro.

1. **Formato numérico con punto decimal.** La ficha pedía "coma decimal, espacio fino de miles" (Q4 y caso 25). El formateador `es-PE` de `src/lib/formato.ts` da punto decimal y coma de miles, y es el que ya lee Javier en el resto de Vector2; servidor y pantalla lo comparten. Todas las cifras de esta ficha están escritas así (`27.4 pp`).
2. **Todos los años visibles por defecto.** Q1 y la regla 47 dejaban los años descartados o excluidos a mano "apagados por defecto". Decisión del dueño: **todos visibles**; van en gris y las casillas "Mostrar" permiten apagarlos.
3. **`partir_de_vigente` en el cuerpo de `calcular`.** La ficha decía que la pantalla pedía "los parámetros de la última aprobación"; se resolvió en el servidor con un campo booleano del cuerpo (solo en `calcular`; `PUT` no lo acepta). Nunca arrastra el `hasta_periodo`.
4. **`ruido_normal` también en la lista y en las versiones**, no solo en el cálculo de una agrupación: la `vigente` de `GET /api/curvas` y cada versión de `GET …/versiones` lo llevan, para leer EAT y ruido juntos sin abrir la agrupación.
5. **`ErrorApi` y `codigoDeError` en `src/lib/api-client.ts`.** El cliente conserva el `codigo` de negocio de los `409` para que la pantalla ofrezca una acción distinta por caso (ver "Contratos de API").
6. **Orden de los `409` del `PUT` fijado**, con un código más al frente: `hasta_periodo_sin_cargar`, `agrupacion_inactiva`, `prerrequisitos`, `sin_curva_posible`, `candidata_no_disponible`, `datos_cambiados`, `vigente_cambiada`, `sin_cambio`, `nota_requerida`. `calcular` también responde `409 hasta_periodo_sin_cargar` si el mes pedido no está publicado.
7. **Tarjeta de M6 en Inicio** (`src/app/(app)/page.tsx`): estado "parcial" con la etiqueta **"En validación"** y enlace a `/planificacion/curvas-estacionalidad`, hasta que Javier cierre el hito.

## Qué se reutiliza y qué se descarta

**Se conserva sin cambios**: `src/lib/curvas/` `red.ts`, `candidatas.ts`, `backtesting.ts`, `efecto.ts`, `atipicos.ts`, `anios.ts`, `liquidacion.ts`, `grafico.ts`, `tipos.ts`, `agregado.ts` (más la forma nueva), `reglas.ts` (`filaCurva`, `armarComparador`, `aVigenteResumen`, `aCurvaVigente`, `huellasDeCurva`), `esquemas.ts` (periodos, `calcularSchema` como base, `leerConsultaRed`), `consultas.ts` (periodos, agrupaciones, tiendas, cargas, curvas, corridas por id), `lectura.ts` (`leerObsolescencia`, `errorConCodigo`); rutas `GET /api/curvas/vigentes`, `GET /api/curvas/red-comparable`, `GET /api/curvas/corridas/[id]/agrupaciones/[agrupacionId]`, `DELETE /api/curvas/agrupaciones/[id]`, todo `/api/periodos-atipicos*`; componentes `grafico-curvas`, `mini-curva`, `comparador-curvas`, `tabla-anio-mes`, `efecto-nino-detalle`, `red-comparable`, `periodos-tab`, `formulario-periodo`, `anios-atipicos-card`, `parametros-form.ts`, `vista.ts` (textos, filtros, CSV), `use-recurso`, `meses.ts`, `atajos.ts`; migraciones `0011`, `0015` y `0016` tal como están; las 2 119 pruebas salvo las que prueban lo retirado.

**Se extiende**: `modelo.ts` (`VERSION_MODELO`, `series_temporada` con atípicos y todas las temporadas, `anios_excluidos`, `ruido_normal` expuesto), `backtesting.ts` (`pruebas`), `red.ts` (`tiendas_excluidas`), `huellas.ts` (`huellaCalculo`, `huellaTemporada`), `obsolescencia.ts` (`hasta_periodo`, `hasta_fue_por_defecto`, `temporada_recompuesta`, `modelo_anterior`), `entrada.ts` (`armarEntradaAgrupacion`), `estado.ts` (estados y avisos sin corrida), `series.ts` y `vista.ts` (Q1), `candidatas-tabla` ("N pruebas"), `red-panel.tsx` (sin `corridaId`, solo `GET /api/curvas/red-comparable`), `cache-venta.ts` (nuevo), `tipos-api.ts` (tipos nuevos; `MOTIVOS_RED` + `excluida_manual`; `CODIGOS_AVISO` + `anio_excluido`; `MOTIVOS_PRERREQUISITO`), `detalle-agrupacion.tsx` (pasa a ser la vista de trabajo con parámetros, prerrequisitos y versiones), `curvas-tab.tsx` (lista v2), `curvas-panel.tsx` (sin corrida seleccionada), `anios-nino-tab.tsx` (a demanda).

**Se retira**: `POST /api/curvas/calcular`, `GET /api/curvas/corridas`, `GET`/`PATCH /api/curvas/corridas/[id]`, `calcular-card.tsx`, el selector de corridas, "Marcar como referencia", `resolverCorrida`, `corridaDeReferencia`, `planificarReferencia`, `marcarReferencia`, `quitarReferencia`, `refrescarYLeerAgregado`, `leerCorridasLista`, `leerMarcasDeCorridas`, `leerCorridaReferencia`, `leerUltimaCorrida`, `elegirCurvaSchema`, `marcarReferenciaSchema`, `motivoRechazoElegir` (sustituido), y sus tests. En la base, **nada se borra**: la corrida global de la `0.9.6` queda como historial con `agrupacion_estacionalidad_id` nulo, `referencia` y la MV quedan sin uso y comentadas.

## Riesgos

- **Tiempo de la función SQL**: un agregado completo de `venta_stock_vigente` (870 359 filas) por apertura de agrupación; medido 0.6 a 1.5 s. Mitigación: se vuelve a medir en el hito; reserva: la misma función sobre la MV con refresco por huella de cargas (`0018`), sin tocar la API. El agregado de la agrupación va por índice y no es el problema.
- **Cálculo repetido al mover parámetros**: resuelto con la caché de lectura en memoria por huella (TTL 120 s, 20 entradas); el riesgo residual es servir una lectura vieja, y lo evita la clave (tres huellas que `calcular` lee siempre de la base) y la verificación de la huella en el `PUT`. Si Railway corriera más de una instancia, cada una tendría su caché: sigue siendo correcto, solo menos eficaz.
- **Huella de temporada y curvas prestadas**: una agrupación de toda temporada movida marca obsoletas (o avisa) a muchas curvas a la vez, porque el control de todo el año entra en la huella de todas las temporadas. Es correcto (el control cambió) pero puede sorprender; el detalle nombra la agrupación que cambió.
- **Prerrequisito de periodos bloqueante**: puede frenar a un planner que sabe que una temporada no tuvo Niño. Por eso existe la casilla de confirmación, que queda en la foto.
- **Sin transacción al aprobar**: una foto sin curva o una curva reemplazada sin sustituta son visibles y se reparan repitiendo; mismo riesgo que en la 06, un paso más (la foto).
- **Determinismo como base del estado "al día"**: cualquier dependencia del modelo que no entre en la huella (por ejemplo, el reloj en `hastaPorDefecto`) rompería la lectura; por eso `hasta_periodo` efectivo entra en la huella y el modelo no lee el reloj (06, regla 19).
- **Objetos sin uso en la base** (MV, funciones de refresco, `referencia`): no se pueden borrar por la regla de migraciones; quedan documentados con `comment on` y cubiertos por el test estático de que nadie los nombra.

## Fuera de alcance

- Guardar cada cálculo que se mira (solo se guarda la foto al aprobar); recálculo automático al cambiar los datos (solo `obsoleta` con motivo); aprobación en bloque; notificaciones.
- Cachear la lectura de venta en el servidor; la variante de la función sobre la MV (`0018`, solo si la medición lo exige).
- Curvas por tienda o por grupo de tiendas (M6b en el sentido de la 06: el diagnóstico `tienda_distinta` sigue siendo la evidencia); candidatas `G`/`H`, `medida = venta_soles`, CV % por línea, mediana por mes, modelos con tendencia.
- Edición del factor de volumen del Niño (M7); mezcla de curvas por GML (`curvaUnidad`, M7); proyección del resto del año (M7).
- Un historial de "quién miró qué" (auditoría general).
- **Segunda entrega de M6 (diferido por alcance, decidido el 2026-10-15)**: el botón en bloque "Comparar las obsoletas con el sistema" en la lista; la edición de temporada en línea en la lista; la edición en pantalla de los umbrales avanzados (`umbral_forma`, `margen_ruido`, `min_unidades_ano`, `max_meses_hueco`, `umbral_tienda_dominante`, `umbral_cambio_volumen`, `umbral_liquidacion`, `meses_tienda_nueva`, `solo_tiendas_completas`, `exigir_venta_todo_el_ano`). El esquema, la foto y el modelo ya los aceptan: solo falta la pantalla.

## Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

`DECISIONES.md` no numera: cada entrada es `## 2026-10-15 · M6: <título>` con **Decisión / Por qué / Descartado**. Los números de abajo son solo para referirse a ellas dentro de esta ficha; el documentador usa el título en negrita como título de la entrada.

23. **La unidad de trabajo de M6 es una agrupación de estacionalidad.** La pantalla lista agrupaciones con su estado y se trabaja una por una: curva aprobada vigente, curva de cada año y propuesta del sistema en el mismo gráfico y la misma tabla, con la diferencia mes a mes. Javier, 2026-10-15. Descartado: la corrida global con tabla de propuestas (construida en `0.9.6`, sustituida).
24. **El cálculo es a demanda y no se guarda; se guarda la foto de cada aprobación.** Una función SQL `jsonb` filtrada por agrupación (`venta_estacionalidad_agrupacion`) sustituye a la MV y al candado; la foto reutiliza `corridas_estacionalidad` con `agrupacion_estacionalidad_id`; la curva apunta a su foto y M7 no cambia. Descartado: guardar cada cálculo visto; una tabla nueva de fotos; seguir refrescando la MV.
25. **Antes de calcular se comprueban los prerrequisitos de la agrupación y se bloquea con motivo** cuando falta lo imprescindible (periodos para invierno o verano, tienda con venta sin apertura, ningún año completo, sin venta, sin composición); el planner puede confirmar explícitamente "sin años atípicos" y esa confirmación queda en la foto. Descartado: calcular siempre y solo avisar (es lo que permitió calcular con cero periodos).
26. **La aprobación lleva la huella del cálculo** que el planner vio; el servidor recalcula y rechaza con `409 datos_cambiados` si la entrada cambió. Descartado: aprobar por `corrida_id`.
27. **El estado de la lista se deriva de las huellas y del determinismo del modelo**, sin corrida: al día, al día pero distinta de la recomendada, obsoleta con motivo, sin curva; "Comparar con el sistema" calcula a demanda y no escribe. Descartado: una corrida de referencia.
28. **El factor de volumen del Niño para M7 se calcula a demanda** por temporada (misma función sin agrupación) y M7 guarda el valor que use; `corridas_estacionalidad.referencia` y la MV quedan sin uso, documentadas, nunca borradas. Descartado: borrar objetos en una migración.
29. **Los parámetros son por agrupación**, incluidos `anios_excluidos` y `tiendas_excluidas`; los de la última aprobación son el punto de partida al reabrir. Descartado: parámetros globales; exclusión de tiendas como maestro.

30. **Hallazgos de QA de la `0.9.6` como requisitos del rediseño**: todos los años con red se dibujan (`participacion_real ?? participacion`); el ruido entre años normales se calcula a nivel de agrupación y se muestra siempre junto al EAT; `carga_nueva` solo mira meses hasta el `hasta` de la curva y reaprobar la limpia; una sola definición de `sin_venta`; la agrupación abierta va en la URL; formato `es-PE` compartido entre servidor y pantalla.
31. **La huella cubre también a las otras agrupaciones de la temporada y la versión del modelo.** `huella_temporada` (tríos id, temporada, composición de las activas de la temporada y de toda temporada) y `VERSION_MODELO` entran en la huella de cálculo y en la foto; una curva prestada se marca obsoleta (`temporada_recompuesta`) cuando cambia cualquiera de ellas, una propia solo avisa; una foto con un modelo anterior avisa, no obsoleta. Javier, 2026-10-15 (del informe del revisor). Descartado: dejar `T` fuera de la obsolescencia; subir de versión el modelo sin rastro en las fotos.
32. **`hasta_periodo` nunca se hereda y la nota se exige en tres casos.** Cada apertura arranca en el último mes cerrado; el `PUT` lleva el `hasta` explícito y guarda `hasta_fue_por_defecto`; la nota es obligatoria al apartarse de la recomendada, al excluir años o tiendas y con tratamiento distinto de `auto`. Javier, 2026-10-15. Descartado: heredar el `hasta` (dejaría curvas paradas en un mes viejo sin que nadie lo notara); nota opcional.
33. **La lectura de venta se cachea en memoria por huella; la foto se basta sin `resultado`.** La salida de `venta_estacionalidad_agrupacion(id)` (que devuelve también `cargas`) se cachea con clave de tres huellas (TTL 120 s); la obsolescencia y la lista leen solo `parametros`, `red_comparable` y `resumen` de la foto. Descartado: recalcular en el navegador (venta al cliente y modelo en el bundle); leer `resultado` en la lista.
34. **Alcance de la `0.9.7` recortado**: el botón en bloque "Comparar las obsoletas", la edición de temporada en línea en la lista y los umbrales avanzados en pantalla pasan a una segunda entrega. Javier, 2026-10-15. Descartado: entregar todo en una versión.

## Cambios que el documentador debe integrar al construir

- `docs/PLAN.md`: §4 fila de M6 (flujo por agrupación, `0017`, función SQL, foto de aprobación, MV sin uso) y tabla de tablas (`corridas_estacionalidad.agrupacion_estacionalidad_id`; "MV y `referencia` sin uso desde `0.9.7`"); §5 M6 "Paso 2 construido en `0.9.6`; rediseño de flujo `0.9.7` (06b)"; §7 pendientes de Javier (prerrequisitos y preguntas de abajo).
- `docs/DECISIONES.md`: una entrada con fecha `2026-10-15` por cada decisión 23 a 34 de abajo (título en negrita como título de la entrada; sin numeración, como el resto del registro); además una entrada `2026-10-15 · M6: la lectura atómica del agregado y la corrida de referencia quedan sustituidas por el flujo por agrupación` que referencia por título las entradas del 2026-10-14 correspondientes a las decisiones 19 y 22 de la ficha 06 (no se editan las viejas).
- `docs/CHANGELOG.md`: `0.9.7 · M6`; `src/lib/version.ts`; `docs/pruebas/cowork-checklist.md` sección D.
- `docs/modulos/07-proyeccion-anual.md`: la nota de M6 pasa a decir "factor por temporada calculado a demanda (`/anios?con_volumen=1`), sin corrida de referencia".

## Preguntas abiertas

Ninguna. Las cinco de la primera versión de esta ficha se resolvieron el 2026-10-15 con la recomendación del arquitecto (bloquear sin periodos; toda temporada solo aviso; nota obligatoria al apartarse de la recomendada; partir de los parámetros de la última aprobación; comparar por fila, el botón en bloque diferido) y están recogidas en "Decidido por Javier", puntos 7 a 12, junto con las tres decisiones añadidas tras el informe del revisor (nota también al excluir o cambiar el tratamiento; `hasta_periodo` nunca heredado; obsolescencia de la curva prestada por `temporada_recompuesta`).

## Orden de construcción

Tres pasos; cada uno termina con `npm run lint`, `npx tsc --noEmit`, `npx vitest run` y `npm run build` en verde y un commit `M6: …`. `backend` y `frontend` pueden solaparse desde que A publica los tipos de `tipos-api.ts`.

**A · Datos, lógica pura y rutas (`datos` + `backend`).**
1. `datos`: ajuste 1b en `0017` (`create or replace function` con `cargas`; sin `DROP`/`DELETE`/`TRUNCATE`/`UPDATE`), reaplicar la `0017` completa con el MCP en `vector-two`, regenerar tipos, anotar la duración con y sin id (regla 45).
2. `backend`, lógica pura con tests (reglas 32 a 59; fixtures `fixtureVentaEstacionalidad`): `agregado.ts` (`leerVentaEstacionalidad` con `cargas`), `entrada.ts` (`armarEntradaAgrupacion`, todas las temporadas presentes), `modelo.ts` (`VERSION_MODELO`, `series_temporada`, `armarGrupoTemporada` con `atipicos`, `anios_excluidos`, `ruido_normal` expuesto, `pruebas`), `red.ts` (`tiendas_excluidas`), `huellas.ts` (`huellaCalculo`, `huellaTemporada`), `prerrequisitos.ts`, `obsolescencia.ts` (`hasta_periodo`, `hasta_fue_por_defecto`, `temporada_recompuesta`, `modelo_anterior`, foto sin `resultado`), `estado.ts` v2, `reglas.ts` (`motivoRechazoAprobar`, `filaCurva`, `comparable_con_vigente`), `esquemas.ts`, `cache-venta.ts`, `series.ts` / `vista.ts` (Q1), `formato.ts` (Q4).
3. `backend`, rutas: `POST …/agrupaciones/[id]/calcular`, `PUT` v2, `GET …/versiones`, `GET /api/curvas` v2, `GET …/corridas/[id]/agrupaciones/[agrupacionId]` (foto propia, `leerCorridaPorId`), `GET /api/curvas/anios-atipicos` a demanda, `GET /api/periodos-atipicos/anios` (`agrupacion_id` a la función, `huella_cargas`, aviso); borrar las cuatro rutas retiradas y `resolverCorrida` y compañía; test estático (regla 46).

**B · Pantallas (`frontend`).**
4. `curvas-tab.tsx` lista v2 (estados, avisos por fila, Comparar por fila, resumen con `bloqueadas_sin_curva`; sin tarjeta Calcular, selector ni referencia), `red-panel.tsx` sobre `GET /api/curvas/red-comparable` sin `corridaId`.
5. `detalle-agrupacion.tsx` como vista de trabajo: `?agrupacion=&modelo=` en la URL, tarjeta Antes de calcular, gráfico y tabla con aprobada · años · propuesta (Q1), bloque Lo que propone (frase, "N pruebas", ruido siempre), Efecto del Niño, panel de parámetros de primera entrega (años, tratamiento, tiendas, Calcular hasta no heredado), Aprobada frente a propuesta (no comparable, modelo anterior, obsoleta), Nota / motivo con los tres casos, Aprobar con `version_vigente`, Versiones con "Ver foto" (comparador contra la curva de la foto).
6. `anios-nino-tab.tsx` a demanda y `periodos-tab.tsx` (pie y tarjeta sin `ratio_volumen`); `APP_VERSION = 0.9.7 · M6`.

**C · QA y despliegue (`qa` + `documentador`).**
7. `qa`: recorrido del hito (automático y pasos 1 a 14, con 9b, 9c y 12a), medición de tiempos (función, vista, recálculo cacheado), informe de hallazgos; `seguridad` (opus) revisa las rutas nuevas (solo lectura).
8. `documentador`: PLAN §4/§5/§7, DECISIONES (entradas con fecha, ver arriba), CHANGELOG `0.9.7 · M6`, nota de cabecera de la ficha 06, `cowork-checklist.md` sección D, nota de M7.
9. Despliegue en Railway de `0.9.7 · M6`; Javier recorre las 15 agrupaciones (hito, paso 11) y valida contra el Excel (paso 14); lo que salga abre la segunda entrega (ver "Fuera de alcance").
