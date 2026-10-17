# 07d · Venta esperada de una tienda nueva = venta mensual promedio (× 12, estacionalizada)

> Estado: **lista para construir (2026-10-16).** Se especificó y se revisó el mismo día con la revisión independiente y las decisiones finales de Javier (ver «Cambios tras la revisión independiente»). Corrige M7 sobre `0.10.7`.
>
> - **Versión:** `0.10.8 · M7`. Se construye junto con [07c](07c-crecimientos-por-genero-mundo.md): las dos suben `VERSION_METODO` a 4 y obligan a recalcular una sola vez. Commits `M7:`.
> - **Modelo de datos:** sin columna nueva ni renombre. Solo un `comment on column`, que va en la `0023` de 07c.
> - **Depende de:** [07-proyeccion-anual](07-proyeccion-anual.md) (§5 paso 4, «Cambios 0.10.1» punto 3) y [04-tiendas](04-tiendas.md).
> - **Datos:** sintéticos. «T12 · Tienda nueva B» y su referente «T03» son ficticios, las cifras salen del fixture del caso 9 de la ficha 07 y no se cita la cifra cargada en la base.
> - **Estado de la base según la revisión independiente:** una sola proyección en trabajo (método 3), ninguna cerrada y ninguna tienda con `fecha_cierre`.

## 1. Objetivo

`tiendas.venta_esperada_promedio` es **la venta mensual promedio esperada** de la tienda nueva, en régimen y **sin IGV**. M7 debe **multiplicarla por 12 y estacionalizarla en los meses en que la tienda estará abierta** (decisión 7 de Javier).

Desde `0.10.1`, M7 la trata como los soles de todo el año de apertura (decisión 22). Con una cifra mensual, la apertura sale unas 12·F veces más chica, cerca de 10 veces para una apertura en marzo: la propuesta de la tienda real quedó en pocos miles de unidades cuando debía ser de decenas de miles.

Esta ficha cambia la fórmula, las etiquetas, las ayudas y los alias del importador, sin tocar el modelo de datos.

## 2. Cómo funciona hoy (`0.10.2` a `0.10.7`) y por qué falla

Código afectado: `src/lib/proyeccion/tiendas-nuevas.ts` (cabecera y `:23-48`), `calculo.ts` ~467-490, `decision.ts` ~445-480 y `servicio-edicion.ts` ~478-499.

- `E` = `venta_esperada_promedio`, leído como **soles del año de apertura**.
- `A_f = Σ_{m∈Z_0} c_m r_m φ_{Z_0,m}` es la fracción del año de apertura que vende la fila (curva × rampa × fracción de días del mes de apertura × Niño de `Z_0`). Función `fraccionDeFila`.
- `F = Σ_{f con curva} s_f A_f`, **con `s_f` sin renormalizar** (`fraccionAnioApertura`), y `K = E ÷ F` (`anioMaduroSoles`).
- `Md_f = E s_f ÷ (p_f F)` (`unidadesMadurasDeFila`) y `P_f = round(Md_f A_f)`.

Por qué falla:
- **Escala:** con `E` mensual, el resultado sale `12 F` veces más chico.
- **Orden de las fechas:** como `K = E ÷ F`, **una apertura más tardía da más unidades**. Con la misma cifra, T12 daría 708 u si abriera el 15 de marzo y 811 u si abriera el 1 de noviembre (§5).
- **Rampa:** `Σ_f P_f p_f = E` para cualquier rampa, así que en el método 3 la rampa **no movía el total** del año de apertura, solo su forma.

**IGV (decisión 3 de Javier): la venta NUNCA incluye IGV.** Vale para `venta_esperada_promedio` y para toda venta cargada. El sistema no convierte nada: no hay ninguna conversión de IGV en `src/lib/proyeccion/` ni en `src/lib/tiendas/`, y esta ficha no añade ninguna. `p_f` sale de `venta_soles` de M5, que también es neta, así que las dos cifras están en la misma base.

## 3. Modelo de datos

- **Sin columna nueva ni renombre.** `venta_esperada_promedio numeric(14,2)` ya dice «promedio», que ahora es exacto. Los `check` (`>= 0`, solo tipo Tienda) no cambian.
- **`comment on column public.tiendas.venta_esperada_promedio`**, idempotente, en la `0023`: *'M4/M7 0.10.8: venta mensual promedio esperada de la tienda en regimen, en soles sin IGV (nunca incluye IGV; el sistema no convierte). M7 la multiplica por 12 (anio maduro) y la reparte con la estacionalidad y la rampa de cada fila en los meses en que la tienda esta abierta. Entre 0.10.1 y 0.10.7 se leia como soles del anio de apertura.'* Reemplaza el comentario de la `0021`.
- `proyeccion_tiendas.venta_esperada_usada` guarda la cifra tal cual. Desde el método 4 es la mensual. Lo que significa una fila ya guardada lo dice `resumen.version_metodo` de su proyección.
- **Sin conversión de datos.** La cifra cargada ya es mensual (Javier lo confirma).

## 4. Fórmula nueva (método 4)

`V` = `venta_esperada_promedio`, en soles por mes, sin IGV y **en régimen** (una tienda ya abierta y estabilizada).

| Símbolo | Fórmula | Qué es |
|---|---|---|
| `S` | `12 × V` | **Año maduro en soles.** Reemplaza a `K = E ÷ F`: ya no se deduce, se lee. |
| `s̃_f` | `s_f ÷ Σ_{f con curva} s_f` | Composición del referente (o de la red), renormalizada a las filas con curva. Una fila sin curva no se puede estacionalizar: queda sin propuesta (`sin_curva`) y su parte se reparte entre las demás. |
| `A_f` | `Σ_{m∈Z_0} c_{u(f),m} × r_m × φ_{Z_0,m}` | **Sin cambio** (`fraccionDeFila`, `rampaMensual`). |
| `F` | `Σ_f s̃_f A_f` | Qué fracción de un año maduro vende la tienda en su año de apertura. **Cambia de definición:** hoy usa `s_f` sin renormalizar, y con `s̃` sube cuando hay filas sin curva (en la apertura cargada, cerca de 1,6 pp según la revisión). Sin filas sin curva no cambia. **Ya no divide nada:** solo se muestra y alimenta el aviso `apertura_tardia`. |
| `Md_f` | `S × s̃_f ÷ p_f` | Unidades maduras por año de la fila. |
| `P_{t,f,Z_0}` | `round(Md_f × A_f)` | Propuesta del año de apertura, repartida con `(c_m r_m φ_m)` como hoy. |
| `E` (derivada) | `S × F` | Soles del año de apertura, solo para mostrar. `Σ_f P_f p_f ≈ E ± Σ_f p_f ÷ 2`. |

**Rampa (decisión 4 de Javier).** `V` es la venta **en régimen**, así que la rampa se sigue aplicando encima (`r_m` en `A_f`).
- **Rampa por defecto:** `[1, 1, 1]` (decisión 18) no cambia nada.
- **La apertura de 2027 cargada:** tiene rampa `1,5 · 1 · 0,75`, que es el **pico real de apertura**. Se conserva.
- **Diferencia con el método 3:** allí `Σ P·p = E` para cualquier rampa, así que la rampa solo daba forma. **Con el método 4 la rampa sí mueve el total del año de apertura.** En la apertura cargada, la revisión mide unas unidades **≈ 0,5 % menores** que con rampa plana: el 1,5 cae sobre un mes de apertura parcial y el 0,75 sobre un mes entero. En T12 sintético pasa lo mismo: 7 108 → 7 072 u (−0,5 %, §5). Es lo esperado y se comprueba en el hito.
- **Ayuda del campo de la rampa:** «La venta mensual es en régimen; la rampa la multiplica en los primeros meses (1 = sin efecto). Si tu venta ya incluye el efecto de apertura, deja 1 · 1 · 1.»

**Niño del año de apertura.** `φ_{Z_0}` **sí** mueve el nivel de una apertura, porque está dentro de `A_f`. En cambio, el % de mismas tiendas de 07c es bruto y `φ_{Y+1}` solo le da forma. La asimetría es intencional: `V` es de un año normal y el % de mismas tiendas ya incluye el Niño (07c §2.4).

**Los demás métodos de tienda usan `Md_f` y cambian solos, sin código aparte:**
- `apertura` en `Y` con menos de 3 meses completos: resto = `Md_f × Σ_{m>k} c r φ`;
- `referencia_alternativa` «por venta esperada» en `avance_propio` y en `maduro_propio`: `Md_f × Σ_m c r φ`;
- `unidades_maduras` de la tienda: `Σ_f Md_f`, en `proyeccion_tiendas.unidades_maduras`.

`avance_propio` y `maduro_propio` no usan `V` para su propuesta.

**Cambios de código** (para `backend`; esta ficha no escribe código):
- **`tiendas-nuevas.ts`:**
  - comentario de cabecera;
  - `unidadesMadurasDeFila({ V, s, sumaSConCurva, p })` = `12 V s ÷ (p × sumaSConCurva)` (0 si `p` o la suma son 0);
  - `anioMaduroSoles(V) = 12 V`;
  - nueva `ventaAnioApertura(V, F) = 12 V F` (`null` sin `F`);
  - `fraccionAnioApertura` recibe `s̃`.
- **`calculo.ts` ~467-490 y `decision.ts` ~445-456 / ~471-480:** dejan de pasar `F` a `Md_f` y calculan `sumaSConCurva`.
- **`servicio-edicion.ts` ~478-499:** pasa `ventaAnioApertura` y `anioMaduroSoles(V)` a la explicación.
- **`explicar.ts`, caso `apertura`:** texto en §6. Comentarios en `bloques.ts:21`, `src/lib/tiendas/tipos.ts:37` y `src/lib/tiendas/tipos-api.ts:32`.
- **`tipos-api.ts`:**
  - `VERSION_METODO = 4` y el comentario de la venta esperada;
  - `TiendaProyeccionApi` gana `escala: { venta_mensual: number; anio_maduro: number; fraccion: number | null; venta_anio_apertura: number | null; con_meses_reales: boolean } | null`, solo para aperturas con `V`;
  - `con_meses_reales = true` si el año de la tarjeta es `Y` y la tienda ya tiene meses cerrados (`fecha_apertura ≤ hasta_periodo`).
- **Aviso `apertura_y_cierre`** (nuevo en `AvisoFila`, de tienda): se emite cuando una tienda de `bloque = cierres` en `Y+1` tiene `fecha_apertura` en `Y+1` (§6).
- **Importador de M4 (`importar-tiendas.tsx:44-51`):**
  - se quitan los alias `VENTA_ESPERADA_ANIO_APERTURA` y `VENTA_APERTURA`;
  - se añaden `VENTA_MENSUAL` y `VENTA_PROMEDIO_MENSUAL`;
  - quedan `VENTA_ESPERADA`, `VENTA_ESPERADA_PROMEDIO`, `VENTA_MENSUAL` y `VENTA_PROMEDIO_MENSUAL`;
  - la etiqueta y el hint pasan a ser mensuales (§6);
  - el comentario de `:47`, que hoy excluye a propósito los alias mensuales, se reescribe: ahora se excluyen los alias **anuales**, porque un Excel con la venta del año se cargaría 12 veces de más.
- **Opcional (aviso informativo `venta_esperada_fuera_de_rango`, de tienda, en M7):**
  - se emite si `12·V` cae fuera de `[0,3, 3]` veces la venta anual media en soles de una tienda de la red (media de `total_S` de las composiciones W12 de las mismas tiendas, que el cálculo ya arma para `composicionPromedio`);
  - va en M7 y no en el importador, porque el importador no lee venta;
  - no toca el IGV, que nunca se incluye;
  - si `backend` no lo ve barato, se omite sin afectar al hito.
- **`acotar` y `cifra_excesiva` se mantienen:** un `p_f` casi 0 todavía podría desbordar. Al no dividir por `F`, una apertura tardía ya no desborda.

## 5. Ejemplo numérico (T12 · Tienda nueva B, ficticia)

**Datos.** T12 abre el **2027-03-15** con referente T03. La composición de T03 es la sintética del caso 9 de la ficha 07:
- DENIM × RECONOCIDO: 70 % de los soles, `p = 100` y curva plana;
- ABRIGO × RECONOCIDO: 30 % de los soles, `p = 200` y curva de invierno `[.02,.02,.06,.12,.20,.24,.16,.08,.04,.02,.02,.02]`.

**`V = 85 000` S/ al mes sin IGV**, sin rampa (`[1, 1, 1]`), y 2027 no es atípico. Todas las filas tienen curva, así que `s̃ = s`.

**Sin rampa:**
- **Fracciones:** marzo cuenta `17/31 = 0,548387`. `A_DENIM = (0,548387 + 9) ÷ 12 = 0,795699`. `A_ABRIGO = 0,06 × 0,548387 + 0,90 = 0,932903`. `F = 0,7 × 0,795699 + 0,3 × 0,932903 = 0,836860`.
- **Año maduro:** `S = 12 × 85 000 = 1 020 000`. `Md_DENIM = 1 020 000 × 0,7 ÷ 100 = 7 140`. `Md_ABRIGO = 1 020 000 × 0,3 ÷ 200 = 1 530`. Total: **8 670 u**.
- **Propuesta:** `P_DENIM = round(7 140 × 0,795699) = 5 681`. `P_ABRIGO = round(1 530 × 0,932903) = 1 427`. **T12 2027 = 7 108 u**.
- **En soles:** `5 681 × 100 + 1 427 × 200 = 853 500 ≈ E = 1 020 000 × 0,836860 = 853 597`.

**Con otras rampas y con el método anterior:**

| Caso | Fracciones | Propuesta | `E` |
|---|---|---|---|
| **Hoy (método 3)**, misma cifra leída como soles del año de apertura | `K = 85 000 ÷ 0,836860 = 101 571` | DENIM 566 + ABRIGO 142 = **708 u** | — |
| Rampa explícita `[0,7, 0,85, 1]` | `A_DENIM = 0,769489`, `A_ABRIGO = 0,905032`, `F = 0,810152` | DENIM `round(7 140 × 0,769489) = 5 494` + ABRIGO `round(1 530 × 0,905032) = 1 385` = **6 879 u** | **826 355** |
| Rampa de pico `[1,5, 1, 0,75]` (la forma de la apertura cargada) | `A_DENIM = 0,797715`, `A_ABRIGO = 0,899355`, `F = 0,828207` | DENIM 5 696 + ABRIGO 1 376 = **7 072 u** | 844 771 |

- **Método 3:** 708 u es `12 F = 10,04` veces menos, el defecto que reportó Javier.
- **Rampa `[0,7, 0,85, 1]`:** coincide con la cifra «mensual» de la ficha 07 para `0.10.0`.
- **Rampa de pico:** queda **−0,5 %** frente a la plana, la misma magnitud que mide la revisión en la apertura real. Con el método 3 las tres rampas daban el mismo total en soles.

## 6. Casos

| Caso | Comportamiento |
|---|---|
| **Apertura a mitad de mes** | Como hoy: el mes de apertura cuenta `rampa[0] × días abiertos ÷ días del mes` (15 de marzo → `17/31`). Abrir el día 1 cuenta el mes entero. |
| **Apertura tardía (`F < 0,25`)** | T12 el 2027-11-01: `A_DENIM = 2/12 = 0,1667`, `A_ABRIGO = 0,04`, `F = 0,1287` → DENIM 1 190, ABRIGO 61, **1 251 u** (`E = 131 240`). La cifra es baja porque la tienda vende dos meses, y está bien. El aviso `apertura_tardia` se mantiene, informativo, con texto nuevo: «Abre tarde: en 2027 vende el 12,9 % de un año maduro (S/ 131 240 de S/ 1 020 000). En 2028 pasará a nueva del año anterior.» Hoy daría 811 u, más que abriendo en marzo. |
| **Sin referente** | Usa la composición de la red (promedio de las mismas tiendas de `Z` con igual peso, `origen_composicion = red`), con la misma fórmula. Avisos `sin_referente` / `referente_sin_historia` como hoy. |
| **`venta_esperada_promedio` nula** | Como hoy: `propuesto = null`, aviso `sin_venta_esperada` y método `sin_propuesta`. Javier puede escribir el total de la tienda, que se reparte con la composición y las curvas. La tienda no bloquea el cierre. |
| **`V = 0`** | `S = 0`: todas las filas proponen 0. Se acepta (el `check` permite 0). |
| **Abre y cierra en el mismo año de `Y+1`** | `bloques.ts:77` la clasifica como **cierre de `Y+1`**. El método de cierre no tiene composición (`comp = null`) y, sin venta en la ventana, `procesarTienda` **no crea filas** (`calculo.ts:456-466`). Por eso no se usa la venta esperada, y un total que Javier decida para la tienda **no se reparte ni llega a la Matriz ni a M8**. 07d añade el aviso de tienda `apertura_y_cierre`: «Abre y cierra en 2027: no se proyecta y un total que escribas no llega a la Matriz ni a Flujo. Si es real, avísalo para especificarlo.» Se descartó proyectarla con `A_f = Σ c r q φ`: exigiría armar la composición del referente para un cierre, una rama nueva en `procesarTienda`, y hoy no hay ninguna tienda con `fecha_cierre`. |
| **Abre y cierra en el mismo año de `Y`** | Tiene venta real, así que se crean filas por el método de cierre, como hoy. No cambia. |
| **Abre en `Y` y cierra en `Y+1`** | En `Y` es apertura (fórmula nueva). En `Y+1` es cierre, con composición propia sobre sus meses reales, como hoy. |
| **Tienda nueva con meses reales y `n ≥ 3`** | Propuesta por avance propio, sin cambio. Solo crece la referencia «por venta esperada» que se muestra al lado. |
| **Filas sin curva** | Quedan sin propuesta (`sin_curva`) y fuera de `s̃`. Las demás filas se reparten el 100 % de `S × F`. |
| **Total de la tienda ya decidido** | Se conserva (decisión 33). Al recalcular, la propuesta sube unas 10 veces y la tienda queda con «propuesta cambió». Las filas fijadas a mano se conservan (07b). Javier debe revisarla (hito, paso 3). |
| **Excel de tiendas con una columna anual** (`VENTA_ESPERADA_ANIO_APERTURA`, `VENTA_APERTURA`) | Ya no se reconoce como venta esperada. La columna no se mapea sola, y Javier ve el campo sin mapear en la vista previa del importador. |

**Etiquetas y ayudas.**

| Dónde | Hoy | Desde 07d |
|---|---|---|
| M4 · `formulario-tienda.tsx:194` | «Venta esperada del año de apertura (S/, sin IGV)» · «Soles que la tienda venderá desde que abre hasta el 31 de diciembre…» | **«Venta mensual promedio esperada (S/, sin IGV)»** · *«Soles que la tienda venderá en un mes promedio, ya en régimen y sin IGV. M7 la multiplica por 12 y la reparte con la estacionalidad en los meses en que la tienda esté abierta: si abre en marzo, en ese año solo cuentan de marzo a diciembre.»* |
| M4 · `importar-tiendas.tsx:46-50` | etiqueta y hint del año de apertura; alias anuales | Etiqueta «Venta mensual promedio esperada», la misma ayuda y los alias de §4. |
| M4 · `calendario-tab.tsx:178` y cabecera «Venta esp.» de `tiendas-tab.tsx` | título del año de apertura | «Venta mensual promedio esperada (S/, sin IGV)»; cabecera «Venta esp./mes». |
| M7 · `atajo-tienda.tsx:83` | ídem M4 | La misma etiqueta y ayuda de M4. |
| M7 · `tarjeta-tienda.tsx:417` | «venta esperada del año de apertura S/ … (sin IGV, desde que abre hasta el 31 de diciembre)» | A partir de `escala`, «venta esperada **S/ 85 000 al mes** (sin IGV, en régimen) · año maduro S/ 1 020 000». Además: <ul><li>sin meses reales: «· en 2027 abre el 15-mar y vende el 83,7 % del año → S/ 853 597»;</li><li>con `con_meses_reales`: «· referencia: con la venta esperada vendería el x % del año → S/ …; la propuesta sale de lo vendido».</li></ul> |
| M7 · `tiendas-tab.tsx:80` | «venta esperada del año de apertura» | «venta mensual promedio esperada». |
| M7 · explicación (`explicar.ts`, `apertura`) | «venta esperada S/ … en 2027, su año de apertura (sin IGV) · la tienda alcanza el 81,0 % de un año maduro → año maduro S/ …» | «venta esperada S/ 85 000 al mes en régimen (sin IGV) × 12 = año maduro S/ 1 020 000; abre el 15 de marzo: en 2027 vende el 83,7 % de un año (S/ 853 597), composición de T03, sin rampa → año maduro 8 670 u → 7 108 u en 2027». Con rampa: «rampa 1,5 · 1 · 0,75». |
| Ficha 04 (tabla de columnas, §45, pantalla) y ficha 07 (glosario `E`, paso 4, «Cambios 0.10.1» punto 3) | año de apertura | Las actualiza el `documentador`, con una nota de que 07d supera la decisión 22. |

## 7. Contratos de API

- **Rutas y esquemas de entrada:** no cambia ninguno. `monto` de `src/lib/tiendas/esquemas.ts` sigue siendo `>= 0` y nullable.
- **Única novedad:** `TiendaProyeccionApi.escala` (§4), solo lectura y con `requirePlanner`, como toda la API de M7.
- **Comprador:** `GET /api/tiendas` le sigue ocultando `venta_esperada_promedio`.

**Proyecciones ya calculadas.**
- **Desactualización:** `VERSION_METODO` sube a 4 (con 07c), así que toda proyección en trabajo pasa a «desactualizada: método nuevo» y `cerrar?forzar=1` la rechaza con `409 version_metodo` (0.10.3) hasta recalcular.
- **La huella de tiendas no salta:** el valor de la columna no cambia, así que no aparece `tiendas_cambiadas`, y es correcto. El cambio lo detecta la versión del método.
- **Al recalcular:** se conservan los totales decididos y las filas fijadas, y se marca «propuesta cambió».
- **Una cerrada no cambia nunca.** Hoy no hay ninguna.

**Impacto en el contrato de M8 (`GET /api/proyeccion/cerrada`).**
- **Forma:** no cambia.
- **Valores:** cambian los de las filas `bloque = nuevas` / `subbloque = aperturas` (total y `meses`), y con ellos los totales por GML-AM que lea M8. `bloques[anio].nuevas[].venta_esperada` y `proyeccion_tiendas.venta_esperada_usada` pasan a ser mensuales.
- **Propuesta para la ficha 08:**
  - M8 exige una cerrada con `resumen.version_metodo ≥ VERSION_METODO_MIN_M8`, una **constante fija `= 4`** en `src/lib/flujo/tipos.ts`. Se usa una constante y no `VERSION_METODO`, para que una subida futura del método no invalide en M8 las cerradas que siguen siendo válidas.
  - `ProyeccionApi` ya expone `resumen.version_metodo`.
  - Si no se cumple, M8 avisa `cerrada_metodo_anterior`: «la cerrada se calculó antes de 0.10.8: aperturas y crecimientos con el método anterior; cierra una nueva». Va en la línea de `cerrada_sin_periodo`.

## 8. Reglas de negocio (vitest, `tests/proyeccion.tiendas-nuevas*.test.ts`; puras salvo donde dice «ruta» o «estático»)

1. **Funciones básicas:** `anioMaduroSoles(85 000) = 1 020 000`; `unidadesMadurasDeFila` = `12 V s ÷ (p × Σ s con curva)`; 0 con `p = 0`.
2. **Ejemplo de §5:** da 7 108 (sin rampa), 6 879 (rampa `[0,7, 0,85, 1]`), 7 072 (rampa `[1,5, 1, 0,75]`) y 1 251 (apertura el 1 de noviembre), con `E` = 853 597 / **826 355** / 844 771 / 131 240 (`E` redondeado al sol).
3. **Propiedades:**
   - `Σ_f round(Md_f A_f) × p_f = 12 V F ± Σ_f p_f ÷ 2`;
   - las unidades crecen de forma monótona con `V`;
   - **con rampa plana `[1, 1, 1]`** decrecen al atrasar la fecha de apertura. Con una rampa de pico (algún valor > 1) la propiedad no vale: abrir el 1 de diciembre con `[3, …]` vende más que abrir el 30 de noviembre, y no se prueba.
4. **Apertura el 1 de enero sin rampa:** `F = 1` y `P_f = round(12 V s̃_f ÷ p_f)`.
5. **Filas sin curva:** una fila sin curva queda `sin_curva` y sale de `s̃`, y la suma de soles de las demás es `12 V F`. `F` con `s̃` es mayor o igual que con `s` sin renormalizar, y es igual si todas las filas tienen curva.
6. **Avisos:** `F < 0,25` → `apertura_tardia` con el texto nuevo; sin `V` → `sin_propuesta` y `sin_venta_esperada`; `V = 0` → todas las filas en 0.
7. **Rampa:** con el método 4, la misma `V` con rampa `[1,5, 1, 0,75]` y con `[1, 1, 1]` da totales distintos (la rampa mueve el total).
8. **Otros métodos:** `apertura` en `Y` con `n < 3` y las referencias «por venta esperada» de `avance_propio` / `maduro_propio` usan el `Md_f` nuevo.
9. **Versión del método:** con `VERSION_METODO` subido, una proyección en trabajo calculada con el método anterior da `version_metodo` en `motivosDesactualizada`. Recalcular conserva el `decidido` de la tienda y de las filas fijadas y marca `propuesta_cambio`.
10. **Apertura y cierre en `Y+1`:** una tienda con `fecha_apertura` y `fecha_cierre` en `Y+1` y sin venta queda con el aviso `apertura_y_cierre` y sin filas. Una que abre en `Y` y cierra en `Y+1` no lleva el aviso.
11. **Estático:**
    - ningún texto bajo `src/app/(app)/maestros/tiendas/` ni `src/app/(app)/planificacion/proyeccion/` dice «año de apertura» como significado de la venta esperada;
    - las pantallas de §6 dicen «mensual promedio»;
    - los alias de `venta_esperada` en `importar-tiendas.tsx` incluyen `VENTA_MENSUAL` y `VENTA_PROMEDIO_MENSUAL` y no incluyen `VENTA_ESPERADA_ANIO_APERTURA` ni `VENTA_APERTURA`;
    - ningún archivo bajo `src/lib/proyeccion/` ni `src/lib/tiendas/` divide o multiplica por 1,18.
12. **Ruta:** `GET …/tiendas` devuelve `escala` en las aperturas con `V` (con `con_meses_reales` correcto) y `null` en las demás. El comprador recibe `403`.

## 9. Criterios de aceptación (hito de Javier)

1. En Tiendas (M4), el campo dice «Venta mensual promedio esperada (S/, sin IGV)» con la ayuda nueva, y la cifra cargada no cambió. En «Importar», la columna se llama igual y un Excel con la columna `VENTA_MENSUAL` se mapea solo.
2. La proyección en trabajo dice «desactualizada: método nuevo». [ESCRIBE] Recalcular (o Guardar y recalcular en Crecimientos, 07c).
3. En Tiendas nuevas y cierres, la apertura de 2027 muestra «S/ … al mes · año maduro S/ … · en 2027 vende el x % del año → S/ …» y una propuesta del orden de decenas de miles de unidades. Comprobar a mano una fila con §4, **con su rampa 1,5 · 1 · 0,75**. La propuesta queda alrededor de un 0,5 % por debajo de la que daría con rampa plana: es el pico de apertura y es lo esperado. Si su total estaba decidido, sigue decidido con «propuesta cambió»: [ESCRIBE] decidir de nuevo o volver a la propuesta.
4. En Por línea, la sección de la apertura (07b), la barra de 2027, el «Total línea» y la columna de aperturas de la Matriz cuadran con la cifra nueva.
5. Pasan `lint`, `tsc`, `vitest` y `build`, y `APP_VERSION` es `0.10.8 · M7`.

## 10. Fuera de alcance

- proyectar por venta esperada una tienda que abre y cierra en el mismo año (solo se avisa, §6);
- convertir IGV (la venta nunca lo incluye);
- una venta esperada distinta por mes o por temporada;
- renombrar la columna;
- cambiar la rampa por defecto o la de la apertura cargada.

**Propuesta para `docs/DECISIONES.md` (2026-10-16; la registra el `documentador`):**
- **La venta esperada de una tienda nueva es su venta mensual promedio en régimen.** M7 calcula el año maduro `S = 12 × V` y lo estacionaliza en los meses abiertos con la curva de cada fila y la rampa (`P_f = round(12 V s̃_f ÷ p_f × A_f)`).
- **Ninguna venta del sistema incluye IGV,** ni la esperada ni la cargada en M5, y el sistema no convierte nada.
- **La rampa multiplica la venta en régimen y mueve el total del año de apertura.** La rampa `1,5 · 1 · 0,75` de la apertura de 2027 es el pico real y se conserva.
- **Qué supera:** la decisión 22 (ronda 4: «soles del año de apertura») y la entrada de `0.10.1` de la ficha 07.
- **Descartado:** soles del año de apertura (deducía el año maduro dividiendo por `F`, de modo que una cifra mensual daba unas 10 veces menos y una apertura tardía daba más unidades), y renombrar la columna.
- **En `08-09-definiciones-del-dueno.md`:** la 22 se marca como superada.

## 11. Cambios tras la revisión independiente y las decisiones finales de Javier (2026-10-16)

| Origen | Qué cambió |
|---|---|
| **Decisión 3 de Javier** (la venta nunca incluye IGV) | §2 y §3 lo dicen como decisión. La regla 11 comprueba que no hay ninguna conversión. Se cierra la pregunta abierta sobre el IGV. |
| **Decisión 4 de Javier** (rampa `1,5 · 1 · 0,75` = pico real) + **m8** | §4: la rampa se conserva y con el método 4 mueve el total (≈ −0,5 % en esa tienda). En el método 3 no lo movía (`Σ P·p = E`). Ejemplo en §5, regla 7 y criterio 3. |
| **Decisión 7 de Javier** (× 12 y estacionalizar a los meses abiertos) | Ya era la fórmula de la ficha. Sin cambio. |
| **I5:** el importador no tiene `VENTA_MENSUAL` y acepta alias anuales | Se quitan `VENTA_ESPERADA_ANIO_APERTURA` y `VENTA_APERTURA` y se añaden `VENTA_MENSUAL` y `VENTA_PROMEDIO_MENSUAL`. Un aviso opcional `venta_esperada_fuera_de_rango` en M7. Regla 11 y criterio 1. |
| **m6:** abre y cierra en `Y+1` | Se corrige el texto: no se crean filas y un total decidido no llega a la Matriz ni a M8. Nuevo aviso `apertura_y_cierre` (regla 10). La alternativa `A_f = Σ c r q φ` se descarta por no ser barata. |
| **m9:** cifras y propiedades | `E = 826 355` (no 826 353). La monotonía con la fecha queda limitada a rampa plana. `F` cambia de definición con `s̃`. |
| **m14:** versión mínima para M8 | Constante fija `VERSION_METODO_MIN_M8 = 4`, leída de `resumen.version_metodo` (ya expuesto en `ProyeccionApi`). |
| **m15:** la `escala` sugería una cifra que no es la propuesta | Sin meses reales se muestra la frase «vende el x % del año → S/…». Con meses reales se rotula como referencia (`escala.con_meses_reales`). |
| **m7** (de 07c) | §4 documenta la asimetría: `φ_{Z_0}` mueve el nivel de las aperturas, y en mismas tiendas el % es bruto. |

**Se mantienen:** el modelo sin columnas nuevas, el `comment on column` en la `0023`, `VERSION_METODO = 4` con 07c, `escala` en `TiendaProyeccionApi`, `acotar` y `cifra_excesiva`, y el texto de `apertura_tardia`.

## Preguntas abiertas (solo Javier)

Ninguna.
