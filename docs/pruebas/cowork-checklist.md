# Checklist de prueba en navegador para Cowork (Vector2)

Objetivo: recorrer las pantallas nuevas con un navegador real, que es lo único que no han podido hacer ni los tests ni QA. Cowork **observa y reporta**; no decide ni cambia datos salvo donde el paso lo diga.

## Reglas para Cowork (leer antes de empezar)

1. Usa **solo** los usuarios de prueba que Javier cree (un `planner` y un `comprador`). No uses el usuario admin. **Nunca pegues claves en el chat ni en capturas.**
2. La base es la de producción (no hay otra). No pulses **Retirar**, **Aprobar esta curva**, **Marcar como referencia**, **Desactivar** ni **Eliminar** en ningún sitio. No edites maestros, tiendas, marcas ni agrupaciones.
3. Los únicos pasos que escriben datos son los marcados con ✍️ (crear periodos atípicos y lanzar un cálculo). Antes de cada ✍️, pide confirmación a Javier.
4. En cada paso: captura de pantalla, qué esperabas, qué viste, y si hubo errores en la consola del navegador. Si algo se ve lento (más de 3 s), anótalo con el tiempo.
5. Anota la versión que aparece al pie del menú (debe coincidir con la que Javier diga).

## A. Roles y seguridad (comprador)

Con el usuario **comprador**:
- No aparecen en el menú: Reporte agrupación GMLE, Agrupaciones de estacionalidad, Curvas de estacionalidad, Carga de venta y stock, Usuarios.
- Abrir a mano `/maestros/agrupacion-gmle`, `/planificacion/curvas-estacionalidad` y `/usuarios` redirige a Inicio.
- En Tiendas, la columna de venta esperada aparece vacía (no debe verse ninguna cifra).

## B. Reporte agrupación GMLE (`/maestros/agrupacion-gmle`, usuario planner)

- Resumen sin filtros: 15 agrupaciones activas; **2 336 equivalencias**; 403 genéricas; ninguna equivalencia sin agrupación.
- Histograma "Unidades vendidas por mes y año": total **1 983 921** unidades; 4 años (2023 a 2026); 2026 solo hasta setiembre y octubre a diciembre de 2026 **vacíos** (no en cero). Tabla mes × año con totales y variación.
- Filtrar por una agrupación (por ejemplo la de invierno de hombre): el histograma y la tabla cambian; escribir en el buscador no se traba.
- Detalle: se ven 200 filas con "Mostrar más"; descargar CSV y Excel: abren sin error y traen todas las filas filtradas.
- Anomalías: bloques visibles; con datos de hoy no deben aparecer equivalencias sin agrupación.

## C. Marcas relevantes por GML (`/maestros/marcas`, usuario planner)

- En la vista "Por marca", en **Agregar GML** aparece "Marcas que recibirán estos GML": agregar una segunda marca con el selector, quitarla con la ×, y el botón dice "…para las 2 marcas". **No pulses el botón de asignar.**

## D. Curvas de estacionalidad, paso 2 (`/planificacion/curvas-estacionalidad`) — solo después del despliegue 0.9.6

Con el usuario **planner**:
1. Aparecen tres pestañas: Curvas, Años Niño, Periodos atípicos. Curvas vacía: "Calcula para ver propuestas".
2. Aviso de que 10 agrupaciones siguen en "Toda temporada" (Javier las revisa antes de calcular).
3. ✍️ **Periodos atípicos**: crear los cuatro prellenados (Niño 2023 invierno 2023-01 a 2023-12; Niño 2023 verano 2023-09 a 2023-12; Niño 2026 invierno 2026-01 a 2026-12; Niño 2026 verano 2026-09 a 2026-12). Probar los atajos "Año completo", "Desde setiembre" y "En curso".
4. Curvas → panel "Red comparable por año": 8 tiendas en 2023, 9 en 2024 y 2025, 10 en 2026; el CD no entra; tienda dominante solo marcada en 2025; la tienda que abrió en noviembre de 2025 entra solo en 2026.
5. ✍️ **Calcular** (una sola vez): dura menos de 10 s; se crea una corrida; no debe dar error 409/500. Segunda pulsación inmediata: debe avisar que hay un cálculo en curso o resolverse sin duplicar.
6. Abrir el detalle de 2 o 3 agrupaciones: gráfico con todos los años superpuestos (2023 y 2026 atípicos con otro trazo), banda mín–máx, tabla año × mes (cada año suma 100 %), candidatas con EAT, comparador vigente/propuesta, red por tienda. **No aprobar.**
7. Años Niño: ratios de volumen sobre tiendas comunes (invierno 2026 ≈ 0,66; verano 2026 ≈ 1,24; verano 2023 ≈ 0,73) con el ratio de control y el relativo; "Lo que recibirá M7" con "N agrupaciones" junto a cada factor.
8. La tabla de Curvas no tiene casillas de selección múltiple ni botón de aprobar en bloque.

## E. Informe

Entrega: lista de pasos con ✔ / ✘, capturas de cada ✘, tiempos lentos y errores de consola. Marca como **bloqueante** cualquier cosa que impida usar la pantalla o muestre cifras distintas de las esperadas.
