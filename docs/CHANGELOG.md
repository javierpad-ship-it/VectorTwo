# Changelog

Formato: versión (`APP_VERSION` en `src/lib/version.ts`), fecha, módulo, qué cambió.

## 0.2.3 · M1 — 2026-10-05

- **`-` en la equivalencia = igual a la línea.** Regla aclarada por Javier: una fila con equivalencia `-` crea una equivalencia real con el nombre de su línea (antes caía en la genérica). Vale en el importador, en la API al crear (`POST /api/equivalencias` traduce `-`) y en la pantalla (escribir `-` al crear muestra que tomará el nombre de la línea); al renombrar se rechaza. La misma regla queda registrada para las cargas de venta y stock de la Fase 2. Conteos con el archivo actual: 1 956 procesadas · 46 omitidas (14 mundo vacío + 32 duplicadas) · 86 líneas · 556 nodos · 1 691 reales (368 por `-`) + 265 genéricas.
- Tests: 131 en 10 archivos.

## 0.2.2 · M1 — 2026-10-05

- **Importar desde Excel.** La pestaña Importar acepta `.xlsx` y `.xls` además de CSV; la cabecera es la primera fila con datos, las columnas sin nombre y las filas vacías se descartan, y si el libro tiene varias hojas se elige cuál leer. Lector en `src/lib/arbol/leer-archivo.ts` (SheetJS cargado bajo demanda), probado con un `.xls` generado en memoria y con el archivo real de Javier.
- Login: botón para mostrar u ocultar la contraseña y casilla "Recordarme en este equipo" (guarda el correo en el navegador).
- Marca: logos de Vector Two en login, menú y favicon.
- Build: lockfile compatible con `npm ci` (tipos de Node 24) para que Railway compile.
- Tests: 121 en 10 archivos.

## 0.2.1 · M1 — 2026-10-02

Dos ajustes confirmados por Javier después del cierre de M1 (detalle en `docs/DECISIONES.md`, entradas "Toda línea tiene mundo" y "La previsualización muestra el detalle completo").

- **Toda línea tiene mundo.** Se quita el mundo `SIN ASIGNAR` del seed de `0001_arbol_producto.sql` (quedan 5: CASUAL, URBANO, DEPORTIVO, FORMAL, RI). El importador omite las filas con mundo vacío con el motivo nuevo `mundo_vacio`; el reporte ya no trae `sin_mundo` ni el resumen de `/api/arbol` `nodos_sin_asignar`; el enlace "N en SIN ASIGNAR" desaparece de `/maestros/arbol`; "Mover a otro mundo" está disponible en cualquier nodo para admin y planner. Conteos de referencia del hito con el archivo actual: 2 002 recibidas · 1 790 procesadas · 212 omitidas (14 `mundo_vacio` + 198 repetidas) · 86 líneas · 556 nodos · 1 414 equivalencias reales + 376 genéricas · PANTALON en 25 nodos.
- **Detalle antes de cargar.** Cada fila omitida viaja completa (`genero`, `mundo`, `linea`, `equivalencia`) con `motivo`, `detalle` y, en las repetidas, `fila_original`. La pestaña Importar CSV separa "Filas con errores" (filtro por motivo, aviso de que no se cargarán, botón "Descargar omitidas (CSV)") de "Repetidas en el archivo" (informativas). El `confirm` de Aplicar repite cuántas filas quedan fuera.
- Tests: 112 en 9 archivos (el del CSV real fija los conteos nuevos).

## 0.2.0 · M1 — 2026-10-02

- Migración `0001_arbol_producto.sql`: `generos`, `mundos`, `lineas`, `genero_mundo_linea`, `equivalencias` (con `es_generica`) y `agrupaciones_talla`. Seeds de 8 géneros, 6 mundos (incluido SIN ASIGNAR, retirado en 0.2.1) y 2 agrupaciones de talla. Todas las FK con `on delete restrict`; RLS activo sin políticas. No hay tabla de tallas.
- API: CRUD de géneros y mundos (escribe el admin), de líneas (escribe el planner) y lectura de agrupaciones de talla; nodos género-mundo-línea (crear, activar o desactivar, mover de mundo, eliminar); equivalencias por nodo con la genérica `SIN EQUIVALENCIA`; `GET /api/arbol` con el árbol completo; `POST /api/arbol/importar` en modos previsualizar y aplicar.
- Helpers compartidos: `src/lib/api/catalogo.ts` (CRUD plano configurable), `errores-db.ts` (único y FK a 409, check a 400, el resto 500 genérico con registro en servidor), `idDeRuta` (ids que no son UUID responden 404) y `leerTodo` (lecturas paginadas de a 1 000 filas).
- Pantalla `/maestros/arbol`: columnas Géneros, Mundos, Líneas y Equivalencias; buscador global de líneas; interruptor "Mostrar inactivos"; resumen con enlace a SIN ASIGNAR (retirado en 0.2.1); pestaña Importar CSV (papaparse en el navegador, mapeo de columnas, previsualizar y aplicar). `/maestros/arbol/catalogos`: pestañas Géneros, Mundos, Líneas y Agrupaciones de talla.
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
