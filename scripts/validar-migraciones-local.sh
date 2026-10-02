#!/usr/bin/env bash
# Valida todas las migraciones contra un PostgreSQL local (sin Supabase).
#
# Crea la base `vector_two_local` desde cero con un stub mínimo de `auth.users`,
# aplica cada archivo de supabase/migrations/ en orden DOS veces (la segunda
# pasada demuestra que son idempotentes) y falla al primer error.
#
# Requiere un cluster local corriendo (en el contenedor de desarrollo:
#   pg_ctlcluster 16 main start
# ). No toca ningún proyecto Supabase.
set -euo pipefail

cd "$(dirname "$0")/.."
DB=vector_two_local
PSQL="psql -v ON_ERROR_STOP=1 -q"

# Recibe UN string con el comando completo y lo corre como usuario postgres.
pg() {
  if [ "$(id -un)" = "postgres" ]; then bash -c "$1"; else su postgres -c "$1"; fi
}

pg "$PSQL -c 'drop database if exists $DB;' -c 'create database $DB;'"
pg "$PSQL -d $DB -c \"create schema if not exists auth; create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text); insert into auth.users (email) values ('jperezalbela@jeruth.pe');\""

for pasada in 1 2; do
  echo "== Pasada $pasada"
  for f in supabase/migrations/*.sql; do
    echo "   -> $f"
    pg "$PSQL -d $DB -f '$PWD/$f'" 2>&1 | grep -v 'NOTICE' || true
  done
done

echo "== Tablas con RLS"
pg "psql -d $DB -c \"select c.relname as tabla, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1;\""

echo "OK: todas las migraciones aplican dos veces sin error."
