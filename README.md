# Vector2 · Planificación de producto Lukers

Sistema interno para planificar el producto de Lukers: árbol de clasificación, marcas, tiendas, curvas de estacionalidad, proyección anual de unidades y necesidad de compra. Segunda versión, construida desde cero; Vector-One queda como referencia.

El plan completo, el modelo de datos y la metodología están en [`docs/PLAN.md`](docs/PLAN.md). Las decisiones tomadas y su porqué, en [`docs/DECISIONES.md`](docs/DECISIONES.md). Cada módulo tiene su ficha en `docs/modulos/`.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Supabase (Postgres + Auth). Los datos se leen y escriben solo desde el servidor con la llave `service_role`; la sesión del usuario viaja en cookies con `@supabase/ssr`
- zod para validar la API, vitest para la lógica de negocio
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

Proyecto Supabase: **Vector2** (ref `tzjsxzmsvvhxyiooihyq`, región ca-central-1). Las migraciones 0000 y 0001 están aplicadas. Nota operativa: desde Claude Code las sentencias `DROP` quedan esperando una confirmación que no llega; las migraciones se aplican por `execute_sql` sin `DROP` (por eso usan `create or replace trigger`), y cualquier borrado de tabla se hace desde el dashboard.

## Estructura funcional

Lo que existe hoy, por pantalla:

| Pantalla | Quién | Qué hace |
|---|---|---|
| `/login` | público | Correo y contraseña con Supabase Auth |
| `/` | todos | Saludo, rol y estado de los módulos |
| `/usuarios` | admin | Crear usuarios, cambiar rol, desactivar, resetear contraseña, eliminar. Siempre queda al menos un admin activo |
| `/maestros/arbol` | todos (el comprador solo lee) | Árbol Género → Mundo → Línea → Equivalencia en columnas; buscador global de líneas; interruptor de inactivos; agregar o mover líneas entre mundos; crear, renombrar y desactivar equivalencias |
| `/maestros/arbol` → pestaña Importar CSV | admin y planner | Carga el árbol desde un CSV: mapeo de columnas, previsualización con conteos y el detalle de lo que no se cargará (filas con errores, separadas de las repetidas, con filtro por motivo y descarga en CSV), aplicar. Reimportar el mismo archivo no duplica nada |
| `/maestros/arbol/catalogos` | admin y planner | Géneros y mundos (edita el admin), líneas con su temporada (edita el planner), agrupaciones de talla (solo lectura) |

Reglas del árbol que conviene saber: los mundos existen en todos los géneros; una línea es catálogo y se activa por nodo género-mundo; la equivalencia cuelga del nodo; las filas sin equivalencia caen en una genérica `SIN EQUIVALENCIA` por nodo; toda línea tiene mundo, así que las filas de un CSV con el mundo vacío no se cargan y se listan en la previsualización para corregir el archivo; la acción normal es desactivar, y eliminar solo se permite sin hijos. El detalle está en `docs/modulos/01-arbol-producto.md`.

## Desplegar en Railway

`railway.json` define build (`npm run build`), start (`npm run start`) y healthcheck en `/login`. Al crear el servicio, conectarlo al repo y cargar las tres variables de entorno con los mismos valores de `.env.local`. La versión que corre se ve al pie del menú (`APP_VERSION`), útil para confirmar que el deploy tomó el último commit.

## Estructura

```
.claude/agents/      arquitecto · datos · backend · frontend · qa · documentador
docs/                PLAN, DECISIONES, CHANGELOG, modulos/
scripts/             validar-migraciones-local.sh
supabase/migrations/ SQL versionado (0000 base, 0001 árbol de producto)
src/app/login        inicio de sesión
src/app/(app)        todo lo que requiere sesión (layout con menú por rol)
src/app/(app)/maestros/arbol   árbol, importador CSV y catálogos
src/app/api          route handlers (auth, usuarios, generos, mundos, lineas, agrupaciones-talla, arbol, equivalencias)
src/lib/auth         roles y guards
src/lib/supabase     clientes admin / server / browser y tipos
src/lib/api          respuestas, validación, CRUD de catálogos y traducción de errores de base
src/lib/arbol        lógica pura del árbol: normalizar, importar, armar-arbol, reglas, esquemas zod
src/components/ui    kit de interfaz
tests/               vitest (112 pruebas en 9 archivos)
datos/               archivos fuente del negocio (ignorados por git)
```

## Estado

| Módulo | Estado |
|---|---|
| M0 Cimientos | Construido y desplegable; base aplicada en Supabase; hito pendiente de que Javier lo recorra en Railway |
| M1 Árbol de producto | Construido y desplegable; hito pendiente de que Javier importe el árbol en Railway |
| M2 Marcas | Pendiente |
| M3 Agrupaciones de estacionalidad | Pendiente |
| M4 Tiendas y aperturas | Pendiente |
