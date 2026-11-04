#!/usr/bin/env bash
# Valida todas las migraciones contra un PostgreSQL local (sin Supabase).
#
# Crea la base destino (por defecto `vector_two_local`) desde cero con un stub mínimo de `auth.users`, aplica cada archivo de
# supabase/migrations/ en orden DOS veces (la segunda pasada demuestra que son idempotentes) y falla al primer error.
#
# A qué Postgres se conecta (ver scripts/lib-pg.sh):
#   * DATABASE_URL=postgres://usuario:clave@localhost:5432/vector_two_local   (CI y cualquier Postgres con contraseña)
#   * o PGHOST/PGPORT/PGUSER/PGPASSWORD (+ VT_DB para el nombre de la base)
#   * o nada: el clúster local por socket como usuario `postgres`. En el contenedor de desarrollo:
#         pg_ctlcluster 16 main start
#     En este modo también deja un rol `vt_test` (superusuario, clave `vt_test`) para que las pruebas de integración puedan
#     entrar por TCP; al terminar imprime el DATABASE_URL a exportar.
#
# No toca ningún proyecto Supabase: se niega a correr contra un host que no sea local (VT_PERMITIR_HOST_REMOTO=1 lo levanta).
# VT_MIGRACIONES=<directorio> cambia la carpeta de migraciones (lo usan las pruebas del propio script).
set -euo pipefail

cd "$(dirname "$0")/.."
# shellcheck source=scripts/lib-pg.sh
source scripts/lib-pg.sh
vt_resolver_conexion

MIGRACIONES="${VT_MIGRACIONES:-supabase/migrations}"
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
SALIDA="$(mktemp)"
trap 'rm -f "$SALIDA"' EXIT

echo "== Base destino: $VT_DB (modo $VT_MODO)"

# Roles que Supabase trae de fábrica y que las migraciones usan en `grant` y `revoke` (0007). Son de clúster, no de base: se
# crean una vez si faltan. `service_role` lleva BYPASSRLS, como en Supabase (todas las tablas tienen RLS sin políticas).
for rol in anon authenticated service_role; do
  if ! vt_psql_admin -Atc "select 1 from pg_roles where rolname = '$rol'" | grep -q 1; then
    vt_psql_admin -v ON_ERROR_STOP=1 -q -c "create role $rol nologin;"
  fi
done
vt_psql_admin -v ON_ERROR_STOP=1 -q -c "alter role service_role bypassrls;"

if [ "$VT_MODO" = local ]; then
  if ! vt_psql_admin -Atc "select 1 from pg_roles where rolname = 'vt_test'" | grep -q 1; then
    vt_psql_admin -v ON_ERROR_STOP=1 -q -c "create role vt_test login superuser password 'vt_test';"
  fi
fi

vt_psql_admin -v ON_ERROR_STOP=1 -q -c "drop database if exists $VT_DB with (force);" -c "create database $VT_DB;"
vt_psql -v ON_ERROR_STOP=1 -q -c "create schema if not exists auth; create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text); insert into auth.users (email) values ('jperezalbela@jeruth.pe');"

# Privilegios por defecto de Supabase: todo objeto nuevo que crea el rol `postgres` en `public` nace con permisos para anon,
# authenticated y service_role (por eso cada migracion hace `revoke ... from anon, authenticated`, y la 0013 los quita de los
# defaults `for role postgres`). Sin esto la base local NO simula produccion y un `revoke` olvidado pasaria inadvertido. Se fijan
# ANTES de las migraciones, para el rol `postgres` (el mismo de la 0013), y las migraciones se aplican COMO `postgres` (`set role`),
# sea cual sea el usuario con el que entra el script.
vt_psql -v ON_ERROR_STOP=1 -q -c "alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role; alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;"

shopt -s nullglob
archivos=("$MIGRACIONES"/*.sql)
if [ "${#archivos[@]}" -eq 0 ]; then
  echo "ERROR: no hay migraciones en $MIGRACIONES" >&2
  exit 1
fi

for pasada in 1 2; do
  echo "== Pasada $pasada"
  for f in "${archivos[@]}"; do
    echo "   -> $f"
    if ! { echo "set role postgres;"; cat "$f"; } | vt_psql -v ON_ERROR_STOP=1 -q -f - >"$SALIDA" 2>&1; then
      cat "$SALIDA" >&2
      echo "FALLO: $f no aplica (pasada $pasada)." >&2
      exit 1
    fi
  done
done

echo "== Tablas con RLS"
vt_psql -c "select c.relname as tabla, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' order by 1;"

echo "OK: todas las migraciones aplican dos veces sin error (${#archivos[@]} archivos)."
if [ "$VT_MODO" = local ]; then
  echo "Para las pruebas de integracion: export DATABASE_URL=$(vt_url_para_pruebas)"
fi
