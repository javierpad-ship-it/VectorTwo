-- 0040 · Privilegios mínimos de public.proveedores (hallazgo H-6 de la auditoría de 08c E1).
-- service_role conservaba truncate, trigger y references por los privilegios por defecto de Supabase.
-- eliminar_proveedor es security invoker y necesita delete, así que select, insert, update y delete se conservan.
-- Idempotente: revocar un privilegio que no se tiene no falla.

revoke truncate, trigger, references on public.proveedores from public, anon, authenticated, service_role;

insert into public.migraciones_aplicadas (nombre, nota)
values ('0040_privilegios_proveedores', 'quita truncate, trigger y references a service_role sobre proveedores (H-6 de 08c E1)')
on conflict (nombre) do nothing;
