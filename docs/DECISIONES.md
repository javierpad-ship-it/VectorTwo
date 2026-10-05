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

## 2026-10-02 · Agrupaciones de marca con mantenimiento; agrupaciones de talla fijas

**Decisión.** Las agrupaciones de marca (M2: Ultra Low, Mid Value, Valor, Reconocido, Premium) se administran desde pantalla: crear, renombrar, reordenar, desactivar. Las agrupaciones de talla (Centrales, Extremas) son un catálogo fijo de dos valores, solo lectura, que cambia únicamente por migración.

**Por qué.** Javier pidió mantenimiento para las agrupaciones de marca ("tiene que tener mantenimientos") y confirmó expresamente que no habrá mantenimiento de agrupaciones de talla: no entregará tallas; la venta y el stock llegarán ya consolidados en esas dos agrupaciones, así que un tercer valor o un renombre desde la pantalla rompería la correspondencia con los archivos.

**Descartado.** Hacer editables las agrupaciones de talla (se consideró por unos minutos a raíz del pedido de mantenimientos, que resultó referirse solo a las marcas).

## 2026-10-02 · Sin tabla de tallas

**Decisión.** Se elimina del plan la tabla `tallas` (el "esqueleto" que PLAN §4 reservaba para M1) y su rama en el diagrama. `agrupaciones_talla` queda como catálogo cerrado de dos filas sin relación con equivalencias ni marcas; en Fase 2 la agrupación será una columna de las filas de venta y stock.

**Por qué.** Consecuencia directa de la decisión anterior ("agrupaciones de talla fijas"): si la venta y el stock llegan consolidados por agrupación, no hay talla individual que mapear y una tabla vacía solo confundiría.

**Descartado.** Dejar la tabla creada "por si acaso": una tabla sin uso ni dueño termina con datos de prueba y nadie sabe si borrarla.

## 2026-10-02 · Equivalencia genérica `SIN EQUIVALENCIA` por nodo

**Decisión.** Las filas del archivo con equivalencia vacía o `-` no se descartan ni dejan nodos sin hoja: el importador crea en cada nodo que lo necesite una sola equivalencia `SIN EQUIVALENCIA` marcada con `es_generica = true`. Un índice parcial garantiza a lo sumo una genérica por nodo. Renombrarla está prohibido; solo se puede activar o desactivar.

**Por qué.** Las ventas de la Fase 2 traerán esas mismas filas y tienen que caer en algún sitio. La bandera permite a M3 y a los reportes tratarlas aparte (por ejemplo, no exigirles curva o listarlas como pendientes de clasificar) sin confundirlas con una equivalencia real de nombre parecido.

**Descartado.** Nodos sin equivalencia (romperían el grano uniforme de la proyección). Descartar las filas (se perdería venta real).

## 2026-10-02 · El importador no crea géneros ni mundos

**Decisión.** El importador solo crea líneas, nodos y equivalencias. Un género o mundo que no exista en la base deja la fila en `omitidas` con motivo `genero_desconocido` o `mundo_desconocido`. Tampoco escribe en géneros o mundos inactivos: esas filas se omiten con `genero_inactivo` o `mundo_inactivo`. Nunca cambia `activo` de nada.

**Nota posterior.** Esta entrada mencionaba "el caso de SIN ASIGNAR inactivo"; ese mundo ya no existe (ver "Toda línea tiene mundo", más abajo), así que la mención se retiró. El resto de la decisión sigue vigente.

**Por qué.** Géneros y mundos son la raíz del árbol, tienen 8 y 5 valores fijos y su escritura es de admin. Un error de tipeo en un archivo no debe crear una raíz nueva ni revivir una que alguien desactivó a propósito; es más barato que el admin la cree o reactive a mano.

**Descartado.** Crear raíces al vuelo como hacía V1 con algunos maestros (generaba duplicados por acentos y espacios).

## 2026-10-02 · Códigos ASCII derivados del nombre

**Decisión.** Todo catálogo del árbol lleva un `codigo` ASCII corto derivado del nombre con una sola función `aCodigo` (`NIÑAS → NINAS`, `SIN EQUIVALENCIA → SIN_EQUIVALENCIA`, `POLO M/C → POLO_M_C`), editable al crear. Si dos nombres distintos derivan al mismo código dentro del mismo ámbito (líneas, o equivalencias de un nodo), el importador agrega sufijos `_2`, `_3`; `SIN_EQUIVALENCIA` queda reservado para la genérica. La unicidad de equivalencias es por nodo, no global.

**Por qué.** Los futuros códigos PIVOT y las abreviaturas de V1 eran ASCII; un código con eñes o acentos obliga a transliterar después. El sufijo evita que el importador falle por una colisión rara (dos equivalencias que solo difieren en un acento) y el usuario puede renombrar el código desde la pantalla.

**Descartado.** Conservar el valor exacto del archivo como código (pregunta abierta para Javier; si lo prefiere, es un cambio de `aCodigo` y una migración de datos).

## 2026-10-02 · Desactivar antes que borrar; la vigencia se calcula

**Decisión.** En las seis tablas del árbol la acción normal es desactivar. Eliminar solo se permite sin hijos; lo garantiza `on delete restrict` y el handler lo traduce a un 409 legible con el conteo. Desactivar un padre no se propaga en la base: un nodo es vigente si él, su género, su mundo y su línea están activos (`nodoVigente`), y la pantalla lo muestra como "Oculto por {padre} inactivo".

**Por qué.** Reactivar un mundo debe devolver sus nodos tal como estaban, sin perder cuáles se habían desactivado a mano; la cascada destruiría esa información. El borrado físico se reserva para errores recién cometidos, cuando todavía no cuelga nada.

**Descartado.** Cascada de `activo` por trigger (irreversible). Borrado lógico con `deleted_at` (duplica el concepto de `activo`).

## 2026-10-02 · El comprador ve el árbol en solo lectura

**Decisión.** La sección Maestros del menú la ven los tres roles; el item "Árbol de producto" no tiene restricción de rol y los de M2 a M4 siguen siendo de admin y planner. La página de Catálogos redirige al comprador a `/` desde el servidor y la API le responde 403 a cualquier escritura.

**Por qué.** El árbol es el vocabulario común con los compradores y la pantalla ya distingue por rol, así que mostrarlo cuesta una línea en `nav.ts`. Si Javier prefiere ocultarlo hasta la Fase 3, es revertir esa línea.

## 2026-10-02 · Ids no UUID son 404; errores de base no previstos son 500 genéricos

**Decisión.** Todo handler con `[id]` valida que sea UUID antes de consultar; si no lo es, responde 404 con el mismo mensaje que un recurso inexistente. Los errores de Postgres que no son único, FK ni check devuelven "Error inesperado en la base de datos." y el detalle (código, mensaje, hint) se escribe solo en el log del servidor. Todas las lecturas que pueden crecer pasan por `leerTodo`, que pagina de a 1 000 filas.

**Por qué.** Sin la validación, Postgres devolvía `invalid input syntax for type uuid` y terminaba en 500 con detalle interno en pantalla. PostgREST corta en 1 000 filas por defecto y las equivalencias ya pasan de 1 700: sin paginar, el árbol habría salido incompleto en silencio.

## 2026-10-02 · Toda línea tiene mundo: las filas sin mundo se omiten y se reportan

**Decisión.** No existe el mundo `SIN ASIGNAR`. El seed de `mundos` queda en cinco valores (CASUAL, URBANO, DEPORTIVO, FORMAL, RI). Una fila de archivo con el mundo en blanco no se carga: el importador la omite con motivo `mundo_vacio` y la muestra en la previsualización con la fila completa para que se corrija el archivo. Desaparecen `sin_mundo` del reporte, `nodos_sin_asignar` del resumen y el enlace "N en SIN ASIGNAR" de la pantalla; "Mover a otro mundo" queda disponible en cualquier nodo para admin y planner, como herramienta general de corrección.

**Por qué.** La especificación había inventado SIN ASIGNAR para no perder las 14 filas del archivo que venían con `GRUPO_PRODUCTO` vacío. Javier las revisó y confirmó que son errores del archivo, no líneas que de verdad existan sin mundo: BEBE (BODY, VESTIDOS), JOVENCITAS (BIVIDI, CAPA, SHORT), NIÑAS (DENIM, ENTERIZO, JOGGER, SHORT) y NIÑOS (CASACAS, PANTALON, POLERAS, POLOS, SHORT). Un mundo comodín habría metido en el árbol nodos que no representan nada y que la Fase 2 habría tenido que tratar como excepción; es más barato corregir el archivo y volver a importar, que es idempotente. Ninguna de esas 14 líneas aparece solo sin mundo, así que las 86 líneas del catálogo se crean igual. Conteos de referencia del hito tras el cambio: 5 mundos · 556 nodos · 1 414 equivalencias reales + 376 genéricas = 1 790 procesadas · 212 omitidas (14 `mundo_vacio` + 198 duplicadas) · PANTALON en 25 nodos.

**Descartado.** Mantener SIN ASIGNAR como mundo permanente para futuras cargas (deja basura estructural que alguien tiene que limpiar después). Desactivarlo cuando quedara vacío (un mundo inactivo que resucita en cada importación con errores es peor que un aviso claro).

## 2026-10-02 · La previsualización muestra el detalle completo de lo que no se cargará

**Decisión.** Cada entrada de `omitidas` lleva la fila completa normalizada (`genero`, `mundo`, `linea`, `equivalencia`) además de `fila`, `motivo` y `detalle`, y `fila_original` en las repetidas dentro del archivo. La pantalla de importación separa "Filas con errores" (mundo vacío, género o mundo desconocidos o inactivos, línea vacía, fila de totales) de "Repetidas en el archivo" (informativas, no hay nada que corregir), con filtro por motivo, un aviso de que las filas con errores no se cargarán y un botón "Descargar omitidas (CSV)". El `confirm` de Aplicar repite cuántas filas quedan fuera.

**Por qué.** Javier quiere ver qué está mal antes de aplicar, no después. Con solo `fila` y `motivo` había que abrir el CSV y contar filas para saber de qué línea se trataba; con la fila completa y la descarga, la corrección del archivo se hace desde la propia previsualización. Separar errores de repetidas evita que 198 duplicados inofensivos tapen 14 errores reales.

**Descartado.** Mostrar una sola tabla de omitidas con todos los motivos mezclados (lo que había). Bloquear Aplicar mientras haya errores (se prefiere avisar y dejar cargar lo válido: el importador es idempotente y la segunda pasada con el archivo corregido solo agrega lo que faltaba).

## 2026-10-05 · El guion en la equivalencia significa "igual a la línea"

**Decisión.** En el archivo del árbol, una equivalencia `-` quiere decir que la equivalencia se llama exactamente como la línea del nodo. El importador crea en ese caso una equivalencia real (no genérica) con el nombre de la línea; si el mismo nodo trae además una fila con ese nombre escrito, es la misma equivalencia. La equivalencia vacía sigue cayendo en la genérica `SIN EQUIVALENCIA`. En la pantalla, escribir `-` al crear una equivalencia produce el mismo efecto.

**Por qué.** Lo aclaró Javier: así se usa la columna en Lukers. Hasta ahora `-` y vacío se trataban igual y eso habría escondido bajo la genérica cientos de equivalencias con nombre propio.

**Alcance.** La regla vale para todo archivo que traiga la columna de equivalencia: el árbol (M1) y las cargas de venta y stock de la Fase 2 (M5), que deben usar las mismas funciones `esEquivalenciaIgualALinea` y `esEquivalenciaGenerica` para que una fila caiga siempre en la misma equivalencia.

**Descartado.** Mantener `-` como genérica (perdía el nombre). Tratar también el vacío como "igual a la línea" (Javier no lo ha dicho; queda como pregunta abierta).

## 2026-10-05 · M2: agrupaciones de marca editables y marcas con tratamiento especial

**Decisión.** Las cinco agrupaciones de marca (Ultra Low, Mid Value, Valor, Reconocido, Premium) entran como semilla y se administran desde pantalla: nombre, código y orden editables, alta y baja. Las marcas se asignan a una agrupación en un mantenimiento propio, donde además cada marca puede marcarse con `tratamiento_especial` (y una nota corta) para que la Fase 2 la trate aparte al armar los flujos.

**Por qué.** Javier: los cinco niveles son válidos, pero los nombres todavía no son oficiales y deben poder cambiarse; y hay marcas que en los flujos se trabajan distinto, así que la marca es el lugar natural para marcarlo.

**Descartado.** Nombres de agrupación fijos por migración (bloquearía un cambio de nomenclatura del negocio). Guardar el tratamiento especial como lista aparte (se perdería al renombrar o fusionar marcas).
