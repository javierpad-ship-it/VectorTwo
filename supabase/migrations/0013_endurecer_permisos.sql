-- Endurecer permisos de `public` (auditoría de seguridad del 2026-10-14, hallazgos I-2, M-8 y M-10).
--
-- Idempotente: todo son `revoke`, `grant`, `alter default privileges` y un
-- `alter column ... set default`, repetibles. Sin bloques `do $$ ... $$`.
-- SIN DROP, DELETE, TRUNCATE ni UPDATE (las migraciones se aplican con
-- `execute_sql`, donde esas sentencias se quedan esperando una confirmación).
--
-- POR QUÉ: Supabase deja por defecto que `anon` y `authenticated` tengan todos
-- los privilegios sobre lo que se crea en `public`. Hoy solo el RLS (activo y
-- sin políticas) impide que la clave anon, que es pública, lea o escriba. Una
-- tabla nueva sin `enable row level security` (como pasó con `prueba_conexion`)
-- o una función nueva sin `revoke` quedaría abierta. Con esta migración
-- `anon` y `authenticated` ya no tienen privilegio alguno en `public`, ni hoy ni
-- en lo que se cree después: defensa en profundidad bajo el RLS.
--
-- La app accede solo con `service_role` desde los route handlers, que conserva
-- (y se reafirma aquí) acceso total. Las funciones de negocio ya se ejecutan
-- solo como `service_role` (0010 y 0012); `tg_set_updated_at` es función de
-- trigger: el privilegio EXECUTE se comprueba al crear el trigger, no al
-- dispararlo.
--
-- Alcance: los privilegios por defecto del rol `postgres` (el que aplica las
-- migraciones). Los de `supabase_admin` los gestiona la plataforma y no los
-- toca esta migración.

-- 1. Lo que se cree de ahora en adelante.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;

alter default privileges for role postgres in schema public grant all on tables to service_role;
alter default privileges for role postgres in schema public grant all on sequences to service_role;
alter default privileges for role postgres in schema public grant execute on functions to service_role;

-- 2. Lo que ya existe (tablas, vistas, secuencias y funciones, incluida
--    `venta_stock_vigente` y la tabla de pruebas `prueba_conexion`).
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- 3. Un perfil insertado sin `rol` nace como `comprador` (el de menos permisos),
--    no como `planner`.
alter table public.perfiles alter column rol set default 'comprador';
