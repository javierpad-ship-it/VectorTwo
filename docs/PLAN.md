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
- Una **Marca está en más de una Equivalencia** → relación muchos a muchos.
- **Agrupación Talla**: dos valores, *Tallas centrales* y *Tallas extremas*, como catálogo cerrado. No hay tallas individuales: la venta y el stock llegan ya consolidados por agrupación, que en Fase 2 será una columna de esas filas.
- **Equivalencia `-`** en el archivo = la equivalencia se llama igual que la línea (se crea como real). **Equivalencia vacía** = genérica `SIN EQUIVALENCIA` por nodo.
- Las filas sin equivalencia definida (vacío o `-` en el archivo) caen en una equivalencia genérica `SIN EQUIVALENCIA` por nodo (`es_generica`).
- **Toda línea tiene mundo.** No existe un mundo comodín: una fila de archivo con el mundo vacío es un error del archivo, el importador la omite (`mundo_vacio`) y la previsualización la lista para corregirla.

```
generos ──┐
mundos  ──┼─► genero_mundo_linea (nodo) ─► equivalencias ─┬─► equivalencia_marca ◄─ marcas ◄─ agrupaciones_marca
lineas  ──┘                                               └─► agrupacion_estacionalidad_id (M3)
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
| `equivalencias` | `genero_mundo_linea_id`, `codigo`, `nombre`, `es_generica`; unique(nodo, nombre), unique(nodo, codigo), una genérica por nodo; `agrupacion_estacionalidad_id` la añade M3 | M1 (FK en M3) |
| `agrupaciones_talla` | `codigo`, `nombre`, `orden`; seed Centrales / Extremas; catálogo fijo, solo lectura | M1 |
| `agrupaciones_marca` | `nombre` | M2 |
| `marcas` | `nombre`, `agrupacion_marca_id` | M2 |
| `equivalencia_marca` | `equivalencia_id`, `marca_id`, unique | M2 |
| `agrupaciones_estacionalidad` | `nombre`, `descripcion` | M3 |
| `tiendas` | `codigo` unique, `nombre`, `tipo` (Tienda / CD), `zona`, `razon_social`, `fecha_apertura`, `fecha_cierre`, `venta_esperada_promedio` | M4 |

Toda tabla lleva `id uuid`, `activo`, `created_at`, `updated_at` con trigger, y RLS activo sin políticas.

## 5. Módulos

### Fase 1 — Cimientos y maestros

| Módulo | Estado | Qué se construye | Hito de prueba |
|---|---|---|---|
| **M0 Cimientos** | 🔧 código listo, falta proyecto Supabase | Scaffold; migración base; login; guards; menú por rol; `/usuarios`; agentes; docs; Railway | Login como admin, crear planner y comprador, verificar qué ve cada uno, build limpio |
| **M1 Árbol de producto** | ✅ construido; hito pendiente de base real | Géneros, Mundos, Líneas, nodos Género-Mundo-Línea, Equivalencias, Agrupaciones talla; pantalla Árbol navegable; carga CSV inicial | Cargar el árbol real completo y recorrerlo; misma Línea en dos Género-Mundo con equivalencias distintas |
| **M2 Marcas** | ⏳ | Agrupaciones de marca (seed confirmado por Javier, en este orden: 1 Ultra Low · 2 Mid Value · 3 Valor · 4 Reconocido · 5 Premium), marcas, asignación Marca ↔ Equivalencia; CSV inicial | Una marca en varias equivalencias; cambiar su agrupación y verlo reflejado |
| **M3 Agrupaciones de estacionalidad** | ⏳ | Catálogo y asignación de cada Equivalencia a una curva; reporte de faltantes | Toda equivalencia activa tiene curva |
| **M4 Tiendas y aperturas** | ⏳ | Tiendas y CD con fechas de apertura y cierre, venta esperada, zona, razón social; estado derivado | Tienda futura aparece Planificada y pasa a Activa al llegar la fecha |

### Fase 2 — Planificación (se especifica al cerrar la Fase 1)

- **M5** Carga de histórico de ventas y stock mensual por tienda al grano del árbol. Resuelve la equivalencia de cada fila con la misma regla del árbol (`src/lib/arbol/normalizar.ts`): `-` = la equivalencia que se llama como la línea; vacío = la genérica `SIN EQUIVALENCIA` del nodo. Las filas cuya combinación no exista en el árbol se reportan antes de cargar, igual que en el importador de M1.
- **M6** Curvas de estacionalidad por agrupación de estacionalidad.
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
- Agrupaciones de marca: recibidas (Ultra Low, Mid Value, Valor, Reconocido, Premium). Falta la lista de marcas con su agrupación y sus equivalencias → M2.
- Lista de tiendas actuales (sirve el archivo CODIGOS DE TIENDAS LUKERS de V1) → M4.
- Conectar el servicio Railway al repo cuando M0 esté pusheado.
