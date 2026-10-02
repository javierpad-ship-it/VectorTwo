# Changelog

Formato: versión (`APP_VERSION` en `src/lib/version.ts`), fecha, módulo, qué cambió.

## 0.1.0 · M0 — 2026-10-02

- Proyecto Next.js 16 + TypeScript + Tailwind 4 creado desde cero.
- Migración `0000_base.sql`: `perfiles` con roles admin / planner / comprador y bandera `activo`.
- Login con correo y contraseña (Supabase Auth); `proxy.ts` protege todas las rutas.
- Guards `requireUser`, `requirePlanner`, `requireAdmin`; respuestas y validación zod unificadas.
- Menú lateral por rol con los módulos de la Fase 1 anunciados.
- Pantalla `/usuarios`: crear, cambiar rol, desactivar, resetear contraseña, eliminar, con las reglas de "último admin" probadas.
- Equipo de agentes en `.claude/agents/` y documentación en `docs/`.
- `railway.json`, `INICIAR.cmd`, `.env.local.example`.
