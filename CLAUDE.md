@AGENTS.md

# Vector2 · notas para Claude Code

- Lee `docs/PLAN.md` antes de tocar nada: ahí están las fases, el modelo de datos, los roles y la metodología módulo por módulo.
- Equipo de agentes en `.claude/agents/`: `arquitecto` → `datos` → `backend` + `frontend` → `qa` → `documentador`. Cada módulo pasa por ese ciclo y termina en un hito que Javier valida antes de abrir el siguiente.
- El agente `arquitecto` diseña siempre con el modelo `fable` (fijado en `model` de `.claude/agents/arquitecto.md`; al lanzarlo con la herramienta Agent, pasar además `model: "fable"`). Aplica a toda especificación nueva y a toda revisión de diseño; no depende del modelo de la sesión.
- El agente `seguridad` corre siempre con el modelo `opus` (fijado en `model` de `.claude/agents/seguridad.md`; al lanzarlo con la herramienta Agent, pasar además `model: "opus"`). Es solo lectura: reporta hallazgos y `backend`/`datos` los corrigen.
- El agente `arquitecto-revisor` (segunda opinión independiente sobre las fichas del arquitecto: omisiones, riesgos, casos borde) corre siempre con el modelo `opus` (fijado en `model` de `.claude/agents/arquitecto-revisor.md`; al lanzarlo con la herramienta Agent, pasar además `model: "opus"`). Es solo lectura: entrega feedback y el `arquitecto` (fable) ajusta la ficha. Se usa después de cada ficha grande y antes de construir.
- Dominio en español (tablas, columnas, rutas, UI, commits). Commits con prefijo de módulo: `M1: ...`.
- Seguridad: datos solo con `supabaseAdmin()` desde route handlers; cada handler empieza con `requireUser` / `requirePlanner` / `requireAdmin`. RLS activo sin políticas.
- Migraciones en `supabase/migrations/`, idempotentes, aplicadas con el MCP de Supabase al proyecto `vector-two` (nunca a `lukers-compras`, que es Vector-One).
- `npm run lint`, `npx tsc --noEmit`, `npx vitest run` y `npm run build` deben pasar antes de cada commit.
- Nada de datos reales de Lukers en el repo (`datos/` está ignorada).
- Al terminar cualquier tanda de commits, decirle a Javier la versión vigente (`APP_VERSION` en `src/lib/version.ts`), que es la que verá al pie del menú.
