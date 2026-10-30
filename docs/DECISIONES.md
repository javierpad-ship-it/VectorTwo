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

## 2026-10-05 · El vínculo marca ↔ equivalencia sale de M2 y se deriva de la venta

**Decisión.** M2 no construye `equivalencia_marca`, que PLAN §4 le asignaba. La relación "qué marcas hay en cada equivalencia" (y las cinco principales por equivalencia que necesita M7) se propone derivarla de las filas de venta y stock de M5, que traen marca y equivalencia, usando el volumen vendido como criterio. Si Javier quiere mantenerla a mano (por ejemplo, para marcas nuevas sin histórico), se abre M2b con la tabla, una pestaña "Equivalencias" en la pantalla de marcas y el `409` al eliminar equivalencias con marcas.

**Por qué.** Javier no lo pidió al abrir M2, todavía no existe la lista de marcas, y una tabla manual no sabe cuáles son las "principales" por volumen. Pedirle a alguien que marque cientos de cruces que la venta ya contiene sería trabajo duplicado.

**Descartado.** Crear la tabla vacía ahora "por si acaso" (misma razón por la que se eliminó `tallas`: una tabla sin uso ni dueño termina con datos de prueba).

## 2026-10-05 · La nota de tratamiento exige la bandera; se borra al desmarcar

**Decisión.** `nota_tratamiento` solo puede existir si `tratamiento_especial` está encendido. Lo garantiza un `check` en la base; la API borra la nota al apagar la bandera y responde `400` a una nota sin bandera; la pantalla pide confirmación al apagar una bandera con nota y no manda la nota en el `PATCH` cuando la bandera está apagada.

**Por qué.** La nota explica por qué la marca tiene tratamiento especial; una nota con la bandera apagada no tiene lectura posible y confundiría a quien filtre por tratamiento. El `check` evita notas huérfanas aunque alguien escriba por el SQL Editor.

**Descartado.** Conservar la nota con la bandera apagada por si se vuelve a encender (una nota que no se ve ni se usa). Un catálogo de tipos de tratamiento (Javier no ha dicho que haya más de uno; pregunta abierta en la ficha).

## 2026-10-05 · Migraciones sin `DROP`: triggers con `create or replace trigger`

**Decisión.** A partir de `0002_marcas.sql` las migraciones no contienen ninguna sentencia `DROP`; los triggers se declaran con `create or replace trigger` (Postgres 14 o superior), que ya es idempotente. `0001` conserva su `drop trigger if exists` porque está aplicada y no se toca.

**Por qué.** Las migraciones se aplican con `execute_sql` del MCP de Supabase desde Claude Code, y cualquier `DROP` se queda esperando una confirmación que nunca llega. Quitar el `DROP` hace que la migración se aplique de una pasada.

**Descartado.** Aplicar las migraciones solo desde el dashboard (pierde la trazabilidad de la sesión). Bloques `do $$` que comprueben si el trigger existe (el SQL Editor no siempre los acepta tal cual).

## 2026-10-05 · Nombres de agrupación de marca en mayúsculas normalizadas

**Decisión.** El seed de `agrupaciones_marca` va en mayúsculas (`ULTRA LOW`, `MID VALUE`…), como todo nombre que pasa por `normalizarNombre`, aunque `agrupaciones_talla` se haya sembrado en caja mixta.

**Por qué.** Las agrupaciones de marca son editables desde la pantalla y el `PATCH` normaliza el nombre; si el seed fuera `Mid Value` y Javier lo tocara, volvería como `MID VALUE` y parecería un error. `agrupaciones_talla` es un catálogo cerrado que nunca pasa por zod, por eso allí no importa.

## 2026-10-05 · El importador de marcas no actualiza existentes; sin columna de tratamiento se toma NO

**Decisión.** `POST /api/marcas/importar` solo crea marcas nuevas. Una marca que ya existe nunca se modifica ni se reactiva, aunque el archivo traiga otra agrupación u otro tratamiento: la diferencia se muestra en la previsualización ("Diferencias con lo ya cargado") para que se corrija desde la pestaña Marcas. Si el archivo no trae la columna de tratamiento, todas las filas se leen como `NO` (sin tratamiento); por eso las marcas existentes con bandera aparecen en diferencias en ese caso. El importador tampoco crea agrupaciones: una agrupación desconocida o inactiva omite la fila y la reporta.

**Por qué.** Es el mismo criterio que el importador del árbol: una carga inicial idempotente, no una sincronización. Reimportar el mismo archivo debe dejar la base igual, y una fila mal escrita no debe mover una marca de agrupación en silencio. Leer la columna ausente como `NO` es la interpretación más simple y coincide con el valor por defecto de la columna; la alternativa "sin columna = sin dato" está abierta como pregunta para Javier en la ficha.

**Descartado.** Que el archivo mande sobre lo existente (se haría como un modo "actualizar" explícito, en M2 y M4 a la vez, si Javier lo pide). Crear agrupaciones al vuelo (son raíz y de admin, como géneros y mundos).

## 2026-10-05 · Una violación de FK responde 404 o 409 según quién la provocó

**Decisión.** `traducirErrorDb` distingue, por el texto de Postgres, si el `23503` vino de `insert or update` sobre la tabla hija (se intentó asignar un padre que no existe) o de `update or delete` sobre la tabla padre (se intentó borrar un padre con hijos). Para `marcas_agrupacion_marca_id_fkey`: el primero responde `404 "Agrupación de marca no encontrada."` y el segundo `409 "No se puede eliminar la agrupación de marca: tiene marcas. Desactívala."`. Las FKs sin mensaje propio siguen en el `409` genérico.

**Por qué.** Antes todo `23503` era un `409` que hablaba de eliminar, y al crear una marca contra una agrupación inexistente el mensaje no tenía sentido. Los handlers ya anticipan los dos casos leyendo la agrupación antes de escribir (`motivoRechazoAgrupacionDestino`); esta traducción es la red de seguridad para la ventana entre esa lectura y la escritura, que no es atómica.

**Descartado.** Un solo mensaje neutro para toda FK (no le dice al usuario qué hacer).

## 2026-10-06 · No existe ni existirá `equivalencia_marca`: la relación sale de la venta real

**Decisión.** Javier cerró lo que la entrada "El vínculo marca ↔ equivalencia sale de M2" del 2026-10-05 dejaba como propuesta: "No hay relación marca equivalencia, eso viene en la venta real". La tabla `equivalencia_marca` desaparece del plan de forma definitiva. Qué marcas hay en cada equivalencia, y cuáles son las cinco principales que necesita M7, se deriva de las filas de venta que cargue M5, que ya traen marca y equivalencia. M2b queda descartado, no pospuesto. Marcas y equivalencias siguen siendo maestros independientes: una marca nueva sin histórico simplemente no aparecerá en ninguna equivalencia hasta que venda.

**Por qué.** En Lukers nadie mantiene esa lista a mano: la relación es un hecho de la venta, no una regla del catálogo. Pedir que se marquen cientos de cruces que los archivos ya contienen sería trabajo duplicado y, además, una tabla manual no sabe cuáles marcas son "principales" por volumen.

**Descartado.** M2b (tabla manual con pestaña Equivalencias en la pantalla de marcas). Un híbrido "derivada de la venta más ajustes a mano": si en Fase 2 hace falta forzar una marca en una equivalencia sin venta, se decidirá entonces con el `analista-planeamiento`, no se reserva estructura ahora.

**Estado (2026-10-13).** Sigue en pie. La mejora 02b (construida) usa el nombre "M2b" para otra cosa: marca × **nodo** género-mundo-línea, solo para las marcas que se trabajan aparte (`marca_gml_especial`). No es una relación marca ↔ equivalencia y no se mantiene a mano para todas las marcas.

## 2026-10-06 · Las agrupaciones de estacionalidad y su asignación las construye Javier dentro del sistema

**Decisión.** No hay una lista previa de agrupaciones de estacionalidad ni de qué equivalencia va en cada una. Javier la va a construir en Vector2 ("la agrupación de género-mundo-línea-equivalencias la voy a construir en tu modelo") usando la pantalla de M3: crea las agrupaciones en la pestaña Agrupaciones, asigna en bloque desde Asignación y cierra la lista con Faltantes hasta que quede vacía. Con esto la especificación de M3 queda aprobada y el módulo pasa a construcción. El importador de asignaciones se mantiene tal como está especificado, pero como apoyo opcional (por ejemplo, para completar en Excel el CSV de faltantes), no como la vía principal de carga.

**Por qué.** La ficha de M3 suponía que podía existir un archivo con la lista y preguntaba por su formato (pregunta abierta 1). Al no existir, lo que importa es que la pantalla sirva para armar la clasificación desde cero con el árbol real delante: filtros por género, mundo y línea, selección múltiple y el reporte de faltantes como guía. El importador no estorba y ya está diseñado, así que se conserva; lo que cambia es el orden de prioridad al construir y al probar el hito.

**Descartado.** Pedirle a Javier la lista en archivo antes de abrir M3 (bloquearía el módulo por un documento que no existe y que es más fácil armar con la herramienta). Recortar el importador de M3 (ahorra poco y quita la vía de corrección masiva).

## 2026-10-06 · Las curvas de estacionalidad se calculan sobre la venta real; M3 solo agrupa

**Decisión.** "La estacionalidad se calcula sobre la venta real (cuando la tengamos)". La curva mensual de cada agrupación de estacionalidad se obtiene de la venta histórica que cargue M5 y la calcula M6. M3 se limita a definir las agrupaciones y a asignar cada equivalencia a una; no guarda curvas, no admite curvas escritas a mano y no calcula nada en Fase 1. Sigue abierto para M6 el grano de la curva (una por agrupación para toda la red, o por agrupación × tienda).

**Por qué.** Una curva tecleada a mano no tiene de dónde validarse y habría que rehacerla cuando llegue la venta. Separar "agrupar" (M3, maestro) de "calcular" (M6, planificación) deja a M3 con un hito verificable sin datos de venta, "toda equivalencia activa tiene agrupación", y evita que la Fase 1 cargue estructura de curvas que la Fase 2 podría cambiar al definir fórmulas con el `analista-planeamiento`.

**Descartado.** Curvas manuales provisionales en M3 para "ir viendo" (datos sin respaldo que luego hay que borrar). Calcular curvas desde M3 con un archivo de venta parcial (la carga de venta es M5 y tiene su propia validación contra el árbol).

**Estado (2026-10-13).** Sigue en pie: M3 no guarda curvas ni calcula nada. Lo único que M6 le añadió es la columna `temporada` de la agrupación (migración `0011`, `0.9.0 · M6`), que es un atributo de clasificación, no una curva. Ver la entrada del 2026-10-13 sobre la temporada.

## 2026-10-06 · Agrupaciones de estacionalidad sin seed; los nombres son del negocio

**Decisión.** `0003_agrupaciones_estacionalidad.sql` no siembra ninguna agrupación. Tampoco una `GENERAL` o `SIN AGRUPAR` por defecto. Las crea el planner desde `/maestros/estacionalidad` (o el importador, a partir de un archivo), con los nombres que use Lukers.

**Por qué.** Ninguna agrupación es necesaria para que el sistema funcione, y un comodín inventado por nosotros termina siendo el cajón donde cae todo: esconde justo la señal que M3 quiere dar, que es la lista de equivalencias sin curva. Si Javier quiere una agrupación comodín, la crea en diez segundos y es una decisión suya, no del seed. Es el mismo criterio que "toda línea tiene mundo" y que "marcas sin agrupación no existen".

**Descartado.** Seed `GENERAL` (por lo anterior). Seed con las temporadas de la línea (Verano / Invierno / Todo el año) como agrupaciones iniciales: la curva por agrupación es más fina que la temporada y habría que deshacerlo.

## 2026-10-06 · Faltante = equivalencia activa y vigente sin agrupación activa

**Decisión.** Una equivalencia es "faltante" si está activa, su nodo es vigente (género, mundo, línea y nodo activos) y no tiene agrupación o la que tiene está desactivada. Las genéricas `SIN EQUIVALENCIA` cuentan igual que las reales. Una equivalencia inactiva o en nodo no vigente nunca es faltante aunque no tenga agrupación. Desactivar una agrupación no toca sus equivalencias: conservan el id, aparecen en Faltantes con motivo "agrupación inactiva" y, al reactivarla, vuelven a estar completas sin reasignar nada. La regla vive en una sola función (`motivoFaltante`) que usan la lista plana, el reporte de faltantes, el resumen del árbol y la pantalla.

**Por qué.** El hito de M3 es "toda equivalencia activa tiene agrupación" y M7 no podrá proyectar lo que no tenga curva; la definición tiene que coincidir con lo que se proyecta. Las genéricas entran porque su venta existe (las filas sin equivalencia del archivo de ventas caerán ahí en M5). La agrupación inactiva cuenta como faltante porque M6 no calculará curva para ella; y no se propaga la desactivación (sin cascada, como en el árbol) para que reactivar devuelva las cosas tal como estaban.

**Descartado.** Excluir las genéricas del reporte (queda como pregunta abierta para Javier; si prefiere excluirlas es un cambio en `motivoFaltante` y un chip menos). Poner en `null` las equivalencias al desactivar su agrupación (irreversible). Un índice parcial sobre `agrupacion_estacionalidad_id is null` para listar faltantes desde la base: no sirve porque la vigencia del nodo no está en la tabla; se calcula en memoria sobre el estado completo del árbol, como el árbol mismo.

## 2026-10-06 · El importador de estacionalidad crea agrupaciones pero no toca el árbol

**Decisión.** `POST /api/estacionalidad/importar` crea las agrupaciones que no existan (código derivado del nombre, con sufijo `_2` si choca) y las lista en la previsualización con cuántas filas apuntan a cada una. Nunca crea líneas, nodos ni equivalencias (una fila que no case con el árbol se omite y se reporta con su fila completa), nunca cambia `activo` de nada y nunca quita una agrupación (para eso está la pantalla). Si una fila trae una agrupación distinta de la que la equivalencia ya tiene, el archivo manda: la reasigna, y la previsualización muestra cada cambio con "de → a" y el `confirm` de Aplicar repite cuántas cambian. Reimportar el mismo archivo no crea ni cambia nada.

**Por qué.** Las agrupaciones de estacionalidad son del planner (no catálogo raíz de admin como géneros y mundos), así que crearlas desde el archivo no abre ninguna puerta que el planner no tenga ya desde la pantalla, y el objetivo del archivo es cargar una clasificación completa de una vez; la lista previa con conteos hace visible un error de tipeo ("PANTALON INVIERNO" vs "PANTALONES INVIERNO") antes de aplicar. El árbol lo mantiene su propio importador: mezclar las dos cargas haría que un error de tipeo en una equivalencia creara una equivalencia nueva en vez de reportarse. Que el archivo mande al reasignar es distinto de lo que hace el importador de marcas (que solo informa diferencias): aquí el archivo suele ser el CSV de faltantes completado en Excel y volver a subirlo con correcciones es parte del flujo; se deja como pregunta abierta por si Javier prefiere que esas filas se omitan.

**Descartado.** Que el importador cree equivalencias "de paso" (duplicaría la lógica del árbol y escondería errores del archivo). Que omita las filas con agrupación distinta (obligaría a corregir a mano lo que el archivo ya dice; abierto como pregunta). Que una fila con `AGRUPACION` vacía quite la agrupación (el CSV de faltantes sale con esa columna vacía: vacío significa "todavía no la completé", no "quítala").

## 2026-10-06 · Guard de escritura `requirePlanner` para todo M3

**Decisión.** Todas las escrituras de M3 (crear, editar, desactivar y eliminar agrupaciones de estacionalidad; asignar individual y masiva; importar) exigen `requirePlanner`; las lecturas, `requireUser`. La pantalla `/maestros/estacionalidad` la ven admin y planner; el comprador no la ve en el menú ni entra por URL.

**Por qué.** La estacionalidad es trabajo de planificación, como las líneas y las equivalencias, no un catálogo raíz de ocho o cinco valores como géneros y mundos (que escribe solo el admin) ni como las agrupaciones de marca (también de admin, decidido en M2 porque son cinco niveles de precio del negocio). Javier construye la clasificación él mismo y con su equipo de planeamiento; exigir admin para crear una agrupación frenaría ese trabajo sin proteger nada. La lectura queda abierta a todo usuario por si en Fase 3 el comprador necesita ver a qué curva pertenece una equivalencia.

**Descartado.** Catálogo de agrupaciones de admin y asignación de planner (dos guards para una misma pantalla, y el planner tendría que pedir cada agrupación nueva).

## 2026-10-06 · El importador de estacionalidad resuelve agrupaciones por nombre antes que por código

**Decisión.** Al buscar si una agrupación del archivo ya existe, `buscarAgrupacion` compara primero por nombre normalizado y solo si no hay coincidencia por código derivado (`aCodigo(valor)`). Es el orden inverso al de `buscarEnCatalogo` de M1 (código primero), que se mantiene para géneros y mundos.

**Por qué.** Dos nombres distintos pueden derivar al mismo código ("PANTALON INVIERNO" y "PANTALON-INVIERNO" dan `PANTALON_INVIERNO`); la regla de M3 crea la segunda con sufijo `_2`. Si al reimportar se buscara por código primero, "PANTALON-INVIERNO" caería en `PANTALON_INVIERNO` (la otra) y la segunda pasada reasignaría equivalencias: el importador dejaría de ser idempotente, que es su garantía principal. Con el nombre literal primero, cada agrupación vuelve a encontrarse a sí misma. En géneros y mundos no hay sufijos ni creación desde archivo, así que el orden de M1 no tiene este problema.

**Descartado.** Rechazar en el importador los nombres cuyo código derivado ya exista (obligaría a renombrar en el archivo algo que la pantalla sí admite). Cambiar también `buscarEnCatalogo` (no hace falta y tocaría M1 sin motivo).

## 2026-10-06 · El estado de la tienda se calcula, no se guarda

**Decisión.** Planificada, Activa y Cerrada no son una columna: `estadoTienda(tienda, hoy)` las deduce de `fecha_apertura` y `fecha_cierre` cada vez que se lee, con `hoy` en `America/Lima` (`hoyLima()`). Sin apertura o con apertura futura es Planificada; con cierre anterior a hoy es Cerrada; el resto, Activa. Apertura = hoy ya es Activa. Las lecturas aceptan `?hoy=aaaa-mm-dd` para simular otra fecha sin escribir nada.

**Por qué.** En V1 el estado era una columna que alguien tenía que cambiar a mano, y las tiendas que ya habían abierto seguían figurando como Planificadas. Calculado, el hito es literal: una tienda futura aparece Planificada y pasa a Activa al llegar la fecha sin que nadie toque nada. Se usa la fecha de Lima y no `new Date().toISOString()` porque Railway corre en UTC y desde las 19:00 de Lima ya sería "mañana": una tienda que abre mañana saldría Activa cinco horas antes.

**Descartado.** Una columna `estado` mantenida por un job diario (otra pieza que falla en silencio). Un trigger que la recalcule (no sabe qué día es "hoy" para el usuario).

## 2026-10-06 · `activo` no es "cerrada"

**Decisión.** Una tienda que cerró conserva `activo = true`, su `fecha_cierre` y su histórico. `activo = false` es administrativo: filas creadas por error o que no deben volver a aparecer. La pantalla muestra las dos cosas por separado (el badge dice "Desactivada" en lugar del estado) y pide confirmación al desactivar una tienda Activa, con el aviso de que cerrar es poner una fecha.

**Por qué.** M5 tiene que poder cargar el histórico de una tienda cerrada (solo rechazará las desactivadas) y M7 necesita la fecha de cierre para saber desde cuándo dejó de vender. Si cerrar fuera desactivar, se perdería esa fecha y el histórico quedaría huérfano.

**Descartado.** Desactivar al cerrar (por lo anterior).

## 2026-10-06 · El cierre es el último día con venta y exige fecha de apertura

**Decisión.** `fecha_cierre` es el último día en que la tienda vende, inclusive: una tienda con cierre hoy sigue Activa hoy y pasa a Cerrada mañana. Cierre = apertura se permite (abrió y cerró el mismo día). Un cierre sin apertura se rechaza (`check` en la base y `400` en la API). Si la apertura de una tienda antigua no se conoce con exactitud, se carga una aproximada.

**Por qué.** "Cerró el 31 de marzo" se dice de quien vendió el 31. Sin apertura, un cierre no dice nada a la proyección (no se sabe desde cuándo había venta). La lectura "último día con venta" queda como pregunta abierta 6 para Javier, por si la entiende al revés.

**Descartado.** Cierre como primer día cerrado (menos natural al hablar). Cierre sin apertura (no informa a M7).

## 2026-10-06 · El código de la tienda lo pone el usuario o el archivo; no se deriva del nombre

**Decisión.** `tiendas.codigo` es el código real de la tienda (`R401`, `RD50`), obligatorio, que escribe el usuario o trae el archivo. Pasa por `aCodigo` (ASCII en mayúsculas, máximo 40; si queda vacío se rechaza) y es único sobre `upper(codigo)`. El nombre nunca se usa para proponerlo. El otro número del archivo de V1 (`Tda#`) se descarta porque se repetía entre tiendas.

**Por qué.** Es el identificador con el que llegarán la venta y el stock en M5; un código inventado por nosotros no existiría en los sistemas de Lukers y ninguna fila de venta lo encontraría. A diferencia de los catálogos del árbol, aquí el código no es una etiqueta interna. Por lo mismo no hay sufijos ni colisiones que resolver: dos códigos iguales son la misma tienda.

**Descartado.** Derivar el código del nombre como en el árbol (inventaría códigos). Conservar `Tda#` como segundo identificador (no es único).

## 2026-10-06 · Zona y razón social son texto libre normalizado, con autocompletado

**Decisión.** `zona` y `razon_social` se guardan con la misma normalización que el nombre (mayúsculas, espacios colapsados), nulas si vienen vacías, y la pantalla autocompleta con los valores ya usados. No son catálogos ni llevan FK en M4.

**Por qué.** Hoy son dos zonas y dos razones sociales y ningún módulo consume todavía esa dimensión. La normalización evita duplicados por caja o espacios y el autocompletado evita que baile la ortografía, que es lo que V1 resolvía con una lista. Si la Fase 2 proyecta o reporta por zona, se promueven a catálogo con FK en una migración posterior (pregunta abierta 3 de la ficha).

**Descartado.** Catálogos con FK desde ya (dos valores y ningún consumidor: estructura sin dueño, el mismo criterio con el que se descartaron `tallas` y `equivalencia_marca`).

## 2026-10-06 · Sin semilla de tiendas y sin relación tienda → centro de distribución

**Decisión.** `0004_tiendas.sql` no siembra ninguna tienda y la tabla no tiene FKs. La red la carga Javier (pantalla o importador). Tampoco se modela qué centro de distribución abastece a qué tienda; el CD es una fila más con `tipo = 'Centro de Distribución'`, sin venta esperada.

**Por qué.** La lista oficial son datos reales de Lukers y no van en el repo. La relación con el CD la tuvo V1 y la quitó: con un solo CD no distingue nada. Si M8 necesita flujos por CD, se agrega `centro_distribucion_id` en ese momento, con la información real a la vista.

**Descartado.** Sembrar la red con un archivo de ejemplo (datos reales o inventados que luego habría que borrar). Un `centro_distribucion_id` "por si acaso".

## 2026-10-06 · Una agrupación de estacionalidad pertenece a uno o más géneros y solo acepta equivalencias de sus géneros

**Decisión.** Cada agrupación de estacionalidad se vincula a uno o más géneros (tabla `agrupacion_estacionalidad_genero`, migración `0005`) y una equivalencia solo puede asignarse a una agrupación que incluya el género de su nodo. Desde la API una agrupación nunca queda sin género: crear exige al menos uno, editar reemplaza el conjunto con mínimo uno y no deja quitar un género del que la agrupación tenga equivalencias. Una agrupación sin género (solo las heredadas) se puede renombrar, activar o desactivar, pero no acepta asignaciones.

**Por qué.** Javier lo pidió así ("las agrupaciones de estacionalidad tienen que poder asignarse a 1 o más géneros") y añadió que, al filtrar por género para asignar, la pantalla debe mostrar solo las agrupaciones que aplican. Eso solo es confiable si el vínculo se hace cumplir: si el género fuera una etiqueta, una equivalencia de MUJER podría entrar en una agrupación de HOMBRE por la API o por el importador, y el filtro de la pantalla ocultaría datos que sí existen. Que sean uno o más géneros (y no exactamente uno) es literalmente lo que pidió. La tabla de vínculos no lleva `activo`: el vínculo existe o no existe. `agrupacion_estacionalidad_id` es `on delete cascade` (los géneros son un atributo de la agrupación, que solo se elimina sin equivalencias) y `genero_id` es `on delete restrict` (el género es un catálogo raíz y no arrastra en silencio la configuración de estacionalidad; eliminar uno con agrupaciones responde `409`).

**Descartado.** Que el género sea solo informativo (una etiqueta sin regla, ni backend ni pantalla la harían cumplir; el filtro dejaría de ser una garantía). Una columna `genero_id` en la propia agrupación (solo permitiría un género, no "1 o más"). Que una agrupación sin género valga "para todos los géneros" (esconde una decisión que le toca a Javier; ver la entrada siguiente).

## 2026-10-06 · El backfill parte de las asignaciones existentes; las agrupaciones sin equivalencias quedan "sin género"

**Decisión.** `0005` registra, para cada equivalencia que ya tenía agrupación, el género de su nodo como género de esa agrupación (`select distinct … on conflict do nothing`), de modo que toda asignación previa cumple la regla desde el primer momento. Las agrupaciones sin equivalencias quedan con cero géneros y la pantalla las marca "Sin género": no se les inventa ninguno (ni "todos los géneros" ni uno por defecto). El backfill solo agrega, nunca borra, y no resucita un género que el planner ya hubiera quitado de una agrupación sin equivalencias de ese género. En producción ASESORIA 1 y TES HO INV PESADO quedaron con HOMBRE, y AASE_INVIERNO y TES HO INV LIGERO quedaron sin género.

**Por qué.** Con las asignaciones existentes hay un dato real del que partir; sin ellas, cualquier género sería una suposición nuestra que escondería la decisión que Javier tiene que tomar, el mismo criterio con el que se descartó sembrar una agrupación `GENERAL` en `0003`. Una agrupación sin género no puede recibir equivalencias, así que la omisión es visible (badge, fila resaltada, aviso en el Mapa) y se corrige en diez segundos desde Agrupaciones.

**Descartado.** Asignar "todos los géneros" a las agrupaciones vacías (las dejaría aceptando cualquier cosa sin que nadie lo haya decidido). Elegir un género por defecto (misma razón).

## 2026-10-06 · La regla de género la aplican el backend y la pantalla, porque no cabe en un `check`

**Decisión.** La regla "una equivalencia solo entra en una agrupación que incluya su género" la hacen cumplir los handlers (asignación individual, masiva e importador) con funciones puras (`rechazoAsignacion`, `planificarAsignacion`), y la pantalla no ofrece los destinos que se sabe que van a fallar. Por la misma razón crear, listar y editar agrupaciones dejan de usar el catálogo genérico (`catalogo.ts`) y pasan a handlers propios en `src/lib/estacionalidad/agrupaciones.ts`; `DELETE` sigue con el genérico. La asignación masiva no aborta por una equivalencia de otro género: la devuelve en `no_permitidas` y asigna el resto; la individual responde `409`.

**Por qué.** La regla cruza tres tablas (equivalencia, nodo y género, y la agrupación con sus géneros) y no se puede expresar con un `check`; una FK compuesta exigiría duplicar el género dentro de `equivalencias`, con un segundo dato que habría que mantener sincronizado con el nodo. Crear y editar escriben en dos tablas y validan antes de escribir, algo que el CRUD plano no hace; es el mismo camino que siguió M2 con las marcas. Que la masiva no aborte sigue el criterio de `no_encontradas`: una selección grande no debe perderse por unas pocas filas.

**Descartado.** Duplicar `genero_id` en `equivalencias` para poder usar una FK compuesta (un segundo dato que habría que mantener sincronizado con el nodo). Abortar toda la asignación masiva ante una sola equivalencia de otro género.

## 2026-10-06 · El importador de estacionalidad no amplía los géneros de una agrupación existente

**Decisión.** Si una fila del archivo apunta a una agrupación que ya existe y no incluye el género de la fila, se omite con `genero_no_incluido`; si la agrupación no tiene ningún género, con `agrupacion_sin_genero`. El importador nunca agrega géneros a una agrupación existente. Una agrupación nueva sí se crea con los géneros distintos de las filas procesadas que le apuntan, de modo que nunca nace sin género, y la previsualización lo muestra en la columna Géneros de "Agrupaciones a crear".

**Por qué.** Los géneros de una agrupación son una decisión de configuración que se toma en la pantalla de Agrupaciones; ampliarlos desde un archivo haría que una sola fila equivocada (el tipeo de una agrupación, una fila de MUJER en una agrupación de HOMBRE) cambiara el alcance de la agrupación y lo dejara aceptado para todo el resto. Con la regla de arriba, el error se ve como fila omitida y se corrige a mano. Para una agrupación nueva no hay nada previo que proteger y los géneros salen de lo que el propio archivo pide, además de que es la única forma de crearla sin dejarla sin género.

**Descartado.** Ampliar automáticamente los géneros de la agrupación existente al ver la fila (cambiaría configuración sin que nadie lo vea antes de aplicar). Crear la agrupación nueva sin géneros (quedaría inutilizable, sin aceptar asignaciones).

## 2026-10-06 · Las listas de agrupaciones van en orden alfabético; `orden` ya no manda ahí

**Decisión.** Leyenda de colores, selectores de asignación ("Asignar a", "Mover a", "Por agrupación"), tarjetas del Mapa, selector del árbol y tabla de Agrupaciones se ordenan por nombre con `localeCompare("es", { sensitivity: "base", numeric: true })`: sin distinguir acentos ni mayúsculas y con números naturales ("ASESORIA 2" antes de "ASESORIA 10"). El campo `orden` deja de mandar en esas vistas, pero sigue fijando el orden de `GET /api/agrupaciones-estacionalidad` y, sobre todo, el color de cada agrupación: los colores siguen la posición por `orden, nombre`, de modo que el cambio de orden no recolorea nada. Los chips de género de una agrupación van por el `orden` del género, no alfabéticos, como el resto de listas de géneros.

**Por qué.** Javier pidió "organicemos por orden alfabético". Buscar una agrupación por nombre es más natural que recordar su posición, y el orden natural evita que "ASESORIA 10" aparezca antes que "ASESORIA 2". Mantener el color por `orden, nombre` conserva la identidad visual de cada agrupación: ordenar la lista por nombre no la recolorea.

**Descartado.** Colorear por posición alfabética (cambiaría el color de varias agrupaciones al crear una nueva o renombrar otra). Comparar sin `numeric` (deja "ASESORIA 10" antes de "ASESORIA 2").

## 2026-10-06 · Los filtros `.in(...)` de la asignación masiva y del importador van en tandas de 150 ids

**Decisión.** La lectura y la escritura por `in("id", …)` de `POST /api/estacionalidad/asignar` y de `POST /api/estacionalidad/importar` se hacen en tandas de 150 ids (`TANDA_IN` en `src/lib/arbol/importar.ts`), no de 500. Las inserciones de agrupaciones nuevas siguen en tandas de 500.

**Por qué.** El cliente de Supabase manda los ids en la URL: 500 UUID pasan de 18 KB y el gateway puede rechazar la petición por tamaño de URL, un error que solo aparecería con selecciones grandes (el árbol real tiene 1 956 equivalencias). Con 150 ids la URL queda por debajo. La operación sigue siendo idempotente, así que el costo es solo más llamadas.

**Descartado.** Mantener 500. Queda anotado que el límite del gateway no se probó contra Supabase real: 150 es un margen conservador, no un valor medido.

## 2026-10-07 · El responsable de una combinación género-mundo es un comprador, y sirve para filtrar, no para limitar permisos

**Decisión.** Cada combinación género × mundo tiene como máximo un responsable (titular), que es un usuario con rol `comprador`. Vive en una tabla propia, `responsables_genero_mundo`, con único sobre la pareja `(genero_id, mundo_id)`. El selector solo ofrece compradores activos y la API rechaza a cualquier otro rol (`409`). Los compradores ven todo; el responsable solo reduce la vista a "las combinaciones que me tocan" o "las de Ana". Un solo titular y solo comprador asignable son valores por defecto mientras Javier no responda las preguntas abiertas 1 y 2 de la ficha.

**Por qué.** Es lo que pidió Javier: "otro módulo… a nivel de género-mundo asignar un responsable", "los compradores pueden ver todo, pero para filtrar". El par género × mundo no existe como entidad en el árbol (los mundos existen en todos los géneros) y existe aunque no tenga líneas, así que no cabe como columna de `generos`, `mundos` ni del nodo `genero_mundo_linea`. Un usuario como responsable (y no un texto) permite filtrar por persona y sirve a la Fase 3, donde el comprador entra con "Mis combinaciones".

**Descartado.** Una columna en `mundos`, `generos` o en el nodo (no representan el par). Una tabla pre-poblada con las 40 filas (habría que sincronizarla al crear un género o un mundo y duplicaría la regla "no hay relación Género↔Mundo"). Texto libre (no filtra por usuario). Un suplente (nadie lo pidió; sería una columna nullable `suplente_perfil_id` más adelante). Que el responsable restrinja permisos (contradice lo dicho por Javier; si M9 quisiera limitar quién registra compras, sería una decisión de esa ficha).

## 2026-10-07 · Eliminar un comprador deja sus combinaciones sin asignar: `perfil_id` es `on delete cascade`

**Decisión.** `responsables_genero_mundo.perfil_id` referencia a `perfiles(id)` con `on delete cascade`; `genero_id` y `mundo_id` siguen `on delete restrict`. Al eliminar a un comprador, sus filas desaparecen y esas combinaciones aparecen en Faltantes. Eliminar nunca se bloquea por esto. Es la primera FK en cascada fuera de `perfiles → auth.users`. Se probó en un Postgres local que borrar el perfil, o la fila de `auth.users`, elimina las asignaciones; falta repetirlo con la API de Auth real.

**Por qué.** Respuesta de Javier: "si elimino al comprador quedarían sin asignar". Nada cuelga de la asignación (en la Fase 3 las compras cuelgan del usuario que las registra y de la combinación, no de esta fila) y la asignación es un atributo de la persona. Con `cascade` la fila existe si y solo si hay alguien asignado. Géneros y mundos son catálogos raíz con la regla de M1 "nada se elimina con hijos, se desactiva", y una asignación cuenta como hijo: eliminar uno con responsables responde `409`.

**Descartado.** `restrict` en `perfil_id` (obligaría a reasignar antes de borrar a alguien que ya se fue). `set null` (obligaría a `perfil_id` nullable y dejaría dos formas de "sin responsable": sin fila o fila con `null`, con reglas y pruebas duplicadas).

## 2026-10-07 · Desactivar al comprador o cambiarle el rol conserva la asignación, que pasa a ser faltante calculada

**Decisión.** Si un comprador se desactiva o deja de ser comprador, la fila se conserva y la combinación cuenta como faltante con un motivo visible: `responsable_inactivo` o `responsable_no_comprador` (si coinciden, gana `responsable_inactivo`). Reactivarlo o devolverle el rol la deja válida sin reasignar. Un rol desconocido cuenta como "ya no es comprador". Es el valor por defecto mientras Javier no responda la pregunta abierta 6 de la ficha.

**Por qué.** Es el mismo criterio sin cascada de `activo` del árbol y de M3 (`agrupacion_inactiva`): corregir un rol por error devuelve todo como estaba, y editar un usuario en `/usuarios` no borra datos de otra pantalla a escondidas. A cambio, la combinación no queda silenciosamente asignada a alguien que no entra o que ya no compra. La base solo sabe si hay fila; el resto se calcula, porque depende de `perfiles`, que cambia por otras pantallas.

**Descartado.** Limpiar las asignaciones al desactivar o al cambiar el rol (irreversible y con un efecto oculto desde `/usuarios`). Bloquear la desactivación o el cambio de rol (frena retirar a alguien).

## 2026-10-07 · Faltante = combinación vigente sin responsable válido, con una sola función `motivoFaltante`

**Decisión.** Una combinación es vigente si su género y su mundo están activos. Es faltante si es vigente y no tiene responsable válido (activo y comprador). `motivoFaltante` es la única definición y la usan la matriz, el resumen, el bloque, los filtros y el CSV. Las combinaciones sin líneas también cuentan: el hito es siempre "las 40 tienen responsable". Una combinación no vigente nunca es faltante y no se puede asignar (conserva la asignación que tuviera). Los filtros de la pantalla descartan las no vigentes, de modo que los conteos de los chips coinciden con `resumen`. Que cuenten las combinaciones sin líneas es el valor por defecto mientras Javier no responda la pregunta abierta 3.

**Por qué.** El producto cartesiano de géneros y mundos es la definición de combinación del árbol (los mundos existen en todos los géneros), y con una sola función no hay dos pantallas que cuenten distinto. Contar solo las que tienen líneas haría que el hito cambiara cada vez que se carga una línea nueva en un género-mundo vacío.

**Descartado.** Contar solo combinaciones con alguna línea vigente (el hito dejaría de ser estable).

## 2026-10-07 · `/usuarios` avisa y no bloquea

**Decisión.** Desactivar, eliminar o quitarle el rol de comprador a alguien con combinaciones pide un `confirm` con el conteo (`avisoResponsabilidades`); la API nunca lo rechaza. La lista de usuarios suma la columna "Responsable de" con enlace a la matriz filtrada por ese usuario, y tras eliminar un `Alert` dice cuántas combinaciones quedaron sin responsable (`DELETE` responde `{ id, combinaciones_liberadas }`). Las reglas de "último admin" y "no auto-eliminarse" no cambian.

**Por qué.** Javier dijo que al eliminar al comprador sus combinaciones quedan sin asignar; un `409` lo contradiría. Y bloquear la desactivación frenaría retirar a alguien. Avisar da la información en el momento en que se decide, sin quitar la decisión a quien administra.

**Descartado.** `409` por responsabilidades (contradice la respuesta de Javier).

## 2026-10-07 · No hay importador de responsables

**Decisión.** M1b no trae importador CSV ni Excel. Las 40 combinaciones se reparten con la asignación en bloque por fila, columna o toda la matriz. Solo se ofrece la descarga del CSV de la matriz, para compartir el reparto o revisarlo en Excel.

**Por qué.** Con el bloque, repartir todo el catálogo son cinco o seis acciones. Un importador sería la pieza más grande del módulo (hay que resolver usuarios por nombre o correo, con homónimos, errores de tipeo y desactivados) y cuesta lo mismo que lo que ahorra. Si el catálogo de géneros o mundos creciera a cientos de combinaciones, se reabre.

**Descartado.** Un importador de responsables por nombre o correo (por lo anterior).

## 2026-10-07 · `activo` queda en `responsables_genero_mundo` por convención y sin uso; quitar un responsable borra la fila

**Decisión.** La tabla lleva `activo boolean not null default true` por la convención de PLAN §4 ("toda tabla lleva `activo`"), pero la API no lo expone: toda asignación se escribe con `activo = true` y quitar un responsable borra la fila. Las lecturas tratan una fila con `activo = false` (solo posible desde el SQL Editor) como sin responsable, y al quitar esa fila se borra.

**Por qué.** Nada cuelga de la asignación, así que desactivarla en vez de borrarla solo agregaría un estado más sin dueño. Se mantiene la columna para no romper una convención que otras tablas y herramientas esperan. Si Javier prefiere no tener columnas sin uso, se quita con una migración (el mismo criterio con el que se descartaron `tallas` y `equivalencia_marca`).

**Descartado.** Desactivar la asignación en lugar de borrarla (un estado más sin dueño). Omitir la columna (rompe la convención de PLAN §4).

## 2026-10-07 · Numeración M1b, migración `0006_responsables.sql`, versión `0.7.0 · M1b`

**Decisión.** El módulo se llama M1b (un maestro más de la Fase 1 que cuelga del árbol), su migración es `0006_responsables.sql` y la versión que sale es `0.7.0 · M1b`. Entra antes de M5, que no depende de él.

**Por qué.** M5 sigue siendo la carga de histórico de ventas de la Fase 2 y renombrarla confundiría los documentos ya escritos. M1b es independiente de M2–M4, así que puede construirse mientras Javier valida sus hitos, y le permite repartir las combinaciones sin esperar a la Fase 2. Lo consumirán M7, M8 y M9 (filtro "Mis combinaciones" y documento para compradores partido por responsable).

**Descartado.** Renombrar la Fase 2 o llamarlo M5.

## 2026-10-11 · M5: la marca se guarda al detalle y su nivel se lee del maestro; no se agrupan marcas dentro de un nivel

**Decisión.** Los hechos de venta y stock referencian la marca tal como viene en el archivo (FK a `marcas`), y la agrupación de marca (uno de los cinco niveles) se lee de `marcas.agrupacion_marca_id` al agregar. No hay marca colectiva, ni lista de seguimiento, ni pantalla de marcas sugeridas, ni tabla de alias. Cada nombre normalizado es una marca distinta.

**Por qué.** Javier lo descartó: con cinco niveles ya definidos, agrupar marcas dentro de un nivel "sería hacer más completo algo que no se necesita". Guardar el detalle significa que mover una marca de nivel no obliga a recargar 45 meses (Vector-One copiaba la agrupación en cada fila y se desfasaba) y que M7 puede ordenar las cinco marcas principales por equivalencia directamente por venta. También sostiene el requisito de M7 y M8 de pronosticar por separado las marcas con `tratamiento_especial` dentro de su agrupación y su línea, sin ningún campo adicional.

**Descartado.** Marca colectiva para la cola larga y marcas en seguimiento (retiradas en la revisión de diseño, junto con la entrega `0.8.1`); copiar la agrupación en cada fila; tabla de alias (Javier confirmó con dos casos reales que nombres parecidos son marcas distintas). Si algún día hiciera falta agrupar la cola, se añade al leer, sin recargar.

**Estado (2026-10-13).** Matizada en parte por la mejora 02b: la cola larga sigue sin colectiva, sin lista de seguimiento y sin alias (eso se cumple tal cual), pero ahora existen **conjuntos de marcas** por casa o licencia, que Javier pidió el 2026-10-12 por otra razón (comprar como una sola marca a ALFA, ALFA JEANS y ALFA KIDS). Se aplican al leer, así que M5 sigue guardando el detalle y nada se recarga. Ver la entrada del 2026-10-12 "M2b: los conjuntos de marcas…".

## 2026-10-11 · M5: las marcas desconocidas se crean solas como red de seguridad; la lista de marcas se carga antes

**Decisión.** Una marca del archivo que no exista no bloquea la carga: se crea en la agrupación por defecto elegida al cargar (propuesta MID VALUE), con `tratamiento_especial` en falso. `VARIOS`, `OTROS` y `SIN MARCA` van siempre a MID VALUE. Orden de carga: marcas con su agrupación y tratamiento especial (importador de M2) → tiendas, con las tres que no son del sistema creadas y desactivadas → combinaciones nuevas del árbol → septiembre como piloto → resto del histórico.

**Por qué.** Exigir que las ~280 marcas existan antes obligaría a un alta previa por cada mes del histórico. El riesgo real es un error de tipeo en QlikView que cree una marca basura que nadie fusiona (no hay alias); los frenos son que el reporte previo lista todas las marcas nuevas con filas, venta y stock antes de confirmar, resalta como `posible_tipeo` las de una o dos filas, ofrece la lista en el formato del importador de M2, y `marcas-nuevas` solo se llama después de confirmar. Javier confirmó que cargará la lista de marcas primero, así que el alta automática debería casi no usarse. El orden importa porque el importador de M2 no actualiza existentes: si la venta entrara primero, las marcas nacerían en MID VALUE y habría que moverlas a mano.

**Descartado.** Exigir que existan antes; crear alias.

## 2026-10-11 · M5: una carga es un mes completo y se publica por cambio de estado

**Decisión.** Cada intento de carga de un mes es una fila de `cargas_venta_stock` con estado (`en_curso`, `publicada`, `reemplazada`, `retirada`, `abandonada`, `fallida`); los hechos van etiquetados con `carga_id`. Hay a lo sumo una carga `publicada` y una `en_curso` por mes (índices únicos parciales). Publicar es una función SQL (`publicar_carga_venta_stock`) que mide lo que hay en la base, lo compara con lo que el cliente dice haber enviado y, solo si coincide exactamente, pasa la anterior a `reemplazada` y esta a `publicada` con solo `update`. Toda lectura del histórico pasa por la vista `venta_stock_vigente`. La limpieza de filas de cargas terminales es un `delete` de handler por carga, guiado por `cargas_pendientes_limpieza()`.

**Por qué.** Garantiza que un corte nunca deja un mes parcial a la vista: o se publicó el mes nuevo entero o sigue el viejo. Las migraciones no pueden contener `DELETE` (se aplican con `execute_sql` y cualquier sentencia destructiva queda esperando una confirmación), así que el borrado va por handler y fuera de la ruta crítica. Una carga que no concilia no se publica, y reimportar el mismo mes deja las mismas filas.

**Descartado.** Borrar el mes e insertar el nuevo (un corte deja el mes parcial visible, y PostgREST no tiene transacciones); tabla de paso con `delete` dentro de una función (la migración no admite `delete`); particiones por mes (exigen DDL en tiempo de ejecución).

## 2026-10-11 · M5: la tabla de hechos no lleva `id`, `activo` ni `updated_at`, y solo tiene dos índices de lectura

**Decisión.** `venta_stock_mensual` tiene clave primaria compuesta `(carga_id, tienda_id, equivalencia_id, marca_id, agrupacion_talla_id)`, sin `id`, `activo`, `created_at` ni `updated_at`, con todas las FK `on delete restrict` y las medidas `not null default 0`. Índices extra: `(equivalencia_id, carga_id)` y `(marca_id, carga_id)`. No se indexan `tienda_id` ni `agrupacion_talla_id`.

**Por qué.** Las filas son inmutables (solo se insertan y se borran en bloque por carga), así que un `id` y su índice costarían unos 70 MB sin usarse en 1,5 millones de filas. Los dos índices cubren las lecturas por valor de M6 y M7 (la serie de una equivalencia o de una marca) y evitan un escaneo completo en el compute Micro. `tienda_id` tiene unos quince valores y `agrupacion_talla_id` dos: un índice no discrimina nada y cada uno costaría unos 75 MB. Es una excepción documentada a la convención de PLAN §4 y un criterio parcial frente al "indexar toda FK" de M3.

**Descartado.** Compactar con `carga_id` entero o `agrupacion_talla_id` `smallint` (ahorro de 15 % a cambio de una tabla que no se parece a ninguna otra). Con el plan Pro (8 GB) el espacio no es el límite; el compute sí.

## 2026-10-11 · M5: lo desactivado se excluye en silencio informativo, lo inexistente es error, y el bloqueo es por mes

**Decisión.** Las exclusiones por decisión (tienda, marca, línea, nodo o equivalencia desactivados; filas sin clasificar, de totales o en cero) son informativas y muestran su peso. Lo desconocido (tienda, combinación, talla, mes o número inválidos) es un error agrupado por valor. Un mes con errores del 2 % o más en filas, venta o stock valorizado se salta y los demás meses se cargan; la casilla "Cargar también los meses bloqueados" lo fuerza y el mes queda marcado Incompleto con su porcentaje. Las tres tiendas del archivo que no son del sistema se crean y desactivan en M4, sin tabla de exclusiones.

**Por qué.** Desactivar significa "no debe volver a aparecer" en todo el sistema, así que repetir esa decisión como alarma cada mes enseñaría a ignorar la lista de errores. Bloquear por mes (y no el archivo entero) evita que un año completo se pare por un error de clasificación en un solo mes, y el marcado Incompleto evita que lo forzado pase inadvertido. Es el criterio del 2026-10-02 (avisar y dejar cargar lo válido) aplicado al grano del mes.

**Descartado.** Tabla `tiendas_excluidas` con botón "Excluir siempre" (una tabla, tres endpoints y un botón para tres valores, cuando M4 ya resuelve eso con `activo = false`); bloquear el archivo entero.

## 2026-10-11 · M5: el archivo se lee en el navegador por bloques, se resuelve una vez y toda agregación se hace en SQL

**Decisión.** El archivo nunca se sube entero: el navegador lo lee por bloques, acumula en arreglos tipados con diccionarios y manda al servidor solo los valores distintos (tiendas, combinaciones, marcas, periodos). El servidor responde cómo se resuelve cada uno y las tandas viajan ya con ids resueltos, en filas posicionales (`TANDA_CLIENTE` 10 000 filas, `TANDA_INSERT_VENTAS` 2 000 por `upsert`). Las tandas son `upsert … ignoreDuplicates` sobre la clave primaria y se reintentan hasta tres veces. Ninguna lectura del histórico trae filas a Node.

**Por qué.** Un año son unos 33 MB y el histórico unos 120 MB; un objeto por fila costaría cientos de MB en el navegador. Resolver una sola vez evita releer árbol, tiendas y marcas unas 150 veces. Una respuesta perdida en la red es el fallo más común, y con `ignoreDuplicates` reenviar la tanda no duplica ni falla; la publicación sigue conciliando contra la base, así que la idempotencia no esconde nada. Vector-One leía `ventas_mensual` entera desde Node y reventaba.

**Descartado.** Subir el archivo entero; reenviar texto y reinterpretarlo en cada tanda; descartar el mes ante cualquier error de tanda.

## 2026-10-11 · M5: cifras de dos decimales como máximo, cifras enteras aceptables, `Revisar` a CENTRALES y `SIN MARCA`

**Decisión.** Al guardar, venta, costo y stock valorizado se redondean a 2 decimales y unidades y stock en unidades son enteros. El CSV de QlikView trae soles enteros (error máximo S/ 0,50 por fila, por debajo de 0,02 % en los totales de septiembre): el aviso de cifras enteras es informativo y nunca bloquea. La conciliación contra QlikView exige unidades y stock exactos y acepta una diferencia relativa menor al 0,1 % en soles. La talla `Revisar`, `-` y vacío se cargan como CENTRALES con aviso (~6 % de las filas y ~15 % de la venta en septiembre). El guion o vacío como marca se guardan como `SIN MARCA`, en MID VALUE como VARIOS y OTROS. El stock valorizado va a costo. Ningún mes se marca ni excluye como atípico al cargar.

**Por qué.** Con soles enteros una igualdad exacta nunca se daría; la tolerancia es lo bastante estricta para detectar un archivo truncado o un mes equivocado. `Revisar` no se guarda con su valor original porque la unidad de carga es el mes: si Javier decidiera repartirlo de otra manera, recarga los meses. Los meses atípicos y el tratamiento de la liquidación son asunto de M6 y M7. Javier confirmó el nombre `SIN MARCA` (2026-10-11).

**Descartado.** Exigir igualdad exacta con QlikView; guardar la talla original; adivinar la coma decimal (`12,5` es número inválido y, si más del 1 % de las celdas la usan, un diagnóstico bloqueante).

## 2026-10-11 · M5: toda la API de venta y stock exige `requirePlanner`, lecturas incluidas

**Decisión.** Las siete rutas de `/api/ventas/` responden `403` a un comprador, también las de lectura (`GET /api/ventas/cargas` y `GET /api/ventas/cargas/[id]`). La sección de menú Planificación y la página solo existen para admin y planner. Javier confirmó (2026-10-11) que el comprador no verá cifras de M5 antes de M8, donde el documento para compradores dirá qué cifras lleva.

**Por qué.** Venta y, sobre todo, costo son los datos más sensibles del sistema, porque de ellos sale el margen. Es la primera vez que una lectura no es `requireUser`: en los maestros "los compradores ven todo" hablaba de vocabulario de planificación, no de cifras, y dejar el costo al alcance de un rol que ni siquiera ve la pantalla lo habría permitido con un simple `curl`.

**Descartado.** Lecturas con `requireUser` como en M1 a M4.

## 2026-10-11 · M5: lo que decidió el backend al construir

**Decisión.** Cuatro ajustes respecto a la ficha. (1) `posible_tipeo` se decide solo por filas (una o dos en todo el archivo, y no comodín), sin umbral de venta, y trae la marca existente más parecida. (2) `archivo_posiblemente_truncado` no bloquea: avisa. (3) Aparecen el motivo y el diagnóstico `demasiados_valores` (más de 120 meses, 500 tiendas, 20 000 combinaciones o 5 000 marcas distintas) y la nota `fechas_con_dia` (el día se ignora y se toma el mes completo). (4) La conciliación contra QlikView compara con el total del archivo tal cual, antes de excluir nada; la identidad interna `archivo = cargado + exclusiones` sigue siendo exacta. Además, las huellas de stock de lo ya publicado se arman con un conteo `head` por la vista más las sumas que guardó la carga, y el acumulador del navegador detecta claves repetidas con una tabla hash abierta sobre `Float64Array`.

**Por qué.** Una hoja de 65 536 filas puede ser casualidad, y lo que de verdad delata un archivo cortado es que no cuadre contra QlikView; bloquear por esa sospecha estorbaba más de lo que protegía. Comparar con el archivo tal cual es lo que Javier tiene en QlikView: las exclusiones son decisión de Vector2 y se ven aparte. El conteo `head` evita traer filas a Node, y la tabla hash mantiene unos 60 B por fila en lugar de un `Map` con una entrada por clave.

**Descartado.** Bloquear por truncado; conciliar contra lo cargado (escondería lo que se excluyó); calcular las huellas con `leerTodo`.

## 2026-10-11 · M5: lo que decidió la migración `0007`

**Decisión.** (1) La vista `venta_stock_vigente` lleva `security_invoker = true` y **no** lleva `revoke` a `anon` ni `authenticated`. (2) Además del único parcial de `publicada`, hay otro de `en_curso` (`cargas_periodo_en_curso_uniq`). (3) `publicar_carga_venta_stock` devuelve `no_en_curso` también cuando la carga no existe. (4) `scripts/validar-migraciones-local.sh` crea los roles `anon`, `authenticated` y `service_role` si faltan. Las tres funciones llevan `revoke execute … from public, anon, authenticated` y `grant … to service_role`.

**Por qué.** Con `security_invoker` y RLS sin políticas, `anon` y `authenticated` obtienen cero filas de la vista, no un error; un `revoke` sobre la vista solo cambiaría eso por un error de permiso que no aporta protección. El único parcial de `en_curso` es lo que impide que dos personas carguen el mismo mes a la vez. La función no necesita distinguir "no existe" de "no está en curso": el handler de publicar ya responde `404` a una carga inexistente antes de llamarla, y lo que llega a la función es una carrera, que se trata igual. Un Postgres local no trae los roles de Supabase y la `0007` los usa en `grant` y `revoke`.

**Descartado.** `revoke` sobre la vista (redundante); un motivo aparte para carga inexistente.

## 2026-10-11 · M5: el descarte automático nunca retira un mes publicado; el redondeo no usa épsilon relativo

**Decisión.** `DELETE /api/ventas/cargas/[id]?solo=en_curso` solo descarta cargas `en_curso` y responde `409` si ya estaba publicada; el flujo de carga siempre lo usa. Si `publicar` falla de forma ambigua (red o `5xx`), el cliente consulta el estado real de la carga antes de decidir. Retirar un mes publicado es solo una acción manual de "Cargas por mes". El redondeo a céntimos limpia el ruido de coma flotante con `Number(x.toPrecision(15))`.

**Por qué.** Fueron los dos hallazgos de la QA. Ante una publicación cuya respuesta se pierde, el descarte automático habría retirado un mes que sí se publicó. Y el épsilon relativo anterior (`x * 1e-9`) corrompía los montos grandes: S/ 30 000 000 salía con +S/ 0,03. Con 15 cifras significativas, que es lo que un `double` garantiza, `1.005` se redondea bien y los montos grandes no se mueven. La lección es que un redondeo se prueba con montos grandes y que ningún proceso automático debe poder deshacer una publicación.

**Descartado.** Un `DELETE` sin condición de estado en el flujo de carga; un épsilon fijo.

## 2026-10-12 · M5b: el árbol manda; el mapeo solo entra cuando el árbol no resuelve (construido 2026-10-12)

**Decisión.** La mejora 05b (`docs/modulos/05b-mapeo-combinaciones.md`) añade el mapeo persistente de combinaciones históricas a una equivalencia vigente. El resolutor consulta el mapeo solo cuando el árbol devuelve algo distinto de `ok`; exacto antes que comodín; nunca se encadena; un destino no vigente (equivalencia, nodo, línea, género o mundo inactivos) no se aplica y la fila conserva su motivo original, con aviso rojo. Un origen que después se crea en el árbol deja el mapeo "obsoleto": se muestra, no se aplica.

**Por qué.** Sin encadenamiento no hay ciclos por construcción, y con el árbol por delante un mapeo viejo nunca puede tapar una combinación que ya existe. Nunca se carga a un destino que el maestro dice que no debe aparecer. Estado: construido el 2026-10-12 (`0.8.1 · M5`); hito pendiente de recorrer por Javier.

**Estado de la construcción (2026-10-12).** Se cumple tal cual, con una precisión que la propuesta no decía: si el mapeo exacto de un origen apunta a un destino no vigente, no se prueba el comodín de su terna (la fila conserva su motivo y el aviso rojo nombra el mapeo exacto), para que un comodín no tape una decisión más concreta que quedó rota.

**Descartado.** Mapeo con prioridad sobre el árbol; renombres encadenados.

## 2026-10-12 · M5b: el origen es la combinación exacta, con un único comodín `*` en la equivalencia (construido 2026-10-12)

**Decisión.** El origen de un mapeo es la combinación género, mundo, línea y equivalencia tal como llega a `previsualizar` (normalizada, con `-` sustituido por el nombre de la línea y vacío por `SIN EQUIVALENCIA`). El único comodín es `*` en la equivalencia: "cualquier equivalencia de esa terna que no resuelva" va a una equivalencia fija. No hay comodín en género, mundo ni línea.

**Por qué.** El comodín cubre "toda una línea histórica a otra" sin crear una fila por equivalencia ni esperar a que cada equivalencia vieja aparezca en otro año. Un comodín en la terna sería una regla de renombre, otro mecanismo, fuera de alcance. Estado: construido el 2026-10-12.

**Estado de la construcción (2026-10-12).** QA encontró que el importador aceptaba `*` en género, mundo o línea; ahora se rechaza (`origen_con_comodin_invalido`, `400` en el POST y fila omitida en el importador). El origen `*` nunca se marca obsoleto, porque no es una combinación real que el árbol pueda llegar a resolver.

**Descartado.** Comodines en la terna; expresiones regulares.

## 2026-10-12 · M5b: los hechos guardan solo el destino; cambiar un mapeo exige recargar el mes (construido 2026-10-12)

**Decisión.** El hecho se guarda con la `equivalencia_id` destino, sin marca en la fila; la auditoría de qué mapeos se aplicaron y cuánto pesaron va en el `reporte` de la carga. Borrar o cambiar un mapeo no toca las cargas publicadas: el efecto se ve al recargar el mes.

**Por qué.** Es el mismo criterio del árbol vigente: los hechos no copian texto y son inmutables. Un mapeo equivocado mezcla el histórico en silencio, por eso cada previsualización y cada reporte guardado muestran el detalle `ORIGEN → DESTINO`, y la recarga del mes (idempotente) es la corrección. Estado: construido el 2026-10-12.

**Estado de la construcción (2026-10-12).** El reporte guardado lleva `reasignadas`, el aviso con el detalle `ORIGEN → DESTINO` y los ids de los mapeos aplicados. Si dos usuarios guardan el mismo origen a la vez, sin `reemplazar` el segundo recibe `409 origen_repetido` y con `reemplazar` gana el último que escribe.

**Descartado.** Aplicar mapeos con `update` sobre hechos ya publicados; mapeo con vigencia por fecha (el árbol vigente rige todo el histórico, entrada del 2026-10-11).

## 2026-10-12 · M5b: `clasificacion_incompleta` es mapeable y `sin_clasificar` sigue excluida por decisión (construido 2026-10-12)

**Decisión.** Una fila con uno o dos de género, mundo y línea en blanco ya no se excluye al interpretar: la decide el resolutor como `clasificacion_incompleta`, que es mapeable. Con los tres en blanco sigue siendo `sin_clasificar`, excluida por decisión y no mapeable. En la precedencia, `tienda_vacia` y `talla_desconocida` ganan a `clasificacion_incompleta`, lo que ajusta la regla 14 de M5 y su test.

**Por qué.** Con uno o dos campos conocidos hay pistas para elegir un destino; con los tres en blanco no hay origen que mapear, y Javier decidió excluirlas el 2026-10-11. Estado: construido el 2026-10-12 (la pregunta abierta 2 de la ficha deja la puerta a un destino único para lo sin clasificar).

**Estado de la construcción (2026-10-12).** Un `-` con la línea en blanco no tiene nombre de línea al que sustituirse y se normaliza a `SIN EQUIVALENCIA`, para que el origen de un mapeo nunca tenga la equivalencia vacía.

**Descartado.** Mapear `sin_clasificar` desde ya.

## 2026-10-12 · M5b: la sugerencia es Dice sobre bigramas, determinista, y nunca se aplica sola (construido 2026-10-12)

**Decisión.** La sugerencia de destino es TypeScript puro (`sugerir-mapeo.ts`), calculada en el servidor porque tiene el árbol: similitud Dice sobre bigramas de `aCodigo`, se listan candidatas con puntuación de 0,50 o más, "fuerte" desde 0,80, hasta tres por origen. Nunca se aplica sola: Javier elige. El peso de la venta no entra en la puntuación.

**Por qué.** Dice tolera reordenar y recortar palabras (`PANTALON DENIM` frente a `DENIM PANTALON`) y es trivial de probar, a diferencia de Levenshtein. La venta metería sesgo hacia lo grande. Es ayuda y no automatismo, el mismo criterio que 02b para sus sugerencias. Estado: construido el 2026-10-12.

**Estado de la construcción (2026-10-12).** Dos puntuaciones de ejemplo de la propuesta estaban mal calculadas: la fórmula da 0,89 para `SKINY` frente a `SKINNY` y 0,96 para `PANTALÓN DRIL` frente a `PANTALON DRILL` (no 0,86 ni 0,91). La fórmula no cambió; se corrigieron la tabla de casos de la ficha y el test.

**Descartado.** Distancia de Levenshtein; aplicar la sugerencia fuerte automáticamente.

## 2026-10-12 · Numeración de migraciones y versiones de las mejoras 05b, 05c, 02b y M6 (05b construida 2026-10-12 y 05c 2026-10-13; 02b y M6, pendientes de construcción)

**Decisión.** Orden de construcción y numeración final, fijada con Javier el 2026-10-12: 05b mapeo de combinaciones, migración `0008` y `0.8.1 · M5`; 05c ubicaciones ignoradas y conciliación, `0009_ubicaciones_ignoradas.sql` y `0.8.2 · M5`; 02b nivel de planificación y marcas relevantes por GML, `0010` y `0.8.3 · M2b`; M6 curvas de estacionalidad, `0011` (la versión `0.9.0 · M6` no cambia). Los documentos de las cinco fichas y PLAN §4, §5 y §7 se renumeraron en consecuencia.

**Por qué.** Cuatro fichas se escribieron en paralelo y las tres primeras reclamaron la misma `0008` y la `0.8.1`. 05b es urgente (el histórico de 2023 en adelante trae combinaciones que ya no existen y bloquean meses) y 05c corrige dos fricciones del piloto de septiembre, así que ambas se construyen antes que 02b y M6. Una migración numerada dos veces no se detecta hasta aplicarla.

**Descartado.** Mantener `0008` y `0.8.1` para 02b (ya reclamadas por la 05b, que se construye antes).

**Estado (2026-10-12).** La 05b se construyó con `0008_mapeo_combinaciones.sql` y `0.8.1 · M5`, como estaba previsto. 05c (`0009`, `0.8.2`), 02b (`0010`, `0.8.3`) y M6 (`0011`) siguen sin construir.

**Estado (2026-10-13).** La 05c se construyó con `0009_ubicaciones_ignoradas.sql` y `0.8.2 · M5`, como estaba previsto. 02b (`0010`, `0.8.3`) y M6 (`0011`) siguen sin construir.

**Estado (2026-10-13, cierre).** 02b y el paso 1 de M6 se construyeron, con dos cambios sobre lo previsto aquí: se intercaló una migración (`0012`, función de sugerencias v2) y una versión (`0.8.3 · M5`, regla de carga de M5), así que 02b salió como `0010` y `0.8.4 · M2b`, M6 paso 1 como `0011` y `0.9.0 · M6`, el paso 2 de M6 pasa a `0013` y M7 a `0014`. Ver la entrada "Renumeración final" del 2026-10-13.

## 2026-10-12 · M5c: las ubicaciones que no son tiendas viven en `ubicaciones_ignoradas`, no en `tiendas` desactivadas (construido 2026-10-13)

**Decisión.** Las ubicaciones del archivo de venta que no son tiendas (la central, las oficinas) se guardan en una tabla propia, `ubicaciones_ignoradas` (nombre normalizado único, nota, sin FKs ni seed), administrada en Maestros → Tiendas y con un botón *Ignorar esta ubicación* en el reporte previo que recalcula sin releer el archivo. Sus filas se excluyen por decisión con el motivo `ubicacion_ignorada` (antes `tienda_excluida`, que nunca se usó), no pesan en el 2 % de errores y no crean tiendas. El resolutor busca tienda por nombre, tienda por código, ubicación ignorada y por último desconocida: si existe una tienda con el mismo nombre, la tienda manda y la fila ignorada queda "sin efecto". Sustituye a la entrada del 2026-10-11 "lo desactivado se excluye en silencio informativo…", en lo que dice de crear desactivadas las tres tiendas "sin tabla de exclusiones" (el resto de esa entrada sigue en pie).

**Por qué.** Javier las definió como "espacios sin importancia", no como tiendas inactivas: el maestro de tiendas no debe llevar filas que no lo son, ni mostrarlas en selectores, calendario, importador o conteos de M4, ni exigir un código inventado. Estado: propuesta de la ficha `docs/modulos/05c-ubicaciones-conciliacion.md`, pendiente de aprobación y de construcción.

**Descartado.** Seguir con `tiendas.activo = false`; un botón "Excluir siempre" sin pantalla de administración.

**Estado de la construcción (2026-10-13).** Construido en `0.8.2 · M5` con la migración `0009_ubicaciones_ignoradas.sql` (aplicada en Vector2 y verificada): la decisión se cumple tal cual, y el "Estado: propuesta" de arriba queda superado por esta línea. Hito pendiente de recorrer por Javier. Precisiones al construir: el índice del resolutor guarda `{ id, nota }` por nombre (no solo la nota), para que *Ignorar esta ubicación* recalcule sin volver a consultar; el esquema de edición no toca la nota si la petición no la trae; y el atajo del reporte previo abre un diálogo con nota opcional en vez de un `confirm`. Detalle en `docs/modulos/05c-ubicaciones-conciliacion.md`.

## 2026-10-12 · M5c: la conciliación contra QlikView compara con el comparable, mostrando siempre las cinco cifras (construido 2026-10-13)

**Decisión.** La conciliación compara los totales que escribe Javier con el **comparable** = archivo menos las exclusiones `sin_clasificar` y `fila_total`, que la tabla de QlikView de Javier no muestra (sus dimensiones son género, mundo y línea). La tabla muestra siempre archivo, no comparable, comparable, cargado y QlikView. Las tolerancias no cambian: unidades y stock en unidades exactos; soles con diferencia relativa menor al 0,1 %. Los reportes guardados con `0.8.0` se leen sin migrarlos, con una nota de que concilian contra el archivo completo. Sustituye a "compara con el total del archivo tal cual" de la entrada del 2026-10-11 sobre lo que decidió el backend.

**Por qué.** Contra el archivo completo siempre decía "difiere" porque las filas sin género, mundo ni línea no existen para el objeto de QlikView. No se restan las ubicaciones ignoradas ni los géneros, mundos o líneas desconocidos sin evidencia: si el hito demuestra lo contrario, es una línea en `MOTIVOS_NO_COMPARABLES`. Estado: propuesta, pendiente de aprobación y de construcción.

**Descartado.** Conciliar contra lo cargado (esconde lo excluido); restar también ubicaciones ignoradas o géneros desconocidos sin evidencia; varias bases a elegir.

**Estado de la construcción (2026-10-13).** Construido en `0.8.2 · M5`: el "Estado: propuesta" de arriba queda superado por esta línea. Hito pendiente de recorrer por Javier. Se cumple tal cual, con una precisión: el porcentaje de la diferencia se **trunca** en vez de redondear, para que 0,099996 % no se lea "0,1" dentro de un "Coincide". Sigue abierta una pregunta que esta entrada daba por cerrada: `TOLERANCIA_UNIDADES` vale 0 (unidades exactas), definida solo en `src/lib/ventas/tipos.ts`, y Javier debe decidir si deja las unidades exactas o admite unas pocas unidades (se habló de ±5); la recomendación es una tolerancia pequeña. Mientras no responda, rige 0. Si se cambia, irá en una entrada nueva que referencie a esta.

## 2026-10-12 · M2b: el nivel de planificación (GML o GMLE) es una columna del nodo (construido 2026-10-13)

**Decisión.** `genero_mundo_linea.nivel_planificacion` vale `GML` por defecto o `GMLE`. Un nodo `GML` es una sola unidad de planificación; uno `GMLE` se abre y cada equivalencia activa es una unidad. Se edita en el Árbol (uno a uno, en bloque, por línea y por archivo). Cambiarlo no borra nada: M5 sigue al detalle y la estacionalidad (M3) sigue asignándose por equivalencia; la curva de un nodo `GML` la calcula M7 como mezcla ponderada de las curvas de sus equivalencias (`curvaUnidad`).

**Por qué.** Javier: la mayoría de los flujos se trabaja a nivel GML y solo algunos se abren a GMLE, y necesita "un lugar donde definamos qué se planifica a nivel de equivalencia". Es una propiedad del maestro y se guarda en el maestro, como `lineas.temporada` o `tiendas.tipo`; una columna con `default` evita tablas y `UPDATE`.

**Descartado.** Bandera por equivalencia (crea un tercer grano, el "resto del GML", que M7, M8 y las pantallas tendrían que entender); tabla aparte de niveles (nada que la columna no dé); asignar agrupación de estacionalidad directamente al nodo (dos lugares para la misma cosa). Si Javier necesita abrir una sola equivalencia de un nodo, es una columna más y una fila más en `claveFlujo` (pregunta 13 de la ficha, que sigue abierta).

**Estado de la construcción (2026-10-13).** Construido en `0.8.4 · M2b` con la migración `0010`. El hito de M3 ("toda equivalencia activa tiene agrupación") no se relaja para los nodos `GML`; al abrir un nodo a GMLE con equivalencias sin agrupación, el Árbol avisa y no bloquea.

## 2026-10-12 · M2b: las marcas relevantes se definen por marca × GML con una modalidad explícita; la casilla se conserva (construido 2026-10-13)

**Decisión.** El tratamiento especial de una marca se define por marca × GML (`marca_gml_especial`, nivel B), con dos modalidades guardadas en `marcas.modalidad_tratamiento`: `por_gml` (la marca es relevante en los GML que se le asignan: dentro de su agrupación se ve aparte y las demás son "otras de la agrupación") y `barrido` (flujo propio sin detalle por GML). La casilla `tratamiento_especial` de M2 se conserva y la API la mantiene coherente: hacer relevante a una marca la marca en `por_gml` y lo informa; desmarcarla conserva sus GML como **ignorados**; quitar el último GML no la devuelve sola a `barrido` (queda "pendiente: sin GML"). Una casilla con modalidad nula se lee como `barrido`. Las asignaciones se calculan vigentes o ignoradas según el árbol y la marca, y nunca se borran solas. `marca_id` va en cascada y el nodo en `restrict`.

**Por qué.** ALFA es fuerte en jeans y no en ternos: la relevancia es por GML, no de la marca entera. La modalidad explícita evita que un estado intermedio (marca recién marcada, GML desactivado por otra pantalla) cambie un flujo en silencio, y permite pasar una marca a `barrido` conservando sus GML por si vuelve. La casilla sigue haciendo falta para el tipo `barrido`, que no tiene GML, y la trae el importador de M2. El `check` de la base va en un solo sentido (modalidad exige casilla) porque el inverso exigiría un `UPDATE` en la migración; la API cubre el otro (toda escritura que enciende la casilla escribe modalidad).

**Descartado.** Deducir el tipo de la ausencia de GML; exigir marcar antes de asignar (`409`) o quitar la casilla; borrar las asignaciones al desmarcar o al desactivar un GML.

**Estado de la construcción (2026-10-13).** Construido en `0.8.4 · M2b`. QA encontró que el importador de marcas dejaba la casilla encendida sin modalidad; ahora escribe `barrido`, que es lo que la regla ya decía. Las veinticuatro preguntas de la ficha siguen con su valor por defecto, que es lo construido.

## 2026-10-12 · M2b: los conjuntos de marcas son una marca cabeza y se aplican al leer; cambia la decisión del 2026-10-11 (construido 2026-10-13)

**Decisión.** Un conjunto es una marca **cabeza** (`marcas.conjunto_marca_id` apunta a ella) más sus miembros: ALFA + ALFA JEANS + ALFA KIDS = ALFA. La **unidad de marca** (`marcas_unidad`) es la cabeza si el conjunto es efectivo (la cabeza está activa) y la marca misma si no. En el flujo mandan la agrupación, la casilla, la modalidad y la relevancia de la cabeza; la configuración propia de un miembro se conserva ignorada mientras pertenezca al conjunto. Una marca está en a lo sumo un conjunto y no hay cadenas (lo hace cumplir la API); VARIOS, OTROS y SIN MARCA no entran. Si se desactiva la cabeza, los miembros vuelven a contar como ellos mismos (con aviso) y al reactivarla el conjunto vuelve. M7 y M8 agregan **siempre** por `unidad_marca_id`, nunca por la agrupación del miembro.

**Por qué.** Javier, justificado el 2026-10-12: "algunas marcas, más allá de la agrupación por valor, requieren convertirse en un conjunto de marcas para ver el flujo". Esto sustituye en parte la decisión del 2026-10-11 de no agrupar marcas dentro de un nivel: aquella apuntaba a reducir la cola larga y esta agrupa por casa o licencia, a elección del planner. Lo que hace barata la excepción es que M5 sigue guardando la venta al detalle de marca, sin alias: el conjunto es un mapeo de lectura y armarlo, cambiarlo o deshacerlo nunca obliga a recargar un mes. Una cabeza que es una marca (y no una entidad aparte) evita duplicar agrupación, casilla, modalidad y nota, y no vuelve polimórfica la relevancia.

**Descartado.** Tabla `conjuntos_marca` aparte; alias que renombren al cargar; conjuntos anidados y una marca en varios conjuntos (si hiciera falta, sería por marca × GML, no por conjunto).

**Estado de la construcción (2026-10-13).** Construido en `0.8.4 · M2b`: pestaña Conjuntos, sugerencia de conjuntos por nombre (primera palabra común o similitud de 05b, solo lista, nunca se aplica sola), importador `MARCA, CONJUNTO` y columna opcional `CONJUNTO` en el de marcas. Falta que Javier entregue la lista real de conjuntos.

## 2026-10-12 · M2b: contrato para M7 y M8, y las sugerencias nunca se aplican solas (construido 2026-10-13)

**Decisión.** M7 y M8 consumen tres piezas en `src/lib/marcas/gml/`: `claveFlujo(hecho, config)`, que reparte cada hecho de M5 en una y solo una fila (partición completa y disjunta, evaluada siempre sobre la unidad de marca); `curvaUnidad`, que da la curva de una unidad; y la vista `marca_gml_especial_vigente`, con `GET /api/marcas/gml-especial/vigentes`. La venta de una marca relevante en los GML donde no lo es va a "otras de la agrupación"; las marcas al barrer quedan **fuera** de las unidades de planificación y tienen un flujo propio. Las sugerencias de marcas relevantes salen de la venta de M5 por una función SQL, son ayuda y se aplican solo cuando el planner las elige. Los importadores de nivel y de relevantes comparten `resolverGml` y nunca crean árbol; el de nivel deja que el archivo mande y el de relevantes no quita lo ausente.

**Por qué.** M7 y M8 no están construidos y definirlos sin este contrato los obligaría a reescribir la partición de la venta cada uno por su lado. Una sugerencia aplicada sola marcaría marcas sin que nadie lo decida.

**Descartado.** Un "resto de la marca" como tercer flujo (por ahora cae en "otras"); tope duro de cuatro relevantes por agrupación y GML (hoy es un aviso suave).

**Estado de la construcción (2026-10-13).** Construido en `0.8.4 · M2b`. Lo consumirá M7 (`docs/modulos/07-proyeccion-anual.md`).

## 2026-10-13 · M2b: las sugerencias de marcas relevantes usan una función SQL nueva, `sugerir_marcas_relevantes_v2` (migración `0012`)

**Decisión.** Se añade `sugerir_marcas_relevantes_v2` (migración `0012_sugerir_marcas_relevantes_v2.sql`) y la de `0010` queda en la base **sin uso**: no se elimina porque las migraciones no admiten `DROP`. La v2 aplica el orden, el tope por (nodo, agrupación) y la participación mínima dentro de SQL, y mide con la misma medida que ordena (`venta_soles` o `unidades`) sobre el total completo de la agrupación en el nodo. La `0012` se aplicó **a mano** en Vector2 el 2026-10-13, tras un reinicio del agente de datos.

**Por qué.** La QA midió que las sugerencias paginadas con `range` eran lentas: cada página re-ejecutaba la agregación completa de `venta_stock_vigente` (unas 400 mil filas, alrededor de 0,65 s) y con top 4 la función devolvía unas 11 mil filas, de 12 a 58 páginas, minutos en el compute Micro. Además, con `medida = unidades` el cliente recalculaba la participación sobre una cola ya recortada por soles, que daba un número inexacto. Cambiar el tipo de argumentos de la función existente con `create or replace` habría creado un overload ambiguo; un nombre nuevo no.

**Descartado.** Seguir paginando; recortar en el cliente; alterar la función de `0010`.

## 2026-10-13 · M2b: las vistas y la función nuevas son `security invoker` y se cierran a `anon` y `authenticated` con `revoke`

**Decisión.** `marcas_unidad`, `marca_gml_especial_vigente` y las funciones de sugerencias son `security invoker`, con `search_path` vacío, y la migración revoca el acceso de `public`, `anon` y `authenticated` y lo concede solo a `service_role`. Corrige dos detalles de la ficha: decía que las vistas no llevarían `revoke` (el criterio de `venta_stock_vigente` en `0007`) y que la función sería `security definer`.

**Por qué.** Por defecto Supabase deja `select` y `execute` abiertos a esos roles sobre lo nuevo de `public`. Con RLS sin políticas ya obtendrían cero filas (el criterio por el que `0007` no revocó nada sobre `venta_stock_vigente`), pero `0010` prefirió cerrar además el acceso directo; solo el backend las lee. `security invoker` evita que la función corra con privilegios de su dueño.

**Descartado.** Dejar los privilegios por defecto; `security definer` en la función.

## 2026-10-13 · Los controles de formulario compartidos no imponen ancho ni alto si quien los usa ya pide uno; la edición de Marcas y Tiendas va en diálogo

**Decisión.** `clasesControl` (`src/components/ui/form.tsx`) añade `w-full` y `h-10` solo si el `className` recibido no trae una clase de ancho ni de alto (con variantes como `md:w-1/2` permitidas). Test en `tests/ui.form-clases.test.ts`. Además, la edición de una marca y de una tienda pasó de la fila de la tabla a un diálogo que enfoca el primer campo al abrir (commit `fb168ad`, ya subido).

**Por qué.** En la QA de 02b el `Select` de nivel del Árbol, que pedía `w-44`, colapsaba la columna de líneas porque `w-full` ganaba: Tailwind ordena las utilidades del mismo grupo por nombre, no por el orden en `className`, así que dejar las dos clases hacía que el resultado dependiera del valor. El cambio a diálogo no altera ninguna regla de edición: solo cambia dónde se edita.

## 2026-10-13 · M5 0.8.3: la equivalencia inexistente o inactiva de un nodo vigente se envía a la GML sin equivalencia

**Decisión.** Decisión de Javier: "si la equivalencia no está creada porque es data antigua que no tiene la misma clasificación que la actual, se clasifica a la GML sin equivalencia". Si el nodo género-mundo-línea de la fila existe y es vigente pero su equivalencia no existe o está inactiva, la fila se carga en la equivalencia de nivel GML del nodo: primero la genérica activa, si no la equivalencia activa que se llama como la línea, y si no hay ninguna queda el error original (hoy 286 de 590 nodos tienen genérica, 403 tienen la igual a la línea y 117 ninguna de las dos). Precedencia: árbol exacto, mapeo explícito, envío a la GML, error. Solo `previsualizar` lo activa (`enviarAGml`, opt-in). No suma al porcentaje de errores ni bloquea el mes. El reporte lo muestra en el bloque "Equivalencias enviadas a la GML sin equivalencia", con un botón Asignar que crea un mapeo que gana al envío; `enviadas_a_gml` es una nota informativa.

**Por qué.** La data de 2023 en adelante trae equivalencias que ya no existen con la misma clasificación; mandar esos meses a "error" los bloquea por algo que no es un error de datos sino un cambio de árbol. Javier prefirió cargar la venta en el nivel GML a perderla o mapear una por una. El envío es opt-in porque los demás usos del resolutor (estado de un mapeo, alta e importación de mapeos, sugerencias) necesitan saber si el árbol resuelve sin fallback; con el envío siempre activo ningún mapeo se podría crear. Un mapeo activo cuyo destino ya no es vigente no deja pasar al envío: es una decisión rota que debe verse en rojo.

**Descartado.** Que el envío fuera el comportamiento por defecto del resolutor; enviar a la GML también cuando el nodo no existe o no es vigente (ahí la clasificación sí es desconocida).

**Estado de la construcción (2026-10-13).** Construido en `0.8.3 · M5`, sin migración. Complementa, sin cambiarla, la entrada del 2026-10-12 "M5b: el árbol manda; el mapeo solo entra cuando el árbol no resuelve".

## 2026-10-13 · M6: la temporada de la agrupación de estacionalidad es invierno, verano o toda temporada, y el Niño solo afecta a las de invierno (construido 2026-10-13)

**Decisión.** Javier: "en las agrupaciones de estacionalidad deberíamos marcar si es una estacionalidad de invierno, verano o toda temporada; las de invierno se afectan por el Niño". La temporada es la columna `agrupaciones_estacionalidad.temporada` (`invierno`, `verano`, `todo_el_ano`, por defecto `todo_el_ano`) y la fija el planner; el sistema solo sugiere la mayoritaria entre las líneas de sus equivalencias (`lineas.temporada` de M1). Un periodo atípico de alcance `invierno` solo aplica a agrupaciones de invierno. No vive en la agrupación de marca ni es una casilla booleana.

**Por qué.** Las curvas se calculan por agrupación de estacionalidad, así que ahí es donde se decide qué meses se descuentan; en la agrupación de marca no cambiaría la forma de ninguna curva. Las agrupaciones existentes nacen como "toda temporada" sin `UPDATE` porque clasificarlas sería inventar; Javier las marca desde la pantalla. Cierra la pregunta 6 de M3 y la 1 de M6.

**Descartado.** Casilla booleana `afectada_por_atipicos`; heredar la temporada de la línea; marcarlo en la agrupación de marca; un botón para aplicar la sugerida a todas (queda como pregunta 12 de M6, con valor por defecto "solo sugerencia").

**Estado de la construcción (2026-10-13).** Construido en `0.9.0 · M6` (migración `0011`): selector en M3, columna en el importador (`TEMPORADA`) y tabla editable en la pantalla de M6. El chip de temporada en las tarjetas del Mapa de M3 no se construyó.

## 2026-10-13 · M6: los periodos atípicos son un catálogo editable y también el dato que M7 lee; la premisa del Niño se mide, no se asume (construido 2026-10-13)

**Decisión.** Los meses atípicos (El Niño costero 2023 y 2026) viven en la tabla `periodos_atipicos` (rango de meses, motivo, alcance `invierno` o `todas`, sin seed), editable por el planner, y no en el código. Javier: "al momento de proyectar unidades sí sirve saber si el año fue Niño o no", así que el catálogo es el dato que M7 lee, por año y por agrupación, para saber si un año fue atípico y cuántos meses. El contrato estable es la función pura `claseDeAnio` (`normal` o `atipico`, con `meses_atipicos` y `completo`) y `GET /api/periodos-atipicos/anios`. La premisa de Javier, "el Niño cambia el volumen, no la forma de la curva", **se mide en el paso 2**: M6 comparará por agrupación de invierno la curva con y sin los años de Niño; el efecto sobre el volumen (`ratio_volumen`) se entrega a M7.

**Por qué.** Los meses del Niño los decide Javier (marzo a mayo de 2023 es una propuesta por confirmar y los de 2026 no están definidos) y cambian con cada evento. Un catálogo permite usarlos antes de que exista el cálculo y sustituye la columna `es_nino` por año de Vector-One, que obligaba a descartar años enteros. Medir la premisa en vez de asumirla convierte un riesgo (pocos años completos) en un dato por agrupación.

**Descartado.** Columna por año; meses fijos en el código; asumir sin medir que el Niño solo mueve el volumen.

**Estado de la construcción (2026-10-13).** El catálogo, `claseDeAnio` y `/anios` están construidos (`0.9.0 · M6`); la comparación de forma, `ratio_volumen` y el ajuste de volumen son del paso 2 y de M7. Las demás decisiones propuestas por la ficha de M6 (curva como participación del mes en el año, candidatas con backtesting, vista materializada, curva versionada) siguen como propuesta hasta construir el paso 2.

## 2026-10-13 · M6: el paso 1 se entrega recortado, sin `GET /api/curvas`, y con una migración parcial

**Decisión.** El paso 1 de M6 (`0.9.0`) entrega el mantenimiento (periodos atípicos y temporada) y deja fuera `GET /api/curvas`, la pestaña Corridas y el chip de temporada del Mapa. La pestaña Curvas se alimenta de `GET /api/agrupaciones-estacionalidad`, `GET /api/periodos-atipicos` y `/anios`; `GET /api/curvas` llega en el paso 2. La migración se parte: `0011` lleva solo la temporada y los periodos atípicos; la vista materializada, la función de refresco, las corridas y las curvas irán en `0013`.

**Por qué.** Sin corridas ni vista materializada, `GET /api/curvas` no tendría nada que resumir, y una vista materializada sin refrescar sería un objeto sin dueño. Partir la migración evita dejar en la base objetos sin uso mientras Javier solo mantiene el catálogo.

**Descartado.** Una sola migración con todo, que era lo que preveía la ficha original.

## 2026-10-13 · Renumeración final de migraciones y versiones (M2b y M6 paso 1 construidos)

**Decisión.** Numeración final: `0008` mapeo de combinaciones (`0.8.1 · M5`), `0009` ubicaciones ignoradas (`0.8.2 · M5`), regla de carga a la GML sin equivalencia (sin migración, `0.8.3 · M5`), `0010` M2b (`0.8.4 · M2b`), `0011` M6 paso 1 (`0.9.0 · M6`), `0012` sugerencias v2 de M2b (sin versión propia: se desplegó con `0.8.4`), `0013` M6 paso 2 (vista materializada, corridas y curvas; antes "`0012`", versión prevista `0.9.1 · M6`) y `0014` M7 (antes "`0012`", `0.10.0 · M7`). Las tres entregas `0.8.3`, `0.8.4` y `0.9.0` se despliegan juntas y el pie del menú en Railway muestra `0.9.0 · M6`. Las fichas 06 y 07 y PLAN se renumeraron en consecuencia.

**Por qué.** La `0012` que M6 y M7 reclamaban la tomó la función de sugerencias v2 al construir 02b, que no estaba prevista; el desfase de versiones viene de que la decisión de Javier sobre la regla de carga llegó el 2026-10-13, cuando 02b ya tenía reservada la `0.8.3`. Una migración numerada dos veces no se detecta hasta aplicarla, así que se corrigieron todos los documentos a la vez.

**Descartado.** Conservar `0012` para M6 y M7: chocaría con la función v2 ya construida.

## 2026-10-13 · M3: el importador masivo de agrupaciones solo crea; lo que ya existe no se actualiza (construido 2026-10-13)

**Decisión.** Javier pidió "una carga masiva" de agrupaciones de estacionalidad. El importador nuevo (`POST /api/agrupaciones-estacionalidad/importar`, columnas `NOMBRE`, `CODIGO`, `GENEROS`, `TEMPORADA`, `DESCRIPCION`, `ORDEN`) solo crea agrupaciones nuevas, activas y con al menos un género. Una que ya existe (mismo nombre normalizado, o mismo código derivado cuando el archivo no trae `CODIGO`) no se actualiza, no se reactiva y no cambia de géneros, temporada, descripción ni orden: su fila sale como informativa (`ya_existe`). Nunca asigna equivalencias, nunca crea géneros y nunca quita nada. Es un importador aparte del de Equivalencias, que no cambia.

**Por qué.** Es la misma regla que ya rige a los demás importadores (marcas, tiendas, conjuntos): una carga masiva no pisa lo que el planner ajustó en la pantalla, y reimportar el mismo archivo debe dar cero cambios. Un archivo que actualizara obligaría a decidir qué campo vacío borra y cuál conserva, y un error de Excel cambiaría géneros o temporadas de agrupaciones con equivalencias asignadas, con la regla de género (decisión del 2026-10-06) en medio. Como crear es la única operación, la previsualización puede mostrar todas las agrupaciones nuevas con sus géneros y detectar tipeos antes de aplicar. Un código repetido dentro del archivo se rechaza en lugar de desambiguarse con `_2` (como hace el importador de Equivalencias): aquí el archivo es la definición y un código duplicado casi siempre es un descuido.

**Descartado.** Actualizar las existentes (más riesgo que beneficio para la primera carga); ampliar los géneros de las existentes (ya descartado el 2026-10-06 para el importador de Equivalencias); reactivar las inactivas; desambiguar códigos con sufijo. Si Javier necesita una carga de actualización, será otra entrada con su propia regla.

**Estado de la construcción (2026-10-13).** Construido en `0.9.1 · M3`, sin migración. Escritura en tandas de 500 con `upsert … ignoreDuplicates` y compensación (borrar las agrupaciones de la tanda cuyo vínculo de géneros falló); sin transacción, y reimportar completa lo que faltó. No se probó contra Supabase real.

## 2026-10-13 · M3: el Excel de faltantes lleva las mismas seis columnas que el CSV, incluida `TEMPORADA`, y sale de la misma función (construido 2026-10-13)

**Decisión.** La pestaña Faltantes gana el botón "Descargar faltantes (Excel)", un `.xlsx` generado en el navegador (SheetJS cargado bajo demanda) con una hoja `ASIGNAR` y las columnas `GENERO, MUNDO, LINEA, EQUIVALENCIA, AGRUPACION, TEMPORADA`. El CSV, que tenía cinco columnas, pasa a las mismas seis. Los dos salen de `filasFaltantes`, respetan los mismos filtros y se pueden subir en Importar → Equivalencias, que acepta `TEMPORADA` como opcional desde `0.9.0`.

**Por qué.** Javier pidió un Excel para descargar las equivalencias sin asignación y completarlas; el CSV, que ya existía, obliga a abrirlo con la codificación y el separador correctos. Que sea el mismo contenido, de la misma función, garantiza que ninguno de los dos se desfase del formato del importador, y una prueba lo comprueba. `TEMPORADA` va vacía y opcional porque el mismo archivo que asigna puede fijar la temporada de las agrupaciones que cree.

**Descartado.** Un Excel con otras columnas o una hoja por género (se rompería la regla de que lo descargado se sube tal cual); generarlo en el servidor (el navegador ya tiene la lista plana y los filtros); reemplazar el CSV (se conserva: no depende de ninguna librería y ya lo usaban).

**Limitación.** El encabezado no sale en negrita: la edición comunitaria de SheetJS (0.18.5) no escribe estilos. Se compensa con anchos de columna ajustados al contenido; no justifica cambiar de librería.

## 2026-10-13 · La etiqueta `0.9.1` pasa a M3; el paso 2 de M6 se desplaza

**Decisión.** La entrega `0.9.1 · M3` (importador masivo de agrupaciones y Excel de faltantes) tomó la versión `0.9.1`, que el plan reservaba al paso 2 de M6 (curvas). Se registra el desplazamiento: el paso 2 de M6 llevará la siguiente etiqueta libre (previsiblemente `0.9.2 · M6`), a confirmar al construirlo; M7 sigue después. Las fichas de M6 y M7 todavía dicen `0.9.1` para el paso 2 y se corregirán al abrirlo.

**Por qué.** Mismo caso que la renumeración del 2026-10-13: la versión se asigna en el orden en que cierran las entregas, no en el que se planearon. Una mejora pequeña pedida por Javier no debía esperar al paso 2.

**Descartado.** Etiquetar esta entrega `0.9.0 · M3` (chocaría con la de M6 ya desplegada) o dejarla sin versión (el pie del menú es lo que Javier compara con Railway).

## 2026-10-14 · Equipo de agentes: `seguridad` y `arquitecto-revisor` siempre con opus, `arquitecto` siempre con fable

**Decisión.** Se suman dos agentes de solo lectura a los seis originales: `seguridad` (auditoría de guards, fuga entre roles, permisos y funciones de Supabase, secretos, importadores y XSS) y `arquitecto-revisor` (segunda opinión sobre las fichas del arquitecto: omisiones, contradicciones, casos borde, riesgos, contrastados con la base real). Los dos corren siempre con el modelo `opus`, fijado en el encabezado de su archivo y pasado además al lanzarlos con la herramienta Agent. El `arquitecto` corre siempre con `fable`, para toda especificación nueva y toda revisión de diseño, sin depender del modelo de la sesión. La regla vive en `CLAUDE.md`; aquí solo se registra. Ninguno de los tres modifica código ni fichas ajenas: el `arquitecto-revisor` entrega feedback y el `arquitecto` ajusta la ficha; `seguridad` reporta y `backend` o `datos` corrigen.

**Por qué.** Una ficha grande escrita por un solo agente arrastra sus propios supuestos; la revisión independiente de la tercera pasada de M6 encontró cosas que la ficha daba por buenas (el ruido entre años normales, la lectura no atómica del agregado, cifras que solo salen sobre tiendas comunes). Lo mismo con la seguridad: quien construye no es quien mejor la audita. Fijar el modelo evita que la calidad dependa de la sesión.

**Descartado.** Que el arquitecto revise su propia ficha; que `seguridad` corrija lo que encuentre (mezclaría auditar con construir y dejaría un cambio sin segunda mirada).

## 2026-10-14 · Seguridad: primera auditoría con opus, sin bloqueantes, y correcciones en `0.9.2`

**Decisión.** Antes de abrir los módulos grandes se corrió la primera auditoría del agente `seguridad`. Informe: **cuatro hallazgos importantes (I-1 a I-4), diez menores y ninguno bloqueante**. Las correcciones de código salieron en `0.9.2 · Seguridad`: topes de tamaño en importadores (celdas de 300 caracteres, 1 000 en notas y descripciones, `413` si el cuerpo supera 6 MB) y una lectura no cúbica del importador de agrupaciones; la venta esperada de la tienda (dato de planificación) llega nula al comprador; el destino `next` del login solo acepta rutas internas; desactivar o reactivar un usuario usa `ban_duration` de Auth, con Auth antes que el perfil y rollback, porque el `signOut` anterior no hacía nada; los errores de Auth ya no se devuelven crudos; cabeceras de seguridad y `Cache-Control: no-store` en la API; escape de fórmulas al exportar CSV; y un test global que exige que todo handler de `src/app/api/**` abra con `requireUser`, `requirePlanner` o `requireAdmin`. Los permisos de la base se corrigieron con la migración `0013` (entrada siguiente). El informe completo no está en el repo, y no se transcribe aquí; el detalle de lo corregido está en `docs/CHANGELOG.md` (`0.9.2`) y en los tests. El numeral I-n de cada hallazgo solo consta en comentarios de código y en el encabezado de la `0013` (I-2 e I-3 verificados).

**Por qué.** Una auditoría antes de que entren M6, M7 y M8 cuesta poco y evita que cada módulo nuevo herede un hueco. Entre los importantes estaban los permisos abiertos de `anon` y `authenticated` bajo el RLS (I-2, corregido con la `0013`) y la venta esperada de la tienda visible para el comprador (I-3); el `signOut` de desactivar usuarios que no cerraba nada y el importador de agrupaciones con lectura cúbica fueron de la misma tanda. Las correcciones menores salieron en la misma versión.

**Descartado.** Esperar a terminar M8 para auditar; dejar los menores para después.

**Pendiente (de Javier, no de código).** Rotar la clave del administrador y activar en Supabase Auth la protección contra contraseñas filtradas. Los pendientes menores de QA están en PLAN §7.

## 2026-10-14 · Seguridad: la migración `0013` quita a `anon` y `authenticated` todo privilegio sobre `public`

**Decisión.** `0013_endurecer_permisos.sql` (aplicada en Vector2 el 2026-10-14 con la aprobación de Javier) revoca todos los privilegios de `anon` y `authenticated` sobre tablas, vistas, secuencias y funciones de `public`, y también los privilegios por defecto del rol `postgres` (lo que se cree después), reafirma el acceso total de `service_role` y deja `perfiles.rol` con valor por defecto `comprador`. Es idempotente y no contiene `DROP`, `DELETE`, `TRUNCATE` ni `UPDATE`. Verificado: cero permisos de `anon` y `authenticated` en `public`, `service_role` conserva el acceso y las cifras quedaron intactas. Desde aquí, todo objeto nuevo (tabla, vista, función, vista materializada) se cierra con `revoke` a `public`, `anon` y `authenticated` y `grant` a `service_role`. La numeración de las migraciones siguientes se corrió: M11 usó la `0014`, M6 paso 2 la `0015` y la `0016`, M6 por agrupación la `0017` y M7 queda prevista para la `0018`.

**Por qué.** Hasta entonces solo el RLS (activo y sin políticas) impedía que la clave anon, que es pública, leyera o escribiera. Una tabla nueva sin `enable row level security` (ya pasó con una tabla de prueba de conexión) o una función nueva sin `revoke` habría quedado abierta. Con los permisos quitados, un olvido del RLS deja de ser un incidente: es defensa en profundidad bajo el modelo "RLS sin políticas y datos solo con `supabaseAdmin()`". La app no cambia, porque accede solo con `service_role`.

**Descartado.** Confiar solo en el RLS; revisar tabla por tabla a mano en cada migración (se olvida); tocar los privilegios por defecto de `supabase_admin`, que gestiona la plataforma.

## 2026-10-14 · M11: el reporte de agrupación GMLE es de solo lectura, sin migración, y el nodo repartido es "mixto" (construido `0.9.4`)

**Decisión.** Javier pidió "un reporte donde aparezca agrupación GMLE detallado, para poder revisarlo, como un módulo dentro del sistema". M11 es un módulo de **solo lectura**, sin tablas, vistas ni migración propias: el reporte se deriva en memoria del árbol, del nivel de planificación (02b) y de las agrupaciones (M3), con la función pura `armarReporteAgrupacionGmle` y una sola lectura `GET /api/reportes/agrupacion-gmle` con `requirePlanner` (el comprador no lo ve ni lo lee). Un nodo `GML` cuyas equivalencias caen en dos o más agrupaciones es **`mixta`**, no "la de su genérica" ni "la mayoritaria"; la agrupación mayoritaria se muestra al lado como ayuda y **la genérica no vota** (heredó la suya por mayoría y votaría por sí misma). Seis anomalías, avisos para revisar y no errores: sin agrupación, género no incluido, genérica discrepante, nodo GML mixto, línea partida y agrupación vacía. Ubicación: Maestros, debajo de Agrupaciones de estacionalidad; tres pestañas (Resumen, Detalle, Anomalías), filtros comunes, descargas CSV (con escape de fórmulas) y Excel.

**Por qué.** Tras asignar las equivalencias a las agrupaciones y crear 117 genéricas el 2026-10-14, no había dónde ver cómo quedó cada agrupación ni cruzarla con el nivel GML o GMLE, que decide si M7 lee el nodo como una unidad con curva mezclada o cada equivalencia por separado. Que el nodo repartido sea `mixta` refleja `curvaUnidad`: el nodo no tiene una agrupación sino una curva compuesta, y eso puede ser deliberado o un descuido, que es lo que Javier quiere revisar. Sin tablas porque las reglas de vigencia y de faltante de M3 viven en TypeScript y una vista SQL las duplicaría. `requirePlanner` y no `requireUser` porque es herramienta de revisión de la planificación y el comprador no tiene uso para ella.

**Descartado.** Una vista SQL o una tabla de resumen; tomar la agrupación de la genérica como la del nodo (circular); declarar error lo que es una decisión a revisar.

## 2026-10-14 · M11: el histograma de unidades por mes y año usa una función SQL y respeta los filtros del reporte (construido `0.9.5`)

**Decisión.** Al inicio de la pestaña Resumen se añade el histograma **Unidades vendidas por mes y año** (barras agrupadas, una por año, con tabla alternativa mes × año, totales y variación contra el año anterior solo donde ambos meses existen; los meses sin datos quedan vacíos, no en cero). Lo alimenta la función `public.unidades_mensuales(p_equivalencias uuid[] default null)` (migración `0014_unidades_mensuales.sql`, `security invoker`, `search_path` vacío, ejecutable solo por `service_role`), que agrega `venta_stock_vigente`, es decir solo cargas publicadas, y se llama por `POST /api/reportes/agrupacion-gmle/unidades-mensuales` (`requirePlanner`, hasta 5 000 ids de equivalencia; `[]` responde vacío sin consultar). Sin filtros suma toda la venta publicada; con filtros, las equivalencias que pasan.

**Por qué.** Lo pidió Javier para validar la data histórica ya cargada (45 meses, de enero de 2023 a septiembre de 2026) con una mirada. La agregación completa de `venta_stock_vigente` debe hacerse en SQL (decisión de M5), y un `POST` porque la lista de ids no cabe en la URL. La suma de soles se hace en céntimos y un dato ilegible da error claro en vez de un cero falso.

**Descartado.** Calcular en el navegador con la lista plana (cientos de miles de filas); un `GET` con ids en la URL; mostrar los meses sin datos como cero.

## 2026-10-14 · M6: la curva es la participación del mes en el año sobre la red comparable de cada año, por fechas y por datos

**Decisión.** Javier confirmó el 2026-10-14 que la lógica de Vector-One sirve hasta M6: todos los años superpuestos, participación medida sobre las mismas tiendas dentro de cada año (una tienda que abrió en 2025 no cuenta para 2024 ni antes) y una curva propuesta con lógica explicable. La **red comparable** de cada año se decide por las fechas de apertura y cierre de M4 y por los datos de M5 (la venta total de la tienda en el año), con `meses_tienda_nueva = 0`: una tienda abierta a fines de 2025 entra en la red de 2026 porque estuvo abierta sus doce meses, y una tienda cuya apertura se corrigió a mitad de 2023 queda fuera de 2023 por fechas. La concentración **se hace visible, no se corrige**: el peso de cada tienda por año va siempre a la vista, hay un aviso de tienda dominante (35 %) y la candidata `E` sirve de contraste. Esto corrige la primera pasada de la ficha, que fijaba 12 meses para tienda nueva.

**Por qué.** Una red que cambia de un año a otro desforma el reparto mensual; medirla solo con las tiendas que estuvieron todo el año compara lo comparable. Las fechas solas no bastan (una tienda con fecha de apertura equivocada contaminaría la red), por eso se cruzan con la venta real. Corregir la concentración sería decidir por Javier cuánto debe pesar una tienda; mostrarla le deja decidir.

**Descartado.** `meses_tienda_nueva = 12` (dejaba fuera a una tienda que ya tenía el año completo); ponderar o recortar la tienda mayor; una red única para todos los años.

## 2026-10-14 · M6: el Niño de 2023 y 2026 afecta el año completo a invierno y de septiembre a diciembre a verano

**Decisión.** Meses confirmados por Javier el 2026-10-14: para las agrupaciones de **invierno**, el año completo (2023 y 2026, este último en curso); para las de **verano**, de **septiembre a diciembre** de 2023 y de 2026. "Marzo a mayo de 2023" queda descartado. `periodos_atipicos` gana `temporadas text[]` (migración `0015`): un periodo aplica a una agrupación si la temporada de esta está en su conjunto; `alcance` queda como dato heredado. Un año con más de `max_meses_hueco` meses atípicos se trata como atípico completo: se mide su forma y nunca se imputa. Amplía la entrada del 2026-10-13 sobre la temporada ("el Niño solo afecta a las de invierno"): ahora también adelanta el verano. El periodo de verano queda **por medir primero**: si la forma sale estable y el ratio relativo es del orden del crecimiento normal, se desactiva con una fila (confirmación C3 pendiente de Javier, con valor por defecto "mantener y medir").

**Por qué.** Javier conoce el evento y sus meses; el catálogo editable evita meses fijos en el código y permite corregirlos. La evidencia disponible no mostraba todavía un arranque claramente anticipado del verano, por eso el periodo se mide antes de darlo por bueno.

**Descartado.** Un solo `alcance` por periodo (no distingue invierno de verano); declarar atípicos solo marzo a mayo; asumir sin medir que el verano se adelanta.

## 2026-10-14 · M6: el efecto del Niño se mide en volumen y en forma por separado, y el veredicto es relativo al ruido

**Decisión.** Cumpliendo la premisa de Javier ("el Niño cambia sobre todo el volumen, no la forma"), que se mide y no se asume, el efecto de un periodo atípico se mide en dos dimensiones. **Volumen**: ratio por temporada y año sobre tiendas comunes, con ratio de control (toda temporada del mismo año) y ratio relativo (temporada ÷ control), más el crecimiento entre años normales. **Forma**: EAT de la curva del año atípico frente a la referencia, comparado con el ruido entre años normales: `forma_cambia` solo si la diferencia supera `max(umbral_forma, ruido_normal)`, con `umbral_forma` de 3 puntos como piso. La recomendación sigue el mismo criterio: gana el promedio simple (`A`) salvo que otra candidata lo mejore en más de `max(0,05; 0,25 × ruido_normal)`, y el ruido se muestra siempre junto al EAT. Un año con todos sus meses atípicos no se imputa. El **factor de volumen para M7 es por temporada, calculado por M6 y editable en M7** (cierra la pregunta 14 de la ficha de M6; el valor editado vive en M7). Pendiente de confirmación de Javier (C1), construido como parámetros: `umbral_forma` y `margen_ruido`.

**Por qué.** Con dos años normales que difieren entre sí por decenas de puntos, un umbral fijo de 3 puntos declararía "la forma cambia" para todo, y un `argmin` sin margen con dos pliegues de backtesting elegiría ruido. Medir el volumen sobre tiendas comunes es lo que reproduce las cifras que Javier calculó a mano; en crudo, con todas las tiendas, no salen.

**Descartado.** Umbral fijo de 3 puntos; etiqueta de sustitución de temporada y `umbral_sustitucion` (de la segunda pasada); `argmin` sin margen; un factor por agrupación en lugar de por temporada (las agrupaciones pequeñas no dan base estable).

## 2026-10-14 · M6: agrupaciones con pocos años o pocos datos usan la curva de su temporada

**Decisión.** Un año con menos de 120 unidades en la agrupación (`escaso`) no entra en el ajuste; si quedan menos de dos años útiles, la agrupación toma la **curva de su temporada** (candidata `T`, prestada), que sustituye a la antigua candidata por género. El año en curso nunca ajusta una curva: solo valida de forma parcial. Aviso `cambio_volumen_extremo` en saltos de volumen anormales. Confirmación pendiente de Javier (C2), construida con valor por defecto: parámetros `min_unidades_ano` y `umbral_cambio_volumen`.

**Por qué.** Hay agrupaciones con años de pocos cientos de unidades y meses en cero, cuya curva propia sería ruido. Prestar la de la temporada es más honesto que inventar una forma, y la agrupación queda marcada como prestada. El cambio de la candidata por género a la de temporada fue propuesta del `arquitecto-revisor` en la tercera pasada: la temporada es lo que decide qué meses afecta el Niño.

**Descartado.** Calcular igual con años de pocas unidades; prestar la curva del género; excluir la agrupación del cálculo.

## 2026-10-14 · M6: el modelo propone y el planner aprueba una curva por agrupación; no hay aprobación en bloque

**Decisión.** Javier, 2026-10-14: no hay aprobación en bloque. Cada curva se aprueba desde el detalle de su agrupación, después de ver todos los años, la tabla de candidatas y el efecto del Niño, y queda versionada con quién y cuándo. El hito de M6 es "las 15 agrupaciones aprobadas una por una". Retira de la ficha el botón "aprobar recomendadas en bloque" de la segunda pasada.

**Por qué.** Una curva decide cuánto se planifica de una agrupación entera; aprobarla sin mirarla traslada el riesgo a la compra. Con 15 agrupaciones el costo de revisar una por una es asumible.

**Descartado.** Aprobación en bloque de las recomendadas, incluso con "revisar después".

## 2026-10-14 · M6: las curvas son un artefacto vivo, con versión y obsolescencia por motivo

**Decisión.** Requisito de Javier el 2026-10-14: "las curvas no quedan escritas en piedra; una tienda nueva puede modificarlas". Cada curva se versiona y guarda las huellas de la composición de la agrupación, de la red de tiendas y de las cargas con que se calculó. Cuando algo cambia (una tienda entra o sale de la red, cambia la composición, hay una carga nueva, cambia un periodo atípico o la temporada), la pantalla marca la curva como **obsoleta con el motivo nombrado** y ofrece recalcular; el detalle compara la curva vigente con la propuesta antes de aprobar. M7 guarda la versión de curva que usó y avisa "la curva cambió" sin tocar los totales anuales ya decididos, solo su reparto mensual. Hay además un calendario de revisión natural: el cierre de cada año y el primer año completo de una tienda nueva.

**Por qué.** Una curva calculada una vez y olvidada deja de describir la red en cuanto abre o cierra una tienda. Invalidarla en silencio sería peor que dejarla: nadie sabría por qué cambió una proyección. Con huellas, la obsolescencia es un hecho verificable.

**Descartado.** Invalidar curvas solas; recalcular y reemplazar automáticamente; curvas fijas por año.

## 2026-10-14 · M6: lectura atómica del agregado y corrida de referencia (construidas en `0.9.6`, sustituidas al día siguiente)

**Decisión.** Para el paso 2 se decidió leer el agregado de venta con una función `jsonb` (`0016`) que refresca la vista materializada de la `0015` y devuelve la agrupación × tienda × mes bajo un candado de aviso (`409 calculo_en_curso`), sin paginar la vista, y marcar una corrida como **corrida de referencia** (`referencia` en `corridas_estacionalidad`), de donde salían la pestaña Años Niño, `/anios` y el factor de volumen para M7. Se construyó y desplegó en `0.9.6 · M6` el 2026-10-15, a pedido de Javier para probarlo en navegador con Cowork mientras QA terminaba su revisión independiente.

**Por qué.** Paginar la vista materializada eran 86 páginas, no era atómico y un refresco concurrente podía bloquearla; un `setof` se corta en 1 000 filas. La corrida de referencia daba una fuente única para M7.

**Descartado.** Paginar con `leerTodo`; leer la vista fuera de `calcular`.

**Estado (2026-10-15).** Esta entrada queda **sustituida** por el flujo por agrupación de la `0.9.7`; ver "M6: la lectura atómica del agregado y la corrida de referencia quedan sustituidas por el flujo por agrupación".

## 2026-10-14 · M7 vuelve a borrador: de M7 en adelante se diseña casi desde cero

**Decisión.** Javier: "hasta M6 sirvió Vector-One; de M7 en adelante hay que diseñar casi desde cero". El borrador del 2026-10-13 (escenarios con ventana base móvil, crecimiento por unidad y factor de tiendas, inspirado en Vector-One) deja de regir. De él se conservan solo las respuestas del dueño y los contratos que M6, 02b y M5 ya ofrecen. El rediseño se especifica el 2026-10-15 (ver las entradas M7 de esa fecha).

**Por qué.** Las reglas de proyección de Vector-One no reflejan cómo planifica hoy Javier (unidades anuales por línea, mismas tiendas por año, aperturas aparte); heredar su lógica habría obligado a deshacerla.

**Descartado.** Ajustar el borrador antiguo con parches.

## 2026-10-15 · M6: la unidad de trabajo es una agrupación de estacionalidad

**Decisión.** Javier, tras probar la `0.9.6`: "se tiene que trabajar agrupación de estacionalidad una por una" y "tener una vista de la curva que definimos aprobada y las de los últimos años, así como la que genera el sistema en automático". La pantalla lista las agrupaciones con su estado y se trabaja una a la vez: en el mismo gráfico y la misma tabla, la curva aprobada vigente, la de cada año y la propuesta del sistema, con la diferencia mes a mes. Especificado en `docs/modulos/06b-curvas-trabajo-por-agrupacion.md` (revisado por el `arquitecto-revisor` el mismo día); migración `0017` ya aplicada y versión `0.9.7 · M6` **en construcción, no desplegada**. La lógica estadística de la ficha 06 se conserva tal cual.

**Por qué.** La `0.9.6` construyó el motor completo y lo expuso con una corrida global; Javier describió otra manera de trabajar, la de revisar una agrupación a la vez con todo a la vista. Reordenar la pantalla alrededor de eso reutiliza casi todo lo construido.

**Descartado.** La corrida global con tabla de propuestas (construida en `0.9.6` y sustituida).

## 2026-10-15 · M6: el cálculo es a demanda y no se guarda; se guarda la foto de cada aprobación

**Decisión.** Un cálculo es la ejecución determinista del modelo sobre **una** agrupación; dura milisegundos y no se guarda. Lo que se guarda es la **foto de aprobación**: una fila de `corridas_estacionalidad` con `agrupacion_estacionalidad_id` (columna nueva de la `0017`; nula = corrida global heredada de `0.9.6`), con los parámetros, el resultado de esa agrupación, la red comparable y el resumen con las huellas; la curva vigente apunta a ella, de modo que el contrato con M7 no cambia. La lectura de venta pasa a una función `jsonb` filtrada, `venta_estacionalidad_agrupacion(p_agrupacion_id)`, que sustituye a la vista materializada y al candado (medida de 0,6 a 1,5 s).

**Por qué.** Calcular es barato y reproducible; guardar cada cálculo visto llenaría la base de resultados que nadie aprobó. La foto da la trazabilidad que importa: con qué datos y parámetros se aprobó cada versión.

**Descartado.** Guardar cada cálculo visto; una tabla nueva de fotos; seguir refrescando la vista materializada.

## 2026-10-15 · M6: antes de calcular se comprueban los prerrequisitos de la agrupación y se bloquea con motivo

**Decisión.** Una agrupación no se calcula si falta lo imprescindible: sin periodos atípicos para su temporada (invierno o verano), tienda con venta y sin fecha de apertura, ningún año completo, sin venta o sin equivalencias. El planner puede levantar el primero con la casilla "Confirmo que esta temporada no tiene años atípicos", que queda en la foto. Una agrupación de toda temporada solo avisa ("sigue en Toda temporada") hasta su primera aprobación. La pantalla muestra el motivo con el enlace para arreglarlo.

**Por qué.** La `0.9.6` permitió calcular con el catálogo de periodos vacío, sin que nada lo señalara. Bloquear con motivo convierte un descuido silencioso en una acción visible; la casilla evita frenar a quien sabe que esa temporada no tuvo Niño.

**Descartado.** Calcular siempre y solo avisar; bloquear también a toda temporada.

## 2026-10-15 · M6: la aprobación lleva la huella del cálculo que el planner vio

**Decisión.** `PUT /api/curvas/agrupaciones/[id]` envía la huella del cálculo (`huella_calculo`), la versión vigente que el planner vio (`version_vigente`) y los parámetros con `hasta_periodo` explícito. El servidor recalcula y rechaza con `409 datos_cambiados` si la entrada ya no es la misma y con `409 vigente_cambiada` si otro usuario aprobó o retiró mientras tanto; con la misma candidata y la misma huella que la vigente responde `409 sin_cambio`.

**Por qué.** Entre abrir una agrupación y aprobarla pueden pasar minutos en los que se carga un mes o se mueve una tienda; aprobar una curva que ya no corresponde a los datos es justo el error que las curvas vivas quieren evitar. Con dos usuarios la huella y la versión vigente evitan pisarse.

**Descartado.** Aprobar por `corrida_id` (apunta a un cálculo que ya no se guarda).

## 2026-10-15 · M6: el estado de la lista se deriva de las huellas, sin corrida de referencia

**Decisión.** El estado de cada agrupación sale de la curva vigente y las huellas, sin leer una corrida: `sin_curva`, `al_dia`, `al_dia_distinta` (se aprobó una candidata distinta de la recomendada) y `obsoleta` (con motivo), más `inactiva_con_curva`. Como el modelo es determinista, si nada de lo que cubre la huella cambió, la propuesta de hoy es la de la foto; si algo cambió, la curva es obsoleta por definición. **"Comparar con el sistema"** calcula a demanda la propuesta de hoy y muestra la diferencia sin escribir nada. Avisos que no cambian el estado: `datos_posteriores` (un mes publicado después del `hasta` de la curva) y `modelo_anterior` (la foto se hizo con otra versión del modelo).

**Por qué.** No hace falta una corrida global ni guardar propuestas para saber si una curva sigue vigente. Separar "obsoleta" de "hay datos posteriores" evita marcar obsoleta una curva que el planner decidió detener en un mes.

**Descartado.** Una corrida de referencia; recalcular automáticamente al cambiar los datos.

## 2026-10-15 · M6: el factor de volumen del Niño para M7 se calcula a demanda por temporada

**Decisión.** El factor por temporada se calcula a demanda con la misma función SQL sin agrupación (`GET /api/periodos-atipicos/anios?temporada=&con_volumen=1`, y la pestaña Años Niño); M7 guarda el valor que usó, editable allí. `corridas_estacionalidad.referencia` y la vista materializada quedan **sin uso desde `0.9.7`**, documentadas con `comment on` y nunca borradas.

**Por qué.** Sin corrida de referencia, el factor deja de depender de qué corrida marcó alguien y se calcula siempre sobre los datos de hoy. Las migraciones no admiten `DROP`, así que lo que no se usa se documenta.

**Descartado.** Borrar objetos en una migración; mantener la corrida de referencia solo para el factor.

## 2026-10-15 · M6: los parámetros son por agrupación, y los de la última aprobación son el punto de partida

**Decisión.** Los parámetros del cálculo pertenecen a la agrupación, incluidos dos nuevos: `anios_excluidos` (el año queda descartado con motivo `excluido_manual`, fuera del ajuste, y sigue contando para el volumen) y `tiendas_excluidas` (la tienda sale de la red de todos los años con motivo `excluida_manual`; es parámetro, no maestro). Al reabrir una agrupación se parte de los parámetros de su última aprobación, con "Restablecer" a la vista, para que comparar con la vigente sea honesto. La primera entrega del panel edita años, tratamiento del Niño, tiendas y "Calcular hasta".

**Por qué.** Lo que es sensato para una agrupación de invierno no lo es para una de toda temporada, y una tienda que distorsiona una curva puede ser normal en otra.

**Descartado.** Parámetros globales; excluir tiendas como dato del maestro de M4.

## 2026-10-15 · M6: los hallazgos de QA de la `0.9.6` son requisitos del rediseño

**Decisión.** Siete hallazgos del informe de QA (sin bloqueantes) pasan a requisitos de la `0.9.7`: todos los años con red se dibujan (cada serie usa `participacion_real ?? participacion`; los años descartados o excluidos van en gris, los imputados punteados, el en curso discontinuo, y un año desaparece solo si no tiene red o volumen, y entonces la tabla lo lista con su motivo); el ruido entre años normales se calcula a nivel de agrupación y se muestra siempre junto al EAT; `carga_nueva` solo mira los meses hasta el `hasta` de la curva y reaprobar la limpia; una sola definición de "sin venta"; la agrupación abierta va en la URL (`?agrupacion=<id>`); las cifras de texto del servidor y de la pantalla usan el mismo formateador `es-PE`; y la lista lee solo `parametros`, `red_comparable` y `resumen` de las fotos.

**Por qué.** Eran incoherencias reales (un año descartado desaparecía del gráfico; recalcular y aprobar no limpiaba una curva obsoleta por un mes posterior; la coma decimal del servidor y el punto de la pantalla) y el rediseño ya reabría esos módulos.

**Descartado.** Un parche aparte sobre la `0.9.6`.

## 2026-10-15 · M6: la huella cubre también a las otras agrupaciones de la temporada y la versión del modelo

**Decisión.** Javier aceptó el informe del `arquitecto-revisor`. La huella de temporada (`huella_temporada`: tríos id, temporada y composición de las agrupaciones activas de la temporada y de toda temporada) y la constante `VERSION_MODELO` entran en la huella de cálculo y en la foto. Una curva **prestada** (`T`) se marca obsoleta (`temporada_recompuesta`) cuando cambia la composición o la temporada de cualquiera de las otras agrupaciones de su temporada; una curva propia solo recibe un aviso. Una foto con un modelo anterior avisa (`modelo_anterior`), no es obsoleta.

**Por qué.** La curva `T` y el control de toda temporada salen de las otras agrupaciones: sin esto, mover una equivalencia entre dos agrupaciones cambiaba curvas ajenas sin dejar rastro. Subir de versión el modelo sin rastro en las fotos haría que "al día" mintiera.

**Descartado.** Dejar `T` fuera de la obsolescencia; subir el modelo sin marcarlo en las fotos.

## 2026-10-15 · M6: `hasta_periodo` nunca se hereda y la nota se exige en tres casos

**Decisión.** Cada apertura de una agrupación arranca con `hasta_periodo` en el último mes publicado y terminado en Lima; nunca se hereda de la aprobación anterior (la cabecera dice "la vigente usó datos hasta X"). El `PUT` lleva el `hasta` explícito y la foto guarda `hasta_fue_por_defecto`: si es falso, los meses posteriores son siempre aviso `datos_posteriores`. La **nota** (un solo campo "Nota / motivo") es obligatoria (`409 nota_requerida`) al aprobar una candidata distinta de la recomendada, al excluir años o tiendas a mano y con tratamiento del Niño distinto de `auto`.

**Por qué.** Heredar el `hasta` dejaría curvas detenidas en un mes viejo sin que nadie lo notara. La nota convierte una desviación de lo que el sistema propone en un motivo escrito que se ve en la lista y en Versiones.

**Descartado.** Heredar el `hasta`; nota opcional.

## 2026-10-15 · M6: la lectura de venta se cachea en memoria por huella y la foto se basta sin `resultado`

**Decisión.** La salida de `venta_estacionalidad_agrupacion(id)` (que devuelve también `cargas`, para que la huella y los datos salgan del mismo estado) se guarda en memoria del proceso con clave de tres huellas (cargas, composición, temporada), 120 s de vida y a lo sumo 20 entradas, de modo que mover un parámetro tarda milisegundos. La lista y la obsolescencia leen solo `parametros`, `red_comparable` y `resumen` de la foto; `resultado` se lee únicamente en "Ver foto". La caché nunca devuelve un estado distinto del que su huella describe.

**Por qué.** Cada recálculo al mover un parámetro no debería repetir la lectura de venta; y la lista nunca debe deserializar 40 KB por fila.

**Descartado.** Recalcular en el navegador (habría que enviar la venta y llevar el modelo en el bundle); leer `resultado` en la lista.

## 2026-10-15 · M6: el alcance de la `0.9.7` se recorta

**Decisión.** Javier, para recortar alcance: el botón en bloque "Comparar las obsoletas con el sistema", la temporada editable en línea en la lista y la edición en pantalla de los umbrales avanzados pasan a una **segunda entrega**; el esquema, la foto y el modelo ya los aceptan. "Comparar con el sistema" queda por fila.

**Por qué.** Eran comodidades, no requisitos del flujo por agrupación, y retrasaban el momento en que Javier puede aprobar curvas.

**Descartado.** Entregarlo todo en una versión.

## 2026-10-15 · M6: la lectura atómica del agregado y la corrida de referencia quedan sustituidas por el flujo por agrupación

**Decisión.** La `0.9.7` sustituye dos decisiones del 2026-10-14: "M6: lectura atómica del agregado y corrida de referencia (construidas en `0.9.6`)", y con ella la lectura con candado `409 calculo_en_curso` y la marca `referencia`. Sin corrida global no hay nada que refrescar ni que marcar: la lectura es una función filtrada y la foto es la de cada aprobación. Se retiran `POST /api/curvas/calcular`, `GET /api/curvas/corridas`, `GET` y `PATCH /api/curvas/corridas/[id]` y los componentes de la tarjeta Calcular y del selector de corridas; nada se borra de la base (la vista materializada, sus funciones de refresco y `referencia` quedan sin uso). Numeración: `0017` para esta entrega; M7 queda prevista para la `0018` y pasaría a la `0019` si M6 usara la `0018` para una variante de la función sobre la vista materializada (solo si la medición lo exigiera).

**Por qué.** El candado y la referencia resolvían problemas de la corrida global; al desaparecer esta, mantenerlos sería código sin dueño.

**Descartado.** Conservar las dos piezas "por si acaso" (el mismo criterio con el que se descartaron `tallas` y `equivalencia_marca`).

## 2026-10-15 · M7: se rediseña como proyección de unidades anuales del año en curso y del siguiente, por GML × agrupación de marca (en revisión, sin construir)

**Decisión.** Javier el 2026-10-14 y 15: el objetivo es el **año en curso y el año siguiente completos, en unidades anuales, sin horizonte móvil de meses**, y el volumen se decide por **GML × agrupación de marca** (en un nodo abierto a GMLE, por equivalencia × agrupación de marca). Marcas relevantes, "otras" y marcas al barrer son desglose dentro de la fila, no el nivel de decisión; la fila incluye toda la venta de su GML y agrupación de marca, de modo que cuadra con la venta real. Nada se aprueba en bloque y la proyección cerrada (una sola por año) es el único insumo de volumen de M8. Especificada en `docs/modulos/07-proyeccion-anual.md`; **en revisión por el `arquitecto-revisor`, sin construir y pendiente de aprobación**: migración prevista `0018` y versión `0.10.0 · M7`, después de `0.9.7 · M6`. Seis decisiones quedan por confirmar con Javier (sección 14 de la ficha), con valor recomendado.

**Por qué.** Es como planifica Javier: por línea, en unidades, con el cierre del año en curso y el año siguiente. Una ventana de meses móvil mezcla dos años en una cifra que nadie decide. El desglose por marca importa, pero decidir marca por marca multiplicaría las decisiones sin cambiar el volumen que se compra por agrupación.

**Descartado.** Escenarios con ventana base móvil, crecimiento por unidad y factor de tiendas (borrador del 2026-10-13); horizonte de dieciocho meses; filas por `claveFlujo` × talla como nivel de decisión.

## 2026-10-15 · M7: "mismas tiendas" se define por año proyectado, con aperturas y cierres en bloques aparte

**Decisión.** Para proyectar el año `Y`, las **mismas tiendas** son las abiertas los doce meses de `Y−1`, con la lógica de red comparable de M6 por fechas de apertura y cierre. Una tienda abierta en noviembre de `Y−1` va aparte como tienda nueva en `Y` y **ya entra** en mismas tiendas en `Y+1`, porque estuvo abierta todo `Y`; una que abre a mitad de `Y` se ve separada en `Y+1` y entra recién en `Y+2`. Las **tiendas nuevas** y los **cierres** son bloques aparte, distintos para `Y` y para `Y+1`; el CD, las desactivadas y las sin apertura quedan fuera. El conjunto cambia con el año y la matriz muestra su composición con un desplegable de las tiendas de cada bloque. Una tienda abierta en el año en curso tiene venta real parcial más la proyección del resto. Cierre como bloque aparte (y no una fracción restada dentro de las mismas tiendas) es la recomendación a confirmar por Javier.

**Por qué.** Es la definición del propio Javier y es la misma lógica de comparabilidad de M6, así que una tienda nueva no infla el crecimiento de un año que no vivió completo. Separar los bloques hace legible qué parte del total viene de la red madura y cuál de aperturas.

**Descartado.** Una base única para los dos años; un factor de red por unidad (borrador del 2026-10-13).

## 2026-10-15 · M7: el cierre del año en curso es vendido ÷ avance de la curva, y el año siguiente es la base normalizada por el crecimiento del planner

**Decisión.** **Cierre por avance de curva.** Javier: para proyectar el resto del año hay que calcular el avance de las ventas entre el avance de la estacionalidad de la línea. Total propuesto = unidades vendidas del año en curso (mismas tiendas) ÷ acumulado de la curva de la agrupación hasta el último mes cerrado; el resto se reparte por los meses con la curva. Con el año Niño normalizado por el factor de volumen de la temporada (de M6, editable): en invierno, con el año completo atípico, el factor se cancela; en verano afecta de septiembre a diciembre. Con avance de curva menor de 0,30 se calcula igual con aviso. **Año siguiente.** La base es el cierre vigente del año en curso de las mismas tiendas del año siguiente, normalizado por el factor del Niño, por el **crecimiento de unidades que escribe el planner**, repartido con la curva (la recomendación a confirmar es el cierre vigente y no los últimos doce meses reales, para que una decisión del año en curso arrastre al siguiente y no haya dos bases).

**Por qué.** Es el método que Javier describió. El avance de la curva traslada a unidades lo que ya se vendió y respeta la estacionalidad de la línea; la normalización evita que un año Niño sobreestime o subestime el total.

**Descartado.** Últimos doce meses como base; tendencia aplicada sola; crecimiento automático sin intervención del planner.

## 2026-10-15 · M7: las tiendas nuevas se proyectan por venta esperada y por la composición de una tienda de referencia

**Decisión.** Javier: el volumen de una tienda nueva se define por su venta esperada (`tiendas.venta_esperada_promedio`, de M4) y **cada tienda puede tener una tienda de referencia**, aquella a cuya composición de venta (mezcla por GML, agrupación de marca y género) debe parecerse; una tienda nueva no debe heredar la composición promedio de la red cuando hay una que se le parece más (por ejemplo, una tienda muy cargada hacia un género). Sin referente, la composición de las mismas tiendas. Columna nueva `tiendas.tienda_referencia_id` en M4 (`on delete set null`, distinta de la propia tienda, sin cadenas: la composición sale siempre de los hechos propios del referente), con `Select` en la edición de la tienda y columna `TIENDA_REFERENCIA` opcional en el importador. Con una rampa de maduración editable (por defecto 70, 85 y 100 %, a confirmar) y la curva de M6.

**Por qué.** La composición de una tienda nueva cambia qué línea y qué agrupación de marca le toca vender; el promedio de la red esconde esa diferencia. La columna es un atributo de la tienda con un solo valor.

**Descartado.** Composición promedio de la red por defecto cuando hay referente; una tabla aparte de referentes.

## 2026-10-15 · M7: tres partes (por línea, matriz, mensual de solo lectura), decisión fila a fila y Excel en el navegador

**Decisión.** La pantalla tiene tres partes. **Parte 1, análisis por línea**: filtro de género, mundo y línea; gráfico y tabla del histórico de unidades por año; propuesta con su explicación; decisión del planner por fila y año (Aceptar o cifra manual con nota, que sobrevive a cualquier recálculo). **Parte 2, matriz**: una fila por género · mundo · línea con venta a la fecha, mismas tiendas, tiendas nuevas y año siguiente, totales por mundo, género y compañía y composición de cada bloque de tiendas; con filtros y **exportación a Excel** que respeta los filtros, generada en el navegador con SheetJS cargado bajo demanda (patrón de M11), solo para admin y planner. **Parte 3, vista mensual**, solo lectura: meses reales y proyectados distinguidos, los mismos filtros y exportación a Excel, sin edición; es **el contrato de datos de M8**, por género · mundo · línea · agrupación de marca · mes, con bloque de tiendas y origen del dato. Nada se aprueba en bloque; la cola larga (propuestas menores de 24 unidades al año, umbral editable) se cierra con la propuesta, a confirmar por Javier. Toda la API de M7, lecturas incluidas, es `requirePlanner`.

**Por qué.** El planner trabaja una línea a la vez y luego mira la matriz para ver el total; la mensual existe para que M8 no tenga que repartir nada. Excel en el navegador porque el navegador ya tiene la lista y los filtros.

**Descartado.** Rutas de descarga en el servidor; que M8 reparta el total anual; aceptar propuestas en bloque; edición en la vista mensual.

## 2026-10-15 · M7: los patrones mensuales son siempre las curvas de M6, versionadas, y el factor del Niño vive fuera de la proyección

**Decisión.** M7 nunca calcula ni guarda una curva propia: aplica la vigente de M6, o la mezcla `curvaUnidad` de un GML (pesos por unidades de cada equivalencia), también en tiendas nuevas (multiplicada por la rampa) y cierres (por la fracción abierta). Cada registro guarda la versión con que se repartió; si después se aprueba otra, M7 avisa "la curva cambió" y ofrece recalcular el reparto con su impacto, **sin cambiar un total ya decidido**. El factor del Niño por temporada lo calcula M6 a demanda y M7 lo guarda en `factores_volumen_atipico` (calculado y editable, único por año y temporada), fuera de la proyección: es un hecho sobre el histórico, no un supuesto de un escenario; cada proyección guarda los factores que aplicó. Cierra la pregunta 14 de la ficha de M6. La venta se lee con una función `jsonb` (`venta_proyeccion`) en tandas de nodos, sin vista materializada, porque M6 abandonó la suya por el refresco y el candado.

**Por qué.** Dos fuentes de curva darían dos respuestas sobre la misma estacionalidad. Separar el total (decisión de Javier) del reparto (curva) permite que una curva nueva mueva los meses sin deshacer lo decidido.

**Descartado.** Curvas propias de M7; una vista materializada de flujo; leer cientos de miles de filas con `leerTodo`.

## 2026-10-16 · El `arquitecto` pasa de `fable` a `opus`

**Decisión.** Javier cambia el modelo del agente `arquitecto`: ya no corre con `fable`, corre siempre con `opus` (fijado en `model` de `.claude/agents/arquitecto.md` y pasado además `model: "opus"` al lanzarlo con la herramienta Agent). La regla vive en `CLAUDE.md`. Las fichas ya escritas con `fable` no se reescriben.

**Consecuencia a tener presente.** `arquitecto`, `arquitecto-revisor` y `seguridad` corren ahora con el mismo modelo; la independencia del revisor viene de que no escribió la ficha y de que contrasta con la base real en solo lectura, no de otro modelo.

**Descartado.** Mantener `fable` solo para fichas grandes: Javier prefirió un solo modelo para el arquitecto.

## 2026-10-16 · La auditoría de `seguridad` pasa de `opus` a `sonnet`

**Decisión.** Javier cambia el modelo del agente `seguridad`: corre siempre con `sonnet` (fijado en `model` de `.claude/agents/seguridad.md` y pasado además `model: "sonnet"` al lanzarlo con la herramienta Agent). La regla vive en `CLAUDE.md`. Sigue siendo de solo lectura: reporta y `backend` o `datos` corrigen. Una auditoría lanzada antes de este cambio con `opus` se deja terminar.

**Consecuencia a tener presente.** `arquitecto` y `arquitecto-revisor` quedan con `opus` y `seguridad` con `sonnet`; si una auditoría de un módulo grande o de auth parece superficial, se puede pedir una segunda pasada con `opus` solo para ese caso.

**Descartado.** Mantener `opus` para toda auditoría.


## 2026-10-16 · M7 (07b): la apertura se decide también desde Por línea, «solo se mueve lo modificado» y marcas con 3 + Otras

**Decisión.** Javier decide cinco cosas sobre la mejora `0.10.7 · M7` (ficha `docs/modulos/07b-apertura-en-la-linea.md`):

1. **La apertura es editable desde el detalle de la línea.** La tabla de Por línea muestra, después de las filas base, una sección por tienda nueva y año con una fila por agrupación de marca, con el mismo campo y ✓ que las demás. Aceptar con ✓ en una fila de tienda **la fija** (`origen = manual`), de modo que sobrevive a Recalcular.
2. **«Solo se mueve lo modificado».** Al fijar una fila de una tienda con total decidido `D`, el total de la tienda pasa a `D' = max(D + Δ, Σ fijadas)` y las demás filas no se tocan; sin `D`, solo se fija la fila. Es el único comportamiento: no hay pregunta ni modal. Lo mismo vale al fijar una fila desde la tarjeta de Tiendas nuevas, que además muestra la suma de filas, las filas fijadas y el botón «Usar la suma de filas».
3. **Marcas: las 3 de más peso más «Otras», con su % real.** El gráfico y el reparto de la apertura suman 100 % sin reescalar. Es solo dato: no se decide ni se guarda por marca.
4. **Orden de las agrupaciones de marca: PREMIUM → ULTRA LOW**, el de `agrupaciones_marca.orden` del catálogo, en la tabla, las secciones de apertura y el gráfico de marcas.
5. **El gráfico anual incluye a las tiendas nuevas** (aperturas y nuevas del año anterior): la barra, el «Total línea» del pie de la tabla y la columna de aperturas de la Matriz dan la misma cifra.

**Por qué.** El planner trabaja una línea a la vez y la apertura era una frase que solo se movía entre ~400 filas de la tienda. Preguntar «mantener o subir el total» en cada edición era fricción: lo que el planner modifica es lo que cambia, y lo demás queda como estaba (el costo es que el total de la tienda deja de ser una cifra «redonda» si se edita por filas; por eso la tarjeta muestra la suma de filas y ofrece usarla). Con 3 marcas más «Otras» el reparto es lo que realmente vendió la agrupación; reescalar solo las 3 inventaría una tienda que vende únicamente esas marcas.

**Descartado.** Preguntar cada vez «mantener el total / subir el total» (la ficha original del arquitecto, con `ajuste_tienda`, `Modal` y `409 excede_total_tienda`); mantener el total de la tienda y absorber el cambio en las demás filas; mostrar solo las 3 marcas reescaladas a 100 %; una migración para guardar la composición por marca de las filas de tienda (`participaciones.por_marca` de la fila base ya la trae).

**Consecuencia a tener presente.** El total movido es una decisión explícita del planner (lleva quién, cuándo y «ajustado desde la línea G · M · L»), y nunca queda por debajo de lo fijado a mano. La medición de bytes y tiempo de `/lineas` frente a `0.10.6` no se hizo.

## 2026-10-16 · M7 (07c): el crecimiento del año siguiente es bruto y todas las filas de un género × mundo crecen igual (construido 2026-10-17, `0.10.8`)

**Decisión.** El % que escribe el planner para el año siguiente es la **variación bruta** `Y+1 ÷ Y` de las mismas tiendas de `Y+1`: incluye la tienda que abrió a fines de `Y−1`, excluye las que cierran en `Y+1` y no corrige por el Niño. Vale en la celda del género × mundo, en el Resto y en la fila. La propuesta es `P = round(B × (1 + g))`, donde `B` es la base de las mismas tiendas, y el factor del Niño del año siguiente solo da forma al reparto mensual, no mueve el total. Dentro de un género × mundo todas las filas crecen el mismo %. Precedencia: fila fijada a mano, luego la celda del GM, luego el Resto.

**Por qué.** Javier lo pidió así («variación bruta 2027 ÷ 2026»). Con el 20 % aplicado sobre la base normalizada por el Niño, la pantalla mostraba +25 %: el planner escribía un número y veía otro. Repartir el rebote del Niño dentro de cada GM habría inventado diferencias entre filas que nadie decidió.

**Descartado.** Aplicar el % sobre la base normalizada (ajusta la decisión del 2026-10-15 de que el año siguiente es la base normalizada por el crecimiento: la normalización se mantiene en el cierre del año en curso y queda como referencia en el siguiente); repartir el rebote del Niño entre las filas.

## 2026-10-16 · M7 (07c): la matriz tiene solo Hombre, Mujer y el Resto, se llena entera, y guardar siempre recalcula (construido 2026-10-17, `0.10.8`)

**Decisión.** La matriz de crecimientos tiene los mundos como filas y, como columnas, HOMBRE, MUJER y el **Resto** (el crecimiento objetivo de todo lo demás, que es `crecimiento_pct_defecto`). Todas las celdas son obligatorias. «Calcular promedio» (en el navegador) pondera lo escrito por las unidades base, lo compara con un objetivo global opcional y muestra el puente hasta el Total. Hay un único botón «Guardar y recalcular»: el recálculo se encadena en el servidor con el candado tomado. `crecimientos_cambiados` y `version_metodo` no se pueden forzar al cerrar. `VERSION_METODO` pasa a 4.

**Por qué.** Javier dijo «yo tengo que llenar todos los cuadrados» y pidió un ponderado de lo que escribe, no una sugerencia por celda. Un «Guardar» suelto dejaba filas con `meses` y `propuesto` viejos (hallazgo bloqueante de la revisión).

**Descartado.** Sugerencia de % por celda con «Usar»; guardar sin recalcular; permitir cerrar con `crecimientos_cambiados`.

**Consecuencia.** El Modal «Pisar / Conservar / Cancelar» de esta versión (con `huella_choque`) lo retira la entrada siguiente de 06d: el crecimiento deja de escribirse dentro de la proyección.

## 2026-10-27 · M6 (06d): el crecimiento por género × mundo es global y versionado; se aprueba en M6 y M7 lo lee (construido `0.12.1`)

**Decisión.** El crecimiento bruto del año siguiente por género × mundo (GM) y el Resto es un **supuesto global y versionado por año**, con nota, quién y cuándo, igual que las curvas. Se analiza y se aprueba en una pestaña nueva de Curvas de estacionalidad («Crecimiento por género × mundo», migración `0027`), y **todas las proyecciones lo leen**. Reemplaza la matriz por proyección de 07c: la pestaña Crecimientos de la proyección queda de solo lectura (con enlace «Analizar y aprobar») y `PUT …/crecimientos` responde `410`. Solo se aprueban **HOMBRE y MUJER** por mundo más el **Resto**; los demás géneros con venta se analizan y se ven, pero siguen al Resto. M7 aplica: fila fijada a mano, luego GM aprobado, luego Resto aprobado, luego `crecimiento_pct_defecto` (Resto provisional). Aprobar una versión nueva deja las proyecciones con «crecimientos cambiados» (hay que recalcular; no se fuerza) y una proyección cerrada no cambia.

**Por qué.** Javier no quiere reescribir el crecimiento dentro de cada proyección: quiere mirar la curva de venta de cada GM de las mismas tiendas y decidir una sola vez. Con un supuesto global hay una sola respuesta a «¿cuánto crece Hombre Urbano?», con su historia y su autor.

**Descartado.** Seguir con la matriz por proyección (cada proyección con su propia respuesta); aprobar también los demás géneros (decisión de Javier: solo HOMBRE, MUJER y el Resto); dejar la pestaña de la proyección editable.

## 2026-10-27 · M6 (06d): `proyeccion_crecimientos` es la foto de lo aplicado y el cierre exige crecimientos aprobados, sin excepción

**Decisión.** `proyeccion_crecimientos` no se borra pero pasa a ser la **foto de lo aplicado**: cada cálculo la reescribe con los crecimientos por GM que usó (con `crecimiento_id` y `version` de la versión global), y el Resto usado va en `parametros.crecimiento_resto_usado`. B2 (recalcular el año siguiente al decidir), las explicaciones, las lecturas y las cerradas leen la foto; solo el cálculo lee el supuesto global. **Cerrar bloquea sin excepción** con el motivo `crecimientos_sin_aprobar` (falta HOMBRE o MUJER con filas base, o el Resto está provisional): no se puede forzar con `?forzar=1`. Una proyección cerrada no cambia al aprobar una versión nueva.

**Por qué.** Una cerrada es lo que M8 lee: debe poder explicarse sin depender de lo que se apruebe después. Leer de la foto garantiza que lo que se ve es lo que se aplicó. Javier decidió que cerrar sin aprobar esos crecimientos no se permite ni forzando, porque el año siguiente de una cerrada con un Resto provisional sería una cifra sin dueño.

**Descartado.** Que las proyecciones lean siempre el global vigente (una cerrada cambiaría sola); permitir forzar el cierre.

## 2026-10-27 · M6 (06d): referencias por comparables C(Z), `VERSION_METODO` sigue en 4 y lo que queda fuera de `0.12.1`

**Decisión.** Las cifras de referencia del análisis (acumulado, cierre proyectado, años completos, lo aplicado hoy, con y sin Niño) usan **comparables por par de periodos, `C(Z)`**; el % aprobado se sigue aplicando sobre `B`, la base de las mismas tiendas, y las cifras que dependen de la proyección exigen `version_metodo ≥ 4`. **`VERSION_METODO` sigue en 4**: el método numérico no cambió, solo de dónde sale el %. Quedan **fuera de `0.12.1`**: «Alinear / Pisar-Conservar» (hoy hay 0 filas con % propio y 4 decididas; una fila vuelve al aprobado con «Volver a la propuesta»), `GET …/vigentes` (sin consumidor) y «Simulación %» (no existía en ninguna pantalla construida); el Modal de choque se borra. «Obsoleto por composición» solo cuenta cambios de GM de los nodos de la foto, y un **mundo desactivado con filas base se puede aprobar**.

**Por qué.** Subir `VERSION_METODO` habría dejado todas las proyecciones en trabajo «desactualizadas: método nuevo» sin que cambiara ninguna fórmula. Los recortes salen de preguntarle a Javier qué se usa de verdad.

**Descartado.** Subir `VERSION_METODO` a 5; construir `GET …/vigentes` «por si M8 lo necesita» (M8 no lo lee); comparar con una sola cohorte de tiendas para todas las cifras.

## 2026-10-27 · M8: no hay recepción presunta; una persona confirma el ingreso de cada compra en un mes X (decisión 54)

**Decisión.** Lo que vale para los meses cerrados es el **inventario publicado** (el ingreso se infiere de stock fin − stock inicio + ventas). El sistema **nunca deja de contar una entrega por su cuenta**: una entrega vencida (periodo ya cerrado, con pendiente) se sigue proyectando en el mes siguiente hasta que alguien **confirme su ingreso** en un mes X (una recepción con `recibida_periodo = X`), la cancele o, desde `0.13.1`, la mueva. En pantalla la acción se llama «Confirmar ingreso»; en la base y la API sigue siendo una recepción. Si la mercadería llegó y nadie confirmó, se cuenta dos veces (en el stock publicado y en el mes siguiente) hasta que alguien confirme: el sistema no lo corrige solo, pero lo hace visible (`posible_doble_conteo`, `entregas_sin_confirmar`, banda «por confirmar» en las tarjetas y chip «Por confirmar» en Flujo, Conciliación y Compras).

**Por qué.** Javier: «Lo que va a valer al final es la data real subida de los ingresos. Lo que se tiene que hacer cuando se registren las compras es confirmar su ingreso en un mes X para dejar de considerarlo en el flujo futuro.» Una recepción presunta que consumiera las entregas vencidas contra el ingreso sin registrar habría escondido errores del registro.

**Descartado.** Recepción presunta automática; dejar el doble conteo sin aviso; recibir siempre en el mes de la entrega (la mercadería a veces llega antes o después).

## 2026-10-27 · M8: «Aceptar sugerencia» es el atajo de un clic para confirmar el ingreso, a nombre de quien lo acepta (decisión 55)

**Decisión.** La conciliación propone, por entrega vencida o adelantada, el mes X en que el inventario publicado la respalda (una sugerencia por entrega, asignación voraz). «Aceptar sugerencia» la registra con un clic y un `confirm` corto: crea la recepción con el nombre del usuario, `origen = sugerencia`, la fecha del último día de ese mes y el motivo «sugerencia de conciliación aaaa-mm», y deja el evento. **Nunca se ejecuta sola.** El servidor recalcula la sugerencia con los datos de hoy antes de escribir (`409 sugerencia_vencida` si cambió). En `0.13.0` solo líneas específicas: una recepción de lote toca varias filas y llega en `0.13.1`. El comprador ve las sugerencias sin el botón mientras la escritura sea del planner.

**Por qué.** Javier pidió el clic; confirmar a mano cada entrega es lento cuando son muchas. La trazabilidad (quién y cuándo) hace que el atajo sea tan auditable como la confirmación manual.

**Descartado.** Aceptar en bloque; crear recepciones solas desde la conciliación.

## 2026-10-27 · M8: cancelar una compra con recepciones cierra el saldo (decisión 56)

**Decisión.** Sin recepciones, cancelar deja la compra `cancelada` (inmutable; todo deja de contar y se libera la clave de importación). **Con recepciones, cancelar cierra el saldo**: cada línea guarda `unidades_canceladas = unidades − recibidas` y la compra queda **recibida con saldo cerrado** («Recibida · saldo cancelado»); las recepciones siguen valiendo. Si ya llegó todo, `409 recibida`. Sobre una compra con saldo cerrado se puede confirmar un ingreso tardío (hasta lo cancelado) y quitar una recepción.

**Por qué.** Javier dijo que cancelar con recepciones es cerrar el saldo. Con «cancelada → 0», las recepciones posteriores al último mes publicado dejaban de sumar y la conciliación mostraba un falso ingreso sin registrar.

**Descartado.** Cancelada con todo en cero aunque haya recepciones.

## 2026-10-27 · M8: `0.13.0` se recorta y `0.13.1` trae captura manual, edición completa, aplicar reparto e impacto (decisión 57)

**Decisión.** `0.13.0` es flujo, IMI, conciliación, confirmar ingresos, cancelar e importador de carga inicial (migración `0025` con **todo** el modelo de tablas, también las columnas que solo usará `0.13.1`). `0.13.1` (migración `0026`, solo funciones) trae captura manual, **edición completa de una compra confirmada** (cualquier campo, con historial; respuesta de Javier), aplicar reparto (por línea, compra o marca) e impacto. M9a pasa a la `0028` (la `0027` la tomó 06d). Mientras tanto, un error en una compra importada se corrige quitando sus recepciones, cancelándola y reimportando la fila corregida.

**Por qué.** Javier recortó la `0.13.0` el 2026-10-27 con la lógica de la decisión 32: validar primero el flujo y el IMI antes de abrir la herramienta de captura y de edición. Crear todas las tablas en `0025` evita `alter table` sobre tablas con datos reales y regenerar tipos dos veces.

**Descartado.** Entregar todo M8 de una vez; partir las tablas entre `0025` y `0026`.

## 2026-10-27 · M8: las filas sin curva avisan y quedan fuera del IMI de los totales (decisión 58, provisional)

**Decisión.** Una fila de la proyección cerrada con venta anual pero sin reparto mensual (sin curva de estacionalidad) no puede proyectar su IMI. El flujo **avisa** cuáles son, cuánta venta anual y cuánto stock tienen (`filas_sin_curva`), las **deja fuera del IMI de los totales** (su stock contaría sin su venta e inflaría el IMI de la compañía) y **no impide cerrar** la proyección en M7. Una fila con total 0 o nulo no es «sin curva». Las filas con stock y sin fila en la cerrada sí entran al IMI: es stock real que la proyección no espera vender. Provisional: el hito 3 se lo muestra a Javier para que confirme.

**Por qué.** El revisor midió en la base que más de una de cada cinco filas base de la proyección en trabajo venía sin curva y que parte de ellas tenía stock; exigir curvas completas para cerrar habría bloqueado M7 por algo que se puede completar después, y contarlas en el IMI habría inflado el de toda la compañía.

**Descartado.** Contarlas en el IMI total (lo infla); exigir curvas para cerrar la proyección.

## 2026-10-27 · M8: una línea `intercompany_directo` con regla es una compra extraordinaria sumada a la reposición esperada (decisión 59, provisional)

**Decisión.** Una línea de JH, DONATELLI o VAN HEUSEN con destino `intercompany_directo` y regla vigente suma su ingreso **además** de la reposición directa esperada (`pct_directo × demanda`). Lleva el aviso `directo_con_regla`: «Esta compra directa se suma a la reposición directa esperada… Si ya es parte de esa reposición habitual, se está contando dos veces». Sin regla vigente, `directo_sin_regla`. Es un supuesto: Javier no respondió esa pregunta, y el hito 4 se lo muestra.

**Por qué.** Entre contarla dos veces con aviso y descartarla en silencio, la primera falla hacia el lado visible. La compra habitual ya está modelada como reposición esperada; una compra directa registrada a mano es, por definición, algo fuera de lo habitual.

**Descartado.** Ignorar la compra directa cuando hay regla; sumarla sin avisar.

## 2026-10-28 · M8: la auditoría de compras es inmutable por trigger, con una excepción para el borrado de usuarios (decisión 60)

**Decisión.** `compra_eventos` es un registro insert-only: el trigger `compra_eventos_inmutable` rechaza todo `UPDATE` y `DELETE`, **también para `service_role`**, y las claves foráneas a `compras` y `compra_lineas` son `on delete restrict` (compras y líneas nunca se borran; se cancelan). Una **única excepción**: el `UPDATE` que solo pone `perfil_id` en `NULL`, que emite la clave foránea `on delete set null` cuando se elimina un usuario. Toda mutación de compras va por funciones plpgsql transaccionales (candado por `revision`, pertenencia y evento en la misma transacción) y la API no escribe las tablas directamente (lo vigila una prueba estática).

**Por qué.** La API corre con `service_role`, así que un `revoke` no frena nada: el trigger es la defensa real de la auditoría. QA y seguridad detectaron que, sin excepción, borrar a un usuario que registró compras fallaba; `/usuarios` permite eliminar usuarios.

**Descartado.** Inmutabilidad solo por prueba estática; `on delete cascade` hacia los eventos (borraría la auditoría); impedir eliminar usuarios con compras.

**Límite conocido.** El trigger es por fila: un `TRUNCATE` con `service_role` no lo activa (pendiente M-3).

## 2026-10-28 · M8: lectura en columnas, caché por huella y listas compactas (decisión 61)

**Decisión.** El flujo se calcula a demanda y no se guarda. El stock se lee **un mes por llamada** (`stock_flujo(carga_id)`) y se cachea por `carga_id` **más la huella de `tiendas` y `marcas`**; cada lectura (cerrada, compras, reglas, repartos) se cachea por la parte de `flujo_huella_base()` que la gobierna y el resultado completo por la huella global, con *single-flight*. Las respuestas viajan compactas: la lista de flujo en series por columnas con nombres en un `catalogo` y `ResumenListaApi`, sin `repartos_vigentes` ni `reglas_intercompany`; Huecos con `catalogo`, índices y campos en cero omitidos (~0,35 a 0,39 MB). `GET /api/flujo` con 1 600 filas pesa 1,38 a 1,49 MiB frente a un presupuesto de 1,5 MB.

**Por qué.** PostgREST devuelve a lo sumo 1 000 filas y la base corta cada sentencia a los 8 s. La forma inicial de la ficha pesaba 3,3 a 4 MB. QA encontró que cachear el stock solo por carga era incorrecto porque `stock_flujo` agrega con `tiendas` y `marcas`, que sí cambian.

**Descartado.** Una función de trece meses con talla (~200 mil filas en un `jsonb`); cachear el stock solo por `carga_id`; devolver los nombres en cada fila.

**Consecuencia.** Con 1 600 filas la lista está al límite: si crece, hay que pasar más campos al detalle.

## 2026-10-28 · M8: el importador de carga inicial usa clave natural y exige referencia, número de línea y fecha (decisión 62)

**Decisión.** Cada línea se identifica por proveedor + referencia + número de línea (`LINEA_ORDINAL`, que no es la línea de producto), de modo que insertar o corregir una fila no duplica lo demás; el contenido se compara por una huella y el resultado es `nueva`, `igual` o `cambiada` (en `0.13.0`, una `cambiada` se omite con su detalle; en `0.13.1` se aplicará como edición). Son **obligatorias** `REFERENCIA`, `LINEA_ORDINAL` y `FECHA_COMPRA`. Se valida que las filas de una misma compra coincidan en cabecera (`cabecera_inconsistente`) y que proveedor y referencia no pasen de su largo (`proveedor_largo`, `referencia_larga`). Una transacción por compra: un corte deja compras completas o ninguna, y reimportar completa lo que falta. Un lote de una marca sin reparto vigente en M12 se omite (`sin_reparto`).

**Por qué.** El hash del contenido más un ordinal duplicaba todo lo que venía después de una fila corregida. Con la fecha de hoy como valor por defecto, el mismo archivo crearía compras nuevas al reimportarlo otro día.

**Descartado.** Hash más ordinal; fecha de compra por defecto; importar lotes sin reparto (líneas que no contarían y que nadie podría arreglar hasta `0.13.1`).

## 2026-10-29 · M6/M7 (06e): método 5, el % del año siguiente es sobre el año en curso corregido del Niño, normalizado por fila (decisión 63)

**Decisión.** `VERSION_METODO` pasa a 5. La base del año siguiente de cada fila de M7 (línea × agrupación de marca) se corrige del Niño con **el factor de la temporada de esa fila**, y la propuesta es `P = round(B' × (1 + g))`, con `g` el % aprobado en Curvas. La base corregida del GM es la suma de las de sus filas. Los GM que mezclan temporadas conservan el factor ponderado por mes de antes, con el aviso `temporadas_mezcladas`. Toda pantalla muestra el % de dos formas: sobre 2026 corregido (el que se escribe) y sobre 2026 real (el que da la Matriz). En un año sin Niño el resultado es idéntico al del método 4, fila por fila. Revierte en parte la decisión de 07c de que el % del año siguiente es bruto.

**Por qué.** Con el % bruto, las líneas de invierno partían de una venta hundida por el Niño y el rebote había que sumarlo aparte; Javier quiere aprobar un crecimiento sobre una base normal. Normalizar por fila y no con una curva compuesta del GM evita repartir el rebote del invierno sobre líneas de verano (la variante que 07c ya había descartado).

**Descartado.** Una curva compuesta por GM para normalizar; reinterpretar en silencio las versiones ya aprobadas como corregidas (un 15 % de invierno habría saltado a +64 % real); dejar el % bruto.

## 2026-10-29 · M6 (06e): el factor del Niño es relativo (decisión 64)

**Decisión.** El factor que usa M7 es `φ = ρ_P ÷ κ_P`: lo que cayó o subió la temporada en los meses del periodo atípico, dividido por lo que cayó o subió la red de todo el año en los mismos meses y tiendas. Se calcula con un mínimo de 2 meses del periodo; con menos, no se propone. El factor de volumen anterior queda como dato en pantalla. Con los datos de hoy el invierno sale cerca de 0,70 (el de volumen era 0,66).

**Por qué.** El factor de volumen borra de las líneas de invierno la caída general de la red de 2026 y deja las de verano con ella: el invierno corregido sería, por construcción, 2025 de las mismas tiendas extrapolado. El relativo quita solo el efecto propio del Niño y conserva la tendencia de la red. Decisión de Javier.

**Descartado.** Seguir con el factor de volumen; un factor único para todas las temporadas.

## 2026-10-29 · M6 (06e): el factor de verano lo escribe Javier con un diagnóstico delante (decisión 65)

**Decisión.** El sistema no propone factor de verano. Calcula y muestra, mes a mes del periodo, cuánto creció el verano por encima de su propia tendencia y de la red («cómo crece el verano atípicamente»), y Javier escribe el valor a mano. Cierra la pregunta abierta del 2026-10-14 sobre el periodo de verano (set–dic).

**Por qué.** Hoy el factor de verano sale de 9 meses, 8 de ellos fuera del periodo del Niño, y el único mes del periodo (setiembre) es de inicio de temporada: un dato frágil no debe fijar solo el nivel de 2027 de esas líneas.

**Descartado.** Calcular el factor con un solo mes del periodo; excluir el verano de la corrección.

## 2026-10-29 · M6/M7 (06e): 2027 no es Niño; si se marca, no se aprueba ni se cierra (decisión 66)

**Decisión.** No se modela un factor del Niño para el año siguiente. Si el año siguiente tiene meses atípicos marcados en Estacionalidad, aprobar un crecimiento de ese año (`409 anio_siguiente_atipico`) y cerrar la proyección quedan bloqueados, sin excepción, hasta que Javier quite la marca o decida cómo modelarlo. Calcular sigue permitido.

**Por qué.** Un % único por GM no puede incluir el efecto de una sola temporada, y el último factor conocido (el de invierno 2026) se aplicaría a 2027 solo porque su periodo llega a diciembre de 2026. Es más seguro frenar que producir una cifra que nadie pidió.

**Descartado.** Aplicar el factor del año siguiente al nivel de cada fila.

## 2026-10-29 · M7 (06e): cerrar exige un factor existente, al día y confirmado cada mes publicado (decisión 67)

**Decisión.** Para cerrar, cada factor del año en curso que toque filas de 2027 tiene que existir (`factor_faltante`), estar al día con los datos, la composición y la fórmula (`factor_desfasado`) y, si es parcial, estar **confirmado por Javier sobre el cálculo vigente** (`factor_sin_confirmar`): al escribir el valor se guarda `aplicado_huella`, la huella de cargas que tenía delante, y escribir el mismo valor que el calculado confirma. Cada mes publicado hay que sincronizar y volver a confirmar. Ninguno se fuerza. Si el factor cambia después de calcular, cerrar tampoco se fuerza (`factores_cambiados` de ese año). Los factores de otros años siguen forzables, y calcular nunca se bloquea.

**Por qué.** El factor del año en curso fija el nivel de 2027 de las líneas con Niño y hoy nada detectaba que un factor parcial había quedado viejo. Cerrar ocurre pocas veces al año; confirmar mensualmente cuesta un minuto y evita que un factor de setiembre cierre en diciembre sin que nadie lo mire. Decisión de Javier al aprobar la ficha.

**Descartado.** Confirmar una vez y que valga hasta borrarlo; solo avisar sin bloquear.

## 2026-10-29 · M6 (06e): umbral de materialidad del Niño de 0,5 % (decisión 68)

**Decisión.** Un GM (o el Resto) «tiene Niño» solo si su base corregida difiere de la real en 0,5 % o más (`UMBRAL_CORRECCION_NINO = 0,005`); la misma función decide en la pantalla y en M7. Por debajo, una versión `bruta` vale tal cual para cerrar, la pantalla muestra un solo %, no dibuja la línea corregida y no pide reaprobar.

**Por qué.** Con un umbral de 0,05 % casi todos los GM de HOMBRE y MUJER tienen algo de invierno y Javier habría tenido que reaprobar unos diez GM y el Resto sin que cambiara nada material. Con 0,5 %, la diferencia entre aplicar una versión bruta y una corregida es menor que el 0,5 % del 2027 del GM.

**Descartado.** 0,05 %; exigir reaprobar todo al subir el método.

## 2026-10-29 · M6/M8 (06e): transición con método 4, versiones bruta y cerrada que sigue sirviendo a M8 (decisión 69)

**Decisión.** Javier puede cerrar ahora una proyección con el método 4 para validar M8 y volver a cerrar con `0.14.0` después. Una cerrada de método 4 **sigue sirviendo a M8** con el aviso `cerrada_metodo_anterior` (los meses de 2027 de las líneas con Niño no están corregidos), que no bloquea; al cerrar una de método 5, la anterior se archiva sola. Las proyecciones en trabajo quedan «desactualizadas: método nuevo» (no se fuerza; recalcular conserva las decisiones). `crecimientos_genero_mundo.sobre_base` tiene default `'bruta'` para siempre, en una sola sentencia: las versiones aprobadas antes de `0.14.0` conservan su significado y solo la API nueva escribe `corregida`, siempre explícita. Solo en un GM con Niño material hay que «Reaprobar» (un clic, conserva el total del GM).

**Por qué.** Javier va a aprobar y cerrar en la `0.13.x` antes del despliegue y no se le debe invalidar nada de golpe. Con un default `corregida`, una aprobación hecha en la `0.13.x` habría quedado marcada como corregida aunque la pantalla vieja la mostró bruta, y sus líneas de invierno habrían subido de golpe al desplegar.

**Descartado.** Default `corregida`; convertir las versiones antiguas solas (06d: nunca se copian solas); bloquear M8 hasta tener una cerrada de método 5.

## 2026-10-30 · M7 (07e): la IA es una fuente más de la cifra decidida, la meta es solo de lo existente y las libres absorben (decisión 70)

**Decisión.** La propuesta del método (`propuesto`) no cambia. La IA añade una segunda cifra por fila (natural, con meta, brecha y razón) y el botón «Aceptar IA», que es una decisión manual con traza (`decision_ia_fila_id`), una fila a la vez y con la cifra que el planner vio. Las filas libres se siguen decidiendo a mano para poder cerrar. La **meta del GM** es la suma de lo que el método propondría si todas sus filas siguieran al GM y es **solo de lo que ya existe**: filas con base en 2026 (las líneas o marcas nuevas de 2027 se trabajan aparte; las tiendas nuevas y cierres quedan fuera). Son fijas (no las toca la IA) las decididas, las de % propio y la cola larga. **Las demás filas libres absorben** cualquier cambio de la meta o de las fijas, de modo que el GM sume exacto, y cada fila muestra cuánto absorbió desde que la IA propuso. El cuadre de la Matriz es la garantía; cerrar no lo exige.

**Por qué.** El método es determinista y M8 depende de él; sustituirlo por la cifra de un modelo rompería la reproducibilidad. El planner decide cada fila libre de todos modos: la IA le ahorra el análisis, no la decisión. Un modelo no suma con exactitud ni conoce decisiones posteriores, así que el código normaliza al leer y muestra lo absorbido para que ninguna cifra «de la IA» esconda un ajuste que la IA no propuso.

**Descartado.** Reemplazar `propuesto`; una proyección aparte «escenario IA»; aceptar en bloque; guardar cifras ya normalizadas (habría que reescribirlas en cada decisión).

## 2026-10-30 · M7 (07e): a la IA solo salen cifras agregadas y los nombres de marcas y tiendas van como alias (decisión 71)

**Decisión.** Al proveedor salen únicamente unidades agregadas por fila, por año relativo (`A−3` … `A`) y mes, los nombres del árbol y de las agrupaciones de marca, e indicadores derivados por el código. **Las marcas y las tiendas van como alias**, que el sistema restituye al volver para que el usuario siempre vea nombres reales. Nunca salen años reales, tiendas, soles, costos, stock, usuarios, el nombre de la empresa ni ids. Lo enviado se guarda canónico e inmutable en una tabla propia (solo admin) y nada de lo enviado ni lo recibido va a los logs. La clave vive solo como variable secreta en Railway.

**Por qué.** Es el perímetro que fijó Javier. La revisión midió 196 equivalencias activas cuyo nombre contiene el de una marca (90 idénticas), así que los nombres del árbol podían filtrar marcas: Javier eligió alias. Los años relativos impiden que el modelo «recuerde» lo ocurrido en un año concreto, que contaminaría el backtest. Guardar la entrada exacta permite verificar la huella de lo enviado.

**Descartado.** Enviar nombres reales de marca; enviar tiendas o soles; no guardar la entrada.

## 2026-10-30 · M7 (07e): la IA se enciende solo si gana al mejor rival (decisión 72)

**Decisión.** La capacidad de distribución se enciende únicamente si una evaluación con el mismo modelo y la misma versión del prompt la dio por ganadora frente al **mejor** de dos rivales, el método actual (reparto parejo) y una regla de tendencia, tanto en el reparto como en el natural, y **en al menos la mitad de los GM con ≥ 5 filas libres**; además no puede empeorar de forma notable en ningún género. Sin evaluación ganadora, la IA no muestra cifras. El modelo es un parámetro (admin) y se queda el más barato que gane.

**Por qué.** Javier pidió backtest obligatorio. Si una regla determinista empata con la IA no hay razón para pagar un modelo, y atar el encendido al par modelo + prompt impide que un cambio entre sin volver a medirse. Medir por GM evita que un par de GM grandes tapen el resto.

**Descartado.** Compararla solo contra el método; encenderla por configuración sin medir.

## 2026-10-30 · M7 (07e): la primera entrega es solo la distribución de la meta (decisión 73)

**Decisión.** `0.15.0 · M7` trae solo la **distribución de la meta de 2027** entre las filas libres del GM (proyección natural sin conocer la meta, reparto, brecha, cuadre en la Matriz, evaluación y administración; migración `0030`). Las sublíneas y el cierre del año en curso por la IA quedan para `0.15.1`, con su diseño conservado en la ficha. Una llamada al proveedor por petición, conducida por el navegador, con candado por GM y registro transaccional.

**Por qué.** Javier decidió (decisión 2 de la revisión de la ficha) empezar solo por la distribución y construir lo demás después de recorrer el hito de `0.15.0`. Una llamada por petición evita que un reintento del navegador duplique el gasto o deje una propuesta a medias. La ficha `07e` está lista y revisada; **no se ha construido**.

**Descartado.** Entregar todo junto; procesar un GM entero en una sola petición.
