# Changelog

Formato: versión (`APP_VERSION` en `src/lib/version.ts`), fecha, módulo, qué cambió.

## 0.2.0 · M1 — 2026-10-02

- Migración `0001_arbol_producto.sql`: `generos`, `mundos`, `lineas`, `genero_mundo_linea`, `equivalencias` (con `es_generica`) y `agrupaciones_talla`. Seeds de 8 géneros, 6 mundos (incluido SIN ASIGNAR) y 2 agrupaciones de talla. Todas las FK con `on delete restrict`; RLS activo sin políticas. No hay tabla de tallas.
- API: CRUD de géneros y mundos (escribe el admin), de líneas (escribe el planner) y lectura de agrupaciones de talla; nodos género-mundo-línea (crear, activar o desactivar, mover de mundo, eliminar); equivalencias por nodo con la genérica `SIN EQUIVALENCIA`; `GET /api/arbol` con el árbol completo; `POST /api/arbol/importar` en modos previsualizar y aplicar.
- Helpers compartidos: `src/lib/api/catalogo.ts` (CRUD plano configurable), `errores-db.ts` (único y FK a 409, check a 400, el resto 500 genérico con registro en servidor), `idDeRuta` (ids que no son UUID responden 404) y `leerTodo` (lecturas paginadas de a 1 000 filas).
- Pantalla `/maestros/arbol`: columnas Géneros, Mundos, Líneas y Equivalencias; buscador global de líneas; interruptor "Mostrar inactivos"; resumen con enlace a SIN ASIGNAR; pestaña Importar CSV (papaparse en el navegador, mapeo de columnas, previsualizar y aplicar). `/maestros/arbol/catalogos`: pestañas Géneros, Mundos, Líneas y Agrupaciones de talla.
- Lógica pura en `src/lib/arbol/` (normalizar, importar, armar-arbol, reglas) con 110 tests en 9 archivos; uno de ellos planifica el CSV real si está en `datos/` y fija los conteos de referencia del hito.
- Menú: "Árbol de producto" habilitado para los tres roles; el comprador lo ve en solo lectura.
- `scripts/validar-migraciones-local.sh`: aplica todas las migraciones dos veces contra un Postgres local para probar idempotencia sin tocar Supabase.
- Dependencias nuevas: `papaparse` y `@types/papaparse`.

## 0.1.0 · M0 — 2026-10-02

- Proyecto Next.js 16 + TypeScript + Tailwind 4 creado desde cero.
- Migración `0000_base.sql`: `perfiles` con roles admin / planner / comprador y bandera `activo`.
- Login con correo y contraseña (Supabase Auth); `proxy.ts` protege todas las rutas.
- Guards `requireUser`, `requirePlanner`, `requireAdmin`; respuestas y validación zod unificadas.
- Menú lateral por rol con los módulos de la Fase 1 anunciados.
- Pantalla `/usuarios`: crear, cambiar rol, desactivar, resetear contraseña, eliminar, con las reglas de "último admin" probadas.
- Equipo de agentes en `.claude/agents/` y documentación en `docs/`.
- `railway.json`, `INICIAR.cmd`, `.env.local.example`.
