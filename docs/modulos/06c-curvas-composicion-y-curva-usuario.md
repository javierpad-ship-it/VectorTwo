# M6c · Composición de la agrupación, curva del usuario `U` y modelo avanzado `F`

> Estado: **especificada el 2026-10-15, revisada por el `arquitecto-revisor` (opus) y ajustada el 2026-10-16 con su informe y con las decisiones de Javier; lista para construir** (ver "Orden de construcción"). Amplía [06b-curvas-trabajo-por-agrupacion](06b-curvas-trabajo-por-agrupacion.md) (vigente desde la `0.9.7`), que conserva el modelo de [06-curvas-estacionalidad](06-curvas-estacionalidad.md). **Una sola entrega** (decisión de Javier): composición de la agrupación, curva del usuario `U` y candidata `F` corregida, con `T` compitiendo. Migración **`0022_composicion_y_curva_usuario.sql`** (la `0021` la tomó M7 `0.10.1`; la siguiente libre es la `0022`). Etiqueta de versión: `APP_VERSION` vigente es `0.10.1 · M6`; **la etiqueta de esta entrega la fija la construcción** (la siguiente `0.10.x` libre o la que corresponda por orden de release) y el `documentador` la anota aquí. Commits con prefijo `M6:`. Ningún dato real de Lukers: las agrupaciones y GML de los ejemplos son inventados (`SINT_INV`, `P3`, `HOMBRE · URBANO · CASACA`…); lo observado en producción va en cifras agregadas sin nombres (al 2026-10-15: 13 curvas vigentes, 11 con tres años de ajuste y 2 con dos; ruido entre años normales de 8.3 a 82.3 pp; la agrupación mayor tiene 166 GML, 450 equivalencias y 4 671 filas GML × mes).

## Objetivo

Que la vista de trabajo de una agrupación responda tres preguntas que hoy no responde. **"¿Qué hay dentro?"** La cabecera dice "14 equivalencias activas" y nada más; Javier necesita ver los GML (género · mundo · línea) y las equivalencias que forman la agrupación, cuánto pesa cada uno (unidades por año y porcentaje de la agrupación sobre la misma red comparable con la que se calcula la curva), cómo se comporta cada GML frente al resto de la agrupación (pequeños múltiplos y selección en el gráfico principal), con una alerta sobre los GML que se apartan de forma consistente, el aviso de que un GML también vende en otras agrupaciones, y el enlace a M3 para reasignar. **"¿Y si la curva la pongo yo?"** Escribir doce participaciones que suman 100 % (en tabla, normalizando, partiendo de una candidata, de un año, de la vigente o pegando desde Excel), verlas en el mismo gráfico y la misma tabla que la aprobada, los años y la propuesta del sistema, conocer su error contra los años con la **misma métrica** (EAT) y el mismo ruido que las candidatas, y aprobarla como **curva del usuario**, con nota obligatoria, versionada, que **no se vuelve obsoleta sola** ("solo cuando yo decida cambiarla") y que M7 consume como cualquier otra. **"¿Y si el sistema propone algo más fino?"** Una candidata `F · modelo avanzado`: TypeScript puro y determinista, sin servicios externos, que combina los años con pesos por recencia y **contrae** la curva hacia la de su temporada (`T`) tanto más cuanto menos datos o más ruido tenga la agrupación; se mide con el mismo backtesting que `A`…`E` **sin fuga de información** (en cada pliegue, el ruido y la `T` se calculan solo con los años de entrenamiento), compite con el mismo margen de empate relativo al ruido, **explica** en palabras del planner cómo se armó y con qué pesos, se versiona y se guarda en la foto para reproducirla. `T` también compite con backtesting honesto. Con tres o cuatro años ningún algoritmo garantiza ganar: en la simulación del revisor sobre las 13 vigentes reales, `F` honesta **no gana en ninguna** y `T` gana en las dos de dos años; por eso la pantalla no presenta `F` como "la mejor" salvo que gane el backtesting por más del margen, y el planner decide.

## Decidido por Javier

Rigen las decisiones de la 06 y las 1 a 12 de la 06b. Añadidas el **2026-10-15** (prueba de la `0.9.7`) y el **2026-10-16** (tras el informe del revisor):

13. **"Aquí necesito ver todas las GML del grupo."** Composición completa en la vista de trabajo: GML y equivalencias con su peso (unidades por año y % de la agrupación), cómo se comporta cada GML frente a la curva de la agrupación (múltiplos o selección), alertas de GML que se apartan, enlace a M3 para reasignar.
14. **"También necesito poder definir una curva propuesta por el usuario."** Doce participaciones que suman 100 %, editadas en tabla con normalización; partir de una candidata, un año, la vigente o pegar desde Excel; en el mismo gráfico y tabla; error contra los años con la misma métrica y ruido; aprobable como "curva del usuario" con nota obligatoria, en la foto con sus doce valores y versionada; M7 la consume igual que cualquiera.
15. **"Falta una curva con IA que use un algoritmo avanzado para proponer algo también."** Candidata `F · modelo avanzado`, junto a las demás, con su error por backtesting; elegible o usable de base para la curva propia. TypeScript puro y determinista, sin LLM ni servicios externos; misma métrica y pliegues; honesta.
16. **(2026-10-16) Una sola entrega** con composición, `U` y `F` corregida: `F` sin fuga (ρ del pliegue solo con años de entrenamiento), **sin suavizado fijo** (el revisor midió que empeora a `A` en 9 de 13 agrupaciones reales y aplana picos reales de diciembre, mayo–junio, julio y marzo), `T` con backtesting honesto compitiendo bajo el mismo margen; `F` y `T` solo se recomiendan si ganan por más del margen; `F` solo con dos o más años de ajuste, como las demás propias.
17. **(2026-10-16) La curva del usuario no se vuelve obsoleta sola**: "solo cuando yo decida cambiarla". Los cambios de datos, composición, temporada o periodos se muestran como **avisos informativos**, nunca como obsolescencia.
18. **(2026-10-16) "Se aparta"** compara el GML contra el **resto** de la agrupación (sin el propio GML), con umbral `max(umbral_forma, ruido de la agrupación, ruido propio del GML entre sus años)`, un mínimo de unidades por GML-año, y el aviso "este GML también está en otras N agrupaciones (x % de su venta)".
19. **(2026-10-16) Composición en pantalla**: solo los GML principales (hasta cubrir ~85 % de las unidades o los 12 primeros) y un renglón "Otros N GML (x %)" desplegable como lista con peso (sin curva); minicurvas solo para GML con ≥ `min_unidades_ano` (120); buscador; CSV con todos los GML.
20. **(respuestas previas)** `U` se puede aprobar aunque el sistema no tenga ninguna candidata calculable; con **cero venta** no (`sin_venta` bloquea antes y `U` no lo saltea). La representación en la base no usa `DROP`.

## Flujo de usuario (UX primero)

Se inserta en el flujo de la 06b sin mover nada. Se añaden **3b** (composición), **4** se amplía con las filas `F` y `T` con backtesting, y **4b** (la curva del usuario).

**Paso 3b · Mirar la composición.** Debajo de la tabla año × mes, la tarjeta **Composición de la agrupación**, plegada al entrar con el resumen "166 GML · 450 equivalencias activas · 3 GML se apartan"; al desplegarla se pide a la API (carga diferida: no entra en el primer cálculo). Muestra **los GML principales**: ordenados por unidades del último año de ajuste, hasta cubrir el 85 % acumulado o los 12 primeros (lo que ocurra antes), más el renglón **Otros N GML (x %)**, desplegable como lista de nombres con su peso (sin curva). Cada fila: nivel (GML / GMLE, de 02b), equivalencias, unidades y % por año sobre la red comparable del año, EAT frente al **resto** de la agrupación en cada año de ajuste, la marca **Se aparta**, el aviso "también en otras 2 agrupaciones (31 % de su venta)", una minicurva (solo si el GML tiene ≥ 120 unidades en algún año de ajuste) y la casilla "Ver en el gráfico". Un **buscador** filtra por nombre entre todos los GML (también los de "Otros"). Al desplegar un GML se ven sus equivalencias (nombre, código, genérica, activa) con unidades y % por año. "Pequeños múltiplos" (una tarjeta por GML principal con minicurva) y **Descargar CSV** (todos los GML y equivalencias). En cada GML que se aparta, **Reasignar en M3** lleva a `/maestros/estacionalidad?pestana=asignacion`. Si faltan los periodos del Niño (bloqueo de la 06b), la composición **se muestra igual** (unidades y pesos) y "Se aparta" dice "no se evalúa hasta cargar los periodos". *Decide*: si la agrupación está bien armada o si una equivalencia debe moverse antes de aprobar nada.

```
Composición de la agrupación · 166 GML · 450 equivalencias activas · 3 se apartan        [Buscar GML ______] [Pequeños múltiplos] [CSV (todos)]
Pesos sobre la red comparable de cada año · umbral «se aparta» 24.1 pp = max(piso 3, ruido agrupación 24.1, ruido del GML) · mínimo 120 u. por GML-año

GML (12 principales = 85.4 % de 2025)   Nivel  Equiv.  2024 u.   %     2025 u.   %     2026 ene–set  %   EAT vs resto (24 · 25)   Curva   Gráfico
▸ HOMBRE · URBANO · CASACA              GML    2       600    30.0 %  660    30.0 %  420        30.0 %   2.9 · 3.2               ▁▂▃▅▇▇▆▅▃▂▁ [ ] ver
▸ HOMBRE · URBANO · CHOMPA              GML    1       350    17.5 %  385    17.5 %  245        17.5 %   2.9 · 3.2               ▁▂▃▅▇▇▆▅▃▂▁ [ ] ver
▾ HOMBRE · FORMAL · ABRIGO              GML    1 (gen.) 100    5.0 %  110     5.0 %   70         5.0 %   56.0 · 60.0 ⚠ Se aparta ▄▅▆▆▅▃▂▁▁▁▁ [x] ver → Reasignar en M3
     también en otras 2 agrupaciones (31 % de su venta en 2025)
     SIN EQUIVALENCIA (genérica, activa)         100    5.0 %  110     5.0 %   70         5.0 %
… (9 filas más)
▸ Otros 154 GML (14.6 %)   → lista: HOMBRE · CASUAL · GORRO 0.9 % · HOMBRE · FORMAL · CORBATA 0.8 % · … (sin curva: menos de 120 u.)
Total                                          11      2,000  100 %   2,200  100 %   1,400      100 %
⚠ 3 GML se apartan del resto de la agrupación en todos sus años de ajuste válidos: revisa si sus equivalencias van en otra agrupación.
```

**Paso 4 (ampliado) · Entender la recomendación, con `F` y `T`.** La tabla de candidatas gana la fila **`F · Modelo avanzado`** entre `E` y `T`, y `T` deja de decir "—" en EAT: ambas con "N pruebas", EAT, ruido, error máximo, EAT parcial, "Igual a …" y "Recomendada" solo si ganan. Debajo de `F`, su **explicación**: "F se apoya en 2023 (24 %), 2024 (32 %) y 2025 (43 %); contrae un 30 % hacia la curva de invierno (T) porque sus años normales difieren 5.3 pp entre sí y su propia curva está a 4.8 pp de la de la temporada. Se equivoca 5.1 pp en 3 pruebas frente a 4.0 de A; no mejora a A: se recomienda A." Con dos años de ajuste: "F se muestra pero no compite: con un solo año de entrenamiento por prueba no hay backtesting honesto". Un desplegable "Cómo se armó F" muestra los pesos por año, ρ, δ, λ, y las curvas base y contraída, y por pliegue el ρ y λ de ese pliegue. *Decide*: si `F` o `T` le convencen más que `A`, con nota si no es la recomendada.

**Paso 4b · Definir mi curva (opcional).** Debajo de **Lo que propone el sistema**, la tarjeta **Mi curva (curva del usuario)**, plegada hasta pulsar "Definir mi curva". Al abrirla: doce celdas en porcentaje (un decimal visible, hasta cuatro admitidos), **suma en vivo** ("Suma 98.0 % · faltan 2.0"), **Normalizar a 100 %**, "Partir de" (candidata `A`…`F`/`T`, un año con curva, la vigente vN, o en blanco), **Pegar desde Excel** (doce valores separados por tabulador, salto de línea, `;`, `,` o espacio; coma o punto decimal; con o sin `%`; fracciones que suman 1 se convierten; unidades se normalizan avisando), "Limpiar". Mientras la curva es válida (doce valores de 0 a 100, suma 100 ± 0.05): serie **Mi curva** en el gráfico (trazo grueso con guion largo, color propio), fila **Mi curva** en la tabla año × mes con su **Diferencia (pp)** frente a la aprobada, y una última fila **`U` · Mi curva** en la tabla de candidatas con `radio`, "EAT 5.2 pp **en muestra** · ruido 3.8", error máximo, "2026 parcial 3.1 (en muestra)" e "Igual a A" si coincide. Para comparar peras con peras, al lado de cada candidata aparece también su **EAT en muestra** (la curva completa contra sus propios años) además de la EAT fuera de muestra: "A: 3.8 fuera de muestra · 1.9 en muestra". *Decide*: si su curva es mejor explicación que las candidatas, y con qué motivo.

```
Mi curva (curva del usuario)                                      Partir de: [A · Promedio simple ▾] [F · Modelo avanzado] [Año 2025 ▾] [Vigente v2] [En blanco]   [Pegar desde Excel]
        ene    feb    mar    abr    may    jun    jul    ago    set    oct    nov    dic      Suma
Mi curva [5.0] [5.0] [6.0] [8.0] [11.0] [14.0] [13.0] [12.0] [10.0] [7.0] [5.0] [4.0]   100.0 % ✓        [Normalizar a 100 %] [Limpiar]
A         4.3    4.4    6.4    8.3   11.05  14.65   13.6   11.65   9.75    6.9    5.0    4.0
Dif. (pp) +0.7   +0.6   −0.4   −0.3   −0.05  −0.65  −0.6   +0.35  +0.25  +0.1    0.0    0.0   EAT 4.0 · el mes que más cambia: enero (+0.7)
Error contra los años, EN MUESTRA (la curva se mide con los mismos años que tienes delante): 2024 4.6 pp (máx. 1.0 en mayo) · 2025 5.8 pp (máx. 1.6 en junio) · promedio 5.2 ·
2026 parcial ene–set 3.1 (en muestra) · ruido entre años normales 3.8 · A: 3.8 fuera de muestra, 1.9 en muestra.
Para aprobarla elige «U · Mi curva» en la tabla de candidatas y escribe la nota: la curva del usuario siempre lleva motivo. No se marcará obsoleta por datos nuevos: la cambias tú.
```

**Paso 7 (ampliado) · Aprobar `F`, `T` o mi curva.** Aprobar `F` o `T` es aprobar una candidata más (nota solo si no es la recomendada; la foto guarda los pesos de `F`). Con `U`: el bloque **Aprobada frente a propuesta** compara **Mi curva** con la vigente; "Nota / motivo" obligatorio; botón "Aprobar mi curva (U) como versión 3"; el `confirm` repite los doce valores, el EAT en muestra frente al ruido, qué proponía el sistema, de dónde partió la curva y la diferencia con la vigente, y avisa "esta curva no se marcará obsoleta por datos nuevos; verás avisos". `PUT` con `modelo: "U"`, `curva_usuario`, `partida`, `parametros`, `huella_calculo`, `version_vigente` y `nota`. La lista muestra "**Curva del usuario** · v3 (el sistema proponía A)".

### Qué decide el planner y qué decide el sistema (añadido a la tabla de la 06b)

| Decisión | Quién | Dónde |
|---|---|---|
| Qué GML "se aparta" | sistema (umbral relativo a tres ruidos y mínimo de unidades) | tarjeta Composición |
| Si una equivalencia cambia de agrupación | planner (en M3) | enlace Reasignar |
| Cómo se arma `F` (pesos, contracción) y si `F` o `T` se recomiendan | sistema, solo si ganan el backtesting honesto por más del margen | tabla de candidatas |
| Los doce valores de la curva del usuario y de dónde parten | planner | tarjeta Mi curva |
| Cuándo cambia una curva del usuario | **solo el planner** (el sistema avisa, no obsoleta) | lista y vista |
| Aprobar `F`, `T` o `U` | **planner**, una por agrupación | botón Aprobar |

## Conceptos

### Composición medida sobre la red comparable

La composición que hoy existe es un conteo y una huella (`leerAgrupacionesConDatos`: `equivalencias_activas` y `huellaComposicion(ids)`), y la venta llega a TypeScript **ya sumada** por tienda × mes (`venta_estacionalidad_agrupacion` → `agrupacion`). Para ver cada GML hace falta un desglose nuevo: unidades por **GML × mes** y por **equivalencia × año**, sobre la **misma red comparable de cada año** que usó el cálculo (así los pesos y las curvas de los GML suman exactamente la serie de la agrupación de la tabla año × mes). La red la decide el modelo (`armarEntradaAgrupacion` → `entrada.redes`), así que la lectura nueva **recibe la red por año** (`p_red`) y el tope de meses (`p_hasta`) y devuelve solo lo filtrado: en la agrupación mayor, 4 671 filas GML × mes y 450 × 4 filas de equivalencia × año (~0.5 MB), en vez de equivalencia × tienda × mes (que pasaría de 200 000 objetos).

**Curva de un GML**: la participación mensual del GML en cada año (sobre la red del año, `participacion(meses)`) y, como curva anual, `A` (`curvaA`) sobre los **años de ajuste de la agrupación** en los que el GML tiene al menos `min_unidades_ano` (120) unidades. No se backtestea ni se recomienda: es una lectura; se dibuja solo si existe.

**GML que se aparta** (decisión 18): por año de ajuste, se compara la participación del GML con la del **resto de la agrupación** (la serie de la agrupación menos la del GML, mes a mes, truncada a 0 y renormalizada), `eat_vs_resto = EAT(p(GML, Y), p(resto, Y))`; `distinta` si `eat_vs_resto > umbral = max(umbral_forma, ruido_normal de la agrupación, ruido propio del GML)` donde el ruido propio es el promedio de EAT entre pares de participaciones del GML en sus años normales de ajuste válidos (`null` con menos de dos → no cuenta en el `max`), y el GML-año es **válido** solo si tiene ≥ `min_unidades_ano` unidades. `se_aparta` ⇔ `distinta` en **todos** sus años de ajuste válidos y hay al menos uno. Si no hay cálculo (periodos del Niño faltantes u otro bloqueo que deja la red pero no el modelo), `se_aparta = null` y el aviso lo dice. Es diagnóstico: no cambia la curva. **También en otras agrupaciones**: la función devuelve la venta del GML (todas sus equivalencias, todas las tiendas, hasta `p_hasta`) en cada agrupación de estacionalidad; la fila dice "también en otras N agrupaciones (x % de su venta en el último año de ajuste)" cuando x > 0.

**Pesos o participaciones negativos**: las devoluciones pueden dejar un GML-mes o un GML-año negativo. El **peso** se muestra con signo (`−0.3 %`) y la fila lleva el aviso `unidades_negativas`; la **participación** de un GML-año con total ≤ 0 es `null` (sin curva ni EAT), y con total positivo los meses negativos se truncan a 0 antes de repartir (misma regla que `serieDeAgrupacion`). El "resto" se trunca igual.

### Curva del usuario (`U`)

Doce participaciones escritas por el planner. **Se mide con la misma vara que las candidatas**: `eat(curva, real)` de `backtesting.ts` contra la participación usada de cada año de ajuste (`anios[].participacion`, la imputada si el año se imputó, lo mismo que ve `realDe` en `proponer`), `errorMax`, promedio, `validacionParcial` contra el año en curso y el mismo `ruido_normal`. Diferencia honesta que la pantalla dice siempre: las candidatas se miden **fuera de muestra**; la curva del usuario es fija y se mide **en muestra** (también su EAT parcial de 2026: el planner la escribió viendo esos meses). Por eso **`eat` y `error_max` de la fila quedan `null`** (esas columnas significan "fuera de muestra" en toda la tabla) y lo medido en muestra va solo en `curva_manual`; al lado se muestra la EAT en muestra de cada candidata, para comparar lo comparable. Si coincide con una candidata (`TOLERANCIA_IGUAL`), "Igual a A" y la EAT fuera de muestra de `A`. Nunca entra en `recomendar`; `recomendada = false`; `recomendada_entonces` guarda lo que el sistema proponía.

**No se vuelve obsoleta sola (decisión 17).** Una vigente `U` tiene estado propio `curva_usuario` en la lista (ni `al_dia` ni `obsoleta`). Lo que para una curva del sistema es un motivo de obsolescencia (`carga_nueva`, `composicion_cambiada`, `tienda_entra_red`, `tienda_sale_red`, `periodo_cambiado`, `temporada_cambiada`, `temporada_recompuesta`) se calcula igual pero viaja en `avisos_vigente` con el código `cambio_desde_aprobacion` y el detalle del motivo ("desde que la aprobaste: 1 mes publicado y cerrado después de 2026-08; cambió la composición: +2 equivalencias"). "Comparar con el sistema" sigue disponible. **Efecto en M7**: M7 no pregunta a M6 si una curva está obsoleta (usa la vigente y su versión; "la curva cambió" solo cuando hay una versión nueva); su tarjeta "Antes de proyectar" cuenta "curvas obsoletas en M6" a partir de `GET /api/curvas` y una `U` nunca entra en ese conteo: ahí se añade la línea informativa "N agrupaciones con curva del usuario (no se marcan obsoletas; vigilarlas desde M6)". En `resumen` de la lista, `curvas_usuario` se cuenta aparte y `obsoletas` nunca las incluye.

### Candidata `F · modelo avanzado` (corregida)

**Qué es.** Una candidata propia más (compite en `A, B, C, D, E, F`, orden de desempate con `F` al final), calculada en `src/lib/curvas/avanzada.ts` (TypeScript puro, determinista, sin reloj ni azar) **solo con lo que ya reciben las demás**: los años de ajuste (`AnioAjuste[]`, ya con el tratamiento del Niño aplicado: imputados o descartados, escasos fuera; `F` existe solo con **dos o más**, como las demás propias), el ruido entre años normales, la curva `T` y un parámetro. Dos pasos, cada uno con lectura en palabras:

1. **Base por recencia.** `b_m = Σ_Y w_Y · p_m(Y)` con `w_Y ∝ recencia_f^(n−k)` (`k` = posición del año del más antiguo `1` al más reciente `n`; `recencia_f = 0.75`: "cada año pesa un 25 % menos que el siguiente"). Con dos años `3/7` y `4/7`; con tres, `24 / 32 / 43 %`. Por qué no mediana ni media recortada: con dos a cuatro años no hay de qué recortar; la robustez la aporta el paso 2.
2. **Contracción hacia la temporada (heurística inspirada en la contracción empírica).** `q_m = (1 − λ)·b_m + λ·T_m` con `λ = ρ² ÷ (ρ² + n·δ²)`, donde `ρ` es el ruido entre años normales, `δ = EAT(b, T)` la distancia de la agrupación a su temporada y `n` los años de ajuste. Casos límite definidos: `δ = 0` → `λ = 1` (la base ya es `T`; el resultado no cambia); `δ > 0` y `ρ = 0` → `λ = 0`; sin `T` → `λ = 0` y `δ = null`. Es una heurística con la forma de la contracción empírica (más contracción cuanto más ruido propio, menos años o menos diferencia real con la temporada), escrita con la métrica del módulo (EAT en puntos); **no** es James–Stein exacto: no hay supuesto de normalidad ni varianzas estimadas, y por eso se presenta como regla explicable y no como estimador óptimo.

**Sin suavizado.** La versión anterior de esta ficha añadía un suavizado Whittaker fijo; el revisor lo midió sobre las 13 vigentes reales: empeora a `A` en 9 de 13 y aplana picos reales (diciembre, mayo–junio, julio, marzo). Se **quita**. Un suavizado atado a la contracción (`μ_efectivo = μ·λ`) tampoco gana en ninguna agrupación en su simulación, así que no se justifica ni como opción.

**Qué se descartó y por qué.** *Ensamblado (stacking) de `A`…`E`*: con dos o tres pliegues los pesos se ajustan al ruido; `A`, `B` y `C` coinciden en pliegues de un año. *Mediana o media recortada*: sin sentido con menos de cinco años. *Tendencia*: con 45 meses no se separa de un año raro. *Suavizado*: medido, pierde. *LLM o servicio externo*: no reproducible desde la foto, no auditable, los datos saldrían del sistema; lo único que aportaría (redactar) se hace con plantillas deterministas.

**Backtesting sin fuga.** `F` entra en `backtest` como las demás, pero cada pliegue se calcula **solo con el entrenamiento**: base y `n − 1` con los años de entrenamiento; **`ρ_pliegue`** = ruido entre los años **normales de entrenamiento** (si hay menos de dos normales, el promedio de EAT entre pares de los años de entrenamiento); **`T_pliegue`** = `A` sobre los años de ajuste de la temporada **sin el año de prueba** (`GrupoTemporada.prep.anios` ya tiene cada año; la serie de la temporada contiene la venta de esta agrupación). Con un solo año de entrenamiento (agrupación de dos años) `F` **se muestra** (curva con todos los años) pero **no compite**: `eat = null`, `pruebas = 0`, motivo visible "sin backtesting honesto: un solo año por prueba". Prueba de la propiedad: cambiar los datos del año de prueba no cambia `λ` ni `ρ` de su pliegue (regla 81). **`T` compite** con la misma mecánica: `EAT_T` = promedio de `EAT(T_pliegue, real)`; `recomendar` elige `mejor = argmin` entre las propias con EAT y `T` con EAT; si `mejor ≠ A` y `EAT_mejor > EAT_A − margen` → `A` (`sin_evidencia`); si `mejor = T` y gana el margen → `T` (`menor_error`, `origen = prestada`); sin propias con EAT → `T` como hoy (`prestada`). `margen = max(0.05, margen_ruido × ruido_normal)`, sin cambios.

**Explicación (lo que el planner lee).** `ExplicacionF = { anios: [{ anio, peso }], rho, delta, lambda, frase, por_pliegue: [{ anio_prueba, rho, lambda, eat }] }`. Plantilla con `formatearPp`: "F se apoya en 2023 (24 %), 2024 (32 %) y 2025 (43 %); contrae un 30 % hacia la curva de invierno (T) porque sus años normales difieren 5.3 pp entre sí y su curva está a 4.8 pp de la de la temporada". Sin `T`: "no contrae: la temporada no tiene serie". Con `λ ≥ 0.9`: "casi es la curva de la temporada: esta agrupación aporta pocos datos frente a su ruido". Con `n = 2`: "se muestra pero no compite: con un solo año de entrenamiento por prueba no hay backtesting honesto".

**Versión y parámetros.** `VERSION_MODELO` pasa de `1` a `2` (una candidata nueva y `T` con EAT cambian el resultado con la misma entrada): las vigentes del sistema reciben el aviso `modelo_anterior` (no obsolescencia; las `U` reciben `cambio_desde_aprobacion` con ese detalle) y `sin_cambio` deja de aplicar hasta reaprobar. `recencia_f` entra en `ParametrosCurvas` (defecto `0.75`, rango `0.5…1`, en la huella y en la foto; su edición en pantalla va con los umbrales a la segunda entrega). La candidata `F` de la foto guarda `detalle_f: { pesos_anios, rho, delta, lambda, t_usada, base, contraida, por_pliegue }`: con eso y los años se reproduce paso a paso.

**Backtest offline reproducible (condición de aceptación; lo corre `qa`).** Script `scripts/backtest-fotos.ts` (solo lectura, `service_role`, se ejecuta contra `vector-two` fuera de CI y **no** escribe nombres ni cifras por agrupación en el repo: imprime una tabla con ids ofuscados y deja el resultado en el scratchpad): para cada curva vigente, lee su foto, toma `resultado.agrupaciones[0].anios` (participaciones usadas, clases, `en_ajuste`) y `resultado.temporadas` (la serie de su temporada), y recalcula dejando un año fuera `A`, `F` (con `ρ_pliegue` y `T_pliegue` de entrenamiento) y `T`, el margen y la recomendación, con las funciones puras del módulo (`curvaA`, `curvaF`, `backtest`, `recomendar`). Criterio de aceptación: (a) la `A` recalculada coincide con la `A` de la foto (`TOLERANCIA_IGUAL`) y su EAT con `candidatas[A].eat` a dos decimales (determinismo); (b) en ninguna agrupación `F` o `T` queda recomendada con `EAT ≥ EAT_A − margen`; (c) para cada pliegue, `λ` y `ρ` no cambian al perturbar el año de prueba (se repite el pliegue con ese año multiplicado por 1.1); (d) la tabla agregada (cuántas gana `A`, `F`, `T`; ruido mínimo y máximo) se anota en el CHANGELOG sin nombres. **No hay un número mínimo de victorias de `F`**: la condición es que el sistema sea honesto, no que `F` gane. La misma lógica corre en CI sobre el fixture sintético (`tests/curvas.avanzada.backtest.test.ts`), reutilizando la estructura de la simulación del revisor (`sim.py`/`sim2.py`) con datos inventados.

### Representación en la base, sin `DROP`

En `curvas_estacionalidad`, `modelo` solo tiene `check (length(modelo) between 1 and 10)` (`0015`): **no restringe a `A`…`E`/`T`**; la restricción vive en zod (`MODELOS_CURVA`) y en `esModeloCurva`, que degrada a `"A"` cualquier valor desconocido. `origen` sí tiene `check in ('propia', 'prestada')`. Decisión: columna nueva **`origen_curva text not null default 'sistema'`** con `check in ('sistema', 'avanzada', 'usuario')` y **checks de coherencia** con `modelo` y `curva_manual` (abajo); `modelo` sigue siendo la letra (`A`…`F`, `T`, `U`); `origen` queda `propia` para `F` y `U`; `curva_manual jsonb` solo en `U`. Sin `DROP`: `origen = 'usuario'` exigiría `drop constraint curvas_estacionalidad_origen_check` y queda descartado (Javier). **Nota histórica para DECISIONES**: en la ficha 06 la letra `F` significó primero "curva por género" y después se redefinió como `T` (I4); desde esta entrega `F` es el modelo avanzado y `T` no cambia.

**En la foto de aprobación** de una `U`, `resultado` queda **tal como salió del cálculo** (sin candidata sintética `U`: el revisor señaló que mezclar una curva fija con las candidatas confunde a "Ver foto" y a M7) y la curva del usuario va en `resumen.curva_usuario` (valores, partida, EAT en muestra, `igual_a`). "Ver foto" de una versión `U` dibuja la curva desde `curva_de_la_foto` (la fila de `curvas_estacionalidad`) y lee `resumen.curva_usuario`; M7 (`leerVigentesProy`) no encuentra candidata `U` y ya da "sin backtesting". `F` sí viene en `candidatas` como cualquier otra, con `detalle_f`.

## Modelo de datos

Migración **`0022_composicion_y_curva_usuario.sql`**: idempotente, sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE` (tampoco dentro de la función), sin bloques `do $$`, `create or replace function`, `add column if not exists`, `revoke` a `public`, `anon` y `authenticated` y `grant` a `service_role`, `security invoker`, `stable`, `search_path = ''`, `comment on`. Sin tablas nuevas. `datos` la aplica en `vector-two` con el MCP, la valida con `scripts/validar-migraciones-local.sh` (dos pasadas; los checks de coherencia se prueban con inserciones que deben fallar) y regenera `database.types.ts`.

### 1. `curvas_estacionalidad.origen_curva text not null default 'sistema'`

```sql
alter table public.curvas_estacionalidad
  add column if not exists origen_curva text not null default 'sistema'
    constraint curvas_estacionalidad_origen_curva_check
      check (origen_curva in ('sistema', 'avanzada', 'usuario'))
    constraint curvas_estacionalidad_origen_usuario_modelo_check
      check ((origen_curva = 'usuario') = (modelo = 'U'))
    constraint curvas_estacionalidad_origen_avanzada_modelo_check
      check ((origen_curva = 'avanzada') = (modelo = 'F'));
```

El `default` rellena las filas existentes sin `UPDATE` (todas del sistema, con `modelo` en `A`…`E`/`T`: los dos checks se cumplen). Si la columna ya existe, `add column if not exists` omite también los checks en línea (idempotente).

### 2. `curvas_estacionalidad.curva_manual jsonb null`

```sql
alter table public.curvas_estacionalidad
  add column if not exists curva_manual jsonb
    constraint curvas_estacionalidad_curva_manual_check
      check (curva_manual is null or jsonb_typeof(curva_manual) = 'object')
    constraint curvas_estacionalidad_curva_manual_origen_check
      check ((curva_manual is not null) = (origen_curva = 'usuario'));
```

Contenido de `curva_manual`:

```jsonc
{ "valores_ingresados": [5, 5, 6, 8, 11, 14, 13, 12, 10, 7, 5, 4],    // porcentajes tal como se enviaron (hasta 4 decimales), ANTES de normalizar
  "partida": { "tipo": "candidata", "referencia": "F" },               // candidata | anio | vigente | pegado | en_blanco
  "en_muestra": true,
  "eat_en_muestra": 5.2, "error_max_en_muestra": 1.3,
  "eat_en_muestra_por_anio": [ { "anio": 2024, "eat": 4.6, "error_max": 1.0 }, { "anio": 2025, "eat": 5.8, "error_max": 1.6 } ],
  "eat_parcial_en_muestra": 3.1,
  "igual_a": null }
```

`p01`…`p12` guardan la curva **normalizada** (`normalizarCurva(valores / 100)`: seis decimales, suma exacta 1, pasa el `check` de la `0015`), **`eat = null` y `error_max = null`** (no hay medida fuera de muestra), `recomendada = false`, `origen = 'propia'`, `modelo = 'U'`, `nota` obligatoria, `anios_utilizados` con todo lo de la regla 42 de la 06b. `comment on column` de `modelo`, `origen`, `origen_curva` y `curva_manual` en la `0022`.

### 3. Función `venta_composicion_agrupacion(p_agrupacion_id uuid, p_red jsonb, p_hasta date) returns jsonb`

`language sql`, `stable`. La única lectura nueva de venta; solo `consultas.ts` la nombra. `p_red` es `{ "2024": ["<tienda_id>", …], … }` (la red comparable de cada año tal como la decidió `armarEntradaAgrupacion`; la API la arma siempre desde el cálculo); `p_hasta` es el primer día del último mes que entra (`hasta_periodo`). Devuelve, en una sola sentencia:

```jsonc
{ "nodos":         [ { "gml_id": "…", "periodo": "2024-01-01", "unidades": 48 }, … ],                 // GML × mes, tiendas de la red del año, periodo ≤ p_hasta
  "equivalencias": [ { "equivalencia_id": "…", "gml_id": "…", "anio": 2024, "unidades": 600 }, … ],   // equivalencia × año, misma red
  "otras":         [ { "gml_id": "…", "agrupacion_id": "…", "anio": 2025, "unidades": 310 }, … ],     // venta del GML en OTRAS agrupaciones (todas las tiendas, ≤ p_hasta)
  "cargas":        { "2023-01": "<carga_id>", … } }                                                   // como en 0017: misma sentencia, mismo estado
```

Esqueleto: CTE `red` (`jsonb_each` × `jsonb_array_elements_text` → `(anio int, tienda_id uuid)`); CTE **materializada** `hechos` = `equivalencias e join venta_stock_vigente v on v.equivalencia_id = e.id where e.agrupacion_estacionalidad_id = p_agrupacion_id and v.periodo <= p_hasta` (**primero se filtra por agrupación y tope**, activas o no, como la `0017`; se materializa una vez porque la usan dos agregados); `nodos` y `equivalencias` unen `hechos` con `red` por año; `otras` = para los `gml_id` de `hechos`, la venta de sus equivalencias con `agrupacion_estacionalidad_id` distinto (`join equivalencias e2 on e2.genero_mundo_linea_id = gml_id and e2.agrupacion_estacionalidad_id <> p_agrupacion_id`), sin filtro de red. `p_red` nulo o vacío → `nodos` y `equivalencias` vacíos. Costo: el agregado "pequeño" de la `0017` más el cruce de `otras`; **objetivo ≤ 1.5 s en la agrupación mayor** (166 GML, 450 equivalencias, 4 671 filas) medido en el hito; si no cabe, `otras` pasa a una segunda llamada diferida. `revoke`/`grant` como siempre.

### 4. Lo que no cambia

`corridas_estacionalidad`, `venta_estacionalidad_agrupacion`, índices y vistas de M5. `database.types.ts` gana dos columnas y una función.

### Diagrama

```
calcular (06b) ─► entrada.redes (red por año) + hasta ──┐
                                                        ▼
POST …/composicion (diferido, al abrir la tarjeta) ─► venta_composicion_agrupacion(id, p_red, p_hasta) [0022] ─► armarComposicion (pura) ─► GML × año: peso, participación, curva, EAT vs RESTO, distinta, se_aparta, otras agrupaciones
AnioAjuste[] + ruido + T ─► curvaF (avanzada.ts: base por recencia → contracción λ hacia T) ─► candidata F con backtesting sin fuga (ρ y T del pliegue solo de entrenamiento) · T con backtesting honesto
Mi curva (12 valores) ─► evaluarCurvaUsuario (pura, cliente y servidor) ─► EAT en muestra, igual_a, vs aprobada
      └─► PUT { modelo: "U", curva_usuario, partida, nota } ─► filaCurva: modelo U, origen propia, origen_curva usuario, curva_manual, eat null ─► curvas_estacionalidad v+1 ─► M7 (vigentes: sin cambios de forma; + origen_curva)
```

## Contratos de API y lógica pura

Convenciones de la 06b: `requirePlanner` en todo, `{ data }` / `{ error, codigo }`, `leerCuerpo`, esquemas en `src/lib/curvas/esquemas.ts`, `idDeRuta`, `traducirErrorDb`.

### Rutas

| Ruta | Método | Cuerpo / query | Respuesta |
|---|---|---|---|
| `/api/curvas/agrupaciones/[id]/composicion` | **POST** (lectura con cuerpo, nueva) | `calcularAgrupacionSchema` (mismos parámetros que `calcular`) | `200 ComposicionAgrupacionApi` siempre que haya `entrada` (meses publicados y cerrados): con bloqueo que deja red (periodos faltantes, `sin_anio_completo` parcial) devuelve unidades y pesos con `se_aparta: null` y el aviso `sin_calculo`; `404` agrupación · `409 hasta_periodo_sin_cargar` · `409 sin_datos` (sin ningún mes publicado y cerrado) · `500`. Nunca escribe. Reutiliza `leerContextoTrabajo` y `prepararTrabajo`; **caché y semáforo propios** (`cache-composicion.ts`: clave `id \| cargas_huella \| composicion \| md5(p_red) \| hasta`, TTL 120 s, 10 entradas, 2 lecturas simultáneas; **no** comparte las 20 entradas de `cache-venta.ts`) |
| `/api/curvas/agrupaciones/[id]/calcular` | POST | acepta `recencia_f` (defecto) | `resultado.candidatas` incluye `F` (con `explicacion_f` y `detalle_f`) y `T` con EAT; `?modelo=F` vale para el comparador |
| `/api/curvas/agrupaciones/[id]` | PUT | `aprobarCurvaSchema` ampliado | `201 { curva, foto_id }`. Con `F` o `T`, como cualquier candidata. Con `U`, los `409` en este orden: `hasta_periodo_sin_cargar` · `agrupacion_inactiva` · `prerrequisitos` (incluido `sin_venta`: **con cero venta no se aprueba `U`**) · `datos_cambiados` · `vigente_cambiada` · `sin_cambio` (vigente `U` con la misma huella **y** los mismos doce valores normalizados) · `nota_requerida` (siempre para `U`). **No** aplican `sin_curva_posible` ni `candidata_no_disponible` (Javier: `U` se aprueba aunque no haya ninguna candidata calculable) |
| `/api/curvas` · `…/versiones` · `/api/curvas/corridas/[id]/agrupaciones/[agrupacionId]` | GET | — | `modelo: ModeloAprobable`; `VigenteResumenApi` y `VersionAgrupacionApi` suman `origen_curva` y `curva_manual: CurvaManualApi \| null`; estado nuevo `curva_usuario`; aviso nuevo `cambio_desde_aprobacion`; `resumen.curvas_usuario` |
| `/api/curvas/vigentes` | GET | — | cada fila suma `origen_curva` (aditivo) |
| M7 `GET /api/proyeccion/[id]/linea` y detalle de fila (`eat_m6`) | GET | — | **cambio mínimo en M7**: `eat_m6_cobertura` (peso de la unidad cuyas agrupaciones traen backtesting, 0…1) y `eat_m6 = null` si la cobertura es menor que 1; la pantalla dice "sin backtesting (cubre 70 %: una agrupación tiene curva del usuario)" |

### Esquemas

```ts
export const MODELOS_PROPIOS = ["A", "B", "C", "D", "E", "F"] as const;      // F al final del orden de desempate
export const MODELOS_CURVA = [...MODELOS_PROPIOS, "T"] as const;               // lo que `calcular` devuelve y `?modelo=` admite
export const MODELO_USUARIO = "U" as const;
export const MODELOS_APROBABLES = [...MODELOS_CURVA, MODELO_USUARIO] as const; // A..F, T, U
export type ModeloAprobable = (typeof MODELOS_APROBABLES)[number];
export function esModeloAprobable(v: unknown): v is ModeloAprobable;           // servidor y cliente; esModeloCurva (A..F/T) acepta F desde el principio
export const ORIGENES_CURVA = ["sistema", "avanzada", "usuario"] as const;
export function origenCurvaDe(modelo: ModeloAprobable): OrigenCurva;          // U → usuario, F → avanzada, resto → sistema
export const ESTADOS_AGRUPACION = ["sin_curva", "al_dia", "al_dia_distinta", "obsoleta", "curva_usuario", "inactiva_con_curva"] as const;
export const CODIGOS_AVISO_VIGENTE = ["datos_posteriores", "modelo_anterior", "temporada_recompuesta", "cambio_desde_aprobacion"] as const;

// ParametrosCurvas: + recencia_f (0.5..1, defecto 0.75) en camposParametros, en la huella y en la foto.

const porcentaje = z.number("Cada mes debe ser un número.").min(0, "Un mes no puede ser negativo.").max(100, "Un mes no puede pasar de 100 %.");
export const curvaUsuarioSchema = z.array(porcentaje, "La curva debe ser una lista de doce porcentajes.").length(12, "La curva debe tener doce meses.")
  .refine((v) => Math.abs(v.reduce((s, x) => s + x, 0) - 100) <= TOLERANCIA_SUMA_USUARIO /* 0.05 */, "Los doce meses deben sumar 100 % (± 0.05).")
  .refine((v) => v.some((x) => x > 0), "La curva no puede ser toda ceros.");
const referenciaLimpia = z.string().trim().max(40).refine((v) => !CARACTERES_PROHIBIDOS_NOTA.test(v));   // la misma prohibición que la nota (control y bidi)
export const partidaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("candidata"), referencia: z.enum(MODELOS_CURVA) }).strict(),               // A..F, T
  z.object({ tipo: z.literal("anio"), referencia: referenciaLimpia.regex(/^\d{4}$/) }).strict(),
  z.object({ tipo: z.literal("vigente"), referencia: referenciaLimpia.regex(/^v\d+$/) }).strict(),
  z.object({ tipo: z.literal("pegado"), referencia: z.null() }).strict(),
  z.object({ tipo: z.literal("en_blanco"), referencia: z.null() }).strict(),
]);

export const aprobarCurvaSchema = z.object({
  modelo: z.enum(MODELOS_APROBABLES, "El modelo debe ser A, B, C, D, E, F, T o U."),
  curva_usuario: curvaUsuarioSchema.optional(),      // obligatoria con U; prohibida con cualquier otro modelo (400 en los dos sentidos)
  partida: partidaSchema.optional(),                 // solo con U (400 si viene con otro modelo); sin ella, { tipo: "en_blanco" }
  parametros: …, huella_calculo: …, version_vigente: …, nota: …,   // como en la 06b
}).strict().superRefine(/* U ⇔ curva_usuario presente; partida solo con U */);
```

`CurvaManualApi` = el contenido de `curva_manual`. `CandidataApi` suma los opcionales `explicacion_f?`, `detalle_f?` y `eat_en_muestra?: number | null` (para todas las candidatas con curva: la curva completa contra sus años de ajuste; lo calcula `proponer`).

### `POST …/composicion` → `ComposicionAgrupacionApi`

```ts
export type GmlComposicionApi = {
  gml_id: string; genero: string; mundo: string; linea: string; nivel: "GML" | "GMLE"; vigente: boolean;
  principal: boolean;                  // entre los que cubren el 85 % o los 12 primeros (por unidades del último año de ajuste)
  equivalencias: { id: string; nombre: string; codigo: string; es_generica: boolean; activo: boolean; por_anio: { anio: number; unidades: number; peso: number }[] }[];
  por_anio: { anio: number; clase: ClaseAnioCurva; en_ajuste: boolean; valido: boolean;                           // valido = en_ajuste y unidades ≥ min_unidades_ano
              unidades: number; peso: number;                                                                    // peso con signo (puede ser negativo)
              participacion: number[] | null;                                                                    // null si unidades ≤ 0; parcial en el año en curso
              eat_vs_resto: number | null; distinta: boolean | null }[];
  curva: number[] | null; anios_curva: number[];                                                                 // A sobre los años válidos; null sin ninguno
  ruido_propio: number | null;         // EAT promedio entre pares de sus años normales válidos; null con menos de dos
  umbral: number | null;               // max(umbral_forma, ruido_normal, ruido_propio); null sin cálculo
  se_aparta: boolean | null;           // null sin cálculo (periodos faltantes u otro bloqueo)
  otras_agrupaciones: { agrupacion_id: string; nombre: string; unidades: number; pct_de_su_venta: number }[];    // último año de ajuste; vacío si no vende fuera
  avisos: ("se_aparta" | "sin_calculo" | "sin_venta" | "unidades_negativas" | "pocas_unidades" | "nodo_no_vigente" | "en_otras_agrupaciones")[];
};
export type ComposicionAgrupacionApi = {
  huella_calculo: string; hasta_periodo: string; con_calculo: boolean;
  ruido_normal: number | null; umbral_forma: number; min_unidades: number;
  anios: { anio: number; clase: ClaseAnioCurva; en_ajuste: boolean; unidades: number }[];   // totales de la agrupación (= resultado.anios[].unidades)
  gml: GmlComposicionApi[];            // todos (principales y otros), por género, mundo, línea
  principales: number; otros: number; pct_principales: number;
  equivalencias_activas: number; equivalencias_inactivas_con_venta: number; equivalencias_sin_venta: string[];
  duracion_ms: number;
};
```

### Lógica pura (lo que `backend` escribe y `tests/curvas.*` prueban)

| Función | Archivo | Qué hace |
|---|---|---|
| `armarRedPorAnio(redes)` | `src/lib/curvas/composicion.ts` | `p_red` desde `tiendasQueEntran` por año; años sin red → `[]` |
| `armarComposicion(lectura, contexto)` | `composicion.ts` | GML × año: unidades, peso con signo, participación (truncando negativos), **resto** = agrupación − GML, `eat_vs_resto`, `distinta`, `ruido_propio`, `umbral`, `se_aparta`, `curva`, `principal` (85 % / 12), `otras_agrupaciones`; reutiliza `participacion`, `curvaA`, `eat`, `ruidoNormal` |
| `principales(gml, pct = 0.85, max = 12)` | `composicion.ts` | los primeros por unidades del último año de ajuste hasta cubrir `pct` o `max` |
| `pesosRecencia(anios, recencia)` | `src/lib/curvas/avanzada.ts` | pesos `recencia^(n−k)` normalizados, por año ascendente |
| `lambdaContraccion(rho, delta, n)` | `avanzada.ts` | `delta = 0 → 1`; `delta > 0 ∧ rho = 0 → 0`; `delta = null → 0`; si no `rho² ÷ (rho² + n·delta²)`; en `[0, 1]` |
| `rhoDe(anios)` | `avanzada.ts` | ruido entre los años normales dados; con menos de dos normales, promedio de EAT entre todos los pares; `null` con un solo año |
| `curvaF(ajuste, rho, T, recencia)` | `avanzada.ts` | `{ curva, detalle } \| null` (sin años de ajuste); sin suavizado |
| `curvaTDe(aniosTemporada, excluir?)` | `modelo.ts` | `A` sobre los años de ajuste de la temporada sin el año excluido (`T_pliegue`) |
| `explicarF(detalle, temporada, n)` | `avanzada.ts` | la frase de "Explicación", con `formatearPp` y `es-PE` |
| `calcularCandidatas` / `proponer` (ampliadas) | `candidatas.ts`, `modelo.ts` | `F` con `backtest` y por pliegue `rhoDe(entrenamiento)` y `curvaTDe(…, prueba)`; `T` con EAT por pliegue; `eat_en_muestra` en todas; `recomendar` incluye `T` con EAT |
| `evaluarCurvaUsuario(valores, resultado, temporada)` | `src/lib/curvas/curva-usuario.ts` (sin React ni `@supabase/*`) | normaliza, EAT y `errorMax` por año de ajuste, promedio, `validacionParcial` (marcada en muestra), `igual_a` contra todas las candidatas y `curva_T` |
| `parsearPegado(texto)` | `curva-usuario.ts` | prueba los separadores en orden `\t`, `\n`, `;`, espacio, `,`: el primero que deja exactamente 12 números gana (con `\t`/`\n`/`;`/espacio, la coma es decimal; con `,` como separador, el punto es decimal); quita `%`; suma ≈ 100 (± 0.5) → porcentaje; ≈ 1 (± 0.005) → fracción × 100; otra cosa → unidades normalizadas (aviso); si ningún separador da 12 → error con cuántos llegaron |
| `normalizarA100(valores)` · `curvaDesde(partida, resultado, vigente)` | `curva-usuario.ts` | reparto proporcional (suma 0: nada); los doce porcentajes de una candidata, de un año o de la vigente; `null` si no existe |
| `filaCurva` (ampliada) | `reglas.ts` | `origen_curva = origenCurvaDe(modelo)`; con `U`: `origen 'propia'`, `recomendada false`, **`eat = null`, `error_max = null`**, `curva_manual`, `p01..p12` normalizados; con `F`/`T`, como cualquier candidata |
| `motivoRechazoAprobar` (ampliada) | `reglas.ts` | orden de la tabla de rutas para `U`; `notaRequeridaPor` devuelve primero "aprobaste tu propia curva" |
| `evaluarEstadoVigente` (ampliada) | `obsolescencia.ts` | con `origen_curva = 'usuario'`, los motivos pasan a `avisos` como `cambio_desde_aprobacion` y `motivos = []` |
| `estadoDeAgrupacion` (ampliada) | `estado.ts` | vigente `U` → `curva_usuario` (gana a `obsoleta`; `inactiva_con_curva` gana a todo) |
| `armarFoto` | `trabajo.ts` | con `U`, `resumen.curva_usuario`; `resultado` sin tocar |
| `aVigenteResumen`, `versionesDeAgrupacion`, `aCurvaVigente`, `aCurvaAprobada` | `reglas.ts` | `esModeloAprobable`; `origen_curva` de la columna; `curva_manual` |
| `construirSeries` (ampliada) | `src/components/curvas/series.ts` | `extras` (Mi curva y los GML marcados "ver"); Mi curva: `COLOR_USUARIO = "#0f766e"`, trazo `discontinuo`, grosor 3.5; GML: color por posición, grosor 1.5 |
| `textoConfirmarAprobacion` · `textoPropone` (ampliadas) | `vista.ts` | con `U`: doce valores, "en muestra", partida, lo que proponía el sistema, "no se marcará obsoleta"; con `F`/`T` recomendada: su explicación o "T, la curva de la temporada, se equivoca menos que A" |
| `eatM6ConCobertura` (M7, cambio mínimo) | `src/lib/proyeccion/calculo.ts` | `eat_m6_cobertura = Σ peso con pliegue`; `eat_m6 = null` si `< 1` |

### Pantalla (componentes)

`composicion-card.tsx` (plegada al entrar; principales + "Otros" desplegable; buscador; múltiplos con `PerfilCurva` (generalización de `PerfilTienda` de `red-comparable.tsx`) solo con ≥ 120 u.; casillas "ver"; aviso "también en otras N agrupaciones"; enlace a M3; CSV completo con `descargarCsv`), `use-composicion.ts` (pide `POST …/composicion` al abrir la tarjeta y cuando cambia `huella_calculo` estando abierta; `AbortController`; descarta respuestas con otra huella), `candidatas-tabla.tsx` (fila `F` con "Cómo se armó F"; `T` con EAT; columna "EAT en muestra"; fila `U` al final solo con curva válida), `curva-usuario-editor.tsx` (doce `Input` con `inputMode="decimal"`, `onPaste` → `parsearPegado`, suma con `aria-live`, "Normalizar", "Partir de", "Limpiar"; borrador en `sessionStorage` `curva-usuario:<agrupacionId>`), `tabla-anio-mes.tsx` (fila "Mi curva" y diferencia), `aprobar-panel.tsx` ("Aprobar mi curva (U)"; nota obligatoria; aviso "no se marcará obsoleta"), `curvas-tab.tsx` (badge **Curva del usuario** como estado, avisos `cambio_desde_aprobacion`, "A (vs U)" en Sistema hoy; badge **Modelo avanzado**), `versiones-panel.tsx` (badges; "Ver foto" de `U` lee `resumen.curva_usuario`), `detalle-agrupacion.tsx` (cabecera "450 equivalencias activas en 166 GML · Ver composición"). M7: `antes-de-proyectar` con la línea "N agrupaciones con curva del usuario" y el detalle de fila con "sin backtesting (cubre x %)". Formato `es-PE` compartido.

## Reglas de negocio

Continúan la numeración de la 06b (última 59; 45 y 46 son SQL y estático). Todas con vitest sobre fixtures sintéticos salvo la 60 (SQL de humo), la 74 (estático) y la 87 (backtest offline, `qa`).

**`0022` y `composicion.ts`**

60. **SQL (humo local, `scripts/humo-0022.sql` y `validar-migraciones-local.sh`)**: la `0022` aplica dos veces sin error y sin `drop`/`delete`/`truncate`/`update` fuera de comentarios; `origen_curva` vale `sistema` en todas las filas existentes; insertar `modelo = 'U'` con `origen_curva = 'sistema'`, `origen_curva = 'usuario'` con `modelo = 'A'`, `origen_curva = 'avanzada'` con `modelo = 'A'`, `curva_manual` no nulo con `origen_curva = 'sistema'` o `origen_curva = 'usuario'` con `curva_manual` nulo **fallan** por sus checks; `curva_manual` rechaza un `jsonb` que no sea objeto; `venta_composicion_agrupacion(id, p_red, p_hasta)` con `p_red` que cubre todas las tiendas suma por mes lo mismo que `agrupacion` de `venta_estacionalidad_agrupacion(id)` hasta `p_hasta`; con `p_red` vacío o nulo, `nodos` y `equivalencias` vacíos; un año ausente no produce filas; una equivalencia desactivada con venta aparece; `otras` solo trae agrupaciones distintas; `cargas` coincide con `leerCargasPublicadas`; `anon` y `authenticated` no pueden ejecutarla; duración en la agrupación mayor ≤ 1.5 s (medida en el hito).
61. `armarRedPorAnio(redes)` = `tiendasQueEntran(red)` por año, ordenadas; `sin_red` → `[]`; `tiendas_excluidas` cambia `p_red` sin cambiar `huellaRed`.
62. `armarComposicion`: por año con red, `Σ_gml unidades = resultado.anios[anio].unidades` y `Σ_gml peso = 1` (± 1e-6) cuando el total es positivo; un GML con unidades ≤ 0 en el año → `participacion = null`, peso con signo y aviso `unidades_negativas` si es negativo; `valido` ⇔ `en_ajuste` y `unidades ≥ min_unidades_ano`; en el año en curso la participación es parcial; las equivalencias suman las unidades del GML; `principales(gml)` marca los primeros por unidades del último año de ajuste hasta el 85 % o 12 (el que llegue antes), y con 12 GML o menos todos son principales.
63. **Curva y ruido propio del GML**: `curva = curvaA` sobre los años válidos; `anios_curva` los lista; sin años válidos → `null`; `ruido_propio` = promedio de EAT entre pares de sus años normales válidos, `null` con menos de dos; `anios_excluidos` saca el año también de aquí.
64. **GML que se aparta**: `eat_vs_resto` se mide contra `participacion(agrupación − GML)` del año (truncando negativos); `umbral = max(umbral_forma, ruido_normal ?? 0, ruido_propio ?? 0)`; `distinta` solo en años válidos; `se_aparta` ⇔ `distinta` en todos los años válidos y hay al menos uno; sin cálculo (`con_calculo = false`) → `se_aparta = null`, `distinta = null` y aviso `sin_calculo`; un GML con un único GML en la agrupación (resto vacío) → `eat_vs_resto = null` y nunca se aparta.
65. **Huella, determinismo y otras agrupaciones**: `POST …/composicion` devuelve la misma `huella_calculo` que `calcular` con el mismo cuerpo; dos llamadas con la misma huella dan `gml` idéntico; con bloqueo que deja red responde `200` con `con_calculo = false`; sin meses publicados y cerrados, `409 sin_datos`; `otras_agrupaciones` lleva `pct_de_su_venta = unidades fuera ÷ (unidades dentro + fuera)` del último año de ajuste y el aviso `en_otras_agrupaciones` cuando es > 0.

**`curva-usuario.ts`**

66. `parsearPegado`: `"5\t5\t6\t8\t11\t14\t13\t12\t10\t7\t5\t4"` → doce valores, `porcentaje`; `"5 5 6 8 11 14 13 12 10 7 5 4"` (espacios) → igual; `"4,3;4,4;…"` y `"4,3 4,4 …"` (coma decimal) → `4.3, 4.4, …`; `"4.3%\n4.4%\n…"` → igual; `"4.3,4.4,…"` (doce con coma como separador) → punto decimal; doce fracciones que suman 1 → × 100; doce unidades (suma 1 000) → normalizadas, origen `unidades`; once valores → error "se esperaban 12 valores y llegaron 11"; sin números → error; un negativo → error.
67. `normalizarA100([5,5,6,8,11,14,13,12,10,7,5,2])` (98) → × 100/98 y suma 100 (± 1e-9); todos ceros no cambia; `curvaUsuarioSchema` acepta suma 100 ± 0.05 y rechaza 99.9, un valor fuera de 0..100, once valores y todo ceros; la curva guardada suma exactamente 1 y pasa el `check` de la `0015`.
68. `evaluarCurvaUsuario` con `SINT_INV` y `[5,5,6,8,11,14,13,12,10,7,5,4]` → `eat_en_muestra_por_anio = [{2024, 4.6, 1.0}, {2025, 5.8, 1.6}]`, `eat_en_muestra = 5.2`, `error_max_en_muestra = 1.3`, `eat_parcial_en_muestra` sobre el año en curso, `igual_a = null`; igual a `A` → `igual_a = "A"`; sin años de ajuste → `eat_en_muestra = null`; `proponer` da `eat_en_muestra` de `A` sobre el mismo fixture = `(EAT(A, 2024) + EAT(A, 2025)) / 2 = (1.9 + 1.9) / 2 = 1.9` (`A` está a 0.95 pp de cada año en mayo y en junio).
69. `curvaDesde`: `{ tipo: "candidata", referencia: "F" }` → la curva de `F` en porcentaje (cuatro decimales); `{ "anio", "2024" }` → `participacion_real ?? participacion` de 2024; `{ "vigente", "v2" }` → la vigente; inexistente → `null`; `partidaSchema` rechaza `{ "candidata", "U" }`, `{ "anio", "24" }`, `{ "vigente", "2" }`, una referencia con caracteres de control y `{ "pegado", "x" }`.

**`esquemas.ts`, `reglas.ts`, `estado.ts`, `obsolescencia.ts`**

70. `aprobarCurvaSchema`: `U` sin `curva_usuario` → `400`; `A` (o `F`) con `curva_usuario` o con `partida` → `400`; con `U` y doce valores válidos → pasa; `parametros` siguen siendo obligatorios y estrictos; `modelo = "F"` → pasa (las cuatro pruebas que hoy rechazan `F` —`tests/curvas.reglas.test.ts:111`, `curvas.vista.test.ts:345`, `curvas.rutas.test.ts:486`, `curvas.esquemas.test.ts:101`— pasan a rechazar `G`, `H`, `""`, `3`, `"a"`, `"AB"` y a aceptar `F`).
71. **Lectores desde el principio**: `esModeloCurva("F")` es `true` y `MODELOS` incluye `F` (servidor y cliente); `esModeloAprobable("U")` es `true`; `aVigenteResumen`, `versionesDeAgrupacion`, `aCurvaVigente` y `aCurvaAprobada` devuelven `modelo = "U"` / `"F"` (no `"A"`), `origen_curva` de la columna y `curva_manual` solo en `U`; `esModeloCurva("U")` sigue `false`.
72. `motivoRechazoAprobar` con `U`: inactiva → `agrupacion_inactiva`; bloqueante (incluido `sin_venta`) → `prerrequisitos`; `origen = null` (ni propias ni `T`) **no** rechaza; huella distinta → `datos_cambiados`; `version_vigente` distinta → `vigente_cambiada`; vigente `U` con la misma huella y los mismos doce valores (max |Δ| < `TOLERANCIA_IGUAL`) → `sin_cambio`; con otros valores → sigue; nota vacía → `nota_requerida` ("aprobaste tu propia curva (U)"); `candidata_no_disponible` nunca con `U`. Con `F` o `T`: las reglas 41 de la 06b tal cual (`T` sin `curva_T` → `candidata_no_disponible`).
73. `filaCurva`: `origen_curva = origenCurvaDe(modelo)` siempre y `curva_manual` no nulo ⇔ `modelo = "U"` (coincide con los checks de la `0022`); con `U`: `origen "propia"`, `recomendada false`, `eat null`, `error_max null`, `curva_manual` completo, `anios_utilizados.recomendada_entonces` = recomendada del cálculo; `huellasDeCurva` devuelve las tres huellas; `armarFoto` con `U` deja `resultado` tal cual y rellena `resumen.curva_usuario`; con `F`, la candidata `F` de la foto lleva `detalle_f` y `explicacion_f`.
74. **Estático**: `composicion.ts`, `curva-usuario.ts` y `avanzada.ts` no importan de `@supabase/*` ni de React; `avanzada.ts` no usa `Math.random`, `Date` ni `node:`; solo `consultas.ts` nombra `venta_composicion_agrupacion`; existe `…/composicion/route.ts` con `requirePlanner`; la `0022` no contiene `drop`, `delete`, `truncate` ni `update` fuera de comentarios; ningún archivo de `src/` escribe `origen = 'usuario'` ni `'avanzada'`; sin dependencias nuevas; `cache-composicion.ts` no importa de `cache-venta.ts` su mapa (entradas separadas).
75. **Estado y avisos de una vigente `U`**: `estadoDeAgrupacion` → `curva_usuario` aunque haya motivos; `evaluarEstadoVigente` con `origen_curva = 'usuario'` devuelve `motivos = []` y un aviso `cambio_desde_aprobacion` por cada motivo que habría sido obsolescencia (mismo detalle); `datos_posteriores` y `modelo_anterior` siguen siendo avisos; `sistemaHoy` → `{ tipo: "distinta", texto: "A (vs U)" }` y "Comparar con el sistema" disponible; `resumen.curvas_usuario` las cuenta y `obsoletas` no; una vigente `F` recomendada → `al_dia`, no recomendada → `al_dia_distinta`, y se obsoleta como cualquier curva del sistema; una vigente `T` sigue siendo `prestada` con `temporada_recompuesta` como motivo.
76. **Ver foto** de una versión `U`: `curva_de_la_foto.modelo = "U"`, `resultado.candidatas` **no** contiene `U`, la curva dibujada sale de `curva_de_la_foto.curva` y los datos en muestra de `foto.resumen.curva_usuario`; el comparador frente a la curva de esa foto da `eat_vs_vigente = 0`. De una versión `F`: la candidata `F` con `detalle_f`.
77. **M7**: `leerVigentesProy` con una vigente `U` devuelve `curva`, `curva_id`, `version` y ningún `eat_por_pliegue`; con `F` o `T`, el `eat_por_pliegue` de la candidata; `eatM6ConCobertura` sobre una unidad con dos agrupaciones (pesos 0.7 con pliegue y 0.3 sin) → `eat_m6 = null`, `eat_m6_cobertura = 0.7`; con cobertura 1, `eat_m6` = promedio ponderado como hoy; `GET /api/curvas/vigentes` lleva `origen_curva` y `acumulada[11] = 1`.
78. `construirSeries` con `extras`: Mi curva y los GML marcados van después de la propuesta, encendidos por defecto, solo en participación; `filasCsvAnioMes` incluye "Mi curva" y su diferencia cuando existe.

**`avanzada.ts`, `candidatas.ts` y `modelo.ts`**

79. `pesosRecencia([2024, 2025], 0.75) = [3/7, 4/7]`; con tres años `[0.5625, 0.75, 1] ÷ 2.3125 = [0.2432, 0.3243, 0.4324]`; con `recencia_f = 1`, iguales; suman 1; insensibles al orden de entrada.
80. `lambdaContraccion`: `(16/3, 4.7568, 3) = 0.2953`; `(4, 6.2857, 2) = 0.1684`; `(8, 4.5714, 2) = 0.6049`; `(30, 10, 2) = 0.8182`; `(rho, 0, n) = 1`; `(0, 2, n) = 0`; `(rho, null, n) = 0`; nunca fuera de `[0, 1]`.
81. **Sin fuga**: en `backtest` de `F`, `ρ_pliegue` y `T_pliegue` salen solo de los años de entrenamiento: multiplicar por 1.1 las unidades del año de prueba (misma participación o distinta) **no cambia** `rho`, `lambda` ni la curva de `F` de ese pliegue (sí cambia el EAT medido); con dos años de ajuste cada pliegue tiene un año de entrenamiento → `F.eat = null`, `pruebas = 0`, `motivo = "sin_backtesting_honesto"`, la curva existe (calculada con los dos años y `ρ = ruido_normal`) y `recomendar` la ignora; con un solo año de ajuste `F` es `null` como las demás propias.
82. `curvaF` con el fixture `P3` (caso 42) reproduce pesos, `base`, `delta = 4.7568`, `lambda = 0.2953` y `contraida = [4, 4, 6.5906, 8, 11.7333, 14.2667, 14, 12, 10, 6.4094, 5, 4]` (en %); con `lambda = 0` (sin `T`) y `recencia_f = 1`, `F` es idéntica a `A` → `igual_a = "A"`; con `recencia_f = 0.5` y dos años, la base coincide con `C` (pesos `1/3`, `2/3`); con `recencia_f = 0.75`, nunca con `C`.
83. **`T` con backtesting**: `curvaTDe(aniosTemporada, prueba)` excluye el año de prueba; `T.eat` = promedio de `EAT(T_pliegue, real)` sobre los años de ajuste de la agrupación; `T.pruebas` = pliegues; en `P3`, `EAT_T = (8 + 4 + 8) / 3 = 6.667`; `T` sin años de temporada de entrenamiento en un pliegue → ese pliegue se omite (como las demás).
84. **Recomendación honesta**: en `P3`, `EAT_A = 4.0`, `EAT_F = 5.128`, `EAT_T = 6.667`, `margen = max(0.05, 0.25 × 5.333) = 1.333` → recomendada `A` (`menor_error`, es la mejor); con `EAT_F = EAT_A − 1.0` → sigue `A` (`sin_evidencia`); con `EAT_F = EAT_A − 2.0` → `F` (`menor_error`); con `EAT_T = EAT_A − 2.0` y `F` peor → `T` (`menor_error`, `origen = prestada`); orden de desempate `A, B, C, D, E, F`; `T` nunca se recomienda sin EAT salvo que no haya propias (`prestada`, como hoy).
85. `explicarF` produce la frase del caso 44 (`es-PE`); sin `T`: "no contrae: la temporada no tiene serie"; `lambda ≥ 0.9`: "casi es la curva de la temporada"; `n = 2`: "se muestra pero no compite…"; `por_pliegue` lista `anio_prueba`, `rho`, `lambda` y `eat`.
86. **Versión y huella**: `VERSION_MODELO = 2`; una foto con `version_modelo = 1` recibe `modelo_anterior`; `recencia_f` entra en `parametrosCanonicos` y en la foto; `parametrosDeJson` de una foto vieja lo rellena con `0.75`; `resumenParametros` lo lista si no es el defecto ("recencia F: 0.90").
87. **Backtest offline** (`qa`, fuera de CI): `scripts/backtest-fotos.ts` cumple (a) a (d) de "Backtest offline reproducible" sobre las vigentes de `vector-two`; en CI, `tests/curvas.avanzada.backtest.test.ts` corre el mismo procedimiento sobre tres agrupaciones sintéticas (`P3`, una de dos años y una muy ruidosa) y comprueba (b) y (c).

## Casos de prueba sintéticos

Continúan los de la 06b (último 31). Fixture **`SINT_INV`** (invierno, `tests/curvas.composicion.fixture.ts`): tres GML, cuatro equivalencias activas: `HOMBRE · URBANO · CASACA` (G1: `E1`, `E2`), `HOMBRE · URBANO · CHOMPA` (G2: `E3`), `HOMBRE · FORMAL · ABRIGO` (G3: `E4`, genérica). Dos tiendas en la red todos los años; 2024 y 2025 normales y completos (sin periodos, confirmados sin atípicos), 2026 en curso. Unidades por año: 2024 G1 1 200, G2 700, G3 100 (total 2 000); 2025 G1 1 320, G2 770, G3 110 (total 2 200). Formas en % (ene…dic): **S** (G1 y G2 en 2024) = `4 4 6 8 12 14 14 12 10 7 5 4`; **S′** (G1 y G2 en 2025) = `4 4 6 8 10 16 14 12 10 7 5 4`; **D** (G3 ambos años) = `10 12 14 14 12 8 6 5 5 5 5 4`. `min_unidades_ano = 120`, `umbral_forma = 3`.

32. **Pesos y totales**: pesos 0.60 / 0.35 / 0.05 en 2024 y 2025; `Σ unidades` = 2 000 y 2 200 = `resultado.anios[].unidades`; `E4` lleva las 100 y 110 de G3; los tres son `principal` (menos de 12); G3 es válido (100 < 120 en 2024 → **no válido**; 110 < 120 en 2025 → no válido) → G3 no tiene años válidos: `curva = null`, `se_aparta = false`, aviso `pocas_unidades`.
33. **Curva de la agrupación y ruido**: 2024 = `0.95·S + 0.05·D` = `4.3 4.4 6.4 8.3 12.0 13.7 13.6 11.65 9.75 6.9 5.0 4.0`; 2025 = igual salvo may 10.1 y jun 15.6; `ruido_normal = 1.9 + 1.9 = 3.8 pp`; `A` = `4.3 4.4 6.4 8.3 11.05 14.65 13.6 11.65 9.75 6.9 5.0 4.0`; EAT de `A` fuera de muestra 3.8 (dos pliegues de un año); `eat_en_muestra` de `A` = 1.9.
34. **Se aparta contra el resto** (variante `SINT_INV_G3` con G3 = 300 y 330 unidades, pesos 0.5455 / 0.3182 / 0.1364 en 2024: 1 200 / 700 / 300 de 2 200): el resto de G3 en 2024 es `S` (G1 y G2), `eat_vs_resto(G3) = Σ|D − S| = 56.0`; el resto de G1 es `(700·S + 300·D) / 1 000 = 0.7·S + 0.3·D`, `eat_vs_resto(G1) = 0.3 × 56 = 16.8`; en 2025 `Σ|D − S′| = 60` → G3 60.0, G1 18.0; `ruido_propio`: G1 `EAT(S, S′) = 4`, G3 `EAT(D, D) = 0`; ruido de la agrupación con esos pesos = `0.8636 × 4 = 3.45`; umbral G1 = `max(3, 3.45, 4) = 4`; umbral G3 = `max(3, 3.45, 0) = 3.45`; G1 `distinta` (16.8 > 4) en los dos años → **G1 se aparta**, y también G2 y G3: el fixture muestra que "se aparta contra el resto" marca a todos cuando la agrupación mezcla dos formas, y la prueba de la regla 64 exige exactamente eso; con `umbral_forma = 20`, solo G3 (56 > 20) se aparta.
35. **Otras agrupaciones**: el fixture añade al GML G1 una equivalencia `E5` en otra agrupación con 400 unidades en 2025 → `otras_agrupaciones = [{ …, unidades: 400, pct_de_su_venta: 400 / (1 320 + 400) = 0.2326 }]`, aviso `en_otras_agrupaciones`, texto "también en otra agrupación (23 % de su venta en 2025)".
36. **Pegado**: los casos de la regla 66.
37. **Normalización**: `[5,5,6,8,11,14,13,12,10,7,5,2]` → `[5.102, 5.102, 6.122, 8.163, 11.224, 14.286, 13.265, 12.245, 10.204, 7.143, 5.102, 2.041]`; guardada suma exactamente 1.
38. **EAT en muestra de `U`**: `[5,5,6,8,11,14,13,12,10,7,5,4]` frente a 2024: `0.7 + 0.6 + 0.4 + 0.3 + 1.0 + 0.3 + 0.6 + 0.35 + 0.25 + 0.1 = 4.6 pp` (máx. 1.0 en mayo); frente a 2025: `4.6 − 1.3 + 2.5 = 5.8` (máx. 1.6 en junio); promedio 5.2, `error_max` 1.3; frente a `A`: `4.0 pp`, mes de mayor cambio enero (+0.7); al lado, `A` 3.8 fuera de muestra y 1.9 en muestra.
39. **Aprobar `U`**: `PUT { modelo: "U", curva_usuario: [5,…,4], partida: { tipo: "pegado", referencia: null }, huella_calculo: h, version_vigente: null }` sin nota → `409 nota_requerida`; con nota → `201`, v1 con `modelo "U"`, `origen "propia"`, `origen_curva "usuario"`, `recomendada false`, **`eat null`**, `curva_manual.eat_en_muestra = 5.2`, `p05 = 0.11`, `p06 = 0.14`, foto con `resumen.curva_usuario` y `resultado.candidatas` sin `U`; repetir con `version_vigente: 1` → `409 sin_cambio`; cambiar un valor → v2; `PUT` de `A` → v3 con `origen_curva "sistema"` y `curva_manual = null`; con `sin_venta` (agrupación VACÍA) → `409 prerrequisitos`; con `origen = null` (PEQUEÑA sin años ni `T`) → `201`.
40. **Lista, avisos y M7**: tras 39, la lista da `estado = curva_usuario`, `vigente.modelo = "U"`; publicar un mes cerrado → sigue `curva_usuario` con `avisos_vigente = [cambio_desde_aprobacion: "1 mes publicado y cerrado después de …"]` y `obsoleta = null`; mover una equivalencia → otro aviso, no obsolescencia; `resumen.curvas_usuario = 1`, `obsoletas = 0`; `leerVigentesProy` devuelve la curva sin `eat_por_pliegue`; una unidad de M7 con esa agrupación al 30 % y otra con pliegue al 70 % → `eat_m6 = null`, `eat_m6_cobertura = 0.7`.
41. **Composición con parámetros y sin cálculo**: `tiendas_excluidas = [T2]` cambia `p_red`, totales y pesos sin cambiar `huellaRed`; `anios_excluidos = [2024]` deja `anios_curva = [2025]`; una agrupación de invierno sin periodos → `200` con `con_calculo = false`, pesos y unidades presentes, `se_aparta = null`, aviso `sin_calculo`; sin meses publicados → `409 sin_datos`.

Fixture **`P3`** para `F` y `T` (`tests/curvas.avanzada.fixture.ts`): agrupación de invierno con **tres** años de ajuste normales y una temporada cuya serie sale solo de **otras** agrupaciones (así `T_pliegue = T` en todos los pliegues): `p(2023) = 4 4 6 8 14 12 14 12 10 7 5 4`, `p(2024) = 4 4 6 8 12 14 14 12 10 7 5 4` (= `S`), `p(2025) = 4 4 6 8 10 16 14 12 10 7 5 4` (las tres suman 100; difieren solo en mayo y junio), `T = 4 4 8 8 12 14 14 12 10 5 5 4` (difiere de `S` en marzo y octubre). `recencia_f = 0.75`, `margen_ruido = 0.25`.

42. **`F` completa**: `ruido_normal = (EAT(23,24) + EAT(24,25) + EAT(23,25)) / 3 = (4 + 4 + 8) / 3 = 5.3333`; pesos `0.2432 / 0.3243 / 0.4324`; base `b`: may `0.2432·14 + 0.3243·12 + 0.4324·10 = 3.4054 + 3.8919 + 4.3243 = 11.6216`, jun `2.9189 + 4.5405 + 6.9189 = 14.3784`, resto `S`; `δ = EAT(b, T) = 2 + |11.6216 − 12| + |14.3784 − 14| + 2 = 4.7568`; `λ = 28.444 ÷ (28.444 + 3 × 22.627) = 28.444 ÷ 96.325 = 0.2953`; `F = 0.7047·b + 0.2953·T`: mar `4.2282 + 2.3624 = 6.5906`, oct `4.9329 + 1.4765 = 6.4094`, may `8.1897 + 3.5436 = 11.7333`, jun `10.1325 + 4.1342 = 14.2667`, resto `S`; suma `61 + 39.0 = 100.0`. Pesos visibles: 24 / 32 / 43 %; contracción 30 %.
43. **Backtesting sin fuga, pliegue a pliegue**: *sin 2023* (entrenamiento 2024 y 2025, `ρ = 4`, pesos `3/7`, `4/7`): base may `76/7 = 10.8571`, jun `106/7 = 15.1429`; `δ = 4 + 1.1429 + 1.1429 = 6.2857`; `λ = 16 ÷ (16 + 2 × 39.510) = 0.1684`; `q`: mar `6.3367`, oct `6.6632`, may `11.0496`, jun `14.9504`; `EAT(q, p(2023)) = 0.3367 + 0.3368 + 2.9504 + 2.9504 = 6.574`; `A` del pliegue (may 11, jun 15) → `6.0`; `T` → `8.0`. *Sin 2024* (`ρ = 8`): base may `82/7 = 11.7143`, jun `100/7 = 14.2857`; `δ = 4.5714`; `λ = 0.6049`; `q`: mar `7.2098`, oct `5.7902`, may `11.8871`, jun `14.1129`; `EAT(q, p(2024)) = 1.2098 + 1.2098 + 0.1129 + 0.1129 = 2.645`; `A` (= `S`) → `0.0`; `T` → `4.0`. *Sin 2025* (`ρ = 4`): base may `90/7 = 12.8571`, jun `92/7 = 13.1429`; `δ = 5.7143`; `λ = 16 ÷ (16 + 2 × 32.653) = 0.1968`; `q`: mar `6.3936`, oct `6.6064`, may `12.6885`, jun `13.3116`; `EAT(q, p(2025)) = 0.3936 + 0.3936 + 2.6885 + 2.6884 = 6.164`; `A` (may 13, jun 13) → `6.0`; `T` → `8.0`. Promedios: `EAT_F = 15.383 / 3 = 5.128`, `EAT_A = 4.0`, `EAT_T = 6.667`; `margen = 1.333` → **`A` recomendada**; la fila `F` dice "se equivoca 5.1 pp en 3 pruebas frente a 4.0 de A; no mejora a A". Perturbar `p(2023)` (×1.1 en unidades, misma forma, o cambiando mayo) no cambia `ρ = 4` ni `λ = 0.1684` del pliegue *sin 2023*.
44. **Explicación**: "F se apoya en 2023 (24 %), 2024 (32 %) y 2025 (43 %); contrae un 30 % hacia la curva de invierno (T) porque sus años normales difieren 5.3 pp entre sí y su curva está a 4.8 pp de la de la temporada. Se equivoca 5.1 pp en 3 pruebas frente a 4.0 de A; no mejora a A: se recomienda A."; `detalle_f = { pesos_anios: [{2023, 0.2432}, {2024, 0.3243}, {2025, 0.4324}], rho: 5.3333, delta: 4.7568, lambda: 0.2953, t_usada: T, base: b, contraida: F, por_pliegue: [{2023, 4, 0.1684, 6.574}, {2024, 8, 0.6049, 2.645}, {2025, 4, 0.1968, 6.164}] }`.
45. **Dos años y empate**: fixture `P2` = `P3` sin 2023: `F` existe (pesos `3/7`, `4/7`, `ρ = 4`, `λ = 0.1684`, curva `q` del pliegue *sin 2023* del caso 43), `eat = null`, `pruebas = 0`, motivo "sin backtesting honesto"; `A` = `S` con may 11, jun 15, EAT 4.0 (dos pliegues); `T`: `EAT_T = (4.0 + 8.0) / 2 = 6.0`; margen `max(0.05, 0.25 × 4) = 1.0` → `A`. Si `T` fuera `S` (δ de `A` a `T` = 0), `EAT_T = (4 + 4) / 2 = 4.0 = EAT_A` → empate, gana `A`.
46. **Agrupación pequeña y año Niño**: `ρ = 30`, `δ = 10`, `n = 2` → `λ = 0.8182` ("casi es la curva de la temporada" solo si `λ ≥ 0.9`: aquí no); 2023 atípico `descartado` → `F` se ajusta con 2024 y 2025 como `A`; 2023 `imputado` → usa la participación imputada; un año `escaso` no entra; con `VERSION_MODELO = 2`, una foto de la `0.9.7` muestra `modelo_anterior`.

## Hito de prueba (para recorrer con Cowork, usuario planner; nada se escribe salvo en los pasos marcados ✍️)

**Automático**

- [ ] `npm run lint`, `npx tsc --noEmit`, `npx vitest run` (todas las anteriores con las cuatro pruebas de `F` actualizadas, más `tests/curvas.composicion.*`, `tests/curvas.curva-usuario.*`, `tests/curvas.avanzada.*` y la ampliación de `tests/proyeccion.*` con `eat_m6_cobertura`), `npm run build` y `scripts/validar-migraciones-local.sh` (con `scripts/humo-0022.sql`: los cinco inserts incoherentes fallan) en verde; `0022` aplicada dos veces en `vector-two` (`select venta_composicion_agrupacion(null, '{}', current_date) ? 'nodos'` → `true`; `origen_curva` y `curva_manual` presentes; `select count(*) from curvas_estacionalidad where origen_curva <> 'sistema'` = 0 antes de aprobar nada); tipos regenerados; `APP_VERSION` con la etiqueta definitiva; PLAN §4, DECISIONES, CHANGELOG (con la tabla agregada del backtest offline, sin nombres), la cabecera de la 06b, la nota de versión de la 07 y `docs/pruebas/cowork-checklist.md` (sección D, pasos 15 a 26) actualizados.
- [ ] **Backtest offline** (`qa`): `scripts/backtest-fotos.ts` sobre las 13 vigentes cumple (a) a (d) de la regla 87; se anota cuántas gana `A`, `F` y `T` (referencia del revisor: `F` honesta 0 de 13; `T` 2 de 13, las de dos años).

**Prerrequisitos de Javier**: los de la 06b (periodos del Niño creados, las 15 con curva o en camino).

**Recorrido** (continúa la sección D del checklist; agrupación de invierno de hombre con 14 equivalencias y la agrupación mayor para medir tiempos; cifras agregadas sin nombres)

15. [ ] **Composición**: la tarjeta aparece plegada con "N GML · M equivalencias activas · k se apartan"; al desplegarla carga en **≤ 1.5 s en la agrupación mayor** (anotar `duracion_ms`); muestra los GML principales (≤ 12, ≈ 85 %) y "Otros N GML (x %)"; la suma de unidades de cada año coincide con el Total de la tabla año × mes; el total da 100 %; el buscador encuentra un GML de "Otros".
16. [ ] **Desplegar un GML**: equivalencias con unidades y % por año; una inactiva con venta aparece atenuada; "Otros" se despliega como lista con pesos y sin curva; "Descargar CSV" trae **todos** los GML y equivalencias.
17. [ ] **Ver en el gráfico y múltiplos**: marcar "ver" dibuja el GML en **Curvas de la agrupación**; las minicurvas solo aparecen en GML con ≥ 120 u. en algún año de ajuste.
18. [ ] **Se aparta y otras agrupaciones**: en un GML con ⚠, su EAT contra el resto supera el umbral mostrado (max(piso, ruido agrupación, ruido propio)) en todos sus años válidos; el aviso "también en otras N agrupaciones (x %)" aparece donde corresponde; "Reasignar en M3" abre Asignación. En una agrupación de invierno sin periodos (si Javier la deja así para la prueba), la composición se ve y "Se aparta" dice que no se evalúa.
19. [ ] **Parámetros y composición**: excluir una tienda cambia unidades y pesos con la misma huella que el cálculo nuevo; "Restablecer" los devuelve.
20. [ ] **Mi curva**: "Partir de A" → fila `U` "Igual a A"; mover mayo +2 y junio −2 → suma 100.0, "EAT … en muestra · ruido …", al lado el EAT en muestra de `A`; 98 de suma → alerta y "Normalizar"; pegar doce valores desde Excel (fila y columna; coma decimal; separados por espacio) rellena; once → "se esperaban 12".
21. [ ] ✍️ **Aprobar mi curva** (solo con autorización de Javier): sin nota → "nota requerida"; con nota → `confirm` con los doce valores, "en muestra", qué proponía el sistema, "no se marcará obsoleta"; "Curva del usuario aprobada como versión N"; la vista muestra "Aprobada vN (U)" igual a Mi curva; la lista dice "**Curva del usuario** · vN (el sistema proponía A)"; Versiones con badge; "Ver foto" dibuja esa curva con sus datos en muestra.
22. [ ] **La `U` no se obsoleta**: ✍️ cambiar y revertir la temporada de esa agrupación (con autorización): la fila sigue "Curva del usuario" con el aviso "desde que la aprobaste: la temporada pasó de …" y nunca "Obsoleta"; "Comparar con el sistema" funciona; en M7, "Antes de proyectar" muestra "1 agrupación con curva del usuario" y no la cuenta como obsoleta.
23. [ ] **Contrato con M7**: `/api/curvas/vigentes` devuelve 15 filas; la del paso 21 trae `modelo: "U"`, `origen_curva: "usuario"`, `curva` que suma 1; en una proyección en trabajo, una línea cuya unidad mezcla esa agrupación con otra muestra "sin backtesting (cubre x %)".
24. [ ] **Filas `F` y `T`**: en toda agrupación con ≥ 3 años de ajuste, `F` muestra "N pruebas", EAT, la explicación con pesos y contracción, y "Cómo se armó F" con ρ y λ por pliegue; `T` muestra EAT y pruebas; en las de 2 años, `F` dice "se muestra pero no compite"; las vigentes del sistema muestran **Modelo anterior** (no Obsoleta).
25. [ ] **Honestidad**: anotar en las 15 agrupaciones en cuántas `F` y `T` tienen menor EAT que `A` y en cuántas se recomiendan (solo si superan el margen); donde no ganan, la fila no dice "Recomendada" y la frase explica el margen; comparar con la tabla del backtest offline.
26. [ ] ✍️ **Aprobar `F` o `T`** (solo con autorización de Javier, donde él lo decida): si no es la recomendada pide nota; la versión queda con badge **Modelo avanzado** (`origen_curva = "avanzada"`) o **Prestada**; "Ver foto" reproduce la explicación y los pesos; `/api/curvas/vigentes` la devuelve; M7 toma su `eat_por_pliegue`. "Partir de F" en Mi curva copia sus doce valores.

Además, en cada paso: la versión del pie del menú es la definitiva de la entrega y no hay errores en la consola del navegador.

## Qué se reutiliza y qué se extiende

**Sin cambios**: `backtesting.ts`, `atipicos.ts`, `efecto.ts`, `red.ts`, `huellas.ts` (la curva del usuario **no** entra en la huella: es una decisión, no una entrada; `recencia_f` y `VERSION_MODELO` sí, como ya lo hacen), `prerrequisitos.ts`, `cache-venta.ts` (sin tocar; la composición tiene su caché), `venta_estacionalidad_agrupacion`, `GET /api/curvas/red-comparable`, `/api/periodos-atipicos*`, Años Niño. **Se extiende**: `tipos-api.ts` (`MODELOS_PROPIOS` + `F`, `MODELOS_APROBABLES`, `ORIGENES_CURVA`, estado `curva_usuario`, aviso `cambio_desde_aprobacion`, `CurvaManualApi`, `ComposicionAgrupacionApi`, `recencia_f`, `eat_en_muestra`/`explicacion_f`/`detalle_f`), `candidatas.ts`, `modelo.ts` (`curvaTDe`, `T` con EAT, `recomendar` con `T`), `esquemas.ts`, `reglas.ts`, `estado.ts`, `obsolescencia.ts`, `trabajo.ts`, `consultas.ts`, `lectura.ts`, `series.ts`, `vista.ts`, `trabajo-vista.ts`, los componentes listados, y en M7 `calculo.ts` (`eat_m6_cobertura`), `tipos-api.ts` y `antes-de-proyectar`. **Nuevo**: `composicion.ts`, `cache-composicion.ts`, `curva-usuario.ts`, `avanzada.ts`, la ruta `composicion`, `composicion-card.tsx`, `use-composicion.ts`, `curva-usuario-editor.tsx`, `scripts/backtest-fotos.ts`, `scripts/humo-0022.sql`, la migración `0022`.

## Fuera de alcance

- Curva propia por equivalencia (segunda entrega sobre la misma función con `p_grano = 'equivalencia'`).
- Reasignar desde M6; que M3 abra "Por agrupación" preseleccionada vía `?agrupacion=` (mejora mínima de M3, opcional).
- Bloquear meses al normalizar, deshacer/rehacer, borradores en la base, varias curvas del usuario en paralelo.
- Que `U` entre en `recomendar`, en el backtesting o en la banda mín–máx.
- En `F`: suavizado (medido, pierde), stacking, tendencia, covariables, LLM o servicios externos; edición en pantalla de `recencia_f` (va con los umbrales).
- Que M7 etiquete "curva del usuario" o "modelo avanzado" en cada fila (solo la cobertura del EAT y la línea de "Antes de proyectar").

## Riesgos

- **Tipos antes que datos**: si se aprueba una fila `U` o `F` antes de ampliar `esModeloCurva`/`MODELOS`/`aVigenteResumen`, la lista la mostraría como `A`. Mitigación: regla 71 y el orden de construcción (tipos y lectores primero, `PUT` al final).
- **EAT en muestra leída como fuera de muestra**: mitigación: `eat` de la fila `U` es `null`, la pantalla dice "en muestra" en todas partes y muestra la EAT en muestra de las candidatas al lado.
- **`U` que nadie revisa**: al no obsoletarse, una `U` puede quedar años sin que la lista la "grite". Mitigación: estado propio visible, avisos `cambio_desde_aprobacion` con el detalle, conteo `curvas_usuario` en el resumen y la línea en M7.
- **`F` presentada como "IA"**: en la base real `F` honesta no gana en ninguna agrupación hoy. Mitigación: solo se recomienda si gana por más del margen; la explicación es literal; el backtest offline lo mide y queda en el CHANGELOG; Javier decide si la mantiene a la vista o no (está en "Supuestos").
- **`T` compitiendo**: `T` puede ganar en agrupaciones de dos años (dos de las reales); aprobarla la hace `prestada` y se obsoleta por `temporada_recompuesta`, como hoy. Es lo pedido.
- **Contracción hacia una `T` que mezcla géneros**: `λ` solo crece cuando la agrupación es ruidosa o escasa frente a su diferencia con `T`; una `T` por temporada y género queda fuera (supuesto).
- **`VERSION_MODELO = 2`** marca todas las vigentes con `modelo_anterior` a la vez: aviso, no obsolescencia.
- **Composición pesada**: 4 671 filas GML × mes en la mayor; carga diferida, caché propia, objetivo ≤ 1.5 s medido; si no cabe, `otras` se separa.
- **`modelo` sin `check` de conjunto**: mitigación, `origen_curva` con sus checks de coherencia, comentarios y test estático.
- **Sin transacción al aprobar** (igual que la 06b).

## Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

35. **La composición de una agrupación se mide sobre la misma red comparable que su curva**, en pantalla solo los GML principales (85 % o 12) y "Otros", y el CSV completo. Descartado: pesos sobre toda la venta; equivalencia × tienda × mes; mostrar los 166 GML en la tabla.
36. **"GML que se aparta" se mide contra el resto de la agrupación**, con umbral `max(piso, ruido de la agrupación, ruido propio del GML)`, mínimo de 120 unidades por GML-año y en todos los años válidos; se informa cuando el GML vende en otras agrupaciones. Es diagnóstico; reasignar se hace en M3. Descartado: comparar contra la agrupación entera (el GML se compararía consigo mismo); un umbral fijo.
37. **La curva del usuario es el modelo `U`** (`modelo = 'U'`, `origen = 'propia'`, `origen_curva = 'usuario'`, `curva_manual`, `eat = null`, nota obligatoria, EAT en muestra solo en `curva_manual`) y **no se vuelve obsoleta sola**: los cambios de datos son avisos. Javier, 2026-10-16. Descartado: `origen = 'usuario'` (DROP); candidata sintética `U` en la foto; obsolescencia automática.
38. **El "modelo avanzado" es la candidata `F`, determinista y explicable**: base por recencia y contracción heurística hacia `T` (`λ = ρ² ÷ (ρ² + n·δ²)`), sin suavizado, con backtesting sin fuga (ρ y `T` del pliegue solo de entrenamiento), compitiendo bajo el mismo margen junto con `T` (también con backtesting honesto); `F` solo con dos o más años y solo compite con dos o más años de entrenamiento por pliegue; `VERSION_MODELO = 2`; backtest offline como condición de aceptación. La letra `F` significó "curva por género" en la 06 y luego se redefinió como `T`; desde aquí es el modelo avanzado. Javier, 2026-10-16. Descartado: suavizado Whittaker fijo o atado a λ (medido: pierde en 9 de 13 y aplana picos reales), stacking, mediana, LLM.
39. **Una sola entrega** para composición, `U` y `F`. Javier, 2026-10-16. Descartado: dividir en `0.9.8` y `0.9.9`.

## Preguntas abiertas

Ninguna que bloquee la construcción. Supuestos cerrados en esta versión que Javier puede cambiar después con una regla y su prueba: (a) `U` **no** se aprueba con cero venta (`sin_venta` bloquea; recomendación aceptada); (b) `F` contrae hacia la `T` de la temporada entera (mezcla géneros); (c) el borrador de "Mi curva" vive en `sessionStorage`; (d) `F` se mantiene visible aunque hoy no gane en ninguna agrupación real.

## Orden de construcción

1. **`datos`**: `0022_composicion_y_curva_usuario.sql` (columnas con checks de coherencia, función con `p_hasta` y CTE materializada, `comment on`), `scripts/humo-0022.sql`, `validar-migraciones-local.sh` en dos pasadas, aplicar en `vector-two`, regenerar tipos, medir la función en la agrupación mayor.
2. **`backend`** (en este orden): tipos y lectores que aceptan `F` y `U` (`MODELOS`, `esModeloCurva`, `esModeloAprobable`, `aVigenteResumen`…; actualizar las cuatro pruebas) → `avanzada.ts`, `curvaTDe`, `candidatas.ts`/`modelo.ts` (backtesting sin fuga, `T` con EAT, `eat_en_muestra`, `VERSION_MODELO = 2`, `recencia_f`) → `curva-usuario.ts`, `esquemas.ts`, `reglas.ts`, `estado.ts`, `obsolescencia.ts` (`curva_usuario`, `cambio_desde_aprobacion`), `trabajo.ts` → `composicion.ts`, `cache-composicion.ts`, `consultas.ts`, ruta `composicion` → `PUT` con `U` → M7 `eat_m6_cobertura` → `scripts/backtest-fotos.ts`.
3. **`frontend`**: candidatas (`F`, `T` con EAT, EAT en muestra), editor de Mi curva y sus series/filas, tarjeta Composición (principales, Otros, buscador, múltiplos, CSV), lista y versiones (estado `curva_usuario`, badges, avisos), "Ver foto" de `U`, M7 ("Antes de proyectar" y "sin backtesting (cubre x %)").
4. **`qa`**: reglas 60–87 (fixtures `SINT_INV`, `SINT_INV_G3`, `P3`, `P2`), prueba estática, backtest offline sobre las fotos reales con la tabla agregada, checklist de Cowork pasos 15–26, medición de tiempos.
5. **`seguridad`** (opus, solo lectura): `requirePlanner` en la ruta nueva, `p_red` y `p_hasta` nunca desde el cliente, límites del cuerpo (`curva_usuario` 12 valores, `partida` por tipo, caracteres prohibidos), caché y semáforo propios, nada de datos reales en el repo ni en el script offline.
