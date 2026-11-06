# Auditoría de seguridad · 08b-1b (fechas logísticas, línea de tiempo y OC) · `0.17.0 · M8 b`

- Auditor: agente `seguridad` (sonnet), 2026-11-06, sobre la entrega 08b-1b construida (migración `0038`, rutas `fechas`, `ingreso` y `oc`, importadores, pantallas). Correcciones en el commit `93a7ce9` (código y pruebas) y en `e0593a9` (pantallas); la migración `0038` no cambió.
- **Aviso de fuente.** El texto íntegro del informe original no está en el repo. Esta tabla se reconstruye del encargo del orquestador (el resumen del estado de F1 a F6), del CHANGELOG `0.17.0`, de la ficha `docs/modulos/08b-fechas-logisticas.md` (§6, §13) y de `git show 93a7ce9`. **Donde el repo no dice qué era el hallazgo, la fila lo declara («texto no consta») y no se infiere.** Pedir el informe original al orquestador si hace falta el detalle de F3, F4 y F6.
- Escala: BLOQUEANTE / IMPORTANTE / MENOR / INFO. **Resultado: sin bloqueantes.**
- Alcance declarado en la ficha (§6, último punto): guards; IDOR de paquetes y asignaciones en `mover_a_paquete` con unidades y en `paquetes/[id]/ingreso`; que `linea_de_tiempo` no exponga embarques de otra compra; que `/oc` no permita editar sin `antes` correcto ni una compra cancelada; que el comprador no pise OC ajenas por el importador; que `paquetes/[id]/ingreso` no escriba en un paquete que cambió de embarque; funciones solo `service_role`; catálogos zod y `check` de la base.

| ID | Sev. | Resumen | Estado | Evidencia |
|---|---|---|---|---|
| F1 | MENOR | La causa de una reprogramación no salía en el historial del embarque (se guardaba pero no se leía) | **Corregido (0.17.0)** | `93a7ce9`: `leerHistorial` lee la columna `causa`; prueba de handler en `tests/agrupadores.handlers.test.ts` |
| F2 | MENOR | Cambiar o quitar el número de OC no exigía motivo en el servidor (solo el formulario lo pedía) | **Corregido (0.17.0)** en lo del motivo; **Aceptado (decisión 125, que aplica la 121)** en lo del rol: no hay restricción por rol, los tres roles editan la OC | `93a7ce9`: `exigeMotivoOc` (`src/lib/compras/oc.ts`) y `editarOcCompra` (`src/lib/compras/servicio.ts`) devuelven `409 motivo_requerido` si `antes` tenía valor y la OC cambia o se quita sin motivo, sin mirar el rol; pruebas en `tests/compras.oc.test.ts`. El formulario (`e0593a9`, `editor-oc.tsx`) también lo pide |
| F3 | — | **Texto no consta en el repo.** El orquestador lo da por corregido | **Corregido (0.17.0)** (según el orquestador; no verificado aquí) | Las correcciones de `93a7ce9` son las de esta fila: mover una tanda a paquete con motivo, causa, huella (solo si cambia un mes) y unidades; recepciones vinculadas en la vista previa; alias `/fecha` con causa `otro`; tope del campo `antes` de la OC |
| F4 | — | **Texto no consta en el repo.** El orquestador lo da por aceptado por la decisión 92 (el comprador escribe agrupadores, incluidas las fechas de los embarques; cerrar, reabrir y cancelar siguen siendo de admin y planner) | **Aceptado (decisión 92)** | `docs/DECISIONES.md`, decisión 92 |
| F5 | — | **Texto no consta en el repo.** Según el orquestador: la decisión 121 (OC única por proveedor, permisos de la OC) figuraba como propuesta, y el alias `POST …/embarques/[id]/fecha` es de una sola versión | **Corregido (0.17.0)** en lo documental (la 121 es vigente desde el 2026-11-06); **En curso** en lo del alias: se borra en la versión siguiente (decisión 123) | `docs/DECISIONES.md` (115 a 126); `src/app/api/compras/embarques/[id]/fecha/route.ts` |
| F6 | — | **Ni el texto ni el estado constan en el repo**; no figura en el encargo del orquestador ni en el CHANGELOG | **No verificable** | Pedir el informe original |

## Verificado sin hallazgo (por el propio alcance de la ficha)

Las comprobaciones del alcance listado arriba quedaron sin hallazgo abierto: la ficha §13.2 las resume como «sin bloqueantes». El detalle de qué se probó en cada una no consta en el repo; lo que sí se puede comprobar hoy es que `compras_proveedor_oc_uidx` (índice único parcial) y los `check` de `hito_confirmado`, `causa` y `numero_oc` están en la migración `0038`, y que las funciones de la migración llevan `security invoker`, `search_path` vacío y `grant execute` solo a `service_role` (encabezado de `supabase/migrations/0038_fechas_logisticas_embarque.sql`).

## Seguimiento

- **Alias `/fecha`:** borrarlo en la versión siguiente a `0.17.0 · M8 b` (F5, decisión 123).
- **Cotejo de hashes de `@e965/xlsx`** (el reemplazo de `xlsx`, `b47f8dc`): anotado como pendiente de la entrega.
- **`editar_oc_compra` sin chequeo de rol en SQL** (ficha 08b-fechas-logisticas §13.3): no es un hallazgo abierto, pero conviene repetirlo en la próxima auditoría. Quien llame la función con `service_role` no queda limitado por rol; la restricción del comprador en el importador vive en el servidor.
- Repetir la auditoría cuando exista 08b-2 («Recibir embarque»), que hereda el piso del ingreso de un paquete y escribe `fecha_llegada_real`, y con la carga real de COTV.
