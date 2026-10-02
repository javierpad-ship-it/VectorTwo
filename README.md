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

Proyecto Supabase: `vector-two` (pendiente de crear en el dashboard; ver `docs/modulos/00-cimientos.md`).

## Desplegar en Railway

`railway.json` define build (`npm run build`), start (`npm run start`) y healthcheck en `/login`. Al crear el servicio, conectarlo al repo y cargar las tres variables de entorno con los mismos valores de `.env.local`. La versión que corre se ve al pie del menú (`APP_VERSION`), útil para confirmar que el deploy tomó el último commit.

## Estructura

```
.claude/agents/      arquitecto · datos · backend · frontend · qa · documentador
docs/                PLAN, DECISIONES, CHANGELOG, modulos/
supabase/migrations/ SQL versionado
src/app/login        inicio de sesión
src/app/(app)        todo lo que requiere sesión (layout con menú por rol)
src/app/api          route handlers
src/lib/auth         roles y guards
src/lib/supabase     clientes admin / server / browser y tipos
src/lib/api          respuestas y validación
src/components/ui    kit de interfaz
tests/               vitest
datos/               archivos fuente del negocio (ignorados por git)
```

## Estado

| Módulo | Estado |
|---|---|
| M0 Cimientos | Código listo; falta crear el proyecto Supabase y recorrer el hito |
| M1 Árbol de producto | Pendiente |
| M2 Marcas | Pendiente |
| M3 Agrupaciones de estacionalidad | Pendiente |
| M4 Tiendas y aperturas | Pendiente |
