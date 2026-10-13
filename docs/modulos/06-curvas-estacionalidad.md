# M6 · Curvas de estacionalidad

> Estado: **especificación pendiente de aprobación por Javier (escrita el 2026-10-12; actualizada el 2026-10-13 con su respuesta a la pregunta 1: la temporada vive en la agrupación de estacionalidad y el Niño afecta a las de invierno)**. No hay código ni migración. Módulo anterior: [05-venta-stock](05-venta-stock.md) (la venta real de la que salen las curvas); también dependen de aquí [03-agrupaciones-estacionalidad](03-agrupaciones-estacionalidad.md) (la unidad de la curva es la agrupación), [04-tiendas](04-tiendas.md) (fechas de apertura y cierre para la "red comparable"). [02-marcas](02-marcas.md) y la mejora 02b no intervienen (Javier cerró el 2026-10-13 que la marca del Niño no vive en la agrupación de marca). Reglas de base en `docs/PLAN.md` y `docs/DECISIONES.md`. Migración prevista: `0011_curvas_estacionalidad.sql` (renumerada tres veces el 2026-10-12: la `0008` la toma la mejora urgente 05b de M5, `docs/modulos/05b-mapeo-combinaciones.md`; la `0009`, la mejora 05c de M5, `docs/modulos/05c-ubicaciones-conciliacion.md`; y la `0010`, la mejora 02b de M2, `docs/modulos/02b-marcas-tratamiento-gml.md`; las tres se construyen antes); versión prevista: `0.9.0 · M6`. Ningún dato real de Lukers en esta ficha: todos los ejemplos son sintéticos.

## Objetivo

Dar a M7 una **curva mensual por agrupación de estacionalidad**: doce participaciones (cada mes ÷ total del año) que suman 100 %, calculadas sobre la venta real que cargó M5 y **elegidas por el planner** entre varias candidatas que un modelo estadístico propone y compara con backtesting. El módulo resuelve tres problemas que M5 dejó abiertos a propósito: qué meses son atípicos (El Niño costero de 2023 y 2026) y cómo se descuentan, cómo se trata el año en curso incompleto, y qué hacer con la liquidación, que infla las unidades de algunos meses. Sin curva vigente, M7 no puede proyectar una agrupación; por eso el hito es "toda agrupación activa con venta tiene curva vigente".

## Decidido por Javier (2026-10-12)

Entran como reglas firmes, no como preguntas:

1. **La estacionalidad se calcula sobre la participación del mes en el año**: para cada agrupación y cada año, `participación_m = venta_m ÷ Σ venta del año`, doce valores que suman 100 %. No se usan promedios de unidades ni índices "1,0 = mes promedio" como en Vector-One: la participación es comparable entre años con distinto volumen y entre agrupaciones de distinto tamaño, y es lo que M7 necesita para repartir un total anual en meses.
2. **Un modelo estadístico propone la curva más adecuada** por agrupación. El planner la ve, la compara con las demás candidatas y con cada año real, y decide. La curva elegida queda guardada con versión, quién la aprobó y cuándo; la recomendación nunca se aplica sola (salvo que el planner apruebe "todas las recomendadas" en bloque, acción explícita).
3. **2023 y 2026 son años de El Niño costero.** La venta de esos periodos está distorsionada. Los meses exactos no están cerrados (en 2023 se habló de marzo a mayo; 2026 sin definir) y por eso **no van en el código**: viven en un catálogo editable de periodos atípicos (abajo), el "mantenimiento" que Javier pidió el 2026-10-13 ("para marcar efecto Niño necesitamos un mantenimiento").
4. **(2026-10-13) La temporada vive en la agrupación de estacionalidad, y las de invierno son las que se afectan por el Niño.** Javier: "en las agrupaciones de estacionalidad deberíamos marcar si es una estacionalidad de invierno, verano o toda temporada; las de invierno se afectan por el Niño". Cierra la pregunta abierta 1 de esta ficha (no es la agrupación de marca) y la pregunta 6 de M3: columna `temporada` en `agrupaciones_estacionalidad` con tres valores (`invierno`, `verano`, `todo_el_ano`), y los periodos atípicos con alcance "invierno" solo ajustan a las agrupaciones de invierno. Nada de casilla booleana.
5. **(2026-10-13) Premisa a validar, no a asumir: el Niño cambia sobre todo el volumen, no la forma.** Javier: "me he dado cuenta de que la estacionalidad no cambia tanto, lo que cambia es el volumen de unidades. Pero vale revisarlo". Como la curva es participación, un efecto uniforme sobre el volumen no la mueve; si es así, los años de Niño **se pueden usar tal cual** y se recuperan 2023 y 2026 para las agrupaciones de invierno. M6 lo comprueba por agrupación (ver "¿El Niño cambia la forma o solo el volumen?") y la recomendación por defecto depende del veredicto. El efecto sobre el **volumen** es un requisito de M7 (ver "Fuera de alcance"), no de M6.
6. De antes (2026-10-06): no hay curvas manuales ni curvas en M3; la curva sale de la venta real. De M5 (2026-10-11): la carga no marca ni excluye ningún mes; el CV % = costo ÷ venta neta se calcula aquí, agregado por línea y mes, nunca al cargar.

## Conceptos

### Participación, año y curva

- **Mes**: `periodo` de `venta_stock_vigente` (primer día del mes). **Año**: calendario, enero a diciembre (pregunta abierta 7 por si Javier planifica con otro corte).
- **Medida**: por defecto **unidades** (`unidades`), porque M7 proyecta unidades. La venta neta (`venta_soles`) se calcula siempre a la par como medida alternativa y es la base de una de las candidatas (ver "Candidatas"). El costo (`costo_vendido`) solo sirve para el CV %.
- **Participación de un año** para una agrupación: vector `p(Y) = [p_1 … p_12]` con `p_m = medida_m ÷ Σ_{k=1..12} medida_k`. Si la suma del año es ≤ 0 el año no tiene participación (`sin_volumen`). Las unidades pueden ser negativas en un mes por devoluciones; un mes negativo se trunca a 0 antes de calcular (aviso `mes_negativo`). Se guarda con 6 decimales como fracción (`0.083333`), se muestra en porcentaje con un decimal.
- **Curva**: un vector de 12 participaciones que suman 1 (±0,0001 por redondeo; la última normalización ajusta el mes mayor para que la suma sea exactamente 1 en los 6 decimales guardados).
- **Año completo**: los 12 meses del año están **publicados** en M5 (`cargas_venta_stock.estado = 'publicada'`). Un año al que le falte un mes por cargar no es completo (aviso `meses_sin_cargar`, con la lista) y no entra en ningún cálculo; esto es distinto del año en curso.
- **Año en curso**: el que contiene `hasta_periodo` (por defecto el último mes publicado que además está cerrado según la fecha de Lima, con `ultimoMesCerrado` de `src/lib/ventas/periodo.ts`). Nunca entra en el ajuste de las candidatas; sirve solo para la **validación parcial** (abajo) y se dibuja como "2026 (parcial, ene–sep)". Cuando se cargue diciembre y se vuelva a calcular, pasa a ser año completo sin tocar nada.
- **Año normal / año con huecos / año descartado** para una agrupación: ver "Periodos atípicos".

### Grano: una curva por agrupación para toda la red (recomendación)

Se recomienda **una curva por agrupación de estacionalidad, sobre la venta de toda la red de tiendas**, y no por agrupación × tienda. Por qué:

- Con ~10 tiendas y aperturas y cierres (M4), muchas combinaciones agrupación × tienda no tienen ni un año completo normal: una tienda abierta en julio de 2024 solo aportaría 2025, y si además es afectada por el Niño en 2026, su curva propia sería un solo año. A nivel de red, 2024 y 2025 están completos para casi todo.
- El volumen por agrupación × tienda × mes es pequeño (decenas de unidades en las agrupaciones chicas): la participación sería ruido y el backtesting lo confirmaría con errores grandes.
- Vector-One calculaba por tienda / marca / género / línea y el resultado fueron miles de combinaciones con uno o dos años, índices inestables y una proyección que nadie podía revisar a ojo. La curva de la red es revisable: ~50 curvas, no ~5 000.
- La distribución por tienda es trabajo de M7 (participación de cada tienda en el año, venta esperada de M4 para las nuevas), no de la forma de la curva. Si Javier observa que alguna tienda tiene de verdad otra estacionalidad (por ejemplo, un formato de outlet o una zona con otro clima), M6 deja la puerta abierta: el agregado precalculado guarda la tienda, la pantalla muestra la curva real de cada tienda como **diagnóstico** (solo lectura, sin candidatas ni elección), y un "M6b" podría añadir curvas por tienda para agrupaciones concretas sin rehacer el modelo.

Lo que sí hace M6 con las tiendas es la **red comparable por año** (parámetro `solo_tiendas_completas`, por defecto activado): para calcular la participación del año Y solo cuentan las tiendas de tipo Tienda que estuvieron abiertas los 12 meses de Y (`fecha_apertura ≤ Y-01-01` y `fecha_cierre` nula o `≥ Y-12-31`, con las fechas de M4). Sin esto, una tienda que abre en julio mete venta solo en el segundo semestre y deforma la curva de ese año hacia la derecha; y una que cierra en marzo, hacia la izquierda. Una tienda **sin fecha de apertura** se trata como abierta siempre (aviso `tienda_sin_apertura`, con enlace a M4). El Centro de Distribución no vende (M5 avisa si lo hace) y queda fuera por tipo. Las tiendas desactivadas en M4 no tienen hechos (M5 las excluye) y no aparecen. Desactivando el parámetro se usa toda la venta de cada año; la pantalla muestra, por año, cuántas tiendas entran y cuáles quedan fuera.

### Periodos atípicos (catálogo editable, nunca meses fijos en el código)

Tabla `periodos_atipicos`: cada fila es un rango de meses (`desde`, `hasta`, inclusive, primer día del mes), un `motivo` corto ("Niño costero 2023"), una `descripcion` opcional y un **alcance**: `invierno` (por defecto: solo las agrupaciones con `temporada = 'invierno'`, que es lo que Javier dijo del Niño) o `todas` (un evento que distorsiona toda la venta: una paralización, una pandemia, un cierre masivo). Recomendación: el Niño con alcance `invierno`; `verano` y `todo_el_ano` no se ajustan por defecto (si Javier observa que el Niño también mueve la forma del verano, es un segundo periodo con alcance `todas` o, si hiciera falta, un alcance `verano` que hoy no existe; pregunta abierta 13). Sin seed: Javier crea "Niño costero 2023 · 2023-03 a 2023-05" y el de 2026 cuando sepa sus meses (hito, paso 1). Este catálogo es el **primer entregable** del módulo y se puede usar antes de que exista el cálculo (ver "Entrega en dos pasos"). Los periodos pueden solaparse (se toma la unión) y pueden incluir meses futuros (un periodo de 2026 declarado antes de cargar diciembre).

**Temporada de la agrupación (resuelto el 2026-10-13).** `agrupaciones_estacionalidad.temporada` con tres valores: `invierno`, `verano`, `todo_el_ano`; **no nula, por defecto `todo_el_ano`**, de modo que las agrupaciones que ya existen (y sus equivalencias asignadas) no necesitan ningún `UPDATE` en la migración: nacen como "toda temporada", que es el valor neutro (no se les descuenta nada), y Javier marca las de invierno desde la pantalla de M3 o desde la de M6. La edita el planner en el diálogo de la pestaña Agrupaciones de M3 (`Select` Temporada), en línea en la tabla de M6, y el importador de M3 admite una sexta columna opcional `TEMPORADA` para las agrupaciones **nuevas** (nunca cambia la de una existente, con el mismo criterio con que no amplía sus géneros).

**Relación con `lineas.temporada` de M1** (Verano / Invierno / Todo el año, que ya existe en la línea): la agrupación **no hereda** la temporada de sus líneas; la fija el planner. Pero el sistema la **sugiere**: `temporada_sugerida` = la temporada mayoritaria de las líneas de sus equivalencias activas (por número de equivalencias; empate o sin equivalencias → `todo_el_ano`), y la pantalla avisa `temporada_sugerida_distinta` cuando la fijada no coincide con la sugerida (una agrupación "PANTALONES INVIERNO" marcada `todo_el_ano` con todas sus líneas de Invierno). El aviso `temporadas_mezcladas` ya previsto (líneas de más de una temporada dentro de la agrupación) sigue. Por qué sugerir y no heredar: una agrupación puede juntar equivalencias de líneas de "Todo el año" que en la práctica son de invierno (una casaca ligera), y la clasificación de M1 se hizo para otra cosa; la temporada de la agrupación es la que gobierna el Niño y debe ser una decisión explícita del planner, visible en la pantalla.

**Regla del Niño.** Un periodo atípico con alcance `invierno` aplica solo a las agrupaciones con `temporada = 'invierno'`; con alcance `todas`, a todas. Una agrupación `verano` o `todo_el_ano` no se ajusta por un periodo de alcance `invierno`: sus años de Niño son años normales. La agrupación de marca (ULTRA LOW … PREMIUM) queda fuera: no interviene en la forma de ninguna curva. Lo que sí tiene sentido a nivel de agrupación de marca, si Javier lo pide, es un factor de volumen en M7, no una curva.

**Cómo afecta un periodo atípico al cálculo de una agrupación.** Para cada año completo Y de la agrupación, primero se clasifica y luego se aplica el **tratamiento** elegido (`tratamiento_atipicos`: `auto` por defecto, `incluir`, `imputar` o `descartar`):

| Caso | Qué es | Qué se hace |
|---|---|---|
| **Año normal** | Ningún mes de Y cae en un periodo atípico que aplique a la agrupación (por alcance y temporada) | Entra tal cual |
| **Año con huecos** | Entre 1 y `MAX_MESES_HUECO = 4` meses de Y caen en periodos atípicos que aplican | `incluir`: entra **tal cual**, como si fuera normal (si el Niño solo movió el volumen, su forma es válida). `imputar`: los meses atípicos se **rellenan con la referencia** y los demás se **reescalan** (fórmula abajo). `descartar`: no entra. `auto`: lo decide la comparación de forma (abajo): `incluir` si la forma no cambia, `imputar` si cambia, `incluir` con aviso `sin_referencia` si no hay ningún año normal con el que comparar |
| **Año descartado** | Más de 4 meses atípicos (con `incluir` el límite no aplica: el año entra entero), o con huecos bajo `imputar` sin ningún año normal del que tomar la referencia | No entra; aviso `ano_descartado` con el motivo |

Imputación (`imputarHuecos(p_parcial, A, r)`): sea `A` el conjunto de meses atípicos de Y, `r` la **referencia** = promedio simple de las participaciones de los años normales de la agrupación, `R_A = Σ_{m∈A} r_m`. Para `m ∉ A`: `p_m(Y) = medida_m(Y) ÷ Σ_{k∉A} medida_k(Y) × (1 − R_A)`; para `m ∈ A`: `p_m(Y) = r_m`. El resultado suma 1, conserva la forma real de los meses normales de ese año (que es la información que no queremos perder: 2023 tiene ocho o nueve meses perfectamente útiles) y no inventa nada en los atípicos (ahí repite la referencia, así que esos meses no empujan el promedio en ninguna dirección). Es una decisión explícita frente a lo que hacía Vector-One (descartar el año entero para líneas de Invierno), que con el histórico actual dejaría a las agrupaciones afectadas con solo 2024 y 2025.

Para una agrupación de `verano` o `todo_el_ano` (sin periodos de alcance `todas`), todos los años completos son normales: 2023, 2024 y 2025 hoy. Para una de `invierno`, con un periodo 2023-03 a 2023-05: 2023 es año con huecos (3 meses), 2024 y 2025 normales, 2026 es año en curso y además tendrá su propio periodo cuando Javier lo declare. Con `MAX_MESES_HUECO = 4`, un Niño de seis meses descartaría el año bajo `imputar`; el valor es un parámetro de la corrida, no una constante escondida.

### ¿El Niño cambia la forma o solo el volumen? (comprobación por agrupación)

Javier cree que el Niño mueve el volumen y poco la forma. Como la curva es participación, un Niño que reduce todos los meses del año en la misma proporción no la cambia en nada, y uno que hunde solo marzo a mayo sí. M6 no asume ninguna de las dos: lo **mide** para cada agrupación de invierno con al menos un año con huecos y un año normal:

1. **Curva con Niño incluido** (`c_inc`): candidata `A` con los años con huecos tratados como normales (tal cual).
2. **Curva sin Niño** (`c_sin`): candidata `A` con los años con huecos imputados.
3. **Diferencia de forma** = `EAT(c_inc, c_sin)` en puntos porcentuales, más el mes de mayor diferencia.
4. **Veredicto**: `forma_estable` si la diferencia es menor que `umbral_forma` (por defecto **3 puntos**, editable en la corrida y en la pantalla); `forma_cambia` si no; `sin_comparacion` si no hay año normal o no hay año con huecos.
5. **Efecto sobre el volumen**, para el contrato de M7: para cada año con huecos, `ratio_volumen = Σ_{m∈A} medida_m(Y) ÷ (Σ_{m∉A} medida_m(Y) × R_A ÷ (1 − R_A))`, es decir, lo que vendieron los meses atípicos frente a lo que habrían vendido si hubieran seguido la proporción de los años normales (`0,62` = "los meses del Niño vendieron un 38 % menos de lo esperado"). Es informativo en M6 y es exactamente el factor que M7 necesita para normalizar el volumen base de un año de Niño.

Con `tratamiento_atipicos = 'auto'`: `forma_estable` → los años con huecos **entran tal cual** (`incluir`): se recuperan 2023 y, cuando esté completo, 2026, y el backtesting pasa a tener tres o cuatro pliegues; `forma_cambia` → `imputar`; `sin_comparacion` → `incluir` con aviso. El detalle de la agrupación muestra **lado a lado** `c_inc`, `c_sin`, la diferencia por mes, el veredicto y el `ratio_volumen` de cada año de Niño, y el planner puede forzar el tratamiento desde los parámetros de la corrida. La comparación usa siempre `A`, no la candidata recomendada, para que el veredicto no dependa del modelo elegido. Si Javier tiene razón y la forma no cambia, el resultado práctico es que las agrupaciones de invierno tendrán los mismos años que las demás, y el único rastro del Niño en M6 será el `ratio_volumen` que se le entrega a M7.

**Qué pasa si quedan pocos años.** El mínimo para tener curva propia es **un año utilizable** (normal, incluido o imputado). Con uno, no hay backtesting posible y la curva es ese año; la pantalla lo dice ("1 año: sin validación") y el hito lo acepta como provisional. Con dos, el backtesting tiene dos pliegues de un año cada uno. Con cero (una agrupación nueva, o cuyas equivalencias solo tienen venta en el año en curso), no hay curva propia: la única candidata es la **curva del género** (abajo), marcada como `prestada`, y la pantalla lo deja claro. El modelo no mezcla el año en curso en el ajuste bajo ningún parámetro: la tentación de "usar 2026 enero–septiembre" produce una curva sin el cuarto trimestre.

### Año en curso y validación parcial

El año en curso (meses `1..k` cargados, `k < 12`) se usa para **validar**, no para ajustar: para cada candidata se compara la participación real **dentro de esos k meses** (`q_m = medida_m ÷ Σ_{j≤k} medida_j`, excluyendo los meses atípicos que apliquen) con la misma renormalización de la candidata (`q̂_m = c_m ÷ Σ_{j≤k, j∉A} c_j`). Es una comparación legítima porque solo pregunta "¿la forma de enero a septiembre se parece?", sin suponer nada de octubre a diciembre. Se exige `k − |A| ≥ 6` meses; con menos, no hay validación parcial. El error parcial se muestra al lado del error de backtesting y **no** entra en la recomendación (una regla: la recomendación sale del backtesting sobre años completos; la validación parcial es información para el planner, porque el año en curso puede ser justo el atípico).

### Liquidación: el CV % como señal, y una candidata sin liquidación

**CV % de un mes** = `costo_vendido ÷ venta_soles` agregado. M6 lo calcula en dos granos: **línea × mes** (lo que pidió M5, y lo que M7 usará) y **agrupación × mes** (la suma de sus equivalencias). Nunca por fila ni por marca: con cifras enteras es ruido.

Un mes está en **liquidación** para una agrupación si su CV % supera la **mediana del CV % de los meses normales de ese mismo año** en más del umbral `umbral_liquidacion` (por defecto **15 %** relativo: si la mediana es 0,52, un mes con 0,60 o más está en liquidación). Es una señal, no una verdad: la pantalla marca esos meses en la serie y lista, por agrupación, qué meses y cuántas unidades de más se estiman. No se usa `linea.temporada` ni calendarios de rebajas fijos.

Cómo se **descuenta** la liquidación: no se descuenta de la curva base. La curva base (medida `unidades`) refleja lo que de verdad se vendió, liquidación incluida, y eso es lo que M7 necesita para repartir un total anual entre meses si el plan de compra va a seguir liquidando en los mismos meses. Lo que M6 ofrece es una **candidata explícita "unidades a precio normal"** (`G` en la tabla de candidatas): en cada año, para los meses marcados en liquidación, las unidades se reemplazan por `venta_soles_m ÷ precio_normal(Y)`, donde `precio_normal(Y) = Σ venta_soles ÷ Σ unidades` de los meses **no** marcados de ese año; es decir, las unidades que esa venta habría representado a precio normal. Es una deflación simple, sin elasticidad ni supuestos: baja el pico de los meses de liquidación en la misma proporción en que bajó el precio medio. Si el backtesting la prefiere, es porque la liquidación varía de año en año y "a precio normal" predice mejor; si no, se queda la curva real. Además, la candidata `H` (participación de la **venta neta en soles**) es por construcción menos sensible a la liquidación, porque el descuento baja los soles aunque suban las unidades. Las tres cosas quedan a la vista del planner; la pregunta abierta 4 pide a Javier confirmar el umbral y si quiere que la deflación sea la candidata por defecto para las agrupaciones con liquidación fuerte.

## El modelo: candidatas, backtesting y recomendación

Todo el modelo es **TypeScript puro en el servidor** (`src/lib/curvas/modelo.ts` y vecinos), sin dependencias nuevas: son sumas, promedios, medianas y una media móvil sobre vectores de 12 números, y así se prueba con vitest sobre datos sintéticos exactamente igual que correrá en producción. SQL solo agrega (el agregado precalculado de abajo); no se escribe estadística en SQL porque sería imposible de testear sin base y porque las reglas de huecos, pliegues y liquidación cruzan tablas que en SQL serían una función de 300 líneas. El cálculo completo (≈ 50 agrupaciones × 7 candidatas × unos pocos pliegues) son microsegundos; lo que cuesta es el agregado (2 a 5 s, una vez por corrida).

### Entrada del modelo (por agrupación)

```ts
type SerieAnual = { anio: number; meses: number[12]; completo: boolean };            // una por medida: unidades, venta_soles, costo_vendido
type EntradaAgrupacion = {
  agrupacion_id: string; temporada: "invierno" | "verano" | "todo_el_ano";
  unidades: SerieAnual[]; venta: SerieAnual[]; costo: SerieAnual[];                 // años completos y el año en curso (completo: false)
  atipicos: Set<"aaaa-mm">;                                                           // meses de periodos activos que aplican a esta agrupación (alcance `todas`, o `invierno` si la agrupación es de invierno)
  temporada_sugerida: "invierno" | "verano" | "todo_el_ano";                          // mayoritaria entre las líneas de sus equivalencias (M1); solo para el aviso
  genero: { unidades: SerieAnual[] };                                                 // la suma de todas las agrupaciones del mismo género (para la candidata F)
};
type Parametros = { medida: "unidades" | "venta_soles"; solo_tiendas_completas: boolean;
                    tratamiento_atipicos: "auto" | "incluir" | "imputar" | "descartar"; umbral_forma: number;
                    max_meses_hueco: number; umbral_liquidacion: number; min_unidades_ano: number };
```

### Paso 1 · Clasificar los años y obtener las participaciones reales

Para cada año completo: `normal`, `con_huecos` o `descartado` según la tabla de "Periodos atípicos"; después la **comparación de forma** (si hay años con huecos y normales) fija el tratamiento efectivo bajo `auto`; participación real `p(Y)` con la medida elegida (tal cual si el año entra como `incluido`, imputada si entra como `imputado`). Un año utilizable con menos de `min_unidades_ano` (por defecto **120** unidades: 10 al mes) se marca `escaso` (aviso, entra igual). Resultado: lista `anios_utilizables` (normales e imputados, en orden) y la lista de avisos por año.

### Paso 2 · Candidatas

Cada candidata es una función pura `(anios_utilizables, contexto) → curva | null` registrada en un catálogo fijo `MODELOS` (código, nombre corto, descripción de una frase para la pantalla). Siete en esta entrega:

| Código | Nombre | Cálculo | Cuándo aporta |
|---|---|---|---|
| `A` | Promedio simple | media aritmética de `p(Y)` sobre los años utilizables, renormalizada | base de comparación; con un solo año es ese año |
| `B` | Promedio ponderado por volumen | `Σ_Y medida_m(Y) ÷ Σ_Y Σ_k medida_k(Y)` (años imputados: sus medidas reescaladas con la misma regla) | los años grandes pesan más; útil cuando un año chico es ruidoso |
| `C` | Ponderado por recencia | media de `p(Y)` con pesos `1, 2, …, n` del más antiguo al más reciente | la estacionalidad está cambiando (más venta online, cambio de mix) |
| `D` | Suavizada | `A` seguida de una media móvil circular de 3 meses con pesos `0,25 · 0,5 · 0,25` (diciembre y enero son vecinos), renormalizada | agrupaciones chicas con picos de un mes que no se repiten |
| `F` | Curva del género (prestada) | `A` calculada sobre la serie del género completo (todas las agrupaciones del género, misma regla de huecos con los periodos de alcance `todas`) | agrupaciones sin años utilizables, o tan chicas que su curva propia no supera a la del género |
| `G` | Unidades a precio normal | `A` sobre las unidades deflactadas en los meses marcados en liquidación (ver "Liquidación") | liquidación que varía de año en año |
| `H` | Venta neta | `A` sobre `venta_soles` en lugar de unidades | cuando la medida de M7 sea soles, o como contraste frente a la liquidación |

`G` y `H` se calculan siempre (con sus propias series), aunque la medida elegida sea `unidades`; cuando la medida de la corrida es `venta_soles`, `H` coincide con `A` y se marca "igual a A". La mediana por mes se dejó fuera de esta entrega: con dos o tres años coincide con el promedio o es un año concreto, y mostrarla engañaría; se añade al catálogo cuando haya cinco años (fuera de alcance). Las candidatas que no se pueden calcular (por ejemplo `A` sin años utilizables) devuelven `null` y la pantalla las muestra como "no disponible" con el motivo. Si todas las candidatas propias son `null`, la única es `F` y la curva resultante se guarda con `origen = 'prestada'`.

### Paso 3 · Backtesting (dejar un año fuera)

Para cada año utilizable `T` (pliegue): se ajusta cada candidata con los demás años utilizables (sin `T`) y se compara con la participación **real en unidades** de `T` (siempre unidades, aunque la candidata se construya en soles o deflactada: lo que M7 reparte son unidades reales, liquidación incluida). Si al quitar `T` no queda ningún año, ese pliegue no existe. Con un solo año utilizable no hay backtesting.

Métrica: **EAT, error absoluto total**, `Σ_{m=1..12} |ĉ_m − p_m(T)|` en **puntos porcentuales** (de 0 a 200; "la curva se equivoca 9,4 puntos en el año"), más el **error máximo mensual** (`max_m |ĉ_m − p_m(T)|`, en puntos) como segunda cifra. El error de una candidata es el promedio del EAT sobre sus pliegues. Se eligió el EAT y no el MAPE porque los meses con participación pequeña (2 %) dispararían un error relativo sin que importe en unidades, y porque suma lo que M7 va a mover de un mes a otro.

Para `F`, en cada pliegue el género se ajusta también sin el año `T`. Para `G`, la marca de liquidación de cada año se calcula sobre ese año (no cambia entre pliegues).

### Paso 4 · Recomendación

`recomendada = argmin EAT` entre las candidatas con backtesting; empate (diferencia < 0,05 puntos) → gana la que esté antes en el orden `A, B, C, D, G, H, F` (la más simple primero; `F` al final porque es prestada). Sin backtesting (un año) → `A` con la bandera `sin_validacion`; sin años utilizables → `F` con `origen = 'prestada'`. Además:

- **Estabilidad**: por mes, la desviación típica de `p_m(Y)` entre años utilizables; `estabilidad = 1 − Σ_m sd_m` acotado a `[0, 1]` (1 = años idénticos). Se muestra como "Alta / Media / Baja" (≥ 0,8 · ≥ 0,6 · resto). Informativo.
- **Validación parcial** con el año en curso, si procede (ver arriba): EAT sobre los `k` meses renormalizados, por candidata. Informativo; no cambia la recomendación.
- **Comparación de forma** (solo agrupaciones con años con huecos): `c_inc`, `c_sin`, `diferencia_forma` (EAT), `mes_mayor_diferencia`, `veredicto` (`forma_estable` / `forma_cambia` / `sin_comparacion`), `tratamiento_aplicado` y `ratio_volumen` por año de Niño.
- **Avisos por agrupación**: `sin_anos_utilizables`, `un_solo_ano`, `ano_descartado`, `escaso`, `meses_sin_cargar`, `mes_negativo`, `forma_cambia` (se imputó), `sin_referencia` (año de Niño incluido tal cual porque no hay año normal), `temporada_sugerida_distinta`, `liquidacion_fuerte` (más de 3 meses marcados en algún año), `temporadas_mezcladas` (sus equivalencias pertenecen a líneas con más de una `temporada` de M1; es una pista de que la agrupación mezcla cosas y conviene revisarla en M3), `sin_venta` (agrupación activa sin hechos), `inactiva_con_curva` (agrupación desactivada en M3 que conserva curva vigente).

### Salida (lo que guarda la corrida por agrupación)

```jsonc
{ "agrupacion_id": "…", "temporada": "invierno", "temporada_sugerida": "invierno", "origen": "propia",   // origen: "propia" | "prestada"
  "comparacion_forma": { "veredicto": "forma_estable", "diferencia_forma": 1.8, "mes_mayor_diferencia": 4, "umbral": 3,
                         "c_inc": [0.070, …], "c_sin": [0.071, …], "tratamiento_aplicado": "incluir",
                         "ratio_volumen": [ { "anio": 2023, "ratio": 0.62 } ] },                        // null si la agrupación no tiene años con huecos
  "anios": [ { "anio": 2023, "clase": "con_huecos", "tratamiento": "incluido", "huecos": ["2023-03","2023-04","2023-05"], "unidades": 4810, "escaso": false,
               "participacion": [0.071, …], "liquidacion": ["2023-07","2023-12"] },
             { "anio": 2024, "clase": "normal", … }, { "anio": 2025, "clase": "normal", … },
             { "anio": 2026, "clase": "en_curso", "meses_cargados": 9, "participacion_parcial": [ … 9 valores … ] } ],
  "candidatas": [ { "modelo": "A", "curva": [0.070, …], "eat": 9.4, "error_max": 2.1, "pliegues": 2, "eat_parcial": 6.3, "igual_a": null },
                  { "modelo": "F", "curva": [ … ], "eat": 14.0, … }, { "modelo": "H", "curva": null, "motivo": "sin_anos_utilizables" } ],
  "recomendada": "A", "estabilidad": 0.83, "cv_mensual": [ { "periodo": "2023-01", "cv": 0.52 }, … ],
  "avisos": [ { "codigo": "escaso", "detalle": "2023: 98 unidades" } ] }
```

Las curvas se redondean a 6 decimales y se renormalizan al guardar (`normalizarCurva`); los errores a 2 decimales.

## Modelo de datos

Migración `supabase/migrations/0011_curvas_estacionalidad.sql` (antes `0010`, `0009` y `0008`; ver cabecera), idempotente, sin `DROP`, `DELETE` ni `TRUNCATE` (tampoco dentro de funciones), `create or replace` para funciones y vistas, triggers con `create or replace trigger`, RLS activo sin políticas en toda tabla nueva. Convenciones de PLAN §4: `id uuid`, `activo`, `created_at`/`updated_at`.

### `agrupaciones_estacionalidad` (columna nueva, M3)

| Columna | Tipo | Notas |
|---|---|---|
| `temporada` | `text not null default 'todo_el_ano'` | `alter table … add column if not exists`; `check (temporada in ('invierno', 'verano', 'todo_el_ano'))`. Decidido por Javier el 2026-10-13. El `default` hace que las agrupaciones existentes queden como "toda temporada" **sin ningún `UPDATE`** (la migración no lo admite y además sería inventar una clasificación): es el valor neutro, al que ningún periodo de alcance `invierno` afecta. La edita el planner desde M3 (`editarAgrupacionSchema` y `crearAgrupacionSchema` suman el campo; `GET` lo devuelve junto con `temporada_sugerida`) y desde la pantalla de M6 con el mismo `PATCH` |

Por qué una columna con tres valores y no la casilla booleana de la primera versión de esta ficha: es lo que Javier pidió, y además describe la agrupación (sirve a M7 y M8 para agrupar el plan por temporada) en vez de describir su relación con un evento. Por qué no una tabla `periodo_atipico_agrupacion`: el alcance del periodo (`invierno` / `todas`) más la temporada de la agrupación cubren los casos conocidos; si algún día un evento afectara a un conjunto arbitrario de agrupaciones, se añade la tabla y el alcance `seleccionadas`; no se reserva ahora (mismo criterio que `tallas` y `equivalencia_marca`). Los valores van en minúsculas con guion bajo (son códigos, como `estado` en M5), distintos de los de `lineas.temporada` (`Verano` / `Invierno` / `Todo el año`, etiquetas de M1); `temporadaDeLinea()` traduce al sugerir.

### `periodos_atipicos`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | |
| `desde` | `date not null` | primer día del mes; `check (extract(day from desde) = 1)` |
| `hasta` | `date not null` | primer día del último mes incluido; `check (extract(day from hasta) = 1)` y `check (hasta >= desde)` |
| `motivo` | `text not null` | `check (length between 1 and 120)`; se guarda con `trim`, sin pasar a mayúsculas (es una etiqueta, no un nombre de catálogo) |
| `descripcion` | `text null` | `check (length <= 500)` |
| `alcance` | `text not null default 'invierno'` | `check (alcance in ('invierno', 'todas'))`: `invierno` = solo agrupaciones con `temporada = 'invierno'`; `todas` = todas las agrupaciones |
| `activo`, `created_at`, `updated_at` | | trigger `set_updated_at`. Desactivar un periodo lo saca del cálculo sin perder el registro |

Sin únicos (dos periodos pueden solaparse; se toma la unión) y sin FKs. Índice `periodos_atipicos_desde_idx on (desde)` solo por orden de lectura. Sin seed: los meses del Niño los decide Javier (hito).

### Vista materializada `venta_mensual_estacionalidad` (agregado precalculado)

Decisión frente a "calcular al vuelo": una agregación completa de `venta_stock_vigente` cuesta 2 a 5 s en el compute Micro (M5). El cálculo de una corrida la necesita una vez; pero la pantalla (CV % por línea-mes, serie por tienda, serie por año de una agrupación) la necesitaría en cada clic, y M7 volverá a necesitar el mismo agregado. Por eso se **precalcula** en una vista materializada con un grano fino pero pequeño:

```
venta_mensual_estacionalidad (agrupacion_estacionalidad_id null, genero_id, linea_id, tienda_id, periodo,
                              unidades bigint, venta_soles numeric, costo_vendido numeric)
```

`select e.agrupacion_estacionalidad_id, n.genero_id, n.linea_id, v.tienda_id, v.periodo, sum(v.unidades), sum(v.venta_soles), sum(v.costo_vendido) from venta_stock_vigente v join equivalencias e … join genero_mundo_linea n … group by 1..5`. Tamaño: ≈ 50 agrupaciones × ~3 líneas × ~15 tiendas × 45 meses ≈ **100 mil filas, ~10 MB**, frente a 1,5 millones. `agrupacion_estacionalidad_id` es nullable a propósito: la venta de equivalencias sin agrupación aparece como `null` y la pantalla la reporta ("N unidades sin agrupación: completa M3"). El stock no entra (es de M8). Índices: `(agrupacion_estacionalidad_id, periodo)` y `(linea_id, periodo)`. Sin `id`, `activo` ni `updated_at` (es derivada e inmutable entre refrescos; misma excepción documentada que la tabla de hechos de M5).

**Seguridad.** Una vista materializada no admite `enable row level security` ni `security_invoker`, así que con PostgREST quedaría legible por `anon` y `authenticated`. La migración hace `revoke all on venta_mensual_estacionalidad from public, anon, authenticated` y `grant select to service_role`. Es la primera excepción a "RLS activo sin políticas" y va como decisión nueva propuesta (abajo); la alternativa (una tabla normal rellenada por corrida con `insert … select` y limpiada por handler, como las cargas de M5) se descartó por duplicar 10 MB por corrida y por repetir el mecanismo de limpieza para un dato que es puramente derivado.

**Refresco.** Función `refrescar_venta_mensual_estacionalidad() returns jsonb` (`security definer`, `set search_path = ''`, `revoke execute from public, anon, authenticated`, `grant to service_role`) que hace `refresh materialized view public.venta_mensual_estacionalidad` (no `concurrently`: no hay otra sesión leyéndola al mismo tiempo y evita exigir un índice único) y devuelve `{ filas, duracion_ms, refrescada_at }`. `refresh materialized view` no es `DROP`/`DELETE`/`TRUNCATE`, así que cabe en la migración (M5 ya lo anotó). La vista se crea `with no data` y el primer `calcular` la llena. **Quién la refresca**: `POST /api/curvas/calcular` siempre, antes de leer (la asignación equivalencia → agrupación de M3 puede haber cambiado, y M5 puede haber publicado meses nuevos); M5 **no** se toca. `GET /api/curvas` muestra `agregado_refrescado_at` (guardado en la corrida) y, comparándolo con el `publicada_at` más reciente de las cargas y con el `updated_at` más reciente de `equivalencias`, avisa "hay datos más nuevos que la última corrida". Si el piloto de M5 midiera que el refresco supera el `statement_timeout` del `service_role`, la salida es subir el compute o partir la vista por año; se decide con la medición (riesgo).

### `corridas_estacionalidad` (una fila por cálculo)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `hasta_periodo` | `date not null` | último mes usado (primer día del mes) |
| `parametros` | `jsonb not null` | `Parametros` de la corrida (medida, tiendas completas, huecos, umbrales) |
| `resultado` | `jsonb not null` | la salida por agrupación (arriba), ≈ 5 KB por agrupación, ≈ 250 KB en total; `check (pg_column_size(resultado) < 4_000_000)` |
| `resumen` | `jsonb not null` | conteos: agrupaciones calculadas, con curva propia, prestadas, sin venta, con avisos, años utilizables por clase, `agregado_refrescado_at`, `duracion_ms`, `meses_publicados` (`desde`, `hasta`, faltantes) |
| `perfil_id` | `uuid null references perfiles(id) on delete set null` | índice; `usuario_nombre text null` como en M5 |
| `activo`, `created_at`, `updated_at` | | `activo` por convención; una corrida no se edita |

Índice `(created_at desc)`. Las corridas no se borran desde la API (son el historial de "qué vio el planner cuando eligió"); si algún día pesan, un handler de limpieza como el de M5.

### `curvas_estacionalidad` (la curva elegida, versionada)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `agrupacion_estacionalidad_id` | `uuid not null references agrupaciones_estacionalidad(id) on delete restrict` | índice |
| `version` | `integer not null` | 1, 2, 3… por agrupación; único `(agrupacion_estacionalidad_id, version)` |
| `estado` | `text not null default 'vigente'` | `check (estado in ('vigente', 'reemplazada', 'retirada'))`; **único parcial `(agrupacion_estacionalidad_id) where estado = 'vigente'`**: a lo sumo una curva vigente por agrupación, la garantía que M7 necesita |
| `corrida_id` | `uuid not null references corridas_estacionalidad(id) on delete restrict` | de qué corrida salió |
| `modelo` | `text not null` | código de la candidata (`A`…`H`); `check (length between 1 and 10)` |
| `origen` | `text not null` | `check (origen in ('propia', 'prestada'))` |
| `recomendada` | `boolean not null` | si era la recomendada de la corrida al elegirla (auditoría: cuántas veces el planner se apartó del modelo) |
| `eat`, `error_max` | `numeric(6,2) null` | del backtesting; `null` sin validación |
| `anios_utilizados` | `jsonb not null` | `[{ anio, clase }]` |
| `p01` … `p12` | `numeric(8,6) not null` | participación de cada mes como fracción; `check (p between 0 and 1)` en cada una y `check (abs(p01 + … + p12 - 1) < 0.0001)` |
| `medida` | `text not null` | `check (medida in ('unidades', 'venta_soles'))`: la medida con la que M7 debe interpretarla |
| `perfil_id` | `uuid null references perfiles(id) on delete set null`, `usuario_nombre text null`, `aprobada_at timestamptz not null default now()` | quién la eligió |
| `nota` | `text null` | `check (length <= 300)`: por qué se eligió una distinta de la recomendada (opcional) |
| `activo`, `created_at`, `updated_at` | | |

Doce columnas y no `jsonb` ni una tabla hija de 12 filas: M7 hará `join curvas_estacionalidad … where estado = 'vigente'` y leerá `p01..p12` sin desempaquetar nada, el `check` de la suma vive en la base, y la tabla se lee a ojo en el SQL Editor. `on delete restrict` desde la agrupación: una agrupación con curvas no se elimina (M3 ya exige que no tenga equivalencias; esto añade "ni curvas"), se desactiva; el `409` lo traduce `errores-db.ts` ("No se puede eliminar la agrupación de estacionalidad: tiene curvas. Desactívala.").

Transiciones: `vigente → reemplazada` (se elige otra: por el único parcial, **primero la anterior pasa a `reemplazada` y después se inserta la nueva `vigente` con `version + 1`**, al revés que en M5, donde la función SQL hace los dos `update` en una transacción; aquí no hay transacción, así que si el `insert` falla la agrupación queda sin curva vigente, la pantalla lo muestra como "Sin curva" y repetir la elección lo arregla), `vigente → retirada` (el planner retira la curva; M7 deja de ver la agrupación). No hay otras. No hay `vigente` sin corrida.

### Diagrama

```
periodos_atipicos (desde, hasta, motivo, alcance) ─┐
agrupaciones_estacionalidad.temporada (invierno…) ─┼─► POST /api/curvas/calcular ─► corridas_estacionalidad.resultado (candidatas por agrupación)
venta_stock_vigente ─► [refresh] venta_mensual_estacionalidad (MV) ─┘                              │ el planner elige / aprueba en bloque
tiendas (apertura, cierre: red comparable) ─────────┘                                               ▼
                                                                   curvas_estacionalidad (una `vigente` por agrupación, versionada) ─► M7
```

## Contratos de API

Convenciones de M1 a M5: `{ data }` con `ok()` y `{ error }` con `error()` (`src/lib/api/respuestas.ts`), cuerpos con `leerCuerpo` y esquemas zod en `src/lib/curvas/esquemas.ts`, `idDeRuta` en todo `[id]`, `traducirErrorDb`, lecturas de tablas pequeñas con `leerTodo`. **Todas las rutas de M6, lecturas incluidas, exigen `requirePlanner`**: las curvas se calculan sobre venta y costo (el CV % es margen) y el criterio es el de M5 (decisión del 2026-10-11). Handlers en `src/app/api/curvas/` y `src/app/api/periodos-atipicos/`; lógica pura en `src/lib/curvas/` (`modelo.ts`, `candidatas.ts`, `backtesting.ts`, `atipicos.ts`, `liquidacion.ts`, `anios.ts`, `reglas.ts`, `esquemas.ts`, `tipos.ts`, `tipos-api.ts`), acceso a datos en `consultas.ts` (el único archivo de `src/` que nombra `venta_mensual_estacionalidad`). Errores comunes: `401` sin sesión · `403` sin perfil, inactivo o comprador · `400` zod · `404` id inexistente o no UUID · `409` regla de negocio, único o FK · `500` genérico.

Constantes (`src/lib/curvas/tipos.ts`): `MAX_MESES_HUECO = 4`, `UMBRAL_FORMA = 3` (puntos), `TEMPORADAS_AGRUPACION = ["invierno", "verano", "todo_el_ano"]`, `ALCANCES_PERIODO = ["invierno", "todas"]`, `UMBRAL_LIQUIDACION = 0.15`, `MIN_UNIDADES_ANO = 120`, `MIN_MESES_VALIDACION_PARCIAL = 6`, `EMPATE_EAT = 0.05`, `MODELOS` (catálogo de candidatas con su orden de desempate).

### Periodos atípicos

| Ruta | Método | Cuerpo | Respuesta |
|---|---|---|---|
| `/api/periodos-atipicos` | GET | — | `periodos[]` por `desde`, con `meses: number` (cuántos cubre) y `agrupaciones_afectadas: number` (con alcance `invierno`: cuántas agrupaciones activas tienen `temporada = 'invierno'`; con `todas`: todas las activas). `?incluir_inactivos=1` |
| `/api/periodos-atipicos` | POST | `crearPeriodoAtipicoSchema` | `201` fila creada. `400` zod (`hasta < desde`, mes mal formado) |
| `/api/periodos-atipicos/[id]` | PATCH | `editarPeriodoAtipicoSchema` | fila; `404`; `400` si el rango resultante queda invertido (se valida contra la fila actual con `rangoValido`) |
| `/api/periodos-atipicos/[id]` | DELETE | — | `{ id }`. Eliminar está permitido siempre (nada cuelga: las corridas guardan copia de los meses atípicos que usaron) |

```ts
const mes = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);   // "2023-03"; el handler lo convierte a date con periodoADb de src/lib/ventas/periodo.ts
crearPeriodoAtipicoSchema = z.object({
  desde: mes, hasta: mes,
  motivo: z.string().trim().min(1).max(120),
  descripcion: z.string().trim().max(500).transform(v => v === "" ? null : v).nullable().optional(),
  alcance: z.enum(["invierno", "todas"]).default("invierno"),
}).refine(v => v.hasta >= v.desde, { message: "El mes final no puede ser anterior al inicial.", path: ["hasta"] });
editarPeriodoAtipicoSchema = z.object({ desde: mes, hasta: mes, motivo, descripcion, alcance, activo }).partial().refine(noVacio);
```

### Lectura para M7: qué años fueron atípicos (contrato estable)

Javier (2026-10-13): "al momento de proyectar unidades sí sirve saber si el año fue Niño o no". El catálogo de periodos atípicos no es solo un insumo de la curva: es **el dato que M7 lee** para saber, por año y por agrupación (o por temporada), si ese año fue de Niño y cuántos meses. Para que M7 no reimplemente la regla de alcance y temporada, M6 deja dos cosas que no cambiarán de forma:

1. **Función pura `claseDeAnio(anio, agrupacion, periodos, mesesPublicados)`** en `src/lib/curvas/atipicos.ts`, sobre `mesesAtipicos` (regla 6): devuelve `{ anio, clase: "normal" | "atipico", meses_atipicos: ["2023-03", "2023-04", "2023-05"], periodos: [{ id, motivo, alcance }], completo: boolean }`. `clase = "atipico"` si al menos un mes del año cae en un periodo activo que aplica a la agrupación (alcance `todas`, o `invierno` si la agrupación es de invierno); `completo` = los 12 meses están publicados en M5 (un año en curso o con meses sin cargar es `completo: false`, y sus meses atípicos pueden estar en el futuro: un periodo de 2026 declarado antes de cargar diciembre ya aparece). M7 la importa tal cual para (a) normalizar o descontar el volumen base de los años atípicos al proyectar unidades de invierno y (b) marcar en pantalla qué años fueron Niño junto a la base histórica.
2. **`GET /api/periodos-atipicos/anios`** (`requirePlanner`), con `?agrupacion_id=<uuid>` o `?temporada=invierno|verano|todo_el_ano` (por defecto `temporada=invierno`; `400` si vienen los dos o ninguno válido, `404` agrupación inexistente), y opcional `?desde=2023&hasta=2026` (por defecto, del primer mes publicado al último, más los años de periodos activos futuros):

```jsonc
{ "data": {
  "criterio": { "agrupacion_id": "…", "temporada": "invierno" },        // lo que se evaluó
  "anios": [
    { "anio": 2023, "clase": "atipico", "meses_atipicos": ["2023-03", "2023-04", "2023-05"], "completo": true,
      "periodos": [ { "id": "…", "motivo": "Niño costero 2023", "alcance": "invierno" } ],
      "ratio_volumen": 0.62 },                                           // de la última corrida, si existe y la agrupación tiene comparación; null si no (siempre null por temporada)
    { "anio": 2024, "clase": "normal", "meses_atipicos": [], "completo": true, "periodos": [], "ratio_volumen": null },
    { "anio": 2026, "clase": "atipico", "meses_atipicos": ["2026-03", "2026-04"], "completo": false, "periodos": [ … ], "ratio_volumen": null }
  ],
  "resumen": { "anios_atipicos": [2023, 2026], "anios_normales_completos": [2024, 2025] }
} }
```

Es la misma función aplicada a cada año; no lee la MV ni calcula nada. El contrato es estable: M7 puede depender de `anios[].clase`, `meses_atipicos`, `completo` y `ratio_volumen` sin que M6 los cambie; lo que M6 añada irá en campos nuevos. Disponible desde el paso 1 de la entrega (no necesita corridas; `ratio_volumen` es `null` hasta que haya una).

### Temporada de la agrupación (cambio en M3)

`POST /api/agrupaciones-estacionalidad` y `PATCH /api/agrupaciones-estacionalidad/[id]` (`requirePlanner`, existen) aceptan `temporada: z.enum(TEMPORADAS_AGRUPACION)` (en el `POST`, opcional con `default("todo_el_ano")`); `GET /api/agrupaciones-estacionalidad` y la lista plana de M3 devuelven `temporada` y `temporada_sugerida` (calculada en memoria con `temporadaSugerida(lineasDeSusEquivalencias)` sobre el estado del árbol que la lista plana ya carga; `todo_el_ano` sin equivalencias). El importador de M3 (`POST /api/estacionalidad/importar`) acepta una sexta columna opcional `temporada` (`Invierno` / `Verano` / `Todo el año` o sus códigos; vacía = `todo_el_ano`; otro valor → `temporada_invalida`) que solo aplica a las agrupaciones que crea; la previsualización la muestra en "Agrupaciones a crear". Sin ruta nueva: la pantalla de M6 llama al mismo `PATCH`. Cambiar la temporada **no** recalcula nada: la próxima corrida la usa, y `GET /api/curvas` avisa de que hay cambios posteriores a la última corrida (`temporadas_cambiadas`).

### Estado general

`GET /api/curvas`:

```jsonc
{ "data": {
  "datos": { "desde": "2023-01", "hasta": "2026-09", "meses_publicados": 45, "faltantes": [], "ultimo_mes_cerrado": "2026-09",
             "ultima_publicacion_at": "…", "ultima_asignacion_at": "…" },           // de cargas_venta_stock y equivalencias.updated_at
  "ultima_corrida": { "id": "…", "created_at": "…", "hasta_periodo": "2026-09", "parametros": { … }, "resumen": { … }, "desactualizada": true,
                      "motivos_desactualizada": ["cargas_nuevas", "asignaciones_cambiadas", "periodos_cambiados", "temporadas_cambiadas"] } | null,
  "agrupaciones": [
    { "id": "…", "nombre": "PANTALONES INVIERNO", "codigo": "…", "activo": true, "temporada": "invierno", "temporada_sugerida": "invierno", "generos": ["HOMBRE"],
      "equivalencias_activas": 140, "con_venta": true,
      "vigente": { "id": "…", "version": 2, "modelo": "A", "origen": "propia", "recomendada": true, "eat": 9.4, "medida": "unidades",
                   "aprobada_at": "…", "usuario_nombre": "Javier", "corrida_id": "…", "curva": [0.07, …] } | null,
      "propuesta": { "recomendada": "A", "eat": 8.9, "difiere_de_vigente": true, "veredicto_forma": "forma_estable", "avisos": ["un_solo_ano"] } | null   // de la última corrida
    } ],
  "periodos_atipicos": [ { "id": "…", "desde": "2023-03", "hasta": "2023-05", "motivo": "Niño costero 2023", "alcance": "invierno", "activo": true } ],
  "resumen": { "agrupaciones_activas": 48, "por_temporada": { "invierno": 14, "verano": 12, "todo_el_ano": 22 }, "temporada_sugerida_distinta": 3,
               "con_curva_vigente": 40, "sin_curva_con_venta": 6, "sin_venta": 2, "vigentes_prestadas": 3,
               "propuestas_distintas": 5, "inactivas_con_curva": 1, "unidades_sin_agrupacion": 1230,
               "forma": { "forma_estable": 9, "forma_cambia": 3, "sin_comparacion": 2 } }
} }
```

`desactualizada` es verdadero si, después de `ultima_corrida.created_at`, hubo una publicación en M5, cambió alguna asignación (`max(equivalencias.updated_at)`), cambió un periodo atípico o la temporada de una agrupación (`max(updated_at)` de esas tablas). Mientras no exista ninguna corrida (paso 1 de la entrega), `ultima_corrida` es `null`, `propuesta` es `null` en todas y el resto de la respuesta (temporadas, periodos, `por_temporada`) ya funciona. `difiere_de_vigente` compara la curva recomendada de la última corrida con la vigente: distinto modelo, o misma curva con `EAT` distinto en más de 0,5 puntos, o `max_m |Δp_m| > 0,005`. `unidades_sin_agrupacion` sale de la MV (filas con agrupación `null`) y enlaza a Faltantes de M3.

### Calcular

`POST /api/curvas/calcular`:

```ts
calcularSchema = z.object({
  hasta_periodo: mes.optional(),                                   // por defecto: min(último mes publicado, último mes cerrado en Lima)
  medida: z.enum(["unidades", "venta_soles"]).default("unidades"),
  solo_tiendas_completas: z.boolean().default(true),
  tratamiento_atipicos: z.enum(["auto", "incluir", "imputar", "descartar"]).default("auto"),
  umbral_forma: z.number().min(0.5).max(20).default(3),              // puntos porcentuales de EAT entre la curva con Niño y sin Niño
  max_meses_hueco: z.number().int().min(1).max(6).default(4),
  umbral_liquidacion: z.number().min(0.05).max(0.5).default(0.15),
  min_unidades_ano: z.number().int().min(0).default(120),
});
```

Pasos: (1) `refrescar_venta_mensual_estacionalidad()` (2 a 5 s); (2) lee la MV con `leerTodo` (≈ 100 pliegos de 1 000 filas; es una lectura paginada de una tabla pequeña, no una agregación repetida; si el piloto mide más de 3 s aquí, la lectura pasa a una función `setof` filtrada por agrupación en paralelo de 6, o la MV se reduce quitando `linea_id` y el CV por línea pasa a otra función), las agrupaciones con sus géneros y su temporada (M3), las líneas de sus equivalencias (para `temporada_sugerida`), las tiendas (M4), los periodos atípicos activos y las cargas publicadas; (3) `calcularCorrida(entrada, parametros)` (puro); (4) inserta la corrida; (5) responde `201 { corrida: { id, created_at, hasta_periodo, parametros, resumen } }` sin el `resultado` (se pide aparte). Errores: `409 sin_datos` si no hay ningún mes publicado; `409 hasta_periodo_sin_cargar` si el mes pedido no está publicado; `400` zod. Dos cálculos a la vez no chocan (cada uno inserta su corrida); el refresco de la MV se serializa en Postgres.

### Corridas

| Ruta | Método | Respuesta |
|---|---|---|
| `/api/curvas/corridas` | GET | las últimas 50 corridas sin `resultado` (`id`, `created_at`, `hasta_periodo`, `parametros`, `resumen`, `usuario_nombre`) |
| `/api/curvas/corridas/[id]` | GET | la corrida completa con `resultado` (≈ 250 KB) más `agrupaciones[]` (nombre, géneros, temporada, vigente) para que la pantalla no cruce nada |
| `/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` | GET | el detalle de una agrupación en esa corrida más lo que la corrida no guarda y sale de la MV: `por_tienda[]` (participación real por año de cada tienda, solo lectura, con `completa_en_anio`) y `cv_por_linea[]` (`linea`, `periodo`, `cv`, `unidades`, `venta_soles`), más `lineas[]` con su `temporada` de M1. `404` si la corrida o la agrupación no existen |

### Elegir, aprobar y retirar curvas

| Ruta | Método | Cuerpo | Respuesta |
|---|---|---|---|
| `/api/curvas/agrupaciones/[id]` | PUT | `elegirCurvaSchema` | `201 { curva }` (la nueva vigente, con `version`). `404` agrupación o corrida inexistente · `409` agrupación inactiva · `409` la candidata no existe o es `null` en esa corrida · `409 sin_cambio` si la vigente ya es esa misma curva (mismo `corrida_id` y `modelo`) |
| `/api/curvas/agrupaciones/[id]` | DELETE | — | retira la vigente: `{ id, estado: "retirada" }`; `404` si no hay vigente |
| `/api/curvas/aprobar` | POST | `aprobarSchema` | en bloque: `{ aprobadas, sin_cambio, omitidas: [{ id, motivo }] }`; `motivo`: `inactiva`, `sin_candidata`, `prestada_excluida`, `no_encontrada` |
| `/api/curvas/vigentes` | GET | — | lo que M7 leerá: `[{ agrupacion_id, codigo, nombre, version, modelo, origen, medida, curva: [12], aprobada_at }]` solo de agrupaciones activas; sirve también para el CSV de la pantalla |

```ts
elegirCurvaSchema = z.object({ corrida_id: uuid, modelo: z.enum(MODELOS.map(m => m.codigo)), nota: z.string().trim().max(300).optional() });
aprobarSchema = z.object({
  corrida_id: uuid,
  agrupacion_ids: z.array(uuid).min(1).max(500).optional(),      // sin lista: todas las agrupaciones activas de la corrida
  solo_sin_curva: z.boolean().default(false),                   // no toca las que ya tienen vigente
  incluir_prestadas: z.boolean().default(false),                // una curva del género solo se aprueba en bloque si se pide
});
```

`PUT` copia la curva de `corrida.resultado` (no la recalcula), escribe `recomendada = (modelo === recomendada de la corrida)`, `origen`, `eat`, `error_max`, `anios_utilizados`, `medida = parametros.medida` (para `H`, `venta_soles`), y hace la transición: `update … set estado = 'reemplazada' where agrupacion = $1 and estado = 'vigente'` y después `insert … version = max(version) + 1`. `aprobar` repite eso por agrupación con la recomendada; una agrupación cuya recomendada es prestada se omite salvo `incluir_prestadas`. `errores-db.ts` suma el único parcial (`curvas_estacionalidad_vigente_uniq` → `409 "Esa agrupación ya tiene una curva vigente; vuelve a cargar."`, la red de seguridad para una carrera entre dos planners) y la FK de la agrupación.

## Pantallas

Ruta nueva **`/planificacion/curvas-estacionalidad`**, item **"Curvas de estacionalidad"** en la sección Planificación de `src/lib/nav.ts` (`roles: PLANIFICACION`): la ven admin y planner con las mismas acciones; el comprador no la ve en el menú ni entra por URL (`page.tsx` redirige a `/` como `venta-stock/page.tsx`). En M3, el diálogo de alta y edición de la pestaña Agrupaciones suma el `Select` **Temporada** (Invierno / Verano / Toda temporada, con la sugerida indicada al lado: "Sugerida por sus líneas: Invierno"), la tabla una columna Temporada con badge y un aviso cuando difiere de la sugerida, la tarjeta del Mapa un chip de temporada, y el importador la columna opcional `TEMPORADA`; nada más cambia en M3.

**Entrega en dos pasos** (misma migración `0011`, para que Javier use el mantenimiento antes de que exista el cálculo, como pidió): **paso 1, `0.9.0 · M6`**: migración completa, temporada en M3, y la pantalla de M6 con la pestaña **Periodos atípicos** operativa y la pestaña Curvas mostrando solo la tabla de agrupaciones con su temporada (sin corrida, sin propuestas; la tarjeta Calcular dice "disponible en el siguiente paso"); hito parcial: los dos periodos del Niño cargados y las temporadas marcadas. **Paso 2, `0.9.1 · M6`**: la MV, el cálculo, el detalle, elegir y aprobar. Si el equipo prefiere una sola entrega, el orden de construcción es el mismo y el hito parcial se recorre igual.

Panel cliente `curvas-panel.tsx` con `Tabs`: **Curvas · Periodos atípicos · Corridas**. Encima, el resumen de `GET /api/curvas`: "48 agrupaciones activas · 40 con curva vigente · 6 sin curva con venta · 2 sin venta · 5 propuestas distintas de la vigente", un `Alert` ámbar si la última corrida está desactualizada ("Hay cargas nuevas / asignaciones cambiadas desde la última corrida: vuelve a calcular") y otro si hay unidades sin agrupación ("1 230 unidades de equivalencias sin agrupación no entran en ninguna curva", enlace a Faltantes de M3). El estado general se carga con `useColeccion`-like propio (`use-curvas.ts`, mismo patrón que `useResponsables`); cualquier escritura recarga.

### Pestaña Curvas

- **Tarjeta Calcular** (`Card`): parámetros con sus valores por defecto (hasta qué mes, medida, red comparable, tratamiento de los periodos atípicos: Automático / Incluir tal cual / Imputar / Descartar, umbral de "la forma no cambia" en puntos, máximo de huecos, umbral de liquidación, mínimo de unidades), vista previa "Se usarán 45 meses (2023-01 a 2026-09): 2023 · 2024 · 2025 completos, 2026 parcial (9 meses); periodos atípicos activos: Niño costero 2023 (mar–may, invierno); 14 agrupaciones de invierno", botón **Calcular** con avance ("Refrescando el agregado… · Calculando…"; 3 a 8 s) y, al terminar, "Corrida del 12/10/2026 10:42: 46 agrupaciones con curva propia, 2 prestadas, 2 sin venta". Mientras no haya ninguna corrida, la tabla de abajo muestra solo las vigentes y un `EmptyState` "Calcula para ver propuestas".
- **Filtros**: `Select` Género (de M3), `Chips` de temporada: Todas · Invierno (N) · Verano (N) · Toda temporada (N); `Chips` de estado: Todas (N) · Sin curva (N) · Propuesta distinta (N) · Con avisos (N) · Prestadas (N) · Forma cambia (N); buscador por nombre.
- **Tabla** (`DataTable`, orden alfabético con `compararPorNombre` de M3), una fila por agrupación activa (las inactivas con curva vigente aparecen al final, atenuadas, con el aviso):

| Columna | Contenido |
|---|---|
| Agrupación | nombre con su color de M3, chips de género, `Select` **Temporada** en línea (`PATCH` de M3; guarda al instante) con aviso "sugerida: Invierno" si difiere de la sugerida |
| Curva vigente | "v2 · A Promedio simple · EAT 9,4 · Javier, 10/10" o badge alerta "Sin curva"; "Prestada (género)" en tono alerta si `origen = prestada`; "Retirada" si la última versión está retirada |
| Propuesta (última corrida) | modelo recomendado y su EAT; badge "Distinta" si `difiere_de_vigente`; "Igual" si coincide; "—" sin corrida |
| Años | "2023 (Niño, incluido) · 2024 · 2025 · 2026 parcial" o "2023 (Niño, imputado)" con color por clase; "Sin datos" |
| Niño | veredicto de la comparación de forma: "Forma estable (1,8 pt)" / "Forma cambia (6,4 pt)" / "—" (solo agrupaciones con años de Niño) |
| Estabilidad | Alta / Media / Baja |
| Avisos | chips con los códigos de aviso (`title` con el detalle) |
| Mini curva | 12 barras en SVG (`mini-curva.tsx`, sin librerías): la vigente en sólido, la propuesta en contorno |
| Acciones | **Ver** (abre el detalle) · **Aprobar propuesta** (si hay corrida y difiere; `PUT` con la recomendada) · **Retirar** (si hay vigente; `confirm`) |

- **Barra de acción** con selección múltiple (checkbox por fila como en M3): "Aprobar recomendadas de N seleccionadas" con las casillas "Solo las que no tienen curva" e "Incluir prestadas"; `confirm` con el conteo; llama a `POST /api/curvas/aprobar` y muestra `aprobadas / sin_cambio / omitidas` con sus motivos.
- **Descargar curvas vigentes (CSV)** (`descargarCsv` con BOM, de `src/components/importador/csv.ts`): `AGRUPACION, CODIGO, VERSION, MODELO, ORIGEN, MEDIDA, ENE … DIC` en porcentaje con dos decimales, más `EAT` y `APROBADA`. Es lo que Javier compara contra su Excel.

### Detalle de una agrupación (panel lateral o ruta `?agrupacion=<id>`)

Carga `GET /api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` de la última corrida (o de la que se elija en Corridas).

1. **Cabecera**: nombre, géneros, `Select` Temporada editable con la sugerida al lado, líneas con su temporada de M1 (aviso si mezclan o si la sugerida difiere), equivalencias activas, unidades por año.
1b. **Efecto del Niño** (solo si la agrupación tiene años con huecos): dos mini curvas lado a lado, "Con los años de Niño incluidos" y "Sin ellos (imputados)", la diferencia por mes en puntos, el EAT total frente al umbral (editable aquí, se guarda en los parámetros de la próxima corrida), el veredicto en un badge ("El Niño no cambia la forma: se usan 2023 y 2026 tal cual" / "El Niño sí cambia la forma: 2023 se imputa") y, por año de Niño, el `ratio_volumen` ("los meses del Niño de 2023 vendieron un 38 % menos de lo esperado"), con la nota "el ajuste de volumen lo aplica M7".
2. **Gráfico de líneas** (SVG propio, `grafico-curva.tsx`): eje de 12 meses; una línea por año real (2023 con los meses imputados punteados y marcados "Niño"; 2026 parcial hasta septiembre), la **candidata seleccionada** en trazo grueso y la **vigente** en gris; los meses marcados en liquidación llevan un punto ámbar. Leyenda con casillas para mostrar u ocultar series. Sin dependencias: un `<svg>` con `<polyline>` y `<text>`.
3. **Tabla de candidatas**: una fila por modelo (`A`…`H`): nombre, descripción corta, EAT (backtesting, con el número de pliegues), error máximo mensual, EAT parcial (2026), badge **Recomendada**, "Igual a A" cuando coincide, "No disponible: motivo"; `radio` para seleccionar la que se dibuja; botón **Elegir esta curva** (con campo `nota` opcional si no es la recomendada; `confirm` "Reemplazará la v2 vigente"). Debajo, las 12 participaciones de la seleccionada y de la vigente en una tabla de dos filas, con la diferencia por mes en puntos.
4. **Tabla por año**: filas por año con clase y tratamiento (normal / Niño incluido / Niño imputado / descartado / en curso), unidades, venta, 12 participaciones reales (imputadas en cursiva), meses en liquidación, escaso.
5. **CV % por línea y mes**: tabla líneas × meses con el CV % y resaltado de los meses de liquidación; `Switch` para ver unidades o venta en vez del CV.
6. **Por tienda** (plegado): participación real por año de cada tienda y si entró en la red comparable ese año. Solo lectura: no hay curvas por tienda en M6.

### Pestaña Periodos atípicos

Es el **mantenimiento que pidió Javier** y el primer entregable (paso 1): funciona sin corridas ni MV. `CatalogoPlano`-like simple (formulario arriba, tabla abajo): desde (mes), hasta (mes), motivo, descripción, alcance (`Select`: "Solo agrupaciones de invierno" / "Todas las agrupaciones"), con vista previa "3 meses · afecta a 14 agrupaciones de invierno". Un `EmptyState` inicial guía los dos altas esperados: "Niño costero 2023 (propuesta: marzo a mayo, confirmar con planeamiento)" y "Niño costero 2026 (meses por definir)", con el botón "Crear" prellenado para el primero (nada se guarda hasta pulsar Crear). Tabla: rango, meses, motivo, alcance, agrupaciones afectadas, estado, Editar / Desactivar / Eliminar. Encima de la tabla, una tarjeta de ayuda **"Años marcados como atípicos"**, alimentada por `GET /api/periodos-atipicos/anios?temporada=invierno`: "2023 (Niño costero 2023: mar–may, invierno) · 2026 (Niño costero 2026: meses por definir)", con los años normales completos al lado ("Normales completos: 2024, 2025") y la nota "M7 usa esta lista al proyectar unidades de invierno". Validación en pantalla: el mes final no anterior al inicial; aviso si el rango incluye meses no cargados ("2026-10 a 2026-12 todavía no están cargados: el periodo aplicará cuando lo estén"). Pie: "Cambiar un periodo no recalcula nada: vuelve a calcular en la pestaña Curvas". Un enlace "Marcar la temporada de las agrupaciones" lleva a la pestaña Curvas con el filtro de temporada y un aviso con cuántas agrupaciones siguen como "Toda temporada" con sugerida Invierno.

### Pestaña Corridas

Lista de corridas (`fecha · usuario · hasta · parámetros resumidos · agrupaciones propias / prestadas / sin venta · duración`), con **Ver** (abre la pestaña Curvas con esa corrida como "propuesta", marcada "corrida antigua") y la última resaltada. No se eliminan.

## Reglas de negocio

Funciones puras en `src/lib/curvas/`, probadas en `tests/curvas.*.test.ts` con fixtures sintéticos (`tests/curvas.fixture.ts`). Todas son de vitest salvo la 30 (SQL, script de humo local) y la 31 (test estático).

**`anios.ts`**

1. `clasificarAnio(anio, mesesPublicados, atipicosQueAplican, maxHuecos)`: 12 meses publicados y 0 atípicos → `normal`; 1 a `maxHuecos` atípicos → `con_huecos` con la lista; más → `descartado` (`motivo: demasiados_huecos`); algún mes sin publicar → `incompleto` (`meses_sin_cargar`); el año de `hasta_periodo` con menos de 12 meses → `en_curso`.
2. `participacion(meses)`: `[10, 20, 30, 40, 0, …]` → `[0.1, 0.2, 0.3, 0.4, 0, …]`; suma exactamente 1 tras `normalizarCurva`; todo cero → `null` (`sin_volumen`); un mes negativo se trunca a 0 y se reporta (`mes_negativo`).
3. `normalizarCurva(v)`: divide por la suma, redondea a 6 decimales y ajusta el mes mayor para que la suma sea 1,000000 exacta; `normalizarCurva(normalizarCurva(v)) === normalizarCurva(v)`.
4. `tiendasCompletas(tiendas, anio)`: Tienda con apertura `≤ aaaa-01-01` y cierre nulo o `≥ aaaa-12-31` → entra; apertura en julio → no entra ese año y sí el siguiente; cierre el 31/12 → entra ese año; sin apertura → entra con aviso `tienda_sin_apertura`; CD → nunca. Con `solo_tiendas_completas = false` entran todas las de tipo Tienda.
5. `hastaPorDefecto(mesesPublicados, hoyLima)`: el último mes publicado que además es cerrado (`esMesCerrado`); con `2026-10` publicado y hoy `2026-10-12` → `2026-09`.

**`atipicos.ts`**

6. `mesesAtipicos(periodos, agrupacion)`: la unión de los rangos activos cuyo alcance aplica (`todas`, o `invierno` si `agrupacion.temporada === "invierno"`; una agrupación `verano` o `todo_el_ano` no recibe los de alcance `invierno`); un periodo inactivo no aplica; dos periodos solapados cuentan cada mes una vez; `desde = hasta` es un mes.
6b. `claseDeAnio(anio, agrupacion, periodos, mesesPublicados)`: sin meses atípicos → `normal`; con uno o más → `atipico` con la lista ordenada y los periodos que los cubren; `completo` solo con los 12 meses publicados; un periodo activo con meses futuros (2026-03 a 2026-05 con solo enero y febrero de 2026 publicados) da `atipico` y `completo: false`; una agrupación de verano con un periodo de alcance `invierno` da `normal`; un periodo inactivo no cuenta. Es la función que M7 importa; un test fija su forma de salida (claves y tipos) como contrato.
7. `imputarHuecos(medidas, A, r)`: devuelve una curva que suma 1; los meses de `A` valen exactamente `r_m`; los demás conservan sus proporciones relativas entre sí (`p_i / p_j = medida_i / medida_j`); con `A` vacío coincide con `participacion(medidas)`; sin referencia (`r = null`) devuelve `null`.
8. `referencia(aniosNormales)`: promedio simple de sus participaciones; sin años normales → `null` (y bajo `imputar` el año con huecos pasa a `descartado` con motivo `sin_referencia`; bajo `auto`, entra `incluido` con aviso `sin_referencia`).
8b. `compararForma(aniosNormales, aniosConHuecos, umbral)`: `c_inc` = `A` con todos tal cual, `c_sin` = `A` con los de huecos imputados; `diferencia_forma = eat(c_inc, c_sin)`; veredicto `forma_estable` si `< umbral`, `forma_cambia` si no, `sin_comparacion` sin alguna de las dos listas; un año de Niño que es el año normal multiplicado por una constante (solo volumen) da diferencia 0 y `forma_estable`; uno con los meses atípicos hundidos da `forma_cambia` con el umbral por defecto.
8c. `tratamientoEfectivo(parametro, veredicto)`: `incluir`/`imputar`/`descartar` se respetan; `auto` → `incluir` con `forma_estable`, `imputar` con `forma_cambia`, `incluir` + aviso con `sin_comparacion`.
8d. `ratioVolumen(medidas, A, r)`: `Σ_{A} medidas ÷ (Σ_{no A} medidas × R_A ÷ (1 − R_A))`; año proporcional a la referencia → 1; meses atípicos al 40 % → 0,4; `R_A = 0` o sin meses normales → `null`.
8e. `temporadaSugerida(lineas)`: mayoritaria por conteo entre `Invierno` / `Verano` / `Todo el año` traducida a códigos; empate o lista vacía → `todo_el_ano`; `temporadaDeLinea("Todo el año") === "todo_el_ano"`.

**`liquidacion.ts`**

9. `mesesEnLiquidacion(cvMensual, atipicos, umbral)`: mediana sobre los meses no atípicos del año; un mes con `cv > mediana × (1 + umbral)` se marca; con `cv` nulo (venta 0) no se marca; con menos de 3 meses válidos no se marca ninguno.
10. `unidadesAPrecioNormal(unidades, venta, marcados)`: `precio_normal = Σ venta_no_marcados ÷ Σ unidades_no_marcados`; un mes marcado pasa a `venta_m ÷ precio_normal`; los no marcados no cambian; con todos marcados o `precio_normal ≤ 0` devuelve las unidades sin cambio y el aviso `sin_precio_normal`. Un mes marcado con precio medio 30 % más bajo queda con un 30 % menos de unidades.
11. `cvMensual(venta, costo)`: `costo ÷ venta` redondeado a 4 decimales; venta 0 → `null`; nunca se calcula por fila ni por marca (solo recibe agregados).

**`candidatas.ts`**

12. Cada candidata devuelve una curva que suma 1 o `null` con motivo. `A` con un año = ese año; `A` con `[p, q]` = `(p + q) / 2` renormalizado; `B` con dos años de 100 y 300 unidades da pesos 1:3; `C` con tres años da pesos 1:2:3; `D` aplicada a una curva plana la deja plana y a un pico aislado `[0, 1, 0, …]` lo reparte `[0.25, 0.5, 0.25, …]`; `D` trata diciembre y enero como vecinos; `F` sin años del género → `null`; `G` sin meses marcados coincide con `A`; `H` con medida `venta_soles` se marca `igual_a: "A"`.
13. El catálogo `MODELOS` tiene los siete códigos únicos, en el orden de desempate `A, B, C, D, G, H, F`, cada uno con nombre y descripción no vacíos (test estático sobre la constante).

**`backtesting.ts`**

14. `eat(curva, real)` = `Σ |ĉ − p| × 100`; dos curvas iguales → 0; `[1, 0, …]` contra `[0, 1, …]` → 200. `errorMax` es el máximo por mes en puntos.
15. `pliegues(anios)`: con `n` años utilizables hay `n` pliegues de entrenamiento `n − 1`; con 1 año, cero pliegues; cada pliegue entrena **sin** el año de prueba (test: la candidata `A` en el pliegue de 2025 no contiene datos de 2025).
16. El real de cada pliegue es la participación en **unidades** del año de prueba, aunque la medida de la corrida o la candidata sea otra.
17. `validacionParcial(curva, mesesEnCurso, atipicos)`: renormaliza ambos sobre los meses cargados no atípicos; con menos de `MIN_MESES_VALIDACION_PARCIAL` devuelve `null`; una curva idéntica a la parcial da 0.

**`modelo.ts`**

18. `recomendar(candidatas)`: la de menor EAT; empate dentro de `EMPATE_EAT` → la primera en el orden del catálogo; sin candidatas con backtesting → `A` con `sin_validacion`; sin `A` → `F` con `origen = prestada`; sin ninguna → `null` y aviso `sin_anos_utilizables`.
19. `estabilidad(anios)`: años idénticos → 1; con un año → `null`; acotada a `[0, 1]`.
20. `calcularCorrida(entrada, parametros)` es determinista (misma entrada, mismo resultado, con las curvas a 6 decimales) y nunca usa el año en curso en el ajuste de ninguna candidata (test: cambiar los meses de 2026 no cambia ninguna `curva`, solo `eat_parcial`).
21. Avisos: cada código de aviso se emite exactamente en su condición (un test por código) y una agrupación sin venta sale con `sin_venta` y sin candidatas.
22. Una agrupación de **invierno** con un periodo de alcance `invierno` clasifica ese año como `con_huecos`; una de **verano** o **toda temporada** con el mismo periodo lo clasifica `normal`; un periodo de alcance `todas` afecta a las tres. Con `auto` y `forma_estable`, el año con huecos entra en `anios_utilizables` como `incluido` y las candidatas lo usan tal cual (test: `A` coincide con el promedio de los tres años sin imputar).
23. El resultado de una corrida respeta la identidad `agrupaciones_activas = propias + prestadas + sin_venta` en `resumen`.

**`reglas.ts` (elegir y aprobar)**

24. `motivoRechazoElegir(agrupacion, corrida, modelo)`: agrupación inactiva → `409`; corrida inexistente → `404`; la candidata no está en el resultado o es `null` → `409 candidata_no_disponible`; vigente con misma corrida y modelo → `409 sin_cambio`; si no, `null`.
25. `filaCurva(resultado, modelo, parametros, perfil)` copia la curva, `recomendada = (modelo === recomendada)`, `origen = modelo === "F" ? "prestada" : "propia"`, `medida = modelo === "H" ? "venta_soles" : parametros.medida`, `eat`/`error_max` o `null` sin validación, y `version = anterior + 1` (1 sin anterior).
26. `planificarAprobacion(agrupaciones, corrida, opciones)`: omite inactivas, sin candidata, prestadas (salvo `incluir_prestadas`) y, con `solo_sin_curva`, las que tienen vigente; cuenta `sin_cambio` las que ya tienen esa curva; `aprobadas + sin_cambio + omitidas = recibidas`.
27. `difiereDeVigente(propuesta, vigente)`: modelo distinto → verdadero; mismo modelo con `max |Δp| > 0,005` o `|ΔEAT| > 0,5` → verdadero; si no, falso; sin vigente → verdadero.
28. `motivosDesactualizada(corrida, fechas)`: cada uno de los cuatro motivos (`cargas_nuevas`, `asignaciones_cambiadas`, `periodos_cambiados`, `temporadas_cambiadas`) se emite solo si su fecha es posterior a `corrida.created_at`.

**`esquemas.ts`**

29. `calcularSchema` aplica los valores por defecto (`tratamiento_atipicos = "auto"`, `umbral_forma = 3`) y rechaza `umbral_liquidacion` fuera de `[0,05, 0,5]`, `umbral_forma` fuera de `[0,5, 20]` y `max_meses_hueco` fuera de `[1, 6]`; `crearPeriodoAtipicoSchema` rechaza `hasta < desde`, meses mal formados (`2023-13`, `2023-3`) y un alcance distinto de `invierno` / `todas`; el esquema de agrupaciones de M3 rechaza una `temporada` fuera de los tres valores y el importador de M3 omite con `temporada_invalida`; `elegirCurvaSchema` rechaza un modelo fuera del catálogo; `aprobarSchema` rechaza más de 500 ids.

**SQL y estático**

30. **SQL (script de humo local)**: `0011` aplica dos veces sin error y sin `DROP`/`DELETE`/`TRUNCATE`; la MV existe y `refrescar_venta_mensual_estacionalidad()` la llena con las sumas correctas de un juego de hechos sintéticos (dos cargas del mismo mes, una `reemplazada`: solo cuenta la `publicada`); una equivalencia sin agrupación aparece con `agrupacion_estacionalidad_id null`; `anon` no puede leer la MV (error de permiso, no cero filas: no hay RLS en una MV) ni ejecutar la función; dos filas `vigente` para la misma agrupación chocan con el único parcial; el `check` de la suma rechaza una curva que suma 0,98; `temporada` existe en `agrupaciones_estacionalidad` con `default 'todo_el_ano'`, una fila insertada antes de la migración la tiene sin `UPDATE`, y el `check` rechaza `'otono'`; `periodos_atipicos.alcance` rechaza `'afectadas'`.
31. **Estático**: solo `src/lib/curvas/consultas.ts` menciona `venta_mensual_estacionalidad` y `refrescar_venta_mensual_estacionalidad`; ningún archivo de `src/lib/curvas/` importa de `src/components/`; ninguna ruta de M6 usa un guard distinto de `requirePlanner`; `src/lib/curvas/modelo.ts` no importa nada de `@supabase/*`.

## Casos de prueba sintéticos

Fixture `tests/curvas.fixture.ts`, con dos agrupaciones inventadas y cifras redondas (nada real de Lukers). Las cifras de 2024 y 2025 son las de la tabla; 2023 es la misma forma que 2024 con marzo a mayo **hundidos al 40 %** (simula el Niño) y 2026 trae enero a septiembre iguales a 2025.

| Agrupación | Temporada | Ene | Feb | Mar | Abr | May | Jun | Jul | Ago | Set | Oct | Nov | Dic | Total 2024 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ABRIGO SINTÉTICO | invierno | 20 | 20 | 60 | 120 | 200 | 240 | 160 | 80 | 40 | 20 | 20 | 20 | 1 000 |
| VERANO SINTÉTICO | verano | 180 | 140 | 80 | 40 | 20 | 20 | 20 | 40 | 60 | 100 | 140 | 160 | 1 000 |

2025 = 2024 × 1,2 en todos los meses (misma participación) salvo diciembre de ABRIGO, que vale 60 (liquidación: CV % de diciembre 0,70 frente a mediana 0,50). Periodo atípico: `2023-03 a 2023-05`, alcance `invierno`. Fixture alternativo **"solo volumen"**: 2023 = 2024 × 0,7 en los doce meses. Tiendas: T1 abierta desde 2020; T2 abre el 2024-07-01 (toda la venta de la tabla es de T1; T2 añade 10 unidades por mes desde julio de 2024). Casos esperados:

1. **Clasificación de años**: ABRIGO → 2023 `con_huecos` (3), 2024 y 2025 `normal`, 2026 `en_curso` (9 meses). VERANO → 2023 `normal` (es de verano y el alcance es `invierno`), resto igual. Con el mismo periodo en alcance `todas`, VERANO también tiene 2023 `con_huecos`.
1b. **Comparación de forma de ABRIGO** (fixture base, marzo–mayo al 40 %): `diferencia_forma` ≈ 9 puntos > 3 → `forma_cambia`; con `auto`, 2023 entra `imputado`; `ratio_volumen(2023) = 0,4`. Con el fixture "solo volumen": `diferencia_forma = 0` → `forma_estable`; con `auto`, 2023 entra `incluido`, `anios_utilizables = [2023, 2024, 2025]` y `A` es el promedio de los tres sin imputar; `ratio_volumen(2023) = 1`. VERANO no tiene comparación (`null`). Con `umbral_forma = 12` el fixture base pasa a `forma_estable`.
2. **Participación 2024 de ABRIGO** = `[0.02, 0.02, 0.06, 0.12, 0.20, 0.24, 0.16, 0.08, 0.04, 0.02, 0.02, 0.02]` con `solo_tiendas_completas = true` (T2 no entra en 2024); con `false`, septiembre a diciembre suben (T2 aporta 60 unidades en el segundo semestre) y la curva se desplaza a la derecha: el test comprueba `p_12(false) > p_12(true)`.
3. **Imputación de 2023 en ABRIGO** (fixture base, `tratamiento_atipicos = 'imputar'` o `auto`): `r` = promedio de 2024 y 2025 (coinciden salvo diciembre); los meses 3–5 imputados valen `r_3, r_4, r_5`; los demás conservan la forma de 2024; la suma es 1. Con `'descartar'`, 2023 no entra y `anios_utilizables = [2024, 2025]`; con `'incluir'`, entra tal cual (marzo–mayo hundidos) y `A` baja en esos meses.
4. **Candidatas de VERANO** (tres años normales, idénticos en forma): `A = B = C =` la participación de 2024; `D` difiere (suaviza enero); `F` es la curva del género (si ambas agrupaciones comparten género, una mezcla de las dos formas); EAT de `A` en backtesting = 0 (los años son idénticos) → recomendada `A` por orden; estabilidad = 1.
5. **ABRIGO con liquidación**: `mesesEnLiquidacion(2025)` marca diciembre; `G` baja diciembre de 2025 (`60 × (precio dic / precio normal)` → 60 × 0,714 ≈ 43 unidades) y el EAT de `G` contra el real de 2025 (que incluye la liquidación) es **mayor** que el de `A`: la recomendación sigue siendo `A`. Con un fixture alternativo donde la liquidación de diciembre aparece en 2024 y no en 2025, `G` obtiene menor EAT y pasa a recomendada. Los dos casos están en el test.
6. **Validación parcial** de VERANO con 2026 (ene–sep iguales a 2025): EAT parcial de `A` = 0; para ABRIGO, con un periodo `2026-03 a 2026-05` añadido, la validación usa 6 meses (`9 − 3`) y sigue siendo válida; con `2026-02 a 2026-06` usa 4 y devuelve `null`.
7. **Pocos años**: quitando 2024 y 2025 del fixture, ABRIGO queda sin año normal: con `imputar` → 2023 `descartado` por `sin_referencia`, `sin_anos_utilizables`, recomendada `F` con `origen = prestada`; con `auto` → `sin_comparacion`, 2023 entra `incluido` con el aviso `sin_referencia` y `A` = 2023 con `sin_validacion`. VERANO con solo 2023 → `A` = 2023 con `sin_validacion`.
7b. **Temporada sugerida**: ABRIGO con todas sus líneas de `Invierno` y `temporada = 'todo_el_ano'` → aviso `temporada_sugerida_distinta` (sugerida `invierno`); con dos líneas `Invierno` y una `Todo el año` → sugerida `invierno`; con una y una → `todo_el_ano`.
8. **Aprobación en bloque** sobre el fixture: `solo_sin_curva` con ABRIGO ya vigente → `aprobadas = 1 (VERANO), sin_cambio = 0, omitidas = 1 (ABRIGO: con_curva)`; `incluir_prestadas = false` omite la ABRIGO del caso 7.
9. **Determinismo e independencia del año en curso**: cambiar las cifras de 2026 no cambia ninguna `curva` de ninguna candidata ni el veredicto de forma (2026 es año en curso: no entra en `c_inc` ni en `c_sin` hasta que esté completo).

## Criterios de aceptación / hito de prueba

`[x]` lo cubren los checks automáticos y la QA; `[ ]` lo recorre Javier con la base real (histórico completo de M5 cargado) o, si M5 aún no terminó, con septiembre de 2026 y el año 2025 como mínimo.

**Automático**

- [ ] `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (los de M0 a M5 y las mejoras 05b, 05c y 02b más `tests/curvas.*`, con los casos sintéticos), `npm run build` y `scripts/validar-migraciones-local.sh` (todas las migraciones dos veces) en verde.
- [ ] `0011_curvas_estacionalidad.sql` aplicada en `vector-two` sin `DROP`, `DELETE` ni `TRUNCATE`; tipos regenerados (la MV bajo `Views`, la función bajo `Functions`); `APP_VERSION` = `0.9.0 · M6` (paso 1) y `0.9.1 · M6` (paso 2).

**Prerrequisitos de Javier**

- [ ] Faltantes de M3 en cero (o aceptar que las unidades sin agrupación queden fuera y se vean en el aviso).
- [ ] Fechas de apertura y cierre de las tiendas en M4 (sin ellas, la red comparable no filtra y la pantalla avisa `tienda_sin_apertura`).

**Hito del paso 1 (mantenimiento, `0.9.0 · M6`)**

- [ ] La pestaña Periodos atípicos abre sin ninguna corrida ni MV; Javier crea "Niño costero 2023" (meses confirmados con planeamiento; propuesta marzo a mayo) con alcance "Solo agrupaciones de invierno" y "Niño costero 2026" con los meses que defina (si todavía no los sabe, lo crea cuando los tenga: nada bloquea); editar, desactivar y eliminar funcionan; `hasta` anterior a `desde` se rechaza.
- [ ] En M3, cada agrupación muestra su Temporada (todas nacen "Toda temporada") y la sugerida por sus líneas; Javier marca las de invierno y las de verano desde M3 o desde la tabla de M6 hasta que ninguna con sugerida Invierno quede en "Toda temporada" sin decisión (el aviso cuenta cuántas quedan); el importador de M3 con la columna `TEMPORADA` crea agrupaciones nuevas con ella y no cambia las existentes.
- [ ] `GET /api/curvas` responde con `por_temporada` y los periodos; `ultima_corrida` es `null` y la pestaña Curvas lo dice sin error.
- [ ] `GET /api/periodos-atipicos/anios?temporada=invierno` lista 2023 y 2026 como `atipico` con sus meses (2026 con `completo: false`) y 2024 y 2025 como `normal`; con `?agrupacion_id=` de una agrupación de verano, 2023 sale `normal`; la tarjeta "Años marcados como atípicos" de la pestaña dice lo mismo.

**Hito del paso 2 (cálculo, `0.9.1 · M6`)**

- [ ] Roles: el menú muestra Planificación → Curvas de estacionalidad a admin y planner; el comprador no lo ve, la ruta lo redirige y toda la API de M6 (`GET /api/curvas` incluido) le responde `403`.
- [ ] **Calcular** con los parámetros por defecto termina en menos de 10 s y la corrida dice cuántas agrupaciones tienen curva propia, prestada o sin venta; `select count(*) from venta_mensual_estacionalidad` es del orden de 100 mil; el tiempo del refresco se anota (es la medición que M7 necesita).
- [ ] Para una agrupación de **invierno** con el periodo de 2023 activo, el detalle muestra 2023 como año de Niño con el bloque "Efecto del Niño": las dos curvas lado a lado, la diferencia en puntos, el veredicto y el `ratio_volumen`; si el veredicto es "forma estable", 2023 figura "incluido" y entra en los pliegues; si es "forma cambia", figura "imputado" (marzo a mayo en cursiva). Para una de **verano** o **toda temporada**, 2023 sale normal y no hay bloque. Desactivar el periodo y recalcular deja 2023 normal en todas.
- [ ] **Validación de la premisa de Javier**: en el resumen, el conteo `forma_estable` / `forma_cambia` entre las agrupaciones de invierno se anota; si la mayoría es "forma estable", se confirma que el Niño mueve volumen y no forma, y el `ratio_volumen` medio por año se entrega como dato de partida a M7. Subir el umbral a 5 puntos y recalcular cambia el conteo de forma coherente (nunca pasa de estable a cambia).
- [ ] Cambiar la temporada de una agrupación desde M6 y desde M3 se ve en las dos pantallas y, tras recalcular, cambia la clase de 2023 para esa agrupación; forzar `tratamiento_atipicos = 'imputar'` en una agrupación con "forma estable" la imputa igual (el parámetro manda sobre el veredicto).
- [ ] Con `solo_tiendas_completas` encendido, una tienda que abrió a mitad de año no entra en la red comparable de ese año (se ve en "Por tienda"); apagándolo, entra y la curva de ese año se mueve.
- [ ] 2026 aparece como "parcial (ene–sep)", con EAT parcial por candidata, y **ninguna** candidata cambia si se recalcula con `hasta_periodo = 2025-12`.
- [ ] En una agrupación con liquidación fuerte (chip `liquidacion_fuerte`), los meses marcados coinciden con lo que Javier sabe de las rebajas; `G` baja esos meses y `H` se parece a `G`; el CV % por línea y mes se lee en la tabla.
- [ ] **Elegir** una candidata distinta de la recomendada con una nota → queda vigente v1 con `recomendada = false`; recalcular y **Aprobar propuesta** → v2 con `recomendada = true`, la v1 figura `reemplazada` en la base; **Retirar** → sin curva vigente y la agrupación sale en "Sin curva"; `select count(*) from curvas_estacionalidad where estado = 'vigente'` coincide con el resumen.
- [ ] **Aprobar recomendadas en bloque** con "Solo las que no tienen curva" deja Sin curva (con venta) en cero; repetirlo responde todo `sin_cambio`; las prestadas se omiten salvo con la casilla.
- [ ] `GET /api/curvas/vigentes` devuelve una fila por agrupación activa con curva, con 12 valores que suman 1; el CSV descargado abre en Excel con acentos y porcentajes correctos y coincide con la pantalla.
- [ ] Publicar un mes nuevo en M5 (o cambiar una asignación en M3) hace aparecer el aviso "corrida desactualizada" sin recalcular nada; recalcular lo quita.
- [ ] Intentar eliminar en M3 una agrupación con curvas responde `409` legible; desactivarla la deja al final de la tabla con `inactiva_con_curva`.
- [ ] **Validación de negocio (Javier)**: las curvas vigentes de cinco agrupaciones conocidas (dos de abrigo, dos de verano, una de todo el año) se parecen a lo que planeamiento usa hoy en Excel; las diferencias se explican con la tabla por año. Si no se parecen, se anota qué candidata o qué parámetro las acerca antes de abrir M7.

## Fuera de alcance

- **Proyección** (M7): aplicar la curva a un total anual, la participación de cada tienda, las tiendas nuevas con `venta_esperada_promedio`, las marcas con `tratamiento_especial` y cualquier factor de ajuste por año atípico sobre el año objetivo.
- **Ajuste de volumen por periodo atípico (requisito de M7, registrado aquí el 2026-10-13).** Javier: el Niño cambia sobre todo el volumen de unidades. Como la curva de M6 es participación, ese efecto no vive en M6: el **volumen anual base** de una agrupación de invierno en un año de Niño (2023 y, cuando cierre, 2026) es atípico, y M7 debe poder **normalizarlo** al proyectar: un factor por periodo atípico y agrupación (o por temporada), editable por el planner o calculado contra los años normales, que M6 ya entrega como `ratio_volumen` en el resultado de cada corrida (`comparacion_forma.ratio_volumen`: lo que vendieron los meses atípicos frente a lo esperado por la referencia). Contrato: M7 lee `GET /api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` o el `resultado` de la corrida para obtener el ratio, y decide si (a) corrige el histórico base de ese año dividiendo los meses atípicos por el ratio antes de promediar volúmenes, o (b) aplica un factor al año objetivo si el año objetivo es de Niño (el `reduccion_invierno_nino_pct` de Vector-One, pero por agrupación y por periodo, no un porcentaje global). Qué opción, y si el factor lo fija el planner o sale del ratio, se decide al especificar M7 (PLAN, fila M7). **Complemento de Javier (2026-10-13): "al momento de proyectar unidades sí sirve saber si el año fue Niño o no."** Por eso el catálogo de periodos atípicos es también un dato de M7, no solo de la curva, y M6 deja el contrato de lectura estable (`claseDeAnio` y `GET /api/periodos-atipicos/anios`, en "Contratos de API") para que M7 (a) normalice o descuente el volumen base de los años de Niño al proyectar unidades de invierno y (b) muestre al planner qué años fueron Niño, y con cuántos meses, junto a la base histórica. M6 no diseña el modelo de proyección.
- **Curvas por agrupación × tienda**: M6 guarda el agregado por tienda y lo muestra como diagnóstico; curvas propias por tienda serían un M6b con la misma tabla de curvas más `tienda_id` nullable. Ver pregunta abierta 2.
- **Curvas manuales o editadas a mano** (decisión del 2026-10-06): el planner elige entre candidatas, no teclea participaciones. Si hiciera falta "corregir un mes", es un ajuste de M7 sobre la proyección.
- **Mediana por mes y modelos con tendencia o descomposición** (STL, Holt-Winters): con dos o tres años no aportan y exigirían dependencias; el catálogo `MODELOS` admite añadir candidatas sin tocar la tabla de curvas.
- **Curvas por marca o por agrupación de marca**; **curvas en semanas**; **curvas de stock** (M8 usa el stock de fin de mes para quiebres).
- **Refrescar la MV al publicar en M5**: M5 no se toca; M6 refresca al calcular y avisa de datos nuevos.
- **Heredar la temporada de la agrupación desde las líneas de M1**: solo se sugiere (`temporada_sugerida`) y se avisa; la fija el planner. Un alcance `verano` para periodos atípicos: no existe hasta que haga falta (pregunta abierta 13).
- Auditoría general (pendiente desde M0); el comprador no ve esta pantalla.

## Riesgos

- **Pocos años completos.** Para las agrupaciones de verano y toda temporada hay tres años normales (2023, 2024, 2025). Para las de invierno, el número depende del veredicto de forma: si Javier tiene razón y el Niño solo mueve el volumen (`forma_estable`), 2023 entra tal cual y son también tres (y cuatro cuando cierre 2026); solo si la forma cambia quedan dos normales más uno imputado. La comparación de forma convierte ese riesgo en un dato medido por agrupación, no en una suposición. En cualquier caso, con dos o tres pliegues las candidatas `A`, `B` y `C` se parecerán mucho; la ficha lo hace visible (`sin_validacion`, `pliegues`) y cada año cargado lo mejora sin cambiar nada.
- **La comparación de forma con un solo año de Niño** (2023 hoy) compara una curva de tres años con una de dos: una diferencia pequeña puede ser ruido del propio 2023 y no efecto del Niño. Por eso el umbral es editable, el veredicto se muestra con su cifra y el parámetro `tratamiento_atipicos` manda sobre el veredicto; con 2026 completo la comparación tendrá dos años de Niño y será más firme.
- **Imputación de huecos**: rellena los meses del Niño con la referencia de los años normales; la tabla por año muestra siempre la participación real "cruda" de 2023 además de la imputada, y los parámetros `incluir` y `descartar` cubren las otras dos posturas.
- **Refresco de la MV y `statement_timeout`**: 2 a 5 s estimados en Micro; el piloto de M5 debe medir el timeout del `service_role` antes de construir M6. Si el refresco no cabe, la salida es compute Small o partir el agregado por año (dos funciones), sin cambiar el modelo.
- **Lectura de la MV con `leerTodo`** (≈ 100 llamadas de 1 000 filas): aceptable para una acción de 5 s, no para cada clic; por eso la corrida guarda el resultado y el detalle por agrupación filtra en SQL. Si molesta, la MV pierde `linea_id` (≈ 35 mil filas) y el CV por línea pasa a una función aparte.
- **Primera excepción a "RLS sin políticas"** (una MV no admite RLS): queda protegida con `revoke`; la prueba 30 lo verifica.
- **Sin transacción** al reemplazar una curva: `update` de la vieja y luego `insert` de la nueva; un fallo entre ambos deja la agrupación sin vigente, visible y reparable con repetir la elección.
- **Liquidación como señal del CV %**: si Lukers liquida con el mismo margen todos los años, el umbral del 15 % no marcará nada y `G` coincidirá con `A`; es correcto (no hay distorsión que corregir), pero conviene que Javier lo valide con una agrupación que sabe que liquida.
- **La asignación de M3 puede cambiar entre corridas**: una curva vigente calculada con una clasificación vieja sigue vigente; el aviso `asignaciones_cambiadas` lo señala y recalcular lo resuelve; no se invalidan curvas solas.

## Decisiones nuevas propuestas

Para `docs/DECISIONES.md` cuando Javier apruebe la ficha; ninguna contradice una entrada vigente:

1. **La curva es la participación del mes en el año, por agrupación de estacionalidad, para toda la red.** Decidido por Javier (participación) y recomendado aquí (red), con la red comparable por año a partir de las fechas de M4. Descartado: agrupación × tienda (pocos años completos por tienda, ruido, miles de curvas irrevisables como en Vector-One).
2. **Un catálogo editable de periodos atípicos sustituye a los "años Niño" fijos.** Rangos de meses con motivo y alcance (`invierno` / `todas`), sin seed, usable antes del cálculo (paso 1 de la entrega). Descartado: columna `es_nino` por año como Vector-One (`anios_nino`), que obligaba a descartar años enteros y no distinguía meses.
2b. **La temporada vive en la agrupación de estacionalidad (`temporada`: `invierno` / `verano` / `todo_el_ano`, por defecto `todo_el_ano`) y el Niño ajusta solo a las de invierno.** Decidido por Javier el 2026-10-13; cierra la pregunta 6 de M3 y la 1 de esta ficha. Se sugiere desde las líneas de M1 pero la fija el planner. Descartado: casilla booleana `afectada_por_atipicos` (primera versión de esta ficha); heredar la temporada de la línea; marcarlo en la agrupación de marca (no interviene en la forma de la curva).
3. **Los años con meses atípicos entran tal cual si el Niño no cambia la forma, y se imputan si la cambia; lo decide una comparación medida por agrupación (`compararForma`, umbral de 3 puntos editable), no una suposición.** El tratamiento por defecto es `auto`; `incluir`, `imputar` y `descartar` se pueden forzar. Descartado: descartar siempre el año entero (deja a las de invierno con dos años); asumir sin medir que el Niño solo mueve el volumen.
3b. **El efecto del Niño sobre el volumen no es de M6: M6 lo mide (`ratio_volumen`) y M7 lo aplica; y el catálogo de periodos atípicos es un dato de M7 tanto como de M6.** Javier: "al momento de proyectar unidades sí sirve saber si el año fue Niño o no". M6 deja `claseDeAnio` y `GET /api/periodos-atipicos/anios` como contrato estable. Registrado como requisito de M7 en PLAN.
4. **El año en curso nunca ajusta; solo valida parcialmente.** Descartado: incluir enero a septiembre en el promedio (produce curvas sin cuarto trimestre).
5. **El modelo propone, el planner elige; la curva elegida se versiona con quién y cuándo.** Siete candidatas en un catálogo fijo, backtesting dejando un año fuera, EAT como métrica, desempate por simplicidad. Descartado: aplicar la recomendación sola; MAPE (castiga meses pequeños).
6. **La liquidación no se descuenta de la curva base; se ofrece como candidata ("unidades a precio normal") y como señal (CV % por línea y mes).** Descartado: elasticidades, calendarios fijos de rebajas, `linea.temporada` como criterio.
7. **El agregado mensual vive en una vista materializada protegida con `revoke`**, refrescada por M6 al calcular. Es la primera excepción a "RLS activo sin políticas" (una MV no admite RLS). Descartado: agregar al vuelo en cada lectura (2 a 5 s por clic), tabla rellenada por corrida y limpiada por handler (10 MB por corrida y un mecanismo de limpieza más).
8. **El modelo corre en TypeScript puro en el servidor**, sin dependencias; SQL solo agrega. Descartado: estadística en SQL (intesteable sin base) y librerías de series temporales (peso y opacidad para tres años de datos).
9. **La curva vigente se guarda en doce columnas con `check` de suma**, una `vigente` por agrupación por índice único parcial; estados `vigente`, `reemplazada`, `retirada`. Descartado: `jsonb` o tabla hija de 12 filas (M7 la leería peor y el `check` no viviría en la base).
10. **Toda la API de M6 exige `requirePlanner`, lecturas incluidas** (mismo criterio que M5: el CV % es margen).

## Preguntas abiertas para Javier

Cada una con su valor por defecto si no responde antes de construir.

1. **Resuelta (2026-10-13).** Javier: "En las agrupaciones de estacionalidad deberíamos marcar si es una estacionalidad de invierno, verano o toda temporada; las de invierno se afectan por el Niño". La marca vive en la agrupación de estacionalidad como `temporada` (tres valores), no en la agrupación de marca ni como casilla booleana; el Niño ajusta solo a las de invierno. Se conserva el texto original por contexto. Tú dijiste "en la agrupación de marca deberíamos marcar las que se afectan con el niño". Tres lecturas: **(a) en la agrupación de estacionalidad** (PANTALONES INVIERNO sí, POLOS BÁSICOS no): la curva se calcula por agrupación de estacionalidad, así que la bandera actúa justo donde se decide qué meses de 2023 y 2026 se descuentan; es una columna y cero tablas. **(b) En la agrupación de marca** (ULTRA LOW … PREMIUM): no cambia la forma de ninguna curva, porque las curvas no se calculan por nivel de marca; solo serviría para que M7 reduzca la proyección de ese nivel en un año Niño (un porcentaje, como el `reduccion_invierno_nino_pct` de Vector-One), o bien obligaría a calcular curvas por agrupación de estacionalidad × agrupación de marca (cinco veces más curvas con cinco veces menos datos cada una). **(c) Ambas**: (a) para la curva y (b) como factor de ajuste de M7. **Por defecto: (a)**, y si confirmas que también quieres (b), se anota como parámetro de M7, no de M6.
2. **Grano de la curva.** **Por defecto: una curva por agrupación para toda la red**, con la red comparable por año (solo las tiendas abiertas los doce meses). La pantalla te mostrará la curva real de cada tienda como diagnóstico; si ves que alguna tienda se comporta distinto de verdad, abrimos M6b para curvas por tienda en agrupaciones concretas. ¿Te sirve así?
3. **Meses de cada Niño.** Para 2023 se había hablado de **marzo a mayo**; para 2026 no hay meses definidos. Los creas tú en la pestaña Periodos atípicos (no van en el código). ¿Confirmas marzo–mayo de 2023? ¿Qué meses de 2026? ¿Afecta "solo a las agrupaciones de invierno" o "a todas" (por ejemplo, si en 2023 cayó la venta de toda la red)? **Por defecto: 2023-03 a 2023-05 con alcance "invierno"; 2026 sin periodo hasta que lo definas** (2026 es año en curso y no entra en el ajuste de todos modos). Los dos se crean en la pestaña Periodos atípicos, que está disponible desde el paso 1.
4. **Liquidación.** La curva base refleja la venta real, liquidación incluida; aparte te ofrezco la candidata "unidades a precio normal" (deflacta los meses cuyo CV % supera la mediana del año en más del 15 %) y la de venta neta en soles, y el backtesting dice cuál predice mejor. ¿Te parece bien el 15 %? ¿Quieres que en las agrupaciones con liquidación fuerte la recomendación prefiera "a precio normal" aunque el backtesting no la favorezca? **Por defecto: 15 % y la recomendación sale solo del backtesting.**
5. **Medida.** **Por defecto: unidades** (M7 proyecta unidades). ¿Hay agrupaciones que planificas en soles? Si sí, la corrida se puede lanzar con medida `venta_soles` y la curva guarda la medida para que M7 la interprete.
6. **Años con huecos.** Con marzo a mayo de 2023 atípicos, M6 compara por agrupación la curva con 2023 incluido y sin él; si la forma no cambia (tu premisa), 2023 entra tal cual; si cambia, entra "imputado" (sus otros nueve meses cuentan y los tres del Niño se rellenan con el promedio de 2024 y 2025). **Por defecto: automático, con un máximo de cuatro meses de hueco por año para imputar.** ¿Prefieres forzar siempre "incluir" (confiar en tu premisa sin medir), "imputar" o "descartar"?
7. **Año calendario.** Las participaciones se calculan de enero a diciembre. ¿Planificas con otro corte (por ejemplo, temporada de abril a marzo)? **Por defecto: calendario.**
8. **Aprobación en bloque.** El botón "Aprobar recomendadas" aplica de una vez la curva que propone el modelo a muchas agrupaciones. ¿Quieres que esté disponible desde el principio o solo revisar una por una la primera vez? **Por defecto: disponible, con `confirm` y conteo.**
9. **Curva prestada.** Una agrupación sin años utilizables recibe la curva de su género si la apruebas explícitamente (no entra en el bloque salvo que lo pidas). ¿Te sirve el género como préstamo, o prefieres elegir tú de qué otra agrupación copiar (sería un `Select` en el detalle)? **Por defecto: el género.**
10. **Quién aprueba.** Hoy, cualquier planner (y el admin). ¿Debe quedar solo en manos de uno (por ejemplo, tú) con un rol o una bandera? **Por defecto: cualquier planner; la curva guarda quién la aprobó.**
11. **Umbral de "la forma no cambia".** El veredicto compara la curva con los años de Niño incluidos y sin ellos; si difieren menos de **3 puntos porcentuales** en total (la suma de las diferencias de los doce meses), se considera que el Niño no cambió la forma y 2023 (y 2026 cuando cierre) se usan tal cual. ¿Te parece bien 3 puntos? Se puede cambiar en cada corrida y en el detalle. **Por defecto: 3.**
12. **Temporada sugerida desde las líneas.** Cada agrupación nace como "Toda temporada" y el sistema te sugiere la temporada mayoritaria de las líneas de sus equivalencias (M1), pero no la aplica: la marcas tú. ¿Quieres un botón "Aplicar la sugerida a todas las que siguen en Toda temporada" para hacerlo de una vez (revisable después)? **Por defecto: solo sugerencia y aviso; sin botón en bloque.**
13. **Alcance por periodo.** Cada periodo atípico dice si afecta "solo a las agrupaciones de invierno" (lo que dijiste del Niño) o "a todas". ¿Necesitas también "solo verano" (si observas que el Niño también mueve la forma del verano, por calor prolongado)? **Por defecto: `invierno` y `todas`; el Niño con `invierno`.**
14. **Efecto del Niño sobre el volumen (para M7).** M6 te mostrará, por agrupación de invierno y año de Niño, cuánto vendieron los meses atípicos frente a lo esperado (`ratio_volumen`). En M7, ¿prefieres que ese factor se calcule solo y tú lo ajustes, o fijarlo tú por temporada o agrupación? **Por defecto: calculado, editable; se decide al especificar M7.**
