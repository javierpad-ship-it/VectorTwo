# M8 + M9 · Definiciones del dueño (borrador de entrada para las fichas 08, 12 y 13)

Estado: **en definición con Javier; tres rondas de respuestas (2026-10-15).** Este archivo recoge lo que ya dijo para que el arquitecto lo use al escribir y ajustar las fichas de M8 (flujo y necesidad de compra), M9 (compras de los compradores), M12 (análisis de marcas al barrer) y M13 (intercompany). No es una especificación.

## Decidido por Javier

1. **M8 y M9 se definen juntos.** M8 necesita los ingresos futuros y esos los registran los compradores en M9. El ciclo es: M7 da la venta mensual proyectada por GML-AM → M8 la compara con stock y con lo que viene en camino y deja el hueco por comprar → el comprador registra compras en M9 → M8 se recalcula.
2. **No se compra por temporada, se compra por oportunidad.** No hay OTB por temporada (VER/INV). El horizonte es móvil (año en curso y año siguiente, como M7) y lo que importa es el saldo por comprar de cada GML y mes, que baja cuando entra una compra y que muestra el exceso cuando una oportunidad supera lo necesario.
3. **Marcas con tratamiento especial al barrer.** Hay que hacer estadística que llegue a nivel de GML para incorporar esas marcas a los flujos de cada GML. Esto pide un **módulo de análisis** propio (análisis de marcas al barrer por GML).
4. **Marcas mixtas.** Hay marcas que se compran en parte al barrer y en parte con compras específicas de un GML o GMLE. Hoy la modalidad de M2b es excluyente (`por_gml` o `barrido`, y los GML asignados a una marca al barrer quedan ignorados): el diseño debe cubrir el caso mixto.

## Respuestas de Javier (2026-10-15, ronda 1)

5. **Origen de las compras.** Tres fuentes: (a) compras que hace el administrador de producto de las marcas JH, Donatelli y VH **directo del CD intercompany**, (b) una **carga inicial de las compras ya hechas**, (c) un módulo para que el **comprador ingrese sus compras**, por detalle o por carga masiva. Dentro del módulo del comprador hay que poder **crear proveedores** y demás maestros. Javier tiene un módulo en GitHub que servirá de referencia visual (`COTBV2`, entregado el mismo día).
6. **Módulo de intercompany.** Para las líneas de hombre **formales y casuales**, definir qué **porcentaje de la venta viene directo del intercompany por compras regulares y cuánto sale del CD**. Es un módulo propio que alimenta el flujo.
7. **Nivel de una compra.** El comprador registra **GML o GMLE**; puede registrar **marca o agrupación de marcas** según el caso; y marca **tallas centrales, extremas o ambas**.
8. **Marcas mixtas: sí.** Hay compras al barrer que vienen con marcas mixtas (modalidad `mixta` explícita en M2b).
9. **Módulo de análisis de marcas al barrer por GML: antes de M8.**

## Respuestas de Javier (2026-10-15, ronda 2)

10. **% intercompany por GML y marca.** Para JH, Donatelli y VH, dentro de cada GML de hombre formal y casual: porcentaje de la venta que viene directo del intercompany (compras regulares) y cuánto sale del CD.
11. **Cobertura como meses de inventario.** El objetivo se define en **meses de inventario del stock entre CD y tiendas**: **mínimo 4 meses y tope 8**. El flujo señala por debajo del mínimo (falta comprar) y por encima del tope (exceso).
12. **Quién ve y registra en M9.** Los compradores pueden **ver todo y registrar todo**, con filtros para ver solo lo suyo. Las compras **al barrer vienen mixtas** y no siempre viajan a las ferias o proveedores ambos compradores: una compra al barrer puede cubrir marcas o GML de varios compradores, no se asigna a un único comprador.
13. **Carga inicial de compras ya hechas: plantilla Excel nuestra** (proveedor, GML/GMLE, marca o agrupación de marcas, tallas centrales/extremas/ambas, unidades, costo, llegada, destino).

## Respuestas de Javier (2026-10-15, ronda 3; prevalecen sobre lo anterior y sobre el informe del revisor)

14. **Compras al barrer "mixtas" (mezcla de varias marcas).** Hay compras al barrer que vienen como mezcla de marcas; ahí el comprador tendrá que registrar los **porcentajes que espera recibir por marca y por GML** ("no hay otra"). Cuando se compra un lote de **una sola marca**, ahí sí sirve la estadística (el reparto `p2` de M12). Consecuencia: la línea al barrer de M9 tiene **dos modos**: (a) lote de una marca → reparto estadístico de M12 (con alcance opcional por género, mundo o líneas, reparto por temporada de llegada por defecto y el error del reparto visible); (b) lote de varias marcas → tabla de porcentajes marca × GML que ingresa el comprador, validada para sumar 100 %.
15. **Stock del intercompany directo: no se resta.** Javier no quiere restar del stock la parte que llegó directo; "pondría en el flujo una **cobertura esperada intercompany**". Para las marcas con regla de intercompany el flujo usa una **cobertura esperada propia** (parámetro por marca y GML, distinto del 4–8 general) en vez de un cálculo sobre stock neto o sobre demanda neta. Resuelve el bloqueante B2 del revisor: la demanda de esas marcas es completa, su stock es completo y el objetivo es el suyo.
16. **Marcas del módulo de intercompany:** JOHN HOLDEN, JOHN, DONATELLI y VAN HEUSEN. **JH = JOHN HOLDEN + JOHN** (un conjunto de 02b con cabeza JOHN HOLDEN); **no** incluye UNDERWEAR, WOMAN ni DONNA (son marcas aparte y quedan fuera). VAN HEUSEN hoy no tiene tratamiento especial: hay que marcarla antes de cerrar la proyección que lea M8, o resolverlo como propone el revisor (eje `por_marca` en las participaciones de M7). La ficha 13 pide marcarla.
17. **Ámbito del intercompany:** hombre **formal, casual y RI**.

## Respuestas de Javier (2026-10-15, ronda 4; prevalecen sobre todo lo anterior)

### M7 (proyección) — cambios sobre la ficha 07 ya construida en 0.10.0
18. **Rampa de apertura:** sin rampa por defecto, editable (ya así).
19. **Tiendas nuevas:** dos subcolumnas diferenciadas, "nuevas del año anterior" y "aperturas del año" (ya así).
20. **Canibalización:** no hay. Pocas tiendas y bien distribuidas geográficamente. **No incluir cálculos ni alertas automáticas de canibalización** (quitar el aviso de la ficha 07 si existe).
21. **Cola larga (umbral 100 unidades, editable):** antes de cerrar una línea menor al umbral con la propuesta hay que validar que la venta baja no sea falta de stock: días con stock disponible frente a días totales del periodo, venta promedio en los días con disponibilidad, demanda anualizada ajustada por disponibilidad y estacionalidad, y disponibilidad en tiendas y CD. Si la venta anual corregida por disponibilidad sigue bajo el umbral → se cierra automáticamente con la propuesta; si hubo quiebres relevantes → la línea queda **marcada para revisión**.
22. **Venta esperada de una tienda:** es la venta esperada **en soles durante el año de apertura** de la tienda, **sin IGV**; **no** es la venta de una tienda madura ni soles por mes (cambia la fórmula de la ficha 07 §5 y la ayuda del campo en M4).
23. **Inicio de año:** se propone con referencia a la última proyección anual cerrada (ya así).
24. **Participaciones históricas para M8:** se guardan por marca y por talla dentro de la proyección cerrada, **con su periodo de referencia**.

### M8 y M9 (flujo y compras)
25. **Cobertura (IMI, Índice de Meses de Inventario):** se calcula sobre el **stock total de la cadena (tiendas + CD) ÷ venta promedio mensual total**; el detalle tiendas/CD es información complementaria. Se considera el **stock disponible para venta**, excluyendo inventario bloqueado o no utilizable.
26. **IMI entre 4 y 8 meses.** Puede llegar a 8 cuando entra mercadería nueva y debe bajar conforme se vende. El sistema **proyecta el IMI mes a mes** con inventario actual, ventas proyectadas, compras comprometidas, fechas estimadas de ingreso y recepciones parciales, y **alerta cuando el IMI proyectado esté fuera de 4–8**. Se puede confirmar una compra que excede el máximo, con **advertencia visible y justificación registrada**.
27. **Ingresos reales de meses cerrados** (incluida la compra directa del intercompany): se calculan a partir de la **diferencia de inventarios entre meses cerrados**, conciliando la variación del inventario con las ventas y otros movimientos de stock; la lógica debe **evitar duplicaciones** entre compras registradas, mercadería recibida y variaciones de inventario.
28. **Vista y permisos de compradores:** todos los compradores **ven y editan todas las líneas**; cada uno tiene un **filtro "mis líneas"** sin restringir el acceso a las demás. **Cada comprador, el planner o el administrador pueden editar o cancelar cualquier compra** (reemplaza la regla de "solo quien la registró o un planner"). **Trazabilidad completa:** quién creó, modificó o canceló cada registro, con fecha y hora.
29. **IMI por marca:** el rango general es 4–8; JH, Donatelli y Van Heusen usan por ahora ese rango, con parámetros **editables por marca** (reemplaza los rangos propios fijos de la ficha 13 por defecto = 4–8).
30. **Van Heusen:** tratamiento especial **desde ahora**, con reglas parametrizables, antes de la próxima proyección cerrada.
31. **Temporadas y llegadas:** verano octubre–marzo e invierno abril–septiembre, **fechas editables**; la mercadería llega **de forma continua**: una misma compra puede tener **múltiples entregas parciales en distintos meses**; el sistema debe permitir **distribuir las cantidades compradas entre meses de recepción** (según fechas estimadas y estacionalidad del producto); **cada ingreso actualiza el inventario y la proyección de cobertura del mes**. No se asume que toda la compra ingresa junta.
32. **Orden: M9a (compras del comprador) va DESPUÉS de terminar M8.** Primero cerrar y validar el flujo de inventarios y cobertura. (Cambia el orden previsto: M12 → M13 → M8 → M9a → PWA.)
33. **Criterio general:** ninguna recomendación automática reemplaza la decisión del comprador, planner o administrador: el sistema propone, advierte desviaciones y **registra quién tomó la decisión final**. La proyección de inventarios refleja el movimiento real: ingresos continuos, ventas proyectadas y recepciones parciales.

### Hallazgos de datos que condicionan estas respuestas (verificados en la base real, solo lectura)
- El stock cargado en M5 es **mensual** (`venta_stock_vigente.stock_unidades` por periodo × tienda × equivalencia × marca × talla): **no hay días con stock disponible ni un campo de inventario bloqueado**. La regla de la respuesta 21 debe usar un **proxy mensual** (meses con stock > 0 en la tienda y línea, venta promedio de esos meses) y avisar que la disponibilidad diaria requeriría una carga nueva; el stock "disponible para venta" (25) hoy equivale a todo el stock cargado.
- La respuesta 27 es viable a nivel de cadena con stock mensual: ingresos del mes = stock fin − stock inicio + ventas (en unidades, sumando tiendas y CD, donde las transferencias CD→tienda se cancelan); el detalle por tienda mezcla transferencias con compras.

## Respuestas de Javier (2026-10-15, ronda 5: autorizaciones y preguntas abiertas; prevalecen sobre todo lo anterior)

### Autorizaciones permanentes para este ciclo de trabajo
34. **Base de datos Vector2:** aplicar migraciones idempotentes sin pedir permiso; usar `DROP CONSTRAINT` puntual cuando una migración lo exija y no haya vía aditiva (informarlo después; nunca DROP de tablas, columnas ni datos); cargar configuración ya definida; consultas de solo lectura.
35. **Código y despliegue:** commit y push de cada versión cuando pasen lint, tipos, tests, build, QA y seguridad (sin pull request); subir versión sin esperar su OK cuando QA diga APTO y no haya hallazgos importantes abiertos; reemplazar `xlsx` por la versión oficial de SheetJS (bloqueado hoy por la política de red, ver abajo); instalar dependencias nuevas.
36. **Agentes:** lanzar varios en paralelo sin preguntar; saltar el revisor independiente en cambios chicos de UX. **No** se autorizó "usar la recomendación por defecto" en preguntas abiertas: se preguntan.
37. **Alcance autorizado de construcción, de corrido y en el orden recomendado:** M6 06c completo, M7 cambios de la ronda 4 (0.10.1 de la ficha 07), M12 y M13, M8 (flujo e IMI). M9a queda después de que Javier valide M8.

### 06c (M6)
38. Se puede aprobar la curva propia aunque el sistema no tenga ninguna candidata calculable, con nota obligatoria (queda "sin prueba contra años").
39. Un GML "se aparta" cuando su curva se aleja más que `max(umbral, ruido de la agrupación)` y pesa al menos 5 % de la agrupación.
40. Origen `usuario` por la vía **sin DROP** (columna nueva `origen_curva`); no se toca la regla `origen`.
41. **Todo en una entrega:** composición de GML + curva del usuario + modelo F juntos (no se divide en 0.9.8 y 0.9.9).

### M7/M8
42. **IMI** con la venta promedio de los **12 meses siguientes proyectados** (el real de los últimos 12 al lado en el mes actual).
43. **Quiebre de stock:** proxy mensual (tienda-meses con stock al cierre, umbral 0,75 editable) hasta tener carga diaria o inventario bloqueado.
44. **Cola larga "para revisión":** la propuesta del sistema es la **demanda corregida por disponibilidad**; el avance normal V ÷ C_k se muestra como referencia (invierte lo que decía la ficha 07).
45. **Conciliación de ingresos:** las sugerencias de recepción se aceptan con un clic ("Aceptar sugerencia" registra la recepción a nombre del usuario, con trazabilidad); nunca se ejecutan solas.
46. **Compra confirmada:** **todo se puede editar** después de confirmar, con historial completo de quién y cuándo (reemplaza la restricción propuesta de proveedor/GML/marca/tipo).
47. **Lotes al barrer de una sola marca en la carga inicial:** entran ya en M8 (reparto de M12 por entrega); los lotes de varias marcas esperan a M9a.
48. **Numeración de migraciones real:** 0019 (M12) y 0020 (M13) ya aplicadas; siguiente libre 0021 (M7 0.10.1), luego 06c, M8, etc. Las fichas que citen otro número se renumeran al construir.

## Interpretación adoptada por las fichas (12, 13 y 08)

- Una compra de una marca **al barrer** se registra a nivel de marca (no de GML). Si el lote es de **una sola marca**, el sistema reparte sus unidades entre los GML con el **reparto aprobado** de M12 (por temporada de llegada, con alcance opcional y con su error histórico visible); si el lote **mezcla marcas**, el comprador escribe la tabla de porcentajes marca × GML y el sistema solo la valida y la aplica. Ese reparto es lo que M8 suma a los ingresos futuros de cada GML.
- Una marca **mixta** tiene GML (o GMLE) asignados con compras específicas, que entran directo al flujo de ese GML, y el resto de la marca (fuera de esos GML) va al flujo al barrer con el reparto estadístico.
- M7 ya incluye la venta de las marcas al barrer y de las marcas intercompany dentro de la fila GML-AM (ficha 07), de modo que M8 no duplica ni recorta demanda: solo decide cómo se cubre.
- Para JH, DONATELLI y VAN HEUSEN, M8 lleva dentro de la fila GML-AM un **subflujo por marca** con la demanda completa de la marca (su participación en la fila), su stock completo (CD + tiendas, sin restar lo que llegó directo), la **reposición directa esperada** (el % directo de la regla aplicado a la demanda, como ingreso esperado, no como recorte) y su **cobertura esperada** (mínimo y tope propios). El resto de la fila usa el 4–8 general.

## Preguntas abiertas (lista corta, con recomendación; ver sección 16 de la ficha 08)

1. ¿Cuenta **todo** el stock del CD en la cobertura (hoy ~59 % del stock está en el CD y la cobertura global ronda 8,6 meses)? Recomendación: sí, con el CD separado en pantalla.
2. ¿Qué ve cada comprador **por defecto**: "Lo mío" o "Todos"? Recomendación: "Lo mío" si tiene combinaciones; si no, "Todos".
3. **Destinos**: una línea a tienda cuenta como ingreso; una `intercompany_directo` también (el stock es completo); la reposición directa regular se modela como ingreso esperado = % directo × demanda. Recomendación: sí.
4. **Confirmar con exceso**: se confirma con aviso (la oportunidad manda). Recomendación: sí.
5. **Quién cancela y quién edita una compra ajena**: cancelar, quien registró o un planner; editar un borrador ajeno, solo el planner; recibir, cualquiera. Recomendación: así.
