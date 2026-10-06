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
| `planner` | Maestros y planificación |
| `comprador` | Solo lectura |

El primer administrador se crea así: en el dashboard de Supabase, Authentication → Users → Add user (con el correo de Javier), y luego se aplica `supabase/migrations/0000_base.sql`, cuyo último bloque le asigna el rol admin. Desde `/usuarios` se crean los demás.

## Base de datos

Migraciones en `supabase/migrations/`, numeradas e idempotentes. Se aplican con el MCP de Supabase desde Claude Code o pegándolas en el SQL Editor del dashboard. Después de cada migración se regeneran los tipos en `src/lib/supabase/database.types.ts`.

`scripts/validar-migraciones-local.sh` crea una base `vector_two_local` en un Postgres local, aplica todas las migraciones dos veces (la segunda pasada prueba que son idempotentes) y lista las tablas con RLS. No toca ningún proyecto Supabase; sirve para validar SQL antes de aplicarlo de verdad.

Proyecto Supabase: **Vector2** (ref `tzjsxzmsvvhxyiooihyq`, región ca-central-1). Las migraciones 0000 a 0004 están aplicadas. Nota operativa: desde Claude Code las sentencias `DROP` quedan esperando una confirmación que no llega; las migraciones se aplican por `execute_sql` sin `DROP` (por eso usan `create or replace trigger`), y cualquier borrado de tabla se hace desde el dashboard.

## Estructura funcional

Lo que existe hoy, por pantalla:

| Pantalla | Quién | Qué hace |
|---|---|---|
| `/login` | público | Correo y contraseña con Supabase Auth |
| `/` | todos | Saludo, rol y estado de los módulos |
| `/usuarios` | admin | Crear usuarios, cambiar rol, desactivar, resetear contraseña, eliminar. Siempre queda al menos un admin activo |
| `/maestros/arbol` | todos (el comprador solo lee) | Árbol Género → Mundo → Línea → Equivalencia en columnas; buscador global de líneas; interruptor de inactivos; agregar o mover líneas entre mundos; crear, renombrar y desactivar equivalencias; columna Agrupación (de estacionalidad) en cada equivalencia, con un selector que guarda al instante para planner y admin y una etiqueta para el comprador; cada línea muestra cuántas equivalencias le faltan por agrupar y el resumen enlaza a Faltantes |
| `/maestros/arbol` → pestaña Importar | admin y planner | Carga el árbol desde un CSV o un Excel (.xlsx, .xls; se elige la hoja si hay varias): mapeo de columnas, previsualización con conteos y el detalle de lo que no se cargará (filas con errores, separadas de las repetidas, con filtro por motivo y descarga en CSV), aplicar. Reimportar el mismo archivo no duplica nada |
| `/maestros/arbol/catalogos` | admin y planner | Géneros y mundos (edita el admin), líneas con su temporada (edita el planner), agrupaciones de talla (solo lectura) |
| `/maestros/marcas` | admin y planner | Tres pestañas. **Marcas** (edita el planner y el admin): crear marcas con su agrupación obligatoria y, si aplica, tratamiento especial con una nota corta; filtrar por agrupación, por tratamiento o por texto; cambiar la agrupación o la bandera desde la fila; desactivar, reactivar o eliminar. **Agrupaciones** (edita solo el admin; el planner las ve): renombrar, reordenar, desactivar, eliminar si no tienen marcas. **Importar** (planner y admin): carga la lista de marcas desde CSV o Excel con columnas `MARCA`, `AGRUPACION` y, opcional, `TRATAMIENTO_ESPECIAL`; previsualiza lo que se creará, lo que se omitirá y las diferencias con lo ya cargado; reimportar no duplica |
| `/maestros/estacionalidad` | admin y planner (editan los dos) | Cinco pestañas. **Mapa**: cobertura por género y una tarjeta por agrupación con su color, conteos y equivalencias por línea; el mismo color identifica a la agrupación en las tablas y en el árbol. **Agrupaciones**: crear, renombrar, describir, reordenar, desactivar y eliminar (solo sin equivalencias) las agrupaciones de estacionalidad; el conteo de equivalencias enlaza a su lista. **Asignación**: la lista plana de equivalencias con su ruta, por árbol (filtros de género, mundo, línea y texto) o por agrupación; se seleccionan varias y se asignan, mueven o quitan en bloque. **Faltantes (N)**: las equivalencias activas que todavía no tienen agrupación activa, con filtros por género, motivo y real/genérica, la misma asignación en bloque y un botón para descargar el CSV listo para completar en Excel; cuando queda vacía, el módulo cumplió su hito. **Importar**: sube ese CSV (o un Excel) con la columna `AGRUPACION` completada; crea las agrupaciones nuevas, asigna y muestra qué cambia antes de aplicar; reimportar no duplica ni cambia nada |
| `/maestros/tiendas` | admin y planner (editan los dos) | Tres pestañas. **Tiendas**: alta de tiendas y centros de distribución con código real (no se deriva del nombre), tipo, zona, razón social, fechas de apertura y cierre y venta esperada (solo para tiendas); mientras escribes las fechas ves el estado que quedará; chips por tipo y estado, filtro de zona y buscador; edición en línea; desactivar (con aviso si la tienda está Activa: cerrar es poner una fecha de cierre, no desactivar), reactivar y eliminar. **Calendario**: próximas aperturas, próximos cierres y tiendas sin fecha de apertura; la línea de tiempo agrupada por mes con separador "Hoy", y "Ver la red al día" para ver los estados a otra fecha. **Importar**: carga la lista de tiendas desde CSV o Excel con columnas `CODIGO` y `NOMBRE` y, opcionales, `TIPO`, `ZONA`, `RAZON_SOCIAL`, `FECHA_APERTURA`, `FECHA_CIERRE` y `VENTA_ESPERADA` (`Tda#` no se mapea); previsualiza lo que se creará, lo que se omitirá, las tiendas que quedarán Planificadas por no traer fecha de apertura y las diferencias con lo ya cargado; reimportar no duplica |

Reglas de tiendas que conviene saber: el estado (Planificada, Activa o Cerrada) no se guarda, se calcula con las fechas y el día de hoy en Lima, así que una tienda pasa de Planificada a Activa sola al llegar su fecha de apertura; apertura = hoy ya es Activa y cierre = hoy sigue Activa (el cierre es el último día con venta); una tienda sin fecha de apertura queda Planificada y un cierre exige apertura; una tienda cerrada sigue activa en el maestro (desactivar es otra cosa y la oculta); el código y el nombre son únicos; el centro de distribución no lleva venta esperada; no hay semilla de tiendas, las carga Javier por pantalla o por el importador, que nunca modifica una tienda existente (solo informa las diferencias). Limitaciones conocidas: el error de un Guardar fallido en la edición en línea sale arriba de la tabla, y el día que usa el navegador no se refresca pasada la medianoche con la pantalla abierta (recargar lo corrige). El detalle está en `docs/modulos/04-tiendas.md`.

Reglas de estacionalidad que conviene saber: cada equivalencia tiene a lo sumo una agrupación, y una equivalencia activa sin agrupación activa es "faltante" (no podrá proyectarse en la Fase 2); las genéricas `SIN EQUIVALENCIA` también necesitan agrupación; desactivar una agrupación no toca sus equivalencias (quedan como faltantes hasta reactivarla o moverlas); no hay agrupaciones de fábrica, las crea el planner; el importador crea agrupaciones y asigna, pero nunca crea líneas ni equivalencias ni quita una agrupación. Las curvas en sí se calculan en M6 sobre la venta real. El detalle está en `docs/modulos/03-agrupaciones-estacionalidad.md`.

Reglas de marcas que conviene saber: cada marca pertenece a una sola agrupación (no hay comodín "sin agrupar"); el nombre es único en todo el maestro; la nota de tratamiento solo existe con la bandera encendida y se borra al apagarla; desactivar una agrupación oculta sus marcas sin perderlas; el importador nunca crea agrupaciones ni modifica marcas existentes (solo informa las diferencias). El detalle está en `docs/modulos/02-marcas.md`.

Reglas del árbol que conviene saber: los mundos existen en todos los géneros; una línea es catálogo y se activa por nodo género-mundo; la equivalencia cuelga del nodo; las filas con equivalencia `-` crean una equivalencia con el nombre de la línea y las filas con equivalencia vacía caen en una genérica `SIN EQUIVALENCIA` por nodo; toda línea tiene mundo, así que las filas de un CSV con el mundo vacío no se cargan y se listan en la previsualización para corregir el archivo; la acción normal es desactivar, y eliminar solo se permite sin hijos. El detalle está en `docs/modulos/01-arbol-producto.md`.

## Desplegar en Railway

`railway.json` define build (`npm run build`), start (`npm run start`) y healthcheck en `/login`. Al crear el servicio, conectarlo al repo y cargar las tres variables de entorno con los mismos valores de `.env.local`. La versión que corre se ve al pie del menú (`APP_VERSION`), útil para confirmar que el deploy tomó el último commit.

## Estructura

```
.claude/agents/      arquitecto · datos · backend · frontend · qa · documentador
docs/                PLAN, DECISIONES, CHANGELOG, modulos/
scripts/             validar-migraciones-local.sh
supabase/migrations/ SQL versionado (0000 base, 0001 árbol de producto, 0002 agrupaciones de marca y marcas, 0003 agrupaciones de estacionalidad, 0004 tiendas)
src/app/login        inicio de sesión
src/app/(app)        todo lo que requiere sesión (layout con menú por rol)
src/app/(app)/maestros/arbol   árbol, importador CSV y catálogos
src/app/(app)/maestros/marcas  marcas, agrupaciones de marca e importador de marcas
src/app/(app)/maestros/estacionalidad  agrupaciones de estacionalidad, asignación, faltantes e importador
src/app/(app)/maestros/tiendas  tiendas, calendario de aperturas y cierres e importador de tiendas
src/app/api          route handlers (auth, usuarios, generos, mundos, lineas, agrupaciones-talla, arbol, equivalencias, agrupaciones-marca, marcas, marcas/importar, agrupaciones-estacionalidad, estacionalidad/asignar, estacionalidad/equivalencias, estacionalidad/faltantes, estacionalidad/importar, tiendas, tiendas/aperturas, tiendas/importar)
src/lib/auth         roles y guards
src/lib/supabase     clientes admin / server / browser y tipos
src/lib/api          respuestas, validación, CRUD de catálogos (con conteo de hijos) y traducción de errores de base
src/lib/arbol        lógica pura del árbol: normalizar, importar, armar-arbol, reglas, esquemas zod
src/lib/marcas       lógica pura de marcas: seed, esquemas zod, reglas, importador, consultas
src/lib/estacionalidad  lógica pura de estacionalidad: tipos, esquemas zod, reglas (faltante, asignación), aplanar, importador, catálogo, consultas, pestañas
src/lib/tiendas      lógica pura de tiendas: tipos, esquemas zod, reglas, estado (calculado con la fecha de Lima), fechas y montos del importador, aperturas, importador, consultas
src/lib/formato.ts   formato de números para la interfaz
src/components/ui    kit de interfaz (incluye la casilla de selección múltiple)
src/components/catalogo    catálogo plano reutilizable (géneros, mundos, agrupaciones de marca y de estacionalidad) y vista previa del nombre
src/components/estacionalidad  badge de agrupación compartido por el árbol y la lista plana
src/components/importador  piezas del importador de archivos (tipos, mapeo, hook, pasos, reporte, descarga CSV) que usan el árbol, las marcas y la estacionalidad
tests/               vitest (364 pruebas en 30 archivos)
datos/               archivos fuente del negocio (ignorados por git)
```

## Estado

| Módulo | Estado |
|---|---|
| M0 Cimientos | Hecho. Desplegado en Railway y validado por Javier (2026-10-05) |
| M1 Árbol de producto | Hecho. Árbol real importado en producción y validado por Javier (2026-10-05) |
| M2 Marcas | Hecho (`0.3.0 · M2`, 2026-10-05). Pendiente de que Javier recorra el hito y cargue la lista real de marcas |
| M3 Agrupaciones de estacionalidad | Hecho (`0.4.0 · M3`, 2026-10-06). Pendiente de que Javier recorra el hito con el árbol real y cierre la clasificación hasta que Faltantes quede vacía |
| M4 Tiendas y aperturas | Hecho (`0.5.0 · M4`, 2026-10-06). Pendiente de que Javier recorra el hito y cargue la lista real de tiendas |

## Marca

Los logos de Vector Two están en `public/marca/` (`isotipo.png` con fondo transparente, `logo-horizontal.png`, `logo-vertical.png`), optimizados a partir de los originales que Javier subió a la rama `main`. El favicon y los iconos de la app (`src/app/favicon.ico`, `icon.png`, `apple-icon.png`) se generan del isotipo.
