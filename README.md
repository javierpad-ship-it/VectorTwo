# Vector2 · Planificación de producto Lukers

Sistema interno para planificar el producto de Lukers: árbol de clasificación, marcas, tiendas, curvas de estacionalidad, proyección anual de unidades y necesidad de compra. Segunda versión, construida desde cero; Vector-One queda como referencia.

El plan completo, el modelo de datos y la metodología están en [`docs/PLAN.md`](docs/PLAN.md). Las decisiones tomadas y su porqué, en [`docs/DECISIONES.md`](docs/DECISIONES.md). Cada módulo tiene su ficha en `docs/modulos/`.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Supabase (Postgres + Auth). Los datos se leen y escriben solo desde el servidor con la llave `service_role`; la sesión del usuario viaja en cookies con `@supabase/ssr`
- zod para validar la API, vitest para la lógica de negocio; papaparse y SheetJS (xlsx) para leer CSV y Excel en el navegador
- Despliegue en Railway

## Desarrollo local

```bash
npm install
cp .env.local.example .env.local   # completa las tres llaves de Supabase
npm run dev
```

Abre http://localhost:3000. En Windows, doble clic en `INICIAR.cmd` hace lo mismo.

Comandos de verificación (todos deben pasar antes de un commit):

```bash
npm run lint
npm run typecheck
npm test
npm run build
scripts/validar-migraciones-local.sh   # opcional: requiere un Postgres local
```

## Variables de entorno

| Variable | Dónde | Notas |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | servidor y navegador | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | servidor y navegador | Llave pública: `anon` o `sb_publishable_…` |
| `SUPABASE_SERVICE_ROLE_KEY` | solo servidor | Llave secreta: `service_role` o `sb_secret_…`. Nunca al navegador ni a GitHub |

Todas las tablas tienen RLS activo sin políticas: solo el backend entra, y cada route handler valida sesión y rol antes.

## Usuarios y roles

| Rol | Puede |
|---|---|
| `admin` | Todo, incluida la pantalla `/usuarios` |
| `planner` | Maestros y planificación (carga de venta y stock incluida) |
| `comprador` | Solo lectura |

El primer administrador se crea así: en el dashboard de Supabase, Authentication → Users → Add user (con el correo de Javier), y luego se aplica `supabase/migrations/0000_base.sql`, cuyo último bloque le asigna el rol admin. Desde `/usuarios` se crean los demás.

## Base de datos

Migraciones en `supabase/migrations/`, numeradas e idempotentes. Se aplican con el MCP de Supabase desde Claude Code o pegándolas en el SQL Editor del dashboard. Después de cada migración se regeneran los tipos en `src/lib/supabase/database.types.ts`.

`scripts/validar-migraciones-local.sh` crea una base `vector_two_local` en un Postgres local, aplica todas las migraciones dos veces (la segunda pasada prueba que son idempotentes) y lista las tablas con RLS. No toca ningún proyecto Supabase; sirve para validar SQL antes de aplicarlo de verdad.

Proyecto Supabase: **Vector2** (ref `tzjsxzmsvvhxyiooihyq`, región ca-central-1). Las migraciones 0000 a 0007 están aplicadas; la 0008 (mapeo de combinaciones) está escrita e idempotente, con los tipos ya regenerados, y debe confirmarse que esté aplicada en `vector-two` antes del hito de la 05b. La 0009 (ubicaciones ignoradas) se aplicó en `vector-two` el 2026-10-13 y se verificó. Nota operativa: desde Claude Code las sentencias `DROP` quedan esperando una confirmación que no llega; las migraciones se aplican por `execute_sql` sin `DROP` (por eso usan `create or replace trigger`), y cualquier borrado de tabla se hace desde el dashboard.

## Estructura funcional

Lo que existe hoy, por pantalla:

| Pantalla | Quién | Qué hace |
|---|---|---|
| `/login` | público | Correo y contraseña con Supabase Auth |
| `/` | todos | Saludo, rol y estado de los módulos |
| `/usuarios` | admin | Crear usuarios, cambiar rol, desactivar, resetear contraseña, eliminar. Siempre queda al menos un admin activo. La columna "Responsable de" muestra de cuántas combinaciones género-mundo es responsable cada usuario (con enlace a la matriz filtrada); al desactivar, eliminar o quitar el rol de comprador a alguien con combinaciones, el aviso dice cuántas y nunca bloquea |
| `/maestros/arbol` | todos (el comprador solo lee) | Árbol Género → Mundo → Línea → Equivalencia en columnas; buscador global de líneas; interruptor de inactivos; agregar o mover líneas entre mundos; crear, renombrar y desactivar equivalencias; columna Agrupación (de estacionalidad) en cada equivalencia, con un selector que guarda al instante para planner y admin y una etiqueta para el comprador; cada línea muestra cuántas equivalencias le faltan por agrupar y el resumen enlaza a Faltantes; el responsable de cada género-mundo aparece bajo cada mundo y en el subtítulo de Líneas (solo lectura; "Cambiar" lleva a la matriz para admin y planner) |
| `/maestros/arbol` → pestaña Importar | admin y planner | Carga el árbol desde un CSV o un Excel (.xlsx, .xls; se elige la hoja si hay varias): mapeo de columnas, previsualización con conteos y el detalle de lo que no se cargará (filas con errores, separadas de las repetidas, con filtro por motivo y descarga en CSV), aplicar. Reimportar el mismo archivo no duplica nada |
| `/maestros/arbol/catalogos` | admin y planner | Géneros y mundos (edita el admin), líneas con su temporada (edita el planner), agrupaciones de talla (solo lectura) |
| `/maestros/marcas` | admin y planner | Tres pestañas. **Marcas** (edita el planner y el admin): crear marcas con su agrupación obligatoria y, si aplica, tratamiento especial con una nota corta; filtrar por agrupación, por tratamiento o por texto; cambiar la agrupación o la bandera desde la fila; desactivar, reactivar o eliminar. **Agrupaciones** (edita solo el admin; el planner las ve): renombrar, reordenar, desactivar, eliminar si no tienen marcas. **Importar** (planner y admin): carga la lista de marcas desde CSV o Excel con columnas `MARCA`, `AGRUPACION` y, opcional, `TRATAMIENTO_ESPECIAL`; previsualiza lo que se creará, lo que se omitirá y las diferencias con lo ya cargado; reimportar no duplica |
| `/maestros/estacionalidad` | admin y planner (editan los dos) | Cinco pestañas. **Mapa**: cobertura por género y una tarjeta por agrupación con su color, conteos y equivalencias por línea; el mismo color identifica a la agrupación en las tablas y en el árbol. Las listas de agrupaciones van en orden alfabético por nombre. **Agrupaciones**: crear, renombrar, describir, reordenar, desactivar y eliminar (solo sin equivalencias) las agrupaciones de estacionalidad, cada una asignada a uno o más géneros (las que no tienen ninguno se marcan "Sin género" y no aceptan asignaciones); el conteo de equivalencias enlaza a su lista. **Asignación**: la lista plana de equivalencias con su ruta, por árbol (filtros de género, mundo, línea y texto) o por agrupación; se seleccionan varias y se asignan, mueven o quitan en bloque. El filtro de género manda: los selectores solo ofrecen las agrupaciones activas que incluyen ese género. **Faltantes (N)**: las equivalencias activas que todavía no tienen agrupación activa, con filtros por género, motivo y real/genérica, la misma asignación en bloque y un botón para descargar el CSV listo para completar en Excel; cuando queda vacía, el módulo cumplió su hito. **Importar**: sube ese CSV (o un Excel) con la columna `AGRUPACION` completada; crea las agrupaciones nuevas (con los géneros de sus filas), asigna y muestra qué cambia antes de aplicar; reimportar no duplica ni cambia nada |
| `/maestros/tiendas` | admin y planner (editan los dos) | Cuatro pestañas. **Tiendas**: alta de tiendas y centros de distribución con código real (no se deriva del nombre), tipo, zona, razón social, fechas de apertura y cierre y venta esperada (solo para tiendas); mientras escribes las fechas ves el estado que quedará; chips por tipo y estado, filtro de zona y buscador; edición en línea; desactivar (con aviso si la tienda está Activa: cerrar es poner una fecha de cierre, no desactivar), reactivar y eliminar. **Calendario**: próximas aperturas, próximos cierres y tiendas sin fecha de apertura; la línea de tiempo agrupada por mes con separador "Hoy", y "Ver la red al día" para ver los estados a otra fecha. **Importar**: carga la lista de tiendas desde CSV o Excel con columnas `CODIGO` y `NOMBRE` y, opcionales, `TIPO`, `ZONA`, `RAZON_SOCIAL`, `FECHA_APERTURA`, `FECHA_CIERRE` y `VENTA_ESPERADA` (`Tda#` no se mapea); previsualiza lo que se creará, lo que se omitirá, las tiendas que quedarán Planificadas por no traer fecha de apertura y las diferencias con lo ya cargado; reimportar no duplica. **Ubicaciones ignoradas** (`0.8.2`): la lista de nombres de la columna TIENDA del archivo de venta que no son tiendas (la central, las oficinas); se añaden con una nota opcional, se editan (nombre y nota) y se quitan con confirmación. Si existe una tienda con el mismo nombre, la tienda manda y la fila muestra "Sin efecto: existe la tienda ...". El interruptor "Mostrar inactivos" se oculta en esta pestaña y el resumen suma el conteo de ubicaciones; el comprador no entra a ella |
| `/maestros/responsables` | todos (admin y planner editan; el comprador solo lee) | Matriz géneros × mundos (hoy 8 × 5 = 40 combinaciones) con el comprador responsable de cada una. Admin y planner cambian el responsable con un selector por celda que guarda al instante, o asignan en bloque una fila, una columna o toda la matriz (por defecto solo las que faltan; una casilla permite reemplazar también las que ya tienen responsable). El resumen cuenta con responsable y faltantes con su desglose (sin responsable, desactivado, ya no es comprador) y avisa cuando no queda ninguna faltante. Filtros Todas, Faltantes, Mis combinaciones y por responsable; tarjeta "Carga por responsable"; descarga CSV; `?responsable=<id>` abre filtrada por un usuario. El comprador ve todo con el aviso "Vista de solo lectura" y abre en "Mis combinaciones" si tiene alguna |
| `/planificacion/venta-stock` | admin y planner (el comprador no la ve ni entra; toda su API le responde 403) | Carga del histórico mensual de venta neta, costo vendido y stock de fin de mes exportado de QlikView, de 2023-01 a 2026-09. Tres pestañas. **Cargar**: se elige el CSV (UTF-8 con BOM y coma; Excel como secundario), se confirma el mapeo de las 14 columnas, el navegador lo lee por bloques sin subirlo entero y muestra un reporte previo por mes: conciliación contra los totales de QlikView que escribe el usuario (contra el comparable, con las cinco cifras archivo, no comparable, comparable, cargado y QlikView; unidades y stock exactos, soles dentro de 0,1 %), exclusiones agrupadas por valor (errores frente a decisiones informativas), avisos, marcas nuevas y descargas para corregir el árbol o las marcas. Un mes con errores del 2 % o más se salta, o se fuerza y queda marcado Incompleto. Los grupos de error de combinación (género, mundo, línea o equivalencia que ya no existen o cambiaron de nombre) llevan casilla y botón **Asignar**: se eligen uno o varios, se mandan a una equivalencia vigente (con sugerencias de ayuda, que nunca se aplican solas), y **Guardar y recalcular** rehace el reporte sin releer el archivo. Cada tienda desconocida lleva el botón **Ignorar esta ubicación** (para la central y las oficinas, que no son tiendas): la guarda en la lista de ubicaciones ignoradas y rehace el reporte sin releer el archivo, y sus filas pasan a Excluidas por decisión sin contar como error. La carga avanza mes a mes en tandas con reintento. **Cargas por mes**: los 45 meses con sus huecos, el detalle del reporte de cada carga (con las filas reasignadas por mapeo), Retirar, Abandonar, Verificar totales y Limpiar ahora. **Mapeos**: los mapeos guardados, con su estado (Vigente, Inactivo, Obsoleto si el origen ya existe en el árbol, Destino desactivado), búsqueda, cambiar destino, editar la nota, desactivar y reactivar, eliminar, crear uno a mano, descargar CSV e importar el mismo archivo (nunca cambia un mapeo existente; reimportar no duplica) |

Reglas de responsables que conviene saber: cada combinación género × mundo tiene a lo sumo un responsable (titular), que debe ser un comprador activo; el responsable sirve para filtrar y no limita permisos (los compradores ven todo); la tabla guarda solo lo asignado y la matriz de 40 combinaciones se arma con el producto cartesiano de géneros y mundos activos, así que una combinación sin líneas también necesita responsable; "faltante" es una combinación vigente sin responsable válido (sin fila, responsable desactivado o que ya no es comprador); desactivar a un comprador o cambiarle el rol conserva sus asignaciones y las marca como faltantes hasta reasignar o revertir, mientras que eliminarlo las deja sin asignar; eliminar un género o mundo que tenga responsables se rechaza. No hay importador: se reparte con la asignación en bloque. Sigue sin responder Javier a las preguntas abiertas de la ficha (suplente, admin o planner como responsables, combinaciones sin líneas, qué ve el comprador al entrar, filtro dentro del árbol, qué pasa al cambiar de rol, nombre del menú) y rigen sus valores por defecto. Limitaciones conocidas: sin transacción ni control de concurrencia en la asignación en bloque, y varias rutas sin probar contra Supabase real. El detalle está en `docs/modulos/01b-responsables.md`.

Reglas de venta y stock que conviene saber: una carga es un mes completo que reemplaza ese mes, y se publica de una vez cuando la base comprueba que las filas recibidas coinciden con lo enviado, así que un corte a medias deja el mes anterior intacto y nunca un mes parcial a la vista; solo hay una carga publicada por mes y reimportar el mismo mes no duplica nada; la marca se guarda al detalle y su nivel se lee de `marcas`, así que mover una marca de nivel no obliga a recargar; las marcas que no existan se crean solas en la agrupación elegida (VARIOS, OTROS y SIN MARCA siempre en MID VALUE), por lo que conviene cargar antes la lista de marcas con el importador de `/maestros/marcas`; las ubicaciones del archivo que no son tiendas (la central, las oficinas) no se crean como tiendas: van en la lista de ubicaciones ignoradas de `/maestros/tiendas` (ver abajo); el importador nunca crea árbol, descarga las combinaciones desconocidas en el formato del importador del árbol; el histórico se lee solo por la vista `venta_stock_vigente`, y eliminar una marca, tienda o equivalencia con venta o stock cargados responde 409. Orden de carga: marcas, tiendas, combinaciones nuevas del árbol, septiembre de 2026 como piloto y el resto del histórico, un archivo por año. Limitaciones conocidas: no se ha probado contra Supabase real y el piloto medirá los tiempos; los handlers no tienen pruebas de integración. El detalle está en `docs/modulos/05-venta-stock.md`.

Reglas de mapeo de combinaciones que conviene saber (`0.8.1 · M5`): un mapeo manda un origen exacto del archivo (género, mundo, línea y equivalencia) a una equivalencia vigente, y solo se consulta cuando el árbol no resuelve esa combinación (el árbol manda; si el origen se crea después en el árbol, el mapeo queda Obsoleto y no se aplica); nunca se encadena, y un destino desactivado no se aplica (la fila vuelve a su error y el reporte avisa en rojo). El único comodín es `*` en la equivalencia, "cualquier equivalencia de esa terna que no resuelva", y no existe en género, mundo ni línea. Las filas con uno o dos de género, mundo y línea en blanco se pueden mapear; las que tienen los tres en blanco siguen excluidas. Las filas reasignadas se cargan con la equivalencia destino, sin marca en la fila: la auditoría va en el reporte de la carga (`reasignadas` y el detalle `ORIGEN → DESTINO`). **Cambiar o borrar un mapeo no toca los meses ya publicados**: para que un mes lo refleje hay que recargarlo. Toda la API de mapeos es de admin y planner. Limitaciones conocidas: no se probó contra Supabase real ni en navegador con los tres roles, y el navegador conserva el archivo ya leído (25 a 42 MB por año) mientras la previsualización esté vigente para poder recalcular. El detalle está en `docs/modulos/05b-mapeo-combinaciones.md`.

Reglas de ubicaciones ignoradas y conciliación que conviene saber (`0.8.2 · M5`): una ubicación ignorada es un nombre de la columna TIENDA del archivo que no es una tienda; sus filas se excluyen por decisión (motivo "Ubicación ignorada (no es tienda)"), no pesan en el 2 % de errores y no crean tiendas. El resolutor busca tienda por nombre, tienda por código, ubicación ignorada y por último desconocida: **la tienda manda**, así que crear después una tienda con ese nombre deja la fila de la lista "sin efecto". Quitar una ubicación no cambia lo ya cargado; vuelve a salir como tienda desconocida en la próxima lectura. Toda la API de ubicaciones es de admin y planner. La conciliación contra QlikView compara con el **comparable** = archivo menos las filas sin género, mundo ni línea y las filas de totales (lo que la tabla de QlikView no muestra), y la pantalla muestra siempre las cinco cifras para ver de dónde sale cada diferencia; las ubicaciones ignoradas y los géneros, mundos o líneas desconocidos no se restan. Las cargas hechas con `0.8.0` se leen sin migrarlas, con una nota de que concilian contra el archivo completo. La tolerancia de unidades hoy es cero (exactas) y es una decisión pendiente de Javier. Limitaciones conocidas: no se probó en navegador con los tres roles ni contra la base real, y la verificación del SQL se hizo a mano en local. El detalle está en `docs/modulos/05c-ubicaciones-conciliacion.md`.

Reglas de tiendas que conviene saber: el estado (Planificada, Activa o Cerrada) no se guarda, se calcula con las fechas y el día de hoy en Lima, así que una tienda pasa de Planificada a Activa sola al llegar su fecha de apertura; apertura = hoy ya es Activa y cierre = hoy sigue Activa (el cierre es el último día con venta); una tienda sin fecha de apertura queda Planificada y un cierre exige apertura; una tienda cerrada sigue activa en el maestro (desactivar es otra cosa y la oculta); el código y el nombre son únicos; el centro de distribución no lleva venta esperada; no hay semilla de tiendas, las carga Javier por pantalla o por el importador, que nunca modifica una tienda existente (solo informa las diferencias). Limitaciones conocidas: el error de un Guardar fallido en la edición en línea sale arriba de la tabla, y el día que usa el navegador no se refresca pasada la medianoche con la pantalla abierta (recargar lo corrige). El detalle está en `docs/modulos/04-tiendas.md`.

Reglas de estacionalidad que conviene saber: cada equivalencia tiene a lo sumo una agrupación, que debe incluir el género de la equivalencia (cada agrupación pertenece a uno o más géneros; una sin género no recibe equivalencias, y no se le puede quitar un género del que ya tenga equivalencias); una equivalencia activa sin agrupación activa es "faltante" (no podrá proyectarse en la Fase 2); las genéricas `SIN EQUIVALENCIA` también necesitan agrupación; desactivar una agrupación no toca sus equivalencias (quedan como faltantes hasta reactivarla o moverlas); no hay agrupaciones de fábrica, las crea el planner; el importador crea agrupaciones y asigna, pero nunca crea líneas ni equivalencias, ni quita una agrupación, ni amplía los géneros de una agrupación existente (una nueva nace con los géneros de sus filas). Las curvas en sí se calculan en M6 sobre la venta real. El detalle está en `docs/modulos/03-agrupaciones-estacionalidad.md`.

Reglas de marcas que conviene saber: cada marca pertenece a una sola agrupación (no hay comodín "sin agrupar"); el nombre es único en todo el maestro; la nota de tratamiento solo existe con la bandera encendida y se borra al apagarla; desactivar una agrupación oculta sus marcas sin perderlas; el importador nunca crea agrupaciones ni modifica marcas existentes (solo informa las diferencias). El detalle está en `docs/modulos/02-marcas.md`.

Reglas del árbol que conviene saber: los mundos existen en todos los géneros; una línea es catálogo y se activa por nodo género-mundo; la equivalencia cuelga del nodo; las filas con equivalencia `-` crean una equivalencia con el nombre de la línea y las filas con equivalencia vacía caen en una genérica `SIN EQUIVALENCIA` por nodo; toda línea tiene mundo, así que las filas de un CSV con el mundo vacío no se cargan y se listan en la previsualización para corregir el archivo; la acción normal es desactivar, y eliminar solo se permite sin hijos. El detalle está en `docs/modulos/01-arbol-producto.md`.

## Desplegar en Railway

`railway.json` define build (`npm run build`), start (`npm run start`) y healthcheck en `/login`. Al crear el servicio, conectarlo al repo y cargar las tres variables de entorno con los mismos valores de `.env.local`. La versión que corre se ve al pie del menú (`APP_VERSION`), útil para confirmar que el deploy tomó el último commit.

## Estructura

```
.claude/agents/      arquitecto · datos · backend · frontend · qa · documentador
docs/                PLAN, DECISIONES, CHANGELOG, modulos/
scripts/             validar-migraciones-local.sh
supabase/migrations/ SQL versionado (0000 base, 0001 árbol de producto, 0002 agrupaciones de marca y marcas, 0003 agrupaciones de estacionalidad, 0004 tiendas, 0005 géneros de las agrupaciones de estacionalidad, 0006 responsables género-mundo, 0007 venta y stock: cargas, hechos mensuales, vista vigente y funciones de publicación, 0008 mapeo de combinaciones históricas, 0009 ubicaciones ignoradas)
src/app/login        inicio de sesión
src/app/(app)        todo lo que requiere sesión (layout con menú por rol)
src/app/(app)/maestros/arbol   árbol, importador CSV y catálogos
src/app/(app)/maestros/marcas  marcas, agrupaciones de marca e importador de marcas
src/app/(app)/maestros/estacionalidad  agrupaciones de estacionalidad, asignación, faltantes e importador
src/app/(app)/maestros/tiendas  tiendas, calendario de aperturas y cierres, importador de tiendas y ubicaciones ignoradas
src/app/(app)/maestros/responsables  matriz de responsables género-mundo, asignación en bloque y carga por responsable
src/app/(app)/planificacion/venta-stock  carga de venta, costo y stock: pestañas Cargar, Cargas por mes y Mapeos, reporte previo, modal Asignar destino y avance
src/app/api          route handlers (auth, usuarios, generos, mundos, lineas, agrupaciones-talla, arbol, equivalencias, agrupaciones-marca, marcas, marcas/importar, agrupaciones-estacionalidad, estacionalidad/asignar, estacionalidad/equivalencias, estacionalidad/faltantes, estacionalidad/importar, tiendas, tiendas/aperturas, tiendas/importar, tiendas/ubicaciones-ignoradas, tiendas/ubicaciones-ignoradas/[id], responsables, responsables/asignar, ventas/previsualizar, ventas/marcas-nuevas, ventas/cargas, ventas/cargas/[id], ventas/cargas/[id]/filas, ventas/cargas/[id]/publicar, ventas/cargas/limpiar, ventas/mapeos, ventas/mapeos/[id], ventas/mapeos/sugerir, ventas/mapeos/importar)
src/lib/auth         roles y guards
src/lib/supabase     clientes admin / server / browser y tipos
src/lib/api          respuestas, validación, CRUD de catálogos (con conteo de hijos) y traducción de errores de base
src/lib/arbol        lógica pura del árbol: normalizar, importar, armar-arbol, reglas, esquemas zod
src/lib/marcas       lógica pura de marcas: seed, esquemas zod, reglas, importador, consultas
src/lib/estacionalidad  lógica pura de estacionalidad: tipos, esquemas zod, reglas (faltante, asignación, géneros de la agrupación), agrupaciones (handlers del catálogo con géneros), generos (destinos y orden alfabético para la pantalla), aplanar, importador, catálogo, consultas, pestañas
src/lib/tiendas      lógica pura de tiendas: tipos, esquemas zod, reglas, estado (calculado con la fecha de Lima), fechas y montos del importador, aperturas, importador, consultas, ubicaciones (índice para el resolutor de ventas, "sin efecto" y rechazo al crear)
src/lib/responsables  lógica pura de responsables: tipos, esquemas zod, reglas (rechazos, plan de asignación, avisos de `/usuarios`), matriz (faltante y resumen), filtros, csv, consultas, pantalla (textos y plan del bloque) y el hook `use-responsables`
src/lib/ventas       lógica pura de la carga de venta y stock (periodo, números, talla, interpretar, acumulador columnar, resolver, informe, conciliación contra el comparable, estado y tandas de las cargas, lectura por bloques; mapeos de combinación: mapeos, origen-mapeo, sugerir-mapeo y recalcular, que también recalcula al ignorar una ubicación) y consultas (único archivo que nombra la tabla de hechos)
src/lib/formato.ts   formato de números para la interfaz
src/components/ui    kit de interfaz (incluye la casilla de selección múltiple y el selector múltiple de chips)
src/components/catalogo    catálogo plano reutilizable (géneros, mundos, agrupaciones de marca y de estacionalidad) y vista previa del nombre
src/components/estacionalidad  badge de agrupación compartido por el árbol y la lista plana
src/components/importador  piezas del importador de archivos (tipos, mapeo, hook, pasos, reporte, descarga CSV) que usan el árbol, las marcas y la estacionalidad
tests/               vitest (971 pruebas en 66 archivos)
datos/               archivos fuente del negocio (ignorados por git)
```

## Estado

| Módulo | Estado |
|---|---|
| M0 Cimientos | Hecho. Desplegado en Railway y validado por Javier (2026-10-05) |
| M1 Árbol de producto | Hecho. Árbol real importado en producción y validado por Javier (2026-10-05) |
| M2 Marcas | Hecho (`0.3.0 · M2`, 2026-10-05). Pendiente de que Javier recorra el hito y cargue la lista real de marcas |
| M3 Agrupaciones de estacionalidad | Hecho (`0.4.0 · M3`, 2026-10-06; géneros por agrupación en `0.6.0 · M3`). Pendiente de que Javier recorra el hito con el árbol real, ponga género a las dos agrupaciones que quedaron sin él y cierre la clasificación hasta que Faltantes quede vacía |
| M4 Tiendas y aperturas | Hecho (`0.5.0 · M4`, 2026-10-06). Pendiente de que Javier recorra el hito y cargue la lista real de tiendas |
| M1b Responsables género-mundo | Hecho (`0.7.0 · M1b`, 2026-10-07). Pendiente de validar: crear los compradores en `/usuarios`, repartir las 40 combinaciones hasta que no quede ninguna faltante y responder las preguntas abiertas de la ficha |
| M5 Carga de venta, costo y stock | Hecho (`0.8.0 · M5`, 2026-10-11; mapeo de combinaciones históricas en `0.8.1 · M5`, 2026-10-12; ubicaciones ignoradas y conciliación contra el comparable en `0.8.2 · M5`, 2026-10-13, la versión vigente). Pendiente de que Javier recorra el hito: cargar antes las marcas, las tiendas y las combinaciones nuevas del árbol, y luego septiembre de 2026 como piloto; para la mejora 05b cargar un mes con combinaciones históricas y asignarlas desde el reporte; y para la 05c ignorar la central desde el reporte, ver la conciliación con las cinco cifras y decidir la tolerancia de unidades; nada se ha probado aún en navegador con los tres roles ni contra la base real |

## Marca

Los logos de Vector Two están en `public/marca/` (`isotipo.png` con fondo transparente, `logo-horizontal.png`, `logo-vertical.png`), optimizados a partir de los originales que Javier subió a la rama `main`. El favicon y los iconos de la app (`src/app/favicon.ico`, `icon.png`, `apple-icon.png`) se generan del isotipo.
