-- M11 · Unidades vendidas por mes para el histograma del Resumen del reporte
-- agrupación GMLE (validar la data cargada y la forma de cada agrupación).
--
-- Idempotente (`create or replace function`, `revoke` y `grant` repetibles).
-- Sin bloques `do $$ ... $$` (las comillas de dólar del cuerpo no son un bloque
-- anónimo). SIN DROP, DELETE, TRUNCATE ni UPDATE: las migraciones se aplican
-- con `execute_sql`, donde esas sentencias se quedan esperando una confirmación.
--
-- POR QUÉ UNA FUNCIÓN: `venta_stock_vigente` tiene cientos de miles de filas y
-- PostgREST limita a 1 000 por petición; sumar en el servidor de la app
-- obligaría a paginar todo. Aquí la base agrega por mes y devuelve ~45 filas.
--
-- Qué hace:
--   * Suma `unidades` y `venta_soles` de `venta_stock_vigente` (solo cargas
--     publicadas) por `periodo` (primer día de mes), en orden cronológico.
--   * `p_equivalencias`: lista opcional de equivalencias a incluir. Nulo = todas.
--     El reporte envía las equivalencias que dejan pasar sus filtros, así el
--     histograma sigue exactamente lo que se ve en pantalla.
--   * Las unidades son netas (las devoluciones restan), igual que en M5.
--   * Solo lectura.
--
-- `security invoker`, `stable`, `search_path` vacío: la ejecuta solo el backend
-- (service_role, que salta el RLS) y el `revoke` quita el acceso por `rpc` a
-- `anon` y `authenticated`.
create or replace function public.unidades_mensuales(
  p_equivalencias uuid[] default null
)
returns table (
  periodo date,
  unidades bigint,
  venta_soles numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    v.periodo,
    coalesce(sum(v.unidades), 0)::bigint as unidades,
    coalesce(sum(v.venta_soles), 0)::numeric as venta_soles
  from public.venta_stock_vigente v
  where p_equivalencias is null
     or v.equivalencia_id = any (p_equivalencias)
  group by v.periodo
  order by v.periodo;
$$;

revoke execute on function public.unidades_mensuales(uuid[]) from public, anon, authenticated;
grant execute on function public.unidades_mensuales(uuid[]) to service_role;
