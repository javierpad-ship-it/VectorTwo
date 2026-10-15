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
