# M14 · Tablero de aprobación de dirección (proyección mes a mes frente a lo vendido)

> **Estado: construida en `0.19.0 · M14` (2026-11-10), con QA y auditoría de seguridad; migración `0041` aplicada en Vector2 y medida con datos reales; pendiente del hito con Javier (sección S de `docs/pruebas/cowork-checklist.md`).** Lo que se apartó de esta especificación al construir, la medición real y los pendientes están en §13 («Construido en `0.19.0`»); las decisiones 134 a 148 están vigentes en `docs/DECISIONES.md`. Historia de la especificación: primera versión el 2026-11-09 (commit `acddbcc`); la revisó el `arquitecto-revisor` (bloqueantes B1 a B3, importantes I1 a I8, menores M1 a M10) y el coordinador (hallazgos 1 a 13), y Javier decidió el 2026-11-10 (§12.1 mapea cada hallazgo a dónde quedó). Sobre la versión `31afc87`, la **segunda revisión** del `arquitecto-revisor` dejó un bloqueante (B-1), cinco importantes (I-A a I-E) y cinco menores (M-A a M-E); Javier aceptó todas sus propuestas y este ajuste las incorpora (§12.2). Módulo nuevo, número 14. **Primera entrega `0.19.0 · M14`** (todo lo de esta ficha salvo §8); **segunda entrega `0.19.1 · M14`** (§8, opcional, la primera no depende de ella). Commits `M14: ...`. **Una migración: `0041_tablero_direccion.sql`** (Javier autorizó aplicarla con ese nombre en `vector-two` cuando esté probada en local; la reserva de la `0041` para la tabla de agregados de venta se retira, decisión 140). Depende de [07](07-proyeccion-anual.md) (bloques, método, cierre), [07c](07c-crecimientos-por-genero-mundo.md) y 06d (crecimientos por GM y sus versiones), [06e](06e-cierre-del-anio-y-base-sin-nino.md) (base corregida del Niño, `estadoFactorY`), [07f](07f-venta-por-tienda-en-crecimientos.md) (atribución por tienda, decisión 111, que esta ficha **reutiliza** sin cambiarla), [07g](07g-aprobacion-en-bloque.md) (lotes; el bucle de causas de `bloqueosDeLote`, que §3.5 repite sobre los argumentos del cierre) y [08](08-flujo-y-compras.md) (qué cerrada lee Compras). Todas las cifras de esta ficha son sintéticas.

**Petición de Javier (textual):** «para poder aprobar a nivel de dirección necesito un dashboard para aprobar las proyecciones, donde vea y pueda filtrar por GML y tiendas lo que se está proyectando para cada mes, teniendo en cuenta lo vendido en los años pasados y el que va en curso». Precisiones posteriores: la **agrupación de marca** es filtro de primer nivel; **soles y cobertura** como datos de apoyo; **solo el admin aprueba**; la aprobación **no bloquea** el cierre ni las compras, pero los avisos deben ser visibles (quién cerró, cuándo, y que no hay aprobación vigente).

## 1. Objetivo

Hoy la proyección se trabaja en pestañas pensadas para el planner y nadie la aprueba: un planner puede aceptar filas, fijar factores y cerrar, y esa cerrada es la que lee Compras sin que dirección la haya visto. M14 da a dirección **una sola pantalla de solo lectura** que responde, en este orden, **qué se va a comprar** (2027 y el cierre de 2026, mes a mes, frente a lo vendido de 2023 a 2026), **de dónde sale el aumento** (puente de 2026 a 2027: base, corrección del Niño, crecimiento declarado, lo fijado a mano, otras diferencias con la propuesta, aperturas y cierres), **qué riesgo corre** (alertas: lo que bloquearía el cierre, factores provisionales y cuántas unidades exponen, crecimiento contra la tendencia, quién decidió y cómo, concentración) y **qué cambió desde lo último aprobado**, recortable por género (varios, con atajo «Resto»), mundo, línea, temporada, agrupación de marca, marca y tiendas. Encima añade un **registro inmutable de aprobación de dirección** (aprobada, con observaciones o rechazada; quién, cuándo y sobre qué huella exacta de cifras) que queda invalidado solo si la proyección cambia, y **avisos visibles** en Proyección y en Flujo mensual cuando la cerrada que usa Compras no tiene aprobación vigente. No cambia ningún cálculo de M7, no bloquea nada y no cambia lo que M8 lee.

### 1.1 Decisiones de diseño (con su porqué)

| # | Decisión | Por qué / descartado |
|---|---|---|
| D1 | **Solo lectura sobre lo guardado.** Suma `proyeccion_fila_anios.meses` (el reparto ya hecho) y la venta publicada; nunca recalcula ni reparte la proyección. | 07 §5 paso 6: lo que se ve es lo que M8 consume. En la cerrada real `Σ meses = Σ vigente` exacto (medido por el revisor). |
| D2 | **Unidades como medida principal; soles y cobertura como datos de apoyo rotulados.** Soles reales de 2023 a 2026; lo proyectado valorizado al precio medio de los últimos 12 meses de cada línea × agrupación de marca, siempre «estimado». Stock del último mes publicado (tiendas y CD) y meses de cobertura. | Decisión de Javier (2026-11-10). M7 no proyecta soles (decisión 110): el tablero no los guarda ni los pasa a ningún otro módulo; los calcula al mostrar y los rotula. |
| D3 | **Agrupación de marca (AM) como filtro de primer nivel**, exacta en proyección (cada fila es GML × AM) y en venta (AM de la unidad de marca, como `venta_proyeccion`). | Petición de Javier. |
| D4 | **«Marca» es la unidad de marca** (la cabeza de `marcas_unidad`). Venta exacta (todas las marcas de la unidad); proyección estimada con `participaciones.por_marca` de la fila base, que M7 guarda **por unidad de marca**. En `0.19.0` una sola unidad a la vez; varias en `0.19.1`. | Es la única granularidad por la que M7 guarda participación; filtrar por la marca real dejaría en cero a un miembro de un conjunto de otra cabeza (M7 del revisor). |
| D5 | **Tienda: la misma atribución que 07f para el año (decisión 111) y un reparto mensual nuevo, compartido.** Tiendas de bloque (nuevas, aperturas, cierres de `Y+1`) exactas; las mismas tiendas, estimadas. Enero a `k` del año en curso: real exacto. §3.4. | B1 e I5 del revisor y decisión del coordinador. Dos pantallas no deben dar dos cifras para la misma tienda. |
| D6 | **Por defecto se abre la cerrada que usa Compras**, con la misma regla que M8 (`hastaPorDefecto` + `planHorizonte`), y **«Comparar con» por defecto es la última proyección aprobada**. | I8 y hallazgo 13: en enero «la cerrada del año en curso» no existe; M8 usa la del año anterior. I6 y hallazgo 8: dirección aprueba cada mes y lo que necesita ver es la diferencia con lo último que aprobó. |
| D7 | **Aprueba solo el `admin`**; admin y planner ven el tablero; el comprador no entra (decisión 113). Sin rol nuevo. | Decisión de Javier. |
| D8 | **La aprobación no bloquea ni el cierre ni el flujo; avisa.** En Proyección y en Flujo mensual (admin y planner): quién cerró, cuándo, el estado de dirección y, si no hay aprobación vigente, cuánto difiere de lo último aprobado. «Con observaciones» cuenta como aprobación vigente. | Decisión de Javier. La diferencia con lo aprobado evita que el aviso se vuelva ruido (M9). |
| D9 | **Huella de cifras en SQL, por contenido y no por identificador.** Usa la `clave` de cada fila (estable entre copias) y no `proyeccion_id` ni `fila_id`: dos proyecciones con las mismas cifras tienen la misma huella, y el tablero puede decir «idéntica a la aprobada». La aprobación **no se transfiere**: el estado es siempre de la proyección mostrada. | Hallazgo 10 del coordinador y M9 del revisor. |
| D10 | **Una sola huella para el `resumen` y el registro.** El `resumen` de la aprobación sale de una lectura que trae su huella; si difiere de la que vio el admin, `409` antes de registrar; la función de registro vuelve a comparar. | I3. |
| D11 | **Contrato de tamaño por elemento.** El desglose trae totales por elemento (años, ene–`k'`, cierre, 2027), nunca series mensuales por elemento; la serie mensual de un elemento se ve **eligiéndolo**, que lo aplica como filtro. | B3: con series por elemento, el desglose por línea pesaba 1,15 MB. |
| D12 | **Lo que bloquearía el cierre sale de las reglas de M7, no de una copia.** Conteos con `filaBloqueaCierre`; causas con `motivoRechazoCerrar` en modo comprobación, en un bucle como el de `bloqueosDeLote` (07g) pero **con exactamente los argumentos de `cerrarProyeccion`** y sus mensajes; «desactualizada» se marca como forzable. | B2 e I-D (segunda revisión): `bloqueosDeLote` no pasa `crecimientosCambiados`, reescribe los mensajes para el lote y trata «desactualizada» como bloqueo duro. |
| D13 | **Sin tabla de agregados de venta en M14.** Si la medición falla, la salida es no preagregar por marca cuando no hace falta, más la caché. | I1: el plan B no se podía construir así; tendrá su propia ficha. |
| D14 | **2023 y 2026 son años del Niño** y se rotulan como tales (de `periodos_atipicos`, no a mano); se destaca «2027 frente a 2025, último año normal» y se dibuja la línea derivada «2026 sin Niño». | I7 y hallazgo 5. |

## 2. Modelo de datos (`supabase/migrations/0041_tablero_direccion.sql`)

Convenciones de `docs/PLAN.md` §3 y de `0013` a `0040`: idempotente (`create table if not exists`, `create or replace function`, `create index if not exists`, `create or replace trigger`), **sin `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`**, sin bloques `do $$`, sin backfill, cuerpos de función sin comentarios `--`, identificadores ≤ 63 caracteres. Tabla con `id uuid`, `activo`, `created_at`, `updated_at`, RLS activo **sin políticas**. Funciones `security invoker`, `set search_path = ''`, todo calificado con esquema, `revoke execute … from public, anon, authenticated`, `grant execute … to service_role`, `comment on function`. Al final, `insert into public.migraciones_aplicadas (nombre, nota) values ('0041_tablero_direccion', '…') on conflict (nombre) do nothing` (patrón de la `0040`). Se aplica con el MCP de Supabase **en `vector-two`, nunca en `lukers-compras`**, después de pasar el humo en local dos veces.

Contenido: una tabla (`aprobaciones_direccion`), su trigger de inmutabilidad y cuatro funciones (`huella_proyeccion`, `tablero_proyeccion`, `tablero_venta`, `registrar_aprobacion_direccion`). Ninguna tabla ni columna existente cambia.

### 2.1 Tabla `aprobaciones_direccion` (solo inserción)

Una fila por acto de aprobación. Nunca se edita ni se borra; una aprobación nueva sobre la misma proyección se suma al historial y el estado se deriva al leer (§5.1).

| Columna | Tipo | Null | Notas |
|---|---|---|---|
| `id` | `uuid pk default gen_random_uuid()` | no | |
| `proyeccion_id` | `uuid → proyecciones(id) on delete restrict` | no | `restrict`: una proyección con aprobaciones no se elimina (hoy solo se elimina una en trabajo sin decisiones, 07 §6.3); la API traduce el error a `409 tiene_aprobaciones` («archívala»). Borrar una proyección no debe borrar el rastro de una decisión de dirección. |
| `anio_en_curso` | `integer` | no | Copia de `proyecciones.anio_en_curso` al aprobar; `check (anio_en_curso between 2024 and 2100)`. |
| `estado_proyeccion` | `text` | no | `check (estado_proyeccion in ('en_trabajo','cerrada'))`: el estado **al aprobar**. Una archivada no se aprueba. |
| `huella` | `text` | no | `check (huella ~ '^[0-9a-f]{32}$')`: la de `huella_proyeccion` (§2.3 a) **recalculada por la función de registro**, nunca la del cliente. |
| `resultado` | `text` | no | `check (resultado in ('aprobada','con_observaciones','rechazada'))`. |
| `motivo` | `text` | sí | `check (motivo is null or motivo in ('crecimiento_alto','crecimiento_bajo','contra_tendencia','tiendas_nuevas','nino','filas_sin_decidir','concentracion','otro'))`. |
| `comentario` | `text` | sí | `check (comentario is null or char_length(comentario) <= 1000)`. Regla: `check (resultado = 'aprobada' or (motivo is not null and comentario is not null and char_length(btrim(comentario)) >= 10))`. |
| `resumen` | `jsonb` | no | Foto de lo aprobado, para leerla aunque la proyección cambie (forma exacta en §3.3, `ResumenAprobacionApi`): `huella`, `hasta_periodo`, `version_metodo`, totales por año y bloque, puente total, por GM (cierre del año en curso, base, 2027 por bloque, crecimiento declarado e implícito) y conteo de alertas por código. `check (pg_column_size(resumen) <= 65536)` y **`check ((resumen ->> 'huella') = huella)`**: la foto y la huella son del mismo estado (D10). |
| `perfil_id` | `uuid → perfiles(id) on delete set null` | sí | Índice. `set null` para no impedir eliminar un usuario; el nombre queda. |
| `usuario_nombre` | `text` | no | `check (char_length(usuario_nombre) between 1 and 200)`; sale de la sesión. |
| `rol` | `text` | no | **`check (rol = 'admin')`**: hoy solo aprueba el admin (D7). Un rol aprobador futuro (`direccion`) exigirá su propia migración, que es donde debe decidirse. |
| `activo` | `boolean not null default true` | no | Por convención; sin uso (no se «desactiva» una aprobación: se registra otra). |
| `created_at`, `updated_at` | `timestamptz not null default now()` | no | Trigger `tg_set_updated_at` por convención (no se dispara: no hay `update`). |

Índices: `(proyeccion_id, created_at desc)` (estado e historial), `(created_at desc) where resultado <> 'rechazada'` (la última aprobada, D6), `(perfil_id)`.

**Inmutabilidad (patrón de `proveedor_eventos`, `0039`, y `tg_proyeccion_lote_inmutable`, `0031`).** Función de trigger `tg_aprobaciones_direccion_inmutable()` que rechaza `delete`, `truncate` y todo `update` **salvo** el que solo cambia `perfil_id` a `null` (lo hace la FK `set null`), con `errcode = 'restrict_violation'` y el mensaje «aprobaciones_direccion es un registro inmutable». Triggers `before update or delete … for each row` y `before truncate … for each statement`. Vale también para `service_role`.

**Privilegios (regla de la `0035` y H-6 de la `0040`).** `revoke all on public.aprobaciones_direccion from public, anon, authenticated, service_role;` y luego `grant select, insert on public.aprobaciones_direccion to service_role;` (sin `update`, `delete`, `truncate`, `references` ni `trigger`). Entra en la lista de tablas de solo inserción de `docs/PLAN.md`.

**Por qué una tabla y no columnas en `proyecciones`:** una proyección puede tener varias aprobaciones (con observaciones, luego aprobada; aprobada, cambia y se vuelve a aprobar) y la pregunta de auditoría es «quién vio qué y cuándo».

### 2.2 Qué se lee de lo que ya existe (sin escribir nada)

| Dato | De dónde | Para qué |
|---|---|---|
| `anio_en_curso`, `nombre`, `estado`, `hasta_periodo` (`k`), `calculando_desde`, `calculado_at`, `cerrada_at`, `cerrada_por_nombre`, `usuario_nombre`, `resumen.version_metodo`, `resumen.gm_con_nino`, `resumen.desvio_prueba_anterior_pct`, `parametros.bloques` de `Y` y `Y+1` (cada tienda trae su `clave` de pertenencia de cinco posiciones, que da `M(Y−3)` a `M(Y+1)`; no hay un mapa `claves` aparte, M10), `parametros.crecimiento_objetivo_pct`, `parametros.umbral_cola_larga`, **`parametros.crecimiento_resto_usado`** (el Resto **aplicado** por el último cálculo: `pct`, `sobre_base`, `version`, `crecimiento_id`, `por_nombre`, `at`; **no** `crecimiento_pct_defecto`, que es el Resto provisional y nunca se sobrescribe) | `proyecciones` | Cabecera, quién cerró, conjuntos de tiendas `M(Z)` de 2023 a 2027, precisión del método, objetivo global y crecimiento declarado del Resto |
| Registros activos de filas activas: `anio`, `bloque`, `subbloque`, `vendido`, `propuesto`, `decidido`, `origen`, `decision_lote_id`, `decision_ia_fila_id`, `decidido_por_nombre`, `decidido_at`, `propuesta_al_decidir`, `meses`, `meses_propuestos`, `base_siguiente` (`B`), `base_normalizada` (`B'`); de la fila: `clave`, `gml_id`, `equivalencia_id`, `agrupacion_marca_id`, `tienda_id`, `temporada`, `factores_mes`, `participaciones->'por_marca'` | `proyeccion_fila_anios` ⋈ `proyeccion_filas`, **dentro de `tablero_proyeccion` y `huella_proyeccion`** | Series, puente, decisiones, exposición a factores, «2026 sin Niño» |
| Para lo que bloquearía el cierre (solo en trabajo): `propuesto`, `decidido`, `avisos` de los registros base | `leerFilasConAnios(…, { columnas: "ligeras", tiendaId: null, soloActivas: true })`, **la misma lectura que usa `cerrarProyeccion`** | `filaBloqueaCierre` (D12) |
| `proyeccion_tiendas` activas (`decidido`, `propuesto`, `venta_esperada_usada`, `bloque`, `anio`) | `leerTiendasProyeccion` | `tiendas_sin_decidir` (vía `motivoRechazoCerrar`) y la huella |
| `proyeccion_crecimientos` activos (`pct`, `sobre_base`, `version`, `crecimiento_id`); versiones de `crecimientos_genero_mundo` del año `Y+1` (vigentes y reemplazadas: `version`, `estado`, `aprobada_at`, `usuario_nombre`, `nota`, `base_valor`) | lecturas pequeñas con `leerTodo` | Crecimiento declarado, anomalías del crecimiento |
| Factores del Niño de `Y` y su estado | `factores_volumen_atipico` + `estadoFactorY` (`src/lib/proyeccion/factor-nino.ts`), sin modificar | Exposición a factores provisionales |
| Años del Niño | `periodos_atipicos` activos | Rótulos (D14) |
| Venta, soles y stock por mes, tienda y dimensión | `venta_stock_vigente` (cargas publicadas), **dentro de `tablero_venta`** | Líneas reales, soles reales, precio medio, stock, tendencia |
| Aprobaciones | `aprobaciones_direccion` | Estado, historial, última aprobada |
| Catálogo (géneros, mundos, líneas, nodos, agrupaciones de marca, unidades de marca, tiendas) | `cargarCatalogo` (`src/lib/proyeccion/contexto.ts`) y `leerTodo` sobre las tablas de M2 y M4 | Filtros y nombres |

**No lee** `historico` de las filas, `ia_*`, costo ni compras.

### 2.3 Cuatro funciones

Todas: `language sql stable` salvo la d; `security invoker`; `set search_path = ''`; `revoke execute … from public, anon, authenticated`; `grant execute … to service_role`; `comment on function`. Las listas de ids entran como arreglos dentro del `jsonb` (`array(select jsonb_array_elements_text(p -> 'gml_ids'))::uuid[]`), sin SQL dinámico. Una clave ausente o `null` = sin filtro en esa dimensión.

#### a) `huella_proyeccion(p_proyeccion_id uuid) returns text`

`md5` de un texto canónico armado **por contenido** (D9). Cada campo se escribe con `coalesce(campo::text, '~')`; los campos de una línea van unidos por `'|'`, las líneas por `E'\n'` y cada línea empieza con su etiqueta. Orden total determinista:

0. `v|1`: primera línea, la **versión de la fórmula de la huella** (ver abajo).
1. `p|anio_en_curso|hasta_periodo|version_metodo` (de `proyecciones`; **no** `id`, `nombre`, `estado`, `nota`, `cerrada_at` ni `updated_at`).
2. Por cada tienda de `parametros.bloques` (cada año presente, hoy `Y` y `Y+1`; grupos `mismas`, `nuevas`, `cierres`, `fuera`): `b|anio|grupo|subbloque|tienda_id|clave`, ordenadas por `(anio, grupo, tienda_id)`. **Solo pertenencia**: renombrar una tienda o cambiar su zona no cambia la huella (M4).
3. Por cada registro activo de fila activa: `f|clave|anio|bloque|subbloque|propuesto|vigente|B|B'|meses`, ordenados por `(clave, anio)`; `vigente = coalesce(decidido, propuesto)`; `meses` como texto del arreglo. Se usa la `clave` de la fila (única por proyección, `0018`) y no `fila_id`, para que dos copias con las mismas cifras den la misma huella. **`clave` lleva dentro el mismo separador** (`tienda|gml|equivalencia|am`, p. ej. `|<gml>||<am>` en una fila base): el texto sigue sin ambigüedad porque `clave` tiene **siempre tres `|`** (cuatro partes, vacías o no) y cada línea tiene etiqueta y número fijo de campos; no se escapa. El comentario de la función lo dice (M-C).
4. Por cada `proyeccion_tiendas` activa: `t|tienda_id|anio|coalesce(decidido, propuesto)`, por `(tienda_id, anio)`.
5. Por cada `proyeccion_crecimientos` **activo**: `c|genero_id|mundo_id|pct|sobre_base`, por `(genero_id, mundo_id)`; y una línea del **Resto aplicado**, `r|pct|sobre_base` de `parametros->'crecimiento_resto_usado'` (`'~'` en cada campo si la clave no existe: proyecciones calculadas antes de `0.12.1`). **No** `crecimiento_pct_defecto` (es el Resto provisional, que solo se fija al crear y no mueve ninguna cifra; I-A), ni `version`, `crecimiento_id`, `por_nombre` o `at` del Resto (no son cifras).

Devuelve 32 caracteres hexadecimales, o `null` si la proyección no existe. Entra todo lo que mueve una cifra que dirección ve (mensual, puente, crecimiento declarado); no entran estado, nombre, notas, autores ni fechas: **cerrar sin cambiar cifras no invalida** (R12). `md5` porque es nativo y detecta cambios (no es un control contra un atacante: quien escribe la proyección ya es planner). Medido sobre la proyección actual: 31 ms con ≈ 6 130 registros.

**Versión de la fórmula (I-B).** La fórmula queda **congelada** en cuanto exista una aprobación: cualquier `create or replace` que cambie el texto canónico (añadir o quitar un campo, cambiar un orden o un formato) cambia la huella de **todas** las proyecciones y deja invalidada toda aprobación vigente, también la de la cerrada que usa Compras (los avisos de §4.11 se encienden a la vez en todas). Regla: **cambiar la fórmula es un cambio de contrato**; solo se hace con una decisión explícita registrada en `docs/DECISIONES.md`, y entonces sube la versión de la primera línea (`v|1` → `v|2`) y la constante `VERSION_HUELLA` de `src/lib/direccion/tipos-api.ts`, en el mismo commit (prueba estática: la última migración que define `huella_proyeccion` lleva la primera línea `v|<VERSION_HUELLA>`). El servidor guarda la versión con que se registró cada aprobación en `resumen.huella_version` (sin columna nueva); si difiere de `VERSION_HUELLA`, el tablero muestra esa aprobación como «invalidada por un cambio en el cálculo de la huella» en vez de «la proyección cambió». El comentario de la función repite la regla.

#### b) `tablero_proyeccion(p_proyeccion_id uuid, p jsonb) returns jsonb`

- **Entrada `p`:** `{ "gml_ids": uuid[] | null, "agrupacion_marca_ids": uuid[] | null, "unidad_marca_id": uuid | null, "temporadas": ("invierno"|"verano"|"todo_el_ano"|"sin_temporada")[] | null, "desglose": "genero"|"mundo"|"linea"|"agrupacion_marca"|"marca"|"temporada"|"tienda" | null }`. **No recibe tiendas:** la proyección de las mismas tiendas no está por tienda; el servidor atribuye (§3.4) y recorta.
- **Filtros:** GML, AM y temporada sobre la fila (`gml_id`, `agrupacion_marca_id`, `temporada`; `sin_temporada` = `temporada is null`). Unidad de marca: cada registro se multiplica por la participación de esa unidad en `participaciones->'por_marca'` de **su fila base** (la misma `(gml_id, equivalencia_id, agrupacion_marca_id)` sin tienda, como hace M8 con las filas de tienda); si esa fila base no trae `por_marca`, su vigente va a `sin_participacion_marca` y no a la serie. Las multiplicaciones van en `numeric` y se redondean **una sola vez**, al final, por mes.
- **Salida (forma exacta, claves cortas, orden determinista):**

```jsonc
{
  "huella": "32 hex",                 // la de §2.3 a, calculada en la MISMA sentencia (D10)
  "anios": [ {                         // Y y Y+1, siempre los dos
    "anio": 2027,
    "base": {                          // registros de filas sin tienda (bloque mismas)
      "meses": [12 enteros], "vigente": n, "propuesto": n, "vendido": n, "sin_meses": n,
      "B": n | null, "B_corr": n | null,           // solo Y+1: Σ base_siguiente y Σ base_normalizada de registros con B no nulo
      "vigente_con_B": n, "propuesto_con_B": n,     // solo Y+1: lo mismo restringido a registros con B no nulo
      "vigente_sin_B": n,                            // solo Y+1: registros base sin B (otro método); va aparte en el puente
      "delta_manual": n, "delta_otras": n,           // solo Y+1 (I-C): Σ(vigente − propuesto) de registros con B, partida en «fijado a mano» y el resto
      "meses_sin_nino": [12 números] | null          // solo Y: Σ meses_m ÷ φ_Y,m de la fila (φ de factores_mes[Y]; 1 si no hay)
    },
    "tiendas": [ { "t": uuid, "bloque": "nuevas"|"cierres", "subbloque": "nuevas_anterior"|"aperturas"|null,
                   "meses": [12], "vigente": n, "sin_meses": n,
                   "para_base": n } ],               // solo Y y solo tiendas de bloques[Y+1].mismas: vigente de sus filas de tienda cuya fila base tiene B no nulo en Y+1 (= vigentesDeTiendasNuevas.paraBase de 07f)
    "decisiones": {                                  // clasificación excluyente, en este orden: lote > ia > origen > sin decidir
      "lote": { "n": n, "u": n }, "ia": {…}, "propuesta": {…}, "manual": {…}, "escalada": {…}, "sin_decidir": {…},
      "autores": [ { "nombre": text, "n": n, "u": n, "desde": "aaaa-mm-dd", "hasta": "aaaa-mm-dd" } ],   // por decidido_por_nombre, fechas en Lima
      "dia_pico": { "fecha": "aaaa-mm-dd", "n": n } | null },
    "conteos": { "registros": n, "propuesta_cambio": n, "curva_cambio": n } } ],
  "por_gm": [ { "g": genero_id, "m": mundo_id,      // SIEMPRE de toda la proyección, sin filtros (tabla de crecimientos, puente por GM, resumen)
    "Y":  { "cierre": n, "base": n, "fuera_base_exacto": n,
            "base_meses": [12 enteros], "base_meses_sin_nino": [12 números] },   // I-E: Σ meses_m y Σ meses_m ÷ φ_Y,m de los registros base de Y del GM
    "Y1": { "B": n, "B_corr": n, "propuesto_con_B": n, "vigente_con_B": n, "vigente_sin_B": n, "delta_manual": n, "delta_otras": n,
            "nuevas_anterior": n, "aperturas": n, "cierres": n, "total": n } } ],
  "por_dim": [ { "d": id_o_texto, "Y": { "base": n, "base_resto": n, "tiendas": [[uuid, n]] }, "Y1": { "base": n, "tiendas": [[uuid, n]] } } ] | null,
  "por_temporada": [ { "temporada": text | null, "Y1": n, "Y1_con_factor_Y": n } ],   // Y1_con_factor_Y: 2027 de filas base con algún φ_Y,m ≠ 1
  "por_par": { "gml": [uuid], "am": [uuid], "filas": [[i_gml, i_am, y_resto, y1]] },  // para valorizar en soles (D2); y_resto = proyectado k+1..12 de Y
  "mayores": [ { "clave": text, "gml_id": uuid, "am_id": uuid, "Y1": n, "B": n | null } ],  // las 20 filas base de mayor vigente en Y+1 del recorte
  "sin_participacion_marca": { "Y": n, "Y1": n } | null
}
```

  `delta_manual` (Y+1, en `base` y en `por_gm.Y1`) = `Σ (vigente − propuesto)` de los registros base con `B` no nulo **clasificados `manual`** (`origen = 'manual'`, sin `decision_lote_id` ni `decision_ia_fila_id`: la misma clasificación excluyente de `decisiones`); `delta_otras` = `(vigente_con_B − propuesto_con_B) − delta_manual`: aceptadas en lote o por IA sobre una propuesta que cambió después al recalcular, escaladas, aceptadas tal cual con otra propuesta, etc. Suman lo mismo que antes, así que R4 no cambia (I-C). `base_meses` y `base_meses_sin_nino` (Y, por GM, sin filtros) son lo mismo que `anios[Y].base.meses` y `meses_sin_nino` restringido al GM; solo los usa la tendencia corregida de §4.5 (I-E): ≈ 15 GM × 24 números.
  `fuera_base_exacto` (Y) = vigente de las filas de tienda de `Y` menos el `para_base` de las tiendas que entran (lo que queda fuera de la base de `Y+1`: aperturas de `Y` que siguen fuera, cierres de `Y`, filas cuya fila base no tiene `B`); la pertenencia sale de `parametros.bloques`; `base_resto` (Y) = proyectado de `k+1` a 12 de los registros base. `propuesta_cambio` cuenta registros decididos con `propuesto ≠ propuesta_al_decidir`; `curva_cambio`, registros con `meses_propuestos` no nulo. `d` es `genero_id`, `mundo_id`, `gml_id` (línea), `agrupacion_marca_id`, `unidad_marca_id` (estimado con `por_marca`), la temporada o, con `desglose = tienda`, se omite `por_dim` (la tienda sale de `tiendas` y de la atribución).
- **Tamaño medido para dimensionar:** ≈ 6 130 registros, 567 nodos; ≈ 75 ms la agregación. Documento ≤ 60 KB sin desglose y ≤ 120 KB con `desglose = linea` (567 × 2 años × 3 números más los pares de tienda).

#### c) `tablero_venta(p jsonb) returns jsonb` — con `set work_mem = '16MB'` (como las lecturas pesadas de la `0037`)

- **Entrada `p`:** `{ "gml_ids", "agrupacion_marca_ids", "unidad_marca_id", "tienda_ids", "temporadas", "proyeccion_id": uuid | null, "desde": "aaaa-mm-01", "hasta": "aaaa-mm-01", "k": 1..12, "k_prima": 1..12, "desglose": … | null, "solo_tendencia": boolean }`. El backend pide de enero de `Y−3` al último mes publicado `k'` (≤ 48 meses).
- **Qué lee.** `venta_stock_vigente` ⋈ `tiendas` ⋈ `equivalencias` (nodo de planificación, la misma correspondencia que `venta_proyeccion`, 07 §5) ⋈ `marcas_unidad` ⋈ `marcas` (AM = la de la **unidad**: `join marcas_unidad mu on mu.marca_id = v.marca_id join marcas cab on cab.id = mu.unidad_marca_id`). Venta y soles **solo de `tipo = 'Tienda'`**; el CD solo entra en `stock.cd`. Columnas: `unidades`, `venta_soles` y, solo para el mes `k'`, `stock_unidades`. Nunca `costo_vendido` ni `stock_valorizado` (prueba estática).
- **Filtros.** GML y AM como arriba; unidad de marca sobre `mu.unidad_marca_id` (todas las marcas de la unidad); temporada por **semiunión con las filas base activas de `proyeccion_id`** con esa temporada sobre `(nodo, equivalencia si el nodo es GMLE, AM)` (la venta sin fila en la proyección queda fuera con ese filtro y se cuenta en `fuera_universo`); `tienda_ids` **solo** recorta `por_dim`, `precios` y `stock`: `por_tienda` trae siempre todas las tiendas del recorte, porque la atribución las necesita a todas.
- **Salida:**

```jsonc
{
  "periodos": { "aaaa-mm": carga_id },                         // meses publicados en [desde, hasta]
  "tiendas": [uuid],                                           // índice de las tuplas
  "por_tienda": [[i_t, "aaaa-mm", u, s]],                      // ≤ 15 × 48 tuplas; sin CD
  "por_dim": { "ids": [id], "filas": [[i_d, u_Y-3, u_Y-2, u_Y-1, u_ac_ant, u_ac_cur, s_Y-1, s_ac_cur]] } | null,   // ac = ene–k' de Y−1 y de Y
  "precios": { "gml": [uuid], "am": [uuid], "filas": [[i_gml, i_am, u12, s12]] },   // 12 meses de k'−11 a k'
  "stock": { "periodo": "aaaa-mm", "por_tienda": [[i_t, u]], "cd": n | null },     // cd null si hay tienda_ids
  "tendencia_gm": [[genero_id, mundo_id, i_t, u_ac_cur, u_ac_ant]] | null,         // solo con solo_tendencia: SIN filtros, ene–k' de Y y de Y−1
  "fuera_universo": [[anio, u]] | null                                             // solo con proyeccion_id
}
```

  Con `solo_tendencia = true` devuelve solo `periodos`, `tiendas` y `tendencia_gm` (la usa la alerta «contra la tendencia», siempre de toda la empresa; se cachea aparte). `fuera_universo` no se muestra en pantalla: va en una línea del Excel (M6).
- **Tamaño:** ≤ 150 KB con `desglose = linea` (576 nodos × 8 números; `precios` ≈ 1 600 pares con índices); ≤ 60 KB sin desglose. El tamaño se resuelve en el contrato, no con una tabla nueva (B3).

#### d) `registrar_aprobacion_direccion(p jsonb) returns jsonb` — `language plpgsql volatile`

Entrada: `{ proyeccion_id, huella_vista, resultado, motivo, comentario, resumen, perfil_id, usuario_nombre, rol }`, ya validada por zod; perfil, nombre y rol los pone el servidor desde la sesión. En una transacción:

1. `select … from public.proyecciones where id = … and activo for share`: impide que otra sesión cierre, archive o borre la proyección mientras se registra (choca con el `update` de `cerrar` y con el `for no key update` de `aplicar_lote_proyeccion`; verificado por el revisor). **No** frena las decisiones fila a fila de M7, que escriben `proyeccion_fila_anios` sin tocar `proyecciones`: una que haga commit entre el paso 3 y el 4 deja una aprobación que **nace invalidada** (su huella ya no es la actual). Es un fallo seguro —nunca queda aprobado algo que no se vio— y el tablero lo muestra al recargar (M-A, R16).
2. Si no existe **o tiene `activo = false`** → `{ "error": "no_encontrada" }` (M-B); `estado = 'archivada'` → `archivada`; `calculando_desde` de menos de 15 minutos (`CALCULO_CADUCA_MIN`) → `calculo_en_curso`; `resumen is null` → `sin_calcular`.
3. `h := public.huella_proyeccion(id)`. Si `h ≠ huella_vista` o `h ≠ p->'resumen'->>'huella'` → `{ "error": "huella_distinta", "huella_actual": h }` **sin insertar**.
4. `insert into public.aprobaciones_direccion …` con `huella = h` y `estado_proyeccion` del paso 1; devuelve la fila como `jsonb`.

Los códigos vuelven **en el `jsonb`, sin `raise`**, para que el handler los traduzca a `404`/`409` sin interpretar mensajes. (Se aparta a propósito de `aplicar_lote_proyeccion`, que usa `raise` con `LP001`–`LP007`; M2.) Es la **única** función que escribe en `aprobaciones_direccion`; el servidor no hace `insert` directo (prueba estática).

### 2.4 Rendimiento

**Mediciones de partida (revisor, solo lectura sobre `vector-two`).** ≈ 6 130 registros por proyección; huella 31 ms; agregación de la proyección ≈ 75 ms; agregación de venta sin filtros con preagregado por `(equivalencia, marca, tienda, periodo)`: 2,17 s con `work_mem` por defecto y 1,95 s con 16 MB, antes de armar el `jsonb`.

**Caché en proceso** (`src/lib/direccion/cache.ts`, patrón de `src/lib/curvas/cache-venta-tienda.ts`): clave de venta = huella de cargas + huella de maestros (equivalencias → nodo, marcas → unidad → AM, tiendas → tipo; md5 de ids y FKs en una lectura pequeña) + filtros canónicos; clave de proyección = `(proyeccion_id, huella, filtros)`; LRU de 24 entradas, TTL de seguridad 5 min, *single-flight*, nunca guarda una lectura si la huella cambió en medio. La tendencia (`solo_tendencia`) tiene su propia entrada, que solo cambia con una carga nueva. Supuesto: una sola instancia en Railway (como las demás cachés).

**Puerta de medición (la corre `datos` en la tanda 1, antes de que `backend` empiece la tanda 2):** `explain (analyze, buffers)` de `tablero_venta` completa (con `jsonb`) en `vector-two`, dos pasadas (frío y caliente), en cinco casos: (1) sin filtros y `desglose = linea`; (2) sin filtros y `desglose = marca`; (3) una AM; (4) una unidad de marca y una tienda; (5) `solo_tendencia`. Se anotan al pie de la migración tiempo y tamaño del documento.
- **Criterio de tiempo** (separado del de tamaño, B3): si (1) o (2) pasan de **2,5 s en frío**, `datos` reescribe en la misma migración el preagregado para **no agrupar por marca cuando no hay filtro ni desglose de AM, de unidad de marca ni de temporada** (es lo que hoy cuesta ≈ 600 mil grupos; `precios` se calcula aparte, solo sobre 12 meses), y vuelve a medir. Si aún pasa de 2,5 s, lo anota y se apoya en la caché; **no** se crea una tabla de agregados en M14 (D13): esa tabla tendrá su propia ficha.
- **Criterio de tamaño:** el documento de (1) ≤ 150 KB; si no se cumple, es un error del contrato, no de rendimiento, y vuelve a `datos`.

**Presupuesto de la pantalla:** primera carga (opciones + tablero) **≤ 3 s en frío y ≤ 1 s en caliente**; cambio de filtro **≤ 2,5 s en frío y ≤ 300 ms con caché**; `GET /api/direccion/tablero` **≤ 250 KB** con `desglose = linea` (≤ 120 KB sin desglose); `GET /api/direccion/bloqueos` ≤ 2 s (carga el contexto de cálculo de M7; solo en trabajo); registrar una aprobación ≤ 1,5 s. Ninguna sentencia cerca de los 8 s de PostgREST.

### 2.5 Diagrama

```
venta_stock_vigente ─► tablero_venta(filtros) ──────────────┐  caché: cargas + maestros + filtros
  (Tienda: u y S/; CD: solo stock de k')                     │
                                                              ├─► src/lib/direccion (TS puro) ─► GET /api/direccion/tablero ─► pantalla
proyeccion_filas ⋈ proyeccion_fila_anios ─► tablero_proyeccion(id, filtros) ─┤   atribución por tienda (atribuirBase de 07f + atribuirMensual),
   (incluye huella_proyeccion en la misma sentencia)                          │   puente, comparativos, soles y cobertura, alertas
crecimientos, factores (estadoFactorY), periodos_atipicos, aprobaciones ─────┘
M7 (leerFilasConAnios, desactualizadaDe, bloqueosNinoDe, crecimientosDeHoy) ─► motivoRechazoCerrar en bucle (args de cerrar) / filaBloqueaCierre ─► GET /api/direccion/bloqueos
huella_proyeccion(id) ─► registrar_aprobacion_direccion(p) ─► aprobaciones_direccion (solo inserción) ◄─ POST /api/direccion/aprobaciones (requireAdmin)
```

## 3. Contratos de API

Convenciones de M1 a M8: `ok` / `error` / `errorConCodigo` / `leerCuerpo` (`src/lib/api/respuestas.ts`), `traducirErrorDb`, `leerTodo` solo para tablas pequeñas. **Cada handler empieza con su guard como primera sentencia** (prueba estática, como `tests/api.guards.roles.test.ts`). Datos solo con `supabaseAdmin()` desde el servidor. Handlers en `src/app/api/direccion/`; lógica pura en `src/lib/direccion/` (`tipos-api.ts` autocontenido, `esquemas.ts`, `atribucion.ts`, `puente.ts`, `comparativos.ts`, `apoyo.ts`, `alertas.ts`, `aprobacion.ts`, `tablero.ts`); entrada y salida de datos solo en `src/lib/direccion/consultas.ts`, **único archivo que nombra `tablero_venta`, `tablero_proyeccion`, `huella_proyeccion`, `registrar_aprobacion_direccion` y la tabla `aprobaciones_direccion`** (prueba estática); orquestación en `src/lib/direccion/servicio.ts` y `src/lib/direccion/cierre.ts`; caché en `src/lib/direccion/cache.ts` (sin `@supabase/*`). Errores: `401` sin sesión · `403` rol · `400` zod o filtro incoherente · `404` · `409` regla · `500` (`fallaDb`, sin detalles de la base).

**Se reutiliza sin modificar:** de `src/lib/proyeccion/`: `atribuirBase` (07f, decisión 111), `filaBloqueaCierre`, `motivoRechazoCerrar`, `estadoFactorY`, `correccionMaterial`, `generosDeMatriz`, `claveGM`, `calculoEnCurso`, `leerFilasConAnios`, `leerTiendasProyeccion`, `cargarContextoCalculo`, `desactualizadaDe`, `crecimientosDeHoy`, `ninoDeFilas`, `bloqueosNinoDe`, `bloqueosNinoDeCierre`, `esMetodoVigente`, `parametrosDe`, `comoAvisos`; de `src/lib/crecimientos/consultas-vigentes.ts`: `leerVigentes`; de `src/lib/curvas/anios.ts`: `hastaPorDefecto`; de `src/lib/flujo/filas.ts`: `planHorizonte`; `src/lib/curvas/grafico.ts`. **No se toca ningún archivo de 07f, M7 ni M8**, salvo la traducción `409 tiene_aprobaciones` del `DELETE` de proyecciones (§3.1) y las dos líneas de aviso (§4.11).

### 3.1 Rutas

| Ruta | Método | Guard | Entrada | Respuesta `{ data }` y errores |
|---|---|---|---|---|
| `/api/direccion/opciones` | GET | `requirePlanner` | — | `OpcionesTableroApi` (§3.3): proyecciones no eliminadas con estado, `cerrada_at`, `cerrada_por_nombre` y estado de dirección; **`por_defecto`** (la cerrada que usa Compras con la regla de M8: `k' = hastaPorDefecto(publicados, hoyLima())`, `planHorizonte(k', años con cerrada).anio_cerrada`; si no hay, la en trabajo más reciente; si no hay, `null`); **`comparar_por_defecto`** (la proyección de la aprobación más reciente con resultado `aprobada` o `con_observaciones`, si no es la mostrada); géneros (con `es_resto`: fuera de `generosDeMatriz`), mundos, líneas (`genero_id`, `mundo_id`), temporadas, AM (orden de M2), **unidades de marca agrupadas por la AM de la unidad** (activas o con venta), tiendas `tipo = 'Tienda'` (id, código, nombre, apertura, cierre, activa). No lee venta. |
| `/api/direccion/tablero` | GET | `requirePlanner` | query `tableroQuerySchema` (§3.2) | `200 TableroApi` (§3.3). `400` filtros mal formados, `linea_id` sin un solo género y un mundo, `400 marca_fuera_de_agrupacion` (unidad de marca de otra AM que las elegidas), `400 comparar_igual`; `404 proyeccion_no_encontrada` (también la comparada); `409 sin_calcular` («Calcula la proyección para verla en el tablero»); `409 calculo_en_curso` (mensaje de M7); `409 sin_proyeccion` (no hay ninguna para abrir por defecto); `500`. Una **archivada** se ve (solo lectura, `puede_aprobar = false`). |
| `/api/direccion/bloqueos` | GET | `requirePlanner` | `?proyeccion_id=<uuid>` | `BloqueosCierreApi` (§3.3): **solo en trabajo**; en cerrada o archivada `{ aplica: false }`. Se pide aparte del tablero porque carga el contexto de cálculo de M7 (§3.5). `404`, `409 calculo_en_curso`. |
| `/api/direccion/aprobaciones` | GET | `requirePlanner` | `?proyeccion_id=<uuid>` | `{ huella_actual, estado: EstadoAprobacion, vigente: AprobacionApi \| null, historial: AprobacionApi[] }` (más reciente primero; cada una con `invalidada` = su huella ≠ la actual). `400`, `404`. |
| `/api/direccion/aprobaciones` | POST | **`requireAdmin`** | `aprobarSchema` (§3.2) | `201 AprobacionApi`. `403` planner y comprador; `400` zod (motivo y comentario obligatorios si no es `aprobada`; `confirmo_revision` debe ser `true`); `404 proyeccion_no_encontrada`; **`409 huella_distinta`** («La proyección cambió mientras la mirabas: vuelve a cargar el tablero», con `huella_actual`) si la lectura sin filtros que arma el `resumen` trae una huella distinta de `huella_vista` (se responde **antes** de llamar a `registrar`), o si la función la detecta; `409 archivada`; `409 calculo_en_curso`; `409 sin_calcular`; `500`. |
| `/api/direccion/estado` | GET | `requirePlanner` | `?proyeccion_id=<uuid>` **o** `?para=compras` | `EstadoDireccionApi` (§3.3): la proyección (con `para=compras`, la cerrada que usa el flujo, misma regla que `por_defecto`), quién la cerró y cuándo, estado de dirección, la vigente y la **diferencia con la última aprobada** (o «idéntica»). Lectura barata para los avisos de §4.11: una consulta de aprobaciones + `tablero_proyeccion(id, {})` cacheada por huella. `404`; con `para=compras` y sin cerrada: `{ proyeccion: null }`. |
| `/api/proyeccion/proyecciones/[id]` | DELETE | (el de M7) | — | **Cambio mínimo en M7:** la FK `restrict` se traduce a `409 tiene_aprobaciones` («Esta proyección tiene aprobaciones de dirección: archívala en lugar de eliminarla»). |

Ninguna ruta `GET` tiene efectos; la única mutación es el `POST`. No hay `PUT`, `PATCH` ni `DELETE` de aprobaciones. No hay ruta de descarga: el Excel se arma en el navegador (§4.9).

### 3.2 Esquemas (`src/lib/direccion/esquemas.ts`, zod 4)

```ts
const uuid = z.string().uuid();
const TEMPORADAS = ["invierno", "verano", "todo_el_ano", "sin_temporada"] as const;
// En la query (GET) las listas llegan como texto separado por comas.
const listaQuery = <T extends z.ZodTypeAny>(item: T, max: number) =>
  z.string().transform((s) => s.split(",").filter(Boolean)).pipe(z.array(item).max(max));

// Objeto SIN refinamientos: de aquí salen la query y `filtros_vistos` (M1: `.partial()` no se puede llamar sobre un objeto refinado).
const filtrosQueryBase = z.object({
  proyeccion_id: uuid.optional(),                      // ausente = por_defecto de /opciones
  comparar_id: z.union([uuid, z.literal("ninguna")]).optional(),   // ausente = comparar_por_defecto; "ninguna" = sin comparar
  generos: listaQuery(uuid, 20).optional(),            // varios a la vez
  resto: z.enum(["1"]).optional(),                     // atajo: suma a `generos` los géneros del Resto (fuera de generosDeMatriz)
  mundo_id: uuid.optional(),
  linea_id: uuid.optional(),                           // exige un solo género (sin «resto») y mundo_id
  temporadas: listaQuery(z.enum(TEMPORADAS), 4).optional(),
  am: listaQuery(uuid, 40).optional(),                 // agrupaciones de marca, primer nivel
  marca: uuid.optional(),                              // UNA unidad de marca en 0.19.0; su AM se deduce (si hay `am`, debe estar entre ellas)
  tiendas: listaQuery(uuid, 30).optional(),
  bloque: z.enum(["todas", "mismas", "nuevas", "cierres"]).default("todas"),
  desglose: z.enum(["genero", "mundo", "linea", "agrupacion_marca", "marca", "temporada", "tienda"]).default("mundo"),
});
export const tableroQuerySchema = filtrosQueryBase.superRefine((v, ctx) => {
  /* linea_id ⇒ generos.length === 1, sin resto, y mundo_id; comparar_id ≠ proyeccion_id ⇒ si no, "comparar_igual" */
});

// En el cuerpo JSON (POST) las listas son arreglos, no texto.
const filtrosVistosSchema = z.object({
  generos: z.array(uuid).max(20), resto: z.boolean(), mundo_id: uuid.nullable(), linea_id: uuid.nullable(),
  temporadas: z.array(z.enum(TEMPORADAS)).max(4), am: z.array(uuid).max(40), marca: uuid.nullable(),
  tiendas: z.array(uuid).max(30), bloque: z.enum(["todas", "mismas", "nuevas", "cierres"]),
}).partial();

export const MOTIVOS_DIRECCION = ["crecimiento_alto", "crecimiento_bajo", "contra_tendencia", "tiendas_nuevas", "nino",
  "filas_sin_decidir", "concentracion", "otro"] as const;

export const aprobarSchema = z.object({
  proyeccion_id: uuid,
  huella_vista: z.string().regex(/^[0-9a-f]{32}$/),    // la que trajo el GET del tablero
  resultado: z.enum(["aprobada", "con_observaciones", "rechazada"]),
  motivo: z.enum(MOTIVOS_DIRECCION).nullable(),
  comentario: z.string().trim().max(1000).nullable(),
  confirmo_revision: z.literal(true),                  // «Revisé las alertas y las cifras de toda la proyección»
  filtros_vistos: filtrosVistosSchema.optional(),      // informativo; la aprobación es siempre de la proyección entera
}).superRefine((v, ctx) => { /* resultado ≠ "aprobada" ⇒ motivo no nulo y comentario con ≥ 10 caracteres */ });
```

El servidor convierte los filtros en `gml_ids` desde el catálogo (géneros × mundo × línea → nodos, como 07f) y los manda dentro del `jsonb` de cada función. `filtros_vistos` **no** se guarda en una columna: va dentro de `resumen.filtros_vistos`.

### 3.3 Tipos (`src/lib/direccion/tipos-api.ts`, autocontenido)

```ts
export type Exactitud = "exacto" | "estimado";
export type Bloque = "todas" | "mismas" | "nuevas" | "cierres";

export type SerieMensualApi = { clave: string; etiqueta: string; anio: number;
  tipo: "real" | "real_parcial" | "proyectado" | "sin_nino" | "comparada" | "aprobada";
  nino: boolean;                                    // año del Niño según periodos_atipicos (D14)
  meses: (number | null)[];                         // 12; null = sin dato (futuro, sin carga o sin atribución mensual)
  total: number | null; exactitud: Exactitud };

export type ClavePuente = "cierre_en_curso" | "fuera_base" | "ajuste_base" | "base" | "nino" | "crecimiento" | "manual" | "otras"
  | "sin_base" | "mismas_siguiente" | "nuevas_anterior" | "aperturas" | "cierres" | "total_siguiente";
export type PuenteApi = { lineas: { clave: ClavePuente; etiqueta: string; u: number; acumulado: number; subtotal: boolean }[];
  pct: { base_sobre_real: number | null; nino: number | null; crecimiento: number | null; manual: number | null; otras: number | null; total_vs_cierre: number | null } };

export type ComparativoApi = { clave: "sig_vs_cierre" | "sig_vs_anterior" | "cierre_vs_anterior" | "cierre_vs_hace_dos" | "ac_vs_ac" | "anterior_vs_hace_dos";
  etiqueta: string;                                 // «2027 vs 2025 (último año normal)», «2026 ene–oct vs 2025 ene–oct»
  nino: boolean;                                    // algún año del par es del Niño
  total: { pct: number | null; motivo: null | "sin_base" | "incompleto" | "nueva" };
  mismas: { pct: number | null; tiendas: string[]; motivo: null | "sin_base" | "incompleto" } };

export type CrecimientoGMApi = { gm_clave: string; nombre: string;                    // «HOMBRE · URBANO» o «Resto»
  declarado_pct: number | null; sobre_base: "bruta" | "corregida" | null; version: number | null;
  autor: string | null; aprobada_at: string | null; nota: string | null;
  base_real: number | null; base_corregida: number | null; con_nino: boolean;
  siguiente_mismas: number | null; implicito_sobre_real_pct: number | null; implicito_sobre_corregida_pct: number | null;
  desvio_pp: number | null;                         // implícito (en la base del declarado) − declarado
  tendencia_mismas_pct: number | null;              // ene–k' de Y frente a ene–k' de Y−1 en M(Y), sin filtros, en bruto
  tendencia_mismas_corregida_pct: number | null;    // I-E: la misma con la venta de Y dividida por φ (§4.5); = bruta si el GM no tiene corrección
  tendencia_afectada_nino: boolean;                 // la bruta es < 0 y la corregida no: la alerta baja a informativa
  semaforo: "coincide" | "revisar" | "contra_tendencia" | "sin_dato";
  anomalias: ("sin_base" | "reemplazada_mismo_dia" | "sin_nota")[] };

export type DecisionesAnioApi = { anio: number;
  por_origen: { clave: "lote" | "ia" | "propuesta" | "manual" | "escalada" | "sin_decidir"; etiqueta: string; n: number; u: number; pct_u: number }[];
  autores: { nombre: string; n: number; u: number; desde: string; hasta: string }[]; dia_pico: { fecha: string; n: number } | null };

export type CodigoAlerta = "factor_provisional" | "base_corregida_nino" | "contra_tendencia" | "desvio_crecimiento" | "origen_decisiones"
  | "anomalia_crecimiento" | "tienda_nueva_relevante" | "apertura_sin_historia" | "concentracion" | "propuesta_cambio" | "curva_cambio"
  | "sin_curva" | "datos_mas_nuevos" | "metodo_anterior" | "meses_faltantes" | "atribucion_estimada" | "atribucion_sin_mensual"
  | "marca_estimada" | "comparada_distinta_k" | "distinta_de_aprobada";
export type AlertaApi = { codigo: CodigoAlerta; nivel: "importante" | "info"; alcance: "proyeccion" | "recorte";
  titulo: string; detalle: string; cifras: Record<string, number | string>; enlace: string | null };

export type BloqueoCierreApi = { codigo: string; mensaje: string; detalle?: Record<string, unknown>;   // codigo y mensaje de motivoRechazoCerrar tal cual
  forzable: boolean };                              // true solo para "desactualizada" («Cerrar de todos modos»)
export type BloqueosCierreApi = { aplica: false } | { aplica: true; puede_cerrar: boolean; puede_forzar: boolean; bloqueos: BloqueoCierreApi[];
  filas: { anio: number; n: number; u: number; por_motivo: { umbral: number; revision_cola_larga: number } }[] };   // conteo con filaBloqueaCierre

export type FilaDesgloseApi = { id: string; nombre: string; exactitud: Exactitud;
  anios: { anio: number; tipo: "real" | "real_parcial" | "cierre" | "proyectado"; total: number | null }[];
  ac_anterior: number | null; ac_en_curso: number | null;
  pct: { sig_vs_cierre: number | null; sig_vs_anterior: number | null; cierre_vs_anterior: number | null; ac_vs_ac: number | null };
  participacion_siguiente: number | null; filtrable: boolean };          // filtrable: al elegirla se aplica como filtro (D11)

export type ApoyoApi = {
  soles: { anios: { anio: number; s: number; tipo: "real" | "real_parcial" | "estimado" }[];
           precio_medio: number | null; ventana: { desde: string; hasta: string }; u_sin_precio: number };
  cobertura: { periodo: string; stock_tiendas: number; stock_cd: number | null;   // null con filtro de tienda
               imi_proyectado: number | null; imi_real: number | null; exactitud: Exactitud } };

export type EstadoAprobacion = "sin_aprobacion" | "aprobada" | "con_observaciones" | "rechazada" | "invalidada";
export type ResumenAprobacionApi = { huella: string; huella_version: number; hasta_periodo: string; version_metodo: number | null;
  totales: { anio: number; total: number; por_bloque: Record<"mismas" | "nuevas_anterior" | "aperturas" | "cierres", number> }[];
  puente: PuenteApi; por_gm: { gm_clave: string; nombre: string; en_curso: number; siguiente: number; declarado_pct: number | null; implicito_pct: number | null }[];
  alertas: { codigo: string; nivel: string; cantidad: number }[]; filtros_vistos?: Record<string, unknown> };
export type AprobacionApi = { id: string; proyeccion_id: string; estado_proyeccion: "en_trabajo" | "cerrada";
  resultado: "aprobada" | "con_observaciones" | "rechazada"; motivo: string | null; comentario: string | null;
  usuario_nombre: string; rol: "admin"; created_at: string; huella: string; invalidada: boolean;
  invalidada_por: "cifras" | "version_huella" | null;   // version_huella: resumen.huella_version ≠ VERSION_HUELLA (§2.3 a)
  resumen: ResumenAprobacionApi };
export type DiferenciaAprobadaApi = { aprobacion_id: string; proyeccion_id: string; proyeccion_nombre: string; misma_proyeccion: boolean;
  fecha: string; usuario_nombre: string; resultado: "aprobada" | "con_observaciones"; identica: boolean;   // identica = misma huella
  en_curso: { aprobado: number; actual: number; u: number; pct: number | null };
  siguiente: { aprobado: number; actual: number; u: number; pct: number | null };
  por_gm: { gm_clave: string; nombre: string; aprobado: number; actual: number; u: number; pct: number | null }[] };   // de 2027, ordenado por |u|; un GM ausente en uno de los dos lados cuenta 0

export type ProyeccionTableroApi = { id: string; nombre: string; estado: "en_trabajo" | "cerrada" | "archivada";
  anio_en_curso: number; anio_siguiente: number; hasta_periodo: string; k: number; version_metodo: number | null;
  cerrada_at: string | null; cerrada_por_nombre: string | null; usa_compras: boolean };
export type EstadoDireccionApi = { proyeccion: ProyeccionTableroApi | null; estado: EstadoAprobacion;
  vigente: Pick<AprobacionApi, "resultado" | "usuario_nombre" | "created_at"> | null; diferencia: DiferenciaAprobadaApi | null };

export type TableroApi = {
  proyeccion: ProyeccionTableroApi;
  comparada: (ProyeccionTableroApi & { motivo: "aprobada" | "elegida"; huella_igual_a_aprobada: boolean | null }) | null;
  datos: { k_prima: number; ultimo_publicado: string; meses_faltantes: string[]; anios_nino: number[] };
  filtros: { texto: string; exactitud: Exactitud; conjunto_tiendas: { etiqueta: string; codigos: string[] } | null };
  decidir: {                                        // SIEMPRE de la proyección entera (no depende de los filtros)
    lineas: string[];                               // 3 a 5 líneas (§4.3)
    estado: EstadoAprobacion; vigente: AprobacionApi | null; diferencia: DiferenciaAprobadaApi | null;
    precision: { desvio_prueba_anterior_pct: number | null; rotulo: "dentro de muestra" };
    objetivo_pct: number | null; puede_aprobar: boolean; alertas_importantes: number };
  puente: { recorte: PuenteApi | null;              // null con filtro de tienda (el puente no se recorta por tienda)
            por_gm: (PuenteApi & { gm_clave: string; nombre: string })[] };   // de toda la proyección
  alertas: AlertaApi[];                             // importantes primero; las de bloqueo del cierre vienen de /bloqueos
  kpis: { siguiente: number; cierre: number; real_ac: number; proyectado_resto: number; anterior: number; hace_dos: number; hace_tres: number;
          comparativos: ComparativoApi[]; exactitud: Exactitud };
  series: SerieMensualApi[];
  tabla_mensual: { filas: { clave: string; etiqueta: string; meses: (number | null)[]; total: number | null; tipo: SerieMensualApi["tipo"] | "variacion"; exactitud: Exactitud }[] };
  desglose: { dimension: string; filas: FilaDesgloseApi[]; total: FilaDesgloseApi };
  crecimientos: CrecimientoGMApi[];                 // siempre de toda la proyección
  decisiones: DecisionesAnioApi[];                  // del recorte (sin filtro de tienda)
  apoyo: ApoyoApi;
  mayores: { fila: string; vigente: number; participacion: number; crecimiento_pct: number | null }[];
  atribucion: { tiendas: { tienda_id: string; codigo: string; participacion_anual: number; participacion_mes: (number | null)[] }[];
                sin_atribuir: { en_curso: number; siguiente: number }; mensual: boolean } | null;   // solo con filtro de tienda o bloque
  huella: string;                                   // la que se manda al aprobar
};

export type OpcionesTableroApi = {
  proyecciones: (ProyeccionTableroApi & { estado_direccion: EstadoAprobacion })[];
  por_defecto: { proyeccion_id: string; motivo: "usa_compras" | "en_trabajo_mas_reciente" } | null;
  comparar_por_defecto: { proyeccion_id: string; aprobacion_id: string } | null;
  generos: { id: string; nombre: string; es_resto: boolean }[]; mundos: { id: string; nombre: string }[];
  lineas: { id: string; nombre: string; genero_id: string; mundo_id: string }[];
  agrupaciones_marca: { id: string; nombre: string }[];
  unidades_marca: { id: string; nombre: string; agrupacion_marca_id: string }[];
  tiendas: { id: string; codigo: string; nombre: string; fecha_apertura: string | null; fecha_cierre: string | null; activa: boolean }[] };
```

Constantes: `VERSION_HUELLA = 1` (§2.3 a), `UMBRAL_DESVIO_PP = 2`, `UMBRAL_TENDENCIA_PP = 5`, `UMBRAL_CONCENTRACION_TOP10 = 0.40`, `UMBRAL_FILA_DOMINANTE = 0.05`, `UMBRAL_TIENDA_NUEVA_RELEVANTE = 0.05`, `UMBRAL_DECISION_MASIVA = 0.80`, `MAX_TIENDAS = 30`, `MAX_AGRUPACIONES = 40`, `MAX_GENEROS = 20`, `IPF_TOLERANCIA = 1e-6`, `IPF_MAX_ITERACIONES = 1000`.

### 3.4 Atribución por tienda (compartida con 07f; `src/lib/direccion/atribucion.ts`, pura)

Se usa cuando hay filtro de tienda o un bloque distinto de «todas». Todo se calcula **sobre el recorte** (GML, AM, unidad de marca, temporada) y **con todas las tiendas del recorte**; recién al final se suma lo de las tiendas elegidas. Notación: `M(Z)` = tiendas con la posición de `Z` de su `clave` en `1`; *misma* = en `M(Y)` y en `M(Y+1)`; *entra* = en `bloques[Y].nuevas` y en `M(Y+1)`; *sale* = en `M(Y)` y en `bloques[Y+1].cierres`; `real_t` = venta de `t` de enero a `k` de `Y` en el recorte (de `por_tienda`; `k` de la proyección, no `k'`, igual que 07f).

**A. Año en curso, total anual por tienda (exactamente la regla 111).**
1. `07f := atribuirBase({ total: base(Y+1).B, entran: { t → para_base_t de cada *entra* }, mismas: [{ t, codigo, real: real_t } de las *misma*] })` — **la misma función de 07f con las mismas entradas** que arma `armarVentaPorTienda` para un GM. Da `A_t` de cada *misma*, el vigente exacto de cada *entra* y `sin_atribuir_07f`.
2. Lo que queda de la base de `Y`: `L = base(Y).vigente − (base(Y+1).B − Σ_{entra} para_base)`. `L` junta tres cosas: el 2026 que M7 resta de la base por las tiendas que **salen**, la diferencia entre la base y el cierre (M8 de la primera revisión) y el vigente de `Y` de las filas base cuyo registro de `Y+1` **no tiene `B`** (otro método). `sale := atribuirBase({ total: L, entran: ∅, mismas: [{ t, codigo, real: real_t } de las *sale*] })` da `A_t` de cada *sale* y `sin_atribuir_sale` (si `L ≤ 0`, no hay *sale* o todas pesan 0, todo `L` va ahí). **Filas sin `B` (M-D):** si la proyección tiene registros base de `Y+1` sin `B` (`anios[Y+1].base.vigente_sin_B > 0`; hoy no hay ninguno), `L` **no** se reparte entre las *sale*: va entero a `sin_atribuir_sale` y `atribucion_estimada` lo dice («hay filas proyectadas por otro método: lo que no forma la base de 2027 queda sin atribuir»), para no cargarle a una tienda que cierra el vigente de filas que no son suyas.
3. Invariante, exacto en enteros: `Σ_{misma} A_t + sin_atribuir_07f + Σ_{sale} A_t + sin_atribuir_sale = base(Y).vigente`.
4. **Para un GM (o el Resto) sin más filtros, `A_t` de cada *misma* es idéntico al «2026 cierre vigente» de 07f** (R8): misma función, mismas entradas.

**B. Año siguiente, total anual por tienda.** `atribuirBase({ total: base(Y+1).vigente, entran: ∅, mismas: [{ t, codigo, real: w_t } de M(Y+1)] ∪ [{ "~sin_atribuir", real: sin_atribuir_07f } si > 0] })` con `w_t` = `A_t` de 07f para una *misma* y el vigente exacto para una *entra*. Es decir: **el 2027 de cada tienda es su base 2026 por el crecimiento del recorte** (`2027 ÷ B`), en enteros por mayor resto; no se inventa un crecimiento por tienda.

**C. Reparto mensual** (`atribuirMensual`, nueva, genérica; redondeo **sin mes absorbente ni arrastre**, B-1 de la segunda revisión):
- Entrada: `filas: { id, orden, total ≥ 0 entero, semilla: number[n] }[]`, `columnas: entero[n] ≥ 0`.
- Algoritmo:
  1. `T = Σ total`, `C = Σ columnas`. Si `T = 0`: todas las celdas 0 y `sin_atribuir_m = columnas_m`. Si `C = 0`: cada fila se reparte por su semilla en enteros por mayor resto (empate: mes) y `sin_atribuir_m = −Σ_filas`.
  2. **Fuera de la IPF:** las filas con `total = 0` y las columnas con `columnas_m = 0` quedan en 0 en todas sus celdas (evita divisiones por cero y que una fila sin total reciba algo).
  3. Objetivo por columna `o_m = columnas_m × T ÷ C` (reales).
  4. **Ajuste biproporcional (IPF)** sobre las filas y columnas que quedan: semillas `max(semilla, 0) + 1e-9`; cada vuelta escala filas (a `total`) y **después** columnas (a `o_m`), de modo que al terminar las columnas cuadran en reales; para cuando el desvío máximo de fila es ≤ `IPF_TOLERANCIA` o a las `IPF_MAX_ITERACIONES`. Resultado `x_im` ≥ 0.
  5. **Columnas enteras** por redondeo acumulado: `c_m = round(Σ_{j≤m} o_j) − round(Σ_{j<m} o_j)` (`round` = al entero más cercano, mitades hacia arriba). `Σ c_m = T`, `c_m ≥ ⌊o_m⌋` y `c_m = 0` donde `o_m = 0`.
  6. **Pisos:** `p_im = ⌊x_im⌋`. Faltantes por fila `r_i = total_i − Σ_m p_im` y por columna `s_m = c_m − Σ_i p_im`. Los dos son **≥ 0** (`Σ_i p_im ≤ ⌊o_m⌋ ≤ c_m` porque las columnas cuadran en reales, y `Σ_m p_im ≤ total_i` porque las filas cuadran dentro de la tolerancia y `total_i` es entero) y suman lo mismo (`T − Σ p`).
  7. **Primera pasada:** las celdas, ordenadas por fracción `x_im − p_im` **descendente** (empate: `orden` de la fila, luego mes), suman 1 si `r_i > 0` y `s_m > 0` (y restan 1 a ambos).
  8. **Segunda pasada** (completa lo que la primera no pudo, en orden fijo): filas por `orden`, y dentro de cada fila los meses de enero a diciembre; cada celda suma `min(r_i, s_m)` y lo resta de ambos. Termina con todos los `r_i` y `s_m` en 0 (sumas iguales).
  9. `sin_atribuir_m = columnas_m − c_m` (= `columnas_m − Σ_filas`).
- **Invariantes** (prueba de propiedad, ≥ 5 000 casos aleatorios con semilla fija, que incluyan filas y columnas en 0, totales de decenas, 3 y 12 meses y `T ≠ C`; el revisor verificó el algoritmo con 19 466 casos sin fallo): **ninguna celda negativa**; `Σ_m fila_i = total_i` exacto; `Σ_filas + sin_atribuir_m = columnas_m` exacto; **determinista** (la misma entrada, en el mismo orden, da la misma salida; nada depende del orden de iteración de un `Map`); si `T = C`, `sin_atribuir ≡ 0`.
- **«Sin atribuir» por mes puede ser negativo.** «Todo ≥ 0» vale para las celdas de tienda, **no** para `sin_atribuir_m`: cuando lo que se reparte entre tiendas (`T`) supera lo que el bloque proyecta en esos meses (`C`) —por ejemplo, en el año en curso, por la diferencia entre la base y el cierre (M8 de la primera revisión) o porque un «sin atribuir» anual negativo no entra como fila—, `sin_atribuir_m` sale < 0. Se muestra con su signo en la línea «Sin atribuir» al pie de la tabla mensual y en el Excel, con el texto «−12 u: lo atribuido a las tiendas ese mes supera lo proyectado para el bloque (la base anual y la curva guardada difieren; ver la línea "diferencia" del puente)»; **nunca** se resta de una tienda. Con un bloque elegido entra en el total del bloque con su signo, y el total sigue exacto.
- **Semillas (participación del mismo mes calendario en el último año completo):** año de referencia = `Y−1` (si le falta un mes publicado, ese mes se toma de `Y−2`). Para la tienda `t` y el mes `m`: `semilla = venta_t,m ÷ Σ venta_u,m` sobre las tiendas de la llamada con **historia completa** en el año de referencia (abiertas los doce meses). **Reserva:** si `t` no tiene historia completa ese año (abrió o cerró dentro de él), su semilla es su participación anual `total_t ÷ T` en **todos** los meses (sigue la forma de la red: así una tienda en rampa no hereda su arranque); si su venta del mes es ≤ 0, se usa el mismo mes de `Y−2` si allí tenía historia completa y venta > 0, y si no, `total_t ÷ T`. La fila «sin atribuir» usa `total ÷ T`.

**D. Qué se reparte por mes.**
- **Año en curso:** enero a `k`, **real exacto** por tienda (de `por_tienda`); de `k+1` a diciembre, `atribuirMensual` con `total_t = A_t − real_t` (las *misma* y las *sale*, más «sin atribuir» si es ≥ 0) y `columnas = base(Y).meses[k+1..12]`. Si `A_t − real_t < 0` para **alguna tienda de la llamada** (*misma* o *sale*; se republicó un mes a la baja, o `B` quedó por debajo del real), **no se reparte por mes en esa llamada**: el total anual de cada tienda sigue siendo `A_t`, los meses `k+1..12` de **todas** sus tiendas salen «—» y la alerta `atribucion_sin_mensual` lo explica. Un «sin atribuir» anual negativo **no** es causa: simplemente no entra como fila y su efecto aparece en `sin_atribuir_m` (C).
- **Año siguiente:** `atribuirMensual` con `total_t` de B y `columnas = base(Y+1).meses`.
- **Tiendas de bloque** (nuevas del año anterior, aperturas y cierres de `Y+1`, y las filas de tienda de `Y`): sus `meses` exactos.
- **Con tiendas elegidas:** se suman las elegidas; «sin atribuir» nunca se asigna a una tienda (se informa al pie). **Con un bloque elegido** (sin tiendas), el conjunto es el del bloque en `Y+1` y su «sin atribuir» sí se suma, de modo que el total del bloque es exacto.

**E. Qué se muestra.** Rótulo «estimado» en cada cifra atribuida (tarjetas, tabla, gráfico, Excel); para cada tienda elegida, su participación anual y la de cada mes (`atribucion.tiendas`), y una nota: «T03: 2027 estimado con su parte de la base 2026 (15,7 %) y, mes a mes, con su participación de cada mes de 2025 (de 11,5 % en enero a 22,8 % en junio)».

**F. Desglose con tiendas elegidas.** Para dimensiones distintas de «tienda», lo proyectado de las mismas tiendas de cada elemento se estima con **la participación anual de las tiendas elegidas en el recorte** (una sola tasa para todos los elementos), en enteros por mayor resto para que la suma sea el total atribuido; lo de tiendas de bloque sale exacto de `por_dim.tiendas`. La cifra precisa por tienda es la del desglose «Tienda».

**Alcance en 07f: ninguno.** 07f no cambia (ni código ni pruebas). `atribuirBase` se importa tal cual; `atribuirMensual` es nueva y vive en `src/lib/direccion/`. Si un día 07f quisiera mostrar el reparto mensual, lo importaría de ahí.

### 3.5 Lo que bloquearía el cierre (`src/lib/direccion/cierre.ts`)

Solo para una proyección **en trabajo**. Arma **exactamente los argumentos que arma `cerrarProyeccion`** (`src/lib/proyeccion/servicio.ts`), con las mismas funciones exportadas de M7 y sin modificarlas: `cargarContextoCalculo(d, { conEat: false, conFlujo: true })`, `leerVigentes` de `Y+1`, `desactualizadaDe`, `leerFilasConAnios(…, { columnas: "ligeras", tiendaId: null, soloActivas: true })` (con `comoAvisos`), `leerTiendasProyeccion` (activas del bloque `nuevas`), `parametrosDe(p.parametros).umbral_cola_larga`, `esMetodoVigente`, `crecimientosDeHoy` con `ninoDeFilas` de las filas de hoy y `bloqueosNinoDe`. Es decir: `estado`, `calculandoDesde`, `ahora`, `anioEnCurso`, `filasBase`, `tiendas`, `desactualizada`, **`crecimientosCambiados`** (`desactualizada` trae el motivo `crecimientos_cambiados`), `umbralColaLarga`, `metodoViejo`, `crecimientosSinAprobar`, `bloqueosNino` y `forzar: false`. Con eso:

1. **Causas (I-D):** el mismo bucle que `bloqueosDeLote` de 07g, pero **sobre `motivoRechazoCerrar` con esos argumentos** (no se llama a `bloqueosDeLote`, que no pasa `crecimientosCambiados` y reescribe los mensajes para el lote). Cada vuelta anota la causa que devuelve, **con su código y su mensaje tal cual** (los del cierre: «recalcúlala antes de cerrar», «ciérrala igual con "Cerrar de todos modos"»; nunca los de 07g) y la apaga para la vuelta siguiente: `version_metodo` → `metodoViejo = false`; `crecimientos_cambiados` → `crecimientosCambiados = false`; los del Niño → se anotan **todos** con `bloqueosNinoDeCierre` y `bloqueosNino = undefined`; `crecimientos_sin_aprobar` → `null`; `filas_sin_decidir` → `filasBase = []` (su `detalle` trae `total_filas_sin_decidir` y `total_filas_para_revision`); `tiendas_sin_decidir` → `tiendas = []`; `desactualizada` → `desactualizada = false` (con `detalle.motivos` de `desactualizadaDe`, como hace 07g). `ya_cerrada`, `archivada` y `calculo_en_curso` cortan (la ruta ya responde `{ aplica: false }` o `409 calculo_en_curso` antes). Como mucho nueve vueltas.
2. **Forzable:** `desactualizada` se marca `forzable: true` (en M7 se salta con «Cerrar de todos modos»): se muestra como **aviso** («Se puede cerrar igual»), no como bloqueo duro. Todas las demás, `forzable: false`, como en M7 (`version_metodo`, `crecimientos_cambiados`, los del Niño y `crecimientos_sin_aprobar` no se saltan con `forzar`). `puede_cerrar` = no hay ninguna causa; `puede_forzar` = todas las causas son forzables.
3. **Filas:** el conteo por año, por motivo y en unidades se calcula con **`filaBloqueaCierre`** registro por registro sobre las mismas `filasBase` y el mismo `umbralColaLarga` (lo que la causa `filas_sin_decidir` resume en una frase).

Ningún predicado se reescribe (D12; prueba estática: `src/lib/direccion/` no contiene `revision_cola_larga` ni `umbral_cola_larga` fuera de pasarlo como argumento, ni importa `bloqueosDeLote`). Cacheado 60 s por `(proyeccion_id, huella, calculado_at)`.

## 4. Pantallas

### 4.1 Dónde vive y quién la ve

- Ruta **`/planificacion/aprobacion-direccion`**, item **«Aprobación de dirección»** en la sección Planificación de `src/lib/nav.ts` (roles `PLANIFICACION`: admin y planner). El comprador no ve el item y `puedeVerRuta` lo redirige (decisión 113).
- **Admin:** todo, con el botón **«Decidir»** siempre visible (barra fija arriba en escritorio, abajo en móvil).
- **Planner:** todo, sin el botón; en su lugar, el estado de dirección en texto y el historial (prepara la proyección y necesita ver lo que verá dirección y lo que observó).
- Kit existente: `Card`, `DataTable`, `Chips`, `ChipsMultiples`, `ChipFiltro`, `Select` y `Field` (`form.tsx`), `Tabs`, `Badge`, `Alert`, `Modal`, `DialogoConfirmar`, `EmptyState`, `Switch`, `Checkbox`. Hook `use-tablero-direccion.ts` (patrón `use-proyeccion.ts`). Formato `es-PE` de `src/lib/formato.ts` (miles con coma, decimal con punto, mes «set»), igual en pantalla y Excel. En esta ficha las cifras se escriben con espacio de miles y coma decimal solo por legibilidad.
- Archivos: `src/app/(app)/planificacion/aprobacion-direccion/page.tsx`, `tablero-panel.tsx`, `barra-decision.tsx`, `resumen-decidir.tsx`, `puente.tsx`, `alertas-tablero.tsx`, `frente-aprobada.tsx`, `filtros-tablero.tsx`, `kpis.tsx`, `grafico-tablero.tsx`, `tabla-mensual.tsx`, `tabla-desglose.tsx`, `crecimientos-gm.tsx`, `decisiones-origen.tsx`, `apoyo.tsx`, `decision-modal.tsx`, `historial-aprobaciones.tsx`, `use-tablero-direccion.ts`, `vista-tablero.ts` (puro: filas, textos, hojas del Excel).

### 4.2 Orden de la página (de arriba abajo; en móvil, una columna en el mismo orden)

La página tiene dos partes. **Arriba, «Para decidir»: siempre la proyección entera**, sin filtros (es lo que se aprueba). **Abajo, «Explorar»: el recorte** que elija quien mira.

| # | Bloque | Parte | Contenido (detalle en §4.3 a §4.10) |
|---|---|---|---|
| 1 | Cabecera fija | — | Selector de proyección, estado de dirección en texto, «Comparar con», botón «Decidir» (admin) y «Descargar Excel» |
| 2 | Resumen para decidir | Para decidir | 3 a 5 líneas (§4.3) |
| 3 | De 2026 a 2027 (puente) | Para decidir | Total y por género × mundo (§4.4) |
| 4 | Alertas para aprobar | Para decidir | Lo que bloquearía el cierre (si está en trabajo), importantes e informativas (§4.5) |
| 5 | Frente a lo aprobado | Para decidir | Diferencia con la última aprobada, por GM (§4.6) |
| 6 | Filtros | Explorar | §4.7 |
| 7 | Cifras del recorte | Explorar | Cuatro tarjetas y el puente del recorte en una línea (§4.7) |
| 8 | Gráfico mensual y tabla mensual | Explorar | §4.8 |
| 9 | Desglose | Explorar | Tabla por la dimensión elegida; elegir una fila la aplica como filtro (§4.8) |
| 10 | Crecimiento declarado, implícito y tendencia | Para decidir (no se recorta) | §4.8 |
| 11 | Cómo se decidió | Explorar (recorte sin tienda) | Origen de las decisiones (§4.8) |
| 12 | Datos de apoyo: soles y cobertura | Explorar | §4.8 |
| 13 | Las 10 filas mayores | Explorar | §4.8 |
| 14 | Historial de aprobaciones | — | §4.10 |

**Cabecera (1).** «Proyección 2026–2027 · **cerrada** el 07 nov 2026 por *Planner P.* · datos hasta set 2026 · **la que usa Compras**», y el `Badge` de estado **en texto**: «Sin aprobación de dirección» · «Aprobada por *nombre* el 08 nov 2026» · «Aprobada con observaciones por *nombre*» · «Rechazada por *nombre*» · «Aprobación invalidada: la proyección cambió después del 08 nov». Si la mostrada está en trabajo: `Alert` ámbar «En trabajo: las cifras pueden cambiar; la que usa Compras es *Proyección …*» con enlace. Si es archivada: `Alert` gris «Archivada: solo lectura». Si `k' > k`: «Hay venta publicada hasta oct 2026; esta proyección se calculó con datos hasta set 2026». «Comparar con» (`Select`): por defecto la última aprobada (con el rótulo «la última aprobada»), cualquier otra, o «Sin comparar».

**Estados vacíos y de error.** Sin ninguna proyección: `EmptyState` «No hay proyección calculada» con enlace a Proyección. `409 sin_calcular`: «Calcula la proyección para verla en el tablero». `409 calculo_en_curso`: «Se está recalculando; vuelve en unos minutos» con «Reintentar». Filtro sin datos: `EmptyState` «Sin venta ni proyección con estos filtros» con «Limpiar filtros». Error `500`: `Alert` rojo con «Reintentar».

### 4.3 Resumen para decidir

Lo arma el servidor (`decidir.lineas`), siempre de la proyección entera, en frases completas (cifras del caso de §6.1):
1. **Qué se compra:** «2027: 84 714 u, +7,9 % sobre el cierre 2026 y +13,7 % sobre 2025, el último año normal (2026 fue año del Niño)».
2. **De dónde sale:** «El aumento de 6 213 u sale de: crecimiento declarado +4 670, fijado a mano +1 343, aperturas +1 408, venta de 2027 de tiendas que cierran +1 000, corrección del Niño +753, menos 2 961 de tiendas que salen de la base». «Otras diferencias con la propuesta» se nombra solo si no es 0 (aquí es 0).
3. **Riesgo:** «5 alertas importantes; la primera: HOMBRE · URBANO declara +5,0 % con sus mismas tiendas a −3,9 % en lo que va del año, corregido del Niño (−5,9 % en bruto)». Sin alertas importantes: «Sin alertas importantes».
4. **Frente a lo aprobado:** «Frente a lo aprobado el 03 nov (*Proyección seguimiento set*): 2027 +1 214 u (+1,5 %); el mayor cambio, MUJER · URBANO +1 006 u». O «Idéntica a lo aprobado el 03 nov». O «No hay aprobaciones anteriores».
5. **Quién y cómo:** «Cerrada por *Planner P.* el 07 nov 2026; sin aprobación de dirección vigente». Si en trabajo: «En trabajo; 3 causas bloquearían el cierre» o, si todas son forzables, «En trabajo; está desactualizada, pero se puede cerrar igual» (cuando llega `/bloqueos`).

Debajo, en letra chica: «Precisión del método: con el año anterior se habría desviado −3,2 % (dentro de muestra)» y «Objetivo global declarado: +6,0 %; implícito en mismas tiendas: +7,9 % sobre 2026 corregido (+9,0 % sobre real)». Si no hay dato, la línea no aparece.

### 4.4 De 2026 a 2027 (puente)

Tabla de pasos (`DataTable`, cifras en unidades, con su acumulado y su % sobre el paso anterior), **total de la proyección** (caso de §6.1):

| Paso | Unidades | Acumulado |
|---|---|---|
| 2026 cierre, todas las tiendas | | 78 501 |
| − 2026 de tiendas que no forman la base de 2027 (aperturas de 2026 aún fuera, cierres de 2026) | 0 | 78 501 |
| − 2026 de tiendas que cierran en 2027, filas sin base y diferencia | −2 961 | 75 540 |
| **Base 2027 (`B`): 2026 de las mismas tiendas de 2027** | | **75 540** |
| + Corrección del Niño (`B' − B`) | +753 | 76 293 |
| + Crecimiento declarado aplicado (propuesta − `B'`) | +4 670 | 80 963 |
| + Fijado a mano (vigente − propuesta de las filas decididas a mano) | +1 343 | 82 306 |
| + Otras diferencias con la propuesta | 0 | 82 306 |
| + Filas de mismas tiendas sin base `B` (otro método) | 0 | 82 306 |
| **Mismas tiendas 2027** | | **82 306** |
| + Tiendas abiertas en 2026 (aún fuera de la base) | 0 | 82 306 |
| + Aperturas de 2027 | +1 408 | 83 714 |
| + Venta de 2027 de tiendas que cierran en 2027 | +1 000 | 84 714 |
| **2027** | | **84 714** |

- Cada línea con texto de ayuda (`title` y lector de pantalla). «Fijado a mano» (`delta_manual`, I-C): «Lo que el planner o el admin escribieron a mano por encima o por debajo de la propuesta». «Otras diferencias con la propuesta» (`delta_otras`): «Filas aceptadas en bloque, por IA o tal cual cuya propuesta cambió después al recalcular (se aceptó una propuesta anterior), y filas escaladas por tienda: no son decisiones a mano, pero hacen que lo vigente no sea la propuesta de hoy». Así una proyección con muchas aceptadas sobre propuestas viejas no aparece como «decisiones a mano» negativas. La tercera dice: «Incluye el 2026 que M7 resta de la base por las tiendas que cierran en 2027 y cualquier diferencia entre la base y el cierre de esas tiendas (por ejemplo, decisiones sobre 2026 tomadas después de calcular la base)». Si no hay tiendas que salgan y la línea no es 0, se marca «diferencia» y se explica (M8 del revisor).
- **Por género × mundo:** la misma tabla en columnas, una fila por GM de HOMBRE y MUJER y una del Resto, con la del Total (`puente.por_gm`). Las celdas de un GM con Niño llevan «Niño».
- Las líneas salen de lo guardado (`por_gm` de `tablero_proyeccion`): `B`, `B'`, propuesta y vigente de los registros con `B` (y su partición en `delta_manual` y `delta_otras`), vigente sin `B`, bloques de tienda, cierre de `Y` y lo de tienda que queda fuera. La suma de los pasos es el total exacto (R4).

### 4.5 Alertas para aprobar

Lista con icono **y** palabra de nivel («Bloquea el cierre», «Importante», «Informativo»), con enlace a la pestaña de M7 donde se resuelve. Arriba, las de la proyección entera; las del recorte van en «Explorar» junto a las tarjetas.

**Bloquearían el cierre** (solo en trabajo; de `GET /api/direccion/bloqueos`, §3.5; mientras carga: «Comprobando qué bloquearía el cierre…»): cada causa con el código y el mensaje **del cierre** tal cual (método anterior, crecimientos cambiados o sin aprobar, factores del Niño, filas sin decidir con su conteo por año y motivo —«2027: 37 filas sin decidir, 41 200 u; 12 de ellas de cola larga para revisión»—, tiendas sin decidir). «Desactualizada» va aparte, con nivel «Se puede cerrar igual» (forzable, I-D) y sus motivos. Si no hay ninguna: «Nada bloquea el cierre»; si solo está la forzable: «Nada bloquea el cierre; está desactualizada».

**Importantes e informativas** (`alertas.ts`, puras):

| Código | Nivel | Alcance | Cuándo | Texto de ejemplo |
|---|---|---|---|---|
| `contra_tendencia` | importante; **informativa** si solo la bruta es < 0 | proyección | GM con `declarado − tendencia ≥ UMBRAL_TENDENCIA_PP` (5 pp) y tendencia < 0, con la tendencia **corregida** (abajo) | «HOMBRE · URBANO declara +5,0 % y sus mismas tiendas van −3,9 % en ene–oct, corregido del Niño (−5,9 % en bruto)»; informativa: «… van −2,0 % en bruto y +0,1 % corregido del Niño: tendencia afectada por el Niño» |
| `desvio_crecimiento` | importante | proyección | GM con `|implícito − declarado| ≥ 2 pp` en la base del declarado | «MUJER · URBANO: declarado +8,0 %, implícito +12,3 % (+4,3 pp: fijado a mano +1 226 u)»; si `delta_otras ≠ 0`, se añade «otras diferencias con la propuesta …» |
| `factor_provisional` | importante | proyección | Un factor del Niño de `Y` con `estadoFactorY` ≠ `ok` (cerrada: importante; en trabajo además bloquea, en la lista de arriba) | «Invierno 2026 provisional (1 mes del periodo, escrito a mano 0,70): expone 13 300 u de 2027 (15,7 %) en filas de invierno» (de `por_temporada.Y1_con_factor_Y`). **Exposición deduplicada por fila (M-E):** cada factor provisional afecta su temporada y `todo_el_ano`; la cifra es la suma de `Y1_con_factor_Y` sobre la **unión** de temporadas afectadas, cada temporada una sola vez (una fila está en una sola temporada), y con dos factores provisionales se da **una** alerta con los dos y una sola cifra, nunca la suma de dos cifras. Es una cota superior (una fila `todo_el_ano` con φ solo en el otro semestre también cuenta) y el texto lo dice |
| `tienda_nueva_relevante` | importante | ambos | Una tienda que entra a la base pesa ≥ 5 % de `B`, o una nueva o apertura ≥ 5 % del 2027 | «T10 entra a mismas tiendas en 2027 y es el 5,4 % de la base: abrió en nov 2025 y su 2026 es real ene–set más proyectado oct–dic» |
| `apertura_sin_historia` | importante | ambos | Apertura de `Y+1` proyectada por venta esperada | «T12 (abr 2027) se proyecta por venta esperada y su referente: no tiene venta propia» |
| `anomalia_crecimiento` | importante si `sin_base`; si no, info | proyección | Versión vigente de un GM sin base (`Σ B = 0` o `base_valor` nulo), una versión reemplazada el mismo día que la vigente, o vigente sin nota. Para el **Resto**, la versión es la de `crecimiento_resto_usado.crecimiento_id` (I-A); si es `null` (Resto provisional), sin anomalías de versión | «MUJER · URBANO v4 reemplazó a v3 el mismo día (06 nov, *Planner P.*); sin nota» |
| `origen_decisiones` | importante si lo **aceptado sin cambiar** ≥ `UMBRAL_DECISION_MASIVA` (80 %) de las unidades de 2027 y el día pico tiene ≥ 50 % de los registros decididos de 2027; si no, info | proyección | Siempre que haya decisiones. **Definición (M-E):** con la clasificación excluyente de `decisiones` (lote > ia > origen > sin decidir), «aceptado sin cambiar» = `lote` + `ia` + `propuesta`; **no** cuentan `manual`, `escalada` ni `sin_decidir`. Denominador: vigente total de 2027 de **todos** los registros activos (base y tienda, decididos o no) | «2027: 49 % aceptado en bloque, 15 % tal cual la propuesta, 36 % a mano; 6 de los 8 registros de 2027 decididos el 07 nov por *Planner P.*» |
| `concentracion` | importante | recorte | Con ≥ 50 filas base: las 10 mayores ≥ 40 % del 2027 o una sola ≥ 5 % | «Las 10 filas mayores son el 46 % de 2027; una sola, el 7 %» |
| `base_corregida_nino` | info | proyección | GM con `correccionMaterial` | «HOMBRE · URBANO: base 2027 corregida del Niño +1,6 % (47 040 → 47 793)» |
| `metodo_anterior` | importante | proyección | `version_metodo < VERSION_METODO` | «Calculada con el método 4: sin base corregida del Niño» |
| `sin_curva` | importante | recorte | `sin_meses > 0` | «1 240 u de 2027 sin reparto mensual: suman al total, no al gráfico» |
| `propuesta_cambio` / `curva_cambio` | info | proyección | conteos > 0 | «112 filas decididas cuya propuesta cambió al recalcular» |
| `datos_mas_nuevos` | info | proyección | `k' > k` | «Hay oct 2026 publicado: el gráfico muestra su real junto al proyectado» |
| `meses_faltantes` | importante | recorte | Falta una carga en el rango | «Falta mar 2024: 2024 está incompleto» |
| `atribucion_estimada` | info | recorte | Filtro de tienda o bloque con mismas tiendas | §3.4 E |
| `atribucion_sin_mensual` | importante | recorte | §3.4 D | «El real de ene–set cambió desde el cálculo: el reparto mensual por tienda de oct–dic no se puede hacer; el total anual sí» |
| `marca_estimada` | info | recorte | Filtro o desglose de marca | «Unidad de marca X: lo proyectado es estimado con su participación de los últimos 12 meses en cada fila (en esta fila, 63 %). Una marca nueva, en liquidación o al barrer puede estar sobre o subestimada»; con `sin_participacion_marca`: «N u de filas sin participación por marca quedan fuera» |
| `comparada_distinta_k` | info | proyección | La comparada tiene otro `hasta_periodo` | «La comparada se calculó con datos hasta ago 2026» |
| `distinta_de_aprobada` | info | proyección | Hay una aprobada anterior y la huella difiere | La línea 4 del resumen |

Orden: «Bloquea el cierre», «Se puede cerrar igual», «Importante», «Informativo»; dentro de cada nivel, el orden de la tabla. Las informativas van plegadas («Ver 6 informativas»).

**Tendencia corregida del Niño (I-E).** El declarado se escribe sobre la base corregida; la tendencia en bruto del año del Niño sale deprimida justo en los GM con Niño, así que se comparan peras con peras. Para cada GM, con `tendencia_gm` de `tablero_venta` (ene–`k'` de `Y` y de `Y−1` en `M(Y)`) y `por_gm.Y.base_meses` / `base_meses_sin_nino` de `tablero_proyeccion`:
- `bruta = u_ac_cur ÷ u_ac_ant − 1`.
- `φ̄ = Σ_{m≤k'} base_meses_m ÷ Σ_{m≤k'} base_meses_sin_nino_m` (el factor medio de ene–`k'` del GM, ponderado por sus propios meses; para `m ≤ k` esos meses son el real de `M(Y)`). `corregida = (u_ac_cur ÷ φ̄) ÷ u_ac_ant − 1`. En un GM sin `correccionMaterial` (o con `φ̄ = 1`), `corregida = bruta` y se muestra una sola cifra.
- Si `Y−1` también es año del Niño, su venta no se corrige (los factores guardados son solo de `Y`): se muestra la corregida con la nota «el año anterior también fue del Niño: sin corregir».
- La alerta y el semáforo usan **la corregida**. Si la bruta es < 0 y la corregida no, `contra_tendencia` **baja a informativa** y se rotula «tendencia afectada por el Niño»; el semáforo dice «coincide» o «revisar» según la corregida, con la misma nota. Siempre se muestran las dos cifras en los GM con corrección.

### 4.6 Frente a lo aprobado

`Card` con la diferencia contra la última aprobada (`decidir.diferencia`): fecha, quién, resultado, y una tabla por GM con `2027 aprobado`, `2027 actual`, `diferencia u` y `%`, ordenada por diferencia absoluta, más la fila Total y la de 2026 cierre. Sale del `resumen` guardado de esa aprobación (la foto exacta de lo aprobado) frente a `por_gm` de la mostrada; un GM que esté en un lado y no en el otro cuenta 0 en el que falta. Casos: **misma proyección y misma huella** → no se muestra (el estado ya dice «Aprobada»); **misma huella, otra proyección** (una copia sin cambios) → «Idéntica a lo aprobado el 03 nov en *…*; esta copia aún no tiene aprobación propia»; **sin aprobaciones** → «Todavía no hay ninguna proyección aprobada».

### 4.7 Filtros y cifras del recorte

**Filtros** (barra; en móvil, un botón «Filtros (3)» que abre un `Modal` de pantalla completa). Todos en la URL (`?proyeccion=&comparar=&generos=&resto=&mundo=&linea=&temporadas=&am=&marca=&tiendas=&bloque=&desglose=`).
- **Géneros** (`ChipsMultiples`; atajo **«Resto»** que marca de una vez los géneros fuera de HOMBRE y MUJER, el mismo conjunto que el Resto de M7).
- **Mundo** y **Línea** (`Select`; línea solo con un género y un mundo, como la Matriz de M7).
- **Temporada** (`ChipsMultiples`: Invierno · Verano · Todo el año · Sin temporada; la de la fila, como el filtro de M7).
- **Agrupación de marca** (`ChipsMultiples`, primer nivel).
- **Marca** (`Select` con búsqueda; **unidades de marca agrupadas por su AM**; una a la vez en `0.19.0`); ayuda: «Lo proyectado por marca es estimado con su participación de los últimos 12 meses en cada fila».
- **Tiendas** (`ChipsMultiples` agrupado por su situación en 2027: «Mismas tiendas 2027», «Abiertas en 2026», «Aperturas 2027», «Cierres 2027», «Cerradas»; código y nombre).
- **Bloque** (`Chips`: Todas · Mismas tiendas de 2027 · Tiendas nuevas · Cierres 2027).
- «Limpiar filtros». Bajo la barra, el recorte en texto: «HOMBRE · URBANO · AM: AM-A · tiendas: T03 · cifras de T03 estimadas».

**Conjunto de tiendas de cada línea (I4).** Con un bloque o tiendas elegidas, **todas las líneas del gráfico y de la tabla usan el mismo conjunto de tiendas**: el del bloque en 2027 (`M(2027)`, las nuevas o los cierres de 2027) intersectado con las tiendas elegidas. 2023, 2024, 2025 y el real de 2026 son la venta de esas tiendas; 2026 proyectado y 2027, su proyección (exacta o atribuida, §3.4). El rótulo lo dice: «Mismas tiendas de 2027 (4): T01, T02, T03, T10». Los **comparativos de mismas tiendas** usan, para «Z frente a Z−1», el conjunto `M(Z)` de cada par (R7).

**Cifras del recorte (tarjetas)**, cuatro (dos por fila en móvil), cada una con el número y una frase (caso HOMBRE · URBANO de §6.1):
- «**2027 proyectado** · 52 708 u · +5,4 % vs cierre 2026 · **+12,1 % vs 2025, último año normal**».
- «**2026 cierre** · 50 001 u = real ene–set 34 000 + proyectado oct–dic 16 001 · +6,4 % vs 2025 · año del Niño».
- «**2026 en lo que va** · ene–oct 38 300 u · ene–set +3,0 % vs 2025 ene–set».
- «**Mismas tiendas** · 2027 vs 2026: +6,9 % sobre real, +5,2 % sobre corregido (4 tiendas) · total con nuevas, aperturas y cierres +5,4 %».

Debajo, el **puente del recorte** en una línea («Base 47 040 → Niño +753 → crecimiento +2 390 → a mano +117 → mismas 50 300 → aperturas +1 408 → cierres +1 000 → 52 708»); con tiendas elegidas no se muestra (no se recorta por tienda). Y las alertas de alcance «recorte».

### 4.8 Gráfico, tablas, crecimientos, decisiones, apoyo y mayores

**Gráfico mensual** (SVG propio con `calcularGeometriaCurvas` y `lecturaMes` de `src/lib/curvas/grafico.ts`, como `grafico-mensual-fila.tsx` de M7). Eje X ene…dic; eje Y unidades.
- Series, distinguidas por **trazo y grosor, no solo por color**: 2023, 2024 y 2025 reales (finas); **2023 y 2026 con guion y punto y la etiqueta «Niño»** en la leyenda (de `periodos_atipicos`, D14); 2026 real hasta `k'` (continuo, grueso) y proyectado desde `k+1` (discontinuo, grueso); si `k' > k`, en `k+1…k'` se ven los dos puntos y la lectura del mes da la diferencia; 2027 proyectado (discontinuo, el más grueso, color de acento); **«2026 sin Niño (derivado)»** (punteado fino; `meses_sin_nino`; solo con bloque «Todas» y sin tiendas elegidas; leyenda: «2026 dividido por el factor del Niño de cada mes, para ver qué parte del salto de 2027 es corrección»); la **comparada** (punteado, con su nombre y «aprobada» si lo es).
- Línea vertical en `k` («datos hasta set 2026»). Conmutadores: «Mensual · Acumulado» y encendido por serie (por defecto 2025, 2026, 2026 sin Niño y 2027; 2023 y 2024 apagadas en móvil).
- **Accesible:** `<figure aria-describedby="tabla-mensual">` con `<figcaption>` en texto («2027 proyecta 52 708 u, +5,4 % sobre el cierre 2026; el mes mayor es diciembre»); la tabla mensual es la alternativa exacta; flechas para recorrer meses, con la lectura en `aria-live="polite"`; contraste AA; < 640 px: ancho completo y leyenda debajo en dos columnas.
- Con cifras atribuidas o de marca, la leyenda dice «(estimado)» y hay una nota debajo.

**Tabla mensual** (`DataTable`, desplazamiento horizontal, primera columna fija): `2023`, `2024`, `2025`, `2026 real`, `2026 proyectado`, `2026 cierre`, `2026 sin Niño`, `2027`, la comparada, y variaciones «2027 vs 2026 cierre (%)», «2027 vs 2025 (%)» y «2026 vs 2025 (%)» mes a mes; columnas ene…dic, `Total`, `ene–k'`. Real en redonda, proyectado en cursiva **y** con «proy.» en `title` y lector de pantalla. Mes sin carga: «—» («sin carga publicada»). Años del Niño con «(Niño)» en la etiqueta.

**Desglose** (`Select`: Género · Mundo · Línea · Temporada · Agrupación de marca · Marca · Tienda): una fila por elemento con `2023`, `2024`, `2025`, `2025 ene–k'`, `2026 ene–k'`, `2026 cierre`, `2027`, `% 27/26`, `% 27/25`, `% 26/25`, `% ene–k'`, `part. 2027`; total al pie que cuadra con las tarjetas (R5). Orden por 2027 descendente; paginación de 200 (`src/lib/reportes/paginacion.ts`). Filas estimadas con `Badge` «estimado». **Elegir una fila la aplica como filtro** (D11): la serie mensual de ese elemento se ve en el gráfico, sin pedir series por elemento. «Marca» se puede elegir sin AM (la AM se deduce de la unidad).

**Crecimiento declarado, implícito y tendencia** (siempre la proyección entera; una fila por GM de HOMBRE y MUJER, el Resto y el Total):
- Declarado (`pct`, «sobre 2026 corregido» o «sobre 2026 real»), versión, autor, fecha y nota. Para HOMBRE y MUJER, de `proyeccion_crecimientos` y su versión de `crecimientos_genero_mundo`; para el **Resto**, de `parametros.crecimiento_resto_usado` (`pct`, `sobre_base`, `version`, `por_nombre`, `at`; sin nota), y solo si falta esa clave (calculada antes de `0.12.1`), `crecimiento_pct_defecto` rotulado «provisional» (I-A).
- Implícito: `Σ vigente 2027 de las filas base del GM ÷ Σ B − 1` («sobre real») y `÷ Σ B' − 1` («sobre corregido»); se compara en la base del declarado.
- **Tendencia en mismas tiendas** (ene–`k'` de `Y` frente a ene–`k'` de `Y−1`, tiendas de `M(Y)`, sin filtros): en los GM con corrección, **las dos cifras**, «−3,9 % corregida del Niño (−5,9 % en bruto)» (§4.5, I-E).
- Semáforo **en texto**, con la tendencia corregida: «coincide» (< 2 pp) · «revisar: +4,3 pp» · «contra la tendencia: declara +5,0 %, la venta va −3,9 % corregida del Niño» · «sin dato»; con «tendencia afectada por el Niño» cuando solo la bruta es negativa. Columna «Niño» si `correccionMaterial`. Anomalías como `Badge` («reemplazada el mismo día», «sin base», «sin nota»).

**Cómo se decidió** (`decisiones` del recorte, sin filtro de tienda): por año, unidades y % por origen («en bloque», «IA», «aceptada tal cual», «a mano», «escalada por tienda», «sin decidir»), autores con cuántas filas y entre qué fechas, y el día con más decisiones.

**Datos de apoyo: soles y cobertura** (`Card` con el rótulo «Datos de apoyo: estimados, no forman parte de lo que se aprueba»):
- **Soles:** 2023, 2024 y 2025 reales; 2026 real ene–`k'`; **2026 cierre y 2027 estimados**, valorizando lo proyectado de cada línea × AM al **precio medio de sus últimos 12 meses** (soles netos de IGV ÷ unidades, de `k'−11` a `k'`; si un par no vendió, el precio medio del recorte, y se informa cuántas unidades se valorizaron así). Con tiendas elegidas, el precio de esas tiendas en el recorte. Cada cifra estimada lleva «estimado» al lado (no solo en el título).
- **Cobertura:** stock del último mes publicado `k'` en tiendas y en el CD (sin tiendas elegidas), y **meses de cobertura** con la definición de M8 (decisión 42 del dueño): stock total ÷ venta media mensual **proyectada** de los 12 meses siguientes (`k'+1` en adelante), y al lado con la venta real de los últimos 12 meses. Con tiendas elegidas: solo el stock de esas tiendas, sin CD, con «estimado» si su proyección está atribuida. Nota: «El índice de cobertura con el que se compra es el de Flujo mensual; este es un dato de contexto del recorte».

**Las 10 filas mayores** (GML × AM) del recorte en 2027, con participación y crecimiento sobre su `B`.

### 4.9 Exportar a Excel

«Descargar Excel» (admin y planner), generado **en el navegador** con `descargarLibro` de `src/app/(app)/planificacion/proyeccion/descarga-libro.ts` sobre la respuesta cargada. Nombre `nombreArchivoProyeccion(Y, "direccion")` → `proyeccion-2026-2027-direccion.xlsx`. Hojas:
- `RESUMEN`: proyección, estado, quién cerró, aprobación vigente, las líneas de §4.3, comparativos (total y mismas) y una línea «Venta de filas que ya no se proyectan: 2023 3 100 u…» (`fuera_universo`, M6).
- `PUENTE`: total y por GM.
- `ALERTAS`: código, nivel, alcance, texto (incluidas las de bloqueo si es en trabajo).
- `FRENTE_APROBADA`: la diferencia por GM.
- `MENSUAL`: la tabla mensual con `TIPO` (`real`/`proyectado`/`sin_nino`/`variacion`) y `EXACTITUD`.
- `DESGLOSE`: la dimensión elegida.
- `CRECIMIENTOS`, `DECISIONES`, `APOYO` (soles y cobertura con «estimado» en su columna), `APROBACIONES` (historial con `invalidada`).
- `FILTROS`: todos los filtros (géneros, Resto, mundo, línea, temporadas, AM, unidad de marca, tiendas, bloque), la comparada, `k`, `k'`, la huella, la fecha de descarga y la nota de exactitud.

### 4.10 Decisión de dirección e historial

**Botón «Decidir»** (solo admin; oculto en archivadas) abre un `Modal` con:
- «Vas a decidir sobre *Proyección 2026–2027 (cerrada)* completa, no sobre el recorte que estás mirando», las líneas del resumen (§4.3) y las alertas «Bloquea el cierre» e «Importante».
- Tres opciones: **Aprobar** · **Aprobar con observaciones** · **Rechazar**; casilla obligatoria «Revisé las alertas y las cifras de toda la proyección».
- Aprobar: comentario opcional. Con observaciones o Rechazar: `Select` de motivo y comentario obligatorios (≥ 10 caracteres, contador visible).
- En trabajo: «Si se cierra sin cambiar cifras, tu aprobación sigue vigente; si cambia una cifra, queda invalidada». Con causas que bloquearían el cierre: se puede aprobar igual (es un juicio, no un control), pero se listan primero.
- `409 huella_distinta`: «La proyección cambió mientras la mirabas (alguien decidió o recalculó). Vuelve a cargar el tablero y revisa de nuevo», con «Recargar»; no se registra nada.
- Los botones miden ≥ 44 px de alto.

**Historial** (`Card`, todos los que ven la página): fecha y hora (Lima), quién, resultado (`Badge` con texto), motivo, comentario, «sobre: en trabajo / cerrada» e «**invalidada**: la proyección cambió después» cuando corresponde (o «**invalidada** por un cambio en el cálculo de la huella» si `invalidada_por = version_huella`, §2.3 a). Más reciente primero.

### 4.11 Avisos en Proyección y en Flujo mensual (no bloquean nada)

Ambos leen `GET /api/direccion/estado`; solo admin y planner (el comprador no ve datos de aprobación, decisión 113).
- **Proyección** (`cabecera-proyeccion.tsx`): en una cerrada sin aprobación vigente, `Alert` **ámbar** «Cerrada por *Planner P.* el 07 nov 2026 · **sin aprobación de dirección vigente** · difiere de lo aprobado el 03 nov en +1 214 u en 2027 (+1,5 %)» (o «idéntica a lo aprobado el …», o «no hay aprobaciones anteriores»), con enlace al tablero. Con aprobación vigente, una línea en texto («Dirección: aprobada por *nombre* el 08 nov»). En trabajo: una línea con el estado.
- **Flujo mensual** (`/compras/flujo`, `flujo-panel.tsx`): con `?para=compras`, el mismo `Alert` ámbar sobre la cerrada que usa el flujo: «El flujo usa *Proyección …*, cerrada por *Planner P.* el 07 nov, **sin aprobación de dirección vigente**…». Rechazada: `Alert` rojo «Dirección **rechazó** esta proyección el … (motivo)». Con aprobación vigente (aprobada o con observaciones): una línea en texto.
- Ninguno cambia lo que el flujo calcula ni deja de mostrar datos.

## 5. Reglas de negocio

### 5.1 Qué significa «aprobar a nivel de dirección»

**Qué es.** Un **juicio de dirección registrado** sobre una proyección entera, atado a su huella de cifras: «vi estas cifras, en esta fecha, y las apruebo / las apruebo con observaciones / las rechazo, por este motivo». No modifica la proyección, no decide filas y no es un paso técnico del cálculo.

**Estados** (derivados al leer; nada se actualiza):
- `sin_aprobacion`: la proyección no tiene ninguna aprobación.
- `aprobada` / `con_observaciones` / `rechazada`: la **más reciente** de esa proyección tiene la huella actual.
- `invalidada`: la más reciente tiene otra huella. Una anterior con la huella actual **no revive**: manda siempre la más reciente. Una aprobación puede **nacer invalidada** si una decisión fila a fila hace commit mientras se registra (§2.3 d, M-A), y todas se invalidan a la vez si cambia la versión de la huella (§2.3 a, I-B), lo que solo ocurre con una decisión explícita.
- **Aprobación vigente** = estado `aprobada` o `con_observaciones` (decisión del coordinador: «con observaciones» es un sí con comentarios). Los avisos de §4.11 se encienden cuando no hay vigente: `sin_aprobacion`, `rechazada` o `invalidada`.

**Sobre qué se aprueba.** Una proyección **en trabajo o cerrada**; nunca una archivada. Como la huella no incluye el estado, aprobar la en trabajo y cerrarla sin cambiar cifras deja la aprobación vigente. **La aprobación no se transfiere a una copia**: cada seguimiento mensual nace sin aprobación propia; si sus cifras son idénticas (misma huella), el tablero y los avisos lo dicen; si no, dicen cuánto difiere (D9).

**No bloquea nada** (decisión de Javier, 2026-11-10). Ni cerrar ni M8 la exigen; una `rechazada` no reabre ni archiva. Descartadas: que cerrar exija aprobación (frena el cierre mensual y toca M7), que Compras solo lea una cerrada aprobada (cambia el contrato de M8 y puede dejar el flujo sin demanda) y que un rechazo reabra la proyección (una cerrada nunca se reabre). A cambio, los avisos son visibles y dicen quién cerró y cuándo (§4.11).

**Quién aprueba: solo el `admin`** (`requireAdmin`; `rol = 'admin'` en la tabla). El planner prepara y no aprueba su propio trabajo; el comprador no ve Planificación. Un rol `direccion` sería un módulo de permisos aparte.

### 5.2 Invariantes (vitest; las de la base, también en el humo)

**Cifras**
- **R1 · Proyectado = M7.** Sin filtros y bloque «Todas», el total por año es `Σ (decidido ?? propuesto)` de los registros activos (incluidas las filas de tienda) y la suma de `meses` por mes coincide con los totales de `GET …/mensual` de M7 sobre la misma base falsa; `sin_meses` es la diferencia exacta entre total y `Σ meses`.
- **R2 · Real = M5 sin CD.** Sin filtros, el real de cada mes es `Σ unidades` de `venta_stock_vigente` de tiendas `tipo = 'Tienda'`; una venta del CD en la base falsa no aparece en ninguna cifra (sí su stock, solo en cobertura).
- **R3 · Misma tienda, misma cifra que 07f.** Para un GM (y para el Resto) sin más filtros, el «2026 cierre» de cada tienda *misma* en el tablero es igual, en enteros, al «2026 cierre vigente» de `armarVentaPorTienda` de 07f sobre la misma base falsa; el de cada tienda *entra*, a su vigente exacto.
- **R4 · Puente exacto.** Los pasos de §4.4 suman exactamente el total de 2027 y parten exactamente del cierre de 2026; `B`, `B'`, propuesta y vigente son sumas de lo guardado; la suma del puente por GM es el puente total. `delta_manual + delta_otras = vigente_con_B − propuesto_con_B`; una fila aceptada en lote cuya propuesta cambió al recalcular suma a «Otras diferencias», no a «Fijado a mano» (I-C).
- **R5 · Totales que cuadran.** En el desglose `Σ filas = total` por columna; tarjetas, tabla mensual, desglose y gráfico dicen el mismo número para el mismo año. Con marca (redondeo por mes) la diferencia es ≤ 12 u por año y se rotula.
- **R6 · Cierre del año en curso.** `2026 cierre = vendido guardado (ene–k) + proyectado (k+1–dic)`; el real del gráfico llega a `k'`; si `k' > k`, ambos se muestran sin sumarse dos veces.
- **R7 · Comparativos.** Cada % sobre sumas (nunca promedio de %); `ene–k'` del año anterior usa los mismos meses; «mismas» de «Z frente a Z−1» usa `M(Z)` arriba y abajo (de las claves guardadas: cambiar una fecha en M4 después de calcular no cambia el conjunto); para 2027 frente a 2026 coincide con `Σ vigente(base Y+1) ÷ Σ B − 1`; los pares con 2023 o 2026 llevan `nino = true`; motivos `sin_base`, `incompleto` y `nueva`.
- **R8 · Atribución por tienda.** Se cumplen exactos en enteros: `Σ_{misma} A_t + sin_atribuir_07f + Σ_{sale} A_t + sin_atribuir_sale = base(Y).vigente`; el total de 2027 atribuido más su «sin atribuir» = `base(Y+1).vigente`; por mes, `Σ tiendas + sin atribuir = meses` del bloque; por tienda, `Σ meses = total anual`; enero a `k` del año en curso es el real exacto; con un bloque entero elegido, su total es exacto; una tienda sin historia completa en el año de referencia recibe su participación anual en todos los meses; con `A_t − real_t < 0` no hay reparto mensual de `k+1` a 12 y sale `atribucion_sin_mensual`; con filas sin `B`, `L` va entero a «sin atribuir». Prueba de propiedad de `atribuirMensual` (≥ 5 000 casos, §3.4 C): ninguna celda negativa, filas y columnas cuadran exactas, determinista; `sin_atribuir_m` puede ser negativo.
- **R9 · Marca (unidad de marca).** Con una unidad de participación 0,25 en su única fila base y una fila de tienda de la misma GML × AM, lo proyectado es `round(0,25 × vigente)` por mes de las dos; una fila base sin `por_marca` suma a `sin_participacion_marca`; la venta es la de **todas** las marcas de la unidad.
- **R10 · Filtros combinados.** Géneros × mundo × línea × temporada × AM × marca × tiendas × bloque se aplican a la vez a proyección y venta. Propiedades: el total con A ∧ B es ≤ el de A y el de B; la unión disjunta de las AM suma el total sin filtro de AM; lo mismo con las temporadas; el atajo «Resto» da las mismas cifras que elegir uno a uno sus géneros; el filtro de tienda no cambia `por_tienda` de `tablero_venta`.
- **R11 · Soles y cobertura de apoyo.** Nunca se guardan ni se envían a otro módulo. Soles estimados = `Σ pares (u proyectadas × precio medio de 12 meses del par)`, con el precio del recorte para los pares sin venta (contados en `u_sin_precio`). Cobertura = stock de `k'` ÷ (Σ proyectado de `k'+1` a `k'+12` ÷ 12); con tiendas elegidas, sin CD. Toda cifra estimada va con «estimado».

**Aprobación**
- **R12 · Qué mueve la huella.** La cambian: decidir o cambiar una fila, recalcular con otra propuesta (también en una fila decidida: cambia el puente), aplicar curva nueva (`meses`), cambiar `B` o `B'`, decidir una tienda, aplicar un lote de 07g, cambiar un crecimiento de GM o el Resto **aplicado** (`crecimiento_resto_usado.pct` o `sobre_base`), cambiar `hasta_periodo` o la pertenencia de una tienda a un bloque. **No** la cambian: cambiar `crecimiento_pct_defecto` (el Resto provisional), cerrar, renombrar, editar la nota, renombrar una tienda o cambiar su zona, recalcular sin que cambie ninguna cifra, una carga nueva de venta, archivar otra proyección. **Dos proyecciones con las mismas cifras tienen la misma huella** (copia sin cambios). El texto canónico empieza con la línea `v|1` y `VERSION_HUELLA = 1` (I-B). Probado en SQL (humo) y en vitest.
- **R13 · Estado.** Es el de la aprobación más reciente frente a la huella actual; una anterior no revive; `con_observaciones` cuenta como vigente; sin aprobaciones, `sin_aprobacion`; la aprobación de otra proyección nunca da estado a esta.
- **R14 · Una sola huella para foto y registro.** El `POST` arma el `resumen` con `tablero_proyeccion(id, {})`, que trae su huella; si ≠ `huella_vista`, `409 huella_distinta` sin llamar a la función; la función vuelve a calcularla y la compara con `huella_vista` y con `resumen.huella`; la tabla exige `resumen.huella = huella` (`check`).
- **R15 · Siempre la proyección entera.** `resumen` y huella no dependen de los filtros; dos `POST` con filtros distintos guardan la misma huella y el mismo `resumen` salvo `filtros_vistos`.
- **R16 · Concurrencia.** Si entre el `GET` y el `POST` cambia una cifra, `409 huella_distinta` y ninguna fila nueva. Dos `POST` simultáneos con la misma huella insertan dos filas (es historial; a propósito no hay único). Una decisión fila a fila que hace commit entre el cálculo de la huella y el `insert` deja la aprobación recién registrada como `invalidada` (fallo seguro, M-A); el tablero lo muestra al recargar. Una proyección con `activo = false` responde `404` (M-B).
- **R17 · Inmutable.** `update` y `delete` sobre `aprobaciones_direccion` fallan también con `service_role`, salvo poner `perfil_id` en `null`; `truncate` falla; `service_role` solo tiene `select, insert`.
- **R18 · Motivo.** `con_observaciones` y `rechazada` exigen motivo del catálogo y comentario ≥ 10 caracteres (zod y `check`); `aprobada` los admite opcionales; un `rol` distinto de `admin` lo rechaza el `check`.
- **R19 · Roles.** `POST /api/direccion/aprobaciones`: `401` sin sesión, `403` planner y comprador, `201` admin. Las cinco rutas `GET`: `401`, `403` comprador, `200` admin y planner. La primera sentencia de cada handler es el guard (prueba estática).
- **R20 · Sin borrar con aprobaciones.** `DELETE /api/proyeccion/proyecciones/[id]` de una proyección con aprobaciones responde `409 tiene_aprobaciones`.
- **R21 · Archivada.** Se ve; no se aprueba (`409 archivada`, `puede_aprobar = false`).
- **R22 · Por defecto.** La proyección por defecto es la que elige `planHorizonte(hastaPorDefecto(publicados, hoy))` (la misma que lee el flujo); en enero, con la del año anterior; «Comparar con» por defecto es la proyección de la última aprobación no rechazada, salvo que sea la mostrada.

**Lo que bloquearía el cierre**
- **R23 · Las reglas de M7, sin copia.** Para toda proyección en trabajo de la base falsa (incluida una con crecimientos cambiados y otra solo desactualizada): si `POST …/cerrar` (sin `forzar`) respondería `409 X`, `GET /api/direccion/bloqueos` trae `X` **con el mismo código y el mismo mensaje** (el primero de la lista es ese `X`); si `bloqueos` está vacío, `cerrar` no responde `409` por ninguna regla de cierre; si todos son `forzable`, `cerrar` con `forzar` no responde `409` (y sin `forzar`, `409 desactualizada`). `crecimientos_cambiados` sale con su código, no como desactualizada (I-D). El conteo de filas usa `filaBloqueaCierre` y cuenta también las de `revision_cola_larga` con propuesta bajo el umbral (B2). Prueba estática: `src/lib/direccion/` no reimplementa el predicado ni importa `bloqueosDeLote`.

**Aislamiento**
- **R24 · Solo lectura.** `src/lib/direccion/` no llama a `insert`, `update`, `upsert` ni `delete` sobre tablas; el único `rpc` que escribe es `registrar_aprobacion_direccion`; no nombra `ia_*` ni `venta_proyeccion`. `tablero_venta` solo nombra `unidades`, `venta_soles` y `stock_unidades` de `venta_stock_vigente` (prueba estática sobre la migración).
- **R25 · Cerrada intacta.** Abrir el tablero y aprobar no cambia ni un byte de `GET /api/proyeccion/cerrada` ni del flujo (comparación antes y después en la base falsa).

### 5.3 Casos borde

| Caso | Comportamiento |
|---|---|
| Enero, antes del primer cierre del año | Por defecto, la cerrada del año anterior (cubre el año como «siguiente», como M8); si no hay ninguna cerrada, la en trabajo más reciente con su aviso; si no hay ninguna, `EmptyState` |
| Dos proyecciones del año (cerrada y «seguimiento» en trabajo) | Por defecto la cerrada; el selector muestra las dos y «Comparar con» las superpone |
| Copia mensual sin cambios de una aprobada | Estado «Sin aprobación de dirección»; «Frente a lo aprobado» dice «idéntica»; los avisos también |
| La última aprobada es la misma proyección y su huella cambió | Estado «invalidada»; «Frente a lo aprobado» compara contra la foto de esa aprobación |
| Proyección de método anterior | Se ve; alerta `metodo_anterior`; sin base corregida en crecimientos ni en el puente (la línea del Niño sale «—») |
| `k' > k` | Real hasta `k'`; el cierre usa `k`; alerta `datos_mas_nuevos` |
| `k = 12` | No hay proyectado del año en curso; la atribución solo reparte el año siguiente |
| Año histórico incompleto | «faltan: mar 2024» en la columna; comparativos de ese año `incompleto`; si es el año de referencia de las semillas, ese mes se toma de `Y−2` |
| Una apertura de `Y+1` sola | Historia vacía; 2027 exacto; comparativos «nueva»; `apertura_sin_historia` |
| Una tienda cerrada antes de `Y` | Solo historia; proyección 0; «cerró el 31 ago 2024» |
| Una tienda que cierra en `Y+1` sola | 2026 estimado (su parte de la base que sale, §3.4 A2); 2027 exacto hasta su cierre |
| Tienda sin venta en el recorte | Su parte es 0; si todas pesan 0, todo a «sin atribuir» |
| Venta de una tienda negativa en el periodo | Pesa 0 en la atribución (como 07f); el real se muestra tal cual |
| Marca sin participación (`por_marca` nulo) | Venta exacta; proyección vacía y `marca_estimada` «la proyección no trae participación por marca» |
| Filas sin curva | Suman al total, no al gráfico; `sin_curva` |
| Cálculo en curso | `409 calculo_en_curso` con «Reintentar» |
| La proyección cambia con el modal abierto | `409 huella_distinta`; nada se registra |
| Usuario aprobador eliminado | `perfil_id` pasa a `null`; quedan nombre y rol |
| Comparada de otro año | Permitida; se alinea por calendario; alerta si su `k` difiere |
| Más de 30 tiendas, 40 AM o 20 géneros | `400` con mensaje |
| CD | No aparece en filtros ni en venta; su stock solo en cobertura sin tiendas elegidas |
| Pantalla de 360–390 px | Filtros en modal, tarjetas 2 × 2, gráfico al ancho, tablas con primera columna fija, botón «Decidir» fijo abajo |

## 6. Criterios de aceptación / hito de prueba

### 6.1 Caso sintético (`tests/direccion.fixture.ts`)

**Proyección mostrada:** «Proyección 2026–2027», cerrada el 2026-11-07 por *Planner P.*; `Y = 2026`, `k = 9` (set); venta publicada hasta oct 2026 (`k' = 10`). `periodos_atipicos`: 2023 y 2026. Dos GM con filas: **HOMBRE · URBANO** (detallado) y **MUJER · URBANO** (solo totales). `resumen.desvio_prueba_anterior_pct = −3,2`; `crecimiento_objetivo_pct = 6,0`.

**Tiendas.** T01, T02, T03 (mismas siempre); T04 (misma en 2026, cierra el 2027-06-30); T10 (abrió el 2025-11-15: nueva del año anterior en 2026, entra a la base de 2027); T12 (apertura 2027-04-01); T09 (cerró el 2024-08-31); CD1 (con venta y stock; no debe aparecer en venta). `bloques[2026]`: mismas T01–T04, nuevas T10, fuera T09. `bloques[2027]`: mismas T01, T02, T03, T10; nuevas T12 (aperturas); cierres T04.

**Venta de HOMBRE · URBANO (unidades).** 2023: T01 19 000, T02 12 000, T03 6 000, T04 2 500, T09 500 (40 000). 2024: T01 20 000, T02 12 500, T03 6 500, T04 2 700, T09 300 (42 000). 2025 y 2026, por mes:

| Tienda | ene | feb | mar | abr | may | jun | jul | ago | set | oct | nov | dic | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| T01 2025 | 1 607 | 1 378 | 1 493 | 1 607 | 1 952 | 1 837 | 2 182 | 1 722 | 1 722 | 1 600 | 1 800 | 3 100 | 22 000 |
| T02 2025 | 996 | 853 | 924 | 995 | 1 209 | 1 138 | 1 351 | 1 067 | 1 067 | 1 083 | 1 219 | 2 098 | 14 000 |
| T03 2025 | 338 | 304 | 371 | 608 | 810 | 877 | 911 | 742 | 439 | 600 | 600 | 900 | 7 500 |
| T04 2025 | 259 | 222 | 241 | 259 | 315 | 296 | 352 | 278 | 278 | 172 | 194 | 334 | 3 200 |
| T10 2025 | — | — | — | — | — | — | — | — | — | — | 100 | 200 | 300 |
| T01 2026 | 1 556 | 1 333 | 1 444 | 1 555 | 1 889 | 1 778 | 2 111 | 1 667 | 1 667 | 1 650 | | | |
| T02 2026 | 933 | 800 | 867 | 933 | 1 133 | 1 067 | 1 267 | 1 000 | 1 000 | 1 000 | | | |
| T03 2026 | 313 | 281 | 344 | 563 | 750 | 812 | 844 | 687 | 406 | 400 | | | |
| T04 2026 | 207 | 178 | 193 | 207 | 252 | 237 | 282 | 222 | 222 | 240 | | | |
| T10 2026 | 334 | 334 | 334 | 333 | 333 | 333 | 333 | 333 | 333 | 1 010 | | | |

Totales: 2025 = 47 000 (ene–set 33 000; ene–oct 36 455, todo de T01–T04); 2026 ene–set = 34 000 (T01 15 000, T02 9 000, T03 5 000, T04 2 000, T10 3 000); oct 2026 = 4 300. CD1 vende 900 u en 2025 (no debe aparecer). Soles: el precio medio de los últimos 12 meses (nov 2025–oct 2026: 48 845 u) es **S/ 52,00** en todas las filas del recorte; 2023 S/ 1 880 000, 2024 S/ 2 016 000, 2025 S/ 2 350 000, 2026 ene–set S/ 1 768 000, ene–oct S/ 1 991 600. Stock de oct 2026: T01 8 000, T02 5 000, T03 2 500, T04 1 000, T10 1 500 (18 000 en tiendas) y CD1 12 000.

**Proyección de HOMBRE · URBANO.** Cuatro filas base: L1 · AM-A (todo el año), L1 · AM-B (todo el año), L2 · AM-A (invierno, con `factores_mes[2026]` de 0,70 en jun–ago) y L2 · AM-B (invierno, ídem).
- 2026, base (T01–T04): vigente **45 901** = vendido ene–set 31 000 + oct 3 600, nov 4 050, dic 7 251. Fila de tienda T10 (nuevas del año anterior, su fila base tiene `B`): vigente **4 100** = real 3 000 + oct 300, nov 330, dic 470. **2026 cierre = 50 001.** De los meses de las filas base de 2026, las dos L2 (invierno, φ = 0,70 en jun–ago) suman **1 720 u en jun–ago** (L2 · AM-A 1 200, L2 · AM-B 520); por eso, para ene–oct, `por_gm.Y.base_meses` suma 34 600 (31 000 + 3 600) y `base_meses_sin_nino` 34 600 + 1 720 × (1 ÷ 0,70 − 1) = **35 337,14** (I-E).
- 2027, base (M(2027)): **`B` = 47 040**, **`B'` = 47 793**, propuesta 50 183 (+5,0 % sobre `B'`), vigente **50 300**; por fila: L1 · AM-A 25 000 (lote), L1 · AM-B 12 000 (aceptada tal cual), L2 · AM-A 9 000 (a mano; propuesta 8 883), L2 · AM-B 4 300 (lote). Meses: 3 521, 3 018, 3 270, 3 521, 4 276, 4 024, 4 779, 3 772, 3 772, 4 024, 4 527, 7 796. Fila de tienda T04 (cierre, L1 · AM-B, aceptada tal cual): 150, 140, 150, 160, 200, 200 de ene a jun (**1 000**). Fila de tienda T12 (apertura, L1 · AM-A, a mano por *Admin A.* el 06 nov): 100, 120, 130, 150, 160, 150, 170, 180, 248 de abr a dic (**1 408**). **2027 = 52 708.**
- Decisiones del 07 nov por *Planner P.* salvo T12. Crecimiento declarado v2 +5,0 % sobre corregida, de *Planner P.*, sin nota.
- Unidad de marca X (en AM-A): participación 0,63 en L1 · AM-A y 0,40 en L2 · AM-A.

**MUJER · URBANO (solo totales; vende solo en T01–T03).** 2025 27 500; 2026 cierre 28 500 (vendido ene–set 20 000 + proyectado 8 500); ene–oct 2026 22 300 frente a 21 000 en 2025; `B = B' = 28 500`; propuesta 30 780 (+8,0 %), vigente **32 006**: una fila a mano (propuesta 18 780, vigente 20 006, *Admin A.*, 05 nov) y una en lote (12 000, 07 nov). Crecimiento v4 +8,0 % aprobado el 06 nov, que reemplazó a v3 el mismo día.

**Aprobación anterior:** sobre «Proyección 2026–2027 seguimiento set» (hoy archivada), *Admin A.*, 03 nov, `aprobada`, con `resumen.por_gm`: HOMBRE · URBANO 2027 52 500, MUJER · URBANO 31 000 (total 83 500); 2026 cierre total 78 300.

**Resultados esperados:**

| Cifra | Valor | Regla |
|---|---|---|
| Proyección entera: 2026 cierre / 2027 | 78 501 / **84 714** → **+7,9 %**; 2025 74 500 → **+13,7 % (último año normal)** | R1, §4.3 |
| Puente total | 78 501 − 0 − 2 961 = **75 540 (B)** + 753 + 4 670 + 1 343 (fijado a mano) + 0 (otras diferencias) + 0 = **82 306** + 0 + 1 408 + 1 000 = **84 714** | R4, §4.4 |
| Partición del puente (I-C) | `delta_manual`: HU +117 (L2 · AM-A, 9 000 − 8 883), MU +1 226 (20 006 − 18 780) → **+1 343**; `delta_otras` **0** en los dos (las aceptadas en lote o tal cual tienen vigente = propuesta). Variante (`tests/direccion.puente.test.ts`): si L1 · AM-B se recalcula y su propuesta pasa de 12 000 a 12 300 sin redecidir, crecimiento declarado **+4 970**, otras diferencias **−300**, fijado a mano +1 343 y el total sigue en **84 714**; `propuesta_cambio` = 1 | R4 |
| Frente a lo aprobado | 2027 +1 214 u (+1,5 %); HOMBRE · URBANO +208, MUJER · URBANO +1 006; 2026 cierre +201 | §4.6 |
| HOMBRE · URBANO: real 2023 / 2024 / 2025 | 40 000 / 42 000 / 47 000 (CD1 no suma) | R2 |
| 2025 ene–set / 2026 ene–set | 33 000 / 34 000 → **+3,0 %** | R7 |
| 2026 cierre | 50 001 = 34 000 + 16 001 → **+6,4 % vs 2025** (Niño), +19,0 % vs 2024 | R6 |
| Mismas 2026 vs 2025 (`M(2026)` = T01–T04) | 45 901 ÷ 46 700 − 1 = **−1,7 %** frente a +6,4 % total | R7 |
| 2027 | **52 708** → **+5,4 % vs cierre 2026**, **+12,1 % vs 2025** | R1 |
| Mismas 2027 vs 2026 | 50 300 ÷ 47 040 − 1 = **+6,9 %** sobre real; ÷ 47 793 → **+5,2 %** sobre corregido | R7 |
| Crecimientos | HU: declarado +5,0 %, implícito +5,2 % → «coincide»; tendencia en bruto **−5,9 %** (ene–oct `M(2026)`: 34 290 frente a 36 455) y **corregida del Niño −3,9 %** (φ̄ = 34 600 ÷ 35 337,14; 34 290 ÷ φ̄ = 35 020,5 frente a 36 455) → **«contra la tendencia»** (+8,9 pp con la corregida). MU (sin Niño): +8,0 % frente a +12,3 % → «revisar: +4,3 pp»; tendencia +6,2 % (una sola cifra). Resto: declarado de `crecimiento_resto_usado` | §4.5, §4.8 |
| Alertas importantes (proyección) | `contra_tendencia` (HU, con la corregida −3,9 %), `desvio_crecimiento` (MU), `factor_provisional` (invierno 2026: **13 300 u de 2027, 15,7 %**), `tienda_nueva_relevante` (T10, **5,4 % de la base**), `apertura_sin_historia` (T12) → **5** | §4.5 |
| Otras | `anomalia_crecimiento` (MU reemplazada el mismo día; HU sin nota) info; `origen_decisiones` info (49 % en bloque —41 300 u—, 15 % tal cual —13 000—, 36 % a mano —30 414—, sobre 84 714; aceptado sin cambiar 64 % < 80 %; 6 de 8 el 07 nov); `datos_mas_nuevos`; `base_corregida_nino` (HU +1,6 %); sin `concentracion` (menos de 50 filas) | §4.5 |
| Variante de tendencia (`tests/direccion.alertas.test.ts`) | Con 2025 ene–oct de `M(2026)` en 35 000 en vez de 36 455: bruta **−2,0 %**, corregida **+0,1 %** → `contra_tendencia` **informativa**, «tendencia afectada por el Niño»; quedan **4** importantes | §4.5 |
| Bloque «Mismas tiendas de 2027» | Tiendas T01, T02, T03, T10. 2025 43 800; 2026 ene–set 32 000; 2026 cierre **47 040** (= `B`); 2027 **50 300** | §4.7, R8 |
| Filtro T03 | 2025 7 500; 2026 ene–set 5 000; **2026 cierre 7 404 (estimado; idéntico al de 07f)**: real ene–set + oct 659, nov 673, dic 1 072; **2027 7 917 (estimado)**: 374, 334, 402, 615, 804, 845, 904, 731, 473, 679, 693, 1 063 (redondeo de §3.4 C); participación anual 15,7 %, por mes de 11,5 % (ene) a 22,8 % (jun) | R3, R8 |
| Atribución de 2026 (07f) | `R = 47 040 − 4 100 = 42 940` repartido 15 000 : 9 000 : 5 000 → T01 22 210, T02 13 326, T03 7 404; T04 (sale) `L = 45 901 − 42 940` = **2 961** (oct–dic 226, 260, 475) | R3, R8 |
| Atribución de 2027 | 50 300 en proporción a 22 210 : 13 326 : 7 404 : 4 100 → T01 23 749, T02 14 250, T03 7 917, T10 4 384; cada mes suma la columna de la base (3 521, 3 018, 3 270, 3 521, 4 276, 4 024, 4 779, 3 772, 3 772, 4 024, 4 527, 7 796) y ninguna celda es negativa; T10 (sin historia completa en 2025) con su participación anual en todos los meses | R8 |
| Filtro T04 | 2026 **2 961 (estimado)**; 2027 **1 000 (exacto)** | §5.3 |
| Filtro T12 | Historia vacía; 2027 **1 408** exacto; comparativos «nueva»; `apertura_sin_historia` | §5.3 |
| Unidad de marca X (con AM-A) | Venta de todas las marcas de X; 2027 ≈ 0,63 × (25 000 + 1 408) + 0,40 × 9 000 ≈ **20 237** (± 12 por redondeo mensual), «estimado» | R9 |
| Mes de oct 2026 | Real 4 300 y proyectado 3 900 a la vez; el cierre sigue en 50 001 | R6 |
| Soles (HU) | 2025 S/ 2 350 000 (real); 2026 cierre **S/ 2 600 052** (= 1 768 000 + 16 001 × 52, estimado); 2027 **S/ 2 740 816** (estimado) | R11 |
| Cobertura (HU) | Stock 30 000 (18 000 + 12 000); proyectado nov 2026–oct 2027 = 52 058 → **6,9 meses**; con real de los últimos 12 meses (48 845) → **7,4 meses**. Con T03: 2 500 sin CD ÷ (7 906 ÷ 12) → **3,8 meses (estimado)** | R11 |

**Aprobación (humo y `tests/direccion.aprobacion.test.ts`):** (1) el admin aprueba una proyección en trabajo con huella `h1` → `aprobada`; (2) el planner cambia una fila de 4 300 a 4 400 → huella `h2` → `invalidada`; (3) el admin aprueba con observaciones (motivo `crecimiento_alto`, comentario) → `con_observaciones` (vigente); (4) el planner la cierra sin tocar cifras → huella `h2`, sigue `con_observaciones`; (5) un `POST` con `h1` → `409 huella_distinta` sin fila nueva; (6) un `update` directo → error de inmutabilidad; (7) una copia sin cambios → misma huella `h2`, estado `sin_aprobacion`, «idéntica a lo aprobado»; (8) un `POST` cuyo `resumen` trae otra huella → la función responde `huella_distinta`; (9) el comprador → `403`; el planner → `403`.

**Criterios explícitos de R13, R15 y R24** (`tests/direccion.aprobacion.test.ts` y `tests/direccion.estatico.test.ts`):
- **R13 (estado):** sobre otra proyección en trabajo de la base falsa: sin aprobaciones → `sin_aprobacion`; aprobar con `h1` → `aprobada`; cambiar una fila → `h2` → `invalidada`; aprobar con observaciones con `h2` → `con_observaciones`, y `vigente` no es `null` (los avisos de §4.11 se apagan); **devolver la fila a su valor → huella `h1` otra vez → `invalidada`** (la más reciente es de `h2`; la de `h1` no revive); la copia del paso (7) tiene la huella de una aprobada y su estado sigue `sin_aprobacion` (la de otra proyección nunca le da estado). Con un `resumen.huella_version = 0` simulado → `invalidada_por = version_huella`.
- **R15 (proyección entera):** dos `POST` del admin sobre la misma proyección y la misma huella, uno con `filtros_vistos` vacío y otro con `{ generos: [HOMBRE], tiendas: [T03], bloque: "mismas" }`, guardan la misma `huella` y un `resumen` igual campo a campo salvo `filtros_vistos`; el `resumen` de ambos coincide con el de `tablero_proyeccion(id, {})` (puente total 84 714 en el caso de §6.1).
- **R24 (solo lectura):** prueba estática sobre `src/lib/direccion/` y `src/app/api/direccion/`: ningún `.insert(`, `.update(`, `.upsert(` ni `.delete(`; `.rpc(` solo con `tablero_venta`, `tablero_proyeccion`, `huella_proyeccion` y `registrar_aprobacion_direccion`, y solo en `consultas.ts`; ninguna mención de `ia_` ni de `venta_proyeccion`; en la migración, `tablero_venta` no nombra `costo_vendido` ni `stock_valorizado`. Y en tiempo de ejecución, sobre la base falsa: abrir el tablero con todos los filtros de §6.2 no cambia ninguna tabla (comparación de la base falsa antes y después); aprobar solo añade una fila a `aprobaciones_direccion`.

### 6.2 Hito (Javier y Cowork; sección **S** de `docs/pruebas/cowork-checklist.md`)

1. Como admin, Planificación → «Aprobación de dirección» abre la **cerrada que usa Compras** con su estado en texto y «cerrada por *nombre* el *fecha*»; «Comparar con» trae por defecto la última aprobada.
2. Arriba se lee, sin bajar: el resumen para decidir (3 a 5 líneas), el puente de 2026 a 2027 (total y por GM), las alertas y la diferencia con lo aprobado. El botón «Decidir» está siempre a la vista.
3. Sin filtros, el **2027** es el Total 2027 de la Matriz de M7 de esa proyección y el **2026 cierre**, el Total 2026; el puente suma exacto.
4. Filtrar por **varios géneros y el atajo «Resto»**, mundo, línea, **temporada**, agrupación de marca, marca y tiendas (solos y combinados) cambia gráfico, tarjetas, tablas y comparativos; la AM y la marca afectan lo proyectado **y** la venta de 2023 a 2026.
5. Elegir una tienda misma: su **2026 cierre es el mismo número que muestra «Ver por tienda»** en Crecimientos para su GM; mes a mes se ve real hasta set y estimado después; la participación usada está escrita.
6. 2023 y 2026 se ven como años del Niño; hay una línea «2026 sin Niño (derivado)»; la tarjeta de 2027 destaca el % frente a 2025.
7. La tabla de crecimientos muestra declarado, implícito, **tendencia** y anomalías; «Cómo se decidió» dice quién decidió, cómo y cuándo.
8. Datos de apoyo: soles reales y estimados (con la palabra «estimado» en cada cifra estimada) y meses de cobertura.
9. **Aprobar** como admin; el estado pasa a «Aprobada por *nombre*». Como planner, la página se ve igual sin «Decidir»; como comprador, el menú no tiene el item y la URL redirige.
10. Con la en trabajo aprobada, cambiar una fila en M7 y volver: «Aprobación invalidada». Con observaciones o rechazar exige motivo y comentario.
11. Dos pestañas: abrir «Decidir» en una, cambiar una fila en otra, confirmar en la primera → «La proyección cambió mientras la mirabas» y el historial no gana fila.
12. En Proyección y en Flujo mensual (admin o planner) se ve el `Alert` ámbar con quién cerró, cuándo, «sin aprobación de dirección vigente» y la diferencia con lo aprobado; Compras y el flujo funcionan igual con o sin aprobación.
13. Con una proyección en trabajo, «Bloquearían el cierre» lista lo mismo, con los mismos textos, que respondería «Cerrar»; si solo está desactualizada, lo dice como «Se puede cerrar igual».
14. «Descargar Excel» baja `proyeccion-2026-2027-direccion.xlsx` con las hojas de §4.9.
15. En un teléfono (390 px): filtros en modal, gráfico legible, tablas desplazables, «Decidir» usable.
16. Rendimiento: primera carga ≤ 3 s y cambio de filtro ≤ 2,5 s (cronómetro en producción; las mediciones SQL al pie de la migración).
17. Pasan `npm run lint`, `npx tsc --noEmit`, `npx vitest run` y `npm run build`; `APP_VERSION = "0.19.0 · M14"`.

### 6.3 Seguridad (la revisa `seguridad`, sonnet, solo lectura)

- Cada handler de `src/app/api/direccion/` empieza con su guard; `POST /aprobaciones` con `requireAdmin`; ninguna ruta usa `requireUser` (decisión 113).
- `perfil_id`, `usuario_nombre` y `rol` salen de la sesión; la huella guardada es la recalculada en la base; `resumen` lo arma el servidor.
- `aprobaciones_direccion`: RLS activo sin políticas; `anon` y `authenticated` sin privilegios; `service_role` solo `select, insert`; triggers de inmutabilidad (también `truncate`); FK `restrict`; `check (rol = 'admin')` y `check (resumen->>'huella' = huella)`.
- Funciones: `security invoker`, `search_path = ''`, todo calificado; `execute` solo `service_role`; `tablero_*` y `huella_proyeccion` `stable` sin escrituras; `registrar_aprobacion_direccion` solo inserta en su tabla. Listas como arreglos dentro del `jsonb` (sin `format`/`execute`).
- `tablero_venta` no lee `costo_vendido` ni `stock_valorizado`; los soles solo llegan a admin y planner.
- Límites: ≤ 30 tiendas, ≤ 40 AM, ≤ 20 géneros, comentario ≤ 1 000, `resumen` ≤ 64 KB, cuerpo ≤ `MAX_BYTES_CUERPO`.
- `500` sin detalles de la base; `409` con código y mensaje en castellano. El Excel se arma en el navegador con datos ya autorizados.
- Nada de datos reales en fixtures, pruebas ni ficha.

### 6.4 Pruebas (vitest; cada archivo con un solo dueño)

- `tests/direccion.fixture.ts` y `tests/direccion.fake-db.ts` (rpc falsos de las cuatro funciones sobre la base falsa de M7, con el caso de §6.1) — `backend`.
- `tests/direccion.atribucion.test.ts` (R3 contra `armarVentaPorTienda`, R8, propiedad de `atribuirMensual` con ≥ 5 000 casos de §3.4 C, incluidos filas y columnas en 0 y `T ≠ C`), `tests/direccion.puente.test.ts` (R4), `tests/direccion.tablero.test.ts` (R1, R2, R5, R6, R9, R10, R22), `tests/direccion.comparativos.test.ts` (R7), `tests/direccion.apoyo.test.ts` (R11), `tests/direccion.alertas.test.ts` (cada código de §4.5), `tests/direccion.cierre.test.ts` (R23 contra `cerrarProyeccion` sobre la base falsa, con un caso de crecimientos cambiados y otro solo desactualizado), `tests/direccion.aprobacion.test.ts` (R12 a R18, R21, la secuencia y los criterios de R13 y R15 de §6.1), `tests/direccion.rutas.test.ts` (R19, R20, errores de §3.1), `tests/direccion.estatico.test.ts` (guard primero, único archivo que nombra las funciones y la tabla, sin escrituras ni `ia_`/`venta_proyeccion` —R24—, sin copia del predicado de cierre ni `bloqueosDeLote`, columnas que nombra la migración, primera línea `v|<VERSION_HUELLA>` de la huella) — `backend`.
- `tests/direccion.vista.test.ts` (filas, textos, exactitud, hojas del Excel) y `tests/direccion.render.test.ts` (roles; «Decidir» solo admin; estado en texto; avisos en Proyección y Flujo solo para admin y planner; `409 huella_distinta`; móvil) — `frontend`.
- `tests/api.guards.roles.test.ts` (añadir las seis rutas) — `backend`.
- `scripts/humo-0041.sql` (R12 —el caso «cambiar el Resto» mueve `crecimiento_resto_usado.pct`, y cambiar `crecimiento_pct_defecto` **no** mueve la huella—, R14, R16 —también una proyección con `activo = false` → `no_encontrada`—, R17, R25 y los cuadres R1, R2 y R4 en SQL, incluido `delta_manual + delta_otras = vigente_con_B − propuesto_con_B`; dos aplicaciones de la migración sin error) — `datos`.
- `tests/direccion.qa.test.ts` (casos borde de §5.3 que falten) — `qa`.

## 7. Fuera de alcance

- Que la aprobación **bloquee** el cierre o el flujo, o que un rechazo reabra o archive una proyección (decisión de Javier, §5.1).
- Rol nuevo `direccion` y abrir Planificación a otros roles (módulo de permisos aparte).
- Aprobar **por GM o por recorte**: la aprobación es de la proyección entera. Las observaciones por GM con marca de «atendida» son de `0.19.1` (§8).
- Editar cifras desde el tablero: las decisiones se toman en M7.
- Guardar o proyectar soles: los soles del tablero se calculan al mostrar, rotulados, y no salen del tablero (decisión 110 sigue vigente para M7 y 07f).
- El índice de cobertura con que se compra (es el de M8); el tablero solo muestra el del recorte como contexto.
- La **tabla de agregados de venta** (`venta_agregada_carga` o similar): tendrá su propia ficha y tomará la siguiente migración libre cuando se construya (decisión 140).
- Proyección exacta por tienda «misma» o por marca (cambiaría M7 y el contrato de M8).
- Datos de la IA (07e), notificaciones por correo y firmas dobles.
- Cambios en 07f, M7 o M8 más allá de la traducción `409 tiene_aprobaciones` y los dos avisos de §4.11.

## 8. Segunda entrega `0.19.1 · M14` (opcional; la primera no depende de ella)

Se abre solo si Javier la pide después del hito de `0.19.0`. Nada de `0.19.0` cambia de forma: lo de aquí se **añade**.

1. **Observaciones estructuradas por GM con «atendida».** Migración propia (la siguiente libre al construir, no la `0041`): `observaciones_direccion` (solo inserción: `aprobacion_id → aprobaciones_direccion on delete restrict`, `genero_id` y `mundo_id` nulos para el Resto o el total, `texto` 10–500, `created_at`) y `observacion_direccion_atenciones` (solo inserción: `observacion_id`, `perfil_id`, `usuario_nombre`, `nota`, `created_at`); «atendida» se deriva (existe una atención). Mismo trigger de inmutabilidad y privilegios `select, insert`. Rutas: `POST /api/direccion/aprobaciones` acepta `observaciones: { gm_clave, texto }[]` (≤ 30) solo con `con_observaciones` o `rechazada`; `POST /api/direccion/observaciones/[id]/atender` con `requirePlanner`. Pantalla: en el modal, una fila por GM del puente con su caja de texto; en el tablero y en Proyección, la lista de observaciones abiertas con «Marcar atendida» (planner y admin). Regla: atender no cambia el estado de la aprobación ni la huella.
2. **Varias unidades de marca a la vez.** `marcas: listaQuery(uuid, 20)` en la query (se mantiene `marca` como sinónimo de una); `unidad_marca_ids uuid[]` en las dos funciones (en la proyección, la participación de la fila es la suma de las elegidas); la función se reemplaza con `create or replace` en la misma migración de la entrega.
3. **Hoja de Excel con el detalle por fila.** Ruta `GET /api/direccion/filas` (`requirePlanner`, mismos filtros salvo tiendas) que pagina `leerFilasConAnios` y devuelve por fila: clave legible, GML, AM, temporada, bloque, tienda, 2026 y 2027 (vigente y propuesta), `B`, `B'`, origen, autor y fecha; el navegador agrega la hoja `FILAS`. Presupuesto: ≤ 2 MB y ≤ 4 s.

## 9. Plan por tandas (cada archivo con un solo dueño)

**T0 · Revisión** (hecha): `arquitecto-revisor` y coordinador; decisiones de Javier del 2026-11-10; segunda revisión del `arquitecto-revisor` sobre `31afc87` (§12.2); esta ficha ajustada.

**T1 (en paralelo).**
- **`datos`** (≈ 700 líneas de SQL + humo de ≈ 60 comprobaciones): `supabase/migrations/0041_tablero_direccion.sql` (§2), `scripts/humo-0041.sql`, `src/lib/supabase/database.types.ts` regenerado. Antes de aplicar, incorpora lo de la segunda revisión que toca SQL: huella con la línea de versión `v|1` y el Resto de `crecimiento_resto_usado` (I-A, I-B; aplicar después congelaría el error), `delta_manual` y `delta_otras` (I-C), `por_gm.Y.base_meses` y `base_meses_sin_nino` (I-E), `and activo` en `registrar` (M-B), el comentario sobre `|` en `clave` (M-C) y los casos del humo. Prueba en local dos veces; aplica en **`vector-two`** (nunca `lukers-compras`) con el MCP (autorizado por Javier); corre el humo y **la puerta de medición de §2.4**, y anota los resultados al pie de la migración. Si el criterio de tiempo falla, aplica la salida de §2.4 en la misma migración (antes de aplicarla en `vector-two`, o con `create or replace` registrado en el mismo archivo).
- **`backend` · contratos** (≈ 350 líneas): `src/lib/direccion/tipos-api.ts` y `src/lib/direccion/esquemas.ts`, commit solo, para desbloquear a `frontend`.

**T2 (en paralelo, tras T1).**
- **`backend`** (≈ 2 500 líneas de código + ≈ 2 000 de pruebas; la tanda más grande): `consultas.ts`, `cache.ts`, `atribucion.ts` (con el redondeo de §3.4 C, B-1), `puente.ts`, `comparativos.ts`, `apoyo.ts`, `alertas.ts`, `aprobacion.ts`, `tablero.ts`, `cierre.ts` (bucle de §3.5 sobre los argumentos del cierre, I-D), `servicio.ts`; rutas `src/app/api/direccion/{opciones,tablero,bloqueos,aprobaciones,estado}/route.ts`; en M7, solo la traducción `409 tiene_aprobaciones` del `DELETE` de proyecciones; pruebas de §6.4 de su dueño. Orden interno sugerido: atribución y su propiedad primero (es lo que más riesgo tiene), luego puente y comparativos, luego rutas.
- **`frontend`** (≈ 2 000 líneas + ≈ 600 de pruebas): `src/app/(app)/planificacion/aprobacion-direccion/*` (§4.1), `src/lib/direccion/excel.ts` (hojas, puro), el item en `src/lib/nav.ts`, el `Alert` en `cabecera-proyeccion.tsx` y en `flujo-panel.tsx` (solo admin y planner); pruebas de §6.4 de su dueño.

**T3 · `qa`** (≈ 400 líneas de pruebas): las cuatro verificaciones; §6.1 y §6.2 con la base falsa; casos borde de §5.3; mide en local el tamaño de las respuestas y el tiempo de `/bloqueos`.

**T4 · `seguridad`** (sonnet, solo lectura): §6.3; hallazgos a `backend` y `datos` (una migración de corrección, si hace falta, toma la siguiente libre y se registra dentro de `0.19.0`, como la `0040`).

**T5 · `documentador`:** `CHANGELOG.md`; `docs/PLAN.md` (estado de módulos, fila de la `0041` en §5 —ver §10, decisión 140—, lista de tablas de solo inserción, versión); `docs/DECISIONES.md` (§10 de propuestas a vigentes); esta ficha (sección «Construido»); 07 §6.3 (eliminar con aprobaciones → `409 tiene_aprobaciones`) y 08 §0.2 (aviso de dirección en Flujo, sin cambio de contrato); `docs/pruebas/cowork-checklist.md` (sección S); `src/lib/version.ts` → **`0.19.0 · M14`**. Luego, hito con Javier.

## 10. Propuestas para `docs/DECISIONES.md` (desde la 134)

> **Vigentes desde el 2026-11-10** con el texto final en `docs/DECISIONES.md` (entrada «M14: tablero de aprobación de dirección»), ajustado a lo construido. Al construir se añadieron la 145 («Fijado a mano» es excluyente), la 146 (fila «Sin participación por marca»), la 147 (tope de 2 lecturas pesadas de venta simultáneas) y la 148 (con unidad de marca, cierre y comparativos estimados por participación). La lista de abajo es la propuesta original y se conserva como historia.

- **134 · El tablero de dirección es de solo lectura sobre lo guardado, en unidades, con soles y cobertura de apoyo.** Suma `meses` de la proyección y la venta publicada sin CD; nunca reparte. Soles reales de años vendidos; lo proyectado valorizado al precio medio de 12 meses de cada línea × AM, rotulado «estimado», calculado al mostrar y sin salir del tablero; stock y meses de cobertura del recorte como contexto (la definición es la de M8). Amplía la decisión 110 solo para este tablero.
- **135 · La agrupación de marca es filtro de primer nivel; la «marca» del tablero es la unidad de marca**, exacta en la venta y estimada en lo proyectado con `participaciones.por_marca`. Descartado: filtrar por la marca real (la proyección no guarda participación por marca real).
- **136 · Atribución por tienda compartida con 07f.** Total anual del año en curso: la regla 111 con la misma función (`atribuirBase`) y las mismas entradas; lo que la base resta por las tiendas que salen se les atribuye a ellas. Año siguiente: en proporción a esa base atribuida. Mes a mes: real exacto de enero a `k`; de `k+1` en adelante, ajuste biproporcional con la participación del mismo mes del último año completo (las tiendas sin año completo siguen la forma de la red), en enteros por pisos y dos pasadas deterministas (sin mes absorbente ni arrastre), sin celdas negativas, cuadrando con el mes del bloque y con el total de la tienda; el «sin atribuir» de un mes puede ser negativo y se muestra con su signo. Siempre rotulado «estimado» y con la participación a la vista. Extiende la 111; 07f no cambia.
- **137 · La aprobación de dirección es un registro de solo inserción atado a una huella de cifras por contenido.** El estado se deriva al leer y manda la más reciente; «con observaciones» cuenta como vigente; cerrar sin cambios no invalida; dos proyecciones con las mismas cifras tienen la misma huella, pero la aprobación no se transfiere a una copia (el tablero dice «idéntica a lo aprobado»). El `resumen` guardado y la huella son del mismo estado. La fórmula de la huella lleva versión (`v1`): cambiarla invalida todas las aprobaciones vigentes y solo se hace con una decisión explícita que suba la versión.
- **138 · La aprobación no bloquea el cierre ni el flujo** (Javier, 2026-11-10): avisa en Proyección y en Flujo mensual, para admin y planner, con quién cerró, cuándo, el estado y la diferencia con lo último aprobado.
- **139 · Solo el admin aprueba; sin rol nuevo; la tabla exige `rol = 'admin'`.**
- **140 · La migración `0041` es de M14 (`0041_tablero_direccion.sql`) y se retira su reserva para la tabla de agregados de venta**, que sale de M14, tendrá su propia ficha (grano `carga × tienda × equivalencia`, llenado dentro de `publicar_carga_venta_stock`) y tomará la siguiente libre al construirse. Corrige `docs/PLAN.md` §5, fila `0041` (línea 151).
- **141 · Lo que bloquearía el cierre se muestra con las reglas de M7, nunca con una copia**: `filaBloqueaCierre` para contar y `motivoRechazoCerrar` en modo comprobación, en bucle y con exactamente los argumentos de `cerrarProyeccion`, para las causas, con sus códigos y mensajes; «desactualizada» se muestra como forzable. No se usa `bloqueosDeLote` (sus mensajes son los del lote y no pasa `crecimientosCambiados`).
- **142 · El tablero abre la proyección que usa Compras (misma regla que M8) y compara por defecto con la última aprobada.**
- **143 · El desglose del tablero trae totales por elemento; la serie mensual de un elemento se ve eligiéndolo como filtro.** Descartado: series mensuales por elemento (1,15 MB por línea medido).
- **144 · 2023 y 2026 se rotulan años del Niño desde `periodos_atipicos`; el tablero destaca 2027 frente a 2025 (último año normal) y dibuja «2026 sin Niño» derivado.**

## 11. Preguntas abiertas para Javier

Ninguna bloquea la construcción; se construyó con lo indicado y **las dos siguen abiertas** (§13.4):
1. **Umbrales de las alertas:** desvío de crecimiento 2 pp, contra la tendencia 5 pp, decisión masiva 80 %, tienda relevante 5 %. Se pueden ajustar después sin migración (son constantes).
2. **Ventana del precio medio para los soles estimados:** últimos 12 meses publicados. La alternativa es el precio del mismo mes del año anterior (capta la estacionalidad del precio, pero mezcla liquidaciones).

## 12. Qué cambió respecto a las versiones anteriores

### 12.1 Primera revisión (sobre `acddbcc`)

| Hallazgo | Dónde quedó |
|---|---|
| **B1** atribución distinta de 07f y con sesgos | §3.4 (regla 111 con `atribuirBase` tal cual; tienda que entra exacta; reparto mensual por mes calendario con IPF; tiendas sin año completo normalizadas); R3 y R8; caso §6.1 recalculado (T03: 7 404 y 7 917); decisión 136 |
| **B2** conteo de bloqueo incompleto | §3.5 y `GET /bloqueos`; R23; decisión 141 |
| **B3** tamaño | §2.3 b y c (totales por elemento, índices); D11; §2.4 separa tiempo de tamaño; decisión 143 |
| **I1** plan B no construible | Fuera de M14 (D13, §2.4, §7); salida: sin marca cuando no hace falta + caché |
| **I2** `0041` reservada | M14 toma la `0041`; la reserva se retira (decisión 140; corregida la fila de `docs/PLAN.md` §5) |
| **I3** `resumen` y huella de estados distintos | D10; §2.1 `check`; §2.3 d; §3.1 POST; R14 |
| **I4** bloque en la venta histórica | §4.7 «Conjunto de tiendas de cada línea»; R7 |
| **I5** ene–`k` con tienda misma | §3.4 D (real exacto hasta `k`) |
| **I6** qué cambió y qué riesgo | Puente (§4.4), frente a lo aprobado (§4.6), precisión del método (§4.3), resumen para decidir (§4.3) |
| **I7** 2026 también Niño | D14; §4.8; `ComparativoApi.nino`; decisión 144 |
| **I8** proyección por defecto en enero | D6; §3.1 `/opciones`; R22 |
| **M1** `.partial()` y listas en JSON | §3.2 (objeto sin refinar; `filtrosVistosSchema` con arreglos) |
| **M2** cita de `aplicar_lote_proyeccion` | §2.3 d (se aparta a propósito y lo dice) |
| **M3** cifras de la base | §2.3 y §2.4 (≈ 6 130 registros, 567 y 576 nodos, 31 ms y 75 ms) |
| **M4** huella con nombres y crecimientos inactivos | §2.3 a (solo pertenencia; `activo`) |
| **M5** venta negativa | §3.4 (peso 0, como 07f); §5.3 |
| **M6** `fuera_universo` | Una línea en el Excel (`RESUMEN`), fuera de la pantalla |
| **M7** marca de conjunto, marcas nuevas, filas sin participación | D4 (unidad de marca), texto de `marca_estimada`, `sin_participacion_marca` |
| **M8** diferencia de `B` con el cierre | Línea «… y diferencia» del puente (§4.4) |
| **M9** aviso que se vuelve ruido | §4.11 con la diferencia con lo aprobado o «idéntica» |
| **M10** `clave` dentro de cada tienda | §2.2 y §2.3 a |
| **1** puente | §4.4 (total y por GM) |
| **2** bloquear el cierre | No bloquea (Javier); avisos visibles con quién cerró (§4.11, decisión 138) |
| **3** tienda estimada y con sesgo | = B1 |
| **4** «Resto», varios géneros, temporada | §3.2 y §4.7 (géneros múltiples, atajo «Resto», temporada como filtro y desglose); exposición a factores en `factor_provisional` |
| **5** «2026 sin Niño» | §2.3 b `meses_sin_nino`; §4.8 |
| **6** alertas nuevas | `contra_tendencia`, `origen_decisiones`, `anomalia_crecimiento`, exposición en `factor_provisional` (§4.5) |
| **7** soles y cobertura | D2, §4.8 «Datos de apoyo», R11 |
| **8** qué cambió desde lo aprobado | §4.6 |
| **9** observaciones estructuradas | `0.19.1` (§8); en `0.19.0`, texto libre y «con observaciones» cuenta como vigente (§5.1) |
| **10** la aprobación no viaja a una copia | Huella por contenido (D9), sin transferir; «idéntica a lo aprobado» |
| **11** precisión y objetivo | §4.3 |
| **12** orden de la página | §4.2 (para decidir arriba; «Decidir» fijo) |
| **13** proyección por defecto | = I8 |
| Menores del coordinador | Separador y nulos en la huella (§2.3 a); `check (rol = 'admin')`, más estricto que «sin comprador» porque el planner tampoco aprueba (§2.1); cifras corregidas (M3); varias marcas y hoja por fila en `0.19.1` (§8); la tabla de agregados, con su propia ficha (I1) |

### 12.2 Segunda revisión (sobre `31afc87`)

| Hallazgo | Dónde quedó |
|---|---|
| **B-1** el redondeo con arrastre y mes absorbente deja celdas en −1 y un caso sin definir | §3.4 C reescrito (pisos, faltantes por fila y columna, dos pasadas deterministas; filas y columnas con total 0 fuera de la IPF; «sin atribuir» por mes puede ser negativo y cómo se muestra); §3.4 D aclarado; R8; §6.4; decisión 136. **Cifras del caso §6.1:** cambian cuatro meses de T03 en 2027 (mar 401 → 402, abr 616 → 615, jul 903 → 904, set 474 → 473; total 7 917 igual; cobertura con T03 igual, 3,8 meses); oct–dic 2026 de T03 y T04 no cambian (verificado con script) |
| **I-A** la huella y el % declarado del Resto usaban `crecimiento_pct_defecto` | §2.2; §2.3 a punto 5 (`r\|pct\|sobre_base` de `crecimiento_resto_usado`); §4.8 (declarado del Resto); `anomalia_crecimiento` (§4.5); R12; humo (§6.4); §9 T1 |
| **I-B** la fórmula de la huella queda congelada | §2.3 a (primera línea `v\|1`, «Versión de la fórmula», `resumen.huella_version`, `VERSION_HUELLA`); `AprobacionApi.invalidada_por` (§3.3); §4.10; §5.1; R12; decisión 137 |
| **I-C** «Decisiones a mano» no medía decisiones a mano | §2.3 b (`delta_manual`, `delta_otras` en `anios[Y+1].base` y `por_gm.Y1`); `ClavePuente` y `PuenteApi.pct` (§3.3); §4.3 línea 2; §4.4 (dos líneas con ayuda); `desvio_crecimiento` (§4.5); R4; §6.1 (partición y variante) |
| **I-D** `bloqueosDeLote` no da los códigos y mensajes del cierre | D12; §3 (reutilización); §3.5 reescrito (bucle sobre `motivoRechazoCerrar` con los argumentos de `cerrarProyeccion`, `forzable`); `BloqueoCierreApi` (§3.3); §4.3 línea 5; §4.5; R23; §6.2 punto 13; §6.4; decisión 141; §2.5 |
| **I-E** `contra_tendencia` comparaba la venta del Niño en bruto con un declarado corregido | §2.3 b (`por_gm.Y.base_meses` y `base_meses_sin_nino`); §4.5 («Tendencia corregida del Niño» y la fila de `contra_tendencia`); §4.8; `CrecimientoGMApi` (§3.3); §4.3 línea 3; §6.1 (HU −3,9 % corregida, −5,9 % bruta; variante informativa) |
| **M-A** una aprobación puede nacer invalidada | §2.3 d paso 1; §5.1; R16 |
| **M-B** `registrar` no miraba `activo` | §2.3 d paso 2; R16; humo |
| **M-C** `\|` dentro de `clave` | §2.3 a punto 3 |
| **M-D** `L` mezcla filas sin `B` con lo de las tiendas que salen | §3.4 A.2 (con filas sin `B`, `L` va entero a «sin atribuir»); R8 |
| **M-E** ambigüedades de alertas | `origen_decisiones` (conjunto `lote` + `ia` + `propuesta`; denominador) y `factor_provisional` (deduplicada por fila, una sola cifra) en §4.5; §6.1 |
| Menores de coherencia | GM ausente cuenta 0 (§4.6, `DiferenciaAprobadaApi`); criterios explícitos de R13, R15 y R24 en §6.1; R23 ya no contradice §3.5 |

## 13. Construido en `0.19.0` (2026-11-10)

Commits `acddbcc`, `31afc87` y `b2b0d49` (ficha y migración), `728904c` (contratos), `172fdca` (lógica, rutas y pantalla) y `f1e871b` (arreglos tras QA y seguridad). Todo lo de §2 a §6 está construido salvo lo que dice esta sección; §8 sigue siendo la segunda entrega opcional `0.19.1 · M14`. El hito (§6.2) es la sección **S** de `docs/pruebas/cowork-checklist.md`.

**Archivos.** Además de los de §3 y §4.1, `src/lib/direccion/` tiene `contexto.ts`, `crecimientos.ts`, `rutas.ts`, `textos.ts`, `excel.ts` (las 11 hojas de §4.9, puro) y `semaforo.ts` (§13.3). Los avisos de §4.11 son un componente compartido, `src/components/direccion/aviso-direccion.tsx` con su lógica pura en `vista-aviso.ts`, montado en `cabecera-proyeccion.tsx` y en `flujo-panel.tsx`. Pruebas: los 13 archivos `tests/direccion.*.test.ts` de §6.4 más `direccion.semaforo.test.ts` (14 en total); humo `scripts/humo-0041.sql` con 135 comprobaciones sin fallos.

### 13.1 Cambios de contrato (aditivos, marcados `T1`, `T2` y `T3` en `src/lib/direccion/tipos-api.ts`)

Ninguno cambia la forma de lo que ya existía; todos son campos nuevos u opcionales, o precisiones de lo que el servidor ya mandaba.

- **T1 (contratos).** `EstadoDireccionApi.ultima` y `decidir.ultima`: la aprobación más reciente aunque esté invalidada o sea un rechazo (los avisos y los rótulos «Rechazada por …» e «invalidada … después del …» la necesitan, porque `vigente` es `null` en esos casos). `datos.tiendas` con la `SituacionTienda` de cada tienda (`mismas`, `nuevas_anterior`, `aperturas`, `cierres`, `fuera`), para agrupar el filtro de tiendas con las claves guardadas y no con las fechas de M4. `datos.fuera_universo` (va solo al Excel). Las temporadas entre las opciones.
- **T2 (construcción).** `PuenteApi.lineas[].ayuda` (texto de ayuda de cada línea; no va en la foto de la aprobación). La línea `manual` se rotula siempre «Fijado a mano» y es excluyente (decisión 145). `ComparativoApi.mismas.pct_corregido` (mismas tiendas sobre la base corregida, solo en 2027 frente al cierre). `kpis.real_ac_k_prima` (real de enero a `k'`; `kpis.real_ac` es de enero a `k`). Precisiones: `pct_u` va de 0 a 100; el declarado del Resto sin `crecimiento_resto_usado` es `null` con semáforo «sin dato». Errores con código: `comparar_igual`, `marca_fuera_de_agrupacion`, `proyeccion_no_encontrada`, `sin_calcular`, `calculo_en_curso`, `sin_proyeccion`, `archivada`, `huella_distinta`, `lectura_lenta` y `tiene_aprobaciones`. `decidir.lineas` trae cinco frases y la quinta no dice cuántas causas bloquearían el cierre: la completa la pantalla con `/bloqueos`. Los enlaces de las alertas son `null` o una ruta interna.
- **T3 (tras QA y seguridad).** Fila `sin_marca` («Sin participación por marca») en el desglose por marca (decisión 146). `kpis.real_ac_exactitud`: «estimado» con una unidad de marca (decisión 148). `ComparativoApi.advertencia`: texto corto en los pares que mezclan lo estimado por participación con la venta real de la marca. `tabla_mensual.nota`: nota al pie con los meses negativos de «sin atribuir» y la diferencia entre el anual y la suma de sus meses. Las filas `sin_atribuir_<año>` llevan como total la suma de sus meses y solo salen si algún mes no es cero. Con marca, la fila «2026 sin Niño» también es «estimado». Los textos usan el signo menos tipográfico. Nuevo `503 lectura_lenta` con `Retry-After` (§13.3).

### 13.2 Medición real (pie «MEDICIÓN 0041» de la migración, punto 5)

Medido en Vector2 el 2026-11-10 con las funciones ya aplicadas, solo lecturas, sobre la proyección cerrada con datos hasta set 2026:

| Llamada | Tiempo | Tamaño | Criterio de §2.4 |
|---|---|---|---|
| `tablero_venta`, sin filtros, `desglose = linea` | 2,25 s la primera, 2,00 s la segunda | 120 KB | ≤ 2,5 s y ≤ 150 KB: cumple |
| `tablero_venta`, temporada verano, `desglose = marca` | 1,79 s | 39 KB | |
| `tablero_venta`, `solo_tendencia` | 0,49 s | 29 KB | |
| `tablero_proyeccion`, sin desglose / por línea | 0,47 s / 0,47 s | 75 KB / 201 KB | por línea pasa de los 120 KB estimados, pero no viaja al navegador: lo consume el servidor |
| `huella_proyeccion` | 79 ms | | |

Para llegar ahí se reescribió el cuerpo de `tablero_venta`: la primera versión no terminó en 60 s en Vector2 (el planificador no ve los parámetros y elegía bucles anidados). El plan final recorre siempre toda la tabla de venta, así que **cambiar de filtro cuesta lo mismo que la primera carga**: por eso no se midieron en real los casos 2 a 4 (marca sin filtros, una agrupación, una unidad con una tienda), que en local cuestan lo mismo que el caso 1. No hizo falta la tabla de agregados (decisión 140). El presupuesto de la pantalla (primera carga ≤ 3 s, cambio de filtro ≤ 2,5 s en frío) **no se ha cronometrado desde un navegador con datos reales** (§13.4 e).

### 13.3 Cambios respecto a la especificación

- **Desglose por marca con fila «Sin participación por marca»** (decisión 146). La ficha mandaba lo que no tiene participación a `sin_participacion_marca` y a una alerta; sin una fila, el total del desglose no cuadraba con las tarjetas (R5), que fue el bloqueante de QA. Con tiendas o bloque, entre las marcas solo se reparte lo atribuido que tiene participación (§3.4 F matizado).
- **Con unidad de marca, lo vendido de enero a `k`, el cierre y los comparativos se rotulan estimados por participación** (decisión 148). La ficha (R6, R9) no distinguía lo vendido guardado × participación de la venta real de la marca.
- **«Fijado a mano» excluyente** (decisión 145): es lo que ya decía §2.3 b tras la segunda revisión; se registra como decisión porque es la cifra del puente que más se va a discutir.
- **Tope de 2 lecturas pesadas de venta simultáneas** (decisión 147, hallazgo medio de la auditoría): no estaba en la ficha. Las demás esperan hasta 5 s y, si no entran, `503 lectura_lenta` con `Retry-After: 8`; la pantalla ofrece reintentar.
- **«Sin atribuir» mensual** (§3.4 C): el total de su fila es la suma de sus meses y va con una nota; antes era el «sin atribuir» anual, que no coincidía con lo que se veía.
- **Avisos** (§4.11): el aviso rojo de rechazo sale en Proyección y en Flujo (la ficha lo pedía solo en Flujo) con un tono nuevo del kit; una aprobación invalidada lleva el mismo ámbar que la falta de aprobación.
- **Enlaces de alertas:** solo rutas internas (`/…` y nunca `//…`), hallazgo bajo de la auditoría.
- **Doble envío de «Decidir»:** el botón queda deshabilitado mientras se envía. En el servidor, dos registros iguales siguen siendo historial, a propósito (R16).

### 13.4 Pendientes y puntos abiertos

- **(a) Con tiendas elegidas, la fila de una marca en el desglose y filtrar por esa marca pueden dar cifras distintas** (y en el año en curso, también con un bloque elegido). La fila del desglose estima con una sola tasa para todas las marcas (la participación anual de las tiendas elegidas en el recorte, §3.4 F); el filtro atribuye con la venta de esa marca por tienda. Sin filtros de tienda las dos coinciden (± 2 u de redondeo), y con el bloque «mismas» entero, también su 2027. Resolverlo exige que `tablero_proyeccion` traiga la base del año siguiente por marca en `por_dim` (migración) y la venta por tienda y marca → **`0.19.1`**.
- **(b) Con unidad de marca, el real de enero a `k`** debería salir de la venta real de la marca y no de lo vendido guardado en la proyección por su participación. Hoy se rotula «estimado» (decisión 148) → **`0.19.1`**.
- **(c) La comparada por defecto toma la última aprobación (no rechazada) de cualquier proyección.** Si el admin aprueba una copia lateral (un «seguimiento» en trabajo, por ejemplo), esa pasa a ser la referencia con la que se compara la cerrada, aunque la cerrada tenga su propia aprobación más antigua. Puede ser lo que dirección quiere («lo último que aprobé») o no («lo último que aprobé de esta línea de proyecciones»). **A revisar por el arquitecto** antes de `0.19.1`.
- **(d) Los dos valores por defecto de §11 siguen abiertos:** los umbrales de las alertas (2 pp, 5 pp, 80 %, 5 %; constantes en `tipos-api.ts`, se cambian sin migración) y la ventana de 12 meses del precio medio de los soles estimados.
- **(e) No probado todavía:** el rendimiento de la pantalla con datos reales desde el navegador (primera carga y cambio de filtro, §2.4); el Excel abierto en Excel (las pruebas leen el libro con la librería, no con Excel); un lector de pantalla real y teléfonos reales (QA usó Chromium a 390 px); y los casos de enero (la cerrada del año anterior por defecto) y de `k = 12` (sin proyectado del año en curso), que no se han recorrido en la pantalla ni con datos reales.
- **(f) Recortes con tiendas o bloque sin reparto mensual (§3.4 D):** cuando en un recorte lo atribuido a una tienda que sale queda por debajo de lo que ya vendió, la regla de §3.4 D deja de repartir por mes en todas las tiendas del recorte: las tarjetas y el total anual cuadran y sale la alerta de atribución sin reparto mensual, pero los meses proyectados del año en curso se ven «—». En el caso de prueba pasa con tiendas o bloque más temporada invierno o una de las agrupaciones de marca; no se ha medido con qué frecuencia ocurre con datos reales. Resolverlo exige cambiar la regla (que lo atribuido no baje de lo ya vendido, o un reparto mensual parcial) y lo decide el arquitecto → `0.19.1`.
- **(g) Segunda ronda de QA:** con una unidad de marca y además tiendas o bloque, el cierre del año en curso mezclaba la venta real de la marca en la tienda con la estimación por participación y no cuadraba. Se corrigió de raíz antes de publicar `0.19.0` (lo vendido de enero a `k` con marca es siempre lo vendido guardado × participación, repartido entre tiendas en proporción a su venta real de cada mes) y quedó cubierto por la prueba combinatoria de `tests/direccion.invariantes.test.ts`. Campo nuevo y opcional `sin_comparada` en el tablero: distingue «es la última aprobada» de «no hay ninguna aprobada».
