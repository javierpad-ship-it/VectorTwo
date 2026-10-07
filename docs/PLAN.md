# Vector2 · Plan maestro

> Sistema de planificación de producto de Lukers. Segunda versión, construida desde cero tomando Vector-One solo como referencia.
> Dueño del producto: Javier Pérez. Última actualización: octubre 2026.

## 1. Por qué una V2

Vector-One demostró el flujo estacionalidad → proyección → plan de compra, pero creció sobre un árbol de producto (Mundo → Línea → Sublínea → Categoría) y un modelo de "Flujos" que ya no representan cómo se planifica en Lukers. V2 parte del árbol real, se construye **módulo por módulo con un hito de prueba al final de cada uno**, y repite solo los patrones de V1 que funcionaron: datos con `service_role` desde el servidor y RLS sin políticas, guards por rol, maestros editables, migraciones idempotentes versionadas.

## 2. Decisiones de base

| Tema | Decisión |
|---|---|
| Base de datos y auth | Supabase, proyecto nuevo `vector-two`. V1 (`lukers-compras`) queda intacto |
| Despliegue | Railway (`railway.json`), servicio conectado a la rama principal del repo |
| Stack | Next.js 16 (App Router) · TypeScript estricto · Tailwind 4 · zod · vitest |
| Idioma | Dominio en español: tablas, columnas, rutas, UI, commits |
| Datos reales | Nunca en el repo (`datos/` ignorada) |

Por qué no la base de datos de Railway: no trae Auth (habría que construir login y usuarios), es un Postgres crudo sin dashboard ni RLS lista, sus backups dependen del plan y del volumen, cobra por tiempo encendido, y no se puede operar desde Claude Code como sí Supabase (migraciones, consultas, tipos). A favor tendría latencia menor y una sola factura; no compensa.

## 3. Roles

| Rol | Puede |
|---|---|
| `admin` | Todo, incluida la administración de usuarios |
| `planner` | Editar maestros y trabajar la planificación |
| `comprador` | Solo lectura hoy; en Fase 3 registra sus compras |

Un usuario `activo = false` conserva su cuenta pero no entra. El sistema conserva siempre al menos un admin activo y nadie puede desactivarse ni eliminarse a sí mismo.

## 4. Árbol de producto (Fase 1)

Reglas confirmadas con Javier:

- Los **Mundos existen en todos los Géneros** (no hay relación Género↔Mundo).
- Una **Línea puede estar en más de un Género-Mundo** → la Línea es catálogo y se activa por nodo.
- La **Equivalencia cuelga del nodo Género-Mundo-Línea** (Denim-Hombre-Urbano y Denim-Mujer-Urbano tienen equivalencias distintas).
- Una **Marca está en más de una Equivalencia**, pero esa relación **no se mantiene como tabla**: se deriva de la venta real que carga M5 (decidido 2026-10-06).
- **Agrupación Talla**: dos valores, *Tallas centrales* y *Tallas extremas*, como catálogo cerrado. No hay tallas individuales: la venta y el stock llegan ya consolidados por agrupación, que en Fase 2 será una columna de esas filas.
- **Equivalencia `-`** en el archivo = la equivalencia se llama igual que la línea (se crea como real). **Equivalencia vacía** = genérica `SIN EQUIVALENCIA` por nodo.
- Las filas sin equivalencia definida (vacío o `-` en el archivo) caen en una equivalencia genérica `SIN EQUIVALENCIA` por nodo (`es_generica`).
- **Toda línea tiene mundo.** No existe un mundo comodín: una fila de archivo con el mundo vacío es un error del archivo, el importador la omite (`mundo_vacio`) y la previsualización la lista para corregirla.

```
generos ──┐
mundos  ──┼─► genero_mundo_linea (nodo) ─► equivalencias ─► agrupacion_estacionalidad_id (M3)
lineas  ──┘
generos ◄─ agrupacion_estacionalidad_genero ─► agrupaciones_estacionalidad (M3: una agrupación, uno o más géneros; la equivalencia solo entra en una que incluya su género)
marcas ◄─ agrupaciones_marca   (marca ↔ equivalencia: sin tabla; se deriva de la venta real en M5)
agrupaciones_talla (catálogo cerrado: Centrales / Extremas; columna de venta y stock en Fase 2)
tiendas (Tienda / CD, fechas de apertura y cierre)
perfiles (admin · planner · comprador)
generos × mundos ─► responsables_genero_mundo ─► perfil_id → perfiles con rol comprador (M1b: un titular por combinación; ausencia de fila = sin responsable)
```

| Tabla | Columnas clave | Módulo |
|---|---|---|
| `perfiles` | `id → auth.users`, `email`, `nombre`, `rol`, `activo` | M0 |
| `generos` | `codigo` (H, M, I…), `nombre`, `orden` | M1 |
| `mundos` | `codigo`, `nombre`, `orden`; seed de 5 (CASUAL, URBANO, DEPORTIVO, FORMAL, RI) | M1 |
| `lineas` | `codigo`, `nombre`, `temporada` (Verano / Invierno / Todo el año) | M1 |
| `genero_mundo_linea` | `genero_id`, `mundo_id`, `linea_id`, unique de la tripleta | M1 |
| `equivalencias` | `genero_mundo_linea_id`, `codigo`, `nombre`, `es_generica`; unique(nodo, nombre), unique(nodo, codigo), una genérica por nodo; `agrupacion_estacionalidad_id` (nullable, `on delete restrict`, con índice) la añadió M3 | M1 (FK en M3) |
| `agrupaciones_talla` | `codigo`, `nombre`, `orden`; seed Centrales / Extremas; catálogo fijo, solo lectura | M1 |
| `agrupaciones_marca` | `codigo`, `nombre`, `orden`; seed de 5 (ULTRA LOW, MID VALUE, VALOR, RECONOCIDO, PREMIUM), editable | M2 |
| `marcas` | `codigo`, `nombre` (único global), `agrupacion_marca_id` (obligatoria), `tratamiento_especial`, `nota_tratamiento` (≤ 200, solo con la bandera) | M2 |
| `equivalencia_marca` | **Descartada (2026-10-06)**: no existe ni existirá. Qué marcas hay en cada equivalencia se deriva de la venta real que carga M5 | — |
| `agrupaciones_estacionalidad` | `codigo` (único sobre `upper`), `nombre` (único), `descripcion` (≤ 500, opcional), `orden`; sin seed, la mantiene el planner. Una equivalencia pertenece a lo sumo a una; "faltante" = equivalencia activa y vigente sin agrupación activa. Pertenece a uno o más géneros (tabla de abajo) y solo acepta equivalencias de esos géneros; sin ninguno (las heredadas de antes de `0005`) no acepta asignaciones. Desde `0.6.0` las listas la muestran por nombre, y `orden` solo fija el color | M3 |
| `agrupacion_estacionalidad_genero` | `agrupacion_estacionalidad_id` (`on delete cascade`), `genero_id` (`on delete restrict`); único sobre la pareja; sin `activo` (el vínculo existe o no existe) y sin seed. Backfill de `0005`: el género de cada equivalencia ya asignada pasa a ser género de su agrupación; las agrupaciones sin equivalencias quedan sin género. La regla "una equivalencia solo entra en una agrupación que incluya su género" no cabe en un `check` ni en una FK: la hacen cumplir el backend y la pantalla | M3 (`0005`) |
| `tiendas` | `codigo` (código real de la tienda, obligatorio, no derivado del nombre; único sobre `upper`), `nombre` (único), `tipo` (Tienda / Centro de Distribución), `zona` y `razon_social` (texto libre normalizado, opcionales), `fecha_apertura`, `fecha_cierre` (último día con venta; exige apertura y no puede ser anterior), `venta_esperada_promedio` (`numeric(14,2)`, soles por mes, solo para Tienda). Sin seed ni FKs. El estado Planificada / Activa / Cerrada no es columna: se calcula con la fecha de Lima | M4 |
| `responsables_genero_mundo` | `genero_id` (`on delete restrict`), `mundo_id` (`on delete restrict`), `perfil_id` (`on delete cascade`, obligatorio; la API solo asigna compradores activos); `activo` por convención y sin uso (la API no lo expone; quitar un responsable borra la fila); único `(genero_id, mundo_id)`: un titular por combinación género × mundo; índices por `mundo_id` y `perfil_id`. Sin seed. Guarda solo las combinaciones asignadas: la ausencia de fila es "sin responsable" y la matriz de 8 × 5 = 40 se arma en memoria con el producto cartesiano de géneros y mundos (no hay tabla de pares). "Faltante" = combinación vigente (género y mundo activos) sin responsable válido (sin fila, desactivado o que ya no es comprador); se calcula, no se guarda. Desactivar o cambiar el rol del comprador conserva la asignación; eliminarlo libera sus combinaciones (cascada) | M1b (`0006`) |

Toda tabla lleva `id uuid`, `activo`, `created_at`, `updated_at` con trigger, y RLS activo sin políticas.

## 5. Módulos

### Fase 1 — Cimientos y maestros

| Módulo | Estado | Qué se construye | Hito de prueba |
|---|---|---|---|
| **M0 Cimientos** | ✅ hito recorrido en Railway el 2026-10-05 (login de Javier, base real) | Scaffold; migración base; login; guards; menú por rol; `/usuarios`; agentes; docs; Railway | Login como admin, crear planner y comprador, verificar qué ve cada uno, build limpio |
| **M1 Árbol de producto** | ✅ hito recorrido en Railway el 2026-10-05: árbol real importado (8 · 5 · 86 · 556 · 1 691 + 265) | Géneros, Mundos, Líneas, nodos Género-Mundo-Línea, Equivalencias, Agrupaciones talla; pantalla Árbol navegable; carga CSV inicial | Cargar el árbol real completo y recorrerlo; misma Línea en dos Género-Mundo con equivalencias distintas |
| **M2 Marcas** | ✅ construido 2026-10-05 (`0.3.0 · M2`); hito pendiente de recorrer por Javier | Migración `0002_marcas.sql`: `agrupaciones_marca` (seed ULTRA LOW · MID VALUE · VALOR · RECONOCIDO · PREMIUM, orden 10..50, nombres editables) y `marcas` (agrupación obligatoria, bandera de tratamiento especial con nota ≤ 200 que exige la bandera). API de agrupaciones (escribe el admin) y de marcas (escribe el planner), importador CSV/Excel de marcas en modos previsualizar y aplicar, idempotente, con diferencias contra lo ya cargado. Pantalla `/maestros/marcas` con pestañas Marcas · Agrupaciones · Importar. El vínculo Marca ↔ Equivalencia no existe como tabla: se deriva de la venta real en M5 (decidido por Javier el 2026-10-06) | Renombrar una agrupación y verlo reflejado; crear marcas, moverlas de agrupación, marcar tratamiento especial; importar un CSV de prueba y reimportarlo sin duplicar; luego la lista real |
| **M3 Agrupaciones de estacionalidad** | ✅ construido 2026-10-06 (`0.4.0 · M3`; cambio de géneros en `0.6.0 · M3`); hito pendiente de recorrer por Javier | Migración `0003_agrupaciones_estacionalidad.sql`: tabla `agrupaciones_estacionalidad` sin seed (código, nombre, descripción ≤ 500, orden) y columna nullable `equivalencias.agrupacion_estacionalidad_id` con `on delete restrict`. API (lee cualquier usuario, escribe el planner): catálogo de agrupaciones con conteo de equivalencias, asignación individual por `PATCH` de la equivalencia y masiva en tandas (`/api/estacionalidad/asignar`), lista plana y reporte de faltantes, importador de cinco columnas que crea agrupaciones y asigna sin tocar el árbol, árbol con la agrupación de cada equivalencia. Pantalla `/maestros/estacionalidad` con pestañas Agrupaciones · Asignación (Por árbol y Por agrupación, selección múltiple, Asignar / Mover / Quitar) · Faltantes (chips por género, motivo y real/genérica; CSV en el formato del importador) · Importar; columna Agrupación en el árbol con `Select` instantáneo y contador "N sin agrupación" por línea. Sin curvas: solo agrupa. **Géneros (`0.6.0`, migración `0005_agrupacion_estacionalidad_genero.sql`)**: cada agrupación pertenece a uno o más géneros y solo acepta equivalencias de esos géneros (API, asignación masiva e importador lo hacen cumplir; el filtro de género de Asignación y Faltantes solo ofrece las agrupaciones que aplican); las listas de agrupaciones van en orden alfabético. AASE_INVIERNO y TES HO INV LIGERO quedaron sin género tras el backfill y esperan que Javier les ponga uno | Toda equivalencia activa tiene agrupación: la pestaña Faltantes queda vacía (con el árbol real empieza en 1 956) |
| **M4 Tiendas y aperturas** | ✅ construido 2026-10-06 (`0.5.0 · M4`); hito pendiente de recorrer por Javier | Migración `0004_tiendas.sql`: tabla `tiendas` sin seed ni FKs (código real único sobre `upper(codigo)`, nombre único, tipo Tienda / Centro de Distribución, zona y razón social como texto libre normalizado, fechas de apertura y cierre con checks cruzados, venta esperada solo para Tienda). API (lee cualquier usuario, escribe el planner): `GET/POST /api/tiendas` con filtros y `estado` calculado en cada fila, `PATCH/DELETE /api/tiendas/[id]`, `GET /api/tiendas/aperturas` (eventos por fecha y resumen), `POST /api/tiendas/importar` (previsualizar / aplicar, 12 motivos de omisión, diferencias contra las existentes que no modifica, idempotente). El estado se calcula con la fecha de Lima (apertura = hoy ya es Activa; cierre = hoy sigue Activa); una tienda cerrada conserva `activo = true`. Pantalla `/maestros/tiendas` (admin y planner) con pestañas Tiendas (alta con vista previa del estado, filtros, edición en línea, desactivar con aviso si está Activa) · Calendario (aperturas y cierres por mes, "Ver la red al día") · Importar (ocho columnas, `Tda#` sin mapear, aviso de tiendas sin fecha de apertura). Independiente de M2 y M3 | Tienda futura aparece Planificada y pasa a Activa al llegar la fecha (simulable con "Ver la red al día" o `?hoy=`); luego cargar la lista real de tiendas |
| **M1b Responsables género-mundo** | ✅ construido 2026-10-07 (`0.7.0 · M1b`); hito pendiente de recorrer por Javier | Migración `0006_responsables.sql` (`0.7.0 · M1b`): tabla `responsables_genero_mundo`. Cada combinación género × mundo (hoy 8 × 5 = 40) tiene un responsable que es un usuario con rol `comprador`; sirve para que los compradores filtren lo que les toca comprar, no limita permisos (decidido con Javier). API: `GET /api/responsables` (matriz, catálogos, compradores asignables y resumen de faltantes; lee cualquier usuario), `PUT /api/responsables` y `POST /api/responsables/asignar` (individual y en bloque; escribe el planner). Pantalla `/maestros/responsables` (la ven los tres roles; el comprador en solo lectura con "Mis combinaciones"): matriz con selector por celda, asignación en bloque por fila, columna o toda la matriz, filtros Faltantes / Mis combinaciones / por responsable y CSV; el árbol muestra el responsable como texto (solo lectura). `/usuarios` suma la columna "Responsable de". Al desactivar al comprador o cambiarle el rol, la asignación se conserva y cuenta como faltante; al eliminarlo, queda sin asignar (`/usuarios` avisa, no bloquea). Aplicada en Vector2 el 2026-10-07 (8 géneros × 5 mundos = 40 combinaciones; todavía no hay compradores creados). Numerada M1b para no renombrar la Fase 2; independiente de M2–M4; entra antes de M5, que no lo usa (lo consumen M7, M8 y M9) | Repartir las 40 combinaciones entre compradores hasta que Faltantes quede vacío; desactivar, cambiar de rol y eliminar a un comprador con combinaciones y ver el aviso y el efecto en la matriz |

### Fase 2 — Planificación (se especifica al cerrar la Fase 1)

La Fase 1 está completa en construcción (M0 a M4 y M1b). Al validar Javier los hitos de M2, M3, M4 y M1b se especifica la Fase 2, empezando por M5.

- **M5** Carga de histórico de ventas y stock mensual por tienda al grano del árbol. Resuelve la equivalencia de cada fila con la misma regla del árbol (`src/lib/arbol/normalizar.ts`): `-` = la equivalencia que se llama como la línea; vacío = la genérica `SIN EQUIVALENCIA` del nodo. Las filas cuya combinación no exista en el árbol se reportan antes de cargar, igual que en el importador de M1.
- **M6** Curvas de estacionalidad por agrupación de estacionalidad, calculadas sobre la venta real cargada en M5 (decidido 2026-10-06: no hay curvas manuales ni cálculo en Fase 1). Queda por decidir al especificar M6 si la curva es por agrupación para toda la red o por agrupación × tienda.
- **M7** Proyección anual de unidades por Género / Mundo / Línea / Equivalencia / Agrupación marca / Marca (5 principales por equivalencia) / Agrupación talla.
- **M8** Flujo de mercadería y necesidad de compra → documento para compradores.

### Fase 3 — Compradores

- **M9** Herramienta para que los compradores registren sus compras y llenen los vacíos contra la necesidad.

## 6. Equipo de agentes y metodología

Agentes en `.claude/agents/`:

| Agente | Rol |
|---|---|
| `arquitecto` | Especificación del módulo en `docs/modulos/NN-*.md` antes de construir |
| `datos` | Migraciones idempotentes, aplicación en Supabase, tipos regenerados |
| `backend` | Route handlers con zod y guards; reglas de negocio puras con tests |
| `frontend` | Pantallas con el kit de UI; registro en `nav.ts` |
| `qa` | Lint, tsc, vitest, build, revisión del diff y checklist del hito en Chromium |
| `documentador` | README, PLAN, DECISIONES, CHANGELOG y ficha del módulo |

En Fase 2 se suma `analista-planeamiento`, que define fórmulas y casos de prueba antes de implementarlas.

Ciclo de cada módulo:

1. Especificación (`arquitecto`) → Javier la aprueba.
2. Migración (`datos`) aplicada, tipos regenerados.
3. API y UI (`backend` y `frontend`).
4. Puerta QA (`qa`). Nada se commitea si falla.
5. Documentación (`documentador`) y commit con prefijo `Mn:`.
6. Hito de prueba: Javier lo recorre en local (`INICIAR.cmd`) o en Railway y da el OK.

Definition of Done: migración aplicada e idempotente · tipos regenerados · todas las rutas con guard · pantalla usable por el rol correcto · lint, tsc, tests y build limpios · checklist del hito cumplido · ficha del módulo actualizada · `APP_VERSION` subida.

## 7. Pendientes que entrega Javier

- Proyecto Supabase `vector-two` creado en el dashboard (la creación desde la sesión expiró). Bloquea los hitos de M0 y M1 contra la base real.
- Árbol real: recibido (`datos/arbol-lineas.csv`) y verificado con el importador. Resuelto: las 14 filas con mundo vacío son errores del archivo (no existe un mundo SIN ASIGNAR; se omiten y se listan en la previsualización) y vacío y `-` en equivalencia significan lo mismo. Faltan las respuestas al resto de preguntas abiertas de `docs/modulos/01-arbol-producto.md` (agrupar géneros, temporadas de las líneas, significado de RI y OTROS, códigos ASCII, visibilidad para el comprador) → M1.
- Tallas: resuelto, no hay tallas individuales; la venta y el stock llegan consolidados por agrupación.
- Agrupaciones de marca: recibidas y ya cargadas como semilla de `0002_marcas.sql` (ULTRA LOW, MID VALUE, VALOR, RECONOCIDO, PREMIUM; renombrables desde la pantalla). Falta la lista real de marcas con su agrupación para importarla desde `/maestros/marcas` → Importar (columnas `MARCA`, `AGRUPACION` y, opcional, `TRATAMIENTO_ESPECIAL`), y las respuestas al resto de preguntas abiertas de `docs/modulos/02-marcas.md`. Resuelta la del vínculo marca ↔ equivalencia (2026-10-06): no hay tabla, se deriva de la venta en M5.
- Agrupaciones de estacionalidad: no hay lista que entregar. La pantalla de M3 está construida (`0.4.0 · M3`); falta que Javier recorra el hito con el árbol real y cierre la clasificación hasta que Faltantes quede vacía. Con el cambio de géneros (`0.6.0 · M3`) toca además ponerles género a las dos agrupaciones que quedaron "sin género" tras la migración (AASE_INVIERNO y TES HO INV LIGERO), que hasta entonces no aceptan asignaciones. Siguen abiertas las preguntas de `docs/modulos/03-agrupaciones-estacionalidad.md` que no bloquean: si la genérica `SIN EQUIVALENCIA` debe llevar agrupación (hoy sí la exige), si el archivo debe mandar al reasignar (hoy manda y lo muestra), si la agrupación será obligatoria al crear una equivalencia (hoy no), si la temporada debería vivir también en la agrupación (para M6) y el nombre corto o largo en el menú.
- Lista de tiendas actuales (sirve el archivo CODIGOS DE TIENDAS LUKERS de V1) → M4. La pantalla de M4 está construida (`0.5.0 · M4`); falta que Javier recorra el hito y cargue la lista desde `/maestros/tiendas` → Importar (columnas `CODIGO` y `NOMBRE` obligatorias; `TIPO`, `ZONA`, `RAZON_SOCIAL`, `FECHA_APERTURA`, `FECHA_CIERRE` y `VENTA_ESPERADA` opcionales; `Tda#` se ignora). Sin fecha de apertura una tienda queda Planificada, así que conviene traer las fechas, aunque sean aproximadas. Siguen abiertas las preguntas de `docs/modulos/04-tiendas.md`: archivo de origen y fechas (1), si los archivos de venta traen el código de tienda (2), zona como catálogo si se proyecta por zona (3), unidad y base de la venta esperada (4), estado del CD sin fechas, que hoy sale Planificada (5), si el cierre es el último día con venta (6), si el importador debe actualizar existentes (7), tiendas que cierran y reabren (8) y visibilidad para el comprador (9).
- Responsables género-mundo (M1b): la pantalla está construida (`0.7.0 · M1b`) y la tabla está vacía. Falta crear los compradores desde `/usuarios` (hoy solo existe el admin) y repartir las 40 combinaciones desde `/maestros/responsables` hasta que no quede ninguna faltante. Siguen sin responder las preguntas abiertas de `docs/modulos/01b-responsables.md`; mientras tanto rigen sus valores por defecto: un solo titular (1), solo comprador asignable (2), las combinaciones sin líneas cuentan como faltantes (3), el comprador abre en "Mis combinaciones" (4), el árbol solo muestra el responsable, sin filtro (5), desactivar o cambiar el rol conserva la asignación y la marca como faltante (6) y el menú dice "Responsables género-mundo" (7). QA recomienda repetir el hito de la asignación en bloque una vez contra la base real.
- Conectar el servicio Railway al repo cuando M0 esté pusheado.
