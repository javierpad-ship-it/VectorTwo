# M8 + M9 · Definiciones del dueño (borrador de entrada para la ficha conjunta)

Estado: **en definición con Javier**. Este archivo recoge lo que ya dijo para que el arquitecto lo use al escribir la ficha conjunta de M8 (flujo y necesidad de compra) y M9 (compras de los compradores). No es una especificación.

## Decidido por Javier

1. **M8 y M9 se definen juntos.** M8 necesita los ingresos futuros y esos los registran los compradores en M9. El ciclo es: M7 da la venta mensual proyectada por GML-AM → M8 la compara con stock y con lo que viene en camino y deja el hueco por comprar → el comprador registra compras en M9 → M8 se recalcula.
2. **No se compra por temporada, se compra por oportunidad.** No hay OTB por temporada (VER/INV). El horizonte es móvil (año en curso y año siguiente, como M7) y lo que importa es el saldo por comprar de cada GML y mes, que baja cuando entra una compra y que muestra el exceso cuando una oportunidad supera lo necesario.
3. **Marcas con tratamiento especial al barrer.** Hay que hacer estadística que llegue a nivel de GML para incorporar esas marcas a los flujos de cada GML. Esto pide un **módulo de análisis** propio (análisis de marcas al barrer por GML).
4. **Marcas mixtas.** Hay marcas que se compran en parte al barrer y en parte con compras específicas de un GML o GMLE. Hoy la modalidad de M2b es excluyente (`por_gml` o `barrido`, y los GML asignados a una marca al barrer quedan ignorados): el diseño debe cubrir el caso mixto.

## Interpretación propuesta (a confirmar con Javier)

- Una compra de una marca **al barrer** se registra a nivel de marca (no de GML). Para que cuente contra el hueco de cada GML, el sistema reparte sus unidades entre los GML con la **participación histórica** de esa marca en cada GML (por mes), y ese reparto es lo que M8 suma a los ingresos futuros del flujo de cada GML. El módulo de análisis muestra y valida esa estadística.
- Una marca **mixta** tiene GML (o GMLE) asignados con compras específicas, que entran directo al flujo de ese GML, y el resto de la marca (fuera de esos GML) va al flujo al barrer con el reparto estadístico.
- M7 ya incluye la venta de las marcas al barrer dentro de la fila GML-AM (ficha 07), de modo que M8 no duplica demanda: solo decide cómo se cubre.

## Preguntas abiertas

Ver el hilo con Javier; las cinco preguntas de M8+M9 (origen de las compras, nivel de una compra, datos de cada compra, cobertura, quién ve qué) siguen sin respuesta, y se suman las del módulo de análisis y la modalidad mixta.
