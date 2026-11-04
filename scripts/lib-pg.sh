#!/usr/bin/env bash
# Funciones comunes de los scripts de base local (validar-migraciones-local.sh, correr-humos.sh). Se carga con `source`.
#
# Cómo elige a qué Postgres conectarse (en este orden):
#   1. DATABASE_URL   postgres://usuario:clave@host:puerto/base   (la base destino es la última parte de la URL)
#   2. PGHOST (y PGPORT, PGUSER, PGPASSWORD)                      (la base destino es VT_DB, por defecto vector_two_local)
#   3. nada de lo anterior: el clúster local por socket, como usuario `postgres` (contenedor de desarrollo:
#      `pg_ctlcluster 16 main start`). Base destino: vector_two_local.
#
# SEGURIDAD: estos scripts BORRAN y recrean la base destino y los humos escriben datos de prueba. Por eso se niegan a correr si el
# host no es local (localhost, 127.0.0.1, ::1 o un socket). Nunca apuntes esto a un proyecto Supabase. Quien sepa lo que hace puede
# saltarse el candado con VT_PERMITIR_HOST_REMOTO=1 (por ejemplo, un Postgres de CI que no está en localhost).

VT_DB_DEFECTO=vector_two_local

vt_resolver_conexion() {
  VT_MODO=""
  VT_DB="${VT_DB:-$VT_DB_DEFECTO}"
  VT_HOST=""
  if [ -n "${DATABASE_URL:-}" ]; then
    VT_MODO=url
    local base="${DATABASE_URL%%\?*}" consulta=""
    case "$DATABASE_URL" in *\?*) consulta="?${DATABASE_URL#*\?}" ;; esac
    VT_DB="${base##*/}"
    VT_URL="$DATABASE_URL"
    VT_URL_ADMIN="${base%/*}/postgres${consulta}"
    local sin_esquema="${base#*://}" resto
    resto="${sin_esquema#*@}"
    [ "$resto" = "$sin_esquema" ] && resto="$sin_esquema"
    resto="${resto%%/*}"
    case "$resto" in
      \[*\]*) VT_HOST="${resto%%\]*}]" ;;
      *) VT_HOST="${resto%%:*}" ;;
    esac
    case "$consulta" in *host=*) VT_HOST="${consulta#*host=}"; VT_HOST="${VT_HOST%%&*}" ;; esac
  elif [ -n "${PGHOST:-}" ]; then
    VT_MODO=pgenv
    VT_HOST="$PGHOST"
  else
    VT_MODO=local
  fi

  if [ "$VT_MODO" != local ]; then
    case "$VT_HOST" in
      ""|localhost|127.0.0.1|::1|"[::1]"|/*) ;;
      *)
        if [ "${VT_PERMITIR_HOST_REMOTO:-}" != 1 ]; then
          echo "ERROR: el host '$VT_HOST' no es local. Estos scripts borran y recrean la base y escriben datos de prueba; no se corren contra un servidor remoto (jamas contra Supabase). Si es un Postgres de CI o de pruebas, exporta VT_PERMITIR_HOST_REMOTO=1." >&2
          exit 2
        fi
        ;;
    esac
  fi
  case "$VT_DB" in
    ""|postgres|template0|template1)
      echo "ERROR: la base destino ('$VT_DB') no puede ser una base de sistema. Usa algo como vector_two_local." >&2
      exit 2
      ;;
  esac
}

# Corre psql contra la base de mantenimiento (`postgres`).
vt_psql_admin() {
  case "$VT_MODO" in
    url) psql -X "$VT_URL_ADMIN" "$@" ;;
    pgenv) psql -X -d postgres "$@" ;;
    *) if [ "$(id -un)" = postgres ]; then psql -X -d postgres "$@"; else runuser -u postgres -- psql -X -d postgres "$@"; fi ;;
  esac
}

# Corre psql contra la base destino.
vt_psql() {
  case "$VT_MODO" in
    url) psql -X "$VT_URL" "$@" ;;
    pgenv) psql -X -d "$VT_DB" "$@" ;;
    *) if [ "$(id -un)" = postgres ]; then psql -X -d "$VT_DB" "$@"; else runuser -u postgres -- psql -X -d "$VT_DB" "$@"; fi ;;
  esac
}

# Ejecuta un archivo SQL leyéndolo por stdin (así el usuario `postgres` no necesita permiso de lectura sobre el repo).
vt_psql_archivo() {
  local archivo="$1"
  shift
  vt_psql "$@" -f - <"$archivo"
}

# URL de conexión que deben usar las pruebas de integración (la misma base destino).
vt_url_para_pruebas() {
  if [ "$VT_MODO" = url ]; then echo "$VT_URL"; return; fi
  if [ "$VT_MODO" = pgenv ]; then
    echo "postgres://${PGUSER:-postgres}:${PGPASSWORD:-}@${PGHOST}:${PGPORT:-5432}/${VT_DB}"
    return
  fi
  echo "postgres://vt_test:vt_test@localhost:5432/${VT_DB}"
}
