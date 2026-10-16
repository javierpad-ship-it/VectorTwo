# 07d · Venta esperada de una tienda nueva = venta mensual promedio (× 12, estacionalizada)

> Estado: **especificada el 2026-10-16, sin construir.** Corrección de M7 sobre `0.10.7`. Versión prevista **`0.10.8 · M7`** si se construye junto con [07c](07c-crecimientos-por-genero-mundo.md), que es lo recomendado: las dos suben `VERSION_METODO` a 4 y obligan a recalcular una sola vez. Si va sola, es **`0.10.9 · M7`** con `VERSION_METODO = 5`. Commits `M7:`. **Sin columna nueva ni renombre.** Solo se necesita un `comment on column`, que va en la `0023` de 07c o, si 07d va sola, en una `0024_venta_esperada_mensual.sql` de una sentencia. Depende de [07-proyeccion-anual](07-proyeccion-anual.md) (§5 paso 4, «Cambios 0.10.1» punto 3) y de [04-tiendas](04-tiendas.md). Sin datos reales: «T12 · Tienda nueva B» y su referente «T03» son ficticios, las cifras son sintéticas (el fixture del caso 9 de la ficha 07) y no se cita la cifra cargada en la base.

## 1. Objetivo

Javier aclara que `tiendas.venta_esperada_promedio` es **la venta mensual promedio esperada** de la tienda nueva. Hay que **multiplicarla por 12 y estacionalizarla en los meses en que la tienda estará abierta**. Desde `0.10.1`, M7 la trata como los soles de todo el año de apertura (decisión 22). Con una cifra mensual, la apertura sale unas 12·F veces más chica: cerca de 10 veces para una apertura en marzo. La propuesta de la tienda real quedó en pocos miles de unidades cuando debía ser de decenas de miles. Esta ficha cambia la fórmula, las etiquetas y las ayudas, sin tocar el modelo de datos.

## 2. Cómo funciona hoy (`0.10.2` a `0.10.7`) y por qué falla

`src/lib/proyeccion/tiendas-nuevas.ts` (cabecera), `calculo.ts` ~467-490, `decision.ts` ~445-480 y `servicio-edicion.ts` ~478-499:

- `E` = `venta_esperada_promedio`, leído como **soles del año de apertura**.
- `A_f = Σ_{m∈Z_0} c_m r_m φ_{Z_0,m}`: la fracción del año de apertura que vende la fila (curva × rampa × fracción de días del mes de apertura × Niño de `Z_0`). Función `fraccionDeFila`.
- `F = Σ_f s_f A_f` (`fraccionAnioApertura`) y `K = E ÷ F` (`anioMaduroSoles`).
- `Md_f = E s_f ÷ (p_f F)` (`unidadesMadurasDeFila`) y `P_f = round(Md_f A_f)`.

Con `E` mensual el resultado es `12 F` veces más chico. Además, como `K = E ÷ F`, **una apertura más tardía da más unidades**: con la misma cifra, T12 daría 708 u si abriera el 15 de marzo y 811 u si abriera el 1 de noviembre (§5). La fórmula no tiene sentido con una cifra mensual.

**IGV, cómo está hoy (confirmado en el código):** no hay ninguna conversión de IGV en `src/lib/proyeccion/` ni en `src/lib/tiendas/`. El campo se rotula «sin IGV», y `p_f` (precio medio por fila) sale de `venta_soles` de M5, que es neta de IGV. Mientras la cifra se cargue sin IGV, las dos están en la misma base. Si se cargó con IGV, todas las unidades de la apertura salen un 18 % altas (pregunta abierta 1). La ficha no añade ninguna división por 1,18.

## 3. Modelo de datos

- **Sin columna nueva ni renombre.** `venta_esperada_promedio numeric(14,2)` ya dice «promedio», que ahora es exacto. Los `check` (`>= 0`, solo tipo Tienda) no cambian.
- **`comment on column public.tiendas.venta_esperada_promedio`** (idempotente; en la `0023`, o en la `0024` si 07d va sola): *'M4/M7 0.10.8: venta mensual promedio esperada de la tienda en regimen, en soles netos de IGV. M7 la multiplica por 12 (anio maduro) y la reparte con la estacionalidad de cada fila en los meses en que la tienda esta abierta. Entre 0.10.1 y 0.10.7 se leia como soles del anio de apertura.'* Así queda escrito el nuevo significado y se reemplaza el de la `0021`.
- `proyeccion_tiendas.venta_esperada_usada` guarda la cifra tal cual. Desde el método 4 es la mensual. El significado de una fila ya guardada lo da `resumen.version_metodo` de su proyección.
- **No hay conversión de datos.** La cifra cargada ya es mensual (Javier lo confirma), así que no hay que reescribirla.

## 4. Fórmula nueva (método 4)

Sea `V` = `venta_esperada_promedio`: soles por mes, sin IGV, **en régimen** (una tienda ya abierta y estabilizada).

| Símbolo | Fórmula | Qué es |
|---|---|---|
| `S` | `12 × V` | **Año maduro en soles.** Reemplaza a `K = E ÷ F`: ya no se deduce, se lee. |
| `s̃_f` | `s_f ÷ Σ_{f con curva} s_f` | Composición del referente (o de la red), renormalizada a las filas con curva. Una fila sin curva no se puede estacionalizar: queda sin propuesta (`sin_curva`) y su parte se reparte entre las demás. Hoy pasa lo mismo, de forma implícita, al dividir por `F`. |
| `A_f` | `Σ_{m∈Z_0} c_{u(f),m} × r_m × φ_{Z_0,m}` | **Sin cambio** (`fraccionDeFila`, `rampaMensual`). |
| `F` | `Σ_f s̃_f A_f` | **Sin cambio de definición** (`fraccionAnioApertura`): qué fracción de un año maduro vende la tienda en su año de apertura. **Ya no divide nada**: solo se muestra y alimenta el aviso `apertura_tardia`. |
| `Md_f` | `S × s̃_f ÷ p_f` | Unidades maduras por año de la fila. |
| `P_{t,f,Z_0}` | `round(Md_f × A_f)` | Propuesta del año de apertura, repartida con `(c_m r_m)` como hoy. |
| `E` (derivada) | `S × F` | Soles del año de apertura; solo para mostrar. `Σ_f P_f p_f ≈ E ± Σ_f p_f ÷ 2`. |

**Rampa.** `V` es la venta **en régimen**, así que la rampa se sigue aplicando encima (`r_m` en `A_f`). La rampa por defecto `[1, 1, 1]` (decisión 18) no cambia nada. Si Javier pone un pico al abrir (por ejemplo `[3, 1,5, 1]`), el año de apertura vende más que `S × Σ c` en esos meses, y eso es intencional: la rampa existe para eso. Si su `V` ya incluye el efecto de apertura, debe dejar la rampa en `1 · 1 · 1`. La ayuda del campo de la rampa lo dice.

**Los demás métodos de tienda usan `Md_f` y cambian solos, sin código aparte:** `apertura` en `Y` con menos de 3 meses completos (resto = `Md_f × Σ_{m>k} c r φ`); `referencia_alternativa` «por venta esperada» en `avance_propio` y en `maduro_propio` (`Md_f × Σ_m c r φ`); `unidades_maduras` de la tienda (`Σ_f Md_f`, `proyeccion_tiendas.unidades_maduras`). `avance_propio` y `maduro_propio` no usan `V` para su propuesta.

**Cambios de código** (para `backend`; esta ficha no escribe código):
- `tiendas-nuevas.ts`: comentario de cabecera; `unidadesMadurasDeFila({ V, s, sumaSConCurva, p })` = `12 V s ÷ (p × sumaSConCurva)` (0 si `p` o la suma son 0); `anioMaduroSoles(V) = 12 V`; nueva `ventaAnioApertura(V, F) = 12 V F` (`null` sin `F`). `fraccionAnioApertura` recibe `s̃`.
- `calculo.ts` ~467-490 y `decision.ts` ~445-456 / ~471-480: dejan de pasar `F` a `Md_f` y calculan `sumaSConCurva`. `servicio-edicion.ts` ~478-499 pasa `ventaAnioApertura` y `anioMaduroSoles(V)` a la explicación.
- `explicar.ts`, caso `apertura` (texto en §6). `bloques.ts:21`, `src/lib/tiendas/tipos.ts:37` y `src/lib/tiendas/tipos-api.ts:32`: comentarios.
- `tipos-api.ts`: `VERSION_METODO = 4` (o 5) y el comentario de la venta esperada. `TiendaProyeccionApi` gana `escala: { venta_mensual: number; anio_maduro: number; fraccion: number | null; venta_anio_apertura: number | null } | null` (solo aperturas con `V`), para que la tarjeta muestre las cifras sin tener que interpretar el texto.
- `acotar` y `cifra_excesiva` se mantienen: un `p_f` casi 0 todavía podría desbordar. Al no dividir por `F`, una apertura tardía ya no desborda.

## 5. Ejemplo numérico (T12 · Tienda nueva B, ficticia)

T12 abre el **2027-03-15** con referente T03. Composición de T03 (sintética, la del caso 9 de la ficha 07): DENIM × RECONOCIDO con el 70 % de los soles, `p = 100` y curva plana; ABRIGO × RECONOCIDO con el 30 %, `p = 200` y curva de invierno `[.02,.02,.06,.12,.20,.24,.16,.08,.04,.02,.02,.02]`. **`V = 85 000` S/ al mes sin IGV**, sin rampa (`[1, 1, 1]`) y 2027 no atípico.

- Marzo cuenta `17/31 = 0,548387`. `A_DENIM = (0,548387 + 9) ÷ 12 = 0,795699`. `A_ABRIGO = 0,06 × 0,548387 + 0,90 = 0,932903`. `F = 0,7 × 0,795699 + 0,3 × 0,932903 = 0,836860`.
- `S = 12 × 85 000 = 1 020 000`. `Md_DENIM = 1 020 000 × 0,7 ÷ 100 = 7 140`. `Md_ABRIGO = 1 020 000 × 0,3 ÷ 200 = 1 530`. Año maduro: **8 670 u**.
- `P_DENIM = round(7 140 × 0,795699) = 5 681`. `P_ABRIGO = round(1 530 × 0,932903) = 1 427`. **T12 2027 = 7 108 u**.
- En soles: `5 681 × 100 + 1 427 × 200 = 853 500 ≈ E = 1 020 000 × 0,836860 = 853 597`.
- **Hoy (método 3), con la misma cifra** leída como soles del año de apertura: `K = 85 000 ÷ 0,836860 = 101 571` → DENIM 566, ABRIGO 142, **T12 = 708 u**. Es `12 F = 10,04` veces menos: el defecto que reportó Javier.
- Con la rampa explícita `[0,7, 0,85, 1]`: `A_DENIM = 0,76949`, `A_ABRIGO = 0,90503`, `F = 0,81015` → DENIM `round(7 140 × 0,76949) = 5 494`, ABRIGO `round(1 530 × 0,90503) = 1 385`, **T12 = 6 879 u** (`E = 826 353`). Coincide con la cifra «mensual» de la ficha 07 para `0.10.0`.

## 6. Casos

| Caso | Comportamiento |
|---|---|
| **Apertura a mitad de mes** | Como hoy: el mes de apertura cuenta `rampa[0] × días abiertos ÷ días del mes` (15 de marzo → `17/31`). Abrir el día 1 cuenta el mes entero. |
| **Apertura tardía (`F < 0,25`)** | T12 el 2027-11-01: `A_DENIM = 2/12 = 0,1667`, `A_ABRIGO = 0,04`, `F = 0,1287` → DENIM 1 190, ABRIGO 61, **1 251 u** (`E = 131 240`). La cifra es baja porque la tienda vende dos meses, y está bien. El aviso `apertura_tardia` se mantiene, informativo, con texto nuevo: «Abre tarde: en 2027 vende el 12,9 % de un año maduro (S/ 131 240 de S/ 1 020 000). En 2028 pasará a nueva del año anterior.» Ya no habla de un «año maduro deducido» porque ya no se deduce. Hoy daría 811 u, más que abriendo en marzo. |
| **Sin referente** | Composición de la red (promedio de las mismas tiendas de `Z` con igual peso, `origen_composicion = red`), con la misma fórmula. Avisos `sin_referente` / `referente_sin_historia` como hoy. |
| **`venta_esperada_promedio` nula** | Como hoy: `propuesto = null`, aviso `sin_venta_esperada`, método `sin_propuesta`. Javier puede escribir el total de la tienda, que se reparte con la composición y las curvas. La tienda no bloquea el cierre (`motivoRechazoCerrar` solo exige decidir las tiendas con venta esperada). |
| **`V = 0`** | `S = 0`: todas las filas proponen 0. Se acepta (el `check` permite 0). |
| **Apertura y cierre en el mismo año** (`fecha_apertura` y `fecha_cierre` en `Z`) | `bloques.ts:77` la clasifica como **cierre de `Z`** y la propone por el método de cierre (composición propia, que en una tienda nueva está vacía), así que **la venta esperada no se usa**. **No cambia con 07d** (fuera de alcance; hoy no hay ningún caso cargado). Javier escribe el total si llegara a pasar. |
| **Abre en `Y` y cierra en `Y+1`** | En `Y` es apertura (fórmula nueva). En `Y+1` es cierre, con composición propia sobre sus meses reales, como hoy. |
| **Tienda nueva con meses reales y `n ≥ 3`** | Propuesta por avance propio, sin cambio. Solo crece la referencia «por venta esperada» que se muestra al lado. |
| **Filas sin curva** | Quedan sin propuesta (`sin_curva`) y fuera de `s̃`. Las demás filas se reparten el 100 % de `S × F`. |
| **Total de la tienda ya decidido** | Se conserva (decisión 33). Al recalcular, la propuesta sube unas 10 veces y la tienda queda con «propuesta cambió». Las filas fijadas a mano se conservan (07b). Javier debe revisarla (hito, paso 3). |

**Etiquetas y ayudas.**

| Dónde | Hoy | Desde 07d |
|---|---|---|
| M4 · `formulario-tienda.tsx` ~194-198 | «Venta esperada del año de apertura (S/, sin IGV)» · «Soles que la tienda venderá desde que abre hasta el 31 de diciembre…» | **«Venta mensual promedio esperada (S/, sin IGV)»** · *«Soles que la tienda venderá en un mes promedio, ya en régimen y sin IGV. M7 la multiplica por 12 y la reparte con la estacionalidad en los meses en que la tienda esté abierta: si abre en marzo, en ese año solo cuentan de marzo a diciembre.»* |
| M4 · `importar-tiendas.tsx` ~50 | hint del año de apertura | La misma ayuda. La columna `VENTA_ESPERADA` ya acepta el alias `VENTA_MENSUAL`. |
| M4 · `calendario-tab.tsx` ~178 y cabecera «Venta esp.» de `tiendas-tab.tsx` | título del año de apertura | «Venta mensual promedio esperada (S/, sin IGV)»; cabecera «Venta esp./mes». |
| M7 · `atajo-tienda.tsx` ~83 | ídem M4 | La misma etiqueta y ayuda de M4. |
| M7 · `tarjeta-tienda.tsx` ~417-422 | «venta esperada del año de apertura S/ … (sin IGV, desde que abre hasta el 31 de diciembre)» | «venta esperada **S/ 85 000 al mes** (sin IGV, en régimen) · año maduro S/ 1 020 000 · en 2027 abre el 15-mar y vende el 83,7 % del año → S/ 853 597», a partir de `escala`. |
| M7 · `tiendas-tab.tsx` ~80 | «venta esperada del año de apertura» | «venta mensual promedio esperada». |
| M7 · explicación (`explicar.ts`, `apertura`) | «venta esperada S/ … en 2027, su año de apertura (sin IGV) · la tienda alcanza el 81,0 % de un año maduro → año maduro S/ …» | «venta esperada S/ 85 000 al mes en régimen (sin IGV) × 12 = año maduro S/ 1 020 000; abre el 15 de marzo: en 2027 vende el 83,7 % de un año (S/ 853 597), composición de T03, sin rampa → año maduro 8 670 u → 7 108 u en 2027». |
| Ficha 04 (tabla de columnas, §45, pantalla) y ficha 07 (glosario `E`, paso 4, «Cambios 0.10.1» punto 3) | año de apertura | Las actualiza el `documentador`, con una nota de que 07d supera la decisión 22. |

## 7. Contratos de API

No cambia ninguna ruta ni ningún esquema de entrada. `monto` de `src/lib/tiendas/esquemas.ts` sigue siendo `>= 0` y nullable. Lo único nuevo es `TiendaProyeccionApi.escala` (§4), solo lectura y `requirePlanner` como toda la API de M7. `GET /api/tiendas` sigue ocultando `venta_esperada_promedio` al comprador.

**Proyecciones ya calculadas.** `VERSION_METODO` sube (a 4 con 07c; a 5 si va sola). Toda proyección en trabajo pasa a «desactualizada: método nuevo». `cerrar?forzar=1` la rechaza con `409 version_metodo` (0.10.3) hasta recalcular. **La huella de tiendas no salta**: el valor de la columna no cambia, así que no aparece `tiendas_cambiadas`, y es correcto porque no hay que reescribirlo. El cambio lo detecta la versión del método. Recalcular conserva los totales decididos y las filas fijadas, y marca «propuesta cambió». **Una cerrada no cambia nunca**: si se cerró una con método ≤ 3 y una apertura con cifra mensual, sus aperturas están subestimadas unas 10 veces.

**Impacto en el contrato de M8 (`GET /api/proyeccion/cerrada`).** La forma no cambia. Cambian los valores de las filas `bloque = nuevas` / `subbloque = aperturas` (total y `meses`), que pasan a ser unas `12 F` veces mayores, y con ellos los totales por GML-AM que lea M8. `bloques[anio].nuevas[].venta_esperada` y `proyeccion_tiendas.venta_esperada_usada` pasan a ser mensuales. **Propuesta para la ficha 08:** M8 exige una cerrada con `version_metodo ≥ 4` (si `ProyeccionApi` no lo expone, se añade `version_metodo` desde `resumen`) y, si no, avisa `cerrada_metodo_anterior` («la cerrada se calculó antes de 0.10.8: aperturas y crecimientos con el método anterior; cierra una nueva»). Va en la línea del aviso `cerrada_sin_periodo` que M8 ya tiene para las cerradas de `0.10.0`.

## 8. Reglas de negocio (vitest, `tests/proyeccion.tiendas-nuevas*.test.ts`; puras salvo donde dice «ruta»)

1. `anioMaduroSoles(85 000) = 1 020 000`; `unidadesMadurasDeFila` = `12 V s ÷ (p × Σ s con curva)`; 0 con `p = 0`.
2. El ejemplo de §5 da 7 108 (sin rampa), 6 879 (rampa `[0,7, 0,85, 1]`) y 1 251 (apertura el 1 de noviembre), con `E` = 853 597 / 826 353 / 131 240.
3. Propiedad: `Σ_f round(Md_f A_f) × p_f = 12 V F ± Σ_f p_f ÷ 2`; las unidades crecen de forma monótona con `V` y **decrecen** al atrasar la fecha de apertura, con la misma rampa.
4. Apertura el 1 de enero sin rampa → `F = 1` y `P_f = round(12 V s̃_f ÷ p_f)`.
5. Una fila sin curva queda `sin_curva`, sale de `s̃`, y la suma de soles de las demás es `12 V F`.
6. `F < 0,25` → `apertura_tardia` con el texto nuevo; sin `V` → `sin_propuesta` y `sin_venta_esperada`; `V = 0` → todas las filas en 0.
7. `apertura` en `Y` con `n < 3`, y las referencias «por venta esperada» de `avance_propio` / `maduro_propio`, usan el `Md_f` nuevo.
8. `VERSION_METODO` subido: una proyección en trabajo calculada con el método anterior da `version_metodo` en `motivosDesactualizada`; recalcular conserva `decidido` de la tienda y de las filas fijadas y marca `propuesta_cambio`.
9. Estático: ningún texto bajo `src/app/(app)/maestros/tiendas/` ni `src/app/(app)/planificacion/proyeccion/` dice «año de apertura» como significado de la venta esperada; las cinco pantallas de §6 dicen «mensual promedio».
10. Ruta: `GET …/tiendas` devuelve `escala` en las aperturas con `V` y `null` en las demás; el comprador recibe `403`.

## 9. Criterios de aceptación (hito de Javier)

1. En Tiendas (M4), el campo dice «Venta mensual promedio esperada (S/, sin IGV)» con la ayuda nueva, y la cifra cargada no cambió.
2. La proyección en trabajo dice «desactualizada: método nuevo». [ESCRIBE] Recalcular.
3. En Tiendas nuevas y cierres, la apertura de 2027 muestra «S/ … al mes · año maduro S/ … · en 2027 vende el x % del año → S/ …» y una propuesta del orden de decenas de miles de unidades. Comprobar a mano una fila con §4. Si su total estaba decidido, sigue decidido con «propuesta cambió»: [ESCRIBE] decidir de nuevo o volver a la propuesta.
4. En Por línea, la sección de la apertura (07b), la barra de 2027, el «Total línea» y la columna de aperturas de la Matriz cuadran con la cifra nueva.
5. Pasan `lint`, `tsc`, `vitest` y `build`, y `APP_VERSION` es `0.10.8 · M7` (con 07c) o `0.10.9 · M7`.

## 10. Fuera de alcance

Proyectar por venta esperada una tienda que abre y cierra en el mismo año (hoy va por el método de cierre); convertir IGV automáticamente; una venta esperada distinta por mes o por temporada; renombrar la columna; cambiar la rampa por defecto.

**Propuesta para `docs/DECISIONES.md` (2026-10-16; la registra el `documentador`):** «La venta esperada de una tienda nueva es su venta **mensual promedio en régimen**, en soles sin IGV. M7 calcula el año maduro `S = 12 × V` y lo estacionaliza en los meses abiertos con la curva de cada fila y la rampa (`P_f = round(12 V s̃_f ÷ p_f × A_f)`).» **Supera la decisión 22** (ronda 4: «soles del año de apertura») y la entrada de `0.10.1` de la ficha 07. Descartado: soles del año de apertura (deducía el año maduro dividiendo por `F`, de modo que una cifra mensual daba ~10 veces menos y una apertura tardía daba más unidades); renombrar la columna. En `08-09-definiciones-del-dueno.md`, la 22 se marca como superada.

## Preguntas abiertas (solo Javier)

1. **¿La venta mensual promedio que cargaste es sin IGV?** El sistema no convierte IGV: compara tu cifra con precios medios netos de IGV (M5). Si la cifra incluye IGV, divídela por 1,18 en Tiendas; si no, las unidades de la apertura salen un 18 % altas.
