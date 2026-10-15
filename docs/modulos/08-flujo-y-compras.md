# M8 + M9 · Flujo de mercadería, necesidad de compra y compras de los compradores (un solo ciclo, dos entregas)

> Estado: **especificada el 2026-10-15, ajustada el mismo día con el informe del `arquitecto-revisor` (opus), la ronda 3 y la ronda 4 de Javier (decisiones 25–33 y hallazgos de datos de `08-09-definiciones-del-dueno.md`, que prevalecen sobre todo lo anterior); pendiente de aprobación por Javier.** Ficha conjunta de M8 (flujo y necesidad) y M9 (compras), según la decisión 1: M7 da la venta mensual proyectada por GML-AM → M8 la compara con el stock y con lo que viene en camino y deja el hueco por comprar → el comprador registra compras en M9 → M8 se recalcula. **Orden nuevo (decisión 32): M8 primero, M9a después de validar M8.** Se construye en dos entregas: **M8 `0.13.0 · M8`** (flujo con IMI proyectado mes a mes, conciliación de inventarios, huecos, parámetros; **más las compras comprometidas sin el módulo del comprador**: carga inicial por plantilla y captura mínima del planner, con cronograma de entregas, recepciones, cancelación y auditoría; migración **`0022_flujo_y_compras.sql`**; commits `M8:`) y **M9a `0.14.0 · M9`** (la herramienta del comprador: escritura con `requireUser`, lotes al barrer de varias marcas, proveedores completos, filtro "mis líneas", importador abierto a compradores, Excel de compras; migración **`0023_compras_comprador.sql`**; commits `M9:`), con una segunda entrega `0.13.1 · M8` para la vista por marca al barrer, Pendientes y el impacto en el servidor, y la **PWA después de M9a**. Numeración completa: `0.10.1 · M7` → `0.11.0 · M12` (migración `0020`) → `0.12.0 · M13` (`0021`) → `0.13.0 · M8` (`0022`) → `0.14.0 · M9` (`0023`) → PWA. Las etiquetas se confirman al cerrar cada entrega. Depende de [07-proyeccion-anual](07-proyeccion-anual.md) (`leerProyeccionCerrada`: meses, `origen_meses`, `participaciones_historicas`), [12-analisis-marcas-barrer](12-analisis-marcas-barrer.md) (reparto vigente por temporada, alcance y error de cada marca al barrer o mixta; `claveFlujo` con `mixta`), [13-intercompany](13-intercompany.md) (reglas con rango IMI por marca, 4–8 por defecto, y porcentaje directo; `subflujoIntercompany`), [05-venta-stock](05-venta-stock.md) (stock de fin de mes por tienda, equivalencia, marca y talla; el CD incluido), [04-tiendas](04-tiendas.md), [02b-marcas-tratamiento-gml](02b-marcas-tratamiento-gml.md) y [01b-responsables](01b-responsables.md) (filtro "lo mío"). Después entra la PWA (`10-pwa.md`). **Referencia visual**: el repositorio `COTBV2` de Javier, clonado en solo lectura; se toma su look and feel, nunca su esquema ni su código (sección 4.0). Sin datos reales: proveedores "Proveedor Norte" y "Feria Sur", tiendas `T01…`, cifras inventadas; JH, Donatelli y VH se nombran como maestros del dominio. Los únicos agregados reales citados son los que midió el revisor sobre la base (sección 3).

## 1. Objetivo

Decir, para cada unidad de planificación (GML o GMLE) y agrupación de marca, **mes a mes y en un horizonte móvil** (del mes siguiente al último publicado hasta diciembre del año siguiente), cuántas unidades hacen falta para que el **IMI (Índice de Meses de Inventario)** de la cadena, **stock total (tiendas + CD) ÷ venta promedio mensual total**, se mantenga **entre 4 y 8 meses** (decisiones 25 y 26): el flujo parte de la venta proyectada de M7 (nunca la recalcula), resta la demanda al stock de fin del **último mes publicado**, suma los ingresos futuros (compras comprometidas con su **cronograma de entregas parciales** y sus recepciones; líneas específicas, lotes de una marca al barrer repartidos con M12 y, desde M9a, lotes de varias marcas repartidos con los porcentajes del comprador) y **proyecta el IMI mes a mes**, dejando el **saldo por comprar** (lo que debe llegar en ese mes para no bajar de 4) y el **exceso** (lo que sobra por encima de 8), con alerta cuando el IMI proyectado sale del rango. Los **ingresos reales de los meses cerrados** no se leen de las compras sino de la **diferencia de inventarios** (stock fin − stock inicio + ventas, a nivel cadena), conciliados con las compras registradas para no contar nada dos veces (decisión 27). Para las marcas intercompany (M13) la fila lleva un **subflujo por marca** con demanda y stock completos, la reposición directa esperada y su **rango IMI propio** (4–8 por defecto, editable por marca). No hay OTB por temporada: se compra por oportunidad. El sistema **propone, advierte y registra quién decidió**; nunca reemplaza la decisión del comprador, planner o administrador (decisión 33). En M8 las compras comprometidas entran por **carga inicial** (plantilla Excel) y por una **captura mínima del planner**; M9a es la herramienta con la que los compradores registran sus compras (por detalle o por carga masiva, con proveedores que ellos mismos crean), desde el celular o la PC, viendo el hueco que cubren.

## 2. Decidido por Javier (2026-10-15)

1. **M8 y M9 se definen juntos** (decisión 1): el ciclo M7 → M8 → M9 → M8.
2. **No se compra por temporada, se compra por oportunidad**; horizonte móvil; lo que importa es el saldo por comprar de cada GML y mes (decisión 2).
3. **Tres orígenes de compras** (decisión 5): compras del administrador de producto de JH, Donatelli y VH **directo del CD intercompany**; **carga inicial** con **plantilla Excel nuestra** (decisión 13); el **comprador ingresa sus compras**, por detalle o por carga masiva, y crea proveedores.
4. **Nivel de una compra** (decisión 7): GML o GMLE; marca o agrupación de marcas; tallas centrales, extremas o ambas.
5. **Cobertura en meses de inventario del stock entre CD y tiendas: mínimo 4, tope 8** (decisión 11).
6. **Todos los compradores ven y registran todo**, con filtros para ver lo suyo; una compra al barrer **no se asigna a un único comprador** (decisión 12).
7. **Referencia visual**: `COTBV2` (sección 4.0).
8. **Lotes al barrer de varias marcas** (ronda 3, decisión 14): el comprador registra los **porcentajes que espera recibir por marca y por GML**; la estadística de M12 sirve para los lotes de **una sola marca**.
9. **Intercompany** (ronda 3, decisión 15): **no se resta** del stock la parte directa; el flujo usa una **cobertura esperada intercompany** por marca y GML (M13), con demanda y stock completos.
10. De M12 y M13: las marcas al barrer se reparten con un reparto aprobado (por temporada de llegada, con alcance y error visibles); el intercompany se evalúa en un subflujo con cobertura esperada.

11. **IMI = stock total de la cadena (tiendas + CD) ÷ venta promedio mensual total** (ronda 4, decisión 25); el detalle tiendas / CD es información complementaria; cuenta el **stock disponible para venta** (hoy todo el stock cargado: M5 no trae inventario bloqueado; hallazgo de datos).
12. **IMI entre 4 y 8**, proyectado **mes a mes** con inventario actual, ventas proyectadas, compras comprometidas, fechas de ingreso y recepciones parciales; **alerta** fuera de 4–8; una compra que excede el máximo **se confirma con advertencia visible y justificación registrada** (decisión 26; resuelve la pregunta 4).
13. **Ingresos reales de meses cerrados por diferencia de inventarios** (stock fin − stock inicio + ventas, a nivel cadena, incluida la compra directa del intercompany), conciliados con compras registradas y recepciones **sin duplicar** (decisión 27; viable con el stock mensual de M5 solo a nivel cadena: las transferencias CD→tienda se cancelan).
14. **Permisos**: todos los compradores ven y editan todas las líneas, con filtro **"mis líneas"**; **cualquier comprador, el planner o el administrador edita o cancela cualquier compra**; **trazabilidad completa** (quién creó, modificó o canceló, con fecha y hora) (decisión 28; reemplaza "solo quien la registró o un planner" y resuelve las preguntas 2 y 5).
15. **IMI por marca**: rango general 4–8; JH, Donatelli y Van Heusen usan ese rango por ahora, **editable por marca** en M13 (decisión 29; reemplaza los rangos fijos propios de la ficha 13). **Van Heusen con tratamiento especial parametrizable desde ahora** (decisión 30).
16. **Temporadas editables** (verano octubre–marzo, invierno abril–septiembre, fechas configurables) y **mercadería que llega de forma continua**: una compra tiene **múltiples entregas parciales en distintos meses**, distribuibles por fechas estimadas y estacionalidad; **cada ingreso actualiza el inventario y la proyección del mes** (decisión 31).
17. **Orden: M8 primero, M9a después de validar M8** (decisión 32): M12 → M13 → M8 → M9a → PWA.
18. **Criterio general** (decisión 33): el sistema propone y advierte; la decisión final es de una persona y queda registrada.

Interpretación adoptada: M7 ya incluye la venta de las marcas al barrer y de las marcas intercompany dentro de la fila GML-AM, así que M8 no duplica ni recorta demanda: solo decide cómo se cubre. **Cada unidad entra al flujo una sola vez**: en los meses cerrados, por el inventario publicado; en los meses futuros, por las entregas pendientes de las compras confirmadas (sección 3, "Ingreso" e "Ingreso inferido").

## 3. Conceptos

| Concepto | Definición |
|---|---|
| **Fila del flujo (`f`)** | Unidad de planificación `g` × agrupación de marca `a`: la misma fila GML-AM de M7, **sumando sus bloques** (mismas, nuevas, cierres). Universo: filas de la cerrada vigente, **más** las filas "sin demanda proyectada" que nacen de un stock o un ingreso que no tiene fila en la cerrada (aviso `fila_sin_proyeccion`; demanda 0; así nada se pierde: I5). |
| **Último mes publicado (`k'`)** y **mes de la cerrada (`k`)** | `k'` = último mes publicado y terminado en M5 (`hastaPorDefecto`); `k` = `hasta_periodo` de la cerrada. **El flujo arranca con el stock de `k'`** y usa la demanda de la cerrada para `m > k'`; si `k' > k`, los meses `k+1 … k'` se muestran como historia real y el flujo avisa `cerrada_atrasada` (la demanda proyectada puede estar vieja; M8 nunca recalcula M7). Resuelve B3 y la pregunta 7 de la primera versión. |
| **Horizonte** | Meses `k'+1 … diciembre de Y+1`, con `Y` el `anio_en_curso` de la cerrada. Entre enero y la primera cerrada del año nuevo se lee la cerrada del año anterior y el horizonte termina en diciembre de `Y` con aviso `horizonte_corto`. |
| **Demanda (`D_m`)** | Unidades proyectadas de `f` en el mes `m`, `Σ` de los bloques de la cerrada. **Completa**: no se le descuenta nada (ni intercompany ni al barrer). Los meses `≤ k'` muestran el real como historia. |
| **Parte al barrer de la demanda (`D^b_{B,m}`)** | `D_m × part_{barrido B}` por cada marca al barrer o mixta `B` con participación en `f`. Informativa; base de la vista por marca al barrer (segunda entrega). |
| **Subflujo intercompany (`B` en `f`)** | Para cada marca `B` con regla vigente y aplicable de M13 en `g`: `D^B_m = D_m × part_B` (`part_B` = suma de participaciones con `marca_id = B`, de cualquier tipo de clave), `S^B_{k'}` = stock de `B` en `g` (CD + tiendas, completo), `I^B_m` = ingresos de líneas con marca `B` que caen en `g` (cualquier destino), `R^B_m = D^B_m × pct_directo ÷ 100` (**reposición directa esperada**: ingreso esperado, no recorte), y objetivo con `min_B` / `max_B` de la regla. El **resto de la fila** es `D − Σ_B D^B`, `S − Σ_B S^B`, `I − Σ_B I^B`, con el 4–8 general. El saldo de la fila es `C = C^resto + Σ_B C^B`; la señal, la peor. Definido en M13 §5 (`subflujoIntercompany`). Resuelve B2. |
| **Stock inicial (`S_{k'}`)** | Unidades de fin de mes `k'` de `f` en **CD + tiendas** (tiendas activas de tipo Tienda y los CD): el **stock disponible para venta** (decisión 25; hoy equivale a todo el stock cargado porque M5 no trae inventario bloqueado ni no utilizable: cuando lo traiga, se resta aquí y en la conciliación), clasificadas con `claveFlujo`: **el stock de una clave `barrido` se agrupa por nodo y agrupación de la unidad de marca** (BETA al barrer en DENIM cuenta en DENIM × PREMIUM: está físicamente ahí; no se descarta). `S^cd` y `S^t` se muestran aparte. |
| **Entrega (cronograma)** | Cada línea de compra tiene **una o más entregas** `(periodo, unidades)` cuya suma es `unidades` de la línea (decisión 31): la mercadería llega de forma continua y una compra no entra junta. Por defecto una sola entrega en `llegada_periodo`; el usuario la parte a mano o con **"Distribuir por estacionalidad"** (entre `desde` y `hasta`, proporcional a la curva de la unidad del GML, `repartirEntero`; en un lote de una marca, a la curva ponderada de su reparto). `llegada_periodo` de la línea = primera entrega (la API lo mantiene). |
| **Pendiente de una entrega** | Las recepciones de la línea se asignan a sus entregas **en orden de periodo (FIFO)**; `pend_{e} = max(0, unidades_e − asignadas_e)`. Una entrega con `periodo ≤ k'` y pendiente > 0 es **vencida** (`entrega_vencida`): su pendiente se proyecta en `k'+1` hasta que alguien registre la recepción, la mueva o cancele la línea (el sistema lo sugiere con la conciliación; nunca lo hace solo). |
| **Ingreso (`I_m`)** | Unidades que llegan al CD o a una tienda en el mes `m > k'` desde compras **confirmadas**: por línea, la suma de `pend_e` de sus entregas en `max(periodo_e, k'+1)`, más las **recepciones con `recibida_periodo > k'`** en ese periodo (ya están físicamente, pero el stock publicado aún no las trae); una recepción con `recibida_periodo ≤ k'` cuenta 0 (ya está en el stock publicado). Las líneas al barrer aportan sus filas de reparto, **repartiendo lo pendiente de cada entrega** (I4). Destino `tienda` e `intercompany_directo` cuentan igual (el stock es completo; sección 16, pregunta 3). Invariante: `Σ_f I_m` = `Σ` de pendientes de las entregas de líneas confirmadas con fila (específicas o repartidas) más las recepciones `> k'`; las líneas `sin_reparto` no cuentan y se listan. **Cada ingreso actualiza el stock y el IMI del mes en que cae** (decisión 31). |
| **Ingreso inferido (`Ing_{f,m}`; conciliación, decisión 27)** | Para un mes cerrado `m ≤ k'` con `m−1` publicado: `Ing_{f,m} = S_{f,m} − S_{f,m−1} + V_{f,m}` (stock de fin de mes y venta en unidades de la fila, **a nivel cadena, CD + tiendas**: las transferencias CD→tienda se cancelan; por tienda no se concilia porque mezcla transferencias con compras). `ingreso_inferido = max(0, Ing)`, `salida_inferida = max(0, −Ing)` (mermas, devoluciones al proveedor, ajustes, reclasificaciones). Es **el ingreso real del mes, incluida la compra directa del intercompany**, y es lo que el flujo muestra como "Ingresos" en la historia. Se compara con `R_m` (recepciones registradas en `m`) y `E_m` (entregas programadas en `m`): `sin_registrar = max(0, Ing − R_m)`, `sin_respaldo = max(0, R_m − Ing)`. **Nunca suma al stock** (ya está en el publicado) ni crea recepciones: solo informa y sugiere. |
| **Anti-duplicación (invariante)** | Cada unidad entra al flujo **una sola vez**: meses `≤ k'` solo por el inventario publicado (recepciones y entregas con periodo `≤ k'` no suman); meses `> k'` solo por las entregas pendientes de líneas confirmadas (menos las recepciones FIFO) y las recepciones con periodo `> k'`. Al publicarse un mes en M5, las recepciones y entregas de ese mes **dejan de sumar** (el stock nuevo ya las contiene) y pasan a la conciliación. |
| **Stock proyectado (`S_m`)** | `S_m = S_{m−1} + I_m − D_m` sin compras nuevas (en un subflujo, más `R^B_m`). Puede ser negativo (quiebre). |
| **Venta promedio mensual (`VPM_m`)** | `VPM_m = Σ_{j=m+1}^{m+12} D_j ÷ 12`: el promedio de la demanda de los **doce meses siguientes** a `m` (proyectada; más allá del horizonte se extiende repitiendo los últimos doce meses proyectados, `extendido`). Es el denominador del IMI (decisión 25: "venta promedio mensual total"); en el mes `k'` se muestra al lado `VPM_real = Σ_{j=k'−11}^{k'} V_j ÷ 12` (los últimos doce reales) para que Javier compare (sección 16, pregunta 6). `VPM_m = 0` → `sin_demanda`. |
| **IMI (`imi_m`)** | **Índice de Meses de Inventario**: `imi_m = S_m ÷ VPM_m`, con `S_m` el stock de la **cadena** (tiendas + CD); `S^cd` y `S^t` se muestran aparte como detalle, nunca con IMI propio en la primera entrega. `S_m ≤ 0` → 0. Reemplaza a la "cobertura hacia adelante" de la versión anterior (misma intención, definición de Javier). |
| **Objetivo mínimo y tope** | `obj_m = MIN × VPM_m`, `tope_m = MAX × VPM_m` (`MIN = 4`, `MAX = 8`, parámetros globales `imi_min` / `imi_max` en `flujo_parametros`; en un subflujo, los de la regla de M13, por defecto los mismos 4–8). **Alerta** cuando `imi_m` (sin sugerencias) está fuera de `[MIN, MAX]`. |
| **Saldo por comprar (`C_m`)** | Lo que **debe llegar** en `m` para cerrar `m` con al menos `obj_m` (IMI ≥ 4), contando lo ya sugerido: `C_m = max(0, obj_m − (S*_{m−1} + I_m − D_m))`, `S*_m = S*_{m−1} + I_m + C_m − D_m`, `S*_{k'} = S_{k'}`. |
| **Exceso (`X_m`)** | `max(0, S_m − tope_m)` con el stock **sin** sugerencias. |
| **Señales** | `quiebre` si `S_m < 0`; **`falta` si `C_m > 0`** (equivale a `imi*_m < MIN` con el stock **con** sugerencias: así la señal y el saldo dicen lo mismo, hallazgo menor del revisor); `exceso` si `X_m > 0` (`imi_m > MAX`); `al_dia`; `sin_demanda` si `D = 0` en todo el horizonte; **`sin_curva`** si la fila de la cerrada no tiene curva (`meses = null`): estado propio, no cuenta como exceso ni como falta. Orden en el resumen: `quiebre` > `falta` > `exceso` > `al_dia`; `sin_curva` y `sin_demanda` se muestran aparte. |
| **Compra** | Cabecera (proveedor, fecha, referencia, origen, estado, moneda, nota, quién la creó y quién la modificó por última vez, justificación de exceso) con **líneas**. Estados: `borrador`, `confirmada`, `recibida`, `cancelada`. |
| **Auditoría** | Tabla `compra_eventos` (solo inserciones): cada creación, edición, confirmación, recepción, cancelación o aplicación de reparto, con `antes` / `despues`, motivo, quién y cuándo (decisión 28). El detalle de la compra muestra el historial. |
| **Línea de compra** | `tipo`: **`especifica`** (GML o GMLE + marca o agrupación + tallas), **`barrer_marca`** (lote de **una** marca al barrer o mixta, sin GML; alcance opcional por género, mundo o líneas; el sistema lo reparte con el reparto vigente de la **temporada de llegada** y muestra su error) o **`barrer_mezcla`** (lote de **varias marcas**, sin GML ni marca: el comprador escribe la tabla de porcentajes marca × GML, que suma 100 %). Unidades, costo unitario, **cronograma de entregas** (una o varias; `llegada_periodo` = la primera), destino (`cd`, una tienda o `intercompany_directo`), nota. En M8 existen `especifica` y `barrer_marca`; `barrer_mezcla` entra con M9a. |
| **Reparto de una línea** | Filas `(marca, g, unidades)` guardadas al confirmar: para `barrer_marca`, con el reparto vigente de M12 (versión, temporada, alcance renormalizado); para `barrer_mezcla`, con los porcentajes del comprador. Si después se aprueba otro reparto, la línea `barrer_marca` avisa `reparto_cambio` y el planner aplica el nuevo (una línea, una compra o **todas las de la marca**). |
| **Recepción** | Evento por línea: `recibida_periodo` (mes), unidades, fecha, quién. `unidades_recibidas` de la línea es la suma; se asignan a las entregas FIFO. Una recepción con `recibida_periodo ≤ k'` no suma al flujo (ya está en el stock) y se concilia con el inventario (`recepcion_sin_respaldo` si el inventario no la refleja); con periodo futuro, `recibida_futura`. |
| **"Mis líneas"** | Para un comprador: filas y compras cuyo GML pertenece a una combinación género × mundo de la que es responsable (M1b); una línea al barrer es "mía" si su reparto toca alguna. **Es un filtro, nunca un permiso** (decisión 28): todos ven y editan todo. |
| **Proveedor** | Maestro que crea cualquier usuario (en M8, el planner): nombre único, código, país, ciudad, RUC o identificación, `es_intercompany`, nota; contactos desde M9a. **Sin datos bancarios en la primera entrega** (I6). |
| **Temporada (de llegada)** | Verano y invierno con **fechas editables** (decisión 31): `flujo_parametros.temporadas` (`{ verano: { desde_mes: 10, hasta_mes: 3 }, invierno: { desde_mes: 4, hasta_mes: 9 } }`, deben cubrir los doce meses sin solaparse); M12 lee el mismo parámetro (su constante `MESES_TEMPORADA` pasa a ser el valor por defecto). La temporada de una entrega es la de su mes de recepción. |

**Lo que midió el revisor sobre la base (I10), para que Javier lo tenga delante al confirmar el 4–8 y el stock del CD**: con el stock publicado y la venta de los últimos meses, el IMI global ronda **8,6 meses**, **~59 % del stock está en el CD**, y con 4–8 saldrían **451 filas por debajo de 4 meses, 251 entre 4 y 8, 430 por encima de 8 y 365 con venta y sin stock**: cerca del **40 % de las filas en exceso**. Pregunta 1 de la sección 16: si todo el stock del CD cuenta.

### Por qué el flujo se calcula a demanda y no se guarda

Las entradas son pequeñas (≈ 1 700 filas × 15 meses, un agregado de stock de un mes, cientos de líneas, decenas de reglas y repartos) y toda la aritmética es lineal. Se guarda lo que es decisión: compras, entregas, repartos aplicados, recepciones, parámetros, eventos. La conciliación de meses cerrados también se calcula a demanda (stock y venta de M5 por rango de meses). La respuesta de `GET /api/flujo` se **cachea en memoria por huella** (cerrada, cargas publicadas del rango, último `updated_at` de compras, repartos vigentes, reglas, parámetros) y se invalida sola (I8).

### Por qué la compra no se asigna a un comprador

Javier: una compra al barrer puede cubrir marcas o GML de varios compradores. La cabecera guarda quién la registró y las vistas "lo mío" se derivan del GML de cada línea (o del reparto) contra `responsables_genero_mundo`.

## 4. Flujo de pantalla (UX primero)

### 4.0 Lo que se toma de la referencia `COTBV2` y lo que se adapta

| Pieza de la referencia | Qué es allí | En Vector2 |
|---|---|---|
| **Tarjeta de necesidad** (`NeedCard`): género · mundo, línea, agrupación, sello de estado, medidor "comprado / OTB", línea perforada, tres cifras | OTB por viaje fijo | **Tarjeta de hueco**: género · mundo · línea (· equivalencia) · agrupación; sello **Falta / Al día / Exceso / Quiebre / Sin curva**; medidor de **cobertura** con las marcas 4 y 8; cifras: saldo por comprar de los próximos `N` meses, stock CD + tiendas, en camino |
| **Declaración de compra** (`PurchaseForm`) | una línea = una compra | **Nueva línea**: hueco prellenado, proveedor (autocompletado + "crear"), tipo de línea (específica / lote de una marca / lote de varias marcas), marca o agrupación, tallas, unidades, costo, llegada, destino, nota; se agrega a una **compra** en borrador; **Confirmar** al terminar. Sin "producto" ni "modelo" (segunda entrega como texto libre si Javier lo quiere) |
| **Tablero** (`NeedsBoard`), mobile first | | **Huecos** (`/compras`) con chips Lo mío / Todos y Falta / Exceso / Todos |
| **Pendientes** (`PendientesList`) | | **Pendientes** (segunda entrega `0.14.1`) |
| **Proveedores** (`SupplierForm` + contactos, país/estado, RUC, banco) | | **Proveedores** con los mismos campos salvo banco y cuenta (segunda entrega, solo planner) más `es_intercompany` |
| **Historial y tabla de compras** | | **Compras**: lista con filtros y detalle de líneas |
| **Dashboard** y **reporte por directorio** | avance contra OTB | **Avance**: árbol género → mundo → línea con saldo, en camino y cobertura (dentro de Flujo) |
| **Exportaciones XLS** | | Excel en el navegador: `FLUJO`, `SALDO`, `COMPRAS`, `POR_PROVEEDOR`, `COSTO`, `PARAMETROS` |
| Estilo (tipografías, colores, tarjeta con perforación y sello) | | Reproducido **con el kit y el tema de Vector2**; no se importa su CSS. No se adopta: campañas, OTB por viaje, FOB objetivo, asignación de comprador, rol viewer |

### 4.1 Rutas y navegación

Sección nueva **Compras** en `nav.ts` (roles `TODOS`): en M9a, `/compras/registro` "Compras" y `/compras/proveedores` "Proveedores"; en M8 se suman `/compras` "Huecos" (`exact`, pasa a ser la entrada de la sección) y `/compras/flujo` "Flujo mensual"; en `0.14.1`, `/compras/pendientes`. Admin y planner ven además los parámetros y la casilla "carga inicial" del importador. El comprador abre en **Huecos** (M8) o en **Compras** (M9a) con "Lo mío" activo si tiene combinaciones (sección 16, pregunta 2). Filtros en la URL. Hook `use-flujo.ts`; `useColeccion` para proveedores y compras. Formato `es-PE`.

### 4.2 Huecos (`/compras`, mobile first; todos los roles; M8)

```
Huecos · datos hasta set-2026 · próximos [6 ▾] meses · (Lo mío) (Todos) · (Falta) (Exceso) (Todos)   [Género ▾] [Mundo ▾] [Línea ▾] [Agrup. ▾]
┌──────────────────────────────────────────────┐ ┌──────────────────────────────────────────────┐
│ HOMBRE · URBANO                      ⌈FALTA⌉ │ │ HOMBRE · FORMAL                     ⌈EXCESO⌉ │
│ DENIM                                        │ │ CAMISA › MANGA LARGA                         │
│ RECONOCIDO                                   │ │ PREMIUM                                      │
│ cobertura a set: 4,6 m  ▮▮▮▮▮▯▯▯  (4 · 8)    │ │ cobertura a set: 9,8 m  ▮▮▮▮▮▮▮▮▮▮ (4 · 8)   │
│ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │ │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│ Saldo oct–mar   Stock CD+T   En camino        │ │ Saldo oct–mar   Stock CD+T   En camino        │
│   370 u           700 u        500 u (nov)    │ │     0 u         1 240 u      2 000 u (nov)    │
│ falta en oct (70) y desde feb   [Comprar]     │ │ exceso desde nov: 1 130 u     [Ver flujo]     │
└──────────────────────────────────────────────┘ └──────────────────────────────────────────────┘
```

Estado = la peor señal de los próximos `N` meses; medidor = cobertura al fin de `k'`; "Saldo oct–mar" = `Σ C_m` de los próximos `N` meses (**370** en el ejemplo: 70 + 0 + 0 + 0 + 140 + 160); "En camino" = `Σ I_m` del horizonte con el primer mes. **Comprar** abre la declaración con la fila prellenada. Tocar la tarjeta abre el flujo de la fila. Una fila con subflujo intercompany muestra un segundo medidor pequeño por marca ("JH 1,9 m · esperada 2–4"). *Decide*: qué hueco atacar.

### 4.3 Flujo mensual (`/compras/flujo`, PC; todos los roles; M8)

```
Flujo mensual · cerrada "Proyección 2026–2027" (datos hasta set-2026; stock a set-2026) · parámetros: mín 4 · tope 8    Filtros: HOMBRE · URBANO · DENIM · RECONOCIDO   [Excel] [Parámetros]
HOMBRE · URBANO · DENIM × RECONOCIDO · stock a set-2026: CD 300 · tiendas 400 · total 700 · intercompany: —
                      jul-26 ago-26 set-26 │ oct-26  nov-26  dic-26  ene-27  feb-27  mar-27  abr-27 … dic-27
Venta real / demanda   1 600  1 580  1 410 │   150     150     150     160     160     160     160 …   183
  de la cual al barrer (BETA 12 %)         │    18      18      18      19      19      19      19 …    22
Ingresos (compras confirmadas)             │     0     500       0       0       0       0       0 …     0
Stock fin de mes (CD + tiendas)      700   │   550     900     750     590     430     270     110 …  −210
Cobertura sin compras sugeridas      4,6   │   3,6     5,7     4,7     3,7     2,7     1,7     0,7 …   0,0
Saldo por comprar (debe llegar)            │    70       0       0       0     140     160     160 …   183
Exceso (sobre 8 meses)                     │     0       0       0       0       0       0       0 …     0
Señal                                      │ falta    —       —       —     falta   falta   falta … quiebre
Compras que llegan: nov-26 · C-000012 · Proveedor Norte · ALFA · centrales · 500 u · S/ 38,00 · confirmada        [Ver compra]
```

Cuadre: `S_oct = 700 − 150 = 550`; `obj_oct = 150 + 150 + 160 + 160 = 620` → `C_oct = 70`, `S*_oct = 620`; nov: `S = 550 + 500 − 150 = 900`, `S* = 620 + 500 − 150 = 970`, `obj_nov = 630` → `C = 0`; ene: `S*_ene = 970 − 150 − 160 = 660 ≥ obj_ene = 640` → `C = 0` y señal "—" aunque la cobertura sin sugerencias sea 3,7 (la sugerencia de octubre ya la cubre); feb: `C = 640 − (660 − 160) = 140`. El fixture fija cada celda. Filas desplegables: por **marca** (relevantes, otras, al barrer) y, cuando hay regla de M13, el **subflujo intercompany**:

```
  de la cual JH · intercompany · cobertura esperada 2–4 m · 80 % directo
    demanda JH (40 %)                      │   480     480     480     …
    reposición directa esperada (80 %)     │   384     384     384     …
    ingresos de JH                         │     0     300       0     …
    stock JH                         900   │   804   1 008     912     …
    cobertura JH                     1,9   │   1,7     2,1     1,9     …
    saldo JH (debe llegar)                 │   156       0      48     …   señal: falta · — · falta
  resto de la fila (4–8)                   │ … (demanda 720, stock y saldo del resto)
```

Conmutador **Vista por marca al barrer** y Avance por árbol: segunda entrega (`0.14.1`). Totales por línea, mundo, género y compañía. **Excel** (SheetJS en el navegador): `FLUJO`, `SALDO`, `COMPRAS`, `POR_PROVEEDOR`, `COSTO`, `PARAMETROS`. **Parámetros** (admin y planner): mínimo, tope, meses de la tarjeta, "extender el horizonte". *Decide*: nada aquí; mira y exporta.

### 4.4 Compras (`/compras/registro`; todos los roles registran; M9a)

**Lista**: número, fecha, proveedor, origen, líneas, unidades, costo por moneda, llegadas, estado, quién, avisos; filtros por estado, proveedor, origen, mes de llegada, género/mundo/línea, marca, "Lo mío", texto; Excel. **Nueva compra** y **Abrir**.

**Detalle de una compra** (hoja a pantalla completa en el celular; dos columnas en PC): cabecera editable en borrador y las líneas:

```
Compra C-000012 · Proveedor Norte · 2026-10-14 · ref. PO-2211 · PEN                                       ⌈BORRADOR⌉
┌ Declaración de compra · nueva línea ─────────────────────────────────────────────────────────────────────────────┐
│ Tipo       (Específica) (Lote de una marca al barrer) (Lote de varias marcas)                                    │
│ Hueco      [HOMBRE ▾] [URBANO ▾] [DENIM ▾] [equivalencia: — ▾]      ← solo en Específica                         │
│            cobertura hoy 4,6 m · saldo oct–mar 370 u · en camino 500 u (nov)        ← se lee del flujo (M8)      │
│ Qué        (Marca) (Agrupación)   [ALFA ▾]  → agrupación RECONOCIDO                                              │
│ Tallas     (Centrales) (Extremas) (Ambas)                                                                        │
│ Unidades   [  500 ]   Costo unitario [ 38,00 ] PEN     Llegada [nov-2026 ▾]    Destino [CD ▾]                    │
│ Nota       [________________________]                                                                            │
│ Impacto: nov-26 pasa de cobertura 2,6 a 5,7 m · el saldo de nov–ene baja de 160 a 0 y el de feb a 140 (M8)       │
│                                                                                     [Agregar línea]              │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
Lote de una marca:   Marca [BETA ▾] · Alcance (opcional): (HOMBRE) (MUJER) · (URBANO) (CASUAL) · líneas [...]
                     reparto vigente v2 · llega en dic (verano) · error histórico 8 pp (estable):
                     DENIM 590 · POLO 293 · SANDALIA 117   [ver los 9 GML pequeños]
Lote de varias marcas:  Unidades [ 1 000 ]  Tabla: Marca ▾ | GML ▾ | %      BETA · DENIM · 40,0 | BETA · POLO · 20,0 | GAMMA · CAMISA › M. LARGA · 25,0 | DELTA · SANDALIA · 15,0   Suma 100,0 % ✓
Líneas (3)
# Tipo        GML / unidad                 Marca / agrup.     Tallas   Unid.  Costo u.  Llegada  Destino  Reparto / avisos
1 Específica  HOMBRE · URBANO · DENIM      ALFA (RECONOCIDO)  centr.    500   38,00     nov-26   CD       —
2 Una marca   (al barrer · alcance HOMBRE) BETA (PREMIUM)     ambas   1 000   22,50     dic-26   CD       v2 verano: DENIM 668 · POLO 332 · error 8 pp
3 Varias      (mezcla, 4 filas)            —                  ambas   1 000   19,00     dic-26   CD       porcentajes del comprador
Total 2 500 u · S/ 60 500,00                                                     [Guardar borrador] [Confirmar compra]
```

Reglas de la pantalla: en **Lote de una marca** la marca debe ser `barrido` o `mixta` (una mixta con GML es específica); el alcance renormaliza el reparto vigente sobre el subconjunto y lo muestra antes de agregar; sin reparto vigente, la línea se guarda con `sin_reparto` y no cuenta hasta que M12 lo apruebe; la **temporada de llegada** elige el vector. En **Lote de varias marcas** la tabla admite marcas con o sin tratamiento especial y GML o GMLE, exige suma 100,0 ± 0,05 y al menos una fila; cada fila lleva aviso si la marca es relevante en ese GML (informativo). **Impacto** se calcula en el navegador con el flujo cargado (M8; en M9a no se muestra). **Confirmar** pide `confirm` con el resumen y, si alguna línea genera exceso (M8), lo repite. **Recepción**: en una compra confirmada, por línea "Registrar recepción" (mes, unidades, fecha); varias recepciones por línea. **Cancelar** (planner, o quien la creó mientras no esté recibida). **Compras del CD intercompany**: proveedor `es_intercompany` (origen `intercompany_cd`), líneas específicas de JH / Donatelli / VH con destino CD. Una línea de esas marcas con destino `intercompany_directo` lleva `directo_con_regla` (hay regla: se suma a la reposición esperada) o `directo_sin_regla` (no hay regla en M13 para esa marca y GML). *Decide*: qué, cuánto, a qué costo, cuándo llega.

### 4.5 Pendientes (`/compras/pendientes`; segunda entrega `0.14.1`)

Filas del flujo con `falta` o `quiebre` en los próximos `N` meses con responsable, primer mes con falta, saldo acumulado, cobertura hoy, en camino; "Lo mío"; Excel; **Comprar**.

### 4.6 Proveedores (`/compras/proveedores`; M9a)

Lista con buscador; alta y edición en `Modal` (nombre, código, país, ciudad, identificación, `es_intercompany`, nota) y **contactos** (nombre, cargo, teléfono, correo); desactivar (planner); el autocompletado crea un proveedor con solo el nombre. Banco y cuenta: segunda entrega, editables solo por el planner y con `updated_by` (I6).

### 4.7 Importar compras (`/compras/registro` → Importar; M9a)

Plantilla Excel nuestra con una fila de ejemplo: `PROVEEDOR`, `FECHA_COMPRA` (`aaaa-mm-dd`; **obligatoria** con la casilla de carga inicial, opcional sin ella), `REFERENCIA` (opcional; agrupa líneas en una compra), `TIPO` (`ESPECIFICA` / `UNA_MARCA` / `VARIAS_MARCAS`; vacío = específica), `GENERO`, `MUNDO`, `LINEA`, `EQUIVALENCIA` (opcional; exige nodo GMLE), `MARCA` **o** `AGRUPACION_MARCA`, `TALLAS`, `UNIDADES`, `COSTO_UNITARIO`, `MONEDA` (`PEN` / `USD`), `LLEGADA` (`aaaa-mm`), `DESTINO` (`CD`, código de tienda o `DIRECTO`), `ALCANCE` (opcional, `UNA_MARCA`: `HOMBRE;URBANO,CASUAL`), `NOTA`. Un lote de varias marcas va en **una segunda hoja `MEZCLA`** (`REFERENCIA`, `LINEA_ORDINAL`, `MARCA`, `GENERO`, `MUNDO`, `LINEA`, `EQUIVALENCIA`, `PCT`) que se valida por línea (suma 100). Mismo flujo de cuatro pasos (`use-importador`), `resolverGml` de 02b; crea **proveedores** nuevos, nunca marcas ni árbol. Omisiones: las de `resolverGml`, `marca_desconocida`, `marca_y_agrupacion`, `sin_marca_ni_agrupacion`, `agrupacion_desconocida`, `equivalencia_requiere_gmle`, `tallas_invalida`, `unidades_invalida`, `costo_invalido`, `llegada_invalida`, `destino_desconocido`, `gml_requerido`, `mezcla_sin_filas`, `mezcla_no_suma_100`, `fecha_requerida`, `duplicada_en_archivo`, `fila_total`. Avisos: `sin_reparto`, `llegada_pasada`, `directo_sin_regla`, `exceso` (solo con M8). Casilla **"Carga inicial de compras ya hechas"** (solo admin y planner): origen `carga_inicial`, estado `confirmada` al aplicar; sin la casilla, `borrador` a nombre de quien importa. **Idempotente por huella de fila = hash(contenido normalizado de la fila + ordinal en el archivo)** guardada en `compra_lineas.huella_importacion`; sin fecha por defecto (`current_date` haría que el mismo archivo creara compras nuevas otro día: hallazgo menor del revisor).

### Qué decide quién

| Decisión | Quién |
|---|---|
| Cuál cerrada de M7 alimenta el flujo y cuál es `k'` | sistema |
| Mínimo 4, tope 8, meses de la tarjeta | planner (parámetros globales) |
| Cobertura esperada y % directo de una marca intercompany | planner (M13) |
| Cómo se reparte un lote de una marca | sistema con el reparto vigente de M12 (temporada de llegada, alcance del comprador); el planner aplica una versión nueva |
| Cómo se reparte un lote de varias marcas | el comprador, con su tabla de porcentajes |
| Qué comprar, cuánto, a quién, cuándo llega, destino | **cualquier usuario** |
| Editar o confirmar un borrador | quien lo registró, o planner/admin |
| Recibir | cualquier usuario |
| Cancelar | quien registró o el planner |
| Proveedores | cualquiera crea y edita; el planner desactiva |

## 5. Método (lógica pura en `src/lib/flujo/` y `src/lib/compras/`, sin I/O)

Notación de la sección 3; `MIN = 4`, `MAX = 8`; meses del horizonte `m = k'+1 … H`.

1. **Filas**: `filasFlujo(cerrada, stockK, ingresos)`: una fila por `(g, a)` de la cerrada sumando bloques y tiendas; `D_m` para `m > k'` (si `k' > k`, los meses `k+1 … k'` pasan a historia con la venta real); más una fila `fila_sin_proyeccion` por cada `(g, a)` con stock o ingreso y sin fila (`D = 0`); `participaciones` de la fila base.
2. **Demanda**: completa. **2b · Subflujos intercompany**: para cada regla vigente y aplicable en `g` (M13 regla 4), `subflujoIntercompany(D, part_B, S^B_{k'}, I^B, regla, meses)` (M13 regla 5); el resto de la fila se evalúa con el 4–8 general; `C = C^resto + Σ_B C^B`; señal = peor.
3. **Stock**: `stockPorFila(stockK', configFlujo)`: cada fila de `stock_flujo(k')` pasa por `claveFlujo` → `(g, a)`; el stock por unidad de marca se conserva para los subflujos; `S_{k'} = Σ` (CD + tiendas); negativos a 0 por fila con aviso `stock_negativo`.
4. **Ingresos**: `ingresosPorFila(lineas, repartos, recepciones, k')`: por línea confirmada: `pendiente = unidades − recibidas`; específica → `(g, a)` en `max(llegada, k'+1)`; `barrer_marca` → sus filas de reparto escaladas a lo pendiente (`repartirEntero(pendiente, pesos del reparto guardado)`); `barrer_mezcla` → sus filas de reparto escaladas igual, cada una en `(g, a_marca)`; recepciones con `recibida_periodo > k'` → ingreso en ese periodo en la misma fila (o filas de reparto, proporcional); `≤ k'` → 0. Cualquier destino cuenta.
5. **Proyección**: `S_m = S_{m−1} + I_m − D_m`; `cob_m`; `obj_m`, `tope_m`; `C_m` y `S*_m` secuenciales; `X_m`; señales (regla 3: `falta` ⇔ `C_m > 0`). `mesesCobertura(700, [150,150,150,160,160,…]) = 4,5625`.
6. **Impacto de una línea** `impacto(flujoFila(s), lineaNueva)`: el flujo con la línea añadida y la diferencia por mes de `cob`, `C` y `X`; por cada `g` del reparto si es un lote.
7. **Reparto de un lote de una marca** `repartirLinea(linea, repartoVigente)`: elige el vector de la **temporada de llegada** (`MESES_TEMPORADA` de M12; en modo `anual`, el único), aplica el **alcance** de la línea (filtra `g` y renormaliza; alcance que deja 0 `g` → `409 alcance_vacio`), `repartirEntero` de M7 con `participacion_vigente`; guarda `reparto_id`, `version`, `temporada`, `alcance`, `error_reparto_pp`.
8. **Reparto de un lote de varias marcas** `repartirMezcla(unidades, filasPct)`: valida suma 100,0 ± 0,05 y `pct > 0`; `repartirEntero(unidades, pct)`; una fila por `(marca, g)`.
9. **"Lo mío"** `esMia(fila | linea, combinaciones)`.
10. **Estados y permisos** `transicion(compra, accion, usuario)` y **`puede(compra, usuario)`** (en el servidor, I6): `editar` y `confirmar` ⇔ `borrador` y (creador o planner/admin); `recibir` ⇔ `confirmada` (cualquier usuario); `cancelar` ⇔ no `recibida` y (creador o planner/admin); `aplicar_reparto` ⇔ planner/admin; `recibida` y `cancelada` inmutables.

Todo determinista, sin reloj (`k'`, `k` y `hoy` entran como parámetros).

## 6. Modelo de datos (`0021_compras.sql` en M9a y `0022_flujo.sql` en M8)

Convenciones de `0019`: idempotente, sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`, sin `do $$`, sin backfill; `id uuid`, `activo`, `created_at`, `updated_at`; RLS sin políticas; `revoke`/`grant` por objeto; funciones `security invoker`, `stable`, `search_path` vacío. **Criterio I9**: la base solo lleva invariantes estructurales (no negativos, primer día de mes, `recibidas ≤ unidades`, porcentajes 0–100); los catálogos (`origen`, `estado`, `moneda`, `tallas`, `destino`, `tipo`) los valida zod, sin `check`, para poder ampliarlos sin `DROP`. `create sequence if not exists public.compras_numero_seq`.

### 6.1 `proveedores` (`0021`)

`codigo` (opcional, único sobre `upper`), `nombre` (1–120, único sobre `upper`), `pais`, `ciudad` (≤ 80), `identificacion` (≤ 40), `es_intercompany boolean not null default false`, `nota` (≤ 300), `perfil_id → perfiles set null`, `usuario_nombre`, `activo` con uso (inactivo no se ofrece), timestamps. **Sin `banco` ni `cuenta_bancaria`** (segunda entrega, con `datos_bancarios_updated_by`).

### 6.2 `proveedor_contactos` (`0021`)

`proveedor_id → proveedores on delete cascade` (índice), `nombre` (1–120), `cargo`, `telefono`, `correo` (≤ 120, opcionales), `activo` por convención, timestamps.

### 6.3 `compras` (`0021`)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid pk` | |
| `numero` | `text not null default ('C-' \|\| lpad(nextval('public.compras_numero_seq')::text, 6, '0'))` | único |
| `proveedor_id` | `uuid not null → proveedores restrict` | índice |
| `origen` | `text not null default 'comprador'` | `comprador`, `carga_inicial`, `intercompany_cd` (zod) |
| `estado` | `text not null default 'borrador'` | `borrador`, `confirmada`, `recibida`, `cancelada` (zod); índice |
| `fecha_compra` | `date not null` | la API la exige (sin `default current_date`) |
| `referencia` | `text null` | ≤ 80 |
| `moneda` | `text not null default 'PEN'` | `PEN`, `USD` (zod) |
| `nota` | `text null` | ≤ 500 |
| `confirmada_at`, `confirmada_por_id`, `confirmada_por_nombre`, `cancelada_at`, `cancelada_por_nombre`, `motivo_cancelacion ≤ 200` | | |
| `perfil_id → perfiles set null`, `usuario_nombre` | | quién la registró (no "asignada a") |
| `activo`, `created_at`, `updated_at` | | se cancela, no se borra (borrar solo `borrador` sin líneas) |

### 6.4 `compra_lineas` (`0021`)

| Columna | Tipo | Notas |
|---|---|---|
| `id`, `compra_id → compras on delete cascade` | | índice |
| `tipo` | `text not null default 'especifica'` | `especifica`, `barrer_marca`, `barrer_mezcla` (zod); la API garantiza: específica ⇒ GML no nulo y exactamente una de marca/agrupación; `barrer_marca` ⇒ GML nulo, marca no nula (`barrido` o `mixta`), agrupación nula; `barrer_mezcla` ⇒ GML, marca y agrupación nulos y ≥ 1 fila en `compra_linea_mezcla` |
| `genero_mundo_linea_id` | `uuid null → genero_mundo_linea restrict` | |
| `equivalencia_id` | `uuid null → equivalencias restrict` | la API exige nodo `GMLE` y pertenencia |
| `marca_id` | `uuid null → marcas restrict` | la unidad de marca (un miembro se resuelve a su cabeza con aviso) |
| `agrupacion_marca_id` | `uuid null → agrupaciones_marca restrict` | |
| `tallas` | `text not null default 'ambas'` | `centrales`, `extremas`, `ambas` (zod) |
| `unidades` | `integer not null` | `check (unidades > 0)` |
| `unidades_recibidas` | `integer not null default 0` | `check (unidades_recibidas between 0 and unidades)`; suma de las recepciones (la API la mantiene) |
| `costo_unitario` | `numeric(12,4) null` | `check (costo_unitario >= 0)` |
| `llegada_periodo` | `date not null` | `check` primer día de mes; índice |
| `destino` | `text not null default 'cd'` | `cd`, `tienda`, `intercompany_directo` (zod) |
| `tienda_id` | `uuid null → tiendas restrict` | la API exige: `destino = 'tienda'` ⇔ `tienda_id` no nulo |
| `alcance` | `jsonb not null default '{}'` | solo `barrer_marca`: `{ generos?, mundos?, lineas? }` |
| `huella_importacion` | `text null` | único parcial `where not null` |
| `nota` | `text null` | ≤ 200 |
| `avisos` | `jsonb not null default '[]'` | calculados por la API al guardar |
| `activo`, `created_at`, `updated_at` | | |

Índices: `(genero_mundo_linea_id, llegada_periodo)`, `(marca_id)`, `(compra_id)`.

### 6.5 `compra_linea_mezcla` (`0021`; los porcentajes del comprador en un lote de varias marcas)

`linea_id → compra_lineas on delete cascade` (índice), `marca_id → marcas restrict` (unidad), `genero_mundo_linea_id → genero_mundo_linea restrict`, `equivalencia_id null`, `pct numeric(5,2) not null check (pct > 0 and pct <= 100)`, `activo`, timestamps; único `(linea_id, marca_id, genero_mundo_linea_id, coalesce(equivalencia_id, uuid cero))`. La suma por línea = 100 ± 0,05 la verifica la API.

### 6.6 `compra_linea_repartos` (`0021`; el reparto guardado de un lote, de una o de varias marcas)

`linea_id → compra_lineas on delete cascade` (índice), **`marca_id → marcas restrict`** (la unidad de marca de cada fila: la de la línea en `barrer_marca`, la de la fila de mezcla en `barrer_mezcla`), `genero_mundo_linea_id → genero_mundo_linea restrict`, `equivalencia_id null`, `unidades integer check (unidades >= 0)`, `reparto_id → repartos_marca_barrido restrict null` (nulo en mezcla), `reparto_version integer null`, `temporada text null`, `error_reparto_pp numeric(6,2) null`, `activo`, timestamps; único `(linea_id, marca_id, genero_mundo_linea_id, coalesce(equivalencia_id, uuid cero))`. La suma por línea = `unidades` de la línea (lo verifica la API). `reparto_cambio` = `reparto_id` ≠ vigente de la marca.

### 6.7 `compra_linea_recepciones` (`0021`; B3)

`linea_id → compra_lineas on delete cascade` (índice), `recibida_periodo date not null` (`check` primer día de mes), `unidades integer not null check (unidades > 0)`, `fecha_recepcion date not null`, `perfil_id → perfiles set null`, `usuario_nombre`, `nota ≤ 200`, `activo` por convención (quitar borra y la API resta de `unidades_recibidas`), timestamps.

### 6.8 `flujo_parametros` (`0022`)

Una fila por convención (`clave text not null default 'global'` único): `cobertura_min_meses numeric(4,1) not null default 4` (`check >= 0`), `cobertura_max_meses numeric(4,1) not null default 8` (`check >= 0`; `max ≥ min` en zod), `meses_tarjeta integer not null default 6` (`check > 0`), `extender_horizonte boolean not null default true`, `perfil_id`, `usuario_nombre`, `activo`, timestamps. Sin seed por `insert`: la API lee `coalesce(fila, defaults)`.

### 6.9 Función `stock_flujo(p_periodo date) returns jsonb` (`0022`)

El stock de fin de mes `p_periodo` desde `venta_stock_vigente`, agregado por `equivalencia_id`, `unidad_marca_id` (vía `marcas_unidad`), `agrupacion_talla_id` y `tipo` (`cd` / `tienda`), solo tiendas activas: `{ "periodo", "carga_id", "publicada_at", "filas": [...] }`. ~15 mil filas; `claveFlujo` se aplica en TS. Sin escritura.

### Diagrama

```
proyección cerrada (M7: D_m por GML-AM, participaciones por claveFlujo) ──────────────────────────────────────────────┐
intercompany_reglas (M13: cob. esperada + pct directo por marca × GML × mes) ─► subflujo por marca (D^B, S^B, I^B, R^B) ┤
stock_flujo(k') (M5 + marcas_unidad; CD y tiendas; por unidad de marca) ─► claveFlujo ─► S_{k'} por GML-AM ───────────┤
compras (borrador → confirmada → recibida | cancelada) ─► compra_lineas (especifica | barrer_marca | barrer_mezcla) ──┤
   ├─ barrer_marca ─► repartos_marca_barrido (M12: temporada de llegada, alcance) ─► compra_linea_repartos (marca, g, u) ┤
   ├─ barrer_mezcla ─► compra_linea_mezcla (pct del comprador) ─► compra_linea_repartos ─────────────────────────────────┤
   └─ compra_linea_recepciones (recibida_periodo > k' cuenta; ≤ k' ya está en el stock) ─► I_m por GML-AM ─────────────┤
flujo_parametros (mín 4, tope 8, meses tarjeta) ──────────────────────────────────────────────────────────────────────┴─► calcularFlujo (TS puro, a demanda, cache por huella)
                                                                                      │ S_m, cob_m, C_m, X_m, señales, subflujos, impacto de una línea
                                            Huecos (tarjetas) · Flujo mensual · Compras · Proveedores · Excel (documento para compradores) · Pendientes (0.14.1)
```

## 7. Contratos de API y de lógica pura

Convenciones de siempre. Handlers en `src/app/api/flujo/` y `src/app/api/compras/`; lógica pura en `src/lib/flujo/` (`tipos-api.ts`, `tipos.ts`, `filas.ts`, `subflujo.ts`, `stock.ts`, `ingresos.ts`, `cobertura.ts`, `modelo.ts`, `mio.ts`, `excel.ts`, `huella.ts`) y `src/lib/compras/` (`tipos-api.ts`, `esquemas.ts`, `reglas.ts`, `permisos.ts`, `reparto.ts`, `mezcla.ts`, `recepciones.ts`, `impacto.ts`, `importar.ts`, `proveedores.ts`); datos en `consultas.ts` de cada carpeta.

**Guards (I6).** M9 es el primer módulo en el que el **comprador escribe**. Lista explícita, que la prueba estática de guards (`tests/api.guards.estatico.test.ts`) recibe como lista blanca y que un test de handler recorre con el rol comprador:

| `requireUser` (los tres roles) | `requirePlanner` (el comprador recibe `403`) |
|---|---|
| `GET /api/flujo`, `GET /api/flujo/fila`, `GET /api/flujo/huecos`, `GET /api/flujo/parametros` | `PUT /api/flujo/parametros` |
| `GET`/`POST /api/compras`; `GET`/`PATCH`/`DELETE /api/compras/[id]`; `POST …/lineas`; `PATCH`/`DELETE …/lineas/[lineaId]`; `POST …/confirmar`; `POST …/recibir`; `POST …/cancelar`; `POST /api/compras/impacto`; `POST /api/compras/importar` sin `carga_inicial` | `POST /api/compras/importar` con `carga_inicial`; `POST /api/compras/[id]/aplicar-reparto`; `POST /api/compras/aplicar-reparto` (en bloque por marca) |
| `GET`/`POST /api/compras/proveedores`; `PATCH /api/compras/proveedores/[id]` | `DELETE /api/compras/proveedores/[id]` |

Además, dentro de `requireUser`, **`puede(compra, usuario)` se evalúa en el servidor** en `PATCH`, `DELETE`, `lineas`, `confirmar` y `cancelar` (`403 no_es_tuya` si un comprador toca el borrador de otro). `GET /api/flujo` entrega **unidades**, nunca `venta_soles` ni costo vendido de M5; el costo de las compras sí es visible para todos. La regla general del analizador de guards ("escrituras con `requirePlanner` o `requireAdmin`") aún no existe como prueba: M9a la crea junto con su lista blanca.

| Ruta | Método | Guard | Cuerpo (zod) | Respuesta `{ data }` y errores |
|---|---|---|---|---|
| `/api/flujo` | GET | `requireUser` | `?genero_id&mundo_id&linea_id&agrupacion_marca_id&solo=falta\|exceso\|quiebre&mio=1&meses=6` (**filtros en el servidor**, I8) | `{ datos: { cerrada: { id, nombre, hasta_periodo, anio_en_curso }, k, k_prima, horizonte, parametros, avisos: ("cerrada_atrasada"\|"horizonte_corto")[], huella }, filas: FilaFlujoApi[] (sin `al_barrer` ni `compras` por mes), totales, repartos_vigentes: RepartoVigenteApi[], reglas_intercompany: ReglaIntercompanyApi[], mis_combinaciones }`; `404 sin_cerrada`. Cache en memoria por `huella` |
| `/api/flujo/fila` | GET | `requireUser` | `?gml_id&equivalencia_id&agrupacion_marca_id` | `FilaFlujoDetalleApi` (la fila con `al_barrer`, `subflujos`, `compras` por mes, historia) |
| `/api/flujo/huecos` | GET | `requireUser` | mismos filtros | `TarjetaHuecoApi[]` (orden por saldo desc) |
| `/api/flujo/parametros` | GET / PUT | `requireUser` / `requirePlanner` | `{ cobertura_min_meses: 0.5..24, cobertura_max_meses (≥ mín, `refine`), meses_tarjeta: 1..24, extender_horizonte }` | `ParametrosFlujoApi`; `400` |
| `/api/compras` | GET / POST | `requireUser` | filtros; `crearCompraSchema = { proveedor_id?: uuid, proveedor_nombre?: 1-120, fecha_compra: date, referencia?: ≤ 80, moneda?: 'PEN'\|'USD', nota?: ≤ 500, origen?: 'comprador'\|'intercompany_cd' }` | `CompraApi[]` / `201 CompraApi`; `404 proveedor` |
| `/api/compras/[id]` | GET / PATCH / DELETE | `requireUser` + `puede` | `editarCompraSchema` (cabecera; solo `borrador`, salvo `nota`) | `CompraApi` con líneas, repartos, recepciones, avisos y `puede`; `409 no_editable`; `403 no_es_tuya`; `DELETE` solo `borrador` sin líneas |
| `/api/compras/[id]/lineas` | POST | `requireUser` + `puede` | `lineaSchema = z.discriminatedUnion('tipo', [ especifica: { genero_mundo_linea_id, equivalencia_id?, marca_id? \| agrupacion_marca_id? (una), tallas, unidades, costo_unitario?, llegada_periodo, destino, tienda_id?, nota? }, barrer_marca: { marca_id, alcance?: { generos?, mundos?, lineas? }, tallas, unidades, costo_unitario?, llegada_periodo, destino, tienda_id?, nota? }, barrer_mezcla: { filas: [{ marca_id, genero_mundo_linea_id, equivalencia_id?, pct: 0.01..100 }] (1..200), tallas, unidades, … } ])` con `refine` de suma 100 | `201 LineaCompraApi` (con `reparto` y `avisos`); `409 compra_no_editable`, `409 modalidad_no_barrer`, `409 equivalencia_requiere_gmle`, `409 equivalencia_de_otro_nodo`, `409 nodo_no_vigente`, `409 tienda_requerida`, `409 alcance_vacio`, `409 mezcla_no_suma_100` |
| `/api/compras/[id]/lineas/[lineaId]` | PATCH / DELETE | `requireUser` + `puede` | `lineaSchema` parcial por tipo; en `confirmada` solo `{ nota }` | `LineaCompraApi`; `409` |
| `/api/compras/[id]/confirmar` | POST | `requireUser` + `puede` | `{ acepta_exceso?: boolean }` | `CompraApi` `confirmada`; calcula y guarda repartos (M12 vigente por temporada de llegada y alcance; mezcla del comprador); `409 sin_lineas`, `409 ya_confirmada`, `409 exceso_sin_aceptar` (solo con M8 construido; en M9a no se evalúa) |
| `/api/compras/[id]/recibir` | POST | `requireUser` | `{ recepciones: [{ linea_id, recibida_periodo: mes, unidades: int > 0, fecha_recepcion: date, nota? }] }` | `CompraApi` (`recibida` si todo llegó); `409 excede_pendiente`; avisos `posible_duplicado`, `recibida_futura` |
| `/api/compras/[id]/cancelar` | POST | `requireUser` + `puede` | `{ motivo: 1-200 }` | `CompraApi`; `409 recibida`; `403 no_es_tuya` |
| `/api/compras/[id]/aplicar-reparto` | POST | `requirePlanner` | `{ linea_ids?: uuid[] }` | reemplaza los repartos de las líneas `barrer_marca` con `reparto_cambio`; `{ aplicadas }` |
| `/api/compras/aplicar-reparto` | POST | `requirePlanner` | `{ marca_id: uuid }` | **en bloque**: todas las líneas confirmadas y no recibidas de la marca con `reparto_cambio`; `{ aplicadas, compras: uuid[] }` |
| `/api/compras/impacto` | POST | `requireUser` | `{ lineas: lineaSchema[] (1..50) }` | `ImpactoApi[]`; en `0.14.0` solo para líneas de lote (que necesitan el reparto del servidor); el resto lo calcula el navegador; completo en `0.14.1` |
| `/api/compras/importar` | POST | `requireUser` (`carga_inicial` ⇒ `requirePlanner`) | `importarComprasSchema = { modo, carga_inicial?: boolean, filas: [...] (1..10 000), mezcla?: [...] }` | reporte (`totales`, `compras_a_crear[]`, `proveedores_a_crear[]`, `lineas[]`, `omitidas[]`, `avisos[]`) |
| `/api/compras/proveedores` | GET / POST | `requireUser` | `proveedorSchema = { nombre: 1-120, codigo?, pais?, ciudad?, identificacion?, es_intercompany?, nota?: ≤ 300, contactos?: [...] (≤ 20) }` | `ProveedorApi[]` / `201`; `409 nombre_repetido` |
| `/api/compras/proveedores/[id]` | PATCH / DELETE | `requireUser` / `requirePlanner` | `proveedorSchema.partial()` | `ProveedorApi`; `DELETE` desactiva si tiene compras |

```ts
export type Senal = "quiebre" | "falta" | "exceso" | "al_dia" | "sin_demanda" | "sin_curva";
export type TipoLinea = "especifica" | "barrer_marca" | "barrer_mezcla";
export type MesFlujoApi = { periodo: string; real: boolean; demanda: number; ingresos: number; stock_fin: number; cobertura: number | null; objetivo_min: number; tope: number; saldo: number; exceso: number; senal: Senal; extendido: boolean };
export type SubflujoApi = { marca_id: string; marca: string; regla_id: string; cobertura_min: number; cobertura_max: number; pct_directo: number; part: number; stock_k: number;
  meses: (MesFlujoApi & { reposicion_esperada: number })[]; resumen: { senal: Senal; cobertura_k: number | null; saldo_n_meses: number } };
export type FilaFlujoApi = { gml_id: string; equivalencia_id: string | null; agrupacion_marca_id: string; genero: string; mundo: string; linea: string; equivalencia: string | null; agrupacion_marca: string; nivel: "GML" | "GMLE";
  responsable: { perfil_id: string; nombre: string } | null; mia: boolean; stock_k: { cd: number; tiendas: number; total: number }; meses: MesFlujoApi[];
  subflujos_resumen: { marca: string; senal: Senal; cobertura_k: number | null; esperada: [number, number] }[];
  resumen: { senal: Senal; cobertura_k: number | null; saldo_n_meses: number; en_camino: number; primer_mes_falta: string | null; exceso_desde: string | null };
  avisos: ("intercompany_no_aplicable" | "sin_participaciones" | "stock_negativo" | "sin_curva" | "fila_sin_proyeccion")[] };
export type FilaFlujoDetalleApi = FilaFlujoApi & { historia: { periodo: string; venta: number; stock_fin: number }[]; al_barrer: { periodo: string; marcas: { marca_id: string; marca: string; unidades: number }[] }[];
  subflujos: SubflujoApi[]; resto: { meses: MesFlujoApi[] } | null;
  compras: { compra_id: string; numero: string; proveedor: string; linea_id: string; tipo: TipoLinea; marca: string | null; agrupacion_marca: string; tallas: string; unidades: number; llegada: string; estado: string }[] };
export type TarjetaHuecoApi = Pick<FilaFlujoApi, "gml_id" | "equivalencia_id" | "agrupacion_marca_id" | "genero" | "mundo" | "linea" | "equivalencia" | "agrupacion_marca" | "mia" | "responsable" | "stock_k" | "resumen" | "subflujos_resumen">;
export type EstadoCompra = "borrador" | "confirmada" | "recibida" | "cancelada";
export type RepartoLineaApi = { marca_id: string; marca: string; gml_id: string; equivalencia_id: string | null; ruta: string; unidades: number };
export type LineaCompraApi = { id: string; compra_id: string; tipo: TipoLinea; gml_id: string | null; equivalencia_id: string | null; ruta: string | null; marca_id: string | null; marca: string | null; agrupacion_marca_id: string | null;
  agrupacion_marca: string | null; tallas: "centrales" | "extremas" | "ambas"; unidades: number; unidades_recibidas: number; costo_unitario: number | null; llegada_periodo: string; destino: "cd" | "tienda" | "intercompany_directo";
  tienda: { id: string; codigo: string } | null; alcance: { generos: string[]; mundos: string[]; lineas: string[] } | null; mezcla: { marca_id: string; gml_id: string; equivalencia_id: string | null; pct: number }[] | null;
  reparto: { reparto_id: string | null; version: number | null; temporada: string | null; error_reparto_pp: number | null; vigente: boolean; filas: RepartoLineaApi[] } | null;
  recepciones: { id: string; recibida_periodo: string; unidades: number; fecha_recepcion: string; usuario_nombre: string | null; avisos: ("posible_duplicado" | "recibida_futura")[] }[];
  nota: string | null; avisos: ("sin_reparto" | "reparto_cambio" | "exceso" | "llegada_vencida" | "llegada_pasada" | "miembro_resuelto" | "directo_con_regla" | "directo_sin_regla")[] };
export type CompraApi = { id: string; numero: string; proveedor: { id: string; nombre: string; es_intercompany: boolean }; origen: "comprador" | "carga_inicial" | "intercompany_cd"; estado: EstadoCompra; fecha_compra: string;
  referencia: string | null; moneda: "PEN" | "USD"; nota: string | null; usuario_nombre: string | null; confirmada_at: string | null; lineas: LineaCompraApi[]; totales: { unidades: number; costo: number | null; recibidas: number };
  llegadas: { desde: string; hasta: string } | null; mia: boolean; puede: { editar: boolean; confirmar: boolean; recibir: boolean; cancelar: boolean; aplicar_reparto: boolean }; avisos: string[] };
export type ProveedorApi = { id: string; codigo: string | null; nombre: string; pais: string | null; ciudad: string | null; identificacion: string | null; es_intercompany: boolean; nota: string | null; activo: boolean; compras: number;
  contactos: { id: string; nombre: string; cargo: string | null; telefono: string | null; correo: string | null }[] };
export type ParametrosFlujoApi = { cobertura_min_meses: number; cobertura_max_meses: number; meses_tarjeta: number; extender_horizonte: boolean; usuario_nombre: string | null; updated_at: string | null };
```

Constantes (`src/lib/flujo/tipos.ts`): `COBERTURA_MIN = 4`, `COBERTURA_MAX = 8`, `MESES_TARJETA = 6`, `MESES_EXTENSION = 12`, `VERSION_METODO_FLUJO = 2`; `TOLERANCIA_MEZCLA = 0.05` (`src/lib/compras/tipos.ts`).

| Función pura | Archivo | Reglas |
|---|---|---|
| `filasFlujo(cerrada, stock, ingresos, kPrima)` | `flujo/filas.ts` | 1 |
| `subflujosFila(fila, reglas, stockPorMarca, ingresosPorMarca)` (usa `subflujoIntercompany` de M13) | `flujo/subflujo.ts` | 2 |
| `stockPorFila(stockK, configFlujo)` | `flujo/stock.ts` | 3 |
| `ingresosPorFila(lineas, repartos, recepciones, kPrima)` | `flujo/ingresos.ts` | 4 |
| `mesesCobertura`, `proyectarFila(fila, parametros)` | `flujo/cobertura.ts` | 5, 6, 7 |
| `calcularFlujo(entrada)` determinista; `resumenTarjeta(fila, n)`; `huellaFlujo(entrada)` | `flujo/modelo.ts`, `flujo/huella.ts` | 8 |
| `esMia(fila, combinaciones)` | `flujo/mio.ts` | 9 |
| `hojasFlujo(filas, filtro)`, `hojasCompras(compras)` | `flujo/excel.ts` | 10 |
| `repartirLinea(linea, repartoVigente)` (temporada de llegada, alcance; `repartirEntero` de M7) | `compras/reparto.ts` | 11 |
| `repartirMezcla(unidades, filas)`, `validarMezcla(filas)` | `compras/mezcla.ts` | 12 |
| `ingresosDeRecepciones(recepciones, kPrima)`, `avisosRecepcion(recepcion, kPrima, hoy)` | `compras/recepciones.ts` | 13 |
| `impactoLinea(flujoFila(s), linea)` | `compras/impacto.ts` | 14 |
| `motivoRechazoLinea(linea, estado)`, `transicion(compra, accion, usuario)`, `puede(compra, usuario)` | `compras/reglas.ts`, `compras/permisos.ts` | 15, 16, 17 |
| `previsualizarImportacionCompras(filas, mezcla, estado, opciones)`, `huellaFila(fila, ordinal)` | `compras/importar.ts` | 18 |
| `motivoRechazoProveedor` | `compras/proveedores.ts` | 19 |

## 8. Reglas de negocio (vitest)

1. **Filas** = una por `(g, a)` de la cerrada más las `fila_sin_proyeccion`; `Σ_f D_m` = total mensual de la cerrada; fila sin curva → `sin_curva` (no es exceso ni falta); con `k' > k`, los meses `k+1 … k'` son historia y el horizonte empieza en `k'+1` con `cerrada_atrasada`.
2. **Subflujo**: con la regla de JH (2–4, 80 %), `D = 1 200`, `part = 0,40`, `S^B = 900` → `D^B = 480`, `R^B = 384`, `S^B_{k'+1} = 804`, `C^B = 156`, señal `falta`; el resto de la fila (`D = 720`, `S = S − 900`) se evalúa con 4–8; `C_fila = C^resto + C^B`; regla no aplicable → sin subflujo y aviso `intercompany_no_aplicable`; fila sin participaciones → `sin_participaciones`.
3. **Stock**: CD + tiendas, clasificado por `claveFlujo` (BETA al barrer en DENIM cuenta en DENIM × PREMIUM; un miembro en su cabeza); el stock por unidad de marca alimenta los subflujos; negativos a 0 con aviso; `Σ_f S_{k'}` = stock total del mes sin negativos.
4. **Ingresos**: `borrador` → 0; `confirmada` con 500 y 200 recibidas en `k'+1` → 300 pendientes en `llegada` **más** 200 en `k'+1` (recepción `> k'`); la misma recepción fechada en `k'` → 0 y `posible_duplicado`; `llegada ≤ k'` no recibida → `k'+1` con `llegada_vencida`; `recibida` del todo con recepciones `≤ k'` → 0; `cancelada` → 0; destino `intercompany_directo` → cuenta (con `directo_con_regla` o `directo_sin_regla`); lote de una marca con 1 000 y 300 recibidas → sus repartos escalados a 700 (`repartirEntero`); mezcla → cada fila en `(g, a_marca)`. Invariante: `Σ_f I_m` = Σ pendientes con fila + recepciones `> k'`.
5. **Cobertura**: `mesesCobertura(700, [150,150,150,160,160])` = `4,5625`; `(0, …)` = 0; `(−10, …)` = 0; demanda futura toda 0 → `null` (`sin_demanda`); más allá del horizonte se repite el último año (`extendido`).
6. **Saldo secuencial y señal**: en el ejemplo de 4.3, `C_oct = 70`, `C_nov = C_dic = C_ene = 0`, `C_feb = 140`; **`falta` ⇔ `C_m > 0`** (ene es "—" aunque `cob_ene = 3,7`); `Σ_m C_m` deja `cob*_m ≥ MIN` en todos los meses con demanda (propiedad); añadir un ingreso nunca sube `C_j` (monotonía).
7. **Exceso**: `X_m = max(0, S_m − tope_m)` sin sugerencias; una compra de 2 000 en nov con `tope_nov = 1 270` → `X_nov = 1 130`; `quiebre` > `falta` > `exceso` en el resumen.
8. **Determinismo y balance**: `Σ_f (S_{k'} + Σ I − Σ D) = Σ_f S_H`; `huellaFlujo` cambia si cambia la cerrada, la carga de `k'`, cualquier compra, un reparto vigente, una regla o los parámetros, y no cambia si no.
9. **Lo mío**: fila de HOMBRE × URBANO es mía si soy responsable; un lote es mío si algún `g` del reparto lo es; un planner sin combinaciones tiene "lo mío" vacío y la pantalla abre en Todos.
10. **Excel = pantalla**.
11. **Reparto de un lote de una marca**: `repartirLinea(1 000, BETA v2, llegada dic)` usa el vector de **verano**; con llegada jun, el de invierno; con alcance `HOMBRE` filtra y renormaliza (`590 / 293 / 117` sin alcance → `668 / 332` con alcance en el fixture); alcance que deja 0 `g` → `alcance_vacio`; sin reparto vigente → `reparto = null` y `sin_reparto`; marca `por_gml` → `modalidad_no_barrer`; una mixta con GML en la línea es específica.
12. **Mezcla**: `validarMezcla` exige suma 100 ± 0,05 y `pct > 0`; `repartirMezcla(1 000, [40, 20, 25, 15])` = `400 / 200 / 250 / 150` (suma exacta); una fila con marca sin tratamiento especial se acepta; `reparto_id` nulo y `reparto_cambio` nunca se activa.
13. **Recepciones**: `excede_pendiente` si la suma supera las unidades; `unidades_recibidas` = suma; `recibida` cuando todas las líneas llegan; quitar una recepción resta; `recibida_futura` si `recibida_periodo > mes(hoy)`.
14. **Impacto**: añadir 500 en nov a la fila del ejemplo sube `cob_nov` de 2,56 a 5,69 y baja `C_nov..C_ene` a 0 y `C_feb` a 140; un lote devuelve un impacto por `g`.
15. **Línea válida**: específica con exactamente una de marca/agrupación y GML no nulo; `barrer_marca` sin GML y marca `barrido`/`mixta`; `barrer_mezcla` con ≥ 1 fila; equivalencia solo en nodo GMLE y del mismo nodo; destino `tienda` exige `tienda_id` activa de tipo Tienda; `unidades > 0`; `llegada` primer día de mes; un miembro se resuelve a su cabeza.
16. **Transiciones**: `borrador → confirmada` exige ≥ 1 línea; `confirmada → recibida` cuando todas llegan; `cancelar` solo si no está `recibida`; editar solo en `borrador`; `recibida` / `cancelada` inmutables.
17. **Permisos (`puede`, probado con el handler)**: C2 sobre el borrador de C1: `GET` 200, `PATCH` 403, `POST lineas` 403, `confirmar` 403, `cancelar` 403, `recibir` (tras confirmar C1) 200; el planner puede todo; C1 `aplicar-reparto` → 403; C1 `PUT parametros` → 403; C1 `DELETE proveedores/[id]` → 403; C1 `importar` con `carga_inicial` → 403.
18. **Importador**: `MARCA` y `AGRUPACION_MARCA` a la vez → `marca_y_agrupacion`; `EQUIVALENCIA` en nodo GML → `equivalencia_requiere_gmle`; `VARIAS_MARCAS` sin hoja `MEZCLA` → `mezcla_sin_filas`; mezcla que suma 98 → `mezcla_no_suma_100`; `carga_inicial` sin `FECHA_COMPRA` → `fecha_requerida`; `REFERENCIA` agrupa líneas; sin referencia, una compra por proveedor y fecha; **reimportar el mismo archivo → 0 nuevas** (huella = hash(contenido + ordinal)); reimportarlo **otro día** → 0 nuevas; `carga_inicial` → `confirmada` y origen `carga_inicial`; sin ella, `borrador`.
19. **Proveedores**: nombre único sobre `upper`; desactivar con compras en vez de borrar; contactos ≤ 20; la API no acepta `banco` ni `cuenta_bancaria` (`400`, clave desconocida).
20. **SQL (humo local)**: `0021` y `0022` aplican dos veces; los `check` estructurales rechazan `unidades = 0`, `unidades_recibidas > unidades`, `pct = 0`, `llegada_periodo = 2026-01-15`; **no** hay `check` de catálogo en `origen`, `estado`, `moneda`, `tallas`, `destino`, `tipo`; `numero` se asigna solo y es único; `stock_flujo` separa `cd` y `tienda`, suma miembros en la cabeza y excluye tiendas inactivas; `anon` no lee nada.
21. **Estático**: la lista blanca de guards de la sección 7 es exactamente la que usan las rutas (ni una más ni una menos); `src/lib/flujo/` y `src/lib/compras/` no importan `@supabase/*` fuera de `consultas.ts`; `GET /api/flujo` no selecciona `venta_soles` ni `costo_vendido`; `nav.ts` registra Compras con `TODOS`.

## 9. Casos sintéticos (`tests/flujo.fixture.ts`, `tests/compras.fixture.ts`)

Reutiliza el árbol y las marcas de los fixtures de M7, M12 y M13: `HOMBRE · URBANO · DENIM` (GML), `HOMBRE · CASUAL · POLO`, `MUJER · CASUAL · SANDALIA`, `HOMBRE · FORMAL · CAMISA` (GMLE: MANGA LARGA, MANGA CORTA); marcas ALFA (RECONOCIDO, relevante en DENIM), BETA (PREMIUM, al barrer, reparto v2 por temporada: verano DENIM 0,59 · POLO 0,293 · SANDALIA 0,117; invierno distinto; error 8 pp), GAMMA (RECONOCIDO, mixta: específica en CAMISA), DELTA (VALOR, al barrer, sin reparto), JH (RECONOCIDO, relevante en CAMISA; regla M13 2–4 m, 80 % desde 2026-01). Tiendas T01, T02, CD. Cerrada "Proyección 2026–2027" con `k = 2026-09`; `k' = 2026-09` (y una variante con oct-2026 publicado, `k' = 2026-10`). Usuarios: planner P, comprador C1 (HOMBRE × URBANO), comprador C2 (HOMBRE × FORMAL y MUJER × CASUAL). Parámetros 4 / 8 / 6.

1. **Fila DENIM × RECONOCIDO**: `D` = 150 oct–dic 2026, 160 ene–nov 2027, 183 dic 2027; stock set: CD 300 + T01 250 + T02 150 = 700. Sin compras: `S_oct = 550`, `cob_oct = 3,56`, `C_oct = 70`, `C_nov = 160`, …; tarjeta `FALTA`, `saldo_n_meses = 70 + 160 × 5 = 870` sin compras; `primer_mes_falta = 2026-10`.
2. **Compra C-000012** (C1, Proveedor Norte, PEN, fecha 2026-10-14) con ALFA · DENIM · centrales · 500 · 38,00 · nov · CD: en `borrador` nada cambia; al **confirmar**, `I_nov = 500`, `S_nov = 900`, `cob_nov = 5,69`, `C_nov = C_dic = C_ene = 0`, `C_feb = 140`; tarjeta `saldo_n_meses = 370`; `impacto` coincide.
3. **Exceso**: ALFA · DENIM · 2 000 · nov → `X_nov = 1 130`; `confirmar` sin `acepta_exceso` → `409 exceso_sin_aceptar`; con él → confirmada y aviso `exceso`; tarjeta `EXCESO`.
4. **Lote de una marca**: BETA · ambas · 1 000 · dic (verano) · CD → reparto v2 verano `590 / 293 / 117`; con alcance HOMBRE → `668 / 332` (SANDALIA fuera); `I_dic` en DENIM × PREMIUM y POLO × PREMIUM; llegada jun → vector de invierno; aprobar v3 de BETA → `reparto_cambio`; `POST /api/compras/aplicar-reparto { marca_id: BETA }` (P) → todas las líneas de BETA al vigente; C1 → `403`.
5. **Lote de varias marcas**: 1 000 u con `BETA·DENIM 40 %`, `BETA·POLO 20 %`, `GAMMA·CAMISA›M. LARGA 25 %`, `DELTA·SANDALIA 15 %` → `400 / 200 / 250 / 150` en DENIM × PREMIUM, POLO × PREMIUM, CAMISA › M. LARGA × RECONOCIDO, SANDALIA × VALOR; sin `reparto_id`; con 98 % → `409 mezcla_no_suma_100`; la línea es mía para C1 (DENIM) y para C2 (CAMISA, SANDALIA).
6. **Marca sin reparto**: DELTA · 300 como lote de una marca → `sin_reparto`, ingresos 0; aprobar un reparto en M12 y `aplicar-reparto` → entra.
7. **Mixta**: GAMMA · CAMISA › MANGA LARGA · 200 → específica; GAMMA sin GML · 200 → lote de una marca con su reparto (solo DENIM).
8. **Intercompany**: CAMISA › MANGA LARGA × RECONOCIDO con `D_oct = 1 200`, `part_JH = 0,40`, stock de JH 900: subflujo `D^B = 480`, `R^B = 384`, `S^B_oct = 804`, `cob^B = 1,7`, `C^B_oct = 156`, `falta`; el resto (`D = 720`, stock total − 900) con 4–8; la fila muestra ambos; quitar la relevancia de JH y cerrar una proyección nueva → `intercompany_no_aplicable`, sin subflujo; línea JH · CAMISA · 300 · nov · `intercompany_directo` → `I^B_nov = 300` y `directo_con_regla`; la misma de DONATELLI sin regla en CAMISA → `directo_sin_regla`.
9. **Recepción (B3)**: C-000012 con una recepción de 200 en oct-2026 (`k' = set`) → `I_oct = 200`, pendiente 300 en nov; publicar oct-2026 (`k' = oct`) → la recepción cuenta 0 (ya está en el stock de octubre) y los 300 siguen en nov; una recepción fechada en set con `k' = set` → `posible_duplicado`; recibir 600 → `409 excede_pendiente`; recibir el resto → `recibida`.
10. **Cerrada atrasada (B3)**: con oct-2026 publicado y la cerrada de set, el flujo arranca con el stock de oct, octubre pasa a historia real, el horizonte empieza en nov y hay `cerrada_atrasada`.
11. **Atrasada**: llegada ago-2026 confirmada y no recibida → cuenta en `k'+1` con `llegada_vencida`; importarla → `llegada_pasada`.
12. **Lo mío**: C1 ve `mia = true` en DENIM y en C-000012; el planner con `mio=1` recibe lista vacía y la pantalla cae a Todos.
13. **Importador**: plantilla con 5 filas (ALFA·DENIM; BETA `UNA_MARCA` con `ALCANCE = HOMBRE`; GAMMA·CAMISA›MANGA CORTA; una `VARIAS_MARCAS` con su hoja `MEZCLA`; una con `MARCA` y `AGRUPACION_MARCA`) y proveedor nuevo "Feria Sur" → `proveedores_a_crear = ["Feria Sur"]`, `omitidas = 1`, 2 compras (por referencia); aplicar como C1 → `borrador`; con `carga_inicial` como P → `confirmada`; reimportar hoy y "mañana" → 0 nuevas; C1 con `carga_inicial` → `403`; sin `FECHA_COMPRA` con `carga_inicial` → `fecha_requerida`.
14. **Parámetros**: `PUT` mín 3 / tope 6 (P) → DENIM deja de tener `falta` en oct; `PUT` mín 8 / tope 6 → `400`; C1 → `403`.
15. **Horizonte corto**: solo la cerrada de 2025 y `hoy` en ene-2027 → horizonte hasta dic-2026 con `horizonte_corto`; sin cerrada → `404 sin_cerrada`.
16. **Fila sin proyección (I5)**: stock de una marca VALOR en SANDALIA sin fila en la cerrada → fila con `D = 0`, `fila_sin_proyeccion`, `sin_demanda`; `Σ_f S_{k'}` sigue igualando el stock total.
17. **Permisos**: el caso 17 de la sección 8 recorrido con los handlers reales (C2 contra la compra de C1).
18. **Excel y proveedores**: como en la primera versión (`hojasFlujo` con filtro HOMBRE; `POR_PROVEEDOR`; "proveedor norte" repetido → `409`; `DELETE` con compras desactiva; `POST /api/compras` con `proveedor_nombre` crea el proveedor).
19. **Caché**: dos `GET /api/flujo` seguidos sin cambios devuelven la misma `huella` y no recalculan (contador en el test); confirmar una compra cambia la huella.

## 10. Criterios de aceptación / hito de prueba (Cowork y Javier)

**Automático** · lint, tsc, vitest (más `tests/flujo.*` y `tests/compras.*`), build, `validar-migraciones-local.sh`; `0021` (M9a) y `0022` (M8) aplicadas; tipos regenerados; `APP_VERSION = 0.13.0 · M9` y luego `0.14.0 · M8`.

**Prerrequisitos de Javier** · Para M9a: compradores creados y las 40 combinaciones repartidas (M1b); la plantilla de carga inicial llena; la lista de proveedores; repartos aprobados en M12 para las marcas al barrer con compras pendientes de un solo lote. Para M8: una proyección **cerrada** en M7 posterior a M12 (con VH, JH y DONATELLI marcadas); reglas de M13.

**Hito M9a (sección I-a de `cowork-checklist.md`; ✍️ = pedir confirmación a Javier; usuarios: planner y comprador de prueba)**
1. Como comprador: la sección Compras aparece con Compras y Proveedores; las pantallas de planificación siguen ocultas; `PUT /api/flujo/parametros`, `aplicar-reparto`, `DELETE` de proveedor e importar con carga inicial responden `403`.
2. ✍️ Crear un proveedor nuevo desde el autocompletado de una compra; agregar una línea **específica** (marca, centrales, unidades, llegada); guardar borrador; **Confirmar**.
3. ✍️ Agregar una línea de **lote de una marca** al barrer con alcance "hombre" y ver el reparto por GML (temporada de llegada y error histórico) antes de confirmar; confirmar.
4. ✍️ Agregar una línea de **lote de varias marcas** con la tabla de porcentajes; la suma distinta de 100 bloquea; confirmar.
5. ✍️ Registrar una recepción parcial de una línea en el mes en curso; otra fechada en un mes ya publicado (ver `posible_duplicado`); recibir todo y ver la compra `recibida`.
6. Como comprador 2: abrir la compra del comprador 1: se ve, no se edita (botones ocultos y `403` por API).
7. ✍️ Importar la plantilla de **carga inicial** como planner (previsualizar: proveedores a crear, compras y líneas, omitidas con motivo; aplicar); reimportar al día siguiente y ver 0 nuevas.
8. En el celular (o Chromium a 390 px): Compras → Nueva → Confirmar sin que ningún control quede fuera.

**Hito M8 (sección I-b)**
1. Huecos abre en "Lo mío" con las tarjetas de sus combinaciones; en una con `FALTA`, el medidor bajo 4; en una con `EXCESO`, sobre 8; `GET /api/flujo` responde unidades y ninguna cifra en soles.
2. Flujo mensual: comprobar a mano una celda de cobertura y una de saldo; desplegar por marca; en una fila de JH, DONATELLI o VH ver el **subflujo** con su cobertura esperada y la reposición directa; el resto de la fila con 4–8.
3. ✍️ Desde una tarjeta con falta: **Comprar** → ver el **impacto** antes de agregar; confirmar; el saldo baja y la tarjeta cambia.
4. ✍️ Registrar una compra que pase el tope: el `confirm` avisa; aceptar; la fila muestra `exceso`.
5. ✍️ Aprobar un reparto nuevo en M12 para una marca con lotes confirmados: `reparto_cambio`; "Aplicar a todas las líneas de la marca" cambia las unidades por GML.
6. Publicar un mes en M5 sin cerrar una proyección nueva: el flujo arranca con el stock nuevo, el mes pasa a historia y avisa `cerrada_atrasada`.
7. Parámetros: cambiar el mínimo a 3 (✍️) y ver menos faltas; volver a 4.
8. Exportar el flujo con un filtro de género; Javier lo compara con el documento que hoy entrega a los compradores.
9. ✍️ Javier revisa tres huecos que conoce y, con la foto del revisor delante (8,6 meses globales, 59 % en el CD, ~40 % de filas en exceso), confirma el 4–8 y si todo el stock del CD cuenta.

## 11. Alcance

**M9a (`0.13.0 · M9`)**: proveedores con contactos (sin banco); compras con cabecera y líneas de tres tipos (específica, lote de una marca con alcance y reparto por temporada de llegada, lote de varias marcas con porcentajes del comprador); confirmar, recepciones por evento, cancelar; permisos `puede` en el servidor; importador con plantilla, hoja `MEZCLA`, casilla de carga inicial e idempotencia por hash; "lo mío"; Excel de compras. Sin flujo: las líneas no muestran impacto ni exceso.

**M8 (`0.14.0 · M8`)**: flujo a demanda con cache por huella; demanda completa; subflujos intercompany con cobertura esperada; stock de `k'`; ingresos con recepciones; cobertura, saldo, exceso y señales (`falta` ⇔ saldo); `fila_sin_proyeccion`; Huecos (tarjetas), Flujo mensual con detalle por fila, Parámetros, impacto en el navegador (y en el servidor para lotes), aplicar reparto por línea, compra o marca; Excel del flujo.

**Segunda entrega (`0.14.1`)**: vista por marca al barrer (`D^b`, `C^b`), Pendientes, Avance por árbol, `/api/compras/impacto` completo en el servidor; datos bancarios del proveedor (solo planner, `updated_by`); desglose y saldo **por talla**; parámetros por agrupación o GML; plazo de entrega por proveedor; costo objetivo; producto / modelo como texto libre; alertas; foto mensual del flujo; tipo de cambio.

**Fuera de alcance**: recalcular o repartir la demanda (M7); calcular repartos (M12), coberturas esperadas o porcentajes de intercompany (M13); cargar stock (M5); OTB por temporada; asignar compras a un comprador; que el comprador vea soles de venta.

## 12. Riesgos

- **Dependencia de la cerrada**: sin cerrada no hay flujo; con `k' > k` la demanda proyectada puede estar vieja (`cerrada_atrasada`), pero el stock ya es el nuevo.
- **Reposición directa esperada**: es un supuesto de M13; si no se modela, el saldo de JH, DONATELLI y VH sube.
- **Doble conteo recepción / stock**: una recepción fechada en un mes futuro que en realidad ya está en el stock publicado se cuenta dos veces; `posible_duplicado` solo cubre el caso inverso; el hito 5 de M9a lo prueba.
- **Lotes de varias marcas**: los porcentajes son un juicio del comprador; no hay estadística que los valide (y Javier lo sabe: "no hay otra").
- **Guards `requireUser` en escrituras**: primera vez; la lista blanca explícita, `puede` en el servidor y la auditoría de `seguridad` (opus) antes del hito.
- **Carga masiva sin transacción**: un corte deja compras en `borrador` sin líneas, visibles y borrables.
- **Mobile**: el detalle de compra debe caber; la PWA entra después.
- **Volumen**: ~1 700 filas × 15 meses en el navegador: la lista lleva solo `meses` y resumen; el detalle por fila se pide aparte.

## 13. Decisiones nuevas propuestas (para `docs/DECISIONES.md`)

1. **M8: el flujo se calcula a demanda (cache por huella) a partir de la cerrada, el stock del último mes publicado `k'`, las compras confirmadas con sus recepciones, los repartos de M12 y las reglas de M13; no se guarda.** Descartado: tablas de flujo; arrancar del stock de la cerrada cuando hay un mes más publicado.
2. **M8: cobertura = meses de demanda futura que cubre el stock CD + tiendas; mínimo 4 y tope 8 globales; el saldo es secuencial y la señal `falta` es "hay saldo en el mes"; el exceso se mide sin sugerencias; `sin_curva` es un estado propio.**
3. **M8: las marcas intercompany se evalúan en un subflujo dentro de la fila con demanda y stock completos, reposición directa esperada como ingreso y su cobertura esperada; las compras del CD intercompany y las directas son ingresos.** Descartado: demanda neta; stock neto.
4. **M9: una línea es específica, lote de una marca (reparto de M12 por temporada de llegada, con alcance) o lote de varias marcas (porcentajes del comprador que suman 100); las recepciones son eventos con mes; "reparto cambió" se aplica por línea, compra o marca.** Descartado: una compra = una línea; estadística para lotes mezclados.
5. **M9: todos los roles ven y registran; `puede(compra, usuario)` en el servidor (editar y confirmar un borrador: su creador o el planner; recibir: cualquiera; cancelar: creador o planner); lista blanca explícita de rutas `requireUser`; sin datos bancarios en la primera entrega.**
6. **M9: proveedores como maestro que crea cualquier usuario; se desactivan si tienen compras.**
7. **M9: una sola plantilla Excel (más hoja `MEZCLA`) para carga inicial y carga masiva; idempotente por hash de contenido y ordinal; la fecha de compra es obligatoria en carga inicial.**
8. **M8 + M9 se entregan en dos pasos (M9a, luego M8) y la base solo lleva invariantes estructurales** (I9).
9. **Look and feel de `COTBV2` reproducido con el kit de Vector2.**

**Cambios que integra el `documentador`**: PLAN §3 (el comprador "registra sus compras y crea proveedores" desde M9a), PLAN §4 (tablas `proveedores`, `proveedor_contactos`, `compras`, `compra_lineas`, `compra_linea_mezcla`, `compra_linea_repartos`, `compra_linea_recepciones`, `flujo_parametros`, función `stock_flujo`, secuencia; migraciones `0021` y `0022`; versiones `0.13.0 · M9` y `0.14.0 · M8`), PLAN §5 (filas M8 y M9 reescritas con el orden nuevo; la PWA después), PLAN §7, `cowork-checklist.md` secciones I-a e I-b, `nav.ts`, ficha 10.

## 14. Orden de construcción y dependencias (M12 → M13 → M9a → M8)

```
M7 (0.10.0, construido) ──► cerrada con participaciones ───────────────────────────────────────────────┐
M12 (0.11.0) ──► claveFlujo con mixta + huella_flujo en M7 (antes de la cerrada que lea M8) ──► repartos ─┼──► M9a (0.13.0 · M9) ──► M8 (0.14.0 · M8) ──► 0.14.1 ──► PWA
M13 (0.12.0) ──► reglas con cobertura esperada (02b + VH marcada; independiente de M12) ────────────────┘
```

- **M12 primero**: su cambio a `claveFlujo` y `huella_flujo` tocan M7 y deben estar antes de cerrar la proyección que M8 leerá; sus repartos son lo que M9a necesita para los lotes de una marca (sin ellos, las líneas quedan `sin_reparto` y se resuelven después).
- **M13 segundo**, pequeño e independiente de M12; puede ir en paralelo con M12 o con M9a. Su prerrequisito es marcar VH, JH y DONATELLI y cerrar una proyección nueva.
- **M9a tercero**: los compradores empiezan a registrar (y el planner a cargar la carga inicial) aunque el flujo no exista; `0021`; `seguridad` (opus) revisa las rutas `requireUser` antes de su hito.
- **M8 cuarto**: cuando existan la cerrada nueva, repartos y reglas; `0022`; paso A lógica pura con los casos de la sección 9, paso B rutas y pantallas (Flujo, Huecos, Parámetros, impacto, aplicar reparto), paso C `qa` y `documentador`. **`0.14.1`** después, y la **PWA** justo después.
- Migraciones: `0019` (M12), `0020` (M13), `0021` (M9a), `0022` (M8); se confirman al construir (la `0018` ya es de M7).

## 15. Entradas pendientes de Javier

- **Plantilla de carga inicial** llena (sección 4.7, con la hoja `MEZCLA` si hay lotes de varias marcas) y la lista de proveedores con contactos.
- **El documento que hoy entrega a los compradores**, para que el Excel del flujo no deje fuera ningún campo.
- Compradores creados en `/usuarios` y las 40 combinaciones repartidas (M1b).
- Para M13: conjunto JH; marcar JH, DONATELLI y VAN HEUSEN como relevantes; la lista de coberturas esperadas y porcentajes por GML.
- Respuestas a la sección 16.

## 16. Preguntas para Javier (cinco; mientras tanto rige la recomendación)

1. **¿Cuenta todo el stock del CD en la cobertura?** La foto del revisor: 8,6 meses globales, 59 % del stock en el CD y ~40 % de las filas en exceso con 4–8. Si parte del CD es mercadería que no abastece a estas filas (devoluciones, saldos, muestras), habría que excluirla por ubicación o por marca. **Recomendación: todo cuenta, con el CD separado en la tarjeta y en el flujo; si Javier identifica stock que no debe contar, se excluye por tienda o por agrupación en la segunda entrega.**
2. **¿Qué ve cada comprador por defecto?** **Recomendación: "Lo mío" si tiene combinaciones en M1b; si no, "Todos"; el chip cambia en un toque.**
3. **Destinos e intercompany.** Una línea a tienda cuenta como ingreso; una `intercompany_directo` también (el stock es completo y se avisa si la marca tiene o no regla); la reposición directa regular se modela como ingreso esperado `% × demanda`. **Recomendación: sí a las tres.**
4. **Confirmar con exceso.** **Recomendación: se confirma con aviso (la oportunidad manda); no hace falta aprobación del planner.**
5. **Quién cancela y quién edita.** **Recomendación: cancelar, quien registró o un planner; editar o confirmar un borrador ajeno, solo el planner; recibir, cualquiera; aplicar un reparto nuevo, solo el planner.**

Resueltas por Javier (ronda 3) o por el revisor con valor por defecto: compras al barrer de varias marcas (porcentajes del comprador); stock del intercompany directo (cobertura esperada); cerrada atrasada (arranca del stock de `k'`); cobertura hacia adelante contra la demanda futura; un solo mínimo y tope globales en la primera entrega; saldo expresado por mes de llegada.
