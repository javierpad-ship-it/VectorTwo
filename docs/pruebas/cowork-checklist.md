# Checklist de prueba en navegador para Cowork (Vector2)

Objetivo: recorrer las pantallas nuevas con un navegador real, que es lo único que no han podido hacer ni los tests ni QA. Cowork **observa y reporta**; no decide ni cambia datos salvo donde el paso lo diga.

## Reglas para Cowork (leer antes de empezar)

1. Usa **solo** los usuarios de prueba que Javier cree (un `planner` y un `comprador`). No uses el usuario admin. **Nunca pegues claves en el chat ni en capturas.**
2. La base es la de producción (no hay otra). No pulses **Retirar**, **Aprobar esta curva**, **Desactivar** ni **Eliminar** en ningún sitio, salvo en un paso ✍️ que Javier haya autorizado. No edites maestros, tiendas, marcas ni agrupaciones fuera de lo que diga un paso ✍️.
3. Los únicos pasos que escriben datos son los marcados con ✍️ (crear periodos atípicos, aprobar curvas, y en dos pasos tocar un maestro y revertirlo). Antes de cada ✍️, pide confirmación a Javier y espera su "sí" **en ese paso**; una autorización general no vale. Si Javier no lo autoriza, salta el paso, anótalo como "no ejecutado" y sigue.
4. En cada paso: captura de pantalla, qué esperabas, qué viste, y si hubo errores en la consola del navegador. Si algo se ve lento (más de 3 s), anótalo con el tiempo.
5. Anota la versión que aparece al pie del menú: debe ser **0.9.7 · M6** (la que Javier diga). Si es otra, detente y avisa.
6. Los números de este documento van con punto decimal (0.66), como los muestra la pantalla; si ves una coma como separador decimal en algún texto de la pantalla, anótalo como hallazgo.

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

## D. Curvas de estacionalidad, trabajo por agrupación (`/planificacion/curvas-estacionalidad`) — solo después del despliegue 0.9.7 · M6

Contexto: desde la 0.9.7 se trabaja **una agrupación a la vez**. Ya no existe el botón Calcular global, ni corridas, ni "Marcar como referencia", ni aprobación en bloque: si ves alguno de ellos, es un hallazgo bloqueante. Una agrupación se abre desde la lista (botón **Trabajar**) y queda en la URL como `?agrupacion=<id>`.

Prerrequisitos de Javier (antes de empezar): faltantes de M3 en cero, fechas de apertura y cierre en M4, las 10 agrupaciones de toda temporada revisadas. Los cuatro periodos del Niño **no** deben estar creados todavía: se crean en el paso 4.

Con el usuario **planner**, salvo el paso 1 (comprador). Los pasos con ✍️ escriben datos y exigen la autorización de Javier en ese momento.

1. **Roles.** Con el **comprador**: no ve "Curvas de estacionalidad" en el menú; abrir a mano `/planificacion/curvas-estacionalidad` redirige a Inicio; abrir a mano en el navegador las rutas GET de la API (`/api/curvas`, `/api/curvas/vigentes`) responde 403. No envíes POST ni PUT desde la consola: eso lo cubren los tests.
2. **Lista sin periodos** (antes del paso 4). La pestaña **Agrupaciones** abre primero. Arriba, el aviso "No hay periodos atípicos para invierno (4) ni verano (1)". Las 5 filas de invierno y verano dicen "Bloqueada: sin periodos"; las 10 de toda temporada, "Sin curva". No hay tarjeta Calcular, selector de corridas ni botón de referencia. Las pestañas son Agrupaciones, Años Niño y Periodos atípicos.
3. **Abrir una de invierno sin periodos** (botón Trabajar). Aparece la tarjeta "No se puede calcular todavía" con el enlace a Periodos atípicos y la casilla "Confirmo que esta temporada no tiene años atípicos"; no hay gráfico. Marcar la casilla calcula y 2023 sale "normal" con su aviso; **desmárcala después y no aprobes**.
4. ✍️ **Crear los cuatro periodos atípicos** con los atajos de Periodos atípicos: Niño 2023 invierno 2023-01 a 2023-12; Niño 2023 verano 2023-09 a 2023-12; Niño 2026 invierno 2026-01 a 2026-12; Niño 2026 verano 2026-09 a 2026-12 ("Año completo", "Desde setiembre", "En curso"). Volver a la lista: las 5 filas pasan a "Sin curva".
5. **Abrir una de toda temporada** (cifras agregadas, sin nombres). La vista aparece en **menos de 3 s**: anota `duracion_ms` de la cabecera y el tiempo percibido. Se ven 2023, 2024 y 2025 continuas, 2026 discontinua hasta setiembre, la propuesta del sistema en trazo grueso y la banda mín–máx. **No hay curva aprobada** (no hay fila "Aprobada"). La tabla año × mes suma 100 % por año. La frase de recomendación se lee entera. Cambiar la candidata dibujada (radio) cambia la propuesta sin esperar al servidor. Aparece el aviso "Sigue en Toda temporada: confirma la temporada".
6. **Abrir una de invierno.** Red por año 8 · 9 · 9 · 10 tiendas; 2023 "Niño completo" con su tratamiento y las tres cifras del veredicto de forma; 2026 parcial con las dos formas; volumen de 2023 y 2026 sobre tiendas comunes; la tienda que abrió en noviembre de 2025 con su peso en 2026 y, si aplica, "Distinta".
7. **Parámetros de la agrupación.** Excluir esa tienda nueva de la red recalcula en **menos de 1 s**; la red de 2026 baja a 9 y la curva parcial de 2026 cambia; "Restablecer" vuelve al valor por defecto. Excluir 2023 del ajuste: las candidatas cambian, 2023 queda **visible en gris** (no desaparece del gráfico ni de la tabla), cada candidata dice "2 pruebas" y, si hay curva aprobada, aparece "EAT no comparable". El chip cuenta los parámetros distintos del valor por defecto. Intentar aprobar con la tienda excluida y sin nota da "nota requerida" (**no aprobar**: si el botón deja pulsar, el mensaje debe salir igual; anota qué viste). El panel no muestra umbrales editables.
8. ✍️ **Aprobar la recomendada** en **una** agrupación de toda temporada, solo si Javier lo autoriza en este paso. El `confirm` resume agrupación, temporada, candidata, años usados, EAT frente al ruido y avisos. Resultado esperado: "Curva A aprobada como versión 1"; la vista muestra la fila "Aprobada v1" igual a la propuesta (diferencia 0.0) y la lista dice "Al día · v1".
9. ✍️ **Aprobar otra candidata** en esa misma agrupación, solo con autorización de Javier. Sin nota: mensaje "nota requerida". Con nota: versión 2, la lista dice "Al día" distinta de la recomendada (A). En **Versiones**, la v1 figura "reemplazada" y su **Ver foto** abre el detalle congelado comparado con la curva de esa misma versión (diferencia 0.0), sin aviso de obsolescencia.
9b. ✍️ **Dos pestañas.** Con la misma agrupación abierta en dos pestañas, aprobar en una y después en la otra (solo con autorización de Javier): la segunda debe mostrar un mensaje legible de que otra persona cambió la curva ("vigente cambiada") y ofrecer volver a cargar.
9c. ✍️ **"Calcular hasta" no se hereda.** Aprobar con "Calcular hasta" un mes antes del defecto (solo con autorización de Javier); reabrir la agrupación: el selector vuelve al defecto y la cabecera dice "la vigente usó datos hasta …"; la lista no la marca obsoleta por el mes siguiente, sino "datos posteriores".
10. ✍️ **Datos cambiados.** Con una agrupación abierta, pedir a Javier (o hacer con su autorización) un cambio reversible en otra pestaña: la temporada de esa agrupación o una fecha de tienda en M4; revertirlo al terminar. De vuelta en la primera pestaña, Aprobar debe dar un mensaje legible de "los datos cambiaron" y ofrecer volver a calcular (**el mensaje es lo que se prueba; no insistas en aprobar**). La lista marca la agrupación **Obsoleta** con el motivo. **Comparar con el sistema** (botón de la fila) llena la columna "Sistema hoy" sin crear nada; Javier confirma con SQL que el conteo de `corridas_estacionalidad` no cambió.
11. ✍️ **Las 15 una por una.** Lo hace **Javier**, no Cowork: recorre cada agrupación, revisa, ajusta y aprueba. Cowork solo observa si Javier lo pide. Al final Javier comprueba con SQL: 15 curvas vigentes y tantas fotos como aprobaciones; "Sin curva" = 0; no hay aprobación en bloque en ningún sitio.
12. **Años Niño** (a demanda). Los ratios de volumen sobre tiendas comunes son: 2026 enero a setiembre, invierno ≈ 0.66, verano ≈ 1.24, toda temporada ≈ 0.975; 2023, invierno ≈ 0.63, verano ≈ 0.73, toda temporada ≈ 0.95. Cada uno con su ratio de control y el relativo. "Lo que recibirá M7" lista el factor por temporada con "N agrupaciones" junto a cada uno y descarga CSV sin error. La cabecera dice que se calculó ahora con los parámetros por defecto.
12a. ✍️ **Curva prestada** (solo si alguna agrupación tiene aprobada la candidata T). Mover una equivalencia entre dos agrupaciones de su temporada en M3 y volver (solo con autorización de Javier; revertir al terminar): la prestada pasa a "Obsoleta: cambió la composición de …"; una curva propia de la misma temporada solo muestra un aviso; revertir limpia ambas.
12b. **Hallazgos de QA de la 0.9.6.** En una de invierno con 2023 descartado (forzar el tratamiento "descartar" en el panel, sin aprobar), 2023 sigue visible en gris en el gráfico y en la tabla. En una de toda temporada, el ruido entre años normales aparece junto al EAT (en la tabla de candidatas, en la lista y en el `confirm`). Tras aprobar con datos hasta setiembre de 2026, la lista no marca Obsoleta por un mes posterior no cerrado, sino "datos posteriores". Recargar el navegador con `?agrupacion=<id>` reabre la misma vista, y "← Agrupaciones" quita el parámetro. Todas las cifras se leen con **punto decimal** (27.4), en la pantalla y en las frases de recomendación.
13. **Contrato con M7.** Abrir `/api/curvas/vigentes` en el navegador (con el planner): 15 filas, cada una con `curva` (suma 1), `acumulada`, `version`, `curva_id` y huellas. El enlace "Descargar curvas vigentes (CSV)" abre en Excel sin error.
14. **Validación de negocio** (Javier). En cinco agrupaciones conocidas, la curva aprobada se parece a la del Excel de planeamiento; donde difiere, la tabla año × mes, la red comparable y los parámetros explican por qué; se anota qué parámetro la acerca y que toda curva aprobada distinta de la recomendada tiene su nota. Cowork no decide aquí: solo recoge lo que Javier dicte.

Además, en cada paso de D: la **versión del pie del menú es 0.9.7 · M6**, la tarjeta de M6 en Inicio dice "En validación" y no hay errores en la consola del navegador.

## E. Informe

Entrega: lista de pasos con ✔ / ✘, capturas de cada ✘, tiempos lentos y errores de consola. Marca como **bloqueante** cualquier cosa que impida usar la pantalla o muestre cifras distintas de las esperadas.
