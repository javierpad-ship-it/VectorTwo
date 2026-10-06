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
marcas ◄─ agrupaciones_marca   (marca ↔ equivalencia: sin tabla; se deriva de la venta real en M5)
agrupaciones_talla (catálogo cerrado: Centrales / Extremas; columna de venta y stock en Fase 2)
tiendas (Tienda / CD, fechas de apertura y cierre)
perfiles (admin · planner · comprador)
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
| `agrupaciones_estacionalidad` | `codigo` (único sobre `upper`), `nombre` (único), `descripcion` (≤ 500, opcional), `orden`; sin seed, la mantiene el planner. Una equivalencia pertenece a lo sumo a una; "faltante" = equivalencia activa y vigente sin agrupación activa | M3 |
| `tiendas` | `codigo` unique, `nombre`, `tipo` (Tienda / CD), `zona`, `razon_social`, `fecha_apertura`, `fecha_cierre`, `venta_esperada_promedio` | M4 |

Toda tabla lleva `id uuid`, `activo`, `created_at`, `updated_at` con trigger, y RLS activo sin políticas.

## 5. Módulos

### Fase 1 — Cimientos y maestros

| Módulo | Estado | Qué se construye | Hito de prueba |
|---|---|---|---|
| **M0 Cimientos** | ✅ hito recorrido en Railway el 2026-10-05 (login de Javier, base real) | Scaffold; migración base; login; guards; menú por rol; `/usuarios`; agentes; docs; Railway | Login como admin, crear planner y comprador, verificar qué ve cada uno, build limpio |
| **M1 Árbol de producto** | ✅ hito recorrido en Railway el 2026-10-05: árbol real importado (8 · 5 · 86 · 556 · 1 691 + 265) | Géneros, Mundos, Líneas, nodos Género-Mundo-Línea, Equivalencias, Agrupaciones talla; pantalla Árbol navegable; carga CSV inicial | Cargar el árbol real completo y recorrerlo; misma Línea en dos Género-Mundo con equivalencias distintas |
| **M2 Marcas** | ✅ construido 2026-10-05 (`0.3.0 · M2`); hito pendiente de recorrer por Javier | Migración `0002_marcas.sql`: `agrupaciones_marca` (seed ULTRA LOW · MID VALUE · VALOR · RECONOCIDO · PREMIUM, orden 10..50, nombres editables) y `marcas` (agrupación obligatoria, bandera de tratamiento especial con nota ≤ 200 que exige la bandera). API de agrupaciones (escribe el admin) y de marcas (escribe el planner), importador CSV/Excel de marcas en modos previsualizar y aplicar, idempotente, con diferencias contra lo ya cargado. Pantalla `/maestros/marcas` con pestañas Marcas · Agrupaciones · Importar. El vínculo Marca ↔ Equivalencia no existe como tabla: se deriva de la venta real en M5 (decidido por Javier el 2026-10-06) | Renombrar una agrupación y verlo reflejado; crear marcas, moverlas de agrupación, marcar tratamiento especial; importar un CSV de prueba y reimportarlo sin duplicar; luego la lista real |
| **M3 Agrupaciones de estacionalidad** | ✅ construido 2026-10-06 (`0.4.0 · M3`); hito pendiente de recorrer por Javier | Migración `0003_agrupaciones_estacionalidad.sql`: tabla `agrupaciones_estacionalidad` sin seed (código, nombre, descripción ≤ 500, orden) y columna nullable `equivalencias.agrupacion_estacionalidad_id` con `on delete restrict`. API (lee cualquier usuario, escribe el planner): catálogo de agrupaciones con conteo de equivalencias, asignación individual por `PATCH` de la equivalencia y masiva en tandas (`/api/estacionalidad/asignar`), lista plana y reporte de faltantes, importador de cinco columnas que crea agrupaciones y asigna sin tocar el árbol, árbol con la agrupación de cada equivalencia. Pantalla `/maestros/estacionalidad` con pestañas Agrupaciones · Asignación (Por árbol y Por agrupación, selección múltiple, Asignar / Mover / Quitar) · Faltantes (chips por género, motivo y real/genérica; CSV en el formato del importador) · Importar; columna Agrupación en el árbol con `Select` instantáneo y contador "N sin agrupación" por línea. Sin curvas: solo agrupa | Toda equivalencia activa tiene agrupación: la pestaña Faltantes queda vacía (con el árbol real empieza en 1 956) |
| **M4 Tiendas y aperturas** | 📝 especificado, pendiente de aprobación (`docs/modulos/04-tiendas.md`) | Tabla `tiendas` sin seed: código real de la tienda, tipo Tienda / Centro de Distribución, zona y razón social como texto normalizado, fechas de apertura y cierre, venta esperada; estado Planificada / Activa / Cerrada calculado con la fecha de Lima, no guardado; línea de tiempo de aperturas y cierres; importador del archivo de códigos de tiendas. Independiente de M2 y M3 | Tienda futura aparece Planificada y pasa a Activa al llegar la fecha (simulable con `?hoy=`) |

### Fase 2 — Planificación (se especifica al cerrar la Fase 1)

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
- Agrupaciones de estacionalidad: no hay lista que entregar. La pantalla de M3 está construida (`0.4.0 · M3`); falta que Javier recorra el hito con el árbol real y cierre la clasificación hasta que Faltantes quede vacía. Siguen abiertas las preguntas de `docs/modulos/03-agrupaciones-estacionalidad.md` que no bloquean: si la genérica `SIN EQUIVALENCIA` debe llevar agrupación (hoy sí la exige), si el archivo debe mandar al reasignar (hoy manda y lo muestra), si la agrupación será obligatoria al crear una equivalencia (hoy no), si la temporada debería vivir también en la agrupación (para M6) y el nombre corto o largo en el menú.
- Lista de tiendas actuales (sirve el archivo CODIGOS DE TIENDAS LUKERS de V1) → M4.
- Conectar el servicio Railway al repo cuando M0 esté pusheado.
