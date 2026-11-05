-- 0037 · Estadísticas del planificador y `work_mem` de las lecturas pesadas de venta (solo base de datos, sin cambios de esquema).
-- Dos arreglos baratos del informe de rendimiento de ventas (2026-11-04), sin tablas, columnas ni cuerpos de función nuevos:
--   1. `analyze` de las 46 tablas de `public` (47 con `prueba_conexion`, ver abajo) que NUNCA tuvieron estadísticas (entre ellas `tiendas`, `generos`, `mundos`,
--      `agrupaciones_*`, `proyecciones`, `proyeccion_tiendas` y todas las tablas de compras e IA).
--   2. `alter function ... set work_mem = '16MB'` en las 7 funciones pesadas de lectura de venta.
-- Idempotente (`analyze` y `alter function ... set` se repiten sin error ni efecto distinto; el registro final lleva `on conflict do nothing`).
-- Sin `do $$ ... $$`. Sin `drop`, `delete`, `truncate` ni `update`. No crea tablas: no hay nada que activar en RLS. No cambia el cuerpo
-- (`prosrc`), la firma, los permisos ni el `search_path` de ninguna función.
--
-- EL HALLAZGO. `public.tiendas` (12 filas) y otras 46 tablas pequeñas no tenían NINGUNA fila en `pg_statistic` (ni `last_analyze` ni
-- `last_autoanalyze`). Sin estadísticas, `tipo = 'Tienda'` se estima con la selectividad por defecto (0,5 %): el planificador cree que hay
-- 1 tienda donde hay 11. Las funciones `language sql` se planifican con plan genérico (el array de nodos llega como parámetro), y con
-- esa estimación arman un bucle tiendas x cargas x equivalencias que hace 132 660 búsquedas por la clave primaria de
-- `venta_stock_mensual` (565 727 buffers solo en la CTE `hechos` de `venta_proyeccion`, frente a 71 mil con el plan bueno, que entra por
-- `venta_stock_mensual_equivalencia_idx`). El mismo patrón agranda `venta_tienda_nodos` (4,9 M de buffers con los 590 nodos) y hace que
-- `venta_genero_mundo` recorra la tabla de hechos por la PK en lugar de un escaneo secuencial.
--
-- POR QUÉ EL AUTOVACUUM NO LO ARREGLA. El autoanalyze se dispara por el número de filas CAMBIADAS desde el último análisis (umbral = 50
-- + 10 % de las filas). Una tabla maestra de 12 filas que casi no cambia, o que se llenó antes de que existiera el daemon, nunca cruza ese
-- umbral: queda sin estadísticas para siempre. Tampoco analiza tablas sin cambios. REGLA OPERATIVA: repetir `analyze` (de las tablas
-- afectadas) a mano después de cada carga o cambio grande de un maestro (tiendas, equivalencias, marcas, árbol de producto) y después de
-- publicar una carga de venta; basta con volver a correr el bloque 1 de esta migración o `analyze public.<tabla>;`.
--
-- `public.prueba_conexion` (vacía, sin uso) existe SOLO en vector-two (se creó a mano, ninguna migración la define) y tampoco tenía
-- estadísticas: no puede ir aquí porque la base local no la tiene y `analyze` fallaría; se analizó a mano en vector-two (`analyze
-- public.prueba_conexion;`), sin consecuencias para ningún plan.
--
-- QUÉ SE ANALIZA Y QUÉ NO. Solo las tablas que carecían de estadísticas (consulta usada: `pg_stat_user_tables` con `last_analyze` y
-- `last_autoanalyze` nulos y ninguna fila en `pg_stats`). `venta_stock_mensual` (870 mil filas), `equivalencias`, `marcas`,
-- `cargas_venta_stock`, `genero_mundo_linea`, `lineas`, `proyeccion_filas` y `proyeccion_fila_anios` ya tenían estadísticas por
-- autoanalyze y no se tocan (analizar la tabla de hechos cuesta un muestreo de 30 mil filas por gusto). Las tablas vacías también se
-- analizan: es instantáneo y deja `reltuples = 0` en lugar de -1, para que la estimación sea correcta cuando empiecen a llenarse.
--
-- `work_mem`. El de la base es 3,5 MB. `venta_proyeccion` ordena en disco 9 MB (`filas`) y 2-4 MB (`pesos`, `detalle`, `stock_tienda`), y
-- `venta_genero_mundo` agrega con 21 lotes y 36 MB en disco y ordena 23,6 MB (11 216 bloques temporales escritos por llamada).
-- El nodo mayor medido usa 5,7 MB en memoria, así que 16 MB basta. El valor aplica solo mientras la función se ejecuta (se restaura al
-- salir) y por nodo de ordenación o hash; el peor caso teórico (8 nodos x 16 MB x 3 tandas simultáneas) son unos 384 MB, y lo real
-- medido son menos de 6 MB por nodo.
--
-- ADVERTENCIAS sobre `alter function ... set`:
--   * Un `SET` de función solo vale si la función que lo lleva es la que ejecuta la consulta. Una función que llama a otra que declara su
--     propio `SET` de `work_mem` volvería a su valor. Revisado en vector-two: ninguna de las 7 llama a otra función de `public` (no hay
--     cadenas), así que el `SET` de cada una rige todo su trabajo.
--   * `create or replace function` REEMPLAZA la lista completa de `SET` de la función con la que lleve la nueva definición. Toda
--     migración futura que reescriba una de estas 7 funciones (por ejemplo la que pase las lecturas de venta a un agregado) debe incluir
--     `set work_mem = '16MB'` junto a `set search_path = ''` en su cabecera, o repetir los `alter function` de abajo, o el valor se pierde
--     sin avisar. El humo `scripts/humo-0037.sql` lo comprueba.
--   * `alter function ... set` conserva los demás ajustes (`search_path = ''` se mantiene) y no toca `prosrc`, `proacl` ni los comentarios.


-- ---------------------------------------------------------------------------
-- 1. Estadísticas de las 46 tablas que nunca se analizaron y que crean las migraciones (`analyze` es idempotente)
-- ---------------------------------------------------------------------------
-- `tiendas` va primera: es la que fija la estimación de 1 fila frente a 11.

analyze public.tiendas;

analyze
  public.agrupacion_estacionalidad_genero,
  public.agrupaciones_estacionalidad,
  public.agrupaciones_marca,
  public.agrupaciones_talla,
  public.compra_agrupador_eventos,
  public.compra_embarques,
  public.compra_entrega_asignaciones,
  public.compra_eventos,
  public.compra_linea_entregas,
  public.compra_linea_recepciones,
  public.compra_linea_repartos,
  public.compra_lineas,
  public.compra_paquetes,
  public.compra_viajes,
  public.compras,
  public.corridas_estacionalidad,
  public.crecimientos_genero_mundo,
  public.curvas_estacionalidad,
  public.factores_volumen_atipico,
  public.flujo_parametros,
  public.generos,
  public.ia_configuraciones,
  public.ia_corrida_gms,
  public.ia_corridas,
  public.ia_entradas,
  public.ia_evaluaciones,
  public.ia_llamadas,
  public.ia_propuestas_filas,
  public.ia_propuestas_gm,
  public.intercompany_reglas,
  public.mapeos_combinacion,
  public.marca_gml_especial,
  public.migraciones_aplicadas,
  public.mundos,
  public.perfiles,
  public.periodos_atipicos,
  public.proveedores,
  public.proyeccion_crecimientos,
  public.proyeccion_lote_filas,
  public.proyeccion_lotes,
  public.proyeccion_tiendas,
  public.proyecciones,
  public.reparto_marca_barrido_gml,
  public.repartos_marca_barrido,
  public.responsables_genero_mundo,
  public.ubicaciones_ignoradas;


-- ---------------------------------------------------------------------------
-- 2. `work_mem = 16MB` en las 7 funciones pesadas de lectura de venta (firmas reales de pg_proc)
-- ---------------------------------------------------------------------------

alter function public.venta_proyeccion(uuid[], jsonb, uuid[], date, date) set work_mem = '16MB';
alter function public.venta_genero_mundo(date) set work_mem = '16MB';
alter function public.venta_tienda_nodos(uuid[], date, date) set work_mem = '16MB';
alter function public.venta_mensual_tienda() set work_mem = '16MB';
alter function public.venta_estacionalidad_agrupacion(uuid) set work_mem = '16MB';
alter function public.venta_composicion_agrupacion(uuid, jsonb, date) set work_mem = '16MB';
alter function public.unidades_mensuales(uuid[]) set work_mem = '16MB';


-- ---------------------------------------------------------------------------
-- 3. Registro de esta migración (convención de la 0035: la última sentencia)
-- ---------------------------------------------------------------------------
insert into public.migraciones_aplicadas(nombre) values ('0037_estadisticas_y_work_mem') on conflict do nothing;
