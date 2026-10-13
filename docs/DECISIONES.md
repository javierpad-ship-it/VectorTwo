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
