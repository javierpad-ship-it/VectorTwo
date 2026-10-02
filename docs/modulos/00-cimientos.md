# M0 · Cimientos

## Objetivo

Dejar el esqueleto sobre el que se construye todo lo demás: proyecto Next.js, base Supabase con perfiles y roles, login, menú por rol, administración de usuarios, equipo de agentes y documentación. Sin maestros todavía.

## Modelo de datos

Migración `supabase/migrations/0000_base.sql`.

| Tabla | Columnas | Notas |
|---|---|---|
| `perfiles` | `id uuid PK → auth.users (cascade)`, `email text`, `nombre text null`, `rol text check in (admin, planner, comprador) default planner`, `activo bool default true`, `created_at`, `updated_at` | Índice único sobre `lower(email)`. Trigger `set_updated_at`. RLS activo sin políticas |

Función `public.tg_set_updated_at()` compartida por todas las tablas futuras.

El primer admin se da de alta con el último bloque de la migración: toma al usuario de `auth.users` con el correo de Javier y le crea el perfil `admin` si no existe.

## Contratos de API

| Ruta | Método | Guard | Cuerpo | Respuesta |
|---|---|---|---|---|
| `/api/auth/me` | GET | `requireUser` | — | `{ id, email, nombre, rol }` |
| `/api/usuarios` | GET | `requireAdmin` | — | `perfiles[]` ordenados por creación |
| `/api/usuarios` | POST | `requireAdmin` | `{ email, password (≥8), nombre?, rol }` | perfil creado, 201. Si falla el perfil se borra el usuario de Auth |
| `/api/usuarios/[id]` | PATCH | `requireAdmin` | cualquiera de `{ nombre, rol, activo, password }` | perfil actualizado. Al desactivar se cierran sus sesiones |
| `/api/usuarios/[id]` | DELETE | `requireAdmin` | — | `{ id }`. Borra en Auth; el perfil cae en cascada |

Errores: 401 sin sesión · 403 sin perfil, inactivo o rol insuficiente · 400 validación zod o error de Auth traducido · 404 usuario inexistente · 409 regla de negocio.

## Pantallas

| Ruta | Quién | Qué hace |
|---|---|---|
| `/login` | Público | Correo y contraseña; redirige a `next` o a `/` |
| `/` | Todos | Saludo, rol y estado de los módulos de la Fase 1 |
| `/usuarios` | admin | Crear usuario; cambiar rol; desactivar/reactivar; resetear contraseña; eliminar |
| Pantalla de cuenta bloqueada | Sesión sin perfil o inactiva | Explica el motivo y permite cerrar sesión |

El menú lateral (`src/lib/nav.ts`) muestra por rol: General (todos), Maestros (admin y planner, items M1–M4 deshabilitados con su etiqueta de módulo), Administración (admin).

## Reglas de negocio

Implementadas en `src/lib/usuarios/reglas.ts`, probadas en `tests/usuarios.reglas.test.ts`:

1. Nadie puede eliminar ni desactivar su propio usuario.
2. Un admin no puede quitarse a sí mismo el rol admin.
3. Después de cualquier cambio debe quedar al menos un admin activo.

## Hito de prueba

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` limpios.
- [ ] Sin sesión, cualquier ruta redirige a `/login`; con sesión, `/login` redirige a `/`.
- [ ] Javier entra como admin y ve Inicio, Maestros (deshabilitados) y Administración.
- [ ] Crea un planner: al entrar ve Inicio y Maestros; `/usuarios` le redirige a `/`; `GET /api/usuarios` le devuelve 403.
- [ ] Crea un comprador: solo ve Inicio.
- [ ] Desactiva al planner: su siguiente navegación muestra "Tu usuario está desactivado".
- [ ] Intenta desactivarse a sí mismo: botón deshabilitado y la API responde 409.
- [ ] Intenta degradar al único admin: 409 "al menos un administrador activo".
- [ ] `APP_VERSION` visible al pie del menú.

## Fuera de alcance

Recuperación de contraseña por correo (hoy la resetea un admin). Auditoría de acciones. Cualquier maestro.

## Estado

Código completo y verificado con lint, tsc y tests. **Pendiente**: proyecto Supabase `vector-two` (la creación desde la sesión expiró; lo crea Javier), aplicar la migración, regenerar tipos y recorrer el hito contra la base real.
