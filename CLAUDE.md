@AGENTS.md

# Vector2 · notas para Claude Code

- Lee `docs/PLAN.md` antes de tocar nada: ahí están las fases, el modelo de datos, los roles y la metodología módulo por módulo.
- Equipo de agentes en `.claude/agents/`: `arquitecto` → `datos` → `backend` + `frontend` → `qa` → `documentador`. Cada módulo pasa por ese ciclo y termina en un hito que Javier valida antes de abrir el siguiente.
- Dominio en español (tablas, columnas, rutas, UI, commits). Commits con prefijo de módulo: `M1: ...`.
- Seguridad: datos solo con `supabaseAdmin()` desde route handlers; cada handler empieza con `requireUser` / `requirePlanner` / `requireAdmin`. RLS activo sin políticas.
- Migraciones en `supabase/migrations/`, idempotentes, aplicadas con el MCP de Supabase al proyecto `vector-two` (nunca a `lukers-compras`, que es Vector-One).
- `npm run lint`, `npx tsc --noEmit`, `npx vitest run` y `npm run build` deben pasar antes de cada commit.
- Nada de datos reales de Lukers en el repo (`datos/` está ignorada).
- Al terminar cualquier tanda de commits, decirle a Javier la versión vigente (`APP_VERSION` en `src/lib/version.ts`), que es la que verá al pie del menú.
