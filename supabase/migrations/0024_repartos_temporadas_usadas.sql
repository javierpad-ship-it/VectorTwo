-- M12 · `repartos_marca_barrido.temporadas_usadas` (columna que la ficha pedía y 0019 omitió).
--
-- Ficha: docs/modulos/12-analisis-marcas-barrer.md (§ 6.3 y regla 18 "SQL (humo local)").
-- Numeración: la 0023 fue la última (M7 07c); esta es la siguiente libre.
--
-- Qué hace: añade a `public.repartos_marca_barrido` la columna `temporadas_usadas`, las
-- fechas de temporada (decisión 31 de Javier) con las que se calculó cada versión del
-- reparto. Sin ella, cambiar las fechas de temporada de M8 (`flujo_parametros.temporadas`)
-- reescribiría, al releerlo, el significado de un reparto ya aprobado: las filas
-- `por_temporada` dicen "verano"/"invierno", y qué meses abarca cada una debe quedar
-- fijado en la versión, no leerse de la configuración vigente. Hasta ahora el código
-- (`temporadasDeVersion()` en src/lib/marcas-barrer/reglas.ts) devolvía siempre las de por
-- defecto porque la columna no existía.
--
-- El default es `TEMPORADAS_DEFECTO` de src/lib/marcas-barrer/tipos-api.ts, con las mismas
-- claves y los mismos meses: verano de octubre (10) a marzo (3) e invierno de abril (4) a
-- septiembre (9). Un rango puede cruzar el fin de año (`10 -> 3`), por eso `desde_mes`
-- puede ser mayor que `hasta_mes` y la base NO lo comprueba.
--
-- Idempotente: `add column if not exists` con su check en línea; si la columna ya existe,
-- se omite también el check y repetir la migración no lo duplica (mismo recurso que 0019 y
-- 0023). Sin bloques `do $$ ... $$`. Sin DROP, DELETE, TRUNCATE ni UPDATE: las filas
-- existentes (si las hay) toman el default al añadir la columna, que es justamente lo que
-- usaron al calcularse (hasta hoy no había otras fechas). Sin backfill.
--
-- Criterio I9 de la ficha: la base solo lleva la invariante ESTRUCTURAL (un objeto JSON);
-- las claves, los meses 1-12 y que las dos temporadas cubran el año sin solaparse
-- (`motivoTemporadasInvalidas`) los valida zod/TypeScript, para poder cambiar el formato
-- sin `DROP constraint`.
--
-- Seguridad: la tabla ya tiene RLS activo, sin políticas y con `revoke`/`grant` desde
-- 0019; una columna nueva hereda todo eso. No hay objetos nuevos que proteger.
--
-- Todos los identificadores miden <= 63 caracteres.

alter table public.repartos_marca_barrido
  add column if not exists temporadas_usadas jsonb not null
    default '{"verano":{"desde_mes":10,"hasta_mes":3},"invierno":{"desde_mes":4,"hasta_mes":9}}'::jsonb
    constraint repartos_marca_barrido_temporadas_check
      check (jsonb_typeof(temporadas_usadas) = 'object');

comment on column public.repartos_marca_barrido.temporadas_usadas is
  'M12: fechas de temporada con las que se calculo esta version del reparto ({ verano: { desde_mes, hasta_mes }, invierno: { ... } }; decision 31: verano 10-3, invierno 4-9 por defecto). Se guardan para que cambiar las fechas de temporada en M8 no reescriba lo ya aprobado. Entran en huella_config. El check exige un objeto; el resto lo valida la API.';
