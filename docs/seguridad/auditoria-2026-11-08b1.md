# Auditoría de seguridad · 08b-1 (agrupadores de compras) · `0.16.0 · M8 b`

- Auditor: agente `seguridad` (sonnet) junto con la revisión de QA, 2026-11-04. Correcciones en el commit `30b8f88` y la migración `0034`.
- **Aviso de fuente.** El texto de los informes originales no está en el repo. Esta tabla se reconstruye de `docs/CHANGELOG.md` (0.16.0), `docs/modulos/08b-agrupadores-de-compras.md` §11.2-§11.5, del encabezado de `supabase/migrations/0034_importar_borrador_propio.sql`, de `git show 30b8f88` y de la base. Donde el repo no dice qué era el hallazgo, la fila lo declara («texto no consta»); no se infiere.
- Escala: BLOQUEANTE / IMPORTANTE / MENOR / INFO.
- Verificado el 2026-11-04 contra el repo (`c371b68`) y `vector-two`.

| ID | Sev. | Resumen | Estado | Evidencia |
|---|---|---|---|---|
| A1 | BLOQUEANTE | Con el importador normal, un comprador podía agregar líneas a una compra **confirmada** ajena y mover el flujo | **Corregido (0.16.0)** | `importar_compra` (0034) rechaza con `compra_no_borrador` si el actor es restringido y la compra no es su borrador; en vivo: la función contiene `restringido` y `compra_no_borrador`, es invoker, `search_path=""`, ejecutable solo por `service_role` (`pg_get_functiondef`, `has_function_privilege`). Código: `esBorradorPropio`, `actorImportarDe` (`src/lib/compras/servicio.ts`), `comprador` en `previsualizarImportacionCompras` (`src/lib/compras/importar.ts`). La función también se defiende sola: si el `perfil_id` del actor es comprador, se restringe aunque falte la clave |
| A2 | BLOQUEANTE | Misma causa que A1 (el repo los trata juntos; no consta en qué se distinguían, probablemente previsualización y aplicación) | **Corregido (0.16.0)** | Igual que A1; pruebas `tests/compras.importar.test.ts`, `tests/compras.handlers.test.ts`, `tests/auth.roles.test.ts` |
| M1 | MENOR | La `revision` de una compra subía aunque sus entregas no cambiaran (409 falsos) | **Corregido (0.16.0)** | `aplicar_movimiento_agrupador` (0034) |
| M2 | MENOR | Los listados de agrupadores leen el mundo completo de compras en cada petición | **Abierto** (anotado) | Hoy 0 compras, 0 viajes: medir tras la carga inicial |
| B1 | MENOR | Texto no consta. Por el commit, lo más probable: topes de enteros en esquemas (una revisión o unidades fuera de rango daban 500) | **Corregido (0.16.0)** (deducido del diff) | `MAX_ENTERO_BASE`, `unidadesTope` en `src/lib/compras/agrupadores/esquemas.ts` |
| B2 | MENOR | Una compra repetida en «asignar a viaje» se procesaba dos veces | **Corregido (0.16.0)** | `deduplicarComprasViaje`; `asignar_viaje_compras` (0034) |
| B3 | MENOR | Al mover una compra de un viaje a otro faltaba el evento en el viaje de origen | **Corregido (0.16.0)** | `asignar_viaje_compras` (0034) |
| B4 | MENOR | Texto no consta. Probable: `413` homogéneo para cuerpos de más de 6 MB en el importador de agrupadores | **Corregido (0.16.0)** (deducido) | `docs/modulos/08b…` §11.3 |
| B5 | INFO | Columnas recortadas a 390 px en las tablas de Compras (heredado de M8, de QA; no es de seguridad) | **Abierto** | §11.5 |
| E | MENOR | El importador de compras aplica compra por compra (una RPC por compra, más dos con columnas de agrupador) y no tiene tope por llamada; `importar_compra` toma un candado consultivo global, así que un archivo de 10 000 filas puede bloquear a otros importadores y alargar la petición | **Abierto** | `MAX_FILAS_IMPORTACION = 10_000` (`src/lib/compras/tipos.ts:71`); `pg_advisory_xact_lock` en `0034` |
| F | MENOR | Sin tope de cantidad de viajes, embarques y paquetes, ni deshacer de una importación de agrupadores; el comprador escribe agrupadores y cancelar es de admin/planner | **Abierto** | `MAX_FILAS_IMPORTAR_AGRUPADORES = 1000` por importación (`src/lib/compras/agrupadores/tipos.ts:192`), sin tope total |
| G | INFO | Textos del importador (confirmación, aviso y mensaje de responsable no asignable) no decían que al comprador se le omiten filas hacia compras ajenas o confirmadas | **Corregido (0.16.0)** | `detalleCompraNoBorrador`, `src/components/compras/importar-compras.tsx` |
| H | INFO | Descripción del rol comprador desactualizada | **Corregido (0.16.0)** | `src/lib/auth/roles.ts` (`DESCRIPCION_ROL.comprador`) |
| I | — | **Texto no consta en el repo**; no figura en el CHANGELOG ni en la ficha. Pedir el informe original al orquestador | **No verificable** | — |
| R-1 | MENOR | `delete` y `truncate` residuales a `service_role` sobre `compra_eventos` | **En curso** (0035 sin aplicar) | `role_table_grants`: aún DELETE, TRUNCATE, UPDATE |
| R-2 | INFO | `list_migrations` vacío (las migraciones se aplican con `execute_sql`) | **En curso** (0035 crea `public.migraciones_aplicadas`; sin aplicar) | `to_regclass('public.migraciones_aplicadas')` es nulo |

## Verificado sin hallazgo (08b-1)

- Guards: 21 rutas nuevas bajo `/api/compras/{viajes,embarques,paquetes,agrupadores,viaje-activo}`; escrituras con `requireUser` por decisión 92; cerrar, reabrir y cancelar con `requirePlanner` (`.../viajes/[id]/estado`, `.../paquetes/[id]/estado`) y, en embarques, `puedeCambiarEstado(rol, accion)` tras el guard (`src/app/api/compras/embarques/[id]/estado/route.ts`).
- `POST /api/compras/importar`: el comprador no fija `estado` ni `origen` (los fija `previsualizarImportacionCompras`: `borrador`/`comprador`); `carga_inicial = true` devuelve 403 al comprador (`puedeImportar`).
- Base: las cinco tablas nuevas con RLS y sin grants a anon/authenticated; funciones de escritura solo invoker y solo `service_role`; `compra_agrupador_eventos` en `select, insert`.
- Cookie `v2_viaje_activo`: preferencia sin efecto sobre permisos (ninguna ruta la lee), `lax`, sin HttpOnly, `secure` en producción.

## Seguimiento

- E y F se resuelven con topes y un `statement_timeout`/tamaño por lote; ver informe de la tanda C §5.
- Cuando exista 08b-2 («Recibir embarque») y 08c (proveedores con contactos, fotos), repetir esta auditoría: el comprador leerá `GET /api/compras/proveedores` y las fotos.
