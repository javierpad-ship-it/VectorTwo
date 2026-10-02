# Registro de decisiones

Orden cronológico. Cada entrada dice qué se decidió, por qué, y qué se descartó. Si una decisión cambia, se agrega una entrada nueva que referencia a la anterior; no se edita la vieja.

---

## 2026-10-02 · Supabase + Railway, no la base de datos de Railway

**Decisión.** Base de datos y autenticación en Supabase (proyecto nuevo `vector-two`); la aplicación se despliega en Railway.

**Por qué.** Supabase trae Auth, dashboard, backups diarios y se puede operar desde Claude Code (migraciones, consultas, tipos). La base de datos de Railway es un Postgres crudo: habría que construir login y usuarios, no tiene RLS lista ni pooler, sus backups dependen del plan y cobra por tiempo encendido.

**Descartado.** Postgres de Railway (por lo anterior). Vercel como host (Javier ya opera Railway desde V1).

## 2026-10-02 · V1 solo como referencia

**Decisión.** Nada de Vector-One se copia tal cual. Se repiten patrones que funcionaron (service_role desde el servidor, RLS sin políticas, guards por rol, maestros editables, migraciones idempotentes) escritos de nuevo.

**Por qué.** El árbol de producto y el concepto de "Flujo" de V1 ya no representan el proceso real; arrastrar su código arrastraría ese modelo.

## 2026-10-02 · Árbol de producto

**Decisión.** Género, Mundo y Línea son catálogos independientes. El nodo `genero_mundo_linea` dice en qué cruces existe cada Línea. La Equivalencia cuelga de ese nodo. Marca cruza con Equivalencia muchos a muchos. Agrupación Talla tiene dos valores (Centrales, Extremas).

**Por qué.** Reglas dadas por Javier: los Mundos existen en todos los Géneros; algunas Líneas están en más de un Género-Mundo; las Marcas están en más de una Equivalencia; una misma Línea tiene equivalencias distintas según el Género-Mundo.

**Descartado.** Árbol estricto de seis niveles (duplicaría marcas en cada rama). Equivalencia colgando solo de Línea (perdería la diferencia Hombre/Mujer).

## 2026-10-02 · Roles: admin, planner, comprador

**Decisión.** El rol `usuario` de V1 pasa a llamarse `planner`. Se agrega `activo` al perfil para bloquear acceso sin borrar la cuenta.

**Por qué.** El nombre describe a quien lo usa (el equipo de planeamiento) y deja claro que `comprador` es otra cosa. Desactivar en vez de borrar conserva el historial de quién hizo qué cuando haya auditoría.

## 2026-10-02 · Tres variables de entorno, no cuatro

**Decisión.** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. La URL pública sirve también para el cliente admin.

**Por qué.** En V1 había `SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_URL` con el mismo valor; una fuente menos de error al configurar Railway.

## 2026-10-02 · Construcción módulo por módulo con agentes

**Decisión.** Seis subagentes versionados en `.claude/agents/` (arquitecto, datos, backend, frontend, qa, documentador). Cada módulo pasa por especificación → migración → API+UI → QA → docs → hito que Javier valida.

**Por qué.** Javier pidió control parte por parte. Los agentes dejan por escrito las reglas de cada capa para que cualquier sesión futura trabaje igual.

## 2026-10-02 · El proyecto Supabase lo crea Javier en el dashboard

**Decisión.** Tras cinco intentos de `create_project` desde la sesión que expiraron sin crear nada, el proyecto `vector-two` se crea a mano en el dashboard. Las migraciones y tipos sí se aplican desde la sesión una vez exista.

**Por qué.** No bloquear M0 por una herramienta que no responde; todo lo demás de M0 no depende de la base.
